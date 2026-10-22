# Supabase-Datenbank: begrenzter Einrichtungstest

Stand 22.10.2026. Diese Erweiterung verbindet noch nicht die komplette Fahrten-/Finanzdatenbank mit Supabase. Rechnungen, PDFs, Kunden und synthetische Fahrten bleiben im lokalen SQLite-Speicher. Der neue Datenbankadapter führt ausschließlich einen bewusst ausgelösten Test mit einer zufälligen UUID aus: schreiben → erneut lesen → entfernen.

Die UUID ist kein Patient, kein IK, keine Bankangabe und kein DTA-Paket. Der Adapter nimmt keinen freien Cloud-Dateninhalt entgegen. Ein positives Ergebnis bestätigt nur diesen Einrichtungstest; es ist keine Datenschutz-, Gesundheitsdaten-, DTA- oder Produktionsfreigabe.

## Maßgeblicher SQL-Stand

Ausführbare, mit CLI erstellte Folge: `supabase/migrations/20261022121929_owner_mfa_setup_probe.sql`, danach der additive Rechte-Nachtrag `supabase/migrations/20261022122813_owner_account_deny_client_access.sql`. Supabase CLI 2.121.0 wurde zunächst mit `--help`, `migration --help` und `migration new --help` untersucht. Die Dateien wurden zunächst mit `supabase migration new` erzeugt. Bei der Anwendung vergab das Verwaltungswerkzeug eigene Versionsnummern. Die lokalen Dateinamen wurden anschließend an die tatsächliche Cloudhistorie angeglichen; beide SQL-Inhalte stimmen bytegleich mit den gespeicherten Statements überein. Es wurde dafür keine bereits angewendete Migration verändert.

Die frühere allgemeine Finanzdatenbankskizze liegt nun bewusst unter `docs/drafts/supabase_financial_schema.sql`, außerhalb des ausführbaren Migrationsordners. Sie ist nicht mit dem laufenden SQLite-Backend verbunden und darf nicht als fertiger Cloud-Datenadapter eingespielt werden. Der frühe, inzwischen ersetzte 002-Probeentwurf wurde nicht angewendet und bleibt nur im ignorierten lokalen Arbeitsarchiv. Der aktive Migrationsordner enthält ausschließlich die überprüfbare neue Probe-Migration und ihren additiven Rechte-Nachtrag.

Die neue Migration kann allein eingerichtet werden und ist wiederholt ausführbar. Sie setzt keine vorhandene Finanzskizze voraus. Sie enthält keine tatsächliche Inhaber-UUID und ersetzt keinen bestehenden Inhaber. Der einzeln bestätigte Inhaber wird getrennt über einen vertrauenswürdigen Verwaltungszugang eingetragen; keine Browserfunktion kann sich selbst zum Inhaber erklären.

## Datenmodell und Rechte

