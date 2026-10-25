# Hosting-Entscheidung, 22.10.2026

Für den jetzt beauftragten Internet-Testbetrieb wird die Anwendung als inhaberprivate Sites-HTTPS-App mit der plattformeigenen ChatGPT-Anmeldung und D1-Persistenz veröffentlicht. Dieser Teilumfang erlaubt ausschließlich erfundene Daten. Die ChatGPT-Identität ersetzt keinen Nachweis von Supabase-TOTP, Kassenfreigaben oder einer Gesundheitsdatenfreigabe. Der Standort der Sites-Worker/D1-Datenverarbeitung ist nicht als Frankfurt bestätigt.

## Warum ein eigener Cloud-Adapter nötig ist

Der lokale Express-Server verwendet `node:sqlite`, synchrone Dateioperationen und pro Prozess gespeicherte Authentifizierungssitzungen. Cloudflare führt `node:sqlite` ausdrücklich als nicht funktionsfähigen Stub. Ein importierbares Modul ist hier keine ausführbare Datenbank. Das Worker-Dateisystem bietet ein lesbares Bundle und flüchtigen, an eine Anfrage gebundenen `/tmp`-Speicher; es bewahrt keine SQLite-Datei über Anfragen oder Veröffentlichungen hinweg.

Node-HTTP und Express lassen sich grundsätzlich über `cloudflare:node` weiterverwenden. Das würde jedoch weder den Store noch die lokalen Host-/Origin-Prüfungen, PDF-Schriftpfade oder Sitzungstabellen portieren. Außerdem muss der Sites/Vinext-Worker-Einstieg mit seiner Anmeldeintegration erhalten bleiben. Für diese Veröffentlichung ist ein schmaler Vinext-API-Adapter um reine Geschäftslogik daher kleiner und überprüfbarer als ein unverändert gestarteter Express-Prozess.

## Beauftragter synthetischer Cloud-Store

`hosted/cloud-store.ts` stellt die bisherigen Zustands- und Rechnungsfunktionen mit einem asynchronen Repository bereit. Der D1-Adapter gehört zum Sites-Checkout. Er speichert je serverseitig bestimmter Sites-Benutzer-ID genau einen begrenzten JSON-Zustand und dessen Revision. Neue Datensätze entstehen mit `INSERT … ON CONFLICT DO NOTHING`; Änderungen erfolgen ausschließlich mit `UPDATE … WHERE revision = ?`. Ein fehlgeschlagener Vergleich führt zu HTTP 409; er wird nicht als Speicherung bestätigt und nicht blind wiederholt.

Abrechnungsfälle verwenden dieselben reinen Validierungs-, Tarif-, Cent-/Steuer- und Fallbildungsfunktionen wie die lokale App. Rechnungsnummern werden vor der PDF-Erzeugung dauerhaft reserviert; ein Fehler oder Konflikt verwendet die Nummer nicht erneut. Nach der PDF-Erzeugung schreibt eine weitere Revision den unveränderlichen Rechnungssnapshot, Original-PDF, Bindung aller Fahrten/Fälle und Audit-Eintrag gemeinsam. Ein zwischenzeitlich geänderter Zustand verhindert diesen Abschluss. Das PDF wird aus archivierten Originalbytes heruntergeladen. Zahlungen und Storno ändern diese Bytes nicht.

Die JSON-Grenze liegt unter dem D1-Wertlimit von 2 MB. Kleine PDFs werden zunächst als Base64 mit dem Zustand gespeichert, damit Finanzdatensatz und Archiv atomar dieselbe Revision besitzen. Der Store meldet bei Erreichen der Grenze einen Fehler. Für größere Archive ist später ein privates R2-Objektarchiv mit Staging, Hashprüfung und Aufräumen verwaister Objekte nötig; ein R2-Upload und ein Datenbankabschluss bilden keine gemeinsame Transaktion.

Der Benutzer-Scope stammt ausschließlich aus der vertrauenswürdigen Sites-Anfrageidentität. Eine Browser-`ownerId` ist keine Berechtigung. Die private Sites-Zugriffseinstellung und ein zusätzlicher serverseitiger Inhaberabgleich schützen alle API- und PDF-Routen. Schreibzugriffe brauchen zusätzlich passende Origin-/CSRF-Prüfungen. Nicht implementierte Funktionen müssen Fehler melden; ein Prüfbericht bestätigt keinen DTA-Versand.

## Späterer Betrieb mit Supabase und MFA

