import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import ts from 'typescript';
const folder=new URL('../.local-review/leisure-rules/',import.meta.url);await mkdir(folder,{recursive:true});
for(const name of ['travel','games','leisure-backup']){
  const source=await readFile(new URL(`../src/${name}.ts`,import.meta.url),'utf8');
  const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replaceAll('"./travel"','"./travel.mjs"');
  await writeFile(new URL(`${name}.mjs`,folder),output);
}
const {initialTravel,startTrip,finishTrip,travelContext,specialEligible,hash:awaitHash,DAY}=await import(new URL('travel.mjs',folder));
const {newPuzzle,swapPuzzle,puzzleHelp,puzzleMove,puzzleCharacterMove,newGomoku,gomokuMove,gomokuWinner,gomokuAI,newFlight,flightRoll,flightLegal,flightMove,flightAI,rollDie,flightEvent}=await import(new URL('games.mjs',folder));
const {validTravel,validPlay,mergeTravel,mergePlay}=await import(new URL('leisure-backup.mjs',folder));
const checks=[];
function check(name,fn){fn();checks.push(name);console.log('PASS',name)}
const now=Date.UTC(2026,9,20);
check('home schedule 7–12 days and ordinary durations; no duplicate departure',()=>{
 for(let i=0;i<20;i++){
 const s=initialTravel(now,i);assert.ok(s.nextDepartureAt>=now+7*DAY&&s.nextDepartureAt<=now+12*DAY);
 const t=startTrip(s,now,'duration-'+i);assert.ok(t.endsAt-now>=4*3600000&&t.endsAt-now<=3*DAY);assert.throws(()=>startTrip(s,now,'other'));
 assert.ok(travelContext(s).includes('不编造用户同行'));assert.equal(finishTrip(s,now),undefined);}
});
check('one return after months away, stable gifts, no repeated settlement or catch-up',()=>{
 let gifted=0,empty=0;
 for(let i=0;i<100;i++){
 const s=initialTravel(now,i);const t=startTrip(s,now,'gift-'+i);finishTrip(s,now+100*DAY);assert.equal(s.trips.length,1);assert.equal(s.currentId,undefined);assert.ok(s.nextDepartureAt>now+100*DAY);
 assert.equal(finishTrip(s,now+101*DAY),undefined);assert.ok(t.journal);assert.equal(new Set(s.items.map(i=>i.id)).size,s.items.length);
 assert.ok(s.items.every(i=>i.category!=='relic'));s.items.length?gifted++:empty++;
 }
 assert.ok(gifted>10&&empty>20);
});
check('special findings are excluded until explicit gated storyline; never normal loot',()=>{
 const s=initialTravel(now,0);assert.equal(specialEligible(s,now+61*DAY),false);
 assert.notEqual(startTrip(s,now,'try-special','archive').kind,'special');
 const eligible=initialTravel(now-61*DAY,0);let stamp=now-10*DAY;while((awaitHash(String(stamp))%17)!==0)stamp++;eligible.homeSince=stamp;
 for(let i=0;i<8;i++){const trip=startTrip(eligible,now-8*DAY+i*DAY,'history-'+i,'ruins');finishTrip(eligible,now-7*DAY+i*DAY);trip.welcomedAt=now-7*DAY+i*DAY;}
 eligible.homeSince=stamp;eligible.items.push({id:'old-clue',tripId:eligible.trips[0].id,title:'旧拓记',category:'clue',acquisition:'记录',owner:'record',status:'kept',displayed:false,story:'原有线索',createdAt:now-7*DAY});
 assert.equal(specialEligible(eligible,now),true);const special=startTrip(eligible,now,'gated-special','archive');assert.equal(special.kind,'special');finishTrip(eligible,now+4*DAY);assert.equal(eligible.items.find(i=>i.tripId===special.id).category,'relic');assert.equal(specialEligible(eligible,now+5*DAY),false);
});
check('travel backup merges preserve current trip, unique IDs and monotonic completion',()=>{
 const a=initialTravel(now,1),b=initialTravel(now,2);startTrip(a,now,'a');startTrip(b,now,'b');finishTrip(b,now+4*DAY);
 mergeTravel(a,b);mergeTravel(a,b);assert.equal(a.currentId,'a');assert.equal(a.trips.length,2);assert.ok(validTravel(a));
 const c=structuredClone(a);finishTrip(c,now+5*DAY);mergeTravel(a,c);assert.equal(a.currentId,undefined);assert.equal(finishTrip(a,now+6*DAY),undefined);
 assert.equal(validTravel({...a,settings:{enabled:true,homeMinDays:NaN,homeMaxDays:2}}),false);
});
check('puzzle permutations, valid swaps, helper cooldown and idempotent completion',()=>{
 for(const size of [3,4,5]){
 const p=newPuzzle('puzzle-'+size,size,'builtin:mountain','山间',now);assert.equal(new Set(p.tiles).size,size*size);assert.equal(p.completedAt,undefined);assert.equal(swapPuzzle(p,-1,0,now),false);assert.equal(puzzleHelp(p,now),false);
 for(let i=0;i<p.tiles.length;i++)if(p.tiles[i]!==i)swapPuzzle(p,i,p.tiles.indexOf(i),now+i);
 assert.ok(p.completedAt);const moves=p.moves;assert.equal(swapPuzzle(p,0,1,now+100),false);assert.equal(p.moves,moves);
 }
 assert.throws(()=>newPuzzle('bad',99,'x','x',now));
});
check('cooperative puzzle alternates user and local character moves; old solo puzzles stay compatible',()=>{
 const p=newPuzzle('duet',3,'builtin:mountain','山间',now);assert.equal(p.collaborative,true);assert.equal(p.turn,'user');
 const first=p.tiles.findIndex((v,i)=>v!==i),second=p.tiles.indexOf(first);assert.equal(puzzleMove(p,first,second,'character',now),false);assert.equal(puzzleMove(p,first,second,'user',now),true);assert.equal(p.turn,'character');assert.equal(p.userMoves,1);assert.equal(p.characterMoves,0);
 const move=puzzleCharacterMove(p);assert.ok(move);assert.equal(puzzleMove(p,move[0],move[1],'user',now+1),false);assert.equal(puzzleMove(p,move[0],move[1],'character',now+1),true);assert.equal(p.turn,'user');assert.equal(p.userMoves,1);assert.equal(p.characterMoves,1);assert.ok(p.lastAction.includes('张起灵'));
 const solo=newPuzzle('solo',3,'builtin:mountain','山间',now,false);assert.equal(solo.collaborative,false);assert.equal(solo.turn,undefined);assert.equal(swapPuzzle(solo,0,1,now),true);
});
check('gomoku enforces first turn, occupied cells, boundaries and all four winning directions',()=>{
 const s=newGomoku('g','normal',now);assert.equal(gomokuMove(s,112,2),false);assert.equal(gomokuMove(s,112,1),true);assert.equal(gomokuMove(s,112,2),false);assert.equal(gomokuMove(s,225,2),false);
 for(const delta of [1,15,16,14]){const b=Array(225).fill(0),start=delta===14?9:0;for(let n=0;n<5;n++)b[start+n*delta]=1;assert.equal(gomokuWinner(b),1);}
 const edge=Array(225).fill(0);[13,14,15,16,17].forEach(i=>edge[i]=1);assert.equal(gomokuWinner(edge),0);
 const draw=Array.from({length:225},(_,i)=>(i%15+2*Math.floor(i/15))%4<2?1:2);assert.equal(gomokuWinner(draw),3);
});
check('all gomoku strengths win or block immediate five; challenge uses legal local moves',()=>{
 for(const difficulty of ['easy','normal','challenge']){
 for(const who of [1,2]){const g=newGomoku('ai',difficulty,now);g.turn=2;[105,106,107,108].forEach(i=>g.board[i]=who);g.board[104]=3-who;assert.equal(gomokuAI(g),109);}
 const g=newGomoku('ai-mid',difficulty,now);gomokuMove(g,112,1);const at=gomokuAI(g);assert.ok(at>=0&&at<225);assert.equal(g.board[at],0);assert.equal(gomokuMove(g,at,2),true);
 }
});
check('flight launch requires 6, alternating turns and third-six forfeiture',()=>{
 const f=newFlight('f',0,'both','short',now);flightRoll(f,3);assert.equal(f.turn,1);assert.equal(f.dice,undefined);flightRoll(f,6);assert.deepEqual(flightLegal(f),[0,1]);flightMove(f,0,now);assert.equal(f.pieces[1][0],0);assert.equal(f.turn,1);flightRoll(f,6);flightMove(f,1,now);assert.equal(f.turn,1);flightRoll(f,6);assert.equal(f.turn,0);assert.equal(f.dice,undefined);
});
check('flight collision, safe start, home bounce, jumps and full win settlement',()=>{
 const f=newFlight('collision',2,'tease','short',now);f.pieces=[[3,-1],[31,-1]];flightRoll(f,2);flightMove(f,0,now);assert.equal(f.pieces[1][0],-1);
 const safe=newFlight('safe',0,'user','short',now);safe.pieces=[[25,-1],[0,-1]];flightRoll(safe,1);flightMove(safe,0,now);assert.equal(safe.pieces[1][0],0);
 const bounce=newFlight('bounce',0,'user','short',now);bounce.pieces[0][0]=55;flightRoll(bounce,5);flightMove(bounce,0,now);assert.equal(bounce.pieces[0][0],54);
 const jump=newFlight('jump',0,'user','short',now);jump.pieces[0][0]=2;flightRoll(jump,2);flightMove(jump,0,now);assert.equal(jump.pieces[0][0],8);
 const fly=newFlight('fly',0,'user','short',now);fly.pieces[0][0]=17;flightRoll(fly,1);flightMove(fly,0,now);assert.equal(fly.pieces[0][0],30);
 const win=newFlight('win',0,'both','normal',now);win.pieces[0]=[57,57,57,56];flightRoll(win,1);flightMove(win,3,now);assert.equal(win.winner,0);assert.equal(win.finishedAt,now);assert.equal(flightRoll(win,6),false);assert.equal(flightMove(win,3,now+1),false);
});
check('flight AI completes real short games; events never block and vary by consent settings',()=>{
 for(let game=0;game<30;game++){
 const f=newFlight('simulation'+game,game%4,['user','both','tease'][game%3],game%2?'short':'normal',now);
 let seed=game+123;
 for(let i=0;i<8000&&f.winner===undefined;i++){
 if(!f.dice){seed=(Math.imul(seed,1664525)+1013904223)>>>0;flightRoll(f,Math.floor(seed/4294967296*6)+1);}else{const at=flightAI(f);assert.ok(flightLegal(f).includes(at));flightMove(f,at,now+i);}
 }
 assert.notEqual(f.winner,undefined);assert.ok(f.pieces.flat().every(v=>v>=-1&&v<=57));
 }
 const f=newFlight('events',3,'tease','short',now),e=flightEvent(f,0);assert.equal(e.target,'张起灵');assert.notEqual(flightEvent(f,0,1).text,e.text);
 for(let i=0;i<100;i++)assert.ok(rollDie()>=1&&rollDie()<=6);
});
check('games backup retains distinct active progress and archives conflicts without duplication',()=>{
 const a={version:1,active:'puzzle',puzzle:newPuzzle('p1',3,'builtin:mountain','山',now),completions:[]};const b={version:1,active:'puzzle',puzzle:newPuzzle('p2',3,'builtin:mountain','山',now),gomoku:newGomoku('g','normal',now),completions:[]};
 mergePlay(a,b);mergePlay(a,b);assert.equal(a.puzzle.id,'p1');assert.equal(a.archives.length,1);assert.equal(a.gomoku.id,'g');assert.ok(validPlay(a));assert.equal(validPlay({...a,puzzle:{...a.puzzle,tiles:[1,1]}}),false);
});
check('optional game dialogue is validated, merged once and bounded without changing legacy saves',()=>{
 const a={version:1,active:'puzzle',completions:[]};assert.ok(validPlay(a));
 const line={id:'line-1',gameId:'old-game',role:'assistant',content:'你慢慢下。',at:now};
 const b={...a,dialogue:[line]};assert.ok(validPlay(b));mergePlay(a,b);mergePlay(a,b);assert.equal(a.dialogue.length,1);
 assert.equal(validPlay({...b,dialogue:[{...line,role:'system'}]}),false);
 assert.equal(validPlay({...b,dialogue:[{...line,content:' '}]}),false);
 assert.equal(validPlay({...b,dialogue:[{...line,content:'x'.repeat(501)}]}),false);
 for(let i=0;i<250;i++)mergePlay(a,{version:1,active:'puzzle',completions:[],dialogue:[{...line,id:'line-'+(i+2),at:now+i+1}]});
 assert.equal(a.dialogue.length,240);assert.ok(validPlay(a));
});
await writeFile(new URL('results.json',folder),JSON.stringify({passed:true,checks},null,2));console.log(`${checks.length} rule groups passed`);
