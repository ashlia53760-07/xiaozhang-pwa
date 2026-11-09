import type { ApiProfile, AudioAnalysisProfile, ChatMessage, ImageProfile, TtsProfile } from "./types";
import { boundedHistory, contextUnits } from "./context-budget";
import { modelPreferences, type RequestPurpose } from "./model-preferences";
import { beginUsage, finishUsage, requestBreakdown, usageCounts, type UsageCounts, type ContextParts } from "./model-usage";
import { assertUserPersona, assertPersonaText, assertPersonaReply, PERSONA_CONFLICT, USER_PERSONA_RULE, type UserPersona } from "./user-persona-policy";

type ApiMessage = { role: "system" | "user" | "assistant"; content: string };

// All chat users (including summaries and foreground social tasks) share one
// lane per endpoint/credential. Stream completion releases the lane, not headers.
type LimitKind = "rpm" | "tpm" | "concurrency" | "quota" | "unknown";
type RequestCost = { inputEstimate: number; outputLimit?: number; historyMessages: number; recentRequests?: number };
type LimitDetail = { kind: LimitKind; code?: string; type?: string; requestId?: string; retryAfter?: string; tokenLimit?: number; tokenUsed?: number; tokenRequested?: number; request?: RequestCost };
type TokenWindow = { remaining: number; resetAt: number; observedAt: number };
type ChatWait = { until: number; reason: "tokens" | "spacing" };
type ChatOptions = { maxOutputTokens?: number; onWait?: (wait: ChatWait) => void; purpose?: RequestPurpose; historyBudget?: number; historyLimit?: number; contextParts?: ContextParts; collectUsage?: (usage: UsageCounts) => void; userPersona?: UserPersona };
type ChatLane = { tail: Promise<void>; nextAt: number; retryAt: number; strikes: number; spacing: number; detail?: LimitDetail; tokenNextAt?: number; tokenPacingUntil?: number; tokenWindow?: TokenWindow; request?: RequestCost; sentAt?: number[] };
const chatLanes = new Map<string, ChatLane>();
function laneIdentity(profile: ApiProfile): string {
  const url = new URL(profile.baseUrl.trim());
  url.hash = "";
  // Both forms resolve to the same OpenAI-compatible request endpoint.
  url.pathname = url.pathname.replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
  return `${url.toString()}\n${profile.apiKey.trim()}`;
}
function chatLane(profile: ApiProfile): ChatLane {
  // In-memory only. Never persist or log the credential or this map key.
  const key = laneIdentity(profile);
  let lane = chatLanes.get(key);
  if (!lane) { lane = { tail: Promise.resolve(), nextAt: 0, retryAt: 0, strikes: 0, spacing: 1500 }; chatLanes.set(key, lane); }
  return lane;
}

export class ChatRateLimitError extends Error {
  constructor(readonly retryAt: number, readonly detail: LimitDetail = { kind: "unknown" }, readonly source: "response" | "cooldown" = "response") {
    const reason = { rpm: "服务商提示请求频率限制", tpm: "服务商提示 Token 速率限制", concurrency: "服务商提示并发限制", quota: "服务商提示额度或余额不足，请先检查账户", unknown: "服务商未明确限流类型，请检查限流或配额" }[detail.kind];
    const tooLarge = detail.tokenLimit !== undefined && detail.tokenRequested !== undefined && detail.tokenRequested > detail.tokenLimit;
    const quota = detail.tokenLimit === undefined ? "" : `；服务商报告 TPM 上限 ${detail.tokenLimit}${detail.tokenUsed === undefined ? "" : `，已用 ${detail.tokenUsed}`}${detail.tokenRequested === undefined ? "" : `，本次需求 ${detail.tokenRequested}`}`;
    const cost = detail.request ? `；本次输入估算约 ${detail.request.inputEstimate} Token${detail.request.outputLimit ? `，输出上限 ${detail.request.outputLimit}` : ""}，历史 ${detail.request.historyMessages} 条，本浏览器近60秒请求 ${detail.request.recentRequests ?? 1} 次` : "";
    super(`${source === "response" ? "聊天服务返回 HTTP 429，已暂停后续请求" : "上次 HTTP 429 的本地冷却仍生效，本次未发送新请求"}${tooLarge ? "，服务商报告单次需求已超过整分钟上限，单纯等待无法解决，需要调整请求大小或联系服务商提高限额" : `，请约 ${Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))} 秒后重试${detail.retryAfter ? "（服务商建议的等待时间）" : "（本地冷却，不代表服务端已恢复）"}`}；${reason}${detail.code ? `（错误码：${detail.code}）` : ""}${quota}${cost}${detail.requestId ? `；请求ID：${detail.requestId}` : ""}`);
    this.name = "ChatRateLimitError";
  }
}

