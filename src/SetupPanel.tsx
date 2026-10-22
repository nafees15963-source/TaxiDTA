import React, { useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCheck,
  Check,
  Clock3,
  Database,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import "./setup.css";

export interface SetupAuthView {
  phase: "anonymous" | "enroll-required" | "mfa-required" | "authenticated";
  csrfToken: string;
  factors: { id: string; friendlyName?: string }[];
  expiresAt: string;
  ownerConfigured: boolean;
}
export interface SetupStatus {
  configured: boolean;
  projectHost: string | null;
  region: {
    reported: string | null;
    confirmed: string | null;
    expected: string;
    verified: boolean;
  };
  ownerConfigured: boolean;
  ownIkConfigured: boolean;
  authRequired: boolean;
  productionReady: false;
  financialStorage: "local-sqlite";
  dtaTransport: "blocked";
  auth: SetupAuthView | null;
}
interface Enrollment {
  factorId: string;
  qrDataUrl: string;
  secret: string;
}
interface Verification {
  schemaVersion: string;
  syntheticOnly: true;
  writeVerified: true;
  readVerified: true;
  cleanupVerified: true;
  checkedAt: string;
  probeId: string;
}
interface AuthResponse {
  auth?: SetupAuthView;
  enrollment?: Enrollment;
  verification?: Verification;
  error?: string;
}
interface Props {
  gated?: boolean;
  onAuthenticated?: () => void;
  onSignedOut?: () => void;
}

const phases = new Set([
  "anonymous",
  "enroll-required",
  "mfa-required",
  "authenticated",
]);
function isAuth(value: unknown): value is SetupAuthView {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<SetupAuthView>;
  return (
    typeof v.phase === "string" &&
    phases.has(v.phase) &&
    typeof v.csrfToken === "string" &&
    Array.isArray(v.factors) &&
    typeof v.ownerConfigured === "boolean"
  );
}
const safeError = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Die Einrichtung konnte nicht abgeschlossen werden. Bitte erneut versuchen.";
const confirmedAt = (value: string) => {
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf())
    ? new Intl.DateTimeFormat("de-DE", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "Europe/Berlin",
      }).format(parsed)
    : "gerade eben";
};

