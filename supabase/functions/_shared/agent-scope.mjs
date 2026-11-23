// Pure, fail-closed rules shared by the CRM Edge Functions and regression tests.
export const AGENT_ACTIONS = new Set([
  'roster','list','screen','card','detail','sends','archive','restore','do_not_call',
  'add_subscriber','set_address_form','log_interaction','status','handling',
  'prepare_whatsapp','prepare_email','send_email','convert_lead','recompute',
  'matches','business_matches','send_match'
]);
export function agentActionAllowed(action, body, subscriberIds, businessIds) {
  if (!AGENT_ACTIONS.has(action)) return false;
  if (['roster','list','screen','add_subscriber'].includes(action)) return true;
  if (action === 'business_matches') return businessIds.has(String(body.id || ''));
  if (action === 'send_match') return subscriberIds.has(String(body.subscriber_id || '')) && businessIds.has(String(body.business_id || ''));
  return subscriberIds.has(String(body.id || ''));
}
export function scopedRows(rows, ids) {
  return (Array.isArray(rows) ? rows : []).filter(row => ids.has(String(row.id)));
}
// Historical subjects/filenames may contain a real business name. Do not send
// them to an agent lacking a full grant, even on their own buyer's send history.
export function redactAgentHistory(value, names) {
  if (Array.isArray(value)) return value.map(item => redactAgentHistory(item, names));
  if (!value || typeof value !== 'object') return value;
  const out = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactAgentHistory(item, names)]));
  if ('business_number' in out) {
    const info = names.get(String(out.business_number));
    if (!info?.full) {
      if ('internal_name' in out) out.internal_name = info?.name || 'עסק אנונימי';
      if ('business_name' in out) out.business_name = info?.name || 'עסק אנונימי';
      if ('subject' in out) out.subject = 'עדכון עסק אנונימי';
      if ('file_name' in out) out.file_name = null;
      for (const key of ['approved_by','created_by','draft_id','resend_id','html_sha256']) delete out[key];
    }
  }
  return out;
}