// Keep only bounded identifiers, never provider prose (which may echo secrets).
function safeIdentifier(value: unknown, profile: ApiProfile): string | undefined {
  const text = typeof value === "string" || typeof value === "number" ? String(value) : "";
  return text && text.length <= 100 && /^[a-zA-Z0-9_.:-]+$/.test(text) && (!profile.apiKey.trim() || !text.includes(profile.apiKey.trim())) ? text : undefined;
}
async function limitDetail(profile: ApiProfile, response: Response): Promise<LimitDetail> {
  let body: Record<string, unknown> = {};
  const reader = response.body?.getReader();
  if (reader) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const text = await Promise.race([ (async () => {
        const decoder = new TextDecoder(); let text = "", bytes = 0;
        while (bytes <= 16_384) {
          const chunk = await reader.read(); if (chunk.done) return text + decoder.decode();
          bytes += chunk.value.byteLength; if (bytes > 16_384) break;
          text += decoder.decode(chunk.value, { stream: true });
        }
        return "";
      })(), new Promise<string>(resolve => { timer = setTimeout(() => resolve(""), 3000); }) ]);
      const parsed = JSON.parse(text); if (parsed && typeof parsed === "object") body = parsed;
    } catch { /* HTML, empty and oversized error bodies retain an unknown classification. */ }
    finally { clearTimeout(timer); void reader.cancel().catch(() => undefined); }
  }
  const error = body.error && typeof body.error === "object" ? body.error as Record<string, unknown> : body;
  const code = safeIdentifier(error.code, profile), type = safeIdentifier(error.type ?? error.status, profile);
  const rawMessage = typeof error.message === "string" ? error.message.slice(0, 4000) : "";
  const message = rawMessage.toLowerCase();
  const evidence = `${code ?? ""} ${type ?? ""} ${message}`.toLowerCase();
  const kind: LimitKind = /insufficient_quota|insufficient_balance|billing_hard_limit|余额不足|额度不足/.test(evidence) ? "quota"
    : /tokens?[ _-]*per[ _-]*min|\btpm\b|token_rate_limit/.test(evidence) ? "tpm"
    : /requests?[ _-]*per[ _-]*min|\brpm\b|request_rate_limit/.test(evidence) ? "rpm"
    : /concurren|并发/.test(evidence) ? "concurrency" : "unknown";
  const header = response.headers.get("retry-after")?.trim();
  const retryAfter = header && header.length <= 100 && (!profile.apiKey.trim() || !header.includes(profile.apiKey.trim())) && (/^\d+(?:\.\d+)?$/.test(header) || Number.isFinite(Date.parse(header))) ? header : undefined;
  // Extract only explicit numeric TPM evidence, never the provider prose,
  // account names, model routing labels, URLs, prompts or credentials.
  const count = (label: string): number | undefined => {
    if (kind !== "tpm") return;
    const match = message.match(new RegExp(`\\b${label}\\s*[:=]\\s*(\\d[\\d,]*(?:\\.\\d+)?)`, "i"));
    if (!match || profile.apiKey.trim() && match[1].includes(profile.apiKey.trim())) return;
    const number = Number(match[1].replaceAll(",", ""));
    return Number.isSafeInteger(number) && number >= 0 ? number : undefined;
  };
  const requestId = safeIdentifier(response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? response.headers.get("x-new-api-request-id") ?? error.request_id ?? body.request_id ?? rawMessage.match(/\brequest[ _-]?id\s*[:=]\s*([a-zA-Z0-9_.:-]{1,100})(?=[\s)\]]|$)/i)?.[1], profile);
  return { kind, code, type, requestId, retryAfter, tokenLimit: count("limit"), tokenUsed: count("used"), tokenRequested: count("requested") };
}
async function rateLimited(profile: ApiProfile, response: Response): Promise<ChatRateLimitError> {
  const lane = chatLane(profile), now = Date.now();
  // Set the header/default deadline immediately, before reading a potentially slow body.
  const value = response.headers.get("retry-after")?.trim();
  const seconds = value && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  const date = value && !Number.isFinite(seconds) ? Date.parse(value) : NaN;
  lane.strikes++;
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(date) ? date - now : Math.min(300_000, 30_000 * 2 ** Math.min(lane.strikes - 1, 4));
  lane.retryAt = Math.max(lane.retryAt, now + Math.max(1500, delay));
  lane.spacing = Math.min(10_000, Math.max(3000, lane.spacing * 2));
  lane.detail = await limitDetail(profile, response);
  lane.detail.request = lane.request && { ...lane.request };
  if (lane.detail.kind === "tpm") {
    // An RPM/concurrency gap is insufficient for a TPM window. When the
    // provider gives no usable budget, learn a conservative full-minute gap.
    lane.tokenPacingUntil = now + 30 * 60_000;
    lane.tokenNextAt = lane.retryAt;
  }
  if (lane.detail.kind === "quota" && !Number.isFinite(seconds) && !Number.isFinite(date)) lane.retryAt = Math.max(lane.retryAt, now + 300_000);
  return new ChatRateLimitError(lane.retryAt, lane.detail);
}

