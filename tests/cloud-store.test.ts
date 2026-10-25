import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import {
  CloudStore,
  CloudStoreError,
  type CloudRepository,
  type CloudRecord,
} from "../hosted/cloud-store.js";
import { renderCloudInvoicePdf, CloudPdfError } from "../hosted/cloud-pdf.js";
import type {
  BillingCaseInput,
  Customer,
  Journey,
  Invoice,
} from "../src/shared/types.js";

const SCOPE = "server-verified-owner";
const timestamp = () => "2026-10-22T12:00:00.000Z";
const digest = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const fakePdf = async (invoice: Invoice) =>
  new TextEncoder().encode(
    "%PDF-1.7\nSynthetic " +
      invoice.number +
      " " +
      invoice.grossCents +
      "\n%%EOF",
  );
class MemoryRepository implements CloudRepository {
  rows = new Map<string, CloudRecord>();
  rejectNext = false;
  async read(scope: string) {
    const row = this.rows.get(scope);
    return row ? structuredClone(row) : null;
  }
  async compareAndSwap(
    scope: string,
    revision: number | null,
    payload: string,
  ) {
    if (this.rejectNext) {
      this.rejectNext = false;
      return false;
    }
    const current = this.rows.get(scope);
    if (
      revision === null ? current !== undefined : current?.revision !== revision
    )
      return false;
    this.rows.set(scope, { revision: (revision ?? 0) + 1, payload });
    return true;
  }
}
function fixture(options: ConstructorParameters<typeof CloudStore>[1] = {}) {
  const repository = new MemoryRepository();
  return {
    repository,
    store: new CloudStore(repository, {
      now: timestamp,
      renderPdf: fakePdf,
      ...options,
    }),
  };
}
const customer: Omit<Customer, "id" | "createdAt"> = {
  kind: "private",
  name: "Mara Beispiel",
  address: "Testweg 1\n00000 Musterstadt",
};
const journeyInput = (
  customerId: string,
): Omit<Journey, "id" | "createdAt" | "invoiceId"> => ({
  customerId,
  kind: "taxi",
  date: "2026-10-20",
  from: "Musterbahnhof",
  to: "Demoplatz",
  km: "12",
  vehicle: "taxi",
  sameMunicipality: false,
  grossCents: 3400,
  description: "Fiktive Beförderung",
  tariff: null,
  contractConfirmed: false,
  prescriptionConfirmed: false,
  receiptNumber: null,
});
function caseInput(
  overrides: Partial<BillingCaseInput> = {},
): BillingCaseInput {
  return {
    payer: {
      id: "demo-kasse",
      name: "Musterkasse (fiktiv)",
      ik: "999999999",
      address: "Testkassenweg 2\n00000 Musterstadt",
      invoiceReady: true,
      isSynthetic: true,
      addressKind: "synthetic",
      ikStatus: "synthetic",
      addressStatus: "synthetic",
    },
    insured: {
      name: "Mara Beispiel",
      address: "Testweg 1\n00000 Musterstadt",
      insuranceNumber: "TEST-001",
    },
    prescription: {
      number: "DEMO-VO-1",
      issuedAt: "2026-10-01",
      confirmed: true,
    },
    tariff: "I",
    contractConfirmed: true,
    vehicle: "taxi",
    sameMunicipality: false,
    journeys: [
      {
        date: "2026-10-20",
        from: "Testort A",
        to: "Testklinik B",
        km: "20",
        direction: "outbound",
      },
      {
        date: "2026-10-20",
        from: "Testklinik B",
        to: "Testort A",
        km: "20",
        direction: "return",
      },
    ],
    ...overrides,
  };
}
async function ordinary(store: CloudStore) {
  const c = await store.addCustomer(SCOPE, customer);
  const j = await store.addJourney(SCOPE, journeyInput(c.id));
  return { customer: c, journey: j };
}
const status = (expected: number) => (error: unknown) =>
  error instanceof CloudStoreError && error.status === expected;

