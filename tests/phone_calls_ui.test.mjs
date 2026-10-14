import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = rel => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

test('open existing card points at the buyers list, not the leads inbox', () => {
  const src = read('js/phoneCalls.js');
  assert.match(src, /const EXISTING_CARD = id => `leads\.html\?open=\$\{encodeURIComponent\(id\)\}`/);
  assert.match(src, /href="\$\{EXISTING_CARD\(id\)\}"/);
  assert.match(src, /leads-hub\.html\?open=/);
  assert.match(src, /queued:'ממתין לסיכום הקלטת שיחה'/);
  assert.match(src, /done:'סיכום מוכן'/);
  assert.match(src, /data-mode="view">צפייה/);
  assert.match(src, /data-mode="download">הורדה/);
  assert.match(src, /createSignedUrl/);
  assert.doesNotMatch(src, /מחקר/);
});

test('a buyer missing from the leads inbox opens on leads.html', async () => {
  const html = read('leads-hub.html');
  const start = html.indexOf('async function openDeepLink(');
  const code = html.slice(start, html.indexOf('function openWebsiteLead(', start));
  const hrefs = [];
  const c = {
    ALL_MANUAL: [], ALL_SELLERS: [],
    switchTab(){ throw new Error('inbox tab'); },
    openWebsiteLead(){ throw new Error('inbox card'); },
    renderWebsiteLeadConversationForm(){ throw new Error('advisor card'); },
    canEditRecord(){ return true; },
    history: { replaceState(){} },
    location: { pathname: '/leads-hub.html', set href(v){ hrefs.push(v); } },
    toast(){},
    window: { supabaseClient: { from(table){
      return { select(){ return this; }, eq(){ return this; }, limit(){ return this; },
        maybeSingle: async () => table === 'leads'
          ? { data: { id: 'old-buyer', type: 'buyer' } }
          : { data: [] } };
    } } }
  };
  vm.createContext(c);
  vm.runInContext(code + '\nopenDeepLink("old-buyer")', c);
  await new Promise(r => setTimeout(r, 0));
  assert.deepEqual(hrefs, ['leads.html?open=old-buyer']);
});

test('a new phone lead still opens inside the leads inbox', async () => {
  const html = read('leads-hub.html');
  const start = html.indexOf('async function openDeepLink(');
  const code = html.slice(start, html.indexOf('function openWebsiteLead(', start));
  const opened = [];
  const c = {
    ALL_MANUAL: [{ id: 'call-1', source: 'שיחה טלפונית נכנסת' }], ALL_SELLERS: [],
    switchTab(tab){ opened.push('tab:' + tab); },
    openWebsiteLead(id){ opened.push('card:' + id); },
    history: { replaceState(){} },
    location: { pathname: '/leads-hub.html' },
    window: { supabaseClient: { from(){ throw new Error('no fetch'); } } }
  };
  vm.createContext(c);
  await vm.runInContext(`(async () => { ${code}\n await openDeepLink('call-1'); })()`, c);
  assert.deepEqual(opened, ['tab:manual', 'card:call-1']);
});