function tokenResetAt(value: string | null, now: number): number | undefined {
  if (!value || value.length > 100) return;
  const text = value.trim(); let result: number;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const n = Number(text);
    result = n > 1e12 ? n : n > 1e9 ? n * 1000 : now + n * 1000;
  } else if (/^(?:\d+(?:\.\d+)?(?:ms|h|m|s))+$/i.test(text)) {
    let duration = 0;
    for (const match of text.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/gi)) duration += Number(match[1]) * ({ ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[match[2].toLowerCase()] ?? 0);
    result = now + duration;
  } else result = Date.parse(text);
  return Number.isFinite(result) && result > now && result <= now + 24 * 60 * 60_000 ? result : undefined;
}

function observeTokenWindow(profile: ApiProfile, response: Response) {
  const header = response.headers.get("x-ratelimit-remaining-tokens") ?? response.headers.get("anthropic-ratelimit-tokens-remaining");
  if (!header || !/^\d+(?:\.\d+)?$/.test(header.trim())) return;
  const remaining = Number(header), now = Date.now();
  if (!Number.isFinite(remaining) || remaining < 0) return;
  const resetAt = tokenResetAt(response.headers.get("x-ratelimit-reset-tokens") ?? response.headers.get("anthropic-ratelimit-tokens-reset"), now) ?? now + 61_000;
  chatLane(profile).tokenWindow = { remaining, resetAt, observedAt: now };
}

function tokenWaitUntil(lane: ChatLane, estimatedTokens: number): number {
  const now = Date.now(), budget = lane.tokenWindow;
  const windowAt = budget && budget.resetAt > now && budget.remaining < estimatedTokens ? budget.resetAt : 0;
  const learnedAt = (lane.tokenPacingUntil ?? 0) > now ? lane.tokenNextAt ?? 0 : 0;
  // A header may describe another bucket in a gateway. A positive balance is
  // not evidence that the policy learned from a real TPM failure can be skipped.
  return Math.max(windowAt, learnedAt);
}

function recordChatRequest(profile: ApiProfile) {
  const lane = chatLane(profile), now = Date.now();
  lane.sentAt = [...(lane.sentAt ?? []).filter(at => at > now - 60_000), now].slice(-128);
  if (lane.request) lane.request.recentRequests = lane.sentAt.length;
}

const laneKeys = new Map<string, Promise<string | undefined>>();
function sharedLaneKey(profile: ApiProfile): Promise<string | undefined> {
  if (typeof window === "undefined" || !globalThis.crypto?.subtle) return Promise.resolve(undefined);
  const identity = laneIdentity(profile);
  let key = laneKeys.get(identity);
  if (!key) {
    // The browser lock/storage name contains an opaque digest, never the credential.
    key = crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity)).then(buffer =>
      "xiaozhang-chat-lane:" + Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, "0")).join("")).catch(() => undefined);
    laneKeys.set(identity, key);
  }
  return key;
}
function syncLane(key: string | undefined, lane: ChatLane) {
  if (!key) return;
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    if (!value || ![value.nextAt, value.retryAt, value.spacing, value.strikes].every(Number.isFinite)) return;
    lane.nextAt = Math.max(lane.nextAt, value.nextAt);
    lane.retryAt = Math.max(lane.retryAt, value.retryAt);
    lane.spacing = Math.max(lane.spacing, Math.min(10_000, value.spacing));
    lane.strikes = Math.max(lane.strikes, Math.min(5, value.strikes));
    if (Number.isFinite(value.tokenNextAt)) lane.tokenNextAt = Math.max(lane.tokenNextAt ?? 0, value.tokenNextAt);
    if (Number.isFinite(value.tokenPacingUntil)) lane.tokenPacingUntil = Math.max(lane.tokenPacingUntil ?? 0, value.tokenPacingUntil);
    // Upgrade the previous release's saved TPM cooldown in place. No clearing
    // storage or another failed request is needed to learn the slower policy.
    if (value.kind === "tpm" && !Number.isFinite(value.tokenPacingUntil) && value.retryAt + 30 * 60_000 > Date.now()) {
      lane.tokenPacingUntil = Math.max(lane.tokenPacingUntil ?? 0, value.retryAt + 30 * 60_000);
      lane.tokenNextAt = Math.max(lane.tokenNextAt ?? 0, value.retryAt);
    }
    const budget = value.tokenWindow;
    if (budget && [budget.remaining, budget.resetAt, budget.observedAt].every(Number.isFinite) && budget.remaining >= 0 && budget.observedAt >= (lane.tokenWindow?.observedAt ?? 0)) lane.tokenWindow = { remaining: budget.remaining, resetAt: budget.resetAt, observedAt: budget.observedAt };
    if (Array.isArray(value.sentAt)) lane.sentAt = [...new Set([...(lane.sentAt ?? []), ...value.sentAt.filter((at: unknown): at is number => typeof at === "number" && Number.isFinite(at) && at <= Date.now())])].filter(at => at > Date.now() - 60_000).sort((a, b) => a - b).slice(-128);
    // Persist only the reason category, not identifiers or raw response fields.
    if (["rpm", "tpm", "concurrency", "quota", "unknown"].includes(value.kind)) lane.detail = { kind: value.kind };
  } catch { /* Storage restrictions retain the in-page queue. */ }
}
function saveLane(key: string | undefined, lane: ChatLane) {
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify({ nextAt: lane.nextAt, retryAt: lane.retryAt, spacing: lane.spacing, strikes: lane.strikes, kind: lane.detail?.kind, tokenNextAt: lane.tokenNextAt, tokenPacingUntil: lane.tokenPacingUntil, tokenWindow: lane.tokenWindow, sentAt: lane.sentAt })); } catch { /* Private browsing/storage denied. */ }
}

