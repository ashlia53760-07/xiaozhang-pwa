// Real browser interactions, isolated IndexedDB and mocked API; no user data or paid calls.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const origin=process.env.LEISURE_TEST_URL||'http://127.0.0.1:5173';
const folder=new URL('../.local-review/leisure-ui/',import.meta.url);await mkdir(folder,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',hasTouch:true});
await context.addInitScript(()=>localStorage.setItem('xiaozhang-pet-position',JSON.stringify({x:10,y:400})));
const page=await context.newPage(),errors=[],checks=[],requests=[];
page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
await context.route('https://leisure-test.invalid/**',async route=>{requests.push(route.request().postDataJSON());await route.fulfill({contentType:'text/event-stream',body:`data: ${JSON.stringify({choices:[{delta:{content:'在路上。这里有信号，你说。'}}]})}\n\ndata: [DONE]\n\n`});});
function pass(name){checks.push(name);console.log('PASS',name)}
async function db(p,store,op,value){return p.evaluate(({store,op,value})=>new Promise((resolve,reject)=>{const open=indexedDB.open('xiaozhang-pwa');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const d=open.result,t=d.transaction(store,op==='put'?'readwrite':'readonly'),s=t.objectStore(store),r=op==='put'?s.put(value):op==='get'?s.get(value):s.getAll();let result;r.onsuccess=()=>result=r.result;t.oncomplete=()=>{d.close();resolve(result)};t.onabort=t.onerror=()=>reject(t.error);}}),{store,op,value});}
const get=async key=>(await db(page,'kv','get',key))?.value;
const put=async(key,value)=>db(page,'kv','put',{key,value});
async function reload(){await page.reload();await page.waitForFunction(()=>document.querySelector('#travel-open')&&document.querySelector('#send').textContent==='发送');await page.waitForTimeout(120);}
async function feature(id){if(!await page.locator('#topbar-menu').isVisible())await page.click('#topbar-menu-toggle');await page.click('#'+id);await page.waitForTimeout(100);}
async function openPlay(){await feature('play-open');await page.waitForSelector('#play-dialog[open]');}
async function close(id){await page.locator(`#${id}-dialog .dialog-head button`).click();await page.waitForSelector(`#${id}-dialog[open]`,{state:'hidden'});}
async function action(name){await page.locator(`#play-dialog [data-action="${name}"]`).click();await page.waitForTimeout(80);}
async function tab(name){await page.locator(`#play-dialog [data-action="game-tab"][data-id="${name}"]`).click();await page.waitForTimeout(80);}
async function settled(){await page.waitForTimeout(160);await page.waitForFunction(()=>!document.querySelector('#send').disabled);}
async function layout(selector){const g=await page.locator(selector).evaluate(el=>({w:el.clientWidth,sw:el.scrollWidth,rect:el.getBoundingClientRect().toJSON(),vw:innerWidth}));assert.ok(g.sw<=g.w+1&&g.rect.left>=0&&g.rect.right<=g.vw+1,JSON.stringify(g));}
try{
 await page.goto(origin);await page.waitForSelector('#travel-open',{state:'attached'});await page.waitForTimeout(150);
 await db(page,'messages','put',{id:'old-chat',role:'user',kind:'text',content:'旧聊天不会消失',sessionId:'private',createdAt:Date.now()-10000});
 await put('api-profile',{baseUrl:'https://leisure-test.invalid/v1',model:'mock-chat',apiKey:'synthetic-leisure-secret',temperature:.7,protocol:'openai'});
 await put('continuous-life',{id:'continuous-life',active:true,location:'旧书店',timeLabel:'傍晚',environment:'雨声',activity:'一起看书',updatedAt:Date.now()});
 await reload();
 const initial=await get('travel-state');assert.ok(initial.nextDepartureAt-Date.now()>6*86400000);
 // Autonomy: due schedule gives advance notice, never an immediate trip. An open scene defers departure.
 let planned=await get('travel-state');planned.nextDepartureAt=Date.now()-1000;await put('travel-state',planned);await reload();
 planned=await get('travel-state');assert.ok(planned.journey.plan);assert.equal(planned.currentId,undefined);
 planned.journey.plan.notBefore=Date.now()-1;await put('travel-state',planned);await reload();
 await feature('travel-open');await layout('#travel-dialog');
 assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('is-travelling')),false,'active local scene defers departure while the travel page is open');
 await close('travel');
 const life=await get('continuous-life');life.active=false;life.updatedAt=Date.now();await put('continuous-life',life);await reload();
 await page.waitForFunction(()=>document.documentElement.classList.contains('is-travelling'));
 let t=await get('travel-state');const tripId=t.currentId;assert.ok(tripId);assert.equal((await get('continuous-life')).location,'旧书店');assert.equal(await page.locator('#pet').isVisible(),false);
 await feature('meet-open');assert.equal(await page.locator('#meet-dialog').isVisible(),false);assert.match(await page.locator('#error').innerText(),/旅途/);
 await feature('date-open');assert.equal(await page.locator('#date-dialog').isVisible(),false);
 await page.fill('#draft','到哪里了？');await page.click('#send');await settled();assert.equal(requests.length,1);assert.match(requests[0].messages[0].content,/并不在用户身边/);assert.ok(requests[0].messages.every(m=>typeof m.content==='string'));
 pass('departure hides pet, pauses saved meeting/date, online text API uses real trip state');
 // Two tabs restore an overdue trip simultaneously: one atomic return, journal and item only.
 const second=await context.newPage();second.on('pageerror',e=>errors.push(e.message));
 t=await get('travel-state');const active=t.trips.find(x=>x.id===tripId);const base=Date.now()-4*86400000;active.startedAt=base;active.endsAt=base+active.timeline.durationMs;active.timeline.nextAt=base+active.timeline.durationMs*.24;await put('travel-state',t);
 await Promise.all([reload(),second.goto(origin)]);await second.waitForTimeout(200);
 t=await get('travel-state');assert.equal(t.currentId,undefined);assert.ok(t.trips.find(x=>x.id===tripId).returnedAt);
 assert.equal((await db(page,'messages','all')).filter(m=>m.id===tripId+':return').length,1);assert.equal((await db(page,'diary','all')).filter(d=>d.id==='travel-journal:'+tripId).length,1);
 await reload();assert.equal((await get('travel-state')).trips.length,1);assert.equal(await page.locator('#pet').isVisible(),true);await second.close();
 await feature('travel-open');await page.click('[data-action="welcome"]');assert.equal((await db(page,'messages','all')).filter(m=>m.id===tripId+':welcome').length,1);
 await page.click('#travel-dialog [data-action="travel-memory"]');await page.click('#travel-dialog [data-action="travel-share"]');
 assert.equal((await db(page,'memories','all')).filter(m=>m.id===tripId+':memory').length,1);assert.equal((await db(page,'moments','all')).filter(m=>m.id===tripId+':moment').length,1);
 assert.equal(await page.locator('[data-action="travel-memory"]').isDisabled(),true);
 // Upload an original generated local fixture. Pixels are user media, not AI vision input.
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=120;c.height=120;const g=c.getContext('2d');g.fillStyle='#b8c3b1';g.fillRect(0,0,120,120);g.fillStyle='#304237';g.fillRect(15,15,50,80);return c.toDataURL('image/png').split(',')[1]});
 await page.setInputFiles('#trip-photo',{name:'trip.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});await page.waitForSelector('.travel-photos img');
 t=await get('travel-state');const photo=t.trips.find(x=>x.id===tripId).photoIds[0];assert.equal((await db(page,'media','get',photo)).mime,'image/png');
 await close('travel');await page.fill('#draft','这次路上怎么样？');await page.click('#send');await settled();assert.match(requests.at(-1).messages[0].content,/最近已经保存/);
 pass('cross-tab overdue restore settles once; return, diary, optional memory/moment and original photo persist');
 // A deterministic ordinary trip fixture exercises an actual pending gift, even if this trip came back empty.
 t=await get('travel-state');if(!t.items.some(i=>i.owner==='user'&&i.status==='pending'))t.items.push({id:'fixture-gift',tripId,title:'路边木刻小鸟',category:'life',owner:'user',status:'pending',displayed:false,story:'手记中保留的普通纪念品。',acquisition:'本地测试数据',createdAt:Date.now()});await put('travel-state',t);await reload();
 await feature('travel-open');await page.click('#travel-dialog [data-action="journey-page"][data-id="collection"]');const giftId=(await get('travel-state')).items.find(i=>i.owner==='user'&&i.status==='pending').id;
 await page.click(`#travel-dialog [data-action="claim"][data-id="${giftId}"]`);await page.waitForTimeout(80);assert.equal((await get('travel-state')).items.find(i=>i.id===giftId).status,'kept');assert.equal((await db(page,'lifeEvents','all')).filter(e=>e.id===giftId+':gift').length,1);
 await page.click(`#travel-dialog [data-action="display"][data-id="${giftId}"]`);await page.waitForTimeout(100);await page.selectOption('#collection-filter','displayed');assert.equal(await page.locator(`[data-item-id="${giftId}"]`).count(),1);await page.click(`#travel-dialog [data-action="display"][data-id="${giftId}"]`);await page.waitForTimeout(100);assert.equal(await page.locator(`[data-item-id="${giftId}"]`).count(),0);await page.selectOption('#collection-filter','life');await page.click(`#travel-dialog [data-item-id="${giftId}"] [data-action="item-journal"]`);await page.waitForSelector('#travel-journal');await close('travel');
 pass('actual gift claim writes one life event, collection display/filter and source journal navigation work');
 await openPlay();await page.selectOption('#puzzle-image',photo);await page.selectOption('#puzzle-mode','solo');await action('puzzle-new');await page.waitForSelector('.puzzle-tile');await layout('#play-dialog');
 const before=(await get('play-state')).puzzle;const a=await page.locator('[data-action="puzzle-tile"][data-index="0"]').boundingBox(),b=await page.locator('[data-action="puzzle-tile"][data-index="1"]').boundingBox();
 assert.ok(a.height<150&&a.height>30,JSON.stringify(a));
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:8});await page.mouse.up();
 await page.waitForTimeout(180);let p=(await get('play-state')).puzzle;assert.equal(p.moves,1);assert.equal(p.tiles[1],before.tiles[0]);
 await page.waitForTimeout(450);await page.click('[data-action="puzzle-tile"][data-index="2"]');await page.click('[data-action="puzzle-tile"][data-index="3"]');
 assert.equal((await get('play-state')).puzzle.moves,2);
 await close('play');await reload();await openPlay();assert.equal((await get('play-state')).puzzle.moves,2);
 await close('play');let play=await get('play-state');play.puzzle.tiles=Array.from({length:9},(_,i)=>i);[play.puzzle.tiles[0],play.puzzle.tiles[1]]=[1,0];await put('play-state',play);await reload();await openPlay();
 await page.click('[data-action="puzzle-tile"][data-index="0"]');await page.click('[data-action="puzzle-tile"][data-index="1"]');
 play=await get('play-state');assert.ok(play.puzzle.completedAt);assert.equal(play.completions.length,1);assert.equal(play.completions[0].puzzle.image,photo);
 await page.click('.game-completions summary');await page.click('[data-action="game-memory"]');assert.equal((await db(page,'memories','all')).filter(m=>m.id===play.puzzle.id+':memory').length,1);
 await page.click('.game-setup summary');await action('puzzle-new');await page.click('.game-completions summary');await page.click('[data-action="puzzle-view"]');await page.waitForSelector('.completed-puzzle img');
 pass('real pointer drag, tap exchange, refresh restore, final puzzle collection and optional memory work');
 await tab('gomoku');await action('gomoku-new');await page.click('[data-action="gomoku-cell"][data-index="112"]');await page.waitForTimeout(900);
 play=await get('play-state');assert.equal(play.gomoku.moves,2);assert.equal(play.gomoku.board.filter(x=>x===1).length,1);assert.equal(play.gomoku.board.filter(x=>x===2).length,1);
 await close('play');play.gomoku.board=Array(225).fill(0);[0,1,2,3].forEach(i=>play.gomoku.board[i]=1);play.gomoku.turn=1;play.gomoku.moves=4;await put('play-state',play);await reload();await openPlay();await page.click('[data-action="gomoku-cell"][data-index="4"]');
 assert.equal((await get('play-state')).gomoku.winner,1);await page.waitForTimeout(700);assert.equal((await get('play-state')).gomoku.moves,5);
 pass('gomoku human black and local white alternate; completed five settles once and stops AI');
 await tab('flight');await page.selectOption('#flight-level','3');await page.selectOption('#flight-interaction','tease');await action('flight-new');await action('flight-roll');
 await page.waitForTimeout(40);play=await get('play-state');assert.ok(play.flight.rolls>=1);await close('play');await reload();await openPlay();
 assert.ok((await get('play-state')).flight.rolls>=play.flight.rolls);
 await close('play');play=await get('play-state');play.flight.turn=0;play.flight.pieces=[[57,56],[-1,-1]];play.flight.dice=1;play.flight.sixes=0;play.flight.event={id:'consent-event',text:'留下一句心动留言。',target:'张起灵',response:'他把骰子放好：你慢慢想。',variant:0};await put('play-state',play);await reload();await openPlay();
 await action('flight-change');assert.ok((await get('play-state')).flight.event.variant===1);await action('flight-skip');assert.equal((await get('play-state')).flight.event.skipped,true);
 await page.locator('.flight-hangars section').first().locator('[data-action="flight-piece"][data-index="1"]').click();assert.equal((await get('play-state')).flight.winner,0);
 assert.equal((await get('play-state')).completions.filter(c=>c.game==='flight').length,1);await layout('#play-dialog');
 pass('flight real dice, persisted turn, voluntary change/skip and final arrival settlement work');
 // All themes, narrow screens and desktop; screenshot real boards and computed tile styles.
 for(const theme of ['warm','ink','night'])for(const width of [320,390,1280]){await page.setViewportSize({width,height:844});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);await tab('puzzle');await layout('#play-dialog');assert.match(await page.locator('.puzzle-tile').first().evaluate(el=>getComputedStyle(el).backgroundImage),/blob:|landscapes/);await tab('gomoku');await layout('#play-dialog');await tab('flight');await layout('#play-dialog');}
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:fileURLToPath(new URL('flight-mobile.png',folder))});await tab('puzzle');await page.screenshot({path:fileURLToPath(new URL('puzzle-mobile.png',folder))});await close('play');
 pass('all three game boards fit 320/390/1280 widths under warm/ink/night themes');
 await feature('settings');const downloadEvent=page.waitForEvent('download');await page.click('#export-data');const download=await downloadEvent;const backup=JSON.parse(await readFile(await download.path(),'utf8'));
 assert.ok(backup.travel&&backup.play);assert.ok(backup.media.some(m=>m.id===photo));assert.ok(!JSON.stringify(backup).includes('synthetic-leisure-secret'));
 // Reimport old snapshot twice. Progress and memories remain unique.
 await page.setInputFiles('#import-data',{name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.waitForTimeout(300);
 await page.setInputFiles('#import-data',{name:'backup-again.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await page.waitForTimeout(300);
 assert.equal((await get('play-state')).completions.length,3);assert.equal((await get('travel-state')).trips.length,1);assert.ok(await db(page,'messages','get','old-chat'));
 const invalid={...backup,play:{version:999},messages:[{id:'invalid-not-imported',role:'user',content:'must not import',createdAt:Date.now()}]};
 await page.setInputFiles('#import-data',{name:'bad.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(invalid))});await page.waitForTimeout(200);assert.equal(await db(page,'messages','get','invalid-not-imported'),undefined);
 pass('backup includes travel/game/photo, omits keys; repeated import merges; malformed new state rejected before writes');
 assert.deepEqual(errors,[]);
 await writeFile(new URL('results.json',folder),JSON.stringify({passed:true,origin,checks,requests:requests.length,pageErrors:errors,physicalIOS:'not tested',liveModel:'not tested; mocked text API only'},null,2));
 console.log(`${checks.length} browser groups passed`);
}finally{await browser.close()}
