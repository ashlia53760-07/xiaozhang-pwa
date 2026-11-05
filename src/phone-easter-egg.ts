import { characters, PRIMARY_CHARACTER } from "./characters";

type TraceCopy = { object: string; clue: string; front: string; reveal: string; mark: string; style: "paper" | "bookmark" | "doodle" };
type TraceCharacter = { id: string; name: string };

const AWAY_KEY = "xiaozhang-phone-away-at";
const MIN_AWAY_MS = 2 * 60_000;
const AUTO_COOLDOWN_MS = 4 * 60 * 60_000;
const traces: Record<string, TraceCopy[]> = {
  "zhang-qiling": [
    { object: "一张折过两次的窄纸条", clue: "地图边角画着一小段山脊", front: "回来以后，先喝点水。", reveal: "背面只有两个字：在等。墨迹很淡，像是不想留下。", mark: "山", style: "paper" },
    { object: "一枚夹在手机壳里的旧车票", clue: "日期被手指磨得很浅", front: "收好。下次还要一起走。", reveal: "车票背后没有目的地，只写着：别赶路。", mark: "票", style: "bookmark" },
    { object: "屏幕边缘的一道浅浅指痕", clue: "像是有人想抹掉，又停了手", front: "他看过你写到一半的话。", reveal: "没有碰发送键。只在旁边留了一笔：等你自己说完。", mark: "痕", style: "doodle" }
  ],
  "wu-xie": [
    { object: "从旧本子上撕下的纸签", clue: "上面抄着一串对得上的日期", front: "你上次说的那件事，我又翻了一遍。", reveal: "日期旁边写着：等你有空，再一起查后半段。", mark: "记", style: "paper" },
    { object: "一张被折成三角的小地图", clue: "路绕远了，但终点被圈得很仔细", front: "这条路我先替你看过了。", reveal: "圈外补着一行：不过还是得等你自己来选。", mark: "图", style: "paper" }
  ],
  "wang-pangzi": [{ object: "一枚黏在屏幕边的贴纸", clue: "画了只抱着零食袋的小胖鸟", front: "手机里怎么连点吃的都没有？", reveal: "角落还有一行小字：回来记得投喂胖爷。", mark: "吃", style: "doodle" }],
  "xie-yuchen": [{ object: "一张边缘压得平平的便签", clue: "纸面有淡淡的花纹压痕", front: "桌面有点乱。我替你理好了。", reveal: "落款写得很小：不必谢，记得把自己也照顾好。", mark: "花", style: "paper" }],
  "hei-xiazi": [{ object: "一小段贴在屏幕下方的胶带", clue: "上面用笔画了副歪歪的墨镜", front: "这地方视野不错。", reveal: "翻过来才看见补充：放心，没看你没写完的消息。", mark: "镜", style: "doodle" }],
  "zhang-haike": [{ object: "一枚夹在页面角上的薄书签", clue: "边缘压着规整的张家暗纹", front: "界面检查完毕。没有多余改动。", reveal: "书签里侧补了一句：族长说过，你会回来。", mark: "张", style: "bookmark" }],
  "liu-sang": [{ object: "一截折成耳朵形状的纸角", clue: "纸上画了几圈越来越小的声纹", front: "你不在的时候，手机安静得很。", reveal: "下面还有一句：我听见你回来了。", mark: "听", style: "paper" }],
  "a-ning": [{ object: "一张临时装备检查条", clue: "每个功能入口旁都打了勾", front: "东西都在原位。可以放心出发。", reveal: "最后一项没有勾：回来以后，告诉我你去了哪儿。", mark: "✓", style: "paper" }],
  "huo-xiuxiu": [{ object: "一枚夹着花瓣的细书签", clue: "花瓣被压得平整，还留着浅浅的香气", front: "替你夹在这里啦。", reveal: "翻到背面，是她画的一朵小花，旁边写着：下次一起去看真的。", mark: "秀", style: "bookmark" }],
  "zhang-haiyan": [{ object: "一张画满箭头的便笺", clue: "箭头绕了一圈，又指回聊天框", front: "我刚才发现了一个很好玩的入口。", reveal: "最下面画了个圈：等你回来，带你一起试。", mark: "趣", style: "doodle" }],
  "zhang-haixia": [{ object: "一枚夹在聊天页边上的书签", clue: "上面只标了刚好停住的那一行", front: "帮你留在这里了。", reveal: "背面写着：别急，回来再接着说。", mark: "虾", style: "bookmark" }],
  "zhang-haiqi": [{ object: "一张叠得整齐的留言纸", clue: "折角像一枚很小的屋檐", front: "有空再回来，不必赶。", reveal: "纸条背面写着：饭要趁热吃，话也可以慢慢讲。", mark: "琪", style: "paper" }],
  "wang-can": [{ object: "一枚不起眼的黑色标签", clue: "背面标了时间，没有写地点", front: "屏幕检查完成。", reveal: "撕开夹层，里面只有一句：你回来得比我预计得早。", mark: "灿", style: "bookmark" }],
  "li-cu": [{ object: "一张从草稿纸上撕下来的纸片", clue: "边上画了个假装不在意的小人", front: "我就随便看了一眼。", reveal: "背面却认真写着：你怎么这么久才回来。", mark: "簇", style: "doodle" }],
  "su-wan": [{ object: "一枚做了记号的透明书签", clue: "小箭头指向你常用的聊天框", front: "我帮你找到啦，回来就能接着用。", reveal: "旁边添了个笑脸：这个位置很顺手，对吧？", mark: "万", style: "bookmark" }],
  "yang-hao": [{ object: "一张揉过又展开的纸条", clue: "折痕很多，字倒是写得很直", front: "你东西没少。我没乱动。", reveal: "角落里还有一行：下次别走这么久。", mark: "好", style: "paper" }]
  ,"wang-meng": [{ object: "一张吴山居的便笺", clue: "边角画了一个小小的方格", front: "店里不忙，你来了正好。", reveal: "背面写着：给你留了杯茶。", mark: "盟", style: "paper" }]
  ,"old-zhang-qishan": [{ object: "一张折好的信笺", clue: "纸角压得平整", front: "事情不必急着说。", reveal: "背面留了一句：等你有空，我听着。", mark: "山", style: "paper" }]
  ,"old-er-yuehong": [{ object: "一枚薄薄的戏签", clue: "上面有一笔淡红", front: "茶温正好。", reveal: "背面写着：若得闲，听一出戏。", mark: "红", style: "bookmark" }]
  ,"old-ban-jieli": [{ object: "一张叠齐的纸片", clue: "边上画了一道短线", front: "你的东西，都在。", reveal: "背面写着：有话当面说清楚。", mark: "李", style: "paper" }]
  ,"old-chen-pi": [{ object: "一张折得有些皱的纸", clue: "墨迹停在纸边", front: "我没动别的。", reveal: "背面添了句：你回来就好。", mark: "皮", style: "paper" }]
  ,"old-wu-laogou": [{ object: "一张小纸签", clue: "上面印着一个小爪印", front: "它替你看着呢。", reveal: "背面写着：回来时慢些走。", mark: "吴", style: "bookmark" }]
  ,"old-hei-bei": [{ object: "一片压平的纸角", clue: "只画了一道直线", front: "给你留的。", reveal: "背面写着：我在。", mark: "六", style: "paper" }]
  ,"old-huo-xiangu": [{ object: "一张花纹信笺", clue: "纸边折得很齐", front: "有事便告诉我。", reveal: "背面写着：你不必一个人担着。", mark: "霍", style: "paper" }]
  ,"old-qi-tiezui": [{ object: "一张写了小字的纸签", clue: "角上画了个不太圆的圈", front: "今日宜与你说话。", reveal: "背面添着：这一卦可不用算。", mark: "齐", style: "bookmark" }]
  ,"old-xie-jiu": [{ object: "一张夹好的书签", clue: "边上留着一笔工整的字", front: "此处替你记下了。", reveal: "背面写着：等你回来，再一起看。", mark: "九", style: "bookmark" }]
};

