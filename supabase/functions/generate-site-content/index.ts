import { createClient } from 'npm:@supabase/supabase-js@2';
import { Image, decode } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';
import encodeWebp, { init as initWebp } from 'npm:@jsquash/webp@1.4.0/encode.js';
import { BSD_LOGO_PNG_B64 } from './logo.ts';

// v8 (20.10.2026): topic dedupe (server-side exclusion + similarity + saved batches) and Gemini featured images with BSD logo, WebP.
const ANTHROPIC_API_KEY = (Deno.env.get('ANTHROPIC_API_KEY') || '').trim();
const OPENAI_API_KEY = (Deno.env.get('OPENAI_API_KEY') || '').trim();
const GEMINI_API_KEY = (Deno.env.get('GEMINI_API_KEY') || '').trim();
const GEMINI_IMAGE_MODEL = (Deno.env.get('GEMINI_IMAGE_MODEL') || 'gemini-2.5-flash-image').trim();
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const IMAGE_BUCKET = 'site-content-images';
const SITEMAP_URL = 'https://www.bsd-bbi.co.il/sitemap.xml';
const TARGET_TOPICS = 8, MAX_ROUNDS = 3, SIM_THRESHOLD = 0.85;

function cors(){return {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-studio-selftest'};}
function json(obj:unknown,status=200){return new Response(JSON.stringify(obj),{status,headers:{...cors(),'Content-Type':'application/json; charset=utf-8'}});}
function cleanSlug(v:string){return (v||'article').toLowerCase().replace(/[^a-z0-9\u0590-\u05ff]+/g,'-').replace(/^-+|-+$/g,'').slice(0,90)||'article';}

const CONTENT_TOOL={name:'submit_site_content',description:'החזרת כתבה מלאה וכל שדות ה SEO לאתר BSD',input_schema:{type:'object',properties:{title:{type:'string'},slug:{type:'string'},excerpt:{type:'string'},focus_keyword:{type:'string'},seo_title:{type:'string'},seo_description:{type:'string'},article_html:{type:'string'},image_prompt:{type:'string'},notes:{type:['string','null']}},required:['title','slug','excerpt','focus_keyword','seo_title','seo_description','article_html','image_prompt']}};
const TOPICS_TOOL={name:'submit_topic_ideas',description:'החזרת הצעות לנושאי כתבות עבור BSD',input_schema:{type:'object',properties:{topics:{type:'array',minItems:1,maxItems:14,items:{type:'object',properties:{title:{type:'string'},angle:{type:'string'},focus_keyword:{type:'string'},why:{type:'string'}},required:['title','angle','focus_keyword','why']}}},required:['topics']}};

async function requireManager(req:Request){
  const jwt=(req.headers.get('Authorization')||'').replace('Bearer ','');
  const {data:u,error:ue}=await supabase.auth.getUser(jwt);
  if(ue||!u?.user) return {error:json({error:'לא מחובר'},401)};
  const {data:p,error:pe}=await supabase.from('profiles').select('role,status').eq('id',u.user.id).single();
  if(pe||!p||p.status==='blocked'||!['admin','manager'].includes(p.role)) return {error:json({error:'אין הרשאת ניהול תוכן'},403)};
  return {user:u.user,profile:p};
}
// Self-test token: rows exist only in a service-role-only table, created by an admin via SQL, expire in 2h.
async function selftestOk(req:Request){
  const t=(req.headers.get('x-studio-selftest')||'').trim();if(t.length<32)return false;
  const {data}=await supabase.from('site_content_studio_selftest').select('token,expires_at').eq('token',t).maybeSingle();
  return !!data&&new Date(data.expires_at).getTime()>Date.now();
}

async function claudeTool(system:string,user:string,tool:any,max_tokens=5000){
  if(!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY לא מוגדר');
  const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01','content-type':'application/json'},body:JSON.stringify({model:'claude-sonnet-5',max_tokens,system,messages:[{role:'user',content:user}],tools:[tool],tool_choice:{type:'tool',name:tool.name}})});
  if(!r.ok) throw new Error(`יצירת התוכן נכשלה (${r.status}): ${(await r.text()).slice(0,300)}`);
  const data=await r.json();
  const block=(data.content||[]).find((x:{type:string})=>x.type==='tool_use');
  if(!block?.input) throw new Error('AI לא החזיר מבנה תקין');
  return block.input;
}

/* ---------------- topic dedupe ---------------- */
const STOP=new Set(['של','את','על','עם','או','גם','כל','איך','מה','למה','לפני','אחרי','בין','זה','הוא','היא','כדי','לא','יש','אין','מדריך','המדריך','המלא','מלא','2024','2025','2026','bsd']);
function norm(s:string){return String(s||'').toLowerCase().replace(/[\u0591-\u05C7]/g,'').replace(/[^a-z0-9\u05d0-\u05ea\s]+/g,' ').replace(/\s+/g,' ').trim();}
function stem(w:string){return w.length>3?w.replace(/^(וה|שה|כש|לה|מה|בה|ה|ו|ש|ב|ל|מ|כ)/,'').replace(/(ים|ות)$/,''):w;}
function tokens(s:string){return new Set(norm(s).split(' ').filter(w=>w&&!STOP.has(w)).map(stem).filter(w=>w.length>1));}
function bigrams(s:string){const t=norm(s).replace(/\s/g,'');const m=new Map<string,number>();for(let i=0;i<t.length-1;i++){const g=t.slice(i,i+2);m.set(g,(m.get(g)||0)+1)}return m;}
function dice(a:string,b:string){const A=bigrams(a),B=bigrams(b);let inter=0,na=0,nb=0;A.forEach(v=>na+=v);B.forEach(v=>nb+=v);A.forEach((v,k)=>inter+=Math.min(v,B.get(k)||0));return na+nb?2*inter/(na+nb):0;}
function jacc(a:string,b:string){const A=tokens(a),B=tokens(b);if(!A.size||!B.size)return 0;let i=0;A.forEach(x=>{if(B.has(x))i++});return i/(A.size+B.size-i);}
function textSim(a:string,b:string){return Math.max(dice(a,b),jacc(a,b)>=0.75?0.9:0);}
async function embed(texts:string[]):Promise<number[][]|null>{
  if(!OPENAI_API_KEY||!texts.length)return null;
  try{const out:number[][]=[];for(let i=0;i<texts.length;i+=256){const r=await fetch('https://api.openai.com/v1/embeddings',{method:'POST',headers:{'Authorization':`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:'text-embedding-3-small',input:texts.slice(i,i+256).map(t=>t.slice(0,400))})});if(!r.ok)return null;const d=await r.json();for(const x of d.data)out.push(x.embedding)}return out;}catch{return null}
}
function cos(a:number[],b:number[]){let d=0,x=0,y=0;for(let i=0;i<a.length;i++){d+=a[i]*b[i];x+=a[i]*a[i];y+=b[i]*b[i]}return d/(Math.sqrt(x*y)||1);}

async function sitemapTitles():Promise<string[]>{
  try{const r=await fetch(SITEMAP_URL,{signal:AbortSignal.timeout(8000)});if(!r.ok)return [];const x=await r.text();
    return [...x.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>{try{return decodeURIComponent(new URL(m[1]).pathname)}catch{return ''}}).map(p=>p.split('/').filter(Boolean).pop()||'').map(s=>s.replace(/-\d+$/,'').replace(/[-_]+/g,' ').trim()).filter(s=>s.length>3);
  }catch{return []}
}
async function buildExclusion(){
  const ex:{text:string,src:string}[]=[];
  const {data:sc}=await supabase.from('site_content').select('title,focus_keyword,seo_title');
  for(const r of sc||[]){if(r.title)ex.push({text:r.title,src:'site_content'});if(r.seo_title&&r.seo_title!==r.title)ex.push({text:r.seo_title,src:'site_content'});if(r.focus_keyword)ex.push({text:r.focus_keyword,src:'site_content_keyword'});}
  const {data:prev}=await supabase.from('site_content_topic_suggestions').select('title,keyword').order('created_at',{ascending:false}).limit(1000);
  for(const r of prev||[]){if(r.title)ex.push({text:r.title,src:'prior_suggestion'});}
  for(const t of await sitemapTitles())ex.push({text:t,src:'site_page'});
  const seen=new Set<string>();return ex.filter(e=>{const k=norm(e.text);if(!k||seen.has(k))return false;seen.add(k);return true;});
}

async function suggestTopics(audience:string,clientExisting:string[],createdBy:string|null){
  const exclusion=await buildExclusion();
  for(const t of clientExisting)if(t&&!exclusion.some(e=>norm(e.text)===norm(t)))exclusion.push({text:t,src:'client'});
  const titleEx=exclusion.filter(e=>e.src!=='site_content_keyword');
  let exVecs=await embed(titleEx.map(e=>e.text));const useEmb=!!exVecs;
  const accepted:{title:string,angle:string,focus_keyword:string,why:string,vec?:number[]}[]=[];const rejected:{title:string,similar_to:string,score:number,method:string}[]=[];
  const batchId=crypto.randomUUID();let rounds=0;
  const system=`אתה אסטרטג התוכן של BSD Business Brokers Israel. הצע נושאים בעברית שמבוססים על שאלות אמיתיות וכוונת חיפוש של בעלי עסקים, מוכרי עסקים, רוכשים ומשקיעים בישראל. כלל ברזל: אסור להציע נושא שכבר מופיע ברשימת ההחרגה, וגם לא את אותו נושא בניסוח אחר, בזווית קרובה מדי, כשאלה במקום משפט, או עם מילים נרדפות. כל נושא חייב לעסוק בשאלה/בעיה שונה מהותית מכל פריט ברשימה ומהנושאים האחרים שאתה מציע עכשיו. הנושאים צריכים להיות ממוקדים, שימושיים, מתאימים למאמר סמכותי ולקידום אורגני טבעי. לכל נושא תן זווית ברורה, מילת מפתח מרכזית (שאינה מילת מפתח שכבר בשימוש) והסבר קצר למה הוא שימושי. אל תמציא נתוני שוק, עסקאות או הישגים של BSD. חובה להשתמש בכלי submit_topic_ideas.`;
  while(accepted.length<TARGET_TOPICS&&rounds<MAX_ROUNDS){
    rounds++;const need=TARGET_TOPICS-accepted.length;const ask=rounds===1?TARGET_TOPICS:Math.min(14,need+3);
    const kw=exclusion.filter(e=>e.src==='site_content_keyword').map(e=>e.text);
    const list=[...titleEx.map(e=>e.text),...accepted.map(a=>a.title),...rejected.map(r=>r.title)];
    const user=`קהל יעד: ${audience}\nהצע בדיוק ${ask} נושאים חדשים.\n\nרשימת החרגה – נושאים שכבר קיימים באתר, בטיוטות, בעמודי האתר או שכבר הוצעו בעבר (אסור לחזור עליהם גם בניסוח אחר):\n${list.map((x,i)=>`${i+1}. ${x}`).join('\n')||'אין'}\n\nמילות מפתח שכבר בשימוש:\n${kw.join(', ')||'אין'}`;
    const out=await claudeTool(system,user,TOPICS_TOOL,3200);
    const cand=(Array.isArray(out?.topics)?out.topics:[]).map((t:any)=>({title:String(t.title||'').trim(),angle:String(t.angle||'').trim(),focus_keyword:String(t.focus_keyword||'').trim(),why:String(t.why||'').trim()})).filter((t:any)=>t.title);
    const cVecs=useEmb?await embed(cand.map((c:any)=>`${c.title}. ${c.angle}`)):null;
    const roundAccepted:any[]=[];
    cand.forEach((c:any,ci:number)=>{
      if(accepted.length>=TARGET_TOPICS)return;
      let best={score:0,text:'',method:'text'};
      const pool=[...titleEx.map((e,i)=>({text:e.text,vec:exVecs?.[i]})),...accepted.map(a=>({text:a.title,vec:a.vec}))];
      for(const p of pool){const t=textSim(c.title,p.text);if(t>best.score)best={score:t,text:p.text,method:'text'};if(cVecs&&p.vec){const e=cos(cVecs[ci],p.vec);if(e>best.score)best={score:e,text:p.text,method:'embedding'};}}
      if(c.focus_keyword&&kw.some(k=>norm(k)===norm(c.focus_keyword))&&best.score<SIM_THRESHOLD){/* same keyword alone is allowed but noted */}
      if(best.score>=SIM_THRESHOLD){rejected.push({title:c.title,similar_to:best.text,score:Math.round(best.score*1000)/1000,method:best.method});return;}
      const a={...c,vec:cVecs?.[ci]};accepted.push(a);roundAccepted.push(a);
    });
    if(roundAccepted.length){const {error}=await supabase.from('site_content_topic_suggestions').insert(roundAccepted.map(a=>({title:a.title,angle:a.angle,keyword:a.focus_keyword,why:a.why,batch_id:batchId,round:rounds,created_by:createdBy})));if(error)throw new Error('שמירת הנושאים נכשלה: '+error.message);}
  }
  const {data:saved}=await supabase.from('site_content_topic_suggestions').select('id,title').eq('batch_id',batchId);
  const idByTitle=new Map((saved||[]).map((s:any)=>[s.title,s.id]));
  return {batch_id:batchId,rounds,similarity:useEmb?'embeddings(text-embedding-3-small)+text':'text',threshold:SIM_THRESHOLD,exclusion_count:exclusion.length,exclusion_sources:exclusion.reduce((m:any,e)=>{m[e.src]=(m[e.src]||0)+1;return m},{}),topics:accepted.map(a=>({id:idByTitle.get(a.title)||null,title:a.title,angle:a.angle,focus_keyword:a.focus_keyword,why:a.why})),rejected};
}

/* ---------------- Gemini image ---------------- */
function b64ToBytes(b64:string){const bin=atob(b64);const out=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);return out;}
let webpReady:Promise<void>|null=null;
function ensureWebp(){if(!webpReady)webpReady=(async()=>{const w=await fetch('https://cdn.jsdelivr.net/npm/@jsquash/webp@1.4.0/codec/enc/webp_enc.wasm').then(r=>{if(!r.ok)throw new Error('webp wasm');return r.arrayBuffer()});await initWebp(await WebAssembly.compile(w));})();return webpReady;}
function buildImagePrompt(o:{title:string,excerpt:string,keyword:string}){
  return `Create a photorealistic horizontal 16:9 editorial header image for a professional Hebrew business article on the website of BSD Business Brokers Israel (business brokerage: buying and selling businesses in Israel).
Article title (Hebrew): ${o.title}
Summary (Hebrew): ${o.excerpt||'-'}
Focus keyword: ${o.keyword||'-'}
Visual direction: professional, trustworthy, Israeli business setting (Israeli city/office/shop context as relevant to the topic), modern and clean, premium feel. Color palette dominated by deep navy blue with warm gold accents (BSD brand colors). Natural lighting, sharp focus, real people only as generic non-identifiable figures if needed.
Strict rules: absolutely NO text, letters, numbers, signs with writing, logos or watermarks anywhere in the image. Keep the top-right corner relatively calm (a logo will be placed there).`;
}
async function generateGeminiImage(o:{title:string,excerpt:string,keyword:string,slug:string}){
  if(!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY לא מוגדר בסודות הפונקציה');
  const prompt=buildImagePrompt(o);
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent`,{method:'POST',headers:{'x-goog-api-key':GEMINI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{responseModalities:['IMAGE'],imageConfig:{aspectRatio:'16:9'}}})});
  if(!r.ok) throw new Error(`יצירת תמונה ב-Gemini נכשלה (${r.status}): ${(await r.text()).slice(0,400)}`);
  const d=await r.json();const part=(d?.candidates?.[0]?.content?.parts||[]).find((p:any)=>p.inlineData?.data||p.inline_data?.data);
  const b64=part?.inlineData?.data||part?.inline_data?.data;if(!b64)throw new Error('Gemini לא החזיר תמונה');
  const img=await decode(b64ToBytes(b64)) as Image;
  const logo=await decode(b64ToBytes(BSD_LOGO_PNG_B64)) as Image;
  const lw=Math.max(48,Math.round(img.width*0.12));logo.resize(lw,Image.RESIZE_AUTO);const m=Math.round(img.width*0.025);
  img.composite(logo,img.width-lw-m,m);
  await ensureWebp();
  const webp=new Uint8Array(await encodeWebp({data:new Uint8ClampedArray(img.bitmap.buffer,img.bitmap.byteOffset,img.bitmap.byteLength),width:img.width,height:img.height,colorSpace:'srgb'} as ImageData,{quality:82}));
  const path=`articles/${new Date().toISOString().slice(0,10)}/${cleanSlug(o.slug||o.title)}-${crypto.randomUUID()}.webp`;
  const {error:upErr}=await supabase.storage.from(IMAGE_BUCKET).upload(path,webp,{contentType:'image/webp',upsert:false,cacheControl:'31536000'});if(upErr)throw new Error('שמירת התמונה נכשלה: '+upErr.message);
  const {data:pub}=supabase.storage.from(IMAGE_BUCKET).getPublicUrl(path);
  return {image_url:pub.publicUrl,storage_path:path,image_prompt:prompt,model:GEMINI_IMAGE_MODEL,width:img.width,height:img.height,bytes:webp.byteLength};
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors()});
  try{
    const selftest=await selftestOk(req);let userId:string|null=null;
    if(!selftest){const auth=await requireManager(req);if('error' in auth)return auth.error as Response;userId=(auth as any).user.id;}
    const b=await req.json();const mode=String(b.mode||'draft');
    if(mode==='secret_status'){if(!selftest)return json({error:'forbidden'},403);return json({GEMINI_API_KEY:!!GEMINI_API_KEY,OPENAI_API_KEY:!!OPENAI_API_KEY,ANTHROPIC_API_KEY:!!ANTHROPIC_API_KEY,gemini_model:GEMINI_IMAGE_MODEL});}
    if(mode==='generate_image'){
      const title=String(b.title||b.topic||'').trim();const excerpt=String(b.excerpt||'').trim();const keyword=String(b.keyword||b.focus_keyword||'').trim();const slug=String(b.slug||title||'article').trim();
      if(!title&&!excerpt)return json({error:'חסרים כותרת/תקציר לתמונה'},400);
      const res:any=await generateGeminiImage({title,excerpt,keyword,slug});
      const articleId=String(b.article_id||'').trim();res.article_updated=false;
      if(articleId){ // never touch already-published content
        const {data:art}=await supabase.from('site_content').select('id,status').eq('id',articleId).maybeSingle();
        if(art&&art.status!=='published'){const {error}=await supabase.from('site_content').update({featured_image_url:res.image_url,featured_image_prompt:res.image_prompt,updated_at:new Date().toISOString(),...(userId?{updated_by:userId}:{})}).eq('id',articleId).neq('status','published');if(!error)res.article_updated=true;}
        else if(art)res.note='הכתבה כבר מפורסמת – התמונה לא הוחלפה אוטומטית. אפשר לשמור ידנית.';
      }
      return json(res);
    }
    if(mode==='topics'){
      const existing=Array.isArray(b.existing_topics)?b.existing_topics.map((x:unknown)=>String(x)).filter(Boolean).slice(0,200):[];
      const audience=String(b.audience||'בעלי עסקים, מוכרי עסקים, יזמים, רוכשים ומשקיעים בישראל').trim();
      return json(await suggestTopics(audience,existing,userId));
    }
    if(mode==='mark_topic_used'){
      const sid=String(b.suggestion_id||'').trim(),aid=String(b.article_id||'').trim();if(!sid||!aid)return json({error:'missing ids'},400);
      const {error}=await supabase.from('site_content_topic_suggestions').update({used_article_id:aid}).eq('id',sid).is('used_article_id',null);if(error)throw error;return json({ok:true});
    }
    if(selftest)return json({error:'selftest supports topics/generate_image/secret_status only'},400);

    const topic=String(b.topic||'').trim();const current=String(b.current_text||'').trim();const audience=String(b.audience||'בעלי עסקים, מוכרי עסקים, יזמים, רוכשים ומשקיעים בישראל').trim();
    if(!topic&&!current)return json({error:'יש להזין נושא או טקסט קיים'},400);
    const system=`אתה העורך הראשי ומומחה ה SEO של BSD Business Brokers Israel. הפק תוכן בעברית שנשמע כאילו נכתב על ידי איש מקצוע ישראלי מנוסה, לא על ידי מכונה. התוכן חייב להיות מועיל, ברור, מעשי, אמין ומעמיק, עם ניסוח טבעי וללא מילוי מילים. אל תמציא מספרים, עסקאות, לקוחות, נתוני שוק, חוקים או עובדות שלא נמסרו. כאשר יש היבט משפטי, חשבונאי או מיסויי נסח בזהירות והמלץ לבדוק עם בעל מקצוע מתאים. שמור על דיסקרטיות. בכתבה מלאה בנה פתיחה שמבהירה את הבעיה, גוף מסודר עם h2 ו h3, צעדים או נקודות מעשיות כשמתאים, טעויות נפוצות או שאלות נפוצות כשזה מועיל, וסיום טבעי שמזמין לפנות ל BSD בלי להיות פרסומי מדי. השתמש במילת המפתח באופן טבעי ובמונחים קשורים, בלי דחיסת מילות מפתח. כותרת ה SEO צריכה להיות ברורה ומושכת ובדרך כלל עד כ 60 תווים. תיאור המטא צריך להסביר ערך ולרוב להיות עד כ 155 תווים. התקציר צריך להתאים לכרטיס במרכז הידע. ה slug צריך להיות קצר וברור. HTML מותר רק: h2,h3,p,ul,ol,li,strong. אין script,style,iframe או קישורים חיצוניים. אין להבטיח מיקום בגוגל. image_prompt יתאר תמונת כותרת מקצועית וריאליסטית ללא טקסט. חובה להשתמש בכלי submit_site_content ולהחזיר את כל השדות.`;
    const user=`מצב: ${mode}\nנושא או כותרת: ${topic||'שיפור תוכן קיים'}\nקהל יעד: ${audience}\n\nטקסט קיים או חומר גלם, אם יש:\n${current||'(אין)'}\n\nאם המצב draft, הפק כתבה מלאה ומוכנה לעריכה ולפרסום, והשלם אוטומטית את כל שדות ה SEO. אם המשתמש סיפק חומר גלם, שמור את המשמעות והעובדות שלו ושפר את המבנה והניסוח. אם המצב seo, שמור ככל האפשר על גוף התוכן אך שפר כותרת, תקציר, מילת מפתח ושדות המטא. אם המצב image, התמקד במיוחד ב image_prompt אך עדיין החזר מבנה תקין.`;
    return json(await claudeTool(system,user,CONTENT_TOOL,5600));
  }catch(e){return json({error:e instanceof Error?e.message:String(e)},500);}
});
