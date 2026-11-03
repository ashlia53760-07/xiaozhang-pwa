import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const origin = process.env.PLUS_MENU_TEST_URL || "http://127.0.0.1:4177";
const folder = new URL("../.local-review/plus-menu/", import.meta.url);
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await context.addInitScript(() => {
  for (const key of ["auto-moments", "auto-diary", "proactive-enabled"]) localStorage.setItem(`xiaozhang-${key}`, "false");
  localStorage.setItem("xiaozhang-pet-position", JSON.stringify({ x: 5, y: 420 }));
});
const page = await context.newPage(), errors = [], checks = [];
page.on("pageerror", error => errors.push(error.message));
const ready = () => page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
async function select(selector, name) {
  await page.click("#contacts-back");
  await page.waitForFunction(() => document.querySelector("#session-dialog").open);
  await page.click(selector);
  await page.waitForFunction(name => document.querySelector("#conversation-name").textContent === name, name);
  if (page.viewportSize().width < 980) await page.waitForFunction(() => !document.querySelector("#session-dialog").open);
  else if (await page.locator("#session-dialog").evaluate(el => el.open)) await page.click("#session-form .icon-button");
}
async function menu(isGroup) {
  await page.click("#plus-open");
  assert.equal(await page.locator("#plus-open").getAttribute("aria-expanded"), "true");
  for (const id of ["#plus-group-collection", "#plus-group-roll"]) assert.equal(await page.locator(id).isVisible(), isGroup);
  for (const id of ["#plus-image", "#plus-transfer", "#plus-gift"]) assert(await page.locator(id).isVisible());
}
try {
  await page.goto(origin); await ready();
  await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open("xiaozhang-pwa");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction("groups", "readwrite"), now = Date.now();
      tx.objectStore("groups").put({ id: "plus-menu-test", title: "菜单测试群", members: [{ id: "wu-xie", characterId: "wu-xie", name: "吴邪", enabled: true, persona: "" }], createdAt: now, updatedAt: now });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }));
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ["warm", "ink", "night", "rococo", "bronze"]) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      await select('[data-contact-id="zhang-qiling"]', "张起灵"); await menu(false);
      assert(!await page.locator("#plus-menu").innerText().then(text => /群收款|群接龙/.test(text)));
      await select('[data-group-id="plus-menu-test"]', "菜单测试群");
      assert.equal(await page.locator("#plus-open").getAttribute("aria-expanded"), "false");
      await menu(true);
      await page.click("#plus-group-collection"); await page.waitForSelector("#transaction-dialog[open]");
      assert.match(await page.locator("#tool-title").textContent(), /群收款/); await page.click("#tool-back");
      await menu(true); await page.click("#plus-group-roll"); await page.waitForSelector("#transaction-dialog[open]");
      assert.match(await page.locator("#tool-title").textContent(), /接龙/); await page.click("#tool-back");
      await select('[data-contact-id="wu-xie"]', "吴邪"); await menu(false);
      await page.click("#plus-open");
      checks.push(`${theme} ${width}: private menus exclude group tools; group tools still open; switching closes menu`);
    }
  }
  await page.reload(); await ready(); await menu(false);
  await page.screenshot({ path: fileURLToPath(new URL("private-menu.png", folder)) });
  assert.deepEqual(errors, []);
  await writeFile(new URL("results.json", folder), JSON.stringify({ passed: true, origin, checks, errors }, null, 2));
  console.log(`PASS private/group plus menus across five themes and two viewport sizes; refresh persists; errors=${errors.length}`);
} finally { await browser.close(); }
