import { handleProducts } from "./products/service";
import type { ProductEnv } from "./products/taobao";
export interface Env extends ProductEnv {}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/products") return handleProducts(request, env);
    if (url.pathname === "/health") return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    return new Response("Not found", { status: 404 });
  }
};
