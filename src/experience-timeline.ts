import { storage } from "./storage";
import { characters, lifeSession, PRIMARY_CHARACTER } from "./characters";
import type { ChatMessage, DiaryRecord, InteractionRecord, LifeEventRecord, MomentRecord } from "./types";
import type { TravelState } from "./leisure-types";

type TimelineKind = "chat" | "life" | "date" | "travel" | "diary" | "moment" | "interaction" | "gift";
export interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  label: string;
  title: string;
  text: string;
  at: number;
  session?: string;
  messageId?: string;
  characterId?: string;
  favorite?: boolean;
}

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export class ExperienceTimeline {
  private dialog: HTMLDialogElement;
  private query: HTMLInputElement;
  private filter: HTMLSelectElement;
  private characterFilter: HTMLSelectElement;
  private list: HTMLDivElement;
  private entries: TimelineEntry[] = [];

  constructor(private openEntry: (entry: TimelineEntry) => void) {
    document.body.insertAdjacentHTML("beforeend", `<dialog id="experience-timeline" class="timeline-dialog"><header class="timeline-head"><div><span class="eyebrow">SHARED MOMENTS</span><h2>共同时间线</h2></div><button type="button" id="timeline-close" class="icon-button" aria-label="关闭">×</button></header><div class="timeline-controls"><input id="timeline-query" type="search" placeholder="搜索聊天、旅途和记录"><select id="timeline-filter" aria-label="筛选记录"><option value="all">全部记录</option><option value="favorites">收藏回忆</option><option value="chat">线上聊天</option><option value="scene">线下与约会</option><option value="travel">旅途</option><option value="diary">日记</option><option value="moment">朋友圈</option><option value="life">互动与礼物</option></select><select id="timeline-character" aria-label="按角色筛选"><option value="all">全部角色</option>${characters.map(character => `<option value="${escape(character.id)}">${escape(character.name)}</option>`).join("")}</select></div><p class="timeline-note">汇总全部联系人和共同经历；收藏的聊天消息可从“收藏回忆”筛选。约会仍是独立剧场。</p><div id="timeline-list" class="timeline-list" aria-live="polite"></div></dialog>`);
    this.dialog = document.querySelector<HTMLDialogElement>("#experience-timeline")!;
    this.query = this.dialog.querySelector<HTMLInputElement>("#timeline-query")!;
    this.filter = this.dialog.querySelector<HTMLSelectElement>("#timeline-filter")!;
    this.characterFilter = this.dialog.querySelector<HTMLSelectElement>("#timeline-character")!;
    this.list = this.dialog.querySelector<HTMLDivElement>("#timeline-list")!;
    this.dialog.querySelector("#timeline-close")!.addEventListener("click", () => this.dialog.close());
    this.query.addEventListener("input", () => this.render());
    this.filter.addEventListener("change", () => this.render());
    this.characterFilter.addEventListener("change", () => this.render());
    this.list.addEventListener("click", event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-timeline-id]");
      const entry = this.entries.find(value => value.id === button?.dataset.timelineId);
      if (entry) { this.dialog.close(); this.openEntry(entry); }
    });
    this.list.addEventListener("click", event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-timeline-favorite]");
      const entry = this.entries.find(value => value.id === button?.dataset.timelineFavorite);
      if (!entry?.messageId) return;
      event.stopPropagation();
      void this.toggleFavorite(entry);
    });
  }

  async open(filter: "all" | "chat" = "all") {
    const [messages, diaries, moments, interactions, lifeEvents, groups, travel, dates] = await Promise.all([
      storage.messages(), storage.diaries(), storage.moments(), storage.interactions(), storage.lifeEvents(), storage.groups(),
      storage.leisure<TravelState>("travel-state"), storage.dateSessions()
    ]);
    const entries: TimelineEntry[] = [];
    const groupNames = new Map(groups.map(group => [group.id, group.title]));
    const characterName = (id: string) => characters.find(value => value.id === id)?.name ?? "张起灵";
    const characterForSession = (id: string) => id === "private" ? PRIMARY_CHARACTER : id.startsWith("private:") ? id.slice(8) : id === "life" ? PRIMARY_CHARACTER : id.startsWith("life:") ? id.slice(5) : undefined;
    const sessionName = (id: string) => id === "private" ? "张起灵私聊" : id.startsWith("private:") ? `${characterName(id.slice(8))}私聊` : groupNames.get(id) ?? "群聊";

    const messageIds = new Set(messages.map(message => message.id));
    for (const message of messages) {
      const session = message.sessionId ?? "private";
      if (message.metadata?.event === "pet_interaction" || typeof message.metadata?.lifeEventId === "string") continue;
      const kind: TimelineKind = session.startsWith("life") ? "life" : message.metadata?.event === "life_meeting_summary" ? "life" : "chat";
      const speakerId = message.speakerId ? characters.find(value => value.name === message.speakerId)?.id : undefined;
      entries.push({ id: `message:${message.id}`, kind, label: kind === "life" ? "线下见面" : sessionName(session), title: message.role === "user" ? "我" : message.speakerId ?? sessionName(session), text: message.content, at: message.createdAt, session, messageId: message.id, characterId: characterForSession(session) ?? speakerId, favorite: typeof message.metadata?.favoriteAt === "number" });
    }
    for (const character of characters) {
      for (const message of await storage.sessionMessages(lifeSession(character.id))) {
        if (messageIds.has(message.id)) continue;
        entries.push({ id: `message:${message.id}`, kind: "life", label: `${character.name} · 线下`, title: message.role === "user" ? "我" : character.name, text: message.content, at: message.createdAt, session: lifeSession(character.id), characterId: character.id });
      }
    }
    for (const scene of await storage.groupLifeScenes()) for (const message of scene.messages) entries.push({ id: `message:${message.id}`, kind: "life", label: `${groupNames.get(scene.groupId) ?? "群聊"} · 线下`, title: message.role === "user" ? "我" : message.speakerId ?? "同行者", text: message.content, at: message.createdAt, session: `group-life:${scene.groupId}`, characterId: typeof message.metadata?.characterId === "string" ? message.metadata.characterId : undefined });
    for (const date of dates) for (const message of date.messages) entries.push({ id: `date:${date.id}:${message.id}`, kind: "date", label: `${date.groupId ? groupNames.get(date.groupId) ?? "群聊" : "心动约会"} · ${date.title}`, title: message.role === "user" ? "我" : date.groupId ? message.speakerId ?? "同行者" : characterName(date.characterId ?? "zhang-qiling"), text: message.content, at: message.createdAt, session: date.id, messageId: date.groupId ? undefined : message.id, characterId: date.groupId ? typeof message.metadata?.characterId === "string" ? message.metadata.characterId : undefined : date.characterId ?? "zhang-qiling" });
    for (const diary of diaries) entries.push({ ...this.diaryEntry(diary), characterId: PRIMARY_CHARACTER });
    for (const moment of moments) {
      const author = moment.author === "npc" ? characters.find(value => value.name === moment.authorName)?.id : moment.author === "user" ? undefined : PRIMARY_CHARACTER;
      entries.push({ ...this.momentEntry(moment), characterId: author });
    }
    for (const value of interactions) entries.push({ ...this.interactionEntry(value), characterId: value.characterId ?? PRIMARY_CHARACTER });
    for (const value of lifeEvents) entries.push({ ...this.lifeEventEntry(value), characterId: value.characterId });
    for (const event of travel?.journey?.events ?? []) entries.push({ id: `travel:${event.id}`, kind: "travel", label: "旅途记录", title: event.title, text: event.letter?.text ?? event.text, at: event.at, characterId: PRIMARY_CHARACTER });
    for (const trip of travel?.trips ?? []) if (trip.journal?.trim()) entries.push({ id: `journal:${trip.id}`, kind: "travel", label: "旅行手记", title: trip.destination, text: trip.journal, at: trip.returnedAt ?? trip.startedAt, characterId: PRIMARY_CHARACTER });

    this.entries = entries.sort((a, b) => b.at - a.at).slice(0, 1500);
    this.query.value = "";
    this.filter.value = filter;
    this.characterFilter.value = "all";
    this.render();
    this.dialog.showModal();
  }

  private diaryEntry(value: DiaryRecord): TimelineEntry { return { id: `diary:${value.id}`, kind: "diary", label: value.source === "auto" ? "张起灵的日记" : "我的日记", title: value.title || "日记", text: value.content, at: value.updatedAt }; }
  private momentEntry(value: MomentRecord): TimelineEntry { return { id: `moment:${value.id}`, kind: "moment", label: value.author === "user" ? "朋友圈 · 我" : value.author === "npc" ? `朋友圈 · ${value.authorName ?? "朋友"}` : "朋友圈 · 张起灵", title: value.authorName ?? (value.author === "user" ? "我" : "张起灵"), text: value.content, at: value.createdAt }; }
  private interactionEntry(value: InteractionRecord): TimelineEntry { return { id: `interaction:${value.id}`, kind: "interaction", label: "桌宠互动", title: value.label, text: value.response, at: value.createdAt }; }
  private lifeEventEntry(value: LifeEventRecord): TimelineEntry { return { id: `gift:${value.id}`, kind: "gift", label: value.sender === "user" ? "相处记录 · 我" : "相处记录 · 角色", title: value.title, text: value.note ?? value.category ?? "", at: value.createdAt, session: value.sessionId ?? value.groupId }; }

  private async toggleFavorite(entry: TimelineEntry) {
    const message = (await storage.messages()).find(value => value.id === entry.messageId);
    if (!message) return;
    const metadata = { ...(message.metadata ?? {}) };
    if (entry.favorite) delete metadata.favoriteAt;
    else metadata.favoriteAt = Date.now();
    await storage.addMessage({ ...message, metadata });
    entry.favorite = !entry.favorite;
    this.render();
  }

  private render() {
    const query = this.query.value.trim().toLocaleLowerCase();
    const filter = this.filter.value;
    const characterId = this.characterFilter.value;
    const filtered = this.entries.filter(entry => {
      const matchesType = filter === "all" || (filter === "favorites" ? entry.favorite : filter === "scene" ? entry.kind === "life" || entry.kind === "date" : filter === "life" ? entry.kind === "interaction" || entry.kind === "gift" : entry.kind === filter);
      const matchesCharacter = characterId === "all" || entry.characterId === characterId;
      return matchesType && matchesCharacter && (!query || `${entry.label} ${entry.title} ${entry.text}`.toLocaleLowerCase().includes(query));
    });
    this.list.innerHTML = filtered.length ? filtered.slice(0, 250).map(entry => `<article class="timeline-entry"><div class="timeline-entry-meta"><span>${escape(entry.label)}</span><time>${new Date(entry.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></div><h3>${escape(entry.title)}</h3><p>${escape(entry.text.slice(0, 420))}${entry.text.length > 420 ? "…" : ""}</p><div class="timeline-entry-actions">${entry.messageId ? `<button type="button" data-timeline-favorite="${escape(entry.id)}">${entry.favorite ? "取消收藏" : "收藏回忆"}</button>` : ""}<button type="button" data-timeline-id="${escape(entry.id)}">查看记录</button></div></article>`).join("") : `<p class="timeline-empty">${filter === "favorites" ? "还没有收藏的聊天回忆。长按消息即可收藏。" : "没有找到匹配的记录。"}</p>`;
    if (filtered.length > 250) this.list.insertAdjacentHTML("beforeend", `<p class="timeline-note">当前显示前 250 条匹配结果，请继续缩小搜索范围。</p>`);
  }
}
