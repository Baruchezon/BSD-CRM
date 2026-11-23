import test from 'node:test';
import assert from 'node:assert/strict';
import { agentActionAllowed, scopedRows, redactAgentHistory } from '../supabase/functions/_shared/agent-scope.mjs';
const subscribers=new Set(['mine']), businesses=new Set(['anonymous','released']);
test('agent requests fail closed for foreign IDs and global actions',()=>{
  for(const action of ['detail','card','sends','status','handling','archive','restore','convert_lead','recompute']){
    assert.equal(agentActionAllowed(action,{id:'mine'},subscribers,businesses),true,action);
    assert.equal(agentActionAllowed(action,{id:'other'},subscribers,businesses),false,action);
    assert.equal(agentActionAllowed(action,{},subscribers,businesses),false,action);
  }
  for(const action of ['send_vip','preview_vip_send','send_one_alert','purge','manual_add','new_unknown_action']) assert.equal(agentActionAllowed(action,{id:'mine'},subscribers,businesses),false);
  assert.equal(agentActionAllowed('send_match',{subscriber_id:'mine',business_id:'anonymous'},subscribers,businesses),true);
  assert.equal(agentActionAllowed('send_match',{subscriber_id:'other',business_id:'anonymous'},subscribers,businesses),false);
  assert.equal(agentActionAllowed('send_match',{subscriber_id:'mine',business_id:'private'},subscribers,businesses),false);
});
test('lists never include somebody else or leak global totals through rows',()=>{
  assert.deepEqual(scopedRows([{id:'mine',name:'A'},{id:'other',name:'B'}],subscribers),[{id:'mine',name:'A'}]);
  assert.deepEqual(scopedRows(null,subscribers),[]);
});
test('anonymous history removes names in metadata while a specific full grant retains them',()=>{
  const secret={business_number:'B1',internal_name:'Secret Ltd',business_name:'Secret Ltd',subject:'Secret Ltd offer',file_name:'Secret Ltd.pdf',created_by:'other agent',resend_id:'provider secret'};
  const payload={subscriber:{id:'mine'},sends:[secret,{...secret,business_number:'B2'}]};
  const result=redactAgentHistory(payload,new Map([['B1',{full:false,name:'מפעל אנונימי'}],['B2',{full:true,name:'Released Ltd'}]]));
  assert.equal(result.sends[0].internal_name,'מפעל אנונימי');
  assert.equal(result.sends[0].file_name,null);
  assert.ok(!JSON.stringify(result.sends[0]).includes('Secret Ltd'));
  assert.equal(result.sends[0].created_by,undefined);
  assert.deepEqual(result.sends[1],payload.sends[1]);
  assert.equal(payload.sends[0].file_name,'Secret Ltd.pdf','redaction does not mutate stored history');
});
