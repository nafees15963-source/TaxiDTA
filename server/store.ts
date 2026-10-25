import { DatabaseSync } from "node:sqlite";
import {
  randomUUID,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import {
  calculateInvoiceLine,
  calculateTariff,
  addCalendarDays,
  parseDistance,
  assertDate,
} from "../src/domain/index.js";
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
import { renderInvoicePdf } from "./pdf.js";
import {
  validateBillingCaseInput,
  buildBillingCase,
  billingCaseBlockers,
  billingCaseInputFromRecord,
  caseJourneyKey,
} from "./billing-case.js";
export const BUSINESS_DATE = "2026-10-22";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const now = () => new Date().toISOString();
const parse = <T>(row: unknown): T =>
  JSON.parse((row as { data: string }).data) as T;
export const schema = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS customers(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS journeys(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customers(id),invoice_id TEXT,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invoices(id TEXT PRIMARY KEY,number TEXT NOT NULL UNIQUE,customer_id TEXT NOT NULL REFERENCES customers(id),original_id TEXT REFERENCES invoices(id),data TEXT NOT NULL,pdf BLOB NOT NULL,pdf_hash TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS one_credit_per_invoice ON invoices(original_id) WHERE original_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS invoice_journeys(journey_id TEXT PRIMARY KEY REFERENCES journeys(id),invoice_id TEXT NOT NULL REFERENCES invoices(id));
CREATE TABLE IF NOT EXISTS payments(id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL REFERENCES invoices(id),data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS payment_commands(command_key TEXT PRIMARY KEY,request_hash TEXT NOT NULL,payment_id TEXT NOT NULL REFERENCES payments(id));
CREATE TABLE IF NOT EXISTS cancellations(invoice_id TEXT PRIMARY KEY REFERENCES invoices(id),credit_id TEXT NOT NULL REFERENCES invoices(id),reason TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS dta_checks(id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL REFERENCES invoices(id),data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS counters(year TEXT PRIMARY KEY,value INTEGER NOT NULL CHECK(value>=0));
CREATE TABLE IF NOT EXISTS commands(command_key TEXT PRIMARY KEY,request_hash TEXT NOT NULL,invoice_id TEXT NOT NULL REFERENCES invoices(id));
CREATE TABLE IF NOT EXISTS billing_case_payers(payer_id TEXT PRIMARY KEY,customer_id TEXT NOT NULL UNIQUE REFERENCES customers(id));
CREATE TABLE IF NOT EXISTS billing_cases(id TEXT PRIMARY KEY,customer_id TEXT NOT NULL REFERENCES customers(id),invoice_id TEXT REFERENCES invoices(id),data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS billing_cases_customer_invoice ON billing_cases(customer_id,invoice_id);
CREATE TABLE IF NOT EXISTS billing_case_commands(command_key TEXT PRIMARY KEY,request_hash TEXT NOT NULL,case_id TEXT NOT NULL REFERENCES billing_cases(id));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,action TEXT NOT NULL,entity_id TEXT NOT NULL,at TEXT NOT NULL,previous_hash TEXT NOT NULL,hash TEXT NOT NULL,data TEXT NOT NULL);
CREATE TRIGGER IF NOT EXISTS invoice_no_update BEFORE UPDATE ON invoices BEGIN SELECT RAISE(ABORT,'Invoices are immutable'); END;
CREATE TRIGGER IF NOT EXISTS invoice_no_delete BEFORE DELETE ON invoices BEGIN SELECT RAISE(ABORT,'Invoices are immutable'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'Audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS payment_no_update BEFORE UPDATE ON payments BEGIN SELECT RAISE(ABORT,'Payments are append-only'); END;
CREATE TRIGGER IF NOT EXISTS payment_no_delete BEFORE DELETE ON payments BEGIN SELECT RAISE(ABORT,'Payments are append-only'); END;
`;
export class Store {
  readonly db: DatabaseSync;
  readonly csrfToken = randomBytes(32).toString("hex");
  private queue: Promise<unknown> = Promise.resolve();
  constructor(public path = "work/taxidta.sqlite") {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(schema);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  audit(
    action: string,
    entityId: string,
    details: Record<string, unknown> = {},
  ) {
    const at = now();
    const previousHash =
      (
        this.db
          .prepare("SELECT hash FROM audit ORDER BY id DESC LIMIT 1")
          .get() as { hash: string } | undefined
      )?.hash ?? "0".repeat(64);
    const data = JSON.stringify(details);
    const current = hash(
      JSON.stringify({ action, entityId, at, previousHash, details: data }),
    );
    this.db
      .prepare(
        "INSERT INTO audit(action,entity_id,at,previous_hash,hash,data) VALUES(?,?,?,?,?,?)",
      )
      .run(action, entityId, at, previousHash, current, data);
  }
  verifyAudit(): boolean {
    let previous = "0".repeat(64);
    for (const row of this.db
      .prepare("SELECT * FROM audit ORDER BY id")
      .all() as {
      action: string;
      entity_id: string;
      at: string;
      previous_hash: string;
      hash: string;
      data: string;
    }[]) {
      if (
        row.previous_hash !== previous ||
        row.hash !==
          hash(
            JSON.stringify({
              action: row.action,
              entityId: row.entity_id,
              at: row.at,
              previousHash: previous,
              details: row.data,
            }),
          )
      )
        return false;
      previous = row.hash;
    }
    return true;
  }
  csrfMatches(value: string) {
    const actual = Buffer.from(this.csrfToken);
    const provided = Buffer.from(value);
    return (
      provided.length === actual.length && timingSafeEqual(provided, actual)
    );
  }
  customers() {
    return this.db
      .prepare("SELECT data FROM customers ORDER BY rowid")
      .all()
      .map((r) => parse<Customer>(r));
  }
  journeys() {
    return this.db
      .prepare("SELECT data,invoice_id FROM journeys ORDER BY rowid")
      .all()
      .map((r) => ({
        ...parse<Journey>(r),
        invoiceId: (r as { invoice_id: string | null }).invoice_id,
      }));
  }
  invoice(id: string): Invoice {
    const row = this.db.prepare("SELECT data FROM invoices WHERE id=?").get(id);
    if (!row) throw new ApiError(404, "Rechnung nicht gefunden.");
    const invoice = parse<Invoice>(row);
    const cancel = this.db
      .prepare("SELECT credit_id FROM cancellations WHERE invoice_id=?")
      .get(id) as { credit_id: string } | undefined;
    return {
      ...invoice,
      status: cancel ? "cancelled" : "issued",
      cancelledBy: cancel?.credit_id ?? null,
      payments: this.db
        .prepare("SELECT data FROM payments WHERE invoice_id=? ORDER BY rowid")
        .all(id)
        .map((r) => parse<Payment>(r)),
    };
  }
  invoices() {
    return this.db
      .prepare("SELECT id FROM invoices ORDER BY rowid DESC")
      .all()
      .map((row) => this.invoice((row as { id: string }).id));
  }
  state(): AppState {
    return {
      customers: this.customers(),
      journeys: this.journeys(),
      invoices: this.invoices(),
      billingCases: this.billingCases(),
      dtaChecks: this.db
        .prepare("SELECT data FROM dta_checks ORDER BY rowid DESC")
        .all()
        .map((r) => parse<DtaCheck>(r)),
      audit: this.db
        .prepare("SELECT * FROM audit ORDER BY id DESC LIMIT 200")
        .all()
        .map((r) => {
          const row = r as {
            id: number;
            action: string;
            entity_id: string;
            at: string;
            previous_hash: string;
            hash: string;
            data: string;
          };
          return {
            id: row.id,
            action: row.action,
            entityId: row.entity_id,
            at: row.at,
            previousHash: row.previous_hash,
            hash: row.hash,
            details: row.data,
          };
        }),
      csrfToken: this.csrfToken,
      mode: "demo",
      businessDate: BUSINESS_DATE,
      version: "0.2.0",
    };
  }
  billingCase(id: string): BillingCase {
    const row = this.db
      .prepare("SELECT data,invoice_id FROM billing_cases WHERE id=?")
      .get(id) as { data: string; invoice_id: string | null } | undefined;
    if (!row) throw new ApiError(404, "Abrechnungsfall nicht gefunden.");
    const result = parse<BillingCase>(row);
    return {
      ...result,
      invoiceId: row.invoice_id,
      status: row.invoice_id
        ? "invoiced"
        : result.blockers.length
          ? "draft"
          : "ready",
    };
  }
  billingCases(): BillingCase[] {
    return this.db
      .prepare("SELECT id FROM billing_cases ORDER BY rowid DESC")
      .all()
      .map((row) => this.billingCase((row as { id: string }).id));
  }
  private casePayerCustomer(payer: BillingCasePayer): Customer {
    const link = this.db
      .prepare("SELECT customer_id FROM billing_case_payers WHERE payer_id=?")
      .get(payer.id) as { customer_id: string } | undefined;
    if (link) {
      const customer = this.customers().find((c) => c.id === link.customer_id);
      if (!customer)
        throw new ApiError(500, "Die Kassenverknüpfung ist nicht vollständig.");
      return customer;
    }
    const customer: Customer = {
      id: randomUUID(),
      kind: "payer",
      name: payer.name,
      address: payer.address || "",
      reference: payer.ik ? `IK ${payer.ik}` : undefined,
      createdAt: now(),
    };
    this.db
      .prepare("INSERT INTO customers VALUES(?,?)")
      .run(customer.id, JSON.stringify(customer));
    this.db
      .prepare("INSERT INTO billing_case_payers VALUES(?,?)")
      .run(payer.id, customer.id);
    this.audit("customer.created", customer.id, {
      kind: "payer",
      origin: "billing-case",
    });
    return customer;
  }
  addBillingCase(value: BillingCaseInput, commandKey?: string): BillingCase {
    const input = validateBillingCaseInput(value);
    const requestHash = hash(JSON.stringify(input));
    if (commandKey && !/^[A-Za-z0-9_-]{8,100}$/.test(commandKey))
      throw new ApiError(422, "Ungültige Vorgangskennung.");
    if (
      new Set(input.journeys.map(caseJourneyKey)).size !== input.journeys.length
    )
      throw new ApiError(
        409,
        "Ein Fahrtdatum mit derselben Strecke und Kilometerzahl wurde im Fall doppelt erfasst.",
      );
    return this.transaction(() => {
      if (commandKey) {
        const existing = this.db
          .prepare(
            "SELECT request_hash,case_id FROM billing_case_commands WHERE command_key=?",
          )
          .get(commandKey) as
          | { request_hash: string; case_id: string }
          | undefined;
        if (existing) {
          if (existing.request_hash !== requestHash)
            throw new ApiError(
              409,
              "Diese Vorgangskennung gehört zu einem anderen Abrechnungsfall.",
            );
          return this.billingCase(existing.case_id);
        }
      }
      const customer = this.casePayerCustomer(input.payer);
      const id = randomUUID();
      const at = now();
      const number = `AF-${input.prescription.issuedAt.slice(0, 4)}-${id.slice(0, 8).toUpperCase()}`;
      const { billingCase, journeys } = buildBillingCase(input, {
        id,
        number,
        customerId: customer.id,
        createdAt: at,
        updatedAt: at,
        businessDate: BUSINESS_DATE,
      });
      this.db
        .prepare("INSERT INTO billing_cases VALUES(?,?,NULL,?)")
        .run(id, customer.id, JSON.stringify(billingCase));
      for (const journey of journeys) {
        this.assertJourneyUnique(journey);
        this.db
          .prepare("INSERT INTO journeys VALUES(?,?,NULL,?)")
          .run(journey.id, customer.id, JSON.stringify(journey));
      }
      if (commandKey)
        this.db
          .prepare("INSERT INTO billing_case_commands VALUES(?,?,?)")
          .run(commandKey, requestHash, id);
      this.audit("billing_case.created", id, {
        journeyCount: journeys.length,
        status: billingCase.status,
      });
      return billingCase;
    });
  }
  updateBillingCase(id: string, value: BillingCaseInput): BillingCase {
    const input = validateBillingCaseInput(value);
    if (
      new Set(input.journeys.map(caseJourneyKey)).size !== input.journeys.length
    )
      throw new ApiError(
        409,
        "Ein Fahrtdatum mit derselben Strecke und Kilometerzahl wurde im Fall doppelt erfasst.",
      );
    return this.transaction(() => {
      const current = this.billingCase(id);
      if (
        current.invoiceId ||
        current.journeyIds.some((journeyId) =>
          Boolean(
            (
              this.db
                .prepare("SELECT invoice_id FROM journeys WHERE id=?")
                .get(journeyId) as { invoice_id: string | null } | undefined
            )?.invoice_id,
          ),
        )
      )
        throw new ApiError(
          409,
          "Bereits abgerechnete Fälle bleiben unveränderlich, auch nach einem Storno.",
        );
      const currentInput = validateBillingCaseInput(
        billingCaseInputFromRecord(current),
      );
      if (JSON.stringify(currentInput) === JSON.stringify(input))
        return current;
      const customer = this.casePayerCustomer(input.payer);
      const { billingCase, journeys } = buildBillingCase(input, {
        id,
        number: current.number,
        customerId: customer.id,
        createdAt: current.createdAt,
        updatedAt: now(),
        businessDate: BUSINESS_DATE,
      });
      for (const journeyId of current.journeyIds)
        this.db
          .prepare("DELETE FROM journeys WHERE id=? AND invoice_id IS NULL")
          .run(journeyId);
      for (const journey of journeys) {
        this.assertJourneyUnique(journey);
        this.db
          .prepare("INSERT INTO journeys VALUES(?,?,NULL,?)")
          .run(journey.id, customer.id, JSON.stringify(journey));
      }
      this.db
        .prepare(
          "UPDATE billing_cases SET customer_id=?,data=? WHERE id=? AND invoice_id IS NULL",
        )
        .run(customer.id, JSON.stringify(billingCase), id);
      this.audit("billing_case.updated", id, {
        journeyCount: journeys.length,
        status: billingCase.status,
      });
      return billingCase;
    });
  }
  async issueCaseInvoice(
    caseIds: string[],
    issuedAt: string,
    commandKey?: string,
  ): Promise<Invoice> {
    if (
      !Array.isArray(caseIds) ||
      !caseIds.length ||
      caseIds.length > 500 ||
      new Set(caseIds).size !== caseIds.length
    )
      return Promise.reject(
        new ApiError(
          422,
          "Bitte 1 bis 500 unterschiedliche Abrechnungsfälle auswählen.",
        ),
      );
    const cases = caseIds.map((id) => this.billingCase(id));
    const journeyIds = cases.flatMap((item) => item.journeyIds);
    if (journeyIds.length > 500)
      return Promise.reject(
        new ApiError(
          422,
          "Eine Sammelrechnung darf höchstens 500 einzelne Fahrten enthalten. Bitte weitere Rechnungen bilden.",
        ),
      );
    return this.issueInvoice(journeyIds, issuedAt, commandKey);
  }
  addCustomer(input: Omit<Customer, "id" | "createdAt">): Customer {
    const customer: Customer = { ...input, id: randomUUID(), createdAt: now() };
    return this.transaction(() => {
      this.db
        .prepare("INSERT INTO customers VALUES(?,?)")
        .run(customer.id, JSON.stringify(customer));
      this.audit("customer.created", customer.id, { kind: customer.kind });
      return customer;
    });
  }
  private prepareJourney(
    input: Omit<Journey, "id" | "createdAt" | "invoiceId">,
  ): Omit<Journey, "id" | "createdAt" | "invoiceId"> {
    if (input.billingCaseId)
      throw new ApiError(
        422,
        "Fallfahrten werden ausschließlich im gemeinsamen Abrechnungsfall angelegt.",
      );
    const customer = this.customers().find((c) => c.id === input.customerId);
    if (!customer) throw new ApiError(404, "Kunde nicht gefunden.");
    if (
      this.db
        .prepare("SELECT payer_id FROM billing_case_payers WHERE customer_id=?")
        .get(customer.id)
    )
      throw new ApiError(
        422,
        "Registerkassen werden ausschließlich über einen vollständigen Abrechnungsfall mit Verordnung erfasst.",
      );
    if (input.kind === "medical" && customer.kind !== "payer")
      throw new ApiError(
        422,
        "Krankenfahrten benötigen einen getrennten fiktiven Kostenträger.",
      );
    if (input.kind !== "medical" && customer.kind === "payer")
      throw new ApiError(
        422,
        "Normale Aufträge werden Privat-, Firmen- oder Laborkunden zugeordnet.",
      );
    let grossCents = input.grossCents;
    if (input.kind === "medical") {
      if (!input.tariff)
        throw new ApiError(422, "Bitte Art. I oder II auswählen.");
      // The calculated, source-backed amount replaces editable input; no silent free price.
      if (input.contractConfirmed)
        grossCents = calculateTariff({
          article: input.tariff,
          km: input.km,
          date: input.date,
          persons: 1,
          contractConfirmed: true,
        }).grossCents;
    }
    if (input.kind !== "medical" && input.tariff !== null)
      throw new ApiError(
        422,
        "Normale Aufträge haben keinen Krankenfahrten-Tarif.",
      );
    return { ...input, grossCents };
  }
  /** Call only inside the same write transaction as the insert/update. */
  private assertJourneyUnique(
    input: Omit<Journey, "id" | "createdAt" | "invoiceId">,
    excludeId?: string,
  ) {
    const existing = this.journeys().filter((j) => j.id !== excludeId);
    if (
      input.receiptNumber &&
      existing.some((j) => j.receiptNumber === input.receiptNumber)
    )
      throw new ApiError(409, "Diese Belegnummer wurde bereits vergeben.");
    const normalize = (value: string) =>
      value
        .normalize("NFC")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("de-DE");
    const duplicate = existing.some(
      (j) =>
        j.date === input.date &&
        normalize(j.from) === normalize(input.from) &&
        normalize(j.to) === normalize(input.to) &&
        parseDistance(j.km) === parseDistance(input.km) &&
        j.kind === input.kind &&
        (input.billingCaseId
          ? Boolean(j.billingCaseId) &&
            j.insuredPersonKey === input.insuredPersonKey
          : j.customerId === input.customerId && !j.billingCaseId),
    );
    if (duplicate)
      throw new ApiError(
        409,
        "Mögliche doppelte Fahrt: Kunde, Datum, Strecke und Kilometer stimmen überein. Bitte vorhandene Fahrt prüfen.",
      );
  }
  addJourney(input: Omit<Journey, "id" | "createdAt" | "invoiceId">): Journey {
    const prepared = this.prepareJourney(input);
    const journey: Journey = {
      ...prepared,
      id: randomUUID(),
      invoiceId: null,
      createdAt: now(),
    };
    return this.transaction(() => {
      this.assertJourneyUnique(prepared);
      this.db
        .prepare("INSERT INTO journeys VALUES(?,?,NULL,?)")
        .run(journey.id, journey.customerId, JSON.stringify(journey));
      this.audit("journey.created", journey.id, { kind: journey.kind });
      return journey;
    });
  }
  updateJourney(
    journeyId: string,
    input: Omit<Journey, "id" | "createdAt" | "invoiceId">,
  ): Journey {
    return this.transaction(() => {
      const row = this.db
        .prepare("SELECT data,invoice_id FROM journeys WHERE id=?")
        .get(journeyId) as
        | { data: string; invoice_id: string | null }
        | undefined;
      if (!row) throw new ApiError(404, "Fahrt nicht gefunden.");
      if (row.invoice_id !== null)
        throw new ApiError(
          409,
          "Bereits abgerechnete Fahrten bleiben unveränderlich, auch nach einem Storno.",
        );
      const current = parse<Journey>(row);
      if (current.billingCaseId)
        throw new ApiError(
          409,
          "Diese Fahrt gehört zu einer gemeinsamen Verordnung. Bitte den Abrechnungsfall bearbeiten.",
        );
      const prepared = this.prepareJourney(input);
      this.assertJourneyUnique(prepared, journeyId);
      const updated: Journey = {
        ...current,
        ...prepared,
        id: current.id,
        createdAt: current.createdAt,
        invoiceId: null,
      };
      const changedFields = Object.keys(prepared).filter(
        (key) =>
          current[key as keyof Journey] !== updated[key as keyof Journey],
      );
      if (changedFields.length === 0) return current;
      this.db
        .prepare(
          "UPDATE journeys SET customer_id=?,data=? WHERE id=? AND invoice_id IS NULL",
        )
        .run(updated.customerId, JSON.stringify(updated), journeyId);
      // Values are deliberately excluded from the technical audit event.
      this.audit("journey.updated", journeyId, { changedFields });
      return updated;
    });
  }
  private nextNumber(date: string): string {
    return this.transaction(() => {
      const year = date.slice(0, 4);
      this.db
        .prepare(
          "INSERT INTO counters(year,value) VALUES(?,0) ON CONFLICT DO NOTHING",
        )
        .run(year);
      const row = this.db
        .prepare("SELECT value FROM counters WHERE year=?")
        .get(year) as { value: number };
      const number = `IT-${year}-${String(row.value + 1).padStart(6, "0")}`;
      this.db
        .prepare("UPDATE counters SET value=value+1 WHERE year=?")
        .run(year);
      this.audit("invoice.number_reserved", number, {
        number,
        reason:
          "Nicht wiederverwendbare transaktionale Nummernreservierung vor PDF-Erstellung",
      });
      return number;
    });
  }
  private persistInvoice(invoice: Invoice, pdf: Buffer) {
    this.db
      .prepare("INSERT INTO invoices VALUES(?,?,?,?,?,?,?)")
      .run(
        invoice.id,
        invoice.number,
        invoice.customerId,
        invoice.originalInvoiceId ?? null,
        JSON.stringify(invoice),
        pdf,
        invoice.pdfHash,
      );
  }
  issueInvoice(
    journeyIds: string[],
    issuedAt: string,
    commandKey?: string,
  ): Promise<Invoice> {
    return this.exclusive(async () => {
      assertDate(issuedAt);
      if (issuedAt > BUSINESS_DATE)
        throw new ApiError(
          422,
          "Das Rechnungsdatum darf nicht nach dem Geschäftstag der Demo liegen.",
        );
      const requestHash = hash(
        JSON.stringify({ journeyIds: [...journeyIds].sort(), issuedAt }),
      );
      if (commandKey) {
        const existing = this.db
          .prepare(
            "SELECT request_hash,invoice_id FROM commands WHERE command_key=?",
          )
          .get(commandKey) as
          | { request_hash: string; invoice_id: string }
          | undefined;
        if (existing) {
          if (existing.request_hash !== requestHash)
            throw new ApiError(
              409,
              "Diese Vorgangskennung gehört zu einer anderen Rechnung.",
            );
          return this.invoice(existing.invoice_id);
        }
      }
      if (new Set(journeyIds).size !== journeyIds.length)
        throw new ApiError(422, "Fahrt doppelt ausgewählt.");
      const journeys = journeyIds.map((id) => {
        const j = this.journeys().find((j) => j.id === id);
        if (!j) throw new ApiError(404, "Eine Fahrt wurde nicht gefunden.");
        if (j.invoiceId)
          throw new ApiError(
            409,
            "Eine Fahrt ist bereits abgerechnet und bleibt auch nach Storno gesperrt.",
          );
        if (j.date > issuedAt)
          throw new ApiError(
            422,
            "Zukünftige Leistungen können hier noch nicht abgerechnet werden.",
          );
        return j;
      });
      if (journeys.length === 0)
        throw new ApiError(422, "Bitte mindestens eine Fahrt auswählen.");
      if (new Set(journeys.map((j) => j.customerId)).size !== 1)
        throw new ApiError(
          422,
          "Eine Sammelrechnung gehört genau einem Rechnungsempfänger.",
        );
      const medical = journeys.some((j) => j.kind === "medical");
      if (medical && journeys.some((j) => j.kind !== "medical"))
        throw new ApiError(
          422,
          "Kassen- und normale Leistungen können nicht auf einer Rechnung gemischt werden.",
        );
      if (
        medical &&
        journeys.some((j) => !j.billingCaseId) &&
        this.db
          .prepare(
            "SELECT payer_id FROM billing_case_payers WHERE customer_id=?",
          )
          .get(journeys[0].customerId)
      )
        throw new ApiError(
          422,
          "Registerkassen werden ausschließlich über vollständige Abrechnungsfälle abgerechnet.",
        );
      const caseIds = [
        ...new Set(
          journeys.flatMap((j) => (j.billingCaseId ? [j.billingCaseId] : [])),
        ),
      ];
      const cases = caseIds.map((id) => this.billingCase(id));
      for (const item of cases) {
        if (item.invoiceId)
          throw new ApiError(
            409,
            "Ein Abrechnungsfall wurde bereits abgerechnet und bleibt auch nach Storno gesperrt.",
          );
        if (item.journeyIds.some((id) => !journeyIds.includes(id)))
          throw new ApiError(
            422,
            "Ein Abrechnungsfall wird vollständig mit allen Fahrtterminen abgerechnet. Bitte den gesamten Fall auswählen.",
          );
        const blockers = billingCaseBlockers(
          billingCaseInputFromRecord(item),
          BUSINESS_DATE,
        );
        if (blockers.length)
          throw new ApiError(
            422,
            "Abrechnungsfall noch unvollständig: " + blockers.join(" "),
          );
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
        throw new ApiError(
          422,
          "Die Kassen-Abrechnungsdaten der ausgewählten Fälle unterscheiden sich. Bitte die Registerzuordnung prüfen.",
        );
      for (const j of journeys) {
        if (
          j.kind === "medical" &&
          (!j.contractConfirmed ||
            !j.prescriptionConfirmed ||
            (!j.receiptNumber && !j.billingCaseId))
        )
          throw new ApiError(
            422,
            "Krankenfahrt gesperrt: Vertragsberechtigung, Verordnung und eindeutige Belegnummer müssen bestätigt sein.",
          );
      }
      const storedCustomer = this.customers().find(
        (c) => c.id === journeys[0].customerId,
      )!;
      const customer: Customer = cases.length
        ? {
            ...storedCustomer,
            name: cases[0].payer.name,
            address: cases[0].payer.address!,
            reference: `IK ${cases[0].payer.ik}`,
          }
        : { ...storedCustomer };
      const lines = journeys.map((journey) => {
        const line = calculateInvoiceLine(journey);
        const item = cases.find((c) => c.id === journey.billingCaseId);
        return item
          ? {
              ...line,
              billingCaseId: item.id,
              insuredName: item.insured.name,
              prescriptionReference: item.prescription.number || undefined,
            }
          : line;
      });
      const number = this.nextNumber(issuedAt);
      const invoice: Invoice = {
        id: randomUUID(),
        number,
        customerId: customer.id,
        customerSnapshot: customer,
        issuedAt,
        dueAt: addCalendarDays(issuedAt, 28),
        dueAtVerified: !medical,
        dueAtBasis: medical
          ? "Demo-Wiedervorlage nach 28 Tagen. Vertragliche Kassenfrist nicht verifiziert."
          : "28 Kalendertage gemäß konfigurierter Demo-Standardvereinbarung.",
        lines,
        grossCents: lines.reduce((a, l) => a + l.grossCents, 0),
        netCents: lines.reduce((a, l) => a + l.netCents, 0),
        taxCents: lines.reduce((a, l) => a + l.taxCents, 0),
        status: "issued",
        payments: [],
        cancelledBy: null,
        createdAt: now(),
        pdfHash: "",
        originalInvoiceId: null,
        ...(cases.length
          ? { billingCaseIds: caseIds, billingCaseSnapshots: cases }
          : {}),
      };
      const pdf = await renderInvoicePdf(invoice);
      invoice.pdfHash = hash(pdf);
      return this.transaction(() => {
        for (const j of journeys) {
          const current = this.db
            .prepare("SELECT data,invoice_id FROM journeys WHERE id=?")
            .get(j.id) as { data: string; invoice_id: string | null };
          if (!current)
            throw new ApiError(
              409,
              "Fahrt wurde während der Rechnungserstellung durch eine Fallkorrektur ersetzt. Bitte neu auswählen.",
            );
          if (current.invoice_id)
            throw new ApiError(
              409,
              "Fahrt wurde zwischenzeitlich abgerechnet.",
            );
          const currentData = parse<Journey>(current);
          if (
            Object.keys(j).some(
              (key) =>
                currentData[key as keyof Journey] !== j[key as keyof Journey],
            )
          )
            throw new ApiError(
              409,
              "Fahrt wurde während der Rechnungserstellung geändert. Bitte die Auswahl neu prüfen.",
            );
        }
        this.persistInvoice(invoice, pdf);
        for (const j of journeys) {
          this.db
            .prepare("INSERT INTO invoice_journeys VALUES(?,?)")
            .run(j.id, invoice.id);
          this.db
            .prepare("UPDATE journeys SET invoice_id=? WHERE id=?")
            .run(invoice.id, j.id);
        }
        for (const item of cases) {
          const changed = this.db
            .prepare(
              "UPDATE billing_cases SET invoice_id=? WHERE id=? AND invoice_id IS NULL",
            )
            .run(invoice.id, item.id);
          if (changed.changes !== 1)
            throw new ApiError(
              409,
              "Abrechnungsfall wurde zwischenzeitlich gebunden.",
            );
        }
        if (commandKey)
          this.db
            .prepare("INSERT INTO commands VALUES(?,?,?)")
            .run(commandKey, requestHash, invoice.id);
        this.audit("invoice.issued", invoice.id, {
          number: invoice.number,
          grossCents: invoice.grossCents,
          pdfHash: invoice.pdfHash,
          journeyCount: journeys.length,
        });
        return invoice;
      });
    });
  }
  addPayment(
    invoiceId: string,
    input: Omit<Payment, "id" | "createdAt">,
    commandKey?: string,
  ): Invoice {
    return this.transaction(() => {
      const requestHash = hash(
        JSON.stringify({
          invoiceId,
          amountCents: input.amountCents,
          date: input.date,
          note: input.note,
        }),
      );
      if (commandKey) {
        const existing = this.db
          .prepare(
            "SELECT request_hash FROM payment_commands WHERE command_key=?",
          )
          .get(commandKey) as { request_hash: string } | undefined;
        if (existing) {
          if (existing.request_hash !== requestHash)
            throw new ApiError(
              409,
              "Diese Vorgangskennung gehört zu einer anderen Zahlung.",
            );
          return this.invoice(invoiceId);
        }
      }
      assertDate(input.date);
      if (input.date > BUSINESS_DATE)
        throw new ApiError(
          422,
          "Ein zukünftiger Zahlungseingang darf noch nicht als bezahlt erfasst werden.",
        );
      if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0)
        throw new ApiError(
          422,
          "Die Zahlung muss eine positive ganze Centzahl sein.",
        );
      const inv = this.invoice(invoiceId);
      if (inv.status === "cancelled" || inv.originalInvoiceId)
        throw new ApiError(
          422,
          "Auf stornierte Rechnungen und Stornodokumente kann hier keine Zahlung gebucht werden.",
        );
      if (input.date < inv.issuedAt)
        throw new ApiError(
          422,
          "Das Zahlungsdatum darf nicht vor dem Rechnungsdatum liegen.",
        );
      const remaining =
        inv.grossCents - inv.payments.reduce((s, p) => s + p.amountCents, 0);
      if (input.amountCents > remaining)
        throw new ApiError(422, "Die Zahlung übersteigt den offenen Betrag.");
      const payment: Payment = { ...input, id: randomUUID(), createdAt: now() };
      this.db
        .prepare("INSERT INTO payments VALUES(?,?,?)")
        .run(payment.id, invoiceId, JSON.stringify(payment));
      if (commandKey)
        this.db
          .prepare("INSERT INTO payment_commands VALUES(?,?,?)")
          .run(commandKey, requestHash, payment.id);
      this.audit("payment.recorded", invoiceId, {
        paymentId: payment.id,
        amountCents: payment.amountCents,
      });
      return this.invoice(invoiceId);
    });
  }
  cancelInvoice(invoiceId: string, reason: string): Promise<Invoice> {
    return this.exclusive(async () => {
      const inv = this.invoice(invoiceId);
      if (inv.status === "cancelled" || inv.originalInvoiceId)
        throw new ApiError(
          409,
          "Dieses Dokument wurde bereits storniert oder ist selbst ein Storno.",
        );
      if (inv.payments.length)
        throw new ApiError(
          422,
          "Rechnung mit Zahlungen: Erstattungs-/Korrekturprozess ist noch nicht implementiert. Storno gesperrt.",
        );
      const credit: Invoice = {
        ...inv,
        id: randomUUID(),
        number: this.nextNumber(BUSINESS_DATE),
        issuedAt: BUSINESS_DATE,
        dueAt: BUSINESS_DATE,
        lines: inv.lines.map((l) => ({
          ...l,
          grossCents: -l.grossCents,
          netCents: -l.netCents,
          taxCents: -l.taxCents,
          positions: l.positions?.map((p) => ({
            ...p,
            unitCents: -p.unitCents,
            totalCents: -p.totalCents,
          })),
        })),
        grossCents: -inv.grossCents,
        netCents: -inv.netCents,
        taxCents: -inv.taxCents,
        createdAt: now(),
        pdfHash: "",
        originalInvoiceId: inv.id,
        payments: [],
        status: "issued",
        cancelledBy: null,
      };
      const pdf = await renderInvoicePdf(credit, inv.number);
      credit.pdfHash = hash(pdf);
      return this.transaction(() => {
        const current = this.invoice(inv.id);
        if (current.status === "cancelled" || current.originalInvoiceId)
          throw new ApiError(
            409,
            "Dieses Dokument wurde zwischenzeitlich storniert.",
          );
        if (current.payments.length)
          throw new ApiError(
            422,
            "Zwischenzeitlich ist eine Zahlung eingegangen. Ein Storno benötigt den noch nicht implementierten Erstattungs-/Korrekturprozess.",
          );
        this.persistInvoice(credit, pdf);
        this.db
          .prepare("INSERT INTO cancellations VALUES(?,?,?,?)")
          .run(inv.id, credit.id, reason, now());
        this.audit("invoice.cancelled", inv.id, {
          creditId: credit.id,
          reason,
        });
        return credit;
      });
    });
  }
  pdf(invoiceId: string): Buffer {
    const row = this.db
      .prepare("SELECT pdf,pdf_hash FROM invoices WHERE id=?")
      .get(invoiceId) as { pdf: Uint8Array; pdf_hash: string } | undefined;
    if (!row) throw new ApiError(404, "PDF nicht gefunden.");
    const bytes = Buffer.from(row.pdf);
    if (hash(bytes) !== row.pdf_hash)
      throw new ApiError(
        500,
        "Integritätsprüfung des archivierten PDFs fehlgeschlagen.",
      );
    return bytes;
  }
  dtaCheck(invoiceId: string): DtaCheck {
    const inv = this.invoice(invoiceId);
    if (inv.originalInvoiceId || inv.status === "cancelled")
      throw new ApiError(
        422,
        "Stornierte Rechnungen und Stornodokumente benötigen ein noch nicht implementiertes DTA-Korrekturverfahren.",
      );
    if (
      !inv.lines.every(
        (l) =>
          this.journeys().find((j) => j.id === l.journeyId)?.kind === "medical",
      )
    )
      throw new ApiError(
        422,
        "Privat-, Firmen- und Kurierrechnungen gehören nicht zum §302-DTA.",
      );
    const blockers = [
      {
        code: "FORMAT_UNVERIFIED",
        message:
          "Kein amtlich verifizierter §302-Serializer und kein autorisierter Format-Konformitätstest vorhanden.",
      },
      {
        code: "ROUTING_UNVERIFIED",
        message:
          "Aktuelle amtliche Kostenträgerdatei sowie Karten-, Abrechnungs-, Transport- und Entschlüsselungs-IK fehlen.",
      },
      {
        code: "PARTICIPATION_MISSING",
        message:
          "Absender-IK, nutzbare eigene Schlüssel und ein berechtigter Testempfänger sind technisch noch nicht abgeglichen. Eine pauschale Neuanmeldung bei allen Kassen ist dafür nicht erforderlich.",
      },
      {
        code: "CERTIFICATE_MISSING",
        message:
          "Eigene und empfängerbezogene Zertifikate mit gültiger Vertrauenskette fehlen.",
      },
      {
        code: "CHANNEL_UNCONFIRMED",
        message: "Kein schriftlich bestätigter Versandweg eingerichtet.",
      },
      {
        code: "PRIVACY_RELEASE_MISSING",
        message:
          "Datenschutz- und unabhängige Sicherheitsfreigabe fehlen; ausschließlich Testdaten erlaubt.",
      },
    ];
    const check: DtaCheck = {
      id: randomUUID(),
      invoiceId,
      createdAt: now(),
      mode: "dry-run",
      status: "blocked",
      blockers,
      payloadHash: hash(
        JSON.stringify({ invoiceId, pdfHash: inv.pdfHash, blockers }),
      ),
      format: "readiness-report",
    };
    return this.transaction(() => {
      this.db
        .prepare("INSERT INTO dta_checks VALUES(?,?,?)")
        .run(check.id, invoiceId, JSON.stringify(check));
      this.audit("dta.readiness_checked", invoiceId, {
        checkId: check.id,
        status: "blocked",
        noTransmission: true,
      });
      return check;
    });
  }
  close() {
    this.db.close();
  }
  async seed() {
    if (this.db.prepare("SELECT id FROM customers LIMIT 1").get()) return;
    const c1 = this.addCustomer({
      name: "Mara Beispiel",
      kind: "private",
      address: "Beispielstraße 12\n00000 Musterstadt",
    });
    const c2 = this.addCustomer({
      name: "Nordlicht Design GmbH (Demo)",
      kind: "business",
      address: "Musterallee 8\n00000 Musterstadt",
      reference: "Projekt N-2026",
    });
    const c3 = this.addCustomer({
      name: "Labor Morgenrot (Demo)",
      kind: "laboratory",
      address: "Testcampus 4\n00000 Musterstadt",
    });
    const c4 = this.addCustomer({
      name: "Musterkasse Nord (fiktiv)",
      kind: "payer",
      address: "Kassenweg 20\n00000 Musterstadt",
    });
    const c5 = this.addCustomer({
      name: "Theo Testkunde",
      kind: "private",
      address: "Demoweg 7\n00000 Musterstadt",
    });
    const defaults = {
      vehicle: "taxi" as const,
      sameMunicipality: false,
      tariff: null,
      contractConfirmed: false,
      prescriptionConfirmed: false,
      receiptNumber: null,
    };
    const j1 = this.addJourney({
      ...defaults,
      customerId: c1.id,
      kind: "taxi",
      date: "2026-10-02",
      from: "Musterstadt Bahnhof",
      to: "Musterstadt Zentrum",
      km: "12",
      grossCents: 3400,
      description: "Taxifahrt Bahnhof – Zentrum",
    });
    const j2 = this.addJourney({
      ...defaults,
      customerId: c2.id,
      kind: "taxi",
      date: "2026-10-08",
      from: "Musterstadt Büro",
      to: "Beispielstadt Messe",
      km: "64",
      grossCents: 14900,
      description: "Geschäftsfahrt zur Messe",
    });
    const j3 = this.addJourney({
      ...defaults,
      customerId: c4.id,
      kind: "medical",
      date: "2026-10-12",
      from: "Testort A",
      to: "Testklinik B",
      km: "20",
      grossCents: 5259,
      description: "Fiktive Krankenfahrt · Art. I",
      tariff: "I",
      contractConfirmed: true,
      prescriptionConfirmed: true,
      receiptNumber: "DEMO-0001",
    });
    const inv1 = await this.issueInvoice([j1.id], "2026-10-03");
    this.addPayment(inv1.id, {
      amountCents: 3400,
      date: "2026-10-04",
      note: "Fiktive Barzahlung",
    });
    const inv2 = await this.issueInvoice([j2.id], "2026-10-09");
    this.addPayment(inv2.id, {
      amountCents: 5000,
      date: "2026-10-15",
      note: "Fiktive Teilzahlung",
    });
    await this.issueInvoice([j3.id], "2026-10-13");
    this.addJourney({
      ...defaults,
      customerId: c2.id,
      kind: "taxi",
      date: "2026-10-19",
      from: "Musterstadt Büro",
      to: "Flughafen Demo",
      km: "49.99",
      grossCents: 12400,
      description: "Flughafentransfer · Projekt Nord",
    });
    this.addJourney({
      ...defaults,
      customerId: c2.id,
      kind: "taxi",
      date: "2026-10-21",
      from: "Musterstadt Büro",
      to: "Demo Konferenz",
      km: "60",
      sameMunicipality: true,
      grossCents: 9800,
      description: "Stadtfahrt innerhalb einer Gemeinde",
    });
    this.addJourney({
      ...defaults,
      customerId: c3.id,
      kind: "laboratory",
      date: "2026-10-22",
      from: "Labor Morgenrot",
      to: "Teststandort B",
      km: "20",
      grossCents: 6500,
      description: "Labortransport · ohne Proben-/Patientendaten",
    });
    this.addJourney({
      ...defaults,
      customerId: c5.id,
      kind: "taxi",
      date: "2026-10-22",
      from: "Beispielplatz",
      to: "Musterallee",
      km: "7",
      sameMunicipality: true,
      grossCents: 2450,
      description: "Taxifahrt · privater Auftrag",
    });
    this.addJourney({
      ...defaults,
      customerId: c4.id,
      kind: "medical",
      date: "2026-10-22",
      from: "Testort C",
      to: "Testklinik D",
      km: "20",
      grossCents: 5174,
      description: "Fiktive Serienfahrt · Art. II",
      tariff: "II",
      contractConfirmed: true,
      prescriptionConfirmed: true,
      receiptNumber: "DEMO-0002",
    });
    this.addJourney({
      ...defaults,
      customerId: c4.id,
      kind: "medical",
      date: "2026-10-21",
      from: "Testort E",
      to: "Testklinik F",
      km: "14",
      grossCents: 3897,
      description: "Fiktive Krankenfahrt · Verordnung fehlt",
      tariff: "I",
      contractConfirmed: true,
      prescriptionConfirmed: false,
      receiptNumber: "DEMO-0003",
    });
  }
}
