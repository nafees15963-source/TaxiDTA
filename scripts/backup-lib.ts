import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const MAGIC = Buffer.from('TAXIBAK1', 'ascii');
const MAX_BYTES = 256 * 1024 * 1024;
const HEADER_LENGTH = 8 + 16 + 12 + 16;
const KDF = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function keyFor(passphrase: string, salt: Buffer): Buffer {
  if (passphrase.length < 12 || passphrase.length > 1024) throw new Error('Die Backup-Passphrase muss 12 bis 1024 Zeichen enthalten.');
  return scryptSync(passphrase, salt, 32, KDF);
}

/** Versioned binary envelope. Header fields and version are authenticated as AAD. */
export function encryptBackup(plaintext: Buffer, passphrase: string): Buffer {
  if (plaintext.length > MAX_BYTES) throw new Error('Backup größer als das lokale Limit von 256 MiB.');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = keyFor(passphrase, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.concat([MAGIC, salt, iv]));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), ciphertext]);
  } finally { key.fill(0); }
}

export function decryptBackup(envelope: Buffer, passphrase: string): Buffer {
  if (envelope.length < HEADER_LENGTH || envelope.length > MAX_BYTES + HEADER_LENGTH || !envelope.subarray(0, 8).equals(MAGIC)) {
    throw new Error('Unbekanntes, beschädigtes oder zu großes Backupformat.');
  }
  const salt = envelope.subarray(8, 24);
  const iv = envelope.subarray(24, 36);
  const key = keyFor(passphrase, salt);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(envelope.subarray(0, 36));
    decipher.setAuthTag(envelope.subarray(36, HEADER_LENGTH));
    return Buffer.concat([decipher.update(envelope.subarray(HEADER_LENGTH)), decipher.final()]);
  } catch { throw new Error('Backup konnte nicht authentifiziert werden: falsche Passphrase oder veränderte Datei.'); }
  finally { key.fill(0); }
}

export async function createEncryptedBackup(sourcePath: string, outputPath: string, passphrase: string) {
  const source = resolve(sourcePath);
  const output = resolve(outputPath);
  if (!existsSync(source)) throw new Error('Datenbank fehlt. Zuerst npm run db:migrate oder npm run dev starten.');
  if (source === output || existsSync(output)) throw new Error('Das Backupziel muss eine neue Datei sein. Vorhandene Dateien werden nicht überschrieben.');
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  const tempDir = mkdtempSync(join(tmpdir(), 'taxidta-backup-'));
  const sourceDb = new DatabaseSync(source, { readOnly: true });
  try {
    const snapshot = join(tempDir, 'snapshot.sqlite');
    // SQLite online backup includes committed WAL data and yields a consistent database snapshot.
    await backup(sourceDb, snapshot);
    const plain = readFileSync(snapshot);
    const sha256 = createHash('sha256').update(plain).digest('hex');
    try {
      const encrypted = encryptBackup(plain, passphrase);
      writeFileSync(output, encrypted, { mode: 0o600, flag: 'wx' });
      return { path: output, sha256, bytes: encrypted.length };
    } finally { plain.fill(0); }
  } finally { sourceDb.close(); rmSync(tempDir, { recursive: true, force: true }); }
}

/** Restores only into a new temporary directory and never overwrites the active database. */
export function verifyEncryptedRestore(backupPath: string, passphrase: string) {
  const resolvedPath = resolve(backupPath);
  if (statSync(resolvedPath).size > MAX_BYTES + HEADER_LENGTH) throw new Error('Backup größer als das lokale Limit von 256 MiB.');
  const envelope = readFileSync(resolvedPath);
  const plain = decryptBackup(envelope, passphrase);
  const sha256 = createHash('sha256').update(plain).digest('hex');
  const tempDir = mkdtempSync(join(tmpdir(), 'taxidta-restore-'));
  let database: DatabaseSync | undefined;
  try {
    const restoredPath = join(tempDir, 'restored.sqlite');
    writeFileSync(restoredPath, plain, { mode: 0o600, flag: 'wx' });
    plain.fill(0);
    database = new DatabaseSync(restoredPath, { readOnly: true });
    const rows = database.prepare('PRAGMA integrity_check').all();
    if (rows.length !== 1 || Object.values(rows[0])[0] !== 'ok') throw new Error('SQLite-Integritätsprüfung fehlgeschlagen.');
    const tableCount = Number((database.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").get() as {n:number}).n);
    if (tableCount === 0) throw new Error('Die wiederhergestellte Datei enthält keine Anwendungstabellen.');
    return { integrity: 'ok' as const, sha256, tableCount, activeDatabaseChanged: false as const };
  } finally { plain.fill(0); database?.close(); rmSync(tempDir, { recursive: true, force: true }); }
}

export async function readPassphrase(): Promise<string> {
  const configured = process.env.TAXIDTA_BACKUP_PASSPHRASE;
  if (configured) return configured;
  if (!process.stdin.isTTY) {
    const value = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
    if (!value) throw new Error('Backup-Passphrase fehlt. Interaktiv ausführen oder über stdin übergeben.');
    return value;
  }
  process.stdout.write('Backup-Passphrase (mindestens 12 Zeichen; Eingabe unsichtbar): ');
  return await new Promise<string>((resolvePassphrase, reject) => {
    let secret = '';
    const cleanup = () => { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', onData); process.stdout.write('\n'); };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\u0003') { cleanup(); reject(new Error('Abgebrochen.')); return; }
        if (char === '\r' || char === '\n') { cleanup(); resolvePassphrase(secret); return; }
        if (char === '\u007f' || char === '\b') secret = secret.slice(0, -1);
        else if (char >= ' ') secret += char;
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}
