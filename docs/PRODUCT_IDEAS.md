# Weitere Produktideen und ihre Bewertung

Stand: 22.10.2026. Die direkte Nutzeranweisung ermutigt zu mehr Funktionen und selbstständigen Verbesserungen. Mehr Funktionen werden nur sinnvoll, wenn ihre Regeln, ihr Nutzen und ihre Grenzen nachvollziehbar bleiben.

Diese 42 konkreten Ergänzungen wurden aus den gelieferten Anforderungen, dem Bedrohungsmodell, dem aktuellen Datenmodell und möglichen Bürofehlern eigenständig abgeleitet und kritisch bewertet. Sie ergänzen bzw. vertiefen die breiten Startideen des Masterprompts. Sie sind **keine behauptete aktuelle Marktrecherche**: Ein Live-Vergleich mit Wettbewerbern ist durch die verfügbaren Quellen begrenzt; dafür gilt `COMPETITOR_GAP_ANALYSIS.md`. Eine Idee ist nicht exklusiv, nur weil sie hier steht.

Bewertung: Nutzen, Aufwand und fachliches/Sicherheitsrisiko jeweils niedrig/mittel/hoch. Der Status wird erst nach Code-/Testprüfung als umgesetzt geführt. Die ersten 15 sind die priorisierte Auswahl. Die Tabelle nennt Code-/Testnachweise; offene Endprüfungen bleiben ausdrücklich sichtbar.

## Die 15 zuerst ausgewählten Ergänzungen

| Nr. | Konkrete Ergänzung | Nutzen | Aufwand | Risiko | Begründung und Abnahme | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Gleiche Kundenidentität für sämtliche Positionen einer Sammelrechnung serverseitig erzwingen | hoch | niedrig | niedrig | Verhindert eine Rechnung mit fremden Leistungen; gemischte Auswahl muss atomar scheitern | Umgesetzt; `tests/backend.test.ts`: gemischte Empfänger atomar abgewiesen |
| 2 | Nach Storno bleibt eine Fahrt gegen unmittelbare automatische Zweitfakturierung gesperrt | hoch | niedrig | mittel | Ein Storno ist keine neue Leistungsfreigabe; neue Abrechnung braucht später bewussten Korrekturprozess | Umgesetzt; `tests/backend.test.ts`: Storno-/Zahlungsnegativfälle |
| 3 | Überzahlungen und Zahlungen auf stornierte Forderungen ablehnen | hoch | niedrig | niedrig | Offene Beträge dürfen nicht durch Tippfehler negativ werden; getrennte Überzahlungs-/Erstattungsvorgänge später | Umgesetzt; `tests/backend.test.ts`: Storno-/Zahlungsnegativfälle |
| 4 | Name und Anschrift des Rechnungsempfängers bei Ausstellung einfrieren | hoch | niedrig | niedrig | Spätere Stammdatenänderung darf das Original nicht rückwirkend verändern | Umgesetzt; `customerSnapshot` im Original; `tests/backend.test.ts` |
| 5 | Bei Nachdruck das archivierte Original ausliefern und seinen SHA-256 anzeigen | hoch | niedrig | niedrig | Keine zufällige Neuberechnung nach Tarif-/Layoutänderungen; Bytegleichheit prüfen | Umgesetzt; archivierte Bytes/SHA-256 im Backend-Test bestätigt |
| 6 | Mehrdeutige Nichtantwort beim Ausstellen durch eindeutige Befehlskennung absichern | hoch | mittel | mittel | Zweimaliger Klick oder Timeout darf nicht zwei Rechnungen erzeugen; identischer Idempotenzschlüssel liefert dasselbe Ergebnis | Umgesetzt; gleiche/abweichende Befehlskennung im Backend-Test |
| 7 | Tabellenformeln im CSV-Export neutralisieren, auch bei führenden Leerzeichen | hoch | niedrig | niedrig | Kundenname `=…` darf im Tabellenprogramm nicht als Formel ausgeführt werden | Umgesetzt; `csvCell`-Formeltest einschließlich Leerraum bestanden |
| 8 | Nur bestätigte Leistungsjahre zulassen und nicht still die heutige Regel rückwirkend anwenden | hoch | niedrig | mittel | Historische und zukünftige Steuern/Tarife benötigen eigene Quellen; nicht unterstütztes Datum klar blockieren | Umgesetzt; Domain-Negativtests für nicht unterstützte Daten |
| 9 | Unbelegte Bruchteile von Tarifkilometern sperren statt heimlich aufrunden | hoch | niedrig | mittel | Eine technisch mögliche Dezimalzahl ist noch keine vertragliche Rundungsregel; identische Distanzschreibweisen werden zur Dublettenprüfung vereinheitlicht | Umgesetzt; `KM_ROUNDING_UNVERIFIED` im Domain-Test |
| 10 | Ein Dokument benötigt einen dauerhaften „nur Testdaten“-Kontext, auch außerhalb des Browsers | hoch | niedrig | niedrig | Heruntergeladenes PDF bleibt als Demo erkennbar; visuellen PDF-Test durchführen | Im PDF implementiert; visuelle Endprüfung separat |
| 11 | Vorbereitungsberichte bekommen einen anderen Dokumenttyp als echte DTA-Dateien | hoch | niedrig | niedrig | Ein Bereitschaftsbericht kann weder als `.dta` exportiert noch als Annahmequittung bezeichnet werden | Im API-Typ implementiert und getestet; endgültige UI-Prüfung separat |
| 12 | Atomare Rechnungserstellung: Nummer, Positionen, PDF und Fahrtbindung gelingen gemeinsam | hoch | mittel | mittel | Fehler in PDF-Ausgabe dürfen keine unvollständige ausgestellte Rechnung zurücklassen | Teilweise: finanzielle Originale atomar, Nummern reserviert; PDF-Fehler-Injektion noch nicht abgenommen |
| 13 | Sicherungstests im getrennten temporären Speicher durchführen | hoch | niedrig | niedrig | Der Wiederherstellungstest darf niemals produktive oder aktive Daten überschreiben | Umgesetzt; aktive DB bleibt im Backup-Test unverändert |
| 14 | Beschädigte und mit falschem Passwort geöffnete Sicherungen vor der Datenbankprüfung ablehnen | hoch | niedrig | niedrig | Authentifizierte Verschlüsselung muss Manipulation erkennen; Negativtests erforderlich | Umgesetzt; Manipulations-/Passwort-Negativtests bestanden |
| 15 | Lokalen Testserver gegen versehentliches öffentliches Binden und falsche Host-/Origin-Angaben sperren | hoch | niedrig | mittel | Eine lokale Demo ohne Kontoschutz darf nicht unbemerkt als Online-App betrieben werden | Umgesetzt; Host-/Origin-/CSRF-Tests und lokaler Bindeschutz |

