// MiiTel の会議ページが自分で取ってくる「文字起こし（phrases）」「議事録（summary）」などを横で受け取り、kinbot に渡す（2026-11-12 田中さん）
//   ページの中（MAIN）で動く。fetch と XHR の返事のうち /api/video/v2/video_details/<id>/(phrases|summary|topics|...) だけを写して、拡張機能へ postMessage する
(function () {
  if (window.__kbMiitelHook) return; window.__kbMiitelHook = true;
  // 録画の取り込みの印（#kbGrabVideo）は、開いた瞬間に覚えておく（MiiTel の画面が読み込みのあと URL の # を消すので、あとで見ると無くなっていた：2026-11-13）
  const GRAB = /kbGrabVideo/.test(location.hash);
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
  const noteWrite = (method, u, body) => { try { const m0 = String(method || "GET").toUpperCase(); if (m0 === "GET") return; const U = new URL(String(u), location.href); if (!/\/api\//.test(U.pathname)) return;
      let keys = ""; try { const o = typeof body === "string" ? JSON.parse(body) : null; if (o && typeof o === "object") keys = Object.entries(o).map(([k, v]) => `${k}=${/url|link|title|name|meeting/i.test(k) ? String(v).slice(0, 60) : typeof v}`).join("&"); } catch { keys = typeof body; }
      window.postMessage({ __kbMiitelSeen: true, path: `[${m0}] ${U.pathname}${keys ? ` {${keys}}` : ""}`, page: location.pathname }, "*"); } catch {} };
  // ===== 過去の会議を読む：会議履歴一覧の頼み方を覚えて、ページをめくる（2026-11-15 田中さん「3月1日までの会議を全部」）=====
  let lastList = null;
  const hdrObj = (h) => { const o = {}; try { if (!h) return o; if (h instanceof Headers) h.forEach((v, k) => { o[k] = v; }); else if (Array.isArray(h)) h.forEach(([k, v]) => { o[k] = v; }); else Object.assign(o, h); } catch {} return o; };
  const of = window.fetch;
  window.fetch = async function (...a) {
    try { const u0 = typeof a[0] === "string" ? a[0] : (a[0] && a[0].url) || ""; if (RE_LIST.test(u0)) { const o0 = a[1] || {}; lastList = { url: new URL(u0, location.href).href, method: String(o0.method || (a[0] && a[0].method) || "GET").toUpperCase(), body: typeof o0.body === "string" ? o0.body : null, headers: { ...hdrObj(a[0] && a[0].headers), ...hdrObj(o0.headers) }, cred: o0.credentials || "same-origin", at: Date.now() }; } } catch {}
    try { const o0 = a[1] || {}; noteWrite(o0.method || (a[0] && a[0].method), typeof a[0] === "string" ? a[0] : (a[0] && a[0].url) || "", o0.body); } catch {}
    const r = await of.apply(this, a);
    try { const u = typeof a[0] === "string" ? a[0] : (a[0] && a[0].url) || ""; const o0 = a[1] || {};
      if (/\/api\//.test(u) && !RE.test(u) && /json/i.test(r.headers.get("content-type") || "")) r.clone().text().then((t) => maybeList({ url: new URL(u, location.href).href, method: String(o0.method || (a[0] && a[0].method) || "GET").toUpperCase(), body: typeof o0.body === "string" ? o0.body : null, headers: { ...hdrObj(a[0] && a[0].headers), ...hdrObj(o0.headers) }, cred: o0.credentials || "same-origin" }, t)).catch(() => {}); } catch {}
    try { const u = typeof a[0] === "string" ? a[0] : (a[0] && a[0].url) || ""; note(u); if (RE.test(u) || RE_LIST.test(u)) r.clone().text().then((t) => send(u, t)).catch(() => {}); } catch {}
    return r;
  };
  const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) { this.__kbU = u; note(u); return oo.call(this, m, u, ...rest); };
  const oo3 = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (m, u, ...rest) { this.__kbM = m; this.__kbH = {}; return oo3.call(this, m, u, ...rest); };
  const osh = XMLHttpRequest.prototype.setRequestHeader; XMLHttpRequest.prototype.setRequestHeader = function (k, v) { try { if (this.__kbH) this.__kbH[k] = v; } catch {} return osh.call(this, k, v); };
  XMLHttpRequest.prototype.send = function (...a) {
    try { noteWrite(this.__kbM, this.__kbU, a[0]); } catch {}
    try { const xr = this; const u1 = String(this.__kbU || ""); if (/\/api\//.test(u1) && !RE.test(u1)) { const info = { url: new URL(u1, location.href).href, method: String(this.__kbM || "GET").toUpperCase(), body: typeof a[0] === "string" ? a[0] : null, headers: { ...(this.__kbH || {}) }, cred: this.withCredentials ? "include" : "same-origin" };
        this.addEventListener("load", () => { try { if (!xr.responseType || xr.responseType === "text") maybeList(info, xr.responseText); else if (xr.responseType === "json") maybeList(info, JSON.stringify(xr.response)); } catch {} }); } } catch {}
    try { if (RE_LIST.test(String(this.__kbU || ""))) lastList = { url: new URL(String(this.__kbU), location.href).href, method: String(this.__kbM || "GET").toUpperCase(), body: typeof a[0] === "string" ? a[0] : null, headers: { ...(this.__kbH || {}) }, cred: this.withCredentials ? "include" : "same-origin", at: Date.now() }; } catch {}
    try { if (RE.test(String(this.__kbU || "")) || RE_LIST.test(String(this.__kbU || ""))) this.addEventListener("load", () => { try { if (!this.responseType || this.responseType === "text" || this.responseType === "json") send(this.__kbU, this.responseType === "json" ? JSON.stringify(this.response) : this.responseText); } catch {} }); } catch {}
    return os.apply(this, a);
  };
  const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const itemId = (x) => String(x.video_id || x.videoId || x.id || x.uuid || "");
  const itemAt = (x) => x.starts_at || x.started_at || x.start_at || x.startsAt || x.startedAt || x.startAt || x.start_time || x.started_time || x.date || x.created_at || x.createdAt;
  // 会議らしい並び（会議の id と題名と日時がある物が並ぶ）を返した頼みを、一覧として覚える
  function maybeList(info, text) { try { if (!text || text.length > 8000000 || !/^\s*[{[]/.test(text)) return; const j = JSON.parse(text); const arr = findArr(j); if (!arr || !arr.length) return;
      const ok = arr.filter((x) => isObj(x) && UUID.test(itemId(x)) && (x.title || x.name) && !isNaN(Date.parse(itemAt(x)))).length; if (ok < Math.max(1, arr.length * 0.6)) return;
      lastList = { ...info, at: Date.now() };
      if (!RE_LIST.test(info.url)) window.postMessage({ __kbMiitel: true, kind: "list", detailId: "", videoId: "list", url: info.url.split("?")[0], text, title: document.title }, "*");
    } catch {} }
  const findArr = (o, d = 0) => { if (Array.isArray(o) && o.some((x) => isObj(x) && itemId(x))) return o; if (!isObj(o) || d > 4) return null; for (const v of Object.values(o)) { const r = findArr(v, d + 1); if (r) return r; } return null; };
  const PAGE = /^(page|page_number|pageNumber|current_page|currentPage|p)$/i, OFF = /^(offset|from|start|skip)$/i, SIZE = /^(per_page|perPage|limit|size|page_size|pageSize|per)$/i;
  const prg = (o) => window.postMessage({ __kbMtBack: true, ...o }, "*");
  let backRunning = false, backStop = false;
  async function backfill(until) {
    if (backRunning) return; if (!lastList) { prg({ error: "会議の一覧が見えていません。会議履歴一覧を開き直して（F5）、一覧が出てから押してください" }); return; }
    backRunning = true; backStop = false;
    const L = lastList; const lim = new Date(until + "T00:00:00+09:00").getTime();
    let body = null; try { body = L.body ? JSON.parse(L.body) : null; } catch {}
    // めくり方：URL の ? の後ろか、本文（JSON）の中の page／offset と、1回の件数
    const U0 = new URL(L.url); const find = (re) => { for (const [k] of U0.searchParams) if (re.test(k)) return { q: k }; if (isObj(body)) { for (const k of Object.keys(body)) if (re.test(k)) return { b: k }; for (const [pk, pv] of Object.entries(body)) if (isObj(pv)) for (const k of Object.keys(pv)) if (re.test(k)) return { b: k, in: pk }; } return null; };
    let pg = find(PAGE), off = pg ? null : find(OFF); const sz = find(SIZE);
    const req = async (pageNo, offN, size) => { const U = new URL(L.url); let b = body ? JSON.parse(JSON.stringify(body)) : null;
      const set = (f, v) => { if (!f) return; if (f.q) U.searchParams.set(f.q, String(v)); else if (b) { if (f.in) b[f.in][f.b] = v; else b[f.b] = v; } };
      if (pg) set(pg, pageNo); else if (off) set(off, offN); else U.searchParams.set("page", String(pageNo)); if (sz && size) set(sz, size);
      const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 60000);
      try { const r = await of(U.href, { method: L.method, headers: L.headers, body: L.method === "GET" ? undefined : b ? JSON.stringify(b) : L.body, credentials: L.cred, signal: ac.signal }); if (!r.ok) throw new Error(`MiiTel から読めませんでした（${r.status}）`); return { url: U.href, text: await r.text() }; } finally { clearTimeout(tm); } };
    const dateOf = (x) => { const t = Date.parse(itemAt(x)); return isNaN(t) ? null : t; };
    let got = 0, pages = 0, prevSig = "", oldest = null; const size = sz ? 100 : 0;
    try {
      for (let p = 0; p < 500 && !backStop; p++) {
        const pageNo = (pg && /^0$/.test(String(U0.searchParams.get(pg.q || "") || (body && (pg.in ? body[pg.in][pg.b] : body[pg.b])) || ""))) ? p : p + 1;
        let r; try { r = await req(pageNo, p * (size || 25), size); } catch (e) { if (size && p === 0) { r = await req(pageNo, 0, 0); } else throw e; }
        let j = null; try { j = JSON.parse(r.text); } catch {} const arr = (j && findArr(j)) || [];
        if (!arr.length) break; const sig = JSON.stringify(arr[0]).slice(0, 200); if (sig === prevSig) break; prevSig = sig;
        window.postMessage({ __kbMiitel: true, kind: "list", detailId: "", videoId: "list", url: r.url.split("?")[0], text: r.text, title: document.title }, "*"); got += arr.length; pages++;
        const ds = arr.map(dateOf).filter((t) => t != null); if (ds.length) oldest = Math.min(...ds, oldest ?? Infinity);
        prg({ got, pages, oldest });
        if (oldest != null && oldest < lim) break;
        if (!pg && !off && p === 1 && pages === 2 && sig === prevSig) break;
        await new Promise((res) => setTimeout(res, 700));   // MiiTel に負担をかけないよう、少し間をあける
      }
      prg({ done: true, got, pages, oldest, stopped: backStop });
    } catch (e) { prg({ error: String(e && e.message || e), got, pages, oldest }); }
    finally { backRunning = false; }
  }
  window.addEventListener("message", (e) => { const d = e.data; if (!d || e.source !== window) return; if (d.__kbMtBackRun) backfill(d.until || "2026-03-01"); if (d.__kbMtBackStop) backStop = true; if (d.__kbMtBackAsk) prg({ ready: !!lastList, url: lastList ? lastList.url.replace(/\?.*$/, "") : "" }); });
  // ===== 録画の取り込み（#kbGrabVideo で開かれたとき）（2026-11-12）=====
  let tk = "", KB = "", grabbing = false;
  window.addEventListener("message", (e) => { const d = e.data; if (d && d.__kbExtToken && e.source === window) { tk = d.__kbExtToken; KB = d.kb; } });
  const prog = (o) => window.postMessage({ __kbMtVid: true, videoId: vid(), ...o }, "*");
  async function grab(m3u8) {
    if (grabbing || !GRAB) return; grabbing = true;
    try {
      for (let k = 0; k < 20 && !tk; k++) await new Promise((r) => setTimeout(r, 500));
      if (!tk) throw new Error("合言葉がありません（kinbot の画面を一度開いてください）");
      const tf = (u, o = {}) => { const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 60000); return fetch(u, { ...o, signal: ac.signal }).finally(() => clearTimeout(tm)); };
      const pl = await (await tf(m3u8, { credentials: "include" })).text();
      const lines = pl.split(/\r?\n/); const segs = []; let dur = 0;
      for (const ln of lines) { const m = ln.match(/^#EXTINF:([\d.]+)/); if (m) { dur = Number(m[1]); continue; } if (ln && !ln.startsWith("#")) { segs.push({ u: new URL(ln, m3u8).href, dur }); dur = 0; } }
      if (!segs.length) throw new Error("録画の細切れが見つかりません");
      for (let i = 0; i < segs.length; i++) {
        const b = await (await tf(segs[i].u, { credentials: "include" })).arrayBuffer();
        let ok = false;
        for (let t = 0; t < 3 && !ok; t++) { const r = await tf(`${KB}/api/mochica/miitel/ext/video/${vid()}/seg?i=${i}&total=${segs.length}&dur=${segs[i].dur}`, { method: "POST", headers: { "content-type": "application/octet-stream", "x-kb-ext": tk }, body: b }); const j = await r.json().catch(() => ({})); if (r.ok && j.ok) ok = true; else if (t === 2) throw new Error(j.error || `送れませんでした（${r.status}）`); }
        prog({ i: i + 1, total: segs.length });
      }
      prog({ done: true, total: segs.length });
    } catch (err) { prog({ error: String(err && err.message || err) }); }
  }
  const chkGrab = (u) => { try { if (GRAB && /\.m3u8(\?|$)/i.test(new URL(String(u), location.href).pathname)) grab(new URL(String(u), location.href).href); } catch {} };
  const of2 = window.fetch; window.fetch = function (...a) { try { chkGrab(typeof a[0] === "string" ? a[0] : (a[0] && a[0].url) || ""); } catch {} return of2.apply(this, a); };
  const oo2 = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function (m, u, ...rest) { chkGrab(u); return oo2.call(this, m, u, ...rest); };
  // 再生が始まらないと録画を読みにいかないことがあるので、少しして動画を消音で再生してみる
  if (GRAB) setTimeout(() => { try { const v = document.querySelector("video"); if (v) { v.muted = true; v.play().catch(() => {}); } } catch {} }, 6000);
  // 90秒たっても録画の目次（m3u8）が見えなければ、あきらめて次へ（裏のタブを長く待たせない）
  if (GRAB) setTimeout(() => { if (!grabbing) prog({ error: "録画が見つかりませんでした（この会議には録画が無いか、見る権限がありません）" }); }, 90000);
})();
