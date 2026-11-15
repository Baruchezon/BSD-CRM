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
};

export function alertHtml(v: AlertValues) {
  const row = (label: string, valueHtml: string) =>
    `<tr><td style="padding:6px 10px;color:#6b7280;white-space:nowrap;vertical-align:top">${escapeHtml(label)}</td><td style="padding:6px 10px;color:#111827">${valueHtml}</td></tr>`;
  const text = (s: string) => escapeHtml(s || 'לא צוין');
  const link = (href: string, label: string) => href ? `<a href="${escapeHtml(href)}" style="color:#0f5ea8">${escapeHtml(label)}</a>` : text('');
  const telDigits = v.phone.replace(/[^\d+]/g, '');
  const rows = [
    row('שם מלא', text(v.fullName)),
    row('טלפון', telDigits ? `<a href="tel:${escapeHtml(telDigits)}" style="color:#0f5ea8" dir="ltr">${escapeHtml(v.phone)}</a>` : text('')),
    row('אימייל', v.email ? `<a href="mailto:${escapeHtml(v.email)}" style="color:#0f5ea8" dir="ltr">${escapeHtml(v.email)}</a>` : text('')),
    row('עיר', text(v.city)),
    row('סוג פנייה', `<b>${escapeHtml(KIND_LABEL[v.kind])}</b> <span style="color:#6b7280">(${text(v.purposes)})</span>`),
    row('מספר עסק', v.businessNumber ? `<span dir="ltr">${escapeHtml(v.businessNumber)}</span>${v.businessFound ? '' : ' <span style="color:#b45309">(לא נמצא ב-CRM)</span>'}` : text('')),
    row('שם העסק', text(v.listingTitle)),
    row('דף העסק באתר', v.businessUrl ? link(v.businessUrl, 'פתיחת דף העסק') : text('')),
    row('מקור', text(v.source)),
    row('עמוד', v.page ? `<span dir="ltr">${escapeHtml(v.page)}</span>` : text('')),
    row('הודעה', escapeHtml(v.message || 'לא נכתבה').replace(/\n/g, '<br>')),
    row('מועד מועדף לשיחה', text(v.preferredDate)),
    row('כרטיס ב-CRM', link(v.crmUrl, v.repeatOf ? 'פתיחת הכרטיס הקיים' : 'פתיחת הליד')),
  ].join('');
  const repeat = v.repeatOf
    ? `<p style="background:#fff7dc;border:1px solid #ead08b;padding:8px 10px;border-radius:6px">הטלפון כבר קיים ב-CRM (${escapeHtml(v.repeatOf)}). הפנייה צורפה לכרטיס הקיים ולא נפתח ליד כפול.</p>`
    : '';
  const test = v.isTest ? '<p style="color:#b91c1c"><b>בדיקה (is_test)</b>: לא נשלח לברוך.</p>' : '';
  return `<div dir="rtl" lang="he" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${test}<h2 style="margin:0 0 8px">${escapeHtml(alertSubject({ kind: v.kind, businessNumber: v.businessNumber, fullName: v.fullName, repeat: !!v.repeatOf }))}</h2>${repeat}<p style="margin:0 0 10px;color:#374151">«השב» למייל הזה יגיע ישירות לפונה${v.email ? '' : ' (לא נמסר מייל)'}.</p><table style="border-collapse:collapse;border:1px solid #e5e7eb">${rows}</table><div dir="rtl" style="margin-top:24px;padding-top:12px;border-top:1px solid #e3d9bf;font-size:13px;line-height:1.6;color:#1f2d3d"><b>BSD - עסקים למכירה</b><br><span style="color:#8a6d1f">משביחים עסקים, מחברים הזדמנויות, מובילים עסקאות</span><br><span dir="ltr"><a href="mailto:info@bsd-bbi.co.il" style="color:#0f5ea8;text-decoration:none">info@bsd-bbi.co.il</a> | <a href="https://www.bsd-bbi.co.il/" style="color:#0f5ea8;text-decoration:none">www.bsd-bbi.co.il</a></span></div></div>`;
}

export function alertText(v: AlertValues) {
  return [
    alertSubject({ kind: v.kind, businessNumber: v.businessNumber, fullName: v.fullName, repeat: !!v.repeatOf, isTest: v.isTest }),
    v.repeatOf ? `הטלפון כבר קיים ב-CRM (${v.repeatOf}). הפנייה צורפה לכרטיס הקיים.` : '',
    `שם מלא: ${v.fullName}`, `טלפון: ${v.phone}`, `אימייל: ${v.email || 'לא צוין'}`, `עיר: ${v.city || 'לא צוין'}`,
    `סוג פנייה: ${KIND_LABEL[v.kind]} (${v.purposes || 'לא נבחרה'})`,
    `מספר עסק: ${v.businessNumber || 'לא צוין'}`, `שם העסק: ${v.listingTitle || 'לא צוין'}`,
    `דף העסק באתר: ${v.businessUrl || 'לא צוין'}`, `מקור: ${v.source || 'לא צוין'}`, `עמוד: ${v.page || 'לא צוין'}`,
    `הודעה: ${v.message || 'לא נכתבה'}`, `מועד מועדף לשיחה: ${v.preferredDate || 'לא צוין'}`, `כרטיס ב-CRM: ${v.crmUrl}`,
  ].filter(Boolean).join('\n');
}
