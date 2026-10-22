import {
  loadLocalConfiguration,
  readConfiguration,
  createGuardedSupabaseFetch,
} from "../server/config.js";
loadLocalConfiguration();
const config = readConfiguration();
try {
  if (!config.supabase)
    throw new Error(
      "Projektadresse und Publishable Key fehlen in der privaten Konfiguration.",
    );
  const request = createGuardedSupabaseFetch(config.supabase.url);
  const response = await request(config.supabase.url + "/auth/v1/settings", {
    headers: { apikey: config.supabase.publishableKey },
  });
  if (!response.ok)
    throw new Error(
      "Der Supabase-Auth-Endpunkt hat den Verbindungstest abgewiesen (HTTP " +
        response.status +
        ").",
    );
  const settings = (await response.json()) as Record<string, unknown>;
  console.log(
    JSON.stringify(
      {
        reachable: true,
        regionConfirmed: config.region.verified,
        ownerConfigured: !!config.supabase.ownerId,
        signupDisabled:
          typeof settings.disable_signup === "boolean"
            ? settings.disable_signup
            : null,
        healthDataReleased: false,
        notice:
          "Nur Erreichbarkeit und öffentliche Auth-Einstellungen geprüft. Kein Login, keine Datenmigration.",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Verbindungstest fehlgeschlagen.",
  );
  console.error(
    "Die Umgebung muss HTTPS-Zugriff auf den eingerichteten Supabase-Projekthost erlauben. Proxy und TLS-Prüfung bleiben aktiv.",
  );
  process.exitCode = 1;
}
