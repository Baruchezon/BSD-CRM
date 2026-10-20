// 04.10.2026 - generate-anonymous-card: room for the summary, no silent partial
// text, and concrete permitted numbers are kept exactly.
// 20.10.2026 v15: site format only — תחום פעילות / הזדמנות עסקית / נתונים מרכזיים,
// 120-170 words, no אזור section and no לפרטים נוספים. Anonymous file still first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('edge function: site-format summary, 120-170 words, no silent partial text', () => {
  const index = fs.readFileSync(new URL('../supabase/functions/generate-anonymous-card/index.ts', import.meta.url), 'utf8');
  const fn = index + fs.readFileSync(new URL('../supabase/functions/generate-anonymous-card/lib.ts', import.meta.url), 'utf8');
  const m = fn.match(/max_tokens:\s*(\d+)/); assert.ok(m && Number(m[1]) === 8000);
  assert.match(fn, /stop_reason === 'max_tokens'/);
  assert.match(fn, /כל מספר מותר נכתב בדיוק כמו במקור/);
  for (const h of ['תחום פעילות:', 'הזדמנות עסקית:', 'נתונים מרכזיים:']) assert.match(fn, new RegExp(h));
  assert.match(fn, /120-170 מילים/);
  assert.match(fn, /שלושת הפרקים האלה בלבד/);
  assert.match(fn, /לא "אזור"/);
  assert.match(fn, /לא "לפרטים נוספים"/);
  assert.match(fn, /תמציתי/);
  assert.doesNotMatch(fn, /אל תקצר/);
  assert.doesNotMatch(fn, /יתרונות וחוזקות/);
  assert.doesNotMatch(fn, /הקונה האידיאלי/);
  const fileAt = index.indexOf('${BASE_FILE_INSTRUCTION}');
  const blockAt = index.indexOf('baseFile.block');
  const restAt = index.indexOf("{ type: 'text', text: userPrompt }");
  assert.ok(fileAt > 0 && fileAt < blockAt && blockAt < restAt);
});
