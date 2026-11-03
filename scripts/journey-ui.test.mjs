// Actual browser UI and IndexedDB. No user's data, GPS, API keys or paid model calls.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
const origin=process.env.JOURNEY_TEST_URL||'http://127.0.0.1:5173';
const folder=new URL('../.local-review/journey-ui/',import.meta.url);await mkdir(folder,{recursive:true});
for(const name of ['travel','journey','leisure-backup']){const source=await readFile(new URL(`../src/${name}.ts`,import.meta.url),'utf8');let output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replaceAll('"./travel"','"./travel.mjs"');await writeFile(new URL(name+'.mjs',folder),output);}
const {initialTravel}=await import(new URL('travel.mjs',folder)),{planJourney,beginJourney,advanceJourney}=await import(new URL('journey.mjs',folder)),{mergeTravel}=await import(new URL('leisure-backup.mjs',folder));
const browser=await chromium.launch({channel:'chrome',headless:true}),context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
async function db(p,store,op,value){return p.evaluate(({store,op,value})=>new Promise((resolve,reject)=>{const r=indexedDB.open('xiaozhang-pwa');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const d=r.result,t=d.transaction(store,op==='put'?'readwrite':'readonly'),s=t.objectStore(store),q=op==='put'?s.put(value):op==='get'?s.get(value):s.getAll();let data;q.onsuccess=()=>data=q.result;t.oncomplete=()=>{d.close();resolve(data)};t.onabort=()=>reject(t.error)}}),{store,op,value});}
const get=async key=>(await db(page,'kv','get',key))?.value,put=async(key,value)=>db(page,'kv','put',{key,value});
function pass(s){checks.push(s);console.log('PASS',s)}
async function ready(){await page.waitForSelector('#travel-open',{state:'attached'});await page.waitForTimeout(180);}
async function reload(){await page.reload();await ready()}
async function tick(){await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForTimeout(180)}
async function open(){if(!await page.locator('#topbar-menu').isVisible())await page.click('#topbar-menu-toggle');await page.click('#travel-open');await page.waitForSelector('#travel-dialog[open]')}
async function close(){await page.click('#travel-dialog .dialog-head button');await page.waitForTimeout(50)}
async function nav(id){await page.click(`#travel-dialog .journey-nav [data-id="${id}"]`);await page.waitForTimeout(70)}
async function layout(){const g=await page.locator('#travel-dialog form').evaluate(el=>({w:el.clientWidth,sw:el.scrollWidth,rect:el.getBoundingClientRect().toJSON(),vw:innerWidth}));assert.ok(g.sw<=g.w+1&&g.rect.left>=0&&g.rect.right<=g.vw+1,JSON.stringify(g));}
try{
 await page.goto(origin);await ready();assert.equal(await page.locator('#collection-open').count(),0);assert.equal(await page.locator('#travel-open').innerText(),'旅途');
 let s=await get('travel-state');s.nextDepartureAt=Date.now()-1000;await put('travel-state',s);await reload();s=await get('travel-state');const tripId=s.journey.plan.id,notice=s.journey.events.find(e=>e.kind==='notice');assert.equal(s.currentId,undefined);
 assert.equal((await db(page,'messages','all')).filter(m=>m.id===notice.letter.messageId).length,1);
 await open();await layout();await page.click('[data-action="journey-event"]');assert.match(await page.locator('.journey-feed').innerText(),/出发前的消息/);assert.equal(await page.locator('.journey-letter').count(),1);
 await nav('map');assert.match(await page.locator('.journey-page').innerText(),/尚未出发/);assert.equal(await page.locator('.journey-node').count(),0);
 await nav('settings');await page.selectOption('#travel-length','short');await page.fill('#travel-wish','路过时看看普通的木刻，不必特意找');await page.click('[data-action="travel-settings"]');assert.equal((await get('travel-state')).settings.lengthBias,'short');
 s=await get('travel-state');s.journey.plan.notBefore=Date.now()-1;await put('travel-state',s);await tick();assert.equal((await get('travel-state')).currentId,undefined);
 await close();await tick();s=await get('travel-state');assert.equal(s.currentId,tripId);assert.equal(s.journey.events.filter(e=>e.kind==='departure').length,1);assert.equal(await page.locator('#pet').isVisible(),false);await reload();assert.equal((await get('travel-state')).journey.events.filter(e=>e.kind==='notice').length,1);
 pass('single Journey entrance, advance notice, plan-only letter/map, persisted preferences and open-dialog departure deferral');
 let t=s.trips.find(t=>t.id===tripId);await page.clock.setSystemTime(t.timeline.nextAt+1);await tick();s=await get('travel-state');t=s.trips.find(t=>t.id===tripId);assert.equal(t.timeline.stage,1);
 await open();await nav('map');assert.equal(await page.locator('.journey-node').count(),2);const firstStage=s.journey.events.find(e=>e.id===tripId+':stage:1');
 await page.locator('.journey-node').nth(1).click();assert.equal(await page.locator(`[data-event-id="${firstStage.id}"]`).count(),1);assert.ok((await page.locator(`[data-event-id="${firstStage.id}"]`).innerText()).includes(firstStage.text));
 await page.locator(`[data-event-id="${firstStage.id}"] [data-action="event-map"]`).click();assert.equal(await page.locator('.journey-node.is-selected').count(),1);
 await nav('journals');assert.match(await page.locator('#travel-journal').innerText(),/仍在途中/);await page.click('.journey-journal-events summary');await page.click(`.journey-journal-events [data-id="${firstStage.id}"]`);assert.equal(await page.locator(`[data-event-id="${firstStage.id}"]`).count(),1);
 await close();await page.clock.setSystemTime(t.timeline.nextAt+1);await tick();s=await get('travel-state');t=s.trips.find(t=>t.id===tripId);assert.equal(t.timeline.stage,2);assert.equal(s.journey.events.filter(e=>e.node).length,3);await reload();assert.equal((await get('travel-state')).journey.events.filter(e=>e.node).length,3);
 pass('live checkpoints, canonical event navigation, map-to-feed-to-journal links and refresh deduplication');
 const before=(await db(page,'messages','all')).length;const second=await context.newPage();second.on('pageerror',e=>errors.push(e.message));await page.clock.setSystemTime(t.endsAt+86400000);await second.clock.setSystemTime(t.endsAt+86400000);
 await Promise.all([reload(),second.goto(origin)]);await second.waitForTimeout(200);s=await get('travel-state');t=s.trips.find(t=>t.id===tripId);assert.ok(t.returnedAt);assert.equal(s.currentId,undefined);assert.equal(s.journey.events.filter(e=>e.node).length,5);assert.equal((await db(page,'messages','all')).length,before+1);assert.equal((await db(page,'messages','all')).filter(m=>m.id===tripId+':return').length,1);assert.equal((await db(page,'diary','all')).filter(d=>d.id===t.journalId).length,1);await second.close();
 await open();await nav('map');assert.equal(await page.locator('.journey-node').count(),5);await nav('journals');assert.ok((await page.locator('#travel-journal').innerText()).includes(firstStage.text));
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=20;c.height=20;c.getContext('2d').fillRect(0,0,20,20);return c.toDataURL().split(',')[1]});
 await page.setInputFiles('#trip-photo',{name:'my-original.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await page.waitForSelector('.travel-photos img');s=await get('travel-state');const photo=s.journey.events.find(e=>e.kind==='photo');assert.equal(photo.mediaIds[0],s.trips.find(t=>t.id===tripId).photoIds[0]);await nav('events');assert.equal(await page.locator(`[data-photo-event="${photo.id}"] img`).count(),1);
 await nav('collection');await layout();assert.ok(await page.locator('#journey-collection #collection-filter').count());
 await nav('home');await page.click('[data-action="welcome"]');assert.equal((await db(page,'messages','all')).filter(m=>m.id===tripId+':welcomed').length,1);await close();await reload();assert.equal(await page.locator('#pet').isVisible(),true);
 pass('two-tab restoration settles once, suppresses missed letter burst, retains full route, original photo association and return interaction');
 // Restore a real locally generated past trip fixture with a cross-trip thread, preserving current data.
 let fixture;
 for(let i=0;i<100;i++){const at=Date.now()-10*86400000,v=initialTravel(at-20*86400000,1);v.nextDepartureAt=at;planJourney(v,at,'thread-ui-'+i);beginJourney(v,v.journey.plan.notBefore);advanceJourney(v,at+5*86400000);if(v.journey.threads.length){fixture=v;break}}
 assert.ok(fixture);s=await get('travel-state');mergeTravel(s,fixture);await put('travel-state',s);await reload();await open();await nav('threads');const thread=fixture.journey.threads[0];assert.ok((await page.locator(`[data-thread-id="${thread.id}"]`).innerText()).includes(thread.title));
 await page.selectOption(`[data-thread-status="${thread.id}"]`,'parked');await page.waitForTimeout(100);assert.equal((await get('travel-state')).journey.threads.find(t=>t.id===thread.id).status,'parked');
 await page.locator(`[data-thread-id="${thread.id}"] [data-action="journey-event"]`).first().click();assert.equal(await page.locator(`[data-event-id="${thread.sourceEventId}"]`).count(),1);await close();await reload();await open();await nav('threads');assert.equal(await page.locator(`[data-thread-status="${thread.id}"]`).inputValue(),'parked');
 await page.selectOption(`[data-thread-status="${thread.id}"]`,'resolved');await page.waitForTimeout(100);await page.selectOption(`[data-thread-status="${thread.id}"]`,'abandoned');await page.waitForTimeout(100);assert.equal((await get('travel-state')).journey.threads.find(t=>t.id===thread.id).status,'abandoned');
 for(const theme of ['warm','ink','night'])for(const width of [320,390,1280]){
 await page.setViewportSize({width,height:844});await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
 for(const p of ['home','map','events','journals','collection','threads','settings']){await nav(p);await layout();}
 }
 await page.setViewportSize({width:390,height:844});await nav('map');await page.screenshot({path:fileURLToPath(new URL('map-mobile.png',folder))});await nav('events');await page.screenshot({path:fileURLToPath(new URL('events-mobile.png',folder))});
 pass('source-linked ongoing matters support all statuses and persist; every Journey tab fits 320/390/1280px in three themes');
 assert.deepEqual(errors,[]);await writeFile(new URL('results.json',folder),JSON.stringify({passed:true,origin,checks,pageErrors:errors,physicalIOS:'not tested',liveAI:'not used; local travel progression only'},null,2));
}catch(error){
 console.log(await page.locator('.journey-node').evaluateAll(nodes=>nodes.map(el=>{const r=el.getBoundingClientRect(),c=getComputedStyle(el);return {rect:r.toJSON(),pointer:c.pointerEvents,z:c.zIndex,transform:c.transform,clip:c.clipPath,disabled:el.disabled,hit:document.elementsFromPoint(r.x+r.width/2,r.y+r.height/2).map(n=>n.tagName+'.'+n.className).slice(0,8)}})));
 await page.screenshot({path:fileURLToPath(new URL('failure.png',folder))});throw error;
}finally{await browser.close()}
