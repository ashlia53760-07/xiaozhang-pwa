// Isolated browser + fabricated API responses only. No live keys, user data or paid calls.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const origin = 'http://127.0.0.1:5173';
const folder = new URL('../.local-review/blue-polish-tests/', import.meta.url);
await mkdir(folder, {recursive:true});
const browser = await chromium.launch({channel:'chrome',headless:true});
const context = await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
await context.addInitScript(()=>localStorage.setItem('xiaozhang-pet-position',JSON.stringify({x:10,y:400})));
const page = await context.newPage();
const errors=[], requests=[], checks=[];
page.on('pageerror',e=>errors.push(e.message));
await page.route('https://polish-test.invalid/**',async route=>{
  requests.push(route.request().postDataJSON());
  await route.fulfill({contentType:'text/event-stream',body:`data: ${JSON.stringify({choices:[{delta:{content:'可以。等雨小一些，我们再走。\n\n伞放在门边，你出门时拿上。'}}]})}\n\ndata: [DONE]\n\n`});
});
async function snap(name){await page.screenshot({path:fileURLToPath(new URL(name,folder)),animations:'disabled'});}
async function feature(id){
  if(!await page.locator('#topbar-menu').isVisible()) await page.click('#topbar-menu-toggle');
  await page.click(id);
}
async function close(){await page.locator('dialog[open] .dialog-head button[aria-label="关闭"]').click();await page.waitForSelector('dialog[open]',{state:'hidden'});}
async function fit(selector){
  const size=await page.locator(selector).evaluate(el=>({w:el.clientWidth,sw:el.scrollWidth,r:el.getBoundingClientRect().right,vw:innerWidth}));
  assert.ok(size.sw<=size.w+1&&size.r<=size.vw+1,`${selector}: ${JSON.stringify(size)}`);
}
async function layout(){
  for(const selector of ['.app-shell','.chat-panel','#messages','#composer']) await fit(selector);
  const geometry=await page.evaluate(()=>{
    const r=document.querySelector('#plus-open').getBoundingClientRect();
    const style=getComputedStyle(document.querySelector('#plus-open'),'::before');
    const composer=document.querySelector('#composer').getBoundingClientRect();
    const bubbles=[...document.querySelectorAll('.bubble')].map(el=>({w:el.clientWidth,sw:el.scrollWidth,children:[...el.children].filter(e=>getComputedStyle(e).display!=='none').map(e=>({w:e.clientWidth,sw:e.scrollWidth}))}));
    return {r:{x:r.left,y:r.top,w:r.width,h:r.height,right:r.right,bottom:r.bottom},center:parseFloat(style.left),composerBottom:composer.bottom,bubbles,vw:innerWidth,vh:innerHeight};
  });
  assert.ok(Math.abs(geometry.center-(geometry.r.w-2)/2)<1,'plus glyph centered inside its border');
  assert.ok(geometry.r.right<=geometry.vw&&geometry.composerBottom<=geometry.vh,'composer fits viewport');
  // The right-hand decorative tail extends 7px beyond the bubble's padding box.
  for(const b of geometry.bubbles) {
    assert.ok(b.sw<=b.w+8,'no overflow beyond the decorative bubble tail');
    for(const c of b.children) assert.ok(c.sw<=c.w+1,'message media/tools fit their content box');
  }
}
try {
  await page.goto(origin); await page.waitForSelector('#draft');
  await snap('empty-mobile.png');
  const png=await page.evaluate(async()=>{
    const {storage}=await import('/src/storage.ts');
    const now=Date.now();
    await storage.saveProfile({baseUrl:'https://polish-test.invalid/v1',model:'fixture',apiKey:'fabricated-test-key',temperature:.7});
    const canvas=document.createElement('canvas');canvas.width=220;canvas.height=140;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#c1d9e9';ctx.fillRect(0,0,220,140);
    ctx.fillStyle='#f9fcff';ctx.fillRect(20,20,180,100);ctx.fillStyle='#708fa9';ctx.fillText('A quiet afternoon',45,72);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    await storage.saveMedia({id:'polish-image',blob,mime:'image/png',origin:'test',createdAt:now});
    await storage.addMessage({id:'polish-old',role:'assistant',kind:'text',content:'窗边有风，坐里面一些。',createdAt:now-10000,sessionId:'private'});
    await storage.addMessage({id:'polish-photo',role:'user',kind:'image',content:'记下今天的午后。',mediaId:'polish-image',createdAt:now-5000,sessionId:'private'});
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.reload();await page.waitForSelector('.message-media[src^="blob:"]');
  await page.fill('#draft','等雨停了，要一起出去走走吗？'); await page.click('#send');
  await page.waitForFunction(()=>!document.querySelector('#send').disabled&&document.querySelectorAll('.message-row').length===4);
  assert.equal(requests.length,1);assert.ok(requests[0].messages.every(m=>typeof m.content==='string'));
  await layout(); await snap('chat-mobile.png'); checks.push('real send / image history / text-only request / mobile layout');
  const bubble=page.locator('.message-row.assistant .bubble').last();
  assert.equal(await bubble.locator('.message-tools').isVisible(),false);
  await bubble.scrollIntoViewIfNeeded();const r=await bubble.boundingBox();
  await page.mouse.move(r.x+20,r.y+20);await page.mouse.down();await page.waitForTimeout(580);await page.mouse.up();
  assert.equal(await bubble.locator('.message-tools').isVisible(),true);
  await fit('#messages');checks.push('long press actions stay collapsed until requested');
  await page.click('#plus-open'); await fit('#plus-menu');await snap('plus-menu-mobile.png');
  assert.equal(await page.locator('#plus-menu button:visible').count(),7);
  await page.click('#plus-open');checks.push('plus menu opens / labels and controls fit');
  await feature('#settings');await fit('#settings-dialog');
  await page.click('[data-theme="night"]');await close();await layout();await snap('chat-night.png');
  const colors=await page.locator('.bubble').first().evaluate(el=>({text:getComputedStyle(el).color,paper:getComputedStyle(el).backgroundColor}));
  function luminance(css){return css.match(/[\d.]+/g).slice(0,3).map(n=>{const x=Number(n)/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;}).reduce((a,n,i)=>a+n*[.2126,.7152,.0722][i],0);}
  assert.ok((luminance(colors.text)+.05)/(luminance(colors.paper)+.05)>=4.5,'night text contrast');
  checks.push('night theme has readable bubbles (WCAG contrast >=4.5)');
  await feature('#settings');await page.click('[data-theme="warm"]');await snap('settings-mobile.png');
  await page.locator('#background').setInputFiles({name:'my-chat.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.chat-panel')).backgroundImage.startsWith('url("blob:'));
  await close();await snap('chat-custom-background.png');await page.reload();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.chat-panel')).backgroundImage.startsWith('url("blob:'));
  assert.equal(await page.locator('#messages').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)');
  assert.equal(await page.locator('.message-row').count(),4);checks.push('real background upload and refresh persistence / messages stay transparent');
  await page.evaluate(async()=>{const {storage}=await import('/src/storage.ts');await storage.clearBackground();
    await storage.addMessage({id:'polish-long',role:'assistant',kind:'text',content:'长消息换行与布局验证。'.repeat(35)+'\n'+('https://example.invalid/'+ 'a'.repeat(180)),createdAt:Date.now(),sessionId:'private'});});
  await page.reload();await page.waitForSelector('[data-message-id="polish-long"]');
  for(const width of [320,390,1280]){
    await page.setViewportSize({width,height:width===1280?900:844});await layout();
    await page.click('#plus-open');await fit('#plus-menu');await page.click('#plus-open');
    await feature('#role-open');await fit('#role-dialog');await close();
    await snap(`chat-width-${width}.png`);
  }
  checks.push('320/390/1280px: long content, menu and role dialog fit');
  await page.setViewportSize({width:390,height:844});
  await page.locator('#pet').click();await page.waitForSelector('#pet-action-menu:not([hidden])');
  const petMenu=await page.evaluate(()=>{const p=document.querySelector('#pet').getBoundingClientRect(),m=document.querySelector('#pet-action-menu').getBoundingClientRect();return {overlap:Math.max(0,Math.min(p.right,m.right)-Math.max(p.left,m.left))*Math.max(0,Math.min(p.bottom,m.bottom)-Math.max(p.top,m.top)),left:m.left,right:m.right};});
  assert.equal(petMenu.overlap,0);assert.ok(petMenu.left>=0&&petMenu.right<=390);
  await page.click('[data-pet-action="hug"]');await page.waitForSelector('#pet-feedback:not([hidden])');
  await snap('pet-feedback-mobile.png');
  assert.equal(await page.locator('.message-row[data-event="pet_interaction"]').count(),0);
  checks.push('pet menu avoids pet / hug feedback / no interaction pollution in chat');
  await page.emulateMedia({reducedMotion:'reduce'});
  const duration=await page.locator('.message-row').first().evaluate(el=>getComputedStyle(el).animationDuration);
  assert.ok(['0s','1e-05s','0.00001s'].includes(duration)); checks.push('reduced motion honored');
  const touch=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  await touch.addInitScript(()=>localStorage.setItem('xiaozhang-pet-position',JSON.stringify({x:10,y:400})));
  const mobile=await touch.newPage();await mobile.goto(origin);await mobile.waitForSelector('#pet');
  await mobile.locator('#pet').tap();await mobile.waitForSelector('#pet-action-menu:not([hidden])');
  await mobile.locator('[data-pet-action="feed"]').tap();await mobile.waitForSelector('#pet-feedback:not([hidden])');
  await mobile.locator('#plus-open').tap();assert.equal(await mobile.locator('#plus-menu').isVisible(),true);
  await mobile.locator('#plus-open').tap();
  await mobile.waitForTimeout(700); // Let the feeding animation finish before measuring drag distance.
  const start=await mobile.locator('#pet').boundingBox(), cdp=await touch.newCDPSession(mobile);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start.x+40,y:start.y+40}]});
  for(let i=1;i<=6;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start.x+40+i*15,y:start.y+40-i*10}]});await mobile.waitForTimeout(20);}
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await mobile.waitForTimeout(1600);const end=await mobile.locator('#pet').boundingBox();
  assert.ok(Math.abs(end.x-start.x)>10||Math.abs(end.y-start.y)>10,'touch drag changes pet position');
  assert.ok(end.x>=0&&end.x+end.width<=391&&end.y>=48&&end.y+end.height<=844,'touch drag stays in viewport');
  assert.equal(await mobile.locator('#pet-action-menu').isVisible(),false,'drag does not reopen tap menu');
  await touch.close();checks.push('Chrome touch emulation: tap, feed, plus menu, drag and viewport bounds');
  assert.deepEqual(errors,[]);
  const result={passed:true,checks,syntheticChatRequests:requests.length,browserErrors:errors,physicalIOS:'未验证',livePaidAPIs:'未调用'};
  await writeFile(new URL('results.json',folder),JSON.stringify(result,null,2)); console.log(JSON.stringify(result,null,2));
} finally {await browser.close();}
