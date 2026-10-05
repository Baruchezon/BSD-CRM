import {documentBucket, DOC_LABELS} from './latest-files.ts';
// Seller portal "buyers" table (05.10.2026, approved layout by Baruch).
// Pure function: builds what the BUSINESS OWNER sees about the buyers matched to
// HIS business. Inputs are already filtered by the owner's business id in the
// handler; this function filters again and returns only presentation fields:
// buyer display name, agreement badge, stage, materials, date, owner-visible notes.
// Never returned: buyer id, phone, email, ID number, internal CRM notes,
// handler names, prices, commissions or anything about other businesses.
export const SIGNED_STATUS = 'יש הסכם חתום';
const SENT_STATUS = 'נשלח הסכם לחתימה';
// CRM match status -> [owner-facing label, progress step 1..5, closed]
// Meetings are intentionally not shown to the owner (meeting statuses read as "advanced review").
const STAGES: Record<string, [string, number, boolean?]> = {
  'התאמה חדשה': ['נמצאה התאמה לקונה', 1],
  'מידע ראשוני נשלח': ['קיבל מידע ראשוני על העסק', 2],
  'תקציר נשלח': ['קיבל מידע ראשוני על העסק', 2],
  'ממתין לתגובה': ['ממתינים לתגובת הקונה', 2],
  'ממתין לחתימת סודיות': ['ממתינים לחתימת הסכם', 2],
  'מתעניין': ['הקונה הביע עניין', 2],
  'הקונה מעוניין': ['הקונה הביע עניין', 2],
  'נחתמה סודיות': ['חתם על הסכם', 3],
  'חומרים מלאים נשלחו': ['קיבל חומרים מלאים', 4],
  'בבדיקת נתונים': ['הקונה בודק את הנתונים', 4],
  'נקבעה פגישה': ['הקונה בבדיקה מתקדמת', 4],
  'התקיימה פגישה': ['הקונה בבדיקה מתקדמת', 4],
  'פגישה': ['הקונה בבדיקה מתקדמת', 4],
  'במשא ומתן': ['מתנהל משא ומתן', 5],
  'עסקה הושלמה': ['העסקה הושלמה', 5],
  'נדרש עדכון': ['בטיפול צוות BSD', 1],
  'הוקפא': ['התהליך מוקפא זמנית', 0, true],
  'הקונה לא מעוניין': ['הקונה החליט לא להמשיך', 0, true],
  'נסגר ללא עסקה': ['התהליך נסגר ללא עסקה', 0, true],
};
const FULL_STATUS = 'חומרים מלאים נשלחו';
const FULL_LEGACY = ['חומר מורחב נשלח', 'נשלחו מסמכים לאחר חתימת הסכם'];
const t = (v: unknown) => Date.parse(String(v ?? '')) || 0;
const iso = (v: unknown) => (t(v) ? new Date(t(v)).toISOString() : null);
const latest = (...v: unknown[]) => { const n = Math.max(0, ...v.map(t)); return n ? new Date(n).toISOString() : null; };
const clean = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export function buyerName(l: any): string {
  return clean(l?.full_name, 80) || clean([l?.first_name, l?.last_name].filter(Boolean).join(' '), 80) || 'קונה';
}
export function agreementBadge(l: any) {
  const s = l?.agreement_status;
  if (s === SIGNED_STATUS) return {key: 'signed', label: 'חתום', date: iso(l?.agreement_signed_date)};
  if (s === SENT_STATUS || (!s && l?.agreement_sent === true)) return {key: 'sent', label: 'נשלח הסכם', date: null};
  return {key: 'none', label: 'לא נשלח', date: null};
}
const FULL_FILE_LABELS: Record<string, string> = {business_photo: 'תמונות העסק', financial_reports: 'דוחות כספיים', contracts: 'חוזים ומסמכים'};
function fullFileLabel(f: any): string {
  const b = documentBucket(f);
  if (b) return DOC_LABELS[b];
  return FULL_FILE_LABELS[f?.category] || clean(String(f?.file_name || '').replace(/\.[A-Za-z0-9]{1,5}$/, ''), 60) || 'מסמך';
}
type Input = {
  businessId: string; matches: any[]; buyers: any[]; permissions?: any[]; anonSends?: any[];
  fullSends?: any[]; files?: any[]; history?: any[]; notes?: any[];
};
export function buildOwnerMatches(i: Input) {
  const biz = i.businessId;
  const buyers = new Map((i.buyers || []).filter(l => l && l.type === 'buyer').map(l => [l.id, l]));
  const hidden = new Set((i.permissions || []).filter(p => p && p.visible === false).map(p => p.match_id));
  const files = new Map((i.files || []).filter(f => f && f.business_id === biz).map(f => [f.id, f]));
  const rows = (i.matches || [])
    .filter(m => m && m.business_id === biz && m.buyer_id && (m.counterparty_type ?? 'buyer') === 'buyer' && !hidden.has(m.id) && buyers.has(m.buyer_id))
    .map(m => {
      const l = buyers.get(m.buyer_id), agreement = agreementBadge(l), signed = agreement.key === 'signed';
      const [label, statusStep, closed] = STAGES[m.status] || ['בטיפול צוות BSD', 1];
      // Anonymous material actually delivered to this buyer for this business.
      const anon = (i.anonSends || []).filter(d => d.business_id === biz && d.buyer_id === m.buyer_id && d.delivery_status === 'sent')
        .map(d => ({label: d.distribution_type === 'extended' ? 'תקציר אנונימי מורחב' : 'תקציר אנונימי', date: iso(d.sent_at || d.created_at)}));
      // Full material: ONLY when the buyer has a signed agreement now.
      const full: {label: string; date: string | null}[] = [];
      let fullEvidence = false, fullDate: string | null = null;
      if (signed) {
        for (const s of i.fullSends || []) {
          const d = s.details || {};
          if (String(s.record_id) !== biz || d.status !== 'sent' || (d.recipient_type && d.recipient_type !== 'buyer') || (d.recipient_id || d.buyer_id) !== m.buyer_id) continue;
          fullEvidence = true;
          for (const id of Array.isArray(d.file_ids) ? d.file_ids : []) {
            const f = files.get(id); if (!f) continue;
            const lab = fullFileLabel(f);
            if (!full.some(x => x.label === lab)) full.push({label: lab, date: iso(s.occurred_at)});
          }
          fullDate = latest(fullDate, s.occurred_at);
        }
        const h = (i.history || []).filter(x => x.match_id === m.id && x.status === FULL_STATUS).map(x => x.changed_at);
        if (m.status === FULL_STATUS || FULL_LEGACY.includes(m.legacy_status) || h.length) {
          fullEvidence = true;
          fullDate = latest(fullDate, ...h, m.status === FULL_STATUS ? m.status_changed_at : null);
        }
      }
      const anonDedup = anon.filter((x, k) => anon.findIndex(y => y.label === x.label) === k);
      let materials;
      if (fullEvidence) materials = {level: 'full', label: 'חומרים מלאים', items: full.length ? full : [{label: 'חומרי העסק המלאים', date: fullDate}], date: fullDate};
      else if (anon.length || statusStep >= 2 || (closed && m.status !== 'הוקפא')) materials = {level: 'anonymous', label: 'מידע אנונימי בלבד', items: anonDedup, date: latest(...anon.map(a => a.date))};
      else materials = {level: 'none', label: 'טרם נמסרו חומרים', items: [], date: null};
      // A buyer without a signed agreement can never be shown past the anonymous stage.
      const step = closed ? 0 : signed ? Math.max(statusStep, 3) : Math.min(statusStep, 2);
      const stageLabel = !signed && statusStep > 2 ? 'קיבל מידע ראשוני על העסק' : label;
      const notes = (i.notes || []).filter(n => n.match_id === m.id && n.visible_to_client === true && !n.deleted_at)
        .map(n => ({text: clean(n.note || n.description, 300), date: iso(n.occurred_at || n.created_at)})).filter(n => n.text)
        .sort((a, b) => t(b.date) - t(a.date)).slice(0, 3);
      const updated = latest(m.created_at, m.status_changed_at, m.last_action_at, materials.date, ...notes.map(n => n.date));
      return {buyer: buyerName(l), agreement, stage: {label: stageLabel, step, closed: !!closed}, materials, updated_at: updated, notes};
    })
    .sort((a, b) => Number(a.stage.closed) - Number(b.stage.closed) || b.stage.step - a.stage.step || t(b.updated_at) - t(a.updated_at));
  const active = rows.filter(r => !r.stage.closed);
  return {
    rows: rows.map((r, k) => ({ref: k + 1, ...r})),
    summary: {total: rows.length, active: active.length, signed: rows.filter(r => r.agreement.key === 'signed').length, full: rows.filter(r => r.materials.level === 'full').length},
  };
}
