import { randomUUID } from "node:crypto";
import { z } from "zod";

export const SUPABASE_SETUP_SCHEMA_VERSION = "taxidta-setup-probe-v1" as const;
export interface SupabaseDataConfig {
  url: string;
  publishableKey: string;
}
export class SupabaseDataError extends Error {
  cleanupAttempted = false;
  cleanupVerified = false;
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 503,
  ) {
    super(message);
    this.name = "SupabaseDataError";
  }
}
export interface SyntheticDatabaseVerification {
  schemaVersion: typeof SUPABASE_SETUP_SCHEMA_VERSION;
  syntheticOnly: true;
  writeVerified: true;
  readVerified: true;
  cleanupVerified: true;
  checkedAt: string;
  probeId: string;
}
const shared = {
  schemaVersion: z.literal(SUPABASE_SETUP_SCHEMA_VERSION),
  syntheticOnly: z.literal(true),
};
const probe = {
  ...shared,
  probeId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
};
const statusSchema = z.object({
  ...shared,
  ownerAccess: z.literal(true),
  aal: z.literal("aal2"),
});
const writeSchema = z.object(probe);
const readSchema = z.object({ ...probe, found: z.literal(true) });
const deleteSchema = z.object({
  ...shared,
  probeId: z.string().uuid(),
  removed: z.literal(true),
});
const invalidResponse = () =>
  new SupabaseDataError(
    "SUPABASE_RESPONSE_UNVERIFIED",
    "Die Datenbankantwort passt nicht zum freigegebenen synthetischen Prüfverfahren.",
  );

/** Only fixed nonce-only RPCs; no migration, financial upload or arbitrary REST table access. */
export class SupabaseDataClient {
  private readonly url: string;
  private readonly key: string;
  constructor(
    config: SupabaseDataConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    let url: URL;
    try {
      url = new URL(config.url);
    } catch {
      throw new SupabaseDataError(
        "SUPABASE_CONFIG_INVALID",
        "Ungültige Supabase-Projektadresse.",
        422,
      );
    }
    if (
      url.protocol !== "https:" ||
      !/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname) ||
      url.port ||
      url.username ||
      url.password ||
      (url.pathname !== "/" && url.pathname !== "") ||
      url.search ||
      url.hash
    ) {
      throw new SupabaseDataError(
        "SUPABASE_CONFIG_INVALID",
        "Nur die HTTPS-Projektadresse eines Supabase-Cloudprojekts ist zulässig.",
        422,
      );
    }
    if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey)) {
      throw new SupabaseDataError(
        "SUPABASE_CONFIG_INVALID",
        "Für diese Anbindung wird ein Publishable Key benötigt; Secret-/Service-Schlüssel werden nicht angenommen.",
        422,
      );
    }
    this.url = url.origin;
    this.key = config.publishableKey;
  }
  private async rpc(
    name: "status" | "write" | "read" | "delete",
    accessToken: string,
    probeId?: string,
  ): Promise<unknown> {
    if (
      !accessToken ||
      accessToken.length > 16384 ||
      /[\r\n]/.test(accessToken)
    ) {
      throw new SupabaseDataError(
        "SUPABASE_AUTH_REQUIRED",
        "Eine gültige Inhabersitzung mit bestätigtem zweiten Faktor ist erforderlich.",
        401,
      );
    }
    let response: Response;
    try {
      response = await this.fetchImpl(
        `${this.url}/rest/v1/rpc/taxidta_setup_probe_${name}`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          headers: {
            apikey: this.key,
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(probeId ? { p_probe_id: probeId } : {}),
        },
      );
    } catch {
      throw new SupabaseDataError(
        "SUPABASE_NETWORK_UNAVAILABLE",
        "Die Supabase-Datenbank ist aus dieser Umgebung nicht erreichbar. Es wurde keine fachliche Datenmigration ausgeführt.",
      );
    }
    if (!response.ok) {
      if (response.status === 401)
        throw new SupabaseDataError(
          "SUPABASE_AUTH_REQUIRED",
          "Die Inhabersitzung ist abgelaufen oder nicht gültig.",
          401,
        );
      if (response.status === 403)
        throw new SupabaseDataError(
          "SUPABASE_OWNER_MFA_REQUIRED",
          "Die Datenbank verlangt den administrativ bestätigten Inhaber und eine MFA-Sitzung.",
          403,
        );
      if (response.status === 404)
        throw new SupabaseDataError(
          "SUPABASE_SETUP_SCHEMA_MISSING",
          "Die vorbereitete Supabase-Einrichtungsmigration ist noch nicht erreichbar. Bitte den SQL-Schritt und die API-Schemaverfügbarkeit prüfen.",
          409,
        );
      throw new SupabaseDataError(
        "SUPABASE_PROBE_REJECTED",
        "Die Datenbank hat den synthetischen Einrichtungstest abgewiesen. Die externe Fehlerantwort wird nicht in die Oberfläche übernommen.",
      );
    }
    try {
      const text = await response.text();
      if (text.length > 16384) throw invalidResponse();
      return JSON.parse(text);
    } catch {
      throw invalidResponse();
    }
  }
  async inspect(accessToken: string) {
    const result = statusSchema.safeParse(
      await this.rpc("status", accessToken),
    );
    if (!result.success) throw invalidResponse();
    return result.data;
  }
  async verifySyntheticDatabase(
    accessToken: string,
  ): Promise<SyntheticDatabaseVerification> {
    await this.inspect(accessToken);
    const probeId = randomUUID();
    let failure: SupabaseDataError | null = null;
    let cleanupVerified = false;
    try {
      const written = writeSchema.safeParse(
        await this.rpc("write", accessToken, probeId),
      );
      if (!written.success || written.data.probeId !== probeId)
        throw invalidResponse();
      const read = readSchema.safeParse(
        await this.rpc("read", accessToken, probeId),
      );
      if (
        !read.success ||
        read.data.probeId !== probeId ||
        read.data.createdAt !== written.data.createdAt
      )
        throw invalidResponse();
    } catch (error) {
      failure = error instanceof SupabaseDataError ? error : invalidResponse();
    }
    // Even a lost write response may have committed the nonce: always try a nonce-only cleanup.
    try {
      const deleted = deleteSchema.safeParse(
        await this.rpc("delete", accessToken, probeId),
      );
      cleanupVerified = deleted.success && deleted.data.probeId === probeId;
      if (!cleanupVerified && !failure)
        failure = new SupabaseDataError(
          "SUPABASE_PROBE_CLEANUP_UNVERIFIED",
          "Schreiben und Lesen wurden geprüft, die Entfernung des synthetischen Prüfeintrags wurde nicht bestätigt.",
        );
    } catch {
      if (!failure)
        failure = new SupabaseDataError(
          "SUPABASE_PROBE_CLEANUP_UNVERIFIED",
          "Schreiben und Lesen wurden geprüft, die Entfernung des synthetischen Prüfeintrags wurde nicht bestätigt.",
        );
    }
    if (failure) {
      failure.cleanupAttempted = true;
      failure.cleanupVerified = cleanupVerified;
      throw failure;
    }
    return {
      schemaVersion: SUPABASE_SETUP_SCHEMA_VERSION,
      syntheticOnly: true,
      writeVerified: true,
      readVerified: true,
      cleanupVerified: true,
      checkedAt: new Date().toISOString(),
      probeId,
    };
  }
}
