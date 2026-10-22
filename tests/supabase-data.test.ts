import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SupabaseDataClient,
  SupabaseDataError,
  SUPABASE_SETUP_SCHEMA_VERSION,
} from "../server/supabase-data.ts";

const config = {
  url: "https://abcdefghijklmnopqrst.supabase.co",
  publishableKey: "sb_publishable_synthetic_test_only",
};
const accessToken = "synthetic.jwt.access-token";
const createdAt = "2026-10-22T12:00:00.000Z";
const shared = {
  schemaVersion: SUPABASE_SETUP_SCHEMA_VERSION,
  syntheticOnly: true,
};
interface Call {
  name: string;
  id?: string;
  headers: Headers;
  body: Record<string, unknown>;
  init: RequestInit;
}
function fakeRpc(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, config.url);
    const name = url.pathname
      .split("/")
      .at(-1)!
      .replace("taxidta_setup_probe_", "");
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<
      string,
      unknown
    >;
    const call = {
      name,
      id: body.p_probe_id as string | undefined,
      headers: new Headers(init?.headers),
      body,
      init: init ?? {},
    };
    calls.push(call);
    return await handler(call);
  };
  return { calls, fetchImpl };
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function success(call: Call) {
  if (call.name === "status")
    return json({ ...shared, ownerAccess: true, aal: "aal2" });
  if (call.name === "write")
    return json({ ...shared, probeId: call.id, createdAt });
  if (call.name === "read")
    return json({ ...shared, probeId: call.id, createdAt, found: true });
  return json({ ...shared, probeId: call.id, removed: true });
}

test("Supabase setup probe performs only authenticated fixed nonce write/read/delete and confirms exact roundtrip", async () => {
  const fake = fakeRpc(success);
  const result = await new SupabaseDataClient(
    config,
    fake.fetchImpl,
  ).verifySyntheticDatabase(accessToken);
  assert.deepEqual(
    fake.calls.map((c) => c.name),
    ["status", "write", "read", "delete"],
  );
  assert.equal(result.writeVerified, true);
  assert.equal(result.readVerified, true);
  assert.equal(result.cleanupVerified, true);
  assert.equal(result.syntheticOnly, true);
  assert.match(result.probeId, /^[0-9a-f-]{36}$/);
  for (const call of fake.calls) {
    assert.equal(call.headers.get("apikey"), config.publishableKey);
    assert.equal(call.headers.get("Authorization"), `Bearer ${accessToken}`);
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.redirect, "error");
    assert.ok(call.init.signal instanceof AbortSignal);
    assert.deepEqual(
      Object.keys(call.body),
      call.name === "status" ? [] : ["p_probe_id"],
    );
    if (call.name !== "status") assert.equal(call.id, result.probeId);
  }
});

test("Supabase data adapter rejects arbitrary hosts, paths, credentials and privileged keys before any request", () => {
  const fake = fakeRpc(success);
  for (const url of [
    "http://abcdefghijklmnopqrst.supabase.co",
    "https://localhost",
    "https://abcdefghijklmnopqrst.supabase.co.attacker.test",
    "https://abcdefghijklmnopqrst.supabase.co/path",
    "https://user:password@abcdefghijklmnopqrst.supabase.co",
    "https://abcdefghijklmnopqrst.supabase.co:444",
    "https://abcdefghijklmnopqrst.supabase.co/?next=bad",
  ]) {
    assert.throws(
      () => new SupabaseDataClient({ ...config, url }, fake.fetchImpl),
      (e: unknown) =>
        e instanceof SupabaseDataError && e.code === "SUPABASE_CONFIG_INVALID",
    );
  }
  for (const publishableKey of [
    "sb_secret_synthetic",
    "legacy.service.role.jwt",
    "",
  ])
    assert.throws(
      () =>
        new SupabaseDataClient({ ...config, publishableKey }, fake.fetchImpl),
      SupabaseDataError,
    );
  assert.equal(fake.calls.length, 0);
});

