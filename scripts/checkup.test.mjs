// Isolated browser storage and fabricated endpoints; never calls paid APIs.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const folder = new URL('../.local-review/checkup-tests/', import.meta.url);
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [], errors = [];
const legacyText = '用户发起查岗：今天在做什么。请根据张起灵的角色设定生成一份克制、具体的虚构手机痕迹，只能使用原创想象，明确不能声称读取了真实设备、应用、位置、摄像头或麦克风。';
const internalMarker = '本轮为查岗互动';
const answer = '刚把背包整理好。水壶放在桌上，等会儿出去走走。';

async function create(protocol = 'openai', group = false, failure = false) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  await context.addInitScript(() => localStorage.setItem('xiaozhang-pet-position', JSON.stringify({ x: 10, y: 400 })));
  const page = await context.newPage(), requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://checkup-test.invalid/**', async route => {
    requests.push(route.request().postDataJSON());
    if (failure) return route.abort('failed');
    const data = protocol === 'gemini'
      ? { candidates: [{ content: { parts: [{ text: answer }] } }] }
      : { choices: [{ delta: { content: answer } }] };
    await route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify(data)}\n\ndata: [DONE]\n\n` });
  });
  await page.goto('http://127.0.0.1:5173'); await page.waitForSelector('#draft');
  await page.evaluate(async ({ protocol, group, legacyText }) => {
    const { storage } = await import('/src/storage.ts');
    await storage.saveProfile({ baseUrl: 'https://checkup-test.invalid/v1', model: 'fixture', apiKey: 'fabricated-test-key', temperature: .7, protocol });
    if (group) {
      await storage.saveGroup({ id: 'test-group', title: '查岗测试群', members: [{ id: 'member', name: '张起灵', persona: '克制自然', enabled: true }], createdAt: Date.now(), updatedAt: Date.now() });
      await storage.saveActiveSession('test-group');
    }
    const sessionId = group ? 'test-group' : 'private';
    await storage.addMessage({ id: 'legacy-checkup', role: 'user', kind: 'event', content: legacyText, metadata: { event: 'checkup', topic: '今天在做什么' }, createdAt: Date.now() - 10000, sessionId });
    await storage.addMessage({ id: 'ordinary-text', role: 'user', kind: 'text', content: '请根据张起灵的角色设定生成一段对白，这是我自己输入的话。', createdAt: Date.now() - 5000, sessionId });
  }, { protocol, group, legacyText });
  await page.reload(); await page.waitForSelector('[data-message-id="legacy-checkup"]');
  return { context, page, requests };
}
async function openCheckup(page) {
  if (!await page.locator('#topbar-menu').isVisible()) await page.click('#topbar-menu-toggle');
  await page.click('#checkup-open'); await page.waitForSelector('#checkup-dialog[open]');
}
async function saved(page) { return page.evaluate(async () => (await import('/src/storage.ts')).storage.messages()); }
async function settled(page, count) {
  await page.waitForFunction(count => !document.querySelector('#send').disabled && document.querySelectorAll('.message-row').length === count, count);
}
function bodyText(payload) {
  return payload.messages ? payload.messages.filter(m => m.role !== 'system').map(m => m.content).join('\n')
    : payload.contents.map(m => m.parts.map(p => p.text).join('')).join('\n');
}
function systemText(payload) { return payload.messages ? payload.messages[0].content : payload.systemInstruction.parts[0].text; }

try {
  for (const protocol of ['openai', 'gemini']) {
    const { context, page, requests } = await create(protocol);
    const legacyBubble = page.locator('[data-message-id="legacy-checkup"] .bubble');
    assert.match(await legacyBubble.innerText(), /用户发起查岗：今天在做什么/);
    assert.doesNotMatch(await legacyBubble.innerText(), /只能使用原创想象|请根据/);
    assert.match(await page.locator('[data-message-id="ordinary-text"]').innerText(), /这是我自己输入的话/);
    assert.equal((await saved(page)).find(m => m.id === 'legacy-checkup').content, legacyText);
    await page.evaluate(() => { window.copiedText = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.copiedText = value; } } }); });
    await legacyBubble.locator('[data-copy-id]').evaluate(el => el.click());
    assert.equal(await page.evaluate(() => window.copiedText), '用户发起查岗：今天在做什么');
    checks.push(`${protocol}: legacy display/copy normalized; original history and ordinary text preserved`);

    await openCheckup(page); await page.click('#checkup-dialog [value="cancel"]');
    await page.waitForSelector('#checkup-dialog[open]', { state: 'hidden' });
    assert.equal(requests.length, 0); assert.equal((await saved(page)).length, 2);
    checks.push(`${protocol}: close does not submit or save a checkup`);

    await openCheckup(page); await page.selectOption('#checkup-topic', '最近的心情'); await page.click('#checkup-submit');
    await settled(page, 4); assert.equal(requests.length, 1);
    const payload = requests[0];
    assert.match(systemText(payload), new RegExp(internalMarker));
    assert.match(systemText(payload), /不得声称读取了真实设备/);
    assert.doesNotMatch(bodyText(payload), /本轮为查岗互动|只能使用原创想象|明确不能声称/);
    assert.match(bodyText(payload), /这是我自己输入的话/);
    const record = (await saved(page)).filter(m => m.metadata?.event === 'checkup').at(-1);
    assert.equal(record.content, '用户发起查岗：最近的心情');
    assert.equal(record.metadata.topic, '最近的心情');
    assert.equal((await saved(page)).at(-1).content, answer);
    await page.screenshot({ path: fileURLToPath(new URL(`checkup-${protocol}.png`, folder)), animations: 'disabled' });
    checks.push(`${protocol}: real submit, streamed reply, concise persisted event; instructions only in system`);

    await page.reload(); await page.waitForSelector(`[data-message-id="${record.id}"]`);
    await page.fill('#draft', '那我们等会儿一起走。'); await page.click('#send'); await settled(page, 6);
    assert.equal(requests.length, 2);
    assert.doesNotMatch(systemText(requests[1]), new RegExp(internalMarker));
    assert.doesNotMatch(bodyText(requests[1]), /只能使用原创想象|明确不能声称/);
    assert.match(bodyText(requests[1]), /用户发起查岗：最近的心情/);
    assert.equal((await saved(page)).find(m => m.id === 'legacy-checkup').content, legacyText);
    checks.push(`${protocol}: reload and follow-up preserve events without repeating instructions`);

    // Other consumers (offline scene/call) use the same API history boundary.
    await page.evaluate(async () => {
      const { chat } = await import('/src/api.ts'), { storage } = await import('/src/storage.ts');
      await chat(await storage.profile(), '场景测试', await storage.messages(), '继续', () => {});
    });
    assert.doesNotMatch(bodyText(requests.at(-1)), /只能使用原创想象|明确不能声称/);
    checks.push(`${protocol}: shared API history also normalizes legacy records`);
    await context.close();
  }

  const grouped = await create('openai', true);
  await openCheckup(grouped.page); await grouped.page.click('#checkup-submit'); await settled(grouped.page, 4);
  assert.equal(grouped.requests.length, 1);
  assert.match(systemText(grouped.requests[0]), /查岗测试群/);
  assert.match(systemText(grouped.requests[0]), new RegExp(internalMarker));
  assert.doesNotMatch(bodyText(grouped.requests[0]), /只能使用原创想象|明确不能声称/);
  assert.match(bodyText(grouped.requests[0]), /我：用户发起查岗/);
  assert.equal((await saved(grouped.page)).at(-1).speakerId, '张起灵');
  checks.push('group: speaker/persona retained, system-only checkup instruction, normalized history');
  await grouped.context.close();

  const failed = await create('openai', false, true);
  await openCheckup(failed.page); await failed.page.click('#checkup-submit'); await settled(failed.page, 4);
  assert.match(await failed.page.locator('#error').innerText(), /网络暂不可用/);
  assert.equal((await saved(failed.page)).at(-1).metadata.source, 'offline');
  assert.doesNotMatch(await failed.page.locator('#messages').innerText(), /只能使用原创想象|本轮为查岗互动/);
  checks.push('API failure: explicit error/local fallback, no internal instruction displayed');
  await failed.page.evaluate(async () => { const { storage } = await import('/src/storage.ts'); const p = await storage.profile(); await storage.saveProfile({ ...p, apiKey: '' }); });
  await failed.page.reload(); await failed.page.waitForSelector('#draft');
  await openCheckup(failed.page); await failed.page.click('#checkup-submit'); await settled(failed.page, 6);
  assert.equal(failed.requests.length, 1);
  assert.equal((await saved(failed.page)).at(-1).metadata.source, 'offline');
  checks.push('no API configured: existing local reply works; no request or prompt leak');
  await failed.context.close();

  assert.deepEqual(errors, []);
  const result = { passed: true, checks, browserErrors: errors, physicalIOS: '未验证', liveModelAPIs: '未调用；仅模拟响应' };
  await writeFile(new URL('results.json', folder), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
