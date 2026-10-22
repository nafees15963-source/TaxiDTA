# Tarif- und Steuerregelbuch der lokalen Demo

Stand: 22.10.2026. Nachweise: U09–U11 im `SOURCE_REGISTER.md`, amtliche Steuersatzquelle R04 im `RESEARCH_LOG.md`. Kein Ersatz für Vertrags- oder Steuerberatung. Geltungsbereich der Implementierung ist bewusst eng; eine Sperre benennt fehlende Freigabe statt einen Preis zu schätzen.

## Berechnungsregeln

| Fall | Belegte Regel | Demo-Grenze |
|---|---|---|
| Art I Einzelperson ohne Ausprägung |510100:1400 Cent bis 3 Besetztkm; 513000:227 Cent je zusätzlichem km | Nur bestätigte Vertragsberechtigung,2026, positive ganze Besetztkm |
| Art II Einzelperson Serienbehandlung 31 |510131:1400 Cent bis 3 km; 513131:222 Cent je zusätzlichem km | Wie oben; Auswahl II ist keine automatische medizinische/Genehmigungsprüfung |
| Anfahrt Art I/II |513900/513931:114 Cent je zulässigem km, max 912 Cent je einfache Fahrt | Zusätzliche Bestätigung der vertraglichen Anrechenbarkeit, keine Leerfahrt-Automatik |
| Herrentunnel, Einzelperson |512500/512531: maximal 230 Cent je tatsächlich belegter Durchfahrt | Automatische Mautberechnung bleibt gesperrt: tatsächlicher Betrag kann hier noch nicht erfasst werden; Höchstbetrag ist kein tatsächlicher Preis |
| Mehrpersonen und Reha/Verlegung | Eigene Positionen und Raten existieren U10/U11 S. 2/3 | Gesperrt; Verteilungs-/Anwendungslogik aus Vollvertrag fehlt |
| Kilometerbruchteil | Kein sicherer Rundungsmodus aus Positionslisten abgelesen | Krankenfahrten-Tarif blockiert Bruchteile statt aufzurunden; normale Fahrten können Dezimal-km für Steuergrenze nutzen |
| Gültigkeit | U10/U11 gelten ab 01.01.2026 |2026-Policyfenster ist technische Begrenzung, **kein behauptetes Vertragsende** |

`calculateTariff` berechnet Positionsmengen unabhängig vom Datum der Rechnung. Hin-/Rückfahrt sind getrennte Leistungen. Spätere Regeländerungen ändern ausgegebene Rechnungs-Snapshots nicht. Bestätigung in der lokalen Demo testet den Workflow, sie ersetzt keinen hochgeladenen Vertragsnachweis.

## Goldene Beispiele

| Eingabe | Erwartete Aufteilung | Gesamt |
|---|---|---:|
|I,1 km |1×510100 |14,00 € |
|I,3 km |1×510100 |14,00 € |
|I,4 km |1×510100+1×513000 |16,27 € |
|I,20 km |1×510100+17×513000 |52,59 € |
|II,20 km |1×510131+17×513131 |51,74 € |
|I,20 km+8 km berechtigte Anfahrt |52,59 €+9,12 € |61,71 € |
|I,20 km+9 km berechtigte Anfahrt | Anfahrtdeckel 9,12 € |61,71 € |

0/negative km, fehlende Vertragsfreigabe, Datum außerhalb des Policyfensters und nicht unterstützte Personenzahl blockieren. Preise sind im Demo-Regelmodell **brutto**; auf 52,59 € werden nicht nochmals 7 % aufgeschlagen. Die richtige steuerliche Aufteilung erfolgt getrennt.

## Steuerregeln: keine pauschale 50-km-Formel

§ 12 Abs. 2 Nr. 10 UStG betrifft qualifizierte Personenbeförderung unter anderem mit Taxen. Die Ortsalternative gilt neben der Entfernungsalternative. Die Demo unterstützt inländische Standardleistungen 2026 bei Regelbesteuerung:

| Eingabe | Demoentscheidung |
|---|---|
| Taxi-Personenfahrt 49,99 km /50,00 km |7 % |
| Taxi-Personenfahrt 50,01 km, gemeindeübergreifend |19 % |
| Taxi-Personenfahrt 60 km, vollständig eine Gemeinde |7 % |
| Taxi-Personenfahrt>50 km, Gemeindeangabe unbekannt | Sperre |
| Kurier-/Labortransport 20 km mit Taxi |19 % Standardleistung; keine Patientendaten nötig |
| Mietwagen-/medizinischer Sonderfall | Sperre bis qualifizierte Steuerregel vorliegt |
| Auslandsleistung, Steuerbefreiung, Kleinunternehmerstatus, gemischte Auslagen | Nicht abgedeckt; keine automatische Ausnahme |

Geschäftlicher Kunde allein ändert keinen Steuersatz. Gemeindeangabe meint den tatsächlichen gesamten Beförderungsweg, nicht nur gleiche Namensfelder. Für produktive Nutzung muss die Leistungsklassifikation durch den Inhaber/fachlichen Prüfer gesichert werden.

## Cent-Modell und Rechnung

Beträge werden als ganze Cent gespeichert. Decimal-Eingaben werden über dezimale Zeichenfolgen/BigInt validiert, keine Geldberechnung mit binärer Gleitkommamultiplikation. Brutto je Leistung wird in Netto und enthaltene Steuer mit einer dokumentierten Cent-Rundung zerlegt. Rechnung summiert eingefrorene Zeilen; Nettosumme+Steuersumme=Bruttosumme. Gemischte Steuersätze bleiben gruppiert sichtbar.

28 Kalendertage sind die Produktvorgabe für **normale** neue Rechnungen, keine aus U04 abgeleitete DTA-Kassenfrist.22.10.2026→19.11.2026. Produktive Kassenrechnungen benötigen gesondert belegte Vertragsfrist.

Quellbelege fehlen noch für: Teilkilometer-Rundung, Bruttoeigenschaft aller Vertragskomponenten, tatsächliche Mauthöhe/Auslagensteuer, Mehrpersonenverteilung, Genehmigungsausnahmen, Zuzahlungen nach Leistungsdatum und spätere Tarifversionen. Diese Punkte bleiben Freigabehürden.
