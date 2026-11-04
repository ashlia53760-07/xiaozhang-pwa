// Temporary Chrome context and synthetic API/IndexedDB only. No paid calls or user profile.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import ts from "typescript";
const origin = process.env.DATE_TEST_URL || "http://127.0.0.1:4184";
const folder = new URL("../.local-review/date-isolation/", import.meta.url); await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu"], ...(process.env.TEST_PROXY ? { proxy: { server: process.env.TEST_PROXY } } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", reducedMotion: "reduce" });
await context.addInitScript(() => {
  for (const name of ["auto-moments", "auto-diary", "proactive-enabled"]) localStorage.setItem(`xiaozhang-${name}`, "false");
  localStorage.setItem("xiaozhang-pet-position", JSON.stringify({ x: 0, y: 430 }));
});
await context.route("**/__date-test/*.js", async route => {
  const name = new URL(route.request().url()).pathname.match(/\/([a-z-]+)\.js$/)?.[1];
  if (!name || name === "main") return route.abort();
  const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
  const body = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from "\.\/([^".]+)"/g, 'from "./$1.js"');
  await route.fulfill({ contentType: "text/javascript", body });
});
const calls = [], errors = [], checks = [];
await context.route("https://date-isolation.invalid/**", async route => {
  calls.push(route.request().postDataJSON());
  await route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: "灯影落在桌沿。他抬起眼，等你把话说完。" } }] }) });
});
const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
const ready = () => page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
const idle = () => page.waitForFunction(() => !document.querySelector("#send").disabled, null, { timeout: 120000 });
const data = (method, ...args) => page.evaluate(async ({ method, args }) => (await import("/__date-test/storage.js")).storage[method](...args), { method, args });
const pass = name => { checks.push(name); console.log("PASS", name); };
async function db(store, value) {
  return page.evaluate(({ store, value }) => new Promise((resolve, reject) => {
    const opening = indexedDB.open("xiaozhang-pwa"); opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => { const db = opening.result, tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(value); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
  }), { store, value });
}
async function feature(id) { if (!await page.locator("#topbar-menu").isVisible()) await page.click("#topbar-menu-toggle"); await page.click(id); }
async function modelAction(action) { const response = page.waitForResponse(r => r.url().startsWith("https://date-isolation.invalid/")); await action(); await response; await idle(); }
async function dateStart(setting) { await page.fill("#date-custom-setting", setting); await modelAction(() => page.click("#date-start")); }
async function dateSend(text) { await page.fill("#date-draft", text); await modelAction(() => page.click("#date-send")); }
async function closeDate() { await page.locator("#date-dialog").evaluate(el => el.close()); }
async function saveRecall() { await page.click("#date-dialog .scene-options summary"); await page.click("#date-save-memory"); await page.waitForFunction(() => document.querySelector("#date-dialog .scene-status")?.textContent.includes("已保存到本场回忆")); }
function absent(markers) { const body = JSON.stringify(calls.at(-1)); for (const marker of markers) assert(!body.includes(marker), marker); }
try {
  await page.goto(origin); await ready();
  const now = Date.now(), today = new Date().toLocaleDateString("en-CA");
  await db("kv", { key: "api-profile", value: { baseUrl: "https://date-isolation.invalid/v1", model: "synthetic", apiKey: "SYNTHETIC_DATE_KEY", temperature: .5 } });
  await db("kv", { key: "calendar-data", value: { records: { [today]: { date: today, note: "DAILY_CALENDAR_ONLY", mood: "开心", updatedAt: now } }, events: [], holidays: {}, shareWithChat: true, updatedAt: now } });
  await db("kv", { key: "character-settings", value: { userName: "本场用户", worldBook: "STATIC_PRIVATE_WORLD", updatedAt: now } });
  await db("memories", { id: "normal-memory", content: "DAILY_PRIVATE_MEMORY_ONLY", category: "用户明确保存", enabled: true, source: "user", createdAt: now, updatedAt: now });
  await db("memories", { id: "old-date-export", content: "约会回忆（旧场）：LEGACY_PRIVATE_DATE_ONLY", category: "用户确认的约会回忆", enabled: true, source: "user", createdAt: now, updatedAt: now });
  await db("messages", { id: "daily-private", role: "user", kind: "text", content: "DAILY_PRIVATE_CHAT_ONLY", sessionId: "private", createdAt: now });
  await db("messages", { id: "daily-life", role: "user", kind: "text", content: "DAILY_LIFE_ONLY", sessionId: "life", createdAt: now });
  await page.reload(); await ready(); await feature("#date-open"); await dateStart("PRIVATE_DATE_A_SETTING");
  assert(JSON.stringify(calls.at(-1)).includes("STATIC_PRIVATE_WORLD"));
  absent(["DAILY_PRIVATE_MEMORY_ONLY", "DAILY_PRIVATE_CHAT_ONLY", "DAILY_CALENDAR_ONLY", "DAILY_LIFE_ONLY", "LEGACY_PRIVATE_DATE_ONLY"]);
  await dateSend("PRIVATE_DATE_A_EVENT"); await saveRecall();
  let a = (await data("dateSessions")).find(row => row.active && !row.groupId);
  assert(a.localMemories[0].content.includes("PRIVATE_DATE_A_EVENT"));
  assert.equal((await data("allMemories")).length, 2);
  await dateSend("继续本场"); assert(JSON.stringify(calls.at(-1)).includes("PRIVATE_DATE_A_EVENT"));
  await page.click("#date-end"); await page.waitForSelector("#date-start", { state: "visible" }); await dateStart("PRIVATE_DATE_B_SETTING");
  absent(["PRIVATE_DATE_A_SETTING", "PRIVATE_DATE_A_EVENT", "DAILY_PRIVATE_MEMORY_ONLY", "DAILY_CALENDAR_ONLY"]);
  await dateSend("PRIVATE_DATE_B_EVENT"); await saveRecall();
  pass("私聊每场约会仅使用本场剧情和回忆；日常记忆、聊天、线下、日历与其他约会全部隔离");
  await closeDate(); await page.fill("#draft", "日常聊聊"); await modelAction(() => page.click("#send"));
  for (const marker of ["DAILY_PRIVATE_MEMORY_ONLY", "DAILY_CALENDAR_ONLY", "DAILY_PRIVATE_CHAT_ONLY"]) assert(JSON.stringify(calls.at(-1)).includes(marker), marker);
  absent(["PRIVATE_DATE_A_EVENT", "PRIVATE_DATE_B_EVENT", "LEGACY_PRIVATE_DATE_ONLY"]);
  assert.equal((await data("allMemories")).length, 2);
  pass("日常私聊继续使用原有记忆和日历；旧约会导出的回忆仍保留，但不再进入日常上下文");
  const group = { id: "date-isolation-group", title: "隔离验证", userName: "本场用户", background: "STATIC_GROUP_WORLD", worldBook: "STATIC_GROUP_CANON", members: [{ id: "wu-xie", characterId: "wu-xie", name: "吴邪", enabled: true }, { id: "wang-pangzi", characterId: "wang-pangzi", name: "王胖子", enabled: true }], memories: [{ id: "normal-group-memory", content: "DAILY_GROUP_MEMORY_ONLY", enabled: true, source: "user", createdAt: now, updatedAt: now }, { id: "group-scene-memory_legacy", content: "约会剧场回忆（旧场）：LEGACY_GROUP_DATE_ONLY", enabled: true, source: "user", createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now };
  await db("groups", group);
  await db("messages", { id: "daily-group", sessionId: group.id, role: "user", kind: "text", content: "DAILY_GROUP_CHAT_ONLY", createdAt: now });
  await db("kv", { key: `group-life:${group.id}`, value: { id: "group-life-isolation", groupId: group.id, memberIds: group.members.map(row => row.id), active: true, location: "门廊", timeLabel: "傍晚", environment: "雨", activity: "GROUP_LIFE_ONLY", messages: [{ id: "group-life-event", role: "user", content: "GROUP_LIFE_ONLY", kind: "text", createdAt: now }], updatedAt: now } });
  await data("saveActiveSession", group.id); await page.reload(); await ready(); await feature("#date-open"); await dateStart("GROUP_DATE_A_SETTING");
  assert(JSON.stringify(calls.at(-1)).includes("STATIC_GROUP_WORLD"));
  absent(["DAILY_GROUP_MEMORY_ONLY", "DAILY_GROUP_CHAT_ONLY", "GROUP_LIFE_ONLY", "LEGACY_GROUP_DATE_ONLY", "PRIVATE_DATE_A_EVENT", "PRIVATE_DATE_B_EVENT", "DAILY_PRIVATE_MEMORY_ONLY"]);
  await dateSend("GROUP_DATE_A_EVENT"); await saveRecall();
  const ga = (await data("dateSessions")).find(row => row.active && row.groupId === group.id);
  assert.equal(ga.openingContext, undefined); assert(ga.localMemories[0].content.includes("GROUP_DATE_A_EVENT"));
  assert.deepEqual((await data("groups")).find(row => row.id === group.id).memories, group.memories);
  // Verify legacy captured opening history is ignored even when retained in a restored save.
  ga.openingContext = "LEGACY_CAPTURED_OPENING_ONLY"; await data("saveGroupScene", ga, ga.revision);
  await dateSend("接着写本场"); assert(JSON.stringify(calls.at(-1)).includes("GROUP_DATE_A_EVENT")); absent(["LEGACY_CAPTURED_OPENING_ONLY"]);
  await page.click("#date-end"); await page.waitForSelector("#date-start", { state: "visible" }); await dateStart("GROUP_DATE_B_SETTING");
  absent(["GROUP_DATE_A_SETTING", "GROUP_DATE_A_EVENT", "LEGACY_CAPTURED_OPENING_ONLY", "DAILY_GROUP_MEMORY_ONLY", "DAILY_GROUP_CHAT_ONLY", "GROUP_LIFE_ONLY"]);
  await dateSend("GROUP_DATE_B_EVENT"); await saveRecall();
  pass("群聊约会不捕捉线上开场、不读取共同或线下记忆；旧 openingContext 忽略，本场保存不写回群且不进入下一场");
  await closeDate();
  await page.fill("#draft", "@吴邪 日常聊聊"); await modelAction(() => page.click("#send"));
  assert(JSON.stringify(calls.at(-1)).includes("DAILY_GROUP_MEMORY_ONLY"));
  absent(["GROUP_DATE_A_EVENT", "GROUP_DATE_B_EVENT", "LEGACY_GROUP_DATE_ONLY"]);
  await feature("#meet-open"); await page.fill("#life-draft", "线下继续"); await modelAction(() => page.click("#life-send"));
  assert(JSON.stringify(calls.at(-1)).includes("DAILY_GROUP_MEMORY_ONLY"));
  absent(["GROUP_DATE_A_EVENT", "GROUP_DATE_B_EVENT", "LEGACY_GROUP_DATE_ONLY", "PRIVATE_DATE_A_EVENT"]);
  pass("群线上和连续线下保持原有衔接；都不读取任何约会回忆");
  const signatureChecks = await page.evaluate(async () => {
    const { rememberDate, dateMemoryContext } = await import("/__date-test/context-budget.js");
    const scene = { messages: [{ id: "a", role: "user", content: "ORIGINAL_LOCAL_RECALL", kind: "text", createdAt: 1 }], updatedAt: 1 };
    rememberDate(scene); const before = dateMemoryContext(scene); rememberDate(scene); const count = scene.localMemories.length;
    scene.messages[0].content = "EDITED_LOCAL_RECALL"; const afterEdit = dateMemoryContext(scene);
    scene.messages = []; const afterDelete = dateMemoryContext(scene);
    return { before, afterEdit, afterDelete, count };
  });
  assert(signatureChecks.before.includes("ORIGINAL_LOCAL_RECALL")); assert.equal(signatureChecks.afterEdit, ""); assert.equal(signatureChecks.afterDelete, ""); assert.equal(signatureChecks.count, 1);
  pass("本场回忆重复保存去重；编辑、删除或回退来源后，过时回忆不会再次进入模型");
  await page.screenshot({ path: new URL("group-life.png", folder).pathname.replace(/^\/([A-Za-z]:)/, "$1") });
  assert.deepEqual(errors, []);
  await writeFile(new URL("results.json", folder), JSON.stringify({ passed: true, origin, checks, requests: calls.length, errors, data: "synthetic only" }, null, 2));
} finally { await context.close(); await browser.close(); }
