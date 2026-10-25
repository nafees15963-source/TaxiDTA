import {DtaValidationError, assertIkSyntax, slePhysicalFilename} from './filenames.ts';

export class DtaOrderError extends DtaValidationError {
  constructor(code: string, public readonly field: string, public readonly byteOffset: number) {
    super(code, `Auftragssatz: Feld ${field} an Byteposition ${byteOffset + 1} ist im lokalen Prüfprofil ungültig.`);
    this.name = 'DtaOrderError';
  }
}

/** Inspection of GGT2 V01, positions1..210 only; remainder deliberately not claimed validated. */
export function inspectSleOrderV01Subset(bytes: Uint8Array, expected: {
  mode: 'test' | 'production'; transferNumber: number; logicalFilename: string;
  ownerIk: string; physicalSenderIk: string; decryptingRecipientIk: string; physicalRecipientIk: string;
  plaintextSize: number; encryptedSize: number;
}): {
  profile: 'GGT2-v01-SLE-outbound-header-subset'; productionReady: false;
  physicalFilename: string; logicalFilename: string; createdLocalTime: string;
  ownerIk: string; physicalSenderIk: string; decryptingRecipientIk: string; physicalRecipientIk: string;
  plaintextSize: number; encryptedSize: number; unvalidatedByteRange: {first: 211; last: 348};
} {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 348) throw new DtaOrderError('ORDER_SIZE', 'LÄNGE_AUFTRAG', 8);
  const text = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
  const field = (name: string, first: number, last: number, pattern: RegExp) => {
    const value = text.slice(first - 1, last);
    if (!pattern.test(value)) throw new DtaOrderError('ORDER_FIELD', name, first - 1);
    return value;
  };
  field('IDENTIFIKATOR', 1, 6, /^500000$/);
  field('VERSION', 7, 8, /^01$/);
  field('LÄNGE_AUFTRAG', 9, 16, /^00000348$/);
  field('SEQUENZ_NR', 17, 19, /^000$/); // no bilateral splitting support
  const procedure = field('VERFAHREN_KENNUNG', 20, 24, /^[TE]SOL0$/);
  const transfer = field('TRANSFER_NUMMER', 25, 27, /^\d{3}$/);
  field('VERFAHREN_KENNUNG_SPEZIFIKATION', 28, 32, /^[\x20-\x7e]{5}$/);
  const readIk = (name: string, first: number) => field(name, first, first + 14, /^\d{9} {6}$/).slice(0, 9);
  const ownerIk = readIk('ABSENDER_EIGNER', 33);
  const physicalSenderIk = readIk('ABSENDER_PHYSIKALISCH', 48);
  const decryptingRecipientIk = readIk('EMPFÄNGER_NUTZER', 63);
  const physicalRecipientIk = readIk('EMPFÄNGER_PHYSIKALISCH', 78);
  field('FEHLER_NUMMER', 93, 98, /^000000$/);
  field('FEHLER_MASSNAHME', 99, 104, /^000000$/);
  const logicalFilename = field('DATEINAME', 105, 115, /^SL\d{6}[SA](0[1-9]|1[0-2])$/);
  const createdLocalTime = field('DATUM_ERSTELLUNG', 116, 129, /^\d{14}$/);
  const iso = `${createdLocalTime.slice(0, 4)}-${createdLocalTime.slice(4, 6)}-${createdLocalTime.slice(6, 8)}T${createdLocalTime.slice(8, 10)}:${createdLocalTime.slice(10, 12)}:${createdLocalTime.slice(12, 14)}.000Z`;
  const date = new Date(iso);
  if (createdLocalTime.startsWith('0000') || !Number.isFinite(date.getTime()) || date.toISOString() !== iso) throw new DtaOrderError('ORDER_DATE', 'DATUM_ERSTELLUNG', 115);
  // This is an unsent preparation header, never an import of a supposed receipt.
  field('DATUM_ÜBERTRAGUNG_GESENDET', 130, 143, /^0{14}$/);
  field('DATUM_ÜBERTRAGUNG_EMPFANGEN_START', 144, 157, /^0{14}$/);
  field('DATUM_ÜBERTRAGUNG_EMPFANGEN_ENDE', 158, 171, /^0{14}$/);
  field('DATEIVERSION', 172, 177, /^000000$/);
  field('KORREKTUR', 178, 178, /^0$/);
  const plaintextSize = Number(field('DATEIGRÖSSE_NUTZDATEN', 179, 190, /^\d{12}$/));
  const encryptedSize = Number(field('DATEIGRÖSSE_ÜBERTRAGUNG', 191, 202, /^\d{12}$/));
  field('ZEICHENSATZ', 203, 204, /^I1$/);
  field('KOMPRIMIERUNG', 205, 206, /^00$/);
  field('VERSCHLÜSSELUNGSART', 207, 208, /^03$/);
  field('ELEKTRONISCHE_UNTERSCHRIFT', 209, 210, /^03$/);
  const physicalFilename = procedure + transfer;
  const expectedPhysical = slePhysicalFilename(expected);
  if (physicalFilename !== expectedPhysical || logicalFilename !== expected.logicalFilename) throw new DtaOrderError('ORDER_FILENAME_MISMATCH', 'VERFAHREN_KENNUNG/DATEINAME', 19);
  for (const [actual, requested, offset, name] of [
    [ownerIk, expected.ownerIk, 32, 'ABSENDER_EIGNER'], [physicalSenderIk, expected.physicalSenderIk, 47, 'ABSENDER_PHYSIKALISCH'],
    [decryptingRecipientIk, expected.decryptingRecipientIk, 62, 'EMPFÄNGER_NUTZER'], [physicalRecipientIk, expected.physicalRecipientIk, 77, 'EMPFÄNGER_PHYSIKALISCH'],
  ] as const) {
    assertIkSyntax(requested);
    if (actual !== requested) throw new DtaOrderError('ORDER_ROLE_MISMATCH', name, offset);
  }
  if (!Number.isSafeInteger(expected.plaintextSize) || expected.plaintextSize <= 0 || !Number.isSafeInteger(expected.encryptedSize) || expected.encryptedSize <= 0 ||
      plaintextSize !== expected.plaintextSize || encryptedSize !== expected.encryptedSize) throw new DtaOrderError('ORDER_BYTE_COUNT', 'DATEIGRÖSSE', 178);
  return {profile: 'GGT2-v01-SLE-outbound-header-subset', productionReady: false,
    physicalFilename, logicalFilename, createdLocalTime, ownerIk, physicalSenderIk, decryptingRecipientIk, physicalRecipientIk,
    plaintextSize, encryptedSize, unvalidatedByteRange: {first: 211, last: 348}};
}
