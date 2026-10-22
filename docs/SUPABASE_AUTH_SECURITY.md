# Supabase-Anmeldung: Sicherheitsgrenzen und Prüfpunkte

Stand: 22.10.2026. Diese Prüfung betrifft die implementierte serverseitige Supabase-Anmeldung von TaxiDTA. Sie ersetzt keine unabhängige Produktionsfreigabe. Die vorhandene lokale SQLite-Faktura bleibt eine Umgebung für synthetische Daten.

## Nachweis und tatsächlicher Zugang

Die bereitgestellten Projektangaben genügen zur Konfiguration des öffentlichen Supabase-Clients. Ein Publishable Key ist keine Administratorberechtigung, keine Datenbankmigration, kein Nachweis einer erlaubten Datenverarbeitung und kein DTA-Zertifikat. Projekt-URL, Schlüssel und echte Betriebsidentität werden nicht in diesen Bericht, Demodaten oder Quellcode kopiert.

Die Angabe „Europe“ allein bestätigt keine konkrete AWS-Region. Das tatsächliche Projekt wurde inzwischen über das Verwaltungsplugin geprüft: AWS `eu-central-1`, Frankfurt; das bestätigte Inhaberkonto existiert und ist getrennt administrativ gebunden. Für echte Gesundheitsdaten müssen Datenbank, Storage, Backups, Logs und weitere Datenflüsse separat geprüft werden; Ziel ist ausdrücklich `eu-central-1`, Frankfurt. Auch ein bekanntes eigenes IK und bisheriger Versand über DMRZ beweisen keine Freischaltung von TaxiDTA als eigenem technischen Einreicher.

Die Cloud-Umgebung erlaubt derzeit nur Paket-/Quellcode-Hosts; der benutzereigene Supabase-Projekthost ist nicht im bestätigten Netzwerkzugang enthalten. Die geprüfte Region und hinterlegte Konfiguration dürfen angezeigt werden. Eine erfolgreiche persönliche Anmeldung oder ein bestandener UUID-Verbindungstest dürfen daraus nicht abgeleitet werden. Die Netzwerkbeschränkung darf nicht über andere Proxys oder Werkzeuge umgangen werden.

## Offizielle Schnittstellen geprüft

Offizielle Referenzen, am 22.10.2026 geöffnet:

| Quelle | Für den Code relevante Aussage |
| --- | --- |
| https://supabase.com/docs/reference/javascript/auth-mfa-enroll | `enroll({ factorType: 'totp', friendlyName })` erstellt einen zunächst ungeprüften Faktor. Die Antwort enthält `id` sowie `totp.qr_code`, `totp.secret` und `totp.uri`. Ein QR-Code allein aktiviert MFA nicht. |
| https://supabase.com/docs/reference/javascript/auth-mfa-challengeandverify | `challengeAndVerify({ factorId, code })` erstellt eine Challenge und überprüft den eingegebenen Authenticator-Code. |
| https://supabase.com/docs/reference/javascript/auth-mfa-getauthenticatorassurancelevel | AAL1 ist ein erster Faktor, AAL2 enthält MFA. Der Aufruf mit JWT validiert den Benutzer über eine Netzwerkanfrage; bloßes Auslesen eines Token-Claims reicht für eine Vertrauensentscheidung nicht. |
| https://supabase.com/docs/guides/auth/auth-mfa/totp | Die dokumentierte Reihenfolge ist Anmeldung, Faktoren lesen, vorhandenen Faktor bestätigen oder einen neuen einrichten, anschließend AAL2 erzwingen. QR-SVG soll als Bild, nicht als aktives HTML eingefügt werden. |
| https://supabase.com/docs/guides/auth/server-side/advanced-guide | Tokens sollen im serverseitigen Modell nicht in Browser-LocalStorage liegen. Cache-Antworten mit Sitzungen sind gefährlich. `getUser()` prüft den serverseitigen Benutzerzustand; ein allgemeiner Nachweis einer noch aktiven `auth.sessions`-Zeile folgt daraus nicht. `signOut()` ohne Scope kann alle Sitzungen abmelden. |

`npm view` lieferte für `@supabase/supabase-js` und `@supabase/auth-js` jeweils Version `2.118.0`. Diese Version ist die geprüfte Implementierungsbasis; der Lockfile muss die tatsächlich installierte Version festhalten. Die aktuelle Referenz nennt inzwischen auch Passkeys und MFA-Recovery-Codes. Daraus folgt keine Umsetzung in TaxiDTA: bisher nicht integrierte Funktionen werden als „nicht implementiert“ bezeichnet, nicht als generell vom Anbieter unmöglich dargestellt.

