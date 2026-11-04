// Real Chrome, synthetic IndexedDB, mocked APIs. No user browser profile or paid calls.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import ts from "typescript";
const origin = process.env.GROUP_SCENE_TEST_URL || "http://127.0.0.1:4180";
const folder = new URL("../.local-review/group-scenes/", import.meta.url); await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu"], ...(process.env.TEST_PROXY ? { proxy: { server: process.env.TEST_PROXY } } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: "block", reducedMotion: "reduce" });
await context.addInitScript(() => { for (const key of ["auto-moments", "auto-diary", "proactive-enabled"]) localStorage.setItem(`xiaozhang-${key}`, "false"); localStorage.setItem("xiaozhang-pet-position", JSON.stringify({ x: 0, y: 430 })); });
await context.route("**/__group-scene-test/*.js", async route => {
  const name = new URL(route.request().url()).pathname.match(/\/([a-z-]+)\.js$/)?.[1];
  if (!name || name === "main") return route.abort();
  const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
  const body = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from "\.\/([^".]+)"/g, 'from "./$1.js"');
  await route.fulfill({ contentType: "text/javascript", body });
});
const page = await context.newPage(), calls = [], errors = [], checks = [];
page.on("pageerror", error => errors.push(error.message));
let failName = "", holdName = "", release, held;
await context.route("https://group-scene-test.invalid/**", async route => {
  const body = route.request().postDataJSON(), prompt = body.messages[0].content;
  const name = prompt.match(/你只扮演([^，]+)，不替其他角色/)?.[1] || "角色";
  calls.push({ body, name });
  if (name === holdName) { holdName = ""; held?.(); await new Promise(resolve => { release = resolve; }); }
  if (name === failName) { failName = ""; return route.fulfill({ status: 503, body: "synthetic unavailable" }); }
  await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ choices: [{ delta: { content: `${name}看了看窗外。第${calls.length}次模拟回应，接住刚才的剧情。` } }] })}\n\ndata: [DONE]\n\n` });
});
const pass = name => { checks.push(name); console.log("PASS", name); };
const ready = () => page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
const idle = () => page.waitForFunction(() => !document.querySelector("#send").disabled, null, { timeout: 120000 });
const data = (method, ...args) => page.evaluate(async ({ method, args }) => (await import("/__group-scene-test/storage.js")).storage[method](...args), { method, args });
async function db(store, value, target = page) {
  return target.evaluate(({ store, value }) => new Promise((resolve, reject) => {
    const open = indexedDB.open("xiaozhang-pwa"); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const database = open.result, tx = database.transaction(store, value ? "readwrite" : "readonly"), request = value ? tx.objectStore(store).put(value) : tx.objectStore(store).getAll(); tx.oncomplete = () => { database.close(); resolve(request.result); }; tx.onerror = () => reject(tx.error); };
  }), { store, value });
}
async function feature(id) { if (!await page.locator("#topbar-menu").isVisible()) await page.click("#topbar-menu-toggle"); await page.click(id); const dialog = { "#meet-open": "#meet-dialog", "#date-open": "#date-dialog", "#settings": "#settings-dialog" }[id]; if (dialog) await page.waitForSelector(`${dialog}[open]`); }
async function switchGroup(id) { await db("kv", { key: "active-session", value: id }); await page.reload(); await ready(); }
const parent = mode => mode === "life" ? "#meet-dialog" : "#date-dialog";
const scene = async mode => mode === "life" ? data("groupLife", "scene-group-a") : (await data("dateSessions")).find(row => row.groupId === "scene-group-a" && row.active);
async function send(mode, text) { await page.fill(`#${mode}-draft`, text); await page.click(`#${mode}-send`); await idle(); }
async function action(mode, value) { const root = parent(mode); await page.click(`${root} .scene-action-menu summary`); await page.click(`${root} [data-scene-action="${value}"]`); await idle(); }
async function floor(mode, index) { const id = (await scene(mode)).messages[index].id; const paper = page.locator(`#${mode}-messages [data-message-id="${id}"] .scene-entry-paper`); await paper.scrollIntoViewIfNeeded(); await paper.dispatchEvent("contextmenu"); await page.waitForSelector("#scene-floor-dialog[open]"); }
async function close(mode) { await page.locator(parent(mode)).evaluate(el => el.close()); }
async function modeSetting(mode, value) {
  const root = `${mode === "life" ? "#life-state-card" : "#date-state-card"} .group-scene-settings`;
  await page.locator(root).evaluate(el => { el.open = true; });
  await page.selectOption(`${root} [data-group-scene-mode]`, value);
  await page.waitForFunction(({ mode, value }) => [...document.querySelectorAll(`[data-group-scene-mode="${mode}"]`)].every(el => el.value === value), { mode, value });
  await page.waitForFunction(() => !document.querySelector("#send").disabled);
}
try {
  await page.goto(origin); await ready();
  const now = Date.now();
  const members = [{ id: "wu-xie", characterId: "wu-xie", name: "吴邪", persona: "吴邪", enabled: true, relationship: "公开朋友关系" }, { id: "wang-pangzi", characterId: "wang-pangzi", name: "王胖子", persona: "王胖子", enabled: true }, { id: "xie-yuchen", characterId: "xie-yuchen", name: "解雨臣", persona: "解雨臣", enabled: true }, { id: "hei-xiazi", characterId: "hei-xiazi", name: "黑瞎子", persona: "黑瞎子", enabled: false }];
  const group = { id: "scene-group-a", title: "雨村小剧场", members, userName: "小梨", replyMode: "all", background: "GROUP_PUBLIC_BACKGROUND_雨村", worldBook: "GROUP_PUBLIC_WORLD_BOOK", memories: [{ id: "shared-memory", content: "GROUP_PUBLIC_MEMORY", enabled: true, source: "user", createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now };
  await db("groups", group); await db("groups", { ...group, id: "scene-group-b", title: "另一个群", background: "OTHER_GROUP_SECRET" });
  await db("kv", { key: "api-profile", value: { baseUrl: "https://group-scene-test.invalid/v1", model: "synthetic", apiKey: "SYNTHETIC_SCENE_TEST_KEY", temperature: .6, protocol: "openai" } });
  await db("kv", { key: "character-settings", value: { userName: "PRIVATE_NICKNAME_SECRET", relationship: "PRIVATE_RELATION_SECRET", worldBook: "PRIVATE_WORLD_SECRET", dateSupplementPrompt: "PRIVATE_DATE_SECRET", updatedAt: now } });
  await db("messages", { id: "private-secret", role: "user", content: "PRIVATE_CHAT_SECRET", kind: "text", createdAt: now });
  await db("messages", { id: "other-group-secret", role: "user", content: "OTHER_GROUP_CHAT_SECRET", kind: "text", sessionId: "scene-group-b", createdAt: now });
  await db("messages", { id: "group-public", role: "user", content: "GROUP_ONLINE_CONTINUITY_我们在旧书店见", kind: "text", sessionId: group.id, createdAt: now });
  await db("kv", { key: "date-sessions", value: [{ id: "private-date", scene: "custom", title: "私人剧场", setting: "PRIVATE_DATE_SCENE_SECRET", atmosphere: "安静", active: true, createdAt: now, updatedAt: now, messages: [] }] });
  await switchGroup(group.id);
  await feature("#meet-open"); assert.match(await page.locator("#meet-dialog h2").textContent(), /雨村小剧场/);
  await page.fill("#life-location", "书店门廊"); await page.fill("#life-time", "晚上八点"); await page.fill("#life-environment", "雨声与旧书气味");
  await page.click("#life-begin"); await idle();
  await send("life", "大家看看窗边的纸条。GROUP_LIFE_CURRENT");
  assert.equal((await scene("life")).messages.length, 4);
  assert.deepEqual(calls.slice(-3).map(row => row.name), ["吴邪", "王胖子", "解雨臣"]);
  assert(calls.at(-1).body.messages.at(-1).content.includes("本轮同行者已经做出的回应"));
  assert(calls.at(-1).body.messages.at(-1).content.includes("王胖子"));
  const prompt = JSON.stringify(calls);
  for (const marker of ["GROUP_PUBLIC_BACKGROUND", "GROUP_PUBLIC_WORLD_BOOK", "GROUP_PUBLIC_MEMORY", "GROUP_ONLINE_CONTINUITY"]) assert(prompt.includes(marker), marker);
  for (const marker of ["PRIVATE_NICKNAME_SECRET", "PRIVATE_RELATION_SECRET", "PRIVATE_WORLD_SECRET", "PRIVATE_DATE_SECRET", "PRIVATE_CHAT_SECRET", "OTHER_GROUP_SECRET", "OTHER_GROUP_CHAT_SECRET", "PRIVATE_DATE_SCENE_SECRET"]) assert(!prompt.includes(marker), marker);
  assert.equal(await page.locator("#life-messages .scene-entry-paper header strong").allTextContents().then(names => names.join("、")), "小梨、吴邪、王胖子、解雨臣");
  pass("群聊直接进入多人线下；按群设置依次接话、接住前人回应，公开背景衔接且私聊与别群资料隔离");

  const oldLife = await scene("life"); await floor("life", 0); await page.click("#scene-floor-edit"); await page.fill("#scene-floor-text", "大家看看修正后的纸条。<script>坏字</script>"); await page.click("#scene-floor-save"); await page.waitForSelector("#scene-floor-dialog[open]", { state: "hidden" });
  assert.equal((await scene("life")).messages[0].id, oldLife.messages[0].id); assert.equal(await page.locator("#life-messages script").count(), 0);
  await floor("life", 0); await page.click("#scene-floor-rewind"); await page.click("#scene-floor-confirm-rewind"); await page.waitForSelector("#scene-floor-dialog[open]", { state: "hidden" });
  assert.equal((await scene("life")).messages.length, 1);
  const checkpoint = (await data("archives")).filter(row => row.kind === "checkpoint").at(-1), archive = await data("exportArchive", checkpoint.id);
  assert.equal(archive.rows.kv.find(row => row.key === `group-life:${group.id}`).value.messages.length, 4);
  await action("life", "regenerate"); assert.equal((await scene("life")).messages.length, 4);
  assert(calls.at(-1).body.messages.at(-1).content.includes("修正后的纸条"));
  await page.screenshot({ path: new URL("life.png", folder).pathname.replace(/^\/([A-Za-z]:)/, "$1"), fullPage: true });
  pass("群聊线下楼层可编辑、回退、保存完整节点，并从修正后的用户层重新接话");

  await modeSetting("life", "selected");
  await page.check('#life-state-card [data-group-scene-member="wang-pangzi"]');
  await page.waitForFunction(() => [...document.querySelectorAll('[data-group-scene-member="wang-pangzi"]')].every(el => el.checked));
  let before = calls.length; await send("life", "这回只请胖子接一下。"); assert.equal(calls.length, before + 1); assert.equal(calls.at(-1).name, "王胖子");
  await modeSetting("life", "all");
  failName = "王胖子"; before = calls.length; await send("life", "这一轮测试中途失败的剧情。");
  assert.equal(calls.length, before + 2); assert.match(await page.locator("#meet-dialog .scene-status").textContent(), /503/);
  const partial = (await scene("life")).messages.length; await action("life", "regenerate"); assert.equal((await scene("life")).messages.length, partial + 2);
  assert.deepEqual(calls.slice(-2).map(row => row.name), ["王胖子", "解雨臣"]);
  holdName = "王胖子"; const waiting = new Promise(resolve => { held = resolve; });
  await page.fill("#life-draft", "这回在第二个人接话时暂停。"); await page.click("#life-send"); await waiting;
  await page.click('[data-group-scene-stop="life"]'); await idle(); release();
  assert.match(await page.locator("#meet-dialog .scene-status").textContent(), /已停止/);
  const stopped = (await scene("life")).messages.length; await action("life", "regenerate"); assert.equal((await scene("life")).messages.length, stopped + 2);
  pass("指定角色、失败后补齐、停止后恢复均保留已有楼层且不重复已成功的角色");
  await page.click("#life-end"); await idle();
  assert(!await page.locator("#meet-dialog").isVisible());
  const groupMessages = await data("sessionMessages", group.id); assert(groupMessages.some(row => row.metadata?.event === "group_life_summary" && row.content.includes("书店门廊")));
  assert(!(await data("sessionMessages", "private")).some(row => row.metadata?.event === "group_life_summary"));
  pass("结束线下只向原群写入见面摘要，保持线上剧情衔接");

  await feature("#date-open"); const script = "MULTIPLAYER_SCRIPT_雨村夜宴，吴邪负责认纸条，胖子准备晚饭，解雨臣带来旧钥匙。\n" + "延续灯光、雨声和桌上的信件，不替我行动。".repeat(25);
  await page.fill("#date-custom-setting", script); before = calls.length; await page.click("#date-start"); await idle();
  let date = await scene("date"); assert.equal(date.setting, script); assert.equal(date.messages.length, 3); assert.equal(calls.length, before + 3);
  assert(calls.at(-1).body.messages[0].content.includes(script)); assert(calls.at(-1).body.messages[0].content.includes("group_life_summary") === false);
  assert(calls.at(-1).body.messages[0].content.includes("书店门廊"));
  const dateId = date.id; assert.equal((await data("dateSessions")).find(row => row.id === "private-date").active, true);
  await send("date", "我把信件放在桌上。GROUP_DATE_CURRENT"); assert.equal((await scene("date")).messages.length, 7);
  await floor("date", 3); await page.click("#scene-floor-edit"); await page.fill("#scene-floor-text", "我把修正后的信件放在桌上。"); await page.click("#scene-floor-save"); await page.waitForSelector("#scene-floor-dialog[open]", { state: "hidden" });
  await floor("date", 3); await page.click("#scene-floor-rewind"); await page.click("#scene-floor-confirm-rewind"); await page.waitForSelector("#scene-floor-dialog[open]", { state: "hidden" });
  await action("date", "regenerate"); assert.equal((await scene("date")).messages.length, 7); assert(calls.at(-1).body.messages.at(-1).content.includes("修正后的信件"));
  await page.click("#date-dialog .scene-options summary"); await page.click("#date-save-memory"); await idle();
  assert((await data("groups")).find(row => row.id === group.id).memories.some(row => row.content.includes("约会剧场回忆")));
  assert(!(await data("allMemories")).some(row => row.content.includes("约会剧场回忆")));
  await close("date"); await page.reload(); await ready(); await feature("#date-open"); assert.equal((await scene("date")).id, dateId); assert.equal(await page.locator("#date-messages .scene-message").count(), 7);
  pass("多人约会支持长自定义剧本、全员开场、多轮衔接、楼层回退、群共同回忆和刷新续演，私聊约会保持独立");

  for (const theme of ["ink", "warm", "night", "rococo", "bronze"]) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => { const dialog = document.querySelector("#date-dialog"); return dialog.scrollWidth <= dialog.clientWidth + 2; }), `${theme} ${width} overflow`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.dataset.theme = "rococo"; });
  await page.screenshot({ path: new URL("date.png", folder).pathname.replace(/^\/([A-Za-z]:)/, "$1"), fullPage: true });
  const stale = await scene("date"), changed = structuredClone(stale); changed.messages[0].content = "concurrent-new-text";
  await data("saveGroupScene", changed, stale.revision);
  const rejected = await data("saveGroupScene", stale, stale.revision).then(() => false, () => true); assert(rejected);
  assert.equal((await scene("date")).messages[0].content, "concurrent-new-text");
  pass("五主题与手机/桌面宽度无横向溢出，群剧场写入拒绝旧版本覆盖");
  const firstDraft = await page.inputValue("#date-custom-setting"); await close("date");
  async function switchInUi(id, title) { await page.click("#contacts-back"); await page.waitForSelector("#session-dialog[open]"); await page.fill("#contact-filter", title); await page.click(`[data-group-id="${id}"]`); await page.waitForSelector("#session-dialog[open]", { state: "hidden" }); }
  await switchInUi("scene-group-b", "另一个群"); await feature("#date-open"); assert.equal(await page.inputValue("#date-custom-setting"), "");
  await page.fill("#date-custom-setting", "GROUP_B_UNSENT_DRAFT"); await close("date");
  await switchInUi(group.id, group.title); await feature("#date-open"); assert.equal(await page.inputValue("#date-custom-setting"), firstDraft); await close("date");
  await switchInUi("scene-group-b", "另一个群"); await feature("#date-open"); assert.equal(await page.inputValue("#date-custom-setting"), "GROUP_B_UNSENT_DRAFT"); await close("date");
  pass("同页切换群聊时未发送的剧本草稿各自保留，不把上个群的开场带进新群");
  await switchGroup("scene-group-b"); await feature("#meet-open"); assert(await page.locator("#life-setup").isVisible()); await close("life"); await feature("#date-open"); assert(await page.locator("#date-picker").isVisible()); await close("date");
  await switchGroup("private"); await feature("#date-open"); assert.match(await page.locator("#date-state-card").textContent(), /PRIVATE_DATE_SCENE_SECRET/); assert.equal(await page.locator("#date-dialog .group-scene-settings").count(), 0); await close("date");
  await switchGroup(group.id); await feature("#settings");
  const downloadPromise = page.waitForEvent("download"); await page.click("#export-data"); const download = await downloadPromise;
  const file = new URL("backup.json", folder).pathname.replace(/^\/([A-Za-z]:)/, "$1"); await download.saveAs(file);
  const backup = JSON.parse(await readFile(file, "utf8")); assert.equal(backup.groupLifeScenes[0].groupId, group.id); assert(backup.dateSessions.some(row => row.id === dateId)); assert(!JSON.stringify(backup).includes("SYNTHETIC_SCENE_TEST_KEY"));
  pass("群与群、群与私聊剧场分开；整机备份包含群线下和群约会且不含 API 密钥");
  await close("date").catch(() => {}); await page.locator("#settings-dialog").evaluate(el => el.close());
  // Restore through the real import UI in an empty, separate browser context.
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await fresh.addInitScript(() => { for (const key of ["auto-moments", "auto-diary", "proactive-enabled"]) localStorage.setItem(`xiaozhang-${key}`, "false"); localStorage.setItem("xiaozhang-pet-position", JSON.stringify({ x: 0, y: 430 })); });
  const restored = await fresh.newPage(); await restored.goto(origin); await restored.waitForFunction(() => document.documentElement.dataset.appReady === "true");
  await restored.click("#topbar-menu-toggle"); await restored.click("#settings"); await restored.waitForSelector("#settings-dialog[open]");
  await restored.locator("#import-data").setInputFiles({ name: "group-scenes-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  let imported = [];
  for (let attempt = 0; attempt < 300; attempt++) {
    imported = await db("kv", undefined, restored);
    if (imported.some(row => row.key === `group-life:${group.id}`) && imported.find(row => row.key === "date-sessions")?.value?.some(row => row.id === dateId)) break;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  assert.deepEqual(imported.find(row => row.key === `group-life:${group.id}`).value.messages, backup.groupLifeScenes[0].messages);
  assert.deepEqual(imported.find(row => row.key === "date-sessions").value.find(row => row.id === dateId).messages, backup.dateSessions.find(row => row.id === dateId).messages);
  await restored.locator("#settings-dialog").evaluate(el => el.close());
  if (!await restored.locator("#topbar-menu").isVisible()) await restored.click("#topbar-menu-toggle");
  await restored.click("#date-open"); await restored.waitForSelector("#date-dialog[open]"); assert.equal(await restored.locator("#date-messages .scene-message").count(), 7);
  await fresh.close(); pass("完整备份通过真实导入界面恢复至空浏览器，群成员、群线下、约会楼层均可继续读取");

  // All sixteen contacts share a scene; this is independent of the normal group-chat suite.
  const cast = await page.evaluate(async () => (await import("/__group-scene-test/characters.js")).characters.map(row => ({ id: row.id, characterId: row.id, name: row.name, persona: row.persona, enabled: true })));
  await db("groups", { ...group, id: "scene-sixteen", title: "十六人小剧场", members: cast });
  await switchGroup("scene-sixteen"); await feature("#date-open"); await page.fill("#date-custom-setting", "十六人在雨村院子里准备一场晚宴。每人顺着前一位角色的动作接话。");
  before = calls.length; await page.click("#date-start"); await idle();
  const sixteen = (await data("dateSessions")).find(row => row.groupId === "scene-sixteen" && row.active);
  assert.equal(sixteen.messages.length, 16); assert.equal(calls.length, before + 16); assert.equal(new Set(sixteen.messages.map(row => row.metadata.characterId)).size, 16);
  before = calls.length; await send("date", "@吴邪 请你先看看这封信。"); assert.equal(calls.length, before + 16); // all mode deliberately still asks everyone
  assert.equal((await data("dateSessions")).find(row => row.id === sixteen.id).messages.length, 33);
  await page.click("#date-end"); await idle(); assert(await page.locator("#date-picker").isVisible());
  pass("16 位角色在同一剧场完整开场与续演，逐层保存，结束后保留全场记录");
  await close("date");
  const profile = await data("profile"); await data("saveProfile", { ...profile, apiKey: "" });
  await switchGroup(group.id); await feature("#meet-open"); await page.click("#life-begin"); await idle();
  before = calls.length; const count = (await scene("life")).messages.length;
  await send("life", "缺少 API 时请保留我打好的内容。"); assert.equal(await page.inputValue("#life-draft"), "缺少 API 时请保留我打好的内容。"); assert.equal(calls.length, before); assert.equal((await scene("life")).messages.length, count);
  assert.match(await page.locator("#meet-dialog .scene-status").textContent(), /API/);
  await data("saveProfile", profile); await modeSetting("life", "natural"); before = calls.length;
  await send("life", "@吴邪 请你来接这段剧情。"); assert.equal(calls.length, before + 1); assert.equal(calls.at(-1).name, "吴邪");
  const longScene = await scene("life");
  longScene.messages.unshift(...Array.from({ length: 40 }, (_, i) => ({ id: `long-scene-${i}`, role: i % 2 ? "assistant" : "user", kind: "text", content: `过往第${i}层：${"大家在雨村约好明天带着纸条去旧书店，这只是本群已公开的小剧场经历。".repeat(6)}`, speakerId: i % 2 ? "吴邪" : undefined, metadata: i % 2 ? { characterId: "wu-xie", groupMemberId: "wu-xie" } : undefined, createdAt: now - 100 + i })));
  await data("saveGroupScene", longScene, longScene.revision);
  await action("life", "continue"); const continued = (await scene("life")).messages.length;
  assert(calls.some(row => row.body.messages[0].content.startsWith("你是对话记录整理器")));
  assert(calls.at(-1).body.messages[0].content.includes("历史压缩笔记 · 本群连续线下见面"));
  await action("life", "regenerate"); assert.equal((await scene("life")).messages.length, continued);
  assert(calls.at(-1).body.messages.at(-1).content.includes("从上一段结尾继续当前现场"));
  await modeSetting("life", "all"); failName = "王胖子"; await action("life", "continue");
  const partialContinue = (await scene("life")).messages.length; await action("life", "regenerate"); assert.equal((await scene("life")).messages.length, partialContinue + 2);
  pass("未配置 API 时保留输入且不产生假楼层；自然接话模式的明确点名仅请求被点到的角色");
  pass("长群剧场使用独立摘要；续写后的重新生成仍接续当前现场，续写中断可补齐而不重复成功楼层");
  assert.deepEqual(errors, []);
  const all = JSON.stringify(calls);
  for (const marker of ["PRIVATE_NICKNAME_SECRET", "PRIVATE_RELATION_SECRET", "PRIVATE_WORLD_SECRET", "PRIVATE_DATE_SECRET", "PRIVATE_CHAT_SECRET", "OTHER_GROUP_CHAT_SECRET", "PRIVATE_DATE_SCENE_SECRET"]) assert(!all.includes(marker), marker);
  await writeFile(new URL("results.json", folder), JSON.stringify({ origin, checks, requests: calls.length, errors }, null, 2));
} catch (error) { await page.screenshot({ path: new URL("failure.png", folder).pathname.replace(/^\/([A-Za-z]:)/, "$1"), fullPage: true }).catch(() => {}); console.error(error); throw error; }
finally { await context.close(); await browser.close(); }
