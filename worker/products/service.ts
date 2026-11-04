import { MAX_PRODUCT_LINKS, parseProductLink, type ProductLink, type ProductResult, type ProductError } from "../../src/shopping";
import { boundedText, type Fetcher } from "./http";
import { queryTaobao, sourceReady, type ProductEnv } from "./taobao";

const buckets = new Map<string, { since: number; count: number }>();
function localLimit(key: string): boolean {
  const now = Date.now(), old = buckets.get(key), next = old && old.since > now - 60_000 ? old : { since: now, count: 0 };
  if (buckets.size > 2000) buckets.delete(buckets.keys().next().value!);
  buckets.set(key, next); return ++next.count <= 12;
}
export async function resolveProductLink(link: ProductLink, env: ProductEnv, fetcher: Fetcher = fetch): Promise<ProductLink> {
  if (link.kind !== "short") return link;
  if (env.ENABLE_SHORT_LINKS !== "true") return { ...link, kind: "invalid", code: "SHORT_LINK_UNSUPPORTED" };
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    let current = link;
    for (let hop = 0; hop < 4; hop++) {
      const url = new URL(current.rawUrl); url.protocol = "https:";
      const response = await fetcher(url.href, { method: "GET", redirect: "manual", signal: controller.signal, credentials: "omit", headers: { Accept: "text/html" } });
      void response.body?.cancel().catch(() => undefined);
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location"); if (!location) break;
      // Every redirect must again be an exact supported product/short-link domain AND path.
      const next = parseProductLink(new URL(location, url).href);
      if (next.kind === "item") return { ...next, rawUrl: link.rawUrl };
      if (next.kind !== "short") break;
      current = next;
    }
  } catch { /* No page execution, cookies, login or verification bypass. */ }
  finally { clearTimeout(timeout); }
  return { ...link, kind: "invalid", code: "SHORT_LINK_FAILED" };
}
function json(value: unknown, status = 200, origin?: string): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json;charset=UTF-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Vary": "Origin", ...(origin ? { "Access-Control-Allow-Origin": origin } : {}) } });
}
export async function handleProducts(request: Request, env: ProductEnv, fetcher: Fetcher = fetch): Promise<Response> {
  const origin = request.headers.get("Origin"), sameOrigin = new URL(request.url).origin;
  const allowedOrigin = env.ALLOWED_ORIGIN || sameOrigin;
  if (origin && origin !== allowedOrigin && origin !== sameOrigin) return json({ error: "ORIGIN_DENIED" }, 403);
  const corsOrigin = origin || allowedOrigin;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": corsOrigin, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Vary": "Origin", "Cache-Control": "no-store" } });
  if (request.method === "GET") return json({ version: 1, configured: sourceReady(env), maxLinks: MAX_PRODUCT_LINKS }, 200, corsOrigin);
  if (request.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, corsOrigin);
  if (!(request.headers.get("content-type") || "").toLowerCase().startsWith("application/json")) return json({ error: "JSON_REQUIRED" }, 415, corsOrigin);
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  let admitted = localLimit(ip);
  if (admitted && env.PRODUCT_RATE_LIMITER) {
    try { admitted = (await env.PRODUCT_RATE_LIMITER.limit({ key: ip })).success; } catch { admitted = false; }
  }
  if (!admitted) return json({ error: "RATE_LIMITED" }, 429, corsOrigin);
  let body: unknown;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000);
  try { body = JSON.parse(await boundedText(new Response(request.body, { headers: request.headers }), 16_384, controller.signal)); }
  catch { return json({ error: "INVALID_REQUEST" }, 400, corsOrigin); }
  finally { clearTimeout(timer); }
  const urls = body && typeof body === "object" ? (body as { urls?: unknown }).urls : undefined;
  if (!Array.isArray(urls) || !urls.length || urls.length > MAX_PRODUCT_LINKS || urls.some(url => typeof url !== "string" || url.length > 2000)) return json({ error: "INVALID_REQUEST" }, 400, corsOrigin);
  const results: ProductResult[] = [];
  // Bound concurrency and quota use. No client-selected upstream endpoint, headers or credentials.
  for (const rawUrl of urls as string[]) {
    const link = await resolveProductLink(parseProductLink(rawUrl), env, fetcher);
    if (link.kind === "invalid") { results.push({ rawUrl, status: "error", code: link.code ?? "INVALID_LINK" }); continue; }
    const product = await queryTaobao(link, env, fetcher);
    results.push(typeof product === "string" ? { rawUrl, status: "error", code: product as ProductError } : { rawUrl, status: "ok", product });
  }
  return json({ version: 1, checkedAt: Date.now(), results }, 200, corsOrigin);
}
