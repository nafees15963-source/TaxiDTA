import {sha256} from '@noble/hashes/sha2.js';

/** Narrow build adapter for shared, synchronous SHA-256 identifiers and audit hashes. */
export function createHash(algorithm:string){
  if(algorithm.toLowerCase()!=='sha256')throw new Error('Unsupported hash algorithm.');
  const hash=sha256.create();
  return {
    update(data:string|Uint8Array){hash.update(typeof data==='string'?new TextEncoder().encode(data):data);return this;},
    digest(format?:string){const bytes=hash.digest();if(format==='hex')return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');if(format)throw new Error('Unsupported hash encoding.');return bytes;}
  };
}
export const randomUUID=()=>crypto.randomUUID();
export function randomBytes(length:number){return crypto.getRandomValues(new Uint8Array(length));}
export function timingSafeEqual(a:Uint8Array,b:Uint8Array){if(a.length!==b.length)throw new Error('Unequal comparison lengths.');let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;}
