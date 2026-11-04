import type { ChatMessage } from "./types";

export const PRODUCT_TTL = 15 * 60_000;
export const MAX_PRODUCT_LINKS = 6;
export type ProductPlatform = "taobao" | "tmall";
export type ProductError = "INVALID_LINK" | "MISSING_ITEM_ID" | "SHORT_LINK_FAILED" | "SHORT_LINK_UNSUPPORTED" | "SOURCE_NOT_CONFIGURED" | "PERMISSION_DENIED" | "QUOTA_EXCEEDED" | "TIMEOUT" | "UPSTREAM_ERROR" | "ITEM_UNAVAILABLE" | "ITEM_REMOVED" | "INCOMPLETE_DATA" | "TOO_MANY_LINKS" | "RATE_LIMITED";
export const productErrors: Record<ProductError, string> = {
  INVALID_LINK: "这不是受支持的淘宝或天猫商品链接。", MISSING_ITEM_ID: "链接中没有可确认的商品 ID，请发送商品详情链接。",
  SHORT_LINK_FAILED: "分享链接未能通过安全跳转解析，请发送商品详情链接。", SHORT_LINK_UNSUPPORTED: "暂不支持这条分享短链，请在商品页复制详情链接。",
  SOURCE_NOT_CONFIGURED: "商品数据源尚未获得并配置使用权限，暂时无法读取真实商品。", PERMISSION_DENIED: "商品数据接口当前没有查询权限。",
  QUOTA_EXCEEDED: "商品数据接口配额不足，请稍后重试。", TIMEOUT: "商品查询超时，请稍后重试。", UPSTREAM_ERROR: "商品数据服务暂时异常。",
  ITEM_UNAVAILABLE: "未能取得这个商品的信息；无法据此判断是否已下架。", ITEM_REMOVED: "数据源明确报告商品已下架。",
  INCOMPLETE_DATA: "没有取得可确认的商品标题或商品编号。", TOO_MANY_LINKS: "一次最多查询 6 个商品，这条请分开发送。", RATE_LIMITED: "商品查询过于频繁，请稍后重试。"
};
export interface ProductLink { rawUrl: string; kind: "item" | "short" | "invalid"; platform?: ProductPlatform; itemId?: string; canonicalUrl?: string; code?: ProductError }
export interface ProductData {
  platform: ProductPlatform; itemId: string; title: string; image?: string; price?: string; originalPrice?: string;
  shopName?: string; sku?: Array<{ name: string; price?: string }>; attributes?: Array<{ name: string; value: string }>;
  description?: string; productUrl: string; canonicalUrl: string; fetchedAt: number; expiresAt: number; source: string;
  unavailableFields: string[]; priceExpired?: boolean;
}
export interface ProductResult { rawUrl: string; status: "ok" | "error"; code?: ProductError; product?: ProductData }
export interface ShoppingAttachment { version: 1; results: ProductResult[]; checkedAt: number }
export interface ProductEvidence { json: string }
const itemHosts: Record<string, { platform: ProductPlatform; path: string }> = {
  "item.taobao.com": { platform: "taobao", path: "/item.htm" }, "detail.tmall.com": { platform: "tmall", path: "/item.htm" },
  "detail.m.tmall.com": { platform: "tmall", path: "/item.htm" }, "h5.m.taobao.com": { platform: "taobao", path: "/awp/core/detail.htm" }
};
const shortHosts = new Set(["m.tb.cn", "e.tb.cn"]);
export function canonicalProductUrl(platform: ProductPlatform, itemId: string): string {
  return `https://${platform === "tmall" ? "detail.tmall.com" : "item.taobao.com"}/item.htm?id=${itemId}`;
}
export function parseProductLink(rawUrl: string): ProductLink {
  const invalid = (code: ProductError = "INVALID_LINK"): ProductLink => ({ rawUrl, kind: "invalid", code });
  if (rawUrl.length > 2000 || /[\\\u0000-\u0020\u007f]/.test(rawUrl)) return invalid();
  let url: URL; try { url = new URL(rawUrl); } catch { return invalid(); }
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) return invalid();
  if (shortHosts.has(url.hostname)) return /^\/h\.[a-z0-9]{3,100}\/?$/i.test(url.pathname) ? { rawUrl, kind: "short" } : invalid();
  const host = itemHosts[url.hostname];
  if (!host || host.path !== url.pathname) return invalid();
  const ids = url.searchParams.getAll("id");
  if (ids.length !== 1 || !/^[1-9]\d{4,23}$/.test(ids[0])) return invalid("MISSING_ITEM_ID");
  return { rawUrl, kind: "item", platform: host.platform, itemId: ids[0], canonicalUrl: canonicalProductUrl(host.platform, ids[0]) };
}
/** Extract only exact platform hosts; unrelated URLs never trigger a shopping query. */
export function findProductLinks(text: string): ProductLink[] {
  const results: ProductLink[] = [], seen = new Set<string>();
  for (const match of text.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^\s<>"'“”《》，。；！？、（）【】]+/gi)) {
    const raw = match[0].replace(/[),，。；;！!？?）】\]…]+$/g, "");
    let url: URL; try { url = new URL(raw); } catch { continue; }
    if (!itemHosts[url.hostname] && !shortHosts.has(url.hostname) || seen.has(raw)) continue;
    seen.add(raw); results.push(parseProductLink(raw));
    if (results.length === 24) break;
  }
  return results;
}
export function safeProductImage(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2000) return;
  try {
    const url = new URL(value.startsWith("//") ? `https:${value}` : value);
    if (url.protocol === "http:") url.protocol = "https:";
    if (url.protocol === "https:" && !url.username && !url.password && !url.port && (url.hostname === "alicdn.com" || url.hostname.endsWith(".alicdn.com"))) return url.href;
  } catch { /* Invalid images are represented by a placeholder. */ }
}
const text = (v: unknown, max: number) => typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, max) : "";
const money = (v: unknown) => typeof v === "string" && /^\d{1,9}(?:\.\d{1,2})?$/.test(v) ? v : undefined;
export function validProduct(value: unknown, rawUrl: string, now = Date.now()): ProductData | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Record<string, unknown>, link = parseProductLink(String(v.canonicalUrl ?? ""));
  const original = parseProductLink(rawUrl);
  if (link.kind !== "item" || original.kind === "invalid" || original.itemId && original.itemId !== link.itemId || v.itemId !== link.itemId || v.platform !== link.platform) return;
  const title = text(v.title, 300), source = text(v.source, 100);
  if (!title || !source || typeof v.fetchedAt !== "number" || !Number.isFinite(v.fetchedAt) || v.fetchedAt <= 0 || v.fetchedAt > now + 60_000) return;
  const expiresAt = Math.min(typeof v.expiresAt === "number" && Number.isFinite(v.expiresAt) ? v.expiresAt : v.fetchedAt + PRODUCT_TTL, v.fetchedAt + PRODUCT_TTL);
  const expired = now >= expiresAt || v.priceExpired === true;
  const product: ProductData = { platform: link.platform!, itemId: link.itemId!, title, image: safeProductImage(v.image), shopName: text(v.shopName, 160) || undefined,
    productUrl: rawUrl, canonicalUrl: link.canonicalUrl!, fetchedAt: v.fetchedAt, expiresAt, source,
    unavailableFields: Array.isArray(v.unavailableFields) ? [...new Set(v.unavailableFields.filter((field): field is string => typeof field === "string" && /^[a-zA-Z]{1,32}$/.test(field)))].slice(0, 20) : [] };
  if (expired) product.priceExpired = true;
  else { product.price = money(v.price); product.originalPrice = money(v.originalPrice); }
  if (Array.isArray(v.sku)) product.sku = v.sku.slice(0, 16).flatMap(row => row && typeof row === "object" && text(row.name, 100) ? [{ name: text(row.name, 100), ...(!expired && money(row.price) ? { price: money(row.price) } : {}) }] : []);
  if (Array.isArray(v.attributes)) product.attributes = v.attributes.slice(0, 20).flatMap(row => row && typeof row === "object" && text(row.name, 80) && text(row.value, 160) ? [{ name: text(row.name, 80), value: text(row.value, 160) }] : []);
  product.description = text(v.description, 1000) || undefined;
  for (const field of ["image", "price", "originalPrice", "shopName", "sku", "attributes", "description"] as const) {
    if (!product[field] || Array.isArray(product[field]) && !product[field]?.length) product.unavailableFields.push(field);
  }
  product.unavailableFields = [...new Set(product.unavailableFields)];
  return product;
}
export function validShopping(value: unknown, now = Date.now()): ShoppingAttachment | undefined {
  if (!value || typeof value !== "object") return;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !Array.isArray(v.results) || typeof v.checkedAt !== "number" || !Number.isFinite(v.checkedAt)) return;
  const results = v.results.slice(0, 24).flatMap<ProductResult>(row => {
    if (!row || typeof row.rawUrl !== "string" || row.rawUrl.length > 2000) return [];
    const product = row.status === "ok" ? validProduct(row.product, row.rawUrl, now) : undefined;
    if (product) return [{ rawUrl: row.rawUrl, status: "ok", product }];
    const code: ProductError = row.status === "error" && Object.hasOwn(productErrors, row.code) ? row.code : "INCOMPLETE_DATA";
    return [{ rawUrl: row.rawUrl, status: "error", code }];
  });
  return results.length ? { version: 1, results, checkedAt: v.checkedAt } : undefined;
}
export function shoppingEvidence(rows: ChatMessage[], now = Date.now()): ProductEvidence | undefined {
  const results: Array<ProductResult & { messageId: string }> = [], ids = new Set<string>();
  for (const row of [...rows].reverse()) {
    if (row.metadata?.retractedAt || row.metadata?.hiddenAt) continue;
    const data = validShopping(row.metadata?.shopping, now); if (!data) continue;
    for (const result of data.results) {
      const key = result.product?.itemId ?? result.rawUrl;
      if (ids.has(key)) continue;
      ids.add(key); results.push({ ...result, messageId: row.id });
      if (results.length === MAX_PRODUCT_LINKS) break;
    }
    if (results.length === MAX_PRODUCT_LINKS) break;
  }
  if (!results.length) return;
  return { json: JSON.stringify({ kind: "untrusted_product_query_results", observedAt: now, results: results.reverse() }) };
}
export function wantsFreshProducts(text: string): boolean { return /(?:最新|现在|当前|实时).{0,8}(?:价格|价钱|多少钱|商品)|(?:更新|刷新|重查|重新查).{0,8}(?:价格|商品|这[几两些个])/u.test(text); }
