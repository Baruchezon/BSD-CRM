import {assertEquals,assert} from 'jsr:@std/assert@1';
import {buildOwnerMatches,BSD_TEAM,PORTAL_TEXT_FALLBACK} from '../../supabase/functions/seller-portal-api/matches.ts';
import {buildTimeline} from '../../supabase/functions/seller-portal-api/timeline.ts';
const B='b1',m=(id:string,buyer:string,status='מידע ראשוני נשלח')=>({id,business_id:B,buyer_id:buyer,status,counterparty_type:'buyer',created_at:'2026-10-01T00:00:00Z'});
const lead=(id:string,name:string,agr='אין הסכם')=>({id,type:'buyer',full_name:name,agreement_status:agr});
Deno.test('full name by default, note never shown, hidden excluded, distinct metrics',()=>{
  const r=buildOwnerMatches({businessId:B,matches:[m('m1','l1'),m('m2','l2'),m('m3','l3'),{...m('mx','l1'),business_id:'other'}],buyers:[{...lead('l1','Named Buyer'),company:'Acme'},lead('l2','Secret Name'),lead('l3','Hidden')],
    permissions:[{match_id:'m1',visible:true,disclose_identity:true},{match_id:'m3',visible:false}],
    notes:[{match_id:'m1',visible_to_client:true,action_type:'שיחה',description:'topic\nמה מסרנו: shared',buyer_response:'resp',follow_up_date:'2026-10-22',occurred_at:'2026-10-19T10:00:00Z'},
           {match_id:'m2',visible_to_client:true,description:'',note:'INTERNAL',occurred_at:'2026-10-18T10:00:00Z'},
           {match_id:'m1',visible_to_client:false,description:'HIDDENROW',occurred_at:'2026-10-18T10:00:00Z'}]});
  const s=JSON.stringify(r);
  assert(!s.includes('INTERNAL')&&s.includes('Secret Name')&&!s.includes('Hidden')&&!s.includes('HIDDENROW')&&!s.includes('"l1"'));
  const c=r.rows.find(x=>x.buyer==='Named Buyer · Acme')!;assertEquals(c.buyer,'Named Buyer · Acme');assert(r.rows.some(x=>x.buyer==='Secret Name'));assertEquals(c.last_contact?.shared,'shared');assertEquals(c.follow_up,'2026-10-22');
  assertEquals(r.summary.contacted,2);assert(!s.includes('קונה פוטנציאלי #'));
  assertEquals(buildTimeline({cards:r.rows,outreach:[],reports:[]}).filter(t=>t.type==='שיחה').length,1);
});

Deno.test('author, short or name-only portal text, and no buyer or staff contact details',()=>{
  const longName='אלכסנדרה כהן-לוי';
  assert(longName.length>=15,'fixture name is long enough that only equality triggers the fallback');
  const kept='הקונה קיבל את התקציר המלא וביקש לחשוב';
  const r=buildOwnerMatches({businessId:B,matches:[m('m1','l1'),m('m2','l2','התאמה חדשה'),m('m3','l3','התאמה חדשה')],
    buyers:[{...lead('l1','Named Buyer'),phone:'052-1111111',email:'buyer1@secret.test'},{...lead('l2',longName),phone:'052-2222222',email:'buyer2@secret.test'},{...lead('l3','דנה כהן'),phone:'052-3333333',email:'buyer3@secret.test'}],
    notes:[
      {match_id:'m1',visible_to_client:true,description:kept,author_name:'חנן פילוסוף',phone:'050-1234567',email:'staff@secret.test',occurred_at:'2026-10-19T10:00:00Z'},
      {match_id:'m2',visible_to_client:true,action_type:'שיחה',description:longName,performer:{full_name:'050-0000000',phone:'050-0000000'},creator:{full_name:'יוצר ההערה'},occurred_at:'2026-10-18T10:00:00Z'},
      {match_id:'m3',visible_to_client:true,description:'עודכן היום\nמה מסרנו: 052-3333333',buyer_response:'כן',author_name:'050-9999999',creator:{full_name:'a@b.co'},occurred_at:'2026-10-17T10:00:00Z'},
      {match_id:'m1',visible_to_client:true,description:'buyer1@secret.test',occurred_at:'2026-10-15T10:00:00Z'},
      {match_id:'m1',visible_to_client:true,description:'',note:'INTERNAL PHONE 052-1111111',occurred_at:'2026-10-16T10:00:00Z'}]});
  const s=JSON.stringify(r);
  for(const bad of ['052-1111111','052-2222222','052-3333333','@secret.test','050-1234567','050-0000000','050-9999999','a@b.co','INTERNAL'])assert(!s.includes(bad),bad);
  const keptRow=r.rows.find(x=>x.buyer==='Named Buyer')!;
  assertEquals(keptRow.notes[0].text,kept);
  assertEquals(keptRow.notes[0].author,'חנן פילוסוף');
  assertEquals(keptRow.contacts[0].author,'חנן פילוסוף');
  assertEquals(r.activity.find(a=>a.buyer==='Named Buyer')!.author,'חנן פילוסוף');
  const named=r.rows.find(x=>x.buyer===longName)!;
  assertEquals(named.notes[0].text,PORTAL_TEXT_FALLBACK);
  assertEquals(named.contacts[0].topic,PORTAL_TEXT_FALLBACK);
  assertEquals(named.notes[0].author,'יוצר ההערה');
  assert(!named.notes[0].text.includes(longName));
  const short=r.rows.find(x=>x.buyer==='דנה כהן')!;
  assertEquals(short.notes[0].text,PORTAL_TEXT_FALLBACK);
  assertEquals(short.notes[0].author,BSD_TEAM);
  assertEquals(short.contacts[0].shared,'');
  assertEquals(short.contacts[0].response,'כן');
  assertEquals(r.activity.find(a=>a.buyer==='דנה כהן')!.action,PORTAL_TEXT_FALLBACK);
});

import {safeCompany} from '../../supabase/functions/seller-portal-api/matches.ts';
Deno.test('company: ID/phone/number-only values are never shown',()=>{
  assertEquals(safeCompany({company:'123456789',id_number:'123456789'}),'');
  assertEquals(safeCompany({company:'ח.פ. 512345678'}),'');
  assertEquals(safeCompany({company:'050-1234567'}),'');
  assertEquals(safeCompany({company:'חברת דוגמה'}),'חברת דוגמה');
});
