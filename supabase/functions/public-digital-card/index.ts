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
  const params=new URL(req.url).searchParams;
  const token=params.get("card")||"";
  const short=(params.get("short")||"").toLowerCase();
  const validUUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
  const validShort=/^[a-z][a-z0-9-]{2,23}$/.test(short);
  if (!(validUUID || (!token && validShort))) {
    return result({error:"Card not found"},404);
  }
  const wantsVcard=params.get("format")==="vcard";
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const namedSecrets = Deno.env.get("SUPABASE_SECRET_KEYS");
    const secret = namedSecrets ? JSON.parse(namedSecrets).default : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!url || !secret) return result({error:"Service unavailable"},503);
    const db = createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    let lookup=db.from("agent_digital_cards").select(columns + ",owner_user_id")
      .eq("is_published",true);
    lookup=validUUID ? lookup.eq("public_token",token) : lookup.eq("short_code",short);
    const {data,error}=await lookup.maybeSingle();
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
    if (wantsVcard) {
      const v=(s: unknown)=>String(s??"").replace(/\\/g,"\\\\")
        .replace(/\r?\n/g,"\\n").replace(/[,;]/g,m=>"\\"+m);
      const record=[
        "BEGIN:VCARD","VERSION:3.0",
        "N:;"+v(data.full_name)+";;;",
        "FN:"+v(data.full_name),
        "ORG:"+v(data.company_name),
        "TITLE:"+v(data.job_title)
      ];
      if(data.phone_mobile) record.push("TEL;TYPE=CELL:"+v(data.phone_mobile));
      if(data.phone_office) record.push("TEL;TYPE=WORK:"+v(data.phone_office));
      if(data.email) record.push("EMAIL;TYPE=WORK:"+v(data.email));
      if(data.website_url) record.push("URL:"+v(data.website_url));
      if(data.office_address) record.push("ADR;TYPE=WORK:;;"+v(data.office_address)+";;;;");
      record.push("END:VCARD");
      return new Response("\ufeff"+record.join("\r\n")+"\r\n",{
        status:200,
        headers:{...headers,
          "Content-Type":"text/vcard; charset=utf-8",
          "Content-Disposition":'attachment; filename="BSD_Contact.vcf"',
          "X-Content-Type-Options":"nosniff"}
      });
    }
    return result({card:publicCard});
  } catch(e) {
    console.error("Digital card lookup exception",String(e));
    return result({error:"Service unavailable"},503);
  }
});