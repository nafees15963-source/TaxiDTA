import test from "node:test";
import assert from "node:assert/strict";
import {
  AuthError,
  SupabaseAuthService,
  type AuthInspection,
  type AuthProvider,
} from "../server/supabase-auth.js";
import { SupabaseSdkAuthProvider } from "../server/supabase-provider.js";

// All UUIDs, accounts, passwords, seeds and JWTs in these tests are synthetic.
const OWNER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";
const FACTOR = "33333333-3333-4333-8333-333333333333";
const PENDING = "44444444-4444-4444-8444-444444444444";
const SECRET = "JBSWY3DPEHPK3PXP";
const URI = `otpauth://totp/TaxiDTA:synthetic?secret=${SECRET}&issuer=TaxiDTA`;
const errorCode = (code: string) => (error: unknown) =>
  error instanceof AuthError && error.code === code;
class FakeProvider implements AuthProvider {
  signedIn = false;
  badPassword = false;
  wrongCode = false;
  revoke = false;
  remoteLogoutFails = false;
  userId = OWNER;
  confirmed = true;
  aal: "aal1" | "aal2" = "aal1";
  factors: AuthInspection["factors"] = [];
  enrollCalls = 0;
  verifyCalls = 0;
  signOutCalls = 0;
  inspectCalls = 0;
  async signIn() {
    if (this.badPassword)
      throw new Error("Upstream response containing private account details");
    this.signedIn = true;
  }
  async inspect(): Promise<AuthInspection> {
    this.inspectCalls++;
    if (!this.signedIn || this.revoke)
      throw new Error("Revoked remote session");
    return {
      userId: this.userId,
      emailConfirmed: this.confirmed,
      aal: this.aal,
      factors: this.factors.map((f) => ({ ...f })),
    };
  }
  async enrollTotp() {
    this.enrollCalls++;
    this.factors.push({ id: PENDING, type: "totp", status: "unverified" });
    return { id: PENDING, uri: URI, secret: SECRET };
  }
  async verifyTotp(id: string) {
    this.verifyCalls++;
    if (this.wrongCode) throw new Error("Rejected code");
    this.aal = "aal2";
    this.factors = this.factors.map((f) =>
      f.id === id ? { ...f, status: "verified" } : f,
    );
  }
  async cancelEnrollment(id: string) {
    this.factors = this.factors.filter((f) => f.id !== id);
  }
  async accessToken() {
    return "synthetic-access-token-never-in-AuthView";
  }
  async signOut() {
    this.signOutCalls++;
    this.signedIn = false;
    if (this.remoteLogoutFails) throw new Error("Provider unavailable");
  }
}
function service(
  options: Partial<{
    ownerId: string | null;
    now: () => number;
    absoluteTtlMs: number;
    idleTtlMs: number;
    maxSessions: number;
  }> = {},
) {
  const providers: FakeProvider[] = [];
  const auth = new SupabaseAuthService({
    ownerId: OWNER,
    createProvider: () => {
      const p = new FakeProvider();
      providers.push(p);
      return p;
    },
    ...options,
  });
  return { auth, providers };
}

