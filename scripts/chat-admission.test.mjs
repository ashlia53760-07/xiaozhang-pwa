// Synthetic provider responses, isolated browser storage, and no paid API calls.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { mock } from 'node:test';
import { chromium } from 'playwright';
import ts from 'typescript';

const origin = process.env.CONTACT_TEST_URL || 'http://127.0.0.1:4177';
const folder = new URL('../.local-review/group-tpm-admission-20261026/', import.meta.url);
await mkdir(new URL('modules/', folder), { recursive: true });
const modules = {};
for (const name of ['user-persona-policy', 'model-preferences', 'model-usage', 'api', 'context-budget', 'checkup', 'phone-messages']) {
  modules[name] = ts.transpileModule(await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText.replace(/from "\.\/([^".]+)"/g, 'from "./$1.js"');
  await writeFile(new URL(`modules/${name}.js`, folder), modules[name]);
}
const { chat, ChatRateLimitError } = await import(new URL('modules/api.js', folder));
const checks = [], pass = s => { checks.push(s); console.log('PASS', s); };
const realFetch = globalThis.fetch;
mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_800_000_000_000 });
try {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ error: { code: 429, message: 'Rate limit reached for private-upstream-account on tokens per min (TPM): Limit: 4,000, Used: 0, Requested: 7,000. (request id: ReqCase123)' } }), { status: 429 });
  };
  const profile = { baseUrl: 'https://admission.invalid/v1', apiKey: 'synthetic-secret', model: 'synthetic', temperature: .7 };
  const history = Array.from({ length: 12 }, (_, i) => ({ id: 'h' + i, role: i % 2 ? 'assistant' : 'user', content: '保存的历史', kind: 'text', createdAt: i }));
  let error;
  try { await chat(profile, '测试角色设定，不公开此原文', history, 'hello', () => {}, undefined, { maxOutputTokens: 2048 }); } catch (e) { error = e; }
  assert.ok(error instanceof ChatRateLimitError);
  assert.equal(error.detail.tokenLimit, 4000); assert.equal(error.detail.tokenUsed, 0); assert.equal(error.detail.tokenRequested, 7000);
  assert.equal(error.detail.request.historyMessages, 8); assert.equal(error.detail.request.outputLimit, 2048); assert.equal(error.detail.request.recentRequests, 1);
  assert.equal(error.detail.requestId, 'ReqCase123'); assert.ok(error.detail.request.inputEstimate > 128);
  assert.match(error.message, /单纯等待无法解决/); assert.doesNotMatch(error.message, /秒后重试/);
  assert.doesNotMatch(JSON.stringify(error), /private-upstream-account|synthetic-secret|不公开此原文/);
  mock.timers.tick(62000); for (let i = 0; i < 50; i++) await Promise.resolve(); assert.equal(calls, 1);
  pass('explicit provider Limit/Used/Requested numbers distinguish oversized single request; safe request ID and actual count retained without raw account/prompt/key or automatic retries');

  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 429, message: 'Tokens per minute exceeded; current group Gemini2; request id: ReqNoQuota' } }), { status: 429 });
  await assert.rejects(chat({ ...profile, baseUrl: 'https://no-limit.invalid/v1' }, 'test', [], 'hello', () => {}), e => e.detail.kind === 'tpm' && e.detail.tokenLimit === undefined && e.detail.tokenRequested === undefined && e.detail.requestId === 'ReqNoQuota');
  pass('generic TPM message never invents an account quota or derives it from a group/model label');
} finally { globalThis.fetch = realFetch; mock.timers.reset(); }

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/__admission/blank', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Admission test</title>' }));
  await context.route('**/__admission/*.js', r => r.fulfill({ contentType: 'text/javascript', body: modules[new URL(r.request().url()).pathname.split('/').at(-1).replace('.js', '')] }));
  let calls = 0;
  await context.route('https://extended-window.invalid/**', r => {
    calls++;
    return r.fulfill({ contentType: 'application/json', headers: { 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '3s', 'Access-Control-Expose-Headers': 'x-ratelimit-remaining-tokens,x-ratelimit-reset-tokens' }, body: JSON.stringify({ choices: [{ message: { content: '在。' } }] }) });
  });
  const page = await context.newPage(); await page.clock.install(); await page.goto(origin + '/__admission/blank'); await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.evaluate(async () => {
    const { chat } = await import('/__admission/api.js'); window.profile = { baseUrl: 'https://extended-window.invalid/v1', apiKey: 'synthetic-admission-key', model: 'synthetic', temperature: .7 };
    window.ask = signal => chat(window.profile, 'test', [], 'hello', () => {}, signal, { maxOutputTokens: 100 });
    await window.ask();
    window.testAbort = new AbortController();
    window.pending = window.ask(window.testAbort.signal).then(v => { window.done = v; }, e => { window.done = e.name; });
  });
  assert.equal(calls, 1);
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('xiaozhang-chat-lane:'));
    const state = JSON.parse(localStorage.getItem(key));
    state.tokenWindow = { remaining: 0, observedAt: Date.now() + 1, resetAt: Date.now() + 8000 };
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.clock.fastForward(4000); await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(calls, 1, 'Waking after an old deadline must recheck the newer persisted token window');
  await page.clock.fastForward(4500); await page.waitForFunction(() => window.done === '在。', undefined, { polling: 20, timeout: 5000 });
  assert.equal(calls, 2);
  pass('waking from a wait rechecks shared admission state and honors an extended token deadline before making any request');
  await page.evaluate(() => { window.testAbort = new AbortController(); window.pending = window.ask(window.testAbort.signal).catch(e => e.name); });
  await page.evaluate(async () => { window.testAbort.abort(); if (await window.pending !== 'AbortError') throw Error('Abort failed'); });
  await page.clock.fastForward(10000); assert.equal(calls, 2);
  pass('aborting a rechecked wait clears its timer and sends no delayed request');
  const values = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('xiaozhang-chat-lane:')));
  assert.doesNotMatch(JSON.stringify(values), /synthetic-admission-key|Authorization|hello/);
  await context.close();
} finally { await browser.close(); }
await writeFile(new URL('results.json', folder), JSON.stringify({ origin, checks, paidCalls: 0, realProviderReproduction: false }, null, 2));
