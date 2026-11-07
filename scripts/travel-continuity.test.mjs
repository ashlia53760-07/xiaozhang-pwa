// Isolated storage and intercepted synthetic API requests; no paid model calls.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.TRAVEL_CONTINUITY_TEST_URL || "http://127.0.0.1:4192";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
await context.addInitScript(() => {
  for (const key of ["auto-moments", "auto-diary", "proactive-enabled"]) localStorage.setItem(`xiaozhang-${key}`, "false");
});
const page = await context.newPage(), calls = [], errors = [];
page.on("pageerror", error => errors.push(error.message));
await context.route("https://travel-continuity.invalid/**", async route => {
  const payload = route.request().postDataJSON(); calls.push(payload);
  const content = payload.messages[0].content.includes("这是用户视角的朋友圈")
    ? JSON.stringify({ content: "路上的雾散了一些。", comments: [{ name: "吴邪", content: "路上注意安全。" }] })
    : "消息收到了。";
  await route.fulfill({ contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content } }] }) });
});
const ready = () => page.waitForFunction(() => document.documentElement.dataset.appReady === "true");
async function send(text) {
  const before = calls.length;
  await page.fill("#draft", text); await page.click("#send");
  await page.waitForFunction(() => !document.querySelector("#send").disabled);
  assert.equal(calls.length, before + 1);
  return calls.at(-1).messages[0].content;
}
async function moment() {
  await page.locator("#moments-open").evaluate(button => button.click());
  const before = calls.length;
  await page.click("#moment-latest");
  await page.waitForFunction(() => !document.querySelector("#moment-latest").disabled);
  assert.equal(calls.length, before + 1, await page.locator("#moment-latest-status").innerText());
  const prompt = calls.at(-1).messages[0].content;
  await page.locator("#moments-dialog").evaluate(dialog => dialog.close());
  return prompt;
}
try {
  await page.goto(origin); await ready();
  const checks = await page.evaluate(async () => {
    const { initialTravel, startTrip, finishTrip, DAY } = await import("/src/travel.ts");
    const { travelContinuity, travelModelContext } = await import("/src/travel-continuity.ts");
    const now = Date.now(), state = initialTravel(now - 30 * DAY, 1);
    const old = startTrip(state, now - 20 * DAY, "old-trip", "market");
    finishTrip(state, now - 18 * DAY);
    const notice = { id: "old-return", role: "assistant", kind: "event", content: "回来了。", sessionId: "private", metadata: { event: "travel_return", tripId: old.id }, createdAt: now - 18 * DAY };
    const oldReturned = travelContinuity(state, [notice]).status;
    const trip = startTrip(state, now - 300000, "current-trip", "motuo", true);
    const during = travelContinuity(state, [notice]).status;
    const overdue = structuredClone(state); overdue.trips.at(-1).endsAt = now - 1;
    const overdueStatus = travelContinuity(overdue, [notice]).status;
    const completed = structuredClone(state); finishTrip(completed, now + 10 * DAY);
    const missingNotice = travelContinuity(completed, [notice]).status;
    const currentNotice = { ...notice, id: "current-return", createdAt: now + 10 * DAY, metadata: { event: "travel_return", tripId: trip.id } };
    const confirmed = travelContinuity(completed, [notice, currentNotice]).status;
    const unrelated = travelContinuity(completed, [{ ...currentNotice, sessionId: "date:other" }]).status;
    const hidden = travelContinuity(completed, [{ ...currentNotice, metadata: { ...currentNotice.metadata, hiddenAt: now } }]).status;
    const speech = travelContinuity(completed, [{ ...currentNotice, kind: "text", metadata: {} }]).status;
    const incomplete = travelModelContext(completed, [notice]);
    state.settings.enabled = false; state.wish = "PRIVATE_WISH_DO_NOT_PUBLISH";
    state.journey = { version: 1, threads: [], events: [{ id: "observed", tripId: trip.id, kind: "observation", title: "沿路", text: "沿路雾散了。", at: now - 1000, recordedAt: now }] };
    const { storage } = await import("/src/storage.ts");
    await storage.saveContextCache("travel-state", state);
    await storage.saveContextCache("api-profile", { baseUrl: "https://travel-continuity.invalid/v1", model: "synthetic", apiKey: "SYNTHETIC_ONLY", temperature: 0.4, protocol: "openai" });
    await storage.saveContextCache("context-summary:private", { version: 1, scope: "private", text: "OLD_SUMMARY_RETURN：之前旅行已经回家。", covered: 0, fingerprint: "0:2166136261:5381", updatedAt: now });
    await storage.saveMemory({ id: "old-return-memory", characterId: "zhang-qiling", content: "OLD_MEMORY_RETURN：以前旅行已经回家。", category: "旅行回忆", enabled: true, source: "user", createdAt: now, updatedAt: now });
    await storage.addMessages([notice, { id: "private-secret", role: "user", kind: "text", content: "PRIVATE_CHAT_SECRET：上次你已经回家了。", sessionId: "private", createdAt: now - 1000 }]);
    await storage.saveDateSession({ id: "isolated-date", characterId: "zhang-qiling", scene: "walk", title: "约会", setting: "DATE_SECRET_HOME：在剧本里已经回家", atmosphere: "安静", active: false, createdAt: now, updatedAt: now, messages: [] });
    await storage.saveMoment({ id: "public-post", author: "user", content: "PUBLIC_POST_MARKER：今天天气不错。", liked: false, comments: [], createdAt: now });
    return { oldReturned, during, overdueStatus, missingNotice, confirmed, unrelated, hidden, speech, incomplete };
  });
  assert.deepEqual(Object.fromEntries(Object.entries(checks).filter(([key]) => key !== "incomplete")), {
    oldReturned: "returned", during: "away", overdueStatus: "away", missingNotice: "unconfirmed", confirmed: "returned", unrelated: "unconfirmed", hidden: "unconfirmed", speech: "unconfirmed"
  });
  assert.doesNotMatch(checks.incomplete, /已经回家/);
  assert.match(checks.incomplete, /归来尚未确认/);
  console.log("PASS trip-specific return evidence, prior trips, overdue ETA, hidden/missing notices and independent scenes");

  await page.reload(); await ready();
  const privatePrompt = await send("你回来了吗？");
  assert.match(privatePrompt, /张起灵尚未归来，仍在旅途中：墨脱山路/);
  assert(privatePrompt.indexOf("【当前旅行事实") > privatePrompt.indexOf("当前交流方式"));
  assert.match(privatePrompt, /OLD_SUMMARY_RETURN/);
  assert.match(privatePrompt, /OLD_MEMORY_RETURN/);
  assert(privatePrompt.indexOf("【当前旅行事实") > privatePrompt.indexOf("OLD_SUMMARY_RETURN"));
  assert(privatePrompt.indexOf("【当前旅行事实") > privatePrompt.indexOf("OLD_MEMORY_RETURN"));
  assert.doesNotMatch(privatePrompt, /DATE_SECRET_HOME/);
  const publicPrompt = await moment();
  assert.match(publicPrompt, /张起灵尚未归来，仍在旅途中：墨脱山路/);
  assert.match(publicPrompt, /PUBLIC_POST_MARKER/);
  assert.match(publicPrompt, /沿路雾散了/);
  assert.doesNotMatch(publicPrompt, /PRIVATE_CHAT_SECRET|PRIVATE_WISH_DO_NOT_PUBLISH|DATE_SECRET_HOME|OLD_SUMMARY_RETURN|OLD_MEMORY_RETURN/);
  console.log("PASS actual private and Moments requests share current presence; public input excludes private chats, wishes and dates");

  await page.evaluate(async () => {
    const { storage } = await import("/src/storage.ts");
    await storage.saveGroup({ id: "travel-group", title: "旅行状态测试群", members: [{ id: "zhang-qiling", characterId: "zhang-qiling", name: "张起灵", enabled: true, persona: "" }], replyMode: "all", proactive: false, createdAt: Date.now(), updatedAt: Date.now() });
    await storage.saveActiveSession("travel-group");
  });
  await page.reload(); await ready();
  const groupPrompt = await send("@张起灵 还在路上吗？");
  assert.match(groupPrompt, /张起灵尚未归来，仍在旅途中：墨脱山路/);
  assert.doesNotMatch(groupPrompt, /PRIVATE_CHAT_SECRET|PRIVATE_WISH_DO_NOT_PUBLISH|DATE_SECRET_HOME/);
  await page.evaluate(async () => (await import("/src/storage.ts")).storage.saveActiveSession("private"));
  console.log("PASS actual group request receives public travel status without private memories");

  await page.evaluate(async () => {
    const { storage } = await import("/src/storage.ts");
    const { finishTrip, DAY } = await import("/src/travel.ts");
    const state = await storage.leisure("travel-state");
    // Simulate a legacy/incomplete restore: trip completed but no chat return notice.
    state.trips.at(-1).endsAt = Date.now() - 1000;
    finishTrip(state, Date.now());
    state.nextDepartureAt = Date.now() + DAY;
    await storage.saveContextCache("travel-state", state);
  });
  await page.reload(); await ready();
  assert.match(await send("已经回来了吗？"), /归来尚未确认/);
  assert.match(await moment(), /归来尚未确认/);
  await page.evaluate(async () => {
    const { storage } = await import("/src/storage.ts");
    const state = await storage.leisure("travel-state"), trip = state.trips.at(-1);
    await storage.addMessage({ id: `${trip.id}:return`, role: "assistant", kind: "event", content: "回来了。", metadata: { event: "travel_return", tripId: trip.id }, sessionId: "private", createdAt: trip.returnedAt });
  });
  await page.reload(); await ready();
  assert.match(await send("现在呢？"), /已由本次对应的聊天归来通知确认结束/);
  assert.match(await moment(), /已由本次对应的聊天归来通知确认结束/);
  console.log("PASS refresh/restore: both channels stay unconfirmed until this trip's return notice is saved");
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
