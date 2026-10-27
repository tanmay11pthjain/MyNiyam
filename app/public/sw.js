// MyNiyam service worker: lets the app open without internet, and shows reminders (web push).
// Pages: network first, the saved copy when offline. App files (/_next/static, /brand): saved once, they never change.
// The API is never cached here; the app keeps its own copy of Today (see src/client/offline.ts).
const CACHE = "myniyam-v2";
const PAGES = ["/home", "/who", "/login"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PAGES).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  if (req.mode === "navigate" && PAGES.includes(url.pathname)) {
    e.respondWith(fetch(req).then((res) => {
      if (res.ok && !res.redirected) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(url.pathname, copy)); }
      return res;
    }).catch(() => caches.match(url.pathname).then((hit) => hit || Response.error())));
  }
});

// Reminders: { title, body, url, tag } from the server (src/server/push.ts).
self.addEventListener("push", (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(m.title || "MyNiyam", {
    body: m.body || "", tag: m.tag || "myniyam", icon: "/brand/icon-512.png", badge: "/brand/favicon.png",
    data: { url: m.url || "/home" },
  }));
});

// Tapping a reminder opens MyNiyam (an open window if there is one).
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/home";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => new URL(c.url).origin === location.origin);
    if (open) { open.focus(); return open.navigate ? open.navigate(url) : undefined; }
    return self.clients.openWindow(url);
  }));
});
