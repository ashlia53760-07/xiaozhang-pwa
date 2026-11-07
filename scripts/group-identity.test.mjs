// Isolated Chrome/IndexedDB + synthetic DS-shaped SSE/JSON. No real credentials or paid calls.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { chromium } from 'playwright';
const origin = process.env.CONTACT_TEST_URL || 'http://127.0.0.1:4175';
const folder = new URL('../.local-review/group-identity-20261025/', import.meta.url);
await mkdir(new URL('modules/', folder), { recursive: true });
const modules = {};
for (const name of ['scene-context-data', 'groups', 'characters', 'checkup', 'phone-messages', 'storage']) {
  modules[name] = ts.transpileModule(await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText.replace(/from "\.\/([^".]+)"/g, 'from "./$1.js"');
  await writeFile(new URL(`modules/${name}.js`, folder), modules[name]);
}
const { normalizeLegacyGroup, normalizeGroupReply, groupMessageCharacter, groupEventText, groupHistory, selectGroupSpeakers } = await import(new URL('modules/groups.js', folder));
const { characters } = await import(new URL('modules/characters.js', folder));
const member = name => { const c = characters.find(c => c.name === name); return { ...c, characterId: c.id, enabled: true }; };
const message = (content, speakerId, metadata) => ({ id: 'sample', role: 'assistant', kind: 'text', sessionId: 'broken-group', content, speakerId, metadata, createdAt: 1 });
const combined = '吴邪，王胖子，张起灵';
const legacy = { id: 'broken-group', title: '铁三角旧群', members: [{ id: 'old-combined', name: combined, persona: '旧成员资料', enabled: true }], createdAt: 1, updatedAt: 1, replyMode: 'natural', activity: 'lively' };
const checks = [], calls = [], errors = [];
const check = (name, fn) => { fn?.(); checks.push(name); console.log('PASS', name); };
check('legacy Chinese/ASCII delimiters expand only complete canonical rosters, with stable IDs and no raw mutation', () => {
  const untouched = structuredClone(legacy), normalized = normalizeLegacyGroup(legacy);
  assert.deepEqual(legacy, untouched);
  assert.deepEqual(normalized.members.map(m => m.name), ['吴邪','王胖子','张起灵']);
  assert.deepEqual(normalizeLegacyGroup(normalized), normalized);
  for (const separator of [',','、','；','\n']) assert.equal(normalizeLegacyGroup({ ...legacy, members: [{...legacy.members[0],name:['吴邪','王胖子','张起灵'].join(separator)}] }).members.length,3);
  assert.equal(normalizeLegacyGroup({ ...legacy, members: [{...legacy.members[0],name:'吴邪，原创角色'}] }).members.length,1);
  const selected = normalizeLegacyGroup({ ...legacy, selectedMemberIds: ['old-combined'], members: [...legacy.members, member('吴邪')] });
  assert.equal(selected.members.length,3); assert.equal(selected.selectedMemberIds.length,3);
  assert.deepEqual(selected.members.map(m=>m.id),normalizeLegacyGroup({...legacy,members:[...legacy.members,member('吴邪')]}).members.map(m=>m.id));
});
check('own repeated/markdown labels stripped; natural mentions and quotes preserved; other speakers rejected', () => {
  const wu = member('吴邪');
  for (const label of ['[::]','[:]','[：：]','[吴邪::]','[吴邪]：','[吴邪：]','[::]吴邪：','吴邪：[::]','吴邪：','吴邪:','**吴邪：**','**吴邪**：','吴邪：吴邪：']) assert.equal(normalizeGroupReply(`${label}晚上吃饭。`,wu),'晚上吃饭。');
  assert.equal(normalizeGroupReply('吴邪：一会儿聊。\n\n吴邪：你先说。',wu),'一会儿聊。\n\n你先说。');
  for (const text of ['[:)]','[12:30] 出发。','这个符号[::]保留。','https://example.invalid/a:b','[吴邪]是联系人。','吴邪你先说。','胖子说“吴邪：你来定。”','我想起张起灵说的话。']) assert.equal(normalizeGroupReply(text,wu),text);
  assert.throws(()=>normalizeGroupReply('吴邪：我买菜。\n王胖子：我做饭。',wu),/代替其他群成员/);
  assert.throws(()=>normalizeGroupReply('[王胖子::]我做饭。',wu),/代替其他群成员/);
  assert.throws(()=>normalizeGroupReply('王胖子：我做饭。',wu),/代替其他群成员/);
  assert.equal(normalizeGroupReply('黑眼镜：听着呢。',member('黑瞎子')),'听着呢。');
});
check('stable metadata resolves portraits; legacy speaker tags resolve only unambiguous history without rewriting', () => {
  assert.equal(groupMessageCharacter(message('在。',combined,{characterId:'zhang-qiling'})).id,'zhang-qiling');
  const old = message(`${combined}：王胖子：[::]晚上整个硬菜。`,combined);
  assert.equal(groupMessageCharacter(old).id,'wang-pangzi'); assert.equal(groupEventText(old),'晚上整个硬菜。');
  assert.ok(old.content.startsWith(combined));
  assert.equal(groupMessageCharacter(message('吴邪：我买菜。\n王胖子：我做饭。',combined)),undefined);
  assert.equal(groupMessageCharacter(message('不知道谁说的。\n吴邪：这也是引用。',combined)),undefined);
});
check('own assistant history is plain body, other speakers clearly attributed; @ scheduling stays local', () => {
  const group = normalizeLegacyGroup(legacy), wu = group.members.find(m=>m.name==='吴邪');
  const rows = [message('吴邪：我在。','吴邪'),message('王胖子：吃饭去。','王胖子')];
  const history = groupHistory(rows,wu,group);
  assert.equal(history[0].role,'assistant');assert.equal(history[0].content,'我在。');
  assert.equal(history[1].role,'user');assert.match(history[1].content,/群内消息 · 王胖子/);
  assert.deepEqual(selectGroupSpeakers({...group,replyMode:'natural'},{...message('@王胖子 今晚吃什么'),role:'user'},[]).map(m=>m.name),['王胖子']);
});
const browser = await chromium.launch({channel:'chrome',headless:true});
const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
await context.addInitScript(()=>{for(const key of ['auto-moments','auto-diary','proactive-enabled'])localStorage.setItem(`xiaozhang-${key}`,'false');localStorage.setItem('xiaozhang-pet-position',JSON.stringify({x:10,y:400}));});
await context.route('**/__identity/*.js',route=>route.fulfill({contentType:'text/javascript',body:modules[new URL(route.request().url()).pathname.split('/').at(-1).replace('.js','')]}));
let mode = 'sse';
await context.route('https://ds-test.invalid/**',async route=>{
  const body = route.request().postDataJSON(), name = body.messages[0].content.match(/只以“([^”]+)”身份发言/)?.[1];
  calls.push({name,body});
  const content = mode==='wrong' ? '吴邪：我来回答。\n张起灵：我也说一句。' : `[::]${name}：[${name}::]晚饭的事我听见了。\n\n${name}：[:]你想吃什么？`;
  if(mode==='json')return route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{role:'assistant',reasoning_content:'HIDDEN_REASONING',content}}]})});
  const deltas=[{role:'assistant',content:null,reasoning_content:'HIDDEN_REASONING'},...Array.from(content).map(c=>({content:c}))];
  return route.fulfill({contentType:'text/event-stream',body:deltas.map(delta=>`data: ${JSON.stringify({choices:[{delta}]})}\n\n`).join('')+'data: [DONE]\n\n'});
});
const page = await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
const ready = ()=>page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
const data = (method,...args)=>page.evaluate(async ({method,args})=>(await import('/__identity/storage.js')).storage[method](...args),{method,args});
const raw = store=>page.evaluate(store=>new Promise((resolve,reject)=>{const o=indexedDB.open('xiaozhang-pwa');o.onsuccess=()=>{const db=o.result,t=db.transaction(store),r=t.objectStore(store).getAll();t.oncomplete=()=>{db.close();resolve(r.result);};t.onerror=()=>reject(t.error);};}),store);
const send = async text=>{await page.fill('#draft',text);await page.click('#send');await page.waitForFunction(()=>!document.querySelector('#send').disabled);};
const allMessages = ()=>data('sessionMessages',legacy.id);
try {
  await page.goto(origin); await ready();
  await data('saveProfile',{baseUrl:'https://ds-test.invalid/v1',model:'deepseek-chat',apiKey:'SYNTHETIC_ONLY',temperature:.5,protocol:'openai'});
  await data('saveGroup',legacy); await data('saveActiveSession',legacy.id);
  const oldMessages = [message(`${combined}：王胖子：晚上整个硬菜。`,combined), {...message('吴邪：[::]我去买菜。',combined),id:'old-wu',createdAt:2}, {...message('张起灵：可以。',combined),id:'old-zhang',createdAt:3}];
  for (const m of oldMessages) await data('addMessage',m);
  await page.evaluate(async ()=>{
    const {storage} = await import('/__identity/storage.js');
    for(const [name,color] of [['吴邪','#ff0000'],['王胖子','#00ff00'],['张起灵','#0000ff']]){
      const canvas=document.createElement('canvas');canvas.width=canvas.height=8;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,8,8);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png')),record={id:`portrait-${name}`,blob,mime:'image/png',origin:'test',createdAt:1};
      if(name==='张起灵')await storage.saveCharacterAvatar(record);else await storage.saveNpcAvatar(name,record);
    }
  });
  await page.reload(); await ready();
  await page.waitForFunction(()=>document.querySelectorAll('#messages .assistant img.message-avatar').length===3);
  assert.deepEqual(await page.locator('#messages .message-speaker').allTextContents(),['王胖子','吴邪','张起灵']);
  assert.deepEqual(await page.locator('#messages .assistant img.message-avatar').evaluateAll(imgs=>imgs.map(i=>i.alt)),['王胖子','吴邪','张起灵']);
  assert.deepEqual((await raw('groups'))[0],legacy); assert.deepEqual((await raw('messages')).filter(m=>oldMessages.some(o=>o.id===m.id)).sort((a,b)=>a.createdAt-b.createdAt),oldMessages);
  check('screenshot legacy group reproduced: corrected distinct names/portraits on reload, original records unchanged');
  await send('大家晚上吃什么？');
  assert.equal(calls.length,3);assert.equal(new Set(calls.map(c=>c.name)).size,3);
  let rows = await allMessages(), generated = rows.filter(m=>m.metadata?.source==='api');
  assert.equal(generated.length,6);assert.equal(new Set(generated.map(m=>m.metadata.characterId)).size,3);
  for(const row of generated){assert.doesNotMatch(row.content,/\[::?\]|^(吴邪|王胖子|张起灵)[:：]|null|HIDDEN_REASONING/);assert.ok(row.metadata.groupMemberId.includes('::'));}
  for(const call of calls){assert.ok(call.body.messages.every(m=>typeof m.content==='string'));for(const m of call.body.messages.filter(m=>m.role==='assistant'))assert.doesNotMatch(m.content,/^(吴邪|王胖子|张起灵)[:：]/);}
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('#messages .assistant img.message-avatar')).every(i=>i.complete&&i.naturalWidth===8));
  const colors=await page.locator('#messages .assistant img.message-avatar').evaluateAll(imgs=>{
    return imgs.map(img=>{const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,1,1);return [img.alt,...ctx.getImageData(0,0,1,1).data.slice(0,3)];});
  });
  for(const [name,r,g,b] of colors)assert.deepEqual([r,g,b],{'吴邪':[255,0,0],'王胖子':[0,255,0],'张起灵':[0,0,255]}[name]);
  check('DS-shaped SSE: null/reasoning ignored, repeated labels removed before splitting, actual per-speaker image pixels verified');
  mode='json';await send('@王胖子 还想吃什么');assert.equal(calls.at(-1).name,'王胖子');
  const last = (await allMessages()).filter(m=>m.role==='assistant').at(-1); assert.equal(last.speakerId,'王胖子');assert.doesNotMatch(last.content,/王胖子[:：]/);
  check('non-stream JSON uses same identity/text validation; explicit @ selects only addressed member');
  mode='wrong';await send('@吴邪 这次你说');
  rows=await allMessages();const turn=rows.filter(m=>m.role==='user').at(-1);
  assert.equal(rows.filter(m=>m.metadata?.replyToUserId===turn.id).length,0);assert.match(await page.locator('#error').textContent(),/代替其他群成员/);
  check('model multi-speaker script rejected with actionable error, never saved under a false avatar');
  mode='sse';await page.locator(`[data-message-id="${turn.id}"] .bubble`).dispatchEvent('contextmenu');await page.click(`[data-retry-id="${turn.id}"]`);await page.waitForFunction(()=>!document.querySelector('#send').disabled);
  assert.equal((await allMessages()).filter(m=>m.metadata?.replyToUserId===turn.id).length,2);
  await page.reload();await ready();
  await page.waitForFunction(()=>Array.from(document.querySelectorAll('#messages .assistant img.message-avatar')).every(i=>i.complete&&i.naturalWidth===8));
  assert.deepEqual((await raw('groups'))[0],legacy);
  await page.screenshot({path:fileURLToPath(new URL('group-fixed-mobile.png',folder))});
  check('retry/reload preserves distinct avatars, text, legacy raw group and split-message identity');
  await page.click('#conversation-details');
  for(const id of ['wu-xie','wang-pangzi','zhang-qiling'])assert.ok(await page.locator(`[data-group-contact="${id}"]`).isChecked());
  await page.click('#group-save');await page.waitForSelector('#group-editor-dialog[open]',{state:'detached'});
  assert.equal((await raw('groups'))[0].members.length,3);assert.equal((await raw('groups'))[0].id,legacy.id);
  await page.reload();await ready();assert.equal((await data('groups'))[0].members.length,3);
  // Pending plans written by the old comma-picker must resume without repeating already-completed speakers.
  const saved = (await data('groups'))[0], now = Date.now();
  const oldTurn = {id:'legacy-partial-turn',role:'user',kind:'text',content:'大家接着说',sessionId:legacy.id,createdAt:now,metadata:{groupPlan:['old-combined']}};
  const oldResponse = { ...message('吴邪：我先说一句。',combined,{replyToUserId:oldTurn.id,groupMemberId:'old-combined'}), id:'legacy-partial-reply',createdAt:now+1 };
  await data('addMessage',oldTurn);await data('addMessage',oldResponse);
  await page.reload();await ready();
  const before=calls.length;
  await page.locator(`[data-message-id="${oldTurn.id}"] .bubble`).dispatchEvent('contextmenu');await page.click(`[data-retry-id="${oldTurn.id}"]`);await page.waitForFunction(()=>!document.querySelector('#send').disabled);
  assert.deepEqual(calls.slice(before).map(c=>c.name).sort(),['张起灵','王胖子'].sort());
  assert.equal((await allMessages()).filter(m=>m.metadata?.replyToUserId===oldTurn.id&&m.speakerId==='吴邪').length,0);
  assert.ok((await allMessages()).some(m=>m.id==='legacy-partial-reply'));
  assert.deepEqual((await data('groups'))[0],saved);
  check('legacy unfinished plan expands to real members and resumes without repeating identifiable completed speaker');
  assert.deepEqual(errors,[]);check('editing old group saves three real contacts, same group/history IDs; no uncaught browser errors');
  await writeFile(new URL('test-results.json',folder),JSON.stringify({checks,requests:calls.length,errors,provider:'synthetic DS-shaped SSE and JSON; real DS not tested'},null,2));
  console.log(`group identity: ${checks.length} checks passed; ${calls.length} synthetic requests`);
} finally {await context.close();await browser.close();}
