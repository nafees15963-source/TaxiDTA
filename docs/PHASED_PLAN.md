# Liefer- und Freigabeplan

Stand: 22.10.2026. Keine Phase erhält den Status „produktiv“, nur weil ihre Oberfläche vorhanden ist.

| Phase | Ergebnis | Abnahmekriterium | Status dieser Runde |
| --- | --- | --- | --- |
| A – Lokales Fundament | Quellenregister, Bedrohungsmodell, laufender Demo-Server, synthetische Daten, reproduzierbare Installation | Lokaler Start, API-Schutz, Build und Tests dokumentiert | Implementierung; Endergebnis siehe `ACCEPTANCE.md` |
| B1 – Normale Fakturierung | Kunden, Fahrten, Einzel-/Sammelrechnung, Steuergruppen, Original-PDF, Zahlungen, Storno | Backend-/Browserdurchlauf mit gespeicherten Originalen | Demo-Umfang implementiert; keine Rechts-/Produktionsfreigabe |
| B2 – Krankenfahrten | Belegte Basis-Art.-I/II-Regeln, Quellenanzeige, Sperren | Goldentests 52,59 €/51,74 €, Grenzen, negative Fälle | Enger Testumfang; Muster 4 und vollständiges Vertragsmodell offen |
| C1 – DTA-Vorprüfung | Persistierter Bereitschaftsbericht und fehlende Nachweise | Kein echter Transport möglich; keine Fake-Annahme | Implementierung als Sperrprüfung |
| C2 – Echte Formate | Aktuelle TA/Anhänge und KE-Dateien, versionierte Parser/Serializer, offizieller Dateikorpus | Normative Golden-/Roundtrip-/Negativtests je Version | Primärseiten/PDF-Inhalte recherchiert; begrenzter V09-KOTR-Strukturleser/Serializer mit synthetischen Tests vorhanden. Vollständiger KE-Import, amtlicher Dateikorpus und Abrechnungsformate offen |
| D1 – Sicheres Staging | Supabase Frankfurt, Einzelnutzer-Auth mit MFA/Passkeys, private Dateien, Wiederherstellung | RLS-/MFA-/Recovery-/BOLA-Tests, AVV-/Datenschutzprüfung | Inhaber-/TOTP-Code und begrenzte Cloud-RPCs integriert; Frankfurt, Bindung und SQL-Negativfälle live geprüft. Persönlicher Login/positiver UUID-Test, Passkeys, Recovery, private Dateien und Freigabe offen |
| D2 – DTA-Testbetrieb | Teilnahme, richtige IK-Rollen, Zertifikate, real erlaubter Transport | Autorisierte Testübertragung und archivierte Originalquittung | Gesperrt |
| D3 – Produktivfreigabe | Betriebsdokumente, Datenschutz, unabhängiger Sicherheitsreview, Support/Incident-Prozess | Dokumentierte Freigaben, keine offenen harten Sperren | Gesperrt |
| E – Weitere Verbesserungen | Priorisierte kleine Funktionen mit messbarem Nutzen | Eigene Tests; keine Umgehung von Fachsperren | Ideen in `PRODUCT_IDEAS.md`; Auswahl laufend |

## Nächste sinnvolle Arbeitspakete

1. Die lokale Faktura an zusätzlichen synthetischen Alltagsszenarien erproben: gemischte Steuersätze, lange Sammelrechnungen, Teilzahlungen, falsche Eingaben und Storno.
2. Die bereits recherchierten GKV-/KBV-/Steuerquellen aus `RESEARCH_LOG.md` vervollständigen und als unveränderte Originale privat archivieren; Quellenstände, Wirksamkeit und Prüfsummen nachweisen.
3. §302-Formatadapter erst aus diesen tatsächlichen Originalen entwickeln. Ein Bereitschaftsbericht wird nicht nachträglich in eine „DTA-Datei“ umbenannt.
4. Den implementierten Inhaber-/TOTP-Ablauf am echten Konto persönlich prüfen, nachdem der erlaubte Netzwerkpfad zur Projektadresse verfügbar ist: Passwort, QR, falscher/richtiger Code, erneute Anmeldung und UUID-Test. Anschließend Recovery und WebAuthn ergänzen. Bis zur Abnahme keine echten Gesundheitsdaten.
5. Die bereits bestätigte Supabase-Region `eu-central-1` um die Prüfung sämtlicher Datenflüsse ergänzen. Projektweite Registrierung und Passwortschutz kontrollieren; private Dateien, Logs, Backups und AVV/Transfers bleiben eigene Nachweise. Region allein ersetzt keine Datenschutzfreigabe.
6. Eigene rechtmäßig bereitgestellte Rechnungsvorlagen aufnehmen und mit mehrseitigen Ausgaben vergleichen. Gesetzliche Rechnungsinhalte fachkundig prüfen.
7. Erst nach nachgewiesenem Routing und autorisiertem Ende-zu-Ende-Test den produktiven DTA-Transport implementieren und gesondert freigeben.

## Was der Inhaber zunächst tun kann

Die offene synthetische Demo braucht kein Konto. Das bereits bestätigte und gebundene Inhaberkonto kann für die konfigurierte Anmeldung genutzt werden; Passwort und Authenticator-Code ausschließlich in der lokalen Anwendung eingeben. Für die spätere Fachabnahme werden aktuelle vollständige Vertragsanlagen, der Nachweis der eigenen Vertragsberechtigung und eigene PDF-Vorlagen benötigt. Zugangsdaten, private Schlüssel und echte Krankenbelege gehören in den später eingerichteten geschützten Import-/Secret-Prozess, nicht in Chat, Git oder Testdaten.
