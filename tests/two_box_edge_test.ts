// 06.10.2026 - generate-anonymous-card pure helpers. Run: deno test tests/two_box_edge_test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { buildAnonInput, buildAnonPrompts, localSafetyScan, deriveRegionFromCity, BASE_FILE_INSTRUCTION } from '../supabase/functions/generate-anonymous-card/lib.ts';

const biz = {
  internal_name: 'סטאר לנד', owner_name: 'יוסי', city: 'ראשון לציון', region: null, address: 'הרצל 12',
  short_description: 'DB full', internal_business_summary: 'DB internal', anon_summary: 'DB anon',
  field: 'משחקיות', category: 'פנאי', annual_revenue: 1200000, operating_profit: 350000, net_profit: 280000,
  asking_price: 900000, anon_card_show_price: false,
};

Deno.test('all card sources are sent; notes and research are included and identifiers are redacted', () => {
  const i = buildAnonInput(biz, {
    description: 'כל המידע מהמסך', internal_summary: 'פנימי', anon_text: 'טקסט אנונימי ישן',
    notes: 'הערה: סטאר לנד, יוסי, 050-1111111', pre_research: 'חקר בראשון לציון, מתחם 400', sale_reason: 'סיבה פנימית',
  }, { calls: ['סיכום שיחה'], meetings: ['סיכום פגישה'], leadTexts: ['כרטיס מוכר'] });
  assert(i.sourceLabel!.includes('כל הכרטיס'));
  for (const part of [
    '=== כל המידע על העסק ===\nכל המידע מהמסך',
    '=== תקציר עסקי פנימי ===\nפנימי',
    '=== הערות פנימיות ===',
    '=== חקר מקדים (דנה)',
    '=== סיבת מכירה (רקע פנימי בלבד) ===\nסיבה פנימית',
    '=== סיכום שיחה טלפונית 1 ===\nסיכום שיחה',
    '=== סיכום פגישה 1 ===\nסיכום פגישה',
    '=== מידע מכרטיס המוכר 1 ===\nכרטיס מוכר',
    '=== טקסט קיים בתיבת התקציר האנונימי ===\nטקסט אנונימי ישן',
  ]) assert(i.sourceText.includes(part), part);
  assert(!i.sourceText.includes('סטאר לנד') && !i.sourceText.includes('יוסי'));
  assert(!i.sourceText.includes('050-1111111') && !i.sourceText.includes('ראשון לציון'));
  assert(i.sourceText.includes('[מזהה הוסר]') && i.sourceText.includes('[טלפון הוסר]') && i.sourceText.includes('[יישוב הוסר]'));
  assert(i.sourceText.includes('מתחם 400'));
  // an empty box on screen is not replaced by the saved value; a missing box falls back to the database
  const emptyDesc = buildAnonInput(biz, { description: '', internal_summary: 'פנימי', anon_text: 'x', notes: '', pre_research: '' });
  assert(!emptyDesc.sourceText.includes('DB full'));
  assert(emptyDesc.sourceText.includes('פנימי') && emptyDesc.sourceText.includes('x'));
  const db = buildAnonInput(biz, null);
  assert(db.sourceText.includes('DB full') && db.sourceText.includes('DB internal') && db.sourceText.includes('DB anon'));
});

Deno.test('anonymous file is the base and is placed before the rest of the card', () => {
  assert(BASE_FILE_INSTRUCTION.includes('מצורף קובץ תקציר אנונימי'));
  assert(BASE_FILE_INSTRUCTION.includes('הוא הבסיס של התקציר'));
  const index = Deno.readTextFileSync(new URL('../supabase/functions/generate-anonymous-card/index.ts', import.meta.url));
  const fileAt = index.indexOf('${BASE_FILE_INSTRUCTION}');
  const blockAt = index.indexOf('baseFile.block');
  const restAt = index.indexOf("{ type: 'text', text: userPrompt }");
  assert(fileAt > 0 && fileAt < blockAt && blockAt < restAt);
  assert(index.includes('max_tokens: 8000'));
  assert(!index.includes('max_tokens: 3000'));
});

Deno.test('v15 prompt is the three site headings, 120-170 words, without an area or closing section', () => {
  const { systemPrompt } = buildAnonPrompts(buildAnonInput(biz, { description: 'טקסט' }));
  for (const h of ['תחום פעילות:', 'הזדמנות עסקית:', 'נתונים מרכזיים:']) assert(systemPrompt.includes(h), h);
  assert(systemPrompt.includes('120-170 מילים'));
  assert(systemPrompt.includes('שלושת הפרקים האלה בלבד'));
  assert(systemPrompt.includes('לא "אזור"') && systemPrompt.includes('לא "לפרטים נוספים"'));
  assert(systemPrompt.includes('תמציתי'));
  assert(!systemPrompt.includes('אל תקצר'));
  assert(!systemPrompt.includes('יתרונות וחוזקות') && !systemPrompt.includes('הקונה האידיאלי'));
  assert(BASE_FILE_INSTRUCTION.includes('הנתונים והמסרים המרכזיים'));
  assert(!BASE_FILE_INSTRUCTION.includes('אל תקצר'));
});

Deno.test('region derived from the city when empty; city/profit/price never reach the AI', () => {
  const i = buildAnonInput(biz, { description: 'טקסט', region: '' });
  assertEquals(i.region, 'אזור המרכז');
  const { systemPrompt, userPrompt } = buildAnonPrompts(i);
  assert(!userPrompt.includes('ראשון לציון'));
  assert(!userPrompt.includes('350,000') && !userPrompt.includes('280,000'));
  assert(!userPrompt.includes('900,000'));
  assert(userPrompt.includes('אזור: אזור המרכז'));
  assert(systemPrompt.includes('רווחיות - אסור לחלוטין'));
  assertEquals(buildAnonInput({ ...biz, region: 'השרון' }, { description: 't' }).region, 'השרון');
  assertEquals(buildAnonInput({ ...biz, city: 'כפר נידח' }, { description: 't' }).region, '');
  assertEquals(deriveRegionFromCity('תל אביב-יפו'), 'אזור המרכז');
});

Deno.test('server confirm scan: city / profit blocked, derived region allowed', () => {
  assertEquals(localSafetyScan('עסק פעיל באזור המרכז עם מחזור 1.2 מיליון ₪', biz).length, 0);
  assert(localSafetyScan('עסק בראשון לציון', biz).length > 0);
  assert(localSafetyScan('עסק רווחי מאוד', biz).length > 0);
  assertEquals(localSafetyScan('עסק באזור ירושלים', { ...biz, city: 'ירושלים' }).length, 0);
});
