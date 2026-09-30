import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../js/archiveModule.js',import.meta.url),'utf8');
function setup({accepted=true,error=null,deleted=true,linked={}}={}){
 const calls=[],invalidated=[];let message;
 const s={CURRENT_PROFILE:{id:'u1'},confirm:text=>{message=text;return accepted},window:{BSDDataCache:{remove:(key)=>invalidated.push(key)},supabaseClient:{rpc:async(name,args)=>{calls.push(args);return args.p_confirm?{data:{deleted,id:'r1'},error}:{data:{id:'r1',deleted:false,linked},error:null}}}}};
 vm.createContext(s);vm.runInContext(source,s);return {run:()=>s.deleteArchivedRecord('leads','r1'),calls,invalidated,message:()=>message};
}
test('cancel after dependency preview makes no delete request',async()=>{const h=setup({accepted:false});assert.equal(await h.run(),false);assert.equal(h.calls.length,1);assert.equal(h.invalidated.length,0)});
test('confirmed deletion clears both entity caches',async()=>{const h=setup();assert.equal(await h.run(),true);assert.equal(h.calls.length,2);assert.ok(h.invalidated.includes('rows:businesses'));assert.ok(h.invalidated.includes('rows:leads'))});
test('VIP consequences are shown before deletion',async()=>{const h=setup({accepted:false,linked:{vip_accounts:1,matches:2}});await h.run();assert.match(h.message(),/VIP/);assert.match(h.message(),/הגישה שלו תופסק/);assert.equal(h.calls.length,1)});
for(const options of [{error:{message:'permission denied'}},{deleted:false}])test('server failure leaves local records intact '+JSON.stringify(options),async()=>{const h=setup(options);await assert.rejects(h.run());assert.equal(h.invalidated.length,0)});
