import {SupabaseDataClient} from '../server/supabase-data.js';
import {calculateTariff, DomainError} from '../src/domain/index.js';
import {csvCell} from '../server/export.js';
import { z } from 'zod';
import { createEdgeAuth, EdgeAuthError, type EdgeAuthEnvironment } from './edge-auth.js';
import { SupabaseCloudRepository } from './supabase-repository.js';
import { CloudStore, CloudStoreError } from './cloud-store.js';
import { billingCaseRequestSchema } from '../server/billing-case.js';
import { resolvePayer, searchPayers, payerRegistrySummary, PayerRegistryError } from '../server/payers.js';
import { buildUnsentDtaStatus } from '../src/domain/dta/status.js';
export type HostedEnvironment = EdgeAuthEnvironment;
const id=z.string().uuid();
const command=(request:Request)=>z.string().regex(/^[a-zA-Z0-9_-]{8,100}$/).optional().parse(request.headers.get('idempotency-key')??undefined);
async function body(request:Request){
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')??''))throw new CloudStoreError(415,'JSON-Eingabe erforderlich.');
  const reader=request.body?.getReader();if(!reader)throw new CloudStoreError(400,'Eingabe fehlt.');
  const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>150000){await reader.cancel();throw new CloudStoreError(413,'Eingabe zu groß.');}chunks.push(next.value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new CloudStoreError(400,'Ungültige JSON-Eingabe.');}
}
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Strict-Transport-Security':'max-age=31536000'};
const json=(value:unknown,status=200,cookie?:string)=>new Response(JSON.stringify(value),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8',...(cookie?{'Set-Cookie':cookie}:{})}});
/** Sites dispatch authenticates the outer owner-only audience; Supabase enforces the inner owner/MFA session. */
export async function handleApi(request:Request,env:HostedEnvironment):Promise<Response>{
 try{
  const siteUser=request.headers.get('oai-authenticated-user-id');
  if(!siteUser)return json({error:'Bitte zuerst bei ChatGPT anmelden.',code:'SITE_AUTH_REQUIRED'},401);
  const url=new URL(request.url);const path=url.pathname;
  if(!['GET','POST'].includes(request.method))return json({error:'Methode nicht unterstützt.'},405);
  if(request.method==='POST'&&request.headers.get('origin')!==url.origin)return json({error:'Anfrageherkunft nicht bestätigt.'},403);
  const auth=createEdgeAuth(env,request,siteUser);
  if(path==='/api/setup/status'&&request.method==='GET'){
   const result=await auth.bootstrap();return json({configured:true,projectHost:new URL(env.SUPABASE_URL).hostname,region:{reported:null,confirmed:null,expected:'eu-central-1',verified:false},ownerConfigured:true,ownIkConfigured:false,authRequired:true,productionReady:false,financialStorage:'cloud-supabase',dtaTransport:'blocked',auth:result.auth},200,result.cookie);
  }
  if(path.startsWith('/api/auth/')&&request.method==='POST'){
   const input=await body(request);const result=path==='/api/auth/login'?await auth.login(input):path==='/api/auth/enroll'?await auth.enroll():path==='/api/auth/verify'?await auth.verify(input):path==='/api/auth/cancel-enrollment'?await auth.cancelEnrollment(input):path==='/api/auth/logout'?await auth.logout():null;
   if(!result)return json({error:'Anmeldefunktion nicht vorhanden.'},404);
   return json({auth:result.auth,...(result.enrollment?{enrollment:result.enrollment}:{}),...(result.remoteLogoutConfirmed!==undefined?{remoteLogoutConfirmed:result.remoteLogoutConfirmed}:{})},200,result.cookie);
  }
  const session=await auth.requireMfa();const scope=session.userId;
  const repository=new SupabaseCloudRepository({url:env.SUPABASE_URL,publishableKey:env.SUPABASE_PUBLISHABLE_KEY,ownerId:scope,accessToken:session.accessToken,webSession:session.webSession});
  const store=new CloudStore(repository,{financialStorage:'cloud-supabase'});
  let value:unknown;let status=200;
  if(request.method==='GET'){
   if(path==='/api/export.csv'){const state=await store.state(scope);await session.assertActive();return new Response('\uFEFF'+[['Rechnungsnummer','Datum','Brutto_Cent','Status'],...state.invoices.map(i=>[i.number,i.issuedAt,i.grossCents,i.status])].map(row=>row.map(csvCell).join(';')).join('\r\n'),{headers:{...headers,'Set-Cookie':session.cookie,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename=taxidta-testrechnungen.csv'}});}
   else if(path==='/api/state')value={...await store.state(scope),csrfToken:session.csrfToken};
   else if(path==='/api/payers/summary')value=payerRegistrySummary();
   else if(path==='/api/payers')value=searchPayers(url.searchParams.get('q')??'',Number(url.searchParams.get('limit')??50));
   else if(path.startsWith('/api/payers/'))value=resolvePayer(decodeURIComponent(path.slice(12)));
   else{
    const match=path.match(/^\/api\/invoices\/([^/]+)\/(pdf|dta-status)$/);
    if(!match)return json({error:'API-Funktion nicht vorhanden.'},404);
    const invoice=await store.invoice(scope,id.parse(match[1]));
    if(match[2]==='pdf'){
     const bytes=await store.pdf(scope,invoice.id);await session.assertActive();
     return new Response(bytes as BodyInit,{headers:{...headers,'Set-Cookie':session.cookie,'Content-Type':'application/pdf','Content-Disposition':`inline; filename="${invoice.number}.pdf"`,'ETag':`"${invoice.pdfHash}"`}});
    }
    const state=await store.state(scope);value=buildUnsentDtaStatus(invoice,state.dtaChecks.find(c=>c.invoiceId===invoice.id)??null);
   }
  }else{
   const input=await body(request);status=201;
   if(path==='/api/setup/supabase/probe'){z.object({}).strict().parse(input);value={verification:await new SupabaseDataClient({url:env.SUPABASE_URL,publishableKey:env.SUPABASE_PUBLISHABLE_KEY}).verifySyntheticDatabase(session.accessToken)};}
   else if(path==='/api/customers')value=await store.addCustomer(scope,input as Parameters<CloudStore['addCustomer']>[1]);
   else if(path==='/api/tariff'){value=calculateTariff(z.object({article:z.enum(['I','II']),km:z.string().max(20),date:z.string(),persons:z.number().int().min(1).max(8),contractConfirmed:z.boolean(),approachKm:z.string().max(20).optional(),approachEligible:z.boolean().optional(),tunnelCrossings:z.number().int().min(0).max(100).optional(),tunnelConfirmed:z.boolean().optional()}).strict().parse(input));}
   else if(path==='/api/billing-cases'){
    const {payerId,...rest}=billingCaseRequestSchema.parse(input);value=await store.addBillingCase(scope,{...rest,payer:resolvePayer(payerId)},command(request));
   }else if(path==='/api/invoices/from-cases'){
    const v=z.object({caseIds:z.array(id).min(1).max(500),issuedAt:z.string()}).strict().parse(input);value=await store.issueCaseInvoice(scope,v.caseIds,v.issuedAt,command(request));
   }else{
    const edit=path.match(/^\/api\/billing-cases\/([^/]+)\/update$/);
    const invoice=path.match(/^\/api\/invoices\/([^/]+)\/(dta-check|cancel|payments)$/);
    if(edit){const {payerId,...rest}=billingCaseRequestSchema.parse(input);value=await store.updateBillingCase(scope,id.parse(edit[1]),{...rest,payer:resolvePayer(payerId)});}
    else if(invoice){const invoiceId=id.parse(invoice[1]);if(invoice[2]==='dta-check')value=await store.dtaCheck(scope,invoiceId);else if(invoice[2]==='cancel')value=await store.cancelInvoice(scope,invoiceId,z.object({reason:z.string().min(1).max(500)}).strict().parse(input).reason);else value=await store.addPayment(scope,invoiceId,z.object({amountCents:z.number().int().positive(),date:z.string(),note:z.string().max(200).default('')}).strict().parse(input),command(request));}
    else return json({error:'Diese Funktion ist online noch nicht eingerichtet.'},501);
   }
  }
  await session.assertActive();return json(value,status,session.cookie);
 }catch(error){
  if(error instanceof EdgeAuthError||error instanceof CloudStoreError||error instanceof PayerRegistryError)return json({error:error.message,code:error.code},error.status);
  if(error instanceof DomainError)return json({error:error.message},422);
  if(error instanceof z.ZodError)return json({error:'Bitte Eingaben und Pflichtfelder prüfen.'},422);
  return json({error:'Der Vorgang wurde nicht bestätigt. Bitte erneut anmelden oder später versuchen.'},503);
 }
}
