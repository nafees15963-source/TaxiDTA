# TaxiDTA auf dem Mac ausprobieren

Diese Anleitung führt zur **lokalen Testanwendung mit erfundenen Fachdaten**. Ein konfiguriertes Inhaberkonto kann sich mit Passwort und Microsoft-Authenticator-TOTP anmelden. Supabase wird bisher für Anmeldung, Inhaberbindung und einen begrenzten Verbindungstest genutzt. Fahrten, Rechnungen und PDFs bleiben lokal. Passkeys, Wiederherstellung und echter DTA-Versand fehlen. Verwenden Sie keine echten Patienten-, Bank-, Versicherungs- oder Zertifikatsdaten. Die ausgegebenen Rechnungen sind Testdokumente.

Stand: 22.10.2026. Die Befehle beziehen sich auf dieses Projekt. Ausgewählte amtliche Quellen, die Supabase-Region und die DPA wurden über den verfügbaren Recherchezugang geprüft; Befunde stehen in `docs/RESEARCH_LOG.md`. Installationsseiten, aktuelle Klickbeschriftungen, Angebote und Preise sind damit nicht vollständig live geprüft und können sich ändern.

## 1. Was die einzelnen Dinge bedeuten

| Begriff | Einfach erklärt | Für die lokale Demo nötig? |
| --- | --- | --- |
| TaxiDTA | Das Programm, das Sie im Browser bedienen | Ja |
| Codex | Hilfe beim Programmieren und Prüfen des Quellcodes | Zum Ausprobieren nicht zwingend |
| Node.js | Führt das Programm auf dem Mac aus | Ja, Version 24 oder neuer |
| Terminal | Fenster, in das Sie die Startbefehle eingeben | Ja |
| Datenbank | Speichert Kunden, Fahrten und Rechnungen | Ist lokal als SQLite enthalten |
| Git | Hält Änderungen am Quellcode fest | Für Entwicklung empfohlen; kein Pflichtkonto für die Demo |
| Hosting | Führt das Programm dauerhaft auf einem Server aus | Später |
| Supabase | Dienst für Inhaber-Anmeldung und begrenzten Verbindungstest; Finanzdaten bleiben lokal | Für die konfigurierte Inhaber-Anmeldung; für die unkonfigurierte Demo nicht nötig |
| DTA-Zertifikat | Technische Identität/Schlüsselmaterial für das festgelegte Verfahren | Erst für autorisierte DTA-Tests |
| DTA-Teilnahme | Nachgewiesene Berechtigung und Freischaltung bei den zuständigen Stellen | Erst für autorisierte DTA-Tests |

Ein Browserfenster bedeutet nicht, dass Daten in einer Cloud gespeichert werden. In der lokalen Demo liegen die Daten auf dem Rechner, auf dem der Server gestartet wurde.

## 2. Node.js installieren

**Wozu?** Node.js startet den lokalen Server. **Kosten:** Node.js ist kostenlos; benötigt werden Ihr Mac und etwas Speicherplatz.

