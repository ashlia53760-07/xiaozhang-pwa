import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const origin = process.env.MENU_TEST_URL || 'http://127.0.0.1:4175';
const artifacts = new URL('../.local-review/menu-layer-20261025/', import.meta.url);
await mkdir(artifacts, {recursive:true});
const browser = await chromium.launch({channel:'chrome', headless:true});
const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
await context.addInitScript(() => {
  localStorage.setItem('xiaozhang-auto-moments', 'false');
  localStorage.setItem('xiaozhang-auto-diary', 'false');
  localStorage.setItem('xiaozhang-proactive-enabled', 'false');
  localStorage.setItem('xiaozhang-pet-position', JSON.stringify({x:10,y:400}));
});
const page = await context.newPage(), errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const ready = () => page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
async function checkMenu(label) {
  await page.click('#topbar-menu-toggle');
  for (const id of ['meet-open','date-open']) {
    const hit = await page.locator(`#${id}`).evaluate(el => {
      const rect = el.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const top = document.elementFromPoint(x, y);
      return {clickable: !!top && (top === el || el.contains(top)), blocker: top?.className, y, x};
    });
    assert.ok(hit.clickable, `${label}: ${id} covered: ${JSON.stringify(hit)}`);
  }
  const menu = await page.locator('#topbar-menu').boundingBox();
  assert.ok(menu.x >= 0 && menu.x + menu.width <= page.viewportSize().width + 1, `${label}: menu fits screen`);
  await page.click('#topbar-menu-toggle');
  assert.equal(await page.locator('#topbar-menu').isVisible(), false);
  checks.push(`${label}: offline/date buttons pass hit testing and menu stays in viewport`);
}
try {
  await page.goto(origin); await ready();
  for (const viewport of [{width:320,height:740},{width:390,height:844},{width:1280,height:900}]) {
    await page.setViewportSize(viewport);
    for (const theme of ['warm','ink','night']) {
      await page.evaluate(theme => {document.documentElement.dataset.theme = theme;}, theme);
      await checkMenu(`${viewport.width}px ${theme} private`);
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.click('#contacts-back'); await page.locator('[data-contact-id="a-ning"]').click();
  await page.waitForFunction(() => document.querySelector('#conversation-name').textContent === '阿宁');
  await page.click('#topbar-menu-toggle'); await page.click('#meet-open', {timeout:5000});
  await page.waitForSelector('#meet-dialog[open]');
  await page.locator('#meet-dialog .scene-back').click();
  await page.click('#topbar-menu-toggle'); await page.click('#date-open', {timeout:5000});
  await page.waitForSelector('#date-dialog[open]');
  assert.equal(await page.locator('#date-custom-setting').isVisible(), true);
  await page.screenshot({path:fileURLToPath(new URL('custom-date-mobile.png',artifacts))});
  await page.locator('#date-dialog .scene-back').click();
  checks.push('real pointer clicks open selected contact offline scene and custom date; back navigation works');
  await page.click('#contacts-back'); await page.click('#group-create-open');
  await page.locator('[data-group-contact="zhang-qiling"]').check();
  await page.locator('[data-group-contact="a-ning"]').check();
  await page.fill('#group-title', '菜单层级检查'); await page.click('#group-save');
  await page.waitForFunction(() => document.querySelector('#conversation-name').textContent === '菜单层级检查');
  await checkMenu('390px group');
  await page.click('#topbar-menu-toggle'); await page.click('#date-open', {timeout:5000});
  assert.match(await page.locator('#error').textContent(), /请先选择一位私聊联系人/);
  checks.push('group header also clears menu; private-only entry still gives honest guidance');
  await page.reload(); await ready(); await checkMenu('390px restored group');
  await page.click('#topbar-menu-toggle');
  await page.screenshot({path:fileURLToPath(new URL('menu-mobile.png',artifacts))});
  assert.deepEqual(errors, []);
  const result = {origin,checks,errors,isolatedBrowser:true,realApiCalls:0};
  await writeFile(new URL(origin.startsWith('https:') ? 'production-results.json' : 'local-results.json', artifacts), JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
} catch (error) {
  await page.screenshot({path:fileURLToPath(new URL('failure.png',artifacts))}).catch(() => {});
  throw error;
} finally { await context.close(); await browser.close(); }