test("cloud state persists across service instances and server identity scopes never share records", async () => {
  const { repository, store } = fixture();
  assert.equal((await store.state(SCOPE)).customers.length, 0);
  assert.equal(repository.rows.size, 0);
  const c = await store.addCustomer(SCOPE, customer);
  const fresh = new CloudStore(repository, {
    now: timestamp,
    renderPdf: fakePdf,
  });
  assert.equal((await fresh.state(SCOPE)).customers[0].id, c.id);
  assert.equal((await fresh.state("another-server-user")).customers.length, 0);
  const state = await fresh.state(SCOPE);
  state.customers[0].name = "Client mutation";
  assert.equal((await fresh.state(SCOPE)).customers[0].name, customer.name);
  assert.deepEqual(state.deployment, {
    kind: "site-private",
    financialStorage: "cloud-d1",
    ownerOnly: true,
    syntheticOnly: true,
  });
  await assert.rejects(fresh.state(""), status(403));
  repository.rows.set("another-server-user", repository.rows.get(SCOPE)!);
  await assert.rejects(fresh.state("another-server-user"), status(503));
});

test("failed compare-and-swap reports 409 and never confirms a lost customer write", async () => {
  const { repository, store } = fixture();
  await store.addCustomer(SCOPE, customer);
  const before = await repository.read(SCOPE);
  repository.rejectNext = true;
  await assert.rejects(
    store.addCustomer(SCOPE, { ...customer, name: "Zweiter Testkunde" }),
    status(409),
  );
  assert.deepEqual(await repository.read(SCOPE), before);
  assert.equal((await store.state(SCOPE)).customers.length, 1);
});

test("same-payer cases bundle all dates and persons with one immutable archived PDF and idempotent command", async () => {
  const { repository, store } = fixture();
  const first = await store.addBillingCase(
    SCOPE,
    caseInput(),
    "case-command-0001",
  );
  const same = await store.addBillingCase(
    SCOPE,
    caseInput(),
    "case-command-0001",
  );
  assert.equal(first.id, same.id);
  const second = await store.addBillingCase(
    SCOPE,
    caseInput({
      insured: {
        name: "Theo Testperson",
        address: "Demoweg 9",
        insuranceNumber: "TEST-002",
      },
    }),
  );
  const invoice = await store.issueCaseInvoice(
    SCOPE,
    [first.id, second.id],
    "2026-10-22",
    "invoice-command-001",
  );
  assert.equal(invoice.lines.length, 4);
  assert.equal(invoice.billingCaseSnapshots?.length, 2);
  assert.equal(invoice.grossCents, first.grossCents + second.grossCents);
  assert.equal(invoice.netCents + invoice.taxCents, invoice.grossCents);
  const bytes = await store.pdf(SCOPE, invoice.id);
  assert.equal(digest(bytes), invoice.pdfHash);
  assert.equal(new TextDecoder().decode(bytes).startsWith("%PDF-"), true);
  const fresh = new CloudStore(repository, {
    now: timestamp,
    renderPdf: fakePdf,
  });
  const repeated = await fresh.issueCaseInvoice(
    SCOPE,
    [second.id, first.id],
    "2026-10-22",
    "invoice-command-001",
  );
  assert.equal(repeated.id, invoice.id);
  assert.equal((await fresh.state(SCOPE)).invoices.length, 1);
  assert.ok(
    (await fresh.state(SCOPE)).journeys.every(
      (row) => row.invoiceId === invoice.id,
    ),
  );
  assert.ok(
    (await fresh.state(SCOPE)).billingCases.every(
      (row) => row.invoiceId === invoice.id && row.status === "invoiced",
    ),
  );
  await assert.rejects(
    fresh.issueCaseInvoice(
      SCOPE,
      [first.id],
      "2026-10-22",
      "invoice-command-001",
    ),
    status(409),
  );
  await assert.rejects(
    fresh.issueCaseInvoice(
      SCOPE,
      [first.id],
      "2026-10-22",
      "another-command-001",
    ),
    status(409),
  );
  assert.equal(await fresh.verifyAudit(SCOPE), true);
});

