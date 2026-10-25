/** §302 TA1 Anhang1, 31.08.2017, §§4.2–4.3. These are names, not a DTA serializer. */
export class DtaValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DtaValidationError';
  }
}

export function assertIkSyntax(ik: string): void {
  if (typeof ik !== 'string' || !/^\d{9}$/.test(ik)) {
    throw new DtaValidationError('IK_SYNTAX', 'Das IK muss aus genau neun Ziffern bestehen.');
  }
}

export function sleLogicalFilename(input: {
  senderIk: string;
  senderKind: 'self-billing' | 'billing-center';
  billingMonth: number;
}): string {
  assertIkSyntax(input.senderIk);
  if (!Number.isInteger(input.billingMonth) || input.billingMonth < 1 || input.billingMonth > 12) {
    throw new DtaValidationError('BILLING_MONTH', 'Der Abrechnungsmonat muss zwischen 1 und 12 liegen.');
  }
  if (!['self-billing', 'billing-center'].includes(input.senderKind)) {
    throw new DtaValidationError('SENDER_KIND', 'Die Absenderrolle muss ausdrücklich festgelegt sein.');
  }
  // One-based IK positions 3..8, excluding position 9; no invented check-digit validation.
  return `SL${input.senderIk.slice(2, 8)}${input.senderKind === 'self-billing' ? 'S' : 'A'}${String(input.billingMonth).padStart(2, '0')}`;
}

export function slePhysicalFilename(input: {mode: 'test' | 'production'; transferNumber: number}): string {
  if (!['test', 'production'].includes(input.mode)) {
    throw new DtaValidationError('TRANSFER_MODE', 'Test- oder Echtmodus muss ausdrücklich festgelegt sein.');
  }
  if (!Number.isInteger(input.transferNumber) || input.transferNumber < 0 || input.transferNumber > 999) {
    throw new DtaValidationError('TRANSFER_NUMBER', 'Die Transfernummer muss dreistellig darstellbar sein.');
  }
  // Naming an E-file is not permission or an implementation to send it.
  return `${input.mode === 'test' ? 'T' : 'E'}SOL0${String(input.transferNumber).padStart(3, '0')}`;
}
