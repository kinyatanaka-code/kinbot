// kincall のページ：拡張機能が入っていることを知らせ、kincall からの「自動でサインイン」を受け取る（kincall のページからだけ）
document.documentElement.dataset.kcZoomExt = "1";
window.addEventListener("message", (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const d = e.data || {};
  if (d.source !== "kincall" || d.type !== "zoom-autologin") return;
  chrome.runtime.sendMessage({ type: "kc-zoom-start", cred: d.cred, open: d.open !== false }, (r) => {
    window.postMessage({ source: "kc-zoom-ext", type: "zoom-autologin-result", ok: !!(r && r.ok), error: r && r.error }, location.origin);
  });
});
// kinXs のメール配信：下書きを受け取って拡張機能に置き、メールワイズを開く（2026-11-10）
window.addEventListener("message", (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const d = e.data || {};
  if (d.source !== "kinxs" || d.type !== "mw-drafts") return;
  chrome.runtime.sendMessage({ type: "kx-mw-set", list: d.list || [], url: d.url || "" }, (r) => {
    window.postMessage({ source: "kc-zoom-ext", type: "mw-drafts-result", ok: !!(r && r.ok), error: r && r.error }, location.origin);
  });
});
document.documentElement.dataset.kxMwExt = "1";
try { document.documentElement.dataset.kbExtVer = chrome.runtime.getManifest().version; } catch {}   // 設定の「拡張機能」で、入っている版を出す

// メールワイズで読んで送れなかったメールを、kinbot の画面を開いている間に送り直す（同じ画面からなのでログインの印が確実に付く）。1分ごと（2026-11-11）
async function kbFlushMw() {
  try {
    const st = await chrome.storage.local.get(["kxMwPending", "kxMwDiag"]);
    if (st.kxMwDiag) document.documentElement.dataset.kbMwDiag = JSON.stringify(st.kxMwDiag);
    const items = st.kxMwPending || []; if (!items.length) return;
    const r = await fetch("/api/kinxs/mailwise/ingest", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }) });
    const j = await r.json().catch(() => null);
    if (j && j.ok) { await chrome.storage.local.set({ kxMwPending: [] }); const d = st.kxMwDiag || {}; d.sent = (d.sent || 0) + items.length; d.err = ""; d.flushAt = new Date().toISOString(); await chrome.storage.local.set({ kxMwDiag: d }); document.documentElement.dataset.kbMwDiag = JSON.stringify(d); }
  } catch {}
}
setTimeout(kbFlushMw, 3000); setInterval(kbFlushMw, 60 * 1000);

// MiiTel：送れなかった文字起こし・議事録を、kinbot の画面から送り直す（2026-11-12）
async function kbFlushMiitel() {
  try { const st = await chrome.storage.local.get(["kbMiitelPending", "kbMiitelCrawl", "kbMiitelSeen", "kbMiitelLast", "kbMtVidProg"]); if (st.kbMtVidProg) document.documentElement.dataset.kbMtVid = JSON.stringify(st.kbMtVidProg); if (st.kbMiitelCrawl) document.documentElement.dataset.kbMtCrawl = JSON.stringify(st.kbMiitelCrawl);
    document.documentElement.dataset.kbMtDiag = JSON.stringify({ seen: (st.kbMiitelSeen || []).slice(-30), last: (st.kbMiitelLast || []).slice(-10), pending: (st.kbMiitelPending || []).length });
    const items = st.kbMiitelPending || []; if (!items.length) return;
    // 1件ずつ送って、送れたものから消す（1件の失敗で全部が残り続けないように）
    const left = [];
    for (const it of items) { try { const r = await fetch("/api/mochica/miitel/capture", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [it] }) }); const j = await r.json().catch(() => null); if (!(j && j.ok)) left.push(it); } catch { left.push(it); } }
    await chrome.storage.local.set({ kbMiitelPending: left.slice(-60) }); } catch {}
}
setTimeout(kbFlushMiitel, 3000); setInterval(kbFlushMiitel, 15 * 1000);
document.documentElement.dataset.kbMiitelExt = "1";
window.addEventListener("message", (e) => { const d = e.data; if (!d || !d.__kbMiitelCrawl || e.source !== window) return;
  chrome.runtime.sendMessage({ type: "kb-miitel-crawl", urls: d.urls || [] }, (x) => window.postMessage({ __kbMiitelCrawlRes: true, ...(x || {}) }, "*")); });

// 拡張機能の合言葉（MiiTel の画面から kinbot へ送るときに使う）をもらってしまう（2026-11-12）
(async () => { try { const r = await fetch("/api/mochica/miitel/ext-token", { credentials: "include" }); const j = await r.json().catch(() => null); if (j && j.token) await chrome.storage.local.set({ kbExtToken: j.token }); } catch {} })();
