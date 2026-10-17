// kinbot 商談の切り替え：ホーム画面に追加できるようにするための最小のサービスワーカー。
// 画面とアイコンだけ手元に持ち、APIはいつもネットから取る（録音の状態を古いまま見せないため）。
const C = "kinbot-switch-v2";
self.addEventListener("install", (e) => { e.waitUntil(caches.open(C).then((c) => c.addAll(["/switch.html", "/switch-icon-192.png"]).catch(() => {}))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k))))); self.clients.claim(); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.pathname.startsWith("/api/")) return;   // APIはそのまま
  if (u.pathname === "/switch.html") {
    e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(C).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));
  }
});
