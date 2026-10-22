# Abnahme, Ergebnisse und verbleibende Lücken

Stand: 22.10.2026. Nachgewiesen werden der lokale synthetische Testumfang und die ausdrücklich beschriebenen begrenzten Cloudprüfungen. Eine bestandene Teilprüfung macht den vollständigen Masterprompt nicht abgeschlossen. Insbesondere ist TaxiDTA noch kein freigegebenes Gesundheitsdaten- oder §302-Produktivsystem.

## Tatsächlich ausgeführte Prüfungen

Die folgende Tabelle dokumentiert den abgeschlossenen Gesamtstand einschließlich der Inhaber-/TOTP- und Supabase-Erweiterung. Die Cloud-Nachweise und ihre Grenzen stehen unmittelbar darunter.

| Befehl | Ergebnis dieser Prüfung | Aussagegrenze |
| --- | --- | --- |
| `npm test` | 87 Tests, 87 bestanden, 0 Fehler, 0 übersprungen im abschließenden Integrationslauf (22.10.2026) | Domain-, Backend-, Backup-, Auth- und Datenadaptertests in `tests/*.test.ts`; keine externe Gegenstelle |
| `npm run lint` | Bestanden: strikte TypeScript-Prüfung | TypeScript-Prüfung, keine vollständige SAST |
| `npm run build` | Bestanden: TypeScript und Vite-Produktionsbuild | Buildfähigkeit, keine Produktionsfreigabe |
| `npm run security:check` | Bestanden: 69 Quelldateien, keine Treffer der eingebauten Schlüssel-/IBAN-Muster (22.10.2026) | Lokaler Umfang laut Skript; kein Penetrationstest |
| `npm audit` (einschließlich Entwicklungspaketen) | 0 gemeldete Advisories am 22.10.2026 | Momentaufnahme des Anbieter-Datenbestands, keine allgemeine Sicherheitsgarantie |
| `npm run test:e2e` | 12 Browserfälle bestanden: sieben Fachabläufe und fünf Setup-/Anmeldefälle, einschließlich MFA-Gate und Wiederaufnahme nach 503; eigene Datenbank je Lauf | Chromium; synthetische Daten und simulierte Auth-/RPC-Antworten; kein persönlicher Cloudlogin, keine externe Kasse, kein vollständiges WCAG-Testat |

### Ergänzter Inhaber-/TOTP- und Cloudumfang