test("unverified payer cannot invoice, register-payer loose trips cannot bypass it, and partial cases stay blocked", async () => {
  const { store } = fixture();
  const input = caseInput();
  const item = await store.addBillingCase(SCOPE, {
    ...input,
    payer: { ...input.payer, invoiceReady: false },
  });
  assert.equal(item.status, "draft");
  await assert.rejects(
    store.issueCaseInvoice(SCOPE, [item.id], "2026-10-22"),
    status(422),
  );
  await assert.rejects(
    store.addJourney(SCOPE, {
      ...journeyInput(item.customerId),
      kind: "medical",
      tariff: "I",
      contractConfirmed: true,
      prescriptionConfirmed: true,
      receiptNumber: "TEST-BYPASS",
    }),
    status(422),
  );
  const ready = await store.updateBillingCase(SCOPE, item.id, input);
  assert.equal(ready.status, "ready");
  await assert.rejects(
    store.issueInvoice(SCOPE, [ready.journeyIds[0]], "2026-10-22"),
    status(422),
  );
  assert.equal((await store.state(SCOPE)).invoices.length, 0);
});

test("different payer cases and repeated canonical dates cannot be bundled or persisted as duplicates", async () => {
  const { store } = fixture();
  const first = await store.addBillingCase(SCOPE, caseInput());
  const other = caseInput();
  const second = await store.addBillingCase(SCOPE, {
    ...other,
    payer: { ...other.payer, id: "demo-other", name: "Andere Testkasse" },
  });
  await assert.rejects(
    store.issueCaseInvoice(SCOPE, [first.id, second.id], "2026-10-22"),
    status(422),
  );
  const duplicate = caseInput();
  duplicate.journeys = [
    duplicate.journeys[0],
    { ...duplicate.journeys[0], km: "20.00", from: "  Testort  A " },
  ];
  await assert.rejects(store.addBillingCase(SCOPE, duplicate), status(409));
  await assert.rejects(store.addBillingCase(SCOPE, caseInput()), status(409));
  assert.equal((await store.state(SCOPE)).billingCases.length, 2);
});

test("case correction replaces only its draft trips; billed and cancelled cases remain immutable", async () => {
  const { store } = fixture();
  const item = await store.addBillingCase(SCOPE, caseInput());
  const input = caseInput();
  input.journeys = [{ ...input.journeys[0], date: "2026-10-21", km: "22" }];
  const updated = await store.updateBillingCase(SCOPE, item.id, input);
  assert.equal(updated.createdAt, item.createdAt);
  assert.equal(updated.number, item.number);
  assert.equal(updated.journeyIds.length, 1);
  assert.ok(updated.journeyIds.every((id) => !item.journeyIds.includes(id)));
  assert.equal((await store.state(SCOPE)).journeys.length, 1);
  const invoice = await store.issueCaseInvoice(SCOPE, [item.id], "2026-10-22");
  const original = await store.pdf(SCOPE, invoice.id);
  await store.cancelInvoice(SCOPE, invoice.id, "Fiktiver Erfassungsfehler");
  await assert.rejects(
    store.updateBillingCase(SCOPE, item.id, caseInput()),
    status(409),
  );
  await assert.rejects(
    store.updateJourney(
      SCOPE,
      updated.journeyIds[0],
      journeyInput(updated.customerId),
    ),
    status(409),
  );
  assert.deepEqual(await store.pdf(SCOPE, invoice.id), original);
});

