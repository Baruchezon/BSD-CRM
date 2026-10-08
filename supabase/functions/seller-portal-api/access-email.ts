// Seller-portal login email (08.10.2026, Baruch's wording decision): link to the BSD
// website, press the «פורטל בעלי עסקים» button, username and the NEW password issued
// for this send. Signed «צוות BSD». Built only in memory for one send; never stored or logged.
export const ACCESS_EMAIL_SUBJECT = 'האזור האישי שלך ב-BSD: פרטי כניסה';
const SITE = 'www.bsd-bbi.co.il';
const SITE_URL = 'https://www.bsd-bbi.co.il/';
const LOGO_URL = 'https://baruchezon.github.io/BSD-CRM/portal/logo.png';
type Data = {name?: string | null; username: string; password: string; phone?: string | null};
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!));
export function accessEmailText(d: Data): string {
  const name = String(d.name || '').trim();
  return [
    `שלום${name ? ' ' + name : ''},`,
    '',
    'תודה על האמון ועל שיתוף הפעולה. פתחנו עבורך אזור אישי מאובטח ב-BSD, שבו אפשר לראות את המסמכים, העדכונים ודוחות הפרסום של העסק שלך, וגם איפה העסק מופץ.',
    '',
    'איך נכנסים:',
    `1. נכנסים לאתר BSD בכתובת ${SITE_URL}`,
    '2. לוחצים בראש העמוד על הכפתור הכחול «פורטל בעלי עסקים»',
    '3. מזינים את שם המשתמש והסיסמה:',
    `   שם משתמש: ${d.username}`,
    `   סיסמה: ${d.password}`,
    '',
    'הפרטים אישיים, נא לא להעביר אותם לאחרים. אפשר להחליף את הסיסמה בכל עת בתוך האזור האישי («החלפת סיסמה»).',
    `אם הכניסה לא מצליחה, נשמח לעזור${d.phone ? ' בטלפון ' + d.phone : ''}.`,
    '',
    'בברכה,',
    'צוות BSD',
    'BSD Business Brokers Israel · מחברים עסקים להזדמנויות',
  ].join('\n');
}
export function accessEmailHtml(d: Data): string {
  const name = String(d.name || '').trim(), phone = esc(d.phone || '');
  const step = (n: number, html: string) => `<tr><td style="width:30px;vertical-align:top;padding:6px 0"><span style="display:inline-block;width:24px;height:24px;line-height:24px;border-radius:50%;background:#0f2a44;color:#fff;text-align:center;font-weight:700;font-size:13px">${n}</span></td><td style="padding:6px 8px 6px 0;font-size:15px;line-height:1.6;color:#1f2d3d">${html}</td></tr>`;
  const cred = (k: string, v: string) => `<tr><td style="padding:6px 0;font-size:15px;color:#4a5a6a;white-space:nowrap">${k}</td><td style="padding:6px 12px 6px 0"><b dir="ltr" style="font-family:Consolas,Menlo,monospace;font-size:18px;letter-spacing:1px;color:#0f2a44">${esc(v)}</b></td></tr>`;
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(ACCESS_EMAIL_SUBJECT)}</title></head>
<body style="margin:0;padding:0;background:#f3f5f8">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f5f8;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" dir="rtl" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border-top:5px solid #c9a854;font-family:Arial,Helvetica,sans-serif;text-align:right">
<tr><td style="padding:22px 26px 6px"><img src="${LOGO_URL}" alt="BSD Business Brokers Israel" width="110" style="display:block;border:0;max-width:110px;height:auto"></td></tr>
<tr><td style="padding:6px 26px 0"><h1 style="margin:0 0 6px;font-size:21px;color:#0f2a44">${name ? `שלום ${esc(name)},` : 'שלום,'}</h1>
<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:#1f2d3d">תודה על האמון ועל שיתוף הפעולה. פתחנו עבורך אזור אישי מאובטח ב-BSD, שבו אפשר לראות את המסמכים, העדכונים ודוחות הפרסום של העסק שלך, וגם איפה העסק מופץ.</p></td></tr>
<tr><td style="padding:0 26px"><div style="background:#f7f9fb;border:1px solid #e3e8ee;border-radius:12px;padding:14px 16px">
<p style="margin:0 0 6px;font-weight:700;color:#0f2a44;font-size:15px">איך נכנסים</p>
<table role="presentation" cellspacing="0" cellpadding="0" width="100%">${step(1, `נכנסים לאתר BSD בכתובת <a href="${SITE_URL}" dir="ltr" style="color:#0f5ea8;font-weight:700;white-space:nowrap">${SITE}</a>`)}${step(2, 'לוחצים בראש העמוד על הכפתור הכחול «פורטל בעלי עסקים»')}${step(3, 'מזינים את שם המשתמש והסיסמה:')}</table>
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:6px 30px 2px 0;background:#ffffff;border:1px dashed #c9a854;border-radius:10px;padding:6px 14px">${cred('שם משתמש:', d.username)}${cred('סיסמה:', d.password)}</table>
</div></td></tr>
<tr><td align="center" style="padding:18px 26px 6px"><a href="${SITE_URL}" style="display:inline-block;background:#0f2a44;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;padding:12px 28px;border-radius:10px">לאתר BSD</a></td></tr>
<tr><td style="padding:10px 26px 0"><p style="margin:0;font-size:14px;line-height:1.7;color:#4a5a6a">הפרטים אישיים, נא לא להעביר אותם לאחרים. אפשר להחליף את הסיסמה בכל עת בתוך האזור האישי («החלפת סיסמה»).</p>
<p style="margin:10px 0 0;font-size:14px;line-height:1.7;color:#4a5a6a">אם הכניסה לא מצליחה, נשמח לעזור${phone ? ` בטלפון <a href="tel:${phone}" dir="ltr" style="color:#0f5ea8;white-space:nowrap">${phone}</a>` : ''}.</p></td></tr>
<tr><td style="padding:18px 26px 22px"><p style="margin:0;font-size:15px;color:#1f2d3d">בברכה,<br><b>צוות BSD</b><br><span style="color:#8a6d1f">BSD Business Brokers Israel · מחברים עסקים להזדמנויות</span></p></td></tr>
<tr><td style="background:#0f2a44;padding:12px 26px;text-align:center"><span style="color:#d9c48a;font-size:12px">ליווי אישי. דיסקרטיות. שקיפות. · <a href="${SITE_URL}" style="color:#ffffff">${SITE}</a></span></td></tr>
</table></td></tr></table></body></html>`;
}
// Sender must be an address on the BSD domain (never Resend's shared test sender).
export function bsdSender(from: unknown): string | null {
  const m = /<([^<>\s]+)>\s*$/.exec(String(from ?? '').trim());
  const addr = (m ? m[1] : String(from ?? '').trim()).toLowerCase();
  return /^[a-z0-9._%+-]+@bsd-bbi\.co\.il$/.test(addr) ? addr : null;
}
// Sender of «שליחה במייל» (Baruch, 08.10.2026): baruch@bsd-bbi.co.il by default, a
// domain verified in Resend on 08.10.2026. Deliberately NOT read from RESEND_FROM_EMAIL
// (shared by other functions). SELLER_PORTAL_MAIL_FROM may override it, but only with
// an @bsd-bbi.co.il address; anything else is ignored and the default is used.
export const PORTAL_MAIL_FROM_DEFAULT = 'baruch@bsd-bbi.co.il';
export const PORTAL_MAIL_NAME = 'צוות BSD';
export function portalMailFrom(override: unknown): string {
  return bsdSender(override) ?? PORTAL_MAIL_FROM_DEFAULT;
}
export const validEmail = (v: unknown) => /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[A-Za-z]{2,}$/.test(String(v ?? '').trim());
