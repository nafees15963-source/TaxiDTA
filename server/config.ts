import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { EnvHttpProxyAgent, fetch as proxyFetch } from "undici";

export interface AppConfig {
  supabase: {
    url: string;
    publishableKey: string;
    ownerId: string | null;
  } | null;
  authRequired: boolean;
  ownerIk: string | null;
  region: {
    reported: string | null;
    confirmed: string | null;
    expected: "eu-central-1";
    verified: boolean;
  };
}
export function loadLocalConfiguration() {
  if (
    process.env.TAXIDTA_LOAD_LOCAL_ENV !== "false" &&
    existsSync(".env.local")
  )
    loadEnvFile(".env.local");
}
export function readConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const raw = env.SUPABASE_URL?.trim() || "";
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim() || "";
  let supabase: AppConfig["supabase"] = null;
  if (raw || key) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error(
        "SUPABASE_URL muss eine gültige HTTPS-Projektadresse sein.",
      );
    }
    if (
      url.protocol !== "https:" ||
      !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error(
        "Nur eine unveränderte Supabase-HTTPS-Projektadresse ist erlaubt.",
      );
    if (!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key))
      throw new Error(
        "SUPABASE_PUBLISHABLE_KEY muss ein Publishable Key sein; Secret-/Service-Schlüssel werden nicht akzeptiert.",
      );
    const ownerId = env.SUPABASE_OWNER_ID?.trim() || null;
    if (
      ownerId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        ownerId,
      )
    )
      throw new Error(
        "SUPABASE_OWNER_ID muss die bestätigte Benutzer-UUID sein.",
      );
    supabase = { url: url.origin, publishableKey: key, ownerId };
  }
  const authRequired = env.TAXIDTA_AUTH_REQUIRED === "true";
  if (authRequired && !supabase?.ownerId)
    throw new Error(
      "Anmeldepflicht benötigt ein konfiguriertes Projekt und die bestätigte Inhaber-UUID.",
    );
  const ownerIk = env.TAXIDTA_OWNER_IK?.trim() || null;
  if (ownerIk && !/^\d{9}$/.test(ownerIk))
    throw new Error("Das eigene IK muss aus neun Ziffern bestehen.");
  const confirmed = env.SUPABASE_CONFIRMED_REGION?.trim() || null;
  const verifiedAt = env.SUPABASE_REGION_VERIFIED_AT || "";
  const date = new Date(verifiedAt + "T00:00:00Z");
  const validEvidenceDate =
    /^\d{4}-\d{2}-\d{2}$/.test(verifiedAt) &&
    Number.isFinite(date.valueOf()) &&
    date.toISOString().slice(0, 10) === verifiedAt;
  return {
    supabase,
    authRequired,
    ownerIk,
    region: {
      reported: env.SUPABASE_REPORTED_REGION || null,
      confirmed,
      expected: "eu-central-1",
      verified: confirmed === "eu-central-1" && validEvidenceDate,
    },
  };
}
/** Normal proxy/CA path is preserved. Redirects and requests to other origins are refused. */
export function createGuardedSupabaseFetch(origin: string): typeof fetch {
  const expected = new URL(origin).origin;
  let dispatcher: EnvHttpProxyAgent | undefined;
  const guarded: typeof fetch = async (input, init = {}) => {
    const url = new URL(
      input instanceof Request
        ? input.url
        : input instanceof URL
          ? input.href
          : String(input),
    );
    if (
      url.origin !== expected ||
      !(
        url.pathname.startsWith("/auth/v1/") ||
        url.pathname.startsWith("/rest/v1/")
      )
    )
      throw new Error(
        "Supabase-Anfrage außerhalb des eingerichteten Projekts abgewiesen.",
      );
    dispatcher ??= new EnvHttpProxyAgent();
    const timeout = AbortSignal.timeout(10000);
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeout])
      : timeout;
    try {
      return (await proxyFetch(url, {
        ...init,
        signal,
        redirect: "error",
        dispatcher,
      } as Parameters<typeof proxyFetch>[1])) as unknown as Response;
    } catch {
      throw new Error(
        "Supabase ist über die erlaubte Netzwerkverbindung nicht erreichbar.",
      );
    }
  };
  return guarded;
}
export function publicConfiguration(config: AppConfig) {
  return {
    configured: !!config.supabase,
    projectHost: config.supabase ? new URL(config.supabase.url).host : null,
    region: config.region,
    ownerConfigured: !!config.supabase?.ownerId,
    ownIkConfigured: !!config.ownerIk,
    authRequired: config.authRequired,
    productionReady: false as const,
    financialStorage: "local-sqlite" as const,
    dtaTransport: "blocked" as const,
  };
}
