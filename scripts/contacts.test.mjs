// All requests and IndexedDB data belong to isolated browser contexts, never the live site.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const origin = process.env.CONTACT_TEST_URL || 'http://127.0.0.1:4174';
const folder = new URL('../.local-review/contact-expansion-20261025/contacts/', import.meta.url);
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
await context.addInitScript(() => localStorage.setItem('xiaozhang-pet-position', JSON.stringify({ x: 10, y: 400 })));
const page = await context.newPage();
const errors = [], checks = [], calls = [];
page.on('pageerror', error => errors.push(error.message));
const check = (name) => { checks.push(name); console.log('PASS', name); };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const wav=Buffer.alloc(16044); wav.write('RIFF',0); wav.writeUInt32LE(16036,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(8000,24); wav.writeUInt32LE(16000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(16000,40);
let responseMode = 'ok', releaseDelayed;
await context.route('https://contacts-test.invalid/**', async route => {
  if(route.request().method()==='GET') return route.fulfill({contentType:'audio/wav',body:wav});
  const body = route.request().postDataJSON(); calls.push({ url: route.request().url(), body });
  const mode = responseMode; responseMode = 'ok';
  if (mode === 'delay') await new Promise(resolve => { releaseDelayed = resolve; });
  if (mode === 'failure') return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":{"message":"synthetic unavailable"}}' });
  if (mode === 'empty') return route.fulfill({ contentType: 'application/json', body: '{"choices":[{"message":{"content":null}}]}' });
  const name = JSON.stringify(body).includes('你扮演《盗墓笔记》原著基础上的吴邪') ? '吴邪' : JSON.stringify(body).includes('你扮演《盗墓笔记》原著基础上的解雨臣') ? '解雨臣' : '当前角色';
  let text = `${name}的测试回复，来自当前会话。`;
  if (mode === 'wrapped') text = `<think>internal reasoning</think><content>${text}</content>`;
  if (route.request().url().includes('streamGenerateContent')) return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({candidates:[{content:{parts:[{text}]}}]})}\n\n` });
  return route.fulfill({ contentType: 'text/event-stream', body: `data: {"choices":[{"delta":{"content":null,"reasoning_content":"not display"}}]}\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: text.slice(0, 4) } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: text.slice(4) } }] })}\n\ndata: [DONE]\n\n` });
});
async function db(store, value, target = page) {
  return target.evaluate(({ store, value }) => new Promise((resolve, reject) => {
    const open = indexedDB.open('xiaozhang-pwa'); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const d = open.result, t = d.transaction(store, value === undefined ? 'readonly' : 'readwrite'); const r = value === undefined ? t.objectStore(store).getAll() : t.objectStore(store).put(value); t.oncomplete = () => { d.close(); resolve(r.result); }; t.onerror = () => reject(t.error); };
  }), { store, value });
}
async function ready() { await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true'); }
async function contacts(id) { await page.click('#contacts-back'); await page.locator(`[data-contact-id="${id}"]`).click(); await page.waitForFunction(id => document.querySelector('#draft').placeholder.includes(id), ({'wu-xie':'吴邪','zhang-qiling':'张起灵','xie-yuchen':'解雨臣','hei-xiazi':'黑瞎子','liu-sang':'刘丧','wang-pangzi':'王胖子','zhang-haike':'张海客','a-ning':'阿宁','huo-xiuxiu':'霍秀秀','zhang-haiyan':'张海盐','zhang-haixia':'张海虾','zhang-haiqi':'张海琪','wang-can':'汪灿','li-cu':'黎簇','su-wan':'苏万','yang-hao':'杨好'})[id]); }
async function send(text) { await page.fill('#draft', text); await page.click('#send'); await idle(); }
async function idle() { await page.waitForFunction(() => !document.querySelector('#send').disabled); }
async function close(id) { await page.locator(id).evaluate(el => el.close()); }
async function openButton(id) { await page.locator(id).evaluate(el => el.click()); }
const api = { baseUrl:'https://contacts-test.invalid/global', model:'synthetic', apiKey:'GLOBAL_TEST_SECRET', temperature:0.4, protocol:'openai' };
try {
  // Seed the real old v2 shape before loading any application JS.
  await context.route(`${origin}/__contact_seed`, route => route.fulfill({ contentType:'text/html', body:'<!doctype html><title>Isolated legacy seed</title>' }));
  await page.goto(`${origin}/__contact_seed`);
  await page.evaluate(api => new Promise((resolve, reject) => {
    localStorage.setItem('xiaozhang-auto-moments', 'false'); localStorage.setItem('xiaozhang-auto-diary', 'false'); localStorage.setItem('xiaozhang-proactive-enabled', 'false');
    const o = indexedDB.open('xiaozhang-pwa', 2); o.onerror = () => reject(o.error);
    o.onupgradeneeded = () => { const d=o.result; for(const name of ['kv','messages','media','stickers','memories','experiences','moments','affection']) {const s=d.createObjectStore(name,{keyPath:name==='kv'?'key':'id'});if(name==='messages')s.createIndex('createdAt','createdAt');} };
    o.onsuccess=()=>{const d=o.result,t=d.transaction(['kv','messages','memories'],'readwrite'); t.objectStore('kv').put({key:'api-profile',value:api}); t.objectStore('kv').put({key:'character-settings',value:{userName:'张的旧称呼',userPreferences:'',relationship:'已有关系',customPrompt:'张的私有设定',worldBook:'',updatedAt:1}});t.objectStore('messages').put({id:'legacy-msg',role:'user',kind:'text',content:'张的旧聊天秘密',createdAt:1});t.objectStore('memories').put({id:'legacy-memory',content:'张的旧记忆秘密',category:'旧记忆',source:'user',enabled:true,createdAt:1,updatedAt:1});t.oncomplete=()=>{d.close();resolve();};};
  }), api);
  await page.goto(origin); await ready();
  assert.match(await page.locator('#messages').textContent(), /张的旧聊天秘密/);
  assert.equal(await page.evaluate(() => new Promise(r => {const o=indexedDB.open('xiaozhang-pwa');o.onsuccess=()=>{r(o.result.version);o.result.close();};})),4);
  await page.click('#contacts-back'); await page.waitForSelector('#session-dialog[open]'); assert.equal(await page.locator('[data-contact-id]').count(),17);
  await page.screenshot({path:new URL('contacts-mobile.png',folder).pathname.replace(/^\/(\w:)/,'$1')});
  assert.equal(calls.length,0); check('legacy v2 preserved, seventeen current contacts, no welcome API calls');
  await page.locator('[data-contact-id="wu-xie"]').click();
  assert.equal(await page.locator('#messages .message-row').count(),0);
  await page.fill('#draft','吴邪的草稿'); await contacts('zhang-qiling'); await page.fill('#draft','张的草稿'); await contacts('wu-xie');
  assert.equal(await page.inputValue('#draft'),'吴邪的草稿'); await page.reload(); await ready();
  assert.equal(await page.inputValue('#draft'),'吴邪的草稿'); assert.equal(await page.locator('#conversation-name').textContent(),'吴邪'); check('private drafts and active contact restore independently');
  await page.click('#conversation-details'); await page.waitForSelector('#role-dialog[open]');
  assert.equal(await page.inputValue('#role-user-name'),''); assert.equal(await page.inputValue('#role-relationship-mode'),'friendship');
  await page.fill('#role-user-name','吴的独立称呼'); await page.fill('#role-custom-prompt','吴的私有设定'); await page.selectOption('#role-relationship-mode','romance');
  await page.setInputFiles('#role-life-prompt-file',{name:'life-scene.txt',mimeType:'text/plain',buffer:Buffer.from('只在线下使用的导入补充：保留现场细节。')});
  await page.fill('#role-date-prompt','只在约会剧场使用的独立氛围补充。');
  await page.fill('#role-date-xp','偏好慢热、克制的关系推进；不接受替我决定行动。');
  await page.fill('#role-date-observer','场外要求：维持电影感，重要转场留白。');
  await page.fill('#role-date-style','文法要求：第三人称现场描写，动作和对白自然交错。');
  assert.equal(await page.inputValue('#role-life-prompt'),'只在线下使用的导入补充：保留现场细节。');
  await page.click('.contact-api summary'); await page.locator('#contact-api-enabled').check(); await page.fill('#contact-api-url','https://contacts-test.invalid/wu'); await page.fill('#contact-api-model','wu-model'); await page.fill('#contact-api-key','WU_TEST_SECRET');
  await page.locator('#character-avatar-choose').evaluate(el=>el.click()); await page.setInputFiles('#character-avatar-input',{name:'portrait.png',mimeType:'image/png',buffer:png});
  await page.waitForFunction(()=>document.querySelector('#role-save-status').textContent.includes('已保存'));
  await page.click('#role-save'); await page.waitForSelector('#role-dialog:not([open])', {state:'attached'});
  await page.reload(); await ready(); await page.click('#conversation-details'); await page.waitForSelector('#role-dialog[open]');
  assert.equal(await page.inputValue('#role-life-prompt'),'只在线下使用的导入补充：保留现场细节。'); assert.equal(await page.inputValue('#role-date-prompt'),'只在约会剧场使用的独立氛围补充。');
  assert.equal(await page.inputValue('#role-date-xp'),'偏好慢热、克制的关系推进；不接受替我决定行动。');
  assert.equal(await page.inputValue('#role-date-observer'),'场外要求：维持电影感，重要转场留白。');
  assert.equal(await page.inputValue('#role-date-style'),'文法要求：第三人称现场描写，动作和对白自然交错。');
  await page.click('#role-save'); await page.waitForSelector('#role-dialog:not([open])', {state:'attached'}); check('scene prompt import, per-contact persistence and refresh restore');
  await page.click('#conversation-details'); await page.click('#contact-memory-open'); await page.waitForSelector('#settings-dialog[open]');
  assert.match(await page.locator('#memory-scope').textContent(),/吴邪/); assert.doesNotMatch(await page.locator('#memory-list').textContent(),/张的旧记忆/);
  await page.fill('#memory-input','吴的独立记忆秘密'); await page.click('#save-memory'); await page.waitForFunction(()=>document.querySelector('#memory-list').textContent.includes('吴的独立记忆秘密')); await close('#settings-dialog');
  await send('吴邪第一轮');
  let request=calls.at(-1); assert.match(request.url,/\/wu\/chat\/completions$/); assert.equal(request.body.model,'wu-model');
  let payload=JSON.stringify(request.body); assert.match(payload,/吴的独立称呼/); assert.match(payload,/吴的独立记忆秘密/); assert.match(payload,/感情向相处/); assert.doesNotMatch(payload,/张的旧聊天秘密|张的旧记忆秘密|张的私有设定/);
  assert.ok(request.body.messages.every(m=>typeof m.content==='string')); assert.doesNotMatch(await page.locator('#messages').textContent(),/null|not display/);
  assert.equal(await page.locator('#messages img[alt="吴邪"]').count(),1); check('independent persona, settings, memories, API override, portrait and null-safe SSE');
  responseMode='delay'; await page.fill('#draft','延迟回复归属'); await page.click('#send'); await page.waitForFunction(()=>document.querySelector('#send').disabled);
  while(!releaseDelayed) await new Promise(r=>setTimeout(r,20));
  await contacts('xie-yuchen'); releaseDelayed(); releaseDelayed=undefined; await idle();
  assert.equal(await page.locator('#messages .message-row').count(),0);
  await page.click('#contacts-back'); await page.waitForSelector('#session-dialog[open]'); assert.match(await page.locator('[data-contact-id="wu-xie"] .contact-tail').textContent(),/1/); await page.locator('[data-contact-id="wu-xie"]').click(); await page.waitForFunction(()=>document.querySelector('#draft').placeholder.includes('吴邪'));
  assert.match(await page.locator('#messages').textContent(),/延迟回复归属/); assert.equal((await db('messages')).filter(m=>m.sessionId==='private:wu-xie'&&m.role==='assistant').length,2); check('delayed reply stays with initiating contact and unread clears on reading');
  await contacts('xie-yuchen'); responseMode='failure'; await send('失败不伪造回复'); assert.match(await page.locator('#error').textContent(),/503/); assert.equal(await page.locator('#messages .assistant').count(),0);
  await page.locator('[data-retry-id]').evaluate(el=>el.click()); await idle(); assert.equal(await page.locator('#messages .message-row.user').count(),1); assert.equal(await page.locator('#messages .message-row.assistant').count(),1);
  responseMode='empty'; await send('空回复不保存'); assert.match(await page.locator('#error').textContent(),/没有返回文字/); assert.equal(await page.locator('#messages .message-row.assistant').count(),1); check('503 and null replies are not saved; retry does not duplicate user message');
  await contacts('zhang-qiling'); await send('张的后续'); payload=JSON.stringify(calls.at(-1).body); assert.match(payload,/张的旧记忆秘密/); assert.doesNotMatch(payload,/吴的独立记忆秘密|吴的私有设定|失败不伪造回复/);
  await contacts('liu-sang'); await send('刘丧你好'); assert.match(JSON.stringify(calls.at(-1).body),/刘丧/);
  await contacts('hei-xiazi'); await send('黑瞎子你好'); assert.match(JSON.stringify(calls.at(-1).body),/黑瞎子/); check('remaining contacts use global API with independent identity and history');
  for (const [id, name] of [['wang-pangzi','王胖子'],['zhang-haike','张海客'],['a-ning','阿宁'], ['huo-xiuxiu','霍秀秀'], ['zhang-haiyan','张海盐'], ['zhang-haixia','张海虾'], ['zhang-haiqi','张海琪']]) { await contacts(id); await send(`${name}你好`); const body=JSON.stringify(calls.at(-1).body); assert.match(body,new RegExp(`你扮演《盗墓笔记》原著基础上的${name}`)); assert.doesNotMatch(body,/吴的独立记忆秘密|张的旧记忆秘密|吴的私有设定/); }
  for (const [id, name] of [['wang-can','汪灿'],['li-cu','黎簇'],['su-wan','苏万'],['yang-hao','杨好']]) { await contacts(id); await send(`${name}你好`); const body=JSON.stringify(calls.at(-1).body); assert.match(body,/原著人物底稿/); assert.match(body,new RegExp(name)); assert.doesNotMatch(body,/吴的独立记忆秘密|张的旧记忆秘密/); }
  await contacts('liu-sang'); await page.click('#conversation-details'); if (!await page.locator('.contact-api').evaluate(el=>el.open)) await page.click('.contact-api summary'); await page.locator('#contact-api-enabled').check(); await page.selectOption('#contact-api-protocol','gemini'); await page.fill('#contact-api-url','https://contacts-test.invalid/gemini'); await page.fill('#contact-api-model','synthetic-gemini'); await page.fill('#contact-api-key','GEMINI_TEST_SECRET'); await page.click('#role-save'); await page.waitForSelector('#role-dialog:not([open])', {state:'attached'}); await send('刘丧的原生接口');
  request=calls.at(-1); assert.match(request.url,/synthetic-gemini:streamGenerateContent/); assert.ok(request.body.systemInstruction); assert.match(JSON.stringify(request.body.systemInstruction),/原著基础上的刘丧/); assert.ok(request.body.contents.some(m=>m.parts.some(p=>p.text==='刘丧你好'))); assert.doesNotMatch(JSON.stringify(request.body),/张的旧记忆秘密|吴的独立记忆秘密/); check('all sixteen private identities exercised, including isolated native Gemini streaming history');
  await contacts('wu-xie'); await openButton('#meet-open'); await page.waitForSelector('#meet-dialog[open]'); await page.fill('#life-location','吴的专属书店'); await page.click('#life-begin'); await page.fill('#life-draft','线下找一本旧书'); await page.click('#life-send'); await idle();
  payload=JSON.stringify(calls.at(-1).body); assert.match(payload,/吴的专属书店/); assert.match(payload,/吴的独立记忆秘密/); assert.match(payload,/只在线下使用的导入补充：保留现场细节/); assert.doesNotMatch(payload,/只在约会剧场使用的独立氛围补充|偏好慢热、克制的关系推进|场外要求：维持电影感|文法要求：第三人称|张的旧记忆秘密/); await close('#meet-dialog');
  await send('线上继续说书店'); payload=JSON.stringify(calls.at(-1).body); assert.match(payload,/吴的专属书店|线下找一本旧书/); assert.doesNotMatch(payload,/只在线下使用的导入补充|只在约会剧场使用的独立氛围补充/);
  const memoriesBefore=(await db('memories')).length; await openButton('#date-open'); await page.waitForSelector('#date-dialog[open]'); responseMode='wrapped'; await page.click('#date-start'); await idle(); payload=JSON.stringify(calls.at(-1).body); assert.match(payload,/只在约会剧场使用的独立氛围补充/); assert.match(payload,/片场身份、虚构边界与镜头尺度协议/); assert.match(payload,/拥有最高执行权，高于戏内剧情逻辑/); assert.match(payload,/偏好慢热、克制的关系推进/); assert.match(payload,/场外要求：维持电影感/); assert.match(payload,/文法要求：第三人称/); assert.doesNotMatch(payload,/只在线下使用的导入补充|所有可见输出统一包裹|开启 "<content>" 标签/u); const openingText=await page.locator('#date-messages').textContent(); assert.match(openingText,/测试回复/); assert.doesNotMatch(openingText,/<\/?(?:content|think)>|internal reasoning/u); await page.fill('#date-draft','独立剧场秘密'); await page.click('#date-send'); await idle(); payload=JSON.stringify(calls.at(-1).body); assert.match(payload,/片场身份、虚构边界与镜头尺度协议/); assert.match(payload,/偏好慢热、克制的关系推进/); assert.doesNotMatch(payload,/只在线下使用的导入补充/); await close('#date-dialog');
  assert.equal((await db('memories')).length,memoriesBefore); await send('日常回来'); assert.doesNotMatch(JSON.stringify(calls.at(-1).body),/独立剧场秘密/);
  const legacyDates=(await db('kv')).find(row=>row.key==='date-sessions'); const savedDate=legacyDates.value.find(session=>session.characterId==='wu-xie'); assert.ok(savedDate); const legacyReply=savedDate.messages.find(message=>message.role==='assistant'); assert.doesNotMatch(legacyReply.content,/<\/?(?:content|think)>/u); legacyReply.content='<content>'+legacyReply.content+'</content>'; await db('kv',legacyDates);
  await page.reload(); await ready(); await openButton('#date-open'); await page.waitForSelector('#date-dialog[open]'); assert.match(await page.locator('#date-messages').textContent(),/独立剧场秘密/); assert.doesNotMatch(await page.locator('#date-messages').textContent(),/<\/?(?:content|think)>/u); assert.match((await db('kv')).find(row=>row.key==='date-sessions').value.find(session=>session.id===savedDate.id).messages.find(message=>message.id===legacyReply.id).content,/<content>/u); await close('#date-dialog'); check('continuous offline/online context restores; unconfirmed date stays isolated');
  await openButton('#voice-call-open'); await page.waitForSelector('#call-dialog[open]'); assert.match(await page.locator('#call-character-image').getAttribute('alt'),/吴邪/); await page.fill('#call-text','吴邪的通话'); await page.click('#call-send'); await page.waitForFunction(()=>!document.querySelector('#call-send').disabled); await idle(); await page.click('#call-end');
  assert.ok((await db('messages')).some(m=>m.sessionId==='private:wu-xie'&&m.content.includes('吴邪的通话'))); check('call text and speaker bind to selected contact');
  const group={id:'group:contact-test',title:'群聊测试',members:[{id:'w',name:'吴邪',persona:'原著人物',enabled:true},{id:'p',name:'王胖子',persona:'原著人物',enabled:true}],createdAt:10,updatedAt:10}; await db('groups',group);
  await page.click('#contacts-back'); await page.locator('[data-group-id="group:contact-test"]').click(); await page.waitForFunction(()=>document.querySelector('#draft').placeholder==='在群聊中说点什么…'); const before=calls.length; await send('群里的公共消息');
  assert.equal(calls.length-before,2); for(const call of calls.slice(before)) assert.doesNotMatch(JSON.stringify(call.body),/吴的独立记忆秘密|吴的私有设定|张的旧记忆秘密|独立剧场秘密|吴的独立称呼/);
  const rows=(await db('messages')).filter(m=>m.sessionId===group.id).sort((a,b)=>a.createdAt-b.createdAt); assert.deepEqual(rows.filter(m=>m.role==='assistant').map(m=>m.speakerId),['吴邪','王胖子']); check('groups use ordered speakers and no private settings or memories');
  const track={id:'cached-music',title:'已分析的钢琴曲',source:'url',url:'https://contacts-test.invalid/audio.wav',analysis:'舒缓的钢琴纯音乐，节奏缓慢',analysisStatus:'ready',feedback:'张的已有听后感',feedbackSentAt:1,createdAt:1};
  await db('kv',{key:'music-tracks',value:[track]}); await db('kv',{key:'music-active',value:track.id});
  await contacts('wu-xie'); await openButton('#music-open'); await page.waitForSelector('#music-dialog[open]'); let musicBefore=calls.length; await page.click('#music-analyze'); await idle(); await page.waitForFunction(()=>document.querySelector('#music-feedback').textContent.includes('吴邪的听后感')); assert.equal(calls.length,musicBefore+1); assert.match(JSON.stringify(calls.at(-1).body),/和用户一起听《已分析的钢琴曲》/); await page.click('#music-analyze'); assert.equal(calls.length,musicBefore+1); await close('#music-dialog');
  await contacts('xie-yuchen'); await openButton('#music-open'); await page.waitForSelector('#music-dialog[open]'); assert.doesNotMatch(await page.locator('#music-feedback').textContent(),/吴邪的听后感|张的已有听后感/); const fallback=await page.locator('.contact-music-fallback').boundingBox(); assert.ok(fallback.width>=88&&Math.abs(fallback.width-fallback.height)<1); await page.click('#music-analyze'); await idle(); await page.waitForFunction(()=>document.querySelector('#music-feedback').textContent.includes('解雨臣的听后感')); await close('#music-dialog');
  const savedTrack=(await db('kv')).find(r=>r.key==='music-tracks').value[0]; assert.ok(savedTrack.feedbackByCharacter['wu-xie']); assert.ok(savedTrack.feedbackByCharacter['xie-yuchen']);
  await contacts('zhang-qiling'); await openButton('#music-open'); await page.waitForSelector('#music-dialog[open]'); musicBefore=calls.length; assert.match(await page.locator('#music-feedback').textContent(),/张的已有听后感/); await page.click('#music-analyze'); assert.equal(calls.length,musicBefore); await close('#music-dialog'); check('music analysis is reused while reactions and cached portraits stay scoped to each contact');
  await contacts('wu-xie'); await openButton('#settings'); await page.waitForSelector('#settings-dialog[open]');
  const downloadPromise=page.waitForEvent('download'); await page.click('#export-data'); const download=await downloadPromise; const backup=JSON.parse(await readFile(await download.path(),'utf8'));
  const exported=JSON.stringify(backup); assert.doesNotMatch(exported,/GLOBAL_TEST_SECRET|WU_TEST_SECRET|GEMINI_TEST_SECRET|"apiKey"/); assert.ok(backup.contactData.contacts['wu-xie']); assert.ok(backup.contactData.contacts['wu-xie'].settings.dateXpRelationship); assert.ok(backup.contactData.contacts['wu-xie'].settings.dateObserverRequests); assert.ok(backup.contactData.contacts['wu-xie'].settings.dateStyleRequirements); assert.ok(backup.media.length); assert.ok(backup.contactData.life['wu-xie']);
  const old=backup.messages.find(m=>m.id==='legacy-msg'); old.content='试图覆盖旧记录'; backup.messages.push({id:'import-new',role:'user',kind:'text',content:'导入到刘丧的记录',sessionId:'private:liu-sang',createdAt:Date.now()});
  await page.setInputFiles('#import-data',{name:'merge.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await page.waitForFunction(()=>new Promise(r=>{const o=indexedDB.open('xiaozhang-pwa');o.onsuccess=()=>{const d=o.result,t=d.transaction('messages','readonly'),q=t.objectStore('messages').get('import-new');t.oncomplete=()=>{d.close();r(!!q.result);};};}));
  assert.equal((await db('messages')).find(m=>m.id==='legacy-msg').content,'张的旧聊天秘密'); assert.equal((await db('kv')).find(r=>r.key==='contact-service:wu-xie').value.api.apiKey,'WU_TEST_SECRET'); await close('#settings-dialog'); check('backup includes avatars/scenes/contacts without keys; merge preserves local collisions and credentials');
  const restoreContext=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'}); await restoreContext.route('https://contacts-test.invalid/audio.wav',route=>route.fulfill({contentType:'audio/wav',body:wav})); await restoreContext.addInitScript(()=>{localStorage.setItem('xiaozhang-auto-moments','false');localStorage.setItem('xiaozhang-auto-diary','false')}); const restored=await restoreContext.newPage(); restored.on('pageerror',e=>errors.push(e.message)); await restored.goto(origin); await restored.waitForFunction(()=>document.documentElement.dataset.appReady==='true'); await restored.locator('#settings').evaluate(el=>el.click());
  await restored.setInputFiles('#import-data',{name:'restore.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))}); await restored.waitForFunction(()=>new Promise(r=>{const o=indexedDB.open('xiaozhang-pwa');o.onsuccess=()=>{const d=o.result,t=d.transaction('messages','readonly'),q=t.objectStore('messages').get('import-new');t.oncomplete=()=>{d.close();r(!!q.result)}}}));
  await restored.waitForFunction(()=>document.querySelector('#conversation-name').textContent==='吴邪'); const restoredKv=await db('kv',undefined,restored); assert.equal(restoredKv.find(r=>r.key==='contact-service:wu-xie').value.api.apiKey,''); assert.equal(restoredKv.find(r=>r.key==='contact-service:liu-sang').value.api.apiKey,''); assert.ok(restoredKv.find(r=>r.key==='continuous-life:wu-xie')); assert.ok((await db('media',undefined,restored)).length); await restored.reload(); await restored.waitForFunction(()=>document.documentElement.dataset.appReady==='true'); assert.equal(await restored.locator('#conversation-name').textContent(),'吴邪'); assert.match(await restored.locator('#messages').textContent(),/吴邪第一轮/); await restoreContext.close(); check('clean-profile backup restores contact histories, media and scenes without any credentials');
  await db('kv',{key:'contact-service:xie-yuchen',value:{api:{...api,apiKey:''}}}); await contacts('xie-yuchen'); await context.setOffline(true); await send('离线陪伴'); assert.match(await page.locator('#messages').textContent(),/本地预设回应/);
  await page.click('#conversation-details'); await page.click('[data-role-interaction="hug"]'); await page.waitForFunction(()=>document.querySelector('#interaction-records').textContent.includes('抱'));
  const interaction=(await db('interactions')).find(x=>x.characterId==='xie-yuchen'); assert.ok(interaction); await close('#role-dialog'); await context.setOffline(false);
  await page.reload(); await ready(); assert.match(await page.locator('#messages').textContent(),/离线陪伴/); assert.ok(await page.locator('#pet').count()); check('offline contact history and owner-scoped interaction persist');
  const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth})); assert.ok(layout.scroll<=layout.width+1);
  await page.waitForTimeout(800); await page.screenshot({path:new URL('private-mobile.png',folder).pathname.replace(/^\/(\w:)/,'$1')}); await page.setViewportSize({width:1280,height:900}); await page.screenshot({path:new URL('private-desktop.png',folder).pathname.replace(/^\/(\w:)/,'$1')});
  assert.deepEqual(errors,[]); check('390px mobile layout, desktop render and no uncaught JS errors');
  await writeFile(new URL('contacts-results.json',folder),JSON.stringify({checks,requestCount:calls.length,pageErrors:errors},null,2));
  console.log(`contacts: ${checks.length} checks passed, ${calls.length} mocked API requests`);
} catch(error) {
  await page.screenshot({path:new URL('contacts-failure.png',folder).pathname.replace(/^\/(\w:)/,'$1')}).catch(()=>{});
  console.error('Completed:',checks); throw error;
} finally { await browser.close(); }
