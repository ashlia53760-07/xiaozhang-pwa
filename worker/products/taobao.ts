import { createHash } from "node:crypto";
import { PRODUCT_TTL, canonicalProductUrl, validProduct, type ProductData, type ProductError, type ProductLink } from "../../src/shopping";
import { fetchProductJson, ProductHttpError, type Fetcher } from "./http";

export interface ProductEnv {
  PRODUCT_SOURCE?: string; TAOBAO_USE_APPROVED?: string; TBK_APP_KEY?: string; TBK_APP_SECRET?: string;
  ENABLE_SHORT_LINKS?: string; ALLOWED_ORIGIN?: string;
  PRODUCT_RATE_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}
export const sourceReady = (env: ProductEnv) => env.PRODUCT_SOURCE === "taobao-tbk" && env.TAOBAO_USE_APPROVED === "true" && !!env.TBK_APP_KEY && !!env.TBK_APP_SECRET;
export function topSign(params: Record<string, string>, secret: string): string {
  return createHash("md5").update(secret + Object.keys(params).sort().map(key => key + params[key]).join("") + secret, "utf8").digest("hex").toUpperCase();
}
function apiError(root: Record<string, unknown>): ProductError | undefined {
  const error = root.error_response as Record<string, unknown> | undefined;
  if (!error) return;
  // Unknown errors stay unknown. Provider prose/IDs never leave the service.
  const evidence = `${String(error.sub_code ?? "")} ${String(error.sub_msg ?? "")}`.slice(0, 2000);
  return /limit|quota|配额|限流|频率/i.test(evidence) ? "QUOTA_EXCEEDED" : /permission|authorize|权限|授权|invalid.app.key|invalid.signature/i.test(evidence) ? "PERMISSION_DENIED" : "UPSTREAM_ERROR";
}
/** Documented candidate adapter. Disabled until the project owner obtains and verifies scene-2 permission and display rights. */
export async function queryTaobao(link: ProductLink, env: ProductEnv, fetcher: Fetcher = fetch): Promise<ProductData | ProductError> {
  if (!sourceReady(env)) return "SOURCE_NOT_CONFIGURED";
  if (!link.itemId || !link.canonicalUrl) return "MISSING_ITEM_ID";
  const params: Record<string, string> = { method: "taobao.tbk.item.info.get", app_key: env.TBK_APP_KEY!, sign_method: "md5", format: "json", v: "2.0",
    timestamp: new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 19).replace("T", " "), num_iids: link.itemId, platform: "2", biz_scene_id: "2" };
  params.sign = topSign(params, env.TBK_APP_SECRET!);
  try {
    const response = await fetchProductJson("https://eco.taobao.com/router/rest", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: new URLSearchParams(params).toString() }, fetcher);
    if (response.status === 429) return "QUOTA_EXCEEDED";
    if ([401, 403].includes(response.status)) return "PERMISSION_DENIED";
    if (response.status !== 200 || !response.body || typeof response.body !== "object") return "UPSTREAM_ERROR";
    const root = response.body as Record<string, unknown>, failure = apiError(root); if (failure) return failure;
    const envelope = root.tbk_item_info_get_response as { results?: { n_tbk_item?: Array<Record<string, unknown>> } } | undefined;
    const rows = envelope?.results?.n_tbk_item;
    if (!Array.isArray(rows) || !rows.length) return "ITEM_UNAVAILABLE";
    const row = rows.find(item => String(item.num_iid) === link.itemId); if (!row) return "INCOMPLETE_DATA";
    const platform = Number(row.user_type) === 1 ? "tmall" : link.platform!, now = Date.now();
    // reserve_price is a list price, not proven historical/original pricing. Do not label it as 原价.
    return validProduct({ platform, itemId: link.itemId, title: row.title, image: row.pict_url, price: row.zk_final_price, shopName: row.nick,
      canonicalUrl: canonicalProductUrl(platform, link.itemId), fetchedAt: now, expiresAt: now + PRODUCT_TTL, source: "taobao.tbk.item.info.get",
      unavailableFields: ["originalPrice", "sku", "attributes", "description", "reviews", "stock"] }, link.rawUrl, now) ?? "INCOMPLETE_DATA";
  } catch (error) { return error instanceof ProductHttpError ? error.reason : "UPSTREAM_ERROR"; }
}
