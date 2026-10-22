# Abnahme- und Konformitätsmatrix

Stand: 22.10.2026. **Taxi DTA ist eine lokale Demo. Vollständiger § 302-DTA, produktive Authentisierung, Datenschutzfreigabe und Empfängertests sind nicht abgeschlossen.** Kein Prüfbericht und keine synthetische Testrechnung ist eine echte Krankenkassenquittung. Tests des Codeverhaltens ersetzen keine Verfahrensabnahme.

Die Spalte „Nachweis“ benennt existierende oder vorgesehene Artefakte; ein Test gilt nur bei tatsächlich erfolgreichem protokolliertem Lauf als bestanden. Aktuelle Ergebnisse werden im Validierungsbericht festgehalten, nicht aus dieser Planung abgeleitet.

| ID | Given / When / Then | Erwartung / Quelle | Nachweis und Abdeckung |
|---|---|---|---|
| A1 | Bestätigter Einzeltransport,20 km / Tarif I bzw.II berechnen / richtige Positionen und Summe |5259/5174 Cent; U11/U10S. 1 | `tests/domain.test.ts`; eng unterstützter Rechenkern |
| A2 |3 km,4 km, negative km / berechnen / Grundpreis,1 Zusatz-km, Fehler |1400/1627 Cent; U11 | Domain-Grenztests; Bruchteile gesperrt |
| A3 | Ausgegebene Rechnung / neue Regel veröffentlichen / altes Original unverändert | Snapshot/Hash; U02 | Snapshot/PDF-Archiv vorgesehen; echte zweite Tarifversion/Migration offen |
| A4 | Mehrpersonenfahrt / Einzelpersonenregel aufrufen / Sperre statt Multiplikation | Mehrpersonenpreis nicht ableiten; U10/U11S. 2/3 | Negativtest; echte Mehrpersonenabrechnung offen |
| A5 | Fehlende/alte/mehrdeutige IK / Versand prüfen / blockiert | R03 | Begrenzter KOTR-Leser mit Rollenfeldern und Sourceoffsets vorhanden; vollständiger KE-Import und datierter Routinggraph offen |
| A6 | Weiterleiter ohne Entschlüsselungsrecht / verschlüsseln / Schlüssel des berechtigten Empfängers | R03Abs. 5.2.1 | **Offen:** kein SECON-/Empfänger-Kryptoadapter |
| A7 | Abgelaufenes Empfängerzertifikat / senden / verweigert | R03/R09 | **Offen:** kein Zertifikatsparser/Revocation-Lauf; globale Sperre reicht nicht als Zertifikatstest |
| A8 | Originalquittung/gefälschte Antwort / importieren / sichere Korrelation und Ablehnung | R08/Empfängerspezifikation | **Offen:** keine Quittungsimporte oder fingierte Annahme |
| A9 | Gesamtrechnung und Originalbelege / Begleitzettel / Pflichtdaten/Anzahl/Belegbereich | R07 | **Offen:** offizielle Anlage 4-Ausgabe und vollständige Postzentrale |
| A10 | Fehlende Teilnahme-/Empfängernachweise / DTA-Prüflauf / stets gesperrt | U02/R01 | Backend-Negativtest für Bereitschaftsbericht; kein Transportcode |
| A11 | Fremder/öffentlicher Zugriff / Patient/PDF lesen / verweigert | Datenschutzanforderung | Demo nur Loopback; produktive Objekt-/Mandantenauthentisierung und RLS-Abnahme offen |
| A12 | Inhaberkonto / TOTP + Passkey einrichten / MFA und Recovery sicher | U02/RFC 6238/WebAuthn | **Offen:** kein produktiver Auth-/MFA-Flow; Sicherheitsvorbereitung ist keine Anmeldung |
| A13 | Ausgegebene Rechnung / stornieren / Original und Gegenbeleg bleiben, keine Nummer wiederverwenden | U02 | Backend-Storno-/Dublettenregression, Umfang im Laufbericht |
| A14 | Verschlüsseltes Backup / wiederherstellen / Integrität und nutzbarer Zustand | U02 | Lokales Backup-/Restore-Werkzeug; tatsächlichen Laufbericht prüfen; kein Cloud-Restore bewiesen |
| A15 | Demoablauf / DTA-Prüfbericht / klar „gesperrt“, kein „angenommen“ | U02 | API/UI-Demo-Kennzeichnung; Negativtest |
| A16 | Synthetischer Kunde / Krankenfahrt→Tarif→Rechnung→PDF→Prüflauf / nachvollziehbarer Datenfluss | U02 | Teilflow implementiert; vollständige Muster 4-/Patientenakte, offizielle Begleitzettel und Quittungssimulation offen |
| A17 | Fristen 2026/2027 / Adapterwahl / datierte Versionen und Übergang | R01/R03b | Recherche verifiziert; echte Formatadapter und Formatmigrationstests offen |
| A18 | Desktop/kleiner Bildschirm/Tastatur / Suche und Dialoge / gut bedienbar | U02 | Browser-QA im tatsächlichen Laufbericht; keine pauschale WCAG-Zertifizierung |
| A19 | XSS/CSRF/SSRF/SQLi/BOLA/Upload / Angriffsversuch / Schutz | U02 | Enge lokale API, Schema/CSRF/Host-Schutz; keine Uploads/Remoteabrufe; unabhängiger Pentest offen |
| A20 | Mac-Anfänger / Anleitung / lokale Demo starten und Grenzen erkennen | U02 | `START_HIER.md`; nicht auf physischem Mac abgenommen |

