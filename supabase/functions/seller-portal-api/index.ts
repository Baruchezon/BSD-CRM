import {createClient} from 'npm:@supabase/supabase-js@2.95.3';
import {createHandler} from './handler.ts';
const required=(key:string)=>{const v=Deno.env.get(key);if(!v)throw new Error(`Missing ${key}`);return v;};
const optional=(key:string,fallback:string)=>Deno.env.get(key)||fallback;
// Public, non-secret production defaults. Each one can be overridden with an
// Edge Function secret of the same name without changing code.
const PORTAL_ORIGINS='https://baruchezon.github.io';
const PORTAL_URL='https://baruchezon.github.io/BSD-CRM/portal/';
const PORTAL_PHONE='054-2424999';
const serviceKey=required('SUPABASE_SERVICE_ROLE_KEY');
const db=createClient(required('SUPABASE_URL'),serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
// Salt for the hashed rate-limit keys (client addresses are never stored in
// clear). A dedicated SELLER_PORTAL_IP_SALT secret wins; otherwise a stable
// value is derived with HMAC from the service-role key the platform already
// injects, so no new secret has to be created. The salt is never returned.
async function derivedSalt(secret:string):Promise<string>{
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const mac=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('seller-portal-ip-salt-v1')));
 return Array.from(mac,b=>b.toString(16).padStart(2,'0')).join('');
}
const ipSalt=Deno.env.get('SELLER_PORTAL_IP_SALT')||await derivedSalt(serviceKey);
// Custom seller sessions and CRM JWTs are both checked in handler. Gateway verify_jwt=false is required.
// SELLER_PORTAL_IP_HEADER: header the gateway sets and callers cannot forge (default cf-connecting-ip).
Deno.serve(createHandler(db,{origins:optional('SELLER_PORTAL_ORIGINS',PORTAL_ORIGINS).split(',').map(s=>s.trim()).filter(Boolean),portalUrl:optional('SELLER_PORTAL_URL',PORTAL_URL),phone:optional('SELLER_PORTAL_PHONE',PORTAL_PHONE),ipSalt,ipHeader:Deno.env.get('SELLER_PORTAL_IP_HEADER')??'cf-connecting-ip',activationHours:Number(Deno.env.get('SELLER_PORTAL_ACTIVATION_HOURS')||24)}));
