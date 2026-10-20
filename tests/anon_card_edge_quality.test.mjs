// 04.10.2026 - generate-anonymous-card: room for a full Hebrew summary, no silent
// partial text, and concrete permitted numbers are kept exactly.
// 20.10.2026: 8000 tokens, every card source, anonymous file first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('edge function: enough room for a full summary and no silent partial text', () => {
  const index = fs.readFileSync(new URL('../supabase/functions/generate-anonymous-card/index.ts', import.meta.url), 'utf8');
  const fn = index + fs.readFileSync(new URL('../supabase/functions/generate-anonymous-card/lib.ts', import.meta.url), 'utf8');
  const m = fn.match(/max_tokens:\s*(\d+)/); assert.ok(m && Number(m[1]) === 8000);
  assert.match(fn, /stop_reason === 'max_tokens'/);
  assert.match(fn, /כל מספר מותר נכתב בדיוק כמו במקור/);
  assert.match(fn, /אל תקצר/);
  const fileAt = index.indexOf('${BASE_FILE_INSTRUCTION}');
  const blockAt = index.indexOf('baseFile.block');
  const restAt = index.indexOf("{ type: 'text', text: userPrompt }");
  assert.ok(fileAt > 0 && fileAt < blockAt && blockAt < restAt);
});
