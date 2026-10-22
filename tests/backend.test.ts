import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import type { Customer,Journey,Invoice } from '../src/shared/types.js';
async function fixture(){
 const store=new Store(':memory:');const app=await createApp({store});const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));const base=`http://127.0.0.1:${(server.address()as AddressInfo).port}`;
 const request=async(path:string,body?:unknown,extra:Record<string,string>={})=>fetch(`${base}${path}`,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','x-csrf-token':store.csrfToken,...extra},body:body===undefined?undefined:JSON.stringify(body)});
 const close=async()=>{await new Promise<void>(r=>server.close(()=>r()));store.close();};
 const customer=store.addCustomer({name:'Testfirma (fiktiv)',kind:'business',address:'Demoallee 1\n00000 Musterstadt'});
 const add=(n:number,overrides:Partial<Journey>={})=>store.addJourney({customerId:customer.id,kind:'taxi',date:'2026-10-20',from:`Testort ${n}`,to:'Demoziel',km:'20',vehicle:'taxi',sameMunicipality:false,grossCents:5259,description:`Testleistung ${n}`,tariff:null,contractConfirmed:false,prescriptionConfirmed:false,receiptNumber:null,...overrides});
 return {store,base,request,close,customer,add};
}

test('API enforces CSRF, origin, hostname and strict server-side payload validation',async()=>{
 const f=await fixture();try{
  let r=await fetch(`${f.base}/api/customers`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'X',kind:'private',address:'X'})});assert.equal(r.status,403);
  r=await f.request('/api/customers',{name:'X',kind:'private',address:'X'},{origin:'https://attacker.example'});assert.equal(r.status,403);
  const spoofedStatus=await new Promise<number>((resolve,reject)=>{const request=httpRequest(`${f.base}/api/state`,{headers:{Host:'attacker.example'}},response=>{response.resume();resolve(response.statusCode??0);});request.on('error',reject);request.end();});assert.equal(spoofedStatus,403);
  r=await f.request('/api/customers',{name:'',kind:'private',address:'X',admin:true});assert.equal(r.status,422);
  r=await fetch(`${f.base}/API/customers`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Bypass',kind:'private',address:'X'})});assert.equal(r.status,404);assert.equal(f.store.customers().length,1);
  r=await f.request('/api/state');assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy')??'',/frame-ancestors 'none'/);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');
 }finally{await f.close();}
});

test('transactional numbers remain unique under parallel invoice requests; dates and immutable snapshots are correct',async()=>{
 const f=await fixture();try{
  const journeys=Array.from({length:8},(_,i)=>f.add(i));
  const responses=await Promise.all(journeys.map(j=>f.request('/api/invoices',{journeyIds:[j.id],issuedAt:'2026-10-22'})));
  assert.ok(responses.every(r=>r.status===201));const invoices=await Promise.all(responses.map(r=>r.json()))as Invoice[];
  assert.equal(new Set(invoices.map(i=>i.number)).size,8);assert.equal(invoices[0].number,'IT-2026-000001');assert.equal(invoices[7].number,'IT-2026-000008');
  assert.equal(invoices[0].dueAt,'2026-11-19');assert.equal(invoices[0].grossCents,5259);assert.equal(invoices[0].netCents+invoices[0].taxCents,5259);
  assert.throws(()=>f.store.db.prepare('UPDATE invoices SET number=? WHERE id=?').run('mutated',invoices[0].id),/immutable/);
  assert.equal(f.store.verifyAudit(),true);
 }finally{await f.close();}
});

test('repeated invoice commands return the same result and prevent double billing',async()=>{
 const f=await fixture();try{
  const journey=f.add(1);const body={journeyIds:[journey.id],issuedAt:'2026-10-22'};
  const first=await f.request('/api/invoices',body,{'idempotency-key':'test-command-123'});assert.equal(first.status,201);const invoice=await first.json()as Invoice;
  const second=await f.request('/api/invoices',body,{'idempotency-key':'test-command-123'});assert.equal(second.status,201);assert.equal((await second.json()as Invoice).id,invoice.id);
  const duplicate=await f.request('/api/invoices',body);assert.equal(duplicate.status,409);assert.equal(f.store.invoices().length,1);
  const other=f.add(2);const conflict=await f.request('/api/invoices',{...body,journeyIds:[other.id]},{'idempotency-key':'test-command-123'});assert.equal(conflict.status,409);
 }finally{await f.close();}
});

