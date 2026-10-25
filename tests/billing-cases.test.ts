import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../server/store.js";
import {
  billingCaseInputFromRecord,
  billingCaseRequestSchema,
} from "../server/billing-case.js";
import type { BillingCaseInput, Journey } from "../src/shared/types.js";

const base = (): BillingCaseInput => ({
  payer: {
    id: "demo-kasse",
    name: "Fiktive Testkasse",
    ik: "999999994",
    address: "Fantasieweg 1\n00000 Musterstadt",
    invoiceReady: true,
    isSynthetic: true,
    addressKind: "synthetic",
  },
  insured: {
    name: "Fiktiver Versicherter Eins",
    address: "Beispielweg 2\n00000 Musterstadt",
    insuranceNumber: "SYNTHETIC-001",
    dateOfBirth: "1980-01-01",
  },
  prescription: {
    number: "TEST-VERORDNUNG-01",
    issuedAt: "2026-10-01",
    validFrom: "2026-10-01",
    validTo: "2026-10-31",
    confirmed: true,
  },
  tariff: "I",
  contractConfirmed: true,
  vehicle: "taxi",
  sameMunicipality: false,
  journeys: [
    {
      date: "2026-10-02",
      from: "Fiktiver Start",
      to: "Fiktives Ziel",
      km: "20",
      direction: "outbound",
    },
    {
      date: "2026-10-03",
      from: "Fiktives Ziel",
      to: "Fiktiver Start",
      km: "20",
      direction: "return",
    },
  ],
});

test("one prescription with multiple dates creates one case, its payer and exact trip subtotals without a separate customer or fake receipts", () => {
  const store = new Store(":memory:");
  try {
    const result = store.addBillingCase(base(), "case-create-command-01");
    assert.equal(store.customers().length, 1);
    assert.equal(store.customers()[0].kind, "payer");
    assert.equal(store.billingCases().length, 1);
    assert.equal(result.status, "ready");
    assert.equal(result.journeys.length, 2);
    assert.equal(result.grossCents, 10518);
    assert.equal(result.netCents, 9830);
    assert.equal(result.taxCents, 688);
    for (const row of result.journeys) {
      assert.equal(row.grossCents, 5259);
      assert.equal(row.positions?.[0].code, "510100");
      assert.equal(row.positions?.[1].quantity, "17");
      assert.ok(row.internalReference.startsWith(result.number + "/"));
    }
    for (const journey of store.journeys()) {
      assert.equal(journey.billingCaseId, result.id);
      assert.equal(journey.receiptNumber, null);
      assert.equal(journey.prescriptionConfirmed, true);
    }
    assert.equal(store.state().billingCases[0].id, result.id);
    assert.ok(
      !store
        .state()
        .audit.some(
          (event) =>
            event.details.includes(base().insured.name) ||
            event.details.includes(base().insured.insuranceNumber!),
        ),
    );
    const replay = store.addBillingCase(base(), "case-create-command-01");
    assert.equal(replay.id, result.id);
    assert.equal(store.journeys().length, 2);
    assert.throws(
      () =>
        store.addBillingCase(
          { ...base(), tariff: "II" },
          "case-create-command-01",
        ),
      /Vorgangskennung/,
    );
    assert.equal(store.verifyAudit(), true);
  } finally {
    store.close();
  }
});

