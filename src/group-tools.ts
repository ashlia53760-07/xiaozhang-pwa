import type { ChatMessage, GroupRecord, LifeEventRecord } from "./types";

export const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
export const toolLabel = (kind: LifeEventRecord["kind"]) => ({ transfer: "转账", group_collection: "群收款", chain: "群接龙", gift: "礼物", bill: "账单", birthday: "生日" })[kind];
export const paid = (status: unknown) => status === "joined" || status === "settled";

/** Parse decimal currency exactly; never silently round an invalid input. */
export function parseMoney(value: string): number {
  if (!/^\d{1,5}(?:\.\d{1,2})?$/.test(value.trim())) throw Error("请输入 0.01–99999.99 之间的金额，最多两位小数");
  const [whole, decimal = ""] = value.trim().split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  if (cents < 1 || cents > 9999999) throw Error("金额应在 0.01–99999.99 之间");
  return cents;
}

/** Remainder cents go to the first participants, so the shares always sum exactly. */
export function splitShares(cents: number, ids: string[]): Record<string, number> {
  if (!Number.isInteger(cents) || cents < 1 || !ids.length || new Set(ids).size !== ids.length || cents < ids.length) throw Error("请选好参与成员，每人至少分摊 0.01");
  return Object.fromEntries(ids.map((id, i) => [id, Math.floor(cents / ids.length) + (i < cents % ids.length ? 1 : 0)]));
}

export function toolPeople(event: LifeEventRecord, group?: GroupRecord, userName = "我") {
  if (event.people?.length) return event.people;
  const ids = [...new Set([event.sender === "user" ? "user" : event.characterId ?? "character", ...(event.participants ?? []), ...(event.recipientId ? [event.recipientId] : [])])];
  return ids.map(id => {
    const member = group?.members.find(m => m.id === id);
    return { id, name: id === "user" ? userName : member?.name ?? (id === event.characterId ? "角色" : "原群成员"), characterId: member?.characterId ?? (id === event.characterId ? id : undefined) };
  });
}

export function collectionProgress(event: LifeEventRecord) {
  const ids = event.participants ?? [];
  const shares = event.shares ?? (ids.length && (event.amount ?? 0) >= ids.length ? splitShares(event.amount!, ids) : {});
  // Old records have no initiator share; keep their original participants/statuses intact.
  const payable = ids.filter(id => id !== event.initiatorId);
  const target = payable.reduce((n, id) => n + (shares[id] ?? 0), 0);
  const received = payable.reduce((n, id) => n + (paid(event.responses?.[id]) ? shares[id] ?? 0 : 0), 0);
  const count = payable.filter(id => paid(event.responses?.[id])).length;
  return { shares, payable, target, received, count, complete: payable.length > 0 && count === payable.length };
}

export function toolStatus(event: LifeEventRecord) {
  if (event.kind === "group_collection") {
    const p = collectionProgress(event);
    return p.complete ? "已收齐" : `${p.count}/${p.payable.length} 人已参与`;
  }
  if (event.kind === "chain") return `已有 ${event.chainItems?.length ?? 0} 人接龙`;
  if (event.status === "declined") return event.kind === "transfer" ? "已退还" : "未收下";
  if (event.status === "settled" || event.status === "accepted" || event.accepted) return event.kind === "gift" ? "已收下" : "已收款";
  return event.kind === "gift" ? "待收下" : "待收款";
}

export type ToolAction = { eventId: string; action: "join" | "decline" | "accept" | "chain"; content?: string };
export const canJoinChain = (event: LifeEventRecord, actorId: string) => !!event.participants?.includes(actorId) || (actorId === "user" && event.sender === "user");
export function parseToolReply(text: string): { text: string; action?: ToolAction } {
  let action: ToolAction | undefined;
  text = text.replace(/\[\[XZ_TOOL:([\s\S]*?)\]\]/gu, (_match, json) => {
    try {
      const r = JSON.parse(json);
      if (!action && typeof r.eventId === "string" && r.eventId.length <= 140 && ["join", "decline", "accept", "chain"].includes(r.action)) {
        const content = typeof r.content === "string" ? r.content.trim().slice(0, 160) : undefined;
        if (r.action !== "chain" || content) action = { eventId: r.eventId, action: r.action, content };
      }
    } catch { /* Invalid markers cannot change records. */ }
    return "";
  }).trim();
  return { text, action };
}

