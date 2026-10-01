import {chromium} from 'playwright';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const shots=process.env.PORTAL_SCREENSHOTS||os.tmpdir();
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const server=createServer(async(req,res)=>{try{let path=req.url.split('?')[0];if(path.endsWith('/'))path+='index.html';const type=path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.png')?'image/png':'text/html';res.setHeader('Content-Type',type);res.end(await readFile(repoRoot+path));}catch{res.statusCode=404;res.end();}});await new Promise(resolve=>server.listen(8766,'127.0.0.1',resolve));
const browser=await chromium.launch({...(process.env.PORTAL_TEST_CHROMIUM?{executablePath:process.env.PORTAL_TEST_CHROMIUM}:{}),headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--in-process-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--single-process']});
const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
for(const [name,width,height] of [['desktop',1440,1000],['tablet',820,1180],['mobile',390,844]]){
 await page.setViewportSize({width,height});await page.goto('http://127.0.0.1:8766/portal/');await page.waitForSelector('#loginForm');assert.ok(await page.locator('#loginPage h1').innerText());assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.getByRole('button',{name:'הצגת סיסמה',exact:true}).click();assert.equal(await page.locator('input[name=password]').getAttribute('type'),'text');
 await page.getByRole('button',{name:'שכחתי סיסמה',exact:true}).click();assert.equal(await page.locator('dialog').evaluate(d=>d.open),true);await page.getByRole('button',{name:'סגירה',exact:true}).click();
 await page.screenshot({path:`${shots}/login-${name}.png`,fullPage:true});
 // QA fixture only, never published or sent as a real client account.
 await page.evaluate(()=>{window.SELLER_PORTAL_CONFIG.apiUrl='https://isolated-qa.test';window.fetch=async(_url,options)=>{const b=JSON.parse(options.body);let data={ok:true};if(b.action==='login')data={ok:true,token:'QA-ONLY',must_change_password:false};if(b.action==='dashboard')data={ok:true,business:{internal_name:'סביבת בדיקה מבודדת',owner_name:'',owner_phone:'',city:''},files:[],matches:[],update:null,contact:{phone:''}};return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});};});
 await page.locator('input[name=username]').fill('23456');await page.locator('input[name=password]').fill('QA-only-password');await page.getByRole('button',{name:'כניסה לאזור האישי',exact:false}).click();await page.waitForSelector('#dashboard:not([hidden])');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.getByRole('button',{name:'המסמכים שלי',exact:true}).click();assert.equal(await page.locator('#documents').isVisible(),true);
 await page.getByRole('button',{name:'דף הבית',exact:true}).click();await page.screenshot({path:`${shots}/dashboard-${name}.png`,fullPage:true});
 await page.getByRole('button',{name:'שליחת הודעה',exact:true}).last().click();await page.waitForSelector('#messageForm');assert.equal(await page.evaluate(()=>{const d=document.querySelector('dialog').getBoundingClientRect();return d.right<=innerWidth&&d.left>=0&&d.bottom<=innerHeight&&d.top>=0;}),true);await page.getByRole('button',{name:'סגירה',exact:true}).click();await page.getByRole('button',{name:'יציאה מהאזור האישי',exact:true}).click();await page.waitForSelector('#loginPage:not([hidden])');assert.equal(await page.locator('#loginPage').isVisible(),true);
 console.log('PASS '+name+': login, password toggle, recovery dialog, dashboard, navigation, contact modal, logout, no horizontal overflow');
}
assert.deepEqual(errors,[]);console.log('PASS: no JavaScript page errors');await browser.close();server.close();
