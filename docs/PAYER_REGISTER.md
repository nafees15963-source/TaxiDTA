# Krankenkassenregister und Schnellsuche

Das Register wird mitgeliefert und direkt im Abrechnungsfall nach Name, Kürzel oder IK durchsucht. Eine eigene Kassentabelle, DTA-Adresspflege oder vorgelagerte Kundenanlage ist dafür nicht erforderlich. Es enthält **146 öffentlich belegte institutionelle Einträge** und ein deutlich markiertes fiktives Beispiel.

| Bestand                                 | Anzahl | Quellenstand / Bedeutung                                            |
| --------------------------------------- | -----: | ------------------------------------------------------------------- |
| Gesetzliche Krankenkassen               |     92 | Amtliche GKV-Namensliste vom 22.10.2026                             |
| Ordentliche PKV-Verbandsmitglieder      |     39 | Mitgliedsseite, geprüft 23.10.2026                                  |
| Außerordentliche PKV-Verbandsmitglieder |     10 | Mitgliedsseite, geprüft 23.10.2026                                  |
| Verbundene Versorgungseinrichtungen     |      2 | KVB und Postbeamtenkrankenkasse                                     |
| Weitere IK-Verzeichniseinträge          |      2 | KUK Hannover und St. Martinus; aktuelle Mitgliedschaft nicht belegt |
| Historischer Eintrag                    |      1 | FAMK, laut IK-Verzeichnis durch INTER übernommen                    |

Die 92 GKV-Namen und die veröffentlichte PKV-Mitgliedsliste sind vollständig übernommen. **Ein vollständiges Verzeichnis sämtlicher in Deutschland zugelassener Privat-, Zusatz- und Reiseversicherer ist damit nicht belegt.** Das Programm behauptet diese Vollständigkeit nicht (`nameListComplete:false`). Der PKV-Verband weist 39 ordentliche Mitglieder aus, davon 33 mit Krankheitsvollversicherung. Außerordentliche Mitglieder sind keine weitere pauschale Liste von Vollversicherern. Makler und erfundene Kassen wurden nicht hinzugefügt.

## Quellen und IK-Rollen

### Gesetzliche Krankenkassen