1. Öffnen Sie im Browser die offizielle Seite [nodejs.org/download](https://nodejs.org/en/download).
2. Wählen Sie die macOS-Installation von Node.js **24 LTS oder einer neueren unterstützten Version**. Dieses Projekt benötigt mindestens Version 24.
3. Wenn nach dem Prozessor gefragt wird: Unter Apple-Menü → „Über diesen Mac“ steht entweder ein Apple-Chip oder ein Intel-Prozessor. Apple-Chip entspricht gewöhnlich `arm64`, Intel entspricht `x64`. Ein passender offizieller Universal-Installer kann diese Wahl übernehmen.
4. Öffnen Sie die heruntergeladene offizielle Installationsdatei und folgen Sie deren Schritten.
5. Öffnen Sie „Terminal“ über Spotlight (`⌘` + Leertaste, dann „Terminal“).
6. Geben Sie nacheinander ein:

```bash
node --version
npm --version
```

**Erfolg:** Die erste Zeile beginnt mit `v24.` oder einer höheren Hauptversion; die zweite zeigt eine Versionsnummer. **Bei „command not found“:** Terminal schließen und neu öffnen; anschließend Installation und gewählte Mac-Version prüfen. Keine Befehle aus zufälligen Downloadseiten ausführen.

Für diese Demo brauchen Sie weder Docker noch ein Microsoft-Azure-Abo. Microsoft Authenticator verwendet standardisiertes TOTP; ein Microsoft-Mandant ist dafür nicht notwendig.

## 3. Den Projektordner öffnen

**Wozu?** Die Befehle müssen im Ordner mit `package.json` ausgeführt werden. **Kosten:** keine zusätzlichen.

1. Entpacken Sie das bereitgestellte TaxiDTA-Projekt in einen eigenen Ordner, beispielsweise `Dokumente/TaxiDTA`.
2. Öffnen Sie den Ordner im Finder. Die Datei `package.json` und diese Anleitung müssen darin sichtbar sein.
3. Tippen Sie im Terminal `cd ` mit einem Leerzeichen am Ende.
4. Ziehen Sie den TaxiDTA-Ordner aus dem Finder in das Terminal. Dadurch wird der tatsächliche Pfad eingefügt. Drücken Sie die Eingabetaste.
5. Prüfen Sie den Inhalt:

```bash
ls
```

**Erfolg:** Die Ausgabe enthält `package.json`, `src`, `server` und `START_HIER.md`. **Bei „No such file or directory“:** Den tatsächlichen entpackten Ordner erneut hineinziehen. Nicht einen im Chat genannten Cloud-Pfad auf dem eigenen Mac voraussetzen.

Falls Sie entwickeln möchten, genügt **eine** Arbeitsumgebung: die bereits verfügbare Codex-App oder VS Code mit offizieller Codex-Integration. VS Code gibt es unter [code.visualstudio.com](https://code.visualstudio.com/); Codex-Informationen unter [openai.com/codex](https://openai.com/codex/). Kontomodelle und Kosten dort prüfen. Ein zusätzliches GitHub-Konto ist für den lokalen Start nicht erforderlich.

Git lässt sich auf dem Mac mit `git --version` prüfen; macOS kann dabei die Installation der zugehörigen Command Line Tools anbieten. Private Originalunterlagen dürfen nicht in einen geteilten oder mit Git versionierten Projektordner kopiert werden. Bei späteren privaten Importen einen geschützten Ordner außerhalb des Repositorys verwenden und dessen Verschlüsselung/Zugriffsrechte prüfen.

## 4. Abhängigkeiten installieren und Demo starten

**Wozu?** Die Abhängigkeiten sind die Bausteine der Anwendung. **Kosten:** keine Lizenzgebühr für diesen lokalen Start; für den Download ist Internet nötig.

Geben Sie im Projektordner ein:

```bash
npm ci
npm run dev
```

`npm ci` verwendet die mitgelieferte `package-lock.json`. Es kann beim ersten Mal einige Minuten dauern. `npm run dev` läuft weiter und zeigt die lokale Adresse an.

Öffnen Sie im Browser:

```text
http://127.0.0.1:3000
```

**Erfolg:** Ohne konfigurierte Anmeldepflicht zeigt TaxiDTA die lokale Testumgebung und erfundene Beispieldaten. Bei aktivierter Anmeldepflicht erscheint zuerst der Inhaber-Login; weiter mit Abschnitt 10. **Beenden:** Im Terminal `Ctrl+C` drücken. Nach einem Neustart mit `npm run dev` bleiben gespeicherte lokale Demovorgänge erhalten.

**Häufige Fehler:**

- `ENOENT ... package.json`: Sie stehen im falschen Ordner. Schritt 3 wiederholen.
- `EADDRINUSE`: Port 3000 ist schon belegt. Einen bereits gestarteten TaxiDTA-Prozess in dessen Terminal mit `Ctrl+C` beenden. Keine fremden Prozesse ungeprüft löschen.
- Fehler wegen Node-Version: `node --version` prüfen und mindestens Node.js 24 installieren.
- Fehler beim Paketdownload: Internetverbindung und die konkrete Fehlermeldung prüfen; keine TLS-/Zertifikatsprüfung deaktivieren.
- Browser bleibt leer: Terminal auf Fehler prüfen, Adresse einschließlich Port kontrollieren und Seite neu laden.

Den Server nicht auf `0.0.0.0` stellen, nicht über Portweiterleitung teilen und nicht in ein öffentliches Hosting kopieren. Auch mit Inhaber-Anmeldung bleibt dies eine lokale Testversion ohne Produktionsfreigabe.

## 5. Eine normale Rechnung ausprobieren

**Wozu?** Dieser Ablauf braucht keine Krankenversicherung und keinen Patientenbeleg. **Kosten:** keine zusätzlichen.

1. Einen neuen **fiktiven** Privat- oder Geschäftskunden mit erfundenem Namen und erfundener Anschrift anlegen.
2. Eine Fahrt für diesen Kunden erfassen. Als Leistungsdatum ein Testdatum im Jahr 2026 verwenden, beispielsweise `22.10.2026`.
3. Für eine Taxifahrt die Fahrzeugart, besetzte Kilometer und gegebenenfalls die Gemeindefrage korrekt im Testszenario angeben. Für Kurier/Labor die passende Leistungsart wählen; keine Patientennamen oder Probeninformationen eintragen.
4. Den vereinbarten Test-Bruttopreis eingeben und den erklärten Steuersatz prüfen.
5. Die unberechnete Fahrt zur Rechnung auswählen. Für eine Sammelrechnung mehrere unberechnete Fahrten desselben Kunden auswählen.
6. Die Rechnung mit dem tatsächlich gewählten Test-Rechnungsdatum ausstellen. Rechnung vom `22.10.2026` hat bei 28 Kalendertagen Zahlungsziel die Fälligkeit `19.11.2026`.
7. Das archivierte PDF abrufen. Prüfen Sie Nummer, Leistungsdatum, Steueraufteilung, Summe und Fälligkeit. Das PDF trägt die Demo-Kennzeichnung und enthält keine bestätigten produktiven Bankdaten.
8. Einen Test-Zahlungseingang manuell erfassen. Der Betrag darf die offene Forderung nicht überschreiten. Eine technische Wiederholung desselben Speichervorgangs erzeugt durch die Befehlskennung keine zweite Zahlung.

**Erfolg:** Der neue Vorgang bleibt nach Neuladen erhalten. Die Fahrt steht nicht erneut zur Abrechnung bereit. Der PDF-Nachabruf liefert das ursprüngliche Dokument. Bei einer nötigen Korrektur den vorgesehenen Stornovorgang nutzen; eine ausgestellte Rechnung wird nicht still überschrieben.

Das PDF ist keine validierte XRechnung/ZUGFeRD-Datei. Für eine echte B2B-Fakturierung müssen Rechtslage, Übergangsfristen und ein passender strukturierter Rechnungsexport mit Validator ergänzt werden.

## 6. Tariflabor und Krankenfahrt testen

**Wozu?** Der Rechenweg wird anhand der gelieferten Tarifunterlagen nachvollziehbar geprüft. **Kosten:** keine zusätzlichen.

1. Das Tariflabor öffnen und das Datum `22.10.2026`, **eine Person** und `20 km` einstellen.
2. Artikel I wählen und die Vertragsvoraussetzung ausschließlich für das erfundene Testszenario bestätigen.
3. Erwartet werden **14,00 € Grundpreis für die ersten 3 km + 17 × 2,27 € = 52,59 €**. Die Positionen heißen `510100` und `513000`.
4. Auf Artikel II wechseln. Erwartet werden **14,00 € + 17 × 2,22 € = 51,74 €** mit `510131` und `513131`.
5. Die Bestätigung entfernen oder eine nicht unterstützte Konstellation wählen. Die Berechnung muss die fehlende Voraussetzung benennen und darf keine plausible Fantasiesumme liefern.

Bei Kassenrechnungen zeigt ein Datum nach 28 Tagen nur eine **Demo-Wiedervorlage**. Die echte vertragliche Kassenfrist wurde noch nicht geprüft (`dueAtVerified=false`). Dieses Datum darf nicht als bestätigte Fälligkeit oder Grundlage einer Mahnung verwendet werden.

Eine noch offene Testfahrt können Sie in der Fahrtenliste bearbeiten. Damit lässt sich etwa eine zunächst fehlende Verordnungsbestätigung im erfundenen Fall ergänzen; der Tarifbetrag wird erneut serverseitig berechnet. Die Fahrt behält ihre Identität und die geänderten Felder werden protokolliert. Bereits abgerechnete Fahrten bleiben auch nach einem Storno gesperrt.

Die Demo unterstützt keinen vollständigen Muster-4-Workflow und keine bewiesene echte Vertragszuordnung. Ein gesetztes Test-Häkchen ist kein rechtlicher Nachweis. Mehrpersonen-/Sonderfälle und nicht verifizierte Rundungsregeln bleiben gesperrt.

Zusätzlich können Sie in der DTA-Zentrale im Bereich „Kostenträgerformat prüfen“ auf **„Synthetisches Muster laden“** und danach **„Struktur prüfen“** klicken. Der begrenzte Leser zeigt die im Text getrennt angegebenen Institutionen und VKG-Rollen. Er speichert oder aktiviert diese Angaben nicht. „Strukturell lesbar“ beweist keine echte Zuständigkeit, aktuelle Gültigkeit oder Empfängerberechtigung. Nicht unterstützte Segmente werden mit einem Fehler abgewiesen. Die genauen Grenzen stehen in `docs/KE_PARSER_PROFILE.md`; die Beispieldatei ist kein amtliches Original.

In der DTA-Zentrale kann ein **Bereitschaftsbericht** angelegt werden. Er führt fehlende Nachweise auf. Es entstehen keine verschickbare §302-Datei und keine echte Empfangsquittung. „Gespeichert“ bedeutet hier ausschließlich im lokalen Demo-Backend gespeichert.

## 7. Prüfungen ausführen

**Wozu?** Fehler in Regeln, Datenflüssen und Build werden sichtbar. **Kosten:** keine zusätzlichen Dienstkonten.

Stoppen Sie bei Bedarf den Server mit `Ctrl+C`, und führen Sie aus:

```bash
npm test
npm run lint
npm run build
npm run security:check
```

**Erfolg:** Die Befehle enden ohne Fehler. Die tatsächlichen Ergebnisse dieser Entwicklungsrunde stehen in `docs/ACCEPTANCE.md`. Nicht jede offene Anforderung ist durch einen grünen Teiltest erledigt.

Für Oberflächentests:

```bash
npm run test:e2e
```

Die Konfiguration verwendet einen vorhandenen Linux-Chromium unter `/usr/bin/chromium` oder den von Playwright verwalteten Chromium. Auf dem Mac wird gewöhnlich der Playwright-Browser verwendet. Falls dieser noch fehlt, bei Bedarf einmal ausführen:

```bash
npx playwright install chromium
```

Die Installation ist für die normalen Rechen-/Backend-Tests nicht nötig. Einen ausdrücklich gewählten vorhandenen Browserpfad kann `CHROMIUM_PATH` setzen. Die [offizielle Playwright-Installationsanleitung](https://playwright.dev/docs/browsers) beschreibt weitere Browseroptionen. In einer verwalteten Umgebung zuerst deren Browser-/Netzwerkvorgaben beachten.

`npm run db:migrate` ist für die lokale Datenbankvorbereitung vorgesehen. Es richtet keine Supabase-Cloud und keinen produktiven Mandanten ein.

## 8. Demo-Daten verschlüsselt sichern

**Wozu?** Eine Sicherung hilft nur, wenn sie tatsächlich wieder lesbar ist. **Kosten:** etwas eigener Speicherplatz.

```bash
npm run backup -- work/backups/mein-backup.tdbak
npm run restore:test -- work/backups/mein-backup.tdbak
```

Der erste Befehl sichert `work/taxidta.sqlite` in die angegebene Datei. Der zweite prüft genau diese Sicherung. Eine bereits vorhandene Sicherungsdatei wird nicht überschrieben; beim nächsten Mal einen neuen Namen wählen. Ohne Zielargument legt `backup` eine Datei mit Zeitstempel unter `work/backups/` an.

Die Skripte verlangen ein starkes, eigenes Sicherungspasswort mit mindestens zwölf Zeichen und blenden die Eingabe aus. Dieses Passwort getrennt von der Sicherungsdatei aufbewahren, beispielsweise in einem geeigneten Passwortmanager. Nicht in den Chat, in Git oder als sichtbaren Kommandozeilenparameter schreiben. Das Passwort ist kein Ersatz für ein Benutzerkonto.

Der Wiederherstellungstest verwendet eine getrennte Kopie und prüft deren SQLite-Integrität; er überschreibt nicht die laufende Datenbank. Ein falsches Passwort oder eine veränderte Sicherung muss einen Fehler erzeugen. Ein bestandener lokaler Test belegt noch keine vollständige produktive Notfallwiederherstellung mit Cloud-Dateien, Schlüsseln und Betriebsabläufen.

## 9. Supabase-Verbindung und privates Setup

Im eingerichteten Projekt wurden die tatsächliche Region **AWS `eu-central-1`, Frankfurt**, das bestätigte App-Konto und seine Inhaberbindung über den Verwaltungszugang geprüft. Die zwei Einrichtungsmigrationen sind angewendet. Sie speichern ausschließlich die Inhaberbindung und kurzlebige UUID-Prüfeinträge. Kunden, Fahrten, Rechnungen und PDFs bleiben in der lokalen SQLite-Datenbank.

Der persönliche Passwort-/TOTP-Login und ein erfolgreicher UUID-Schreib-/Lese-/Löschtest stehen noch aus. Die verwaltete Entwicklungsumgebung blockiert zurzeit direkte HTTPS-Anfragen an die Supabase-Projektadresse; der Verwaltungszugriff über das Plugin funktioniert. Eine solche Sperre muss im vorgesehenen Netzwerkzugang für genau den eigenen Projekthost behoben werden. Proxy- oder Zertifikatsprüfungen nicht umgehen.

Der Server lädt eine vorhandene `.env.local` im Projektordner automatisch. Diese Datei ist von Git ausgeschlossen und enthält ausschließlich die privaten lokalen Einstellungen. Beim Übertragen auf einen eigenen Rechner die Konfiguration geschützt übernehmen, nicht öffentlich teilen. Für ein anderes Projekt werden folgende Einstellungen gebraucht:

| Einstellung | Bedeutung |
| --- | --- |
| `SUPABASE_URL` | Eigene unveränderte HTTPS-Projektadresse |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable Key; kein Secret-/Service-Role-Key |
| `SUPABASE_OWNER_ID` | Bestätigte UUID des bewusst angelegten App-Benutzers |
| `TAXIDTA_AUTH_REQUIRED=true` | Inhaber-Anmeldung mit MFA für die fachlichen APIs erzwingen |
| `SUPABASE_CONFIRMED_REGION`, `SUPABASE_REGION_VERIFIED_AT` | Nur nach tatsächlicher Projektprüfung dokumentierte Region und Datum; eine gesetzte Zeile ist kein externer Nachweis |

Die Inhaberbindung muss zusätzlich im geprüften Cloudschema administrativ gesetzt sein. Die App kann keine eigene Inhaberberechtigung erzeugen. Der Supabase-Dashboard-Login und das App-Konto unter Authentication → Users sind getrennt. Für das bereits eingerichtete Konto ist keine erneute Anlage nötig.

Ein Netzwerkcheck ohne Passwort ist möglich:

```bash
npm run supabase:check
```

**Erfolg:** Der Befehl bestätigt die Erreichbarkeit des Auth-Endpunkts. Das beweist weder eine Anmeldung noch den positiven Datenbanktest. Bei einem Netzwerkfehler den erlaubten HTTPS-Zugriff auf `<Projektkennung>.supabase.co` prüfen. Bei aktivierter Anmeldepflicht bleibt der fachliche Zugriff während eines Ausfalls geschlossen.

Die App besitzt keine Registrierung. Die projektweite Supabase-Einstellung „Allow new users to sign up“ ist noch nicht geprüft oder geändert; sie muss für das geschlossene Inhabermodell gesondert kontrolliert werden. Der Sicherheitsadvisor meldet außerdem noch [deaktivierten Schutz gegen bekannte geleakte Passwörter](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Verfügbarkeit und Tarifbedingungen im eigenen Projekt prüfen; die Anwendung ändert keinen Tarif.

Eine Region allein erteilt keine Datenschutzfreigabe. Vor echten Daten müssen DPA/AVV, Unterauftragsverarbeiter, Logs, Backups, Support-/Drittlandzugriffe, private Dateien und der Standort der späteren App-/Job-Laufzeit geprüft werden. Supabase hostet nicht automatisch diesen Express-Server. Die Finanzskizze in `docs/drafts/` ist keine freigegebene Cloudmigration.

## 10. Inhaber anmelden und Authenticator einrichten

Passwort, QR-Code, manueller Einrichtungsschlüssel und aktuelle Codes bleiben bei Ihnen. Diese Angaben ausschließlich in der lokalen TaxiDTA-Oberfläche verwenden und niemals in den Chat oder Git kopieren.

1. TaxiDTA unter `http://127.0.0.1:3000` öffnen. Bei aktivierter Anmeldepflicht erscheint der Login. Im offenen Demo-Modus steht die Einrichtung unter Einstellungen.
2. Mit der E-Mail-Adresse und dem eigenen Passwort des bestätigten **App-Benutzers** anmelden. Das ist nicht automatisch das Supabase-Dashboard-Konto.
3. Wenn noch kein verifizierter Faktor existiert, **„Authenticator einrichten“** wählen. TaxiDTA zeigt den QR-Code und bei Bedarf einen manuellen Einrichtungsschlüssel.
4. In Microsoft Authenticator ein Konto hinzufügen, den Typ **„Anderes Konto“** bzw. das passende TOTP-Konto wählen und den QR-Code scannen. Dafür ist kein Azure-Abo nötig; Beschriftungen können je nach App-Version abweichen.
5. Den aktuellen sechsstelligen Code ausschließlich in TaxiDTA eingeben und **„Code bestätigen“** wählen. Erst eine erfolgreiche Prüfung aktiviert den Zugriff. QR und Einrichtungsschlüssel verschwinden anschließend aus dem Dialog.
6. Falls bereits ein Faktor eingerichtet ist, direkt dessen aktuellen Code bestätigen. Die App erlaubt keine neue AAL1-Einrichtung als Ersatz für einen vorhandenen Faktor.
7. **„Datenbankverbindung testen“** ausführen. Der Test schreibt eine zufällige UUID, liest genau diese erneut und entfernt sie. Eine Erfolgsmeldung bestätigt nur diese Operation und keine Finanzdatenmigration oder DTA-Freigabe. Bei aktivierter Anmeldepflicht lässt sich der Test nach Öffnen der App unter Einstellungen ausführen.
8. Abmelden und die erneute Anmeldung mit vorhandenem Authenticator testen. Nach einem Serverneustart, spätestens nach 30 Minuten oder nach zehn Minuten Inaktivität ist eine neue lokale Anmeldung nötig.

Die persönlichen Schritte sind noch nicht am echten Konto abgeschlossen. Automatisierte Browserprüfungen verwenden simulierte APIs; sie ersetzen diese Prüfung nicht. Bei Netzwerkfehlern zunächst Abschnitt 9 prüfen. Bei falschem Code Uhrzeit auf dem Telefon automatisch synchronisieren und einen aktuellen Code verwenden; wiederholte Fehlversuche werden begrenzt.

Passkeys, Recovery-Codes und eine Wiederherstellung nach Telefonverlust sind **nicht implementiert**. Die App zeigt dafür keine vermeintlich fertige Rücksetzung an. Einen vorhandenen Faktor nicht für Experimente löschen. Ein geprüftes Wiederherstellungsverfahren bleibt vor produktivem Einsatz erforderlich.

## 11. Was der spätere Betrieb kostet

Für die lokale Demo sind keine Supabase-, Hosting-, Bank- oder DTA-Konten nötig. Codex-Nutzung, Internet und vorhandene Hardware richten sich nach Ihren eigenen Verträgen.

Für einen produktiven Betrieb müssen aktuelle Angebote eingeholt werden. Die folgenden Angaben sind **grobe Planungsbudgets, keine verifizierten Anbieterpreise oder Zusagen**:

| Variante | Mögliche Kostenblöcke | Planung und Betrieb |
| --- | --- | --- |
| Gemanagte Datenbank/Auth/Storage plus DE/EU-Appserver | Supabase-Tarif, App-/Job-Server, Backup, Monitoring, Domain und ggf. Mail | Für einen kleinen verlässlichen Betrieb eher mehrere zehn bis über hundert Euro im Monat einplanen; Gesundheitsdaten-Eignung zusätzlich nachweisen |
| Selbst verwalteter DE/EU-Server | Server, eigene Datenbank, Dateispeicher, externe Sicherung, Überwachung, Domain/Mail | Infrastruktur kann günstiger wirken; Patchen, Härtung, Rufbereitschaft und Wiederherstellung bleiben eigene laufende Arbeit |
| Produktives Verfahren insgesamt | Zertifikate/Teilnahme, fachliche Prüfung, Sicherheitsreview, Datenschutzberatung, Wartung | Individuelle einmalige und wiederkehrende Kosten; vorher konkret anbieten lassen |

Supabase ist die gewünschte Zielrichtung. Ein Anbieterwechsel wäre erst bei nachgewiesenem technischen oder datenschutzrechtlichen Hindernis zu bewerten. Ein niedriger Serverpreis belegt keine Eignung für Gesundheitsdaten.

## 12. Voraussetzungen für echten DTA-Versand

Die ausführliche Arbeitsliste steht in `docs/ECHTER_DTA_VERSAND_EINRICHTEN.md`. Zunächst werden ohne Patientendaten geklärt:

- Welches eigene IK und welche Teilnahme/Freischaltung gelten?
- Welche vollständige aktuelle Vertragsfassung und Leistungsgruppe berechtigen zur Abrechnung?
- Welche aktuellen amtlichen TA-/KE-Dateien gelten im konkreten Zeitraum?
- Welches sind Kostenträger-, Abrechnungs-, physische Transport-, Entschlüsselungs- und Papierempfänger-IK? Diese Rollen können verschieden sein.
- Welcher vom Empfänger bestätigte Übertragungsweg, welche Testadresse und welches Rückmeldeformat sind zulässig?
- Welche Zertifikate und sichere Schlüsselablage werden verlangt?
- Liegt eine autorisierte Testübertragung mit echter Originalantwort vor?
- Sind Datenschutz, Sicherheitsreview, Backup-/Restore und bewusste Live-Freigabe dokumentiert?

Keine alten Adressen aus Beispielrechnungen ungeprüft übernehmen. Private Schlüssel bleiben im geschützten Secret-Prozess. Ein altes DMRZ-Beispiel oder eine vom eigenen Programm erzeugte Quittung beweist keine heutige Teilnahme oder erfolgreiche Annahme.

## 13. Daten aus einer alten Lösung übernehmen

Noch kein automatischer DMRZ-Import vorhanden. Später nur einen rechtmäßig erhaltenen Export verwenden. Vor einem Import: geschützte Testumgebung, dokumentiertes Feldmapping, Dublettenprüfung, Summenvergleich, Stichproben, Rückrollplan und Datenschutzfreigabe. Zugangsdaten nicht weitergeben und keine fremde Oberfläche mit gespeicherten Passwörtern auslesen lassen.

## 14. Hilfe bei Fehlern

Notieren Sie den ausgeführten Befehl, die konkrete Fehlermeldung, Node-Version und den letzten erfolgreichen Schritt. Entfernen Sie Namen, Versicherungsnummern, Bankdaten, Zugangstoken und Schlüssel vor der Weitergabe. Eine Bildschirmaufnahme mit echten Patientendaten ist kein geeigneter allgemeiner Fehlerbericht.
