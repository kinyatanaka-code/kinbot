// MiiTel の会議ページが自分で取ってくる「文字起こし（phrases）」「議事録（summary）」などを横で受け取り、kinbot に渡す（2026-11-12 田中さん）
//   ページの中（MAIN）で動く。fetch と XHR の返事のうち /api/video/v2/video_details/<id>/(phrases|summary|topics|...) だけを写して、拡張機能へ postMessage する
(function () {
  if (window.__kbMiitelHook) return; window.__kbMiitelHook = true;
  const RE = /\/api\/video\/v2\/video_details\/([0-9a-f-]{20,})(?:\/(phrases|summary|topics|comments|settings))?(?:[/?]|$)/i;
  const vid = () => { const m = location.pathname.match(/\/app\/video\/([0-9a-f-]{20,})/i); return m ? m[1] : ""; };
  // 会議の一覧（会議履歴のページが取ってくる search／videos）も写す → kinbot に会議の一覧を入れる
  const RE_LIST = /\/api\/(?:video\/v\d+\/)?(?:videos|video_list|search)(?:[/?]|$)/i;
  const send = (url, text) => {
    try {
      if (text && text.length > 6000000) return;
      const m = String(url).match(RE);
      if (m) { window.postMessage({ __kbMiitel: true, kind: m[2] || "detail", detailId: m[1], videoId: vid(), url: String(url).split("?")[0], text, title: document.title }, "*"); return; }
      if (RE_LIST.test(String(url))) window.postMessage({ __kbMiitel: true, kind: "list", detailId: "", videoId: "list", url: String(url).split("?")[0], text, title: document.title }, "*");
    } catch {}
  };
  const of = window.fetch;
  window.fetch = async function (...a) {
    const r = await of.apply(this, a);
    try { const u = typeof a[0] === "string" ? a[0] : (a[0] && a[0].url) || ""; if (RE.test(u) || RE_LIST.test(u)) r.clone().text().then((t) => send(u, t)).catch(() => {}); } catch {}
    return r;
  };
  const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) { this.__kbU = u; return oo.call(this, m, u, ...rest); };
  XMLHttpRequest.prototype.send = function (...a) {
    try { if (RE.test(String(this.__kbU || "")) || RE_LIST.test(String(this.__kbU || ""))) this.addEventListener("load", () => { try { if (!this.responseType || this.responseType === "text" || this.responseType === "json") send(this.__kbU, this.responseType === "json" ? JSON.stringify(this.response) : this.responseText); } catch {} }); } catch {}
    return os.apply(this, a);
  };
})();
