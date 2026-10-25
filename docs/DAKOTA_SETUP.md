# dakota.le: gewählter Versandweg

Zunächst ausgewählter Ansatz: dakota.le statt DMRZ. Nachträgliche Nutzerangabe: ausschließlich Mac vorhanden. Der lokale dakota.le-Weg ist deshalb bis zu einer ausdrücklich gewählten Windows-Umgebung nicht ausführbar; es wurde kein Server beauftragt. Die Integration ist noch nicht installiert oder versandbereit. Es wurde keine Lizenz bestellt und kein Zertifikat beantragt oder ersetzt.

## Ermittelter Betriebsweg

TaxiDTA muss zuerst vollständige und geprüfte §302-Nutzdaten erzeugen. Ein Windows-Versandrechner übernimmt die dokumentierte Übergabe an dakota.le. dakota.le verwaltet Zertifikate und verschlüsselt und versendet geeignete Dateien. Die Webanwendung kann das Windows-Programm nicht unmittelbar im Cloudflare-Worker ausführen. Ein Download oder ein lokaler Connector ersetzt nicht den fehlenden vollständigen TA-Serializer.

Eine frei verfügbare, aktuelle und vollständig verifizierte Herstellerbeschreibung für einen unbeaufsichtigten Aufruf liegt noch nicht vor. Keine Aufrufparameter oder Übergabeverzeichnisse aus dem anderen Produkt dakota.ag ableiten. Die Verzeichnisausgabe im Benutzerhandbuch bezeichnet verschlüsselte AUSGABEN und darf nicht als Nutzdaten-Importschnittstelle behandelt werden.

## Rechnerprüfung

`npm run dakota:check` prüft ausschließlich den Rechner, auf dem der Befehl läuft. Auf Windows werden dakota.le-Einträge der Installationsregistrierung gelesen. Optional prüft `TAXIDTA_DAKOTA_EXE` nur, ob eine absolute EXE-Datei vorhanden ist; sie wird nicht ausgeführt. Ein Installationshinweis ist kein Lizenz- oder Zertifikatsnachweis. Auf anderen Systemen meldet die Prüfung den fehlenden Windows-Host. Exitcode 2 bedeutet nicht versandbereit.

Die Prüfung enthält keine Schlüssel, fragt keine Passwörter ab, sendet keine Daten und schreibt keine Installationseinstellungen.

## Noch zu erledigen

- Vom Nutzer benannter Windows-PC oder Windows-Server und verfügbarer administrativer Einrichtungskanal.
- Lizenz einschließlich Supportbedingungen, unterstützte Version und konkrete Integrationsbeschreibung vom Wiederverkäufer; Bestellung separat.
- Geklärter Zertifikatsbestand; kein unkoordinierter Schlüsselwechsel für die bestehende IK.
- Vollständiger TA-Generator, datiertes KE-Routing, dokumentierte Dateiübergabe und Empfangsauswertung.
- Getrennter Test mit unveränderten Originalnachweisen; keine Annahme aus einem Prozess-Exitcode oder aus einer verschwundenen Eingabedatei ableiten.

## Quellen

- GEOS Produktbeschreibung: https://www.geosmbh.net/dakota-le/ — Windows, Zertifikatsverwaltung, Verschlüsselung und E-Mail-Transport. Direkter Abruf zeitweise 502; vorherige Recherche und indexierte Primärquelle verfügbar.
- GEOS Benutzerhandbuch: https://www.geosmbh.net/download/Handbuch/dakota.pdf — indexierter Abschnitt 3.3.5 zur Verzeichnisausgabe; keine vollständige aktuelle Entwickler-Schnittstellenbeschreibung abgenommen.
- GEOS Angebot: https://www.geosmbh.com/eshop/Artikel/dakotale — zuletzt recherchiert 278 EUR netto inkl. zwölf Monaten Support, danach 89 EUR netto jährlich; Zertifikat gesondert. Vor Bestellung Preise und Bedingungen erneut prüfen.
