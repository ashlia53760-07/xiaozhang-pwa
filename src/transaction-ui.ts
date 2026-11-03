import { storage, newId } from "./storage";
import { sessionCharacter, characters } from "./characters";
import { groupMemberKey } from "./groups";
import { canJoinChain, collectionProgress, money, paid, parseMoney, splitShares, toolLabel, toolMessage, toolPeople, toolStatus } from "./group-tools";
import type { ChatMessage, GroupRecord, LifeEventRecord } from "./types";

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const icons = {
  group_collection: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  transfer: '<path d="M4 8h16m-5-5 5 5-5 5M20 16H4m5-5-5 5 5 5"/>',
  chain: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h1m3 0h5M8 12h1m3 0h5M8 16h1m3 0h5"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8C5 8 5 2 8 3c3 0 4 5 4 5Zm0 0c7 0 7-6 4-5-3 0-4 5-4 5Z"/>',
  bill: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2ZM9 8h6m-6 4h6"/>',
  birthday: '<path d="M12 3v4m-3 2h6M5 13h14l-2 8H7l-2-8Zm0 0a3 3 0 0 1 3-3 4 4 0 0 1 8 0 3 3 0 0 1 3 3"/>'
};
const icon = (kind: LifeEventRecord["kind"]) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[kind]}</svg>`;
type Kind = "transfer" | "collection" | "chain";
interface Options {
  session: () => string;
  busy: () => boolean;
  sent: (message: ChatMessage) => Promise<void>;
  action: (eventId: string, action: "join" | "accept" | "decline" | "chain", content?: string) => Promise<void>;
  changed: (session: string) => Promise<void>;
  error: (text: string) => void;
}

/** Presentation uses the existing lifeEvents/messages stores; no new database or payment service. */
export class TransactionUI {
  private dialog: HTMLDialogElement;
  private body: HTMLElement;
  private session = "private";
  private group?: GroupRecord;
  private userName = "我";
  private kind: Kind = "transfer";
  private detailId = "";
  private saving = false;
  private revision = 0;
  private urls: string[] = [];
  constructor(private options: Options) {
    document.body.insertAdjacentHTML("beforeend", `<dialog id="transaction-dialog" class="tool-screen"><header class="tool-head"><button type="button" id="tool-back" aria-label="返回聊天">‹</button><h2 id="tool-title">转账</h2><button type="button" id="tool-history" aria-label="查看记录">记录</button></header><div class="tool-scroll"><div id="tool-error" role="alert" hidden></div><div id="tool-body"></div></div><footer class="tool-disclaimer">陪伴中的虚拟互动 · 不涉及真实支付</footer></dialog>`);
    this.dialog = document.querySelector("#transaction-dialog")!;
    this.body = this.dialog.querySelector("#tool-body")!;
    this.dialog.querySelector("#tool-back")!.addEventListener("click", () => this.dialog.close());
    this.dialog.querySelector("#tool-history")!.addEventListener("click", () => { void this.history(); });
    this.dialog.addEventListener("close", () => { ++this.revision; this.clearUrls(); });
  }
  private clearUrls() { this.urls.forEach(URL.revokeObjectURL); this.urls = []; }
  private error(error: unknown) {
    const el = this.dialog.querySelector<HTMLElement>("#tool-error")!;
    el.textContent = error instanceof Error ? error.message : String(error); el.hidden = !el.textContent;
  }
  private title(text: string) { this.dialog.querySelector("#tool-title")!.textContent = text; this.error(""); }
  private top() { this.dialog.querySelector(".tool-scroll")!.scrollTop = 0; }
  private async context(session: string) {
    this.session = session;
    this.group = (await storage.groups()).find(g => g.id === session);
    this.userName = this.group?.userName || (await storage.characterSettings()).userName || "我";
  }
  private people() {
    const c = sessionCharacter(this.session);
    return [{ id: "user", name: this.userName }, ...(this.group ? this.group.members.filter(m => m.enabled).map(m => ({ id: m.id, name: m.name, characterId: groupMemberKey(m) })) : c ? [{ id: c.id, name: c.name, characterId: c.id }] : [])];
  }
  private avatar(person: { id: string; name: string; characterId?: string }) {
    return `<span class="tool-avatar" data-tool-person="${esc(person.id === "user" ? "user" : person.characterId ?? "")}">${esc(person.name.slice(0, 1))}</span>`;
  }
  private async avatars() {
    const revision = ++this.revision; this.clearUrls();
    const keys = [...new Set(Array.from(this.body.querySelectorAll<HTMLElement>("[data-tool-person]"), e => e.dataset.toolPerson!))];
    for (const id of keys) {
      if (!id) continue;
      const record = id === "user" ? await storage.userAvatar() : characters.some(c => c.id === id) ? await storage.contactAvatar(id) : undefined;
      if (revision !== this.revision || !this.dialog.open) return;
      const url = record ? URL.createObjectURL(record.blob) : id === "zhang-qiling" ? "./character/images/standing.png" : "";
      if (!url) continue;
      if (record) this.urls.push(url);
      this.body.querySelectorAll<HTMLElement>("[data-tool-person]").forEach(el => {
        if (el.dataset.toolPerson === id) { const image = document.createElement("img"); image.src = url; image.alt = ""; el.replaceChildren(image); }
      });
    }
  }
  async open(kind: Kind) {
    if (this.options.busy()) { this.options.error("请等当前操作完成后再发起互动"); return; }
    const session = this.options.session(); await this.context(session);
    if (session !== this.options.session()) return;
    if (kind !== "transfer" && !this.group) { this.options.error("请在群聊中使用群收款和接龙"); return; }
    this.kind = kind; this.detailId = "";
    this.compose(); if (!this.dialog.open) this.dialog.showModal(); this.top(); void this.avatars();
  }
  private compose() {
    const people = this.people(), recipients = people.filter(p => p.id !== "user");
    const kind = this.kind;
    this.title(kind === "collection" ? "群收款" : kind === "chain" ? "发起接龙" : "转账");
    this.body.innerHTML = `<form id="tool-compose" class="tool-compose">
      <div class="tool-conversation">${esc(this.group?.title ?? recipients[0]?.name ?? "会话")}<span>${kind === "collection" ? "一起分担，也是一件小事。" : kind === "chain" ? "把大家的想法接在一起。" : "留一句话给对方。"}</span></div>
      ${kind === "transfer" ? `<section class="tool-sheet"><label class="tool-field">转给<select id="tool-recipient">${recipients.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("")}</select></label></section>` : ""}
      ${kind !== "transfer" ? `<section class="tool-sheet"><label class="tool-field">${kind === "chain" ? "接龙主题" : "收款事项"}<input id="tool-subject" maxlength="80" required placeholder="${kind === "chain" ? "例如：周末带什么零食" : "例如：今晚的晚饭"}"></label></section>` : ""}
      ${kind !== "chain" ? `<section class="tool-sheet tool-money-sheet"><label for="tool-amount">${kind === "collection" ? "总金额" : "转账金额"}<small>虚拟金额</small></label><div class="tool-amount-input"><span>¥</span><input id="tool-amount" type="text" inputmode="decimal" maxlength="8" placeholder="0.00" required autocomplete="off"></div><label class="tool-note-label" for="tool-note">添加说明</label><input id="tool-note" maxlength="120" placeholder="留一句话（可选）"></section>` : `<section class="tool-sheet"><label class="tool-field tool-stacked">接龙说明<textarea id="tool-note" maxlength="120" placeholder="填写格式、时间或其他说明（可选）"></textarea></label><label class="tool-field tool-stacked">1. ${esc(this.userName)}<textarea id="tool-chain-content" maxlength="160" required placeholder="填写你的第一条接龙"></textarea></label></section>`}
      ${kind === "collection" ? `<section class="tool-sheet tool-members"><h3>参与成员 <small>含自己，按人数均摊</small></h3>${people.map(p => `<label class="tool-member-choice">${this.avatar(p)}<span>${esc(p.name)}${p.id === "user" ? "<small>我的一份无需收款</small>" : ""}</span><input type="checkbox" name="tool-member" value="${esc(p.id)}" checked ${p.id === "user" ? "disabled" : ""}></label>`).join("")}<p id="tool-split-preview" aria-live="polite">填写金额后查看分摊明细</p></section>` : ""}
      <button id="tool-send" class="tool-primary" type="submit">${kind === "collection" ? "发起收款" : kind === "chain" ? "发起接龙" : "转账"}</button>
      <p class="tool-compose-hint">${kind === "collection" ? "角色按聊天中的决定参与，不会自动标记已付款。" : kind === "chain" ? "发送到群聊后，大家可以继续填写。" : "发送后等待对方收下，也可以被退回。"}</p></form>`;
    const form = this.body.querySelector<HTMLFormElement>("#tool-compose")!;
    form.addEventListener("submit", e => { e.preventDefault(); void this.submit(); });
    if (kind === "collection") form.addEventListener("input", () => {
      const preview = this.body.querySelector("#tool-split-preview")!;
      try {
        const amount = parseMoney(this.input("tool-amount")), ids = this.selectedMembers();
        const shares = splitShares(amount, ids), own = shares.user ?? 0;
        preview.textContent = `共 ${ids.length} 份 · 我的 ${money(own)} · 需收 ${money(amount - own)}${amount % ids.length ? "（余分按成员顺序分配）" : ` · 每份 ${money(own)}`}`;
      } catch { preview.textContent = "填写有效金额并选择成员，每份至少 0.01"; }
    });
  }
  private input(id: string) { return this.body.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#${id}`)?.value.trim() ?? ""; }
  private selectedMembers() { return Array.from(this.body.querySelectorAll<HTMLInputElement>('input[name="tool-member"]:checked'), el => el.value); }
  private async submit() {
    if (this.saving) return;
    if (this.options.busy()) { this.error("请等当前操作完成后再发送"); return; }
    this.saving = true; const submit = this.body.querySelector<HTMLButtonElement>("#tool-send")!; submit.disabled = true;
    let message: ChatMessage | undefined;
    try {
      const kind = this.kind, people = this.people(), now = Date.now();
      const base = { id: newId("tool"), sender: "user" as const, sessionId: this.session, groupId: this.group?.id, characterId: sessionCharacter(this.session)?.id, initiatorId: "user", people, createdAt: now, updatedAt: now };
      let event: LifeEventRecord, content: string;
      if (kind === "transfer") {
        const recipient = people.find(p => p.id === this.input("tool-recipient") && p.id !== "user");
        if (!recipient) throw Error("请选择收款人");
        const amount = parseMoney(this.input("tool-amount")), note = this.input("tool-note") || undefined;
        event = { ...base, kind: "transfer", title: `给${recipient.name}的转账`, recipient: recipient.name, recipientId: recipient.id, amount, note, status: "pending" };
        content = `${this.userName}向${recipient.name}发起转账 ${money(amount)}${note ? `，说明：${note}` : ""}（虚拟记录，待收款）。`;
      } else if (kind === "collection") {
        const title = this.input("tool-subject"), ids = this.selectedMembers(), amount = parseMoney(this.input("tool-amount"));
        if (!title || ids.length < 2) throw Error("请填写收款事项，并选择至少一位其他成员");
        const shares = splitShares(amount, ids);
        event = { ...base, kind: "group_collection", title, note: this.input("tool-note") || undefined, amount, participants: ids, shares, responses: Object.fromEntries(ids.map(id => [id, id === "user" ? "settled" : "pending"])), status: "pending" };
        content = `${this.userName}发起群收款「${title}」：共 ${money(amount)}，${ids.length} 人分摊，需收 ${money(amount - shares.user)}（虚拟记录）。参与名单：${people.filter(p => ids.includes(p.id)).map(p => `${p.name}${p.id === "user" ? "（发起人，自己的一份）" : ""}`).join("、")}。仅名单内成员参与，其他群成员无需付款。`;
      } else {
        const title = this.input("tool-subject"), contentText = this.input("tool-chain-content");
        if (!title || !contentText) throw Error("请填写接龙主题和你的内容");
        event = { ...base, kind: "chain", title, note: this.input("tool-note") || undefined, participants: people.map(p => p.id), chainItems: [{ id: `${base.id}:user`, ownerId: "user", name: this.userName, content: contentText, createdAt: now }], status: "pending" };
        content = `${this.userName}发起接龙「${title}」${event.note ? `，说明：${event.note}` : ""}：\n1. ${this.userName}：${contentText}`;
      }
      const savedMessage = toolMessage(event, content, "user");
      await storage.createLifeEvent(event, savedMessage);
      message = savedMessage;
      this.dialog.close(); await this.options.changed(this.session);
    } catch (error) { this.error(error); }
    finally { this.saving = false; submit.disabled = false; }
    if (message) { try { await this.options.sent(message); } catch (error) { this.options.error(error instanceof Error ? error.message : "消息已保存，回复失败，可在聊天中重试"); } }
  }
  private async history() {
    this.detailId = ""; this.title("互动记录");
    const session = this.session, c = sessionCharacter(session);
    const rows = (await storage.lifeEvents()).filter(e => e.sessionId ? e.sessionId === session : this.group ? e.groupId === session : !e.groupId && (e.characterId === c?.id || (!e.characterId && c?.id === "zhang-qiling")));
    this.body.innerHTML = `<div class="tool-history-list">${rows.filter(e => e.kind !== "bill").map(e => `<button type="button" data-tool-record="${esc(e.id)}"><span class="tool-history-icon ${e.kind}">${icon(e.kind)}</span><span><strong>${esc(e.title)}</strong><small>${toolLabel(e.kind)} · ${new Date(e.createdAt).toLocaleDateString()} · ${toolStatus(e)}</small></span><b>›</b></button>`).join("") || '<p class="tool-empty">还没有互动记录，和对方慢慢积累。</p>'}</div>`;
    this.body.querySelectorAll<HTMLButtonElement>("[data-tool-record]").forEach(b => b.addEventListener("click", () => { void this.detail(b.dataset.toolRecord!); }));
    this.top();
  }
  async detail(id: string) {
    const newlyOpened = !this.dialog.open || this.detailId !== id;
    const event = (await storage.lifeEvents()).find(e => e.id === id);
    if (!event) { this.options.error("这条互动记录已不存在，聊天原文仍保留"); return; }
    await this.context(event.sessionId ?? event.groupId ?? (event.characterId && event.characterId !== "zhang-qiling" ? `private:${event.characterId}` : "private"));
    this.detailId = id; this.title(`${toolLabel(event.kind)}详情`);
    const people = toolPeople(event, this.group, this.userName).map(p => !event.people?.length && p.characterId && characters.some(c => c.id === p.characterId) ? { ...p, name: characters.find(c => c.id === p.characterId)!.name } : p), initiator = people.find(p => p.id === (event.initiatorId ?? (event.sender === "user" ? "user" : event.characterId))) ?? people[0];
    const created = new Date(event.createdAt).toLocaleString([], { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
    let html = "";
    if (event.kind === "group_collection") {
      const p = collectionProgress(event);
      html = `<section class="tool-detail-sheet"><div class="tool-initiator">${this.avatar(initiator)}<div><strong>${esc(initiator.name)}发起的群收款</strong><small>共${money(event.amount ?? 0)}，均摊为${event.participants?.length ?? 0}份，需收${money(p.target)}</small></div></div><p class="tool-detail-note">${esc(event.title)}</p><div class="tool-collection-hero"><strong class="${p.complete ? "complete" : ""}">${p.complete ? "已收齐" : "收款中"}</strong><span>已收到${money(p.received)}</span><small>${created}</small></div>${event.note ? `<p class="tool-detail-note">${esc(event.note)}</p>` : ""}${p.payable.includes("user") && !paid(event.responses?.user) && event.responses?.user !== "declined" ? `<button class="tool-primary" data-tool-action="join">参与 ${money(p.shares.user ?? 0)}（虚拟）</button>` : ""}</section><section class="tool-detail-sheet tool-participants"><h3>${p.count}人已参与 <small>共${p.payable.length}人需参与</small></h3>${(event.participants ?? []).map(id => { const person = people.find(p => p.id === id) ?? { id, name: "原群成员" }; return `<div class="tool-participant">${this.avatar(person)}<span>${esc(person.name)}${id === event.initiatorId ? "<small>发起人 · 自己的一份</small>" : ""}</span><b class="${paid(event.responses?.[id]) || id === event.initiatorId ? "paid" : ""}">${id === event.initiatorId ? "已分摊" : paid(event.responses?.[id]) ? "已参与" : event.responses?.[id] === "declined" ? "暂不参与" : "待参与"} ${money(p.shares[id] ?? 0)}</b></div>`; }).join("")}</section>`;
    } else if (event.kind === "chain") {
      const mine = event.chainItems?.find(i => i.ownerId === "user");
      html = `<section class="tool-detail-sheet tool-chain-head"><div class="tool-initiator">${this.avatar(initiator)}<div><strong>${esc(initiator.name)}发起的接龙</strong><small>${created}</small></div></div><h1>${esc(event.title)}</h1>${event.note ? `<p>${esc(event.note)}</p>` : ""}<small>${toolStatus(event)}${event.status === "settled" ? " · 已结束" : ""}</small></section><section class="tool-detail-sheet tool-chain-list">${(event.chainItems ?? []).map((item, i) => { const person = people.find(p => p.id === item.ownerId) ?? { id: "", name: item.name }; return `<article><span class="tool-chain-number">${i + 1}</span>${this.avatar(person)}<div><strong>${esc(item.name)}</strong><p>${esc(item.content)}</p></div></article>`; }).join("") || '<p class="tool-empty">还没有人填写。</p>'}</section>${event.status !== "settled" && event.status !== "declined" && canJoinChain(event, "user") ? `<form id="tool-chain-form" class="tool-chain-form"><label for="tool-chain-edit">${mine ? "修改我的接龙" : "接着填写"}</label><textarea id="tool-chain-edit" maxlength="160" required placeholder="写下你的内容">${esc(mine?.content ?? "")}</textarea><button type="submit" class="tool-primary">${mine ? "保存修改" : "加入接龙"}</button></form>` : ""}`;
    } else {
      const legacyRecipient = !event.recipientId && event.sender === "xiaopingzi";
      const recipient = people.find(p => p.id === event.recipientId);
      html = `<section class="tool-detail-sheet tool-transfer-hero ${event.kind}"><span class="tool-detail-symbol">${icon(event.kind)}</span><h1>${esc(event.kind === "gift" ? event.title : money(event.amount ?? 0))}</h1><strong>${toolStatus(event)}</strong><p>${esc(event.note ?? "")}</p><div class="tool-transfer-people">${this.avatar(initiator)}<span>${esc(initiator.name)}<small>发给 ${esc(recipient?.name ?? event.recipient ?? (legacyRecipient ? this.userName : "对方"))}</small></span></div>${event.status === "pending" && event.recipientId === "user" ? '<button type="button" class="tool-primary" data-tool-action="accept">收下</button><button type="button" class="tool-link" data-tool-action="decline">退回</button>' : ""}<small>${created}</small>${!event.recipientId ? '<small>历史记录按原状态保留</small>' : ""}</section>`;
    }
    this.body.innerHTML = html;
    if (!this.dialog.open) this.dialog.showModal();
    if (newlyOpened) this.top();
    void this.avatars();
    this.body.querySelectorAll<HTMLButtonElement>("[data-tool-action]").forEach(b => b.addEventListener("click", () => { void this.act(id, b.dataset.toolAction as "accept" | "decline" | "join"); }));
    this.body.querySelector("#tool-chain-form")?.addEventListener("submit", e => { e.preventDefault(); void this.act(id, "chain", this.input("tool-chain-edit")); });
  }
  private async act(id: string, action: "accept" | "decline" | "join" | "chain", content?: string) {
    if (this.saving) return;
    if (this.options.busy()) { this.error("请等当前操作完成"); return; }
    this.saving = true;
    this.body.querySelectorAll<HTMLButtonElement>("button").forEach(b => { b.disabled = true; });
    try { await this.options.action(id, action, content); await this.detail(id); }
    catch (error) { this.error(error); this.body.querySelectorAll<HTMLButtonElement>("button").forEach(b => { b.disabled = false; }); }
    finally { this.saving = false; }
  }
  async refresh() { if (this.dialog.open && this.detailId) await this.detail(this.detailId); }
  async hydrateCards(container: HTMLElement) {
    // Capture elements, so a slow IDB read cannot decorate a different conversation after navigation.
    const elements = Array.from(container.querySelectorAll<HTMLElement>("[data-tool-card]"));
    if (!elements.length) return;
    const events = await storage.lifeEvents();
    for (const element of elements) {
      if (!element.isConnected) continue;
      const event = events.find(e => e.id === element.dataset.toolCard);
      if (!event) continue; // Legacy/deleted records retain their original text, never fabricate a card.
      element.className = `tool-chat-card ${event.kind}`;
      const summary = event.kind === "chain" ? (event.chainItems ?? []).slice(0, 3).map((i, n) => `${n + 1}. ${i.name}：${i.content}`).join("\n") : toolStatus(event);
      element.innerHTML = `<span class="tool-card-main"><span class="tool-card-icon">${icon(event.kind)}</span><span><strong>${esc(event.kind === "transfer" ? money(event.amount ?? 0) : event.title)}</strong><span class="tool-card-summary">${esc(summary)}</span></span></span><span class="tool-card-footer">${toolLabel(event.kind)}<small>${event.kind === "chain" ? "查看并接龙" : event.kind === "gift" ? "心意已送达" : "虚拟互动"}</small><span>›</span></span>`;
      element.closest(".bubble")?.classList.add("tool-card-bubble");
      element.addEventListener("click", () => { void this.detail(event.id); });
    }
  }
}
