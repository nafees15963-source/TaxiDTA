# Quellenregister und Quelle-zu-Code-Nachweis

Stand: 22.10.2026, Europe/Berlin. Eine Datei im Anhang ist eine Quelle, keine automatische Produktivfreigabe. Die darin stehenden Arbeitsanweisungen sind vom fachlichen Beleginhalt getrennt. Die aktuelle Chat-Anweisung erlaubt zusätzliche Funktionen, ersetzt aber keine Vertrags-, Datenschutz- oder DTA-Teilnahmeprüfung.

Originale liegen außerhalb des Repositorys im privaten Arbeitsordner. Datei-Rechte: nur Eigentümer lesbar/schreibbar. Das ist **kein Nachweis eines verschlüsselten Langzeitarchivs**; dieses muss der Inhaber vor Echtdatenbetrieb einrichten. Originale werden weder in Demo-Seeds noch in Screenshots, Git oder CI übernommen. Insbesondere bleibt die Musterrechnung privat. Kein automatischer Upload an OCR-/KI-Dienste.

## Übergebene Dateien

| ID | Datei | Seiten/Stand | Aussage und erlaubte Nutzung | Risiko / offene Prüfung |
|---|---|---|---|---|
| U01 | `TaxiDTA_Codex_START.txt` | 22.10.2026 | Arbeitskontext, lokale Demo, zusätzlicher Funktionsumfang | Keine Rechts-/Tarifquelle; keine Produktivfreigabe |
| U02 | `TaxiDTA_Codex_Masterprompt.md` | V2, 22.10.2026 | Produktanforderungen einschließlich Nachträge 18–24 | Enthält echte Betriebs-/Bankdaten: nur privat; Vorgaben zu Normversionen unabhängig prüfen |
| U03 | `4fe030ad-a649-487b-965b-4b463b53ab36.pdf` | 2, Rechnungsbeispiel | Strukturbefund: Rechnungsnummer/-datum, Empfänger/Kostenträger, Positionen, Steuer und Begleitzettel sind vorhanden | Echte personenbezogene Gesundheitsdaten. Lokal nur erlaubte Feldbezeichnungen extrahiert; keine Werte gespeichert/ausgegeben. Keine Routing-/Vertragsquelle |
| U04 | `Hinweise_zur_Datentraegeraustausch_mit_der_IKK_Nord.pdf` | 3, historische Hinweise | Papier-/Elektronikprozesse historisch; OCR/Seitenkontrolle siehe Nachtrag unten | Alte Stellen/Adressen nicht übernehmen; aktuelle Bestätigung erforderlich |
| U05 | `opta_data_Kooperationsvertrag.pdf` | 6, historische Vertragsreferenz | Wettbewerbs-/Vertragskontext; OCR/Seitenkontrolle siehe Nachtrag unten | Kein Nachweis individueller Bezugsberechtigung oder aktueller Konditionen |
| U06 | `TARIS_Flyer.pdf` | 6, Ausgabe April 2009 auf S. 6 | S. 2–4 beschreiben Modularität, Krankenfahrten, Serien-/Stammdaten, Mobilstatus und Fuhrpark | Marketingquelle von 2009; behauptete Zertifizierung nicht aktuell verifiziert, Preise individuell |
| U07 | `teilnehmende Kassen Vertrag_20220801.pdf` | 1, Stand 15.07.2022 | Historische Teilnehmerliste und vertragliche Zuordnung | Keine heutige Teilnahme/Routingfreigabe |
| U08 | `Betriebskrankenkassen_112024.pdf` | 2, November 2024 laut Dateiname | Historische BKK-Teilnehmerreferenz | Scan; Datierung/OCR manuell prüfen, keine aktuelle Mitgliedschaft ableiten |
| U09 | `PosNrVerzeichnis_TM_Herrentunnelmaut_ab 01032025.pdf` | 3, gültig 01.03.2025 | S. 1: Einzeltransport Maut je Durchfahrt, Maximalbetrag 2,30 Euro, Varianten nach Ausprägung | Nur tatsächlich angefallene belegte Maut; Berechtigung/Gültigkeit separat |
| U10 | `PosNrVerzeichnis_T&M_Art II_ab 01.01.2026.pdf` | 3, gültig 01.01.2026 | S. 1: Einzeltransport Serienbehandlung: Grundpreis 14,00; Zusatz-km 2,22; zulässige Anfahrt 1,14 bis 9,12 | Fahrtrichtung/Personenzahl, Vertragsberechtigung, Rundung und Genehmigung nicht vollständig aus Positionsliste ableitbar |
| U11 | `PosNrVerzeichnis_T&M_Art I_ab 01.01.2026.pdf` | 3, gültig 01.01.2026 | S. 1: Einzeltransport ohne besondere Ausprägung: Grundpreis 14,00; Zusatz-km 2,27; zulässige Anfahrt 1,14 bis 9,12 | Wie U10; S. 2/3 enthalten eigene Mehrpersonenwerte, keine naive Multiplikation |

