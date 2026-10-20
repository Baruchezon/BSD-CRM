import {documentBucket, DOC_LABELS} from './latest-files.ts';
// Seller portal "buyers" table (05.10.2026, approved layout by Baruch).
// Pure function: builds what the BUSINESS OWNER sees about the buyers matched to
// HIS business. Inputs are already filtered by the owner's business id in the
// handler; this function filters again and returns only presentation fields:
// anonymous buyer label, agreement badge, stage, materials, date, owner-visible notes.
// 20.10.2026 (staging, Baruch, final): the buyer's FULL NAME is shown by default in the owner's own portal.
// Matches with seller_portal_match_permissions.visible=false stay hidden. No phone/email/id is ever returned.
// Owner-facing text comes ONLY from match_activity_log.description / buyer_response (never `note`).
// (previous rule:) buyers are NEVER named to the owner. Each buyer is «קונה פוטנציאלי #N»,
// N stable by match creation order. `activity` lists every visible_to_client=true,
// non-deleted match_activity_log row: date, action description, buyer response.
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
// 20.10.2026: lead source of the buyer (matches.buyer_source) shown to the owner as «מקור הפנייה».
export const SOURCE_LABELS: Record<string, string> = {website: 'אתר', phone: 'טלפון', facebook: 'פייסבוק', existing_clients: 'לקוחות קיימים', other: 'אחר'};
const sourceLabel = (v: unknown) => SOURCE_LABELS[String(v ?? '')] || null;
export const anonBuyer = (n: number) => `קונה פוטנציאלי #${n}`;
export function buyerName(l: any): string {
  return clean(l?.full_name, 80) || clean([l?.first_name, l?.last_name].filter(Boolean).join(' '), 80) || 'קונה';
}
// «מה מסרנו» is stored by bsd_match_log_call as a second line «מה מסרנו: …» inside description.
export const SHARED_PREFIX = 'מה מסרנו:';
export function splitDescription(d: unknown): {topic: string; shared: string} {
  const raw = String(d ?? '');
  const k = raw.indexOf('\n' + SHARED_PREFIX);
  if (k < 0) return {topic: clean(raw, 1200), shared: ''};
  return {topic: clean(raw.slice(0, k), 1200), shared: clean(raw.slice(k + 1 + SHARED_PREFIX.length), 1200)};
}
export const CALL_TYPE = 'שיחה';
const dateOnly = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);
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
  const shown = (i.matches || [])
    .filter(m => m && m.business_id === biz && m.buyer_id && (m.counterparty_type ?? 'buyer') === 'buyer' && !hidden.has(m.id) && buyers.has(m.buyer_id))
    .sort((a, b) => t(a.created_at) - t(b.created_at) || String(a.id).localeCompare(String(b.id)));
  const num = new Map(shown.map((m, k) => [m.id, k + 1]));
  // Baruch 20.10.2026: the buyer's full name is shown by default, ONLY in this business's own portal
  // (inputs are already scoped to the owner's business). Hidden matches are excluded above.
  // Company only if the CRM has one for the buyer (leads.company); never invented.
  const nameOf = new Map(shown.map(m => {const l = buyers.get(m.buyer_id), co = clean(l?.company, 80); return [m.id, co ? `${buyerName(l)} · ${co}` : buyerName(l)];}));
  const visibleNotes = (i.notes || []).filter(n => n && num.has(n.match_id) && n.visible_to_client === true && !n.deleted_at);
  const srcOf = new Map(shown.map(m => [m.id, sourceLabel(m.buyer_source)]));
  const activity = visibleNotes
    .map(n => ({source: srcOf.get(n.match_id) ?? null, date: iso(n.occurred_at || n.created_at), buyer: nameOf.get(n.match_id)!, action: clean(n.description, 1200), response: clean(n.buyer_response, 600)}))
    .filter(a => a.action || a.response)
    .sort((a, b) => t(b.date) - t(a.date));
  const rows = shown
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
      const mine = visibleNotes.filter(n => n.match_id === m.id).sort((a, b) => t(b.occurred_at || b.created_at) - t(a.occurred_at || a.created_at));
      const notes = mine.map(n => ({text: clean(n.description, 300), date: iso(n.occurred_at || n.created_at)})).filter(n => n.text).slice(0, 3);
      // Buyer card: every owner-visible entry for THIS match, newest first. Nothing is inferred.
      const contacts = mine.map(n => {const d = splitDescription(n.description);
        return {date: iso(n.occurred_at || n.created_at), type: clean(n.action_type, 40) || 'עדכון', topic: d.topic, shared: d.shared, response: clean(n.buyer_response, 600), follow_up: dateOnly(n.follow_up_date)};})
        .filter(c => c.topic || c.shared || c.response);
      const last = contacts[0] || null;
      const followUp = contacts.find(c => c.follow_up)?.follow_up ?? null;
      const updated = latest(m.created_at, m.status_changed_at, m.last_action_at, materials.date, ...notes.map(n => n.date));
      return {ref: num.get(m.id)!, buyer_key: m.buyer_id, buyer: nameOf.get(m.id)!, named: true, status: m.status, last_contact: last, contacts, follow_up: followUp, source: srcOf.get(m.id) ?? null, agreement, stage: {label: stageLabel, step, closed: !!closed}, materials, updated_at: updated, notes};
    })
    .sort((a, b) => Number(a.stage.closed) - Number(b.stage.closed) || b.stage.step - a.stage.step || t(b.updated_at) - t(a.updated_at));
  // Metrics count DISTINCT buyers (Baruch 20.10.2026: every visible match = a buyer we spoke with).
  const distinct = (f: (r: any) => boolean) => new Set(rows.filter(f).map(r => r.buyer_key)).size;
  const summary = {
    total: distinct(() => true),
    contacted: distinct(() => true),
    active: distinct(r => !r.stage.closed),
    signed: distinct(r => r.agreement.key === 'signed'),
    full: distinct(r => r.materials.level === 'full'),
    info: distinct(r => r.materials.level !== 'none'),
    negotiation: distinct(r => r.status === 'במשא ומתן'),
    closed: distinct(r => r.stage.closed),
  };
  // buyer_key (internal id) is used only for counting; it is removed before leaving the server.
  return {
    rows: rows.map(({buyer_key: _k, status: _s, ...r}) => ({...r, negotiation: _s === 'במשא ומתן'})),
    activity,
    summary,
  };
}
