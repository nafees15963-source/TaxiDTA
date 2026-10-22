# Echten § 302-DTA-Versand einrichten

Stand:22.10.2026. **Die vorliegende App sendet keine DTA-Dateien.** Sie erstellt lokale Bereitschaftsberichte. Ein begrenzter, nicht aktivierender KOTR-Strukturleser ist vorhanden (siehe `KE_PARSER_PROFILE.md`). Offizieller Abrechnungs-Dateigenerator, vollständiger KE-Importer/Routinggraph, SECON-Verschlüsselung, produktiver Transport und Originalquittungsprüfung sind noch zu bauen und abzunehmen. Ein geöffneter Link, ein Zertifikat oder eine SMTP-Annahme allein macht sie nicht versandbereit.

Die Recherche unten liefert konkrete Anlaufstellen. Es wurden keine Anfragen gesendet und keine Anmeldungen durchgeführt. Telefonnummern/E-Mail-Adressen stammen aus öffentlichen Primärquellen und sind ausschließlich zur fachlichen Klärung dokumentiert. Sie werden nicht in einen aktiven Transportadapter übernommen. Ohne bestätigte IK-/Leistungsbereichszuordnung wird keiner dieser Wege als für eine konkrete Forderung zuständig behandelt.

## 1. Was vor einer Anfrage gesammelt wird

Im privaten Betriebsordner: bestätigte eigene Teilnehmeridentität und IK, tatsächliche Vertragsfassung, AC/TK/Leistungsgruppe, gewünschte Kassen/Leistungsbereiche, zuständige Verfahrensversion und ausschließlich synthetische Testfälle. Keine Patientenliste oder Schlüssel im E-Mail-Erstkontakt. Die Original-Beispielrechnung darf keine neue Empfängerzuordnung begründen. Private Schlüssel bleiben lokal im späteren geschützten Schlüsselmanagement.

Es gibt zwei getrennte Aufgaben: Der Inhaber bestätigt Berechtigung und Teilnehmerangaben; die Entwicklung implementiert die veröffentlichten und schriftlich bestätigten technischen Parameter. Eine Kasse kann keine Softwarefunktion nachrüsten, und die Software darf keine fehlende Berechtigung erfinden.

## 2. Tatsächlich recherchierte Anlaufstellen und Grenzen

