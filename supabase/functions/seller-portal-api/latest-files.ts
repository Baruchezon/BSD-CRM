import {pathAllowed} from './security.ts';
// Portal v2 (04.10.2026): documents appear automatically, without per-file
// approval. A seller sees, for his own business only, the newest active PDF of
// each of the four business-card "documents" types. The mapping below is the
// same one the CRM business card uses (js/saleFileModule2.js
// sfBucketKeyForFile), so the portal shows exactly what BSD sees in the card.
export const DOC_ORDER = ['anonymous_summary', 'full_summary', 'valuation', 'market_research'] as const;
export const DOC_LABELS: Record<string, string> = {
  anonymous_summary: 'תקציר אנונימי', full_summary: 'תקציר מלא', valuation: 'הערכת שווי', market_research: 'חקר שוק'
};
// Portal section and file-type label for advertising (marketing) reports (Baruch, 10.10.2026).
export const REPORTS_LABEL = 'דוחות פעילות שיווקית';
export function documentBucket(f: any): string | null {
  if (!f) return null;
  if (f.category === 'anon_presentation') return 'anonymous_summary';
  if (f.category === 'exec_summary') return f.document_type === 'anonymous_summary' ? 'anonymous_summary' : 'full_summary';
  if (f.category === 'economic_analysis' || f.category === 'valuation') return 'valuation';
  if (f.category === 'other' && f.document_type === 'market_research') return 'market_research';
  return null;
}
const isPdf = (f: any) => f.file_type === 'application/pdf' || /\.pdf$/i.test(f.file_name || '');
const live = (f: any, businessId: string) => !!f && f.business_id === businessId && f.status === 'active' && !f.deleted_at
  && isPdf(f) && pathAllowed(f.storage_path, businessId);
const newest = (a: any, b: any) => (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) || String(b.id).localeCompare(String(a.id));
const version = (f: any) => Number(f.version_number) || 1;
// Marketing reports: newest period first; inside one version group the highest version wins.
const reportOrder = (a: any, b: any) => String(b.portal_period_to || '').localeCompare(String(a.portal_period_to || ''))
  || String(b.portal_period_from || '').localeCompare(String(a.portal_period_from || '')) || version(b) - version(a) || newest(a, b);
// rows: business_sale_files rows of ONE business. Since 10.10.2026 ALL published advertising
// reports (portal_visible + portal_kind='advertising') are listed, newest period first, one entry
// per version_group_id (latest version wins; older versions stay in DB/storage, never deleted).
// Versions (Baruch, 13.10.2026): the version number of a document type is how many
// PDFs of that type were ever saved for the business (active or retired; the old
// «תקציר קצר» type is not counted). The client still sees only the newest one.
export function versionCount(rows: any[], businessId: string, bucket: string): number {
  return (rows || []).filter(f => f && f.business_id === businessId && f.portal_kind !== 'advertising'
    && f.document_type !== 'short_summary' && isPdf(f) && documentBucket(f) === bucket).length;
}
// DD.MM.YYYY in Israel time.
export function ilDate(v: any): string {
  const d = new Date(v); if (isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Jerusalem', day: '2-digit', month: '2-digit', year: 'numeric'}).formatToParts(d);
  const g = (t: string) => p.find(x => x.type === t)?.value || '';
  return `${g('day')}.${g('month')}.${g('year')}`;
}
// File name shown/downloaded in the portal always carries the date of the version.
export function datedName(name: string, created: any): string {
  const d = ilDate(created); const n = String(name || 'קובץ.pdf');
  if (!d || n.includes(d)) return n;
  const m = /\.pdf$/i.exec(n); return m ? `${n.slice(0, m.index)} – ${d}.pdf` : `${n} – ${d}`;
}
export function portalDocuments(rows: any[], businessId: string) {
  const sorted = (rows || []).filter(f => live(f, businessId)).sort(newest);
  const documents: any[] = [];
  for (const bucket of DOC_ORDER) {
    const f = sorted.find(x => x.portal_kind !== 'advertising' && documentBucket(x) === bucket);
    if (f) {
      const v = Math.max(1, versionCount(rows, businessId, bucket));
      documents.push({...f, bucket, doc_version: v, replaced_on: v > 1 ? ilDate(f.created_at) : null, display_name: datedName(f.file_name, f.created_at)});
    }
  }
  const seen = new Set<string>(); const reports: any[] = [];
  for (const r of sorted.filter(x => x.portal_kind === 'advertising' && x.portal_visible === true).sort(reportOrder)) {
    const group = String(r.version_group_id || r.id); if (seen.has(group)) continue;
    seen.add(group); reports.push({...r, bucket: 'advertising'});
  }
  return {documents, reports};
}