## Verbindliche Trennung im aktuellen Produkt

Bei `TAXIDTA_AUTH_REQUIRED=true` schützt ein gemeinsamer Backend-Prüfpfad sämtliche fachlichen Endpunkte einschließlich Stammdaten, Rechnungs-PDFs, Zahlungen und Export. Er verlangt die frisch bestätigte Inhaber-ID und AAL2 sowie eine passende aktive Datenbanksitzung. Nach der externen Datenbankprüfung wird auch die lokale Sitzungsfrist erneut geprüft. Die Oberfläche öffnet den Arbeitsplatz erst nach diesem Backend-Nachweis; die ausgeblendete Navigation ist keine eigene Berechtigungsquelle.

Die lokale synthetische Demo darf weiterhin ausdrücklich als Demo erreichbar sein. Ein fehlendes Supabase-Passwort, eine fehlgeschlagene MFA-Prüfung oder ein ausgelaufener Login dürfen in einem geschützten Modus niemals unbemerkt zum Demo-Zugriff auf dieselben Daten zurückfallen. Produktivmodus, echte Patientendaten und echte DTA-Transporte bleiben gesperrt.

## Eigentümer und Anmeldung

1. Die App bietet keine `signUp`-Funktion und keinen clientseitigen Administrator-Schlüssel. Das Inhaberkonto wurde bewusst administrativ angelegt und gebunden. Die projektweite Supabase-Einstellung für neue Registrierungen wurde bisher weder bestätigt noch abgeschaltet; ihre Kontrolle bleibt offen. Weitere Projektbenutzer erhalten dadurch keine TaxiDTA-Inhaberberechtigung.
2. Ein Supabase-Dashboard-Login ist nicht automatisch ein Datensatz in `auth.users`. Für TaxiDTA wird eine eigene App-Benutzer-ID benötigt.
3. Der Server bindet das Konto an eine explizit konfigurierte Owner-UUID. Fehlt die Bindung, wird kein beliebiger Projektbenutzer zum Inhaber. Eine eventuell unterstützte E-Mail-Bindung muss eine bestätigte, serverseitig gelesene Adresse vergleichen; sie darf nicht allein aus Formulareingaben stammen.
4. Beim Passwortlogin wird ein eigener SDK-Client pro Login/Sitzung verwendet. Ein globaler Client mit veränderlicher Auth-Sitzung könnte Daten oder Tokens verschiedener Browser vermischen.
5. SDK-Konfiguration für den serverseitigen Tokenbesitz: `persistSession: false`, `autoRefreshToken: false`, `detectSessionInUrl: false`. Zugangsdaten erscheinen weder in Logs noch in SQLite-Auditdetails oder Browser-Speichern.
6. Fehlermeldungen geben keinen Hinweis, ob eine fremde E-Mail im Projekt existiert. Passwort und TOTP werden zeitlich begrenzt und mit Rate-Limits geprüft. Sechs fehlgeschlagene TOTP-Versuche sperren weitere Prüfungen für zehn Minuten auch über neue Browser-Sitzungen hinweg; die Grenze gilt für den einzigen Inhaber. Erfolgreiche MFA setzt diese Zählung zurück.

## TOTP und Step-up

