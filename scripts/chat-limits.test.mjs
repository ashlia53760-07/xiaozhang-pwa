// Synthetic transport only: exercise the real request scheduler and both protocol paths.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';
const folder = new URL('../.local-review/group-fixes-20261026/api-modules/', import.meta.url);
await mkdir(folder, { recursive: true });
for (const name of ['api', 'context-budget', 'checkup', 'phone-messages']) {
  const js = ts.transpileModule(await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText.replace(/from "\.\/([^".]+)"/g, 'from "./$1.js"');
  await writeFile(new URL(`${name}.js`, folder), js);
}
const { chat, ChatRateLimitError } = await import(new URL('api.js', folder));
const checks = [], pass = s => { checks.push(s); console.log('PASS', s); };
const realFetch = globalThis.fetch, realNow = Date.now;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = name => ({ baseUrl: `https://${name}.invalid/v1`, apiKey: 'synthetic', model: 'synthetic', temperature: .7 });
const ask = (p, signal) => chat(p, 'test', [], 'hello', () => {}, signal);
const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: '在。' } }] }), { headers: { 'content-type': 'application/json' } });
try {
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; return new Response('', { status: 429, headers: { 'Retry-After': '60' } }); };
  const p = profile('seconds');
  const results = await Promise.allSettled([ask(p), ask(p), ask(p)]);
  assert.equal(fetches, 1);
  for (const r of results) { assert.equal(r.status, 'rejected'); assert.ok(r.reason instanceof ChatRateLimitError); assert.ok(r.reason.retryAt >= realNow() + 59000); }
  await assert.rejects(ask(p), ChatRateLimitError); assert.equal(fetches, 1);
  pass('concurrent callers share cooldown; numeric Retry-After blocks queued and immediate requests without automatic retries');

  for (const protocol of ['openai', 'gemini']) {
    let body;
    const g = { ...profile(`date-${protocol}`), protocol };
    const deadline = realNow() + 45000;
    globalThis.fetch = async (_url, options) => { body = JSON.parse(options.body); return new Response('', { status: 429, headers: { 'Retry-After': new Date(deadline).toUTCString() } }); };
    await assert.rejects(ask(g), e => e instanceof ChatRateLimitError && Math.abs(e.retryAt - deadline) < 1000);
    assert.ok(protocol === 'gemini' ? body.contents && body.systemInstruction : body.messages && body.stream);
  }
  pass('HTTP-date Retry-After and typed 429 errors work for OpenAI-compatible and Gemini native protocols');

  for (const [name, code, message, kind] of [
    ['rpm', 'request_rate_limit', 'Too many requests per minute', 'rpm'],
    ['tpm', 'rate_limit_exceeded', 'Tokens per minute exceeded', 'tpm'],
    ['concurrent', 'concurrency_limit', '', 'concurrency'],
    ['quota', 'insufficient_quota', 'Not enough balance', 'quota'],
    ['unknown', 'provider_busy', 'Busy', 'unknown']
  ]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code, type: 'provider_error', message } }), { status: 429, headers: { 'x-request-id': 'req-001' } });
    await assert.rejects(ask(profile(`classified-${name}`)), e => e instanceof ChatRateLimitError && e.detail.kind === kind && e.detail.code === code && e.detail.requestId === 'req-001' && (kind !== 'quota' || e.retryAt - realNow() >= 299000));
  }
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'synthetic-secret', type: '<unsafe>', message: 'authorization: synthetic-secret' } }), { status: 429, headers: { 'x-request-id': 'synthetic-secret' } });
  await assert.rejects(ask({ ...profile('redacted'), apiKey: 'synthetic-secret' }), e => e instanceof ChatRateLimitError && e.detail.code === undefined && e.detail.requestId === undefined && !JSON.stringify(e).includes('synthetic-secret') && !e.message.includes('authorization'));
  globalThis.fetch = async () => new Response('<html>not-json</html>', { status: 429 });
  await assert.rejects(ask(profile('malformed')), e => e instanceof ChatRateLimitError && e.detail.kind === 'unknown');
  pass('provider evidence distinguishes RPM, TPM, concurrency and quota; quota waits five minutes; malformed bodies and secret-bearing fields are safe');

  let offset = 0;
  Date.now = () => realNow() + offset;
  globalThis.fetch = async () => new Response('', { status: 429 });
  const f = profile('fallback');
  await assert.rejects(ask(f), e => e instanceof ChatRateLimitError && e.retryAt - Date.now() >= 29900);
  offset += 31000;
  await assert.rejects(ask(f), e => e instanceof ChatRateLimitError && e.retryAt - Date.now() >= 59900);
  offset += 61000;
  globalThis.fetch = async () => ok();
  assert.equal(await ask(f), '在。');
  Date.now = realNow;
  pass('missing Retry-After uses increasing fallback cooldown; manual retry recovers after deadline');

  const starts = [], ended = [];
  let streamController;
  globalThis.fetch = async () => {
    starts.push(realNow());
    if (starts.length === 1) return new Response(new ReadableStream({ start(c) { streamController = c; } }), { headers: { 'content-type': 'text/event-stream' } });
    return ok();
  };
  const s = profile('stream');
  const first = ask(s).then(v => { ended.push(realNow()); return v; });
  while (!streamController) await wait(5);
  const controller = new AbortController();
  const cancelled = ask(s, controller.signal);
  const cancelledCheck = assert.rejects(cancelled, { name: 'AbortError' });
  const second = ask({ ...s, model: 'other-model' });
  await wait(30); assert.equal(starts.length, 1);
  controller.abort(); await cancelledCheck;
  streamController.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"听着。"}}]}\n\ndata: [DONE]\n\n'));
  streamController.close();
  assert.equal(await first, '听着。'); assert.equal(starts.length, 1);
  assert.equal(await second, '在。');
  assert.equal(starts.length, 2); assert.ok(starts[1] - ended[0] >= 1450);
  pass('stream lifetime holds the lane; queued abort does not unblock past the active stream; different models sharing a credential are spaced');

  let sent = 0;
  globalThis.fetch = async () => { sent++; return ok(); };
  const a = profile('abort-spacing'); await ask(a);
  const abort = new AbortController(), pending = ask(a, abort.signal);
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await wait(30); abort.abort(); await rejected;
  assert.equal(sent, 1); assert.equal(await ask(a), '在。'); assert.equal(sent, 2);
  pass('cancelling during spacing sends no request and leaves the queue usable');

  let release;
  globalThis.fetch = async url => url.includes('held.invalid') ? new Promise(resolve => { release = () => resolve(ok()); }) : ok();
  const held = ask(profile('held')); while (!release) await wait(5);
  assert.equal(await ask(profile('independent')), '在。'); release(); await held;
  pass('independent endpoints are not blocked by another provider lane');

  let active = 0, peak = 0, aliasCalls = 0;
  globalThis.fetch = async () => { active++; peak = Math.max(peak, active); aliasCalls++; await wait(40); active--; return ok(); };
  const alias = profile('alias');
  await Promise.all([ask(alias), ask({ ...alias, baseUrl: alias.baseUrl + '/chat/completions/' })]);
  assert.equal(aliasCalls, 2); assert.equal(peak, 1);
  pass('base URL and full completions URL aliases share a single request lane');
  await writeFile(new URL('../api-results.json', folder), JSON.stringify({ checks }, null, 2));
} finally { globalThis.fetch = realFetch; Date.now = realNow; }
