// Isolated real browser/storage with mocked HTTPS transport. No real keys or API calls.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';

const origin = process.env.CONTACT_TEST_URL || 'http://127.0.0.1:4177';
const folder = new URL('../.local-review/group-tpm-repair-20261026/', import.meta.url);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
const checks = [], calls = [], errors = [], pass = s => { checks.push(s); console.log('PASS', s); };
const profile = path => ({ baseUrl: `https://tokens.invalid/${path}/v1`, apiKey: 'synthetic-only-token-key', model: 'synthetic', temperature: .7 });
await context.addInitScript(() => {
  for (const k of ['auto-moments', 'auto-diary', 'proactive-enabled']) localStorage.setItem('xiaozhang-' + k, 'false');
});
await context.route('https://tokens.invalid/**', async route => {
  const body = route.request().postDataJSON(), path = new URL(route.request().url()).pathname;
  calls.push({ body, path });
  await route.fulfill({ contentType: 'text/event-stream', headers: path.includes('headers') ? { 'x-ratelimit-remaining-tokens': '1', 'x-ratelimit-reset-tokens': '60s', 'Access-Control-Expose-Headers': 'x-ratelimit-remaining-tokens, x-ratelimit-reset-tokens' } : {}, body: 'data: {"choices":[{"delta":{"content":"知道了。"}}]}\n\ndata: [DONE]\n\n' });
});
const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); await page.clock.install();
const ready = () => page.waitForFunction(() => document.documentElement.dataset.appReady === 'true', undefined, { timeout: 15000 });
const idle = () => page.waitForFunction(() => !document.querySelector('#send').disabled, undefined, { timeout: 15000 });
async function db(store, value) {
  return page.evaluate(({ store, value }) => new Promise((resolve, reject) => {
    const open = indexedDB.open('xiaozhang-pwa'); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const d = open.result, t = d.transaction(store, value ? 'readwrite' : 'readonly'), r = value ? t.objectStore(store).put(value) : t.objectStore(store).getAll(); t.oncomplete = () => { d.close(); resolve(r.result); }; t.onerror = () => reject(t.error); };
  }), { store, value });
}
async function retry(id, waitForIdle = false) {
  await page.locator(`[data-message-id="${id}"] .bubble`).dispatchEvent('contextmenu');
  await page.locator(`[data-retry-id="${id}"]`).evaluate(el => el.click());
  if (waitForIdle) await idle();
}
const waiting = () => page.waitForFunction(() => document.querySelector('#group-typing')?.textContent.includes('等待 Token 额度'), undefined, { timeout: 15000 });
const stop = async () => { await page.locator('#group-stop').evaluate(el => el.click()); await idle(); };
try {
  await page.goto(origin); await ready();
  const groupId = 'token-window-group', now = Date.now();
  const members = [['wu-xie', '吴邪'], ['zhang-qiling', '张起灵']].map(([id, name]) => ({ id, characterId: id, name, enabled: true }));
  await db('groups', { id: groupId, title: 'Token 窗口测试', members, replyMode: 'all', createdAt: now, updatedAt: now });
  await db('kv', { key: 'active-session', value: groupId });
  await db('kv', { key: 'api-profile', value: profile('headers') });
  await page.reload(); await ready();
  console.log('Testing successful-response token-window wait');
  await page.fill('#draft', '大家说说吧'); await page.click('#send'); await waiting();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Token-waiting status must fit the phone viewport');
  assert.equal(calls.length, 1); assert.equal(calls[0].body.max_tokens, 2048);
  assert.equal(calls[0].body.stream, true);
  assert.equal(calls[0].body.messages[0].role, 'system');
  assert.ok(calls[0].body.messages[0].content.includes('只以“吴邪”身份发言'));
  const turn = (await db('messages')).find(m => m.sessionId === groupId && m.role === 'user');
  await stop(); await page.reload(); await ready(); await retry(turn.id); await waiting();
  console.log('Stopped and restored token-window wait');
  assert.equal(calls.length, 1);
  await page.clock.fastForward(61000); await idle();
  assert.equal(calls.length, 2);
  assert.equal((await db('messages')).filter(m => m.metadata?.replyToUserId === turn.id && m.role === 'assistant').length, 2);
  pass('group API requests cap output at 2048; successful token headers cause visible, stoppable waiting, preserved across reload');

  const old = profile('old-tpm'), oldTurn = 'old-tpm-turn';
  await db('kv', { key: 'api-profile', value: old });
  await db('messages', { id: oldTurn, sessionId: groupId, role: 'user', content: '继续聊', kind: 'text', createdAt: await page.evaluate(() => Date.now()), metadata: { groupPlan: members.map(m => m.id), groupFailedMembers: [members[0].id] } });
  await page.evaluate(async p => {
    const url = new URL(p.baseUrl); url.hash = ''; url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${url.toString()}\n${p.apiKey}`));
    const key = 'xiaozhang-chat-lane:' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(key, JSON.stringify({ nextAt: 0, retryAt: Date.now() + 20000, spacing: 3000, strikes: 1, kind: 'tpm' }));
  }, old);
  await page.reload(); await ready(); await retry(oldTurn, true);
  assert.equal(calls.length, 2); assert.match(await page.locator('#error').textContent(), /本地冷却.*未发送新请求/);
  await page.clock.fastForward(21000); await retry(oldTurn); await waiting(); assert.equal(calls.length, 3);
  await stop(); await page.reload(); await ready(); await retry(oldTurn); await waiting();
  assert.equal(calls.length, 3);
  await page.clock.fastForward(62000); await idle(); assert.equal(calls.length, 4);
  const rows = (await db('messages')).filter(m => m.metadata?.replyToUserId === oldTurn && m.role === 'assistant');
  assert.deepEqual(rows.map(m => m.metadata.groupMemberId).sort(), ['wu-xie', 'zhang-qiling']);
  const stored = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('xiaozhang-chat-lane:')));
  assert.doesNotMatch(JSON.stringify(stored), /synthetic-only-token-key|Authorization/);
  pass('previous-release 20-second TPM state upgrades in place; successful recovery is paced for a full minute, survives refresh and preserves each completed role');
  assert.deepEqual(errors, []);
  await writeFile(new URL('browser-results.json', folder), JSON.stringify({ origin, checks, pageErrors: errors, syntheticRequests: calls.length, paidCalls: 0 }, null, 2));
} finally { await context.close(); await browser.close(); }
