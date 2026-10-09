import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html = fs.readFileSync(new URL('../leads-hub.html', import.meta.url), 'utf8');
const lifecycle = fs.readFileSync(new URL('../js/leadLifecycle.js', import.meta.url), 'utf8');
const code = html.slice(html.indexOf('function websiteLeadTransferNotes('), html.indexOf('async function rejectWebsiteLead('));
const LEAD_ID = 'lead-1';

// In-memory stand-in for the parts of the database the lead card touches,
// including the server rules behind the reported bug:
//  - CHECK client_number_required_if_active (buyer/partner rows need a client number;
//    numbers are assigned on INSERT only unless the 20261004 migration is applied)
//  - BEFORE INSERT dedupe on businesses (error BSD01 for an active card with the same owner phone)
function harness({category='seller', leadType='buyer', clientNumber='BSD-C-2610-1166', agreementStatus='אין הסכם', migrated=false,
  failInsert=false, failUpdate=false, lostInsert=false, rejectRead=false, failAgreementMark=false, popupBlocked=false,
  businesses=[], otherLeads=[], rpcFails=false, canSend=true, role='admin', recordNotes=[], failNotesCopy=false}={}) {
  const lead = {id:LEAD_ID,type:leadType,client_number:clientNumber,full_name:'Test Owner',phone:'050-0000000',email:'test@example.test',business_name:'Test Shop',business_city:'Test City',business_field:'Retail',asking_price:0,notes:'Original inquiry',created_by:'user-1',website_intake_stage:'contacted',status:'בטיפול',agreement_status:agreementStatus,agreement_sent:agreementStatus!=='אין הסכם',is_archived:false,source:'הזנה ידנית'};
  const tables={leads:[lead,...otherLeads.map(x=>({...x}))],businesses:businesses.map(x=>({...x})),record_notes:recordNotes.map(x=>({...x}))};
  const events=[]; const removed=[]; const windows=[];
  let leadWrites=0, seq=2000;
  const digits9=p=>String(p||'').replace(/\D/g,'').slice(-9);
  const db={
    rpc(fn,args){events.push('rpc:'+fn);
      if(rpcFails)return Promise.resolve({data:null,error:{message:'rpc down'}});
      if(fn==='bsd_check_lead_duplicate'){const p=digits9(args.p_phone);return Promise.resolve({data:tables.leads.filter(l=>l.id!==args.p_exclude_id&&p&&digits9(l.phone)===p).map(l=>({id:l.id,full_name:l.full_name,phone:l.phone,client_number:l.client_number,is_archived:l.is_archived,match_level:'phone'})),error:null});}
      return Promise.resolve({data:null,error:{message:'unknown rpc'}});
    },
    from(table){let action='select',values,filters=[],returning=false;const q={
    select(){returning=true;return q},eq(k,v){filters.push(r=>r[k]===v);return q},is(k,v){filters.push(r=>(r[k]??null)===v);return q},in(k,list){filters.push(r=>list.includes(r[k]));return q},limit(){return q},order(){return q},
    insert(v){action='insert';values=v;return q},update(v){action='update';values=v;return q},
    single(){return run(true)},maybeSingle(){return run(true)},then(ok,bad){return run(false).then(ok,bad)}
  };async function run(single){
    events.push(table+':'+action);
    if(action==='insert'&&table==='record_notes'){
      if(failNotesCopy)return {error:{message:'notes insert denied'}};
      for(const v of (Array.isArray(values)?values:[values])){if(v.author_id!=='user-1')return {error:{message:'RLS: author_id must be auth.uid()'}};tables.record_notes.push({...v});}
      return {data:null};
    }
    if(action==='insert'){
      if(failInsert)return {error:{message:'insert denied'}};
      if(tables[table].some(r=>r.id===values.id))return {error:{message:'duplicate key'}};
      if(table==='businesses'){
        const p=digits9(values.owner_phone);
        const m=tables.businesses.find(b=>!b.is_archived&&p&&digits9(b.owner_phone)===p);
        const allowed=values.dedupe_override_reason&&['admin','manager'].includes(role);
        if(m&&!allowed)return {error:{code:'BSD01',message:'קיים כבר במערכת עסק שעשוי להתאים לפרטים שהוזנו',details:JSON.stringify({id:m.id,internal_name:m.internal_name,owner_name:m.owner_name,owner_phone:m.owner_phone,business_number:m.business_number,status:m.status})}};
      }
      tables[table].push({...values});
      if(lostInsert)return {error:{message:'response lost'}};
      return {data:{...values}};
    }
    const rows=tables[table].filter(r=>filters.every(f=>f(r)));
    if(action==='update'){
      if(table==='leads'){leadWrites++;if(failUpdate)return {error:{message:'update denied'}};}
      if(table==='businesses'&&failAgreementMark&&'agreement_status' in values)return {error:{message:'agreement status denied'}};
      for(const r of rows){
        const next={...r,...values};
        if(table==='leads'&&values.type&&['buyer','partner'].includes(next.type)&&!next.client_number&&!next.is_archived){
          if(!migrated)return {error:{code:'23514',message:'new row for relation "leads" violates check constraint "client_number_required_if_active"'}};
          next.client_number='BSD-C-2609-'+(++seq);
        }
        if(table==='leads'&&values.agreement_status==='נשלח הסכם לחתימה')next.agreement_sent=true;
        Object.assign(r,next);
      }
      return returning?{data:structuredClone(rows)}:{data:null};
    }
    if(rejectRead && table==='businesses' && filters.length && !single)return {data:[],error:null};
    if(rejectRead && table==='businesses' && single)return {data:null,error:{message:'read denied'}};
    return {data:single?structuredClone(rows[0]||null):structuredClone(rows)};
  }return q}};
  const el=(id,extra={})=>({id,style:{},disabled:false,textContent:'',children:[],appendChild(c){this.children.push(c);return c},...extra});
  const fields={
    wlSaveBtn:el('wlSaveBtn'),wlSaveOnlyBtn:el('wlSaveOnlyBtn'),wlAgreementBtn:el('wlAgreementBtn'),wlSaveError:el('wlSaveError'),wlSaveOk:el('wlSaveOk'),
    wlTransferTarget:el('wlTransferTarget',{value:category}),
    wlName:{value:'Test Owner'},wlPhone:{value:'050-0000000'},wlEmail:{value:'test@example.test'},wlCity:{value:''},
    wlBusinessName:{value:'Test Shop'},wlBusinessField:{value:'Retail'},wlBusinessCity:{value:'Test City'},
    wlGeneralNotes:{value:'Original inquiry'},wlSummary:{value:'Summary'},wlWants:{value:'Wants'},wlDetails:{value:'Details'},wlNotes:{value:'Call note'}
  };
  const listeners=[];
  const document={getElementById:k=>fields[k],createElement:tag=>{const e=el(null,{tag});e.addEventListener=(t,f)=>{listeners.push({el:e,f});};return e;}};
  const location={href:''};
  const window={supabaseClient:db,BSDDataCache:{remove:(...x)=>removed.push(x)},
    open(url,target){events.push('window.open');if(popupBlocked)return null;const w={closed:false,opener:{},location:{href:url||''},document:{title:'',body:{innerHTML:''}},close(){this.closed=true}};windows.push(w);return w;}};
  const ctx={window,document,location,CURRENT_PROFILE:{id:'user-1',role},canSendAgreement:()=>canSend,loadAll:async()=>{},closeModal(){},setTimeout:f=>f(),encodeURIComponent,URLSearchParams,JSON,Object,Array,String,Error,structuredClone};
  ctx.verifyLeadWrite=async(id,expected)=>{const row=tables.leads.find(r=>r.id===id);const mismatches=Object.entries(expected).filter(([k,v])=>(row[k]??null)!==(v??null)).map(([k])=>k);return {ok:mismatches.length===0,mismatches};};
  vm.createContext(ctx);vm.runInContext(lifecycle,ctx);ctx.BSDLeadLifecycle=ctx.window.BSDLeadLifecycle;vm.runInContext(code,ctx);
  const choiceButtons=()=>fields.wlSaveError.children.flatMap(r=>r.children||[]);
  return {ctx,lead,tables,events,fields,removed,windows,choiceButtons,listeners,get leadWrites(){return leadWrites},
    pending:()=>Array.from(ctx.BSDLeadLifecycle.pending(tables.leads,tables.businesses),l=>l.id),
    run:(opts)=>ctx.saveWebsiteLeadTransfer(lead.id,opts)};
}
const prep = u => new URL(u);

