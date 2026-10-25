import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {stat} from 'node:fs/promises';
import {isAbsolute,extname} from 'node:path';
import {pathToFileURL} from 'node:url';
const execute=promisify(execFile);
/** Read-only host inspection. Never launches dakota, reads keys, or submits a certificate request. */
export async function inspectDakotaHost({platform=process.platform,executable=process.env.TAXIDTA_DAKOTA_EXE,run=execute}={}){
 const result={platform,windowsAvailable:platform==='win32',installedProducts:[],configuredExecutablePresent:false,installationVerified:false,certificateVerified:false,licenseVerified:false,payloadGeneratorReady:false,sendReady:false,blockers:[]};
 if(platform!=='win32'){result.blockers.push('WINDOWS_HOST_REQUIRED');return result;}
 try{
  const script="$ErrorActionPreference='Stop'; $p=@('HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'); $r=@(Get-ItemProperty -Path $p -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match '(?i)dakota[ ._-]*le(?:\\b|$)' } | Select-Object DisplayName,DisplayVersion); ConvertTo-Json -InputObject $r -Compress";
  const {stdout}=await run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{timeout:10000,maxBuffer:65536,windowsHide:true});
  const parsed=JSON.parse(stdout.replace(/^\uFEFF/,''));
  if(!Array.isArray(parsed))throw new Error('Invalid registry response');
  result.installedProducts=parsed.filter(p=>p&&typeof p.DisplayName==='string'&&p.DisplayName.length<=200).map(p=>({name:p.DisplayName,version:typeof p.DisplayVersion==='string'?p.DisplayVersion.slice(0,80):null}));
 }catch{result.blockers.push('INSTALLATION_QUERY_UNAVAILABLE');}
 if(executable){
  if(!isAbsolute(executable)||extname(executable).toLowerCase()!=='.exe')result.blockers.push('EXECUTABLE_PATH_INVALID');
  else try{result.configuredExecutablePresent=(await stat(executable)).isFile();}catch{result.blockers.push('EXECUTABLE_NOT_FOUND');}
 }
 // A registry entry or existing file proves neither a supported build nor a valid license.
 result.blockers.push('SUPPORTED_INSTALLATION_AND_LICENSE_NOT_VERIFIED','SENDER_CERTIFICATE_NOT_VERIFIED','TA_PAYLOAD_GENERATOR_INCOMPLETE','DAKOTA_HANDOVER_NOT_IMPLEMENTED','RECIPIENT_TEST_OUTSTANDING');
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=await inspectDakotaHost();console.log(JSON.stringify(result,null,2));process.exitCode=result.sendReady?0:2;
}
