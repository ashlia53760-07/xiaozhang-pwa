// Negative regression: temporary Chrome, synthetic IndexedDB/model only; no user profile or paid calls.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import ts from "typescript";
const origin = process.env.FEATURE_REMOVAL_TEST_URL || "http://127.0.0.1:4184";
const folder = new URL("../.local-review/feature-removal/", import.meta.url); await mkdir(folder, { recursive: true });
const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
assert(!/shopping-open|ShoppingModule|productEvidence|pruneShoppingPrices/.test(source));
assert(source.includes('id: "shopping", title: "一起逛街"'));
for (const path of ["src/shopping-module.ts", "src/shopping.ts", "functions/api/products.ts", "worker/products/service.ts", "public/_routes.json"]) assert(await access(new URL(`../${path}`, import.meta.url)).then(() => false, () => true), path);
assert(!(await readFile(new URL("../src/api.ts", import.meta.url), "utf8")).includes("read_shared_products"));
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu"], ...(process.env.TEST_PROXY ? { proxy: { server: process.env.TEST_PROXY } } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", reducedMotion: "reduce" });
await context.addInitScript(() => { for (const key of ["auto-moments", "auto-diary", "proactive-enabled"]) localStorage.setItem(`xiaozhang-${key}`, "false"); localStorage.setItem("xiaozhang-pet-position", JSON.stringify({ x: 0, y: 430 })); });
await context.route("**/__removal-test/*.js", async route => {
  const name = new URL(route.request().url()).pathname.match(/\/([a-z-]+)\.js$/)?.[1]; if (!name || name === "main") return route.abort();
  const text = await readFile(new URL(`../src/${name}.ts`, import.meta.url), "utf8");
  const body = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from "\.\/([^".]+)"/g, 'from "./$1.js"');
  await route.fulfill({ contentType: "text/javascript", body });
});
const calls = [], errors = [], checks = []; let productRequests = 0;
await context.route("**/api/products", async route => { productRequests++; await route.abort(); });
await context.route("https://removal-model.invalid/**", async route => { calls.push(route.request().postDataJSON()); await route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content: "我在，接着说。" } }] }) }); });
const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
const ready = () => page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
const idle = () => page.waitForFunction(() => !document.querySelector("#send").disabled, null, { timeout: 120000 });
const data = (method, ...args) => page.evaluate(async ({ method, args }) => (await import("/__removal-test/storage.js")).storage[method](...args), { method, args });
async function db(store, value) { return page.evaluate(({ store, value }) => new Promise((resolve, reject) => { const open = indexedDB.open("xiaozhang-pwa"); open.onsuccess = () => { const db = open.result, tx = db.transaction(store, "readwrite"); tx.objectStore(store).put(value); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; }), { store, value }); }
async function send(text) { await page.fill("#draft", text); await page.locator("#composer").evaluate(form => form.requestSubmit()); await idle(); }
const pass = text => { checks.push(text); console.log("PASS", text); };
try {
  await page.goto(origin); await ready();
  const now = Date.now(), dormant = { version: 1, revision: 8, links: "OLD_PRODUCT_LINK", notes: [{ answer: "RETIRED_TOOL_ONLY" }], updatedAt: now };
  await db("kv", { key: "shopping-workspace", value: dormant });
  await data("saveProfile", { baseUrl: "https://removal-model.invalid/v1", model: "synthetic", apiKey: "SYNTHETIC_REMOVAL_KEY", temperature: .6 });
  await data("addMessage", { id: "legacy-product-row", role: "user", kind: "text", content: "这条旧聊天仍然保留。", createdAt: now - 100, sessionId: "private", metadata: { shopping: { version: 1, checkedAt: now, results: [{ rawUrl: "https://item.taobao.com/item.htm?id=12345678901", status: "error", code: "SOURCE_NOT_CONFIGURED" }] } } });
  await page.reload(); await ready(); await page.click("#topbar-menu-toggle");
  assert.equal(await page.locator("#shopping-open, #shopping-dialog, .shopping-cards").count(), 0);
  assert(!(await page.locator("#topbar-menu").textContent()).includes("选品辅助")); await page.click("#topbar-menu-toggle");
  await send("普通聊天继续。"); await send("https://item.taobao.com/item.htm?id=12345678901 https://detail.tmall.com/item.htm?id=22345678901");
  assert.equal(productRequests, 0); assert.equal(calls.length, 2);
  for (const call of calls) { assert(!call.tools); assert(!JSON.stringify(call).includes("untrusted_product_query_results")); assert(!JSON.stringify(call).includes("RETIRED_TOOL_ONLY")); }
  assert((await data("messages")).some(row => row.id === "legacy-product-row" && row.metadata.shopping));
  pass("选品入口、面板与卡片移除；普通聊天和商品链接都不查询商品、不注入商品工具，旧聊天保留");
  await db("groups", { id: "removal-group", title: "群聊对照", members: [{ id: "wu-xie", characterId: "wu-xie", name: "吴邪", enabled: true }], replyMode: "all", createdAt: now, updatedAt: now });
  await data("saveActiveSession", "removal-group"); await page.reload(); await ready(); await send("@吴邪 https://item.taobao.com/item.htm?id=12345678901");
  assert.equal(productRequests, 0); assert(!calls.at(-1).tools); assert.equal(await page.locator(".shopping-cards").count(), 0);
  pass("群聊商品链接仍走原有角色接话，不触发已撤下功能");
  const checkpoint = await data("makeArchive", "撤下功能后节点", "checkpoint"), archive = await data("exportArchive", checkpoint.id);
  assert.deepEqual(archive.rows.kv.find(row => row.key === "shopping-workspace").value, dormant);
  assert(!JSON.stringify(archive).includes("SYNTHETIC_REMOVAL_KEY"));
  pass("不清空本地数据；旧工具资料仅作休眠存档随关系节点保留，不进入角色上下文");
  for (const width of [320, 390, 1280]) { await page.setViewportSize({ width, height: 844 }); await page.click("#topbar-menu-toggle"); assert(await page.locator("#diary-open").isVisible()); assert(await page.locator("#settings").isVisible()); assert.equal(await page.locator("#shopping-open").count(), 0); await page.click("#topbar-menu-toggle"); }
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: new URL("removed.png", folder).pathname.replace(/^\/([A-Za-z]:)/, "$1") });
  assert.deepEqual(errors, []);
  await writeFile(new URL("results.json", folder), JSON.stringify({ passed: true, origin, checks, productRequests, modelFixtureCalls: calls.length, errors }, null, 2));
} finally { await context.close(); await browser.close(); }