function abortableWait(task: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("已取消请求", "AbortError"));
  return new Promise((resolve, reject) => {
    const abort = () => { signal?.removeEventListener("abort", abort); reject(new DOMException("已取消请求", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
    task.then(() => { signal?.removeEventListener("abort", abort); resolve(); }, error => { signal?.removeEventListener("abort", abort); reject(error); });
  });
}

async function pacedChat(profile: ApiProfile, task: () => Promise<string>, signal?: AbortSignal, estimatedTokens = 0, onWait?: ChatOptions["onWait"], cost?: RequestCost): Promise<string> {
  const lane = chatLane(profile);
  const key = await sharedLaneKey(profile);
  syncLane(key, lane);
  if (lane.retryAt > Date.now()) throw new ChatRateLimitError(lane.retryAt, lane.detail, "cooldown");
  const previous = lane.tail;
  let release!: () => void;
  const ticket = new Promise<void>(resolve => { release = resolve; });
  lane.tail = previous.then(() => ticket);
  try {
    await abortableWait(previous, signal);
    const run = async () => {
      while (true) {
        syncLane(key, lane);
        if (lane.retryAt > Date.now()) throw new ChatRateLimitError(lane.retryAt, lane.detail, "cooldown");
        const tokenAt = tokenWaitUntil(lane, estimatedTokens);
        const until = Math.max(lane.nextAt, tokenAt), delay = until - Date.now();
        if (delay <= 0) break;
        onWait?.({ until, reason: tokenAt > Date.now() ? "tokens" : "spacing" });
        let timer: ReturnType<typeof setTimeout> | undefined;
        try { await abortableWait(new Promise(resolve => { timer = setTimeout(resolve, Math.min(delay, 60_000)); }), signal); }
        finally { clearTimeout(timer); onWait?.({ until: 0, reason: "spacing" }); }
      }
      if (signal?.aborted) throw new DOMException("已取消请求", "AbortError");
      if (lane.tokenWindow && lane.tokenWindow.resetAt > Date.now()) {
        lane.tokenWindow = { ...lane.tokenWindow, remaining: Math.max(0, lane.tokenWindow.remaining - estimatedTokens), observedAt: Date.now() };
      }
      lane.request = cost && { ...cost };
      try { const text = await task(); lane.strikes = 0; lane.detail = undefined; return text; }
      finally {
        const now = Date.now();
        lane.nextAt = now + lane.spacing;
        if ((lane.tokenPacingUntil ?? 0) > now && lane.retryAt <= now) lane.tokenNextAt = now + 61_000;
        saveLane(key, lane);
        lane.request = undefined;
      }
    };
    // Hold the cross-tab lock until the response stream finishes. Browsers without
    // Web Locks still share persisted cooldown, with per-page request serialization.
    return key && typeof navigator !== "undefined" && navigator.locks
      ? await navigator.locks.request(key, { signal }, run) : await run();
  } finally {
    release();
  }
}

function endpoint(baseUrl: string): string {
  const value = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(value)) throw new Error("API 地址必须使用 HTTPS");
  return value.endsWith("/chat/completions") ? value : `${value}/chat/completions`;
}

function contentOf(value: unknown): string {
  if (typeof value === "string") return value.trim().toLowerCase() === "null" ? "" : value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => {
    if (!part || typeof part !== "object") return "";
    const item = part as Record<string, unknown>;
    if (["reasoning", "thinking", "reasoning_content", "thought"].includes(String(item.type))) return "";
    return typeof item.text === "string" ? item.text : typeof item.content === "string" ? item.content : "";
  }).join("");
}

