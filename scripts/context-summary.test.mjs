// Real IndexedDB, request builders and browser UI; synthetic providers only, no paid requests.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import ts from 'typescript';

const origin = process.env.CONTEXT_TEST_URL || 'http://127.0.0.1:4175';
const artifacts = new URL('../.local-review/context-built-in-20261025/', import.meta.url);
await mkdir(artifacts, { recursive: true });
const modules = {};
for (const name of ['context', 'context-budget', 'api', 'storage', 'characters', 'checkup', 'phone-messages', 'groups', 'calendar', 'calendar-data']) {
  modules[name] = ts.transpileModule(await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText.replace(/from "\.\/([^".]+)"/g, 'from "./$1.js"');
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
await context.addInitScript(() => {
  localStorage.setItem('xiaozhang-auto-moments', 'false');
  localStorage.setItem('xiaozhang-auto-diary', 'false');
  localStorage.setItem('xiaozhang-proactive-enabled', 'false');
  localStorage.setItem('xiaozhang-pet-position', JSON.stringify({ x: 10, y: 400 }));
});
await context.route('**/__context/*.js', route => {
  const name = new URL(route.request().url()).pathname.split('/').at(-1).replace('.js', '');
  return route.fulfill({ contentType: 'text/javascript', body: modules[name] });
});
const calls = [], checks = [], errors = [];
let failure = false, empty = false, delayed = false;
await context.route('https://summary-test.invalid/**', async route => {
  const body = route.request().postDataJSON();
  const gemini = !!body.contents;
  const system = gemini ? body.systemInstruction.parts[0].text : body.messages[0].content;
  const summary = system.includes('你是对话记录整理器');
  calls.push({ body, gemini, summary });
  if (summary && delayed) await new Promise(resolve => setTimeout(resolve, 180));
  if (summary && failure) return route.fulfill({ status: 503, body: 'unavailable' });
  const text = summary && empty ? null : summary ? '用户明确说喜欢热茶，周末约好在书店见；时间还未确定。' : '记得，周末在书店见。';
  const result = gemini ? { candidates: [{ content: { parts: text ? [{ text }] : [] } }] } : { choices: [{ message: { content: text } }] };
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify(result) });
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
const ready = target => target.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
const load = target => target.evaluate(async () => {
  window.cm = await import('/__context/context.js');
  window.st = (await import('/__context/storage.js')).storage;
  window.budget = await import('/__context/context-budget.js');
  window.api = await import('/__context/api.js');
  window.profile = { baseUrl: 'https://summary-test.invalid/v1', model: 'synthetic', apiKey: 'synthetic-test-key', temperature: 0.7 };
  window.makeRows = (prefix, count = 40, content = '用户说周末想在书店见，喜欢热茶，时间还没有确认。'.repeat(5)) =>
    Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`, role: i % 2 ? 'assistant' : 'user', content: `${prefix} ${i} ${content}`, kind: 'text', createdAt: 1000 + i, sessionId: prefix }));
});
const check = name => { checks.push(name); console.log('PASS', name); };
try {
  await page.goto(origin); await ready(page); await load(page);
  let result = await page.evaluate(async () => {
    const short = await cm.prepareContext('short', makeRows('short', 12), profile);
    const missing = await cm.prepareContext('no-key', makeRows('no-key'), { ...profile, apiKey: '' });
    return { short: short.summary, missing: missing.summary, history: short.history.length };
  });
  assert.equal(calls.length, 0); assert.equal(result.short, ''); assert.equal(result.missing, '');
  check('short conversations and missing key make no summary calls');

  result = await page.evaluate(async () => {
    window.savedRows = makeRows('private');
    const before = JSON.stringify(savedRows);
    const result = await cm.prepareContext('private', savedRows, profile);
    const cache = await st.contextCache('context-summary:private');
    const again = await cm.prepareContext('private', savedRows, profile);
    return { result, cache, again, untouched: before === JSON.stringify(savedRows) };
  });
  assert.equal(calls.length, 1); assert.match(result.result.summary, /热茶/);
  assert.equal(result.cache.covered, 32); assert.ok(result.untouched);
  assert.equal(result.result.history.length, 8); assert.deepEqual(result.again, result.result);
  assert.equal(calls[0].body.max_tokens, 1200);
  assert.equal(calls[0].body.messages.length, 2); // bounded source supplied as plain text, no raw historic attachments
  check('threshold produces one bounded summary; repeats reuse cache and source messages stay intact');

  await page.reload(); await ready(page); await load(page);
  result = await page.evaluate(async () => ({ result: await cm.prepareContext('private', makeRows('private'), profile), cached: await cm.cachedSummary('private', makeRows('private')) }));
  assert.equal(calls.length, 1); assert.match(result.cached, /热茶/);
  check('IndexedDB summary survives page reload without a new API call');

  result = await page.evaluate(async () => {
    const rows = makeRows('private'); rows[0].content = '用户已经删除或更正了这条旧内容';
    const cache = await cm.cachedSummary('private', rows);
    return { cache, shortened: await cm.cachedSummary('private', rows.slice(-8)), foreign: await cm.cachedSummary('private:wu-xie', rows) };
  });
  assert.deepEqual(result, { cache: '', shortened: '', foreign: '' });
  check('edited/deleted history invalidates stale summaries; another contact cannot reuse them');

  const second = await context.newPage(); await second.goto(origin); await ready(second); await load(second);
  delayed = true;
  const beforeConcurrent = calls.length;
  await Promise.all([page, second].map(target => target.evaluate(() => cm.prepareContext('group:shared', makeRows('shared'), profile))));
  delayed = false;
  assert.equal(calls.length, beforeConcurrent + 1);
  await second.close();
  check('two tabs share an IndexedDB lease: one paid summary call per group batch');

  result = await page.evaluate(async () => {
    await cm.prepareContext('life', makeRows('life'), profile);
    await cm.prepareContext('date:zhang-qiling:one', makeRows('date'), profile);
    return { all: await Promise.all(['life', 'date:zhang-qiling:one'].map(scope => st.contextCache(`context-summary:${scope}`).then(value => value?.scope))), memories: await st.allMemories() };
  });
  assert.ok(result.all.includes('life')); assert.ok(result.all.includes('date:zhang-qiling:one'));
  assert.equal(result.memories.length, 0);
  check('offline/date/group/private have separate caches and never write automatic long-term memories');

  failure = true;
  const beforeFailure = calls.length;
  result = await page.evaluate(async () => {
    const first = await cm.prepareContext('failure', makeRows('failure'), profile);
    const second = await cm.prepareContext('failure', makeRows('failure'), profile);
    return { first, second, cache: await st.contextCache('context-summary:failure') };
  });
  assert.equal(calls.length, beforeFailure + 1); assert.equal(result.first.summary, '');
  assert.ok(result.cache.retryAt > Date.now()); assert.equal(result.second.history.length, 8);
  failure = false;
  empty = true;
  result = await page.evaluate(async () => { await cm.prepareContext('empty', makeRows('empty'), profile); return st.contextCache('context-summary:empty'); });
  assert.equal(result.text, ''); empty = false;
  check('HTTP failures and null output keep recent context and enforce a retry cooldown');

  result = await page.evaluate(async () => {
    const old = await st.contextCache('context-summary:private');
    await st.saveContextCache('context-summary:private', { ...old, retryAt: 0 });
    return old.text;
  });
  failure = true;
  await page.evaluate(() => cm.prepareContext('private', makeRows('private', 80), profile));
  assert.equal(await page.evaluate(async () => (await st.contextCache('context-summary:private')).text), result);
  failure = false;
  check('failed incremental update preserves the last valid summary');
  const beforeIncremental = calls.length;
  result = await page.evaluate(async () => {
    const old = await st.contextCache('context-summary:private');
    await st.saveContextCache('context-summary:private', { ...old, retryAt: 0 });
    const prepared = await cm.prepareContext('private', makeRows('private', 80), profile);
    const updated = await st.contextCache('context-summary:private');
    await cm.prepareContext('private', makeRows('private', 120), profile);
    return { old, updated, prepared };
  });
  assert.equal(calls.length, beforeIncremental + 1);
  assert.ok(result.updated.covered > result.old.covered);
  assert.match(calls.at(-1).body.messages.at(-1).content, /旧摘要：[\s\S]*喜欢热茶/);
  assert.doesNotMatch(calls.at(-1).body.messages.at(-1).content, /private 0 用户/);
  check('incremental update sends previous summary plus only new records, with a ten-minute success cooldown');

  const beforeOffline = calls.length;
  await context.setOffline(true);
  await page.evaluate(() => cm.prepareContext('offline-network', makeRows('offline-network'), profile));
  await context.setOffline(false);
  assert.equal(calls.length, beforeOffline);
  check('offline state makes no summary request');

  await page.evaluate(() => cm.prepareContext('gemini', makeRows('gemini'), { ...profile, protocol: 'gemini' }));
  assert.equal(calls.at(-1).gemini, true); assert.equal(calls.at(-1).body.generationConfig.maxOutputTokens, 1200);
  check('Gemini native request uses text contents and summary output budget');

  result = await page.evaluate(async () => {
    const rows = makeRows('long', 8, '长'.repeat(12000));
    await api.chat(profile, '保持角色规则', rows, '现在的话', () => {});
    const memories = [{ id: 'a', content: '最近聊过天气', category: '偏好', enabled: true, updatedAt: 999 }, { id: 'b', content: '用户喜欢热茶', category: '偏好', enabled: true, updatedAt: 1 }];
    return { memories: budget.relevantMemories(memories, '想喝热茶'), originals: rows[0].content.length };
  });
  const actualHistory = calls.at(-1).body.messages.slice(1, -1);
  assert.ok(actualHistory.every(row => typeof row.content === 'string'));
  const requestUnits = await page.evaluate(rows => rows.reduce((s, r) => s + budget.contextUnits(r.content), 0), actualHistory);
  assert.ok(requestUnits <= 3200); assert.ok(result.originals > 12000);
  assert.match(result.memories.split('\n')[0], /热茶/);
  check('actual OpenAI request has bounded plain-text history; topic-relevant memory ranks first');
  await page.evaluate(() => api.chat(profile, '规则', [{ id: 'checkup-long', role: 'user', kind: 'event', content: '旧占位', createdAt: 1, metadata: { event: 'checkup', topic: '长'.repeat(18000) } }], '继续', () => {}));
  assert.ok(await page.evaluate(text => budget.contextUnits(text) <= 1400, calls.at(-1).body.messages[1].content));
  check('event metadata cannot expand an already bounded request back into an oversized message');

  // Exercise the built application, not only the context helper.
  await page.evaluate(async () => {
    await st.saveProfile(profile);
    const rows = makeRows('private'); for (const row of rows) await st.addMessage(row);
  });
  await page.reload(); await ready(page);
  const beforeSend = calls.length;
  await page.fill('#draft', '周末见面的约定还记得吗'); await page.click('#send');
  await page.waitForFunction(() => !document.querySelector('#send').disabled);
  assert.ok(calls.length > beforeSend);
  const normalCall = calls.filter(call => !call.summary && !call.gemini).at(-1);
  assert.match(normalCall.body.messages[0].content, /历史压缩笔记/);
  assert.equal(normalCall.body.messages.filter(row => row.role === 'system').length, 1);
  await load(page);
  const stored = await page.evaluate(() => st.sessionMessages('private'));
  assert.ok(stored.length >= 42); assert.ok(stored.every(row => !row.content.includes('历史压缩笔记')));
  check('built private-chat request includes summary once; UI history stores only real user/character messages');

  await page.evaluate(async () => {
    await st.saveContinuousLife({ id: 'continuous-life', active: true, location: '书店', timeLabel: '傍晚', environment: '安静', activity: '看书', updatedAt: Date.now(), lastEventAt: Date.now() });
    for (const row of makeRows('life')) await st.addMessage(row);
    await st.saveDateSession({ id: 'ui-date', characterId: 'zhang-qiling', scene: 'walk', title: '独立约会', setting: 'DATE_ONLY_MARKER 海边散步', atmosphere: '安静', active: true, createdAt: 1, updatedAt: Date.now(), messages: makeRows('date-ui') });
  });
  await page.click('#topbar-menu-toggle'); await page.click('#meet-open');
  const lifeResponse = page.waitForResponse(response => response.url().startsWith('https://summary-test.invalid') && !response.request().postDataJSON().messages?.[0]?.content.includes('你是对话记录整理器'));
  await page.fill('#life-draft', '你选好书了吗'); await page.click('#life-send');
  await lifeResponse;
  await page.waitForFunction(() => !document.querySelector('#life-send').disabled);
  let sceneCall = calls.filter(call => !call.summary).at(-1);
  assert.match(sceneCall.body.messages[0].content, /历史压缩笔记/);
  assert.doesNotMatch(JSON.stringify(sceneCall.body), /DATE_ONLY_MARKER/);
  await page.locator('#meet-dialog').evaluate(el => el.close());
  check('built offline scene uses cached continuity without importing date theatre');
  await page.click('#topbar-menu-toggle'); await page.click('#date-open');
  await page.waitForSelector('#date-dialog[open]');
  assert.match(await page.locator('#date-dialog').innerText(), /DATE_ONLY_MARKER/);
  const beforeDate = calls.length;
  const dateResponse = page.waitForResponse(response => response.url().startsWith('https://summary-test.invalid') && !response.request().postDataJSON().messages?.[0]?.content.includes('你是对话记录整理器'));
  await page.fill('#date-draft', '我们慢慢走吧'); await page.click('#date-send');
  await dateResponse;
  await page.waitForFunction(() => !document.querySelector('#date-send').disabled);
  assert.ok(calls.length > beforeDate, 'date must make a real reply request');
  sceneCall = calls.filter(call => !call.summary).at(-1);
  assert.match(sceneCall.body.messages[0].content, /DATE_ONLY_MARKER/);
  assert.match(sceneCall.body.messages[0].content, /历史压缩笔记/);
  assert.equal(await page.evaluate(async () => (await st.allMemories()).length), 0);
  await page.locator('#date-dialog').evaluate(el => el.close());
  check('built date scene performs free-text API interaction with its own summary and no permanent-memory write');

  await page.evaluate(async () => {
    for (const session of ['private', 'life']) await st.addMessage({ id: `oversized-event-${session}`, sessionId: session, role: 'user', kind: 'event', content: '旧查岗记录', createdAt: Date.now(), metadata: { event: 'checkup', topic: '膨'.repeat(18000) } });
  });
  await page.fill('#draft', '继续聊刚才的事'); await page.click('#send');
  await page.waitForFunction(() => !document.querySelector('#send').disabled);
  const continuityCall = calls.filter(call => !call.summary).at(-1);
  assert.doesNotMatch(JSON.stringify(continuityCall.body), /膨{1500}/);
  check('built online continuity keeps offline event metadata within its request budget');
  await page.locator('#moments-open').evaluate(button => button.click());
  await page.waitForSelector('#moments-dialog[open]');
  await page.click('#moment-latest');
  await page.waitForFunction(() => document.querySelector('#moment-latest-status')?.textContent?.includes('新动态已发布'));
  const socialCall = calls.filter(call => !call.summary).at(-1);
  assert.doesNotMatch(JSON.stringify(socialCall.body), /膨{1500}/);
  assert.match(JSON.stringify(socialCall.body), /历史压缩笔记/);
  await page.locator('#moments-dialog').evaluate(element => element.close());
  check('built social generation reads cached summaries without expanding clipped event metadata');

  await page.evaluate(async () => {
    await st.saveGroup({ id: 'summary-ui-group', title: '摘要测试群', replyMode: 'all', members: [
      { id: 'zhang-qiling', characterId: 'zhang-qiling', name: '张起灵', persona: '', enabled: true },
      { id: 'wu-xie', characterId: 'wu-xie', name: '吴邪', persona: '', enabled: true }
    ], createdAt: 1, updatedAt: 1 });
    for (const row of makeRows('summary-ui-group')) await st.addMessage({ ...row, speakerId: row.role === 'assistant' ? '吴邪' : undefined });
    await st.saveActiveSession('summary-ui-group');
  });
  await page.reload(); await ready(page); await load(page);
  const beforeGroup = calls.length;
  await page.fill('#draft', '大家接着聊聊'); await page.click('#send'); await page.waitForFunction(() => !document.querySelector('#send').disabled);
  const groupCalls = calls.slice(beforeGroup);
  assert.equal(groupCalls.filter(call => call.summary).length, 1);
  assert.equal(groupCalls.filter(call => !call.summary).length, 2);
  for (const call of groupCalls.filter(call => !call.summary)) {
    assert.equal(call.body.messages[0].content.match(/历史压缩笔记/g)?.length, 1);
    assert.doesNotMatch(JSON.stringify(call.body), /DATE_ONLY_MARKER/);
  }
  check('built two-person group round makes one summary request and two replies, each with the same isolated summary');

  await page.click('#topbar-menu-toggle'); await page.click('#settings');
  assert.equal(await page.locator('#context-settings, #context-summary-toggle, #context-summary-clear, #context-summary-list').count(), 0);
  const beforeBuiltIn = calls.length;
  result = await page.evaluate(async () => {
    await st.saveContextCache('context-summary-enabled', false); // Legacy UI preference must not disable the built-in mechanism.
    const result = await cm.prepareContext('built-in', makeRows('built-in'), profile);
    return { summary: result.summary, cache: await cm.cachedSummary('built-in', makeRows('built-in')) };
  });
  assert.match(result.summary, /热茶/); assert.equal(result.cache, result.summary);
  assert.equal(calls.length, beforeBuiltIn + 1);
  await page.reload(); await ready(page); await load(page);
  assert.match(await page.evaluate(() => cm.cachedSummary('built-in', makeRows('built-in'))), /热茶/);
  assert.ok((await page.evaluate(() => st.sessionMessages('private'))).length >= 42);
  check('built-in summaries have no user controls, ignore legacy disabled preferences, and retain cache and records after reload');
  await page.screenshot({ path: new URL('settings.png', artifacts).pathname.replace(/^\/(?:([A-Za-z]):)/, '$1:') });
  assert.deepEqual(errors, []);

  // A genuine v2 database upgrades through the existing migration, retaining old rows.
  const legacy = await browser.newContext({ serviceWorkers: 'block' });
  await legacy.route('**/*', route => route.request().isNavigationRequest() ? route.fulfill({ contentType: 'text/html', body: '<html></html>' }) : route.continue());
  const oldPage = await legacy.newPage(); await oldPage.goto(origin);
  await oldPage.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('xiaozhang-pwa', 2);
    open.onupgradeneeded = () => { open.result.createObjectStore('kv', { keyPath: 'key' }); open.result.createObjectStore('messages', { keyPath: 'id' }); };
    open.onsuccess = () => { const db = open.result, tx = db.transaction('messages', 'readwrite'); tx.objectStore('messages').put({ id: 'legacy', role: 'user', kind: 'text', content: '旧版记录保留', createdAt: 1 }); tx.oncomplete = () => { db.close(); resolve(); }; }; open.onerror = () => reject(open.error);
  }));
  await legacy.unroute('**/*'); await oldPage.goto(origin); await ready(oldPage);
  assert.equal(await oldPage.evaluate(() => document.querySelector('#messages').textContent.includes('旧版记录保留')), true);
  await legacy.close();
  check('legacy IndexedDB v2 messages survive the existing v4 migration');
  const report = { passed: checks.length, checks, calls: calls.length, providers: 'synthetic OpenAI-compatible and Gemini; no real credentials or paid calls', physicalIOS: 'not tested', deployed: false };
  await writeFile(new URL('results.json', artifacts), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
