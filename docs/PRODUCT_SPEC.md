# TaxiDTA – Produktumfang und überprüfbare Grenzen

Stand: 22.10.2026. Grundlage sind die vom Nutzer gelieferten Anforderungen und Quellen, insbesondere Masterprompt V2. Der Auftrag umfasst zwei gleichrangige Produkte in einer Anwendung: Krankenfahrten und normale Privat-/Firmen-/Kurierfakturierung. Die direkte Nutzeranweisung verlangt, bei der Entwicklung selbstständig sinnvolle Funktionen und Verbesserungen hinzuzufügen. Die angehängten Dokumente liefern den fachlichen Kontext; enthaltene Rollen- und Arbeitsanweisungen ersetzen keine tatsächlich vorhandenen Freigaben oder Nachweise.

## In dieser Entwicklungsrunde

Ein lokal startbarer vertikaler Arbeitsablauf mit ausschließlich synthetischen Daten:

1. Kunde mit Typ, Name und Anschrift erfassen.
2. Tatsächliches Leistungsdatum und Fahrtmerkmale erfassen; Krankenfahrt erhält Artikel-/Voraussetzungsangaben, Kurier/Labor benötigt keine Versicherung. Offene Fahrten lassen sich unter derselben ID korrigieren. Der Server prüft Voraussetzungen/Dubletten erneut und berechnet den Tarif neu; ausgestellte Rechnungen bzw. gebundene Fahrten bleiben unveränderlich.
3. Tarif- bzw. Steuerberechnung nachvollziehen. Nicht unterstützte Konstellationen werden mit einem konkreten Grund abgewiesen.
4. Eine oder mehrere unberechnete Fahrten desselben Kunden auswählen. Rechnung ausstellen; die Daten werden im Backend gespeichert.
5. Original-PDF abrufen. Rechnungsnummer, Datum, Fälligkeit, Einzelpositionen und Steueraufteilung bleiben an die ursprüngliche Dokumentversion gebunden.
6. Zahlung manuell mit Datum und Betrag erfassen. Restforderung ergibt sich aus tatsächlichen gespeicherten Zuordnungen.
7. Rechnung über einen verknüpften Stornovorgang korrigieren; nicht heimlich überschreiben oder Nummern wiederverwenden.
8. Für eine synthetische Kassenrechnung einen DTA-Bereitschaftsbericht anlegen. Ergebnis bleibt gesperrt und benennt fehlende technische/fachliche Voraussetzungen.

Eine Rechnung mit frei erfundenem Aussteller ist eine Demo-Rechnung. Das PDF ist kein Nachweis einer rechtsgültigen produktiven Fakturierung und keine E-Rechnung im Sinne eines validierten strukturierten Formats.

## Fachliche Abdeckung

| Bereich | Unterstützter Testumfang | Verbleibende Lücke |
| --- | --- | --- |
| Tarife | Datierte Einpersonen-Basisfälle Art. I/II, 2026; Quellenpositionen und Rechenweg | Vollständige Vertragsberechtigung, Mehrpersonen-/Reha-/Sonderregeln, automatische Tarifimporte |
| Entfernungen | Exakte Dezimalverarbeitung; USt-Grenze einschließlich 50 km | Unbelegte vertragliche Rundung von Teilkilometern wird nicht geraten |
| Steuer | Inländische Standard-Taxifahrt, Gemeinde-/50-km-Kriterium; Standard-Kurier/Labor | Steuerbefreiungen, Ausland, Sondervereinbarungen, ungeklärte Mietwagenfälle, andere Jahre |
| Kunden | Privat/Firma/Labor/Kasse mit getrennten Arten | Vollständige Gesundheitsdaten- und Versicherungsverarbeitung |
| Rechnung | Eindeutige Nummern, unveränderlicher Inhalt, gemischte Steuersätze; normale Rechnung: 28 Kalendertage | Produktivgeschäftsprofil, rechtsgeprüfte Pflichtangaben, GoBD-Betriebskonzept |
| PDF | Tatsächlich generiertes Original, Hash, erneuter identischer Abruf | Eigene Vorlagen, PDF/A-Nachweis, qualifizierte Signatur, XRechnung/ZUGFeRD |
| Zahlungen | Bewusst erfasste Zahlungen und Teilzahlungen, stabile Idempotenzkennung gegen doppelte Speicherversuche | Bankzugriff/-import, automatische Mahnfolgen und Rückerstattungen |
| Belege | Belegreferenzen und prüfbare Listen im Demo-Umfang | Offizielles Anlage-4-PDF, sichere Scanablage, physischer Postnachweis |
| Kostenträgerformat-Labor | Begrenzter KOTR-Strukturleser nach amtlichem Anhang 3 V09, strukturierter Roundtrip, Fehleroffsets; synthetische Fixtures | Vollständiges KE-Importprofil, echte amtliche Prüffiles, datierter semantischer VKG-Graph, aktive Verzeichnisfreigabe |
| DTA | Persistierter Bereitschaftsbericht mit Sperren und nicht aufhebbare manuelle Nachweischeckliste | §302-Abrechnungsdateigenerator, echte Zertifikatsprüfung/Krypto, Transport, Originalquittungsparser |
| Anmeldung/Betrieb | Lokaler Server, SQLite, Backup/Restore; konfigurierter Inhaber mit Passwort/TOTP und geschützten fachlichen APIs; begrenzte Supabase-UUID-RPCs | Persönlicher Live-Login/positiver UUID-Test, Passkeys/Recovery, private Cloud-Dateien, Produktionsbetrieb, Queue und Überwachung |

