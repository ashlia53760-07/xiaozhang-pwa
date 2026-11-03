// Isolated browser data only; no real user data or model calls.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const origin = process.env.INTRO_TEST_URL || "http://127.0.0.1:4177";
const folder = new URL("../.local-review/scrolling-intros/", import.meta.url);
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", reducedMotion: "reduce" });
await context.addInitScript(() => {
  for (const key of ["auto-moments", "auto-diary", "proactive-enabled"]) localStorage.setItem(`xiaozhang-${key}`, "false");
  localStorage.setItem("xiaozhang-pet-position", JSON.stringify({ x: 4, y: 430 }));
});
const page = await context.newPage(), errors = [], checks = [];
page.on("pageerror", error => errors.push(error.message));
const ready = () => page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
async function feature(id) {
  if (!await page.locator("#topbar-menu").isVisible()) await page.click("#topbar-menu-toggle");
  await page.click(id);
}
async function choose(theme) {
  await feature("#settings"); await page.click(`.theme-row button[data-theme="${theme}"]`);
  await page.keyboard.press("Escape"); await page.evaluate(() => document.fonts.ready);
}
async function scrollingHeader(scroller, card) {
  await page.locator(scroller).evaluate(el => Promise.all(el.getAnimations({ subtree: true }).filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))));
  const result = await page.locator(scroller).evaluate((el, selector) => {
    const card = el.querySelector(selector), viewport = el.getBoundingClientRect();
    if (!card) return { missing: true };
    el.scrollTop = 0;
    const start = card.getBoundingClientRect().top;
    el.scrollTop = el.scrollHeight;
    const end = card.getBoundingClientRect().bottom;
    const travelled = start - card.getBoundingClientRect().top;
    const scrollTop = el.scrollTop;
    el.scrollTop = 0;
    return { first: el.firstElementChild === card, count: el.querySelectorAll(selector).length, start, end, travelled, scrollTop, viewport: viewport.toJSON(), restored: card.getBoundingClientRect().top, overflow: el.scrollWidth > el.clientWidth + 1, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, cardWidth: card.getBoundingClientRect().width };
  }, card);
  assert(!result.missing, `${scroller}: header must remain available`);
  assert(result.first && result.count === 1, `${scroller}: one header before all records`);
  assert(result.start >= result.viewport.top && result.start < result.viewport.bottom, JSON.stringify(result));
  assert(result.end < result.viewport.top && result.travelled > 200, `${scroller}: header must leave reading viewport: ${JSON.stringify(result)}`);
  assert(Math.abs(result.travelled - result.scrollTop) < 2, "header moves with records, never fixed or sticky");
  assert.equal(result.restored, result.start);
  assert(!result.overflow, `${scroller}: ${JSON.stringify(result)}`);
}
try {
  await page.goto(origin); await ready();
  for (const theme of ["warm", "ink", "night"]) {
    await choose(theme); assert.equal(await page.locator(".theme-keepsake").count(), 0);
  }
  await page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open("xiaozhang-pwa"); open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction(["messages", "kv"], "readwrite"), now = Date.now();
      for (let i = 0; i < 28; i++) tx.objectStore("messages").put({ id: `intro-chat-${i}`, role: i % 2 ? "user" : "assistant", kind: "text", content: `第${i + 1}条测试记录。今天沿着旧街慢慢走，路灯下的风很轻。`, sessionId: "private", createdAt: now + i });
      tx.objectStore("kv").put({ key: "date-sessions", value: [{ id: "intro-date", characterId: "zhang-qiling", scene: "custom", title: "旧街雨夜", setting: "沿着旧街的长廊慢慢走，灯光落在屋檐下。这里是开场设定，随剧场记录滚动，回到顶部可以重读。", atmosphere: "雨声和缓，等你落笔", active: true, createdAt: now, updatedAt: now, messages: Array.from({ length: 14 }, (_, i) => ({ id: `intro-date-${i}`, role: i % 2 ? "user" : "assistant", kind: "text", content: `第${i + 1}则。` + "雨点轻轻敲着伞沿，街边的灯亮着。他停在长廊边，等你开口。\n\n".repeat(4), createdAt: now + i })) }] });
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
    };
  }));
  for (const theme of ["rococo", "bronze"]) {
    await choose(theme); await page.reload(); await ready(); await page.evaluate(() => document.fonts.ready);
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport);
      await scrollingHeader("#messages", ".theme-keepsake");
      await page.screenshot({ path: fileURLToPath(new URL(`${theme}-chat-top-${viewport.width}.png`, folder)) });
      await page.locator("#messages").evaluate(el => el.scrollTop = el.scrollHeight);
      await page.screenshot({ path: fileURLToPath(new URL(`${theme}-chat-latest-${viewport.width}.png`, folder)) });
      assert(await page.locator("#draft").isVisible());
      await feature("#date-open"); await page.waitForSelector("#date-messages .scene-message");
      await scrollingHeader("#date-messages", "#date-state-card");
      await page.screenshot({ path: fileURLToPath(new URL(`${theme}-date-top-${viewport.width}.png`, folder)) });
      await page.locator("#date-messages").evaluate(el => el.scrollTop = el.scrollHeight);
      await page.screenshot({ path: fileURLToPath(new URL(`${theme}-date-latest-${viewport.width}.png`, folder)) });
      const room = await page.locator("#date-messages").evaluate(el => el.clientHeight);
      assert(room > viewport.height * .4, `date reader retains useful height: ${room}`);
      await page.click('#date-stage [aria-label="场景消息操作"]');
      await page.click('#date-stage [data-scene-action="select"]');
      await page.waitForSelector("#date-messages.scene-selecting");
      await scrollingHeader("#date-messages", "#date-state-card");
      assert.equal(await page.locator("#date-messages .scene-message").count(), 14);
      await page.click("#date-stage [data-scene-select-cancel]");
      await page.click("#date-dialog .scene-back");
      checks.push(`${theme} ${viewport.width}: intro and date setting scroll away and return at top; rerender keeps one header; input remains visible`);
    }
  }
  const saved = await page.evaluate(() => new Promise(resolve => {
    const open = indexedDB.open("xiaozhang-pwa"); open.onsuccess = () => {
      const db = open.result, tx = db.transaction(["messages", "kv"]), messages = tx.objectStore("messages").getAll(), dates = tx.objectStore("kv").get("date-sessions");
      tx.oncomplete = () => { db.close(); resolve({ messages: messages.result, dates: dates.result.value }); };
    };
  }));
  assert.equal(saved.messages.length, 28); assert.equal(saved.dates[0].messages.length, 14);
  assert(saved.messages.every(message => message.id.startsWith("intro-chat-") && !/把日子写成|灯未熄/.test(message.content)));
  assert.deepEqual(errors, []);
  await writeFile(new URL("results.json", folder), JSON.stringify({ passed: true, origin, checks, savedRecords: { chat: saved.messages.length, date: 14 }, errors }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, errors }, null, 2));
} finally { await browser.close(); }