Für einen Betrieb mit echten Daten ist die bereits ausdrücklich gewählte Supabase-Region Frankfurt ein möglicher dauerhafter Finanzspeicher. Dieser Wechsel erfordert neue, geprüfte Postgres-Tabellen und transaktionale RPCs; die vorhandenen Supabase-Migrationen enthalten ausschließlich den synthetischen Verbindungsnachweis. Ein SDK-Client oder eine erreichbare URL migriert keine Rechnungsdaten.

Supabase kann aus Workers über HTTPS angesprochen werden. Jede Finanzfunktion muss die administrativ gebundene Inhaber-UUID, bestätigte aktive Anmeldung, AAL2 und eine bestehende, nicht abgelaufene Auth-Sitzung prüfen. Privilegierte Helfer gehören in ein dafür vorgesehenes privates Schema; öffentliche RPC-Hüllen brauchen minimale Ausführungsrechte. Die plattformeigene Sites-Anmeldung und ihre reservierten Routen bleiben erhalten. Eine zusätzliche Supabase-Anmeldung ist eine gesonderte Datenfreigabe, kein Ersatz für den Sites-Zugriffsschutz.

Die vorhandene lokale `Map` mit Supabase-Zugangs-/Refresh-Token und Warteschlangen funktioniert nicht als dauerhafte, zwischen Worker-Instanzen gemeinsame Sitzung. Ein Hosted-MFA-Port braucht entweder serverseitig verschlüsselte persistente Sitzungen mit undurchsichtigem HTTPOnly/Secure-Cookie, Revision und instanzübergreifendem Refresh-Lock oder ein ausdrücklich geprüftes verschlüsseltes Cookie-Verfahren. Tokens dürfen weder in einen frei lesbaren Zustand noch in den Browser-Speicher gelangen. Die ursprüngliche Finanzsicherung darf nicht mit einem bloßen Cookie-Phasenflag nachgebildet werden.

## Prüfumfang und Grenzen

Vor dem Hosted-Erfolg sind mindestens echte D1-Speicherung über Anfragen/Neustarts, konkurrierende Revisionen, doppelte Rechnungs-/Zahlungsbefehle, Konflikte während PDF-Erzeugung, Originalhashes und PDF-Mehrseitenlayout sowie anonyme/fremde Zugriffsversuche zu prüfen. Node-Unit-Tests ersetzen weder einen Worker-Lauf noch einen persönlichen positiven Supabase-TOTP-Test.

Die Internet-Testversion bleibt ausdrücklich synthetisch. HTTPS, private Anmeldung und eine einzelne Datenbankregion bestätigen weder alle Verarbeitungsstandorte noch Datenschutz-, Kassen-, Steuer-, Vertrags- oder Versandfreigaben. Ein vollständiger DTA-Versand wird dadurch nicht aktiviert.

## Quellen

- Sites: [Skill](skill://plugin_connector_1p_689987207de08191979cf68eca2941c6/sites/SKILL.md), [Speichervertrag](skill://plugin_connector_1p_689987207de08191979cf68eca2941c6/sites/references/storage.md), [Vinext-Starter](skill://plugin_connector_1p_689987207de08191979cf68eca2941c6/sites/templates/vinext-starter/README.md). Starter/`sites()`-Integration und native Anmeldung erhalten; D1 für strukturierte Daten, R2 für Dateien, Migrationen außerhalb von Request-Handlern.
- Cloudflare: [Node-Kompatibilität und nicht funktionsfähige Stubs](https://developers.cloudflare.com/workers/runtime-apis/nodejs/), [flüchtiges Dateisystem](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/), [HTTP-Adapter](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http/).
- D1: [Worker-API und Batch](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Wert-/BLOB-Limit](https://developers.cloudflare.com/d1/platform/limits/), [Datenstandort](https://developers.cloudflare.com/d1/configuration/data-location/). Die Sites-Bindung allein bestätigt keine Jurisdiktion.
- Supabase: [Workers-Anbindung](https://developers.cloudflare.com/workers/databases/third-party-integrations/supabase/), [Datenbankfunktionen/RPC](https://supabase.com/docs/guides/database/functions), [API-Berechtigungen und RLS](https://supabase.com/docs/guides/api/securing-your-api), [Changelog](https://supabase.com/changelog).

Stand: Architekturentscheidung und isolierter Adapter in Arbeit. Hosted-Persistenz, Deployment und dessen Zugriffsprüfung werden vom veröffentlichenden Hauptagenten separat nachgewiesen.
