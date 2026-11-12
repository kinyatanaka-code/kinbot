// kinbot の MOCHICA の箱（2026-11-12 田中さん：DOC を壊さずに別の箱。色は緑っぽい水色）
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (u, o = {}) => { const r = await fetch(u, { credentials: "include", headers: { "content-type": "application/json" }, ...o }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j; };
  const TITLES = { home: "ホーム", mtg: "商談（MiiTel）", list: "リスト（Bales Cloud）", call: "架電（Zoom Phone）", apo: "アポ（カレンダー）", doc: "DOC の議事録", settings: "設定（連携）" };
  const go = (k) => {
    if (!TITLES[k]) k = "home";
    document.querySelectorAll("[data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== k; });
    document.querySelectorAll(".side-item[data-go]").forEach((a) => a.classList.toggle("active", a.dataset.go === k));
    $("mcTitle").textContent = TITLES[k]; if (location.hash !== "#" + k) history.replaceState(null, "", "#" + k);
    if (k === "settings") loadConfig();
    if (k === "mtg") loadMeetings();
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
  const hostOf = (m) => String(m.host || "").trim() || "（担当なし）";
  function mtDraw() {
    const box = $("mtList"); if (!box) return;
    const q = String(($("mtQ") || {}).value || "").trim().toLowerCase();
    const need = mtAll.filter((m) => !m.transcript_len).length; const rb = $("mtRead");
    if (rb && !rb.disabled) { rb.hidden = false; rb.textContent = "MiiTel から今すぐ読む（20分ごとに自動）"; }
    if (!mtAll.length) { $("mtCount").textContent = "0件"; box.innerHTML = '<div class="mc-note" style="padding:10px">まだありません。上の「MiiTel から会議を読み込む」を押すと、MiiTel の会議履歴から読み込みます。</div>'; return; }
    // ① 担当のカード（kinbot の商談履歴と同じ）
    if (mtHost == null) {
      const by = new Map(); for (const m of mtAll) { const h = hostOf(m); const v = by.get(h) || { n: 0, tr: 0, last: "" }; v.n++; if (m.transcript_len) v.tr++; const at = m.started_at || m.received_at || ""; if (at > v.last) v.last = at; by.set(h, v); }
      const hs = [...by.entries()].filter(([h]) => !q || h.toLowerCase().includes(q)).sort((a, b) => b[1].n - a[1].n || String(b[1].last).localeCompare(String(a[1].last)));
      $("mtCount").textContent = `${hs.length}人・${mtAll.length}商談`;
      box.innerHTML = hs.map(([h, v]) => `<div class="mt-pcard" data-host="${esc(h)}"><span class="av">${esc(h.replace(/^（|）$/g, "").slice(0, 1))}</span><span class="nm"><b>${esc(h)}</b><small>${v.n}商談${v.tr ? `・文字起こし${v.tr}` : ""}${v.last ? `・最新 ${md(v.last)}` : ""}</small></span><span class="go">›</span></div>`).join("") || '<div class="mc-note" style="padding:10px">見つかりませんでした</div>';
      box.querySelectorAll("[data-host]").forEach((el) => el.addEventListener("click", () => { mtHost = el.dataset.host; const qi = $("mtQ"); if (qi) qi.value = ""; mtDraw(); const first = mtAll.find((m) => hostOf(m) === mtHost); if (first) mtOpen(first.id); }));
      return;
    }
    // ② その担当の商談（日ごと）
    const list = mtAll.filter((m) => hostOf(m) === mtHost).filter((m) => !q || `${m.title || ""} ${m.participants || ""}`.toLowerCase().includes(q));
    $("mtCount").textContent = `${list.length}件`;
    let last = ""; let html = `<button type="button" class="mt-back" data-back>‹ 担当一覧</button><div class="mt-who"><span class="av">${esc(mtHost.replace(/^（|）$/g, "").slice(0, 1))}</span><b>${esc(mtHost)}</b><small>${list.length}商談</small></div>`;
    for (const m of list) {
      const at = m.started_at || m.received_at; const k = dkey(at);
      if (k !== last) { html += `<div class="mt-day">${md(at)}（${wk(at)}）</div>`; last = k; }
      html += `<div class="mt-card${m.id === mtSel ? " on" : ""}" data-mt="${esc(m.id)}"><div class="t">${esc(m.title || "（題名なし）")}</div><div class="m"><span>${hm(at)}</span>${m.duration_sec ? `<span>${Math.round(m.duration_sec / 60)}分</span>` : ""}</div><div class="tags">${m.transcript_len ? '<span class="mt-tag">文字起こしあり</span>' : '<span class="mt-tag none">文字起こし待ち</span>'}<span class="mt-tag sf">SF未記録</span></div></div>`;
    }
    box.innerHTML = html;
    box.querySelector("[data-back]").addEventListener("click", () => { mtHost = null; const qi = $("mtQ"); if (qi) qi.value = ""; mtDraw(); });
    box.querySelectorAll("[data-mt]").forEach((el) => el.addEventListener("click", () => mtOpen(el.dataset.mt)));
  }
  async function loadMeetings() {
    try { const d = await api("/api/mochica/miitel/meetings"); mtAll = (d.items || []).filter((m) => String(m.title || "").trim() || m.started_at || m.transcript_len); mtDraw(); }
    catch (e) { const b = $("mtList"); if (b) b.textContent = "読めませんでした：" + e.message; }
  }
  async function mtOpen(id) {
    mtSel = id; if (mtHost != null) mtDraw(); const main = $("mtMain"); main.innerHTML = '<div class="mt-empty">読み込んでいます…</div>';
    let it; try { it = (await api(`/api/mochica/miitel/meetings/${encodeURIComponent(id)}`)).item; } catch (e) { main.innerHTML = `<div class="mt-empty">読めませんでした：${esc(e.message)}</div>`; return; }
    const p = it.payload || {}; const v = p.video || p.meeting || p.data || p;
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
      if (k === "sm") return '<div class="mt-wait">要約は、文字起こしが入った会議から kinbot が作ります（準備中）。</div>';
      if (k === "an") return '<div class="mt-wait">話し方・良かった点・直す点などの分析は、文字起こしが入った会議から作ります（準備中）。</div>';
      if (k === "ml") return '<div class="mt-wait">御礼メールの下書きは、文字起こしが入った会議から作ります（準備中）。</div>';
      return '<div class="mt-wait">Salesforce の「MOCHICA リード」から新規の商談を立ち上げる・ステージを進める・記録を残すのは、ここから行えるようにします（準備中）。</div>';
    };
    const cur = mtOpen.tab || "tr";
    const hasVid = !!(p.mt_video && p.mt_video.fileId);
    main.innerHTML = `${hasVid ? `<video class="mt-video" id="mtVideo" controls preload="metadata" playsinline></video>` : `<div class="mt-rec"><b>録画はまだ kinbot にありません</b><button type="button" class="mt-grab" data-grab>録画を kinbot に取り込む</button><a href="${esc(url)}" target="_blank" rel="noopener" style="background:none;color:#CFF5F7;font-weight:700;padding:0">MiiTel で見る ↗</a><small id="mtGrabSt" style="opacity:.85"></small></div>`}
      <div class="mt-title"><h2>${esc(it.title || "（題名なし）")}</h2><a class="mt-btn ghost" href="${esc(url)}" target="_blank" rel="noopener">MiiTel で開く ↗</a></div>
      <div class="mt-fields"><div><span>担当</span><b>${esc(it.host || "—")}</b></div><div><span>日時</span><b>${at ? `${md(at)}（${wk(at)}） ${hm(at)}` : "—"}</b></div><div><span>長さ</span><b>${it.duration_sec ? Math.round(it.duration_sec / 60) + "分" : "—"}</b></div><div><span>参加者</span><b>${esc(it.participants || "—")}</b></div></div>
      <div class="mt-tabs">${tabs.map(([k, l]) => `<button type="button" data-mtab="${k}" class="${k === cur ? "on" : ""}">${l}</button>`).join("")}</div>
      <div id="mtPane">${pane(cur)}</div>
      ${p && p.source !== "claude-mcp" && Object.keys(p).length ? `<details class="mt-raw" style="margin-top:16px"><summary style="cursor:pointer;font-size:12px;color:#5C7377;font-weight:700">MiiTel から届いた中身（項目の確かめ用）</summary><pre style="white-space:pre-wrap;font-size:11px;background:#F2FAFB;border-radius:10px;padding:10px;max-height:320px;overflow:auto">${esc(JSON.stringify(p, (k, x) => (typeof x === "string" && x.length > 300 ? x.slice(0, 300) + "…" : Array.isArray(x) && x.length > 5 ? [...x.slice(0, 5), `…ほか${x.length - 5}件`] : x), 2))}</pre></details>` : ""}`;
    // 録画：ドライブに置いた録画を HLS（バイトの範囲つき）で再生
    if (hasVid) { const ve = $("mtVideo"); const src = `/api/mochica/miitel/video/${encodeURIComponent(id)}.m3u8`;
      if (window.Hls && window.Hls.isSupported()) { const h = new window.Hls(); h.loadSource(src); h.attachMedia(ve); } else ve.src = src; }
    // 録画の取り込み：拡張機能が MiiTel の会議を裏で開いて、録画の細切れを kinbot に送る
    const gb = main.querySelector("[data-grab]"); if (gb) gb.addEventListener("click", () => {
      if (!document.documentElement.dataset.kbMiitelExt) { alert("拡張機能 kinbot-ext（1.5.0 以上）が必要です。入れ直して、この画面を開き直してください。"); return; }
      if (!confirm("MiiTel にログインしたまま、この会議を裏のタブで開いて、録画を kinbot（Google ドライブ）に取り込みます。1時間の会議で数分かかります。始めますか？")) return;
      window.postMessage({ __kbMiitelCrawl: true, urls: [`${url}#kbGrabVideo`] }, "*"); gb.disabled = true; gb.textContent = "取り込んでいます…";
      const t0 = Date.now(); const tick = setInterval(() => { try { const pg = JSON.parse(document.documentElement.dataset.kbMtVid || "null"); const sEl = $("mtGrabSt");
        if (pg && pg.at > t0 && pg.videoId === id) { if (pg.error) { clearInterval(tick); gb.disabled = false; gb.textContent = "もう一度取り込む"; if (sEl) sEl.textContent = "取り込めませんでした：" + pg.error; }
          else if (pg.done) { clearInterval(tick); if (sEl) sEl.textContent = "取り込みました。開き直しています…"; setTimeout(() => mtOpen(id), 3000); }
          else if (sEl) sEl.textContent = `${pg.i}/${pg.total}`; } } catch {} }, 3000); });
    main.querySelectorAll("[data-mtab]").forEach((b) => b.addEventListener("click", () => { mtOpen.tab = b.dataset.mtab; main.querySelectorAll("[data-mtab]").forEach((x) => x.classList.toggle("on", x === b)); $("mtPane").innerHTML = pane(b.dataset.mtab); }));
  }
  // ブラウザの自動入力（メールアドレスなど）が探す欄に入って「0件」になるのを防ぐ（2026-11-12）
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
  // 拡張機能の様子（見た MiiTel の通り道・送った結果）を5秒ごとに出す（2026-11-12）
  setInterval(() => { const b = $("mtDiagBody"); if (!b) return; const ext = document.documentElement.dataset.kbMiitelExt; let dg = null; try { dg = JSON.parse(document.documentElement.dataset.kbMtDiag || "null"); } catch {}
    let cr = null; try { cr = JSON.parse(document.documentElement.dataset.kbMtCrawl || "null"); } catch {}
    b.innerHTML = !ext ? "拡張機能 kinbot-ext（1.4.2 以上）が見えません。入れ直して、この画面を開き直してください。" : `${cr ? `裏で開いた数：${cr.done}/${cr.total}<br>` : ""}送り直し待ち：${dg ? dg.pending : 0}件<br>送った結果：${dg && dg.last.length ? dg.last.map((x) => `${esc(x.kind)}（${x.ok ? "OK" : "NG " + esc(String(x.status))}・${Math.round(x.len / 1000)}k）`).join("、") : "まだなし"}<br>見た MiiTel の通り道：${dg && dg.seen.length ? dg.seen.map((x) => esc(x.path)).join("<br>") : "まだなし（MiiTel のページを開くと出ます）"}`; }, 5000);
  { const q = $("mtQ"); if (q) { q.addEventListener("input", mtDraw); const clr = () => { if (/@/.test(q.value)) { q.value = ""; mtDraw(); } }; setTimeout(clr, 300); setTimeout(clr, 1500); } }
  async function loadConfig() {
    try { const c = await api("/api/mochica/config");
      $("miDomain").value = c.miitel.domain || ""; $("miToken").value = ""; $("miToken").placeholder = c.miitel.tokenLast4 ? `保存済み（****${c.miitel.tokenLast4}）。変えるときだけ入れる` : "管理画面の「API」で発行したもの";
      $("baKey").value = ""; $("baKey").placeholder = c.bales.keyLast4 ? `保存済み（****${c.bales.keyLast4}）。変えるときだけ入れる` : "管理画面の「連携」「API」で発行したもの"; $("baNote").value = c.bales.note || "";
      $("sfLead").value = c.sf.leadType || ""; $("sfOpp").value = c.sf.oppPrefix || "";
      $("stMiitel").textContent = c.miitel.tokenLast4 ? "保存済み" : "未設定"; $("stBales").textContent = c.bales.keyLast4 ? "保存済み" : "未設定";
      if (c.hook) { $("mhUrl").value = c.hook.url || ""; $("mhHead").value = c.hook.header || ""; }
    } catch (e) { $("mcSaved").textContent = "読めませんでした：" + e.message; }
  }
  $("mcSave").addEventListener("click", async () => {
    const body = { miitel: { domain: $("miDomain").value.trim(), ...($("miToken").value.trim() ? { token: $("miToken").value.trim() } : {}) },
      bales: { note: $("baNote").value.trim(), ...($("baKey").value.trim() ? { key: $("baKey").value.trim() } : {}) },
      sf: { leadType: $("sfLead").value.trim(), oppPrefix: $("sfOpp").value.trim() } };
    try { await api("/api/mochica/config", { method: "PUT", body: JSON.stringify(body) }); $("mcSaved").textContent = "保存しました"; loadConfig(); loadHome(); }
    catch (e) { $("mcSaved").textContent = "保存できませんでした：" + e.message; }
  });
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
