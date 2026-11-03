export type RoleAction =
  | { type: "gift"; title: string; note?: string }
  | { type: "transfer"; amount: number; note?: string }
  | { type: "group_collection"; title: string; amount: number; note?: string }
  | { type: "call"; mode: "voice" | "video"; reason?: string };

export interface ParsedRoleReply { text: string; action?: RoleAction }

const ACTION_RE = /\[\[\s*XZ_ACTION\s*:\s*([\s\S]*?)\s*\]\]|<xz-action>\s*([\s\S]*?)\s*<\/xz-action>/giu;

function shortText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().slice(0, max);
  return text || undefined;
}

function parseAction(value: unknown): RoleAction | undefined {
  if (!value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const type = typeof row.type === "string" ? row.type.toLowerCase().replace(/[ -]/g, "_") : "";
  if (type === "gift" || type === "role_gift") {
    const title = shortText(row.title ?? row.name, 60);
    if (!title) return undefined;
    return { type: "gift", title, note: shortText(row.note ?? row.description, 120) };
  }
  if (type === "transfer" || type === "role_transfer") {
    const amount = typeof row.amount === "number" ? row.amount : typeof row.amount === "string" ? Number(row.amount) : NaN;
    if (!Number.isFinite(amount) || amount < 0.01 || amount > 99999.99) return undefined;
    return { type: "transfer", amount: Math.round(amount * 100) / 100, note: shortText(row.note ?? row.description, 120) };
  }
  if (type === "group_collection" || type === "group_collect" || type === "collection") {
    const title = shortText(row.title ?? row.name ?? row.subject, 80);
    const amount = typeof row.amount === "number" ? row.amount : typeof row.amount === "string" ? Number(row.amount) : NaN;
    if (!title || !Number.isFinite(amount) || amount < 0.01 || amount > 99999.99) return undefined;
    return { type: "group_collection", title, amount: Math.round(amount * 100) / 100, note: shortText(row.note ?? row.description, 120) };
  }
  if (type === "call" || type === "voice_call" || type === "video_call") {
    const mode = type === "video_call" ? "video" : type === "voice_call" ? "voice" : row.mode === "video" ? "video" : row.mode === "voice" ? "voice" : undefined;
    if (!mode) return undefined;
    return { type: "call", mode, reason: shortText(row.reason ?? row.note, 120) };
  }
  return undefined;
}

/** Extracts a strictly structured, optional action and removes its marker from UI text. */
export function parseRoleReply(raw: string): ParsedRoleReply {
  let action: RoleAction | undefined;
  const text = raw.replace(ACTION_RE, (_full, jsonA, jsonB) => {
    if (!action) {
      try { action = parseAction(JSON.parse(String(jsonA ?? jsonB))); } catch { /* Invalid model marker stays ignored. */ }
    }
    return "";
  }).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text, action };
}

export const roleActionPrompt = `
【可选的角色主动互动协议】
只有在情境自然、确实想主动做一件事时，才可以触发一个动作；不要每轮触发，也不要为了完成协议硬凑。转账不是默认的关心方式，也不是用户提出后就必须执行；需要有明确用途，例如餐费、交通、临时支出、任务报酬或角色自然想表达的心意。根据当前角色的金钱观、资源处境、关系阶段和实际用途决定是否转账及金额，不把克制理解成一律拒绝或只给象征性金额，需要帮助时可以合理大方；不要凭空声称拥有巨额财富，不用金钱换取服从、亲密或关系升级。动作不会改变真实支付或设备权限，只会写入本机虚拟记录或打开通话界面。把动作标记放在回复末尾，标记不会展示给用户：
[[XZ_ACTION:{"type":"gift","title":"礼物名称","note":"可选备注"}]]
[[XZ_ACTION:{"type":"transfer","amount":20,"note":"可选说明"}]]
[[XZ_ACTION:{"type":"group_collection","title":"收款事项","amount":120,"note":"可选说明"}]]（只在群聊中使用；私聊不要使用，应用会自动把用户和当前群成员加入名单）
[[XZ_ACTION:{"type":"call","mode":"voice","reason":"可选原因"}]]
视频通话把 mode 写成 video。一次最多一个动作。不要在普通文字中解释 JSON、协议或程序字段。所有金额均为应用内虚拟记录，不是真实支付；没有明确用途或依据不足时，只发送普通文字，不要编造转账。`;
