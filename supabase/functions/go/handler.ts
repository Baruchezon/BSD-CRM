// go - BSD short links: GET /functions/v1/go/<code>  ->  302 to the stored target (signing page with rid=, portal
// activation link, VIP, training form). NOT deployed. Deploy with verify_jwt = false (opened from WhatsApp buttons).
// The code is 10 random characters (57-letter alphabet, ~58 bits); expired or revoked codes get a Hebrew 410 page.
import { SHORT_CODE_RE } from '../_shared/whatsapp.ts';

export interface GoDeps { resolve(code: string): Promise<{ target_url: string } | null>; fallbackUrl: string; allowedHosts: string[] }

export function codeFromUrl(u: URL): string {
  const fromPath = u.pathname.split('/').filter(Boolean).pop() || '';
  const c = u.searchParams.get('c') || (fromPath !== 'go' ? fromPath : '');
  return SHORT_CODE_RE.test(c) ? c : '';
}

const page = (title: string, text: string, status: number) => new Response(
  `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>` +
  `<body style="font-family:Arial,sans-serif;max-width:520px;margin:60px auto;padding:0 20px;color:#0e1b34;text-align:center"><h1 style="font-size:1.3rem">${title}</h1><p>${text}</p>` +
  `<p><a href="https://www.bsd-bbi.co.il/" style="color:#1f5fbf">לאתר BSD</a></p></body></html>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' } });

export function createGoHandler(deps: GoDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
    const code = codeFromUrl(new URL(req.url));
    if (!code) return page('הקישור לא תקין', 'נא לבדוק שהקישור הועתק במלואו, או לפנות ל-BSD.', 404);
    // HEAD (link previews / scanners) does not count a click and does not reveal the target.
    if (req.method === 'HEAD') return new Response(null, { status: 200, headers: { 'Cache-Control': 'no-store' } });
    const row = await deps.resolve(code).catch(() => null);
    if (!row) return page('הקישור כבר לא בתוקף', 'אפשר לבקש קישור חדש מצוות BSD בתשובה להודעה בוואטסאפ.', 410);
    let target: URL;
    try { target = new URL(row.target_url); } catch { return page('הקישור לא תקין', 'נא לפנות ל-BSD.', 404); }
    if (target.protocol !== 'https:' || !deps.allowedHosts.includes(target.hostname)) return page('הקישור לא תקין', 'נא לפנות ל-BSD.', 404);
    return new Response(null, { status: 302, headers: { Location: target.toString(), 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  };
}
