# Risikoregister

Stand 22.10.2026. Freigabeinhaber ist der Betreiber; fehlende fachliche Nachweise werden nicht durch einen UI-Schalter ersetzt.

| ID | Risiko | Einstufung | Maßnahme / aktuelle Entscheidung |
|---|---|---|---|
| R01 | Echte Gesundheitsdaten in ungesicherter Demo | kritisch | Nur synthetische Daten; kein Produktionsbetrieb |
| R02 | Fehlende aktuelle §302-TA/KE-Nachweise | kritisch | Kein DTA-Serializer/Transport als konform bezeichnen; Versand gesperrt |
| R03 | Physischer Empfänger mit Entschlüsselungs-IK verwechselt | kritisch | Getrennte Rollen; unbestätigte Zuordnung blockiert |
| R04 | MFA-/Recovery-Bypass | hoch | Owner-/TOTP-Code und Negativtests umgesetzt; persönlicher Liveablauf und Recovery offen |
| R05 | Ungeprüfte Steuer-/Vertragsausnahme | hoch | Nur dokumentierte Rechenfälle, andere Fälle blockieren |
| R06 | Doppelrechnung / Nummernkollision | hoch | Datenbanktransaktion, eindeutige Fahrtzuordnung, Negativtests |
| R07 | Geänderte Originalrechnung | hoch | Eingefrorenes PDF/Hash; Korrekturbezug; SQLite-Besitzer bleibt privilegiert |
| R08 | Falsche Cloud-/Backupregion oder Drittlandzugriff | hoch | Auth-/UUID-Cloudanbindung begrenzt; Frankfurt bestätigt, weitere Datenflüsse vor echtem Betrieb prüfen |
| R09 | Lokal lesbare Datenbank / Browser ohne Login | hoch | Ausschließlich Testdaten; Anmeldepflicht schützt APIs, aktive lokale DB braucht später Datenträgerverschlüsselung |
| R10 | Verlorenes oder manipuliertes Backup | hoch | AES-GCM, Passphrase separat, Restore testen, externe sichere Kopie organisatorisch nötig |
| R11 | Gesetzes-/Tarifänderung nach 2026 | hoch | Datierte Regeln, unbekannte Zeiträume blockieren; aktuelle Originalquellen fehlen |
| R12 | Schadcode in PDF/Datei | hoch | Kein allgemeiner Upload; spätere Quarantäne/Scanner/Parsertrennung |
| R13 | Advisory in Abhängigkeit | mittel–hoch | Lockfile, CI, npm audit separat; Aktualisierung und Retest |
| R14 | Hashkette wird vollständig umgeschrieben | hoch | Lokaler Hash nur Manipulationserkennung innerhalb vorhandener Referenz; externer Anker offen |
| R15 | E-Rechnung mit gewöhnlichem PDF verwechselt | hoch | PDF ist Test-PDF; kein EN16931-/XRechnung-Konformitätsversprechen |
| R16 | Arzt-/Labortransport sammelt unnötige Gesundheitsdaten | hoch | Kein Proben-/Diagnosefeld, nur betriebliche Leistung |
| R17 | Lokale Schadsoftware greift Loopback an | hoch | Loopback/CSRF allein genügen nicht für Echtdaten; Demo bleibt Testbetrieb |
| R18 | Sicherheits-/Produktionsstatus wird missverstanden | hoch | Sichtbare Demo- und Sperrhinweise; ehrliche Statusdokumentation |

Offene Risiken werden vor jedem späteren Release erneut bewertet. Aktuell besteht **keine Freigabe für reale Gesundheitsdaten, produktive Rechnungen oder DTA-Versand**.
