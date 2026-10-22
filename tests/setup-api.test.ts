import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../server/app.ts";
import { Store } from "../server/store.ts";
import {
  AuthError,
  SupabaseAuthService,
  type AuthProvider,
  type AuthInspection,
} from "../server/supabase-auth.ts";
import {
  readConfiguration,
  publicConfiguration,
  createGuardedSupabaseFetch,
  type AppConfig,
} from "../server/config.ts";
import { SupabaseDataError } from "../server/supabase-data.ts";
const owner = "00000000-0000-4000-8000-000000000011";
const factor = "00000000-0000-4000-8000-000000000012";
class Provider implements AuthProvider {
  inspection: AuthInspection = {
    userId: owner,
    emailConfirmed: true,
    aal: "aal1",
    factors: [],
  };
  async signIn() {}
  async inspect() {
    return structuredClone(this.inspection);
  }
  async enrollTotp() {
    return {
      id: factor,
      secret: "JBSWY3DPEHPK3PXP",
      uri: "otpauth://totp/TaxiDTA:synthetic?secret=JBSWY3DPEHPK3PXP&issuer=TaxiDTA",
    };
  }
  async verifyTotp(id: string, code: string) {
    if (code !== "123456")
      throw new AuthError(401, "AUTH_TOTP_INVALID", "Invalid synthetic code");
    this.inspection.aal = "aal2";
    this.inspection.factors = [{ id, type: "totp", status: "verified" }];
  }
  async cancelEnrollment() {}
  async accessToken() {
    return "synthetic-owner-checked-token";
  }
  async signOut() {}
}
async function fixture(
  options: { now?: () => number; onInspect?: () => void } = {},
) {
  const store = new Store(":memory:");
  const provider = new Provider();
  const auth = new SupabaseAuthService({
    ownerId: owner,
    createProvider: () => provider,
    now: options.now,
  });
  const config: AppConfig = {
    supabase: {
      url: "https://abcdefghijklmnopqrst.supabase.co",
      publishableKey: "sb_publishable_" + "x".repeat(30),
      ownerId: owner,
    },
    authRequired: true,
    ownerIk: null,
    region: {
      reported: "europe",
      confirmed: "eu-central-1",
      expected: "eu-central-1",
      verified: true,
    },
  };
  let inspectCalls = 0,
    deny = false;
  const app = await createApp({
    store,
    config,
    authService: auth,
    setupData: {
      async inspect(token: string) {
        inspectCalls++;
        assert.equal(token, "synthetic-owner-checked-token");
        options.onInspect?.();
        if (deny)
          throw new SupabaseDataError(
            "SUPABASE_OWNER_MFA_REQUIRED",
            "Sitzung nicht bestätigt.",
            403,
          );
        return {
          schemaVersion: "taxidta-setup-probe-v1",
          syntheticOnly: true,
          ownerAccess: true,
          aal: "aal2",
        };
      },
    },
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  let cookie = "",
    csrf = "";
  const request = async (
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ) => {
    const r = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-csrf-token": csrf,
        ...extra,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const c = r.headers.get("set-cookie");
    if (c) cookie = c.split(";")[0];
    const value = await r.json();
    if (value.auth?.csrfToken) csrf = value.auth.csrfToken;
    return { r, value, cookie, csrf };
  };
  const close = async () => {
    await new Promise<void>((r) => server.close(() => r()));
    auth.close();
    store.close();
  };
  return {
    store,
    auth,
    provider,
    config,
    request,
    close,
    get inspectCalls() {
      return inspectCalls;
    },
    revoke() {
      deny = true;
    },
  };
}
test("MFA mode protects all financial API reads and writes, uses rotated per-session CSRF and a live database guard", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request("/api/state")).r.status, 401);
    const boot = await f.request("/api/setup/status");
    assert.equal(boot.r.status, 200);
    assert.match(boot.r.headers.get("set-cookie") || "", /HttpOnly/);
    assert.match(boot.r.headers.get("set-cookie") || "", /SameSite=Strict/);
    assert.equal(boot.value.auth.phase, "anonymous");
    assert.equal(boot.value.productionReady, false);
    assert.ok(!JSON.stringify(boot.value).includes("sb_publishable_"));
    const login = await f.request("/api/auth/login", {
      email: "synthetic@example.invalid",
      password: "synthetic test password",
    });
    assert.equal(login.r.status, 200);
    assert.notEqual(login.cookie, boot.cookie);
    assert.notEqual(login.csrf, boot.csrf);
    assert.equal((await f.request("/api/state")).r.status, 403);
    assert.equal(f.inspectCalls, 0);
    assert.equal(
      (await f.request("/api/auth/enroll", {}, { "x-csrf-token": boot.csrf })).r
        .status,
      403,
    );
    const enrollment = await f.request("/api/auth/enroll", {});
    assert.equal(enrollment.r.status, 200);
    assert.match(
      enrollment.value.enrollment.qrDataUrl,
      /^data:image\/png;base64,/,
    );
    const confirmed = await f.request("/api/auth/verify", {
      factorId: factor,
      code: "123456",
    });
    assert.equal(confirmed.r.status, 200);
    assert.equal(confirmed.value.auth.phase, "authenticated");
    assert.notEqual(confirmed.csrf, login.csrf);
    assert.notEqual(confirmed.cookie, login.cookie);
    assert.ok(
      !JSON.stringify(confirmed.value).includes(
        "synthetic-owner-checked-token",
      ),
    );
    const state = await f.request("/api/state");
    assert.equal(state.r.status, 200);
    assert.equal(state.value.csrfToken, confirmed.csrf);
    assert.equal(f.inspectCalls, 1);
    const write = await f.request("/api/customers", {
      name: "Fiktiver Testkunde",
      kind: "private",
      address: "Testweg 1",
    });
    assert.equal(write.r.status, 201);
    assert.equal(f.inspectCalls, 2);
    f.revoke();
    assert.equal((await f.request("/api/state")).r.status, 403);
    assert.equal((await f.request("/api/export.csv")).r.status, 403);
    const out = await f.request("/api/auth/logout", {});
    assert.equal(out.r.status, 200);
    assert.equal(out.value.auth.phase, "anonymous");
    assert.equal((await f.request("/api/state")).r.status, 401);
  } finally {
    await f.close();
  }
});
test("a session expiring during the database check cannot read financial data", async () => {
  let now = 0;
  const f = await fixture({
    now: () => now,
    onInspect: () => {
      now += 31 * 60_000;
    },
  });
  try {
    await f.request("/api/setup/status");
    await f.request("/api/auth/login", {
      email: "synthetic@example.invalid",
      password: "synthetic test password",
    });
    await f.request("/api/auth/enroll", {});
    await f.request("/api/auth/verify", { factorId: factor, code: "123456" });
    const response = await f.request("/api/state");
    assert.equal(response.r.status, 401);
    assert.equal(response.value.code, "AUTH_SESSION_EXPIRED");
    assert.equal(f.inspectCalls, 1);
    assert.equal(response.value.customers, undefined);
  } finally {
    await f.close();
  }
});
test("private project configuration fails closed, redacts keys and keeps exact region evidence separate", async () => {
  const base = {
    SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_" + "a".repeat(30),
    SUPABASE_OWNER_ID: owner,
  };
  assert.equal(readConfiguration(base).region.verified, false);
  assert.equal(
    readConfiguration({
      ...base,
      SUPABASE_CONFIRMED_REGION: "eu-central-1",
      SUPABASE_REGION_VERIFIED_AT: "2026-10-22",
    }).region.verified,
    true,
  );
  assert.equal(
    readConfiguration({
      ...base,
      SUPABASE_CONFIRMED_REGION: "eu-central-1",
      SUPABASE_REGION_VERIFIED_AT: "2026-02-30",
    }).region.verified,
    false,
  );
  assert.equal(
    readConfiguration({
      ...base,
      SUPABASE_CONFIRMED_REGION: "eu-central-1",
      SUPABASE_REGION_VERIFIED_AT: "2026-99-99",
    }).region.verified,
    false,
  );
  assert.throws(() =>
    readConfiguration({ ...base, SUPABASE_URL: "http://127.0.0.1/" }),
  );
  assert.throws(() =>
    readConfiguration({
      ...base,
      SUPABASE_PUBLISHABLE_KEY: "sb_secret_" + "x".repeat(30),
    }),
  );
  assert.throws(() => readConfiguration({ TAXIDTA_AUTH_REQUIRED: "true" }));
  assert.equal(
    JSON.stringify(publicConfiguration(readConfiguration(base))).includes(
      base.SUPABASE_PUBLISHABLE_KEY,
    ),
    false,
  );
  const guarded = createGuardedSupabaseFetch(base.SUPABASE_URL);
  await assert.rejects(() => guarded("https://different.invalid/auth/v1/user"));
  await assert.rejects(() => guarded(base.SUPABASE_URL + "/private/elsewhere"));
});
