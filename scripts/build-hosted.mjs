import {build as viteBuild} from 'vite';
import {build} from 'esbuild';
import {readFile,mkdir,readdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const client=resolve('.sites-runtime/client');
await viteBuild({build:{outDir:client,emptyOutDir:true}});
const assets={};
async function collect(directory,prefix=''){
 for(const item of await readdir(directory,{withFileTypes:true})){
  const path=prefix+'/'+item.name;
  if(item.isDirectory())await collect(resolve(directory,item.name),path);
  else assets[path]={base64:(await readFile(resolve(directory,item.name))).toString('base64'),type:({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'})[extname(item.name)]??'application/octet-stream'};
 }
}
await collect(client);
await mkdir('dist/server',{recursive:true});
await build({entryPoints:['hosted/worker.ts'],outfile:'dist/server/index.js',bundle:true,format:'esm',platform:'browser',target:'es2023',minify:true,alias:{'node:crypto':resolve('hosted/crypto-compat.ts')},plugins:[{name:'frontend-assets',setup(build){build.onResolve({filter:/^virtual:taxidta-assets$/},()=>({path:'assets',namespace:'embedded'}));build.onLoad({filter:/.*/,namespace:'embedded'},()=>({contents:'export default '+JSON.stringify(assets),loader:'js'}));}}]});
try{const manifest=JSON.parse(await readFile('.openai/hosting.json','utf8'));await mkdir('dist/.openai',{recursive:true});await writeFile('dist/.openai/hosting.json',JSON.stringify(manifest,null,2));}catch(error){if(error.code!=='ENOENT')throw error;console.info('Worker built locally; a hosting manifest is required before deployment.');}