## Zusätzliche V2-Abnahme

| ID | Given / When / Then | Input und erwartetes Ergebnis | Test/Evidenz |
|---|---|---|---|
| V2-1 | Fiktiver Privatkunde / Fahrt fakturieren / gespeicherte PDF-Rechnung | Name/Adresse,20 km Taxi, Brutto,7 %, neue Nummer,28 Tage | Kunden-/Rechnungs-API und Browserflow; echte Bankverbindung bleibt ausgeschlossen |
| V2-2 | Vier abgeschlossene Fahrten gleicher Firma / Sammelrechnung / separate Leistungstage, gemischte USt | Bereits fakturierte Fahrt erneut wählen→Konflikt | Backend-Sammel-/Dublettenregression |
| V2-3 | Laborauftrag / erstellen / keine Versicherungs-/Diagnosepflicht |20 km Kurier→19 % im Standardfall | Domain/API; keine externe medizinische Logistikfreigabe |
| V2-4 | Taxen-Personenfahrt / Steuer prüfen /50 km inkl. und Gemeindealternative |49,99/50→7; 50,01 außerorts→19; 60 innerorts→7 | Domain-Grenztests mit R04 |
| V2-5 | Vertragsberechtigte 20 km / Tarif I/II / keine Doppelberechnung der ersten 3 km |5259/5174 Cent | Wie A1; Beispielrechnung nicht als neuer Tarif |
| V2-6 |22.10.2026 /28 Tage /19.11.2026 | Parallele/Doppelanforderung darf keine doppelte Fahrt fakturieren | Domain-/Backend-Tests; Datenbanktransaktion |
| V2-7 | Eigene Vorlagen / importieren / exakter Layoutvergleich | Noch keine eigene Vorlagendatei geliefert | **Offen:** Vorlageimport, visueller PDF-Regressionsvergleich |
| V2-8 | Fehlende physische/Entschlüsselungsstelle / Versand / blockiert | Keine Fallbackadresse aus U03/U04 | Globale Live-Sperre; volle Routing-Negativtests offen |
| V2-9 | Autorisierter Testpartner / Datei senden / Originalantwort prüfen | Keine Berechtigung/Zertifikate vorhanden | **Offen, vor Live zwingend** |
| V2-10 | Unberechtigter Benutzer / Supabase-Daten/MFA umgehen / verweigert | Keine produktive Supabase-Anbindung | **Offen:** ausführbare RLS-/Auth-/Upload-Abnahme |
| V2-11 | Supabase-Projekt / Regions-/Datenflussprüfung / nur freigegebene Verarbeitung | Ziel `eu-central-1`; DPA/Unterauftragsverarbeiter/Backups prüfen | R05/R16 gelesen; kein Cloudprojekt abgenommen |
| V2-12 | Inhaber / lokale Demo und Onboarding / verständliche Schritte | Mac-/DTA-Anleitungen mit echten offenen Punkten | `START_HIER.md`, `ECHTER_DTA_VERSAND_EINRICHTEN.md` |

## Erforderlicher echter DTA-Nachweis vor Freigabe

Eine akzeptierte Referenzsendung braucht die tatsächlich gültige offizielle Formatversion, eingefrorene Datensatz-/Summenprüfung, signierte/verschlüsselte Dateien und verifizierte Empfängerkette, zugelassenes Protokoll und Teilnahmebestätigung. Danach sind Original-Transportantwort und fachliche Verarbeitung getrennt zu archivieren. Zu keinem dieser Punkte wird derzeit eine erfolgte reale Abnahme behauptet.

Offene Aufgaben bleiben eigenständig testbar: vollständiger KE-Importer und Routinggraph (begrenzter Strukturleser vorhanden), TA-Serializer/Parser mit offiziellen Golden Files, Fehler-/Stornonachrichten, SECON-Integration, Zertifikatskette/Sperrprüfung, Empfängertransport, Quittungsparser, Idempotenz bei Timeout, Originalbelegprozess, Datenschutz-/Sicherheitsabnahme. Keine JSON- oder CSV-Datei der Demo darf in `.dta` umbenannt und eingereicht werden.
