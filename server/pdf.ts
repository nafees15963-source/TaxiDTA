import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import type { Invoice } from '../src/shared/types.js';

const euros=(cents:number)=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(cents/100);
const date=(value:string)=>value.split('-').reverse().join('.');
const fontPaths=['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','/System/Library/Fonts/Supplemental/Arial.ttf','/Library/Fonts/Arial.ttf'];
const boldPaths=['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf','/System/Library/Fonts/Supplemental/Arial Bold.ttf'];

/** Generates an actual PDF. Its original bytes are archived before an invoice is returned. */
export async function renderInvoicePdf(invoice:Invoice,referenceNumber?:string):Promise<Buffer>{
 const doc=new PDFDocument({size:'A4',margins:{top:48,left:48,right:48,bottom:112},bufferPages:true,info:{Title:`TaxiDTA Testrechnung ${invoice.number}`,Author:'TaxiDTA Demo – ausschließlich erfundene Daten',Subject:'Keine gültige Rechnung; lokale Funktionsprüfung'}});
 const regular=fontPaths.find(existsSync),bold=boldPaths.find(existsSync);
 if(regular)doc.registerFont('Body',regular); if(bold)doc.registerFont('Strong',bold);
 const font=(strong=false)=>doc.font(strong?(bold?'Strong':'Helvetica-Bold'):(regular?'Body':'Helvetica'));
 const chunks:Buffer[]=[]; const result=new Promise<Buffer>((resolve,reject)=>{doc.on('data',(c:Buffer)=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 font(true).fontSize(24).fillColor('#154f43').text('TaxiDTA',48,42);
 font().fontSize(9).fillColor('#53645e').text('LOKALE DEMO · NUR ERFUNDENE DATEN',48,78);
 font(true).fontSize(10).fillColor('#111c18').text('Muster Taxi Demo',48,106);
 font().fontSize(9).text('Beispielweg 1 · 00000 Musterstadt\nFiktiver Rechnungsaussteller · Keine Bankverbindung',48,124);
 // PDFKit's measured text flow updates doc.y after wrapping and automatic page breaks.
 // Reserve the footer area even for recipients containing many explicit line breaks.
 font(true).fontSize(11).text(invoice.customerSnapshot.name,48,190,{width:285});
 const addressY=doc.bufferedPageRange().count===1?Math.max(208,doc.y+5):doc.y+5;
 font().fontSize(10).text(invoice.customerSnapshot.address,48,addressY,{width:285});
 const recipientEnd=doc.y;
 let headingY=Math.max(doc.bufferedPageRange().count===1?278:65,recipientEnd+32);
 // Keep the title, metadata, table header and at least one ordinary row together.
 if(headingY+72+35+46>690){doc.addPage();headingY=65;}
 const credit=Boolean(invoice.originalInvoiceId);
 font(true).fontSize(20).fillColor('#111c18').text(credit?'Stornorechnung':'Testrechnung',48,headingY,{width:280});
 font().fontSize(9).text(`Nummer: ${invoice.number}`,350,headingY+4,{width:197}).text(`Rechnungsdatum: ${date(invoice.issuedAt)}`,350,headingY+20,{width:197}).text(`${invoice.dueAtVerified===false?'Wiedervorlage (Demo)':'Fällig'}: ${date(invoice.dueAt)}`,350,headingY+36,{width:197});
 if(credit)doc.text(`Bezug: ${referenceNumber??invoice.originalInvoiceId}`,48,headingY+33,{width:285});
 let y=headingY+72;
 const header=()=>{doc.rect(48,y,499,25).fill('#edf4f0');font(true).fontSize(8).fillColor('#294c40');doc.text('Leistung / Datum',57,y+8,{width:275});doc.text('USt.',340,y+8,{width:35,align:'right'});doc.text('Netto',382,y+8,{width:70,align:'right'});doc.text('Brutto',460,y+8,{width:76,align:'right'});y+=35;};header();
 for(const line of invoice.lines){
  const description=`${line.description}\n${date(line.serviceDate)}`;
  font().fontSize(9);const height=Math.max(doc.heightOfString(description,{width:270})+17,46);
  if(y+height>690){doc.addPage();y=58;header();}
  font().fontSize(9).fillColor('#162920').text(description,57,y,{width:270});
  doc.text(`${line.taxRate} %`,340,y,{width:35,align:'right'}).text(euros(line.netCents),382,y,{width:70,align:'right'}).text(euros(line.grossCents),460,y,{width:76,align:'right'});
  y+=height;doc.moveTo(48,y-7).lineTo(547,y-7).strokeColor('#dce5df').lineWidth(.5).stroke();
 }
 if(y>525){doc.addPage();y=65;}y+=12;
 const groups=new Map<number,{net:number,tax:number}>();for(const l of invoice.lines){const g=groups.get(l.taxRate)??{net:0,tax:0};g.net+=l.netCents;g.tax+=l.taxCents;groups.set(l.taxRate,g);}
 font().fontSize(10).fillColor('#162920');
 for(const [rate,g]of groups){doc.text(`Netto (${rate} % USt.)`,300,y,{width:150}).text(euros(g.net),460,y,{width:76,align:'right'});y+=18;doc.text(`Umsatzsteuer ${rate} %`,300,y,{width:150}).text(euros(g.tax),460,y,{width:76,align:'right'});y+=23;}
 doc.rect(292,y-5,255,32).fill('#edf4f0');font(true).fontSize(12).fillColor('#154f43').text('Gesamtbetrag',302,y+4,{width:150}).text(euros(invoice.grossCents),456,y+4,{width:80,align:'right'});y+=50;
 font().fontSize(9).fillColor('#46564f').text(credit?'Storno mit unveränderlichem Bezug zur ursprünglichen Testrechnung.':invoice.dueAtVerified===false?'Vertragliche Kassenfrist ungeprüft. Das Datum ist nur eine Demo-Wiedervorlage. Kein Geld überweisen.':'Zahlungsziel: 28 Kalendertage. Kein Geld überweisen: Dies ist ein Testdokument.',48,y,{width:499});
 const range=doc.bufferedPageRange();
 for(let i=range.start;i<range.start+range.count;i++){doc.switchToPage(i);doc.page.margins.bottom=48;font().fontSize(8).fillColor('#65756c').text(`TESTDOKUMENT – KEINE STEUERLICHE ODER FACHLICHE FREIGABE`,48,752,{width:499,align:'center',lineBreak:false});doc.text(`${invoice.number} · Seite ${i+1} / ${range.count}`,48,766,{width:499,align:'center',lineBreak:false});}
 doc.end();return result;
}