function currentCharacter(value: TraceCharacter | undefined): TraceCharacter {
  return value && characters.some(character => character.id === value.id)
    ? value
    : { id: PRIMARY_CHARACTER, name: characters.find(character => character.id === PRIMARY_CHARACTER)?.name ?? "张起灵" };
}

/** A local interface-only clue. It never enters chat history, memory or model context. */
export class PhoneEasterEgg {
  private initialized = false;
  private hideTimer = 0;
  private longPressTimer = 0;
  private lastVisitKey = "xiaozhang-phone-trace-auto-at";

  constructor(private options: {
    trigger: HTMLButtonElement;
    card: HTMLElement;
    title: HTMLElement;
    pet: HTMLImageElement;
    object: HTMLElement;
    clue: HTMLElement;
    mark: HTMLElement;
    traceTitle: HTMLElement;
    traceBody: HTMLElement;
    traceByline: HTMLElement;
    front: HTMLElement;
    back: HTMLElement;
    frontCopy: HTMLElement;
    flip: HTMLButtonElement;
    close: HTMLButtonElement;
    character: () => TraceCharacter | undefined;
  }) {}

  init() {
    if (this.initialized) return;
    this.initialized = true;
    this.options.trigger.addEventListener("click", () => this.open());
    this.options.close.addEventListener("click", () => this.close());
    this.options.flip.addEventListener("click", () => {
      const revealBack = this.options.back.hidden;
      this.options.front.hidden = revealBack;
      this.options.back.hidden = !revealBack;
      this.options.flip.textContent = revealBack ? "翻回正面" : "翻过来看";
      this.options.card.classList.toggle("phone-trace-reversed", revealBack);
    });
    let pressStart: { x: number; y: number; pointerId: number } | undefined;
    const startLongPress = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      pressStart = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = window.setTimeout(() => this.leaveTrace(true), 900);
    };
    const cancelLongPress = () => { window.clearTimeout(this.longPressTimer); pressStart = undefined; };
    this.options.pet.addEventListener("pointerdown", startLongPress);
    this.options.pet.addEventListener("pointermove", event => {
      if (pressStart && event.pointerId === pressStart.pointerId && Math.abs(event.clientX - pressStart.x) + Math.abs(event.clientY - pressStart.y) > 6) cancelLongPress();
    });
    for (const event of ["pointerup", "pointercancel", "pointerleave"]) this.options.pet.addEventListener(event, cancelLongPress);
    this.options.pet.addEventListener("contextmenu", event => event.preventDefault());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        localStorage.setItem(AWAY_KEY, String(Date.now()));
        return;
      }
      this.checkReturn();
    });
    window.addEventListener("pagehide", () => localStorage.setItem(AWAY_KEY, String(Date.now())));
    this.checkReturn();
  }

  private checkReturn() {
    const awayAt = Number(localStorage.getItem(AWAY_KEY) ?? 0);
    localStorage.removeItem(AWAY_KEY);
    if (awayAt && Date.now() - awayAt >= MIN_AWAY_MS && Date.now() - Number(localStorage.getItem(this.lastVisitKey) ?? 0) >= AUTO_COOLDOWN_MS) this.leaveTrace();
  }

  private leaveTrace(manual = false) {
    const character = currentCharacter(this.options.character());
    const options = traces[character.id] ?? traces[PRIMARY_CHARACTER];
    const variantKey = `xiaozhang-phone-trace-variant:${character.id}`;
    const variant = Math.max(0, Number(localStorage.getItem(variantKey) ?? 0)) % options.length;
    const copy = options[variant];
    localStorage.setItem(variantKey, String(variant + 1));
    this.options.card.dataset.style = copy.style;
    this.options.mark.textContent = copy.mark;
    this.options.object.textContent = copy.object;
    this.options.clue.textContent = copy.clue;
    this.options.traceBody.textContent = copy.reveal;
    this.options.traceByline.textContent = `${character.name} · ${copy.mark}`;
    this.options.front.hidden = false;
    this.options.back.hidden = true;
    this.options.flip.textContent = "翻过来看";
    this.options.frontCopy.textContent = copy.front;
    this.options.card.classList.remove("phone-trace-reversed");
    this.options.trigger.hidden = false;
    this.options.trigger.dataset.characterId = character.id;
    this.options.trigger.setAttribute("aria-label", `查看${character.name}留下的东西`);
    this.options.trigger.querySelector("span:last-child")!.textContent = "页边有东西";
    this.options.card.dataset.characterId = character.id;
    this.options.card.classList.remove("phone-trace-card-new");
    void this.options.card.offsetWidth;
    this.options.card.classList.add("phone-trace-card-new");
    this.open();
    if (!manual) localStorage.setItem(this.lastVisitKey, String(Date.now()));
  }

  private open() {
    this.options.card.hidden = false;
    window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => this.close(), 8_000);
  }

  private close() {
    this.options.card.hidden = true;
    this.options.card.classList.remove("phone-trace-card-new");
  }
}
