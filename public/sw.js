const CACHE_VERSION = "glasha-shell-v6";
const CORE = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable.png",
  "/icons/apple-touch-icon.png",
  "/glasha/avatar.webp",
  "/glasha/characters/home.webp",
  "/glasha/characters/work.webp",
  "/glasha/characters/health.webp",
  "/glasha/characters/learning.webp",
  "/glasha/characters/travel.webp",
  "/glasha/characters/documents.webp",
  "/glasha/characters/quick.webp",
  "/glasha/characters/ideas.webp",
  "/glasha/characters/cat.webp",
  "/glasha/characters/cooking.webp"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(CORE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

function isSafeStatic(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/glasha/") ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/offline.html"
  );
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache authenticated/API/auth traffic or signed/private responses.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    // Navigation HTML can reflect auth/session state. Never store it in Cache Storage.
    event.respondWith(
      fetch(request).catch(async () => {
        return (await caches.match("/offline.html")) || Response.error();
      })
    );
    return;
  }

  if (!isSafeStatic(url.pathname)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok && response.type === "basic") {
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, response.clone()));
        }
        return response;
      });
      return cached || network;
    })
  );
});
