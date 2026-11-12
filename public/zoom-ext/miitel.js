// MiiTel のページ（拡張機能の側）：miitel-hook.js から受け取った文字起こし・議事録を kinbot に送る（送れなければ kinbot の画面を開いたときに送り直す）（2026-11-12）
(function () {
  window.addEventListener("message", async (e) => {
    const d = e.data; if (!d || !d.__kbMiitel || e.source !== window) return;
    const item = { kind: d.kind, detailId: d.detailId, videoId: d.videoId, url: d.url, title: d.title, text: d.text, at: Date.now() };
    try {
      const res = await new Promise((resolve) => chrome.runtime.sendMessage({ type: "kb-miitel-capture", items: [item] }, (x) => resolve(x || {})));
      if (!res.ok) { const st = await chrome.storage.local.get(["kbMiitelPending"]); const pend = (st.kbMiitelPending || []).filter((p) => !(p.videoId === item.videoId && p.kind === item.kind)); pend.push(item); await chrome.storage.local.set({ kbMiitelPending: pend.slice(-60) }); }
    } catch {}
  });
})();
