import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../js/portal-business-card.js',import.meta.url),'utf8');
const business={id:'qa-business',agreement_status:'יש הסכם חתום',is_archived:false,owner_email:'qa@example.com'};
const account={id:'qa-account',status:'active',username:'12345',pending:false,login_count:4,last_login_at:'2026-11-18T09:00:00Z'};
const detail=(a=account,b=business)=>({ok:true,json:async()=>({account:a,business:b})});
function fixture({responses=[detail()],audit=Promise.resolve({data:[]}),session,clock=false}={}){
 const element=()=>({style:{},innerHTML:'',textContent:'',disabled:false,checked:false,querySelector(){return null;},querySelectorAll(){return [];}});
 const fields=Object.fromEntries(['#sellerPortalEnabled','[data-portal-summary]','[data-portal-controls]','[data-portal-credentials]','[data-portal-email-list]'].map(k=>[k,element()]));
 const listeners={},calls=[],timers=new Map();let timerId=0;
 const root={querySelector:k=>fields[k],addEventListener:(k,fn)=>listeners[k]=fn};
 const chain={select(){return this;},in(){return this;},eq(){return this;},order(){return this;},limit(){return audit;}};
 const context={console,document:{getElementById:id=>id==='sellerPortalCard'?root:null},CustomEvent:function(type,init){this.type=type;this.detail=init.detail;},
  setTimeout:clock?(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;}:setTimeout,
  clearTimeout:clock?id=>timers.delete(id):clearTimeout,
  fetch:async(_url,opts)=>{calls.push(JSON.parse(opts.body));const response=responses.shift();if(response instanceof Error)throw response;return response;},
  window:{BSD_CONFIG:{SELLER_PORTAL_API_URL:'https://qa.invalid/api'},supabaseClient:{auth:{getSession:()=>session||Promise.resolve({data:{session:{access_token:'qa-token'}}})},from:()=>chain},dispatchEvent(){}}};
 vm.createContext(context);vm.runInContext(source,context);
 return {fields,calls,timers,mount:b=>context.window.BSDSellerPortal.mount(b||{...business}),retry:()=>listeners.click({target:{closest:selector=>selector==='[data-portal-controls] button'?{hasAttribute:name=>name==='data-portal-retry'}:null}})};
}

test('existing portal immediately shows visits and management even while email history is stalled',async()=>{
 let release;const audit=new Promise(resolve=>release=resolve);const f=fixture({audit});
 try{
  await f.mount();
  assert.match(f.fields['[data-portal-summary]'].textContent,/4 כניסות/);
  for(const label of ['צפייה כבעל העסק','איפוס סיסמה','חסימת החשבון','ניהול הפורטל'])assert.ok(f.fields['[data-portal-controls]'].innerHTML.includes(label),label);
  assert.equal(f.fields['#sellerPortalEnabled'].disabled,false);
  assert.deepEqual(f.calls.map(c=>c.action),['admin_detail']);
 }finally{release({data:[]});}
});

test('a failed account read exposes retry; retry restores controls without creating or resetting an account',async()=>{
 const f=fixture({responses:[new Error('offline'),detail()]});await f.mount();
 assert.equal(f.fields['#sellerPortalEnabled'].disabled,true);
 assert.match(f.fields['[data-portal-summary]'].textContent,/אין חיבור/);
 assert.match(f.fields['[data-portal-controls]'].innerHTML,/נסה שוב/);
 await f.retry();
 assert.equal(f.fields['#sellerPortalEnabled'].disabled,false);
 assert.match(f.fields['[data-portal-controls]'].innerHTML,/חסימת החשבון/);
 assert.deepEqual(f.calls.map(c=>c.action),['admin_detail','admin_detail']);
});

test('server agreement and archive state override a stale device cache in both directions',async()=>{
 const f=fixture();await f.mount({...business,agreement_status:'אין הסכם',is_archived:true});
 assert.equal(f.fields['#sellerPortalEnabled'].disabled,false);
 assert.match(f.fields['[data-portal-controls]'].innerHTML,/צפייה כבעל העסק/);
 const blocked=fixture({responses:[detail({...account,status:'blocked'},{...business,is_archived:true})]});await blocked.mount();
 assert.equal(blocked.fields['#sellerPortalEnabled'].disabled,true);
 assert.match(blocked.fields['[data-portal-controls]'].innerHTML,/data-portal-unblock disabled/);
 assert.doesNotMatch(blocked.fields['[data-portal-controls]'].innerHTML,/data-portal-preview/);
});

test('zero visits are explicit and an absent account is distinguishable from a read failure',async()=>{
 const zero=fixture({responses:[detail({...account,login_count:0,last_login_at:null})]});await zero.mount();
 assert.match(zero.fields['[data-portal-summary]'].textContent,/0 כניסות/);
 const empty=fixture({responses:[detail(null)]});await empty.mount();
 assert.equal(empty.fields['#sellerPortalEnabled'].disabled,false);
 assert.match(empty.fields['[data-portal-summary]'].textContent,/לא קיים חשבון/);
 assert.equal(empty.fields['[data-portal-controls]'].innerHTML,'');
});

test('a stalled session check ends with a readable retry state and never sends a mutation',async()=>{
 const f=fixture({session:new Promise(()=>{}),clock:true});const mounted=f.mount();
 const timer=[...f.timers.values()].find(t=>t.ms===10000);assert.ok(timer);timer.fn();await mounted;
 assert.match(f.fields['[data-portal-summary]'].textContent,/נמשכה יותר מדי זמן/);
 assert.match(f.fields['[data-portal-controls]'].innerHTML,/נסה שוב/);
 assert.equal(f.calls.length,0);
 assert.equal(f.timers.size,0);
});
