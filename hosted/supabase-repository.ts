import {CloudStoreError,type CloudRepository} from './cloud-store.js';

export interface SupabaseWorkspaceConfig {
  url:string;
  publishableKey:string;
  /** The BFF's remotely checked Supabase user, never a browser-selected owner. */
  ownerId:string;
  accessToken:string;
  webSession:{nonceHash:string;generation:number};
}
export class SupabaseWorkspaceError extends CloudStoreError {}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PAYLOAD_BYTES=1_900_000;
const RESPONSE_LIMIT=2_300_000;
const encoder=new TextEncoder();
const invalid=()=>new SupabaseWorkspaceError(503,'Die Supabase-Antwort passt nicht zum bestätigten Arbeitsbereich.','SUPABASE_WORKSPACE_RESPONSE_INVALID');

async function boundedJson(response:Response):Promise<unknown>{
  if(Number(response.headers.get('content-length'))>RESPONSE_LIMIT)throw invalid();
  const reader=response.body?.getReader();
  if(!reader)throw invalid();
  const decoder=new TextDecoder();let bytes=0,text='';
  try{
    while(true){const chunk=await reader.read();if(chunk.done)break;bytes+=chunk.value.byteLength;if(bytes>RESPONSE_LIMIT){await reader.cancel();throw invalid();}text+=decoder.decode(chunk.value,{stream:true});}
    text+=decoder.decode();return JSON.parse(text);
  }catch(error){throw error instanceof SupabaseWorkspaceError?error:invalid();}
  finally{reader.releaseLock();}
}

/** Fixed, owner/MFA/web-session-bound RPCs. No direct table access or privileged key. */
export class SupabaseCloudRepository implements CloudRepository {
  private readonly origin:string;
  private readonly key:string;
  private readonly ownerId:string;
  private readonly token:string;
  private readonly webSession:{nonceHash:string;generation:number};
  constructor(config:SupabaseWorkspaceConfig,private readonly fetchImpl:typeof fetch=fetch){
    let url:URL;try{url=new URL(config.url);}catch{throw new SupabaseWorkspaceError(422,'Ungültige Supabase-Projektadresse.','SUPABASE_WORKSPACE_CONFIG_INVALID');}
    if(url.protocol!=='https:'||!/^[a-z0-9]{20}\.supabase\.co$/.test(url.hostname)||url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash||!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(config.publishableKey)||!UUID.test(config.ownerId)||!config.accessToken||config.accessToken.length>16384||/[\r\n]/.test(config.accessToken)||!config.webSession||!/^[a-f0-9]{64}$/.test(config.webSession.nonceHash)||!Number.isSafeInteger(config.webSession.generation)||config.webSession.generation<1){
      throw new SupabaseWorkspaceError(422,'Der Arbeitsbereich benötigt eine bestätigte Projekt-, Inhaber- und Web-Sitzungskonfiguration.','SUPABASE_WORKSPACE_CONFIG_INVALID');
    }
    this.origin=url.origin;this.key=config.publishableKey;this.ownerId=config.ownerId.toLowerCase();this.token=config.accessToken;
    this.webSession={...config.webSession};
  }
  private scope(scope:string){if(typeof scope!=='string'||scope!==this.ownerId)throw new SupabaseWorkspaceError(403,'Der angeforderte Arbeitsbereich gehört nicht zur bestätigten Anmeldung.','SUPABASE_WORKSPACE_SCOPE_DENIED');}
  private async rpc(name:'read'|'compare_and_swap',body:Record<string,unknown>){
    let response:Response;
    try{response=await this.fetchImpl(`${this.origin}/rest/v1/rpc/taxidta_workspace_${name}`,{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
      headers:{apikey:this.key,Authorization:`Bearer ${this.token}`,'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({...body,p_nonce_hash:this.webSession.nonceHash,p_generation:this.webSession.generation}),
    });}catch{throw new SupabaseWorkspaceError(503,'Der Supabase-Arbeitsbereich ist momentan nicht erreichbar. Der Vorgang wurde nicht als gespeichert bestätigt.','SUPABASE_WORKSPACE_NETWORK_UNAVAILABLE');}
    if(!response.ok){
      if(response.status===401||response.status===403)throw new SupabaseWorkspaceError(response.status,'Die bestätigte Inhaber-/MFA-Websitzung ist nicht mehr gültig. Bitte erneut anmelden.','SUPABASE_WORKSPACE_AUTH_REQUIRED');
      if(response.status===404)throw new SupabaseWorkspaceError(503,'Die geprüfte Arbeitsbereichsmigration ist noch nicht erreichbar.','SUPABASE_WORKSPACE_SCHEMA_UNAVAILABLE');
      if(response.status===400||response.status===422)throw new SupabaseWorkspaceError(422,'Die Datenbank hat den Arbeitsbereich wegen einer Struktur- oder Originalschutzprüfung abgewiesen.','SUPABASE_WORKSPACE_VALIDATION_REJECTED');
      throw new SupabaseWorkspaceError(503,'Die Datenbank hat den Arbeitsbereichsvorgang nicht bestätigt.','SUPABASE_WORKSPACE_REJECTED');
    }
    return await boundedJson(response);
  }
  async read(scope:string){
    this.scope(scope);const value=await this.rpc('read',{});
    if(value===null)return null;
    if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();
    const row=value as {revision?:unknown;payload?:unknown};
    if(!Number.isSafeInteger(row.revision)||Number(row.revision)<1||!row.payload||typeof row.payload!=='object'||Array.isArray(row.payload))throw invalid();
    const payload=JSON.stringify(row.payload);
    if(encoder.encode(payload).length>MAX_PAYLOAD_BYTES)throw invalid();
    return {revision:Number(row.revision),payload};
  }
  async compareAndSwap(scope:string,expectedRevision:number|null,payload:string){
    this.scope(scope);
    if(expectedRevision!==null&&(!Number.isSafeInteger(expectedRevision)||expectedRevision<1))throw new SupabaseWorkspaceError(422,'Ungültige Arbeitsbereichsversion.','SUPABASE_WORKSPACE_REVISION_INVALID');
    if(typeof payload!=='string'||encoder.encode(payload).length>MAX_PAYLOAD_BYTES)throw new SupabaseWorkspaceError(413,'Der Arbeitsbereich überschreitet die geprüfte Speichergrenze.','SUPABASE_WORKSPACE_PAYLOAD_TOO_LARGE');
    let data:unknown;try{data=JSON.parse(payload);}catch{throw new SupabaseWorkspaceError(422,'Der Arbeitsbereich ist kein gültiges JSON-Dokument.','SUPABASE_WORKSPACE_PAYLOAD_INVALID');}
    if(!data||typeof data!=='object'||Array.isArray(data))throw new SupabaseWorkspaceError(422,'Der Arbeitsbereich muss ein strukturiertes Objekt sein.','SUPABASE_WORKSPACE_PAYLOAD_INVALID');
    const value=await this.rpc('compare_and_swap',{p_expected_revision:expectedRevision,p_payload:data});
    if(!value||typeof value!=='object'||Array.isArray(value))throw invalid();
    const result=value as {applied?:unknown;revision?:unknown};
    if(result.applied===false)return false;
    if(result.applied!==true||result.revision!==(expectedRevision??0)+1)throw invalid();
    return true;
  }
}
