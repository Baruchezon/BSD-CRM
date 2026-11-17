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
    "\nthis.api={cardLookup,cardUrl,makeVcard,vcardUrl};",context,{timeout:1000});
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
  runInNewContext('card={short_code:"ezon"};',ctx);
  assert.equal(ctx.api.cardUrl(),ezon);
  assert.ok(ezon.length<legacy.length/2);
});
test("Other agents get their own short link from immutable code",()=>{
  const ctx=contextFor(other);
  assert.equal(ctx.api.cardLookup().get("short"),"c123abc456");
  runInNewContext('card={short_code:"c123abc456"};',ctx);
  assert.equal(ctx.api.cardUrl(),other);
});
test("Contact file contains the core fields and CRLF delimiters",()=>{
  const ctx=contextFor(ezon);
  runInNewContext('card={full_name:"ברוך איזון",company_name:"BSD",job_title:"מנהל",phone_mobile:"054-2424999",phone_office:"077-4446707",email:"baruch@bsd-bbi.co.il",website_url:"https://bsd-bbi.co.il/"};',ctx);
  const v=ctx.api.makeVcard();
  assert.ok(v.startsWith("\ufeffBEGIN:VCARD\r\n"));
  for(const value of [
    "VERSION:3.0", "FN:ברוך איזון", "N:;ברוך איזון;;;",
    "TEL;TYPE=CELL:054-2424999","TEL;TYPE=WORK:077-4446707",
    "EMAIL;TYPE=WORK:baruch@bsd-bbi.co.il","END:VCARD"
  ])assert.ok(v.includes(value),value);
  assert.ok(v.endsWith("END:VCARD\r\n"));
});
test("Contact saving provides native file sharing and a reliable download fallback",()=>{
  assert.ok(main.includes('navigator.canShare({files:[file]})'));
  assert.ok(main.includes("directVcardDownload()"));
  assert.ok(main.includes("כרטיס איש הקשר ירד למכשיר"));
  assert.ok(api.includes('"Content-Type":"text/vcard; charset=utf-8"'));
  assert.ok(api.includes('"Content-Disposition":'));
  assert.ok(api.includes('data.owner_user_id'));
  assert.ok(api.includes('is_published'));
});
test("CRM sends short URL rather than the opaque UUID address",()=>{
  assert.ok(manager.includes("c/ezon/"));
  assert.ok(manager.includes("shortCardLink"));
  assert.ok(manager.includes("const urlOf=c=>c.short_code?"));
});
