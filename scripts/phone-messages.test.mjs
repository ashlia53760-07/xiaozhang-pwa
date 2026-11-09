// Real browser/IndexedDB with synthetic providers, never production data or paid API calls.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import ts from 'typescript';

const origin = process.env.CONTACT_TEST_URL || 'http://127.0.0.1:4175';
const folder = new URL('../.local-review/phone-messages-20261025/', import.meta.url);
await mkdir(new URL('modules/', folder), { recursive: true });
const modules = {};
for (const name of ['user-persona-policy', 'calendar', 'calendar-data', 'calendar-observances', 'solar-term-data', 'script-library', 'model-preferences', 'model-usage', 'scene-context-data', 'phone-messages', 'context-budget', 'context', 'storage', 'api', 'characters', 'groups', 'checkup']) {
  modules[name] = ts.transpileModule(await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText.replace(/from "\.\/([^".]+)"/g, 'from "./$1.js"');
  await writeFile(new URL(`modules/${name}.js`, folder), modules[name]);
}
const { splitPhoneReply, phoneReplyMessages, collapsePhoneMessages } = await import(new URL('modules/phone-messages.js', folder));
const { boundedHistory } = await import(new URL('modules/context-budget.js', folder));
const { onlineConversationPrompt } = await import(new URL('modules/characters.js', folder));
const checks = [], calls = [], errors = [];
const check = name => { checks.push(name); console.log('PASS', name); };
const base = { id: 'reply', role: 'assistant', kind: 'text', speakerId: '吴邪', sessionId: 'private:wu-xie', createdAt: 1000 };
const longReply = '刚才说的那件事，我记着。\n\n你先把时间定下来，不用急着赶路。\n\n我这边安排好以后，再发消息告诉你。';
const paragraphs = phoneReplyMessages({ ...base, content: longReply, metadata: { card: { title: '约定', body: '稍后联系' } } });
assert.equal(paragraphs.length, 3);
assert.equal(collapsePhoneMessages(paragraphs)[0].content, longReply);
assert.equal(paragraphs.filter(m => m.metadata.card).length, 1);
assert.equal(new Set(paragraphs.map(m => m.id)).size, 3);
assert.ok(paragraphs.every((m, i) => i === 0 || m.createdAt > paragraphs[i - 1].createdAt));
assert.deepEqual(collapsePhoneMessages(collapsePhoneMessages(paragraphs)), collapsePhoneMessages(paragraphs));
for (const text of [longReply, '第一句。\n\n\n 第二句😊。', '明天再说。'.repeat(30), '第一段。\n \n第二段。', Array.from({ length: 20 }, (_, i) => `第${i}段。`).join('\n\n')]) {
  assert.equal(splitPhoneReply(text).join(''), text.trim());
  assert.equal(collapsePhoneMessages(phoneReplyMessages({ ...base, content: text }))[0].content, text.trim());
}
for (const text of ['嗯，我在。', '```js\nconst url = "https://example.com/a?b=1";\n```', 'https://example.com/a?b=1&c=2', '1. 带水\n2. 带伞']) assert.equal(splitPhoneReply(text).length, 1);
assert.deepEqual(splitPhoneReply('第一句。第二句！第三句？'), ['第一句。', '第二句！', '第三句？']);
assert.deepEqual(splitPhoneReply('版本 1.2 可以用。下一句。'), ['版本 1.2 可以用。', '下一句。']);
assert.equal(splitPhoneReply('null').length, 0);
assert.equal(splitPhoneReply('undefined').length, 0);
assert.equal(splitPhoneReply('  ').length, 0);
check('lossless paragraph/sentence cuts, emoji/formatting, bounded bubble count, unique IDs and one card');
for (const extra of [{ metadata: { event: 'call_reply' } }, { sessionId: 'life:wu-xie' }, { sessionId: 'date:test' }]) assert.equal(phoneReplyMessages({ ...base, content: longReply, ...extra }).length, 1);
assert.match(onlineConversationPrompt('private'), /空行/);
assert.match(onlineConversationPrompt('group'), /空行/);
assert.doesNotMatch(onlineConversationPrompt('voice'), /空行/);
check('voice/video and offline/date RP remain coherent; phone guidance only affects text channels');
assert.ok(!collapsePhoneMessages(paragraphs.filter((_, i) => i !== 1))[0].content.includes('时间定下来'));
assert.equal(collapsePhoneMessages([paragraphs[0], { ...paragraphs[1], sessionId: 'other' }]).length, 2);
const user = { id: 'user-before', role: 'user', kind: 'text', content: '先前的提问', createdAt: 1 };
assert.equal(boundedHistory([user, ...paragraphs], 3200, 2)[0].id, user.id);
check('deleted bubbles stay deleted, contacts remain isolated and history budget counts logical replies');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
await context.addInitScript(() => {
  for (const key of ['auto-moments', 'auto-diary', 'proactive-enabled']) localStorage.setItem(`xiaozhang-${key}`, 'false');
  localStorage.setItem('xiaozhang-pet-position', JSON.stringify({ x: 10, y: 400 }));
});
await context.route('**/__phone/*.js', route => route.fulfill({ contentType: 'text/javascript', body: modules[new URL(route.request().url()).pathname.split('/').at(-1).replace('.js', '')] }));
let response = longReply, release;
let delay = false, failure = false;
await context.route('https://phone-test.invalid/**', async route => {
  const body = route.request().postDataJSON(); calls.push(body);
  const text = response;
  if (delay) { delay = false; await new Promise(resolve => { release = resolve; }); }
  if (failure) { failure = false; return route.fulfill({ status: 503, body: 'unavailable' }); }
  return route.fulfill({ contentType: 'text/event-stream', body: `data: {"choices":[{"delta":{"content":null,"reasoning_content":"hidden"}}]}\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: text.slice(0, 9) } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: text.slice(9) } }] })}\n\ndata: [DONE]\n\n` });
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
const ready = () => page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
const idle = () => page.waitForFunction(() => !document.querySelector('#send').disabled);
async function db(store, value) {
  return page.evaluate(({ store, value }) => new Promise((resolve, reject) => {
    const open = indexedDB.open('xiaozhang-pwa'); open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const d = open.result, t = d.transaction(store, value === undefined ? 'readonly' : 'readwrite');
      const r = value === undefined ? t.objectStore(store).getAll() : t.objectStore(store).put(value);
      t.oncomplete = () => { d.close(); resolve(r.result); }; t.onerror = () => reject(t.error);
    };
  }), { store, value });
}
async function send(text) { await page.fill('#draft', text); await page.click('#send'); await idle(); }
async function contact(id) {
  await page.click('#contacts-back');
  await page.locator(`[data-contact-id="${id}"]`).click();
  await page.waitForFunction(() => !document.querySelector('#session-dialog').open);
}
try {
  await page.goto(origin); await ready();
  await db('kv', { key: 'api-profile', value: { baseUrl: 'https://phone-test.invalid/v1', model: 'synthetic', apiKey: 'SYNTHETIC_ONLY', protocol: 'openai', temperature: .4 } });
  await db('messages', { id: 'legacy', role: 'user', kind: 'text', content: '旧记录不动', createdAt: 1 });
  await page.reload(); await ready();
  // Observe actual DOM deliveries, rather than assuming build success implies pacing.
  await page.evaluate(() => {
    window.deliveries = [];
    new MutationObserver(() => window.deliveries.push(document.querySelectorAll('#messages .message-row.assistant').length)).observe(document.querySelector('#messages'), { childList: true });
  });
  delay = true;
  await page.fill('#draft', '周末的安排呢'); await page.click('#send');
  await page.waitForSelector('[data-phone-typing]');
  assert.equal(await page.locator('#messages .message-row.assistant').count(), 0);
  while (!release) await new Promise(resolve => setTimeout(resolve, 10));
  release(); release = undefined;
  await idle();
  let rows = (await db('messages')).filter(m => m.role === 'assistant');
  assert.equal(rows.length, 3); assert.equal(calls.length, 1);
  assert.equal(await page.locator('#messages .message-row.assistant').count(), 3);
  const sequence = await page.evaluate(() => window.deliveries);
  assert.ok(sequence.includes(1) && sequence.includes(2) && sequence.includes(3));
  assert.equal(collapsePhoneMessages(rows)[0].content, longReply);
  assert.equal(await page.locator('[data-phone-typing]').count(), 0);
  await page.screenshot({ path: fileURLToPath(new URL('phone-bubbles-mobile.png', folder)) });
  check('real private SSE delivers 3 consecutive bubbles with typing status and only 1 model request');
  const ids = rows.map(m => m.id);
  await page.reload(); await ready();
  assert.deepEqual((await db('messages')).filter(m => m.role === 'assistant').map(m => m.id), ids);
  assert.equal(await page.locator('#messages .message-row.assistant').count(), 3);
  response = '好，定下来告诉我。'; await send('好的');
  assert.equal(calls.length, 2);
  assert.equal(calls.at(-1).messages.filter(m => m.role === 'assistant').length, 1);
  assert.equal(calls.at(-1).messages.find(m => m.role === 'assistant').content, longReply);
  assert.ok(calls.at(-1).messages.some(m => m.content === '周末的安排呢'));
  assert.ok(calls.at(-1).messages.every(m => typeof m.content === 'string'));
  check('refresh preserves all parts; next API body includes the full logical reply once and preceding user');
  const deletion = rows[1];
  await page.locator(`[data-message-id="${deletion.id}"] .bubble`).dispatchEvent('contextmenu');
  await page.locator(`[data-delete-id="${deletion.id}"]`).click();
  await page.waitForFunction(id => !document.querySelector(`[data-message-id="${id}"]`), deletion.id);
  assert.ok((await db('messages')).find(m => m.id === deletion.id)?.metadata?.retractedAt);
  assert.equal(await page.locator(`[data-retracted-id="${deletion.id}"]`).count(), 1);
  await send('接着说');
  assert.ok(!JSON.stringify(calls.at(-1)).includes(deletion.content));
  check('individual bubble actions work and deleted text is not resurrected in later context');
  response = longReply; delay = true;
  await page.fill('#draft', '切换联系人测试'); await page.click('#send');
  await page.waitForSelector('[data-phone-typing]');
  while (!release) await new Promise(resolve => setTimeout(resolve, 10));
  await contact('wu-xie'); release(); release = undefined; await idle();
  assert.equal(await page.locator('#messages .message-row.assistant').count(), 0);
  assert.equal((await db('messages')).filter(m => m.content === '刚才说的那件事，我记着。' && m.sessionId === 'private').length, 2);
  check('delayed multi-part replies stay with the initiating contact after navigation');
  await page.evaluate(async () => {
    const { prepareContext } = await import('/__phone/context.js');
    const { phoneReplyMessages } = await import('/__phone/phone-messages.js');
    const history = Array.from({ length: 10 }, (_, i) => phoneReplyMessages({ id: `budget-${i}`, sessionId: 'budget', role: 'assistant', kind: 'text', content: Array.from({ length: 8 }, () => '这是同一回复中的一个自然段，用于检查分条不会增加摘要调用。').join('\n\n'), createdAt: i })).flat();
    const result = await prepareContext('bubble-budget', history, { baseUrl: 'https://phone-test.invalid/v1', model: 'synthetic', apiKey: 'SYNTHETIC_ONLY', temperature: .4 });
    if (result.history.length !== 8) throw Error('history slot regression');
  });
  assert.equal(calls.length, 4);
  check('80 physical bubbles remain 10 logical turns and do not trigger an extra summary API call');
  // A group uses the same actual delivery path, but never interleaves speakers.
  await db('groups', { id: 'phone-group', title: '分条群聊', replyMode: 'all', members: [
    { id: 'wu-xie', characterId: 'wu-xie', name: '吴邪', enabled: true },
    { id: 'xie-yuchen', characterId: 'xie-yuchen', name: '解雨臣', enabled: true }
  ], createdAt: 1, updatedAt: 1 });
  await page.reload(); await ready(); await page.click('#contacts-back');
  await page.locator('[data-group-id="phone-group"]').click();
  await page.waitForFunction(() => !document.querySelector('#session-dialog').open);
  const before = calls.length; response = longReply;
  await send('大家说说吧');
  const groupRows = (await db('messages')).filter(m => m.sessionId === 'phone-group' && m.role === 'assistant').sort((a,b) => a.createdAt - b.createdAt);
  assert.equal(groupRows.length, 6); assert.equal(calls.length, before + 2);
  assert.deepEqual(groupRows.map(m => m.speakerId), ['吴邪', '吴邪', '吴邪', '解雨臣', '解雨臣', '解雨臣']);
  assert.equal(collapsePhoneMessages(groupRows).length, 2);
  await page.reload(); await ready(); assert.equal(await page.locator('#messages .message-row.assistant').count(), 6);
  check('group speakers each send consecutive bubbles in order, one request per speaker, restored on refresh');
  await contact('wu-xie'); failure = true; await send('失败场景');
  assert.equal(await page.locator('#messages .message-row.assistant').count(), 0);
  assert.match(await page.locator('#error').textContent(), /503/);
  assert.equal(await page.locator('[data-phone-typing]').count(), 0);
  assert.ok((await db('messages')).some(m => m.id === 'legacy' && m.content === '旧记录不动'));
  assert.deepEqual(errors, []);
  check('HTTP failures leave no fake reply or stuck typing; legacy records and page runtime remain intact');
  await writeFile(new URL('results.json', folder), JSON.stringify({ passed: checks.length, checks, calls: calls.length, paidCalls: 0, physicalIOS: 'not tested', deployed: false }, null, 2));
} finally { await browser.close(); }
