import test from 'node:test';
import assert from 'node:assert/strict';
import {handleApi,type HostedEnvironment} from '../hosted/handler.js';
const env:HostedEnvironment={SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_example_only_1234',SUPABASE_OWNER_ID:'11111111-1111-4111-8111-111111111111',TAXIDTA_SESSION_KEY:'a'.repeat(64)};
const origin='https://example.test';
test('hosted API refuses missing Sites identity and does not expose data or configuration',async()=>{
 for(const path of ['/api/state','/api/payers','/api/setup/status']){
  const r=await handleApi(new Request(origin+path),env);assert.equal(r.status,401);assert.equal((await r.json()).code,'SITE_AUTH_REQUIRED');assert.equal(r.headers.get('cache-control'),'no-store');
 }
});
test('cross-origin mutation is rejected before credentials or financial input are processed',async()=>{
 const r=await handleApi(new Request(origin+'/api/billing-cases',{method:'POST',headers:{'oai-authenticated-user-id':'owner','origin':'https://attacker.test','content-type':'application/json'},body:'{}'}),env);assert.equal(r.status,403);
});
test('bootstrap returns only public auth view, encrypted HttpOnly cookie and no tokens',async()=>{
 const r=await handleApi(new Request(origin+'/api/setup/status',{headers:{'oai-authenticated-user-id':'owner'}}),env);assert.equal(r.status,200);
 const payload=await r.json();assert.equal(payload.auth.phase,'anonymous');assert.equal(payload.financialStorage,'cloud-supabase');assert.equal(payload.productionReady,false);assert.equal(payload.cookie,undefined);
 const serialized=JSON.stringify(payload);assert.ok(!serialized.includes(env.TAXIDTA_SESSION_KEY));assert.ok(!serialized.includes(env.SUPABASE_PUBLISHABLE_KEY));assert.ok(!serialized.includes(env.SUPABASE_OWNER_ID));
 const cookie=r.headers.get('set-cookie')!;assert.match(cookie,/^__Host-taxidta_session=/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);
});
test('financial reads fail closed without owner MFA cookie even with platform identity',async()=>{
 const r=await handleApi(new Request(origin+'/api/state',{headers:{'oai-authenticated-user-id':'owner'}}),env);assert.equal(r.status,401);assert.equal((await r.json()).code,'AUTH_SESSION_EXPIRED');
});
