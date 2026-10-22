import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
const suffix = Date.now().toString().slice(-6);
test("Privatkunde → vergangene Fahrt → Rechnung → unveränderliches PDF → Teilzahlung", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Alles im Blick." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Kunden & Kontakte", exact: true })
    .click();
  await page.getByRole("button", { name: "Neuer Kunde", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Name / Firmenbezeichnung")
    .fill("Beispielkunde " + suffix);
  await dialog
    .getByLabel("Rechnungsanschrift")
    .fill("Fantasiestraße 1\n12345 Beispielstadt");
  await dialog
    .getByRole("button", { name: "Kunde speichern", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Fahrten", exact: true }).click();
  await page
    .getByRole("button", { name: "Fahrt erfassen", exact: true })
    .click();
  await dialog
    .getByLabel("Kunde / Test-Kostenträger")
    .selectOption({ label: "Beispielkunde " + suffix });
  await dialog.getByLabel("Leistungsdatum", { exact: true }).fill("2026-10-20");
  await dialog
    .getByLabel("Abholort", { exact: true })
    .fill("Testbahnhof " + suffix);
  await dialog.getByLabel("Zielort", { exact: true }).fill("Testhotel");
  await dialog.getByLabel("Vereinbarter Gesamtpreis brutto (€)").fill("107,00");
  await dialog
    .getByRole("button", { name: "Fahrt speichern", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("button", { name: "Rechnungen & Zahlungen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Neue Rechnung", exact: true })
    .click();
  await dialog
    .getByLabel("Kunde / Rechnungsempfänger")
    .selectOption({ label: "Beispielkunde " + suffix });
  await dialog.getByRole("checkbox").check();
  await expect(dialog.getByText("19.11.2026", { exact: false })).toBeVisible();
  await dialog
    .getByRole("button", { name: "Testrechnung verbindlich erstellen" })
    .click();
  await expect(dialog).not.toBeVisible();
  const detail = page.locator(".invoice-detail");
  await expect(
    detail.getByRole("heading", { name: "Beispielkunde " + suffix }),
  ).toBeVisible();
  await expect(detail.getByText("100,00 €", { exact: true })).toBeVisible();
  await expect(detail.getByText("7,00 €", { exact: true })).toBeVisible();
  const href = await detail
    .getByRole("link", { name: "Original-PDF öffnen" })
    .getAttribute("href");
  const pdf = await request.get(href!);
  expect(pdf.headers()["content-type"]).toContain("application/pdf");
  const original = await pdf.body();
  expect(original.subarray(0, 4).toString()).toBe("%PDF");
  await detail
    .getByRole("button", { name: "Zahlung erfassen", exact: true })
    .click();
  await dialog.getByLabel("Tatsächlich eingegangener Betrag (€)").fill("50,00");
  await dialog
    .getByLabel("Nachweis / Notiz")
    .fill("Fiktiver Teilzahlungsnachweis");
  await dialog
    .getByRole("button", { name: "Zahlung bestätigen", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(detail.getByText("57,00 €", { exact: true })).toBeVisible();
  expect(await (await request.get(href!)).body()).toEqual(original);
});
test("Tariflabor erklärt20km, sperrt ungeklärte Berechtigung und Teilkilometer", async ({
  page,
}) => {
  await page.goto("/?page=tariffs");
  await expect(page.locator(".calculation-total")).toHaveText("52,59 €");
  await page.getByRole("button", { name: /Art\. II/ }).click();
  await expect(page.locator(".calculation-total")).toHaveText("51,74 €");
  await page
    .getByLabel("Vertragsberechtigung für diesen Testfall bestätigt")
    .uncheck();
  await expect(
    page.getByRole("heading", { name: "Berechnung gesperrt" }),
  ).toBeVisible();
  await page
    .getByLabel("Vertragsberechtigung für diesen Testfall bestätigt")
    .check();
  await page.getByLabel("Besetzte Kilometer", { exact: true }).fill("20,5");
  await expect(
    page.getByText("Die Vertragsregel für angebrochene Kilometer fehlt.", {
      exact: false,
    }),
  ).toBeVisible();
});
test("DTA-Vorprüfung meldet nur Sperren, Privatfaktura wird nicht angeboten", async ({
  page,
}) => {
  await page.goto("/?page=dta");
  await expect(
    page.getByText("Produktivversand gesperrt", { exact: true }),
  ).toBeVisible();
  const select = page.getByLabel("Kassenrechnung", { exact: true });
  await select.selectOption({ index: 1 });
  await page.getByRole("button", { name: "Lokale Vorprüfung starten" }).click();
  await expect(page.locator(".check-history details").first()).toBeVisible();
  await page.locator(".check-history summary").first().click();
  await expect(
    page.getByRole("button", { name: "Prüfbericht herunterladen" }).first(),
  ).toBeVisible();
  await page.getByLabel("Zu prüfendes IK").fill("999999999");
  await page.getByRole("button", { name: "Datenbasis prüfen" }).click();
  await expect(
    page.getByText("Eine Zuordnung für 999999999 ist nicht verifiziert.", {
      exact: false,
    }),
  ).toBeVisible();
});
test("Tastaturdialog, Dunkelmodus und kleine Bildschirmbreite bleiben bedienbar", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Alles im Blick." }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("Navigation durchsuchen").fill("Tariflabor");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Tariflabor" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Tariflabor", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Dunkles Design", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page
    .getByRole("button", { name: "Helles Design", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Navigation öffnen" }).click();
  await page
    .getByRole("button", { name: "Kunden & Kontakte", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Kunden & Kontakte", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Neuer Kunde", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
test("Desktop und Mobilansicht mit synthetischen Daten visuell prüfen", async ({
  page,
}) => {
  mkdirSync("work/screenshots", { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Alles im Blick." }),
  ).toBeVisible();
  await page.screenshot({
    path: "work/screenshots/overview-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "work/screenshots/overview-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("Offene Krankenfahrt korrigieren, ArtII-Testrechnung erstellen und gebundene Fahrt sperren", async ({
  page,
}) => {
  await page.goto("/?page=journeys");
  await expect(
    page.getByRole("heading", { name: "Fahrten", exact: true }),
  ).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Testort E" });
  await row.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Offene Fahrt bearbeiten" }),
  ).toBeVisible();
  await dialog
    .getByLabel("Verordnung und Genehmigung im Testfall geprüft")
    .check();
  await dialog.getByLabel("Vertragsart", { exact: true }).selectOption("II");
  await dialog
    .getByLabel("Leistungsbeschreibung (optional)")
    .fill("Korrigierte Testfahrt " + suffix);
  await dialog.getByLabel("Besetzte Kilometer", { exact: true }).fill("20");
  await dialog.getByRole("button", { name: "Änderungen speichern" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(row.getByText("51,74 €", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Rechnungen & Zahlungen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Neue Rechnung", exact: true })
    .click();
  await dialog
    .getByLabel("Kunde / Rechnungsempfänger")
    .selectOption({ label: "Musterkasse Nord (fiktiv)" });
  await dialog
    .locator(".journey-selection label")
    .filter({ hasText: "Korrigierte Testfahrt " + suffix })
    .getByRole("checkbox")
    .check();
  await expect(
    dialog.getByText("Kassenfrist ungeprüft", { exact: false }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Testrechnung verbindlich erstellen" })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page
      .locator(".invoice-detail")
      .getByText("51,74 €", { exact: true })
      .first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Fahrten", exact: true }).click();
  await expect(
    page
      .getByRole("row")
      .filter({ hasText: "Testort E" })
      .getByRole("button", { name: "Bearbeiten" }),
  ).toHaveCount(0);
});
test("KE-Teilprofil liest synthetische Struktur und sperrt fehlerhafte Segmentzählung", async ({
  page,
}) => {
  await page.goto("/?page=dta");
  await page
    .getByRole("button", { name: "Synthetisches Muster laden" })
    .click();
  await page
    .getByRole("button", { name: "Struktur prüfen", exact: true })
    .click();
  await expect(
    page.getByText("Im begrenzten Teilprofil strukturell lesbar", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("Keine Freigabe", { exact: true })).toBeVisible();
  const input = page.getByLabel("Kostenträgertext im KOTR-Teilprofil", {
    exact: true,
  });
  await input.fill(
    (await input.inputValue()).replace("UNT+000011", "UNT+000010"),
  );
  await page
    .getByRole("button", { name: "Struktur prüfen", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "UNT-Segmentanzahl stimmt nicht",
  );
});
