// MiiTel の会議ページが自分で取ってくる「文字起こし（phrases）」「議事録（summary）」などを横で受け取り、kinbot に渡す（2026-11-12 田中さん）
//   ページの中（MAIN）で動く。fetch と XHR の返事のうち /api/video/v2/video_details/<id>/(phrases|summary|topics|...) だけを写して、拡張機能へ postMessage する
(function () {
  if (window.__kbMiitelHook) return; window.__kbMiitelHook = true;
  const RE = /\/api\/video\/v2\/video_details\/([0-9a-f-]{20,})(?:\/(phrases|summary|topics|comments|settings|signed_cookie))?(?:[/?]|$)/i;
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
  const seen = new Set();
  let lastDetail = "";
  const note = (u) => { try { const U = new URL(String(u), location.href); const path = U.pathname;
      const dm = path.match(/\/video_details\/([0-9a-f-]{20,})/i); if (dm) lastDetail = dm[1];
      // 録画のファイル（MiiTel の画面の外の置き場：mp4・m3u8・ts・metadata.json、または会議の詳細の id を含むもの）
      const isMedia = !/\/api\//.test(path) && (/\.(mp4|m3u8|ts|m4a|webm|mpd)(\?|$)/i.test(path) || /metadata\.json$/i.test(path) || (lastDetail && path.includes(lastDetail)));
      if (isMedia && !seen.has("m:" + path)) { seen.add("m:" + path); window.postMessage({ __kbMiitel: true, kind: "media", detailId: lastDetail, videoId: vid(), url: U.origin + U.pathname, text: JSON.stringify({ url: U.href.slice(0, 2000), host: U.host, path }), title: document.title }, "*"); }
      if (!/\/api\//.test(path) && !isMedia) return; const key = isMedia ? U.host + path : path; if (seen.has(key)) return; seen.add(key); window.postMessage({ __kbMiitelSeen: true, path: isMedia ? `[録画] ${U.host}${path}` : path, page: location.pathname }, "*"); } catch {} };
  const of = window.fetch;
  window.fetch = async function (...a) {
    const r = await of.apply(this, a);
    try { const u = typeof a[0] === "string" ? a[0] : (a[0] && a[0].url) || ""; note(u); if (RE.test(u) || RE_LIST.test(u)) r.clone().text().then((t) => send(u, t)).catch(() => {}); } catch {}
    return r;
  };
  const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) { this.__kbU = u; note(u); return oo.call(this, m, u, ...rest); };
  XMLHttpRequest.prototype.send = function (...a) {
    try { if (RE.test(String(this.__kbU || "")) || RE_LIST.test(String(this.__kbU || ""))) this.addEventListener("load", () => { try { if (!this.responseType || this.responseType === "text" || this.responseType === "json") send(this.__kbU, this.responseType === "json" ? JSON.stringify(this.response) : this.responseText); } catch {} }); } catch {}
    return os.apply(this, a);
  };
  // ===== 録画の取り込み（#kbGrabVideo で開かれたとき）（2026-11-12）=====
  let tk = "", KB = "", grabbing = false;
  window.addEventListener("message", (e) => { const d = e.data; if (d && d.__kbExtToken && e.source === window) { tk = d.__kbExtToken; KB = d.kb; } });
  const prog = (o) => window.postMessage({ __kbMtVid: true, videoId: vid(), ...o }, "*");
  async function grab(m3u8) {
    if (grabbing || !/kbGrabVideo/.test(location.hash)) return; grabbing = true;
    try {
      for (let k = 0; k < 20 && !tk; k++) await new Promise((r) => setTimeout(r, 500));
      if (!tk) throw new Error("合言葉がありません（kinbot の画面を一度開いてください）");
      const pl = await (await fetch(m3u8, { credentials: "include" })).text();
      const lines = pl.split(/\r?\n/); const segs = []; let dur = 0;
      for (const ln of lines) { const m = ln.match(/^#EXTINF:([\d.]+)/); if (m) { dur = Number(m[1]); continue; } if (ln && !ln.startsWith("#")) { segs.push({ u: new URL(ln, m3u8).href, dur }); dur = 0; } }
      if (!segs.length) throw new Error("録画の細切れが見つかりません");
      for (let i = 0; i < segs.length; i++) {
        const b = await (await fetch(segs[i].u, { credentials: "include" })).arrayBuffer();
        let ok = false;
        for (let t = 0; t < 3 && !ok; t++) { const r = await fetch(`${KB}/api/mochica/miitel/ext/video/${vid()}/seg?i=${i}&total=${segs.length}&dur=${segs[i].dur}`, { method: "POST", headers: { "content-type": "application/octet-stream", "x-kb-ext": tk }, body: b }); const j = await r.json().catch(() => ({})); if (r.ok && j.ok) ok = true; else if (t === 2) throw new Error(j.error || `送れませんでした（${r.status}）`); }
        prog({ i: i + 1, total: segs.length });
      }
      prog({ done: true, total: segs.length });
    } catch (err) { prog({ error: String(err && err.message || err) }); }
  }
  const chkGrab = (u) => { try { if (/kbGrabVideo/.test(location.hash) && /\.m3u8(\?|$)/i.test(new URL(String(u), location.href).pathname)) grab(new URL(String(u), location.href).href); } catch {} };
  const of2 = window.fetch; window.fetch = function (...a) { try { chkGrab(typeof a[0] === "string" ? a[0] : (a[0] && a[0].url) || ""); } catch {} return of2.apply(this, a); };
  const oo2 = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (m, u, ...rest) { chkGrab(u); return oo2.call(this, m, u, ...rest); };
  // 再生が始まらないと録画を読みにいかないことがあるので、少しして動画を消音で再生してみる
  if (/kbGrabVideo/.test(location.hash)) setTimeout(() => { try { const v = document.querySelector("video"); if (v) { v.muted = true; v.play().catch(() => {}); } } catch {} }, 6000);
  // 90秒たっても録画の目次（m3u8）が見えなければ、あきらめて次へ（裏のタブを長く待たせない）
  if (/kbGrabVideo/.test(location.hash)) setTimeout(() => { if (!grabbing) prog({ error: "録画が見つかりませんでした（この会議には録画が無いか、見る権限がありません）" }); }, 90000);
})();
