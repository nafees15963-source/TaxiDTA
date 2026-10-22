import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEncryptedBackup, decryptBackup, encryptBackup, verifyEncryptedRestore } from '../scripts/backup-lib.js';
const passphrase = 'synthetic-test-passphrase-only';

test('backup encryption authenticates ciphertext and rejects wrong passphrase and header changes', () => {
  const original = Buffer.from('synthetic demo data');
  const sealed = encryptBackup(original, passphrase);
  assert.deepEqual(decryptBackup(sealed, passphrase), original);
  assert.ok(!sealed.includes(original));
  assert.throws(() => decryptBackup(sealed, 'another-wrong-test-passphrase'), /authentifiziert/);
  for (const index of [9, 25, 37, sealed.length - 1]) {
    const altered = Buffer.from(sealed); altered[index] ^= 1;
    assert.throws(() => decryptBackup(altered, passphrase), /authentifiziert/);
  }
  assert.throws(() => encryptBackup(original, 'short'), /12/);
});

test('SQLite WAL snapshot restores successfully without changing live database or overwriting backups', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'taxidta-test-'));
  const sourcePath = join(dir, 'source.sqlite');
  const encryptedPath = join(dir, 'backup.tdbak');
  const db = new DatabaseSync(sourcePath);
  try {
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE demo(id INTEGER PRIMARY KEY, value TEXT); INSERT INTO demo(value) VALUES(\'synthetic\');');
    const result = await createEncryptedBackup(sourcePath, encryptedPath, passphrase);
    db.exec("INSERT INTO demo(value) VALUES('after-backup')");
    const restored = verifyEncryptedRestore(encryptedPath, passphrase);
    assert.equal(restored.integrity, 'ok');
    assert.equal(restored.sha256, result.sha256);
    assert.equal(restored.activeDatabaseChanged, false);
    assert.equal((db.prepare('SELECT count(*) n FROM demo').get() as {n:number}).n, 2);
    await assert.rejects(createEncryptedBackup(sourcePath, encryptedPath, passphrase), /nicht überschrieben/);
    const badPath = join(dir, 'bad.tdbak'); const bad = readFileSync(encryptedPath); bad[bad.length - 1] ^= 1; writeFileSync(badPath, bad);
    assert.throws(() => verifyEncryptedRestore(badPath, passphrase), /authentifiziert/);
  } finally { db.close(); rmSync(dir, { recursive:true, force:true }); }
});