- `taxidta.owner_account`: genau ein administrativ bestätigtes Auth-Benutzerkonto; keine Client-Tabellenrechte und keine Selbstregistrierung als Inhaber. Der additive Nachtrag setzt zusätzlich eine ausdrücklich restriktive `FOR ALL`-Policy mit `USING (false)` und `WITH CHECK (false)` für `authenticated`. Auch später versehentlich ergänzte permissive Client-Policies können diese Sperre nicht allein öffnen.
- `taxidta.setup_connection_probes`: ausschließlich `probe_id` als UUID, der aus `auth.uid()` ermittelte Inhaber und ein Serverzeitstempel. Keine freien JSON-, Text- oder Dateiwerte.
- Beide privaten Tabellen besitzen RLS. `anon`, `PUBLIC` und `authenticated` erhalten keine direkten Tabellenrechte. Für Proben existiert zusätzlich eine Inhaber-/MFA-Lesepolicy als zusätzliche Schutzschicht.
- `taxidta.is_owner_mfa()` vergleicht den signierten Aufrufer mit dem festen Inhaber, verlangt `aal2` und prüft die `session_id` gegen `auth.sessions.id`/`user_id`. Eine gesetzte `not_after`-Grenze muss in der Zukunft liegen. Zusätzlich muss der Benutzer in `auth.users` vorhanden, nicht gelöscht, per E-Mail bestätigt und aktuell nicht gesperrt sein. Fehlende/ungültige Werte ergeben ausdrücklich `false`, nicht SQL-`NULL`.
- Privilegierte Aktionen liegen ausschließlich im für private Helfer vorgesehenen `taxidta`-Schema: `taxidta.setup_probe(text,uuid)` ist ein bewusst begrenzter `SECURITY DEFINER`-Helfer mit leerem `search_path`. Jeder Aufruf führt vor dem Zugriff den vollständigen Inhaber-/MFA-/Sitzungstest aus.
- Die vier unter `public` erreichbaren RPCs sind `SECURITY INVOKER`-Hüllen. `PUBLIC` und `anon` dürfen sie nicht ausführen; nur `authenticated` erhält Ausführungsrechte. Die private Hilfsfunktion muss ebenfalls für `authenticated` ausführbar sein, damit die Invoker-Hüllen sie aufrufen können. Das ersetzt nicht ihre eigenen Autorisierungsprüfungen. Die tatsächliche Daten-API-Exposition des `taxidta`-Schemas wurde noch nicht geprüft; die Bezeichnung „privat“ beschreibt die vorgesehene Architektur und ist keine behauptete Projektkonfiguration.
- `NO FORCE ROW LEVEL SECURITY` ist bei den privaten Tabellen bewusst gewählt: Der vertrauenswürdige SQL-Administrator bzw. Funktionseigentümer muss die interne Inhabertabelle lesen und die eng begrenzte Probe ausführen können, ohne eine providerabhängige `BYPASSRLS`-Eigenschaft vorauszusetzen. Client-Tabellenrechte bleiben vollständig entzogen. Gegen einen kompromittierten Datenbankadministrator schützt diese Grenze nicht.
- Die Projekt-Daten-API sollte nur die vorgesehenen öffentlichen Hüllen exponieren. Die tatsächliche Schema-Exposition bleibt als Konfigurationsprüfung offen. Auch bei einem direkten Aufruf des Helfers bleiben alle Inhaber-, Benutzer-, MFA- und Live-Sitzungsprüfungen zwingend; Tabellenrechte werden dadurch nicht vergeben.

Der Schreibvorgang ist über seine zufällige UUID wiederholbar, ohne mehrere Zeilen anzulegen. Abgebrochene eigene Proben werden nach 24 Stunden beim nächsten bewussten Probestart aufgeräumt. Fremde Proben werden weder geändert noch gelöscht. Der Löschvorgang bestätigt, dass die konkrete Probe nicht mehr vorhanden ist.

## Adapter und Aufrufvertrag

`server/supabase-data.ts` exportiert:

```ts
new SupabaseDataClient({ url, publishableKey }, fetchImpl?)
client.inspect(accessToken)
client.verifySyntheticDatabase(accessToken)
```

`inspect` verlangt eine erreichbare, passend versionierte Datenbankfunktion sowie Inhaberzugriff mit `aal2`. `verifySyntheticDatabase` erzeugt selbst eine neue zufällige UUID und prüft dieselbe UUID sowie denselben gespeicherten Zeitstempel nach dem erneuten Lesen. Ein erfolgreiches Resultat enthält `schemaVersion`, `syntheticOnly: true`, `writeVerified`, `readVerified`, `cleanupVerified`, `checkedAt` und `probeId`.

