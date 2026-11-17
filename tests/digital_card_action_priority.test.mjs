import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const publicHtml=readFileSync(new URL('../digital-card.html',import.meta.url),'utf8');
const managerHtml=readFileSync(new URL('../digital-cards.html',import.meta.url),'utf8');

test('public card puts saving and sharing immediately below dark header',()=>{
  const page=publicHtml.match(/<div class="content">([\s\S]*?)<\/main>/)?.[1];
  assert.ok(page);
  assert.ok(page.indexOf('id="bottom"')>=0);
  assert.ok(page.indexOf('id="bottom"')<page.indexOf('id="mainActions"'));
  assert.ok(publicHtml.includes('bottomButton("הוסף לאנשי הקשר"'));
  assert.ok(publicHtml.includes('bottomButton("שתף כרטיס"'));
});
test('WhatsApp is a secondary tile, not a primary button',()=>{
  assert.ok(publicHtml.includes('makeTile("וואטסאפ"'));
  assert.ok(!publicHtml.includes('makeBig("שלח וואטסאפ"'));
  assert.ok(publicHtml.includes('makeBig("התקשר אליי"'));
});
test('downloaded HTML shows the same priority',()=>{
  const downloaded=managerHtml.match(/function offlineHtml\(c\)\{([\s\S]*?)\n\}\nfunction formData/)?.[1];
  assert.ok(downloaded);
  assert.ok(downloaded.includes('class="top-actions"'));
  assert.ok(downloaded.includes('contactDownload'));
  assert.ok(downloaded.includes('shareWhatsApp'));
  assert.ok(downloaded.includes("detailLink('וואטסאפ'"));
  assert.ok(downloaded.indexOf('class="top-actions"') < downloaded.indexOf('class="tagline"'));
});