- Microsoft Authenticator kann den standardisierten TOTP-QR-Code einlesen. Ein Microsoft-Cloudkonto ist dafür keine Anforderung von TaxiDTA.
- AAL1 erlaubt nur Anmeldung, Faktorübersicht und den jeweils zulässigen MFA-Einrichtungs-/Prüfschritt. Fachliche Cloud-Datenaktionen verlangen die serverseitig verifizierte Owner-ID und AAL2.
- Hat das Konto bereits einen verifizierten Faktor, darf AAL1 keinen neuen Faktor zur Umgehung einrichten. Zunächst muss ein vorhandener Faktor bestätigt werden. Ein weiterer Faktor ist erst mit AAL2 zulässig, sofern überhaupt implementiert.
- Eine aus dem Browser übergebene Faktor-ID muss zu den aktuell serverseitig gelesenen Faktoren des Benutzers oder zum in dieser Sitzung angelegten, noch ungeprüften Faktor gehören. UUID-Syntax ist kein Berechtigungsnachweis.
- QR-Code, manueller Seed und URI sind Enrollment-Geheimnisse. Sie werden ausschließlich im aktuellen Einrichtungsdialog ohne Caching angezeigt. Keine Speicherung in Telemetrie, Audittext, LocalStorage oder Quellcode. Die QR-Antwort wird als `img`-Data-URL angezeigt; kein `dangerouslySetInnerHTML`.
- Ohne erfolgreiche Verifikation zeigt die Oberfläche niemals „MFA eingerichtet“. Ein Fehler oder eine abgebrochene Einrichtung erzeugt keinen AAL2-Ersatzstatus.
- Recovery und Faktorentfernung benötigen ein geprüftes gesondertes Verfahren. Solange dieses nicht implementiert ist, gibt es keine selbst erklärte MFA-Reset-Schaltfläche, die nur das Passwort verlangt.

## Sitzungen und Browsergrenze

Der Browser hält lediglich eine zufällige, undurchsichtige Sitzungskennung in einem `HttpOnly`-/`SameSite=Strict`-Cookie ohne Domain-Attribut. Tokens und Refresh-Token bleiben im Serverprozess. Für lokalen HTTP-Loopback ist ein ausdrücklich lokales Cookie nötig; das ist keine Zusage einer sicheren öffentlichen HTTPS-Bereitstellung. Produktiv-HTTPS würde `Secure` und geeignete Host-Präfixe erfordern.

- Sitzungskennung und zugehöriger CSRF-Token werden nach Passwortlogin und erfolgreichem MFA-Step-up rotiert. Alte Kennungen dürfen keine neue Identität übernehmen.
- Absolute Lebensdauer und Inaktivitätsfrist werden serverseitig gemessen. Ein länger haltbares Browser-Cookie verlängert keine serverseitige Berechtigung.
- Aufwändige Aufrufe und In-Memory-Sitzungen sind begrenzt; abgelaufene Einträge werden entfernt. Ein Neustart beendet diese nicht persistenten Sitzungen.
- Refresh und MFA-Operationen derselben Sitzung laufen serialisiert. So werden rotierende Refresh-Tokens nicht durch parallele Anfragen gegeneinander verbraucht und ein verspäteter AAL1-Zustand überschreibt keinen AAL2-Token.
- Vor sensiblen Backendaktionen werden Benutzer, Owner-Bindung, Ablauf und AAL2 erneut geprüft. Ein frei dekodierter JWT-Body, `getSession()` allein oder ein vom Browser gesendetes `aal2`-Feld reicht nicht. Auch `getUser()` beweist nicht in jeder Konfiguration die aktive Sitzung: Für geschützte Datenaktionen prüft die Datenbank zusätzlich die zum signierten JWT passende `auth.sessions`-Zeile mit `session_id`, Benutzer-ID und Ablauf. Ohne diesen Nachweis darf keine universelle sofortige Fernsperre behauptet werden.
- Fehler beim Refresh oder bei der Identitätsprüfung verweigern die geschützte Aktion. Es gibt keinen unsicheren Wiederholungsweg mit anonymem Publishable-Key-Zugriff.
- Logout entfernt die lokale Sitzung unabhängig von der Erreichbarkeit des Anbieters. Ein optionaler Supabase-Logout nutzt ausdrücklich `scope: 'local'`, sofern nicht bewusst „alle Geräte“ gewählt wird. Fehlende Bestätigung einer entfernten Sperre wird nicht als bestätigter globaler Logout ausgegeben.
- Antworten mit Sitzungs- oder MFA-Daten erhalten `Cache-Control: no-store`; ein späteres CDN darf diese Antworten und `Set-Cookie` nicht cachen.

## RPC-/RLS-Verbindung

Der Publishable Key erhält keine direkten Schreibrechte auf Finanz- oder Gesundheitsdaten. Der implementierte erste Cloudadapter ist ein eng begrenzter synthetischer Schreib-/Lese-/Löschtest ohne Kundennamen, Beträge, Belege oder IK. Die beiden tatsächlich angewendeten Einrichtungsmigrationen prüfen die Owner-UUID, den signierten AAL2-Claim, Benutzerstatus und aktive Sitzung. Tatsächliche Rollen-/Claims-Negativtests verweigerten anon, AAL1 und AAL2 ohne vorhandene Sitzung; die Prüftabelle blieb leer. Ein Node-Backend mit verifiziertem Benutzer allein ersetzt keine RLS-Policies.

