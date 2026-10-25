# Vercel mit Supabase

Die Oberfläche läuft als Vite-Build. `/api/*` wird über `api/handler.ts` in einer Vercel Node.js Function ausgeführt. Finanzdaten und PDF-Archive werden in Supabase gespeichert, nicht im flüchtigen Dateisystem der Function. Für diese Betriebsart ist kein lokaler Backend-Server erforderlich.

## Import und Einstellungen

1. https://vercel.com/new öffnen und `nafees15963-source/TaxiDTA` importieren.
2. Framework Vite, Root Directory Repository-Wurzel, Node.js 24.x.
3. Install Command `npm ci`, Build Command `npm run build`, Output Directory `dist`.
4. Die folgenden Environment Variables für Production setzen. Keine davon mit `VITE_` präfixieren.

| Variable | Wert |
| --- | --- |
| `SUPABASE_URL` | Projekt-URL des eingerichteten Supabase-Projekts |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable Key dieses Projekts |
| `SUPABASE_OWNER_ID` | UUID des bestätigten App-Inhabers |
| `TAXIDTA_SESSION_KEY` | Zufälliger Schlüssel mit 64 Hex-Zeichen, nur serverseitig |
| `TAXIDTA_PUBLIC_ORIGIN` | Bei eigener/fester Domain deren exakte HTTPS-Adresse, ohne abschließenden Schrägstrich |

Die automatischen Adressen aus Vercels `VERCEL_URL` und `VERCEL_PROJECT_PRODUCTION_URL` werden ebenfalls akzeptiert. Für eine feste Produktionsadresse diese zusätzlich als `TAXIDTA_PUBLIC_ORIGIN` setzen und erneut deployen. Schlüssel lokal erzeugen: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Schlüsselrotation beendet alle bestehenden App-Sitzungen. Keine privaten Schlüssel, `.env.local`, Zertifikate oder Datenbanken in GitHub hochladen. Ein Supabase Service Role Key wird nicht benötigt.

`vercel.json` legt die Function-Region Frankfurt (`fra1`) und API-Rewrites fest. Die vier SQL-Migrationen in `supabase/migrations/` wurden im zugehörigen Supabase-Projekt angewendet. Bei einem neuen Projekt sind sie ebenfalls erforderlich; die Inhaberbindung erfolgt administrativ.

## Nach dem Deployment prüfen

Die Vercel-Adresse öffnen, mit dem eigenen Supabase-App-Konto anmelden und Authenticator einrichten/bestätigen. Mit erfundenen Daten einen Fall speichern, die Seite neu laden, eine Testrechnung ausstellen und ihr PDF öffnen. Abmelden und prüfen, dass Datenzugriffe wieder gesperrt sind. Diese persönliche Ende-zu-Ende-Abnahme ist noch offen; lokale Unit- und Browserprüfungen ersetzen sie nicht.

## Grenzen dieses Stands

Der Workspace ist auf 1,9 MB inklusive PDF-Archiven begrenzt. Er dient synthetischen Tests, noch nicht dem dauerhaften produktiven Gesundheitsdatenbetrieb. Der echte DTA-Versand ist gesperrt: vollständiger §302-Dateigenerator, verifizierte aktuelle Empfängerrouten und eigener funktionsfähiger Zertifikats-/Transportweg fehlen. Eine Vercel-Veröffentlichung hebt diese Sperren nicht auf.

Supabase meldet außerdem deaktivierten Schutz gegen bereits kompromittierte Passwörter. Einrichtung und Tarifverfügbarkeit: https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection
