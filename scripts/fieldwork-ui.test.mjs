import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = process.env.FIELDWORK_TEST_URL || 'http://127.0.0.1:4175/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
const page = await context.newPage();
const errors = [];
const adventureRequests = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('https://scene-test.invalid/**', async route => {
  const body = route.request().postDataJSON();
  adventureRequests.push(body);
  const identity = body.messages[0].content.includes('你是张起灵') ? '张起灵' : '吴邪';
  await route.fulfill({
    contentType: 'text/event-stream',
    body: `data: ${JSON.stringify({ choices: [{ delta: { content: `${identity}看了眼现场，示意先确认脚下的痕迹。` } }] })}\n\ndata: [DONE]\n\n`
  });
});
await context.addInitScript(() => {
  localStorage.setItem('xiaozhang-auto-moments', 'false');
  localStorage.setItem('xiaozhang-auto-diary', 'false');
  localStorage.setItem('xiaozhang-proactive-enabled', 'false');
  localStorage.setItem('xiaozhang-pet-position', JSON.stringify({ x: 8, y: 420 }));
});
const kv = async key => page.evaluate(key => new Promise((resolve, reject) => {
  const request = indexedDB.open('xiaozhang-pwa');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result, tx = db.transaction('kv', 'readonly'), get = tx.objectStore('kv').get(key);
    get.onsuccess = () => resolve(get.result?.value);
    get.onerror = () => reject(get.error);
    tx.oncomplete = () => db.close();
  };
}), key);
const storeRows = store => page.evaluate(store => new Promise((resolve, reject) => {
  const request = indexedDB.open('xiaozhang-pwa');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result, tx = db.transaction(store, 'readonly'), get = tx.objectStore(store).getAll();
    get.onsuccess = () => resolve(get.result);
    get.onerror = () => reject(get.error);
    tx.oncomplete = () => db.close();
  };
}), store);
try {
  await page.goto(origin);
  await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
  await page.click('#topbar-menu-toggle');
  await page.click('#forum-open');
  await page.waitForSelector('#fieldwork-dialog[open]');
  assert.equal(await page.locator('.fieldwork-tabs').count(), 0, 'tools are standalone pages without an in-dialog tab row');
  assert.equal(await page.locator('[data-panel=forum]:visible').count(), 1);
  assert.equal(await page.locator('.forum-thread').count(), 5, 'forum home should paginate thread summaries');
  assert.ok(await page.locator('.forum-pinned-note').isVisible(), 'forum should explain the status of fictional threads');
  assert.ok(await page.locator('[data-forum-board]').count() >= 3, 'forum should expose data-backed board filters');

  const firstThread = page.locator('.forum-thread').first();
  const firstThreadId = await firstThread.locator('[data-forum-open]').first().getAttribute('data-forum-open');
  await page.evaluate(async postId => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('xiaozhang-pwa'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction('kv', 'readwrite'), store = tx.objectStore('kv'), request = store.get('fieldwork-data');
    await new Promise((resolve, reject) => { request.onsuccess = () => { const data = request.result.value; const post = data.forumPosts.find(row => row.id === postId); post.floors.push(...Array.from({ length: 7 }, (_, index) => ({ id: `qa-floor-${index}`, author: `测试山友${index + 1}`, text: `第${index + 1}条用于验证回复分页的本地测试内容。`, createdAt: Date.now() + index }))); store.put({ key: 'fieldwork-data', value: data }); }; tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
  }, firstThreadId);
  await page.locator('[data-close]').click();
  await page.click('#topbar-menu-toggle');
  await page.click('#forum-open');
  await page.waitForSelector('#fieldwork-dialog[open]');
  await firstThread.locator('[data-forum-open]').first().click();
  await page.waitForSelector('[data-forum-detail]:not([hidden])');
  assert.ok(await page.locator('.forum-detail .forum-floor').count() >= 3, 'thread detail should show numbered reply floors');
  assert.ok(await page.locator('.forum-bottom-nav').isVisible(), 'forum navigation should remain available in thread detail');
  assert.equal(await page.locator('[data-forum-reply-pagination] button[data-forum-reply-page]').count(), 5, 'thread replies should paginate when there are more than five floors');
  await page.locator('[data-forum-reply-pagination] button[aria-current="false"][data-forum-reply-page="2"]').click();
  assert.ok((await page.locator('.forum-replies').innerText()).includes('7F'), 'reply pagination should display the correct continuing floor numbers');
  await page.locator('[data-forum-reply-pagination]').getByRole('button', { name: '1', exact: true }).click();
  await page.locator('#forum-reply-text').fill('我找到了旧版地图目录，等会儿补来源。');
  await page.locator('.forum-reply-composer button').click();
  await page.waitForFunction(() => document.querySelector('.forum-detail')?.textContent?.includes('我找到了旧版地图目录'));
  assert.ok((await kv('fieldwork-data')).forumPosts.find(post => post.id === firstThreadId).floors.some(floor => floor.author === '我'));
  await page.locator('[data-forum-nav-boards]').click();
  assert.equal(await page.locator('[data-forum-detail]:visible').count(), 0, 'bottom board navigation should return from detail to the thread list');
  assert.equal(await page.locator('[data-forum-home]:visible').count(), 1);
  await page.locator('[data-forum-nav-search]').click();
  assert.equal(await page.evaluate(() => document.activeElement?.matches('[data-forum-search] input')), true, 'bottom search navigation should focus the list search control');
  await page.locator('[data-forum-nav-compose]').click();
  await page.locator('[data-forum-compose] input[name=title]').fill('本地测试：旧地图目录');
  await page.locator('[data-forum-compose] textarea[name=text]').fill('补充一条供测试的论坛正文，保存后应能进入楼层详情。');
  await page.locator('[data-forum-compose] button.fieldwork-primary').click();
  await page.waitForFunction(() => document.querySelector('.forum-detail')?.textContent?.includes('本地测试：旧地图目录'));
  assert.ok((await kv('fieldwork-data')).forumPosts.some(post => post.source === 'user' && post.title === '本地测试：旧地图目录'));
  await page.locator('[data-forum-back]').click();
  await page.locator('[data-forum-search] input').fill('拓片');
  await page.locator('[data-forum-search] button').click();
  assert.ok(await page.locator('.forum-thread').count() > 0, 'forum search should filter stored posts');
  await page.locator('[data-forum-nav-home]').click();
  await page.locator('.forum-pagination button[data-forum-page="2"]').first().click();
  assert.ok(await page.locator('.forum-thread').count() > 0, 'forum pagination should change the visible page');

  await page.locator('[data-close]').click();
  await page.click('#topbar-menu-toggle');
  await page.click('#browser-open');
  await page.waitForFunction(() => document.querySelector('[data-page-title]')?.textContent === '内置浏览器');
  assert.equal(await page.locator('[data-page-title]').innerText(), '内置浏览器');
  assert.equal(await page.locator('[data-panel=forum]:visible').count(), 0, 'forum is not embedded in the browser page');
  assert.equal(await page.locator('[data-browser-home]:visible').count(), 1, 'browser should open on a distinct start page');
  assert.equal(await page.locator('[data-browser-results-view]:visible').count(), 0, 'search results should not leak into the browser home');
  await page.locator('[data-search]').fill('张家古楼 水路');
  await page.locator('.fieldwork-search button').click();
  assert.equal(await page.locator('[data-browser-home]:visible').count(), 0, 'search page should replace browser home content');
  assert.equal(await page.locator('[data-browser-results-view]:visible').count(), 1);
  assert.ok(await page.locator('.browser-page-result.kind-ad').count() > 0, 'simulated browser should mix in ads');
  assert.ok(await page.locator('.browser-page-result.kind-news').count() > 0, 'simulated browser should mix in news');
  await page.locator('[data-browser-back]').click();
  assert.equal(await page.locator('[data-browser-home]:visible').count(), 1, 'browser back should return to its start page');
  await page.locator('[data-browser-forward]').click();
  assert.equal(await page.locator('[data-browser-results-view]:visible').count(), 1, 'browser forward should restore the result page');
  await page.locator('[data-browser-tabs]').click();
  assert.equal(await page.locator('[data-browser-tabs-sheet]:visible').count(), 1, 'tab entry should open an actual tab switcher');
  await page.locator('[data-browser-new-tab]').click();
  assert.equal(await page.locator('[data-browser-home]:visible').count(), 1, 'new tab should have its own home page');
  await page.locator('[data-browser-tabs]').click();
  assert.equal(await page.locator('[data-browser-tab-count]').innerText(), '2');
  await page.locator('[data-browser-select-tab]').first().click();
  assert.equal(await page.locator('[data-browser-results-view]:visible').count(), 1, 'switching tabs should restore its search state');

  await page.locator('[data-close]').click();
  await page.click('#topbar-menu-toggle');
  await page.click('#forum-open');
  // The reference index is also launched independently from the feature menu.
  await page.locator('[data-close]').click();
  await page.click('#topbar-menu-toggle');
  await page.click('#reference-open');
  await page.waitForFunction(() => document.querySelector('[data-page-title]')?.textContent === '资料索引');
  assert.equal(await page.locator('[data-page-title]').innerText(), '资料索引');
  assert.equal(await page.locator('[data-panel=browser]:visible').count(), 0, 'reference index is independent');
  await page.locator('[data-close]').click();
  await page.click('#topbar-menu-toggle');
  await page.click('#forum-open');
  await page.locator('.forum-thread [data-forum-save]').first().click();
  await page.waitForFunction(() => document.querySelector('[data-page-title]')?.textContent === '线索整理');
  assert.equal(await page.locator('[data-panel=forum]:visible').count(), 0, 'clue organizer opens as its own page');
  await page.locator('[data-close]').click();
  await page.click('#topbar-menu-toggle');
  await page.click('#fieldwork-open');
  await page.waitForFunction(() => document.querySelector('[data-page-title]')?.textContent === '线索整理');
  assert.equal(await page.locator('[data-page-title]').innerText(), '线索整理', 'clue organizer has its own launcher entry');
  await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('xiaozhang-pwa');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const now = Date.now();
    const tx = db.transaction(['kv', 'groups'], 'readwrite');
    tx.objectStore('kv').put({ key: 'api-profile', value: { baseUrl: 'https://scene-test.invalid/v1', model: 'scene-test', apiKey: 'synthetic-only', temperature: .7, protocol: 'openai' } });
    tx.objectStore('groups').put({ id: 'offline-test-group', title: '线下同行组', members: [
      { id: 'zhang-qiling', characterId: 'zhang-qiling', name: '张起灵', persona: '沉稳谨慎', enabled: true },
      { id: 'wu-xie', characterId: 'wu-xie', name: '吴邪', persona: '观察细致', enabled: true }
    ], createdAt: now, updatedAt: now });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
    db.close();
  });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
  await page.click('#topbar-menu-toggle');
  await page.click('#fieldwork-open');
  await page.waitForFunction(() => document.querySelector('[data-page-title]')?.textContent === '线索整理');
  adventureRequests.length = 0;

  await page.click('[data-enter-adventure]');
  await page.waitForSelector('#meet-dialog[open]');
  assert.equal(await page.locator('#fieldwork-dialog[open]').count(), 0, 'opening an investigation launches the shared offline scene');
  assert.match(await page.locator('#meet-dialog h2').innerText(), /多人冒险/);
  await page.fill('#life-location', '秦岭旧道');
  await page.fill('#life-time', '入夜');
  await page.fill('#life-environment', '石阶潮湿，前方有微弱回声');
  await page.click('#life-begin');
  await page.waitForFunction(() => document.querySelector('#life-setup').hidden);
  assert.equal(await page.locator('#life-setup').isVisible(), false, 'scene confirmation opens the RP writer');
  await page.fill('#life-draft', '我停在石阶边，想先听听回声从哪里传来。');
  await page.click('#life-send');
  await page.waitForFunction(() => !document.querySelector('#life-send').disabled);
  assert.equal(adventureRequests.length, 2, 'two companions respond sequentially through the scene API');
  assert.match(await page.locator('#life-messages').innerText(), /张起灵|吴邪/);
  assert.equal(await page.locator('#life-messages .scene-message.assistant').count(), 2);
  assert.ok(adventureRequests.every(body => body.messages[0].content.includes('多人线下冒险的同一现场')));
  assert.ok(adventureRequests.every(body => body.messages.every(message => typeof message.content === 'string')));
  const independentLife = await kv('continuous-life');
  assert.equal(independentLife, undefined, 'adventure progress does not write the single-character life record');
  const data = await kv('fieldwork-data');
  assert.equal(data.investigations.length, 1);
  assert.equal(data.adventures.length, 1);
  assert.equal(data.adventures[0].active, true);
  assert.equal(data.adventures[0].location, '秦岭旧道');
  assert.equal(data.adventures[0].messages.filter(message => message.role === 'assistant').length, 2);
  const adventureId = data.adventures[0].id;

  await page.reload();
  await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
  const restored = await kv('fieldwork-data');
  assert.equal(restored.adventures[0].id, adventureId, 'local adventure ID survives reload');
  assert.equal(restored.adventures[0].active, true, 'active adventure survives reload');
  assert.equal(restored.adventures[0].messages.length, 3, 'scene transcript survives reload');
  assert.equal(await kv('continuous-life'), undefined, 'reload preserves separation from private offline sessions');
  assert.deepEqual(errors, [], `uncaught browser errors: ${errors.join('; ')}`);
  console.log('fieldwork ui: forum filtering, paging, post detail/replies/posting, simulated browser home/search/navigation/tabs, group creation, shared full-screen multiplayer offline RP, sequential role replies, reload persistence and single-life isolation passed');
} finally {
  await context.close();
  await browser.close();
}