Die [GKV-Liste](https://www.gkv-spitzenverband.de/krankenkassenliste.pdf), datiert 22.10.2026, enthält die 92 Namen. Der bestehende Schnappschuss `data/payers-2026-10-22.json` bleibt unverändert mit diesem Quellenstand.

Der [GKV/KBV-Anhang 1 zur TA1, Version 1.32 vom 10.02.2026, ab Q2/2026](https://www.gkv-datenaustausch.de/media/dokumente/leistungserbringer_1/aerzte/technische_anlagen___aktuell/20260210_Anhang1_TA1_V1_32.pdf), Abschnitt 1.4, Seiten 12–15, liefert getrennte Abrechnungs-, Zertifizierungs- und DAV-IK für ein anderes Verfahren. Die Abrechnungs-IK dienen ausschließlich als entsprechend markierte Suchreferenzen. Sie sind kein Nachweis für Taxi-§302, Karten-IK oder aktuelle Empfängerrollen. Acht Institutions-IK sind zusätzlich auf eigenen Primärseiten belegt: fünf AOKs, TK, Barmer und hkk. 84 verbleiben `reference-only`.

Beispiel AOK Baden-Württemberg: `108018007` ist die direkt auf der [AOK-Primärseite](https://www.aok.de/pk/rechtliches/impressum/) veröffentlichte Institutions-IK; `108018121` bleibt eine getrennte ärztliche Abrechnungsreferenz. Beide sind suchbar. 17 vorhandene Haupt-/Kontaktanschriften stammen aus den Impressen der elf AOKs und der sechs Ersatzkassen und bleiben als Kontaktanschriften gekennzeichnet.

### Private Versicherer und Sonderversorgung

Primärquellen sind die aktuelle [PKV-Mitgliedsseite](https://www.pkv.de/verband/ueber-uns/mitglieder-pkv-verband/) und die vom Verband selbst veröffentlichte [IK-Liste auf GitHub](https://github.com/PKV-Verband/PKV-IK-Liste). Der tatsächliche [CSV-Abruf](https://raw.githubusercontent.com/PKV-Verband/PKV-IK-Liste/main/ik_liste.csv) wurde am 23.10.2026 heruntergeladen; SHA-256:

`92a2f90634c51470f9b2078016663cab0e31817cae1db08b2005b3e1f07bab3d`

Die CSV enthält 38 Institutions-IK und nennt als Gültig-seit-Datum jeweils **01.01.2022**. Dieser Quellenstand bleibt bei `ikSourceDate` erhalten; das Abrufdatum 23.10.2026 macht daraus keine unabhängig neu validierten IK. Aktuelle Namen und Kontaktanschriften werden, soweit vorhanden, aus der Mitgliedsseite ergänzt. So bleiben unter anderem die beiden ALTE-OLDENBURGER-Rechtsträger und die beiden Barmenia-Rechtsträger getrennt. Eine gemeinsame Marke führt nicht zum Kopieren einer IK.

Für sechs ordentliche und zehn außerordentliche Mitglieder enthält die Verbands-CSV keine belegte IK. Ihre Namen und Anschriften sind auswählbar; `ik:null`, `ikStatus:missing` benennt die Lücke. Keine Platzhalter- oder erfundenen IK. FHIR-Demoidentifikatoren aus dem Repository wurden nicht übernommen. Allgemeine Versicherer-E-Mails werden nicht als DTA-Adresse importiert. Die drei nicht aktuell als Mitglieder belegten CSV-Zusatzeinträge sind `directory-only` beziehungsweise `historical`; FAMK verweist mit `successorId` auf INTER.

Private Direktabrechnung benötigt die konkrete Vereinbarung und Annahmestelle. Eine PKV-IK oder Verbandsmitgliedschaft erzeugt keinen automatischen §302-GKV-Versandweg (`dtaWorkflow:private-contract-required`). KVB und PBeaKK sind gesondert als Versorgungseinrichtungen markiert.

## Automatisch mitgelieferte DTA-Hinweise

Die tatsächlich geöffnete [TP5-Broschüre des GKV-Spitzenverbands, Stand 15.09.2026](https://www.gkv-datenaustausch.de/media/dokumente/leistungserbringer_1/sonstige_leistungserbringer/20260915_Broschuere_TP5.pdf) enthält veröffentlichte Daten- und Belegannahmestellen. `data/payers-routing-2026-09-15.json` übernimmt daraus **76 Transporthinweise und bei acht Kassen getrennte Papierregeln** für Krankentransport, Abrechnungscode 40 (41–49). Dies sind Quellenhinweise mit Seitenangaben und Bedingungen; keine importierte aktuelle KE-Datei und keine aktivierte Transportroute.

| Zuordnung                                     | Tatsächlich veröffentlichter Hinweis                                            | Wichtige Grenze                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| BKK mit entsprechendem institutionellen Namen | `le@bitmarck-daten.de`, physischer/logischer Empfänger `104027544`              | Nur sofern aktuelle KE keine andere Stelle nennt; Papierziel aus KE                                                   |
| IKK und BIG                                   | gleiche Transport-E-Mail, Empfänger `109900019`                                 | Gleicher KE-Vorbehalt                                                                                                 |
| SVLFG                                         | gleiche Transport-E-Mail, Empfänger `102109128`                                 | Gleicher KE-Vorbehalt                                                                                                 |
| Barmer                                        | `dav-le@vdek-dav.de`, Kostenträger-IK `104940005`                               | Zwei Papierziele, abhängig vom Sitz-Bundesland des Leistungserbringers                                                |
| TK                                            | `edi302@inter-forum.de`, IQVIA-Anbieter-IK `661430035`                          | Broschüre nennt zusätzlich DAVASO-Mail; aktuelle KE muss dies auflösen. Haushaltshilfe-Mail ist ein anderes Verfahren |
| DAK Krankentransport                          | `inbox@tp5.arz-emmendingen.de`, Empfänger `107436557`, Kostenträger `105830016` | Die DAVASO-Route für andere Leistungsarten gilt hier nicht                                                            |
| KKH                                           | `le-ek@bitmarck-daten.de`, Empfänger `104593971`, Kostenträger `102171012`      | Papierannahme Emmendingen gemäß Aktualisierung September 2026                                                         |
| HEK                                           | `edi302@davaso.de`, Anbieter-IK `661430035`                                     | Empfängerrollen nicht aus Anbieter-IK erraten                                                                         |
| hkk                                           | ARZ Emmendingen, Anbieter-IK `107436557`, Papierziel                            | Keine im Abschnitt belegte Transport-E-Mail; DAK-Mail nicht kopiert                                                   |
| Knappschaft                                   | Vermerk zum Anbieterwechsel bei Krankentransport seit 01.07.2025                | Allgemeine BITMARCK-Standardadresse bewusst nicht als Krankentransportroute übernommen                                |
| AOK Hessen / PLUS                             | Krankentransport-Papierannahmen mit Versandbedingungen                          | Allgemeine DAV-Kontaktpostfächer sind keine belegten Versand-Endpunkte                                                |

Physischer Empfänger, logischer Empfänger, ausdrücklich belegter Entschlüsselungsempfänger, Kostenträger und Anbieter-IK sind separate Felder. Ein unbekanntes Feld bleibt `null`. Hauptsitze werden nicht zu Papierannahmestellen umgedeutet. Barmer-Regeln und Brief-/Paketunterschiede werden vollständig angezeigt; ohne notwendiges Regionalmerkmal wird kein einzelnes Ziel geraten.

Die [aktuelle Kostenträgerseite](https://www.gkv-datenaustausch.de/leistungserbringer/sonstige_leistungserbringer/kostentraegerdateien_sle/kostentraegerdateien.jsp) wurde geprüft. Die tatsächlichen KE-Dateiaufrufe lieferten im verfügbaren Web-Connector weiterhin einen Format-/Abruffehler. Es wurde kein aktuelles binäres KE-Original heruntergeladen, gehasht oder aktiv importiert. Daher bleibt überall `currentKeVerified:false`. Die jeweils gültige KE hat Vorrang vor der Broschüre; diese Daten ersetzen weder den KE-Resolver noch Empfängerzertifikate oder die konkrete Transportanbindung.

## Freigaben und Integrationsvertrag

Alle 146 echten Einträge haben `invoiceReady:false` und `routingVerified:false`. Die Kassenauswahl lässt sich im Entwurf behalten, auch bei unbekannter IK. Die zusätzliche `demo-kasse` enthält ausdrücklich fiktive Daten und darf ausschließlich den synthetischen Rechnungsablauf bedienen. Eine vorhandene IK, Kontaktadresse oder veröffentlichte Transport-E-Mail aktiviert keinen echten Versand.

- `data/payers-2026-10-22.json`: bestehender GKV-Schnappschuss.
- `data/payers-private-2026-10-23.json`: Verbandsmitgliedschaft, getrennte IK-Quellfassung, Abrufdatum und CSV-Hash.
- `data/payers-routing-2026-09-15.json`: veröffentlichte TP5-Hinweise mit Quellen, Rollen und Bedingungen.
- `src/domain/payers.ts`: gemeinsame lokale Suche und Vertrauensbasis für den Server; höchstens 100 Ergebnisse, 120 Suchzeichen. Exakte IK und Kürzel vor Teiltreffern; Leerzeichen, Umlaute und historische Aliase werden unterstützt. Rückgaben einschließlich verschachtelter Routendaten sind Kopien.
- `server/payers.ts`: unveränderte `getPayer`, `resolvePayer` und `searchPayers`-APIs; unbekannte ID führt zu HTTP 422. Backend-Kernfelder stammen aus dem Register, nicht aus unkontrollierten Browserangaben.
- `src/PayerPicker.tsx`: zugängliche Combobox mit GKV/PKV-Markierung, unbekannten IK, getrennten historischen Einträgen und aufklappbaren Quellen-/Annahmehinweisen. Es werden keine Versichertendaten an einen Suchdienst übertragen.

`searchPayers` ergänzt den bisherigen Vertrag um `statutoryCount`, `privateCount` (49 aktuelle private Verbandsmitglieder) und `associatedCount`. `officialCount` zählt alle 146 belegten echten Einträge, einschließlich der drei klar markierten Zusatzeinträge. `payerRegistrySummary()` benennt die belegte Vollständigkeit der jeweiligen Liste und die verbleibenden Lücken getrennt. Verbraucher dürfen `nameListComplete` nicht pauschal als Vollständigkeit des gesamten privaten Markts interpretieren.

## Prüfung

Sieben gezielte Registertests prüfen Bestandsgrenzen, Namens-/Alias-/IK-Suche, verschiedene Rechtsträger, fehlende Privat-IK, historische Nachfolge, Abrechnungscode-Ausnahmen, getrennte Empfängerrollen, regionale Papierannahmen, fehlende Versandfreigaben und den Schutz verschachtelter Daten vor Änderungen durch Aufrufer. Diese Tests belegen die Implementierung und konservative Grenzen, keine unabhängige Vollvalidierung jeder amtlichen IK und keinen erfolgreichen DTA-Transport.