function geminiText(root: Record<string, unknown>): string {
  const candidates = Array.isArray(root.candidates) ? root.candidates : [];
  const candidate = candidates[0];
  if (!candidate || typeof candidate !== "object") return "";
  const content = (candidate as Record<string, unknown>).content;
  if (!content || typeof content !== "object") return "";
  return contentOf((content as Record<string, unknown>).parts);
}

function geminiBase(baseUrl: string): string {
  const value = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(value)) throw new Error("API 地址必须使用 HTTPS");
  return value;
}

function geminiEndpoint(baseUrl: string, model: string, streaming: boolean, apiKey: string): string {
  const base = geminiBase(baseUrl);
  const action = streaming ? "streamGenerateContent" : "generateContent";
  const modelPath = encodeURIComponent(model.trim()).replace(/%2F/gi, "/");
  const endpoint = /:(?:streamGenerateContent|generateContent)(?:$|\?)/.test(base)
    ? base
    : `${base}${base.endsWith("/v1beta") ? "" : "/v1beta"}/models/${modelPath}:${action}`;
  const joiner = endpoint.includes("?") ? "&" : "?";
  return `${endpoint}${joiner}${streaming ? "alt=sse&" : ""}key=${encodeURIComponent(apiKey.trim())}`;
}

function geminiContents(history: ChatMessage[], current: string) {
  const values = history.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }]
  }));
  values.push({ role: "user", parts: [{ text: current }] });
  return values;
}

