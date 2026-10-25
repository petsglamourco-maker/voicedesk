/* global self, caches */
// VoiceDesk service worker (ADR 0024).
//
// It caches only the offline page and the app icons, never pages or customer data
// (OWASP MASVS-STORAGE). Page loads always go to the network; when the phone is offline,
// the offline page is shown instead. It also shows push notifications, whose text never
// contains customer details, and opens only VoiceDesk's own pages when one is tapped.
const CACHE = "voicedesk-shell-v1";
const SHELL = ["/offline", "/icons/icon-192.png", "/icons/badge-96.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  event.respondWith(
    fetch(request).catch(() =>
      caches.match("/offline").then((page) => page ?? new Response("Offline", { status: 503 })),
    ),
  );
});

/** Only VoiceDesk's own pages ("/t/…", "/va", "/today"); anything else opens Today. */
function safePath(value) {
  return typeof value === "string" && /^\/(?!\/)[\w\-/?=&.%]*$/.test(value) ? value : "/today";
}

self.addEventListener("push", (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" ? data.title : "VoiceDesk";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: typeof data.tag === "string" ? data.tag : undefined,
      renotify: Boolean(data.tag),
      requireInteraction: data.urgent === true,
      data: { path: safePath(data.path) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.path);
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          return client.navigate(target).then((c) => (c ?? client).focus());
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
