// Run against Vite: node scripts/scene-ui.test.mjs (requires Playwright and installed Chrome).
// Uses isolated browser contexts, synthetic local data and a mocked API; no paid requests.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const origin = process.env.SCENE_TEST_URL || "http://127.0.0.1:5173";
const artifacts = new URL("../.local-review/scene-ui-tests/", import.meta.url);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
// Keep the draggable pet clear of the menu, as a user's saved position would.
await context.addInitScript(() => localStorage.setItem("xiaozhang-pet-position", JSON.stringify({ x: 10, y: 400 })));
const page = await context.newPage();
const errors = [];
const requests = [];
page.on("pageerror", (error) => errors.push(error.message));
let failApi = false;
const reply = "他在你身旁停下，将手里的伞稍稍偏过来。雨点落在伞沿，像有人在远处轻轻敲着窗。\n\n“慢慢走。”他看了一眼前面的路，声音很低，却听得清楚。“那边有灯。”\n\n他没有替你决定方向，只把步子放慢，等你说出接下来想去的地方。";
await page.route("https://scene-test.invalid/**", async (route) => {
  const body = route.request().postDataJSON(); requests.push(body);
  await route.fulfill(failApi ? { status: 503, contentType: "application/json", body: "{}" } : {
    contentType: "text/event-stream", body: `data: ${JSON.stringify({ choices: [{ delta: { content: reply.slice(0, 38) } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: reply.slice(38) } }] })}\n\ndata: [DONE]\n\n`
  });
});
async function openFeature(id) {
  if (!(await page.locator("#topbar-menu").isVisible())) await page.click("#topbar-menu-toggle");
  await page.click(id);
  const dialog = { "#date-open": "#date-dialog", "#meet-open": "#meet-dialog", "#settings": "#settings-dialog" }[id];
  if (dialog) await page.waitForSelector(`${dialog}[open]`);
}
async function settled() { await page.waitForTimeout(120); await page.waitForFunction(() => !document.querySelector("#date-send").disabled); }
async function layout(dialog) {
  const geometry = await page.locator(dialog).evaluate((el) => {
    const input = el.querySelector(".scene-composer textarea").getBoundingClientRect();
    const send = el.querySelector(".scene-send").getBoundingClientRect();
    const msgs = el.querySelector(".scene-messages").getBoundingClientRect();
    return { width: el.clientWidth, scroll: el.scrollWidth, bottom: input.bottom, top: input.top, height: msgs.height, sendRight: send.right, vh: innerHeight, vw: innerWidth };
  });
  assert.ok(geometry.scroll <= geometry.width + 1, `no horizontal overflow: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.bottom <= geometry.vh && geometry.top >= 0 && geometry.height > 100 && geometry.sendRight <= geometry.vw, `reader/composer fit: ${JSON.stringify(geometry)}`);
}

try {
  await page.goto(origin);
  await page.waitForSelector("#date-open", { state: "attached" });
  await page.evaluate(async () => {
    const { storage } = await import("/src/storage.ts");
    const now = Date.now();
    await storage.saveDateSession({ id: "old-date", scene: "rain", title: "旧约会兼容测试", setting: "旧街长廊", atmosphere: "雨声", active: true, createdAt: now, updatedAt: now, messages: [{ id: "old-entry", role: "assistant", kind: "text", content: "这是一条升级前保存的约会消息。", createdAt: now }] });
    await storage.addMessage({ id: "preserved-chat", role: "user", kind: "text", content: "已有的线上聊天必须保留。", createdAt: now, sessionId: "private" });
    await storage.saveContinuousLife({ id: "continuous-life", active: true, location: "旧街长廊", timeLabel: "傍晚", environment: "雨声很轻", activity: "一起等雨停", updatedAt: now });
  });
  await openFeature("#date-open");
  await page.waitForSelector("#date-messages .scene-entry-paper");
  assert.match(await page.locator("#date-messages").innerText(), /升级前保存/);
  await layout("#date-dialog");
  await page.click(".scene-options summary");
  await page.click("#date-restart");
  await page.fill("#date-custom-setting", "旧街的雨夜，和张起灵沿长廊慢慢散步。不要替我决定行动。");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 780; canvas.height = 1688;
    const ctx = canvas.getContext("2d"); const gradient = ctx.createLinearGradient(0, 0, 780, 1688);
    gradient.addColorStop(0, "#cad8cf"); gradient.addColorStop(.5, "#e7dcc9"); gradient.addColorStop(1, "#9daeb2");
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 780, 1688);
    ctx.fillStyle = "#738d8550"; ctx.beginPath(); ctx.arc(650, 420, 280, 0, Math.PI*2); ctx.fill();
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.locator("#date-background-input").setInputFiles({ name: "my-date.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.waitForSelector("#date-background-preview:not([hidden])");
  await page.screenshot({ path: new URL("date-picker-mobile.png", artifacts).pathname.replace(/^\/(.:\/)/, "$1") });
  await page.click("#date-start");
  await page.waitForSelector("#date-messages .scene-entry-paper"); await settled();
  assert.equal(await page.locator("#date-dialog").evaluate(el => el.classList.contains("has-date-background")), true);
  await layout("#date-dialog");
  const originalSession = await page.evaluate(async () => (await (await import("/src/storage.ts")).storage.dateSessions()).find(s => s.active));
  assert.equal(originalSession.scene, "custom"); assert.ok(originalSession.backgroundMediaId);
  // Removing immediately after creation must not fall back to the picker draft's image.
  await page.click(".scene-options summary"); await page.click("#date-stage [data-date-background-remove]");
  await page.waitForFunction(() => !document.querySelector("#date-dialog").classList.contains("has-date-background"));
  await page.locator("#date-background-input").setInputFiles({ name: "restored.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.waitForSelector("#date-dialog.has-date-background");
  await page.locator("#date-background-input").setInputFiles({ name: "broken.png", mimeType: "image/png", buffer: Buffer.from("invalid image") });
  await page.waitForFunction(() => document.querySelector("#date-dialog .scene-status").textContent.includes("无法读取"));
  assert.ok(await page.locator("#date-dialog.has-date-background").count(), "invalid uploads retain the existing image");
  await page.fill("#date-draft", "我指了指路口的旧书店，想过去看看。");
  await page.click("#date-send"); await settled();
  assert.equal(await page.locator("#date-messages article").count(), 3);
  assert.match(await page.locator("#date-dialog .scene-status").innerText(), /本地预设/);

  // Supply only a synthetic API configuration and exercise the real scene request builder.
  await page.evaluate(async () => {
    await (await import("/src/storage.ts")).storage.saveProfile({ baseUrl: "https://scene-test.invalid/v1", model: "mock-scene", apiKey: "synthetic-test-secret", temperature: .7, protocol: "openai" });
  });
  await page.reload(); await openFeature("#date-open");
  await page.waitForSelector("#date-dialog.has-date-background");
  assert.equal(await page.locator("#date-messages article").count(), 3);
  await page.fill("#date-draft", "我站在屋檐下，问他想先去哪里。"); await page.click("#date-send"); await settled();
  assert.equal(requests.length, 1);
  assert.ok(requests[0].messages.every(m => typeof m.content === "string"));
  assert.match(requests[0].messages[0].content, /独立.*小剧场/);
  assert.match(requests[0].messages[0].content, /旧街的雨夜/);
  assert.ok(!JSON.stringify(requests[0]).includes("data:image"));
  await page.screenshot({ path: new URL("date-mobile.png", artifacts).pathname.replace(/^\/(.:\/)/, "$1") });
  failApi = true;
  const count = await page.locator("#date-messages article").count();
  await page.fill("#date-draft", "测试失败重试"); await page.click("#date-send"); await settled();
  assert.match(await page.locator("#date-dialog .scene-status").innerText(), /503/);
  assert.equal(await page.locator("#date-messages article").count(), count + 1, "failure adds no fake assistant response");
  failApi = false;
  await page.click("#date-dialog .scene-back");
  await openFeature("#meet-open");
  await page.waitForSelector("#meet-dialog[open]");
  await page.fill("#life-draft", "我提起线上说过的那家书店，问他现在去好不好。"); await page.click("#life-send"); await settled();
  assert.match(await page.locator("#life-messages").innerText(), /伞沿/);
  const lifeRequest = requests.at(-1);
  assert.match(lifeRequest.messages[0].content, /连续生活/);
  assert.ok(lifeRequest.messages.some(m => m.content.includes("已有的线上聊天必须保留")));
  await layout("#meet-dialog");
  await page.screenshot({ path: new URL("offline-mobile.png", artifacts).pathname.replace(/^\/(.:\/)/, "$1") });
  await page.setViewportSize({ width: 1280, height: 900 }); await layout("#meet-dialog");
  await page.screenshot({ path: new URL("offline-desktop.png", artifacts).pathname.replace(/^\/(.:\/)/, "$1") });
  await page.setViewportSize({ width: 320, height: 568 }); await layout("#meet-dialog");
  await page.click("#meet-dialog .scene-back");
  await openFeature("#date-open"); await layout("#date-dialog");
  await page.setViewportSize({ width: 390, height: 844 });
  // Change, remove and restore an existing session's background, then export it.
  await page.click(".scene-options summary"); await page.click("#date-stage [data-date-background-remove]");
  await page.waitForFunction(() => !document.querySelector("#date-dialog").classList.contains("has-date-background"));
  await page.locator("#date-background-input").setInputFiles({ name: "replacement.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.waitForSelector("#date-dialog.has-date-background");
  await page.click("#date-dialog .scene-back");
  await openFeature("#settings");
  const downloadPromise = page.waitForEvent("download"); await page.click("#export-data");
  const download = await downloadPromise;
  const backup = JSON.parse(await readFile(await download.path(), "utf8"));
  const savedDate = backup.dateSessions.find(s => s.id === originalSession.id);
  assert.ok(savedDate.backgroundMediaId); assert.ok(backup.media.some(m => m.id === savedDate.backgroundMediaId && m.data.startsWith("data:image/png")));
  assert.ok(!JSON.stringify(backup).includes("synthetic-test-secret"));
  assert.ok(backup.messages.some(m => m.id === "preserved-chat"));
  assert.ok(!(backup.memories ?? []).some(m => m.content.includes("旧街的雨夜")), "no automatic date-to-memory leak");

  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await fresh.addInitScript(() => localStorage.setItem("xiaozhang-pet-position", JSON.stringify({ x: 10, y: 400 })));
  const restored = await fresh.newPage(); await restored.goto(origin);
  await restored.waitForSelector("#date-open", { state: "attached" });
  await restored.click("#topbar-menu-toggle"); await restored.click("#settings");
  await restored.locator("#import-data").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  await restored.waitForFunction(async () => (await (await import("/src/storage.ts")).storage.dateSessions()).some(s => s.active && s.backgroundMediaId));
  await restored.locator("#settings-dialog .icon-button").click();
  if (!(await restored.locator("#topbar-menu").isVisible())) await restored.click("#topbar-menu-toggle");
  await restored.click("#date-open"); await restored.waitForSelector("#date-dialog.has-date-background");
  assert.ok(await restored.locator("#date-messages article").count() >= 5);
  await restored.click("#date-end"); await restored.waitForSelector("#date-picker:not([hidden])");
  assert.ok(!(await restored.locator("#date-dialog.has-date-background").count()), "ended dates do not leak their background into new dates");
  await fresh.close();
  assert.deepEqual(errors, []);
  const result = { passed: true, scenarios: ["legacy date without background", "custom date upload", "multi-turn local and mocked streaming API", "plain-text prompt and isolation", "visible HTTP error without fake reply", "online/offline context continuity", "390px / 320px / desktop layout", "reload persistence", "change/remove background", "backup media and key exclusion", "fresh-context backup restore"], api: "mocked only", physicalIOS: "not tested" };
  await writeFile(new URL("results.json", artifacts), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
