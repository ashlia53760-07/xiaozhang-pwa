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
 const request=route.request();if(request.method()!=='POST')return route.fulfill({contentType:'application/json',body:'{"ready":false}'});
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
await context.route('https://shopping-model-test.invalid/**',async route=>{const body=route.request().postDataJSON();models.push(body);await route.fulfill({contentType:'application/json',body:JSON.stringify({choices:[{message:{content:'我在，按你说的预算一起看看。'}}]})});});
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
try{
 await page.goto(origin);await ready();
 const now=Date.now(),profile={baseUrl:'https://shopping-model-test.invalid/v1',model:'synthetic',apiKey:'SYNTHETIC_CHAT_KEY',temperature:.6,protocol:'openai'};
 await data('saveProfile',profile);
 await put('kv',{key:'character-settings',value:{userName:'小梨',userPreferences:'PERSONA_STYLE_MARKER_深色 简洁',relationship:'同伴',worldBook:'',customPrompt:'',updatedAt:now}});
 await data('addMessage',{id:'shopping-context-before',role:'user',kind:'text',content:'HISTORY_MARKER_我预算200，偏好实用。',createdAt:now-10000,sessionId:'private'});
 await page.reload();await ready();
 let before=queries.length;await send('今天想一起听雨。https://example.com/hello');assert.equal(queries.length,before);assert(!JSON.stringify(models.at(-1)).includes('商品查询资料'));assert(!models.at(-1).tools);
 pass('普通聊天和普通网址保持原请求流程，不产生商品查询或工具调用');
 before=models.length;await send(`预算200，${raw}，和${other}。哪个更适合送人？`);
 assert.equal(queries.length,1);assert.equal(vendors.length,2);assert.equal(models.length,before+1);
 assert.equal(await page.locator('.shopping-card[data-product-id]').count(),2);assert.equal(await page.locator('.shopping-cards img[onerror]').count(),0);
 assert.deepEqual(await page.locator('.shopping-card-actions a').evaluateAll(as=>as.map(a=>a.href)),['https://item.taobao.com/item.htm?id=12345678901','https://detail.tmall.com/item.htm?id=22345678901']);
 assert((await page.locator('.shopping-cards').textContent()).includes('获取于'));assert((await page.locator('.shopping-cards').textContent()).includes('¥88.00'));
 assert(JSON.stringify(models.at(-1)).includes('PERSONA_STYLE_MARKER'));assert(JSON.stringify(models.at(-1)).includes('HISTORY_MARKER'));assert(JSON.stringify(models.at(-1)).includes('不虚构价格'));
 assert(!models.at(-1).tools);assert.equal(models.at(-1).messages[0].content.includes('合成帆布包'),false);assert(models.at(-1).messages.at(-1).content.includes('合成帆布包'));
 await page.locator('[data-product-id="22345678901"]').scrollIntoViewIfNeeded();
 await page.waitForFunction(()=>document.querySelector('[data-product-id="22345678901"] img')?.hidden===true);
 pass('真实应用接入模拟后端契约：双商品卡、价格时间、合法跳转、失图占位、人格与原聊天历史保留，商家内容不进入系统指令');
 before=queries.length;await send('这两个哪个好？哪个更适合送人？');assert.equal(queries.length,before);assert(models.at(-1).messages.at(-1).content.includes('22345678901'));
 await send('今天早点睡，晚安。');assert.equal(queries.length,before);assert(!models.at(-1).messages.at(-1).content.includes('商品查询资料'));
 await data('saveActiveSession','private:wu-xie');await page.reload();await ready();await send('这两个哪个好？');assert(!models.at(-1).messages.at(-1).content.includes('untrusted_product_query_results'));
 await data('saveActiveSession','private');await page.reload();await ready();assert.equal(await page.locator('.shopping-card[data-product-id]').count(),2);
 pass('历史商品可继续追问且复用，不把商品流程带入普通话题或另一个角色的私聊');
 let user=(await data('sessionMessages','private')).find(row=>row.metadata?.shopping);const productEvidence=JSON.stringify(user.metadata.shopping);
 const expired=structuredClone(user);for(const result of expired.metadata.shopping.results){result.product.fetchedAt=Date.now()-3600000;result.product.expiresAt=Date.now()-1;}
 await data('addMessage',expired);await data('pruneShoppingPrices');user=(await data('sessionMessages','private')).find(row=>row.id===expired.id);assert.equal(user.metadata.shopping.results[0].product.price,undefined);
 await page.reload();await ready();assert((await page.locator('.shopping-cards').textContent()).includes('价格已过期'));assert(!(await page.locator('.shopping-cards').textContent()).includes('¥88.00'));
 before=queries.length;await send('刷新这两个商品的最新价格。');assert.equal(queries.length,before+1);assert(models.at(-1).messages.at(-1).content.includes('88.00'));
 await page.reload();await ready();assert.equal(await page.locator('.shopping-card[data-product-id]').count(),4);
 pass('过期价格从存储和模型证据剔除，历史保留稳定资料，明确刷新可重新查询并继续比较');
 sourceMode='unavailable';await send('看看这个 https://item.taobao.com/item.htm?id=32345678901');assert((await page.locator('.shopping-error').textContent()).includes('尚未获得并配置使用权限'));assert(models.at(-1).messages.at(-1).content.includes('SOURCE_NOT_CONFIGURED'));
 sourceMode='fail';await send('这个呢 https://item.taobao.com/item.htm?id=42345678901');assert(models.at(-1).messages.at(-1).content.includes('UPSTREAM_ERROR'));
 sourceMode='quota';await send('再看看 https://item.taobao.com/item.htm?id=52345678901');assert(models.at(-1).messages.at(-1).content.includes('QUOTA_EXCEEDED'));
 before=queries.length;await send('https://item.taobao.com/item.htm?missing=1');assert.equal(queries.length,before);assert((await page.locator('.shopping-error').allTextContents()).some(t=>t.includes('没有可确认的商品 ID')));
 sourceMode='ok';before=models.length;await page.locator('.shopping-refresh').last().scrollIntoViewIfNeeded();await page.locator('.shopping-refresh').last().click();await idle();assert.equal(models.length,before);
 pass('未获权限、服务异常、配额不足、错误ID均有独立提示，聊天仍可回复，手动重读不会额外生成角色消息');
 for(const theme of ['ink','warm','night','rococo','bronze'])for(const width of [320,390,1280]){
  await page.setViewportSize({width,height:844});await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
  const layout=await page.locator('#messages').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,offenders:[...el.querySelectorAll('.bubble,.shopping-cards,.shopping-card')].map(e=>({class:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})).filter(e=>e.right>el.getBoundingClientRect().right+1)}));
  assert(layout.scroll<=layout.width+1,theme+' '+width+' '+JSON.stringify(layout));
 }
 await page.setViewportSize({width:390,height:844});await page.locator('.shopping-card[data-product-id]').last().scrollIntoViewIfNeeded();await page.screenshot({path:new URL('cards.png',folder).pathname.replace(/^\/([A-Za-z]:)/,'$1')});
 await page.evaluate(async()=>{const {expireProductCards}=await import('/__shopping-test/shopping-ui.js');expireProductCards(document.querySelector('#messages'),Date.now()+3600000);});
 assert(!(await page.locator('.shopping-price').allTextContents()).some(t=>t.includes('¥')));await page.reload();await ready();
 const apiProfile={baseUrl:'https://api.openai.com/v1',model:'gpt-4.1',apiKey:'SYNTHETIC_NATIVE_KEY',temperature:.6};
 const invoke=async(p,evidence=productEvidence)=>page.evaluate(async({p,evidence})=>{const {chat}=await import('/__shopping-test/api.js');return chat(p,'PERSONA_NATIVE_MARKER',[{id:'history',role:'user',kind:'text',content:'KEEP_HISTORY_MARKER',createdAt:1}],'这两个哪个好？',()=>{},undefined,{productEvidence:{json:evidence}});},{p,evidence});
 nativeMode='ok';before=nativeCalls.length;await invoke(apiProfile);assert.equal(nativeCalls.length,before+2);const plan=nativeCalls.at(-2),answer=nativeCalls.at(-1);assert.equal(plan.stream,false);assert.equal(answer.messages.at(-1).role,'tool');assert.equal(answer.messages.at(-1).tool_call_id,'synthetic-real-call-id');assert.equal(answer.messages.at(-2).tool_calls[0].id,'synthetic-real-call-id');assert(JSON.stringify(answer).includes('KEEP_HISTORY_MARKER'));
 nativeMode='unsupported';const unsupported={...apiProfile,apiKey:'SYNTHETIC_UNSUPPORTED_KEY'};before=nativeCalls.length;await invoke(unsupported);assert.equal(nativeCalls.length,before+2);assert(!nativeCalls.at(-1).tools);assert(nativeCalls.at(-1).messages.at(-1).content.includes('商品查询资料'));
 before=nativeCalls.length;await invoke(unsupported);assert.equal(nativeCalls.length,before+1);nativeMode='ok';
 await invoke({baseUrl:'https://generativelanguage.googleapis.com',model:'gemini-2.5-flash',apiKey:'SYNTHETIC_GEMINI_KEY',temperature:.6,protocol:'gemini'});assert.equal(geminiCalls.length,2);assert.equal(geminiCalls[1].contents.at(-2).parts[0].thoughtSignature,'SYNTHETIC_THOUGHT_SIGNATURE');assert(geminiCalls[1].contents.at(-1).parts[0].functionResponse);assert(JSON.stringify(geminiCalls[1]).includes('KEEP_HISTORY_MARKER'));
 nativeMode='429';before=nativeCalls.length;const rateError=await invoke({...apiProfile,apiKey:'SYNTHETIC_LIMIT_KEY'}).then(()=>'',error=>error.message);assert.match(rateError,/429/);assert.equal(nativeCalls.length,before+1);nativeMode='ok';
 pass('OpenAI真实工具调用ID与Gemini原生签名往返保留；工具格式不支持时一次回退并记忆，未知兼容接口走受控上下文，429不盲重试');
 const snapshot=(await data('sessionMessages','private')).find(row=>row.metadata?.shopping),revision=await data('conversationRevision','private')??0;
 await data('addMessage',{...snapshot,content:snapshot.content+' EDITED_AFTER_QUERY'});
 assert.equal(await data('attachShopping',snapshot,snapshot.metadata.shopping,revision),undefined);
 assert.equal((await data('sessionMessages','private')).find(row=>row.id===snapshot.id).content,snapshot.content+' EDITED_AFTER_QUERY');
 assert(!JSON.stringify(queries).includes(env.TBK_APP_SECRET));assert(!JSON.stringify(models).includes(env.TBK_APP_SECRET));assert(!JSON.stringify(await data('messages')).includes(env.TBK_APP_SECRET));
 if(!await page.locator('#topbar-menu').isVisible())await page.click('#topbar-menu-toggle');await page.click('#settings');
 const pendingDownload=page.waitForEvent('download');await page.click('#export-data');const download=await pendingDownload;const backup=JSON.parse(await readFile(await download.path(),'utf8'));
 const attachments=backup.messages.filter(row=>row.metadata?.shopping);assert(attachments.length>0);assert(!JSON.stringify(backup).includes(env.TBK_APP_SECRET));assert(!JSON.stringify(backup).includes('SYNTHETIC_NATIVE_KEY'));
 const fresh=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
 try{
  await fresh.addInitScript(()=>{for(const k of ['auto-moments','auto-diary','proactive-enabled'])localStorage.setItem('xiaozhang-'+k,'false');localStorage.setItem('xiaozhang-pet-position',JSON.stringify({x:0,y:430}));});
  await fresh.route('https://img.alicdn.com/**',route=>route.fulfill({contentType:'image/png',body:png}));
  const restored=await fresh.newPage();await restored.goto(origin);await restored.waitForFunction(()=>document.documentElement.dataset.appReady==='true');await restored.click('#topbar-menu-toggle');await restored.click('#settings');
  await restored.locator('#import-data').setInputFiles({name:'shopping-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
  let records=[];
  for(let attempt=0;attempt<300;attempt++){
   records=await restored.evaluate(()=>new Promise(resolve=>{const open=indexedDB.open('xiaozhang-pwa');open.onsuccess=()=>{const db=open.result,request=db.transaction('messages','readonly').objectStore('messages').getAll();request.onsuccess=()=>{db.close();resolve(request.result.filter(row=>row.metadata?.shopping));};};}));
   if(records.length===attachments.length)break;await new Promise(resolve=>setTimeout(resolve,30));
  }
  for(const original of attachments)assert.deepEqual(records.find(row=>row.id===original.id)?.metadata.shopping,original.metadata.shopping,'restore '+original.id);
  await restored.locator('#settings-dialog').evaluate(el=>el.close());await restored.reload();await restored.waitForFunction(()=>document.documentElement.dataset.appReady==='true');
  assert(await restored.locator('.shopping-card[data-product-id]').count()>0);assert((await restored.locator('.shopping-card-actions a').evaluateAll(as=>as.map(a=>a.href))).every(url=>/^https:\/\/(item\.taobao\.com|detail\.tmall\.com)\/item\.htm\?id=\d+$/.test(url)));
 }finally{await fresh.close();}
 pass('页面价格过期检查撤下旧值；整机备份和空浏览器恢复保留商品卡片及安全链接，不导出服务密钥');
 assert.deepEqual(errors,[]);
 await writeFile(new URL('results.json',folder),JSON.stringify({passed:true,origin,checks,queries:queries.length,vendorFixtureCalls:vendors.length,modelFixtureCalls:models.length,nativeFixtureCalls:nativeCalls.length,geminiFixtureCalls:geminiCalls.length,errors,realProductAcceptance:'PENDING_SOURCE_PERMISSION'},null,2));
 console.log(JSON.stringify({passed:true,checks:checks.length,realProductAcceptance:'PENDING_SOURCE_PERMISSION'},null,2));
}catch(error){await page.screenshot({path:new URL('failure.png',folder).pathname.replace(/^\/([A-Za-z]:)/,'$1')}).catch(()=>{});throw error;}
finally{releaseProducts?.();await context.close();await browser.close();}
