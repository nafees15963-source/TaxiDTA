import {handleApi,type HostedEnvironment} from './handler.js';
export async function handleVercel(request:Request,env:Record<string,string|undefined>=process.env){
 const url=new URL(request.url);
 const origins=[env.TAXIDTA_PUBLIC_ORIGIN,env.VERCEL_URL?`https://${env.VERCEL_URL}`:undefined,env.VERCEL_PROJECT_PRODUCTION_URL?`https://${env.VERCEL_PROJECT_PRODUCTION_URL}`:undefined].filter(Boolean);
 if(url.protocol!=='https:'||!origins.includes(url.origin))return Response.json({error:'Die Vercel-Adresse ist noch nicht eingerichtet.',code:'AUTH_CONFIG_INVALID'},{status:503,headers:{'Cache-Control':'no-store'}});
 const route=url.searchParams.get('route');
 if(url.pathname==='/api/handler'&&route){url.pathname='/api/'+route;url.searchParams.delete('route');}
 const headers=new Headers(request.headers);
 // This fixed namespace binds encrypted cookies to this application, not to a claimed identity.
 // Supabase remotely validates the actual owner and MFA for every financial request.
 headers.delete('oai-authenticated-user-id');headers.delete('oai-authenticated-user-email');
 headers.set('oai-authenticated-user-id','taxidta-vercel-owner');
 const next=new Request(url,new Request(request,{headers}));
 return handleApi(next,{
  SUPABASE_URL:env.SUPABASE_URL??'',SUPABASE_PUBLISHABLE_KEY:env.SUPABASE_PUBLISHABLE_KEY??'',
  SUPABASE_OWNER_ID:env.SUPABASE_OWNER_ID??'',TAXIDTA_SESSION_KEY:env.TAXIDTA_SESSION_KEY??'',
 } satisfies HostedEnvironment);
}
