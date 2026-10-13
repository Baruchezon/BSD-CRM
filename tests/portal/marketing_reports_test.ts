import {portalDocuments, REPORTS_LABEL} from '../../supabase/functions/seller-portal-api/latest-files.ts';
import {validPeriod, decodeBase64, sha256Hex, isPdfBytes, publishShape, MR_MAX_BYTES} from '../../supabase/functions/seller-portal-api/marketing-reports.ts';
const assert = (v: unknown, m = 'assertion failed') => { if (!v) throw Error(m); };
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const rep = (id: string, biz: string, from: string, to: string, extra: any = {}) => ({id, business_id: biz, category: 'דוחות פעילות שיווקית', document_type: 'activity_report',
  status: 'active', deleted_at: null, portal_visible: true, portal_kind: 'advertising', file_type: 'application/pdf', file_name: `r-${id}.pdf`,
  storage_path: `${biz}/seller-portal-ad-reports/${id}.pdf`, created_at: '2026-10-15T17:00:00Z', portal_period_from: from, portal_period_to: to, version_number: 1, version_group_id: 'g-' + id, ...extra});
Deno.test('G1: every published report, newest period first, label «דוחות פעילות שיווקית»', () => {
  const rows = [rep('w40', A, '2026-10-02', '2026-10-08', {created_at: '2026-10-20T00:00:00Z'}), rep('w42', A, '2026-10-16', '2026-10-22'), rep('w41', A, '2026-10-09', '2026-10-15')];
  const r = portalDocuments(rows, A).reports.map(x => x.id);
  assert(JSON.stringify(r) === '["w42","w41","w40"]', 'order by period, not upload time ' + r);
  assert(REPORTS_LABEL === 'דוחות פעילות שיווקית');
});
Deno.test('G1: one entry per version group, highest version wins, old version kept out of the list only', () => {
  const v1 = rep('v1', A, '2026-10-09', '2026-10-15', {version_group_id: 'g', version_number: 1, created_at: '2026-10-15T18:00:00Z'});
  const v2 = rep('v2', A, '2026-10-09', '2026-10-15', {version_group_id: 'g', version_number: 2, created_at: '2026-10-15T17:00:00Z'});
  const r = portalDocuments([v1, v2], A).reports;
  assert(r.length === 1 && r[0].id === 'v2', 'v2 wins even if v1 has a later created_at');
});
Deno.test('G1: other business, hidden, deleted, non-PDF and foreign-path rows never listed', () => {
  const rows = [rep('ok', A, '2026-10-09', '2026-10-15'), rep('b', B, '2026-10-16', '2026-10-22'), rep('hidden', A, '2026-10-16', '2026-10-22', {portal_visible: false}),
    rep('del', A, '2026-10-16', '2026-10-22', {status: 'deleted', deleted_at: '2026-10-16'}), rep('jpg', A, '2026-10-16', '2026-10-22', {file_type: 'image/jpeg', file_name: 'x.jpg'}),
    rep('path', A, '2026-10-16', '2026-10-22', {storage_path: `${B}/seller-portal-ad-reports/x.pdf`})];
  const r = portalDocuments(rows, A).reports.map(x => x.id);
  assert(JSON.stringify(r) === '["ok"]', 'only own live PDF ' + r);
  assert(portalDocuments(rows, A).documents.length === 0, 'reports never leak into documents');
});
Deno.test('G1: legacy reports without version group still listed each', () => {
  const r = portalDocuments([rep('x', A, '2026-09-01', '2026-09-03', {version_group_id: null}), rep('y', A, '2026-09-04', '2026-09-06', {version_group_id: null})], A).reports;
  assert(r.length === 2 && r[0].id === 'y');
});
Deno.test('G2: period must be Friday..Thursday', () => {
  assert(validPeriod('2026-10-09', '2026-10-15'), 'Fri-Thu ok');
  assert(!validPeriod('2026-10-08', '2026-10-14'), 'Thu start'); assert(!validPeriod('2026-10-09', '2026-10-16'), '7 days');
  assert(!validPeriod('2026-02-30', '2026-03-05'), 'invalid date'); assert(!validPeriod('2026-10-09T00:00', '2026-10-15'), 'not a date');
});
Deno.test('G2: PDF bytes, base64 and sha256 helpers', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.4\nx');
  const b64 = btoa('%PDF-1.4\nx');
  const d = decodeBase64(b64)!; assert(d && isPdfBytes(d), 'decoded pdf');
  assert(!decodeBase64('not base64!'), 'bad b64'); assert(!isPdfBytes(new TextEncoder().encode('<html>')), 'html not pdf');
  assert(await sha256Hex(bytes) === await sha256Hex(d), 'sha');
  assert(MR_MAX_BYTES === 16 * 1024 * 1024);
});
Deno.test('G2: request shape (business number format, weekly only, .pdf name, sha256 hex)', () => {
  const base = {business_id: A, business_number: 'BSD-B-2608-1022', period_from: '2026-10-09', period_to: '2026-10-15', report_type: 'weekly', sha256: 'a'.repeat(64), file_name: 'r.pdf', pdf_base64: 'JVBERi0='};
  assert(publishShape(base).ok, 'valid');
  for (const bad of [{business_number: '1022'}, {report_type: 'monthly'}, {file_name: 'r.exe'}, {sha256: 'xyz'}, {business_id: 'nope'}, {posts_in_period: -1}])
    assert(!publishShape({...base, ...bad}).ok, 'rejects ' + JSON.stringify(bad));
  const s: any = publishShape({...base, file_name: '../../evil/r.pdf'}); assert(s.ok && !s.v.file_name.includes('/'), 'file name sanitized');
});

// 13.10.2026: document versions + dated names (Dekor case).
import {versionCount, datedName} from '../../supabase/functions/seller-portal-api/latest-files.ts';
Deno.test('document version: newest shown, version counts all saved PDFs, name dated', () => {
  const B = 'b1';
  const mk = (id: string, created: string, status = 'active', extra: any = {}) => ({id, business_id: B, category: 'exec_summary', document_type: 'internal_full_summary', file_name: `full ${id}.pdf`, file_type: 'application/pdf', storage_path: `${B}/${id}.pdf`, status, deleted_at: status === 'active' ? null : created, created_at: created, portal_kind: 'document', ...extra});
  const rows = [mk('old', '2026-10-11T12:07:56Z'), mk('new', '2026-10-12T07:32:11Z'), mk('short', '2026-10-06T09:48:55Z', 'deleted', {document_type: 'short_summary'})];
  const d = portalDocuments(rows, B).documents;
  if (d.length !== 1 || d[0].id !== 'new') throw Error('newest only');
  if (d[0].doc_version !== 2 || versionCount(rows, B, 'full_summary') !== 2) throw Error('version 2');
  if (d[0].replaced_on !== '12.10.2026') throw Error('replaced date ' + d[0].replaced_on);
  if (d[0].display_name !== 'full new – 12.10.2026.pdf') throw Error('dated name ' + d[0].display_name);
  if (datedName('x – 12.10.2026.pdf', '2026-10-12T07:00:00Z') !== 'x – 12.10.2026.pdf') throw Error('no double date');
});