test("global receipt uniqueness also covers case trips and manually entered trips", async () => {
  const { store } = fixture();
  const input = caseInput();
  input.journeys[0].receiptNumber = "DEMO-RECEIPT-1";
  await store.addBillingCase(SCOPE, input);
  const c = await store.addCustomer(SCOPE, customer);
  await assert.rejects(
    store.addJourney(SCOPE, {
      ...journeyInput(c.id),
      receiptNumber: "DEMO-RECEIPT-1",
    }),
    status(409),
  );
});

test("editing while PDF renders rejects stale invoice commit, preserves a number gap, and allows a fresh valid issue", async () => {
  let start!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => (start = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  let first = true;
  const { store } = fixture({
    renderPdf: async (invoice) => {
      if (first) {
        first = false;
        start();
        await gate;
      }
      return fakePdf(invoice);
    },
  });
  const { journey } = await ordinary(store);
  const issuing = store.issueInvoice(
    SCOPE,
    [journey.id],
    "2026-10-22",
    "race-command-001",
  );
  await started;
  await store.updateJourney(SCOPE, journey.id, {
    ...journeyInput(journey.customerId),
    grossCents: 4500,
    description: "Geänderte Testfahrt",
  });
  release();
  await assert.rejects(issuing, status(409));
  assert.equal((await store.state(SCOPE)).invoices.length, 0);
  assert.equal((await store.state(SCOPE)).journeys[0].invoiceId, null);
  const invoice = await store.issueInvoice(
    SCOPE,
    [journey.id],
    "2026-10-22",
    "race-command-001",
  );
  assert.equal(invoice.number, "IT-2026-000002");
  assert.equal(invoice.grossCents, 4500);
});

test("two service instances cannot commit two invoices for one set of journeys", async () => {
  let started!: () => void, release!: () => void;
  const rendering = new Promise<void>((resolve) => (started = resolve)),
    gate = new Promise<void>((resolve) => (release = resolve));
  const { repository, store } = fixture({
    renderPdf: async (invoice) => {
      started();
      await gate;
      return fakePdf(invoice);
    },
  });
  const { journey } = await ordinary(store);
  const first = store.issueInvoice(
    SCOPE,
    [journey.id],
    "2026-10-22",
    "concurrent-command-1",
  );
  await rendering;
  const other = new CloudStore(repository, {
    now: timestamp,
    renderPdf: fakePdf,
  });
  const winner = await other.issueInvoice(
    SCOPE,
    [journey.id],
    "2026-10-22",
    "concurrent-command-2",
  );
  release();
  await assert.rejects(first, status(409));
  assert.equal((await other.state(SCOPE)).invoices.length, 1);
  assert.equal((await other.state(SCOPE)).journeys[0].invoiceId, winner.id);
});

test("payments are bounded and idempotent without regenerating original PDF bytes", async () => {
  const { store } = fixture();
  const { journey } = await ordinary(store);
  const invoice = await store.issueInvoice(SCOPE, [journey.id], "2026-10-22");
  const original = await store.pdf(SCOPE, invoice.id);
  const input = {
    amountCents: 2000,
    date: "2026-10-22",
    note: "Fiktive Teilzahlung",
  };
  await store.addPayment(SCOPE, invoice.id, input, "payment-command-001");
  const repeated = await store.addPayment(
    SCOPE,
    invoice.id,
    input,
    "payment-command-001",
  );
  assert.equal(repeated.payments.length, 1);
  await assert.rejects(
    store.addPayment(
      SCOPE,
      invoice.id,
      { ...input, amountCents: 2001 },
      "payment-command-001",
    ),
    status(409),
  );
  await assert.rejects(
    store.addPayment(SCOPE, invoice.id, { ...input, amountCents: 2000 }),
    status(422),
  );
  await assert.rejects(
    store.cancelInvoice(SCOPE, invoice.id, "Fiktiv"),
    status(422),
  );
  assert.deepEqual(await store.pdf(SCOPE, invoice.id), original);
});

test("cancellation retains immutable original, credit reference, negative tax and locked journey", async () => {
  const { store } = fixture();
  const { journey } = await ordinary(store);
  const invoice = await store.issueInvoice(SCOPE, [journey.id], "2026-10-22");
  const original = await store.pdf(SCOPE, invoice.id);
  const credit = await store.cancelInvoice(
    SCOPE,
    invoice.id,
    "Fiktive Korrektur",
  );
  assert.equal(credit.originalInvoiceId, invoice.id);
  assert.equal(credit.grossCents, -invoice.grossCents);
  assert.equal(credit.netCents, -invoice.netCents);
  assert.equal(credit.taxCents, -invoice.taxCents);
  assert.equal((await store.invoice(SCOPE, invoice.id)).cancelledBy, credit.id);
  assert.equal((await store.state(SCOPE)).journeys[0].invoiceId, invoice.id);
  assert.deepEqual(await store.pdf(SCOPE, invoice.id), original);
  await assert.rejects(
    store.cancelInvoice(SCOPE, invoice.id, "Nochmal"),
    status(409),
  );
  await assert.rejects(
    store.addPayment(SCOPE, credit.id, {
      amountCents: 1,
      date: "2026-10-22",
      note: "",
    }),
    status(422),
  );
});

test("payment during credit rendering prevents stale cancellation from committing", async () => {
  let start!: () => void, release!: () => void;
  const started = new Promise<void>((resolve) => (start = resolve)),
    gate = new Promise<void>((resolve) => (release = resolve));
  const { store } = fixture({
    renderPdf: async (invoice) => {
      if (invoice.originalInvoiceId) {
        start();
        await gate;
      }
      return fakePdf(invoice);
    },
  });
  const { journey } = await ordinary(store);
  const invoice = await store.issueInvoice(SCOPE, [journey.id], "2026-10-22");
  const cancellation = store.cancelInvoice(SCOPE, invoice.id, "Fiktiv");
  await started;
  await store.addPayment(SCOPE, invoice.id, {
    amountCents: 1000,
    date: "2026-10-22",
    note: "Während PDF-Erzeugung",
  });
  release();
  await assert.rejects(cancellation, status(409));
  assert.equal((await store.invoice(SCOPE, invoice.id)).status, "issued");
  assert.equal((await store.state(SCOPE)).invoices.length, 1);
});

test("DTA readiness stays explicitly blocked and never returns a successful transport receipt", async () => {
  const { store } = fixture();
  const item = await store.addBillingCase(SCOPE, caseInput());
  const invoice = await store.issueCaseInvoice(SCOPE, [item.id], "2026-10-22");
  const check = await store.dtaCheck(SCOPE, invoice.id);
  assert.equal(check.status, "blocked");
  assert.equal(check.mode, "dry-run");
  assert.equal(check.format, "readiness-report");
  assert.ok(check.blockers.some((row) => row.code === "SYNTHETIC_ONLY"));
  assert.equal((await store.state(SCOPE)).dtaChecks.length, 1);
  assert.equal(await store.verifyAudit(SCOPE), true);
});

test("payload byte limit rejects financial finalization without a committed invoice or bound journey", async () => {
  const { store } = fixture({
    maxPayloadBytes: 7000,
    renderPdf: async () => new Uint8Array(10_000),
  });
  const { journey } = await ordinary(store);
  await assert.rejects(
    store.issueInvoice(SCOPE, [journey.id], "2026-10-22"),
    status(413),
  );
  const state = await store.state(SCOPE);
  assert.equal(state.invoices.length, 0);
  assert.equal(state.journeys[0].invoiceId, null);
  assert.ok(
    state.audit.some((row) => row.action === "invoice.number_reserved"),
  );
});

test("corrupted audit, invalid JSON and mismatched PDF archive fail closed instead of becoming empty success", async () => {
  const { repository, store } = fixture();
  const { journey } = await ordinary(store);
  const invoice = await store.issueInvoice(SCOPE, [journey.id], "2026-10-22");
  const original = (await repository.read(SCOPE))!;
  const payload = JSON.parse(original.payload);
  payload.pdfs[0].base64 = btoa("corrupt");
  repository.rows.set(SCOPE, { ...original, payload: JSON.stringify(payload) });
  await assert.rejects(store.pdf(SCOPE, invoice.id), status(503));
  payload.audit[0].action = "tampered";
  repository.rows.set(SCOPE, { ...original, payload: JSON.stringify(payload) });
  await assert.rejects(store.state(SCOPE), status(503));
  repository.rows.set(SCOPE, { ...original, payload: "{broken" });
  await assert.rejects(store.state(SCOPE), status(503));
});

test("portable renderer emits a real multi-page German PDF without filesystem fonts and rejects unsupported script", async () => {
  const { store } = fixture({ renderPdf: renderCloudInvoicePdf });
  const item = await store.addBillingCase(SCOPE, caseInput());
  const invoice = await store.issueCaseInvoice(SCOPE, [item.id], "2026-10-22");
  const bytes = await store.pdf(SCOPE, invoice.id);
  assert.equal(digest(bytes), invoice.pdfHash);
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 5)), "%PDF-");
  const actual = await PDFDocument.load(bytes);
  assert.ok(actual.getPageCount() >= 1);
  const long = {
    ...invoice,
    customerSnapshot: {
      ...invoice.customerSnapshot,
      name: "Jörg Müller – große Testanschrift",
      address: Array(50).fill("Lange Testadresse mit Umlauten ÄÖÜ").join("\n"),
    },
    lines: Array.from({ length: 45 }, (_, index) => ({
      ...invoice.lines[0],
      description:
        `Testleistung ${index + 1}\n` + "Lange Beschreibung ".repeat(22),
    })),
  };
  const large = await PDFDocument.load(await renderCloudInvoicePdf(long));
  assert.ok(large.getPageCount() > 3);
  await assert.rejects(
    renderCloudInvoicePdf({
      ...invoice,
      customerSnapshot: { ...invoice.customerSnapshot, name: "اختبار" },
    }),
    (error) => error instanceof CloudPdfError && error.status === 422,
  );
});