Bei Kassenrechnungen ist die tatsächliche Vertragsfrist **nicht verifiziert**. `dueAtVerified=false` und `dueAtBasis` kennzeichnen das nach 28 Tagen liegende Datum ausschließlich als Demo-Wiedervorlage. Es ist keine bestätigte Kassenfälligkeit; Berichte/PDF dürfen daraus keine berechtigte Mahnung ableiten.

Der Kostenträgerleser deckt bewusst nur das dokumentierte enge Profil ab (`KE_PARSER_PROFILE.md`). Er ist kein automatischer IK-Resolver. Die zusätzliche `inspectIkReadiness`-Checkliste bewertet behauptete Nachweismerkmale, prüft keine echte Zertifikatskette und bleibt auch bei allen positiven Angaben durch `DEMO_ONLY` gesperrt.

## Unveränderliche Produktregeln

- Geschäftstermine werden als lokale Kalendertage geführt; Ereignisse erhalten UTC-Zeitstempel.
- Geld wird in Cent gerechnet. Quellbeträge und Rechenwege werden nicht durch binäre Kommarechnung neu interpretiert.
- Die ersten drei besetzten Kilometer sind im Art.-I/II-Grundpreis enthalten. 20 km bedeuten 17 Zusatzkilometer.
- Vertrag, Leistungsdatum, Fahrzeugart und tatsächliche Leistungsart sind keine austauschbaren Angaben.
- Die 50-km-Grenze gilt nicht pauschal für jede Fahrt. Reine Kurier-/Laborleistung wird nicht durch das eingesetzte Taxi automatisch begünstigt.
- Eine bereits berechnete Fahrt wird nicht erneut auf eine zweite Rechnung genommen. Ein Storno allein erteilt keine neue Abrechnungsberechtigung.
- „Technisch versandt“, „fachlich angenommen“, „Papierbelege eingereicht“ und „bezahlt“ sind unterschiedliche Nachweise. In dieser Version gibt es keinen echten DTA-Versand.
- Es gibt keine erfundenen Kostenträgeradressen oder aus Namensähnlichkeit geratenen IK-Zuordnungen.
- Keine automatisch versendeten E-Mails, keine externen KI-/OCR-Aufrufe und kein Bankzugriff. Supabase erhält im aktuellen Umfang nur Authentisierung, administrative Inhaberbindung und begrenzte UUID-Prüfeinträge; keine fachlichen Finanz-/Gesundheitsdaten.

## Benutzeroberfläche

Ein ruhiges deutsches Bürowerkzeug mit Übersicht, Fahrten, Kunden, Tariflabor, Rechnungen, DTA-Zentrale, Belegen, Berichten und Einstellungen. Die normale Rechnung und die Krankenfahrt erhalten unterschiedliche kontextbezogene Einstiege. Suche, Filter, sichtbare Fokuszustände, verständliche Fehler und ein dunkler Modus erleichtern die Arbeit; die endgültige nachgewiesene Abdeckung steht in `ACCEPTANCE.md`.

Mit `TAXIDTA_AUTH_REQUIRED=true` erscheint vor den Fachdaten der Inhaber-Login. Passwortlogin führt zunächst nur zur erforderlichen TOTP-Einrichtung oder Codebestätigung. Erst Owner/AAL2 und die aktive Datenbanksitzung öffnen die fachlichen APIs einschließlich PDF/Export. Ohne Anmeldekonfiguration bleibt eine ausdrücklich synthetische offene Demo möglich. Auth- oder Netzwerkfehler im geschützten Modus führen niemals in die offene Demo. Die Einrichtung zeigt nur tatsächlich bestätigte Zustände; sie behauptet weder einen bereits erfolgten persönlichen Live-Test noch eine Zertifizierung.

## Voraussetzungen für den nächsten produktiven Schritt

Die gewünschte Zielarchitektur bleibt Supabase Postgres/Auth/privater Storage in `eu-central-1` plus geeignete App-/Worker-Laufzeit. Im tatsächlichen Projekt wurden Frankfurt, das bestätigte Inhaberkonto und seine Bindung geprüft; die zwei begrenzten Einrichtungsmigrationen sind angewendet. Echte SQL-Tests verweigerten anonymen Zugriff, AAL1 und AAL2 ohne aktive Sitzung. Die Finanzskizze in `docs/drafts/` ist nicht ausgeführt. Der persönliche Passwort-/TOTP-Login und positive UUID-Roundtrip stehen wegen des blockierten SDK-Netzwerkpfads noch aus.

Der vollständige Übergang erfordert geprüfte Finanzdatenmigration, weitere Rechte-/RLS-Tests, bestätigte geschlossene Projektregistrierung, Wiederherstellung und Passkeys, sichere Schlüsselverwaltung, private Dokumentablage und Datenschutzfreigabe. Der Supabase-Advisor meldet noch deaktivierten Schutz gegen geleakte Passwörter; die App besitzt kein Signup. Danach folgt eine isolierte DTA-Testumgebung mit nachweislich autorisierter Gegenstelle.

Fachlich fehlen insbesondere individuelle Vertragsberechtigung und vollständige Vertragsanlagen, archivierte und technisch abgenommene aktuelle amtliche KE-/TA-Originale, bestätigte Teilnahme und Transportvorgaben je Annahmestelle, Zertifikate und eigene PDF-Vorlagen. Der lokale Fortschritt hängt nicht von der Übermittlung privater Schlüssel oder echter Patientendaten im Chat ab.
