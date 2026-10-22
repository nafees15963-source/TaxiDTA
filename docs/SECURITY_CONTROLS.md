# Sicherheitskontrollen und Nachweisgrenzen

Stand 22.10.2026. Orientierung an OWASP ASVS; **keine ASVS-Zertifizierung oder vollständige Level-3-Abdeckung**. Lokaler Demo-Modus und Produktionsschutz sind verschiedene Dinge.

| Bereich | Lokale Umsetzung | Nachweis / Grenze |
|---|---|---|
| Betriebsmodus | Nur synthetische Daten; keine ausgehenden DTA-/E-Mail-Adapter | Serverseitige Modus-/Host-Sperre und API-Negativtests; keine reale Versandfreigabe |
| Authentisierung | Optional konfigurierbare, mit `TAXIDTA_AUTH_REQUIRED=true` verpflichtende Inhaber-Anmeldung mit Passwort/TOTP | Serverseitige Owner-/MFA-/Sitzungsprüfung; persönlicher Live-Login noch offen, Passkeys/Recovery nicht implementiert |
| Request-Schutz | Origin/Host, CSRF, Schema- und Centprüfung, no-store; Rotation nach Login/MFA | Backend- und Auth-Integrationstests; Browsertests mit simulierten Auth-APIs |
| Finanzintegrität | Original-Snapshot/PDF, Hash, Transaktion, Stornobeleg, Fahrtensperre | Backendtests; lokale DB-Zugriffsrechte begrenzen |
| Berechtigungen | Bei Anmeldepflicht alle fachlichen APIs einschließlich PDF/Export durch Owner, AAL2 und aktive DB-Sitzung geschützt | Reale SQL-Negativtests für anonym/AAL1/inaktive Sitzung; keine vollständige Finanz-/Mandantenmigration |
| Quellen | Private Originale außerhalb Repository; ausschließlich anonymisierte Strukturbefunde | Quelleninventar und statischer Scan; kein Beweis rechtlicher Anonymisierung |
| Upload/SSRF | Kein frei nutzbarer Upload/URL-Fetch; Supabase nur festes Projekt, Auth-/REST-Pfade, keine Redirects, Timeout | Zielbeschränkung getestet; spätere Belegverarbeitung braucht isolierten Parser/Scanner |
| Backup | SQLite Online-Snapshot, scrypt N=32768/r=8/p=1, AES-256-GCM, zufälliges Salt/IV, authentifizierter Header | Automatischer Test für falsche Passphrase, Header-/Dateimanipulation, WAL und Restore |
| Restore | Entschlüsselung nur in temporäres Verzeichnis, SQLite integrity_check, SHA-256-Vergleich | Aktive DB bleibt unverändert; kein unbeaufsichtigtes Überschreiben |
| Audit | Hashkette / append-only Anwendungsfluss | Kein externer unveränderlicher Anker, keine GoBD-Zusage |
| Externe Dienste | Supabase Auth und begrenzte UUID-RPCs; keine fachlichen Cloud-/Telemetrie-/KI-/Bankdaten | SDK-Zugang im verwalteten Netz derzeit blockiert; Plugin-Verwaltungszugriff und SQL-Prüfungen erfolgreich |
| Abhängigkeiten | Lockfile und npm ci; CI baut und testet | npm audit gesondert ausführen; 0 gemeldete Probleme ist keine Sicherheitsgarantie |
| Überwachung/Updates | Lokale Health-/Fehleranzeigen, CI | Keine produktiven Alarme, Rotation oder Bereitschaftsdienste |

## Praktische Befehle

- `npm run security:check`: lokale Quellprüfung auf offensichtliche Schlüssel-/IBAN-Leaks, erwartete Konfiguration und Buildartefakte. Ein Muster-Scan ersetzt kein DLP und keine manuelle Prüfung.
- `npm audit --omit=dev`: aktuelle Advisory-Abfrage bei erlaubtem Netzwerk. Ergebnis mit Abrufdatum dokumentieren.
- `npm run backup -- work/backups/mein-backup.tdbak`: Passphrase wird unsichtbar abgefragt. Mindestens 12 Zeichen, besser mehrere zufällige Wörter. Nicht in Shellargumente schreiben.
- `npm run restore:test -- work/backups/mein-backup.tdbak`: dieselbe Passphrase eingeben. Erfolg meldet Integrität, Hash und dass die aktive DB unverändert blieb.

