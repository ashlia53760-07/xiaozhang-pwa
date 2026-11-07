import { contextUnits } from "./context-budget";
import type { RequestPurpose } from "./model-preferences";

export interface UsageCounts { input?: number; output?: number; cached?: number; reasoning?: number; total?: number }
export interface RequestBreakdown { rules: number; other?: number; history: number; summary: number; memories: number; current: number }
export interface ContextParts { rules?: string; summary?: string; memories?: string }
export interface UsageRecord {
  id: string; at: number; purpose: RequestPurpose; model: string; estimate: number;
  breakdown: RequestBreakdown; outputLimit?: number; historyCount: number;
  status: "pending" | "success" | "failed" | "cancelled"; actual?: UsageCounts;
}
const KEY = "xiaozhang-model-usage";
const EVENT = "xiaozhang-model-usage-changed";
const count = (n: unknown): number | undefined => typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
/** Accept only numeric provider counters, never provider prose or arbitrary response fields. */
export function usageCounts(root: Record<string, unknown>, protocol = "openai"): UsageCounts | undefined {
  const raw = protocol === "gemini" ? root.usageMetadata : root.usage;
  if (!raw || typeof raw !== "object") return;
  const u = raw as Record<string, unknown>;
  const details = u.prompt_tokens_details as Record<string, unknown> | undefined;
  const completion = u.completion_tokens_details as Record<string, unknown> | undefined;
  const result: UsageCounts = protocol === "gemini"
    ? { input: count(u.promptTokenCount), output: count(u.candidatesTokenCount), cached: count(u.cachedContentTokenCount), reasoning: count(u.thoughtsTokenCount), total: count(u.totalTokenCount) }
    : { input: count(u.prompt_tokens), output: count(u.completion_tokens), cached: count(details?.cached_tokens), reasoning: count(completion?.reasoning_tokens), total: count(u.total_tokens) };
  return Object.values(result).some(v => v !== undefined) ? result : undefined;
}
export function requestBreakdown(system: string, history: string[], current: string, parts?: ContextParts): RequestBreakdown {
  // Labels are approximate partitions for diagnosis, not tokenizer or billing claims.
  const summaryAt = system.indexOf("历史压缩笔记"), manualAt = system.indexOf("本场大总结");
  const start = [summaryAt, manualAt].filter(n => n >= 0).sort((a,b) => a-b)[0];
  const summary = parts?.summary !== undefined ? contextUnits(parts.summary) : start === undefined ? 0 : contextUnits(system.slice(start));
  const memoryParts = [...system.matchAll(/(?:本地记忆|已明确保存的记忆|共同记忆)[^\n]*\n?([^【]*?)(?=\n\n|【|$)/g)].map(m => m[0]);
  const memories = parts?.memories !== undefined ? contextUnits(parts.memories) : Math.min(Math.max(0, contextUnits(system) - summary), contextUnits(memoryParts.join("\n")));
  const rules = parts?.rules !== undefined ? contextUnits(parts.rules) : Math.max(0, contextUnits(system) - summary - memories);
  return { rules, other: Math.max(0, contextUnits(system)-rules-summary-memories), history: contextUnits(history.join("\n")), summary, memories, current: contextUnits(current) };
}
export function usageRecords(): UsageRecord[] {
  try {
    const rows = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(rows) ? rows.filter(r => r && typeof r.id === "string" && typeof r.model === "string" && Number.isFinite(r.at) && count(r.estimate) !== undefined
      && r.breakdown && ["rules","history","summary","memories","current"].every(k => count(r.breakdown[k]) !== undefined)
      && (r.breakdown.other === undefined || count(r.breakdown.other) !== undefined)
      && Number.isSafeInteger(r.historyCount) && r.historyCount >= 0
      && ["pending","success","failed","cancelled"].includes(r.status)
      && (!r.actual || ["input","output","cached","reasoning","total"].every(k => r.actual[k] === undefined || count(r.actual[k]) !== undefined))).slice(-100) : [];
  } catch { return []; }
}
function write(rows: UsageRecord[]) {
  try { localStorage.setItem(KEY, JSON.stringify(rows.slice(-100))); } catch { /* Metering must never break a reply. */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}
export function beginUsage(input: Omit<UsageRecord, "id" | "at" | "status">): string {
  const id = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  write([...usageRecords(), { ...input, id, at: Date.now(), status: "pending" }]);
  return id;
}
export function finishUsage(id: string, status: UsageRecord["status"], actual?: UsageCounts) {
  write(usageRecords().map(r => r.id === id ? { ...r, status, actual } : r));
}
export function clearUsage() { write([]); }
export const usageChangedEvent = EVENT;
