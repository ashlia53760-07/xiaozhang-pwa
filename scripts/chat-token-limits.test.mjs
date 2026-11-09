// Real scheduler, deterministic fake clock and synthetic transport; no paid calls.
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import ts from 'typescript';

const folder = new URL('../.local-review/group-tpm-repair-20261026/', import.meta.url);
await mkdir(new URL('modules/', folder), { recursive: true });
for (const name of ['user-persona-policy', 'model-preferences', 'model-usage', 'api', 'context-budget', 'checkup', 'phone-messages']) {
  const js = ts.transpileModule(await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText.replace(/from "\.\/([^".]+)"/g, 'from "./$1.js"');
  await writeFile(new URL(`modules/${name}.js`, folder), js);
}
const { chat, ChatRateLimitError } = await import(new URL('modules/api.js', folder));
const checks = [], pass = s => { checks.push(s); console.log('PASS', s); };
const realFetch = globalThis.fetch;
mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_800_000_000_000 });
const flush = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };
const advance = async ms => { mock.timers.tick(ms); await flush(); };
const profile = name => ({ baseUrl: `https://${name}.invalid/v1`, apiKey: 'synthetic-only', model: 'synthetic', temperature: .7 });
const ask = (p, options = {}, signal) => chat(p, 'Synthetic system', [], 'hello', () => {}, signal, { maxOutputTokens: 100, ...options });
const ok = headers => new Response(JSON.stringify({ choices: [{ message: { content: '在。' } }] }), { headers: { 'content-type': 'application/json', ...headers } });
try {
  let calls = 0, reset = Date.now() + 3000;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return ok({ 'x-ratelimit-limit-tokens': '1000', 'x-ratelimit-remaining-tokens': '20', 'x-ratelimit-reset-tokens': '3s' });
    assert.ok(Date.now() >= reset, 'Provider token window was exhausted; sending again would cause 429');
    return ok();
  };
  const p = profile('header-budget');
  await ask(p);
  const waits = [], pending = ask(p, { onWait: value => waits.push(value) });
  await flush(); await advance(2000);
  assert.equal(calls, 1, 'A 1.5-second request gap does not protect a token window');
  await advance(1100); assert.equal(await pending, '在。'); assert.equal(calls, 2);
  assert.ok(waits.some(value => value.until >= reset && value.reason === 'tokens'));
  pass('successful-response token headers prevent a second request before window reset, with a visible waiting callback');

  calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1 ? new Response(JSON.stringify({ error: { code: 'rate_limit_exceeded', message: 'Tokens per minute exceeded' } }), { status: 429, headers: { 'Retry-After': '20' } }) : ok();
  };
  const t = profile('tpm-fallback');
  await assert.rejects(ask(t), e => e instanceof ChatRateLimitError && e.detail.kind === 'tpm' && e.source === 'response');
  await assert.rejects(ask(t), e => e.source === 'cooldown' && /未发送新请求/.test(e.message)); assert.equal(calls, 1);
  await advance(20100); assert.equal(await ask(t), '在。');
  const afterRecovery = ask(t); await flush(); await advance(3100); assert.equal(calls, 2);
  await advance(58000); assert.equal(await afterRecovery, '在。'); assert.equal(calls, 3);
  pass('20-second TPM response stops immediately; recovery without token budget uses a full minute gap instead of another 3-second burst');

  const cancelled = new AbortController();
  const waiting = ask(t, {}, cancelled.signal), rejected = assert.rejects(waiting, { name: 'AbortError' });
  await flush(); cancelled.abort(); await rejected; assert.equal(calls, 3);
  pass('stopping a token-waiting request sends nothing and never retries automatically');

  calls = 0;
  globalThis.fetch = async () => { calls++; return ok({ 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '2s' }); };
  const h = profile('exhausted'); await ask(h);
  const more = ask(h); await flush(); await advance(1700); assert.equal(calls, 1); await advance(400); assert.equal(await more, '在。');
  pass('zero remaining tokens delay the next request even when the preceding request succeeded');

  calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '在。' }] } }] }), { headers: { 'content-type': 'application/json', 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '2s' } });
  };
  const g = { ...profile('gemini-tokens'), protocol: 'gemini' }; await ask(g);
  const gemini = ask(g); await flush(); await advance(1700); assert.equal(calls, 1); await advance(400); assert.equal(await gemini, '在。');
  pass('Gemini native requests use the same token-window admission without changing their protocol');

  calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return calls === 1
      ? new Response(JSON.stringify({ error: { code: 429, message: 'Tokens per minute exceeded' } }), { status: 429, headers: { 'Retry-After': '20' } })
      : ok({ 'x-ratelimit-remaining-tokens': '100000', 'x-ratelimit-reset-tokens': '10s' });
  };
  const bypass = profile('tpm-header-bypass');
  await assert.rejects(ask(bypass), ChatRateLimitError);
  await advance(20100); await ask(bypass);
  const guarded = ask(bypass); await flush(); await advance(4000);
  assert.equal(calls, 2, 'An apparently sufficient response header must not cancel a learned TPM guard');
  await advance(58000); assert.equal(await guarded, '在。');
  pass('positive token headers cannot bypass the conservative policy learned from an actual TPM failure');

  await writeFile(new URL('token-results.json', folder), JSON.stringify({ checks, paidCalls: 0 }, null, 2));
} finally { globalThis.fetch = realFetch; mock.timers.reset(); }
