import test from 'node:test';
import assert from 'node:assert/strict';
import { addCalendarDays, calculateInvoiceLine, calculateTariff, calculateTax, DomainError, parseDistance, parseMoney, splitGross } from '../src/domain/index.ts';
import type { Journey, TariffInput } from '../src/shared/types.ts';
const quote = (km: string, article: 'I'|'II'='I', extra: Partial<TariffInput>={}) => calculateTariff({ km, article, date: '2026-10-22', persons:1, contractConfirmed:true, ...extra });
const error = (code:string) => (value:unknown) => value instanceof DomainError && value.code===code;

test('A1: official uploaded Art I / II single-person 20 km golden values and positions', () => {
  const a=quote('20'); const b=quote('20','II');
  assert.equal(a.grossCents,5259); assert.equal(b.grossCents,5174);
  assert.deepEqual(a.positions.map(x=>[x.code,x.quantity,x.totalCents]), [['510100','1',1400],['513000','17',3859]]);
  assert.deepEqual(b.positions.map(x=>[x.code,x.quantity]), [['510131','1'],['513131','17']]);
});
test('A2: first 3 km included once; km 4 adds exactly one extra kilometre', () => {
  for (const km of ['1','2','3']) { assert.equal(quote(km).grossCents,1400); assert.equal(quote(km).positions.length,1); }
  assert.equal(quote('4').grossCents,1627); assert.equal(quote('4','II').grossCents,1622);
  assert.throws(()=>quote('0'),error('ZERO_DISTANCE'));
  assert.throws(()=>quote('-1'),error('INVALID_DECIMAL'));
  assert.throws(()=>quote('3.01'),error('KM_ROUNDING_UNVERIFIED'));
});
test('Anfahrt entitlement and 8 / 9 km cap from uploaded tariff page 1',()=>{
  assert.equal(quote('20','I',{approachKm:'8',approachEligible:true}).grossCents,6171);
  assert.equal(quote('20','I',{approachKm:'9',approachEligible:true}).grossCents,6171);
  assert.equal(quote('20','I',{approachKm:'9',approachEligible:true}).positions.at(-1)?.quantity,'8');
  assert.throws(()=>quote('20','I',{approachKm:'8'}),error('APPROACH_UNCONFIRMED'));
});
test('Contract, persons, policy dates, actual toll evidence fail closed',()=>{
  assert.throws(()=>quote('20','I',{contractConfirmed:false}),error('CONTRACT_UNCONFIRMED'));
  assert.throws(()=>quote('20','I',{persons:2}),error('MULTIPERSON_NOT_RELEASED'));
  assert.throws(()=>quote('20','I',{date:'2025-12-31'}),error('POLICY_DATE_UNVERIFIED'));
  assert.throws(()=>quote('20','I',{date:'2027-01-01'}),error('POLICY_DATE_UNVERIFIED'));
  assert.throws(()=>quote('20','I',{date:'2026-02-30'}),error('INVALID_DATE'));
  assert.throws(()=>quote('20','I',{tunnelCrossings:1}),error('TUNNEL_UNCONFIRMED'));
  assert.throws(()=>quote('20','I',{tunnelCrossings:1,tunnelConfirmed:true}),error('TUNNEL_ACTUAL_AMOUNT_MISSING'));
});
const tax = (km:string,sameMunicipality:boolean|null=false,kind:Journey['kind']='taxi',vehicle:Journey['vehicle']='taxi')=>calculateTax({date:'2026-10-22',km,sameMunicipality,kind,vehicle});
test('§12 UStG supported 2026 demo policy exact 50km boundary and municipal exception',()=>{
  for(const km of ['3','20','49.99','50','50.00']) assert.equal(tax(km).rate,7);
  assert.equal(tax('50.01').rate,19); assert.equal(tax('60',true).rate,7); assert.equal(tax('60',false).rate,19);
  assert.equal(tax('50',null).rate,7);
  assert.throws(()=>tax('50.01',null),error('MUNICIPALITY_REQUIRED'));
  assert.throws(()=>tax('0'),error('ZERO_DISTANCE'));
  assert.throws(()=>tax('20',false,'medical','rental'),error('RENTAL_TAX_UNVERIFIED'));
  assert.equal(tax('20',false,'courier').rate,19); assert.equal(tax('20',true,'laboratory').rate,19);
});
test('Decimal parsers reject floating notation, overprecision, separators and overflow',()=>{
  assert.equal(parseMoney('52,59'),5259); assert.equal(parseMoney('0.01'),1);
  assert.equal(parseDistance('50.01'),5001);
  for(const x of ['1e3','NaN','Infinity','1,234.00','-1','1.001','1.',' 1','1 ']) assert.throws(()=>parseMoney(x),error('INVALID_DECIMAL'));
  assert.throws(()=>parseMoney('9999999999999999999999'),error('AMOUNT_TOO_LARGE'));
});
test('Gross/net separation never adds VAT to already gross tariff amounts',()=>{
  assert.deepEqual(splitGross(5259,7),{netCents:4915,taxCents:344});
  assert.deepEqual(splitGross(11900,19),{netCents:10000,taxCents:1900});
  for(let gross=1;gross<10000;gross++) { const split=splitGross(gross,7); assert.equal(split.netCents+split.taxCents,gross); }
});
test('28 calendar days independent of DST and month/leap boundary',()=>{
  assert.equal(addCalendarDays('2026-10-22',28),'2026-11-19');
  assert.equal(addCalendarDays('2026-12-20',28),'2027-01-17');
  assert.equal(addCalendarDays('2024-02-01',28),'2024-02-29');
  assert.equal(addCalendarDays('2026-03-15',28),'2026-04-12');
  assert.throws(()=>addCalendarDays('2026-02-29',28),error('INVALID_DATE'));
});
test('Medical invoice snapshot rejects invented quote and missing prescription',()=>{
  const journey:Journey={id:'test',customerId:'fiction',kind:'medical',date:'2026-10-22',from:'Test A',to:'Test B',km:'20',vehicle:'taxi',sameMunicipality:false,grossCents:5259,description:'Fiktive Testfahrt',tariff:'I',contractConfirmed:true,prescriptionConfirmed:true,receiptNumber:'TEST-1',invoiceId:null,createdAt:'2026-10-22T12:00:00Z'};
  const line=calculateInvoiceLine(journey); assert.equal(line.grossCents,5259); assert.equal(line.taxRate,7); assert.equal(line.positions?.[1]?.quantity,'17');
  assert.match(line.positions?.[1]?.source ?? '', /Art I_ab 01\.01\.2026\.pdf, Seite 1/);
  assert.match(line.tariffSource ?? '', /Art I_ab 01\.01\.2026\.pdf/);
  assert.equal(line.tariffRevision,'T&M-I-2026-01-01-demo-policy-2026');
  assert.equal(line.taxRuleId,'DE-2026-USTG12-2-10-50KM');
  assert.match(line.taxSource ?? '', /§ 12 Abs\. 2 Nr\. 10 UStG/);
  assert.equal(line.calculationKm,'20');
  assert.throws(()=>calculateInvoiceLine({...journey,grossCents:5260}),error('TARIFF_AMOUNT_MISMATCH'));
  assert.throws(()=>calculateInvoiceLine({...journey,prescriptionConfirmed:false}),error('PRESCRIPTION_UNCONFIRMED'));
});