Einige Punkte konkretisieren im Masterprompt bereits genannte Ziele wie Doppelabrechnungsschutz, Idempotenz oder Wiederherstellung. Die zusätzlichen Produktentscheidungen sind die hier beschriebenen präzisen Fehlerfälle, Regeln und prüfbaren Abläufe; keine künstlich vergrößerte Liste eigenständiger fertiger Module.

## Weitere 27 bewertete Ergänzungen

| Nr. | Idee | Nutzen | Aufwand | Risiko | Kritische Bewertung und nächster Nachweis |
| --- | --- | --- | --- | --- | --- |
| 16 | Forderungen mit identischem Betrag und Datum als mehrdeutige Zahlungsvorschläge darstellen | hoch | mittel | mittel | Hilft beim späteren CSV-Abgleich; niemals allein wegen gleicher Summe automatisch bezahlen |
| 17 | Zahlungsbuchung und Stornobuchung über einen gemeinsamen Konkurrenzschutz serialisieren | hoch | mittel | mittel | Umgesetzt: erneute transaktionale Prüfung vor Stornoabschluss; QA-Regressionsfall „Zahlung während PDF-Vorbereitung“ bestanden |
| 18 | Rundungsrest einer gemischten Steuerrechnung explizit erklären | mittel | mittel | mittel | Centdifferenzen nicht in eine unsichtbare Nebenposition schieben; steuerliches Rundungsmodell zuerst festlegen |
| 19 | „Was ändert sich?“ vor einer Kunden-Stammdatenänderung zeigen | mittel | niedrig | niedrig | Bereits ausgestellte Dokumente bleiben eingefroren; nur offene Entwürfe dürfen betroffen sein |
| 20 | Adressänderung historisieren, ohne alte Adresse wieder als aktuellen Vorschlag anzubieten | mittel | mittel | mittel | Verbessert Datenqualität; Aufbewahrungs-/Löschregeln für Historie prüfen |
| 21 | Kontakttypwechsel blockieren, wenn dadurch die Rechnungsart unbemerkt wechseln würde | hoch | mittel | mittel | Kasse und Privatkunde sind nicht austauschbar; explizite Migration statt stiller Umdeutung |
| 22 | Leistungsdatum nach Rechnungsdatum als besondere Vorausabrechnung behandeln | hoch | mittel | hoch | Nicht pauschal verbieten; rechtlich geprüfter eigener Flow erforderlich |
| 23 | Angebot und Rechnung klar als verschiedene Dokumenttypen modellieren | mittel | mittel | mittel | Ein Angebot darf keine endgültige Rechnungsnummer verbrauchen oder Forderung erzeugen |
| 24 | Kundenbestellnummer für mehrere Fahrten auf Duplikat prüfen | mittel | niedrig | niedrig | Zusätzlicher Bürohinweis, kein alleiniger Abrechnungsblock bei zulässiger Sammelbestellung |
| 25 | Kurierstopps ohne freie medizinische Freitextfelder erfassen | hoch | mittel | mittel | Datensparsame Logistik; medizinische Transportpflichten separat fachlich prüfen |
| 26 | Wartezeit mit Beginn/Ende und Preisnachweis statt nur freier Zahl erfassen | mittel | mittel | mittel | Rechenweg wird prüfbar; Tarif-/Preisberechtigung bleibt Voraussetzung |
| 27 | Fahrtunterbrechung von mehreren eigenständigen Fahrten unterscheiden | hoch | hoch | hoch | Vermeidet falsche erneute Grundpauschale; nur anhand konkreter Vertragsregeln umsetzen |
| 28 | Genehmigungskontingent bei Terminabsagen korrekt reservieren/freigeben | hoch | hoch | hoch | Ist eine Fahrt durchgeführt, abgesagt oder bereits abgerechnet? Zustandsmodell und Vertrag nötig |
| 29 | Rückfahrten erst nach Bestätigung der tatsächlichen Durchführung abrechnen | hoch | mittel | mittel | Ein geplanter Serientermin ist noch kein Leistungsnachweis |
| 30 | PDF-Ausdrucke mit einer druckerunabhängigen Layout-Prüfseite kalibrieren | mittel | niedrig | niedrig | Hilft bei Fensterumschlag/Feldpositionen; keine vertraulichen Daten auf Testseite |
| 31 | Ausgabedialog warnt vor gemeinsam genutzten Druckern | mittel | niedrig | niedrig | Nur kontextbezogener Hinweis; keine Scheinsicherheit oder Überwachung von Druckern |
| 32 | Versehentlich doppelt heruntergeladene Originale als identisches Dokument erkennen | mittel | niedrig | niedrig | Gleicher Dokumenthash verhindert falsche Vorstellung zweier Rechnungen |
| 33 | Vollständigkeitsmanifest für einen strukturierten Anbieterwechsel erzeugen | hoch | mittel | mittel | Dateizahl, Hashes, Versionsschema und fehlende Dokumente; Export nur nach starkem Zugriffsschutz |
| 34 | Lesbaren Prüfbericht zusätzlich zum maschinenlesbaren Export liefern | hoch | mittel | mittel | Steuerberater/Support sieht Summen und offene Lücken; keine echte DATEV-Konformität vortäuschen |
| 35 | Betroffenenexport vorab auf fremde mitbetroffene Personen prüfen | hoch | hoch | hoch | Sammelrechnungen können mehrere Personen betreffen; rechtliche Prüfung und sichere Redaktion nötig |
| 36 | Sichere Fehlerkopie mit technischer Referenz statt kompletter Serverantwort | hoch | mittel | mittel | Benutzer kann Fehler weitergeben, ohne Namen/Token/Dateipfade zu kopieren; Redaktions-Negativtests |
| 37 | Lesemodus bei fehlgeschlagener Sicherung aktiv anbieten | hoch | mittel | mittel | Eine einzige Sicherungswarnung darf nicht unbemerkt verschwinden; Sperrwirkung nach Betriebsbedarf festlegen |
| 38 | Zwei-Browser-Konflikthinweis für veraltete Formulare | hoch | mittel | mittel | Versionsnummer/ETag verhindert stilles Überschreiben; keine Daten im localStorage speichern |
| 39 | Recovery-Übung mit ausschließlich synthetischen Markern protokollieren | hoch | mittel | niedrig | Belegt Zeit bis Wiederanlauf und fehlende Abhängigkeiten, ohne private Datensätze ins Protokoll zu schreiben |
| 40 | Nach Anbieter-/Schemawechsel Goldensummen des Gesamtbestands vergleichen | hoch | mittel | mittel | Vorher-/Nachher-Zahl und Betrag je Dokumenttyp; kein Test allein auf Zeilenzahl |
| 41 | Unbekannte Datei-Endungen und Behälterarchive nicht automatisch öffnen | hoch | mittel | mittel | Spätere Importe isolieren und Umfang begrenzen; aktuell keine Upload-Anbindung vortäuschen |
| 42 | Veränderung einer amtlichen Quelle erzeugt einen lesbaren Prüfauftrag mit Wirkdatum | hoch | hoch | hoch | Eine neue Website-Datei darf nicht automatisch Regeln ersetzen; Signatur/Hash/Version und fachliche Freigabe nötig |

## Auswahlprinzip

Vorrang haben Fehlervermeidung, nachvollziehbare Geldbeträge und echte Nachweise. Kleine Ideen 1–15 lassen sich überwiegend anhand lokaler synthetischer Daten prüfen; sensible Neuempfänger, automatische Bankaktionen, medizinische Fachentscheidungen und Produktivtransporte bleiben außerhalb autonomer Aktivierung.

Eine Erweiterung wird erst als umgesetzt markiert, wenn der entsprechende Code vorhanden ist, ein sinnvoller Test bzw. eine überprüfte Bedienung vorliegt und die Dokumentation den Umfang korrekt beschreibt. Die abschließenden Nachweise werden in `ACCEPTANCE.md` ergänzt. Größere offene Ideen werden vor Umsetzung erneut gegen aktuelle Quellen und Sicherheitsanforderungen geprüft.