async function chatGemini(profile: ApiProfile, systemPrompt: string, history: ChatMessage[], current: string, onDelta: (full: string) => void, signal?: AbortSignal, maxOutputTokens?: number, collectUsage?: (usage: UsageCounts) => void): Promise<string> {
  if (!profile.apiKey.trim()) throw new Error("请先在设置中填写 API Key");
  const payload = { systemInstruction: { parts: [{ text: systemPrompt }] }, contents: geminiContents(history, current), generationConfig: { temperature: profile.temperature, ...(maxOutputTokens ? { maxOutputTokens } : {}) } };
  recordChatRequest(profile);
  const response = await fetch(geminiEndpoint(profile.baseUrl, profile.model, true, profile.apiKey), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal });
  observeTokenWindow(profile, response);
  if (response.status === 429) throw await rateLimited(profile, response);
  if (!response.ok) throw new Error(`Gemini 返回 HTTP ${response.status}`);
  const type = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!type.includes("event-stream") || !response.body) {
    const root = await response.json() as Record<string, unknown>;
    const usage = usageCounts(root, "gemini"); if (usage) collectUsage?.(usage);
    const result = geminiText(root);
    if (!result.trim()) throw new Error("Gemini 没有返回文字");
    onDelta(result);
    return result.trim();
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  const consume = (line: string) => {
    const text = line.slice(5).trim();
    if (!text || text === "[DONE]") return;
    let root: Record<string, unknown>;
    try { root = JSON.parse(text) as Record<string, unknown>; } catch { return; }
    const usage = usageCounts(root, "gemini"); if (usage) collectUsage?.(usage);
    const delta = geminiText(root);
    if (!delta) return;
    output += delta;
    if (output.length > 20000) throw new Error("模型回复过长");
    onDelta(output);
  };
  try { while (true) {
    const part = await reader.read();
    if (part.done) break;
    buffer += decoder.decode(part.value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.startsWith("data:")) consume(line);
  }
  if (buffer.startsWith("data:")) consume(buffer);
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  if (!output.trim()) throw new Error("Gemini 没有返回文字");
  return output.trim();
}

function historyMessages(history: ChatMessage[]): ApiMessage[] {
  return history.map((message) => ({
    role: message.role,
    content: message.content
  }));
}

export async function chat(
  profile: ApiProfile,
  systemPrompt: string,
  history: ChatMessage[],
  current: string,
  onDelta: (full: string) => void,
  signal?: AbortSignal,
  options: ChatOptions = {}
): Promise<string> {
  // Local estimate for admission only, never a billing/tokenizer claim. Include
  // system/persona, current input and requested output, not just chat history.
  const preferences = modelPreferences(), purpose = options.purpose ?? "other";
  if (options.userPersona || purpose === "private" || purpose === "scene") {
    assertUserPersona(options.userPersona ?? {});
    assertPersonaText(current);
    systemPrompt = USER_PERSONA_RULE + "\n\n" + systemPrompt;
    if (options.contextParts) options = { ...options, contextParts: { ...options.contextParts, rules: USER_PERSONA_RULE + "\n\n" + (options.contextParts.rules ?? "") } };
    const originalDelta = onDelta;
    onDelta = full => {
      assertPersonaReply(full);
      // Do not briefly render a conflict marker split across streaming chunks.
      if (!PERSONA_CONFLICT.startsWith(full.trimStart())) originalDelta(full);
    };
  }
  const cap = purpose === "private" ? preferences.privateOutput : purpose === "scene" ? preferences.sceneOutput : undefined;
  options = { ...options, historyBudget: options.historyBudget ?? (purpose === "scene" ? preferences.sceneHistory : preferences.privateHistory), historyLimit: options.historyLimit ?? 8,
    maxOutputTokens: cap ? Math.min(options.maxOutputTokens ?? cap, cap) : options.maxOutputTokens };
  const selected = boundedHistory(history, options.historyBudget, options.historyLimit);
  const cost: RequestCost = { inputEstimate: Math.ceil(contextUnits([systemPrompt, ...selected.map(m => m.content), current].join("\n")) * 1.5) + 128, outputLimit: options.maxOutputTokens, historyMessages: selected.length };
  const estimate = cost.inputEstimate + (options.maxOutputTokens ?? 0);
  const reply = await pacedChat(profile, () => requestChat(profile, systemPrompt, history, current, onDelta, signal, options), signal, estimate, options.onWait, cost);
  assertPersonaReply(reply);
  return reply;
}

async function requestChat(
  profile: ApiProfile, systemPrompt: string, history: ChatMessage[], current: string,
  onDelta: (full: string) => void, signal?: AbortSignal, options: ChatOptions = {}
): Promise<string> {
  history = boundedHistory(history, options.historyBudget, options.historyLimit);
  if (!profile.apiKey.trim()) throw new Error("请先在设置中填写 API Key");
  const breakdown = requestBreakdown(systemPrompt, history.map(m => m.content), current,options.contextParts);
  const model = profile.model.replaceAll(profile.apiKey.trim(), "[redacted]").slice(0, 100);
  const id = beginUsage({ purpose: options.purpose ?? "other", model, breakdown, estimate: Math.ceil(contextUnits([systemPrompt, ...history.map(m => m.content), current].join("\n")) * 1.5) + 128, outputLimit: options.maxOutputTokens, historyCount: history.length });
  let actual: UsageCounts | undefined;
  try {
    const result = await requestChatRaw(profile, systemPrompt, history, current, onDelta, signal, { ...options, collectUsage: usage => { actual = { ...actual, ...Object.fromEntries(Object.entries(usage).filter(([,v]) => v !== undefined)) }; } });
    finishUsage(id, "success", actual); return result;
  } catch (error) { finishUsage(id, signal?.aborted ? "cancelled" : "failed", actual); throw error; }
}

async function requestChatRaw(
  profile: ApiProfile, systemPrompt: string, history: ChatMessage[], current: string,
  onDelta: (full: string) => void, signal: AbortSignal | undefined, options: ChatOptions
): Promise<string> {
  if (profile.protocol === "gemini") return chatGemini(profile, systemPrompt, history, current, onDelta, signal, options.maxOutputTokens, options.collectUsage);
  if (!profile.apiKey.trim()) throw new Error("请先在设置中填写 API Key");
  const payload = {
    model: profile.model.trim(),
    temperature: profile.temperature,
    stream: true,
    ...(modelPreferences().requestUsage ? { stream_options: { include_usage: true } } : {}),
    ...(options.maxOutputTokens ? { max_tokens: options.maxOutputTokens } : {}),
    messages: [{ role: "system", content: systemPrompt }, ...historyMessages(history), { role: "user", content: current }]
  };
  recordChatRequest(profile);
  const response = await fetch(endpoint(profile.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${profile.apiKey.trim()}` },
    body: JSON.stringify(payload),
    signal
  });
  observeTokenWindow(profile, response);
  if (response.status === 429) throw await rateLimited(profile, response);
  if (!response.ok) throw new Error(`聊天服务返回 HTTP ${response.status}`);
  const type = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!type.includes("event-stream") || !response.body) {
    const root = await response.json() as Record<string, unknown>;
    const usage = usageCounts(root); if (usage) options.collectUsage?.(usage);
    const choice = (root.choices as Array<Record<string, unknown>> | undefined)?.[0];
    const result = contentOf((choice?.message as Record<string, unknown> | undefined)?.content);
    if (!result.trim()) throw new Error("模型没有返回文字");
    onDelta(result);
    return result.trim();
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  const consume = (line: string) => {
    const payloadText = line.slice(5).trim();
    if (!payloadText || payloadText === "[DONE]") return;
    let root: Record<string, unknown>;
    try { root = JSON.parse(payloadText) as Record<string, unknown>; } catch { return; }
    const usage = usageCounts(root); if (usage) options.collectUsage?.(usage);
    const choice = (root.choices as Array<Record<string, unknown>> | undefined)?.[0];
    const delta = (choice?.delta ?? choice?.message) as Record<string, unknown> | undefined;
    const text = contentOf(delta?.content);
    if (!text) return;
    output += text;
    if (output.length > 20000) throw new Error("模型回复过长");
    onDelta(output);
  };
  try { while (true) {
    const part = await reader.read();
    if (part.done) break;
    buffer += decoder.decode(part.value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) if (line.startsWith("data:")) consume(line);
  }
  if (buffer.startsWith("data:")) consume(buffer);
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  if (!output.trim()) throw new Error("模型没有返回文字");
  return output.trim();
}

function imageEndpoint(baseUrl: string): string {
  const value = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(value)) throw new Error("生图 API 地址必须使用 HTTPS");
  return value.endsWith("/images/generations") ? value : `${value}/images/generations`;
}

export async function generateImage(profile: ImageProfile, prompt: string, signal?: AbortSignal): Promise<Blob> {
  if (!profile.apiKey.trim()) throw new Error("请先在生图设置中填写 API Key");
  if (!prompt.trim()) throw new Error("图片描述不能为空");
  const response = await fetch(imageEndpoint(profile.baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${profile.apiKey.trim()}` },
    body: JSON.stringify({ model: profile.model.trim(), prompt: prompt.trim(), n: 1, size: "1024x1024" }),
    signal
  });
  const root = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`生图服务返回 HTTP ${response.status}`);
  const item = (root.data as Array<Record<string, unknown>> | undefined)?.[0];
  const base64 = typeof item?.b64_json === "string" ? item.b64_json : "";
  if (base64) {
    const binary = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    return new Blob([binary], { type: "image/png" });
  }
  const url = typeof item?.url === "string" ? item.url : "";
  if (!/^https:\/\//i.test(url)) throw new Error("生图响应没有可用图片内容");
  const image = await fetch(url, { signal });
  if (!image.ok) throw new Error("生成图片下载失败；图片 URL 可能已过期");
  return image.blob();
}

