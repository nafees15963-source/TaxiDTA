export type CustomerKind='private'|'business'|'laboratory'|'payer';
export interface Customer {id:string; name:string; kind:CustomerKind; address:string; reference?:string; createdAt:string}
export type JourneyKind='taxi'|'medical'|'courier'|'laboratory';
export type VehicleKind='taxi'|'rental';
export interface Journey {id:string;customerId:string;kind:JourneyKind;date:string;from:string;to:string;km:string;vehicle:VehicleKind;sameMunicipality:boolean|null;grossCents:number;description:string;tariff:'I'|'II'|null;contractConfirmed:boolean;prescriptionConfirmed:boolean;receiptNumber:string|null;invoiceId:string|null;createdAt:string}
export interface TaxResult {rate:7|19;reason:string;ruleId:string;source:string}
export interface InvoiceLine {journeyId:string;description:string;serviceDate:string;grossCents:number;netCents:number;taxCents:number;taxRate:7|19;taxReason:string;taxRuleId?:string;taxSource?:string;tariffSource?:string;tariffRevision?:string;calculationKm?:string;positions?:{code:string;quantity:string;unitCents:number;totalCents:number;label:string;source?:string}[]}
export interface Invoice {id:string;number:string;customerId:string;customerSnapshot:Customer;issuedAt:string;dueAt:string;dueAtVerified?:boolean;dueAtBasis?:string;lines:InvoiceLine[];grossCents:number;netCents:number;taxCents:number;status:'issued'|'cancelled';payments:Payment[];cancelledBy:string|null;createdAt:string;pdfHash:string;originalInvoiceId?:string|null}
export interface Payment {id:string;amountCents:number;date:string;note:string;createdAt:string}
export interface DtaCheck {id:string;invoiceId:string;createdAt:string;mode:'dry-run';status:'blocked';blockers:{code:string;message:string}[];payloadHash:string;format:'readiness-report';}
export interface AuditEvent {id:number;action:string;entityId:string;at:string;previousHash:string;hash:string;details:string}
export interface AppState {customers:Customer[];journeys:Journey[];invoices:Invoice[];dtaChecks:DtaCheck[];audit:AuditEvent[];csrfToken:string;mode:'demo';businessDate:string;version:string}
export interface TariffInput {article:'I'|'II';km:string;date:string;persons:number;contractConfirmed:boolean;approachKm?:string;approachEligible?:boolean;tunnelCrossings?:number;tunnelConfirmed?:boolean}
export interface TariffResult {article:'I'|'II';positions:{code:string;label:string;quantity:string;unitCents:number;totalCents:number;source:string}[];grossCents:number;explanation:string[];source:string;warnings:string[]}
