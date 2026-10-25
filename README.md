# TaxiDTA

TaxiDTA ist eine deutschsprachige Testanwendung für Abrechnungsfälle, Tarifberechnung und Rechnungen. Die Vercel-Version verwendet eine Serverless-API und Supabase für Anmeldung und dauerhafte Datenspeicherung. Ein lokaler Backend-Server wird dafür nicht benötigt. Rechnungsfälle enthalten eine Verordnung mit bis zu 20 Einzelfahrten; mehrere Fälle lassen sich gemeinsam abrechnen.

Die Online-API verlangt die Anmeldung des festgelegten Inhabers mit Passwort und Authenticator-TOTP. Die Datenbank prüft Inhaber, MFA und aktive Websitzung. Archivierte PDFs und Rechnungshistorie werden gegen nachträgliche Änderungen geschützt. Der aktuelle Workspace ist auf 1,9 MB einschließlich PDF-Archiven begrenzt und für synthetische Tests ausgelegt.

**Kein Produktivsystem:** Der vollständige §302-Dateigenerator und echte DTA-Transport fehlen. Die DTA-Zentrale zeigt die tatsächlichen Sperrgründe. PDFs sind Testdokumente. Ein persönlicher Online-Test von Passwort, TOTP, Speicherung und PDF-Abruf nach dem Deployment steht noch aus.

Für den GitHub-Import in Vercel und die erforderlichen Server-Einstellungen: [VERCEL.md](docs/VERCEL.md).

Für den Einstieg auf dem Mac: [START_HIER.md](START_HIER.md).

## Lokal starten

Voraussetzung: Node.js 24 oder neuer. Ein Cloudkonto und Docker sind für die lokale Demo nicht erforderlich.

```bash
npm ci
npm run dev
```

Danach `http://127.0.0.1:3000` im Browser öffnen. Das Terminal bleibt geöffnet. Beenden mit `Ctrl+C`. Server und lokale Datenbank sind an den Demo-Modus gebunden; die Anwendung nicht über einen Tunnel oder einen öffentlichen Webserver erreichbar machen.

## Prüfen

```bash
npm test
npm run lint
npm run build
npm run security:check
npm run test:e2e
```

`test:e2e` verwendet einen vorhandenen Linux-Chromium unter `/usr/bin/chromium` oder den von Playwright bereitgestellten Chromium. Auf dem Mac bei Bedarf einmal `npx playwright install chromium` ausführen; `CHROMIUM_PATH` kann einen ausdrücklich gewählten vorhandenen Browserpfad setzen. Die Konfiguration steht in `playwright.config.ts`. Ein erfolgreicher TypeScript-Build ersetzt keinen Sicherheitsreview.

Nach einem Build lässt sich die gebaute Oberfläche mit `npm start` ebenfalls lokal öffnen. `npm run db:migrate` bereitet die lokale Demo-Datenbank vor; die Supabase-SQL-Dateien werden damit **nicht** in eine Cloud eingespielt. Browsertests laden die private `.env.local` ausdrücklich nicht und verwenden eine getrennte synthetische Datenbank.

## Inhaber-Anmeldung und Supabase

Der Server lädt vorhandene lokale Einstellungen aus der ignorierten `.env.local`. Projekt-URL, Publishable Key und bestätigte Inhaber-UUID werden dort oder über die Prozessumgebung konfiguriert. `TAXIDTA_AUTH_REQUIRED=true` schaltet die Anmeldepflicht ein und verlangt diese vollständige Konfiguration. Fehlt Supabase vollständig, bleibt die lokale synthetische Demo ohne Login möglich. Ein Fehler im geschützten Modus fällt niemals auf diesen offenen Modus zurück.

Im eingerichteten Projekt wurden die tatsächliche Region **AWS `eu-central-1`, Frankfurt**, das bestätigte Inhaberkonto und die Datenbankbindung über den Verwaltungszugang geprüft. Alle vier Einrichtungsmigrationen einschließlich Websitzungen und Cloud-Workspace sind angewendet. Reale SQL-Negativprüfungen wiesen anonyme Zugriffe, AAL1 und behauptetes AAL2 ohne aktive Sitzung ab. Der persönliche Passwort-/TOTP-Login und der positive UUID-Schreib-/Lese-/Löschtest stehen noch aus. Die verwaltete Entwicklungsumgebung blockiert derzeit direkte HTTPS-Verbindungen zur Projektadresse; der Plugin-Verwaltungszugriff funktioniert.

Mit `npm run supabase:check` lässt sich der erlaubte Netzwerkpfad ohne Passwort prüfen. Der Befehl meldet keine erfolgreiche Anmeldung oder Produktionsbereitschaft. Die genaue Einrichtung im Browser beschreibt [START_HIER.md](START_HIER.md). Passwörter, QR-Schlüssel und Authenticator-Codes werden ausschließlich dort eingegeben, niemals im Chat.

## Sicherung