test('PDF is an archived actual PDF with matching SHA256; payments do not regenerate original bytes',async()=>{
 const f=await fixture();try{
  const invoice=await f.store.issueInvoice([f.add(1).id],'2026-10-22');const r=await f.request(`/api/invoices/${invoice.id}/pdf`);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/pdf');
  const bytes=Buffer.from(await r.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok(bytes.length>1500);assert.equal(createHash('sha256').update(bytes).digest('hex'),invoice.pdfHash);
  await f.request(`/api/invoices/${invoice.id}/payments`,{amountCents:1000,date:'2026-10-22',note:'Fiktive Teilzahlung'});
  assert.deepEqual(f.store.pdf(invoice.id),bytes);
 }finally{await f.close();}
});

test('partial payments have a real ledger; overpayments, negatives and backdated payments are blocked',async()=>{
 const f=await fixture();try{
  const invoice=await f.store.issueInvoice([f.add(1).id],'2026-10-22');
  let r=await f.request(`/api/invoices/${invoice.id}/payments`,{amountCents:2000,date:'2026-10-22',note:'Teilzahlung'});assert.equal(r.status,201);assert.equal((await r.json()as Invoice).payments.length,1);
  r=await f.request(`/api/invoices/${invoice.id}/payments`,{amountCents:3260,date:'2026-10-22',note:''});assert.equal(r.status,422);
  r=await f.request(`/api/invoices/${invoice.id}/payments`,{amountCents:-1,date:'2026-10-22',note:''});assert.equal(r.status,422);
  r=await f.request(`/api/invoices/${invoice.id}/payments`,{amountCents:1,date:'2026-10-21',note:''});assert.equal(r.status,422);
  r=await f.request(`/api/invoices/${invoice.id}/cancel`,{reason:'Test'});assert.equal(r.status,422);assert.equal(f.store.invoices().length,1);
 }finally{await f.close();}
});

test('cancellation adds a negative original-linked document without deleting or releasing the journey',async()=>{
 const f=await fixture();try{
  const j=f.add(1);const invoice=await f.store.issueInvoice([j.id],'2026-10-22');const original=f.store.pdf(invoice.id);
  const r=await f.request(`/api/invoices/${invoice.id}/cancel`,{reason:'Fiktiver Erfassungsfehler'});assert.equal(r.status,201);const credit=await r.json()as Invoice;
  assert.equal(credit.originalInvoiceId,invoice.id);assert.equal(credit.grossCents,-invoice.grossCents);assert.equal(credit.number,'IT-2026-000002');assert.equal(f.store.invoice(invoice.id).status,'cancelled');assert.deepEqual(f.store.pdf(invoice.id),original);
  assert.equal(f.store.journeys()[0].invoiceId,invoice.id);
  assert.equal((await f.request(`/api/invoices/${invoice.id}/cancel`,{reason:'Nochmals'})).status,409);
  assert.equal((await f.request('/api/invoices',{journeyIds:[j.id],issuedAt:'2026-10-22'})).status,409);
  assert.equal((await f.request(`/api/invoices/${invoice.id}/payments`,{amountCents:10,date:'2026-10-22',note:''})).status,422);
 }finally{await f.close();}
});

test('medical tariff is recalculated and missing prescription blocks invoice; receipt duplicates blocked',async()=>{
 const f=await fixture();try{
  const payer=f.store.addCustomer({name:'Demokasse (fiktiv)',kind:'payer',address:'Demoort'});
  const j=f.add(1,{customerId:payer.id,kind:'medical',tariff:'I',grossCents:1,contractConfirmed:true,prescriptionConfirmed:false,receiptNumber:'DEMO-1'});
  assert.equal(j.grossCents,5259);
  const blocked=await f.request('/api/invoices',{journeyIds:[j.id],issuedAt:'2026-10-22'});assert.equal(blocked.status,422);
  assert.throws(()=>f.add(2,{receiptNumber:'DEMO-1'}),/Belegnummer/);
  assert.throws(()=>f.add(1,{customerId:payer.id,kind:'medical',tariff:'I',contractConfirmed:true,prescriptionConfirmed:false,receiptNumber:'DEMO-2'}),/doppelte Fahrt/);
 }finally{await f.close();}
});

test('DTA readiness remains blocked with explicit missing evidence and never claims a real transmission',async()=>{
 const f=await fixture();try{
  const payer=f.store.addCustomer({name:'Demokasse (fiktiv)',kind:'payer',address:'Demoort'});
  const j=f.add(1,{customerId:payer.id,kind:'medical',tariff:'II',contractConfirmed:true,prescriptionConfirmed:true,receiptNumber:'DEMO-5'});
  const invoice=await f.store.issueInvoice([j.id],'2026-10-22');assert.equal(invoice.grossCents,5174);assert.equal(invoice.dueAtVerified,false);assert.match(invoice.dueAtBasis??'',/Kassenfrist nicht verifiziert/);
  const r=await f.request(`/api/invoices/${invoice.id}/dta-check`,{});assert.equal(r.status,201);const result=await r.json();assert.equal(result.status,'blocked');assert.equal(result.mode,'dry-run');assert.equal(result.format,'readiness-report');assert.ok(result.blockers.some((b:{code:string})=>b.code==='ROUTING_UNVERIFIED'));assert.ok(result.blockers.some((b:{code:string})=>b.code==='CERTIFICATE_MISSING'));
  const report=await f.request(`/api/invoices/${invoice.id}/dta-check/report`);assert.equal(report.status,200);assert.match(report.headers.get('content-disposition')??'',/\.json/);assert.equal((await f.request('/api/dta/send',{})).status,404);
  const normal=await f.store.issueInvoice([f.add(2).id],'2026-10-22');assert.equal((await f.request(`/api/invoices/${normal.id}/dta-check`,{})).status,422);
 }finally{await f.close();}
});

test('mixed tax collective invoices preserve actual service dates and sum exact cents',async()=>{
 const f=await fixture();try{
  const a=f.add(1,{date:'2026-10-02',km:'50',grossCents:10700});const b=f.add(2,{date:'2026-10-12',kind:'courier',km:'20',grossCents:11900});
  const invoice=await f.store.issueInvoice([a.id,b.id],'2026-10-22');assert.deepEqual(invoice.lines.map(l=>l.taxRate),[7,19]);assert.equal(invoice.grossCents,22600);assert.equal(invoice.netCents,20000);assert.equal(invoice.taxCents,2600);assert.deepEqual(invoice.lines.map(l=>l.serviceDate),['2026-10-02','2026-10-12']);
  const ambiguous=f.add(3,{km:'60',sameMunicipality:null});const r=await f.request('/api/invoices',{journeyIds:[ambiguous.id],issuedAt:'2026-10-22'});assert.equal(r.status,422);
 }finally{await f.close();}
});

test('CSV is a real minimal financial export and does not contain customer or medical names',async()=>{
 const f=await fixture();try{
  await f.store.issueInvoice([f.add(1).id],'2026-10-22');const r=await f.request('/api/export.csv');const csv=await r.text();assert.equal(r.status,200);assert.match(csv,/IT-2026-000001/);assert.ok(!csv.includes(f.customer.name));assert.ok(!csv.includes('Testleistung'));
 }finally{await f.close();}
});

test('SQLite persists complete financial originals across process-style reopen and audit rejects updates',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'taxidta-store-'));const dbPath=join(directory,'demo.sqlite');
 let store=new Store(dbPath);try{
  await store.seed();const originals=store.invoices();assert.equal(originals.length,3);const bytes=store.pdf(originals[0].id);assert.throws(()=>store.db.exec("UPDATE audit SET action='tampered' WHERE id=1"),/append-only/);store.close();
  store=new Store(dbPath);await store.seed();assert.equal(store.invoices().length,3);assert.deepEqual(store.pdf(originals[0].id),bytes);assert.equal(store.verifyAudit(),true);
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('collective invoice rejects mixed recipients before allocating a number or locking any journey',async()=>{
 const f=await fixture();try{
  const a=f.add(1);const other=f.store.addCustomer({name:'Andere Testfirma',kind:'business',address:'Demoort'});const b=f.add(2,{customerId:other.id});
  const blocked=await f.request('/api/invoices',{journeyIds:[a.id,b.id],issuedAt:'2026-10-22'});assert.equal(blocked.status,422);assert.equal(f.store.invoices().length,0);assert.ok(f.store.journeys().every(j=>j.invoiceId===null));
  const good=await f.store.issueInvoice([a.id],'2026-10-22');assert.equal(good.number,'IT-2026-000001');
 }finally{await f.close();}
});

test('independent SQLite connections reserve distinct numbers and failed duplicate race cannot recycle a number',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'taxidta-concurrency-'));const path=join(directory,'demo.sqlite');const a=new Store(path);const b=new Store(path);
 try{
  const customer=a.addCustomer({name:'Paralleltest',kind:'business',address:'Demoort'});
  const journey=(n:number)=>a.addJourney({customerId:customer.id,kind:'taxi',date:'2026-10-20',from:`Demoort ${n}`,to:'Testziel',km:'20',vehicle:'taxi',sameMunicipality:false,grossCents:5259,description:'Paralleltest',tariff:null,contractConfirmed:false,prescriptionConfirmed:false,receiptNumber:null});
  const j1=journey(1),j2=journey(2);const invoices=await Promise.all([a.issueInvoice([j1.id],'2026-10-22'),b.issueInvoice([j2.id],'2026-10-22')]);assert.equal(new Set(invoices.map(i=>i.number)).size,2);
  const j3=journey(3);const attempts=await Promise.allSettled([a.issueInvoice([j3.id],'2026-10-22'),b.issueInvoice([j3.id],'2026-10-22')]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(a.invoices().length,3);
  const after=await a.issueInvoice([journey(4).id],'2026-10-22');assert.equal(after.number,'IT-2026-000005');assert.equal(a.verifyAudit(),true);
 }finally{a.close();b.close();rmSync(directory,{recursive:true,force:true});}
});

