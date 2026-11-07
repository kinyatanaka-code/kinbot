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
