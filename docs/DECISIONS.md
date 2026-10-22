# Architekturentscheidungen

## ADR-001 · Lokal vor Cloud

**Entscheidung:** lokale React/Express/SQLite-Testversion mit ausschließlich synthetischen Daten. **Grund:** sofort prüfbare Finanzdatenflüsse ohne Gesundheitsdaten oder unbestätigte fachliche Cloudfreigabe. **Folge:** fachliche Daten und PDFs bleiben lokal. Supabase ergänzt inzwischen ausschließlich Inhaber-Anmeldung und begrenzten UUID-Verbindungstest. Eine spätere Finanz-/Dateimigration bleibt ein eigenes Arbeitspaket; Zielregion ist eu-central-1.

## ADR-002 · Nachweis vor Automatik

**Entscheidung:** unbekannte Tarif-, Steuer-, IK- oder Protokollkonstellationen blockieren. **Grund:** eine erfundene DTA-Datei oder Steuerannahme wäre fachlich schädlich. **Folge:** die DTA-Zentrale erzeugt Bereitschaftsberichte, keine Kassenannahme und keinen Liveversand. Format-/Routingkonformität erst nach Originalquellen und autorisiertem Test.

## ADR-003 · Cents, Snapshots und Originale

**Entscheidung:** ganze Centbeträge, serverseitige Neuberechnung, Rechnungssnapshot und archiviertes PDF mit Hash, Korrektur statt stillem Überschreiben. **Grund:** reproduzierbare Rundung und Nachvollziehbarkeit. **Folge:** lokale Hashes sind keine amtliche Signatur und kein GoBD-Testat. Zugriffsrechte/Archivanker sind im Produktionskonzept zusätzlich zu klären.

## ADR-004 · Verschlüsseltes Backup mit Wiederherstellungsnachweis

**Entscheidung:** SQLite Online-Snapshot, scrypt-Schlüsselableitung, AES-256-GCM mit authentifiziertem Formatheader. Passphrase interaktiv oder stdin, optional sichere Umgebung. Restore nur temporär und readonly prüfen. **Grund:** Schutz vor Offenlegung/Manipulation ohne aktive Daten zu überschreiben. **Folge:** Passphrase getrennt verwahren; verlorene Passphrase ist nicht rekonstruierbar, aktiver Datenträger und temporäre Dateien brauchen später vollwertige Verschlüsselung.

## ADR-005 · Supabase zunächst default-deny

**Entscheidung:** zwei eng begrenzte Einrichtungsmigrationen für eine administrative Inhaberbindung und UUID-Proben, keine Client-Tabellenrechte, RLS und feste RPC-Hüllen. Privilegierte Helfer verlangen Owner, AAL2, bestätigten/aktiven Benutzer und eine passende aktive Sitzung. **Grund:** keine versehentliche Freigabe oder beliebige Cloud-Datenübernahme. **Folge:** Region Frankfurt, Bindung, angewendete Migrationen und negative SQL-Rollenfälle sind nachgewiesen. Die allgemeine Finanzskizze liegt unausgeführt in `docs/drafts/`. Private Storage-Dateien, Finanztransaktionen und deren Isolation bleiben offen.

## ADR-006 · Serverseitige Inhaber-Anmeldung

**Entscheidung:** Passwort/TOTP über sitzungsweise getrennte Supabase-SDK-Clients; Tokens nur im Serverprozess, zufällige HttpOnly-Kennung im Browser. Bei `TAXIDTA_AUTH_REQUIRED=true` gilt Owner/AAL2/aktive Sitzung vor jeder fachlichen API einschließlich PDF/Export. **Grund:** dieselbe Zugriffskontrolle für Oberfläche und direkte API-Aufrufe. **Folge:** Netzwerk- oder Authfehler öffnen keinen Demo-Ersatzpfad. Der persönliche Live-Login steht wegen des blockierten SDK-Netzwerkpfads und der vom Inhaber selbst vorzunehmenden Eingaben noch aus. Wiederherstellung, Passkeys und öffentlicher HTTPS-Betrieb sind nicht abgenommen.