test("missing schema or MFA/owner grant cannot start a synthetic write and error bodies are not exposed", async () => {
  for (const [status, expected] of [
    [404, "SUPABASE_SETUP_SCHEMA_MISSING"],
    [403, "SUPABASE_OWNER_MFA_REQUIRED"],
    [401, "SUPABASE_AUTH_REQUIRED"],
  ] as const) {
    const fake = fakeRpc(() =>
      json(
        { message: "untrusted raw token or personal detail must never escape" },
        status,
      ),
    );
    await assert.rejects(
      () =>
        new SupabaseDataClient(config, fake.fetchImpl).verifySyntheticDatabase(
          accessToken,
        ),
      (e: unknown) => {
        assert.ok(e instanceof SupabaseDataError);
        assert.equal(e.code, expected);
        assert.equal(e.cleanupAttempted, false);
        assert.ok(!e.message.includes("untrusted raw"));
        return true;
      },
    );
    assert.deepEqual(
      fake.calls.map((c) => c.name),
      ["status"],
    );
  }
});

test("lost write response still attempts nonce cleanup and never reports the write as verified", async () => {
  const fake = fakeRpc((call) => {
    if (call.name === "write") throw new Error("lost network response");
    return success(call);
  });
  await assert.rejects(
    () =>
      new SupabaseDataClient(config, fake.fetchImpl).verifySyntheticDatabase(
        accessToken,
      ),
    (e: unknown) =>
      e instanceof SupabaseDataError &&
      e.code === "SUPABASE_NETWORK_UNAVAILABLE" &&
      e.cleanupAttempted &&
      e.cleanupVerified,
  );
  assert.deepEqual(
    fake.calls.map((c) => c.name),
    ["status", "write", "delete"],
  );
});

test("mismatched probe identity and changed read timestamp fail closed but clean up the requested nonce", async () => {
  for (const mismatch of ["identity", "timestamp"] as const) {
    const fake = fakeRpc((call) =>
      call.name === "read"
        ? json({
            ...shared,
            found: true,
            probeId:
              mismatch === "identity"
                ? "00000000-0000-4000-8000-000000000000"
                : call.id,
            createdAt:
              mismatch === "timestamp" ? "2026-10-22T12:00:01.000Z" : createdAt,
          })
        : success(call),
    );
    await assert.rejects(
      () =>
        new SupabaseDataClient(config, fake.fetchImpl).verifySyntheticDatabase(
          accessToken,
        ),
      (e: unknown) =>
        e instanceof SupabaseDataError &&
        e.code === "SUPABASE_RESPONSE_UNVERIFIED" &&
        e.cleanupVerified,
    );
    assert.equal(
      fake.calls.at(-1)?.id,
      fake.calls.find((c) => c.name === "write")?.id,
    );
  }
});

test("unconfirmed cleanup is a visible failure even after successful write/read", async () => {
  for (const failure of ["network", "not-removed"] as const) {
    const fake = fakeRpc((call) => {
      if (call.name === "delete") {
        if (failure === "network") throw new Error("connection lost");
        return json({ ...shared, probeId: call.id, removed: false });
      }
      return success(call);
    });
    await assert.rejects(
      () =>
        new SupabaseDataClient(config, fake.fetchImpl).verifySyntheticDatabase(
          accessToken,
        ),
      (e: unknown) =>
        e instanceof SupabaseDataError &&
        e.code === "SUPABASE_PROBE_CLEANUP_UNVERIFIED" &&
        e.cleanupAttempted &&
        !e.cleanupVerified,
    );
  }
});

test("missing access token and malformed or excessive success responses cannot bypass schema confirmation", async () => {
  const fake = fakeRpc(success);
  await assert.rejects(
    () => new SupabaseDataClient(config, fake.fetchImpl).inspect(""),
    (e: unknown) => e instanceof SupabaseDataError && e.status === 401,
  );
  assert.equal(fake.calls.length, 0);
  for (const response of [
    new Response("not JSON"),
    json({ ...shared, ownerAccess: true, aal: "aal1" }),
    new Response("x".repeat(17000)),
  ]) {
    const invalid = fakeRpc(() => response);
    await assert.rejects(
      () =>
        new SupabaseDataClient(config, invalid.fetchImpl).inspect(accessToken),
      (e: unknown) =>
        e instanceof SupabaseDataError &&
        e.code === "SUPABASE_RESPONSE_UNVERIFIED",
    );
  }
});

