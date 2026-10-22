import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Contract/UI tests deliberately intercept every setup/auth request. No credentials or probe reach Supabase.
const factorId = "90000000-0000-4000-8000-000000000001";
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const app = {
  customers: [],
  journeys: [],
  invoices: [],
  dtaChecks: [],
  audit: [],
  csrfToken: "demo-csrf",
  mode: "demo",
  businessDate: "2026-10-22",
  version: "ui-contract-test",
};
const anonymous = {
  phase: "anonymous",
  csrfToken: "csrf-anonymous",
  factors: [],
  expiresAt: "2026-10-22T13:30:00Z",
  ownerConfigured: true,
};
const setup = {
  configured: true,
  projectHost: "synthetic-project.supabase.co",
  region: {
    reported: "europe",
    confirmed: "eu-central-1",
    expected: "eu-central-1",
    verified: true,
  },
  ownerConfigured: true,
  ownIkConfigured: true,
  authRequired: false,
  productionReady: false,
  financialStorage: "local-sqlite",
  dtaTransport: "blocked",
  auth: anonymous,
};
async function scaffold(page: Page, status: unknown = setup) {
  await page.route("**/api/state", (route) => route.fulfill({ json: app }));
  await page.route("**/api/setup/status", (route) =>
    route.fulfill({ json: status }),
  );
}

