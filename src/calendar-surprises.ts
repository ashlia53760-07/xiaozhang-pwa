import { characters, PRIMARY_CHARACTER } from "./characters";
import { contactBirthday, validDay } from "./calendar";
import { observances, observancesOnDay, type Observance } from "./calendar-observances";
import { roleSurpriseCopy } from "./calendar-surprise-copy";
import type { BirthdaySettings } from "./types";

export interface CalendarSurprise {
  id:string; characterId:string; title:string; kind:string; object:string;
  front:string; scene:string; custom:string; mark:string; eraNote:string;
}
export function birthdayGreeting(id:string,subject:"user"|"contact"):string {
  const copy=roleSurpriseCopy[id];
  return copy ? subject==="user"?copy.userBirthdayGreeting:copy.birthdayGreeting : "";
}
export function birthdaySurprise(id:string,subject:"user"|"contact"):CalendarSurprise|undefined {
  const character=characters.find(c=>c.id===id),copy=roleSurpriseCopy[id];
  if(!character||!copy)return;
  return {id:`${subject}-birthday`,characterId:id,title:subject==="user"?`${character.name}的生日祝福`:`${character.name}的生日留笺`,kind:"生日",
    object:subject==="user"?"一张专门留给你的生日笺":"一张被认真收好的生日纸签",
    front:birthdayGreeting(id,subject),scene:subject==="user"?copy.userBirthday:copy.birthday,
    custom:"按生日簿的收录月日或你的自定日期相逢；未知日期不杜撰，二月二十九日仅闰年触发。预览不会发送消息或改写记忆。",
    mark:"生",eraNote:""};
}
export function festivalSurprise(id:string,event:Observance):CalendarSurprise|undefined {
  const copy=roleSurpriseCopy[id];
  if(!copy)return;
  const scene=event.id==="term-23"?copy.winter:copy.moments[event.ritual].replaceAll("{prop}",event.prop);
  const quotes=[...scene.matchAll(/『([^』]+)』/g)];
  return {id:event.id,characterId:id,title:`${event.name}留笺`,kind:event.kind,object:event.prop,
    front:quotes.at(-1)?.[1]??scene,scene,custom:event.custom,mark:event.name.slice(0,1),
    eraNote:(id.startsWith("old-")||["zhang-haiyan","zhang-haixia","zhang-haiqi"].includes(id))
      ?event.modernOnly?"现代日期只作你的纪念，人物仍保留原有时代，不预知后来的历史。":event.kind==="海外节日"?"以随笺的异域习俗小注应景，不替人物编造海外成长史或宗教信仰。":""
      :""};
}
export function previewSurprise(id:string,eventId:string):CalendarSurprise|undefined {
  if(eventId==="contact-birthday")return birthdaySurprise(id,"contact");
  if(eventId==="user-birthday")return birthdaySurprise(id,"user");
  const event=observances.find(e=>e.id===eventId);
  return event?festivalSurprise(id,event):undefined;
}
export function surprisesOnDay(key:string,id:string,settings:BirthdaySettings):CalendarSurprise[] {
  if(!validDay(key)||!roleSurpriseCopy[id])return [];
  const matches=(date:BirthdaySettings["user"])=>date&&Number(key.slice(5,7))===date.month&&Number(key.slice(8))===date.day;
  const cards:CalendarSurprise[]=[];
  if(settings.enabled){
    if(matches(contactBirthday(id,settings)))cards.push(birthdaySurprise(id,"contact")!);
    if(matches(settings.user))cards.push(birthdaySurprise(id,"user")!);
  }
  for(const event of observancesOnDay(key))cards.push(festivalSurprise(id,event)!);
  return cards;
}
export const calendarSurpriseRoles=characters.map(c=>({id:c.id,name:c.name}));
export const defaultSurpriseRole=PRIMARY_CHARACTER;
