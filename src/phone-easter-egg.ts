import { characters, PRIMARY_CHARACTER } from "./characters";

type TraceCopy = { title: string; body: string };
type TraceCharacter = { id: string; name: string };

const AWAY_KEY = "xiaozhang-phone-away-at";
const MIN_AWAY_MS = 15_000;
const traces: Record<string, TraceCopy> = {
  "zhang-qiling": { title: "他把屏幕亮了一下", body: "没有留下消息，只确认你还会回来。" },
  "wu-xie": { title: "有人翻过功能菜单", body: "像在找一条线索，最后又替你合上了。" },
  "wang-pangzi": { title: "有人看过你的加号", body: "投喂入口还在，他大概只是确认库存。" },
  "xie-yuchen": { title: "有人替你理平了页面", body: "顶部的字没有乱，连边角都像被照看过。" },
  "hei-xiazi": { title: "有人在屏幕外笑了一声", body: "光标停过的地方，恰好是你最常点的入口。" },
  "zhang-haike": { title: "有人核对过这台手机", body: "没有改动设置，只留下了一次很轻的访问痕迹。" },
  "liu-sang": { title: "有人听见了屏幕的动静", body: "他没碰聊天记录，只把页面停在原处。" },
  "a-ning": { title: "有人检查过你的界面", body: "像确认装备一样，所有入口都还在原位。" },
  "huo-xiuxiu": { title: "有人悄悄看了看", body: "她没有打扰你，只把这页留给了你。" },
  "zhang-haiyan": { title: "有人动过你的手机", body: "动作很快，像顺手确认了一件有趣的事。" },
  "zhang-haixia": { title: "有人替你看过一眼", body: "没有留下声响，页面仍停在你离开的位置。" },
  "zhang-haiqi": { title: "有人来过这里", body: "她看过一遍，确认你没有把重要的东西落下。" },
  "wang-can": { title: "有人检查过屏幕", body: "没有多余动作，只有一次短暂的确认。" },
  "li-cu": { title: "有人偷看了一眼", body: "他想装作没来过，但把页面停得太整齐了。" },
  "su-wan": { title: "有人替你确认过入口", body: "没有改设置，只把最常用的地方看了一遍。" },
  "yang-hao": { title: "有人来过", body: "没动你的东西，像是只想确定你还在用。" }
};

function currentCharacter(value: TraceCharacter | undefined): TraceCharacter {
  return value && characters.some(character => character.id === value.id)
    ? value
    : { id: PRIMARY_CHARACTER, name: characters.find(character => character.id === PRIMARY_CHARACTER)?.name ?? "张起灵" };
}

/** A local interface-only clue. It never enters chat history, memory or model context. */
export class PhoneEasterEgg {
  private initialized = false;
  private hiddenAt = 0;
  private hideTimer = 0;
  private longPressTimer = 0;

  constructor(private options: {
    trigger: HTMLButtonElement;
    card: HTMLElement;
    title: HTMLElement;
    traceTitle: HTMLElement;
    traceBody: HTMLElement;
    traceByline: HTMLElement;
    close: HTMLButtonElement;
    character: () => TraceCharacter | undefined;
  }) {}

  init() {
    if (this.initialized) return;
    this.initialized = true;
    this.options.trigger.addEventListener("click", () => this.open());
    this.options.close.addEventListener("click", () => this.close());
    this.options.title.addEventListener("pointerdown", () => {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = window.setTimeout(() => this.leaveTrace(), 900);
    });
    for (const event of ["pointerup", "pointercancel", "pointerleave"]) this.options.title.addEventListener(event, () => window.clearTimeout(this.longPressTimer));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        this.hiddenAt = Date.now();
        localStorage.setItem(AWAY_KEY, String(this.hiddenAt));
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
    if (awayAt && Date.now() - awayAt >= MIN_AWAY_MS) this.leaveTrace();
  }

  private leaveTrace() {
    const character = currentCharacter(this.options.character());
    const copy = traces[character.id] ?? traces[PRIMARY_CHARACTER];
    this.options.traceTitle.textContent = copy.title;
    this.options.traceBody.textContent = copy.body;
    this.options.traceByline.textContent = `${character.name} · 只留在界面上的小痕迹`;
    this.options.trigger.hidden = false;
    this.options.trigger.dataset.characterId = character.id;
    this.options.trigger.setAttribute("aria-label", `${character.name}留下的手机痕迹`);
    this.options.card.dataset.characterId = character.id;
    this.options.card.classList.remove("phone-trace-card-new");
    void this.options.card.offsetWidth;
    this.options.card.classList.add("phone-trace-card-new");
    this.open();
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