- Lokale Auth-, Datenadapter- und API-Integrationstests bestehen. Sie prüfen Owner-/MFA-Sperren, Kennungs-/CSRF-Rotation, Raten-/Ablaufgrenzen, Tokenrefresh, festen RPC-Vertrag und den UUID-Schreib-/Lese-/Löschablauf mit simulierten Antworten. Die Setup-Browserfälle verwenden ebenfalls simulierte Auth-/RPC-APIs und sind kein echter Cloudlogin.
- Im tatsächlichen Projekt über den Verwaltungszugang bestätigt: Region `eu-central-1`, Frankfurt; aktiver bestätigter App-Benutzer; getrennt administrativ gesetzte Inhaberbindung; beide aktiven Einrichtungsmigrationen angewendet. Die privaten Tabellen besitzen RLS und keine direkten Clientrechte. Öffentliche RPCs sind Invoker-Hüllen mit begrenzten Ausführungsrechten.
- Echte SQL-Rollen-/Claims-Negativtests verweigerten anonyme RPCs, Inhaber-AAL1 und behauptetes AAL2 ohne vorhandene Sitzung. Die Probe-Tabelle blieb leer. Diese Tests erzeugen weder echte Anmeldetokens noch eine positive MFA-Sitzung.
- Persönlicher Passwortlogin, QR-Enrollment, richtige/falsche Codes und positiver UUID-Roundtrip am echten Konto sind noch offen. Direkte SDK-/HTTPS-Verbindungen zum Projekt werden derzeit von der verwalteten Umgebung blockiert; der Plugin-Verwaltungszugriff funktioniert.
- Ein zusätzlicher Lauf des gebauten Servers mit der echten privaten Konfiguration bestätigt: Frontend erreichbar, Inhaber-/MFA-Pflicht aktiv, Frankfurt-Status vorhanden, fachliche API ohne Anmeldung mit HTTP 401 gesperrt und kein Publishable Key in der Statusantwort. Dabei wurde weder ein persönlicher Login noch eine externe SDK-Anfrage ausgeführt.
- Die zusätzliche Inhaber-Policy beseitigte den zugehörigen Advisor-Hinweis. Verbleibend meldet Supabase [deaktivierten Schutz gegen bekannte geleakte Passwörter](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Der Status der projektweiten Registrierung wurde noch nicht bestätigt oder geändert; die App selbst bietet kein Signup.

Der neue Ablaufgrenzentest verweigert außerdem eine Sitzung, die erst während der Datenbankprüfung abläuft. Ein separater Quellscan fand keine tatsächlichen privaten Projekt-/Inhaberwerte in den verteilbaren Dateien; die ignorierte `.env.local` besitzt lokale Rechte `0600`.

Fachliche Daten und PDFs bleiben in SQLite. Der Code fordert bei `TAXIDTA_AUTH_REQUIRED=true` vor jeder fachlichen API einschließlich Export/PDF Owner/AAL2 und eine aktive Datenbanksitzung. Für einen vollständigen Freigabenachweis fehlen unter anderem der persönliche Liveablauf, Recovery, Passkeys, private Dateien und Betriebs-/Datenschutzabnahme.

Die Testnamen enthalten bewusst die geprüften Bedingungen. Aus einer positiven Sperrprüfung wird kein Nachweis einer noch nicht implementierten Krypto-/Transportfunktion abgeleitet.

Die QA fand und behob ein Storno-/Zahlungsrennen sowie eine Dublettenlücke durch unterschiedliche Dezimalschreibweisen der Kilometer. Weitere adversarielle Regressionen prüfen unter anderem wiederholte Zahlungsbefehle, zukünftige Buchungsdaten und korrekte negative Stornopositionen (`tests/qa.test.ts`). Der grüne Gesamtlauf enthält diese Korrekturen. Zusätzlich behoben: veralteter Rechnungssnapshot bei gleichzeitiger Fahrtbearbeitung, unberücksichtigter Datenbank-Konfigurationspfad sowie Überlappungen langer Empfängerfelder im PDF. Beschreibungen sind ausdrücklich auf 500 Zeichen und 20 Zeilen begrenzt; unzulässige Eingaben werden abgewiesen und nicht gekürzt.

## Abnahmetests A1–A20

„Gegeben / Wenn / Dann“ beschreibt jeweils die gewünschte Abnahme; die letzte Spalte unterscheidet erreichten Teilumfang und offene Pflicht.

| ID | Gegeben / Wenn / Dann und konkrete Eingabe | Erwartung | Quelle / Testdatei | Tatsächlicher Stand |
| --- | --- | --- | --- | --- |
| A1 | Gegeben: Einperson, bestätigter Testvertrag, 22.10.2026. Wenn: 20 km Art. I bzw. II berechnet werden. Dann: Grundpreis und 17 Zusatz-km. | I: 510100 ×1 + 513000 ×17 = 5.259 Cent. II: 510131 ×1 + 513131 ×17 = 5.174 Cent. | Gelieferte Art.-I/II-PDFs, jeweils S. 1; `tests/domain.test.ts` | Bestanden im engen Basisumfang; individuelle echte Vertragsberechtigung nicht nachgewiesen. |
| A2 | Gegeben: derselbe Basisfall. Wenn: 1/3/4 km, 0, −1 oder 3,01 km eingegeben werden. Dann: keine Doppelberechnung oder unbelegte Rundung. | 1/3 km 1.400 Cent; 4 km I 1.627 / II 1.622; 0/negativ/ungeklärter Teil-km gesperrt. | Tarif-PDFs; `tests/domain.test.ts` | Bestanden. 0 km wird nicht als erbrachte Personenfahrt akzeptiert. |
| A3 | Gegeben: ausgestellte alte Rechnung und späterer Tarifwechsel. Wenn: neue Leistung am neuen Stichtag abgerechnet wird. Dann: Original bleibt alt, neue gültige Regel wird gewählt. | Keine rückwirkende Neuberechnung; versionierte Regelwahl. | Masterprompt §§5–6; `tests/backend.test.ts` Original-/Persistenztests | Originalschutz teilweise belegt; vollständiger Tarifwechsel-/Importtest offen. |
| A4 | Gegeben: Mehrpersonenfall. Wenn: Berechnung angefordert wird. Dann: nur belegte Mehrpersonenregel. | Kein naives Multiplizieren eines Einpersonenpreises. | Art.-I/II-PDFs; `tests/domain.test.ts` | Aktuell bewusst gesperrt. Mehrpersonenberechnung nicht implementiert; daher nur Sicherheits-Teilumfang bestanden. |
| A5 | Gegeben: unbekannte/alte/mehrdeutige IK. Wenn: echter Versand angefordert wird. Dann: Versandstopp. | Keine Namenheuristik oder historische Fallbackadresse. | Masterprompt §8; `tests/backend.test.ts` DTA-Sperre | Sämtlicher echter Versand gesperrt. Ein begrenzter V09-KOTR-Strukturleser mit synthetischen Tests ist vorhanden; vollständiger KE-Import und gültige fallbezogene IK-Auflösung fehlen. |
| A6 | Gegeben: physischer Empfänger ohne Entschlüsselungsbefugnis. Wenn: verschlüsselt wird. Dann: Schlüssel des berechtigten Entschlüsselers. | Kryptografischer Empfänger-/Routingnachweis. | Aktuelle amtliche TA/KE erforderlich | Offen. Keine DTA-Verschlüsselung implementiert; kein künstlicher Ersatztest als Konformität. |
| A7 | Gegeben: ungültiges/abgelaufenes Zertifikat. Wenn: Versand versucht wird. Dann: sichere Ablehnung. | Ablauf-, Ketten-, Sperr- und IK-Prüfung. | Amtliche Krypto-/Transportvorgaben erforderlich | Die manuelle Nachweischeckliste weist behaupteten falschen Empfänger, Ablauf oder Sperrstatus ab; sie validiert keine echte Zertifikatskette. Genereller Live-Stopp vorhanden, echte Zertifikatsprüfung offen. |
| A8 | Gegeben: originale, passende oder gefälschte/duplizierte Rückmeldung. Wenn: importiert. Dann: sichere Korrelation und Status. | Originalnachweis, Integrität, Idempotenz. | Amtliches Rückmeldeformat erforderlich | Offen; kein Quittungsparser oder simulierte fremde Annahme vorhanden. |
| A9 | Gegeben: Gesamtrechnung mit Urbelegen. Wenn: Anlage-4-Begleitzettel erstellt wird. Dann: offizielle Felder und passende Packliste. | Korrekte IK-/Nummern-/Beleganzahl und keine Dubletten. | Aktuelle Anlage 4 erforderlich; `tests/backend.test.ts` Belegnummerndublette | Eindeutige Belegreferenzen teilweise belegt; offizielles Begleitzettel-PDF und Postlauf offen. |
| A10 | Gegeben: fehlende Teilnahme, Routing, Zertifikat oder Live-Freigabe. Wenn: Versand angefordert wird. Dann: blockiert. | Keine sendende Route, kein stiller Live-Schalter. | Masterprompt §20; `tests/backend.test.ts` DTA-Test | Bestanden als lokale Gesamtsperre: Bereitschaftsbericht nennt fehlende Nachweise, `/api/dta/send` ist nicht vorhanden. |
| A11 | Gegeben: unberechtigter Nutzer/Mandant. Wenn: Akte/Seed/PDF angefordert. Dann: serverseitige Ablehnung. | Objekt-/Mandantentrennung. | `tests/auth-security.test.ts`, `tests/setup-api.test.ts`; Cloud-SQL-Negativtests | Teilumfang implementiert: Bei Anmeldepflicht geschützte fachliche APIs einschließlich PDF/Export; fremde Owner und fehlende MFA werden abgewiesen. Persönlicher Liveablauf und spätere Finanz-/Datei-/Mandantenisolation offen. |
| A12 | Gegeben: Inhaber mit Microsoft Authenticator und Passkey. Wenn: Enrollment/Login/Recovery. Dann: kein MFA-Bypass. | RFC-6238-TOTP, sichere Recovery und WebAuthn. | Masterprompt §12; `tests/auth-security.test.ts`, `tests/e2e/setup.spec.ts` | Passwort/TOTP implementiert und lokal mit simuliertem Provider geprüft. Echtes persönliches Enrollment/erneuter Login noch offen; Passkeys und Recovery nicht implementiert. |
| A13 | Gegeben: unbezahlte ausgestellte Rechnung. Wenn: Storno mit Grund. Dann: neues negatives Dokument referenziert Original. | Original-PDF bleibt; Nummern nicht wiederverwendet; Fahrt nicht erneut automatisch berechenbar. | Masterprompt §19; `tests/backend.test.ts` Storno-/Idempotenztest | Bestanden für Demo-Storno einschließlich Zahlung während der PDF-Vorbereitung. Bezahlte Rechnung wird bis zu einem geprüften Erstattungsflow nicht storniert. |
| A14 | Gegeben: synthetische SQLite-Datenbank im WAL-Modus. Wenn: verschlüsselte Sicherung erstellt und separat geprüft wird. Dann: Integrität korrekt, aktive DB unverändert. | AES-256-GCM-Authentifizierung, richtiger SHA-256, falsches Passwort/Manipulation abgewiesen. | `tests/backup.test.ts` | Bestanden. Kein Nachweis für noch nicht angeschlossene Cloud-Dateien, KMS oder vollständige Betriebswiederherstellung. |
| A15 | Gegeben: lokale Demo. Wenn: Rechnung oder Bereitschaftsbericht erzeugt wird. Dann: eindeutiger Testkontext. | Nie Fake-Quittung oder „angenommen“ ohne externe Evidenz. | `tests/backend.test.ts`, `tests/pdf.test.ts`, `tests/e2e/workflows.spec.ts` und visuelle PDF-Prüfung | Backend-Typ `readiness-report`, Modus `dry-run`, Status `blocked` und fehlende Sendefunktion belegt; Browser- und PDF-Kennzeichnung geprüft. |
| A16 | Gegeben: neuer Testkunde und Krankenfahrt. Wenn: vollständige Muster-4-/Rechnung-/Beleg-/DTA-Kette durchlaufen. Dann: nutzbarer Browserflow. | Vollständiger angeforderter End-to-End-Flow. | Masterprompt §16; Browsernachweis erforderlich | Teilflow Kunde/Fahrt samt Korrektur offener Fahrten/Rechnung/PDF/Bereitschaftsbericht implementiert; Muster 4, Anlage 4 und Quittungsimport fehlen. Kein vollständiges Bestehen behauptet. |
| A17 | Gegeben: Leistungen/Übermittlungen 2026/2027. Wenn: Format gewählt wird. Dann: offizielle Übergangsregel. | Verifizierte Version je Zeitpunkt, keine globale Fantasieversion. | Aktuelle TA1/TA3/Anhänge erforderlich | Offen. Versionen/Wirksamkeit wurden amtlich recherchiert (`RESEARCH_LOG.md` R01/R03/R03b); begrenztes V09-KOTR-Profil vorhanden, noch keine Abrechnungsadapter oder V21/V22-Übergangstests. Nicht unterstützte Tarif-/Steuerjahre werden gesperrt. |
| A18 | Gegeben: Tastatur, Desktop und kleiner Bildschirm. Wenn: Formulare/Suche bedient werden. Dann: verständlich und erreichbar. | Responsivität, Fokus, Suche, Fehler, keine Datenverluste. | Browser-/Accessibility-Prüfung erforderlich | Browserfälle für Tastaturnavigation, Dialog/Escape, Dunkelmodus und 390-Pixel-Ansicht bestanden; Desktop-/Mobil-Screenshots visuell geprüft. Kein vollständiges WCAG-Testat. |
| A19 | Gegeben: manipulierte Eingabe/Origin/Host/CSRF. Wenn: API angesprochen. Dann: Ablehnung. | Schutz vor den tatsächlich geprüften Klassen. | `tests/backend.test.ts`; Sicherheitsmodell | CSRF/Origin/Host/Schema/append-only im Demo-Scope bestanden. Ergänzte Auth-/API-Tests und echte SQL-Negativtests belegen ihren begrenzten Umfang; vollständige BOLA-/Datei-/Upload-/Zertifikatsprüfung und Stresstest bleiben offen. |
| A20 | Gegeben: Mac-Anfänger mit Projektdateien. Wenn: `START_HIER.md` befolgt wird. Dann: lokal startbar und Grenzen verständlich. | Node24, Installation/Start/Prüfung/Sicherung, klare Demo-/Cloud-/DTA-Trennung. | `START_HIER.md` | Anleitung geliefert; tatsächlicher unerfahrener Mac-Benutzertest noch offen. Befehle unter Linux geprüft, Installations-/Klickpfade nicht vollständig live verifiziert; amtliche Recherche siehe `RESEARCH_LOG.md`. |

## Zusätzliche V2-Abnahme

| ID | Gegeben / Wenn / Dann | Erwarteter Nachweis | Stand |
| --- | --- | --- | --- |
| V2-1 | Fiktiver Privatkunde mit Name/Adresse → Taxi-Testfahrt → Rechnung. | Kein Versicherungszwang; Original-PDF mit eigener Nummer und 28 Tagen. | Browserflow Kunde → vergangene Fahrt → Rechnung → Original-PDF → Teilzahlung bestanden. Keine produktiven Bankdaten. |
| V2-2 | Mehrere vergangene Leistungen desselben Kunden → Sammelrechnung. | Leistungsdaten bleiben getrennt, Steuergruppen stimmen, keine Doppelbindung. | `tests/backend.test.ts`: zwei unterschiedliche Leistungsdaten und 7/19 %, Summe 22.600 Cent = 20.000 netto + 2.600 Steuer bestanden; vier-Fahrten-UI-Fall ggf. ergänzen. |
| V2-3 | Reine Kurier-/Laborleistung → Rechnung. | Keine Versicherungspflicht, Standard 19 % statt pauschal 7 %. | Domain-Test und gemischter Backend-Test bestanden. |
| V2-4 | 49,99/50,00/50,01 km und 60 km Gemeinde/außerhalb, Mietwagen-Sonderfall. | 7/7/19 %, 7/19 %, unbekannter Sonderfall gesperrt. | `tests/domain.test.ts` bestanden für datierte 2026-Demoregel. §12 UStG wurde geöffnet (`RESEARCH_LOG.md` R04); individuelle steuerliche Sonderfälle bleiben ungeprüft. |
| V2-5 | 20 km Art. I/II. | 52,59 €/51,74 €, keine zusätzliche USt auf bereits brutto kalkulierte Preise. | Domain- und Backend-Tests bestanden. |
| V2-6 | Acht parallele Rechnungsvorgänge, Wiederholung derselben Befehlskennung. | Einmalige fortlaufende Nummern; gleiche Kennung liefert dasselbe Original; 22.10. → 19.11.2026. | `tests/backend.test.ts` und Datumstest bestanden. |
| V2-7 | Später gelieferte eigene Vorlage, mehrseitige Sammelrechnung. | Pflichtangaben, Umbrüche, Vergleichsrendering. | Offen; keine eigene Vorlage geliefert/angebunden. Bestehender Original-PDF-Test ist kein Vorlagentest. Zwei PDF-Regressionen prüfen vollständige lange Namen/Adressen und überlappungsfreie Seitenumbrüche; beide hier ohne Überspringen bestanden. |
| V2-8 | Unbekannter physischer/Entschlüsselungsempfänger. | Echter Versand bleibt blockiert. | Allgemeine Sperre bestanden; offizielles IK-Routing offen. |
| V2-9 | Autorisierte echte Gegenstelle mit gültigen Zertifikaten. | Verschlüsselung, Transport, Originalantwort, idempotente Wiederholung. | Offen und gesperrt. |
| V2-10 | Unberechtigter Cloudzugriff, MFA-Recovery, private Dateien, Backup. | RLS/MFA/BOLA/Upload-Negativtests plus Restore. | Backup bestanden; Owner-/TOTP-/RPC-Code und begrenzte SQL-Negativprüfungen ergänzt. Persönlicher MFA-Liveablauf, Recovery, Finanz-/Dateicloud und Uploads offen. |
| V2-11 | Tatsächliches Supabase-Projekt in Frankfurt. | Region, Logs, Storage, Backups, DPA/Transfers geprüft. | Region Frankfurt `eu-central-1` tatsächlich bestätigt; Inhaberbindung und begrenztes Einrichtungsschema angewendet. Logs, Storage, Backups, DPA/Transfers und Gesundheitsdatenfreigabe offen. |
| V2-12 | Inhaber folgt Mac-/Supabase-/DTA-Anleitung. | Verständliche konkrete Schritte, keine erfundenen Empfänger/Preise. | Anleitung und DTA-Arbeitsliste geliefert; externe Klickpfade/Anbieterpreise nicht vollständig live verifiziert; GKV-/Empfängerkontakte sind mit begrenzter Aussage recherchiert. |

## Nachweis der zusätzlichen Verbesserungen

`PRODUCT_IDEAS.md` enthält die bewerteten 42 Ergänzungen und 15 priorisierte Kandidaten. Schon automatisiert belegte Verbesserungen sind:

- Unmittelbare Doppelabrechnung nach Storno wird verhindert; Original und Fahrtbindung bleiben erhalten.
- Überzahlungen, negative Zahlungen und Zahlungen auf stornierte Rechnungen werden abgewiesen.
- PDF-Nachabruf ist bytegleich zum archivierten Original und passt zu dessen SHA-256.
- Wiederholte Rechnungs- und Zahlungsbefehle mit gleicher Idempotenzkennung erzeugen kein zweites Dokument bzw. keine zweite Zahlung; abweichender Inhalt mit gleicher Kennung wird abgewiesen.
- Fahrtdubletten werden auch bei gleicher Distanz mit unterschiedlicher Dezimalschreibweise erkannt; Storno prüft zwischenzeitlich eingegangene Zahlungen unmittelbar vor dem Abschluss erneut.
- Zukünftige Rechnungs-/Zahlungsdaten werden im aktuellen Demo-Flow abgewiesen. Kassenfristen bleiben als ungeprüft gekennzeichnet (`dueAtVerified=false`), das Datum ist dort nur Wiedervorlage.
- Nicht belegte Tarif-Teilkilometer und Datumsbereiche werden ausdrücklich gesperrt.
- Sicherung mit falschem Passwort bzw. veränderter Hülle wird abgewiesen; der Wiederherstellungstest verändert die aktive DB nicht.
- Falsche Host-/Origin-Angaben und fehlender CSRF-Token werden abgewiesen.

Diese Nachweise gelten jeweils für den beschriebenen lokalen oder begrenzten SQL-Testumfang. Sie erteilen keine Freigabe für ein öffentlich betriebenes System.

## Korrektur offener Fahrten

Vier ergänzte Backend-Regressionen prüfen den tatsächlichen Bearbeitungsablauf (`tests/backend.test.ts`):

- Fehlende Test-Verordnungsbestätigung wird an einer offenen Krankenfahrt ergänzt; ID/Erstellungszeit bleiben gleich, 21-km-Art.-I-Betrag wird serverseitig auf 5.486 Cent berechnet.
- Bereits abgerechnete Fahrten werden vor und nach Storno gegen Änderung gesperrt; das Original-PDF bleibt bytegleich.
- Die unveränderte eigene Fahrt ist kein Dublettentreffer; fremde gleiche Belegnummer bzw. Fahrtstrecke wird atomar abgewiesen.
- Änderung während der PDF-Vorbereitung verhindert einen Abschluss mit veralteten Beträgen. Die reservierte Nummer wird nicht recycelt; ein späterer neuer Abschluss verwendet die aktualisierten Werte.

Die geänderten Feldnamen werden ohne vertrauliche Feldwerte protokolliert. Ein vollständiger Muster-4- oder Mehrfenster-Entwurfsversionsworkflow ist damit noch nicht umgesetzt.

## Ergänzter KOTR-Strukturleser

Grundlage: am 22.10.2026 tatsächlich geöffneter amtlicher Anhang 3 V09, §7/8. Der engere Umfang steht in `KE_PARSER_PROFILE.md`. Er liest ausgewählte Segmente des Kostenträgerformats und erzeugt **keine §302-Abrechnungsdatei**.

| Gegeben / Wenn / Dann | Erwartung / Ergebnis | Evidence und Grenze |
| --- | --- | --- |
| Synthetische KOTR-Nachricht mit maskierten Komponenten → lesen, Modell ändern, serialisieren → wieder lesbar. | Strukturierter Roundtrip, Rollen bleiben getrennt; Tests bestanden. | `tests/ik.test.ts`; kein amtliches Golden File. |
| Falsche Feldlänge, Reihenfolge, Referenz, Kontrollzähler oder Kalenderdatum → lesen. | Präziser Fehler mit Segment/Feld/Textoffset; Tests bestanden. | `tests/ik.test.ts`; Offsets beziehen sich auf bereits dekodierten Text. |
| Nicht unterstützte Gruppe, Zeichensatz, Syntax oder fehlender TP5-Abrechnungscode → lesen. | Ablehnung statt stiller Teilaktivierung; Tests bestanden. | `tests/ik.test.ts`; vollständiger KE-Import weiterhin offen. |
| Maskierte Aufhebungszeichen, mehrere Nachrichten, ungültige Intervalle und Kontrollzeichen → unabhängig prüfen. | Roundtrip oder begründete Ablehnung gemäß engem Profil; vier zusätzliche QA-Tests bestanden. | `tests/ik-qa.test.ts`; keine aktive Verzeichnisdatenbank. |
| Manuell behauptete IK-Rollen/Quellen-/Zertifikatsmerkmale → Bereitschaft prüfen. | Fehlende/falsche/alte Angaben blockieren. Selbst bei allen positiven Angaben bleibt `DEMO_ONLY` bestehen. | `tests/ik.test.ts`, `tests/ik-qa.test.ts`; keine tatsächliche Zertifikatskettenprüfung oder reale Zuständigkeitsentscheidung. |

Gezielte Parserprüfungen: 10 Fachtests und 4 unabhängige QA-Tests bestanden. Der abschließende Gesamtlauf wird oben aktualisiert. Das Labor verarbeitet im Browser höchstens 200.000 eingegebene Zeichen ohne Speicherung; die Bibliothek begrenzt das Profil zusätzlich. Eine erfolgreiche Syntaxprüfung erteilt keine Herkunfts-, Vertrags-, Routing- oder Transportfreigabe.

## Noch notwendige externe Evidenz

Aktuelle amtliche TA-/KE-/Anlage-4-/KBV-Originale mit Wirksamkeit und Prüfsummen; echte individuelle Vertragsberechtigung; autorisierte Teilnahme und Empfänger-/Transportbestätigungen; verwaltete Zertifikate; echte Testquittung; Datenschutz-/Sicherheitsfreigabe und unabhängiger Review. Weder ein Test-Häkchen noch ein grüner Build ersetzt diese Nachweise.
