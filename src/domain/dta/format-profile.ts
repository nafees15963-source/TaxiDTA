import type {PayerRecord} from '../payers.js';
export const DTA_SPECIFICATION_SOURCE='https://www.gkv-datenaustausch.de/leistungserbringer/sonstige_leistungserbringer/sonstige_leistungserbringer.jsp';
/** Published format requirements are separate from implemented serializers and transport readiness. */
export function dtaFormatProfile(payer:PayerRecord,date:string){
 const calendar=new Date(date+'T12:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(calendar.valueOf())||calendar.toISOString().slice(0,10)!==date)throw new Error('Ungültiges Datum.');
 if(payer.isSynthetic)return {label:'Testdaten',version:null,detail:'Die Testkasse empfängt keine Abrechnungen.',sourceUrl:null,sendReady:false as const};
 if(payer.insurerType!=='statutory')return {label:'Individuelles Annahmeverfahren',version:null,detail:'Für diesen Empfänger ist keine §302-Formatvorgabe hinterlegt. Das vereinbarte Annahmeverfahren muss belegt sein.',sourceUrl:null,sendReady:false as const};
 const supported=date>='2026-01-01'&&date<='2026-12-31';
 return {label:supported?'§302 SGB V · TP5 · Technische Anlage 1, Version 21':'§302 SGB V · Formatstand zu prüfen',version:supported?'21':null,detail:supported?'Vorgabe: strukturierte Abrechnungs-Nutzdatei und separate Auftragsdatei; Verschlüsselung nach GKV-Vorgaben. Die vollständige Dateierzeugung und Übertragung sind noch nicht implementiert.':'Für dieses Datum ist im Programm noch kein geprüftes Formatprofil hinterlegt.',sourceUrl:DTA_SPECIFICATION_SOURCE,sendReady:false as const};
}