test('CSV cells neutralize dangerous text formulas while preserving numeric credit values',async()=>{
 const {csvCell}=await import('../server/export.js');
 for(const payload of ['=HYPERLINK("https://attacker.example")','+SUM(1,2)','-cmd','@SUM(1,2)','\t =1+1'])assert.ok(csvCell(payload).startsWith('"\''));
 assert.equal(csvCell(-5259),'"-5259"');assert.equal(csvCell('Unkritisch; "Zitat"'),'"Unkritisch; ""Zitat"""');
});

test('draft edit fixes missing medical evidence, preserves identity and recalculates authoritative amount before billing',async()=>{
 const f=await fixture();try{
  const payer=f.store.addCustomer({name:'Prüfkasse (fiktiv)',kind:'payer',address:'Demoort'});
  const original=f.add(1,{customerId:payer.id,kind:'medical',tariff:'I',contractConfirmed:true,prescriptionConfirmed:false,receiptNumber:'EDIT-001'});
  assert.equal((await f.request('/api/invoices',{journeyIds:[original.id],issuedAt:'2026-10-22'})).status,422);
  const {id:journeyId,invoiceId:_invoiceId,createdAt,...input}=original;
  const r=await f.request(`/api/journeys/${journeyId}/update`,{...input,prescriptionConfirmed:true,km:'21',grossCents:1,description:'Korrigierte fiktive Krankenfahrt'});
  assert.equal(r.status,200);const updated=await r.json()as Journey;assert.equal(updated.id,journeyId);assert.equal(updated.createdAt,createdAt);assert.equal(updated.grossCents,5486);assert.equal(updated.prescriptionConfirmed,true);
  const audit=f.store.state().audit.find(a=>a.action==='journey.updated')!;const details=JSON.parse(audit.details);assert.ok(details.changedFields.includes('prescriptionConfirmed'));assert.ok(!audit.details.includes(updated.description));
  const invoice=await f.request('/api/invoices',{journeyIds:[journeyId],issuedAt:'2026-10-22'});assert.equal(invoice.status,201);assert.equal((await invoice.json()as Invoice).grossCents,5486);
 }finally{await f.close();}
});

