import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  buildUnsentDtaStatus,
  DtaStatusError,
  type DtaEvidenceKind,
  type DtaInvoiceReference,
  type DtaReadiness,
} from "../src/domain/dta/status.ts";
import {
  buildStatusFromEvidence,
  DtaEvidenceError,
  type ArchivedDtaEvidence,
  type DtaEvidenceVerifier,
} from "../server/dta/status.ts";

const invoice: DtaInvoiceReference = {
  id: "90000000-0000-4000-8000-000000000001",
  pdfHash: "1".repeat(64),
  status: "issued",
};
const transmissionId = "90000000-0000-4000-8000-000000000002";
const secret = "SYNTHETIC HMAC TEST ADAPTER ONLY";
const blocked: DtaReadiness = {
  invoiceId: invoice.id,
  status: "blocked",
  blockers: [
    {
      code: "TRANSPORT_NOT_IMPLEMENTED",
      message: "Kein Versandadapter eingerichtet.",
    },
  ],
};
const ready: DtaReadiness = {
  invoiceId: invoice.id,
  status: "ready_for_test",
  blockers: [],
};
const hash = (value: Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
const hmac = (value: string) =>
  createHmac("sha256", secret).update(value).digest("hex");
const verifier: DtaEvidenceVerifier = {
  id: "synthetic-authenticated-protocol",
  mode: "test",
  async verify(original) {
    const parsed = JSON.parse(new TextDecoder().decode(original));
    const expected = Buffer.from(hmac(parsed.claims), "hex");
    const actual = Buffer.from(parsed.mac, "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new Error("Invalid synthetic signature");
    return JSON.parse(parsed.claims);
  },
};
const options = { verifiers: [verifier] };
function event(
  kind: DtaEvidenceKind,
  index: number,
  overrides: Record<string, unknown> = {},
): ArchivedDtaEvidence {
  const claims = JSON.stringify({
    kind,
    invoiceId: invoice.id,
    pdfHash: invoice.pdfHash,
    transmissionId,
    occurredAt: `2026-10-22T12:00:${String(index).padStart(2, "0")}.000Z`,
    ...overrides,
  });
  const original = Buffer.from(JSON.stringify({ claims, mac: hmac(claims) }));
  return {
    id: `90000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`,
    adapterId: verifier.id,
    sha256: hash(original),
    original,
  };
}
const code = (expected: string) => (error: unknown) =>
  (error instanceof DtaEvidenceError || error instanceof DtaStatusError) &&
  error.code === expected;
const sequence = (last: DtaEvidenceKind = "accepted") => {
  const kinds: DtaEvidenceKind[] = ["queued", "sending", "transmitted"];
  if (last === "receipt_received" || last === "accepted" || last === "rejected")
    kinds.push("receipt_received");
  if (last === "accepted" || last === "rejected") kinds.push(last);
  return kinds.map((kind, i) => event(kind, i));
};

test("an unsent invoice stays visibly not sent and blocked; a readiness report is no receipt", async () => {
  const status = await buildStatusFromEvidence(invoice, blocked);
  assert.equal(status.state, "validation_blocked");
  assert.equal(status.sendState, "not_sent");
  assert.equal(status.label, "Nicht versendet");
  assert.equal(status.receiptState, "none");
  assert.equal(status.acceptanceVerified, false);
  assert.equal(status.productionReady, false);
  assert.equal(status.canSend, false);
  assert.equal(status.transmissionId, null);
  assert.deepEqual(status.timeline, []);
  assert.equal(status.blockers[0].code, "TRANSPORT_NOT_IMPLEMENTED");
  assert.equal(buildUnsentDtaStatus(invoice).blockers[0].code, "NOT_PREPARED");
  const prepared = buildUnsentDtaStatus(invoice, ready);
  assert.equal(prepared.state, "ready_for_test");
  assert.equal(prepared.canSend, false);
  assert.equal(prepared.sendState, "not_sent");
});

test("manual or unconfigured accepted claims cannot create an accepted delivery status", async () => {
  await assert.rejects(
    () => buildStatusFromEvidence(invoice, blocked, [event("accepted", 0)]),
    code("DTA_ADAPTER_UNAVAILABLE"),
  );
  await assert.rejects(
    () =>
      buildStatusFromEvidence(invoice, blocked, [
        {
          id: "manual",
          adapterId: "manual-entry",
          sha256: "0".repeat(64),
          original: new Uint8Array(),
        },
      ]),
    code("DTA_ORIGINAL_REQUIRED"),
  );
  await assert.rejects(
    () =>
      buildStatusFromEvidence(invoice, blocked, [
        { ...event("accepted", 0), original: Buffer.from('{"accepted":true}') },
      ]),
    code("DTA_ARTIFACT_CHANGED"),
  );
});

test("actual authenticated synthetic artifacts support a correlated timeline without claiming live GKV acceptance", async () => {
  const events = sequence();
  const status = await buildStatusFromEvidence(invoice, ready, events, options);
  assert.equal(status.state, "accepted");
  assert.equal(status.mode, "test");
  assert.equal(status.label, "Testannahme bestätigt");
  assert.equal(status.sendState, "transmitted");
  assert.equal(status.receiptState, "accepted");
  assert.equal(status.acceptanceVerified, true);
  assert.equal(status.transmissionId, transmissionId);
  assert.equal(status.timeline.length, 5);
  assert.equal(status.timeline[4].artifactSha256, events[4].sha256);
  assert.equal(status.productionReady, false);
  assert.equal(status.canSend, false);
});

test("transmission and unclassified received feedback never mean that the invoice was accepted", async () => {
  const transmitted = await buildStatusFromEvidence(
    invoice,
    ready,
    sequence("transmitted"),
    options,
  );
  assert.equal(transmitted.state, "transmitted");
  assert.equal(transmitted.acceptanceVerified, false);
  assert.equal(transmitted.receiptState, "none");
  assert.match(transmitted.detail, /Annahme.*nicht bestätigt/);
  const received = await buildStatusFromEvidence(
    invoice,
    ready,
    sequence("receipt_received"),
    options,
  );
  assert.equal(received.state, "receipt_received");
  assert.equal(received.receiptState, "received");
  assert.equal(received.acceptanceVerified, false);
  const rejected = await buildStatusFromEvidence(
    invoice,
    ready,
    sequence("rejected"),
    options,
  );
  assert.equal(rejected.state, "rejected");
  assert.equal(rejected.acceptanceVerified, false);
  assert.equal(rejected.receiptState, "rejected");
});

test("changed original bytes or invalid authenticated signatures are refused before any status is derived", async () => {
  const modified = event("queued", 0);
  modified.original[0] ^= 1;
  await assert.rejects(
    () => buildStatusFromEvidence(invoice, ready, [modified], options),
    code("DTA_ARTIFACT_CHANGED"),
  );
  const forged = event("queued", 0);
  const content = JSON.parse(new TextDecoder().decode(forged.original));
  content.mac = "0".repeat(64);
  forged.original = Buffer.from(JSON.stringify(content));
  forged.sha256 = hash(forged.original);
  await assert.rejects(
    () => buildStatusFromEvidence(invoice, ready, [forged], options),
    code("DTA_AUTHENTICITY_UNVERIFIED"),
  );
});

test("a signed artifact must refer to the same invoice, PDF and transmission; cross-mode feedback is rejected", async () => {
  for (const override of [
    { invoiceId: "90000000-0000-4000-8000-000000000009" },
    { pdfHash: "2".repeat(64) },
  ]) {
    await assert.rejects(
      () =>
        buildStatusFromEvidence(
          invoice,
          ready,
          [event("queued", 0, override)],
          options,
        ),
      code("DTA_EVIDENCE_CORRELATION"),
    );
  }
  const wrongAttempt = [
    ...sequence("transmitted"),
    event("accepted", 4, {
      transmissionId: "90000000-0000-4000-8000-000000000099",
    }),
  ];
  await assert.rejects(
    () => buildStatusFromEvidence(invoice, ready, wrongAttempt, options),
    code("DTA_TRANSMISSION_MISMATCH"),
  );
  const liveVerifier = {
    ...verifier,
    id: "other-live-adapter",
    mode: "live" as const,
  };
  const mixed = [
    ...sequence("transmitted"),
    { ...event("accepted", 4), adapterId: liveVerifier.id },
  ];
  await assert.rejects(
    () =>
      buildStatusFromEvidence(invoice, ready, mixed, {
        verifiers: [verifier, liveVerifier],
      }),
    code("DTA_MODE_MISMATCH"),
  );
});

test("out-of-order acceptance, terminal reversal and conflicting reused event IDs are refused; identical replay is idempotent", async () => {
  await assert.rejects(
    () =>
      buildStatusFromEvidence(invoice, ready, [event("accepted", 0)], options),
    code("DTA_TRANSITION_INVALID"),
  );
  const accepted = sequence();
  await assert.rejects(
    () =>
      buildStatusFromEvidence(
        invoice,
        ready,
        [...accepted, event("rejected", 5)],
        options,
      ),
    code("DTA_TRANSITION_INVALID"),
  );
  const replay = [...accepted, accepted[4]];
  const repeated = await buildStatusFromEvidence(
    invoice,
    ready,
    replay,
    options,
  );
  assert.equal(repeated.timeline.length, 5);
  const conflict = event("accepted", 5);
  conflict.id = accepted[4].id;
  await assert.rejects(
    () =>
      buildStatusFromEvidence(invoice, ready, [...accepted, conflict], options),
    code("DTA_EVENT_CONFLICT"),
  );
  await assert.rejects(
    () =>
      buildStatusFromEvidence(
        invoice,
        ready,
        [event("queued", 2), event("sending", 1)],
        options,
      ),
    code("DTA_EVENT_ORDER"),
  );
});

test("readiness for another invoice and cancelled invoice handling cannot authorize new sending", () => {
  assert.throws(
    () =>
      buildUnsentDtaStatus(invoice, {
        ...blocked,
        invoiceId: "90000000-0000-4000-8000-000000000009",
      }),
    code("DTA_READINESS_MISMATCH"),
  );
  const cancelled = buildUnsentDtaStatus(
    { ...invoice, status: "cancelled" },
    ready,
  );
  assert.equal(cancelled.state, "validation_blocked");
  assert.equal(cancelled.canSend, false);
  assert.equal(cancelled.blockers[0].code, "CORRECTION_PROFILE_MISSING");
});

test("proof inputs and invoice correlation are snapshotted before awaited adapter verification", async () => {
  const mutableInvoice = { ...invoice };
  const events = sequence();
  const delayed = {
    ...verifier,
    async verify(...args: Parameters<DtaEvidenceVerifier["verify"]>) {
      await Promise.resolve();
      return verifier.verify(...args);
    },
  };
  const pending = buildStatusFromEvidence(mutableInvoice, ready, events, {
    verifiers: [delayed],
  });
  mutableInvoice.pdfHash = "9".repeat(64);
  events.forEach((item) => {
    item.original.fill(0);
    item.sha256 = "0".repeat(64);
  });
  const status = await pending;
  assert.equal(status.state, "accepted");
  assert.equal(status.transmissionId, transmissionId);
});