test('seller creates linked business with all available mapped data before completing lead; opens card and clears cache',async()=>{
 const h=harness();await h.run();const b=h.tables.businesses[0];
 assert.equal(b.internal_name,'Test Shop');assert.equal(b.seller_id,h.lead.id);assert.equal(b.owner_phone,h.lead.phone);assert.equal(b.asking_price,0);assert.equal(b.city,'Test City');
 for(const text of ['Original inquiry','Summary','Wants','Details','Call note'])assert.ok(b.notes.includes(text));
 assert.equal(h.lead.website_intake_stage,null);assert.equal(h.lead.type,'seller');assert.match(h.ctx.location.href,/businesses.html\?open=lead-1/);assert.equal(h.removed.length,2);
 assert.ok(h.events.indexOf('businesses:insert')<h.events.indexOf('leads:update'));
 assert.deepEqual(h.pending(),[]);assert.equal(h.events.includes('window.open'),false);
});
test('business creation failure leaves lead in inbox, exposes error and allows retry',async()=>{
 const h=harness({failInsert:true});await h.run();assert.equal(h.leadWrites,0);assert.equal(h.lead.website_intake_stage,'contacted');assert.equal(h.fields.wlSaveBtn.disabled,false);assert.equal(h.ctx.location.href,'');assert.deepEqual(h.pending(),[LEAD_ID]);
});
test('business verification failure cannot report completed transfer',async()=>{
 const h=harness({rejectRead:true});await h.run();assert.equal(h.leadWrites,0);assert.equal(h.ctx.location.href,'');assert.equal(h.fields.wlSaveError.style.display,'block');
});
test('retry after lead write failure reuses business and preserves edited business fields',async()=>{
 const h=harness({failUpdate:true});await h.run();assert.equal(h.ctx.location.href,'');h.tables.businesses[0].internal_name='Edited name';
 const h2=h;h2.tables.leads[0].website_intake_stage='contacted';
 // second attempt without the injected failure
 const ok=harness();ok.tables.businesses.push(...h.tables.businesses);await ok.run();
 assert.equal(ok.tables.businesses.length,1);assert.equal(ok.tables.businesses[0].internal_name,'Edited name');assert.equal(ok.tables.businesses[0].notes.split('Call note').length,2);assert.match(ok.ctx.location.href,/businesses/);
});
test('lost insert response recovers existing linked business',async()=>{
 const h=harness({lostInsert:true});await h.run();assert.equal(h.tables.businesses.length,1);assert.match(h.ctx.location.href,/businesses/);
});
test('double click creates only one business',async()=>{
 const h=harness();await Promise.all([h.run(),h.run()]);assert.equal(h.tables.businesses.length,1);assert.equal(h.leadWrites,1);
});
test('buyer: manual lead becomes the buyer card itself, leaves the inbox, no second record',async()=>{
 const h=harness({category:'buyer'});await h.run();
 assert.equal(h.tables.businesses.length,0);assert.equal(h.tables.leads.length,1);assert.equal(h.lead.type,'buyer');assert.equal(h.lead.status,'הועבר לקונה');
 assert.equal(h.lead.website_intake_stage,null);assert.equal(h.lead.client_number,'BSD-C-2610-1166');assert.ok(h.lead.notes.includes('Summary'));
 assert.equal(h.lead.requested_field,'Retail');assert.match(h.ctx.location.href,/leads.html\?open=lead-1/);assert.equal(h.removed.length,2);
 assert.deepEqual(h.pending(),[]);assert.equal(h.lead.agreement_status,'אין הסכם');
});
test('buyer: seller-type website lead is blocked by the client-number CHECK without the DB fix, with a clear message and nothing changed',async()=>{
 const h=harness({category:'buyer',leadType:'seller',clientNumber:null});await h.run();
 assert.equal(h.lead.type,'seller');assert.equal(h.lead.website_intake_stage,'contacted');assert.equal(h.ctx.location.href,'');
 assert.match(h.fields.wlSaveError.textContent,/מספר לקוח/);assert.deepEqual(h.pending(),[LEAD_ID]);assert.equal(h.fields.wlSaveBtn.disabled,false);
});
test('buyer: seller-type website lead transfers once the DB numbering fix is applied',async()=>{
 const h=harness({category:'buyer',leadType:'seller',clientNumber:null,migrated:true});await h.run();
 assert.equal(h.lead.type,'buyer');assert.match(h.lead.client_number,/^BSD-C-/);assert.equal(h.lead.website_intake_stage,null);assert.deepEqual(h.pending(),[]);assert.match(h.ctx.location.href,/leads.html\?open=lead-1/);
});
test('no destination chosen: nothing is written and the card says what to choose',async()=>{
 for(const sendAgreement of [false,true]){
  const h=harness({category:''});await h.run({sendAgreement});
  assert.equal(h.leadWrites,0);assert.equal(h.tables.businesses.length,0);assert.equal(h.ctx.location.href,'');assert.equal(h.fields.wlSaveError.style.display,'block');assert.equal(h.windows.length,0);
  assert.equal(h.lead.website_intake_stage,'contacted');
 }
});
test('send agreement + buyer: tab opened inside the click, buyer agreement form for the same card, status marked, lead moved',async()=>{
 const h=harness({category:'buyer'});await h.run({sendAgreement:true});
 assert.equal(h.events[0],'window.open');assert.equal(h.windows.length,1);
 const u=prep(h.windows[0].location.href);
 assert.equal(u.origin+u.pathname,'https://baruchezon.github.io/bsd-contracts/bsd-admin-prep.html');
 assert.equal(u.searchParams.get('type'),'buyer');assert.equal(u.searchParams.get('recordId'),LEAD_ID);assert.equal(u.searchParams.get('name'),'Test Owner');assert.equal(u.searchParams.get('phone'),'050-0000000');
 assert.equal(h.windows[0].opener,null);
 assert.equal(h.lead.agreement_status,'נשלח הסכם לחתימה');assert.equal(h.lead.agreement_sent,true);assert.equal(h.lead.type,'buyer');assert.deepEqual(h.pending(),[]);
 assert.match(h.ctx.location.href,/leads.html\?open=lead-1/);
});
test('send agreement + seller: seller agreement form for the new business card, business status marked, lead moved',async()=>{
 const h=harness({category:'seller'});await h.run({sendAgreement:true});
 const u=prep(h.windows[0].location.href);const b=h.tables.businesses[0];
 assert.equal(u.searchParams.get('type'),'seller');assert.equal(u.searchParams.get('recordId'),b.id);assert.equal(u.searchParams.get('biz'),'Test Shop');
 assert.equal(b.agreement_status,'נשלח הסכם לחתימה');assert.equal(h.lead.type,'seller');assert.deepEqual(h.pending(),[]);assert.match(h.ctx.location.href,/businesses.html\?open=lead-1/);
});
test('send agreement never downgrades a signed agreement',async()=>{
 const h=harness({category:'buyer',agreementStatus:'יש הסכם חתום'});await h.run({sendAgreement:true});
 assert.equal(h.lead.agreement_status,'יש הסכם חתום');assert.equal(prep(h.windows[0].location.href).searchParams.get('type'),'buyer');
});
test('send agreement: a failed transfer closes the pre-opened tab and changes nothing',async()=>{
 for(const opts of [{category:'buyer',failUpdate:true},{category:'seller',failInsert:true}]){
  const h=harness(opts);await h.run({sendAgreement:true});
  assert.equal(h.windows.length,1);assert.equal(h.windows[0].closed,true);assert.equal(h.windows[0].location.href,'');
  assert.equal(h.lead.agreement_status,'אין הסכם');assert.equal(h.lead.website_intake_stage,'contacted');assert.equal(h.ctx.location.href,'');assert.equal(h.fields.wlSaveBtn.disabled,false);
 }
});
test('send agreement: popup blocked -> transfer done, links to the agreement form and to the card, no redirect',async()=>{
 const h=harness({category:'buyer',popupBlocked:true});await h.run({sendAgreement:true});
 assert.deepEqual(h.pending(),[]);assert.equal(h.ctx.location.href,'');
 const links=h.fields.wlSaveOk.children;assert.equal(links.length,2);
 assert.equal(prep(links[0].href).searchParams.get('recordId'),LEAD_ID);assert.equal(links[0].target,'_blank');assert.match(links[1].href,/leads.html\?open=lead-1/);
});
test('send agreement: business status write failure is reported, transfer still completes',async()=>{
 const h=harness({category:'seller',failAgreementMark:true});await h.run({sendAgreement:true});
 assert.match(h.fields.wlSaveOk.textContent,/סטטוס ההסכם/);assert.match(h.ctx.location.href,/businesses/);assert.equal(h.windows[0].closed,false);
});
test('send agreement without permission: nothing happens',async()=>{
 const h=harness({category:'buyer',canSend:false});await h.run({sendAgreement:true});
 assert.equal(h.leadWrites,0);assert.equal(h.windows.length,0);assert.match(h.fields.wlSaveError.textContent,/הרשאה/);
});
test('seller with an existing unlinked business (same phone): choice instead of "already exists"; link reuses that card, no duplicate',async()=>{
 const h=harness({category:'seller',businesses:[{id:'biz-old',internal_name:'Old Shop',owner_name:'Test Owner',owner_phone:'0500000000',business_number:'BSD-B-2609-1',is_archived:false,seller_id:null,notes:'old notes',agreement_status:'אין הסכם'}]});
 await h.run();
 assert.equal(h.leadWrites,0);assert.equal(h.tables.businesses.length,1);assert.equal(h.lead.website_intake_stage,'contacted');assert.equal(h.ctx.location.href,'');
 assert.match(h.fields.wlSaveError.textContent,/Old Shop/);
 const buttons=h.choiceButtons();assert.deepEqual(buttons.map(b=>b.textContent),['קשר את הליד לכרטיס הקיים והעבר','פתח את כרטיס העסק הקיים','צור כרטיס עסק נפרד בכל זאת']);
 assert.match(buttons[1].href,/businesses.html\?open=biz-old/);
 await h.listeners.find(l=>l.el===buttons[0]).f();
 assert.equal(h.tables.businesses.length,1);assert.equal(h.tables.businesses[0].seller_id,LEAD_ID);assert.ok(h.tables.businesses[0].notes.startsWith('old notes'));assert.ok(h.tables.businesses[0].notes.includes('Call note'));
 assert.equal(h.lead.website_intake_stage,null);assert.deepEqual(h.pending(),[]);assert.match(h.ctx.location.href,/businesses.html\?open=biz-old/);
});
test('seller: existing business linked to another lead cannot be claimed; manager may create a separate card on purpose',async()=>{
 const biz={id:'biz-other',internal_name:'Other',owner_phone:'0500000000',is_archived:false,seller_id:'lead-x'};
 const agent=harness({category:'seller',role:'agent_authorized',businesses:[biz]});await agent.run();
 assert.deepEqual(agent.choiceButtons().map(b=>b.textContent),['פתח את כרטיס העסק הקיים']);
 const h=harness({category:'seller',businesses:[biz]});await h.run({sendAgreement:true});
 assert.equal(h.windows[0].closed,true);
 const sep=h.choiceButtons().find(b=>b.textContent==='צור כרטיס עסק נפרד בכל זאת');
 await h.listeners.find(l=>l.el===sep).f();
 assert.equal(h.tables.businesses.length,2);const created=h.tables.businesses.find(b=>b.id===LEAD_ID);assert.ok(created.dedupe_override_reason);
 assert.deepEqual(h.pending(),[]);assert.equal(prep(h.windows[1].location.href).searchParams.get('type'),'seller');
});
test('buyer: an existing buyer card with the same phone -> choice; "העבר בכל זאת" completes; inbox leads and archived cards are not counted',async()=>{
 const others=[{id:'buyer-old',type:'buyer',full_name:'Old Buyer',client_number:'BSD-C-2609-1',phone:'0500000000',is_archived:false,website_intake_stage:null},
               {id:'inbox-twin',type:'seller',full_name:'Twin',phone:'0500000000',is_archived:false,website_intake_stage:'new'},
               {id:'arch',type:'buyer',full_name:'Arch',client_number:'BSD-C-1',phone:'0500000000',is_archived:true}];
 const h=harness({category:'buyer',otherLeads:others});await h.run();
 assert.equal(h.leadWrites,0);assert.match(h.fields.wlSaveError.textContent,/Old Buyer/);
 const [open,force]=h.choiceButtons();assert.match(open.href,/leads.html\?open=buyer-old/);
 await h.listeners.find(l=>l.el===force).f();
 assert.equal(h.lead.type,'buyer');assert.equal(h.lead.website_intake_stage,null);assert.match(h.ctx.location.href,/leads.html\?open=lead-1/);
 const clean=harness({category:'buyer',otherLeads:others.slice(1)});await clean.run();assert.equal(clean.lead.website_intake_stage,null);
});
test('buyer duplicate check is a warning only: if it cannot run, the transfer proceeds',async()=>{
 const h=harness({category:'buyer',rpcFails:true});await h.run();assert.equal(h.lead.website_intake_stage,null);
});
test('all inline scripts parse',()=>{
 for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
});
test('lead card: «סוג הליד» preselected from the lead, buttons «שמור» and primary «שמור והעבר»; agreement button optional and only for permitted users',()=>{
 const card=html.slice(html.indexOf('function renderWebsiteLeadConversationForm('),html.indexOf('function wlAutoGrow('));
 assert.match(card,/<option value="buyer" \$\{leadCardTypeValue\(r\) === 'buyer' \? 'selected' : ''\}>קונה<\/option>/);
 assert.match(card,/<option value="seller" \$\{leadCardTypeValue\(r\) === 'seller' \? 'selected' : ''\}>מוכר<\/option>/);
 assert.match(card,/id="wlSaveOnlyBtn" onclick="saveLeadOnly\('\$\{r\.id\}'\)">שמור<\/button>/);
 assert.match(card,/class="btn btn-navy" id="wlSaveBtn" onclick="saveWebsiteLeadTransfer\('\$\{r\.id\}'\)">שמור והעבר<\/button>/);
 assert.doesNotMatch(card,/שמור בלידים/);
 // primary button is the last action; the agreement button is secondary (ghost) and separate
 const actions=card.slice(card.indexOf('<div class="modal-actions"'));
 assert.ok(actions.indexOf('id="wlSaveBtn"')>actions.indexOf('id="wlSaveOnlyBtn"')&&actions.indexOf('id="wlSaveOnlyBtn"')>actions.indexOf('id="wlAgreementBtn"'));
 assert.match(card,/canSendAgreement\(\) \? `<button type="button" class="btn btn-ghost" id="wlAgreementBtn"[^`]*sendAgreement:true/);
 const h=harness();vm.runInContext(html.slice(html.indexOf('function leadCardTypeValue('),html.indexOf('function wlAutoGrow(')),h.ctx);
 assert.equal(h.ctx.leadCardTypeValue({type:'seller'}),'seller');assert.equal(h.ctx.leadCardTypeValue({type:'buyer'}),'buyer');
 assert.equal(h.ctx.leadCardTypeValue({type:'partner'}),'buyer');assert.equal(h.ctx.leadCardTypeValue({}),'');
});

