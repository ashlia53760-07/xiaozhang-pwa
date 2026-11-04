import { storage } from "./storage";
import type { ChatMessage } from "./types";
import { findProductLinks, MAX_PRODUCT_LINKS, parseProductLink, productErrors, validShopping, shoppingEvidence, wantsFreshProducts, type ProductEvidence, type ProductResult, type ShoppingAttachment } from "./shopping";

export async function queryProducts(urls: string[], signal?: AbortSignal): Promise<ShoppingAttachment> {
  const controller = new AbortController(), abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
  const timer = setTimeout(abort, 75_000);
  try {
    const response = await fetch("/api/products", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls }), credentials: "omit", cache: "no-store", signal: controller.signal });
    if (!response.ok) throw response.status === 429 ? "RATE_LIMITED" : "UPSTREAM_ERROR";
    const reader = response.body?.getReader(); if (!reader) throw "UPSTREAM_ERROR";
    let bytes = 0, content = ""; const decoder = new TextDecoder();
    try {
      while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.byteLength; if (bytes > 128_000) throw "UPSTREAM_ERROR"; content += decoder.decode(part.value, { stream: true }); }
      content += decoder.decode();
    } finally { void reader.cancel().catch(() => undefined); }
    const data = validShopping(JSON.parse(content));
    if (!data || data.results.length !== urls.length || data.results.some((result, index) => result.rawUrl !== urls[index])) throw "UPSTREAM_ERROR";
    return data;
  } catch (error) {
    if (signal?.aborted) throw new DOMException("已取消商品查询", "AbortError");
    const code = controller.signal.aborted ? "TIMEOUT" : typeof error === "string" && Object.hasOwn(productErrors, error) ? error as keyof typeof productErrors : "UPSTREAM_ERROR";
    return { version: 1, checkedAt: Date.now(), results: urls.map(rawUrl => ({ rawUrl, status: "error", code })) };
  } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
}

/** Resolve once per user turn. Never import another conversation's products or overwrite a retracted/edited message. */
export async function prepareShopping(user: ChatMessage, signal?: AbortSignal): Promise<{ user: ChatMessage; evidence?: ProductEvidence }> {
  const session = user.sessionId ?? "private", revision = await storage.conversationRevision(session) ?? 0;
  await storage.pruneShoppingPrices();
  let rows = (await storage.sessionMessages(session)).filter(row => row.createdAt <= user.createdAt);
  const saved = rows.find(row => row.id === user.id);
  if (!saved || saved.metadata?.retractedAt || saved.metadata?.hiddenAt) throw Error("这条消息已经调整，请刷新后重新发送");
  user = saved;
  let links = user.kind === "text" ? findProductLinks(user.content) : [];
  const refresh = wantsFreshProducts(user.content);
  if (!links.length && refresh) {
    const previous = rows.flatMap(row => validShopping(row.metadata?.shopping)?.results ?? []);
    const seen = new Set<string>();
    links = previous.reverse().flatMap(result => {
      const link = parseProductLink(result.product?.canonicalUrl ?? result.rawUrl), key = link.itemId ?? link.rawUrl;
      if (link.kind === "invalid" || seen.has(key)) return [];
      seen.add(key); return [link];
    }).slice(0, MAX_PRODUCT_LINKS).reverse();
  }
  const existing = validShopping(user.metadata?.shopping);
  if (links.length && (!existing || refresh && existing.checkedAt < user.createdAt)) {
    const results: ProductResult[] = links.map((link, index) => ({ rawUrl: link.rawUrl, status: "error", code: index >= MAX_PRODUCT_LINKS ? "TOO_MANY_LINKS" : link.code ?? "UPSTREAM_ERROR" }));
    const pending = links.map((link, index) => ({ link, index })).filter(({ link, index }) => index < MAX_PRODUCT_LINKS && link.kind !== "invalid");
    // Reuse fresh, already-confirmed products in this conversation unless explicitly refreshed.
    const cached = rows.flatMap(row => validShopping(row.metadata?.shopping)?.results ?? []).reverse();
    const misses = pending.filter(({ link, index }) => {
      const found = !refresh ? cached.find(result => !!result.product && result.product.itemId === link.itemId && result.product.expiresAt > Date.now()) : undefined;
      if (!found?.product) return true;
      results[index] = { ...found, rawUrl: link.rawUrl, product: { ...found.product, productUrl: link.rawUrl } }; return false;
    });
    if (misses.length) {
      const queried = await queryProducts(misses.map(({ link }) => link.rawUrl), signal);
      queried.results.forEach((result, index) => { results[misses[index].index] = result; });
    }
    const shopping: ShoppingAttachment = { version: 1, checkedAt: Date.now(), results };
    const updated = await storage.attachShopping(user, shopping, revision);
    if (!updated) throw Error("会话已经调整，未保存过期的商品查询结果");
    user = updated;
    rows = rows.map(row => row.id === user.id ? user : row);
  }
  const followup = /这[两几些个].{0,12}(?:好|合适|怎么样|送|便宜|贵)|哪个|预算|性价比|材质|规格|SKU|尺码|面料|商品|价格|价钱|多少钱|送人|送礼|便宜|划算/i.test(user.content);
  return { user, evidence: links.length || refresh || followup ? shoppingEvidence(rows.slice(-40)) : undefined };
}