test('draft edit blocks invoice-bound journeys after issue and cancellation without changing archived original',async()=>{
 const f=await fixture();try{
  const j=f.add(1);const {id:journeyId,invoiceId:_invoiceId,createdAt:_createdAt,...input}=j;
  const invoice=await f.store.issueInvoice([journeyId],'2026-10-22');const original=f.store.pdf(invoice.id);
  const payload={...input,description:'Verbotene nachträgliche Änderung'};
  assert.equal((await f.request(`/api/journeys/${journeyId}/update`,payload)).status,409);
  await f.store.cancelInvoice(invoice.id,'Fiktiver Erfassungsfehler');
  assert.equal((await f.request(`/api/journeys/${journeyId}/update`,payload)).status,409);assert.equal(f.store.journeys()[0].description,j.description);assert.equal(f.store.journeys()[0].invoiceId,invoice.id);assert.deepEqual(f.store.pdf(invoice.id),original);
 }finally{await f.close();}
});

test('draft update excludes itself from uniqueness but atomically rejects duplicate routes and receipt numbers',async()=>{
 const f=await fixture();try{
  const first=f.add(1,{receiptNumber:'EDIT-101'}),second=f.add(2,{receiptNumber:'EDIT-102'});
  const {id:journeyId,invoiceId:_invoiceId,createdAt:_createdAt,...input}=second;
  assert.equal((await f.request(`/api/journeys/${journeyId}/update`,input)).status,200);
  assert.equal((await f.request(`/api/journeys/${journeyId}/update`,{...input,receiptNumber:first.receiptNumber})).status,409);
  assert.equal((await f.request(`/api/journeys/${journeyId}/update`,{...input,from:first.from,km:'20,00'})).status,409);
  assert.deepEqual(f.store.journeys().find(j=>j.id===journeyId),second);assert.equal(f.store.verifyAudit(),true);
 }finally{await f.close();}
});