export function toolContext(events: LifeEventRecord[], session: string, actorId: string) {
  const scoped = events.filter(e => (e.sessionId ?? e.groupId) === session);
  // All members need the boundary, including those deliberately NOT selected.
  // `people` is a name/avatar snapshot, never a payment roster.
  const collections = scoped.filter(e => e.kind === "group_collection").sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
  const boundary = collections.length ? `\n【群收款的实际名单与本人权限】\n收款由发起人勾选名单决定，群成员不等于收款参与人，不能自行代付。未在名单内可以聊天，但不要声称已付、不要提交付款标记，也不要另发转账冒充参与。已完成或拒绝的操作不再重复。只把已保存的状态当成事实。\n${collections.map(e => `收款快照：${JSON.stringify({ eventId: e.id, title: e.title, participants: (e.participants ?? []).map(id => ({ id, name: e.people?.find(p => p.id === id)?.name ?? id, status: id === e.initiatorId ? "own_share" : e.responses?.[id] ?? "pending" })), selfId: actorId, selected: !!e.participants?.includes(actorId), selfStatus: e.responses?.[actorId] ?? "not_selected" })}`).join("\n")}\n` : "";
  const rows = scoped.filter(e =>
    e.kind === "group_collection" ? e.participants?.includes(actorId) && e.initiatorId !== actorId && !paid(e.responses?.[actorId]) && e.responses?.[actorId] !== "declined"
      : e.kind === "chain" ? e.status !== "settled" && e.status !== "declined" && canJoinChain(e, actorId)
        : (e.kind === "transfer" || e.kind === "gift") && e.recipientId === actorId && e.status === "pending"
  ).slice(0, 5);
  if (!rows.length) return boundary;
  return boundary + `\n【当前会话内可操作的仿真工具】\n以下是已保存的虚拟互动，不连接真实支付。你只能决定自己的参与，不能替其他成员付款或填写。不要仅在文字中声称操作成功；确实要操作时，在自然回复末尾附一条标记，程序成功后才会写入记录。可以拒绝或暂不参与，不要每轮重复接龙。\n${rows.map(e => JSON.stringify({ eventId: e.id, type: e.kind, title: e.title, amount: e.kind === "group_collection" ? money(collectionProgress(e).shares[actorId] ?? 0) : e.amount ? money(e.amount) : undefined, entries: e.chainItems?.slice(-8).map(i => ({ name: i.name, content: i.content })) })).join("\n")}\n群收款参与：[[XZ_TOOL:{"eventId":"对应ID","action":"join"}]]；转账或礼物收下用 accept；不参与用 decline；填写/修改本人接龙：[[XZ_TOOL:{"eventId":"对应ID","action":"chain","content":"你的内容"}]]。一次最多一项，不展示协议或字段。`;
}

/** Authorization and idempotence happen against the latest row inside one IDB transaction. */
export function applyToolAction(event: LifeEventRecord, action: ToolAction, actorId: string, actorName: string, now: number): LifeEventRecord | undefined {
  if (event.id !== action.eventId) return;
  if (event.kind === "group_collection") {
    if (!event.participants?.includes(actorId) || event.initiatorId === actorId || paid(event.responses?.[actorId]) || event.responses?.[actorId] === "declined") return;
    if (action.action !== "join" && action.action !== "decline") return;
    const next = { ...event, updatedAt: now, responses: { ...event.responses, [actorId]: action.action === "join" ? "settled" as const : "declined" as const } };
    next.status = collectionProgress(next).complete ? "settled" : "pending";
    return next;
  }
  if (event.kind === "chain") {
    if (action.action !== "chain" || !action.content?.trim() || !canJoinChain(event, actorId) || event.status === "settled" || event.status === "declined") return;
    const items = [...event.chainItems ?? []], existing = items.findIndex(i => i.ownerId === actorId);
    if (existing >= 0 && items[existing].content === action.content) return;
    const item = { id: existing >= 0 ? items[existing].id : `${event.id}:${actorId}`, name: actorName, content: action.content.trim().slice(0, 160), ownerId: actorId, createdAt: existing >= 0 ? items[existing].createdAt : now };
    if (existing >= 0) items[existing] = item; else items.push(item);
    return { ...event, chainItems: items, updatedAt: now };
  }
  if ((event.kind === "transfer" || event.kind === "gift") && event.recipientId === actorId && event.status === "pending" && ["accept", "decline"].includes(action.action)) {
    return { ...event, status: action.action === "accept" ? "settled" : "declined", accepted: action.action === "accept", updatedAt: now };
  }
}

export function toolNotice(event: LifeEventRecord, action: ToolAction, actor: string): string {
  if (event.kind === "chain") return `${actor}填写了接龙「${event.title}」：${action.content}`;
  if (event.kind === "group_collection") return `${actor}${action.action === "join" ? "参与了" : "暂不参与"}群收款「${event.title}」${collectionProgress(event).complete ? "，已收齐" : ""}（虚拟记录）`;
  return `${actor}${action.action === "accept" ? "收下了" : "退回了"}${toolLabel(event.kind)}「${event.title}」${event.kind === "transfer" ? "（虚拟记录）" : ""}`;
}

export function toolMessage(event: LifeEventRecord, content: string, role: ChatMessage["role"], speaker?: string): ChatMessage {
  return { id: `tool:${event.id}`, role, content, kind: "event", sessionId: event.sessionId ?? event.groupId, speakerId: speaker,
    metadata: { event: event.kind, lifeEventId: event.id, virtual: event.kind !== "chain", characterId: role === "assistant" ? event.characterId : undefined }, createdAt: event.createdAt };
}
