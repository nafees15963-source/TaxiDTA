import { Store } from '../server/store.js';
try {
  const mode = process.env.TAXIDTA_MODE || 'demo';
  if (mode !== 'demo') throw new Error('Diese Version initialisiert ausschließlich lokale Demo-Daten.');
  const store = new Store(process.env.TAXIDTA_DB_PATH || 'work/taxidta.sqlite');
  try {
    if (process.argv.includes('--seed')) await store.seed();
    console.log(`Lokales SQLite-Schema initialisiert.${process.argv.includes('--seed') ? ' Erfundenen Testdatensatz angelegt, sofern noch leer.' : ''}\nKeine Supabase-Migration und keine Cloudverbindung ausgeführt.`);
  } finally { store.close(); }
} catch (error) { console.error(error instanceof Error ? error.message : 'Lokale Initialisierung fehlgeschlagen.'); process.exitCode = 1; }
