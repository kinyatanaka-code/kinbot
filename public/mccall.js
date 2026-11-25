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
  const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} }, del(k) { try { localStorage.removeItem(k); } catch {} } };
  // 「飛ばす」は架電リストを完了扱いにはせず、このタブでの架電中だけ候補から外す。
  // sessionStorage なので、画面を読み直しても戻らず、ブラウザのタブを閉じれば次回は改めて検討できる。
  const ss = { get(k) { try { return sessionStorage.getItem(k); } catch { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch {} } };
  const skippedIds = () => {
    try { return new Set(JSON.parse(ss.get("mcc_skipped_leads") || "[]").map(Number).filter((id) => id > 0)); }
    catch { return new Set(); }
  };
  const saveSkippedIds = (ids) => ss.set("mcc_skipped_leads", JSON.stringify([...ids]));
  // 書きかけのメモは会社ごとにこのパソコンに残す（通話中に別の会社へ移ったり、画面を読み直したりしても消えないように）
  const memoKey = (id) => `mcc_memo_${id}`;
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
    person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20a8 8 0 0 1 16 0"/></svg>',
  };

  const S = { meta: null, admin: false, tab: "call", lists: [], listId: parseInt(ls.get("mcc_list") || "0", 10) || 0, queue: [], later: 0, skipped: skippedIds(), skippedInQueue: 0,
    d: null, cache: new Map(), f: null, notices: [], ni: 0, toast: null, busy: false, mounted: false, src: null, reps: null, ldBack: null };
  let memoEl = null;
  const CALL_TOOLS = [["mccTalk", "スクリプトを見る"], ["mccWork", "ヒアリングを入力"], ["mccMemoPanel", "架電メモを書く"]];
  const blankForm = () => ({ step: "reach", reach: "", outcome: "", reason: "", apoAt: "", apoWho: "", nextAt: "", nextLabel: "", noRetry: false, memo: "", gate: { name: "", hours: "", direct: "", biz: "" }, hearing: {}, memoHearing: {}, editedNeed: new Set(), phone: "", dialed: false, picks: {}, person: false, talkManual: null, tool: "mccTalk", hearingPage: 0 });

  // MOCHICA は Zoom Phone で架電する決まりなので、いつも Zoom アプリで発信する
  // （kinbot の Zoom 連携の状態を読む API は、インターンのアカウントでは開けないため見ない）
  const callHref = (v) => `zoomphonecall://${digits(v)}`;

  function mount() {
    const root = $("mcCallView"); if (!root || S.mounted) return; S.mounted = true;
    root.innerHTML = `<div class="mcc">
      <div class="mcc-bar">
        <div class="mcc-tabs" role="tablist" id="mccTabs"></div>
        <select class="mcc-sel" id="mccList" aria-label="かけるリスト"></select>
        <div class="mcc-find" id="mccFind"><input type="search" class="mcc-sel" id="mccFindQ" autocomplete="off" aria-label="会社を探してかける" placeholder="会社名・電話・担当者で探してかける" /><div class="mcc-find-list" id="mccFindList" role="listbox" hidden></div></div>
        <div class="mcc-stats" id="mccStats" aria-label="今日の自分の数字"></div>
        <span class="mcc-sp"></span>
        <button class="mcc-btn" id="mccHelpBtn" aria-keyshortcuts="?">${ICO.help}キー操作</button>
      </div>
      <div class="mcc-notice" id="mccNotice" role="status" aria-live="polite"></div>
      <div class="mcc-grid" id="mccCall">
        <section class="mcc-col" id="mccLeft" aria-label="会社の情報"></section>
        <section class="mcc-col" id="mccCenter" aria-label="架電と結果の記録"></section>
        <section class="mcc-col right" id="mccRight" aria-label="通話中の作業">
          <div class="mcc-tool-tabs" id="mccToolTabs" role="tablist" aria-label="通話中にすること" hidden>
            ${CALL_TOOLS.map(([id, label]) => `<button type="button" role="tab" id="${id}Tab" aria-controls="${id}">${label}</button>`).join("")}
          </div>
          <div id="mccTalk"></div><div id="mccWork"></div><div id="mccMemoPanel" hidden></div>
          <div id="mccTl" class="mcc-tlbox"></div>
          <button type="button" class="mcc-btn" id="mccHistory" hidden>架電履歴を見る</button>
        </section>
      </div>
      <div class="mcc-admin" id="mccAdmin" hidden></div>
    </div>`;
    // 今日の自分の数字（コール・担当者と話せた・アポ・SF 項目・いまの時間帯）とキー操作は、上のヘッダーに移す（2026-11-23 田中さん「ヘッダーに」）
    { const hd = document.getElementById("mcHeadCall"); if (hd) { const st = $("mccStats"), hb = $("mccHelpBtn"); if (st) hd.appendChild(st); if (hb) hd.appendChild(hb); } }
    $("mccHelpBtn").addEventListener("click", help);
    // 接続前から書いたメモを引き継げるよう、同じ入力欄を中央と右で使う。
    memoEl = document.createElement("div"); memoEl.id = "mccMemoBox";
    const toolTabs = $("mccToolTabs");
    const buttons = [...toolTabs.querySelectorAll("button")];
    buttons.forEach((b, i) => {
      b.addEventListener("click", () => showCallTool(CALL_TOOLS[i][0]));
      b.addEventListener("keydown", (e) => {
        const n = buttons.length;
        const next = { ArrowLeft: (i + n - 1) % n, ArrowRight: (i + 1) % n, Home: 0, End: n - 1 }[e.key];
        if (next == null) return;
        e.preventDefault(); showCallTool(CALL_TOOLS[next][0], true);
      });
    });
    $("mccHistory").addEventListener("click", showCallHistory);
    $("mccCenter").addEventListener("click", (e) => {
      const link = e.target.closest("[data-hearing-jump]");
      if (link) focusHearing(link.dataset.hearingJump);
    });
    // テレアポ中は SHOBO の左のサイドバーを細くたたむ（2026-11-23 福井さん）。かける画面を開いている間だけ。
    //   たたんだ間は文字を隠すので、項目の名前は指を置くと出るようにする
    document.querySelectorAll(".sidebar .side-item").forEach((a) => { if (!a.title) a.title = (a.textContent || "").trim(); });
    const pane = document.querySelector('[data-pane="call"]');
    if (pane && window.MutationObserver) new MutationObserver(syncSide).observe(pane, { attributes: true, attributeFilter: ["hidden"] });
    document.addEventListener("keydown", onKey);
    findBox();
    $("mccList").addEventListener("change", () => { S.listId = parseInt($("mccList").value, 10) || 0; ls.set("mcc_list", String(S.listId)); release(); S.d = null; loadQueue(true); });
    window.addEventListener("beforeunload", () => { if (S.d) navigator.sendBeacon && navigator.sendBeacon(`/api/mccall/leads/${S.d.lead.id}/release`); });
  }
  function drawTabs() {
    // 「リード管理」「リストの管理」のタブは一旦しまう（2026-11-23 田中さん「ここ消して」。割り振りは SHOWIN のリスト管理から）。
    //   中身（drawHub・drawLists）は消していないので、hideTab から外せばすぐ戻せる
    const hideTab = new Set(["leads", "lists"]);
    const tabs = [["call", "かける"], ["report", "レポート"], ["insight", "数字"]].concat(S.admin ? [["measures", "施策"], ["leads", "リード管理"], ["lists", "リストの管理"], ["cross", "部署をまたいだ記録"]].filter(([k]) => !hideTab.has(k)) : []);
    $("mccTabs").innerHTML = tabs.map(([k, l]) => `<button role="tab" aria-selected="${S.tab === k}" data-t="${k}">${l}</button>`).join("");
    $("mccTabs").querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.t)));
    if (tabs.length === 1) $("mccTabs").hidden = true;
  }
  function setTab(t) {
    S.tab = t; S.ldBack = null; drawTabs();
    // キー操作の説明は、かける画面のキーだけなので、かける画面にだけ出す（ほかのタブで1段使っていた。2026-11-23 福井さん）
    $("mccCall").hidden = t !== "call"; $("mccAdmin").hidden = t === "call"; $("mccList").hidden = t !== "call"; $("mccFind").hidden = t !== "call"; $("mccHelpBtn").hidden = t !== "call"; showNotice();
    syncSide();
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
    if (S.listId > 0 && !S.lists.some((l) => l.id === S.listId && !l.today_src)) S.listId = 0;   // 入れ物の今日かけるリストを選んでいたら外す（選ぶ欄に出さないため）
    if (S.listId === -1 && !S.lists.some(isCm)) S.listId = 0;
    drawListSel();
  }
  // 今日かけるリストの人は、リストを選ばずリスト管理の今日かけるリストからかける（2026-11-23 福井さん）。そのときは選ぶ欄に今日の分の残りを出すだけ
  // 商材ごとに分けて出す（2026-11-24 福井さん「架け先のリストでキャリアミキサー（キャリミキ）も選べるように」）。
  //   「担当のリストすべて」は MOCHICA だけ。キャリミキは「キャリミキのリストすべて」（値 -1）か1本ずつ選ぶ
  function drawListSel() {
    const sel = $("mccList"), t = S.today;
    // トークの無いリストは選んでもかけられないので、選ぶ前に分かるよう印を付ける（2026-11-25 福井さん「困った」）
    const opt = (l) => `<option value="${l.id}" ${l.id === S.listId ? "selected" : ""}>${esc(l.name)}（今かける ${l.now}${l.talks === 0 ? "・トークなし" : ""}）</option>`;
    // 「今日かけるリスト（リスト管理）」は全員の今日の分を入れておく入れ物なので、選ぶ欄には出さない（2026-11-25 福井さん「今日かけるリストが二つある」）。
    //   本人の今日の分は一番上の「今日かけるリスト 残り…」で選ぶ。入れ物を選ぶとほかの人の分ばかりで、かけられる会社が出ない
    const cm = S.lists.filter(isCm), mc = S.lists.filter((l) => !isCm(l) && !l.today_src);
    const cmGroup = cm.length ? `<optgroup label="キャリアミキサー（キャリミキ）"><option value="-1" ${S.listId === -1 ? "selected" : ""}>キャリミキのリストすべて（今かける ${cm.reduce((a, l) => a + l.now, 0)}）</option>${cm.map(opt).join("")}</optgroup>` : "";
    // 今日かけるリストの人は、いちばん上が今日かけるリスト。下の MOCHICA・キャリミキのリストも選べる（2026-11-24 福井さん「リスト選択が止まっていて選べない」）。
    //   前はキャリミキのリストが無いと選ぶ欄ごと止まっていた
    if (t) { sel.innerHTML = `<optgroup label="MOCHICA"><option value="0" ${S.listId === 0 ? "selected" : ""}>今日かけるリスト 残り ${Number(t.left ?? t.ready ?? 0)}件／${Number(t.n || 0)}件（見込みアポ率 ${(Number(t.exp || 0) * 100).toFixed(1)}%）</option>${mc.map(opt).join("")}</optgroup>${cmGroup}`; sel.disabled = false;
      sel.title = `リスト管理の今日かけるリスト（所有者：${t.owner || ""}）。予定のナーチャリング ${Number(t.due_nurture || 0)}・予定のそのほか ${Number(t.due_other || 0)}・過去失注 ${Number(t.pastlost || 0)}・新規 ${Number(t.newlist || 0)}。時刻が来た掛け直しも先に出ます`; return; }
    sel.disabled = false; sel.title = "";
    sel.innerHTML = (cm.length ? `<optgroup label="MOCHICA">` : "") + `<option value="0" ${S.listId === 0 ? "selected" : ""}>担当のリストすべて${cm.length ? "（MOCHICA）" : ""}</option>` + mc.map(opt).join("") + (cm.length ? `</optgroup>${cmGroup}` : "");
  }
  function isCm(l) { return l && l.product === "careermixer"; }
  async function loadStats() {
    try { const j = await api("/api/mccall/stats"); const m = j.me;
      // 今日の数字は3つだけ（項目が多くて「コ/ール」と縦に崩れていた。SF 項目はレポート、時間帯は数字タブで見る。2026-11-23 福井さん）
      $("mccStats").innerHTML = `<span><b>${m.calls}</b>コール</span><span title="担当者と話せた"><b>${m.person}</b>話せた</span><span class="apo"><b>${m.apo}</b>アポ</span>`; S.allStats = j.all;
      S.sf = j.sf || null; drawNotices();
    } catch { $("mccStats").innerHTML = `<span>今日の数字を読めませんでした</span>`; }
  }
  async function loadQueue(openFirst) {
    try {
      const j = await api(`/api/mccall/queue${S.listId ? `?list=${S.listId}` : ""}`); const items = j.items || [];
      S.skippedInQueue = items.filter((x) => S.skipped.has(Number(x.id))).length;
      S.queue = items.filter((x) => !S.skipped.has(Number(x.id))); S.later = j.later || 0; S.noTalk = j.noTalk || []; S.noTalkLists = j.noTalkLists || []; S.researching = j.researching || 0; S.why = j.why || null; S.stop = j.stop || "";
      // リストを選んでいる間はサーバーが today を返さない。そこで消すと一番上の「今日かけるリスト」が選べなくなるので、選んでいないときだけ入れ替える
      { const had = !!S.today; if (!S.listId || j.today) S.today = j.today || null; if (had || S.today) drawListSel(); }
      if (openFirst || !S.d) { const f = S.queue.find((x) => !S.d || x.id !== S.d.lead.id); if (f) await open(f.id); else empty(); }
    } catch (e) { setNotice([{ kind: "danger", text: `かける順番を読めませんでした：${e.message}` }]); }
  }
  // 「かける」に会社が出ないときは、なぜか・何をすればよいかを書く（2026-11-23 福井さん「初週を止めずに回す」）。
  //   インターンが「空っぽ」の画面で止まって待つことが無いよう、だれに何を頼めばよいかまで出す
  function adminsText() { const a = ((S.meta && S.meta.admins) || []).filter((x) => !String(x).includes("@"));   // メールアドレスはインターンの画面に出さない
    return a.length ? `管理者（${a.slice(0, 4).join("・")}${a.length > 4 ? " ほか" : ""}）` : "管理者"; }
  function emptyText() {
    const W = S.why || {}; const ask = adminsText();
    if (S.skippedInQueue) return { html: `今回飛ばした企業を除くと、かける企業はありません。<br>飛ばした企業は、このタブを閉じるまで表示しません。` };
    if (S.stop === "ban") return { retry: 30000, html: `アプローチ禁止の名簿を読めないため、安全のため「かける」を止めています（禁止の会社にかけてしまわないように）。<br>30秒ごとに自動で読み直します。5分たっても直らないときは、${esc(ask)}に知らせてください。` };
    if (!S.lists.length) {
      if (S.admin) return { html: `まだ架電リストがありません。<br><button class="mcc-btn primary" id="mccGoLists" style="margin-top:12px">リストを作る</button>` };
      if (W.kind === "notIntern") return { html: `あなた（kinbot の名前「${esc(W.name || "")}」）は、まだ MOCHICA の架電メンバーと判定されていません。<br>${esc(ask)}に「kinbot の名前を SF の氏名にそろえる」か「メンバー設定で kincall だけ＋事業 MOCHICA にする」を頼んでください。` };
      if (W.kind === "notMember") return { html: `MOCHICA の架電リストはありますが、あなたはどのリストのメンバーにも入っていません。<br>${esc(ask)}に、リストのメンバーに入れてもらってください。` };
      return { html: `まだ担当の架電リストがありません。<br>${esc(ask)}がリストを作ってあなたを入れると、ここに出ます。` };
    }
    if (S.noTalk && S.noTalk.length && !S.researching && !S.later) {
      // 管理者は「リストの管理」へ移らずに、その場でトークを写す・書けるようにする（2026-11-25 福井さん「困った」：BALES から移したリストを出したらここで止まった）
      const tl = S.admin ? (S.noTalkLists || []).slice(0, 3) : [];
      const btns = tl.map((l) => `<div style="margin-top:10px">${tl.length > 1 ? `${esc(l.name)}：` : ""}<button class="mcc-btn primary" data-tcopy="${l.id}">いま使っているトークを写す</button> <button class="mcc-btn" data-twrite="${l.id}">トークを書く</button></div>`).join("");
      return { html: `トーク（売り方）が決まっていないリストはかけられません：${esc(S.noTalk.join("・"))}<br>${S.admin ? (btns ? "ほかのリストで使っているトークを写すか、このリスト用に書いてください。" : "「リストの管理」の「トーク」で書いてください。") : `${esc(ask)}にトークを書いてもらってください。`}${btns}` };
    }
    if (S.researching) return { retry: 8000, html: `企業調査が終わった会社から順に出ます（いま ${S.researching}件 を調べています）。<br>少しすると自動で次の会社が出ます。` };
    // 今日かけるリストの人は、空になった本当の理由（今日の分の残り）と、すぐできること（ほかのリストを選ぶ）を出す（2026-11-25 福井さん）。
    //   前は「残りの119件はほかの人の担当です」と出ていたが、それはほかのインターンの今日の分で、付け直しても直らず、本人も管理者も何をすればよいか分からなかった
    // 検討時期待ち（2026-11-25）：外している理由を黙らずに出す
    const HELD_TXT = "検討時期の2か月前まで待っています（リスト管理の「検討時期待ち」で見られます。情報が1年以上前の会社はかけられます）。";
    const t = !S.listId && S.today;
    if (t) {
      const left = Number(t.left || 0), n = Number(t.n || 0);
      const lines = [
        left ? `今日かけるリストのあなたの分は 残り <b>${left}件</b>／${n}件 ですが、いまはどれもかけられません（掛け直しの時刻待ち・ほかの人が開いている）。` : `今日かけるリストのあなたの分（${n}件）は、今かけられる会社をかけ終わりました。`,
        W.locked ? `<b>${W.locked}件</b> はほかの人が開いています（10分たつと戻ります）。` : "",
        t.held ? `<b>${t.held}件</b> は ${HELD_TXT}` : "",
        S.later ? `今日このあと掛け直す企業が <b>${S.later}件</b> あります（時刻が来たら先頭に並びます）。` : "",
        `上の「リスト」でほかのリストを選ぶと、そこからかけられます。${left ? "" : S.admin ? "今日の分を足すときは「リスト管理」で今日かけるリストを作り直してください。" : `今日の分が足りないときは、${esc(ask)}に今日かけるリストの作り直しを頼んでください。`}`,
      ].filter(Boolean);
      return { retry: 60000, html: `今かける企業はありません。<br>${lines.join("<br>")}<br><button class="mcc-btn" id="mccReload" style="margin-top:12px">もう一度読む</button>` };
    }
    // ほかの人の今日かけるリストの分は、その人が今日かけるので付け直しを勧めない（2026-11-25 福井さん「困った」：「214件はほかの人の担当。付け直して」と出たが、
    //   中身はインターンの今日の分で、付け直すとその人の今日の分が減ってしまう）
    const tOth = Math.min(Number(W.todayOthers || 0), Number(W.others || 0)), oth = Number(W.others || 0) - tOth;
    const more = [
      tOth ? `<b>${tOth}件</b> は、ほかの人の今日かけるリストの分です（その人が今日かけるので、付け直さなくてよいです）。` : "",
      oth ? `${tOth ? "そのほかの" : "残りの"} <b>${oth}件</b> はほかの人の担当です。${S.admin ? "「リストの管理」で担当を付け直してください。" : `${esc(ask)}に、担当の付け直しかリードの追加を頼んでください。`}` : "",
      tOth && !oth ? `上の「リスト」でリストを1本選ぶと、そのリストのまだ担当の付いていない会社からかけられます。` : "",
      W.locked ? `<b>${W.locked}件</b> はほかの人が開いています（10分たつと戻ります）。` : "",
      W.held ? `<b>${W.held}件</b> は ${HELD_TXT}` : "",
      S.later ? `今日このあと掛け直す企業が <b>${S.later}件</b> あります（時刻が来たら先頭に並びます）。` : "",
      !W.others && !W.locked && !S.later && !W.held ? `このリストは、今かけられる会社をかけ終わりました。${S.admin ? "リードを足してください。" : `${esc(ask)}にリードを足してもらってください。`}` : "",
    ].filter(Boolean);
    return { retry: W.locked || S.later ? 60000 : 0, html: `今かける企業はありません。<br>${more.join("<br>")}<br><button class="mcc-btn" id="mccReload" style="margin-top:12px">もう一度読む</button>` };
  }
  function empty() {
    S.d = null; S.f = null;
    syncCallTools();
    $("mccLeft").innerHTML = ""; ["mccTalk", "mccWork", "mccTl"].forEach((id) => { $(id).innerHTML = ""; }); if (memoEl) { memoEl.innerHTML = ""; memoEl._f = null; }
    $("mccCenter").classList.remove("mcc-scheduling");
    const t = emptyText();
    $("mccCenter").innerHTML = `<div class="mcc-empty">${t.html}</div>`;
    const g = $("mccGoLists"); if (g) g.addEventListener("click", () => setTab("lists"));
    clearTimeout(S.waitT); if (t.retry) S.waitT = setTimeout(() => { if (!S.d && S.tab === "call") loadQueue(true); }, t.retry);
    const r = $("mccReload"); if (r) r.addEventListener("click", () => loadQueue(true));
    $("mccCenter").querySelectorAll("[data-tcopy]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      try { const j = await api(`/api/mccall/lists/${b.dataset.tcopy}/talks/copy`, { method: "POST" }); toast(`「${j.from}」のトークを写しました`); await loadLists(); loadQueue(true); }
      catch (e) { toast(e.message); b.disabled = false; }
    }));
    $("mccCenter").querySelectorAll("[data-twrite]").forEach((b) => b.addEventListener("click", () => {
      const id = +b.dataset.twrite; talkDialog(S.lists.find((l) => l.id === id) || { id, name: (S.noTalkLists.find((l) => l.id === id) || {}).name || "" });
    }));
    setNotice([]);
  }

  // ---- 1社を開く（先読みしてあればすぐ出し、裏で最新を読み直す） ----
  async function open(id) {
    const cached = S.cache.get(id);
    S.f = blankForm(); S.fill = null; S.f.memo = ls.get(memoKey(id)) || "";
    if (cached) { S.d = cached; drawAll(); }
    else { $("mccCenter").innerHTML = `<div class="mcc-empty">読み込んでいます…</div>`; }
    try {
      const d = await api(`/api/mccall/leads/${id}?lock=1${S.inbound && S.inbound.leadId === id ? `&inbound=${S.inbound.id}` : ""}`); S.cache.delete(id);
      if (S.d && S.d.lead.id === id && cached) { S.d = d; drawLeft(); drawRight(); drawNotices(); } else { S.d = d; drawAll(); }
      S.f.phone = (d.phones[0] && d.phones[0].number) || d.lead.phone || "";
      queueFill(0); if (!S.lst || S.lst.leadId !== id) loadStatus(id);
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
  function drawAll() { drawLeft(); drawMemo(); drawCenter(); drawRight(); drawNotices(); ["mccLeft", "mccCenter", "mccRight"].forEach((id) => { const e = $(id); if (e) e.scrollTop = 0; }); }

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
      if (S.d && S.d.lead.id === it.lead_id) { drawCenter(); drawTalk(); drawWork(); drawNotices(); return; }
      const cur = S.d;
      if (cur) { release(); S.queue = S.queue.filter((x) => x.id !== cur.lead.id); S.queue.unshift({ id: cur.lead.id, company: cur.lead.company }); }
      await open(it.lead_id);
    } catch {} finally { S.inPoll = false; }
  }

  // ---- 会社を探してかける（2026-11-24 福井さん「検索して架電できるように」） ----
  //   かける順番を待たずに、会社名・電話・担当者で探した会社を開く。探せるのは /queue と同じく、自分がかけてよいリストの
  //   担当が空か自分のリード（/api/mccall/browse）。いまの会社は、発信していなければ先頭に戻す（記録し終えたら戻ってくる）。
  //   発信したのに記録していない会社からは移らない（記録が抜けるのを防ぐ）
  function findBox() {
    const q = $("mccFindQ"), list = $("mccFindList"); let tmr = 0, seq = 0;
    const hide = () => { list.hidden = true; list.innerHTML = ""; };
    async function search() {
      const v = q.value.normalize("NFKC").trim(); const my = ++seq;
      if (v.length < 2) { hide(); return; }
      list.hidden = false; list.innerHTML = `<div class="mcc-note" style="margin:0;padding:8px 10px">探しています…</div>`;
      // いま選んでいる商材のリストだけ探す（MOCHICA でかけているときにキャリミキの会社が出ないように。2026-11-25）
      const prod = S.listId === -1 || isCm(S.lists.find((l) => l.id === S.listId)) ? "careermixer" : "mochica";
      let j; try { j = await api(`/api/mccall/browse?${new URLSearchParams({ q: v, st: "open", sort: "hot", prod })}`); }
      catch (e) { if (my === seq) list.innerHTML = `<div class="mcc-note" style="margin:0;padding:8px 10px">探せませんでした：${esc(e.message)}</div>`; return; }
      if (my !== seq) return;
      const items = (j.items || []).slice(0, 20);
      if (!items.length) { list.innerHTML = `<div class="mcc-note" style="margin:0;padding:8px 10px">「${esc(v)}」に合う会社がありません。かけ終わった会社と、ほかの人に割り振られた会社は出ません。</div>`; return; }
      list.innerHTML = items.map((r) => `<button type="button" class="mcc-find-row" role="option" data-fid="${r.id}">
          <b>${esc(r.company || "（会社名なし）")}</b><small>${esc([r.person, r.phone, r.list].filter(Boolean).join("・"))}</small>
          <small>${r.attempts ? `${r.attempts}回 かけた${r.outcome ? `・前回 ${esc(r.outcome)}` : ""}` : "まだかけていない"}${r.busy ? "・ほかの人が開いています" : ""}</small></button>`).join("")
        + (j.total > items.length ? `<div class="mcc-note" style="margin:0;padding:6px 10px">ほかに ${j.total - items.length}件あります。言葉を足して絞ってください。</div>` : "");
      list.querySelectorAll("[data-fid]").forEach((b) => b.addEventListener("click", () => pick(+b.dataset.fid)));
    }
    async function pick(id) {
      if (S.d && S.d.lead.id === id) { hide(); q.value = ""; return; }
      if (S.d && S.f && S.f.dialed) { toast(`いまの会社（${S.d.lead.company || ""}）に発信しています。結果を記録してから開いてください`); return; }
      hide(); q.value = ""; q.blur();
      const cur = S.d;
      if (cur) { release(); S.queue = S.queue.filter((x) => x.id !== cur.lead.id); S.queue.unshift({ id: cur.lead.id, company: cur.lead.company }); }
      S.queue = S.queue.filter((x) => x.id !== id);
      await open(id);
    }
    q.addEventListener("input", () => { clearTimeout(tmr); tmr = setTimeout(search, 300); });
    q.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { hide(); q.value = ""; q.blur(); }
      if (e.key === "Enter") { e.preventDefault(); const f = list.querySelector("[data-fid]"); if (f) pick(+f.dataset.fid); }
    });
    document.addEventListener("click", (e) => { if (!e.target.closest("#mccFind")) hide(); });
  }

  // 自動音声の案内（前の架電の録音から読んだもの）。番号ごとに覚えているので、いまかける番号のものを出す
  const telKey = (v) => { let x = String(v || "").normalize("NFKC").replace(/[^0-9]/g, ""); if (/^81\d{9,10}$/.test(x)) x = "0" + x.slice(2); return x; };
  function ivrHtml(L, ph) {
    const v = L.ivr && L.ivr[telKey(ph)]; if (!v || !v.items || !v.items.length) return "";
    return `<div class="mcc-ivr" aria-label="自動音声の案内"><b>自動音声</b>${v.items.map((x) => `<span><kbd>${esc(x.press)}</kbd>${esc(x.for)}</span>`).join("")}<small>前の録音から（${esc(day(v.at))}）</small></div>`;
  }

  // 企業調査（2026-11-20 福井さん「調べなくても情報がまとまっている状態をすべてのリードで」）。ASUMO の企業調査と同じ項目
  // 調査中で開いた会社は、調べ終わるまで10秒ごとに企業調査だけを読み直す（最大2分。別の会社に移ったらやめる）
  function watchResearch(id) {
    if (S.rWatch === id) return; S.rWatch = id; let n = 0;
    const tick = async () => {
      if (!S.d || S.d.lead.id !== id || S.rWatch !== id || ++n > 12) { if (S.rWatch === id) S.rWatch = null; return; }
      try { const j = await api(`/api/mccall/leads/${id}/research`); if (j.research && S.d && S.d.lead.id === id) { S.d.lead.research = j.research; S.rWatch = null; drawLeft(); return; } } catch {}
      setTimeout(tick, 10000);
    };
    setTimeout(tick, 10000);
  }
  function researchHtml(L) {
    const r = L.research;
    if (!r) { watchResearch(L.id); return `<div class="mcc-research"><h3>企業調査<span class="mcc-badge" style="margin-left:6px">調査中</span></h3><p class="mcc-note">いま調べています。<b>待たずにかけて大丈夫です</b>（調べ終わると、ここに出ます）。</p></div>`; }
    if (r.status === "error") return `<div class="mcc-research"><h3>企業調査</h3><p class="mcc-note">調べられませんでした（${esc(r.error || "理由不明")}）。下の情報を見てかけてください。</p></div>`;
    // 話すときに使う4つだけ見せ、会社の基本はたたむ（2026-11-23 福井さん）。
    //   採用人数はマイナビの採用予定人数と、電話で確かめることは中央の「この1本で確定させること」と重なるので出さない
    const kvs = (o) => `<dl class="mcc-kv">${o.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
    const rows = [["採用の実態", r.hiring], ["募集職種", r.roles], ["推定採用課題", r.issue]].filter(([, v]) => v);
    const more = [["事業", r.biz], ["求人媒体", r.media], ["従業員", r.employees], ["所在地", r.location], ["設立", r.founded]].filter(([, v]) => v);
    const src = (r.sources || []).slice(0, 3).map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener">出典${i + 1}</a>`).join(" ");
    return `<div class="mcc-research"><h3>企業調査<small>Web から調べた参考情報（${esc(day(r.at))}）。採用の情報は今の募集と確かめられたものだけ</small></h3>
      ${r.hook ? `<div class="mcc-hook"><small>話の切り口</small>${esc(r.hook)}</div>` : ""}
      ${r.recruitHidden ? `<p class="mcc-note">採用の情報（媒体・職種・人数）は、${r.recruitHidden === "stale" ? "調べてから日が経ったので" : "今の募集か確かめる前の調べなので"}出していません。調べ直しが済むと出ます。</p>` : ""}
      ${rows.length ? kvs(rows) : r.hook || more.length ? "" : '<p class="mcc-note">Web で分かることはほとんどありませんでした。</p>'}
      ${more.length || src ? `<details class="mcc-more"><summary>事業・従業員・所在地・設立${src ? "・出典" : ""}</summary>${more.length ? kvs(more) : ""}${src ? `<p class="mcc-note">${src}</p>` : ""}</details>` : ""}</div>`;
  }

  // ひと目で：採用ニーズ・検討時期・前回までの架電（2026-11-18 福井さん「架電時に調べなくても一目でわかるように」）
  //   ニーズと時期は SF の項目＋過去の記録の文から見つけた1文（出どころと日付つき）。無ければ「まだ聞けていない」と聞くことを促す
  function glanceHtml(d) {
    const g = d.glance || {};
    const row = (lbl, x, ask) => { x = x || {}; const h = x.hit; const st = (x.kb && x.kb.length) || (x.sf && x.sf.length) || (h && h.st === "あり") ? "ok" : h && h.st === "なし" ? "no" : "yet";
      const body = [x.kb && x.kb.length ? `<div><small>架電で聞いた${x.by ? ` ${esc(day(x.by.at))} ${esc(x.by.who)}` : ""}</small>${x.kb.map(([k, v]) => k === "採用ニーズ" || k === "検討時期" ? esc(v) : `${esc(k.replace("説明会・面接の参加人数", "説明会・面接の参加"))} ${esc(v)}`).join("／")}</div>` : "", ...(x.sf || []).map(([k, v]) => `<div><small>SF ${esc(k)}</small>${esc(v)}</div>`),
        h ? `<div><small>${esc(h.src)}${h.at ? ` ${esc(day(h.at))}` : ""}${h.who ? ` ${esc(h.who)}` : ""}${h.st === "なし" ? "（無いと言われた）" : ""}</small>「${esc(h.why)}」</div>` : ""].join("");
      return `<div class="mcc-gl-row ${st}"><b>${lbl}</b><div>${body || `<span class="mcc-gl-yet">まだ聞けていません。${ask}</span>`}</div></div>`; };
    // 前回までの架電は、中央の「前回」と右の「これまで」と同じ中身なので、ここには出さない（2026-11-23 福井さん）
    return `<div class="mcc-glance"><h3>ひと目で</h3>
      ${row("採用ニーズ", g.need, "採用で困っていること・人数を聞く")}${row("検討時期", g.when, "いつ頃から考えるか・更新月を聞く")}
      ${mynaviHtml(d.mynavi)}</div>`;
  }
  // どの元データが読めなかったか（読めなかったのに「記録なし」に見せないため）
  function histNote(d) {
    const h = d.hist || {}; const NAME = { sf: "SF", zoom: "Zoom Phone", bales: "BALES", doc: "DOC", kinbot: "MOCHICA の別リスト" };
    const ng = Object.entries(h).filter(([, v]) => v && (!v.ok || v.err)).map(([k, v]) => `${NAME[k] || k}：${v.err || "読めませんでした"}`);
    // 過去の履歴を伏せるリストは、ほかの人の記録が無いのではなく伏せていると分かるように出す
    const bl = d.blind ? '<p class="mcc-note">このリストは過去の架電履歴を伏せています。出ているのはあなたの記録だけです。</p>' : "";
    return bl + (ng.length ? `<div class="mcc-gl-warn">${ng.map(esc).join("<br>")}</div>` : "");
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
  // BALES の未完了次回アクションのうち最も早い予約（予約日時がなければコメント付き先頭）を返す
  function balesNext(data = {}) {
    const byIdx = new Map();
    for (const [k, v] of Object.entries(data || {})) {
      const m = /^nextActions\.(\d+)\.(.+)$/.exec(k);
      if (!m) continue;
      const i = Number(m[1]);
      if (!byIdx.has(i)) byIdx.set(i, { i });
      byIdx.get(i)[m[2]] = v;
    }
    const open = [...byIdx.values()].filter((x) => String(x.isDone) !== "true");
    if (!open.length) return null;
    const s = (v) => (v == null ? "" : String(v).trim());
    const items = open.sort((a, b) => a.i - b.i).map((x) => {
      const reservedAt = s(x.reservedAt), parsed = reservedAt ? Date.parse(reservedAt) : NaN;
      return {
        reservedAt,
        t: Number.isFinite(parsed) ? parsed : null,
        name: s(x.name) || s(x["actionType.name"]) || s(x.actionTypeName),
        comment: s(x.content) || s(x.comment) || s(x.memo) || s(x.note) || s(x.body) || s(x.text),
        owner: s(x["owner.name"]) || s(x.ownerName) || s(x["user.name"]) || s(x.userName)
      };
    });
    const timed = items.filter((x) => x.t != null).sort((a, b) => a.t - b.t);
    return timed[0] || items.find((x) => x.comment || x.name) || null;
  }
  function nxSummaryHtml(d) {
    if (!d || d.blind) return "";
    const L = d.lead || {}, nx = balesNext(L.data || {});
    const text = nx && (nx.reservedAt || nx.comment)
      ? [nx.reservedAt ? tm(nx.reservedAt) : "", nx.name, nx.comment].filter(Boolean).join("　")
      : (L.next_why && L.next_why !== "記録した人が決めた時刻" && L.next_why !== "BALES で入れていた次のコールの予定" ? L.next_why : "");
    return text ? `<div class="mcc-sum-nx"><small>次回</small>${esc(text)}</div>` : "";
  }
  function drawLeft() {
    const d = S.d; if (!d) return; const L = d.lead; const g = L.gate || {};
    const sf = d.sf && d.sf.lead ? d.sf.lead : null; const sum = d.sf && d.sf.sum;
    const sfRows = sf ? Object.entries(sf).filter(([k, v]) => v && !["id", "name", "company", "created", "converted"].includes(k) && /status|owner|失注|課題|検討|更新|利用|現状/i.test(k)).slice(0, 8) : [];
    const kv = (o) => o.length ? `<dl class="mcc-kv">${o.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>` : "";
    const nk = { status: "リードの状態", owner: "SF の所有者" };
    const data = L.data || {}, nx = !d.blind ? balesNext(data) : null;
    const nxLabel = nx ? [nx.reservedAt ? tm(nx.reservedAt) : "", nx.name, nx.owner ? `(${nx.owner})` : ""].filter(Boolean).join(" ") : "";
    const lastCmt = !d.blind ? (data.lastActivityComment || data.lastCalledComment || "") : "";
    const bales = [["最終活動", data.lastActivityAt ? tm(data.lastActivityAt) : ""], ["活動の種類", data.lastActivityTypeText], ["最終コメント", lastCmt], ["次回アクション", nxLabel], ["次回アクションコメント", nx ? nx.comment : ""], ["所有者", data.operatorName], ["DOC のリスト", data.list_name], ["DOC の担当", data.assigned_to], ["業種", data.industry]].filter(([, v]) => v);
    // 電話番号は1本だけなら中央の発信ボタンと同じなので出さない（使えない番号のときは、それが分かるよう出す）。
    //   受付で聞けたこと（担当者名・いる時間・直通）は、担当者名の行にまとめる（下に同じ名前をもう一度出して1段使っていた。2026-11-23 福井さん「左と真ん中のスクロールをなくしたい」）
    $("mccLeft").innerHTML = `
      <p class="mcc-co">${esc(L.company || "会社名なし")} <button class="mcc-btn mcc-edit" id="mccEdit" title="会社・担当者・電話・メールを直す">${ICO.edit}直す</button></p>
      <div class="mcc-person">${esc(g.name || L.person || "担当者名はまだ分かりません")}${g.name && L.person && g.name !== L.person ? `<small style="color:var(--c-muted);font-weight:600">（リストでは ${esc(L.person)}）</small>` : ""}</div>
      ${g.hours || g.direct || g.biz ? `<div class="mcc-gatei">${g.hours ? `<span>いる時間 <b>${esc(g.hours)}</b></span>` : ""}${g.direct ? `<span>直通・内線 <b>${esc(g.direct)}</b></span>` : ""}${g.biz ? `<span>営業時間 <b>${esc(g.biz)}</b></span>` : ""}</div>` : ""}
      <div class="mcc-badges">${hotBadge(L.hot)}${L.cross_from ? `<span class="mcc-badge doc">${esc(L.cross_from)} から（部署をまたぐ）</span>` : ""}${d.ban ? '<span class="mcc-badge danger">アプローチ禁止</span>' : ""}${sum && sum.n ? `<span class="mcc-badge sf">SF の商談 ${sum.n}件${sum.won ? "・受注あり" : sum.lost ? "・失注あり" : ""}</span>` : ""}</div>
      ${statusHtml()}
      ${researchHtml(L)}
      ${contactsHtml(L.info, d)}
      ${glanceHtml(d)}
      ${d.phones.length > 1 || (d.phones[0] && d.phones[0].invalid) ? `<h3>電話番号（押すと発信）</h3>
      ${d.phones.map((p, i) => `<a class="mcc-phone ${p.invalid ? "bad" : ""} ${digits(p.number) === digits(S.f && S.f.phone) ? "cur" : ""}" href="${callHref(p.number)}" data-ph="${esc(p.number)}">
        ${i === 0 ? '<span class="mcc-key" aria-hidden="true">C</span>' : ""}<span class="n"><b>${esc(p.number)}</b><small>${esc(p.label)}${p.lastAt ? `・前回 ${esc(p.last)} ${esc(p.lastAt)}` : ""}</small></span>
        <span class="rate">${p.invalid ? "使えない番号" : p.n ? `${p.n}回中 ${p.reached}回つながった` : "まだかけていない"}</span></a>`).join("")}` : ""}
      ${sfRows.length ? `<h3>SF のリード</h3>${kv(sfRows.map(([k, v]) => [nk[k] || k, v]))}` : ""}
      ${L.src === "csv" ? (Object.keys(data).length ? `<details class="mcc-more"><summary>CSV の列（取り込んだままの中身）</summary>${kv(Object.entries(data).slice(0, 30))}</details>` : "") : bales.length ? `<h3>${L.src === "doc" ? "DOC のリスト" : "Bales"}</h3>${kv(bales)}` : ""}`;
    $("mccLeft").querySelectorAll("[data-ph]").forEach((a) => a.addEventListener("click", () => { S.f.phone = a.dataset.ph; S.f.dialed = true; loadSlots(); setTimeout(() => { drawLeft(); drawCenter(); drawTalk(); drawWork(); }, 0); }));
    $("mccEdit").addEventListener("click", editDialog);
    const st = $("mccLst"); if (st) st.addEventListener("change", () => changeStatus(st.value));
    const sn = $("mccSfNew"); if (sn) sn.addEventListener("click", sfNewDialog);
  }
  // リードの状況（SF の Lead.Status）を架電中に変える（2026-11-23 福井さん「リードのリードステージを変更できるように」）。
  //   選択肢は SF の選択リストをそのまま出す。開いた会社ごとに1回だけ読み、選んだらすぐ SF に書く（記録ボタンとは別）
  function statusHtml() {
    const d = S.d; const T = S.lst && S.lst.leadId === d.lead.id ? S.lst : null;
    if (!T) return `<div class="mcc-lst"><span>リードの状況</span><small>読み込んでいます…</small></div>`;
    if (T.err) return `<div class="mcc-lst"><span>リードの状況</span><small class="err">SF から読めませんでした（${esc(T.err)}）</small></div>`;
    // SF のリードと結びついていない会社は、その場で SF のリードを作れる（2026-11-24 福井さん）
    if (!T.options.length) return T.note ? `<div class="mcc-lst"><span>リードの状況</span><small>${esc(T.note)}</small>${T.unlinked ? '<button class="mcc-btn primary" id="mccSfNew" title="SF に MOCHICA のリードを作るか、もうあるリードと結びつけます">SF リードを作る</button>' : ""}</div>` : "";
    // 選べるのは基本の7つ（01〜05・89・99）だけ。今の値が古い名前（「NEW」など）なら「旧」と付けて先頭に出し、どの段階にあたるかを添える（2026-11-24 福井さん）
    const cur = T.options.find((o) => o.value === T.current);
    const opts = cur || !T.current ? T.options : [{ value: T.current, label: `旧：${T.current}` }, ...T.options];
    const lg = !cur && T.current ? T.legacy : null;
    const note = cur ? cur.desc : lg ? (lg.label ? `古い名前の値です（${lg.label} にあたる）。選び直すと基本の7つの名前で入ります` : "基本の7つにない古い値です。選び直すと基本の7つの名前で入ります") : "";
    return `<label class="mcc-lst"><span>リードの状況</span><select class="mcc-sel" id="mccLst" ${T.converted || T.busy ? "disabled" : ""} title="${T.converted ? "コンバート済みのリードなので変えられません" : esc(T.options.map((o) => `${o.label}：${o.desc || ""}`).join("\n"))}">
      ${T.current ? "" : '<option value="" selected>（空）</option>'}${opts.map((o) => `<option value="${esc(o.value)}" ${o.value === T.current ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>${note ? `<small class="mcc-lst-d">${esc(note)}</small>` : ""}</label>`;
  }
  async function loadStatus(id) {
    try { const j = await api(`/api/mccall/leads/${id}/sf-status${isInbound(id) ? `?inbound=${S.inbound.id}` : ""}`); S.lst = { leadId: id, options: j.options || [], current: j.current || "", note: j.note || "", converted: !!j.converted, legacy: j.legacy || null, unlinked: !!j.unlinked }; }
    catch (e) { S.lst = { leadId: id, options: [], err: String(e.message).slice(0, 60) }; }
    if (S.d && S.d.lead.id === id) drawLeft();
  }
  async function changeStatus(v) {
    const T = S.lst; const id = S.d.lead.id; if (!T || T.leadId !== id || v === T.current) return;
    T.busy = true; drawLeft();
    try { const j = await post(`/api/mccall/leads/${id}/sf-status`, { status: v, inbound: isInbound(id) ? S.inbound.id : null }); T.current = j.current; toast(`SF のリードの状況を「${j.current}」にしました${j.prev ? `（前は「${j.prev}」）` : ""}`); }
    catch (e) { toast(`リードの状況を変えられませんでした：${e.message}`); }
    T.busy = false; if (S.d && S.d.lead.id === id) drawLeft();
  }
  // SF のリードを作る・結びつける（2026-11-24 福井さん）。重複を作らないよう、SF に同じ会社の MOCHICA のリードがあれば先に見せる
  async function sfNewDialog() {
    if (!S.d) return; const L = S.d.lead; const id = L.id; const ib = isInbound(id) ? S.inbound.id : null;
    let j; try { j = await api(`/api/mccall/leads/${id}/sf-create${ib ? `?inbound=${ib}` : ""}`); } catch (e) { toast(`SF を確かめられませんでした：${e.message}`); return; }
    const F = j.fields || {}; const cs = j.cands || [];
    const done = async (r) => {
      S.cache.delete(id); S.lst = null;
      const d = await api(`/api/mccall/leads/${id}`); if (S.d && S.d.lead.id === id) { S.d = d; drawLeft(); drawNotices(); }
      loadStatus(id); toast(r.made ? "SF に MOCHICA のリードを作って結びつけました" : "SF のリードと結びつけました");
    };
    const candHtml = cs.length ? `<div class="mcc-note" style="margin-top:10px"><b>SF に似た MOCHICA のリードがあります。同じ会社なら「結びつける」を押してください（重複を作らないため）</b></div>
      <div style="display:grid;gap:6px;margin-top:6px">${cs.map((c) => `<div class="mcc-erow" style="align-items:center"><div style="flex:1;min-width:0"><b>${esc(c.company)}</b>${c.samePhone ? ' <small style="color:#0d5b47">電話が同じ</small>' : ""}<br><small>${esc([c.person, c.phone, c.status, c.owner ? `持ち主 ${c.owner}` : "", c.last ? `最後の活動 ${c.last}` : ""].filter(Boolean).join("・"))}${c.converted ? "・コンバート済み" : ""}${c.ban ? `・アプローチ禁止（${esc(c.ban)}）` : ""}</small></div>${c.converted || c.ban ? "<small>結びつけられません</small>" : `<button class="mcc-btn" data-link="${esc(c.id)}">結びつける</button>`}</div>`).join("")}</div>` : "";
    const w = dialog(`SF リードを作る：${L.company || ""}`, "SF に MOCHICA のリード（レコードタイプ「Mochica（リード）」）を作り、この会社と結びつけます。結びつけると、リードの状況を変えられ、記録が SF の活動にも残ります。", "SF に作る", async (w) => {
      const v = (s) => w.querySelector(s).value.trim();
      const r = await post(`/api/mccall/leads/${id}/sf-create`, { inbound: ib, fields: { company: v("#mccNCo"), person: v("#mccNPe"), phone: v("#mccNPh"), email: v("#mccNMa"), web: v("#mccNWeb"), industry: v("#mccNInd") } });
      await done(r);
    }, `${j.candErr ? `<p class="mcc-note" style="color:#B4441F">${esc(j.candErr)}</p>` : ""}${candHtml}<div style="display:grid;gap:8px;margin-top:12px">
      <label class="mcc-field">会社名<input id="mccNCo" value="${esc(F.company)}" /></label>
      <label class="mcc-field">担当者名（空なら「ご担当者」で作ります）<input id="mccNPe" value="${esc(F.person)}" /></label>
      <label class="mcc-field">電話<input id="mccNPh" inputmode="tel" value="${esc(F.phone)}" /></label>
      <label class="mcc-field">メール<input id="mccNMa" type="email" value="${esc(F.email || ((S.d.mails || [])[0] || {}).addr || "")}" /></label>
      <label class="mcc-field">Web ページ<input id="mccNWeb" type="url" value="${esc(F.web)}" /></label>
      <label class="mcc-field">業種（SF で必須）<select id="mccNInd" class="mcc-sel"><option value="">選んでください</option>${(j.industries || []).map((o) => `<option value="${esc(o.value)}">${esc(o.label || o.value)}</option>`).join("")}</select><small id="mccNIndNote" style="color:var(--c-muted)">業種を調べています…</small></label></div>`);
    const indSel = w.querySelector("#mccNInd"), indNote = w.querySelector("#mccNIndNote");
    const guessIndustry = async () => {
      const company = w.querySelector("#mccNCo")?.value.trim() || "";
      const website = w.querySelector("#mccNWeb")?.value.trim() || "";
      if (!company || !indSel || indSel.value) return;
      try {
        const q = new URLSearchParams({ company, website });
        const g = await api(`/api/salesforce/industry-guess?${q}`);
        if (indSel.value) return;
        if (g.industry && !indSel.value && [...indSel.options].some((o) => o.value === g.industry)) {
          indSel.value = g.industry;
          indNote.textContent = `業種は${g.from || "見立て"}から「${g.industry}」を選びました${g.reason ? `（${g.reason}）` : ""}。違っていたら直してください。`;
        } else indNote.textContent = "業種を特定できませんでした。選んでください。";
      } catch { indNote.textContent = ""; }
    };
    guessIndustry();
    w.querySelectorAll("[data-link]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      try { const r = await post(`/api/mccall/leads/${id}/sf-create`, { inbound: ib, link: b.dataset.link }); w.remove(); S.dlg = null; await done(r); }
      catch (e) { b.disabled = false; toast(`結びつけられませんでした：${e.message}`); }
    }));
  }
  // MOCHICALL で足した担当者とメール（2026-11-18 福井さん「会社・担当者情報の編集と複数番号」）
  //   メールは MOCHICALL で直した値だけでなく、SF のリードの今の Email・BALES/DOC/CSV の中身も出す（サーバーの mcmail.js で集めた d.mails。
  //   2026-11-24 浦田空調工業：SF にメールがあるのに出ていなかった）。どこから来たメールかを横に添える。足した担当者のメールは名前の横に出す
  function contactsHtml(info, d = {}) {
    const I = info || {}; const cs = I.contacts || [];
    const ms = (d.mails || []).filter((m) => m.src !== "contact");
    if (!cs.length && !ms.length && !d.mailErr && !I.web && !I.corp) return "";
    return `<div class="mcc-contacts">${ms.map((m) => `<div><small>メール</small>${esc(m.addr)}<span>${esc(m.label)}</span></div>`).join("")}${d.mailErr && !ms.some((m) => m.src === "sf") ? `<div style="color:var(--c-warn)"><small>メール</small>${esc(d.mailErr)}</div>` : ""}${I.web ? `<div><small>Web</small><a href="${esc(/^https?:/i.test(I.web) ? I.web : `https://${I.web}`)}" target="_blank" rel="noopener">${esc(I.web)}</a></div>` : ""}${I.corp ? `<div><small>法人番号</small>${esc(I.corp)}</div>` : ""}${cs.map((c) => `<div><b>${esc(c.name || "名前なし")}</b>${c.role ? `<small>${esc(c.role)}</small>` : ""}${c.email ? `<span>${esc(c.email)}</span>` : ""}</div>`).join("")}</div>`;
  }
  // 会社・担当者の情報を直す。番号と担当者は行を足して増やせる（BALES と同じく1社に何人・何本でも持てるように）
  function editDialog() {
    if (!S.d) return; const L = S.d.lead; const I = L.info || {};
    const phRow = (p = {}) => `<div class="mcc-erow" data-row="ph"><input placeholder="名前（例：人事部直通）" value="${esc(p.label || "")}" data-k="label" /><input placeholder="電話番号" inputmode="tel" value="${esc(p.number || "")}" data-k="number" /><button class="mcc-btn" data-del title="この行を消す">消す</button></div>`;
    const ctRow = (c = {}) => `<div class="mcc-erow four" data-row="ct"><input placeholder="名前" value="${esc(c.name || "")}" data-k="name" /><input placeholder="部署・役職" value="${esc(c.role || "")}" data-k="role" /><input placeholder="電話" inputmode="tel" value="${esc(c.phone || "")}" data-k="phone" /><input placeholder="メール" type="email" value="${esc(c.email || "")}" data-k="email" /><button class="mcc-btn" data-del title="この行を消す">消す</button></div>`;
    const w = dialog(`情報を直す：${L.company || ""}`, "kinbot の架電リストの情報を直します（Bales・SF の元のデータは変わりません）。直した番号はすぐ左の「電話番号」に出ます。", "保存する", async (w) => {
      const v = (id) => w.querySelector(id).value.trim();
      const rows = (k) => [...w.querySelectorAll(`[data-row="${k}"]`)].map((r) => Object.fromEntries([...r.querySelectorAll("[data-k]")].map((i) => [i.dataset.k, i.value.trim()])));
      const save = async (extra = {}) => {
        await api(`/api/mccall/leads/${L.id}`, { method: "PATCH", body: JSON.stringify({ company: v("#mccECo"), person: v("#mccEPe"), phone: v("#mccEPh"), email: v("#mccEMa"), web: v("#mccEWeb"), corp: v("#mccECorp"), phones: rows("ph"), contacts: rows("ct"), ...extra }) });
        S.cache.delete(L.id); const d = await api(`/api/mccall/leads/${L.id}`);
        if (S.d && S.d.lead.id === L.id) { S.d = d; drawLeft(); drawNotices(); }
      };
      w.querySelector(".mcc-dupfix")?.remove();
      const pend = []; // 消すと決めた元のリード（ほかにも重複があったときに、まとめて送る）
      try { await save(); toast("情報を直しました"); }
      catch (e) {
        const dup = e.data && e.data.dup; if (!dup) throw e;
        w.querySelector("[data-ok]").disabled = false;   // 窓を開いたままにするので、保存ボタンを押せる状態に戻す
        showDup(e, dup);
        return false;
      }
      function showDup(e, dup) {
        w.querySelector(".mcc-dupfix")?.remove();
        // 重複したとき（2026-11-25 福井さん）：同じ会社なら、SF のつなぎ先を元のリードのものに変えて、元のリードを SHOBO から消して保存できるようにする
        const sfNote = dup.sf ? (dup.mySf && dup.mySf !== dup.sf ? `SF のつなぎ先を ${dup.mySf} から、元のリードの ${dup.sf} に変えます。` : `SF のつなぎ先を、元のリードの ${dup.sf} にします。`) : "元のリードは SF とつながっていないので、SF のつなぎ先はこのままです。";
        const box = Object.assign(document.createElement("div"), { className: "mcc-note mcc-dupfix" });
        box.style.cssText = "margin-top:10px;padding:10px;border:1px solid #B4441F;border-radius:10px;color:#B4441F";
        box.innerHTML = `<b>${esc(e.message)}</b><br><span style="color:var(--c-text,#222)">${pend.length ? `選んだ ${pend.length} 件のほかにも重複がありました。` : ""}同じ会社なら、元のリード「${esc(dup.company)}」${dup.list ? `（リスト「${esc(dup.list)}」）` : ""}をこちらにまとめて保存できます。${esc(sfNote)}元のリードの架電の記録はこちらへ移し、元のリードは SHOBO から消します（SF のリードは消えません。元に戻せません）。</span>
          <div style="margin-top:8px"><button class="mcc-btn" data-dupfix>SF のつなぎ先を変えて、元のリードを消して保存</button></div>`;
        w.querySelector(".row").before(box);
        const fb = box.querySelector("[data-dupfix]");
        fb.addEventListener("click", async () => {
          fb.disabled = true;
          try { await save({ replaceDup: [...pend, dup.id] }); w.remove(); S.dlg = null; toast("元のリードをまとめて消し、情報を直しました"); }
          catch (e2) {
            fb.disabled = false;
            if (e2.data && e2.data.dup && e2.data.dup.id !== dup.id && pend.length < 4) { pend.push(dup.id); showDup(e2, e2.data.dup); }
            else toast(`保存できませんでした：${e2.message}`);
          }
        });
      }
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
    // 1段目に結果の10個を直に並べる。言葉は SF の「活動の結果」・kincall・Bales と同じ（2026-11-23 福井さん「選択肢はこの10個に」）。
    //   担当者と話せたかを先に聞く段はなくした（結果の言葉に「担当者接触」が入っているので、1回押せば決まる）。
    //   つながらない・不在・営業時間外は押した瞬間に記録して次へ（メモは書かない。2026-11-20 福井さん）
    //   担当者につながったあとは、担当者と話せたときの4つ（お断り・アポ獲得・営業フォロー・資料送付）だけにする（下に日程の候補を出す場所を空けるため）
    if (f.step === "reach") return resList();
    if (f.step === "outcome") return Object.entries(R[f.reach].outcomes).map(([k, l]) => ({ k, label: l, cls: k === "apo" ? "good" : k === "reject" || k === "invalid" ? "bad" : "" }));
    if (f.step === "reason") return S.meta.rejectReasons.map((r) => ({ k: r, label: r }));
    // 受付の断り文句：押すと記録して次へ（メモは押す前に書いておけば一緒に残る）。その他はメモに書いてから記録
    if (f.step === "greason") return (S.meta.gateReasons || []).map((r) => ({ k: r, label: r, sub: r === "その他" ? "メモに書いて記録" : "押すと記録して次へ", cls: r === "その他" ? "" : "bad" }));
    // 不在のときは、いちばん上に「自動で掛け直し」を置く（これまでどおり1を押すだけで記録して次へ進めるように）
    if (f.step === "when") return [...(f.outcome === "absent" ? [{ k: "auto", label: "自動で掛け直し", sub: "押すと記録して次へ" }] : []), ...whenChoices()];
    return [];
  }
  // 1段目の結果の一覧（プルダウンと数字キーで同じ並び）
  function resList() { const R = S.meta.reach; return REACH_KEYS.filter(([k]) => phase() !== "person" || k.startsWith("person:")).map(([k, sub, cls]) => { const [r, o] = k.split(":"); return { k, label: (R[r] && R[r].outcomes[o]) || o, sub, cls }; }); }
  function whenChoices() {
    const now = new Date(); const at = (h, m, addDays = 0) => { const x = new Date(now); x.setDate(x.getDate() + addDays); x.setHours(h, m, 0, 0); return x; };
    const add = (min) => new Date(now.getTime() + min * 60e3);
    return [["30分後", add(30)], ["1時間後", add(60)], ["2時間後", add(120)], ["明日の午前", at(10, 0, 1)], ["明日の午後", at(14, 0, 1)]].map(([l, d]) => ({ k: d.toISOString(), label: l, sub: tm(d) }));
  }
  function laterChips() {
    const now = new Date(); const at = (h, m, addDays) => { const x = new Date(now); x.setDate(x.getDate() + addDays); x.setHours(h, m, 0, 0); return x; };
    return [["明日の午前", at(10, 0, 1)], ["明日の午後", at(14, 0, 1)], ["来週", at(10, 0, 7)], ["1か月後", at(10, 0, 30)]];
  }
  const AUTO = new Set(["no_answer", "busy", "voicemail", "absent", "closed"]);
  // 押した瞬間に記録して次の会社へ進む結果（コールのみ・現在使われておりません）。
  //   担当者不在は 2026-11-23 福井さん「再架電の時間を手動で指定できるように」で、時間を選ぶ段をはさむ（自動の掛け直しは1を押すだけ）。
  //   受付ブロックは断り文句を選ぶ段へ（押すと記録して次へ）。営業時間外は営業時間を残せるよう Enter で記録する
  const INSTANT = new Set(["no_answer", "busy", "voicemail", "invalid"]);
  // 1段目の10個（並びは福井さんの挙げた順）。記録の値（到達:結果）は今までのものを使う。問い合わせは受付で言われることが多いので受付まで、資料送付は担当者と話せたに数える
  const REACH_KEYS = [["gate:blocked", "断り文句を選ぶ", "bad"], ["gate:absent", "掛け直す時間を選ぶ（自動も可）"], ["person:reject", "理由を選ぶ", "bad"], ["person:apo", "日時を選ぶ", "good"],
    ["person:follow", ""], ["none:invalid", "押すと記録して次へ", "bad"], ["none:no_answer", "押すと記録して次へ（自動で掛け直し）"], ["gate:inquiry", "HP のフォームから送る"],
    ["person:doc_send", "メールで資料を送る"], ["none:closed", "営業時間を残して記録（ほかの時間に掛け直し）"]];
  function ready() {
    const f = S.f; if (!f.outcome) return false;
    if ((f.outcome === "reject" || f.outcome === "blocked") && !f.reason) return false;
    if (f.outcome === "apo" && !f.apoAt) return false;
    if (f.outcome === "apo") {
      const check = apoCheckC();
      if (check.block.length || check.budgetBlocked) return false;
    }
    if (f.outcome === "callback_req" && !f.nextAt) return false;
    return true;
  }
  function crumb() {
    const f = S.f, R = S.meta.reach; const p = [];
    // 結果の言葉に到達の段階が入っている（担当者接触：〜）ので、到達の段階は重ねて出さない
    if (f.outcome) p.push(R[f.reach].outcomes[f.outcome]); if (f.reason) p.push(f.reason);
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
  // いまの通話の段階（2026-11-23 福井さん「アポ獲得を押してからでは日程が遅い。担当者に繋がった時点で」「トークの表示タイミングを最適化」）
  //   pre＝発信前／gate＝発信した（受付と話す）／person＝担当者につながった。
  //   トークの段階・右の「聞けたこと」の欄・日程の候補は、この段階に合わせて自動で切り替わる
  const phase = () => { const f = S.f; if (!f || !S.d) return "pre"; if (f.person || f.reach === "person") return "person"; return f.dialed || isInbound(S.d.lead.id) ? "gate" : "pre"; };
  function connect(on) {
    const f = S.f; if (!f || !S.d) return;
    f.person = on; f.talkManual = null; if (on) loadSlots();
    // 担当者につながったら、受付の段階で選んでいた結果は外す（プルダウンには担当者と話せたときの4つしか出なくなるため）
    if (on && f.outcome && f.reach !== "person") Object.assign(f, { reach: "", outcome: "", reason: "", nextAt: "", nextLabel: "", noRetry: false, step: "reach" });
    drawCenter(); drawTalk(); drawWork();
  }
  //   担当者につながったら「前回」と「この1本で確定させること」は隠す（発信前に読むもの。右の「これまで」と「聞けたこと」に同じ中身がある）。
  //   空いた場所に結果の4つと日程の候補を出し、中央をスクロールせずに使えるようにする
  function drawCenter() {
    const d = S.d; if (!d) return; const f = S.f; const L = d.lead;
    const cs = choicesFor(); const P = phase();
    const ph = f.phone || (d.phones[0] && d.phones[0].number) || "";
    // 日程の候補は担当者につながった時点から出す（結果を選ぶ前から、空いている日を言えるように）
    const showSlots = P === "person" && (f.step === "reach" || f.step === "apo");
    // 接続後は、日程と結果を中央に残し、通話中の作業は右のタブから開く。
    const stepLine = P === "person" ? `<button class="mcc-btn" id="mccBack" style="height:28px;padding:0 8px" aria-keyshortcuts="Backspace">${ICO.back}戻る</button><span class="crumb">担当者と話しています</span>`
      : `<button class="mcc-btn primary mcc-connect" id="mccConnect" aria-keyshortcuts="T">${ICO.person}担当者につながった<span class="mcc-key" style="background:rgba(255,255,255,.18);color:#fff;border-color:transparent">T</span></button>`;
    // 発信してからでないと結果を選べない（かけずに記録して次へ進めないように）。折り返しの着信のときは発信しなくてよい
    //   発信したあとは発信ボタンと「飛ばす」を出さない（もう要らず、場所を取るため。2026-11-23 福井さん）
    const canPick = f.dialed || isInbound(L.id);
    const cur = f.outcome ? `${f.reach}:${f.outcome}` : "";
    const rs = resList(); const reasons = S.meta.rejectReasons || [];
    // 書いている途中のメモは、描き直したあとも同じ場所にカーソルを戻す
    const act = document.activeElement; const memoFocus = memoEl && act && memoEl.contains(act) ? act : null;
    const caret = memoFocus && memoFocus.selectionStart != null ? [memoFocus.selectionStart, memoFocus.selectionEnd] : null;
    $("mccCenter").innerHTML = `
      ${P === "person" ? "" : `<div class="mcc-sum"><small>前回</small>${d.summary ? esc(d.summary) : d.blind ? "このリストは過去の履歴を伏せています（あなたの記録はまだありません）" : "この会社に kinbot から架電した記録はまだありません"}${nxSummaryHtml(d)}</div>`}
      ${P === "person" ? "" : planHtml(d)}
      <div class="mcc-callrow">
        ${f.dialed ? `<a class="mcc-dialed" href="${callHref(ph)}" title="切れたときは、押すともう一度かけます">${ICO.phone}${esc(ph)} に発信しました</a>` : ph ? `<a class="mcc-btn primary big" href="${callHref(ph)}" id="mccDial" aria-keyshortcuts="C">${ICO.phone}${esc(ph)} にかける<span class="mcc-key" style="background:rgba(255,255,255,.18);color:#fff;border-color:transparent">C</span></a>` : `<span class="mcc-note">電話番号がありません</span>`}
        ${f.dialed ? "" : `<button class="mcc-btn" id="mccSkip" aria-keyshortcuts="S">${ICO.skip}飛ばす<span class="mcc-key">S</span></button>`}
        <button class="mcc-btn" id="mccDoc">${ICO.mail}資料を送る</button>
      </div>
      ${ivrHtml(L, ph)}
      ${canPick ? `<div class="mcc-step">${stepLine}</div>` : ""}
      ${showSlots ? slotsHtml() : ""}
      <div class="mcc-rec" aria-label="架電結果">
        <div class="mcc-resrow">
          <label class="mcc-field">架電結果<select class="mcc-sel" id="mccRes" ${canPick ? "" : "disabled"} title="数字キー 1〜0 でも選べます">
            <option value="">${canPick ? "結果を選んでください" : "発信すると選べます"}</option>
            ${rs.map((c, i) => `<option value="${esc(c.k)}" ${c.k === cur ? "selected" : ""}>${(i + 1) % 10}. ${esc(c.label)}</option>`).join("")}</select></label>
          ${f.outcome === "reject" ? `<label class="mcc-field">断りの理由<select class="mcc-sel" id="mccReason"><option value="">理由を選んでください</option>${reasons.map((r, i) => `<option value="${esc(r)}" ${r === f.reason ? "selected" : ""}>${(i + 1) % 10}. ${esc(r)}</option>`).join("")}</select></label>` : ""}
          ${f.outcome === "apo" ? `<label class="mcc-field mcc-apo-in">アポの日時<input type="datetime-local" id="mccApo" value="${esc(f.apoAt)}" /></label>` : ""}
        </div>
        ${f.outcome === "closed" ? bizHtml() : ""}
        ${(f.step === "greason" || f.step === "when") && cs.length ? `<div class="mcc-choices ${cs.length > 4 ? "two" : ""}">${cs.map((c, i) => `<button class="mcc-choice ${c.cls || ""}" data-c="${esc(c.k)}" data-l="${esc(c.label)}" aria-keyshortcuts="${i + 1}"><span class="mcc-key">${i + 1}</span><span>${esc(c.label)}${c.sub ? `<small>${esc(c.sub)}</small>` : ""}</span></button>`).join("")}</div>` : ""}
        ${f.step === "when" ? whenManualHtml(f) : ""}
        ${!canPick ? `<p class="mcc-note">まず発信してください（<b>C</b>）。かけない会社は「飛ばす」（<b>S</b>）。</p>` : ""}
        ${f.outcome === "apo" && f.apoWho ? `<p id="mccApoWho" class="mcc-note${f.apoOther ? " mcc-warn-tx" : ""}">担当になる FS：${esc(String(f.apoWho).split("・")[0])}${f.apoOther ? "（他チーム）" : ""}。記録すると、予定を入れて知らせます</p>` : ""}
        ${f.outcome === "apo" ? `<div id="mccApoNeed">${apoNeedHtml()}</div>` : ""}
        ${f.outcome === "doc_send" ? `<div class="mcc-next">資料はまだ送っていません。<button class="mcc-chip" id="mccDocNow">資料を送る</button></div>` : ""}
        ${f.outcome === "inquiry" ? `<div class="mcc-next">${f.formSent ? `問い合わせフォームから<b>${esc(f.formSent)}</b>。` : "問い合わせフォームからは、まだ送っていません。"}<button class="mcc-chip" id="mccFormNow">${f.formSent ? "もう一度開く" : "フォームから送る"}</button></div>` : ""}
        ${f.step === "ready" ? `<div class="mcc-next" id="mccNextTx">${nextText()}${AUTO.has(f.outcome) && !f.noRetry && !f.nextAt ? ` <button class="mcc-chip" id="mccNoRetry">自動の掛け直しをやめる</button>` : ""}</div>
          ${f.outcome !== "callback_req" ? `<div class="mcc-chips">${laterChips().map(([l, dd]) => `<button class="mcc-chip" data-later="${dd.toISOString()}" data-ll="${esc(l)}" aria-pressed="${f.nextAt === dd.toISOString()}">${esc(l)}</button>`).join("")}${f.nextAt ? `<button class="mcc-chip" data-later="">時刻を外す</button>` : ""}</div>` : ""}` : ""}
        ${P === "person" ? "" : '<div id="mccMemoSlot"></div>'}
        <div id="mccFill"></div>
        <div class="mcc-foot"><button class="mcc-btn primary big" id="mccRec" ${ready() ? "" : "disabled"} aria-keyshortcuts="Enter">記録して次へ<span class="mcc-key" style="background:rgba(255,255,255,.18);color:#fff;border-color:transparent">Enter</span></button>
          <span class="hint" id="mccHint">${footHint()}</span></div>
      </div>`;
    if (P === "person") {
      if (memoEl.parentElement !== $("mccMemoPanel")) $("mccMemoPanel").append(memoEl);
    } else $("mccMemoSlot").replaceWith(memoEl);
    syncCallTools();
    if (memoFocus && !memoEl.closest("[hidden]")) { memoFocus.focus(); if (caret) memoFocus.setSelectionRange(caret[0], caret[1]); }
    const rsel = $("mccRes"); if (rsel) rsel.addEventListener("change", () => pickResult(rsel.value, rsel.selectedOptions[0] ? rsel.selectedOptions[0].textContent.replace(/^\d\. /, "") : ""));
    bindBiz();
    const rsn = $("mccReason"); if (rsn) rsn.addEventListener("change", () => { S.f.reason = rsn.value; S.f.step = rsn.value ? "ready" : "reason"; drawCenter(); queueFill(); });
    const c = $("mccCenter");
    c.querySelectorAll("[data-c]").forEach((b) => b.addEventListener("click", () => choose(b.dataset.c, b.dataset.l)));
    const bk = $("mccBack"); if (bk) bk.addEventListener("click", back);
    const sk = $("mccSkip"); if (sk) sk.addEventListener("click", skip);
    $("mccDoc").addEventListener("click", sendDoc);
    const dn = $("mccDocNow"); if (dn) dn.addEventListener("click", sendDoc);
    const fn = $("mccFormNow"); if (fn) fn.addEventListener("click", sendForm);
    const cn = $("mccConnect"); if (cn) cn.addEventListener("click", () => connect(true));
    if (showSlots) bindSlots($("mccSlots"));
    if (showSlots && !S.slots) loadSlots();
    $("mccRec").addEventListener("click", record);
    // 発信したら受付の段階へ。日程の候補もこの時点で裏で読んでおく（担当者につながったらすぐ出せるように）
    const dial = $("mccDial"); if (dial) dial.addEventListener("click", () => { S.f.phone = ph; if (!S.f.dialed) { S.f.dialed = true; S.f.talkManual = null; loadSlots(); setTimeout(() => { drawCenter(); drawTalk(); drawWork(); }, 0); } });
    const apo = $("mccApo"); if (apo) { apo.addEventListener("input", () => {
      S.f.apoAt = apo.value; S.f.apoWho = ""; S.f.apoOther = false;
      $("mccApoWho")?.remove();
      c.querySelectorAll("[data-slot]").forEach((b) => b.setAttribute("aria-pressed", String(apo.value === toLocalInput(b.dataset.slot))));
      const times = $("mccSlotTime");
      if (times) times.selectedIndex = 0;
      refreshFoot();
    }); apo.addEventListener("keydown", (e) => { if (e.key === "Enter" && ready()) { e.preventDefault(); record(); } }); if (!memoFocus) setTimeout(() => apo.focus(), 0); }
    const na = $("mccNextAt"); if (na) { na.addEventListener("input", () => pickManual(na.value)); na.addEventListener("keydown", (e) => { if (e.key === "Enter" && S.f.nextAt && ready()) { e.preventDefault(); record(); } }); }
    const nr = $("mccNoRetry"); if (nr) nr.addEventListener("click", () => { S.f.noRetry = true; drawCenter(); });
    c.querySelectorAll("[data-later]").forEach((b) => b.addEventListener("click", () => { S.f.nextAt = b.dataset.later; S.f.nextLabel = b.dataset.ll || ""; S.f.noRetry = !b.dataset.later ? S.f.noRetry : false; drawCenter(); }));
    drawFill(); queueFill();
  }
  // タブや架電結果を変えても書いたメモが残るよう、会社が変わったときだけ作り直す。
  function drawMemo() {
    const box = memoEl; if (!box) return;
    if (!S.d || !S.f) { box.innerHTML = ""; box._f = null; return; }
    if (box._f === S.f && box.querySelector("#mccMemo")) return;
    box._f = S.f;
    box.innerHTML = `<label class="mcc-field mcc-memo">架電メモ<small>Ctrl+Enter で記録</small><textarea id="mccMemo" placeholder="話したこと、次に確認すること（例：担当者メール：yamada@example.jp）">${esc(S.f.memo)}</textarea></label>`;
    const m = box.querySelector("#mccMemo");
    m.addEventListener("input", () => {
      S.f.memo = m.value;
      // 書きかけは会社ごとに残す（記録する前に別の会社へ移っても、戻ったら続きから書ける）
      const id = S.d && S.d.lead.id; if (id) { if (m.value) ls.set(memoKey(id), m.value); else ls.del(memoKey(id)); }
      const values = readHearingMemo(m.value);
      if (JSON.stringify(values) !== JSON.stringify(S.f.memoHearing)) {
        S.f.memoHearing = values;
        if (phase() === "person") { drawWork(); hRefresh(); }
      }
      queueFill();
    });
  }
  // 右の「聞けたこと」の欄：受付と話している間は受付で聞けたこと、担当者につながったらヒアリング（2026-11-23 福井さん）。
  //   今まで中央で結果を選んだあとに出ていたので、不在（押した瞬間に記録）では担当者名・いる時間を入れる場所がなかった
  function drawWork() {
    const box = $("mccWork"); if (!box) return;
    const P = phase(); if (!S.d || !S.f || P === "pre") { box.innerHTML = ""; return; }
    const f = S.f, L = S.d.lead;
    box.innerHTML = P === "person" ? hearingHtml()
      : `<h3>受付で聞けたこと<small>欄を離れると保存</small></h3><div class="mcc-gateform" aria-label="受付で聞けたこと">
        <label class="mcc-field">担当者の名前<input id="mccGName" value="${esc(f.gate.name || (L.gate && L.gate.name) || "")}" autocomplete="off" /></label>
        <label class="mcc-field">直通・内線<input id="mccGDirect" value="${esc(f.gate.direct || (L.gate && L.gate.direct) || "")}" autocomplete="off" inputmode="tel" /></label>
        <div class="mcc-field full">いる時間<div class="mcc-chips">${["午前", "昼", "午後", "夕方"].map((h) => `<button class="mcc-chip" data-hr="${h}" aria-pressed="${(f.gate.hours || (L.gate && L.gate.hours)) === h}">${h}</button>`).join("")}</div></div></div>`;
    box.querySelectorAll("[data-hr]").forEach((b) => b.addEventListener("click", () => { S.f.gate.hours = S.f.gate.hours === b.dataset.hr ? "" : b.dataset.hr; saveGate(); drawWork(); }));
    // ヒアリング：選ぶ項目は押すだけ。書く項目は欄を離れたら保存（記録を押す前に別の会社へ移っても消えないように）
    box.querySelectorAll("[data-hn]").forEach((b, i) => b.addEventListener("click", () => {
      toggleNeed(b.dataset.hn, b.dataset.v); saveHearing(); queueFill(); drawWork(); hRefresh();
      box.querySelectorAll("[data-hn]")[i]?.focus({ preventScroll: true });
    }));
    box.querySelectorAll("[data-hk]").forEach((i) => { const k = i.dataset.hk; i.addEventListener("input", () => { S.f.hearing[k] = i.value; queueFill(); hRefresh(); }); i.addEventListener("blur", saveHearing); });
    const pages = $("mccHPage"); if (pages) pages.addEventListener("change", () => setHearingPage(Number(pages.value)));
    for (const [id, step] of [["mccHPrev", -1], ["mccHNext", 1]]) {
      $(id)?.addEventListener("click", () => { setHearingPage(S.f.hearingPage + step); pages.focus(); });
    }
    box.querySelectorAll("[data-hselect]").forEach((select) => select.addEventListener("change", () => {
      S.f.hearing[select.dataset.hselect] = select.value; saveHearing(); queueFill(); hRefresh();
    }));
    const hb = box.querySelector("#mccHMail"); if (hb) hb.addEventListener("click", sendHearMail);
    // 受付で聞けたことは、欄を離れたら自動で保存（「保存」ボタンを押し忘れて消えることがないように）
    [["mccGName", "name"], ["mccGDirect", "direct"]].forEach(([id, k]) => { const i = $(id); if (!i) return; i.addEventListener("input", () => { S.f.gate[k] = i.value; queueFill(); }); i.addEventListener("blur", saveGate); });
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
    // 結果を選ぶまでは出さない（通話中にメモの下へ割り込んで、トークを押し下げないように）
    if (S.f.step === "reach") { box.innerHTML = ""; return; }
    const F = S.fill && S.d && S.fill.leadId === S.d.lead.id ? S.fill : null;
    // 人の判断が要る行（最初はチェックが外れている＝メモから読んだ書き換え・担当者やメールの書き換え）があるときだけ出す。
    //   ほかの行は、いま押したばかりの値をもう一度見せているだけで、記録を下へ押し下げていた（2026-11-23 福井さん）。出さなくても記録すると入る
    const ask = F ? F.plan.filter((p) => p.kind !== "same" && !p.on) : [];
    if (!F || (!ask.length && !/できませんでした/.test(F.note || ""))) { box.innerHTML = ""; return; }
    const auto = F.plan.filter((p) => p.kind !== "same" && p.on && fillOn(p)).length;
    box.innerHTML = `<div class="mcc-fill" aria-label="SF に入れるか選ぶ項目">
      <div class="mcc-fill-h"><b>SF に入れるか選んでください</b><small>チェックした項目だけ SF のリードに入ります${auto ? `（ほかの ${auto}項目は自動で入ります）` : ""}</small></div>
      ${F.note ? `<p class="mcc-note">${esc(F.note)}</p>` : ""}
      ${ask.map((p) => { const [kl, kc] = FILL_KIND[p.kind] || [p.kind, ""]; const same = p.kind === "same";
        return `<label class="mcc-fill-r ${kc}" title="読み取ったところ：${esc(p.why)}"><input type="checkbox" data-fill="${esc(p.api)}" ${same ? "disabled" : fillOn(p) ? "checked" : ""} />
          <span class="k">${esc(p.label)}</span><span class="v">${esc(p.value)}${p.kind === "update" && p.cur ? `<small>今の SF：${esc(p.cur)}</small>` : ""}</span><span class="mcc-fill-b ${kc}">${kl}</span></label>`; }).join("")}
    </div>`;
    box.querySelectorAll("[data-fill]").forEach((c) => c.addEventListener("change", () => { S.f.picks[c.dataset.fill] = c.checked; drawFill(); }));
  }
  // ヒアリング（2026-11-23 福井さん「必須ヒアリングを埋めないとアポを取れないように」）：ASUMO の28項目（担当者の基本3・必須7・追加18）。
  //   項目・選択肢・出し分けはサーバー（server/mchearing.js）から meta.hearItems で受け取る（画面とサーバーで食い違わないように）。
  //   前に聞いた値を最初から入れておき、変わったところだけ直せばよいようにする。担当者の名前・メール・電話は、
  //   ヒアリング欄が空なら受付で聞いた名前・会社の情報・かけた番号を入れておく（同じことを2回打たなくてよいように）
  const HI = () => (S.meta && S.meta.hearItems) || [];
  const HIk = (k) => HI().find((x) => x.k === k) || null;
  const KANJI = /[㐀-鿿豈-﫿々]/;
  const MAILRE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
  const PLACEHOLDER = /^(ご?担当者?様?|採用(ご)?担当(者)?様?|人事(ご)?担当(者)?様?|不明|なし|\[\[Unknown\]\]|unknown)$/i;
  const realNm = (v) => { const s = String(v || "").trim(); return s && !PLACEHOLDER.test(s) ? s : ""; };
  const MEMO_LABELS = {
    name: ["担当者名", "担当者", "採用担当"], mail: ["担当者メールアドレス", "メールアドレス", "メール", "連絡先メール"],
    tel: ["担当者の直通", "担当者の電話番号", "直通電話", "直通", "担当者携帯"],
    contact: ["説明会・面接の参加人数", "説明会参加人数", "説明会参加", "接触"], target: ["採用目標人数", "採用目標", "採用予定人数"],
    when: ["次卒の選考開始", "選考開始予定時期", "選考開始時期", "選考開始", "選考時期", "選考"],
    budget3m: ["3カ月以内の予算", "3ヶ月以内の予算", "3ヶ月以内の導入予算"],
    need_who: ["採用種別", "ほしい人"], need_pains: ["採用課題", "困りごと"],
  };
  const memoMail = (v) => /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v) && !/@(?:neo-career|neocareer|c-career)\./i.test(v);
  function memoFieldValue(it, raw) {
    const v = raw.trim();
    if (!v) return null;
    if (it.type === "mail") {
      const address = v.replace(/\s*です$/, "");
      return memoMail(address) ? address : null;
    }
    if (it.type === "tel") {
      const digits = v.replace(/[-\s()]/g, "");
      return /^(?:0\d{9,10}|\+81\d{9,10})$/.test(digits) ? v : null;
    }
    if (it.k === "name") {
      const name = v.replace(/\s*です$/, "").replace(/\s*(?:様|さん)$/, "");
      if (/(?:不明|不在|未確認|未定|確認中|聞けず|後日|拒否|異動|退職|変更|予定)/.test(name)) return null;
      return /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー・ ]{1,16}$/u.test(name) && KANJI.test(name) && realNm(name) ? name : null;
    }
    if (it.type === "num") {
      const match = /^(?:約\s*)?(\d{1,6}|\d{1,3}(?:,\d{3}){1,2})\s*(?:人|名|回)?$/.exec(v);
      const number = match ? Number(match[1].replace(/,/g, "")) : NaN;
      return number < 1e6 ? String(number) : null;
    }
    if (it.type === "month") {
      if (/^(?:未定|まだ未定)$/.test(v)) return "未定";
      const month = Number(/^(\d{1,2})月(?:から|に開始|開始|予定)?$/.exec(v)?.[1]);
      return month >= 1 && month <= 12 ? `${month}月` : null;
    }
    if (it.type === "choice") {
      if (it.k === "budget3m" && /^(?:あり|有り|有|ある)$/.test(v)) return it.opts[0];
      if (it.k === "budget3m" && /^(?:なし|無し|無|ない|無い)$/.test(v)) return it.opts[1];
      return it.opts.find((o) => o.normalize("NFKC") === v) || null;
    }
    if (it.type === "need") {
      const opts = needOpts()[it.part] || [];
      const aliases = opts.map((option) => [option.normalize("NFKC"), option]);
      if (opts.includes("パート・アルバイト")) aliases.push(["パート", "パート・アルバイト"], ["アルバイト", "パート・アルバイト"]);
      if (opts.includes("高卒")) aliases.push(["高校", "高卒"]);
      aliases.sort(([a], [b]) => b.length - a.length);
      const picked = new Set();
      let rest = v;
      while (rest) {
        const choice = aliases.find(([label]) => rest.startsWith(label) && /^(?:\s*[・、/]|$)/.test(rest.slice(label.length)));
        if (!choice) return null;
        const [label, option] = choice;
        picked.add(option);
        rest = rest.slice(label.length).replace(/^\s*[・、/]\s*/, "");
      }
      return picked.size > 1 && picked.has("特に困っていない") ? null : opts.filter((o) => picked.has(o));
    }
    const limit = it.type === "long" ? 1000 : 200;
    return v.length <= limit ? v : null;
  }
  function readHearingMemo(memo) {
    const labels = HI().flatMap((it) => [it.label, ...(MEMO_LABELS[it.k] || [])].map((label) => [label.normalize("NFKC"), it]));
    labels.sort(([a], [b]) => b.length - a.length);
    const found = new Map();
    const add = (key, value) => {
      if (found.has(key) && JSON.stringify(found.get(key)) !== JSON.stringify(value)) found.set(key, null);
      else found.set(key, value);
    };
    // ラベルのある記述と単独のメールだけを拾い、同じ項目に別の値があれば入力を見送る。
    for (const line of memo.split(/[\r\n。；;]|、(?=\s*[^、：:\r\n]{2,24}[：:])/)) {
      const text = line.trim().replace(/^[・•\-①-⑳㉑-㉕]\s*/, "").normalize("NFKC");
      if (memoMail(text)) { add("mail", text); continue; }
      const field = labels.find(([label]) => text.startsWith(label) && /^(?:\s*[:=]|は|\s|\d)/.test(text.slice(label.length)));
      if (!field) continue;
      const [label, it] = field;
      const raw = text.slice(label.length).replace(/^(?:\s*[:=]\s*|は\s*|\s+)/, "");
      add(it.k, memoFieldValue(it, raw));
    }
    return Object.fromEntries([...found].filter(([, value]) => value != null));
  }
  function hDefault(k) {
    const L = S.d && S.d.lead; if (!L || !S.f) return ""; const I = L.info || {};
    if (k === "name") return realNm(S.f.gate.name || (L.gate && L.gate.name)) || realNm(L.person);
    // ヒアリング欄が空なら、左の欄と同じ順のメール（MOCHICALL で直した値 → SF → 元のデータ）の先頭を入れておく
    if (k === "mail") return (((S.d && S.d.mails) || []).find((m) => m.src !== "hear") || {}).addr || I.email || ((I.contacts || []).find((c) => c.email) || {}).email || "";
    if (k === "tel") return S.f.phone || L.phone || "";
    return "";
  }
  const storedHearing = (k) => {
    const value = S.f.hearing[k] || S.d?.lead.hearing?.[k];
    return value != null && value !== "" ? String(value) : hDefault(k);
  };
  const memoValue = (k) => !Object.hasOwn(S.f.hearing, k) && !storedHearing(k) ? S.f.memoHearing[k] : "";
  const hv = (k) => k === "need" ? hearingNeed() : storedHearing(k) || memoValue(k) || "";
  function hShown(it) { const s = it.show; if (!s) return true; const v = hv(s.k); if (s.lt != null) return v !== "" && Number(v) < s.lt; return v === s.eq; }
  // 聞けたか（サーバーの valueText と同じ見方。前に自由に書いた採用ニーズの文は課題感に数える）
  function hFilled(it) {
    if (it.type !== "need") return hv(it.k) !== "";
    const p = needParse(hv("need")); return it.part === "who" ? p.who.length > 0 : p.pains.length > 0 || (!!hv("need") && !p.who.length);
  }
  // アポにしてよいか（サーバーの apoCheck と同じ決まり。サーバーでも同じことを確かめて断る）
  function apoCheckC() {
    const block = [], warn = []; const BUD = HIk("budget3m"), PRI = HIk("priority");
    const name = realNm(hv("name")) || realNm(hDefault("name"));
    if (!name || !KANJI.test(name)) block.push({ key: "name", label: name ? "担当者氏名（漢字で）" : "担当者氏名" });
    if (!MAILRE.test(hv("mail").trim())) block.push({ key: "mail", label: "担当者メール" });
    if (hv("tel").normalize("NFKC").replace(/[^0-9]/g, "").length < 9) block.push({ key: "tel", label: "担当者電話" });
    for (const it of HI()) if (it.group === "req" && hShown(it) && !hFilled(it)) block.push({ key: it.k, label: `${it.no} ${it.label}` });
    const budgetBlocked = BUD && hv("budget3m") === BUD.opts[1]
      ? "3カ月以内に検討できる予算が無いときはアポにしません。「担当者接触：営業フォロー」で記録して、時期を改めて追ってください" : "";
    const c = hv("contact"); if (c !== "" && Number(c) < 30) warn.push(`接触人数が ${c}名で、目安の30人に届いていません`);
    if (PRI && hShown(PRI) && hv("priority") === PRI.opts[2]) warn.push("エントリー数を増やしたい場合は、今回のサービスでは解決が難しいことを伝え、別の部署を案内してください");
    return { block, warn, budgetBlocked };
  }
  function hFieldHtml(it) {
    const req = it.group !== "more"; const lab = `${it.no ? `<span class="no">${esc(it.no)}</span>` : ""}${esc(it.label)}${req ? '<span class="mch-req">必須</span>' : ""}`;
    const tip = it.hint ? ` title="${esc(it.hint)}"` : "";
    const labelId = `mccHLabel-${esc(it.k)}`;
    const fromMemo = it.type === "need" ? memoNeed(it.part) : memoValue(it.k);
    const row = (inner, cls = "") => `<div class="mch-row ${cls}" data-hrow="${esc(it.k)}"${hShown(it) ? "" : " hidden"}${tip}><div><div class="mch-l" id="${labelId}">${lab}</div><small class="mch-from-memo"${fromMemo ? "" : " hidden"}>メモから入力</small></div><div class="mch-v">${inner}</div></div>`;
    const labelled = `aria-labelledby="${labelId}"`;
    if (it.type === "need") return row(`<div role="group" ${labelled}>${needChips(it.part)}</div>`);
    if (it.type === "choice" || it.type === "month") {
      const opts = it.type === "month" ? [...Array.from({ length: 12 }, (_, i) => `${i + 1}月`), "未定"] : it.opts;
      const v = hv(it.k);
      return row(`<select class="mcc-sel" data-hselect="${esc(it.k)}" ${labelled}><option value="" disabled ${opts.includes(v) ? "" : "selected"}>${esc(v || "選択してください")}</option>${opts.map((o) => `<option value="${esc(o)}" ${v === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`);
    }
    if (it.type === "long") return row(`<textarea data-hk="${esc(it.k)}" ${labelled} placeholder="${esc(it.hint || "")}">${esc(hv(it.k))}</textarea>`);
    const t = it.type === "num" ? ' inputmode="numeric"' : it.type === "tel" ? ' inputmode="tel"' : it.type === "mail" ? ' type="email"' : "";
    return row(`<input data-hk="${esc(it.k)}" ${labelled} value="${esc(hv(it.k))}"${t} autocomplete="off" placeholder="${esc(it.unit || it.hint || "")}" />`, it.type === "num" ? "num" : "");
  }
  function hStatHtml() {
    const ck = apoCheckC();
    // 予算が無いときは「あと何項目」ではなく、アポにしない理由をそのまま出す（埋めればよい話ではないため）
    return `<div class="mch-stat ${ck.block.length || ck.budgetBlocked ? "ng" : "ok"}">${ck.budgetBlocked ? `<small>${esc(ck.budgetBlocked)}</small>` : ""}${ck.block.length ? `アポに必要な項目は <b>あと ${ck.block.length} 件</b>` : ck.budgetBlocked ? "" : "<b>アポに必要な項目がそろいました</b>"}</div>
      ${ck.warn.map((w) => `<p class="mch-warn">${esc(w)}</p>`).join("")}`;
  }
  const FIRST_HEARING = new Set(["name", "mail", "tel", "contact", "target"]);
  const HEARING_PAGES = [
    ["連絡先・採用人数（必須）", (it) => FIRST_HEARING.has(it.k)],
    ["選考・予算・課題（必須）", (it) => it.group === "req" && !FIRST_HEARING.has(it.k)],
    ["採用状況・利用ツール（任意）", (it) => it.group === "more" && /^[⑧-⑭]$/.test(it.no)],
    ["担当者・採用条件（任意）", (it) => it.group === "more" && /^[⑮-⑳]$/.test(it.no)],
    ["採用時期・引き継ぎ（任意）", (it) => it.group === "more" && /^[㉑-㉕]$/.test(it.no)],
  ];
  function hearingHtml() {
    return `<div id="mccHStat" aria-live="polite">${hStatHtml()}</div>
      <div class="mcc-gateform mcc-hearing mch" aria-label="ヒアリング">
        <label class="mcc-field mch-page-label">入力する項目<select class="mcc-sel" id="mccHPage">${HEARING_PAGES.map(([label], i) => `<option value="${i}" ${S.f.hearingPage === i ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        ${HEARING_PAGES.map(([, includes], i) => `<div data-hpage="${i}" ${S.f.hearingPage === i ? "" : "hidden"}>${HI().filter(includes).map(hFieldHtml).join("")}</div>`).join("")}
        <div class="mch-page-next">
          <button type="button" class="mcc-btn" id="mccHPrev" ${S.f.hearingPage === 0 ? "disabled" : ""}>前の項目へ</button>
          <button type="button" class="mcc-btn" id="mccHNext" ${S.f.hearingPage === HEARING_PAGES.length - 1 ? "disabled" : ""}>次の項目へ</button>
        </div>
        <button class="mcc-btn" id="mccHMail" type="button">${ICO.mail}聞けなかったことをメールで聞く</button>
      </div>`;
  }
  function setHearingPage(page) {
    S.f.hearingPage = page;
    const select = $("mccHPage"); if (!select) return;
    select.value = page;
    $("mccWork").querySelectorAll("[data-hpage]").forEach((p) => { p.hidden = Number(p.dataset.hpage) !== page; });
    $("mccHPrev").disabled = page === 0;
    $("mccHNext").disabled = page === HEARING_PAGES.length - 1;
  }
  function focusHearing(key) {
    const row = $("mccWork").querySelector(`[data-hrow="${CSS.escape(key)}"]`);
    if (!row || row.hidden) return;
    showCallTool("mccWork", false, Number(row.closest("[data-hpage]").dataset.hpage));
    row.querySelector("input, select, textarea, button")?.focus();
  }
  // 入力のたびに描き直すと書いている欄から抜けてしまうので、出し分けとアポの判定だけを差し替える
  function hRefresh() {
    const box = $("mccWork"); if (box) box.querySelectorAll("[data-hrow]").forEach((r) => {
      const it = HIk(r.dataset.hrow); if (!it) return;
      r.hidden = !hShown(it);
      r.querySelector(".mch-from-memo").hidden = !(it.type === "need" ? memoNeed(it.part) : memoValue(it.k));
    });
    const st = $("mccHStat"); if (st) st.innerHTML = hStatHtml();
    const an = $("mccApoNeed"); if (an) an.innerHTML = apoNeedHtml();
    refreshFoot();
  }
  function apoNeedHtml() {
    if (!S.f || S.f.outcome !== "apo") return "";
    const ck = apoCheckC();
    if (!ck.block.length && !ck.budgetBlocked) return "";
    return `<div class="mch-stat ng">
      <button type="button" id="mccGoHearing" class="mcc-btn" data-hearing-jump="${esc(ck.block[0]?.key || "budget3m")}">アポに必要なヒアリングを入力</button>
      ${ck.budgetBlocked ? `<small>${esc(ck.budgetBlocked)}</small>` : ""}
      <div class="mch-missing">${ck.block.map(({ key, label }) => `<button type="button" class="mcc-btn" data-hearing-jump="${esc(key)}">${esc(label)}</button>`).join("")}</div>
    </div>`;
  }
  // 採用ニーズは選ぶだけ（2026-11-23 福井さん「採用ニーズを選択肢に」）。選択肢はサーバー（NEED_CHOICES）から受け取る。
  //   値は「困りごと：〜／ほしい人：〜」の文にして今までと同じ欄に入れる（SF の顧客の課題感にもこの文で入る）。
  //   前に自由に書いた文で選択肢に当たらないものは、消さずに下に見せる（選び直すと置き換わる）
  const needOpts = () => (S.meta && S.meta.needChoices) || { pains: [], who: [] };
  const needParse = (v) => { const t = String(v || ""); const C = needOpts(); return { pains: C.pains.filter((x) => t.includes(x)), who: C.who.filter((x) => t.includes(x)) }; };
  const needText = (p) => [p.pains.length && `困りごと：${p.pains.join("・")}`, p.who.length && `ほしい人：${p.who.join("・")}`].filter(Boolean).join("／");
  // ⑥ 採用対象＝ほしい人、⑦ 課題感＝困りごと。前に自由に書いた文で選択肢に当たらないものは、消さずに課題感の下に見せる
  function needChips(part) {
    const C = needOpts(); const cur = hv("need"); const p = needParse(cur); const arr = C[part] || [];
    const free = part === "pains" && cur && !p.pains.length && !p.who.length ? `<p class="mcc-note">前に書いた採用ニーズ：${esc(cur)}（選ぶと置き換わります）</p>` : "";
    return `<div class="mcc-chips">${arr.map((x) => `<button class="mcc-chip" data-hn="${part}" data-v="${esc(x)}" aria-pressed="${p[part].includes(x)}">${esc(x)}</button>`).join("")}</div>${free}`;
  }
  function toggleNeed(k, v) {
    const p = needParse(storedHearing("need")); const NONE = "特に困っていない";
    p[k] = needParse(hv("need"))[k];
    S.f.editedNeed.add(k);
    p[k] = p[k].includes(v) ? p[k].filter((x) => x !== v) : [...p[k], v];
    // 「特に困っていない」とほかの困りごとは一緒に選べない（あとで数えるときに食い違わないように）
    if (k === "pains" && v === NONE && p.pains.includes(NONE)) p.pains = [NONE];
    else if (k === "pains") p.pains = p.pains.filter((x) => x !== NONE);
    // 並びは選択肢の順にそろえる（押した順で文が変わり、同じ中身が別の値に見えないように）
    const C = needOpts(); p.pains = C.pains.filter((x) => p.pains.includes(x)); p.who = C.who.filter((x) => p.who.includes(x));
    S.f.hearing.need = needText(p);
  }
  function memoNeed(part) {
    const key = part === "who" ? "need_who" : "need_pains";
    if (S.f.editedNeed.has(part)) return null;
    const stored = storedHearing("need"), parts = needParse(stored);
    if (parts[part].length || (stored && !parts.who.length && !parts.pains.length)) return null;
    return S.f.memoHearing[key];
  }
  function hearingNeed() {
    const stored = storedHearing("need"), who = memoNeed("who"), pains = memoNeed("pains");
    if (!who && !pains) return stored;
    const parts = needParse(stored);
    return needText({ who: who || parts.who, pains: pains || parts.pains });
  }
  function hearingBody(includeMemo = true) {
    const value = includeMemo ? hv : storedHearing;
    const h = {};
    for (const it of HI()) if (it.type !== "need") h[it.k] = value(it.k);
    h.need = value("need");
    return h;
  }
  async function saveHearing() {
    if (!S.d) return; const L = S.d.lead; const h = hearingBody(false);
    if (!Object.values(h).some((v) => v !== "" && v != null)) return;
    try { const j = await post(`/api/mccall/leads/${L.id}/hearing`, { ...h, inbound: isInbound(L.id) ? S.inbound.id : null }); L.hearing = j.hearing; S.cache.delete(L.id); } catch (e) { setNotice([{ kind: "danger", text: `ヒアリングを保存できませんでした：${e.message}` }]); }
  }
  function refreshFoot() { const b = $("mccRec"); if (b) b.disabled = !ready(); const h = $("mccHint"); if (h) h.textContent = footHint(); }
  function footHint() {
    const f = S.f; if (!f || !S.d) return ""; const canPick = f.dialed || isInbound(S.d.lead.id);
    if (f.step === "when" && f.outcome === "absent" && !f.nextAt) return "Enter で自動の掛け直しにして記録（時間を選んでもよい）";
    if (ready()) return "Enter で記録（押してもよい）";
    if (!canPick) return "発信すると記録できます";
    if (f.outcome === "apo" && !f.apoAt) return "日時を入れてください";
    if (f.outcome === "apo") return "必須のヒアリングを埋めると記録できます";
    if (f.step === "when") return "時間を選ぶか、日時を指定してください";
    if (f.step === "greason") return "断り文句を選んでください（押すと記録して次へ）";
    return f.step === "reason" ? "断りの理由を選んでください" : "結果を選んでください（数字キーでも可）";
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
    if (!S.d) return; const L = S.d.lead; const g = { name: S.f.gate.name || (L.gate && L.gate.name) || "", hours: S.f.gate.hours || (L.gate && L.gate.hours) || "", direct: S.f.gate.direct || (L.gate && L.gate.direct) || "", biz: S.f.gate.biz || (L.gate && L.gate.biz) || "" };
    if (!g.name && !g.hours && !g.direct && !g.biz) return;
    try { const j = await post(`/api/mccall/leads/${L.id}/gate`, g); L.gate = j.gate; drawLeft(); } catch (e) { setNotice([{ kind: "danger", text: `受付で聞けたことを保存できませんでした：${e.message}` }]); }
  }
  // instant＝不在など「押した瞬間に記録して次へ」を効かせるか。数字キーでは効かせ、プルダウンでは効かせない
  //   （プルダウンは矢印キーで動かしただけでも選ばれるので、うっかり記録して次の会社へ進まないように。記録は Enter かボタンで）
  function choose(k, label, instant = true) {
    const f = S.f;
    if (f.step === "reach") {
      const [r, o] = k.split(":"); f.reach = r; f.outcome = o; if (INSTANT.has(o) && instant) { drawCenter(); record(); return; }
      f.step = o === "reject" ? "reason" : o === "apo" ? "apo" : o === "callback_req" || o === "absent" ? "when" : o === "blocked" ? "greason" : "ready";
      if (r === "person") { f.person = true; f.talkManual = null; if (o === "apo") loadSlots(); }
    }
    else if (f.step === "outcome") { f.outcome = k; f.step = k === "reject" ? "reason" : k === "callback_req" ? "when" : k === "apo" ? "apo" : "ready"; }
    else if (f.step === "reason") { f.reason = k; f.step = "ready"; }
    else if (f.step === "greason") { f.reason = k; if (k !== "その他") { drawCenter(); record(); return; } f.step = "ready"; drawCenter(); drawTalk(); drawWork(); const m = $("mccMemo"); if (m) m.focus(); return; }
    else if (f.step === "when") {
      if (k === "auto") { f.nextAt = ""; f.nextLabel = ""; drawCenter(); record(); return; }
      f.nextAt = k; f.nextLabel = label; f.step = "ready";
    }
    drawCenter(); drawTalk(); drawWork();
  }
  // 営業時間のヒアリング（営業時間外のとき）。よくある形は押すだけで入り、違うときは書き直せる。欄を離れたら保存
  const BIZ_PRESETS = ["平日 9:00〜18:00", "平日 9:00〜17:00", "平日 10:00〜19:00", "平日 8:30〜17:30", "土日祝も営業"];
  const bizNow = () => S.f.gate.biz || (S.d.lead.gate && S.d.lead.gate.biz) || "";
  function bizHtml() {
    const v = bizNow();
    return `<div class="mcc-biz"><label class="mcc-field">営業時間<small>自動音声・HP・受付で分かったら</small><input id="mccBiz" value="${esc(v)}" placeholder="例：平日 9:00〜18:00（12〜13時は昼休み）" autocomplete="off" /></label>
      <div class="mcc-chips">${BIZ_PRESETS.map((p) => `<button class="mcc-chip" data-biz="${esc(p)}" aria-pressed="${v === p}">${esc(p)}</button>`).join("")}</div></div>`;
  }
  function bindBiz() {
    const i = $("mccBiz"); if (!i) return;
    i.addEventListener("input", () => { S.f.gate.biz = i.value; });
    i.addEventListener("blur", saveGate);
    i.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && ready()) { e.preventDefault(); saveGate(); record(); } });
    $("mccCenter").querySelectorAll("[data-biz]").forEach((b) => b.addEventListener("click", () => { S.f.gate.biz = b.dataset.biz; saveGate(); drawCenter(); }));
  }
  // プルダウンで結果を選び直したら、前に選んだ結果の続き（理由・日時・掛け直し）を消してから選んだことにする
  function pickResult(k, label) {
    Object.assign(S.f, { reach: "", outcome: "", reason: "", apoAt: "", apoWho: "", nextAt: "", nextLabel: "", noRetry: false, step: "reach" });
    if (k) return choose(k, label, false);
    drawCenter(); drawTalk(); drawWork(); queueFill();
  }
  function back() {
    const f = S.f;
    // 結果は1段目で決まるので、戻ると1段目へ。断りの理由を選んだあとだけ、理由を選ぶところへ戻る。
    //   担当者につながった状態の1段目で戻ると、受付の段階（10個の結果）へ戻る
    if (f.step === "reach") { if (!f.person) return; f.person = false; f.talkManual = null; }
    else if (f.step === "ready" && f.outcome === "reject") { f.reason = ""; f.step = "reason"; }
    else Object.assign(f, { reach: "", outcome: "", reason: "", apoAt: "", apoWho: "", nextAt: "", noRetry: false, step: "reach", talkManual: null });
    drawCenter(); drawTalk(); drawWork();
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
  // 日付を切り替えても、別の日の空きや読み込み中の結果が表示されないようにする
  async function loadSlotDay(date) {
    const f = S.f;
    f.slotDay = date;
    f.dayOut = null;
    S.dayCache = S.dayCache || new Map();
    const hit = date && S.dayCache.get(date);
    if (hit && Date.now() - hit.at < 5 * 60e3) f.dayOut = hit.d;
    drawSlotTimes();
    if (!date || f.dayOut) return;
    const pending = f.dayOut = { loading: true };
    let d;
    try {
      d = await api(`/api/mccall/slots/day?date=${encodeURIComponent(date)}`);
    } catch (e) { d = { error: e.message }; }
    if (f !== S.f || f.dayOut !== pending) return;
    if (!d.error) S.dayCache.set(date, { at: Date.now(), d });
    f.dayOut = d;
    drawSlotTimes();
  }
  const p2 = (n) => String(n).padStart(2, "0");
  const ymdLocal = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  const slotUnreadHtml = (o) => o?.unread?.length
    ? `<p class="mcc-slot-status" title="${esc(o.unread.join("・"))}">カレンダー未確認 ${o.unread.length}人（空きに含めていません）</p>` : "";

  function slotBestHtml() {
    const o = S.slots;
    if (!o || o.loading) return '<p class="mcc-slot-status" role="status">空きを読み込み中…</p>';
    if (o.error) return `<p class="mcc-slot-status mcc-slot-error" role="status">空きを読めませんでした：${esc(o.error)}</p>`;
    if (!o.slots.length) return `<p class="mcc-slot-status">${esc(o.reason || "2週間のうちに空いている枠がありません")}</p>${slotUnreadHtml(o)}`;
    // 同じ日に自チームの空きがあれば、その時間を候補にする
    const preferred = new Map();
    for (const x of o.slots) {
      if (!preferred.has(x.md) || (preferred.get(x.md).otherTeam && !x.otherTeam)) preferred.set(x.md, x);
    }
    const slots = [...preferred.values()].slice(0, 3);
    return `<div class="mcc-slot-grid">${slots.map((x) => {
      const selected = S.f.apoAt === toLocalInput(x.at);
      const who = esc((x.free || []).join("・"));
      return `<button type="button" class="mcc-slot" aria-pressed="${selected}" data-slot="${esc(x.at)}" data-who="${who}" data-other="${x.otherTeam ? "1" : ""}" title="${who}">
        <span class="mcc-slot-when"><span>${esc(x.md)}（${esc(x.dow)}）</span><span>${esc(x.time)}</span></span>
        <span class="mcc-slot-free">空き ${x.freeN}人${x.otherTeam ? "・他チーム" : ""}</span></button>`;
    }).join("")}</div>${slotUnreadHtml(o)}`;
  }

  function slotOtherHtml() {
    const today = new Date();
    const last = new Date(today.getFullYear(), today.getMonth() + 4, 0);
    return `<div class="mcc-slot-fields">
      <label class="mcc-field">日付<input type="date" id="mccSlotDay" value="${esc(S.f.slotDay || "")}" min="${ymdLocal(today)}" max="${ymdLocal(last)}" /></label>
      <div id="mccSlotTimes">${slotTimesHtml()}</div>
    </div>`;
  }

  function slotTimesHtml() {
    const { slotDay, dayOut: o, apoAt } = S.f;
    const slots = o?.slots || [];
    const selected = slots.find((x) => apoAt === toLocalInput(x.at));
    const hint = !slotDay ? "日付を選択" : !o || o.loading ? "読み込み中…" : o.error ? "取得できませんでした" : slots.length ? "時刻を選択" : "空きなし";
    return `<label class="mcc-field">時刻<select class="mcc-sel" id="mccSlotTime"${slots.length ? "" : " disabled"}>
      <option value="" disabled${selected ? "" : " selected"}>${hint}</option>${slots.map((x) => `<option value="${esc(x.at)}" data-who="${esc((x.free || []).join("・"))}" data-other="${x.otherTeam ? "1" : ""}"${x === selected ? " selected" : ""}>${esc(x.time)}（空き ${x.freeN}人${x.otherTeam ? "・他チーム" : ""}）</option>`).join("")}
      </select></label><div role="status">${o?.error ? `<p class="mcc-slot-status mcc-slot-error">${esc(o.error)}</p>` : o?.reason ? `<p class="mcc-slot-status">${esc(o.reason)}</p>` : ""}${slotUnreadHtml(o)}</div>`;
  }

  function slotMode() { return S.f.slotTab === "other" ? "other" : "best"; }

  function slotsHtml() {
    const mode = slotMode();
    return `<section id="mccSlots" aria-labelledby="mccSlotTitle">
      <div class="mcc-slot-head"><h3 id="mccSlotTitle">日程候補 <small>1時間枠</small></h3>
        <div class="mcc-slot-tabs" role="group" aria-label="日程の探し方"><button type="button" data-stab="best" aria-pressed="${mode === "best"}">おすすめ</button><button type="button" data-stab="other" aria-pressed="${mode === "other"}">他の日程</button></div>
      </div>
      <div id="mccSlotBody">${mode === "best" ? slotBestHtml() : slotOtherHtml()}</div>
    </section>`;
  }

  function chooseSlot(at, who, other) {
    S.f.apoAt = toLocalInput(at);
    S.f.apoWho = who || "";
    S.f.apoOther = other === "1";
    if (S.f.step === "reach") {
      Object.assign(S.f, { reach: "person", outcome: "apo", step: "apo", person: true, talkManual: null });
      drawTalk();
    }
    drawCenter();
  }

  function bindSlotTime() {
    $("mccSlotTime")?.addEventListener("change", (e) => {
      const option = e.target.selectedOptions[0];
      if (option?.value) chooseSlot(option.value, option.dataset.who, option.dataset.other);
    });
  }

  function drawSlotTimes() {
    const times = $("mccSlotTimes");
    if (!times) return;
    times.innerHTML = slotTimesHtml();
    bindSlotTime();
  }

  function bindSlotBody() {
    $("mccSlotBody").querySelectorAll("[data-slot]").forEach((b) => b.addEventListener("click", () => chooseSlot(b.dataset.slot, b.dataset.who, b.dataset.other)));
    $("mccSlotDay")?.addEventListener("change", (e) => {
      const date = e.target;
      loadSlotDay(date.validity.valid ? date.value : "");
      if (!date.validity.valid) date.reportValidity();
    });
    bindSlotTime();
  }

  function bindSlots(panel) {
    const modes = panel.querySelectorAll("[data-stab]");
    modes.forEach((button) => button.addEventListener("click", () => {
      if (slotMode() === button.dataset.stab) return;
      S.f.slotTab = button.dataset.stab;
      modes.forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      $("mccSlotBody").innerHTML = slotMode() === "best" ? slotBestHtml() : slotOtherHtml();
      bindSlotBody();
    }));
    bindSlotBody();
  }

  // 空きの取得中に書いたメモや、選びかけの日付のフォーカスを保つ
  function drawSlotsBox() {
    const body = $("mccSlotBody");
    if (!body || slotMode() !== "best") return;
    body.innerHTML = slotBestHtml();
    bindSlotBody();
  }

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
        <div><button class="mcc-btn" id="mccDSig" type="button">自分の署名・名乗り</button></div>
        <p class="mcc-note">本文の {URL} には、「送る」を押したときに doc-room でこの会社用に作るルームの URL が入ります（だれがいつ開いたかは doc-room で分かります）。</p></div>`);
    if (!pv.google) { const ok = w.querySelector("[data-ok]"); ok.disabled = true; }
    // 署名・名乗りを直したら本文を作り直す（自分で書き換えた本文は残す）
    w.querySelector("#mccDSig").addEventListener("click", () => senderDialog(async () => {
      const n = await post(`/api/mccall/leads/${L.id}/doc/preview`, { docId: w.querySelector("#mccDDoc").value }).catch(() => null); if (!n || !document.body.contains(w)) return;
      if (w.querySelector("#mccDBody").value === pv.body) w.querySelector("#mccDBody").value = n.body; pv = n;
    }));
    // 資料を変えたら、件名・本文を作り直す（宛先と CC は書いたまま残す）
    w.querySelector("#mccDDoc").addEventListener("change", async (e) => {
      try { const n = await post(`/api/mccall/leads/${L.id}/doc/preview`, { docId: e.target.value }); pv = n;
        w.querySelector("#mccDSub").value = n.subject; w.querySelector("#mccDBody").value = n.body;
      } catch (err) { toast(`資料を切り替えられませんでした：${err.message}`); }
    });
  }

  // ---- ヒアリングのメール（2026-11-23 福井さん「メールヒアリングできるように」）----
  //   電話で聞ききれなかった項目を、担当者にメールで聞く（あなたの Gmail から送る）。最初は、必須でまだ聞けていない項目にチェック。
  //   聞く項目を変えたら本文を作り直す（宛先・CC・件名は書いたまま残す）。答えが返ってきたら、右のヒアリング欄に入れる
  async function sendHearMail() {
    if (!S.d) return; const L = S.d.lead;
    await saveHearing();   // 書いたばかりのヒアリングも「聞けた」に数えてから、聞く項目を選ぶ
    let pv;
    try { pv = await post(`/api/mccall/leads/${L.id}/hear-mail/preview`, {}); } catch (e) { setNotice([{ kind: "danger", text: `ヒアリングのメールの準備ができませんでした：${e.message}` }]); return; }
    const keysOf = (w) => [...w.querySelectorAll("[data-hmk]:checked")].map((c) => c.dataset.hmk);
    const w = dialog(`ヒアリングをメールで聞く：${pv.company}`, pv.google ? "聞く項目と本文を確かめてから「送る」を押してください。あなたの Gmail から送ります。" : "あなたの Google 連携がまだなので送れません。設定 → 外部連携 → Google でつないでください。", "送る", async (w) => {
      const v = (id) => w.querySelector(id).value;
      const keys = keysOf(w); if (!keys.length) throw new Error("聞く項目を1つ以上選んでください");
      const r = await post(`/api/mccall/leads/${L.id}/hear-mail/send`, { to: v("#mccHMTo").trim(), cc: v("#mccHMCc").trim(), subject: v("#mccHMSub").trim(), body: v("#mccHMBody"), keys });
      toast(`ヒアリングのメールを ${r.to} に送りました${r.sf ? `（${r.sf}）` : ""}`);
      S.cache.delete(L.id); try { const d = await api(`/api/mccall/leads/${L.id}`); if (S.d && S.d.lead.id === L.id) { S.d = d; drawRight(); } } catch {}
    }, `<div style="display:grid;gap:8px;margin-top:12px">
        ${pv.last ? `<p class="mcc-note" style="color:var(--c-warn)">この会社には ${esc(day(pv.last))} にヒアリングのメールを送っています。</p>` : ""}
        ${pv.warn ? `<p class="mcc-note" style="color:var(--c-warn)">${esc(pv.warn)}</p>` : ""}
        <label class="mcc-field">宛先<input id="mccHMTo" type="email" value="${esc(pv.to)}" autocomplete="off" /></label>
        <label class="mcc-field">CC（なくてよい）<input id="mccHMCc" value="" autocomplete="off" /></label>
        <div class="mcc-field">聞く項目<small style="font-weight:400">聞けている項目は「聞けた」と出ます</small><div class="mch-mailkeys">${pv.items.map((it) => `<label><input type="checkbox" data-hmk="${esc(it.k)}" ${pv.keys.includes(it.k) ? "checked" : ""} />${it.no ? `${esc(it.no)} ` : ""}${esc(it.label)}${it.group !== "more" ? '<span class="mch-req">必須</span>' : ""}${it.heard ? "<small>聞けた</small>" : ""}</label>`).join("")}</div></div>
        <label class="mcc-field">件名<input id="mccHMSub" value="${esc(pv.subject)}" /></label>
        <label class="mcc-field">本文<textarea id="mccHMBody" style="min-height:220px">${esc(pv.body)}</textarea></label>
        <div><button class="mcc-btn" id="mccHMSig" type="button">自分の署名・名乗り</button></div></div>`);
    if (!pv.google) w.querySelector("[data-ok]").disabled = true;
    w.querySelector("#mccHMSig").addEventListener("click", () => senderDialog(async () => {
      const n = await post(`/api/mccall/leads/${L.id}/hear-mail/preview`, { keys: keysOf(w) }).catch(() => null); if (!n || !document.body.contains(w)) return;
      w.querySelector("#mccHMBody").value = n.body;
    }));
    w.querySelectorAll("[data-hmk]").forEach((c) => c.addEventListener("change", async () => {
      try { const n = await post(`/api/mccall/leads/${L.id}/hear-mail/preview`, { keys: keysOf(w) }); w.querySelector("#mccHMBody").value = n.body; }
      catch (err) { toast(`本文を作り直せませんでした：${err.message}`); }
    }));
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
      // 送るのはサーバーのブラウザで相手のページを開いて入力・確認画面・送信と進むので、1〜2分かかる。
      //   押したあと何も出ないと「止まった」と思われるので、ボタンに進み具合を出す（2026-11-25 福井さん「送信ボタンを押して止まった」）
      const okBtn = w.querySelector("[data-ok]"); const okLabel = okBtn.textContent; const t0 = Date.now();
      const tick = () => { okBtn.textContent = `送っています…（${Math.round((Date.now() - t0) / 1000)}秒・2分ほどかかることがあります）`; };
      tick(); const iv = setInterval(tick, 1000);
      try {
        const r = await post(`/api/mccall/leads/${L.id}/form/send`, { url: v("#mccFUrl").trim(), kana: v("#mccFKana").trim(), subject: v("#mccFSub").trim(), body: v("#mccFBody"), answers: answersOf(), again });
        S.f.formSent = r.status === "sent" ? "送りました" : "送信を押しました（届いたかは相手のページで確かめてください）";
        toast(`問い合わせフォームから${r.status === "sent" ? "送りました" : "送信を押しました（完了の文言は見つかりませんでした）"}${r.sf ? `（${r.sf}）` : ""}`);
        S.cache.delete(L.id); try { const d = await api(`/api/mccall/leads/${L.id}`); if (S.d && S.d.lead.id === L.id) { S.d = d; drawRight(); } } catch {}
        if (S.d && S.d.lead.id === L.id) drawCenter();
      } catch (e) {
        clearInterval(iv); okBtn.textContent = okLabel;
        // 30日のうちに送っている会社：もう一度押せば送る
        if (e.status === 409 && e.data && e.data.dup) { again = true; okBtn.textContent = "それでも送る"; }
        throw e;
      } finally { clearInterval(iv); }
    }, `<div style="display:grid;gap:8px;margin-top:12px">
        <p class="mcc-note" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">名乗り：<b id="mccFNanori">${esc(pv.nanori || "")}</b>${pv.from && pv.from.tel ? `<span>電話：${esc(pv.from.tel)}</span>` : ""}<button class="mcc-btn" id="mccFSig" type="button">自分の署名・名乗り</button></p>
        ${pv.ready ? "" : `<p class="mcc-note" id="mccFNotReady" style="color:var(--c-warn)">あなたの電話番号が分からないので、まだ送れません。「自分の署名・名乗り」で、電話番号の入った署名を入れてください。</p>`}
        ${pv.last ? `<p class="mcc-note" style="color:var(--c-warn)">この会社には ${esc(day(pv.last.created_at))} に問い合わせフォームから送っています。</p>` : ""}
        <label class="mcc-field">問い合わせページ（空なら会社の Web ページから探します）<span style="display:flex;gap:6px"><input id="mccFUrl" type="url" value="${esc(pv.url || "")}" placeholder="https://" autocomplete="off" style="flex:1" /><button class="mcc-btn" id="mccFScanBtn" type="button">調べ直す</button></span></label>
        <div id="mccFScan" class="mcc-note"></div>
        <label class="mcc-field">あなたの名前のフリガナ（フォームで聞かれたときに入ります。次からは覚えています）<input id="mccFKana" value="${esc(pv.kana || "")}" placeholder="例：フクイ ショウ" autocomplete="off" /></label>
        <label class="mcc-field">件名（件名の欄があるときだけ入ります）<input id="mccFSub" value="${esc(pv.subject)}" /></label>
        <label class="mcc-field">本文<textarea id="mccFBody" style="min-height:200px">${esc(pv.body)}</textarea></label></div>`);
    const ok = w.querySelector("[data-ok]"); const box = w.querySelector("#mccFScan");
    // 自動で決められない必須の欄（クイズ・選ぶ欄など）は、ここで人が答える（2026-11-25 福井さん「フォーム送信自動化をもっと完成度上げて」）。
    //   フリガナは上の「フリガナ」の欄で答える。全部埋まるまで「送る」は押せない
    let ask = [];
    const answersOf = () => { const a = {}; w.querySelectorAll("[data-ans]").forEach((i) => { if (i.value.trim()) a[i.dataset.ans] = i.value.trim(); }); return a; };
    const answered = () => ask.every((q) => q.kana ? !!w.querySelector("#mccFKana").value.trim() : !!(answersOf()[q.key]));
    const sync = () => { ok.disabled = !pv.ready || !found || !answered(); };
    const scan = async () => {
      found = false; sync();
      box.innerHTML = "フォームを探しています…（20〜40秒ほどかかります）";
      try {
        const keep = answersOf();
        const r = await post(`/api/mccall/leads/${L.id}/form/preview`, { url: w.querySelector("#mccFUrl").value.trim(), kana: w.querySelector("#mccFKana").value.trim(), subject: w.querySelector("#mccFSub").value, body: w.querySelector("#mccFBody").value, answers: keep });
        if (!document.body.contains(w)) return;
        if (r.url) w.querySelector("#mccFUrl").value = r.url;
        found = !!r.found || !!r.askable; ask = r.askable ? (r.ask || []) : [];
        const rows = (r.plan || []).map((p) => `<tr><th style="text-align:left;font-weight:600;padding:2px 8px 2px 0">${esc(p.label)}</th><td>${esc(p.value)}</td></tr>`).join("");
        const qs = ask.map((q) => q.kana ? `<div class="mcc-field">${esc(q.label)}：上の「あなたの名前のフリガナ」を入れてください</div>`
          : `<label class="mcc-field">${esc(q.label)}${q.hint ? `<small style="font-weight:400">${esc(q.hint)}</small>` : ""}${q.opts && q.opts.length
            ? `<select class="mcc-sel" data-ans="${esc(q.key)}" style="max-width:none"><option value="">選んでください</option>${q.opts.map((o) => `<option${keep[q.key] === o ? " selected" : ""}>${esc(o)}</option>`).join("")}</select>`
            : `<input data-ans="${esc(q.key)}" value="${esc(keep[q.key] || "")}" autocomplete="off" />`}</label>`).join("");
        box.innerHTML = `${r.found ? `<b style="color:var(--c-ok,#0d5b47)">フォームが見つかりました。</b>この内容で入れます：` : r.askable ? `<b style="color:var(--c-warn)">フォームが見つかりました。次の欄だけ答えを入れてください。</b>` : `<b style="color:#B4441F">${esc(r.error || "フォームが見つかりませんでした")}</b>`}
          ${r.warn ? `<div style="color:var(--c-warn)">${esc(r.warn)}</div>` : ""}
          ${qs ? `<div style="display:grid;gap:6px;margin:6px 0;padding:8px;border:1px solid var(--c-warn);border-radius:8px">${qs}</div>` : ""}
          ${rows ? `<table style="margin-top:4px;font-size:12px">${rows}</table>` : ""}
          ${r.url && !r.found ? `<div><a href="${esc(r.url)}" target="_blank" rel="noopener">相手のページを開いて手で送る</a></div>` : ""}`;
        box.querySelectorAll("[data-ans]").forEach((i) => i.addEventListener(i.tagName === "SELECT" ? "change" : "input", sync));
      } catch (e) { if (document.body.contains(w)) box.innerHTML = `<b style="color:#B4441F">フォームを調べられませんでした：${esc(e.message)}</b>`; }
      sync();
    };
    w.querySelector("#mccFKana").addEventListener("input", sync);
    w.querySelector("#mccFScanBtn").addEventListener("click", scan);
    // 署名・名乗りを直したら、本文を作り直す（自分で直した本文は消してしまうので、ひな形のままのときだけ）
    w.querySelector("#mccFSig").addEventListener("click", () => senderDialog(async () => {
      const n = await post(`/api/mccall/leads/${L.id}/form/preview`, { scan: false }).catch(() => null); if (!n || !document.body.contains(w)) return;
      if (w.querySelector("#mccFBody").value === pv.body) w.querySelector("#mccFBody").value = n.body;
      w.querySelector("#mccFNanori").textContent = n.nanori || ""; if (!w.querySelector("#mccFKana").value.trim()) w.querySelector("#mccFKana").value = n.kana || "";
      pv = { ...pv, ready: n.ready, nanori: n.nanori, body: n.body }; const nr = w.querySelector("#mccFNotReady"); if (nr) nr.hidden = !!n.ready; sync();
    }));
    sync(); scan();
  }
  // ---- 自分の署名・名乗り（2026-11-25 福井さん）：メールの最後の署名と、「株式会社ネオキャリアの福井です」の名字。本人ごとに覚える ----
  //   署名の会社名・電話・住所は、問い合わせフォームの欄にも入る（管理者のひな形が空のとき）
  async function senderDialog(onSaved) {
    let s; try { s = await api("/api/mccall/my-sender"); } catch (e) { toast(e.message); return; }
    dialog("自分の署名・名乗り", "メール・問い合わせフォームの名乗り（「株式会社ネオキャリアの福井です」）と、メールの最後に付く署名です。あなただけの設定です。", "保存する", async (w) => {
      const r = await api("/api/mccall/my-sender", { method: "PUT", body: JSON.stringify({ sei: w.querySelector("#mccSgSei").value.trim(), kana: w.querySelector("#mccSgKana").value.trim(), sig: w.querySelector("#mccSgSig").value }) });
      toast(`保存しました（名乗り：${r.nanori}）`);
      if (onSaved) onSaved();
    }, `<div style="display:grid;gap:8px;margin-top:12px">
      <label class="mcc-field">名字（名乗りに使います。例：福井）<input id="mccSgSei" value="${esc(s.sei || "")}" autocomplete="off" /></label>
      <label class="mcc-field">名前のフリガナ（フォームで聞かれたときに入ります）<input id="mccSgKana" value="${esc(s.kana || "")}" placeholder="例：フクイ ショウ" autocomplete="off" /></label>
      <label class="mcc-field">署名${s.own ? "" : '<small style="font-weight:400">いまは自動で作った署名です。直して保存すると、こちらが使われます</small>'}<textarea id="mccSgSig" style="min-height:240px;font-family:inherit">${esc(s.sig || "")}</textarea></label></div>`);
  }

  async function record() {
    if (!S.d || !ready() || S.busy) return; S.busy = true;
    const f = S.f; const L = S.d.lead; const company = L.company;
    const gate = { name: f.gate.name || (L.gate && L.gate.name) || "", hours: f.gate.hours || (L.gate && L.gate.hours) || "", direct: f.gate.direct || (L.gate && L.gate.direct) || "", biz: f.gate.biz || (L.gate && L.gate.biz) || "" };
    const body = { reach: f.reach, outcome: f.outcome, reason: f.reason, apoWho: f.outcome === "apo" ? f.apoWho : "", memo: f.memo, phone: f.phone || L.phone, gate, noRetry: f.noRetry, hearing: f.reach === "person" ? hearingBody() : null,
      nextAt: f.nextAt || null, apoAt: f.apoAt ? new Date(f.apoAt).toISOString() : null,
      talkId: S.d.talk ? S.d.talk.id : null, inbound: isInbound(L.id) ? S.inbound.id : null, sfPick: f.picks };
    try {
      const j = await post(`/api/mccall/leads/${L.id}/log`, body);
      ls.del(memoKey(L.id));   // 記録に入ったので書きかけは消す
      const what = crumb();
      S.queue = S.queue.filter((x) => x.id !== L.id); if (isInbound(L.id)) S.inbound = null;
      const ap = j.apo, apoTx = ap && ap.fs ? ` → ${ap.fs.name}さん${ap.fs.other ? "（他チーム）" : ""}に渡しました${ap.fsCal && ap.notified ? "（予定・知らせ済み）" : ""}` : "";
      toast(`記録しました：${company} ${what}${apoTx}${j.nextAt ? ` → ${tm(j.nextAt)} に掛け直し` : ""}`, { undo: j.logId });
      // アポの警告（FS に知らせが届かない など）は、次の会社を開いても消えないように持っておく（drawNotices で上に出す）
      if (ap && ap.warn && ap.warn.length) { S.apoWarn = { at: Date.now(), items: ap.warn.map((t) => `${company}のアポ：${t}`) }; drawNotices(); }
      loadStats(); S.busy = false;
      setTimeout(loadStats, 8000);   // SF への書き込みは記録のあとで行うので、少し待って書けたかを確かめ直す
      const n = nextItem(); if (n) await open(n.id); else { S.d = null; await loadQueue(true); }
      if (S.queue.length < 5) loadQueue(false);
    } catch (e) { S.busy = false; setNotice([{ kind: "danger", text: `記録できませんでした：${e.message}` }]); }
  }
  async function skip() {
    if (!S.d) return; const id = S.d.lead.id; release(); if (isInbound(id)) S.inbound = null;
    S.skipped.add(id); saveSkippedIds(S.skipped);
    S.queue = S.queue.filter((x) => x.id !== id);
    const n = nextItem(); if (n && n.id !== id) await open(n.id);
    else { S.d = null; await loadQueue(true); }
  }
  function release() { if (S.d) post(`/api/mccall/leads/${S.d.lead.id}/release`).catch(() => {}); }
  async function undo(logId) {
    try { const j = await post(`/api/mccall/logs/${logId}/undo`); toast(`取り消しました${j.sf ? `（${j.sf}）` : ""}`); loadStats(); release(); S.cache.delete(j.leadId); await open(j.leadId); }
    catch (e) { toast(`取り消せませんでした：${e.message}`); }
  }

  // これまでの日ごとの見出し・時刻（main 2026-11-23 福井さん「過去のメモが見にくい」）。WD は曜日（main では定義が抜けていた）
  const WD = "日月火水木金土";
  const dayHead = (d) => { const x = new Date(d); if (isNaN(x)) return String(d).slice(0, 10); const y = x.getFullYear() !== new Date().getFullYear() ? `${x.getFullYear()}/` : ""; return `${y}${x.getMonth() + 1}/${x.getDate()}（${WD[x.getDay()]}）`; };
  const hhmm = (d) => { const x = new Date(d); return isNaN(x) ? "" : `${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; };
  function syncCallTools() {
    const connected = phase() === "person";
    const right = $("mccRight");
    if (connected && !right.classList.contains("connected")) S.f.tool = "mccTalk";
    right.classList.toggle("connected", connected);
    $("mccToolTabs").hidden = $("mccHistory").hidden = !connected;
    $("mccTl").hidden = connected;
    for (const [id] of CALL_TOOLS) {
      const panel = $(id), tab = $(id + "Tab");
      const active = connected && S.f.tool === id;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      panel.hidden = connected ? !active : id === "mccMemoPanel";
      if (connected) {
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", tab.id);
        panel.tabIndex = 0;
      } else {
        panel.removeAttribute("role"); panel.removeAttribute("aria-labelledby"); panel.removeAttribute("tabindex");
      }
    }
  }
  function showCallTool(id, focus = false, hearingPage) {
    if (phase() !== "person") return;
    S.f.tool = id;
    if (hearingPage != null) setHearingPage(hearingPage);
    syncCallTools();
    if (focus) $(id + "Tab").focus();
  }
  function showCallHistory() {
    if (!S.d) return;
    const w = dialog(`架電履歴（${S.d.timeline.length}件）`, "", "閉じる", () => {}, '<div data-history></div>');
    w.querySelector("[data-x]").remove();
    drawTl(w.querySelector("[data-history]"), () => { w.remove(); S.dlg = null; });
  }
  function drawRight() { drawTalk(); drawWork(); drawTl(); }
  let scriptObserver;
  function drawTalk() {
    const box = $("mccTalk"); if (!box) return; const d = S.d; if (!d) { box.innerHTML = ""; return; }
    const previous = $("mccTalkText");
    scriptObserver?.disconnect();
    box.innerHTML = scriptHtml(d);
    const sc = $("mccScript"); if (sc) sc.addEventListener("toggle", () => ls.set("mcc_script_open", sc.open ? "1" : "0"));
    box.querySelectorAll("[data-tst]").forEach((b) => b.addEventListener("click", () => setTalkStage(Number(b.dataset.tst))));
    box.querySelector("[data-tkedit]")?.addEventListener("click", () => editTalkHere(d.lead));
    const book = $("mccTalkText"); if (!book) return;
    book.dataset.page = previous?.textContent === book.textContent ? previous.dataset.page : "0";
    $("mccTalkPrev").addEventListener("click", () => pageTalk(Number(book.dataset.page) - 1));
    $("mccTalkNext").addEventListener("click", () => pageTalk(Number(book.dataset.page) + 1));
    scriptObserver ??= new ResizeObserver(() => pageTalk(Number($("mccTalkText")?.dataset.page || 0)));
    scriptObserver.observe(book);
  }
  // 架電画面からトークを直す。保存したら、いま開いている会社をすぐ新しいトークで出し直す（次の会社を待たずに確かめられるように）
  function editTalkHere(L) {
    const l = S.lists.find((x) => x.id === L.list_id) || { id: L.list_id, name: L.list || "このリスト" };
    talkDialog(l, async () => {
      try {
        const d = await api(`/api/mccall/leads/${L.id}`);
        if (S.d && S.d.lead.id === L.id) { S.d = d; drawTalk(); }
        toast("トークを保存しました（この会社から新しいトークで出しています）");
      } catch (e) { toast(`トークは保存しましたが、表示を読み直せませんでした：${e.message}（次に開く会社から使います）`); }
    });
  }
  // ブラウザーの段組みで文章を行ごとに分け、矢印ボタンで表示するページを変える。
  function pageTalk(page) {
    const book = $("mccTalkText"); if (!book?.clientWidth) return;
    const width = parseFloat(getComputedStyle(book).width);
    const pages = Math.max(1, Math.round(book.scrollWidth / width));
    page = Math.max(0, Math.min(pages - 1, page));
    book.dataset.page = String(page);
    book.scrollLeft = page * width;
    $("mccTalkPages").style.visibility = pages === 1 ? "hidden" : "";
    $("mccTalkPage").textContent = `${page + 1} / ${pages}`;
    $("mccTalkPrev").disabled = page === 0;
    $("mccTalkNext").disabled = page === pages - 1;
  }
  function drawTl(box = $("mccTl"), closeHistory) {
    const d = S.d; if (!d || !box) return;
    // 「メモのあるものだけ」で、メモの無い記録（応答なしなど）をたためる（選んだ状態は覚えておく）
    //   メール配信（SF の B2BMA 連携・BALES のメール活動、本文がメールの形のもの）は本文があってもメモではないので外す
    //   （2026-11-25 福井さん「メモのあるものだけにしたときにメール配信は除く」。見分け方はサーバーの mchist.js の spokenText と同じ）
    const memoOnly = ls.get("mcc_tl_memo") === "1";
    const isMail = (t) => (t.src !== "kinbot" && /メール|mail|配信|B2BMA|Integration/i.test(`${t.title || ""} ${t.who || ""}`)) || /配信停止|%%unsubscribe%%|^\s*(件名|本文|TO|FROM)\s*[:：]/mi.test(t.text || "");
    const gs = tlGroups(memoOnly ? d.timeline.filter((t) => t.text && !isMail(t)) : d.timeline);
    const when = (t) => (t.src === "SF" ? "" : hhmm(t.at));
    let lastDay = "";
    const rows = gs.map(({ t, n, last }, i) => {
      const h = dayHead(t.at); const dh = h !== lastDay ? `<div class="mcc-tday">${esc(h)}</div>` : ""; lastDay = h;
      return `${dh}<div class="mcc-ti ${esc(t.src)}"><div class="h"><span class="tm">${n > 1 ? `${esc(when(last))}〜${esc(when(t))}` : esc(when(t))}</span><span class="who">${esc(t.who || "")}</span><b>${esc(t.title)}${n > 1 ? `×${n}` : ""}</b><span class="src">${esc(t.src)}</span>${t.cross ? '<span class="mcc-badge doc">部署をまたぐ</span>' : ""}</div>
        ${t.text && n === 1 ? `<div class="t" data-ti="${i}">${esc(t.text)}</div>${t.text.length > 160 || t.text.split("\n").length > 6 ? `<button data-more="${i}">全部見る</button>` : ""}` : ""}${t.mine ? ` <button data-undo="${t.logId}">この記録を取り消す</button>` : ""}</div>`;
    }).join("");
    // これまでは残りの高さの中でスクロールする（メモとトークを読むのにスクロールが要らないように）
    box.innerHTML = `${closeHistory ? "" : `<div class="mcc-tlh"><h3>これまで（${d.timeline.length}件）</h3>${d.timeline.length ? `<button class="mcc-chip" id="mccTlMemo" aria-pressed="${memoOnly}">メモのあるものだけ</button>` : ""}</div>`}${histNote(d)}
      ${rows ? `<div class="mcc-tl">${rows}</div>` : `<p class="mcc-note">${d.timeline.length ? "メモのある記録はまだありません。" : "まだやりとりの記録はありません。"}</p>`}`;
    const mo = box.querySelector("#mccTlMemo"); if (mo) mo.addEventListener("click", () => { ls.set("mcc_tl_memo", memoOnly ? "0" : "1"); drawTl(box, closeHistory); });
    box.querySelectorAll("[data-more]").forEach((b) => b.addEventListener("click", () => { const t = box.querySelector(`[data-ti="${b.dataset.more}"]`); t.classList.toggle("open"); b.textContent = t.classList.contains("open") ? "たたむ" : "全部見る"; }));
    box.querySelectorAll("[data-undo]").forEach((b) => b.addEventListener("click", () => {
      closeHistory?.();
      dialog("この記録を取り消しますか", "SF に書いた活動も消します。取り消すと、この会社は記録する前の状態に戻ります。", "取り消す", () => undo(b.dataset.undo));
    }));
  }
  // 続いた「応答なし」などは「応答なし×4」の1行にまとめる（同じ行が並んで、中身のある記録が下に隠れていた。2026-11-23 福井さん）。
  //   まとめるのは、届かなかった結果で、本文が自動で足した「次回 〇/〇」だけのもの。並びは新しい順なので、t が最新・last が最古
  const NOREACH = /^(発信：|着信：)?(応答なし|話し中|留守電|不在|担当者が不在|担当者不在|コールのみ|営業時間外)/;
  const plainTl = (t) => NOREACH.test(t.title || "") && !String(t.text || "").split("\n").some((x) => x && !/^次回 /.test(x));
  function tlGroups(tl) {
    const out = [];
    for (const t of tl || []) {
      const g = out[out.length - 1];
      if (g && plainTl(t) && plainTl(g.t) && g.t.title === t.title && g.t.src === t.src && !t.mine) { g.n++; g.last = t; }
      else out.push({ t, n: 1, last: t });
    }
    return out;
  }
  // トークスクリプト（2026-11-18 福井さん）。リストごとに管理者が書く。{会社名} {担当者} はこの会社のものに差し替える。
  //   開いた・閉じたは覚えておく（毎回開き直さなくてよいように）
  function scriptHtml(d) {
    const connected = phase() === "person";
    const L = d.lead;
    // 管理者は架電画面からそのままトークを直せる（2026-11-25 福井さん「トークスクリプトを架電画面から編集できるように」）。
    //   書き込みは「リストの管理」と同じ API（管理者だけ）なので、版・A/B の仕組みもそのまま
    const edit = S.admin && L.list_id ? '<button type="button" class="mcc-btn mcc-tkedit" data-tkedit>トークを直す</button>' : "";
    if (!d.script) return connected || edit ? `<p class="mcc-note">このリストにはスクリプトが設定されていません。${edit}</p>` : ""; const person = (L.gate && L.gate.name) || L.person || "ご担当者";
    const txt = d.script.replace(/\{会社名\}/g, L.company || "御社").replace(/\{担当者\}/g, person);
    const t = d.talk; const head = t ? `トーク ${esc(t.label)}（第${t.ver}版${t.n > 1 ? "・A/B で比べています" : ""}）` : "トークスクリプト";
    // 段階に分けて書いてあれば、いまの段階の分だけ出す（2026-11-23 福井さん「各段階で必要なトークスクリプトのみ表示」）。
    //   段階は通話の進み具合で自動で切り替わる（talkStage）。上のボタンか ← → キーで手でも変えられる。分けていないトークは今までどおり全部出す
    const sp = splitTalk(txt); const st = talkStage();
    const body = !sp.has ? txt : [st === 0 ? sp.common : "", sp.parts[st]].filter((x) => x.trim()).join("\n\n") || "（この段階のトークはまだ書かれていません）";
    const tabs = sp.has ? `<div class="mcc-stg" role="tablist" aria-label="トークの段階">${TALK_STAGES.map((x, i) => `<button role="tab" data-tst="${i}" aria-selected="${i === st}"${sp.parts[i].trim() || (i === 0 && sp.common.trim()) ? "" : ' class="empty"'}>${esc(x)}</button>`).join("")}</div>` : "";
    if (connected) return `<div class="mcc-script-reader"><h3>${head}${edit}</h3>${tabs}<div id="mccTalkText" class="mcc-script-text">${esc(body)}</div>
      <div class="mcc-script-pages" id="mccTalkPages">
        <button type="button" class="mcc-btn" id="mccTalkPrev">前のページ</button>
        <span id="mccTalkPage" aria-live="polite"></span>
        <button type="button" class="mcc-btn" id="mccTalkNext">次のページ</button>
      </div></div>`;
    return `<details class="mcc-script" id="mccScript" ${ls.get("mcc_script_open") === "0" ? "" : "open"}><summary>${head}</summary>${edit ? `<div class="mcc-tkedit-row">${edit}</div>` : ""}${tabs}<div class="body">${esc(body)}</div></details>`;
  }
  // トークの段階（2026-11-23 福井さん）。管理者は「リストの管理」のトークで段階ごとの欄に書く。
  //   保存するときは「■架電→受付」のような見出しの行でつないだ1本の文にする（A/B・版の仕組みはそのまま使えるように）
  const TALK_STAGES = ["架電→受付", "受付→採用担当者", "採用担当者→アポ"];
  const STAGE_RE = /^\s*[■【\[［]?\s*(架電|受付|採用担当者)\s*(?:→|->|⇒|＞|>)\s*(受付|採用担当者|アポ)\s*[】\]］]?\s*$/;
  function splitTalk(text) {
    const out = { has: false, common: "", parts: ["", "", ""] }; let cur = -1; const buf = { "-1": [], 0: [], 1: [], 2: [] };
    for (const line of String(text || "").split(/\r?\n/)) {
      const m = line.match(STAGE_RE); const i = m ? TALK_STAGES.indexOf(`${m[1]}→${m[2]}`) : -1;
      if (m && i >= 0) { cur = i; out.has = true; continue; }
      buf[cur].push(line);
    }
    const trim = (a) => a.join("\n").trim();
    out.common = trim(buf[-1]); out.parts = [0, 1, 2].map((i) => trim(buf[i]));
    return out;
  }
  const joinTalk = (common, parts) => [common.trim(), ...parts.map((x, i) => (x.trim() ? `■${TALK_STAGES[i]}\n${x.trim()}` : ""))].filter(Boolean).join("\n\n");
  // トークの段階は通話の進み具合に合わせる（2026-11-23 福井さん「トークスクリプトの表示タイミングを最適化」）：
  //   発信前・受付と話している間＝「架電→受付」／担当者につながった＝「受付→採用担当者」／アポ獲得を選んだ・日程を押した＝「採用担当者→アポ」。
  //   手で切り替えたら、次に段階が進むまではその段階のまま
  function talkStage() {
    const f = S.f; if (!f) return 0; if (f.talkManual != null) return f.talkManual;
    if (f.outcome === "apo") return 2;
    return phase() === "person" ? 1 : 0;
  }
  function setTalkStage(i) { if (!S.f || !S.d) return; S.f.talkManual = Math.max(0, Math.min(2, i)); drawTalk(); }
  // ---- 知らせ：大事な順に1件だけ。ほかは「ほか N件」で順に見る ----
  function drawNotices() {
    const d = S.d; const ns = [];
    if (d) {
      if (isInbound(d.lead.id)) ns.push({ kind: "doc", text: `折り返しの着信です（${S.inbound.number}）。発信しなくても、そのまま結果を記録できます` });
      if (d.lead.dup_of) ns.push({ kind: "danger", text: "重複で止めたリードです（ほかのリードと会社名が同じで、電話・メール・Web ページ・法人番号のどれかも同じ）。かけずに「飛ばす」を押し、管理者に知らせてください" });
      if (d.ban) ns.push({ kind: "danger", text: `アプローチ禁止の会社です（${d.ban.reason || "理由の記録なし"}）。かけずに「飛ばす」を押してください` });
    }
    // 知らせは、止まって確かめる必要があるもの（SF に書けていない・アプローチ禁止・重複）と折り返しの着信だけにする。
    //   DOC から持ってきた・掛け直しの時刻が来た・SF と結びついていない などは眺めるだけなので出さない（2026-11-23 福井さん）
    // SF に書けなかった記録は黙らせない（MOCHICA のルール5）。いちばん上に出し、その場で書き直せるようにする
    const sf = S.sf;
    if (sf && sf.fail) ns.unshift({ kind: "danger", text: `今日の記録 ${sf.fail}件が SF に書けていません${sf.lastErr ? `（${sf.lastErr}）` : ""}。kinbot には残っています`,
      act: { label: "SF に書き直す", fn: async () => { const r = await post("/api/mccall/sf-retry"); toast(r.left ? `${r.tried - r.left}件書けました。${r.left}件はまだ書けません。続くときは管理者に知らせてください` : `${r.tried}件を SF に書きました`); await loadStats(); } } });
    if (sf && sf.leadErr) ns.unshift({ kind: "danger", text: `今日のヒアリング ${sf.leadErr}件が SF のリードの項目（検討開始時期・採用人数・顧客の課題感）に書けていません。活動の本文と kinbot には残っています。続くときは管理者に知らせてください` });
    // アポのあとの警告は30分、または「確認した」を押すまで、いちばん上に出す
    if (S.apoWarn && Date.now() - S.apoWarn.at < 30 * 60e3) ns.unshift(...S.apoWarn.items.map((text) => ({ kind: "warn", text, act: { label: "確認した", fn: async () => { S.apoWarn = null; drawNotices(); } } })));
    setNotice(ns);
  }
  function setNotice(ns) {
    S.notices = ns || []; S.ni = 0; showNotice();
  }
  function showNotice() {
    const el = $("mccNotice"); if (!el) return; const n = S.notices[S.ni];
    // 知らせが無いときは帯ごと隠す（「お知らせはありません」が常に1段使っていた。2026-11-23 福井さん）
    el.hidden = !n || S.tab !== "call";
    if (!n) { el.className = "mcc-notice"; el.innerHTML = ""; return; }
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
    // 窓の上に窓を開いたとき（フォームの窓から「自分の署名・名乗り」など）、上の窓を閉じたら下の窓に戻す（キー操作が下の窓の裏で動かないように）
    const prev = S.dlg; w._prev = prev; document.body.appendChild(w); S.dlg = w;
    const close = () => { w.remove(); S.dlg = prev && document.body.contains(prev) ? prev : null; };
    w.querySelector("[data-x]").addEventListener("click", close);
    w.addEventListener("click", (e) => { if (e.target === w) close(); });
    w.querySelector("[data-ok]").addEventListener("click", async () => { const b = w.querySelector("[data-ok]"); b.disabled = true; try { const r = await onOk(w); if (r !== false) close(); } catch (e) { b.disabled = false; const p = w.querySelector(".err") || Object.assign(document.createElement("p"), { className: "mcc-note err" }); p.style.color = "#B4441F"; p.textContent = e.message; w.querySelector(".row").before(p); } });
    setTimeout(() => { const i = w.querySelector("input,textarea,select"); (i || w.querySelector("[data-ok]")).focus(); }, 0);
    return w;
  }
  function help() {
    dialog("キー操作", "", "閉じる", () => {}, `<div class="mcc-help"><dl>
      <dt><kbd>1</kbd>〜<kbd>9</kbd>・<kbd>0</kbd></dt><dd>いま出ている選択肢を選ぶ（発信してから。0 は10番目。コールのみ・現在使われておりませんは押すとすぐ記録して次へ。担当者不在は掛け直す時間を選ぶ（1 なら自動）。受付ブロックは断り文句を選ぶと記録して次へ。営業時間外は営業時間を残して Enter）</dd><dt><kbd>Enter</kbd></dt><dd>記録して次の企業へ</dd>
      <dt><kbd>Backspace</kbd></dt><dd>ひとつ前の選択に戻る</dd><dt><kbd>←</kbd> <kbd>→</kbd></dt><dd>トークの段階を手で切り替える（ふだんは通話の進み具合で自動で切り替わる）</dd><dt><kbd>C</kbd></dt><dd>選んでいる番号に発信</dd>
      <dt><kbd>T</kbd></dt><dd>担当者につながった（トークが担当者向けに変わり、日程の候補が出る）</dd>
      <dt><kbd>S</kbd></dt><dd>この企業を飛ばす（このタブを閉じるまで再表示しない。発信する前だけ）</dd><dt><kbd>Z</kbd></dt><dd>いま記録したものを元に戻す</dd>
      <dt><kbd>Ctrl</kbd>+<kbd>Enter</kbd></dt><dd>メモを書いている途中でも記録する</dd><dt><kbd>Esc</kbd></dt><dd>入力欄から出る・窓を閉じる</dd></dl></div>`);
  }

  function syncSide() { document.body.classList.toggle("mcc-calling", !!visible()); if (window.mcSideSync) window.mcSideSync(); }
  function visible() { const p = document.querySelector('[data-pane="call"]'); return p && !p.hidden && S.tab === "call"; }
  function onKey(e) {
    if (S.dlg) { if (e.key === "Escape") { const t = S.dlg; t.remove(); S.dlg = t._prev && document.body.contains(t._prev) ? t._prev : null; } return; }
    if (e.defaultPrevented || !visible() || !S.d || !S.f) return;
    const tag = (e.target && e.target.tagName) || ""; const typing = /INPUT|TEXTAREA|SELECT/.test(tag);
    if (typing) {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (ready()) record(); }
      else if (e.key === "Escape") e.target.blur();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Enter" && e.target.closest?.("#mccSlots button, #mccRight button, #mccRight summary, [data-hearing-jump]")) return;
    // 数字キーはプルダウンの番号どおりに選ぶ（不在など押した瞬間に記録するものは、今までどおり記録して次へ）
    if (/^[0-9]$/.test(e.key)) { if (!(S.f.dialed || isInbound(S.d.lead.id))) return; const c = choicesFor()[e.key === "0" ? 9 : Number(e.key) - 1]; if (c) { e.preventDefault(); choose(c.k, c.label); } return; }
    if (e.key === "Enter") { e.preventDefault(); if (ready()) record(); return; }
    if (e.key === "Backspace") { e.preventDefault(); if (S.f.step !== "reach" || S.f.person) back(); return; }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { if (!$("mccTalk").hidden && $("mccTalk").querySelector("[data-tst]")) { e.preventDefault(); setTalkStage(talkStage() + (e.key === "ArrowRight" ? 1 : -1)); } return; }
    const k = e.key.toLowerCase();
    if (k === "c") { const a = $("mccDial"); if (a) { e.preventDefault(); a.click(); } }
    else if (k === "t" && $("mccConnect")) { e.preventDefault(); connect(true); }
    else if (k === "s" && $("mccSkip")) { e.preventDefault(); skip(); }
    else if (k === "z" && S.toastUndo) { e.preventDefault(); const id = S.toastUndo; if (S.toast) S.toast.remove(); S.toast = null; S.toastUndo = null; undo(id); }
    else if (e.key === "?") { e.preventDefault(); help(); }
  }

  // ---- 管理者：インサイドの「かける」の状態（2026-11-23 福井さん「初週を止めずに回す」）----
  //   名簿のインサイド8名と MOCHICA のインターンについて、「かける」に会社が出るか・出ないなら何が足りないかを1行ずつ出す。
  //   止まっている人（赤）・もうすぐ無くなる人（橙）を上に並べ、朝いちばんに見れば詰まりが分かるようにする
  async function drawReady() {
    const box = $("mccReady"); if (!box) return;
    let j; try { j = await api("/api/mccall/readiness"); } catch (e) { box.innerHTML = `<h2>インサイドの「かける」の状態</h2><p class="mcc-note">読めませんでした：${esc(e.message)}</p>`; return; }
    const rank = { stop: 0, warn: 1, ok: 2 }; const items = (j.items || []).slice().sort((a, b) => rank[a.level] - rank[b.level]);
    const bad = items.filter((x) => x.level === "stop").length;
    const R = j.research || {};
    box.innerHTML = `<h2>インサイドの「かける」の状態${bad ? `<span class="mcc-badge danger" style="margin-left:8px">止まっている人 ${bad}人</span>` : '<span class="mcc-badge" style="margin-left:8px">全員かけられます</span>'}</h2>
      ${j.banOk ? "" : '<p class="mcc-note" style="color:#B4441F;font-weight:700">アプローチ禁止の名簿が読めないため、全員の「かける」が止まっています。</p>'}
      ${(j.orphans || []).length ? `<p class="mcc-note">BALES の所有者のうち、kinbot のだれとも名前が合わない人：${(j.orphans || []).map((o) => `${esc(o.name)}（${Number(o.n || 0)}件）`).join("・")}。この人たちの今日かけるリストは、だれの「かける」にも出ません（インターンでない人はそのままで大丈夫です）。</p>` : ""}
      <table class="mcc-tbl"><thead><tr><th>名前</th><th class="num">リスト</th><th class="num">今かけられる</th><th>状態</th></tr></thead><tbody>
      ${items.map((x) => `<tr><td>${esc(x.name)}${x.email ? "" : '<small style="color:var(--c-muted)">（アカウントなし）</small>'}</td><td class="num">${x.email ? `${x.talkLists}/${x.lists}` : "-"}</td><td class="num">${x.email ? x.now : "-"}</td>
        <td><span class="mcc-badge ${x.level === "stop" ? "danger" : x.level === "warn" ? "warm" : "doc"}">${x.level === "stop" ? "止まっている" : x.noEmail ? "メール未登録" : x.level === "warn" ? "もうすぐ無くなる" : "かけられる"}</span> ${esc(x.msg)}</td></tr>`).join("")}</tbody></table>
      <p class="mcc-note">リスト＝トークのあるリスト／入れるリスト。企業調査：今日 ${R.today || 0}件（上限 ${R.daily || 0}件）${R.gate ? "。調べ終わった会社を先に出し、足りないときは調査中の会社も出します" : "。いまは調べ終わるのを待たずに出しています"}。</p>
      <div id="mccPeople"></div>`;
    drawPeople();
  }
  // 名簿とメール（2026-11-23 福井さん決定「本人をメールで登録する」）：名簿の1行ずつに kinbot のログインのメールを結びつける。
  //   判定はメールが最優先で、未登録の人だけ名前で補う。未登録の行は、名前で当たった人を最初から選んでおく（確かめて「登録」を押すだけ）
  async function drawPeople() {
    const box = $("mccPeople"); if (!box) return;
    let j; try { j = await api("/api/mccall/people"); } catch (e) { box.innerHTML = `<p class="mcc-note">名簿とメールを読めませんでした：${esc(e.message)}</p>`; return; }
    const miss = j.rows.filter((r) => !r.email);
    const opts = (sel) => `<option value="">（未登録）</option>` + j.users.map((u) => `<option value="${esc(u.email)}" ${u.email === sel ? "selected" : ""}>${esc(u.name)}（${esc(u.email)}）</option>`).join("");
    box.innerHTML = `<details class="mcc-people" ${miss.some((r) => r.kind === "is") ? "open" : ""}><summary>名簿とメール${miss.length ? `<span class="mcc-badge warm" style="margin-left:8px">未登録 ${miss.length}件</span>` : '<span class="mcc-badge doc" style="margin-left:8px">全員登録ずみ</span>'}</summary>
      <p class="mcc-note">インターン・営業・架電の管理者は、ここに登録したメールで決まります（名前より先）。未登録の人だけ名前で判定します。候補（名前で当たった人）は選んであるので、確かめて「登録」を押してください。</p>
      <table class="mcc-tbl"><thead><tr><th>種類</th><th>名簿の名前</th><th>kinbot のアカウント</th><th></th></tr></thead><tbody>
      ${j.rows.map((r, i) => `<tr><td>${esc(r.kindLabel)}</td><td>${esc(r.label)}${r.email ? "" : '<small style="color:var(--c-warn)"> 未登録</small>'}</td>
        <td><select class="mcc-sel" data-pp="${i}" style="width:100%">${opts(r.email || r.guess)}</select></td>
        <td><button class="mcc-btn" data-ps="${i}">${r.email ? "直す" : "登録"}</button></td></tr>`).join("")}</tbody></table></details>`;
    box.querySelectorAll("[data-ps]").forEach((b) => b.addEventListener("click", async () => {
      const r = j.rows[+b.dataset.ps]; const email = box.querySelector(`[data-pp="${b.dataset.ps}"]`).value;
      try { await api("/api/mccall/people", { method: "PUT", body: JSON.stringify({ kind: r.kind, key: r.key, email }) }); toast(email ? `${r.label} を ${email} で登録しました` : `${r.label} の登録を外しました`); drawReady(); }
      catch (e) { toast(`登録できませんでした：${e.message}`); }
    }));
  }
  // ---- 管理者：リストの管理 ----
  async function drawLists() {
    const box = $("mccAdmin"); box.innerHTML = `<div class="mcc-card">読み込んでいます…</div>`; S.ldBack = null;
    try {
      await loadLists(); await loadStats();
      const all = S.allStats || [];
      box.innerHTML = `<div class="mcc-card" id="mccReady"><h2>インサイドの「かける」の状態</h2><p class="mcc-note">読み込んでいます…</p></div>
        <div class="mcc-card"><h2>架電リスト</h2>
          <p class="mcc-note">ここで作ったリストは MOCHICA だけのものです。DOC の kincall のリストとは混ざりません。メンバーを選ばないと、MOCHICA のメンバー全員がかけられます。</p>
          <p class="mcc-note">リストを管理できる人：${esc(((S.meta && S.meta.admins) || []).join("・") || "（田中さん・kinbot の管理者だけ）")}</p>
          <div style="margin:12px 0"><button class="mcc-btn primary" id="mccNew">新しいリストを作る</button> <button class="mcc-btn" id="mccTpl">資料送付のひな形</button> <button class="mcc-btn" id="mccFTpl">問い合わせフォームのひな形</button></div>
          ${S.lists.length ? `<table class="mcc-tbl"><thead><tr><th>リスト</th><th>メンバー</th><th class="num">残り</th><th class="num">今かける</th><th class="num">DOC から</th><th></th></tr></thead><tbody>
            ${S.lists.map((l) => `<tr><td><b>${esc(l.name)}</b><br><button class="mcc-btn" data-prod="${l.id}" title="押すと商材を切り替えます">商材：${isCm(l) ? "キャリミキ" : "MOCHICA"}</button> <button class="mcc-btn" data-blind="${l.id}" aria-pressed="${!!l.hide_history}" title="押すと切り替えます。伏せると、架電画面の「これまで」にはかける本人の記録だけが出ます（前回の結果・日時はそのまま）">過去の履歴：${l.hide_history ? "伏せる" : "見せる"}</button></td><td>${l.members && l.members.length ? `${l.members.length}人` : "MOCHICA 全員"}</td><td class="num">${l.open} / ${l.total}</td><td class="num">${l.now}</td><td class="num">${l.cross || ""}</td>
              <td style="white-space:nowrap"><button class="mcc-btn primary" data-add="${l.id}">リードを足す</button> <button class="mcc-btn" data-mem="${l.id}">メンバー</button> <button class="mcc-btn ${l.talks ? "" : "danger"}" data-scr="${l.id}" title="${l.talks ? `トーク ${l.talks}本` : "トークが無いのでかけられません"}">${l.talks ? `トーク（${l.talks}本）` : "トークを書く"}</button> <button class="mcc-btn primary" data-leads="${l.id}">割り振る・移す</button> <button class="mcc-btn danger" data-close="${l.id}">閉じる</button></td></tr>`).join("")}</tbody></table>` : '<p class="mcc-note">まだリストがありません。</p>'}
        </div>
        <div class="mcc-card" id="mccTalkMap"></div>
        <div class="mcc-card" id="mccStock"></div>
        <div class="mcc-card" id="mccDups" hidden></div>
        <div class="mcc-card"><h2>今日の数字（全員）</h2>${all.length ? `<table class="mcc-tbl"><thead><tr><th>名前</th><th class="num">コール</th><th class="num">担当者と話せた</th><th class="num">アポ</th><th class="num">部署をまたいだ架電</th></tr></thead><tbody>${all.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.calls}</td><td class="num">${r.person}</td><td class="num">${r.apo}</td><td class="num">${r.cross}</td></tr>`).join("")}</tbody></table>` : '<p class="mcc-note">今日はまだ記録がありません。</p>'}</div>`;
      drawReady();
      $("mccNew").addEventListener("click", () => listDialog());
      drawDups();
      $("mccTpl").addEventListener("click", tplDialog); $("mccFTpl").addEventListener("click", formTplDialog);
      box.querySelectorAll("[data-scr]").forEach((b) => b.addEventListener("click", () => talkDialog(S.lists.find((l) => l.id === +b.dataset.scr))));
      box.querySelectorAll("[data-prod]").forEach((b) => b.addEventListener("click", async () => {
        const l = S.lists.find((x) => x.id === +b.dataset.prod); if (!l) return;
        try { await api(`/api/mccall/lists/${l.id}`, { method: "PATCH", body: JSON.stringify({ product: isCm(l) ? "mochica" : "careermixer" }) }); drawLists(); }
        catch (e) { toast(`商材を切り替えられませんでした：${e.message}`); }
      }));
      box.querySelectorAll("[data-blind]").forEach((b) => b.addEventListener("click", async () => {
        const l = S.lists.find((x) => x.id === +b.dataset.blind); if (!l) return;
        try { await api(`/api/mccall/lists/${l.id}`, { method: "PATCH", body: JSON.stringify({ hide_history: !l.hide_history }) }); toast(l.hide_history ? "過去の履歴を見せるようにしました" : "過去の履歴を伏せるようにしました"); drawLists(); }
        catch (e) { toast(`切り替えられませんでした：${e.message}`); }
      }));
      box.querySelectorAll("[data-mem]").forEach((b) => b.addEventListener("click", () => listDialog(S.lists.find((l) => l.id === +b.dataset.mem))));
      box.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => addDialog(+b.dataset.add)));
      drawStock(); drawTalkMap();
      box.querySelectorAll("[data-leads]").forEach((b) => b.addEventListener("click", () => drawLeads(S.lists.find((l) => l.id === +b.dataset.leads))));
      box.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => dialog("このリストを閉じますか", "閉じると、だれの「かける」にも出なくなります。記録は消えません。", "閉じる", async () => { await api(`/api/mccall/lists/${b.dataset.close}`, { method: "PATCH", body: JSON.stringify({ closed: true }) }); drawLists(); })));
    } catch (e) { box.innerHTML = `<div class="mcc-card">読めませんでした：${esc(e.message)}</div>`; }
  }
  // 資料送付のひな形（MOCHICA 専用。DOC の資料送付の設定とは別）（2026-11-17）
  async function tplDialog() {
    let c; try { c = await api("/api/mccall/doc-settings"); } catch (e) { toast(e.message); return; }
    dialog("資料送付のひな形（MOCHICA）", "差し込み：{担当者} {会社名} {名乗り}（例：株式会社ネオキャリアの福井） {名字} {差出人} {資料名} {URL} {署名}。{署名} を書かなければ最後に自動で付きます（署名は送る人が「自分の署名・名乗り」で入れたもの）。DOC の資料送付の設定は変わりません。", "保存する", async (w) => {
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
    const F = [["company", "差出人の会社名（空なら署名から・それも無ければ株式会社ネオキャリア）"], ["companyKana", "会社名のフリガナ"], ["dept", "部署（空なら署名から）"], ["tel", "電話番号（空なら送る人の署名の携帯・電話）"], ["zip", "郵便番号（空なら署名から）"], ["addr", "住所（都道府県から。空なら署名から）"], ["site", "Web ページ（空なら署名から）"], ["subject", "件名"]];
    dialog("問い合わせフォームのひな形（MOCHICA）", "差し込み：{会社名} {担当者} {名乗り}（例：株式会社ネオキャリアの福井） {名字} {差出人} {差出人の会社名} {電話} {メール}。名前・メール・署名は送る人のものが入ります。", "保存する", async (w) => {
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
  // リスト×トークの対応表（2026-11-25 福井さん）。どのリストのどの欄（A/B/C）に、どのトークが入っているかを並べて見せ、
  //   欄ごとに「ほかのリストのトークを使う」「外す」を選べる。写すと新しい版になるので、前の版の数字は施策に残る。
  //   同じ中身のトークには同じ番号の印を付ける（どのリストが同じトークで動いているか分かるように）
  async function drawTalkMap() {
    const box = $("mccTalkMap"); if (!box) return;
    let j; try { j = await api("/api/mccall/talk-map"); } catch (e) { box.innerHTML = `<h2>リストとトークの対応</h2><p class="mcc-note">読めませんでした：${esc(e.message)}</p>`; return; }
    if (!j.lists.length) { box.hidden = true; return; }
    box.hidden = false;
    const at = new Map(j.talks.map((t) => [`${t.listId}:${t.label}`, t]));
    const name = new Map(j.lists.map((l) => [l.id, l.name]));
    const optsFor = (l, lb, cur) => `<option value="">${cur ? "（このまま）" : "（なし）"}</option>${cur ? '<option value="-">この欄を外す</option>' : ""}`
      + j.talks.filter((t) => !(t.listId === l.id && t.label === lb)).map((t) => `<option value="${t.id}">「${esc(name.get(t.listId) || "")}」のトーク ${t.label}（第${t.ver}版）${cur && t.same && t.same === cur.same ? "＝いまと同じ" : ""}</option>`).join("");
    const cell = (l, lb) => { const t = at.get(`${l.id}:${lb}`);
      return `<td style="min-width:200px">${t ? `<div>${t.same ? `<span class="mcc-badge doc" title="同じ番号のトークは中身が同じです">同じトーク ${t.same}</span> ` : ""}<small style="color:var(--c-muted)">第${t.ver}版・${t.chars}字</small></div><div style="font-size:12px;margin:2px 0 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:260px" title="${esc(t.head)}">${esc(t.head)}</div>` : '<div><small style="color:var(--c-muted)">なし</small></div>'}
        <select class="mcc-sel" data-tm="${l.id}" data-tml="${lb}" style="width:100%" aria-label="「${esc(l.name)}」のトーク ${lb} を変える">${optsFor(l, lb, t)}</select></td>`; };
    box.innerHTML = `<h2>リストとトークの対応</h2>
      <p class="mcc-note">どのリストに、どのトークを使っているかの一覧です。欄の下で、ほかのリストのトークを選ぶと、そのトークを写して差し替えます（新しい版になり、前の版の数字は施策のタブに残ります）。写したあとで片方を直しても、もう片方は変わりません。トークの中身を直すときは、リストの「トーク」ボタンから。</p>
      <div class="mcc-tblwrap"><table class="mcc-tbl"><thead><tr><th>リスト</th>${j.labels.map((lb) => `<th>トーク ${lb}</th>`).join("")}</tr></thead><tbody>
      ${j.lists.map((l) => `<tr><td><b>${esc(l.name)}</b>${l.stock ? '<br><small style="color:var(--c-muted)">保管</small>' : ""}${j.labels.some((lb) => at.has(`${l.id}:${lb}`)) ? "" : '<br><span class="mcc-badge danger">トークが無いのでかけられません</span>'}</td>${j.labels.map((lb) => cell(l, lb)).join("")}</tr>`).join("")}</tbody></table></div>`;
    box.querySelectorAll("[data-tm]").forEach((sel) => sel.addEventListener("change", () => {
      const v = sel.value; if (!v) return; sel.value = "";   // やめたときに選んだままにならないよう、先に戻しておく
      const to = +sel.dataset.tm; const lb = sel.dataset.tml; const src = j.talks.find((t) => String(t.id) === v);
      const title = v === "-" ? `「${name.get(to)}」のトーク ${lb} を外しますか` : `「${name.get(to)}」のトーク ${lb} を差し替えますか`;
      const body = v === "-" ? "外すと、このリストの会社にはこのトークが出なくなります（これまでの記録と数字は残ります）。" : `「${name.get(src.listId)}」のトーク ${src.label}（第${src.ver}版）を写します。いまの中身は前の版として残ります。`;
      dialog(title, body, v === "-" ? "外す" : "差し替える", async () => {
        await api("/api/mccall/talk-map", { method: "PUT", body: JSON.stringify({ to, label: lb, from: v === "-" ? null : +v }) });
        S.cache.clear(); toast(v === "-" ? `トーク ${lb} を外しました` : `トーク ${lb} を差し替えました（次に開く会社から使います）`); drawLists();
      });
    }));
  }
  // トーク（売り方）。リスト（売り先）とセットで1つの施策（2026-11-20 福井さん）。
  //   A/B/C の3本まで書ける。2本以上あると会社ごとに1本を決めて比べる。直すと新しい版になり、前の版の数字は「施策」に残る
  //   onSaved：架電画面から開いたときは、リストの管理を描き直すかわりに、いま開いている会社のトークを読み直す
  async function talkDialog(l, onSaved) {
    let j; try { j = await api(`/api/mccall/lists/${l.id}/talks`); } catch (e) { toast(e.message); return; }
    const cur = new Map(j.talks.map((t) => [t.label, t]));
    const hist = (lb) => j.history.filter((h) => h.label === lb).map((h) => `第${h.ver}版${h.active ? "（使用中）" : ""} ${h.calls}コール`).join("・");
    // 段階ごとに欄を分ける（2026-11-23 福井さん）。架電中は、いまの段階の欄に書いた分だけが出る。
    //   前に段階を分けずに書いたトークは「段階に分けていない分」の欄に残す（架電中は「架電→受付」の段階で出る）。中身を段階の欄へ移せば分かれる
    const PH = ["{担当者}様はいらっしゃいますか。株式会社ネオキャリアの〇〇と申します。", "採用のご担当者様につないでいただけますか。（断られたら）新卒採用のご案内で、1分ほどで終わります。", "{担当者}様、突然のお電話失礼いたします。（事例→アポ打診）"];
    const pane = (lb, i) => { const sp = splitTalk((cur.get(lb) || {}).body || ""); const legacy = sp.has ? sp.common : [sp.common, ...sp.parts].join("\n").trim();
      return `<div class="mcc-field" data-tkp="${lb}" style="margin-top:8px;gap:8px" ${i ? "hidden" : ""}><span>トーク ${lb}${hist(lb) ? `<small style="font-weight:600;color:var(--c-muted)">　${esc(hist(lb))}</small>` : ""}${i ? '<small style="font-weight:600;color:var(--c-muted)">（比べたいときだけ書く。空なら使いません）</small>' : ""}</span>
        ${TALK_STAGES.map((st, k) => `<label class="mcc-field">${k + 1}. ${esc(st)}<textarea data-tk="${lb}" data-st="${k}" style="min-height:96px" placeholder="${esc(PH[k])}">${esc(sp.parts[k])}</textarea></label>`).join("")}
        ${legacy ? `<label class="mcc-field">段階に分けていない分（前に書いたトーク。上の欄へ移すと段階ごとに出ます）<textarea data-tk="${lb}" data-st="c" style="min-height:96px">${esc(legacy)}</textarea></label>` : ""}</div>`; };
    const bodyOf = (w, lb) => { const v = (k) => { const e = w.querySelector(`[data-tk="${lb}"][data-st="${k}"]`); return e ? e.value : ""; }; return joinTalk(v("c"), [0, 1, 2].map(v)); };
    const w = dialog(`「${l.name}」のトーク`, "トークが1本も無いリストはかけられません（売り先と売り方はセット）。架電中は、段階（架電→受付／受付→採用担当者／採用担当者→アポ）ごとに、その段階の欄に書いた分だけが出ます。2本以上書くと、会社ごとにどれか1本に決まり、施策のタブでアポ率を比べられます。{会社名} {担当者} はその会社のものに差し替わります。", "保存する", async (w) => {
      const talks = j.labels.map((lb) => ({ label: lb, body: bodyOf(w, lb) }));
      if (!talks.some((t) => t.body.trim())) throw new Error("トークを1本は書いてください（トークが無いとこのリストはかけられません）");
      await api(`/api/mccall/lists/${l.id}/talks`, { method: "PUT", body: JSON.stringify({ talks }) });
      S.cache.clear();
      if (onSaved) await onSaved(); else { toast("トークを保存しました（次に開く会社から使います）"); drawLists(); }
      // 「かける」でトークが無くて止まっていたなら、書いたらすぐかけられるよう読み直す（2026-11-25）
      if (S.tab === "call" && !S.d) loadLists().then(() => loadQueue(true)).catch(() => {});
    }, `<div class="mcc-chips" style="margin-top:12px" role="tablist">${j.labels.map((lb, i) => `<button class="mcc-chip" data-tkt="${lb}" aria-pressed="${i === 0}">トーク ${lb}${cur.has(lb) ? "" : "（なし）"}</button>`).join("")}</div>
      ${j.labels.map(pane).join("")}`);
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
      <div style="margin:8px 0"><button class="mcc-btn" id="mccMTpl">資料送付のひな形・いつも使う資料</button> <button class="mcc-btn" id="mccMFTpl">問い合わせフォームのひな形</button></div>
      <div class="mcc-filters"><input type="date" class="mcc-sel" id="mccMf" value="${MS.from}" /><span>〜</span><input type="date" class="mcc-sel" id="mccMt" value="${MS.to}" /></div>
      <div id="mccMres"><p class="mcc-note">読み込んでいます…</p></div></div>`;
    // 「リストの管理」タブをしまってから、ひな形を開く場所が無くなっていた（2026-11-23 福井さん「いつも使う資料を MOCHICA参考資料にして」）。
    //   売り方（施策）の画面から開けるようにする
    $("mccMTpl").addEventListener("click", tplDialog); $("mccMFTpl").addEventListener("click", formTplDialog);
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
  //   2026-11-23 福井さん「だれが・どんな意図で見るものかを明確にして再デザイン」
  //   レポート＝やった結果をふり返る画面（期間を選べる）。
  //     かける人：自分がどの段階で止まっているかを確かめて、次のかけ方を決める → 自分の「日ごと」から始める
  //     管理者　：人・リストを比べて、だれに声をかけるか・どのリストを先にかけるかを決める → 「人ごと」から始める
  //   「いつ・何回かけるとよいか」の根拠は「数字」のタブに分けた（同じ中身を2つのタブに出さない）
  const RP = { by: "", from: "", to: "", list: "", view: "result", j: null };
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const pc = (a, b) => (b ? `${(a / b * 100).toFixed(1)}%` : "—");
  // 役割の印と、この画面で何を決めるかの1行。もう片方のタブへの行き先も添える（どちらを見ればよいか迷わないように）
  const purpose = (text, go, goLabel) => `<p class="mcc-purpose"><span class="mcc-tag ok">${S.admin ? "管理者" : "かける人"}</span><span>${text}</span><button class="mcc-chip" data-go="${go}">${goLabel}</button></p>`;
  async function drawReport() {
    const box = $("mccAdmin");
    if (!RP.from) { const n = new Date(); RP.to = ymd(n); RP.from = ymd(new Date(n.getTime() - 6 * 86400e3)); }
    // 自分の分しか出ない人に「人ごと」を出しても1行だけで比べるものが無いので、日ごとから始めて選択肢からも外す
    const bys = S.admin ? [["user", "人ごと"], ["list", "リストごと"], ["day", "日ごと"]] : [["day", "日ごと"], ["list", "リストごと"]];
    if (!bys.some(([v]) => v === RP.by)) RP.by = bys[0][0];
    const pre = (l, days) => { const n = new Date(); const f = days === "month" ? new Date(n.getFullYear(), n.getMonth(), 1) : days === "lastmonth" ? new Date(n.getFullYear(), n.getMonth() - 1, 1) : new Date(n.getTime() - days * 86400e3);
      const t = days === "lastmonth" ? new Date(n.getFullYear(), n.getMonth(), 0) : n; return `<button class="mcc-chip" data-pre="${ymd(f)}|${ymd(t)}" aria-pressed="${RP.from === ymd(f) && RP.to === ymd(t)}">${l}</button>`; };
    box.innerHTML = `<div class="mcc-card"><h2>レポート${S.admin ? "（全員）" : "（自分）"}</h2>
      ${purpose(S.admin ? "メンバーとリストの結果を比べて、だれに声をかけるか・どのリストを先にかけるかを決めます。" : "自分の架電の結果をふり返って、どの段階で止まっているかを確かめます。", "insight", "いつ・何回かけるとよいかは「数字」")}
      <div class="mcc-filters">
        <input type="date" class="mcc-sel" id="mccRf" value="${RP.from}" aria-label="いつから" /><span>〜</span><input type="date" class="mcc-sel" id="mccRt" value="${RP.to}" aria-label="いつまで" />
        <div class="mcc-chips">${pre("今日", 0)}${pre("7日", 6)}${pre("30日", 29)}${pre("今月", "month")}${pre("先月", "lastmonth")}</div>
        <select class="mcc-sel" id="mccRl" aria-label="リスト"><option value="">リスト：すべて</option>${S.lists.map((l) => `<option value="${l.id}" ${String(RP.list) === String(l.id) ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select>
      </div><div id="mccRfn"><p class="mcc-note">読み込んでいます…</p></div></div>
      <div id="mccRres" class="mcc-stack"></div>`;
    const go = () => { RP.from = $("mccRf").value; RP.to = $("mccRt").value; RP.list = $("mccRl").value; drawReport(); };
    ["mccRf", "mccRt", "mccRl"].forEach((id) => $(id).addEventListener("change", go));
    box.querySelectorAll("[data-pre]").forEach((b) => b.addEventListener("click", () => { [RP.from, RP.to] = b.dataset.pre.split("|"); drawReport(); }));
    box.querySelector("[data-go]").addEventListener("click", () => setTab("insight"));
    let j; try { j = await api(`/api/mccall/report?${new URLSearchParams({ from: RP.from, to: RP.to, by: RP.by, list: RP.list })}`); }
    catch (e) { if ($("mccRfn")) $("mccRfn").innerHTML = `<p class="mcc-note">読めませんでした：${esc(e.message)}</p>`; return; }
    RP.j = j; renderReport();
  }
  // 読んだ中身を描く。表の見方（結果／貢献）を切り替えるだけのときは、読み直さずにここだけ呼ぶ
  function renderReport() {
    const j = RP.j; if (!j || !$("mccRfn") || S.tab !== "report") return;   // 読んでいる間に別のタブへ移っていたら描かない
    const T = j.total, P = j.prev && j.days ? j.prev : null;
    const prevLbl = j.days === 1 ? "前の日" : `前の${j.days}日間`;
    const rt = (a, b) => (b ? a / b : null);
    // 前の同じ長さの期間との差。割合はポイントの差、件数は増えた・減った数で出す
    const delta = (now, was, isRate) => { const x = isRate ? (now - was) * 100 : now - was; const s = isRate ? `${x > 0 ? "+" : ""}${x.toFixed(1)}pt` : `${x > 0 ? "+" : ""}${x}`;
      return `<span class="dl ${x > 0 ? "up" : x < 0 ? "dn" : ""}">${prevLbl} ${isRate ? `${(was * 100).toFixed(1)}%` : was}（${s}）</span>`; };
    // 1つ前の段階から、どれだけ次へ進めたか。止まっている段階が分かるように、割合は「コールのうち」ではなく「1つ前のうち」で出す
    const stage = (cls, lbl, of, n, base, pn, pbase) => { const r = rt(n, base), pr = P ? rt(pn, pbase) : null;
      return `<div class="${cls}"><small>${lbl}</small><b>${n}<em>${of} ${r == null ? "—" : `${(r * 100).toFixed(1)}%`}</em></b><i><u style="width:${Math.round((r || 0) * 100)}%"></u></i>${r != null && pr != null ? delta(r, pr, true) : P ? `<span class="dl">${prevLbl}は記録なし</span>` : ""}</div>`; };
    $("mccRfn").innerHTML = T.calls ? `<div class="mcc-fn">
        <div><small>コール</small><b>${T.calls}<em>${T.leads}社</em></b><i><u style="width:100%"></u></i>${P ? (P.calls ? delta(T.calls, P.calls, false) : `<span class="dl">${prevLbl}は記録なし</span>`) : ""}</div>
        ${stage("", "つながった", "コールのうち", T.reached, T.calls, P && P.reached, P && P.calls)}
        ${stage("", "担当者と話せた", "つながったうち", T.person, T.reached, P && P.person, P && P.reached)}
        ${stage("apo", "アポ", "話せたうち", T.apo, T.person, P && P.apo, P && P.person)}
      </div>
      <p class="mcc-note">コールからアポまで通すと <b>${pc(T.apo, T.calls)}</b>${P && P.calls ? `（${prevLbl}は ${pc(P.apo, P.calls)}）` : ""}。割合がいちばん小さい段階、前より下がった段階が、次に直すところです。</p>`
      : '<p class="mcc-note">この期間の記録はありません。</p>';
    const res = $("mccRres"); if (!T.calls) { res.innerHTML = ""; return; }
    const dayLbl = (k) => { const x = new Date(`${k}T00:00:00`); return isNaN(x) ? k : `${x.getMonth() + 1}/${x.getDate()}（${"日月火水木金土"[x.getDay()]}）`; };
    const lbl = (r) => (j.by === "day" ? dayLbl(r.label) : r.label);
    const maxCalls = Math.max(...j.rows.map((r) => r.calls), 1);
    // コールの数は細い線でも出す（人・日を上から下へ見比べやすいように）。合計の行には引かない
    const callTd = (r, sum) => `<td class="num bar">${sum ? "" : `<i style="width:calc((100% - 16px) * ${(r.calls / maxCalls).toFixed(3)})"></i>`}${r.calls}</td>`;
    const rowA = (l, r, sum) => `<tr class="${sum ? "sum top" : ""}"><td>${esc(l)}</td>${callTd(r, sum)}<td class="num">${r.leads}</td><td class="num">${r.reached}<small> ${pc(r.reached, r.calls)}</small></td><td class="num">${r.person}<small> ${pc(r.person, r.calls)}</small></td>
      <td class="num apo">${r.apo}<small> ${pc(r.apo, r.calls)}</small></td><td class="num">${pc(r.apo, r.person)}</td><td class="num">${r.doc}</td><td class="num">${r.follow}</td><td class="num">${r.reject}</td></tr>`;
    const rowB = (l, r, sum) => `<tr class="${sum ? "sum top" : ""}"><td>${esc(l)}</td>${callTd(r, sum)}<td class="num fill">${r.fill || 0}<small> ${r.calls ? ((r.fill || 0) / r.calls).toFixed(2) : "—"}/コール</small></td><td class="num">${r.fillNew || 0}</td><td class="num">${r.fillFix || 0}</td><td class="num">${r.fillLeads || 0}</td><td class="num">${r.fillNoApo || 0}</td><td class="num">${r.invalid || 0}</td></tr>`;
    const fill = RP.view === "fill", row = fill ? rowB : rowA;
    const head = { user: "名前", list: "リスト", day: "日" }[j.by];
    const bys = S.admin ? [["user", "人ごと"], ["list", "リストごと"], ["day", "日ごと"]] : [["day", "日ごと"], ["list", "リストごと"]];
    const thead = fill
      ? `<th>${head}</th><th class="num">コール</th><th class="num fill" title="架電の内容から SF のリードの項目を埋めた・直した数（1項目＝1）">SF 項目</th><th class="num" title="空だった項目を埋めた">うち新規</th><th class="num" title="古い値を直した・課題感などに足した">うち更新</th><th class="num" title="項目を1つでも埋めた会社の数">埋まった会社</th><th class="num" title="アポにならなかった架電で埋めた数">アポ以外の架電で</th><th class="num" title="「番号が使えない」と記録した数">使えない番号</th>`
      : `<th>${head}</th><th class="num">コール</th><th class="num">会社数</th><th class="num" title="小さい字はコールのうちの割合">つながった</th><th class="num" title="小さい字はコールのうちの割合">担当者と話せた</th><th class="num" title="小さい字はコールのうちの割合">アポ</th><th class="num">話せたうちアポ</th><th class="num">資料</th><th class="num">フォロー</th><th class="num">断り</th>`;
    const rank = (title, arr) => { if (!arr || !arr.length) return ""; const mx = Math.max(...arr.map((r) => r.n), 1);
      return `<div><h3>${title}</h3>${arr.map((r) => `<div class="mcc-rk"><span title="${esc(r.k)}">${esc(r.k)}</span><i><u style="width:${Math.round(r.n / mx * 100)}%"></u></i><b>${r.n}</b></div>`).join("")}</div>`; };
    const ranks = rank("受付で断られた文句", j.gateReasons) + rank("担当者に断られた理由", j.reasons) + rank("聞けて SF に入れた項目", j.fields);
    res.innerHTML = `${j.rows.length ? `<div class="mcc-card">
        <div class="mcc-chead"><h2>内訳</h2>
          <div class="mcc-chips" role="group" aria-label="分け方">${bys.map(([v, l]) => `<button class="mcc-chip" data-by="${v}" aria-pressed="${RP.by === v}">${l}</button>`).join("")}</div>
          <span class="mcc-sp"></span>
          <div class="mcc-chips" role="group" aria-label="表に出す中身">${[["result", "架電の結果"], ["fill", "リストへの貢献"]].map(([v, l]) => `<button class="mcc-chip" data-view="${v}" aria-pressed="${RP.view === v}">${l}</button>`).join("")}</div></div>
        <div class="mcc-tblwrap"><table class="mcc-tbl"><thead><tr>${thead}</tr></thead>
        <tbody>${j.rows.length > 1 ? row("合計", T, true) : ""}${j.rows.map((r) => row(lbl(r), r, false)).join("")}</tbody></table></div>
        ${fill ? '<p class="mcc-note" style="margin-top:8px">アポが取れなくても、聞けたことで SF のリードを埋めた・使えない番号を見つけた数です。空を埋めた・古い値を直した・課題感などに足したものを1項目1つで数え、SF と同じ値の確認は数えません。</p>' : ""}</div>` : ""}
      ${ranks ? `<div class="mcc-card"><h2>なぜ取れなかったか・何を聞けたか</h2><div class="mcc-ranks">${ranks}</div></div>` : ""}
      <p class="mcc-note">数えているのは MOCHICALL で記録したものだけです（Bales で記録した過去の架電は入りません）。取り消した記録は数えません。</p>`;
    res.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => { RP.view = b.dataset.view; renderReport(); }));
    res.querySelectorAll("[data-by]").forEach((b) => b.addEventListener("click", () => { RP.by = b.dataset.by; drawReport(); }));
  }
  async function listDialog(l) {
    let reps = []; try { reps = (await api("/api/mochica/reps")).items || []; } catch {}
    const sel = new Set((l && l.members) || []);
    const w = dialog(l ? `「${l.name}」のメンバー` : "新しいリスト", l ? "かけられる人を選びます。だれも選ばないと MOCHICA のメンバー全員です。" : "名前を付けて、かけられる人を選びます。リードはあとで Bales・CSV・DOC から足します。", l ? "保存する" : "作る", async (w) => {
      const name = w.querySelector("#mccLName") ? w.querySelector("#mccLName").value.trim() : l.name;
      const members = [...w.querySelectorAll("[data-m][aria-pressed=true]")].map((b) => b.dataset.m);
      if (!name) throw new Error("リストの名前を入れてください");
      if (l) await api(`/api/mccall/lists/${l.id}`, { method: "PATCH", body: JSON.stringify({ members }) }); else await post("/api/mccall/lists", { name, members, product: w.querySelector("#mccLProd").value });
      drawLists();
    }, `${l ? "" : `<label class="mcc-field" style="margin-top:12px">リストの名前<input id="mccLName" autocomplete="off" /></label>
      <label class="mcc-field" style="margin-top:8px">商材<select class="mcc-sel" id="mccLProd" style="max-width:none"><option value="mochica">MOCHICA</option><option value="careermixer">キャリアミキサー（キャリミキ）</option></select></label>`}
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
        const j = await api(`/api/mccall/lists/${l.id}`, { method: "PATCH", body: JSON.stringify({ stock: false }) }); toast(j.talkFrom ? `かける対象にしました（トークは「${j.talkFrom}」から写しました）` : "かける対象にしました"); drawLists(); }); }));
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
  //   2026-11-23 福井さん「だれが・どんな意図で見るものかを明確にして再デザイン」
  //   数字＝次のかけ方を決める根拠の画面（期間は固定。全員の記録から出す）。
  //     かける人：「いま、かけどきか」「何回目までかけるか」「自分の率は目安と比べてどうか」の3つの答えを先に読む
  //     管理者　：掛け直しのきまり（回数・間隔・時間帯）を変える根拠を、下の表で確かめる
  //   期間を選んで結果をふり返るのは「レポート」
  async function drawInsight() {
    const box = $("mccAdmin"); box.innerHTML = `<div class="mcc-card">読み込んでいます…</div>`;
    try { const j = await api("/api/mccall/insight"); if (S.tab === "insight") renderInsight(box, j); } catch (e) { if (S.tab === "insight") box.innerHTML = `<div class="mcc-card">読めませんでした：${esc(e.message)}</div>`; }   // 中身が足りない応答でも「読み込んでいます」のまま止まらないように
  }
  function renderInsight(box, j) {
    const B = j.bench;
    const tier = (r) => (!r.calls ? "" : r.apo / r.calls >= B.top ? "good" : r.apo / r.calls >= B.avg[0] ? "ok" : "low");
    const tag = (r) => { const t = tier(r); return t ? `<span class="mcc-tag ${t}">${{ good: "上位の水準", ok: "平均の水準", low: "平均より下" }[t]}</span>` : ""; };
    const row = (lbl, r) => `<tr><td>${esc(lbl)}</td><td class="num">${r.calls}</td><td class="num">${pc(r.person, r.calls)}</td><td class="num">${r.apo}</td><td class="num">${pc(r.apo, r.calls)}</td><td class="num">${pc(r.apo, r.person)}</td><td>${tag(r)}</td></tr>`;
    j.hours = j.hours || [];
    const maxRate = Math.max(...j.hours.map((h) => h.rate), 0.01);
    const bestH = j.hours.slice().sort((a, b) => b.rate - a.rate)[0];
    const att = j.byAttempt || []; const late = att.filter((a) => a.n >= 6).reduce((x, a) => x + a.apo, 0); const all = att.reduce((x, a) => x + a.apo, 0);
    const maxAtt = Math.max(...att.map((a) => (a.calls ? a.apo / a.calls : 0)), 0.0001);
    const benchTxt = `平均 ${Math.round(B.avg[0] * 100)}〜${Math.round(B.avg[1] * 100)}%、上位 ${Math.round(B.top * 100)}%以上`;
    // 3つの答え（問い → 答え → その元）。くわしい元の数字は、同じ番号の下のカードにある
    const sl = j.slot; const slOk = sl && sl.tier !== "off" && typeof sl.rate === "number" && typeof sl.lift === "number";
    const bestTxt = bestH ? `いちばん話せるのは <b>${bestH.hour}時台</b>（${Math.round(bestH.rate * 100)}%）。` : "";
    const a1 = slOk ? { cls: sl.tier === "good" ? "good" : sl.tier === "low" ? "low" : "", t: { good: "つながりやすい時間帯です", normal: "ふつうの時間帯です", low: "つながりにくい時間帯です" }[sl.tier], s: `${sl.hour}時台に担当者と話せる割合は ${Math.round(sl.rate * 100)}%（平均の${sl.lift.toFixed(2)}倍）。${bestTxt}` }
      : { cls: "", t: "いまは時間外です", s: `${bestTxt}掛ける時間帯は 9〜18時です。` };
    const a2 = all ? { t: `アポの ${Math.round(late / all * 100)}% が6回目以降`, s: `1〜5回目で ${all - late}件、6回目以降で ${late}件のアポ（直近90日）。届かないまま <b>${j.cadence.max}回</b> 続いたら休ませるきまりです（資料では93%が6回目以降）。` }
      : { t: "まだアポの記録が足りません", s: `資料では、アポの93%が6回目以降の架電で取れています。いまは届かないまま <b>${j.cadence.max}回</b> 続いたら休ませます。` };
    // かけていない管理者には自分の率が無いので、MOCHICA 全体で出す
    const [who, mine] = !j.me.calls && j.team ? ["MOCHICA 全体", j.team] : ["あなた", j.me];
    const a3 = mine.calls ? { cls: { good: "good", low: "low" }[tier(mine)] || "", t: `コール→アポ ${pc(mine.apo, mine.calls)} ${tag(mine)}`, s: `${who}の直近14日（${mine.calls}コール・アポ ${mine.apo}）。担当者と話せた率 ${pc(mine.person, mine.calls)}、話せたうちアポ ${pc(mine.apo, mine.person)}。目安は${benchTxt}。` }
      : { cls: "", t: "直近14日の記録がありません", s: `目安は${benchTxt}。` };
    const ans = (n, q, a) => `<div class="${a.cls || ""}"><small>${n} ${q}</small><b>${a.t}</b><p>${a.s}</p></div>`;
    const bench = j.team ? `<div class="mcc-card"><h2>③ 直近14日と、資料の目安</h2>
        <div class="mcc-tblwrap"><table class="mcc-tbl"><thead><tr><th></th><th class="num">コール</th><th class="num" title="コールのうち、担当者と話せた割合">話せた率</th><th class="num">アポ</th><th class="num">コール→アポ</th><th class="num">話せた→アポ</th><th>目安と比べて</th></tr></thead><tbody>
          ${row("MOCHICA 全体", j.team)}${(j.people || []).map((p) => row(p.name, p)).join("")}</tbody></table></div>
        <p class="mcc-note">目安（資料：B2B のコールドコール→商談化）：${benchTxt}。日ごとに大きくぶれるので、14日のかたまりで見ます。</p></div>` : "";
    const rules = `<div class="mcc-card"><h2>いまの掛け直しのきまり</h2>
        <ul class="mcc-rules"><li>担当者に届かなかったら、<b>${j.cadence.gapDays[0]}営業日後</b>（6回目以降は${j.cadence.gapDays[j.cadence.gapDays.length - 1]}営業日後）に、<b>前回と違う時間帯</b>のうち、つながりやすい時間に自動で掛け直します。</li>
          <li>受付で「いる時間」を聞けたときは、その時間を優先します。</li>
          <li>届かないまま <b>${j.cadence.max}回</b> 続いたら、いったん休ませて <b>${j.cadence.parkDays}日後</b>に再開します（時期が動くのを待つため。「終わり」にはしません）。</li>
          <li>担当者と話せたら、数え直しになります。「自動の掛け直しをやめる」で、会社ごとに止めることもできます。</li></ul>
        <p class="mcc-note">いま、休ませている会社：<b>${j.parked}</b>件／3回以上続けて届いていない会社：<b>${j.streak3}</b>件（あなたがかけられるリストの中）</p></div>`;
    box.innerHTML = `
      <div class="mcc-card"><h2>数字</h2>
        ${purpose(S.admin ? "掛け直しのきまり（回数・間隔・時間帯）を決める根拠を確かめます。全員の記録から出しています。" : "いつ・何回かけるとアポが取れるかを確かめて、自分のかけ方を決めます。全員の記録から出しています。", "report", S.admin ? "人・リストごとの結果は「レポート」" : "自分の結果のふり返りは「レポート」")}
        <div class="mcc-ans">${ans("①", "いま、かけどきか", a1)}${ans("②", "何回目までかける価値があるか", a2)}${ans("③", `${who === "あなた" ? "自分" : "チーム"}の率は目安と比べてどうか`, a3)}</div></div>
      <div class="mcc-ins"><div class="mcc-stack">
      <div class="mcc-card"><h2>① つながりやすい時間帯（日本時間・担当者と話せた割合）</h2>
        <div class="mcc-hours">${j.hours.map((h) => `<div class="mcc-hr ${bestH && h.hour === bestH.hour ? "best" : ""} ${slOk && h.hour === sl.hour ? "now" : ""}" title="${h.hour}時台：${h.calls}件中 ${h.person}件 担当者と話せた${h.prior ? "（資料の目安で補正）" : ""}">${slOk && h.hour === sl.hour ? "<em>いま</em>" : ""}<i style="height:${Math.max(4, Math.round(h.rate / maxRate * 64))}px"></i><b>${Math.round(h.rate * 100)}%</b><span>${h.hour}時</span><small>${h.calls}件</small></div>`).join("")}</div>
        <p class="mcc-note" title="記録が少ない時間帯は、資料の目安（始業直後と終業前が平均より約47%つながりやすい）を「事前の見立て」として足して、極端な数字に振れないようにしています。記録が増えるほど、自分たちの実測が優先されます">直近90日の記録（${j.baseCalls}件）から。掛け直しは、前回と違う時間帯のうち、ここでいちばん高い時間に自動で入ります。</p></div>
      ${j.team ? bench : rules}</div><div class="mcc-stack">
      <div class="mcc-card"><h2>② 何回目の架電で、担当者と話せた・アポが取れたか（直近90日）</h2>
        ${att.length ? `<table class="mcc-tbl"><thead><tr><th>その会社への</th><th class="num">コール</th><th class="num">担当者と話せた</th><th class="num">アポ</th><th class="num">アポ率</th></tr></thead><tbody>
          ${att.map((a) => `<tr><td>${a.n}回目${a.n >= 10 ? "以降" : ""}</td><td class="num">${a.calls}</td><td class="num">${a.person}<small> ${pc(a.person, a.calls)}</small></td><td class="num">${a.apo}</td><td class="num bar"><i style="width:calc((100% - 16px) * ${((a.calls ? a.apo / a.calls : 0) / maxAtt).toFixed(3)})"></i>${pc(a.apo, a.calls)}</td></tr>`).join("")}</tbody></table>
        <p class="mcc-note">6回目以降も取れているなら、掛け直しを続ける根拠になります。ほとんど取れないなら、上限（いま ${j.cadence.max}回）を減らす根拠になります。</p>` : '<p class="mcc-note">まだ記録がありません。</p>'}</div>
      ${j.team ? rules : ""}</div>
      </div>`;
    box.querySelector("[data-go]").addEventListener("click", () => setTab("report"));
  }

  window.mcCallView = start;
})();
