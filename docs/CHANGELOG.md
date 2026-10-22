# Änderungen

## 0.1.0 – 22.10.2026 – lokales Fundament

Erste Entwicklungsrunde aus dem leeren Projekt: deutschsprachige lokale Web-App mit synthetischen Daten, gemeinsamer Typdefinition, prüfbaren Tarif-/Steuerregeln und persistierter Fakturierung. Backend, Oberfläche, Original-PDF, Zahlungen, Stornovorgang, DTA-Bereitschaftsbericht und Sicherungen werden gemeinsam gegen den in `PRODUCT_SPEC.md` beschriebenen Demo-Umfang geprüft.

Zusätzlich wurden konkrete Fehlerfälle für Mehrfachabrechnung, falsche Steuerannahmen, Überzahlung, nachträgliche Originaländerung, Tabellenformeln und nicht wiederherstellbare Sicherungen berücksichtigt. Der genaue Umsetzungs- und Teststand steht in `ACCEPTANCE.md`; diese Beschreibung ist keine pauschale Fertigmeldung.

Offene Fahrten lassen sich jetzt tatsächlich bearbeiten, um etwa fehlende Nachweise im Testfall zu ergänzen. Identität und Erstellungszeit bleiben erhalten, Tarif und Dubletten werden erneut geprüft. Eine Änderung während der PDF-Erstellung verhindert den Abschluss mit veralteten Werten; bereits abgerechnete Fahrten sind auch nach Storno unveränderlich.

Bei der QA wurden ein Storno-/Zahlungsrennen und eine Dublettenlücke bei unterschiedlichen Kilometerschreibweisen gefunden und behoben. Zahlungsbefehle sind bei Wiederholung idempotent; zukünftige Buchungen werden abgewiesen. Kassenrechnungen kennzeichnen das 28-Tage-Datum ausdrücklich nur als ungeprüfte Demo-Wiedervorlage statt als bestätigte Vertragsfrist.

Außerdem implementiert: begrenzter Leser/Serializer für die amtliche V09-KOTR-Struktur mit Fehlerpositionen, kontrollierter Maskierung und synthetischen Roundtrip-/Negativtests. Das Browserlabor kann ein erfundenes Muster prüfen. Es aktiviert keine Daten und löst kein echtes IK-Routing. Eine manuelle Nachweischeckliste bleibt auch bei positiven Behauptungen technisch im Demo-Modus gesperrt.

Am Ende dieses ersten lokalen Schritts waren die Lücken sichtbar dokumentiert: noch keine Anmeldung/MFA, kein produktives Supabase, keine §302-Dateigenerierung/Übertragung, kein aktuelles amtliches IK-Verzeichnis, kein vollständiges Muster 4, keine validierte strukturierte E-Rechnung und keine Freigabe echter Gesundheitsdaten.

Private Originalunterlagen bleiben außerhalb des Repositorys. Die gelieferten historischen Listen und Beispielrechnungen erteilen keine heutige Routing- oder Vertragsfreigabe.

## Lokale Integration vor der Supabase-Erweiterung vom 22.10.2026

- 54 Fach-/Backend-/Sicherungs-/PDF-Tests und sieben Browserfälle bestanden; kein übersprungener Node-Test. TypeScript, Build und Quellprüfung bestanden; `npm audit` meldet zum Abrufzeitpunkt keine bekannten Schwachstellen.
- Datenbankpfad wird tatsächlich berücksichtigt; jeder Browserlauf nutzt eine neue eigene Datenbank. Die normale Demo ist mit dem ursprünglichen synthetischen Startdatensatz vorbereitet.
- Lange PDF-Empfängernamen und Adressen werden vollständig umbrochen. Leistungsbeschreibungen über 500 Zeichen oder 20 Zeilen werden ohne Kürzung zurückgewiesen.
- Seitenleiste bleibt auch auf niedrigen Bildschirmen bedienbar. Fokus und Feldbeschriftungen wurden anhand der Browserprüfungen korrigiert.
- Keine Freigabe für echte Gesundheitsdaten, produktive Authentisierung/Cloud oder §302-Produktivversand.

