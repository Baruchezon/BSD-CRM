// Seller portal "פניות יזומות" (18.10.2026).
// Pure function. Inputs are already limited to the owner's business by the handler
// and by seller_portal_outreach, which has no phone or email columns.
// This function still returns only presentation fields, so a leaked contact column
// on an input row cannot reach the owner.
const t = (v: unknown) => Date.parse(String(v ?? '')) || 0;
const iso = (v: unknown) => {
  const s = String(v ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return t(v) ? new Date(t(v)).toISOString() : null;
};
const clean = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

type Input = { businessId: string; rows: any[]; events?: any[] };

export function buildOwnerOutreach(i: Input) {
  const biz = i.businessId;
  const events = new Map<string, any[]>();
  for (const e of i.events || []) {
    if (!e || e.visible_to_owner !== true || !e.outreach_id) continue;
    const list = events.get(e.outreach_id) || [];
    list.push(e);
    events.set(e.outreach_id, list);
  }
  const rows = (i.rows || [])
    .filter(r => r && r.business_id === biz && r.hidden_from_owner !== true)
    .map(r => {
      const notes = (events.get(r.id) || [])
        .map(e => ({
          date: iso(e.occurred_on || e.occurred_at || e.created_at),
          stage: clean(e.stage, 80),
          text: clean(e.note, 300),
        }))
        .filter(n => n.stage || n.text)
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
        .slice(0, 12);
      return {
        contact_name: clean(r.contact_name, 80) || 'איש קשר',
        channel: clean(r.channel, 40),
        reason: clean(r.reason, 400),
        status: clean(r.status, 80),
        next_step: clean(r.next_step, 200),
        next_step_at: iso(r.next_step_at),
        updated_at: iso(r.updated_at || r.created_at),
        notes,
      };
    })
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  return { rows, summary: { total: rows.length } };
}
