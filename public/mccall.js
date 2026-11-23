// SHOBO の架電画面（MOCHICALL）（2026-11-16 新しく作成。kincall の複製ではない）
//   左＝調べる（会社・番号ごとのつながった実績・受付で聞けたこと・SF）／中央＝操作（発信と2段の結果）／右＝これまで（1本の時系列）
//   キーボードだけで1件を終えられる：1〜9 で選ぶ・Enter で記録して次へ・Backspace で戻る・C で発信・S で飛ばす・Z で元に戻す・? で一覧
//   （2026-11-17 クリックだけにした版を、福井さんの指示でキー操作ありに戻した。クリックでもすべて操作できる）
//   確認はブラウザの小窓（alert/confirm）を使わない。知らせは上の1か所に1件ずつ。
//   2026-11-20 福井さん「架電を阻害する機能や表示は一切削除」：リストの一覧と「次の企業」の先出しをなくし、1社ずつしか見えない。
//   発信してからでないと結果を選べない（飛ばすのはいつでもできる）。つながらない・現アナは押した瞬間に記録して次へ。不在は掛け直す時間を選ぶ（自動なら1を押すだけ）。
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (u, o = {}) => { const r = await fetch(u, { credentials: "include", headers: { "content-type": "application/json" }, ...o }); const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.error || `うまくいきませんでした（${r.status}）`), { status: r.status, data: j }); return j; };
  const post = (u, b) => api(u, { method: "POST", body: JSON.stringify(b || {}) });
  const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
  const digits = (v) => String(v || "").normalize("NFKC").replace(/[^0-9+]/g, "");
  const tm = (d) => { if (!d) return ""; const x = new Date(d); if (isNaN(x)) return String(d).slice(0, 10); return `${x.getMonth() + 1}/${x.getDate()} ${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; };
  const day = (d) => { const x = new Date(d); return isNaN(x) ? String(d).slice(0, 10) : `${x.getFullYear()}/${x.getMonth() + 1}/${x.getDate()}`; };
  const ICO = {
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/></svg>',
    skip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5l9 7-9 7z"/><path d="M19 5v14"/></svg>',
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><circle cx="12" cy="17" r=".6" fill="currentColor"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 7l8 6 8-6"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  };

  const S = { meta: null, admin: false, tab: "call", lists: [], listId: parseInt(ls.get("mcc_list") || "0", 10) || 0, queue: [], later: 0,
    d: null, cache: new Map(), f: null, notices: [], ni: 0, toast: null, busy: false, mounted: false, src: null, reps: null, ldBack: null };
  const blankForm = () => ({ step: "reach", reach: "", outcome: "", reason: "", apoAt: "", apoWho: "", nextAt: "", nextLabel: "", noRetry: false, memo: "", gate: { name: "", hours: "", direct: "" }, hearing: {}, phone: "", dialed: false, picks: {} });

  // MOCHICA は Zoom Phone で架電する決まりなので、いつも Zoom アプリで発信する
  // （kinbot の Zoom 連携の状態を読む API は、インターンのアカウントでは開けないため見ない）
  const callHref = (v) => `zoomphonecall://${digits(v)}`;

  function mount() {
    const root = $("mcCallView"); if (!root || S.mounted) return; S.mounted = true;
    root.innerHTML = `<div class="mcc">
      <div class="mcc-bar">
        <div class="mcc-tabs" role="tablist" id="mccTabs"></div>
        <select class="mcc-sel" id="mccList" aria-label="かけるリスト"></select>
        <div class="mcc-stats" id="mccStats" aria-label="今日の自分の数字"></div>
        <span class="mcc-sp"></span>
        <button class="mcc-btn" id="mccHelpBtn" aria-keyshortcuts="?">${ICO.help}キー操作</button>
      </div>
      <div class="mcc-notice" id="mccNotice" role="status" aria-live="polite"></div>
      <div class="mcc-grid" id="mccCall">
        <section class="mcc-col" id="mccLeft" aria-label="会社の情報"></section>
        <section class="mcc-col" id="mccCenter" aria-label="架電と結果の記録"></section>
        <section class="mcc-col right" id="mccRight" aria-label="これまでのやりとり"></section>
      </div>
      <div class="mcc-admin" id="mccAdmin" hidden></div>
    </div>`;
    $("mccHelpBtn").addEventListener("click", help);
    document.addEventListener("keydown", onKey);
    $("mccList").addEventListener("change", () => { S.listId = parseInt($("mccList").value, 10) || 0; ls.set("mcc_list", String(S.listId)); release(); S.d = null; loadQueue(true); });
    window.addEventListener("beforeunload", () => { if (S.d) navigator.sendBeacon && navigator.sendBeacon(`/api/mccall/leads/${S.d.lead.id}/release`); });
  }
  function drawTabs() {
    const tabs = [["call", "かける"], ["report", "レポート"], ["insight", "数字"]].concat(S.admin ? [["measures", "施策"], ["leads", "リード管理"], ["lists", "リストの管理"], ["cross", "部署をまたいだ記録"]] : []);
    $("mccTabs").innerHTML = tabs.map(([k, l]) => `<button role="tab" aria-selected="${S.tab === k}" data-t="${k}">${l}</button>`).join("");
    $("mccTabs").querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.t)));
    if (tabs.length === 1) $("mccTabs").hidden = true;
  }
  function setTab(t) {
    S.tab = t; S.ldBack = null; drawTabs();
    $("mccCall").hidden = t !== "call"; $("mccAdmin").hidden = t === "call"; $("mccList").hidden = t !== "call"; $("mccNotice").hidden = t !== "call";
    if (t === "leads") drawHub(); if (t === "lists") drawLists(); if (t === "cross") drawCross(); if (t === "measures") drawMeasures(); if (t === "report") drawReport(); if (t === "insight") drawInsight();
  }

  async function start() {
    mount();
    try {
      if (!S.meta) { S.meta = await api("/api/mccall/meta"); S.admin = !!S.meta.admin; }
      drawTabs(); setTab(S.tab);
      await loadLists(); loadStats();
      if (!S.d) await loadQueue(true);
      if (!S.inTimer) S.inTimer = setInterval(pollInbound, 4000);
    } catch (e) { $("mccCenter").innerHTML = `<div class="mcc-empty">架電の画面を開けませんでした：${esc(e.message)}<br>少し待ってから、ページを読み込み直してください。</div>`; }
  }
  async function loadLists() {
    const j = await api("/api/mccall/lists"); S.lists = j.items || [];
    if (S.listId && !S.lists.some((l) => l.id === S.listId)) S.listId = 0;
    $("mccList").innerHTML = `<option value="0">担当のリストすべて</option>` + S.lists.map((l) => `<option value="${l.id}" ${l.id === S.listId ? "selected" : ""}>${esc(l.name)}（今かける ${l.now}）</option>`).join("");
  }
  async function loadStats() {
    try { const j = await api("/api/mccall/stats"); const m = j.me;
      $("mccStats").innerHTML = `<span><b>${m.calls}</b>コール</span><span><b>${m.person}</b>担当者と話せた</span><span class="apo"><b>${m.apo}</b>アポ</span><span class="fill" title="今日 SF のリードの項目を埋めた・直した数（アポ以外の貢献）"><b>${m.fills || 0}</b>SF 項目</span>${hourBandChip(j.slot)}`; S.allStats = j.all;
      S.sf = j.sf || null; drawNotices();
    } catch { $("mccStats").innerHTML = `<span>今日の数字を読めませんでした</span>`; }
  }
  // いまの時間帯が、つながりやすいか（MOCHICA の記録＋資料の目安から。数字タブで中身を見られる）
  function hourBandChip(sl) {
    if (!sl) return "";
    if (sl.tier !== "off" && (typeof sl.lift !== "number" || typeof sl.rate !== "number")) return "";
    if (sl.tier === "off") return `<span class="mcc-slot off" title="掛ける時間帯は 9〜18時です">いまは時間外</span>`;
    const t = { good: "いまは つながりやすい時間帯", normal: "いまは ふつうの時間帯", low: "いまは つながりにくい時間帯" }[sl.tier];
    return `<span class="mcc-slot ${sl.tier}" title="${sl.hour}時台の担当者と話せる割合 ${Math.round(sl.rate * 100)}%（平均の${sl.lift.toFixed(2)}倍）。詳しくは「数字」のタブ">${t}</span>`;
  }
  async function loadQueue(openFirst) {
    try {
      const j = await api(`/api/mccall/queue${S.listId ? `?list=${S.listId}` : ""}`); S.queue = j.items || []; S.later = j.later || 0; S.noTalk = j.noTalk || []; S.researching = j.researching || 0;
      if (openFirst || !S.d) { const f = S.queue.find((x) => !S.d || x.id !== S.d.lead.id); if (f) await open(f.id); else empty(); }
    } catch (e) { setNotice([{ kind: "danger", text: `かける順番を読めませんでした：${e.message}` }]); }
  }
  function empty() {
    S.d = null; S.f = null;
    const noList = !S.lists.length;
    $("mccLeft").innerHTML = ""; $("mccRight").innerHTML = "";
    $("mccCenter").innerHTML = `<div class="mcc-empty">${noList
      ? (S.admin ? `まだ架電リストがありません。<br><button class="mcc-btn primary" id="mccGoLists" style="margin-top:12px">リストを作る</button>` : "まだ担当の架電リストがありません。<br>管理者がリストを作ってあなたを入れると、ここに出ます。")
      : S.noTalk && S.noTalk.length && !S.researching && !S.later ? `トーク（売り方）が決まっていないリストはかけられません：${esc(S.noTalk.join("・"))}<br>${S.admin ? "「リストの管理」の「トーク」で書いてください。" : "管理者にトークを書いてもらってください。"}`
      : S.researching ? `企業調査が終わった会社から順に出ます（いま ${S.researching}件 を調べています）。<br>少しすると自動で次の会社が出ます。`
      : `今かける企業はありません。${S.later ? `<br>今日このあと掛け直す企業が <b>${S.later}件</b> あります（時刻が来たら先頭に並びます）。` : ""}<br><button class="mcc-btn" id="mccReload" style="margin-top:12px">もう一度読む</button>`}</div>`;
    const g = $("mccGoLists"); if (g) g.addEventListener("click", () => setTab("lists"));
    clearTimeout(S.waitT); if (S.researching) S.waitT = setTimeout(() => { if (!S.d && S.tab === "call") loadQueue(true); }, 8000);
    const r = $("mccReload"); if (r) r.addEventListener("click", () => loadQueue(true));
    setNotice([]);
  }

  // ---- 1社を開く（先読みしてあればすぐ出し、裏で最新を読み直す） ----
  async function open(id) {
    const cached = S.cache.get(id);
    S.f = blankForm(); S.fill = null;
    if (cached) { S.d = cached; drawAll(); }
    else { $("mccCenter").innerHTML = `<div class="mcc-empty">読み込んでいます…</div>`; }
    try {
      const d = await api(`/api/mccall/leads/${id}?lock=1${S.inbound && S.inbound.leadId === id ? `&inbound=${S.inbound.id}` : ""}`); S.cache.delete(id);
      if (S.d && S.d.lead.id === id && cached) { S.d = d; drawLeft(); drawRight(); drawNotices(); } else { S.d = d; drawAll(); }
      S.f.phone = (d.phones[0] && d.phones[0].number) || d.lead.phone || "";
      queueFill(0);
    } catch (e) { setNotice([{ kind: "danger", text: e.message }]); S.queue = S.queue.filter((x) => x.id !== id); }
    prefetch();
  }
  // 次の企業の中身を、今の通話中に読んでおく（ASUMO 案2：次の企業の準備を今の通話中に）
  async function prefetch() {
    //   中身は読んでおくが、画面には出さない（かけ終わるまで次は見せない＝2026-11-20 福井さん）
    const n = nextItem(); if (!n || S.cache.has(n.id)) return;
    try { S.cache.set(n.id, await api(`/api/mccall/leads/${n.id}`)); } catch {}
  }
  const nextItem = () => S.queue.find((x) => !S.d || x.id !== S.d.lead.id) || null;
  // 新しい企業を開いたら3列とも上から見せる（前の企業でスクロールした位置のままだと「前回」が隠れる）
  function drawAll() { drawLeft(); drawCenter(); drawRight(); drawNotices(); ["mccLeft", "mccCenter", "mccRight"].forEach((id) => { const e = $(id); if (e) e.scrollTop = 0; }); }

  // ---- 折り返しの着信（2026-11-20 福井さん「折り返しの時は自動でその企業の架電画面が表示される」） ----
  //   Zoom Phone で着信が鳴ると、サーバーがかけてきた番号から会社を探して残す。ここで数秒おきに見て、その会社を開く。
  //   開いていた会社は順番の先頭に戻す（着信の対応が終わったら、続きからかけられるように）
  const isInbound = (leadId) => !!(S.inbound && S.inbound.leadId === leadId);
  async function pollInbound() {
    const pane = document.querySelector('[data-pane="call"]');
    if (S.inPoll || !S.meta || (pane && pane.hidden) || document.hidden) return; S.inPoll = true;
    try {
      const it = (await api("/api/mccall/inbound")).item;
      if (!it || S.inSeen === it.id) return;
      S.inSeen = it.id; post(`/api/mccall/inbound/${it.id}/seen`).catch(() => {});
      if (S.tab !== "call") setTab("call");
      if (!it.lead_id) { setNotice([{ kind: "info", text: `着信：${it.number}（MOCHICA のリードには見つかりませんでした）` }]); return; }
      S.inbound = { id: it.id, leadId: it.lead_id, number: it.number };
      if (S.d && S.d.lead.id === it.lead_id) { drawCenter(); drawNotices(); return; }
      const cur = S.d;
      if (cur) { release(); S.queue = S.queue.filter((x) => x.id !== cur.lead.id); S.queue.unshift({ id: cur.lead.id, company: cur.lead.company }); }
      await open(it.lead_id);
    } catch {} finally { S.inPoll = false; }
  }

  // 自動音声の案内（前の架電の録音から読んだもの）。番号ごとに覚えているので、いまかける番号のものを出す
  const telKey = (v) => { let x = String(v || "").normalize("NFKC").replace(/[^0-9]/g, ""); if (/^81\d{9,10}$/.test(x)) x = "0" + x.slice(2); return x; };
  function ivrHtml(L, ph) {
    const v = L.ivr && L.ivr[telKey(ph)]; if (!v || !v.items || !v.items.length) return "";
    return `<div class="mcc-ivr" aria-label="自動音声の案内"><b>自動音声</b>${v.items.map((x) => `<span><kbd>${esc(x.press)}</kbd>${esc(x.for)}</span>`).join("")}<small>前の録音から（${esc(day(v.at))}）</small></div>`;
  }

  // 企業調査（2026-11-20 福井さん「調べなくても情報がまとまっている状態をすべてのリードで」）。ASUMO の企業調査と同じ項目
  function researchHtml(L) {
    const r = L.research;
    if (!r) return `<div class="mcc-research"><h3>企業調査</h3><p class="mcc-note">調べています…（少しすると出ます）</p></div>`;
    if (r.status === "error") return `<div class="mcc-research"><h3>企業調査</h3><p class="mcc-note">調べられませんでした（${esc(r.error || "理由不明")}）。下の情報を見てかけてください。</p></div>`;
    const rows = [["事業", r.biz], ["採用の実態", r.hiring], ["募集職種", r.roles], ["採用人数", r.headcount], ["求人媒体", r.media], ["推定採用課題", r.issue], ["従業員", r.employees], ["所在地", r.location], ["設立", r.founded], ["電話で確かめる", r.confirm]].filter(([, v]) => v);
    return `<div class="mcc-research"><h3>企業調査</h3>
      ${r.hook ? `<div class="mcc-hook"><small>話の切り口</small>${esc(r.hook)}</div>` : ""}
      ${rows.length ? `<dl class="mcc-kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : '<p class="mcc-note">Web で分かることはほとんどありませんでした。</p>'}
      <p class="mcc-note">AI が Web から調べた参考情報です（${esc(day(r.at))}）。${(r.sources || []).slice(0, 3).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">出典${i + 1}</a>`).join(" ")}</p></div>`;
  }

  // ひと目で：採用ニーズ・検討時期・前回までの架電（2026-11-18 福井さん「架電時に調べなくても一目でわかるように」）
  //   ニーズと時期は SF の項目＋過去の記録の文から見つけた1文（出どころと日付つき）。無ければ「まだ聞けていない」と聞くことを促す
  function glanceHtml(d) {
    const g = d.glance || {};
    const row = (lbl, x, ask) => { x = x || {}; const h = x.hit; const st = (x.kb && x.kb.length) || (x.sf && x.sf.length) || (h && h.st === "あり") ? "ok" : h && h.st === "なし" ? "no" : "yet";
      const body = [x.kb && x.kb.length ? `<div><small>架電で聞いた${x.by ? ` ${esc(day(x.by.at))} ${esc(x.by.who)}` : ""}</small>${x.kb.map(([k, v]) => k === "採用ニーズ" || k === "検討時期" ? esc(v) : `${esc(k.replace("説明会・面接の参加人数", "説明会・面接の参加"))} ${esc(v)}`).join("／")}</div>` : "", ...(x.sf || []).map(([k, v]) => `<div><small>SF ${esc(k)}</small>${esc(v)}</div>`),
        h ? `<div><small>${esc(h.src)}${h.at ? ` ${esc(day(h.at))}` : ""}${h.who ? ` ${esc(h.who)}` : ""}${h.st === "なし" ? "（無いと言われた）" : ""}</small>「${esc(h.why)}」</div>` : ""].join("");
      return `<div class="mcc-gl-row ${st}"><b>${lbl}</b><div>${body || `<span class="mcc-gl-yet">まだ聞けていません。${ask}</span>`}</div></div>`; };
    // 内容の分かる架電（kinbot・DOC・BALES・SF の架電）を3件。Zoom の通話は回数だけを1行で（内容が無く、3件の枠を埋めてしまうため）
    const calls = (d.timeline || []).filter((t) => (t.src === "kinbot" && t.title !== "資料送付" && t.title !== "問い合わせフォーム") || t.src === "DOC" || t.src === "Bales" || (t.src === "SF" && /^架電/.test(t.title))).slice(0, 3);
    const zs = d.hist && d.hist.zoom && d.hist.zoom.sum;
    const zline = zs ? `<div><small>Zoom Phone</small><span class="r">通話 ${zs.n}回（30秒以上 ${zs.talked}回）</span><span class="m">最後 ${esc(tm(zs.lastAt))} ${esc(zs.lastWho || "")}</span></div>` : "";
    return `<div class="mcc-glance"><h3>ひと目で</h3>
      ${row("採用ニーズ", g.need, "採用で困っていること・人数を聞く")}${row("検討時期", g.when, "いつ頃から考えるか・更新月を聞く")}
      ${mynaviHtml(d.mynavi)}
      <div class="mcc-gl-row calls"><b>前回までの架電</b><div>${zline}${calls.length ? calls.map((t) => `<div><small>${esc(t.src === "SF" ? day(t.at) : tm(t.at))} ${esc(t.src === "DOC" ? "DOC " : "")}${esc(t.who || "")}</small><span class="r">${esc(t.title)}</span>${t.text ? `<span class="m">${esc(t.text)}</span>` : ""}</div>`).join("") : zline ? "" : '<span class="mcc-gl-yet">まだかけていません</span>'}${histNote(d)}</div></div></div>`;
  }
  // どの元データが読めなかったか（読めなかったのに「記録なし」に見せないため）
  function histNote(d) {
    const h = d.hist || {}; const NAME = { sf: "SF", zoom: "Zoom Phone", bales: "BALES", doc: "DOC", kinbot: "MOCHICA の別リスト" };
    const ng = Object.entries(h).filter(([, v]) => v && (!v.ok || v.err)).map(([k, v]) => `${NAME[k] || k}：${v.err || "読めませんでした"}`);
    return ng.length ? `<div class="mcc-gl-warn">${ng.map(esc).join("<br>")}</div>` : "";
  }
  // マイナビ（新卒）の掲載（2026-11-18 福井さん）。取込時に Web 検索で調べた結果。
  //   「見つからない」は掲載なしと言い切らない（検索で漏れることがある）。調べられなかったときは理由を出す（黙らない）
  function mynaviHtml(m) {
    if (!m) return "";
    const head = (cls, t) => `<div class="mcc-gl-row ${cls}"><b>マイナビ</b><div>${t}</div></div>`;
    if (m.status === "checking") return head("yet", '<span class="mcc-gl-yet">調べています（少しあとで開き直すと出ます）</span>');
    if (m.status === "error") return head("no", `<span class="mcc-gl-yet">調べられませんでした：${esc(m.error || "")}</span>`);
    if (m.status !== "listed") return head("yet", `<span class="mcc-gl-yet">マイナビ（新卒）の掲載は見つかりませんでした${m.note ? `（${esc(m.note)}）` : ""}。掲載していないとは限らないので、話せたら聞いてください</span>`);
    const kv = [["掲載年度", (m.years || []).map((y) => `${y}卒`).join("・")], ["採用予定人数", m.plannedHires], ["職種", (m.jobs || []).join("・")], ["勤務地", m.area], ["プレエントリー", m.preEntry], ["業種", m.industry], ["ひとこと", m.note]].filter(([, v]) => v);
    return head("ok", `<div><small>掲載あり${m.checkedAt ? `（${esc(day(m.checkedAt))} に確認）` : ""}${m.url ? ` <a href="${esc(m.url)}" target="_blank" rel="noopener">ページを開く</a>` : ""}</small>${kv.map(([k, v]) => `<span class="mcc-mn"><em>${esc(k)}</em>${esc(v)}</span>`).join("")}</div>`);
  }
  function hotBadge(h) { const n = Number(h || 0); return n >= 3 ? '<span class="mcc-badge hot">ホット</span>' : n === 2 ? '<span class="mcc-badge warm">ウォーム</span>' : '<span class="mcc-badge cold">コールド</span>'; }
  function drawLeft() {
    const d = S.d; if (!d) return; const L = d.lead; const g = L.gate || {};
    const sf = d.sf && d.sf.lead ? d.sf.lead : null; const sum = d.sf && d.sf.sum;
    const sfRows = sf ? Object.entries(sf).filter(([k, v]) => v && !["id", "name", "company", "created", "converted"].includes(k) && /status|owner|失注|課題|検討|更新|利用|現状/i.test(k)).slice(0, 8) : [];
    const kv = (o) => o.length ? `<dl class="mcc-kv">${o.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : "";
    const nk = { status: "リードの状態", owner: "SF の所有者" };
    const data = L.data || {};
    const bales = [["最終活動", data.lastActivityAt ? tm(data.lastActivityAt) : ""], ["活動の種類", data.lastActivityTypeText], ["所有者", data.operatorName], ["DOC のリスト", data.list_name], ["DOC の担当", data.assigned_to], ["業種", data.industry]].filter(([, v]) => v);
    $("mccLeft").innerHTML = `
      <p class="mcc-co">${esc(L.company || "会社名なし")} <button class="mcc-btn mcc-edit" id="mccEdit" title="会社・担当者・電話・メールを直す">${ICO.edit}直す</button></p>
      <div class="mcc-person">${esc(g.name || L.person || "担当者名はまだ分かりません")}${g.name && L.person && g.name !== L.person ? `<small style="color:var(--c-muted);font-weight:600">（リストでは ${esc(L.person)}）</small>` : ""}</div>
      <div class="mcc-badges">${hotBadge(L.hot)}${L.cross_from ? `<span class="mcc-badge doc">${esc(L.cross_from)} から（部署をまたぐ）</span>` : ""}${d.ban ? '<span class="mcc-badge danger">アプローチ禁止</span>' : ""}${sum && sum.n ? `<span class="mcc-badge sf">SF の商談 ${sum.n}件${sum.won ? "・受注あり" : sum.lost ? "・失注あり" : ""}</span>` : ""}<span class="mcc-badge">${L.attempts}回目</span></div>
      ${researchHtml(L)}
      ${contactsHtml(L.info)}
      ${glanceHtml(d)}
      <h3>電話番号（押すと発信）</h3>
      ${d.phones.length ? d.phones.map((p, i) => `<a class="mcc-phone ${p.invalid ? "bad" : ""} ${digits(p.number) === digits(S.f && S.f.phone) ? "cur" : ""}" href="${callHref(p.number)}" data-ph="${esc(p.number)}">
        ${i === 0 ? '<span class="mcc-key" aria-hidden="true">C</span>' : ""}<span class="n"><b>${esc(p.number)}</b><small>${esc(p.label)}${p.lastAt ? `・前回 ${esc(p.last)} ${esc(p.lastAt)}` : ""}</small></span>
        <span class="rate">${p.invalid ? "使えない番号" : p.n ? `${p.n}回中 ${p.reached}回つながった` : "まだかけていない"}</span></a>`).join("") : '<p class="mcc-note">電話番号がありません。受付で聞けた直通があれば、中央の欄に入れてください。</p>'}
      <h3>受付で聞けたこと</h3>
      <div class="mcc-gate">${g.name || g.hours || g.direct ? `${g.name ? `担当者：<b>${esc(g.name)}</b><br>` : ""}${g.hours ? `いる時間：<b>${esc(g.hours)}</b><br>` : ""}${g.direct ? `直通・内線：<b>${esc(g.direct)}</b>` : ""}` : '<span style="color:var(--c-muted)">まだありません。受付につながったら、中央で2タップで残せます。</span>'}</div>
      ${sfRows.length ? `<h3>SF のリード</h3>${kv(sfRows.map(([k, v]) => [nk[k] || k, v]))}` : ""}
      ${L.src === "csv" ? (Object.keys(data).length ? `<h3>CSV の列</h3>${kv(Object.entries(data).slice(0, 30))}` : "") : bales.length ? `<h3>${L.src === "doc" ? "DOC のリスト" : "Bales"}</h3>${kv(bales)}` : ""}`;
    $("mccLeft").querySelectorAll("[data-ph]").forEach((a) => a.addEventListener("click", () => { S.f.phone = a.dataset.ph; S.f.dialed = true; setTimeout(() => { drawLeft(); drawCenter(); }, 0); }));
    $("mccEdit").addEventListener("click", editDialog);
  }
  // MOCHICALL で足した担当者とメール（2026-11-18 福井さん「会社・担当者情報の編集と複数番号」）
  function contactsHtml(info) {
    const I = info || {}; const cs = I.contacts || [];
    if (!cs.length && !I.email && !I.web && !I.corp) return "";
    return `<div class="mcc-contacts">${I.email ? `<div><small>メール</small>${esc(I.email)}</div>` : ""}${I.web ? `<div><small>Web</small><a href="${esc(/^https?:/i.test(I.web) ? I.web : `https://${I.web}`)}" target="_blank" rel="noopener">${esc(I.web)}</a></div>` : ""}${I.corp ? `<div><small>法人番号</small>${esc(I.corp)}</div>` : ""}${cs.map((c) => `<div><b>${esc(c.name || "名前なし")}</b>${c.role ? `<small>${esc(c.role)}</small>` : ""}${c.email ? `<span>${esc(c.email)}</span>` : ""}</div>`).join("")}</div>`;
  }
  // 会社・担当者の情報を直す。番号と担当者は行を足して増やせる（BALES と同じく1社に何人・何本でも持てるように）
  function editDialog() {
    if (!S.d) return; const L = S.d.lead; const I = L.info || {};
    const phRow = (p = {}) => `<div class="mcc-erow" data-row="ph"><input placeholder="名前（例：人事部直通）" value="${esc(p.label || "")}" data-k="label" /><input placeholder="電話番号" inputmode="tel" value="${esc(p.number || "")}" data-k="number" /><button class="mcc-btn" data-del title="この行を消す">消す</button></div>`;
    const ctRow = (c = {}) => `<div class="mcc-erow four" data-row="ct"><input placeholder="名前" value="${esc(c.name || "")}" data-k="name" /><input placeholder="部署・役職" value="${esc(c.role || "")}" data-k="role" /><input placeholder="電話" inputmode="tel" value="${esc(c.phone || "")}" data-k="phone" /><input placeholder="メール" type="email" value="${esc(c.email || "")}" data-k="email" /><button class="mcc-btn" data-del title="この行を消す">消す</button></div>`;
    const w = dialog(`情報を直す：${L.company || ""}`, "kinbot の架電リストの情報を直します（Bales・SF の元のデータは変わりません）。直した番号はすぐ左の「電話番号」に出ます。", "保存する", async (w) => {
      const v = (id) => w.querySelector(id).value.trim();
      const rows = (k) => [...w.querySelectorAll(`[data-row="${k}"]`)].map((r) => Object.fromEntries([...r.querySelectorAll("[data-k]")].map((i) => [i.dataset.k, i.value.trim()])));
      await api(`/api/mccall/leads/${L.id}`, { method: "PATCH", body: JSON.stringify({ company: v("#mccECo"), person: v("#mccEPe"), phone: v("#mccEPh"), email: v("#mccEMa"), web: v("#mccEWeb"), corp: v("#mccECorp"), phones: rows("ph"), contacts: rows("ct") }) });
      S.cache.delete(L.id); const d = await api(`/api/mccall/leads/${L.id}`);
      if (S.d && S.d.lead.id === L.id) { S.d = d; drawLeft(); drawNotices(); }
      toast("情報を直しました");
    }, `<div style="display:grid;gap:8px;margin-top:12px">
      <label class="mcc-field">会社名<input id="mccECo" value="${esc(L.company || "")}" /></label>
      <label class="mcc-field">担当者名（リスト上の）<input id="mccEPe" value="${esc(L.person || "")}" /></label>
      <label class="mcc-field">代表電話<input id="mccEPh" inputmode="tel" value="${esc(L.phone || "")}" /></label>
      <label class="mcc-field">メール（資料を送るときの宛先に入ります）<input id="mccEMa" type="email" value="${esc(I.email || "")}" /></label>
      <label class="mcc-field">Web ページ<input id="mccEWeb" type="url" placeholder="https://" value="${esc(I.web || "")}" /></label>
      <label class="mcc-field">法人番号（13桁）<input id="mccECorp" inputmode="numeric" value="${esc(I.corp || "")}" /></label>
      <p class="mcc-note">会社名が同じで、電話番号・メール・Web ページ・法人番号のどれかがほかのリードと同じだと、重複になるので保存できません。</p>
      <div class="mcc-field">ほかの電話番号<div id="mccEPhs">${(I.phones || []).map(phRow).join("")}</div><button class="mcc-btn" id="mccEPhAdd" style="justify-self:start">番号を足す</button></div>
      <div class="mcc-field">ほかの担当者<div id="mccECts">${(I.contacts || []).map(ctRow).join("")}</div><button class="mcc-btn" id="mccECtAdd" style="justify-self:start">担当者を足す</button></div></div>`);
    const bindDel = () => w.querySelectorAll("[data-del]").forEach((b) => { b.onclick = () => b.closest(".mcc-erow").remove(); });
    w.querySelector("#mccEPhAdd").addEventListener("click", () => { w.querySelector("#mccEPhs").insertAdjacentHTML("beforeend", phRow()); bindDel(); });
    w.querySelector("#mccECtAdd").addEventListener("click", () => { w.querySelector("#mccECts").insertAdjacentHTML("beforeend", ctRow()); bindDel(); });
    bindDel();
  }

  // 中央：発信 → 到達の段階 → 中身。選ぶたびに同じ場所で入れ替わる（一度に聞くのは1つ）
  function choicesFor() {
    const f = S.f, R = S.meta.reach;
    // 1段目は「つながらない・現アナ・不在」を直に並べる。つながらない・現アナは押した瞬間に記録して次へ（メモは書かない。2026-11-20 福井さん）。不在は時間を選ぶ段へ（2026-11-23）
    if (f.step === "reach") return [
      ...["no_answer", "busy", "voicemail", "invalid"].map((o) => ({ k: `none:${o}`, label: R.none.outcomes[o], sub: "押すと記録して次へ", cls: o === "invalid" ? "bad" : "" })),
      { k: "gate:absent", label: R.gate.outcomes.absent, sub: "掛け直す時間を選ぶ（自動も可）" },
      { k: "gate:blocked", label: R.gate.outcomes.blocked, cls: "bad" }, { k: "gate:callback_req", label: R.gate.outcomes.callback_req, sub: "時刻を選ぶ" },
      { k: "gate:inquiry", label: R.gate.outcomes.inquiry, sub: "HP のフォームから送る" },
      { k: "person", label: R.person.label, sub: "アポ・資料・フォロー・断られた", cls: "good" }];
    if (f.step === "outcome") return Object.entries(R[f.reach].outcomes).map(([k, l]) => ({ k, label: l, cls: k === "apo" ? "good" : k === "reject" || k === "invalid" ? "bad" : "" }));
    if (f.step === "reason") return S.meta.rejectReasons.map((r) => ({ k: r, label: r }));
    // 不在のときは、いちばん上に「自動で掛け直し」を置く（これまでどおり1を押すだけで記録して次へ進めるように）
    if (f.step === "when") return [...(f.outcome === "absent" ? [{ k: "auto", label: "自動で掛け直し", sub: "押すと記録して次へ" }] : []), ...whenChoices()];
    return [];
  }
  function whenChoices() {
    const now = new Date(); const at = (h, m, addDays = 0) => { const x = new Date(now); x.setDate(x.getDate() + addDays); x.setHours(h, m, 0, 0); return x; };
    const add = (min) => new Date(now.getTime() + min * 60e3);
    return [["30分後", add(30)], ["1時間後", add(60)], ["2時間後", add(120)], ["明日の午前", at(10, 0, 1)], ["明日の午後", at(14, 0, 1)]].map(([l, d]) => ({ k: d.toISOString(), label: l, sub: tm(d) }));
  }
  function laterChips() {
    const now = new Date(); const at = (h, m, addDays) => { const x = new Date(now); x.setDate(x.getDate() + addDays); x.setHours(h, m, 0, 0); return x; };
    return [["明日の午前", at(10, 0, 1)], ["明日の午後", at(14, 0, 1)], ["来週", at(10, 0, 7)], ["1か月後", at(10, 0, 30)]];
  }
  const AUTO = new Set(["no_answer", "busy", "voicemail", "absent"]);
  // 押した瞬間に記録して次の会社へ進む結果（福井さんが選んだもの：応答なし・話し中・留守電・現アナ）
  //   担当者が不在は 2026-11-23 福井さん「再架電の時間を手動で指定できるように」で外し、時間を選ぶ段をはさむ（自動の掛け直しは1を押すだけ）
  const INSTANT = new Set(["no_answer", "busy", "voicemail", "invalid"]);
  function ready() {
    const f = S.f; if (!f.outcome) return false;
    if (f.outcome === "reject" && !f.reason) return false;
    if (f.outcome === "apo" && !f.apoAt) return false;
    if (f.outcome === "callback_req" && !f.nextAt) return false;
    return true;
  }
  function crumb() {
    const f = S.f, R = S.meta.reach; const p = [];
    if (f.reach) p.push(R[f.reach].label); if (f.outcome) p.push(R[f.reach].outcomes[f.outcome]); if (f.reason) p.push(f.reason);
    return p.join(" › ");
  }
  function nextText() {
    const f = S.f;
    if (f.nextAt) return `次は <b>${esc(tm(f.nextAt))}</b> に掛け直し（${esc(f.nextLabel || "選んだ時刻")}）`;
    if (AUTO.has(f.outcome) && !f.noRetry) {
      const c = S.d.cadence;
      if (c && c.next && c.next.parked) return `これで${c.streak + 1}回続けて届きません。<b>いったん休ませて ${esc(day(c.next.at))} ごろに再開</b>します`;
      if (f.gate.hours || (S.d.lead.gate && S.d.lead.gate.hours) || !c || !c.next) return `次は <b>自動で掛け直し</b>（受付で聞いたいる時間に）`;
      return `次は <b>${esc(tm(c.next.at))}</b> に自動で掛け直し（${c.streak + 1}/${c.max}回目。前回と違う時間帯・1〜2日あけます）`;
    }
    if (["invalid", "apo", "reject"].includes(f.outcome)) return "この会社は、このリストではこれで終わりです";
    return "次の掛け直しはありません";
  }
  // この1本で確定させること（MOCHICA 科学化：1本の勝ち負けは「アポが取れたか」ではなく「何を確定できたか」で見る。不在でも担当者名・いる時間が取れれば前進）
  //   ひと目での空欄から作る。聞くことを増やしすぎないよう3つまで。届いていない回数が増えたら、電話以外の接点（資料送付）も勧める
  function planHtml(d) {
    const L = d.lead, g = d.glance || {}, gate = L.gate || {}, c = d.cadence || {};
    const has = (x) => x && ((x.kb && x.kb.length) || (x.sf && x.sf.length) || (x.hit && x.hit.st === "あり"));
    const goals = [];
    if (!(gate.name || L.person)) goals.push("担当者の名前");
    if (!has(g.when)) goals.push("検討時期");
    if (!has(g.need)) goals.push("採用で困っていること");
    if (!gate.hours) goals.push("担当者のいる時間");
    const lines = [];
    if (goals.length) lines.push(`<b>この1本で確定させること</b>：${goals.slice(0, 3).map(esc).join("・")}<small>（つながらなくても、受付で聞けたら前進です）</small>`);
    if (c.streak) lines.push(`担当者に届いていない回数：<b>${c.streak}回続き</b>（上限${c.max}回）${c.streak >= 3 ? "。電話だけでなく、資料送付（メール）で先に接点を作ると、つながりやすくなります" : ""}`);
    if (c.parked) lines.push("一度休ませてから再開した会社です。前回までと時期が変わっている可能性があります");
    return lines.length ? `<div class="mcc-plan">${lines.map((x) => `<div>${x}</div>`).join("")}</div>` : "";
  }
  function drawCenter() {
    const d = S.d; if (!d) return; const f = S.f; const L = d.lead;
    const cs = choicesFor(); const showGate = f.reach === "gate" || f.outcome === "absent";
    const ph = f.phone || (d.phones[0] && d.phones[0].number) || "";
    // 発信してからでないと結果を選べない（かけずに記録して次へ進めないように）。折り返しの着信のときは発信しなくてよい
    const canPick = f.dialed || isInbound(L.id);
    $("mccCenter").innerHTML = `
      <div class="mcc-sum"><small>前回</small>${d.summary ? esc(d.summary) : "この会社に kinbot から架電した記録はまだありません"}</div>
      ${planHtml(d)}
      <div class="mcc-callrow">
        ${ph ? `<a class="mcc-btn primary big" href="${callHref(ph)}" id="mccDial" aria-keyshortcuts="C">${ICO.phone}${esc(ph)} にかける<span class="mcc-key" style="background:rgba(255,255,255,.18);color:#fff;border-color:transparent">C</span></a>` : `<span class="mcc-note">電話番号がありません</span>`}
        <button class="mcc-btn" id="mccSkip" aria-keyshortcuts="S">${ICO.skip}飛ばす<span class="mcc-key">S</span></button>
        <button class="mcc-btn" id="mccDoc">${ICO.mail}資料を送る</button>
      </div>
      ${ivrHtml(L, ph)}
      ${!canPick ? `<div class="mcc-empty" style="padding:24px 12px">まず発信してください（<b>C</b> か「にかける」を押す）。<br>発信すると結果を選べます。かけない会社は「飛ばす」（<b>S</b>）。</div>` : `<div class="mcc-step">${f.step === "reach" ? "どこまで届きましたか" : `<button class="mcc-btn" id="mccBack" style="height:28px;padding:0 8px" aria-keyshortcuts="Backspace">${ICO.back}戻る</button><span class="crumb">${esc(crumb())}</span>`}</div>
      ${cs.length ? `<div class="mcc-choices ${cs.length > 4 ? "two" : ""}">${cs.map((c, i) => `<button class="mcc-choice ${c.cls || ""}" data-c="${esc(c.k)}" data-l="${esc(c.label)}" aria-keyshortcuts="${i + 1}"><span class="mcc-key">${i + 1}</span><span>${esc(c.label)}${c.sub ? `<small>${esc(c.sub)}</small>` : ""}</span></button>`).join("")}</div>` : ""}`}
      ${f.step === "when" ? whenManualHtml(f) : ""}
      ${f.step === "apo" ? slotsHtml() + `<label class="mcc-field" style="margin-top:8px">アポの日時（必須。おすすめを押すと入ります）<input type="datetime-local" id="mccApo" value="${esc(f.apoAt)}" /></label>${f.apoWho ? `<p class="mcc-note">この時間に空いているクローザー：${esc(f.apoWho)}</p>` : ""}` : ""}
      ${f.outcome === "doc_send" ? `<div class="mcc-next">資料はまだ送っていません。<button class="mcc-chip" id="mccDocNow">資料を送る</button></div>` : ""}
      ${f.outcome === "inquiry" ? `<div class="mcc-next">${f.formSent ? `問い合わせフォームから<b>${esc(f.formSent)}</b>。記録して次へ進んでください。` : "問い合わせフォームからは、まだ送っていません。"}<button class="mcc-chip" id="mccFormNow">${f.formSent ? "もう一度開く" : "フォームから送る"}</button></div>` : ""}
      ${f.step === "ready" || f.step === "apo" ? `<div class="mcc-next" id="mccNextTx">${nextText()}${AUTO.has(f.outcome) && !f.noRetry && !f.nextAt ? ` <button class="mcc-chip" id="mccNoRetry">自動の掛け直しをやめる</button>` : ""}</div>
        ${f.outcome !== "callback_req" ? `<div class="mcc-chips">${laterChips().map(([l, dd]) => `<button class="mcc-chip" data-later="${dd.toISOString()}" data-ll="${esc(l)}" aria-pressed="${f.nextAt === dd.toISOString()}">${esc(l)}</button>`).join("")}${f.nextAt ? `<button class="mcc-chip" data-later="">時刻を外す</button>` : ""}</div>` : ""}` : ""}
      ${showGate ? `<div class="mcc-gateform" aria-label="受付で聞けたこと">
        <label class="mcc-field">担当者の名前<input id="mccGName" value="${esc(f.gate.name || (L.gate && L.gate.name) || "")}" autocomplete="off" /></label>
        <label class="mcc-field">直通・内線<input id="mccGDirect" value="${esc(f.gate.direct || (L.gate && L.gate.direct) || "")}" autocomplete="off" inputmode="tel" /></label>
        <div class="mcc-field full">いる時間<div class="mcc-chips">${["午前", "昼", "午後", "夕方"].map((h) => `<button class="mcc-chip" data-hr="${h}" aria-pressed="${(f.gate.hours || (L.gate && L.gate.hours)) === h}">${h}</button>`).join("")}</div></div></div>` : ""}
      ${f.reach === "person" ? hearingHtml(f, L) : ""}
      ${f.step === "reach" ? "" : `<label class="mcc-field" style="margin-top:12px">メモ（任意。Ctrl+Enter で記録）<textarea id="mccMemo" placeholder="話したこと・次に聞くこと（例：HRMOS 利用・3月更新・人事部長の山田様 yamada@〜）">${esc(f.memo)}</textarea></label>`}
      ${f.step === "reach" ? "" : `<div id="mccFill"></div>`}
      <div class="mcc-foot" ${f.step === "reach" ? "hidden" : ""}><button class="mcc-btn primary big" id="mccRec" ${ready() ? "" : "disabled"} aria-keyshortcuts="Enter">記録して次へ<span class="mcc-key" style="background:rgba(255,255,255,.18);color:#fff;border-color:transparent">Enter</span></button>
        <span class="hint" id="mccHint">${footHint()}</span></div>`;
    const c = $("mccCenter");
    c.querySelectorAll("[data-c]").forEach((b) => b.addEventListener("click", () => choose(b.dataset.c, b.dataset.l)));
    const bk = $("mccBack"); if (bk) bk.addEventListener("click", back);
    $("mccSkip").addEventListener("click", skip);
    $("mccDoc").addEventListener("click", sendDoc);
    const dn = $("mccDocNow"); if (dn) dn.addEventListener("click", sendDoc);
    const fn = $("mccFormNow"); if (fn) fn.addEventListener("click", sendForm);
    c.querySelectorAll("[data-slot]").forEach((b) => b.addEventListener("click", () => { S.f.apoAt = toLocalInput(b.dataset.slot); S.f.apoWho = b.dataset.who || ""; drawCenter(); }));
    c.querySelectorAll("[data-stab]").forEach((b) => b.addEventListener("click", () => { S.f.slotTab = b.dataset.stab; drawCenter(); }));
    c.querySelectorAll("[data-calmv]").forEach((b) => b.addEventListener("click", () => { S.calM += Number(b.dataset.calmv); if (S.calM < 1) { S.calM = 12; S.calY--; } else if (S.calM > 12) { S.calM = 1; S.calY++; } drawCenter(); }));
    c.querySelectorAll("[data-calday]").forEach((b) => b.addEventListener("click", () => { S.f.slotDay = b.dataset.calday; loadSlotDay(S.f.slotDay); }));
    if (S.f.step === "apo" && !S.slots) loadSlots();
    $("mccRec").addEventListener("click", record);
    const dial = $("mccDial"); if (dial) dial.addEventListener("click", () => { S.f.phone = ph; if (!S.f.dialed) { S.f.dialed = true; setTimeout(drawCenter, 0); } });
    const apo = $("mccApo"); if (apo) { apo.addEventListener("input", () => { S.f.apoAt = apo.value; S.f.apoWho = ""; refreshFoot(); }); apo.addEventListener("keydown", (e) => { if (e.key === "Enter" && ready()) { e.preventDefault(); record(); } }); setTimeout(() => apo.focus(), 0); }
    const na = $("mccNextAt"); if (na) { na.addEventListener("input", () => pickManual(na.value)); na.addEventListener("keydown", (e) => { if (e.key === "Enter" && S.f.nextAt && ready()) { e.preventDefault(); record(); } }); }
    const nr = $("mccNoRetry"); if (nr) nr.addEventListener("click", () => { S.f.noRetry = true; drawCenter(); });
    c.querySelectorAll("[data-later]").forEach((b) => b.addEventListener("click", () => { S.f.nextAt = b.dataset.later; S.f.nextLabel = b.dataset.ll || ""; S.f.noRetry = !b.dataset.later ? S.f.noRetry : false; drawCenter(); }));
    c.querySelectorAll("[data-hr]").forEach((b) => b.addEventListener("click", () => { S.f.gate.hours = S.f.gate.hours === b.dataset.hr ? "" : b.dataset.hr; saveGate(); drawCenter(); }));
    const m = $("mccMemo"); if (m) m.addEventListener("input", () => { S.f.memo = m.value; queueFill(); });
    // ヒアリング：月は押すだけ。文字・人数は欄を離れたら保存（記録を押す前に別の会社へ移っても消えないように）
    c.querySelectorAll("[data-hw]").forEach((b) => b.addEventListener("click", () => { S.f.hearing.when = hv("when") === b.dataset.hw ? "" : b.dataset.hw; saveHearing(); drawCenter(); }));
    [["mccHNeed", "need"], ["mccHContact", "contact"], ["mccHTarget", "target"]].forEach(([id, k]) => { const i = $(id); if (!i) return; i.addEventListener("input", () => { S.f.hearing[k] = i.value; queueFill(); }); i.addEventListener("blur", saveHearing); });
    // 受付で聞けたことは、欄を離れたら自動で保存（「保存」ボタンを押し忘れて消えることがないように）
    [["mccGName", "name"], ["mccGDirect", "direct"]].forEach(([id, k]) => { const i = $(id); if (!i) return; i.addEventListener("input", () => { S.f.gate[k] = i.value; queueFill(); }); i.addEventListener("blur", saveGate); });
    drawFill(); queueFill();
  }
  // SF に入る項目（2026-11-20 福井さん「ASUMO のように架電内容から自動でリード情報を埋める」）：
  //   書いた内容（ヒアリング・受付で聞けたこと・断り理由・メモ）から、SF のリードに入る項目を記録の前に下書きとして見せる。
  //   空の項目を埋めるもの・ヒアリング欄で選んだ値は最初からチェック、メモから読んだ書き換えや担当者・メールの書き換えは人がチェックしたときだけ入る。
  //   入った数は「レポート」でリストへの貢献として数える（アポが取れなくても評価できるように）
  let fillTimer = null;
  function queueFill(ms = 600) { clearTimeout(fillTimer); fillTimer = setTimeout(loadFill, ms); }
  async function loadFill() {
    if (!S.d || !S.f) return; const L = S.d.lead; const f = S.f;
    const gate = { name: f.gate.name || (L.gate && L.gate.name) || "", direct: f.gate.direct || (L.gate && L.gate.direct) || "" };
    const body = { reach: f.reach, outcome: f.outcome, reason: f.reason, memo: f.memo, gate, hearing: f.reach === "person" ? hearingBody() : null };
    const sig = JSON.stringify(body); if (S.fill && S.fill.leadId === L.id && S.fill.sig === sig) return;
    S.fill = { ...(S.fill && S.fill.leadId === L.id ? S.fill : { plan: [], note: "" }), leadId: L.id, sig };
    try { const j = await post(`/api/mccall/leads/${L.id}/sf-fill/preview`, body); if (!S.d || S.d.lead.id !== L.id || S.fill.sig !== sig) return; S.fill = { leadId: L.id, sig, plan: j.plan || [], note: j.note || "" }; }
    catch (e) { if (S.fill && S.fill.sig === sig) S.fill = { leadId: L.id, sig, plan: [], note: `SF に入る項目を出せませんでした：${e.message}` }; }
    drawFill();
  }
  const FILL_KIND = { new: ["新規", "new"], update: ["更新", "upd"], add: ["追記", "add"], same: ["SF と同じ", "same"] };
  const fillOn = (p) => (Object.prototype.hasOwnProperty.call(S.f.picks, p.api) ? S.f.picks[p.api] : p.on);
  function drawFill() {
    const box = $("mccFill"); if (!box || !S.f) return;
    const F = S.fill && S.d && S.fill.leadId === S.d.lead.id ? S.fill : null;
    if (!F || (!F.plan.length && !F.note)) { box.innerHTML = ""; return; }
    const n = F.plan.filter((p) => p.kind !== "same" && fillOn(p)).length;
    box.innerHTML = `<div class="mcc-fill" aria-label="SF に入る項目">
      <div class="mcc-fill-h"><b>SF に入る項目</b><span class="mcc-fill-n">${n}</span><small>記録すると SF のリードに入ります。チェックを外した項目は入れません</small></div>
      ${F.note ? `<p class="mcc-note">${esc(F.note)}</p>` : ""}
      ${F.plan.map((p) => { const [kl, kc] = FILL_KIND[p.kind] || [p.kind, ""]; const same = p.kind === "same";
        return `<label class="mcc-fill-r ${kc}" title="読み取ったところ：${esc(p.why)}"><input type="checkbox" data-fill="${esc(p.api)}" ${same ? "disabled" : fillOn(p) ? "checked" : ""} />
          <span class="k">${esc(p.label)}</span><span class="v">${esc(p.value)}${p.kind === "update" && p.cur ? `<small>今の SF：${esc(p.cur)}</small>` : ""}</span><span class="mcc-fill-b ${kc}">${kl}</span></label>`; }).join("")}
    </div>`;
    box.querySelectorAll("[data-fill]").forEach((c) => c.addEventListener("change", () => { S.f.picks[c.dataset.fill] = c.checked; drawFill(); }));
  }
  // ヒアリング（2026-11-18 福井さん）：検討時期・採用ニーズ・説明会/面接の参加人数・採用目標人数。
  //   前に聞いた値を最初から入れておき、変わったところだけ直せばよいようにする。SF のリードの項目にも入る
  const hv = (k) => { const v = S.f.hearing[k]; if (v != null && v !== "") return String(v); const H = (S.d && S.d.lead.hearing) || {}; return H[k] != null ? String(H[k]) : ""; };
  function hearingHtml(f, L) {
    const H = L.hearing || {};
    return `<div class="mcc-gateform mcc-hearing" aria-label="ヒアリング">
      <div class="mcc-field full">検討時期（SF の検討開始時期に入ります）<div class="mcc-chips">${[...Array.from({ length: 12 }, (_, i) => `${i + 1}月`), "未定"].map((m) => `<button class="mcc-chip" data-hw="${m}" aria-pressed="${hv("when") === m}">${m}</button>`).join("")}</div></div>
      <label class="mcc-field full">採用ニーズ（困っていること・ほしい人）<input id="mccHNeed" value="${esc(hv("need"))}" autocomplete="off" placeholder="例：母集団が足りない／27卒で介護職を10名" /></label>
      <label class="mcc-field">説明会・面接の参加人数<input id="mccHContact" value="${esc(hv("contact"))}" inputmode="numeric" autocomplete="off" placeholder="名" /></label>
      <label class="mcc-field">採用目標人数<input id="mccHTarget" value="${esc(hv("target"))}" inputmode="numeric" autocomplete="off" placeholder="名" /></label>
      ${H.at ? `<p class="mcc-note full">前に聞いた日：${esc(day(H.at))}</p>` : ""}</div>`;
  }
  const hearingBody = () => ({ when: hv("when"), need: hv("need"), contact: hv("contact"), target: hv("target") });
  async function saveHearing() {
    if (!S.d) return; const L = S.d.lead; const h = hearingBody();
    if (!h.when && !h.need && !h.contact && !h.target) return;
    try { const j = await post(`/api/mccall/leads/${L.id}/hearing`, { ...h, inbound: isInbound(L.id) ? S.inbound.id : null }); L.hearing = j.hearing; S.cache.delete(L.id); } catch (e) { setNotice([{ kind: "danger", text: `ヒアリングを保存できませんでした：${e.message}` }]); }
  }
  function refreshFoot() { const b = $("mccRec"); if (b) b.disabled = !ready(); const h = $("mccHint"); if (h) h.textContent = footHint(); }
  function footHint() {
    const f = S.f;
    if (f.step === "when" && f.outcome === "absent" && !f.nextAt) return "Enter で自動の掛け直しにして記録（時間を選んでもよい）";
    return ready() ? "Enter で記録（押してもよい）" : f.step === "apo" ? "日時を入れてください" : f.step === "when" ? "時間を選ぶか、日時を指定してください" : "数字キーかクリックで選べます";
  }
  // 掛け直す日時を手で指定する（2026-11-23 福井さん：担当者が不在のとき、受付で聞いた戻り時間などに合わせて掛け直せるように）
  //   過去の日時は入れない（すぐ順番が回ってきてしまうため）。指定したら Enter でそのまま記録できる
  function whenManualHtml(f) {
    const v = f.nextAt && f.nextLabel === MANUAL ? toLocalInput(f.nextAt) : "";
    return `<div class="mcc-gateform" style="margin-top:12px"><label class="mcc-field full">日時を指定して掛け直す<input type="datetime-local" id="mccNextAt" min="${toLocalInput(new Date().toISOString())}" step="300" value="${esc(v)}" /></label>
      <p class="mcc-note full" id="mccNextNote">${manualNote(f)}</p></div>`;
  }
  const MANUAL = "指定した日時";
  const manualNote = (f) => (f.nextAt && f.nextLabel === MANUAL ? `次は <b>${esc(tm(f.nextAt))}</b> に掛け直します。Enter で記録` : "例：受付で「15時に戻る」と聞いたら、その時刻を入れる");
  function pickManual(val) {
    const f = S.f; const d = val ? new Date(val) : null; const note = $("mccNextNote");
    if (!d || isNaN(d)) { if (f.nextLabel === MANUAL) { f.nextAt = ""; f.nextLabel = ""; } }
    else if (d.getTime() < Date.now() - 60e3) { f.nextAt = ""; f.nextLabel = ""; refreshFoot(); if (note) note.innerHTML = "過去の日時は選べません。これから先の日時を入れてください"; return; }
    else { f.nextAt = d.toISOString(); f.nextLabel = MANUAL; f.noRetry = false; }
    refreshFoot(); if (note) note.innerHTML = manualNote(f);
  }
  async function saveGate() {
    if (!S.d) return; const L = S.d.lead; const g = { name: S.f.gate.name || (L.gate && L.gate.name) || "", hours: S.f.gate.hours || (L.gate && L.gate.hours) || "", direct: S.f.gate.direct || (L.gate && L.gate.direct) || "" };
    if (!g.name && !g.hours && !g.direct) return;
    try { const j = await post(`/api/mccall/leads/${L.id}/gate`, g); L.gate = j.gate; drawLeft(); } catch (e) { setNotice([{ kind: "danger", text: `受付で聞けたことを保存できませんでした：${e.message}` }]); }
  }
  function choose(k, label) {
    const f = S.f;
    if (f.step === "reach") {
      if (k === "person") { f.reach = k; f.step = "outcome"; }
      else { const [r, o] = k.split(":"); f.reach = r; f.outcome = o; if (INSTANT.has(o)) { drawCenter(); record(); return; } f.step = o === "callback_req" || o === "absent" ? "when" : "ready"; }
    }
    else if (f.step === "outcome") { f.outcome = k; f.step = k === "reject" ? "reason" : k === "callback_req" ? "when" : k === "apo" ? "apo" : "ready"; }
    else if (f.step === "reason") { f.reason = k; f.step = "ready"; }
    else if (f.step === "when") {
      if (k === "auto") { f.nextAt = ""; f.nextLabel = ""; drawCenter(); record(); return; }
      f.nextAt = k; f.nextLabel = label; f.step = "ready";
    }
    drawCenter();
  }
  function back() {
    const f = S.f;
    if (f.step === "outcome" || (f.reach && f.reach !== "person")) { Object.assign(f, { reach: "", outcome: "", reason: "", apoAt: "", nextAt: "", noRetry: false, step: "reach" }); }
    else if (["reason", "when", "apo"].includes(f.step) || (f.step === "ready" && !["reject", "callback_req"].includes(f.outcome))) { f.outcome = ""; f.reason = ""; f.apoAt = ""; f.nextAt = ""; f.noRetry = false; f.step = "outcome"; }
    else if (f.step === "ready") { if (f.outcome === "reject") { f.reason = ""; f.step = "reason"; } else { f.nextAt = ""; f.step = "when"; } }
    drawCenter();
  }

  // ---- アポのおすすめ日時（MOCHICA のクローザーの空きから）（2026-11-17）----
  //   一度読んだら5分は使い回す（会社ごとに読み直すとカレンダーを何度も読んで遅くなるため）
  const toLocalInput = (iso) => { const d = new Date(iso); const p2 = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`; };
  async function loadSlots() {
    if (S.slotsAt && Date.now() - S.slotsAt < 5 * 60e3 && S.slots) return;
    S.slots = { loading: true }; drawSlotsBox();
    try { const j = await api("/api/mccall/slots"); S.slots = j; S.slotsAt = Date.now(); }
    catch (e) { S.slots = { error: e.message }; }
    drawSlotsBox();
  }
  // 「他の日程」で選んだ日の空き。同じ日は5分使い回す（日を行き来するたびにカレンダーを読み直さないため）
  //   読んでいる途中で別の日を選び直したら、古い結果は出さない
  let daySeq = 0;
  async function loadSlotDay(date) {
    if (!date) { S.dayOut = null; return drawSlotsBox(); }
    S.dayCache = S.dayCache || new Map();
    const hit = S.dayCache.get(date);
    if (hit && Date.now() - hit.at < 5 * 60e3) { S.dayOut = hit.d; return drawSlotsBox(); }
    const my = ++daySeq; S.dayOut = { loading: true }; drawSlotsBox();
    let d; try { d = await api(`/api/mccall/slots/day?date=${encodeURIComponent(date)}`); S.dayCache.set(date, { at: Date.now(), d }); } catch (e) { d = { error: e.message }; }
    if (my !== daySeq) return;
    S.dayOut = d; drawSlotsBox();
  }
  // 日程の候補（2026-11-23 福井さん「kincall の日程おすすめと別日程おすすめを MOCHICALL にも」）
  //   kincall の記録の窓の右パネルと同じ形：「おすすめ」（既定）＝2週間から週ごとに空きの多い日の午前・午後、
  //   「他の日程」＝月のカレンダーで日を選ぶと、その日の空き時間（30分きざみ）がすべて出る。
  //   どちらも押すとアポの日時に入る。だれが空いているかも出す（だれの商談になりそうか、架電中に分かるように）
  const slotItem = (x, opt = {}) => `<button type="button" class="mcc-slot${S.f.apoAt === toLocalInput(x.at) ? " on" : ""}${opt.best ? " best" : ""}" data-slot="${esc(x.at)}" data-who="${esc((x.free || []).join("・"))}">
      <span class="mcc-slot-when">${opt.day ? "" : `${esc(x.md)}（${esc(x.dow)}） `}<small>${esc(x.band || "")}</small> ${esc(x.time)}${opt.best ? '<span class="mcc-slot-badge">おすすめ</span>' : ""}</span>
      <span class="mcc-slot-free">${x.freeN}/${x.total}人 空き${x.free && x.free.length ? `：${esc(x.free.join("・"))}` : ""}</span></button>`;
  const WD = ["日", "月", "火", "水", "木", "金", "土"];
  const p2 = (n) => String(n).padStart(2, "0");
  const ymdLocal = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  function slotBestHtml() {
    const o = S.slots;
    if (!o || o.loading) return '<p class="mcc-note">クローザーの空きを読んでいます…</p>';
    if (o.error) return `<p class="mcc-note" style="color:var(--c-danger)">空きを読めませんでした：${esc(o.error)}</p>`;
    if (!o.slots.length) return `<p class="mcc-note">${esc(o.reason || "2週間のうちに空いている枠がありません")}</p><p class="mcc-note">「他の日程」から、日を選んで探せます。</p>`;
    let h = o.members && o.members.length ? `<p class="mcc-note">対象：${esc(o.members.join("・"))}</p>` : "", wk = 0;
    o.slots.forEach((x, i) => { if (x.week && x.week !== wk) { wk = x.week; h += `<div class="mcc-slot-wk">${wk === 1 ? "1週目" : "2週目"}</div>`; } h += slotItem(x, { best: i === 0 }); });
    if (o.unread && o.unread.length) h += `<p class="mcc-note">カレンダーを読めなかった人：${esc(o.unread.join("・"))}（空きに数えていません）</p>`;
    return h + '<p class="mcc-note">ここにない日は「他の日程」から選べます。</p>';
  }
  function slotOtherHtml() {
    const today = ymdLocal(new Date()); const [ty, tm] = today.split("-").map(Number);
    if (!S.calY) { S.calY = ty; S.calM = tm; }
    const y = S.calY, mo = S.calM, ahead = (y - ty) * 12 + (mo - tm);
    const lead = new Date(y, mo - 1, 1).getDay(), days = new Date(y, mo, 0).getDate(), picked = S.f.slotDay || "";
    let cells = WD.map((w, k) => `<span class="mcc-cal-wd${k === 0 ? " sun" : k === 6 ? " sat" : ""}">${w}</span>`).join("") + "<span></span>".repeat(lead);
    for (let d = 1; d <= days; d++) {
      const ds = `${y}-${p2(mo)}-${p2(d)}`, wd = (lead + d - 1) % 7;
      cells += `<button type="button" class="mcc-cal-d${wd === 0 ? " sun" : wd === 6 ? " sat" : ""}${ds === today ? " today" : ""}${ds === picked ? " on" : ""}" data-calday="${ds}"${ds < today ? " disabled" : ""}>${d}</button>`;
    }
    let day = '<p class="mcc-note">日を選ぶと、その日の空いている時間がすべて出ます。</p>';
    if (picked) {
      const [, pm, pd] = picked.split("-").map(Number), dw = WD[new Date(`${picked}T12:00:00`).getDay()], o = S.dayOut;
      day = `<div class="mcc-slot-wk">${pm}/${pd}（${dw}）の空き</div>`;
      if (!o || o.loading) day += '<p class="mcc-note">空きを読んでいます…</p>';
      else if (o.error) day += `<p class="mcc-note" style="color:var(--c-danger)">空きを読めませんでした：${esc(o.error)}</p>`;
      else if (!o.slots.length) day += `<p class="mcc-note">${esc(o.reason || "この日は、空いているクローザーがいません")}</p>`;
      else day += `<div class="mcc-slot-grid">${o.slots.map((x) => slotItem(x, { day: true })).join("")}</div>`;   // 1日分は数が多いので2列にして、記録ボタンまでのスクロールを減らす
      if (o && o.unread && o.unread.length) day += `<p class="mcc-note">カレンダーを読めなかった人：${esc(o.unread.join("・"))}（空きに数えていません）</p>`;
    }
    return `<div class="mcc-cal"><div class="mcc-cal-nav"><button type="button" class="mcc-cal-mv" data-calmv="-1"${ahead <= 0 ? " disabled" : ""} aria-label="前の月">‹</button><b>${y}年${mo}月</b><button type="button" class="mcc-cal-mv" data-calmv="1"${ahead >= 3 ? " disabled" : ""} aria-label="次の月">›</button></div>
      <div class="mcc-cal-grid">${cells}</div></div>${day}`;
  }
  function slotsHtml() {
    const tab = S.f.slotTab === "other" ? "other" : "best";
    return `<div id="mccSlots"><div class="mcc-step" style="margin-top:12px">日程の候補（MOCHICA のクローザーの空き・1時間枠）</div>
      <div class="mcc-slot-tabs" role="tablist"><button type="button" role="tab" data-stab="best" aria-selected="${tab === "best"}">おすすめ</button><button type="button" role="tab" data-stab="other" aria-selected="${tab === "other"}">他の日程</button></div>
      <div class="mcc-slot-body">${tab === "best" ? slotBestHtml() : slotOtherHtml()}</div></div>`;
  }
  // 空きを読み終えたら、その欄だけ描き直す（入力中のメモなどを消さないため）
  function drawSlotsBox() { if (S.f && S.f.step === "apo" && $("mccSlots")) drawCenter(); }

  // ---- 資料送付（2026-11-17）：確かめてから、本人の Gmail で送る ----
  async function sendDoc() {
    if (!S.d) return; const L = S.d.lead;
    let pv;
    try { pv = await post(`/api/mccall/leads/${L.id}/doc/preview`, {}); } catch (e) { setNotice([{ kind: "danger", text: `資料を送る準備ができませんでした：${e.message}` }]); return; }
    const w = dialog(`資料を送る：${pv.company}`, pv.google ? "中身を確かめてから「送る」を押してください。あなたの Gmail から送ります。" : "あなたの Google 連携がまだなので送れません。設定 → 外部連携 → Google でつないでください。", "送る", async (w) => {
      const v = (id) => w.querySelector(id).value;
      const r = await post(`/api/mccall/leads/${L.id}/doc/send`, { to: v("#mccDTo").trim(), cc: v("#mccDCc").trim(), subject: v("#mccDSub").trim(), body: v("#mccDBody"), docId: v("#mccDDoc") });
      toast(`資料を ${r.to} に送りました${r.sf ? `（${r.sf}）` : ""}`);
      S.cache.delete(L.id); try { const d = await api(`/api/mccall/leads/${L.id}`); if (S.d && S.d.lead.id === L.id) { S.d = d; drawRight(); } } catch {}
    }, `<div style="display:grid;gap:8px;margin-top:12px">
        <label class="mcc-field">資料<select class="mcc-sel" id="mccDDoc" style="max-width:none">${pv.docs.map((d) => `<option value="${esc(d.id)}"${d.id === pv.docId ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label>
        ${pv.warn ? `<p class="mcc-note" style="color:var(--c-warn)">${esc(pv.warn)}</p>` : ""}
        <label class="mcc-field">宛先<input id="mccDTo" type="email" value="${esc(pv.to)}" autocomplete="off" /></label>
        <label class="mcc-field">CC（なくてよい）<input id="mccDCc" value="${esc(pv.cc)}" autocomplete="off" /></label>
        <label class="mcc-field">件名<input id="mccDSub" value="${esc(pv.subject)}" /></label>
        <label class="mcc-field">本文<textarea id="mccDBody" style="min-height:200px">${esc(pv.body)}</textarea></label>
        <p class="mcc-note">本文の {URL} には、「送る」を押したときに doc-room でこの会社用に作るルームの URL が入ります（だれがいつ開いたかは doc-room で分かります）。</p></div>`);
    if (!pv.google) { const ok = w.querySelector("[data-ok]"); ok.disabled = true; }
    // 資料を変えたら、件名・本文を作り直す（宛先と CC は書いたまま残す）
    w.querySelector("#mccDDoc").addEventListener("change", async (e) => {
      try { const n = await post(`/api/mccall/leads/${L.id}/doc/preview`, { docId: e.target.value }); pv = n;
        w.querySelector("#mccDSub").value = n.subject; w.querySelector("#mccDBody").value = n.body;
      } catch (err) { toast(`資料を切り替えられませんでした：${err.message}`); }
    });
  }

  // ---- 問い合わせフォーム（2026-11-20 福井さん）：会社の HP の問い合わせフォームに、サーバーのブラウザで入力して送る ----
  //   まず本文を出し、裏でフォームを探して「どの欄に何を入れるか」を見せる。確かめてから「送る」。
  //   ロボット確認があるフォーム・何を入れるか分からない必須の欄があるフォームは送らない（理由を出し、開いて手で送れるようにする）
  async function sendForm() {
    if (!S.d) return; const L = S.d.lead;
    let pv;
    try { pv = await post(`/api/mccall/leads/${L.id}/form/preview`, { scan: false }); } catch (e) { setNotice([{ kind: "danger", text: `問い合わせフォームの準備ができませんでした：${e.message}` }]); return; }
    let again = false, found = false;
    const w = dialog(`問い合わせフォームから送る：${pv.company}`, "サーバーのブラウザが相手のフォームに入力して送ります。どの欄に何を入れるかを確かめてから「送る」を押してください。", "送る", async (w) => {
      const v = (id) => w.querySelector(id).value;
      try {
        const r = await post(`/api/mccall/leads/${L.id}/form/send`, { url: v("#mccFUrl").trim(), kana: v("#mccFKana").trim(), subject: v("#mccFSub").trim(), body: v("#mccFBody"), again });
        S.f.formSent = r.status === "sent" ? "送りました" : "送信を押しました（届いたかは相手のページで確かめてください）";
        toast(`問い合わせフォームから${r.status === "sent" ? "送りました" : "送信を押しました（完了の文言は見つかりませんでした）"}${r.sf ? `（${r.sf}）` : ""}`);
        S.cache.delete(L.id); try { const d = await api(`/api/mccall/leads/${L.id}`); if (S.d && S.d.lead.id === L.id) { S.d = d; drawRight(); } } catch {}
        if (S.d && S.d.lead.id === L.id) drawCenter();
      } catch (e) {
        // 30日のうちに送っている会社：もう一度押せば送る
        if (e.status === 409 && e.data && e.data.dup) { again = true; w.querySelector("[data-ok]").textContent = "それでも送る"; }
        throw e;
      }
    }, `<div style="display:grid;gap:8px;margin-top:12px">
        ${pv.ready ? "" : `<p class="mcc-note" style="color:var(--c-warn)">差出人の会社名・電話番号がひな形に入っていないので、まだ送れません。管理者が「リスト」タブの「問い合わせフォームのひな形」で入れてください。</p>`}
        ${pv.last ? `<p class="mcc-note" style="color:var(--c-warn)">この会社には ${esc(day(pv.last.created_at))} に問い合わせフォームから送っています。</p>` : ""}
        <label class="mcc-field">問い合わせページ（空なら会社の Web ページから探します）<span style="display:flex;gap:6px"><input id="mccFUrl" type="url" value="${esc(pv.url || "")}" placeholder="https://" autocomplete="off" style="flex:1" /><button class="mcc-btn" id="mccFScanBtn" type="button">調べ直す</button></span></label>
        <div id="mccFScan" class="mcc-note"></div>
        <label class="mcc-field">あなたの名前のフリガナ（フォームで聞かれたときに入ります。次からは覚えています）<input id="mccFKana" value="${esc(pv.kana || "")}" placeholder="例：フクイ ショウ" autocomplete="off" /></label>
        <label class="mcc-field">件名（件名の欄があるときだけ入ります）<input id="mccFSub" value="${esc(pv.subject)}" /></label>
        <label class="mcc-field">本文<textarea id="mccFBody" style="min-height:200px">${esc(pv.body)}</textarea></label></div>`);
    const ok = w.querySelector("[data-ok]"); const box = w.querySelector("#mccFScan");
    const sync = () => { ok.disabled = !pv.ready || !found; };
    const scan = async () => {
      found = false; sync();
      box.innerHTML = "フォームを探しています…（20〜40秒ほどかかります）";
      try {
        const r = await post(`/api/mccall/leads/${L.id}/form/preview`, { url: w.querySelector("#mccFUrl").value.trim(), kana: w.querySelector("#mccFKana").value.trim(), subject: w.querySelector("#mccFSub").value, body: w.querySelector("#mccFBody").value });
        if (!document.body.contains(w)) return;
        if (r.url) w.querySelector("#mccFUrl").value = r.url;
        found = !!r.found;
        const rows = (r.plan || []).map((p) => `<tr><th style="text-align:left;font-weight:600;padding:2px 8px 2px 0">${esc(p.label)}</th><td>${esc(p.value)}</td></tr>`).join("");
        box.innerHTML = `${r.found ? `<b style="color:var(--c-ok,#0d5b47)">フォームが見つかりました。</b>この内容で入れます：` : `<b style="color:#B4441F">${esc(r.error || "フォームが見つかりませんでした")}</b>`}
          ${r.warn ? `<div style="color:var(--c-warn)">${esc(r.warn)}</div>` : ""}
          ${rows ? `<table style="margin-top:4px;font-size:12px">${rows}</table>` : ""}
          ${r.url && !r.found ? `<div><a href="${esc(r.url)}" target="_blank" rel="noopener">相手のページを開いて手で送る</a></div>` : ""}`;
      } catch (e) { if (document.body.contains(w)) box.innerHTML = `<b style="color:#B4441F">フォームを調べられませんでした：${esc(e.message)}</b>`; }
      sync();
    };
    w.querySelector("#mccFScanBtn").addEventListener("click", scan);
    sync(); scan();
  }

  async function record() {
    if (!S.d || !ready() || S.busy) return; S.busy = true;
    const f = S.f; const L = S.d.lead; const company = L.company;
    const gate = { name: f.gate.name || (L.gate && L.gate.name) || "", hours: f.gate.hours || (L.gate && L.gate.hours) || "", direct: f.gate.direct || (L.gate && L.gate.direct) || "" };
    const body = { reach: f.reach, outcome: f.outcome, reason: f.reason, apoWho: f.outcome === "apo" ? f.apoWho : "", memo: f.memo, phone: f.phone || L.phone, gate, noRetry: f.noRetry, hearing: f.reach === "person" ? hearingBody() : null,
      nextAt: f.nextAt || null, apoAt: f.apoAt ? new Date(f.apoAt).toISOString() : null,
      talkId: S.d.talk ? S.d.talk.id : null, inbound: isInbound(L.id) ? S.inbound.id : null, sfPick: f.picks };
    try {
      const j = await post(`/api/mccall/leads/${L.id}/log`, body);
      const what = crumb();
      S.queue = S.queue.filter((x) => x.id !== L.id); if (isInbound(L.id)) S.inbound = null;
      toast(`記録しました：${company} ${what}${j.nextAt ? ` → ${tm(j.nextAt)} に掛け直し` : ""}`, { undo: j.logId });
      loadStats(); S.busy = false;
      setTimeout(loadStats, 8000);   // SF への書き込みは記録のあとで行うので、少し待って書けたかを確かめ直す
      const n = nextItem(); if (n) await open(n.id); else { S.d = null; await loadQueue(true); }
      if (S.queue.length < 5) loadQueue(false);
    } catch (e) { S.busy = false; setNotice([{ kind: "danger", text: `記録できませんでした：${e.message}` }]); }
  }
  async function skip() {
    if (!S.d) return; const id = S.d.lead.id; release(); if (isInbound(id)) S.inbound = null;
    S.queue = S.queue.filter((x) => x.id !== id); S.queue.push({ id, company: S.d.lead.company });   // 飛ばした会社はいちばん後ろへ
    const n = nextItem(); if (n && n.id !== id) await open(n.id);
  }
  function release() { if (S.d) post(`/api/mccall/leads/${S.d.lead.id}/release`).catch(() => {}); }
  async function undo(logId) {
    try { const j = await post(`/api/mccall/logs/${logId}/undo`); toast(`取り消しました${j.sf ? `（${j.sf}）` : ""}`); loadStats(); release(); S.cache.delete(j.leadId); await open(j.leadId); }
    catch (e) { toast(`取り消せませんでした：${e.message}`); }
  }

  // 右：これまで（kinbot の架電・Bales の活動・SF の商談を1本に）
  function drawRight() {
    const d = S.d; if (!d) return;
    $("mccRight").innerHTML = `${scriptHtml(d)}<h3>これまで（${d.timeline.length}件）</h3>
      ${d.timeline.length ? `<div class="mcc-tl">${d.timeline.map((t, i) => `<div class="mcc-ti ${esc(t.src)}"><div class="h"><span class="src">${esc(t.src)}</span><span>${esc(t.src === "SF" ? day(t.at) : tm(t.at))}</span><b>${esc(t.title)}</b><span>${esc(t.who || "")}</span>${t.cross ? '<span class="mcc-badge doc">部署をまたぐ</span>' : ""}</div>
        ${t.text ? `<div class="t" data-ti="${i}">${esc(t.text)}</div>${t.text.length > 120 ? `<button data-more="${i}">全部見る</button>` : ""}` : ""}${t.mine ? ` <button data-undo="${t.logId}">この記録を取り消す</button>` : ""}</div>`).join("")}</div>` : '<p class="mcc-note">まだやりとりの記録はありません。</p>'}
`;
    const sc = $("mccScript"); if (sc) sc.addEventListener("toggle", () => ls.set("mcc_script_open", sc.open ? "1" : "0"));
    $("mccRight").querySelectorAll("[data-more]").forEach((b) => b.addEventListener("click", () => { const t = $("mccRight").querySelector(`[data-ti="${b.dataset.more}"]`); t.classList.toggle("open"); b.textContent = t.classList.contains("open") ? "たたむ" : "全部見る"; }));
    $("mccRight").querySelectorAll("[data-undo]").forEach((b) => b.addEventListener("click", () => dialog("この記録を取り消しますか", "SF に書いた活動も消します。取り消すと、この会社は記録する前の状態に戻ります。", "取り消す", () => undo(b.dataset.undo))));
  }
  // トークスクリプト（2026-11-18 福井さん）。リストごとに管理者が書く。{会社名} {担当者} はこの会社のものに差し替える。
  //   開いた・閉じたは覚えておく（毎回開き直さなくてよいように）
  function scriptHtml(d) {
    if (!d.script) return "";
    const L = d.lead; const person = (L.gate && L.gate.name) || L.person || "ご担当者";
    const txt = d.script.replace(/\{会社名\}/g, L.company || "御社").replace(/\{担当者\}/g, person);
    const t = d.talk; const head = t ? `トーク ${esc(t.label)}（第${t.ver}版）${t.n > 1 ? "・A/B で比べています。この会社はこのトークで" : ""}` : "トークスクリプト";
    return `<details class="mcc-script" id="mccScript" ${ls.get("mcc_script_open") === "0" ? "" : "open"}><summary>${head}</summary><div class="body">${esc(txt)}</div></details>`;
  }
  // ---- 知らせ：大事な順に1件だけ。ほかは「ほか N件」で順に見る ----
  function drawNotices() {
    const d = S.d; const ns = [];
    if (d) {
      if (isInbound(d.lead.id)) ns.push({ kind: "doc", text: `折り返しの着信です（${S.inbound.number}）。発信しなくても、そのまま結果を記録できます` });
      if (d.lead.dup_of) ns.push({ kind: "danger", text: "重複で止めたリードです（ほかのリードと会社名が同じで、電話・メール・Web ページ・法人番号のどれかも同じ）。かけずに「飛ばす」を押し、管理者に知らせてください" });
      if (d.ban) ns.push({ kind: "danger", text: `アプローチ禁止の会社です（${d.ban.reason || "理由の記録なし"}）。かけずに「飛ばす」を押してください` });
      if (d.cross) ns.push({ kind: "doc", text: `DOC のリスト「${d.cross.from_name}」から持ってきたリードです（理由：${d.cross.reason}）。記録は部署をまたいだものとして残ります` });
      else if (d.docAlso && d.docAlso.length) ns.push({ kind: "doc", text: `この番号は DOC のリスト「${d.docAlso[0].list}」${d.docAlso[0].assigned_to ? `（担当 ${d.docAlso[0].assigned_to}）` : ""}にもあります。DOC と話がかぶらないよう前回を確かめてください` });
      if (d.lead.next_why && d.lead.next_at) ns.push({ kind: "info", text: `掛け直しの時刻が来た会社です：${d.lead.next_why}（${tm(d.lead.next_at)}）`, act: { label: "掛け直しを解除", fn: async () => { await post(`/api/mccall/leads/${d.lead.id}/clear-next`); d.lead.next_why = null; d.lead.next_at = null; drawNotices(); } } });
    }
    // SF に書けなかった記録は黙らせない（MOCHICA のルール5）。いちばん上に出し、その場で書き直せるようにする
    const sf = S.sf;
    if (sf && sf.fail) ns.unshift({ kind: "danger", text: `今日の記録 ${sf.fail}件が SF に書けていません${sf.lastErr ? `（${sf.lastErr}）` : ""}。kinbot には残っています`,
      act: { label: "SF に書き直す", fn: async () => { const r = await post("/api/mccall/sf-retry"); toast(r.left ? `${r.tried - r.left}件書けました。${r.left}件はまだ書けません。続くときは管理者に知らせてください` : `${r.tried}件を SF に書きました`); await loadStats(); } } });
    if (sf && sf.leadErr) ns.unshift({ kind: "danger", text: `今日のヒアリング ${sf.leadErr}件が SF のリードの項目（検討開始時期・採用人数・顧客の課題感）に書けていません。活動の本文と kinbot には残っています。続くときは管理者に知らせてください` });
    if (d && !(d.lead.sf_lead_id || (d.sf && d.sf.lead && d.sf.lead.id))) ns.push({ kind: "info", text: "この会社は SF のリードと結びついていないので、記録は kinbot にだけ残ります（SF の活動には出ません）" });
    const due = S.queue.filter((x) => x.next_at).length;
    if (due > 1) ns.push({ kind: "info", text: `掛け直しの時刻が来た会社が ${due}件あります（先に並べています）` });
    setNotice(ns);
  }
  function setNotice(ns) {
    S.notices = ns || []; S.ni = 0; showNotice();
  }
  function showNotice() {
    const el = $("mccNotice"); if (!el) return; const n = S.notices[S.ni];
    if (!n) { el.className = "mcc-notice"; el.innerHTML = `<span class="tx">${S.d ? "お知らせはありません" : ""}</span>`; return; }
    el.className = `mcc-notice ${n.kind}`;
    el.innerHTML = `<span class="tx" title="${esc(n.text)}">${esc(n.text)}</span>${n.act ? `<button data-na>${esc(n.act.label)}</button>` : ""}${S.notices.length > 1 ? `<button data-nn>ほか ${S.notices.length - 1}件</button>` : ""}`;
    const a = el.querySelector("[data-na]"); if (a) a.addEventListener("click", () => n.act.fn().catch((e) => toast(e.message)));
    const nn = el.querySelector("[data-nn]"); if (nn) nn.addEventListener("click", () => { S.ni = (S.ni + 1) % S.notices.length; showNotice(); });
  }

  // ---- 画面の下の短い知らせ（元に戻す付き）。画面を押し下げない ----
  function toast(text, o = {}) {
    if (S.toast) S.toast.remove(); clearTimeout(S.toastT);
    const t = document.createElement("div"); t.className = "mcc-toast"; t.setAttribute("role", "status");
    t.innerHTML = `<span>${esc(text)}</span>${o.undo ? `<button data-u aria-keyshortcuts="Z">元に戻す（Z）</button>` : ""}`;
    document.body.appendChild(t); S.toast = t; S.toastUndo = o.undo || null;
    const u = t.querySelector("[data-u]"); if (u) u.addEventListener("click", () => { t.remove(); S.toast = null; undo(o.undo); });
    S.toastT = setTimeout(() => { t.remove(); if (S.toast === t) { S.toast = null; S.toastUndo = null; } }, o.undo ? 12000 : 5000);
  }
  // 画面の中の確認（ブラウザの confirm は使わない）
  function dialog(title, body, okLabel, onOk, extra = "") {
    const w = document.createElement("div"); w.className = "mcc-dlg"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true");
    w.innerHTML = `<div><h2>${esc(title)}</h2><p class="mcc-note">${esc(body)}</p>${extra}<div class="row"><button class="mcc-btn" data-x>やめる</button><button class="mcc-btn primary" data-ok>${esc(okLabel)}</button></div></div>`;
    document.body.appendChild(w); S.dlg = w;
    const close = () => { w.remove(); S.dlg = null; };
    w.querySelector("[data-x]").addEventListener("click", close);
    w.addEventListener("click", (e) => { if (e.target === w) close(); });
    w.querySelector("[data-ok]").addEventListener("click", async () => { const b = w.querySelector("[data-ok]"); b.disabled = true; try { const r = await onOk(w); if (r !== false) close(); } catch (e) { b.disabled = false; const p = w.querySelector(".err") || Object.assign(document.createElement("p"), { className: "mcc-note err" }); p.style.color = "#B4441F"; p.textContent = e.message; w.querySelector(".row").before(p); } });
    setTimeout(() => { const i = w.querySelector("input,textarea,select"); (i || w.querySelector("[data-ok]")).focus(); }, 0);
    return w;
  }
  function help() {
    dialog("キー操作", "", "閉じる", () => {}, `<div class="mcc-help"><dl>
      <dt><kbd>1</kbd>〜<kbd>9</kbd></dt><dd>いま出ている選択肢を選ぶ（発信してから。応答なし・話し中・留守電・現アナは押すとすぐ記録して次へ。不在は次に掛け直す時間を選ぶ。1 なら自動）</dd><dt><kbd>Enter</kbd></dt><dd>記録して次の企業へ</dd>
      <dt><kbd>Backspace</kbd></dt><dd>ひとつ前の選択に戻る</dd><dt><kbd>C</kbd></dt><dd>選んでいる番号に発信</dd>
      <dt><kbd>S</kbd></dt><dd>この企業を飛ばす（いちばん後ろへ）</dd><dt><kbd>Z</kbd></dt><dd>いま記録したものを元に戻す</dd>
      <dt><kbd>Ctrl</kbd>+<kbd>Enter</kbd></dt><dd>メモを書いている途中でも記録する</dd><dt><kbd>Esc</kbd></dt><dd>入力欄から出る・窓を閉じる</dd></dl></div>`);
  }

  function visible() { const p = document.querySelector('[data-pane="call"]'); return p && !p.hidden && S.tab === "call"; }
  function onKey(e) {
    if (S.dlg) { if (e.key === "Escape") { S.dlg.remove(); S.dlg = null; } return; }
    if (!visible() || !S.d || !S.f) return;
    const tag = (e.target && e.target.tagName) || ""; const typing = /INPUT|TEXTAREA|SELECT/.test(tag);
    if (typing) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (ready()) record(); }
      else if (e.key === "Escape") e.target.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[1-9]$/.test(e.key)) { const b = $("mccCenter").querySelectorAll("[data-c]")[Number(e.key) - 1]; if (b) { e.preventDefault(); b.click(); } return; }
    if (e.key === "Enter") { e.preventDefault(); if (ready()) record(); return; }
    if (e.key === "Backspace") { e.preventDefault(); if (S.f.step !== "reach") back(); return; }
    const k = e.key.toLowerCase();
    if (k === "c") { const a = $("mccDial"); if (a) { e.preventDefault(); a.click(); } }
    else if (k === "s") { e.preventDefault(); skip(); }
    else if (k === "z" && S.toastUndo) { e.preventDefault(); const id = S.toastUndo; if (S.toast) S.toast.remove(); S.toast = null; S.toastUndo = null; undo(id); }
    else if (e.key === "?") { e.preventDefault(); help(); }
  }

  // ---- 管理者：リストの管理 ----
  async function drawLists() {
    const box = $("mccAdmin"); box.innerHTML = `<div class="mcc-card">読み込んでいます…</div>`; S.ldBack = null;
    try {
      await loadLists(); await loadStats();
      const all = S.allStats || [];
      box.innerHTML = `
        <div class="mcc-card"><h2>架電リスト</h2>
          <p class="mcc-note">ここで作ったリストは MOCHICA だけのものです。DOC の kincall のリストとは混ざりません。メンバーを選ばないと、MOCHICA のメンバー全員がかけられます。</p>
          <p class="mcc-note">リストを管理できる人：${esc(((S.meta && S.meta.admins) || []).join("・") || "（田中さん・kinbot の管理者だけ）")}</p>
          <div style="margin:12px 0"><button class="mcc-btn primary" id="mccNew">新しいリストを作る</button> <button class="mcc-btn" id="mccTpl">資料送付のひな形</button> <button class="mcc-btn" id="mccFTpl">問い合わせフォームのひな形</button></div>
          ${S.lists.length ? `<table class="mcc-tbl"><thead><tr><th>リスト</th><th>メンバー</th><th class="num">残り</th><th class="num">今かける</th><th class="num">DOC から</th><th></th></tr></thead><tbody>
            ${S.lists.map((l) => `<tr><td><b>${esc(l.name)}</b></td><td>${l.members && l.members.length ? `${l.members.length}人` : "MOCHICA 全員"}</td><td class="num">${l.open} / ${l.total}</td><td class="num">${l.now}</td><td class="num">${l.cross || ""}</td>
              <td style="white-space:nowrap"><button class="mcc-btn primary" data-add="${l.id}">リードを足す</button> <button class="mcc-btn" data-mem="${l.id}">メンバー</button> <button class="mcc-btn ${l.talks ? "" : "danger"}" data-scr="${l.id}" title="${l.talks ? `トーク ${l.talks}本` : "トークが無いのでかけられません"}">${l.talks ? `トーク（${l.talks}本）` : "トークを書く"}</button> <button class="mcc-btn primary" data-leads="${l.id}">割り振る・移す</button> <button class="mcc-btn danger" data-close="${l.id}">閉じる</button></td></tr>`).join("")}</tbody></table>` : '<p class="mcc-note">まだリストがありません。</p>'}
        </div>
        <div class="mcc-card" id="mccStock"></div>
        <div class="mcc-card" id="mccDups" hidden></div>
        <div class="mcc-card"><h2>今日の数字（全員）</h2>${all.length ? `<table class="mcc-tbl"><thead><tr><th>名前</th><th class="num">コール</th><th class="num">担当者と話せた</th><th class="num">アポ</th><th class="num">部署をまたいだ架電</th></tr></thead><tbody>${all.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.calls}</td><td class="num">${r.person}</td><td class="num">${r.apo}</td><td class="num">${r.cross}</td></tr>`).join("")}</tbody></table>` : '<p class="mcc-note">今日はまだ記録がありません。</p>'}</div>`;
      $("mccNew").addEventListener("click", () => listDialog());
      drawDups();
      $("mccTpl").addEventListener("click", tplDialog); $("mccFTpl").addEventListener("click", formTplDialog);
      box.querySelectorAll("[data-scr]").forEach((b) => b.addEventListener("click", () => talkDialog(S.lists.find((l) => l.id === +b.dataset.scr))));
      box.querySelectorAll("[data-mem]").forEach((b) => b.addEventListener("click", () => listDialog(S.lists.find((l) => l.id === +b.dataset.mem))));
      box.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => addDialog(+b.dataset.add)));
      drawStock();
      box.querySelectorAll("[data-leads]").forEach((b) => b.addEventListener("click", () => drawLeads(S.lists.find((l) => l.id === +b.dataset.leads))));
      box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dialog("このリストを閉じますか", "閉じると、だれの「かける」にも出なくなります。記録は消えません。", "閉じる", async () => { await api(`/api/mccall/lists/${b.dataset.close}`, { method: "PATCH", body: JSON.stringify({ closed: true }) }); drawLists(); })));
    } catch (e) { box.innerHTML = `<div class="mcc-card">読めませんでした：${esc(e.message)}</div>`; }
  }
  // 資料送付のひな形（MOCHICA 専用。DOC の資料送付の設定とは別）（2026-11-17）
  async function tplDialog() {
    let c; try { c = await api("/api/mccall/doc-settings"); } catch (e) { toast(e.message); return; }
    dialog("資料送付のひな形（MOCHICA）", "差し込み：{担当者} {会社名} {差出人} {資料名} {URL}。DOC の資料送付の設定は変わりません。", "保存する", async (w) => {
      const v = (id) => w.querySelector(id).value;
      await api("/api/mccall/doc-settings", { method: "PUT", body: JSON.stringify({ subject: v("#mccTSub"), body: v("#mccTBody"), defaultDocId: v("#mccTDoc"), cc: v("#mccTCc") }) });
      toast("資料送付のひな形を保存しました");
    }, `<div style="display:grid;gap:8px;margin-top:12px">
      ${c.docErr ? `<p class="mcc-note" style="color:var(--c-warn)">doc-room の資料一覧を読めませんでした：${esc(c.docErr)}</p>` : ""}
      <label class="mcc-field">いつも使う資料（doc-room に登録した資料）<select class="mcc-sel" id="mccTDoc" style="max-width:none"><option value="">（いちばん上の資料）</option>${c.docs.map((d) => `<option value="${esc(d.id)}"${String(d.id) === String(c.defaultDocId) ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></label>
      <label class="mcc-field">いつも入れる CC（空のままなら入れない）<input id="mccTCc" value="${esc(c.cc)}" autocomplete="off" /></label>
      <label class="mcc-field">件名<input id="mccTSub" value="${esc(c.subject)}" /></label>
      <label class="mcc-field">本文<textarea id="mccTBody" style="min-height:200px">${esc(c.body)}</textarea></label></div>`);
  }
  // 問い合わせフォームのひな形（MOCHICA 共通の差出人の情報と本文）（2026-11-20）。名前とメールは送る本人のものが入る
  async function formTplDialog() {
    let c; try { c = await api("/api/mccall/form-settings"); } catch (e) { toast(e.message); return; }
    const F = [["company", "差出人の会社名（必須）"], ["companyKana", "会社名のフリガナ"], ["dept", "部署"], ["tel", "電話番号（必須）"], ["zip", "郵便番号"], ["addr", "住所（都道府県から）"], ["site", "Web ページ"], ["subject", "件名"]];
    dialog("問い合わせフォームのひな形（MOCHICA）", "差し込み：{会社名} {担当者} {差出人} {差出人の会社名} {電話} {メール}。名前とメールアドレスは送る人のものが入ります。", "保存する", async (w) => {
      const b = { body: w.querySelector("#mccFTBody").value }; for (const [k] of F) b[k] = w.querySelector(`[data-ft="${k}"]`).value;
      await api("/api/mccall/form-settings", { method: "PUT", body: JSON.stringify(b) });
      toast("問い合わせフォームのひな形を保存しました");
    }, `<div style="display:grid;gap:8px;margin-top:12px">
      ${F.map(([k, l]) => `<label class="mcc-field">${esc(l)}<input data-ft="${k}" value="${esc(c[k] || "")}" autocomplete="off" /></label>`).join("")}
      <label class="mcc-field">本文<textarea id="mccFTBody" style="min-height:200px">${esc(c.body)}</textarea></label></div>`);
  }
  // 重複で止めたリード（2026-11-18）：決まりができる前から入っていた重複。消さずに止めてあるので、ここで見て決める
  async function drawDups() {
    const box = $("mccDups"); if (!box) return;
    let j; try { j = await api("/api/mccall/dups"); } catch (e) { box.hidden = false; box.innerHTML = `<h2>重複で止めたリード</h2><p class="mcc-note">読めませんでした：${esc(e.message)}</p>`; return; }
    if (!j.items.length) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<h2>重複で止めたリード（${j.items.length}件）</h2>
      <p class="mcc-note">会社名が同じで、電話番号・メールアドレス・Web ページ・法人番号のどれかも先に入っていたリードと同じだったので、かける順番から外しています（消してはいません）。本当に別の会社（同じ代表番号のグループ会社など）なら「別の会社として残す」を押すと、かけられるようになります。</p>
      <div class="mcc-tblwrap"><table class="mcc-tbl"><thead><tr><th>止めたリード</th><th>リスト</th><th>先に入っていたリード</th><th>そのリスト・状態</th><th></th></tr></thead><tbody>
      ${j.items.map((r) => `<tr><td><b>${esc(r.company || "")}</b><small> ${esc(r.phone || "")}</small></td><td>${esc(r.list || "")}</td><td>${esc(r.ocompany || "")}<small> ${esc(r.ophone || "")}</small></td><td>${esc(r.olist || "")}${r.odone ? "（終わり）" : ""}${r.oout ? `<small> ${esc(r.oout)}</small>` : ""}</td><td><button class="mcc-btn" data-notdup="${r.id}">別の会社として残す</button></td></tr>`).join("")}</tbody></table></div>`;
    box.querySelectorAll("[data-notdup]").forEach((b) => b.addEventListener("click", () => dialog("別の会社として残しますか", "このリードを、先に入っていたリードとは別の会社としてかけられるようにします。同じ会社に2人がかけることにならないか確かめてから押してください。", "残す", async () => { await post(`/api/mccall/leads/${b.dataset.notdup}/not-dup`); toast("別の会社として残しました"); drawLists(); })));
  }
  // トーク（売り方）。リスト（売り先）とセットで1つの施策（2026-11-20 福井さん）。
  //   A/B/C の3本まで書ける。2本以上あると会社ごとに1本を決めて比べる。直すと新しい版になり、前の版の数字は「施策」に残る
  async function talkDialog(l) {
    let j; try { j = await api(`/api/mccall/lists/${l.id}/talks`); } catch (e) { toast(e.message); return; }
    const cur = new Map(j.talks.map((t) => [t.label, t]));
    const hist = (lb) => j.history.filter((h) => h.label === lb).map((h) => `第${h.ver}版${h.active ? "（使用中）" : ""} ${h.calls}コール`).join("・");
    const w = dialog(`「${l.name}」のトーク`, "トークが1本も無いリストはかけられません（売り先と売り方はセット）。2本以上書くと、会社ごとにどれか1本に決まり、施策のタブでアポ率を比べられます。{会社名} {担当者} はその会社のものに差し替わります。", "保存する", async (w) => {
      const talks = j.labels.map((lb) => ({ label: lb, body: w.querySelector(`[data-tk="${lb}"]`).value }));
      if (!talks.some((t) => t.body.trim())) throw new Error("トークを1本は書いてください（トークが無いとこのリストはかけられません）");
      await api(`/api/mccall/lists/${l.id}/talks`, { method: "PUT", body: JSON.stringify({ talks }) });
      S.cache.clear(); toast("トークを保存しました（次に開く会社から使います）"); drawLists();
    }, `<div class="mcc-chips" style="margin-top:12px" role="tablist">${j.labels.map((lb, i) => `<button class="mcc-chip" data-tkt="${lb}" aria-pressed="${i === 0}">トーク ${lb}${cur.has(lb) ? "" : "（なし）"}</button>`).join("")}</div>
      ${j.labels.map((lb, i) => `<label class="mcc-field" data-tkp="${lb}" style="margin-top:8px" ${i ? "hidden" : ""}>トーク ${lb}${hist(lb) ? `<small style="font-weight:600;color:var(--c-muted)">　${esc(hist(lb))}</small>` : ""}
        <textarea data-tk="${lb}" style="min-height:300px" placeholder="${i ? "比べたいときだけ書く（空なら使いません）" : "【受付】&#10;新卒採用のご担当者様はいらっしゃいますか。&#10;&#10;【担当者】&#10;{担当者}様、突然のお電話失礼いたします。"}">${esc((cur.get(lb) || {}).body || "")}</textarea></label>`).join("")}`);
    w.querySelectorAll("[data-tkt]").forEach((b) => b.addEventListener("click", () => {
      w.querySelectorAll("[data-tkt]").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
      w.querySelectorAll("[data-tkp]").forEach((p) => { p.hidden = p.dataset.tkp !== b.dataset.tkt; });
    }));
  }

  // ---- 施策（リスト×トーク×版）（2026-11-20 福井さん「どんなリストにどんなトークで行くのか」を科学できるように） ----
  //   消化率＝リストの会社のうち一度でもかけた割合。トーク実施率＝録音から読んだ「決めたトークを話せた割合」（担当者と話せた通話だけ）
  const MS = { from: "", to: "" };
  async function drawMeasures() {
    const box = $("mccAdmin");
    if (!MS.from) { const n = new Date(); MS.to = ymd(n); MS.from = ymd(new Date(n.getTime() - 29 * 86400e3)); }
    box.innerHTML = `<div class="mcc-card"><h2>施策（売り先×売り方）</h2>
      <p class="mcc-note">施策はリスト（売り先）とトーク（売り方）の組み合わせです。トークを直すと新しい版になり、版ごとに数字を分けて出します。</p>
      <div class="mcc-filters"><input type="date" class="mcc-sel" id="mccMf" value="${MS.from}" /><span>〜</span><input type="date" class="mcc-sel" id="mccMt" value="${MS.to}" /></div>
      <div id="mccMres"><p class="mcc-note">読み込んでいます…</p></div></div>`;
    const go = () => { MS.from = $("mccMf").value; MS.to = $("mccMt").value; drawMeasures(); };
    ["mccMf", "mccMt"].forEach((id) => $(id).addEventListener("change", go));
    let j; try { j = await api(`/api/mccall/measures?${new URLSearchParams({ from: MS.from, to: MS.to })}`); }
    catch (e) { $("mccMres").innerHTML = `<p class="mcc-note">読めませんでした：${esc(e.message)}</p>`; return; }
    const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
    const best = (ts) => { const ok = ts.filter((t) => t.active && t.calls >= 30); if (ok.length < 2) return null; return ok.reduce((a, b) => (b.apo / b.calls > a.apo / a.calls ? b : a)).talkId; };
    const R = j.research || {};
    $("mccMres").innerHTML = (j.items.length ? j.items.map((l) => { const b = best(l.talks); return `<div class="mcc-measure">
        <h3>${esc(l.name)}</h3>
        <div class="mcc-kpis"><div><small>消化率</small><b>${pct(l.touched, l.total)}</b><small>${l.touched} / ${l.total}社</small></div><div><small>企業調査ずみ</small><b>${pct(l.researched, l.total)}</b><small>${l.researched}社</small></div></div>
        <div class="mcc-tblwrap"><table class="mcc-tbl"><thead><tr><th>トーク</th><th class="num">コール</th><th class="num">会社数</th><th class="num">担当者と話せた</th><th class="num">アポ</th><th class="num">アポ率（コール）</th><th class="num">アポ率（担当者）</th><th class="num">断られた</th><th class="num">トーク実施率</th></tr></thead><tbody>
        ${l.talks.map((t) => `<tr class="${t.talkId && t.talkId === b ? "best" : ""}"><td>${t.label ? `<b>${esc(t.label)}</b> 第${t.ver}版${t.active ? "" : "<small>（前の版）</small>"}${t.talkId && t.talkId === b ? "<small>　いちばんアポ率が高い</small>" : ""}` : "<small>トークの記録なし（前の架電）</small>"}</td>
          <td class="num">${t.calls}</td><td class="num">${t.leads}</td><td class="num">${t.person}<small> ${pct(t.person, t.calls)}</small></td><td class="num apo">${t.apo}</td><td class="num">${pct(t.apo, t.calls)}</td><td class="num">${pct(t.apo, t.person)}</td><td class="num">${t.reject}</td>
          <td class="num">${t.adherence != null ? `${t.adherence}%<small> ${t.adhN}件</small>` : "—"}</td></tr>`).join("")}</tbody></table></div></div>`; }).join("")
      : '<p class="mcc-note">この期間の架電はありません。</p>') +
      `<p class="mcc-note" style="margin-top:12px">トーク実施率は、Zoom Phone の録音がある通話のうち担当者と話せたものから AI が読んでいます（録音が無い通話は数えません）。比べるときは、どちらのトークも30コール以上になってから見てください。</p>
       <p class="mcc-note">企業調査：今日 ${R.today || 0}件 / 1日の上限 ${R.daily || 0}件${R.gate === false ? "（いまは調べ終わる前の会社も出しています）" : ""}</p>`;
  }

  // ---- レポート（2026-11-18 福井さん。期間・人・リスト・日ごと）----
  const RP = { by: "user", from: "", to: "", list: "" };
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  async function drawReport() {
    const box = $("mccAdmin");
    if (!RP.from) { const n = new Date(); RP.to = ymd(n); RP.from = ymd(new Date(n.getTime() - 6 * 86400e3)); }
    const pre = (l, days) => { const n = new Date(); const f = days === "month" ? new Date(n.getFullYear(), n.getMonth(), 1) : days === "lastmonth" ? new Date(n.getFullYear(), n.getMonth() - 1, 1) : new Date(n.getTime() - days * 86400e3);
      const t = days === "lastmonth" ? new Date(n.getFullYear(), n.getMonth(), 0) : n; return `<button class="mcc-chip" data-pre="${ymd(f)}|${ymd(t)}" aria-pressed="${RP.from === ymd(f) && RP.to === ymd(t)}">${l}</button>`; };
    box.innerHTML = `<div class="mcc-card"><h2>レポート${S.admin ? "（全員）" : "（自分）"}</h2>
      <div class="mcc-filters">
        <input type="date" class="mcc-sel" id="mccRf" value="${RP.from}" /><span>〜</span><input type="date" class="mcc-sel" id="mccRt" value="${RP.to}" />
        <div class="mcc-chips">${pre("今日", 0)}${pre("7日", 6)}${pre("30日", 29)}${pre("今月", "month")}${pre("先月", "lastmonth")}</div>
        <select class="mcc-sel" id="mccRby">${[["user", "人ごと"], ["list", "リストごと"], ["day", "日ごと"]].map(([v, l]) => `<option value="${v}" ${RP.by === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select class="mcc-sel" id="mccRl"><option value="">リスト：すべて</option>${S.lists.map((l) => `<option value="${l.id}" ${String(RP.list) === String(l.id) ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select>
      </div><div id="mccRres"><p class="mcc-note">読み込んでいます…</p></div></div>`;
    const go = () => { RP.from = $("mccRf").value; RP.to = $("mccRt").value; RP.by = $("mccRby").value; RP.list = $("mccRl").value; drawReport(); };
    ["mccRf", "mccRt", "mccRby", "mccRl"].forEach((id) => $(id).addEventListener("change", go));
    box.querySelectorAll("[data-pre]").forEach((b) => b.addEventListener("click", () => { [RP.from, RP.to] = b.dataset.pre.split("|"); drawReport(); }));
    let j; try { j = await api(`/api/mccall/report?${new URLSearchParams({ from: RP.from, to: RP.to, by: RP.by, list: RP.list })}`); }
    catch (e) { $("mccRres").innerHTML = `<p class="mcc-note">読めませんでした：${esc(e.message)}</p>`; return; }
    const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");
    const row = (lbl, r, cls = "") => `<tr class="${cls}"><td>${esc(lbl)}</td><td class="num">${r.calls}</td><td class="num">${r.leads}</td><td class="num">${r.reached}<small> ${pct(r.reached, r.calls)}</small></td><td class="num">${r.person}<small> ${pct(r.person, r.calls)}</small></td>
      <td class="num apo">${r.apo}<small> ${pct(r.apo, r.calls)}</small></td><td class="num">${pct(r.apo, r.person)}</td><td class="num">${r.doc}</td><td class="num">${r.follow}</td><td class="num">${r.reject}</td><td class="num">${r.cross || ""}</td>
      <td class="num fill">${r.fill || 0}<small> ${r.calls ? (r.fill / r.calls).toFixed(2) : "—"}/コール</small></td><td class="num">${r.fillNew || 0}</td><td class="num">${r.fillFix || 0}</td><td class="num">${r.fillLeads || 0}</td><td class="num">${r.fillNoApo || 0}</td><td class="num">${r.invalid || 0}</td></tr>`;
    const T = j.total;
    $("mccRres").innerHTML = `<div class="mcc-kpis"><div><small>コール</small><b>${T.calls}</b></div><div><small>つながった率</small><b>${pct(T.reached, T.calls)}</b></div><div><small>担当者と話せた率</small><b>${pct(T.person, T.calls)}</b></div><div class="apo"><small>アポ</small><b>${T.apo}</b></div><div class="apo"><small>アポ率（コールあたり）</small><b>${pct(T.apo, T.calls)}</b></div><div><small>担当者と話せたうちのアポ</small><b>${pct(T.apo, T.person)}</b></div>
        <div class="fill" title="架電の内容から SF のリードの項目を埋めた・直した数"><small>SF 項目を埋めた</small><b>${T.fill || 0}</b></div><div class="fill"><small>うちアポ以外の架電で</small><b>${T.fillNoApo || 0}</b></div><div class="fill"><small>項目が埋まった会社</small><b>${T.fillLeads || 0}</b></div><div class="fill"><small>使えない番号を見つけた</small><b>${T.invalid || 0}</b></div></div>
      ${j.rows.length ? `<div class="mcc-tblwrap"><table class="mcc-tbl"><thead><tr><th>${{ user: "名前", list: "リスト", day: "日" }[j.by]}</th><th class="num">コール</th><th class="num">会社数</th><th class="num">つながった</th><th class="num">担当者と話せた</th><th class="num">アポ</th><th class="num">話せたうちアポ</th><th class="num">資料</th><th class="num">フォロー</th><th class="num">断り</th><th class="num">部署をまたぐ</th><th class="num fill" title="架電の内容から SF のリードの項目を埋めた・直した数（1項目＝1）">SF 項目</th><th class="num" title="空だった項目を埋めた">うち新規</th><th class="num" title="古い値を直した・課題感などに足した">うち更新</th><th class="num" title="項目を1つでも埋めた会社の数">会社</th><th class="num" title="アポにならなかった架電で埋めた数">アポ以外</th><th class="num" title="「番号が使えない」と記録した数">使えない番号</th></tr></thead>
        <tbody>${j.rows.map((r) => row(r.label, r)).join("")}${j.rows.length > 1 ? row("合計", T, "sum") : ""}</tbody></table></div>` : '<p class="mcc-note">この期間の記録はありません。</p>'}
      ${j.reasons.length ? `<h3 style="margin-top:16px">断られた理由</h3><div class="mcc-chips">${j.reasons.map((r) => `<span class="mcc-chip" style="cursor:default">${esc(r.k)} ${r.n}</span>`).join("")}</div>` : ""}
      ${j.fields && j.fields.length ? `<h3 style="margin-top:16px">埋めた SF の項目</h3><div class="mcc-chips">${j.fields.map((r) => `<span class="mcc-chip" style="cursor:default">${esc(r.k)} ${r.n}</span>`).join("")}</div>` : ""}
      <p class="mcc-note" style="margin-top:12px">SF 項目：架電の内容（ヒアリング・受付で聞けたこと・断り理由・メモ）から SF のリードに入れた項目の数です。空を埋めた・古い値を直した・課題感などに足したものを1項目1つで数え、SF と同じ値の確認は数えません。取り消した記録の分は外します。</p>
      <p class="mcc-note" style="margin-top:12px">数えているのは MOCHICALL で記録したものだけです（Bales で記録した過去の架電は入りません）。取り消した記録は数えません。</p>`;
  }
  async function listDialog(l) {
    let reps = []; try { reps = (await api("/api/mochica/reps")).items || []; } catch {}
    const sel = new Set((l && l.members) || []);
    const w = dialog(l ? `「${l.name}」のメンバー` : "新しいリスト", l ? "かけられる人を選びます。だれも選ばないと MOCHICA のメンバー全員です。" : "名前を付けて、かけられる人を選びます。リードはあとで Bales・CSV・DOC から足します。", l ? "保存する" : "作る", async (w) => {
      const name = w.querySelector("#mccLName") ? w.querySelector("#mccLName").value.trim() : l.name;
      const members = [...w.querySelectorAll("[data-m][aria-pressed=true]")].map((b) => b.dataset.m);
      if (!name) throw new Error("リストの名前を入れてください");
      if (l) await api(`/api/mccall/lists/${l.id}`, { method: "PATCH", body: JSON.stringify({ members }) }); else await post("/api/mccall/lists", { name, members });
      drawLists();
    }, `${l ? "" : `<label class="mcc-field" style="margin-top:12px">リストの名前<input id="mccLName" autocomplete="off" /></label>`}
      <div class="mcc-field" style="margin-top:12px">メンバー（MOCHICA の人が先に並びます）<div class="mcc-members">${reps.map((r) => `<button class="mcc-chip" data-m="${esc(r.email)}" aria-pressed="${sel.has(r.email)}">${esc(r.name)}${r.intern ? "（インターン）" : r.mochica ? "" : "（MOCHICA 以外）"}</button>`).join("")}</div></div>`);
    w.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true")));
  }
  function importDone(text, r) {
    if (!r.dup && !r.nokey) { toast(text); return; }
    const noKey = r.nokey ? `${r.dup ? "また、" : ""}会社名が無い、または電話番号・メール・Web ページ・法人番号がどれも無い ${r.nokey}件は、重複かどうか判定できないまま入れました（「情報を直す」で足すと判定されます）。` : "";
    dialog("取り込みました", `${text}。${r.dup ? `リードの重複は作らない決まりなので、会社名が同じで、電話番号・メールアドレス・Web ページ・法人番号のどれかも同じ MOCHICA のリード（終わったもの・閉じたリストも含む）がある ${r.dup}件は入れていません。` : ""}${noKey}`, "閉じる", () => {},
      r.examples && r.examples.length ? `<p class="mcc-note" style="margin-top:8px">例：</p><ul class="mcc-note">${r.examples.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
  }
  async function balesDialog(listId) {
    let bl = []; try { bl = ((await api("/api/mochica/bales/lists")).items || []).filter((x) => x.status !== "running"); } catch {}
    dialog("Bales のリストから足す", "ホットな順に足します。ほかの開いている MOCHICA のリストに入っているリードと、アプローチ禁止の会社は足しません。", "足す", async (w) => {
      const r = await post(`/api/mccall/lists/${listId}/from-bales`, { listKey: w.querySelector("#mccBl").value, hot: w.querySelector("#mccBh").value, limit: w.querySelector("#mccBn").value });
      importDone(`${r.added}件 足しました${r.banned ? `・アプローチ禁止 ${r.banned}件は外しました` : ""}${r.bad ? `・会社名も電話番号も無い ${r.bad}件は読めませんでした` : ""}`, r); drawLists();
    }, bl.length ? `<label class="mcc-field" style="margin-top:12px">Bales のリスト<select class="mcc-sel" id="mccBl" style="max-width:none">${bl.map((x) => `<option value="${esc(x.list_key)}">${esc(x.name || x.list_key)}（${Number(x.count || 0).toLocaleString()}件）</option>`).join("")}</select></label>
      <label class="mcc-field" style="margin-top:8px">どれを足すか<select class="mcc-sel" id="mccBh" style="max-width:none"><option value="">すべて（ホットな順）</option><option value="warm+">ウォーム以上だけ</option><option value="hot">ホットだけ</option></select></label>
      <label class="mcc-field" style="margin-top:8px">件数（最大 5000）<input id="mccBn" type="number" min="1" max="5000" value="300" /></label>`
      : '<p class="mcc-note" style="margin-top:12px">Bales のリストがまだありません。「リスト（Bales Cloud）」で取り込んでください。</p>');
  }
  // CSV から足す（2026-11-18、2026-11-19 福井さん：形式がそろっていない CSV も自動で整えて取り込む）。
  // 列は「見出しの名前」→「中身の形（電話番号らしい・リードIDらしい…）」の順で見分ける。
  // どの列を何として読むか・どう整えるかは取り込む前の画面で変えられ、変えた対応はこのパソコンに覚えて次から自動で当てる。
  const CSV_FIELDS = [
    { k: "company", label: "会社名", re: /^(会社名|企業名|社名|法人名|会社|取引先名|取引先|顧客名|company|companyname|account|accountname)$/i,
      loose: /会社|企業|社名|法人|取引先|顧客|店舗|施設|company|account/i, fmts: [["corp", "（株）㈱ などを「株式会社」にそろえる"], ["raw", "そのまま"]] },
    { k: "phone", label: "電話番号", re: /^(電話番号|電話|代表電話|代表番号|tel|phone|電話番号1|companytel1|phonenumber|連絡先)$/i,
      loose: /電話|tel|phone/i, fmts: [["digits", "数字だけにする（消えた先頭の 0 も補う）"], ["half", "半角にするだけ（ハイフンは残す）"]] },
    { k: "person", label: "担当者名", re: /^(担当者名|担当者|氏名|名前|person|name|contact|targetname|取引先責任者|責任者)$/i,
      loose: /担当|氏名|名前|責任者|contact/i, fmts: [["space", "空白をそろえる"], ["raw", "そのまま"]] },
    { k: "sfLeadId", label: "リードID", re: /^(リードid|sfリードid|salesforceid|leadid|sfid|id)$/i,
      loose: /リードid|leadid/i, fmts: [["raw", "そのまま"]] },
  ];
  // 中身の形で見分けるための目印（見出しが無い・名前が違う CSV のため）
  const CSV_LOOKS = {
    phone: (v) => /^[\d\-‐ー－()（）+\s]+$/.test(v) && /^\d{9,11}$/.test(v.normalize("NFKC").replace(/\D/g, "").replace(/^81/, "0")),
    sfLeadId: (v) => /^00Q[0-9A-Za-z]{12,15}$/.test(v),
    company: (v) => /株式会社|有限会社|合同会社|合資会社|\(株\)|（株）|㈱|\(有\)|（有）|㈲|法人|組合|協会/.test(v),
  };
  const CSV_STORE = "mccCsvMap";
  const csvNorm = (h) => String(h || "").normalize("NFKC").replace(/[\s_\-()（）・]/g, "").toLowerCase();
  function csvMem() { try { return JSON.parse(localStorage.getItem(CSV_STORE) || "{}") || {}; } catch { return {}; } }
  function csvMemSave(m) { try { localStorage.setItem(CSV_STORE, JSON.stringify(m)); } catch {} }
  // 値の整え方。ここを変えれば整え方の種類を増やせる
  const CSV_FMT = {
    raw: (v) => v.trim(),
    half: (v) => v.normalize("NFKC").trim(),
    space: (v) => v.normalize("NFKC").replace(/\s+/g, " ").trim(),
    corp: (v) => v.normalize("NFKC").replace(/\s+/g, " ").trim()
      .replace(/\(株\)/g, "株式会社").replace(/\(有\)/g, "有限会社").replace(/\(合\)/g, "合同会社").replace(/\(社\)/g, "社団法人").replace(/\(財\)/g, "財団法人"),
    digits: (v) => {
      let d = v.normalize("NFKC").replace(/\D/g, "");
      if (/^81\d{9,10}$/.test(d)) d = "0" + d.slice(2);   // +81 で始まる国際表記
      if (/^[1-9]\d{8,9}$/.test(d)) d = "0" + d;          // Excel で先頭の 0 が消えたもの
      return d;
    },
  };
  function parseCsv(text) {
    const sep = (text.split(/\r?\n/, 1)[0] || "").includes("\t") ? "\t" : ",";
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
      if (ch === '"') q = true;
      else if (ch === sep) { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
  }
  async function readCsvFile(file) {
    const buf = await file.arrayBuffer();
    // UTF-8 として正しく読めなければ Shift_JIS（Excel の既定）で読み直す
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^﻿/, ""); }
    catch { try { return new TextDecoder("shift_jis").decode(buf); } catch { return new TextDecoder().decode(buf); } }
  }
  // 自動の見当：見出しの名前（覚えた名前 → 決まった名前）→ 中身の形
  function csvGuess(table) {
    const mem = csvMem(); const alias = mem.alias || {};
    const head = table[0].map(csvNorm);
    const map = {}; const used = new Set();
    for (const f of CSV_FIELDS) {
      const mine = (alias[f.k] || []);
      let i = head.findIndex((h, j) => !used.has(j) && h && mine.includes(h));
      if (i < 0) i = head.findIndex((h, j) => !used.has(j) && f.re.test(h));
      if (i >= 0) { map[f.k] = i; used.add(i); }
    }
    // 1行目そのものが電話番号・リードID・会社名に見えるなら、見出しの無い CSV とみなす（見出しで当てた分は捨てる）
    const hasHead = !table[0].some((c) => CSV_LOOKS.phone(c) || CSV_LOOKS.sfLeadId(c) || CSV_LOOKS.company(c));
    if (!hasHead) { for (const k of Object.keys(map)) delete map[k]; used.clear(); }
    // 名前が完全には一致しないとき（「顧客名称」「ご担当者」など）は、名前の一部で当てる。メール・FAX の列は電話や担当者に当てない
    for (const f of CSV_FIELDS) {
      if (!hasHead || map[f.k] != null) continue;
      const i = head.findIndex((h, j) => !used.has(j) && h && f.loose.test(h) && !/mail|メール|fax|ファックス|かな|カナ|ふりがな|フリガナ|部署|役職/i.test(h));
      if (i >= 0) { map[f.k] = i; used.add(i); }
    }
    const sample = (hasHead ? table.slice(1) : table).slice(0, 50);
    for (const k of ["sfLeadId", "phone", "company"]) {
      if (map[k] != null) continue;
      let best = -1, bestR = 0;
      for (let j = 0; j < table[0].length; j++) {
        if (used.has(j)) continue;
        const vals = sample.map((r) => r[j] || "").filter(Boolean); if (!vals.length) continue;
        const r = vals.filter(CSV_LOOKS[k]).length / vals.length;
        if (r > bestR) { bestR = r; best = j; }
      }
      if (best >= 0 && bestR >= 0.6) { map[k] = best; used.add(best); }
    }
    // 見出しが無く、会社名も形で見分けられないときは kincall と同じ「会社名・担当者名・電話番号」の順とみなす
    if (!hasHead && map.company == null && !used.has(0)) { map.company = 0; used.add(0); }
    if (!hasHead && map.person == null && !used.has(1) && table[0].length > 1) map.person = 1;
    const fmt = {}; for (const f of CSV_FIELDS) fmt[f.k] = (mem.fmt && f.fmts.some(([v]) => v === mem.fmt[f.k])) ? mem.fmt[f.k] : f.fmts[0][0];
    return { map, hasHead, fmt };
  }
  function csvToLeads(table, st) {
    const body = st.hasHead ? table.slice(1) : table;
    const used = new Set(Object.values(st.map).filter((i) => i != null));
    const get = (r, k) => st.map[k] != null ? CSV_FMT[st.fmt[k]](String(r[st.map[k]] || "")) : "";
    return body.map((r) => {
      const extra = {}; if (st.hasHead) table[0].forEach((h, i) => { if (!used.has(i) && h && r[i]) extra[h] = r[i]; });
      return { company: get(r, "company"), phone: get(r, "phone"), person: get(r, "person"), sfLeadId: get(r, "sfLeadId"), extra };
    }).filter((x) => x.company || x.phone);
  }
  // 取り込んだときの対応を覚える：見出しの名前をその項目の呼び名として足し、整え方も次の既定にする
  function csvRemember(table, st) {
    const mem = csvMem(); mem.alias = mem.alias || {}; mem.fmt = { ...st.fmt };
    if (st.hasHead) for (const f of CSV_FIELDS) {
      const i = st.map[f.k]; if (i == null) continue;
      const h = csvNorm(table[0][i]); if (!h || f.re.test(h)) continue;   // 決まった名前は覚えなくても当たる
      for (const k of Object.keys(mem.alias)) mem.alias[k] = mem.alias[k].filter((x) => x !== h);
      mem.alias[f.k] = [...(mem.alias[f.k] || []), h].slice(-30);
    }
    csvMemSave(mem);
  }
  function csvDialog(listId) {
    let table = null, st = null;
    const w = dialog("CSV から足す", "1行1社。列の並びや見出しの名前、電話番号の書き方がそろっていなくても、自動で見分けて整えます。読み方は下で変えられ、変えた対応はこのパソコンが覚えて次から自動で当てます。使わない列は詳細に残ります。ほかの開いている MOCHICA のリストにある番号と、アプローチ禁止の会社は足しません。", "足す", async () => {
      if (!table || !st) throw new Error("CSV ファイルを選んでください");
      if (st.map.company == null && st.map.phone == null) throw new Error("「会社名」か「電話番号」に使う列を選んでください");
      const leads = csvToLeads(table, st);
      if (!leads.length) throw new Error("読める行がありません（会社名も電話番号も空です）");
      if (leads.length > 5000) throw new Error(`一度に足せるのは 5000件までです（${leads.length}件あります）。分けて読み込んでください`);
      const r = await post(`/api/mccall/lists/${listId}/from-csv`, { rows: leads });
      csvRemember(table, st);
      importDone(`${r.added}件 足しました${r.banned ? `・アプローチ禁止 ${r.banned}件は外しました` : ""}${r.bad ? `・会社名も電話番号も無い ${r.bad}件は読めませんでした` : ""}${r.nolead ? `。うち ${r.nolead}件は SF のリードIDが無いため、架電結果は SF に書かれません` : ""}${r.sfPhone ? `。電話番号の無い行のうち ${r.sfPhone}件は SF から番号を補いました` : ""}${r.nophone ? `。${r.nophone}件は電話番号が見つからないまま入れました（架電画面の「直す」で入れてください）` : ""}${r.sfError ? `。SF に届かず電話番号を補えませんでした（${r.sfError}）` : ""}`, r);
      drawLists();
    }, `<label class="mcc-field" style="margin-top:12px">CSV ファイル<input type="file" id="mccCsvF" accept=".csv,.tsv,.txt,text/csv" /></label><div id="mccCsvM"></div><p class="mcc-note" id="mccCsvP" style="margin-top:6px"></p>`);
    const box = w.querySelector("#mccCsvM"), p = w.querySelector("#mccCsvP");
    const colName = (i) => st.hasHead ? (table[0][i] || `${i + 1}列目`) : `${i + 1}列目`;
    const firstVal = (i) => { const r = (st.hasHead ? table[1] : table[0]) || []; return r[i] || ""; };
    function preview() {
      const leads = csvToLeads(table, st);
      const miss = st.map.phone == null ? "。電話番号の列が選ばれていません" : "";
      const ex = leads.slice(0, 3);
      p.innerHTML = `${leads.length}件 読めます${esc(miss)}${ex.length ? `<table class="mcc-tbl" style="margin-top:6px"><thead><tr>${CSV_FIELDS.map((f) => `<th>${esc(f.label)}</th>`).join("")}</tr></thead><tbody>${ex.map((x) => `<tr>${CSV_FIELDS.map((f) => `<td>${esc(x[f.k] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table>` : ""}`;
    }
    function draw() {
      const n = Math.max(...table.slice(0, 20).map((r) => r.length));
      box.innerHTML = `<div class="mcc-field" style="margin-top:10px">読み方（取り込み元の列 → 取り込み先の項目・整え方）</div>
        <label class="mcc-note" style="display:flex;gap:6px;align-items:center;margin:4px 0"><input type="checkbox" id="mccCsvH" ${st.hasHead ? "checked" : ""} />1行目は見出し</label>
        <table class="mcc-tbl"><thead><tr><th>取り込み先</th><th>取り込み元の列</th><th>整え方</th></tr></thead><tbody>
        ${CSV_FIELDS.map((f) => `<tr><td>${esc(f.label)}</td>
          <td><select class="mcc-sel" data-cm="${f.k}" style="max-width:none"><option value="">（使わない）</option>${Array.from({ length: n }, (_, i) => `<option value="${i}" ${st.map[f.k] === i ? "selected" : ""}>${esc(colName(i))}${firstVal(i) ? `（例：${esc(String(firstVal(i)).slice(0, 20))}）` : ""}</option>`).join("")}</select></td>
          <td>${f.fmts.length > 1 ? `<select class="mcc-sel" data-cf="${f.k}" style="max-width:none">${f.fmts.map(([v, l]) => `<option value="${v}" ${st.fmt[f.k] === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>` : `<span class="mcc-note">${esc(f.fmts[0][1])}</span>`}</td></tr>`).join("")}
        </tbody></table>
        <button type="button" class="mcc-btn" id="mccCsvReset" style="margin-top:6px">覚えた読み方を消す</button>`;
      box.querySelector("#mccCsvH").addEventListener("change", (e) => { st.hasHead = e.target.checked; draw(); });
      box.querySelectorAll("[data-cm]").forEach((s) => s.addEventListener("change", () => {
        const k = s.dataset.cm, v = s.value === "" ? null : +s.value;
        // 同じ列を2つの項目に当てないよう、ほかの項目から外す
        if (v != null) for (const kk of Object.keys(st.map)) if (kk !== k && st.map[kk] === v) delete st.map[kk];
        if (v == null) delete st.map[k]; else st.map[k] = v;
        draw();
      }));
      box.querySelectorAll("[data-cf]").forEach((s) => s.addEventListener("change", () => { st.fmt[s.dataset.cf] = s.value; preview(); }));
      box.querySelector("#mccCsvReset").addEventListener("click", () => { csvMemSave({}); st = csvGuess(table); draw(); toast("覚えた読み方を消しました"); });
      preview();
    }
    w.querySelector("#mccCsvF").addEventListener("change", async (e) => {
      const f = e.target.files[0]; table = null; st = null; box.innerHTML = ""; p.textContent = ""; if (!f) return;
      try {
        table = parseCsv(await readCsvFile(f));
        if (!table.length) { table = null; p.textContent = "中身が空です"; return; }
        st = csvGuess(table); draw();
      } catch (err) { p.textContent = `読めませんでした：${err.message}`; }
    });
  }
  async function docDialog(listId) {
    let dl = []; try { dl = (await api("/api/mccall/doc/lists")).items || []; } catch (e) { toast(e.message); return; }
    dialog("DOC のリストから持ってくる（部署をまたぐ）", "DOC の kincall のリストのリード（まだ終わっていないもの）を、このリストに写します。DOC 側のリストは変えません。持ってきたことは「部署をまたいだ記録」に、だれが・いつ・なぜ と一緒に残ります。", "持ってくる", async (w) => {
      const reason = w.querySelector("#mccDr").value.trim(); if (!reason) throw new Error("部署をまたぐ理由を入れてください");
      const r = await post(`/api/mccall/lists/${listId}/from-doc`, { docListId: w.querySelector("#mccDl").value, reason });
      importDone(`DOC から ${r.added}件 持ってきました${r.banned ? `（アプローチ禁止 ${r.banned}件は外しました）` : ""}`, r); drawLists();
    }, `<label class="mcc-field" style="margin-top:12px">DOC のリスト<select class="mcc-sel" id="mccDl" style="max-width:none">${dl.map((x) => `<option value="${x.id}">${esc(x.name)}（残り ${x.open}件）</option>`).join("")}</select></label>
      <label class="mcc-field" style="margin-top:8px">理由（必須）<textarea id="mccDr" placeholder="例：DOC で失注した企業に MOCHICA を提案するため"></textarea></label>`);
  }
  // リードの割り振り・他のリストへ移す（2026-11-17 福井さん。kincall で多く使われていた2つを MOCHICA にも）
  // 選んだものだけが対象。割り振りだけは、選ばなければリストの残り全部を分ける（kincall の「複数人に分ける」と同じ使い方）。
  // back：戻る先（リード管理から開いたときはリード管理へ戻す。中で配り直したあとも同じ戻り先を使う）
  async function drawLeads(l, back) {
    if (!l) return;
    if (back) S.ldBack = back;
    const goBack = S.ldBack || drawLists;
    const box = $("mccAdmin"); box.innerHTML = `<div class="mcc-card">読み込んでいます…</div>`;
    let j, reps = [];
    try { [j, reps] = await Promise.all([api(`/api/mccall/lists/${l.id}/leads`), api("/api/mochica/reps").then((r) => r.items || []).catch(() => [])]); }
    catch (e) { box.innerHTML = `<div class="mcc-card">読めませんでした：${esc(e.message)}</div>`; return; }
    // 配れる人＝このリストのメンバー（決まっていなければ MOCHICA の人）。それ以外に配ると、その人の「かける」にリストが出ない
    const mem = (l.members || []).map((x) => String(x).toLowerCase());
    const who = mem.length ? reps.filter((r) => mem.includes(String(r.email).toLowerCase())) : reps.filter((r) => r.mochica);
    const others = S.lists.filter((x) => x.id !== l.id);
    const sel = new Set();
    box.innerHTML = `<div class="mcc-card">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><button class="mcc-btn" id="mccLdBack">${ICO.back}${S.ldBack ? "リード管理へ" : "リストの一覧へ"}</button><h2 style="margin:0">「${esc(l.name)}」のリード</h2><span class="mcc-note" style="margin:0">残り ${j.total}件${j.total > j.items.length ? `（上から ${j.items.length}件を表示）` : ""}</span></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0"><span class="mcc-note" id="mccLdN" style="margin:0">選んでいません（割り振りは残り全部が対象）</span>
          <button class="mcc-btn primary" id="mccLdAssign">複数人に分ける</button><button class="mcc-btn primary" id="mccLdSeg">条件で割り振る</button><button class="mcc-btn" id="mccLdMove" ${others.length ? "" : 'disabled title="ほかに開いているリストがありません"'}>選んだリードを他のリストへ移す</button></div>
        ${j.items.length ? `<table class="mcc-tbl"><thead><tr><th><input type="checkbox" id="mccLdAll" aria-label="全部選ぶ" /></th><th>会社</th><th>担当者</th><th>温度</th><th class="num">回数</th><th>前回</th><th>割り振り</th></tr></thead><tbody>
          ${j.items.map((r) => `<tr><td><input type="checkbox" data-ld="${r.id}" aria-label="${esc(r.company || "")}を選ぶ" /></td><td>${esc(r.company || "")}</td><td>${esc(r.person || "")}</td><td>${hotBadge(r.hot)}</td><td class="num">${r.attempts || 0}</td><td>${esc(r.outcome || "")}</td><td>${esc(r.assigned || "")}</td></tr>`).join("")}</tbody></table>` : '<p class="mcc-note">終わっていないリードがありません。</p>'}</div>`;
    const cnt = () => { $("mccLdN").textContent = sel.size ? `${sel.size}件 選んでいます` : "選んでいません（割り振りは残り全部が対象）"; };
    box.querySelectorAll("[data-ld]").forEach((c) => c.addEventListener("change", () => { c.checked ? sel.add(+c.dataset.ld) : sel.delete(+c.dataset.ld); cnt(); }));
    const all = $("mccLdAll"); if (all) all.addEventListener("change", () => { box.querySelectorAll("[data-ld]").forEach((c) => { c.checked = all.checked; all.checked ? sel.add(+c.dataset.ld) : sel.delete(+c.dataset.ld); }); cnt(); });
    $("mccLdBack").addEventListener("click", () => goBack());
    $("mccLdAssign").addEventListener("click", () => {
      const n = sel.size || j.total;
      const w = dialog("複数人に分ける", `${sel.size ? "選んだ" : "残り全部の"} ${n}件を、選んだ人で均等に分けます（ホットなリードが偏らないよう交互に配ります）。だれも選ばずに進むと、割り振りを外して全員がかけられる状態に戻します。`, "分ける", async (w) => {
        const members = [...w.querySelectorAll("[data-m][aria-pressed=true]")].map((b) => b.dataset.m);
        const r = await post(`/api/mccall/lists/${l.id}/assign`, { members, leadIds: [...sel] });
        toast(r.per && r.per.length ? `${r.assigned}件を分けました：${r.per.map((p) => `${p.name} ${p.n}件`).join("・")}` : `${r.cleared}件の割り振りを外しました`);
        drawLeads(l);
      }, who.length ? `<div class="mcc-field" style="margin-top:12px">分ける人<div class="mcc-members">${who.map((r) => `<button class="mcc-chip" data-m="${esc(r.email)}" aria-pressed="false">${esc(r.name)}${r.intern ? "（インターン）" : ""}</button>`).join("")}</div></div>`
        : '<p class="mcc-note" style="margin-top:12px">配れる人がいません。先に「メンバー」でこのリストのメンバーを選んでください。</p>');
      w.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true")));
    });
    $("mccLdSeg").addEventListener("click", () => segAssign(l, who));
    $("mccLdMove").addEventListener("click", () => {
      if (!sel.size) { toast("移すリードを、左のチェックで選んでください"); return; }
      dialog("選んだリードを他のリストへ移す", `${sel.size}件を移します。移したリードの割り振りは外れます（移し先のメンバーがかけます）。これまでの架電の記録は消えません。移し先に同じリードがあるものは移しません。`, "移す", async (w) => {
        const r = await post(`/api/mccall/lists/${l.id}/move`, { toListId: w.querySelector("#mccLdTo").value, leadIds: [...sel] });
        toast(`${r.moved}件 移しました${r.skipped ? `（移し先に同じリードがある ${r.skipped}件は移していません）` : ""}`);
        await loadLists(); drawLeads(S.lists.find((x) => x.id === l.id) || l);
      }, `<label class="mcc-field" style="margin-top:12px">移し先のリスト<select class="mcc-sel" id="mccLdTo" style="max-width:none">${others.map((x) => `<option value="${x.id}">${esc(x.name)}（残り ${x.open}件）</option>`).join("")}</select></label>`);
    });
  }
  // 条件の選び方（2026-11-19 福井さん「SHOBO のリスト管理を kinbot 準拠で」）。「条件で割り振る」と「SHOBO から足す」で同じものを使う。
  //   2026-11-20 福井さん：ASUMO /teleapo の絞り込み条件にそろえた（キーワード・すべて／どれか・架電回数と採用人数の範囲・隠す・並べ替え・CSV）。
  //   選ぶたびにその場で数え直す。同じ項目の中は「どれか」、項目どうしは「すべて」（切り替えで「どれか」）に当てはまるもの。
  //   選んだ条件はこの端末に残す（開き直しても同じ条件から始められるように。「クリア」で既定に戻す）
  //   o.url：数える API、o.body()：数えるときに一緒に送るもの、o.after(s)：数え終わったあとの処理（試算など）
  const SEG_KEY = "shobo_seg_filters";
  const SEG_ORDER = ["origin", "list", "source", "stage", "gyokai", "category", "gyoshu", "roles", "pref", "city", "owner", "research", "phone", "competitor", "due", "followup",
    "hireSource", "lastResult", "decline", "last", "hot", "conds", "segments", "pains", "budget", "renewal", "lost"];
  const SEG_SCALAR = ["q", "mode", "callsMin", "callsMax", "hireMin", "hireMax", "hideDnc", "hideTouched", "hideSfTouched", "sort", "dir"];
  function segPicker(w, o) {
    let saved = {}; try { saved = JSON.parse(localStorage.getItem(SEG_KEY) || "{}") || {}; } catch {}
    const f = { conds: [] };
    for (const k of [...SEG_ORDER, ...SEG_SCALAR]) if (saved[k] != null) f[k] = saved[k];
    if (!Array.isArray(f.conds)) f.conds = [];
    let seq = 0, timer = 0, last = null;
    const openSet = new Set(["origin", "source"]);   // 開いている項目は、数え直したあとも開いたままにする
    const save = () => { try { localStorage.setItem(SEG_KEY, JSON.stringify(f)); } catch {} };
    const ctl = w.querySelector("#mcsCtl");
    const num = (id, ph) => `<input type="number" id="${id}" min="0" max="99999" placeholder="${ph}" style="width:64px" />`;
    ctl.innerHTML = `
      <input class="mcc-sel" id="mcsQ" style="max-width:none;width:100%" autocomplete="off" placeholder="会社名・担当者・電話・業種・所在地・企業調査・架電メモで探す" />
      <div style="display:flex;gap:10px 14px;align-items:center;flex-wrap:wrap;margin-top:8px">
        <label class="mcc-note" style="margin:0">項目どうしは <select class="mcc-sel" id="mcsMode" style="height:30px"><option value="all">すべてに当てはまる</option><option value="any">どれかに当てはまる</option></select></label>
        <label class="mcc-note" style="margin:0">架電回数 ${num("mcsCMin", "下限")} 〜 ${num("mcsCMax", "上限")} 回</label>
        <label class="mcc-note" style="margin:0">採用人数 ${num("mcsHMin", "下限")} 〜 ${num("mcsHMax", "上限")} 名</label>
        <span class="mcc-chips" id="mcsHPre">${[["〜5名", "", 5], ["6名以上", 6, ""], ["11名以上", 11, ""], ["31名以上", 31, ""]].map(([t, a, b]) => `<button type="button" class="mcc-chip" data-hmin="${a}" data-hmax="${b}" style="height:26px">${t}</button>`).join("")}</span>
      </div>
      <div style="display:flex;gap:6px 14px;align-items:center;flex-wrap:wrap;margin-top:8px">
        <label class="mcc-note" style="margin:0"><input type="checkbox" id="mcsDnc" /> アプローチ禁止を隠す</label>
        <label class="mcc-note" style="margin:0"><input type="checkbox" id="mcsTouched" /> 接触履歴ありを隠す</label>
        <label class="mcc-note" style="margin:0"><input type="checkbox" id="mcsSf" /> 直近14日に SF で他の人が接触した会社を隠す</label>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px">
        <label class="mcc-note" style="margin:0">並べ替え <select class="mcc-sel" id="mcsSort" style="height:30px"><option value="default">既定（ホット → 最後にかけた日が古い順）</option></select></label>
        <button type="button" class="mcc-btn" id="mcsDir" style="height:30px" title="昇順・降順を切り替える"></button>
        <button type="button" class="mcc-btn" id="mcsCsv" style="height:30px" title="いまの条件と並び順のまま、合うリードを CSV に書き出す">CSV</button>
        <button type="button" class="mcc-btn" id="mcsClr" style="height:30px" title="条件と並び順を既定に戻す">クリア</button>
      </div>
      <div class="mcc-chips" id="mcsAct" style="margin-top:8px"></div>`;
    const $c = (s) => ctl.querySelector(s);
    const NUMS = [["#mcsCMin", "callsMin"], ["#mcsCMax", "callsMax"], ["#mcsHMin", "hireMin"], ["#mcsHMax", "hireMax"]];
    const CHECKS = [["#mcsDnc", "hideDnc"], ["#mcsTouched", "hideTouched"], ["#mcsSf", "hideSfTouched"]];
    function fillCtl() {
      $c("#mcsQ").value = f.q || ""; $c("#mcsMode").value = f.mode === "any" ? "any" : "all";
      for (const [s, k] of NUMS) $c(s).value = f[k] ?? "";
      for (const [s, k] of CHECKS) $c(s).checked = !!f[k];
      $c("#mcsSort").value = f.sort || "default";
      const dflt = !f.sort || f.sort === "default"; $c("#mcsDir").disabled = dflt;
      $c("#mcsDir").textContent = dflt ? "順：既定" : f.dir === "desc" ? "降順" : f.dir === "asc" ? "昇順" : "順：おすすめ";
    }
    $c("#mcsQ").addEventListener("input", (e) => { f.q = e.target.value; later(); });
    $c("#mcsMode").addEventListener("change", (e) => { f.mode = e.target.value; later(); });
    for (const [s, k] of NUMS) $c(s).addEventListener("input", (e) => { f[k] = e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value, 10) || 0); later(); });
    for (const [s, k] of CHECKS) $c(s).addEventListener("change", (e) => { f[k] = e.target.checked; later(); });
    $c("#mcsHPre").addEventListener("click", (e) => { const b = e.target.closest("[data-hmin]"); if (!b) return;
      f.hireMin = b.dataset.hmin === "" ? "" : +b.dataset.hmin; f.hireMax = b.dataset.hmax === "" ? "" : +b.dataset.hmax; fillCtl(); later(); });
    $c("#mcsSort").addEventListener("change", (e) => { f.sort = e.target.value; f.dir = ""; fillCtl(); later(); });
    $c("#mcsDir").addEventListener("click", () => { f.dir = f.dir === "asc" ? "desc" : "asc"; fillCtl(); later(); });
    $c("#mcsClr").addEventListener("click", () => { for (const k of Object.keys(f)) delete f[k]; f.conds = []; fillCtl(); later(); });
    $c("#mcsCsv").addEventListener("click", async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = "書き出しています…";
      try {
        const r = await post(o.url, { ...(o.body ? o.body() : {}), filters: f, csv: true });
        const head = ["会社名", "担当者", "電話", "架電回数", "次アクション期限", "最終架電", ...Object.values(r.labels)];
        const keys = Object.keys(r.labels);
        const cell = (v) => { const s = String(v ?? ""); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        const lines = [head, ...r.rows.map((x) => [x.company, x.person, x.phone, x.attempts, x.next_at ? tm(x.next_at) : "", x.last_ts ? tm(x.last_ts) : "", ...keys.map((k) => x[k])])].map((a) => a.map(cell).join(","));
        const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" }));
        const a = document.createElement("a"); a.href = url; a.download = `SHOBO_条件に合うリード_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
        toast(`${r.rows.length.toLocaleString()}件を書き出しました${r.rows.length >= 20000 ? "（2万件で打ち切りました。条件を絞ってください）" : ""}`);
      } catch (err) { toast(`書き出せませんでした：${err.message}`); }
      finally { b.disabled = false; b.textContent = "CSV"; }
    });
    // 選んでいる条件をチップで並べる（畳んだ項目の中で何を選んでいるか見えるように）。押すとその条件だけ外す
    function drawActive(s) {
      const items = [];
      const lbl = (k) => (k === "conds" ? "ホットの条件" : (s.dims[k] && s.dims[k].label) || k);
      for (const k of SEG_ORDER) for (const v of (Array.isArray(f[k]) ? f[k] : [])) {
        const it = k === "conds" ? (s.conds || []).find((c) => c.k === v) : ((s.dims[k] || {}).items || []).find((x) => x.v === v);
        items.push([`a:${k}:${v}`, `${lbl(k)}：${(it && it.label) || v}`]);
      }
      if (f.q) items.push(["s:q", `キーワード：${f.q}`]);
      const rng = (a, b, u) => `${a !== "" && a != null ? a : ""}〜${b !== "" && b != null ? b : ""}${u}`;
      if ((f.callsMin ?? "") !== "" || (f.callsMax ?? "") !== "") items.push(["r:calls", `架電回数：${rng(f.callsMin, f.callsMax, "回")}`]);
      if ((f.hireMin ?? "") !== "" || (f.hireMax ?? "") !== "") items.push(["r:hire", `採用人数：${rng(f.hireMin, f.hireMax, "名")}`]);
      if (f.hideDnc) items.push(["s:hideDnc", `アプローチ禁止を隠す${s.banned != null ? `（${s.banned}件）` : ""}`]);
      if (f.hideTouched) items.push(["s:hideTouched", "接触履歴ありを隠す"]);
      if (f.hideSfTouched) items.push(["s:hideSfTouched", "SF で他の人が接触した会社を隠す"]);
      $c("#mcsAct").innerHTML = items.length ? `<span class="mcc-note" style="margin:0;align-self:center">かけている条件 ${items.length}つ${f.mode === "any" ? "（どれかに当てはまる）" : ""}</span>` +
        items.map(([id, t]) => `<button type="button" class="mcc-chip" aria-pressed="true" data-off="${esc(id)}" style="height:26px" title="この条件を外す">${esc(t)} ×</button>`).join("") : "";
      $c("#mcsAct").querySelectorAll("[data-off]").forEach((b) => b.addEventListener("click", () => {
        const [t, k, ...rest] = b.dataset.off.split(":"); const v = rest.join(":");
        if (t === "a") { f[k] = (f[k] || []).filter((x) => x !== v); if (k === "pref") dropCities(); }
        else if (t === "r") { f[`${k}Min`] = ""; f[`${k}Max`] = ""; } else f[k] = k === "q" ? "" : false;
        fillCtl(); later();
      }));
    }
    // 都道府県を外したら、その県の市区町村の選択も外す
    const dropCities = () => { const ps = f.pref || []; f.city = (f.city || []).filter((c) => ps.some((p) => c.startsWith(p))); };
    async function refresh() {
      const my = ++seq; save();
      try {
        const s = await post(o.url, { ...(o.body ? o.body() : {}), filters: f });
        if (my !== seq || !w.isConnected) return;
        last = s;
        const sel = $c("#mcsSort"); if (s.sorts && sel.options.length <= 1) { sel.innerHTML = s.sorts.map((x) => `<option value="${esc(x.k)}">${esc(x.label)}</option>`).join(""); fillCtl(); }
        w.querySelector("#mcsSum").textContent = `条件に合うリード ${s.matched}件（まだ割り振っていない ${s.free}件）${s.prefByTel ? `　※都道府県のうち ${s.prefByTel}件は住所が無いため電話番号の市外局番から推し量っています` : ""}`;
        const chip = (k, v, n, on, label = v) => `<button class="mcc-chip" data-k="${k}" data-v="${esc(v)}" aria-pressed="${on}">${esc(label)} <small style="opacity:.75">${n}</small></button>`;
        const sec = (k, label, inner, cnt) => `<details data-sec="${k}" ${openSet.has(k) ? "open" : ""} style="border-top:1px solid var(--c-line);padding:8px 0"><summary style="cursor:pointer;font-weight:700;font-size:13px">${esc(label)}${cnt ? `<span class="mcc-badge" style="margin-left:6px">${cnt}つ選択</span>` : ""}</summary><div class="mcc-chips" style="margin-top:8px;max-height:180px;overflow:auto">${inner}</div></details>`;
        let html = "";
        for (const k of SEG_ORDER) {
          if (k === "conds") { html += sec("conds", "ホットの条件（そろっているもの）", s.conds.map((c) => chip("conds", c.k, c.n, f.conds.includes(c.k), c.label)).join(""), f.conds.length); continue; }
          const d = s.dims[k]; if (!d) continue; const sl = f[k] || [];
          if (d.needs && !(f[d.needs] || []).length) continue;   // 市区町村は、都道府県を選んだときだけ出す
          // 選んだのに件数が0になった値も、外せるように残す
          const items = [...d.items, ...sl.filter((v) => !d.items.some((x) => x.v === v)).map((v) => ({ v, n: 0 }))];
          html += sec(k, d.label, items.length ? items.map((x) => chip(k, x.v, x.n, sl.includes(x.v), x.label || x.v)).join("") : '<span class="mcc-note">ありません</span>', sl.length);
        }
        const box = w.querySelector("#mcsDims"); box.innerHTML = html;
        box.querySelectorAll("details").forEach((d) => d.addEventListener("toggle", () => { d.open ? openSet.add(d.dataset.sec) : openSet.delete(d.dataset.sec); }));
        box.querySelectorAll("[data-k]").forEach((b) => b.addEventListener("click", () => {
          const k = b.dataset.k, v = b.dataset.v; const a = f[k] || (f[k] = []);
          const i = a.indexOf(v); i >= 0 ? a.splice(i, 1) : a.push(v); b.setAttribute("aria-pressed", i >= 0 ? "false" : "true");
          if (k === "pref") { dropCities(); if (f.pref.length) openSet.add("city"); }
          later();
        }));
        drawActive(s);
        if (o.after) await o.after(s);
      } catch (e) { if (my === seq && w.isConnected) w.querySelector("#mcsSum").textContent = `数えられませんでした：${e.message}`; }
    }
    const later = () => { clearTimeout(timer); timer = setTimeout(refresh, 250); };
    fillCtl(); refresh();
    return { filters: f, later };
  }
  const SEG_HTML = `<div id="mcsCtl" style="margin-top:10px"></div><p class="mcc-note" id="mcsSum" style="font-weight:700;color:var(--c-deep);margin-top:8px">数えています…</p><div id="mcsDims"></div>`;

  // 条件で割り振る：絞ったリードを、選んだ人に 1人 N件ずつ（ホット → 最後にかけた日が古い順に交互に）配る。
  //   まだ割り振っていないものだけを配るのが既定（今の担当を上書きしないため）。配る前に「だれに何件」を見せる
  function segAssign(l, who) {
    let pk = null;
    const chosen = () => [...w.querySelectorAll("[data-m][aria-pressed=true]")].map((b) => b.dataset.m);
    const body = (members, dryRun) => ({ filters: pk.filters, members, per: parseInt(w.querySelector("#mcsPer").value, 10) || 0, onlyFree: w.querySelector("#mcsFree").checked, dryRun });
    const w = dialog("条件で割り振る", "条件を選ぶと、合うリードの数がすぐに変わります。同じ項目の中は「どれか」、項目どうしは「すべて」に当てはまるものを配ります。ホット → 最後にかけた日が古い順に、選んだ人へ交互に配ります。", "割り振る", async () => {
      const members = chosen(); if (!members.length) throw new Error("配る人を選んでください");
      const r = await post(`/api/mccall/lists/${l.id}/assign`, body(members, false));
      toast(`${r.assigned}件を割り振りました：${r.per.map((p) => `${p.name} ${p.n}件`).join("・")}`);
      drawLeads(l);
    }, `${SEG_HTML}
      <div class="mcc-field" style="margin-top:12px">配る人${who.length ? `<div class="mcc-members">${who.map((r) => `<button class="mcc-chip" data-m="${esc(r.email)}" aria-pressed="false">${esc(r.name)}${r.intern ? "（インターン）" : ""}</button>`).join("")}</div>` : '<p class="mcc-note">配れる人がいません。先に「メンバー」でこのリストのメンバーを選んでください。</p>'}</div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px"><label class="mcc-note" style="margin:0">1人あたり <input type="number" id="mcsPer" min="0" max="5000" placeholder="全部" style="width:80px" /> 件（空なら合うものを全部、均等に）</label>
        <label class="mcc-note" style="margin:0"><input type="checkbox" id="mcsFree" checked /> まだ割り振っていないものだけ</label></div>
      <p class="mcc-note" id="mcsPlan" style="margin-top:8px"></p>`);
    pk = segPicker(w, { url: `/api/mccall/lists/${l.id}/segments`, after: async () => {
      const pe = w.querySelector("#mcsPlan");
      if (!chosen().length) { pe.textContent = "配る人を選ぶと、だれに何件配るかがここに出ます。"; return; }
      const plan = await post(`/api/mccall/lists/${l.id}/assign`, body(chosen(), true));
      pe.textContent = plan.assigned ? `配る予定：${plan.per.map((p) => `${p.name} ${p.n}件`).join("・")}（合計 ${plan.assigned}件）` : "条件に合う、配れるリードがありません。";
    } });
    w.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => { b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true"); pk.later(); }));
    w.querySelector("#mcsPer").addEventListener("input", pk.later); w.querySelector("#mcsFree").addEventListener("change", pk.later);
  }

  // ---- リードを足す（2026-11-19 福井さん「SF・BALES・SHOBO からリードを追加できる形式」） ----
  //   リストの行のボタンを1つにまとめ（画面の中央は10個前後まで＝ルール7）、ここで足し方を選ぶ
  function addDialog(listId) {
    const l = S.lists.find((x) => x.id === listId) || { id: listId, name: "" };
    const OPTS = [["type", "種類を選んで足す（SHOBO にあるリードから）", "BALES から移した保管のリストなどにあるリードを、取り込み元・リードソースごとの件数を見て選び、足す件数と担当まで決める（kincall の「ソースから配る」と同じ）"],
      ["sf", "SF から", "SF の MOCHICA のリード（コンバート前）を、ステータス・リードソース・失注の有無・最後の活動で絞って足す"],
      ["bales", "BALES から", "BALES のリスト（拡張機能で取り込んだもの）から足す。BALES は解約予定なので、移したリストは「SHOBO から」で使う"],
      ["shobo", "SHOBO から", "SHOBO のほかのリスト（BALES から移した保管のリストなど）から、条件に合うリードをこのリストへ移す"],
      ["csv", "CSV から", "CSV のファイルを読み込んで足す"], ["doc", "DOC から（部署をまたぐ）", "DOC の kincall のリストから写す。理由を残す"]];
    const w = dialog(`「${l.name}」にリードを足す`, "どこから足すかを選んでください。どこから足しても、MOCHICA 全体で同じ会社は1件だけです（電話・会社名・メールのどれかが同じなら入れません）。", "閉じる", () => {},
      `<div style="display:grid;gap:8px;margin-top:12px">${OPTS.map(([k, t, d]) => `<button class="mcc-btn" data-src="${k}" style="height:auto;padding:10px 12px;text-align:left;display:block"><b>${esc(t)}</b><br><small class="mcc-note" style="margin:0">${esc(d)}</small></button>`).join("")}</div>`);
    w.querySelectorAll("[data-src]").forEach((b) => b.addEventListener("click", () => {
      w.remove(); S.dlg = null;
      ({ type: (id) => giveDialog({ toList: id, pickTypes: true }), sf: sfDialog, bales: balesDialog, shobo: shoboDialog, csv: csvDialog, doc: docDialog })[b.dataset.src](listId);
    }));
  }
  // SF から足す：選んだ条件の件数を SF に聞いてから足す（SF は読むだけ）
  async function sfDialog(listId) {
    let o; try { o = await api("/api/mccall/sf/options"); } catch (e) { toast(`SF を読めませんでした：${e.message}`); return; }
    const f = { status: [], source: [] }; let timer = 0, seq = 0;
    const chips = (k, items) => `<div class="mcc-chips" style="margin-top:6px;max-height:150px;overflow:auto">${items.map((x) => `<button class="mcc-chip" data-k="${k}" data-v="${esc(x.v)}" aria-pressed="false">${esc(x.v)} <small style="opacity:.75">${x.n}</small></button>`).join("")}</div>`;
    const body = () => ({ filters: { ...f, lostOnly: w.querySelector("#mcfLost").checked, idleDays: parseInt(w.querySelector("#mcfIdle").value, 10) || 0, q: w.querySelector("#mcfQ").value },
      limit: parseInt(w.querySelector("#mcfLim").value, 10) || 300 });
    const w = dialog("SF から足す", `SF の MOCHICA のリード（コンバート前・アプローチ禁止の種類が入っていないもの）${o.total.toLocaleString()}件から選びます。最後の活動が古いものから足します。SF は書き換えません。`, "足す", async () => {
      const r = await post(`/api/mccall/lists/${listId}/from-sf`, body());
      toast(`SF から ${r.added}件 足しました${r.dup ? `（すでに SHOBO にある ${r.dup}件は入れていません）` : ""}${r.banned ? `・アプローチ禁止 ${r.banned}件` : ""}`);
      if (r.examples && r.examples.length) console.info("[SHOBO] 重複で入れなかった例", r.examples);
      await loadLists(); drawLists();
    }, `<p class="mcc-note" id="mcfSum" style="font-weight:700;color:var(--c-deep);margin-top:12px">数えています…</p>
      <div class="mcc-field" style="margin-top:8px">ステータス（選ばなければすべて）${chips("status", o.status)}</div>
      <div class="mcc-field" style="margin-top:8px">リードソース（選ばなければすべて）${chips("source", o.source)}</div>
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px">
        <label class="mcc-note" style="margin:0"><input type="checkbox" id="mcfLost" /> 過去に失注したものだけ</label>
        <label class="mcc-note" style="margin:0">最後の活動が <input type="number" id="mcfIdle" min="0" max="3650" placeholder="0" style="width:64px" /> 日より前</label>
        <label class="mcc-note" style="margin:0">会社名に <input id="mcfQ" style="width:120px" autocomplete="off" /></label>
        <label class="mcc-note" style="margin:0">いちどに <input type="number" id="mcfLim" min="1" max="5000" value="300" style="width:72px" /> 件まで</label></div>`);
    async function count() {
      const my = ++seq;
      try { const r = await post(`/api/mccall/lists/${listId}/from-sf`, { ...body(), dryRun: true }); if (my === seq && w.isConnected) w.querySelector("#mcfSum").textContent = `条件に合う SF のリード ${r.total.toLocaleString()}件（足すのは ${r.taking.toLocaleString()}件まで。すでに SHOBO にある会社は入れません）`; }
      catch (e) { if (my === seq && w.isConnected) w.querySelector("#mcfSum").textContent = `数えられませんでした：${e.message}`; }
    }
    const later = () => { clearTimeout(timer); timer = setTimeout(count, 400); };
    w.querySelectorAll("[data-k]").forEach((b) => b.addEventListener("click", () => { const a = f[b.dataset.k]; const i = a.indexOf(b.dataset.v); i >= 0 ? a.splice(i, 1) : a.push(b.dataset.v); b.setAttribute("aria-pressed", i >= 0 ? "false" : "true"); later(); }));
    ["#mcfLost", "#mcfIdle", "#mcfQ", "#mcfLim"].forEach((s) => w.querySelector(s).addEventListener("input", later));
    count();
  }
  // SHOBO から足す：ほかのリスト（BALES から移した保管のリストなど）から、条件に合うリードをこのリストへ移す
  function shoboDialog(listId) {
    let pk = null;
    const body = (dryRun) => ({ filters: pk.filters, limit: parseInt(w.querySelector("#mcpLim").value, 10) || 300, onlyFree: w.querySelector("#mcpFree").checked, dryRun });
    const w = dialog("SHOBO から足す", "SHOBO のほかのリスト（BALES から移した保管のリストも含む）から、条件に合うリードをこのリストへ移します。ホット → 最後にかけた日が古い順です。いま架電中のリードは動かしません。架電の記録はそのまま残ります。", "移す", async () => {
      const r = await post(`/api/mccall/lists/${listId}/from-shobo`, body(false));
      toast(`${r.moved}件をこのリストへ移しました（条件に合う ${r.matched}件のうち）`);
      await loadLists(); drawLists();
    }, `${SEG_HTML}
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px"><label class="mcc-note" style="margin:0">いちどに <input type="number" id="mcpLim" min="1" max="20000" value="300" style="width:80px" /> 件まで</label>
        <label class="mcc-note" style="margin:0"><input type="checkbox" id="mcpFree" checked /> まだ割り振っていないものだけ</label></div>
      <p class="mcc-note" id="mcpPlan" style="margin-top:8px"></p>`);
    pk = segPicker(w, { url: `/api/mccall/lists/${listId}/segments`, body: () => ({ pool: true }), after: async () => {
      const r = await post(`/api/mccall/lists/${listId}/from-shobo`, body(true));
      w.querySelector("#mcpPlan").textContent = r.moving ? `移す予定：${r.moving.toLocaleString()}件` : "条件に合う、移せるリードがありません。";
    } });
    w.querySelector("#mcpLim").addEventListener("input", pk.later); w.querySelector("#mcpFree").addEventListener("change", pk.later);
  }
  // 保管のリスト（BALES から移したものなど）と、BALES の移行の様子（2026-11-19）
  async function drawStock() {
    const box = $("mccStock"); if (!box) return;
    let st, mg;
    try { [st, mg] = await Promise.all([api("/api/mccall/lists?stock=1"), api("/api/mccall/bales/migrate")]); }
    catch (e) { box.innerHTML = `<h2>保管のリスト</h2><p class="mcc-note">読めませんでした：${esc(e.message)}</p>`; return; }
    const stock = (st.items || []).filter((l) => l.stock); const last = mg.last;
    const plan = mg.plan.lists || [];
    box.innerHTML = `<h2>保管のリスト（BALES から移したもの）</h2>
      <p class="mcc-note">BALES のリストは、SHOBO の保管のリストへ移します（BALES を解約しても、会社・次の掛け直しの予定・かけた回数・BALES での架電の履歴が残ります）。保管のリストはだれの「かける」にも出ません。各リストの「リードを足す → SHOBO から」で条件を付けて持ってくるか、「かける対象にする」で出してください。</p>
      <p class="mcc-note" style="font-weight:700">${mg.running ? "いま移しています…（数分かかります）" : last ? (last.error ? `前回の移行は失敗しました（${esc(last.error)}）` : `前回の移行：${esc(tm(last.at))}・${esc(last.by || "")}・${last.added.toLocaleString()}件を移しました${last.empty && last.empty.length ? `（行が0件の BALES のリスト：${esc(last.empty.join("・"))}）` : ""}`) : "まだ移していません（デプロイの2分後に自動で1回移します）"}
        ${last && last.lists ? `<br><small>${last.lists.map((x) => `${esc(x.list)}：行${x.rows}・移した${x.added || 0}・すでにあった${x.dup || 0}${x.banned ? `・禁止${x.banned}` : ""}`).join("／")}</small>` : `<br><small>BALES のリスト ${plan.length}個・行 ${plan.reduce((a, x) => a + x.rows, 0).toLocaleString()}件</small>`}</p>
      <div style="margin:8px 0"><button class="mcc-btn" id="mccMig" ${mg.running ? "disabled" : ""}>${last ? "もう一度移す（増えた分だけ）" : "BALES のリストを移す"}</button></div>
      ${stock.length ? `<table class="mcc-tbl"><thead><tr><th>リスト</th><th class="num">残り</th><th></th></tr></thead><tbody>${stock.map((l) => `<tr><td><b>${esc(l.name)}</b></td><td class="num">${l.open} / ${l.total}</td>
        <td style="white-space:nowrap"><button class="mcc-btn" data-sleads="${l.id}">中を見る・割り振る</button> <button class="mcc-btn primary" data-unstock="${l.id}">かける対象にする</button></td></tr>`).join("")}</tbody></table>` : ""}`;
    $("mccMig").addEventListener("click", () => dialog("BALES のリストを SHOBO へ移しますか", "BALES のリスト1つにつき、SHOBO の保管のリストを1つ作って入れます。すでに SHOBO にある会社は入れないので、何度押しても増えません。数分かかります。", "移す", async () => {
      await post("/api/mccall/bales/migrate", {}); toast("移し始めました。終わったらこの画面に件数が出ます"); setTimeout(drawStock, 1500);
    }));
    box.querySelectorAll("[data-sleads]").forEach((b) => b.addEventListener("click", () => drawLeads(stock.find((l) => l.id === +b.dataset.sleads))));
    box.querySelectorAll("[data-unstock]").forEach((b) => b.addEventListener("click", () => { const l = stock.find((x) => x.id === +b.dataset.unstock);
      dialog(`「${l.name}」をかける対象にしますか`, `残り ${l.open}件が、メンバー（決めていなければ MOCHICA 全員）の「かける」に出るようになります。件数が多いときは、先に「中を見る・割り振る」で担当を決めるか、ほかのリストへ「SHOBO から」で必要な分だけ持っていくのがおすすめです。`, "かける対象にする", async () => {
        await api(`/api/mccall/lists/${l.id}`, { method: "PATCH", body: JSON.stringify({ stock: false }) }); toast("かける対象にしました"); drawLists(); }); }));
  }
  // ---- リード管理（2026-11-20 福井さん「リードの種類がそれぞれ今何件あって、誰にどれだけ割り振っているのか分からない。kincall 準拠で」） ----
  //   kincall のリスト管理の「リスト」タブ（人ごとの残り）＝メンバー別、「ソース」タブ（ソースごとの件数・担当別・アポ率・メンバーに配る）＝種類別。
  //   種類＝取り込み元（SF・BALES・SHOBO（CSV）・DOC）× リードソース。アポ率は MOCHICALL で記録した架電だけ（Bales で記録した過去の架電は入らない）
  const LH = { view: ls.get("mcc_lhv") === "type" ? "type" : "member", sel: "all", lv: ls.get("mcc_lhl") === "list" ? "list" : "member", who: "" };
  const nf = (v) => Number(v || 0).toLocaleString();
  const pctOf = (o) => (o && o.calls ? `${((o.apos / o.calls) * 100).toFixed(1)}%` : "—");
  // アポ率の色：2%以上・0.5%以上・それ未満（kincall のソースのタブと同じ区切り）
  const rcls = (o) => { if (!o || !o.calls) return ""; const v = (o.apos / o.calls) * 100; return v >= 2 ? "g" : v >= 0.5 ? "y" : "r"; };
  const PAL = ["#0E9AA7", "#5DCAA5", "#85B7EB", "#AFA9EC", "#F0997B", "#FAC775", "#97C459", "#E58FB5"];
  const ORG_C = { SF: "#2563A8", BALES: "#A2480C", "SHOBO（CSV）": "#0B6E78", DOC: "#1d9e75" };
  async function loadHub() {
    const [d, reps] = await Promise.all([api("/api/mccall/sources"), api("/api/mochica/reps").then((r) => r.items || []).catch(() => [])]);
    S.src = d; S.reps = reps; return d;
  }
  const whoName = (e) => (!e ? "未割り当て" : (S.src && S.src.names[e]) || ((S.reps || []).find((r) => r.email === e) || {}).name || e);
  const srcName = (k) => k.slice(k.indexOf("|") + 1);
  const typeTitle = (k) => `${k.slice(0, k.indexOf("|"))} › ${srcName(k)}`;
  // 選んでいるもの（all／o:取り込み元／s:取り込み元|リードソース）に、種類 k が入るか
  const inSel = (sel, k) => sel === "all" || (sel.startsWith("o:") ? k.startsWith(`${sel.slice(2)}|`) : sel === `s:${k}`);
  function selObj(d, sel) {
    if (sel === "all") return { ...d.all, rt: d.rates.all, title: "すべてのリード" };
    if (sel.startsWith("o:")) { const o = d.origins.find((x) => x.key === sel.slice(2)); return o && { ...o, rt: d.rates.byOrigin[o.key], title: `${o.key} から足したリード` }; }
    const t = d.types.find((x) => `s:${x.key}` === sel); return t && { ...t, rt: d.rates.byType[t.key], title: `${t.origin} › ${t.source}` };
  }
  // 選んでいる種類が入っているリスト（種類×リストを足し合わせる）
  function selLists(d, sel) {
    const m = new Map();
    for (const x of d.typeLists) {
      if (!inSel(sel, x.type)) continue;
      const o = m.get(x.id) || { id: x.id, name: x.name, stock: x.stock, n: 0, untouched: 0, dist: 0, by: {}, calls: 0, apos: 0 };
      o.n += x.n; o.untouched += x.untouched; o.dist += x.dist; for (const [e, v] of Object.entries(x.by)) o.by[e] = (o.by[e] || 0) + v;
      const r = d.rates.byList[`${x.type}#${x.id}`]; if (r) { o.calls += r.calls; o.apos += r.apos; }
      m.set(x.id, o);
    }
    return [...m.values()].sort((a, b) => (a.stock - b.stock) || b.n - a.n);
  }
  async function drawHub() {
    const box = $("mccAdmin"); if (!S.src) box.innerHTML = `<div class="mcc-card">リードを数えています…</div>`;
    let d; try { d = await loadHub(); } catch (e) { box.innerHTML = `<div class="mcc-card">リードを数えられませんでした：${esc(e.message)}<br>少し待ってから、もう一度「リード管理」を押してください。</div>`; return; }
    if (S.tab !== "leads") return;
    const A = d.all;
    box.innerHTML = `<div class="mcc-card">
      <div class="mch-top"><h2>リード管理</h2>
        <div class="mch-seg" role="tablist" aria-label="見せ方">${[["member", "メンバー別"], ["type", "種類別"]].map(([k, l]) => `<button role="tab" data-v="${k}" aria-selected="${LH.view === k}">${l}</button>`).join("")}</div>
        <span class="mcc-sp"></span><button class="mcc-btn" id="mchReload">読み直す</button><button class="mcc-btn primary" id="mchGive">種類を選んで配る</button></div>
      <div class="mcc-kpis">
        <div><small>かける対象のリード</small><b>${nf(A.n)}</b></div>
        <div><small>割り振り済み</small><b>${nf(A.n - A.free)}</b></div>
        <div><small>未割り当て（リストのメンバー全員がかけられる）</small><b>${nf(A.free)}</b></div>
        <div><small>まだかけていない</small><b>${nf(A.untouched)}</b></div>
        <div><small>保管（だれの「かける」にも出ない）</small><b>${nf(A.stock)}</b></div>
        <div class="apo"><small>アポ率（直近3か月）</small><b>${pctOf(d.rates.all)}</b></div>
      </div>
      ${d.pending ? `<p class="mcc-note mch-warn">種類をまだ計算していないリードが ${nf(d.pending)}件あり、いまは「不明」に数えています。裏で計算を続けているので、少したってから「読み直す」を押すと正しい種類に移ります。</p>` : ""}
      <p class="mcc-note">数えているのは閉じていないリストの、終わっていないリードです（重複で止めたものは入れません）。アポ率は MOCHICALL で記録した架電だけで、Bales で記録した過去の架電は入りません。</p>
      <div id="mchBody" style="margin-top:12px"></div></div>`;
    box.querySelectorAll(".mch-top [data-v]").forEach((b) => b.addEventListener("click", () => { LH.view = b.dataset.v; ls.set("mcc_lhv", LH.view); drawHub(); }));
    $("mchReload").addEventListener("click", () => { S.src = null; drawHub(); });
    $("mchGive").addEventListener("click", () => giveDialog({ pickTypes: true }));
    if (LH.view === "type") drawHubType(d); else drawHubMember(d);
  }

  // メンバー別（kincall の「リスト」タブの人のカード）：人ごとに、担当しているリードの数・今かけられる数・種類の内訳・アポ率
  function drawHubMember(d) {
    const body = $("mchBody"); if (!body) return;
    const reps = S.reps || []; const byE = new Map(d.members.map((m) => [m.email, m]));
    // 並べる人：MOCHICA のメンバー（0件の人も「まだ配っていない」と分かるように出す）＋担当を持っているほかの人
    const ppl = new Map();
    for (const r of reps) if (r.mochica) ppl.set(r.email, { email: r.email, name: r.name, intern: !!r.intern, mochica: true });
    for (const m of d.members) if (!ppl.has(m.email)) { const r = reps.find((x) => x.email === m.email) || {}; ppl.set(m.email, { email: m.email, name: r.name || whoName(m.email), intern: !!r.intern, mochica: !!r.mochica }); }
    const color = new Map(d.types.map((t, i) => [t.key, PAL[i % PAL.length]]));
    const nOf = (e) => (byE.get(e) || {}).n || 0;
    const card = (p) => {
      const m = byE.get(p.email) || { n: 0, now: 0, untouched: 0, stock: 0, hidden: 0, byType: {} };
      const rt = d.rates.all.mem[p.email];
      const ts = Object.entries(m.byType).sort((a, b) => b[1] - a[1]);
      const bar = ts.map(([k, v]) => `<span style="width:${(v / Math.max(1, m.n)) * 100}%;background:${color.get(k)}" title="${esc(typeTitle(k))} ${nf(v)}件"></span>`).join("");
      const warn = [m.stock ? `保管のリストの担当 ${nf(m.stock)}件` : "", m.hidden ? `リストのメンバー外 ${nf(m.hidden)}件` : ""].filter(Boolean).join("・");
      return `<button class="mch-card${LH.who === p.email ? " on" : ""}${m.n ? "" : " zero"}" data-who="${esc(p.email)}">
        <span class="mch-cn">${esc(p.name)}${p.intern ? "<small>インターン</small>" : ""}</span>
        <span class="mch-cz"><b>${nf(m.n)}</b><small>件</small><span class="mch-r ${rcls(rt)}" title="直近3か月のアポ率（MOCHICALL の記録）">${pctOf(rt)}</span></span>
        <span class="mch-cs">今かける ${nf(m.now)}・未架電 ${nf(m.untouched)}</span>
        <span class="mch-bar">${bar}</span>
        <span class="mch-cs">${ts.length ? ts.slice(0, 2).map(([k, v]) => `${esc(srcName(k))} ${nf(v)}`).join("・") + (ts.length > 2 ? ` ほか${ts.length - 2}種類` : "") : "まだ配っていません"}</span>
        ${warn ? `<span class="mch-cw">${esc(warn)}（かける画面に出ません）</span>` : ""}</button>`;
    };
    const free = `<button class="mch-card none${LH.who === "__free__" ? " on" : ""}" data-who="__free__"><span class="mch-cn">未割り当て</span>
      <span class="mch-cz"><b>${nf(d.all.free)}</b><small>件</small></span><span class="mch-cs">リストのメンバーならだれでもかけられる</span><span class="mch-cs">配れる（いま開かれていない）${nf(d.all.dist)}</span></button>
      <div class="mch-card none static"><span class="mch-cn">保管</span><span class="mch-cz"><b>${nf(d.all.stock)}</b><small>件</small></span><span class="mch-cs">BALES から移したリストなど。種類を選んでリストへ足すと配れる</span></div>`;
    const all = [...ppl.values()];
    const secs = [["MOCHICA（営業・管理）", all.filter((p) => p.mochica && !p.intern)], ["インターン", all.filter((p) => p.intern)], ["MOCHICA 以外で担当を持っている人", all.filter((p) => !p.mochica)]];
    body.innerHTML = `<div class="mch-sec"><div class="mch-sh">全体</div><div class="mch-grid">${free}</div></div>` +
      secs.filter(([, a]) => a.length).map(([l, a]) => `<div class="mch-sec"><div class="mch-sh">${esc(l)}<span>${nf(a.reduce((s, p) => s + nOf(p.email), 0))}件・${a.length}人</span></div><div class="mch-grid">${a.sort((x, y) => nOf(y.email) - nOf(x.email) || x.name.localeCompare(y.name, "ja")).map(card).join("")}</div></div>`).join("") +
      `<div id="mchWho"></div>`;
    body.querySelectorAll("[data-who]").forEach((b) => b.addEventListener("click", () => { LH.who = LH.who === b.dataset.who ? "" : b.dataset.who; drawHubMember(d); if (LH.who) { const w = $("mchWho"); if (w) w.scrollIntoView({ block: "nearest", behavior: "smooth" }); } }));
    if (LH.who) drawWho(d);
  }
  // 1人（または未割り当て）の中身：種類ごと・リストごとの件数と、そこから配り直すボタン
  function drawWho(d) {
    const el = $("mchWho"); if (!el) return;
    const isFree = LH.who === "__free__"; const key = isFree ? "" : LH.who;
    const byT = new Map(), byL = new Map();
    for (const x of d.typeLists) {
      const v = x.by[key] || 0; if (!v || (isFree && x.stock)) continue;
      if (!x.stock) byT.set(x.type, (byT.get(x.type) || 0) + v);
      const o = byL.get(x.id) || { id: x.id, name: x.name, stock: x.stock, n: 0 }; o.n += v; byL.set(x.id, o);
    }
    const tot = [...byT.values()].reduce((a, x) => a + x, 0);
    const tRows = [...byT.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => { const r = !isFree && d.rates.byType[k] ? d.rates.byType[k].mem[key] : null;
      return `<tr><td>${esc(typeTitle(k))}</td><td class="num">${nf(v)}</td><td class="num">${isFree ? "" : `<span class="mch-r ${rcls(r)}">${pctOf(r)}</span>`}</td><td class="num"><button class="mch-mini" data-give="${esc(k)}">${isFree ? "配る" : "配り直す"}</button></td></tr>`; }).join("");
    const lRows = [...byL.values()].sort((a, b) => (a.stock - b.stock) || b.n - a.n).map((l) => `<tr><td>${esc(l.name)}${l.stock ? ' <span class="mcc-badge">保管</span>' : ""}</td><td class="num">${nf(l.n)}</td><td class="num"><button class="mch-mini" data-open="${l.id}">中身を見る</button></td></tr>`).join("");
    el.innerHTML = `<div class="mch-who"><div class="mch-dh"><span class="mch-dt">${esc(isFree ? "未割り当て" : whoName(key))}</span><span class="mcc-note">かける対象のリスト ${nf(tot)}件</span><span class="mcc-sp"></span>
        <button class="mcc-btn primary" id="mchWhoGive">${isFree ? "メンバーに配る" : "ほかの人へ配り直す"}</button></div>
      <div class="mch-two"><div><div class="mch-st">種類ごと</div>${tRows ? `<table class="mcc-tbl"><thead><tr><th>種類</th><th class="num">件数</th><th class="num">${isFree ? "" : "アポ率"}</th><th></th></tr></thead><tbody>${tRows}</tbody></table>` : '<p class="mcc-note">ありません。</p>'}</div>
        <div><div class="mch-st">リストごと</div>${lRows ? `<table class="mcc-tbl"><thead><tr><th>リスト</th><th class="num">件数</th><th></th></tr></thead><tbody>${lRows}</tbody></table>` : '<p class="mcc-note">ありません。</p>'}</div></div></div>`;
    $("mchWhoGive").addEventListener("click", () => giveDialog({ keys: ["all"], from: key }));
    el.querySelectorAll("[data-give]").forEach((b) => b.addEventListener("click", () => giveDialog({ keys: [`s:${b.dataset.give}`], from: key })));
    el.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openHubList(d, +b.dataset.open)));
  }
  // リード管理からリストの中身（割り振る・移す）を開く。戻るとリード管理に戻る
  function openHubList(d, id) {
    const l = d.lists.find((x) => x.id === id) || S.lists.find((x) => x.id === id); if (!l) return;
    drawLeads({ ...l, ...(S.lists.find((x) => x.id === id) || {}) }, drawHub);
  }

  // 種類別（kincall の「ソース」タブ）：左に取り込み元とリードソース、右に選んだものの件数・担当別・月ごとのアポ率・リスト
  function drawHubType(d) {
    const body = $("mchBody"); if (!body) return;
    if (!selObj(d, LH.sel)) LH.sel = "all";
    const item = (sel, label, o, rt, cls) => `<button class="${cls}${LH.sel === sel ? " on" : ""}" data-sel="${esc(sel)}" title="${esc(label)}"><span class="mch-ln">${esc(label)}</span><span class="mch-lnum">${nf(o.n)}${o.stock ? `<small>保管 ${nf(o.stock)}</small>` : ""}</span><span class="mch-r ${rcls(rt)}">${pctOf(rt)}</span></button>`;
    const left = item("all", "すべて", d.all, d.rates.all, "mch-gh") + d.origins.map((o) => `<div class="mch-og" style="--fc:${ORG_C[o.key] || "#5C7377"}">${item(`o:${o.key}`, o.key, o, d.rates.byOrigin[o.key], "mch-gh")}${
      d.types.filter((t) => t.origin === o.key).map((t) => item(`s:${t.key}`, t.source, t, d.rates.byType[t.key], "mch-li")).join("")}</div>`).join("");
    const o = selObj(d, LH.sel); const rt = o.rt; const R = d.rates;
    // 担当別：件数（かける対象のリストで担当しているもの）とその人のアポ率。未割り当ては最後
    const holders = { ...o.by }; Object.keys((rt && rt.mem) || {}).forEach((e) => { if (!(e in holders)) holders[e] = 0; });
    const hs = Object.entries(holders).sort((a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || b[1] - a[1]);
    const hmax = Math.max(1, ...hs.map((h) => h[1]));
    const hRows = hs.map(([e, n]) => { const mr = e && rt ? rt.mem[e] : null;
      return `<div class="mch-hb${e ? "" : " none"}"><span class="mch-hn" title="${esc(whoName(e))}">${esc(whoName(e))}</span><span class="mch-hbar"><i style="width:${Math.round((n / hmax) * 100)}%"></i></span><span class="mch-hc">${nf(n)}件</span><span class="mch-r ${rcls(mr)}">${e ? pctOf(mr) : ""}</span></div>`; }).join("");
    const mv = R.months.map((ym) => (rt && rt.m[ym]) || null); const mmax = Math.max(0.001, ...mv.map((x) => (x && x.calls ? x.apos / x.calls : 0)));
    const mBars = R.months.map((ym, i) => { const x = mv[i]; const v = x && x.calls ? x.apos / x.calls : 0;
      return `<div class="mch-mc"><div class="mch-mb" style="height:${Math.max(3, Math.round((v / mmax) * 54))}px"></div><span>${Number(ym.slice(5))}月 ${pctOf(x)}</span><small>${x ? `${nf(x.apos)} / ${nf(x.calls)}コール` : "記録なし"}</small></div>`; }).join("");
    const lsx = selLists(d, LH.sel);
    const seg = `<span class="mch-seg sm">${[["member", "メンバー別"], ["list", "リスト別"]].map(([k, l]) => `<button data-lv="${k}" aria-selected="${LH.lv === k}">${l}</button>`).join("")}</span>`;
    const lrt = (l) => (l.calls ? l : null);
    // メンバー別：人ごとに、この種類で持っているリードと、そのリスト（kincall の srcMemberView）
    const memberCards = () => {
      const by = new Map();
      for (const l of lsx) for (const [e, v] of Object.entries(l.by)) { if (!v) continue; const x = by.get(e) || { e, n: 0, ls: [] }; x.n += v; x.ls.push({ ...l, mine: v }); by.set(e, x); }
      const arr = [...by.values()].sort((a, b) => (a.e ? 0 : 1) - (b.e ? 0 : 1) || b.n - a.n);
      return arr.length ? `<div class="mch-mv">${arr.map((m) => { const mr = m.e && rt ? rt.mem[m.e] : null;
        return `<div class="mch-mvc${m.e ? "" : " none"}"><div class="mch-mvh"><b>${esc(whoName(m.e))}</b><span><b>${nf(m.n)}</b>件・${m.ls.length}リスト</span><span class="mch-r ${rcls(mr)}">${m.e ? pctOf(mr) : ""}</span></div>
          ${m.ls.sort((a, b) => b.mine - a.mine).map((l) => `<div class="mch-mvr"><span class="mch-mvn" title="${esc(l.name)}">${esc(l.name)}${l.stock ? ' <span class="mcc-badge">保管</span>' : ""}</span><span class="mch-mvk">${nf(l.mine)}件</span>
            <span class="mch-mva"><button class="mch-mini" data-open="${l.id}">中身</button><button class="mch-mini" data-lgive="${l.id}" data-from="${esc(m.e)}">配る</button></span></div>`).join("")}</div>`; }).join("")}</div>` : '<p class="mcc-note">ありません。</p>';
    };
    // リスト別：リストごとに件数・未架電・配れる数と、だれが何件持っているかの帯（kincall のリストのカード）
    const listCards = () => `<div class="mch-lcg">${lsx.map((l) => {
      const ws = Object.entries(l.by).filter(([, v]) => v).sort((a, b) => b[1] - a[1]); const tot = Math.max(1, l.n);
      const bar = ws.map(([e, v], i) => `<span title="${esc(whoName(e))} ${nf(v)}件" style="width:${(v / tot) * 100}%;background:${e ? PAL[i % PAL.length] : "#D3D1C7"}"></span>`).join("");
      return `<div class="mch-lc"><div class="mch-lch"><b title="${esc(l.name)}">${esc(l.name)}</b>${l.stock ? '<span class="mcc-badge">保管</span>' : ""}<span class="mch-r ${rcls(lrt(l))}">${pctOf(lrt(l))}</span></div>
        <div class="mch-lck"><span><b>${nf(l.n)}</b>件</span><span>未架電 ${nf(l.untouched)}</span><span>配れる ${nf(l.dist)}</span></div>
        <div class="mch-bar">${bar}</div><div class="mch-lcw">${ws.slice(0, 3).map(([e, v]) => `${esc(whoName(e))} ${nf(v)}`).join("・")}${ws.length > 3 ? ` ほか${ws.length - 3}人` : ""}</div>
        <div class="mch-lca"><button class="mch-mini" data-open="${l.id}">中身を見る</button><button class="mch-mini" data-lgive="${l.id}" data-from="">${l.stock ? "このリストからリストへ足す" : "このリストから配る"}</button></div></div>`; }).join("")}</div>`;
    const H = o.hot;
    body.innerHTML = `<div class="mch-wrap"><nav class="mch-left" aria-label="リードの種類">${left}</nav><div class="mch-right">
      <div class="mch-dh"><span class="mch-dt">${esc(o.title)}</span><span class="mcc-sp"></span><button class="mcc-btn primary" id="mchSelGive">メンバーに配る</button></div>
      <div class="mch-k">
        <div><span>件数（かける対象）</span><b>${nf(o.n)}</b></div>
        <div><span>アポ率（直近3か月）</span><b class="mch-r ${rcls(rt)}">${pctOf(rt)}</b><small>${rt && rt.calls ? `${nf(rt.apos)} / ${nf(rt.calls)}コール` : "MOCHICALL での記録なし"}</small></div>
        <div><span>未架電</span><b>${nf(o.untouched)}</b></div>
        <div><span>配れる未割り当て</span><b>${nf(o.dist)}</b></div>
        <div><span>保管</span><b>${nf(o.stock)}</b><small>リストへ足すと配れる</small></div>
      </div>
      <div class="mcc-chips mch-hot"><span class="mcc-badge hot">ホット ${nf(H[0])}</span><span class="mcc-badge warm">ウォーム ${nf(H[1])}</span><span class="mcc-badge cold">コールド ${nf(H[2])}</span></div>
      <div class="mch-st">担当別（担当しているリードの数と、その人のアポ率）</div>${hRows || '<p class="mcc-note">まだだれにも配っていません。</p>'}
      <div class="mch-st">月ごとのアポ率</div><div class="mch-mo">${mBars}</div>
      ${lsx.length ? `<div class="mch-st mch-st2">${LH.sel === "all" ? "リスト" : "この種類が入っているリスト"}（${lsx.length}本）${seg}</div>${LH.lv === "member" ? memberCards() : listCards()}` : ""}
    </div></div>`;
    body.querySelectorAll("[data-sel]").forEach((b) => b.addEventListener("click", () => { LH.sel = b.dataset.sel; drawHubType(d); }));
    body.querySelectorAll("[data-lv]").forEach((b) => b.addEventListener("click", () => { LH.lv = b.dataset.lv; ls.set("mcc_lhl", LH.lv); drawHubType(d); }));
    $("mchSelGive").addEventListener("click", () => giveDialog({ keys: [LH.sel] }));
    body.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openHubList(d, +b.dataset.open)));
    body.querySelectorAll("[data-lgive]").forEach((b) => b.addEventListener("click", () => giveDialog({ keys: [LH.sel], list: +b.dataset.lgive, from: b.dataset.from })));
  }

  // 種類から配る・足す（kincall の「メンバーに配る」と同じ流れ：どこから → 何件 → 配り方 → 配る人 → 配分を見る → この配分で配る）。
  //   o.keys：種類（all／o:…／s:…）。o.pickTypes：窓の中で種類を選ぶ（「種類を選んで配る」「リードを足す → 種類を選んで足す」）。
  //   o.from：その人の担当分から配り直す。o.list：そのリストの中だけ。o.toList：入れるリストが決まっている（リードを足すから）。
  //   配るだけのときはリストを動かさない（kincall と同じ）。保管のリストから出すときだけ、入れるリストへ移して担当を付ける
  async function giveDialog(o = {}) {
    let d = S.src;
    if (!d) { try { d = await loadHub(); } catch (e) { toast(`リードを数えられませんでした：${e.message}`); return; } }
    const reps = S.reps || [];
    const fixedTo = o.toList || 0;
    const L = o.list ? d.lists.find((x) => x.id === o.list) : null;
    const stockSrc = !!(L && L.stock);
    const live = d.lists.filter((l) => !l.stock);
    const keys = (o.keys && o.keys.length ? o.keys : ["all"]).slice();
    const pick = !!o.pickTypes;
    // 種類をまだ選んでいないあいだは、全部の数を見せる（配るときは「種類を1つ以上選んで」で止める）
    const keyHit = (k) => !keys.length || keys.includes("all") || keys.some((s) => inSel(s, k));
    // 「どこから」ごとに、その種類 x（種類×リスト）から何件出せるか。件数は画面を開いたときの数で、正しい数は「配分を見る」で出る
    const fromCount = (f, x) => {
      if (x.id === fixedTo) return 0;
      if (f.startsWith("who:")) return x.stock ? 0 : x.by[f.slice(4)] || 0;
      if (f === "pool:any") return x.dist;
      if (f === "pool:stock") return x.stock ? x.dist : 0;
      return x.stock ? 0 : x.dist;
    };
    const inScope = (x) => keyHit(x.type) && (!o.list || x.id === o.list);
    const sumFrom = (f) => d.typeLists.filter(inScope).reduce((a, x) => a + fromCount(f, x), 0);
    let fromSel = o.from ? `who:${o.from}` : fixedTo || stockSrc ? "pool:stock" : "";
    const title = fixedTo ? `「${(live.find((l) => l.id === fixedTo) || {}).name || ""}」にリードを足す` : o.from ? `${whoName(o.from)}さんの担当分を配り直す` : L ? `「${L.name}」から配る` : "種類を選んで配る";
    const lead = fixedTo ? "種類を選ぶと、足せる件数がすぐ変わります。足したリードはこのリストへ移ります（だれも選ばなければ担当なしで入れ、リストのメンバー全員がかけられます）。"
      : "配ったリードは担当が変わるだけで、リストは動きません（保管のリストから出すときだけ、入れるリストへ移します）。いま架電中のリードと終わったリードは配りません。";
    const w = dialog(title, lead, "配分を見る", async (w) => {
      const b = body(); if (!b.keys.length) throw new Error("種類を1つ以上選んでください");
      if (!b.n) throw new Error("配る件数を入れてください");
      if (needTo() && !b.toList) throw new Error("入れるリストを選んでください");
      if (!b.toList && !b.members.length) throw new Error("配る人を選んでください");
      if (!w.dataset.ok) {
        const r = await post("/api/mccall/sources/distribute", { ...b, dryRun: true });
        const short = r.plan.filter((p) => p.n < p.want);
        w.querySelector("#mgPrev").innerHTML = `<p class="mcc-note" style="font-weight:700;color:var(--c-deep)">当てはまるのは ${nf(r.available)}件。そのうち ${nf(r.total)}件を${r.toList ? `「${esc(r.toList)}」へ入れて` : ""}配ります。</p>
          ${r.plan.length ? `<table class="mcc-tbl"><thead><tr><th>配る人</th><th class="num">この種類のアポ率（直近60日）</th><th class="num">配る件数</th></tr></thead><tbody>${r.plan.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${p.rate == null ? "—" : `${p.rate}%`}<small> ${p.calls ? `${p.apos}/${p.calls}` : "記録なし"}</small></td><td class="num"><b>${nf(p.n)}</b>${p.n < p.want ? `<small> 予定 ${nf(p.want)}</small>` : ""}</td></tr>`).join("")}</tbody></table>` : ""}
          ${r.unassigned ? `<p class="mcc-note">担当なしで入れる ${nf(r.unassigned)}件</p>` : ""}
          ${short.length ? `<p class="mcc-note" style="color:var(--c-warn)">${esc(short.map((p) => p.name).join("・"))}さんには予定より少なくなります（リードのあるリストのメンバーに入っていないため）。先に「リストの管理 → メンバー」で足すと配れます。</p>` : ""}`;
        // dialog() は押したボタンを止めたままにするので、続けて押せるように戻す
        const ok = w.querySelector("[data-ok]"); ok.disabled = false;
        if (!r.total) return false;
        w.dataset.ok = "1"; ok.textContent = "この配分で配る"; return false;
      }
      const r = await post("/api/mccall/sources/distribute", b);
      toast(`${nf(r.done)}件を配りました${r.toList ? `（「${r.toList}」へ入れました）` : ""}：${[...r.plan.filter((p) => p.done).map((p) => `${p.name} ${p.done}件`), r.unassigned ? `担当なし ${r.unassigned}件` : ""].filter(Boolean).join("・")}`);
      S.src = null;
      if (fixedTo || stockSrc) await loadLists().catch(() => {});
      if (S.tab === "leads") drawHub(); else if (S.tab === "lists") drawLists();
    }, `<div class="mg">
      ${pick ? `<div class="mcc-field">種類（同じ取り込み元の中でいくつでも選べます。選んだもののどれかに当てはまるリードを配ります）<div class="mcc-chips mg-types" id="mgTypes"></div></div>` : `<p class="mcc-note mg-scope">種類：<b>${esc(keys.map((k) => (k === "all" ? "すべて" : k.startsWith("o:") ? k.slice(2) : typeTitle(k.slice(2)))).join("・"))}</b>${L ? `／リスト：<b>${esc(L.name)}</b>` : ""}</p>`}
      <div class="mg-row"><label class="mcc-field">どこから<select class="mcc-sel" id="mgFrom"></select></label>
        <label class="mcc-field n">何件<input type="number" id="mgN" min="1" max="5000" value="100" /></label>
        <label class="mcc-field" id="mgToWrap">入れるリスト<select class="mcc-sel" id="mgTo"></select></label></div>
      <div class="mg-row"><label class="mcc-note"><input type="radio" name="mgMode" value="equal" checked /> 均等に配る</label>
        <label class="mcc-note"><input type="radio" name="mgMode" value="rate" /> この種類でのアポ率に応じて配る（直近60日）</label></div>
      <div class="mcc-field">配る人${fixedTo ? "（選ばなければ担当なしで入れます）" : ""}<div id="mgWho"></div></div>
      <div id="mgPrev" class="mg-prev"></div></div>`);
    w.firstElementChild.classList.add("wide");
    const $w = (s) => w.querySelector(s);
    const fromV = () => fromSel;
    // 保管のリストから出すときは、入れるリストが要る
    const needTo = () => !!fixedTo || stockSrc || fromV().startsWith("pool:");
    const toId = () => fixedTo || (needTo() ? +$w("#mgTo").value || 0 : 0);
    function body() {
      const f = fromV();
      return { keys: keys.slice(), n: parseInt($w("#mgN").value, 10) || 0, mode: (w.querySelector('input[name="mgMode"]:checked') || {}).value || "equal",
        members: [...w.querySelectorAll("[data-gm][aria-pressed=true]")].map((b) => b.dataset.gm),
        from: f.startsWith("who:") ? f.slice(4) : "", pool: f === "pool:any" ? "any" : "stock", toList: toId(), list: o.list || 0 };
    }
    const reset = () => { delete w.dataset.ok; $w("[data-ok]").textContent = "配分を見る"; $w("#mgPrev").innerHTML = ""; const er = $w(".err"); if (er) er.remove(); };
    function paintFrom() {
      const st = sumFrom("pool:stock");
      const opts = fixedTo ? [["pool:stock", `保管のリストの未割り当て（${nf(st)}件）`], ["pool:any", `ほかのリストの未割り当て・保管も含む（${nf(sumFrom("pool:any"))}件）`]]
        : stockSrc ? [["pool:stock", `このリストの未割り当て（${nf(st)}件）`]]
        : [["", `未割り当て（配れる ${nf(sumFrom(""))}件）`], ...(st ? [["pool:stock", `保管のリスト（${nf(st)}件。入れるリストへ移す）`]] : [])];
      // 人の担当分から配り直す（リストへ足すときは出さない＝足すのは新しいリードだけにする）
      if (!fixedTo && !stockSrc) {
        const by = {};
        for (const x of d.typeLists) if (inScope(x) && !x.stock) for (const [e, v] of Object.entries(x.by)) if (e && v) by[e] = (by[e] || 0) + v;
        if (o.from && !(o.from in by)) by[o.from] = 0;
        for (const [e, v] of Object.entries(by).sort((a, b) => b[1] - a[1])) opts.push([`who:${e}`, `${whoName(e)} の担当分（${nf(v)}件）`]);
      }
      if (!opts.some(([v]) => v === fromSel)) fromSel = opts[0][0];
      $w("#mgFrom").innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}" ${v === fromSel ? "selected" : ""}>${esc(l)}</option>`).join("");
      $w("#mgToWrap").hidden = !needTo() || !!fixedTo;
      if (!$w("#mgTo").options.length) $w("#mgTo").innerHTML = `<option value="">（選んでください）</option>` + live.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join("");
      paintWho();
    }
    // 配る人：入れる先（またはそのリスト）にメンバーが決まっていればその人だけ、決まっていなければ MOCHICA の人
    function paintWho() {
      const on = new Set([...w.querySelectorAll("[data-gm][aria-pressed=true]")].map((b) => b.dataset.gm));
      const dest = d.lists.find((l) => l.id === (toId() || o.list || 0));
      const mem = dest ? dest.members : [];
      const cands = (mem.length ? reps.filter((r) => mem.includes(r.email)) : reps.filter((r) => r.mochica)).filter((r) => r.email !== (fromV().startsWith("who:") ? fromV().slice(4) : ""));
      const grp = [["MOCHICA", cands.filter((r) => !r.intern)], ["インターン", cands.filter((r) => r.intern)]].filter(([, a]) => a.length);
      $w("#mgWho").innerHTML = grp.length ? grp.map(([g, a]) => `<div class="mg-g">${g}</div><div class="mcc-members">${a.map((r) => `<button class="mcc-chip" data-gm="${esc(r.email)}" aria-pressed="${on.has(r.email)}">${esc(r.name)}</button>`).join("")}</div>`).join("")
        : '<p class="mcc-note">配れる人がいません。入れるリストのメンバーを「リストの管理 → メンバー」で決めてください。</p>';
      w.querySelectorAll("[data-gm]").forEach((b) => b.addEventListener("click", () => { b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") === "true" ? "false" : "true"); reset(); }));
    }
    // 種類のチップ（足せる数＝どこからに合わせた数）。取り込み元ごとにまとめる
    function paintTypes() {
      if (!pick) return;
      const f = fromV();
      const avail = (t) => d.typeLists.filter((x) => x.type === t.key && (!o.list || x.id === o.list)).reduce((a, x) => a + fromCount(f, x), 0);
      $w("#mgTypes").innerHTML = d.origins.map((og) => `<div class="mg-og"><span class="mg-ogn" style="color:${ORG_C[og.key] || "#5C7377"}">${esc(og.key)}</span>${
        d.types.filter((t) => t.origin === og.key).map((t) => { const k = `s:${t.key}`; const n = avail(t);
          return `<button class="mcc-chip" data-gt="${esc(k)}" aria-pressed="${keys.includes(k)}" ${n || keys.includes(k) ? "" : "disabled"}>${esc(t.source)} <small>${nf(n)}</small></button>`; }).join("")}</div>`).join("");
      w.querySelectorAll("[data-gt]").forEach((b) => b.addEventListener("click", () => {
        const k = b.dataset.gt; const i = keys.indexOf(k); i >= 0 ? keys.splice(i, 1) : keys.push(k);
        b.setAttribute("aria-pressed", i >= 0 ? "false" : "true"); paintFrom(); reset();
      }));
    }
    if (pick) { keys.length = 0; (o.keys || []).forEach((k) => k !== "all" && keys.push(k)); }
    paintFrom(); paintTypes();
    $w("#mgFrom").addEventListener("change", () => { fromSel = $w("#mgFrom").value; paintFrom(); paintTypes(); reset(); });
    $w("#mgTo").addEventListener("change", () => { paintWho(); reset(); });
    w.querySelectorAll("#mgN, input[name=mgMode]").forEach((x) => x.addEventListener("input", reset));
    w.querySelectorAll("input[name=mgMode]").forEach((x) => x.addEventListener("change", reset));
  }

  async function drawCross() {
    const box = $("mccAdmin"); box.innerHTML = `<div class="mcc-card">読み込んでいます…</div>`;
    try {
      const j = await api("/api/mccall/cross");
      box.innerHTML = `<div class="mcc-card"><h2>DOC から持ってきた記録</h2>${j.moves.length ? `<table class="mcc-tbl"><thead><tr><th>いつ</th><th>だれが</th><th>DOC のリスト</th><th>MOCHICA のリスト</th><th class="num">件数</th><th class="num">架電</th><th class="num">アポ</th><th>理由</th></tr></thead><tbody>
          ${j.moves.map((m) => `<tr><td>${esc(tm(m.at))}</td><td>${esc(m.by)}</td><td>${esc(m.from_name)}</td><td>${esc(m.to_name || "（消えたリスト）")}</td><td class="num">${m.count}</td><td class="num">${m.calls}</td><td class="num">${m.apo}</td><td>${esc(m.reason)}</td></tr>`).join("")}</tbody></table>` : '<p class="mcc-note">まだありません。</p>'}</div>
        <div class="mcc-card"><h2>部署をまたいだ架電（新しい順）</h2>${j.calls.length ? `<table class="mcc-tbl"><thead><tr><th>いつ</th><th>だれが</th><th>会社</th><th>結果</th><th>元の DOC のリスト</th></tr></thead><tbody>
          ${j.calls.map((c) => `<tr><td>${esc(tm(c.created_at))}</td><td>${esc(c.caller)}</td><td>${esc(c.company)}</td><td>${esc(c.outcome)}</td><td>${esc(c.from_name || "")}</td></tr>`).join("")}</tbody></table>` : '<p class="mcc-note">まだありません。</p>'}</div>`;
    } catch (e) { box.innerHTML = `<div class="mcc-card">読めませんでした：${esc(e.message)}</div>`; }
  }

  // ---- 数字：科学的に確かめる画面（時間帯・目安との比較・何回目でアポが取れたか） ----
  //   目安の数字は資料（B2B のコールドコール）のもの。MOCHICA の数字がこれと違うのは異常ではなく、自分たちの数字で判断するための基準線
  const pc = (a, b) => (b ? `${(a / b * 100).toFixed(1)}%` : "—");
  async function drawInsight() {
    const box = $("mccAdmin"); box.innerHTML = `<div class="mcc-card">読み込んでいます…</div>`;
    try { renderInsight(box, await api("/api/mccall/insight")); } catch (e) { box.innerHTML = `<div class="mcc-card">読めませんでした：${esc(e.message)}</div>`; }   // 中身が足りない応答でも「読み込んでいます」のまま止まらないように
  }
  function renderInsight(box, j) {
    const row = (lbl, r) => { const ar = r.calls ? r.apo / r.calls : 0; const tag = !r.calls ? "" : ar >= j.bench.top ? '<span class="mcc-tag good">上位の水準</span>' : ar >= j.bench.avg[0] ? '<span class="mcc-tag ok">平均の水準</span>' : '<span class="mcc-tag low">平均より下</span>';
      return `<tr><td>${esc(lbl)}</td><td class="num">${r.calls}</td><td class="num">${pc(r.person, r.calls)}</td><td class="num">${r.apo}</td><td class="num">${pc(r.apo, r.calls)}</td><td class="num">${pc(r.apo, r.person)}</td><td>${tag}</td></tr>`; };
    j.hours = j.hours || [];
    const maxRate = Math.max(...j.hours.map((h) => h.rate), 0.01);
    const bestH = j.hours.slice().sort((a, b) => b.rate - a.rate)[0];
    const att = j.byAttempt || []; const late = att.filter((a) => a.n >= 6).reduce((x, a) => x + a.apo, 0); const all = att.reduce((x, a) => x + a.apo, 0);
    box.innerHTML = `
      <div class="mcc-card"><h2>直近14日と、資料の目安</h2>
        <table class="mcc-tbl"><thead><tr><th></th><th class="num">コール</th><th class="num">担当者と話せた率</th><th class="num">アポ</th><th class="num">コール→アポ</th><th class="num">担当者と話せた→アポ</th><th>目安との比較</th></tr></thead><tbody>
          ${row("あなた", j.me)}${j.team ? row("MOCHICA 全体", j.team) : ""}${(j.people || []).map((p) => row(p.name, p)).join("")}</tbody></table>
        <p class="mcc-note">目安（資料：B2B のコールドコール→商談化）：平均 ${Math.round(j.bench.avg[0] * 100)}〜${Math.round(j.bench.avg[1] * 100)}%、上位 ${Math.round(j.bench.top * 100)}%以上。数字は日によって大きくぶれるので、日ごとではなく14日のかたまりで見てください。</p></div>
      <div class="mcc-card"><h2>つながりやすい時間帯（日本時間・担当者と話せた割合）</h2>
        <div class="mcc-hours">${j.hours.map((h) => `<div class="mcc-hr ${bestH && h.hour === bestH.hour ? "best" : ""}" title="${h.hour}時台：${h.calls}件中 ${h.person}件 担当者と話せた${h.prior ? "（資料の目安で補正）" : ""}"><i style="height:${Math.round(h.rate / maxRate * 100)}%"></i><b>${Math.round(h.rate * 100)}%</b><span>${h.hour}時</span><small>${h.calls}件</small></div>`).join("")}</div>
        <p class="mcc-note">直近90日の記録（${j.baseCalls}件）から出しています。記録が少ない時間帯は、資料の目安（始業直後と終業前が平均より約47%つながりやすい）を「事前の見立て」として足して、極端な数字に振れないようにしています。記録が増えるほど、自分たちの実測が優先されます。掛け直しの時刻は、前回と違う時間帯のうち、ここでいちばん高い時間に自動で入ります。</p></div>
      <div class="mcc-card"><h2>何回目の架電で、担当者と話せた・アポが取れたか（直近90日）</h2>
        ${att.length ? `<table class="mcc-tbl"><thead><tr><th>その会社への</th><th class="num">コール</th><th class="num">担当者と話せた</th><th class="num">アポ</th><th class="num">アポ率</th></tr></thead><tbody>
          ${att.map((a) => `<tr><td>${a.n}回目${a.n >= 10 ? "以降" : ""}</td><td class="num">${a.calls}</td><td class="num">${a.person}（${pc(a.person, a.calls)}）</td><td class="num">${a.apo}</td><td class="num">${pc(a.apo, a.calls)}</td></tr>`).join("")}</tbody></table>
        <p class="mcc-note">アポのうち <b>${all ? Math.round(late / all * 100) : 0}%</b> が6回目以降の架電で取れています（資料では93%）。6回目以降も取れているなら、1〜2回で諦めない掛け直しに価値があります。逆に、6回目以降がほとんど取れないなら、上限（いま ${j.cadence.max}回）を減らす根拠になります。</p>` : '<p class="mcc-note">まだ記録がありません。</p>'}</div>
      <div class="mcc-card"><h2>いまの掛け直しのきまり</h2>
        <ul class="mcc-rules"><li>担当者に届かなかったら、<b>${j.cadence.gapDays[0]}営業日後</b>（6回目以降は${j.cadence.gapDays[j.cadence.gapDays.length - 1]}営業日後）に、<b>前回と違う時間帯</b>のうち、つながりやすい時間に自動で掛け直します。</li>
          <li>受付で「いる時間」を聞けたときは、その時間を優先します。</li>
          <li>届かないまま <b>${j.cadence.max}回</b> 続いたら、いったん休ませて <b>${j.cadence.parkDays}日後</b>に再開します（時期が動くのを待つため。「終わり」にはしません）。</li>
          <li>担当者と話せたら、数え直しになります。「自動の掛け直しをやめる」で、会社ごとに止めることもできます。</li></ul>
        <p class="mcc-note">いま、休ませている会社：<b>${j.parked}</b>件／3回以上続けて届いていない会社：<b>${j.streak3}</b>件（あなたがかけられるリストの中）</p></div>`;
  }

  window.mcCallView = start;
})();