test("calendar advance preserves existing originals and refreshes draft readiness without rewriting records on read", async () => {
  const { repository, store } = fixture();
  const { journey } = await ordinary(store);
  const originalInvoice = await store.issueInvoice(
    SCOPE,
    [journey.id],
    "2026-10-22",
  );
  const originalPdf = await store.pdf(SCOPE, originalInvoice.id);
  const futureInput = caseInput({
    journeys: caseInput().journeys.map((row) => ({
      ...row,
      date: "2026-10-23",
    })),
  });
  const futureCase = await store.addBillingCase(SCOPE, futureInput);
  assert.equal(futureCase.status, "draft");
  assert.ok(
    futureCase.blockers.some((message) => message.includes("Zukünftige")),
  );
  const beforeRead = await repository.read(SCOPE);
  const nextDay = new CloudStore(repository, {
    businessDate: "2026-10-23",
    now: () => "2026-10-23T12:00:00Z",
    renderPdf: fakePdf,
  });
  const state = await nextDay.state(SCOPE);
  assert.equal(state.businessDate, "2026-10-23");
  assert.equal(state.billingCases[0].status, "ready");
  assert.equal(state.billingCases[0].blockers.length, 0);
  assert.equal(
    (await nextDay.updateBillingCase(SCOPE, futureCase.id, futureInput)).status,
    "ready",
  );
  assert.deepEqual(await repository.read(SCOPE), beforeRead);
  const invoice = await nextDay.issueCaseInvoice(
    SCOPE,
    [futureCase.id],
    "2026-10-23",
  );
  assert.equal(invoice.number, "IT-2026-000002");
  assert.deepEqual(
    await nextDay.invoice(SCOPE, originalInvoice.id),
    originalInvoice,
  );
  assert.deepEqual(await nextDay.pdf(SCOPE, originalInvoice.id), originalPdf);
  assert.equal(
    JSON.parse((await repository.read(SCOPE))!.payload).businessDate,
    "2026-10-23",
  );
});

