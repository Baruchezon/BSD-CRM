// 06.10.2026 - generate-anonymous-card pure helpers. Run: deno test tests/two_box_edge_test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { buildAnonInput, buildAnonPrompts, localSafetyScan, deriveRegionFromCity } from '../supabase/functions/generate-anonymous-card/lib.ts';

const biz = {
  internal_name: 'סטאר לנד', owner_name: 'יוסי', city: 'ראשון לציון', region: null, address: 'הרצל 12',
  short_description: 'DB full', internal_business_summary: 'DB internal', anon_summary: 'DB anon',
  field: 'משחקיות', category: 'פנאי', annual_revenue: 1200000, operating_profit: 350000, net_profit: 280000,
  asking_price: 900000, anon_card_show_price: false,
};

Deno.test('full box is the first source, even when the anonymous box already has text', () => {
  const i = buildAnonInput(biz, { description: 'כל המידע מהמסך', internal_summary: 'פנימי', anon_text: 'טקסט אנונימי ישן' });
  assertEquals(i.sourceText, 'כל המידע מהמסך');
  assert(i.sourceLabel!.includes('כל המידע על העסק'));
  assertEquals(buildAnonInput(biz, { description: '', internal_summary: 'פנימי', anon_text: 'x' }).sourceText, 'פנימי');
  assertEquals(buildAnonInput(biz, { description: '', internal_summary: '', anon_text: 'x' }).sourceText, 'x');
  assertEquals(buildAnonInput(biz, null).sourceText, 'DB full'); // old callers without form
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
