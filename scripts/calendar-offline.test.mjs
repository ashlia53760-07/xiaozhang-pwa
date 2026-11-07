import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const origin = process.env.CALENDAR_PREVIEW_URL || "http://127.0.0.1:4177";
const folder = new URL("../.local-review/calendar-tests/", import.meta.url); await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: "Asia/Shanghai", serviceWorkers: "allow", hasTouch: true });
await context.addInitScript(() => { for (const key of ["auto-moments", "auto-diary", "proactive-enabled"]) localStorage.setItem(`xiaozhang-${key}`, "false"); });
const page = await context.newPage(), errors = []; page.on("pageerror", e => errors.push(e.message));
const ready = () => page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
try {
  await page.clock.install({ time: new Date("2026-11-07T10:00:00+08:00") });
  await page.goto(origin); await ready(); await page.evaluate(() => navigator.serviceWorker.ready); await page.reload(); await ready();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.locator("#diary-open").evaluate(b => b.click()); await page.waitForSelector("#calendar-grid button");
  await page.selectOption("#calendar-mood", "平静"); await page.selectOption("#calendar-period", "flow"); await page.fill("#calendar-note", "断网后也要保留的记录");
  await page.click("#calendar-record-form button[type=submit]"); await page.waitForFunction(() => document.querySelector("#calendar-status").textContent.includes("已保存"));
  await context.setOffline(true); await page.reload(); await ready();
  const assets = await page.evaluate(async () => {
    const paths = ["bow.png", "quills.webp", "shell.webp", "seal.webp", "ribbon.webp", "paper-grain.png", "PinyonScript.ttf"];
    return Promise.all(paths.map(async name => { const response = await fetch(`/themes/rococo/${name}`); return { name, ok: response.ok, bytes: (await response.arrayBuffer()).byteLength }; }));
  });
  assert(assets.every(asset => asset.ok && asset.bytes > 0), "all new theme decorations and font are available offline before choosing the theme");
  await page.locator("#diary-open").evaluate(b => b.click()); await page.waitForSelector("#calendar-grid button");
  assert.equal(await page.locator("#calendar-grid button").count(), 42); assert.equal(await page.inputValue("#calendar-note"), "断网后也要保留的记录"); assert.equal(await page.inputValue("#calendar-period"), "flow");
  await page.fill("#calendar-month", "2026-02"); await page.locator("#calendar-month").dispatchEvent("change");
  await page.waitForFunction(() => document.querySelector('[data-calendar-day="2026-02-14"]')?.getAttribute("aria-label").includes("调休上班"));
  assert.match(await page.locator('[data-calendar-day="2026-02-17"]').getAttribute("aria-label"), /春节/);
  for (const theme of ["warm", "night", "ink", "rococo", "bronze"]) {
    await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const style = await page.locator('[aria-pressed="true"][data-calendar-day]').evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor, shadow: getComputedStyle(el).boxShadow }));
    assert.notEqual(style.background, "rgba(0, 0, 0, 0)"); assert.equal(style.shadow, "none");
    await page.screenshot({ path: fileURLToPath(new URL(`calendar-${theme}.png`, folder)) });
  }
  await page.locator("#calendar-record-form").scrollIntoViewIfNeeded();
  await page.screenshot({ path: fileURLToPath(new URL("calendar-record-panel.png", folder)) });
  await page.fill("#calendar-month", "2026-12"); await page.locator("#calendar-month").dispatchEvent("change");
  await page.waitForSelector('[data-calendar-day="2026-12-22"]'); await page.click('[data-calendar-day="2026-12-22"]');
  await page.waitForSelector('[data-egg-id="term-23"]');
  assert.equal(await page.locator("#calendar-egg-character option").count(), 27);
  await page.selectOption("#calendar-egg-character", "liu-sang");
  assert.match(await page.locator(".calendar-surprise-scene").innerText(), /没有热闹/);
  await page.locator('#diary-dialog form[method="dialog"] button').click();
  const before = await page.locator("#messages .message-row").count();
  const pet = await page.locator("#pet").boundingBox(); assert(pet);
  const touch = await context.newCDPSession(page);
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pet.x + pet.width / 2, y: pet.y + pet.height / 2 }] });
  await page.waitForTimeout(1050);
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForSelector('#phone-trace-card[data-surprise-id="term-20"]:not([hidden])');
  await page.click("#phone-trace-flip"); assert.match(await page.locator("#phone-trace-body").innerText(), /热汤/);
  await page.click("#phone-trace-next"); await page.waitForSelector('#phone-trace-card[data-surprise-id="daily"]');
  assert.equal(await page.locator("#messages .message-row").count(), before, "touch release must not also pet the character");
  await page.screenshot({ path: fileURLToPath(new URL("calendar-offline-touch-surprise.png", folder)) });
  assert.deepEqual(errors, []);
  await writeFile(new URL("offline-result.json", folder), JSON.stringify({ passed: true, checks: ["built production app boots offline with active service worker", "calendar records survive offline reload", "bundled lunar holidays and official rest/work days work offline", "selected date remains distinct in all five themes", "all seven Rococo decorations and font are precached before first theme selection", "27-role winter solstice archive works offline", "real touch hold reveals Lidong offline, flips and cycles to daily trace without petting"], assets, errors }, null, 2));
  console.log("PASS production calendar offline reload, persisted records, offline holidays, all five themes and touch-hold seasonal cards");
} finally { await browser.close(); }
