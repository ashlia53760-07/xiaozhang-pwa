// Run against the built preview (4173), or set SCENE_TEST_URL to a deployed URL.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const origin = process.env.SCENE_TEST_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const folder = new URL("../.local-review/scene-ui-tests/", import.meta.url);
await mkdir(folder, { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => localStorage.setItem("xiaozhang-pet-position", JSON.stringify({ x: 10, y: 400 })));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const open = async () => {
    await page.waitForSelector("#date-open", { state: "attached" });
    await page.click("#topbar-menu-toggle"); await page.click("#date-open");
    await page.waitForSelector("#date-dialog[open]");
  };
  await page.goto(origin);
  await page.waitForSelector("#date-dialog.scene-reader", { state: "attached" });
  await page.evaluate(() => navigator.serviceWorker.ready);
  const entries = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith("xiaozhang-pwa-shell-"));
    if (!names.length) throw new Error("service worker shell cache exists");
    const cache = await caches.open(names.at(-1));
    return (await cache.keys()).map((request) => request.url);
  });
  assert.ok(entries.some(url => /\/assets\/.*\.js$/.test(url)), "first-visit JS precached");
  assert.ok(entries.some(url => /\/assets\/.*\.css$/.test(url)), "first-visit CSS precached");
  await open();
  await page.fill("#date-custom-setting", "验收：安静的旧书店，雨后的傍晚。");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 80; canvas.height = 100;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#bdcec6"; ctx.fillRect(0, 0, 80, 100);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#date-background-input").setInputFiles({ name: "test.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.waitForSelector("#date-background-preview:not([hidden])");
  await page.click("#date-start"); await page.waitForSelector("#date-messages article");
  await page.waitForFunction(() => !document.querySelector("#date-send").disabled);
  await page.fill("#date-draft", "我在门口停下来，等他一起进去。"); await page.click("#date-send");
  await page.waitForFunction(() => document.querySelectorAll("#date-messages article").length === 3 && !document.querySelector("#date-send").disabled);
  await page.reload(); await open(); await page.waitForSelector("#date-dialog.has-date-background[open]");
  assert.equal(await page.locator("#date-messages article").count(), 3);
  await context.setOffline(true); await page.reload(); await open();
  await page.waitForSelector("#date-dialog.has-date-background[open]");
  assert.equal(await page.locator("#date-messages article").count(), 3);
  await page.fill("#date-draft", "我们在这里再等一会儿。"); await page.click("#date-send");
  await page.waitForFunction(() => document.querySelectorAll("#date-messages article").length === 5 && !document.querySelector("#date-send").disabled);
  assert.match(await page.locator("#date-dialog .scene-status").innerText(), /本地预设/);
  assert.deepEqual(errors, []);
  const result = { origin, passed: true, firstVisitAssetsCached: true, customBackground: true, refreshRestore: true, offlineRestore: true, offlinePresetInteraction: true, api: "no API configured; no paid calls", physicalIOS: "not tested" };
  await writeFile(new URL(origin.startsWith("https:") ? "production-results.json" : "built-offline-results.json", folder), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
