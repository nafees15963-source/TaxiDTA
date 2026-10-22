import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectIkReadiness,KeParseError,parseKeV09Subset,serializeKeV09Subset} from '../src/domain/ik.ts';
// All identifiers and values are synthetic. These are adversarial grammar tests,
// not an official acceptance fixture and not evidence of an active routing directory.
function message(reference='00001',ik='900000002',name='Fiktiv'){
 const segments=[`UNH+${reference}+KOTR:02:001:KV'`,`IDK+${ik}+99+Fiktive Stelle'`,"VDT+20260601'","FKT+04'",`NAM+01+${name}'`,"ANS+1+00000+Testort+Testweg 1'"];
 return [...segments,`UNT+${String(segments.length+1).padStart(6,'0')}+${reference}'`];
}
function document(messages:string[][]=[message()]){return ["UNB+UNOC:3+900000001+999999999+261022:1200+00001++GK051026KE0'",...messages.flat(),`UNZ+${String(messages.length).padStart(6,'0')}+00001'`,''].join('\r\n');}
const code=(expected:string)=>(e:unknown)=>e instanceof KeParseError&&e.code===expected;
test('KE escaped release parity does not swallow a real field separator or segment end',()=>{
 const combined=parseKeV09Subset(document([message('00001','900000002',"Name???+X?:Y?'Z")]));
 assert.deepEqual(combined.institutions[0].names,["Name?+X:Y'Z"]);
 assert.deepEqual(parseKeV09Subset(serializeKeV09Subset(combined)).institutions[0].names,combined.institutions[0].names);
 const separated=parseKeV09Subset(document([message('00001','900000002','Name??+Zusatz')]));
 assert.deepEqual(separated.institutions[0].names,['Name?','Zusatz']);
});
test('KE multiple messages enforce both unique institutions and envelope references',()=>{
 const valid=parseKeV09Subset(document([message(),message('00002','900000003')]));
 assert.equal(valid.institutions.length,2);
 assert.throws(()=>parseKeV09Subset(document([message(),message('00002','900000002')])),code('DUPLICATE_IK'));
 assert.throws(()=>parseKeV09Subset(document([message(),message('00001','900000003')])),code('DUPLICATE_REFERENCE'));
 assert.throws(()=>parseKeV09Subset(document().replace('UNZ+000001+00001','UNZ+000001+00002')),code('REFERENCE_MISMATCH'));
});
test('KE rejects inverted validity, embedded controls, unrepresentable Unicode and missing terminators',()=>{
 assert.throws(()=>parseKeV09Subset(document().replace('VDT+20260601','VDT+20260601+20260531')),code('INVALID_VALIDITY'));
 assert.throws(()=>parseKeV09Subset(document().replace('Testweg','Test\nweg')),code('CONTROL_IN_SEGMENT'));
 assert.throws(()=>parseKeV09Subset(document().replace('Testweg','Test\tweg')),code('CHARSET_UNSUPPORTED'));
 assert.throws(()=>parseKeV09Subset(document().replace('Fiktiv\'','Fiktiv🙂\'')),code('CHARSET_UNSUPPORTED'));
 assert.throws(()=>parseKeV09Subset(document().trimEnd().replace("UNZ+000001+00001'","UNZ+000001+00001")),code('UNTERMINATED_SEGMENT'));
});
test('IK checklist refuses expired source, invalid date, revoked certificate and absent roles without granting live readiness',()=>{
 const roles={payerIk:'900000003',physicalIk:'900000004',decryptingIk:'900000005',paperIk:'900000006'};
 const result=inspectIkReadiness({cardIk:'900000002',date:'2026-10-22',roles,evidence:{sourceVersion:'09',officialArchiveVerified:true,effectiveFrom:'2026-06-01',effectiveUntil:'2026-10-21',certificate:{ik:'900000005',validFrom:'2026-06-01',validUntil:'2026-12-31',chainVerified:true,revoked:true}}});
 assert.ok(result.blockers.some(b=>b.code==='SOURCE_DATE_UNVERIFIED'));
 assert.ok(result.blockers.some(b=>b.code==='CERTIFICATE_UNTRUSTED'));
 assert.equal(result.productionReady,false);
 const invalid=inspectIkReadiness({cardIk:'900000002',date:'2026-02-30',roles:{...roles,decryptingIk:undefined}});
 assert.ok(invalid.blockers.some(b=>b.code==='DATE_INVALID'));
 assert.ok(invalid.blockers.some(b=>b.code==='ROLE_DECRYPTINGIK_MISSING'));
 assert.equal(invalid.status,'blocked');
});
