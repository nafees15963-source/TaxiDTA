# Wettbewerbsvergleich mit belegten Grenzen

Stand: 22.10.2026. Verglichen werden öffentliche/übergebene Aussagen, keine nicht zugänglichen internen Produktfunktionen. „Offen“ bedeutet fehlenden Nachweis, nicht, dass ein Wettbewerber eine Funktion nicht besitzt. Es werden keine fremden Logos oder Oberflächen kopiert.

## Belastbare Quellen

- U06 `TARIS_Flyer.pdf`, Ausgabe April 2009: S. 2 beschreibt modularen Aufbau und damalige Zertifizierungsaussage; S. 3 Krankenfahrten-DTA, Stammdaten, Einzel-/Serienfahrten und mobile Disposition; S. 4 Fuhrpark/Fahrerdaten und Fristen. Dies ist historische Herstellerwerbung, kein heutiger Zertifizierungsbeweis.
- U05 `opta_data_Kooperationsvertrag.pdf`: Rahmenvertrag mit Verbands-/Einzelvertragsvoraussetzungen; historisch 2008. Aussage über damaliges Kooperationsmodell, keine Preisempfehlung 2026.
- U03 Musterrechnung: nur anonymisierte Felderstruktur, keine vollständige Wettbewerbsanalyse von DMRZ. Keine Benutzeroberflächen/Screenshots als separate Dateien geliefert.
- R14 DAVASO/IQVIA: aktuelles öffentliches Portal beschreibt Rechnungstatus, Absetzungen, Nachreichung und TA-Validator. Ein solches Angebot ist keine Freigabe unserer Software.

| Funktion / Quellenbezug | Taxi DTA dieser Iteration | Sinnvolle Verbesserung | Aufwand / Risiko / Priorität |
|---|---|---|---|
| Krankenfahrten-DTA, TARISU06S. 3 | Bereitstellungsprüfung, Versand gesperrt | Vollständige belegte TA-/Krypto-/Routingpipeline | hoch / hoch / P 0 |
| Private/Firmenabrechnung, TARISU06S. 2 | Gemeinsamer Fahrten-/Rechnungskern | Einfache getrennte Abrechnungswege ohne Patientenpflicht | mittel / niedrig / P 0 |
| Stammdaten, TARISU06S. 3 | Synthetisches Kundenregister | Kontextabhängige Felder, keine Gesundheitsdetails bei Labor | niedrig / niedrig / P 0 |
| Serienfahrten, TARISU06S. 3 | Einzel-/Sammelrechnung abgeschlossener Fahrten | Vorschau, Ausnahmen und Dublettenschutz vor Serienanlage | mittel / mittel / P 1 |
| Mobile Disposition/Fuhrpark, TARISU06S. 3/4 | Noch nicht implementiert | Erst nach stabilem DTA- und Finanzkern | hoch / Datenschutz / P 3 |
| Sichtbare Rechnung-/Positionswerte, DMRZU03 | Erklärte Tarif- und Steuerpositionen | Jede Regel mit Quelle und fehlender Voraussetzung | mittel / finanziell / P 0 |
| Belege/Empfänger, U03/U04 | Getrennte Bereitschaftshürden | Vollständige belegte Papierpackliste mit Anlage 4 | mittel / hoch bei falschem Empfänger / P 1 |
| Outsourcing/Konditionen, opta U05 | Keine Vermittlung/keine Vertragsautomatik | Berechtigungs-/Kostenvergleich aus aktuellem Einzelangebot | niedrig / Vertragsrisiko / P 2 |
| Status/Nachreichung, DAVASOR14 | Lokale Rechnungen/Zahlungen getrennt von DTA | Originalquittung und fachliche Entscheidung als eigene Achsen | hoch / hoch / P 0 |
| Syntaktische/fachliche Validierung, DAVASOR14 | Domain-/API-Regressionen | Offizieller TA-Validator gegen reale synthetische Referenzdateien | hoch / hoch / P 0 |
| E-Rechnung | Offen, kein vollständiger Wettbewerbsnachweis | EN 16931-validierter Export erst mit Validator | hoch / rechtlich / P 1 |
| TOTP/Passkeys | Aktueller Wettbewerbsvergleich nicht belegt | Produktionsauthentisierung mit Recovery und Nachweis | hoch / sehrhoch / P 0 |

Taxi DTA darf sich erst dann als funktional überlegen bezeichnen, wenn gleichartige Aufgaben mit dokumentierten Daten, Erfolgsraten, Bearbeitungszeiten und Fehlerquoten verglichen wurden. Diese Iteration baut nachvollziehbare Verbesserungen; sie behauptet weder Einzigartigkeit noch Marktführerschaft. Aktuelle Angebote und Sicherheits-/Zertifizierungsnachweise der Hersteller sind vor einer Migrationsentscheidung neu einzuholen.
