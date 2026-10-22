# Architektur · TaxiDTA 0.1

## Ausgeführte lokale Architektur

Modularer Monolith: React/TypeScript im Browser, Express/TypeScript als lokaler Server, Node 24 und SQLite. Vite unterstützt den lokalen Entwicklungsbetrieb; `npm run build` erzeugt statische Frontenddateien für den lokalen Server. Supabase Auth ergänzt die Inhaber-Anmeldung; ein begrenzter Datenbankadapter prüft die Inhaberbindung und kann eine zufällige UUID schreiben, lesen und entfernen. Die fachlichen Daten und PDFs bleiben lokal. Es gibt keinen veröffentlichten Cloudbetrieb und keine Freigabe für echte Gesundheitsdaten.

- `src/domain/`: datierte Tarif-/Steuerberechnung mit ganzzahligen Cents, nachvollziehbaren Quellen und Sperren für unbestätigte Fälle.
- `src/shared/types.ts`: gemeinsamer API-/UI-Vertrag.
- `server/`: Schema-/Requestprüfung, persistenter lokaler Speicher, Rechnungsnummern/-snapshots, PDF-Originale, Zahlungen, Storno und DTA-Bereitschaftsprüfung.
- `server/supabase-auth.ts`, `server/supabase-provider.ts`: serverseitige Auth-Sitzung, bestätigte Inhaber-ID, Passwortlogin, TOTP, Rotation und Ablauf.
- `server/supabase-data.ts`, `server/setup-routes.ts`: fester RPC-Vertrag für Status-/UUID-Test und Einrichtung. Kein freier URL-, Tabellen- oder Dateninhalt.
- `src/`: deutsche Oberfläche, Tastaturbedienung, Filter, Fachformulare und Auswertungen.
- `scripts/`: Migration/Initialisierung, verschlüsseltes Backup, ausschließlich temporärer Restore-Test, statische Sicherheitsprüfung.
- `tests/`: fachliche, Backend-, Backup- und Bediennachweise. Testresultate gelten nur für tatsächlich ausgeführte Tests.
- `work/`: lokale Daten und abgeleitete Laufzeitdateien, nicht versioniert. Private Originalunterlagen liegen außerhalb des Repositories.

Finanzbeträge werden in Cent gespeichert. Dezimale Kilometer werden vor Rechenoperationen validiert; vertraglich nicht belegte Rundung wird nicht erraten. Ausgestellte Rechnungen frieren Kundendaten, Leistungen, Steuer und Original-PDF ein. Spätere Änderungen an Kunden oder Tarifen ändern keine alten Originale. Zahlung, Rechnung, Papiernachweis und DTA sind unterschiedliche Zustände. Ein blockierter DTA-Prüfbericht ist keine §302-Datei und keine Empfangsquittung.

## Anmeldung und Cloudgrenze

Der Server lädt die ignorierte `.env.local`. Mit `TAXIDTA_AUTH_REQUIRED=true` verlangen alle fachlichen API-Routen einschließlich PDF und Export eine frisch geprüfte Inhaber-Sitzung mit AAL2. Eine Datenbankfunktion prüft zusätzlich Benutzerstatus, feste Inhaberbindung und die zum signierten JWT passende aktive `auth.sessions`-Zeile. Health und die begrenzten Auth-/Einrichtungsrouten haben jeweils ihren eigenen zulässigen Zugriff. Ein Auth- oder Netzwerkfehler öffnet keine fachliche Route.

Passwort und Supabase-Tokens bleiben aus Browser-Speichern und Audittexten heraus. Der Browser hält eine undurchsichtige `HttpOnly`-/`SameSite=Strict`-Sitzungskennung; Tokens verbleiben im Serverprozess. Nach Login und MFA werden Kennung und CSRF-Token rotiert. Sitzungen leben höchstens 30 Minuten, bei Inaktivität zehn Minuten; ein Serverneustart beendet sie. Das lokale HTTP-Cookie besitzt kein `Secure`-Attribut und darf daher nur im bestehenden Loopbackbetrieb verwendet werden.

Im tatsächlichen Projekt wurden Frankfurt `eu-central-1`, das bestätigte Konto und die Inhaberbindung über den Verwaltungszugang geprüft. Die beiden aktiven SQL-Migrationen schaffen ausschließlich private Inhaber-/Probe-Tabellen und eng begrenzte RPCs. Reale Rollenprüfungen verweigerten anonymen Zugriff, AAL1 und AAL2-Claims ohne vorhandene Sitzung. Persönliche Anmeldung, QR-Verifikation und positiver UUID-Roundtrip stehen noch aus; die Umgebung blockiert derzeit den SDK-Netzwerkpfad zur Projektadresse. Der Plugin-Verwaltungszugriff ist davon getrennt.

## Zielarchitektur und offene Integration

Das gewünschte Hostingziel ist Supabase Postgres/Auth/private Storage in **AWS eu-central-1 Frankfurt** plus eine tatsächlich betriebene App-/Job-Laufzeit mit gesondert geprüftem Standort. SQLite und PostgreSQL sind keine austauschbaren laufenden Finanzadapter. Die nicht ausgeführte Finanzskizze liegt in `docs/drafts/supabase_financial_schema.sql`, außerhalb der aktiven Migrationen. Die spätere Umstellung braucht API-/Transaktionsmigration und zusätzliche RLS-/Objektzugriffstests. Passkeys, Recovery, private Dokumentablage, Secrets/KMS, Zertifikate, persistente Jobqueue und DTA-Protokolladapter sind offen. Die App bietet kein Signup; die Supabase-Einstellung für neue Benutzer wurde noch nicht verifiziert.

Keine Produktionsschlüssel oder Daten in Browserkonfiguration. Supabase-Region, DPA/AVV, Logs, Backups, Unterauftragsverarbeiter, Wiederherstellbarkeit und mögliche Drittlandzugriffe müssen vor Datenfreigabe geprüft werden. Eine konkrete Region oder ein Free-Tarif stellt für sich keine Datenschutzfreigabe dar.

## Betrieb

Standard ist Loopback `127.0.0.1:3000`. Die Demo darf nicht ins öffentliche Netz gebunden werden. Ein späterer Serverbetrieb benötigt HTTPS, Authentisierung/MFA, Netzgrenzen, Überwachung und sichere automatische Backups. Das manuelle Backup nimmt einen konsistenten SQLite-Snapshot einschließlich bestätigter WAL-Transaktionen; Restore prüft Integrität in einem isolierten temporären Verzeichnis und überschreibt niemals aktive Daten. RPO/RTO wurden für echten Betrieb noch nicht vereinbart; lokale Demo-Backups besitzen keinen automatischen Zeitplan.
