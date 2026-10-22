# Begrenzter amtlicher KOTR-Strukturleser

Stand: 22.10.2026. Code: `src/domain/ik.ts`; vollständig erfundenes UI-Beispiel: `src/domain/ik-demo.ts`; Tests: `tests/ik.test.ts`.

**Dieser Leser verarbeitet eine begrenzte Teilmenge der amtlichen Kostenträger-Dateistruktur. Er erstellt keine Abrechnungs-DTA-Datei, importiert keine Daten automatisch als vertrauenswürdig und entscheidet keine reale IK-Zuständigkeit.**

## Tatsächlich gelesene Grundlage

[Anhang 3 V09, Stand 07.10.2026](https://www.gkv-datenaustausch.de/media/dokumente/leistungserbringer_1/sonstige_leistungserbringer/technische_anlagen_aktuell_4/20261007_TP5_TA1_Anhang3_V009.pdf), Abschnitt 7, Seiten 12–19; Schlüssel aus Abschnitt 8. Gelesen am 22.10.2026 über den Recherche-Connector. Original-KE-Dateien konnten damit nicht als binäre Prüffiles geladen werden. Die Tests benutzen deshalb ausdrücklich **synthetische Fixtures, keine offiziellen Golden Files**. Vor aktivem Import fehlen weiter amtliche Originalarchive, unabhängige Gegenprüfung und Tests mit tatsächlich gelieferten KE-Dateien.

## Unterstütztes, engeres Profil

- Standard-UNA optional, festes `UNOC:3`. Bereits korrekt dekodierter Latin-1-Text, höchstens 1 MB. Keine automatische Zeichenraterei oder alternative Syntax.
- Datei: `UNB`, mindestens eine KOTR-Nachricht, `UNZ`.
- Nachricht: `UNH` → `IDK` → obligatorisches `VDT` → `FKT` → optionale wiederholte `VKG` mit jeweils optionalem `VDT` → `NAM` mit optionalem `VDT` → genau eine `ANS` mit optionalem `VDT` → `UNT`.
- Typ `KOTR:02:001:KV`, IDK-Institutionsart `99`, explizite neunstellige IK-Zeichenfolgen. Syntaxgültigkeit ist kein Existenz-/Prüfziffernachweis.
- Unterstützte VKG-Arten: 01/02/03/09. Felder folgen der amtlichen Reihenfolge; Abrechnungscode wird entsprechend der TP5-Fußnote verlangt. 02/03 benötigt Lieferart 07 oder 30.
- Feldlängen und numerische Typen, Pflichtreihenfolge, Kalender-/Intervallprüfung, Referenzen und Kontrollsummen der Segment-/Nachrichtenanzahl. Dieses enge Profil akzeptiert nur vollbreite sechsstellige Kontrollzähler und fünfstellige Referenzen.
- Komponenten-/Element-/Segmenttrennzeichen werden unter Berücksichtigung des Aufhebungszeichens gelesen und beim Serialisieren wieder maskiert. Strukturierte Segmentkomponenten bilden das roundtripfähige Modell; die Institutionsübersicht wird daraus abgeleitet.
- Fehler enthalten Code, Segmentindex, Feldnummer soweit vorhanden und Textoffset. Offsets beziehen sich auf den **bereits dekodierten Text**, nicht auf beliebige ursprüngliche UTF-8-Bytepositionen.

Unbekannte oder außerhalb dieses Profils liegende Bestandteile werden zurückgewiesen, nicht still übersprungen. Dazu gehören KTO, ASP, UEM/DFU, weitere ANS, alternative UNA/Zeichensätze, zusätzliche Nachrichtentypen und alphanumerische Tarifkennzeichen. Angekündigte oder andere Fassungen sind nicht automatisch unterstützt. Die numerische Längentabelle und alphanumerische Tarifschlüssel-Darstellung erfordern für eine Erweiterung fachliche Klärung; derzeit wird die engere numerische Teilmenge akzeptiert.

## Noch keine fachliche Routingfreigabe

Der Leser liefert rohe, getrennte Verknüpfungsrollen. Er verfolgt keinen datierten VKG-Graphen, bewertet keine AC-Gruppenkollisionen und nimmt keine Storno-/Änderungsnachrichten in ein aktives Verzeichnis auf. Linkduplikate und widersprüchliche parallele Zuordnungen müssen der spätere semantische Import prüfen. NAM-/ANS-eigene VDT stehen im Segmentmodell, werden in der vereinfachten Institutionsübersicht aber nicht zu einer Adressgültigkeit zusammengeführt. Keine dieser Übersichten darf als gültige Versandentscheidung verwendet werden.

`inspectIkReadiness` ist zusätzlich eine **manuelle Nachweischeckliste**, kein automatischer Resolver. Sie prüft getrennt angegebene Rollen, datierte Quellenangaben, Teilnahme-/Transport-/Papierbelege und die Zuordnung/Gültigkeit behaupteter Zertifikatsmerkmale. Sie validiert keine echte Zertifikatskette. Selbst bei allen positiv gesetzten Angaben bleibt der unveränderbare Blocker `DEMO_ONLY`: `productionReady` kann niemals `true` werden.

## Tatsächlich ausgeführte Prüfungen

Erster gezielter Lauf: 10 Tests bestanden; TypeScript-Prüfung erfolgreich. Geprüft wurden Struktur-/Komponentenroundtrip mit freigegebenen Sonderzeichen, Feldlängen und Sourceoffsets, Pflichtreihenfolge, ungültige Daten, Segment-/Nachrichtenzähler, Referenzkonflikte, falsches Verfahren, nicht unterstützte Gruppen/Syntax, VKG-Lieferart, obligatorischer AC, getrennte Erstellung-/Geltungsjahre sowie fehlende Rollen, falscher Zertifikatsempfänger/Ablauf und nicht aufhebbare Live-Sperre. Zusätzliche unabhängige QA und der abschließende Gesamtlauf werden separat protokolliert.
