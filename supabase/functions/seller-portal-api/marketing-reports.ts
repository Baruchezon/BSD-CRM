// Weekly marketing reports (Baruch's directive 10.10.2026 22:12; spec eldad-portal-reports-spec.md §2 G2/G3).
// Pure helpers only (no database access) so they can be unit-tested directly.
export const MR_CATEGORY = 'דוחות פעילות שיווקית';
export const MR_DIR = 'seller-portal-ad-reports';
export const MR_MAX_BYTES = 16 * 1024 * 1024;
// Raw JSON body ceiling for publish_marketing_report only: base64 of 16 MB (~22.4 MB) plus the small fields.
export const MR_MAX_RAW = 22_500_000;
export const MR_REPORT_TYPES = ['weekly'] as const;
const DAY = 86400000;
const isoDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
// Period rule: Friday .. the following Thursday (period_from + 6 days).
export function validPeriod(from: unknown, to: unknown): boolean {
  if (!isoDate(from) || !isoDate(to)) return false;
  const f = Date.parse(from + 'T00:00:00Z'), t = Date.parse(to + 'T00:00:00Z');
  return new Date(f).getUTCDay() === 5 && t - f === 6 * DAY;
}
export function decodeBase64(s: unknown): Uint8Array | null {
  if (typeof s !== 'string' || !s.length || s.length > MR_MAX_RAW || !/^[A-Za-z0-9+/]+={0,2}$/.test(s) || s.length % 4) return null;
  try { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; } catch { return null; }
}
export async function sha256Hex(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), b => b.toString(16).padStart(2, '0')).join('');
}
export const isPdfBytes = (bytes: Uint8Array) => bytes.length > 5 && new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-';
const BN = /^BSD-B-\d{4}-\d{4}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Shape check of the publish request. Business rules (checks 1-6) run in the handler, in spec order.
export function publishShape(b: any): {ok: true; v: any} | {ok: false} {
  if (!b || !UUID.test(String(b.business_id)) || !BN.test(String(b.business_number ?? '')) || !MR_REPORT_TYPES.includes(b.report_type)
    || typeof b.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(b.sha256) || typeof b.file_name !== 'string' || typeof b.pdf_base64 !== 'string'
    || (b.posts_in_period !== undefined && !(Number.isInteger(b.posts_in_period) && b.posts_in_period >= 0 && b.posts_in_period <= 100000))) return {ok: false};
  const name = b.file_name.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_').trim().slice(0, 200);
  if (!name || !/\.pdf$/i.test(name)) return {ok: false};
  return {ok: true, v: {business_id: b.business_id.toLowerCase(), business_number: b.business_number, period_from: b.period_from, period_to: b.period_to,
    report_type: b.report_type, sha256: b.sha256.toLowerCase(), file_name: name, pdf_base64: b.pdf_base64, posts_in_period: b.posts_in_period ?? null}};
}
