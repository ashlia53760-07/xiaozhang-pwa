import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.EXPERIENCE_TEST_URL || "http://127.0.0.1:4174";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
await context.addInitScript(() => {
  localStorage.setItem("xiaozhang-auto-moments", "false");
  localStorage.setItem("xiaozhang-auto-diary", "false");
  localStorage.setItem("xiaozhang-proactive-enabled", "false");
  localStorage.setItem("xiaozhang-pet-position", JSON.stringify({ x: 16, y: 720 }));
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.goto(origin);
await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
await page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open("xiaozhang-pwa");
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const db = open.result;
    const tx = db.transaction(["messages", "diary", "moments", "interactions"], "readwrite");
    tx.objectStore("messages").put({ id: "timeline-chat-test", role: "user", kind: "text", content: "共同时间线检索验证", sessionId: "private", createdAt: Date.now() });
    tx.objectStore("messages").put({ id: "timeline-wuxie-test", role: "assistant", kind: "text", content: "吴邪跨联系人检索验证", sessionId: "private:wu-xie", speakerId: "吴邪", createdAt: Date.now() });
    tx.objectStore("diary").put({ id: "timeline-diary-test", title: "时间线日记验证", content: "本地日记仍可从时间线打开", source: "auto", createdAt: Date.now(), updatedAt: Date.now() });
    tx.objectStore("moments").put({ id: "timeline-moment-test", author: "xiaopingzi", content: "时间线朋友圈验证", comments: [], liked: false, createdAt: Date.now() });
    tx.objectStore("interactions").put({ id: "timeline-interaction-test", characterId: "zhang-qiling", kind: "touch", label: "摸摸头", response: "互动去重检查", affectionGain: 1, createdAt: Date.now() });
    tx.objectStore("messages").put({ id: "timeline-interaction-message-test", role: "assistant", kind: "event", content: "互动去重检查", metadata: { event: "pet_interaction", interactionId: "timeline-interaction-test" }, sessionId: "private", createdAt: Date.now() });
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  };
}));
await page.reload();
await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
await page.locator("#topbar-menu-toggle").click();
await page.locator("#role-open").click();
await page.waitForSelector("#relationship-hub[open]");
assert.equal(await page.locator("#relationship-contact-list [data-relationship-contact]").count(), 16);
await page.locator('[data-relationship-contact="zhang-qiling"]').click();
await page.waitForSelector("#role-dialog[open]");
assert.equal(await page.locator("#role-dialog .relationship-history-link").count(), 1);
await page.locator("#role-timeline-open").click();
await page.waitForSelector("#experience-timeline[open]");
await page.locator("#timeline-query").fill("共同时间线检索验证");
assert.equal(await page.locator("#timeline-list .timeline-entry").count(), 1);
assert.equal(await page.locator("#timeline-character").inputValue(), "all");
await page.locator("#timeline-list [data-timeline-id]").click();
await page.waitForFunction(() => !document.querySelector("#experience-timeline").open);
await page.waitForFunction(() => document.querySelector("#messages").textContent.includes("共同时间线检索验证"));
console.log("PASS timeline search opens its saved message in the correct conversation");

await page.locator("#topbar-menu-toggle").click();
await page.locator("#role-open").click();
await page.locator("#relationship-all-timeline").click();
await page.locator("#timeline-query").fill("吴邪跨联系人检索验证");
assert.equal(await page.locator("#timeline-list .timeline-entry").count(), 1);
await page.locator("#timeline-list [data-timeline-id]").click();
await page.waitForFunction(() => document.querySelector("#conversation-name").textContent === "吴邪");
await page.waitForFunction(() => document.querySelector("#messages").textContent.includes("吴邪跨联系人检索验证"));
console.log("PASS one role's records view can search and open another contact's message");

await page.locator("#topbar-menu-toggle").click();
await page.locator("#role-open").click();
await page.locator("#relationship-all-timeline").click();
await page.locator("#timeline-query").fill("吴邪跨联系人检索验证");
await page.locator("#timeline-list [data-timeline-favorite]").click();
await page.selectOption("#timeline-filter", "favorites");
await page.locator("#timeline-query").fill("");
assert.equal(await page.locator("#timeline-list .timeline-entry").count(), 1);
await page.locator("#timeline-character").selectOption("all");
await page.reload();
await page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
await page.locator("#topbar-menu-toggle").click();
await page.locator("#role-open").click();
await page.locator("#relationship-all-timeline").click();
await page.selectOption("#timeline-filter", "favorites");
await page.locator("#timeline-query").fill("吴邪跨联系人检索验证");
assert.equal(await page.locator("#timeline-list .timeline-entry").count(), 1);
await page.selectOption("#timeline-filter", "all");
await page.locator("#timeline-query").fill("互动去重检查");
assert.equal(await page.locator("#timeline-list .timeline-entry").count(), 1);
console.log("PASS cross-contact saved messages survive reload and interaction events are not duplicated");
await page.locator("#experience-timeline").evaluate(dialog => dialog.close());

await page.locator("#topbar-menu-toggle").click();
await page.locator("#settings").click();
await page.waitForFunction(() => document.querySelector("#storage-usage").textContent !== "正在读取…");
assert.match(await page.locator("#storage-usage").textContent(), /MB|KB|不提供/);
assert.match(await page.locator("#storage-persistence").textContent(), /浏览器/);
console.log("PASS local storage estimate and persistence status render without altering user records");

await page.locator("#settings-dialog").evaluate(dialog => dialog.close());
await page.locator("#topbar-menu-toggle").click();
await page.locator("#session-open").click();
await page.waitForSelector("#session-dialog[open]");
const desktop = await page.evaluate(() => ({
  side: document.querySelector("#session-dialog").getBoundingClientRect(),
  chat: document.querySelector(".chat-panel").getBoundingClientRect(),
  dialogPosition: getComputedStyle(document.querySelector("#session-dialog")).position
}));
assert.equal(desktop.dialogPosition, "fixed");
assert.ok(desktop.side.width < 360 && desktop.side.left === 0);
assert.ok(desktop.chat.left >= desktop.side.width && desktop.chat.width > 500);
await page.locator("#session-dialog").evaluate(dialog => dialog.close());
await page.setViewportSize({ width: 390, height: 844 });
await page.locator("#contacts-back").click();
await page.waitForSelector("#session-dialog[open]");
assert.equal(await page.locator("#session-dialog").evaluate(dialog => dialog.matches(":modal")), true);
assert.ok(await page.locator("#session-dialog").evaluate(dialog => dialog.getBoundingClientRect().width >= innerWidth - 24));
console.log("PASS wide layout reserves a contact sidebar; narrow layout remains viewport-sized");

assert.deepEqual(errors, []);
await browser.close();