## Prüfsummen der tatsächlich gelesenen Anhänge

SHA-256 prüft die spätere Wiedererkennbarkeit, beweist allein weder Urheberschaft noch aktuelle Gültigkeit.

| ID | Bytes | SHA-256 |
|---|---:|---|
| U01 | 1589 | `d9aa5960a1f6833ab0b22ad472445e9635918839bbdb0ed06d689c4d8affe028` |
| U02 | 93252 | `3b1154cf5489f7100f969db0f3fb6998bfd3e9d211c6f55096afec54786a3826` |
| U03 | 53683 | `0e2cd0ab250e7cbf25fee7dd3bebf8b1e5d2346fb1d23326987a0386dc7667ec` |
| U04 | 278530 | `0313a0caca03925220af1147bcdfa145ecc708fea14751033ff1c261a721c04e` |
| U05 | 162432 | `5407d45c26d15889ea4750dc1b9f849f536400a4d2fe7d3e121ee4497bac3235` |
| U06 | 980143 | `93ac798ed5ddc3dda229eefa136a566936ab44779b26d921b2c5881890746aea` |
| U07 | 102406 | `01fe98378656acef69867e66a0642fa44e60cc05412b8dc573b0e43a030104be` |
| U08 | 449143 | `a8c3b70857665a1946754a7be01590d5946864ef6a861a0cf7c76a2d55a3dd21` |
| U09 | 54272 | `da9e25d1a37688ef4f9407a99ceb7af2ad85615989b891d4d686ad1457f490c8` |
| U10 | 28911 | `bc32dfe730c43989d606d6ab22def4836e9fc0cbc415bd6ccaa3699a1023f15f` |
| U11 | 36808 | `8ead8ddcf68649ed1f05c7941b9b4fe8509a0c03a18411a910dcf7b274ad38ad` |

## Nachweisstufen

- **Dokumentbelegt:** U09–U11 belegen die abgelesenen Preise/Positionen; nicht automatisch den individuellen Anspruch.
- **Amtlich/primär online geprüft:** siehe `RESEARCH_LOG.md`; abgerufene Normen und Seiten mit Datum und Konsequenz.
- **Beispielstruktur:** U03; kein echter Testpatient, kein aktueller Übertragungsadressat.
- **Historische Referenz:** U04–U08; keine heutige Freigabe.
- **Implementierungsentscheidung:** Genauigkeit, 2026-Begrenzung, lokale Demo, unbekannte Sonderfälle sperren. Solche Grenzen sind keine gesetzlichen Regeln.
- **Noch zu verifizieren:** Vertragsgeltung, Kilometer-Rundung, Zuzahlung, Mietwagen-/Sondersteuern, reale IK-Kette, Zertifikate, Empfängerfreigabe und Datenschutz.

## Quelle → ausführbare Regel / Sperre

