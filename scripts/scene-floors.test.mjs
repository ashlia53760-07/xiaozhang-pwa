// Real Chrome, isolated synthetic IndexedDB, mocked model. Never reads user profiles.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";
const origin = process.env.SCENE_FLOOR_TEST_URL || "http://127.0.0.1:4177";
const folder = new URL("../.local-review/scene-floors/", import.meta.url); await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: "block", reducedMotion: "reduce" });
await context.addInitScript(() => {
  for (const key of ["auto-moments", "auto-diary", "proactive-enabled"]) localStorage.setItem(`xiaozhang-${key}`, "false");
  localStorage.setItem("xiaozhang-pet-position", JSON.stringify({ x: 4, y: 420 }));
});
await context.route("**/__floor-test/*.js", async route => {
  const name = new URL(route.request().url()).pathname.match(/\/([a-z-]+)\.js$/)?.[1];
  if (!name || name === "main") return route.abort();
  const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
  const body = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from "\.\/([^".]+)"/g, 'from "./$1.js"');
  await route.fulfill({ contentType: "text/javascript", body });
});
const calls = [], errors = [], checks = [];
let holdReply = false, releaseReply, requestHeld;
await context.route("https://floor-test.invalid/**", async route => {
  calls.push(route.request().postDataJSON());
  if (holdReply) { const pending = new Promise(resolve => { releaseReply = resolve; }); requestHeld?.(); await pending; }
  await route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ choices: [{ delta: { content: "他重新看向你。纠正后的话已听清，接下来从这里继续。" } }] })}\n\ndata: [DONE]\n\n` });
});
const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
const pass = name => { checks.push(name); console.log("PASS", name); };
const ready = () => page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
const data = (method, ...args) => page.evaluate(async ({ method, args }) => (await import("/__floor-test/storage.js")).storage[method](...args), { method, args });
async function db(store, value, target = page) {
  return target.evaluate(({ store, value }) => new Promise((resolve, reject) => {
    const open = indexedDB.open("xiaozhang-pwa"); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const database = open.result, tx = database.transaction(store, value ? "readwrite" : "readonly"), request = value ? tx.objectStore(store).put(value) : tx.objectStore(store).getAll(); tx.oncomplete = () => { database.close(); resolve(request.result); }; tx.onerror = () => reject(tx.error); };
  }), { store, value });
}
async function feature(id) { if (!await page.locator("#topbar-menu").isVisible()) await page.click("#topbar-menu-toggle"); await page.click(id); }
const floor = (mode, n) => page.locator(`#${mode === "life" ? "life" : "date"}-messages [data-message-id="${mode}-${n}"] .scene-entry-paper`);
async function openFloor(mode, n, gesture = "context") {
  const element = floor(mode, n); await element.scrollIntoViewIfNeeded();
  if (gesture === "touch") {
    const box = await element.boundingBox(), cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: box.x + 20, y: box.y + 30 }] });
    await page.waitForSelector("#scene-floor-dialog[open]");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }); await cdp.detach();
  } else if (gesture === "keyboard") { await element.focus(); await page.keyboard.press("Shift+F10"); }
  else await element.dispatchEvent("contextmenu");
  await page.waitForSelector("#scene-floor-dialog[open]");
}
async function closeFloor() { await page.click("#scene-floor-form > header [data-floor-close]"); await page.waitForSelector("#scene-floor-dialog[open]", { state: "hidden" }); }
async function edit(mode, n, text) {
  await openFloor(mode, n); await page.click("#scene-floor-edit"); await page.fill("#scene-floor-text", text); await page.click("#scene-floor-save");
  await page.waitForSelector("#scene-floor-dialog[open]", { state: "hidden" });
  await page.waitForFunction(() => !document.querySelector("#scene-floor-save").disabled);
}
try {
  await page.goto(origin); await ready();
  const now = Date.now(), originals = {};
  for (const mode of ["life", "date"]) originals[mode] = Array.from({ length: 7 }, (_, index) => ({ id: `${mode}-${index}`, role: index % 2 ? "user" : "assistant", kind: "text", content: index > 3 ? `${mode}-removed-${index} 这是将回退的后续剧情。` : `${mode} 第${index + 1}层原文，有一个错别子。`, createdAt: now + index, speakerId: index % 2 ? undefined : "张起灵", ...(mode === "life" ? { sessionId: "life" } : {}), metadata: { marker: `${mode}-metadata-${index}` } }));
  for (const row of originals.life) await db("messages", row);
  const privateRow = { id: "floor-private-control", role: "user", kind: "text", content: "ordinary-private-record", sessionId: "private", createdAt: now - 1 };
  const otherLife = { ...privateRow, id: "other-contact-life", sessionId: "life:wu-xie", content: "other-contact-scene" };
  await db("messages", privateRow); await db("messages", otherLife);
  await db("kv", { key: "continuous-life", value: { id: "continuous-life", active: true, location: "旧书店", timeLabel: "傍晚", environment: "窗外小雨", activity: "不应在回退后残留的旧活动", unfinished: "旧的未完事项", updatedAt: now } });
  const dates = [{ id: "floor-date", characterId: "zhang-qiling", scene: "custom", title: "雨夜旧街", setting: "长廊的灯还亮着", atmosphere: "安静", active: true, createdAt: now, updatedAt: now, messages: originals.date }, { id: "other-character-date", characterId: "wu-xie", scene: "custom", title: "另一位角色的约会", setting: "另一条街", atmosphere: "热闹", active: true, createdAt: now - 1, updatedAt: now - 1, messages: [{ id: "other-date-message", role: "assistant", content: "other-date-scene", kind: "text", createdAt: now }] }];
  await db("kv", { key: "date-sessions", value: dates });
  await db("kv", { key: "api-profile", value: { baseUrl: "https://floor-test.invalid/v1", model: "synthetic", apiKey: "synthetic-floor-key", temperature: .7, protocol: "openai" } });
  await page.reload(); await ready();
  for (const mode of ["life", "date"]) {
    const scope = mode === "life" ? { kind: "life", characterId: "zhang-qiling" } : { kind: "date", characterId: "zhang-qiling", id: "floor-date" };
    const parent = mode === "life" ? "#meet-dialog" : "#date-dialog";
    await feature(mode === "life" ? "#meet-open" : "#date-open"); await page.waitForSelector(`${parent}[open]`);
    if (mode === "date") { await page.click("#script-tab-runs"); await page.click('[data-run-resume="floor-date"]'); }
    const contextScope = mode === "life" ? "life" : "date:zhang-qiling:floor-date";
    await data("saveContextCache",`context-summary:${contextScope}`,{text:"已过时的场景摘要"});
    await data("saveContextCache","context-summary:private-control",{text:"不相关的摘要保留"});
    await openFloor(mode, 1, mode === "life" ? "touch" : "keyboard");
    await page.click("#scene-floor-edit"); assert.equal(await page.inputValue("#scene-floor-text"), originals[mode][1].content);
    await page.fill("#scene-floor-text", "取消的修改"); await closeFloor();
    assert.equal((await data("sceneFloors", scope))[1].content, originals[mode][1].content);
    await edit(mode, 1, "纠正错别字 🥰\n保留换行和标点。<img src=x onerror=alert(1)>");
    assert.equal(await data("contextCache",`context-summary:${contextScope}`),undefined);
    assert.deepEqual(await data("contextCache","context-summary:private-control"),{text:"不相关的摘要保留"});
    let rows = await data("sceneFloors", scope);
    assert.equal(rows.length, 7); assert.equal(rows[1].id, originals[mode][1].id); assert.equal(rows[1].createdAt, originals[mode][1].createdAt);
    assert.equal(rows[1].metadata.marker, `${mode}-metadata-1`); assert(rows[1].metadata.editedAt > 0);
    assert.equal(await floor(mode, 1).locator("p img").count(), 0);
    await edit(mode, 2, "角色回复也能改，仍保留原来的说话人。");
    rows = await data("sceneFloors", scope); assert.equal(rows[2].speakerId, "张起灵");
    await openFloor(mode, 1); await page.click("#scene-floor-edit"); await page.fill("#scene-floor-text", "   \n  "); await page.click("#scene-floor-save");
    await page.waitForFunction(() => document.querySelector("#scene-floor-error").textContent.includes("不能为空")); assert.equal((await data("sceneFloors", scope))[1].content, rows[1].content); await closeFloor();
    pass(`${mode}: touch/keyboard/right-click editing, cancel, empty-input rejection, escaped text, IDs/times/metadata and following floors preserved`);

    // A second page changes the same source while the editor is open.
    await openFloor(mode, 1); await page.click("#scene-floor-edit"); await page.fill("#scene-floor-text", "尚未保存的编辑不能丢");
    const other = await context.newPage(); await other.goto(origin); await other.waitForFunction(() => document.documentElement.dataset.appReady === "true");
    if (mode === "life") { const current = (await db("messages", undefined, other)).find(row => row.id === "life-1"); await db("messages", { ...current, content: "另一页已保存的内容" }, other); }
    else { const all = (await db("kv", undefined, other)).find(row => row.key === "date-sessions"); all.value.find(row => row.id === "floor-date").messages[1].content = "另一页已保存的内容"; await db("kv", all, other); }
    await page.click("#scene-floor-save"); await page.waitForFunction(() => document.querySelector("#scene-floor-error").textContent.includes("其他页面"));
    assert.equal(await page.inputValue("#scene-floor-text"), "尚未保存的编辑不能丢"); assert.equal((await data("sceneFloors", scope))[1].content, "另一页已保存的内容"); await other.close(); await closeFloor();
    await edit(mode, 1, "编辑冲突后重新打开，正确保存。");

    // Simulated quota failure must abort the write and keep the typed draft.
    await openFloor(mode, 2); await page.click("#scene-floor-edit"); await page.fill("#scene-floor-text", "配额不足时保留的输入");
    await page.evaluate(mode => {
      window.__floorOriginalPut = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value, ...args) { if ((mode === "life" && value.id === "life-2") || (mode === "date" && value.key === "date-sessions")) throw new DOMException("模拟配额不足", "QuotaExceededError"); return window.__floorOriginalPut.call(this, value, ...args); };
    }, mode);
    await page.click("#scene-floor-save"); await page.waitForFunction(() => document.querySelector("#scene-floor-error").textContent.includes("配额"));
    await page.evaluate(() => { IDBObjectStore.prototype.put = window.__floorOriginalPut; delete window.__floorOriginalPut; });
    assert.equal(await page.inputValue("#scene-floor-text"), "配额不足时保留的输入"); assert.equal((await data("sceneFloors", scope))[2].content, "角色回复也能改，仍保留原来的说话人。"); await closeFloor();
    pass(`${mode}: stale concurrent edits cannot overwrite another page; failed writes retain editor input and original record`);

    await openFloor(mode, 3); await page.click("#scene-floor-rewind"); assert.match(await page.locator("#scene-floor-explain").textContent(), /后续 3 层/); await closeFloor();
    assert.equal((await data("sceneFloors", scope)).length, 7);
    const beforeBranch = await data("sceneFloors", scope), callCount = calls.length;
    await openFloor(mode, 3); await page.click("#scene-floor-rewind"); await page.click("#scene-floor-confirm-rewind"); await page.waitForSelector("#scene-floor-dialog[open]", { state: "hidden" });
    await page.waitForFunction(() => !document.querySelector("#scene-floor-save").disabled);
    rows = await data("sceneFloors", scope); assert.deepEqual(rows, beforeBranch.slice(0, 4)); assert.equal(calls.length, callCount);
    const checkpoints = (await data("archives")).filter(row => row.kind === "checkpoint");
    const checkpoint = checkpoints.find(row => row.name.startsWith(mode === "life" ? "线下回退前" : "约会回退前")); assert(checkpoint);
    const backup = await data("exportArchive", checkpoint.id);
    const backed = mode === "life" ? backup.rows.messages.filter(row => row.sessionId === "life" && !row.metadata?.hiddenAt && !row.metadata?.retractedAt).sort((a,b) => a.createdAt - b.createdAt) : backup.rows.kv.find(row => row.key === "date-sessions").value.find(row => row.id === "floor-date").messages;
    assert.deepEqual(backed, beforeBranch); assert(!JSON.stringify(backup).includes("synthetic-floor-key"));
    const restored = await data("makeArchive",`${mode} 测试恢复分支`,"fork",checkpoint.id);
    const restoredFile = await data("exportArchive",restored.id);
    const restoredRows = mode === "life" ? restoredFile.rows.messages.filter(row => row.sessionId === "life" && !row.metadata?.hiddenAt && !row.metadata?.retractedAt).sort((a,b) => a.createdAt-b.createdAt) : restoredFile.rows.kv.find(row=>row.key==="date-sessions").value.find(row=>row.id==="floor-date").messages;
    assert.deepEqual(restoredRows,beforeBranch);
    await openFloor(mode, 3); assert(await page.locator("#scene-floor-rewind").isDisabled()); await closeFloor();
    await edit(mode, 3, `${mode} 纠正后的关键句，从这里继续。`);
    if (mode === "life") { const state = await data("continuousLife"); assert.equal(state.activity, "life 纠正后的关键句，从这里继续。"); assert.equal(state.unfinished, ""); }
    await page.click(`${parent} .scene-action-menu summary`);
    const nextRequest = page.waitForRequest(request => request.url().startsWith("https://floor-test.invalid/"));
    await page.click(`${parent} [data-scene-action="regenerate"]`); await nextRequest;
    await page.waitForFunction(() => !document.querySelector("#date-send").disabled);
    assert.equal(calls.length, callCount + 1);
    const sent = JSON.stringify(calls.at(-1)); assert(sent.includes(`${mode} 纠正后的关键句`)); assert(!sent.includes(`${mode}-removed-`)); assert(sent.includes("角色回复也能改"));
    if (mode === "date") assert(!sent.includes("ordinary-private-record") && !sent.includes("other-contact-scene"));
    assert.equal((await data("sceneFloors", scope)).length, 5);
    pass(`${mode}: rewind keeps selected floor and earlier rows, checkpoints full old branch, no automatic API call, corrected text reaches next real request without removed future`);

    holdReply=true; const waiting=new Promise(resolve=>{requestHeld=resolve;});
    await page.click(`${parent} .scene-action-menu summary`); await page.click(`${parent} [data-scene-action="regenerate"]`); await waiting;
    await floor(mode,1).dispatchEvent("contextmenu"); assert.equal(await page.locator("#scene-floor-dialog[open]").count(),0);
    holdReply=false; requestHeld=undefined; releaseReply(); await page.waitForFunction(()=>!document.querySelector("#date-send").disabled);
    pass(`${mode}: editing is blocked during an in-flight model response; checkpoint can be restored as a separate complete branch`);

    await page.click(`${parent} .scene-action-menu summary`); await page.click(`${parent} [data-scene-action="select"]`);
    await floor(mode, 1).dispatchEvent("contextmenu"); assert.equal(await page.locator("#scene-floor-dialog[open]").count(), 0); await page.click(`${parent} [data-scene-select-cancel]`);
    await floor(mode, 1).scrollIntoViewIfNeeded();
    await floor(mode, 1).dispatchEvent("pointerdown", { isPrimary:true, pointerType:"touch", button:0, clientX:50, clientY:100 });
    await floor(mode, 1).dispatchEvent("pointermove", { isPrimary:true, pointerType:"touch", clientX:50, clientY:150 });
    await page.waitForTimeout(580); await floor(mode, 1).dispatchEvent("pointerup"); assert.equal(await page.locator("#scene-floor-dialog[open]").count(), 0);
    await openFloor(mode, 1); await page.click("#scene-floor-edit");
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      for (const theme of ["warm", "ink", "night", "rococo", "bronze"]) {
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        const size = await page.locator("#scene-floor-dialog").evaluate(el => ({ sw:el.scrollWidth,w:el.clientWidth,rect:el.getBoundingClientRect().toJSON(),vh:innerHeight,vw:innerWidth }));
        assert(size.sw <= size.w + 1 && size.rect.left >= 0 && size.rect.right <= size.vw && size.rect.bottom <= size.vh);
      }
    }
    await page.setViewportSize({ width:390,height:844 }); await page.screenshot({ path:fileURLToPath(new URL(`${mode}-editor.png`,folder)) }); await closeFloor();
    await page.locator(parent).evaluate(el => el.close()); await page.reload(); await ready(); await feature(mode === "life" ? "#meet-open" : "#date-open");
    if (mode === "date") { await page.click("#script-tab-runs"); await page.click('[data-run-resume="floor-date"]'); }
    await page.waitForSelector(`${parent} .scene-message`); assert.match(await floor(mode,3).textContent(), /纠正后的关键句/); assert.equal((await data("sceneFloors",scope)).length,5);
    await page.locator(parent).evaluate(el => el.close());
    pass(`${mode}: scroll gestures and multiselect do not open menu; editor fits five themes at 320/390/1280; edits and branch persist after reload`);
  }
  const rows = await db("messages"); assert.deepEqual(rows.find(row => row.id === privateRow.id),privateRow); assert.deepEqual(rows.find(row => row.id === otherLife.id),otherLife);
  assert.deepEqual((await data("dateSessions")).find(row => row.id === dates[1].id),dates[1]);
  // Same implementation supports the investigation-owned offline reader and preserves its sibling data in checkpoints.
  const fieldwork = await page.evaluate(async () => (await import("/__floor-test/fieldwork.js")).emptyFieldwork());
  fieldwork.adventures = [{ id:"floor-adventure",investigationId:"floor-investigation",groupId:"floor-group",title:"测试冒险",location:"旧村",briefing:"合成线索",memberIds:[],active:true,createdAt:now,updatedAt:now,messages:[{id:"adv-1",role:"user",content:"看错的路牌",createdAt:now},{id:"adv-2",role:"assistant",speakerId:"吴邪",content:"后续路线",createdAt:now+1}] }];
  fieldwork.investigations = [{id:"floor-investigation",title:"测试",universe:"原创线索",status:"adventure",evidenceIds:[],notes:"原笔记保留",createdAt:now,updatedAt:now}];
  await data("saveFieldwork",fieldwork); const scope={kind:"adventure",id:"floor-adventure"}; let adventureRows=await data("sceneFloors",scope);
  await data("changeSceneFloor",scope,adventureRows,"adv-1",{type:"edit",content:"纠正后的路牌"}); adventureRows=await data("sceneFloors",scope);
  const result=await data("changeSceneFloor",scope,adventureRows,"adv-1",{type:"rewind"});
  assert.equal((await data("sceneFloors",scope)).length,1); const checkpoint=await data("exportArchive",result.checkpoint);
  assert.equal(checkpoint.rows.kv.find(row=>row.key==="fieldwork-data").value.adventures[0].messages.length,2);
  assert.equal((await data("fieldwork")).investigations[0].notes,"原笔记保留");
  pass("unrelated private chats/contact scenes/dates preserved; adventure floor mutations and recovery checkpoint retain investigation data");
  assert.deepEqual(errors,[]);
  await writeFile(new URL("results.json",folder),JSON.stringify({passed:true,origin,checks,calls:calls.length,errors},null,2));
} finally { await browser.close(); }