test("multiple patients with the same payer and matching routes can be bundled into one immutable case invoice and survive reopening", async () => {
  const directory = mkdtempSync(join(tmpdir(), "taxidta-cases-"));
  let store = new Store(join(directory, "test.sqlite"));
  try {
    const first = store.addBillingCase(base());
    const second = store.addBillingCase({
      ...base(),
      insured: {
        ...base().insured,
        name: "Fiktiver Versicherter Zwei",
        insuranceNumber: "SYNTHETIC-002",
      },
    });
    assert.equal(first.customerId, second.customerId);
    assert.equal(store.customers().length, 1);
    const invoice = await store.issueCaseInvoice(
      [first.id, second.id],
      "2026-10-22",
      "case-bundle-command-01",
    );
    assert.equal(invoice.grossCents, 21036);
    assert.equal(invoice.lines.length, 4);
    assert.deepEqual(invoice.billingCaseIds, [first.id, second.id]);
    assert.equal(
      invoice.billingCaseSnapshots?.[0].prescription.number,
      base().prescription.number,
    );
    assert.equal(invoice.lines[0].billingCaseId, first.id);
    assert.equal(invoice.lines[2].insuredName, second.insured.name);
    assert.match(invoice.lines[0].description, /Fiktiver Versicherter Eins/);
    assert.equal(invoice.lines[1].serviceDate, "2026-10-03");
    const pdf = store.pdf(invoice.id);
    assert.equal(pdf.subarray(0, 4).toString(), "%PDF");
    assert.equal(
      (
        await store.issueCaseInvoice(
          [first.id, second.id],
          "2026-10-22",
          "case-bundle-command-01",
        )
      ).id,
      invoice.id,
    );
    assert.equal(store.billingCase(first.id).status, "invoiced");
    store.close();
    store = new Store(join(directory, "test.sqlite"));
    assert.equal(store.billingCase(first.id).invoiceId, invoice.id);
    assert.equal(store.invoice(invoice.id).billingCaseSnapshots?.length, 2);
    assert.deepEqual(store.pdf(invoice.id), pdf);
    assert.equal(store.verifyAudit(), true);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("duplicate submitted dates and duplicate patient journeys across cases are rejected atomically", () => {
  const store = new Store(":memory:");
  try {
    const input = base();
    input.journeys = [input.journeys[0], { ...input.journeys[0], km: "20,00" }];
    assert.throws(() => store.addBillingCase(input), /doppelt/);
    assert.equal(store.customers().length, 0);
    assert.equal(store.journeys().length, 0);
    const first = store.addBillingCase(base());
    assert.throws(
      () =>
        store.addBillingCase({
          ...base(),
          prescription: { ...base().prescription, number: "ANOTHER-REF" },
        }),
      /doppelte Fahrt/,
    );
    assert.equal(store.billingCases().length, 1);
    assert.equal(store.journeys().length, 2);
    assert.equal(store.verifyAudit(), true);
    const before = store.billingCase(first.id);
    assert.throws(() => store.updateBillingCase(first.id, input), /doppelt/);
    assert.deepEqual(store.billingCase(first.id), before);
  } finally {
    store.close();
  }
});

test("reference-only payer data and absent authorizations remain editable drafts and cannot be invoiced through either API path", async () => {
  const store = new Store(":memory:");
  try {
    const input = base();
    input.payer = {
      ...input.payer,
      invoiceReady: false,
      ikStatus: "reference-only",
      addressKind: "headquarters",
    };
    input.contractConfirmed = false;
    input.prescription.confirmed = false;
    const draft = store.addBillingCase(input);
    assert.equal(draft.status, "draft");
    assert.ok(draft.blockers.length >= 3);
    assert.equal(draft.grossCents, 10518);
    assert.throws(
      () =>
        store.addJourney({
          customerId: draft.customerId,
          kind: "medical",
          date: "2026-10-20",
          from: "Anderer Testort",
          to: "Testziel",
          km: "20",
          vehicle: "taxi",
          sameMunicipality: false,
          grossCents: 5259,
          description: "Umgehungsversuch des Registerstatus",
          tariff: "I",
          contractConfirmed: true,
          prescriptionConfirmed: true,
          receiptNumber: "TEST-OTHER",
        }),
      /Registerkassen.*Abrechnungsfall/,
    );
    await assert.rejects(
      store.issueCaseInvoice([draft.id], "2026-10-22"),
      /unvollständig/,
    );
    await assert.rejects(
      store.issueInvoice(draft.journeyIds, "2026-10-22"),
      /unvollständig/,
    );
    assert.equal(store.invoices().length, 0);
    const corrected = store.updateBillingCase(draft.id, base());
    assert.equal(corrected.status, "ready");
    assert.equal(corrected.id, draft.id);
    assert.equal(corrected.createdAt, draft.createdAt);
    const unchanged = store.updateBillingCase(
      draft.id,
      billingCaseInputFromRecord(corrected),
    );
    assert.deepEqual(unchanged, corrected);
    assert.equal(
      (await store.issueCaseInvoice([draft.id], "2026-10-22")).number,
      "IT-2026-000001",
    );
  } finally {
    store.close();
  }
});

test("a case with missing IK/address can be recorded without a new-customer workflow but remains blocked", async () => {
  const store = new Store(":memory:");
  try {
    const input = base();
    input.payer = {
      ...input.payer,
      ik: null,
      address: null,
      invoiceReady: false,
    };
    const result = store.addBillingCase(input);
    assert.equal(result.status, "draft");
    assert.ok(result.blockers.some((s) => s.includes("Kassen-IK")));
    assert.ok(result.blockers.some((s) => s.includes("Abrechnungsanschrift")));
    await assert.rejects(
      store.issueCaseInvoice([result.id], "2026-10-22"),
      /unvollständig/,
    );
    assert.equal(store.invoices().length, 0);
  } finally {
    store.close();
  }
});

test("mixed payers, partial case selection and legacy edits cannot bypass the complete-case invariant", async () => {
  const store = new Store(":memory:");
  try {
    const first = store.addBillingCase(base());
    const other = base();
    other.payer = {
      ...other.payer,
      id: "another-demo-payer",
      ik: "999999995",
      name: "Andere fiktive Kasse",
    };
    other.insured = {
      ...other.insured,
      name: "Andere Testperson",
      insuranceNumber: "SYNTHETIC-003",
    };
    const second = store.addBillingCase(other);
    await assert.rejects(
      store.issueCaseInvoice([first.id, second.id], "2026-10-22"),
      /einem Rechnungsempfänger/,
    );
    await assert.rejects(
      store.issueInvoice([first.journeyIds[0]], "2026-10-22"),
      /vollständig/,
    );
    const journey = store.journeys().find((j) => j.id === first.journeyIds[0])!;
    const { id, createdAt, invoiceId, ...input } = journey;
    assert.throws(
      () => store.updateJourney(id, input),
      /Abrechnungsfall bearbeiten/,
    );
    assert.equal(store.invoices().length, 0);
    assert.equal(store.billingCase(first.id).invoiceId, null);
  } finally {
    store.close();
  }
});

test("case and trip edits stay blocked after invoice cancellation and no case can be billed twice", async () => {
  const store = new Store(":memory:");
  try {
    const result = store.addBillingCase(base());
    const invoice = await store.issueCaseInvoice([result.id], "2026-10-22");
    const original = store.pdf(invoice.id);
    assert.throws(
      () => store.updateBillingCase(result.id, { ...base(), tariff: "II" }),
      /unveränderlich/,
    );
    await assert.rejects(
      store.issueCaseInvoice([result.id], "2026-10-22"),
      /bereits abgerechnet/,
    );
    await store.cancelInvoice(invoice.id, "Fiktiver Korrekturtest");
    assert.throws(
      () => store.updateBillingCase(result.id, base()),
      /unveränderlich/,
    );
    await assert.rejects(
      store.issueCaseInvoice([result.id], "2026-10-22"),
      /bereits abgerechnet/,
    );
    assert.equal(store.billingCase(result.id).invoiceId, invoice.id);
    assert.deepEqual(store.pdf(invoice.id), original);
  } finally {
    store.close();
  }
});

test("changing a draft case while its PDF renders aborts billing and preserves the corrected case", async () => {
  const store = new Store(":memory:");
  try {
    const result = store.addBillingCase(base());
    const pending = store.issueCaseInvoice([result.id], "2026-10-22");
    await Promise.resolve();
    const correctedInput = base();
    correctedInput.journeys[0].km = "21";
    const corrected = store.updateBillingCase(result.id, correctedInput);
    await assert.rejects(pending, /Fallkorrektur ersetzt/);
    assert.equal(store.invoices().length, 0);
    assert.equal(store.billingCase(result.id).invoiceId, null);
    const invoice = await store.issueCaseInvoice([corrected.id], "2026-10-22");
    assert.equal(invoice.grossCents, 10745);
    assert.equal(invoice.number, "IT-2026-000002");
  } finally {
    store.close();
  }
});

test("public case payload accepts only a registry ID and supported exact tariff inputs", () => {
  const { payer, ...input } = base();
  const request = { ...input, sameMunicipality: null, payerId: "demo-kasse" };
  assert.throws(() => billingCaseRequestSchema.parse({ ...request, sameMunicipality: true }));
  assert.throws(() => billingCaseRequestSchema.parse({ ...request, sameMunicipality: false }));
  assert.throws(() => billingCaseRequestSchema.parse({ ...request, journeys: Array.from({length: 21}, () => request.journeys[0]) }));
  assert.equal(billingCaseRequestSchema.parse(request).payerId, "demo-kasse");
  assert.throws(() => billingCaseRequestSchema.parse({ ...request, payer }));
  assert.throws(() =>
    billingCaseRequestSchema.parse({ ...request, invoiceReady: true }),
  );
  assert.throws(() =>
    billingCaseRequestSchema.parse({
      ...request,
      journeys: [{ ...request.journeys[0], grossCents: 1 }],
    }),
  );
  const store = new Store(":memory:");
  try {
    assert.throws(
      () =>
        store.addBillingCase({
          ...base(),
          journeys: [{ ...base().journeys[0], km: "20.5" }],
        }),
      /angebrochene|Teilkilometer|Vertragsregel/,
    );
    assert.throws(
      () =>
        store.addBillingCase({
          ...base(),
          journeys: [{ ...base().journeys[0], date: "2027-01-01" }],
        }),
      /2026|Regel|belegt/,
    );
    assert.equal(store.customers().length, 0);
    assert.equal(store.billingCases().length, 0);
  } finally {
    store.close();
  }
});
