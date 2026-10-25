import {
  getPayer,
  payerRegistrySummary,
  searchPayers,
  type PayerRecord,
} from "../src/domain/payers.js";
export { getPayer, payerRegistrySummary, searchPayers };
export type { PayerRecord };
export class PayerRegistryError extends Error {
  readonly status = 422;
  readonly code = "PAYER_NOT_FOUND";
  constructor() {
    super("Bitte eine Krankenkasse aus dem Register auswählen.");
    this.name = "PayerRegistryError";
  }
}
/** Resolve on the server; browser-supplied payer labels, IKs and addresses are never trusted. */
export function resolvePayer(id: string): PayerRecord {
  const payer = getPayer(id);
  if (!payer) throw new PayerRegistryError();
  return payer;
}
