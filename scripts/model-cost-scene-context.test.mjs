// Isolated Chrome + real IndexedDB. All model responses below are synthetic test fixtures.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const origin = process.env.MODEL_COST_TEST_URL || 'http://127.0.0.1:4192';
const folder = new URL('../.local-review/cost-scene-20261107/tests/', import.meta.url);
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
await context.addInitScript(() => {
  for (const key of ['auto-moments','auto-diary','proactive-enabled']) localStorage.setItem(`xiaozhang-${key}`, 'false');
  localStorage.setItem('xiaozhang-pet-position', JSON.stringify({ x: 4, y: 420 }));
});
const serveModule = async route => {
  const name = new URL(route.request().url()).pathname.match(/\/([\w-]+)\.js$/)?.[1];
  if (!name || name === 'main') return route.abort();
  const source = await readFile(new URL(`../src/${name}.ts`, import.meta.url), 'utf8');
  const body = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/from "\.\/([^".]+)"/g, 'from "./$1.js"');
  await route.fulfill({ contentType: 'text/javascript', body });
};
await context.route('**/__cost/*.js', serveModule);
const calls = [], errors = [], checks = [];
let transport = 'json', failSummary = 0, holdSummary = false, releaseSummary;
await context.route('https://cost-test.invalid/**', async route => {
  const body = route.request().postDataJSON();
  const native = !!body.contents;
  const system = native ? body.systemInstruction.parts[0].text : body.messages[0].content;
  const input = native ? body.contents.at(-1).parts[0].text : body.messages.at(-1).content;
  const summary = system.startsWith('暂停角色扮演。');
  calls.push({ body, summary, input });
  if (summary && holdSummary) { holdSummary = false; await new Promise(resolve => { releaseSummary = resolve; }); }
  if (summary && failSummary && --failSummary === 0) return route.fulfill({ status: 503, body: 'test unavailable' });
  const markers = [...new Set(input.match(/MARKER_\d+/g) || [])];
  const reply = summary ? `<abstract>\n ✦ 大总结 999 ✦\n总结范围：Scene_NO.999～Scene_NO.999\n｜未明确｜旧书店｜\n${markers.join(' ')} 用户与角色在场，后续约定尚未完成。\n</abstract>` : '他将书收好，看向你，等你继续。';
  const usage = { prompt_tokens: 321, completion_tokens: 23, total_tokens: 344, prompt_tokens_details: { cached_tokens: 100 }, completion_tokens_details: { reasoning_tokens: 5 } };
  if (native) {
    const text = { candidates: [{ content: { parts: [{ text: reply }] } }] };
    const metering = { usageMetadata: { promptTokenCount: 222, candidatesTokenCount: 18, cachedContentTokenCount: 77, thoughtsTokenCount: 4, totalTokenCount: 244 } };
    if (transport === 'stream') return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify(text)}\n\ndata: ${JSON.stringify(metering)}\n\n` });
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...text, ...metering }) });
  }
  if (transport === 'stream') return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\ndata: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n` });
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: reply } }], ...(transport === 'no-usage' ? {} : { usage }) }) });
});
const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
const ready = p => p.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
const pass = name => { checks.push(name); console.log('PASS', name); };
const data = (method, ...args) => page.evaluate(async ({ method, args }) => (await import('/__cost/storage.js')).storage[method](...args), { method, args });
const feature = async id => { await page.locator('#topbar-menu-toggle').click(); await page.click(id); };
const close = id => page.locator(id).evaluate(el => el.close());
const openPanel = async () => {
  await page.locator('#life-state-card .scene-context-launch').click();
  await page.waitForSelector('#scene-context-dialog[open]');
};
const idle = () => page.waitForFunction(() => !document.querySelector('#life-send').disabled);
const sendLife = async text => {
  const response = page.waitForResponse(r => r.url().startsWith('https://cost-test.invalid/'));
  await page.fill('#life-draft',text); await page.click('#life-send'); await response; await idle();
};
try {
  await page.goto(origin); await ready(page);
  await page.evaluate(async () => {
    window.st = (await import('/__cost/storage.js')).storage;
    window.sc = await import('/__cost/scene-context.js'); window.sd = await import('/__cost/scene-context-data.js');
    window.mp = await import('/__cost/model-preferences.js'); window.mu = await import('/__cost/model-usage.js'); window.ca = await import('/__cost/api.js');
    window.profile = { baseUrl: 'https://cost-test.invalid/v1', model: 'synthetic', apiKey: 'SYNTHETIC_SECRET', temperature: .7, protocol: 'openai' };
    window.scope = { kind: 'life', characterId: 'zhang-qiling' };
    window.row = (n, content = `MARKER_${n} 用户与角色约好去书店。`) => ({ id: `cost-row-${n}`, role: n % 2 ? 'assistant' : 'user', content, kind: 'text', createdAt: 1000 + n, sessionId: 'life' });
  });
  let result = await page.evaluate(() => {
    const preferences = mp.validModelPreferences({ privateHistory: -1, sceneHistory: 1e9, privateOutput: NaN, sceneOutput: 800, summaryMinutes: 200, pauseBackground: true, requestUsage: 'yes' });
    const badUsage = mu.usageCounts({ usage: { prompt_tokens: -1, completion_tokens: '12', total_tokens: Infinity } });
    const raw = '前'.repeat(12000) + '😀𠮷中文\n'.repeat(1200) + '尾巴';
    const r = row(1, raw), batches = sc.summaryBatches([r], [r]);
    const restored = batches.join('').replace(/\n\[Scene_NO\.1 \| [^\n]+\]\n/g, '');
    const state = sd.emptySceneContext(); state.excludedIds = ['cost-row-2'];
    const plan = sc.summaryPlan([row(1), row(2), row(3)], state);
    return { preferences, badUsage, exact: restored === raw, batches: batches.length, pending: plan.pending.map(r => r.id), scopes: ['life','life:wu-xie','group-life:g','date:wu-xie:d','group-date:g:d','theatre:t','fieldwork:f'].every(sd.validSceneScope), rejects: ['../private','private','date:a','life:a:b'].every(s => !sd.validSceneScope(s)) };
  });
  assert.equal(result.preferences.privateHistory, 800); assert.equal(result.preferences.sceneHistory, 24000); assert.equal(result.preferences.privateOutput, 2048); assert.equal(result.preferences.summaryMinutes, 120); assert.equal(result.preferences.requestUsage, false);
  assert.equal(result.badUsage, undefined); assert(result.exact && result.batches > 2 && result.scopes && result.rejects); assert.deepEqual(result.pending, ['cost-row-1','cost-row-3']);
  pass('预算边界、拒绝伪造实际用量、归属校验、跨批次 Unicode 全文无截断');

  for (const protocol of ['openai','gemini']) for (const mode of ['json','stream','no-usage']) {
    if (protocol === 'gemini' && mode === 'no-usage') continue;
    transport = mode;
    result = await page.evaluate(async protocol => {
      await ca.chat({ ...profile, protocol }, '角色设定\n摘要内容\n记忆内容', Array.from({ length: 20 }, (_,i) => row(i, `历史${i}`)), '本轮输入', () => {}, undefined, { purpose: 'scene', historyLimit: 16, contextParts: { rules: '角色设定', summary: '摘要内容', memories: '记忆内容' } });
      return mu.usageRecords().at(-1);
    }, protocol);
    assert.equal(result.historyCount, 16); assert.equal(result.outputLimit, 3072); assert.equal(result.status, 'success'); assert(result.breakdown.rules && result.breakdown.history && result.breakdown.summary && result.breakdown.memories && result.breakdown.current);
    if (mode === 'no-usage') assert.equal(result.actual, undefined); else assert.equal(result.actual.input, protocol === 'gemini' ? 222 : 321);
    if (protocol === 'openai') assert.equal(calls.at(-1).body.stream_options, undefined);
  }
  transport = 'json';
  await page.evaluate(async () => { mp.saveModelPreferences({ ...mp.modelPreferences(), requestUsage: true, privateOutput: 700 }); await ca.chat(profile,'设定',[],'你好',()=>{},undefined,{purpose:'private'}); });
  assert.equal(calls.at(-1).body.stream_options.include_usage, true); assert.equal(calls.at(-1).body.max_tokens, 700);
  assert(!(await page.evaluate(() => localStorage.getItem('xiaozhang-model-usage'))).includes('SYNTHETIC_SECRET'));
  await page.evaluate(() => mp.saveModelPreferences(mp.defaultModelPreferences));
  assert.equal(await page.locator('#model-cost-controls').getAttribute('open'), null); assert.equal(await page.locator('#settings-dialog').getAttribute('open'), null);
  pass('OpenAI／Gemini JSON 与流式 usage、仅用量分片、实际发送历史一致、可选参数默认关闭、无密钥／自动弹窗');

  await data('saveProfile', await page.evaluate(() => profile));
  await page.evaluate(async () => {
    for (let i=1;i<=6;i++) await st.addMessage(row(i));
    await st.saveContinuousLife({ id:'continuous-life', active:true, location:'旧书店', timeLabel:'傍晚', environment:'小雨', activity:'MARKER_6', updatedAt:Date.now() });
    await st.saveDateSession({ id:'cost-date', characterId:'zhang-qiling', scene:'custom', title:'旧街', setting:'独立约会', atmosphere:'安静', active:true, createdAt:Date.now(), updatedAt:Date.now(), messages:[row(90),row(91)] });
  });
  await page.reload(); await ready(page);
  await feature('#meet-open'); await openPanel();
  const before = calls.length;
  await page.fill('#scene-context-from','5'); await page.fill('#scene-context-to','6'); await page.click('#scene-context-exclude');
  await page.waitForFunction(() => document.querySelector('#scene-context-info').textContent.includes('2 层原文不发送'));
  assert.equal(calls.length, before);
  await close('#scene-context-dialog');
  assert.equal(await page.locator('#life-messages [data-context-excluded="true"]').count(),2);
  assert.match(await page.locator('#life-messages').innerText(),/MARKER_6/);
  const continuationResponse=page.waitForResponse(r=>r.url().startsWith('https://cost-test.invalid/'));
  await page.click('#meet-dialog .scene-action-menu > summary');await page.click('#meet-dialog [data-scene-action="continue"]');await continuationResponse;await idle();
  assert.doesNotMatch(JSON.stringify(calls.at(-1).body),/MARKER_[56]/);
  assert((await data('sceneFloors',{kind:'life',characterId:'zhang-qiling'})).some(r=>r.id==='cost-row-6'),'续写追加楼层，保留不发送的原楼层');
  await sendLife('接着看书。');
  assert.doesNotMatch(JSON.stringify(calls.at(-1).body),/MARKER_[56]/);
  assert.match(JSON.stringify(calls.at(-1).body),/MARKER_4/);
  await openPanel(); await page.click('#scene-context-restore'); await page.waitForFunction(() => document.querySelector('#scene-context-info').textContent.includes('0 层原文不发送'));
  await close('#scene-context-dialog');
  await sendLife('回头看一眼。');
  assert.match(JSON.stringify(calls.at(-1).body),/MARKER_6/);
  await close('#meet-dialog'); await page.reload(); await ready(page);
  await feature('#meet-open'); await openPanel();
  await page.fill('#scene-context-from','1'); await page.fill('#scene-context-to','2'); await page.click('#scene-context-exclude');
  await page.waitForFunction(() => document.querySelector('#scene-context-info').textContent.includes('2 层原文不发送'));
  await close('#scene-context-dialog'); await close('#meet-dialog');
  pass('真实线下入口：指定楼层仍可读、不进下一请求；恢复后重新发送，刷新保留范围');

  await page.evaluate(async () => {
    window.st = (await import('/__cost/storage.js')).storage; window.sc = await import('/__cost/scene-context.js'); window.sd = await import('/__cost/scene-context-data.js'); window.mp = await import('/__cost/model-preferences.js'); window.mu = await import('/__cost/model-usage.js');
    window.profile = await st.profile(); window.scope = {kind:'life',characterId:'zhang-qiling'};
    for (const r of await st.sceneFloors(scope)) await st.deleteMessage(r.id);
    const make = n => ({id:`full-${n}`,role:n%2?'assistant':'user',kind:'text',content:`MARKER_${n} `+'剧情中文😀'.repeat(1200),createdAt:1000+n,sessionId:'life'});
    for(let n=1;n<=4;n++)await st.addMessage(make(n));
    const state=await st.sceneContext('life');await st.saveSceneContext('life',{...state,excludedIds:[]},state.revision);
  });
  failSummary = 2;
  result = await page.evaluate(async () => {
    try { await sc.summarizeScene(scope,profile,new AbortController().signal,()=>{}); } catch(e) { return {error:e.message,state:await st.sceneContext('life')}; }
  });
  assert.match(result.error,/503/); assert.equal(result.state.draft.processed,1); assert.equal(result.state.abstracts.length,0);
  const doneBefore = calls.filter(c=>c.summary).length;
  result = await page.evaluate(async () => { const value=await sc.summarizeScene(scope,profile,new AbortController().signal,()=>{});return {value,state:await st.sceneContext('life')}; });
  assert(result.value.text.includes('MARKER_1') && result.value.text.includes('MARKER_4')); assert.match(result.value.text,/大总结 1/);assert.match(result.value.text,/Scene_NO.1～Scene_NO.4/); assert.equal(result.state.draft,undefined);
  assert(calls.filter(c=>c.summary).length > doneBefore);
  const noNewBefore = calls.length;
  await page.evaluate(() => sc.summarizeScene(scope,profile,new AbortController().signal,()=>{})); assert.equal(calls.length,noNewBefore);
  await page.evaluate(async () => { await st.addMessage({id:'full-5',role:'user',kind:'text',content:'MARKER_5 新增约定',createdAt:9999,sessionId:'life'});await sc.summarizeScene(scope,profile,new AbortController().signal,()=>{}); });
  assert.match(calls.at(-1).input,/MARKER_1/);assert.match(calls.at(-1).input,/MARKER_5/);
  result = await data('sceneContext','life'); assert.equal(result.abstracts.length,2);assert.equal(result.abstracts[1].number,2);assert.equal(result.abstracts[0].enabled,false);
  result = await page.evaluate(async () => { const state=await st.sceneContext('life');await st.saveSceneContext('life',{...state,excludedIds:['full-1','full-2','full-3','full-4']},state.revision);const selected=await sc.sceneModelContext('life',await st.sceneFloors(scope));return {ids:selected.rows.map(r=>r.id),summary:selected.summary}; });
  assert.deepEqual(result.ids,['full-5']);assert.match(result.summary,/MARKER_1/);
  assert.equal((await data('sceneContext','date:zhang-qiling:cost-date')).abstracts.length,0);
  pass('手动全文跨批完整处理、503保留进度并续做、无新增零请求、累计合并、总结与原文分别控制、场次隔离');

  // Source edits invalidate the summary without deleting the user's saved text.
  result = await page.evaluate(async () => { const rows=await st.sceneFloors(scope),edited={...rows[0],content:'修改后的原文'};await st.addMessage(edited);const selected=await sc.sceneModelContext('life',await st.sceneFloors(scope));return {summary:selected.summary,count:selected.state.abstracts.length}; });
  assert.equal(result.summary,'');assert.equal(result.count,2);
  const state = await data('sceneContext','life');
  await assert.rejects(data('saveSceneContext','life',state,state.revision-1),/其他页面/);
  const lease = await data('claimContextLease','manual:life',1800000); assert(lease);
  const blockedBefore=calls.length;
  result=await page.evaluate(async()=>{try{await sc.summarizeScene(scope,profile,new AbortController().signal,()=>{});}catch(e){return e.message;}});
  assert.match(result,/另一页面/);assert.equal(calls.length,blockedBefore);await data('releaseContextLease','manual:life',lease);
  pass('来源编辑停用过期总结、并发设置冲突保护、跨页面总结锁避免重复付费');

  // Cancelled operations preserve drafts; a live second tab cannot duplicate the batch.
  holdSummary=true;releaseSummary=undefined;
  const pending=page.evaluate(async()=>{window.abortSummary=new AbortController();try{await sc.summarizeScene(scope,profile,abortSummary.signal,()=>{});}catch(e){return e.message;}});
  for(let i=0;i<100&&!releaseSummary;i++)await new Promise(r=>setTimeout(r,20));assert(releaseSummary);
  await page.evaluate(()=>abortSummary.abort());releaseSummary();await pending;
  assert.equal((await data('sceneContext','life')).abstracts.length,2);
  const retry=await data('claimContextLease','manual:life',1800000);assert(retry);await data('releaseContextLease','manual:life',retry);
  pass('取消总结保留旧正文并释放锁，后续手动操作可继续');

  const backup=await data('sceneContextsBackup');assert(backup.some(r=>r.scope==='life'&&r.state.abstracts.length===2));
  const checkpoint=await data('makeArchive','总结节点','checkpoint');const portable=await data('exportArchive',checkpoint.id);
  assert(portable.rows.kv.some(r=>r.key==='scene-notes:life'));assert(!JSON.stringify(portable).includes('SYNTHETIC_SECRET'));
  const imported=await data('importArchive',portable);assert(imported.id);
  const fresh=await data('makeArchive','空白关系','fresh');const clean=await data('exportArchive',fresh.id);assert(!clean.rows.kv.some(r=>r.key.startsWith('scene-notes:')));
  const saved=await data('sceneContext','life');await data('importSceneContexts',[{scope:'life',state:{...saved,excludedIds:[]}}]);assert.deepEqual((await data('sceneContext','life')).excludedIds,saved.excludedIds);
  await assert.rejects(data('importSceneContexts',[{scope:'private',state:saved}]),/无效/);
  await feature('#settings');const downloadPromise=page.waitForEvent('download');await page.click('#export-data');const download=await downloadPromise;
  const full=JSON.parse(await readFile(await download.path(),'utf8'));assert(full.sceneContexts.some(r=>r.scope==='life'));assert(!JSON.stringify(full).includes('SYNTHETIC_SECRET'));
  const restoredContext=await browser.newContext({serviceWorkers:'block'});await restoredContext.route('**/__cost/*.js',serveModule);
  const restoredPage=await restoredContext.newPage();await restoredPage.goto(origin);await ready(restoredPage);
  await restoredPage.locator('#settings').evaluate(el=>el.click());
  await restoredPage.setInputFiles('#import-data',{name:'scene-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(full))});
  await restoredPage.waitForFunction(async()=>{const {storage}=await import('/__cost/storage.js');return (await storage.dateSessions()).some(r=>r.id==='cost-date')&&(await storage.sceneFloors({kind:'life',characterId:'zhang-qiling'})).some(r=>r.id==='full-5');});
  const restoredState=await restoredPage.evaluate(async()=>(await import('/__cost/storage.js')).storage.sceneContext('life'));
  assert.deepEqual(restoredState,JSON.parse(JSON.stringify(saved)));await restoredContext.close();
  assert.equal(await page.locator('#model-cost-controls').getAttribute('open'),null);
  await page.click('#model-cost-controls > summary');await page.locator('#model-usage-list details').first().click();
  assert.match(await page.locator('#model-usage-list').innerText(),/本地输入估算/);assert.match(await page.locator('#model-usage-list').innerText(),/服务商返回/);assert.match(await page.locator('#model-usage-list').innerText(),/%/);
  for(const width of [320,390,1280])for(const theme of ['ink','warm','night','rococo','bronze']){
    await page.setViewportSize({width,height:width===320?568:844});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    assert(await page.locator('#model-cost-controls').evaluate(el=>el.scrollWidth<=el.clientWidth+2),`usage ${width} ${theme}`);
  }
  await page.screenshot({path:fileURLToPath(new URL('usage-desktop-bronze.png',folder))});
  await close('#settings-dialog');await feature('#meet-open');await openPanel();
  for(const width of [320,390,1280])for(const theme of ['ink','warm','night','rococo','bronze']){
    await page.setViewportSize({width,height:width===320?568:844});await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
    assert(await page.locator('#scene-context-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth+2),`scene ${width} ${theme}`);
  }
  await page.setViewportSize({width:390,height:844});await page.locator('#scene-context-dialog').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:fileURLToPath(new URL('scene-mobile-bronze.png',folder))});
  await page.evaluate(()=>document.documentElement.dataset.theme='rococo');await page.screenshot({path:fileURLToPath(new URL('scene-mobile-rococo.png',folder))});
  await close('#scene-context-dialog');await close('#meet-dialog');
  await feature('#date-open');await page.click('#script-tab-runs');await page.click('[data-run-resume="cost-date"]');
  await page.locator('#date-state-card .scene-context-launch').click();await page.waitForSelector('#scene-context-dialog[open]');
  assert.match(await page.locator('#scene-context-info').innerText(),/2 层；0 层原文不发送/);
  assert.match(await page.locator('#scene-summary-list').innerText(),/还没有手动大总结/);
  await close('#scene-context-dialog');await close('#date-dialog');
  await page.evaluate(async()=>{
    await st.saveMemory({id:'hidden-source-memory',content:'DO_NOT_SEND_SOURCE_MEMORY',source:'conversation',sourceMessageIds:['full-2'],category:'事实',enabled:true,createdAt:Date.now(),updatedAt:Date.now()});
    await st.addMessage({id:'hidden-source-meeting',role:'assistant',kind:'event',content:'DO_NOT_SEND_OLD_MEETING',metadata:{event:'life_meeting_summary'},createdAt:Date.now(),sessionId:'private'});
  });
  const privateResponse=page.waitForResponse(r=>r.url().startsWith('https://cost-test.invalid/'));
  await page.fill('#draft','记得我们刚才说的事吗？');await page.click('#send');await privateResponse;await page.waitForFunction(()=>!document.querySelector('#send').disabled);
  assert.doesNotMatch(JSON.stringify(calls.at(-1).body),/DO_NOT_SEND_SOURCE_MEMORY|DO_NOT_SEND_OLD_MEETING/);
  assert.deepEqual(errors,[]);
  pass('完整备份在空浏览器恢复总结／范围、关系节点与空白档隔离、不导出Key、五主题三屏宽、约会独立入口、私聊无来源旁路');

  // Exercise the real scene narrator with group, old date and single/multi performance scopes.
  await page.evaluate(async()=>{
    const {GroupScenes}=await import('/__cost/group-scenes.js');
    window.gs=new GroupScenes({render(){},status(){},savedInput(){},async available(){}});
    const now=Date.now();
    window.costGroup={id:'cost-group',title:'书店同行',members:[{id:'wu-xie',characterId:'wu-xie',name:'吴邪',persona:'细致',enabled:true},{id:'wang-pangzi',characterId:'wang-pangzi',name:'王胖子',persona:'爽快',enabled:true}],background:'只用本群背景',memories:[{id:'gm',content:'HIDDEN_GROUP_MEMORY',messageIds:['group-hidden'],enabled:true,source:'user',createdAt:now,updatedAt:now}],createdAt:now,updatedAt:now};
    await st.saveGroup(costGroup);
    const messages=[{id:'group-hidden',role:'assistant',kind:'text',content:'HIDDEN_GROUP_ORIGINAL',createdAt:now},{id:'group-kept',role:'user',kind:'text',content:'MARKER_88 大家接着看纸条',createdAt:now+1}];
    await st.saveGroupScene({id:'cost-group-life',groupId:costGroup.id,memberIds:costGroup.members.map(r=>r.id),location:'书店',timeLabel:'傍晚',environment:'小雨',activity:'HIDDEN_GROUP_ACTIVITY',active:true,messages,updatedAt:now});
    await st.addMessage({id:'group-old-excerpt',role:'assistant',kind:'event',content:'HIDDEN_GROUP_EXCERPT',metadata:{event:'group_life_summary'},sessionId:costGroup.id,createdAt:now});
  });
  for(const mode of ['life','date','single','multi']){
    const groupScope=await page.evaluate(async mode=>{
      const messages=[{id:'group-hidden',role:'assistant',kind:'text',content:'HIDDEN_GROUP_ORIGINAL',createdAt:1},{id:'group-kept',role:'user',kind:'text',content:'MARKER_88 大家接着看纸条',createdAt:2}];
      let scope;
      if(mode==='life'){await gs.prepare('life',costGroup.id);scope={kind:'group-life',groupId:costGroup.id};}
      else{
        const now=Date.now(),id=`cost-${mode}`;
        const script=mode==='date'?undefined:{id:`script-${mode}`,revision:1,title:'独立剧本',scene:'custom',setting:'只读本场',atmosphere:'安静',arrangement:'同行者',userName:'我',mode,characterIds:mode==='single'?['wu-xie']:['wu-xie','wang-pangzi'],createdAt:now,updatedAt:now};
        await st.saveDateSession({id,groupId:mode==='date'?costGroup.id:undefined,characterId:mode==='single'?'wu-xie':undefined,memberIds:mode==='date'?costGroup.members.map(r=>r.id):undefined,scriptSnapshot:script,scene:'custom',title:`本场 ${mode}`,setting:'只用本场剧情',atmosphere:'安静',active:true,messages,createdAt:now,updatedAt:now});
        if(script){await gs.prepareTheatre(id);scope={kind:'theatre',id};}else{await gs.prepare('date',costGroup.id,id);scope={kind:'group-date',groupId:costGroup.id,id};}
      }
      const key=sc.sceneScopeKey(scope),state=await st.sceneContext(key);await st.saveSceneContext(key,{...state,excludedIds:['group-hidden']},state.revision);
      await sc.summarizeScene(scope,profile,new AbortController().signal,()=>{});
      await gs.action(mode==='life'?'life':'date','continue');
      return scope;
    },mode);
    assert.doesNotMatch(JSON.stringify(calls.at(-1).body),/HIDDEN_GROUP_/);
    assert.match(JSON.stringify(calls.at(-1).body),/本场大总结/);
    assert.match(JSON.stringify(calls.at(-1).body),/MARKER_88/);
    assert((await data('sceneContext',await page.evaluate(scope=>sc.sceneScopeKey(scope),groupScope))).abstracts.length===1);
  }
  await feature('#date-open');await page.click('#script-tab-runs');await page.click('[data-run-resume="cost-multi"]');
  await page.locator('#date-state-card .scene-context-launch').click();await page.waitForSelector('#scene-context-dialog[open]');
  assert.match(await page.locator('#scene-summary-list').innerText(),/大总结 1/);
  assert.match(await page.locator('#scene-context-info').innerText(),/1 层原文不发送/);
  holdSummary=true;releaseSummary=undefined;
  await page.click('#scene-summary-run');
  for(let i=0;i<100&&!releaseSummary;i++)await new Promise(r=>setTimeout(r,20));assert(releaseSummary);
  assert(await page.locator('#scene-context-dialog [data-scene-context-close]').isDisabled());assert(await page.locator('#scene-summary-stop').isVisible());
  releaseSummary();
  await page.waitForFunction(()=>document.querySelector('#scene-context-status').textContent.includes('全文总结已保存')&&!document.querySelector('#scene-summary-run').disabled);
  assert.match(await page.locator('#scene-summary-list').innerText(),/大总结 2/);
  const noNewUICalls=calls.length;await page.click('#scene-summary-run');
  await page.waitForFunction(()=>document.querySelector('#scene-context-status').textContent.includes('本次未请求模型'));
  assert.equal(calls.length,noNewUICalls);
  const offlineCalls=calls.length;
  await context.setOffline(true);await close('#scene-context-dialog');
  await page.locator('#date-state-card .scene-context-launch').click();await page.waitForSelector('#scene-context-dialog[open]');
  assert.match(await page.locator('#scene-summary-list').innerText(),/大总结 1/);assert.equal(calls.length,offlineCalls);
  await context.setOffline(false);
  assert.deepEqual(errors,[]);
  pass('群线下／旧群约会／单人及多人剧本：独立手动总结进下一次真实请求，排除来源记忆／旧摘录／活动旁路，剧本夹入口可读');
  await writeFile(new URL('results.json',folder),JSON.stringify({passed:checks.length,checks,requests:calls.length,paidRequests:0,physicalAndroid:false},null,2));
} finally { await browser.close(); }
console.log(`model-cost-scene-context: ${checks.length} checks passed`);
