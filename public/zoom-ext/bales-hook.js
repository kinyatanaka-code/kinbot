// Bales Cloud の画面（ページの中＝MAIN で動く）：一覧のデータを横で受け取り、最後のページまでめくって kinbot に送る（2026-11-15 田中さん）
//   Bales は CSV が2000件まで・API なし。画面が自分で取ってくる一覧（JSON）を覚えておき、同じ頼み方でページだけ変えて取り直す。
//   ログインの鍵（Cookie・ヘッダー）は Bales の画面の中だけで使い、kinbot には送らない。
(function () {
  if (window.__kbBalesHook) return; window.__kbBalesHook = true;
  const cands = [];   // 一覧らしい返事を返した頼み方（新しい順に最大15）
  const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
  // 返事の中で、いちばん大きい「物の並び」を探す（どこにあるかも覚える）
  const findArr = (o, path = [], d = 0) => {
    if (Array.isArray(o)) { const objs = o.filter(isObj).length; return o.length && objs >= Math.max(1, o.length * 0.8) ? { path, arr: o } : null; }
    if (!isObj(o) || d > 5) return null; let best = null;
    for (const [k, v] of Object.entries(o)) { const r = findArr(v, [...path, k], d + 1); if (r && (!best || r.arr.length > best.arr.length)) best = r; }
    return best;
  };
  const TOTAL = /^(total|totalCount|total_count|totalElements|total_elements|totalItems|total_items|totalRecords|recordsTotal|totalSize|total_size|count|allCount|all_count)$/i;
  const findTotal = (o, d = 0) => { if (!isObj(o) || d > 4) return null; for (const [k, v] of Object.entries(o)) if (TOTAL.test(k) && typeof v === "number") return v; for (const v of Object.values(o)) { const t = findTotal(v, d + 1); if (t != null) return t; } return null; };
  const getAt = (o, path) => path.reduce((x, k) => (x == null ? x : x[k]), o);
  const hdrObj = (h) => { const o = {}; try { if (!h) return o; if (h instanceof Headers) h.forEach((v, k) => { o[k] = v; }); else if (Array.isArray(h)) h.forEach(([k, v]) => { o[k] = v; }); else Object.assign(o, h); } catch {} return o; };
  const looksLead = (keys) => keys.some((k) => /company|corp|会社|name|tel|phone|lead/i.test(k));
  // 見た通り道（名前と件数だけ。中身・鍵は残さない）：取り込めないときに、なぜかを kinbot で見るため（2026-11-15）
  const seen = new Map();
  const noteSeen = (req, info) => { try { const U = new URL(req.url); if (/\.(js|css|png|jpe?g|gif|svg|woff2?|ttf|ico|map|webp)(\?|$)/i.test(U.pathname)) return; const ep = req.method + " " + U.host + U.pathname; seen.set(ep, { ep, ...info, at: Date.now() }); if (seen.size > 60) seen.delete(seen.keys().next().value); } catch {} };
  window.__kbBalesSeen = () => [...seen.values()].sort((a, b) => b.at - a.at).slice(0, 40);
  // ===== リード1件の詳しい中身（架電履歴・カスタム情報など）の読み方を覚える（2026-11-15 田中さん「全部取り込みたい」）=====
  //   lead-list?callTargetId=<id> のページで、その id を含む GET の頼み方を「{id}」入りの形で覚える（Bales のページの保存場所に。鍵は入れない）
  const TPL_KEY = "kbBalesTpl";
  const loadTpl = () => { try { return JSON.parse(localStorage.getItem(TPL_KEY) || "{}"); } catch { return {}; } };
  let tpls = loadTpl();
  const lastAuth = {};   // API のホストごとの、いちばん新しい頼み方のヘッダー（ページの中だけで使う）
  const curLeadId = () => { const v = new URLSearchParams(location.search).get("callTargetId") || ""; return /^\d{3,}$/.test(v) ? v : ""; };
  const noteTpl = (req, text) => {
    try {
      const id = curLeadId(); if (!id || req.method !== "GET" || !/^\s*[[{]/.test(text || "")) return;
      const re = new RegExp(`(^|[^0-9])${id}(?![0-9])`, "g"); if (!re.test(req.url)) return;
      const u = req.url.replace(new RegExp(`(^|[^0-9])${id}(?![0-9])`, "g"), (m, a) => a + "{id}");
      const U = new URL(u); const name = (decodeURIComponent(U.pathname).replace(/^\/api\/(user\/)?/, "") + (U.search ? decodeURIComponent(U.search).replace(/[?&][^=]+=\{id\}/g, "") : "")).replace(/\{id\}\/?/g, "").replace(/\/$/, "") || "lead";
      tpls[name] = { u, at: Date.now() };
      const keys = Object.keys(tpls).sort((a, b) => tpls[b].at - tpls[a].at); for (const k of keys.slice(20)) delete tpls[k];
      localStorage.setItem(TPL_KEY, JSON.stringify(tpls));
    } catch {}
  };
  const noteAuth = (req) => { try { const h = new URL(req.url).host; if (h !== location.host || Object.keys(req.headers || {}).length) lastAuth[h] = { headers: req.headers || {}, cred: req.cred || "same-origin" }; } catch {} };
  const onResp = (req, text, ct, status) => {
    try { noteAuth(req); if (status >= 200 && status < 300) noteTpl(req, text); } catch {}
    try {
      noteSeen(req, { ct: String(ct || "").slice(0, 40), status, len: (text || "").length, arr: -1 });
      if (!text || text.length > 30000000 || !/^\s*[[{]/.test(text)) return;
      const j = JSON.parse(text); const f = findArr(j); try { const U = new URL(req.url); const s0 = seen.get(req.method + " " + U.host + U.pathname); if (s0) s0.arr = f ? f.arr.length : 0; } catch {} if (!f) return;
      const keys = Object.keys(f.arr[0] || {});
      const c = { ...req, path: f.path, n: f.arr.length, total: findTotal(j), keys: keys.slice(0, 40), lead: looksLead(keys), at: Date.now(), firstSig: JSON.stringify(f.arr[0]).slice(0, 200) };
      const ep = c.method + " " + String(c.url).split("?")[0];
      const i = cands.findIndex((x) => x.method + " " + String(x.url).split("?")[0] === ep); if (i >= 0) cands.splice(i, 1);
      cands.unshift(c); if (cands.length > 15) cands.pop();
    } catch {}
  };
  // fetch と XHR の返事を写す（JSON のものだけ）
  const of = window.fetch;
  window.fetch = async function (...a) {
    let req = null;
    try { const r0 = a[0]; const o = a[1] || {}; const url = typeof r0 === "string" ? r0 : r0 instanceof URL ? r0.href : (r0 && r0.url) || ""; req = { url: new URL(url, location.href).href, method: String(o.method || (r0 && r0.method) || "GET").toUpperCase(), headers: { ...hdrObj(r0 && r0.headers), ...hdrObj(o.headers) }, body: typeof o.body === "string" ? o.body : null, cred: o.credentials || (r0 && r0.credentials) || "same-origin", via: "fetch" }; } catch {}
    const r = await of.apply(this, a);
    try { const ct = r.headers.get("content-type") || ""; if (req && (/json|text\/plain/i.test(ct) || !ct)) r.clone().text().then((t) => onResp(req, t, ct, r.status)).catch(() => {}); else if (req) noteSeen(req, { ct: ct.slice(0, 40), status: r.status, len: -1, arr: -1 }); } catch {}
    return r;
  };
  const XO = XMLHttpRequest.prototype.open, XH = XMLHttpRequest.prototype.setRequestHeader, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) { try { this.__kb = { url: new URL(String(u), location.href).href, method: String(m || "GET").toUpperCase(), headers: {}, body: null, via: "xhr" }; } catch {} return XO.call(this, m, u, ...rest); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { try { if (this.__kb) this.__kb.headers[k] = v; } catch {} return XH.call(this, k, v); };
  XMLHttpRequest.prototype.send = function (b) {
    try { if (this.__kb) { this.__kb.body = typeof b === "string" ? b : null; this.__kb.cred = this.withCredentials ? "include" : "same-origin"; const req = this.__kb; this.addEventListener("load", () => { try { const ct = this.getResponseHeader("content-type") || ""; if (!(/json|text\/plain/i.test(ct) || !ct || this.responseType === "json")) { noteSeen(req, { ct: ct.slice(0, 40), status: this.status, len: -1, arr: -1 }); return; } onResp(req, this.responseType === "json" ? JSON.stringify(this.response) : (this.responseType === "" || this.responseType === "text") ? this.responseText : "", ct, this.status); } catch {} }); } } catch {}
    return XS.call(this, b);
  };

  // ===== ページのめくり方を見つける =====
  const PAGE = /^(page|pageNo|page_no|pageNum|page_num|pageNumber|page_number|currentPage|current_page|pageIndex|page_index|p)$/i;
  const OFFSET = /^(offset|skip|start|from|startIndex|start_index|first)$/i;
  const SIZE = /^(limit|per_page|perPage|per|size|pageSize|page_size|rows|take|max|maxResults|max_results|count)$/i;
  const LISTID = /(list|segment|group|view|filter).*(id|key)$|^(listId|list_id|leadListId|lead_list_id)$/i;
  // 頼み方の中（URL の ? の後ろと、JSON の本文）から、ページ・ずらし・件数の項目を探す
  function pagerOf(c) {
    const U = new URL(c.url); const found = { page: null, offset: null, size: null, listId: "" };
    for (const [k, v] of U.searchParams) { if (PAGE.test(k) && !found.page) found.page = { where: "q", k, v: Number(v) }; else if (OFFSET.test(k) && !found.offset) found.offset = { where: "q", k, v: Number(v) }; else if (SIZE.test(k) && !found.size) found.size = { where: "q", k, v: Number(v) }; if (LISTID.test(k) && !found.listId) found.listId = v; }
    let body = null; try { body = c.body ? JSON.parse(c.body) : null; } catch {}
    const walk = (o, path, d) => { if (!isObj(o) || d > 3) return; for (const [k, v] of Object.entries(o)) { const p = [...path, k];
        if (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v))) { if (PAGE.test(k) && !found.page) found.page = { where: "b", path: p, v: Number(v) }; else if (OFFSET.test(k) && !found.offset) found.offset = { where: "b", path: p, v: Number(v) }; else if (SIZE.test(k) && !found.size) found.size = { where: "b", path: p, v: Number(v) }; }
        if (LISTID.test(k) && (typeof v === "string" || typeof v === "number") && !found.listId) found.listId = String(v);
        if (isObj(v)) walk(v, p, d + 1); } };
    walk(body, [], 0);
    return { ...found, body };
  }
  const setVal = (U, body, f, val) => { if (!f) return; if (f.where === "q") U.searchParams.set(f.k, String(val)); else { let o = body; for (const k of f.path.slice(0, -1)) o = o[k]; o[f.path[f.path.length - 1]] = val; } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 拡張機能（bales.js）に送り、kinbot に届いたかを待つ
  let ackN = 0; const acks = new Map();
  window.addEventListener("message", (e) => { const d = e.data; if (!d || e.source !== window) return;
    if (d.__kbBalesAck && acks.has(d.id)) { acks.get(d.id)(d); acks.delete(d.id); }
    if (d.__kbBalesAsk) { const m = (document.body.innerText || "").match(/(\d[\d,]*)\s*-\s*(\d[\d,]*)\s*\/\s*(\d[\d,]*)/); const shownTotal = m ? Number(m[3].replace(/,/g, "")) : null; const shownN = m ? Number(m[2].replace(/,/g, "")) - Number(m[1].replace(/,/g, "")) + 1 : null;
      const sc = (c) => (/\/call_targets(\?|$)/.test(c.url) ? 200 : 0) + (shownTotal != null && c.total === shownTotal ? 100 : 0) + (shownN != null && c.n === shownN ? 50 : 0) + (c.lead ? 10 : 0) + (pagerOf(c).page || pagerOf(c).offset ? 5 : 0);
      cands.sort((a, b) => sc(b) - sc(a)); }
    if (d.__kbBalesAsk) window.postMessage({ __kbBalesCands: true, seen: window.__kbBalesSeen(), href: location.href, items: cands.map((c, i) => ({ i, ep: c.method + " " + String(c.url).split("?")[0].replace(location.origin, ""), n: c.n, total: c.total, keys: c.keys.slice(0, 10), lead: c.lead, pager: (() => { const p = pagerOf(c); return p.page ? "page" : p.offset ? "offset" : ""; })() })) }, "*");
    if (d.__kbBalesRun) run(d.i, d.name);
    if (d.__kbBalesTpls) window.postMessage({ __kbBalesTplList: true, lead: curLeadId(), names: Object.keys(tpls) }, "*");
    if (d.__kbBalesTplClear) { tpls = {}; try { localStorage.removeItem(TPL_KEY); } catch {} window.postMessage({ __kbBalesTplList: true, lead: curLeadId(), names: [] }, "*"); }
    if (d.__kbBalesDetail) runDetail(d.name);
    if (d.__kbBalesStop) stopDetail = true;
  });
  const toKinbot = (payload) => new Promise((resolve) => { const id = ++ackN; acks.set(id, resolve); window.postMessage({ __kbBalesSend: true, id, payload }, "*"); setTimeout(() => { if (acks.has(id)) { acks.delete(id); resolve({ ok: false, error: "拡張機能から返事がありません（拡張機能を入れ直したあとは、このページを読み込み直してください）" }); } }, 30000); });
  const prog = (o) => window.postMessage({ __kbBalesProg: true, ...o }, "*");

  let detailing = false, stopDetail = false;
  async function runDetail(name) {
    if (detailing) return; const names = Object.keys(tpls); if (!names.length) { prog({ detail: true, error: "まだ読み方を覚えていません。リードを1件開いてから押してください" }); return; }
    detailing = true; stopDetail = false;
    const c0 = cands.find((x) => /\/call_targets(\?|$)/.test(String(x.url)));
    const listKey = "bales:" + ((c0 && pagerOf(c0).listId) || String(name || "").trim() || "すべてのリード").slice(0, 100);
    const send = async (payload) => { for (let t = 0; t < 2; t++) { const r = await toKinbot({ listKey, ...payload }); if (r.ok) return r; if (t === 1 || /読み込み直|ログイン|合言葉/.test(r.error || "")) throw new Error(r.error || "kinbot に送れませんでした"); await sleep(1500); } };
    const readOne = async (id) => {
      const out = {};
      for (const k of names) {
        const u = tpls[k].u.replace(/\{id\}/g, id); const a = lastAuth[new URL(u).host] || {};
        for (let t = 0; t < 3; t++) {
          const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 45000);
          try { const r = await of(u, { headers: a.headers || {}, credentials: a.cred || "same-origin", signal: ac.signal });
            if (r.status === 429 || r.status >= 500) { await sleep(4000 * (t + 1)); continue; }   // 混んでいるときは待ってからもう一度
            if (r.status === 401 || r.status === 403) throw new Error("Bales のログインが切れました。Bales を読み込み直してから、もう一度押してください");
            out[k] = r.ok ? await r.json().catch(() => ({ _status: r.status })) : { _status: r.status }; break; }
          catch (e) { if (/ログイン/.test(e.message)) throw e; if (t === 2) out[k] = { _error: String(e && e.message || e).slice(0, 100) }; await sleep(1500); }
          finally { clearTimeout(tm); }
        }
      }
      return { id, detail: out };
    };
    try {
      prog({ detail: true, got: 0, step: "まだのリードを kinbot に聞いています…" });
      let t = await send({ todo: true, limit: 60 }); if (t.none) throw new Error("先に「全部取り込む」でリストを取り込んでください");
      const all = t.all || 0; let doneN = all - (t.left || 0);
      while (t.ids && t.ids.length && !stopDetail) {
        let buf = [];
        for (let i = 0; i < t.ids.length && !stopDetail; i += 2) {
          buf.push(...(await Promise.all(t.ids.slice(i, i + 2).map(readOne))));
          if (buf.length >= 20) { const r = await send({ details: buf }); if (!r.n) throw new Error("kinbot のリードと合いませんでした（リストを取り込み直してください）"); doneN += buf.length; buf = []; prog({ detail: true, got: doneN, total: all }); }
          await sleep(200);   // Bales に負担をかけないよう、少し間をあける
        }
        if (buf.length) { await send({ details: buf }); doneN += buf.length; prog({ detail: true, got: doneN, total: all }); }
        if (stopDetail) break;
        t = await send({ todo: true, limit: 60 });
      }
      prog({ detail: true, done: !stopDetail, stopped: stopDetail, got: doneN, total: all });
    } catch (err) { prog({ detail: true, error: String(err && err.message || err) }); }
    finally { detailing = false; }
  }

  let running = false;
  async function run(i, name) {
    if (running) return; const c = cands[i]; if (!c) { prog({ error: "一覧のデータがまだ見えていません。Bales のリストを開き直してから押してください" }); return; }
    running = true;
    const pg = pagerOf(c); const listKey = "bales:" + (pg.listId || String(name || "").trim() || String(c.url).split("?")[0]).slice(0, 100);
    const send = async (payload) => { for (let t = 0; t < 2; t++) { const r = await toKinbot({ listKey, ...payload }); if (r.ok) return r; if (t === 1 || /読み込み直|ログイン|合言葉/.test(r.error || "")) throw new Error(r.error || "kinbot に送れませんでした"); await sleep(1500); } };
    const bf = (u, o) => { const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 60000); return of(u, { ...o, credentials: c.cred || "same-origin", signal: ac.signal }).catch((e) => { throw new Error(e && e.name === "AbortError" ? "Bales から返事がありません（60秒）" : `Bales から読めませんでした（${e && e.message || e}）`); }).finally(() => clearTimeout(tm)); };
    let got = 0;
    try {
      prog({ got: 0, step: "kinbot に知らせています…" });
      await send({ start: true, name: name || "Bales のリスト", src: String(c.url).split("?")[0], total: c.total });
      // 画面の「1 - 100 / 23394」の総数（API が総数を返さないとき用）
      { const m = (document.body.innerText || "").match(/(\d[\d,]*)\s*-\s*(\d[\d,]*)\s*\/\s*(\d[\d,]*)/); if (c.total == null && m) c.total = Number(m[3].replace(/,/g, "")); }
      if (!pg.page && !pg.offset) {
        // 1ページ目は「page」を付けずに頼んでいることがある → よくある名前で2ページ目を試し、中身が変わる名前を使う（2026-11-15）
        prog({ got: 0, step: "ページのめくり方を探しています…" });
        const sig1 = c.firstSig;
        const tryQ = async (k, v) => { const U = new URL(c.url); U.searchParams.set(k, String(v)); const r = await bf(U.href, { method: c.method, headers: c.headers, body: c.method === "GET" || c.method === "HEAD" ? undefined : c.body }); if (!r.ok) return false; const a = getAt(await r.json(), c.path) || []; return a.length && JSON.stringify(a[0]).slice(0, 200) !== sig1; };
        for (const k of ["page", "currentPage", "current_page", "pageNumber", "page_number", "pageNo", "page_no", "p", "pageIndex"]) { try { if (await tryQ(k, 2)) { pg.page = { where: "q", k, v: 1 }; break; } } catch {} }
        if (!pg.page) for (const k of ["offset", "skip", "start", "from"]) { try { if (await tryQ(k, c.n)) { pg.offset = { where: "q", k, v: 0 }; break; } } catch {} }
      }
      if (!pg.page && !pg.offset) {
        // めくり方が分からないときは、いま見えている分だけ送る
        const j0 = await (await bf(c.url, { method: c.method, headers: c.headers, body: c.method === "GET" ? undefined : c.body })).json();
        const arr = getAt(j0, c.path) || []; await send({ rows: arr, total: c.total }); got = arr.length;
        await send({ done: true, error: arr.length < (c.total || 0) ? "ページのめくり方が分からず、見えている分だけ取り込みました" : "" });
        prog({ done: true, got, total: c.total, warn: "ページのめくり方が分からず、見えている分だけ取り込みました" }); return;
      }
      // 1回の件数はできるだけ多くする（Bales が受け付けない数なら元に戻す）
      let size = pg.size ? Math.max(pg.size.v || 0, 0) : 0; const want = pg.size ? 500 : 0;
      const base = pg.page ? (pg.page.v === 0 ? 0 : 1) : 0;
      let pageNo = base, off = 0, prevSig = "", total = c.total, tried500 = false;
      for (let k = 0; k < 3000; k++) {
        const U = new URL(c.url); const body = pg.body ? JSON.parse(JSON.stringify(pg.body)) : null;
        const sz = want && !tried500 ? want : size; if (pg.size && sz) setVal(U, body, pg.size, sz);
        if (pg.page) setVal(U, body, pg.page, pageNo); else setVal(U, body, pg.offset, off);
        if (!got) prog({ got: 0, step: "Bales から1ページ目を読んでいます…" });
        const r = await bf(U.href, { method: c.method, headers: c.headers, body: c.method === "GET" || c.method === "HEAD" ? undefined : body ? JSON.stringify(body) : c.body });
        if (!r.ok) { if (want && !tried500) { tried500 = true; k--; continue; } throw new Error(`Bales から読めませんでした（${r.status}）`); }
        const j = await r.json(); const arr = getAt(j, c.path) || []; const t = (() => { try { const f = findTotal(j); return f; } catch { return null; } })(); if (t != null) total = t;
        if (want && !tried500) { tried500 = true; if (arr.length) size = sz; }
        if (!arr.length) break;
        const sig = JSON.stringify(arr[0]).slice(0, 200); if (sig === prevSig) break; prevSig = sig;   // 同じページが返ってきた＝もう先が無い
        await send({ rows: arr, total }); got += arr.length; prog({ got, total });
        if (total != null && got >= total) break;
        if (pg.page) pageNo++; else off += arr.length;
        await sleep(350);   // Bales に負担をかけないよう、少し間をあける
      }
      await send({ done: true, total }); prog({ done: true, got, total });
    } catch (err) { try { await toKinbot({ listKey, done: true, error: String(err && err.message || err) }); } catch {} prog({ error: String(err && err.message || err), got }); }
    finally { running = false; }
  }
})();