```bash
npm run backup -- work/backups/mein-backup.tdbak
npm run restore:test -- work/backups/mein-backup.tdbak
```

Die Sicherungsbefehle verlangen ein eigenes starkes Sicherungspasswort. Details, Dateiauswahl und Grenzen stehen in [START_HIER.md](START_HIER.md). Wiederherstellungstests arbeiten mit einer getrennten Kopie und überschreiben die laufende Datenbank nicht.

## Fachlicher Umfang

- Kunden und Fahrten für Privatpersonen, Firmen, Kurier/Labor und synthetische Krankenfahrten. Offene Fahrten lassen sich korrigieren; abgerechnete Fahrten bleiben auch nach Storno unveränderlich.
- Artikel I/II für belegte Einpersonenfälle; 20 km ergeben 52,59 € bzw. 51,74 €. Fehlende Voraussetzungen und nicht abgedeckte Fälle werden abgewiesen.
- Begrenzte datierte Steuerregeln für inländische Standardfälle 2026: qualifizierte Taxifahrt bis einschließlich 50 km oder innerhalb einer Gemeinde 7 %, sonst 19 %; reine Kurier-/Laborleistung im Standardfall 19 %. Ungeklärte Mietwagen-/Sonderfälle werden gesperrt. Die Regelabdeckung ist keine steuerliche Freigabe.
- Einzel-/Sammelrechnungen mit eigenem Nummernkreis, archivierten Original-PDFs, Zahlungen und verknüpften Stornodokumenten. Normale Rechnungen nutzen 28 Kalendertage Zahlungsziel. Bei Kassenrechnungen ist die echte Vertragsfrist ungeprüft: `dueAtVerified=false` kennzeichnet das Datum ausschließlich als Demo-Wiedervorlage nach 28 Tagen.
- Wiederholte Zahlungsbefehle werden durch eine stabile Idempotenzkennung gegen versehentliche Doppelbuchung geschützt.
- Begrenzter KOTR-Strukturleser nach amtlichem Anhang 3 V09 mit Quellenoffsets und Roundtrip-Tests. Das Labor aktiviert keine Kostenträgerdaten und löst keinen vollständigen gültigen IK-Pfad auf; ausschließlich synthetische Tests, keine amtlichen Golden Files. Umfang: [KE_PARSER_PROFILE.md](docs/KE_PARSER_PROFILE.md).
- Änderungsjournal und DTA-Bereitschaftsberichte. Eine Hashkette erschwert unbemerkte Änderungen; sie schützt nicht vor einem Angreifer mit voller Kontrolle über den Rechner.

## Projektaufbau

| Ort | Inhalt |
| --- | --- |
| `src/` | React-Oberfläche und gemeinsame Typen |
| `src/domain/` | Tarif-, Steuer-, Cent- und Datumsregeln |
| `server/` | API, lokale SQLite-Persistenz, PDF-Ausgabe und serverseitige Inhaber-/TOTP-Anmeldung |
| `tests/` | Fach-, Backend-, Sicherungs- und Oberflächentests |
| `scripts/` | Migration, Sicherung und Sicherheitsprüfung |
| `supabase/migrations/` | Zwei angewendete Migrationen für Inhaberbindung und begrenzten UUID-Verbindungstest |
| `docs/drafts/` | Nicht ausgeführte Finanzdatenbankskizze außerhalb der aktiven Migrationen |
| `docs/` | Quellen, Anforderungen, Sicherheitsmodell, Lücken und Nachweise |
| `work/` | Ignorierte lokale Laufzeitdaten; nicht in Git aufnehmen |

Private Originaldokumente bleiben außerhalb des Repositorys. Keine echten Patienten-, Bank-, IK-, Steuer- oder Schlüsseldaten in Code, Testdaten, Screenshots oder Fehlermeldungen kopieren.

## Weiterer Ausbau

Der nächste Integrationsnachweis ist die persönliche Anmeldung mit TOTP und der begrenzte Datenbanktest über den vorgesehenen Netzwerkpfad. Supabase meldet außerdem noch [deaktivierten Schutz gegen bekannte geleakte Passwörter](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Die App bietet keine Registrierung; die projektweite Supabase-Einstellung für neue Benutzer wurde noch nicht bestätigt oder geändert.

Vor echten Daten sind unter anderem Wiederherstellung, private Dokumentablage, geprüfte Backups, weitere Zugriffs- und Isolationstests, Datenschutzprüfung und dokumentierte Freigabe erforderlich. DTA benötigt zusätzlich aktuelle offizielle Spezifikationen, verifiziertes IK-Routing, korrekte Zertifikate und eine autorisierte Testübertragung mit Originalantwort.

[Produktumfang](docs/PRODUCT_SPEC.md) · [Abnahme und offene Punkte](docs/ACCEPTANCE.md) · [Phasenplan](docs/PHASED_PLAN.md) · [Zusätzliche Ideen](docs/PRODUCT_IDEAS.md)
