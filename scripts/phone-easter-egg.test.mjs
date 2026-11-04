import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.PHONE_EASTER_EGG_TEST_URL || "http://127.0.0.1:4184";
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu"], ...(process.env.TEST_PROXY ? { proxy: { server: process.env.TEST_PROXY } } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await context.addInitScript(() => {
  for (const key of ["auto-moments", "auto-diary", "proactive-enabled"]) localStorage.setItem(`xiaozhang-${key}`, "false");
  localStorage.removeItem("xiaozhang-phone-away-at");
  localStorage.removeItem("xiaozhang-phone-trace-auto-at");
  localStorage.setItem("xiaozhang-phone-trace-variant:zhang-qiling", "0");
});
const page = await context.newPage();
const errors = [], requests = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => { if (request.method() === "POST") requests.push(request.url()); });
try {
  await page.goto(origin); await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
  const trigger = page.locator("#phone-trace-trigger"), card = page.locator("#phone-trace-card");
  assert.equal(await trigger.isVisible(), false);
  const before = await page.locator("#messages .message-row").count();
  await page.locator("#app-title").dispatchEvent("pointerdown");
  await page.waitForTimeout(1_050);
  await page.locator("#app-title").dispatchEvent("pointerup");
  assert.equal(await trigger.isVisible(), true);
  assert.equal(await card.isVisible(), true);
  assert.match(await page.locator("#phone-trace-object").innerText(), /窄纸条/);
  assert.equal(await page.locator("#phone-trace-mark").innerText(), "山");
  assert.match(await page.locator("#phone-trace-front-copy").innerText(), /回来以后/);
  await page.click("#phone-trace-flip");
  assert.equal(await page.locator("#phone-trace-front").isVisible(), false);
  assert.match(await page.locator("#phone-trace-body").innerText(), /在等/);
  await page.click("#phone-trace-flip");
  assert.equal(await page.locator("#phone-trace-front").isVisible(), true);
  assert.equal(await page.locator("#messages .message-row").count(), before);
  assert.equal(requests.length, 0);
  await page.screenshot({ path: ".local-review/phone-easter-egg.png" });
  await page.click("#phone-trace-close"); assert.equal(await card.isVisible(), false);
  await page.click("#phone-trace-trigger"); assert.equal(await card.isVisible(), true);
  assert.deepEqual(errors, []);
  console.log("PASS interface phone trace appears on long press, can reopen, and stays out of chat/API");
} finally { await browser.close(); }