test("owner binding is mandatory and a project user cannot claim ownership or use an unconfirmed email", async () => {
  const unbound = service({ ownerId: null });
  const boot = unbound.auth.bootstrap();
  assert.equal(boot.state.ownerConfigured, false);
  await assert.rejects(
    unbound.auth.login(
      boot.sessionId,
      "owner@example.test",
      "synthetic-password",
    ),
    errorCode("AUTH_OWNER_NOT_CONFIGURED"),
  );
  assert.equal(unbound.providers.length, 0);
  for (const change of [
    (p: FakeProvider) => {
      p.userId = STRANGER;
    },
    (p: FakeProvider) => {
      p.confirmed = false;
    },
  ]) {
    const p = new FakeProvider();
    change(p);
    const auth = new SupabaseAuthService({
      ownerId: OWNER,
      createProvider: () => p,
    });
    const session = auth.bootstrap();
    await assert.rejects(
      auth.login(session.sessionId, "owner@example.test", "synthetic-password"),
      errorCode("AUTH_OWNER_REQUIRED"),
    );
    assert.equal(auth.bootstrap(session.sessionId).state.phase, "anonymous");
    assert.equal(p.signOutCalls, 1);
  }
});
test("password and MFA success rotate session ID and CSRF; seeds and tokens never enter AuthView", async () => {
  const { auth } = service();
  const boot = auth.bootstrap();
  const loggedIn = await auth.login(
    boot.sessionId,
    "owner@example.test",
    "synthetic-password",
  );
  assert.notEqual(loggedIn.sessionId, boot.sessionId);
  assert.notEqual(loggedIn.state.csrfToken, boot.state.csrfToken);
  assert.equal(auth.csrfMatches(boot.sessionId, boot.state.csrfToken), false);
  assert.equal(loggedIn.state.phase, "enroll-required");
  const enrollment = await auth.enroll(loggedIn.sessionId);
  assert.equal(enrollment.factorId, PENDING);
  assert.equal(enrollment.secret, SECRET);
  assert.ok(!JSON.stringify(enrollment.state).includes(SECRET));
  await assert.rejects(
    auth.requireMfa(loggedIn.sessionId),
    errorCode("AUTH_MFA_REQUIRED"),
  );
  const verified = await auth.verify(loggedIn.sessionId, PENDING, "123456");
  assert.notEqual(verified.sessionId, loggedIn.sessionId);
  assert.notEqual(verified.state.csrfToken, loggedIn.state.csrfToken);
  assert.equal(
    auth.csrfMatches(loggedIn.sessionId, loggedIn.state.csrfToken),
    false,
  );
  assert.equal(verified.state.phase, "authenticated");
  assert.ok(!JSON.stringify(verified.state).includes("access-token"));
  assert.ok(!JSON.stringify(verified.state).includes(SECRET));
  const access = await auth.requireMfa(verified.sessionId);
  assert.equal(access.userId, OWNER);
  assert.match(access.accessToken, /^synthetic-/);
});
test("existing verified factors cannot be bypassed by enrolling a new factor at AAL1", async () => {
  for (const type of ["totp", "phone", "webauthn", "future-unknown-factor"]) {
    const p = new FakeProvider();
    p.factors = [{ id: FACTOR, type, status: "verified" }];
    const auth = new SupabaseAuthService({
      ownerId: OWNER,
      createProvider: () => p,
    });
    const session = await auth.login(
      auth.bootstrap().sessionId,
      "owner@example.test",
      "synthetic-password",
    );
    assert.equal(session.state.phase, "mfa-required");
    await assert.rejects(
      auth.enroll(session.sessionId),
      errorCode("AUTH_EXISTING_FACTOR_REQUIRED"),
    );
    assert.equal(p.enrollCalls, 0);
  }
});
test("factor IDs require actual ownership and abandoned enrollment cannot remove a verified factor", async () => {
  const { auth, providers } = service();
  const session = await auth.login(
    auth.bootstrap().sessionId,
    "owner@example.test",
    "synthetic-password",
  );
  await assert.rejects(
    auth.verify(session.sessionId, STRANGER, "123456"),
    errorCode("AUTH_FACTOR_NOT_OWNED"),
  );
  assert.equal(providers[0].verifyCalls, 0);
  const enrollment = await auth.enroll(session.sessionId);
  await assert.rejects(
    auth.enroll(session.sessionId),
    errorCode("AUTH_ENROLLMENT_PENDING"),
  );
  assert.equal(providers[0].enrollCalls, 1);
  await assert.rejects(
    auth.cancelEnrollment(session.sessionId, FACTOR),
    errorCode("AUTH_FACTOR_NOT_OWNED"),
  );
  await auth.cancelEnrollment(session.sessionId, enrollment.factorId);
  assert.equal(providers[0].factors.length, 0);
  await assert.rejects(
    auth.verify(session.sessionId, PENDING, "123456"),
    errorCode("AUTH_FACTOR_NOT_OWNED"),
  );
});
test("bad MFA codes cannot claim AAL2 and six failures trigger a time-bound limit", async () => {
  let time = Date.now();
  const { auth, providers } = service({
    now: () => time,
    absoluteTtlMs: 60 * 60_000,
    idleTtlMs: 60 * 60_000,
  });
  const session = await auth.login(
    auth.bootstrap().sessionId,
    "owner@example.test",
    "synthetic-password",
  );
  await auth.enroll(session.sessionId);
  providers[0].wrongCode = true;
  for (let i = 0; i < 6; i++)
    await assert.rejects(
      auth.verify(session.sessionId, PENDING, "123456"),
      errorCode("AUTH_TOTP_INVALID"),
    );
  await assert.rejects(
    auth.verify(session.sessionId, PENDING, "123456"),
    errorCode("AUTH_RATE_LIMITED"),
  );
  assert.equal(providers[0].verifyCalls, 6);
  assert.equal(
    auth.bootstrap(session.sessionId).state.phase,
    "enroll-required",
  );
  time += 10 * 60_000 + 1;
  providers[0].wrongCode = false;
  assert.equal(
    (await auth.verify(session.sessionId, PENDING, "123456")).state.phase,
    "authenticated",
  );
});
test("remote revocation denies the next protected action; a cached authenticated phase is insufficient", async () => {
  const { auth, providers } = service();
  const login = await auth.login(
    auth.bootstrap().sessionId,
    "owner@example.test",
    "synthetic-password",
  );
  await auth.enroll(login.sessionId);
  const verified = await auth.verify(login.sessionId, PENDING, "123456");
  providers[0].revoke = true;
  const before = providers[0].inspectCalls;
  await assert.rejects(
    auth.requireMfa(verified.sessionId),
    errorCode("AUTH_SESSION_UNVERIFIED"),
  );
  assert.equal(providers[0].inspectCalls, before + 1);
  assert.equal(
    auth.csrfMatches(verified.sessionId, verified.state.csrfToken),
    false,
  );
});
test("logout destroys local authority even when remote logout is unavailable", async () => {
  const { auth, providers } = service();
  const login = await auth.login(
    auth.bootstrap().sessionId,
    "owner@example.test",
    "synthetic-password",
  );
  await auth.enroll(login.sessionId);
  const verified = await auth.verify(login.sessionId, PENDING, "123456");
  providers[0].remoteLogoutFails = true;
  const loggedOut = await auth.logout(verified.sessionId);
  assert.equal(loggedOut.state.phase, "anonymous");
  assert.equal(loggedOut.remoteLogoutConfirmed, false);
  assert.equal(
    auth.csrfMatches(verified.sessionId, verified.state.csrfToken),
    false,
  );
  await assert.rejects(
    auth.requireMfa(verified.sessionId),
    errorCode("AUTH_SESSION_EXPIRED"),
  );
});
test("idle expiry, absolute expiry and bounded session count are server enforced", async () => {
  let time = Date.now();
  const idle = service({
    now: () => time,
    idleTtlMs: 1000,
    absoluteTtlMs: 5000,
    maxSessions: 1,
  });
  const session = idle.auth.bootstrap();
  assert.throws(() => idle.auth.bootstrap(), errorCode("AUTH_SESSION_LIMIT"));
  time += 1001;
  assert.equal(
    idle.auth.csrfMatches(session.sessionId, session.state.csrfToken),
    false,
  );
  assert.notEqual(idle.auth.bootstrap().sessionId, session.sessionId);
  const absolute = service({
    now: () => time,
    idleTtlMs: 1500,
    absoluteTtlMs: 3000,
  });
  const fixed = absolute.auth.bootstrap();
  for (let i = 0; i < 2; i++) {
    time += 1000;
    assert.equal(
      absolute.auth.bootstrap(fixed.sessionId).sessionId,
      fixed.sessionId,
    );
  }
  time += 1001;
  assert.equal(
    absolute.auth.csrfMatches(fixed.sessionId, fixed.state.csrfToken),
    false,
  );
  absolute.auth.close();
  assert.throws(
    () => absolute.auth.bootstrap(),
    errorCode("AUTH_SERVICE_CLOSED"),
  );
});
test("failed login messages are redacted and per-session/global login limits stop repeated guesses", async () => {
  const provider = new FakeProvider();
  provider.badPassword = true;
  const auth = new SupabaseAuthService({
    ownerId: OWNER,
    createProvider: () => provider,
  });
  const session = auth.bootstrap();
  for (let i = 0; i < 6; i++)
    await assert.rejects(
      auth.login(session.sessionId, "owner@example.test", "bad-password"),
      (e: unknown) =>
        e instanceof AuthError &&
        e.code === "AUTH_LOGIN_FAILED" &&
        !e.message.includes("Upstream"),
    );
  await assert.rejects(
    auth.login(session.sessionId, "owner@example.test", "bad-password"),
    errorCode("AUTH_RATE_LIMITED"),
  );
  const global = new SupabaseAuthService({
    ownerId: OWNER,
    createProvider: () => provider,
  });
  for (let i = 0; i < 20; i++)
    await assert.rejects(
      global.login(
        global.bootstrap().sessionId,
        "owner@example.test",
        "bad-password",
      ),
      errorCode("AUTH_LOGIN_FAILED"),
    );
  await assert.rejects(
    global.login(
      global.bootstrap().sessionId,
      "owner@example.test",
      "bad-password",
    ),
    errorCode("AUTH_RATE_LIMITED"),
  );
});
test("a session cannot assert success if provider returns AAL2 without any verified factor", async () => {
  const p = new FakeProvider();
  p.aal = "aal2";
  const auth = new SupabaseAuthService({
    ownerId: OWNER,
    createProvider: () => p,
  });
  await assert.rejects(
    auth.login(
      auth.bootstrap().sessionId,
      "owner@example.test",
      "synthetic-password",
    ),
    errorCode("AUTH_LOGIN_FAILED"),
  );
});