test("reviewed SQL keeps privileged operations private, enforces owner/MFA/live-session and grants no client tables", () => {
  const sql = readFileSync(
    new URL(
      "../supabase/migrations/20261022121929_owner_mfa_setup_probe.sql",
      import.meta.url,
    ),
    "utf8",
  );
  for (const wrapper of ["status", "write", "read", "delete"]) {
    const body =
      sql
        .split("CREATE OR REPLACE FUNCTION ")
        .find((declaration) =>
          declaration.startsWith(`public.taxidta_setup_probe_${wrapper}(`),
        )
        ?.split("$$;")[0] ?? "";
    assert.ok(
      body.includes("SECURITY INVOKER"),
      `public wrapper ${wrapper} must be invoker`,
    );
    assert.ok(
      !body.includes("SECURITY DEFINER"),
      `public wrapper ${wrapper} must not bypass RLS`,
    );
  }
  assert.match(
    sql,
    /FUNCTION taxidta\.setup_probe[\s\S]*?SECURITY DEFINER SET search_path = ''/,
  );
  assert.match(sql, /IF taxidta\.is_owner_mfa\(\) IS NOT TRUE THEN/);
  assert.match(sql, /coalesce\(auth\.uid\(\) IS NOT NULL/);
  assert.match(sql, /FROM auth\.sessions AS s/);
  assert.match(sql, /FROM auth\.users AS u/);
  assert.match(
    sql,
    /u\.deleted_at IS NULL AND u\.email_confirmed_at IS NOT NULL/,
  );
  assert.match(sql, /u\.banned_until IS NULL OR u\.banned_until <= now\(\)/);
  assert.match(
    sql,
    /s\.id = \(auth\.jwt\(\)->>'session_id'\)::uuid AND s\.user_id = auth\.uid\(\)/,
  );
  assert.match(sql, /s\.not_after IS NULL OR s\.not_after > now\(\)/);
  assert.match(
    sql,
    /ALTER TABLE taxidta\.setup_connection_probes ENABLE ROW LEVEL SECURITY/,
  );
  assert.match(
    sql,
    /REVOKE ALL ON TABLE taxidta\.setup_connection_probes FROM PUBLIC, anon, authenticated/,
  );
  assert.ok(
    !/GRANT\s+(?:ALL|INSERT|UPDATE|DELETE|SELECT)\s+ON\s+(?:TABLE\s+)?taxidta\./i.test(
      sql,
    ),
  );
  assert.ok(!/user_metadata|raw_user_meta_data/.test(sql));
  assert.ok(
    !/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.[\s\S]*?SECURITY DEFINER/.test(
      sql,
    ),
  );
});

test("additive owner policy is explicitly restrictive deny-all without opening client table rights", () => {
  const sql = readFileSync(
    new URL(
      "../supabase/migrations/20261022122813_owner_account_deny_client_access.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    sql,
    /ALTER TABLE taxidta\.owner_account ENABLE ROW LEVEL SECURITY/,
  );
  assert.match(
    sql,
    /CREATE POLICY owner_account_deny_client_access ON taxidta\.owner_account\s+AS RESTRICTIVE FOR ALL TO authenticated\s+USING \(false\) WITH CHECK \(false\)/,
  );
  assert.match(
    sql,
    /REVOKE ALL ON TABLE taxidta\.owner_account FROM PUBLIC, anon, authenticated/,
  );
  assert.ok(!/GRANT\s/.test(sql));
  assert.ok(!/ALTER TABLE[^;]*FORCE ROW LEVEL SECURITY/.test(sql));
});
