// Isolated synthetic data only. Also runs on a built/deployed preview via THEME_TEST_URL.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const origin = process.env.THEME_TEST_URL || 'http://127.0.0.1:5173';
const folder = new URL('../.local-review/theme-tests/', import.meta.url);
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const checks = [], errors = [];
function rgb(value) { return value.match(/[\d.]+/g).slice(0, 3).map(Number); }
function luminance(color) {
  return rgb(color).map(n => { const c = n / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; })
    .reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
}
function contrast(a, b) { const [lo, hi] = [luminance(a), luminance(b)].sort((a, b) => a - b); return (hi + .05) / (lo + .05); }
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: origin.startsWith('https:') ? 'allow' : 'block' });
  await context.addInitScript(() => localStorage.setItem('xiaozhang-pet-position', JSON.stringify({ x: 10, y: 440 })));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin); await page.waitForSelector('#draft');
  if (origin.startsWith('https:')) {
    await page.evaluate(() => navigator.serviceWorker.ready);
    assert.ok((await page.evaluate(() => caches.keys())).includes('xiaozhang-pwa-shell-v39'));
    checks.push('production service worker v38 installed');
  }
  const records = [
    { id: 'theme-assistant', role: 'assistant', kind: 'text', content: '外面风大，围巾带上。\n我在楼下等你。', createdAt: Date.now() - 10000, sessionId: 'private' },
    { id: 'theme-user', role: 'user', kind: 'text', content: '好，今天想和你一起去看电影。', createdAt: Date.now() - 5000, sessionId: 'private' },
    { id: 'theme-assistant-2', role: 'assistant', kind: 'text', content: '嗯。散场以后，走一会儿。', createdAt: Date.now(), sessionId: 'private' }
  ];
  await page.evaluate(records => new Promise((resolve, reject) => {
    const open = indexedDB.open('xiaozhang-pwa'); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result, tx = db.transaction('messages', 'readwrite');
      for (const message of records) tx.objectStore('messages').put(message);
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }), records);
  await page.reload(); await page.waitForSelector('[data-message-id="theme-assistant"]');
  async function feature(id) {
    if (!await page.locator('#topbar-menu').isVisible()) await page.click('#topbar-menu-toggle');
    await page.click(id);
  }
  async function close() { await page.keyboard.press('Escape'); await page.waitForSelector('dialog[open]', { state: 'hidden' }); }
  async function choose(theme) {
    await feature('#settings'); await page.click(`.theme-row [data-theme="${theme}"]`);
    assert.equal(await page.locator('.theme-row [aria-pressed="true"]').count(), 1);
    assert.equal(await page.locator(`.theme-row [data-theme="${theme}"]`).getAttribute('aria-pressed'), 'true');
    const swatches = await page.locator('.theme-row button').evaluateAll(buttons => buttons.map(el => getComputedStyle(el, '::before').backgroundImage));
    assert.equal(new Set(swatches).size, 5);
    await page.locator('.theme-row').scrollIntoViewIfNeeded();
    await page.screenshot({ path: fileURLToPath(new URL(`theme-picker-${theme}.png`, folder)), animations: 'disabled' });
    await close();
  }
  async function colors() {
    return page.evaluate(() => {
      const css = el => getComputedStyle(document.querySelector(el));
      return { background: css('.chat-panel').backgroundColor, image: css('.chat-panel').backgroundImage,
        incoming: css('.message-row.assistant .bubble').backgroundColor, incomingText: css('.message-row.assistant .bubble').color,
        outgoing: css('.message-row.user .bubble').backgroundColor, outgoingText: css('.message-row.user .bubble').color,
        incomingTime: css('.message-row.assistant .message-time').color, outgoingTime: css('.message-row.user .message-time').color,
        send: css('#send').color, sendBackground: css('#send').backgroundImage };
    });
  }
  const themes = {};
  for (const theme of ['warm', 'ink', 'night', 'rococo', 'bronze']) {
    await choose(theme); themes[theme] = await colors();
    for (const direction of ['incoming', 'outgoing']) {
      assert.ok(contrast(themes[theme][`${direction}Text`], themes[theme][direction]) >= 4.5, `${theme} ${direction}: readable bubble`);
    }
    if (theme === 'ink') {
      for (const key of ['background', 'incoming', 'outgoing']) {
        const channels = rgb(themes.ink[key]); assert.ok(Math.max(...channels) - Math.min(...channels) < 18, `monochrome ${key}`);
      }
      assert.ok(luminance(themes.ink.background) > .7, 'ink keeps its pale canvas');
      assert.ok(luminance(themes.ink.incoming) < .06, 'charcoal incoming bubbles anchor the pale canvas');
      assert.ok(luminance(themes.ink.outgoing) > .9, 'white outgoing bubbles contrast with charcoal');
      assert.ok(contrast(themes.ink.send, 'rgb(32, 32, 34)') >= 4.5, 'black send button has readable text');
      assert.ok(contrast(themes.ink.incomingTime, themes.ink.incoming) >= 4.5);
      assert.ok(contrast(themes.ink.outgoingTime, themes.ink.outgoing) >= 4.5);
    }
    await page.screenshot({ path: fileURLToPath(new URL(`chat-${theme}.png`, folder)), animations: 'disabled' });
    await page.reload(); await page.waitForSelector('.message-row');
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
    assert.equal(await page.evaluate(() => localStorage.getItem('xiaozhang-theme')), theme);
    assert.deepEqual(await colors(), themes[theme]);
    checks.push(`${theme}: real theme button / swatches / contrast / reload persistence`);
  }
  assert.equal(themes.warm.background, 'rgb(241, 245, 249)');
  assert.equal(themes.warm.incoming, 'rgb(252, 253, 255)');
  assert.equal(themes.warm.outgoing, 'rgb(227, 238, 251)');
  assert.equal(new Set(Object.values(themes).map(t => t.background)).size, 5);
  assert.notEqual(themes.ink.image, themes.warm.image);
  checks.push('warm keeps existing blue/white paper palette; ink and night are visually distinct');

  await choose('ink');
  const incomingBubble = page.locator('[data-message-id="theme-assistant"] .bubble');
  assert.equal(await incomingBubble.locator('.message-tools').isVisible(), false);
  await incomingBubble.scrollIntoViewIfNeeded();
  const box = await incomingBubble.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down();
  await page.waitForTimeout(580); await page.mouse.up();
  assert.equal(await incomingBubble.locator('.message-tools').isVisible(), true);
  const tools = await incomingBubble.locator('.message-copy').evaluate(el => ({ text: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }));
  assert.ok(contrast(tools.text, 'rgb(48, 48, 51)') >= 4.5, 'dark bubble long-press actions remain readable');
  await page.click('#draft');
  checks.push('charcoal bubble: real long press opens readable message actions');
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
    for (const selector of ['.app-shell', '#messages', '#composer']) {
      const size = await page.locator(selector).evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
      assert.ok(size.scroll <= size.width + 1, `${width} ${selector} has no horizontal overflow`);
    }
    await page.click('#plus-open'); assert.ok(await page.locator('#plus-menu').isVisible());
    const menu = await page.locator('#plus-menu').boundingBox(); assert.ok(menu.x >= 0 && menu.x + menu.width <= width + 1);
    await page.screenshot({ path: fileURLToPath(new URL(`ink-menu-${width}.png`, folder)), animations: 'disabled' });
    await page.click('#plus-open');
    await page.click('#conversation-details'); await page.waitForSelector('#role-dialog[open]');
    const role = await page.locator('#role-dialog').evaluate(el => ({ w: el.clientWidth, sw: el.scrollWidth }));
    assert.ok(role.sw <= role.w + 1); await close();
  }
  checks.push('320/390/1280px: chat, composer, plus menu and role dialog fit');
  await page.setViewportSize({ width: 390, height: 844 });
  await feature('#music-open'); await page.waitForSelector('#music-dialog[open]');
  await page.screenshot({ path: fileURLToPath(new URL('ink-music.png', folder)), animations: 'disabled' }); await close();
  await page.click('#plus-open'); await page.click('#voice-call-open'); await page.waitForSelector('#call-dialog[open]');
  assert.equal(await page.locator('#call-dialog').evaluate(el => Math.abs(el.clientHeight - innerHeight) < 2), true);
  await page.click('#call-end');
  await feature('#date-open'); await page.waitForSelector('#date-dialog[open]');
  assert.equal(await page.locator('#date-dialog').evaluate(el => Math.abs(el.clientHeight - innerHeight) < 2), true); await close();
  checks.push('ink music styling / voice and date fullscreen layouts retained');

  await feature('#settings');
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 80; c.height = 80; c.getContext('2d').fillRect(0, 0, 80, 80); return c.toDataURL().split(',')[1]; });
  await page.locator('#background').setInputFiles({ name: 'theme-bg.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.chat-panel')).backgroundImage.startsWith('url("blob:'));
  await close();
  for (const theme of ['warm', 'ink', 'rococo', 'bronze', 'night']) {
    await choose(theme);
    assert.ok((await colors()).image.startsWith('url("blob:'));
    await page.reload(); await page.waitForSelector('.message-row');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.chat-panel')).backgroundImage.startsWith('url("blob:'));
  }
  checks.push('custom uploaded background remains topmost across all themes and reloads');
  if (origin.startsWith('https:')) {
    await context.setOffline(true); await page.reload(); await page.waitForSelector('.message-row');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'night');
    assert.equal(await page.locator('.message-row').count(), 3);
    await choose('ink'); await page.reload(); await page.waitForSelector('.message-row');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'ink');
    checks.push('offline reload restores history and themes; offline theme switching persists');
  }
  const stored = await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('xiaozhang-pwa'); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result, r = db.transaction('messages').objectStore('messages').getAll();
      r.onsuccess = () => { resolve(r.result); db.close(); }; r.onerror = () => reject(r.error);
    };
  }));
  assert.deepEqual(stored.filter(row => records.some(original => original.id === row.id)).sort((a, b) => a.createdAt - b.createdAt), records);
  checks.push('stored chat data unchanged');
  assert.deepEqual(errors, []);
  const result = { passed: true, origin, checks, themes, errors, physicalIOS: '未验证；Chrome 窄屏验证', liveAPIs: '未调用' };
  await writeFile(new URL(origin.startsWith('https:') ? 'production-results.json' : 'results.json', folder), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: true, origin, checks, errors }, null, 2));
} finally { await browser.close(); }
