import { randomUUID } from "node:crypto";
import {
  createClient,
  isAuthRetryableFetchError,
  AuthUnknownError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  AuthError,
  type AuthInspection,
  type AuthProvider,
} from "./supabase-auth.js";

export interface SupabaseProviderConfig {
  url: string;
  publishableKey: string;
}
interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}
const providerError = (error: unknown, fallback: AuthError): AuthError => {
  if (
    isAuthRetryableFetchError(error) ||
    error instanceof AuthUnknownError ||
    (typeof error === "object" &&
      error !== null &&
      "status" in error &&
      typeof error.status === "number" &&
      error.status >= 500)
  )
    return new AuthError(
      503,
      "AUTH_NETWORK_UNAVAILABLE",
      "Der Anmeldedienst ist aus dieser Umgebung nicht erreichbar oder antwortet vorübergehend nicht zuverlässig. Das Passwort wurde damit nicht geprüft.",
    );
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 429
  )
    return new AuthError(
      429,
      "AUTH_RATE_LIMITED",
      "Der Anmeldedienst begrenzt weitere Versuche. Bitte später erneut versuchen.",
    );
  return fallback;
};
const unauthorized = () =>
  new AuthError(
    401,
    "AUTH_PROVIDER_SESSION_INVALID",
    "Die Anmeldung konnte nicht beim Anmeldedienst bestätigt werden.",
  );
