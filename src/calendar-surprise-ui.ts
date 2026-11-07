import { characters, oldNineIds, PRIMARY_CHARACTER } from "./characters";
import { observances } from "./calendar-observances";
import { previewSurprise, surprisesOnDay, type CalendarSurprise } from "./calendar-surprises";
import type { BirthdaySettings } from "./types";

/** Read-only archive and preview. Discovery remains the existing pet long press. */
export class CalendarSurpriseUI {
  private role=PRIMARY_CHARACTER;
  private sourceRole="";
  private day="";
  private settings:BirthdaySettings={enabled:true,contacts:{},updatedAt:0};
  private roleInput:HTMLSelectElement;
  private previewInput:HTMLSelectElement;
  private cards:HTMLElement;
  constructor(private host:HTMLElement){
    host.className="calendar-surprises";
    const title=document.createElement("h4");title.textContent="日子的悄悄话";
    const hint=document.createElement("p");hint.className="hint";hint.textContent="当天长按桌宠，就能翻到节日或生日留笺。这里可以补看、预览；这些小片段不自动写入聊天记忆，也不调用 API。";
    const controls=document.createElement("div");controls.className="calendar-surprise-controls";
    this.roleInput=document.createElement("select");this.roleInput.id="calendar-egg-character";
    for(const [label,old] of [["盗墓笔记",false],["老九门",true]] as const){
      const group=document.createElement("optgroup");group.label=label;
      characters.filter(c=>oldNineIds.has(c.id)===old).forEach(c=>group.append(new Option(c.name,c.id)));
      this.roleInput.append(group);
    }
    this.previewInput=document.createElement("select");this.previewInput.id="calendar-egg-preview";
    this.previewInput.append(new Option("看所选日期的留笺","today"));
    for(const kind of ["节气","传统节日","现代节日","海外节日","纪念日"]){
      const group=document.createElement("optgroup");group.label=`预览 · ${kind}`;
      observances.filter(e=>e.kind===kind).forEach(e=>group.append(new Option(e.name,e.id)));
      this.previewInput.append(group);
    }
    const birthdays=document.createElement("optgroup");birthdays.label="预览 · 生日";
    birthdays.append(new Option("TA 的生日","contact-birthday"),new Option("我的生日","user-birthday"));this.previewInput.append(birthdays);
    for(const [text,input] of [["看谁留下的",this.roleInput],["选择日期或预览",this.previewInput]] as const){
      const label=document.createElement("label");label.append(document.createTextNode(text),input);controls.append(label);
    }
    this.cards=document.createElement("div");this.cards.id="calendar-egg-cards";
    host.append(title,hint,controls,this.cards);
    this.roleInput.addEventListener("change",()=>{this.role=this.roleInput.value;this.renderCards();});
    this.previewInput.addEventListener("change",()=>this.renderCards());
  }
  render(day:string,settings:BirthdaySettings,currentRole:string){
    if(this.sourceRole!==currentRole){this.sourceRole=currentRole;this.role=characters.some(c=>c.id===currentRole)?currentRole:PRIMARY_CHARACTER;}
    if(this.day!==day)this.previewInput.value="today";
    this.day=day;this.settings=settings;this.roleInput.value=this.role;this.renderCards();
  }
  private renderCards(){
    const preview=this.previewInput.value!=="today";
    const selected=preview?previewSurprise(this.role,this.previewInput.value):undefined;
    const cards=preview?(selected?[selected]:[]):surprisesOnDay(this.day,this.role,this.settings);
    this.cards.replaceChildren();
    const label=document.createElement("p");label.className="calendar-surprise-state";
    label.textContent=preview?"预览 · 不代表今天，不触发生日提醒":`${this.day} · ${cards.length?`${cards.length}份留笺`:"今天先留给寻常的小事"}`;
    this.cards.append(label);
    if(!cards.length){const p=document.createElement("p");p.className="hint";p.textContent="平日长按桌宠仍有原来的小彩蛋；也可以在上方预览冬至、七夕或生日。没有可靠日期的角色，请先在生日簿自定日期。";this.cards.append(p);}
    cards.forEach((card,i)=>this.cards.append(this.card(card,i===0,preview)));
  }
  private card(card:CalendarSurprise,open:boolean,preview:boolean){
    const details=document.createElement("details");details.className="calendar-surprise-letter";details.open=open;details.dataset.eggId=card.id;details.dataset.characterId=card.characterId;
    const summary=document.createElement("summary");summary.textContent=`${card.title} · ${characters.find(c=>c.id===card.characterId)?.name??""}`;
    const object=document.createElement("small");object.textContent=`${preview?"预览 · ":""}${card.object}`;
    const scene=document.createElement("p");scene.className="calendar-surprise-scene";scene.textContent=card.scene;
    const notes=document.createElement("details");notes.className="calendar-surprise-notes";
    const noteSummary=document.createElement("summary");noteSummary.textContent="风俗小注";
    const text=document.createElement("p");text.textContent=[card.custom,card.eraNote].filter(Boolean).join(" ");notes.append(noteSummary,text);
    details.append(summary,object,scene,notes);return details;
  }
}
