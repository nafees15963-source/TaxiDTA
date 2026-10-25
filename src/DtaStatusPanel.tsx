import { useEffect, useId, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileCheck2,
  RefreshCw,
  Send,
  ShieldCheck,
} from "lucide-react";
import type {
  DtaDeliveryStatus,
  DtaEvidenceKind,
} from "./domain/dta/status.js";
import "./dta-status.css";

const states = new Set([
  "validation_blocked",
  "ready_for_test",
  "queued",
  "sending",
  "transmitted",
  "receipt_received",
  "accepted",
  "rejected",
]);
const factKinds = new Set([
  "queued",
  "sending",
  "transmitted",
  "receipt_received",
  "accepted",
  "rejected",
]);
const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function valid(value: unknown, invoiceId: string): value is DtaDeliveryStatus {
  if (!value || typeof value !== "object") return false;
  const v = value as DtaDeliveryStatus;
  return (
    v.invoiceId === invoiceId &&
    states.has(v.state) &&
    ["not_sent", "queued", "sending", "transmitted"].includes(v.sendState) &&
    ["none", "received", "accepted", "rejected"].includes(v.receiptState) &&
    ["unconfigured", "test", "live"].includes(v.mode) &&
    typeof v.label === "string" &&
    v.label.length <= 160 &&
    typeof v.detail === "string" &&
    v.detail.length <= 1000 &&
    v.productionReady === false &&
    v.canSend === false &&
    typeof v.acceptanceVerified === "boolean" &&
    Array.isArray(v.blockers) &&
    v.blockers.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.code === "string" &&
        typeof item.message === "string" &&
        item.message.length <= 1000,
    ) &&
    Array.isArray(v.timeline) &&
    v.timeline.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        factKinds.has(item.state) &&
        typeof item.at === "string" &&
        Number.isFinite(Date.parse(item.at)) &&
        typeof item.artifactSha256 === "string" &&
        /^[a-f0-9]{64}$/.test(item.artifactSha256),
    ) &&
    v.acceptanceVerified ===
      (v.state === "accepted" && v.receiptState === "accepted") &&
    (!v.acceptanceVerified ||
      (v.sendState === "transmitted" &&
        v.timeline.some((item) => item.state === "accepted")))
  );
}
const eventLabel = (kind: DtaEvidenceKind, test: boolean) =>
  ({
    queued: "Sendeauftrag vorgemerkt",
    sending: "Übertragung begonnen",
    transmitted: "Transport nachgewiesen",
    receipt_received: "Originalrückmeldung geprüft",
    accepted: test ? "Testannahme bestätigt" : "Fachliche Annahme bestätigt",
    rejected: test ? "Testdaten abgewiesen" : "Fachlich abgewiesen",
  })[kind];
const stamp = (value: string) =>
  new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));

/** Read-only status. No manual switch can turn a blocked invoice into a transmitted or accepted one. */
export default function DtaStatusPanel({ invoiceId }: { invoiceId: string }) {
  const [status, setStatus] = useState<DtaDeliveryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const id = useId();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setStatus(null);
    void (async () => {
      try {
        if (!uuid.test(invoiceId))
          throw new Error(
            "Bitte zuerst eine gespeicherte Kassenrechnung auswählen.",
          );
        const response = await fetch(
          `/api/invoices/${encodeURIComponent(invoiceId)}/dta-status`,
          {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const raw = (await response.json()) as unknown;
        if (!response.ok) {
          const message =
            raw && typeof raw === "object" && "error" in raw
              ? raw.error
              : undefined;
          throw new Error(
            typeof message === "string" && message.length <= 600
              ? message
              : "Der Versandstatus konnte nicht geladen werden.",
          );
        }
        const candidate =
          raw && typeof raw === "object" && "status" in raw ? raw.status : raw;
        if (!valid(candidate, invoiceId))
          throw new Error(
            "Der Server hat keinen eindeutig bestätigten Versandstatus geliefert.",
          );
        if (!controller.signal.aborted) setStatus(candidate);
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "Der Versandstatus konnte nicht geladen werden.",
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [invoiceId, revision]);
  const current = status?.invoiceId === invoiceId ? status : null;
  const accepted = !!current?.acceptanceVerified;
  const test = current?.mode === "test";
  const transport = current
    ? {
        not_sent: "Nicht versendet",
        queued: "Vorgemerkt",
        sending: "Wird übertragen",
        transmitted: "Nachgewiesen",
      }[current.sendState]
    : null;
  const receipt = current
    ? {
        none: "Keine Rückmeldung",
        received: "Original eingegangen",
        accepted: test ? "Testannahme bestätigt" : "Annahme bestätigt",
        rejected: "Abgewiesen",
      }[current.receiptState]
    : null;
  return (
    <section className="dta-delivery-panel" aria-labelledby={id + "-heading"}>
      <div className="dta-delivery-heading">
        <div>
          <Send size={19} aria-hidden="true" />
          <h3 id={id + "-heading"}>DTA-Versandstatus</h3>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => setRevision((value) => value + 1)}
          disabled={loading}
          aria-label="Versandstatus aktualisieren"
        >
          <RefreshCw size={16} className={loading ? "dta-status-spin" : ""} />
        </button>
      </div>
      {loading && !current && (
        <p className="dta-status-loading" role="status">
          <Clock3 size={17} />
          Versandstatus wird geprüft …
        </p>
      )}
      {error && (
        <div className="dta-status-error" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}
      {current && (
        <>
          <div
            className={
              "dta-delivery-summary " +
              (accepted
                ? "is-accepted"
                : current.state === "rejected"
                  ? "is-rejected"
                  : "")
            }
          >
            {accepted ? <CheckCircle2 size={21} /> : <ShieldCheck size={21} />}
            <div>
              <strong role="status">{current.label}</strong>
              <p>{current.detail}</p>
            </div>
          </div>
          <dl className="dta-delivery-facts">
            <div>
              <dt>Übertragung</dt>
              <dd>{transport}</dd>
            </div>
            <div>
              <dt>Empfängerrückmeldung</dt>
              <dd>{receipt}</dd>
            </div>
            <div>
              <dt>Verfahren</dt>
              <dd>
                {current.mode === "test"
                  ? "Testübertragung"
                  : current.mode === "live"
                    ? "Echtverfahren"
                    : "Noch nicht eingerichtet"}
              </dd>
            </div>
          </dl>
          {current.blockers.length > 0 && (
            <div className="dta-delivery-blockers">
              <h4>Noch offen</h4>
              <ul>
                {current.blockers.map((item, index) => (
                  <li key={item.code + "-" + index}>{item.message}</li>
                ))}
              </ul>
            </div>
          )}
          {current.timeline.length > 0 ? (
            <details className="dta-delivery-evidence">
              <summary>
                <FileCheck2 size={16} />
                Geprüfte Nachweise anzeigen ({current.timeline.length})
              </summary>
              <ol>
                {current.timeline.map((item) => (
                  <li key={item.id}>
                    <strong>{eventLabel(item.state, test)}</strong>
                    <time dateTime={item.at}>{stamp(item.at)}</time>
                    <small>
                      Originalnachweis:{" "}
                      <code>{item.artifactSha256.slice(0, 16)}…</code>
                    </small>
                  </li>
                ))}
              </ol>
            </details>
          ) : (
            <p className="dta-delivery-empty">
              Für diese Rechnung ist keine Übertragung und keine
              Originalquittung archiviert.
            </p>
          )}
        </>
      )}
    </section>
  );
}