`taxidta.owner_account` darf kein Benutzer selbst setzen. `auth.uid()` muss zum administrativ gesetzten Owner passen. Nicht authentisierte Zugriffe, AAL1 und fremde authentisierte Benutzer bleiben gesperrt. Ein Mocktest von HTTP-Fehlern oder ein Textvergleich des SQL beweist noch keine ausgeführte RLS-Isolation im echten Projekt.

## Noch erforderliche Integrationsnachweise

- Erfolgreiche Verbindung zum tatsächlichen Projekt unter dem vorgesehenen Netzwerkpfad.
- Die bereits bestätigte Projektregion um geprüfte Storage-/Log-/Backup-/Support-Datenflüsse ergänzen.
- Projektweite Registrierung tatsächlich kontrollieren; Inhaberkonto und Bindung sind bereits vorhanden.
- Passwortlogin, QR-Enrollment, falscher Code, richtiger Code und erneuter Login mit vorhandenem Faktor am echten Projekt.
- Die tatsächlich ausgeführten SQL-Negativtests um persönliche authentisierte Negativ-/Positivfälle und spätere Datei-/Finanzisolation ergänzen.
- Logout, Zeitablauf, Tokenrotation, Serverneustart und Wiederherstellung ohne MFA-Bypass.
- Passkeys, Recovery-Codes, produktives Health-Data-Hosting und Freigabe bleiben gesonderte Arbeitspakete.

## Tatsächlich geprüfter Codeumfang

`tests/auth-security.test.ts`: 21 Tests bestanden, strikte TypeScript-Prüfung bestanden. Getestet sind Owner-/E-Mail-Bindung, Passwort-/MFA-Sitzungs- und CSRF-Rotation, keine Token/Seeds in der Statusantwort, Sperre der Neueinrichtung bei vorhandenem Faktor, Faktorbesitz, lokale Abmeldung bei entferntem Fehler, TTL-/Kapazitätsgrenzen, verteilte TOTP-Fehlversuche über mehrere Sitzungen und Berechtigungsverlust nach einem modellierten Providerfehler.

Drei dieser Verhaltensbereiche verwenden den tatsächlich installierten Supabase-SDK-Adapter mit simulierten REST-Antworten: explizite entfernte Benutzer-/AAL-Aufrufe, einmalige serialisierte Token-Erneuerung, Challenge/Verify und lokaler Logout-Scope sowie verweigerter Zugriff bei Refreshfehlern. Die Tests entdeckten und behoben einen doppelten Refresh beim bereits bald ablaufenden SDK-Speicher: Der Erneuerungsschritt benutzt eine neue leere SDK-Instanz, bevor der bestätigte neue Token übernommen wird. Provider-Netzwerk-/Gatewayfehler bleiben `503 AUTH_NETWORK_UNAVAILABLE`, statt sie als falsches Passwort auszugeben. Der Daten-RPC erhält exakt den zuvor entfernt geprüften Token; ein späteres `accessToken()` rotiert ihn nicht unbemerkt nach der AAL-Prüfung. Ein bisher nicht geprüfter oder abgelaufener Token wird dort abgewiesen.

Fünf zusätzliche Regressionen prüfen den Ablauf während langsamer Providerantworten: Passwort-/Identitätsprüfung, Enrollment, MFA, Tokenabruf und externe Await-Grenzen. Abgelaufene oder entfernte Sitzungen dürfen keine Seeds liefern, keine Berechtigung weitergeben und durch Rotation nicht wieder aktiviert werden. `assertSessionActive()` verlängert die Inaktivitätsfrist nicht. Ein zusätzlicher API-Integrationstest deckt Ablauf während der SQL-Prüfung ab.

Diese Tests sind keine echte Anmeldung am Benutzerprojekt, keine Garantie einer Signaturprüfung durch ein HTTP-Mock und keine vollständige produktive Wiederherstellung. Der Root-Integrationsbericht protokolliert gesondert tatsächlich ausgeführte Cloud-/SQL-/Browserprüfungen. Schema, Region und Inhaberbindung sind im Benutzerprojekt nachgewiesen; persönliche Anmeldung, TOTP und positiver UUID-Roundtrip bleiben ausdrücklich ungetestet.
