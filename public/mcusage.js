// 画面のボタン・タブが「押された回数」と「画面に出ていた回数」を数えて、数分ごとにまとめて送る（2026-11-27 福井さん「使われない機能の引き算」）
//   使われていないボタン・タブを、オーナーが消すかどうか決める材料にするため。ここでは何も消さない・隠さない。
//   送るのはボタンの見分けの印（id・data-○○・短い文字）と回数だけ。会社名・電話などの中身は送らない（数字は # に置き換え、長い文字は送らない）。
//   mccall.js に入れずに別のファイルにしたのは、数え終わったら mochica.html の読み込みの1行を消すだけで外せるようにするため。
(function () {
  if (window.__mcUsage) return; window.__mcUsage = true;
  const SEND_MS = 3 * 60 * 1000;     // まとめて送る間隔
  const SCAN_MS = 60 * 1000;         // 画面に出ているボタンを数える間隔（同じページを開いている間は、1つのボタンを1回だけ数える）
  const SEL = "button, [role=tab], a[href^='#'], a[data-go], summary, select, input[type=checkbox], input[type=radio]";
  const box = new Map();             // key → { l, c, s }
  const seen = new Set();            // このページで「出ていた」と数えたもの
  const cut = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);

  // ボタンの見分けの印。id → data-○○ → 近くの id ＋ 短い文字 の順（会社名など中身の文字は使わない）
  function keyOf(el) {
    if (!el || !el.tagName) return "";
    if (el.id && !/\d{3,}/.test(el.id)) return "#" + el.id;
    for (const a of el.attributes || []) {
      if (!/^data-/.test(a.name) || /^data-(v|id|lead|log|i|n)$/.test(a.name)) continue;
      const v = String(a.value || "");
      return `[${a.name}${v && v.length <= 20 && !/\d{3,}|@/.test(v) ? "=" + v : ""}]`;
    }
    const t = cut(el.getAttribute("aria-label") || el.title || el.textContent, 40);
    if (!t || t.length > 14 || /\d{3,}|@|株式会社|有限会社/.test(t)) return "";
    const host = el.closest("[id]");
    return `${host && host.id && !/\d{3,}/.test(host.id) ? "#" + host.id + " " : ""}${el.tagName.toLowerCase()}:${t.replace(/\d/g, "#")}`;
  }
  const labelOf = (el) => cut(el.getAttribute("aria-label") || el.title || el.textContent, 30).replace(/\d{3,}/g, "#");
  function bump(el, f) {
    const k = keyOf(el); if (!k) return;
    const o = box.get(k) || { l: labelOf(el), c: 0, s: 0 }; o[f]++; box.set(k, o);
  }
  document.addEventListener("click", (e) => {
    try { const el = e.target && e.target.closest && e.target.closest(SEL); if (el) bump(el, "c"); } catch {}
  }, true);
  function scan() {
    try {
      for (const el of document.querySelectorAll(SEL)) {
        if (!el.offsetParent && el.getClientRects().length === 0) continue;   // 見えていないものは数えない
        const k = keyOf(el); if (!k || seen.has(k)) continue;
        seen.add(k); bump(el, "s");
      }
    } catch {}
  }
  function send(beacon) {
    if (!box.size) return;
    const items = [...box.entries()].slice(0, 300).map(([k, o]) => ({ k, l: o.l, c: o.c, s: o.s }));
    box.clear();
    const body = JSON.stringify({ items });
    try {
      if (beacon && navigator.sendBeacon) { navigator.sendBeacon("/api/mccall/ui-usage", new Blob([body], { type: "application/json" })); return; }
      fetch("/api/mccall/ui-usage", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true, credentials: "same-origin" }).catch(() => {});
    } catch {}
  }
  setTimeout(scan, 5000);
  setInterval(scan, SCAN_MS);
  setInterval(() => send(false), SEND_MS);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") { scan(); send(true); } });
})();
