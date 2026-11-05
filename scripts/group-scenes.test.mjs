// Real Chrome, synthetic IndexedDB, mocked APIs. No user browser profile or paid calls.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import ts from "typescript";
const origin = process.env.GROUP_SCENE_TEST_URL || "http://127.0.0.1:4184";
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
let failNext = false, holdNext = false, release;
const story = `吴邪把纸条向灯下挪了挪，指尖停在折痕旁：“先别急，这里还有一行。”

王胖子刚要接话，窗缝里的一阵风先卷起了纸角。他伸手按住，顺势把旁边的椅子往里让了让，笑意收了半分。

解雨臣没有催促，只将茶杯放到不碍手的地方。雨声落在门廊上，片刻的安静里，吴邪抬眼望向你，等你决定要不要把纸条翻过来。`;
await context.route("https://group-scene-test.invalid/**", async route => {
  const body = route.request().postDataJSON(), prompt = body.messages[0].content;
  const summary = prompt.startsWith("你是对话记录整理器");
  calls.push({ body, summary });
  if (holdNext && !summary) { holdNext = false; await new Promise(resolve => { release = resolve; }); }
  if (failNext && !summary) { failNext = false; return route.fulfill({ status: 503, body: "synthetic unavailable" }); }
  await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ choices: [{ delta: { content: summary ? "本群同行者在雨村旧书店看纸条；用户的行动仍待确认。" : story + `\n\n（模拟场景 ${calls.length}）` } }] })}\n\ndata: [DONE]\n\n` }).catch(() => {});
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
const scene = async mode => mode === "life" ? data("groupLife", "scene-group-a") : (await data("dateSessions")).find(row => row.scriptSnapshot?.mode === "multi" && row.active);
async function send(mode, text) { await page.fill(`#${mode}-draft`, text); await page.click(`#${mode}-send`); await idle(); }
async function action(mode, value) { const root = parent(mode); await page.click(`${root} .scene-action-menu summary`); await page.click(`${root} [data-scene-action="${value}"]`); await idle(); }
async function floor(mode, index) { const id = (await scene(mode)).messages[index].id; const paper = page.locator(`#${mode}-messages [data-message-id="${id}"] .scene-entry-paper`); await paper.scrollIntoViewIfNeeded(); await paper.dispatchEvent("contextmenu"); await page.waitForSelector("#scene-floor-dialog[open]"); }
async function close(mode) { await page.locator(parent(mode)).evaluate(el => el.close()); }
function narrativeCall(call, names) {
  const prompt = call.body.messages[0].content;
  assert.match(prompt, /统一叙事/); assert.match(prompt, /张弛有度/); assert.match(prompt, /不替用户决定行动/);
  assert.match(prompt, /不强迫每个人说话/); assert.doesNotMatch(prompt, /你只扮演/);
  for (const name of names) assert(prompt.includes(`【${name}】`), name);
}
async function scrolling(mode, width, height, theme) {
  await page.setViewportSize({ width, height });
  await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
  const metrics = await page.locator(`#${mode}-messages`).evaluate((el, mode) => {
    const card = document.querySelector(`#${mode}-state-card`), bounds = el.getBoundingClientRect();
    el.scrollTop = 0; const top = card.getBoundingClientRect().top;
    el.scrollTop = el.scrollHeight; const end = card.getBoundingClientRect();
    const result = { first: el.firstElementChild === card, count: el.querySelectorAll(`#${mode}-state-card`).length, height: el.clientHeight, travel: top - end.top, scrolled: el.scrollTop, bottom: end.bottom, viewportTop: bounds.top, overflow: el.scrollWidth > el.clientWidth + 1 };
    return result;
  }, mode);
  assert(metrics.first && metrics.count === 1, JSON.stringify(metrics));
  assert(metrics.height > height * .4, `${mode} ${theme} ${width}x${height}: ${JSON.stringify(metrics)}`);
  assert(metrics.bottom < metrics.viewportTop && metrics.travel > 200, JSON.stringify(metrics));
  assert(Math.abs(metrics.travel - metrics.scrolled) < 2 && !metrics.overflow, JSON.stringify(metrics));
  assert(await page.locator(`#${mode}-draft`).isVisible());
  assert(await page.locator(`#${mode}-send`).isVisible());
}
try {
  await page.goto(origin); await ready();
  const now = Date.now();
  const members = [{ id: "wu-xie", characterId: "wu-xie", name: "吴邪", persona: "吴邪", enabled: true, relationship: "公开朋友关系" }, { id: "wang-pangzi", characterId: "wang-pangzi", name: "王胖子", persona: "王胖子", enabled: true }, { id: "xie-yuchen", characterId: "xie-yuchen", name: "解雨臣", persona: "解雨臣", enabled: true }, { id: "hei-xiazi", characterId: "hei-xiazi", name: "黑瞎子", persona: "黑瞎子", enabled: false }];
  // Online selected-speaker settings must have no effect on the scene cast.
  const group = { id: "scene-group-a", title: "雨村小剧场", members, userName: "小梨", replyMode: "selected", selectedMemberIds: [], background: "GROUP_PUBLIC_BACKGROUND_雨村", worldBook: "GROUP_PUBLIC_WORLD_BOOK", memories: [{ id: "shared-memory", content: "GROUP_PUBLIC_MEMORY", enabled: true, source: "user", createdAt: now, updatedAt: now }], createdAt: now, updatedAt: now };
  await db("groups", group); await db("groups", { ...group, id: "scene-group-b", title: "另一个群", background: "OTHER_GROUP_SECRET" });
  await db("kv", { key: "api-profile", value: { baseUrl: "https://group-scene-test.invalid/v1", model: "synthetic", apiKey: "SYNTHETIC_SCENE_TEST_KEY", temperature: .6, protocol: "openai" } });
  await db("kv", { key: "character-settings", value: { userName: "PRIVATE_NICKNAME_SECRET", relationship: "PRIVATE_RELATION_SECRET", worldBook: "PRIVATE_WORLD_SECRET", dateSupplementPrompt: "PRIVATE_DATE_SECRET", updatedAt: now } });
  await db("messages", { id: "private-secret", role: "user", content: "PRIVATE_CHAT_SECRET", kind: "text", createdAt: now });
  await db("messages", { id: "other-group-secret", role: "user", content: "OTHER_GROUP_CHAT_SECRET", kind: "text", sessionId: "scene-group-b", createdAt: now });
  await db("messages", { id: "group-public", role: "user", content: "GROUP_ONLINE_CONTINUITY_我们在旧书店见", kind: "text", sessionId: group.id, createdAt: now });
  await db("kv", { key: "date-sessions", value: [{ id: "private-date", scene: "custom", title: "私人剧场", setting: "PRIVATE_DATE_SCENE_SECRET", atmosphere: "安静", active: true, createdAt: now, updatedAt: now, messages: [] }] });
  await switchGroup(group.id); await feature("#meet-open");
  assert.match(await page.locator("#meet-dialog h2").textContent(), /雨村小剧场/);
  assert.equal(await page.locator("[data-group-scene-mode]").count(), 0);
  await page.fill("#life-location", "书店门廊"); await page.fill("#life-time", "晚上八点"); await page.fill("#life-environment", "雨声与旧书气味");
  await page.click("#life-begin"); await idle();
  let before = calls.length;
  await send("life", "@吴邪 大家看看窗边的纸条。GROUP_LIFE_CURRENT");
  let current = await scene("life"); assert.equal(current.messages.length, 2); assert.equal(calls.length, before + 1);
  narrativeCall(calls.at(-1), ["吴邪", "王胖子", "解雨臣"]);
  assert.equal(current.messages[1].metadata.sceneNarrative, true);
  assert.deepEqual(current.messages[1].metadata.sceneMemberIds, members.slice(0, 3).map(row => row.id));
  assert.equal(await page.locator("#life-messages .scene-narrative").count(), 1);
  assert.equal(await page.locator("#life-messages .scene-narrative .scene-entry-portrait").count(), 0);
  assert.deepEqual(await page.locator("#life-messages .scene-entry-paper header strong").allTextContents(), ["小梨", "场景叙事"]);
  for (const marker of ["GROUP_PUBLIC_BACKGROUND", "GROUP_PUBLIC_WORLD_BOOK", "GROUP_PUBLIC_MEMORY", "GROUP_ONLINE_CONTINUITY"]) assert(JSON.stringify(calls).includes(marker), marker);
  pass("线下每轮一次请求、一则多人叙事；点名和线上指定接话规则不拆分同行者，原著资料和本群背景完整传入");

  const oldLife = current;
  await floor("life", 0); await page.click("#scene-floor-edit"); await page.fill("#scene-floor-text", "大家看看修正后的纸条。<script>坏字</script>"); await page.click("#scene-floor-save"); await page.waitForSelector("#scene-floor-dialog[open]", { state: "hidden" });
  assert.equal((await scene("life")).messages[0].id, oldLife.messages[0].id); assert.equal(await page.locator("#life-messages script").count(), 0);
  await floor("life", 0); await page.click("#scene-floor-rewind"); await page.click("#scene-floor-confirm-rewind"); await page.waitForSelector("#scene-floor-dialog[open]", { state: "hidden" });
  assert.equal((await scene("life")).messages.length, 1);
  const checkpoint = (await data("archives")).filter(row => row.kind === "checkpoint").at(-1), archive = await data("exportArchive", checkpoint.id);
  assert.equal(archive.rows.kv.find(row => row.key === `group-life:${group.id}`).value.messages.length, 2);
  await action("life", "regenerate"); assert.equal((await scene("life")).messages.length, 2); assert.match(calls.at(-1).body.messages.at(-1).content, /修正后的纸条/);
  await floor("life", 1); await page.click("#scene-floor-edit"); await page.fill("#scene-floor-text", "吴邪收好纸条，王胖子让开门边，解雨臣看向屋外。EDITED_NARRATIVE"); await page.click("#scene-floor-save"); await page.waitForSelector("#scene-floor-dialog[open]", { state: "hidden" });
  await send("life", "先把灯打开。"); assert(JSON.stringify(calls.at(-1).body.messages).includes("EDITED_NARRATIVE"));
  pass("整则叙事可长按编辑；回退保留保存节点，重新生成使用更正后的用户层与叙事层");

  failNext = true; before = calls.length; const length = (await scene("life")).messages.length;
  await send("life", "失败也要保留这一句。"); assert.equal((await scene("life")).messages.length, length + 1); assert.equal(calls.length, before + 1);
  assert.match(await page.locator("#meet-dialog .scene-status").textContent(), /503/);
  await action("life", "regenerate"); assert.equal((await scene("life")).messages.length, length + 2);
  const preserved = structuredClone((await scene("life")).messages);
  failNext = true; await action("life", "regenerate"); assert.deepEqual((await scene("life")).messages, preserved);
  failNext = true; await action("life", "continue"); assert.deepEqual((await scene("life")).messages, preserved);
  await action("life", "regenerate"); current = await scene("life"); assert.equal(current.messages.length, preserved.length + 1); assert.deepEqual(current.messages.slice(0, -1), preserved);
  assert.match(calls.at(-1).body.messages.at(-1).content, /从上一段结尾继续当前现场/);
  const completed = current.messages.length, latestId = current.messages.at(-1).id;
  await action("life", "regenerate"); assert.equal((await scene("life")).messages.length, completed); assert.equal((await scene("life")).messages.at(-1).id, latestId);
  holdNext = true; release = undefined;
  await page.fill("#life-draft", "停止时保留我的落笔。"); await page.click("#life-send");
  for (let i = 0; i < 200 && !release; i++) await new Promise(resolve => setTimeout(resolve, 25));
  assert(release, "mock generation reached"); await page.click('[data-group-scene-stop="life"]'); release(); await idle();
  assert.equal((await scene("life")).messages.at(-1).role, "user");
  await action("life", "regenerate"); assert.equal((await scene("life")).messages.at(-1).metadata.sceneNarrative, true);
  pass("失败和停止保留输入楼层；重写失败保留原文；续写失败重试追加新场景，不覆盖上一则成功叙事");

  const longScene = await scene("life");
  longScene.messages.unshift(...Array.from({ length: 40 }, (_, i) => ({ id: `legacy-${i}`, role: i % 2 ? "assistant" : "user", kind: "text", content: `旧版第${i}层：${"大家在雨村约好明天带着纸条去旧书店，这只是本群已公开的小剧场经历。".repeat(6)}`, speakerId: i % 2 ? "吴邪" : undefined, metadata: i % 2 ? { characterId: "wu-xie", groupMemberId: "wu-xie" } : undefined, createdAt: now - 100 + i })));
  longScene.replyMode = "selected"; longScene.selectedMemberIds = [];
  await data("saveGroupScene", longScene, longScene.revision);
  await action("life", "continue"); current = await scene("life");
  assert.equal(current.messages.length, longScene.messages.length + 1); assert.deepEqual(current.messages.slice(0, 40), longScene.messages.slice(0, 40));
  assert(calls.some(row => row.summary)); assert(calls.at(-1).body.messages[0].content.includes("历史压缩笔记 · 本群连续线下见面"));
  for (const theme of ["ink", "warm", "night", "rococo", "bronze"]) for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) await scrolling("life", viewport.width, viewport.height, theme);
  // Expanding cast details must still scroll away, including after a rerender.
  await page.locator("#life-state-card .group-scene-settings").evaluate(el => { el.open = true; });
  await scrolling("life", 390, 844, "bronze");
  await page.screenshot({ path: new URL("life-latest.png", folder).pathname.replace(/^\/([A-Za-z]:)/, "$1") });
  await page.locator("#life-messages").evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: new URL("life-top.png", folder).pathname.replace(/^\/([A-Za-z]:)/, "$1") });
  await page.click("#life-end"); await idle();
  assert((await data("sessionMessages", group.id)).some(row => row.metadata?.event === "group_life_summary"));
  pass("旧版逐人楼层原样保留并接入统一叙事和独立摘要；线下卡片在五主题、320/390/1280屏宽下随记录完全滚走");

  await feature("#date-open");
  const script = "雨村旧书店夜谈。吴邪辨认来信，胖子守着门，解雨臣坐在灯下。按情节分配笔墨，别轮流报幕。".repeat(60);
  await page.fill("#date-custom-setting", script); before = calls.length; await page.click("#date-start"); await idle();
  let date = await scene("date"); assert.equal(date.setting, script); assert.equal(date.messages.length, 1); assert.equal(calls.length, before + 1);
  narrativeCall(calls.at(-1), ["吴邪", "王胖子", "解雨臣"]); assert(calls.at(-1).body.messages[0].content.includes(script));
  assert.equal((await data("dateSessions")).find(row => row.id === "private-date").active, true);
  await send("date", "我把信件放在桌上。GROUP_DATE_CURRENT"); assert.equal((await scene("date")).messages.length, 3);
  await floor("date", 1); await page.click("#scene-floor-edit"); await page.fill("#scene-floor-text", "我把修正后的信件放在桌上。"); await page.click("#scene-floor-save"); await page.waitForSelector("#scene-floor-dialog[open]", { state: "hidden" });
  await floor("date", 1); await page.click("#scene-floor-rewind"); await page.click("#scene-floor-confirm-rewind"); await page.waitForSelector("#scene-floor-dialog[open]", { state: "hidden" });
  await action("date", "regenerate"); date = await scene("date"); assert.equal(date.messages.length, 3); assert(calls.at(-1).body.messages.at(-1).content.includes("修正后的信件"));
  await page.click("#date-dialog .scene-options summary"); await page.click("#date-save-memory"); await idle();
  assert.deepEqual((await data("groups")).find(row => row.id === group.id).memories, group.memories);
  assert((await scene("date")).localMemories.some(row => row.content.includes("修正后的信件")));
  for (const marker of ["GROUP_PUBLIC_MEMORY", "GROUP_ONLINE_CONTINUITY", "GROUP_LIFE_CURRENT", "EDITED_NARRATIVE"]) assert(!JSON.stringify(calls.at(-1).body).includes(marker), marker);
  assert(!(await data("allMemories")).some(row => row.content.includes("约会剧场回忆")));
  const dateId = date.id; await close("date"); await page.reload(); await ready(); await feature("#date-open"); await page.click("#script-tab-runs"); await page.click(`[data-run-resume="${dateId}"]`); assert.equal((await scene("date")).id, dateId);
  for (const theme of ["ink", "warm", "night", "rococo", "bronze"]) for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) await scrolling("date", viewport.width, viewport.height, theme);
  await scrolling("date", 390, 844, "rococo");
  await page.screenshot({ path: new URL("date-latest.png", folder).pathname.replace(/^\/([A-Za-z]:)/, "$1") });
  const stale = await scene("date"), changed = structuredClone(stale); changed.messages[0].content += " CONCURRENT_EDIT";
  await data("saveGroupScene", changed, stale.revision);
  assert(await data("saveGroupScene", stale, stale.revision).then(() => false, () => true));
  pass("多人约会单次合写、长剧本、长按回退、本场独立回忆、刷新续演和并发保护正常；不读取群记忆或线上线下经历");

  await close("date");
  const cast = await page.evaluate(async () => (await import("/__group-scene-test/characters.js")).characters.slice(0, 16).map(row => ({ id: row.id, characterId: row.id, name: row.name, persona: row.persona, enabled: true })));
  await db("groups", { ...group, id: "scene-sixteen", title: "十六人小剧场", replyMode: "all", members: cast });
  await switchGroup("scene-sixteen"); await feature("#date-open"); await page.fill("#date-custom-setting", "十六人在雨村准备晚宴，叙事中有主有次，所有人都可以自然互动。");
  before = calls.length; await page.click("#date-start"); await idle();
  const sixteen = (await data("dateSessions")).find(row => row.scriptSnapshot?.characterIds.length === 16 && row.active);
  assert.equal(sixteen.messages.length, 1); assert.equal(calls.length, before + 1); assert.equal(sixteen.messages[0].metadata.sceneMemberIds.length, 16); narrativeCall(calls.at(-1), cast.map(row => row.name));
  before = calls.length; await send("date", "@吴邪 先看看这封信。"); assert.equal(calls.length, before + 1);
  assert.equal((await data("dateSessions")).find(row => row.id === sixteen.id).messages.length, 3);
  pass("16 人同场也只生成一则叙事，不按人数请求模型或要求人人发言");

  await close("date"); await switchGroup(group.id); await feature("#meet-open"); await page.click("#life-begin"); await idle();
  const profile = await data("profile"); await data("saveProfile", { ...profile, apiKey: "" });
  before = calls.length; const count = (await scene("life")).messages.length;
  await send("life", "缺少 API 时保留我打好的内容。"); assert.equal(await page.inputValue("#life-draft"), "缺少 API 时保留我打好的内容。"); assert.equal(calls.length, before); assert.equal((await scene("life")).messages.length, count);
  assert.match(await page.locator("#meet-dialog .scene-status").textContent(), /API/); await data("saveProfile", profile);
  pass("未配置 API 时保留草稿，不产生模拟角色楼层");

  // Backups retain scene attachments and legacy floors without credentials.
  await close("life"); await feature("#settings");
  const download = page.waitForEvent("download"); await page.click("#export-data"); const exported = await download; const path = await exported.path();
  const backup = JSON.parse(await readFile(path, "utf8"));
  assert(backup.groupLifeScenes.some(row => row.groupId === group.id)); assert(backup.dateSessions.some(row => row.id === dateId));
  assert(!JSON.stringify(backup).includes("SYNTHETIC_SCENE_TEST_KEY"));
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  try {
    await fresh.addInitScript(() => {
      for (const key of ["auto-moments", "auto-diary", "proactive-enabled"]) localStorage.setItem(`xiaozhang-${key}`, "false");
      localStorage.setItem("xiaozhang-pet-position", JSON.stringify({ x: 0, y: 430 }));
    });
    const restored = await fresh.newPage(); await restored.goto(origin); await restored.waitForFunction(() => document.documentElement.dataset.appReady === "true");
    await restored.click("#topbar-menu-toggle"); await restored.click("#settings");
    await restored.locator("#import-data").setInputFiles({ name: "group-scenes-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
    let imported = [];
    for (let attempt = 0; attempt < 300; attempt++) {
      imported = await db("kv", undefined, restored);
      if (imported.some(row => row.key === `group-life:${group.id}`) && imported.find(row => row.key === "date-sessions")?.value?.some(row => row.id === dateId)) break;
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    assert.deepEqual(imported.find(row => row.key === `group-life:${group.id}`).value.messages, backup.groupLifeScenes.find(row => row.groupId === group.id).messages);
    assert.deepEqual(imported.find(row => row.key === "date-sessions").value.find(row => row.id === dateId).messages, backup.dateSessions.find(row => row.id === dateId).messages);
    assert.deepEqual(imported.find(row => row.key === "date-sessions").value.find(row => row.id === dateId).localMemories, backup.dateSessions.find(row => row.id === dateId).localMemories);
    await restored.locator("#settings-dialog").evaluate(el => el.close());
    if (!await restored.locator("#topbar-menu").isVisible()) await restored.click("#topbar-menu-toggle");
    await restored.click("#date-open"); await restored.waitForSelector("#date-dialog[open]");
    await restored.click("#script-tab-runs"); await restored.click(`[data-run-resume="${dateId}"]`);
    await restored.waitForSelector("#date-stage:not([hidden])");
    assert.equal(await restored.locator("#date-messages .scene-narrative").count(), 2);
    assert(await restored.locator("#date-messages > #date-state-card").count() === 1);
  } finally { await fresh.close(); }
  pass("真实备份导出及空浏览器导入恢复叙事、旧楼层与滚动卡片，不包含 API 密钥");
  const all = JSON.stringify(calls);
  for (const marker of ["PRIVATE_NICKNAME_SECRET", "PRIVATE_RELATION_SECRET", "PRIVATE_WORLD_SECRET", "PRIVATE_DATE_SECRET", "PRIVATE_CHAT_SECRET", "OTHER_GROUP_CHAT_SECRET", "PRIVATE_DATE_SCENE_SECRET"]) assert(!all.includes(marker), marker);
  assert.deepEqual(errors, []);
  await writeFile(new URL("results.json", folder), JSON.stringify({ passed: true, origin, checks, requests: calls.length, errors, data: "synthetic only; no paid model or user profile" }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, requests: calls.length }, null, 2));
} catch (error) { await page.screenshot({ path: new URL("failure.png", folder).pathname.replace(/^\/([A-Za-z]:)/, "$1"), fullPage: true }).catch(() => {}); throw error; }
finally { release?.(); await context.close(); await browser.close(); }