function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result ?? "");
      const comma = value.indexOf(",");
      resolve(comma >= 0 ? value.slice(comma + 1) : value);
    };
    reader.onerror = () => reject(reader.error ?? new Error("音频读取失败"));
    reader.readAsDataURL(blob);
  });
}

function audioFormat(mime: string): string {
  const value = mime.toLowerCase().split(";", 1)[0];
  if (value.includes("wav")) return "wav";
  if (value.includes("mp3") || value === "audio/mpeg") return "mp3";
  if (value.includes("mp4") || value.includes("m4a")) return "m4a";
  if (value.includes("ogg")) return "ogg";
  if (value.includes("webm")) return "webm";
  return "mp3";
}

function audioMime(mime: string): string {
  const value = mime.toLowerCase().split(";", 1)[0];
  if (value === "audio/x-m4a" || value === "audio/m4a") return "audio/mp4";
  if (value === "audio/mp3") return "audio/mpeg";
  if (value === "audio/x-wav") return "audio/wav";
  return value.startsWith("audio/") ? value : "audio/mpeg";
}

async function apiError(response: Response, label: string, apiKey: string): Promise<Error> {
  const raw = await response.text().catch(() => "");
  let detail = "";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const error = parsed.error;
    if (typeof error === "string") detail = error;
    else if (error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string") detail = String((error as Record<string, unknown>).message);
    else if (typeof parsed.message === "string") detail = parsed.message;
  } catch { /* 服务商可能返回非 JSON 错误页 */ }
  detail = detail.replace(/Bearer\s+[^\s]+/gi, "Bearer [已隐藏]").slice(0, 300);
  if (apiKey) detail = detail.replaceAll(apiKey, "[Key 已隐藏]");
  return new Error(`${label}返回 HTTP ${response.status}${detail ? `：${detail}` : ""}`);
}