## Inhaber-Anmeldung und begrenzter Supabase-Test vom 22.10.2026

Die lokale App unterstützt nun den festgelegten Inhaber mit Passwort und Authenticator-TOTP. Eine private `.env.local` wird beim Serverstart geladen; `TAXIDTA_AUTH_REQUIRED=true` schützt sämtliche fachlichen APIs einschließlich Original-PDF und Export. Das Backend prüft Owner, bestätigten Benutzer, AAL2 und die aktive Datenbanksitzung. Es gibt keinen Rückfall auf den offenen Demo-Modus, wenn diese Prüfung scheitert.

Tokens verbleiben im Serverprozess. Nach Login und MFA wechseln Sitzungskennung und CSRF-Token. Inaktivitäts-/Gesamtfristen, serialisierter Tokenrefresh, begrenzte Fehlversuche und lokale Abmeldung sind umgesetzt. Die deutsche Einrichtung führt durch Login, QR-Anzeige, sechsstelligen Code und einen optionalen UUID-Verbindungstest. QR und Einrichtungsschlüssel verschwinden nach erfolgreicher Bestätigung. Passkeys, Recovery und Fernbetrieb bleiben offen.

Zusätzliche Prüfungen schließen Ablaufrennen während langsamer Auth-/Datenbankantworten: Eine abgelaufene Sitzung darf weder durch Rotation wieder aktiv werden noch einen Einrichtungsschlüssel oder Finanzdaten ausliefern. Bei einem Supabase-Ausfall zeigt die Oberfläche den konkreten Fehler und hält den Zugriff geschlossen; nach Wiederherstellung kann der Arbeitsplatz erneut geöffnet werden.

Über das Supabase-Plugin wurden die tatsächliche Region Frankfurt `eu-central-1` und das bestätigte App-Konto geprüft. Zwei eng begrenzte Migrationen wurden angewendet und der Inhaber separat gebunden. Reale SQL-Negativprüfungen wiesen anonyme Aufrufe, AAL1 und behauptetes AAL2 ohne aktive Sitzung ab; die Probe-Tabelle blieb leer. Der additive Nachtrag ergänzt eine restriktive Client-Deny-Policy für die Inhaberbindung.

Die lokalen Migrationsversionen wurden an die vom Verwaltungswerkzeug tatsächlich vergebenen Cloudversionen angeglichen. Beide SQL-Inhalte stimmen bytegleich mit der gespeicherten Historie überein; angewendete SQL-Inhalte wurden nicht nachträglich geändert.

Der neue Cloudadapter verarbeitet ausschließlich eine selbst erzeugte UUID und verlangt übereinstimmendes Schreiben/Lesen sowie bestätigte Entfernung. Die Finanzdatenbankskizze wurde nach `docs/drafts/supabase_financial_schema.sql` verschoben. Fachliche Daten und PDFs bleiben lokal in SQLite; es wurden keine Patienten-, Bank-, Rechnungs- oder Zertifikatsdaten in die Cloud übertragen.

Lokale Auth-/Daten-/API-Regressionen und Browserfälle mit simulierten Antworten ergänzen die bisherigen Tests. Der abschließende Gesamtstand wird in `ACCEPTANCE.md` dokumentiert. Persönlicher Passwort-/TOTP-Login und positiver UUID-Roundtrip stehen noch aus: Der SDK-Netzwerkpfad zur Projektadresse ist in der verwalteten Umgebung blockiert, während der Plugin-Verwaltungszugriff funktioniert. Der Supabase-Advisor meldet noch [deaktivierten Schutz gegen bekannte geleakte Passwörter](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); die projektweite Registrierung ist noch nicht bestätigt oder geändert.

Diese Erweiterung aktiviert weder §302-Versand noch produktives Gesundheitsdatenhosting. Die Anleitung erklärt den bereits möglichen persönlichen Anmeldeablauf und trennt ihn von den weiterhin offenen Freigaben.
