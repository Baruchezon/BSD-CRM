import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UPDATE_TOKEN_TTL_MS,
  alreadyRegisteredPlan,
  planSubscriberUpdate,
  signupPrefill,
  verifyUpdateToken
} from '../supabase/functions/business-alert-signup/logic.mjs';

const secret = 'test-update-secret';
const stored = {
  id: 'sub-1',
  first_name: 'דנה',
  last_name: 'לוי',
  email: 'Dana@Example.com',
  phone: '050-1234567',
  phone9: '501234567',
  status: 'active',
  categories: ['food'],
  subcategories: ['bakery'],
  flags: ['franchise'],
  budget_min: 100000,
  budget_max: 500000,
  budget_open: false,
  regions: ['center'],
  looking_for: 'מאפייה',
  consent_email: true,
  consent_whatsapp: false,
  address_form: 'female',
  crm_lead_id: 'lead-1',
  region: 'מרכז'
};

test('a duplicate signup keeps the row and returns a 30 minute token', () => {
  const now = Date.parse('2026-11-13T08:00:00Z');
  const plan = alreadyRegisteredPlan(stored, 'dana@example.com', { nonce: 'nonce-1', nowMs: now, secret });
  assert.equal(plan.status, 'already_registered');
  assert.equal(plan.emailMatched, true);
  assert.equal(plan.prefill.categories[0], 'food');
  assert.equal(plan.prefill.address_form, 'female');
  assert.equal(Object.hasOwn(plan.prefill, 'email'), false);
  assert.equal(Object.hasOwn(plan.prefill, 'phone'), false);
  assert.equal(Object.hasOwn(plan.prefill, 'first_name'), false);
  const verified = verifyUpdateToken(plan.update_token, secret, now + 1000);
  assert.equal(verified.ok, true);
  assert.equal(verified.subscriberId, 'sub-1');
  assert.equal(verified.nonce, 'nonce-1');
  assert.equal(verified.emailMatched, true);
  assert.equal(verifyUpdateToken(plan.update_token, secret, now + UPDATE_TOKEN_TTL_MS).ok, false);
  assert.equal(verifyUpdateToken(plan.update_token, 'other', now + 1000).ok, false);
});

test('prefill is omitted when the email does not match', () => {
  assert.equal(signupPrefill(stored, 'other@example.com'), null);
  const plan = alreadyRegisteredPlan(stored, 'other@example.com', { nonce: 'nonce-2', nowMs: Date.now(), secret });
  assert.equal(plan.prefill, undefined);
  assert.equal(plan.emailMatched, false);
});

test('update changes profile fields and rewrites the linked lead without a new lead', () => {
  const plan = planSubscriberUpdate({
    stored,
    incoming: {
      categories: ['retail'],
      region: 'דרום',
      budget_max: 900000,
      first_name: 'אחר',
      email: 'other@example.com',
      consent_email: true
    },
    emailMatched: false,
    now: '2026-11-13T08:10:00Z'
  });
  assert.equal(plan.changes.first_name, undefined);
  assert.equal(plan.changes.email, undefined);
  assert.equal(plan.changes.categories[0], 'retail');
  assert.equal(plan.changes.consent_method, 'self_update');
  assert.equal(plan.changes.consent_email_method, 'self_update');
  assert.equal(plan.lead.id, 'lead-1');
  assert.equal(plan.lead.requested_area, 'דרום');
  assert.equal(plan.lead.budget, 900000);
  assert.equal(plan.lead.insert, undefined);

  const named = planSubscriberUpdate({
    stored,
    incoming: { first_name: 'דנה', email: 'dana@example.com' },
    emailMatched: true,
    now: '2026-11-13T08:10:00Z'
  });
  assert.equal(named.changes.first_name, 'דנה');
  assert.equal(named.changes.email, 'dana@example.com');
});

test('an unsubscribed row stays closed until a fresh consent update', () => {
  const closed = { ...stored, status: 'unsubscribed', crm_lead_id: null };
  const held = planSubscriberUpdate({
    stored: closed,
    incoming: { categories: ['retail'], consent_general: false },
    emailMatched: true,
    now: '2026-11-13T08:10:00Z'
  });
  assert.equal(held.changes.status, undefined);
  const back = planSubscriberUpdate({
    stored: closed,
    incoming: { consent_general: true, consent_email: true, consent_whatsapp: false },
    emailMatched: true,
    now: '2026-11-13T08:10:00Z'
  });
  assert.equal(back.changes.status, 'active');
  assert.equal(back.changes.consent_method, 'self_update');
  assert.equal(back.lead, null);
});

test('all good writes no profile change and no lead request', () => {
  const plan = planSubscriberUpdate({
    stored,
    incoming: { all_good: true, region: 'דרום' },
    emailMatched: true,
    now: '2026-11-13T08:10:00Z'
  });
  assert.equal(plan.action, 'confirm');
  assert.deepEqual(plan.changes, {});
  assert.equal(plan.lead, null);
});
