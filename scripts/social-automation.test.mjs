// Isolated browser verification for automatic moments/diary. Uses synthetic compatible endpoints.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const origin = process.env.SOCIAL_TEST_URL || "http://127.0.0.1:4174";
const folder = new URL("../.local-review/social-automation/", import.meta.url);
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", timezoneId: "Asia/Shanghai" });
const page = await context.newPage();
const calls = [];
const errors = [];
let expectedApiFailure = false;
let rejectNextSocialRequest = false;
let rejectNextDiaryRequest = false;
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error" && !(expectedApiFailure && /503/.test(message.text()))) errors.push(message.text()); });
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
// Keep a deterministic calendar day while allowing request cooldown time to advance.
await page.clock.install({ time: new Date("2026-10-21T21:10:00+08:00") });
await context.route("https://social-test.invalid/**", async route => {
  const request = route.request();
  const body = request.postDataJSON?.() ?? {};
  calls.push(body);
  if (rejectNextDiaryRequest && JSON.stringify(body).includes("生成今天的日记")) {
    rejectNextDiaryRequest = false;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "synthetic diary unavailable" } }) });
    return;
  }
  if (rejectNextSocialRequest) {
    rejectNextSocialRequest = false;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "synthetic unavailable" } }) });
    return;
  }
  const prompt = JSON.stringify(body);
  const content = prompt.includes("生成今天的日记")
    ? JSON.stringify({ title: "山风停后的记录", mood: "平静", content: "今天的消息不多，但有一段关于旧路和雨声的谈话留了下来。我记住了。" })
    : JSON.stringify({ author: "npc", authorName: "吴邪", content: "傍晚的风停了一会儿。旧路边的水声还在，适合把脚步放慢。", imagePrompt: "安静的山路和雨后水声，克制的纪实摄影", comments: [{ name: "王胖子", content: "记得带点吃的回来。" }] });
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content } }] }) });
});
await context.route("https://social-image.invalid/**", async route => {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [{ b64_json: pngBase64 }] }) });
});
async function assertProfileAvatarVisible() {
  assert.equal(await page.locator("#moment-user-avatar").isVisible(), true, "profile avatar is visibly rendered");
  assert.equal(await page.locator("#moment-user-avatar-fallback").isVisible(), false, "placeholder must not cover the uploaded profile avatar");
  assert.equal(await page.locator("#moment-user-avatar-fallback").evaluate(element => getComputedStyle(element).display), "none", "hidden placeholder respects CSS visibility");
  assert.equal(await page.locator("#moment-user-avatar").evaluate(element => {
    const rect = element.getBoundingClientRect();
    return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === element;
  }), true, "the avatar itself is on top at the circled profile position");
}
async function db(store, op, value) {
  return page.evaluate(({ store, op, value }) => new Promise((resolve, reject) => {
    const open = indexedDB.open("xiaozhang-pwa");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction(store, op === "put" ? "readwrite" : "readonly");
      const request = op === "put" ? transaction.objectStore(store).put(value) : transaction.objectStore(store).getAll();
      let result;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => { database.close(); resolve(result); };
      transaction.onerror = () => reject(transaction.error);
    };
  }), { store, op, value });
}
await page.goto(origin);
await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
await db("kv", "put", { key: "api-profile", value: { baseUrl: "https://social-test.invalid/v1", model: "synthetic", apiKey: "test-key", temperature: 0.4, protocol: "openai" } });
await db("kv", "put", { key: "image-profile", value: { baseUrl: "https://social-image.invalid/v1", model: "synthetic-image", apiKey: "test-image-key" } });
await db("messages", "put", { id: "social-source", role: "user", content: "今天聊过雨后的山路和旧档案。", kind: "text", createdAt: Date.now() - 1000, sessionId: "private" });
await page.evaluate(() => { localStorage.setItem("xiaozhang-auto-moments", "true"); localStorage.setItem("xiaozhang-auto-moment-images", "true"); localStorage.setItem("xiaozhang-auto-diary", "true"); });
const fixedNow = await page.evaluate(() => Date.now());
await db("kv", "put", { key: "social-automation-state", value: { momentNextAt: fixedNow } });
await page.reload();
await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
await page.waitForFunction(async () => {
  const open = indexedDB.open("xiaozhang-pwa");
  return await new Promise(resolve => { open.onsuccess = () => { const d = open.result; const tx = d.transaction("moments", "readonly"); const a = tx.objectStore("moments").getAll(); tx.oncomplete = () => { d.close(); resolve(a.result.length > 0); }; }; });
}, null, { timeout: 8000 });
assert.equal((await db("diary", "all")).length, 0, "automatic diary must wait until the diary page is opened");
await page.click("#topbar-menu-toggle");
await page.locator("#diary-open").evaluate(button => button.click());
await page.waitForFunction(() => document.querySelector("#diary-dialog")?.open === true);
await page.waitForFunction(async () => {
  const open = indexedDB.open("xiaozhang-pwa");
  return await new Promise(resolve => { open.onsuccess = () => { const d = open.result; const tx = d.transaction("diary", "readonly"); const r = tx.objectStore("diary").getAll(); tx.oncomplete = () => { d.close(); resolve(r.result.some(x => x.source === "auto")); }; }; });
}, null, { timeout: 8000 });
const diaryLayout = await page.locator("#diary-dialog").evaluate(element => { const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight }; });
assert.ok(Math.abs(diaryLayout.width - diaryLayout.viewportWidth) < 2, "diary must fill mobile width");
assert.ok(Math.abs(diaryLayout.height - diaryLayout.viewportHeight) < 2, "diary must fill mobile height");
// The database commit can finish before the generation status is rendered.
await page.waitForFunction(() => /已经写好|日记生成失败/.test(document.querySelector("#diary-generation-status")?.textContent ?? ""));
assert.match(await page.locator("#diary-generation-status").textContent(), /已经写好/, JSON.stringify(errors));
await page.locator("#diary-dialog form[method=dialog] button").click();
const values = await page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open("xiaozhang-pwa"); open.onerror = () => reject(open.error); open.onsuccess = () => { const d = open.result; const tx = d.transaction(["moments", "diary", "media"], "readonly"); const moments = tx.objectStore("moments").getAll(); const diary = tx.objectStore("diary").getAll(); const media = tx.objectStore("media").getAll(); tx.oncomplete = () => { d.close(); resolve({ moments: moments.result, diary: diary.result, media: media.result }); }; };
}));
const moment = values.moments.find(x => x.source === "auto");
const diary = values.diary.find(x => x.source === "auto");
assert.ok(moment?.content.includes("傍晚的风"));
assert.equal(moment.author, "npc");
assert.equal(moment.authorName, "吴邪");
assert.equal((await db("kv", "all")).find(row => row.key === "social-automation-state")?.value.momentLastAuthor, "吴邪", "automatic feed remembers the last character for rotation");
assert.equal(moment.comments.filter(x => x.author === "npc").length, 1);
assert.ok(moment.mediaId && values.media.some(x => x.id === moment.mediaId));
assert.equal(diary?.automationKey, "diary:2026-10-21");
assert.ok(calls.some(x => JSON.stringify(x).includes("雨后的山路")));
const countBefore = values.moments.length;
await page.reload();
await page.waitForTimeout(800);
const countAfter = await page.evaluate(() => new Promise(resolve => { const o = indexedDB.open("xiaozhang-pwa"); o.onsuccess = () => { const d=o.result,t=d.transaction("moments","readonly"),q=t.objectStore("moments").getAll(); t.oncomplete=()=>{d.close();resolve(q.result.length);}; }; }));
assert.equal(countAfter, countBefore, "same local day/cooldown must not duplicate records");
await page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open("xiaozhang-pwa"); open.onerror = () => reject(open.error); open.onsuccess = () => {
    const d = open.result; const tx = d.transaction(["diary", "kv"], "readwrite");
    tx.objectStore("diary").delete("auto-diary:2026-10-21");
    tx.objectStore("kv").put({ key: "social-automation-state", value: { momentNextAt: Date.now() + 60 * 60 * 1000 } });
    tx.oncomplete = () => { d.close(); resolve(); };
  };
}));
expectedApiFailure = true;
rejectNextDiaryRequest = true;
await page.click("#topbar-menu-toggle");
await page.locator("#diary-open").evaluate(button => button.click());
await page.waitForFunction(() => document.querySelector("#diary-dialog")?.open === true);
await page.waitForFunction(() => document.querySelector("#diary-generation-status")?.textContent?.includes("日记生成失败：聊天服务返回 HTTP 503"), null, { timeout: 8000 });
expectedApiFailure = false;
assert.equal(await page.locator("#diary-retry").isVisible(), true, "failed diary generation offers a retry action");
assert.equal((await db("diary", "all")).filter(entry => entry.source === "auto").length, 0, "failed diary request is not saved as an empty entry");
await page.click("#diary-retry");
await page.waitForFunction(() => document.querySelector("#diary-generation-status")?.textContent?.includes("今天的日记已经写好"), null, { timeout: 8000 });
assert.equal((await db("diary", "all")).filter(entry => entry.source === "auto").length, 1, "retry after a diary API failure saves a single complete entry");
await page.locator("#diary-dialog form[method=dialog] button").click();
await page.click("#topbar-menu-toggle");
await page.locator("#moments-open").evaluate(button => button.click());
await page.waitForFunction(() => document.querySelector("#moments-dialog")?.open === true);
const feedLayout = await page.locator("#moments-dialog").evaluate(element => { const rect = element.getBoundingClientRect(); return { open: element.open, width: rect.width, height: rect.height, viewportWidth: innerWidth, viewportHeight: innerHeight }; });
assert.equal(feedLayout.open, true);
assert.ok(Math.abs(feedLayout.width - feedLayout.viewportWidth) < 2, "moments feed must fill mobile width");
assert.ok(Math.abs(feedLayout.height - feedLayout.viewportHeight) < 2, "moments feed must fill mobile height");
const momentsBeforeManual = (await db("moments", "all")).length;
await page.evaluate(() => localStorage.setItem("xiaozhang-auto-moments", "false"));
await page.reload();
await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
await page.click("#topbar-menu-toggle");
await page.locator("#moments-open").evaluate(button => button.click());
await page.waitForFunction(() => document.querySelector("#moments-dialog")?.open === true);
await page.click("#moment-latest");
await page.waitForFunction(async (previousCount) => {
  const open = indexedDB.open("xiaozhang-pwa");
  return await new Promise(resolve => { open.onsuccess = () => { const d = open.result; const tx = d.transaction("moments", "readonly"); const q = tx.objectStore("moments").getAll(); tx.oncomplete = () => { d.close(); resolve(q.result.length > previousCount); }; }; });
}, momentsBeforeManual, { timeout: 8000 });
await page.waitForFunction(() => document.querySelector("#moment-latest-status")?.textContent?.includes("新动态已发布"), null, { timeout: 8000 });
assert.match(await page.locator("#moment-latest-status").textContent(), /新动态已发布/);
assert.ok(calls.some(x => JSON.stringify(x).includes("今天聊过雨后的山路和旧档案")), "manual latest feed calls the configured chat API with available context");
assert.equal(await db("moments", "all").then(rows => rows.length), momentsBeforeManual + 1, "manual latest feed writes one moment despite automatic posting being disabled");
const rotatedManualMoment = (await db("moments", "all")).find(row => row.source === "auto" && row.id !== moment.id);
assert.equal(rotatedManualMoment?.authorName, "王胖子", "manual latest feed rotates from the prior NPC to another character");
assert.ok(await page.locator('.moment[data-moment-author-kind="npc"] .moment-author strong').evaluateAll(elements => elements.some(element => element.textContent === "王胖子")), "rotated NPC identity is shown in the feed");
expectedApiFailure = true;
rejectNextSocialRequest = true;
await page.click("#moment-latest");
await page.waitForFunction(() => document.querySelector("#moment-latest-status")?.textContent?.includes("生成失败：聊天服务返回 HTTP 503"), null, { timeout: 8000 });
expectedApiFailure = false;
assert.equal(await db("moments", "all").then(rows => rows.length), momentsBeforeManual + 1, "API failure does not create a fabricated moment");
await page.click("#moment-latest");
await page.waitForFunction(async (expectedCount) => {
  const open = indexedDB.open("xiaozhang-pwa");
  return await new Promise(resolve => { open.onsuccess = () => { const d = open.result; const tx = d.transaction("moments", "readonly"); const q = tx.objectStore("moments").getAll(); tx.oncomplete = () => { d.close(); resolve(q.result.length === expectedCount); }; }; });
}, momentsBeforeManual + 2, { timeout: 8000 });
await page.waitForFunction(() => document.querySelector("#moment-latest-status")?.textContent?.includes("新动态已发布"), null, { timeout: 8000 });
assert.equal(await db("moments", "all").then(rows => rows.length), momentsBeforeManual + 2, "retry after failure saves exactly one moment");
const autoAuthorNames = () => db("moments", "all").then(rows => rows.filter(row => row.source === "auto").map(row => row.author === "npc" ? row.authorName : "张起灵"));
assert.ok((await autoAuthorNames()).includes("解雨臣"), "automatic author rotation includes 解雨臣");
for (const expectedAuthor of ["黑眼镜", "张海客", "张起灵"]) {
  const before = await db("moments", "all");
  await page.click("#moment-latest");
  await page.waitForFunction(async (previousCount) => {
    const open = indexedDB.open("xiaozhang-pwa");
    return await new Promise(resolve => { open.onsuccess = () => { const d = open.result; const tx = d.transaction("moments", "readonly"); const q = tx.objectStore("moments").getAll(); tx.oncomplete = () => { d.close(); resolve(q.result.length > previousCount); }; }; });
  }, before.length, { timeout: 8000 });
  await page.waitForFunction(() => document.querySelector("#moment-latest-status")?.textContent?.includes("新动态已发布"), null, { timeout: 8000 });
  const after = await db("moments", "all");
  const added = after.find(row => row.source === "auto" && !before.some(previous => previous.id === row.id));
  if (expectedAuthor === "张起灵") assert.equal(added?.author, "xiaopingzi", "author rotation returns to Zhang Qiling after all five NPCs");
  else { assert.equal(added?.author, "npc"); assert.equal(added?.authorName, expectedAuthor, `automatic author rotation publishes as ${expectedAuthor}`); }
  assert.ok(await page.locator(".moment-author strong").evaluateAll((elements, name) => elements.some(element => element.textContent === name), expectedAuthor), `${expectedAuthor} appears with the correct identity in the feed`);
}
await page.click("#moments-compose-toggle");
assert.equal(await page.locator("#moments-actions-menu").isVisible(), true, "plus opens moments actions");
assert.equal(await page.locator("#moment-publish-open").isVisible(), true, "publish action is available from plus");
assert.equal(await page.locator("#moment-avatar-settings-open").isVisible(), true, "avatar settings action is available from plus");
assert.equal(await page.locator("#moments-form").isVisible(), false, "composer stays collapsed until selected");
await page.click("#moment-publish-open");
assert.equal(await page.locator("#moments-form").isVisible(), true, "publish action opens real post form");
await page.locator("#moment-content").fill("今天的风很好。");
await page.click("#moment-publish");
await page.waitForFunction(() => Array.from(document.querySelectorAll(".moment-author strong")).some(element => element.textContent === "我"));
await page.click("#moments-compose-toggle");
await page.click("#moment-avatar-settings-open");
assert.equal(await page.locator("#moments-avatar-panel").isVisible(), true, "avatar settings open from plus");
assert.equal(await page.locator("#moments-form").isVisible(), false, "avatar settings collapse the composer");
await page.fill("#moment-user-nickname", "小梨");
await page.click("#moment-user-nickname-save");
await page.waitForFunction(() => document.querySelector("#moment-user-name")?.textContent === "小梨");
assert.equal(await page.locator("#moment-user-cover-name").textContent(), "小梨", "custom Moments nickname updates the profile cover");
const avatarControls = await page.evaluate(() => { const mine=document.querySelector("#moment-avatar-edit").getBoundingClientRect(); const friends=document.querySelector("#npc-avatar-toggle").getBoundingClientRect(); return { mine:{width:mine.width,height:mine.height}, friends:{width:friends.width,height:friends.height} }; });
assert.ok(Math.abs(avatarControls.mine.width-avatarControls.friends.width)<1 && Math.abs(avatarControls.mine.height-avatarControls.friends.height)<1, "user and NPC avatar controls have matching mobile dimensions");
const image = Buffer.from(pngBase64, "base64");
await page.locator("#moment-cover-input").setInputFiles({ name: "cover.png", mimeType: "image/png", buffer: image });
await page.waitForFunction(() => document.querySelector(".social-feed-cover")?.style.backgroundImage.includes("blob:"));
assert.equal(await page.locator("#moment-user-avatar-input").getAttribute("accept"), "image/*", "custom avatar picker accepts iPhone image formats");
const [avatarPicker] = await Promise.all([page.waitForEvent("filechooser"), page.locator("#moment-avatar-edit").click()]);
await avatarPicker.setFiles({ name: "avatar.png", mimeType: "image/png", buffer: image });
assert.equal(await page.locator("#moments-dialog").evaluate(dialog => dialog.open), true, "avatar upload keeps the Moments dialog open");
assert.equal(await page.locator("#moments-avatar-panel").isVisible(), true, "avatar upload does not reset the settings panel");
await page.waitForFunction(() => { const avatar = document.querySelector("#moment-user-avatar"); return avatar && !avatar.hidden && avatar.src.startsWith("blob:"); });
await page.waitForFunction(() => document.querySelector("#moment-avatar-status")?.textContent === "头像已保存。");
assert.ok(await page.locator("#moment-user-avatar").evaluate(image => image.complete && image.naturalWidth > 0), "selected avatar decodes and renders in the Moments profile");
await assertProfileAvatarVisible();
assert.ok(await page.locator('img[data-moment-author="user"]').evaluate(image => !image.hidden && image.src.startsWith("blob:")), "selected avatar updates existing user-authored moments too");
assert.ok(await page.locator(".moment[data-moment-author-kind='user'] .moment-author strong").count() === 1, "user-authored moment remains in the feed after profile update");
assert.equal(await page.evaluate(() => new Promise(resolve => { const o = indexedDB.open("xiaozhang-pwa"); o.onsuccess = () => { const d=o.result,t=d.transaction("kv","readonly"),q=t.objectStore("kv").get("user-avatar"); q.onsuccess=()=>{d.close();resolve(typeof q.result?.value === "string" && q.result.value.length > 0);}; }; })), true, "uploaded user avatar is persisted to IndexedDB");
await page.locator("#npc-avatar-toggle").click();
await page.locator('[data-npc-avatar-row="吴邪"] [data-npc-avatar-input]').setInputFiles({ name: "wuxie.png", mimeType: "image/png", buffer: image });
await page.waitForFunction(() => { const avatar = document.querySelector('.moment-author-avatar[data-moment-author-name="吴邪"]'); return avatar && !avatar.hidden && avatar.src.startsWith("blob:"); });
assert.equal(await page.locator("#moment-user-name").textContent(), "小梨");
assert.ok(await page.locator('.moment[data-moment-author-kind="npc"] .moment-author strong').evaluateAll(elements => elements.some(element => element.textContent === "吴邪")), "NPC post must retain its actual author");
await page.reload();
await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
await page.locator("#topbar-menu-toggle").click();
await page.locator("#moments-open").evaluate(button => button.click());
await page.waitForFunction(() => document.querySelector("#moments-dialog")?.open === true);
assert.ok(await page.locator(".social-feed-cover").evaluate(element => element.style.backgroundImage.includes("blob:")), "custom cover restores from IndexedDB");
assert.ok(await page.locator("#moment-user-avatar").evaluate(element => !element.hidden && element.src.startsWith("blob:")), "user avatar restores from IndexedDB");
await assertProfileAvatarVisible();
assert.ok(await page.locator('.moment-author-avatar[data-moment-author-name="吴邪"]').first().evaluate(element => !element.hidden && element.src.startsWith("blob:")), "custom NPC avatar restores from IndexedDB");
assert.ok(await page.locator('.moment[data-moment-author-kind="npc"] .moment-author strong').evaluateAll(elements => elements.some(element => element.textContent === "吴邪")), "NPC author survives reload");
await page.click("#moments-close");
await page.locator("#user-avatar-input").setInputFiles({ name: "chat-avatar.png", mimeType: "image/png", buffer: image });
await page.waitForFunction(() => {
  const avatar = document.querySelector("#moment-user-avatar");
  const chatAvatar = document.querySelector("[data-avatar-upload] img.message-avatar");
  return Boolean(avatar && !avatar.hidden && avatar.src.startsWith("blob:") && chatAvatar && chatAvatar.src.startsWith("blob:"));
});
await page.locator("#topbar-menu-toggle").click();
await page.locator("#moments-open").evaluate(button => button.click());
await page.waitForFunction(() => document.querySelector("#moments-dialog")?.open === true);
assert.ok(await page.locator("#moment-user-avatar").evaluate(element => !element.hidden && element.complete && element.naturalWidth > 0), "chat avatar upload immediately updates the profile avatar beside the Moments nickname");
await assertProfileAvatarVisible();
assert.ok(await page.locator('img[data-moment-author="user"]').evaluate(element => !element.hidden && element.complete && element.naturalWidth > 0), "chat avatar upload also updates existing user posts");
await page.click("#moments-close");
await page.reload();
await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
await page.locator("#topbar-menu-toggle").click();
await page.locator("#moments-open").evaluate(button => button.click());
await page.waitForFunction(() => document.querySelector("#moments-dialog")?.open === true);
assert.ok(await page.locator("#moment-user-avatar").evaluate(element => !element.hidden && element.complete && element.naturalWidth > 0), "chat avatar remains synchronized with the Moments profile after reload");
await assertProfileAvatarVisible();
await page.click("#moments-close");
assert.deepEqual(errors, []);
const freshContext = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", timezoneId: "Asia/Shanghai" });
const freshPage = await freshContext.newPage();
await freshPage.goto(origin);
await freshPage.waitForFunction(() => document.documentElement.dataset.appReady === "true");
await freshPage.click("#topbar-menu-toggle");
await freshPage.locator("#moments-open").evaluate(button => button.click());
await freshPage.waitForFunction(() => document.querySelector("#moments-dialog")?.open === true);
assert.equal(await freshPage.locator("#moment-user-avatar").isVisible(), false, "without a saved avatar the image stays hidden");
assert.equal(await freshPage.locator("#moment-user-avatar-fallback").isVisible(), true, "without a saved avatar the fallback remains available");
assert.equal(await freshPage.locator(".moment-source").count(), 0, "starter posts are not labelled as initial content");
assert.equal(await freshPage.locator(".moment").count(), 3, "a new empty feed receives a few persisted starter posts");
assert.ok(await freshPage.locator(".moment-media").count() >= 1, "starter feed mixes image posts with text-only posts");
assert.equal(await freshPage.locator("body").getByText("初始动态").count(), 0, "starter content has no artificial initial-post label");
await freshPage.click("#moment-latest");
assert.match(await freshPage.locator("#moment-latest-status").textContent(), /没有配置聊天 API/);
assert.equal(await freshPage.locator(".moment").count(), 3, "missing API configuration does not fabricate a new moment");
await freshContext.close();
const result = { passed: true, checks: ["automatic diary waits until opening the diary page", "diary opens full-screen and generates once after 20:00", "diary HTTP failure shows the response and allows retry without saving an empty entry", "automatic moment uses chat/travel context", "manual latest feed rotates through Zhang Qiling and all five NPCs with correct display identity", "manual latest feed calls configured API despite automatic posting being disabled", "API failure is shown and does not fabricate content; a later retry succeeds exactly once", "missing API configuration is reported without fabricating a moment", "NPC posts retain their author identity", "NPC comments persist with author metadata", "optional generated image is saved as local media", "reload does not duplicate automatic records", "moments opens as a full-screen mobile social feed with working composer", "new empty feeds receive image and text starter posts without an initial label", "custom user avatar and Moments nickname update profile and user-authored posts and persist after reload", "chat avatar upload synchronizes the Moments profile and existing user posts immediately and after reload", "user and NPC avatar controls have matching dimensions"], requests: calls.length, pageErrors: errors };
await writeFile(fileURLToPath(new URL("results.json", folder)), JSON.stringify(result, null, 2));
console.log(result);
await browser.close();