test('«שמור»: saves every field and the chosen type, lead stays in «לידים», nothing created',async()=>{
 const h=harness({category:'seller',leadType:'buyer'});
 h.fields.wlNotes.value='הערת דנה המזכירה: מחקר';
 await h.ctx.saveLeadOnly(h.lead.id);
 assert.equal(h.lead.intake_conversation_notes,'הערת דנה המזכירה: מחקר');assert.equal(h.lead.intake_conversation_summary,'Summary');
 assert.equal(h.lead.type,'seller');assert.equal(h.lead.status,'בטיפול');assert.equal(h.lead.website_intake_stage,'contacted');
 assert.deepEqual(h.pending(),[h.lead.id]);assert.equal(h.tables.businesses.length,0);assert.equal(h.ctx.location.href,'');
 assert.equal(h.fields.wlSaveError.style.display||'none','none');assert.match(h.fields.wlSaveOk.textContent,/נשאר ברשימת הלידים/);
 // a buyer-type lead saved as buyer keeps its type
 const b=harness({category:'buyer',leadType:'buyer'});await b.ctx.saveLeadOnly(b.lead.id);assert.equal(b.lead.type,'buyer');assert.deepEqual(b.pending(),[b.lead.id]);
});

test('«שמור והעבר» seller: one business with all lead info and every note (card fields + note history), lead leaves «לידים», nothing sent',async()=>{
 const notes=[{table_name:'leads',record_id:LEAD_ID,note_text:'שיחה ראשונה',created_at:'2026-10-04T10:00:00Z'},{table_name:'leads',record_id:LEAD_ID,note_text:'לחזור מחר',created_at:'2026-10-04T11:00:00Z'},{table_name:'leads',record_id:'other',note_text:'לא שלו'}];
 const h=harness({category:'seller',recordNotes:notes});
 h.fields.wlNotes.value='הערת דנה המזכירה: מחקר';
 await h.run();
 assert.equal(h.tables.businesses.length,1);const b=h.tables.businesses[0];
 assert.equal(b.seller_id,h.lead.id);assert.equal(b.owner_name,'Test Owner');assert.equal(b.owner_phone,'050-0000000');assert.equal(b.owner_email,'test@example.test');
 assert.equal(b.internal_name,'Test Shop');assert.equal(b.field,'Retail');assert.equal(b.city,'Test City');assert.equal(b.agreement_status,'אין הסכם');
 for(const t of ['Original inquiry','מהות השיחה: Summary','מה הלקוח מחפש: Wants','פרטים חשובים: Details','הערות שיחה: הערת דנה המזכירה: מחקר'])assert.ok(b.notes.includes(t),t);
 const copied=h.tables.record_notes.filter(n=>n.table_name==='businesses'&&n.record_id===b.id).map(n=>n.note_text);
 assert.deepEqual(copied,['[מהליד] שיחה ראשונה','[מהליד] לחזור מחר']);
 assert.deepEqual(h.pending(),[]);assert.equal(h.lead.type,'seller');assert.equal(h.lead.website_intake_stage,null);
 assert.match(h.ctx.location.href,/businesses\.html\?open=/);assert.equal(h.windows.length,0);
 // retry never doubles the copied notes
 h.lead.website_intake_stage='contacted';await h.run();
 assert.equal(h.tables.businesses.length,1);assert.equal(h.tables.record_notes.filter(n=>n.table_name==='businesses').length,2);
});

