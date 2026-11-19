// kinbot for MOCHICA の架電画面（2026-11-16 新しく作成。kincall の複製ではない）
//   左＝調べる（会社・番号ごとのつながった実績・受付で聞けたこと・SF）／中央＝操作（発信と2段の結果）／右＝これまで（1本の時系列）
//   キーボードだけで1件を終えられる：1〜9 で選ぶ・Enter で記録して次へ・Backspace で戻る・C で発信・S で飛ばす・Z で元に戻す・? で一覧
//   （2026-11-17 クリックだけにした版を、福井さんの指示でキー操作ありに戻した。クリックでもすべて操作できる）
//   確認はブラウザの小窓（alert/confirm）を使わない。知らせは上の1か所に1件ずつ。
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (u, o = {}) => { const r = await fetch(u, { credentials: "include", headers: { "content-type": "application/json" }, ...o }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `うまくいきませんでした（${r.status}）`); return j; };
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
    d: null, cache: new Map(), f: null, notices: [], ni: 0, toast: null, busy: false, mounted: false };
  const blankForm = () => ({ step: "reach", reach: "", outcome: "", reason: "", apoAt: "", apoWho: "", nextAt: "", nextLabel: "", noRetry: false, memo: "", gate: { name: "", hours: "", direct: "" }, hearing: {}, phone: "" });

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
    const tabs = [["call", "かける"], ["browse", "一覧"], ["report", "レポート"]].concat(S.admin ? [["lists", "リストの管理"], ["cross", "部署をまたいだ記録"]] : []);
    $("mccTabs").innerHTML = tabs.map(([k, l]) => `<button role="tab" aria-selected="${S.tab === k}" data-t="${k}">${l}</button>`).join("");
    $("mccTabs").querySelectorAll("[data-t]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.t)));
    if (tabs.length === 1) $("mccTabs").hidden = true;
  }
  function setTab(t) {
    S.tab = t; drawTabs();
    $("mccCall").hidden = t !== "call"; $("mccAdmin").hidden = t === "call"; $("mccList").hidden = t !== "call"; $("mccNotice").hidden = t !== "call";
    if (t === "lists") drawLists(); if (t === "cross") drawCross(); if (t === "browse") drawBrowse(); if (t === "report") drawReport();
  }

  async function start() {
    mount();
    try {
      if (!S.meta) { S.meta = await api("/api/mccall/meta"); S.admin = !!S.meta.admin; }
      drawTabs(); setTab(S.tab);
      await loadLists(); loadStats();
      if (!S.d) await loadQueue(true);
    } catch (e) { $("mccCenter").innerHTML = `<div class="mcc-empty">架電の画面を開けませんでした：${esc(e.message)}<br>少し待ってから、ページを読み込み直してください。</div>`; }
  }
  async function loadLists() {
    const j = await api("/api/mccall/lists"); S.lists = j.items || [];
    if (S.listId && !S.lists.some((l) => l.id === S.listId)) S.listId = 0;
    $("mccList").innerHTML = `<option value="0">担当のリストすべて</option>` + S.lists.map((l) => `<option value="${l.id}" ${l.id === S.listId ? "selected" : ""}>${esc(l.name)}（今かける ${l.now}）</option>`).join("");
  }
  async function loadStats() {
    try { const j = await api("/api/mccall/stats"); const m = j.me;
      $("mccStats").innerHTML = `<span><b>${m.calls}</b>コール</span><span><b>${m.person}</b>担当者と話せた</span><span class="apo"><b>${m.apo}</b>アポ</span>`; S.allStats = j.all;
      S.sf = j.sf || null; drawNotices();
    } catch { $("mccStats").innerHTML = `<span>今日の数字を読めませんでした</span>`; }
  }
  async function loadQueue(openFirst) {
    try {
      const j = await api(`/api/mccall/queue${S.listId ? `?list=${S.listId}` : ""}`); S.queue = j.items || []; S.later = j.later || 0;
      if (openFirst || !S.d) { const f = S.queue.find((x) => !S.d || x.id !== S.d.lead.id); if (f) await open(f.id); else empty(); }
    } catch (e) { setNotice([{ kind: "danger", text: `かける順番を読めませんでした：${e.message}` }]); }
  }
  function empty() {
    S.d = null; S.f = null;
    const noList = !S.lists.length;
    $("mccLeft").innerHTML = ""; $("mccRight").innerHTML = "";
    $("mccCenter").innerHTML = `<div class="mcc-empty">${noList
      ? (S.admin ? `まだ架電リストがありません。<br><button class="mcc-btn primary" id="mccGoLists" style="margin-top:12px">リストを作る</button>` : "まだ担当の架電リストがありません。<br>管理者がリストを作ってあなたを入れると、ここに出ます。")
      : `今かける企業はありません。${S.later ? `<br>今日このあと掛け直す企業が <b>${S.later}件</b> あります（時刻が来たら先頭に並びます）。` : ""}<br><button class="mcc-btn" id="mccReload" style="margin-top:12px">もう一度読む</button>`}</div>`;
    const g = $("mccGoLists"); if (g) g.addEventListener("click", () => setTab("lists"));
    const r = $("mccReload"); if (r) r.addEventListener("click", () => loadQueue(true));
    setNotice([]);
  }

  // ---- 1社を開く（先読みしてあればすぐ出し、裏で最新を読み直す） ----
  async function open(id) {
    const cached = S.cache.get(id);
    S.f = blankForm();
    if (cached) { S.d = cached; drawAll(); }
    else { $("mccCenter").innerHTML = `<div class="mcc-empty">読み込んでいます…</div>`; }
    try {
      const d = await api(`/api/mccall/leads/${id}?lock=1`); S.cache.delete(id);
      if (S.d && S.d.lead.id === id && cached) { S.d = d; drawLeft(); drawRight(); drawNotices(); } else { S.d = d; drawAll(); }
      S.f.phone = (d.phones[0] && d.phones[0].number) || d.lead.phone || "";
    } catch (e) { setNotice([{ kind: "danger", text: e.message }]); S.queue = S.queue.filter((x) => x.id !== id); }
    prefetch();
  }
  // 次の企業の中身を、今の通話中に読んでおく（ASUMO 案2：次の企業の準備を今の通話中に）
  async function prefetch() {
    const n = nextItem(); if (!n || S.cache.has(n.id)) return drawNextCo();
    try { S.cache.set(n.id, await api(`/api/mccall/leads/${n.id}`)); } catch {}
    drawNextCo();
  }
  const nextItem = () => S.queue.find((x) => !S.d || x.id !== S.d.lead.id) || null;
  // 新しい企業を開いたら3列とも上から見せる（前の企業でスクロールした位置のままだと「前回」が隠れる）
  function drawAll() { drawLeft(); drawCenter(); drawRight(); drawNotices(); ["mccLeft", "mccCenter", "mccRight"].forEach((id) => { const e = $(id); if (e) e.scrollTop = 0; }); }

  // ひと目で：採用ニーズ・検討時期・前回までの架電（2026-11-18 福井さん「架電時に調べなくても一目でわかるように」）
  //   ニーズと時期は SF の項目＋過去の記録の文から見つけた1文（出どころと日付つき）。無ければ「まだ聞けていない」と聞くことを促す
  function glanceHtml(d) {
    const g = d.glance || {};
    const row = (lbl, x, ask) => { x = x || {}; const h = x.hit; const st = (x.kb && x.kb.length) || (x.sf && x.sf.length) || (h && h.st === "あり") ? "ok" : h && h.st === "なし" ? "no" : "yet";
      const body = [x.kb && x.kb.length ? `<div><small>架電で聞いた${x.by ? ` ${esc(day(x.by.at))} ${esc(x.by.who)}` : ""}</small>${x.kb.map(([k, v]) => k === "採用ニーズ" || k === "検討時期" ? esc(v) : `${esc(k.replace("説明会・面接の参加人数", "説明会・面接の参加"))} ${esc(v)}`).join("／")}</div>` : "", ...(x.sf || []).map(([k, v]) => `<div><small>SF ${esc(k)}</small>${esc(v)}</div>`),
        h ? `<div><small>${esc(h.src)}${h.at ? ` ${esc(day(h.at))}` : ""}${h.who ? ` ${esc(h.who)}` : ""}${h.st === "なし" ? "（無いと言われた）" : ""}</small>「${esc(h.why)}」</div>` : ""].join("");
      return `<div class="mcc-gl-row ${st}"><b>${lbl}</b><div>${body || `<span class="mcc-gl-yet">まだ聞けていません。${ask}</span>`}</div></div>`; };
    const calls = (d.timeline || []).filter((t) => (t.src === "kinbot" && t.title !== "資料送付") || t.src === "Bales" || (t.src === "SF" && /^架電/.test(t.title))).slice(0, 3);
    return `<div class="mcc-glance"><h3>ひと目で</h3>
      ${row("採用ニーズ", g.need, "採用で困っていること・人数を聞く")}${row("検討時期", g.when, "いつ頃から考えるか・更新月を聞く")}
      ${mynaviHtml(d.mynavi)}
      <div class="mcc-gl-row calls"><b>前回までの架電</b><div>${calls.length ? calls.map((t) => `<div><small>${esc(t.src === "SF" ? day(t.at) : tm(t.at))} ${esc(t.who || "")}</small><span class="r">${esc(t.title)}</span>${t.text ? `<span class="m">${esc(t.text)}</span>` : ""}</div>`).join("") : '<span class="mcc-gl-yet">まだかけていません</span>'}</div></div></div>`;
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
    $("mccLeft").querySelectorAll("[data-ph]").forEach((a) => a.addEventListener("click", () => { S.f.phone = a.dataset.ph; drawLeft(); }));
    $("mccEdit").addEventListener("click", editDialog);
  }
  // 架電画面で足した担当者とメール（2026-11-18 福井さん「会社・担当者情報の編集と複数番号」）
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
    if (f.step === "reach") return Object.entries(R).map(([k, r]) => ({ k, label: r.label, sub: k === "none" ? "応答なし・話し中・留守電・番号が使えない" : k === "gate" ? "担当者が不在・受付で断られた・掛け直しを指定された" : "アポ・資料・フォロー・断り", cls: k === "person" ? "good" : "" }));
    if (f.step === "outcome") return Object.entries(R[f.reach].outcomes).map(([k, l]) => ({ k, label: l, cls: k === "apo" ? "good" : k === "reject" || k === "invalid" ? "bad" : "" }));
    if (f.step === "reason") return S.meta.rejectReasons.map((r) => ({ k: r, label: r }));
    if (f.step === "when") return whenChoices();
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
    if (AUTO.has(f.outcome) && !f.noRetry) return `次は <b>自動で掛け直し</b>（${f.gate.hours || (S.d.lead.gate && S.d.lead.gate.hours) ? "受付で聞いたいる時間に" : "同じ日のうちに。つながりやすいため"}）`;
    if (["invalid", "apo", "reject"].includes(f.outcome)) return "この会社は、このリストではこれで終わりです";
    return "次の掛け直しはありません";
  }
  function drawCenter() {
    const d = S.d; if (!d) return; const f = S.f; const L = d.lead;
    const cs = choicesFor(); const showGate = f.reach === "gate" || f.outcome === "absent";
    const ph = f.phone || (d.phones[0] && d.phones[0].number) || "";
    $("mccCenter").innerHTML = `
      <div class="mcc-sum"><small>前回</small>${d.summary ? esc(d.summary) : "この会社に kinbot から架電した記録はまだありません"}</div>
      <div class="mcc-callrow">
        ${ph ? `<a class="mcc-btn primary big" href="${callHref(ph)}" id="mccDial" aria-keyshortcuts="C">${ICO.phone}${esc(ph)} にかける<span class="mcc-key" style="background:rgba(255,255,255,.18);color:#fff;border-color:transparent">C</span></a>` : `<span class="mcc-note">電話番号がありません</span>`}
        <button class="mcc-btn" id="mccSkip" aria-keyshortcuts="S">${ICO.skip}飛ばす<span class="mcc-key">S</span></button>
        <button class="mcc-btn" id="mccDoc">${ICO.mail}資料を送る</button>
      </div>
      <div class="mcc-step">${f.step === "reach" ? "どこまで届きましたか" : `<button class="mcc-btn" id="mccBack" style="height:28px;padding:0 8px" aria-keyshortcuts="Backspace">${ICO.back}戻る</button><span class="crumb">${esc(crumb())}</span>`}</div>
      ${cs.length ? `<div class="mcc-choices ${cs.length > 4 ? "two" : ""}">${cs.map((c, i) => `<button class="mcc-choice ${c.cls || ""}" data-c="${esc(c.k)}" data-l="${esc(c.label)}" aria-keyshortcuts="${i + 1}"><span class="mcc-key">${i + 1}</span><span>${esc(c.label)}${c.sub ? `<small>${esc(c.sub)}</small>` : ""}</span></button>`).join("")}</div>` : ""}
      ${f.step === "apo" ? slotsHtml() + `<label class="mcc-field" style="margin-top:8px">アポの日時（必須。おすすめを押すと入ります）<input type="datetime-local" id="mccApo" value="${esc(f.apoAt)}" /></label>${f.apoWho ? `<p class="mcc-note">この時間に空いているクローザー：${esc(f.apoWho)}</p>` : ""}` : ""}
      ${f.outcome === "doc_send" ? `<div class="mcc-next">資料はまだ送っていません。<button class="mcc-chip" id="mccDocNow">資料を送る</button></div>` : ""}
      ${f.step === "ready" || f.step === "apo" ? `<div class="mcc-next" id="mccNextTx">${nextText()}${AUTO.has(f.outcome) && !f.noRetry && !f.nextAt ? ` <button class="mcc-chip" id="mccNoRetry">自動の掛け直しをやめる</button>` : ""}</div>
        ${f.outcome !== "callback_req" ? `<div class="mcc-chips">${laterChips().map(([l, dd]) => `<button class="mcc-chip" data-later="${dd.toISOString()}" data-ll="${esc(l)}" aria-pressed="${f.nextAt === dd.toISOString()}">${esc(l)}</button>`).join("")}${f.nextAt ? `<button class="mcc-chip" data-later="">時刻を外す</button>` : ""}</div>` : ""}` : ""}
      ${showGate ? `<div class="mcc-gateform" aria-label="受付で聞けたこと">
        <label class="mcc-field">担当者の名前<input id="mccGName" value="${esc(f.gate.name || (L.gate && L.gate.name) || "")}" autocomplete="off" /></label>
        <label class="mcc-field">直通・内線<input id="mccGDirect" value="${esc(f.gate.direct || (L.gate && L.gate.direct) || "")}" autocomplete="off" inputmode="tel" /></label>
        <div class="mcc-field full">いる時間<div class="mcc-chips">${["午前", "昼", "午後", "夕方"].map((h) => `<button class="mcc-chip" data-hr="${h}" aria-pressed="${(f.gate.hours || (L.gate && L.gate.hours)) === h}">${h}</button>`).join("")}</div></div></div>` : ""}
      ${f.reach === "person" ? hearingHtml(f, L) : ""}
      <label class="mcc-field" style="margin-top:12px">メモ（任意。Ctrl+Enter で記録）<textarea id="mccMemo" placeholder="話したこと・次に聞くこと">${esc(f.memo)}</textarea></label>
      <div class="mcc-foot"><button class="mcc-btn primary big" id="mccRec" ${ready() ? "" : "disabled"} aria-keyshortcuts="Enter">記録して次へ<span class="mcc-key" style="background:rgba(255,255,255,.18);color:#fff;border-color:transparent">Enter</span></button>
        <span class="hint">${ready() ? "Enter で記録（押してもよい）" : f.step === "apo" ? "日時を入れてください" : "数字キーかクリックで選べます"}</span></div>`;
    const c = $("mccCenter");
    c.querySelectorAll("[data-c]").forEach((b) => b.addEventListener("click", () => choose(b.dataset.c, b.dataset.l)));
    const bk = $("mccBack"); if (bk) bk.addEventListener("click", back);
    $("mccSkip").addEventListener("click", skip);
    $("mccDoc").addEventListener("click", sendDoc);
    const dn = $("mccDocNow"); if (dn) dn.addEventListener("click", sendDoc);
    c.querySelectorAll("[data-slot]").forEach((b) => b.addEventListener("click", () => { S.f.apoAt = toLocalInput(b.dataset.slot); S.f.apoWho = b.dataset.who || ""; drawCenter(); }));
    const sd = $("mccSlotDay"); if (sd) sd.addEventListener("change", () => { S.slotDay = sd.value; loadSlotDay(sd.value); });
    if (S.f.step === "apo" && !S.slots) loadSlots();
    $("mccRec").addEventListener("click", record);
    const dial = $("mccDial"); if (dial) dial.addEventListener("click", () => { S.f.phone = ph; });
    const apo = $("mccApo"); if (apo) { apo.addEventListener("input", () => { S.f.apoAt = apo.value; S.f.apoWho = ""; refreshFoot(); }); apo.addEventListener("keydown", (e) => { if (e.key === "Enter" && ready()) { e.preventDefault(); record(); } }); setTimeout(() => apo.focus(), 0); }
    const nr = $("mccNoRetry"); if (nr) nr.addEventListener("click", () => { S.f.noRetry = true; drawCenter(); });
    c.querySelectorAll("[data-later]").forEach((b) => b.addEventListener("click", () => { S.f.nextAt = b.dataset.later; S.f.nextLabel = b.dataset.ll || ""; S.f.noRetry = !b.dataset.later ? S.f.noRetry : false; drawCenter(); }));
    c.querySelectorAll("[data-hr]").forEach((b) => b.addEventListener("click", () => { S.f.gate.hours = S.f.gate.hours === b.dataset.hr ? "" : b.dataset.hr; saveGate(); drawCenter(); }));
    const m = $("mccMemo"); m.addEventListener("input", () => { S.f.memo = m.value; });
    // ヒアリング：月は押すだけ。文字・人数は欄を離れたら保存（記録を押す前に別の会社へ移っても消えないように）
    c.querySelectorAll("[data-hw]").forEach((b) => b.addEventListener("click", () => { S.f.hearing.when = hv("when") === b.dataset.hw ? "" : b.dataset.hw; saveHearing(); drawCenter(); }));
    [["mccHNeed", "need"], ["mccHContact", "contact"], ["mccHTarget", "target"]].forEach(([id, k]) => { const i = $(id); if (!i) return; i.addEventListener("input", () => { S.f.hearing[k] = i.value; }); i.addEventListener("blur", saveHearing); });
    // 受付で聞けたことは、欄を離れたら自動で保存（「保存」ボタンを押し忘れて消えることがないように）
    [["mccGName", "name"], ["mccGDirect", "direct"]].forEach(([id, k]) => { const i = $(id); if (!i) return; i.addEventListener("input", () => { S.f.gate[k] = i.value; }); i.addEventListener("blur", saveGate); });
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
    try { const j = await post(`/api/mccall/leads/${L.id}/hearing`, h); L.hearing = j.hearing; S.cache.delete(L.id); } catch (e) { setNotice([{ kind: "danger", text: `ヒアリングを保存できませんでした：${e.message}` }]); }
  }
  function refreshFoot() { const b = $("mccRec"); if (b) b.disabled = !ready(); }
  async function saveGate() {
    if (!S.d) return; const L = S.d.lead; const g = { name: S.f.gate.name || (L.gate && L.gate.name) || "", hours: S.f.gate.hours || (L.gate && L.gate.hours) || "", direct: S.f.gate.direct || (L.gate && L.gate.direct) || "" };
    if (!g.name && !g.hours && !g.direct) return;
    try { const j = await post(`/api/mccall/leads/${L.id}/gate`, g); L.gate = j.gate; drawLeft(); } catch (e) { setNotice([{ kind: "danger", text: `受付で聞けたことを保存できませんでした：${e.message}` }]); }
  }
  function choose(k, label) {
    const f = S.f;
    if (f.step === "reach") { f.reach = k; f.step = "outcome"; }
    else if (f.step === "outcome") { f.outcome = k; f.step = k === "reject" ? "reason" : k === "callback_req" ? "when" : k === "apo" ? "apo" : "ready"; }
    else if (f.step === "reason") { f.reason = k; f.step = "ready"; }
    else if (f.step === "when") { f.nextAt = k; f.nextLabel = label; f.step = "ready"; }
    drawCenter();
  }
  function back() {
    const f = S.f;
    if (f.step === "outcome") { f.reach = ""; f.step = "reach"; }
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
  async function loadSlotDay(date) {
    if (!date) { S.dayOut = null; return drawSlotsBox(); }
    S.dayOut = { loading: true }; drawSlotsBox();
    try { S.dayOut = await api(`/api/mccall/slots/day?date=${encodeURIComponent(date)}`); } catch (e) { S.dayOut = { error: e.message }; }
    drawSlotsBox();
  }
  const slotChip = (x) => `<button class="mcc-chip" data-slot="${esc(x.at)}" data-who="${esc((x.free || []).join("・"))}" aria-pressed="${S.f.apoAt === toLocalInput(x.at)}" title="${esc((x.free || []).join("・"))}">${esc(x.md)}（${esc(x.dow)}）${esc(x.time)}<small style="font-weight:600;color:inherit;opacity:.75">${x.freeN}/${x.total}人</small></button>`;
  function slotsHtml() {
    const o = S.slots; const d = S.dayOut;
    let main;
    if (!o || o.loading) main = '<p class="mcc-note">クローザーの空きを読んでいます…</p>';
    else if (o.error) main = `<p class="mcc-note" style="color:var(--c-danger)">空きを読めませんでした：${esc(o.error)}</p>`;
    else if (!o.slots.length) main = `<p class="mcc-note">${esc(o.reason || "2週間のうちに空いている枠がありません")}</p>`;
    else main = `<div class="mcc-chips">${o.slots.map(slotChip).join("")}</div>${o.unread && o.unread.length ? `<p class="mcc-note">カレンダーを読めなかった人：${esc(o.unread.join("・"))}</p>` : ""}`;
    let day = "";
    if (d && d.loading) day = '<p class="mcc-note">読んでいます…</p>';
    else if (d && d.error) day = `<p class="mcc-note" style="color:var(--c-danger)">${esc(d.error)}</p>`;
    else if (d) day = d.slots.length ? `<div class="mcc-chips">${d.slots.map(slotChip).join("")}</div>` : `<p class="mcc-note">${esc(d.reason || "この日は空いている時間がありません")}</p>`;
    return `<div id="mccSlots"><div class="mcc-step" style="margin-top:12px">おすすめの日時（MOCHICA のクローザーの空き・人数は空いている人）</div>${main}
      <div class="mcc-next" style="margin-top:8px">ほかの日：<input type="date" id="mccSlotDay" class="mcc-sel" style="height:32px" value="${esc(S.slotDay || "")}" /></div>${day}</div>`;
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

  async function record() {
    if (!S.d || !ready() || S.busy) return; S.busy = true;
    const f = S.f; const L = S.d.lead; const company = L.company;
    const gate = { name: f.gate.name || (L.gate && L.gate.name) || "", hours: f.gate.hours || (L.gate && L.gate.hours) || "", direct: f.gate.direct || (L.gate && L.gate.direct) || "" };
    const body = { reach: f.reach, outcome: f.outcome, reason: f.reason, apoWho: f.outcome === "apo" ? f.apoWho : "", memo: f.memo, phone: f.phone || L.phone, gate, noRetry: f.noRetry, hearing: f.reach === "person" ? hearingBody() : null,
      nextAt: f.nextAt || null, apoAt: f.apoAt ? new Date(f.apoAt).toISOString() : null };
    try {
      const j = await post(`/api/mccall/leads/${L.id}/log`, body);
      const what = crumb();
      S.queue = S.queue.filter((x) => x.id !== L.id);
      toast(`記録しました：${company} ${what}${j.nextAt ? ` → ${tm(j.nextAt)} に掛け直し` : ""}`, { undo: j.logId });
      loadStats(); S.busy = false;
      setTimeout(loadStats, 8000);   // SF への書き込みは記録のあとで行うので、少し待って書けたかを確かめ直す
      const n = nextItem(); if (n) await open(n.id); else { S.d = null; await loadQueue(true); }
      if (S.queue.length < 5) loadQueue(false);
    } catch (e) { S.busy = false; setNotice([{ kind: "danger", text: `記録できませんでした：${e.message}` }]); }
  }
  async function skip() {
    if (!S.d) return; const id = S.d.lead.id; release();
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
      <div id="mccNextCo"></div>`;
    const sc = $("mccScript"); if (sc) sc.addEventListener("toggle", () => ls.set("mcc_script_open", sc.open ? "1" : "0"));
    $("mccRight").querySelectorAll("[data-more]").forEach((b) => b.addEventListener("click", () => { const t = $("mccRight").querySelector(`[data-ti="${b.dataset.more}"]`); t.classList.toggle("open"); b.textContent = t.classList.contains("open") ? "たたむ" : "全部見る"; }));
    $("mccRight").querySelectorAll("[data-undo]").forEach((b) => b.addEventListener("click", () => dialog("この記録を取り消しますか", "SF に書いた活動も消します。取り消すと、この会社は記録する前の状態に戻ります。", "取り消す", () => undo(b.dataset.undo))));
    drawNextCo();
  }
  // トークスクリプト（2026-11-18 福井さん）。リストごとに管理者が書く。{会社名} {担当者} はこの会社のものに差し替える。
  //   開いた・閉じたは覚えておく（毎回開き直さなくてよいように）
  function scriptHtml(d) {
    if (!d.script) return "";
    const L = d.lead; const person = (L.gate && L.gate.name) || L.person || "ご担当者";
    const txt = d.script.replace(/\{会社名\}/g, L.company || "御社").replace(/\{担当者\}/g, person);
    return `<details class="mcc-script" id="mccScript" ${ls.get("mcc_script_open") === "0" ? "" : "open"}><summary>トークスクリプト</summary><div class="body">${esc(txt)}</div></details>`;
  }
  function drawNextCo() {
    const box = $("mccNextCo"); if (!box) return; const n = nextItem();
    if (!n) { box.innerHTML = ""; return; }
    const c = S.cache.get(n.id);
    box.innerHTML = `<div class="mcc-nextco"><small>次の企業（先に読んでおきました）</small><b>${esc(n.company || "")}</b>${n.next_why ? `<br><span style="color:var(--c-deep)">${esc(n.next_why)}</span>` : ""}<br>${c ? (c.summary ? `前回：${esc(c.summary)}` : "kinbot からはまだかけていません") : "読み込んでいます…"}</div>`;
  }

  // ---- 知らせ：大事な順に1件だけ。ほかは「ほか N件」で順に見る ----
  function drawNotices() {
    const d = S.d; const ns = [];
    if (d) {
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
      <dt><kbd>1</kbd>〜<kbd>9</kbd></dt><dd>いま出ている選択肢を選ぶ</dd><dt><kbd>Enter</kbd></dt><dd>記録して次の企業へ</dd>
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
    const box = $("mccAdmin"); box.innerHTML = `<div class="mcc-card">読み込んでいます…</div>`;
    try {
      await loadLists(); await loadStats();
      const all = S.allStats || [];
      box.innerHTML = `
        <div class="mcc-card"><h2>架電リスト</h2>
          <p class="mcc-note">ここで作ったリストは MOCHICA だけのものです。DOC の kincall のリストとは混ざりません。メンバーを選ばないと、MOCHICA のメンバー全員がかけられます。</p>
          <p class="mcc-note">リストを管理できる人：${esc(((S.meta && S.meta.admins) || []).join("・") || "（田中さん・kinbot の管理者だけ）")}</p>
          <div style="margin:12px 0"><button class="mcc-btn primary" id="mccNew">新しいリストを作る</button> <button class="mcc-btn" id="mccTpl">資料送付のひな形</button></div>
          ${S.lists.length ? `<table class="mcc-tbl"><thead><tr><th>リスト</th><th>メンバー</th><th class="num">残り</th><th class="num">今かける</th><th class="num">DOC から</th><th></th></tr></thead><tbody>
            ${S.lists.map((l) => `<tr><td><b>${esc(l.name)}</b></td><td>${l.members && l.members.length ? `${l.members.length}人` : "MOCHICA 全員"}</td><td class="num">${l.open} / ${l.total}</td><td class="num">${l.now}</td><td class="num">${l.cross || ""}</td>
              <td style="white-space:nowrap"><button class="mcc-btn" data-bales="${l.id}">Bales から足す</button> <button class="mcc-btn" data-csv="${l.id}">CSV から足す</button><button class="mcc-btn" data-doc="${l.id}" style="color:#0d5b47">DOC から持ってくる</button> <button class="mcc-btn" data-mem="${l.id}">メンバー</button> <button class="mcc-btn" data-scr="${l.id}">スクリプト</button> <button class="mcc-btn primary" data-leads="${l.id}">割り振る・移す</button> <button class="mcc-btn danger" data-close="${l.id}">閉じる</button></td></tr>`).join("")}</tbody></table>` : '<p class="mcc-note">まだリストがありません。</p>'}
        </div>
        <div class="mcc-card" id="mccDups" hidden></div>
        <div class="mcc-card"><h2>今日の数字（全員）</h2>${all.length ? `<table class="mcc-tbl"><thead><tr><th>名前</th><th class="num">コール</th><th class="num">担当者と話せた</th><th class="num">アポ</th><th class="num">部署をまたいだ架電</th></tr></thead><tbody>${all.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.calls}</td><td class="num">${r.person}</td><td class="num">${r.apo}</td><td class="num">${r.cross}</td></tr>`).join("")}</tbody></table>` : '<p class="mcc-note">今日はまだ記録がありません。</p>'}</div>`;
      $("mccNew").addEventListener("click", () => listDialog());
      drawDups();
      $("mccTpl").addEventListener("click", tplDialog);
      box.querySelectorAll("[data-scr]").forEach((b) => b.addEventListener("click", () => scriptDialog(S.lists.find((l) => l.id === +b.dataset.scr))));
      box.querySelectorAll("[data-mem]").forEach((b) => b.addEventListener("click", () => listDialog(S.lists.find((l) => l.id === +b.dataset.mem))));
      box.querySelectorAll("[data-bales]").forEach((b) => b.addEventListener("click", () => balesDialog(+b.dataset.bales)));
      box.querySelectorAll("[data-doc]").forEach((b) => b.addEventListener("click", () => docDialog(+b.dataset.doc)));
      box.querySelectorAll("[data-csv]").forEach((b) => b.addEventListener("click", () => csvDialog(+b.dataset.csv)));
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
  async function scriptDialog(l) {
    let cur = ""; try { cur = (await api(`/api/mccall/lists/${l.id}/script`)).script; } catch (e) { toast(e.message); return; }
    dialog(`「${l.name}」のトークスクリプト`, "架電中、右の列の上に出ます。{会社名} {担当者} は、その会社のものに差し替わります。空にすると出なくなります。", "保存する", async (w) => {
      await api(`/api/mccall/lists/${l.id}`, { method: "PATCH", body: JSON.stringify({ script: w.querySelector("#mccScr").value }) });
      S.cache.clear(); toast("スクリプトを保存しました（次に開く会社から出ます）");
    }, `<label class="mcc-field" style="margin-top:12px">スクリプト<textarea id="mccScr" style="min-height:320px" placeholder="【受付】&#10;新卒採用のご担当者様はいらっしゃいますか。&#10;&#10;【担当者】&#10;{担当者}様、突然のお電話失礼いたします。">${esc(cur)}</textarea></label>`);
  }

  // ---- 一覧（2026-11-18 福井さん。BALES の一覧画面のかわり）：探す・絞る・並べ替えて、好きな会社を開く ----
  //   絞り方は覚えておく（タブを行き来しても同じ見え方に戻るように）
  const BR = (() => { try { return JSON.parse(ls.get("mcc_browse") || "{}"); } catch { return {}; } })();
  async function drawBrowse() {
    const box = $("mccAdmin");
    const o = { q: BR.q || "", st: BR.st || "open", hot: BR.hot || "", outcome: BR.outcome || "", sort: BR.sort || "hot", list: BR.list || "", page: BR.page || 0 };
    const outs = Object.values(S.meta.reach).flatMap((r) => Object.entries(r.outcomes));
    const sel = (id, cur, opts) => `<select class="mcc-sel" id="${id}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(cur) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
    box.innerHTML = `<div class="mcc-card"><h2>一覧</h2>
      <div class="mcc-filters">
        <input class="mcc-sel mcc-q" id="mccBq" placeholder="会社名・担当者・電話で探す" value="${esc(o.q)}" autocomplete="off" />
        ${sel("mccBlist", o.list, [["", "担当のリストすべて"], ...S.lists.map((l) => [l.id, l.name])])}
        ${sel("mccBst", o.st, [["open", "終わっていない"], ["now", "今かけられる"], ["later", "掛け直し待ち"], ["never", "まだかけていない"], ["done", "終わった"], ["all", "すべて"]])}
        ${sel("mccBhot", o.hot, [["", "温度：すべて"], ["2", "ウォーム以上"], ["3", "ホットだけ"]])}
        ${sel("mccBoc", o.outcome, [["", "前回の結果：すべて"], ...outs])}
        ${sel("mccBsort", o.sort, [["hot", "ホットな順"], ["fewest", "かけた回数が少ない順"], ["attempts", "かけた回数が多い順"], ["last", "前回が新しい順"], ["next", "掛け直しが近い順"], ["company", "会社名の順"]])}
      </div><div id="mccBres"><p class="mcc-note">読み込んでいます…</p></div></div>`;
    const save = () => ls.set("mcc_browse", JSON.stringify(BR));
    const re = () => { BR.page = 0; save(); loadBrowse(); };
    [["mccBlist", "list"], ["mccBst", "st"], ["mccBhot", "hot"], ["mccBoc", "outcome"], ["mccBsort", "sort"]].forEach(([id, k]) => $(id).addEventListener("change", () => { BR[k] = $(id).value; re(); }));
    let t; $("mccBq").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { BR.q = $("mccBq").value.trim(); re(); }, 300); });
    loadBrowse();
  }
  async function loadBrowse() {
    const res = $("mccBres"); if (!res) return;
    const qs = new URLSearchParams(); for (const k of ["q", "st", "hot", "outcome", "sort", "list", "page"]) if (BR[k] != null && BR[k] !== "") qs.set(k, BR[k]);
    let j; try { j = await api(`/api/mccall/browse?${qs}`); } catch (e) { res.innerHTML = `<p class="mcc-note">読めませんでした：${esc(e.message)}</p>`; return; }
    const pages = Math.ceil(j.total / 100);
    res.innerHTML = `<p class="mcc-note">${j.total.toLocaleString()}件${pages > 1 ? `（${j.page + 1} / ${pages} ページ）` : ""}。行を押すと、その会社を「かける」で開きます。</p>
      ${j.items.length ? `<div class="mcc-tblwrap"><table class="mcc-tbl mcc-browse"><thead><tr><th>会社</th><th>担当者</th><th>温度</th><th class="num">回数</th><th>前回</th><th>次に掛け直す</th><th>リスト</th>${S.admin ? "<th>割り振り</th>" : ""}</tr></thead><tbody>
        ${j.items.map((r) => `<tr data-open="${r.id}" tabindex="0" class="${r.done ? "done" : ""}"><td><b>${esc(r.company || "")}</b>${r.cross_from ? ' <span class="mcc-badge doc">DOC</span>' : ""}${r.busy ? ' <span class="mcc-badge">ほかの人が開いています</span>' : ""}</td><td>${esc(r.gate_name || r.person || "")}</td><td>${hotBadge(r.hot)}</td><td class="num">${r.attempts || 0}</td>
          <td>${esc(r.outcome || "")}${r.last_at ? `<small> ${esc(tm(r.last_at))}</small>` : ""}</td><td>${r.done ? "終わり" : r.next_at ? esc(tm(r.next_at)) : ""}</td><td>${esc(r.list || "")}</td>${S.admin ? `<td>${esc(r.assigned || "")}</td>` : ""}</tr>`).join("")}</tbody></table></div>` : '<p class="mcc-note">当てはまる会社がありません。</p>'}
      ${pages > 1 ? `<div class="mcc-chips" style="margin-top:8px">${j.page > 0 ? '<button class="mcc-chip" data-pg="-1">前の100件</button>' : ""}${j.page + 1 < pages ? '<button class="mcc-chip" data-pg="1">次の100件</button>' : ""}</div>` : ""}`;
    res.querySelectorAll("[data-pg]").forEach((b) => b.addEventListener("click", () => { BR.page = (BR.page || 0) + +b.dataset.pg; ls.set("mcc_browse", JSON.stringify(BR)); loadBrowse(); }));
    res.querySelectorAll("[data-open]").forEach((tr) => { const go = () => openFromBrowse(+tr.dataset.open); tr.addEventListener("click", go); tr.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }); });
  }
  // 一覧から開いた会社は、かける順番の先頭に入れる（記録して次へで、元の順番に戻る）
  async function openFromBrowse(id) {
    release(); setTab("call");
    S.queue = [{ id }, ...S.queue.filter((x) => x.id !== id)];
    await open(id);
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
      <td class="num apo">${r.apo}<small> ${pct(r.apo, r.calls)}</small></td><td class="num">${pct(r.apo, r.person)}</td><td class="num">${r.doc}</td><td class="num">${r.follow}</td><td class="num">${r.reject}</td><td class="num">${r.cross || ""}</td></tr>`;
    const T = j.total;
    $("mccRres").innerHTML = `<div class="mcc-kpis"><div><small>コール</small><b>${T.calls}</b></div><div><small>つながった率</small><b>${pct(T.reached, T.calls)}</b></div><div><small>担当者と話せた率</small><b>${pct(T.person, T.calls)}</b></div><div class="apo"><small>アポ</small><b>${T.apo}</b></div><div class="apo"><small>アポ率（コールあたり）</small><b>${pct(T.apo, T.calls)}</b></div><div><small>担当者と話せたうちのアポ</small><b>${pct(T.apo, T.person)}</b></div></div>
      ${j.rows.length ? `<div class="mcc-tblwrap"><table class="mcc-tbl"><thead><tr><th>${{ user: "名前", list: "リスト", day: "日" }[j.by]}</th><th class="num">コール</th><th class="num">会社数</th><th class="num">つながった</th><th class="num">担当者と話せた</th><th class="num">アポ</th><th class="num">話せたうちアポ</th><th class="num">資料</th><th class="num">フォロー</th><th class="num">断り</th><th class="num">部署をまたぐ</th></tr></thead>
        <tbody>${j.rows.map((r) => row(r.label, r)).join("")}${j.rows.length > 1 ? row("合計", T, "sum") : ""}</tbody></table></div>` : '<p class="mcc-note">この期間の記録はありません。</p>'}
      ${j.reasons.length ? `<h3 style="margin-top:16px">断られた理由</h3><div class="mcc-chips">${j.reasons.map((r) => `<span class="mcc-chip" style="cursor:default">${esc(r.k)} ${r.n}</span>`).join("")}</div>` : ""}
      <p class="mcc-note" style="margin-top:12px">数えているのは kinbot の架電画面で記録したものだけです（Bales で記録した過去の架電は入りません）。取り消した記録は数えません。</p>`;
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
  // CSV から足す（2026-11-18）。ファイルはブラウザで読み、見出しの名前で列を見分けて送る。
  // Excel で保存した CSV は Shift_JIS のことが多いので、UTF-8 で読めない文字があれば読み直す。
  const CSV_COLS = {
    company: /^(会社名|企業名|社名|法人名|会社|company|companyname|account)$/i,
    phone: /^(電話番号|電話|代表電話|代表番号|tel|phone|電話番号1|companytel1)$/i,
    person: /^(担当者名|担当者|氏名|名前|person|name|contact|targetname)$/i,
    sfLeadId: /^(リードid|sfリードid|salesforceid|leadid|sfid|id)$/i,
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
    let t = new TextDecoder("utf-8").decode(buf);
    if (t.includes("�")) { try { t = new TextDecoder("shift_jis").decode(buf); } catch {} }
    return t.replace(/^﻿/, "");
  }
  function csvToLeads(table) {
    const head = table[0].map((h) => h.normalize("NFKC").replace(/[\s_]/g, ""));
    const idx = {}; for (const [k, re] of Object.entries(CSV_COLS)) { const i = head.findIndex((h) => re.test(h)); if (i >= 0) idx[k] = i; }
    // 見出しが無い CSV は、kincall と同じ「会社名・担当者名・電話番号」の順とみなす
    const hasHead = idx.company != null || idx.phone != null;
    const map = hasHead ? idx : { company: 0, person: 1, phone: 2 };
    const used = new Set(Object.values(map));
    const body = hasHead ? table.slice(1) : table;
    const leads = body.map((r) => {
      const extra = {}; if (hasHead) table[0].forEach((h, i) => { if (!used.has(i) && h && r[i]) extra[h] = r[i]; });
      return { company: r[map.company] || "", phone: r[map.phone] || "", person: map.person != null ? r[map.person] || "" : "", sfLeadId: map.sfLeadId != null ? r[map.sfLeadId] || "" : "", extra };
    }).filter((x) => x.company || x.phone);
    return { leads, hasHead, found: Object.keys(idx) };
  }
  function csvDialog(listId) {
    let parsed = null;
    const w = dialog("CSV から足す", "1行1社。見出しに「会社名」「電話番号」「担当者名」「リードID」があれば自動で見分けます（見出しが無ければ 会社名・担当者名・電話番号 の順）。ほかの列は詳細に残ります。ほかの開いている MOCHICA のリストにある番号と、アプローチ禁止の会社は足しません。", "足す", async () => {
      if (!parsed || !parsed.leads.length) throw new Error("CSV ファイルを選んでください（読める行がありません）");
      if (parsed.leads.length > 5000) throw new Error(`一度に足せるのは 5000件までです（${parsed.leads.length}件あります）。分けて読み込んでください`);
      const r = await post(`/api/mccall/lists/${listId}/from-csv`, { rows: parsed.leads });
      importDone(`${r.added}件 足しました${r.banned ? `・アプローチ禁止 ${r.banned}件は外しました` : ""}${r.bad ? `・会社名も電話番号も無い ${r.bad}件は読めませんでした` : ""}${r.nolead ? `。うち ${r.nolead}件は SF のリードIDが無いため、架電結果は SF に書かれません` : ""}`, r);
      drawLists();
    }, `<label class="mcc-field" style="margin-top:12px">CSV ファイル<input type="file" id="mccCsvF" accept=".csv,.tsv,.txt,text/csv" /></label><p class="mcc-note" id="mccCsvP" style="margin-top:6px"></p>`);
    w.querySelector("#mccCsvF").addEventListener("change", async (e) => {
      const p = w.querySelector("#mccCsvP"); const f = e.target.files[0]; parsed = null; if (!f) { p.textContent = ""; return; }
      try {
        const table = parseCsv(await readCsvFile(f));
        if (!table.length) { p.textContent = "中身が空です"; return; }
        parsed = csvToLeads(table);
        const ex = parsed.leads[0];
        p.textContent = `${parsed.leads.length}件 読めました${parsed.hasHead ? "" : "（見出しなしとして読みました）"}${parsed.hasHead && !parsed.found.includes("phone") ? "。電話番号の列が見つかりません" : ""}${ex ? `。1件目：${ex.company || "会社名なし"} / ${ex.phone || "電話番号なし"}${ex.person ? ` / ${ex.person}` : ""}` : ""}`;
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
  async function drawLeads(l) {
    if (!l) return;
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
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><button class="mcc-btn" id="mccLdBack">${ICO.back}リストの一覧へ</button><h2 style="margin:0">「${esc(l.name)}」のリード</h2><span class="mcc-note" style="margin:0">残り ${j.total}件${j.total > j.items.length ? `（上から ${j.items.length}件を表示）` : ""}</span></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:12px 0"><span class="mcc-note" id="mccLdN" style="margin:0">選んでいません（割り振りは残り全部が対象）</span>
          <button class="mcc-btn primary" id="mccLdAssign">複数人に分ける</button><button class="mcc-btn" id="mccLdMove" ${others.length ? "" : 'disabled title="ほかに開いているリストがありません"'}>選んだリードを他のリストへ移す</button></div>
        ${j.items.length ? `<table class="mcc-tbl"><thead><tr><th><input type="checkbox" id="mccLdAll" aria-label="全部選ぶ" /></th><th>会社</th><th>担当者</th><th>温度</th><th class="num">回数</th><th>前回</th><th>割り振り</th></tr></thead><tbody>
          ${j.items.map((r) => `<tr><td><input type="checkbox" data-ld="${r.id}" aria-label="${esc(r.company || "")}を選ぶ" /></td><td>${esc(r.company || "")}</td><td>${esc(r.person || "")}</td><td>${hotBadge(r.hot)}</td><td class="num">${r.attempts || 0}</td><td>${esc(r.outcome || "")}</td><td>${esc(r.assigned || "")}</td></tr>`).join("")}</tbody></table>` : '<p class="mcc-note">終わっていないリードがありません。</p>'}</div>`;
    const cnt = () => { $("mccLdN").textContent = sel.size ? `${sel.size}件 選んでいます` : "選んでいません（割り振りは残り全部が対象）"; };
    box.querySelectorAll("[data-ld]").forEach((c) => c.addEventListener("change", () => { c.checked ? sel.add(+c.dataset.ld) : sel.delete(+c.dataset.ld); cnt(); }));
    const all = $("mccLdAll"); if (all) all.addEventListener("change", () => { box.querySelectorAll("[data-ld]").forEach((c) => { c.checked = all.checked; all.checked ? sel.add(+c.dataset.ld) : sel.delete(+c.dataset.ld); }); cnt(); });
    $("mccLdBack").addEventListener("click", drawLists);
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
    $("mccLdMove").addEventListener("click", () => {
      if (!sel.size) { toast("移すリードを、左のチェックで選んでください"); return; }
      dialog("選んだリードを他のリストへ移す", `${sel.size}件を移します。移したリードの割り振りは外れます（移し先のメンバーがかけます）。これまでの架電の記録は消えません。移し先に同じリードがあるものは移しません。`, "移す", async (w) => {
        const r = await post(`/api/mccall/lists/${l.id}/move`, { toListId: w.querySelector("#mccLdTo").value, leadIds: [...sel] });
        toast(`${r.moved}件 移しました${r.skipped ? `（移し先に同じリードがある ${r.skipped}件は移していません）` : ""}`);
        await loadLists(); drawLeads(S.lists.find((x) => x.id === l.id) || l);
      }, `<label class="mcc-field" style="margin-top:12px">移し先のリスト<select class="mcc-sel" id="mccLdTo" style="max-width:none">${others.map((x) => `<option value="${x.id}">${esc(x.name)}（残り ${x.open}件）</option>`).join("")}</select></label>`);
    });
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

  window.mcCallView = start;
})();
