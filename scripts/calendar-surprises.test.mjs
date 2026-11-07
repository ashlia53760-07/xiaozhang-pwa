import assert from "node:assert/strict";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import ts from "typescript";
const directory=new URL("../.local-review/calendar-eggs-20261107/modules/",import.meta.url);
await mkdir(directory,{recursive:true});
for(const name of ["calendar","calendar-data","calendar-observances","solar-term-data","characters","calendar-surprise-copy","calendar-surprises"]){
  const source=await readFile(new URL(`../src/${name}.ts`,import.meta.url),"utf8");
  const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/from "\.\/([^".]+)"/g,'from "./$1.mjs"');
  await writeFile(new URL(`${name}.mjs`,directory),code);
}
const {observances,observancesOnDay}=await import(new URL("calendar-observances.mjs",directory));
const {characters}=await import(new URL("characters.mjs",directory));
const {roleSurpriseCopy}=await import(new URL("calendar-surprise-copy.mjs",directory));
const {festivalSurprise,birthdayGreeting,surprisesOnDay,previewSurprise}=await import(new URL("calendar-surprises.mjs",directory));
const {solarTermDays}=await import(new URL("solar-term-data.mjs",directory));
const calendar=await import(new URL("calendar.mjs",directory));
const settings={enabled:true,contacts:{},updatedAt:0};
assert.equal(characters.length,27);
assert.deepEqual(Object.keys(roleSurpriseCopy).sort(),characters.map(c=>c.id).sort());
assert.equal(new Set(observances.map(e=>e.id)).size,observances.length);
const combinations=[];
for(const event of observances){
  const scenes=new Set();
  for(const character of characters){
    const card=festivalSurprise(character.id,event);
    assert(card&&card.scene.length>=35,`${character.id}/${event.id}`);
    assert(!card.scene.includes("{prop}"));assert.equal(card.characterId,character.id);
    assert(!scenes.has(card.scene),`repeated character scene for ${event.id}`);scenes.add(card.scene);
    if(character.id.startsWith("old-")&&event.modernOnly)assert.match(card.eraNote,/原有时代/);
    if(character.id.startsWith("old-")&&event.kind==="海外节日")assert.match(card.eraNote,/习俗小注/);
    combinations.push({role:character.id,event:event.id});
  }
}
for(const subject of ["user","contact"]){
  const greetings=characters.map(c=>birthdayGreeting(c.id,subject));
  assert.equal(new Set(greetings).size,27);
  for(const c of characters){assert(greetings[characters.indexOf(c)].length>=10);assert(previewSurprise(c.id,`${subject}-birthday`));}
}
assert.deepEqual(surprisesOnDay("2026-11-07","zhang-qiling",settings).map(c=>c.id),["term-20"]);
assert.deepEqual(surprisesOnDay("2026-12-22","zhang-qiling",settings).map(c=>c.id),["term-23"]);
assert.deepEqual(observancesOnDay("2025-12-21").map(e=>e.name),["冬至"]);
assert(!observancesOnDay("2026-12-21").some(e=>e.name==="冬至"));
assert(observancesOnDay("2026-02-17").some(e=>e.name==="春节"));
assert(observancesOnDay("2026-02-16").some(e=>e.name==="除夕"));
assert(observancesOnDay("2026-06-19").some(e=>e.name==="端午节"));
assert(observancesOnDay("2026-09-25").some(e=>e.name==="中秋节"));
assert(observancesOnDay("2026-04-05").some(e=>e.name==="复活节"));
assert(observancesOnDay("2026-04-05").some(e=>e.name==="清明"));
assert(observancesOnDay("2026-05-10").some(e=>e.id==="mother"));
assert(observancesOnDay("2026-06-21").some(e=>e.id==="father"));
assert(observancesOnDay("2026-11-26").some(e=>e.id==="thanksgiving"));
assert(!observancesOnDay("2026-10-12").some(e=>e.id==="thanksgiving"));
assert.deepEqual(observancesOnDay("2026-02-30"),[]);
assert.deepEqual(observancesOnDay("bad-date"),[]);
for(const [year,days] of Object.entries(solarTermDays)){
  assert.equal(days.length,24);
  days.forEach((day,index)=>{
    const date=`${year}-${String(Math.floor(index/2)+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    assert(observancesOnDay(date).some(e=>e.id===`term-${index}`),date);
  });
}
assert(!observancesOnDay("2040-12-22").some(e=>e.kind==="节气"),"unverified years must not guess solar terms");
assert.equal(calendar.dayLabels("2026-02-14",calendar.emptyCalendar()).holiday.isOffDay,false);
assert.equal(calendar.dayLabels("2027-02-14",calendar.emptyCalendar()).holiday,undefined);
assert.deepEqual(calendar.dayLabels("2026-03-08",calendar.emptyCalendar()).labels,["国际妇女节"],"new labels must not duplicate the existing fixed-date label");
assert(!surprisesOnDay("2026-11-07","zhang-qiling",settings).some(e=>e.kind==="生日"),"birthday season is not an invented birthday");
const collision={enabled:true,user:{month:12,day:22},contacts:{"old-zhang-xiaoyu":{month:12,day:22}},updatedAt:0};
assert.deepEqual(surprisesOnDay("2026-12-22","old-zhang-xiaoyu",collision).map(e=>e.id),["contact-birthday","user-birthday","term-23"]);
assert.deepEqual(surprisesOnDay("2026-12-22","old-zhang-xiaoyu",{...collision,enabled:false}).map(e=>e.id),["term-23"]);
assert(!surprisesOnDay("2026-03-05","wu-xie",{...settings,contacts:{"wu-xie":{month:2,day:29}}}).some(e=>e.kind==="生日"));
assert(surprisesOnDay("2028-02-29","wu-xie",{...settings,contacts:{"wu-xie":{month:2,day:29}}}).some(e=>e.kind==="生日"));
assert.equal(previewSurprise("unlisted-role","term-23"),undefined);
assert.equal(previewSurprise("wu-xie","not-an-event"),undefined);
const report={roles:characters.length,observances:observances.length,festivalCombinations:combinations.length,birthdayScenes:54,solarTermsVerified:264,passed:true};
await writeFile(new URL("../result-rules.json",directory),JSON.stringify(report,null,2));
console.log("PASS",JSON.stringify(report));
