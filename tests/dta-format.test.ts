import test from 'node:test';
import assert from 'node:assert/strict';
import {getPayer,searchPayers} from '../src/domain/payers.js';
import {dtaFormatProfile} from '../src/domain/dta/format-profile.js';
test('published 2026 format applies only to statutory insurers and never enables sending',()=>{
 const payer=getPayer('audi-bkk')!;
 assert.equal(dtaFormatProfile(payer,'2026-10-25').version,'21');
 assert.equal(dtaFormatProfile(payer,'2026-10-25').sendReady,false);
 assert.equal(dtaFormatProfile(payer,'2027-05-01').version,null);
 assert.throws(()=>dtaFormatProfile(payer,'2026-02-30'));
 const privatePayer=searchPayers('Allianz',100).results.find(p=>p.insurerType==='private')!;
 assert.ok(privatePayer);assert.equal(dtaFormatProfile(privatePayer,'2026-10-25').version,null);
 assert.equal(dtaFormatProfile(getPayer('demo-kasse')!,'2026-10-25').version,null);
});
