// kinbot の MOCHICA の箱（2026-11-12 田中さん：DOC を壊さずに別の箱。色は緑っぽい水色）
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (u, o = {}) => { const r = await fetch(u, { credentials: "include", headers: { "content-type": "application/json" }, ...o }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j; };
  const TITLES = { home: "ホーム", mtg: "商談（MiiTel）", list: "リスト（Bales Cloud）", call: "架電（Zoom Phone）", apo: "アポ（カレンダー）", doc: "DOC の議事録", settings: "設定" };
  const go = (k) => {
    if (!TITLES[k]) k = "home";
    document.querySelectorAll("[data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== k; });
    document.querySelectorAll(".side-item[data-go]").forEach((a) => a.classList.toggle("active", a.dataset.go === k));
    $("mcTitle").textContent = TITLES[k]; if (location.hash !== "#" + k) history.replaceState(null, "", "#" + k);
    // 設定は kinbot と同じ画面を中に開く（開いたときに初めて読む）（2026-11-14）
    if (k === "settings") { const f = $("mcSetFrame"); if (f && !f.getAttribute("src")) f.setAttribute("src", f.dataset.src); }
    if (k === "mtg") loadMeetings();
    { const hr = $("mcHeadR"); if (hr) hr.hidden = k !== "mtg"; }
  };
  document.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", () => go(a.dataset.go)));
  window.addEventListener("hashchange", () => go(location.hash.slice(1)));
  async function loadHome() {
    try { const d = await api("/api/mochica/summary");
      const st = (x) => x ? '<b class="ok">つながっています</b>' : '<b class="ng">まだつないでいません</b>';
      $("mcCards").innerHTML = `<div class="mc-card"><small>MOCHICA のメンバー</small><b>${d.members.length}<span style="font-size:13px"> 人</span></b></div>
        <div class="mc-card"><small>この7日の商談（kinbot で録画）</small><b>${d.meetings7}<span style="font-size:13px"> 件</span></b></div>
        <div class="mc-card"><small>MiiTel</small>${st(d.miitel)}</div><div class="mc-card"><small>Bales Cloud</small>${st(d.bales)}</div>`;
      $("mcMembers").innerHTML = d.members.length ? d.members.map((m) => `<span class="mc-tag" style="margin:0 6px 6px 0">${esc(m)}</span>`).join("") : "まだ MOCHICA のメンバーが決まっていません。";
    } catch (e) { $("mcCards").innerHTML = `<div class="mc-card"><small>読めませんでした：${esc(e.message)}</small></div>`; }
  }
  // ===== 商談（MiiTel）：左に商談のカード、右に中身（kinbot の商談履歴と同じ作りを水色で）（2026-11-12）=====
  let mtAll = [], mtSel = "";
  const jst = (v) => v ? new Date(new Date(v).getTime() + 9 * 3600000) : null;
  const dkey = (v) => { const d = jst(v); return d ? d.toISOString().slice(0, 10) : ""; };
  const hm = (v) => { const d = jst(v); return d ? d.toISOString().slice(11, 16) : ""; };
  const md = (v) => { const d = jst(v); return d ? `${d.getUTCMonth() + 1}/${d.getUTCDate()}` : ""; };
  const wk = (v) => { const d = jst(v); return d ? "日月火水木金土"[d.getUTCDay()] : ""; };
  let mtHost = null;   // 選んだ担当（null＝担当のカードの一覧）
  // 商談者：MiiTel の参加者のうち kinbot のアカウントの人を先に使う（2026-11-14 田中さん）。無ければカレンダー、主催者の順
  const hostOf = (m) => (m.rep && m.rep.name) || (m.cal && m.cal.ownerName) || (String(m.host || "").trim() && String(m.host).trim() !== "オーナー" ? String(m.host).trim() : "") || "（担当なし）";
  const titleOf = (m) => (m.cal && m.cal.title) || m.title || "（題名なし）";
  const coOf = (m) => (m.cal && m.cal.company && m.cal.company !== "(無題)" ? m.cal.company : "");
  function mtDraw() {
    const box = $("mtList"); if (!box) return;
    const q = String(($("mtQ") || {}).value || "").trim().toLowerCase();
    const need = mtAll.filter((m) => !m.transcript_len && !m.has_tr).length; const rb = $("mtRead");
    if (rb && !rb.disabled) { rb.hidden = false; rb.textContent = "MiiTel から今すぐ読む"; }
    if (!mtAll.length) { $("mtCount").textContent = "0件"; box.innerHTML = '<div class="mc-note" style="padding:10px">まだありません。上の「MiiTel から会議を読み込む」を押すと、MiiTel の会議履歴から読み込みます。</div>'; return; }
    // ① 担当のカード（kinbot の商談履歴と同じ）
    // ヘッダーで探したときは、担当をまたいで商談を出す（2026-11-14 田中さん：検索はヘッダーで）
    if (mtHost == null && !q) {
      const by = new Map(); for (const m of mtAll) { const h = hostOf(m); const v = by.get(h) || { n: 0, tr: 0, last: "" }; v.n++; if (m.transcript_len || m.has_tr) v.tr++; const at = m.started_at || m.received_at || ""; if (at > v.last) v.last = at; by.set(h, v); }
      const hs = [...by.entries()].filter(([h]) => !q || h.toLowerCase().includes(q)).sort((a, b) => b[1].n - a[1].n || String(b[1].last).localeCompare(String(a[1].last)));
      $("mtCount").textContent = `${hs.length}人・${mtAll.length}商談`;
      box.innerHTML = hs.map(([h, v]) => `<div class="mt-pcard" data-host="${esc(h)}"><span class="av">${esc(h.replace(/^（|）$/g, "").slice(0, 1))}</span><span class="nm"><b>${esc(h)}</b><small>${v.n}商談${v.tr ? `・文字起こし${v.tr}` : ""}${v.last ? `・最新 ${md(v.last)}` : ""}</small></span><span class="go">›</span></div>`).join("") || '<div class="mc-note" style="padding:10px">見つかりませんでした</div>';
      box.querySelectorAll("[data-host]").forEach((el) => el.addEventListener("click", () => { mtHost = el.dataset.host; const qi = $("mtQ"); if (qi) qi.value = ""; mtDraw(); const first = mtAll.find((m) => hostOf(m) === mtHost); if (first) mtOpen(first.id); }));
      return;
    }
    // ② その担当の商談（日ごと）
    const all = mtHost == null;
    const list = mtAll.filter((m) => all || hostOf(m) === mtHost).filter((m) => !q || `${titleOf(m)} ${coOf(m)} ${m.participants || ""} ${all ? hostOf(m) : ""}`.toLowerCase().includes(q));
    $("mtCount").textContent = `${list.length}件`;
    let last = ""; let html = all
      ? `<div class="mt-who"><b>「${esc(q)}」で探した商談</b><small>${list.length}件</small></div>${list.length ? "" : '<div class="mc-note" style="padding:10px">見つかりませんでした。</div>'}`
      : `<button type="button" class="mt-back" data-back>‹ 担当一覧</button><div class="mt-who"><span class="av">${esc(mtHost.replace(/^（|）$/g, "").slice(0, 1))}</span><b>${esc(mtHost)}</b><small>${list.length}商談</small></div>`;
    for (const m of list) {
      const at = m.started_at || m.received_at; const k = dkey(at);
      if (k !== last) { html += `<div class="mt-day">${md(at)}（${wk(at)}）</div>`; last = k; }
      html += `<div class="mt-card${m.id === mtSel ? " on" : ""}" data-mt="${esc(m.id)}"><div class="t">${esc(coOf(m) || titleOf(m))}</div>${coOf(m) ? `<div class="m" style="margin-top:1px"><span>${esc(titleOf(m))}</span></div>` : ""}<div class="m"><span>${hm(at)}</span>${all ? `<span>${esc(hostOf(m))}</span>` : ""}${m.duration_sec ? `<span>${Math.round(m.duration_sec / 60)}分</span>` : ""}</div><div class="tags">${m.transcript_len || m.has_tr ? '<span class="mt-tag">文字起こしあり</span>' : '<span class="mt-tag none">文字起こし待ち</span>'}${m.has_video ? '<span class="mt-tag">録画あり</span>' : ""}${m.cal && m.cal.sf && (m.cal.sf.leadId || m.cal.sf.accountId) ? '<span class="mt-tag">SFと結びつき</span>' : '<span class="mt-tag sf">SF未記録</span>'}</div></div>`;
    }
    box.innerHTML = html;
    { const bk = box.querySelector("[data-back]"); if (bk) bk.addEventListener("click", () => { mtHost = null; const qi = $("mtQ"); if (qi) qi.value = ""; mtDraw(); }); }
    box.querySelectorAll("[data-mt]").forEach((el) => el.addEventListener("click", () => mtOpen(el.dataset.mt)));
  }
  async function loadMeetings() {
    try { const d = await api("/api/mochica/miitel/meetings"); mtAll = (d.items || []).filter((m) => String(m.title || "").trim() || m.started_at || m.transcript_len); mtDraw(); }
    catch (e) { const b = $("mtList"); if (b) b.textContent = "読めませんでした：" + e.message; }
  }
  // ===== 商談の段階：録画の下に帯と一覧を出す（kinbot の商談履歴と同じ作り・同じ色）（2026-11-14）=====
  const PHASE_COLOR = { "アイスブレイク": "#cfe7dd", "ヒアリング": "#5DCAA5", "提案・説明": "#1d9e75", "デモ": "#17b39a", "質疑・懸念": "#e0b25e", "価格・条件": "#d99114", "クロージング": "#0d5b47", "次回調整": "#8fb8ab", "雑談": "#c9c7bd" };
  const mmss = (sec) => { const x = Math.max(0, Math.round(Number(sec) || 0)); return Math.floor(x / 60) + ":" + String(x % 60).padStart(2, "0"); };
  const chOpen = () => { try { return localStorage.getItem("kinbot_ch_open") !== "0"; } catch { return true; } };
  function mtChapters(id, tr, chapters0, durSec, rep) {
    const wrap = $("mtCh"); if (!wrap) return;
    let chapters = Array.isArray(chapters0) ? chapters0 : [];
    const ve = () => $("mtVideo");
    const total = () => { const v = ve(); const d = v && v.duration; return (d && isFinite(d) && d > 1) ? d : (durSec || 0); };
    const timesOf = () => { const T = total(); return chapters.map((c) => { const has = typeof c.start === "number" && isFinite(c.start); const st = has ? c.start : Math.round((c.ratioStart || 0) * T); const en = has && typeof c.end === "number" ? c.end : Math.round((c.ratioEnd || 1) * T); return { start: st, end: Math.max(st + 1, en) }; }); };
    const seek = (sec) => { const v = ve(); if (!v) return; try { v.currentTime = Math.max(0, sec || 0); } catch {} const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); };
    const make = async (force) => {
      wrap.innerHTML = '<div class="ch-loading">商談の段階に分けています…</div>';
      try { const r = await fetch(`/api/mochica/miitel/meetings/${encodeURIComponent(id)}/chapters`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ tr, rep, force: !!force }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.error || "作れませんでした"); chapters = d.chapters || [];
        if (!chapters.length) { wrap.innerHTML = d.reason ? `<div class="mc-note" style="font-size:12px">${esc(d.reason)}</div>` : ""; return; } draw();
      } catch (e) { wrap.innerHTML = `<button type="button" class="mt-btn ghost" data-chredo>段階を作り直す（${esc(e.message)}）</button>`; const b = wrap.querySelector("[data-chredo]"); if (b) b.addEventListener("click", () => make(true)); }
    };
    const draw = () => {
      if (!chapters.length) { make(false); return; }
      const ts = timesOf(); const T = Math.max(1, total() || ts[ts.length - 1].end || 1);
      wrap.innerHTML = `<div class="ch-track"><div class="ch-bar" role="group" aria-label="商談の段階">` + chapters.map((c, i) => `<button type="button" class="ch-seg" data-sec="${ts[i].start}" style="width:${Math.max(2, ((ts[i].end - ts[i].start) / T) * 100)}%;background:${PHASE_COLOR[c.phase] || "#9db3ab"}" title="${esc(c.phase)}（${mmss(ts[i].start)}〜）${c.note ? " " + esc(c.note) : ""}"><span class="ch-seg-label">${esc(c.phase)}</span></button>`).join("") + `</div></div>
        <div class="ch-tools"><button type="button" class="ch-toggle">${chOpen() ? "段階の一覧を隠す" : "段階の一覧を出す"}</button><button type="button" class="ch-redo">作り直す</button></div>
        <div class="ch-list${chOpen() ? "" : " is-hidden"}">` + chapters.map((c, i) => `<button type="button" class="ch-item" data-sec="${ts[i].start}"><span class="ch-dot" style="background:${PHASE_COLOR[c.phase] || "#9db3ab"}"></span><span class="ch-time">${mmss(ts[i].start)}</span><span class="ch-phase">${esc(c.phase)}</span><span class="ch-note">${esc(c.note || "")}</span></button>`).join("") + `</div>`;
      wrap.querySelectorAll("[data-sec]").forEach((b) => b.addEventListener("click", () => seek(Number(b.dataset.sec) || 0)));
      const tg = wrap.querySelector(".ch-toggle"); tg.addEventListener("click", () => { const o = !chOpen(); try { localStorage.setItem("kinbot_ch_open", o ? "1" : "0"); } catch {} wrap.querySelector(".ch-list").classList.toggle("is-hidden", !o); tg.textContent = o ? "段階の一覧を隠す" : "段階の一覧を出す"; });
      wrap.querySelector(".ch-redo").addEventListener("click", () => { if (confirm("段階を作り直しますか？（30秒ほどかかります）")) make(true); });
    };
    // 録画の長さが分かったら、秒の無い段階の位置を描き直す。再生中は今の段階に印を付ける
    const v = ve();
    if (v) {
      v.addEventListener("loadedmetadata", () => { if (chapters.length) draw(); }, { once: true });
      v.addEventListener("timeupdate", () => { if (!chapters.length) return; const ts = timesOf(); let k = 0; ts.forEach((t, i) => { if (v.currentTime >= t.start) k = i; }); wrap.querySelectorAll(".ch-seg").forEach((b, i) => b.classList.toggle("is-now", i === k)); });
    }
    draw();
  }
  // ===== 要約・FB & 分析：kinbot の商談履歴と同じ形（概要・要点・合意事項・宿題・相手の懸念／良かった点・改善点…）（2026-11-14）=====
  const mtGroup = (label, items, cls) => Array.isArray(items) && items.length ? `<div class="sgroup${cls ? " " + cls : ""}"><div class="label">${label}</div><ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>` : "";
  const mtSumText = (s) => { const L = []; if (s.overview) L.push(s.overview, ""); const sec = (l, a) => { if (Array.isArray(a) && a.length) { L.push("■" + l); a.forEach((x) => L.push("・" + x)); L.push(""); } }; sec("要点", s.key_points); sec("合意事項", s.agreements); sec("宿題・次アクション", s.action_items); sec("相手の懸念", s.customer_concerns); return L.join("\n").trim(); };
  async function mtReview(id, tr, tab, saved, force) {
    const box = $("mtRv"); if (!box) return;
    if (!force && !(saved && saved.summary) && mtReview._last && mtReview._last.id === id) saved = mtReview._last.rv;   // さっき作ったものを使う（タブを替えても作り直さない）
    let rv = !force && saved && saved.summary && Object.keys(saved.summary).length ? saved : null;
    if (!rv) {
      box.innerHTML = '<div class="mt-wait">文字起こしから要約とフィードバックを作っています…（30秒〜1分ほど）</div>';
      try { const r = await fetch(`/api/mochica/miitel/meetings/${encodeURIComponent(id)}/summary`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ tr, rep: hostOf(mtAll.find((x) => x.id === id) || {}), force: !!force }) });
        const d = await r.json(); if (!r.ok) throw new Error(d.error || "作れませんでした"); rv = d; }
      catch (e) { if ($("mtRv") !== box) return; box.innerHTML = `<div class="mt-wait">作れませんでした：${esc(e.message)}　<button type="button" class="mt-btn ghost" data-rvredo>もう一度作る</button></div>`; const b = box.querySelector("[data-rvredo]"); if (b) b.addEventListener("click", () => mtReview(id, tr, tab, null, true)); return; }
      // 開き直さなくても次から出るように、手元にも持っておく
      const m0 = mtAll.find((x) => x.id === id); if (m0) m0._review = rv; mtReview._last = { id, rv };
    }
    if ($("mtRv") !== box) return;
    const s = rv.summary || {}, fb = rv.feedback || {};
    const body = tab === "an"
      ? (fb.overall ? `<p class="overview">${esc(fb.overall)}</p>` : "") + mtGroup("良かった点", fb.good_points) + mtGroup("改善点", fb.improvements, "concerns") + mtGroup("見落とし・機会損失", fb.missed, "concerns") + mtGroup("次回への宿題", fb.next_steps, "actions")
      : (s.formatted && !s.key_points ? `<div class="summary-fmt">${esc(s.formatted)}</div>` : (s.overview ? `<p class="overview">${esc(s.overview)}</p>` : "") + mtGroup("要点", s.key_points) + mtGroup("合意事項", s.agreements) + mtGroup("宿題・次アクション", s.action_items, "actions") + mtGroup("相手の懸念", s.customer_concerns, "concerns"));
    box.innerHTML = `<div style="display:flex;gap:8px;justify-content:flex-end;margin-bottom:4px">${tab === "sm" ? '<button type="button" class="mt-btn ghost" data-rvcopy>要約をコピー</button>' : ""}<button type="button" class="mt-btn ghost" data-rvredo>作り直す</button></div>${body || '<div class="mt-wait">中身が空でした。「作り直す」を押してください。</div>'}`;
    const cp = box.querySelector("[data-rvcopy]"); if (cp) cp.addEventListener("click", async () => { try { await navigator.clipboard.writeText(s.formatted && !s.key_points ? s.formatted : mtSumText(s)); cp.textContent = "コピーしました"; setTimeout(() => (cp.textContent = "要約をコピー"), 1500); } catch {} });
    box.querySelector("[data-rvredo]").addEventListener("click", () => { if (confirm("要約とフィードバックを作り直しますか？（1分ほどかかります）")) mtReview(id, tr, tab, null, true); });
  }
  async function mtOpen(id) {
    mtSel = id; if (mtHost != null) mtDraw(); const main = $("mtMain"); main.innerHTML = '<div class="mt-empty">読み込んでいます…</div>';
    let it; try { it = (await api(`/api/mochica/miitel/meetings/${encodeURIComponent(id)}`)).item; } catch (e) { main.innerHTML = `<div class="mt-empty">読めませんでした：${esc(e.message)}</div>`; return; }
    const p = it.payload || {}; const v = p.video || p.meeting || p.data || p; const cal = p.mt_cal && !p.mt_cal.none ? p.mt_cal : null; const calWhy = p.mt_cal && p.mt_cal.none ? p.mt_cal.reason || "カレンダーの予定が見つかりませんでした" : (!p.mt_cal ? "カレンダーと突き合わせ中です（一覧を開くと自動で進みます）" : "");
    const tr0 = v.transcript || v.transcription || v.utterances || v.speeches || null;
    const tr = Array.isArray(tr0) ? tr0.map((u) => typeof u === "string" ? { s: "", t: u } : { s: String((u.speaker && (u.speaker.name || u.speaker)) || u.speaker_name || u.name || ""), t: String(u.text || u.phrase || u.content || ""), at: u.start || u.start_time || null }).filter((u) => u.t)
      : typeof tr0 === "string" ? tr0.split(/\n+/).filter(Boolean).map((x) => ({ s: "", t: x })) : [];
    let minutes = String(v.minutes || (typeof v.summary === "string" ? v.summary : "") || "").trim();
    // 拡張機能が MiiTel のページから写した文字起こし（mt_phrases）・議事録（mt_summary）（2026-11-12）
    const firstArr = (o, d = 0) => { if (Array.isArray(o)) return o; if (!o || typeof o !== "object" || d > 3) return []; for (const x of Object.values(o)) { const a = firstArr(x, d + 1); if (a.length) return a; } return []; };
    const pick = (o, ks) => { for (const k of ks) { const val = k.split(".").reduce((a, b) => (a == null ? a : a[b]), o); if (val != null && val !== "" && typeof val !== "object") return val; } return ""; };
    const mtPh = firstArr(p.mt_phrases);
    if (!tr.length && mtPh.length) {
      for (const u of mtPh) { if (!u || typeof u !== "object") continue; const tx = String(pick(u, ["text", "phrase", "content", "sentence", "body", "value"]) || ""); if (!tx) continue;
        let sec = Number(pick(u, ["start_time", "start", "begin_time", "begin", "offset", "start_sec", "started_at"])); if (sec > 100000) sec = sec / 1000;
        tr.push({ s: String(pick(u, ["speaker_name", "speaker.name", "user.name", "participant.name", "participant_name", "name", "speaker", "user_name"]) || ""), t: tx, at: isFinite(sec) && sec > 0 ? sec : null }); }
    }
    let minutesHtml = "";
    if (!minutes && p.mt_summary != null) {
      const sm = p.mt_summary;
      if (typeof sm === "string") minutes = sm;
      else { const secs = firstArr(sm).filter((x) => x && typeof x === "object");
        if (secs.length && secs.some((x) => pick(x, ["title", "heading", "name"]) || pick(x, ["content", "text", "body", "summary"]))) minutesHtml = secs.map((x) => { const h = pick(x, ["title", "heading", "name", "topic"]); const c = pick(x, ["content", "text", "body", "summary", "description", "value"]); const sub = firstArr(x).map((y) => typeof y === "string" ? y : pick(y, ["content", "text", "body", "value"])).filter(Boolean); return `${h ? `<h3 style="font-size:14px;margin:12px 0 4px;color:#0B6E78">${esc(h)}</h3>` : ""}${c ? `<div class="mt-doc">${esc(c)}</div>` : ""}${sub.length ? `<ul style="margin:4px 0 0 18px;padding:0;font-size:13.5px;line-height:1.8">${sub.map((y) => `<li>${esc(y)}</li>`).join("")}</ul>` : ""}`; }).join("");
        else { let best = ""; const walk = (o, d) => { if (d > 5 || o == null) return; if (typeof o === "string") { if (o.length > best.length) best = o; return; } if (typeof o === "object") Object.values(o).forEach((x) => walk(x, d + 1)); }; walk(sm, 0); minutes = best; } }
    }
    const at = it.started_at || it.received_at; const url = it.url || `https://mochica.app.miitel.com/app/video/${id}`;
    // Webhook で届いた中身から、録画のファイルらしい URL を探す（mp4・m3u8・webm、または download／recording／media／video_url の項目）（2026-11-12）
    const media = (() => { const hits = []; const walk = (o, k0, d) => { if (d > 6 || o == null) return; if (typeof o === "string") { if (/^https?:\/\//.test(o) && (/\.(mp4|m3u8|webm|mov|m4a|mp3|wav)(\?|$)/i.test(o) || /(download|recording|media|video_url|audio_url|file_url)/i.test(k0 || ""))) hits.push({ k: k0, u: o }); return; } if (Array.isArray(o)) { o.forEach((x) => walk(x, k0, d + 1)); return; } if (typeof o === "object") for (const [k, x] of Object.entries(o)) walk(x, k, d + 1); }; walk(p, "", 0); return hits; })();
    const playable = media.find((h) => /\.(mp4|webm|mov|m4a|mp3|wav)(\?|$)/i.test(h.u)) || media[0] || null;
    const tabs = [["tr", "文字起こし"], ["mn", "議事録"], ["sm", "要約"], ["an", "FB & 分析"], ["ml", "御礼メール"], ["sf", "SF連携"]];
    const pane = (k) => {
      if (k === "tr") return tr.length ? `<div class="mt-tr">${tr.map((u) => `<div class="ln">${u.at != null ? `<span class="tm">${esc(typeof u.at === "number" ? `${Math.floor(u.at / 60)}:${String(Math.floor(u.at % 60)).padStart(2, "0")}` : String(u.at).slice(11, 16))}</span>` : ""}${u.s ? `<span class="spk">${esc(u.s)}</span>` : ""}<span>${esc(u.t)}</span></div>`).join("")}</div>`
        : '<div class="mt-wait">文字起こしは、まだ kinbot に入っていません。MiiTel の Webhook で文字起こしごと届いた会議は、ここに話した人つきで出ます。録画と文字起こしは上の「MiiTel で開く」から見られます。</div>';
      if (k === "mn") return minutesHtml ? minutesHtml : minutes ? `<div class="mt-doc">${esc(minutes)}</div>` : '<div class="mt-wait">MiiTel の議事録は、まだ kinbot に入っていません（MiiTel の Webhook の通知ルールに「議事録作成完了時」を足すと届きます）。</div>';
      if (k === "sm" || k === "an") return tr.length >= 6 ? '<div id="mtRv"><div class="mt-wait">読み込んでいます…</div></div>' : '<div class="mt-wait">文字起こしが入った会議から、kinbot が要約を作ります。この会議にはまだ文字起こしがありません。</div>';
      if (k === "ml") return '<div class="mt-wait">御礼メールの下書きは、文字起こしが入った会議から作ります（準備中）。</div>';
      return '<div id="mtSf" class="mt-sf"><div class="mt-wait">SF の商談を読み込んでいます…</div></div>';
    };
    const cur = mtOpen.tab || "tr";
    const hasVid = !!(p.mt_video && p.mt_video.fileId);
    main.innerHTML = `${hasVid ? `<video class="mt-video" id="mtVideo" controls preload="metadata" playsinline></video>` : `<div class="mt-rec"><b>録画はまだ kinbot にありません</b><button type="button" class="mt-grab" data-grab>録画を kinbot に取り込む</button><a href="${esc(url)}" target="_blank" rel="noopener" style="background:none;color:#CFF5F7;font-weight:700;padding:0">MiiTel で見る ↗</a><small id="mtGrabSt" style="opacity:.85"></small></div>`}${tr.length >= 6 ? '<div class="ch-wrap" id="mtCh" style="margin-top:10px"></div>' : ""}
      <div class="mt-title"><h2>${esc((cal && cal.title) || it.title || "（題名なし）")}</h2><a class="mt-btn ghost" href="${esc(url)}" target="_blank" rel="noopener">MiiTel で開く ↗</a></div>
      ${calWhy ? `<div class="mc-note" style="margin:-4px 0 10px;font-size:11.5px">📅 ${esc(calWhy)}</div>` : ""}<div class="mt-fields">${cal && cal.company && cal.company !== "(無題)" ? `<div><span>会社</span><b>${esc(cal.company)}${cal.sf && cal.sf.leadId ? ` <a href="https://ap10.lightning.force.com/lightning/r/Lead/${esc(cal.sf.leadId)}/view" target="_blank" rel="noopener" style="font-size:11px">SFのリード ↗</a>` : ""}${cal.sf && cal.sf.accountId ? ` <a href="https://ap10.lightning.force.com/lightning/r/Account/${esc(cal.sf.accountId)}/view" target="_blank" rel="noopener" style="font-size:11px">SFの取引先 ↗</a>` : ""}</b></div>` : ""}<div><span>担当</span><b>${esc((cal && cal.ownerName) || (it.host && it.host !== "オーナー" ? it.host : "") || "—")}</b></div><div><span>日時</span><b>${at ? `${md(at)}（${wk(at)}） ${hm(at)}` : "—"}</b></div><div><span>長さ</span><b>${it.duration_sec ? Math.round(it.duration_sec / 60) + "分" : "—"}</b></div><div><span>参加者</span><b>${esc(/\[object Object\]/.test(it.participants || "") ? "—" : it.participants || "—")}</b></div></div>
      <div class="mt-tabs">${tabs.map(([k, l]) => `<button type="button" data-mtab="${k}" class="${k === cur ? "on" : ""}">${l}</button>`).join("")}</div>
      <div id="mtPane">${pane(cur)}</div>
      ${p && p.source !== "claude-mcp" && Object.keys(p).length ? `<details class="mt-raw" style="margin-top:16px"><summary style="cursor:pointer;font-size:12px;color:#5C7377;font-weight:700">MiiTel から届いた中身（項目の確かめ用）</summary><pre style="white-space:pre-wrap;font-size:11px;background:#F2FAFB;border-radius:10px;padding:10px;max-height:320px;overflow:auto">${esc(JSON.stringify(p, (k, x) => (typeof x === "string" && x.length > 300 ? x.slice(0, 300) + "…" : Array.isArray(x) && x.length > 5 ? [...x.slice(0, 5), `…ほか${x.length - 5}件`] : x), 2))}</pre></details>` : ""}`;
    // 録画：ドライブに置いた録画を HLS（バイトの範囲つき）で再生
    if (hasVid) { const ve = $("mtVideo"); const src = `/api/mochica/miitel/video/${encodeURIComponent(id)}.m3u8`;
      if (window.Hls && window.Hls.isSupported()) { const h = new window.Hls(); h.loadSource(src); h.attachMedia(ve); } else ve.src = src; }
    // 商談の段階（kinbot と同じ帯と一覧）（2026-11-14 田中さん）
    if (tr.length >= 6) mtChapters(id, tr, (p.mt_chapters && p.mt_chapters.chapters) || [], Number(it.duration_sec) || 0, hostOf(mtAll.find((x) => x.id === id) || it));
    // 録画の取り込み：拡張機能が MiiTel の会議を裏で開いて、録画の細切れを kinbot に送る
    const gb = main.querySelector("[data-grab]"); if (gb) gb.addEventListener("click", () => {
      if (!document.documentElement.dataset.kbMiitelExt) { alert("拡張機能 kinbot-ext（1.5.0 以上）が必要です。入れ直して、この画面を開き直してください。"); return; }
      if (!confirm("MiiTel にログインしたまま、この会議を裏のタブで開いて、録画を kinbot（Google ドライブ）に取り込みます。1時間の会議で数分かかります。始めますか？")) return;
      window.postMessage({ __kbMiitelCrawl: true, urls: [`${url}#kbGrabVideo`] }, "*"); gb.disabled = true; gb.textContent = "取り込んでいます…";
      const t0 = Date.now(); const tick = setInterval(() => { try { const pg = JSON.parse(document.documentElement.dataset.kbMtVid || "null"); const sEl = $("mtGrabSt");
        if (pg && pg.at > t0 && pg.videoId === id) { if (pg.error) { clearInterval(tick); gb.disabled = false; gb.textContent = "もう一度取り込む"; if (sEl) sEl.textContent = "取り込めませんでした：" + pg.error; }
          else if (pg.done) { clearInterval(tick); if (sEl) sEl.textContent = "取り込みました。開き直しています…"; setTimeout(() => mtOpen(id), 3000); }
          else if (sEl) sEl.textContent = `${pg.i}/${pg.total}`; } } catch {} }, 3000); });
    main.querySelectorAll("[data-mtab]").forEach((b) => b.addEventListener("click", () => { mtOpen.tab = b.dataset.mtab; main.querySelectorAll("[data-mtab]").forEach((x) => x.classList.toggle("on", x === b)); $("mtPane").innerHTML = pane(b.dataset.mtab); if (b.dataset.mtab === "sf") mtSfLoad(id); if (b.dataset.mtab === "sm" || b.dataset.mtab === "an") mtReview(id, tr, b.dataset.mtab, p.mt_review); }));
    if (cur === "sm" || cur === "an") mtReview(id, tr, cur, p.mt_review);
    if (cur === "sf") mtSfLoad(id);
  }
  // ブラウザの自動入力（メールアドレスなど）が探す欄に入って「0件」になるのを防ぐ（2026-11-12）
  // Bales に SF の情報を入れる：SF の Mochica（リード）の値を、リードの ID で（2026-11-13）
  { const rb = $("mcBalesRun"); if (rb) rb.addEventListener("click", async () => {
      const sc = ($("mcBalesScope") || {}).value || "lost"; rb.disabled = true; rb.textContent = "集計しています…（1〜2分）"; const box = $("mcBalesSum");
      try { const d = await api(`/api/mochica/bales/leads/summary?fresh=1&scope=${sc}`);
        box.innerHTML = `SF の Mochica（リード）<b>${d.count.toLocaleString()}</b> 件（失注日あり ${d.lost.toLocaleString()} 件）<div style="margin-top:6px;font-size:12px">${d.fields.filter((f0) => f0.filled).map((f0) => `${esc(f0.label)} ${f0.filled.toLocaleString()}`).join("・")}</div>` + (d.sample || []).map((r) => `<div style="margin-top:8px;padding:8px 10px;background:#F2FAFB;border-radius:10px"><b>${esc(r["会社名"])}</b>（${esc(r.SalesforceID)}）　失注 ${esc(r["失注商談失注日"])}・${esc(r["失注商談失注理由大"])}${r["失注商談失注理由中"] ? `／${esc(r["失注商談失注理由中"])}` : ""}</div>`).join("");
        const a = $("mcBalesCsv"); a.href = `/api/mochica/bales/leads.csv?scope=${sc}`; a.style.display = "";
      } catch (e) { box.textContent = "集計できませんでした：" + e.message; } finally { rb.disabled = false; rb.textContent = "もう一度集計する"; } }); }
  // 拡張機能で、文字起こしがまだの会議を MiiTel で裏で開いて読む（1回30件まで）（2026-11-12）
  { const rb = $("mtRead"); if (rb) rb.addEventListener("click", () => {
      if (!document.documentElement.dataset.kbMiitelExt) { alert("拡張機能 kinbot-ext（1.4.0 以上）が必要です。kinbot の設定 → 拡張機能 から入れ直して、この画面を開き直してください。"); return; }
      // 自動と同じ流れ（新しい会議の一覧 → 文字起こし・録画がまだの会議）を今すぐ動かす（2026-11-12）
      if (!confirm("MiiTel にログインしたまま、新しい会議を探して、文字起こし・議事録・録画がまだの会議を裏のタブで読みます（20分ごとにも自動で動いています）。今すぐ始めますか？")) return;
      window.postMessage({ __kbMiitelAutoNow: true }, "*"); rb.disabled = true; rb.textContent = "読んでいます…";
      const tick0 = setInterval(() => { try { const c = JSON.parse(document.documentElement.dataset.kbMtCrawl || "null"); if (c && c.total) rb.textContent = `読んでいます… ${c.done}/${c.total}`; if (c && c.at > Date.now() - 30000 && c.done >= c.total) { clearInterval(tick0); rb.disabled = false; loadMeetings(); } } catch {} }, 5000);
      return;
      let urls = mtAll.filter((m) => !m.transcript_len).slice(0, 30).map((m) => m.url || `https://mochica.app.miitel.com/app/video/${m.id}`);
      // まだ会議が無いときは、MiiTel の会議履歴のページを裏で開いて、会議の一覧を読み込む（そのあと、もう一度押すと文字起こし・議事録を読む）
      if (!urls.length) { urls = ["https://mochica.app.miitel.com/app/video"]; if (!confirm("MiiTel にログインしたまま、MiiTel の会議履歴のページを裏のタブで開いて、会議の一覧を読み込みます（15秒ほど）。始めますか？")) return; }
      else if (!confirm(`MiiTel にログインしたまま、${urls.length}件の会議を裏のタブで1件ずつ開いて読みます（1件15秒ほど・全部で${Math.ceil(urls.length * 15 / 60)}分ほど）。始めますか？`)) return;
      window.postMessage({ __kbMiitelCrawl: true, urls }, "*"); rb.disabled = true; rb.textContent = "読んでいます…（終わったら一覧を開き直してください）";
      const tick = setInterval(() => { try { const c = JSON.parse(document.documentElement.dataset.kbMtCrawl || "null"); if (c && c.total) rb.textContent = `読んでいます… ${c.done}/${c.total}`; if (c && c.done >= c.total) { clearInterval(tick); rb.disabled = false; loadMeetings(); } } catch {} }, 5000);
    }); }
  // 拡張機能の様子は、ヘッダーのボタンで開く小さな窓に（2026-11-13 田中さん）
  { const btn = $("mtDiagBtn"), pop = $("mtDiagPop"); if (btn && pop) { btn.addEventListener("click", (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; btn.setAttribute("aria-expanded", String(!pop.hidden)); });
      document.addEventListener("click", (e) => { if (!pop.hidden && !e.target.closest(".mt-diag-w")) { pop.hidden = true; btn.setAttribute("aria-expanded", "false"); } }); } }
  // 拡張機能の様子（見た MiiTel の通り道・送った結果）を5秒ごとに出す（2026-11-12）
  setInterval(() => { const b = $("mtDiagBody"); if (!b) return; const ext = document.documentElement.dataset.kbMiitelExt; let dg = null; try { dg = JSON.parse(document.documentElement.dataset.kbMtDiag || "null"); } catch {}
    let cr = null; try { cr = JSON.parse(document.documentElement.dataset.kbMtCrawl || "null"); } catch {}
    let vp = null; try { vp = JSON.parse(document.documentElement.dataset.kbMtVid || "null"); } catch {}
    { const st = $("mtAutoSt"); if (st) st.textContent = !ext ? "拡張機能が見えません" : cr && cr.done < cr.total && Date.now() - cr.at < 1800000 ? `自動で読んでいます ${cr.done}/${cr.total}${vp && !vp.done && !vp.error && Date.now() - vp.at < 300000 ? `（録画 ${vp.i || 0}/${vp.total || "?"}）` : ""}` : "20分ごとに自動で読みます"; }
    b.innerHTML = !ext ? "拡張機能 kinbot-ext（1.6.1 以上）が見えません。入れ直して、この画面を開き直してください。" : `${cr ? `裏で開いた数：${cr.done}/${cr.total}<br>` : ""}${vp ? `録画：${vp.error ? `取り込めませんでした（${esc(vp.error)}）` : vp.done ? "取り込みました" : `${vp.i || 0}/${vp.total || "?"}`}<br>` : ""}送り直し待ち：${dg ? dg.pending : 0}件<br>送った結果：${dg && dg.last.length ? dg.last.map((x) => `${esc(x.kind)}（${x.ok ? "OK" : "NG " + esc(String(x.status))}・${Math.round(x.len / 1000)}k）`).join("、") : "まだなし"}<br>見た MiiTel の通り道：${dg && dg.seen.length ? dg.seen.map((x) => esc(x.path)).join("<br>") : "まだなし（MiiTel のページを開くと出ます）"}`; }, 5000);
  { const q = $("mtQ"); if (q) { q.addEventListener("input", mtDraw); const clr = () => { if (/@/.test(q.value)) { q.value = ""; mtDraw(); } }; setTimeout(clr, 300); setTimeout(clr, 1500); } }
  // ===== SF 連携：ステージごとの項目を議事録から埋めて、SF の「新規」の商談に書く（2026-11-13）=====
  async function mtSfLoad(vid) {
    const box = $("mtSf"); if (!box) return;
    let d; try { d = await api(`/api/mochica/sf/form?vid=${encodeURIComponent(vid)}`); } catch (e) { box.innerHTML = `<div class="mt-wait">読めませんでした：${esc(e.message)}</div>`; return; }
    if (!d.opp) { box.innerHTML = '<div class="mt-wait">SF の「新規」の商談が見つかりませんでした。カレンダーの予定のタイトルに会社名が入っていて、SF にその会社の「新規」の商談があると、ここに出ます。</div>'; return; }
    const cur = d.current || {}; const curKey = (String(d.opp.StageName || "").match(/^(\d{2})/) || [])[1] || "01";
    const order = ["01", "02", "03", "04", "05", "06", "08", "99"]; const nextKey = order[Math.min(order.indexOf(curKey) + 1, order.length - 2)] || "02";
    let sel = mtSfLoad.sel && mtSfLoad.vid === vid ? mtSfLoad.sel : nextKey; mtSfLoad.vid = vid;
    const draw = () => {
      mtSfLoad.sel = sel; const def = d.defs.find((x) => x.key === sel) || d.defs[0]; const req = new Set((d.required || {})[sel] || []);
      const inp = (f) => { if (f.missing) return `<div class="mt-sf-f miss"><span>${esc(f.label)}</span><small>SF にこの名前の項目が見つかりません</small></div>`;
        const v = cur[f.name]; const r = req.has(f.name) ? `<em class="req" title="${esc(((d.requiredWhy || {})[`${sel}:${f.name}`] || []).join(" ／ ") || "SF の入力チェックで止められたことのある項目")}">必須</em>` : ""; const nm = `data-sf="${esc(f.name)}"`;
        let el;
        if (f.type === "picklist" || f.type === "multipicklist") el = `<select ${nm}><option value=""></option>${f.options.map((o) => `<option ${String(v || "") === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
        else if (f.type === "boolean") el = `<label class="chk"><input type="checkbox" ${nm} ${v ? "checked" : ""}> はい</label>`;
        else if (f.type === "date") el = `<input type="date" ${nm} value="${esc(v || "")}">`;
        else if (f.type === "textarea" || (f.length || 0) > 255) el = `<textarea ${nm} rows="${/メモ|現状|ヒアリング|詳細/.test(f.label) ? 6 : 3}">${esc(v || "")}</textarea>`;
        else if (["double", "int", "currency", "percent"].includes(f.type)) el = `<input type="number" ${nm} value="${esc(v ?? "")}">`;
        else el = `<input type="text" ${nm} value="${esc(v || "")}" ${f.updateable ? "" : "readonly"}>`;
        return `<label class="mt-sf-f" data-fw="${esc(f.name)}"><span>${esc(f.label)}${r}</span>${el}</label>`; };
      box.innerHTML = `<div class="mt-sf-top"><div><b><a href="${esc(d.sfBase)}/lightning/r/Opportunity/${esc(d.opp.Id)}/view" target="_blank" rel="noopener">${esc(d.opp.Name)} ↗</a></b><small>今のステージ：${esc(d.opp.StageName || "—")}</small></div>
          <label class="mt-sf-st">進めるステージ<select data-sf-stage>${d.defs.map((x) => `<option value="${x.key}" ${x.key === sel ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select></label></div>
        <div class="mt-sf-grid">${def.fields.map(inp).join("")}</div>
        <div class="mt-sf-err" data-sf-err hidden></div>
        <div class="mt-sf-act"><button type="button" class="mt-btn ghost" data-sf-fill>議事録から AI で埋める</button><button type="button" class="mt-btn" data-sf-save>${esc(def.label.split("：")[0])}としてSFに書く</button><span class="mc-note" data-sf-msg></span></div>
        <div class="mc-note" style="margin-top:6px">「必須」は、SF の入力チェック（${d.rulesCount ? `${d.rulesCount}件を読みました` : d.rulesErr ? `読めませんでした：${esc(d.rulesErr)}` : "読み込み中"}）から読んだ項目と、SF に止められて覚えた項目です。空のままだと、書く前に止めます。札に指を置くと理由が出ます。</div>`;
      box.querySelector("[data-sf-stage]").addEventListener("change", (e) => { sel = e.target.value; draw(); });
      const vals = () => { const o = {}; box.querySelectorAll("[data-sf]").forEach((el) => { o[el.dataset.sf] = el.type === "checkbox" ? el.checked : el.value; }); return o; };
      box.querySelector("[data-sf-fill]").addEventListener("click", async (e) => { const b = e.target; b.disabled = true; b.textContent = "議事録から埋めています…（30秒ほど）";
        try { const r = await api("/api/mochica/sf/fill", { method: "POST", body: JSON.stringify({ vid, fields: def.fields.filter((f) => f.name) }) }); let n = 0;
          for (const [k, v] of Object.entries(r.values || {})) { const el = box.querySelector(`[data-sf="${k}"]`); if (!el) continue; if (el.type === "checkbox") el.checked = v === true || v === "true"; else el.value = String(v); el.closest("[data-fw]").classList.add("ai"); n++; }
          box.querySelector("[data-sf-msg]").textContent = `${n}項目を埋めました。確かめてから「SFに書く」を押してください。`;
        } catch (err) { alert(err.message); } finally { b.disabled = false; b.textContent = "議事録から AI で埋める"; } });
      box.querySelector("[data-sf-save]").addEventListener("click", async (e) => { const b = e.target; const v = vals(); const er = box.querySelector("[data-sf-err]");
        box.querySelectorAll("[data-fw]").forEach((w) => w.classList.remove("bad"));
        const lack = [...req].filter((n) => v[n] === "" || v[n] == null || v[n] === false);
        if (lack.length) { er.hidden = false; er.textContent = "このステージで必須の項目が空です。入れてから書いてください。"; lack.forEach((n) => { const w = box.querySelector(`[data-fw="${n}"]`); if (w) w.classList.add("bad"); }); return; }
        if (!confirm(`「${d.opp.Name}」を ${def.label} として SF に書きますか？`)) return; b.disabled = true;
        try { const r = await api("/api/mochica/sf/save", { method: "POST", body: JSON.stringify({ vid, oppId: d.opp.Id, stageKey: def.key, stageValue: def.stageValue, fields: v, current: cur }) });
          if (r.ok) { er.hidden = true; box.querySelector("[data-sf-msg]").textContent = "SF に書きました。"; d.opp.StageName = def.stageValue || d.opp.StageName; Object.assign(cur, v); }
          else { er.hidden = false; er.innerHTML = (r.errors || []).map((x) => `・${esc(x.message)}`).join("<br>") + '<br><small>赤い枠の項目を入れて、もう一度押してください（この項目は次から必須として覚えます）。</small>'; (r.needs || []).forEach((n) => { const w = box.querySelector(`[data-fw="${n}"]`); if (w) w.classList.add("bad"); }); ((d.required || {})[def.key] = [...new Set([...((d.required || {})[def.key] || []), ...(r.needs || [])])]); }
        } catch (err) { alert(err.message); } finally { b.disabled = false; } });
    };
    draw();
  }
  go(location.hash.slice(1) || "home"); loadHome();
  // 下の段：頭文字の丸アイコン・名前・設定（歯車）・ログアウト（kinbot と同じ作り）
  fetch("/api/me", { credentials: "include" }).then((r) => r.json()).then((me) => {
    const who = $("who"); if (!who || !me) return; const name = me.name || me.username || "";
    who.textContent = name ? name + (me.admin ? "（管理者）" : "") : ""; who.title = me.username || "";
    const foot = who.parentElement;
    if (foot && name && !foot.querySelector(".side-avatar")) { const av = document.createElement("span"); av.className = "side-avatar"; av.setAttribute("aria-hidden", "true"); av.textContent = String(name).trim().charAt(0).toUpperCase(); foot.insertBefore(av, who); }
    if (foot && !foot.querySelector(".side-foot-set")) { const set = document.createElement("a"); set.className = "side-foot-set"; set.href = "#settings"; set.title = "設定"; set.setAttribute("aria-label", "設定");
      set.innerHTML = '<span class="side-ico ico-set"></span><span class="side-foot-set-label">設定</span>'; set.addEventListener("click", (e) => { e.preventDefault(); go("settings"); }); who.insertAdjacentElement("afterend", set); }
  }).catch(() => {});
  const lo = $("logout"); if (lo) lo.addEventListener("click", async (e) => { e.preventDefault(); await fetch("/api/logout", { method: "POST" }); location.href = "/login.html"; });
})();
