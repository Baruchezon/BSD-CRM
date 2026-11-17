// Regression coverage for displayed telephone numbers in the BSD CRM agent card module.
// Run: node --test tests/digital_card_phone_format.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pages=[
  {path:'digital-card.html',helper:'clean'},
  {path:'digital-cards.html',helper:'tidy'}
];
const cases=[
  ['0542424999','054-2424999'],
  ['054-2424999','054-2424999'],
  ['0774446707','077-4446707'],
  ['077-4446707','077-4446707'],
  ['+972542424999','054-2424999'],
  ['00972774446707','077-4446707'],
  ['050 123 4567','050-1234567'],
  ['035555555','03-5555555'],
  ['02-1234567','02-1234567'],
  ['+12125551212','+12125551212'],
  ['','']
];

for(const p of pages){
 const content=fs.readFileSync(path.join(root,p.path),'utf8');
 const found=content.match(/function formatPhone\(v\)\{[\s\S]*?^\}/m);
 assert.ok(found,'Formatter function missing from '+p.path);
 const context={};
 vm.runInNewContext(
   'const '+p.helper+'=s=>String(s||"").trim();\n'+found[0]+'\nthis.formatPhone=formatPhone',
   context,{timeout:1000}
 );
 test(p.path+' shows a hyphen after the Israeli prefix',()=>{
   for(const [input,expected] of cases){
     assert.equal(context.formatPhone(input),expected,input);
   }
 });
}
test('Public links still use international dialable numbers',()=>{
 const content=fs.readFileSync(path.join(root,'digital-card.html'),'utf8');
 assert.match(content,/tel:\+"\+office/);
 assert.match(content,/https:\/\/wa\.me\/"\+wa/);
 assert.match(content,/formatPhone\(c\.phone_office\|\|c\.phone_mobile\)/);
 assert.match(content,/formatPhone\(c\.whatsapp_number\|\|c\.phone_mobile\)/);
});
test('Manager applies formatting to save, search, share input and offline HTML',()=>{
 const content=fs.readFileSync(path.join(root,'digital-cards.html'),'utf8');
 assert.match(content,/forEach\(k=>data\[k\]=formatPhone\(data\[k\]\)\)/);
 assert.match(content,/formatPhone\(c\.phone_office\|\|c\.phone_mobile\)/);
 assert.match(content,/new Option\(name\+' \| '\+formatPhone\(p\),p\)/);
 assert.match(content,/recipientPhone'.*formatPhone\(\$\(id\)\.value\)/);
});
