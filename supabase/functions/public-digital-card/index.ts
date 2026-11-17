// Public, allowlisted card lookup. No direct read access to CRM profiles or contacts.
// Deploy with verify_jwt=false. This endpoint returns one published card only.
import { createClient } from "npm:@supabase/supabase-js@2.117.2";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, apikey",
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff"
};
const columns = [
  "full_name","job_title","company_name","phone_mobile","phone_office",
  "whatsapp_number","email","website_url","facebook_url","instagram_url",
  "photo_url","logo_url","description","office_address"
].join(",");
function result(body: unknown, status=200) {
  return new Response(JSON.stringify(body), {
    status,
    headers:{...headers,"Content-Type":"application/json; charset=utf-8"}
  });
}
Deno.serve(async (req: Request) => {
  if(req.method==="OPTIONS") return new Response(null,{status:204,headers});
  if(req.method!=="GET") return result({error:"Method not allowed"},405);
  const token = new URL(req.url).searchParams.get("card") || "";
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return result({error:"Card not found"},404);
  }
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const namedSecrets = Deno.env.get("SUPABASE_SECRET_KEYS");
    const secret = namedSecrets ? JSON.parse(namedSecrets).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!url || !secret) return result({error:"Service unavailable"},503);
    const db = createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await db.from("agent_digital_cards").select(columns + ",owner_user_id")
       .eq("public_token",token).eq("is_published",true).maybeSingle();
    if(error) { console.error("Digital card lookup failed:",error.code); return result({error:"Service unavailable"},503); }
    if(!data) return result({error:"Card not found"},404);
    // Do not keep distributing an ex-agent's card after their CRM access is blocked.
    const owner = await db.from("profiles").select("status,role").eq("id",data.owner_user_id).maybeSingle();
    if(owner.error) return result({error:"Service unavailable"},503);
    if(!owner.data || owner.data.status!=="active" ||
      !["admin","manager","agent","agent_authorized"].includes(owner.data.role)) {
      return result({error:"Card not found"},404);
    }
    const {owner_user_id: _privateOwnerId, ...publicCard}=data;
    return result({card:publicCard});
  } catch(e) {
    console.error("Digital card lookup exception",String(e));
    return result({error:"Service unavailable"},503);
  }
});