import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
const code=readFileSync(new URL('./index.ts',import.meta.url),'utf8');
const enc=new TextEncoder();
function sse(events){return new Response(new ReadableStream({start(c){for(const e of events)c.enqueue(enc.encode('data: '+JSON.stringify(e)+'\n\n'));c.close();}}));}
async function run(mode,body={action:'chat',session:'00000000-0000-4000-8000-000000000001',messages:[{role:'user',content:'כיצד מחשבים שווי?'}]}){
  let handler,calls=[];
  const mock=async(url,opts={})=>{
    calls.push(url);
    if(url.includes('/rest/v1/')){
      let data=[];
      if(url.includes('advisor_settings'))data=[{enabled:true,model:'gpt-5.4'}];
      if(url.includes('advisor_reserve'))data=mode!=='quota';
      if(url.includes('advisor_knowledge'))data=[{title:'BSD',body:'Public knowledge'}];
      if(url.includes('advisor_events'))data=[{id:'00000000-0000-4000-8000-000000000002'}];
      if(url.includes('advisor_capture')) {if(mode==='lead-fail')return new Response('failure',{status:500});data='00000000-0000-4000-8000-000000000003';}
      return Response.json(data);
    }
    if(url.includes('anthropic')){
      if(['claude-fail','both-fail'].includes(mode))return new Response('failure',{status:429});
      if(mode==='partial')return sse([{type:'content_block_delta',delta:{type:'text_delta',text:'partial answer'}},{type:'error'}]);
      return sse([{type:'message_start',message:{usage:{input_tokens:15}}},{type:'content_block_delta',delta:{type:'text_delta',text:'Claude answer'}},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:5}},{type:'message_stop'}]);
    }
    if(mode==='both-fail')return new Response('failure',{status:503});
    return sse([{type:'response.output_text.delta',delta:'GPT answer'},{type:'response.completed',response:{usage:{input_tokens:14,output_tokens:3}}}]);
  };
  const Deno={env:{get:k=>({SUPABASE_URL:'https://db.example',SUPABASE_SERVICE_ROLE_KEY:'test-only',ANTHROPIC_API_KEY:'test-only',OPENAI_API_KEY:'test-only'}[k])},serve:f=>handler=f};
  new Function('Deno','fetch','crypto',code)(Deno,mock,webcrypto);
  const res=await handler(new Request('https://example/advisor',{method:'POST',headers:{apikey:'sb_publishable_baq54BVGwvtjB8c7ZiegCQ_tAXevwfN',origin:'https://www.bsd-bbi.co.il'},body:JSON.stringify(body)}));
  const text=await res.text();return {res,text,events:text.split('\n').filter(Boolean).map(l=>JSON.parse(l)),calls};
}
let r=await run('ok');assert(r.text.includes('Claude answer'));assert(!r.calls.some(c=>c.includes('openai')));
r=await run('claude-fail');assert(r.text.includes('GPT answer'));assert(!r.text.includes('429'));
r=await run('partial');assert(r.events.some(e=>e.reset));assert(r.text.includes('GPT answer'));assert(r.events.at(-1).done);
r=await run('both-fail');assert(r.events.at(-1).handoff);assert(!r.text.includes('503'));
r=await run('quota');assert(r.events[0].handoff);assert(!r.calls.some(c=>c.includes('anthropic')||c.includes('openai')));
const lead={action:'lead',session:'00000000-0000-4000-8000-000000000001',request:'00000000-0000-4000-8000-000000000004',name:'בדיקה',phone:'0500000000',question:'שאלת בדיקה',consent:true};
r=await run('ok',lead);assert(r.events[0].ok);
r=await run('lead-fail',lead);assert(!r.events[0].ok);
r=await run('ok',{...lead,consent:false});assert.equal(r.res.status,400);assert(!r.calls.some(c=>c.includes('advisor_capture')));
for(const content of ['תכין לי הערכת שווי לעסק שלי','תיצור לי קובץ PDF עם תוכנית עסקית','Prepare a market research report']){
  r=await run('ok',{action:'chat',session:'00000000-0000-4000-8000-000000000001',messages:[{role:'user',content}]});
  assert(r.events[0].handoff);assert(r.events[0].message.includes('BSD'));
  assert(!r.calls.some(c=>c.includes('anthropic')||c.includes('openai')));
}
console.log('11 checks passed, including service referrals without generating deliverables');
