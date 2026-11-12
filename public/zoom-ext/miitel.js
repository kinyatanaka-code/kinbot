// MiiTel のページ（拡張機能の側）：miitel-hook.js から受け取った文字起こし・議事録を kinbot に送る（送れなければ kinbot の画面を開いたときに送り直す）（2026-11-12）
(function () {
  // 見た通り道（名前だけ）を残す：kinbot の画面で「拡張機能の様子」として出す（2026-11-12）
  window.addEventListener("message", async (e) => {
    const d = e.data; if (!d || !d.__kbMiitelSeen || e.source !== window) return;
    try { const st = await chrome.storage.local.get(["kbMiitelSeen"]); const l = (st.kbMiitelSeen || []).filter((x) => x.path !== d.path); l.push({ path: d.path, page: d.page, at: Date.now() }); await chrome.storage.local.set({ kbMiitelSeen: l.slice(-50) }); } catch {}
  });
  window.addEventListener("message", async (e) => {
    const d = e.data; if (!d || !d.__kbMiitel || e.source !== window) return;
    const item = { kind: d.kind, detailId: d.detailId, videoId: d.videoId, url: d.url, title: d.title, text: d.text, at: Date.now() };
    try {
      const res = await new Promise((resolve) => chrome.runtime.sendMessage({ type: "kb-miitel-capture", items: [item] }, (x) => resolve(x || {})));
      try { const st0 = await chrome.storage.local.get(["kbMiitelLast"]); const l0 = (st0.kbMiitelLast || []); l0.push({ kind: item.kind, ok: !!res.ok, status: res.status || "", len: String(item.text || "").length, at: Date.now() }); await chrome.storage.local.set({ kbMiitelLast: l0.slice(-20) }); } catch {}
      if (!res.ok) { const st = await chrome.storage.local.get(["kbMiitelPending"]); const pend = (st.kbMiitelPending || []).filter((p) => !(p.videoId === item.videoId && p.kind === item.kind)); pend.push(item); await chrome.storage.local.set({ kbMiitelPending: pend.slice(-60) }); }
    } catch {}
  });
})();

// 録画の取り込み：合言葉を MAIN（miitel-hook.js）へ渡し、進み具合と終わりを残す（2026-11-12）
(async () => { try { const tk = (await chrome.storage.local.get(["kbExtToken"])).kbExtToken || ""; const send = () => window.postMessage({ __kbExtToken: tk, kb: "https://kinbot-production-225f.up.railway.app" }, "*"); send(); setTimeout(send, 1500); setTimeout(send, 5000); } catch {} })();
window.addEventListener("message", async (e) => { const d = e.data; if (!d || !d.__kbMtVid || e.source !== window) return;
  try { await chrome.storage.local.set({ kbMtVidProg: { ...d, at: Date.now() } }); if (d.done || d.error) await chrome.storage.local.set({ kbMtVidDone: d.error ? "error" : "done" }); } catch {} });
