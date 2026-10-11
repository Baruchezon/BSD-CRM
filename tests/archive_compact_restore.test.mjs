import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = rel => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

function leadVisible(l){
  const src = read('leads.html');
  const helper = src.match(/function leadHasSignedAgreement\(l\)\{[^\n]*\}/)[0];
  const visible = src.match(/function leadVisibleOnBuyersList\(l\)\{[\s\S]*?\n\}/)[0];
  const c = { lead: l, shown: null };
  vm.createContext(c);
  vm.runInContext(`${helper}\n${visible}\nshown = leadVisibleOnBuyersList(lead);`, c);
  return c.shown;
}

test('restore clears the intake stage that hides a buyer from קונים ומשקיעים', async () => {
  const src = read('js/archiveModule.js');
  const fn = src.slice(src.indexOf('async function updateArchiveRecord'), src.indexOf('function openArchiveReasonModal'));
  const writes = [];
  let row = { id: 'b1', is_archived: true, type: 'buyer', website_intake_stage: 'contacted', agreement_status: 'אין הסכם', full_name: 'בדיקה' };
  const c = {
    window: { supabaseClient: { from(){ let values; return { update(v){ values = v; return this; }, eq(){ return this; }, select(){ return this; }, async single(){ writes.push(values); row = { ...row, ...values, archived_at: null, archived_by: null, archive_reason: null }; return { data: { ...row } }; } }; } } },
    writes, shown: null
  };
  vm.createContext(c);
  await vm.runInContext(`(async () => { ${fn}\n writes.push(await updateArchiveRecord('leads','b1',false)); })()`, c);
  const saved = writes[0];
  assert.equal(saved.is_archived, false);
  assert.equal(saved.website_intake_stage, null);
  const returned = writes[1];
  assert.equal(leadVisible({ ...row, is_archived: true, website_intake_stage: 'contacted' }), false);
  assert.equal(leadVisible(returned), true);
  assert.equal(leadVisible({ ...returned, type: 'partner' }), true);
});

test('an investor in the inbox stays hidden until restore clears the stage', () => {
  const partner = { type: 'partner', is_archived: false, website_intake_stage: 'training', agreement_status: 'אין הסכם' };
  assert.equal(leadVisible(partner), false);
  assert.equal(leadVisible({ ...partner, website_intake_stage: null }), true);
  assert.equal(leadVisible({ type: 'buyer', is_archived: false, website_intake_stage: 'contacted', agreement_status: 'יש הסכם חתום' }), true);
  assert.equal(leadVisible({ type: 'seller', is_archived: false, website_intake_stage: null, agreement_status: 'יש הסכם חתום' }), false);
});

test('buyer and business archives are one-line strips, and restore toasts name the list', () => {
  for (const file of ['leads.html', 'businesses.html']){
    const html = read(file);
    assert.match(html, /\.archive-strip\{[^}]*height:36px/);
    assert.match(html, /\.archive-strip\{[^}]*max-height:36px/);
    assert.match(html, /\.archive-strip\{[^}]*white-space:nowrap/);
    assert.match(html, /class="archive-strip"/);
    assert.match(html, /archive-strip-date/);
    assert.match(html, /archive-strip-meta/);
    assert.match(html, /↩️ שחזר/);
    assert.match(html, /archiveModule\.js\?v=202610112100/);
    assert.match(html, /var PAGE_BUILD = '202610112100';/);
  }
  const leads = read('leads.html');
  assert.match(leads, /שוחזר לרשימת הקונים/);
  assert.match(leads, /שוחזר לרשימת המשקיעים/);
  assert.match(leads, /id="leadArchiveStrips"/);
  assert.match(leads, /getElementById\('leadArchiveStrips'\)/);
  const biz = read('businesses.html');
  assert.match(biz, /שוחזר לרשימת העסקים/);
  assert.match(biz, /id="bizArchiveStrips"/);
  assert.match(read('js/archiveModule.js'), /listing_status:'active'/);
  assert.equal(JSON.parse(read('version.json')).version, '202610112100');
});

test('business restore payload keeps the row on the active list', async () => {
  const src = read('js/archiveModule.js');
  const fn = src.slice(src.indexOf('async function updateArchiveRecord'), src.indexOf('function openArchiveReasonModal'));
  const c = { saved: null, window: { supabaseClient: { from(){ return { update(v){ c.saved = v; return this; }, eq(){ return this; }, select(){ return this; }, async single(){ return { data: { id: 'z', is_archived: false, listing_status: 'active' } }; } }; } } } };
  vm.createContext(c);
  await vm.runInContext(`(async () => { ${fn}\n await updateArchiveRecord('businesses','z',false); })()`, c);
  assert.equal(c.saved.is_archived, false);
  assert.equal(c.saved.listing_status, 'active');
  assert.equal(c.saved.removal_reason, null);
  assert.equal(c.saved.sold_to, null);
});
