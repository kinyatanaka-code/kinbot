// SHOBO：Bales のリスト（拡張機能が Bales の画面から取り込んだもの）を見る（2026-11-15 田中さん）
//   2026-11-22 田中さん「もっと見やすく、まずリードの一覧だけ」：表の上の数字（SF・ホット度）は「くわしい数字」にたたむ
//   左：リストのカード（名前・件数・取り込んだ日時・取り込み中の進み具合）／右：選んだリストの会社の表（検索・絞り込み・CSV）
// 「見張り（架電の記録）」のカードは一旦出さない（2026-11-23 田中さん「一旦非表示で」）。取り込み自体は止めていない。また出すときは true に
const SHOW_FEEDS = false;
const ASG_ICO = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" style="vertical-align:-2px;margin-right:4px"><circle cx="5" cy="5" r="2.4" fill="currentColor"/><circle cx="11.5" cy="5.5" r="2" fill="currentColor" opacity=".7"/><path d="M1.2 13c.4-2.4 2-3.8 3.8-3.8s3.4 1.4 3.8 3.8z" fill="currentColor"/><path d="M8.6 13c.3-1.8 1.4-3 2.9-3s2.6 1.2 2.9 3z" fill="currentColor" opacity=".7"/></svg>';
// リストアポ率の小さな表示（アポ ÷ 架電したリード）（2026-11-23 田中さん「それぞれのリストのアポ率も」→「リストアポ率に名前変えて」）
const apoTxt = (apo, called) => { apo = Number(apo || 0); called = Number(called || 0); return `<span class="bl-apo" title="アポ（最終架電結果がアポ獲得）${apo.toLocaleString()}件 ÷ 架電したリード ${called.toLocaleString()}件">リストアポ率 <b>${called ? (apo / called * 100).toFixed(1) : "0.0"}%</b><small>${apo.toLocaleString()}/${called.toLocaleString()}</small></span>`; };
// ステージ別の箱（サーバーの BALES_STG と同じ印）
// ホット度のカード（すべてのリードの隣）（2026-11-23 田中さん）
const HOTS = [["hot", "ホット", "担当者名・ニーズ・検討時期の3つ"], ["warm", "ウォーム", "3つのうち2つ"], ["cold", "コールド", "1つ以下・まだ判定していない"]];
// stg=mcuser（MOCHICA ユーザー）の表の見出し用。STG の箱には出さない
const STG_EXTRA = { mcuser: "MOCHICAユーザー", ng: "アプローチ禁止" };
const STG = [["call", "かけるリスト", "リサイクル・アーカイブ以外（ナーチャリングも含む）"], ["nurture", "ナーチャリング", "ジャッジ・営業フォロー・資料送付"], ["recycle", "リサイクル", "ステージがリサイクル"], ["archive", "アーカイブ", "ステージがアーカイブ"]];
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (u, o = {}) => { const r = await fetch(u, { credentials: "include", ...o }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j; };
  const dt = (s) => { if (!s) return ""; const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  // Bales の項目の名前（英語のことが多い）を、わかる言葉にする。合わないものは名前のまま出す
  const LABELS = [[/^(company|companyName|company_name|corporateName|corporate_name|accountName|account\.name|company\.name|name)$/i, "会社名", 1],
    [/(phone|tel)/i, "電話", 2], [/(^|\.)(owner|assignee|user|staff|charge)(\.name|Name|_name|\.fullName)$/i, "担当", 3], [/status|stage|phase|result/i, "ステータス", 4],
    [/(last).*(call|contact|activity|action)|lastCalled|last_called/i, "最終架電", 5], [/(prefecture|pref|state|都道府県)/i, "都道府県", 6], [/(url|website|site|homepage)/i, "会社URL", 7],
    [/(email|mail)/i, "メール", 8], [/(industry|業種)/i, "業種", 9], [/(employee)/i, "従業員数", 10],
    [/^(fullName|full_name|personName|contactName|lastName)$/i, "名前", 1.5], [/(lastActivity|last_activity)/i, "最終活動日", 4.5], [/(createdAt|created_at)/i, "作成日時", 11]];
  const labelOf = (k) => { const leaf = String(k).split(".").pop(); for (const [re, l] of LABELS) if (re.test(k) || (l !== "会社名" && re.test(leaf))) return l; return k; };   // 「担当.name」を会社名と取り違えない
  // 表示項目：選んだ列はリストごとにこのブラウザに覚える（Bales の「表示項目」と同じ考え方）（2026-11-15）
  const colsKey = (k) => "kb_bales_cols2_" + k;   // 2026-11-16：列を「会社名・電話番号・担当者名…」に決めたので、前に選んだ列はいったん忘れる
  const savedCols = (k) => { try { return JSON.parse(localStorage.getItem(colsKey(k)) || "null"); } catch { return null; } };
  // 値の取り出し：「a.[].b」は配列の全部（a.0.b、a.1.b…）をつなげる。日時は Bales と同じ「11/13 10:31」に
  const valOf = (d, key) => { if (!String(key).includes("[]")) return d[key]; const re = new RegExp("^" + key.split("[]").map((x) => x.replace(/[.*+?^${}()|\\]/g, "\\$&")).join("\\d+") + "$"); return Object.keys(d).filter((k) => re.test(k)).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).map((k) => d[k]).filter((v) => v !== "" && v != null).join("、"); };
  const fmt = (v) => { const t = String(v ?? ""); if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t)) { const x = new Date(t); if (!isNaN(x)) { const p = (n) => String(n).padStart(2, "0"); return `${p(x.getMonth() + 1)}/${p(x.getDate())} ${p(x.getHours())}:${p(x.getMinutes())}`; } } return t; };
  const pickCols = (cols, k, view) => {
    const sv = k && savedCols(k); if (sv && sv.length) return sv.map((x) => typeof x === "string" ? { key: x, label: (view || []).find((v) => v.key === x)?.label || labelOf(x) } : x);
    if (view && view.length) return view.map((v) => ({ key: v.key, label: v.label }));   // Bales の一覧と同じ並び・見出し
    // わかる項目を順に（同じ言葉は1つだけ）→ 足りなければよく埋まっている項目
    const out = [], used = new Set();
    // 同じ言葉に当たる項目が複数あるときは「…name」を選び、色・コード・種類の項目（uranus などの中の印）は後回しにする（2026-11-15 ステータスが uranus と出ていた）
    const rank = (k) => (/(^|\.)name$|Name$/.test(k) ? 0 : 2) + (/(color|colour|code|key|type|icon|theme)$/i.test(k) ? 5 : 0);
    for (const [, l, ord] of LABELS) { const c = (cols || []).filter((x) => labelOf(x.key) === l && !/id$/i.test(x.key)).sort((a, b) => rank(a.key) - rank(b.key))[0]; if (c && !used.has(l)) { out.push({ ...c, label: l, ord }); used.add(l); } }
    out.sort((a, b) => a.ord - b.ord);
    for (const c of cols || []) { if (out.length >= 6) break; if (out.some((x) => x.key === c.key) || /(^|\.)(id|_id|uuid)$/i.test(c.key)) continue; out.push({ ...c, label: labelOf(c.key) }); }
    return out.slice(0, 6);
  };
  const coNorm = (s) => String(s || "").normalize("NFKC").replace(/株式会社|有限会社|合同会社|一般社団法人|一般財団法人|社会福祉法人|医療法人|学校法人|\(株\)|㈱|（株）|\s/g, "").toLowerCase();
  let feeds = [], fday = "", wdiag = null, diag = null, lists = [], cur = null, q = "", fcol = "", fval = "", page = 0, poll = null, mtCos = null;
  // 画面の形：「リスト管理」の一覧（カード）→ 押すとそのリストの表（2026-11-22 田中さん：ホワイトボードの絵のとおり）
  //   home＝全てのリード・メンバー別・見張りのカード／list＝1つのリスト（メンバーのカードは、そのリストを所有者で絞ったもの）
  let mode = "home", memberF = "", members = null, memPick = null, srcF = "", stgF = "", stgHome = "", retStage = "", memHome = null, retMem = null;   // memHome：メンバーを押して開いた「リードソース別」の画面（{ name, blank }）。retMem：そこから表を開いたときの戻り先   // stgHome：ステージ別の箱を押して開いた「メンバーごと」の画面。retStage：そこから表を開いたときの戻り先   // stgF：ステージ別（nurture・recycle・archive）   // srcF：リードの出どころで絞ったリスト（2026-11-23）
  let hotF = "", hotSort = false, crF = "", ownF = "", sfF = "";
  const selRows = new Set();   // 表で選んだリード（割り振り用。表の条件を変えたら空にする）（2026-11-23）   // 所有者・SF の絞り込み（2026-11-22）
  // 架電結果：MOCHICALL（SF）と同じ8つにそろえる（サーバーの BALES_CR と同じ）（2026-11-22 田中さん）。
  //   担当者接触ニーズなし→お断り、資料送付→営業フォロー。空・どれにも当たらないものは「-」（当たらない結果は最終活動コメントの頭に出す）
  const CR = [["受付ブロック", /^\s*受付ブロック\s*$/], ["担当者不在", /^\s*担当者不在\s*$/], ["担当者接触：お断り", /^\s*(担当者接触[:：]?\s*お断り|担当者接触[:：]?\s*ニーズなし)\s*$/], ["担当者接触：アポ獲得", /^\s*担当者接触[:：]?\s*アポ獲得\s*$/], ["担当者接触：営業フォロー", /^\s*(担当者接触[:：]?\s*営業フォロー|資料送付)\s*$/], ["現在使われていない", /^\s*現在使われていない\s*$/], ["コールのみ", /^\s*コールのみ\s*$/], ["問い合わせ", /^\s*問い合わせ\s*$/]];
  const crOf = (v) => { const t = String(v || ""); for (const [k, re] of CR) if (re.test(t)) return k; return "-"; };
  const CR_CLS = { "担当者接触：アポ獲得": "apo", "担当者接触：営業フォロー": "re", "担当者不在": "ab", "担当者接触：お断り": "ng", "受付ブロック": "ng2", "現在使われていない": "ng2", "コールのみ": "no", "問い合わせ": "etc" };
  const crCell = (d) => { const raw = d.callResult || ""; const k = crOf(raw); return k !== "-" ? `<span class="bl-cr ${CR_CLS[k] || "etc"}" title="${esc(raw + (d.lastCalledAt ? `（${fmt(d.lastCalledAt)}）` : ""))}">${esc(k)}</span>` : '<span class="mc-note">-</span>'; };   // ホット度の絞り込み（hot/warm/cold/warm+）と、ホット順に並べるか（2026-11-16）
  const PER = 100;
  // ホット度の印：3つ（担当者名・ニーズ・検討時期）のそろい具合。丸の色で、聞けた（緑）・聞けたが無い（灰）・まだ（白）
  const HOT_TXT = { 3: "ホット", 2: "ウォーム" };
  const hotDot = (x, lbl) => { const st = (x || {}).st || ""; const cls = st === "あり" ? "ok" : st === "なし" ? "no" : ""; return `<span class="bl-hd ${cls}" title="${esc(lbl + "：" + (st === "あり" ? "聞けた" : st === "なし" ? "聞けたが無い" : "まだ") + ((x || {}).why ? "（" + x.why + "）" : ""))}">${esc(lbl.slice(0, 1))}</span>`; };
  const hotCell = (h) => { if (!h) return '<span class="mc-note">判定待ち</span>'; const lv = h.n >= 3 ? "hot" : h.n === 2 ? "warm" : "cold"; return `<span class="bl-hot ${lv}">${HOT_TXT[h.n] || "コールド"}</span><span class="bl-hds">${hotDot(h.name, "担当者名")}${hotDot(h.need, "ニーズ")}${hotDot(h.when, "検討時期")}</span>`; };

  async function load() {
    const root = $("mcBalesView"); if (!root) return;
    try { const d0 = await api("/api/mochica/bales/lists"); lists = d0.items || []; diag = d0.diag || null; try { feeds = (await api("/api/mochica/bales/feeds")).items || []; } catch { feeds = []; } wdiag = d0.wdiag || null; } catch (e) { root.innerHTML = `<div class="mc-box"><p class="mc-note">読めませんでした：${esc(e.message)}</p></div>`; return; }
    if (!cur || (!lists.some((l) => l.list_key === cur) && !feeds.some((f) => f.feed === cur))) cur = (feeds[0] || {}).feed || (lists.find((l) => l.status !== "running") || lists[0] || {}).list_key || null;
    if (!mtCos && window.mcMeetingCompanies) { try { mtCos = new Map((await window.mcMeetingCompanies()).map((c) => [coNorm(c), c])); } catch { mtCos = new Map(); } }
    draw();
    clearTimeout(poll); if (lists.some((l) => l.status === "running") && !$("mcBalesView").closest("[hidden]")) poll = setTimeout(load, 3000);
  }
  // 所有者（kinbot・Bales で、そのリードを持っている人）の列。メンバー別のカードはこの列で絞る
  const ownerCol = (l) => { const v = (l && l.view) || []; const a = v.find((x) => /所有者|オーナー/.test(x.label)); if (a) return a.key;
    const c = ((l && l.cols) || []).find((x) => /(^|\.)owner(\.name|Name|\.fullName)?$/i.test(x.key)); return c ? c.key : ""; };
  const mainList = () => lists.find((l) => l.status !== "running") || lists[0] || null;
  const PLUS = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  // ===== ページの上の帯（ヘッダー）に、会社名で探す・取り込み直す・CSV・SF と結び直す を出す（2026-11-22 田中さん「ヘッダーに移して」）=====
  //   表を描き直しても、探す欄はそのまま（打っている途中で消えない）。一覧（カード）に戻ったら消す
  function headActs(l, csvQ) {
    const h = $("mcHeadList"); if (!h) return;
    if (!l) { h.hidden = true; h.innerHTML = ""; h.dataset.k = ""; return; }
    h.hidden = false;
    if (h.dataset.k !== l.list_key) {
      h.dataset.k = l.list_key;
      h.innerHTML = `<label class="mt-find bl-hfind"><svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M13.5 13.5 17 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg><input type="search" data-hq placeholder="会社名・名前・電話番号で探す" value="${esc(q)}"></label>
        <a class="mt-btn ghost" href="https://mochica.balescloud.jp/app/lead-list" target="_blank" rel="noopener">取り込み直す ↗</a><a class="mt-btn ghost" data-hcsv href="#">CSV</a><button type="button" class="mt-btn" data-sf></button>`;
      let tm = null; const qi = h.querySelector("[data-hq]");
      qi.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(() => { q = qi.value.trim(); page = 0; detail(); }, 400); });
      h.querySelector("[data-sf]").addEventListener("click", async (e) => { const b = e.currentTarget; b.disabled = true; b.textContent = "結びつけています…";
        try { await api(`/api/mochica/bales/lists/${encodeURIComponent(cur)}/sf-link`, { method: "POST" }); sfPoll(cur); } catch (er) { b.disabled = false; b.textContent = "SF と結び直す"; alert("始められませんでした：" + er.message); } });
    }
    h.querySelector("[data-hcsv]").setAttribute("href", `/api/mochica/bales/lists/${encodeURIComponent(l.list_key)}/csv?${csvQ}`);
    const sb = h.querySelector("[data-sf]"); if (sb && !sb.disabled) sb.textContent = l.sf_info ? "SF と結び直す" : "SF と結びつける";
  }
  // 一覧へ戻る。ブラウザの「戻る」でも戻れるよう、リストを開くときに履歴を1つ足しておく（2026-11-22 田中さん「戻れるように」）
  function goHome(fromPop) { if (!fromPop && history.state && history.state.blList) { history.back(); return; }
    // ステージ別のメンバーの画面から表を開いていたら、そこへ戻る
    if (mode === "list" && retMem) { mode = "member"; memHome = retMem; retMem = null; memberF = ""; fcol = ""; fval = ""; q = ""; crF = ""; ownF = ""; sfF = ""; srcF = ""; stgF = ""; page = 0; draw(); window.scrollTo(0, 0); return; }
    if (mode === "list" && retStage) { mode = "stage"; stgHome = retStage; retStage = ""; memberF = ""; fcol = ""; fval = ""; q = ""; crF = ""; ownF = ""; sfF = ""; srcF = ""; stgF = ""; page = 0; draw(); window.scrollTo(0, 0); return; }
    stgHome = ""; retStage = ""; memHome = null; retMem = null; hotF = ""; mode = "home"; memberF = ""; fcol = ""; fval = ""; q = ""; crF = ""; ownF = ""; sfF = ""; srcF = ""; stgF = ""; page = 0; draw(); window.scrollTo(0, 0); }
  function openList() { selRows.clear(); try { history.pushState({ blList: 1 }, "", location.href); } catch {} draw(); window.scrollTo(0, 0); }
  window.addEventListener("popstate", () => { if (mode === "list" || mode === "stage" || mode === "member") goHome(true); });
  function draw() {
    const root = $("mcBalesView"); if (!root) return;
    if (mode === "list" && cur && (lists.some((l) => l.list_key === cur) || feeds.some((f) => f.feed === cur))) {
      root.innerHTML = `<div class="bl-one"><div class="bl-main" id="blMain"><button type="button" class="bl-back" data-home>‹ リスト管理に戻る</button><div class="mc-note">読み込んでいます…</div></div></div>`;
      root.querySelector("[data-home]").addEventListener("click", () => goHome());
      if (feeds.some((f) => f.feed === cur)) feedDetail(); else detail();
      return;
    }
    if (mode === "stage" && stgHome) return stageView(root);
    if (mode === "member" && memHome) return memberView(root);
    home(root);
  }
  async function home(root) {
    headActs(null);
    const run = lists.filter((l) => l.status === "running");
    const m0 = mainList(); const oc = ownerCol(m0);
    const hotTxt = (l) => { const h = l.hot_n || {}; return (h.hot || h.warm) ? `<span class="bl-lc-hot"><i class="hot"></i>ホット ${Number(h.hot || 0).toLocaleString()}<i class="warm"></i>ウォーム ${Number(h.warm || 0).toLocaleString()}</span>` : ""; };
    root.innerHTML = `<div class="bl-home">
      <div class="bl-home-h"><h2>リスト管理</h2><button type="button" class="bl-add" data-addlist>${PLUS}リスト追加</button></div>
      ${run.map((l) => `<div class="bl-run"><b>取り込み中</b><small>${esc(l.name)} ・ ${Number(l.got || 0).toLocaleString()}${l.total ? ` / ${Number(l.total).toLocaleString()}` : ""}件</small><div class="bl-bar"><i style="width:${l.total ? Math.min(100, Math.round(l.got / l.total * 100)) : 30}%"></i></div></div>`).join("")}
      <div class="bl-lgrid">${lists.filter((l) => l.status !== "running").map((l) => `<button type="button" class="bl-lc main" data-l="${esc(l.list_key)}"><b>${esc(l.name || l.list_key)}</b><span class="n">${Number((l.count || 0) - (l.dup_hidden || 0) - (l.user_hidden || 0) - (l.ng_hidden || 0)).toLocaleString()}<small>件</small></span>${l.dup_hidden ? `<small>重複 ${Number(l.dup_hidden).toLocaleString()}件をまとめた</small>` : ""}${l.user_hidden ? `<small title="SF の取引先に、商談名に「新規」が付いた受注処理完了の商談があるリード">MOCHICAユーザー ${Number(l.user_hidden).toLocaleString()}件を省いた</small>` : ""}${l.ng_hidden ? `<small>アプローチ禁止 ${Number(l.ng_hidden).toLocaleString()}件を省いた</small>` : ""}<span data-apo-l="${esc(l.list_key)}"></span>${l === m0 ? "" : hotTxt(l)}<small>${esc(dt(l.done_at || l.run_at))} に取り込み</small></button>`).join("") || '<div class="bl-empty">まだ取り込んだリストがありません。右上の「リスト追加」から、Bales のリストを取り込んでください。</div>'}${m0 ? HOTS.map(([k, l, d]) => `<button type="button" class="bl-lc hotc ${k}" data-hc="${k}"><b><i class="bl-hdot ${k}"></i>${l}</b><span class="n" data-hc-n="${k}">…<small>件</small></span><span data-hc-a="${k}"></span><small>${d}</small></button>`).join("") : ""}</div>
      <div class="bl-lgrid" data-srcs style="margin-top:10px"></div>
      <div class="bl-home-h sub"><h3>ステージ別</h3></div>
      <div class="bl-lgrid" data-stgs>${STG.filter(([k]) => k !== "call").map(([k, l, d]) => `<button type="button" class="bl-lc stg ${k}" data-stg="${k}"><b>${l}</b><span class="n" data-stg-n="${k}">…<small>件</small></span><span data-stg-a="${k}"></span><small>${d}</small></button>`).join("")}</div>
      <div class="bl-home-h sub"><h3>メンバー別</h3><button type="button" class="bl-add" data-addmem ${oc ? "" : "disabled"}>${PLUS}メンバー追加</button></div>
      <div class="bl-lgrid" data-mems>${oc ? '<div class="mc-note">読み込んでいます…</div>' : '<div class="mc-note">リストに「所有者」の列が無いので、メンバー別に分けられません。</div>'}</div>
      ${SHOW_FEEDS && feeds.length ? `<div class="bl-home-h sub"><h3>見張り（架電の記録）</h3></div><div class="bl-lgrid">${feeds.map((f) => `<button type="button" class="bl-lc" data-l="${esc(f.feed)}"><b>${esc(f.name || f.feed)}</b><span class="n">${Number(f.total || 0).toLocaleString()}<small>件</small></span><small>${f.last_sync ? `${esc(dt(f.last_sync))} に読んだ（新しい ${f.last_new || 0}件）` : "まだ読んでいません"}</small></button>`).join("")}</div>` : ""}
      ${lists.length ? "" : diagHtml()}</div>`;
    root.querySelectorAll("[data-l]").forEach((b) => b.addEventListener("click", () => { cur = b.dataset.l; mode = "list"; memberF = ""; q = ""; fcol = ""; fval = ""; crF = ""; ownF = ""; sfF = ""; srcF = ""; stgF = ""; page = 0; openList(); }));
    root.querySelector("[data-addlist]").addEventListener("click", () => sheet(`<h3 class="bl-sh-t">リストを追加する</h3>
      <p class="mc-note" style="line-height:1.8">1. Bales の<a href="https://mochica.balescloud.jp/app/lead-list" target="_blank" rel="noopener">リード一覧</a>を開き、取り込みたいリスト（絞り込み）にします。<br>2. 右下の「kinbot に取り込む」→「全部取り込む」を押します。<br>3. 取り込みが終わると、この画面にカードが増えます。</p>
      <p class="mc-note">拡張機能 kinbot-ext（2.2.3 以上）が要ります。</p>`));
    // ステージ別の件数と、押したときの表（2026-11-23 田中さん「ナーチャリング、リサイクル、アーカイブの箱を」）
    // 押すと、そのステージをメンバーごとに分けた画面（2026-11-23 田中さん「カードを押すと各メンバーカードが出て、そのステージの件数」）
    root.querySelectorAll("[data-stg]").forEach((b) => b.addEventListener("click", () => { if (!m0) return; mode = "stage"; stgHome = b.dataset.stg; openList(); }));
    if (m0) api(`/api/mochica/bales/lists/${encodeURIComponent(m0.list_key)}/stages`).then((d) => { for (const [k] of STG.filter(([x]) => x !== "call")) { const el = root.querySelector(`[data-stg-n="${k}"]`); if (el) el.innerHTML = `${Number(d[k] || 0).toLocaleString()}<small>件</small>`; const ea = root.querySelector(`[data-stg-a="${k}"]`); if (ea) ea.innerHTML = apoTxt(d[`${k}_apo`], d[`${k}_called`]); }
      const em = root.querySelector(`[data-apo-l="${CSS.escape(m0.list_key)}"]`); if (em) em.innerHTML = apoTxt(d.total_apo, d.total_called);
      for (const [k] of HOTS) { const en = root.querySelector(`[data-hc-n="${k}"]`); if (en) en.innerHTML = `${Number(d[`h_${k}`] || 0).toLocaleString()}<small>件</small>`; const ea = root.querySelector(`[data-hc-a="${k}"]`); if (ea) ea.innerHTML = apoTxt(d[`h_${k}_apo`], d[`h_${k}_called`]); } }).catch(() => {});
    root.querySelectorAll("[data-hc]").forEach((b) => b.addEventListener("click", () => { if (!m0) return; cur = m0.list_key; mode = "list"; memberF = ""; fcol = ""; fval = ""; q = ""; crF = ""; ownF = ""; sfF = ""; srcF = ""; stgF = ""; hotF = b.dataset.hc; page = 0; openList(); }));
    // リードの出どころごとのリスト（「すべてのリード」の隣に並べる）（2026-11-23 田中さん「リードのでどころでリスト作って」）
    if (m0) api(`/api/mochica/bales/lists/${encodeURIComponent(m0.list_key)}/sources`).then((d) => {
      const sb = root.querySelector("[data-srcs]"); if (!sb || !root.isConnected) return; const it = d.items || []; if (!it.length) { sb.remove(); return; }
      // 出どころは1枚の「SFリードソース」カードにまとめ、中に出どころと件数を並べる（2026-11-23 田中さん「SFリードソースカードにまとめて」）。押すとその出どころの表
      const grid = root.querySelector(".bl-lgrid"); const host = grid && grid !== sb ? grid : sb;
      const named = it.filter((v) => v.v !== "-").length;
      host.insertAdjacentHTML("beforeend", `<div class="bl-lc srcs"><div class="bl-srcs-h"><b>SFリードソース</b><small>${named}種類・件数／リストアポ率</small></div>
        <div class="bl-srcs-l">${it.map((v) => `<button type="button" data-src="${esc(v.v)}" title="アポ ${Number(v.apo || 0).toLocaleString()} ÷ 架電 ${Number(v.called || 0).toLocaleString()}"><span>${esc(v.v === "-" ? "リードソースなし" : v.v)}</span><em>${Number(v.n || 0).toLocaleString()}</em><i>${v.called ? (v.apo / v.called * 100).toFixed(1) : "0.0"}%</i></button>`).join("")}</div>
        <small>${esc(m0.name || "")} から・押すとそのリードの表</small></div>`);
      if (host !== sb) sb.remove();
      host.querySelectorAll("[data-src]").forEach((b) => b.addEventListener("click", () => { cur = m0.list_key; mode = "list"; memberF = ""; fcol = ""; fval = ""; q = ""; crF = ""; ownF = ""; sfF = ""; stgF = ""; srcF = b.dataset.src; page = 0; openList(); }));
    }).catch(() => {});
    if (!oc || !m0) return;
    // メンバー別：所有者ごとの件数。表示するメンバーは「リスト追加」で選んだ人（まだ選んでいなければ全員）
    // 未割り振り（所有者がいない）も数える（2026-11-23 田中さん「誰にも割り振られていないものは未割り振りのカードを」）
    const bl = { all: 0, active: 0, nurture: 0 };
    // 3つ（全部・残りの架け先・ナーチャリング）は同時に読む（順に読むと10秒ほど待たせていた）
    const vq = (st) => api(`/api/mochica/bales/lists/${encodeURIComponent(m0.list_key)}/values?col=${encodeURIComponent(oc)}${st ? `&stg=${st}` : ""}&blank=1`).catch(() => ({ items: [], blank: 0 }));
    const [d0, d1, d2] = await Promise.all([vq(""), vq("active"), vq("nurture")]);
    const vals = d0.items || []; bl.all = d0.blank || 0; const apoM = new Map(vals.map((v) => [v.v, [v.apo, v.called]])); apoM.set("", [d0.blankApo, d0.blankCalled]);
    // 残りの架け先：リサイクル・アーカイブにしていない件数／ナーチャリングの件数（2026-11-23 田中さん）
    const act = new Map((d1.items || []).map((v) => [v.v, v.n])); act.set("", d1.blank || 0);
    const nur = new Map((d2.items || []).map((v) => [v.v, v.n])); nur.set("", d2.blank || 0);
    if (members == null) { try { members = (await api("/api/mochica/bales/members")).members; } catch { members = null; } }
    const box = root.querySelector("[data-mems]"); if (!box || !root.isConnected) return;
    const shown0 = Array.isArray(members) && members.length ? members.map((nm) => vals.find((v) => v.v === nm) || { v: nm, n: 0 }) : vals;
    const shown = bl.all ? [...shown0, { v: "", n: bl.all }] : shown0;   // 最後に「未割り振り」（v が空）
    box.innerHTML = shown.length ? shown.map((v) => `<div class="bl-lc mem${v.v ? "" : " none"}" role="button" tabindex="0" data-mem="${esc(v.v)}"><span class="av">${v.v ? esc(String(v.v).replace(/\s/g, "").slice(0, 1)) : "−"}</span><b>${v.v ? esc(v.v) : "未割り振り"}</b><span class="bl-lc-k">残りの架け先</span><span class="n">${Number(act.get(v.v) || 0).toLocaleString()}<small>件</small></span><span class="bl-lc-nur">ナーチャリング <b>${Number(nur.get(v.v) || 0).toLocaleString()}</b>件</span>${apoTxt(...(apoM.get(v.v) || [0, 0]))}<small>全 ${Number(v.n || 0).toLocaleString()}件（${esc(m0.name || "")} から）</small>${v.v && Array.isArray(members) && members.length ? `<button type="button" class="bl-lc-x" data-mx="${esc(v.v)}" title="メンバー別から外す">×</button>` : ""}</div>`).join("")
      : '<div class="mc-note">所有者の入ったリードがありません。</div>';
    // メンバーのカードを押すと、その人のリードソース別のカード（2026-11-23 田中さん）
    box.querySelectorAll("[data-mem]").forEach((el) => { const go = () => { mode = "member"; memHome = { name: el.dataset.mem, blank: !el.dataset.mem }; openList(); }; el.addEventListener("click", go); el.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); }); });
    box.querySelectorAll("[data-mx]").forEach((b) => b.addEventListener("click", async (e) => { e.stopPropagation(); members = (members || []).filter((x) => x !== b.dataset.mx); try { await api("/api/mochica/bales/members", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ members }) }); } catch {} home(root); }));
    // 「メンバー追加」：所有者のなかから、カードにする人を選ぶ（2026-11-22 田中さん「メンバー追加にしてほしい」）
    const am = root.querySelector("[data-addmem]");
    if (am) am.onclick = () => {
      const cur0 = new Set(Array.isArray(members) && members.length ? members : vals.map((v) => v.v));
      const sh = sheet(`<h3 class="bl-sh-t">メンバーを追加する</h3>
        <p class="mc-note">カードにする人を選んでください（その人が所有者のリードを、「${esc(m0.name || "")}」から出します）。</p>
        <div class="bl-mpick">${vals.map((v) => `<label><input type="checkbox" value="${esc(v.v)}" ${cur0.has(v.v) ? "checked" : ""}><span>${esc(v.v)}</span><small>${Number(v.n).toLocaleString()}件</small></label>`).join("")}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px"><button type="button" class="mt-btn" data-msave>保存する</button></div>`);
      {
        sh.querySelector("[data-msave]").addEventListener("click", async () => { members = [...sh.querySelectorAll(".bl-mpick input:checked")].map((x) => x.value);
          try { await api("/api/mochica/bales/members", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ members }) }); } catch (er) { alert("保存できませんでした：" + er.message); return; }
          closeSheet(); home(root); });
      }
    };
  }
  // メンバー → その人のリードソース別のカード（残りの架け先・ナーチャリング・リストアポ率）。カードを押すと、その人のそのリードソースの表（2026-11-23 田中さん）
  async function memberView(root) {
    headActs(null);
    const m0 = mainList(); const oc = ownerCol(m0); const mh = memHome; const label = mh.blank ? "未割り振り" : mh.name;
    root.innerHTML = `<div class="bl-home"><button type="button" class="bl-back" data-mback>‹ リスト管理に戻る</button>
      <div class="bl-home-h"><h2>${esc(label)}<small style="font-size:12px;font-weight:600;color:#5C7377;margin-left:8px">リードソース別</small></h2></div>
      <div class="bl-lgrid" data-mstg style="margin-bottom:10px"></div>
      <div class="bl-lgrid" data-msrc><div class="mc-note">読み込んでいます…</div></div></div>`;   // かける・ナーチャリング・リサイクル・アーカイブは SFリードソースの上（2026-11-23 田中さん「下じゃなくて上に」）
    root.querySelector("[data-mback]").addEventListener("click", () => goHome());
    if (!m0 || !oc) return;
    let it = []; try { it = (await api(`/api/mochica/bales/lists/${encodeURIComponent(m0.list_key)}/sources?col=${encodeURIComponent(oc)}&${mh.blank ? "blank=1" : `val=${encodeURIComponent(mh.name)}`}`)).items || []; } catch {}
    const box = root.querySelector("[data-msrc]"); if (!box || !root.isConnected || mode !== "member") return;
    // 先頭に「全部」（その人の全リード）。件数は各リードソースの重なりを含まないよう、全部のカードは別に足し上げない（出どころが複数あるリードがあるため）
    // 1枚の「SFリードソース」カードにまとめ、1行ずつ：リードソース・残りの架け先・ナーチャリング・リストアポ率（2026-11-23 田中さん「1枚目みたいにまとめて、ナーチャリングの数は出して」）
    const pct = (v) => (v.called ? (v.apo / v.called * 100).toFixed(1) : "0.0");
    box.innerHTML = it.length ? `<div class="bl-lc srcs msrc"><div class="bl-srcs-h"><b>SFリードソース</b><small>${it.filter((v) => v.v !== "-").length}種類</small></div>
      <div class="bl-msrc-hw">${'<div class="bl-msrc-hd"><span>リードソース</span><span>全件数</span><span>残りの架け先</span><span>ナーチャリング</span><span>リストアポ率</span></div>'.repeat(2)}</div>
      <div class="bl-msrc-l">${it.map((v) => `<button type="button" data-ms="${esc(v.v)}" title="アポ ${Number(v.apo || 0).toLocaleString()} ÷ 架電 ${Number(v.called || 0).toLocaleString()}"><span>${esc(v.v === "-" ? "リードソースなし" : v.v)}</span><em class="all">${Number(v.n || 0).toLocaleString()}</em><em>${Number(v.active || 0).toLocaleString()}</em><em class="nur">${Number(v.nurture || 0).toLocaleString()}</em><i>${pct(v)}%</i></button>`).join("")}</div>
      <small>押すとその人のそのリードソースの表・リストアポ率にマウスを乗せるとアポ／架電の件数</small></div>` : '<div class="mc-note">この人のリードがありません。</div>';
    // 上に「かけるリスト・ナーチャリング・リサイクル・アーカイブ」のカード（その人のリードで）（2026-11-23 田中さん）。押すとその表
    const sb = root.querySelector("[data-mstg]");
    api(`/api/mochica/bales/lists/${encodeURIComponent(m0.list_key)}/stages?col=${encodeURIComponent(oc)}&${mh.blank ? "blank=1" : `val=${encodeURIComponent(mh.name)}`}`).then((d) => {
      if (!sb || !root.isConnected || mode !== "member") return;
      sb.innerHTML = STG.map(([k, l, dsc]) => `<button type="button" class="bl-lc stg ${k}" data-mst="${k}"><b>${l}</b><span class="n">${Number(d[k] || 0).toLocaleString()}<small>件</small></span>${apoTxt(d[`${k}_apo`], d[`${k}_called`])}<small>${dsc}</small></button>`).join("");
      sb.querySelectorAll("[data-mst]").forEach((b) => b.addEventListener("click", () => { cur = m0.list_key; mode = "list"; memberF = label; fcol = oc; fval = mh.blank ? "" : mh.name; q = ""; crF = ""; ownF = ""; sfF = ""; srcF = ""; stgF = b.dataset.mst; retMem = mh; page = 0; openList(); }));
    }).catch(() => {});
    box.querySelectorAll("[data-ms]").forEach((b) => b.addEventListener("click", () => { cur = m0.list_key; mode = "list"; memberF = label; fcol = oc; fval = mh.blank ? "" : mh.name; q = ""; crF = ""; ownF = ""; sfF = ""; stgF = ""; srcF = b.dataset.ms; retMem = mh; page = 0; openList(); }));
  }
  // ステージ別 → メンバーごとの件数。メンバーを押すと、その人のそのステージのリードの表
  async function stageView(root) {
    headActs(null);
    const m0 = mainList(); const oc = ownerCol(m0); const st = STG.find(([k]) => k === stgHome) || [stgHome, stgHome, ""];
    root.innerHTML = `<div class="bl-home"><button type="button" class="bl-back" data-sback>‹ リスト管理に戻る</button>
      <div class="bl-home-h"><h2>${esc(st[1])}<small style="font-size:12px;font-weight:600;color:#5C7377;margin-left:8px">メンバー別・${esc(st[2])}</small></h2></div>
      <div class="bl-lgrid" data-stmem><div class="mc-note">読み込んでいます…</div></div></div>`;
    root.querySelector("[data-sback]").addEventListener("click", () => goHome());
    if (!m0) return;
    const k = encodeURIComponent(m0.list_key);
    let tot = 0, vals = [], tApo = [0, 0];
    try { const d = await api(`/api/mochica/bales/lists/${k}/stages`); tot = Number(d[stgHome] || 0); tApo = [d[`${stgHome}_apo`], d[`${stgHome}_called`]]; } catch {}
    let blank = 0, bApo = [0, 0]; try { if (oc) { const d = await api(`/api/mochica/bales/lists/${k}/values?col=${encodeURIComponent(oc)}&stg=${encodeURIComponent(stgHome)}&blank=1`); vals = d.items || []; blank = d.blank || 0; bApo = [d.blankApo, d.blankCalled]; } } catch {}
    if (members == null) { try { members = (await api("/api/mochica/bales/members")).members; } catch { members = null; } }
    const box = root.querySelector("[data-stmem]"); if (!box || !root.isConnected || mode !== "stage") return;
    // メンバー別で選んだ人がいればその人たち（0件でも出す）、いなければ件数のある人全員
    const shown = Array.isArray(members) && members.length ? members.map((nm) => vals.find((v) => v.v === nm) || { v: nm, n: 0 }) : vals;
    box.innerHTML = `<button type="button" class="bl-lc main stg ${esc(stgHome)}" data-stall><b>全員</b><span class="n">${tot.toLocaleString()}<small>件</small></span>${apoTxt(...tApo)}<small>${esc(m0.name || "")} から</small></button>`
      + (shown.length ? shown.map((v) => `<button type="button" class="bl-lc mem stg ${esc(stgHome)}" data-stm="${esc(v.v)}"><span class="av">${esc(String(v.v).replace(/\s/g, "").slice(0, 1))}</span><b>${esc(v.v)}</b><span class="n">${Number(v.n || 0).toLocaleString()}<small>件</small></span>${apoTxt(v.apo, v.called)}<small>${esc(st[1])}</small></button>`).join("")
        : `<div class="mc-note">${oc ? "このステージのリードを持っているメンバーがいません。" : "リストに「所有者」の列が無いので、メンバーに分けられません。"}</div>`)
      // アーカイブの中に「MOCHICAユーザー」のカード（ほかの表・件数からは省いている人たち）（2026-11-23 田中さん）
      + (stgHome === "archive" && m0.user_hidden ? `<button type="button" class="bl-lc mem stg archive mcu" data-stmcu><span class="av">M</span><b>MOCHICAユーザー</b><span class="n">${Number(m0.user_hidden).toLocaleString()}<small>件</small></span><small>SF で商談名に「新規」・受注処理完了</small></button>` : "")
      // アーカイブの中に「アプローチ禁止」のカード（シート「②企業リスト_All」の企業名に当たるリード）（2026-11-23 田中さん）
      + (stgHome === "archive" ? `<div class="bl-lc mem stg archive mcu" role="button" tabindex="0" data-stng><span class="av">禁</span><b>アプローチ禁止</b><span class="n">${Number(m0.ng_hidden || 0).toLocaleString()}<small>件</small></span><small>シート「②企業リスト_All」の企業名</small><button type="button" class="bl-duplk" data-ngre style="margin:4px 0 0">シートを読み直す</button></div>` : "")
      + (oc && blank ? `<button type="button" class="bl-lc mem none stg ${esc(stgHome)}" data-stnone><span class="av">−</span><b>未割り振り</b><span class="n">${blank.toLocaleString()}<small>件</small></span>${apoTxt(...bApo)}<small>${esc(st[1])}・所有者なし</small></button>` : "");
    const open = (who, none) => { cur = m0.list_key; mode = "list"; memberF = none ? "未割り振り" : who; fcol = who || none ? oc : ""; fval = none ? "" : who; q = ""; crF = ""; ownF = ""; sfF = ""; srcF = ""; stgF = stgHome; retStage = stgHome; page = 0; openList(); };
    box.querySelector("[data-stall]").addEventListener("click", () => open(""));
    box.querySelectorAll("[data-stm]").forEach((b) => b.addEventListener("click", () => open(b.dataset.stm)));
    const nb = box.querySelector("[data-stnone]"); if (nb) nb.addEventListener("click", () => open("", true));
    const ng = box.querySelector("[data-stng]"); if (ng) ng.addEventListener("click", (e) => { if (e.target.closest("[data-ngre]")) return; cur = m0.list_key; mode = "list"; memberF = ""; fcol = ""; fval = ""; q = ""; crF = ""; ownF = ""; sfF = ""; srcF = ""; stgF = "ng"; retStage = stgHome; page = 0; openList(); });
    const ngr = box.querySelector("[data-ngre]"); if (ngr) ngr.addEventListener("click", async (e) => { e.stopPropagation(); ngr.disabled = true; ngr.textContent = "読み直しています…";
      try { const d = await api("/api/mochica/bales/ng/refresh", { method: "POST" }); lists = (await api("/api/mochica/bales/lists")).items || lists; alert(`アプローチ禁止企業 ${d.names}社を読みました。当たったリード：${d.hits}件`); stageView(root); }
      catch (er) { alert(er.message); ngr.disabled = false; ngr.textContent = "シートを読み直す"; } });
    const mu = box.querySelector("[data-stmcu]"); if (mu) mu.addEventListener("click", () => { cur = m0.list_key; mode = "list"; memberF = ""; fcol = ""; fval = ""; q = ""; crF = ""; ownF = ""; sfF = ""; srcF = ""; stgF = "mcuser"; retStage = stgHome; page = 0; openList(); });
  }
  // ===== 見張りの1日分：誰が・どこに・何件・どんな結果だったか（2026-11-15 田中さん「インターン生の架電を分析したい」）=====
  const jstDay = (t = Date.now()) => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
  async function feedDetail() {
    const box = $("blMain"); const f = feeds.find((x) => x.feed === cur); if (!box || !f) return; if (!fday) fday = jstDay();
    box.innerHTML = '<div class="mc-note">読み込んでいます…</div>';
    let r; try { r = await api(`/api/mochica/bales/feeds/${encodeURIComponent(cur)}/day?date=${fday}`); } catch (e) { box.innerHTML = `<div class="mc-note">読めませんでした：${esc(e.message)}</div>`; return; }
    if ($("blMain") !== box) return;
    // 見出しの結びつきが無いときは、中身の項目名から見当をつける（会社・担当・結果・日時）
    let view = f.view || [];
    if (!view.length && r.items.length) { const ks = Object.keys(r.items[0]).filter((k) => !/^__/.test(k) && !/(^|\.)(id|_id|uuid|client_id)$/i.test(k));
      const pick = (re) => ks.find((k) => re.test(k)); const guess = [[r.tkey, "日時"], [pick(/user.*name|operator.*name|owner.*name/i), "担当"], [pick(/compan.*name|company/i), "会社名"], [pick(/result.*name|result|status/i), "結果"]].filter(([k]) => k);
      view = guess.map(([key, label]) => ({ key, label })); for (const k of ks) { if (view.length >= 6) break; if (!view.some((v) => v.key === k)) view.push({ key: k, label: labelOf(k) }); } }
    const vk = (re) => (view.find((v) => re.test(v.label)) || {}).key;
    const kWho = vk(/担当|架電者|ユーザー|所有者|オペレーター|コール者|発信者|実施者/), kRes = vk(/結果|ステータス/), kCo = vk(/会社/), kT = r.tkey;
    const it = r.items.map((d) => ({ d, who: kWho ? String(valOf(d, kWho) || "（不明）") : "（不明）", res: kRes ? String(valOf(d, kRes) || "（なし）") : "", co: kCo ? String(valOf(d, kCo) || "") : "", t: kT ? new Date(d[kT]) : null })).sort((a, b) => (b.t || 0) - (a.t || 0));
    const cnt = (arr, k) => { const m = new Map(); for (const x of arr) m.set(x[k], (m.get(x[k]) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
    const people = cnt(it, "who"); const results = kRes ? cnt(it, "res") : [];
    const hm = (t) => (t && !isNaN(t) ? `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}` : "");
    const hours = Array.from({ length: 11 }, (_, i) => 9 + i).map((h) => [h, it.filter((x) => x.t && x.t.getHours() === h).length]); const hmax = Math.max(1, ...hours.map((h) => h[1]));
    const shift = (n) => { const d = new Date(`${fday}T00:00:00+09:00`); d.setTime(d.getTime() + n * 86400000); fday = jstDay(d.getTime()); feedDetail(); };
    const resChips = (arr) => arr.map(([k, n]) => `<span class="bl-rc">${esc(k)} <b>${n}</b></span>`).join("");
    box.innerHTML = `<div class="bl-head"><div><h3>${esc(f.name)}</h3><small>${f.last_sync ? `最後に読んだ：${esc(dt(f.last_sync))}（新しい ${f.last_new || 0}件）・平日10〜19時に10分ごと` : "まだ読んでいません"}${f.src ? ` ・ 読んでいる一覧：${esc(String(f.src).replace(/^https?:\/\/[^/]+/, ""))}` : ""}</small></div>
        <div class="bl-acts"><button type="button" class="mt-btn ghost" data-dd="-1">前の日</button><input type="date" class="bl-date" data-day value="${fday}"><button type="button" class="mt-btn ghost" data-dd="1">次の日</button><button type="button" class="mt-btn ghost" data-dd="0">今日</button><button type="button" class="mt-btn ghost bl-del" data-fdel>外す</button></div></div>
      <div class="bl-mets"><div><small>架電の数</small><b>${it.length.toLocaleString()}</b></div><div><small>架電した人</small><b>${people.length}</b></div><div><small>架電した会社</small><b>${new Set(it.map((x) => x.co).filter(Boolean)).size.toLocaleString()}</b></div><div><small>結果の種類</small><b>${results.length}</b></div><div><small>見張りの全部</small><b>${Number(f.total || 0).toLocaleString()}</b></div></div>
      ${r.sort === "none" ? '<div class="bl-diag">Bales の一覧を「最終架電日時の新しい順」で読めませんでした。今日かけたリードが後ろのページにあると数えられません。Bales のリード一覧で「最終架電日時」の列を押して新しい順に並べ、その画面で見張りを登録し直してください。</div>' : ""}
      ${!kT ? '<div class="bl-diag">時刻の項目が見つからなかったので、kinbot が初めて見た時刻で日を分けています。</div>' : !(f.view || []).length ? `<div class="bl-diag">見出しの結びつきが無いので、項目の名前から見当をつけて出しています（日時＝${esc(kT)}）。</div>` : ""}
      ${results.length ? `<div class="bl-h4">結果</div><div class="bl-rcs">${resChips(results)}</div>` : ""}
      <div class="bl-h4">時間ごと</div><div class="bl-hours">${hours.map(([h, n]) => `<div title="${h}時台 ${n}件"><i style="height:${Math.round((n / hmax) * 60)}px"></i><b>${n || ""}</b><small>${h}時</small></div>`).join("")}</div>
      <div class="bl-h4">人ごと</div><div class="bl-tbl"><table><thead><tr><th>${esc((view.find((v) => v.key === kWho) || {}).label || "担当")}</th><th>架電</th><th>最初</th><th>最後</th>${kRes ? "<th>結果</th>" : ""}</tr></thead><tbody>
        ${people.map(([w, n]) => { const mine = it.filter((x) => x.who === w); const ts = mine.map((x) => x.t).filter((t) => t && !isNaN(t)).sort((a, b) => a - b); return `<tr class="bl-row" data-who="${esc(w)}"><td><b>${esc(w)}</b></td><td>${n}</td><td>${hm(ts[0])}</td><td>${hm(ts[ts.length - 1])}</td>${kRes ? `<td>${resChips(cnt(mine, "res"))}</td>` : ""}</tr>`; }).join("") || `<tr><td colspan="5" class="mc-note">この日の架電はありません。</td></tr>`}</tbody></table></div>
      <div class="bl-h4">架電の一覧<small data-who-f></small></div><div class="bl-tbl"><table><thead><tr><th>時刻</th>${view.map((v) => `<th>${esc(v.label)}</th>`).join("")}</tr></thead><tbody data-list>
        ${it.slice(0, 1000).map((x) => `<tr data-w="${esc(x.who)}"><td>${hm(x.t)}</td>${view.map((v) => `<td title="${esc(valOf(x.d, v.key))}">${esc(fmt(valOf(x.d, v.key)))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    box.querySelectorAll("[data-dd]").forEach((b) => b.addEventListener("click", () => { const n = Number(b.dataset.dd); if (n === 0) { fday = jstDay(); feedDetail(); } else shift(n); }));
    box.querySelector("[data-day]").addEventListener("change", (e) => { if (e.target.value) { fday = e.target.value; feedDetail(); } });
    box.querySelectorAll("[data-who]").forEach((tr) => tr.addEventListener("click", () => { const w = tr.dataset.who; const on = tr.classList.toggle("on"); box.querySelectorAll("[data-who]").forEach((x) => { if (x !== tr) x.classList.remove("on"); });
      box.querySelectorAll("[data-list] tr").forEach((x) => { x.hidden = on && x.dataset.w !== w; }); box.querySelector("[data-who-f]").textContent = on ? `（${w} だけ）` : ""; }));
    box.querySelector("[data-fdel]").addEventListener("click", async () => { if (!confirm(`見張り「${f.name}」と、kinbot に入った分（${Number(f.total || 0).toLocaleString()}件）を消しますか？（Bales の中身は変わりません。拡張機能の見張りは Bales のパネルで外してください）`)) return; try { await api(`/api/mochica/bales/feeds/${encodeURIComponent(cur)}`, { method: "DELETE" }); cur = null; load(); } catch (e) { alert("消せませんでした：" + e.message); } });
  }
  async function detail() {
    const box = $("blMain"); const l = lists.find((x) => x.list_key === cur); if (!box || !l) return;
    // 所有者で絞る（メンバーのカードから開いたときは、もう所有者で絞っているので出さない）
    const oc = ownerCol(l); const ownQ = !memberF && oc && ownF ? `&col2=${encodeURIComponent(oc)}&val2=${encodeURIComponent(ownF)}` : "";
    const ownOpts = !memberF && oc ? api(`/api/mochica/bales/lists/${encodeURIComponent(cur)}/values?col=${encodeURIComponent(oc)}`).then((d) => d.items || []).catch(() => []) : Promise.resolve([]);
    const sfOpts = api(`/api/mochica/bales/lists/${encodeURIComponent(cur)}/sf-values`).catch(() => null);
    const cols = pickCols(l.cols, cur, l.view); const coCol = cols.find((c) => c.label === "会社名"); const stCol = memberF ? null : cols.find((c) => /ステータス|ステージ/.test(c.label) && !c.key.includes("[]"));   // メンバーで絞っているときは、所有者の絞り込みと重ならないよう出さない
    let r; try { r = await api(`/api/mochica/bales/lists/${encodeURIComponent(cur)}/rows?q=${encodeURIComponent(q)}&col=${encodeURIComponent(fcol)}&val=${encodeURIComponent(fval)}&offset=${page * PER}&limit=${PER}&hot=${encodeURIComponent(hotF)}&sort=${hotSort ? "hot" : ""}&cr=${encodeURIComponent(crF)}${ownQ}&sf=${encodeURIComponent(sfF)}&src=${encodeURIComponent(srcF)}&stg=${encodeURIComponent(stgF)}`); } catch (e) { box.innerHTML = `<div class="mc-note">読めませんでした：${esc(e.message)}</div>`; return; }
    if ($("blMain") !== box) return;
    let vals = []; if (stCol) { try { vals = (await api(`/api/mochica/bales/lists/${encodeURIComponent(cur)}/values?col=${encodeURIComponent(stCol.key)}`)).items || []; } catch {} }
    const diff = l.prev_count != null && l.status !== "running" ? l.count - l.prev_count : null;
    const hasMt = (d) => coCol && mtCos && mtCos.get(coNorm(valOf(d, coCol.key)));
    const csvQ = `q=${encodeURIComponent(q)}&col=${encodeURIComponent(fcol)}&val=${encodeURIComponent(fval)}&hot=${encodeURIComponent(hotF)}&sort=${hotSort ? "hot" : ""}&cr=${encodeURIComponent(crF)}${ownQ}&sf=${encodeURIComponent(sfF)}&src=${encodeURIComponent(srcF)}&stg=${encodeURIComponent(stgF)}`;
    const hn = l.hot_n || {}; void hn; void diff;
    const ownList = await ownOpts; const sv = await sfOpts;
    const sfList = sv ? [["open", "商談あり：進行中", sv.open], ["won", "商談あり：受注", sv.won], ["lost", "商談あり：失注", sv.lost], ...(sv.leads || []).map((x) => [`lead:${x.v}`, `リード：${x.v}`, x.n]), ["none", "SF に無い", sv.none]].filter((x) => x[2] > 0 || x[0] === sfF) : [];
    if ($("blMain") !== box) return;
    // 8つに当たらない Bales の結果は「-」にして、最終活動コメントの頭に【結果】で残す（2026-11-22 田中さん）。データは変えず、出すときだけ
    const withCm = (d0) => { const raw = String(d0.callResult || "").trim(); const cm = (cols.find((c) => c.label === "最終活動コメント") || {}).key;
      // 重複をまとめたリードは、まとめた古い架電の記録を足した活動コメントを出す（2026-11-23 田中さん「古い架電記録は活動コメントにまとめて」）
      const d1 = d0.__dupNote && cm && !cm.includes(".") ? { ...d0, [cm]: d0.__dupNote } : d0;
      // kinbot で割り振った担当がいれば、所有者の列はその人を出す
      const d = d1.__as && oc ? { ...d1, [oc]: d1.__as } : d1;
      if (!raw || crOf(raw) !== "-" || !cm || cm.includes(".")) return d; return { ...d, [cm]: `【${raw}】${d[cm] ? ` ${d[cm]}` : ""}` }; };
    // 最終架電結果・所有者・SF の絞り込みは、表の列の見出しのボタンから選ぶ（上の行が選択欄だらけで見づらかったため）
    const FIL = {
      cr: { on: crF, opts: [...CR.map(([k]) => [k, k]), ["-", "-（未架電・ほかの結果）"]], set: (v) => { crF = v; } },
      own: { on: ownF, opts: ownList.map((v) => [v.v, `${v.v}（${Number(v.n).toLocaleString()}）`]), set: (v) => { ownF = v; } },
      sf: { on: sfF, opts: sfList.map(([v, lb, n]) => [v, `${lb}（${Number(n).toLocaleString()}）`]), set: (v) => { sfF = v; } },
    };
    // 選んだものは「|」でつないで持つ（サーバーも同じ形で受ける）。複数選べる（2026-11-22 田中さん「複数選択できるように」）
    const picked = (k) => (FIL[k].on ? FIL[k].on.split("|") : []);
    const thf = (c) => { const k = c.key === "__cr" ? "cr" : c.key === "__sf" ? "sf" : (!memberF && oc && c.key === oc) ? "own" : ""; if (!k) return "";
      return `<button type="button" class="bl-thf${FIL[k].on ? " on" : ""}" data-thf="${k}" title="${FIL[k].on ? `絞り込み中：${esc(picked(k).map((v) => ((FIL[k].opts.find(([x]) => x === v) || [])[1] || v).replace(/（[\d,]+）$/, "")).join("・"))}` : "絞り込む"}"><svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3h12l-4.6 5.4V13l-2.8 1.4V8.4z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg></button>`; };
    const thPop = (btn, k) => {
      document.querySelectorAll(".bl-thpop").forEach((x) => x.remove());
      const pop = document.createElement("div"); pop.className = "bl-thpop";
      const sel = new Set(picked(k));
      pop.innerHTML = `<div class="bl-thpop-l">${FIL[k].opts.map(([v, lb]) => `<label><input type="checkbox" value="${esc(v)}" ${sel.has(v) ? "checked" : ""}><span>${esc(lb)}</span></label>`).join("") || '<div class="mc-note">選べるものがありません</div>'}</div>
        <div class="bl-thpop-f"><button type="button" data-clr>すべて外す</button><button type="button" class="ok" data-ok>絞り込む</button></div>`;
      document.body.appendChild(pop);
      const r = btn.getBoundingClientRect();
      pop.style.top = `${window.scrollY + r.bottom + 6}px`;
      pop.style.left = `${Math.max(8, Math.min(window.scrollX + r.left - 10, window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8))}px`;
      // チェックを付け外ししてから「絞り込む」で反映。外を押して閉じたときも、変えていれば反映する（押し忘れで効かないのを防ぐ）
      let done = false;
      const apply = () => { if (done) return; done = true; document.removeEventListener("click", off); pop.remove();
        const v = [...pop.querySelectorAll("input:checked")].map((x) => x.value).join("|");
        if (v !== (FIL[k].on || "")) { FIL[k].set(v); page = 0; detail(); } };
      const off = (e) => { if (!pop.contains(e.target)) apply(); };
      pop.querySelector("[data-clr]").addEventListener("click", () => pop.querySelectorAll("input").forEach((x) => { x.checked = false; }));
      pop.querySelector("[data-ok]").addEventListener("click", apply);
      setTimeout(() => document.addEventListener("click", off), 0);
    };
    // 表の列の並び（2026-11-22 田中さん）：SF（いちばん左・2026-11-22 夜に変更）・会社名・電話番号・担当者名・最終活動日・最終架電結果・最終活動コメント・所有者。
    //   「表示項目」で自分で選んだ列があるときは、その並びのあとに（最終活動日の右に）最終架電結果を入れる
    const CR_COL = { key: "__cr", label: "最終架電結果" };
    let tcols;
    if (!savedCols(cur)) {
      const ORDER = ["会社名", "電話番号", "担当者名", "最終活動日", "__cr", "最終活動コメント", "所有者"];
      tcols = ORDER.map((lb) => (lb === "__cr" ? CR_COL : cols.find((c) => c.label === lb))).filter(Boolean);
      if (tcols.length <= 1) tcols = [...cols, CR_COL];   // Bales の見出しが違う形のときは、今までの列のまま
    } else { const i = cols.findIndex((c) => c.label === "最終活動日"); tcols = i >= 0 ? [...cols.slice(0, i + 1), CR_COL, ...cols.slice(i + 1)] : [...cols, CR_COL]; }
    box.innerHTML = `<div class="bl-head"><div><button type="button" class="bl-back" data-home2>‹ リスト管理に戻る</button><h3>${memberF ? `${esc(memberF)} のリード <small style="font-size:12px;font-weight:600">（${srcF ? `${esc(srcF === "-" ? "リードソースなし" : srcF)}・` : ""}${stgF ? `${esc((STG.find(([k]) => k === stgF) || [, STG_EXTRA[stgF] || stgF])[1])}・` : ""}${esc(l.name || l.list_key)} から）</small>` : HOTS.some(([k]) => k === hotF) && !srcF && !stgF ? `${esc(HOTS.find(([k]) => k === hotF)[1])} <small style="font-size:12px;font-weight:600">（ホット度・${esc(l.name || l.list_key)} から）</small>` : stgF ? `${esc((STG.find(([k]) => k === stgF) || [, STG_EXTRA[stgF] || stgF])[1])} <small style="font-size:12px;font-weight:600">（ステージ別・${esc(l.name || l.list_key)} から）</small>` : srcF ? `${esc(srcF === "-" ? "リードソースなし" : srcF)} <small style="font-size:12px;font-weight:600">（SFリードソース・${esc(l.name || l.list_key)} から）</small>` : esc(l.name || l.list_key)} <span class="bl-cnt">${Number(r.total || 0).toLocaleString()}件</span></h3><small>${l.dup_hidden ? `重複 ${Number(l.dup_hidden).toLocaleString()}件をまとめて表示中（Bales はそのまま）<button type="button" class="bl-duplk" data-dup="off">元に戻す</button>　` : l.status === "done" && !memberF && !srcF && !stgF ? `<button type="button" class="bl-duplk" data-dup="on">重複をまとめる</button>　` : ""}最後に取り込んだ日時：${l.status === "running" ? "取り込み中" : esc(dt(l.done_at || l.run_at))}${l.error ? ` ・ ${esc(l.error)}` : ""}</small></div>
        </div>
      <div class="bl-sfst" data-sfst></div>
      <div class="bl-find"><button type="button" class="mt-btn bl-asg" data-asg>${ASG_ICO}割り振る<span data-selc>${selRows.size ? `（${selRows.size}件）` : ""}</span></button><button type="button" class="mt-btn ghost" data-colsel>表示項目</button><select data-hot><option value="">ホット度：すべて</option><option value="hot" ${hotF === "hot" ? "selected" : ""}>ホットだけ</option><option value="warm+" ${hotF === "warm+" ? "selected" : ""}>ウォーム以上</option><option value="warm" ${hotF === "warm" ? "selected" : ""}>ウォームだけ</option><option value="cold" ${hotF === "cold" ? "selected" : ""}>コールドだけ</option></select><label class="bl-hsort"><input type="checkbox" data-hsort ${hotSort ? "checked" : ""}>ホット順</label>${stCol ? `<select data-f><option value="">${esc(stCol.label)}：すべて</option>${vals.map((v) => `<option value="${esc(v.v)}" ${fcol === stCol.key && fval === v.v ? "selected" : ""}>${esc(v.v)}（${v.n}）</option>`).join("")}</select>` : ""}</div>
      ${tcols.length ? `<div class="bl-tbl"><table><thead><tr><th class="bl-ck"><input type="checkbox" data-selall title="このページを全部選ぶ"></th><th>SF${thf({ key: "__sf" })}</th>${tcols.map((c) => `<th>${esc(c.label)}${thf(c)}</th>`).join("")}</tr></thead><tbody>
        ${r.rows.map(withCm).map((d) => `<tr class="bl-row" data-row="${esc(d.__k)}"><td class="bl-ck"><input type="checkbox" data-sel="${esc(d.__k)}" ${selRows.has(d.__k) ? "checked" : ""}></td><td>${sfChip(d.__sf)}</td>${tcols.map((c, i) => c.key === "__cr" ? `<td>${crCell(d)}</td>` : `<td title="${esc(valOf(d, c.key))}">${(c.label === "会社名" || (i === 0 && !coCol)) && hasMt(d) ? `<button type="button" class="bl-mt" data-co="${esc(hasMt(d))}" title="MOCHICA の会社カードへ"><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="3" fill="#1d9e75"/><rect x="5" y="6" width="2" height="2" rx=".6" fill="#fff"/><rect x="9" y="6" width="2" height="2" rx=".6" fill="#fff"/><rect x="5" y="10" width="6" height="2" rx=".6" fill="#fff"/></svg></button>` : ""}${/^https?:\/\//.test(valOf(d, c.key) || "") ? `<a href="${esc(valOf(d, c.key))}" target="_blank" rel="noopener">${esc(valOf(d, c.key))}</a>` : esc(fmt(valOf(d, c.key)))}${(c.label === "会社名" || (i === 0 && !coCol)) && d.__dupN ? `<span class="bl-dupb" title="重複していた ${d.__dupN}件をこのリードにまとめています">＋${d.__dupN}</span>` : ""}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${tcols.length + 1}" class="mc-note">当てはまる会社がありません。</td></tr>`}
        </tbody></table></div>` : '<div class="mc-note">まだ行がありません。</div>'}
      <div class="bl-pg"><span>${r.total ? `${(page * PER + 1).toLocaleString()}〜${Math.min(r.total, (page + 1) * PER).toLocaleString()} / ${r.total.toLocaleString()}件` : ""}</span>${page > 0 ? '<button type="button" class="mt-btn ghost" data-pg="-1">前へ</button>' : ""}${(page + 1) * PER < r.total ? '<button type="button" class="mt-btn ghost" data-pg="1">次へ</button>' : ""}</div>
      ${coCol ? '<p class="mc-note" style="margin-top:6px">緑の印＝MOCHICA に商談がある会社。押すとその会社カードへ。</p>' : ""}
      <p class="mc-note" style="margin-top:4px">ホット度：「担当者名・ニーズ・検討時期」の3つがそろえばホット、2つでウォーム。ニーズと検討時期は、架電のコメントやカスタム情報の文章（SF と結びついた行は SF の課題感・検討開始時期も）から言葉で読んでいます（ホット度の絞り込みで使えます）。</p>`;
    // 商談ありの数は、今の絞り込みの全件で数える（会社名だけ読む）
    (async () => { const el = box.querySelector("[data-mtn]"); if (!el || !coCol || !mtCos) return; try { let n = 0; for (let off = 0; ; off += 5000) { const a = await api(`/api/mochica/bales/lists/${encodeURIComponent(cur)}/rows?offset=${off}&limit=5000`); n += a.rows.filter((d) => mtCos.get(coNorm(valOf(d, coCol.key)))).length; if (a.rows.length < 5000) break; } el.textContent = n.toLocaleString(); } catch { el.textContent = "—"; } })();
    headActs(l, csvQ);
    // 列の見出しの絞り込み：押すと選択肢が出る（2026-11-22 田中さん「列のところに絞り込みのボタンを」）
    box.querySelectorAll("[data-thf]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); thPop(b, b.dataset.thf); }));
    const hb2 = box.querySelector("[data-home2]"); if (hb2) hb2.addEventListener("click", () => goHome());
    // 重複のまとめを付ける・外す（kinbot の画面だけ）。外すと元の件数に戻る
    const dp = box.querySelector("[data-dup]"); if (dp) dp.addEventListener("click", async () => { const off = dp.dataset.dup === "off";
      if (off && !confirm("重複のまとめを外して、元の件数で出しますか？（Bales のデータはもともと変えていません）")) return;
      dp.disabled = true; dp.textContent = off ? "外しています…" : "まとめています…";
      try { await api(`/api/mochica/bales/lists/${encodeURIComponent(cur)}/dups/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ off }) }); try { lists = (await api("/api/mochica/bales/lists")).items || lists; } catch {} detail(); }
      catch (e) { alert(`できませんでした：${e.message}`); dp.disabled = false; } });
    const hs = box.querySelector("[data-hot]"); if (hs) hs.addEventListener("change", () => { hotF = hs.value; page = 0; detail(); });
    const hso = box.querySelector("[data-hsort]"); if (hso) hso.addEventListener("change", () => { hotSort = hso.checked; page = 0; detail(); });
    box.querySelectorAll("[data-hf]").forEach((b) => b.addEventListener("click", () => { hotF = hotF === b.dataset.hf ? "" : b.dataset.hf; page = 0; detail(); }));
    const fs = box.querySelector("[data-f]"); if (fs) fs.addEventListener("change", () => { fcol = fs.value ? stCol.key : ""; fval = fs.value; page = 0; detail(); });
    box.querySelectorAll("[data-pg]").forEach((b) => b.addEventListener("click", () => { page += Number(b.dataset.pg); detail(); }));
    box.querySelectorAll("[data-co]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); window.mcOpenCompany && window.mcOpenCompany(b.dataset.co); }));
    // 割り振り：行のチェックで選ぶ（行を押すと中身が開くので、チェックの所だけは止める）（2026-11-23 田中さん「各メンバーに割り振る機能を kincall みたいに」）
    const selc = () => { const e = box.querySelector("[data-selc]"); if (e) e.textContent = selRows.size ? `（${selRows.size}件）` : ""; };
    box.querySelectorAll("[data-sel]").forEach((c) => { c.addEventListener("click", (e) => e.stopPropagation()); c.addEventListener("change", () => { c.checked ? selRows.add(c.dataset.sel) : selRows.delete(c.dataset.sel); selc(); }); });
    box.querySelectorAll("td.bl-ck").forEach((td) => td.addEventListener("click", (e) => e.stopPropagation()));
    const sa = box.querySelector("[data-selall]"); if (sa) sa.addEventListener("change", () => { box.querySelectorAll("[data-sel]").forEach((c) => { c.checked = sa.checked; sa.checked ? selRows.add(c.dataset.sel) : selRows.delete(c.dataset.sel); }); selc(); });
    const ab = box.querySelector("[data-asg]"); if (ab) ab.addEventListener("click", () => assignSheet(l, r.total, csvQ));
    box.querySelectorAll("[data-row]").forEach((tr) => tr.addEventListener("click", () => leadSheet(l, tr.dataset.row, r.rows.find((d) => d.__k === tr.dataset.row))));
    box.querySelector("[data-colsel]").addEventListener("click", () => colSheet(l));
    // SF と結びつける：サーバーで読んで書く（2万件で数分）。進み具合を見せて、終わったら読み直す
    if (sfPolling !== cur) { api(`/api/mochica/bales/lists/${encodeURIComponent(cur)}/sf-link`).then((j) => { if (j.job && j.job.running) sfPoll(cur); }).catch(() => {}); }
  }
  // SF の結びつきの小さな印（商談の数・いちばん新しい段階。受注は緑、失注は黄色）
  const sfChip = (x) => { if (!x) return ""; if (!x.n) return x.status ? `<span class="bl-sfc">リード：${esc(x.status)}</span>` : ""; return `<span class="bl-sfc ${x.won ? "won" : x.lost ? "lost" : ""}" title="${esc(x.last)}（${esc(x.lastDate)}）">商談${x.n}・${esc(String(x.last).replace(/^\d+\s*[:：]\s*/, "").slice(0, 8))}</span>`; };
  let sfPolling = "";
  async function sfPoll(key) {
    sfPolling = key; let j = null; try { j = (await api(`/api/mochica/bales/lists/${encodeURIComponent(key)}/sf-link`)).job; } catch {}
    const el = document.querySelector("[data-sfst]"); const b = document.querySelector("[data-sf]");
    if (!j) { if (sfPolling === key && el && cur === key && /段階目/.test(el.textContent)) { el.textContent = "SF との結びつけが途中で止まりました（kinbot が再起動したため）。もう一度押してください。"; if (b) { b.disabled = false; b.textContent = "SF と結び直す"; } } sfPolling = ""; return; }
    // 進み具合：全体の％のバー・何段階目か・いまの作業と件数・経過時間（2026-11-15 田中さん「進捗がわかるように」）
    if (el && cur === key) { const sec = Math.round((Date.now() - (j.at || Date.now())) / 1000); const el2 = `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, "0")}秒`;
      el.innerHTML = j.error ? `SF と結びつけられませんでした：${esc(j.error)}` : j.running ? `<div class="bl-prog"><div class="bl-bar"><i style="width:${j.pct || 1}%"></i></div><b>${j.pct || 0}%</b></div><small>${j.no || 1} / ${j.of || 6} 段階目 ・ ${esc(j.step)} ・ 経過 ${el2}</small>` : "SF と結びつけました。"; }
    if (b && cur === key) { b.disabled = !!j.running; b.textContent = j.running ? "結びつけています…" : "SF と結び直す"; }
    if (j.running) { setTimeout(() => sfPoll(key), 3000); return; }
    sfPolling = ""; if (!j.error) load();
  }
  // ===== 表示項目を選ぶ（取り込んだ項目すべてから）=====
  function colSheet(l) {
    const cur0 = pickCols(l.cols, l.list_key, l.view).map((c) => c.key);
    const vk = (l.view || []).map((v) => v.key); const allc = [...(l.view || []).map((v) => ({ key: v.key, n: 0, vl: v.label })), ...(l.cols || []).filter((c) => !vk.includes(c.key))];
    const sh = sheet(`<h3>表示項目</h3><p class="mc-note">表に出す項目を選びます（上から順に出ます）。このブラウザに覚えます。</p>
      <input type="search" data-cf placeholder="項目を探す" class="bl-cf">
      <div class="bl-cols">${allc.map((c) => { const lb = c.vl || labelOf(c.key); return `<label data-ck="${esc(c.key.toLowerCase() + " " + lb)}"><input type="checkbox" value="${esc(c.key)}" data-lb="${esc(lb)}" ${cur0.includes(c.key) ? "checked" : ""}><span><b>${esc(lb)}</b>${lb !== c.key ? `<small>${esc(c.key)}</small>` : ""}</span><small>${c.vl ? "Bales の一覧" : c.n.toLocaleString() + "件"}</small></label>`; }).join("")}</div>
      <div style="display:flex;gap:8px;margin-top:12px"><button type="button" class="mt-btn" data-csave>この項目で表示</button><button type="button" class="mt-btn ghost" data-creset>${l.view && l.view.length ? "Bales の一覧と同じに戻す" : "おすすめに戻す"}</button></div>`);
    sh.querySelector("[data-cf]").addEventListener("input", (e) => { const v = e.target.value.trim().toLowerCase(); sh.querySelectorAll("[data-ck]").forEach((x) => { x.hidden = v && !x.dataset.ck.includes(v); }); });
    sh.querySelector("[data-csave]").addEventListener("click", () => { const ks = [...sh.querySelectorAll("input[type=checkbox]:checked")].map((x) => ({ key: x.value, label: x.dataset.lb })); try { localStorage.setItem(colsKey(l.list_key), JSON.stringify(ks.slice(0, 20))); } catch {} closeSheet(); detail(); });
    sh.querySelector("[data-creset]").addEventListener("click", () => { try { localStorage.removeItem(colsKey(l.list_key)); } catch {} closeSheet(); detail(); });
  }
  // ===== 会社まとめ（2026-11-20 福井さん）=====
  //   前は「取り込んだ全部の項目」と「詳しい中身」（Bales の読み先がほぼ 404 で空）を並べていて、ほとんど空白だった。
  //   いまは、会社の情報・商談の状態・先方の担当者・組織・当社側の担当・架電の履歴を、Bales と SF と MOCHICALL から集めて1枚に出す。
  //   値の無い項目は出さない（空欄を並べない）。
  const SFL = "https://ap10.lightning.force.com/lightning/r";
  const LEGAL = /(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|社会福祉法人|医療法人社団|医療法人財団|医療法人|学校法人|宗教法人|特定非営利活動法人|NPO法人|地方独立行政法人|独立行政法人|国立大学法人|生活協同組合|農業協同組合|協同組合|信用金庫|弁護士法人|税理士法人|監査法人|司法書士法人|行政書士法人|社会保険労務士法人|\(株\)|\(有\))/;
  const legalOf = (s) => { const m = String(s || "").normalize("NFKC").match(LEGAL); return m ? ({ "(株)": "株式会社", "(有)": "有限会社" }[m[1]] || m[1]) : ""; };
  const has = (v) => v !== "" && v != null && v !== false;
  // [見出し, 値, 値が HTML か] の並びを、値のあるものだけ2列で出す
  const kv = (pairs) => { const f = pairs.filter(([, v]) => has(v)); return f.length ? `<div class="bl-kv">${f.map(([k, v, html]) => `<div><small>${esc(k)}</small><span>${html ? v : esc(v)}</span></div>`).join("")}</div>` : ""; };
  const ln = (u) => (u ? `<a href="${esc(/^https?:/i.test(u) ? u : "http://" + u)}" target="_blank" rel="noopener">${esc(u)}</a>` : "");
  const ymd = (s) => { if (!s) return ""; const x = new Date(s); return isNaN(x) ? String(s).slice(0, 10) : `${x.getFullYear()}/${x.getMonth() + 1}/${x.getDate()}`; };
  const ymdhm = (s) => { if (!s) return ""; const x = new Date(s); return isNaN(x) ? String(s) : `${ymd(s)} ${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; };
  const sec = (title, sub, body) => (body ? `<section class="bl-sec bl-co"><div class="bl-st">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ""}</div>${body}</section>` : "");
  const tbl = (heads, rows) => (rows.length ? `<div class="bl-tbl"><table><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((c) => `<tr>${c.map((x) => `<td title="${esc(String(x).replace(/<[^>]+>/g, ""))}">${x}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : "");
  const chip = (t, cls = "") => (t ? `<span class="bl-chip ${cls}">${esc(t)}</span>` : "");
  const stageCls = (s) => (/受注|^0[6-8]/.test(s || "") ? "won" : /失注|NG|ロスト/.test(s || "") ? "lost" : "");
  async function leadSheet(l, rid, row) {
    const sh = sheet('<div class="mc-note">読み込んでいます…</div>');
    let r; try { r = await api(`/api/mochica/bales/lists/${encodeURIComponent(l.list_key)}/rows/${encodeURIComponent(rid)}`); } catch (e) { sh.innerHTML = `<div class="mc-note">読めませんでした：${esc(e.message)}</div>`; return; }
    const draw = (c, mts) => { if (!sheetEl || !sheetEl.contains(sh)) return; sh.innerHTML = companyHtml(rid, r, row, c, mts); bindSheet(sh); };
    draw(null, null);
    // SF と MiiTel は後から足す：Bales の分を先に見せて待たせない
    const coName = String((r.data || {}).companyName || "");
    const pc = api(`/api/mochica/bales/lists/${encodeURIComponent(l.list_key)}/rows/${encodeURIComponent(rid)}/company`).catch((e) => ({ sfError: "読めませんでした：" + e.message, calls: [] }));
    const pm = window.mcMeetingsOf && coName ? window.mcMeetingsOf((x) => !!x && coNorm(x) === coNorm(coName)).catch(() => []) : Promise.resolve([]);
    const [c, mts] = await Promise.all([pc, pm]); draw(c, mts);
  }
  function bindSheet(sh) {
    sh.querySelectorAll("[data-openco]").forEach((b) => b.addEventListener("click", () => { const co = b.dataset.openco; closeSheet(); if (window.mcOpenCompany) window.mcOpenCompany(co); }));
  }
  function companyHtml(rid, r, row, c, mts) {
    const raw = r.raw || {}, d = r.data || {}; const B = { ...d, ...raw };
    const L = (c && c.lead) || null, A = (c && c.account) || null; const H = (L && L.hear) || {};
    const pick = (...v) => { const x = v.find(has); return x == null ? "" : x; };
    const name = B.companyName || (L && L.company) || (A && A.name) || "（会社名なし）";
    const legal = legalOf(name);
    const arr = (v) => (Array.isArray(v) ? v : []);
    const tags = arr(raw.freeTags).map((t) => t && t.text).filter(Boolean);
    const srcs = arr(raw.leadSources).map((t) => t && t.name).filter(Boolean);
    const camps = arr(raw.sfCampaigns).map((t) => t && t.name).filter(Boolean);
    const nexts = arr(raw.nextActions).filter((x) => x && !x.isDone).sort((a, b) => String(a.reservedAt).localeCompare(String(b.reservedAt)));
    const opps = (c && c.opps) || []; const last = opps[0] || null;
    const group = (c && c.group) || [];
    const calls = (c && c.calls) || [];
    // ===== 見出し：会社名と、いまの状態がひと目で分かる札 =====
    const hot = row && row.__hot ? `<span class="bl-hotc">${hotCell(row.__hot)}</span>` : "";
    const head = `<h3>${esc(name)}</h3>
      <div class="bl-chips">${chip(legal, "lg")}${chip(B.lastLeadStageName ? "Bales：" + B.lastLeadStageName : "")}${chip(L && L.status ? "SF リード：" + L.status : "")}${chip(A && A.status ? "取引先：" + A.status : "", stageCls(A && A.status))}${chip(last ? "最新の商談：" + last.stage : "", stageCls(last && last.stage))}${hot}</div>
      <div class="bl-sflinks"><a class="mt-btn ghost" href="https://mochica.balescloud.jp/app/lead-list?callTargetId=${encodeURIComponent(B.callTargetId || rid)}" target="_blank" rel="noopener">Bales ↗</a>${L ? `<a class="mt-btn ghost" href="${SFL}/Lead/${esc(L.id)}/view" target="_blank" rel="noopener">SF のリード ↗</a>` : ""}${A ? `<a class="mt-btn ghost" href="${SFL}/Account/${esc(A.id)}/view" target="_blank" rel="noopener">SF の取引先 ↗</a>` : ""}${mts && mts.length ? `<button type="button" class="mt-btn ghost" data-openco="${esc(mts[0].co)}">MiiTel の商談（${mts.length}件）</button>` : ""}</div>`;
    // ===== 会社の情報 =====
    const info = kv([["会社名", name], ["法人格", legal], ["代表電話", pick(B.companyTel1, A && A.phone, L && L.phone)], ["住所", pick(A && A.addr, B.companyAddress, L && L.addr)],
      ["会社 URL", ln(pick(B.companyUrl, A && A.web, L && L.web)), true], ["業種", pick(A && A.industry, B.businessCategory, L && L.industry)], ["従業員数", pick(A && A.emp, B.numberOfEmployees, L && L.emp)],
      ["法人番号", A && A.corpNo], ["採用ページ", ln(A && A.recruit), true], ["LINE の登録名", A && A.line], ["利用中の ATS", H["利用中ATS"]], ["採用人数", H["採用人数(選択リスト)"]], ["エントリー数", H["エントリー数"]],
      ["今のサービスの更新月", H["現利用サービス更新予定月"]], ["リードの出どころ", [...srcs, L && L.source].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join("、")], ["SF キャンペーン", camps.join("、")], ["タグ", tags.join("、")],
      ["アプローチ禁止", H["アプローチ禁止の種類"]], ["Bales に入った日", ymd(B.createdAt)], ["SF リードの作成日", L && L.created], ["取引先になった日", A && A.since]]);
    // ===== 商談の状態 =====
    const nx = nexts[0];
    const state = kv([["Bales のステージ", B.lastLeadStageName ? `${B.lastLeadStageName}${has(B.lastLeadStageStayDays) ? `（${B.lastLeadStageStayDays}日目）` : ""}` : ""], ["SF リードの状態", L ? `${L.status}${L.converted ? "（コンバート済み）" : ""}` : ""],
      ["取引先の状態", A && A.status], ["最新の商談", last ? `${last.stage}（${last.type ? last.type + "・" : ""}${last.date}）` : ""], ["商談の回数", opps.length ? `${opps.length}件` : ""],
      ["架電の回数", has(B.callResultsCount) ? `${B.callResultsCount}回` : ""], ["最後の架電", B.lastCalledAt ? `${ymdhm(B.lastCalledAt)}　${B.callResult || ""}` : ""], ["最後のコメント", pick(B.lastCalledComment, B.lastActivityComment)],
      ["次にやること", nx ? `${ymdhm(nx.reservedAt)}　${nx.name || ""}${nx.content ? "：" + nx.content : ""}${nx.owner && nx.owner.name ? `（${nx.owner.name}）` : ""}` : ""],
      ["活動予定", [H["活動予定日時"], H["活動予定コメント"]].filter(Boolean).join("　")], ["顧客の現状", H["顧客の現状"]], ["顧客の課題感", H["顧客の課題感"]], ["検討開始時期", H["検討開始時期"]], ["ペンディング理由", H["ペンディング理由"]],
      ["失注した日", H["失注商談失注日"] ? `${H["失注商談失注日"]}${H["失注商談失注前ステージ"] ? `（失注前：${H["失注商談失注前ステージ"]}）` : ""}` : ""],
      ["失注理由", [H["失注商談失注理由大"], H["失注商談失注理由中"], H["失注商談失注理由小"]].filter(Boolean).join(" ／ ")], ["失注理由の詳細", H["失注商談失注理由詳細"]], ["負けた競合", H["失注商談バッティング負け競合"]], ["失注後の次のアクション", H["失注後次回アクション日"]]]);
    const oppT = tbl(["商談日", "商談名", "事業", "段階", "担当", "アポ獲得", "失注理由"], opps.map((o) => [esc(o.date), `<a href="${SFL}/Opportunity/${esc(o.id)}/view" target="_blank" rel="noopener">${esc(o.name)}</a>`, esc(o.type), `<span class="bl-stg ${stageCls(o.stage)}">${esc(o.stage)}</span>`, esc(o.owner), esc(o.apo), esc([o.lost, o.detail].filter(Boolean).join("："))]));
    // ===== 先方の担当者：Bales・SF のリード・同じ会社のほかのリード・取引先責任者を1つの表に（同じ名前は1行にまとめる）=====
    const ppl = []; const nk = (s) => String(s || "").normalize("NFKC").replace(/\s|様|さん/g, "");
    const add = (p) => {
      const k = nk(p.name); const vague = !k || /^(ご?担当者?|採用担当|人事)$/.test(k);
      if (vague && !p.phone && !p.email) return;
      // Bales は名字だけ（志水）、SF はフルネーム（志水 亮介）のことが多いので、片方が片方の頭なら同じ人とみる
      const same = (x) => { const a = nk(x.name); return a === k || (a.length >= 2 && k.length >= 2 && (a.startsWith(k) || k.startsWith(a))); };
      const o = vague ? null : ppl.find(same);
      if (o && k.length > nk(o.name).length) o.name = p.name;   // 長いほう（フルネーム）を残す
      if (o) { for (const f of ["title", "dept", "phone", "email"]) if (!o[f] && p[f]) o[f] = p[f]; if (!o.src.includes(p.src)) o.src.push(p.src); } else ppl.push({ ...p, src: [p.src] });
    };
    add({ name: B.targetName, title: B.position, dept: B.department, phone: pick(B.personalTel, B.companyTel1), email: B.email, src: "Bales" });
    if (L) add({ name: L.name, title: L.title, phone: L.phone || L.mobile, email: L.email, src: "SF リード" });
    for (const o of (c && c.others) || []) add({ name: o.name, title: o.title, phone: o.phone, email: o.email, src: `SF リード（${o.status || "状態なし"}）` });
    for (const o of (c && c.contacts) || []) add({ name: o.name, title: o.title, dept: o.dept, phone: o.phone, email: o.email, src: `取引先責任者${o.biz ? "（" + o.biz + "）" : ""}` });
    const pplT = tbl(["名前", "役職", "部署", "電話", "メール", "出どころ"], ppl.map((p) => [esc(p.name || "（名前なし）"), esc(p.title), esc(p.dept), esc(p.phone), esc(p.email), esc(p.src.join("・"))]));
    // ===== 組織：法人格・従業員数・部署・拠点・同じ法人のほかの事業の取引先 =====
    const depts = [...new Set(ppl.map((p) => p.dept).filter(Boolean))];
    const site = (() => { const m = String(name).normalize("NFKC").replace(LEGAL, " ").trim().match(/\s(\S.*)$/); return m ? m[1] : ""; })();   // 「法人名 ＋ 施設名」の施設名
    const org = kv([["法人格", legal], ["従業員数", pick(A && A.emp, B.numberOfEmployees, L && L.emp)], ["事業所・施設", site], ["わかっている部署", depts.join("、")], ["わかっている役職", [...new Set(ppl.map((p) => p.title).filter(Boolean))].join("、")]]);
    const grpT = group.length > 1 ? tbl(["事業", "取引先名", "状態", "担当"], group.map((g) => [esc(g.biz), `<a href="${SFL}/Account/${esc(g.id)}/view" target="_blank" rel="noopener">${esc(g.name)}</a>`, esc(g.status), esc(g.owner)])) : "";
    // ===== 当社側の担当 =====
    const ours = kv([["Bales の架電担当", B.operatorName], ["次の予定の担当", nx && nx.owner && nx.owner.name !== B.operatorName ? nx.owner.name : ""], ["SF リードの所有者", L && L.owner], ["取引先の所有者", A && A.owner],
      ["商談の担当", [...new Set(opps.map((o) => o.owner).filter(Boolean))].join("、")], ["アポを取った人", [...new Set(opps.map((o) => o.apo).filter(Boolean))].join("、")], ["前の失注商談の所有者", H["失注商談所有者"]],
      ["MOCHICALL で掛けた人", [...new Set(calls.map((x) => x.caller).filter(Boolean))].join("、")]]);
    // ===== 架電の履歴（MOCHICALL）と MiiTel の商談 =====
    const callT = tbl(["日時", "掛けた人", "相手", "つながり", "結果", "メモ", "次"], calls.map((x) => [esc(ymdhm(x.created_at)), esc(x.caller), esc(x.person), esc(x.reach), esc([x.outcome, x.reason].filter(Boolean).join("：")), esc(x.memo), esc(ymdhm(x.apo_at || x.next_at))]));
    const mtT = mts && mts.length ? tbl(["日時", "商談", "担当"], mts.slice(0, 20).map((m) => [esc(ymdhm(m.at)), esc(m.title), esc(m.host)])) : "";
    return `${head}${!c ? '<div class="mc-note" style="margin-top:6px">SF を読んでいます…</div>' : ""}${c && c.sfError ? `<div class="bl-diag" style="margin-top:8px">${esc(c.sfError)}</div>` : ""}
      ${sec("会社の情報", "", info)}
      ${sec("商談の状態", opps.length ? `SF の商談 ${opps.length}件` : c ? "SF の商談なし" : "", state + (oppT ? `<div class="bl-h4">商談の一覧</div>${oppT}` : ""))}
      ${sec("先方の担当者", ppl.length ? `${ppl.length}人` : "", pplT)}
      ${sec("組織", group.length > 1 ? `同じ法人の取引先 ${group.length}件` : "", org + (grpT ? `<div class="bl-h4">同じ法人のほかの事業</div>${grpT}` : ""))}
      ${sec("当社側の担当", "", ours)}
      ${sec("架電の履歴（MOCHICALL）", calls.length ? `${calls.length}件` : "", callT)}
      ${sec("MiiTel の商談", mts && mts.length ? `${mts.length}件` : "", mtT)}`;
  }
  let sheetEl = null;
  function sheet(html) { closeSheet(); sheetEl = document.createElement("div"); sheetEl.className = "bl-sheet-bg"; sheetEl.innerHTML = `<div class="bl-sheet"><button type="button" class="bl-x" aria-label="閉じる">×</button><div class="bl-sheet-in">${html}</div></div>`;
    sheetEl.addEventListener("click", (e) => { if (e.target === sheetEl) closeSheet(); }); sheetEl.querySelector(".bl-x").addEventListener("click", closeSheet); document.body.appendChild(sheetEl); return sheetEl.querySelector(".bl-sheet-in"); }
  // 割り振る：選んだリード（選ばなければ、いまの表の条件に合う全部）を、MOCHICALL のかけるリストに入れて、選んだ人で交互に分ける
  async function assignSheet(l, total, csvQ) {
    let tg; try { tg = await api("/api/mccall/assign-targets"); } catch (e) { alert(`割り振り先を読めませんでした：${e.message}（MOCHICALL の管理者だけが使えます）`); return; }
    const lists0 = tg.lists || []; if (!lists0.length) { alert("MOCHICALL に開いているかけるリストがありません。先に MOCHICALL の「リストの管理」でリストを作ってください。"); return; }
    const n = selRows.size || total;
    const sh = sheet(`<h3 class="bl-sh-t">割り振る</h3>
      <p class="mc-note" style="line-height:1.8">${selRows.size ? `選んだ <b>${n.toLocaleString()}件</b>` : `いまの表の条件に合う <b>${n.toLocaleString()}件</b>（選んでいないので全部）`}を、選んだ人で交互に分けます（ホットなリードから順に配るので偏りません）。<br>入れた先の MOCHICALL のリストで、その人がかけます。もうほかのリストに入っているリードは、担当だけ付け替えます。アプローチ禁止は入れません。</p>
      <label class="mc-note" style="display:block;margin:10px 0 4px;font-weight:800">入れるリスト</label><select class="kx-in" data-al style="width:100%">${lists0.map((x) => `<option value="${x.id}">${esc(x.name)}（メンバー ${x.members.length}人）</option>`).join("")}</select>
      <label class="mc-note" style="display:block;margin:12px 0 4px;font-weight:800">分ける人</label><div class="bl-mpick" data-am></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button type="button" class="mt-btn" data-ago>割り振る</button></div>`);
    const drawM = () => { const L = lists0.find((x) => String(x.id) === sh.querySelector("[data-al]").value) || lists0[0];
      sh.querySelector("[data-am]").innerHTML = L.members.length ? L.members.map((m) => `<label><input type="checkbox" value="${esc(m.email)}" data-nm="${esc(m.name)}"><span>${esc(m.name)}${m.intern ? "（インターン）" : ""}</span></label>`).join("") : '<div class="mc-note">このリストにメンバーがいません。MOCHICALL の「リストの管理」→「メンバー」で選んでください。</div>'; };
    drawM(); sh.querySelector("[data-al]").addEventListener("change", drawM);
    sh.querySelector("[data-ago]").addEventListener("click", async (e) => {
      const btn = e.currentTarget; const members = [...sh.querySelectorAll("[data-am] input:checked")].map((x) => x.value);
      if (!members.length) { alert("分ける人を選んでください"); return; }
      btn.disabled = true; btn.textContent = "割り振っています…";
      try {
        // 選んでいなければ、いまの表の条件に合う全部の印を集める
        let keys = [...selRows];
        if (!keys.length) for (let off = 0; ; off += 5000) { const a = await api(`/api/mochica/bales/lists/${encodeURIComponent(l.list_key)}/rows?${csvQ}&offset=${off}&limit=5000`); keys.push(...a.rows.map((d) => d.__k)); if (a.rows.length < 5000 || keys.length >= 5000) break; }
        keys = keys.slice(0, 5000);
        const r = await api("/api/mccall/from-bales-assign", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ listKey: l.list_key, rowKeys: keys, listId: Number(sh.querySelector("[data-al]").value), members }) });
        if (r.done && r.done.length) await api(`/api/mochica/bales/lists/${encodeURIComponent(l.list_key)}/assign-local`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: r.done }) });
        closeSheet(); selRows.clear();
        alert(`「${r.list}」に割り振りました：${r.per.map((p) => `${p.name} ${p.n}件`).join("・")}\n（新しく入れた ${r.added}件・付け替え ${r.moved}件${r.banned ? `・アプローチ禁止で入れなかった ${r.banned}件` : ""}${r.dup ? `・ほかのリードと重なって入れなかった ${r.dup}件` : ""}）`);
        detail();
      } catch (er) { alert(`割り振れませんでした：${er.message}`); btn.disabled = false; btn.textContent = "割り振る"; }
    });
  }
  function closeSheet() { if (sheetEl) { sheetEl.remove(); sheetEl = null; } }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
  // 拡張機能から最後に届いた様子：取り込めないときに、どこで止まったかを見る（2026-11-15）
  function diagHtml() {
    if (!diag) return '<div class="bl-diag"><b>拡張機能の様子</b>拡張機能からまだ何も届いていません。kinbot-ext を 2.2.3 に入れ直し、kinbot の画面を一度開いてから、Bales のリード一覧で右下の「kinbot に取り込む」を押してください。ボタンが出ないときは、拡張機能が古いか、入っていません。</div>';
    const why = diag.nohook ? "Bales のページの中で、一覧を読む部分が動いていませんでした（ページを読み込み直すと動きます）。" : diag.cands.length ? `一覧らしいデータが ${diag.cands.length} 個見えています。` : "一覧らしいデータが見つかりませんでした。下の通り道を見て直します。";
    return `<div class="bl-diag"><b>拡張機能の様子</b>${esc(dt(diag.at))} ・ 版 ${esc(diag.ver || "?")} ・ ${esc(diag.href)}<br>${esc(why)}
      ${diag.cands.length ? `<div class="bl-dl">${diag.cands.map((c) => `<div>${esc(c.ep)} … ${c.n}件${c.total != null ? `／全${c.total}` : ""}${c.pager ? `（めくり：${esc(c.pager)}）` : "（めくり方不明）"}<small>${esc(c.keys.join(", "))}</small></div>`).join("")}</div>` : ""}
      ${diag.seen.length ? `<details><summary>見えた通り道（${diag.seen.length}）</summary><div class="bl-dl">${diag.seen.map((x) => `<div>${esc(x.ep)} <small>${x.status || ""} ${esc(x.ct)} ${x.len >= 0 ? x.len + "文字" : ""} ${x.arr >= 0 ? "並び" + x.arr : ""}</small></div>`).join("")}</div></details>` : ""}</div>`;
  }
  window.mcBalesView = load;
})();
