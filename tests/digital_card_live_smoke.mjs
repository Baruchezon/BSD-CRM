import assert from "node:assert/strict";

const base="https://baruchezon.github.io/BSD-CRM";
const api="https://zcdlegcvfirwzitfxjcs.supabase.co/functions/v1/public-digital-card";
const oldToken="c0a5b39e-7943-42fb-84dd-5ba812dfb172";
const PAUSE_MS=4000;
async function wait(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
async function get(url, expected=200, tries=8){
  for(let attempt=1;attempt<=tries;attempt++){
    try{
      const resp=await fetch(url,{redirect:"follow",headers:{"Cache-Control":"no-cache"},signal:AbortSignal.timeout(12000)});
      if(resp.status!==expected)throw Error("HTTP "+resp.status+" expected "+expected+" for "+url);
      return resp;
    }catch(error){
      if(attempt===tries)throw error;
      console.log("Retry "+attempt+" "+url+": "+String(error));
      await wait(PAUSE_MS);
    }
  }
}
function log(name){console.log("PASS "+name)}
const [live,legacy,manager]=await Promise.all([
  get(base+"/c/ezon/"),
  get(base+"/digital-card.html?card="+oldToken),
  get(base+"/digital-cards.html")
]);
const [page,oldPage,managerPage]=await Promise.all([live.text(),legacy.text(),manager.text()]);
assert.match(page,/id="cardPanel"/);
assert.match(page,/id="bottom"/);
assert.match(page,/id="mainActions"/);
assert.match(page,/navigator\.canShare/);
assert.match(page,/short_code/);
assert.match(page,/property="og:title"/);
log("public premium card renders with save contact first and meta preview");
assert.match(oldPage,/id="cardPanel"/);
log("legacy personal link still serves the interactive card");
assert.match(managerPage,/shortCardLink/);
log("CRM management page has shareable short URL");
const response=await get(api+"?short=ezon");
const payload=await response.json();
assert.ok(payload.card,"Public card absent");
const card=payload.card;
assert.equal(card.short_code,"ezon");
assert.ok(card.full_name.includes("ברוך"));
assert.equal(card.phone_mobile,"054-2424999");
assert.equal(card.phone_office,"077-4446707");
assert.equal(card.email,"baruch@bsd-bbi.co.il");
assert.ok(!("owner_user_id" in card));
log("public API resolves owner with safe fields and formatted phone details");
const oldResp=await get(api+"?card="+oldToken);
const oldPayload=await oldResp.json();
assert.equal(oldPayload.card.short_code,"ezon");
log("legacy UUID API remains compatible");
const vcf=await get(api+"?short=ezon&format=vcard");
assert.match(vcf.headers.get("content-type")||"",/text\/vcard/i);
const vcard=await vcf.text();
for(const line of ["BEGIN:VCARD","VERSION:3.0","FN:ברוך איזון","TEL;TYPE=CELL:054-2424999","TEL;TYPE=WORK:077-4446707","EMAIL;TYPE=WORK:baruch@bsd-bbi.co.il","END:VCARD"]){
 assert.ok(vcard.includes(line),"missing vCard: "+line);
}
log("VCF file download has correct content type and contact details");
await get(api+"?short=unknown-isolated-agent",404,1);
log("unknown public alias does not reveal a card");
console.log("PASS All production checks completed");
