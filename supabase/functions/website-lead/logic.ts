// Pure helpers for website-lead (unit-tested in logic.test.ts, no network or DB).
// 15.11.2026 lead audit (approved by Baruch 15.11 08:28 via Roman).

export type InquiryKind =
  | 'seller' | 'buyer' | 'mixed' | 'partner' | 'training' | 'question' | 'other' | 'unknown';

export function clean(value: unknown, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function oneLine(value: unknown, max = 300) {
  return clean(value, max * 2).replace(/[\r\n\u2028\u2029]+/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

export function phone9(value: string) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 9 ? digits.slice(-9) : '';
}

export function websiteLeadSide(purposes: string[], isTraining: boolean): 'seller' | 'buyer' | null {
  if (isTraining) return null;
  const joined = purposes.join(' ').toLowerCase();
  const sell = /למכור|sell/.test(joined);
  const buy = /לקנות|buy/.test(joined);
  if (sell && !buy) return 'seller';
  if (buy && !sell) return 'buyer';
  return null;
}

// Classification from the explicit form purposes only (never the free-text message).
export function inquiryKind(purposes: string[]): InquiryKind {
  const joined = purposes.join(' ').toLowerCase();
  if (/קורס|הכשר|training|course/.test(joined)) return 'training';
  const sell = /למכור|sell/.test(joined);
  const buy = /לקנות|buy/.test(joined);
  if (sell && buy) return 'mixed';
  if (sell) return 'seller';
  if (buy) return 'buyer';
  if (/שותף|השקע|partner|invest/.test(joined)) return 'partner';
  if (/ייעוץ|יעוץ|שאלה|consult|question|advice/.test(joined)) return 'question';
  if (/אחר|other/.test(joined)) return 'other';
  return 'unknown';
}

export const KIND_LABEL: Record<InquiryKind, string> = {
  seller: 'מוכר', buyer: 'קונה', mixed: 'מוכר/קונה', partner: 'שותפות/השקעה',
  training: 'קורס', question: 'שאלה', other: 'אחר', unknown: 'לא ידוע',
};

// leads.type is a NOT NULL enum (buyer/seller/partner). Leads without a clear side keep
// type='buyer' only as the storage placeholder the CRM already documents (leads-hub
// leadSide()); lead_side stays null and website_purpose_guess says what it really is.
export function leadTypeFor(kind: InquiryKind): 'seller' | 'buyer' | 'partner' {
  if (kind === 'seller' || kind === 'mixed') return 'seller';
  if (kind === 'partner') return 'partner';
  return 'buyer';
}

export function purposeGuess(kind: InquiryKind): string {
  return {
    training: 'מתעניין בהכשרת מתווכי עסקים',
    seller: 'מעוניין למכור עסק',
    mixed: 'מוכר וגם קונה, דורש בדיקה',
    partner: 'מעוניין בשותפות או השקעה',
    buyer: 'מחפש לקנות עסק',
    question: 'ייעוץ או שאלה עסקית',
    other: 'אחר, דורש בדיקה',
    unknown: 'דורש בדיקה',
  }[kind];
}

const TEST_EMAIL = /@(example\.(com|org|net)|test\.local|resend\.dev)$/i;
export function isTestSubmission(body: Record<string, unknown>, name: string, email: string, message: string) {
  if (body.is_test === true || body.is_test === 'true' || body.test === true) return true;
  if (TEST_EMAIL.test(email)) return true;
  return /(^|[^a-z_])is_test([^a-z_]|$)/i.test(`${name} ${message}`);
}

export function normalizeBusinessNumber(value: string): string {
  const v = oneLine(value, 40).toUpperCase();
  const full = v.match(/BSD-B-\d{4}-\d{3,5}/);
  if (full) return full[0];
  return '';
}

// The live form (lead-form.js) folds context into the message as separate lines:
// «מספר עסק: BSD-B-…», «עסק: …», «מקור הגעה: a / b · הפניה: host». Pull them back out.
export function parseMessageContext(message: string) {
  const out = { businessNumber: '', listingTitle: '', sourceLine: '', referrer: '', original: '' };
  const keep: string[] = [];
  for (const raw of String(message || '').split(/\r?\n/)) {
    const line = raw.trim();
    let m;
    if ((m = line.match(/^מספר עסק:\s*(.+)$/))) { out.businessNumber = normalizeBusinessNumber(m[1]) || oneLine(m[1], 40); continue; }
    if ((m = line.match(/^עסק:\s*(.+)$/))) { out.listingTitle = oneLine(m[1], 200); continue; }
    if (/^(מקור הגעה:|הפניה:)/.test(line)) {
      const parts = line.split('·').map(s => s.trim());
      for (const p of parts) {
        if (p.startsWith('מקור הגעה:')) out.sourceLine = oneLine(p.replace('מקור הגעה:', ''), 200);
        if (p.startsWith('הפניה:')) out.referrer = oneLine(p.replace('הפניה:', ''), 200);
      }
      continue;
    }
    keep.push(raw);
  }
  out.original = keep.join('\n').trim();
  return out;
}

export function firstName(fullName: string) {
  return fullName.split(/\s+/).filter(Boolean)[0] || fullName;
}

export function alertSubject(o: { kind: InquiryKind; businessNumber?: string; fullName: string; isTest?: boolean; repeat?: boolean }) {
  const parts = [o.repeat ? 'פנייה חוזרת' : 'ליד חדש', KIND_LABEL[o.kind]];
  if (o.businessNumber) parts.push(o.businessNumber);
  parts.push(oneLine(firstName(o.fullName), 40) || 'ללא שם');
  return `${o.isTest ? '[בדיקה] ' : ''}${parts.join(' · ')}`;
}

export function escapeHtml(value: string) {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
  return String(value ?? '').replace(/[&<>'"]/g, c => entities[c] ?? c);
}

export function safeHttpUrl(value: string): string {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : '';
  } catch { return ''; }
}

// Resolve a business page from sitemap XML: loc ending with "-bsd-b-2607-1001/".
export function businessUrlFromSitemap(xml: string, businessNumber: string): string {
  if (!businessNumber) return '';
  const needle = `-${businessNumber.toLowerCase()}/`;
  for (const m of String(xml || '').matchAll(/<loc>([^<]+)<\/loc>/g)) {
    if (m[1].toLowerCase().endsWith(needle)) return m[1].trim();
  }
  return '';
}

export type AlertValues = {
  fullName: string; phone: string; email: string; city: string; purposes: string;
  kind: InquiryKind; message: string; preferredDate: string;
  businessNumber: string; listingTitle: string; businessUrl: string; businessFound: boolean;
  source: string; page: string; crmUrl: string; repeatOf?: string; isTest: boolean;
  // Email body only. The contact form has no budget field; shown when a caller sends one.
  budget?: string;
  registeredAt?: string;
};

// Same clock as the compact new-subscriber alert (business-alert-signup signupDateLabel).
export function israelDateTime(value?: string) {
  const parsed = value ? new Date(value) : new Date();
  const date = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}`;
}

export function alertBudget(body: Record<string, unknown>): string {
  const raw = body.budget;
  if (typeof raw === 'number' && Number.isFinite(raw)) return `${new Intl.NumberFormat('he-IL').format(raw)} ₪`;
  return oneLine(raw, 120);
}

function splitPersonName(fullName: string) {
  const parts = String(fullName || '').split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
}

// What they are looking for, then the request text. Technical context lines are
// already removed by parseMessageContext before this runs.
function interestText(v: AlertValues) {
  return [v.purposes, v.message].map(s => String(s || '').trim()).filter(Boolean).join('\n');
}

// Baruch, 13.11 content rule (same list as the compact subscriber alert): first name,
// last name, phone, interests, registration time in Israel, and budget only when given.
// No CRM links, source URLs, the lead's email, ids, or other technical fields.
export function alertFields(v: AlertValues): [string, string][] {
  const { firstName, lastName } = splitPersonName(v.fullName);
  return ([
    ['שם פרטי', firstName],
    ['שם משפחה', lastName],
    ['טלפון', v.phone],
    ['תחומי עניין', interestText(v)],
    ['תאריך הרשמה', israelDateTime(v.registeredAt)],
    ['תקציב', v.budget || ''],
  ] as [string, string][]).filter(([, value]) => String(value).trim() !== '');
}

const LTR_LABELS = new Set(['טלפון', 'תאריך הרשמה']);

export function alertHtml(v: AlertValues) {
  const lines = alertFields(v).map(([label, value]) => {
    const inner = escapeHtml(value).replace(/\n/g, '<br>');
    const shown = LTR_LABELS.has(label) ? `<span dir="ltr">${inner}</span>` : inner;
    return `<p style="margin:0 0 10px;font-size:16px;line-height:1.5"><b>${escapeHtml(label)}:</b> ${shown}</p>`;
  }).join('');
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ליד חדש</title></head><body style="margin:0;padding:0;background:#ffffff"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl" style="border-collapse:collapse;width:100%;background:#ffffff"><tr><td align="center" style="padding:16px"><div dir="rtl" lang="he" style="max-width:600px;width:100%;margin:0 auto;text-align:right;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#102844;overflow-wrap:anywhere">${lines}</div></td></tr></table></body></html>`;
}

export function alertText(v: AlertValues) {
  return alertFields(v).map(([label, value]) => `${label}: ${value}`).join('\n');
}