Zulässig sind nur Projektadressen im Muster `https://<20-kleingeschriebene-Projektzeichen>.supabase.co`, ohne Pfad, Port, Benutzerinfo oder Weiterleitungsparameter, und Publishable Keys. Es gibt keine freie URL, keinen freien Tabellennamen und keinen Service-Role-Zugang. Jeder Aufruf verwendet ein zehnsekündiges Timeout und verbietet Redirects. Zugriffstoken bleiben serverseitig; fremde Fehlertexte, Schlüssel oder Rohantworten werden nicht in verständliche Fehlermeldungen kopiert.

Nach einem möglicherweise erfolgreichen Schreibversuch wird auch bei verlorener Antwort oder falschem Leseergebnis eine Entfernung derselben UUID versucht. Bei fehlender Löschbestätigung wird kein erfolgreiches Gesamtergebnis zurückgegeben. `SupabaseDataError` enthält zusätzlich `cleanupAttempted` und `cleanupVerified`, damit die Oberfläche einen verbleibenden synthetischen Prüfeintrag ehrlich melden kann. Die Operation wird nicht automatisch wiederholt.

## Ausgeführte lokale Prüfungen und Grenzen

`tests/supabase-data.test.ts`: neun gezielte Prüfungen wurden lokal erfolgreich ausgeführt. Sie betreffen den exakten Nonce-Roundtrip, URL-/Schlüsselbeschränkungen, fehlende Migration/MFA/Rechte, verlorene Schreibantwort, falsche UUID bzw. Zeitstempel, nicht bestätigte Bereinigung, ungültige oder übergroße Antworten sowie statische Schutzregeln der SQL-Folge, einschließlich des ausdrücklichen restriktiven Client-Verbots.

Die HTTP-Antworten dieser Tests sind ausdrücklich lokale Mocks. Die SQL-Prüfung kontrolliert den Quelltext, führt aber keinen PostgreSQL-Server und keine RLS-Sitzung aus. Sie ersetzt weder die tatsächliche Anwendung der Migration noch eine Rollen-/Sitzungsprüfung im echten Projekt. Cloud-Anwendung, separate Inhaberbindung, tatsächliche Testqueries und Supabase-Advisors erfolgen ausschließlich durch die Hauptintegration. Beide Migrationen und die getrennte Inhaberbindung wurden dort inzwischen tatsächlich angewendet. Die SQL-Rollen-/Claims-Negativprüfungen verweigerten anonyme RPC-Aufrufe, Inhaberaufrufe mit `aal1` sowie behauptetes `aal2` mit nicht vorhandener Sitzung. Dabei blieb die Probe-Tabelle leer. Diese Prüfungen sind kein Nachweis einer vollständigen kryptografischen Anmeldung. Der additive Rechte-Nachtrag wurde angewendet und hat den Advisor-Hinweis auf die zuvor bewusst richtlinienlose Inhabertabelle behoben. Der abschließende Advisor-Lauf meldete keine `ERROR`-Befunde; als `WARN` bleibt der noch nicht aktivierte [Schutz gegen kompromittierte Passwörter](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) bestehen. Eine persönliche positive Anmeldung, TOTP-Einrichtung und ein echter authentisierter UUID-Roundtrip wurden noch nicht durchgeführt. Persönliches Passwort und Authenticator gehören ausschließlich in die eigene Anmeldemaske. Zusätzlich blockiert die Entwicklungsumgebung derzeit den Node-/SDK-Netzweg zum Projekt-Host, obwohl die getrennten nativen Projektwerkzeuge die Datenbank erreichen. Erfolgreiche Verwaltungsabfragen sind daher kein Nachweis eines erfolgreichen App-Logins oder SDK-Datentransports.

Das API-Setup deaktiviert keine Registrierung, konfiguriert keine Projektregion und legt keine Recovery-, Speicher-, Backup- oder Gesundheitsdatenfreigabe fest. Diese Voraussetzungen bleiben eigene Einrichtungs- und Betriebsaufgaben. Die Region wurde von der Hauptintegration getrennt am Projekt geprüft; sie wird nicht aus der URL, einem Gateway-Header oder einer selbst gesetzten Konfigurationszeile abgeleitet.
