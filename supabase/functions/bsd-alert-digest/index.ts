// bsd-alert-digest v10 (22.11.2026) — VIP DRAFT BUILDER. It never sends email.
// Plan items: א (no self-send; every match becomes a vip_email_drafts row + an approval request for Yossi),
// ב (matching v2), ג (only VIP-approved files, card text fallback with identifier scrub), ה (Process B queue),
// client_profile (vip_build_client_profile), weekly limit (1 email / client / 7 days, max 3 businesses).
// Sending is done only by vip-draft-send after an explicit approval (vip_draft_approve).
// Auth: x-bsd-dispatch-token (cron path, only while bsd_alert_dispatch_auth.enabled) OR a single-use run_token
// (vip_digest_run_tokens, sha256 stored). Body: {mode:"subscribers"|"queue"|"business", business_id?, subscriber_ids?, test_only?, dry?, include_over_budget?}
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
const db=createClient(Deno.env.get("SUPABASE_URL")||"",Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"",{auth:{autoRefreshToken:false,persistSession:false}});
const UNSUB="https://zcdlegcvfirwzitfxjcs.supabase.co/functions/v1/business-alert-unsubscribe";
const LOGO_HDR="https://www.bsd-bbi.co.il/assets/bsd-asset-01-logo.png";
const SLOGAN="משביחים עסקים, מחברים הזדמנויות, מובילים עסקאות";
const SIG="<table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" dir=\"rtl\" style=\"border-top:1px solid #d9e2ed;margin-top:18px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;text-align:right\">\n  <tbody>\n    <tr>\n      <td style=\"vertical-align:middle;padding:16px 0 6px 16px\">\n        <img src=\"cid:logo.png\" alt=\"BSD מתווכי עסקים ישראל\" width=\"130\" height=\"130\" style=\"width:130px;height:auto;display:block;border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic\">\n      </td>\n      <td style=\"vertical-align:middle;padding:16px 0 6px 0;font-size:12px;line-height:1.65;color:#243449;text-align:right\">\n        <strong style=\"font-size:15px;color:#143b64\">ברוך איזון</strong><br>\n        <strong>מנכ״ל | BSD מתווכי עסקים ישראל</strong><br>\n        מגדל BSR 3, רח׳ מצדה 9, בני ברק<br>\n        טל׳: 077-4446707<br>\n        נייד / וואטסאפ: 054-2424999<br>\n        <a href=\"mailto:baruch@bsd-bbi.co.il\" style=\"color:#0B2A5B;text-decoration:none\" target=\"_blank\" rel=\"noreferrer\">baruch@bsd-bbi.co.il</a><br>\n        <a href=\"https://www.bsd-bbi.co.il/\" style=\"color:#185a9d;text-decoration:none\" target=\"_blank\" rel=\"noreferrer\">www.bsd-bbi.co.il</a>\n      </td>\n    </tr>\n  </tbody>\n</table>";
const SIGTXT="ברוך איזון\nמנכ״ל | BSD מתווכי עסקים ישראל\nמגדל BSR 3, רח׳ מצדה 9, בני ברק\nטל׳: 077-4446707\nנייד / וואטסאפ: 054-2424999\nbaruch@bsd-bbi.co.il\nwww.bsd-bbi.co.il";
const escape=(s:any)=>String(s??"").replace(/[&<>"']/g,(c:string)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"} as any)[c]);
const clean=(s:any)=>String(s??"").replace(/[\u0000-\u001f\u007f]/g," ").replace(/\s+/g," ").trim();
const response=(json:any,status=200)=>new Response(JSON.stringify(json),{status,headers:{"content-type":"application/json;charset=utf-8","cache-control":"no-store"}});
async function sha256(t:string){const h=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(t));return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,"0")).join("");}
const normList=(a:any)=>Array.isArray(a)?a.filter(x=>typeof x==="string"):[];
const has=(text:any,terms:any)=>terms.some(w=>text.includes(w));
function classifyBusiness(b:any){
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

// ---------- ב: exclusions ("לא/בלי/ללא ...") from looking_for + client profile notes ----------
const EXCL:[RegExp,(p:any,b:any)=>boolean][]=[
 [/מסעד|אוכל|מזון|פוד/,(p)=>p.cats.includes("food")],
 [/קפה/,(p)=>p.subs.includes("cafe")],
 [/חנו|קמעונ|מסחר/,(p)=>p.cats.includes("retail")||p.cats.includes("grocery")],
 [/מלאי/,(p)=>["retail","grocery","construction"].some(c=>p.cats.includes(c))],
 [/מפעל|ייצור|תעשי/,(p)=>p.cats.includes("construction")],
 [/שותפ/,(_p,b)=>/שותפ|משקיע/.test(clean(b.anon_summary)+clean(b.public_listing_marketing_text))],
 [/זכיינ|זיכיונ|רשת/,(_p,b)=>/זכיינ|זיכיונ/.test(clean(b.anon_summary)+clean(b.anon_display_name))],
 [/משמרות|לילה|לילות/,(p)=>p.subs.includes("restaurant")],
];
function exclusions(text:string){
 const out:string[]=[];const re=/(?:^|[\s,.;:(])(?:בלי|ללא|לא\s+(?:רוצה|מעוניין|מעוניינת|מחפש|מחפשת|מתאים|מתאימה|אוהב|אוהבת)?)\s*([^.,;\n|]{2,40})/g;
 let m;while((m=re.exec(text))){out.push(m[1]);}
 return out;
}
function excludedBy(phrases:string[],p:any,b:any){
 for(const ph of phrases)for(const [re,fn] of EXCL)if(re.test(ph)&&fn(p,b))return ph.trim();
 return null;
}
const REGION_HE:any={tel_aviv:"אזור תל אביב והמרכז",center:"אזור המרכז",sharon:"אזור השרון",haifa:"אזור חיפה והקריות",north:"הצפון",jerusalem:"אזור ירושלים",south:"הדרום",shfela:"אזור השפלה"};
// ---------- ב: matching v2 ----------
function matchBuyer(s:any,b:any,cfg:any,excl:string[],opts:any){
 const profile=classifyBusiness(b);
 const cats=normList(s.categories),subs=normList(s.subcategories),regions=normList(s.regions);
 const inCat=cats.length?cats.some(x=>profile.cats.includes(x)):false;
 const inSub=subs.length?subs.some(x=>profile.subs.includes(x)):false;
 const wanted=clean(s.looking_for);
 const kw=!cats.length&&!subs.length&&wanted.length>2&&wanted.split(/\s+/).some(w=>w.length>3&&clean(b.anon_display_name+" "+b.anon_summary).includes(w));
 if(!inCat&&!inSub&&!kw)return {reject:"sector"};
 const ex=excludedBy(excl,profile,b);
 if(ex)return {reject:"client_excluded:"+ex};
 const flags:string[]=[];
 const price=Number(b.asking_price);const hasPrice=Number.isFinite(price)&&price>0;
 let budgetScore=cfg.budget_weight,budgetNote="";
 if(!hasPrice){flags.push("no_price");budgetScore=0;budgetNote="price_on_request";}
 else if(s.budget_open!==true){
  const min=s.budget_min==null?null:Number(s.budget_min),max=s.budget_max==null?null:Number(s.budget_max);
  if(min!==null&&price<min*cfg.low)return {reject:"below_budget"};
  if(max!==null&&price>max*cfg.high){
   if(!opts.include_over_budget)return {reject:"over_budget_1.3x"};
   flags.push("over_budget_1.3x");budgetScore=-20;budgetNote="over_1.3x";
  }else if(max!==null&&price>max){flags.push("over_budget");budgetScore=Math.round(cfg.budget_weight/2);budgetNote="over";}
  else budgetNote="within";
 }else budgetNote="open";
 const all=regions.includes("all")||regions.length===0;
 const isSame=regions.some(r=>profile.regs.includes(r));
 const isClose=regions.includes("center")&&profile.regs.includes("tel_aviv")||regions.includes("tel_aviv")&&profile.regs.includes("center")
  ||regions.includes("north")&&profile.regs.includes("haifa")||regions.includes("sharon")&&profile.regs.includes("center");
 if(!all&&!isSame&&!isClose)return {reject:"region"};
 const sector=inSub?cfg.sector_weight:inCat?Math.round(cfg.sector_weight*0.8):Math.round(cfg.sector_weight*0.6);
 const loc=all?Math.round(cfg.location_weight*0.6):isSame?cfg.location_weight:Math.round(cfg.location_weight*0.6);
 const score=sector+loc+budgetScore;
 const parts=[inSub?"בתת-התחום שבחרת":inCat?"בתחום שבחרת":"בתחום שתיארת",isSame?"באזור שבחרת":isClose?"באזור סמוך לאזור שבחרת":"",
  budgetNote==="within"?"ובתוך התקציב שציינת":budgetNote==="over"?"ומעט מעל התקציב שציינת":budgetNote==="over_1.3x"?"אך במחיר גבוה מהתקציב שציינת":budgetNote==="price_on_request"?"והמחיר לפי פנייה":""].filter(Boolean);
 const region=profile.regs.map((r:string)=>REGION_HE[r]).find(Boolean)||"";
 return {business:b,score,flags,why:"זה עסק "+parts.join(", ")+".",region,match:{sector:inSub?"sub":inCat?"cat":"keyword",location:isSame?"same":isClose?"near":"all",budget:budgetNote}};
}
function approved(b:any){
 return b.public_listing_active===true&&b.anon_card_active===true&&b.listing_status==="active"
 &&(b.distribution_status==="all_authorized"||b.distribution_status==="selective")&&!b.is_archived&&Boolean(b.business_number)
 &&Boolean(clean(b.anon_summary)||clean(b.public_listing_marketing_text))&&Boolean(clean(b.anon_display_name));
}
// ---------- ג: card text = marketing text, else anon_summary; drop sentences with identifiers ----------
const IDENT=[/מ["״']ר|מטר(?:ים)? רבוע|\bm2\b|\bsqm\b/i,/בע["״']?מ/,/ח\.פ|ח״פ|ח"פ|עוסק מורשה|עוסק פטור/,/רו["״']?ח|עו["״']?ד|רואה חשבון|עורך דין|ושות['׳]?/,
 /(?:נוסד|הוקם|הוקמה|משנת|מאז|בשנת)\s*\d{4}|\b(?:19|20)\d{2}\b/,/דור(?:ות)?\s|דור\s?(?:שני|שלישי|רביעי)/,/עוקבים|followers/i,
 /רחוב|רח['׳]\s|כתובת|קומה\s\d/,/הערה|פנימי|אנונימיות/,/רכבת קלה/,/\d{9}/];
const IDENT2=[/\d,(?!000\b)\d{3}\b/,/ותק.{0,20}\d+\s*שנ|\b\d{2,}\s*שנ(?:ה|ים|ות)\b/,/הון עצמי|ההון העצמי|בעל(?:י)? מניות|יתרת חובה|טעונ(?:ים|ה) בדיקה|זמניים|אינה מאומתת|לפי כרטיס העסק|לפי הנתונים שסופקו|לפי הנמסר/];
function cardText(b:any,max=420){
 const rawSrc=String(b.public_listing_marketing_text||"").trim()?b.public_listing_marketing_text:b.anon_summary;
 const src=String(b.public_listing_marketing_text||"").trim()?"marketing_text":"anon_summary";
 const frags=String(rawSrc||"").split(/\n+|•|(?<=[.!?])\s+/).map(clean).filter(Boolean);
 const kept:string[]=[],removed:string[]=[];
 for(const x of frags){
  if(/[:：]$/.test(x)||(x.split(" ").length<=4&&!/[.!?]$/.test(x)))continue;   // headings
  if(IDENT.some(r=>r.test(x))||IDENT2.some(r=>r.test(x)))removed.push(x);else kept.push(/[.!?…]$/.test(x)?x:x+".");
 }
 let out="";for(const x of kept){if((out+" "+x).trim().length>max)break;out=(out+" "+x).trim();}
 if(!out&&kept[0])out=kept[0].slice(0,max).replace(/\s+\S*$/,"")+"…";
 return {text:out,source:src,removed};
}
const T:any={
 intro:{female:"עברנו בעיון על הפרופיל שמילאת: התחומים, האזור והתקציב. מתוך העסקים שבידינו כרגע בחרנו עבורך {count} שנראות לנו מתאימות לך.",male:"עברנו בעיון על הפרופיל שמילאת: התחומים, האזור והתקציב. מתוך העסקים שבידינו כרגע בחרנו עבורך {count} שנראות לנו מתאימות לך.",neutral:"עברנו בעיון על הפרופיל שמילאת: התחומים, האזור והתקציב. מתוך העסקים שבידינו כרגע בחרנו {count} שנראות לנו מתאימות."},
 desc:"ריכזנו כאן תיאור קצר של כל עסק, ותקציר מלא יישלח לפי בקשה.",
 attach:{female:"לחלק מההזדמנויות מצורף תקציר אנונימי, כדי שתוכלי להתרשם בשקט ובקצב שלך.",male:"לחלק מההזדמנויות מצורף תקציר אנונימי, כדי שתוכל להתרשם בשקט ובקצב שלך.",neutral:"לחלק מההזדמנויות מצורף תקציר אנונימי, כדי להתרשם בשקט ובקצב הנוח."},
 why:{female:"למה חשבנו עלייך",male:"למה חשבנו עליך",neutral:"למה זה מתאים"},
 finance:{female:"מעבר לחיבור לעסק הנכון, BSD מסייעת גם במימון רכישת העסק ומלווה אותך בכל שלב, עד החתימה ואחריה.",male:"מעבר לחיבור לעסק הנכון, BSD מסייעת גם במימון רכישת העסק ומלווה אותך בכל שלב, עד החתימה ואחריה.",neutral:"מעבר לחיבור לעסק הנכון, BSD מסייעת גם במימון רכישת העסק ומלווה בכל שלב, עד החתימה ואחריה."},
 cta:{female:"אם אחת ההזדמנויות מעניינת אותך, אפשר פשוט להשיב למייל הזה או להתקשר אליי, ונקבע שיחה קצרה בזמן שנוח לך.",male:"אם אחת ההזדמנויות מעניינת אותך, אפשר פשוט להשיב למייל הזה או להתקשר אליי, ונקבע שיחה קצרה בזמן שנוח לך.",neutral:"אם אחת ההזדמנויות מעניינת, אפשר פשוט להשיב למייל הזה או להתקשר אליי, ונקבע שיחה קצרה בזמן הנוח."},
 discreet:"פרטים מזהים של העסקים נמסרים לאחר חתימה על הסכם סודיות, כמקובל אצלנו.",
 footer:"המייל נשלח כי נרשמת באתר BSD לעדכונים על עסקים למכירה. אפשר להסיר את עצמך בכל רגע, בלי סיבה:",unsub:"להסרה מרשימת התפוצה"};
const COUNT:any={1:"הזדמנות אחת",2:"שתי הזדמנויות",3:"שלוש הזדמנויות"};
const form=(a:any)=>{a=String(a||"").toLowerCase();return a==="f"||a==="female"?"female":a==="m"||a==="male"?"male":"neutral";};
const one=(x:string,n:number)=>n===1?x.replace("אם אחת ההזדמנויות מעניינת","אם העסק מעניין").replace("של העסקים נמסרים","של העסק נמסרים"):x;
function render(s:any,picks:any[],unsub:string,hasFiles:boolean){
 const g=form(s.address_form),n=picks.length,name=clean(s.first_name)||"שלום";
 const subject=n===1?name+", הזדמנות אחת שבחרנו עבורך":name+", "+(COUNT[n]||n+" הזדמנויות")+" שבחרנו עבורך";
 const P=[n===1?T.intro[g].replace("{count}",COUNT[1]).replace("שנראות לנו מתאימות","שנראית לנו מתאימה"):T.intro[g].replace("{count}",COUNT[n]),n===1?T.desc.replace("של כל עסק","של העסק"):T.desc].concat(hasFiles?[T.attach[g]]:[]);
 const tail=[T.finance[g],T.cta[g],T.discreet].map(x=>one(x,n));
 const card=(m:any)=>{const b=m.business;const price=Number(b.asking_price)>0?Number(b.asking_price).toLocaleString("en-US")+" ₪":"לפי פנייה";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:0 0 14px 0;background:#ffffff;border:1px solid #dce4ef;border-radius:12px;box-shadow:0 3px 0 #c9d6e8;"><tr><td style="padding:18px 20px 16px 20px;text-align:right;border-top:4px solid #d4a941;border-radius:12px 12px 0 0;">`
  +`<p style="margin:0 0 4px 0;font-size:12px;color:#647087;">מספר עסק ${escape(b.business_number)}</p><h2 style="margin:0 0 10px 0;font-size:18px;line-height:1.45;color:#0a1d42;">${escape(b.anon_display_name)}</h2>`
  +(m.region?`<p style="margin:0 0 4px 0;font-size:14px;color:#111c31;">אזור: ${escape(m.region)}</p>`:"")
  +`<p style="margin:0 0 6px 0;font-size:14px;color:#111c31;">מחיר מבוקש: <strong style="color:#102d61;">${escape(price)}</strong></p>`
  +`<p style="margin:10px 0 8px 0;font-size:14px;line-height:1.7;color:#111c31;"><strong style="color:#0f5ea8;">${T.why[g]}:</strong> ${escape(m.why)}</p>`
  +`<p style="margin:0;font-size:14px;line-height:1.7;color:#33415c;">${escape(m.card.text)}</p>`+(m.file?`<p style="margin:8px 0 0 0;font-size:13px;color:#647087;">מצורף: תקציר אנונימי</p>`:"")+`</td></tr></table>`;};
 const ph=P.map(p=>`<p style="margin:0 0 10px 0;">${escape(p)}</p>`).join("");
 const th=tail.slice(0,-1).map(p=>`<p style="margin:0 0 8px 0;">${escape(p)}</p>`).join("")+`<p style="margin:0 0 14px 0;font-size:13.5px;color:#4d5b73;">${escape(tail[tail.length-1])}</p>`;
 const html=`<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${escape(subject)}</title></head>
<body style="margin:0;padding:18px 0;background:#eef2f7;font-family:Rubik,Heebo,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl"><tr><td align="center">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#f8fafc;border-radius:16px;overflow:hidden;border:1px solid #d9e2ed;">
<tr><td style="background:#143b64;background:linear-gradient(135deg,#0a1d42,#143b64 60%,#1f5a96);padding:22px 24px;text-align:right;">
<table role="presentation" width="100%"><tr><td style="text-align:right;vertical-align:middle;"><div style="font-size:21px;font-weight:700;color:#ffffff;">BSD - עסקים למכירה</div>
<div style="font-size:13.5px;color:#f1d384;margin-top:4px;">${SLOGAN}</div></td>
<td style="text-align:left;vertical-align:middle;width:74px;"><img src="${LOGO_HDR}" width="64" height="64" alt="BSD" style="display:block;border:0;width:64px;height:64px;"></td></tr></table></td></tr>
<tr><td style="padding:24px 26px 6px 26px;text-align:right;color:#111c31;font-size:15px;line-height:1.75;">
<p style="margin:0 0 12px 0;">שלום ${escape(name)},</p>${ph}<div style="height:8px"></div>
${picks.map(card).join("\n")}
<div style="height:6px"></div>${th}<p style="margin:0;">בברכה,</p>${SIG}</td></tr>
<tr><td style="padding:14px 26px 18px 26px;background:#eaf0f7;text-align:right;font-size:12px;line-height:1.6;color:#5a6780;">
<div style="color:#143b64;font-weight:700;margin-bottom:4px;">${SLOGAN}</div>${T.footer} <a href="${escape(unsub)}" style="color:#0f5ea8;">${T.unsub}</a></td></tr>
</table></td></tr></table></body></html>`;
 const L=[SLOGAN,"","שלום "+name+",",""].concat(P,[""]);
 picks.forEach((m,i)=>{const b=m.business;L.push(`${i+1}) מספר עסק ${b.business_number}, ${b.anon_display_name}`);if(m.region)L.push("אזור: "+m.region);
  L.push("מחיר מבוקש: "+(Number(b.asking_price)>0?Number(b.asking_price).toLocaleString("en-US")+" ₪":"לפי פנייה"),T.why[g]+": "+m.why,m.card.text,"");});
 const text=L.concat(tail,["","בברכה,",SIGTXT,"",SLOGAN,T.footer+" "+unsub]).join("\n");
 return {subject,html,text};
}
// ---------- shared loaders ----------
const SUBCOLS="id,first_name,email,unsubscribe_token,status,consent_general,consent_email,legacy_no_consent,email_unsubscribed_at,archived_at,is_test,categories,subcategories,regions,budget_min,budget_max,budget_open,looking_for,address_form,lead_id,buyer_id,crm_lead_id";
const BIZCOLS="id,business_number,anon_display_name,anon_summary,public_listing_marketing_text,field,category,subcategory,city,region,asking_price,listing_status,distribution_status,agreement_status,public_listing_active,anon_card_active,is_archived,taxonomy";
const ok=(s:any)=>s.status==="active"&&s.consent_email===true&&s.consent_general===true&&s.legacy_no_consent!==true&&!s.archived_at&&!s.email_unsubscribed_at&&Boolean(s.unsubscribe_token)&&/@/.test(String(s.email||""));
async function loadCfg(){const r=await db.from("business_alert_match_settings").select("budget_low_ratio,budget_high_ratio,min_score,sector_weight,budget_weight,location_weight").eq("id",true).single();
 const d:any=r.data||{};return {low:Number(d.budget_low_ratio||0.7),high:Number(d.budget_high_ratio||1.3),min:Number(d.min_score||60),sector_weight:Number(d.sector_weight||50),budget_weight:Number(d.budget_weight||30),location_weight:Number(d.location_weight||20)};}
async function vipFiles(ids:string[]){
 if(!ids.length)return new Map();
 const r=await db.from("business_sale_files").select("id,business_id,file_name,version_number,created_at").in("business_id",ids).eq("document_type","anonymous_summary").is("deleted_at",null).not("vip_approved_at","is",null).order("created_at",{ascending:false});
 const m=new Map();for(const f of r.data||[])if(!m.has(f.business_id))m.set(f.business_id,f);return m;
}
async function businessStatus(id:string){const r=await db.rpc("vip_business_status",{p_business_id:id});return r.data||{};}
// ---------- draft for one subscriber ----------
async function draftFor(s:any,candidates:any[],cfg:any,opts:any,process:string){
 const stat:any={subscriber_id:s.id,is_test:s.is_test};
 const pend=await db.from("vip_email_drafts").select("id").eq("subscriber_id",s.id).in("status",["draft","approved","sending"]).limit(1);
 if((pend.data||[]).length){stat.skip="pending_draft";return stat;}
 const pr=await db.rpc("vip_build_client_profile",{p_subscriber_id:s.id});
 if(pr.error||!pr.data?.ok){stat.skip="profile_failed";return stat;}
 const prof=pr.data;
 if(prof.last_vip_email_at&&Date.parse(prof.last_vip_email_at)>Date.now()-7*24*3600*1000){stat.skip="weekly_limit";return stat;}
 const received=new Set<string>(prof.received||[]);
 const excl=exclusions(clean(s.looking_for)+" | "+clean(prof.notes_text));
 const rejects:any={};const matches:any[]=[];
 for(const b of candidates){
  if(received.has(b.business_number)){rejects[b.business_number]="already_received";continue;}
  const m:any=matchBuyer(s,b,cfg,excl,opts);
  if(m.reject){rejects[b.business_number]=m.reject;continue;}
  if(m.score<cfg.min&&!m.flags.includes("no_price")){rejects[b.business_number]="score_"+m.score;continue;}
  if(m.flags.includes("no_price")&&m.score<cfg.min-cfg.budget_weight){rejects[b.business_number]="score_"+m.score;continue;}
  matches.push(m);
 }
 matches.sort((a,b)=>b.score-a.score||Number(a.business.asking_price||9e15)-Number(b.business.asking_price||9e15));
 const picks=matches.slice(0,3);
 stat.exclusions=excl;stat.rejected=rejects;stat.selected=picks.map(p=>p.business.business_number);
 if(!picks.length){stat.skip="no_match";return stat;}
 const files=await vipFiles(picks.map(p=>p.business.id));
 const flags=new Set<string>();
 for(const p of picks){
  p.card=cardText(p.business);p.file=files.get(p.business.id)||null;
  if(!p.card.text&&!p.file){p.drop=true;rejects[p.business.business_number]="no_clean_card_text";continue;}
  if(p.card.removed.length)p.flags.push("card_text_scrubbed");
  if(!p.card.text)p.flags.push("card_text_empty");
  const st=await businessStatus(p.business.id);
  for(const f of (st.flags||[]))if(!p.flags.includes(f))p.flags.push(f);
  if(st.held)p.flags.push("public_listing_held");
  p.flags.forEach((f:string)=>flags.add(f));
 }
 for(let i=picks.length-1;i>=0;i--)if(picks[i].drop)picks.splice(i,1);
 stat.selected=picks.map(p=>p.business.business_number);
 if(!picks.length){stat.skip="no_clean_card_text";return stat;}
 const unsub=UNSUB+"?"+new URLSearchParams({token:s.unsubscribe_token,channel:"email"}).toString();
 const hasFiles=picks.some(p=>p.file);
 const r=render(s,picks,unsub,hasFiles);
 const html_sha256=await sha256(r.html);   // computed after the unsubscribe link is in
 stat.subject=r.subject;stat.flags=[...flags];stat.html_sha256=html_sha256;
 stat.cards=picks.map(p=>({n:p.business.business_number,score:p.score,why:p.why,source:p.card.source,removed:p.card.removed.length,file:p.file?.file_name||null,flags:p.flags}));
 if(opts.dry){stat.dry=true;return stat;}
 const lead=s.lead_id||s.buyer_id||s.crm_lead_id||(prof.lead_ids||[])[0]||null;
 const reasons:any={};for(const p of picks)reasons[p.business.business_number]={score:p.score,text:p.why,match:p.match,flags:p.flags,card_source:p.card.source,removed_sentences:p.card.removed};
 const ins=await db.from("vip_email_drafts").insert({subscriber_id:s.id,buyer_lead_id:lead,process,business_numbers:picks.map(p=>p.business.business_number),
  match_reasons:reasons,content_source:hasFiles?(picks.every(p=>p.file)?"anon_file":"mixed"):"card_text",file_ids:picks.filter(p=>p.file).map(p=>p.file.id),
  subject:r.subject,html:r.html,text_body:r.text,html_sha256,unsubscribe_url:unsub,inline_logo_b64:null,
  client_profile:JSON.stringify({lead_ids:prof.lead_ids,received:prof.received,sources:prof.sources,exclusions:excl,gmail_checked:false}).slice(0,4000),
  status:"draft",flags:[...flags],created_by:"bsd-alert-digest v10"}).select("id").single();
 if(ins.error){stat.error=ins.error.message;return stat;}
 stat.draft_id=ins.data.id;return stat;
}
async function subscribers(opts:any){
 let q=db.from("business_alert_subscribers").select(SUBCOLS).eq("status","active").eq("consent_email",true).eq("is_test",opts.test_only===true).limit(500);
 if(Array.isArray(opts.subscriber_ids)&&opts.subscriber_ids.length)q=q.in("id",opts.subscriber_ids.slice(0,50));
 const r=await q;if(r.error)throw r.error;return (r.data||[]).filter(ok);
}
async function run(opts:any){
 const cfg=await loadCfg();
 const biz=await db.from("businesses").select(BIZCOLS).eq("public_listing_active",true).eq("anon_card_active",true).limit(2000);
 if(biz.error)throw biz.error;
 const pub=await db.from("public_business_listings").select("business_number").limit(5000);
 const visible=new Set((pub.data||[]).map((x:any)=>x.business_number));   // Roman's holds: not visible publicly = held
 const all=(biz.data||[]).filter(approved).filter((b:any)=>visible.has(b.business_number));
 const report:any[]=[];
 if(opts.mode==="subscribers"){
  for(const s of await subscribers(opts))report.push(await draftFor(s,all,cfg,opts,"A_new_subscriber"));
  return {ok:true,mode:opts.mode,test_only:opts.test_only===true,dry:opts.dry===true,businesses_considered:all.length,report};
 }
 // Process B: queue rows (or one business_id)
 let items:any[]=[];
 if(opts.mode==="business"&&opts.business_id)items=[{id:null,business_id:opts.business_id,reason:"manual"}];
 else{const qr=await db.from("vip_match_queue").select("id,business_id,reason").is("processed_at",null).order("created_at").limit(20);items=qr.data||[];}
 const subs=await subscribers(opts);
 for(const it of items){
  const b=all.find((x:any)=>x.id===it.business_id);
  const st=await businessStatus(it.business_id);
  const res:any={queue_id:it.id,business_id:it.business_id,business_number:st.business_number,reason:it.reason,flags:st.flags};
  if(!b||!st.eligible||st.held){res.skip=st.held?"held_or_not_public":"not_eligible";}
  else{res.drafts=[];for(const s of subs)res.drafts.push(await draftFor(s,[b],cfg,opts,"B_new_business"));
   res.drafts=res.drafts.filter((d:any)=>d.draft_id||d.dry||d.skip!=="no_match");}
  if(it.id&&!opts.dry)await db.from("vip_match_queue").update({processed_at:new Date().toISOString(),result:res}).eq("id",it.id);
  report.push(res);
 }
 return {ok:true,mode:opts.mode||"queue",test_only:opts.test_only===true,dry:opts.dry===true,report};
}
Deno.serve(async req=>{
 if(req.method!=="POST")return response({ok:false,error:"method"},405);
 try{
  const payload=await req.json().catch(()=>({}));
  if(payload?.send===true||payload?.test_admin_email===true)return response({ok:false,error:"self_send_removed"},410);
  let scope:any=null;
  const header=req.headers.get("x-bsd-dispatch-token")||"";
  if(header){
   const settings=await db.from("bsd_alert_dispatch_auth").select("token,enabled").eq("id",true).single();
   const expected=String(settings.data?.token||"");
   const a=new TextEncoder().encode(header),b=new TextEncoder().encode(expected);
   let diff=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a[i]||0)^(b[i]||0);
   if(!expected||diff)return response({ok:false,error:"forbidden"},403);
   if(settings.data?.enabled!==true)return response({ok:false,error:"dispatch_disabled"},423);
   scope={};
  }else if(typeof payload?.run_token==="string"&&payload.run_token.length>=32){
   const t=await db.rpc("vip_digest_use_token",{p_token:payload.run_token});
   if(!t.data?.ok)return response({ok:false,error:"forbidden"},403);
   scope=t.data.scope||{};
  }else return response({ok:false,error:"forbidden"},403);
  const opts={mode:["subscribers","queue","business"].includes(payload.mode)?payload.mode:"subscribers",business_id:payload.business_id,
   subscriber_ids:payload.subscriber_ids,dry:payload.dry===true||scope.dry===true,include_over_budget:payload.include_over_budget===true,
   test_only:scope.test_only===true?true:payload.test_only===true};
  return response(await run(opts));
 }catch(e){console.error("vip_digest",e instanceof Error?e.message:String(e));return response({ok:false,error:"digest_failed",detail:String(e instanceof Error?e.message:e).slice(0,180)},500);}
});
