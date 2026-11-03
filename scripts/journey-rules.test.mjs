import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import ts from 'typescript';
const folder=new URL('../.local-review/journey-rules/',import.meta.url);await mkdir(folder,{recursive:true});
for(const name of ['travel','journey','journey-view','leisure-backup']){
 const source=await readFile(new URL(`../src/${name}.ts`,import.meta.url),'utf8');
 let output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 for(const dep of ['travel','journey'])output=output.replaceAll(`"./${dep}"`,`"./${dep}.mjs"`);
 await writeFile(new URL(`${name}.mjs`,folder),output);
}
const {initialTravel,startTrip,finishTrip,DAY,hash}=await import(new URL('travel.mjs',folder));
const {planJourney,beginJourney,advanceJourney,threadStatus,journeyContext}=await import(new URL('journey.mjs',folder));
const {renderJourney}=await import(new URL('journey-view.mjs',folder));
const {validTravel,mergeTravel}=await import(new URL('leisure-backup.mjs',folder));
const now=Date.UTC(2026,9,20),checks=[];
function check(name,f){f();checks.push(name);console.log('PASS',name)}
function setup(id='new-trip',bias='balanced') {const s=initialTravel(now-20*DAY,1);s.settings.lengthBias=bias;s.nextDepartureAt=now;const e=planJourney(s,now,id);return {s,e};}
function begin(id,bias) {const {s}=setup(id,bias);const e=beginJourney(s,s.journey.plan.notBefore);return {s,e,t:s.trips[0]};}
check('autonomous advance notice is durable and precedes unique departure; no user route selection',()=>{
 const {s,e}=setup();assert.equal(s.currentId,undefined);assert.ok(e.letter.messageId);assert.ok(validTravel(s));
 assert.equal(planJourney(s,now+1,'another'),undefined);assert.equal(beginJourney(s,s.journey.plan.notBefore-1),undefined);
 const at=s.journey.plan.notBefore,d=beginJourney(s,at);assert.equal(s.currentId,'new-trip');assert.equal(d.kind,'departure');assert.ok(d.at>e.at);assert.equal(beginJourney(s,at+1),undefined);assert.throws(()=>startTrip({...s,currentId:undefined},at,'new-trip'));
 assert.equal(s.journey.events.filter(e=>e.node).length,1);assert.ok(validTravel(s));
 for(const bias of ['short','long'])for(let i=0;i<20;i++){const {t}=begin('bias'+i,bias);assert.equal(t.kind,bias==='short'?'ordinary':'long');}
 const paused=setup().s;paused.settings.enabled=false;assert.equal(beginJourney(paused,now+DAY),undefined);
});
check('checkpoints only appear after due time; routes, letters and journal share canonical IDs',()=>{
 const {s,t}=begin('route-events');assert.equal(advanceJourney(s,t.timeline.nextAt-1).events.length,0);
 let out=advanceJourney(s,t.timeline.nextAt);assert.equal(out.events.length,1);assert.equal(t.timeline.stage,1);assert.equal(advanceJourney(s,t.timeline.nextAt-1).events.length,0);
 out=advanceJourney(s,t.startedAt+5*DAY);assert.ok(out.returned);assert.equal(s.journey.events.filter(e=>e.node).length,5);
 const snapshot=JSON.stringify(s);assert.deepEqual(advanceJourney(s,t.startedAt+6*DAY),{events:[]});assert.equal(JSON.stringify(s),snapshot);
 for(const e of s.journey.events.filter(e=>e.kind!=='notice'))assert.ok(t.journal.includes(e.text));
 assert.ok(validTravel(s));assert.equal(s.trips.length,1);assert.ok(s.nextDepartureAt>t.startedAt+5*DAY);
});
check('weather and detours actually delay return and move route nodes; never pre-reveal a future event',()=>{
 let detour=false,weather=false;
 for(let i=0;i<80;i++){
 const {s,t}=begin('delay-'+i);const end=t.endsAt;advanceJourney(s,t.startedAt+t.timeline.durationMs*.52);
 const e=s.journey.events.find(e=>e.kind==='detour'||e.kind==='weather');
 if(!e)continue;assert.equal(t.endsAt,end+e.delayMs);assert.ok(e.delayMs>0);assert.ok(s.currentId);assert.equal(t.timeline.stage,2);
 assert.equal(advanceJourney(s,end).returned,undefined);assert.ok(advanceJourney(s,t.endsAt).returned);
 if(e.kind==='detour'){detour=true;assert.equal(e.node.label,'绕行便道');assert.equal(e.node.x,70)}else weather=true;
 assert.ok(validTravel(s));
 }assert.ok(detour&&weather);
});
check('legacy trips retain original journals and collections without fabricated nodes or events',()=>{
 const s=initialTravel(now,1),t=startTrip(s,now,'legacy','market');advanceJourney(s,t.endsAt+1);assert.equal(s.journey,undefined);assert.ok(t.journal);assert.ok(validTravel(s));
 const html=renderJourney(s,'map','legacy');assert.match(html,/没有保存路线节点/);assert.doesNotMatch(html,/class="journey-node /);
 const old=JSON.stringify(s.items);const next=planJourney(s,s.nextDepartureAt,'after-legacy');assert.ok(next);assert.equal(JSON.stringify(s.items),old);assert.equal(s.journey.events.filter(e=>e.tripId==='legacy').length,0);
});
check('unacknowledged return does not force catch-up interaction or block future autonomy',()=>{
 const {s,t}=begin('unwelcomed');advanceJourney(s,t.startedAt+5*DAY);assert.equal(t.welcomedAt,undefined);planJourney(s,s.nextDepartureAt,'free-again');assert.ok(beginJourney(s,s.journey.plan.notBefore));assert.equal(s.trips.length,2);assert.equal(t.welcomedAt,undefined);
});
check('threads persist across trips, follow compatible conditions, and respect parked/abandoned states',()=>{
 let found;
 for(let i=0;i<100;i++){const v=begin('thread-source-'+i);advanceJourney(v.s,v.t.startedAt+5*DAY);if(v.s.journey.threads.length){found=v;break}}
 assert.ok(found);const {s}=found,thread=s.journey.threads[0];let followed=false;
 for(let n=0;n<100;n++){
 const c=structuredClone(s),at=c.nextDepartureAt;planJourney(c,at,'thread-follow-'+n);beginJourney(c,c.journey.plan.notBefore);const t=c.trips.at(-1);advanceJourney(c,t.startedAt+5*DAY);
 if(c.journey.threads[0].tripIds.length>1){followed=true;const association=c.journey.events.find(e=>e.kind==='association'&&e.threadId===thread.id);assert.ok(association);assert.match(association.text,/缺少.*佐证/);assert.equal(c.journey.threads[0].status,'open');assert.ok(validTravel(c));break}
 }assert.ok(followed);
 const statusAt=s.nextDepartureAt;threadStatus(s,thread.id,'parked',statusAt);const len=s.journey.events.length;threadStatus(s,thread.id,'parked',statusAt);assert.equal(s.journey.events.length,len);assert.match(journeyContext(s),/已搁置/);
 threadStatus(s,thread.id,'abandoned',statusAt+1);assert.ok(!journeyContext(s).includes(thread.title));
 for(let i=0;i<15;i++){const c=structuredClone(s);planJourney(c,c.nextDepartureAt,'abandoned-'+i);beginJourney(c,c.journey.plan.notBefore);advanceJourney(c,c.trips.at(-1).startedAt+5*DAY);assert.equal(c.journey.threads[0].tripIds.length,1);assert.ok(validTravel(c));}
 threadStatus(s,thread.id,'open',statusAt+2);assert.match(journeyContext(s),/待条件合适/);
 const sameAt=statusAt+3, first=threadStatus(s,thread.id,'parked',sameAt), second=threadStatus(s,thread.id,'open',sameAt), third=threadStatus(s,thread.id,'parked',sameAt);
 assert.ok(first&&second&&third);assert.equal(new Set([first.id,second.id,third.id]).size,3);assert.equal(new Set(s.journey.events.map(e=>e.id)).size,s.journey.events.length);assert.equal(new Set(thread.eventIds).size,thread.eventIds.length);assert.ok(validTravel(s));
});
check('new and old backups merge without rewind, duplicate nodes, lost collections or resurrected plans',()=>{
 const {s,t}=begin('merge-progress');const early=structuredClone(s);advanceJourney(s,t.startedAt+5*DAY);const current=structuredClone(early);mergeTravel(current,s);mergeTravel(current,early);mergeTravel(current,s);
 assert.equal(current.currentId,undefined);assert.ok(current.trips[0].returnedAt);assert.equal(current.trips[0].timeline.stage,3);assert.equal(current.journey.events.length,s.journey.events.length);assert.ok(validTravel(current));
 const pending=setup('merge-progress').s;mergeTravel(current,pending);assert.equal(current.journey.plan,undefined);assert.ok(validTravel(current));
 const before=structuredClone(current);mergeTravel(current,initialTravel(now,1));assert.deepEqual(current.items,before.items);assert.deepEqual(current.journey,before.journey);
 const bad=structuredClone(s);bad.journey.events.find(e=>e.node).node.x=Infinity;assert.equal(validTravel(bad),false);
 const duplicate=structuredClone(s);duplicate.journey.events.push(duplicate.journey.events[0]);assert.equal(validTravel(duplicate),false);
 const link=structuredClone(s);link.journey.events[1].tripId='missing';assert.equal(validTravel(link),false);
});
check('plan-only notices and escaped user text render; no phantom map for a new or legacy trip',()=>{
 const {s,e}=setup('plan-only');const view=renderJourney(s,'events',e.tripId,e.id);assert.ok(view.includes(e.letter.text));assert.ok(view.includes(e.id));assert.match(renderJourney(s,'map'),/尚未出发/);
 s.wish='<img src=x onerror=alert(1)>';assert.ok(!renderJourney(s,'settings').includes('<img src=x'));assert.match(renderJourney(s,'settings'),/&lt;img/);
});
await writeFile(new URL('results.json',folder),JSON.stringify({passed:true,checks},null,2));console.log(checks.length+' journey rule groups passed');