test("default business day follows Berlin while unsupported financial years leave archived records readable", async () => {
  const { repository, store } = fixture();
  const { journey } = await ordinary(store);
  const original = await store.issueInvoice(SCOPE, [journey.id], "2026-10-22");
  const bytes = await store.pdf(SCOPE, original.id);
  const berlin = new CloudStore(repository, {
    now: () => "2026-10-22T23:30:00Z",
    renderPdf: fakePdf,
  });
  assert.equal(berlin.businessDate, "2026-10-23");
  assert.equal((await berlin.state(SCOPE)).businessDate, "2026-10-23");
  const nextYear = new CloudStore(repository, {
    now: () => "2027-01-01T12:00:00Z",
    renderPdf: fakePdf,
  });
  assert.equal((await nextYear.state(SCOPE)).businessDate, "2027-01-01");
  assert.deepEqual(await nextYear.pdf(SCOPE, original.id), bytes);
  const before = await repository.read(SCOPE);
  await assert.rejects(
    nextYear.cancelInvoice(
      SCOPE,
      original.id,
      "Test eines nicht unterstützten Jahres",
    ),
  );
  await assert.rejects(
    nextYear.issueInvoice(SCOPE, [journey.id], "2027-01-01"),
  );
  assert.deepEqual(await repository.read(SCOPE), before);
  await nextYear.addCustomer(SCOPE, {
    ...customer,
    name: "Weiterer fiktiver Kontakt",
  });
  assert.equal((await nextYear.state(SCOPE)).customers.length, 2);
  assert.deepEqual(await nextYear.pdf(SCOPE, original.id), bytes);
});

