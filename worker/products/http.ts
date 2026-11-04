export class ProductHttpError extends Error { constructor(readonly reason: "TIMEOUT" | "UPSTREAM_ERROR") { super(reason); } }
export type Fetcher = typeof fetch;
export async function boundedText(response: Response, limit: number, signal: AbortSignal): Promise<string> {
  if (Number(response.headers.get("content-length")) > limit || !response.body) throw new ProductHttpError("UPSTREAM_ERROR");
  const reader = response.body.getReader(); let bytes = 0, output = "";
  const decoder = new TextDecoder();
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => { abort = () => reject(new ProductHttpError("TIMEOUT")); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort(); });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), cancelled]); if (part.done) break;
      bytes += part.value.byteLength; if (bytes > limit) throw new ProductHttpError("UPSTREAM_ERROR");
      output += decoder.decode(part.value, { stream: true });
    }
    return output + decoder.decode();
  } finally { signal.removeEventListener("abort", abort); void reader.cancel().catch(() => undefined); }
}
export async function fetchProductJson(url: string, init: RequestInit, fetcher: Fetcher = fetch): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetcher(url, { ...init, signal: controller.signal, redirect: "error", credentials: "omit" });
    const text = await boundedText(response, 512_000, controller.signal);
    return { status: response.status, body: JSON.parse(text) as unknown };
  } catch (error) { if (controller.signal.aborted) throw new ProductHttpError("TIMEOUT"); throw error; }
  finally { clearTimeout(timer); }
}