/** Official SDK adapter. It only retains tokens in this server object's memory. */
export class SupabaseSdkAuthProvider implements AuthProvider {
  private client: SupabaseClient;
  private tokens: Tokens | null = null;
  private inspectedToken: string | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly config: SupabaseProviderConfig,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    let url: URL;
    try {
      url = new URL(config.url);
    } catch {
      throw new AuthError(
        422,
        "AUTH_CONFIG_INVALID",
        "Ungültige Supabase-Projektadresse.",
      );
    }
    if (
      url.protocol !== "https:" ||
      !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) ||
      url.port ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey)
    ) {
      throw new AuthError(
        422,
        "AUTH_CONFIG_INVALID",
        "Nur eine Supabase-Cloudadresse mit Publishable Key ist für diese Anbindung zulässig.",
      );
    }
    this.client = this.newClient();
  }
  private newClient(): SupabaseClient {
    return createClient(this.config.url, this.config.publishableKey, {
      auth: {
        storageKey: `taxidta-server-${randomUUID()}`,
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        debug: false,
      },
      global: { fetch: this.fetchImpl },
    });
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private save(data: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    expires_at?: number;
  }) {
    if (
      typeof data.access_token !== "string" ||
      data.access_token.length < 10 ||
      data.access_token.length > 16384 ||
      typeof data.refresh_token !== "string" ||
      data.refresh_token.length < 1 ||
      data.refresh_token.length > 16384 ||
      !Number.isFinite(data.expires_in) ||
      data.expires_in <= 0
    )
      throw unauthorized();
    const expiresAt = data.expires_at
      ? data.expires_at * 1000
      : this.now() + data.expires_in * 1000;
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now())
      throw unauthorized();
    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
    };
  }
  private async freshTokens(): Promise<Tokens> {
    if (!this.tokens) throw unauthorized();
    // auth-js 2.118 also refreshes SDK calls inside a 90-second margin. Preempt it serially
    // and surface refresh failure rather than silently retaining a cached AAL2 token.
    if (this.tokens.expiresAt <= this.now() + 90_000) {
      // A fresh SDK instance has no stored old session for refreshSession's _useSession
      // to refresh implicitly before the explicit refresh. Never reuse a rotated old token.
      const refreshedClient = this.newClient();
      const refreshed = await refreshedClient.auth.refreshSession({
        refresh_token: this.tokens.refreshToken,
      });
      if (refreshed.error || !refreshed.data.session) {
        this.tokens = null;
        throw providerError(refreshed.error, unauthorized());
      }
      this.save(refreshed.data.session);
      this.client = refreshedClient;
    }
    if (!this.tokens || this.tokens.expiresAt <= this.now()) {
      this.tokens = null;
      throw unauthorized();
    }
    return this.tokens;
  }
  async signIn(email: string, password: string) {
    await this.serial(async () => {
      const result = await this.client.auth.signInWithPassword({
        email,
        password,
      });
      if (result.error || !result.data.session)
        throw providerError(
          result.error,
          new AuthError(
            401,
            "AUTH_CREDENTIALS_REJECTED",
            "Das App-Konto oder Passwort wurde nicht bestätigt.",
          ),
        );
      this.save(result.data.session);
    });
  }
  async inspect(): Promise<AuthInspection> {
    return this.serial(async () => {
      const session = await this.freshTokens();
      // Explicit JWT arguments cause remote user validation; local getSession() is not authorization.
      const userResult = await this.client.auth.getUser(session.accessToken);
      if (
        userResult.error ||
        !userResult.data.user ||
        userResult.data.user.is_anonymous
      )
        throw providerError(userResult.error, unauthorized());
      const assurance =
        await this.client.auth.mfa.getAuthenticatorAssuranceLevel(
          session.accessToken,
        );
      if (
        assurance.error ||
        !assurance.data ||
        !["aal1", "aal2"].includes(assurance.data.currentLevel ?? "")
      )
        throw providerError(assurance.error, unauthorized());
      if (this.tokens !== session || session.expiresAt <= this.now())
        throw unauthorized();
      const user = userResult.data.user;
      this.inspectedToken = session.accessToken;
      return {
        userId: user.id,
        emailConfirmed:
          typeof user.email_confirmed_at === "string" &&
          user.email_confirmed_at.length > 0,
        aal: assurance.data.currentLevel as "aal1" | "aal2",
        factors: (user.factors ?? []).map((f) => ({
          id: f.id,
          type: f.factor_type,
          status: f.status,
          ...(f.friendly_name ? { friendlyName: f.friendly_name } : {}),
        })),
      };
    });
  }
  async enrollTotp() {
    return this.serial(async () => {
      await this.freshTokens();
      const result = await this.client.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `TaxiDTA-${randomUUID().slice(0, 8)}`,
      });
      if (result.error || !result.data || result.data.type !== "totp")
        throw providerError(
          result.error,
          new AuthError(
            502,
            "AUTH_ENROLLMENT_FAILED",
            "Der Authenticator-Faktor konnte nicht eingerichtet werden.",
          ),
        );
      return {
        id: result.data.id,
        uri: result.data.totp.uri,
        secret: result.data.totp.secret,
      };
    });
  }
  async verifyTotp(factorId: string, code: string) {
    await this.serial(async () => {
      await this.freshTokens();
      const result = await this.client.auth.mfa.challengeAndVerify({
        factorId,
        code,
      });
      if (result.error || !result.data)
        throw providerError(
          result.error,
          new AuthError(
            401,
            "AUTH_TOTP_INVALID",
            "Der Authenticator-Code wurde nicht bestätigt.",
          ),
        );
      this.save(result.data);
    });
  }
  async cancelEnrollment(factorId: string) {
    await this.serial(async () => {
      await this.freshTokens();
      const result = await this.client.auth.mfa.unenroll({ factorId });
      if (result.error || result.data.id !== factorId)
        throw new AuthError(
          502,
          "AUTH_ENROLLMENT_CANCEL_FAILED",
          "Der unverifizierte Einrichtungsversuch konnte nicht entfernt werden.",
        );
    });
  }
  async accessToken() {
    return this.serial(async () => {
      // Never rotate a JWT after its owner/AAL was checked and before the protected RPC.
      // An expired or not-yet-inspected token requires a fresh inspection instead.
      if (
        !this.tokens ||
        this.tokens.expiresAt <= this.now() ||
        this.inspectedToken !== this.tokens.accessToken
      )
        throw unauthorized();
      return this.tokens.accessToken;
    });
  }
  async signOut() {
    await this.serial(async () => {
      this.tokens = null;
      this.inspectedToken = null;
      const result = await this.client.auth.signOut({ scope: "local" });
      if (result.error)
        throw new AuthError(
          503,
          "AUTH_REMOTE_LOGOUT_UNCONFIRMED",
          "Die lokale Sitzung ist beendet; eine Sperre beim Anmeldedienst wurde nicht bestätigt.",
        );
    });
  }
}
export function createSupabaseProviderFactory(
  config: SupabaseProviderConfig,
  fetchImpl: typeof fetch = fetch,
): () => AuthProvider {
  return () => new SupabaseSdkAuthProvider(config, fetchImpl);
}
