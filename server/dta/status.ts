import { createHash } from "node:crypto";
import { z } from "zod";
import {
  deriveDtaDeliveryStatus,
  type DtaInvoiceReference,
  type DtaReadiness,
  type DtaDeliveryStatus,
  type VerifiedDtaFact,
} from "../../src/domain/dta/status.js";

export { buildUnsentDtaStatus } from "../../src/domain/dta/status.js";
export interface ArchivedDtaEvidence {
  id: string;
  adapterId: string;
  sha256: string;
  original: Uint8Array;
}
export interface DtaEvidenceContext {
  invoiceId: string;
  pdfHash: string;
}
/** Server-registered protocol adapter. Verification must authenticate and parse original bytes. */
export interface DtaEvidenceVerifier {
  id: string;
  mode: "test" | "live";
  verify(
    original: Uint8Array,
    context: Readonly<DtaEvidenceContext>,
  ): Promise<unknown>;
}
export class DtaEvidenceError extends Error {
  readonly status = 422;
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DtaEvidenceError";
  }
}
function fail(code: string, message: string): never {
  throw new DtaEvidenceError(code, message);
}
const claimsSchema = z
  .object({
    kind: z.enum([
      "queued",
      "sending",
      "transmitted",
      "receipt_received",
      "accepted",
      "rejected",
    ]),
    invoiceId: z.string().uuid(),
    pdfHash: z.string().regex(/^[a-f0-9]{64}$/),
    transmissionId: z.string().uuid(),
    occurredAt: z.string().datetime(),
  })
  .strict();

/**
 * No production adapters are registered by default. Manually entered statuses, HTTP 200,
 * readiness reports and user-supplied `accepted: true` cannot produce verified acceptance.
 * This function never sends data or changes a persistent ledger.
 */
export async function buildStatusFromEvidence(
  invoice: DtaInvoiceReference,
  readiness: DtaReadiness | null = null,
  archivedEvents: readonly ArchivedDtaEvidence[] = [],
  options: { verifiers?: readonly DtaEvidenceVerifier[] } = {},
): Promise<DtaDeliveryStatus> {
  if (!Array.isArray(archivedEvents) || archivedEvents.length > 500)
    fail(
      "DTA_EVIDENCE_LIMIT",
      "Zu viele oder ungültige Statusnachweise für einen einzelnen Übertragungsvorgang.",
    );
  const reference = { ...invoice };
  const check = readiness
    ? {
        ...readiness,
        blockers: readiness.blockers.map((item) => ({ ...item })),
      }
    : null;
  let totalBytes = 0;
  for (const event of archivedEvents) {
    if (
      !event ||
      typeof event !== "object" ||
      !(event.original instanceof Uint8Array) ||
      event.original.byteLength === 0 ||
      event.original.byteLength > 2 * 1024 * 1024
    )
      fail(
        "DTA_ORIGINAL_REQUIRED",
        "Die unveränderten Originalbytes des Statusnachweises fehlen oder überschreiten die Prüfgrenze.",
      );
    totalBytes += event.original.byteLength;
    if (totalBytes > 8 * 1024 * 1024)
      fail(
        "DTA_EVIDENCE_LIMIT",
        "Die Originalnachweise überschreiten zusammen die lokale Prüfgrenze.",
      );
  }
  const snapshots = archivedEvents.map((event) => ({
    ...event,
    original: Buffer.from(event.original),
  }));
  const verifiers = new Map<string, DtaEvidenceVerifier>();
  for (const verifier of options.verifiers ?? []) {
    if (
      !verifier.id ||
      verifier.id.length > 120 ||
      verifiers.has(verifier.id) ||
      !["test", "live"].includes(verifier.mode)
    )
      fail(
        "DTA_ADAPTER_CONFIGURATION",
        "Die serverseitige Nachweisprüfung ist nicht eindeutig konfiguriert.",
      );
    verifiers.set(verifier.id, {
      id: verifier.id,
      mode: verifier.mode,
      verify: verifier.verify.bind(verifier),
    });
  }
  const facts: VerifiedDtaFact[] = [];
  try {
    for (const event of snapshots) {
      if (
        typeof event.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(event.sha256) ||
        createHash("sha256").update(event.original).digest("hex") !==
          event.sha256
      )
        fail(
          "DTA_ARTIFACT_CHANGED",
          "Der Statusnachweis stimmt nicht mit den archivierten Originalbytes überein.",
        );
      const verifier = verifiers.get(event.adapterId);
      if (!verifier)
        fail(
          "DTA_ADAPTER_UNAVAILABLE",
          "Für diesen Originalnachweis ist kein geprüfter Protokolladapter eingerichtet.",
        );
      let raw: unknown;
      try {
        raw = await verifier.verify(
          new Uint8Array(event.original),
          Object.freeze({
            invoiceId: reference.id,
            pdfHash: reference.pdfHash,
          }),
        );
      } catch {
        fail(
          "DTA_AUTHENTICITY_UNVERIFIED",
          "Herkunft und Integrität der Originalrückmeldung konnten nicht bestätigt werden.",
        );
      }
      const parsed = claimsSchema.safeParse(raw);
      if (!parsed.success)
        fail(
          "DTA_PROTOCOL_UNVERIFIED",
          "Die geprüfte Rückmeldung enthält keinen unterstützten, eindeutig zuordenbaren Status.",
        );
      if (
        parsed.data.invoiceId !== reference.id ||
        parsed.data.pdfHash !== reference.pdfHash
      )
        fail(
          "DTA_EVIDENCE_CORRELATION",
          "Die Rückmeldung gehört nicht zum unveränderten Rechnungsoriginal.",
        );
      facts.push({
        ...parsed.data,
        id: event.id,
        adapterId: verifier.id,
        mode: verifier.mode,
        artifactSha256: event.sha256,
      });
    }
    return deriveDtaDeliveryStatus(reference, check, facts);
  } finally {
    snapshots.forEach((event) => event.original.fill(0));
  }
}
