import test from 'node:test';
import assert from 'node:assert/strict';
import {DtaOrderError, inspectSleOrderV01Subset} from '../src/domain/dta/order-file.ts';

// This is invented test input for an inspector, not a §302 file generator or golden file.
const expected = {mode: 'test' as const, transferNumber: 7, logicalFilename: 'SL000000S10', ownerIk: '900000001', physicalSenderIk: '900000002', decryptingRecipientIk: '900000003', physicalRecipientIk: '900000004', plaintextSize: 123, encryptedSize: 1234};
function syntheticHeader() {
  const bytes = Buffer.alloc(348, ' ');
  const place = (first: number, value: string) => bytes.write(value, first - 1, 'latin1');
  place(1, '5000000100000348000TSOL0007     ');
  place(33, '900000001      900000002      900000003      900000004      ');
  place(93, '000000000000SL000000S1020261022123456');
  place(130, '0'.repeat(42));
  place(172, '0000000' + '000000000123' + '000000001234' + 'I1000303');
  return bytes;
}
const code = (wanted: string) => (error: unknown) => error instanceof DtaOrderError && error.code === wanted;

test('GGT2 V01 header inspector checks byte positions and distinct decryptor/physical roles without claiming tail validation', () => {
  const result = inspectSleOrderV01Subset(syntheticHeader(), expected);
  assert.equal(result.productionReady, false);
  assert.equal(result.createdLocalTime, '20261022123456', 'naive source time is not falsely converted to UTC');
  assert.equal(result.physicalFilename, 'TSOL0007');
  assert.equal(result.decryptingRecipientIk, '900000003');
  assert.equal(result.physicalRecipientIk, '900000004');
  assert.deepEqual(result.unvalidatedByteRange, {first: 211, last: 348});
  assert.throws(() => inspectSleOrderV01Subset(syntheticHeader(), {...expected, decryptingRecipientIk: expected.physicalRecipientIk}), code('ORDER_ROLE_MISMATCH'));
});

test('order inspector rejects trailing newline, wrong version, byte counts, splitting and incompatible crypto flags', () => {
  assert.throws(() => inspectSleOrderV01Subset(Buffer.concat([syntheticHeader(), Buffer.from('\n')]), expected), code('ORDER_SIZE'));
  const wrongVersion = syntheticHeader(); wrongVersion.write('02', 6);
  assert.throws(() => inspectSleOrderV01Subset(wrongVersion, expected), code('ORDER_FIELD'));
  assert.throws(() => inspectSleOrderV01Subset(syntheticHeader(), {...expected, encryptedSize: 1235}), code('ORDER_BYTE_COUNT'));
  const split = syntheticHeader(); split.write('001', 16);
  assert.throws(() => inspectSleOrderV01Subset(split, expected), code('ORDER_FIELD'));
  const unsigned = syntheticHeader(); unsigned.write('00', 208);
  assert.throws(() => inspectSleOrderV01Subset(unsigned, expected), (error: unknown) => error instanceof DtaOrderError && error.byteOffset === 208);
});

test('order inspector rejects impossible calendar dates, renamed procedures and forged receipt timestamps', () => {
  const date = syntheticHeader(); date.write('20260230120000', 115);
  assert.throws(() => inspectSleOrderV01Subset(date, expected), code('ORDER_DATE'));
  const renamed = syntheticHeader(); renamed.write('ESOL0', 19);
  assert.throws(() => inspectSleOrderV01Subset(renamed, expected), code('ORDER_FILENAME_MISMATCH'));
  const receipt = syntheticHeader(); receipt.write('20261022130000', 143);
  assert.throws(() => inspectSleOrderV01Subset(receipt, expected), code('ORDER_FIELD'));
});
