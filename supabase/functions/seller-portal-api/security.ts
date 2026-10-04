const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
// PBKDF2-SHA256 cost. Stored hashes carry their own iteration count so the cost
// can be tuned later without invalidating existing passwords.
export const PBKDF2_ITERATIONS = 600000;
const ACCEPTED_ITERATIONS = new Set([310000, 600000]);
export function randomText(length: number, chars = alphabet): string {
  let out = '';
  const ceiling = 256 - 256 % chars.length;
  while (out.length < length) for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
    if (b < ceiling) out += chars[b % chars.length];
    if (out.length === length) break;
  }
  return out;
}
// One-time activation secret (~250 bits). Only its SHA-256 is stored.
export function activationToken(): string { return randomText(43); }
export function validActivationToken(t: unknown): t is string {
  return typeof t === 'string' && /^[A-HJ-NP-Za-km-np-z2-9]{43}$/.test(t);
}
// Marker for an account that has no usable password until activation.
export const PENDING_ACTIVATION = '!pending-activation';
export function strongPassword(p: string): boolean {
  return p.length >= 10 && p.length <= 128 && /[A-Za-z\u0590-\u05FF]/.test(p) && /[0-9]/.test(p);
}
function encode(b: Uint8Array): string { return btoa(String.fromCharCode(...b)); }
function decode(s: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
export async function digest(s: string): Promise<string> {
  return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
}
export async function hashPassword(p: string, salt = crypto.getRandomValues(new Uint8Array(16)), iterations = PBKDF2_ITERATIONS): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(p), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations},key,256);
  return `${iterations}.${encode(salt)}.${encode(new Uint8Array(bits))}`;
}
export function usableHash(stored: unknown): stored is string {
  if (typeof stored !== 'string') return false;
  const [n, s, h] = stored.split('.');
  return ACCEPTED_ITERATIONS.has(Number(n)) && !!s && !!h;
}
export async function verifyPassword(p: string, stored: string): Promise<boolean> {
  try {
    if (!usableHash(stored)) return false;
    const [n,s,h] = stored.split('.');
    const actual = (await hashPassword(p, decode(s), Number(n))).split('.')[2];
    if (actual.length !== h.length) return false;
    let diff=0; for(let i=0;i<h.length;i++) diff |= actual.charCodeAt(i)^h.charCodeAt(i);
    return diff===0;
  } catch { return false; }
}
export function sessionAllowed(session: any, account: any, business: any, now = Date.now()): boolean {
  return !!session && !!account && !!business && !session.revoked_at && account.status==='active'
    && !business.is_archived && business.agreement_status==='יש הסכם חתום'
    && Date.parse(session.expires_at)>now && now-Date.parse(session.last_activity_at)<30*60_000;
}
export function fileAllowed(f: any, businessId: string): boolean {
  return !!f && f.business_id===businessId && f.status==='active' && !f.deleted_at
    && f.portal_visible===true && (f.file_type==='application/pdf'||/\.pdf$/i.test(f.file_name||''))
    && typeof f.storage_path==='string' && f.storage_path.startsWith(businessId+'/')
    && !f.storage_path.split('/').some((s: string)=>s==='..'||s==='.') && !f.storage_path.includes('\\');
}
// Portal v2 (04.10.2026): one-click account opening. The CRM receives this
// random password exactly once (to build the WhatsApp text); only its PBKDF2
// hash is stored. 10 characters from a 55-symbol alphabet without look-alike
// characters (~58 bits), always with letters and at least two digits.
export function generatePassword(length = 10): string {
  for (;;) {
    const p = randomText(length);
    if ((p.match(/[0-9]/g) || []).length >= 2 && (p.match(/[A-Za-z]/g) || []).length >= 4 && strongPassword(p)) return p;
  }
}
// A storage object belongs to the business only under "{businessId}/", with
// no empty, "." or ".." segments and no backslashes.
export function pathAllowed(path: unknown, businessId: unknown): boolean {
  return typeof path === 'string' && typeof businessId === 'string' && businessId.length > 0
    && path.startsWith(businessId + '/') && !path.includes('\\')
    && !path.split('/').some((s: string) => s === '' || s === '.' || s === '..');
}
// Extra files uploaded by BSD to a business portal. Allow-list by extension;
// the stored and served Content-Type always comes from this table, never from
// the uploader. HTML, SVG, XML and scripts are deliberately absent.
const EXTRA_TYPES: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv', mp4: 'video/mp4', mov: 'video/quicktime', zip: 'application/zip'
};
export const EXTRA_MAX_BYTES = 20 * 1024 * 1024;
export function extraFileType(name: unknown): {ext: string; mime: string} | null {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(name ?? '').trim());
  const ext = m ? m[1].toLowerCase() : '';
  return ext && Object.hasOwn(EXTRA_TYPES, ext) ? {ext, mime: EXTRA_TYPES[ext]} : null;
}
export function safeFileName(name: unknown): string {
  return String(name ?? '').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_').trim().slice(0, 200) || 'file';
}
// Client address for rate limiting. Never trust the left-most X-Forwarded-For
// element (caller controlled). Prefer the header configured for the gateway,
// otherwise the right-most X-Forwarded-For element appended by the proxy.
export function clientIp(req: Request, trustedHeader = 'cf-connecting-ip'): string {
  const direct = trustedHeader ? req.headers.get(trustedHeader)?.trim() : '';
  if (direct && /^[0-9a-fA-F:.]{3,45}$/.test(direct)) return direct;
  const chain = (req.headers.get('x-forwarded-for') || '').split(',').map(s => s.trim()).filter(Boolean);
  const last = chain[chain.length - 1];
  return last && /^[0-9a-fA-F:.]{3,45}$/.test(last) ? last : 'unknown';
}