test('«שמור והעבר» seller: if copying the note history fails the transfer still completes and says so',async()=>{
 const h=harness({category:'seller',recordNotes:[{table_name:'leads',record_id:LEAD_ID,note_text:'x'}],failNotesCopy:true});
 await h.run();
 assert.deepEqual(h.pending(),[]);assert.equal(h.tables.businesses.length,1);
 assert.match(h.fields.wlSaveOk.textContent,/הערות הליד לא הועתקו/);assert.match(h.ctx.location.href,/businesses/);
});

test('«שמור והעבר» buyer: same card becomes the buyer with a client number, keeps every note, leaves «לידים», no agreement',async()=>{
 const h=harness({category:'buyer',leadType:'seller',clientNumber:null,migrated:true});
 h.fields.wlNotes.value='הערת דנה המזכירה: מחקר';
 await h.run();
 assert.equal(h.tables.leads.length,1);assert.equal(h.tables.businesses.length,0);
 assert.equal(h.lead.type,'buyer');assert.ok(h.lead.client_number);assert.equal(h.lead.website_intake_stage,null);
 assert.equal(h.lead.intake_conversation_notes,'הערת דנה המזכירה: מחקר');assert.ok(h.lead.notes.includes('הערות שיחה: הערת דנה המזכירה: מחקר'));
 assert.equal(h.lead.agreement_status,'אין הסכם');assert.equal(h.windows.length,0);
 assert.deepEqual(h.pending(),[]);assert.match(h.ctx.location.href,/leads\.html\?open=/);
});