/** Setup is deliberately separate from the synthetic financial workspace. No auth tokens or inputs are persisted in browser storage. */
export default function SetupPanel({
  gated = false,
  onAuthenticated,
  onSignedOut,
}: Props) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [factorId, setFactorId] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const alive = useRef(true);
  const initialFocus = useRef<HTMLInputElement>(null);
  const id = useId();
  const auth = status?.auth ?? null;

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/setup/status", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(
          "Der Einrichtungsstatus ist nicht erreichbar. Bitte den lokalen Server prüfen.",
        );
      const next = (await response.json()) as SetupStatus;
      if (
        typeof next.configured !== "boolean" ||
        !next.region ||
        (next.auth !== null && !isAuth(next.auth))
      )
        throw new Error(
          "Der Server hat keinen gültigen Einrichtungsstatus geliefert.",
        );
      if (!alive.current) return;
      setStatus(next);
      setFactorId(next.auth?.factors[0]?.id ?? "");
    } catch (e) {
      if (alive.current) setError(safeError(e));
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (gated && !loading && auth?.phase === "anonymous")
      initialFocus.current?.focus();
  }, [gated, loading, auth?.phase]);

  function applyAuth(next: SetupAuthView) {
    setStatus((current) => (current ? { ...current, auth: next } : current));
    setFactorId(next.factors[0]?.id ?? "");
  }
  async function post(
    path: string,
    body: Record<string, unknown>,
    action: string,
  ): Promise<AuthResponse | null> {
    if (busy || !auth) return null;
    setBusy(action);
    setError("");
    setNotice("");
    try {
      const response = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": auth.csrfToken,
        },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as AuthResponse;
      if (isAuth(result.auth)) applyAuth(result.auth);
      if (!response.ok)
        throw new Error(
          typeof result.error === "string" && result.error.length <= 600
            ? result.error
            : "Der Vorgang wurde abgewiesen. Bitte Eingaben und Sitzung prüfen.",
        );
      return result;
    } catch (e) {
      setError(safeError(e));
      return null;
    } finally {
      setBusy(null);
    }
  }
  async function login(event: React.FormEvent) {
    event.preventDefault();
    const result = await post(
      "/api/auth/login",
      { email: email.trim(), password },
      "login",
    );
    setPassword("");
    setCode("");
    setEnrollment(null);
    setShowSecret(false);
    setVerification(null);
    if (result && !isAuth(result.auth)) {
      setError(
        "Der Server hat die Anmeldung nicht bestätigt. Bitte den Status neu laden.",
      );
      return;
    }
    if (result?.auth?.phase === "authenticated") onAuthenticated?.();
  }
  async function enroll() {
    const result = await post("/api/auth/enroll", {}, "enroll");
    if (!result) return;
    const next = result.enrollment;
    if (
      !next ||
      typeof next.factorId !== "string" ||
      typeof next.secret !== "string" ||
      !/^[A-Z2-7]+=*$/i.test(next.secret) ||
      typeof next.qrDataUrl !== "string" ||
      !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(next.qrDataUrl) ||
      next.qrDataUrl.length > 1_000_000
    ) {
      setError(
        "Die Authenticator-Einrichtung konnte nicht sicher angezeigt werden. Bitte den Status prüfen.",
      );
      return;
    }
    setEnrollment(next);
    setFactorId(next.factorId);
    setCode("");
    setShowSecret(false);
  }
  async function verify(event: React.FormEvent) {
    event.preventDefault();
    const result = await post(
      "/api/auth/verify",
      { factorId: enrollment?.factorId ?? factorId, code },
      "verify",
    );
    setCode("");
    if (result?.auth?.phase === "authenticated") {
      setEnrollment(null);
      setPassword("");
      setShowSecret(false);
      setNotice("Der zweite Faktor wurde bestätigt.");
      onAuthenticated?.();
    } else if (result && !isAuth(result.auth))
      setError(
        "Die Bestätigung des zweiten Faktors fehlt. Bitte den Status neu laden.",
      );
  }
  async function cancelEnrollment() {
    if (!enrollment) return;
    const result = await post(
      "/api/auth/cancel-enrollment",
      { factorId: enrollment.factorId },
      "cancel",
    );
    if (result) {
      setEnrollment(null);
      setCode("");
      setShowSecret(false);
      setNotice("Die noch unbestätigte Einrichtung wurde abgebrochen.");
    }
  }
  async function logout() {
    const result = await post("/api/auth/logout", {}, "logout");
    if (result) {
      setEnrollment(null);
      setShowSecret(false);
      setCode("");
      setPassword("");
      setVerification(null);
      setNotice("Du wurdest abgemeldet.");
      onSignedOut?.();
    }
  }
  async function probe() {
    setVerification(null);
    const result = await post("/api/setup/supabase/probe", {}, "probe");
    const next = result?.verification;
    if (
      next?.syntheticOnly === true &&
      next.writeVerified === true &&
      next.readVerified === true &&
      next.cleanupVerified === true &&
      typeof next.checkedAt === "string"
    )
      setVerification(next);
    else if (result)
      setError(
        "Der Datenbanktest wurde nicht vollständig bestätigt. Es wird kein Erfolg angezeigt.",
      );
  }
  const actionContent = (
    key: string,
    label: string,
    icon?: React.ReactNode,
  ) => (
    <>
      {busy === key ? (
        <LoaderCircle size={16} className="setup-spinner" aria-hidden="true" />
      ) : (
        icon
      )}
      {busy === key ? "Bitte warten …" : label}
    </>
  );
  const checking = loading && !status;

  return (
    <section
      className={"setup-panel card " + (gated ? "setup-panel-gated" : "")}
      aria-labelledby={id + "-heading"}
    >
      <div className="setup-header">
        <div className="setup-symbol">
          <ShieldCheck size={23} />
        </div>
        <div>
          <h2 id={id + "-heading"}>Supabase & Inhaber-Anmeldung</h2>
          <p>
            Dein Konto, dein Authenticator und ein klarer Einrichtungsstatus.
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          disabled={!!busy || loading || enrollment !== null}
          aria-label="Einrichtungsstatus neu laden"
          onClick={() => {
            setEnrollment(null);
            setShowSecret(false);
            setCode("");
            void refresh();
          }}
        >
          <RefreshCw size={17} />
        </button>
      </div>
      {gated && (
        <div className="setup-callout">
          <LockKeyhole size={18} />
          <p>
            Für diesen Arbeitsplatz ist die Inhaber-Anmeldung mit zweitem Faktor
            erforderlich. Melde dich an, um die lokale Testumgebung zu öffnen.
          </p>
        </div>
      )}
      {error && (
        <div className="setup-message setup-error" role="alert">
          <AlertTriangle size={18} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="setup-message setup-success" role="status">
          <CheckCheck size={18} />
          <span>{notice}</span>
        </div>
      )}
      {checking ? (
        <div className="setup-loading" role="status">
          <LoaderCircle size={20} className="setup-spinner" />
          <span>Einrichtungsstatus wird gelesen …</span>
        </div>
      ) : (
        status && (
          <>
            <div className="setup-facts">
              <div>
                <Database size={17} />
                <span>
                  Supabase-Projekt
                  <strong>
                    {status.configured
                      ? (status.projectHost ?? "Konfiguriert")
                      : "Noch nicht konfiguriert"}
                  </strong>
                </span>
                <span
                  className={
                    "setup-badge " +
                    (status.configured ? "is-ok" : "is-pending")
                  }
                >
                  {status.configured ? "Hinterlegt" : "Offen"}
                </span>
              </div>
              <div>
                <ShieldCheck size={17} />
                <span>
                  Datenbankregion
                  <strong>
                    {status.region.verified &&
                    status.region.confirmed === "eu-central-1"
                      ? "Frankfurt · eu-central-1"
                      : status.region.reported
                        ? `Gemeldet: ${status.region.reported}`
                        : "Noch nicht verifiziert"}
                  </strong>
                </span>
                <span
                  className={
                    "setup-badge " +
                    (status.region.verified &&
                    status.region.confirmed === "eu-central-1"
                      ? "is-ok"
                      : "is-pending")
                  }
                >
                  {status.region.verified &&
                  status.region.confirmed === "eu-central-1"
                    ? "Geprüft"
                    : "Prüfung offen"}
                </span>
              </div>
              <div>
                <KeyRound size={17} />
                <span>
                  Inhaber-Konto
                  <strong>
                    {status.ownerConfigured
                      ? "Eindeutig hinterlegt"
                      : "Benutzer-Zuordnung fehlt noch"}
                  </strong>
                </span>
                <span
                  className={
                    "setup-badge " +
                    (status.ownerConfigured ? "is-ok" : "is-pending")
                  }
                >
                  {status.ownerConfigured ? "Hinterlegt" : "Offen"}
                </span>
              </div>
              <div>
                <LockKeyhole size={17} />
                <span>
                  Eigenes Leistungserbringer-IK
                  <strong>
                    {status.ownIkConfigured
                      ? "Privat in der Konfiguration hinterlegt"
                      : "Noch nicht hinterlegt"}
                  </strong>
                </span>
                <span
                  className={
                    "setup-badge " +
                    (status.ownIkConfigured ? "is-ok" : "is-pending")
                  }
                >
                  {status.ownIkConfigured ? "Hinterlegt" : "Offen"}
                </span>
              </div>
            </div>
            {(!status.configured || !status.ownerConfigured) && (
              <div className="setup-callout">
                <Clock3 size={18} />
                <p>
                  {!status.configured
                    ? "Die lokale Projektkonfiguration fehlt. Projekt-URL und Publishable Key werden serverseitig eingerichtet."
                    : "Das App-Benutzerkonto muss zuerst eindeutig als Inhaber in der lokalen Konfiguration hinterlegt werden. Das Supabase-Dashboard-Konto ist davon getrennt."}{" "}
                  Passwörter und geheime Schlüssel gehören nicht in den Chat.
                </p>
              </div>
            )}
            {status.configured && status.ownerConfigured && auth && (
              <div className="setup-auth-area">
                <div className="setup-step-heading">
                  <span>
                    {auth.phase === "authenticated" ? <Check size={16} /> : "1"}
                  </span>
                  <div>
                    <h3>Mit deinem Inhaber-Konto anmelden</h3>
                    <p>
                      Nur das eingerichtete Inhaber-Konto kann diesen Ablauf
                      abschließen.
                    </p>
                  </div>
                </div>
                {auth.phase === "anonymous" ? (
                  <form className="setup-login-form" onSubmit={login}>
                    <label htmlFor={id + "-email"}>
                      E-Mail-Adresse
                      <input
                        ref={initialFocus}
                        id={id + "-email"}
                        type="email"
                        name="username"
                        autoComplete="username"
                        inputMode="email"
                        required
                        maxLength={254}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        disabled={!!busy}
                        placeholder="Deine eigene E-Mail-Adresse"
                      />
                    </label>
                    <label htmlFor={id + "-password"}>
                      Passwort
                      <input
                        id={id + "-password"}
                        type="password"
                        name="password"
                        autoComplete="current-password"
                        required
                        maxLength={1024}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={!!busy}
                      />
                    </label>
                    <button
                      className="button primary"
                      disabled={!!busy || !email.trim() || !password}
                    >
                      {actionContent(
                        "login",
                        "Mit Inhaber-Konto anmelden",
                        <KeyRound size={16} />,
                      )}
                    </button>
                  </form>
                ) : (
                  <div className="setup-login-summary">
                    <CheckCheck size={18} />
                    <span>
                      {auth.phase === "authenticated"
                        ? "Inhaber-Anmeldung und zweiter Faktor bestätigt."
                        : "Passwort-Anmeldung bestätigt. Jetzt folgt der zweite Faktor."}
                    </span>
                    <button
                      type="button"
                      className="text-button"
                      onClick={logout}
                      disabled={!!busy}
                    >
                      {actionContent(
                        "logout",
                        "Abmelden",
                        <LogOut size={15} />,
                      )}
                    </button>
                  </div>
                )}
                {auth.phase !== "anonymous" &&
                  auth.phase !== "authenticated" && (
                    <div className="setup-mfa-area">
                      <div className="setup-step-heading">
                        <span>2</span>
                        <div>
                          <h3>Microsoft Authenticator oder andere TOTP-App</h3>
                          <p>
                            {auth.phase === "enroll-required"
                              ? "Einmal einrichten und mit deinem ersten sechsstelligen Code bestätigen."
                              : "Gib den aktuellen Code aus deinem eingerichteten Authenticator ein."}
                          </p>
                        </div>
                      </div>
                      {auth.phase === "enroll-required" && !enrollment && (
                        <button
                          type="button"
                          className="button secondary"
                          onClick={enroll}
                          disabled={!!busy}
                        >
                          {actionContent(
                            "enroll",
                            "Authenticator einrichten",
                            <Smartphone size={17} />,
                          )}
                        </button>
                      )}
                      {enrollment && (
                        <div className="setup-enrollment">
                          <img
                            src={enrollment.qrDataUrl}
                            width={208}
                            height={208}
                            alt="QR-Code zur Einrichtung deines persönlichen Authenticators"
                          />
                          <div>
                            <strong>
                              QR-Code mit deiner Authenticator-App scannen
                            </strong>
                            <p>
                              In Microsoft Authenticator: „Konto hinzufügen“ →
                              „Anderes Konto“ → QR-Code scannen. Dieser Code
                              gehört nur dir.
                            </p>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => setShowSecret(!showSecret)}
                            >
                              {showSecret
                                ? "Manuellen Schlüssel ausblenden"
                                : "Stattdessen manuell einrichten"}
                            </button>
                            {showSecret && (
                              <div className="setup-secret">
                                <span>Persönlicher Einrichtungsschlüssel</span>
                                <code>{enrollment.secret}</code>
                                <small>
                                  Nicht weitergeben und nicht in den Chat
                                  kopieren.
                                </small>
                              </div>
                            )}
                            <button
                              type="button"
                              className="text-button setup-cancel"
                              disabled={!!busy}
                              onClick={cancelEnrollment}
                            >
                              {actionContent("cancel", "Einrichtung abbrechen")}
                            </button>
                          </div>
                        </div>
                      )}
                      {(auth.phase === "mfa-required" || enrollment) && (
                        <form className="setup-verify-form" onSubmit={verify}>
                          {!enrollment && auth.factors.length > 1 && (
                            <label htmlFor={id + "-factor"}>
                              Authenticator auswählen
                              <select
                                id={id + "-factor"}
                                value={factorId}
                                onChange={(e) => setFactorId(e.target.value)}
                                disabled={!!busy}
                              >
                                {auth.factors.map((factor, i) => (
                                  <option value={factor.id} key={factor.id}>
                                    {factor.friendlyName ||
                                      `Authenticator ${i + 1}`}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          {auth.phase === "mfa-required" &&
                          !auth.factors.length ? (
                            <div className="setup-callout">
                              <AlertTriangle size={17} />
                              <p>
                                Die Anmeldung verlangt einen weiteren Faktor,
                                aber kein unterstützter TOTP-Authenticator wurde
                                geliefert. Bitte den bestehenden Faktor über die
                                eingerichtete Wiederherstellung prüfen; ein
                                neuer Faktor wird hier nicht ungeprüft angelegt.
                              </p>
                            </div>
                          ) : (
                            <>
                              <label htmlFor={id + "-code"}>
                                Authenticator-Code
                                <input
                                  id={id + "-code"}
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]{6}"
                                  minLength={6}
                                  maxLength={6}
                                  autoComplete="one-time-code"
                                  onPaste={(event) => {
                                    const pasted = event.clipboardData
                                      .getData("text")
                                      .replace(/\D/g, "")
                                      .slice(0, 6);
                                    if (pasted) {
                                      event.preventDefault();
                                      setCode(pasted);
                                    }
                                  }}
                                  required
                                  value={code}
                                  onChange={(e) =>
                                    setCode(
                                      e.target.value
                                        .replace(/\D/g, "")
                                        .slice(0, 6),
                                    )
                                  }
                                  disabled={!!busy}
                                  placeholder="000000"
                                />
                              </label>
                              <button
                                className="button primary"
                                disabled={
                                  !!busy ||
                                  code.length !== 6 ||
                                  !(enrollment?.factorId || factorId)
                                }
                              >
                                {actionContent(
                                  "verify",
                                  "Code bestätigen",
                                  <ShieldCheck size={16} />,
                                )}
                              </button>
                            </>
                          )}
                        </form>
                      )}
                    </div>
                  )}
                {auth.phase === "authenticated" && (
                  <div className="setup-probe-area">
                    {gated && onAuthenticated && (
                      <button
                        type="button"
                        className="button primary"
                        disabled={!!busy}
                        onClick={onAuthenticated}
                      >
                        Arbeitsplatz öffnen
                      </button>
                    )}
                    <div className="setup-step-heading">
                      <span>3</span>
                      <div>
                        <h3>Datenbankverbindung testen</h3>
                        <p>
                          Ein zufälliger Prüfeintrag wird geschrieben, gelesen
                          und wieder entfernt. Keine Kunden-, Fahrten- oder
                          Gesundheitsdaten werden übertragen.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={probe}
                      disabled={!!busy}
                    >
                      {actionContent(
                        "probe",
                        "Datenbankverbindung testen",
                        <Database size={17} />,
                      )}
                    </button>
                    {verification && (
                      <div className="setup-probe-result" role="status">
                        <CheckCheck size={20} />
                        <div>
                          <strong>Synthetischer Datenbanktest bestanden</strong>
                          <p>
                            Schreiben, Lesen und Entfernen bestätigt ·{" "}
                            {confirmedAt(verification.checkedAt)}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="setup-scope">
              <LockKeyhole size={17} />
              <div>
                <strong>
                  {status.authRequired
                    ? "Anmeldung mit zweitem Faktor für diesen lokalen Arbeitsplatz erforderlich."
                    : "Die lokale Finanzdemo bleibt ohne diese optionale Einrichtung bedienbar."}
                </strong>
                <p>
                  Rechnungen und Fahrten bleiben lokal in SQLite. Die
                  Cloud-Prüfung migriert keine Geschäftsdaten. Produktiver
                  DTA-Versand und die Freigabe für echte Gesundheitsdaten sind
                  weiterhin offen. Passkeys und eine Konto-Wiederherstellung
                  sind in dieser Oberfläche noch nicht umgesetzt.
                </p>
              </div>
            </div>
          </>
        )
      )}
      {!checking && !status && (
        <div className="setup-retry">
          <button
            type="button"
            className="button secondary"
            disabled={!!busy || loading}
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} />
            Status erneut laden
          </button>
        </div>
      )}
    </section>
  );
}
