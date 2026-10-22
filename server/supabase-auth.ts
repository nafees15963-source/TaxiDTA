import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}
export interface AuthFactor {
  id: string;
  type: string;
  status: "verified" | "unverified";
  friendlyName?: string;
}
export interface AuthInspection {
  userId: string;
  emailConfirmed: boolean;
  aal: "aal1" | "aal2";
  factors: AuthFactor[];
}
export interface AuthProvider {
  signIn(email: string, password: string): Promise<void>;
  inspect(): Promise<AuthInspection>;
  enrollTotp(): Promise<{ id: string; uri: string; secret: string }>;
  verifyTotp(factorId: string, code: string): Promise<void>;
  cancelEnrollment(factorId: string): Promise<void>;
  accessToken(): Promise<string>;
  signOut(): Promise<void>;
}
export type AuthPhase =
  | "anonymous"
  | "enroll-required"
  | "mfa-required"
  | "authenticated";
export interface AuthView {
  phase: AuthPhase;
  csrfToken: string;
  factors: { id: string; friendlyName?: string }[];
  expiresAt: string;
  ownerConfigured: boolean;
}
export interface AuthEnvelope {
  sessionId: string;
  state: AuthView;
  remoteLogoutConfirmed?: boolean;
}
export interface AuthEnrollment extends AuthEnvelope {
  factorId: string;
  uri: string;
  secret: string;
}
interface Attempts {
  startedAt: number;
  failures: number;
}
interface Session {
  key: string;
  csrf: string;
  createdAt: number;
  lastSeenAt: number;
  phase: AuthPhase;
  provider: AuthProvider | null;
  inspection: AuthInspection | null;
  pendingFactor: string | null;
  loginFailures: Attempts;
  otpFailures: Attempts;
  queue: Promise<unknown>;
}
export interface SupabaseAuthOptions {
  ownerId: string | null;
  createProvider: () => AuthProvider;
  now?: () => number;
  absoluteTtlMs?: number;
  idleTtlMs?: number;
  maxSessions?: number;
}
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const token = () => randomBytes(32).toString("hex");
const expired = () =>
  new AuthError(
    401,
    "AUTH_SESSION_EXPIRED",
    "Die lokale Anmeldesitzung ist abgelaufen. Bitte erneut anmelden.",
  );

