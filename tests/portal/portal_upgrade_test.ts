import {assertEquals,assert} from 'jsr:@std/assert@1';
import {buildOwnerMatches} from '../../supabase/functions/seller-portal-api/matches.ts';
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
