import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.CONTACT_TEST_URL || "http://127.0.0.1:4187";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
await context.addInitScript(() => {
  for (const key of ["auto-moments", "auto-diary", "proactive-enabled"]) localStorage.setItem(`xiaozhang-${key}`, "false");
  localStorage.setItem("xiaozhang-pet-position", JSON.stringify({ x: 0, y: 430 }));
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto(origin);
  await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
  await page.click("#contacts-back");
  await page.waitForSelector('[data-contact-id="wang-meng"]');
  assert.equal(await page.locator("[data-contact-id]").count(), 17);
  assert.equal(await page.locator('[data-contact-id="wang-meng"]').count(), 1);
  assert.equal(await page.locator('[data-contact-id="old-er-yuehong"]').count(), 0);
  await page.click("#contact-era-flip");
  await page.waitForSelector('[data-contact-id="old-er-yuehong"]');
  assert.equal(await page.locator("[data-contact-id]").count(), 10);
  assert.equal(await page.locator('[data-contact-id="wang-meng"]').count(), 0);
  assert.equal(await page.locator('[data-contact-id="old-zhang-xiaoyu"]').count(), 1);
  assert.equal(await page.locator("#session-form h2").innerText(), "老九门");
  await page.locator('[data-contact-id="old-er-yuehong"]').click();
  await page.click("#conversation-details");
  await page.waitForFunction(() => document.querySelector("#system-prompt-preview")?.textContent?.includes("民国时期长沙"));
  const prompt = await page.locator("#system-prompt-preview").textContent();
  assert.match(prompt, /民国时期长沙/);
  assert.match(prompt, /丫头/);
  assert.match(prompt, /不预知后代/);
  await page.locator("#role-dialog").evaluate(dialog => dialog.close());
  await page.click("#contacts-back");
  await page.click("#group-create-open");
  assert.equal(await page.locator('[data-group-contact="wang-meng"]').count(), 1);
  assert.equal(await page.locator('[data-group-contact="old-er-yuehong"]').count(), 1);
  assert.deepEqual(errors, []);
  console.log("PASS current and old nine contact lists, era prompt and group picker");
} finally { await browser.close(); }
