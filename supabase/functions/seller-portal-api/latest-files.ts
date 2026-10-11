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
export function portalDocuments(rows: any[], businessId: string) {
  const sorted = (rows || []).filter(f => live(f, businessId)).sort(newest);
  const documents: any[] = [];
  for (const bucket of DOC_ORDER) {
    const f = sorted.find(x => x.portal_kind !== 'advertising' && documentBucket(x) === bucket);
    if (f) documents.push({...f, bucket});
  }
  const seen = new Set<string>(); const reports: any[] = [];
  for (const r of sorted.filter(x => x.portal_kind === 'advertising' && x.portal_visible === true).sort(reportOrder)) {
    const group = String(r.version_group_id || r.id); if (seen.has(group)) continue;
    seen.add(group); reports.push({...r, bucket: 'advertising'});
  }
  return {documents, reports};
}
