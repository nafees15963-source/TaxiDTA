import { resolve } from 'node:path';
import { createEncryptedBackup, readPassphrase } from './backup-lib.js';
const date = new Date().toISOString().replace(/[:.]/g, '-');
try {
  const source = process.env.TAXIDTA_DB_PATH || 'work/taxidta.sqlite';
  const target = process.argv[2] || `work/backups/taxidta-${date}.tdbak`;
  const result = await createEncryptedBackup(source, target, await readPassphrase());
  console.log(`Verschlüsseltes Backup erstellt: ${resolve(result.path)}\nGröße: ${result.bytes} Byte\nSHA-256 der Datenbank: ${result.sha256}\nAls Nächstes: npm run restore:test -- <Backupdatei>`);
} catch (error) { console.error(error instanceof Error ? error.message : 'Backup fehlgeschlagen.'); process.exitCode = 1; }
