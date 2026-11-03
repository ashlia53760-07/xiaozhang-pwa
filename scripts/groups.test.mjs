// Isolated IndexedDB and synthetic API responses. No production data or paid requests.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const origin=process.env.CONTACT_TEST_URL || 'http://127.0.0.1:4175';
const folder=new URL('../.local-review/contact-expansion-20261025/groups/',import.meta.url);
await mkdir(folder,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
const page=await context.newPage(), calls=[], errors=[], checks=[];
page.on('pageerror',e=>errors.push(e.message));
const check=name=>{checks.push(name);console.log('PASS',name);};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
let failName='',delayName='',emptyName='',release;
await context.route('https://group-test.invalid/**',async route=>{
  const body=route.request().postDataJSON();
  const name=body.messages[0].content.match(/只以“([^”]+)”身份发言/)?.[1];
  calls.push({body,name});
  if(name===delayName) { delayName=''; await new Promise(resolve=>{release=resolve;}); }
  if(name===failName) { failName='';return route.fulfill({status:503,body:'unavailable'}); }
  if(name===emptyName) {emptyName='';return route.fulfill({contentType:'application/json',body:'{"choices":[{"message":{"content":null}}]}'});}
  return route.fulfill({contentType:'text/event-stream',body:`data: {"choices":[{"delta":{"content":null}}]}\n\ndata: ${JSON.stringify({choices:[{delta:{content:`${name}接住了你的话。`}}]})}\n\ndata: [DONE]\n\n`});
});
async function db(store,value,target=page) {
  return target.evaluate(({store,value})=>new Promise((resolve,reject)=>{
    const o=indexedDB.open('xiaozhang-pwa');o.onerror=()=>reject(o.error);o.onsuccess=()=>{const d=o.result,t=d.transaction(store,value===undefined?'readonly':'readwrite'),r=value===undefined?t.objectStore(store).getAll():t.objectStore(store).put(value);t.oncomplete=()=>{d.close();resolve(r.result);};t.onerror=()=>reject(t.error);};
  }),{store,value});
}
const ready=()=>page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
const idle=()=>page.waitForFunction(()=>!document.querySelector('#send').disabled);
const close=id=>page.locator(id).evaluate(el=>el.close());
async function send(text){await page.fill('#draft',text);await page.click('#send');await idle();}
async function rows(){return (await db('messages')).filter(m=>m.sessionId===groupId).sort((a,b)=>a.createdAt-b.createdAt);}
async function group(){return (await db('groups')).find(g=>g.id===groupId);}
async function waitGroup(target=page,condition='exists') {
  for(let i=0;i<300;i++) {const g=(await db('groups',undefined,target)).find(g=>g.id===groupId);if(condition==='selected'?g?.selectedMemberIds?.includes('xie-yuchen'):condition==='all'?g?.replyMode==='all':!!g)return;await new Promise(r=>setTimeout(r,30));}
  throw Error(`Timed out waiting for persisted group: ${condition}`);
}
async function tools(id){await page.locator(`[data-message-id="${id}"] .bubble`).dispatchEvent('contextmenu');}
async function continueBatch() { const session = (await db('kv')).find(v => v.key === 'active-session').value; const turn = (await db('messages')).filter(m => m.sessionId === session && m.role === 'user').sort((a,b) => a.createdAt-b.createdAt).at(-1); await tools(turn.id); await page.click(`[data-retry-id="${turn.id}"]`); await idle(); }
async function library(tab='memories'){await page.click('#conversation-details');await page.click('#group-library-open');await page.click(`[data-group-tab="${tab}"]`);}
let groupId;
try {
  await page.clock.install();
  await context.addInitScript(()=>{localStorage.setItem('xiaozhang-auto-moments','false');localStorage.setItem('xiaozhang-auto-diary','false');localStorage.setItem('xiaozhang-proactive-enabled','false');localStorage.setItem('xiaozhang-pet-position',JSON.stringify({x:10,y:400}));});
  await page.goto(origin);await ready();
  await db('kv',{key:'api-profile',value:{baseUrl:'https://group-test.invalid/v1',model:'synthetic',apiKey:'SYNTHETIC_GROUP_KEY',temperature:.4,protocol:'openai'}});
  await db('kv',{key:'character-settings',value:{userName:'PRIVATE_NICKNAME',relationship:'PRIVATE_RELATION',worldBook:'PRIVATE_WORLDBOOK',customPrompt:'PRIVATE_PROMPT',updatedAt:1}});
  await db('memories',{id:'private-memory',content:'PRIVATE_MEMORY',source:'user',enabled:true,createdAt:1,updatedAt:1});
  await db('messages',{id:'private-msg',content:'PRIVATE_CHAT',role:'user',kind:'text',createdAt:1});
  await db('groups',{id:'legacy-group',title:'旧群',members:[{id:'old-a',name:'吴邪',persona:'旧设定',enabled:true}],createdAt:1,updatedAt:1});
  await page.reload();await ready();
  await page.click('#contacts-back');await page.click('#group-create-open');
  assert.equal(await page.locator('[data-group-contact]').count(),16);
  await page.click('#group-save');assert.match(await page.locator('#group-editor-status').textContent(),/至少选择/);
  for(const id of ['zhang-qiling','wu-xie','wang-pangzi','xie-yuchen'])await page.locator(`[data-group-contact="${id}"]`).check();
  await page.fill('#group-title','晚饭后的闲聊');
  await page.click('#group-settings-details summary');
  await page.fill('#group-user-name','小月');await page.fill('#group-background','PUBLIC_BACKGROUND');await page.fill('#group-world-book','PUBLIC_WORLDBOOK');await page.fill('[data-group-relation="zhang-qiling"]','PUBLIC_RELATION');await page.selectOption('#group-reply-limit','6');
  await page.setInputFiles('#group-avatar-file',{name:'group.png',mimeType:'image/png',buffer:png});
  await page.screenshot({path:new URL('group-create-mobile.png',folder).pathname.replace(/^\/(\w:)/,'$1')});
  await page.click('#group-save');await page.waitForFunction(()=>document.querySelector('#conversation-name').textContent==='晚饭后的闲聊');
  groupId=(await db('groups')).find(g=>g.title==='晚饭后的闲聊').id;
  assert.equal((await group()).members.length,4);assert.ok((await group()).avatarMediaId);assert.equal(await page.locator('#group-controls').isVisible(),true);
  await page.reload();await ready();assert.equal(await page.locator('#conversation-name').textContent(),'晚饭后的闲聊');
  check('phone-style contact selection, group avatar, public relations and active group persist; legacy group untouched');

  await send('今晚吃什么？');assert.equal(calls.length,2);
  for(const c of calls){const p=JSON.stringify(c.body);assert.doesNotMatch(p,/PRIVATE_NICKNAME|PRIVATE_RELATION|PRIVATE_WORLDBOOK|PRIVATE_PROMPT|PRIVATE_MEMORY|PRIVATE_CHAT/);assert.match(p,/PUBLIC_BACKGROUND|PUBLIC_WORLDBOOK/);assert.match(p,/铁三角友情不写成恋爱/);assert.ok(c.body.messages.every(m=>typeof m.content==='string'));}
  assert.match(JSON.stringify(calls[1].body),new RegExp(calls[0].name+'接住了你的话'));
  check('natural two-person turn, later speaker sees earlier response; text-only public context and otome boundaries');
  await page.click('#group-mention-open');await page.click('[data-mention-name="吴邪"]');assert.match(await page.inputValue('#draft'),/@吴邪/);
  const n=calls.length;await send('@吴邪 帮我看一下');assert.equal(calls.length,n+1);assert.equal(calls.at(-1).name,'吴邪');
  const quoted=(await rows()).filter(m=>m.role==='assistant').at(-1);await tools(quoted.id);await page.click(`[data-group-quote="${quoted.id}"]`);assert.equal(await page.locator('#group-quote-bar').isVisible(),true);
  await send('你接着说');const u=(await rows()).filter(m=>m.role==='user').at(-1);assert.equal(u.metadata.groupQuote.messageId,quoted.id);assert.equal(calls.at(-1).name,'吴邪');assert.match(JSON.stringify(calls.at(-1).body),/引用吴邪的群内消息/);assert.equal(await page.locator('#group-quote-bar').isVisible(),false);
  await page.reload();await ready();assert.equal(await page.locator('.group-message-quote').count(),1);
  check('@ picker targets one speaker; quoted text and original ID survive reload without repeated injection');

  await tools(quoted.id);await page.click(`[data-group-favorite="${quoted.id}"]`);
  assert.equal((await group()).favorites.length,1);assert.equal((await group()).memories?.length??0,0);
  await page.click(`[data-group-save-memory="${quoted.id}"]`);assert.equal((await group()).memories?.length??0,0);
  await page.fill('#group-memory-content','PUBLIC_MEMORY 我们约好周末商量晚饭');await page.click('#group-memory-form button[type=submit]');
  await page.waitForFunction(()=>document.querySelector('#group-library-list').textContent.includes('PUBLIC_MEMORY'));
  let mem=(await group()).memories[0];assert.equal(mem.source,'conversation');assert.deepEqual(mem.messageIds,[quoted.id]);
  await close('#group-library-dialog');await close('#group-editor-dialog');await send('@张起灵 周末有什么安排');assert.match(JSON.stringify(calls.at(-1).body),/PUBLIC_MEMORY/);
  await library();await page.click(`[data-group-memory-edit="${mem.id}"]`);await page.fill('#group-memory-content','EDITED_PUBLIC_MEMORY');await page.click('#group-memory-form button[type=submit]');await page.waitForFunction(()=>document.querySelector('#group-library-list').textContent.includes('EDITED_PUBLIC_MEMORY'));
  await page.click(`[data-group-memory-toggle="${mem.id}"]`);await page.waitForFunction(()=>document.querySelector('#group-library-list').textContent.includes('已停用'));await close('#group-library-dialog');await close('#group-editor-dialog');await send('@张起灵 继续聊');assert.doesNotMatch(JSON.stringify(calls.at(-1).body),/EDITED_PUBLIC_MEMORY/);
  await library('messages');await page.fill('#group-library-query','你接着说');assert.match(await page.locator('#group-library-list').textContent(),/你接着说/);assert.doesNotMatch(await page.locator('#group-library-list').textContent(),/PRIVATE_CHAT/);await close('#group-library-dialog');await close('#group-editor-dialog');
  check('favorites do not become memory implicitly; explicit common-memory save/edit/disable and group-only search work');

  await page.selectOption('#group-quick-mode','selected');await page.waitForSelector('#group-mention-dialog[open]');await page.locator('[data-group-target="xie-yuchen"]').check();await page.click('#group-targets-save');
  await waitGroup(page,'selected');
  let before=calls.length;await send('帮我安排一下');assert.equal(calls.length,before+1,JSON.stringify({group:await group(),error:await page.locator('#error').textContent()}));assert.equal(calls.at(-1).name,'解雨臣');
  emptyName='解雨臣';await send('空回复异常验证');const emptyTurn=(await rows()).filter(m=>m.role==='user').at(-1);assert.equal((await rows()).filter(m=>m.metadata?.replyToUserId===emptyTurn.id).length,0);assert.match(await page.locator('#error').textContent(),/没有返回文字/);
  await page.selectOption('#group-quick-mode','all');await waitGroup(page,'all');failName='吴邪';before=calls.length;await send('大家都说说吧');
  const turn=(await rows()).filter(m=>m.role==='user').at(-1);assert.equal(calls.length,before+4);assert.equal((await rows()).filter(m=>m.metadata?.replyToUserId===turn.id).length,3);assert.match(await page.locator('#error').textContent(),/吴邪/);
  await tools(turn.id);await page.click(`[data-retry-id="${turn.id}"]`);await idle();assert.equal(calls.length,before+5);assert.equal((await rows()).filter(m=>m.metadata?.replyToUserId===turn.id).length,4);
  assert.equal(new Set((await rows()).filter(m=>m.metadata?.replyToUserId===turn.id).map(m=>m.metadata.groupMemberId)).size,4);
  check('selected and all modes work; per-member 503 recovery preserves completed replies without duplication');

  delayName='张起灵';await page.fill('#draft','暂停这一次');await page.click('#send');await page.waitForFunction(()=>document.querySelector('#group-typing').textContent.includes('张起灵'));
  // Typing can now include a pacing wait. This case must abort an actual HTTP
  // request, rather than leaving the synthetic provider's delayed reply armed.
  const requestDeadline=Date.now()+10000;
  while(!release && Date.now()<requestDeadline) await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(release,'delayed HTTP request must have started before testing abort');
  await page.click('#group-stop');await idle();if(release){release();release=undefined;}
  const stopped=(await rows()).filter(m=>m.role==='user').at(-1);assert.ok(stopped.metadata.groupStopped);assert.equal((await rows()).filter(m=>m.metadata?.replyToUserId===stopped.id).length,0);
  await tools(stopped.id);await page.click(`[data-retry-id="${stopped.id}"]`);await idle();assert.equal((await rows()).filter(m=>m.metadata?.replyToUserId===stopped.id).length,4);
  check('stop aborts the active request and queue; resume fills only pending members');

  // Write the real blob within the page, rather than serializing it through evaluate.
  await page.evaluate(bytes=>new Promise(resolve=>{const o=indexedDB.open('xiaozhang-pwa');o.onsuccess=()=>{const d=o.result,t=d.transaction('media','readwrite');t.objectStore('media').put({id:'group-sticker-media',blob:new Blob([new Uint8Array(bytes)],{type:'image/png'}),mime:'image/png',createdAt:1});t.oncomplete=()=>{d.close();resolve();};};}),[...png]);
  await db('stickers',{id:'group-sticker',mediaId:'group-sticker-media',label:'点头',description:'表示同意',tags:['同意'],createdAt:1});
  await page.locator('#sticker-choose').evaluate(el=>el.click());await page.click('[data-sticker-send-assistant="group-sticker"]');await page.click('[data-sticker-speaker="wang-pangzi"]');await close('#sticker-dialog');
  let sticker=(await rows()).at(-1);assert.equal(sticker.speakerId,'王胖子');assert.equal(sticker.mediaId,'group-sticker-media');await page.waitForFunction(()=>Array.from(document.querySelectorAll('.message-media')).some(i=>i.complete&&i.naturalWidth>0));
  await page.locator('#sticker-choose').evaluate(el=>el.click());await page.click('[data-sticker-send-user="group-sticker"]');await close('#sticker-dialog');await idle();assert.match(JSON.stringify(calls.at(-1).body),/点头（表示同意；标签：同意）/);assert.ok(calls.at(-1).body.messages.every(m=>typeof m.content==='string'));
  check('both user and selected group member send actual stored stickers; only true metadata enters chat API');

  await context.setOffline(true);await library();await page.fill('#group-memory-content','OFFLINE_COMMON_MEMORY');await page.click('#group-memory-form button[type=submit]');await page.waitForFunction(()=>document.querySelector('#group-library-list').textContent.includes('OFFLINE_COMMON_MEMORY'));await close('#group-library-dialog');await close('#group-editor-dialog');
  await context.setOffline(false);await page.reload();await ready();assert.ok((await group()).memories.some(m=>m.content==='OFFLINE_COMMON_MEMORY'));
  await library();await page.click(`[data-group-memory-delete="${mem.id}"]`);await close('#group-library-dialog');await close('#group-editor-dialog');assert.ok(!(await group()).memories.some(m=>m.id===mem.id));
  check('local memory CRUD works without network and persists across reload; deletion leaves unrelated records intact');

  const download=page.waitForEvent('download');await page.locator('#export-data').evaluate(el=>el.click());const file=await download;const backupText=await readFile(await file.path(),'utf8'),backup=JSON.parse(backupText);
  assert.doesNotMatch(backupText,/SYNTHETIC_GROUP_KEY/);const saved=backup.groups.find(g=>g.id===groupId);assert.ok(saved.memories.length);assert.ok(saved.favorites.length);assert.ok(backup.media.some(m=>m.id===saved.avatarMediaId));
  const fresh=await browser.newContext({serviceWorkers:'block'}),restored=await fresh.newPage();await restored.goto(origin);await restored.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
  await restored.locator('#import-data').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(backupText)});await waitGroup(restored);
  // Wait for import's final view/draft hydration, not just the first persisted record.
  await restored.waitForFunction(()=>document.querySelector('#conversation-name').textContent==='晚饭后的闲聊'&&document.querySelector('#messages [data-message-id]'));
  const restoredGroups=await db('groups',undefined,restored),recovered=restoredGroups.find(g=>g.id===groupId);assert.ok(recovered,JSON.stringify({groupId,restoredGroups,error:await restored.locator('#error').textContent()}));assert.equal(recovered.avatarMediaId,saved.avatarMediaId);assert.deepEqual(recovered.memories,saved.memories);assert.ok((await db('messages',undefined,restored)).some(m=>m.metadata?.groupQuote));
  await fresh.setOffline(true);await restored.fill('#draft','未配置接口的离线陪伴');await restored.click('#send');await restored.waitForFunction(()=>!document.querySelector('#send').disabled);assert.match(await restored.locator('#messages').textContent(),/未配置接口的离线陪伴/);assert.match(await restored.locator('#messages').textContent(),/本地预设回应/);assert.match(await restored.locator('#error').textContent(),/未配置聊天接口/);await fresh.close();
  await page.locator('#import-data').setInputFiles({name:'conflict.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...backup,groups:backup.groups.map(g=>({...g,title:'SHOULD_NOT_OVERWRITE'}))}))});await waitGroup();assert.equal((await group()).title,'晚饭后的闲聊');
  check('backup restores group avatar, public memories, favorites and quotes without credentials; merge preserves local conflicts');
  assert.equal(recovered.replyLimit,6);

  await close('#settings-dialog');await page.click('#contacts-back');await page.click(`[data-group-id="${groupId}"]`);
  const all=await rows();for(const m of all)await db('messages',{...m,createdAt:Date.now()-30*60_000});await db('groups',{...await group(),proactive:true,proactiveClaimedAt:0});
  before=calls.length;await page.clock.fastForward(61_000);await page.waitForFunction(()=>document.querySelector('#messages [data-event="group_proactive"]'));await idle();assert.equal(calls.length,before+1);assert.equal((await rows()).filter(m=>m.metadata?.event==='group_proactive').length,1);
  await page.clock.fastForward(2*60*60_000);await idle();assert.equal(calls.length,before+1);
  await page.fill('#draft','我正在打字');await page.clock.fastForward(5*60*60_000);await idle();assert.equal(calls.length,before+1);await page.fill('#draft','');
  await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'}));await page.clock.fastForward(61_000);assert.equal(calls.length,before+1);
  await page.evaluate(()=>Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'}));await page.clock.fastForward(61_000);await page.waitForFunction(()=>document.querySelectorAll('#messages [data-event="group_proactive"]').length===2);await idle();assert.equal(calls.length,before+2);
  check('opt-in foreground proactive chat: four-hour cooldown, no interruption while drafting or hidden, no backlog flood');

  await db('groups',{id:'other-public-group',title:'另一群',members:[{id:'other-zhang',name:'张起灵',persona:'原著',enabled:true,relationship:'OTHER_PUBLIC_RELATION'}],createdAt:1,updatedAt:1});
  await page.click('#contacts-back');await page.click('[data-group-edit="other-public-group"]');await page.waitForSelector('#group-editor-dialog[open]');assert.equal(await page.inputValue('[data-group-relation="zhang-qiling"]'),'OTHER_PUBLIC_RELATION');await close('#group-editor-dialog');await close('#session-dialog');
  await page.click('#conversation-details');await page.waitForSelector('#group-editor-dialog[open]');assert.equal(await page.inputValue('[data-group-relation="zhang-qiling"]'),'PUBLIC_RELATION');await close('#group-editor-dialog');
  check('reopening profiles for different groups cannot carry the previous group relationship into the next editor');

  await page.click('#conversation-details');await page.waitForSelector('#group-editor-dialog[open]');
  for(const id of ['hei-xiazi','zhang-haike','liu-sang'])await page.locator(`[data-group-contact="${id}"]`).check();
  await page.selectOption('#group-activity','lively');await page.selectOption('#group-reply-mode','natural');await page.selectOption('#group-reply-limit','6');await page.click('#group-save');await page.waitForSelector('#group-editor-dialog[open]',{state:'detached'});
  await page.reload();await ready();assert.equal((await group()).replyLimit,6);assert.equal((await group()).members.length,7);
  before=calls.length;await send('大家都说说吧');assert.equal(calls.length,before+4);await continueBatch();assert.equal(calls.length,before+6);assert.equal(new Set(calls.slice(before).map(c=>c.name)).size,6);
  await page.click('#conversation-details');await page.waitForSelector('#group-editor-dialog[open]');assert.equal(await page.inputValue('#group-reply-limit'),'6');await page.selectOption('#group-reply-limit','2');await page.click('#group-save');await page.waitForSelector('#group-editor-dialog[open]',{state:'detached'});
  before=calls.length;await send('大家都说说今晚的安排');assert.equal(calls.length,before+2);
  await page.click('#conversation-details');await page.waitForSelector('#group-editor-dialog[open]');await page.selectOption('#group-reply-limit','');await page.click('#group-save');await page.waitForSelector('#group-editor-dialog[open]',{state:'detached'});
  before=calls.length;await send('大家都说说吧');assert.equal(calls.length,before+4);await continueBatch();assert.equal(calls.length,before+7);assert.equal(new Set(calls.slice(before).map(c=>c.name)).size,7);
  check('seven-member lively chat keeps six-person and two-person settings; full seven-person plan completes through bounded batches');

  await page.click('#contacts-back'); await page.click('#group-create-open');
  await page.fill('#group-title', '十六人新群');
  for (const member of await page.locator('[data-group-contact]').all()) await member.check();
  await page.click('#group-settings-details summary');
  await page.selectOption('#group-reply-mode', 'all');
  await page.selectOption('#group-reply-limit', '16'); await page.click('#group-save');
  await page.waitForFunction(() => document.querySelector('#conversation-name').textContent === '十六人新群');
  before = calls.length; await send('大家都说说吧');
  assert.equal(calls.length - before, 4);
  await page.reload(); await ready(); await continueBatch();
  assert.equal(calls.length - before, 8);
  await continueBatch();
  assert.equal(calls.length - before, 12);
  await continueBatch();
  assert.equal(calls.length - before, 16);
  for (const name of ['阿宁','霍秀秀','张海盐','张海虾','张海琪','汪灿','黎簇','苏万','杨好']) {
    const call = calls.slice(before).find(c => c.name === name);
    assert.ok(call); assert.match(call.body.messages[0].content, /原著人物底稿/);
    assert.doesNotMatch(JSON.stringify(call.body), /PRIVATE_MEMORY|PRIVATE_CHAT|PRIVATE_PROMPT/);
  }
  await page.reload(); await ready();
  assert.equal(await page.locator('#conversation-name').textContent(), '十六人新群');
  check('sixteen selected contacts persist; all sixteen reply with new canon profiles and no private context leakage');

  await page.clock.resume();await page.waitForTimeout(800);
  await page.screenshot({path:new URL('group-chat-mobile.png',folder).pathname.replace(/^\/(\w:)/,'$1')});await page.click('#conversation-details');
  const fit=await page.locator('#group-editor-dialog').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,viewport:innerWidth}));assert.ok(fit.scroll<=fit.width+1&&fit.width<=fit.viewport);
  await close('#group-editor-dialog');await page.setViewportSize({width:1280,height:900});await page.screenshot({path:new URL('group-chat-desktop.png',folder).pathname.replace(/^\/(\w:)/,'$1')});
  assert.deepEqual(errors,[]);assert.ok((await db('messages')).some(m=>m.id==='private-msg'));assert.ok((await db('groups')).some(g=>g.id==='legacy-group'));check('390px profile layout and desktop render; original private/legacy data preserved; no uncaught JS errors');
  await writeFile(new URL('test-results.json',folder),JSON.stringify({checks,requests:calls.length,errors},null,2));console.log(`groups: ${checks.length} checks passed, ${calls.length} mocked requests`);
} finally {if(release)release();await context.close();await browser.close();}
