import { readPassphrase, verifyEncryptedRestore } from './backup-lib.js';
try {
  const file = process.argv[2];
  if (!file) throw new Error('Backupdatei fehlt. Beispiel: npm run restore:test -- work/backups/datei.tdbak');
  const result = verifyEncryptedRestore(file, await readPassphrase());
  console.log(`Restore-Test erfolgreich: SQLite integrity_check=${result.integrity}; ${result.tableCount} Tabellen.\nSHA-256: ${result.sha256}\nAktive Datenbank unverändert. Temporäre Wiederherstellung wurde entfernt.`);
} catch (error) { console.error(error instanceof Error ? error.message : 'Restore-Test fehlgeschlagen.'); process.exitCode = 1; }
