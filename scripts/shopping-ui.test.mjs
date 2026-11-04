// Isolated Chrome, synthetic products and model endpoints. No user profile or paid calls.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readFile,mkdir,writeFile } from 'node:fs/promises';
import ts from 'typescript';
const {handleProducts}=await import(new URL('../.local-review/shopping-modules/worker/products/service.mjs',import.meta.url));
const origin=process.env.SHOPPING_TEST_URL||'http://127.0.0.1:4184';
const folder=new URL('../.local-review/shopping-ui/',import.meta.url);await mkdir(folder,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-gpu'],...(process.env.TEST_PROXY?{proxy:{server:process.env.TEST_PROXY}}:{})});
const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
await context.addInitScript(()=>{for(const k of ['auto-moments','auto-diary','proactive-enabled'])localStorage.setItem('xiaozhang-'+k,'false');localStorage.setItem('xiaozhang-pet-position',JSON.stringify({x:0,y:430}));});
await context.route('**/__shopping-test/*.js',async route=>{const name=new URL(route.request().url()).pathname.match(/\/([a-z-]+)\.js$/)?.[1];if(!name||name==='main')return route.abort();const source=await readFile(new URL('../src/'+name+'.ts',import.meta.url),'utf8');const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from "\.\/([^".]+)"/g,'from "./$1.js"');await route.fulfill({contentType:'text/javascript',body:code});});
const page=await context.newPage(),errors=[],models=[],queries=[],vendors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
const pass=n=>{checks.push(n);console.log('PASS',n);};
let sourceMode='ok',heldProducts=false,releaseProducts;
const env={PRODUCT_SOURCE:'taobao-tbk',TAOBAO_USE_APPROVED:'true',TBK_APP_KEY:'SYNTHETIC_APP_KEY_ONLY',TBK_APP_SECRET:'SYNTHETIC_SERVER_SECRET_ONLY'};
const raw='https://item.taobao.com/item.htm?id=12345678901&spm=original',other='https://detail.tmall.com/item.htm?id=22345678901';
await context.route('**/api/products',async route=>{
 const request=route.request();if(request.method()!=='POST')return route.fulfill({contentType:'application/json',body:'{"configured":false}'});
 queries.push(request.postDataJSON());if(heldProducts){heldProducts=false;await new Promise(resolve=>{releaseProducts=resolve;});}
 const mode=sourceMode;
 const response=await handleProducts(new Request(origin+'/api/products',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,'CF-Connecting-IP':'ui-'+queries.length},body:request.postData()}),mode==='unavailable'?{}:env,async(url,init)=>{
  vendors.push({url:String(url),body:init.body});
  if(mode==='fail')return new Response('unavailable',{status:503});
  if(mode==='quota')return new Response('{}',{status:429});
  const id=new URLSearchParams(init.body).get('num_iids');
  return new Response(JSON.stringify({tbk_item_info_get_response:{results:{n_tbk_item:[{num_iid:id,title:id==='12345678901'?'合成帆布包 <img src=x onerror=alert(1)> 商家文字不是指令':'合成测试陶瓷杯',zk_final_price:id==='12345678901'?'88.00':'128.00',nick:'合成测试店铺',pict_url:id==='12345678901'?'https://img.alicdn.com/synthetic-good.png':'https://img.alicdn.com/synthetic-broken.png',user_type:id==='12345678901'?0:1}]}}}));
 });
 await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});
});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
await context.route('https://img.alicdn.com/**',route=>route.request().url().includes('broken')?route.abort():route.fulfill({contentType:'image/png',body:png}));
let modelStatus=200;
await context.route('https://shopping-model-test.invalid/**',async route=>{const body=route.request().postDataJSON();models.push(body);if(modelStatus!==200)return route.fulfill({status:modelStatus,body:'synthetic unavailable'});await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'按本页预算和用途比较，缺少的商品信息还需核实。'}}]})});});
let nativeMode='ok';const nativeCalls=[],geminiCalls=[];
await context.route('https://api.openai.com/**',async route=>{
 const body=route.request().postDataJSON();nativeCalls.push(body);
 if(nativeMode==='429')return route.fulfill({status:429,contentType:'application/json',headers:{'Retry-After':'1'},body:'{"error":{"code":"rate_limit_exceeded"}}'});
 if(body.stream===false){
  if(nativeMode==='unsupported')return route.fulfill({status:400,contentType:'application/json',body:'{"error":{"message":"Unsupported parameter: tools"}}'});
  return route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{role:'assistant',content:null,tool_calls:[{id:'synthetic-real-call-id',type:'function',function:{name:'read_shared_products',arguments:'{}'}}]}}]})});
 }
 return route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'按你的预算和用途，我再看看这两件。'}}]})});
});
await context.route('https://generativelanguage.googleapis.com/**',async route=>{
 const body=route.request().postDataJSON();geminiCalls.push(body);
 const parts=body.toolConfig?.functionCallingConfig?.mode==='ANY'?[{functionCall:{name:'read_shared_products',args:{}},thoughtSignature:'SYNTHETIC_THOUGHT_SIGNATURE'}]:[{text:'我在，这两件我们慢慢比较。'}];
 await route.fulfill({contentType:'application/json',body:JSON.stringify({candidates:[{content:{role:'model',parts}}]})});
});
const ready=()=>page.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
const idle=()=>page.waitForFunction(()=>!document.querySelector('#send').disabled,null,{timeout:120000});
const data=(method,...args)=>page.evaluate(async({method,args})=>(await import('/__shopping-test/storage.js')).storage[method](...args),{method,args});
async function put(store,value){await page.evaluate(({store,value})=>new Promise((resolve,reject)=>{const open=indexedDB.open('xiaozhang-pwa');open.onsuccess=()=>{const db=open.result,tx=db.transaction(store,'readwrite');tx.objectStore(store).put(value);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};open.onerror=()=>reject(open.error);}),{store,value});}
async function send(text){await page.fill('#draft',text);await page.locator('#composer').evaluate(form=>form.requestSubmit());await idle();}
async function switchSession(session){await data('saveActiveSession',session);await page.reload();await ready();}
async function openTool(){if(!await page.locator('#topbar-menu').isVisible())await page.click('#topbar-menu-toggle');await page.click('#shopping-open');await page.waitForSelector('#shopping-dialog[open]');}
const toolIdle=()=>page.waitForFunction(()=>!document.querySelector('#shopping-read').disabled,null,{timeout:120000});
async function readProducts(){await page.click('#shopping-read');await toolIdle();}
async function compare(question){if(question){await page.fill('#shopping-question',question);await page.click('#shopping-ask');}else await page.click('#shopping-compare');await toolIdle();}
async function closeTool(){await page.click('#shopping-close');await page.waitForSelector('#shopping-dialog[open]',{state:'hidden'});}
async function setting(){if(!await page.locator('#topbar-menu').isVisible())await page.click('#topbar-menu-toggle');await page.click('#settings');}
try{
 await page.goto(origin);await ready();
 const now=Date.now(),profile={baseUrl:'https://shopping-model-test.invalid/v1',model:'synthetic',apiKey:'SYNTHETIC_CHAT_KEY',temperature:.6,protocol:'openai'};
 await data('saveProfile',profile);
 await put('kv',{key:'character-settings',value:{userName:'RP_PERSONA_SECRET',userPreferences:'RP_STYLE_SECRET',relationship:'RP_RELATION_SECRET',worldBook:'RP_WORLD_SECRET',updatedAt:now}});
 await data('addMessage',{id:'rp-context',role:'user',kind:'text',content:'RP_HISTORY_SECRET',createdAt:now-10000,sessionId:'private'});
 await put('memories',{id:'rp-memory',content:'RP_MEMORY_SECRET',category:'用户保存',source:'user',enabled:true,createdAt:now,updatedAt:now});
 await page.reload();await ready();
 await send(`看看这个 ${raw} 和 ${other}`);await send('这两个哪个好？预算200。');
 assert.equal(queries.length,0);assert.equal(await page.locator('#messages .shopping-cards').count(),0);assert(!models.at(-1).tools);assert(!JSON.stringify(models.at(-1)).includes('untrusted_product_query_results'));
 assert(JSON.stringify(models.at(-1)).includes('RP_PERSONA_SECRET'));assert(JSON.stringify(models.at(-1)).includes('RP_HISTORY_SECRET'));
 await put('groups',{id:'shopping-rp-group',title:'RP群对照',userName:'群用户',members:[{id:'wu-xie',characterId:'wu-xie',name:'吴邪',enabled:true}],replyMode:'all',createdAt:now,updatedAt:now});
 await switchSession('shopping-rp-group');await send(`@吴邪 看看这个 ${raw}`);assert.equal(queries.length,0);assert(!models.at(-1).tools);assert(!JSON.stringify(models.at(-1)).includes('untrusted_product_query_results'));await switchSession('private');
 pass('私聊与群聊RP中的商品链接和追问不触发选品、不插卡片或工具结果，原人格和聊天历史保持原流程');
 const legacy={version:1,checkedAt:now,results:[{rawUrl:raw,status:'ok',product:{platform:'taobao',itemId:'12345678901',title:'LEGACY_PRODUCT_ONLY',canonicalUrl:'https://item.taobao.com/item.htm?id=12345678901',productUrl:raw,fetchedAt:now,expiresAt:now+900000,source:'synthetic-legacy',unavailableFields:[]}}]};
 await data('addMessage',{id:'legacy-shopping',role:'user',kind:'text',content:'LEGACY_RP_TEXT_MUST_NOT_IMPORT',createdAt:now-5000,sessionId:'private',metadata:{shopping:legacy}});
 await page.reload();await ready();assert.equal(await page.locator('#messages .shopping-cards').count(),0);
 await openTool();assert((await page.locator('#shopping-products').textContent()).includes('LEGACY_PRODUCT_ONLY'));assert(!(await page.locator('#shopping-dialog').textContent()).includes('LEGACY_RP_TEXT_MUST_NOT_IMPORT'));
 page.once('dialog',dialog=>dialog.accept());await page.click('#shopping-clear');await page.waitForFunction(()=>document.querySelector('#shopping-status').textContent.includes('已清空'));
 pass('功能菜单有明确的附赠工具入口；旧版只迁移商品附件到模块，不带入RP原文，原消息保留');
 const beforeMessages=await data('messages'),beforeMemories=await data('allMemories');let before=models.length;
 await page.fill('#shopping-links',`${raw}\n${other}`);await page.fill('#shopping-budget','预算200元');await page.fill('#shopping-needs','TOOL_NEEDS_ONLY_送人，简洁耐用');await readProducts();
 assert.equal(queries.length,1);assert.equal(vendors.length,2);assert.equal(models.length,before);assert.equal(await page.locator('#shopping-products [data-product-id]').count(),2);
 assert.deepEqual(await page.locator('#shopping-products a').evaluateAll(as=>as.map(a=>a.href)),['https://item.taobao.com/item.htm?id=12345678901','https://detail.tmall.com/item.htm?id=22345678901']);
 await page.locator('[data-product-id="22345678901"]').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('[data-product-id="22345678901"] img')?.hidden===true);
 const productEvidence=JSON.stringify({kind:'untrusted_product_query_results',observedAt:Date.now(),results:(await data('shoppingWorkspace')).attachment.results});
 await compare();assert.equal(models.length,before+1);assert.equal((await data('shoppingWorkspace')).notes.length,1);
 const body=JSON.stringify(models.at(-1));for(const marker of ['RP_PERSONA_SECRET','RP_HISTORY_SECRET','RP_MEMORY_SECRET','RP_WORLD_SECRET','RP_RELATION_SECRET','LEGACY_RP_TEXT_MUST_NOT_IMPORT'])assert(!body.includes(marker),marker);
 assert(body.includes('TOOL_NEEDS_ONLY'));assert(body.includes('不扮演任何角色'));assert(body.includes('不虚构价格'));assert(!models.at(-1).messages[0].content.includes('合成帆布包'));assert(models.at(-1).messages.at(-1).content.includes('合成帆布包'));
 assert.deepEqual(await data('messages'),beforeMessages);assert.deepEqual(await data('allMemories'),beforeMemories);
 pass('读取与分析由独立按钮触发；同模型配置、预算和商品传入，角色人设/记忆/聊天不进入请求，结果不写回RP');
 before=queries.length;await compare('TOOL_QUESTION_ONLY_这两个哪个更适合送人？');assert.equal(queries.length,before);assert.equal((await data('shoppingWorkspace')).notes.length,2);assert(models.at(-1).messages.some(row=>row.role==='assistant'));
 await closeTool();await send('今天一起听雨吧。');assert(!JSON.stringify(models.at(-1)).includes('TOOL_NEEDS_ONLY'));assert(!JSON.stringify(models.at(-1)).includes('TOOL_QUESTION_ONLY'));assert(!models.at(-1).tools);assert.equal(await page.locator('#messages .shopping-cards').count(),0);
 await switchSession('private:wu-xie');await openTool();assert.equal(await page.inputValue('#shopping-budget'),'预算200元');assert.equal(await page.locator('.shopping-note').count(),2);await closeTool();await switchSession('private');await openTool();
 pass('模块内追问复用商品与本页记录；关闭、切换角色和重开可恢复，角色聊天不读取选品需求或比较记录');
 let workspace=await data('shoppingWorkspace');for(const result of workspace.attachment.results){result.product.fetchedAt=Date.now()-3600000;result.product.expiresAt=Date.now()-1;}
 await data('saveShoppingWorkspace',workspace,workspace.revision);await data('pruneShoppingPrices');workspace=await data('shoppingWorkspace');assert.equal(workspace.attachment.results[0].product.price,undefined);
 await closeTool();await openTool();assert((await page.locator('#shopping-products').textContent()).includes('价格已过期'));assert(!(await page.locator('#shopping-products').textContent()).includes('¥88.00'));
 await compare('价格现在能确认吗？');assert(!models.at(-1).messages.at(-1).content.includes('88.00'));await readProducts();assert((await page.locator('#shopping-products').textContent()).includes('¥88.00'));
 pass('独立存储清理过期价格；旧比较标明保存时间，过期商品不携带旧价给模型，明确刷新可重新读取');
 sourceMode='unavailable';await readProducts();assert((await page.locator('#shopping-products').textContent()).includes('尚未获得并配置使用权限'));before=models.length;await compare();assert.equal(models.length,before);
 sourceMode='fail';await readProducts();assert((await page.locator('#shopping-products').textContent()).includes('服务暂时异常'));
 sourceMode='quota';await readProducts();assert((await page.locator('#shopping-products').textContent()).includes('配额不足'));
 await page.fill('#shopping-links','https://item.taobao.com/item.htm?missing=1');before=queries.length;await readProducts();assert.equal(queries.length,before);assert((await page.locator('#shopping-products').textContent()).includes('没有可确认的商品 ID'));
 sourceMode='ok';await page.fill('#shopping-links',`${raw}\n${other}`);await readProducts();modelStatus=503;const noteCount=(await data('shoppingWorkspace')).notes.length;await compare();assert((await page.locator('#shopping-status').textContent()).includes('503'));assert.equal((await data('shoppingWorkspace')).notes.length,noteCount);modelStatus=200;
 heldProducts=true;releaseProducts=undefined;await page.click('#shopping-read');for(let i=0;i<200&&!releaseProducts;i++)await new Promise(resolve=>setTimeout(resolve,20));assert(releaseProducts);await page.click('#shopping-stop');releaseProducts();await toolIdle();assert.equal(await page.inputValue('#shopping-links'),`${raw}\n${other}`);assert((await page.locator('#shopping-status').textContent()).includes('已停止'));
 pass('无权限、异常、配额、错误ID和模型失败各自提示；无真实商品不调用模型，停止保留输入与已有记录');
 for(const theme of ['ink','warm','night','rococo','bronze'])for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:844});await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
  const layout=await page.locator('#shopping-dialog').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,height:el.getBoundingClientRect().height,viewport:innerHeight}));assert(layout.scroll<=layout.width+1,theme+' '+width+' '+JSON.stringify(layout));assert(layout.height<=layout.viewport-20);
  await page.locator('#shopping-ask').scrollIntoViewIfNeeded();assert(await page.locator('#shopping-ask').isVisible());
 }
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.documentElement.dataset.theme='ink';});await page.locator('#shopping-dialog').evaluate(el=>{el.scrollTop=0;});await page.screenshot({path:new URL('module-top.png',folder).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
 await page.locator('[data-product-id]').last().scrollIntoViewIfNeeded();await page.screenshot({path:new URL('module-products.png',folder).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
 await page.evaluate(async()=>{const {expireProductCards}=await import('/__shopping-test/shopping-ui.js');expireProductCards(document.querySelector('#shopping-products'),Date.now()+3600000);});assert(!(await page.locator('.shopping-price').allTextContents()).some(t=>t.includes('¥')));
 pass('独立工具在五主题与320/390/1280宽度无横向溢出，长页滚动可达全部操作，卡片失图与过期显示正常');
 const apiProfile={baseUrl:'https://api.openai.com/v1',model:'gpt-4.1',apiKey:'SYNTHETIC_NATIVE_KEY',temperature:.6};
 const invoke=async(p,evidence=productEvidence)=>page.evaluate(async({p,evidence})=>{const {chat}=await import('/__shopping-test/api.js');return chat(p,'独立选品工具',[{id:'history',role:'user',kind:'text',content:'TOOL_HISTORY_MARKER',createdAt:1}],'这两个哪个好？',()=>{},undefined,{productEvidence:{json:evidence}});},{p,evidence});
 nativeMode='ok';before=nativeCalls.length;await invoke(apiProfile);assert.equal(nativeCalls.length,before+2);assert.equal(nativeCalls.at(-1).messages.at(-1).role,'tool');assert.equal(nativeCalls.at(-1).messages.at(-1).tool_call_id,'synthetic-real-call-id');assert(JSON.stringify(nativeCalls.at(-1)).includes('TOOL_HISTORY_MARKER'));
 nativeMode='unsupported';const unsupported={...apiProfile,apiKey:'SYNTHETIC_UNSUPPORTED_KEY'};before=nativeCalls.length;await invoke(unsupported);assert.equal(nativeCalls.length,before+2);assert(!nativeCalls.at(-1).tools);assert(nativeCalls.at(-1).messages.at(-1).content.includes('商品查询资料'));before=nativeCalls.length;await invoke(unsupported);assert.equal(nativeCalls.length,before+1);nativeMode='ok';
 await invoke({baseUrl:'https://generativelanguage.googleapis.com',model:'gemini-2.5-flash',apiKey:'SYNTHETIC_GEMINI_KEY',temperature:.6,protocol:'gemini'});assert.equal(geminiCalls.length,2);assert.equal(geminiCalls[1].contents.at(-2).parts[0].thoughtSignature,'SYNTHETIC_THOUGHT_SIGNATURE');assert(geminiCalls[1].contents.at(-1).parts[0].functionResponse);
 nativeMode='429';before=nativeCalls.length;const rateError=await invoke({...apiProfile,apiKey:'SYNTHETIC_LIMIT_KEY'}).then(()=>'',error=>error.message);assert.match(rateError,/429/);assert.equal(nativeCalls.length,before+1);nativeMode='ok';
 pass('模块继续复用原统一模型层：原生OpenAI/Gemini工具往返、未知兼容受控上下文、格式拒绝回退和429处理保持正常');
 const stale=await data('shoppingWorkspace');await data('saveShoppingWorkspace',{...stale,needs:'NEWER_MODULE_EDIT'},stale.revision);assert(await data('saveShoppingWorkspace',stale,stale.revision).then(()=>false,()=>true));
 await closeTool();await openTool();assert.equal(await page.inputValue('#shopping-needs'),'NEWER_MODULE_EDIT');await compare();await closeTool();
 const checkpoint=await data('makeArchive','选品模块验证节点','checkpoint'),archive=await data('exportArchive',checkpoint.id);assert(archive.rows.kv.some(row=>row.key==='shopping-workspace'));assert(!JSON.stringify(archive).includes(env.TBK_APP_SECRET));
 await setting();const pendingDownload=page.waitForEvent('download');await page.click('#export-data');const download=await pendingDownload;const backup=JSON.parse(await readFile(await download.path(),'utf8'));
 assert(backup.shoppingWorkspace);assert(!JSON.stringify(backup).includes(env.TBK_APP_SECRET));assert(!JSON.stringify(backup).includes('SYNTHETIC_CHAT_KEY'));assert(!JSON.stringify(backup).includes('SYNTHETIC_NATIVE_KEY'));
 const fresh=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 try{
  await fresh.addInitScript(()=>{for(const k of ['auto-moments','auto-diary','proactive-enabled'])localStorage.setItem('xiaozhang-'+k,'false');localStorage.setItem('xiaozhang-pet-position',JSON.stringify({x:0,y:430}));});await fresh.route('https://img.alicdn.com/**',route=>route.fulfill({contentType:'image/png',body:png}));
  const restored=await fresh.newPage();await restored.goto(origin);await restored.waitForFunction(()=>document.documentElement.dataset.appReady==='true');await restored.click('#topbar-menu-toggle');await restored.click('#settings');
  await restored.locator('#import-data').setInputFiles({name:'shopping-module-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});let recovered;
  for(let attempt=0;attempt<300;attempt++){recovered=await restored.evaluate(()=>new Promise(resolve=>{const open=indexedDB.open('xiaozhang-pwa');open.onsuccess=()=>{const db=open.result,request=db.transaction('kv','readonly').objectStore('kv').get('shopping-workspace');request.onsuccess=()=>{db.close();resolve(request.result?.value);};};}));if(recovered)break;await new Promise(resolve=>setTimeout(resolve,30));}
  assert.deepEqual(recovered.notes,backup.shoppingWorkspace.notes);assert.deepEqual(JSON.parse(JSON.stringify(recovered.attachment)),backup.shoppingWorkspace.attachment);assert.equal(recovered.needs,backup.shoppingWorkspace.needs);
  await restored.locator('#settings-dialog').evaluate(el=>el.close());await restored.reload();await restored.waitForFunction(()=>document.documentElement.dataset.appReady==='true');assert.equal(await restored.locator('#messages .shopping-cards').count(),0);
  await restored.click('#topbar-menu-toggle');await restored.click('#shopping-open');await restored.waitForSelector('#shopping-dialog[open]');assert(await restored.locator('#shopping-products [data-product-id]').count()>0);assert.equal(await restored.locator('.shopping-note').count(),backup.shoppingWorkspace.notes.length);
 }finally{await fresh.close();}
 assert(!JSON.stringify(models).includes(env.TBK_APP_SECRET));assert(!JSON.stringify(await data('messages')).includes('TOOL_NEEDS_ONLY'));assert.deepEqual(errors,[]);
 pass('独立KV有并发保护、关系节点和整机备份；空浏览器恢复模块卡片与比较记录，RP不出现卡片或密钥');
 await writeFile(new URL('results.json',folder),JSON.stringify({passed:true,origin,checks,queries:queries.length,modelFixtureCalls:models.length,errors,realProductAcceptance:'PENDING_SOURCE_PERMISSION'},null,2));console.log(JSON.stringify({passed:true,checks:checks.length,realProductAcceptance:'PENDING_SOURCE_PERMISSION'},null,2));
}catch(error){await page.screenshot({path:new URL('failure.png',folder).pathname.replace(/^\/([A-Za-z]:)/,'$1')}).catch(()=>{});throw error;}
finally{releaseProducts?.();await context.close();await browser.close();}