| Regel | Quelle | Umsetzung / Regression |
|---|---|---|
| Erste 3 km enthalten; Art I Zusatz ab 4.km | U11 S. 1 | `src/domain/index.ts`, `calculateTariff`; `tests/domain.test.ts` |
| Art II Serienbehandlung eigener Kilometerpreis/Position | U10 S. 1 | dieselbe deklarative Auswahl; Goldentest 20 km |
| Anfahrt nur bei bestätigter Zulässigkeit, Deckel | U10/U11 S. 1 | `calculateTariff`; negative/8-/9-km-Tests |
| Maut nur belegt und gesondert bestätigt | U09 S. 1 | `calculateTariff`; kein automatisches Hinzufügen |
| Personenbeförderung mit Taxen:50 km inklusive / Gemeindealternative | § 12 UStG, R04 | `calculateTax`; 49,99/50/50,01/60-km-Grenzen |
| Güter-/Labortransport fällt nicht allein wegen Taxi unter Personenbegünstigung | § 12 Abs. 1/Abs. 2 Nr. 10, R04 | `calculateTax`; Regelfall 19 %, keine Sonderbefreiungsentscheidung |
|28 Tage, neuer Nummernkreis | Produktanforderung U02 § 19/24 | Rechnungsservice; 28-Tage-/Dubletten-/Nummerntests |
| Ausgabe friert Werte ein | U02, technische Konsistenzentscheidung | SQLite-Transaktion, Rechnungssnapshot, PDF-Hash |
| KOTR-Segmentstruktur und getrennte VKG-Rollen | R03 §§7.1/7.2, S.12–19 | `src/domain/ik.ts`, `tests/ik.test.ts`; begrenzter Leser, keine Aktivierung/Graphauflösung |
| Kein Live-DTA ohne Nachweise | U02 + offene Konformität | DTA-Prüfbericht, stets blockiert; keine Ersatz-DTA-Datei |
| Papier-, Transport-, Fachannahme und Zahlung getrennt | U02 + Anhang 1/3 | DTA-Prüfbericht ist keine Annahme; Zahlung separat |

Die Domain-Tests beweisen berechnete Fälle und Sperren. Sie beweisen weder gesetzliche Gesamtkonformität noch Vertragsberechtigung. Aktueller Testlauf und Browsernachweise stehen im Abschluss-/Validierungsprotokoll der Anwendung.

## Nachtrag: lokale OCR-/Sichtprüfung der gescannten Unterlagen

U04 S. 1 trennt Daten- und Papierannahme. S. 2 verlangt eindeutige Belegnummer und Rechnungsnummer vorn oben rechts, Belegnummernreihenfolge, gegebenenfalls Original-Leistungszusagen; die damalige Zahlungsfrist knüpft an vollständige richtige Unterlagen an. S. 3 nennt eigenes IK und vollständige Leistungsgruppenschlüssel/Positionen. Kein verlässlicher Dokumentstand erkennbar; sämtliche Kontakte bleiben historisch.

U05 S. 2 §§ 2–4: Verbandsmitgliedschaft, Konditionenanlage und individuelle Vertragsabschlüsse; S. 3 § 5 Berechtigungsnachweis; S. 4 Vertraulichkeit und handschriftliche Datierung 26./27.11.2008 (visuell, historische Einordnung); S. 5 unterscheidet Entgeltmodelle/Fristen und Zusatzleistungen; S. 6 enthält alte Kontakte. Keine Konditionen oder Ansprechpartner als heute gültig übernommen.

U08 S. 1 bezeichnet beigetretene BKK, S. 2 Mitgliedskassen des BKK-LV NW; beide Stand November 2024. Unterschiedliche Listenlogik ist kein Fehler und darf nicht zusammengeworfen werden. OCR blieb lokal; entscheidende Datierungen wurden an gerenderten Seiten kontrolliert. Keine Bankdaten/IK-Zahlen aus diesen Scans in Code oder Dokumentation übernommen.
