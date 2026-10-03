import {createClient} from 'npm:@supabase/supabase-js@2.95.3';
import {createHandler} from './handler.ts';
const required=(key:string)=>{const v=Deno.env.get(key);if(!v)throw new Error(`Missing ${key}`);return v;};
const db=createClient(required('SUPABASE_URL'),required('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}});
// Custom seller sessions and CRM JWTs are both checked in handler. Gateway verify_jwt=false is required.
// SELLER_PORTAL_IP_HEADER: header the gateway sets and callers cannot forge (default cf-connecting-ip).
Deno.serve(createHandler(db,{origins:required('SELLER_PORTAL_ORIGINS').split(',').map(s=>s.trim()),portalUrl:required('SELLER_PORTAL_URL'),phone:required('SELLER_PORTAL_PHONE'),ipSalt:required('SELLER_PORTAL_IP_SALT'),ipHeader:Deno.env.get('SELLER_PORTAL_IP_HEADER')??'cf-connecting-ip',activationHours:Number(Deno.env.get('SELLER_PORTAL_ACTIVATION_HOURS')||24)}));
