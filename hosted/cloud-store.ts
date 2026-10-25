import { z } from "zod";
import {
  calculateInvoiceLine,
  calculateTariff,
  addCalendarDays,
  parseDistance,
  assertDate,
} from "../src/domain/index.js";
import {
  validateBillingCaseInput,
  buildBillingCase,
  billingCaseBlockers,
  billingCaseInputFromRecord,
  caseJourneyKey,
} from "../server/billing-case.js";
import type {
  AppState,
  Customer,
  Journey,
  Invoice,
  Payment,
  DtaCheck,
  AuditEvent,
  BillingCase,
  BillingCaseInput,
  BillingCasePayer,
} from "../src/shared/types.js";
import { renderCloudInvoicePdf } from "./cloud-pdf.js";

export interface CloudRecord {
  revision: number;
  payload: string;
}
/** CAS is one atomic database statement. A null expectedRevision means insert-if-absent, starting at revision 1. */
export interface CloudRepository {
  read(scope: string): Promise<CloudRecord | null>;
  compareAndSwap(
    scope: string,
    expectedRevision: number | null,
    payload: string,
  ): Promise<boolean>;
}
export class CloudStoreError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "CLOUD_STORE_ERROR",
  ) {
    super(message);
    this.name = "CloudStoreError";
  }
}
export interface CloudStoreOptions {
  financialStorage?: 'cloud-d1'|'cloud-supabase';
  businessDate?: string;
  now?: () => string;
  uuid?: () => string;
  renderPdf?: (
    invoice: Invoice,
    referenceNumber?: string,
  ) => Promise<Uint8Array>;
  maxPayloadBytes?: number;
}
type CustomerInput = Omit<Customer, "id" | "createdAt">;
type JourneyInput = Omit<Journey, "id" | "createdAt" | "invoiceId">;
type PaymentInput = Omit<Payment, "id" | "createdAt">;
interface Command {
  key: string;
  requestHash: string;
  entityId: string;
}
interface PdfArchive {
  invoiceId: string;
  base64: string;
  sha256: string;
}
interface Cancellation {
  invoiceId: string;
  creditId: string;
  reason: string;
  at: string;
}
interface Payload {
  schema: 1;
  scopeHash: string;
  businessDate: string;
  customers: Customer[];
  journeys: Journey[];
  invoices: Invoice[];
  billingCases: BillingCase[];
  dtaChecks: DtaCheck[];
  audit: AuditEvent[];
  pdfs: PdfArchive[];
  casePayers: { payerId: string; customerId: string }[];
  caseCommands: Command[];
  invoiceCommands: Command[];
  paymentCommands: Command[];
  cancellations: Cancellation[];
  counters: { year: string; value: number }[];
}
interface Loaded {
  revision: number | null;
  data: Payload;
}
const MAX_PAYLOAD_BYTES = 1_900_000;
const now = () => new Date().toISOString();
const encoder = new TextEncoder();
const sha256 = async (value: string | Uint8Array) => {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
};
const base64 = (bytes: Uint8Array) => {
  let result = "";
  for (let i = 0; i < bytes.length; i += 8192)
    result += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(result);
};
const unbase64 = (value: string) =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
const copy = <T>(value: T): T => structuredClone(value);
const invalid = (message: string): never => {
  throw new CloudStoreError(422, message, "VALIDATION_ERROR");
};
const notFound = (label: string): never => {
  throw new CloudStoreError(404, `${label} nicht gefunden.`, "NOT_FOUND");
};
const conflict = (
  message = "Der Zustand wurde zwischenzeitlich geändert. Bitte neu laden und den Vorgang prüfen.",
): never => {
  throw new CloudStoreError(409, message, "REVISION_CONFLICT");
};
const normalized = (value: string) =>
  value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
const shortText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
    );
const anyCalendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const d = new Date(value + "T12:00:00Z");
    return (
      Number.isFinite(d.valueOf()) && d.toISOString().slice(0, 10) === value
    );
  });
// Reading archived records survives a year change; new financial dates remain
// limited to the explicitly implemented tariff/tax rule year.
const calendarDate = anyCalendarDate.refine(
  (value) => value.startsWith("2026-"),
  "Für dieses Leistungs-/Rechnungsdatum ist noch keine geprüfte Regel hinterlegt.",
);
const customerInputSchema = z
  .object({
    name: shortText(160),
    kind: z.enum(["private", "business", "laboratory", "payer"]),
    address: shortText(600),
    reference: z.string().trim().max(100).optional(),
  })
  .strict();
const journeyInputSchema = z
  .object({
    customerId: z.string().uuid(),
    kind: z.enum(["taxi", "medical", "courier", "laboratory"]),
    date: calendarDate,
    from: shortText(200),
    to: shortText(200),
    km: z
      .string()
      .regex(/^\d{1,4}(?:[.,]\d{1,2})?$/)
      .refine(
        (value) =>
          Number(value.replace(",", ".")) > 0 &&
          Number(value.replace(",", ".")) <= 2000,
      ),
    vehicle: z.enum(["taxi", "rental"]),
    sameMunicipality: z.boolean().nullable(),
    grossCents: z.number().int().min(1).max(100_000_000),
    description: shortText(500).refine(
      (value) => value.split(/\r\n|[\r\n\u2028\u2029]/u).length <= 20,
    ),
    tariff: z.enum(["I", "II"]).nullable(),
    contractConfirmed: z.boolean(),
    prescriptionConfirmed: z.boolean(),
    receiptNumber: shortText(50).nullable(),
  })
  .strict();
