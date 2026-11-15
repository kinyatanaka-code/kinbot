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
  const keep = (key, val) => { try { window.postMessage({ __kbBalesKeep: true, key, val }, "*"); } catch {} };
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
      localStorage.setItem(TPL_KEY, JSON.stringify(tpls)); keep(TPL_KEY, tpls);
    } catch {}
  };
  // ===== Bales への書き込み（SF の失注情報などをカスタム情報へ）（2026-11-15 田中さん）=====
  //   1) リードの画面で、カスタム情報の「顧客の現状」に kinbot と入れて保存してもらう → その保存の頼み方を覚える
  //   2) 覚えた形の「値」と「項目の印」だけを入れ替えて、1項目ずつ同じように保存する（Bales の画面がしているのと同じ頼み方）
  const writes = [];
  const bodyOf = (raw) => {
    try {
      if (raw == null) return null;
      if (typeof FormData !== "undefined" && raw instanceof FormData) { const o = {}; for (const [k, v] of raw.entries()) if (typeof v === "string") o[k] = v; return { fmt: "formdata", body: o }; }
      if (typeof URLSearchParams !== "undefined" && raw instanceof URLSearchParams) return { fmt: "form", body: Object.fromEntries(raw.entries()) };
      if (typeof raw !== "string") return null;
      try { return { fmt: "json", body: JSON.parse(raw) }; } catch {}
      if (/=/.test(raw) && !/^\s*[{[]/.test(raw)) return { fmt: "form", body: Object.fromEntries(new URLSearchParams(raw).entries()) };
      return { fmt: "text", body: { _: raw } };
    } catch { return null; }
  };
  const NOISE = /\/rum\/|\/intake\/|datadog|sentry|google-analytics|\/collect|presigned|file_storage_access|\/logs?\b|amplitude|segment\.io|intercom/i;
  function noteWrite(req, status) { try { if (NOISE.test(String(req.url))) return; const bo = bodyOf(req.rawBody != null ? req.rawBody : req.body); if (!bo) { writes.unshift({ method: req.method, url: req.url, fmt: "?", status, at: Date.now() }); return; }
    writes.unshift({ method: req.method, url: req.url, headers: req.headers || {}, cred: req.cred, fmt: bo.fmt, body: bo.body, status, at: Date.now() }); if (writes.length > 15) writes.pop(); } catch {} }
  const wsSeen = [];
  try { const WS = window.WebSocket; const os = WS.prototype.send; WS.prototype.send = function (data) { try { if (typeof data === "string" && data.length < 200000) { wsSeen.unshift({ url: this.url, data: data.slice(0, 3000), at: Date.now() }); if (wsSeen.length > 20) wsSeen.pop(); } } catch {} return os.call(this, data); }; } catch {}
  const WR_KEY = "kbBalesWrite"; let wtpl = (() => { try { return JSON.parse(localStorage.getItem(WR_KEY) || "null"); } catch { return null; } })();
  const MARK = "kinbot";
  const pathOf = (o, want, path = []) => { if (typeof o === "string" && o.includes(want)) return path; if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { const r = pathOf(v, want, [...path, Array.isArray(o) ? Number(k) : k]); if (r) return r; } return null; };
  const at = (o, p) => p.reduce((x, k) => (x == null ? x : x[k]), o);
  const mask = (o, d = 0) => { if (o == null) return o; if (Array.isArray(o)) return o.slice(0, 4).map((x) => mask(x, d + 1)); if (typeof o === "object") { if (d > 5) return "{…}"; const r = {}; for (const [k, v] of Object.entries(o)) r[k] = mask(v, d + 1); return r; } if (typeof o === "string") return o === MARK ? MARK : o.length > 12 ? o.slice(0, 4) + "…" : o; return o; };
  async function fieldDefs() {
    let c = cands.find((x) => /\/custom_fields(\?|$)/.test(String(x.url).split("#")[0]));
    if (c && c.arr && c.arr.length) return c.arr;
    const any = cands.find((x) => /\/api\/user\//.test(String(x.url))); if (!any) return [];
    const U = new URL(any.url); U.pathname = U.pathname.replace(/\/api\/user\/.*$/, "/api/user/custom_fields"); U.search = "";
    const a = lastAuth[U.host] || {}; const r = await of(U.href, { headers: a.headers || {}, credentials: a.cred || "same-origin" }).catch(() => null); if (!r || !r.ok) return [];
    const j = await r.json().catch(() => null); const f = j && findArr(j); return f ? f.arr : [];
  }
  const defMatch = (defs, lbl, api) => defs.find((d) => Object.values(d).some((v) => typeof v === "string" && (v === lbl || v === api || v.trim() === lbl)));
  async function learnWrite() {
    const w = writes.find((x) => x.body && JSON.stringify(x.body).includes(MARK));
    const wsHit = wsSeen.find((x) => x.data.includes(MARK));
    if (!w && wsHit) return { ok: false, reason: "Bales は、この保存を WebSocket（つなぎっぱなしの通信）で送っていました。この形に合わせて直します（この画面を見せてください）", seen: [`WS ${String(wsHit.url).replace(/\?.*$/, "")} ${wsHit.data.replace(/"[^"]{13,}"/g, '"…"').slice(0, 400)}`] };
    const seenW = writes.slice(0, 12).map((x) => `${x.method} ${String(x.url).replace(/^https?:\/\/[^/]+/, "")}（${x.fmt || "?"}・${x.status}）${x.body ? " " + JSON.stringify(mask(x.body)).slice(0, 160) : ""}`);
    if (!w) return { ok: false, reason: `まだ「${MARK}」と入れた保存が見えていません。顧客の現状に ${MARK} と入れて保存してから、もう一度押してください。${seenW.length ? "（見えた保存：" + seenW.length + "件）" : "（このページを開いてから、保存が1つも見えていません。保存したあとにページを読み込み直していると見えなくなります）"}`, seen: seenW };
    const lead = curLeadId(); const mp = pathOf(w.body, MARK); const parentPath = mp.slice(0, -1); const parent = at(w.body, parentPath); const vKey = mp[mp.length - 1];
    const defs = await fieldDefs(); const def = defMatch(defs, "顧客の現状", "Client_Current_Status__c");
    const base = { method: w.method, url: w.url, shape: mask(w.body), defs: defs.length };
    if (!def) return { ok: false, reason: "カスタム情報の項目の一覧（custom_fields）が読めませんでした", ...base };
    let mode = "", idKey = "", keyProp = "";
    if (w.fmt === "json") {
      if (parent && typeof parent === "object" && !Array.isArray(parent)) for (const [k, v] of Object.entries(parent)) if (k !== String(vKey) && (v === def.id || String(v) === String(def.id))) { mode = "sibling"; idKey = k; }
      if (!mode) for (const [k, v] of Object.entries(def)) if (String(v) === String(vKey)) { mode = "key"; keyProp = k; }
    } else {
      // フォーム：call_target[custom_field_values][0][value]=kinbot と …[custom_field_id]=12 のような並び
      const pre = String(vKey).replace(/\[[^\[\]]*\]$/, "");
      for (const [k, v] of Object.entries(w.body)) if (k !== vKey && k.startsWith(pre + "[") && /^\[[^\]]*\]$/.test(k.slice(pre.length)) && String(v) === String(def.id)) { mode = "sibling"; idKey = k; }
      if (!mode && String(vKey).includes(`[${def.id}]`)) { mode = "fkey"; keyProp = "id"; }
    }
    if (!mode) return { ok: false, reason: "保存の形の中で、どこが項目の印かが分かりませんでした", ...base };
    // ほかの項目も一緒に送る形（全部まとめて保存）だと、1項目ずつ送ると消える心配があるので止める
    const gp = at(w.body, parentPath.slice(0, -1));
    const formMulti = w.fmt !== "json" && Object.keys(w.body).filter((k) => k !== vKey && k !== idKey && /value|custom/i.test(k)).length > 0;
    if ((w.fmt === "json" && ((mode === "sibling" && Array.isArray(gp) && gp.length > 1) || (mode === "key" && Object.keys(parent).length > 1))) || formMulti) return { ok: false, reason: "Bales がほかの項目もまとめて送る形でした。まとめて送る形に合わせて直します（この画面を見せてください）", mode, ...base };
    // ほかのリードに向けられるか：URL か本文に、このリードの id が入っていること
    const hasLead = lead && (new RegExp(`(^|[^0-9])${lead}(?![0-9])`).test(w.url) || JSON.stringify(w.body).includes(lead));
    if (!hasLead) return { ok: false, reason: "保存の頼み方の中に、このリードの印（id）が見つかりませんでした。リードを開いた画面（callTargetId= のある画面）で保存してください", mode, ...base };
    // 値そのものの印（id など）が入っていると、ほかのリードに書くと別の値を上書きしてしまう心配があるので止める
    if (w.fmt === "json" && mode === "sibling" && Object.keys(parent).some((k) => k !== idKey && k !== String(vKey) && /^(id|_id|uuid)$/i.test(k))) return { ok: false, reason: "保存の形に、値そのものの印（id）が入っていました。このままでは安全に書けないので、形に合わせて直します（この画面を見せてください）", mode, ...base };
    const ids = (lead ? [lead] : []);
    const u = lead ? w.url.replace(new RegExp(`(^|[^0-9])${lead}(?![0-9])`, "g"), (m, a) => a + "{id}") : w.url;
    wtpl = { fid: def.id, fmt: w.fmt, mval: String(at(w.body, mp)), method: w.method, u, body: w.body, mp, parentPath, vKey, mode, idKey, keyProp, lead, ct: Object.entries(w.headers).find(([k]) => /content-type/i.test(k))?.[1] || "application/json", at: Date.now() };
    try { localStorage.setItem(WR_KEY, JSON.stringify(wtpl)); } catch {} keep(WR_KEY, wtpl);
    return { ok: true, mode, ...base, ids };
  }
  const swapId = (o, from, to) => { if (o == null) return o; if (Array.isArray(o)) return o.map((x) => swapId(x, from, to)); if (typeof o === "object") { const r = {}; for (const [k, v] of Object.entries(o)) r[k] = swapId(v, from, to); return r; } if (String(o) === String(from)) return typeof o === "number" ? Number(to) : String(to); return o; };
  async function writeField(id, def, val) {
    let body = JSON.parse(JSON.stringify(wtpl.body)); if (wtpl.lead) body = swapId(body, wtpl.lead, id);
    const parent = at(body, wtpl.parentPath); const nv = (wtpl.mval || MARK).split(MARK).join(String(val));
    if (wtpl.mode === "sibling") { parent[wtpl.vKey] = nv; parent[wtpl.idKey] = typeof parent[wtpl.idKey] === "number" ? Number(def.id) : String(def.id); }
    else if (wtpl.mode === "fkey") { const oid = String(wtpl.vKey).match(/\[(\d+)\]/g) || []; const k2 = String(wtpl.vKey).replace(new RegExp(`\\[${wtpl.fid}\\]`), `[${def.id}]`); delete parent[wtpl.vKey]; parent[k2] = nv; }
    else { delete parent[wtpl.vKey]; parent[String(def[wtpl.keyProp])] = nv; }
    const url = wtpl.u.replace(/\{id\}/g, id); const a = lastAuth[new URL(url).host] || {};
    const hd = { ...(a.headers || {}) }; for (const k of Object.keys(hd)) if (/content-type/i.test(k)) delete hd[k];
    let bodyOut;
    if (!wtpl.fmt || wtpl.fmt === "json") { bodyOut = JSON.stringify(body); hd["content-type"] = wtpl.ct || "application/json"; }
    else if (wtpl.fmt === "form") { bodyOut = new URLSearchParams(body).toString(); hd["content-type"] = wtpl.ct || "application/x-www-form-urlencoded"; }
    else if (wtpl.fmt === "formdata") { bodyOut = new FormData(); for (const [k, v] of Object.entries(body)) bodyOut.append(k, v); }
    else throw new Error("この保存の形には、まだ書き込めません");
    const r = await of(url, { method: wtpl.method, headers: hd, body: bodyOut, credentials: a.cred || "same-origin" });
    if (r.status === 401 || r.status === 403) throw new Error("Bales のログインが切れました。Bales を読み込み直してから、もう一度押してください");
    return r.ok ? "" : `${r.status}`;
  }
  // 選択リストの項目は、選べる値の中に同じ名前があるときだけ書く（無ければ飛ばす）
  const choiceOf = (def, v) => { const ops = Object.values(def).find((x) => Array.isArray(x) && x.length && x.every((y) => y && typeof y === "object")); if (!ops) return { ok: true, v }; const o = ops.find((y) => Object.values(y).some((z) => String(z) === v)); return o ? { ok: true, v: o.value ?? o.name ?? v } : { ok: false }; };
  let writing = false, stopWrite = false;
  async function runWrite(name, onlyThis) {
    if (writing) return; if (!wtpl) { prog({ write: true, error: "まだ書き込み方を覚えていません" }); return; }
    writing = true; stopWrite = false;
    const c0 = cands.find((x) => /\/call_targets(\?|$)/.test(String(x.url)));
    const listKey = "bales:" + ((c0 && pagerOf(c0).listId) || String(name || "").trim() || "すべてのリード").slice(0, 100);
    try {
      const defs = await fieldDefs(); if (!defs.length) throw new Error("カスタム情報の項目の一覧が読めませんでした");
      const only = onlyThis ? curLeadId() : ""; if (onlyThis && !only) throw new Error("リードを1件開いてから押してください");
      let t = await toKinbot({ listKey, writeTodo: true, limit: 30, only }); if (!t.ok) throw new Error(t.error || "kinbot に聞けませんでした"); if (t.none) throw new Error("先にリストを取り込み、SF と結びつけてください");
      if (onlyThis && !t.items.length) throw new Error("このリードは kinbot で SF と結びついていません（SF の失注情報などがありません）");
      const all = t.all || 0; let done = onlyThis ? 0 : all - (t.left || 0); const skipped = new Set(); let fields = 0;
      while (t.items && t.items.length && !stopWrite) {
        const out = [];
        for (const it of t.items) {
          if (stopWrite) break; let err = "";
          for (const [lbl, api, v] of it.vals) { const def = defMatch(defs, lbl, api); if (!def) { skipped.add(lbl); continue; } const ch = choiceOf(def, v); if (!ch.ok) { skipped.add(lbl + "（選択肢に無い値）"); continue; }
            const e = await writeField(it.id, def, ch.v); if (e) err = (err ? err + "・" : "") + `${lbl}:${e}`; else fields++; await sleep(150); }
          out.push({ id: it.id, err }); done++;
        }
        if (out.length) await toKinbot({ listKey, written: out });
        prog({ write: true, got: done, total: onlyThis ? 1 : all, fields });
        if (onlyThis) break;
        t = await toKinbot({ listKey, writeTodo: true, limit: 30 });
      }
      prog({ write: true, done: !stopWrite, stopped: stopWrite, got: done, total: onlyThis ? 1 : all, fields, skipped: [...skipped].slice(0, 10), only: onlyThis });
    } catch (err) { prog({ write: true, error: String(err && err.message || err) }); }
    finally { writing = false; }
  }
  const noteAuth = (req) => { try { const h = new URL(req.url).host; if (h !== location.host || Object.keys(req.headers || {}).length) lastAuth[h] = { headers: req.headers || {}, cred: req.cred || "same-origin" }; } catch {} };
  const onResp = (req, text, ct, status) => {
    try { noteAuth(req); if (status >= 200 && status < 300) noteTpl(req, text); } catch {}
    try {
      noteSeen(req, { ct: String(ct || "").slice(0, 40), status, len: (text || "").length, arr: -1 });
      if (!text || text.length > 30000000 || !/^\s*[[{]/.test(text)) return;
      const j = JSON.parse(text); const f = findArr(j); try { const U = new URL(req.url); const s0 = seen.get(req.method + " " + U.host + U.pathname); if (s0) s0.arr = f ? f.arr.length : 0; } catch {} if (!f) return;
      const keys = Object.keys(f.arr[0] || {});
      const c = { ...req, path: f.path, arr: f.arr.slice(0, 100), n: f.arr.length, total: findTotal(j), keys: keys.slice(0, 40), lead: looksLead(keys), at: Date.now(), firstSig: JSON.stringify(f.arr[0]).slice(0, 200) };
      const ep = c.method + " " + String(c.url).split("?")[0];
      const i = cands.findIndex((x) => x.method + " " + String(x.url).split("?")[0] === ep); if (i >= 0) cands.splice(i, 1);
      cands.unshift(c); if (cands.length > 15) cands.pop();
    } catch {}
  };
  // fetch と XHR の返事を写す（JSON のものだけ）
  const of = window.fetch;
  window.fetch = async function (...a) {
    let req = null;
    try { const r0 = a[0]; const o = a[1] || {}; const url = typeof r0 === "string" ? r0 : r0 instanceof URL ? r0.href : (r0 && r0.url) || ""; req = { url: new URL(url, location.href).href, method: String(o.method || (r0 && r0.method) || "GET").toUpperCase(), headers: { ...hdrObj(r0 && r0.headers), ...hdrObj(o.headers) }, body: typeof o.body === "string" ? o.body : null, rawBody: o.body, cred: o.credentials || (r0 && r0.credentials) || "same-origin", via: "fetch" }; } catch {}
    try { if (req && req.method !== "GET" && req.method !== "HEAD") { const r0 = a[0]; const o = a[1] || {};
        if (o.body == null && r0 instanceof Request) req.bodyP = r0.clone().text().catch(() => null);
        else if (typeof Blob !== "undefined" && o.body instanceof Blob) req.bodyP = o.body.text().catch(() => null); } } catch {}
    const r = await of.apply(this, a);
    try { if (req && req.method !== "GET" && req.method !== "HEAD") { if (req.bodyP) req.bodyP.then((t) => { req.rawBody = t; noteWrite(req, r.status); }); else noteWrite(req, r.status); } } catch {}
    try { const ct = r.headers.get("content-type") || ""; if (req && (/json|text\/plain/i.test(ct) || !ct)) r.clone().text().then((t) => onResp(req, t, ct, r.status)).catch(() => {}); else if (req) noteSeen(req, { ct: ct.slice(0, 40), status: r.status, len: -1, arr: -1 }); } catch {}
    return r;
  };
  const XO = XMLHttpRequest.prototype.open, XH = XMLHttpRequest.prototype.setRequestHeader, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u, ...rest) { try { this.__kb = { url: new URL(String(u), location.href).href, method: String(m || "GET").toUpperCase(), headers: {}, body: null, via: "xhr" }; } catch {} return XO.call(this, m, u, ...rest); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { try { if (this.__kb) this.__kb.headers[k] = v; } catch {} return XH.call(this, k, v); };
  XMLHttpRequest.prototype.send = function (b) {
    try { if (this.__kb) { this.__kb.body = typeof b === "string" ? b : null; this.__kb.rawBody = b; this.__kb.cred = this.withCredentials ? "include" : "same-origin"; const req = this.__kb; this.addEventListener("load", () => { try { if (req.method !== "GET" && req.method !== "HEAD") noteWrite(req, this.status); } catch {} try { const ct = this.getResponseHeader("content-type") || ""; if (!(/json|text\/plain/i.test(ct) || !ct || this.responseType === "json")) { noteSeen(req, { ct: ct.slice(0, 40), status: this.status, len: -1, arr: -1 }); return; } onResp(req, this.responseType === "json" ? JSON.stringify(this.response) : (this.responseType === "" || this.responseType === "text") ? this.responseText : "", ct, this.status); } catch {} }); } } catch {}
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
    if (d.__kbBalesView) { const c0 = cands.find((x) => /\/call_targets(\?|$)/.test(String(x.url))); window.postMessage({ __kbBalesViewIs: true, view: c0 ? learnView(c0) : null }, "*"); }
    if (d.__kbBalesTpls) window.postMessage({ __kbBalesTplList: true, lead: curLeadId(), names: Object.keys(tpls) }, "*");
    if (d.__kbBalesTplClear) { tpls = {}; try { localStorage.removeItem(TPL_KEY); } catch {} keep(TPL_KEY, null); window.postMessage({ __kbBalesTplList: true, lead: curLeadId(), names: [] }, "*"); }
    if (d.__kbBalesDetail) runDetail(d.name);
    if (d.__kbBalesStop) stopDetail = true;
    if (d.__kbBalesRestore) { const v = d.val; if (!v) return;
      if (d.key === TPL_KEY && !Object.keys(tpls).length && typeof v === "object") { tpls = v; try { localStorage.setItem(TPL_KEY, JSON.stringify(v)); } catch {} }
      if (d.key === FEEDS_KEY && !feeds.length && Array.isArray(v)) { feeds = v; try { localStorage.setItem(FEEDS_KEY, JSON.stringify(v)); } catch {} }
      if (d.key === WR_KEY && !wtpl && typeof v === "object") { wtpl = v; try { localStorage.setItem(WR_KEY, JSON.stringify(v)); } catch {} } }
    if (d.__kbBalesFeedAsk) window.postMessage({ __kbBalesFeedIs: true, feeds: feeds.map((f) => ({ key: f.key, name: f.name, page: f.page, pager: f.pager ? f.pager.kind : "", view: (f.view || []).map((v) => v.label) })) }, "*");
    if (d.__kbBalesFeedAdd) addFeed(d.name).then((r) => window.postMessage({ __kbBalesFeedAdded: true, ...r }, "*"));
    if (d.__kbBalesFeedDel) { feeds = feeds.filter((x) => x.key !== d.key); saveFeeds(); window.postMessage({ __kbBalesFeedIs: true, feeds: feeds.map((f) => ({ key: f.key, name: f.name, page: f.page, pager: f.pager ? f.pager.kind : "", view: (f.view || []).map((v) => v.label) })) }, "*"); }
    if (d.__kbBalesSync) syncFeeds(d.why || "");
    if (d.__kbBalesWAsk) window.postMessage({ __kbBalesWIs: true, learned: !!wtpl, mode: wtpl && wtpl.mode, lead: curLeadId() }, "*");
    if (d.__kbBalesWLearn) learnWrite().then((r) => window.postMessage({ __kbBalesWLearned: true, ...r }, "*"));
    if (d.__kbBalesWRun) runWrite(d.name, !!d.only);
    if (d.__kbBalesWStop) stopWrite = true;
    if (d.__kbBalesWForget) { wtpl = null; try { localStorage.removeItem(WR_KEY); } catch {} keep(WR_KEY, null); window.postMessage({ __kbBalesWIs: true, learned: false, lead: curLeadId() }, "*"); }
  });
  const toKinbot = (payload) => new Promise((resolve) => { const id = ++ackN; acks.set(id, resolve); window.postMessage({ __kbBalesSend: true, id, payload }, "*"); setTimeout(() => { if (acks.has(id)) { acks.delete(id); resolve({ ok: false, error: "拡張機能から返事がありません（拡張機能を入れ直したあとは、このページを読み込み直してください）" }); } }, 30000); });
  const prog = (o) => window.postMessage({ __kbBalesProg: true, ...o }, "*");

  // ===== Bales の一覧の見出しと中身を、データの項目に結びつける（2026-11-15 田中さん「Bales の一覧と同じ内容を kinbot で」）=====
  //   画面の表（見出し・1行ずつの文字）と、裏のデータ（同じ並び）を見比べ、見出しごとに「どの項目か」を見つける。kinbot はその並びで表を出す
  const flatP = (o) => {   // kinbot と同じ平らにし方。配列の何番目かは [] にまとめる
    const out = {}; const walk = (v, k, d) => {
      if (v == null) return;
      if (Array.isArray(v)) { if (v.every((x) => x == null || typeof x !== "object")) { (out[k] = out[k] || []).push(v.filter((x) => x != null).join("、")); } else if (d < 5) v.slice(0, 5).forEach((x) => walk(x, `${k}.[]`, d + 1)); return; }
      if (typeof v === "object") { if (d >= 5) { (out[k] = out[k] || []).push(v.name != null ? String(v.name) : ""); return; } for (const [kk, vv] of Object.entries(v)) walk(vv, k ? `${k}.${kk}` : kk, d + 1); return; }
      (out[k] = out[k] || []).push(String(v));
    }; walk(o, "", 0); return out;
  };
  const nz = (t) => String(t || "").normalize("NFKC").replace(/\s+/g, "").replace(/[…\.]{1,3}$/, "");
  const dVar = (v) => { if (!/^\d{4}-\d{2}-\d{2}T/.test(v)) return []; const d = new Date(v); if (isNaN(d)) return []; const p = (n) => String(n).padStart(2, "0");
    return [`${p(d.getMonth() + 1)}/${p(d.getDate())}${p(d.getHours())}:${p(d.getMinutes())}`, `${d.getMonth() + 1}/${d.getDate()}${p(d.getHours())}:${p(d.getMinutes())}`, `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}${p(d.getHours())}:${p(d.getMinutes())}`, `${p(d.getMonth() + 1)}/${p(d.getDate())}`, `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}`]; };
  const readTable = () => {
    for (const t of document.querySelectorAll("table")) { const hs = [...t.querySelectorAll("thead th")].map((x) => x.innerText.trim()); const rows = [...t.querySelectorAll("tbody tr")].slice(0, 40).map((tr) => [...tr.children].map((td) => td.innerText.trim())); if (hs.filter(Boolean).length >= 3 && rows.length) return { hs, rows }; }
    const rr = [...document.querySelectorAll('[role="row"]')]; if (rr.length > 1) { const hs = [...rr[0].querySelectorAll('[role="columnheader"]')].map((x) => x.innerText.trim()); const rows = rr.slice(1, 41).map((r) => [...r.querySelectorAll('[role="cell"],[role="gridcell"]')].map((x) => x.innerText.trim())); if (hs.filter(Boolean).length >= 3) return { hs, rows }; }
    return null;
  };
  const learnView = (c) => {
    try {
      const tb = readTable(); if (!tb || !c.arr || !c.arr.length) return null;
      const items = c.arr.slice(0, tb.rows.length).map(flatP); const view = [];
      tb.hs.forEach((h, i) => {
        if (!h) return; let best = null;
        const pats = new Set(); items.forEach((f) => Object.keys(f).forEach((k) => pats.add(k)));
        for (const p of pats) {
          let hit = 0, seen = 0;
          tb.rows.forEach((row, r) => { const cell = nz(row[i]); const f = items[r]; if (!f || cell === "" || cell === "-") return; seen++;
            const vs = (f[p] || []).filter((x) => x !== ""); if (!vs.length) return; const all = nz(vs.join("")), one = nz(vs[0]);
            const ok = all === cell || one === cell || dVar(vs[0]).some((x) => nz(x) === cell) || (cell.length >= 2 && (all.startsWith(cell) || one.startsWith(cell))) || (cell.length >= 4 && all.includes(cell));
            if (ok) hit++; });
          if (hit && (!best || hit > best.hit || (hit === best.hit && p.length < best.p.length))) best = { p, hit, seen };
        }
        if (best && best.hit >= Math.max(1, Math.ceil(best.seen * 0.5))) view.push({ label: h, key: best.p });
      });
      return view.length ? view : null;
    } catch { return null; }
  };

  // ===== 見張り（平日10〜19時に、拡張機能が10分ごとに新しい行を読む）（2026-11-15 田中さん「架電の記録を分析したい」）=====
  //   いま開いている画面の一覧（架電の記録・リード一覧など）を登録しておくと、その一覧の1ページ目から新しい行が無くなるまで読んで kinbot に送る
  const FEEDS_KEY = "kbBalesFeeds";
  let feeds = (() => { try { return JSON.parse(localStorage.getItem(FEEDS_KEY) || "[]"); } catch { return []; } })();
  const saveFeeds = () => { try { localStorage.setItem(FEEDS_KEY, JSON.stringify(feeds)); } catch {} keep(FEEDS_KEY, feeds); };
  const mainCand = () => { const m = (document.body.innerText || "").match(/(\d[\d,]*)\s*-\s*(\d[\d,]*)\s*\/\s*(\d[\d,]*)/); const shownN = m ? Number(m[2].replace(/,/g, "")) - Number(m[1].replace(/,/g, "")) + 1 : null; const tb = readTable(); const rowsN = tb ? tb.rows.length : null;
    const sc = (c) => (shownN != null && c.n === shownN ? 50 : 0) + (rowsN && Math.abs(c.n - rowsN) <= 1 ? 40 : 0) + (/custom_fields|users|lead_sources|lead_stages|result_types|sent_bulk|assigned_user|notifications/.test(String(c.url)) ? -100 : 0) + Math.min(20, c.n / 5) + (Date.now() - c.at < 60000 ? 10 : 0);
    return [...cands].sort((a, b) => sc(b) - sc(a))[0] || null; };
  const authFetch = (u, o = {}) => { const a = lastAuth[new URL(u).host] || {}; const ac = new AbortController(); const tm = setTimeout(() => ac.abort(), 60000); return of(u, { ...o, headers: { ...(a.headers || {}), ...(o.headers || {}) }, credentials: a.cred || "same-origin", signal: ac.signal }).finally(() => clearTimeout(tm)); };
  async function findPager(c) {
    const pg = pagerOf(c); if (pg.page) return { where: "q", k: pg.page.k || null, path: pg.page.path || null, kind: "page", base: pg.page.v === 0 ? 0 : 1 }; if (pg.offset) return { where: pg.offset.where, k: pg.offset.k || null, path: pg.offset.path || null, kind: "offset" };
    const sig1 = c.firstSig; const tryQ = async (k, v) => { const U = new URL(c.url); U.searchParams.set(k, String(v)); const r = await authFetch(U.href, { method: c.method }); if (!r.ok) return false; const a = getAt(await r.json(), c.path) || []; return a.length && JSON.stringify(a[0]).slice(0, 200) !== sig1; };
    for (const k of ["page", "currentPage", "current_page", "pageNumber", "page_number", "pageNo", "p"]) { try { if (await tryQ(k, 2)) return { where: "q", k, kind: "page", base: 1 }; } catch {} }
    for (const k of ["offset", "skip", "start"]) { try { if (await tryQ(k, c.n)) return { where: "q", k, kind: "offset" }; } catch {} }
    return null;
  }
  async function addFeed(name) {
    const c = mainCand(); if (!c) return { ok: false, error: "この画面の一覧のデータが見えていません。一覧が出てから押してください" };
    const pager = await findPager(c);
    const f = { key: "feed:" + String(name || "見張り").slice(0, 40), name: String(name || "見張り").slice(0, 40), url: c.url, method: c.method, body: c.body, path: c.path, n: c.n, full: true, pager, view: learnView(c), page: location.pathname + location.search, at: Date.now() };
    feeds = feeds.filter((x) => x.key !== f.key); feeds.push(f); saveFeeds();
    const r = await toKinbot({ feed: f.key, name: f.name, src: String(c.url).split("?")[0], view: f.view, rows: (c.arr || []).slice(0, 100) });
    return { ok: !!r.ok, error: r.error, feed: { name: f.name, ep: String(c.url).split("?")[0].replace(/^https?:\/\/[^/]+/, ""), n: c.n, pager: pager ? pager.kind : "", view: (f.view || []).map((v) => v.label) } };
  }
  let syncing = false;
  async function syncFeeds(why) {
    if (syncing || !feeds.length) return; syncing = true; const out = [];
    try {
      for (const f of feeds) {
        let nwAll = 0, pages = 0, err = "";
        try {
          // 登録して最初の1回は、新しい行が無いページでも最後まで（最大100ページ）読む。あとは新しい行が無くなったら終わり
          const maxP = f.full ? 100 : 40;
          for (let p = 0; p < maxP; p++) {
            const U = new URL(f.url); let body = f.body;
            if (f.pager) { if (f.pager.kind === "page") { if (f.pager.where === "q" && f.pager.k) U.searchParams.set(f.pager.k, String((f.pager.base ?? 1) + p)); }
              else if (f.pager.where === "q" && f.pager.k) U.searchParams.set(f.pager.k, String(p * (f.n || 100))); }
            else if (p > 0) break;
            const r = await authFetch(U.href, { method: f.method, body: f.method === "GET" || f.method === "HEAD" ? undefined : body });
            if (r.status === 401 || r.status === 403) throw new Error("Bales のログインが切れています");
            if (!r.ok) throw new Error(`Bales から読めませんでした（${r.status}）`);
            const arr = getAt(await r.json(), f.path) || []; if (!arr.length) break; pages++;
            const k = await toKinbot({ feed: f.key, rows: arr }); if (!k.ok) throw new Error(k.error || "kinbot に送れませんでした");
            nwAll += k.nw || 0; if (!k.nw && !f.full) break;   // 新しい行が無いページまで来たら終わり
            await sleep(400);
          }
        } catch (e) { err = String(e && e.message || e); }
        if (f.full && !err) { f.full = false; saveFeeds(); }
        await toKinbot({ feed: f.key, rows: [], done: true, newTotal: nwAll }).catch(() => {});
        out.push({ name: f.name, nw: nwAll, pages, err });
      }
    } finally { syncing = false; }
    window.postMessage({ __kbBalesSynced: true, why, out, at: Date.now() }, "*");
  }

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
      await send({ start: true, name: name || "Bales のリスト", src: String(c.url).split("?")[0], total: c.total, view: learnView(c) });
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
