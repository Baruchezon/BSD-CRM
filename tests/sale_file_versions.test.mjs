import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'node:fs';
const js = fs.readFileSync(new URL('../js/saleFileModule2.js', import.meta.url), 'utf8');
const portal = fs.readFileSync(new URL('../portal/portal.js', import.meta.url), 'utf8');
test('CRM file cards show «גרסה N» for the four document types (13.10.2026)', () => {
  assert.match(js, /SF_VERSIONED_KEYS = \['anonymous_summary', 'full_summary', 'market_research', 'economic_analysis'\]/);
  assert.match(js, /· גרסה \$\{ver\}/);
  assert.match(js, /document_type === 'short_summary'\) return;/);
});
test('portal shows «(הותקן קובץ חדש DATE)» next to a replaced document', () => {
  assert.ok(portal.includes('(הותקן קובץ חדש ${esc(f.replaced_on)})'));
});
