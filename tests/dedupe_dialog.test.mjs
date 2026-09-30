import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../js/dedupeCheckModule.js',import.meta.url),'utf8');
function dialog(role, level='phone'){
 const nodes=new Map();let overlay;
 const document={createElement(){overlay={style:{},removed:false,remove(){this.removed=true},querySelector:s=>nodes.get(s.slice(1)),querySelectorAll:()=>[]};Object.defineProperty(overlay,'innerHTML',{set(html){this.html=html;for(const [,id] of html.matchAll(/id="([^"]+)"/g))nodes.set(id,{value:'',addEventListener(type,fn){this[type]=fn}})}});return overlay},body:{appendChild(){}}};
 const sandbox={document,window:{},esc:String};vm.createContext(sandbox);
 vm.runInContext(`let CURRENT_PROFILE = ${JSON.stringify(role?{id:'u1',role}:null)};`+source,sandbox);
 const promise=sandbox.bsdShowDupConfirmDialog({matches:[{id:'old',full_name:'Existing',match_level:level}]});
 return {nodes,overlay,promise};
}
for(const role of ['admin','manager'])for(const level of ['phone','email'])test(`${role} may continue despite ${level} match with a lexical profile`,async()=>{
 const d=dialog(role,level);assert.ok(d.nodes.has('bsdDupOverrideBtn'));
 d.nodes.get('bsdDupOverrideBtn').click();const result=await d.promise;
 assert.equal(result.action,'override');assert.ok(result.reason.length);assert.equal(d.overlay.removed,true);
});
test('duplicate continuation keeps a custom note',async()=>{const d=dialog('admin');d.nodes.get('bsdDupOverrideReason').value='Pilot card';d.nodes.get('bsdDupOverrideBtn').click();assert.equal((await d.promise).reason,'Pilot card')});
for(const role of ['agent',null])test(`unauthorized profile ${role} cannot override`,async()=>{const d=dialog(role);assert.equal(d.nodes.has('bsdDupOverrideBtn'),false);d.nodes.get('bsdDupCancelBtn').click();assert.equal((await d.promise).action,'cancel')});