`TAXIDTA_BACKUP_PASSPHRASE` wird für automatisierte Testumgebungen unterstützt. In gemeinsam genutzten Umgebungen kann eine Umgebungsvariable von privilegierten Prozessen gelesen werden. Interaktive Eingabe oder sichere stdin-Zuführung bevorzugen; keine Passphrase in Skripten/Repo oder Kommandohistorie ablegen. Beim Test wird das aktive Backup nicht gelöscht. Test-Restore-Dateien werden entfernt. SSDs und Backups erlauben keine garantierte physische Löschung temporärer Klartextdateien; für spätere Echtdaten braucht der ganze Rechner/Datenträger geeignete Verschlüsselung.

## Supabase: angewendeter Einrichtungsschutz

Die aktiven Migrationen `supabase/migrations/20261022121929_owner_mfa_setup_probe.sql` und `20261022122813_owner_account_deny_client_access.sql` wurden im eingerichteten Projekt tatsächlich angewendet. Die getrennt administrativ gesetzte Inhaberbindung enthält das bestätigte App-Konto. Die tatsächliche Projektregion ist `eu-central-1`, Frankfurt. Diese Befunde erteilen keine Datenschutz- oder Produktionsfreigabe.

- Private Tabellen `taxidta.owner_account` und `taxidta.setup_connection_probes` besitzen RLS und keine direkten Client-Tabellenrechte. Eine restriktive Deny-all-Policy schützt die Inhaberbindung zusätzlich.
- Öffentliche RPC-Hüllen sind `SECURITY INVOKER`, für `anon` gesperrt und nur für `authenticated` ausführbar. Die privilegierten Helfer im privaten Schema haben einen leeren `search_path` und prüfen bei jedem Aufruf Owner, signiertes AAL2, aktiven/entsperrten bestätigten Benutzer und passende aktive `auth.sessions`-Zeile. Die Exposition privater API-Schemas wurde noch nicht gesondert bestätigt; die Helfer führen ihren Schutz auch bei direktem Aufruf aus.
- Echte Rollen-/Claims-Negativtests verweigerten anonyme Aufrufe, den Inhaber mit AAL1 sowie AAL2 mit nicht vorhandener Sitzung. Die Probe-Tabelle blieb leer. Der Test erzeugte keine echte Anmeldung und keinen positiven MFA-Nachweis.
- Der begrenzte Adapter nimmt keine freien Daten entgegen. Er erzeugt selbst eine UUID, prüft Schreiben/Lesen und verlangt bestätigte Entfernung. Ohne bestätigte Bereinigung wird kein Erfolg gemeldet.
- Bei aktivierter Anmeldepflicht prüft das Backend vor jeder fachlichen Route die entfernte Identität/AAL2 und anschließend die aktive Datenbanksitzung. Die Zugangstokens verlassen den Server nicht. Der Browser erhält nur eine `HttpOnly`-/`SameSite=Strict`-Kennung mit lokaler HTTP-Konfiguration. Öffentlicher HTTPS-Betrieb ist damit nicht abgenommen.

Der persönliche Passwort-/TOTP-Login und der positive UUID-Roundtrip bleiben offen. Der normale SDK-Netzwerkpfad wird derzeit von der verwalteten Umgebung blockiert. Lokale Mocktests belegen Programmverhalten, keine echte Authentisierung im Projekt.

Die App bietet kein Signup. Die projektweite Supabase-Registrierung ist noch nicht bestätigt oder abgeschaltet. Der letzte Sicherheitsadvisor meldet noch deaktivierten [Schutz gegen bekannte geleakte Passwörter](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); die vorherige Information zur fehlenden Inhaber-Policy ist durch den additiven Nachtrag behoben.

Die nicht ausgeführte Finanzskizze liegt in `docs/drafts/supabase_financial_schema.sql` außerhalb der aktiven Migrationen. PostgreSQL-Finanzdaten, private Storage-Buckets, Recovery, Passkeys, KMS und produktive RLS-/Objektisolation benötigen eigene Implementierung und Nachweise. DB-Eigentümer und administrative Dienstrollen bleiben vertrauenswürdige Grenzen und können RLS umgehen. Weitere Details stehen in `SUPABASE_AUTH_SECURITY.md` und `SUPABASE_DATA.md`.
