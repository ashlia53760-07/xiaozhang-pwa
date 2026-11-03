// Isolated browser data and mocked providers; never reads real keys or calls a paid API.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';
import { chromium } from 'playwright';
const origin = process.env.CONTACT_TEST_URL || 'http://127.0.0.1:4177';
const folder = new URL('../.local-review/contacts-remarks-20261026/', import.meta.url);
await mkdir(new URL('modules/', folder), {recursive:true});
const modules = {};
for (const name of ['groups','characters','checkup','phone-messages','storage']) {
  modules[name] = ts.transpileModule(await readFile(new URL(`../src/${name}.ts`,import.meta.url),'utf8'), {
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}
  }).outputText.replace(/from "\.\/([^".]+)"/g,'from "./$1.js"');
  await writeFile(new URL(`modules/${name}.js`,folder),modules[name]);
}
const {characters,characterHistories,characterRelationships,personaPrompt} = await import(new URL('modules/characters.js',folder));
const checks=[], errors=[], calls=[];
const check=name=>{checks.push(name);console.log('PASS',name);};
assert.equal(characters.length,16);
assert.equal(new Set(characters.map(c=>c.id)).size,16);
for (const c of characters) {
  const h=characterHistories[c.id];
  for(const k of ['work','timeline','history','boundaries']) assert.ok(h?.[k]?.trim(),`${c.name}: ${k}`);
  assert.ok(characterRelationships[c.id]);
  const prompt=personaPrompt(c,'张起灵原有设定',{relationshipMode:'romance'});
  assert.match(prompt,/乙女向陪伴/);assert.match(prompt,/铁三角友情不改写成恋爱/);
  assert.match(prompt,/当前时间线/);assert.match(prompt,/人物关系/);
}
assert.match(characterHistories['wang-can'].work,/影视改编/);
for(const id of ['li-cu','su-wan','yang-hao']) assert.match(characterHistories[id].timeline,/成年后的延续/);
check('all sixteen identities have history, time boundaries, relationships and otome/consent rules');
const browser=await chromium.launch({channel:'chrome',headless:true});
async function makeContext() {
  const ctx=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce',acceptDownloads:true});
  await ctx.addInitScript(()=>{for(const k of ['auto-moments','auto-diary','proactive-enabled'])localStorage.setItem(`xiaozhang-${k}`,'false');localStorage.setItem('xiaozhang-pet-position',JSON.stringify({x:10,y:400}));});
  await ctx.route('**/__remarks/*.js',route=>route.fulfill({contentType:'text/javascript',body:modules[new URL(route.request().url()).pathname.split('/').at(-1).replace('.js','')]}));
  await ctx.route('https://remarks-test.invalid/**',route=>{
    const body=route.request().postDataJSON();calls.push(body);
    return route.fulfill({contentType:'text/event-stream',body:`data: ${JSON.stringify({choices:[{delta:{content:'我听着呢。你接着说。'}}]})}\n\ndata: [DONE]\n\n`});
  });
  return ctx;
}
const ctx=await makeContext(),page=await ctx.newPage();
page.on('pageerror',e=>errors.push(e.message));
const ready=p=>p.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
const data=(method,...args)=>page.evaluate(async({method,args})=>(await import('/__remarks/storage.js')).storage[method](...args),{method,args});
async function contact(id) {
  await page.click('#contacts-back');await page.waitForSelector('#session-dialog[open]');await page.click(`[data-contact-id="${id}"]`);
  await page.waitForSelector('#session-dialog:not([open])',{state:'attached'});
  const prefs=await data('contactPreferences',id);
  await page.waitForFunction(name=>document.querySelector('#conversation-name').textContent===name,prefs.remark||characters.find(c=>c.id===id).name);
}
async function remark(value) {
  await page.click('#conversation-details');await page.waitForSelector('#role-dialog[open]');
  await page.fill('#contact-remark',value);await page.click('#role-save');
  await page.waitForSelector('#role-dialog:not([open])',{state:'attached'});
}
async function send(text) {await page.fill('#draft',text);await page.click('#send');await page.waitForFunction(()=>!document.querySelector('#send').disabled);}
try {
  await page.goto(origin);await ready(page);
  await data('saveProfile',{baseUrl:'https://remarks-test.invalid/v1',model:'synthetic',apiKey:'SYNTHETIC_TEST_ONLY',temperature:.4,protocol:'openai'});
  await data('addMessage',{id:'old-primary',role:'user',kind:'text',content:'保留我的旧聊天',createdAt:1});
  await page.reload();await ready(page);
  await remark('小哥');
  assert.equal(await page.textContent('#conversation-name'),'小哥');
  await send('这是张起灵的私聊');
  assert.ok((await page.locator('#messages .assistant .message-speaker').allTextContents()).every(v=>v==='小哥'));
  for(const [id,label] of [['wang-can','联系人灿'],['li-cu','联系人簇'],['su-wan','联系人万'],['yang-hao','联系人好']]) {
    await contact(id);await remark(label);await send(`你好${characters.find(c=>c.id===id).name}`);
    const body=JSON.stringify(calls.at(-1));
    assert.doesNotMatch(body,/联系人[灿簇万好]/);assert.match(body,/原著人物底稿/);
    const stored=await data('sessionMessages',`private:${id}`);
    assert.ok(stored.filter(m=>m.role==='assistant').every(m=>m.metadata.characterId===id&&m.speakerId===characters.find(c=>c.id===id).name));
  }
  check('new four contacts really chat with canonical identity; remarks update bubbles, never persona or stored speaker IDs');
  await contact('wu-xie');await remark('<img src=x onerror=alert(1)>');
  assert.equal(await page.locator('#conversation-name img').count(),0);
  await page.click('#contacts-back');await page.waitForSelector('#session-dialog[open]');
  assert.equal(await page.locator('[data-contact-id="wu-xie"] .contact-copy strong').textContent(),'<img src=x onerror=alert(1)>');
  assert.equal(await page.locator('[data-contact-id="wu-xie"] .contact-copy strong img').count(),0);
  await page.click('[data-contact-id="wu-xie"]');await page.waitForSelector('#session-dialog:not([open])',{state:'attached'});
  await remark('同名备注');await contact('li-cu');await remark('同名备注');
  await page.reload();await ready(page);assert.equal(await page.textContent('#conversation-name'),'同名备注');
  await page.click('#contacts-back');await page.click('#group-create-open');
  await page.fill('#group-contact-query','同名备注');assert.equal(await page.locator('[data-group-contact]').count(),2);
  await page.check('[data-group-contact="wu-xie"]');await page.check('[data-group-contact="li-cu"]');
  await page.fill('#group-title','备注身份测试群');await page.click('#group-save');
  await page.waitForSelector('#group-editor-dialog:not([open])',{state:'attached'});
  await send('大家说说吧');
  const groups=await data('groups'),group=groups.find(g=>g.title==='备注身份测试群');
  assert.deepEqual(group.members.map(m=>m.name).sort(),['吴邪','黎簇']);
  assert.ok((await page.locator('#messages .assistant .message-speaker').allTextContents()).every(n=>n==='同名备注'));
  assert.equal(new Set((await data('sessionMessages',group.id)).filter(m=>m.role==='assistant').map(m=>m.metadata.characterId)).size,2);
  assert.ok(calls.slice(-2).every(b=>!JSON.stringify(b).includes('同名备注')));
  check('duplicate and HTML remarks are safe; canonical/remark search and distinct group identities survive refresh');
  const downloadPromise=page.waitForEvent('download');await page.locator('#export-data').evaluate(el=>el.click());
  const download=await downloadPromise;const backup=JSON.parse(await readFile(await download.path(),'utf8'));
  assert.equal(backup.contactData.contacts['zhang-qiling']?.remark,'小哥');
  assert.equal(backup.contactData.contacts['li-cu'].remark,'同名备注');
  assert.ok(!JSON.stringify(backup).includes('SYNTHETIC_TEST_ONLY'));
  const restoredContext=await makeContext(),restored=await restoredContext.newPage();
  restored.on('pageerror',e=>errors.push(e.message));await restored.goto(origin);await restored.evaluate(()=>new Promise(resolve=>{const r=indexedDB.deleteDatabase('xiaozhang-pwa');r.onsuccess=r.onerror=r.onblocked=()=>resolve();}));await restored.reload();await ready(restored);
  await restored.locator('#import-data').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  await restored.waitForFunction(()=>new Promise(resolve=>{const o=indexedDB.open('xiaozhang-pwa');o.onsuccess=()=>{const db=o.result,t=db.transaction('kv'),r=t.objectStore('kv').get('contact:li-cu');t.oncomplete=()=>{db.close();resolve(r.result?.value?.remark==='同名备注');};};}));
  await restored.reload();await ready(restored);await restored.click('#contacts-back');
  assert.equal(backup.contactData.contacts['li-cu']?.remark,'同名备注');
  await restoredContext.close();
  check('actual backup excludes keys and restores remarks with real import, reload and old chat preserved');
  await contact('wu-xie');await remark('');assert.equal(await page.textContent('#conversation-name'),'吴邪');
  assert.ok((await data('messages')).some(m=>m.id==='old-primary'&&m.content==='保留我的旧聊天'));
  await page.screenshot({path:new URL('remarks-mobile.png',folder).pathname.replace(/^\/(\w:)/,'$1')});
  assert.deepEqual(errors,[]);check('clearing a remark restores original name; original records intact; no browser errors');
} finally {
  await writeFile(new URL('remarks-verification.json',folder),JSON.stringify({checks,errors,requests:calls.length},null,2));
  await browser.close();
}
