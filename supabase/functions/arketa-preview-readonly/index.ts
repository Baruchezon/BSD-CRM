// Dedicated server-to-server read-only source. No database or storage writes.
const BUSINESS_ID = "a2eaafcf-b900-4c10-a5b8-fb175d0d417c";
const SOURCE_TOKEN_HASH = "51ca5067c3d0bba461e55b5ce5b9e8a4cd5903e68c9508720954374d0f67f704";
const PROJECT_URL = "https://zcdlegcvfirwzitfxjcs.supabase.co";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_TYPES = new Set(["anonymous_summary","internal_full_summary","economic_analysis","market_research"]);
const json = (status,value) => Response.json(value,{status,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
const sha = async text => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,"0")).join("");
function sameHash(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function newest(rows){
 const seen=new Set();
 return [...rows].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at)||b.id.localeCompare(a.id)).filter(f=>{
  const type=f.document_type||f.category;
  if(!ALLOWED_TYPES.has(type)||seen.has(type))return false;
  seen.add(type);return true;
 });
}
export function createSourceHandler({serviceKey,tokenHash=SOURCE_TOKEN_HASH,fetcher=fetch}){
 const get = async (table,parameters) => {
  const url=new URL(PROJECT_URL+"/rest/v1/"+table);
  Object.entries(parameters).forEach(([key,value])=>url.searchParams.set(key,String(value)));
  const response=await fetcher(url,{method:"GET",headers:{apikey:serviceKey,Authorization:"Bearer "+serviceKey,Accept:"application/json"},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error("source_unavailable");
  const data=await response.json();if(!Array.isArray(data))throw Error("invalid_source");return data;
 };
 return async request => {
  if(request.method!=="POST")return json(405,{error:"method_not_allowed"});
  const token=request.headers.get("x-portal-read-key")||"";
  if(token.length!==64||!sameHash(await sha(token),tokenHash))return json(401,{error:"unauthorized"});
  if(!serviceKey)return json(503,{error:"source_unavailable"});
  try{
   const raw=await request.text();if(raw.length>1000)return json(413,{error:"too_large"});
   let input;try{input=JSON.parse(raw);}catch{return json(400,{error:"invalid_request"});}
   if(input.business_id&&input.business_id!==BUSINESS_ID)return json(403,{error:"forbidden"});
   if(!["dashboard","file"].includes(input.action))return json(400,{error:"invalid_action"});
   const [business]=await get("businesses",{id:"eq."+BUSINESS_ID,select:"id,internal_name,business_number,owner_name,owner_phone,city,status,listing_status,agreement_status,is_archived,updated_at",limit:1});
   if(!business||business.is_archived||business.agreement_status!=="יש הסכם חתום")return json(409,{error:"access_revoked"});
   const rows=await get("business_sale_files",{business_id:"eq."+BUSINESS_ID,status:"eq.active",deleted_at:"is.null",select:"id,business_id,category,document_type,file_name,storage_path,file_type,status,deleted_at,created_at,version_number",order:"created_at.desc,id.desc",limit:1000});
   if(rows.length===1000)return json(503,{error:"source_limit"});
   const files=newest(rows);
   if(input.action==="dashboard"){
    const matches=await get("matches",{business_id:"eq."+BUSINESS_ID,counterparty_type:"eq.buyer",select:"id,status,created_at,material_sent_at,meeting_date",limit:1000});
    if(matches.length===1000)return json(503,{error:"source_limit"});
    return json(200,{business,files,matches,captured_at:new Date().toISOString()});
   }
   if(!UUID.test(String(input.file_id)))return json(404,{error:"not_found"});
   const file=files.find(f=>f.id===input.file_id);
   if(!file||file.business_id!==BUSINESS_ID||!file.storage_path.startsWith(BUSINESS_ID+"/")||file.storage_path.split("/").some(p=>p===".."||p===".")||file.storage_path.includes("\\")||file.file_type!=="application/pdf")return json(404,{error:"not_found"});
   const url=PROJECT_URL+"/storage/v1/object/authenticated/business-files/"+file.storage_path.split("/").map(encodeURIComponent).join("/");
   const response=await fetcher(url,{method:"GET",headers:{apikey:serviceKey,Authorization:"Bearer "+serviceKey},signal:AbortSignal.timeout(30000)});
   if(!response.ok)throw Error("source_unavailable");
   const size=Number(response.headers.get("content-length"));if(size>16*1024*1024)return json(413,{error:"too_large"});
   const bytes=await response.arrayBuffer();if(bytes.byteLength>16*1024*1024)return json(413,{error:"too_large"});
   if(new TextDecoder().decode(bytes.slice(0,5))!=="%PDF-")return json(422,{error:"invalid_pdf"});
   return new Response(bytes,{headers:{"Content-Type":"application/pdf","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  }catch{return json(503,{error:"source_unavailable"});}
 };
}
if(typeof Deno!=="undefined"){
 const secrets=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}");
 const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||secrets.default;
 Deno.serve(createSourceHandler({serviceKey}));
}
