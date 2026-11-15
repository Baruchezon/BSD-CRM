import { assertEquals } from 'jsr:@std/assert@1';
import { alertSubject, businessUrlFromSitemap, inquiryKind, isTestSubmission, leadTypeFor, parseMessageContext, purposeGuess, alertHtml } from './logic.ts';

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
Deno.test('html escapes', () => {
  const h = alertHtml({ fullName: '<b>x</b>', phone: '050-1234567', email: 'a@b.co', city: 'ת"א', purposes: 'אחר', kind: 'other', message: 'a\nb', preferredDate: '', businessNumber: '', listingTitle: '', businessUrl: '', businessFound: true, source: '', page: '/צור-קשר/', crmUrl: 'https://x/?open=1', isTest: false });
  assertEquals(h.includes('<b>x</b>'), false);
  assertEquals(h.includes('a<br>b'), true);
});
