import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const vip = readFileSync(new URL("../js/vip-crm-integration.js", import.meta.url), "utf8");
const leads = readFileSync(new URL("../leads.html", import.meta.url), "utf8");

test("buyer VIP checkbox: locked only when there is no agreement AND no account", () => {
  assert.match(vip, /const disabled=\(!eligible && !account\) \? 'disabled' : '';/);
  assert.doesNotMatch(vip, /disabled=\(!eligible \|\| !!account\)/);
});

test("buyer VIP checkbox: unchecking cancels the account (soft delete) after confirm", () => {
  assert.match(vip, /checkbox\.addEventListener\('change',\(\)=>\{ if\(checkbox\.checked\) enable\(\); else disable\(\); \}\);/);
  assert.match(vip, /async function disable\(\)\{[\s\S]*window\.confirm\([\s\S]*if\(!ok\)\{ checkbox\.checked=true; return; \}[\s\S]*adminApi\('admin_account_action',\{account_id:current\.id,account_action:'delete'\}\)/);
});

test("buyer VIP checkbox: enabling stays gated by agreement and can be undone right away", () => {
  assert.match(vip, /const eligible=\['נשלח הסכם לחתימה','יש הסכם חתום'\]\.includes\(lead\.agreement_status\)/);
  assert.match(vip, /current=result\.account \|\| null;/);
  assert.match(vip, /checkbox\.disabled=!current && !eligible;/);
});

test("buyers list: notes preview is clamped to a fixed height, full text kept in title", () => {
  assert.match(leads, /\.notes-preview\{[^}]*-webkit-line-clamp:3;[^}]*overflow:hidden;[^}]*height:4\.2em;/);
  assert.match(leads, /<td data-label="הערות" class="notes-cell"><div class="notes-preview" title="\$\{esc\(l\.notes\|\|''\)\}">\$\{esc\(l\.notes\|\|'—'\)\}<\/div><\/td>/);
});
