const CACHE = "xiaozhang-pwa-shell-v39";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./character/system_prompt.txt", "./character/offline_system_prompt.txt", "./character/images/standing.png", "./character/images/stretch.png", "./character/images/hold_chick.png", "./character/images/sword_chick.png", "./character/images/draw_sword.png", "./landscapes/mountain.svg", "./landscapes/seaside.svg"];
self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL);
    await cache.addAll(["./themes/rococo/bow.png", "./themes/rococo/quills.webp", "./themes/rococo/shell.webp", "./themes/rococo/seal.webp", "./themes/rococo/ribbon.webp", "./themes/rococo/paper-grain.png", "./themes/rococo/PinyonScript.ttf"]);
    // Vite fingerprints its entry scripts/styles; cache the actual deployed entries
    // before activating, including on the first visit before a worker controls it.
    const index = await cache.match("./index.html");
    const html = await index.text();
    const assets = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
      .map((match) => new URL(match[1], self.registration.scope))
      .filter((url) => url.origin === self.location.origin && url.pathname.startsWith(new URL("./assets/", self.registration.scope).pathname))
      .map((url) => url.href);
    await cache.addAll([...new Set(assets)]);
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (event) => { event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("xiaozhang-pwa-shell-") && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then((cache) => cache.put(event.request, copy)));
    }
    return response;
  }).catch(async () => {
    // Entry prefetches and crossorigin module requests can differ in Origin.
    // Fingerprinted public assets have identical bytes; Vary: Origin must not
    // prevent their offline restoration. Keep normal matching for user routes.
    const isBuiltAsset = new URL(event.request.url).pathname.startsWith(new URL("./assets/", self.registration.scope).pathname);
    const cached = await caches.match(event.request, { ignoreVary: isBuiltAsset });
    if (cached) return cached;
    if (event.request.mode === "navigate") return (await caches.match("./index.html")) ?? Response.error();
    return Response.error();
  }));
});
