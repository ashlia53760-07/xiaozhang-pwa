// Isolated Chrome + synthetic IndexedDB and model responses; no user profile or paid calls.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import ts from "typescript";
const origin = process.env.SCRIPT_LIBRARY_TEST_URL || "http://127.0.0.1:4184";
const folder = new URL("../.local-review/script-library/", import.meta.url); await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu"], ...(process.env.TEST_PROXY ? { proxy: { server: process.env.TEST_PROXY } } : {}) });
const init = () => { for (const name of ["auto-moments", "auto-diary", "proactive-enabled"]) localStorage.setItem(`xiaozhang-${name}`, "false"); localStorage.setItem("xiaozhang-pet-position", JSON.stringify({ x: 0, y: 430 })); };
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", reducedMotion: "reduce", hasTouch: true });
await context.addInitScript(init);
await context.route("**/__script-test/*.js", async route => {
  const name = new URL(route.request().url()).pathname.match(/\/([a-z-]+)\.js$/)?.[1]; if (!name || name === "main") return route.abort();
  const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
  const body = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from "\.\/([^".]+)"/g, 'from "./$1.js"');
  await route.fulfill({ contentType: "text/javascript", body });
});
const calls = [], errors = [], checks = []; let failNext = false, holdNext = false, release;
await context.route("https://script-test.invalid/**", async route => {
  calls.push(route.request().postDataJSON());
  if (holdNext) { holdNext = false; await new Promise(resolve => { release = resolve; }); }
  if (failNext) { failNext = false; return route.fulfill({ status: 503, body: "synthetic failure" }); }
  const content = `他把折好的纸留在灯下，停了一会儿，等你接着说。MOCK_STORY_${calls.length}\n\n` + "风掠过窗沿，纸上的字在灯下很清楚。对面的人抬起眼，没有替你作决定。".repeat(30);
  await route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content } }] }) }).catch(() => {});
});
const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
page.on("dialog", dialog => dialog.accept());
const ready = () => page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
const idle = () => page.waitForFunction(() => !document.querySelector("#send").disabled, null, { timeout: 120000 });
const data = (method, ...args) => page.evaluate(async ({ method, args }) => (await import("/__script-test/storage.js")).storage[method](...args), { method, args });
const pass = name => { checks.push(name); console.log("PASS", name); };
async function db(store, value, target = page) { return target.evaluate(({ store, value }) => new Promise((resolve, reject) => { const open = indexedDB.open("xiaozhang-pwa"); open.onsuccess = () => { const db = open.result, tx = db.transaction(store, value ? "readwrite" : "readonly"), req = value ? tx.objectStore(store).put(value) : tx.objectStore(store).getAll(); tx.oncomplete = () => { db.close(); resolve(req.result); }; tx.onerror = () => reject(tx.error); }; open.onerror = () => reject(open.error); }), { store, value }); }
async function feature(id) { if (!await page.locator("#topbar-menu").isVisible()) await page.click("#topbar-menu-toggle"); await page.click(id); }
async function model(action) { const result = page.waitForResponse(r => r.url().startsWith("https://script-test.invalid/")); await action(); await result; await idle(); }
async function send(text) { await page.fill("#date-draft", text); await model(() => page.click("#date-send")); }
async function back() { await page.click("#date-library-back"); await page.waitForSelector("#date-picker", { state: "visible" }); }
async function resume(id, read = false) { await page.click("#script-tab-runs"); await page.click(`[data-run-${read ? "open" : "resume"}="${id}"]`); await page.waitForSelector("#date-stage", { state: "visible" }); }
async function saved(text) { await page.waitForFunction(text => document.querySelector("#date-dialog .scene-status").textContent.includes(text), text); }
const latest = async () => (await data("dateSessions")).find(row => row.scriptSnapshot);
const assertAbsent = (...markers) => { const body = JSON.stringify(calls.at(-1)); for (const marker of markers) assert(!body.includes(marker), marker); };
try {
  await page.goto(origin); await ready();
  const now = Date.now(), group = { id: "legacy-group", title: "旧群", userName: "GROUP_NAME_PRIVATE", background: "GROUP_STATIC_ONLY", members: [{ id: "wu-xie", characterId: "wu-xie", name: "吴邪", persona: "", enabled: true }, { id: "wang-pangzi", characterId: "wang-pangzi", name: "王胖子", persona: "", enabled: true }], memories: [{ id: "gm", content: "GROUP_MEMORY_PRIVATE", enabled: true }], createdAt: now, updatedAt: now };
  await data("saveProfile", { baseUrl: "https://script-test.invalid/v1", model: "synthetic", apiKey: "SYNTHETIC_SCRIPT_KEY", temperature: .5 });
  await db("groups", group); await db("messages", { id: "daily", role: "user", content: "DAILY_CHAT_PRIVATE", kind: "text", createdAt: now, sessionId: "private" });
  await db("memories", { id: "daily", content: "DAILY_MEMORY_PRIVATE", category: "用户保存", enabled: true, source: "user", createdAt: now, updatedAt: now });
  await db("kv", { key: "character-settings", value: { userName: "PRIVATE_NICKNAME", relationship: "PRIVATE_RELATIONSHIP", worldBook: "PRIVATE_WORLD_BOOK", updatedAt: now } });
  const legacy = { id: "legacy-single", title: "原有单人剧场", scene: "custom", setting: "LEGACY_SINGLE_SETTING", atmosphere: "雨", characterId: "wu-xie", active: false, messages: [{ id: "old-row", role: "assistant", content: "OLD_SINGLE_STORY", kind: "text", createdAt: now }], createdAt: now, updatedAt: now };
  const legacyGroup = { ...legacy, id: "legacy-multi", title: "原有多人剧场", characterId: undefined, groupId: group.id, memberIds: group.members.map(row => row.id), setting: "LEGACY_GROUP_SETTING", messages: [{ ...legacy.messages[0], id: "old-group-row", content: "OLD_GROUP_STORY" }] };
  await data("saveDateSession", legacy); await data("saveDateSession", legacyGroup);
  await page.reload(); await ready(); await feature("#date-open");
  assert.equal(await page.locator("#date-dialog h2").textContent(), "剧本夹");
  await page.fill("#script-title", "灯下的来信 <b>原稿</b>"); await page.fill("#date-custom-setting", "SCRIPT_A_INSTRUCTIONS 在旧书店见面，先读信，不替我行动。");
  await page.locator('#script-characters input[value="wu-xie"]').check(); await page.fill("#script-atmosphere", "克制、具体，有日常的停顿");
  const png = await page.evaluate(() => { const canvas = document.createElement("canvas"); canvas.width = 20; canvas.height = 30; const ctx = canvas.getContext("2d"); ctx.fillStyle = "#d6e1dc"; ctx.fillRect(0, 0, 20, 30); return canvas.toDataURL("image/png").split(",")[1]; });
  await page.locator("#date-background-input").setInputFiles({ name: "scene.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") }); await saved("背景已保存");
  await page.click("#script-save"); await saved("剧本已保存");
  let sheet = (await data("theatreScripts"))[0]; const scriptId = sheet.id;
  const originalBackground = sheet.backgroundMediaId; assert(originalBackground);
  assert.equal(sheet.mode, "single"); assert.deepEqual(sheet.characterIds, ["wu-xie"]); assert.equal(calls.length, 0); assert.equal(await page.locator("#script-sheets b").count(), 0);
  await page.locator('[name="script-mode"][value="multi"]').check(); await page.click("#date-start"); await idle(); await saved("至少选择两位"); assert.equal(calls.length, 0); assert.equal((await data("dateSessions")).length, 2);
  await page.locator('[name="script-mode"][value="single"]').check();
  pass("剧本独立保存、名称转义与人数校验正常；保存和无效开演不调用模型");

  await model(() => page.click("#date-start")); let a = await latest(); const aId = a.id;
  assert.equal(a.scriptSnapshot.revision, 1);
  assert.equal(a.groupId, undefined); assert.equal(a.messages.length, 1); assert.equal((await data("groups")).length, 1); assert.equal(calls.length, 1);
  assert.deepEqual(a.scriptSnapshot.characterIds, ["wu-xie"]); assert(JSON.stringify(calls.at(-1)).includes("【吴邪】"));
  assertAbsent("DAILY_CHAT_PRIVATE", "DAILY_MEMORY_PRIVATE", "PRIVATE_NICKNAME", "PRIVATE_RELATIONSHIP", "PRIVATE_WORLD_BOOK", "GROUP_STATIC_ONLY", "GROUP_MEMORY_PRIVATE", "LEGACY_SINGLE_SETTING", "LEGACY_GROUP_SETTING");
  await send("PERFORMANCE_A_ONLY 我把信放在灯下。");
  await page.click("#date-dialog .scene-options summary"); await page.click("#date-save-memory"); await idle(); await saved("已保存到本场回忆");
  await page.click("#date-dialog .scene-options summary"); await page.click('#date-stage [data-date-background-remove]'); await saved("已恢复素白");
  a = (await data("dateSessions")).find(row => row.id === aId); assert(a.localMemories[0].content.includes("PERFORMANCE_A_ONLY"));
  await back(); assert((await data("dateSessions")).find(row => row.id === aId).active);
  pass("从私聊自由选其他角色开演，不创建群；本场回忆不写入日常，返回剧本夹保留进度");

  await page.click(`[data-script-load="${scriptId}"]`); await page.fill("#date-custom-setting", "SCRIPT_B_INSTRUCTIONS 同一个本的新版本，在门廊读另一封信。");
  await page.locator('[name="script-mode"][value="multi"]').check(); await page.locator('#script-characters input[value="wang-pangzi"]').check();
  await page.locator(".script-extra summary").click(); await page.fill("#script-user-name", "本剧称呼"); await page.fill("#script-arrangement", "PLAY_LOCAL_RELATIONSHIP 这次只是初次见面的同行者。");
  await model(() => page.click("#date-start")); const b = await latest(), bId = b.id;
  assert.notEqual(bId, aId); assert.equal(b.groupId, undefined); assert.deepEqual(b.scriptSnapshot.characterIds, ["wu-xie", "wang-pangzi"]); assert.equal(b.messages.length, 1);
  assert.equal((await data("groups")).length, 1); assertAbsent("PERFORMANCE_A_ONLY", "SCRIPT_A_INSTRUCTIONS", "DAILY_MEMORY_PRIVATE", "GROUP_STATIC_ONLY", "PRIVATE_RELATIONSHIP");
  assert(JSON.stringify(calls.at(-1)).includes("【吴邪】")); assert(JSON.stringify(calls.at(-1)).includes("【王胖子】")); assert(JSON.stringify(calls.at(-1)).includes("PLAY_LOCAL_RELATIONSHIP"));
  assert.equal((await data("dateSessions")).find(row => row.id === aId).scriptSnapshot.setting, a.scriptSnapshot.setting);
  await page.click("#date-dialog .scene-options summary"); await page.click('#date-stage [data-date-background-remove]'); await saved("已恢复素白");
  await send("PERFORMANCE_B_ONLY 我站在门廊边。"); await back();
  await page.click(`[data-script-delete="${scriptId}"]`); await saved("剧本已删除"); assert.equal((await data("theatreScripts")).length, 0);
  await resume(aId); await send("接着读刚才的信。"); assert(JSON.stringify(calls.at(-1)).includes("PERFORMANCE_A_ONLY")); assertAbsent("PERFORMANCE_B_ONLY", "SCRIPT_B_INSTRUCTIONS", "PLAY_LOCAL_RELATIONSHIP");
  pass("同一本可改版换人重演；旧演出保留开场快照，删模板后照常续演，两场剧情与关系隔离");

  const old = (await data("dateSessions")).find(row => row.id === aId), source = old.messages[1];
  await page.locator(`#date-messages [data-message-id="${source.id}"] .scene-entry-paper`).dispatchEvent("contextmenu");
  await page.click("#scene-floor-edit"); await page.fill("#scene-floor-text", "CORRECTED_A_ONLY 我把更正后的信放在灯下。"); await page.click("#scene-floor-save"); await page.waitForSelector("#scene-floor-dialog[open]", { state: "hidden" });
  await page.waitForFunction(() => !document.querySelector("#scene-floor-text").readOnly);
  await page.locator(`#date-messages [data-message-id="${source.id}"] .scene-entry-paper`).dispatchEvent("contextmenu"); await page.click("#scene-floor-rewind"); await page.click("#scene-floor-confirm-rewind"); await page.waitForSelector("#scene-floor-dialog[open]", { state: "hidden" });
  assert.equal((await data("dateSessions")).find(row => row.id === aId).messages.length, 2); assert((await data("dateSessions")).find(row => row.id === bId).active);
  await page.click("#date-dialog .scene-action-menu summary"); await model(() => page.click('#date-dialog [data-scene-action="regenerate"]'));
  assert(JSON.stringify(calls.at(-1)).includes("CORRECTED_A_ONLY")); assertAbsent("PERFORMANCE_A_ONLY", "PERFORMANCE_B_ONLY");
  pass("新演出沿用楼层编辑、回退与重新生成；回退只动本场，旧回忆和摘要不再引入更正前内容");

  await back(); await page.fill("#date-custom-setting", "UNSAVED_LIBRARY_DRAFT"); await resume(legacy.id, true); assert((await page.locator("#date-messages").textContent()).includes("OLD_SINGLE_STORY")); assert.equal(await page.locator("#date-dialog .scene-writing").isVisible(), false);
  await back(); assert.equal(await page.inputValue("#date-custom-setting"), "UNSAVED_LIBRARY_DRAFT"); await resume(legacyGroup.id); await send("LEGACY_GROUP_NEW_EVENT"); assert(JSON.stringify(calls.at(-1)).includes("OLD_GROUP_STORY")); assertAbsent("GROUP_MEMORY_PRIVATE", "PERFORMANCE_B_ONLY");
  await back(); assert.equal(await page.inputValue("#date-custom-setting"), "UNSAVED_LIBRARY_DRAFT"); await page.click("#script-tab-runs"); await page.click(`[data-run-template="${legacy.id}"]`); await saved("已提取"); assert.equal(await page.inputValue("#date-custom-setting"), legacy.setting);
  await page.click("#script-save"); await saved("剧本已保存"); assert.equal((await data("theatreScripts")).length, 1);
  pass("旧单人和群聊剧场可以查看、继续与提取原指令，保留原文和原有记忆边界");

  const beforeFailed = (await data("dateSessions")).length; failNext = true;
  await model(() => page.click("#date-start")); await saved("503");
  const failed = await latest(); assert.equal((await data("dateSessions")).length, beforeFailed + 1); assert.equal(failed.messages.length, 0);
  await page.click("#date-dialog .scene-action-menu summary"); await model(() => page.click('#date-dialog [data-scene-action="regenerate"]')); assert.equal((await data("dateSessions")).find(row => row.id === failed.id).messages.length, 1);
  await page.fill("#date-draft", "并发与停止验证"); holdNext = true; const started = page.waitForRequest(r => r.url().startsWith("https://script-test.invalid/")); await page.click("#date-send"); await started;
  assert(await page.locator("#date-library-back").isDisabled()); const count = calls.length; await page.locator("#date-start").evaluate(button => button.click()); assert.equal(calls.length, count);
  await page.click('[data-group-scene-stop="date"]'); release(); await idle(); assert.equal((await data("dateSessions")).find(row => row.id === failed.id).messages.length, 2);
  pass("开场失败不造角色楼层，可重试；生成中锁定切换和重复开演，停止保留用户落笔");

  await back();
  const current = (await data("theatreScripts"))[0]; const stale = structuredClone(current);
  await data("saveTheatreScript", { ...current, title: "另一页面的新标题" }, current.revision);
  assert(await data("saveTheatreScript", stale, stale.revision).then(() => false, () => true));
  assert(await data("deleteTheatreScript", stale.id, stale.revision).then(() => false, () => true));
  const dirty = { ...current, id: "import-script", apiKey: "MALICIOUS_IMPORT_KEY", revision: 1, title: "导入剧本" };
  await page.locator("#script-import-file").setInputFiles({ name: "scripts.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "xiaozhang-theatre-scripts", version: 1, scripts: [dirty] })) }); await saved("已导入 1 个");
  assert(!JSON.stringify(await data("theatreScripts")).includes("MALICIOUS_IMPORT_KEY"));
  const dl = page.waitForEvent("download"); await page.click("#script-export"); const exported = JSON.parse(await readFile(await (await dl).path(), "utf8"));
  assert.equal(exported.scripts.length, 2); assert(!JSON.stringify(exported).includes("SYNTHETIC_SCRIPT_KEY")); assert(!JSON.stringify(exported).includes("PERFORMANCE_B_ONLY"));
  pass("剧本并发编辑和删除拒绝过期写入；独立导入导出只含指令，剔除额外密钥字段");

  await page.click('[data-script-load="import-script"]'); await page.waitForFunction(() => !document.querySelector("#script-title").disabled);
  const shared = await data("profile"), preferences = await data("contactPreferences", "wu-xie");
  await data("saveProfile", { ...shared, apiKey: "" }); const runCount = (await data("dateSessions")).length, requestCount = calls.length;
  await page.click("#date-start"); await idle(); await saved("API"); assert.equal((await data("dateSessions")).length, runCount); assert.equal(calls.length, requestCount);
  assert.equal(await page.inputValue("#date-custom-setting"), current.setting);
  await data("saveProfile", shared); await data("saveContactPreferences", "wu-xie", { ...preferences, api: { ...shared, model: "actor-specific-model" } });
  await model(() => page.click("#date-start")); assert.equal(calls.at(-1).model, "actor-specific-model"); await data("saveContactPreferences", "wu-xie", preferences); await back();
  pass("未配置模型时保留剧本且不开假场；单人沿用所选角色的 API 配置，多人沿用共享模型");

  for (const theme of ["ink", "warm", "night", "rococo", "bronze"]) for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 }); await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
    const overflow = await page.locator("#date-picker").evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth })); assert(overflow.scroll <= overflow.client + 1, `${theme} ${width} ${JSON.stringify(overflow)}`);
    await page.click("#script-tab-runs"); assert(await page.locator(`[data-run-resume="${aId}"]`).isVisible()); await page.click("#script-tab-sheets");
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => document.documentElement.dataset.theme = "rococo"); await page.locator("#date-picker").evaluate(el => el.scrollTop = 0);
  await page.screenshot({ path: new URL("library.png", folder).pathname.replace(/^\/([A-Za-z]:)/, "$1") });
  await resume(aId); const scroll = await page.locator("#date-messages").evaluate(el => { const card = document.querySelector("#date-state-card"); el.scrollTop = el.scrollHeight; return { first: el.firstElementChild === card, bottom: card.getBoundingClientRect().bottom, top: el.getBoundingClientRect().top, height: el.clientHeight }; });
  assert(scroll.first && scroll.bottom < scroll.top && scroll.height > 350); await page.screenshot({ path: new URL("reader.png", folder).pathname.replace(/^\/([A-Za-z]:)/, "$1") });
  pass("五主题在 320/390/1280 宽度无横向溢出；演出设定卡随消息上滚，不占阅读区");

  await back(); await page.click("#date-library-back"); await feature("#settings");
  const full = page.waitForEvent("download"); await page.click("#export-data"); const backup = JSON.parse(await readFile(await (await full).path(), "utf8"));
  assert.equal(backup.theatreScripts.length, 2); assert(backup.dateSessions.some(row => row.id === aId && row.scriptSnapshot)); assert(!JSON.stringify(backup).includes("SYNTHETIC_SCRIPT_KEY"));
  assert(backup.media.some(row => row.id === originalBackground), "even a deleted sheet's original snapshot background is backed up");
  const checkpoint = await data("makeArchive", "剧本夹检查点", "checkpoint"), archive = await data("exportArchive", checkpoint.id); assert.equal(archive.rows.kv.find(row => row.key === "script-library").value.length, 2);
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" }); await fresh.addInitScript(init);
  try {
    const restored = await fresh.newPage(); restored.on("pageerror", error => errors.push(error.message)); await restored.goto(origin); await restored.waitForFunction(() => document.documentElement.dataset.appReady === "true");
    await restored.click("#topbar-menu-toggle"); await restored.click("#settings"); await restored.locator("#import-data").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
    await restored.waitForFunction(async id => new Promise(resolve => { const open = indexedDB.open("xiaozhang-pwa"); open.onsuccess = () => { const db = open.result, get = db.transaction("kv").objectStore("kv").get("date-sessions"); get.onsuccess = () => { db.close(); resolve(get.result?.value?.some(row => row.id === id)); }; }; }), aId);
    assert.equal((await db("kv", undefined, restored)).find(row => row.key === "script-library").value.length, 2);
    await restored.locator("#settings-dialog").evaluate(el => el.close()); if (!await restored.locator("#topbar-menu").isVisible()) await restored.click("#topbar-menu-toggle"); await restored.click("#date-open"); await restored.click("#script-tab-runs"); await restored.click(`[data-run-open="${aId}"]`);
    await restored.waitForSelector("#date-stage:not([hidden])");
    assert((await restored.locator("#date-messages").textContent()).includes("CORRECTED_A_ONLY")); assert(!(await restored.locator("#date-messages").textContent()).includes("PERFORMANCE_B_ONLY"));
  } finally { await fresh.close(); }
  pass("整机备份与关系档案包含剧本和独立演出；空浏览器恢复正文、快照与本场记忆，不导出 API 密钥");
  assert.deepEqual(errors, []); await writeFile(new URL("results.json", folder), JSON.stringify({ passed: true, origin, checks, modelFixtureCalls: calls.length, errors }, null, 2));
} catch (error) { await writeFile(new URL("failure-calls.json", folder), JSON.stringify(calls, null, 2)); await page.screenshot({ path: new URL("failure.png", folder).pathname.replace(/^\/([A-Za-z]:)/, "$1"), fullPage: true }).catch(() => {}); throw error; }
finally { await context.close(); await browser.close(); }
