import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chooseAnonymousFile,
  detailAccess,
  gentleDetailsCopy,
  recentDetailRequest
} from '../supabase/functions/business-alert-request-details/logic.mjs';
import { BSD_SLOGAN, signOffText } from '../supabase/functions/_shared/business-alert-mail.mjs';

test('only an explicitly flagged anonymous file is chosen', () => {
  const file = chooseAnonymousFile([
    { id: 'other', document_type: 'short_summary', status: 'active', storage_path: 'a', version_number: 9, created_at: '2026-11-13T10:00:00Z' },
    { id: 'old', document_type: 'anonymous_summary', status: 'active', storage_path: 'b', version_number: 1, created_at: '2026-11-13T09:00:00Z' },
    { id: 'new', document_type: 'anonymous_summary', status: 'active', storage_path: 'c', version_number: 2, created_at: '2026-11-13T08:00:00Z' },
    { id: 'gone', document_type: 'anonymous_summary', status: 'active', deleted_at: '2026-11-13T11:00:00Z', storage_path: 'd', version_number: 3 }
  ]);
  assert.equal(file.id, 'new');
  assert.equal(chooseAnonymousFile([{ document_type: 'anonymous_summary', status: 'draft', storage_path: 'x' }]), null);
});

test('details stay off except for a test subscriber or the allowlist', () => {
  const person = { id: 'sub', is_test: false };
  assert.equal(detailAccess({ enabled: false, allowlist: [], subscriber: person }), false);
  assert.equal(detailAccess({ enabled: false, allowlist: [], subscriber: { ...person, is_test: true } }), true);
  assert.equal(detailAccess({ enabled: false, allowlist: ['sub'], subscriber: person }), true);
  assert.equal(recentDetailRequest([{ created_at: new Date().toISOString() }], Date.now()), true);
  assert.equal(recentDetailRequest([{ created_at: '2020-01-01T00:00:00Z' }], Date.now()), false);
  assert.match(gentleDetailsCopy('female').text, /אלייך/);
  assert.match(gentleDetailsCopy('male').text, /אליך/);
  assert.equal(gentleDetailsCopy('female').text.includes('/'), false);
});

test('the resend script previews one subscriber and does not confirm by itself', () => {
  const result = spawnSync(process.execPath, ['scripts/resend-one-alert.mjs', 'b6272485-0059-4c42-99f7-97650275bf8b'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  const body = JSON.parse(result.stdout);
  assert.equal(body.action, 'send_one_alert');
  assert.equal(body.confirm, false);
  assert.equal(body.id, 'b6272485-0059-4c42-99f7-97650275bf8b');
});

test('system mail footers use the new slogan', () => {
  assert.equal(BSD_SLOGAN, 'משביחים עסקים, מחברים הזדמנויות, מובילים עסקאות');
  assert.match(signOffText(), /משביחים עסקים, מחברים הזדמנויות, מובילים עסקאות/);
});
