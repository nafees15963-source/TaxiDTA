import assets from 'virtual:taxidta-assets';
import {handleApi,type HostedEnvironment} from './handler.js';
export default {async fetch(request:Request,env:HostedEnvironment):Promise<Response>{
 const url=new URL(request.url);
 if(url.pathname.startsWith('/api/'))return handleApi(request,env);
 if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
 const asset=assets[url.pathname]??(url.pathname.includes('.')?undefined:assets['/index.html']);
 if(!asset)return new Response('Not found',{status:404});
 const bytes=Uint8Array.from(atob(asset.base64),c=>c.charCodeAt(0));
 return new Response(request.method==='HEAD'?null:bytes,{headers:{'Content-Type':asset.type,'Cache-Control':url.pathname.startsWith('/assets/')?'private, max-age=31536000, immutable':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com"}});
}};
