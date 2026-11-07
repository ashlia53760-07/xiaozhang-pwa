// Real Chrome/IndexedDB, isolated test profile, synthetic provider; no personal data or paid requests.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import ts from 'typescript';
const origin = process.env.CONTACT_TEST_URL || 'http://127.0.0.1:4175';
const folder = new URL('../.local-review/relationship-archives-20261025/', import.meta.url);
await mkdir(new URL('modules/', folder), { recursive: true });
const modules = {};
for (const name of ['storage', 'characters', 'phone-messages', 'checkup', 'context', 'context-budget', 'api', 'groups', 'calendar', 'calendar-data', 'calendar-observances', 'solar-term-data', 'script-library']) {
  modules[name] = ts.transpileModule(await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText.replace(/from "\.\/([^".]+)"/g, 'from "./$1.js"');
  await writeFile(new URL(`modules/${name}.js`, folder), modules[name]);
}
const checks = [], errors = [], calls = [];
const pass = name => { checks.push(name); console.log('PASS', name); };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
await context.addInitScript(() => {
  for (const key of ['auto-moments', 'auto-diary', 'proactive-enabled']) localStorage.setItem(`xiaozhang-${key}`, 'false');
});
await context.route('**/__archives/*.js', route => route.fulfill({ contentType: 'text/javascript', body: modules[new URL(route.request().url()).pathname.split('/').at(-1).replace('.js', '')] }));
let delayed, release;
await context.route('https://archive-test.invalid/**', async route => {
  calls.push(route.request().postDataJSON());
  if (delayed) { delayed = false; await new Promise(resolve => { release = resolve; }); }
  await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: '第一条回应。\n\n第二条回应。\n\n最后一条回应。' } }] })}\n\ndata: [DONE]\n\n` });
});
const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
const ready = async (target = page) => { await target.waitForFunction(() => document.documentElement.dataset.appReady === 'true'); };
const data = async (method, ...args) => page.evaluate(async ({ method, args }) => (await import('/__archives/storage.js')).storage[method](...args), { method, args });
const idle = () => page.waitForFunction(() => !document.querySelector('#send').disabled);
const send = async text => { await page.fill('#draft', text); await page.click('#send'); await idle(); };
const switchTo = async id => { await data('selectArchive', id); await page.reload(); await ready(); };
const openArchives = async () => {
  await page.click('#topbar-menu-toggle'); await page.click('#settings'); await page.click('#archives-open');
  await page.waitForSelector('#archives-list .archive-row');
};
const closeArchives = async () => { await page.click('#archives-close'); await page.locator('#settings-dialog .dialog-head button').click(); };
try {
  // Seed an actual old v2 database before the app upgrades it, rather than merely testing fresh v4.
  await page.route('**/__seed', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>isolated seed</title>' }));
  await page.goto(`${origin}/__seed`);
  await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('xiaozhang-pwa', 2);
    open.onupgradeneeded = () => {
      for (const name of ['kv', 'messages', 'media', 'stickers', 'memories', 'experiences', 'moments', 'affection']) open.result.createObjectStore(name, { keyPath: name === 'kv' ? 'key' : 'id' });
    };
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction(['messages', 'kv'], 'readwrite');
      tx.objectStore('messages').put({ id: 'v2-original', role: 'user', content: '旧版原有记录', kind: 'text', createdAt: 1 });
      tx.objectStore('kv').put({ key: 'character-settings', value: { userName: '测试用户', userPreferences: '喜欢下雨', relationship: '旧档关系', worldBook: '旧档世界书', customPrompt: '', updatedAt: 1 } });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    }; open.onerror = () => reject(open.error);
  }));
  await page.goto(origin); await ready();
  assert.equal((await data('messages'))[0].content, '旧版原有记录');
  assert.equal(await data('activeArchiveId'), 'original');
  pass('old IndexedDB v2 upgraded in place; original chat and identity retained');
  await data('saveProfile', { baseUrl: 'https://archive-test.invalid/v1', model: 'synthetic', apiKey: 'SYNTHETIC_SECRET_NEVER_EXPORT', protocol: 'openai', temperature: .4 });
  await data('saveContactPreferences', 'wu-xie', { settings: { userName: '小雨', userPreferences: '雨天', relationship: '旧档私聊', customPrompt: '', worldBook: '', updatedAt: 1 }, api: { baseUrl: 'https://archive-test.invalid/v1', model: 'synthetic', apiKey: 'SYNTHETIC_CONTACT_SECRET', temperature: .4 }, voiceIds: { minimax: 'voice-test' }, affection: 76, updatedAt: 1 });
  await page.evaluate(async () => {
    const { storage } = await import('/__archives/storage.js');
    await storage.saveUserAvatar({ id: 'shared-avatar', blob: new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="gray"/></svg>'], { type: 'image/svg+xml' }), mime: 'image/svg+xml', origin: 'user_avatar', createdAt: 1 });
    await storage.saveSticker({ id: 'shared-sticker', mediaId: 'shared-avatar', label: '原有表情', tags: ['开心'], createdAt: 1 });
    await storage.saveContextCache('travel-state', { ...await storage.leisure('travel-state'), sentinel: 'original-travel' });
    await storage.saveContextCache('play-state', { ...await storage.leisure('play-state'), sentinel: 'original-game' });
    await storage.saveContextCache('date-sessions', [{ id: 'old-date', messages: [], active: true, updatedAt: 1 }]);
    await storage.saveContextCache('continuous-life', { active: true, location: '原来见面地点' });
    await storage.saveContextCache('unknown-secret-key', { apiKey: 'UNKNOWN_SECRET_NEVER_EXPORT' });
    await storage.saveDiary({ id: 'old-diary', title: '旧日记', content: '旧经历', createdAt: 1, updatedAt: 1 });
    await storage.saveMoment({ id: 'old-moment', content: '旧动态', author: 'user', liked: false, comments: [], createdAt: 1 });
    await storage.saveMemory({ id: 'manual', content: '旧版原有记录', enabled: true, source: 'user', category: '手动', createdAt: 1, updatedAt: 1, sourceMessageIds: ['v2-original'] });
    await storage.saveMemory({ id: 'auto', content: '旧版原有记录', enabled: true, source: 'conversation', category: '自动', createdAt: 1, updatedAt: 1, sourceMessageIds: ['v2-original'] });
  });
  // Use UI to create a named checkpoint and test rename and portable download.
  await openArchives(); await page.fill('#archive-name', '雨天节点'); await page.click('#archive-checkpoint');
  await page.waitForFunction(() => document.querySelector('#archives-status').textContent.includes('节点已保存'));
  let archives = await data('archives'); const checkpoint = archives.find(a => a.name === '雨天节点'); assert.equal(checkpoint.kind, 'checkpoint');
  page.once('dialog', dialog => dialog.accept('改名后的节点'));
  await page.locator(`[data-id="${checkpoint.id}"][data-archive-action="rename"]`).click();
  await page.waitForFunction(() => document.querySelector('#archives-list').textContent.includes('改名后的节点'));
  const downloadPromise = page.waitForEvent('download');
  await page.locator(`[data-id="${checkpoint.id}"][data-archive-action="export"]`).click();
  const download = await downloadPromise; const path = await download.path();
  const portable = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(portable.format, 'xiaozhang-relationship-archive');
  assert.ok(!JSON.stringify(portable).includes('SYNTHETIC_SECRET_NEVER_EXPORT'));
  assert.ok(!JSON.stringify(portable).includes('SYNTHETIC_CONTACT_SECRET'));
  assert.ok(!JSON.stringify(portable).includes('UNKNOWN_SECRET_NEVER_EXPORT'));
  assert.ok(portable.media.some(m => m.id === 'shared-avatar'));
  pass('UI checkpoint / rename / download work; exported archive has attachments and no service keys');
  // New game through UI: default preserves only identity, no relationship state.
  await page.fill('#archive-name', '全新相处'); page.once('dialog', d => d.accept());
  await Promise.all([page.waitForEvent('load'), page.click('#archive-new')]); await ready();
  await page.waitForFunction(async () => (await import('/__archives/storage.js')).storage.activeArchiveId() !== 'original');
  const fresh = await data('activeArchiveId'); assert.match(fresh, /^archive-/);
  assert.equal((await data('messages')).length, 0); assert.equal((await data('allMemories')).length, 0);
  const settings = await data('characterSettings'); assert.equal(settings.userName, '测试用户'); assert.equal(settings.relationship, ''); assert.equal(settings.worldBook, '');
  assert.equal((await data('contactSettings', 'wu-xie')).userName, '小雨'); assert.equal(await data('contactAffection', 'wu-xie'), 0);
  assert.equal((await data('diaries')).length, 0); assert.equal((await data('moments')).length, 0);
  assert.equal(await data('contextCache', 'continuous-life'), undefined); assert.equal((await data('dateSessions')).length, 0);
  assert.equal((await data('profile')).apiKey, 'SYNTHETIC_SECRET_NEVER_EXPORT');
  assert.equal((await data('contactTtsProfile', 'wu-xie')).voiceId, 'voice-test');
  assert.equal((await data('contactProfile', 'wu-xie')).apiKey, 'SYNTHETIC_CONTACT_SECRET');
  assert.equal((await data('stickers'))[0].label, '原有表情'); assert.equal((await data('userAvatar')).id, 'shared-avatar');
  pass('new archive isolates relationship/chat/memories/social/scenes; identity optional, avatar/sticker/API/voice shared');
  await send('新档独有消息');
  const freshCount = (await data('messages')).length; assert.ok(freshCount > 1);
  await switchTo('original'); assert.equal((await data('messages')).length, 1); assert.equal((await data('diaries'))[0].id, 'old-diary');
  assert.equal((await data('contextCache', 'travel-state')).sentinel, 'original-travel');
  assert.equal((await data('contextCache', 'play-state')).sentinel, 'original-game');
  await switchTo(fresh); assert.equal((await data('messages')).length, freshCount);
  pass('archive switching reloads saved progress without contaminating original travel/game/diary');
  // Import never changes current archive and tolerates repeated import as separate branches.
  await openArchives();
  await page.setInputFiles('#archive-import', { name: 'archive.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(portable)) });
  await page.waitForFunction(() => document.querySelector('#archives-status').textContent.includes('已作为独立档案导入'));
  assert.equal(await data('activeArchiveId'), fresh); assert.equal((await data('messages')).length, freshCount);
  const imported = (await data('archives')).find(a => a.name.includes('导入')); assert.ok(imported);
  await closeArchives();
  await switchTo(imported.id); assert.equal((await data('messages'))[0].id, 'v2-original');
  assert.equal((await data('contextCache', 'travel-state')).sentinel, 'original-travel');
  let rejected = false;
  try { await data('importArchive', { ...portable, rows: { ...portable.rows, messages: [portable.rows.messages[0], portable.rows.messages[0]] } }); } catch { rejected = true; }
  assert.ok(rejected); assert.equal((await data('messages')).length, 1);
  pass('portable import creates isolated relationship with history restored; malformed duplicate rows rejected');
  // Restore checkpoint UI always forks it; original and current stay intact.
  await openArchives(); page.once('dialog', d => d.accept());
  await Promise.all([page.waitForEvent('load'), page.locator(`[data-id="${checkpoint.id}"][data-archive-action="restore"]`).click()]); await ready();
  await page.waitForFunction(id => sessionStorage.getItem('xiaozhang-relationship-archive') !== id, imported.id);
  await ready(); const fork = await data('activeArchiveId'); assert.notEqual(fork, checkpoint.id);
  assert.equal((await data('messages'))[0].id, 'v2-original');
  pass('restore checkpoint creates a live branch, never overwrites checkpoint/current archive');
  // Single and batch retract with real API request verification.
  await data('saveContextCache', 'continuous-life', undefined); // no cross-context RP excerpt in this test
  await send('分条撤回测试'); let reply = (await data('messages')).filter(m => m.role === 'assistant'); assert.equal(reply.length, 3);
  const removed = reply[1]; await page.locator(`[data-message-id="${removed.id}"] .bubble`).dispatchEvent('contextmenu');
  await page.locator(`[data-delete-id="${removed.id}"]`).click(); await page.waitForSelector(`[data-retracted-id="${removed.id}"]`);
  assert.ok(!(await data('messages')).some(m => m.id === removed.id));
  await page.reload(); await ready(); assert.equal(await page.locator(`[data-retracted-id="${removed.id}"]`).count(), 1);
  await send('继续对话'); assert.ok(!JSON.stringify(calls.at(-1)).includes('第二条回应。'));
  assert.ok(calls.at(-1).messages.every(m => typeof m.content === 'string'));
  reply = (await data('messages')).filter(m => m.role === 'assistant'); const last = reply.at(-1), batch = last.metadata.replyBatchId;
  await page.locator(`[data-message-id="${last.id}"] .bubble`).dispatchEvent('contextmenu');
  await page.locator(`[data-retract-batch="${last.id}"]`).click();
  await page.waitForFunction(async b => !(await (await import('/__archives/storage.js')).storage.messages()).some(m => m.metadata?.replyBatchId === b), batch);
  pass('single bubble and whole reply retract; tombstone survives reload; API receives only remaining plain text');
  await data('saveContextCache', 'context-summary:private', { version: 1, text: '旧摘要不应再用', covered: 1 });
  await data('saveContextCache', 'context-lease:private', { token: 'old-token', until: Date.now() + 10000 });
  await data('retractMessage', 'v2-original');
  assert.equal(await data('contextCache', 'context-summary:private'), undefined); assert.equal(await data('contextCache', 'context-lease:private'), undefined);
  const memories = await data('allMemories'); assert.equal(memories.find(m => m.id === 'auto').enabled, false);
  assert.equal(memories.find(m => m.id === 'manual').enabled, true); assert.ok(memories.every(m => m.reviewReason));
  await data('addMessage', removed); assert.ok(!(await data('messages')).some(m => m.id === removed.id));
  pass('withdraw invalidates summaries/leases, suspends sourced auto memories, preserves reviewed manual memories; late write cannot resurrect');
  // Quoted copies and group favorites should no longer reintroduce withdrawn content.
  await data('addMessage', { id: 'group-original', role: 'user', kind: 'text', content: '需要撤回的群聊秘密', sessionId: 'group-test', createdAt: 1 });
  await data('addMessage', { id: 'group-quote', role: 'user', kind: 'text', content: '稍后再说', sessionId: 'group-test', createdAt: 2, metadata: { groupQuote: { messageId: 'group-original', speaker: '我', text: '需要撤回的群聊秘密' } } });
  await data('saveGroup', { id: 'group-test', title: '测试', members: [], createdAt: 1, updatedAt: 1, memories: [{ id: 'group-memory', content: '需要撤回的群聊秘密', source: 'conversation', messageIds: ['group-original'], enabled: true }], favorites: [{ id: 'favorite', messageId: 'group-original' }] });
  await data('retractMessage', 'group-original');
  assert.ok(!(await data('sessionMessages', 'group-test'))[0].metadata.groupQuote);
  assert.equal((await data('groups'))[0].memories[0].enabled, false); assert.equal((await data('groups'))[0].favorites.length, 0);
  pass('group quote copies, source memories and favorites cannot re-inject withdrawn text');
  // Inclusive conversation rewind is checkpointed; unrelated sessions and settled events stay untouched.
  await data('addMessage', { id: 'unrelated', role: 'user', content: '另一位的消息', kind: 'text', sessionId: 'private:wu-xie', createdAt: Date.now() });
  await data('saveContextCache', 'draft:private', '旧草稿');
  await page.fill('#draft', '界面上还没发出的草稿');
  const target = (await data('messages')).find(m => m.content === '分条撤回测试');
  const beforeBranches = (await data('archives')).length;
  await page.locator(`[data-message-id="${target.id}"] .bubble`).dispatchEvent('contextmenu'); page.once('dialog', d => d.accept());
  await page.locator(`[data-branch-id="${target.id}"]`).click();
  await page.waitForFunction(async n => (await (await import('/__archives/storage.js')).storage.archives()).length > n, beforeBranches);
  await page.waitForFunction(id => !document.querySelector(`[data-message-id="${id}"]`), target.id);
  const branch = (await data('archives')).find(a => a.name.startsWith('重新聊之前'));
  assert.equal((await data('sessionMessages', 'private')).length, 0); assert.equal((await data('sessionMessages', 'private:wu-xie')).length, 1);
  assert.equal(await data('draft', 'private'), '');
  assert.equal(await page.inputValue('#draft'), '');
  await page.reload(); await ready();
  assert.equal(await page.inputValue('#draft'), '');
  assert.equal((await data('contextCache', 'travel-state')).sentinel, 'original-travel');
  assert.ok((await data('exportArchive', branch.id)).rows.messages.some(m => m.id === target.id && !m.metadata?.hiddenAt));
  pass('from-here rewind archives original timeline, hides selected-and-later chat only, clears draft, keeps unrelated sessions and travel');
  // In-flight response concurrency: another tab retracts while original tab awaits API.
  delayed = true; await page.fill('#draft', '延迟请求'); await page.click('#send');
  await page.waitForSelector('[data-phone-typing]'); while (!release) await new Promise(r => setTimeout(r, 10));
  await openArchives(); await page.fill('#archive-name', '不应半途保存'); await page.click('#archive-checkpoint');
  assert.match(await page.locator('#archives-status').innerText(), /等待当前请求/); await closeArchives();
  const latestUser = (await data('messages')).filter(m => m.role === 'user' && m.sessionId === 'private').at(-1);
  const tab = await context.newPage(); await tab.goto(origin); await ready(tab);
  await tab.evaluate(async ({ id, archive }) => {
    sessionStorage.setItem('xiaozhang-relationship-archive', archive);
    // This tab inherits local pointer before first load, same immutable archive binding.
    await (await import('/__archives/storage.js')).storage.retractMessage(id);
  }, { id: latestUser.id, archive: fork });
  release(); release = undefined; await idle();
  assert.match(await page.locator('#error').innerText(), /会话已在其他页面调整/);
  assert.ok(!(await data('messages')).some(m => m.role === 'assistant' && m.createdAt >= latestUser.createdAt));
  await tab.close();
  pass('in-flight archive actions blocked; cross-tab withdrawal rejects stale response atomically');
  // Per-page binding: switching elsewhere never changes this tab's target database.
  const oldBound = await data('activeArchiveId');
  await page.evaluate(() => localStorage.setItem('xiaozhang-relationship-archive', 'original'));
  await data('addMessage', { id: 'bound-page', role: 'user', kind: 'text', content: '只属于旧页面', sessionId: 'private', createdAt: Date.now() });
  assert.equal(await data('activeArchiveId'), oldBound);
  await switchTo('original'); assert.ok(!(await data('messages')).some(m => m.id === 'bound-page'));
  pass('open page database binding remains fixed across other-tab preference changes');
  const anonymous = await data('makeArchive', '不沿用身份的新档', 'fresh', undefined, false);
  const anonymousFile = await data('exportArchive', anonymous.id);
  assert.ok(!anonymousFile.rows.kv.some(row => row.key === 'character-settings' || row.key.startsWith('contact:')));
  assert.equal(anonymousFile.rows.messages.length, 0);
  pass('new archive without identity carryover contains no former user settings or conversations');
  await openArchives();
  await context.setOffline(true);
  await page.fill('#archive-name', '断网保存节点'); await page.click('#archive-checkpoint');
  await page.waitForFunction(() => document.querySelector('#archives-status').textContent.includes('节点已保存'));
  const offlineCheckpoint = (await data('archives')).find(a => a.name === '断网保存节点');
  assert.ok(offlineCheckpoint);
  assert.equal((await data('exportArchive', offlineCheckpoint.id)).format, 'xiaozhang-relationship-archive');
  await context.setOffline(false);
  pass('already-loaded archive panel saves and exports checkpoint without network or provider requests');
  assert.ok(await page.evaluate(() => document.querySelector('#archives-dialog').scrollWidth <= document.querySelector('#archives-dialog').clientWidth + 1));
  await page.screenshot({ path: new URL('archives-mobile.png', folder).pathname.replace(/^\/([A-Z]:)/i, '$1'), fullPage: true });
  assert.deepEqual(errors, []);
  pass('mobile archive controls fit viewport; no uncaught page errors');
  await writeFile(new URL('test-results.json', folder), JSON.stringify({ checks, failures: [], syntheticRequests: calls.length, actualDeviceTested: false }, null, 2));
} catch (error) {
  await writeFile(new URL('test-results.json', folder), JSON.stringify({ checks, failure: error.message, pageErrors: errors }, null, 2));
  throw error;
} finally { await browser.close(); }
console.log(`archives: ${checks.length} checks passed`);
