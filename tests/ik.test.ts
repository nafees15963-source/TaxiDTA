import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectIkReadiness,KeParseError,parseKeV09Subset,serializeKeV09Subset} from '../src/domain/ik.ts';
import {SYNTHETIC_KE_V09} from '../src/domain/ik-demo.ts';
const fixture=()=>SYNTHETIC_KE_V09;
const error=(code:string)=>(e:unknown)=>e instanceof KeParseError&&e.code===code;
test('KE V09 bounded actual KOTR structure parses synthetic records, roles and exact source offsets',()=>{
 const text=fixture();const doc=parseKeV09Subset(text);assert.equal(doc.productionReady,false);assert.equal(doc.trust,'unverified-input');assert.equal(doc.institutions.length,1);
 const record=doc.institutions[0];assert.equal(record.ik,'900000002');assert.equal(record.validity.from,'2026-06-01');assert.equal(record.names[0],'Fiktiv+Labor');
 assert.deepEqual(record.links.map(l=>[l.kind,l.targetIk]),[['01','900000003'],['02','900000004'],['03','900000005'],['09','900000006']]);
 const vkg=doc.segments.find(s=>s.tag==='VKG')!;assert.equal(text.slice(vkg.span.start,vkg.span.end),"VKG+01+900000003+5++++++00'");assert.equal(text.slice(vkg.elements[1].span.start,vkg.elements[1].span.end),'900000003');
});
test('KE parser-model-serializer roundtrip uses structured components and retains escaped delimiters',()=>{
 const original=fixture();const model=parseKeV09Subset(original);assert.equal(serializeKeV09Subset(model),original);
 const segment=model.segments.find(s=>s.tag==='NAM')!;segment.elements[1].components[0]="Fiktiv:Test?Name'";
 const altered=serializeKeV09Subset(model);assert.match(altered,/Fiktiv\?:Test\?\?Name\?'/);assert.equal(parseKeV09Subset(altered).institutions[0].names[0],"Fiktiv:Test?Name'");
});
test('KE refuses incorrect record lengths with precise error offset and field',()=>{
 const raw=fixture().replace('900000002+99','90000002+99');
 assert.throws(()=>parseKeV09Subset(raw),(e:unknown)=>e instanceof KeParseError&&e.code==='FIELD_LENGTH_TYPE'&&e.field===1&&e.offset===raw.indexOf('90000002+99'));
 assert.throws(()=>parseKeV09Subset(fixture().replace('Fiktive Testkasse', 'x'.repeat(31))),error('FIELD_LENGTH_TYPE'));
});
test('KE enforces mandatory order, IDK validity, sequence control and message identity',()=>{
 assert.throws(()=>parseKeV09Subset(fixture().replace("VDT+20260601'\r\nFKT+04'","FKT+04'\r\nVDT+20260601'")),error('SEGMENT_ORDER'));
 assert.throws(()=>parseKeV09Subset(fixture().replace('20260601','20260230')),error('INVALID_DATE'));
 assert.throws(()=>parseKeV09Subset(fixture().replace('UNT+000011','UNT+000010')),error('SEGMENT_COUNT'));
 assert.throws(()=>parseKeV09Subset(fixture().replace('UNT+000011+00001','UNT+000011+00002')),error('REFERENCE_MISMATCH'));
 assert.throws(()=>parseKeV09Subset(fixture().replace('UNZ+000001','UNZ+000002')),error('MESSAGE_COUNT'));
});
test('KE rejects unsupported optional groups, different procedure, custom separators and malformed escapes',()=>{
 assert.throws(()=>parseKeV09Subset(fixture().replace("FKT+04'","FKT+04'\r\nKTO+++Testbank'")),error('OPTIONAL_GROUP_UNSUPPORTED'));
 assert.throws(()=>parseKeV09Subset(fixture().replace('GK051026KE0','GK061026KE0')),error('FILENAME_PROCEDURE'));
 assert.throws(()=>parseKeV09Subset(fixture().replace('UNA:+,?', 'UNA;+,?')),error('UNA_UNSUPPORTED'));
 assert.throws(()=>parseKeV09Subset(fixture().replace('Fiktiv?+Labor','Fiktiv?X')) ,error('INVALID_RELEASE'));
 assert.throws(()=>parseKeV09Subset(fixture()+"IDK+900000002+99+Test'"),error('TRAILING_SEGMENTS'));
});
test('KE never equates physical and decrypting roles; invalid delivery kind for02/03 is rejected',()=>{
 const r=parseKeV09Subset(fixture()).institutions[0];assert.notEqual(r.links.find(l=>l.kind==='02')?.targetIk,r.links.find(l=>l.kind==='03')?.targetIk);
 assert.throws(()=>parseKeV09Subset(fixture().replace('900000004+5++07','900000004+5++28')),error('LINK_DELIVERY_MISMATCH'));
});
test('IK readiness requires every distinct role and refuses wrong certificate recipient and expiry',()=>{
 const missing=inspectIkReadiness({cardIk:'900000002',date:'2026-10-22'});assert.equal(missing.status,'blocked');assert.ok(missing.blockers.some(b=>b.code==='ROLE_DECRYPTINGIK_MISSING'));
 const report=inspectIkReadiness({cardIk:'900000002',date:'2026-10-22',roles:{payerIk:'900000003',physicalIk:'900000004',decryptingIk:'900000005',paperIk:'900000006'},evidence:{certificate:{ik:'900000004',validFrom:'2025-01-01',validUntil:'2026-10-21',chainVerified:true,revoked:false}}});
 assert.ok(report.blockers.some(b=>b.code==='CERTIFICATE_WRONG_IK'));assert.ok(report.blockers.some(b=>b.code==='CERTIFICATE_EXPIRED'));assert.equal(report.productionReady,false);
});
test('all asserted evidence can never override the technical no-live gate',()=>{
 const report=inspectIkReadiness({cardIk:'900000002',date:'2026-10-22',roles:{payerIk:'900000003',physicalIk:'900000004',decryptingIk:'900000005',paperIk:'900000006'},evidence:{sourceVersion:'09',effectiveFrom:'2026-06-01',officialArchiveVerified:true,authorizationConfirmed:true,transportConfirmed:true,paperConfirmed:true,certificate:{ik:'900000005',validFrom:'2026-06-01',validUntil:'2026-12-31',chainVerified:true,revoked:false}}});
 assert.deepEqual(report.blockers.map(b=>b.code),['DEMO_ONLY']);assert.equal(report.productionReady,false);assert.equal(report.status,'blocked');
});

test('KE TP5 footnote requires a billing code even when trailing fields are optional',()=>{
 assert.throws(()=>parseKeV09Subset(fixture().replace('900000003+5++++++00','900000003')),error('BILLING_CODE_REQUIRED'));
});
test('KE filename effective year is distinct from envelope creation year',()=>{
 const doc=parseKeV09Subset(fixture().replace('261022:1200','251022:1200'));
 assert.equal(doc.institutions.length,1);
});
