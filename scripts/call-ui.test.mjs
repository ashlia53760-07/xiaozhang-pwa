// Isolated Chrome, synthetic media and mocked chat/MiniMax only; no user data or paid calls.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const origin = process.env.CALL_TEST_URL || 'http://127.0.0.1:5173';
const folder = new URL('../.local-review/call-ui-tests/', import.meta.url);
await mkdir(folder, { recursive: true });
const browser = await chromium.launch({ channel:'chrome', headless:true, args:['--use-fake-device-for-media-stream'] });
const context = await browser.newContext({ viewport:{width:390,height:844}, serviceWorkers:'block', permissions:['microphone','camera'] });
await context.addInitScript(() => {
  localStorage.setItem('xiaozhang-pet-position', JSON.stringify({x:10,y:400}));
  window.__mediaStreams = []; window.__mediaRequests = [];
  const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  navigator.mediaDevices.getUserMedia = async constraints => {
    window.__mediaRequests.push(constraints);
    if (window.__rejectMedia) throw new DOMException('Permission denied','NotAllowedError');
    let stream;
    if(window.__delayMedia){
      const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
      canvas.getContext('2d').fillRect(0,0,64,64);stream=canvas.captureStream(1);
    }else stream=await original(constraints);
    window.__mediaStreams.push(stream);
    if (window.__delayMedia) await new Promise(resolve => { window.__resolveMedia = resolve; });
    return stream;
  };
  window.__recognitions = [];
  class Recognition {
    start(){ window.__recognitions.push(this); }
    stop(){ this.onend?.(); }
    abort(){ this.onend?.(); }
  }
  window.SpeechRecognition = Recognition;
});
const page = await context.newPage();
const errors = [], requests = [], tts = [];
page.on('pageerror', e => errors.push(e.message));
let failTts=false, delayChat=false, releaseChat;
// A playable WAV fixture, returned as MiniMax's real hex audio field.
const wave = Buffer.alloc(44+16000);
wave.write('RIFF'); wave.writeUInt32LE(wave.length-8,4); wave.write('WAVEfmt ',8); wave.writeUInt32LE(16,16); wave.writeUInt16LE(1,20); wave.writeUInt16LE(1,22); wave.writeUInt32LE(8000,24); wave.writeUInt32LE(16000,28); wave.writeUInt16LE(2,32); wave.writeUInt16LE(16,34); wave.write('data',36); wave.writeUInt32LE(16000,40);
await page.route('https://call-test.invalid/**', async route => {
  const body=route.request().postDataJSON(); requests.push(body);
  if(delayChat) await new Promise(resolve => {releaseChat=resolve;});
  const text='在。慢慢说，我听着。';
  await route.fulfill({ contentType:'text/event-stream',body:`data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\n\ndata: [DONE]\n\n` });
});
await page.route('https://tts-test.invalid/**', async route => {
  tts.push(route.request().postDataJSON());
  await route.fulfill(failTts ? {status:503,contentType:'application/json',body:'{}'} : {contentType:'application/json',body:JSON.stringify({base_resp:{status_code:0},data:{audio:wave.toString('hex')}})});
});
async function open(mode='voice') {
  await page.click('#plus-open'); await page.click(`#${mode}-call-open`);
  await page.waitForSelector(`#call-dialog[open][data-mode="${mode}"]`);
}
async function options(){ await page.locator('.call-options summary').click(); }
async function close(){ await page.click('#call-end'); await page.waitForSelector('#call-dialog[open]',{state:'hidden'}); }
async function ready(){ await page.waitForFunction(()=>!document.querySelector('#call-send').disabled); }
async function layout() {
  await page.waitForFunction(() => Math.abs(document.querySelector("#call-dialog").clientHeight - innerHeight) < 2);
  const g = await page.locator('#call-dialog').evaluate(el => {
    const ids=['call-text','call-send','call-speech-toggle','call-speaker-toggle','call-end'];
    return {w:el.clientWidth,sw:el.scrollWidth,h:innerHeight,vw:innerWidth,items:ids.map(id=>{const r=document.getElementById(id).getBoundingClientRect();return {id,l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height};})};
  });
  assert.ok(g.sw<=g.w+1,JSON.stringify(g));
  for (const r of g.items) assert.ok(r.l>=-1&&r.r<=g.vw+1&&r.t>=0&&r.b<=g.h+1&&r.w>=32&&r.h>=32,JSON.stringify(r));
}
async function emit(text,index=0,previous=[]){
  await page.evaluate(({text,index,previous})=>{
    const recognition=window.__recognitions.at(-1);
    const results=[...previous,text].map(transcript=>Object.assign([{transcript}],{isFinal:true}));
    recognition.onresult?.({resultIndex:index,results});
  },{text,index,previous});
}
try {
  await page.goto(origin); await page.waitForSelector('#plus-open');
  await open(); await layout();
  assert.equal(await page.evaluate(()=>window.__mediaRequests.length),0,'opening never silently turns on microphone/camera');
  await page.screenshot({path:fileURLToPath(new URL('voice-ready.png',folder))});
  await page.waitForTimeout(1100); assert.notEqual(await page.locator('.call-duration time').innerText(),'00:00');
  await page.click('#call-speaker-toggle');
  await page.fill('#call-text','在吗'); await page.click('#call-send'); await ready();
  assert.match(await page.locator('#call-transcript').innerText(),/本地预设/);
  await close();
  const timer=await page.locator('.call-duration time').innerText(); await page.waitForTimeout(1100);
  assert.equal(await page.locator('.call-duration time').innerText(),timer,'timer stopped on hangup');

  // Configure only fabricated test endpoints/keys, and seed actual avatar and background blobs.
  await page.evaluate(async()=>{
    const {storage}=await import('/src/storage.ts');
    await storage.saveProfile({baseUrl:'https://call-test.invalid/v1',model:'synthetic-model',apiKey:'synthetic-test-key',temperature:.7,protocol:'openai'});
    await storage.saveTtsProfile({provider:'minimax',baseUrl:'https://tts-test.invalid',model:'speech-2.8-hd',apiKey:'synthetic-test-key',voiceId:'synthetic-voice'});
    const canvas=document.createElement('canvas');canvas.width=240;canvas.height=320;const c=canvas.getContext('2d');c.fillStyle='#b7a7c8';c.fillRect(0,0,240,320);c.fillStyle='#f0e8ef';c.fillRect(65,60,110,140);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve));
    for(const [method,id] of [['saveCharacterAvatar','portrait'],['saveUserAvatar','user']])await storage[method]({id,blob,mime:'image/png',origin:'test',createdAt:Date.now()});
  });
  await page.reload(); await open();
  await page.fill('#call-text','今天想听你说说话'); await page.click('#call-send'); await ready();
  assert.equal(requests.length,1); assert.equal(tts.length,1);
  assert.ok(requests[0].messages.every(m=>typeof m.content==='string'));
  assert.match(requests[0].messages.at(-1).content,/今天想听/);
  assert.equal(tts[0].text,'在。慢慢说，我听着。');
  await page.waitForFunction(async()=>{const {storage}=await import('/src/storage.ts');return (await storage.messages()).some(m=>m.metadata?.event==='call_reply'&&m.metadata?.audioMediaId);});
  await page.locator('[data-call-replay]').click(); await page.waitForTimeout(100);
  assert.equal(tts.length,1,'replay reuses saved audio rather than paid regeneration');
  await page.screenshot({path:fileURLToPath(new URL('voice-active.png',folder))}); await layout();
  await page.click('#call-speaker-toggle'); // Mute so ASR is not stopped by the reply's TTS.
  await page.click('#call-speech-toggle');
  await page.waitForFunction(()=>window.__recognitions.length>0);
  await emit('这是第一句听写'); await ready();
  await emit('这是第二句听写',1,['这是第一句听写']); await ready();
  await emit('这是第二句听写',1,['这是第一句听写']); await page.waitForTimeout(150);
  assert.equal(requests.length,3,'cumulative recognition results are submitted once each');
  await page.click('#call-speech-toggle');
  await close();
  assert.equal(await page.evaluate(()=>window.__mediaStreams.flatMap(s=>s.getTracks()).every(t=>t.readyState==='ended')),true,'hangup releases microphone');

  await open('video'); await layout();
  assert.equal(await page.locator('#call-user-video').isVisible(),false);
  assert.equal(await page.locator('#call-user-avatar-image').isVisible(),true);
  await page.locator('#call-background-input').setInputFiles({name:'broken.png',mimeType:'image/png',buffer:Buffer.from('not-an-image')});
  await page.waitForFunction(()=>document.querySelector('#call-status').textContent.includes('无法读取'));
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=240;c.height=320;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,200,300);g.addColorStop(0,'#768782');g.addColorStop(1,'#343646');x.fillStyle=g;x.fillRect(0,0,240,320);return c.toDataURL().split(',')[1];});
  await page.locator('#call-background-input').setInputFiles({name:'background.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>document.querySelector('#call-status').textContent.includes('背景已保存'));
  const bgId=await page.evaluate(async()=>(await(await import('/src/storage.ts')).storage.videoCallBackground()).id);
  await options();await page.click('#call-camera-toggle');
  await page.waitForFunction(()=>document.querySelector('#call-camera-toggle').getAttribute('aria-pressed')==='true');
  assert.equal(await page.locator('#call-user-video').isVisible(),true);
  await options(); await page.click('#call-camera-toggle');
  await page.waitForFunction(()=>document.querySelector('#call-camera-toggle').getAttribute('aria-pressed')==='false');
  assert.equal(await page.locator('#call-user-avatar-image').isVisible(),true);
  await page.fill('#call-text','视频页面发来的一句话'); await page.click('#call-send'); await ready();
  await layout(); await page.screenshot({path:fileURLToPath(new URL('video-active.png',folder))});
  await page.click('#call-transcript-toggle'); assert.equal(await page.locator('#call-transcript').isVisible(),false);
  await page.click('#call-transcript-toggle'); assert.equal(await page.locator('#call-transcript').isVisible(),true);
  for(const size of [{width:320,height:568},{width:390,height:420},{width:1280,height:900}]){
    await page.setViewportSize(size);await layout();
  }
  await page.setViewportSize({width:390,height:844}); await close(); await page.reload();await open('video');
  assert.equal(await page.evaluate(async()=>(await(await import('/src/storage.ts')).storage.videoCallBackground()).id),bgId,'background survives refresh');
  await page.waitForFunction(()=>document.querySelector('#call-dialog').classList.contains('has-background'));
  await close();await open();
  for(const size of [{width:320,height:568},{width:390,height:420},{width:1280,height:900}]) {await page.setViewportSize(size);await layout();}
  await page.setViewportSize({width:390,height:844});

  // Permission rejection and retry are real failure states, never a fake connected state.
  await page.evaluate(()=>window.__rejectMedia=true);await page.click('#call-speech-toggle');
  await page.waitForFunction(()=>document.querySelector('#call-status').textContent.includes('麦克风未开启'));
  await page.evaluate(()=>window.__rejectMedia=false);
  // Pending microphone permission resolved after hangup must stop the acquired tracks.
  await page.evaluate(()=>window.__delayMedia=true);await page.click('#call-speech-toggle');
  await page.waitForFunction(()=>!!window.__resolveMedia);await close();
  await page.evaluate(()=>window.__resolveMedia());await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.__mediaStreams.flatMap(s=>s.getTracks()).every(t=>t.readyState==='ended')),true);
  await page.evaluate(()=>{window.__delayMedia=false;window.__resolveMedia=undefined;});
  await open('video');
  await page.evaluate(()=>window.__rejectMedia=true);await options();await page.click('#call-camera-toggle');
  await page.waitForFunction(()=>document.querySelector('#call-status').textContent.includes('摄像头未开启'));
  assert.equal(await page.locator('#call-user-avatar-image').isVisible(),true);
  await page.evaluate(()=>{window.__rejectMedia=false;window.__delayMedia=true;});
  await options();await page.click('#call-camera-toggle');await page.waitForFunction(()=>!!window.__resolveMedia);await close();
  await page.evaluate(()=>window.__resolveMedia());await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>window.__mediaStreams.flatMap(s=>s.getTracks()).every(t=>t.readyState==='ended')),true,'late camera permission cannot leak a track');
  await page.evaluate(()=>window.__delayMedia=false);

  await open();failTts=true;
  await page.fill('#call-text','测试语音失败');await page.click('#call-send');await ready();
  assert.match(await page.locator('#call-status').innerText(),/503/);
  assert.equal(await page.locator('#call-transcript article').count(),2,'TTS failure preserves text reply');
  failTts=false;await page.click('[data-call-replay]');
  await page.waitForFunction(()=>!document.querySelector('#call-status').textContent.includes('503'));
  await close();
  // Reply may finish and persist after hangup, but cannot enter the next call or play audio there.
  await open();delayChat=true;
  const beforeTts=tts.length;
  await page.fill('#call-text','挂断前发送');await page.click('#call-send');
  await page.waitForFunction(()=>document.querySelector('#call-send').disabled);
  while(!releaseChat) await new Promise(r=>setTimeout(r,20));
  await close();await open();releaseChat();delayChat=false;
  await page.waitForTimeout(350);
  assert.equal(await page.locator('#call-transcript article').count(),0);
  assert.equal(tts.length,beforeTts,'stale reply cannot play in the next call');
  await close(); await page.reload();
  const saved=await page.evaluate(async()=>{const{storage}=await import('/src/storage.ts');return(await storage.messages()).filter(m=>m.metadata?.event==='call'||m.metadata?.event==='call_reply');});
  assert.ok(saved.length>=12);assert.ok(saved.every(m=>m.content.trim()&&m.content!=='null'));
  assert.deepEqual(errors,[]);
  const result={passed:true,origin,chatRequests:requests.length,ttsRequests:tts.length,tests:['full-screen voice/video layout','390/320/desktop/keyboard-height controls','no automatic camera/microphone activation','mocked chat SSE and MiniMax audio','audio persistence and replay','deduplicated cumulative ASR','microphone/camera toggles','camera avatar fallback','timer cleanup','permission rejection and late permission cleanup','saved image background restored','corrupt upload rejected','subtitle collapse','TTS HTTP failure and retry','hangup during chat prevents stale audio','chat history survives reload'],physicalIOS:'not tested',liveModelAndTTS:'not tested: synthetic API and fake camera/mic only'};
  await writeFile(new URL('results.json',folder),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
 }catch(error){
  console.error(await page.evaluate(()=>({status:document.querySelector('#call-status')?.textContent,requests:window.__mediaRequests,camera:document.querySelector('#call-camera-toggle')?.outerHTML})));
  await page.screenshot({path:fileURLToPath(new URL('failure.png',folder))});throw error;
}finally{await browser.close();}
