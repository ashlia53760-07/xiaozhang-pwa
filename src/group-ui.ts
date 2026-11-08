import { storage, newId } from "./storage";
import { characters, characterByName } from "./characters";
import { groupEventText, MAX_GROUP_MEMBERS, isLegacyDateMemory, type GroupMember } from "./groups";
import type { ChatMessage, GroupRecord, GroupQuote } from "./types";

const esc = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
interface Options {
  session: () => string;
  busy: () => boolean;
  switchSession: (id: string) => Promise<void>;
  changed: () => Promise<void>;
  error: (text: string) => void;
  stop: () => void;
  displayName: (characterId: string) => string;
}

/** Group-only views share the existing records, avatars, message list and API. */
export class GroupUI {
  private editor: HTMLDialogElement;
  private library: HTMLDialogElement;
  private mentionDialog: HTMLDialogElement;
  private bar: HTMLElement;
  private quoteBar: HTMLElement;
  private editing?: GroupRecord;
  private selected = new Map<string, GroupMember>();
  private avatarFile?: File;
  private avatarRemoved = false;
  private urls: string[] = [];
  private listUrls: string[] = [];
  private pickerRevision = 0;
  private libraryId = "";
  private libraryTab = "memories";
  private editingMemory = "";
  private savingMemory = false;
  private memoryMessageIds: string[] = [];
  private quoteBySession = new Map<string, GroupQuote>();
  private typingSession = "";
  private typingName = "";
  private typingWait?: { until: number; reason: "tokens" | "spacing" };
  constructor(private options: Options) {
    document.body.insertAdjacentHTML("beforeend", `
      <dialog id="group-editor-dialog" class="group-screen"><form id="group-editor-form">
        <header class="group-screen-head"><button type="button" data-group-close aria-label="关闭">‹</button><h2 id="group-editor-title">发起群聊</h2><button id="group-save" type="submit">创建</button></header>
        <div class="group-screen-body"><p id="group-editor-status" role="status"></p>
          <label>群名<input id="group-title" maxlength="50" placeholder="留空使用成员名字"></label>
          <div class="group-self"><span>我</span><div>你始终在群里<small>选择想一起聊天的人</small></div></div>
          <input id="group-contact-query" type="search" placeholder="搜索联系人" aria-label="搜索建群联系人">
          <div id="group-contact-picker"></div><div id="group-selected" class="group-selected" aria-live="polite"></div>
          <details id="group-settings-details"><summary>群资料与相处方式</summary>
            <div class="group-avatar-setting"><span id="group-avatar-preview">群</span><label class="file-label">设置群头像<input id="group-avatar-file" type="file" accept="image/png,image/jpeg,image/webp"></label><button id="group-avatar-reset" type="button">恢复默认</button></div>
            <label>我的群昵称<input id="group-user-name" maxlength="40" placeholder="我"></label>
            <label>群氛围<select id="group-atmosphere"><option value="daily">日常陪伴</option><option value="lively">轻松热闹</option><option value="quiet">安静闲聊</option></select></label>
            <label>群背景<textarea id="group-background" maxlength="1200" rows="3" placeholder="例如：大家平时在这里分享日常、商量出游"></textarea></label>
            <label>群公告<textarea id="group-announcement" maxlength="500" rows="2"></textarea></label>
            <label>本群世界书<textarea id="group-world-book" rows="3" placeholder="仅本群生效的公开背景，不会自动读取私聊世界书"></textarea></label>
            <fieldset><legend>在群里公开的关系</legend><p class="hint">只填写你愿意公开的关系。私聊里的秘密、称呼和经历不会自动公开；未填写不默认恋爱。</p><div id="group-relationships"></div></fieldset>
            <label>默认接话方式<select id="group-reply-mode"><option value="natural">自然接话</option><option value="selected">指定角色</option><option value="all">全员讨论</option></select></label>
            <label>活跃程度<select id="group-activity"><option value="quiet">安静 · 通常 1–2 人</option><option value="normal">适中 · 通常 2–4 人</option><option value="lively">热闹 · 通常 3–5 人，合适时更多</option></select></label>
            <label>自动接话人数上限<select id="group-reply-limit"><option value="">按群成员人数</option>${Array.from({ length: MAX_GROUP_MEMBERS }, (_, i) => `<option value="${i + 1}">${i + 1} 人</option>`).join("")}</select></label><p class="hint">自然接话按话题和活跃程度安排；热闹模式下，大家都关心的话题可以有更多人加入。人数上限只限制自动接话，@、指定成员和全员讨论仍按你的选择回应。</p>
            <label class="group-check"><input id="group-proactive" type="checkbox">允许群内偶尔主动接话</label><p class="hint">只在本群页面可见、你未输入且空闲一段时间时触发，至少间隔四小时；会使用全局聊天 API，不补发离线期间的消息。随时可关闭。</p>
          </details>
          <button id="group-library-open" type="button">群共同记忆 · 收藏 · 查找聊天</button>
          <button id="group-delete" type="button" class="group-danger">移除群聊入口</button>
          <p class="hint">记录保存在本机，随现有数据备份导出。移除入口不删除历史消息和图片。</p>
        </div></form></dialog>
      <dialog id="group-library-dialog" class="group-screen"><header class="group-screen-head"><button type="button" data-group-close aria-label="关闭">‹</button><h2>群共同记录</h2></header><div class="group-screen-body">
        <nav class="group-tabs"><button type="button" data-group-tab="memories">共同记忆</button><button type="button" data-group-tab="favorites">收藏</button><button type="button" data-group-tab="messages">查找聊天</button></nav>
        <p class="hint">只有启用的共同记忆影响本群后续回复；收藏只用于回看，不自动加入长期记忆。</p>
        <input id="group-library-query" type="search" placeholder="搜索本群记录">
        <form id="group-memory-form"><label>明确保存给本群的共同记忆<textarea id="group-memory-content" maxlength="500" rows="3" required></textarea></label><p id="group-memory-source" class="hint"></p><div class="group-inline-actions"><button type="submit" class="primary">保存共同记忆</button><button id="group-memory-cancel" type="button">取消编辑</button></div></form>
        <p id="group-library-status" role="status"></p><div id="group-library-list"></div>
      </div></dialog>
      <dialog id="group-mention-dialog" class="group-screen group-mention"><header class="group-screen-head"><button type="button" data-group-close aria-label="关闭">‹</button><h2>选择发言角色</h2></header><div id="group-mention-list" class="group-screen-body"></div></dialog>`);
    this.editor = document.querySelector("#group-editor-dialog")!;
    this.library = document.querySelector("#group-library-dialog")!;
    this.mentionDialog = document.querySelector("#group-mention-dialog")!;
    document.querySelector("#composer")!.insertAdjacentHTML("beforebegin", `<div id="group-controls" class="group-controls" hidden><button id="group-mention-open" type="button">@ 选人</button><select id="group-quick-mode" aria-label="群聊接话方式"><option value="natural">自然接话</option><option value="selected">指定角色</option><option value="all">全员讨论</option></select><button id="group-targets-open" type="button">指定成员</button><span id="group-typing" role="status"></span><button id="group-stop" type="button" hidden>停止</button></div><div id="group-quote-bar" class="group-quote-bar" hidden><span></span><button type="button" aria-label="取消引用">×</button></div>`);
    this.bar = document.querySelector("#group-controls")!;
    this.quoteBar = document.querySelector("#group-quote-bar")!;
    this.editor.querySelector("form")!.addEventListener("submit", e => { e.preventDefault(); void this.save(); });
    document.querySelectorAll<HTMLButtonElement>("[data-group-close]").forEach(button => button.addEventListener("click", () => button.closest("dialog")!.close()));
    document.querySelector("#group-create-open")!.addEventListener("click", () => { void this.openEditor(); });
    document.querySelector("#group-contact-query")!.addEventListener("input", () => { void this.renderPicker(); });
    document.querySelector("#group-avatar-file")!.addEventListener("change", event => {
      const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = "";
      if (!file) return;
      if (!file.size || !/^image\//.test(file.type) || file.size > 10 * 1024 * 1024) { this.status("请选择不超过 10MB 的图片"); return; }
      this.avatarFile = file; this.avatarRemoved = false;
      const url = URL.createObjectURL(file); this.urls.push(url);
      document.querySelector("#group-avatar-preview")!.innerHTML = `<img src="${url}" alt="群头像预览">`;
    });
    document.querySelector("#group-avatar-reset")!.addEventListener("click", () => { this.avatarRemoved = true; this.avatarFile = undefined; document.querySelector("#group-avatar-preview")!.textContent = "群"; });
    document.querySelector("#group-library-open")!.addEventListener("click", () => { if (this.editing) void this.openLibrary(this.editing.id); });
    document.querySelector("#group-delete")!.addEventListener("click", () => { if (this.editing) void this.remove(this.editing.id); });
    document.querySelector("#group-mention-open")!.addEventListener("click", () => { void this.openMentions(false); });
    document.querySelector("#group-targets-open")!.addEventListener("click", () => { void this.openMentions(true); });
    document.querySelector("#group-stop")!.addEventListener("click", () => this.options.stop());
    document.querySelector("#group-quick-mode")!.addEventListener("change", async event => {
      const session = this.options.session(), value = (event.target as HTMLSelectElement).value as GroupRecord["replyMode"];
      await this.safe(async () => { await storage.changeGroup(session, group => { group.replyMode = value; group.updatedAt = Date.now(); }); await this.refresh(); });
      if (value === "selected") await this.openMentions(true);
    });
    this.quoteBar.querySelector("button")!.addEventListener("click", () => { this.quoteBySession.delete(this.options.session()); this.renderQuote(); });
    this.library.querySelectorAll<HTMLButtonElement>("[data-group-tab]").forEach(button => button.addEventListener("click", () => { this.libraryTab = button.dataset.groupTab!; this.resetMemory(); void this.renderLibrary(); }));
    document.querySelector("#group-library-query")!.addEventListener("input", () => { void this.renderLibrary(); });
    document.querySelector("#group-memory-cancel")!.addEventListener("click", () => this.resetMemory());
    document.querySelector("#group-memory-form")!.addEventListener("submit", event => { event.preventDefault(); void this.saveMemory(); });
  }
  private value(id: string): string { return document.querySelector<HTMLInputElement>(`#${id}`)!.value.trim(); }
  private status(text: string) { document.querySelector("#group-editor-status")!.textContent = text; }
  private async safe(action: () => Promise<void>) { try { await action(); } catch (e) { this.options.error(e instanceof Error ? e.message : "群聊操作失败，请重试"); } }
  async refresh() {
    const session = this.options.session();
    const group = (await storage.groups()).find(g => g.id === session);
    if (session !== this.options.session()) return;
    this.bar.hidden = !group;
    if (group) {
      document.querySelector<HTMLSelectElement>("#group-quick-mode")!.value = group.replyMode ?? "natural";
      document.querySelector<HTMLButtonElement>("#group-targets-open")!.hidden = group.replyMode !== "selected";
    }
    this.renderQuote(); this.setTyping(this.typingSession, this.typingName, this.typingWait);
  }
  setTyping(session: string, name: string, wait?: { until: number; reason: "tokens" | "spacing" }) {
    this.typingSession = session; this.typingName = name; this.typingWait = wait;
    const visible = session === this.options.session();
    const waiting = wait && wait.until > Date.now();
    const time = waiting ? new Date(wait.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
    document.querySelector("#group-typing")!.textContent = visible && name ? waiting ? `${name}排队中 · ${wait.reason === "tokens" ? "等待 Token 额度" : "请求间隔"}，约 ${time} 接话，可停止` : `${name}正在输入…` : "";
    document.querySelector<HTMLButtonElement>("#group-stop")!.hidden = !(visible && this.options.busy());
  }
  quote(message: ChatMessage) {
    if ((message.sessionId ?? "private") !== this.options.session()) return;
    this.quoteBySession.set(this.options.session(), { messageId: message.id, speaker: message.role === "user" ? "我" : message.speakerId ?? "群成员", text: groupEventText(message).slice(0, 500) });
    this.renderQuote(); document.querySelector<HTMLTextAreaElement>("#draft")!.focus();
  }
  private renderQuote() {
    const value = this.quoteBySession.get(this.options.session());
    this.quoteBar.hidden = !value || this.bar.hidden;
    this.quoteBar.querySelector("span")!.textContent = value ? `回复 ${value.speaker}：${value.text}` : "";
  }
  consumeQuote(session: string): GroupQuote | undefined { const value = this.quoteBySession.get(session); this.quoteBySession.delete(session); this.renderQuote(); return value; }
  async openEditor(id?: string) {
    this.editing = id ? (await storage.groups()).find(g => g.id === id) : undefined;
    if (id && !this.editing) return;
    this.urls.forEach(u => URL.revokeObjectURL(u)); this.urls = [];
    this.avatarFile = undefined; this.avatarRemoved = false;
    this.selected = new Map(this.editing?.members.map(m => [m.characterId ?? characterByName(m.name)?.id ?? m.id, { ...m }]) ?? []);
    // Old editor inputs belong to the previous group, not the newly loaded members.
    document.querySelector("#group-relationships")!.replaceChildren();
    const group = this.editing;
    const values: Record<string, string> = { "group-title": group?.title ?? "", "group-user-name": group?.userName ?? "", "group-atmosphere": group?.atmosphere ?? "daily", "group-background": group?.background ?? "", "group-announcement": group?.announcement ?? "", "group-world-book": group?.worldBook ?? "", "group-reply-mode": group?.replyMode ?? "natural", "group-activity": group?.activity ?? "normal", "group-reply-limit": typeof group?.replyLimit === "number" && Number.isFinite(group.replyLimit) ? String(Math.max(1, Math.min(MAX_GROUP_MEMBERS, Math.floor(group.replyLimit)))) : "", "group-contact-query": "" };
    for (const [key, value] of Object.entries(values)) document.querySelector<HTMLInputElement>(`#${key}`)!.value = value;
    document.querySelector<HTMLInputElement>("#group-proactive")!.checked = !!group?.proactive;
    document.querySelector("#group-editor-title")!.textContent = group ? "群资料" : "发起群聊";
    document.querySelector("#group-save")!.textContent = group ? "保存" : "创建";
    document.querySelector<HTMLButtonElement>("#group-library-open")!.hidden = !group;
    document.querySelector<HTMLButtonElement>("#group-delete")!.hidden = !group;
    document.querySelector<HTMLDetailsElement>("#group-settings-details")!.open = !!group;
    this.status(""); document.querySelector("#group-avatar-preview")!.textContent = "群";
    if (group?.avatarMediaId) {
      const media = await storage.media(group.avatarMediaId);
      if (media) { const url = URL.createObjectURL(media.blob); this.urls.push(url); document.querySelector("#group-avatar-preview")!.innerHTML = `<img src="${url}" alt="群头像">`; }
    }
    await this.renderPicker();
    if (!this.editor.open) this.editor.showModal();
  }
  private memberName(member: GroupMember): string {
    const id = member.characterId ?? characterByName(member.name)?.id;
    return id ? this.options.displayName(id) : member.name;
  }
  private captureRelationships() {
    document.querySelectorAll<HTMLInputElement>("[data-group-relation]").forEach(input => { const member = this.selected.get(input.dataset.groupRelation!); if (member) member.relationship = input.value.trim(); });
  }
  private async renderPicker() {
    const revision = ++this.pickerRevision;
    this.captureRelationships();
    const query = this.value("group-contact-query");
    const candidates = [...characters.map(c => ({ key: c.id as string, name: c.name as string, display: this.options.displayName(c.id), initials: c.initials as string })), ...[...this.selected].filter(([key]) => !characters.some(c => c.id === key)).map(([key, m]) => ({ key, name: m.name, display: m.name, initials: m.name.slice(0, 1) }))];
    document.querySelector("#group-contact-picker")!.innerHTML = candidates.filter(c => !query || c.name.includes(query) || c.display.includes(query)).map(c => `<label class="group-contact-choice"><input type="checkbox" data-group-contact="${esc(c.key)}" ${this.selected.has(c.key) ? "checked" : ""}><span class="group-contact-avatar" data-picker-avatar="${esc(c.key)}">${esc(c.initials)}</span><span>${esc(c.display)}${c.display !== c.name ? `<small> · ${esc(c.name)}</small>` : ""}</span></label>`).join("");
    document.querySelectorAll<HTMLInputElement>("[data-group-contact]").forEach(input => input.addEventListener("change", () => {
      this.captureRelationships();
      const key = input.dataset.groupContact!;
      if (input.checked) { const c = characters.find(c => c.id === key); if (c) this.selected.set(key, { id: c.id, characterId: c.id, name: c.name, persona: c.persona, enabled: true }); }
      else this.selected.delete(key);
      void this.renderPicker();
    }));
    document.querySelector("#group-selected")!.textContent = this.selected.size ? `已选 ${this.selected.size} 人：${[...this.selected.values()].map(m => this.memberName(m)).join("、")}` : "选择联系人后即可创建，你会自动加入。";
    document.querySelector("#group-relationships")!.innerHTML = [...this.selected].map(([key, m]) => `<label>${esc(this.memberName(m))}<input data-group-relation="${esc(key)}" value="${esc(m.relationship ?? "")}" placeholder="例如：亲近的朋友；愿意公开的感情关系"></label>`).join("");
    for (const c of candidates) {
      if (!characters.some(character => character.id === c.key)) continue;
      const media = await storage.contactAvatar(c.key);
      if (revision !== this.pickerRevision) return;
      const element = Array.from(document.querySelectorAll<HTMLElement>("[data-picker-avatar]")).find(el => el.dataset.pickerAvatar === c.key);
      if (media && element) { const url = URL.createObjectURL(media.blob); this.urls.push(url); element.innerHTML = `<img src="${url}" alt="${esc(c.name)}">`; }
    }
  }
  private async save() {
    this.status(""); this.captureRelationships();
    if (this.options.busy()) { this.status("请等当前回复完成后再修改成员与群资料"); return; }
    if (!this.selected.size) { this.status("至少选择一位联系人"); return; }
    const button = document.querySelector<HTMLButtonElement>("#group-save")!; button.disabled = true;
    try {
      const now = Date.now(), original = this.editing, members = [...this.selected.values()];
      let avatarMediaId = this.avatarRemoved ? undefined : original?.avatarMediaId;
      const fields = { title: this.value("group-title") || members.slice(0, 3).map(m => m.name).join("、"), members,
        avatarMediaId, userName: this.value("group-user-name").slice(0, 40), atmosphere: this.value("group-atmosphere") as GroupRecord["atmosphere"], background: this.value("group-background").slice(0, 1200), announcement: this.value("group-announcement").slice(0, 500), worldBook: this.value("group-world-book"), replyMode: this.value("group-reply-mode") as GroupRecord["replyMode"], activity: this.value("group-activity") as GroupRecord["activity"], replyLimit: this.value("group-reply-limit") ? Math.max(1, Math.min(MAX_GROUP_MEMBERS, Number(this.value("group-reply-limit")))) : undefined, proactive: document.querySelector<HTMLInputElement>("#group-proactive")!.checked, updatedAt: now };
      if (this.avatarFile) { const file = this.avatarFile; fields.avatarMediaId = newId("group-avatar"); await storage.saveMedia({ id: fields.avatarMediaId, blob: file, mime: file.type, origin: "group_avatar", createdAt: now }); }
      const id = original?.id ?? newId("group");
      if (original) { const saved = await storage.changeGroup(id, group => Object.assign(group, fields)); if (!saved) throw Error("群聊已被移除，未覆盖其他资料"); }
      else await storage.saveGroup({ id, ...fields, createdAt: now });
      this.editor.close(); await this.options.switchSession(id); await this.options.changed();
    } catch (e) { this.status(e instanceof Error ? e.message : "保存失败，请重试"); } finally { button.disabled = false; }
  }
  async renderList(container: HTMLElement) {
    const groups = await storage.groups();
    this.listUrls.forEach(url => URL.revokeObjectURL(url)); this.listUrls = [];
    container.innerHTML = groups.length ? groups.map(group => `<div class="group-row"><button type="button" data-group-id="${esc(group.id)}"><span class="group-list-avatar" data-group-avatar="${esc(group.id)}">群</span><span><strong>${esc(group.title)}</strong><small>我、${esc(group.members.filter(m => m.enabled).map(m => m.name).join("、"))}</small></span></button><button type="button" data-group-edit="${esc(group.id)}" aria-label="编辑${esc(group.title)}">···</button></div>`).join("") : `<p class="hint group-empty">选几个想说话的人，建一个属于你们的群。</p>`;
    container.querySelectorAll<HTMLButtonElement>("[data-group-id]").forEach(b => b.addEventListener("click", () => { void this.options.switchSession(b.dataset.groupId!); }));
    container.querySelectorAll<HTMLButtonElement>("[data-group-edit]").forEach(b => b.addEventListener("click", () => { void this.openEditor(b.dataset.groupEdit); }));
    for (const group of groups) {
      if (!group.avatarMediaId) continue;
      const media = await storage.media(group.avatarMediaId); if (!media) continue;
      const url = URL.createObjectURL(media.blob); this.listUrls.push(url);
      const target = Array.from(container.querySelectorAll<HTMLElement>("[data-group-avatar]")).find(el => el.dataset.groupAvatar === group.id);
      if (target) target.innerHTML = `<img src="${url}" alt="群头像">`;
    }
  }
  private async remove(id: string) {
    if (this.options.busy()) { this.status("请先停止或等待当前回复"); return; }
    if (!window.confirm("移除这个群的入口？历史消息和媒体仍保留；请先导出备份以保留群资料、共同记忆与收藏。")) return;
    await this.safe(async () => { await storage.deleteGroup(id); this.editor.close(); if (this.options.session() === id) await this.options.switchSession("private"); await this.options.changed(); });
  }
  private async openMentions(targets: boolean) {
    const group = (await storage.groups()).find(g => g.id === this.options.session()); if (!group) return;
    const list = document.querySelector("#group-mention-list")!;
    this.mentionDialog.querySelector("h2")!.textContent = targets ? "指定发言成员" : "@ 联系人";
    list.innerHTML = group.members.filter(m => m.enabled).map(m => targets
      ? `<label class="group-contact-choice"><input type="checkbox" data-group-target="${esc(m.id)}" ${group.selectedMemberIds?.includes(m.id) ? "checked" : ""}><span>${esc(this.memberName(m))}</span></label>`
      : `<button class="group-mention-person" type="button" data-mention-name="${esc(m.name)}">@ ${esc(this.memberName(m))}</button>`).join("") + (targets ? `<button id="group-targets-save" type="button" class="primary">保存选择</button><p class="hint">指定模式只让勾选的成员发言；自然模式下 @ 的人优先回应。</p>` : "");
    list.querySelectorAll<HTMLButtonElement>("[data-mention-name]").forEach(b => b.addEventListener("click", () => {
      const draft = document.querySelector<HTMLTextAreaElement>("#draft")!;
      const start = draft.selectionStart ?? draft.value.length;
      draft.setRangeText(`@${b.dataset.mentionName} `, start, draft.selectionEnd ?? start, "end");
      draft.dispatchEvent(new Event("input", { bubbles: true })); this.mentionDialog.close(); draft.focus();
    }));
    list.querySelector("#group-targets-save")?.addEventListener("click", () => { void this.safe(async () => {
      const ids = Array.from(list.querySelectorAll<HTMLInputElement>("[data-group-target]:checked")).map(i => i.dataset.groupTarget!);
      await storage.changeGroup(group.id, g => { g.selectedMemberIds = ids; g.updatedAt = Date.now(); });
      this.mentionDialog.close();
    }); });
    this.mentionDialog.showModal();
  }
  async chooseStickerSpeaker(): Promise<GroupMember | undefined> {
    const group = (await storage.groups()).find(g => g.id === this.options.session());
    if (!group) return;
    this.mentionDialog.querySelector("h2")!.textContent = "选择表情包发送者";
    const list = document.querySelector("#group-mention-list")!;
    list.innerHTML = group.members.filter(m => m.enabled).map(m => `<button type="button" class="group-mention-person" data-sticker-speaker="${esc(m.id)}">${esc(this.memberName(m))}</button>`).join("");
    return new Promise(resolve => {
      let chosen: GroupMember | undefined;
      this.mentionDialog.addEventListener("close", () => resolve(chosen), { once: true });
      list.querySelectorAll<HTMLButtonElement>("[data-sticker-speaker]").forEach(button => button.addEventListener("click", () => {
        chosen = group.members.find(m => m.id === button.dataset.stickerSpeaker); this.mentionDialog.close();
      }));
      this.mentionDialog.showModal();
    });
  }
  async favorite(message: ChatMessage) {
    await this.safe(async () => {
      const session = message.sessionId!;
      await storage.changeGroup(session, group => {
        group.favorites ??= [];
        if (!group.favorites.some(f => f.messageId === message.id)) group.favorites.push({ id: newId("group-favorite"), messageId: message.id, speaker: message.role === "user" ? group.userName || "我" : message.speakerId || "群成员", text: groupEventText(message).slice(0, 2000), createdAt: Date.now() });
      });
      await this.openLibrary(session, "favorites");
    });
  }
  async openLibrary(id: string, tab = "memories") {
    this.libraryId = id; this.libraryTab = tab; this.resetMemory();
    document.querySelector<HTMLInputElement>("#group-library-query")!.value = "";
    await this.renderLibrary(); if (!this.library.open) this.library.showModal();
  }
  private resetMemory() {
    this.editingMemory = ""; this.memoryMessageIds = [];
    document.querySelector<HTMLTextAreaElement>("#group-memory-content")!.value = "";
    document.querySelector("#group-memory-source")!.textContent = "来源：用户明确保存，不会自动提取所有聊天。";
  }
  private async saveMemory() {
    const content = this.value("group-memory-content"); if (!content) return;
    if (this.savingMemory) return;
    this.savingMemory = true;
    const now = Date.now(), id = this.editingMemory || newId("group-memory"), libraryId = this.libraryId, messageIds = [...this.memoryMessageIds];
    try { await this.safe(async () => {
      const saved = await storage.changeGroup(libraryId, group => {
        group.memories ??= []; const old = group.memories.find(m => m.id === id);
        const record = { id, content: content.slice(0, 500), enabled: old?.enabled ?? true, source: messageIds.length ? "conversation" as const : "user" as const, messageIds, createdAt: old?.createdAt ?? now, updatedAt: now };
        group.memories = [...group.memories.filter(m => m.id !== id), record];
      });
      if (!saved) throw Error("群聊已移除，未保存记忆");
      if (this.libraryId !== libraryId) return;
      this.resetMemory(); await this.renderLibrary(); document.querySelector("#group-library-status")!.textContent = "共同记忆已保存，只影响本群。";
    }); } finally { this.savingMemory = false; }
  }
  private async locate(id: string) {
    const session = this.libraryId;
    this.library.close(); this.editor.close(); await this.options.switchSession(session);
    const row = Array.from(document.querySelectorAll<HTMLElement>("[data-message-id]")).find(el => el.dataset.messageId === id);
    if (row) { row.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" }); row.classList.add("group-located"); window.setTimeout(() => row.classList.remove("group-located"), 2500); }
    else this.options.error("原消息已删除，保留的收藏文本仍可查看。");
  }
  private async renderLibrary() {
    const group = (await storage.groups()).find(g => g.id === this.libraryId); if (!group) return;
    const query = this.value("group-library-query").toLocaleLowerCase();
    const matches = (text: string) => !query || text.toLocaleLowerCase().includes(query);
    this.library.querySelectorAll<HTMLButtonElement>("[data-group-tab]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.groupTab === this.libraryTab)));
    document.querySelector<HTMLElement>("#group-memory-form")!.hidden = this.libraryTab !== "memories";
    const list = document.querySelector("#group-library-list")!;
    if (this.libraryTab === "memories") {
      list.innerHTML = (group.memories ?? []).filter(m => matches(m.content)).map(m => `<article class="group-record"><small>${m.source === "conversation" ? "来源：用户从本群对话明确保存" : "来源：用户手动保存"} · ${isLegacyDateMemory(m) ? "旧约会存档，不参与共同回复" : m.enabled ? "影响后续回复" : "已停用"}</small><p>${esc(m.content)}</p><div class="group-inline-actions"><button type="button" data-group-memory-edit="${esc(m.id)}">编辑</button><button type="button" data-group-memory-toggle="${esc(m.id)}">${m.enabled ? "停用" : "启用"}</button><button type="button" data-group-memory-delete="${esc(m.id)}">删除</button>${m.messageIds?.[0] ? `<button type="button" data-group-locate="${esc(m.messageIds[0])}">查看来源</button>` : ""}</div></article>`).join("");
      list.querySelectorAll<HTMLButtonElement>("[data-group-memory-edit]").forEach(b => b.addEventListener("click", () => {
        const m = group.memories!.find(m => m.id === b.dataset.groupMemoryEdit)!; this.editingMemory = m.id; this.memoryMessageIds = m.messageIds ?? [];
        document.querySelector<HTMLTextAreaElement>("#group-memory-content")!.value = m.content;
        document.querySelector("#group-memory-source")!.textContent = m.source === "conversation" ? "来源：本群对话，经用户明确保存。" : "来源：用户手动保存。";
      }));
      for (const [attr, remove] of [["groupMemoryToggle", false], ["groupMemoryDelete", true]] as const) {
        const selector = remove ? "[data-group-memory-delete]" : "[data-group-memory-toggle]";
        list.querySelectorAll<HTMLButtonElement>(selector).forEach(b => b.addEventListener("click", () => { void this.safe(async () => {
          await storage.changeGroup(group.id, g => { if (remove) g.memories = g.memories?.filter(m => m.id !== b.dataset[attr]); else { const m = g.memories?.find(m => m.id === b.dataset[attr]); if (m) { m.enabled = !m.enabled; m.updatedAt = Date.now(); } } });
          if (remove && this.editingMemory === b.dataset[attr]) this.resetMemory(); await this.renderLibrary();
        }); }));
      }
    } else {
      const rows = this.libraryTab === "favorites" ? (group.favorites ?? []).map(f => ({ id: f.messageId, speaker: f.speaker, text: f.text, favoriteId: f.id }))
        : (await storage.sessionMessages(group.id)).filter(m => m.metadata?.event !== "pet_interaction").map(m => ({ id: m.id, speaker: m.role === "user" ? group.userName || "我" : m.speakerId || "群成员", text: groupEventText(m), favoriteId: "" }));
      list.innerHTML = rows.filter(r => matches(`${r.speaker} ${r.text}`)).reverse().map(row => `<article class="group-record"><small>${esc(row.speaker)}</small><p>${esc(row.text)}</p><div class="group-inline-actions"><button type="button" data-group-locate="${esc(row.id)}">定位消息</button><button type="button" data-group-save-memory="${esc(row.id)}">保存为共同记忆</button>${row.favoriteId ? `<button type="button" data-group-unfavorite="${esc(row.favoriteId)}">取消收藏</button>` : ""}</div></article>`).join("");
      list.querySelectorAll<HTMLButtonElement>("[data-group-save-memory]").forEach(b => b.addEventListener("click", () => {
        const row = rows.find(r => r.id === b.dataset.groupSaveMemory)!;
        this.libraryTab = "memories"; this.resetMemory(); this.memoryMessageIds = [row.id];
        document.querySelector<HTMLTextAreaElement>("#group-memory-content")!.value = `${row.speaker}：${row.text}`.slice(0, 500);
        document.querySelector("#group-memory-source")!.textContent = "来源：本群对话。请检查内容，点保存后才会成为共同记忆。";
        void this.renderLibrary();
      }));
      list.querySelectorAll<HTMLButtonElement>("[data-group-unfavorite]").forEach(b => b.addEventListener("click", () => { void this.safe(async () => { await storage.changeGroup(group.id, g => { g.favorites = g.favorites?.filter(f => f.id !== b.dataset.groupUnfavorite); }); await this.renderLibrary(); }); }));
    }
    if (!list.children.length) list.innerHTML = `<p class="group-empty">还没有匹配的${this.libraryTab === "memories" ? "共同记忆" : this.libraryTab === "favorites" ? "收藏" : "消息"}。</p>`;
    list.querySelectorAll<HTMLButtonElement>("[data-group-locate]").forEach(b => b.addEventListener("click", () => { void this.locate(b.dataset.groupLocate!); }));
  }
}
