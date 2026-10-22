/**
 * Bounded reader for official TP5 Kostenträger/KOTR structure, not a billing-DTA serializer.
 * Evidence: Anhang 3 V09, 07.10.2026, §§7/8, pp12–19/21/29, opened22.10.2026.
 * Unsupported optional groups are rejected, never skipped. No trust/activation is inferred.
 */
export const KE_V09_SOURCE = 'https://www.gkv-datenaustausch.de/media/dokumente/leistungserbringer_1/sonstige_leistungserbringer/technische_anlagen_aktuell_4/20261007_TP5_TA1_Anhang3_V009.pdf';
export interface SourceSpan { start:number; end:number; segmentIndex:number }
export interface KeElement { components:string[]; span:SourceSpan }
export interface KeSegment { tag:string; elements:KeElement[]; span:SourceSpan }
export interface KeValidity { from:string; until:string|null }
export interface KeLink { kind:'01'|'02'|'03'|'09'; targetIk:string; providerGroup:string|null; clearingIk:string|null; deliveryKind:string|null; medium:string|null; state:string|null; kvDistrict:string|null; billingCode:string|null; tariffKey:string|null; subProcedure:string|null; validity:KeValidity|null; span:SourceSpan }
export interface KeInstitution { ik:string; shortName:string; vknr:string|null; validity:KeValidity; functionCode:'01'|'02'|'03'|'04'; links:KeLink[]; names:string[]; address:{kind:string;zip:string;city:string;street:string|null}; span:SourceSpan }
export interface KeV09Document { specification:'TP5-Anhang3-V09-2026-10-07'; profile:'bounded-KOTR-no-transport'; source:string; hasUna:boolean; segments:KeSegment[]; institutions:KeInstitution[]; productionReady:false; trust:'unverified-input' }
export class KeParseError extends Error {
 constructor(public readonly code:string,message:string,public readonly offset:number,public readonly segmentIndex:number,public readonly field?:number){super(message);this.name='KeParseError';}
}
const fail=(code:string,message:string,segment?:KeSegment,field?:number):never=>{
 const span=field===undefined?segment?.span:segment?.elements[field-1]?.span??segment?.span;
 throw new KeParseError(code,message,span?.start??0,span?.segmentIndex??0,field);
};
function rawParts(raw:string,delimiter:string):{raw:string;start:number;end:number}[]{
 const parts:{raw:string;start:number;end:number}[]=[];let start=0;
 for(let i=0;i<raw.length;i++){
  if(raw[i]==='?'){if(i+1>=raw.length)throw new KeParseError('TRUNCATED_RELEASE','Abgebrochenes Aufhebungszeichen.',i,0);i++;continue;}
  if(raw[i]===delimiter){parts.push({raw:raw.slice(start,i),start,end:i});start=i+1;}
 }
 parts.push({raw:raw.slice(start),start,end:raw.length});return parts;
}
function decode(raw:string){return raw.replace(/\?([:+?' ])/g,'$1');}
function tokenize(text:string):{segments:KeSegment[];hasUna:boolean}{
 if(typeof text!=='string'||text.length===0||text.length>1_000_000)throw new KeParseError('FILE_SIZE','Bitte eine nichtleere KE-Textdatei bis 1 MB verwenden.',0,0);
 const bad=text.search(/[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F-\u009F\u0100-\uFFFF]/);
 if(bad>=0)throw new KeParseError('CHARSET_UNSUPPORTED','Dieser Leser unterstützt nur bereits korrekt dekodierten UNOC/Latin-1-Text ohne Steuerzeichen.',bad,0);
 let cursor=0;const hasUna=text.startsWith('UNA');
 if(hasUna){if(!text.startsWith("UNA:+,? '"))throw new KeParseError('UNA_UNSUPPORTED','Nur die amtlichen Standard-Trennzeichen UNA:+,? werden unterstützt.',0,0);cursor=9;}
 const segments:KeSegment[]=[];
 while(cursor<text.length){
  while(text[cursor]==='\r'||text[cursor]==='\n')cursor++;
  if(cursor===text.length)break;
  const start=cursor;let finished=false;
  for(;cursor<text.length;cursor++){
   const c=text[cursor];
   if(c==='?'&&cursor+1<text.length){
    if(!":+?' ".includes(text[cursor+1]))throw new KeParseError('INVALID_RELEASE','Aufhebungszeichen ist nur vor einem unterstützten Steuerzeichen erlaubt.',cursor,segments.length);
    cursor++;continue;
   }
   if(c==='\r'||c==='\n')throw new KeParseError('CONTROL_IN_SEGMENT','Zeilenumbruch innerhalb eines Segments ist nicht erlaubt.',cursor,segments.length);
   if(c==="'"){finished=true;break;}
  }
  if(!finished)throw new KeParseError('UNTERMINATED_SEGMENT','Segmentende fehlt oder Aufhebungszeichen ist abgebrochen.',start,segments.length);
  const raw=text.slice(start,cursor);const fields=rawParts(raw,'+');const tag=fields.shift()!.raw;
  if(!/^[A-Z]{3}$/.test(tag))throw new KeParseError('SEGMENT_TAG','Ungültige Segmentkennung.',start,segments.length);
  const segmentIndex=segments.length;
  segments.push({tag,elements:fields.map(field=>({components:rawParts(field.raw,':').map(p=>decode(p.raw)),span:{start:start+field.start,end:start+field.end,segmentIndex}})),span:{start,end:cursor+1,segmentIndex}});
  cursor++;
  if(segments.length>50_000)throw new KeParseError('SEGMENT_LIMIT','Zu viele Segmente für diesen begrenzten Leser.',cursor,segmentIndex);
 }
 return {segments,hasUna};
}
function count(s:KeSegment,min:number,max=min){if(s.elements.length<min||s.elements.length>max)fail('FIELD_COUNT',`${s.tag}: falsche Anzahl Datenfelder (${min}${max===min?'':` bis ${max}`} erwartet).`,s);}
function value(s:KeSegment,field:number){const e=s.elements[field-1];if(!e)return '';if(e.components.length!==1)fail('COMPOSITE_NOT_ALLOWED',`${s.tag}: unerwartete Komponenten im Datenfeld.`,s,field);return e.components[0];}
function fixed(s:KeSegment,field:number,length:number,numeric=false,optional=false){const v=value(s,field);if(optional&&v==='')return null;if(v.length!==length||(numeric&&!/^\d+$/.test(v)))fail('FIELD_LENGTH_TYPE',`${s.tag}, Feld ${field}: ${length} ${numeric?'Ziffern':'Zeichen'} erforderlich.`,s,field);return v;}
function variable(s:KeSegment,field:number,max:number,optional=false){const v=value(s,field);if(optional&&v==='')return null;if(v.length<1||v.length>max)fail('FIELD_LENGTH_TYPE',`${s.tag}, Feld ${field}: 1 bis ${max} Zeichen erforderlich.`,s,field);return v;}
function key<T extends string>(s:KeSegment,field:number,allowed:readonly T[]):T {const v=value(s,field);if(!(allowed as readonly string[]).includes(v))fail('KEY_UNSUPPORTED',`${s.tag}, Feld ${field}: Schlüssel ist unbekannt oder in diesem Profil nicht unterstützt.`,s,field);return v as T;}
function date8(s:KeSegment,field:number,optional=false){const raw=fixed(s,field,8,true,optional);if(raw===null)return null;const date=`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`;const parsed=new Date(`${date}T12:00:00Z`);if(Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)fail('INVALID_DATE',`${s.tag}: ungültiges Kalenderdatum.`,s,field);return date;}
function validity(s:KeSegment):KeValidity {count(s,1,2);const from=date8(s,1)!;const until=date8(s,2,true);if(until!==null&&until<from)fail('INVALID_VALIDITY','VDT: Ende liegt vor Beginn.',s,2);return{from,until};}
function readLink(s:KeSegment):KeLink {
 count(s,2,11);
 const kind=key(s,1,['01','02','03','09'] as const);const targetIk=fixed(s,2,9,true)!;
 const providerGroup=fixed(s,3,1,true,true);if(providerGroup!==null&&providerGroup!=='5')fail('PROCEDURE_UNSUPPORTED','Nur Leistungserbringergruppe 5 wird unterstützt.',s,3);
 const clearingIk=fixed(s,4,9,true,true);const deliveryKind=fixed(s,5,2,true,true);
 if(deliveryKind!==null&&!['07','21','24','26','27','28','29','30'].includes(deliveryKind))fail('KEY_UNSUPPORTED','Unbekannte Art der Datenlieferung.',s,5);
 if((kind==='02'||kind==='03')&&deliveryKind!=='07'&&deliveryKind!=='30')fail('LINK_DELIVERY_MISMATCH','VKG 02/03 ist nur mit Datenlieferung 07 oder 30 gültig.',s,5);
 const medium=fixed(s,6,1,true,true);if(medium!==null&&!['1','2','3','4','5','6','7','9'].includes(medium))fail('KEY_UNSUPPORTED','Unbekanntes Übermittlungsmedium.',s,6);
 const state=fixed(s,7,2,true,true);if(state!==null&&state!=='99'&&(Number(state)<1||Number(state)>16))fail('KEY_UNSUPPORTED','Unbekannter Bundeslandschlüssel.',s,7);
 const kvDistrict=fixed(s,8,2,true,true);const billingCode=fixed(s,9,2,false,true);
 if(billingCode!==null&&!/^[A-Z0-9]{2}$/.test(billingCode))fail('FIELD_LENGTH_TYPE','VKG-Abrechnungscode muss zweistellig alphanumerisch sein.',s,9);
 if(billingCode===null)fail('BILLING_CODE_REQUIRED','VKG-Abrechnungscode ist nach der TP5-Fußnote obligatorisch.',s,9);
 const tariffKey=fixed(s,10,5,true,true);
 const subProcedure=fixed(s,11,3,false,true);if(subProcedure!==null&&(billingCode!=='30'||!['HKP','HHH'].includes(subProcedure)))fail('SUBPROCEDURE_UNSUPPORTED','Unterverfahren wird nur bei Code 30 als HKP/HHH unterstützt.',s,11);
 return{kind,targetIk,providerGroup,clearingIk,deliveryKind,medium,state,kvDistrict,billingCode,tariffKey,subProcedure,validity:null,span:s.span};
}
/** Parses a real, deliberately incomplete official KE/KOTR profile. It grants no trust or activation. */
export function parseKeV09Subset(text:string):KeV09Document {
 const {segments,hasUna}=tokenize(text);let at=0;
 const take=(tag:string):KeSegment=>{const s=segments[at];if(!s||s.tag!==tag)fail('SEGMENT_ORDER',`${tag} an dieser Stelle erwartet.`,s??segments.at(-1));at++;return s;};
 const current=()=>segments[at]?.tag;
 const head=take('UNB');count(head,7);
 const syntax=head.elements[0].components;if(syntax.length!==2||syntax[0]!=='UNOC'||syntax[1]!=='3')fail('SYNTAX_UNSUPPORTED','Nur UNOC:3 wird unterstützt.',head,1);
 fixed(head,2,9,true);fixed(head,3,9,true);
 const stamp=head.elements[3].components;if(stamp.length!==2||!/^\d{6}$/.test(stamp[0])||!/^\d{4}$/.test(stamp[1])||Number(stamp[1].slice(0,2))>23||Number(stamp[1].slice(2))>59)fail('FILE_DATE_TIME','UNB-Datum/Uhrzeit ist ungültig.',head,4);
 // Narrow century profile, explicit rather than guessing historical/future century from two-digit dates.
 const fullDate=`20${stamp[0].slice(0,2)}-${stamp[0].slice(2,4)}-${stamp[0].slice(4,6)}`;const d=new Date(`${fullDate}T12:00:00Z`);if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==fullDate)fail('INVALID_DATE','UNB-Datum ist ungültig.',head,4);
 const fileNumber=fixed(head,5,5)!;if(value(head,6)!=='')fail('FREE_FIELD_UNSUPPORTED','Das UNB-Freifeld muss in diesem Profil leer sein.',head,6);
 const filename=fixed(head,7,11)!;if(!/^(AO|EK|BK|IK|BN|LK|GK|SB)05(0[1-9]|1[0-2]|Q[1-4])\d{2}KE\d$/.test(filename))fail('FILENAME_PROCEDURE','Kein unterstützter offizieller TP5-KE-Dateiname.',head,7);
 const institutions:KeInstitution[]=[];const seenIk=new Set<string>();const seenRefs=new Set<string>();
 while(current()==='UNH'){
  const first=at;const unh=take('UNH');count(unh,2);const reference=fixed(unh,1,5)!;
  if(seenRefs.has(reference))fail('DUPLICATE_REFERENCE','Nachrichtenreferenz ist doppelt.',unh,1);seenRefs.add(reference);
  if(unh.elements[1].components.join(':')!=='KOTR:02:001:KV'||unh.elements[1].components.length!==4)fail('MESSAGE_UNSUPPORTED','Nur KOTR:02:001:KV wird unterstützt.',unh,2);
  const idk=take('IDK');count(idk,3,4);const ik=fixed(idk,1,9,true)!;if(seenIk.has(ik))fail('DUPLICATE_IK','IK ist in der Datei doppelt; keine stille Zusammenführung.',idk,1);seenIk.add(ik);
  key(idk,2,['99']);const shortName=variable(idk,3,30)!;const vknr=fixed(idk,4,5,true,true);const vdt=validity(take('VDT'));
  const fkt=take('FKT');count(fkt,1);const functionCode=key(fkt,1,['01','02','03','04'] as const);
  if(current()==='KTO')fail('OPTIONAL_GROUP_UNSUPPORTED','KTO ist in diesem begrenzten Leser noch nicht unterstützt.',segments[at]);
  const links:KeLink[]=[];
  while(current()==='VKG'){const link=readLink(take('VKG'));if(current()==='VDT')link.validity=validity(take('VDT'));links.push(link);}
  const nam=take('NAM');count(nam,2,5);key(nam,1,['01','02','03']);const names=[variable(nam,2,30)!];for(let n=3;n<=nam.elements.length;n++)names.push(variable(nam,n,30,true)??'');
  if(current()==='VDT')validity(take('VDT'));
  const ans=take('ANS');count(ans,3,4);const address={kind:key(ans,1,['1','2','3']),zip:fixed(ans,2,5,true)!,city:variable(ans,3,25)!,street:variable(ans,4,30,true)};
  if(current()==='VDT')validity(take('VDT'));
  if(current()!=='UNT')fail('OPTIONAL_GROUP_UNSUPPORTED','Dieses Profil unterstützt nur eine ANS und keine ASP/UEM/DFU-Gruppen; nichts wird übersprungen.',segments[at]);
  const unt=take('UNT');count(unt,2);
  // Full-width six-digit control counters are a conservative subset of the numeric counter field.
  const segmentCount=fixed(unt,1,6,true)!;if(Number(segmentCount)!==at-first)fail('SEGMENT_COUNT','UNT-Segmentanzahl stimmt nicht.',unt,1);
  if(fixed(unt,2,5)!==reference)fail('REFERENCE_MISMATCH','UNT-Referenz passt nicht zu UNH.',unt,2);
  institutions.push({ik,shortName,vknr,validity:vdt,functionCode,links,names,address,span:{start:unh.span.start,end:unt.span.end,segmentIndex:unh.span.segmentIndex}});
 }
 if(institutions.length===0)fail('EMPTY_INTERCHANGE','Mindestens eine KOTR-Nachricht ist erforderlich.',segments[at]);
 const end=take('UNZ');count(end,2);if(Number(fixed(end,1,6,true))!==institutions.length)fail('MESSAGE_COUNT','UNZ-Nachrichtenanzahl stimmt nicht.',end,1);if(fixed(end,2,5)!==fileNumber)fail('REFERENCE_MISMATCH','UNZ-Dateinummer passt nicht zu UNB.',end,2);
 if(at!==segments.length)fail('TRAILING_SEGMENTS','Weitere Daten nach UNZ sind nicht erlaubt.',segments[at]);
 return{specification:'TP5-Anhang3-V09-2026-10-07',profile:'bounded-KOTR-no-transport',source:KE_V09_SOURCE,hasUna,segments,institutions,productionReady:false,trust:'unverified-input'};
}
const escape=(value:string)=>value.replace(/[?:+']/g,c=>`?${c}`);
/** Serializes the structured segment model, revalidating the complete bounded grammar first. */
export function serializeKeV09Subset(document:KeV09Document):string {
 if(document.specification!=='TP5-Anhang3-V09-2026-10-07'||document.profile!=='bounded-KOTR-no-transport')throw new KeParseError('PROFILE_UNSUPPORTED','Nicht unterstütztes Leserprofil.',0,0);
 const text=(document.hasUna?"UNA:+,? '\r\n":'')+document.segments.map(s=>s.tag+'+'+s.elements.map(e=>e.components.map(escape).join(':')).join('+')+"'").join('\r\n')+'\r\n';
 parseKeV09Subset(text);return text;
}

export interface IkReadinessInput {
 cardIk:string; date:string;
 roles?:{payerIk?:string;physicalIk?:string;decryptingIk?:string;paperIk?:string};
 evidence?:{sourceVersion?:string;effectiveFrom?:string;effectiveUntil?:string;officialArchiveVerified?:boolean;authorizationConfirmed?:boolean;transportConfirmed?:boolean;paperConfirmed?:boolean;certificate?:{ik:string;validFrom:string;validUntil:string;chainVerified:boolean;revoked:boolean}};
}
/** Evidence checklist only: caller assertions can never turn this demo into a live authorization. */
export function inspectIkReadiness(input:IkReadinessInput){
 const blockers:{code:string;message:string}[]=[{code:'DEMO_ONLY',message:'Produktivversand ist in dieser lokalen Version technisch gesperrt; ein Prüfbericht ist keine DTA-Datei.'}];
 const add=(code:string,message:string)=>blockers.push({code,message});const roles=input?.roles??{};const e=input?.evidence??{};const selectedDate=input?.date??'';
 if(!/^\d{9}$/.test(input?.cardIk??''))add('CARD_IK_INVALID','Karten-IK muss als neunstellige Zeichenfolge vorliegen. Syntax beweist keine Existenz.');
 for(const [name,label]of Object.entries({payerIk:'Kostenträger',physicalIk:'physischer Transportempfänger',decryptingIk:'berechtigter Entschlüsselungsempfänger',paperIk:'Papierannahmestelle'}))if(!/^\d{9}$/.test(roles[name as keyof typeof roles]??''))add(`ROLE_${name.toUpperCase()}_MISSING`,`${label}: getrennte, belegte IK-Zuordnung fehlt.`);
 const validDate=(v:string|undefined)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(`${v}T12:00:00Z`))&&new Date(`${v}T12:00:00Z`).toISOString().slice(0,10)===v;
 if(!validDate(input?.date))add('DATE_INVALID','Gültiger Prüf-/Leistungsstichtag fehlt.');
 if(!e.sourceVersion||!e.officialArchiveVerified)add('SOURCE_UNVERIFIED','Unveränderte amtliche Originalquelle, Hash, Fassung und geprüfte Herkunft fehlen.');
 if(!validDate(e.effectiveFrom)||(e.effectiveFrom??'')>selectedDate||(e.effectiveUntil!==undefined&&(!validDate(e.effectiveUntil)||e.effectiveUntil<selectedDate)))add('SOURCE_DATE_UNVERIFIED','Quellgeltung am Stichtag ist nicht nachgewiesen.');
 if(!e.authorizationConfirmed)add('PARTICIPATION_UNVERIFIED','Eigene Teilnahme-/Vertrags- und Empfängerfreigabe fehlt.');
 if(!e.transportConfirmed)add('TRANSPORT_UNVERIFIED','Zugelassenes Protokoll und konkreter Empfängerendpunkt sind nicht bestätigt.');
 if(!e.paperConfirmed)add('PAPER_UNVERIFIED','Aktuelle Papierannahme und Beleganforderungen sind nicht bestätigt.');
 const cert=e.certificate;
 if(!cert)add('CERTIFICATE_MISSING','Verifiziertes Empfängerzertifikat fehlt.');
 else{
  if(cert.ik!==roles.decryptingIk)add('CERTIFICATE_WRONG_IK','Zertifikat gehört nicht zum berechtigten Entschlüsselungsempfänger.');
  if(!cert.chainVerified||cert.revoked)add('CERTIFICATE_UNTRUSTED','Zertifikatskette oder Sperrstatus ist nicht freigegeben.');
  if(!validDate(cert.validFrom)||!validDate(cert.validUntil)||cert.validFrom>selectedDate||cert.validUntil<selectedDate)add('CERTIFICATE_EXPIRED','Zertifikat ist am Stichtag nicht nachweislich gültig.');
 }
 return{status:'blocked' as const,productionReady:false as const,roles:{cardIk:input?.cardIk??'',...roles},source:KE_V09_SOURCE,blockers};
}
