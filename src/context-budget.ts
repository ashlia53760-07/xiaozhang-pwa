import type { ChatMessage, MemoryRecord, DateSession } from "./types";
import { chatEventText } from "./checkup";
import { collapsePhoneMessages } from "./phone-messages";

const dateSourceSignature = (messages: ChatMessage[]) => JSON.stringify(messages.map(row => [row.id, row.content]));
export function rememberDate(session: DateSession): void {
  const sources = session.messages.filter(row => row.content.trim()).slice(-6);
  if (!sources.length) return;
  const sourceSignature = dateSourceSignature(sources);
  if (session.localMemories?.some(row => row.sourceSignature === sourceSignature)) return;
  session.localMemories = [...(session.localMemories ?? []), {
    content: sources.map(row => `${row.role === "user" ? "用户" : row.speakerId || "场景叙事"}：${row.content.slice(0, 180)}`).join("；").slice(0, 1200),
    sourceMessageIds: sources.map(row => row.id), sourceSignature, createdAt: Date.now()
  }].slice(-12);
  session.updatedAt = Date.now();
}
export function dateMemoryContext(session?: DateSession): string {
  return (session?.localMemories ?? []).filter(memory => {
    const sources = memory.sourceMessageIds.map(id => session!.messages.find(row => row.id === id));
    return sources.every((row): row is ChatMessage => !!row) && dateSourceSignature(sources as ChatMessage[]) === memory.sourceSignature;
  }).slice(-3).map(row => row.content).join("\n").slice(0, 2400);
}

/** Conservative local estimate, not a provider tokenizer or billing count. */
export function contextUnits(text: string): number {
  let units = 0;
  for (const char of text) units += char.codePointAt(0)! > 127 ? 1 : 0.35;
  return Math.ceil(units);
}

export function clipContext(text: string, budget: number): string {
  if (contextUnits(text) <= budget) return text;
  let result = "", used = 0;
  for (const char of text) {
    used += char.codePointAt(0)! > 127 ? 1 : 0.35;
    if (used > Math.max(0, budget - 8)) break;
    result += char;
  }
  return result + "…（节选）";
}

/** Keep recent messages in order; shorten request copies, never stored records. */
export function boundedHistory(history: ChatMessage[], budget = 3200, limit = 8): ChatMessage[] {
  const selected: ChatMessage[] = [];
  let remaining = budget;
  for (const message of collapsePhoneMessages(history).slice(-limit).reverse()) {
    if (remaining < 24) break;
    const content = clipContext(chatEventText(message), Math.min(1400, remaining));
    if (!content.trim() || /^(?:null|undefined)+$/i.test(content.trim())) continue;
    selected.unshift({ ...message, content });
    remaining -= contextUnits(content) + 8;
  }
  return selected;
}

/** Rank locally: topic overlap first, then recency. No embedding/API expense. */
export function relevantMemories(values: MemoryRecord[], query: string): string {
  const terms = new Set((query.toLowerCase().match(/[a-z0-9]{2,}|[\u3400-\u9fff]{2,}/g) ?? [])
    .flatMap(term => /[\u3400-\u9fff]/.test(term) ? Array.from({ length: term.length - 1 }, (_, i) => term.slice(i, i + 2)) : [term]));
  const ranked = values.filter(value => value.enabled).map(value => ({ value,
    score: [...terms].filter(term => `${value.category} ${value.content}`.toLowerCase().includes(term)).length
  })).sort((a, b) => b.score - a.score || b.value.updatedAt - a.value.updatedAt);
  return clipContext(ranked.slice(0, 3).map(({ value }) => `- ${value.category}：${clipContext(value.content, 320)}`).join("\n"), 800);
}