test('manual «ליד חדש» form lets you set the type (קונה default, or מוכר)',()=>{
 assert.match(html,/<select id="manualType"><option value="buyer">קונה<\/option><option value="seller">מוכר<\/option><\/select>/);
 assert.match(html,/type:\(document\.getElementById\('manualType'\) \|\| \{\}\)\.value === 'seller' \? 'seller' : 'buyer'/);
});
test('«מצב טיפול»: a changed value is written with «שמור והעבר» (buyer and seller) and with «שמור»; unchanged is not sent',async()=>{
 for(const category of ['buyer','seller']){
  const h=harness({category});h.fields.wlHandlingStatus={value:'לחזור עם תשובה',dataset:{orig:'לא טופל'},disabled:false};
  h.lead.handling_status='לא טופל';await h.run();
  assert.equal(h.lead.handling_status,'לחזור עם תשובה',category);assert.equal(h.fields.wlSaveError.style.display,'none');
  assert.equal(h.tables.businesses.some(b=>'handling_status' in b),false,'business card untouched');
 }
 const s=harness({category:'buyer'});s.fields.wlHandlingStatus={value:'טופל',dataset:{orig:'סטנד ביי'},disabled:false};s.lead.handling_status='סטנד ביי';
 await s.ctx.saveLeadOnly(s.lead.id);assert.equal(s.lead.handling_status,'טופל');assert.equal(s.lead.website_intake_stage,'contacted');
 const u=harness({category:'buyer'});u.fields.wlHandlingStatus={value:'לא טופל',dataset:{orig:'לא טופל'},disabled:false};u.lead.handling_status='טופל';
 await u.run();assert.equal(u.lead.handling_status,'טופל','unchanged select never overwrites a value saved elsewhere');
});
