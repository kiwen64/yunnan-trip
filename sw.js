const CACHE = "yunnan-trip-shell-v12";
const SHELL = ["./", "./index.html", "./styles.css", "./data.js", "./app.js", "./manifest.json", "./icon.svg"];
self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener("activate", event => event.waitUntil(Promise.all([
  self.clients.claim(),
  caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
])));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then(response => {
      caches.open(CACHE).then(cache => cache.put("./index.html", response.clone()));
      return response;
    }).catch(() => caches.match("./index.html")));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
    if (new URL(event.request.url).origin === location.origin) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => caches.match("./index.html"))));
});