const paymentInputSchema = z
  .object({
    amountCents: z.number().int().min(1).max(100_000_000),
    date: calendarDate,
    note: z.string().trim().max(200).default(""),
  })
  .strict();
const envelopeSchema = z
  .object({
    schema: z.literal(1),
    scopeHash: z.string().regex(/^[a-f0-9]{64}$/),
    businessDate: anyCalendarDate,
    customers: z.array(z.object({ id: z.string().uuid() }).passthrough()),
    journeys: z.array(z.object({ id: z.string().uuid() }).passthrough()),
    invoices: z.array(z.object({ id: z.string().uuid() }).passthrough()),
    billingCases: z.array(z.object({ id: z.string().uuid() }).passthrough()),
    dtaChecks: z.array(z.object({ id: z.string().uuid() }).passthrough()),
    audit: z.array(
      z
        .object({
          id: z.number().int().positive(),
          action: z.string(),
          entityId: z.string(),
          at: z.string(),
          previousHash: z.string().regex(/^[a-f0-9]{64}$/),
          hash: z.string().regex(/^[a-f0-9]{64}$/),
          details: z.string(),
        })
        .strict(),
    ),
    pdfs: z.array(
      z
        .object({
          invoiceId: z.string().uuid(),
          base64: z.string(),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
        })
        .strict(),
    ),
    casePayers: z.array(
      z.object({ payerId: z.string(), customerId: z.string().uuid() }).strict(),
    ),
    caseCommands: z.array(
      z
        .object({
          key: z.string(),
          requestHash: z.string(),
          entityId: z.string().uuid(),
        })
        .strict(),
    ),
    invoiceCommands: z.array(
      z
        .object({
          key: z.string(),
          requestHash: z.string(),
          entityId: z.string().uuid(),
        })
        .strict(),
    ),
    paymentCommands: z.array(
      z
        .object({
          key: z.string(),
          requestHash: z.string(),
          entityId: z.string().uuid(),
        })
        .strict(),
    ),
    cancellations: z.array(
      z
        .object({
          invoiceId: z.string().uuid(),
          creditId: z.string().uuid(),
          reason: z.string(),
          at: z.string(),
        })
        .strict(),
    ),
    counters: z.array(
      z
        .object({
          year: z.string().regex(/^2026$/),
          value: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();

/** Synthetic-only persistent state. Callers must authenticate and select scope from trusted server identity. */
export class CloudStore {
  private readonly financialStorage:'cloud-d1'|'cloud-supabase';
  readonly businessDate: string;
  private readonly timestamp: () => string;
  private readonly uuid: () => string;
  private readonly renderPdf: (
    invoice: Invoice,
    referenceNumber?: string,
  ) => Promise<Uint8Array>;
  private readonly maxBytes: number;
  constructor(
    private readonly repository: CloudRepository,
    options: CloudStoreOptions = {},
  ) {
    this.financialStorage=options.financialStorage??'cloud-d1';
    this.timestamp = options.now ?? now;
    this.businessDate = anyCalendarDate.parse(
      options.businessDate ??
        new Intl.DateTimeFormat("sv-SE", {
          timeZone: "Europe/Berlin",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(this.timestamp())),
    );
    this.uuid = options.uuid ?? (() => crypto.randomUUID());
    this.renderPdf = options.renderPdf ?? renderCloudInvoicePdf;
    this.maxBytes = Math.min(
      options.maxPayloadBytes ?? MAX_PAYLOAD_BYTES,
      MAX_PAYLOAD_BYTES,
    );
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1000)
      throw new Error("Invalid cloud payload limit.");
  }
  private scope(value: string) {
    if (
      typeof value !== "string" ||
      value.length < 1 ||
      value.length > 200 ||
      /[\u0000-\u0020\u007f]/.test(value)
    )
      throw new CloudStoreError(
        403,
        "Eine bestätigte serverseitige Benutzeridentität ist erforderlich.",
        "IDENTITY_REQUIRED",
      );
    return value;
  }
  private async load(scope: string): Promise<Loaded> {
    this.scope(scope);
    const scopeHash = await sha256(scope);
    const row = await this.repository.read(scope);
    if (row === null)
      return {
        revision: null,
        data: {
          schema: 1,
          scopeHash,
          businessDate: this.businessDate,
          customers: [],
          journeys: [],
          invoices: [],
          billingCases: [],
          dtaChecks: [],
          audit: [],
          pdfs: [],
          casePayers: [],
          caseCommands: [],
          invoiceCommands: [],
          paymentCommands: [],
          cancellations: [],
          counters: [],
        },
      };
    if (
      !Number.isSafeInteger(row.revision) ||
      row.revision < 1 ||
      typeof row.payload !== "string" ||
      encoder.encode(row.payload).length > MAX_PAYLOAD_BYTES
    )
      throw new CloudStoreError(
        503,
        "Der gespeicherte Cloud-Zustand ist ungültig.",
        "STORAGE_INTEGRITY",
      );
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload);
    } catch {
      throw new CloudStoreError(
        503,
        "Der gespeicherte Cloud-Zustand ist nicht lesbar.",
        "STORAGE_INTEGRITY",
      );
    }
    const result = envelopeSchema.safeParse(parsed);
    if (!result.success || result.data.scopeHash !== scopeHash)
      throw new CloudStoreError(
        503,
        "Der gespeicherte Cloud-Zustand passt nicht zur bestätigten Identität oder Regelversion.",
        "STORAGE_INTEGRITY",
      );
    const data = result.data as unknown as Payload;
    if (!(await this.verifyAuditData(data)))
      throw new CloudStoreError(
        503,
        "Die Integritätsprüfung des technischen Journals ist fehlgeschlagen.",
        "STORAGE_INTEGRITY",
      );
    return { revision: row.revision, data };
  }
  private async commit(scope: string, loaded: Loaded) {
    // Operation context, not an immutable schema-version or archive field.
    loaded.data.businessDate = this.businessDate;
    const payload = JSON.stringify(loaded.data);
    if (encoder.encode(payload).length > this.maxBytes)
      throw new CloudStoreError(
        413,
        "Der synthetische Cloud-Speicher ist für diesen Datensatz voll. Es wurde nichts abgeschlossen.",
        "STORAGE_LIMIT",
      );
    if (
      !(await this.repository.compareAndSwap(scope, loaded.revision, payload))
    )
      conflict();
    loaded.revision = (loaded.revision ?? 0) + 1;
  }
  private command(value: string | undefined) {
    if (value !== undefined && !/^[A-Za-z0-9_-]{8,100}$/.test(value))
      invalid("Ungültige Vorgangskennung.");
    return value;
  }
  private async appendAudit(
    data: Payload,
    action: string,
    entityId: string,
    details: Record<string, unknown> = {},
  ) {
    const event: AuditEvent = {
      id: (data.audit.at(-1)?.id ?? 0) + 1,
      action,
      entityId,
      at: this.timestamp(),
      previousHash: data.audit.at(-1)?.hash ?? "0".repeat(64),
      hash: "",
      details: JSON.stringify(details),
    };
    event.hash = await sha256(
      JSON.stringify({
        action,
        eventId: event.id,
        entityId,
        at: event.at,
        previousHash: event.previousHash,
        details: event.details,
      }),
    );
    data.audit.push(event);
  }
  private async verifyAuditData(data: Payload) {
    let previous = "0".repeat(64),
      id = 0;
    for (const event of data.audit) {
      if (
        event.id !== id + 1 ||
        event.previousHash !== previous ||
        event.hash !==
          (await sha256(
            JSON.stringify({
              action: event.action,
              eventId: event.id,
              entityId: event.entityId,
              at: event.at,
              previousHash: previous,
              details: event.details,
            }),
          ))
      )
        return false;
      previous = event.hash;
      id = event.id;
    }
    return true;
  }
  async verifyAudit(scope: string) {
    return this.verifyAuditData((await this.load(scope)).data);
  }
  private invoiceFrom(data: Payload, id: string): Invoice {
    const invoice =
      data.invoices.find((row) => row.id === id) ?? notFound("Rechnung");
    const cancellation = data.cancellations.find((row) => row.invoiceId === id);
    return {
      ...copy(invoice),
      status: cancellation ? "cancelled" : invoice.status,
      cancelledBy: cancellation?.creditId ?? null,
    };
  }
  private caseFrom(data: Payload, id: string): BillingCase {
    const item =
      data.billingCases.find((row) => row.id === id) ??
      notFound("Abrechnungsfall");
    const blockers = item.invoiceId
      ? item.blockers
      : billingCaseBlockers(
          billingCaseInputFromRecord(item),
          this.businessDate,
        );
    return {
      ...copy(item),
      blockers: copy(blockers),
      status: item.invoiceId ? "invoiced" : blockers.length ? "draft" : "ready",
    };
  }
  async state(scope: string): Promise<AppState> {
    const { data } = await this.load(scope);
    return {
      customers: copy(data.customers),
      journeys: copy(data.journeys),
      invoices: [...data.invoices]
        .reverse()
        .map((row) => this.invoiceFrom(data, row.id)),
      billingCases: data.billingCases.map((row) => this.caseFrom(data, row.id)),
      dtaChecks: copy([...data.dtaChecks].reverse()),
      audit: copy([...data.audit].reverse().slice(0, 200)),
      csrfToken: "",
      mode: "demo",
      businessDate: this.businessDate,
      version: "0.3.0-cloud-test",
      deployment: {
        kind: "site-private",
        financialStorage: this.financialStorage,
        ownerOnly: true,
        syntheticOnly: true,
      },
    };
  }
  async invoice(scope: string, id: string) {
    return this.invoiceFrom((await this.load(scope)).data, id);
  }
  async billingCase(scope: string, id: string) {
    return this.caseFrom((await this.load(scope)).data, id);
  }
  async addCustomer(scope: string, value: CustomerInput): Promise<Customer> {
    const input = customerInputSchema.parse(value);
    const loaded = await this.load(scope);
    const customer: Customer = {
      ...input,
      id: this.uuid(),
      createdAt: this.timestamp(),
    };
    loaded.data.customers.push(customer);
    await this.appendAudit(loaded.data, "customer.created", customer.id, {
      kind: customer.kind,
    });
    await this.commit(scope, loaded);
    return copy(customer);
  }
  async updateCustomer(
    scope: string,
    id: string,
    value: CustomerInput,
  ): Promise<Customer> {
    const input = customerInputSchema.parse(value);
    const loaded = await this.load(scope);
    const current =
      loaded.data.customers.find((row) => row.id === id) ?? notFound("Kunde");
    if (loaded.data.casePayers.some((row) => row.customerId === id))
      conflict(
        "Kassen-Stammdaten werden über die geprüfte Fallzuordnung geführt.",
      );
    const updated = { ...input, id: current.id, createdAt: current.createdAt };
    if (JSON.stringify(updated) === JSON.stringify(current))
      return copy(current);
    loaded.data.customers[loaded.data.customers.indexOf(current)] = updated;
    await this.appendAudit(loaded.data, "customer.updated", id);
    await this.commit(scope, loaded);
    return copy(updated);
  }
  private prepareJourney(data: Payload, value: JourneyInput): JourneyInput {
    const input = journeyInputSchema.parse(value);
    const customer =
      data.customers.find((row) => row.id === input.customerId) ??
      notFound("Kunde");
    if (data.casePayers.some((row) => row.customerId === customer.id))
      invalid(
        "Registerkassen werden ausschließlich über einen vollständigen Abrechnungsfall mit Verordnung erfasst.",
      );
    if (input.kind === "medical" && customer.kind !== "payer")
      invalid(
        "Krankenfahrten benötigen einen getrennten fiktiven Kostenträger.",
      );
    if (input.kind !== "medical" && customer.kind === "payer")
      invalid(
        "Normale Aufträge werden Privat-, Firmen- oder Laborkunden zugeordnet.",
      );
    let grossCents = input.grossCents;
    if (input.kind === "medical") {
      if (!input.tariff) invalid("Bitte Art. I oder II auswählen.");
      if (input.contractConfirmed)
        grossCents = calculateTariff({
          article: input.tariff!,
          km: input.km,
          date: input.date,
          persons: 1,
          contractConfirmed: true,
        }).grossCents;
    } else if (input.tariff !== null)
      invalid("Normale Aufträge haben keinen Krankenfahrten-Tarif.");
    return { ...input, grossCents };
  }
  private assertUnique(data: Payload, input: JourneyInput, excludeId?: string) {
    const rows = data.journeys.filter((row) => row.id !== excludeId);
    if (
      input.receiptNumber &&
      rows.some((row) => row.receiptNumber === input.receiptNumber)
    )
      conflict("Diese Belegnummer wurde bereits vergeben.");
    if (
      rows.some(
        (row) =>
          row.customerId === input.customerId &&
          row.date === input.date &&
          normalized(row.from) === normalized(input.from) &&
          normalized(row.to) === normalized(input.to) &&
          parseDistance(row.km) === parseDistance(input.km) &&
          row.kind === input.kind &&
          (input.billingCaseId
            ? row.insuredPersonKey === input.insuredPersonKey
            : !row.billingCaseId),
      )
    )
      conflict(
        "Mögliche doppelte Fahrt: Kunde, Datum, Strecke und Kilometer stimmen überein. Bitte vorhandene Fahrt prüfen.",
      );
  }
  async addJourney(scope: string, value: JourneyInput): Promise<Journey> {
    const loaded = await this.load(scope);
    const input = this.prepareJourney(loaded.data, value);
    this.assertUnique(loaded.data, input);
    const journey: Journey = {
      ...input,
      id: this.uuid(),
      createdAt: this.timestamp(),
      invoiceId: null,
    };
    loaded.data.journeys.push(journey);
    await this.appendAudit(loaded.data, "journey.created", journey.id, {
      kind: journey.kind,
    });
    await this.commit(scope, loaded);
    return copy(journey);
  }
  async updateJourney(
    scope: string,
    id: string,
    value: JourneyInput,
  ): Promise<Journey> {
    const loaded = await this.load(scope);
    const current =
      loaded.data.journeys.find((row) => row.id === id) ?? notFound("Fahrt");
    if (current.invoiceId)
      conflict(
        "Bereits abgerechnete Fahrten bleiben auch nach Storno unveränderlich.",
      );
    if (current.billingCaseId)
      conflict(
        "Diese Fahrt gehört zu einer gemeinsamen Verordnung. Bitte den Abrechnungsfall bearbeiten.",
      );
    const input = this.prepareJourney(loaded.data, value);
    this.assertUnique(loaded.data, input, id);
    const updated = {
      ...current,
      ...input,
      id: current.id,
      createdAt: current.createdAt,
      invoiceId: null,
    };
    if (JSON.stringify(updated) === JSON.stringify(current))
      return copy(current);
    loaded.data.journeys[loaded.data.journeys.indexOf(current)] = updated;
    await this.appendAudit(loaded.data, "journey.updated", id, {
      changedFields: Object.keys(input).filter(
        (key) =>
          current[key as keyof Journey] !== updated[key as keyof Journey],
      ),
    });
    await this.commit(scope, loaded);
    return copy(updated);
  }
  private async payerCustomer(data: Payload, payer: BillingCasePayer) {
    const link = data.casePayers.find((row) => row.payerId === payer.id);
    if (link)
      return (
        data.customers.find((row) => row.id === link.customerId) ??
        notFound("Kassenverknüpfung")
      );
    const customer: Customer = {
      id: this.uuid(),
      kind: "payer",
      name: payer.name,
      address: payer.address ?? "",
      reference: payer.ik ? `IK ${payer.ik}` : undefined,
      createdAt: this.timestamp(),
    };
    data.customers.push(customer);
    data.casePayers.push({ payerId: payer.id, customerId: customer.id });
    await this.appendAudit(data, "customer.created", customer.id, {
      kind: "payer",
      origin: "billing-case",
    });
    return customer;
  }
  private inputCase(value: BillingCaseInput) {
    const input = validateBillingCaseInput(value);
    if (
      new Set(input.journeys.map(caseJourneyKey)).size !== input.journeys.length
    )
      conflict(
        "Ein Fahrtdatum mit derselben Strecke und Kilometerzahl wurde im Fall doppelt erfasst.",
      );
    return input;
  }
  async addBillingCase(
    scope: string,
    value: BillingCaseInput,
    commandKey?: string,
  ): Promise<BillingCase> {
    const input = this.inputCase(value);
    this.command(commandKey);
    const requestHash = await sha256(JSON.stringify(input));
    const loaded = await this.load(scope);
    if (commandKey) {
      const command = loaded.data.caseCommands.find(
        (row) => row.key === commandKey,
      );
      if (command) {
        if (command.requestHash !== requestHash)
          conflict(
            "Diese Vorgangskennung gehört zu einem anderen Abrechnungsfall.",
          );
        return this.caseFrom(loaded.data, command.entityId);
      }
    }
    const customer = await this.payerCustomer(loaded.data, input.payer);
    const id = this.uuid(),
      at = this.timestamp();
    const { billingCase, journeys } = buildBillingCase(input, {
      id,
      number: `AF-${input.prescription.issuedAt.slice(0, 4)}-${id.slice(0, 8).toUpperCase()}`,
      customerId: customer.id,
      createdAt: at,
      updatedAt: at,
      businessDate: this.businessDate,
    });
    for (const journey of journeys) {
      this.assertUnique(loaded.data, journey);
      loaded.data.journeys.push(journey);
    }
    loaded.data.billingCases.push(billingCase);
    if (commandKey)
      loaded.data.caseCommands.push({
        key: commandKey,
        requestHash,
        entityId: id,
      });
    await this.appendAudit(loaded.data, "billing_case.created", id, {
      journeyCount: journeys.length,
      status: billingCase.status,
    });
    await this.commit(scope, loaded);
    return copy(billingCase);
  }
  async updateBillingCase(
    scope: string,
    id: string,
    value: BillingCaseInput,
  ): Promise<BillingCase> {
    const input = this.inputCase(value);
    const loaded = await this.load(scope);
    const current =
      loaded.data.billingCases.find((row) => row.id === id) ??
      notFound("Abrechnungsfall");
    if (
      current.invoiceId ||
      current.journeyIds.some(
        (journeyId) =>
          loaded.data.journeys.find((row) => row.id === journeyId)?.invoiceId,
      )
    )
      conflict(
        "Bereits abgerechnete Fälle bleiben auch nach Storno unveränderlich.",
      );
    if (
      JSON.stringify(validateBillingCaseInput(billingCaseInputFromRecord(current))) ===
      JSON.stringify(input)
    )
      return this.caseFrom(loaded.data, id);
    const customer = await this.payerCustomer(loaded.data, input.payer);
    const { billingCase, journeys } = buildBillingCase(input, {
      id,
      number: current.number,
      customerId: customer.id,
      createdAt: current.createdAt,
      updatedAt: this.timestamp(),
      businessDate: this.businessDate,
    });
    loaded.data.journeys = loaded.data.journeys.filter(
      (row) => !current.journeyIds.includes(row.id),
    );
    for (const journey of journeys) {
      this.assertUnique(loaded.data, journey);
      loaded.data.journeys.push(journey);
    }
    loaded.data.billingCases[loaded.data.billingCases.indexOf(current)] =
      billingCase;
    await this.appendAudit(loaded.data, "billing_case.updated", id, {
      journeyCount: journeys.length,
      status: billingCase.status,
    });
    await this.commit(scope, loaded);
    return copy(billingCase);
  }
  private async reserveNumber(scope: string, loaded: Loaded, date: string) {
    const year = date.slice(0, 4);
    let counter = loaded.data.counters.find((row) => row.year === year);
    if (!counter) {
      counter = { year, value: 0 };
      loaded.data.counters.push(counter);
    }
    counter.value++;
    if (!Number.isSafeInteger(counter.value))
      throw new CloudStoreError(
        503,
        "Der Nummernkreis ist erschöpft.",
        "NUMBER_LIMIT",
      );
    const number = `IT-${year}-${String(counter.value).padStart(6, "0")}`;
    await this.appendAudit(loaded.data, "invoice.number_reserved", number, {
      number,
    });
    await this.commit(scope, loaded);
    return number;
  }
  async issueCaseInvoice(
    scope: string,
    caseIds: string[],
    issuedAt: string,
    commandKey?: string,
  ): Promise<Invoice> {
    if (
      !Array.isArray(caseIds) ||
      caseIds.length < 1 ||
      caseIds.length > 500 ||
      new Set(caseIds).size !== caseIds.length
    )
      invalid("Bitte 1 bis 500 unterschiedliche Abrechnungsfälle auswählen.");
    const selectedCaseIds = [...caseIds];
    const loaded = await this.load(scope);
    const cases = selectedCaseIds.map((id) => this.caseFrom(loaded.data, id));
    const journeyIds = cases.flatMap((item) => item.journeyIds);
    if (journeyIds.length > 500)
      invalid(
        "Eine Sammelrechnung darf höchstens 500 einzelne Fahrten enthalten.",
      );
    return this.issueFromLoaded(
      scope,
      loaded,
      journeyIds,
      issuedAt,
      commandKey,
    );
  }
  async issueInvoice(
    scope: string,
    journeyIds: string[],
    issuedAt: string,
    commandKey?: string,
  ): Promise<Invoice> {
    if (!Array.isArray(journeyIds))
      invalid("Bitte die abzurechnenden Fahrten auswählen.");
    const selectedJourneyIds = [...journeyIds];
    return this.issueFromLoaded(
      scope,
      await this.load(scope),
      selectedJourneyIds,
      issuedAt,
      commandKey,
    );
  }
  private async issueFromLoaded(
    scope: string,
    loaded: Loaded,
    journeyIds: string[],
    issuedAt: string,
    commandKey?: string,
  ): Promise<Invoice> {
    calendarDate.parse(issuedAt);
    if (issuedAt > this.businessDate)
      invalid(
        "Das Rechnungsdatum darf nicht nach dem Geschäftstag der Demo liegen.",
      );
    this.command(commandKey);
    if (
      !Array.isArray(journeyIds) ||
      journeyIds.length < 1 ||
      journeyIds.length > 500 ||
      new Set(journeyIds).size !== journeyIds.length ||
      journeyIds.some((id) => typeof id !== "string")
    )
      invalid("Bitte 1 bis 500 unterschiedliche Fahrten auswählen.");
    const requestHash = await sha256(
      JSON.stringify({ journeyIds: [...journeyIds].sort(), issuedAt }),
    );
    if (commandKey) {
      const command = loaded.data.invoiceCommands.find(
        (row) => row.key === commandKey,
      );
      if (command) {
        if (command.requestHash !== requestHash)
          conflict("Diese Vorgangskennung gehört zu einer anderen Rechnung.");
        return this.invoiceFrom(loaded.data, command.entityId);
      }
    }
    const journeys = journeyIds.map((id) => {
      const journey =
        loaded.data.journeys.find((row) => row.id === id) ?? notFound("Fahrt");
      if (journey.invoiceId)
        conflict(
          "Eine Fahrt ist bereits abgerechnet und bleibt auch nach Storno gesperrt.",
        );
      if (journey.date > issuedAt)
        invalid(
          "Zukünftige Leistungen können hier noch nicht abgerechnet werden.",
        );
      return journey;
    });
    if (new Set(journeys.map((row) => row.customerId)).size !== 1)
      invalid("Eine Sammelrechnung gehört genau einem Rechnungsempfänger.");
    const medical = journeys.some((row) => row.kind === "medical");
    if (medical && journeys.some((row) => row.kind !== "medical"))
      invalid(
        "Kassen- und normale Leistungen können nicht auf einer Rechnung gemischt werden.",
      );
    if (
      medical &&
      journeys.some((row) => !row.billingCaseId) &&
      loaded.data.casePayers.some(
        (row) => row.customerId === journeys[0].customerId,
      )
    )
      invalid(
        "Registerkassen werden ausschließlich über vollständige Abrechnungsfälle abgerechnet.",
      );
    const caseIds = [
      ...new Set(
        journeys.flatMap((row) =>
          row.billingCaseId ? [row.billingCaseId] : [],
        ),
      ),
    ];
    const cases = caseIds.map((id) => this.caseFrom(loaded.data, id));
    for (const item of cases) {
      if (item.invoiceId)
        conflict(
          "Ein Abrechnungsfall wurde bereits abgerechnet und bleibt auch nach Storno gesperrt.",
        );
      if (item.journeyIds.some((id) => !journeyIds.includes(id)))
        invalid(
          "Ein Abrechnungsfall wird vollständig mit allen Fahrtterminen abgerechnet. Bitte den gesamten Fall auswählen.",
        );
      const blockers = billingCaseBlockers(
        billingCaseInputFromRecord(item),
        this.businessDate,
      );
      if (blockers.length)
        invalid("Abrechnungsfall noch unvollständig: " + blockers.join(" "));
    }
    if (
      new Set(
        cases.map((item) =>
          JSON.stringify({
            id: item.payer.id,
            ik: item.payer.ik,
            address: item.payer.address,
            name: item.payer.name,
          }),
        ),
      ).size > 1
    )
      invalid(
        "Die Kassen-Abrechnungsdaten der ausgewählten Fälle unterscheiden sich.",
      );
    for (const journey of journeys)
      if (
        journey.kind === "medical" &&
        (!journey.contractConfirmed ||
          !journey.prescriptionConfirmed ||
          (!journey.receiptNumber && !journey.billingCaseId))
      )
        invalid(
          "Krankenfahrt gesperrt: Vertragsberechtigung, Verordnung und eindeutige Belegnummer müssen bestätigt sein.",
        );
    const storedCustomer =
      loaded.data.customers.find((row) => row.id === journeys[0].customerId) ??
      notFound("Rechnungsempfänger");
    const customer: Customer = cases.length
      ? {
          ...storedCustomer,
          name: cases[0].payer.name,
          address: cases[0].payer.address!,
          reference: `IK ${cases[0].payer.ik}`,
        }
      : { ...storedCustomer };
    const lines = journeys.map((journey) => {
      const line = calculateInvoiceLine(journey),
        item = cases.find((row) => row.id === journey.billingCaseId);
      return item
        ? {
            ...line,
            billingCaseId: item.id,
            insuredName: item.insured.name,
            prescriptionReference: item.prescription.number || undefined,
          }
        : line;
    });
    const number = await this.reserveNumber(scope, loaded, issuedAt);
    const invoice: Invoice = {
      id: this.uuid(),
      number,
      customerId: customer.id,
      customerSnapshot: copy(customer),
      issuedAt,
      dueAt: addCalendarDays(issuedAt, 28),
      dueAtVerified: !medical,
      dueAtBasis: medical
        ? "Demo-Wiedervorlage nach 28 Tagen. Vertragliche Kassenfrist nicht verifiziert."
        : "28 Kalendertage gemäß konfigurierter Demo-Standardvereinbarung.",
      lines,
      grossCents: lines.reduce((n, row) => n + row.grossCents, 0),
      netCents: lines.reduce((n, row) => n + row.netCents, 0),
      taxCents: lines.reduce((n, row) => n + row.taxCents, 0),
      status: "issued",
      payments: [],
      cancelledBy: null,
      createdAt: this.timestamp(),
      pdfHash: "",
      originalInvoiceId: null,
      ...(cases.length
        ? { billingCaseIds: caseIds, billingCaseSnapshots: copy(cases) }
        : {}),
    };
    const pdf = await this.renderPdf(copy(invoice));
    invoice.pdfHash = await sha256(pdf);
    loaded.data.invoices.push(invoice);
    loaded.data.pdfs.push({
      invoiceId: invoice.id,
      base64: base64(pdf),
      sha256: invoice.pdfHash,
    });
    for (const journey of journeys) journey.invoiceId = invoice.id;
    for (const item of loaded.data.billingCases)
      if (caseIds.includes(item.id)) {
        item.invoiceId = invoice.id;
        item.status = "invoiced";
      }
    if (commandKey)
      loaded.data.invoiceCommands.push({
        key: commandKey,
        requestHash,
        entityId: invoice.id,
      });
    await this.appendAudit(loaded.data, "invoice.issued", invoice.id, {
      number,
      grossCents: invoice.grossCents,
      pdfHash: invoice.pdfHash,
      journeyCount: journeys.length,
    });
    await this.commit(scope, loaded);
    return copy(invoice);
  }
  async addPayment(
    scope: string,
    invoiceId: string,
    value: PaymentInput,
    commandKey?: string,
  ): Promise<Invoice> {
    const input = paymentInputSchema.parse(value);
    this.command(commandKey);
    const loaded = await this.load(scope);
    const requestHash = await sha256(JSON.stringify({ invoiceId, ...input }));
    if (commandKey) {
      const command = loaded.data.paymentCommands.find(
        (row) => row.key === commandKey,
      );
      if (command) {
        if (command.requestHash !== requestHash)
          conflict("Diese Vorgangskennung gehört zu einer anderen Zahlung.");
        return this.invoiceFrom(loaded.data, invoiceId);
      }
    }
    const current = this.invoiceFrom(loaded.data, invoiceId);
    if (current.status === "cancelled" || current.originalInvoiceId)
      invalid(
        "Auf stornierte Rechnungen und Stornodokumente kann hier keine Zahlung gebucht werden.",
      );
    if (input.date > this.businessDate || input.date < current.issuedAt)
      invalid(
        "Das Zahlungsdatum muss zwischen Rechnungsdatum und Demo-Geschäftstag liegen.",
      );
    const remaining =
      current.grossCents -
      current.payments.reduce((sum, row) => sum + row.amountCents, 0);
    if (input.amountCents > remaining)
      invalid("Die Zahlung übersteigt den offenen Betrag.");
    const payment: Payment = {
      ...input,
      id: this.uuid(),
      createdAt: this.timestamp(),
    };
    loaded.data.invoices
      .find((row) => row.id === invoiceId)!
      .payments.push(payment);
    if (commandKey)
      loaded.data.paymentCommands.push({
        key: commandKey,
        requestHash,
        entityId: invoiceId,
      });
    await this.appendAudit(loaded.data, "payment.recorded", invoiceId, {
      paymentId: payment.id,
      amountCents: payment.amountCents,
    });
    await this.commit(scope, loaded);
    return this.invoiceFrom(loaded.data, invoiceId);
  }
  async cancelInvoice(
    scope: string,
    invoiceId: string,
    value: string,
  ): Promise<Invoice> {
    calendarDate.parse(this.businessDate);
    const reason = shortText(500).parse(value);
    const loaded = await this.load(scope);
    const original = this.invoiceFrom(loaded.data, invoiceId);
    if (original.status === "cancelled" || original.originalInvoiceId)
      conflict(
        "Dieses Dokument wurde bereits storniert oder ist selbst ein Storno.",
      );
    if (original.payments.length)
      invalid(
        "Rechnung mit Zahlungen: Erstattungs-/Korrekturprozess ist nicht implementiert. Storno gesperrt.",
      );
    const number = await this.reserveNumber(scope, loaded, this.businessDate);
    const credit: Invoice = {
      ...copy(original),
      id: this.uuid(),
      number,
      issuedAt: this.businessDate,
      dueAt: this.businessDate,
      lines: original.lines.map((line) => ({
        ...line,
        grossCents: -line.grossCents,
        netCents: -line.netCents,
        taxCents: -line.taxCents,
        positions: line.positions?.map((position) => ({
          ...position,
          unitCents: -position.unitCents,
          totalCents: -position.totalCents,
        })),
      })),
      grossCents: -original.grossCents,
      netCents: -original.netCents,
      taxCents: -original.taxCents,
      createdAt: this.timestamp(),
      pdfHash: "",
      originalInvoiceId: original.id,
      payments: [],
      status: "issued",
      cancelledBy: null,
    };
    const bytes = await this.renderPdf(copy(credit), original.number);
    credit.pdfHash = await sha256(bytes);
    loaded.data.invoices.push(credit);
    loaded.data.pdfs.push({
      invoiceId: credit.id,
      base64: base64(bytes),
      sha256: credit.pdfHash,
    });
    loaded.data.cancellations.push({
      invoiceId,
      creditId: credit.id,
      reason,
      at: this.timestamp(),
    });
    await this.appendAudit(loaded.data, "invoice.cancelled", invoiceId, {
      creditId: credit.id,
      reason,
    });
    await this.commit(scope, loaded);
    return copy(credit);
  }
  async pdf(scope: string, invoiceId: string): Promise<Uint8Array> {
    const loaded = await this.load(scope);
    const invoice = this.invoiceFrom(loaded.data, invoiceId);
    const archive =
      loaded.data.pdfs.find((row) => row.invoiceId === invoiceId) ??
      notFound("PDF");
    let bytes: Uint8Array;
    try {
      bytes = unbase64(archive.base64);
    } catch {
      throw new CloudStoreError(
        503,
        "Das archivierte PDF ist beschädigt.",
        "PDF_INTEGRITY",
      );
    }
    if (
      (await sha256(bytes)) !== archive.sha256 ||
      archive.sha256 !== invoice.pdfHash
    )
      throw new CloudStoreError(
        503,
        "Integritätsprüfung des archivierten PDFs fehlgeschlagen.",
        "PDF_INTEGRITY",
      );
    return bytes;
  }
  async dtaCheck(scope: string, invoiceId: string): Promise<DtaCheck> {
    const loaded = await this.load(scope);
    const invoice = this.invoiceFrom(loaded.data, invoiceId);
    if (invoice.originalInvoiceId || invoice.status === "cancelled")
      invalid(
        "Stornierte Rechnungen und Stornodokumente benötigen ein noch nicht implementiertes DTA-Korrekturverfahren.",
      );
    if (
      !invoice.lines.every(
        (line) =>
          loaded.data.journeys.find((row) => row.id === line.journeyId)
            ?.kind === "medical",
      )
    )
      invalid(
        "Privat-, Firmen- und Kurierrechnungen gehören nicht zum §302-DTA.",
      );
    const blockers = [
      {
        code: "SYNTHETIC_ONLY",
        message:
          "Dieser private Cloud-Test erlaubt ausschließlich erfundene Daten.",
      },
      {
        code: "FORMAT_UNVERIFIED",
        message:
          "Kein amtlich verifizierter §302-Serializer oder autorisierter Konformitätstest eingerichtet.",
      },
      {
        code: "ROUTING_UNVERIFIED",
        message:
          "Empfänger-, Transport- und Entschlüsselungs-IK sind nicht für den Versand bestätigt.",
      },
      {
        code: "CERTIFICATE_MISSING",
        message:
          "Eigene und empfängerbezogene Zertifikate wurden hier nicht für den Versand eingerichtet.",
      },
      {
        code: "CHANNEL_UNCONFIRMED",
        message: "Kein bestätigter Versandkanal eingerichtet.",
      },
      {
        code: "PRIVACY_RELEASE_MISSING",
        message:
          "Verarbeitungsstandorte und Datenschutz-/Sicherheitsfreigabe für echte Gesundheitsdaten sind ungeprüft.",
      },
    ];
    const check: DtaCheck = {
      id: this.uuid(),
      invoiceId,
      createdAt: this.timestamp(),
      mode: "dry-run",
      status: "blocked",
      blockers,
      payloadHash: await sha256(
        JSON.stringify({ invoiceId, pdfHash: invoice.pdfHash, blockers }),
      ),
      format: "readiness-report",
    };
    loaded.data.dtaChecks.push(check);
    await this.appendAudit(loaded.data, "dta.readiness_checked", invoiceId, {
      checkId: check.id,
      status: "blocked",
      noTransmission: true,
    });
    await this.commit(scope, loaded);
    return copy(check);
  }
}
