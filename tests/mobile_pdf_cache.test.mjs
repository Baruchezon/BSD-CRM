import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const config = fs.readFileSync(new URL('../js/config.js', import.meta.url), 'utf8');
const helperCode = config.slice(config.indexOf('window.BSDSessionCache'), config.indexOf('// Daily,'));

function runtime(userAgent = 'Android'){
  const values = new Map();
  const localStorage = {
    getItem:key => values.get(key) || null,
    setItem:(key, value) => values.set(key, String(value)),
    removeItem:key => values.delete(key)
  };
  const sandbox = {
    window:{}, localStorage, navigator:{userAgent}, setTimeout, clearTimeout,
    URL:{ createObjectURL:()=> 'blob:test', revokeObjectURL(){} }, Promise, Date, JSON, Error
  };
  sandbox.window.location = { assign:url => { sandbox.assigned = url; } };
  vm.createContext(sandbox);
  vm.runInContext(helperCode, sandbox);
  return { sandbox, values };
}

test('profile cache is user scoped, rejects blocked profiles and expires', () => {
  const { sandbox, values } = runtime();
  const session = { user:{id:'u1'} };
  sandbox.window.BSDSessionCache.write(session, { id:'u1', role:'admin', status:'active' });
  assert.equal(sandbox.window.BSDSessionCache.read(session).role, 'admin');
  assert.equal(sandbox.window.BSDSessionCache.read({user:{id:'u2'}}), null);

  const key = 'bsd-crm-profile-v2';
  const saved = JSON.parse(values.get(key));
  saved.profile.status = 'blocked';
  values.set(key, JSON.stringify(saved));
  assert.equal(sandbox.window.BSDSessionCache.read(session), null);

  saved.profile.status = 'active';
  saved.savedAt = Date.now() - 37 * 60 * 60 * 1000;
  values.set(key, JSON.stringify(saved));
  assert.equal(sandbox.window.BSDSessionCache.read(session), null);
});

test('Android PDF opening uses the current tab and retries after a stale session', async () => {
  const { sandbox } = runtime('Mozilla/5.0 Android');
  let attempts = 0, refreshes = 0, popups = 0;
  sandbox.window.open = () => { popups++; return null; };
  sandbox.window.supabaseClient = {
    auth:{ refreshSession:async()=>{ refreshes++; return {data:{}}; } },
    storage:{ from:()=>({
      createSignedUrl:async()=> ++attempts === 1
        ? {data:null,error:new Error('expired')}
        : {data:{signedUrl:'https://example.test/file.pdf'},error:null},
      download:async()=>({data:null,error:new Error('unused')})
    }) }
  };
  const ok = await sandbox.window.bsdOpenPrivateFile({bucket:'business-files',path:'b/file.pdf',label:'PDF'});
  assert.equal(ok, true);
  assert.equal(attempts, 2);
  assert.equal(refreshes, 1);
  assert.equal(popups, 0);
  assert.equal(sandbox.assigned, 'https://example.test/file.pdf');
});

test('all primary private PDF actions use the resilient opener', () => {
  const saleFiles = fs.readFileSync(new URL('../js/saleFileModule2.js', import.meta.url), 'utf8');
  const businesses = fs.readFileSync(new URL('../businesses.html', import.meta.url), 'utf8');
  assert.match(saleFiles, /viewSaleFile[\s\S]*bsdOpenPrivateFile/);
  assert.match(saleFiles, /downloadSaleFile[\s\S]*bsdOpenPrivateFile/);
  assert.match(businesses, /viewAnonFile[\s\S]*bsdOpenPrivateFile/);
  assert.match(businesses, /downloadBizFile[\s\S]*bsdOpenPrivateFile/);
});
