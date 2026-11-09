// Isolated browser profiles and synthetic transport only. Never reads production data.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import { chromium } from 'playwright';

const origin = process.env.CONTACT_TEST_URL || 'http://127.0.0.1:4177';
const folder = new URL('../.local-review/group-429-repair-20261026/', import.meta.url);
await mkdir(folder, { recursive: true });
const modules = {};
for (const name of ['user-persona-policy', 'model-preferences', 'model-usage', 'api', 'context-budget', 'checkup', 'phone-messages']) {
  modules[name] = ts.transpileModule(await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText.replace(/from "\.\/([^".]+)"/g, 'from "./$1.js"');
}
const checks = [], errors = [], pass = name => { checks.push(name); console.log('PASS', name); };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 400; i++) { if (await fn()) return; await wait(20); } throw Error('Timed out awaiting synthetic request'); }
await context.addInitScript(() => {
  for (const key of ['auto-moments', 'auto-diary', 'proactive-enabled']) localStorage.setItem(`xiaozhang-${key}`, 'false');
  localStorage.setItem('xiaozhang-pet-position', JSON.stringify({ x: 3, y: 450 }));
});
await context.route('**/__limits/blank', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Isolated request test</title>' }));
await context.route('**/__limits/*.js', route => route.fulfill({ contentType: 'text/javascript', body: modules[new URL(route.request().url()).pathname.split('/').at(-1).replace('.js', '')] }));
const pages = [await context.newPage(), await context.newPage()];
for (const page of pages) { page.on('pageerror', e => errors.push(e.message)); await page.goto(origin + '/__limits/blank'); }
let active = 0, peak = 0, hold, groupCalls = 0, failGroup = true;
const calls = [];
const sse = text => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
await context.route('https://limits.invalid/**', async route => {
  const path = new URL(route.request().url()).pathname;
  const body = route.request().postDataJSON();
  const record = { path, start: Date.now() }; calls.push(record);
  active++; peak = Math.max(peak, active);
  try {
    if (path.includes('queue')) await wait(130);
    if (path.includes('held')) await new Promise(resolve => { hold = resolve; });
    const name = body.messages?.[0]?.content.match(/只以“([^”]+)”身份发言/)?.[1];
    if (path.includes('group')) groupCalls++;
    if (path.includes('limit/') || path.includes('group') && failGroup && groupCalls === 2) {
      return await route.fulfill({ status: 429, headers: { 'Retry-After': '60', 'Access-Control-Expose-Headers': 'Retry-After, X-Request-Id', 'X-Request-Id': 'req-429' }, contentType: 'application/json', body: JSON.stringify({ error: { code: 'request_rate_limit', type: 'rate_limit_error', message: 'Requests per minute exceeded' } }) });
    }
    await route.fulfill({ contentType: 'text/event-stream', body: sse(name ? `${name}：知道了。` : '在。') });
  } finally { record.end = Date.now(); active--; }
});
const profile = path => ({ baseUrl: `https://limits.invalid/${path}/v1`, apiKey: 'synthetic-browser-key', model: 'synthetic', temperature: .7 });
async function ask(page, p) {
  return page.evaluate(async profile => {
    const { chat } = await import('/__limits/api.js');
    try { return { text: await chat(profile, 'Synthetic test', [], 'hello', () => {}) }; }
    catch (e) { return { name: e.name, kind: e.detail?.kind, code: e.detail?.code, retryAt: e.retryAt, message: e.message }; }
  }, p);
}
async function db(page, store, value) {
  return page.evaluate(({ store, value }) => new Promise((resolve, reject) => {
    const open = indexedDB.open('xiaozhang-pwa'); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const d = open.result, t = d.transaction(store, value === undefined ? 'readonly' : 'readwrite'), r = value === undefined ? t.objectStore(store).getAll() : t.objectStore(store).put(value); t.oncomplete = () => { d.close(); resolve(r.result); }; t.onerror = () => reject(t.error); };
  }), { store, value });
}
const ready = page => page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
const idle = page => page.waitForFunction(() => !document.querySelector('#send').disabled);
async function retry(page, id) { await page.locator(`[data-message-id="${id}"] .bubble`).dispatchEvent('contextmenu'); await page.locator(`[data-retry-id="${id}"]`).evaluate(el => el.click()); await idle(page); }
try {
  const p = profile('queue');
  assert.deepEqual(await Promise.all([ask(pages[0], p), ask(pages[1], { ...p, baseUrl: p.baseUrl + '/chat/completions/' })]), [{ text: '在。' }, { text: '在。' }]);
  assert.equal(peak, 1); assert.ok(calls[1].start - calls[0].end >= 1400);
  pass('two tabs and equivalent endpoint forms share a queue and completion-to-start spacing');

  const limited = profile('limit'), count = calls.length;
  const error = await ask(pages[0], limited);
  assert.equal(error.kind, 'rpm'); assert.equal(error.code, 'request_rate_limit');
  assert.equal((await ask(pages[1], limited)).name, 'ChatRateLimitError');
  await pages[0].reload();
  assert.equal((await ask(pages[0], limited)).kind, 'rpm');
  assert.equal(calls.length, count + 1);
  const stored = await pages[0].evaluate(() => Object.entries(localStorage).filter(([key]) => key.startsWith('xiaozhang-chat-lane:')));
  assert.ok(stored.length); assert.doesNotMatch(JSON.stringify(stored), /synthetic-browser-key|Requests per minute|req-429|Authorization/);
  pass('Retry-After cooldown survives reload, blocks other tabs without fetching and stores no credentials or raw response');

  const pending = ask(pages[0], profile('held')); await until(() => !!hold);
  await pages[1].evaluate(async profile => {
    const { chat } = await import('/__limits/api.js');
    window.testAbort = new AbortController();
    window.testPending = chat(profile, 'test', [], 'hello', () => {}, window.testAbort.signal).then(() => 'unexpected', e => e.name);
  }, profile('held'));
  await wait(50);
  assert.equal(await pages[1].evaluate(async () => { window.testAbort.abort(); return window.testPending; }), 'AbortError');
  hold(); hold = undefined; await pending;
  assert.equal(calls.filter(c => c.path.includes('held')).length, 1);
  pass('aborting a cross-tab queued request sends no HTTP request and leaves the active request intact');

  const [page, other] = pages;
  await page.goto(origin); await ready(page);
  const now = Date.now(), groupId = 'limits-group';
  const members = [['wu-xie', '吴邪'], ['zhang-qiling', '张起灵'], ['xie-yuchen', '解雨臣']].map(([id, name]) => ({ id, characterId: id, name, enabled: true, persona: '' }));
  await db(page, 'kv', { key: 'api-profile', value: profile('group') });
  await db(page, 'kv', { key: 'active-session', value: groupId });
  await db(page, 'groups', { id: groupId, title: '限流恢复测试', members, replyMode: 'all', createdAt: now, updatedAt: now });
  await db(page, 'messages', { id: 'preserved-private', role: 'user', content: '保留的私聊', kind: 'text', createdAt: 1 });
  await db(page, 'memories', { id: 'preserved-memory', content: '保留的记忆', source: 'user', enabled: true, createdAt: 1, updatedAt: 1 });
  await page.reload(); await ready(page);
  await page.fill('#draft', '大家说说吧'); await page.click('#send'); await idle(page);
  const turn = (await db(page, 'messages')).find(m => m.role === 'user' && m.sessionId === groupId);
  const replies = async () => (await db(page, 'messages')).filter(m => m.metadata?.replyToUserId === turn.id);
  assert.equal(groupCalls, 2); assert.equal((await replies()).length, 1);
  assert.match(await page.locator('#error').textContent(), /429.*请求频率限制.*request_rate_limit/);
  await retry(page, turn.id); assert.equal(groupCalls, 2);
  await page.reload(); await ready(page); await retry(page, turn.id); assert.equal(groupCalls, 2);
  pass('NPC succeeds, Zhang receives 429: remaining roles stop; immediate retry and reload make zero extra requests');

  await other.goto(origin); await ready(other);
  failGroup = false;
  for (const p of pages) await p.evaluate(() => { const now = Date.now.bind(Date); Date.now = () => now() + 61000; });
  await Promise.all(pages.map(p => retry(p, turn.id)));
  assert.equal(groupCalls, 4); assert.equal((await replies()).length, 3);
  assert.equal(new Set((await replies()).map(m => m.metadata.groupMemberId)).size, 3);
  await page.reload(); await ready(page);
  assert.equal((await replies()).length, 3);
  assert.ok((await db(page, 'messages')).some(m => m.id === 'preserved-private'));
  assert.ok((await db(page, 'memories')).some(m => m.id === 'preserved-memory'));
  assert.ok((await db(page, 'groups')).some(g => g.id === groupId));
  pass('two tabs resume one turn without duplicate roles; successful replies, group and unrelated history/memory survive reload');

  // A separate profile tests the automatic timer while a group request is held.
  const social = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
  try {
    await social.addInitScript(() => {
      localStorage.setItem('xiaozhang-auto-moments', 'true');
      localStorage.setItem('xiaozhang-auto-diary', 'true');
      localStorage.setItem('xiaozhang-proactive-enabled', 'false');
    });
    const p = await social.newPage(); p.on('pageerror', e => errors.push(e.message)); await p.clock.install();
    await p.goto(origin); await ready(p);
    await db(p, 'kv', { key: 'api-profile', value: profile('background') });
    await db(p, 'kv', { key: 'active-session', value: groupId });
    await db(p, 'groups', { id: groupId, title: '后台延后测试', members: members.slice(0, 1), replyMode: 'all', createdAt: now, updatedAt: now });
    await p.reload(); await ready(p);
    await until(async () => (await db(p, 'kv')).some(v => v.key === 'social-automation-state' && v.value.momentNextAt > Date.now()));
    const due = { momentNextAt: 1 };
    await db(p, 'kv', { key: 'social-automation-state', value: due });
    let release, count = 0;
    await social.route('https://limits.invalid/**', async route => { count++; await new Promise(resolve => { release = resolve; }); return route.fulfill({ contentType: 'text/event-stream', body: sse('好。') }); });
    await p.fill('#draft', '测试后台让路'); await p.click('#send'); await until(() => !!release);
    await p.clock.fastForward(61000); await wait(100);
    await p.locator('#moments-open').evaluate(el => el.click()); await p.click('#moment-latest');
    assert.match(await p.locator('#moment-latest-status').textContent(), /聊天正在回复/);
    await p.locator('#moments-dialog').evaluate(el => el.close());
    await p.locator('#diary-open').evaluate(el => el.click());
    await p.waitForFunction(() => document.querySelector('#diary-generation-status')?.textContent.includes('聊天正在回复'));
    assert.equal(count, 1);
    const state = (await db(p, 'kv')).find(v => v.key === 'social-automation-state').value;
    assert.deepEqual(state, due);
    release(); await idle(p);
    pass('automatic timer, manual Moments and diary defer during group replies without claiming or duplicating social events');
  } finally { await social.close(); }
  assert.deepEqual(errors, []);
  await writeFile(new URL('browser-results.json', folder), JSON.stringify({ checks, errors, syntheticRequests: calls.length }, null, 2));
  console.log(`group 429: ${checks.length} checks passed`);
} finally { if (hold) hold(); await context.close(); await browser.close(); }
