import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  calculateInvoiceLine,
  calculateTaxPreview,
  calculateTariff,
  parseDistance,
} from "../src/domain/index.js";
import type {
  BillingCase,
  BillingCaseInput,
  BillingCaseJourneyInput,
  Journey,
} from "../src/shared/types.js";

const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Bitte ein Kalenderdatum eingeben.")
  .refine((value) => {
    const date = new Date(value + "T12:00:00Z");
    return (
      Number.isFinite(date.valueOf()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Ungültiges Kalenderdatum.");
const shortText = (max: number) =>
  z
    .string()
    .trim()
    .min(1, "Dieses Feld darf nicht leer sein.")
    .max(max)
    .refine(
      (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
      "Steuerzeichen sind nicht erlaubt.",
    );
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || undefined)
    .optional();
const optionalDate = calendarDate.optional();
const insuredSchema = z
  .object({
    name: shortText(160),
    address: shortText(600),
    insuranceNumber: optionalText(64),
    dateOfBirth: optionalDate,
  })
  .strict();
const prescriptionSchema = z
  .object({
    number: z.string().trim().max(100).default(""),
    issuedAt: calendarDate,
    validFrom: optionalDate,
    validTo: optionalDate,
    confirmed: z.boolean(),
  })
  .strict()
  .refine(
    (value) =>
      !value.validFrom || !value.validTo || value.validFrom <= value.validTo,
    {
      message:
        "Der Beginn der angegebenen Gültigkeit darf nicht nach dem Ende liegen.",
      path: ["validTo"],
    },
  );
export const billingCaseJourneySchema = z
  .object({
    date: calendarDate,
    from: shortText(200),
    to: shortText(200),
    km: z
      .string()
      .regex(
        /^\d{1,4}(?:[.,]\d{1,2})?$/,
        "Kilometer mit höchstens zwei Nachkommastellen eingeben.",
      )
      .refine((value) => {
        const n = Number(value.replace(",", "."));
        return n > 0 && n <= 2000;
      }, "Kilometer müssen größer als 0 und höchstens 2.000 sein."),
    direction: z.enum(["outbound", "return"]),
    receiptNumber: optionalText(50),
  })
  .strict();
const commonShape = {
  insured: insuredSchema,
  prescription: prescriptionSchema,
  tariff: z.enum(["I", "II"]),
  contractConfirmed: z.boolean(),
  vehicle: z.enum(["taxi", "rental"]),
  sameMunicipality: z.boolean().nullable(),
  journeys: z
    .array(billingCaseJourneySchema)
    .min(1, "Mindestens ein Fahrtdatum ist erforderlich.")
    .max(20, "Ein Abrechnungsfall darf höchstens 20 Einzelfahrten enthalten."),
};
/** Only payerId crosses the public boundary. Its trusted registry snapshot is resolved by the API. */
export const billingCaseRequestSchema = z
  .object({ ...commonShape, sameMunicipality:z.null().default(null), payerId: shortText(160) })
  .strict();
const payerSchema = z.object({
  id: shortText(160),
  name: shortText(200),
  ik: z
    .string()
    .regex(/^\d{9}$/, "Das Kassen-IK muss aus neun Ziffern bestehen.")
    .nullable(),
  address: shortText(600).nullable(),
  invoiceReady: z.boolean().optional(),
  isSynthetic: z.boolean().optional(),
  addressKind: z
    .enum(["headquarters", "billing", "contact", "missing", "synthetic"])
    .optional(),
  sourceUrl: z.string().url().max(2000).optional(),
  sourceDate: calendarDate.optional(),
  ikStatus: z
    .enum(["source-verified", "reference-only", "missing", "synthetic"])
    .optional(),
  addressStatus: z.enum(["source-verified", "missing", "synthetic"]).optional(),
  routingVerified: z.boolean().optional(),
});
export const billingCaseInputSchema = z
  .object({ ...commonShape, payer: payerSchema })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.insured.dateOfBirth &&
      value.insured.dateOfBirth > value.prescription.issuedAt
    )
      ctx.addIssue({
        code: "custom",
        path: ["insured", "dateOfBirth"],
        message:
          "Das Geburtsdatum darf nicht nach dem Verordnungsdatum liegen.",
      });
  });
export function validateBillingCaseInput(value: unknown): BillingCaseInput {
  return billingCaseInputSchema.parse(value);
}
export function billingCaseInputFromRecord(
  item: BillingCase,
): BillingCaseInput {
  return {
    payer: item.payer,
    insured: item.insured,
    prescription: item.prescription,
    tariff: item.tariff,
    contractConfirmed: item.contractConfirmed,
    vehicle: item.vehicle,
    sameMunicipality: item.sameMunicipality,
    journeys: item.journeys.map(
      ({ date, from, to, km, direction, receiptNumber }) => ({
        date,
        from,
        to,
        km,
        direction,
        receiptNumber,
      }),
    ),
  };
}
export function insuredPersonKey(insured: BillingCaseInput["insured"]) {
  const normal = (value: string) =>
    value
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase("de-DE");
  const key = insured.insuranceNumber
    ? ["insurance", normal(insured.insuranceNumber)]
    : ["name", normal(insured.name), insured.dateOfBirth || ""];
  return createHash("sha256").update(JSON.stringify(key)).digest("hex");
}
export function billingCaseBlockers(
  input: BillingCaseInput,
  businessDate: string,
): string[] {
  const blockers: string[] = [];
  if(input.journeys.length>20)blockers.push('Ein Abrechnungsfall darf höchstens 20 Einzelfahrten enthalten. Bitte die Termine auf getrennte Verordnungsfälle prüfen.');
  if(input.vehicle==='taxi'&&input.sameMunicipality===null&&input.journeys.some(j=>parseDistance(j.km)>5000))blockers.push('Bei einer Fahrt über 50 km ist die automatische Prüfung der gesetzlichen Gemeinde-Ausnahme noch unvollständig. Die angezeigte 19-%-Berechnung ist vorläufig; eine Rechnung wird daraus noch nicht erstellt.');
  if (!input.payer.ik)
    blockers.push("Das Kassen-IK fehlt im geprüften Register.");
  if (!input.payer.address)
    blockers.push("Die Abrechnungsanschrift der Kasse fehlt.");
  if (input.payer.invoiceReady !== true)
    blockers.push(
      "Für diese Kasse sind passende Abrechnungs-IK und Abrechnungsanschrift noch nicht freigegeben. Hauptsitz- oder Referenzdaten allein reichen nicht aus.",
    );
  if (!input.contractConfirmed)
    blockers.push(
      "Die eigene Vertragsberechtigung für diesen Tarif ist noch nicht bestätigt.",
    );
  if (!input.prescription.confirmed)
    blockers.push(
      "Die gemeinsame Verordnung und erforderliche Genehmigungsprüfung sind noch nicht bestätigt.",
    );
  if (input.journeys.some((j) => j.date < input.prescription.issuedAt))
    blockers.push(
      "Mindestens ein Fahrtdatum liegt vor dem angegebenen Verordnungsdatum. Die Voraussetzungen sind gesondert zu prüfen.",
    );
  if (
    input.prescription.validFrom &&
    input.journeys.some((j) => j.date < input.prescription.validFrom!)
  )
    blockers.push(
      "Mindestens eine Fahrt liegt vor dem angegebenen Gültigkeitsbeginn.",
    );
  if (
    input.prescription.validTo &&
    input.journeys.some((j) => j.date > input.prescription.validTo!)
  )
    blockers.push(
      "Mindestens eine Fahrt liegt nach dem angegebenen Gültigkeitsende.",
    );
  if (input.journeys.some((j) => j.date > businessDate))
    blockers.push(
      "Zukünftige Fahrttermine können noch nicht abgerechnet werden.",
    );
  return blockers;
}
export function buildBillingCase(
  input: BillingCaseInput,
  options: {
    id: string;
    number: string;
    customerId: string;
    createdAt: string;
    updatedAt: string;
    businessDate: string;
  },
): { billingCase: BillingCase; journeys: Journey[] } {
  const previewLine=(journey:Journey)=>{
    const tax=calculateTaxPreview(journey);
    const line=calculateInvoiceLine({...journey,sameMunicipality:tax.pending?false:journey.sameMunicipality,contractConfirmed:true,prescriptionConfirmed:true});
    return {line,taxPending:tax.pending};
  };
  const personKey = insuredPersonKey(input.insured);
  const journeys: Journey[] = input.journeys.map((row, index) => {
    const quote = calculateTariff({
      article: input.tariff,
      km: row.km,
      date: row.date,
      persons: 1,
      contractConfirmed: true,
    });
    const reference = options.number + "/" + String(index + 1).padStart(3, "0");
    // This is an internal trip reference. It never substitutes for an official receipt.
    const description = `${options.number} · ${input.insured.name}\n${row.direction === "return" ? "Rückfahrt" : "Hinfahrt"} · ${row.from} → ${row.to}`;
    const journey: Journey = {
      id: randomUUID(),
      customerId: options.customerId,
      kind: "medical",
      date: row.date,
      from: row.from,
      to: row.to,
      km: row.km,
      vehicle: input.vehicle,
      sameMunicipality: input.sameMunicipality,
      grossCents: quote.grossCents,
      description,
      tariff: input.tariff,
      contractConfirmed: input.contractConfirmed,
      prescriptionConfirmed: input.prescription.confirmed,
      receiptNumber: row.receiptNumber || null,
      invoiceId: null,
      createdAt: options.updatedAt,
      billingCaseId: options.id,
      insuredPersonKey: personKey,
      internalReference: reference,
      direction: row.direction,
    };
    // Validate the supported arithmetic even for a draft; entitlement confirmations stay separate.
    previewLine(journey);
    return journey;
  });
  const summaries = journeys.map((journey, index) => {
    const {line,taxPending}=previewLine(journey);
    return {
      ...input.journeys[index],
      id: journey.id,
      internalReference: journey.internalReference!,
      grossCents: line.grossCents,
      netCents: line.netCents,
      taxCents: line.taxCents,
      taxRate: line.taxRate,
      taxPending,
      positions: line.positions,
    };
  });
  const blockers = billingCaseBlockers(input, options.businessDate);
  const billingCase: BillingCase = {
    ...input,
    ...options,
    journeyIds: journeys.map((j) => j.id),
    journeys: summaries,
    invoiceId: null,
    status: blockers.length ? "draft" : "ready",
    blockers,
    grossCents: summaries.reduce((n, j) => n + j.grossCents, 0),
    netCents: summaries.reduce((n, j) => n + j.netCents, 0),
    taxCents: summaries.reduce((n, j) => n + j.taxCents, 0),
  };
  // businessDate is a calculation context, not persisted patient/case data.
  delete (billingCase as BillingCase & { businessDate?: string }).businessDate;
  return { billingCase, journeys };
}
/** Canonical identity of one actual trip, used to reject duplicates within a submitted date list. */
export function caseJourneyKey(row: BillingCaseJourneyInput) {
  const normal = (value: string) =>
    value
      .normalize("NFC")
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase("de-DE");
  return JSON.stringify([
    row.date,
    normal(row.from),
    normal(row.to),
    String(parseDistance(row.km)),
  ]);
}