test('draft edit during PDF creation aborts invoice commit instead of binding stale amounts',async()=>{
 const f=await fixture();try{
  const j=f.add(1);const {id:journeyId,invoiceId:_invoiceId,createdAt:_createdAt,...input}=j;
  const pending=f.store.issueInvoice([journeyId],'2026-10-22');await Promise.resolve();
  f.store.updateJourney(journeyId,{...input,grossCents:10700,description:'Zwischenzeitlich korrigierte fiktive Leistung'});
  await assert.rejects(pending,/während der Rechnungserstellung geändert/);assert.equal(f.store.invoices().length,0);assert.equal(f.store.journeys()[0].invoiceId,null);
  const invoice=await f.store.issueInvoice([journeyId],'2026-10-22');assert.equal(invoice.grossCents,10700);assert.equal(invoice.number,'IT-2026-000002');
 }finally{await f.close();}
});

test('API rejects 21 description lines without truncation and accepts 20 explicit lines intact',async()=>{
 const f=await fixture();try{
  const template=f.add(1);const {id:_id,invoiceId:_invoiceId,createdAt:_createdAt,...input}=template;
  const bad=Array.from({length:21},(_,i)=>`Fiktive Leistung ${i+1}`).join('\n');assert.ok(bad.length<=500);
  const blocked=await f.request('/api/journeys',{...input,from:'Neue Teststrecke',description:bad});assert.equal(blocked.status,422);assert.match((await blocked.json()).error,/20 Zeilen/);assert.equal(f.store.journeys().length,1);
  const good=Array.from({length:20},(_,i)=>`Fiktive Leistung ${i+1}`).join('\n');
  const accepted=await f.request('/api/journeys',{...input,from:'Neue Teststrecke',description:good});assert.equal(accepted.status,201);assert.equal((await accepted.json()as Journey).description,good);
 }finally{await f.close();}
});

test('direct Store invoice callers cannot bypass description line bounds and a 20-line description survives billing',async()=>{
 const f=await fixture();try{
  const bad=Array.from({length:21},(_,i)=>`Fiktive Leistung ${i+1}`).join('\r\n');const j=f.add(1,{description:bad});
  await assert.rejects(f.store.issueInvoice([j.id],'2026-10-22'),/20 Zeilen/);assert.equal(f.store.invoices().length,0);assert.equal(f.store.journeys()[0].description,bad);assert.equal(f.store.journeys()[0].invoiceId,null);
  const good=Array.from({length:20},(_,i)=>`Fiktive Leistung ${i+1}`).join('\n');const valid=f.add(2,{description:good});
  const invoice=await f.store.issueInvoice([valid.id],'2026-10-22');assert.equal(invoice.number,'IT-2026-000001');assert.equal(invoice.lines[0].description,good);assert.ok(f.store.pdf(invoice.id).length>1500);
 }finally{await f.close();}
});

test('createApp honors configured database path instead of touching the default demo database',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'taxidta-configured-db-'));const originalCwd=process.cwd();const originalPath=process.env.TAXIDTA_DB_PATH;const configuredPath=join(directory,'isolated','configured.sqlite');let app:Awaited<ReturnType<typeof createApp>>|undefined;
 try{
  // This controlled working directory makes a fallback to work/taxidta.sqlite observable.
  process.chdir(directory);process.env.TAXIDTA_DB_PATH=configuredPath;
  app=await createApp();assert.equal(app.locals.store.path,configuredPath);assert.equal(existsSync(configuredPath),true);assert.equal(existsSync(join(directory,'work','taxidta.sqlite')),false);
  app.locals.store.addCustomer({name:'Isolierter Konfigurationstest (fiktiv)',kind:'private',address:'Demoort'});assert.equal(app.locals.store.customers().length,1);
 }finally{
  app?.locals.store.close();process.chdir(originalCwd);if(originalPath===undefined)delete process.env.TAXIDTA_DB_PATH;else process.env.TAXIDTA_DB_PATH=originalPath;rmSync(directory,{recursive:true,force:true});
 }
});
