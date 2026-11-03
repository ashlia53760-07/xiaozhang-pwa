// Isolated real-browser verification: layout, avatars, saved game talk and honest failures.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const origin = process.env.LEISURE_TEST_URL || 'http://127.0.0.1:4174';
const folder = new URL('../.local-review/leisure-polish/', import.meta.url);
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block' });
const page = await context.newPage(), errors = [], calls = [], checks = [];
let responseMode = 'success';
page.on('pageerror', e => errors.push(e.message));
await context.route('https://polish-test.invalid/**', async route => {
  calls.push(route.request().postDataJSON());
  if (responseMode === 'network') return route.abort('failed');
  await route.fulfill({ status: responseMode === 'http' ? 503 : 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: responseMode === 'null' ? null : '不急。这一手，我等你想好。' } }] }) });
});
async function db(store, op, value) {
  return page.evaluate(({ store, op, value }) => new Promise((resolve, reject) => {
    const r = indexedDB.open('xiaozhang-pwa'); r.onerror = () => reject(r.error);
    r.onsuccess = () => { const d = r.result, t = d.transaction(store, op === 'put' ? 'readwrite' : 'readonly'), s = t.objectStore(store), q = op === 'put' ? s.put(value) : op === 'get' ? s.get(value) : s.getAll(); let result;
      q.onsuccess = () => result = q.result; t.oncomplete = () => { d.close(); resolve(result); }; t.onabort = () => reject(t.error); };
  }), { store, op, value });
}
const get = async key => (await db('kv', 'get', key))?.value;
const put = (key, value) => db('kv', 'put', { key, value });
const pass = text => { checks.push(text); console.log('PASS', text); };
async function ready() { await page.waitForSelector('#play-open', { state: 'attached' }); await page.waitForTimeout(100); }
async function feature(id) { if (!await page.locator('#topbar-menu').isVisible()) await page.click('#topbar-menu-toggle'); await page.click('#' + id); }
async function play() { await feature('play-open'); await page.waitForSelector('#play-dialog .game-players'); }
async function tab(id) { await page.click(`[data-action="game-tab"][data-id="${id}"]`); await page.waitForSelector(`[data-action="game-tab"][data-id="${id}"][aria-pressed="true"]`); }
async function close(id) { await page.click(`#${id}-dialog .dialog-head button`); }
async function screenshot(name) { await page.screenshot({ path: fileURLToPath(new URL(name + '.png', folder)) }); }
async function layout() {
  const metrics = await page.locator('#play-dialog').evaluate(d => {
    const rect = s => d.querySelector(s).getBoundingClientRect().toJSON();
    return { dialog: d.getBoundingClientRect().toJSON(), stage: rect('.game-table-scroll'), presence: rect('.game-presence'), chat: rect('.game-conversation'), formWidth: d.querySelector('form').clientWidth, formScroll: d.querySelector('form').scrollWidth, height: innerHeight, width: innerWidth };
  });
  assert.equal(metrics.dialog.width, metrics.width); assert.equal(metrics.dialog.height, metrics.height);
  assert.ok(metrics.formScroll <= metrics.formWidth + 1, JSON.stringify(metrics));
  assert.ok(metrics.presence.top >= 0 && metrics.presence.bottom <= metrics.height, JSON.stringify(metrics));
  assert.ok(metrics.chat.top >= 0 && metrics.chat.bottom <= metrics.height + 1, JSON.stringify(metrics));
  assert.ok(metrics.stage.height >= 60, JSON.stringify(metrics));
  assert.ok(metrics.stage.right <= metrics.width && metrics.chat.right <= metrics.width, JSON.stringify(metrics));
}
try {
  await page.goto(origin); await ready();
  await page.evaluate(() => new Promise((resolve, reject) => {
    const c = document.createElement('canvas'); c.width = c.height = 40; const ctx = c.getContext('2d'); ctx.fillStyle = '#8b9d91'; ctx.fillRect(0, 0, 40, 40);
    c.toBlob(blob => { const r = indexedDB.open('xiaozhang-pwa'); r.onerror = () => reject(r.error); r.onsuccess = () => { const d = r.result, t = d.transaction(['media', 'kv'], 'readwrite');
      for (const role of ['user', 'character']) { const id = 'polish-' + role; t.objectStore('media').put({ id, blob, mime: 'image/png', origin: 'test', createdAt: Date.now() }); t.objectStore('kv').put({ key: role + '-avatar', value: id }); }
      t.oncomplete = () => { d.close(); resolve(); }; t.onabort = () => reject(t.error); };
    });
  }));
  await play(); await page.click('[data-action="puzzle-new"]');
  await page.waitForFunction(() => [...document.querySelectorAll('.game-portrait img')].length === 2 && [...document.querySelectorAll('.game-portrait img')].every(i => i.naturalWidth === 40 && i.src.startsWith('blob:')));
  for (const theme of ['warm', 'ink', 'night']) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 }); await layout();
      for (const game of ['puzzle', 'gomoku', 'flight']) {
        await tab(game);
        if (await page.locator(`[data-action="${game === 'gomoku' ? 'gomoku-new' : game === 'flight' ? 'flight-new' : 'puzzle-new'}"]`).isVisible() && !await get('play-state').then(s => s[game])) await page.click(`[data-action="${game}-new"]`);
        await layout();
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.game-tabs button[aria-pressed="true"]')).backgroundColor === 'rgb(41, 43, 44)');
        if (width === 390 && theme !== 'night') await screenshot(`${game}-${theme}-mobile`);
      }
      if (width === 1280 && theme === 'ink') await screenshot('game-desktop');
    }
  }
  pass('full-screen games, configured Blob avatars, visible partners/dialogue and charcoal tabs across three themes and 320/390/1280 widths');
  await page.setViewportSize({ width: 390, height: 844 }); await tab('gomoku');
  await page.locator('.game-table-scroll').evaluate(e => e.scrollTop = 0);
  const board = await page.locator('.gomoku-board').boundingBox(), stage = await page.locator('.game-table-scroll').boundingBox();
  assert.ok(board.y >= stage.y && board.y + board.height <= stage.y + stage.height + 1, 'the board should fit without setup controls pushing it below the fold');
  await page.fill('#game-draft', '这一手我再想想。'); await page.click('[data-action="game-send"]');
  await page.waitForFunction(() => document.querySelector('#play-dialog .leisure-status').textContent.includes('配置模型'));
  assert.equal(await page.inputValue('#game-draft'), '这一手我再想想。'); assert.equal(calls.length, 0);
  await close('play'); await put('game-model-profile', { baseUrl: 'https://polish-test.invalid/v1', model: 'synthetic-quick-model', apiKey: 'synthetic-not-a-real-key' }); await play();
  await page.fill('#game-draft', '这一手我再想想。'); await page.click('[data-action="game-send"]');
  await page.waitForSelector('.game-chat-history .game-chat-row.assistant');
  assert.equal(await page.inputValue('#game-draft'), ''); assert.equal(calls.length, 1);
  assert.match(calls[0].messages.at(-1).content, /这一手我再想想/);
  assert.equal((await get('play-state')).dialogue.length, 2); assert.equal((await db('messages', 'all')).length, 0);
  await page.reload(); await ready(); await play(); assert.match(await page.locator('.game-chat-history').innerText(), /这一手我再想想/);
  await page.fill('#game-draft', '你的白棋落在哪里？'); await page.click('[data-action="game-send"]');
  await page.waitForFunction(() => document.querySelectorAll('.game-chat-row').length === 4);
  assert.equal(calls[1].messages.length, 4); assert.equal(calls[1].messages[1].content, '这一手我再想想。');
  for (const mode of ['null', 'http', 'network']) {
    responseMode = mode; await page.fill('#game-draft', '出错后也保留这句话'); await page.click('[data-action="game-send"]');
    await page.waitForFunction(() => /没有返回文字|HTTP 503|无法连接/.test(document.querySelector('#play-dialog .leisure-status')?.textContent));
    assert.equal(await page.inputValue('#game-draft'), '出错后也保留这句话'); assert.equal((await get('play-state')).dialogue.length, 4);
  }
  pass('typed game talk reaches the explicit model request, saves/restores per game, includes short prior dialogue and keeps drafts on missing configuration/null/HTTP/network failures');
  await page.setViewportSize({ width: 390, height: 500 }); await layout(); await screenshot('game-keyboard-height');
  await page.setViewportSize({ width: 320, height: 568 }); await layout();
  pass('partners, composer and scrollable tabletop remain within simulated keyboard/short-screen viewports');
  await close('play');
  for (const name of ['travel', 'journey']) {
    const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
    await writeFile(new URL(name + '.mjs', folder), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replaceAll('"./travel"', '"./travel.mjs"'));
  }
  const { initialTravel } = await import(new URL('travel.mjs', folder));
  const { planJourney, beginJourney, advanceJourney } = await import(new URL('journey.mjs', folder));
  let travel;
  for (let n = 0; n < 100; n++) {
    const at = Date.now() - 10 * 86400000; travel = initialTravel(at - 20 * 86400000, 1); travel.nextDepartureAt = at;
    planJourney(travel, at, 'visual-trip-' + n); beginJourney(travel, travel.journey.plan.notBefore); advanceJourney(travel, at + 5 * 86400000);
    if (travel.items.length) break;
  }
  assert.ok(travel.items.length); travel.settings.enabled = false; await put('travel-state', travel); await page.reload(); await ready(); await feature('travel-open');
  for (const theme of ['warm', 'ink']) {
    await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(t => document.documentElement.dataset.theme = t, theme);
    for (const section of ['home', 'map', 'events', 'journals', 'collection']) {
      await page.click(`.journey-nav [data-id="${section}"]`);
      if (section === 'map') assert.equal(await page.locator('.journey-node').count(), travel.journey.events.filter(e => e.node).length);
      if (section === 'events') { const envelope = page.locator('.journey-envelope').first(); await envelope.locator('summary').click(); assert.equal(await envelope.evaluate(e => e.open), false); await envelope.locator('summary').click(); assert.equal(await envelope.evaluate(e => e.open), true); }
      if (section === 'collection') assert.equal(await page.locator('.keepsake-object svg').count(), travel.items.length);
      await screenshot(`journey-${section}-${theme}`);
    }
  }
  pass('real saved map-node counts, foldable letters, notebook and collection artwork remain connected to existing journey records');
  assert.deepEqual(errors, []);
  await writeFile(new URL('results.json', folder), JSON.stringify({ passed: true, origin, checks, pageErrors: errors, requests: calls.length, physicalIOS: 'not tested; Chrome touch/short-viewport simulation only', liveProvider: 'not tested; synthetic compatible endpoint' }, null, 2));
} catch (error) { await screenshot('failure'); throw error; }
finally { await browser.close(); }
