/** Display model only. A status change is never a substitute for verified transport evidence. */
export type DtaDeliveryState =
  | "validation_blocked"
  | "ready_for_test"
  | "queued"
  | "sending"
  | "transmitted"
  | "receipt_received"
  | "accepted"
  | "rejected";
export type DtaEvidenceKind =
  | "queued"
  | "sending"
  | "transmitted"
  | "receipt_received"
  | "accepted"
  | "rejected";
export interface DtaInvoiceReference {
  id: string;
  pdfHash: string;
  status?: "issued" | "cancelled";
  originalInvoiceId?: string | null;
}
export interface DtaReadiness {
  invoiceId: string;
  status: "blocked" | "ready_for_test";
  blockers: readonly { code: string; message: string }[];
}
/** These facts are produced only by a server-side verifier of the archived original artifact. */
export interface VerifiedDtaFact {
  id: string;
  kind: DtaEvidenceKind;
  invoiceId: string;
  pdfHash: string;
  transmissionId: string;
  occurredAt: string;
  mode: "test" | "live";
  adapterId: string;
  artifactSha256: string;
}
export interface DtaDeliveryStatus {
  invoiceId: string;
  state: DtaDeliveryState;
  sendState: "not_sent" | "queued" | "sending" | "transmitted";
  receiptState: "none" | "received" | "accepted" | "rejected";
  label: string;
  detail: string;
  mode: "unconfigured" | "test" | "live";
  transmissionId: string | null;
  updatedAt: string | null;
  acceptanceVerified: boolean;
  /** No send adapter is currently implemented. Importing a status never enables sending. */
  canSend: false;
  productionReady: false;
  blockers: { code: string; message: string }[];
  timeline: {
    id: string;
    state: DtaEvidenceKind;
    at: string;
    artifactSha256: string;
    adapterId: string;
  }[];
}
export class DtaStatusError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DtaStatusError";
  }
}
function fail(code: string, message: string): never {
  throw new DtaStatusError(code, message);
}
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const sha = /^[a-f0-9]{64}$/;
const kinds = new Set<DtaEvidenceKind>([
  "queued",
  "sending",
  "transmitted",
  "receipt_received",
  "accepted",
  "rejected",
]);
function invoiceValid(invoice: DtaInvoiceReference) {
  if (!uuid.test(invoice.id) || !sha.test(invoice.pdfHash))
    fail(
      "DTA_INVOICE_REFERENCE",
      "Die Rechnung lässt sich keinem unveränderten Original zuordnen.",
    );
}
function validatedBlockers(
  invoice: DtaInvoiceReference,
  readiness: DtaReadiness | null,
) {
  invoiceValid(invoice);
  if (readiness && readiness.invoiceId !== invoice.id)
    fail(
      "DTA_READINESS_MISMATCH",
      "Die Vorprüfung gehört nicht zu dieser Rechnung.",
    );
  const blockers = (
    readiness?.blockers ?? [
      {
        code: "NOT_PREPARED",
        message: "Für diese Rechnung liegt noch keine DTA-Vorprüfung vor.",
      },
    ]
  ).map((item) => ({ code: item.code, message: item.message }));
  if (invoice.status === "cancelled" || invoice.originalInvoiceId)
    blockers.unshift({
      code: "CORRECTION_PROFILE_MISSING",
      message:
        "Für stornierte Rechnungen ist kein DTA-Korrekturverfahren eingerichtet.",
    });
  if (readiness?.status === "blocked" && blockers.length === 0)
    blockers.push({
      code: "VALIDATION_BLOCKED",
      message: "Die technische Vorprüfung ist noch nicht freigegeben.",
    });
  return blockers;
}
export function buildUnsentDtaStatus(
  invoice: DtaInvoiceReference,
  readiness: DtaReadiness | null = null,
): DtaDeliveryStatus {
  const blockers = validatedBlockers(invoice, readiness);
  const ready = readiness?.status === "ready_for_test" && blockers.length === 0;
  return {
    invoiceId: invoice.id,
    state: ready ? "ready_for_test" : "validation_blocked",
    sendState: "not_sent",
    receiptState: "none",
    label: "Nicht versendet",
    detail: ready
      ? "Vorprüfung für einen Test abgeschlossen; Versandadapter noch nicht eingerichtet."
      : "Versand gesperrt. Es liegt kein Übertragungsnachweis vor.",
    mode: ready ? "test" : "unconfigured",
    transmissionId: null,
    updatedAt: null,
    acceptanceVerified: false,
    canSend: false,
    productionReady: false,
    blockers,
    timeline: [],
  };
}
/** Internal reducer for already authenticated facts. Do not pass request bodies to this function. */
export function deriveDtaDeliveryStatus(
  invoice: DtaInvoiceReference,
  readiness: DtaReadiness | null,
  facts: readonly VerifiedDtaFact[],
): DtaDeliveryStatus {
  const result = buildUnsentDtaStatus(invoice, readiness);
  const ids = new Map<string, string>();
  let transmissionId: string | null = null;
  let mode: "test" | "live" | null = null;
  let previousTime: number | undefined;
  for (const fact of facts) {
    const time = Date.parse(fact.occurredAt);
    if (
      !uuid.test(fact.id) ||
      !uuid.test(fact.transmissionId) ||
      !sha.test(fact.pdfHash) ||
      !sha.test(fact.artifactSha256) ||
      !kinds.has(fact.kind) ||
      !["test", "live"].includes(fact.mode) ||
      !fact.adapterId ||
      fact.adapterId.length > 120 ||
      !Number.isFinite(time) ||
      new Date(time).toISOString() !== fact.occurredAt
    )
      fail(
        "DTA_EVIDENCE_SCHEMA",
        "Der bestätigte Statusnachweis ist ungültig.",
      );
    if (fact.invoiceId !== invoice.id || fact.pdfHash !== invoice.pdfHash)
      fail(
        "DTA_EVIDENCE_CORRELATION",
        "Der Statusnachweis gehört nicht zum unveränderten Rechnungsoriginal.",
      );
    const fingerprint = JSON.stringify(fact);
    const prior = ids.get(fact.id);
    if (prior) {
      if (prior !== fingerprint)
        fail(
          "DTA_EVENT_CONFLICT",
          "Eine Statuskennung wurde mit unterschiedlichen Nachweisen wiederverwendet.",
        );
      continue;
    }
    if (transmissionId && transmissionId !== fact.transmissionId)
      fail(
        "DTA_TRANSMISSION_MISMATCH",
        "Die Rückmeldung gehört zu einem anderen Übertragungsvorgang.",
      );
    if (mode && mode !== fact.mode)
      fail(
        "DTA_MODE_MISMATCH",
        "Test- und Echtübertragung dürfen nicht vermischt werden.",
      );
    if (previousTime !== undefined && time < previousTime)
      fail(
        "DTA_EVENT_ORDER",
        "Die archivierte Statusfolge ist zeitlich widersprüchlich.",
      );
    const previous = result.state;
    const allowed =
      fact.kind === "queued"
        ? result.timeline.length === 0
        : fact.kind === "sending"
          ? previous === "queued"
          : fact.kind === "transmitted"
            ? previous === "sending"
            : fact.kind === "receipt_received"
              ? previous === "transmitted"
              : previous === "transmitted" || previous === "receipt_received";
    if (!allowed)
      fail(
        "DTA_TRANSITION_INVALID",
        "Der neue Status passt nicht zu den nachgewiesenen vorherigen Schritten.",
      );
    ids.set(fact.id, fingerprint);
    transmissionId = fact.transmissionId;
    mode = fact.mode;
    previousTime = time;
    result.state = fact.kind;
    result.transmissionId = transmissionId;
    result.mode = mode;
    result.updatedAt = fact.occurredAt;
    result.timeline.push({
      id: fact.id,
      state: fact.kind,
      at: fact.occurredAt,
      artifactSha256: fact.artifactSha256,
      adapterId: fact.adapterId,
    });
    result.sendState =
      fact.kind === "queued"
        ? "queued"
        : fact.kind === "sending"
          ? "sending"
          : "transmitted";
    result.receiptState =
      fact.kind === "accepted"
        ? "accepted"
        : fact.kind === "rejected"
          ? "rejected"
          : fact.kind === "receipt_received"
            ? "received"
            : "none";
    result.acceptanceVerified = fact.kind === "accepted";
  }
  const test = result.mode === "test";
  if (result.state === "queued") {
    result.label = test ? "Testversand vorgemerkt" : "Versand vorgemerkt";
    result.detail =
      "Ein serverseitig bestätigter Auftrag ist vorgemerkt; noch kein Übertragungsnachweis.";
  }
  if (result.state === "sending") {
    result.label = test ? "Testübertragung läuft" : "Übertragung läuft";
    result.detail =
      "Der Start ist nachgewiesen. Eine erfolgreiche Übertragung oder Annahme ist noch nicht bestätigt.";
  }
  if (result.state === "transmitted") {
    result.label = test ? "Testdaten übertragen" : "Übertragen";
    result.detail =
      "Übertragungsnachweis vorhanden. Eine fachliche Annahme ist noch nicht bestätigt.";
  }
  if (result.state === "receipt_received") {
    result.label = "Rückmeldung eingegangen";
    result.detail =
      "Die Originalrückmeldung ist verifiziert und zugeordnet. Eine fachliche Annahme ist noch nicht bestätigt.";
  }
  if (result.state === "accepted") {
    result.label = test ? "Testannahme bestätigt" : "Annahme bestätigt";
    result.detail =
      "Der geprüfte Empfängernachweis bestätigt die Annahme genau dieses Übertragungsvorgangs.";
  }
  if (result.state === "rejected") {
    result.label = test ? "Testdaten abgewiesen" : "Abgewiesen";
    result.detail =
      "Der geprüfte Empfängernachweis weist genau diesen Übertragungsvorgang zurück.";
  }
  return result;
}
