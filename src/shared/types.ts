export type CustomerKind = "private" | "business" | "laboratory" | "payer";
export interface Customer {
  id: string;
  name: string;
  kind: CustomerKind;
  address: string;
  reference?: string;
  createdAt: string;
}
export type JourneyKind = "taxi" | "medical" | "courier" | "laboratory";
export type VehicleKind = "taxi" | "rental";
export interface Journey {
  id: string;
  customerId: string;
  kind: JourneyKind;
  date: string;
  from: string;
  to: string;
  km: string;
  vehicle: VehicleKind;
  sameMunicipality: boolean | null;
  grossCents: number;
  description: string;
  tariff: "I" | "II" | null;
  contractConfirmed: boolean;
  prescriptionConfirmed: boolean;
  receiptNumber: string | null;
  invoiceId: string | null;
  createdAt: string;
  billingCaseId?: string;
  insuredPersonKey?: string;
  internalReference?: string;
  direction?: "outbound" | "return";
}
export interface TaxResult {
  rate: 7 | 19;
  reason: string;
  ruleId: string;
  source: string;
}
export interface InvoiceLine {
  journeyId: string;
  description: string;
  serviceDate: string;
  grossCents: number;
  netCents: number;
  taxCents: number;
  taxRate: 7 | 19;
  taxReason: string;
  taxRuleId?: string;
  taxSource?: string;
  tariffSource?: string;
  tariffRevision?: string;
  calculationKm?: string;
  billingCaseId?: string;
  insuredName?: string;
  prescriptionReference?: string;
  positions?: {
    code: string;
    quantity: string;
    unitCents: number;
    totalCents: number;
    label: string;
    source?: string;
  }[];
}
export interface Invoice {
  id: string;
  number: string;
  customerId: string;
  customerSnapshot: Customer;
  issuedAt: string;
  dueAt: string;
  dueAtVerified?: boolean;
  dueAtBasis?: string;
  lines: InvoiceLine[];
  grossCents: number;
  netCents: number;
  taxCents: number;
  status: "issued" | "cancelled";
  payments: Payment[];
  cancelledBy: string | null;
  createdAt: string;
  pdfHash: string;
  originalInvoiceId?: string | null;
  billingCaseIds?: string[];
  billingCaseSnapshots?: BillingCase[];
}
export interface Payment {
  id: string;
  amountCents: number;
  date: string;
  note: string;
  createdAt: string;
}
export interface DtaCheck {
  id: string;
  invoiceId: string;
  createdAt: string;
  mode: "dry-run";
  status: "blocked";
  blockers: { code: string; message: string }[];
  payloadHash: string;
  format: "readiness-report";
}
export interface AuditEvent {
  id: number;
  action: string;
  entityId: string;
  at: string;
  previousHash: string;
  hash: string;
  details: string;
}
export interface AppState {
  customers: Customer[];
  journeys: Journey[];
  invoices: Invoice[];
  dtaChecks: DtaCheck[];
  audit: AuditEvent[];
  csrfToken: string;
  mode: "demo";
  businessDate: string;
  version: string;
  billingCases: BillingCase[];
  deployment?: {
    kind: "site-private";
    financialStorage: "cloud-d1" | "cloud-supabase";
    ownerOnly: true;
    syntheticOnly: true;
  };
}
export interface TariffInput {
  article: "I" | "II";
  km: string;
  date: string;
  persons: number;
  contractConfirmed: boolean;
  approachKm?: string;
  approachEligible?: boolean;
  tunnelCrossings?: number;
  tunnelConfirmed?: boolean;
}
export interface TariffResult {
  article: "I" | "II";
  positions: {
    code: string;
    label: string;
    quantity: string;
    unitCents: number;
    totalCents: number;
    source: string;
  }[];
  grossCents: number;
  explanation: string[];
  source: string;
  warnings: string[];
}

/** Registry identity and source status are resolved on the server, never trusted from a case form. */
export interface BillingCasePayer {
  id: string;
  name: string;
  ik: string | null;
  address: string | null;
  invoiceReady?: boolean;
  isSynthetic?: boolean;
  addressKind?: "headquarters" | "billing" | "contact" | "missing" | "synthetic";
  sourceUrl?: string;
  sourceDate?: string;
  ikStatus?: "source-verified" | "reference-only" | "missing" | "synthetic";
  addressStatus?: "source-verified" | "missing" | "synthetic";
  routingVerified?: boolean;
}
export interface BillingCaseInsured {
  name: string;
  address: string;
  insuranceNumber?: string;
  dateOfBirth?: string;
}
export interface BillingCasePrescription {
  number: string;
  issuedAt: string;
  validFrom?: string;
  validTo?: string;
  confirmed: boolean;
}
export interface BillingCaseJourneyInput {
  date: string;
  from: string;
  to: string;
  km: string;
  direction: "outbound" | "return";
  receiptNumber?: string;
}
export interface BillingCaseInput {
  payer: BillingCasePayer;
  insured: BillingCaseInsured;
  prescription: BillingCasePrescription;
  tariff: "I" | "II";
  contractConfirmed: boolean;
  vehicle: VehicleKind;
  sameMunicipality: boolean | null;
  journeys: BillingCaseJourneyInput[];
}
export type BillingCaseRequestInput = Omit<BillingCaseInput, "payer"> & {
  payerId: string;
};
export interface BillingCaseJourney extends BillingCaseJourneyInput {
  id: string;
  internalReference: string;
  grossCents: number;
  netCents: number;
  taxCents: number;
  taxRate: 7 | 19;
  taxPending?: boolean;
  positions?: InvoiceLine["positions"];
}
export interface BillingCase extends Omit<BillingCaseInput, "journeys"> {
  id: string;
  number: string;
  customerId: string;
  journeyIds: string[];
  journeys: BillingCaseJourney[];
  invoiceId: string | null;
  status: "draft" | "ready" | "invoiced";
  blockers: string[];
  grossCents: number;
  netCents: number;
  taxCents: number;
  createdAt: string;
  updatedAt: string;
}
