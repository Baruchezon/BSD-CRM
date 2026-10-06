// 04.10.2026 - generate-anonymous-card: room for a full Hebrew summary, no silent
// partial text, and concrete numbers/terms (e.g. rent as % of turnover) are kept.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('edge function: enough room for a full summary and no silent partial text', () => {
  const fn = fs.readFileSync(new URL('../supabase/functions/generate-anonymous-card/index.ts', import.meta.url), 'utf8')
    + fs.readFileSync(new URL('../supabase/functions/generate-anonymous-card/lib.ts', import.meta.url), 'utf8');
  const m = fn.match(/max_tokens:\s*(\d+)/); assert.ok(m && Number(m[1]) >= 2000);
  assert.match(fn, /stop_reason === 'max_tokens'/);
  assert.match(fn, /שכירות/);
});
