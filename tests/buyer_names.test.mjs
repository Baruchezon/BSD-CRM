import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=f=>fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
const leads=read('leads.html');
const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function extract(source,start,end,ctx){vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf(start),source.indexOf(end)),ctx);return ctx;}
test('buyer identity retains full name alongside client number and escapes markup',()=>{
 const ctx=extract(leads,'function leadIdentityCell(','function userName(',{esc,isGrantOnlyViewer:()=>false,notesIconStyle:()=>false,ratingBadge:()=>'',matchCountBadge:()=>'',clientNumberBadge:l=>l.client_number});
 for(const name of ['ישראל ישראלי','שם ארוך מאוד של קונה עם כמה שמות משפחה','<script>']){
  const html=ctx.leadIdentityCell({id:'x',type:'buyer',client_number:'BSD-C-123'},name,'');
  assert.ok(html.includes('>'+esc(name)+'</span>'));assert.ok(html.includes('BSD-C-123'));assert.ok(!html.includes('<script>'));
 }
});
test('full-name-only buyer opens with a populated name and preserves it on save',()=>{
 const expression=leads.match(/fieldRow\('first_name','שם פרטי', (.*?)\)\}/)[1];
 for(const lead of [{full_name:'ישראל ישראלי'},{first_name:'ישראל',last_name:'ישראלי',full_name:'ישראל ישראלי'}]){
  const first=vm.runInNewContext(expression,{lead,pf:{}});
  assert.equal([first,lead.last_name].filter(Boolean).join(' '),lead.full_name);
 }
 assert.equal(vm.runInNewContext(expression,{lead:null,pf:{first_name:'חדש'}}),'חדש');
});
test('lead hub and matching labels include buyer names',()=>{
 const hub=extract(read('leads-hub.html'),'function rowNameCell(','function rowCityCell(',{esc,CURRENT_TAB:'buyer',ratingBadge:()=>''});
 assert.ok(hub.rowNameCell({full_name:'ישראל ישראלי'}).includes('ישראל ישראלי'));
 assert.ok(hub.rowNameCell({first_name:'ישראל',last_name:'ישראלי'}).includes('ישראל ישראלי'));
 const matches=extract(read('matches-workspace.html'),'function counterpartyLabelHtml(','function saveMatchesPageCache(',{esc,counterpartyOf:m=>({rec:m,isBroker:false})});
 const html=matches.counterpartyLabelHtml({full_name:'ישראל ישראלי',client_number:'BSD-C-123'});
 assert.ok(html.includes('ישראל ישראלי'));assert.ok(html.includes('BSD-C-123'));
});
