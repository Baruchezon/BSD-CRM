import assert from 'node:assert/strict';
import test from 'node:test';
import { SUBSCRIBER_FROM } from '../supabase/functions/_shared/business-alert-mail.mjs';
import { APPROVED_ALERT_BUSINESSES, threeBusinessEmail } from '../supabase/functions/_shared/opportunity-email.mjs';

test('the approved three-business letter keeps the company sender and both buttons', () => {
  const mail = threeBusinessEmail({
    firstName: 'יבגני',
    businesses: APPROVED_ALERT_BUSINESSES.map(business => ({
      ...business,
      detailsUrl: `https://example.test/details/${business.number}`
    })),
    unsubscribeUrl: 'https://www.bsd-bbi.co.il/הסרה/?token=abc&channel=email',
    addressForm: 'female'
  });
  assert.equal(mail.from, '"BSD - עסקים למכירה" <info@bsd-bbi.co.il>');
  assert.equal(mail.from, SUBSCRIBER_FROM);
  assert.equal(mail.from.includes('ברוך'), false);
  assert.equal(mail.subject.includes('פרסומת'), false);
  assert.equal(mail.html.includes('פרסומת'), false);
  assert.equal(mail.text.includes('פרסומת'), false);
  assert.match(mail.subject, /3 עסקים שבחרנו בשבילך/);
  assert.match(mail.html, /שלום יבגני,/);
  assert.match(mail.html, /תודה שנרשמת לעדכונים של BSD/);
  assert.match(mail.html, /משביחים עסקים, מחברים הזדמנויות, מובילים עסקאות/);
  assert.match(mail.html, /BSD-B-2607-1014/);
  assert.match(mail.html, /BSD-B-2607-1015/);
  assert.match(mail.html, /BSD-B-2608-1021/);
  assert.match(mail.html, /9,000,000 ₪/);
  assert.match(mail.html, /לכל פרטי העסק/);
  assert.match(mail.html, /לקבלת פרטים מורחבים/);
  assert.match(mail.html, /להסיר את עצמך כאן/);
  assert.equal(mail.html.includes('השיב למייל הזה במילה'), false);
  assert.match(mail.text, /שלום יבגני,/);
  assert.match(mail.text, /1\) עסק בתחום התחבורה והשכרת רכבים/);
  assert.match(mail.text, /לקבלת פרטים מורחבים:/);
  assert.match(mail.text, /https:\/\/www\.bsd-bbi\.co\.il\/הסרה\//);
  assert.equal(mail.text.includes('במילה «הסרה»'), false);
  assert.match(mail.html, /חדשה בעולם העסקים/);
  assert.match(mail.text, /מימון רכישת העסק/);
  assert.equal(APPROVED_ALERT_BUSINESSES.length, 3);
});
