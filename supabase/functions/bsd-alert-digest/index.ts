
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";
import bidiFactory from "npm:bidi-js@1.0.3";
const db=createClient(Deno.env.get("SUPABASE_URL")||"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",{auth:{autoRefreshToken:false,persistSession:false}});
const urlPrefs="https://zcdlegcvfirwzitfxjcs.supabase.co/functions/v1/bsd-alert-preferences";
const web="https://www.bsd-bbi.co.il";
const k=String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"");
const RESEND=String(Deno.env.get("RESEND_API_KEY")||"");
const escape=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clean=s=>String(s??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim();
const money=n=>Number(n).toLocaleString("he-IL")+" ₪";
const bidi=bidiFactory();
const response=(json,status=200)=>new Response(JSON.stringify(json),{status,headers:{"content-type":"application/json;charset=utf-8","cache-control":"no-store"}});
const LOGO=web+"/assets/bsd-asset-01-logo.png";
const isActive=s=>s.status==="active"&&s.consent_email===true&&s.consent_general===true&&s.legacy_no_consent!==true&&!s.archived_at&&!s.email_unsubscribed_at&&!s.is_test;
const normList=a=>Array.isArray(a)?a.filter(x=>typeof x==="string"):[];
const has=(text,terms)=>terms.some(w=>text.includes(w));
function classifyBusiness(b){
 const tx=b.taxonomy||{};
 let cats=normList(tx.categories),subs=normList(tx.subcategories),regs=normList(tx.regions);
 const label=clean([b.anon_display_name,b.category,b.subcategory,b.field,b.anon_summary].join(" ")).toLowerCase();
 if(has(label,["מסעד","מזון מהיר","שווארמ","המבורג","פיצה","בית קפה","קפה","מאפי","מאפיה","קייטרינג","גליד","בר שייקים","שייקים","מזון","טורטייה","מקסיקני"])){
 if(!cats.includes("food"))cats.push("food");
 }
 if(has(label,["ירקות ופירות","סופרמרקט","מינימרקט","מכולת","קמעונאות מזון"])){if(!cats.includes("grocery"))cats.push("grocery");}
 if(has(label,["שווארמ","מזון מהיר","פלאפל","המבורג","טורטייה","פיצה"])){if(!subs.includes("fast_food"))subs.push("fast_food");}
 if(has(label,["בית קפה","בתי קפה","כקפה"])){if(!subs.includes("cafe"))subs.push("cafe");}
 if(has(label,["שייקים","בר מיצים","מיצים ושייקים"])){if(!subs.includes("juice_bar"))subs.push("juice_bar");}
 if(has(label,["מסעד","מקסיקני"])){if(!subs.includes("restaurant"))subs.push("restaurant");}
 if(has(label,["מאפי","מאפיה"])){if(!subs.includes("bakery"))subs.push("bakery");}
 if(has(label,["סופרמרקט"])){if(!subs.includes("supermarket"))subs.push("supermarket");}
 if(has(label,["מינימרקט"])){if(!subs.includes("minimarket"))subs.push("minimarket");}
 if(has(label,["ירקות ופירות"])){if(!subs.includes("produce"))subs.push("produce");}
 if(has(label,["עסק בתחום תחבורה","רכב","מוסך","מכוניות"])){if(!cats.includes("auto"))cats.push("auto");}
 if(has(label,["מספרה","קוסמטיקה","אסתטיקה"])){if(!cats.includes("beauty"))cats.push("beauty");}
 if(has(label,["אחזקה","ניקיון"])){if(!cats.includes("services"))cats.push("services");}
 if(has(label,["מפעל","ייצור","בנייה"])){if(!cats.includes("construction"))cats.push("construction");}
 if(has(label,["חנות","מסחר","קמעונאות"])){if(!cats.includes("retail"))cats.push("retail");}
 if(has(label,["תיירות","הסעות"])){if(!cats.includes("services"))cats.push("services");}
 const loc=clean([b.city,b.region].join(" "));
 if(has(loc,["תל אביב","תל-אביב","יפו"])){if(!regs.includes("tel_aviv"))regs.push("tel_aviv");}
 if(has(loc,["פתח תקווה","פתח-תקווה","קריית אונו","קרית אונו","ראשון לציון","רחובות","נס ציונה","חולון","בת ים","רמת גן","גבעתיים","בני ברק","מרכז גוש דן","גוש דן"])){if(!regs.includes("center"))regs.push("center");}
 if(has(loc,["הרצליה","נתניה","רעננה","כפר סבא","הוד השרון","רמת השרון","שרון"])){if(!regs.includes("sharon"))regs.push("sharon");}
 if(has(loc,["חיפה","קריות"])){if(!regs.includes("haifa"))regs.push("haifa");}
 if(has(loc,["קריית שמונה","כרמיאל","צפת","טבריה","גליל","צפון"])){if(!regs.includes("north"))regs.push("north");}
 if(has(loc,["ירושלים"])){if(!regs.includes("jerusalem"))regs.push("jerusalem");}
 if(has(loc,["אשדוד","אשקלון","באר שבע","דרום"])){if(!regs.includes("south"))regs.push("south");}
 return {cats,subs,regs};
}
function matchBuyer(s,b){
 const profile=classifyBusiness(b);
 const cats=normList(s.categories),subs=normList(s.subcategories),regions=normList(s.regions);
 const inCat=cats.length?cats.some(x=>profile.cats.includes(x)):false;
 const inSub=subs.length?subs.some(x=>profile.subs.includes(x)):false;
 if(subs.length&&!inSub)return null;
 if(!inCat&&!inSub)return null;
 const wanted=clean(s.looking_for).toLowerCase();
 if(/(?:בלי|לא|ללא)\s+(?:מסעד|מזון|קפה)/.test(wanted)&&profile.cats.includes("food"))return null;
 const price=Number(b.asking_price);
 if(!Number.isFinite(price)||price<=0)return null;
 if(s.budget_open!==true){
 const min=s.budget_min==null?null:Number(s.budget_min);
 const max=s.budget_max==null?null:Number(s.budget_max);
 if(min!==null&&price<min)return null;
 if(max!==null&&price>max)return null;
 }
 const all=regions.includes("all")||regions.length===0;
 const isSame=regions.some(r=>profile.regs.includes(r));
 const isClose=regions.includes("center")&&profile.regs.includes("tel_aviv")
   ||regions.includes("tel_aviv")&&profile.regs.includes("center")
   ||regions.includes("north")&&profile.regs.includes("haifa")
   ||regions.includes("sharon")&&profile.regs.includes("center");
 if(!all&&!isSame&&!isClose)return null;
 const score=(inSub?75:55)+(all?10:isSame?25:12);
 return {business:b,score,category:inSub?"subcategory":"category",location:isSame?"same":isClose?"near":"all"};
}
function approved(b){
 return b.public_listing_active===true&&b.anon_card_active===true&&b.listing_status==="active"
 &&b.distribution_status==="all_authorized"&&!b.is_archived&&Boolean(b.business_number)
 &&Boolean(clean(b.anon_summary)||clean(b.public_listing_marketing_text))
 &&Boolean(clean(b.anon_display_name));
}
function summary(b,max=430){
 const s=clean(b.anon_summary)||clean(b.public_listing_marketing_text);
 return s.length>max?s.slice(0,max).replace(/\s+\S*$/,"")+"…":s;
}
function to64(arr){let out="";for(let i=0;i<arr.length;i+=16384)out+=String.fromCharCode(...arr.slice(i,i+16384));return btoa(out);}
function url64(bytes){return to64(bytes).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
async function token(s){
 const exp=Math.floor(Date.now()/1000)+60*24*3600;
 const payload=String(s.id)+"."+exp+"."+String(s.email||"").toLowerCase();
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode("bsd-alert-pref-v1:"+k),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const sig=await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(payload));
 return String(s.id)+"."+exp+"."+url64(new Uint8Array(sig));
}
const drawText=(page,font,v,right,y,size,color)=>{
 const str=clean(v).replace(/[^\u05D0-\u05EA\s]/g," ").replace(/\s+/g," ").trim();if(!str)return;
 const visual=str;
 const width=font.widthOfTextAtSize(visual,size);
 page.drawText(visual,{x:Math.max(18,right-width),y,size,font,color});
};
function wrap(font,value,maxWidth,size,maxLines=4){
 const words=clean(value).split(" ").filter(Boolean);
 const lines=[];let line="";
 const measure=t=>font.widthOfTextAtSize(t,size);
 for(const w of words){const tryLine=line?line+" "+w:w;if(measure(tryLine)>maxWidth&&line){lines.push(line);line=w;}else line=tryLine;if(lines.length>=maxLines)break;}
 if(line&&lines.length<maxLines)lines.push(line);
 return lines;
}
let fontBuffer=null;
async function makePdf(items){
 const pdf=await PDFDocument.create();
 pdf.registerFontkit(fontkit);
 if(!fontBuffer){
 const rsp=await fetch("https://raw.githubusercontent.com/openmaptiles/fonts/master/noto-sans/NotoSansHebrew-Regular.ttf",{signal:AbortSignal.timeout(14000)});
 if(!rsp.ok)throw new Error("pdf_font_http_"+rsp.status);
 fontBuffer=new Uint8Array(await rsp.arrayBuffer());
 if(fontBuffer.length<10000)throw new Error("pdf_font_invalid");
 }
 const f=await pdf.embedFont(fontBuffer,{subset:true});
 const latin=await pdf.embedFont(StandardFonts.HelveticaBold);
 const page=pdf.addPage([595,842]);
 const navy=rgb(.055,.12,.21),blue=rgb(.08,.19,.31),gold=rgb(.82,.65,.33),grey=rgb(.38,.45,.53),white=rgb(1,1,1);
 page.drawRectangle({x:0,y:735,width:595,height:107,color:navy});
 page.drawCircle({x:58,y:783,size:27,borderWidth:1.8,borderColor:gold});
 page.drawText("BSD",{x:35,y:773,size:18,font:latin,color:gold});
 drawText(page,f,"משביחים עסקים. מחברים הזדמנויות. מובילים עסקאות.",560,783,10,white);
 drawText(page,f,"שלוש הזדמנויות עסקיות עבורך",558,690,22,blue);
 drawText(page,f,"סקירה ראשונית אנונימית, בהתאם להעדפות החיפוש.",556,664,10,grey);
 for(let i=0;i<items.length;i++){
  const b=items[i].business;const top=630-i*173;
  page.drawRectangle({x:34,y:top-156,width:527,height:158,color:rgb(.982,.989,.997),borderColor:rgb(.83,.88,.93),borderWidth:1});
  page.drawRectangle({x:550,y:top-155,width:5,height:156,color:gold});
  page.drawText("0"+(i+1),{x:45,y:top-24,size:16,font:latin,color:gold});
  drawText(page,f,b.anon_display_name,540,top-28,15,blue);
  drawText(page,f,clean(b.city||b.region),535,top-52,10,grey);
  page.drawText(Number(b.asking_price).toLocaleString("en-US"),{x:427,y:top-72,size:13,font:latin,color:gold});
  drawText(page,f,"שקלים",530,top-72,12,gold);
  let y=top-94;
  for(const ln of wrap(f,summary(b,340),475,10,4)){drawText(page,f,ln,530,y,10,blue);y-=15;}
  page.drawText(String(b.business_number),{x:47,y:top-143,size:8,font:latin,color:grey});
 }
 page.drawRectangle({x:0,y:0,width:595,height:85,color:rgb(.956,.973,.99)});
 drawText(page,f,"לפרטים נוספים נשמח לשמוע ממך",551,57,12,blue);
 page.drawText("www.bsd-bbi.co.il     077 4446707    054 2424999",{x:42,y:37,size:10,font:latin,color:blue});
 drawText(page,f,"הנתונים הם הצגה ראשונית בלבד, כפי שנמסרו ל BSD. אין התחייבות לזמינות או למחיר.",550,16,7,grey);
 return new Uint8Array(await pdf.save());
}
function mailBody(s,items,prefLink){
 const removal=s.unsubscribe_token?web+"/הסרה/?token="+encodeURIComponent(s.unsubscribe_token)+"&channel=email":null;
 const cards=items.map((row,i)=>{
 const b=row.business;
 return "<tr><td style='padding:13px 0'><div style='border:1px solid #dde5f0;border-right:4px solid #cba459;border-radius:10px;padding:14px;background:#fbfcfe'>"
 +"<div style='font-size:12px;color:#92712f'>עסק "+(i+1)+" · "+escape(b.business_number)+"</div>"
 +"<div style='font-size:18px;font-weight:bold;color:#0f294c;margin:5px 0'>"+escape(b.anon_display_name)+"</div>"
 +"<div style='font-size:13px;color:#425772'>"+escape(b.city||b.region||"")+" <strong style='color:#a0772e'>"+escape(money(b.asking_price))+"</strong></div>"
 +"<div style='font-size:13px;line-height:1.75;margin-top:8px'>"+escape(summary(b,240))+"</div></div></td></tr>";
 }).join("");
 return "<!doctype html><html lang='he' dir='rtl'><meta charset='utf-8'><body style='background:#f0f3f8;padding:22px 8px;font-family:Arial,Helvetica,sans-serif;color:#172f4b;direction:rtl'><table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='max-width:620px;margin:auto;background:#fff;border-collapse:collapse;border-radius:12px;overflow:hidden'>"
 +"<tr><td style='background:#0b203c;color:#fff;padding:22px 26px;text-align:right'><img src='"+LOGO+"' alt='BSD' width='62' style='width:62px;height:auto;float:left'><div style='font-size:24px;font-weight:bold;color:#d8b569'>BSD</div><div style='font-size:12px'>משביחים עסקים. מחברים הזדמנויות. מובילים עסקאות.</div></td></tr>"
 +"<tr><td style='padding:25px 26px 10px;text-align:right'><div style='font-size:12px;color:#bb8b3b'>הזדמנויות שנבחרו במיוחד עבורך</div>"
 +"<h1 style='font-size:23px;line-height:1.5;margin:9px 0 14px;color:#10294c'>"+escape(items.length===1?"עסק חדש שעשוי להתאים לך":items.length+" עסקים שעשויים להתאים לך")+"</h1>"
 +"<p style='font-size:15px;line-height:1.8'>שלום "+escape(s.first_name)+",</p><p style='font-size:14px;line-height:1.8'>בהתאם לתחומי העניין, אזור החיפוש והתקציב שבחרת, ריכזנו עבורך הזדמנויות בתחום המבוקש. מצורף PDF מסודר עם סיכום אנונימי של כל עסק.</p>"
 +"<table role='presentation' width='100%' style='border-collapse:collapse'>"+cards+"</table>"
 +"<p style='font-size:14px;line-height:1.8'>מעניין אותך לקבל פרטים נוספים? אפשר להשיב למייל עם מספר העסק, ונשמח לחזור אליך וללוות אותך.</p>"
 +"<table role='presentation' align='center'><tr><td style='background:#d6aa56;border-radius:9px;text-align:center'><a href='"+escape(prefLink)+"' style='display:block;color:#09213d;text-decoration:none;font-size:14px;font-weight:bold;padding:12px 19px'>שינוי תחומי העניין והתקציב שלי</a></td></tr></table>"
 +"<p style='font-size:12px;text-align:center;color:#64748b;line-height:1.7'>הקישור אישי, ומציג את ההעדפות שבחרת. אפשר לעדכן אותן בכל עת בתקופת תוקף הקישור.</p>"
 +"<hr style='border:0;border-top:1px solid #e0e6ef;margin-top:25px'><p style='font-size:13px;line-height:1.7'>בברכה,<br><strong>צוות BSD מתווכי עסקים ישראל</strong><br>077 4446707 | 054 2424999<br><a href='"+web+"' style='color:#0b5b93'>www.bsd-bbi.co.il</a></p>"
 +"<p style='font-size:11px;color:#6f7e90;line-height:1.6'>ההצעות נשלחות בהתאם להגדרותיך. המחירים והנתונים נמסרו על ידי בעלי העסקים וטעונים בדיקה. לעדכון ההעדפות ניתן להשתמש בקישור למעלה.</p>"+(removal?"<p style='font-size:11px'><a href='"+escape(removal)+"' style='color:#64748b'>להסרה מרשימת עדכוני האימייל</a></p>":"")+"</td></tr></table></body></html>";
}
async function run(body){
 const settings=await db.from("bsd_alert_dispatch_auth").select("token,enabled").eq("id",true).single();
 if(settings.error||!settings.data)throw new Error("auth_settings_unavailable");
 const send=body?.send===true;
 if(send&&!settings.data.enabled)return {ok:false,error:"dispatch_disabled"};
 const subs=await db.from("business_alert_subscribers").select("id,first_name,email,unsubscribe_token,status,consent_general,consent_email,legacy_no_consent,email_unsubscribed_at,archived_at,is_test,categories,subcategories,regions,budget_min,budget_max,budget_open,looking_for").eq("status","active").eq("consent_email",true).eq("is_test",false).limit(200);
 if(subs.error)throw subs.error;
 const biz=await db.from("businesses").select("id,business_number,anon_display_name,anon_summary,public_listing_marketing_text,field,category,subcategory,city,region,asking_price,listing_status,distribution_status,public_listing_active,anon_card_active,is_archived,taxonomy").eq("public_listing_active",true).eq("anon_card_active",true).limit(2000);
 if(biz.error)throw biz.error;
 const approvedList=(biz.data||[]).filter(approved);
 const report=[];
 for(const s of (subs.data||[]).filter(isActive)){
  const matches=approvedList.map(b=>matchBuyer(s,b)).filter(Boolean).sort((a,b)=>b.score-a.score||Number(a.business.asking_price)-Number(b.business.asking_price));
  const previously=await db.from("business_alert_sends").select("business_number,status,sent_at,created_by").eq("subscriber_id",s.id);
  if(previously.error)throw previously.error;
  const sentRecords=(previously.data||[]).filter(x=>x.status!=="failed");
  const ids=new Set(sentRecords.map(x=>x.business_number));
  const pending=matches.filter(m=>!ids.has(m.business.business_number)).slice(0,3);
  const last=sentRecords.filter(x=>x.created_by==="auto_digest").map(x=>Date.parse(x.sent_at)).filter(Number.isFinite).reduce((a,b)=>Math.max(a,b),0);
  const tooSoon=last>Date.now()-24*3600*1000;
  const first=(sentRecords.filter(x=>x.created_by==="auto_digest").length===0);
  const minNeeded=first?3:1;
  const ready=pending.length>=minNeeded&&!tooSoon;
  const stat={subscriber_id:s.id,eligible_matches:matches.length,new_matches:pending.length,first_batch:first,ready,selected:pending.map(x=>x.business.business_number)};
  if(!send&&body?.pdf_probe===true&&ready){const bytes=await makePdf(pending);stat.pdf_bytes=bytes.length;stat.pdf_signature=String.fromCharCode(...bytes.slice(0,4));}

  if(!send&&body?.test_admin_email===true&&ready){
   if(!RESEND)throw new Error("resend_missing");
   const bytes=await makePdf(pending);
   const html=mailBody({...s,first_name:"לקוח",unsubscribe_token:null},pending,urlPrefs+"?demo=1");
   const rs=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+RESEND},body:JSON.stringify({
     from:"BSD עסקים למכירה <info@bsd-bbi.co.il>",reply_to:"info@bsd-bbi.co.il",to:["baruch.ezon@gmail.com"],subject:"[בדיקה] BSD | דוגמת מייל אוטומטי עם קובץ PDF",
     html,text:"דוגמת מייל אוטומטי של BSD עם קובץ PDF ומסך שינוי העדפות.",
     attachments:[{filename:"BSD_business_opportunities.pdf",content:to64(bytes),content_type:"application/pdf"}]
   })});
   const result=await rs.json().catch(()=>({}));
   stat.admin_test_sent=rs.ok;stat.admin_test_status=rs.status;stat.pdf_bytes=bytes.length;stat.admin_test_error=rs.ok?null:String(result?.message||"").slice(0,160);
   report.push(stat);continue;
  }

  if(!send&&body?.prefs_probe===true&&ready){
   const purl=urlPrefs+"?token="+encodeURIComponent(await token(s));
   const pf=await fetch(purl,{signal:AbortSignal.timeout(12000)});
   const page=await pf.text();
   stat.preferences_status=pf.status;
   stat.preferences_prefilled=page.includes(String(s.budget_max))&&page.includes("name='subcategory'");
  }
  if(!send||!ready){report.push(stat);continue;}
  if(!RESEND)throw new Error("resend_missing");
  const pdf=await makePdf(pending);
  const prefLink=urlPrefs+"?token="+encodeURIComponent(await token(s));
  const mail=mailBody(s,pending,prefLink);
  const rows=pending.map(x=>({subscriber_id:s.id,business_number:x.business.business_number,match_pct:x.score,channel:"email",created_by:"auto_digest",status:"reserved",sent_at:new Date().toISOString()}));
  const claimed=await db.from("business_alert_sends").upsert(rows,{onConflict:"subscriber_id,business_number",ignoreDuplicates:true}).select("id,business_number");
  if(claimed.error)throw claimed.error;
  const claimedIds=(claimed.data||[]).map(x=>x.id);
  if(claimedIds.length!==rows.length){
   if(claimedIds.length)await db.from("business_alert_sends").update({status:"failed"}).in("id",claimedIds);
   report.push({...stat,sent:false,reason:"concurrent_or_duplicate"});continue;
  }
  const url="https://api.resend.com/emails";
  let ok=false,sendId=null,errText="";
  try{
   const resp=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+RESEND},body:JSON.stringify({
     from:"BSD עסקים למכירה <info@bsd-bbi.co.il>",reply_to:"info@bsd-bbi.co.il",to:[s.email],
     subject:"BSD | "+pending.length+" הזדמנויות עסקיות שנבחרו עבורך",
     html:mail,
     text:"שלום "+s.first_name+", מצורף PDF עם הזדמנויות המתאימות לחיפוש שלך. שינוי העדפות: "+prefLink+" לפרטים: info@bsd-bbi.co.il",
     attachments:[{filename:"BSD_business_opportunities.pdf",content:to64(pdf),content_type:"application/pdf"}]
   })});
   ok=resp.ok;
   const ans=await resp.json().catch(()=>({}));
   sendId=ans?.id||null;
   if(!ok)errText=String(ans?.message||ans?.name||resp.status).slice(0,150);
  }catch(e){errText=e instanceof Error?e.message:String(e);}
  const fin=await db.from("business_alert_sends").update({status:ok?"sent":"failed",...(sendId?{resend_id:sendId}:{})}).in("id",claimedIds);
  if(fin.error)console.error("digest_log_failed",fin.error.message);
  report.push({...stat,sent:ok,pdf_bytes:pdf.length,...(!ok?{error:errText}:{})});
 }
 return {ok:true,sending:send,approved_businesses:approvedList.length,subscribers_considered:report.length,report};
}
Deno.serve(async req=>{
 if(req.method!=="POST")return response({ok:false,error:"method"},405);
 try{
 const settings=await db.from("bsd_alert_dispatch_auth").select("token").eq("id",true).single();
 const header=req.headers.get("x-bsd-dispatch-token")||"";
 const expected=String(settings.data?.token||"");
 const a=new TextEncoder().encode(header),b=new TextEncoder().encode(expected);
 let difference=a.length^b.length;
 for(let i=0;i<Math.max(a.length,b.length);i++)difference|=(a[i]||0)^(b[i]||0);
 if(!expected||difference||!header)return response({ok:false,error:"forbidden"},403);
 const payload=await req.json().catch(()=>({}));
 return response(await run(payload));
 }catch(e){console.error("bsd_alert_dispatch",e instanceof Error?e.message:String(e));return response({ok:false,error:"dispatch_failed",detail:String(e instanceof Error?e.message:e).slice(0,180)},500);}
});
