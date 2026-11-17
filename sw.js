// Service worker: caches the app files so it works offline.
// When you change any app file, bump CACHE so phones fetch the new version.
const CACHE = "checklists-v5";
const FILES = ["./", "index.html", "style.css", "app.js", "cloud.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
// Network first (so updates show up), fall back to cache when offline.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  // Only cache our own files and the Firebase code. Never touch live database/login traffic.
  const url = new URL(e.request.url);
  const ours = url.origin === location.origin ||
    (url.hostname === "www.gstatic.com" && url.pathname.startsWith("/firebasejs/"));
  if (!ours) return;
  e.respondWith(
    fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request))
  );
});
