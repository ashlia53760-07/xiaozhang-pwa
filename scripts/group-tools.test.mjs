// Isolated Chrome/IndexedDB and a synthetic provider. No real payments, personal data or paid API calls.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import ts from 'typescript';
const folder = new URL('../.local-review/group-tools-20261026/', import.meta.url);
await mkdir(folder, { recursive: true });
const code = ts.transpileModule(await readFile(new URL('../src/group-tools.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
await writeFile(new URL('group-tools.mjs', folder), code);
const { splitShares, parseMoney, collectionProgress, applyToolAction, parseToolReply } = await import(new URL('group-tools.mjs', folder));
const checks = [], pass = s => { checks.push(s); console.log('PASS', s); };
assert.deepEqual(splitShares(100, ['user', 'a', 'b']), { user: 34, a: 33, b: 33 });
for (const amount of ['NaN', 'Infinity', '-1', '0', '100000', '0.001', '1e3', '12.999', '']) assert.throws(() => parseMoney(amount));
assert.equal(parseMoney('99999.99'), 9999999); assert.equal(parseMoney('0.01'), 1);
assert.throws(() => splitShares(1, ['a', 'b'])); assert.throws(() => splitShares(10, ['a', 'a']));
const collection = { id: 'c', kind: 'group_collection', title: '餐费', sender: 'user', createdAt: 1, amount: 100, participants: ['user', 'a', 'b'], shares: splitShares(100, ['user', 'a', 'b']), initiatorId: 'user', responses: { user: 'settled', a: 'pending', b: 'pending' } };
assert.equal(collectionProgress(collection).target, 66);
assert.equal(applyToolAction(collection, { eventId: 'c', action: 'join' }, 'stranger', '陌生人', 2), undefined);
const joined = applyToolAction(collection, { eventId: 'c', action: 'join' }, 'a', '甲', 2);
assert.equal(collectionProgress(joined).received, 33);
assert.equal(applyToolAction(joined, { eventId: 'c', action: 'join' }, 'a', '甲', 3), undefined);
assert.equal(parseToolReply('好。[[XZ_TOOL:{"eventId":"c","action":"fake"}]]').action, undefined);
assert.equal(parseToolReply('好。[[XZ_TOOL:{"eventId":"c","action":"chain"}]]').action, undefined);
assert.equal(parseToolReply('好。[[XZ_TOOL:invalid]]').text, '好。');
pass('exact currency shares, limits, participant authorization and duplicate protection');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
await context.addInitScript(() => {
  for (const key of ['auto-moments', 'auto-diary', 'proactive-enabled']) localStorage.setItem(`xiaozhang-${key}`, 'false');
  localStorage.setItem('xiaozhang-pet-position', JSON.stringify({ x: 3, y: 430 }));
});
let mode = 'normal', forceId, failure = false, rateCalls = 0;
const calls = [], errors = [];
await context.route('https://tool-test.invalid/**', route => {
  const body = route.request().postDataJSON(); calls.push(body);
  if (failure) return route.fulfill({ status: 503, body: 'temporary error' });
  const prompt = body.messages[0].content;
  const name = prompt.match(/只以“([^”]+)”身份发言/)?.[1] || '张起灵';
  if (mode === 'rate' && ++rateCalls === 2) return route.fulfill({ status: 429, headers: { 'Retry-After': '60', 'Access-Control-Expose-Headers': 'Retry-After' }, body: 'rate limited' });
  const rows = prompt.split('\n').flatMap(line => { try { const v = JSON.parse(line); return v.eventId && v.type ? [v] : []; } catch { return []; } });
  const event = rows.find(r => mode === 'collection' ? r.type === 'group_collection' : mode === 'chain' ? r.type === 'chain' : mode === 'accept' ? r.type === 'transfer' : false);
  let reply = `${name}：好，我记下了。`;
  if (mode === 'restricted') {
    const snapshot = JSON.parse(prompt.split('\n').find(line => line.startsWith('收款快照：')).slice('收款快照：'.length));
    assert.deepEqual(snapshot.participants.map(p => p.id), ['user', 'wu-xie']);
    assert.equal(snapshot.selected, name === '吴邪');
    reply = `${name}：${snapshot.selected ? '我付好了。' : '越权付款不应展示。'}[[XZ_TOOL:${JSON.stringify({ eventId: snapshot.eventId, action: 'join' })}]]`;
  }
  if (event || forceId) reply += `[[XZ_TOOL:${JSON.stringify({ eventId: forceId || event.eventId, action: mode === 'chain' ? 'chain' : mode === 'accept' ? 'accept' : 'join', content: mode === 'chain' ? `${name}带一份茶` : undefined })}]]`;
  if (mode === 'role-transfer') reply = '收下。[[XZ_ACTION:{"type":"transfer","amount":12.34,"note":"回程车费"}]]';
  if (mode === 'role-gift') reply = '给你留了茶。[[XZ_ACTION:{"type":"gift","title":"一盒茶","note":"路上带回来的"}]]';
  if (mode === 'group-gift') reply = `${name}：给你留了茶。[[XZ_ACTION:{"type":"gift","title":"一盒茶","note":"路上带回来的"}]]`;
  return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: null } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: [DONE]\n\n` });
});
const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
const origin = process.env.CONTACT_TEST_URL || 'http://127.0.0.1:4175';
const ready = () => page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
const idle = () => page.waitForFunction(() => !document.querySelector('#send').disabled);
async function db(store, value) {
  return page.evaluate(({ store, value }) => new Promise((resolve, reject) => {
    const open = indexedDB.open('xiaozhang-pwa'); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const d = open.result, t = d.transaction(store, value === undefined ? 'readonly' : 'readwrite'), r = value === undefined ? t.objectStore(store).getAll() : t.objectStore(store).put(value); t.oncomplete = () => { d.close(); resolve(r.result); }; t.onerror = () => reject(t.error); };
  }), { store, value });
}
const eventRows = () => db('lifeEvents');
const messageRows = () => db('messages');
async function reload() { await page.reload(); await ready(); }
async function open(kind) { await page.click('#plus-open'); await page.click(`#plus-${kind}`); await page.waitForSelector('#transaction-dialog[open]'); }
async function send(text) { await page.fill('#draft', text); await page.click('#send'); await idle(); }
async function card(id) { const loc = page.locator(`[data-tool-card="${id}"]`); await loc.waitFor(); await page.waitForFunction(id => document.querySelector(`[data-tool-card="${id}"]`)?.classList.contains('tool-chat-card'), id); return loc; }
async function viewCard(id) { await (await card(id)).click(); await page.waitForSelector('#transaction-dialog[open]'); }
async function close() { await page.click('#tool-back'); }
async function submitTool() {
  // The atomic write closes the dialog before the async reply starts. Observe the
  // actual busy transition so we cannot confuse that gap with a finished reply.
  await page.evaluate(() => {
    window.__toolReplyStarted = new Promise(resolve => {
      const send = document.querySelector('#send');
      const observer = new MutationObserver(() => { if (send.disabled) { observer.disconnect(); resolve(); } });
      observer.observe(send, { attributes: true, attributeFilter: ['disabled'] });
    });
  });
  await page.click('#tool-send');
  await page.evaluate(() => window.__toolReplyStarted);
  await idle();
}
const groupId = 'tools-test-group';
try {
  await page.clock.install();
  await page.goto(origin); await ready();
  const now = Date.now();
  await db('kv', { key: 'api-profile', value: { baseUrl: 'https://tool-test.invalid/v1', apiKey: 'synthetic-key', model: 'synthetic', temperature: .8 } });
  await db('kv', { key: 'character-settings', value: { userName: '小满', userPreferences: '', relationship: '', customPrompt: '', worldBook: '', updatedAt: now } });
  await db('groups', { id: groupId, title: '晚饭小群', userName: '小满', members: [{ id: 'zhang-qiling', name: '张起灵', characterId: 'zhang-qiling', persona: '', enabled: true }, { id: 'wu-xie', name: '吴邪', characterId: 'wu-xie', persona: '', enabled: true }, { id: 'xie-yuchen', name: '解雨臣', characterId: 'xie-yuchen', persona: '', enabled: true }], replyMode: 'all', createdAt: now, updatedAt: now });
  await db('kv', { key: 'active-session', value: groupId }); await reload();
  await page.waitForFunction(() => document.querySelector('#conversation-name').textContent === '晚饭小群');
  mode = 'collection';
  await open('group-collection'); await page.fill('#tool-subject', '今晚的晚饭'); await page.fill('#tool-amount', '100.01');
  assert.match(await page.locator('#tool-split-preview').textContent(), /需收 ¥75.00/);
  await page.screenshot({ path: new URL('collection-compose.png', folder).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  await submitTool();
  let collection = (await eventRows()).find(e => e.kind === 'group_collection'); assert.ok(collection);
  assert.equal(collection.responses.user, 'settled'); assert.equal(Object.values(collection.responses).filter(v => v === 'settled').length, 4);
  assert.equal(collection.status, 'settled'); assert.equal(collectionProgress(collection).received, 7500);
  assert.equal((await messageRows()).filter(m => m.metadata?.toolNotice && m.metadata.lifeEventId === collection.id).length, 3);
  await viewCard(collection.id);
  assert.equal(await page.locator('.tool-participant').count(), 4);
  assert.match(await page.locator('.tool-collection-hero').textContent(), /已收齐.*已收到¥75.00/);
  const dialogBox = await page.locator('#transaction-dialog').boundingBox(); assert.equal(dialogBox.width, 390); assert.equal(dialogBox.height, 844);
  await page.screenshot({ path: new URL('collection-detail.png', folder).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  await close(); await reload(); assert.match(await (await card(collection.id)).textContent(), /已收齐/);
  forceId = collection.id; const noticesBefore = (await messageRows()).filter(m => m.metadata?.toolNotice).length;
  await send('大家再确认一下'); assert.equal((await messageRows()).filter(m => m.metadata?.toolNotice).length, noticesBefore); forceId = undefined;
  assert.doesNotMatch(await page.locator('#messages').textContent(), /XZ_TOOL|eventId|XZ_ACTION/);
  pass('collection full-screen create/detail, member decisions, cent totals, notices, reload and duplicate model actions');

  mode = 'restricted'; await open('group-collection'); await page.fill('#tool-subject', '只选吴邪的收款'); await page.fill('#tool-amount', '20');
  await page.locator('[name="tool-member"][value="zhang-qiling"]').uncheck();
  await page.locator('[name="tool-member"][value="xie-yuchen"]').uncheck();
  const restrictedCallsBefore = calls.length;
  await submitTool();
  assert.equal(calls.length, restrictedCallsBefore + 1, 'only checked members should be requested to respond to a collection');
  await send('大家核对一下刚才的收款');
  const restricted = (await eventRows()).find(e => e.title === '只选吴邪的收款');
  assert.deepEqual(restricted.participants, ['user', 'wu-xie']);
  assert.deepEqual(restricted.responses, { user: 'settled', 'wu-xie': 'settled' });
  assert.equal(collectionProgress(restricted).received, 1000);
  const restrictedMessages = await messageRows();
  assert.equal(restrictedMessages.filter(m => m.metadata?.toolNotice && m.metadata.lifeEventId === restricted.id).length, 1);
  assert.doesNotMatch(JSON.stringify(restrictedMessages), /越权付款不应展示/);
  assert.match(restrictedMessages.find(m => m.metadata?.lifeEventId === restricted.id && !m.metadata.toolNotice).content, /参与名单：.*吴邪.*其他群成员无需付款/);
  assert.match(await page.locator('#error').textContent(), /无权限或已处理/);
  await reload(); assert.deepEqual((await eventRows()).find(e => e.id === restricted.id), restricted);
  pass('unchecked members receive exact roster and cannot save payment or false paid prose; selected payment survives reload');

  // A distinct synthetic endpoint starts a clean request lane; no real quota consumed.
  await db('kv', { key: 'api-profile', value: { baseUrl: 'https://tool-test.invalid/rate/v1', apiKey: 'synthetic-key', model: 'synthetic', temperature: .8 } });
  await reload(); mode = 'rate';
  await send('测试中途限流');
  const rateTurn = (await messageRows()).find(m => m.role === 'user' && m.content === '测试中途限流');
  const repliesToRateTurn = async () => (await messageRows()).filter(m => m.metadata?.replyToUserId === rateTurn.id);
  assert.equal(rateCalls, 2); assert.equal((await repliesToRateTurn()).length, 1);
  assert.match(await page.locator('#error').textContent(), /429.*60 秒/);
  async function retryRateTurn() {
    await page.locator(`[data-message-id="${rateTurn.id}"] .bubble`).dispatchEvent('contextmenu');
    await page.click(`[data-retry-id="${rateTurn.id}"]`); await idle();
  }
  await retryRateTurn(); assert.equal(rateCalls, 2); assert.equal((await repliesToRateTurn()).length, 1);
  // Advance the browser clock across reloads. A one-document Date.now patch
  // disappears on reload and would correctly re-enter the persisted cooldown.
  await page.clock.fastForward(61000);
  await retryRateTurn();
  assert.equal(rateCalls, 4); assert.equal((await repliesToRateTurn()).length, 3);
  assert.equal(new Set((await repliesToRateTurn()).map(m => m.metadata.groupMemberId)).size, 3);
  pass('HTTP 429 stops remaining members; cooldown retry makes no network request; resume preserves completed replies without duplicates');
  mode = 'normal';

  mode = 'chain'; await open('group-roll'); await page.fill('#tool-subject', '周末带什么'); await page.fill('#tool-note', '一人写一份就好'); await page.fill('#tool-chain-content', '我带点心'); await submitTool();
  let chain = (await eventRows()).find(e => e.kind === 'chain'); assert.equal(chain.chainItems.length, 4);
  await viewCard(chain.id); await page.fill('#tool-chain-edit', '我改带蛋糕'); await page.click('#tool-chain-form button');
  await page.waitForFunction(() => [...document.querySelectorAll('.tool-chain-list p')].some(p => p.textContent === '我改带蛋糕'));
  chain = (await eventRows()).find(e => e.id === chain.id); assert.equal(chain.chainItems.length, 4); assert.equal(chain.chainItems[0].content, '我改带蛋糕');
  await page.screenshot({ path: new URL('chain-detail.png', folder).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  await close(); await send('再核对一下接龙'); chain = (await eventRows()).find(e => e.id === chain.id); assert.equal(chain.chainItems.length, 4);
  await reload(); await viewCard(chain.id); assert.equal(await page.locator('.tool-chain-list article').count(), 4); await close();
  pass('group chain has real numbered entries, role participation, edit-own, no duplicates and reload recovery');

  mode = 'accept'; await open('transfer'); await page.selectOption('#tool-recipient', 'wu-xie'); await page.fill('#tool-amount', '9.90'); await page.fill('#tool-note', '晚饭的'); await submitTool();
  const transfer = (await eventRows()).find(e => e.kind === 'transfer'); assert.equal(transfer.recipientId, 'wu-xie'); assert.equal(transfer.status, 'settled');
  assert.equal((await messageRows()).filter(m => m.metadata?.toolNotice && m.metadata.lifeEventId === transfer.id).length, 1);
  await viewCard(transfer.id); assert.match(await page.locator('.tool-transfer-hero').textContent(), /¥9.90.*已收款/); await close();
  pass('group transfer selects actual recipient and only that member can accept');

  mode = 'group-gift'; await send('你们有什么带回来的吗');
  const groupGifts = (await eventRows()).filter(e => e.kind === 'gift' && e.groupId === groupId);
  assert.equal(groupGifts.length, 3); assert.equal(new Set(groupGifts.map(e => e.initiatorId)).size, 3);
  for (const e of groupGifts) {
    assert.equal(e.recipientId, 'user'); assert.equal(e.status, 'pending');
    const message = (await messageRows()).find(m => m.metadata?.lifeEventId === e.id);
    assert.equal(message.metadata.groupMemberId, e.initiatorId);
    assert.equal(message.speakerId, e.people[0].name);
  }
  await viewCard(groupGifts[0].id); await page.click('[data-tool-action="accept"]');
  await page.waitForFunction(() => document.querySelector('.tool-transfer-hero')?.textContent.includes('已收下')); await close();
  assert.equal((await eventRows()).find(e => e.id === groupGifts[0].id).status, 'settled');
  assert.doesNotMatch(await page.locator('#messages').textContent(), /XZ_ACTION|XZ_TOOL|eventId/);
  pass('group members can initiate real linked gift cards with their own identities; user receipt persists');

  await db('kv', { key: 'active-session', value: 'private' }); await reload();
  mode = 'role-transfer'; await send('需要车费');
  const incoming = (await eventRows()).find(e => e.kind === 'transfer' && e.sender === 'xiaopingzi'); assert.equal(incoming.status, 'pending');
  await viewCard(incoming.id); await page.click('[data-tool-action="accept"]');
  await page.waitForFunction(() => document.querySelector('.tool-transfer-hero')?.textContent.includes('已收款'));
  assert.equal((await eventRows()).find(e => e.id === incoming.id).status, 'settled');
  await close(); await reload(); assert.match(await (await card(incoming.id)).textContent(), /已收款/);
  mode = 'role-gift'; await send('有什么想给我'); const gift = (await eventRows()).find(e => e.kind === 'gift' && !e.groupId);
  await viewCard(gift.id); await page.click('[data-tool-action="decline"]'); await page.waitForFunction(() => document.querySelector('.tool-transfer-hero')?.textContent.includes('未收下'));
  assert.equal((await eventRows()).find(e => e.id === gift.id).status, 'declined'); await close();
  pass('model-created transfer/gift cards are linked to real records; receive/return persist');

  failure = true; const count = (await eventRows()).length;
  await open('transfer'); await page.fill('#tool-amount', '10.00'); await submitTool();
  const pending = (await eventRows()).find(e => e.kind === 'transfer' && e.sender === 'user' && !e.groupId);
  assert.equal((await eventRows()).length, count + 1); assert.equal(pending.status, 'pending'); assert.match(await page.locator('#error').textContent(), /503/);
  assert.equal((await messageRows()).filter(m => m.metadata?.lifeEventId === pending.id).length, 1);
  pass('503 leaves the sent card saved and pending without a fabricated receipt');

  const legacy = { id: 'legacy-collection', kind: 'group_collection', title: '旧收款', groupId, amount: 900, sender: 'user', participants: ['user', 'wu-xie'], responses: { user: 'joined', 'wu-xie': 'pending' }, createdAt: now - 10000 };
  await db('lifeEvents', legacy); await db('messages', { id: 'legacy-message', role: 'user', kind: 'event', content: '旧收款原文', metadata: { event: 'group_collection', lifeEventId: legacy.id }, createdAt: now - 10000, sessionId: groupId });
  await db('kv', { key: 'active-session', value: groupId }); await reload(); await viewCard(legacy.id);
  assert.match(await page.locator('.tool-detail-sheet').first().textContent(), /旧收款/); await close();
  assert.deepEqual((await eventRows()).find(e => e.id === legacy.id), legacy);
  const legacyChain = { id: 'legacy-chain', kind: 'chain', title: '旧接龙', groupId, sender: 'user', participants: ['wu-xie'], chainItems: [{ id: 'old-entry', name: '我', content: '原有内容', createdAt: now - 9000 }], status: 'pending', createdAt: now - 9000 };
  await db('lifeEvents', legacyChain); await db('messages', { id: 'legacy-chain-message', role: 'user', kind: 'event', content: '旧接龙原文', metadata: { event: 'chain', lifeEventId: legacyChain.id }, createdAt: now - 9000, sessionId: groupId });
  await reload(); await viewCard(legacyChain.id); await page.fill('#tool-chain-edit', '新增我的内容'); await page.click('#tool-chain-form button');
  await page.waitForFunction(() => document.querySelectorAll('.tool-chain-list article').length === 2); await close();
  const restoredChain = (await eventRows()).find(e => e.id === legacyChain.id);
  assert.deepEqual(restoredChain.chainItems[0], legacyChain.chainItems[0]); assert.equal(restoredChain.chainItems[1].ownerId, 'user');
  await context.setOffline(true); await viewCard(chain.id); await page.fill('#tool-chain-edit', '离线也能保存'); await page.click('#tool-chain-form button'); await page.waitForFunction(() => document.querySelector('.tool-chain-list').textContent.includes('离线也能保存')); await close(); await context.setOffline(false);
  assert.equal((await eventRows()).find(e => e.id === chain.id).chainItems[0].content, '离线也能保存');
  pass('legacy rows render unchanged, unattributed chain entries are preserved, and local chain edits work offline');

  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 }); await viewCard(collection.id);
    const overflow = await page.locator('#transaction-dialog').evaluate(e => e.scrollWidth > e.clientWidth || e.querySelector('.tool-scroll').scrollWidth > e.querySelector('.tool-scroll').clientWidth);
    assert.equal(overflow, false, `horizontal overflow at ${width}px`); await close();
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: new URL('chat-cards.png', folder).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  assert.deepEqual(errors, []);
  pass('320/390/768/1280px layouts have no horizontal overflow or page errors');
  await writeFile(new URL('results.json', folder), JSON.stringify({ checks, errors, calls: calls.length }, null, 2));
} finally { await context.close(); await browser.close(); }
