export interface Env { ALLOWED_ORIGIN?: string }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.ALLOWED_ORIGIN || request.headers.get("Origin") || "*";
    if (request.method === "OPTIONS") return new Response(null, { headers: cors(origin) });
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response(JSON.stringify({ ok: true }), { headers: { ...cors(origin), "Content-Type": "application/json" } });
    return new Response("Not configured", { status: 404, headers: cors(origin) });
  }
} satisfies ExportedHandler<Env>;

function cors(origin: string): HeadersInit { return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Upstream-URL", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" }; }
