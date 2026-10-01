const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
export function randomText(length: number, chars = alphabet): string {
  let out = '';
  const ceiling = 256 - 256 % chars.length;
  while (out.length < length) for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
    if (b < ceiling) out += chars[b % chars.length];
    if (out.length === length) break;
  }
  return out;
}
export function temporaryPassword(): string {
  let p = randomText(5);
  while (!/[A-Za-z]/.test(p) || !/[2-9]/.test(p)) p = randomText(5);
  return p;
}
function encode(b: Uint8Array): string { return btoa(String.fromCharCode(...b)); }
function decode(s: string): Uint8Array<ArrayBuffer> { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
export async function digest(s: string): Promise<string> {
  return encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
}
export async function hashPassword(p: string, salt = crypto.getRandomValues(new Uint8Array(16))): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(p), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:600000},key,256);
  return `600000.${encode(salt)}.${encode(new Uint8Array(bits))}`;
}
export async function verifyPassword(p: string, stored: string): Promise<boolean> {
  try {
    const [n,s,h] = stored.split('.');
    if (n !== '600000') return false;
    const actual = (await hashPassword(p, decode(s))).split('.')[2];
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
