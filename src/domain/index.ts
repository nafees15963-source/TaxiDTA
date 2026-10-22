import type { InvoiceLine, Journey, JourneyKind, TariffInput, TariffResult, TaxResult, VehicleKind } from '../shared/types.ts';

/** Stable machine code plus a German remedy; safe to present as a validation error. */
export class DomainError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'DomainError'; }
}
const fail = (code: string, message: string): never => { throw new DomainError(code, message); };
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const safeNumber = (value: bigint): number => value <= MAX_SAFE && value >= -MAX_SAFE ? Number(value) : fail('AMOUNT_TOO_LARGE', 'Der Betrag ist zu groß. Bitte prüfen Sie die Eingabe.');

/** Accept a decimal separator, never thousands separators, exponent notation, NaN or hidden rounding. */
function decimal(value: string, scale: number, label: string): bigint {
  if (typeof value !== 'string' || value.length > 32 || !new RegExp(`^\\d+(?:[.,]\\d{1,${scale}})?$`).test(value)) {
    return fail('INVALID_DECIMAL', `${label}: Bitte eine positive Dezimalzahl mit höchstens ${scale} Nachkommastellen eingeben, ohne Tausendertrennzeichen.`);
  }
  const [whole, fraction = ''] = value.replace(',', '.').split('.');
  const result = BigInt(whole) * (10n ** BigInt(scale)) + BigInt(fraction.padEnd(scale, '0'));
  if (result > MAX_SAFE) return fail('AMOUNT_TOO_LARGE', `${label}: Die Eingabe ist zu groß.`);
  return result;
}
export function parseMoney(value: string): number { return safeNumber(decimal(value, 2, 'Betrag')); }
/** Distance in exact hundredths of a kilometre. */
export function parseDistance(value: string): number {
  const result = decimal(value, 2, 'Kilometer');
  if (result > 100_000_000n) return fail('DISTANCE_TOO_LARGE', 'Bitte die ungewöhnlich hohe Kilometerzahl prüfen.');
  return Number(result);
}
export function formatMoney(cents: number): string {
  if (!Number.isSafeInteger(cents)) return fail('INVALID_CENTS', 'Ein Betrag muss als ganze Centzahl vorliegen.');
  // Formatting only: arithmetic is done in integral cents below.
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(cents / 100);
}
export function assertDate(value: string): void {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fail('INVALID_DATE', 'Bitte ein gültiges Datum im Format JJJJ-MM-TT eingeben.');
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return fail('INVALID_DATE', 'Dieses Kalenderdatum existiert nicht.');
}
function supportedDate(value: string): void {
  assertDate(value);
  if (value < '2026-01-01' || value > '2026-12-31') return fail('POLICY_DATE_UNVERIFIED', 'Für dieses Leistungsdatum ist in der Demo keine freigegebene Regelversion hinterlegt. Unterstützter Prüfzeitraum: 2026.');
}
export function addCalendarDays(value: string, days: number): string {
  assertDate(value);
  if (!Number.isSafeInteger(days) || days < 0 || days > 3660) return fail('INVALID_TERM', 'Bitte eine gültige Zahlungsfrist in Kalendertagen angeben.');
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const RULES = Object.freeze({
  I: Object.freeze({ base: '510100', km: '513000', approach: '513900', tunnel: '512500', kmCents: 227,
    source: 'PosNrVerzeichnis_T&M_Art I_ab 01.01.2026.pdf, Seite 1, gültig ab 01.01.2026' }),
  II: Object.freeze({ base: '510131', km: '513131', approach: '513931', tunnel: '512531', kmCents: 222,
    source: 'PosNrVerzeichnis_T&M_Art II_ab 01.01.2026.pdf, Seite 1, gültig ab 01.01.2026' }),
});

export function calculateTariff(input: TariffInput): TariffResult {
  if (!input || !Object.hasOwn(RULES, input.article)) return fail('UNSUPPORTED_TARIFF', 'Bitte Art. I (ohne besondere Ausprägung) oder Art. II (Serienbehandlung) wählen.');
  supportedDate(input.date);
  if (input.persons !== 1) return fail('MULTIPERSON_NOT_RELEASED', 'Mehrpersonenbeförderung hat eigene Positionen und Preise. Sie ist in dieser Version noch nicht freigegeben.');
  if (input.contractConfirmed !== true) return fail('CONTRACT_UNCONFIRMED', 'Bitte die Vertragsberechtigung für Tarif und Leistungsdatum anhand Ihrer Unterlagen bestätigen.');
  const hundredths = BigInt(parseDistance(input.km));
  if (hundredths <= 0n) return fail('ZERO_DISTANCE', 'Eine durchgeführte Personenfahrt benötigt mehr als 0 Besetztkilometer.');
  if (hundredths % 100n !== 0n) return fail('KM_ROUNDING_UNVERIFIED', 'Die Vertragsregel für angebrochene Kilometer fehlt. Bitte die belegte Abrechnungsmenge in ganzen Kilometern verwenden; es wird nicht automatisch gerundet.');
  const km = hundredths / 100n;
  const rule = RULES[input.article];
  const positions: TariffResult['positions'] = [{ code: rule.base, label: 'Mindestpreis einschließlich 3 Besetztkilometern', quantity: '1', unitCents: 1400, totalCents: 1400, source: rule.source }];
  const explanation = ['Der Mindestpreis von 14,00 € umfasst die ersten 3 Besetztkilometer.'];
  const extra = km > 3n ? km - 3n : 0n;
  if (extra > 0n) {
    const totalCents = safeNumber(extra * BigInt(rule.kmCents));
    positions.push({ code: rule.km, label: 'Besetztkilometer ab dem 4. Kilometer', quantity: extra.toString(), unitCents: rule.kmCents, totalCents, source: rule.source });
    explanation.push(`${km} − 3 = ${extra} zusätzliche Kilometer × ${formatMoney(rule.kmCents)} = ${formatMoney(totalCents)}.`);
  } else explanation.push('Es werden keine zusätzlichen Besetztkilometer berechnet.');
  const approachHundredths = BigInt(parseDistance(input.approachKm ?? '0'));
  if (approachHundredths > 0n) {
    if (input.approachEligible !== true) return fail('APPROACH_UNCONFIRMED', 'Anfahrt nur mit belegter vertraglicher Berechtigung abrechnen. Bitte die Berechtigung bestätigen oder Anfahrt auf 0 setzen.');
    if (approachHundredths % 100n !== 0n) return fail('KM_ROUNDING_UNVERIFIED', 'Für angebrochene Anfahrtkilometer fehlt die Vertrags-Rundungsregel.');
    const actualKm = approachHundredths / 100n;
    const billedKm = actualKm > 8n ? 8n : actualKm;
    const totalCents = safeNumber(billedKm * 114n);
    positions.push({ code: rule.approach, label: 'Vertraglich bestätigte Anfahrt (maximal 9,12 €)', quantity: billedKm.toString(), unitCents: 114, totalCents, source: rule.source });
    explanation.push(`Anfahrt ${actualKm} km; abrechenbar höchstens 8 km × 1,14 € = ${formatMoney(totalCents)} (Deckel 9,12 €).`);
  }
  const crossings = input.tunnelCrossings ?? 0;
  if (!Number.isSafeInteger(crossings) || crossings < 0 || crossings > 20) return fail('INVALID_TUNNEL_COUNT', 'Bitte 0 bis 20 tatsächliche Herrentunnel-Durchfahrten angeben.');
  if (crossings > 0) {
    if (input.tunnelConfirmed !== true) return fail('TUNNEL_UNCONFIRMED', 'Die tatsächlichen Mautkosten und die Vertragsberechtigung müssen vorliegen.');
    // The uploaded list proves a ceiling, not the incurred amount. No assumption that each passage costs the ceiling.
    return fail('TUNNEL_ACTUAL_AMOUNT_MISSING', 'Die Mautliste nennt nur einen Höchstbetrag von 2,30 € je Durchfahrt. Die tatsächlichen belegten Kosten können hier noch nicht erfasst werden; die automatische Mautberechnung bleibt gesperrt.');
  }
  const grossCents = safeNumber(positions.reduce((sum, line) => sum + BigInt(line.totalCents), 0n));
  return { article: input.article, positions, grossCents, explanation, source: rule.source,
    warnings: ['Vertragsberechtigung ist eine Nutzerbestätigung; kein Nachweis aktueller Kassenmitgliedschaft.', 'Keine automatische Zuzahlungsberechnung. Preise werden als Bruttowerte des bestätigten Demo-Vertrags behandelt.', 'Nur Einpersonenfahrt, Art. I ohne besondere Ausprägung oder Art. II Serienbehandlung; keine Reha-/Verlegungsvariante.'] };
}

export function calculateTax(input: { kind: JourneyKind; vehicle: VehicleKind; km: string; sameMunicipality: boolean | null; date: string }): TaxResult {
  if (!input) return fail('MISSING_TAX_INPUT', 'Die Steuermerkmale fehlen.');
  supportedDate(input.date);
  if (!['taxi', 'medical', 'courier', 'laboratory'].includes(input.kind)) return fail('UNSUPPORTED_SERVICE', 'Für diese Leistungsart ist keine bestätigte Steuerregel vorhanden.');
  if (!['taxi', 'rental'].includes(input.vehicle)) return fail('UNSUPPORTED_VEHICLE', 'Bitte die tatsächliche Fahrzeugzulassung angeben.');
  const km = BigInt(parseDistance(input.km));
  if (input.kind === 'courier' || input.kind === 'laboratory') {
    return { rate: 19, reason: '19 %: inländischer Kurier-/Labortransport im Regelsteuerfall; keine Personenbeförderung.', ruleId: 'DE-2026-USTG12-1-COURIER', source: '§ 12 Abs. 1 UStG; https://www.gesetze-im-internet.de/ustg_1980/__12.html; amtlicher Text abgerufen am 22.10.2026 (R04). Demo-Regel für inländische Standardleistungen; steuerliche Sonderfälle und betriebliche Freigabe offen.' };
  }
  if (km <= 0n) return fail('ZERO_DISTANCE', 'Eine Personenfahrt benötigt mehr als 0 Besetztkilometer.');
  if (input.vehicle !== 'taxi') return fail('RENTAL_TAX_UNVERIFIED', 'Für Mietwagen-/Krankenfahrten ist eine gesondert bestätigte steuerliche Regel erforderlich. Keine automatische Steuersatzwahl.');
  const source = '§ 12 Abs. 2 Nr. 10 UStG; https://www.gesetze-im-internet.de/ustg_1980/__12.html; amtlicher Text abgerufen am 22.10.2026 (R04). Demo-Regel für inländischen, qualifizierten Taxiverkehr; steuerliche Sonderfälle und betriebliche Freigabe offen.';
  if (input.sameMunicipality === true) return { rate: 7, reason: '7 %: qualifizierter Taxiverkehr vollständig innerhalb einer Gemeinde.', ruleId: 'DE-2026-USTG12-2-10-MUNICIPALITY', source };
  if (km <= 5000n) return { rate: 7, reason: '7 %: qualifizierter Taxiverkehr mit höchstens 50 Besetztkilometern.', ruleId: 'DE-2026-USTG12-2-10-50KM', source };
  if (input.sameMunicipality !== false) return fail('MUNICIPALITY_REQUIRED', 'Bei mehr als 50 km bitte bestätigen, ob die Fahrt vollständig innerhalb einer Gemeinde liegt.');
  return { rate: 19, reason: '19 %: Taxiverkehr über 50 km und über eine Gemeindegrenze.', ruleId: 'DE-2026-USTG12-1-TAXI-LONG', source: '§ 12 Abs. 1, Abs. 2 Nr. 10 UStG; https://www.gesetze-im-internet.de/ustg_1980/__12.html; amtlicher Text abgerufen am 22.10.2026 (R04). Demo-Regel für inländische Standardleistungen; steuerliche Sonderfälle und betriebliche Freigabe offen.' };
}

/** Round once per gross invoice line, commercial half-up, then derive tax as exact residual. */
export function splitGross(grossCents: number, taxRate: 7 | 19): { netCents: number; taxCents: number } {
  if (!Number.isSafeInteger(grossCents) || grossCents <= 0) return fail('INVALID_AMOUNT', 'Der Bruttobetrag muss eine positive ganze Centzahl sein.');
  if (taxRate !== 7 && taxRate !== 19) return fail('UNSUPPORTED_TAX_RATE', 'Für diesen Steuersatz fehlt eine bestätigte Regel.');
  const denominator = 100n + BigInt(taxRate);
  const numerator = BigInt(grossCents) * 100n;
  const net = (numerator + denominator / 2n) / denominator;
  return { netCents: safeNumber(net), taxCents: safeNumber(BigInt(grossCents) - net) };
}
export function calculateInvoiceLine(journey: Journey): InvoiceLine {
  if (typeof journey.description !== 'string' || journey.description.trim().length === 0) return fail('DESCRIPTION_REQUIRED', 'Bitte eine Leistungsbeschreibung eingeben.');
  if (journey.description.length > 500) return fail('DESCRIPTION_TOO_LONG', 'Leistungsbeschreibung darf höchstens 500 Zeichen enthalten.');
  if (journey.description.split(/\r\n|[\r\n\u2028\u2029]/u).length > 20) return fail('DESCRIPTION_LINES_EXCEEDED', 'Leistungsbeschreibung darf höchstens 20 Zeilen enthalten. Bitte zusätzliche Details getrennt dokumentieren.');
  const tax = calculateTax(journey);
  let grossCents = journey.grossCents;
  let positions: InvoiceLine['positions'];
  let tariffSource: string | undefined;
  let tariffRevision: string | undefined;
  if (journey.kind === 'medical') {
    if (journey.prescriptionConfirmed !== true) return fail('PRESCRIPTION_UNCONFIRMED', 'Für die Krankenfahrt fehlt die bestätigte Verordnung/Genehmigungsprüfung.');
    if (journey.tariff !== 'I' && journey.tariff !== 'II') return fail('TARIFF_REQUIRED', 'Bitte den nachgewiesenen Tarif der Krankenfahrt wählen.');
    const quote = calculateTariff({ article: journey.tariff, km: journey.km, date: journey.date, persons: 1, contractConfirmed: journey.contractConfirmed });
    if (grossCents !== quote.grossCents) return fail('TARIFF_AMOUNT_MISMATCH', 'Der gespeicherte Betrag stimmt nicht mit dem belegten Tarif überein. Bitte die Fahrt prüfen.');
    grossCents = quote.grossCents;
    positions = quote.positions.map(({ code, label, quantity, unitCents, totalCents, source }) => ({ code, label, quantity, unitCents, totalCents, source }));
    tariffSource = quote.source;
    tariffRevision = `T&M-${journey.tariff}-2026-01-01-demo-policy-2026`;
  }
  const { netCents, taxCents } = splitGross(grossCents, tax.rate);
  return { journeyId: journey.id, description: journey.description, serviceDate: journey.date, grossCents, netCents, taxCents, taxRate: tax.rate, taxReason: tax.reason,
    taxRuleId: tax.ruleId, taxSource: tax.source, calculationKm: journey.km,
    ...(positions ? { positions, tariffSource, tariffRevision } : {}) };
}
