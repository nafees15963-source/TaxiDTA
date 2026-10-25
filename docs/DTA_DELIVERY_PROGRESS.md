# DTA-Versand: überprüfbarer Implementierungsstand

Stand: 23.10.2026. Diese Dokumentation beschreibt den Quellcode und die lokalen Prüfungen. Sie bestätigt weder einen Versand an eine Annahmestelle noch eine dortige Annahme.

## Vorhandene Bausteine

| Baustein | Implementierung | Nachweis und Grenze |
| --- | --- | --- |
| Dateinamen | `src/domain/dta/filenames.ts` | Logische/physische Dateinamen und Test-/Echtkennungen werden geprüft. Ein gültiger Name erzeugt keine Versandberechtigung. |
| Auftragsdatei | `src/domain/dta/order-file.ts` | Lokale Prüfung eines 348-Byte-Auftragssatzes; unterstützte Felder liegen in Bytes 1–210. Bytes 211–348 und das vollständige Fachprofil sind ausdrücklich nicht freigegeben. |
| Zertifikate | `server/dta/certificates.ts` | PEM, Gültigkeit, IK im Subject, RSA-Schlüssel und Schlüsselzuordnung; lokale Kettenprüfung gegen ausdrücklich übergebene Anker, optional mit CRL. Keine automatische Übernahme der offiziellen Vertrauensanker und keine vollständige GGT16-Profilprüfung. |
| Kryptografie | `server/dta/secon-crypto.ts` | Lokales CMS SignedData in EnvelopedData mit SHA-256, RSA-PSS, RSA-OAEP und AES-256-CBC. Tests prüfen Entschlüsselung, Signatur und Parameter mit synthetischen Zertifikaten. Kein Konformitäts- oder Annahmestellentest. |
| Exportmanifest | `server/dta/export-manifest.ts` | Prüfsummen und Dateipaarzuordnung für eine lokale Testablage. Kein Transportbeleg. |
| Statusprüfung | `server/dta/status.ts`, `src/domain/dta/status.ts` | Ein Status nach dem Versand benötigt authentifizierte, archivierte Originalnachweise eines serverseitig registrierten Adapters. Standardmäßig ist kein solcher Adapter eingerichtet. |
| Statusanzeige | `src/DtaStatusPanel.tsx` | Getrennte Anzeige von Übertragung, Empfängerrückmeldung, Verfahren und offenen Punkten. Historie zeigt nur geprüfte Nachweise. Es gibt keinen manuellen Schalter für „versendet“ oder „angenommen“. |

Die Kryptomodule benötigen Node.js und das ausführbare Programm `openssl`. Sie sind kein direkt in einem Cloudflare Worker ausführbarer Versanddienst. Aufrufparameter und Nutzdaten werden vor dem ersten asynchronen Schritt kopiert, damit nachträgliche Änderungen an fremden Puffern nicht die geprüften oder verwendeten Bytes austauschen können. Temporäre private Schlüssel sind ausschließlich verschlüsseltes PKCS#8; zufällige Passwörter und Nutzdaten werden über Pipes übergeben. Eigene temporäre Puffer werden anschließend überschrieben. Das ist keine Zusicherung vollständiger Löschung aller Speicher- oder Betriebssystemkopien.

## Bedeutung der Statuswerte

Ohne Originalnachweis bleibt die Rechnung **Nicht versendet** (`sendState: not_sent`). Eine erfolgreiche Vorprüfung ändert dies nicht. `canSend` und `productionReady` bleiben in dieser Implementierung `false`.

Ein späterer Adapter kann ausschließlich nach Authentifizierung und eindeutiger Zuordnung der Originalbytes folgende Folge belegen:

`queued → sending → transmitted → receipt_received → accepted | rejected`

Eine klassifizierte Originalquittung darf nach `transmitted` unmittelbar `accepted` oder `rejected` bestätigen. „Übertragen“ bestätigt noch keine fachliche Annahme. Eine positive Testquittung erscheint ausdrücklich als **Testannahme bestätigt**. HTTP 200, ein Vorprüfungsbericht, manuelle Eingaben und JSON-Felder wie `accepted: true` gelten nicht als Empfängerquittung.

Nachweise werden an Rechnungs-ID, Hash des Rechnungsoriginals und Übertragungs-ID gebunden. Test- und Echtverfahren werden nicht vermischt. Identische Wiederholungen sind idempotent; veränderte Ereigniskennungen, widersprüchliche Reihenfolgen und eine Umkehr terminaler Ergebnisse werden abgewiesen. Der Prüfer liest einen einzelnen Übertragungsvorgang; mehrere Wiederholungsversuche brauchen künftig eine getrennte persistierte Vorgangshistorie. Der Prüfer selbst schreibt keine Ereignisse und führt keinen Versand aus.

