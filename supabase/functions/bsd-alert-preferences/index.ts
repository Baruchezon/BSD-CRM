
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
const TAXONOMY = {"categories":[{"slug":"food","label":"מזון ומסעדנות","related":["grocery"],"sub":[{"slug":"restaurant","label":"מסעדה"},{"slug":"cafe","label":"בית קפה"},{"slug":"fast_food","label":"מזון מהיר"},{"slug":"bakery","label":"מאפייה"},{"slug":"catering","label":"קייטרינג"},{"slug":"pub_bar","label":"פאב / בר"},{"slug":"juice_bar","label":"בר מיצים ושייקים"},{"slug":"food_production","label":"ייצור מזון"}]},{"slug":"grocery","label":"קמעונאות מזון","related":["food","retail"],"sub":[{"slug":"supermarket","label":"סופרמרקט"},{"slug":"minimarket","label":"מינימרקט"},{"slug":"produce","label":"ירקות ופירות"},{"slug":"deli","label":"מעדנייה"}]},{"slug":"retail","label":"מסחר וקמעונאות","related":["wholesale","grocery"],"sub":[{"slug":"fashion","label":"הלבשה ואופנה"},{"slug":"beauty_products","label":"מוצרי יופי וטיפוח"},{"slug":"general_store","label":"חנות כללית"},{"slug":"ecommerce","label":"מסחר מקוון"}]},{"slug":"wholesale","label":"ייבוא, סיטונאות והפצה","related":["retail"],"sub":[{"slug":"import","label":"ייבוא"},{"slug":"wholesale","label":"סיטונאות"},{"slug":"distribution","label":"הפצה"}]},{"slug":"beauty","label":"יופי וטיפוח","related":["health"],"sub":[{"slug":"hair_salon","label":"מספרה"},{"slug":"cosmetics","label":"קוסמטיקה"},{"slug":"nails","label":"ציפורניים"},{"slug":"medical_aesthetics","label":"אסתטיקה רפואית"}]},{"slug":"health","label":"בריאות וטיפול","related":["beauty"],"sub":[{"slug":"clinic","label":"קליניקה / מרפאה"},{"slug":"complementary","label":"טיפולים משלימים"},{"slug":"fitness","label":"כושר וסטודיו"}]},{"slug":"auto","label":"רכב","related":[],"sub":[{"slug":"garage","label":"מוסך"},{"slug":"car_accessories","label":"אבזור רכב"},{"slug":"car_wash","label":"שטיפת רכב"}]},{"slug":"construction","label":"בנייה, קבלנות ותעשייה","related":["services"],"sub":[{"slug":"contracting","label":"קבלנות"},{"slug":"hvac_electric","label":"מיזוג אוויר וחשמל"},{"slug":"manufacturing","label":"ייצור ותעשייה"}]},{"slug":"services","label":"שירותים לעסקים","related":["construction"],"sub":[{"slug":"marketing_digital","label":"שיווק ודיגיטל"},{"slug":"software_web","label":"תוכנה ואתרים"},{"slug":"cleaning_maintenance","label":"ניקיון ואחזקה"},{"slug":"transport_tourism","label":"הסעות ותיירות"}]},{"slug":"education_leisure","label":"חינוך ופנאי","related":["health"],"sub":[{"slug":"kindergarten","label":"גנים וצהרונים"},{"slug":"classes","label":"חוגים"},{"slug":"leisure","label":"פנאי ונופש"}]}],"regions":[{"slug":"north","label":"צפון","near":["haifa"]},{"slug":"haifa","label":"חיפה והקריות","near":["north","sharon"]},{"slug":"sharon","label":"שרון","near":["haifa","tel_aviv","center"]},{"slug":"tel_aviv","label":"תל אביב","near":["center","sharon"]},{"slug":"center","label":"מרכז וגוש דן","near":["tel_aviv","sharon","shfela"]},{"slug":"shfela","label":"שפלה","near":["center","jerusalem","south"]},{"slug":"jerusalem","label":"ירושלים והסביבה","near":["shfela"]},{"slug":"south","label":"דרום","near":["shfela"]},{"slug":"all","label":"כל הארץ","near":[]}],"flags":[{"slug":"franchise","label":"זכיינות"}]};
const ORIGIN = "https://www.bsd-bbi.co.il";
const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const supabase=createClient(Deno.env.get("SUPABASE_URL")||"",serviceKey,{auth:{autoRefreshToken:false,persistSession:false}});
const UTF8=new TextEncoder();
const escape=(s)=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ALL_C=new Set(TAXONOMY.categories.map(x=>x.slug));
const ALL_S=new Set(TAXONOMY.categories.flatMap(x=>(x.sub||[]).map(a=>a.slug)));
const ALL_R=new Set(TAXONOMY.regions.map(x=>x.slug));
const ALL_F=new Set(TAXONOMY.flags.map(x=>x.slug));
const hdr={"content-type":"text/html; charset=utf-8","cache-control":"no-store,private","referrer-policy":"no-referrer","x-frame-options":"DENY","x-content-type-options":"nosniff","content-security-policy":"default-src 'none'; img-src https://www.bsd-bbi.co.il; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
const reply=(msg,status=200)=>new Response(msg,{status,headers:hdr});
const text=(s)=>reply("<!doctype html><html dir='rtl' lang='he'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>BSD</title><body style='font:16px Arial,sans-serif;background:#eef2f7;padding:24px'><div style='max-width:660px;margin:auto;background:#fff;border-radius:16px;padding:26px'>"+s+"</div></body></html>");
function decode64(s){try{return Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));}catch{return new Uint8Array(0);}}
function to64(bytes){return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");}
async function sign(payload){const k=await crypto.subtle.importKey("raw",UTF8.encode("bsd-alert-pref-v1:"+serviceKey),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return to64(new Uint8Array(await crypto.subtle.sign("HMAC",k,UTF8.encode(payload))));}
async function check(token){
 const m=/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([0-9]{10})\.([A-Za-z0-9_-]{43})$/i.exec(token||"");
 if(!m)return null;
 const exp=Number(m[2]);
 if(exp<Math.floor(Date.now()/1000)||exp>Math.floor(Date.now()/1000)+91*86400)return null;
 const {data,error}=await supabase.from("business_alert_subscribers").select("id,first_name,last_name,email,status,is_test,archived_at,consent_email,categories,subcategories,regions,flags,budget_min,budget_max,budget_open,looking_for").eq("id",m[1]).maybeSingle();
 if(error||!data||data.is_test||data.archived_at||data.status!=="active"||data.consent_email!==true)return null;
 const expected=decode64(await sign(m[1]+"."+m[2]+"."+String(data.email||"").toLowerCase()));
 const incoming=decode64(m[3]);let diff=expected.length^incoming.length;
 for(let i=0;i<Math.max(expected.length,incoming.length);i++)diff|=(expected[i]||0)^(incoming[i]||0);
 return diff===0?data:null;
}
function opts(list,checked,name){return list.map(o=>"<label style='display:inline-flex;align-items:center;gap:7px;margin:5px 9px 5px 0;background:#f4f7fb;padding:10px 12px;border-radius:9px'><input type='checkbox' name='"+name+"' value='"+escape(o.slug)+"' "+(checked.includes(o.slug)?"checked":"")+">"+escape(o.label)+"</label>").join("");}
function render(row,token,demo=false,notice=""){
 const cats=Array.isArray(row.categories)?row.categories:[];
 const subs=Array.isArray(row.subcategories)?row.subcategories:[];
 const regs=Array.isArray(row.regions)?row.regions:[];
 const flags=Array.isArray(row.flags)?row.flags:[];
 const num=v=>v==null?"":String(v);
 const areas=opts(TAXONOMY.regions,regs,"region");
 const sectors=TAXONOMY.categories.map(cat=>"<section style='border-bottom:1px solid #e8edf4;padding:8px 0'><div style='font-weight:700;color:#102442;margin:9px 0'>"+escape(cat.label)+"</div>"+opts([cat],cats,"category")+(cat.sub?.length?"<div style='margin-top:5px'>"+opts(cat.sub,subs,"subcategory")+"</div>":"")+"</section>").join("");
 return "<!doctype html><html dir='rtl' lang='he'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>עדכון העדפות | BSD</title></head><body style='margin:0;background:#eef2f7;color:#18304c;font-family:Arial,sans-serif;line-height:1.7'><main style='max-width:800px;margin:26px auto;padding:0 14px'><div style='background:#0c203a;color:#fff;padding:22px 26px;border-radius:18px 18px 0 0'><img src='https://www.bsd-bbi.co.il/assets/bsd-asset-01-logo.png' alt='BSD' style='width:58px;height:58px;object-fit:contain;float:left'><div style='font-size:26px;font-weight:bold;color:#e0bd72'>BSD | העדפות קונה</div><div style='font-size:13px'>משביחים עסקים. מחברים הזדמנויות. מובילים עסקאות.</div></div><div style='background:#fff;border-radius:0 0 18px 18px;padding:25px'><h1 style='font-size:25px;margin-top:0'>"+(demo?"תצוגת הדגמה של עדכון העדפות":"שלום "+escape(row.first_name)+", כאן מעדכנים את העסקים שמעניינים אותך")+"</h1><p>אלה אותן הגדרות חיפוש שבחרת בהרשמה. אפשר לשנות תחומים, סוגי עסקים, אזורים, תקציב והערות. העדכון ישפיע על ההמלצות הבאות.</p>"+(notice?"<p role='status' style='color:#08715a;font-weight:bold'>"+escape(notice)+"</p>":"")+(demo?"<p style='color:#9a6b1d;font-weight:bold'>זו הדגמה בלבד, ללא שמירה.</p>":"")+"<form method='post' style='margin-top:20px'><input type='hidden' name='token' value='"+escape(token)+"'><h2 style='font-size:19px'>תחומי עניין וסוגי עסקים</h2>"+sectors+(TAXONOMY.flags.length?"<h2 style='font-size:19px'>העדפות נוספות</h2>"+opts(TAXONOMY.flags,flags,"flag"):"")+"<h2 style='font-size:19px'>אזורי חיפוש</h2>"+areas+"<h2 style='font-size:19px'>תקציב בשקלים</h2><div style='display:flex;gap:12px;flex-wrap:wrap'><label>מינימום <input style='width:128px;padding:9px' name='budget_min' type='number' min='0' step='1000' value='"+escape(num(row.budget_min))+"'></label><label>מקסימום <input style='width:128px;padding:9px' name='budget_max' type='number' min='0' step='1000' value='"+escape(num(row.budget_max))+"'></label></div><label style='display:block;margin-top:12px'><input type='checkbox' name='budget_open' value='yes' "+(row.budget_open?"checked":"")+"> פתוח להצעות ללא מגבלת תקציב</label><h2 style='font-size:19px'>מה עוד חשוב לך?</h2><textarea name='looking_for' rows='4' maxlength='1800' style='font:inherit;width:100%;box-sizing:border-box;border:1px solid #cdd6e4;border-radius:9px;padding:12px'>"+escape(row.looking_for||"")+"</textarea><p><button type='submit' "+(demo?"disabled":"")+" style='background:#c89e45;color:#0b1c35;border:0;border-radius:11px;padding:13px 30px;font-size:17px;font-weight:bold;cursor:pointer'>שמירת ההעדפות החדשות</button></p></form><small>ההגדרות משתנות רק לאחר לחיצה על שמירה. אם הקישור אינו תקף אפשר להירשם מחדש עם אותם פרטים באתר BSD ולהיכנס לתהליך העדכון.</small><hr style='border:none;border-top:1px solid #e6ecf2;margin:26px 0'><div style='font-size:13px'>BSD מתווכי עסקים ישראל<br>077-4446707 | 054-2424999<br><a href='https://www.bsd-bbi.co.il/'>www.bsd-bbi.co.il</a></div></div></main></body></html>";
}
Deno.serve(async req=>{
 try{
 if(req.method!=="GET"&&req.method!=="POST")return text("<h2>בקשה לא נתמכת</h2>",405);
 const url=new URL(req.url);
 if(req.method==="GET"&&url.searchParams.get("demo")==="1"){
 const fake={first_name:"לקוח",categories:["food"],subcategories:["cafe","fast_food"],regions:["center","tel_aviv"],flags:[],budget_min:250000,budget_max:500000,budget_open:false,looking_for:""};
 return reply(render(fake,"",true));
 }
 const form=req.method==="POST"?new URLSearchParams((await req.text()).slice(0,16000)):null;
 const token=req.method==="POST"?String(form?.get("token")||""):String(url.searchParams.get("token")||"");
 const subscriber=await check(token);
 if(!subscriber)return text("<h2>קישור העדכון אינו תקף או שפג תוקפו</h2><p>אפשר להיכנס שוב <a href='"+ORIGIN+"/הרשמה-לעדכונים/'>לטופס ההרשמה</a> עם אותם פרטים כדי לעדכן את הבקשה.</p>",403);
 if(req.method==="GET")return reply(render(subscriber,token));
 const pick=(key,allowed)=>[...new Set(form.getAll(key).map(String))].filter(v=>allowed.has(v));
 const categories=pick("category",ALL_C),subcategories=pick("subcategory",ALL_S),regions=pick("region",ALL_R),flags=pick("flag",ALL_F);
 if(!categories.length&&!subcategories.length)return reply(render(subscriber,token,false,"יש לבחור לפחות תחום עניין אחד"));
 if(!regions.length)return reply(render(subscriber,token,false,"יש לבחור לפחות אזור חיפוש אחד"));
 const budgetOpen=form.get("budget_open")==="yes";
 const rawMin=String(form.get("budget_min")||"").trim(),rawMax=String(form.get("budget_max")||"").trim();
 const min=budgetOpen||!rawMin?null:Number(rawMin),max=budgetOpen||!rawMax?null:Number(rawMax);
 if((min!==null&&(!Number.isSafeInteger(min)||min<0))||(max!==null&&(!Number.isSafeInteger(max)||max<0))||(min!==null&&max!==null&&min>max))return reply(render(subscriber,token,false,"יש לבדוק את טווח התקציב"));
 const updates={categories,subcategories,regions:regions.includes("all")?["all"]:regions,flags,budget_min:min,budget_max:max,budget_open:budgetOpen,looking_for:String(form.get("looking_for")||"").trim().slice(0,1800)};
 const {error}=await supabase.from("business_alert_subscribers").update(updates).eq("id",subscriber.id);
 if(error)throw error;
 const {error:matchErr}=await supabase.from("business_alert_matches").delete().eq("subscriber_id",subscriber.id);
 if(matchErr)console.error("stale-match-clear",matchErr.message);
 return reply(render({...subscriber,...updates},token,false,"ההעדפות נשמרו בהצלחה. ההמלצות הבאות יחושבו לפי הבקשה המעודכנת."));
 }catch(e){console.error("preferences error",e instanceof Error?e.message:String(e));return text("<h2>אירעה תקלה זמנית</h2><p>ניתן לנסות שוב בהמשך.</p>",500);}
});