function jwt(aal: "aal1" | "aal2", exp: number) {
  return [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString(
      "base64url",
    ),
    Buffer.from(
      JSON.stringify({
        sub: OWNER,
        role: "authenticated",
        aal,
        iat: exp - 3600,
        exp,
        session_id: STRANGER,
      }),
    ).toString("base64url"),
    Buffer.from("synthetic-test-signature").toString("base64url"),
  ].join(".");
}
function sdkFixture(
  options: {
    shortLived?: boolean;
    failRefresh?: boolean;
    revoked?: boolean;
  } = {},
) {
  let clock = Date.now();
  let aal: "aal1" | "aal2" = "aal1";
  let refreshes = 0;
  let currentToken = "";
  const calls: {
    path: string;
    method: string;
    authorization: string;
    body: any;
  }[] = [];
  const user = () => ({
    id: OWNER,
    aud: "authenticated",
    role: "authenticated",
    email: "owner@example.test",
    email_confirmed_at: "2026-10-22T12:00:00Z",
    created_at: "2026-10-22T12:00:00Z",
    app_metadata: {},
    user_metadata: {},
    factors: [
      {
        id: FACTOR,
        factor_type: "totp",
        status: aal === "aal2" ? "verified" : "unverified",
        created_at: "2026-10-22T12:00:00Z",
        updated_at: "2026-10-22T12:00:00Z",
      },
    ],
  });
  const session = (seconds = 3600) => {
    const exp = Math.floor(clock / 1000) + seconds;
    currentToken = jwt(aal, exp);
    return {
      access_token: currentToken,
      refresh_token: "synthetic-refresh-token-" + refreshes,
      token_type: "bearer",
      expires_in: seconds,
      expires_at: exp,
      user: user(),
    };
  };
  const fetchMock = (async (
    url: string | URL | Request,
    init?: RequestInit,
  ) => {
    const parsed = new URL(
      typeof url === "string" ? url : url instanceof URL ? url.href : url.url,
    );
    const headers = new Headers(init?.headers);
    calls.push({
      path: parsed.pathname + parsed.search,
      method: init?.method ?? "GET",
      authorization: headers.get("authorization") ?? "",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    let data: unknown;
    let status = 200;
    if (
      parsed.pathname.endsWith("/token") &&
      parsed.searchParams.get("grant_type") === "password"
    )
      data = session(options.shortLived ? 30 : 3600);
    else if (
      parsed.pathname.endsWith("/token") &&
      parsed.searchParams.get("grant_type") === "refresh_token"
    ) {
      refreshes++;
      if (options.failRefresh) {
        status = 400;
        data = { code: "refresh_token_not_found", msg: "Not valid" };
      } else data = session();
    } else if (parsed.pathname.endsWith("/user")) {
      if (options.revoked) {
        status = 401;
        data = { code: "bad_jwt", msg: "Revoked" };
      } else data = user();
    } else if (parsed.pathname.endsWith("/factors"))
      data = {
        id: FACTOR,
        type: "totp",
        totp: { uri: URI, secret: SECRET, qr_code: "<svg>synthetic</svg>" },
      };
    else if (parsed.pathname.endsWith("/challenge"))
      data = {
        id: PENDING,
        type: "totp",
        expires_at: Math.floor(clock / 1000) + 300,
      };
    else if (parsed.pathname.endsWith("/verify")) {
      aal = "aal2";
      data = session();
    } else if (parsed.pathname.endsWith("/logout")) {
      status = 204;
      data = null;
    } else {
      status = 404;
      data = { msg: "Unexpected test endpoint" };
    }
    return new Response(status === 204 ? null : JSON.stringify(data), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const provider = new SupabaseSdkAuthProvider(
    {
      url: "https://abcdefghijklmnopqrst.supabase.co",
      publishableKey: "sb_publishable_synthetic_test",
    },
    fetchMock,
    () => clock,
  );
  return {
    provider,
    calls,
    refreshes: () => refreshes,
    token: () => currentToken,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}
test("official SDK provider remotely validates user/AAL, serializes refresh, and does not expose upstream credentials", async () => {
  const f = sdkFixture({ shortLived: true });
  await f.provider.signIn("owner@example.test", "synthetic-password");
  const results = await Promise.all([
    f.provider.inspect(),
    f.provider.inspect(),
    f.provider.accessToken(),
  ]);
  assert.equal(f.refreshes(), 1);
  assert.equal((results[0] as AuthInspection).userId, OWNER);
  const lookups = f.calls.filter((c) => c.path === "/auth/v1/user");
  assert.ok(lookups.length >= 4);
  assert.ok(lookups.every((c) => c.authorization === "Bearer " + f.token()));
  assert.ok(
    f.calls.some((c) => c.path === "/auth/v1/token?grant_type=refresh_token"),
  );
  await f.provider.verifyTotp(FACTOR, "123456");
  assert.equal((await f.provider.inspect()).aal, "aal2");
  await f.provider.signOut();
  assert.ok(f.calls.some((c) => c.path === "/auth/v1/logout?scope=local"));
  await assert.rejects(
    f.provider.accessToken(),
    errorCode("AUTH_PROVIDER_SESSION_INVALID"),
  );
});
test("failed provider refresh denies access rather than preserving an old cached JWT", async () => {
  const f = sdkFixture({ shortLived: true, failRefresh: true });
  await f.provider.signIn("owner@example.test", "synthetic-password");
  await assert.rejects(
    f.provider.inspect(),
    errorCode("AUTH_PROVIDER_SESSION_INVALID"),
  );
  assert.equal(f.refreshes(), 1);
  await assert.rejects(
    f.provider.accessToken(),
    errorCode("AUTH_PROVIDER_SESSION_INVALID"),
  );
  assert.equal(f.calls.filter((c) => c.path === "/auth/v1/user").length, 0);
});
test("provider only accepts public project configuration and rejects unsupported host redirects in its config", () => {
  for (const url of [
    "http://abcdefghijklmnopqrst.supabase.co",
    "https://attacker.example",
    "https://abcdefghijklmnopqrst.supabase.co/extra",
    "https://abcdefghijklmnopqrst.supabase.co?host=attacker",
  ])
    assert.throws(
      () =>
        new SupabaseSdkAuthProvider({
          url,
          publishableKey: "sb_publishable_synthetic_test",
        }),
      errorCode("AUTH_CONFIG_INVALID"),
    );
  assert.throws(
    () =>
      new SupabaseSdkAuthProvider({
        url: "https://abcdefghijklmnopqrst.supabase.co",
        publishableKey: "sb_secret_invalid_test",
      }),
    errorCode("AUTH_CONFIG_INVALID"),
  );
});

test("MFA failure budget belongs to the single owner across fresh browser sessions", async () => {
  let time = Date.now();
  const { auth, providers } = service({
    now: () => time,
    idleTtlMs: 20 * 60_000,
    absoluteTtlMs: 30 * 60_000,
  });
  const a = await auth.login(
    auth.bootstrap().sessionId,
    "owner@example.test",
    "synthetic-password",
  );
  const b = await auth.login(
    auth.bootstrap().sessionId,
    "owner@example.test",
    "synthetic-password",
  );
  await auth.enroll(a.sessionId);
  await auth.enroll(b.sessionId);
  providers.forEach((p) => {
    p.wrongCode = true;
  });
  for (let i = 0; i < 3; i++)
    for (const session of [a, b])
      await assert.rejects(
        auth.verify(session.sessionId, PENDING, "123456"),
        errorCode("AUTH_TOTP_INVALID"),
      );
  await assert.rejects(
    auth.verify(a.sessionId, PENDING, "123456"),
    errorCode("AUTH_RATE_LIMITED"),
  );
  assert.deepEqual(
    providers.map((p) => p.verifyCalls),
    [3, 3],
  );
  const c = await auth.login(
    auth.bootstrap().sessionId,
    "owner@example.test",
    "synthetic-password",
  );
  await auth.enroll(c.sessionId);
  await assert.rejects(
    auth.verify(c.sessionId, PENDING, "123456"),
    errorCode("AUTH_RATE_LIMITED"),
  );
  time += 10 * 60_000 + 1;
  providers[0].wrongCode = false;
  assert.equal(
    (await auth.verify(a.sessionId, PENDING, "123456")).state.phase,
    "authenticated",
  );
});
test("SDK network and gateway failures are distinguished from rejected passwords without exposing upstream details", async () => {
  for (const mock of [
    (async () =>
      new Response(
        JSON.stringify({ message: "Synthetic gateway unavailable" }),
        { status: 503, headers: { "content-type": "application/json" } },
      )) as typeof fetch,
    (async () => {
      throw new Error("Synthetic sensitive proxy details");
    }) as typeof fetch,
  ]) {
    const provider = new SupabaseSdkAuthProvider(
      {
        url: "https://abcdefghijklmnopqrst.supabase.co",
        publishableKey: "sb_publishable_synthetic_test",
      },
      mock,
    );
    await assert.rejects(
      provider.signIn("owner@example.test", "synthetic-password"),
      (error: unknown) =>
        error instanceof AuthError &&
        error.status === 503 &&
        error.code === "AUTH_NETWORK_UNAVAILABLE" &&
        !error.message.includes("proxy details"),
    );
  }
  const provider = new FakeProvider();
  provider.signIn = async () => {
    throw new AuthError(
      503,
      "AUTH_NETWORK_UNAVAILABLE",
      "Synthetischer Dienst nicht erreichbar.",
    );
  };
  const auth = new SupabaseAuthService({
    ownerId: OWNER,
    createProvider: () => provider,
  });
  await assert.rejects(
    auth.login(
      auth.bootstrap().sessionId,
      "owner@example.test",
      "synthetic-password",
    ),
    errorCode("AUTH_NETWORK_UNAVAILABLE"),
  );
});
test("a protected RPC receives the exact remotely inspected JWT rather than a newly refreshed uninspected token", async () => {
  const f = sdkFixture();
  await f.provider.signIn("owner@example.test", "synthetic-password");
  await assert.rejects(
    f.provider.accessToken(),
    errorCode("AUTH_PROVIDER_SESSION_INVALID"),
  );
  await f.provider.inspect();
  const inspected = await f.provider.accessToken();
  assert.equal(f.refreshes(), 0);
  f.advance(3550_000); // inside the refresh margin, still unexpired
  assert.equal(await f.provider.accessToken(), inspected);
  assert.equal(f.refreshes(), 0);
  await f.provider.inspect();
  assert.equal(f.refreshes(), 1);
  assert.equal(await f.provider.accessToken(), f.token());
});

function deferredGate() {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    entered,
    release,
    wait: async () => {
      enter();
      await released;
    },
  };
}
const lifetimeCases = [
  { name: "idle", idleTtlMs: 1000, absoluteTtlMs: 5000 },
  { name: "absolute", idleTtlMs: 5000, absoluteTtlMs: 1000 },
];
test("login cannot revive an anonymous session that expires during password or identity network validation", async () => {
  for (const lifetime of lifetimeCases)
    for (const stage of ["password", "identity"]) {
      let time = Date.now();
      const p = new FakeProvider();
      const gate = deferredGate();
      if (stage === "password") {
        const original = p.signIn.bind(p);
        p.signIn = async () => {
          await gate.wait();
          await original();
        };
      } else {
        const original = p.inspect.bind(p);
        p.inspect = async () => {
          await gate.wait();
          return original();
        };
      }
      const auth = new SupabaseAuthService({
        ownerId: OWNER,
        createProvider: () => p,
        now: () => time,
        ...lifetime,
      });
      const boot = auth.bootstrap();
      const action = auth.login(
        boot.sessionId,
        "owner@example.test",
        "synthetic-password",
      );
      await gate.entered;
      time += 1001;
      auth.bootstrap(); // another request prunes the old session
      gate.release();
      await assert.rejects(
        action,
        errorCode("AUTH_SESSION_EXPIRED"),
        `${lifetime.name}/${stage}`,
      );
      assert.equal(
        auth.csrfMatches(boot.sessionId, boot.state.csrfToken),
        false,
      );
      assert.equal(auth.bootstrap(boot.sessionId).state.phase, "anonymous");
      assert.equal(p.signOutCalls, 1);
    }
});
test("MFA inspection cannot authorize or republish a session that expires while the provider responds", async () => {
  for (const lifetime of lifetimeCases) {
    let time = Date.now();
    const p = new FakeProvider();
    p.aal = "aal2";
    p.factors = [{ id: FACTOR, type: "totp", status: "verified" }];
    const auth = new SupabaseAuthService({
      ownerId: OWNER,
      createProvider: () => p,
      now: () => time,
      ...lifetime,
    });
    const loggedIn = await auth.login(
      auth.bootstrap().sessionId,
      "owner@example.test",
      "synthetic-password",
    );
    const gate = deferredGate();
    const original = p.inspect.bind(p);
    p.inspect = async () => {
      await gate.wait();
      return original();
    };
    const action = auth.requireMfa(loggedIn.sessionId);
    await gate.entered;
    time += 1001;
    auth.bootstrap();
    gate.release();
    await assert.rejects(action, errorCode("AUTH_SESSION_EXPIRED"));
    assert.equal(
      auth.csrfMatches(loggedIn.sessionId, loggedIn.state.csrfToken),
      false,
    );
  }
});
test("expired enrollment and MFA verification responses cannot expose a seed or rotate into a fresh authenticated session", async () => {
  for (const lifetime of lifetimeCases)
    for (const operation of ["enroll", "verify"]) {
      let time = Date.now();
      const p = new FakeProvider();
      const auth = new SupabaseAuthService({
        ownerId: OWNER,
        createProvider: () => p,
        now: () => time,
        ...lifetime,
      });
      const loggedIn = await auth.login(
        auth.bootstrap().sessionId,
        "owner@example.test",
        "synthetic-password",
      );
      const gate = deferredGate();
      let action: Promise<unknown>;
      if (operation === "enroll") {
        const original = p.enrollTotp.bind(p);
        p.enrollTotp = async () => {
          await gate.wait();
          return original();
        };
        action = auth.enroll(loggedIn.sessionId);
      } else {
        await auth.enroll(loggedIn.sessionId);
        const original = p.verifyTotp.bind(p);
        p.verifyTotp = async (id) => {
          await gate.wait();
          await original(id);
        };
        action = auth.verify(loggedIn.sessionId, PENDING, "123456");
      }
      await gate.entered;
      time += 1001;
      auth.bootstrap();
      gate.release();
      await assert.rejects(
        action,
        errorCode("AUTH_SESSION_EXPIRED"),
        `${lifetime.name}/${operation}`,
      );
      assert.equal(
        auth.csrfMatches(loggedIn.sessionId, loggedIn.state.csrfToken),
        false,
      );
      assert.equal(auth.bootstrap(loggedIn.sessionId).state.phase, "anonymous");
    }
});
test("a protected token cannot escape after the local session expires during its awaited retrieval", async () => {
  let time = Date.now();
  const p = new FakeProvider();
  p.aal = "aal2";
  p.factors = [{ id: FACTOR, type: "totp", status: "verified" }];
  const auth = new SupabaseAuthService({
    ownerId: OWNER,
    createProvider: () => p,
    now: () => time,
    idleTtlMs: 1000,
    absoluteTtlMs: 5000,
  });
  const loggedIn = await auth.login(
    auth.bootstrap().sessionId,
    "owner@example.test",
    "synthetic-password",
  );
  const gate = deferredGate();
  p.accessToken = async () => {
    await gate.wait();
    return "synthetic-late-token";
  };
  const action = auth.requireMfa(loggedIn.sessionId);
  await gate.entered;
  time += 1001;
  gate.release();
  await assert.rejects(action, errorCode("AUTH_SESSION_EXPIRED"));
});
test("the external-await session check never extends idle time and rejects service closure", () => {
  let time = Date.now();
  const { auth } = service({
    now: () => time,
    idleTtlMs: 1000,
    absoluteTtlMs: 5000,
  });
  const boot = auth.bootstrap();
  time += 800;
  auth.assertSessionActive(boot.sessionId);
  time += 201;
  assert.throws(
    () => auth.assertSessionActive(boot.sessionId),
    errorCode("AUTH_SESSION_EXPIRED"),
  );
  auth.close();
  assert.throws(
    () => auth.assertSessionActive(boot.sessionId),
    errorCode("AUTH_SERVICE_CLOSED"),
  );
});
