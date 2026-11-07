// Isolated browser storage; travel timing is local and no model request is made.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.TRAVEL_MEETING_TEST_URL || "http://127.0.0.1:4192";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ serviceWorkers: "block" });
await context.addInitScript(() => {
  for (const key of ["auto-moments", "auto-diary", "proactive-enabled"]) localStorage.setItem(`xiaozhang-${key}`, "false");
});
const page = await context.newPage(), errors = [];
page.on("pageerror", error => errors.push(error.message));
const ready = () => page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
const storage = () => page.evaluate(async () => (await import("/src/storage.ts")).storage);
try {
  await page.goto(origin); await ready();
  await page.evaluate(async () => {
    const { storage } = await import("/src/storage.ts");
    const { initialTravel } = await import("/src/travel.ts");
    const now = Date.now(), travel = initialTravel(now - 20 * 86400000, 1);
    travel.nextDepartureAt = now - 1;
    await storage.saveContextCache("travel-state", travel);
    await storage.saveDateSession({ id: "meeting-lock-date", characterId: "zhang-qiling", scene: "walk", title: "进行中的约会", setting: "旧街", atmosphere: "安静", active: true, createdAt: now, updatedAt: now, messages: [{ id: "date-floor", role: "user", content: "继续往前走。", kind: "text", createdAt: now }] });
  });
  await page.reload(); await ready(); await page.waitForTimeout(1200);
  let state = await page.evaluate(async () => (await import("/src/storage.ts")).storage.leisure("travel-state"));
  assert.equal(state.currentId, undefined, "进行中的约会不应开始旅行");
  assert.equal(state.journey?.plan, undefined, "进行中的约会不应创建出发通知");

  await page.evaluate(async () => {
    const { storage } = await import("/src/storage.ts");
    const dates = await storage.dateSessions();
    const date = dates.find(row => row.id === "meeting-lock-date");
    if (date) { date.active = false; date.updatedAt = Date.now(); await storage.saveDateSession(date); }
  });
  await page.reload(); await ready(); await page.waitForTimeout(1200);
  state = await page.evaluate(async () => (await import("/src/storage.ts")).storage.leisure("travel-state"));
  assert.equal(state.currentId, undefined, "通知阶段不会跳过预告等待");
  assert.ok(state.journey?.plan?.route, "结束场景后才恢复旅行计划");
  assert.deepEqual(errors, []);
  console.log("PASS active offline/date scenes defer both travel notices and departure; travel resumes after the scene ends");
} finally { await browser.close(); }