test("Inhaber-Anmeldung → Authenticator-Einrichtung → MFA → synthetischer Datenbanktest uses rotated CSRF", async ({
  page,
}) => {
  await scaffold(page);
  const enrollmentAuth = {
    ...anonymous,
    phase: "enroll-required",
    csrfToken: "csrf-password",
  };
  const verifiedAuth = {
    ...anonymous,
    phase: "authenticated",
    csrfToken: "csrf-mfa",
    factors: [{ id: factorId, friendlyName: "Test-Authenticator" }],
  };
  await page.route("**/api/auth/login", async (route) => {
    expect(route.request().headers()["x-csrf-token"]).toBe("csrf-anonymous");
    expect(route.request().postDataJSON().email).toBe(
      "beispiel@example.invalid",
    );
    await route.fulfill({ json: { auth: enrollmentAuth } });
  });
  await page.route("**/api/auth/enroll", async (route) => {
    expect(route.request().headers()["x-csrf-token"]).toBe("csrf-password");
    await route.fulfill({
      json: {
        auth: enrollmentAuth,
        enrollment: { factorId, qrDataUrl: png, secret: "JBSWY3DPEHPK3PXP" },
      },
    });
  });
  await page.route("**/api/auth/verify", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      factorId,
      code: "123456",
    });
    expect(route.request().headers()["x-csrf-token"]).toBe("csrf-password");
    await route.fulfill({ json: { auth: verifiedAuth } });
  });
  await page.route("**/api/setup/supabase/probe", async (route) => {
    expect(route.request().headers()["x-csrf-token"]).toBe("csrf-mfa");
    await route.fulfill({
      json: {
        verification: {
          schemaVersion: "taxidta-setup-probe-v1",
          syntheticOnly: true,
          writeVerified: true,
          readVerified: true,
          cleanupVerified: true,
          checkedAt: "2026-10-22T13:10:00Z",
          probeId: factorId,
        },
      },
    });
  });
  await page.goto("/?page=settings");
  await expect(
    page.getByRole("heading", { name: "Supabase & Inhaber-Anmeldung" }),
  ).toBeVisible();
  await expect(
    page.getByText("Frankfurt · eu-central-1", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("E-Mail-Adresse", { exact: true })
    .fill("beispiel@example.invalid");
  await page
    .getByLabel("Passwort", { exact: true })
    .fill("Nur-Ein-Synthetisches-Testpasswort!");
  await page
    .getByRole("button", { name: "Mit Inhaber-Konto anmelden", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Authenticator einrichten", exact: true })
    .click();
  await expect(
    page.getByRole("img", {
      name: "QR-Code zur Einrichtung deines persönlichen Authenticators",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Stattdessen manuell einrichten" })
    .click();
  await expect(
    page.getByText("JBSWY3DPEHPK3PXP", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Authenticator-Code", { exact: true }).fill("123456");
  await page
    .getByRole("button", { name: "Code bestätigen", exact: true })
    .click();
  await expect(
    page.getByRole("img", {
      name: "QR-Code zur Einrichtung deines persönlichen Authenticators",
    }),
  ).toHaveCount(0);
  await expect(page.getByText("JBSWY3DPEHPK3PXP", { exact: true })).toHaveCount(
    0,
  );
  await page
    .getByRole("button", { name: "Datenbankverbindung testen", exact: true })
    .click();
  await expect(
    page.getByText("Synthetischer Datenbanktest bestanden", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) =>
        /auth|secret|password|token/i.test(key),
      ),
    ),
  ).toEqual([]);
});

test("Anmeldung mit bestehendem Faktor accepts no malformed code and shows server rejection without success", async ({
  page,
}) => {
  const existing = {
    ...anonymous,
    phase: "mfa-required",
    csrfToken: "csrf-existing",
    factors: [{ id: factorId, friendlyName: "Vorhandener Testfaktor" }],
  };
  await scaffold(page, { ...setup, auth: existing });
  await page.route("**/api/auth/verify", (route) =>
    route.fulfill({
      status: 422,
      json: {
        error: "Der Code ist nicht gültig. Bitte den aktuellen Code versuchen.",
        auth: existing,
      },
    }),
  );
  await page.goto("/?page=settings");
  await expect(
    page.getByRole("button", { name: "Code bestätigen", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Authenticator-Code", { exact: true }).fill("12ab3456");
  await expect(
    page.getByLabel("Authenticator-Code", { exact: true }),
  ).toHaveValue("1234");
  await expect(
    page.getByRole("button", { name: "Code bestätigen", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Authenticator-Code", { exact: true })
    .evaluate((input) => {
      const clipboard = new DataTransfer();
      clipboard.setData("text", "123 456");
      input.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: clipboard,
        }),
      );
    });
  await expect(
    page.getByLabel("Authenticator-Code", { exact: true }),
  ).toHaveValue("123456");
  await page
    .getByRole("button", { name: "Code bestätigen", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Der Code ist nicht gültig",
  );
  await expect(
    page.getByLabel("Authenticator-Code", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", {
      name: "Datenbankverbindung testen",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Authenticator einrichten", exact: true }),
  ).toHaveCount(0);
});

test("fehlende Konfiguration and unknown Europe region remain visibly incomplete without login inputs", async ({
  page,
}) => {
  await scaffold(page, {
    ...setup,
    configured: false,
    ownerConfigured: false,
    region: {
      reported: "europe",
      confirmed: null,
      expected: "eu-central-1",
      verified: false,
    },
    auth: null,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?page=settings");
  await expect(
    page.getByRole("heading", { name: "Supabase & Inhaber-Anmeldung" }),
  ).toBeVisible();
  await expect(
    page.getByText("Gemeldet: europe", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Prüfung offen", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Passwort", { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("AuthGate hält Finanzansicht bis zur bestätigten MFA geschlossen und öffnet danach die Übersicht", async ({
  page,
}) => {
  let phase: "anonymous" | "password-confirmed" | "mfa-confirmed" = "anonymous";
  let preMfaStateRequests = 0;
  let authorizedStateRequests = 0;
  const mfaRequired = {
    ...anonymous,
    phase: "mfa-required",
    csrfToken: "csrf-gate-password",
    factors: [{ id: factorId, friendlyName: "Vorhandener Inhaber-Testfaktor" }],
  };
  const authenticated = {
    ...mfaRequired,
    phase: "authenticated",
    csrfToken: "csrf-gate-mfa",
  };
  await page.route("**/api/state", async (route) => {
    if (phase !== "mfa-confirmed") {
      preMfaStateRequests++;
      await route.fulfill({
        status: 401,
        json: {
          error:
            "Bitte zuerst mit dem Inhaber-Konto und Authenticator anmelden.",
        },
      });
    } else {
      authorizedStateRequests++;
      await route.fulfill({
        json: { ...app, csrfToken: authenticated.csrfToken },
      });
    }
  });
  await page.route("**/api/setup/status", (route) =>
    route.fulfill({
      json: {
        ...setup,
        authRequired: true,
        auth:
          phase === "anonymous"
            ? anonymous
            : phase === "password-confirmed"
              ? mfaRequired
              : authenticated,
      },
    }),
  );
  await page.route("**/api/auth/login", async (route) => {
    expect(route.request().headers()["x-csrf-token"]).toBe(anonymous.csrfToken);
    expect(route.request().postDataJSON().email).toBe(
      "inhaber@example.invalid",
    );
    phase = "password-confirmed";
    await route.fulfill({ json: { auth: mfaRequired } });
  });
  await page.route("**/api/auth/verify", async (route) => {
    expect(route.request().headers()["x-csrf-token"]).toBe(
      mfaRequired.csrfToken,
    );
    const body = route.request().postDataJSON();
    expect(body.factorId).toBe(factorId);
    if (body.code !== "123456") {
      await route.fulfill({
        status: 422,
        json: {
          error:
            "Der Code ist nicht gültig. Die Finanzansicht bleibt gesperrt.",
          auth: mfaRequired,
        },
      });
      return;
    }
    phase = "mfa-confirmed";
    await route.fulfill({ json: { auth: authenticated } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Supabase & Inhaber-Anmeldung" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Alles im Blick.", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Rechnungen & Zahlungen", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Neue Rechnung", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  mkdirSync("work/screenshots", { recursive: true });
  await page.screenshot({
    path: "work/screenshots/auth-gate-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByLabel("E-Mail-Adresse", { exact: true })
    .fill("inhaber@example.invalid");
  await page
    .getByLabel("Passwort", { exact: true })
    .fill("AusschliesslichEinSynthetischesTestpasswort!");
  await page
    .getByRole("button", { name: "Mit Inhaber-Konto anmelden", exact: true })
    .click();
  await expect(
    page.getByLabel("Authenticator-Code", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Alles im Blick.", exact: true }),
  ).toHaveCount(0);
  expect(authorizedStateRequests).toBe(0);
  await page.getByLabel("Authenticator-Code", { exact: true }).fill("000000");
  await page
    .getByRole("button", { name: "Code bestätigen", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Der Code ist nicht gültig" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Alles im Blick.", exact: true }),
  ).toHaveCount(0);
  expect(authorizedStateRequests).toBe(0);
  await page.getByLabel("Authenticator-Code", { exact: true }).fill("123456");
  await page
    .getByRole("button", { name: "Code bestätigen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Alles im Blick.", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".auth-gate")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Neue Rechnung", exact: true }),
  ).toBeVisible();
  expect(preMfaStateRequests).toBeGreaterThan(0);
  expect(authorizedStateRequests).toBeGreaterThan(0);
});

test("AuthGate zeigt Supabase-Netzwerkfehler bei vorhandener MFA-Sitzung und öffnet erst nach erfolgreicher erneuter Prüfung", async ({
  page,
}) => {
  let networkAvailable = false;
  let rejectedStateRequests = 0;
  let successfulStateRequests = 0;
  const networkMessage =
    "Die Verbindung zu Supabase ist zurzeit nicht erreichbar. Bitte die Netzwerkfreigabe prüfen.";
  const authenticated = {
    ...anonymous,
    phase: "authenticated",
    csrfToken: "csrf-existing-mfa",
    factors: [{ id: factorId, friendlyName: "Vorhandener Inhaber-Testfaktor" }],
  };
  await page.route("**/api/state", async (route) => {
    if (!networkAvailable) {
      rejectedStateRequests++;
      await route.fulfill({
        status: 503,
        json: { code: "SUPABASE_NETWORK_UNAVAILABLE", error: networkMessage },
      });
      return;
    }
    successfulStateRequests++;
    await route.fulfill({
      json: { ...app, csrfToken: authenticated.csrfToken },
    });
  });
  await page.route("**/api/setup/status", (route) =>
    route.fulfill({
      json: { ...setup, authRequired: true, auth: authenticated },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Supabase & Inhaber-Anmeldung" }),
  ).toBeVisible();
  await expect(
    page.getByRole("alert").filter({ hasText: networkMessage }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Alles im Blick.", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Neue Rechnung", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Arbeitsplatz öffnen", exact: true }),
  ).toBeVisible();
  expect(successfulStateRequests).toBe(0);
  const previousRejected = rejectedStateRequests;
  await page
    .getByRole("button", { name: "Arbeitsplatz öffnen", exact: true })
    .click();
  await expect
    .poll(() => rejectedStateRequests)
    .toBeGreaterThan(previousRejected);
  await expect(
    page.getByRole("alert").filter({ hasText: networkMessage }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Alles im Blick.", exact: true }),
  ).toHaveCount(0);
  expect(successfulStateRequests).toBe(0);
  networkAvailable = true;
  await page
    .getByRole("button", { name: "Arbeitsplatz öffnen", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Alles im Blick.", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".auth-gate")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Neue Rechnung", exact: true }),
  ).toBeVisible();
  expect(successfulStateRequests).toBeGreaterThan(0);
});
