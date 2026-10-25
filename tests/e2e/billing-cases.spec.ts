import { test, expect, type Page } from "@playwright/test";

const suffix = Date.now().toString(36);
async function beginCase(
  page: Page,
  name: string,
  payer: "demo" | "official" = "demo",
) {
  await page
    .getByRole("button", { name: "Neue Abrechnung", exact: true })
    .click();
  const picker = page.getByRole("combobox", {
    name: "Krankenkasse suchen",
    exact: true,
  });
  await picker.fill(payer === "demo" ? "Demokasse" : "AOK Niedersachsen");
  await page
    .getByRole("option", {
      name:
        payer === "demo" ? /Demokasse/ : /Gesundheitskasse für Niedersachsen/,
    })
    .click();
  await page
    .getByLabel("Name der versicherten Person", { exact: true })
    .fill(name);
  await page
    .getByLabel("Anschrift der versicherten Person", { exact: true })
    .fill("Fantasieweg 12\n12345 Beispielstadt");
  await page
    .getByLabel("Versichertennummer (optional)", { exact: true })
    .fill(
      "TEST-" + name.replace(/[^a-z0-9]/gi, "").slice(0, 20) + "-" + suffix,
    );
  await page
    .getByLabel("Verordnungsreferenz (optional)", { exact: true })
    .fill("TEST-RX-" + name.slice(-12));
  await page
    .getByLabel("Ausstellungsdatum der Verordnung", { exact: true })
    .fill("2026-10-01");
  await page
    .getByLabel(
      "Verordnung und erforderliche Genehmigung für diese Fahrten geprüft",
      { exact: true },
    )
    .check();
  await page
    .getByLabel("Abholort der Hinfahrt", { exact: true })
    .fill("Fiktiver Wohnort");
  await page
    .getByLabel("Zielort der Hinfahrt", { exact: true })
    .fill("Fiktives Behandlungszentrum");
  await page
    .getByLabel("Besetzte Kilometer je einfacher Fahrt", { exact: true })
    .fill("20");
  await page.getByLabel("Vertragstarif", { exact: true }).selectOption("II");
  await page
    .getByLabel(
      "Meine Vertragsberechtigung für den gewählten Tarif ist geprüft",
      { exact: true },
    )
    .check();
}

