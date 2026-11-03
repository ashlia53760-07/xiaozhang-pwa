// Isolated browser data and synthetic HTTP responses: no real credentials or paid API calls.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const origin = process.env.CONTACT_TEST_URL || 'http://127.0.0.1:4174';
const folder = new URL('../.local-review/contact-expansion-20261025/voice/', import.meta.url);
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
await context.addInitScript(() => {
  localStorage.setItem('xiaozhang-pet-position', JSON.stringify({ x: 10, y: 400 }));
  for (const key of ['auto-moments', 'auto-diary', 'proactive-enabled']) localStorage.setItem(`xiaozhang-${key}`, 'false');
});
const page = await context.newPage();
const errors = [], checks = [], chatCalls = [], voiceCalls = [];
page.on('pageerror', error => errors.push(error.message));
const check = label => { checks.push(label); console.log('PASS', label); };
const contacts = [['zhang-qiling','张起灵'], ['wu-xie','吴邪'], ['wang-pangzi','王胖子'], ['xie-yuchen','解雨臣'], ['hei-xiazi','黑瞎子'], ['zhang-haike','张海客'], ['liu-sang','刘丧'], ['a-ning','阿宁'], ['huo-xiuxiu','霍秀秀'], ['zhang-haiyan','张海盐'], ['zhang-haixia','张海虾'], ['zhang-haiqi','张海琪']];
const additions = contacts.slice(7);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const wav = Buffer.alloc(16044);
wav.write('RIFF', 0); wav.writeUInt32LE(16036, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(16000, 40);
let failNextVoice = false;
await context.route('https://voice-test.invalid/**', async route => {
  const body = route.request().postDataJSON(), url = route.request().url();
  if (url.includes('/chat/completions')) {
    chatCalls.push(body);
    return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({choices:[{delta:{content:'先把事情说清楚，我听着。'}}]})}\n\ndata: [DONE]\n\n` });
  }
  voiceCalls.push({ url, body });
  if (failNextVoice) { failNextVoice = false; return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }); }
  return url.includes('/text-to-speech/')
    ? route.fulfill({ contentType: 'audio/wav', body: wav })
    : route.fulfill({ contentType: 'application/json', body: JSON.stringify({ base_resp: { status_code: 0 }, data: { audio: wav.toString('hex') } }) });
});
async function db(store, value, target = page) {
  return target.evaluate(({store, value}) => new Promise((resolve, reject) => {
    const open = indexedDB.open('xiaozhang-pwa'); open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const d = open.result, t = d.transaction(store, value === undefined ? 'readonly' : 'readwrite');
      const q = value === undefined ? t.objectStore(store).getAll() : t.objectStore(store).put(value);
      t.oncomplete = () => { d.close(); resolve(q.result); }; t.onerror = () => reject(t.error);
    };
  }), {store, value});
}
async function ready(target = page) { await target.waitForFunction(() => document.documentElement.dataset.appReady === 'true'); }
async function idle() { await page.waitForFunction(() => !document.querySelector('#send').disabled); }
async function select(id) {
  await page.click('#contacts-back'); await page.locator(`[data-contact-id="${id}"]`).click();
  await page.waitForFunction(name => document.querySelector('#draft').placeholder.includes(name), contacts.find(c => c[0] === id)[1]);
}
async function send(text) { await page.fill('#draft', text); await page.click('#send'); await idle(); }
async function open(id) { await page.locator(id).evaluate(el => el.click()); }
async function close(id) { await page.locator(id).evaluate(el => el.close()); }
async function role() {
  await page.click('#conversation-details'); await page.waitForSelector('#role-dialog[open]');
  await page.locator('.contact-voice').evaluate(el => { el.open = true; });
}
async function saveRole() { await page.click('#role-save'); await page.waitForSelector('#role-dialog:not([open])', {state:'attached'}); }
async function latestMessage(session) {
  return (await db('messages')).filter(m => m.role === 'assistant' && m.sessionId === session).sort((a,b) => a.createdAt-b.createdAt).at(-1);
}
async function cloud(id) {
  const row = page.locator(`[data-cloud-speak-id="${id}"]`);
  await page.locator(`[data-message-id="${id}"] .bubble`).dispatchEvent('contextmenu');
  await row.click();
  await page.waitForFunction(id => !document.querySelector(`[data-cloud-speak-id="${id}"]`)?.disabled, id);
}
async function globalVoice(provider) {
  await db('kv', {key:'tts-profile', value:{provider, baseUrl:'https://voice-test.invalid/tts', model:'synthetic-voice', apiKey:'SYNTHETIC_TTS_SECRET', voiceId:`global-${provider}`}});
}
const privateSession = id => id === 'zhang-qiling' ? 'private' : `private:${id}`;
try {
  await page.goto(origin); await ready();
  await db('kv', {key:'api-profile', value:{baseUrl:'https://voice-test.invalid/chat', model:'synthetic-chat', apiKey:'SYNTHETIC_CHAT_SECRET', protocol:'openai', temperature:0.4}});
  await globalVoice('minimax'); await page.reload(); await ready();
  const ids = {};
  for (const [id, name] of contacts) {
    await select(id); await role();
    await page.fill('#contact-voice-minimax', `mm-${id}`); await page.fill('#contact-voice-elevenlabs', `el-${id}`);
    if (additions.some(c => c[0] === id)) {
      await page.fill('#role-custom-prompt', `CONTACT_SETTING_${id}`);
      await page.locator('#character-avatar-choose').evaluate(el => el.click());
      await page.setInputFiles('#character-avatar-input', {name:`${id}.png`,mimeType:'image/png',buffer:png});
      await page.waitForFunction(() => document.querySelector('#role-save-status').textContent.includes('已保存'));
    }
    await saveRole(); await send(`${name}，今天想聊点什么？`);
    const prompt = chatCalls.at(-1).messages.find(m => m.role === 'system').content;
    assert.match(prompt, /当前是手机线上私聊/); assert.match(prompt, /不要写第三人称旁白/);
    assert.match(prompt, /不机械地只回一两个字/); assert.match(prompt, new RegExp(name));
    if (additions.some(c => c[0] === id)) {
      assert.match(prompt, /原著人物底稿/); assert.match(prompt, /当前时间线/); assert.match(prompt, /原著人物底稿/);
      assert.match(prompt, new RegExp(`CONTACT_SETTING_${id}`));
      for (const [other] of additions.filter(c => c[0] !== id)) assert.ok(!prompt.includes(`CONTACT_SETTING_${other}`));
      assert.ok(chatCalls.at(-1).messages.every(m => typeof m.content === 'string'));
      await page.locator(`#messages img[alt="${name}"]`).waitFor({state:'attached'});
    }
    const message = await latestMessage(privateSession(id)); ids[id] = message.id;
    await cloud(message.id); assert.equal(voiceCalls.at(-1).body.voice_setting.voice_id, `mm-${id}`);
  }
  check('all twelve contacts save separate Voice IDs; private request bodies contain messaging rules; MiniMax uses each speaker ID');
  check('five new personas send built-in histories/timelines and isolated settings as text; real uploaded contact portraits render');
  await page.reload(); await ready(); await select('wu-xie'); await role();
  assert.equal(await page.inputValue('#contact-voice-minimax'), 'mm-wu-xie');
  assert.equal(await page.inputValue('#contact-voice-elevenlabs'), 'el-wu-xie');
  await page.screenshot({path:fileURLToPath(new URL('voice-settings-mobile.png',folder))});
  const layout = await page.locator('.contact-voice').evaluate(el => ({width:el.clientWidth, scroll:el.scrollWidth}));
  assert.ok(layout.scroll <= layout.width + 1); await close('#role-dialog');
  const beforeCached = voiceCalls.length; await cloud(ids['wu-xie']); assert.equal(voiceCalls.length, beforeCached);
  const oldMediaId = (await latestMessage('private:wu-xie')).metadata.audioMediaId;
  await role(); await page.fill('#contact-voice-minimax', 'mm-wu-new'); await saveRole(); await cloud(ids['wu-xie']);
  assert.equal(voiceCalls.length, beforeCached + 1); assert.equal(voiceCalls.at(-1).body.voice_setting.voice_id, 'mm-wu-new');
  assert.ok((await db('media')).some(m => m.id === oldMediaId));
  check('bindings restore after reload; same voice cache reused; changed binding regenerates without deleting old media; 390px settings fit');
  await globalVoice('elevenlabs');
  for (const [id] of contacts) { await select(id); await cloud(ids[id]); assert.ok(voiceCalls.at(-1).url.includes(`/text-to-speech/el-${id}?`)); }
  check('switching provider uses each ElevenLabs ID instead of reusing MiniMax IDs');
  await select('wu-xie'); await role(); await page.fill('#contact-voice-elevenlabs', ''); await saveRole(); await cloud(ids['wu-xie']);
  assert.ok(voiceCalls.at(-1).url.includes('/text-to-speech/global-elevenlabs?'));
  await globalVoice('minimax'); await cloud(ids['wu-xie']); assert.equal(voiceCalls.at(-1).body.voice_setting.voice_id, 'mm-wu-new');
  check('empty binding falls back to global voice; other provider binding stays intact');
  await send('测试语音服务失败'); const failed = await latestMessage('private:wu-xie'); failNextVoice = true; await cloud(failed.id);
  assert.match(await page.locator('#error').textContent(), /HTTP 503/);
  assert.equal((await latestMessage('private:wu-xie')).metadata.audioMediaId, undefined);
  await cloud(failed.id); assert.ok((await latestMessage('private:wu-xie')).metadata.audioMediaId);
  check('TTS failure shows actual HTTP error and stores no fake audio; retry succeeds');
  for (const [id] of contacts) for (const mode of ['voice', 'video']) {
    await select(id); const before = voiceCalls.length; await open(mode === 'voice' ? '#voice-call-open' : '#video-call-open');
    await page.waitForSelector('#call-dialog[open]'); await page.fill('#call-text', '通话声音测试'); await page.click('#call-send');
    await page.waitForFunction(() => !document.querySelector('#call-send').disabled); await idle();
    assert.equal(voiceCalls.length, before + 1);
    assert.equal(voiceCalls.at(-1).body.voice_setting.voice_id, id === 'wu-xie' ? 'mm-wu-new' : `mm-${id}`);
    const prompt = chatCalls.at(-1).messages.find(m => m.role === 'system').content;
    assert.match(prompt, mode === 'voice' ? /当前是语音通话/ : /当前是视频通话/);
    assert.match(prompt, new RegExp(contacts.find(c => c[0] === id)[1]));
    if (additions.some(c => c[0] === id)) assert.match(await page.locator('#call-character-image').getAttribute('src'), /^blob:/);
    if (mode === 'video') { assert.match(prompt, /没有实际图像依据/); assert.equal(await page.locator('#call-user-video').evaluate(el => el.srcObject), null); }
    await page.click('#call-end');
  }
  check('voice and video calls resolve the speaking contact voice and distinct channel prompts; camera stays off');
  for (const [id, name] of contacts) {
  await select(id); await open('#meet-open'); await page.waitForSelector('#meet-dialog[open]');
  await page.fill('#life-location', `${name}的书店`); await page.click('#life-begin'); await page.fill('#life-draft', '我翻开那本书');
  const lifeResponse = page.waitForResponse(response => response.url().includes('/chat/completions'));
  await page.click('#life-send'); await lifeResponse; await idle();
  let prompt = chatCalls.at(-1).messages.find(m => m.role === 'system').content;
  assert.match(prompt, /线下小说式 RP/); assert.match(prompt, new RegExp(name)); assert.doesNotMatch(prompt, /【当前交流方式】|片场身份、虚构边界与镜头尺度协议|XP 与关系/); await close('#meet-dialog');
  await send('在手机上继续聊'); prompt = chatCalls.at(-1).messages.find(m => m.role === 'system').content;
  assert.match(prompt, new RegExp(`${name}的书店`)); assert.match(prompt, /当前是手机线上私聊/);
  await page.reload(); await ready(); await open('#meet-open'); await page.waitForSelector('#meet-dialog[open]'); assert.match(await page.locator('#life-state-card').textContent(), new RegExp(`${name}的书店`)); await close('#meet-dialog');
  await open('#date-open'); await page.waitForSelector('#date-dialog[open]');
  const dateResponse = page.waitForResponse(response => response.url().includes('/chat/completions'));
  await page.click('#date-start'); await dateResponse; await idle();
  prompt = chatCalls.at(-1).messages.find(m => m.role === 'system').content;
  assert.match(prompt, /独立的“心动约会”/); assert.match(prompt, /片场身份、虚构边界与镜头尺度协议/); assert.doesNotMatch(prompt, /【当前交流方式】/); await close('#date-dialog');
  }
  check('all twelve offline meetings and isolated dates use selected identity; reload restores each meeting; online continuity keeps messaging rules');
  await db('groups', {id:'group:voice-test', title:'音色测试', members:[{id:'wu',name:'吴邪',persona:'原著人物',enabled:true},{id:'xie',name:'解雨臣',persona:'原著人物',enabled:true}],createdAt:1,updatedAt:1});
  await page.click('#contacts-back'); await page.locator('[data-group-id="group:voice-test"]').click();
  await page.waitForFunction(() => document.querySelector('#draft').placeholder.includes('群聊')); await send('群里打个招呼');
  for (const call of chatCalls.slice(-2)) assert.match(call.messages.find(m => m.role === 'system').content, /当前是手机群聊/);
  const groupRows = (await db('messages')).filter(m => m.sessionId === 'group:voice-test' && m.role === 'assistant');
  for (const message of groupRows) { await cloud(message.id); assert.equal(voiceCalls.at(-1).body.voice_setting.voice_id, message.speakerId === '吴邪' ? 'mm-wu-new' : 'mm-xie-yuchen'); }
  check('ordered group replies keep messaging style and use speaker-specific voices');
  await select('wu-xie'); await open('#settings'); await page.waitForSelector('#settings-dialog[open]');
  const downloading = page.waitForEvent('download'); await page.click('#export-data'); const download = await downloading;
  const backup = JSON.parse(await readFile(await download.path(), 'utf8'));
  assert.equal(backup.contactData.contacts['wu-xie'].voiceIds.minimax, 'mm-wu-new');
  assert.doesNotMatch(JSON.stringify(backup), /SYNTHETIC_CHAT_SECRET|SYNTHETIC_TTS_SECRET|"apiKey"/);
  backup.contactData.contacts['wu-xie'].voiceIds.minimax = 'import-collision';
  backup.contactData.drafts['private:wu-xie'] = 'VOICE_IMPORT_COMPLETE';
  await page.setInputFiles('#import-data', {name:'voice-merge.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(backup))});
  await page.waitForFunction(() => document.querySelector('#draft').value === 'VOICE_IMPORT_COMPLETE');
  assert.equal((await db('kv')).find(r => r.key === 'contact-service:wu-xie').value.voiceIds.minimax, 'mm-wu-new');
  await close('#settings-dialog');
  const restoreContext = await browser.newContext({serviceWorkers:'block'}), restored = await restoreContext.newPage();
  restored.on('pageerror', e => errors.push(e.message)); await restored.goto(origin); await ready(restored);
  await restored.locator('#settings').evaluate(el => el.click());
  await restored.setInputFiles('#import-data', {name:'voice-restore.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(backup))});
  await restored.waitForFunction(() => document.querySelector('#draft').value === 'VOICE_IMPORT_COMPLETE');
  await restored.reload(); await ready(restored);
  const restoredKv = await db('kv', undefined, restored);
  assert.equal(restoredKv.find(r => r.key === 'contact-service:wu-xie').value.voiceIds.minimax, 'import-collision');
  assert.equal(restoredKv.find(r => r.key === 'contact-service:liu-sang').value.voiceIds.elevenlabs, 'el-liu-sang');
  for (const [id] of additions) {
    assert.equal(restoredKv.find(r => r.key === `contact-service:${id}`).value.voiceIds.minimax, `mm-${id}`);
    assert.equal(restoredKv.find(r => r.key === `continuous-life:${id}`).value.characterId, id);
    assert.ok((await db('messages', undefined, restored)).some(m => m.sessionId === privateSession(id)));
  }
  await restoreContext.close(); check('backup includes bindings without keys; merge preserves local IDs; clean import restores provider bindings');
  assert.deepEqual(errors, []); check('no uncaught browser errors');
  await writeFile(new URL('test-results.json', folder), JSON.stringify({origin,checks,chatRequests:chatCalls.length,ttsRequests:voiceCalls.length,pageErrors:errors,realProviderCalls:false},null,2));
  console.log(`contact-voice: ${checks.length} checks passed, ${chatCalls.length} synthetic chat requests, ${voiceCalls.length} synthetic TTS requests`);
} catch (error) {
  await page.screenshot({path:fileURLToPath(new URL('failure.png',folder))}).catch(() => {});
  console.error('Completed:',checks); throw error;
} finally { await browser.close(); }
