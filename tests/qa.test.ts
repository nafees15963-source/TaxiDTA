import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../server/store.js';
import type {Journey} from '../src/shared/types.js';
function fixture(){
 const store=new Store(':memory:');
 const c=store.addCustomer({name:'Prüfkunde (fiktiv)',kind:'private',address:'Testort'});
 const journey=(overrides:Partial<Journey>={})=>store.addJourney({customerId:c.id,kind:'taxi',date:'2026-10-20',from:'Testort A',to:'Testort B',km:'20',vehicle:'taxi',sameMunicipality:false,grossCents:5259,description:'Fiktive Testfahrt',tariff:null,contractConfirmed:false,prescriptionConfirmed:false,receiptNumber:null,...overrides});
 return{store,journey};
}
test('cancellation cannot commit if a payment arrives while its PDF is being prepared',async()=>{
 const {store,journey}=fixture();try{
  const invoice=await store.issueInvoice([journey().id],'2026-10-22');
  const cancellation=store.cancelInvoice(invoice.id,'Fiktiver Erfassungsfehler');
  // Let the cancellation validate and begin asynchronous PDF work, without running its commit.
  await Promise.resolve();
  store.addPayment(invoice.id,{amountCents:1000,date:'2026-10-22',note:'Zahlung während PDF-Erstellung'});
  await assert.rejects(cancellation,/Zahlung|zwischenzeitlich/);
  assert.equal(store.invoice(invoice.id).status,'issued');
  assert.equal(store.invoice(invoice.id).payments.length,1);
  assert.equal(store.invoices().length,1);
 }finally{store.close();}
});
test('duplicate journey detection canonicalizes decimal kilometre spelling',()=>{
 const{store,journey}=fixture();try{
  journey();
  for(const km of ['20.0','20,00','020'])assert.throws(()=>journey({km}),/doppelte Fahrt/);
  assert.equal(store.journeys().length,1);
 }finally{store.close();}
});
test('future invoices and payments cannot create misleading chronological or paid records',async()=>{
 const{store,journey}=fixture();try{
  const j=journey();
  await assert.rejects(store.issueInvoice([j.id],'2026-10-23'),/Geschäftstag/);
  assert.equal(store.invoices().length,0);
  const invoice=await store.issueInvoice([j.id],'2026-10-22');
  assert.equal(invoice.number,'IT-2026-000001');
  assert.throws(()=>store.addPayment(invoice.id,{amountCents:100,date:'2026-10-23',note:'Fiktive Zukunft'}),/zukünftiger/);
  assert.equal(store.invoice(invoice.id).payments.length,0);
 }finally{store.close();}
});
test('replayed partial payment command cannot double-book a lost response',async()=>{
 const{store,journey}=fixture();try{
  const invoice=await store.issueInvoice([journey().id],'2026-10-22');
  const input={amountCents:1000,date:'2026-10-22',note:'Fiktiver Zahlungseingang'};
  const first=store.addPayment(invoice.id,input,'payment-command-1');
  const retry=store.addPayment(invoice.id,input,'payment-command-1');
  assert.equal(first.payments[0].id,retry.payments[0].id);
  assert.equal(retry.payments.length,1);
  assert.throws(()=>store.addPayment(invoice.id,{...input,amountCents:2000},'payment-command-1'),/anderen Zahlung/);
  assert.equal(store.invoice(invoice.id).payments.length,1);
  // A distinct, consciously confirmed same-day equal payment remains possible.
  assert.equal(store.addPayment(invoice.id,input,'payment-command-2').payments.length,2);
 }finally{store.close();}
});
test('medical credit positions reconcile quantity times unit to credited total',async()=>{
 const{store,journey}=fixture();try{
  const payer=store.addCustomer({name:'Prüfkasse (fiktiv)',kind:'payer',address:'Testort'});
  const j=journey({customerId:payer.id,kind:'medical',tariff:'I',contractConfirmed:true,prescriptionConfirmed:true,receiptNumber:'QA-001'});
  const invoice=await store.issueInvoice([j.id],'2026-10-22');
  const credit=await store.cancelInvoice(invoice.id,'Fiktiver Erfassungsfehler');
  assert.equal(credit.grossCents,-5259);
  for(const p of credit.lines[0].positions??[])assert.equal(Number(p.quantity)*p.unitCents,p.totalCents);
 }finally{store.close();}
});
test('payment API validates and persists idempotency headers across retries',async()=>{
 const{createApp}=await import('../server/app.js');
 const{store,journey}=fixture();const app=await createApp({store});const server=app.listen(0,'127.0.0.1');
 await new Promise<void>(r=>server.once('listening',r));
 const address=server.address();if(!address||typeof address==='string')throw new Error('Testserver fehlt');
 try{
  const invoice=await store.issueInvoice([journey().id],'2026-10-22');
  const endpoint=`http://127.0.0.1:${address.port}/api/invoices/${invoice.id}/payments`;
  const body=JSON.stringify({amountCents:1000,date:'2026-10-22',note:'Fiktiver Eingang'});
  const post=(key:string)=>fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':store.csrfToken,'idempotency-key':key},body});
  assert.equal((await post('x')).status,422);
  const results=await Promise.all([post('api-payment-command'),post('api-payment-command')]);
  assert.ok(results.every(r=>r.status===201));
  assert.equal(store.invoice(invoice.id).payments.length,1);
 }finally{await new Promise<void>(r=>server.close(()=>r()));store.close();}
});