## Vor dem ersten echten Versand noch umzusetzen

1. Vollständige, versionierte §302-TA-Nutzdatenserialisierung und fachliche Prüfung für die tatsächlich verwendeten Abrechnungen, einschließlich Korrekturen, Stornos und aller Pflichtfelder.
2. Vollständige Auftragsdatei und Bytekodierung für das gewählte Verfahren; vorhandene Teilprüfung ist dafür kein Ersatz.
3. Sicherer Import des tatsächlich nutzbaren Absenderschlüssels für die konfigurierte Absender-IK, passende Zertifikate, vollständige Zertifikatsprofile und verifizierte, aktuelle Vertrauens-/Sperrinformationen. Frühere Nutzung eines Abrechnungsdienstes beweist nicht, dass dessen Schlüssel in TaxiDTA verfügbar ist.
4. Aktuelle, verfahrensbezogene Kostenträgerdatei mit der richtigen Datenannahmestelle, Empfänger-IK und deren gültigem Verschlüsselungszertifikat. Ein Namens-/IK-Verzeichnis allein liefert diese Zuordnung nicht; Privatversicherungen teilen nicht automatisch das §302-GKV-Verfahren.
5. Implementierter Transport für die betreffende Annahmestelle nach dem vorgesehenen Verfahren, einschließlich nötiger Abstimmung, Wiederholungen und eindeutigem Sendeauftrag. Eine beliebige Webadresse oder ein eigener REST-Endpunkt ersetzt dieses Protokoll nicht.
6. Dauerhafte, unveränderliche Ablage der Originaldateien und Transport-/Empfängerbelege mit Prüfsumme und Zuordnung; ein realer Protokolladapter zur Authentifizierung und fachlichen Klassifizierung der Rückmeldungen.
7. End-to-End-Test mit der betreffenden Annahmestelle und dokumentiertem Ergebnis. Nur echte Belege dürfen anschließend die Anzeige verändern.

Eine zusätzliche Anmeldung wird nicht pauschal für sämtliche Kassen verlangt. Die aktuelle GKV-Broschüre nennt unter anderem für AOK und Ersatzkassen grundsätzlich keine Anmeldung; besondere Anforderungen werden je Kassenart und Verfahren geprüft. Technisch fehlende Bestandteile des Programms bleiben davon getrennte offene Punkte.

## Lokale Prüfung

```sh
npx tsx --test tests/dta-status.test.ts tests/dta-delivery.test.ts tests/dta-order.test.ts
npx tsc --noEmit
```

Die gezielte DTA-Suite umfasst 22 erfolgreiche Tests: 11 bisherige Datei-/Kryptotests, 9 Statusprüfungen und 2 Regressionstests für Änderungen an Eingaben während asynchroner Kryptoprüfungen. Die Status-Tests benutzen einen eigens definierten HMAC-Testadapter. Dieser ist ein synthetischer Testnachweis und implementiert kein produktives Annahmestellenprotokoll. Es wurden keine Patientenabrechnungen verschickt und keine echten Empfangsquittungen erzeugt.

## Offizielle Grundlagen

- [GKV: Technische Standards](https://www.gkv-datenaustausch.de/technische_standards_1/technische_standards.jsp), abgerufen 23.10.2026.
- [Anlage 16 GGT: Security Schnittstelle](https://www.gkv-datenaustausch.de/media/dokumente/standards_und_normen/technische_spezifikationen/Anlage_16_-_Security_Schnittstelle.pdf), Stand 02.09.2025, gültig ab 01.01.2026. Grundlage des begrenzten lokalen Kryptoprofils; vollständiges Dokument geht deutlich darüber hinaus.
- [Anlage 2 GGT: Auftragsdatei](https://gkv-datenaustausch.de/media/dokumente/standards_und_normen/technische_spezifikationen/Anlage_2_-_Auftragsdatei.pdf). Grundlage des Auftragssatzes.
- [§302, Anhang 1 zu Anlage 1 TP5](https://www.gkv-datenaustausch.de/media/dokumente/leistungserbringer_1/sonstige_leistungserbringer/technische_anlagen_aktuell_4/Anhang_1_Anlage_1_TP5_20170831.pdf), Stand 31.08.2017. Verweist für den Transport auf die einschlägigen GGT-Anlagen, unter anderem E-Mail und HTTP(S).
- [GKV-Broschüre TP5](https://www.gkv-datenaustausch.de/media/dokumente/leistungserbringer_1/sonstige_leistungserbringer/20260915_Broschuere_TP5.pdf), Stand 15.09.2026, insbesondere AOK Seite 17 und Ersatzkassen Seite 32. Aktuelle Kostenträgerdateien bleiben für Annahmestellen und Routing maßgeblich.
