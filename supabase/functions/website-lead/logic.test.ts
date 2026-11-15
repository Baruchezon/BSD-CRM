import { assertEquals } from 'jsr:@std/assert@1';
import { alertSubject, alertText, businessUrlFromSitemap, inquiryKind, isTestSubmission, leadTypeFor, parseMessageContext, purposeGuess, alertBudget, alertHtml } from './logic.ts';

Deno.test('kinds', () => {
  assertEquals(inquiryKind(['לקנות עסק']), 'buyer');
  assertEquals(inquiryKind(['למכור עסק']), 'seller');
  assertEquals(inquiryKind(['למכור עסק', 'לקנות עסק']), 'mixed');
  assertEquals(inquiryKind(['ייעוץ או שאלה עיסקית']), 'question');
  assertEquals(inquiryKind(['אחר']), 'other');
  assertEquals(inquiryKind(['רישום לקורס', 'לקנות עסק']), 'training');
  assertEquals(inquiryKind([]), 'unknown');
  assertEquals(inquiryKind(['Buy a business']), 'buyer');
  assertEquals(purposeGuess('question'), 'ייעוץ או שאלה עסקית');
  assertEquals(leadTypeFor('mixed'), 'seller');
});
Deno.test('subject', () => {
  assertEquals(alertSubject({ kind: 'buyer', businessNumber: 'BSD-B-2607-1001', fullName: 'יוסי כהן' }), 'ליד חדש · קונה · BSD-B-2607-1001 · יוסי');
  assertEquals(alertSubject({ kind: 'question', fullName: 'דנה' }), 'ליד חדש · שאלה · דנה');
  assertEquals(alertSubject({ kind: 'other', fullName: 'דנה', isTest: true, repeat: true }), '[בדיקה] פנייה חוזרת · אחר · דנה');
});
Deno.test('message context', () => {
  const c = parseMessageContext('מעניין אותי\nמספר עסק: BSD-B-2608-1028\nעסק: בית מלון\nמקור הגעה: google / cpc · הפניה: www.google.com');
  assertEquals(c.businessNumber, 'BSD-B-2608-1028');
  assertEquals(c.listingTitle, 'בית מלון');
  assertEquals(c.sourceLine, 'google / cpc');
  assertEquals(c.referrer, 'www.google.com');
  assertEquals(c.original, 'מעניין אותי');
});
Deno.test('test detection', () => {
  assertEquals(isTestSubmission({ is_test: true }, 'a', 'a@b.co', ''), true);
  assertEquals(isTestSubmission({}, 'בדיקה (is_test)', 'a@b.co', ''), true);
  assertEquals(isTestSubmission({}, 'a', 'x@example.com', ''), true);
  assertEquals(isTestSubmission({}, 'דני', 'dani@gmail.com', 'שלום'), false);
});
Deno.test('sitemap', () => {
  const xml = '<url><loc>https://www.bsd-bbi.co.il/x/%D7%91-bsd-b-2608-1028/</loc></url><url><loc>https://www.bsd-bbi.co.il/y-bsd-b-2608-10280/</loc></url>';
  assertEquals(businessUrlFromSitemap(xml, 'BSD-B-2608-1028'), 'https://www.bsd-bbi.co.il/x/%D7%91-bsd-b-2608-1028/');
});
const sampleAlert = {
  fullName: '<b>x</b>', phone: '050-1234567', email: 'a@b.co', city: 'ת"א', purposes: 'אחר', kind: 'other' as const,
  message: 'a\nb', preferredDate: '2026-11-20', businessNumber: 'BSD-B-2607-1001', listingTitle: 'בית מלון',
  businessUrl: 'https://www.bsd-bbi.co.il/x/', businessFound: true, source: 'google / cpc', page: '/צור-קשר/',
  crmUrl: 'https://x/?open=1', isTest: false, registeredAt: '2026-11-13T09:40:00Z',
};

Deno.test('html escapes and stays a compact phone document', () => {
  const h = alertHtml(sampleAlert);
  assertEquals(h.includes('<b>x</b>'), false);
  assertEquals(h.includes('a<br>b'), true);
  assertEquals(h.startsWith('<!doctype html>'), true);
  assertEquals(h.includes('name="viewport" content="width=device-width,initial-scale=1"'), true);
  assertEquals(h.includes('max-width:600px'), true);
  assertEquals(h.includes('width:100%'), true);
  assertEquals(h.includes('margin:0 auto'), true);
  assertEquals(h.includes('dir="rtl"'), true);
  assertEquals(h.includes('font-size:16px'), true);
  assertEquals(h.includes('nowrap'), false);
  assertEquals(h.includes('13.11.2026 11:40'), true);
  for (const banned of ['a@b.co', 'https://', 'href=', 'BSD-B-2607-1001', '/צור-קשר/', 'google', 'בית מלון', 'ת"א', '2026-11-20', 'mailto:', 'tel:', 'כרטיס']) {
    assertEquals(h.includes(banned), false, banned);
  }
});

Deno.test('alert body is only the compact fields, with budget only when given', () => {
  const withBudget = alertText({ ...sampleAlert, fullName: 'יוסי כהן', purposes: 'לקנות עסק', message: 'מחפש מסעדה', budget: '500 אלף–1 מיליון' });
  assertEquals(withBudget, [
    'שם פרטי: יוסי',
    'שם משפחה: כהן',
    'טלפון: 050-1234567',
    'תחומי עניין: לקנות עסק\nמחפש מסעדה',
    'תאריך הרשמה: 13.11.2026 11:40',
    'תקציב: 500 אלף–1 מיליון',
  ].join('\n'));
  const bare = alertText({ ...sampleAlert, fullName: 'רון', purposes: '', message: '', budget: '   ' });
  assertEquals(bare.includes('תקציב'), false);
  assertEquals(bare.includes('שם משפחה'), false);
  assertEquals(bare.includes('תחומי עניין'), false);
  assertEquals(alertBudget({}), '');
  const money = alertBudget({ budget: 1500000 });
  assertEquals(money.replace(/\D/g, ''), '1500000');
  assertEquals(money.includes('₪'), true);
  assertEquals(alertBudget({ budget: 'עד 2 מיליון' }), 'עד 2 מיליון');
});

Deno.test('reply-to is info@ and the lead address is not the reply target', async () => {
  const src = await Deno.readTextFile(new URL('./index.ts', import.meta.url));
  assertEquals(src.includes("const MAIL_REPLY_TO = 'info@bsd-bbi.co.il';"), true);
  assertEquals(src.includes('reply_to: MAIL_REPLY_TO'), true);
  assertEquals(/reply_to:\s*replyTo/.test(src), false);
  assertEquals(/sendAlert\([^)]*contactEmail/.test(src), false);
  assertEquals(src.includes('alertSubject({ kind: values.kind'), true);
  assertEquals(src.includes('isTest ? TEST_TO : BARUCH_TO'), true);
});