export async function analyzeAudio(profile: AudioAnalysisProfile, blob: Blob, title: string, signal?: AbortSignal): Promise<string> {
  if (!profile.apiKey.trim()) throw new Error("未配置音乐分析 API Key");
  if (!blob.size) throw new Error("本地音频文件为空");
  if (blob.size > 20 * 1024 * 1024) throw new Error("音频超过 20 MB，当前接口不接受这么大的内嵌音频；请压缩后再试");
  const base64 = await blobBase64(blob);
  const instruction = `请分析这首用户本地音乐，标题是《${title || "未命名音乐"}》。只输出简短、谨慎的中文摘要，包含可合理判断的情绪、节奏和主题；无法从音频确定的歌词或事实不要编造。不要声称知道用户的真实经历。`;
  if (profile.provider === "openai") {
    const format = audioFormat(blob.type);
    if (format !== "wav" && format !== "mp3") throw new Error(`GPT 音频输入不接受当前 ${blob.type || format} 格式；请选择 Gemini 音频分析，或先转换为 WAV/MP3。`);
    const response = await fetch(endpoint(profile.baseUrl), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${profile.apiKey.trim()}` }, body: JSON.stringify({ model: profile.model.trim(), temperature: 0.2, stream: false, messages: [{ role: "user", content: [{ type: "text", text: instruction }, { type: "input_audio", input_audio: { data: base64, format: audioFormat(blob.type) } }] }] }), signal });
    if (!response.ok) throw await apiError(response, "GPT 音频分析", profile.apiKey.trim());
    const root = await response.json().catch(() => ({})) as Record<string, unknown>;
    const choice = (root.choices as Array<Record<string, unknown>> | undefined)?.[0];
    const result = contentOf((choice?.message as Record<string, unknown> | undefined)?.content);
    if (!result.trim()) throw new Error("GPT 音频分析没有返回摘要");
    return result.trim().slice(0, 1200);
  }
  const payload = { contents: [{ role: "user", parts: [{ text: instruction }, { inlineData: { mimeType: audioMime(blob.type), data: base64 } }] }] };
  const response = await fetch(`${geminiBase(profile.baseUrl)}${profile.baseUrl.replace(/\/+$/, "").endsWith("/v1beta") ? "" : "/v1beta"}/models/${encodeURIComponent(profile.model.trim()).replace(/%2F/gi, "/")}:generateContent?key=${encodeURIComponent(profile.apiKey.trim())}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal });
  if (!response.ok) throw await apiError(response, "Gemini 音频分析", profile.apiKey.trim());
  const root = await response.json().catch(() => ({})) as Record<string, unknown>;
  const result = geminiText(root);
  if (!result.trim()) throw new Error("Gemini 音频分析没有返回摘要");
  return result.trim().slice(0, 1200);
}

export async function synthesizeSpeech(profile: TtsProfile, text: string, signal?: AbortSignal): Promise<Blob> {
  if (!profile.apiKey.trim()) throw new Error("请先填写云端语音 API Key");
  if (!profile.voiceId.trim()) throw new Error("请先填写语音 Voice ID");
  const base = profile.baseUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(base)) throw new Error("语音 API 地址必须使用 HTTPS");
  if (profile.provider === "elevenlabs") {
    const response = await fetch(`${base}/v1/text-to-speech/${encodeURIComponent(profile.voiceId)}?output_format=mp3_44100_128`, { method: "POST", headers: { "Content-Type": "application/json", "xi-api-key": profile.apiKey.trim() }, body: JSON.stringify({ text: text.trim(), model_id: profile.model.trim() || "eleven_multilingual_v2", voice_settings: { stability: 0.5, similarity_boost: 0.75 } }), signal });
    if (!response.ok) throw new Error(`ElevenLabs 返回 HTTP ${response.status}`);
    return response.blob();
  }
  const url = `${base}/v1/t2a_v2${profile.groupId?.trim() ? `?GroupId=${encodeURIComponent(profile.groupId.trim())}` : ""}`;
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${profile.apiKey.trim()}` }, body: JSON.stringify({ model: profile.model.trim() || "speech-2.8-hd", text: text.trim(), stream: false, voice_setting: { voice_id: profile.voiceId.trim(), speed: 1, vol: 1, pitch: 0 }, audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 } }), signal });
  const root = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`MiniMax 返回 HTTP ${response.status}`);
  const baseResponse = (root.base_resp ?? {}) as Record<string, unknown>;
  if (typeof baseResponse.status_code === "number" && baseResponse.status_code !== 0) throw new Error("MiniMax 语音服务拒绝了请求");
  const data = (root.data ?? {}) as Record<string, unknown>;
  const audio = typeof data.audio === "string" ? data.audio : typeof root.audio === "string" ? root.audio : "";
  if (!audio) throw new Error("MiniMax 响应没有音频内容");
  if (!/^[0-9a-f]+$/i.test(audio) || audio.length % 2 !== 0) throw new Error("MiniMax 音频格式无效");
  const binary = Uint8Array.from({ length: audio.length / 2 }, (_, index) => Number.parseInt(audio.slice(index * 2, index * 2 + 2), 16));
  return new Blob([binary], { type: "audio/mpeg" });
}
