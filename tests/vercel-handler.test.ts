import test from 'node:test';
import assert from 'node:assert/strict';
import {handleVercel} from '../hosted/vercel-handler.js';
const env={SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_example_only_1234',SUPABASE_OWNER_ID:'11111111-1111-4111-8111-111111111111',TAXIDTA_SESSION_KEY:'a'.repeat(64),VERCEL_URL:'taxidta.example.test'};
test('Vercel rewrites bootstrap to hosted API without a local server',async()=>{
 const response=await handleVercel(new Request('https://taxidta.example.test/api/handler?route=setup/status'),env);
 assert.equal(response.status,200);assert.equal((await response.json()).financialStorage,'cloud-supabase');assert.match(response.headers.get('set-cookie')!,/HttpOnly/);
});
test('Vercel rejects unconfigured origins and HTTP',async()=>{
 for(const url of ['https://attacker.test/api/setup/status','http://taxidta.example.test/api/setup/status'])assert.equal((await handleVercel(new Request(url),env)).status,503);
});
test('caller-provided identity cannot authorize financial access',async()=>{
 const response=await handleVercel(new Request('https://taxidta.example.test/api/state',{headers:{'oai-authenticated-user-id':env.SUPABASE_OWNER_ID}}),env);
 assert.equal(response.status,401);
});
test('Vercel mutation preserves origin validation through rewrite',async()=>{
 const response=await handleVercel(new Request('https://taxidta.example.test/api/handler?route=billing-cases',{method:'POST',headers:{origin:'https://attacker.test','content-type':'application/json'},body:'{}'}),env);
 assert.equal(response.status,403);
});
