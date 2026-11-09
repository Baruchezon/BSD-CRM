import test from 'node:test';
import assert from 'node:assert/strict';
import { agreementCrmUpdate, israeliRegistrationNumber, entityKindLabel } from '../supabase/functions/complete-signed-agreement/fields.ts';

const GERESH = "מאפיית ג׳וזף"; // U+05F3
const GERSHAYIM = "ג'ירפה בע״מ"; // ASCII apostrophe + U+05F4

const LISTING = ['internal_name', 'anonymous_name', 'anon_display_name', 'business_name', 'notes', 'note_text', 'short_description'];

test('9-digit company and osek numbers, separators allowed', () => {
  assert.equal(israeliRegistrationNumber('512345678'), '512345678');
  assert.equal(israeliRegistrationNumber('051234567'), '051234567');
  assert.equal(israeliRegistrationNumber('51-234567-8'), '512345678');
  assert.equal(israeliRegistrationNumber('123 456 789'), '123456789');
  for (const bad of ['', '   ', '12345678', '1234567890', '12-345', 'abcdefgh', '1234 5678', null, undefined, 'תעודת זהות']) {
    assert.equal(israeliRegistrationNumber(bad), null, String(bad));
  }
});

test('entity kind is only ח.פ. or עוסק מורשה', () => {
  assert.equal(entityKindLabel('company'), 'ח.פ.');
  assert.equal(entityKindLabel('osek'), 'עוסק מורשה');
  assert.equal(entityKindLabel('חברה בע״מ'), 'ח.פ.');
  assert.equal(entityKindLabel('עוסק מורשה'), 'עוסק מורשה');
  assert.equal(entityKindLabel('ג׳וזף'), null);
});

test('business card stores legal name, number and address, not the listing name', () => {
  const result = agreementCrmUpdate({
    tableName: 'businesses',
    leadType: null,
    signerName: 'יוסי כהן',
    signerEmail: 'yosi@example.co.il',
    details: {
      business_name: GERSHAYIM,
      id_number: '51-417203-6',
      id_kind: 'company',
      address: 'הרצל 12',
      city: 'חיפה',
    },
  });
  assert.equal('error' in result, false);
  const update = result.update;
  assert.equal(update.legal_name, GERSHAYIM);
  assert.equal(update.id_number, '514172036');
  assert.equal(update.entity_type, 'ח.פ.');
  assert.equal(update.address, 'הרצל 12');
  assert.equal(update.city, 'חיפה');
  assert.equal(update.owner_name, 'יוסי כהן');
  for (const key of LISTING) assert.equal(Object.hasOwn(update, key), false, key);
});

test('geresh in the legal name is stored unchanged on a seller lead company field', () => {
  const result = agreementCrmUpdate({
    tableName: 'leads',
    leadType: 'seller',
    signerName: 'דנה לוי',
    signerEmail: '',
    details: {
      business_name: GERESH,
      id_number: '032178456',
      id_kind: 'osek',
      address: 'הנשיא 4',
      city: 'באר שבע',
    },
  });
  assert.equal(result.update.company, GERESH);
  assert.equal(result.update.id_number, '032178456');
  assert.equal(result.update.entity_type, 'עוסק מורשה');
  assert.equal(result.update.address, 'הנשיא 4');
  assert.equal(Object.hasOwn(result.update, 'business_name'), false);
  assert.equal(Object.hasOwn(result.update, 'internal_name'), false);
  assert.equal(Object.hasOwn(result.update, 'notes'), false);
});

test('invalid seller id numbers are rejected and write nothing', () => {
  for (const id of ['', '12345678', '1234567890', 'לא מספר', '12-345']) {
    const result = agreementCrmUpdate({
      tableName: 'businesses',
      leadType: null,
      signerName: 'א',
      signerEmail: '',
      details: { business_name: GERESH, id_number: id, id_kind: 'company', address: 'רחוב 1' },
    });
    assert.deepEqual(result, { error: 'invalid_id_number' }, String(id));
  }
  assert.deepEqual(agreementCrmUpdate({
    tableName: 'businesses', leadType: null, signerName: 'א', signerEmail: '',
    details: { business_name: '   ', id_number: '512345678', address: 'רחוב 1' },
  }), { error: 'missing_legal_name' });
  assert.deepEqual(agreementCrmUpdate({
    tableName: 'businesses', leadType: null, signerName: 'א', signerEmail: '',
    details: { business_name: GERESH, id_number: '512345678', address: '  ' },
  }), { error: 'missing_address' });
});

test('buyer agreements stay on the previous mapping and are not forced to 9 digits', () => {
  const result = agreementCrmUpdate({
    tableName: 'leads',
    leadType: 'buyer',
    signerName: 'קונה',
    signerEmail: 'b@example.com',
    details: { id_number: '123', entity: 'חברת בדיקה', address: 'רחוב 1, חיפה', city: 'חיפה' },
  });
  assert.equal(result.update.full_name, 'קונה');
  assert.equal(result.update.id_number, '123');
  assert.equal(result.update.company, 'חברת בדיקה');
  assert.equal(result.update.address, 'רחוב 1, חיפה');
  assert.equal(Object.hasOwn(result.update, 'legal_name'), false);
  assert.equal(Object.hasOwn(result.update, 'internal_name'), false);
});