| Annahmestelle / Primärquelle | Öffentlicher Klärungskanal und belegter technischer Ansatz | Was konkret noch zu bestätigen ist |
|---|---|---|
| [GKV SLE](https://www.gkv-datenaustausch.de/leistungserbringer/sonstige_leistungserbringer/sonstige_leistungserbringer.jsp) | Technische Anlagen und KE-Dateien; versionsabhängige Verfahren | Normative TA-/Anhangfassung, vollständige Originaldateien, Referenz-/Prüfsätze |
| [gkv informatik](https://www.gkvi.de/leistungen-services) | Leistungserbringerkontakt `da_le@gkvi.de`; Seite veröffentlicht DTA-E-Mail `da@dta.aok.de` und Fehlerrückmeldungen per E-Mail | Konkrete AOK/Leistungsgruppe; AOKNord West wird auf der Seite je Sammelgruppenschlüssel unterschiedlich zugeordnet. Richtige DAV, Entschlüsseler und Papierstelle aus gültiger KE bestätigen. Krankenhaus-§ 301-Kontakt nicht übernehmen |
| [ITSCare](https://itscare.de/Datenannahme.html) | `DAV-Team-Leistungserbringer@itscare.de`; DTA-E-Mail `da@dta.aok.de`; Seite nennt ITSG-PKCS#7-Zertifikat und AC/TK als Voraussetzung | Zuständigkeit für konkreten Vertrag/Leistungsbereich; AOK Hessen-Karte vs. Tabelle widersprechen sich beim logischen Empfänger. Schriftliche Klärung und KE-Abgleich zwingend. Aussage zu direktem Echtverfahren für bestimmte AOK gilt nicht als Taxi DTA-Freigabe |
| [BITMARCK / KKH](https://www.bitmarck.de/produkte/produkt-highlights/leistungserbringer) | Seite nennt für TP5 `le-ek@bitmarck-daten.de`; Klärung bei KKH `dlp-da@kkh.de` | Aktueller Geltungsbeginn und KKH-TP5-Teilnahme für die Software; Seite enthält unterschiedliche Umstellungsdaten. Papierzuständigkeit unterscheidet Leistungsbereiche. Kein Gruppenrouting aus dem Namen ableiten |
| [DAVASO/IQVIA](https://davaso.de/kundenservice/fuer-leistungserbringer-apotheken-aerzte/servicekontakte) | Öffentlicher Servicekontakt `info302@iqvia-hss.de` (zusätzlich `info302@davaso.de`); kassen-/leistungsbezogenes Verzeichnis und registrierungspflichtiger TA-Validator | Für konkrete Kasse/Leistungsgruppe maßgebliche Empfangsstelle, technische DTA-Adresse, Testverfahren, Rückkanal und Papierstelle. Servicekontakt ist keine DTA-Einreichadresse |
| [ITSG über GKVTrustCenter](https://www.gkv-datenaustausch.de/trustcenter/trustcenter.jsp) | Offizieller Verweis auf ITSG; [Registrierungsportal](https://registrierungsportal.itsg.de/regportal/client/de/login) auffindbar | Geeigneter Zertifikatstyp, Identitäts-/Teilnahmenachweis, Schlüsselerzeugung, Laufzeit, Sperrprüfung, aktuelle Gebühren und Verlängerung. Produktseite leitete beim Abruf auf Wartung um; keine aktuelle vollständige Klickanleitung behaupten |

Für alle weiteren Kassen/DAV ist zuerst der gültige KE-Pfad aufzulösen. Kein einzelner Empfänger steht für alle AOK/BKK/IKK/vdek. Die Tabelle enthält recherchierte Ansatzpunkte, kein vollständiges Freigabeverzeichnis.

## 3. Technische Umsetzung durch die Entwicklung

1. **Originale sichern:** Passende TA1/TA3 und Anhänge mit URL, Abrufzeit, Hash und Gültigkeitsdatum archivieren. Anhang 3 V09 vom 07.10.2026 gilt ab 01.06.2026, V10 ab 01.02.2027. Keine Aktivierung nach höherer Versionsnummer allein.
2. **KE-Importer bauen:** Service-/Nutzsegmente, Zählwerte, Gültigkeiten, VKG-Verknüpfungen, Region und Leistungsbereich nach Original prüfen. Nachweisbar trennen: Karten-, Kostenträger-, physische-, Entschlüsselungs-, Papier- und eigene IK.
3. **Nutz-/Auftragsdateien erzeugen:** Exakte Segment-/Feldformate, Zeichensatz, Dateinamen, Kontrollwerte und korrekte Summen nach gültiger TA. Offizielle synthetische Golden Files verwenden; Parser/Serializer-Roundtrip plus Negativtests. Ein Bereitschaftsbericht ist kein DTA.
4. **Krypto integrieren:** Vorgeschriebene SECON-Schnittstelle und etablierte Bibliotheken; eigenes Schlüsselmaterial geschützt serverseitig. Empfängerschlüssel aus maßgeblicher vertrauenswürdiger Quelle, IK/Kette/Laufzeit/Sperrstatus prüfen. Ein Weiterleiter darf nicht als Entschlüsselungsadressat angenommen werden.
5. **Freigegebenes Protokoll integrieren:** [Anhang 1](https://www.gkv-datenaustausch.de/media/dokumente/leistungserbringer_1/sonstige_leistungserbringer/technische_anlagen_aktuell_4/Anhang_1_Anlage_1_TP5_20170831.pdf) verweist ausdrücklich auf GGT/SECON und E-Mail bzw. HTTP(S); HTTP(S) benötigt bilaterale Vereinbarung. Empfängerparameter müssen genau für diesen§ 302-Fall bestätigt sein; keine erfundene REST-API.
6. **Antworten separat prüfen:** Transportantwort, technische Annahme und fachliche Verarbeitung sind getrennte Ereignisse. Originalbytes/Hash/ID/IK/Zeiten speichern; Zertifikats-/Signaturprüfung soweit vorgeschrieben. Falsche, doppelte oder nicht korrelierbare Antwort sperrt weitere automatische Entscheidungen.
7. **Doppelsendungen verhindern:** Unveränderliche Dateiversion, Idempotenz, Queue und Timeout-Zustände mit manueller Klärung. Nach unklarer Annahme nicht blind erneut senden.
8. **Papierprozess verknüpfen:** Offizieller Anlage 4-Begleitzettel je Gesamtrechnung, stabile Belegnummern, vollständige Packliste und separat geprüfte Anschrift. Versanddatum ist kein Zustellnachweis.

## 4. Nicht gesendetes Musteranschreiben

> Betreff: Einrichtung einer eigenen § 302-Abrechnung für Taxi-/Mietwagen-Krankenfahrten – Verfahrensklärung
>
> Guten Tag,
>
> wir entwickeln für unseren Betrieb eine eigene Abrechnungsanwendung „Taxi DTA“. Vor Einreichungen möchten wir das für unseren Vertrag und Leistungsbereich geltende Verfahren mit Ihnen abstimmen. Wir benötigen folgende Angaben bzw. die entsprechenden aktuellen offiziellen Unterlagen:
>
> 1. Welche Teilnehmeranmeldung, Vertrags-/AC-TK-Angaben und Software-/Verfahrensprüfung sind erforderlich?
> 2. Welche physische Annahmestelle, welcher entschlüsselungsberechtigte Empfänger und welche getrennte Papierstelle sind maßgeblich? Bitte nennen Sie die gültige Quelle und das Anwendungsdatum.
> 3. Welches Transportprotokoll und welcher Testkanal sind für eine eigene Software zulässig? Welche Dateinamen, Auftrags-/Nutzdateien, Zertifikate und Kommunikationsparameter werden benötigt?
> 4. Wie werden Empfängerzertifikate, Sperrstatus und Schlüsselwechsel veröffentlicht? Welche Freigabe ist für Test- und Echtbetrieb jeweils vorgesehen?
> 5. Welche Original-Transportantworten und fachlichen Rückmeldungen werden geliefert, wie werden sie korreliert und wie wird bei Timeout/Doppellieferung verfahren?
> 6. Gibt es synthetische Referenzdateien, einen Validator und einen dokumentierten Abnahmetest? Welche Dokumentation bestätigt das Ende der Erprobung?
>
> Wir senden zunächst keine Patienten-, Bank- oder privaten Schlüsseldaten. Bestätigte Unternehmens-/Teilnehmerangaben reichen wir auf dem von Ihnen vorgesehenen sicheren Weg nach.
>
> Mit freundlichen Grüßen
> Der Betriebsinhaber

Vor Verwendung: Kasse/Leistungsbereich privat ergänzen und tatsächlichen Zuständigkeitsnachweis prüfen. Dieses Dokument löst keinen Versand aus.

## 5. Testnachweis und echte Freigabe

Der Testplan muss Eingabedaten, erwarteten Dateihash, Routing-/Zertifikatsbeleg, genehmigten Testempfänger, tatsächlichen Übertragungszeitpunkt und unveränderte Originalantwort enthalten. Anschließend werden fachliches Ergebnis und Papierzuordnung geprüft. Bei Ablehnung wird die Ursache korrigiert und der neue Lauf eindeutig referenziert.

Vor realen Gesundheitsdaten zusätzlich: starke produktive Authentisierung/MFA, Datenschutzprüfung einschließlich Art 9-/AVV-/Transferfragen, sichere Betriebsumgebung/Region, Objekt- und Mandantenzugriffsschutz, nachgewiesenes Backup/Restore und unabhängiger Sicherheitsreview. Diese Punkte sind konkrete noch offene Arbeiten, keine derzeit erfüllten Eigenschaften. Eine menschliche Livefreigabe erfolgt erst am fertig implementierten und nachweisbar getesteten Verfahren.
