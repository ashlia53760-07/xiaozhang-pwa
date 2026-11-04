import { findProductLinks, MAX_PRODUCT_LINKS, productErrors, validShopping, type ProductResult, type ShoppingAttachment } from "./shopping";

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

/** Explicit utility action only. Ordinary RP messages never call this module. */
export async function readShoppingLinks(input: string, signal?: AbortSignal): Promise<ShoppingAttachment> {
  const links = findProductLinks(input);
  if (!links.length) throw Error("请在本页粘贴淘宝或天猫商品详情链接。");
  if (links.length > MAX_PRODUCT_LINKS) throw Error("一次最多读取 6 个商品，请分批比较。");
  const results: ProductResult[] = links.map(link => ({ rawUrl: link.rawUrl, status: "error", code: link.code ?? "UPSTREAM_ERROR" }));
  const pending = links.map((link, index) => ({ link, index })).filter(({ link }) => link.kind !== "invalid");
  if (pending.length) {
    const queried = await queryProducts(pending.map(({ link }) => link.rawUrl), signal);
    queried.results.forEach((result, index) => { results[pending[index].index] = result; });
  }
  return { version: 1, checkedAt: Date.now(), results };
}