test("Eine Verordnung mit mehreren Fahrtdaten → zwei Fälle → eine Kassenrechnung ohne Kundenanlage", async ({
  page,
}) => {
  const customerRequests: string[] = [];
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/customers"
    )
      customerRequests.push(request.url());
  });
  await page.goto("/?page=cases");
  const firstName = "Fiktive Fallperson A " + suffix;
  const secondName = "Fiktive Fallperson B " + suffix;
  await beginCase(page, firstName);
  await page
    .getByLabel("Mehrere Fahrtdaten auf einmal", { exact: true })
    .fill("19.10.2026\n20.10.2026");
  await page
    .getByRole("button", { name: "Fahrtdaten übernehmen", exact: true })
    .click();
  await expect(page.getByLabel("Fahrtdatum 1", { exact: true })).toHaveValue(
    "2026-10-19",
  );
  await expect(page.getByLabel("Fahrtdatum 4", { exact: true })).toHaveValue(
    "2026-10-20",
  );
  await expect(
    page.getByRole("region", { name: "Unterberechnung des Abrechnungsfalls" }),
  ).toContainText("206,96");
  await page
    .getByRole("button", { name: "Abrechnungsfall speichern", exact: true })
    .click();
  const first = page.locator(".case-list-item").filter({ hasText: firstName });
  await expect(first).toContainText("4 Fahrten");
  await expect(first).toContainText("Bereit zur Rechnung");
  await beginCase(page, secondName);
  await page
    .getByLabel("Mehrere Fahrtdaten auf einmal", { exact: true })
    .fill("21.10.2026");
  await page
    .getByRole("button", { name: "Fahrtdaten übernehmen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Abrechnungsfall speichern", exact: true })
    .click();
  const second = page
    .locator(".case-list-item")
    .filter({ hasText: secondName });
  await expect(second).toContainText("2 Fahrten");
  await first.getByRole("checkbox").check();
  await second.getByRole("checkbox").check();
  const bundle = page.getByRole("region", {
    name: "Ausgewählte Abrechnungsfälle abrechnen",
  });
  await expect(bundle).toContainText("Eine Rechnung aus 2 Fällen");
  await expect(bundle).toContainText("310,44");
  await bundle.getByLabel("Rechnungsdatum", { exact: true }).fill("2026-10-22");
  await bundle
    .getByLabel("Ausgewählte Fälle und Rechnungsbetrag geprüft", {
      exact: true,
    })
    .check();
  const invoiceResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/invoices/from-cases" &&
      response.request().method() === "POST",
  );
  await bundle
    .getByRole("button", {
      name: "Fälle zu einer Testrechnung bündeln",
      exact: true,
    })
    .click();
  const response = await invoiceResponse;
  expect(response.status()).toBe(201);
  const result = await response.json();
  const invoice = result.invoice ?? result;
  expect(invoice.grossCents).toBe(31044);
  expect(invoice.lines).toHaveLength(6);
  expect(invoice.billingCaseIds).toHaveLength(2);
  expect(
    new Set(
      invoice.lines.map((line: { insuredName: string }) => line.insuredName),
    ),
  ).toEqual(new Set([firstName, secondName]));
  await expect(page.locator(".invoice-detail")).toContainText("310,44");
  const delivery = page.getByRole("region", { name: "DTA-Versandstatus" });
  await expect(delivery).toBeVisible();
  await expect(delivery).toContainText("Nicht versendet");
  await expect(delivery).toContainText("Keine Rückmeldung");
  await expect(delivery).toContainText("keine Originalquittung archiviert");
  const pdf = await page.request.get(`/api/invoices/${invoice.id}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
  expect(customerRequests).toEqual([]);
  await page
    .getByRole("button", { name: "Abrechnungsfälle", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Abrechnungsfälle verwalten" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Abrechnungsfälle nach Status filtern" })
    .selectOption("invoiced");
  await expect(first.getByRole("checkbox")).toBeDisabled();
  await expect(second.getByRole("checkbox")).toBeDisabled();
});

test("Datumsliste verwirft ungültige und doppelte Daten; echte Registerkasse bleibt als bearbeitbarer Entwurf gesperrt", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?page=cases");
  const name = "Fiktive Entwurfperson " + suffix;
  await beginCase(page, name, "official");
  const dates = page.getByLabel("Mehrere Fahrtdaten auf einmal", {
    exact: true,
  });
  await dates.fill("31.02.2026");
  await page
    .getByRole("button", { name: "Fahrtdaten übernehmen", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("nicht gültig");
  await expect(page.getByLabel("Fahrtdatum 2", { exact: true })).toHaveCount(0);
  await dates.fill("20.10.2026");
  await page
    .getByRole("button", { name: "Fahrtdaten übernehmen", exact: true })
    .click();
  await expect(page.getByLabel("Fahrtdatum 2", { exact: true })).toHaveValue(
    "2026-10-20",
  );
  await dates.fill("20.10.2026");
  await page
    .getByRole("button", { name: "Fahrtdaten übernehmen", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("steht bereits");
  await expect(page.getByLabel("Fahrtdatum 3", { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Abrechnungsfall speichern", exact: true })
    .click();
  const item = page.locator(".case-list-item").filter({ hasText: name });
  await expect(item).toContainText("Offene Angaben");
  await expect(item.getByRole("checkbox")).toBeDisabled();
  await item.getByRole("button", { name: /Fall bearbeiten/ }).click();
  await expect(
    page.getByRole("heading", {
      name: "Abrechnungsfall bearbeiten",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Name der versicherten Person", { exact: true }),
  ).toHaveValue(name);
  await expect(
    page.getByRole("combobox", { name: "Krankenkasse suchen", exact: true }),
  ).toHaveValue(/Gesundheitskasse für Niedersachsen/);
  await page
    .getByLabel("Anschrift der versicherten Person", { exact: true })
    .fill("Geänderter Testweg 3\n12345 Beispielstadt");
  await page
    .getByRole("button", { name: "Abrechnungsfall speichern", exact: true })
    .click();
  await expect(item).toHaveCount(1);
  await expect(item).toContainText("2 Fahrten");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("Fahrten nur im Abrechnungsfall: maximal 20 Einzelfahrten, Richtung frei wählbar und kein Gemeindeformular", async ({
  page,
}) => {
  await page.goto("/?page=journeys");
  await expect(
    page.getByRole("heading", { name: "Abrechnungsfälle", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Fahrten", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Fahrt erfassen", exact: true }),
  ).toHaveCount(0);
  await beginCase(page, "Fiktive Zwanzigfahrtenperson " + suffix);
  await expect(
    page.getByText("Vollständig innerhalb einer Gemeinde?", { exact: true }),
  ).toHaveCount(0);
  const dates = page.getByLabel("Mehrere Fahrtdaten auf einmal", {
    exact: true,
  });
  await dates.fill(
    Array.from({ length: 11 }, (_, index) => `${index + 1}.10.2026`).join("\n"),
  );
  await page
    .getByRole("button", { name: "Fahrtdaten übernehmen", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("höchstens 20");
  await expect(page.getByLabel("Fahrtdatum 2", { exact: true })).toHaveCount(0);
  await dates.fill(
    Array.from({ length: 10 }, (_, index) => `${index + 1}.10.2026`).join("\n"),
  );
  await page
    .getByRole("button", { name: "Fahrtdaten übernehmen", exact: true })
    .click();
  await expect(page.getByLabel("Fahrtdatum 20", { exact: true })).toHaveValue(
    "2026-10-10",
  );
  await expect(page.getByLabel("Fahrtdatum 21", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", {
      name: "Einzelnes Fahrtdatum hinzufügen",
      exact: true,
    }),
  ).toBeDisabled();
  await page
    .getByLabel("Fahrtrichtungen der Datumsliste", { exact: true })
    .selectOption("return");
  await dates.fill("15.10.2026");
  await page
    .getByRole("button", { name: "Fahrtdaten übernehmen", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Es wurden keine Daten übernommen",
  );
  await expect(page.getByLabel("Fahrtdatum 21", { exact: true })).toHaveCount(
    0,
  );
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/billing-cases" &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Abrechnungsfall speichern", exact: true })
    .click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const item = await response.json();
  expect(item.journeys).toHaveLength(20);
  expect(
    item.journeys.filter(
      (journey: { direction: string }) => journey.direction === "outbound",
    ),
  ).toHaveLength(10);
  expect(
    item.journeys.filter(
      (journey: { direction: string }) => journey.direction === "return",
    ),
  ).toHaveLength(10);
  await expect(
    page
      .locator(".case-list-item")
      .filter({ hasText: "Fiktive Zwanzigfahrtenperson " + suffix }),
  ).toContainText("20 Fahrten");
  await beginCase(page, "Fiktive Nur-Rueckfahrtperson " + suffix);
  await page
    .getByLabel("Fahrtrichtungen der Datumsliste", { exact: true })
    .selectOption("return");
  await dates.fill("11.10.2026\n12.10.2026");
  await page
    .getByRole("button", { name: "Fahrtdaten übernehmen", exact: true })
    .click();
  await expect(page.getByLabel("Richtung 1", { exact: true })).toHaveValue(
    "return",
  );
  await expect(page.getByLabel("Richtung 2", { exact: true })).toHaveValue(
    "return",
  );
  await expect(page.getByLabel("Fahrtdatum 3", { exact: true })).toHaveCount(0);
  await page
    .getByLabel("Fahrtrichtungen der Datumsliste", { exact: true })
    .selectOption("outbound");
  await dates.fill("13.10.2026");
  await page
    .getByRole("button", { name: "Fahrtdaten übernehmen", exact: true })
    .click();
  await expect(page.getByLabel("Richtung 3", { exact: true })).toHaveValue(
    "outbound",
  );
});

test("Automatische Steuer zeigt 7 Prozent bis 50 km und speichert längere ungeklärte Strecken als Entwurf", async ({
  page,
}) => {
  const name = "Fiktive Fernfahrtperson " + suffix;
  await page.goto("/?page=cases");
  await beginCase(page, name);
  await page
    .getByLabel("Fahrtrichtungen der Datumsliste", { exact: true })
    .selectOption("outbound");
  await page
    .getByLabel("Mehrere Fahrtdaten auf einmal", { exact: true })
    .fill("20.10.2026");
  await page
    .getByRole("button", { name: "Fahrtdaten übernehmen", exact: true })
    .click();
  const calculation = page.getByRole("region", {
    name: "Unterberechnung des Abrechnungsfalls",
  });
  await calculation.locator("summary").click();
  await page.getByLabel("Kilometer 1", { exact: true }).fill("50");
  await expect(calculation).toContainText("7 % USt.");
  await expect(calculation).not.toContainText("vorläufig");
  await page.getByLabel("Kilometer 1", { exact: true }).fill("51");
  await expect(calculation).toContainText("19 % USt. (vorläufig)");
  await expect(calculation).toContainText("als Entwurf gespeichert");
  const saved = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/billing-cases" &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Abrechnungsfall speichern", exact: true })
    .click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const item = await response.json();
  expect(item.sameMunicipality).toBeNull();
  expect(item.journeys[0].taxPending).toBe(true);
  const draft = page.locator(".case-list-item").filter({ hasText: name });
  await expect(draft).toContainText("Offene Angaben");
  await expect(draft.getByRole("checkbox")).toBeDisabled();
  await draft.locator("summary").click();
  await expect(draft).toContainText("Steuer vorläufig");
});
