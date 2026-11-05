import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../matches-workspace.html', import.meta.url), 'utf8');
const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  .map(m=>m[1]).find(s=>s.includes('let CURRENT_PROFILE'))
  .replace(/\(async function init\(\)\{[\s\S]*?\}\)\(\);/, '');
function setup(){
  const elements = new Map();
  const context = {
    document: {
      getElementById(id){
        if (!elements.has(id)) elements.set(id, {innerHTML:'', addEventListener(){}, querySelectorAll(){ return []; }});
        return elements.get(id);
      },
      querySelectorAll(){ return []; }
    },
    window: {addEventListener(){}, searchSelectHTML(){return '';}, initSearchSelect(id, users, options){ context.creatorOptions = options; }},
  };
  vm.createContext(context);
  vm.runInContext(script, context);
  vm.runInContext(`
    ALL_PROFILES={u1:{id:'u1',full_name:'סימון'},u2:{id:'u2',full_name:'רגינה'}};
    ALL_BUSINESSES={b1:{id:'b1',internal_name:'עסק משותף'},b2:{id:'b2',internal_name:'עסק אחר'}};
    ALL_LEADS=[{id:'l1',full_name:'קונה ראשון'},{id:'l2',full_name:'קונה שני'}];
    ALL_MATCHES=[
      {id:'m1',business_id:'b1',buyer_id:'l1',created_by:'u1',current_handler:'u2',status:'התאמה חדשה'},
      {id:'m2',business_id:'b1',buyer_id:'l2',created_by:'u2',current_handler:'u1',status:'התאמה חדשה'},
      {id:'m3',business_id:'b2',buyer_id:'l2',created_by:null,status:'התאמה חדשה'}
    ];
    buildCreatorFilter();
  `, context);
  return {context, elements, run: code=>vm.runInContext(code, context)};
}
test('select creator by ID, distinguish handler, keep only their branches in either grouping, clear', ()=>{
  const {context, elements, run} = setup();
  context.creatorOptions.onChange('u1');
  assert.equal(run('filteredMatches().map(m=>m.id).join()'), 'm1');
  assert.match(elements.get('mainContent').innerHTML, /data-match="m1"/);
  assert.doesNotMatch(elements.get('mainContent').innerHTML, /data-match="m2"|data-node="biz:b2"/);
  run("currentView='buyer'; render();");
  assert.match(elements.get('mainContent').innerHTML, /data-match="m1"/);
  assert.doesNotMatch(elements.get('mainContent').innerHTML, /data-match="m2"|data-node="buyer:l2"/);
  context.creatorOptions.onChange('all');
  assert.equal(run('filteredMatches().length'), 3);
});
test('creator combines with text, status and quick filters; no unrelated empty groups', ()=>{
  const {context, elements, run} = setup();
  context.creatorOptions.onChange('u1');
  run("searchTerm='עסק אחר'; render();");
  assert.match(elements.get('mainContent').innerHTML, /לא נמצאו/);
  run("currentView='buyer'; searchTerm='קונה שני'; render();");
  assert.match(elements.get('mainContent').innerHTML, /לא נמצאו/);
  run("searchTerm='קונה ראשון'; render();");
  assert.equal(run('filteredMatches().length'), 1);
  run("searchTerm=''; statFilter='done';");
  assert.equal(run('filteredMatches().length'), 0);
  run("statFilter=''; activeQuickView='test'; matchMatchesQuickView=()=>false;");
  assert.equal(run('filteredMatches().length'), 0);
});