/** Server-only, bounded, ephemeral sessions. No provider token or password is exposed in AuthView. */
export class SupabaseAuthService {
  private readonly sessions = new Map<string, Session>();
  private closed = false;
  private readonly ownerId: string | null;
  private readonly now: () => number;
  private readonly absoluteTtlMs: number;
  private readonly idleTtlMs: number;
  private readonly maxSessions: number;
  private globalLogins: Attempts;
  private ownerOtpFailures: Attempts;
  constructor(private readonly options: SupabaseAuthOptions) {
    if (options.ownerId !== null && !UUID.test(options.ownerId))
      throw new AuthError(
        422,
        "AUTH_OWNER_INVALID",
        "Die konfigurierte Inhaber-ID ist keine gültige Auth-Benutzer-ID.",
      );
    this.ownerId = options.ownerId?.toLowerCase() ?? null;
    this.now = options.now ?? Date.now;
    this.absoluteTtlMs = options.absoluteTtlMs ?? 30 * 60_000;
    this.idleTtlMs = options.idleTtlMs ?? 10 * 60_000;
    this.maxSessions = options.maxSessions ?? 100;
    if (
      ![this.absoluteTtlMs, this.idleTtlMs, this.maxSessions].every(
        (n) => Number.isSafeInteger(n) && n > 0,
      ) ||
      this.maxSessions > 1000
    ) {
      throw new AuthError(
        422,
        "AUTH_LIMIT_INVALID",
        "Die lokalen Sitzungsgrenzen sind ungültig.",
      );
    }
    this.globalLogins = { startedAt: this.now(), failures: 0 };
    this.ownerOtpFailures = { startedAt: this.now(), failures: 0 };
  }
  private isExpired(session: Session) {
    const now = this.now();
    return (
      now >= session.createdAt + this.absoluteTtlMs ||
      now >= session.lastSeenAt + this.idleTtlMs
    );
  }
  private assertActive(session: Session): void {
    if (this.closed)
      throw new AuthError(
        503,
        "AUTH_SERVICE_CLOSED",
        "Der lokale Anmeldedienst wurde beendet.",
      );
    if (this.sessions.get(session.key) !== session || this.isExpired(session)) {
      if (this.sessions.get(session.key) === session)
        this.sessions.delete(session.key);
      throw expired();
    }
  }
  /** Recheck after another subsystem's awaited work, without extending the idle deadline. */
  assertSessionActive(id: string): void {
    this.get(id, false);
  }
  private prune() {
    for (const [key, value] of this.sessions)
      if (this.isExpired(value)) this.sessions.delete(key);
  }
  private view(session: Session): AuthView {
    return {
      phase: session.phase,
      csrfToken: session.csrf,
      factors: (session.inspection?.factors ?? [])
        .filter((f) => f.type === "totp" && f.status === "verified")
        .map((f) => ({
          id: f.id,
          ...(f.friendlyName ? { friendlyName: f.friendlyName } : {}),
        })),
      expiresAt: new Date(
        Math.min(
          session.createdAt + this.absoluteTtlMs,
          session.lastSeenAt + this.idleTtlMs,
        ),
      ).toISOString(),
      ownerConfigured: this.ownerId !== null,
    };
  }
  private get(id: string, touch = true): Session {
    if (this.closed)
      throw new AuthError(
        503,
        "AUTH_SERVICE_CLOSED",
        "Der lokale Anmeldedienst wurde beendet.",
      );
    if (!/^[a-f0-9]{64}$/.test(id ?? "")) throw expired();
    const key = digest(id);
    const session = this.sessions.get(key);
    if (!session || this.isExpired(session)) {
      this.sessions.delete(key);
      throw expired();
    }
    if (touch) session.lastSeenAt = this.now();
    return session;
  }
  private rotate(session: Session): AuthEnvelope {
    this.assertActive(session);
    this.sessions.delete(session.key);
    const id = token();
    session.key = digest(id);
    session.csrf = token();
    session.lastSeenAt = this.now();
    this.sessions.set(session.key, session);
    return { sessionId: id, state: this.view(session) };
  }
  private async serial<T>(
    id: string,
    operation: (session: Session) => Promise<T>,
  ): Promise<T> {
    const session = this.get(id);
    const work = session.queue.then(async () => {
      // A preceding queued operation may have rotated, expired or removed this identifier.
      if (this.get(id) !== session) throw expired();
      return operation(session);
    });
    session.queue = work.then(
      () => undefined,
      () => undefined,
    );
    return work;
  }
  private provider(session: Session): AuthProvider {
    if (!session.provider)
      throw new AuthError(
        401,
        "AUTH_LOGIN_REQUIRED",
        "Bitte zuerst mit dem eingerichteten Inhaberkonto anmelden.",
      );
    return session.provider;
  }
  private assertOwner(inspection: AuthInspection) {
    if (
      !this.ownerId ||
      inspection.userId.toLowerCase() !== this.ownerId ||
      inspection.emailConfirmed !== true
    ) {
      throw new AuthError(
        403,
        "AUTH_OWNER_REQUIRED",
        "Dieses bestätigte App-Konto ist nicht als Inhaber von TaxiDTA freigegeben.",
      );
    }
    if (
      !["aal1", "aal2"].includes(inspection.aal) ||
      !Array.isArray(inspection.factors) ||
      inspection.factors.some((f) => !UUID.test(f.id))
    ) {
      throw new AuthError(
        401,
        "AUTH_RESPONSE_UNVERIFIED",
        "Die Anmeldeantwort konnte nicht sicher bestätigt werden.",
      );
    }
    if (
      inspection.aal === "aal2" &&
      !inspection.factors.some((f) => f.status === "verified")
    ) {
      throw new AuthError(
        401,
        "AUTH_MFA_UNVERIFIED",
        "Der zweite Faktor ist für diese Sitzung nicht mehr nachweislich eingerichtet.",
      );
    }
  }
  private async inspect(session: Session) {
    const provider = this.provider(session);
    let inspection: AuthInspection;
    try {
      inspection = await provider.inspect();
      this.assertActive(session);
      this.assertOwner(inspection);
    } catch (error) {
      // Revocation, refresh errors and owner mismatches never fall back to an old cached privilege.
      this.sessions.delete(session.key);
      throw error instanceof AuthError
        ? error
        : new AuthError(
            401,
            "AUTH_SESSION_UNVERIFIED",
            "Die Sitzung konnte nicht beim Anmeldedienst bestätigt werden. Bitte erneut anmelden.",
          );
    }
    session.inspection = inspection;
    session.phase =
      inspection.aal === "aal2"
        ? "authenticated"
        : inspection.factors.some((f) => f.status === "verified")
          ? "mfa-required"
          : "enroll-required";
    return inspection;
  }
  private failureWindow(attempts: Attempts) {
    if (this.now() - attempts.startedAt >= 10 * 60_000) {
      attempts.startedAt = this.now();
      attempts.failures = 0;
    }
    if (attempts.failures >= 6)
      throw new AuthError(
        429,
        "AUTH_RATE_LIMITED",
        "Zu viele fehlgeschlagene Versuche. Bitte zehn Minuten warten oder den späteren Wiederherstellungsweg nutzen.",
      );
  }
  private recordOtpFailure(session: Session) {
    session.otpFailures.failures++;
    this.ownerOtpFailures.failures++;
  }
  bootstrap(id?: string): AuthEnvelope {
    if (this.closed)
      throw new AuthError(
        503,
        "AUTH_SERVICE_CLOSED",
        "Der lokale Anmeldedienst wurde beendet.",
      );
    this.prune();
    if (id) {
      try {
        const session = this.get(id);
        return { sessionId: id, state: this.view(session) };
      } catch {
        /* create only a fresh anonymous session */
      }
    }
    if (this.sessions.size >= this.maxSessions)
      throw new AuthError(
        429,
        "AUTH_SESSION_LIMIT",
        "Zu viele lokale Anmeldesitzungen. Bitte nach Ablauf einer Sitzung erneut versuchen.",
      );
    const createdAt = this.now();
    const key = token();
    const session: Session = {
      key: digest(key),
      csrf: token(),
      createdAt,
      lastSeenAt: createdAt,
      phase: "anonymous",
      provider: null,
      inspection: null,
      pendingFactor: null,
      loginFailures: { startedAt: createdAt, failures: 0 },
      otpFailures: { startedAt: createdAt, failures: 0 },
      queue: Promise.resolve(),
    };
    this.sessions.set(session.key, session);
    return { sessionId: key, state: this.view(session) };
  }
  csrfMatches(id: string, csrf: string) {
    try {
      const expected = Buffer.from(this.get(id, false).csrf);
      const actual = Buffer.from(
        typeof csrf === "string" && csrf.length <= 128 ? csrf : "",
      );
      return (
        expected.length === actual.length && timingSafeEqual(expected, actual)
      );
    } catch {
      return false;
    }
  }
  async login(
    id: string,
    email: string,
    password: string,
  ): Promise<AuthEnvelope> {
    return this.serial(id, async (session) => {
      if (!this.ownerId)
        throw new AuthError(
          409,
          "AUTH_OWNER_NOT_CONFIGURED",
          "Zuerst die bestätigte Auth-Benutzer-ID des einzigen Inhabers sicher konfigurieren.",
        );
      if (session.provider)
        throw new AuthError(
          409,
          "AUTH_ALREADY_STARTED",
          "Eine Anmeldung läuft bereits. Bitte MFA abschließen oder zuerst abmelden.",
        );
      this.failureWindow(session.loginFailures);
      if (this.now() - this.globalLogins.startedAt >= 60_000)
        this.globalLogins = { startedAt: this.now(), failures: 0 };
      if (this.globalLogins.failures >= 20)
        throw new AuthError(
          429,
          "AUTH_RATE_LIMITED",
          "Zu viele lokale Anmeldeversuche. Bitte kurz warten.",
        );
      this.globalLogins.failures++;
      if (
        typeof email !== "string" ||
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        typeof password !== "string" ||
        password.length < 1 ||
        password.length > 1024
      ) {
        session.loginFailures.failures++;
        throw new AuthError(
          422,
          "AUTH_INPUT_INVALID",
          "Bitte eine gültige E-Mail-Adresse und das App-Passwort eingeben.",
        );
      }
      const provider = this.options.createProvider();
      try {
        await provider.signIn(email, password);
        this.assertActive(session);
        const inspection = await provider.inspect();
        this.assertActive(session);
        this.assertOwner(inspection);
        session.provider = provider;
        session.inspection = inspection;
        session.createdAt = this.now();
        session.pendingFactor = null;
        session.phase =
          inspection.aal === "aal2"
            ? "authenticated"
            : inspection.factors.some((f) => f.status === "verified")
              ? "mfa-required"
              : "enroll-required";
        session.loginFailures.failures = 0;
        return this.rotate(session);
      } catch (error) {
        if (!(error instanceof AuthError && error.status >= 500))
          session.loginFailures.failures++;
        try {
          await provider.signOut();
        } catch {
          /* local provider is discarded regardless */
        }
        if (
          error instanceof AuthError &&
          (error.code === "AUTH_OWNER_REQUIRED" ||
            error.code === "AUTH_SESSION_EXPIRED" ||
            error.status >= 500 ||
            error.status === 429)
        )
          throw error;
        throw new AuthError(
          401,
          "AUTH_LOGIN_FAILED",
          "Anmeldung nicht möglich. Bitte App-Konto und Passwort prüfen; ein Dashboard-Konto allein genügt nicht.",
        );
      }
    });
  }
  async current(id: string): Promise<AuthEnvelope> {
    return this.serial(id, async (session) => {
      if (session.provider) await this.inspect(session);
      return { sessionId: id, state: this.view(session) };
    });
  }
  async enroll(id: string): Promise<AuthEnrollment> {
    return this.serial(id, async (session) => {
      const inspection = await this.inspect(session);
      if (
        inspection.aal !== "aal2" &&
        inspection.factors.some((f) => f.status === "verified")
      )
        throw new AuthError(
          403,
          "AUTH_EXISTING_FACTOR_REQUIRED",
          "Zuerst einen vorhandenen zweiten Faktor bestätigen. Ein neuer Faktor darf die bestehende MFA nicht umgehen.",
        );
      if (session.pendingFactor)
        throw new AuthError(
          409,
          "AUTH_ENROLLMENT_PENDING",
          "Für diese Sitzung wurde bereits ein QR-Code erzeugt. Bitte bestätigen oder die Einrichtung abbrechen.",
        );
      const enrolled = await this.provider(session).enrollTotp();
      this.assertActive(session);
      if (
        !UUID.test(enrolled.id) ||
        !/^[A-Z2-7]{16,256}$/.test(enrolled.secret) ||
        enrolled.uri.length > 4096
      )
        throw new AuthError(
          502,
          "AUTH_ENROLLMENT_UNVERIFIED",
          "Die Authenticator-Einrichtung konnte nicht bestätigt werden.",
        );
      let uri: URL;
      try {
        uri = new URL(enrolled.uri);
      } catch {
        throw new AuthError(
          502,
          "AUTH_ENROLLMENT_UNVERIFIED",
          "Die Authenticator-Adresse ist ungültig.",
        );
      }
      if (
        uri.protocol !== "otpauth:" ||
        uri.hostname !== "totp" ||
        uri.searchParams.get("secret") !== enrolled.secret
      )
        throw new AuthError(
          502,
          "AUTH_ENROLLMENT_UNVERIFIED",
          "Die Authenticator-Adresse passt nicht zum Einrichtungsgeheimnis.",
        );
      session.pendingFactor = enrolled.id;
      return {
        sessionId: id,
        state: this.view(session),
        factorId: enrolled.id,
        uri: enrolled.uri,
        secret: enrolled.secret,
      };
    });
  }
  async verify(
    id: string,
    factorId: string,
    code: string,
  ): Promise<AuthEnvelope> {
    return this.serial(id, async (session) => {
      this.failureWindow(session.otpFailures);
      this.failureWindow(this.ownerOtpFailures);
      if (!UUID.test(factorId) || !/^\d{6}$/.test(code)) {
        this.recordOtpFailure(session);
        throw new AuthError(
          422,
          "AUTH_TOTP_INPUT_INVALID",
          "Bitte den sechsstelligen Code aus der Authenticator-App eingeben.",
        );
      }
      const inspection = await this.inspect(session);
      const ownedVerified = inspection.factors.some(
        (f) =>
          f.id === factorId && f.type === "totp" && f.status === "verified",
      );
      if (!ownedVerified && session.pendingFactor !== factorId) {
        this.recordOtpFailure(session);
        throw new AuthError(
          403,
          "AUTH_FACTOR_NOT_OWNED",
          "Dieser Faktor gehört nicht zur bestätigten Anmeldung oder zur aktuellen Einrichtung.",
        );
      }
      try {
        await this.provider(session).verifyTotp(factorId, code);
      } catch (error) {
        if (
          error instanceof AuthError &&
          (error.status >= 500 || error.status === 429)
        )
          throw error;
        this.recordOtpFailure(session);
        throw new AuthError(
          401,
          "AUTH_TOTP_INVALID",
          "Der Authenticator-Code wurde nicht bestätigt. Bitte einen aktuellen Code eingeben.",
        );
      }
      this.assertActive(session);
      const verified = await this.inspect(session);
      if (
        verified.aal !== "aal2" ||
        !verified.factors.some(
          (f) =>
            f.id === factorId && f.type === "totp" && f.status === "verified",
        )
      ) {
        this.sessions.delete(session.key);
        throw new AuthError(
          401,
          "AUTH_MFA_UNVERIFIED",
          "Der Anmeldedienst hat keinen bestätigten zweiten Faktor für diese Sitzung zurückgemeldet.",
        );
      }
      session.pendingFactor = null;
      session.otpFailures.failures = 0;
      this.ownerOtpFailures = { startedAt: this.now(), failures: 0 };
      return this.rotate(session);
    });
  }
  async cancelEnrollment(id: string, factorId: string): Promise<AuthEnvelope> {
    return this.serial(id, async (session) => {
      await this.inspect(session);
      if (session.pendingFactor !== factorId)
        throw new AuthError(
          403,
          "AUTH_FACTOR_NOT_OWNED",
          "Nur die in dieser Sitzung begonnene Einrichtung darf abgebrochen werden.",
        );
      if (
        session.inspection?.factors.some(
          (f) => f.id === factorId && f.status === "verified",
        )
      )
        throw new AuthError(
          403,
          "AUTH_VERIFIED_FACTOR_PROTECTED",
          "Ein bestätigter Faktor kann hier nicht entfernt werden.",
        );
      await this.provider(session).cancelEnrollment(factorId);
      this.assertActive(session);
      session.pendingFactor = null;
      return { sessionId: id, state: this.view(session) };
    });
  }
  async requireMfa(
    id: string,
  ): Promise<{ userId: string; accessToken: string; csrfToken: string }> {
    return this.serial(id, async (session) => {
      const inspection = await this.inspect(session);
      if (inspection.aal !== "aal2")
        throw new AuthError(
          403,
          "AUTH_MFA_REQUIRED",
          "Bitte zuerst den zweiten Faktor bestätigen.",
        );
      const accessToken = await this.provider(session).accessToken();
      this.assertActive(session);
      return {
        userId: inspection.userId,
        accessToken,
        csrfToken: session.csrf,
      };
    });
  }
  close(): void {
    this.closed = true;
    this.sessions.clear();
  }
  async logout(id: string): Promise<AuthEnvelope> {
    return this.serial(id, async (session) => {
      const provider = session.provider;
      this.sessions.delete(session.key);
      const fresh = this.bootstrap();
      let remoteLogoutConfirmed = provider === null;
      if (provider) {
        try {
          await provider.signOut();
          remoteLogoutConfirmed = true;
        } catch {
          /* session already destroyed locally */
        }
      }
      return { ...fresh, remoteLogoutConfirmed };
    });
  }
}
