// Built preview + actual Service Worker, old v2 data and network-off restoration.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
const origin=process.env.LEISURE_TEST_URL||'http://127.0.0.1:4173';
const folder=new URL('../.local-review/leisure-offline/',import.meta.url);await mkdir(folder,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
// Seed before the app modules run; isolated browser profile, never a user's database.
await context.addInitScript(()=>{
 localStorage.setItem('xiaozhang-pet-position',JSON.stringify({x:10,y:400}));
 if(sessionStorage.getItem('v2-seeded'))return;
 const open=indexedDB.open('xiaozhang-pwa',2);
 open.onupgradeneeded=()=>{const d=open.result;d.createObjectStore('kv',{keyPath:'key'});const m=d.createObjectStore('messages',{keyPath:'id'});m.createIndex('createdAt','createdAt');for(const s of ['media','stickers','memories','experiences','moments','affection'])d.createObjectStore(s,{keyPath:'id'});};
 open.onsuccess=()=>{const d=open.result,t=d.transaction(['kv','messages','memories'],'readwrite');t.objectStore('messages').put({id:'v2-message',role:'user',kind:'text',content:'升级前的聊天',createdAt:Date.now(),sessionId:'private'});t.objectStore('memories').put({id:'v2-memory',content:'升级前的记忆',enabled:true,source:'user',category:'偏好',createdAt:Date.now(),updatedAt:Date.now()});t.objectStore('kv').put({key:'character-settings',value:{userName:'旧称呼',userPreferences:'保留旧设置',relationship:'一起生活',customPrompt:'',worldBook:'',updatedAt:Date.now()}});t.oncomplete=()=>{d.close();sessionStorage.setItem('v2-seeded','1')};};
});
const page=await context.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message)});page.on('requestfailed',r=>console.log('REQUESTFAILED',r.url(),r.failure()?.errorText));page.on('dialog',d=>d.accept());
async function state(){return page.evaluate(()=>new Promise((resolve,reject)=>{const r=indexedDB.open('xiaozhang-pwa');r.onsuccess=()=>{const d=r.result,t=d.transaction(['kv','messages','memories'],'readonly'),out={version:d.version};for(const s of ['kv','messages','memories'])t.objectStore(s).getAll().onsuccess=e=>out[s]=e.target.result;t.oncomplete=()=>{d.close();resolve(out)}};r.onerror=()=>reject(r.error)}));}
async function feature(id){if(!await page.locator('#topbar-menu').isVisible())await page.click('#topbar-menu-toggle');await page.click('#'+id);}
async function close(id){await page.locator(`#${id}-dialog .dialog-head button`).click();}
try{
 await page.goto(origin);await page.waitForSelector('#play-open',{state:'attached'});await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>sessionStorage.getItem('v2-seeded')==='1');
 const before=await state();assert.equal(before.version,4);assert.ok(before.messages.some(m=>m.id==='v2-message'));assert.ok(before.memories.some(m=>m.id==='v2-memory'));assert.equal(before.kv.find(k=>k.key==='character-settings').value.userName,'旧称呼');
 const entries=await page.evaluate(async()=>{const names=(await caches.keys()).filter(n=>n.startsWith('xiaozhang-pwa-shell-'));const c=await caches.open(names.at(-1));return(await c.keys()).map(r=>r.url)});assert.ok(entries.some(x=>x.endsWith('/landscapes/mountain.svg')));assert.ok(entries.some(x=>/\/assets\/.+\.js$/.test(x)));
 await feature('play-open');await page.selectOption('#puzzle-mode','solo');await page.click('[data-action="puzzle-new"]');await page.click('[data-action="puzzle-tile"][data-index="0"]');await page.click('[data-action="puzzle-tile"][data-index="1"]');await close('play');
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await context.setOffline(true);await page.reload();await page.waitForSelector('#play-open',{state:'attached'});assert.match(await page.locator('#messages').innerText(),/升级前的聊天/);
 await feature('play-open');await page.waitForSelector('.puzzle-tile');assert.equal((await state()).kv.find(k=>k.key==='play-state').value.puzzle.moves,1);
 const image=await page.locator('.puzzle-tile').first().evaluate(el=>getComputedStyle(el).backgroundImage);assert.match(image,/mountain.svg/);
 assert.equal(await page.evaluate(async()=>{const r=await fetch('/landscapes/mountain.svg');return r.ok&&r.headers.get('content-type').includes('svg')}),true);
 await page.click('[data-action="puzzle-tile"][data-index="2"]');await page.click('[data-action="puzzle-tile"][data-index="3"]');assert.equal((await state()).kv.find(k=>k.key==='play-state').value.puzzle.moves,2);
 await page.click('[data-action="game-tab"][data-id="gomoku"]');await page.click('[data-action="gomoku-new"]');await page.click('[data-action="gomoku-cell"][data-index="112"]');await page.waitForTimeout(800);assert.equal((await state()).kv.find(k=>k.key==='play-state').value.gomoku.moves,2);await close('play');
 await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('xiaozhang-pwa');r.onsuccess=()=>{const d=r.result,t=d.transaction('kv','readwrite'),s=t.objectStore('kv');s.get('travel-state').onsuccess=e=>{const v=e.target.result;v.value.nextDepartureAt=Date.now()-1000;s.put(v)};t.oncomplete=()=>{d.close();resolve()}}}));
 await page.reload();await page.waitForSelector('#travel-open',{state:'attached'});
 await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('xiaozhang-pwa');r.onsuccess=()=>{const d=r.result,t=d.transaction('kv','readwrite'),s=t.objectStore('kv');s.get('travel-state').onsuccess=e=>{const v=e.target.result;v.value.journey.plan.notBefore=Date.now()-1;s.put(v)};t.oncomplete=()=>{d.close();resolve()}}}));
 await page.reload();await page.waitForFunction(()=>document.documentElement.classList.contains('is-travelling'));
 await page.reload();assert.equal(await page.locator('#pet').isVisible(),false);assert.ok((await state()).kv.find(k=>k.key==='travel-state').value.currentId);
 await context.setOffline(false);await page.reload();assert.equal((await state()).kv.find(k=>k.key==='travel-state').value.trips.length,1);
 const final=await state();assert.ok(final.messages.some(m=>m.id==='v2-message'));assert.ok(final.memories.some(m=>m.id==='v2-memory'));assert.deepEqual(errors,[]);
 const results={passed:true,origin,oldV2UpgradePreserved:true,realServiceWorkerOffline:true,offlineLandscape:true,offlinePuzzleAndAI:true,offlineTripRestore:true,noDuplicateDeparture:true,physicalIOS:'not tested'};await writeFile(new URL('results.json',folder),JSON.stringify(results,null,2));console.log(results);
}finally{await browser.close()}
