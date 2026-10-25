# DMRZ-Anbindung: belegter Weg und fehlende Voraussetzungen

Recherche: 25.10.2026. Keine DMRZ-Anbindung eingerichtet, keine Nachricht verschickt und keine Abrechnung übermittelt.

Die offiziellen Seiten https://www.dmrz.de/abrechnung/schnittstellen und https://www.dmrz.de/wissen/ratgeber/die-online-schnittstelle-fuer-ihre-software-zur-dta-abrechnung belegen die Übergabe aus Branchensoftware, einschließlich Krankentransport. Sie veröffentlichen dort keine vollständige kontospezifische Feldbeschreibung, API-Authentisierung oder Statusschnittstelle. Die DMRZ-FAQ beschreibt Verschlüsselung und Versand als DMRZ-Leistung. Daraus folgt keine Exportierbarkeit der dort verwendeten privaten Schlüssel und keine Berechtigung einer anderen Anwendung, diese Schlüssel aufzurufen.

Für eine DMRZ-Übergabe fehlen die verbindliche Krankenfahrten-Schnittstellenbeschreibung mit Muster, der für das Konto freigeschaltete Importweg und das dokumentierte Prüfverfahren. Insbesondere nicht aus einem allgemeinen CSV-Importangebot ableiten: Feldreihenfolge, Versicherungsdaten, Rechnungsidentität, Import-Idempotenz, Stornoverfahren oder abrufbare Krankenkassenquittungen.

Nach Erhalt wird ein versionsgebundener Export-/Importadapter gegen die synthetische Musterdatei geprüft. Eine Dateiübergabe darf nur als Übergabe gelten. Versand und fachliche Annahme benötigen jeweils passende korrelierte Originalnachweise. Eine direkte API-Verbindung wird nur implementiert, wenn sie für dieses Verfahren tatsächlich dokumentiert und freigeschaltet ist.

Der separate direkte §302-Weg bleibt eine eigenständige Implementierung: vollständiger TA-Serializer, aktuelles KE-Routing, nutzbarer Absenderschlüssel und Empfängerzertifikate, konkretes Transportverfahren und Nachweisverarbeitung. Die aktuell vorhandenen lokalen Krypto- und Formatteilprüfungen erfüllen diesen Weg noch nicht. Die Ausarbeitung einer Schnittstellenanfrage behebt diese Implementierungslücken nicht.
