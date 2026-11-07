import assert from "node:assert/strict";
import {chromium} from "playwright";
import {mkdir,writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
const origin=process.env.CALENDAR_TEST_URL||"http://127.0.0.1:4192";
const folder=new URL("../.local-review/calendar-eggs-20261107/ui/",import.meta.url);await mkdir(folder,{recursive:true});
const browser=await chromium.launch({channel:"chrome",headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:"Asia/Shanghai",serviceWorkers:"block"});
await context.addInitScript(()=>{
  for(const k of ["auto-moments","auto-diary","proactive-enabled"])localStorage.setItem(`xiaozhang-${k}`,"false");
  localStorage.setItem("xiaozhang-pet-position",JSON.stringify({x:300,y:630}));
});
const page=await context.newPage(),errors=[],posts=[],checks=[];
page.on("pageerror",e=>errors.push(e.message));page.on("request",r=>{if(r.method()==="POST")posts.push(r.url());});
const ready=()=>page.waitForFunction(()=>document.documentElement.dataset.appReady==="true");
const pass=name=>{checks.push(name);console.log("PASS",name);};
const snapshot=()=>page.evaluate(async()=>{
  const {storage:s}=await import("/src/storage.ts");
  return JSON.stringify(await Promise.all([s.messages(),s.allMemories(),s.diaries(),s.lifeEvents(),s.calendar(),s.dateSessions()]));
});
const hold=async()=>{await page.locator("#pet").hover();await page.mouse.down();await page.waitForTimeout(1050);await page.mouse.up();await page.waitForSelector("#phone-trace-card:not([hidden])");};
const next=async expected=>{await page.click("#phone-trace-next");await page.waitForFunction(id=>document.querySelector("#phone-trace-card").dataset.surpriseId===id,expected);};
const openCalendar=async()=>{await page.locator("#diary-open").evaluate(b=>b.click());await page.waitForSelector("#calendar-egg-character");};
const shot=async name=>page.screenshot({path:fileURLToPath(new URL(`${name}.png`,folder))});
try{
  await page.clock.install({time:new Date("2026-11-07T10:00:00+08:00")});
  await page.goto(origin);await ready();
  const before=await snapshot();
  await hold();
  assert.equal(await page.locator("#phone-trace-card").getAttribute("data-surprise-id"),"term-20");
  assert.match(await page.locator("#phone-trace-title").innerText(),/立冬/);
  await page.click("#phone-trace-flip");
  assert.match(await page.locator("#phone-trace-body").innerText(),/张|碗|热/);
  await page.clock.runFor(9000);assert(await page.locator("#phone-trace-card").isVisible());
  await shot("lidong-long-press");
  assert.equal(await snapshot(),before);assert.equal(posts.length,0);
  assert.equal(await page.locator("#pet-action-menu").isVisible(),false);
  await next("daily");
  await next("term-20");
  await page.click("#phone-trace-close");
  pass("actual pet long press reveals Lidong, manual card persists, daily trace remains, release does not trigger touch/API/history");
  await openCalendar();
  assert.equal(await page.locator("#calendar-egg-character option").count(),27);
  await page.fill("#calendar-note","还没保存的节日记录");
  await page.selectOption("#calendar-egg-preview","term-23");
  for(const [id,text] of [["zhang-qiling","吃完再走"],["wu-xie","杭州"],["wang-pangzi","胖爷"],["liu-sang","没有热闹"],["old-qi-tiezui","不"],["old-zhang-xiaoyu","用饭"]]){
    await page.selectOption("#calendar-egg-character",id);
    assert.match(await page.locator(".calendar-surprise-scene").innerText(),new RegExp(text));
    assert.equal(await page.locator(".calendar-surprise-letter").getAttribute("data-character-id"),id);
  }
  assert.match(await page.locator(".calendar-surprise-state").innerText(),/预览/);
  assert.equal(await page.inputValue("#calendar-note"),"还没保存的节日记录");
  assert.equal(await snapshot(),before);
  for(const theme of ["rococo","bronze"]){
    await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
    await page.selectOption("#calendar-egg-character","zhang-qiling");
    await page.locator("#calendar-surprises").scrollIntoViewIfNeeded();await shot(`${theme}-winter-preview`);
    assert(await page.locator("#diary-dialog").evaluate(el=>el.scrollWidth<=innerWidth));
  }
  await page.selectOption("#calendar-egg-character","old-zhang-qishan");await page.selectOption("#calendar-egg-preview","national");
  await page.locator(".calendar-surprise-notes summary").click();
  assert.match(await page.locator(".calendar-surprise-notes").innerText(),/不预知/);
  await page.selectOption("#calendar-egg-preview","valentine");await page.locator(".calendar-surprise-notes summary").click();
  assert.match(await page.locator(".calendar-surprise-notes").innerText(),/海外成长史/);
  await page.selectOption("#calendar-egg-preview","contact-birthday");
  assert.match(await page.locator(".calendar-surprise-scene").innerText(),/生日/);
  assert.equal(await snapshot(),before);
  pass("calendar archive has 27 characters, distinct winter/birthday previews, era-aware notes, no writes and no lost diary draft");
  // Discard only this test's unsaved form, then verify birthday/holiday collision after a reload.
  page.once("dialog",d=>d.accept());await page.locator("#diary-dialog form[method=dialog] button").click();
  await page.evaluate(async()=>{
    const {storage:s}=await import("/src/storage.ts");const b=await s.birthdaySettings();
    await s.saveBirthdaySettings({...b,user:{month:11,day:7},contacts:{...b.contacts,"zhang-qiling":{month:11,day:7}},updatedAt:Date.now()});
  });
  await page.reload();await ready();const birthdayBaseline=await snapshot();
  await hold();assert.equal(await page.locator("#phone-trace-card").getAttribute("data-surprise-id"),"contact-birthday");
  await next("user-birthday");
  await next("term-20");
  await next("daily");
  assert.equal(await snapshot(),birthdayBaseline);
  await page.click("#phone-trace-close");await page.reload();await ready();assert.equal(await snapshot(),birthdayBaseline);
  const greetings=await page.evaluate(async()=>(await (await import("/src/storage.ts")).storage.messages()).filter(m=>m.metadata?.event==="birthday").map(m=>m.content));
  assert.equal(greetings.length,28);assert.equal(new Set(greetings).size,28);
  pass("own birthday, user birthday, festival and original trace coexist; 27 personalized greetings and one own birthday are idempotent after reload");
  // Actual current contact drives the hold, without changing the independently selected preview role.
  await page.evaluate(async()=>{const s=(await import("/src/storage.ts")).storage;await s.saveActiveSession("private:wu-xie");});
  await page.reload();await ready();await hold();assert.equal(await page.locator("#phone-trace-card").getAttribute("data-character-id"),"wu-xie");
  assert.equal(await page.locator("#phone-trace-card").getAttribute("data-surprise-id"),"user-birthday");
  await shot("wuxie-user-birthday");await page.click("#phone-trace-close");
  await page.setViewportSize({width:320,height:740});await openCalendar();await page.selectOption("#calendar-egg-preview","term-23");
  await page.locator("#calendar-surprises").scrollIntoViewIfNeeded();await shot("narrow-320");
  assert(await page.locator("#diary-dialog").evaluate(el=>el.scrollWidth<=innerWidth));
  await page.setViewportSize({width:1280,height:900});await shot("desktop-preview");
  assert.equal(posts.length,0);assert.deepEqual(errors,[]);
  pass("active-contact long press, 320px mobile and desktop layouts, no provider calls or page errors");
  await writeFile(new URL("result.json",folder),JSON.stringify({checks,errors,posts,passed:true},null,2));
}finally{await browser.close();}
