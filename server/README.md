# Lokaler Backend-Vertrag

Diese Version verarbeitet ausschließlich **erfundene Demodaten**. Sie bindet an `127.0.0.1`, verwendet keine externen Datenempfänger und implementiert keine Benutzeranmeldung. Das ist kein freigegebenes Gesundheitsdaten-System. TOTP, Passkeys, Supabase und echter DTA-Versand sind nicht angebunden.

`npm run dev` startet Express und Vite unter einer Adresse. `npm run build` und danach `npm start` verwenden das gebaute Frontend. Laufzeitdaten liegen standardmäßig unter `work/`; dieser Ordner wird nicht versioniert. `TAXIDTA_DB_PATH` wählt bei Bedarf einen getrennten privaten Datenbankpfad, etwa für isolierte Tests. Ein ausdrücklich übergebener Store hat Vorrang vor dieser Umgebungsvariable. SQLite speichert Kunden, Fahrten, unveränderliche Rechnungs-Snapshots, Original-PDFs, Zahlungen, DTA-Bereitschaftsberichte und die verkettete Ereignishistorie. Die lokale Demo-Datenbank ist nicht verschlüsselt; die separate Backup-Funktion verschlüsselt ihre Sicherung.

## API

Alle Endpunkte beginnen mit `/api/`. `GET /state` liefert den vollständigen Demo-Zustand einschließlich `csrfToken`; jede schreibende Anfrage benötigt diesen Wert im Header `X-CSRF-Token`, JSON-Inhalt und eine passende lokale Origin. Fremde Hostnamen, Origins und seitenübergreifende Anfragen werden abgewiesen. Diese Demo-Beschränkung ersetzt keine Produktionsauthentisierung.

| Methode | Pfad | Ergebnis |
|---|---|---|
| GET | `/health` | Laufzeitmodus, Audit-Integrität und ausdrückliche Versand-Sperre |
| GET | `/state` | Kunden, Fahrten, Rechnungen, Zahlungen, Bereitschaftsberichte und Ereignisse |
| POST | `/customers` | Fiktiven Kunden speichern |
| POST | `/journeys` | Fahrt speichern; Kassenpreis serverseitig neu berechnen |
| POST | `/journeys/:id/update` | Vollständigen Fahrtentwurf korrigieren; nach Rechnungsbindung gesperrt |
| POST | `/tariff` | Nachvollziehbare Art.-I-/II-Berechnung, keine Preisfreigabe |
| POST | `/invoices` | Aus gewählten Fahrten eine unveränderliche Testrechnung erzeugen |
| GET | `/invoices/:id/pdf` | Archivierte Originalbytes mit überprüftem SHA-256 |
| POST | `/invoices/:id/payments` | Bewusst bestätigten fiktiven Zahlungseingang buchen |
| POST | `/invoices/:id/cancel` | Separates negatives Stornodokument mit Originalbezug erstellen |
| POST | `/invoices/:id/dta-check` | Ausschließlich gesperrten Bereitschaftsbericht erzeugen |
| GET | `/invoices/:id/dta-check/report` | Bereitschaftsbericht als JSON; keine DTA-Nutzdatei |
| GET | `/export.csv` | Datenarmer Finanzexport ohne Kunden-/Gesundheitsangaben |

Fachliche Fehler verwenden HTTP 422, Konflikte 409, fehlende Objekte 404, fehlgeschlagene Zugriffsschutzprüfungen 403. Ausnahmeinformationen, SQL-Werte und Nutzerinhalte werden nicht ungefiltert protokolliert.

## Finanzielle Grenzen

- Der Geschäftstag ist für reproduzierbare Tests auf **22.10.2026** fixiert. Zukünftige Rechnungen und Zahlungen sind gesperrt; Leistungsdaten können vom Rechnungsdatum abweichen.
- Leistungsbeschreibungen dürfen höchstens 500 Zeichen und 20 explizite Zeilen enthalten. API und Rechnungskern lehnen überlange Beschreibungen mit einer verständlichen Meldung ab; gespeicherter Text wird nicht gekürzt.
- Alle Beträge sind ganze Centbeträge. Der Domain-Kern rechnet Distanzen und Zwischenwerte exakt mit Dezimal-/Ganzzahlarithmetik.
- Fahrtentwürfe können korrigiert werden. ID und Erstellungsdatum bleiben stabil; Preise und Dubletten werden erneut geprüft. Das Audit speichert nur die Namen geänderter Felder. Wird eine Fahrt während der PDF-Erstellung verändert, bricht die Rechnungserzeugung vor dem Commit ab.
- Eine Rechnung enthält ausschließlich Leistungen eines Empfängers. Einmal abgerechnete Fahrten bleiben gesperrt, auch nach Storno.
- `Idempotency-Key` auf Rechnungs- und Zahlungsanfragen verhindert Doppelbuchungen bei Wiederholung derselben Anfrage. Eine Kennung darf nur für denselben Inhalt erneut verwendet werden.
- Nummern werden unter einer SQLite-Schreibtransaktion reserviert. Eine nachfolgende fehlgeschlagene PDF-/Rechnungserzeugung darf eine dokumentierte Lücke erzeugen; die Nummer wird nicht wiederverwendet.
- Normale Testrechnungen erhalten 28 Kalendertage. `dueAtVerified:false` bei Krankenfahrten bedeutet: Das Datum ist nur eine **Demo-Wiedervorlage**, die vertragliche Kassenfrist ist ungeprüft. Es darf nicht als nachgewiesene Fälligkeit oder Überfälligkeit interpretiert werden.
- Zahlungen werden getrennt vom Original-Snapshot und PDF geführt. Teilzahlungen sind möglich; Überzahlungen, negative Zahlungen und Zahlungen auf Stornos sind gesperrt.
- Storno bezahlter oder teilweise bezahlter Rechnungen ist gesperrt, weil Erstattung und Zahlungskorrektur noch nicht implementiert sind. Eine Zahlung, die während der PDF-Erstellung eingeht, verhindert den Storno vor dem Commit.

## Sicherheitsgrenzen

Die Audit-Kette und SQLite-Trigger erschweren unbeabsichtigte Änderungen. Sie ersetzen keine externe unveränderliche Archivierung: Ein Benutzer mit vollständigem Datenbankzugriff kann auch Schutzmechanismen verändern. Vite darf Laufzeitdaten, private Quellen, Umgebungsdateien und Schlüsseldateien nicht ausliefern. Produktionsmodus für echte Daten, Netzwerkbindung außerhalb des Loopbacks und echte Versandendpunkte sind nicht vorgesehen.
