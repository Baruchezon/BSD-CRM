import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read=(p)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const main=read("digital-card.html");
const generic=read("c/index.html");
const personal=read("c/ezon/index.html");
const manager=read("digital-cards.html");
const api=read("supabase/functions/public-digital-card/index.ts");
const extract=(html)=>html.match(/<script>([\s\S]*?)<\/script>/)?.[1]||"";
const legacy="https://baruchezon.github.io/BSD-CRM/digital-card.html?card=c0a5b39e-7943-42fb-84dd-5ba812dfb172";
const ezon="https://baruchezon.github.io/BSD-CRM/c/ezon/";
const other="https://baruchezon.github.io/BSD-CRM/c/#c123abc456";

function contextFor(href){
  const parsed=new URL(href);
  const context={
    URL,URLSearchParams,
    location:{href,pathname:parsed.pathname,hash:parsed.hash,search:parsed.search,origin:parsed.origin}
  };
  runInNewContext(extract(main).replace(/\bload\(\);\s*$/,"")+
    "\nthis.api={cardLookup,cardUrl,vcardUrl,setCard:(v)=>{card=v}};",context,{timeout:1000});
  return context;
}

test("All three public card routes use the same interactive renderer",()=>{
  assert.equal(extract(main),extract(generic));
  assert.equal(extract(main),extract(personal));
});
test("Vanity URL resolves the intended published public alias",()=>{
  const ctx=contextFor(ezon);
  assert.equal(ctx.api.cardLookup().get("short"),"ezon");
  assert.equal(ctx.api.vcardUrl(),"https://zcdlegcvfirwzitfxjcs.supabase.co/functions/v1/public-digital-card?short=ezon&format=vcard");
});
test("Legacy UUID address remains functional and shares new short link",()=>{
  const ctx=contextFor(legacy);
  assert.equal(ctx.api.cardLookup().get("card"),"c0a5b39e-7943-42fb-84dd-5ba812dfb172");
  ctx.api.setCard({short_code:"ezon"});
  assert.equal(ctx.api.cardUrl(),ezon);
  assert.ok(ezon.length<legacy.length/2);
});
test("Other agents get their own short link from immutable code",()=>{
  const ctx=contextFor(other);
  assert.equal(ctx.api.cardLookup().get("short"),"c123abc456");
  ctx.api.setCard({short_code:"c123abc456"});
  assert.equal(ctx.api.cardUrl(),other);
});
function managerContactVcard(data){
  const formatter=manager.match(/function formatPhone\(v\)\{[\s\S]*?^\}/m)?.[0];
  const contact=manager.match(/function vEscape\(s\)\{[\s\S]*?\nfunction esc\(s\)\{/)?.[0];
  assert.ok(formatter && contact);
  const withoutEsc=contact.slice(0,contact.lastIndexOf("function esc(s){"));
  const sandbox={TextEncoder};
  runInNewContext('const tidy=s=>String(s||"").trim();\n'+formatter+'\n'+withoutEsc+
    '\nthis.render=makeContactVcard;',sandbox,{timeout:1000});
  return sandbox.render(data);
}
test("CRM contact exports are BOM-free vCard 3.0 with required name fields",()=>{
  const card={
    full_name:"ברוך איזון",company_name:"BSD",job_title:"מנהל",
    phone_mobile:"054-2424999",phone_office:"077-4446707",
    email:"baruch@bsd-bbi.co.il",website_url:"https://bsd-bbi.co.il/"
  };
  const v=managerContactVcard(card);
  assert.ok(v.startsWith("BEGIN:VCARD\r\n"));
  assert.ok(!v.startsWith("\ufeff"));
  for(const value of [
    "VERSION:3.0", "FN:ברוך איזון", "N:איזון;ברוך;;;",
    "TEL;TYPE=CELL:054-2424999","TEL;TYPE=WORK,VOICE:077-4446707",
    "EMAIL;TYPE=INTERNET,WORK:baruch@bsd-bbi.co.il","END:VCARD"
  ])assert.ok(v.includes(value),value);
  assert.ok(v.endsWith("END:VCARD\r\n"));
});
test("Hebrew vCard lines are folded at 75 UTF-8 bytes",()=>{
  const longName="ברוך איזון";
  const v=managerContactVcard({full_name:longName,company_name:"חברה ".repeat(48),email:"test@example.com"});
  const lines=v.split("\r\n").filter(Boolean);
  for(const line of lines) assert.ok(Buffer.byteLength(line,"utf8")<=75,Buffer.byteLength(line,"utf8")+" octets");
  assert.ok(lines.some(line=>line.startsWith(" ")));
});
test("Contact saving downloads the one server-generated VCF, not a shared in-memory file",()=>{
  assert.ok(main.includes("function saveContact(){"));
  assert.ok(main.includes("const source=vcardUrl()"));
  assert.ok(!main.includes("navigator.canShare({files:[file]})"));
  assert.ok(main.includes("להורדה נוספת של איש הקשר"));
  assert.ok(api.includes('"Content-Type":"text/x-vcard; charset=utf-8"'));
  assert.ok(api.includes('new TextEncoder().encode(vcard)'));
  assert.ok(!api.includes('new Response("\\ufeff"'));
  assert.ok(api.includes('"Content-Disposition":'));
  assert.ok(api.includes('data.owner_user_id'));
  assert.ok(api.includes('is_published'));
});
test("CRM sends short URL rather than the opaque UUID address",()=>{
  assert.ok(manager.includes("c/ezon/"));
  assert.ok(manager.includes("shortCardLink"));
  assert.ok(manager.includes("const urlOf=c=>c.short_code?"));
});
