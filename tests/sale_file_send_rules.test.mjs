import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSaleFileAccess, missingSaleFileEmailMessage, recipientHasSignedAgreement } from '../supabase/functions/_shared/sale-file-send-rules.js';

const anon = { id: 'a', file_name: 'תקציר אנונימי.pdf', confidentiality_level: 1 };
const secret = { id: 's', file_name: 'חקר שוק.pdf', confidentiality_level: 2 };

test('owner is always signed; a buyer is signed only with the exact agreement status', () => {
  assert.equal(recipientHasSignedAgreement('owner', undefined), true);
  assert.equal(recipientHasSignedAgreement('owner', 'אין הסכם'), true);
  assert.equal(recipientHasSignedAgreement('buyer', 'יש הסכם חתום'), true);
  assert.equal(recipientHasSignedAgreement('buyer', 'נשלח הסכם לחתימה'), false);
  assert.equal(recipientHasSignedAgreement('broker', undefined), false);
  assert.equal(recipientHasSignedAgreement('buyer', '2'), false);
});

test('confidential level 2 without a signed agreement fails closed in Hebrew, and does not drop the file', () => {
  for (const type of ['buyer', 'broker']){
    const blocked = evaluateSaleFileAccess({
      recipientType: type, agreementStatus: 'אין הסכם', file_ids: ['a', 's'], files: [anon, secret],
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.status, 403);
    assert.equal(blocked.reason, 'confidentiality_blocked');
    assert.match(blocked.error, /חקר שוק\.pdf/);
    assert.match(blocked.error, /אין הסכם סודיות חתום/);
    assert.equal(blocked.disallowed.length, 1);
  }
  const owner = evaluateSaleFileAccess({
    recipientType: 'owner', agreementStatus: null, file_ids: ['s'], files: [secret],
  });
  assert.equal(owner.ok, true);
  assert.equal(owner.signed, true);
});

test('a string confidentiality level of 2 is still blocked', () => {
  const blocked = evaluateSaleFileAccess({
    recipientType: 'buyer', agreementStatus: 'נשלח הסכם לחתימה',
    file_ids: ['s'], files: [{ ...secret, confidentiality_level: '2' }],
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 403);
});

test('missing or inactive files are an explicit error, not a partial send', () => {
  const missing = evaluateSaleFileAccess({
    recipientType: 'buyer', agreementStatus: 'יש הסכם חתום', file_ids: ['a', 'gone'], files: [anon],
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 400);
  assert.equal(missing.reason, 'file_not_found_or_inactive');
  assert.match(missing.error, /לא נמצא/);
  assert.deepEqual(missing.missing, ['gone']);
});

test('anonymous file is allowed without an agreement', () => {
  const ok = evaluateSaleFileAccess({
    recipientType: 'buyer', agreementStatus: 'אין הסכם', file_ids: ['a'], files: [anon],
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.signed, false);
});

test('missing email messages name the right card', () => {
  assert.match(missingSaleFileEmailMessage('buyer'), /קונה/);
  assert.match(missingSaleFileEmailMessage('broker'), /מתווך/);
  assert.match(missingSaleFileEmailMessage('owner'), /בעל העסק/);
  assert.doesNotMatch(missingSaleFileEmailMessage('buyer'), /WhatsApp|Resend/);
});
