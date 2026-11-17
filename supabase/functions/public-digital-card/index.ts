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
  "photo_url","logo_url","description","office_address","short_code"
].join(",");
function result(body: unknown, status=200) {
  return new Response(JSON.stringify(body), {
    status,
    headers:{...headers,"Content-Type":"application/json; charset=utf-8"}
  });
}
// Use strictly encoded RFC 2426 (vCard 3.0) content for Android/iOS import.
// Never prepend the UTF-8 BOM: Android contact importers can reject it.
function escapeVcardText(value: unknown): string {
  return String(value??"").replace(/\\/g,"\\\\").replace(/\r\n|\r|\n/g,"\\n")
    .replace(/[,;]/g,(char)=>"\\"+char);
}
function foldLine(line: string): string {
  const encoder=new TextEncoder();
  const sections: string[]=[];
  let current="",bytes=0;
  for(const codepoint of line){
    const size=encoder.encode(codepoint).length;
    if(bytes+size>75){
      sections.push(current);
      current=" "; bytes=1;
    }
    current+=codepoint;
    bytes+=size;
  }
  sections.push(current);
  return sections.join("\r\n");
}
function buildVcard(data: Record<string,unknown>): string {
  const name=String(data.full_name??"").trim();
  const tokens=name.split(/\s+/).filter(Boolean);
  const family=tokens.length>1 ? tokens[tokens.length-1] : "";
  const given=tokens.length>1 ? tokens.slice(0,-1).join(" ") : name;
  const fields=[
    "BEGIN:VCARD","VERSION:3.0",
    "N:"+escapeVcardText(family)+";"+escapeVcardText(given)+";;;",
    "FN:"+escapeVcardText(name)
  ];
  if(data.company_name)fields.push("ORG:"+escapeVcardText(data.company_name));
  if(data.job_title)fields.push("TITLE:"+escapeVcardText(data.job_title));
  if(data.phone_mobile)fields.push("TEL;TYPE=CELL:"+escapeVcardText(data.phone_mobile));
  if(data.phone_office)fields.push("TEL;TYPE=WORK,VOICE:"+escapeVcardText(data.phone_office));
  if(data.email)fields.push("EMAIL;TYPE=INTERNET,WORK:"+escapeVcardText(data.email));
  if(data.website_url)fields.push("URL:"+escapeVcardText(data.website_url));
  if(data.office_address)fields.push("ADR;TYPE=WORK:;;"+escapeVcardText(data.office_address)+";;;;");
  fields.push("END:VCARD");
  return fields.map(foldLine).join("\r\n")+"\r\n";
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
      const code=String(data.short_code||"card").replace(/[^a-z0-9-]/g,"");
      const filename="BSD_"+code+".vcf";
      // No leading BOM. CRLF lines, valid N and FN, and octet-safe line folding.
      const vcard=buildVcard(data);
      return new Response(new TextEncoder().encode(vcard), {
        status:200,
        headers:{
          ...headers,
          "Content-Type":"text/x-vcard; charset=utf-8",
          "Content-Disposition":'attachment; filename="'+filename+'"',
          "X-Content-Type-Options":"nosniff"
        }
      });
    }
    return result({card:publicCard});
  } catch(e) {
    console.error("Digital card lookup exception",String(e));
    return result({error:"Service unavailable"},503);
  }
});