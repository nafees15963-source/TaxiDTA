import {useState} from 'react';
import PayerPicker from './PayerPicker';
import {getPayer,payerRegistrySummary} from './domain/payers';
import {dtaFormatProfile} from './domain/dta/format-profile';
export default function AcceptanceDirectory(){
 const [payerId,setPayerId]=useState('');
 const payer=getPayer(payerId);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const profile=payer?dtaFormatProfile(payer,today):null;
 const count=payerRegistrySummary();
 return <section className="acceptance-directory" aria-label="Annahmestellenverzeichnis">
  <h2>Annahmestelle auswählen</h2>
  <p>Wähle deine Krankenkasse über Name oder IK. Die hinterlegten Annahmedaten werden automatisch angezeigt; du musst kein eigenes Verzeichnis anlegen.</p>
  <PayerPicker value={payerId} onChange={value=>setPayerId(value?.id??'')} required={false}/>
  {payer&&profile&&<div className="acceptance-profile" role="status">
   <h3>{payer.dta.providerName??(payer.isSynthetic?'Testkasse':'Annahmestelle noch nicht belegt')}</h3>
   <dl>
    <dt>Dateiformat</dt><dd>{profile.label}</dd>
    <dt>Übertragungsweg</dt><dd>{payer.dta.deliveryChannel==='email'?'E-Mail laut veröffentlichter Quelle':'Noch nicht belegt'}</dd>
    <dt>Transportadresse</dt><dd>{payer.dta.transportAddress??'Noch nicht belegt'}</dd>
    <dt>Physische Empfänger-IK</dt><dd>{payer.dta.physicalRecipientIk??'Noch nicht belegt'}</dd>
    <dt>Entschlüsselungs-IK</dt><dd>{payer.dta.decryptRecipientIk??'Noch nicht belegt'}</dd>
    <dt>Quellenstand</dt><dd>{payer.dta.sourceDate??'Keine Versandquelle hinterlegt'}</dd>
   </dl>
   <p>{profile.detail}</p>
   {profile.sourceUrl&&<a href={profile.sourceUrl} target="_blank" rel="noreferrer">Offizielle Formatvorgaben</a>}
   <p>Versandstatus: nicht eingerichtet. Eine echte Abrechnung – auch über eine einzelne Fahrt – wird erst nach erfolgreicher Einrichtung und deiner ausdrücklichen Sendeaktion übertragen.</p>
  </div>}
  <p>{count.publishedTransportHints} veröffentlichte Transporthinweise hinterlegt. Der Abgleich mit der aktuellen Kostenträgerdatei steht noch aus.</p>
 </section>;
}
