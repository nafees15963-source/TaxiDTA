import { createClient, isAuthRetryableFetchError, AuthUnknownError, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import { z } from 'zod';
// The pure core + SVG tag renderer deliberately avoid qrcode's Node fs/canvas entry points.
// @ts-expect-error qrcode does not publish declarations for its pure internal modules.
import qrCore from 'qrcode/lib/core/qrcode.js';
// @ts-expect-error qrcode does not publish declarations for its pure internal modules.
import qrSvg from 'qrcode/lib/renderer/svg-tag.js';

export interface EdgeAuthEnvironment {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_OWNER_ID: string;
  TAXIDTA_SESSION_KEY: string;
}
export interface EdgeAuthView {
  phase: 'anonymous' | 'enroll-required' | 'mfa-required' | 'authenticated';
  csrfToken: string;
  factors: { id: string; friendlyName?: string }[];
  expiresAt: string;
  ownerConfigured: boolean;
}
export interface EdgeAuthResult {
  auth: EdgeAuthView;
  /** HTTP Set-Cookie only: never include this field in a JSON response. */
  cookie: string;
  enrollment?: { factorId: string; qrDataUrl: string; secret: string };
  remoteLogoutConfirmed?: boolean;
}
export interface EdgeAuthContext {
  userId: string;
  accessToken: string;
  csrfToken: string;
  cookie: string;
  webSession: { nonceHash: string; generation: number };
  assertActive(): Promise<void>;
}
export class EdgeAuthError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'EdgeAuthError';
  }
}
interface Options { fetchImpl?: typeof fetch; now?: () => number }
const COOKIE_NAME = '__Host-taxidta_session';
const ABSOLUTE_MS = 30 * 60_000;
const IDLE_MS = 10 * 60_000;
const TOKEN_MARGIN_MS = 120_000;
const HEX = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const credentials = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(1024) }).strict();
const factorInput = z.object({ factorId: z.string().regex(UUID) }).strict();
const verification = factorInput.extend({ code: z.string().regex(/^\d{6}$/) }).strict();
const stateSchema = z.object({
  v: z.literal(1), csrf: z.string().regex(HEX), created: z.number().int(), seen: z.number().int(),
  deadline: z.number().int(), nonce: z.string().regex(HEX).nullable(), generation: z.number().int().min(0).max(1_000_000_000),
  access: z.string().max(4096).nullable(), refresh: z.string().max(2048).nullable(),
  pending: z.string().regex(UUID).nullable(),
}).strict();
type CookieState = z.infer<typeof stateSchema>;
interface Inspection { user: User; aal: 'aal1' | 'aal2'; factors: NonNullable<User['factors']> }
const expired = () => new EdgeAuthError(401, 'AUTH_SESSION_EXPIRED', 'Die Anmeldung ist abgelaufen oder wurde widerrufen. Bitte erneut anmelden.');
const unavailable = () => new EdgeAuthError(503, 'AUTH_NETWORK_UNAVAILABLE', 'Der Anmeldedienst ist derzeit nicht zuverlässig erreichbar. Bitte erneut versuchen.');
const rejected = () => new EdgeAuthError(401, 'AUTH_CREDENTIALS_REJECTED', 'Das App-Konto oder Passwort wurde nicht bestätigt.');
const invalidInput = () => new EdgeAuthError(422, 'AUTH_INPUT_INVALID', 'Die Angaben zur Anmeldung sind ungültig.');
const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const unb64url = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));
const parseInput = <T>(schema: z.ZodType<T>, input: unknown): T => {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw invalidInput();
  return parsed.data;
};
const providerError = (error: unknown, fallback: EdgeAuthError) => {
  if (error instanceof EdgeAuthError) return error;
  if (isAuthRetryableFetchError(error) || error instanceof AuthUnknownError || (error && typeof error === 'object' && 'status' in error && Number(error.status) >= 500)) return unavailable();
  if (error && typeof error === 'object' && 'status' in error && Number(error.status) === 429)
    return new EdgeAuthError(429, 'AUTH_RATE_LIMITED', 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.');
  return fallback;
};

/** One instance per authenticated Sites request. No tokens or SDK storage cross requests. */
export function createEdgeAuth(env: EdgeAuthEnvironment, request: Request, siteUserId: string, options: Options = {}) {
  return new EdgeAuth(env, request, siteUserId, options);
}

class EdgeAuth {
  private readonly origin: string;
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch;
  private readonly key: Promise<CryptoKey>;
  private readonly aad: Uint8Array<ArrayBuffer>;
  private client: SupabaseClient | null = null;
  private state: CookieState | null = null;
  private inspection: Inspection | null = null;
  private restoring: Promise<void> | null = null;

  constructor(private readonly env: EdgeAuthEnvironment, private readonly request: Request, siteUserId: string, options: Options) {
    this.now = options.now ?? Date.now;
    this.fetchImpl = options.fetchImpl ?? fetch;
    let project: URL;
    try { project = new URL(env.SUPABASE_URL); } catch { throw this.configError(); }
    if (project.protocol !== 'https:' || !/^[a-z0-9]{20}\.supabase\.co$/.test(project.hostname) || project.port || project.username || project.password || project.pathname !== '/' || project.search || project.hash || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(env.SUPABASE_PUBLISHABLE_KEY) || !UUID.test(env.SUPABASE_OWNER_ID) || !HEX.test(env.TAXIDTA_SESSION_KEY) || !siteUserId || siteUserId.length > 256) throw this.configError();
    const target = new URL(request.url);
    if (target.protocol !== 'https:') throw this.configError();
    this.origin = target.origin;
    this.aad = new TextEncoder().encode(JSON.stringify(['TaxiDTA', 1, this.origin, siteUserId, env.SUPABASE_OWNER_ID]));
    this.key = crypto.subtle.importKey('raw', Uint8Array.from(env.TAXIDTA_SESSION_KEY.match(/../g)!, (byte) => parseInt(byte, 16)), 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  private configError() { return new EdgeAuthError(503, 'AUTH_CONFIG_INVALID', 'Die sichere Anmeldung ist noch nicht vollständig konfiguriert.'); }
  private anonymous(): CookieState {
    const time = this.now();
    return { v: 1, csrf: random(), created: time, seen: time, deadline: time + ABSOLUTE_MS, nonce: null, generation: 0, access: null, refresh: null, pending: null };
  }
  private validDeadline(state: CookieState) {
    const time = this.now();
    return state.created <= time && state.seen <= time && state.deadline > time && state.deadline <= state.created + ABSOLUTE_MS && state.seen > time - IDLE_MS;
  }
  private tokenDeadline(token: string) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) throw expired();
      const claims = JSON.parse(new TextDecoder().decode(unb64url(parts[1]!))) as { exp?: unknown };
      if (typeof claims.exp !== 'number' || !Number.isSafeInteger(claims.exp)) throw expired();
      const deadline = claims.exp * 1000 - TOKEN_MARGIN_MS;
      if (deadline <= this.now()) throw expired();
      return deadline;
    } catch { throw expired(); }
  }
  private assertDeadline() {
    if (!this.state || !this.validDeadline(this.state)) throw expired();
    if (this.state.access && this.tokenDeadline(this.state.access) < this.state.deadline) throw expired();
  }
  private async readCookie(): Promise<CookieState | null> {
    const matches = (this.request.headers.get('cookie') ?? '').split(';').map((value) => value.trim()).filter((value) => value.startsWith(`${COOKIE_NAME}=`));
    if (matches.length !== 1) return null;
    const value = matches[0]!.slice(COOKIE_NAME.length + 1);
    if (!/^[A-Za-z0-9_-]{40,3800}$/.test(value)) return null;
    try {
      const packed = unb64url(value);
      const clear = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: packed.subarray(0, 12), additionalData: this.aad }, await this.key, packed.subarray(12));
      const result = stateSchema.safeParse(JSON.parse(new TextDecoder().decode(clear)));
      if (!result.success || !this.validDeadline(result.data)) return null;
      const state = result.data;
      if (Boolean(state.access) !== Boolean(state.refresh) || Boolean(state.access) !== Boolean(state.nonce)) return null;
      if (state.access && this.tokenDeadline(state.access) < state.deadline) return null;
      return state;
    } catch { return null; }
  }
  private async cookie(): Promise<string> {
    this.assertDeadline();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: this.aad }, await this.key, new TextEncoder().encode(JSON.stringify(this.state))));
    const packed = new Uint8Array(iv.length + encrypted.length);
    packed.set(iv); packed.set(encrypted, iv.length);
    const value = b64url(packed);
    if (value.length > 3800) throw new EdgeAuthError(503, 'AUTH_SESSION_TOO_LARGE', 'Die sichere Anmeldung konnte nicht gespeichert werden.');
    const maxAge = Math.max(1, Math.floor(Math.min(this.state!.deadline - this.now(), IDLE_MS) / 1000));
    // Partitioned cookies support Sites previews; exact Origin + CSRF still gate every mutation.
    return `${COOKIE_NAME}=${value}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=None; Partitioned`;
  }
  private checkMutation() {
    this.assertDeadline();
    const origin = this.request.headers.get('origin');
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(this.request.method) || origin !== this.origin || this.request.headers.get('x-csrf-token') !== this.state!.csrf || !/^application\/json(?:\s*;|$)/i.test(this.request.headers.get('content-type') ?? ''))
      throw new EdgeAuthError(403, 'AUTH_CSRF_REJECTED', 'Die Anfrage zur Anmeldung wurde nicht bestätigt. Bitte die Seite neu laden.');
  }
  private newClient() {
    const transport: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.origin !== new URL(this.env.SUPABASE_URL).origin || url.searchParams.get('grant_type') === 'refresh_token') throw unavailable();
      try { return await this.fetchImpl(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(10_000) }); } catch { throw unavailable(); }
    };
    return createClient(this.env.SUPABASE_URL, this.env.SUPABASE_PUBLISHABLE_KEY, {
      auth: { storageKey: `taxidta-worker-${random()}`, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, debug: false },
      global: { fetch: transport },
    });
  }
  private async inspect(): Promise<Inspection> {
    this.assertDeadline();
    const token = this.state!.access;
    if (!token || !this.client) throw expired();
    const userResult = await this.client.auth.getUser(token);
    if (userResult.error || !userResult.data.user) throw providerError(userResult.error, expired());
    const user = userResult.data.user;
    if (user.id !== this.env.SUPABASE_OWNER_ID || user.is_anonymous || !user.email_confirmed_at) throw new EdgeAuthError(403, 'AUTH_OWNER_REQUIRED', 'Nur das bestätigte Inhaberkonto darf diese Anwendung verwenden.');
    // With the explicit JWT the SDK performs remote validation; local getSession is never authority.
    const assurance = await this.client.auth.mfa.getAuthenticatorAssuranceLevel(token);
    if (assurance.error || !assurance.data || !['aal1', 'aal2'].includes(assurance.data.currentLevel ?? '')) throw providerError(assurance.error, expired());
    this.assertDeadline();
    return { user, aal: assurance.data.currentLevel as 'aal1' | 'aal2', factors: user.factors ?? [] };
  }
  private async rpc(name: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.assertDeadline();
    if (!this.state!.access) throw expired();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { apikey: this.env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${this.state!.access}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch { throw unavailable(); }
    if (!response.ok) {
      if (response.status === 429) throw new EdgeAuthError(429, 'AUTH_RATE_LIMITED', 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.');
      if (response.status >= 500) throw unavailable();
      if (response.status === 404) throw new EdgeAuthError(503, 'AUTH_SCHEMA_UNAVAILABLE', 'Die sichere Anmeldung ist noch nicht freigeschaltet.');
      throw expired();
    }
    const body = await response.text();
    if (body.length > 16_384) throw unavailable();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { throw unavailable(); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw unavailable();
    this.assertDeadline();
    return parsed as Record<string, unknown>;
  }
  private reference() {
    if (!this.state?.nonce) throw expired();
    return { p_nonce: this.state.nonce, p_generation: this.state.generation };
  }
  private async validate(touch: boolean) {
    const value = await this.rpc('taxidta_web_session_validate', { ...this.reference(), p_touch: touch });
    if (value.active !== true || value.generation !== this.state!.generation || typeof value.expiresAt !== 'string' || typeof value.lastSeenAt !== 'string') throw expired();
    const deadline = Date.parse(value.expiresAt);
    const seen = Date.parse(value.lastSeenAt);
    if (!Number.isFinite(deadline) || !Number.isFinite(seen) || deadline <= this.now() || seen <= this.now() - IDLE_MS || deadline > this.state!.deadline + 1000) throw expired();
    this.state!.deadline = Math.min(this.state!.deadline, deadline);
    this.state!.seen = Math.min(this.now(), seen);
    this.assertDeadline();
  }
  private async restore() {
    if (!this.restoring) this.restoring = (async () => {
      this.state = await this.readCookie();
      if (!this.state) throw expired();
      if (!this.state.access) return;
      this.client = this.newClient();
      const restored = await this.client.auth.setSession({ access_token: this.state.access, refresh_token: this.state.refresh! });
      if (restored.error || !restored.data.session || restored.data.session.access_token !== this.state.access) throw providerError(restored.error, expired());
      this.inspection = await this.inspect();
      await this.validate(true);
    })();
    await this.restoring;
  }
  private view(): EdgeAuthView {
    const verified = this.inspection?.factors.filter((factor) => factor.factor_type === 'totp' && factor.status === 'verified') ?? [];
    return {
      phase: !this.state!.access ? 'anonymous' : this.inspection?.aal === 'aal2' && this.state!.generation >= 1 ? 'authenticated' : verified.length ? 'mfa-required' : 'enroll-required',
      csrfToken: this.state!.csrf, factors: verified.map((factor) => ({ id: factor.id, ...(factor.friendly_name ? { friendlyName: factor.friendly_name } : {}) })),
      expiresAt: new Date(Math.min(this.state!.deadline, this.state!.seen + IDLE_MS)).toISOString(), ownerConfigured: true,
    };
  }
  private async envelope(): Promise<EdgeAuthResult> { return { auth: this.view(), cookie: await this.cookie() }; }
  private saveTokens(session: Pick<Session, 'access_token' | 'refresh_token'>) {
    if (!session.access_token || session.access_token.length > 4096 || !session.refresh_token || session.refresh_token.length > 2048) throw expired();
    this.state!.access = session.access_token;
    this.state!.refresh = session.refresh_token;
    this.state!.deadline = Math.min(this.state!.deadline, this.tokenDeadline(session.access_token));
    this.assertDeadline();
  }
  private async rotate() {
    const nonce = random();
    const result = await this.rpc('taxidta_web_session_rotate', { ...this.reference(), p_new_nonce: nonce });
    if (result.active !== true || result.generation !== this.state!.generation + 1) throw expired();
    this.state!.nonce = nonce;
    this.state!.generation += 1;
    this.state!.csrf = random();
    this.state!.seen = this.now();
    const reset = await this.rpc('taxidta_web_session_otp_reset', this.reference());
    if (reset.reset !== true) throw expired();
  }

  async bootstrap(): Promise<EdgeAuthResult> {
    try { await this.restore(); } catch (error) {
      if (!(error instanceof EdgeAuthError) || (error.status !== 401 && error.status !== 403)) throw error;
      this.state = this.anonymous(); this.client = null; this.inspection = null;
    }
    this.state!.seen = this.now();
    return this.envelope();
  }
  async login(input: unknown): Promise<EdgeAuthResult> {
    const value = parseInput(credentials, input);
    await this.restore(); this.checkMutation();
    if (this.state!.access) throw new EdgeAuthError(409, 'AUTH_ALREADY_SIGNED_IN', 'Bitte zuerst abmelden.');
    this.client = this.newClient();
    const result = await this.client.auth.signInWithPassword(value);
    if (result.error || !result.data.session) throw providerError(result.error, rejected());
    // Reset absolute lifetime only after a successful new password authentication.
    this.state = this.anonymous();
    this.saveTokens(result.data.session);
    try {
      this.inspection = await this.inspect();
      this.state.nonce = random();
      const created = await this.rpc('taxidta_web_session_create', this.reference());
      if (created.active !== true || created.generation !== 0 || typeof created.expiresAt !== 'string') throw expired();
      this.state.deadline = Math.min(this.state.deadline, Date.parse(created.expiresAt));
      this.assertDeadline();
      if (this.inspection.aal === 'aal2') await this.rotate();
      return await this.envelope();
    } catch (error) {
      try { await this.client.auth.signOut({ scope: 'local' }); } catch { /* No authority is retained after failed owner validation. */ }
      throw error;
    }
  }
  async enroll(): Promise<EdgeAuthResult> {
    await this.restore(); this.checkMutation();
    if (this.view().phase !== 'enroll-required' || this.state!.pending) throw new EdgeAuthError(409, 'AUTH_ENROLLMENT_UNAVAILABLE', 'Die Einrichtung ist bereits begonnen oder ein zweiter Faktor besteht bereits.');
    const result = await this.client!.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'TaxiDTA Inhaber', issuer: 'TaxiDTA' });
    if (result.error || !result.data || result.data.type !== 'totp') throw providerError(result.error, new EdgeAuthError(422, 'AUTH_ENROLLMENT_FAILED', 'Der zweite Faktor konnte nicht eingerichtet werden.'));
    const { id, totp } = result.data;
    if (!UUID.test(id) || !/^[A-Z2-7]{16,128}$/.test(totp.secret) || typeof totp.uri !== 'string' || totp.uri.length > 2048 || !totp.uri.startsWith('otpauth://totp/')) throw unavailable();
    this.assertDeadline();
    this.state!.pending = id;
    const svg = qrSvg.render(qrCore.create(totp.uri, { errorCorrectionLevel: 'M' }), { width: 240, margin: 3 }) as string;
    return { ...await this.envelope(), enrollment: { factorId: id, secret: totp.secret, qrDataUrl: `data:image/svg+xml;base64,${btoa(svg)}` } };
  }
  async verify(input: unknown): Promise<EdgeAuthResult> {
    const value = parseInput(verification, input);
    await this.restore(); this.checkMutation();
    const verified = this.inspection!.factors.some((factor) => factor.id === value.factorId && factor.factor_type === 'totp' && factor.status === 'verified');
    if (this.view().phase === 'authenticated' || (!verified && value.factorId !== this.state!.pending)) throw new EdgeAuthError(422, 'AUTH_FACTOR_INVALID', 'Der zweite Faktor wurde nicht bestätigt.');
    const budget = await this.rpc('taxidta_web_session_otp_consume', this.reference());
    if (budget.allowed !== true) throw new EdgeAuthError(429, 'AUTH_OTP_RATE_LIMITED', 'Zu viele Codeversuche. Bitte zehn Minuten warten.');
    const result = await this.client!.auth.mfa.challengeAndVerify(value);
    if (result.error || !result.data) throw providerError(result.error, new EdgeAuthError(401, 'AUTH_OTP_REJECTED', 'Der Bestätigungscode wurde nicht bestätigt.'));
    this.saveTokens(result.data);
    this.inspection = await this.inspect();
    if (this.inspection.aal !== 'aal2' || !this.inspection.factors.some((factor) => factor.id === value.factorId && factor.factor_type === 'totp' && factor.status === 'verified')) throw expired();
    await this.rotate();
    this.state!.pending = null;
    return this.envelope();
  }
  async cancelEnrollment(input: unknown): Promise<EdgeAuthResult> {
    const value = parseInput(factorInput, input);
    await this.restore(); this.checkMutation();
    if (this.state!.pending !== value.factorId || this.inspection!.factors.some((factor) => factor.id === value.factorId && factor.status === 'verified')) throw new EdgeAuthError(422, 'AUTH_FACTOR_INVALID', 'Die begonnene Einrichtung wurde nicht gefunden.');
    const result = await this.client!.auth.mfa.unenroll({ factorId: value.factorId });
    if (result.error) throw providerError(result.error, new EdgeAuthError(422, 'AUTH_ENROLLMENT_FAILED', 'Die Einrichtung konnte nicht abgebrochen werden.'));
    this.state!.pending = null;
    this.inspection = await this.inspect();
    return this.envelope();
  }
  async logout(): Promise<EdgeAuthResult> {
    await this.restore(); this.checkMutation();
    let remoteLogoutConfirmed = true;
    if (this.state!.access) {
      // Revoke app authority durably BEFORE contacting Auth signOut. A copied cookie then fails closed.
      const deleted = await this.rpc('taxidta_web_session_delete', this.reference());
      if (deleted.deleted !== true) throw unavailable();
      try { const result = await this.client!.auth.signOut({ scope: 'local' }); remoteLogoutConfirmed = !result.error; } catch { remoteLogoutConfirmed = false; }
    }
    this.state = this.anonymous(); this.inspection = null; this.client = null;
    return { ...await this.envelope(), remoteLogoutConfirmed };
  }
  async requireMfa(): Promise<EdgeAuthContext> {
    await this.restore();
    if (!['GET', 'HEAD'].includes(this.request.method)) this.checkMutation();
    if (this.view().phase !== 'authenticated' || this.inspection!.aal !== 'aal2') throw new EdgeAuthError(403, 'AUTH_MFA_REQUIRED', 'Bitte zuerst mit Passwort und zweitem Faktor anmelden.');
    const nonceHash = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(this.state!.nonce!))));
    const generation = this.state!.generation;
    return { userId: this.inspection!.user.id, accessToken: this.state!.access!, csrfToken: this.state!.csrf, cookie: await this.cookie(), webSession: { nonceHash, generation }, assertActive: async () => { await this.validate(false); } };
  }
}
