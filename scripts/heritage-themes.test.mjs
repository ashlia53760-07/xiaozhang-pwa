// Production bundle, isolated profile, synthetic local records; no real model requests.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const folder = new URL("../.local-review/themes-20261103/verification/", import.meta.url); await mkdir(folder, { recursive: true });
const origin = process.env.THEME_TEST_URL || "http://127.0.0.1:4177";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Shanghai", serviceWorkers: "block" });
await context.addInitScript(() => { for (const k of ["auto-moments", "auto-diary", "proactive-enabled"]) localStorage.setItem(`xiaozhang-${k}`, "false"); localStorage.setItem("xiaozhang-pet-position", JSON.stringify({ x: 315, y: 645 })); });
const page = await context.newPage(), errors = [], missing = [], checks = [];
page.on("pageerror", e => errors.push(e.message)); page.on("response", r => { if (r.status() >= 400 && /themes\/rococo|bronze-map/.test(r.url())) missing.push(r.url()); });
const ready = () => page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
const feature = async id => { if (!await page.locator("#topbar-menu").isVisible()) await page.click("#topbar-menu-toggle"); await page.click(id); };
const choose = async theme => { await feature("#settings"); await page.click(`.theme-row button[data-theme="${theme}"]`); await page.keyboard.press("Escape"); await page.evaluate(() => document.fonts.ready); };
const db = (store, row) => page.evaluate(({ store, row }) => new Promise((resolve, reject) => { const o = indexedDB.open("xiaozhang-pwa"); o.onerror = () => reject(o.error); o.onsuccess = () => { const d = o.result, t = d.transaction(store, row ? "readwrite" : "readonly"), r = row ? t.objectStore(store).put(row) : t.objectStore(store).getAll(); t.oncomplete = () => { d.close(); resolve(r.result); }; t.onerror = () => reject(t.error); }; }), { store, row });
try {
  await page.goto(origin); await ready();
  await db("messages", { id: "heritage-assistant", role: "assistant", kind: "text", content: "外面风大，围巾带上。\n我在楼下等你。", sessionId: "private", createdAt: Date.now() - 3000 });
  await db("messages", { id: "heritage-user", role: "user", kind: "text", content: "好，今天想和你一起去看电影。", sessionId: "private", createdAt: Date.now() - 2000 });
  await db("messages", { id: "heritage-assistant-2", role: "assistant", kind: "text", content: "嗯。散场以后，走一会儿。", sessionId: "private", createdAt: Date.now() - 1000 });
  await page.reload(); await ready();
  const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; });
  // A record in the pre-emoji format must still load as the same mood.
  await db("kv", { key: "calendar-data", value: { records: { [today]: { date: today, mood: "开心", note: "今天也有一点小开心。", updatedAt: Date.now() } }, events: [], holidays: {}, shareWithChat: true, updatedAt: Date.now() } });
  for (const theme of ["rococo", "bronze"]) {
    await choose(theme); assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
    await page.reload(); await ready(); assert.equal(await page.locator("html").getAttribute("data-theme"), theme);
    for (const width of [390, 320, 1280]) {
      await page.setViewportSize({ width, height: width === 1280 ? 900 : 844 });
      for (const selector of [".app-shell", "#messages", "#composer"]) assert(await page.locator(selector).evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${theme} ${width}: ${selector} overflows`);
      // The shell ornament intentionally extends beyond its card, inside the viewport.
      assert(await page.locator(".theme-keepsake").evaluate(el => { const rect = el.getBoundingClientRect(), ornament = getComputedStyle(el, "::after"); return rect.left >= 0 && rect.right + Math.max(0, -parseFloat(ornament.right) || 0) <= innerWidth; }), `${theme} ${width}: keepsake ornament leaves viewport`);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${theme} ${width}: page overflows`);
      await page.screenshot({ path: fileURLToPath(new URL(`${theme}-chat-${width}.png`, folder)), animations: "disabled" });
      await feature("#diary-open"); await page.waitForSelector("#calendar-grid button");
      assert.equal(await page.inputValue("#calendar-mood"), "开心");
      assert.match(await page.locator('#calendar-mood option[value="开心"]').textContent(), /🥰/);
      assert.equal(await page.locator(`[data-calendar-day="${today}"] .calendar-mood-mark`).textContent(), " 🥰");
      assert(await page.locator(".diary-content").evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${theme} ${width}: calendar overflows`);
      await page.screenshot({ path: fileURLToPath(new URL(`${theme}-calendar-${width}.png`, folder)), animations: "disabled" });
      if (width === 390) {
        await page.locator(".calendar-day-panel").scrollIntoViewIfNeeded();
        await page.screenshot({ path: fileURLToPath(new URL(`${theme}-mood.png`, folder)), animations: "disabled" });
        await page.selectOption("#calendar-mood", "开心"); await page.click("#calendar-record-form button[type=submit]");
        await page.waitForFunction(() => document.querySelector("#calendar-status").textContent.includes("已保存"));
        assert.equal((await db("kv")).find(row => row.key === "calendar-data").value.records[today].mood, "开心");
      }
      await page.keyboard.press("Escape"); await feature("#settings");
      await page.locator(".theme-settings").scrollIntoViewIfNeeded();
      assert.equal(await page.locator(".theme-row [aria-pressed=true]").count(), 1);
      assert(await page.locator("#settings-dialog").evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${theme} ${width}: settings overflow`);
      await page.screenshot({ path: fileURLToPath(new URL(`${theme}-settings-${width}.png`, folder)), animations: "disabled" });
      await page.keyboard.press("Escape");
    }
    checks.push(`${theme}: 320/390/1280 chat, calendar, mood emoji and theme picker fit; selection survives reload`);
  }
  assert.deepEqual(missing, []); assert.deepEqual(errors, []);
  checks.push("old plain mood records load and remain plain in storage; emoji decorate selector and date cells");
  await writeFile(new URL("results.json", folder), JSON.stringify({ passed: true, origin, checks, missing, errors }, null, 2)); console.log(JSON.stringify({ passed: true, checks, errors }, null, 2));
} finally { await browser.close(); }