test("selected case IDs cannot change while a repository read waits", async () => {
  const { repository, store } = fixture();
  const first = await store.addBillingCase(SCOPE, caseInput());
  const second = await store.addBillingCase(
    SCOPE,
    caseInput({
      insured: {
        name: "Theo Testperson",
        address: "Fiktiver Weg",
        insuranceNumber: "TEST-SECOND",
      },
    }),
  );
  let started!: () => void, release!: () => void;
  const pending = new Promise<void>((resolve) => (started = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  const read = repository.read.bind(repository);
  repository.read = async (scope) => {
    repository.read = read;
    started();
    await gate;
    return read(scope);
  };
  const selected = [first.id];
  const issuing = store.issueCaseInvoice(SCOPE, selected, "2026-10-22");
  await pending;
  selected[0] = second.id;
  release();
  const invoice = await issuing;
  assert.deepEqual(invoice.billingCaseIds, [first.id]);
  assert.equal((await store.billingCase(SCOPE, second.id)).invoiceId, null);
});

test("selected journey IDs cannot change while a repository read waits", async () => {
  const { repository, store } = fixture();
  const { journey: first } = await ordinary(store);
  const second = await store.addJourney(SCOPE, {
    ...journeyInput(first.customerId),
    date: "2026-10-21",
    from: "Anderer Testbahnhof",
  });
  let started!: () => void, release!: () => void;
  const pending = new Promise<void>((resolve) => (started = resolve));
  const gate = new Promise<void>((resolve) => (release = resolve));
  const read = repository.read.bind(repository);
  repository.read = async (scope) => {
    repository.read = read;
    started();
    await gate;
    return read(scope);
  };
  const selected = [first.id];
  const issuing = store.issueInvoice(SCOPE, selected, "2026-10-22");
  await pending;
  selected[0] = second.id;
  release();
  const invoice = await issuing;
  assert.deepEqual(
    invoice.lines.map((line) => line.journeyId),
    [first.id],
  );
  assert.equal(
    (await store.state(SCOPE)).journeys.find((row) => row.id === second.id)!
      .invoiceId,
    null,
  );
});
