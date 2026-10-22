import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {renderInvoicePdf} from '../server/pdf.js';
import type {Invoice} from '../src/shared/types.js';

// Text and bounding-box verification is optional on machines without Poppler.
// A present validator failing to parse the actual PDF is a test failure, never a skip.
const poppler=spawnSync('pdftotext',['-v'],{encoding:'utf8'});
const missingPoppler=Boolean(poppler.error&&(poppler.error as NodeJS.ErrnoException).code==='ENOENT');
function invoice(name:string,address:string):Invoice{return{
 id:'00000000-0000-4000-8000-000000000001',number:'IT-2026-000001',customerId:'00000000-0000-4000-8000-000000000002',
 customerSnapshot:{id:'00000000-0000-4000-8000-000000000002',name,address,kind:'private',createdAt:'2026-10-22T12:00:00Z'},
 issuedAt:'2026-10-22',dueAt:'2026-11-19',dueAtVerified:true,lines:[{journeyId:'00000000-0000-4000-8000-000000000003',description:'Fiktive Prüfleistung',serviceDate:'2026-10-20',grossCents:10700,netCents:10000,taxCents:700,taxRate:7,taxReason:'Fiktive Testbeförderung'}],grossCents:10700,netCents:10000,taxCents:700,status:'issued',payments:[],cancelledBy:null,createdAt:'2026-10-22T12:00:00Z',pdfHash:'',originalInvoiceId:null
};}
async function validate(name:string,address:string,expectedTokens:string[]){
 const dir=mkdtempSync(join(tmpdir(),'taxidta-pdf-'));try{
  const path=join(dir,'invoice.pdf');writeFileSync(path,await renderInvoicePdf(invoice(name,address)));
  const text=execFileSync('pdftotext',['-layout',path,'-'],{encoding:'utf8',maxBuffer:10_000_000});
  for(const token of [...expectedTokens,'Testrechnung','Fiktive Prüfleistung','107,00','19.11.2026'])assert.ok(text.includes(token),`Missing PDF text: ${token}`);
  const bbox=execFileSync('pdftotext',['-bbox-layout',path,'-'],{encoding:'utf8',maxBuffer:10_000_000});
  const pages=Array.from(bbox.matchAll(/<page\b[^>]*>([\s\S]*?)<\/page>/g),m=>m[1]);assert.ok(pages.length>=1);
  for(const page of pages){
   const words=Array.from(page.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g),m=>({yMin:Number(m[2]),yMax:Number(m[4]),text:m[5]}));
   const recipient=words.filter(w=>/Adresszeile-|STARTADRESSE|ADRESSENDE|Langname/.test(w.text));
   assert.ok(recipient.every(w=>w.yMax<740),'Recipient text must stay above the reserved footer');
   const heading=words.find(w=>w.text==='Testrechnung');
   if(heading&&recipient.length)assert.ok(Math.max(...recipient.map(w=>w.yMax))<heading.yMin,'Recipient must end before the invoice heading');
  }
  return pages.length;
 }finally{rmSync(dir,{recursive:true,force:true});}
}

test('long allowed recipient names and addresses remain complete without overlapping title or footer',{skip:missingPoppler?'Poppler pdftotext is not installed':false},async()=>{
 const name='Empfängerprüfung '+Array(14).fill('Langname').join(' ');
 const lines=Array.from({length:35},(_,i)=>`Adresszeile-${String(i+1).padStart(2,'0')}`);
 assert.ok(name.length<=160&&lines.join('\n').length<=600);
 const pages=await validate(name,lines.join('\n'),lines);assert.ok(pages>=2);
});

test('explicit blank lines in an allowed address paginate without losing the address end or invoice',{skip:missingPoppler?'Poppler pdftotext is not installed':false},async()=>{
 const address='STARTADRESSE\n'+'\n'.repeat(550)+'ADRESSENDE';assert.ok(address.length<=600);
 const pages=await validate('Fiktiver Stresstestkunde',address,['STARTADRESSE','ADRESSENDE']);assert.ok(pages>=5);
});
