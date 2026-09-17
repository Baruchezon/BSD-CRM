import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('VIP UI observer does not rewrite the navigation link on unrelated mutations', async () => {
  const source = await readFile(new URL('../../js/vip-ui-fixes.js', import.meta.url), 'utf8');
  let observerCallback;
  let linkWrites = 0;

  const link = {
    dataset: { vipAdminLink: '1' },
    style: {},
    href: 'vip-admin.html',
    _text: '⭐ ניהול לקוחות VIP',
    get textContent() { return this._text; },
    set textContent(value) { linkWrites += 1; this._text = value; }
  };
  const menu = {
    querySelector: () => link,
    insertBefore() { throw new Error('existing VIP link must be reused'); },
    firstChild: null
  };
  const toolsWrap = { querySelector: () => menu };
  const document = {
    readyState: 'complete',
    body: {},
    getElementById: id => id === 'navToolsWrap' ? toolsWrap : null,
    querySelectorAll: () => [],
    createElement: () => ({ dataset: {}, style: {} })
  };
  class MutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe() {}
  }

  vm.runInNewContext(source, { document, MutationObserver, console });
  assert.equal(linkWrites, 0, 'initialization should not rewrite an already correct link');

  const unrelatedNode = { nodeType: 1, matches: () => false, querySelectorAll: () => [] };
  observerCallback([{ addedNodes: [unrelatedNode] }]);
  assert.equal(linkWrites, 0, 'an unrelated DOM mutation must not start a mutation loop');
});

test('VIP UI observer refines a dynamically inserted VIP box once', async () => {
  const source = await readFile(new URL('../../js/vip-ui-fixes.js', import.meta.url), 'utf8');
  let observerCallback;
  let textWrites = 0;
  const label = {
    _text: 'קובץ אנונימי מאושר',
    get textContent() { return this._text; },
    set textContent(value) { textWrites += 1; this._text = value; }
  };
  const box = {
    nodeType: 1,
    matches: selector => selector === '[data-vip-crm-box]',
    querySelectorAll: selector => selector === 'label, option, div, span' ? [label] : []
  };
  const document = {
    readyState: 'complete',
    body: {},
    getElementById: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ dataset: {}, style: {} })
  };
  class MutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe() {}
  }

  vm.runInNewContext(source, { document, MutationObserver, console });
  observerCallback([{ addedNodes: [box] }]);
  assert.equal(label.textContent, 'הגרסה המלאה של התקציר האנונימי');
  assert.equal(textWrites, 1);

  observerCallback([{ addedNodes: [box] }]);
  assert.equal(textWrites, 1, 'an already refined VIP box must not be rewritten');
});
