// deals.js — 案件単位ビュー＋ネクストアクション管理
const $ = (id) => document.getElementById(id);
const PHASE_LABEL = { "01": "01 初回商談", "02": "02 有効商談", "03": "03 担当者合意", "04": "04 企画決定者合意" };
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function fmtDate(d) {
  const x = new Date(d);
  return `${x.getMonth() + 1}/${x.getDate()} ${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;
}
function companyFromTitle(title) {
  let t = String(title || "").trim();
  if (!t) return "(無題)";
  t = t.replace(/^[\s　・※•◆◇■□▶▷*\-–—✉⊠]+/u, "");
  t = t.replace(/[【\[［][^】\]］]*[】\]］]/gu, " ");
  t = t.replace(/[\s　/／|｜:：][^\s　/／|｜]{0,16}様(?:\s*[・,、][^\s　/／|｜]{0,16}様)*\s*$/u, "");
  t = t.replace(/[^\s　/／|｜]{0,16}様\s*$/u, "");
  t = t.replace(/\s+/g, " ").trim();
  return t || String(title || "(無題)").trim();
}
const acctOf = (m) => (m.account && m.account.trim()) || companyFromTitle(m.title) || "(無題)";
function lastLostReason(ms) {
  for (let i = ms.length - 1; i >= 0; i--) {
    const a = ms[i].analysis;
    if (a && a.deal_status === "失注" && a.deal_status_reason) return a.deal_status_reason;
  }
  for (let i = ms.length - 1; i >= 0; i--) {
    const a = ms[i].analysis;
    if (a && a.deal_status_reason) return a.deal_status_reason;
  }
  return "";
}

let all = [];
let groups = {}; // groupKey -> meetings[]
let groupPrimary = {}; // groupKey -> 代表rawキー
let current = null;
let dealStatuses = {}; // account -> {status, manual}
let accountsMap = {}; // key -> {site_url, official_name, owner, profile}
const STATUS_LIST = ["進行中", "受注", "失注", "保留"];
const primaryOf = (a) => groupPrimary[a] || a;
const statusOf = (a) => (dealStatuses[primaryOf(a)] && dealStatuses[primaryOf(a)].status) || "進行中";
const displayName = (a) => (accountsMap[primaryOf(a)] && accountsMap[primaryOf(a)].official_name) || a;

let usersCacheD = null;
async function loadUsersD() {
  if (usersCacheD) return usersCacheD;
  try { usersCacheD = await (await fetch("/api/users")).json(); } catch { usersCacheD = []; }
  return usersCacheD;
}
async function renderOwnerPicker(account, last) {
  const wrap = document.getElementById("dealOwnerWrap");
  if (!wrap) return;
  const pk = primaryOf(account);
  const users = await loadUsersD();
  const acc = accountsMap[pk] || {};
  const cur = acc.owner || last.owner || "";
  const curName = (() => {
    const u = (users || []).find((x) => x.email === cur);
    return u ? (u.name || u.email) : (last.owner_name || cur || "未設定");
  })();
  const initial = (curName || "?").trim().charAt(0);
  const opts = ['<option value="">未設定</option>']
    .concat((users || []).map((u) => `<option value="${esc(u.email)}" ${u.email === cur ? "selected" : ""}>${esc(u.name || u.email)}</option>`))
    .join("");
  wrap.innerHTML =
    `<span class="deal-owner"><span class="deal-owner-ava">${esc(initial)}</span>` +
    `担当 <select id="dealOwnerSel" class="deal-owner-sel">${opts}</select></span>`;
  const sel = wrap.querySelector("#dealOwnerSel");
  sel.addEventListener("change", async () => {
    const owner = sel.value;
    try {
      await fetch(`/api/accounts/${encodeURIComponent(pk)}`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner }),
      });
      accountsMap[pk] = { ...(accountsMap[pk] || { key: pk }), owner };
      // アバター文字を更新
      const u = (users || []).find((x) => x.email === owner);
      const nm = u ? (u.name || u.email) : (owner || "未設定");
      const ava = wrap.querySelector(".deal-owner-ava");
      if (ava) ava.textContent = (nm || "?").trim().charAt(0);
    } catch {}
  });
}

// ===== 案件フェーズ判定（最新商談に基づく・案件単位の表示） =====

// 商談名から種別（コールド/過去失注）を推定（履歴側と同じ基準）
function inferDealKindD(title) {
  const t = String(title || "").toLowerCase();
  if (/過去失注|既存失注|失注済|再アプローチ|掘り起こし|ほりおこし/.test(title || "")) return "過去失注";
  if (/コールド|新規開拓|テレアポ|飛び込み|とびこみ/.test(title || "") || /\bcold\b/.test(t)) return "コールド";
  return "";
}
// 案件（複数商談）の種別を決める：保存済みdeal_kind優先、無ければタイトル推定。過去失注 > コールド。
function dealKindOf(account) {
  const ms = groups[account] || [];
  let cold = false, lost = false;
  for (const m of ms) {
    const k = m.deal_kind || inferDealKindD(m.title);
    if (k === "過去失注") lost = true;
    else if (k === "コールド") cold = true;
  }
  return lost ? "過去失注" : cold ? "コールド" : "";
}
const PHASE_NEED_D = {
  1: "顧客が自社固有の状況（数字・「うちは/私が/今」）を具体的に話すと到達",
  2: "担当者がデモ中に顧客固有の課題・数字を使うと到達",
  3: "デモ後に顧客が『期日＋確定形（します/たい）』で次の動きを示すと到達（受注の分岐点）",
  4: "申込書を送付（または送付の明言）で到達",
};
function escapeHtmlD(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}


// 新プロセス（Feature A）の判定状態を取得して表示。
// カードで取得済みの deal_id があれば会社名照合を通さず直接引く（ズレ防止）。
async function loadNewProcess(companyName, pk, ms) {
  const box = document.getElementById("newProcBox");
  if (!box) return;
  const known = newProcMap[normName(companyName)] || newProcMap[normName(pk)];
  const q = known && known.deal_id
    ? "deal_id=" + encodeURIComponent(known.deal_id)
    : "company=" + encodeURIComponent(companyName);
  let d;
  try {
    d = await (await fetch("/api/deal-status-by-company?" + q)).json();
  } catch { box.innerHTML = '<div class="empty-state">取得に失敗しました。</div>'; return; }
  if (!d || !d.found) {
    // 抽出データが無い → この会社の商談（文字起こし）から判定できるボタンを出す
    const botIds = (ms || []).map((m) => m.bot_id).filter(Boolean);
    box.innerHTML =
      '<div class="empty-state">まだ新プロセスの抽出データがありません。</div>' +
      (botIds.length
        ? `<div class="np-run"><button class="btn" id="npRunBtn" type="button">この会社の商談から判定する</button>` +
          `<span class="np-run-status" id="npRunStatus">${botIds.length}件の商談を文字起こしから判定します</span></div>`
        : '<div class="empty-state">文字起こしのある商談がありません。</div>');
    const btn = document.getElementById("npRunBtn");
    if (btn) btn.addEventListener("click", () => runNewProcess(botIds, companyName, pk, ms));
    return;
  }
  renderNewProcess(box, d);
}

// この会社の商談を順に抽出APIにかけて判定する
async function runNewProcess(botIds, companyName, pk, ms) {
  const btn = document.getElementById("npRunBtn");
  const st = document.getElementById("npRunStatus");
  if (btn) { btn.disabled = true; btn.textContent = "判定中…"; }
  let ok = 0, fail = 0;
  for (let i = 0; i < botIds.length; i++) {
    if (st) st.textContent = `判定中… (${i + 1}/${botIds.length})`;
    try {
      const r = await fetch("/api/meetings/" + encodeURIComponent(botIds[i]) + "/extract", { method: "POST" });
      if (r.ok) ok++; else fail++;
    } catch { fail++; }
  }
  if (st) st.textContent = `完了（成功 ${ok}件${fail ? " / 失敗 " + fail + "件" : ""}）`;
  // 結果を再取得して表示。カード一覧の状態も更新する。
  await loadNewProcess(companyName, pk, ms);
  if (typeof refreshNewProcMap === "function") { await refreshNewProcMap(); renderList(); }
}

// 判定データから現在ステージ番号と失注情報を決める
// ステージ: 1初回商談 → 2時期明確化 → 3今月/来月判断 → 4再商談実施 → 5受注
function npStageInfo(d) {
  const f = d.first || {};
  const st = d.status || "";
  let reached = 1; // 初回商談は必ず到達
  let lostAt = null;
  const scOk = f.schedule_choice && !["未定", "不明"].includes(f.schedule_choice);
  const atOk = f.apply_timing === "今月" || f.apply_timing === "来月";
  if (scOk) reached = 2;
  if (scOk && atOk) reached = 3;
  if (d.re) reached = 4;
  if (d.latest_result === "受注" || st === "受注") reached = 5;
  // 失注の位置
  if (st.startsWith("失注")) {
    if (d.re && d.latest_result === "失注") lostAt = 4; // 再商談後に失注
    else if (!scOk) lostAt = 1; // 時期未定で失注
    else if (!atOk) lostAt = 2; // 申込判断つかず失注
    else lostAt = reached;
  }
  return { reached, lostAt, isWon: reached >= 5 };
}

function renderNewProcess(box, d) {
  const stages = [
    { n: 1, label: "初回商談" },
    { n: 2, label: "時期明確化" },
    { n: 3, label: "今月/来月判断" },
    { n: 4, label: "再商談実施" },
    { n: 5, label: "受注" },
  ];
  const { reached, lostAt, isWon } = npStageInfo(d);
  const f = d.first || {};

  // ステージバー（丸＋ラベル＋矢印）
  const steps = stages.map((s) => {
    const done = s.n <= reached;
    const cur = s.n === reached && !isWon && lostAt == null;
    const isLost = lostAt != null && s.n === lostAt;
    let cls = done ? "done" : "todo";
    if (cur) cls += " cur";
    if (isLost) cls = "lost";
    if (s.n === 5 && isWon) cls = "won";
    const mark = isLost ? "×" : (done ? "✓" : s.n);
    return `<div class="np-step ${cls}"><span class="np-dot">${mark}</span><span class="np-step-label">${s.label}</span></div>`;
  }).join('<span class="np-arrow">›</span>');

  // ステータス見出し
  const statusBadge = `<span class="np-status np-${(d.status || "").replace(/[()]/g, "")}">${esc(d.status || "-")}</span>`;
  const review = d.needs_review ? '<span class="np-review">要確認あり</span>' : "";

  // 詳細行
  const jm = f.judgment_month ? f.judgment_month.replace("-", "年") + "月" : "—";
  const nextInfo = f.next_meeting_scheduled
    ? `設定済み${f.next_meeting_date ? "（" + esc(f.next_meeting_date) + "）" : ""}`
    : "未設定";
  let rows = "";
  if (d.first) {
    rows =
      `<div class="np-row"><span class="np-k">ご利用開始スケジュール</span><span class="np-v">${esc(f.schedule_choice || "—")}</span></div>` +
      `<div class="np-row"><span class="np-k">今月中の申込可否</span><span class="np-v">${esc(f.apply_timing || "—")}判断</span></div>` +
      `<div class="np-row"><span class="np-k">判断月（KPI計上）</span><span class="np-v">${jm}</span></div>` +
      `<div class="np-row"><span class="np-k">次回商談（再商談）</span><span class="np-v">${nextInfo}</span></div>` +
      (d.latest_result ? `<div class="np-row"><span class="np-k">再商談の結果</span><span class="np-v">${esc(d.latest_result)}</span></div>` : "");
  } else {
    rows = '<div class="empty-state">初回商談の抽出結果がありません。</div>';
  }

  // 判定理由（初回・再商談）
  let reasons = "";
  if (f.judgment_basis) reasons += `<div class="np-reason"><span class="np-reason-tag">初回商談</span>${esc(f.judgment_basis)}${f.confidence === "low" ? '<span class="np-lowconf">自信度：低</span>' : ""}</div>`;
  if (d.re && d.re.judgment_basis) reasons += `<div class="np-reason"><span class="np-reason-tag">再商談</span>${esc(d.re.judgment_basis)}${d.re.confidence === "low" ? '<span class="np-lowconf">自信度：低</span>' : ""}</div>`;
  const reasonsBlock = reasons
    ? `<details class="np-reasons" open><summary>判定の理由</summary><div class="np-reason-list">${reasons}</div></details>`
    : "";

  box.innerHTML =
    `<div class="np-head">${statusBadge}${review}<span class="np-count">抽出イベント ${d.event_count}件</span>` +
    `<button class="btn ghost np-rerun" id="npReRun" type="button">再判定</button></div>` +
    `<div class="np-stages">${steps}</div>` +
    `<div class="np-body">${rows}</div>` +
    reasonsBlock;
  const rr = document.getElementById("npReRun");
  if (rr && box._ctx) rr.addEventListener("click", () => runNewProcess(box._ctx.botIds, box._ctx.companyName, box._ctx.pk, box._ctx.ms));
}

function renderProfile(account) {
  const body = document.getElementById("profBody");
  if (!body) return;
  const acc = accountsMap[primaryOf(account)];
  const p = acc && acc.profile;
  if (!p || !(p.industry || p.employees || p.hiring || p.founded || p.location || p.business)) {
    body.innerHTML = '<div class="empty-state">企業サイトURLを入れて「取得」すると、業界・従業員数・採用人数などの会社概要が表示されます。</div>';
    return;
  }
  const cell = (label, val) => (val ? `<div class="prof-cell"><div class="prof-k">${label}</div><div class="prof-v">${esc(val)}</div></div>` : "");
  body.innerHTML =
    `<div class="prof-grid">` +
    cell("業界", p.industry) + cell("従業員数", p.employees) + cell("採用予定", p.hiring) +
    cell("設立", p.founded) + cell("本社", p.location) +
    `</div>` +
    (p.business ? `<div class="prof-biz">事業内容：${esc(p.business)} <span class="prof-note">（AI自動取得・要確認）</span></div>` : "") +
    (acc.site_url ? `<div class="prof-site"><a href="${esc(acc.site_url)}" target="_blank" rel="noopener">サイトを開く ↗</a></div>` : "");
}

// 案件カードに新プロセスの判定を出すための状態マップ（正規化会社名キー → deal）
let newProcMap = {};
async function refreshNewProcMap() {
  try {
    const deals = await (await fetch("/api/deals")).json();
    newProcMap = {};
    for (const d of deals || []) {
      const k = normName(d.company_name);
      if (k) newProcMap[k] = d;
    }
  } catch { newProcMap = {}; }
}

async function load() {  try {
    all = await (await fetch("/api/meetings")).json();
    const ds = await (await fetch("/api/deal-status")).json();
    dealStatuses = ds.statuses || {};
    try {
      const accs = await (await fetch("/api/accounts")).json();
      accountsMap = {};
      for (const a of accs || []) accountsMap[a.key] = a;
    } catch {}
    await refreshNewProcMap();
  } catch {
    $("dealList").innerHTML = '<div class="empty-state">読み込みに失敗しました。</div>';
    return;
  }
  // 担当者カード用にユーザー名を事前ロード
  await loadUsersD();
  // 担当フィルタは「担当者を選ぶ」階層に置き換えるため非表示
  const fo = $("fOwner");
  if (fo && fo.closest("label")) fo.closest("label").style.display = "none";
  const fs = $("fSearch");
  if (fs && !fs._wired) { fs._wired = true; fs.addEventListener("input", () => renderList()); }
  for (const id of ["fFrom", "fTo"]) {
    const elx = $(id);
    if (elx && !elx._wired) { elx._wired = true; elx.addEventListener("change", () => renderList()); }
  }
  const mb = $("mergeDupBtn");
  if (mb && !mb._wired) { mb._wired = true; mb.addEventListener("click", mergeDuplicates); }
  renderList();
}





// 同じ会社名の案件（別キーになっているもの）を、正式社名を揃えて1つにまとめる
function normName(s) {
  return String(s || "")
    .replace(/株式会社|（株）|\(株\)|㈱|有限会社|（有）|\(有\)|合同会社|合資会社|一般社団法人|公益社団法人|社会福祉法人|学校法人/g, "")
    .replace(/[\s　]+/g, "")
    .replace(/様$/u, "")
    .trim()
    .toLowerCase();
}
async function mergeDuplicates() {
  const status = $("mergeStatus");
  const setSt = (t) => { if (status) status.textContent = t; };
  const rawKeys = [...new Set(all.filter((m) => !(m.category && m.category !== "商談")).map((m) => acctOf(m)))];
  const byNorm = {};
  for (const rk of rawKeys) {
    const nameForNorm = (accountsMap[rk] && accountsMap[rk].official_name) || rk;
    const k = normName(nameForNorm);
    if (!k) continue;
    (byNorm[k] = byNorm[k] || []).push(rk);
  }
  const toMerge = Object.values(byNorm).filter((arr) => arr.length > 1);
  if (!toMerge.length) { setSt("まとめられる重複は見つかりませんでした"); setTimeout(() => setSt(""), 2500); return; }
  setSt("まとめています…");
  let count = 0;
  for (const arr of toMerge) {
    // 正式社名：既存の official_name（最長）を優先、無ければ最長のキー名
    let canonical = "";
    for (const rk of arr) {
      const off = accountsMap[rk] && accountsMap[rk].official_name;
      if (off && off.length > canonical.length) canonical = off;
    }
    if (!canonical) canonical = arr.slice().sort((a, b) => b.length - a.length)[0];
    for (const rk of arr) {
      if (accountsMap[rk] && accountsMap[rk].official_name === canonical) continue;
      try {
        await fetch(`/api/accounts/${encodeURIComponent(rk)}`, {
          method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ officialName: canonical }),
        });
        accountsMap[rk] = { ...(accountsMap[rk] || { key: rk }), official_name: canonical };
      } catch {}
    }
    count++;
  }
  try {
    const accs = await (await fetch("/api/accounts")).json();
    accountsMap = {};
    for (const a of accs || []) accountsMap[a.key] = a;
  } catch {}
  selectedRep = null; showAll = false; current = null;
  renderList();
  setSt(`${count}組をまとめました`);
  setTimeout(() => setSt(""), 3000);
}

function groupKeyOf(rk) {
  const off = accountsMap[rk] && accountsMap[rk].official_name;
  return (off && String(off).trim()) || rk;
}
function buildGroups() {
  const q = ($("fSearch").value || "").trim().toLowerCase();
  const from = $("fFrom") && $("fFrom").value ? new Date($("fFrom").value + "T00:00:00") : null;
  const to = $("fTo") && $("fTo").value ? new Date($("fTo").value + "T23:59:59") : null;
  groups = {};
  groupPrimary = {};
  const rawSets = {};
  for (const m of all) {
    if (m.category && m.category !== "商談") continue; // 社内MTG/フォロー等は案件に含めない
    const d = new Date(m.created_at);
    if (from && d < from) continue;
    if (to && d > to) continue;
    const rk = acctOf(m);
    const gk = groupKeyOf(rk); // 同じ正式社名はまとめる
    (groups[gk] = groups[gk] || []).push(m);
    (rawSets[gk] = rawSets[gk] || new Set()).add(rk);
  }
  for (const gk in groups) {
    groups[gk].sort((x, y) => new Date(x.created_at) - new Date(y.created_at));
    const raws = [...rawSets[gk]];
    // プロフィール/ステータス等を持つrawキーを代表に（無ければ最初）
    groupPrimary[gk] = raws.find((r) => accountsMap[r] && (accountsMap[r].official_name || accountsMap[r].profile || accountsMap[r].owner || accountsMap[r].site_url)) || raws[0];
  }
  if (q) {
    for (const gk in groups) {
      const name = (displayName(gk) || "").toLowerCase();
      if (!gk.toLowerCase().includes(q) && !name.includes(q)) delete groups[gk];
    }
  }
}

let selectedRep = null; // null=担当者一覧 / それ以外=その担当の案件
let showAll = false; // 「すべての案件」を選んだ状態
function repInfo(a) {
  const ms = groups[a];
  const last = ms[ms.length - 1];
  const pk = primaryOf(a);
  const accOwner = accountsMap[pk] && accountsMap[pk].owner;
  const email = accOwner || last.owner || "";
  let name = "";
  if (email) {
    const u = (usersCacheD || []).find((x) => x.email === email);
    name = u ? (u.name || u.email) : (last.owner_name || email);
  } else {
    name = last.owner_name || last.rep_name || "未設定";
  }
  return { key: email || name || "未設定", name: name || "未設定" };
}

function accountCardEl(a) {
  const ms = groups[a];
  const last = ms[ms.length - 1];
  const st = statusOf(a);
  const kind = dealKindOf(a);
  const kindBadge = kind
    ? `<span class="kind-badge ${kind === "過去失注" ? "kind-lost" : "kind-cold"}">${kind}</span>`
    : "";
  // 新プロセスの判定（会社名で照合）
  const np = newProcMap[normName(displayName(a))] || newProcMap[normName(a)];
  const npBadge = np && np.status
    ? `<span class="np-card-badge np-${String(np.status).replace(/[()]/g, "")}">${esc(np.status)}</span>`
    : `<span class="np-card-badge np-none">未判定</span>`;
  const card = document.createElement("div");
  card.className = "deal-card" + (a === current ? " active" : "");
  card.innerHTML =
    `<div class="deal-name">${esc(displayName(a))} ${kindBadge}<span class="status-badge st-${st}">${st}</span></div>` +
    `<div class="deal-meta"><span>${ms.length}件</span><span>${esc(last.owner_name || last.owner || "")}</span></div>` +
    `<div class="deal-sub"><span class="np-card-label">新プロセス:</span> ${npBadge} ・ 最終 ${fmtDate(last.created_at)}</div>`;
  card.addEventListener("click", () => selectDeal(a));
  return card;
}

function renderList() {
  buildGroups();
  const el = $("dealList");
  const names = Object.keys(groups).sort((a, b) => {
    const la = groups[a][groups[a].length - 1].created_at;
    const lb = groups[b][groups[b].length - 1].created_at;
    return new Date(lb) - new Date(la);
  });
  const q = ($("fSearch").value || "").trim();
  const hasDate = !!(($("fFrom") && $("fFrom").value) || ($("fTo") && $("fTo").value));
  const searching = !!q || hasDate;

  // レベル1：担当者カード（検索・すべて・担当選択のいずれも無いとき）
  if (!selectedRep && !showAll && !searching) {
    el.innerHTML = "";
    const allBtn = document.createElement("div");
    allBtn.className = "rep-card rep-all";
    allBtn.innerHTML = `<span class="rep-ava rep-ava-all">全</span><span class="rep-main"><span class="rep-name">すべての案件</span><span class="rep-sub">${names.length}社をまとめて見る</span></span><span class="rep-go">›</span>`;
    allBtn.addEventListener("click", () => { showAll = true; current = null; renderList(); });
    el.appendChild(allBtn);
    const head = document.createElement("div");
    head.className = "rep-head";
    head.textContent = "担当者で見る";
    el.appendChild(head);
    if (!names.length) { const e = document.createElement("div"); e.className = "empty-state"; e.textContent = "案件がありません。"; el.appendChild(e); return; }
    const reps = {};
    for (const a of names) {
      const info = repInfo(a);
      const r = (reps[info.key] = reps[info.key] || { name: info.name, accounts: 0, meetings: 0, last: 0 });
      r.accounts += 1; r.meetings += groups[a].length;
      const lt = +new Date(groups[a][groups[a].length - 1].created_at);
      if (lt > r.last) r.last = lt;
    }
    for (const k of Object.keys(reps).sort((x, y) => reps[y].last - reps[x].last)) {
      const r = reps[k];
      const card = document.createElement("div");
      card.className = "rep-card";
      card.innerHTML =
        `<span class="rep-ava">${esc((r.name || "?").trim().charAt(0))}</span>` +
        `<span class="rep-main"><span class="rep-name">${esc(r.name)}</span><span class="rep-sub">${r.accounts}社 ・ ${r.meetings}商談</span></span><span class="rep-go">›</span>`;
      card.addEventListener("click", () => { selectedRep = k; current = null; renderList(); });
      el.appendChild(card);
    }
    return;
  }

  // レベル2：案件カード（担当 or すべて/検索）
  const repScope = selectedRep && !showAll && !searching;
  const mine = repScope ? names.filter((a) => repInfo(a).key === selectedRep) : names;
  el.innerHTML = "";
  {
    const back = document.createElement("button");
    back.className = "rep-back";
    back.type = "button";
    if (repScope) {
      const repName = mine.length ? repInfo(mine[0]).name : "担当者";
      back.innerHTML = `← 担当者一覧　<b>${esc(repName)}</b>（${mine.length}社）`;
    } else {
      back.innerHTML = `← 担当者一覧　<b>${searching ? "検索結果" : "すべての案件"}</b>（${mine.length}社）`;
    }
    back.addEventListener("click", () => {
      selectedRep = null; showAll = false; current = null;
      if ($("fSearch")) $("fSearch").value = "";
      if ($("fFrom")) $("fFrom").value = "";
      if ($("fTo")) $("fTo").value = "";
      renderList();
    });
    el.appendChild(back);
  }
  if (!mine.length) { const e = document.createElement("div"); e.className = "empty-state"; e.textContent = "該当する案件がありません。"; el.appendChild(e); }
  else for (const a of mine) el.appendChild(accountCardEl(a));
}

async function selectDeal(account) {
  current = account;
  renderList();
  const pk = primaryOf(account);
  const ms = groups[account] || [];
  const det = $("dealDetail");
  const wrap = document.querySelector(".history");
  if (wrap) wrap.classList.add("m-detail");
  if (!selectDeal._wired && wrap) {
    selectDeal._wired = true;
    det.addEventListener("click", (e) => { if (e.target.closest(".m-back")) wrap.classList.remove("m-detail"); });
  }
  det.scrollTop = 0;
  const last = ms[ms.length - 1];

  // 相手の懸念（集約・重複除去）
  const concerns = [];
  const seen = new Set();
  for (const m of ms) {
    const cs = (m.summary && m.summary.customer_concerns) || [];
    for (const c of cs) {
      const k = String(c).replace(/\s+/g, "");
      if (k && !seen.has(k)) { seen.add(k); concerns.push(String(c)); }
    }
  }

  det.innerHTML =
    `<button class="m-back" type="button">← 一覧へ戻る</button>` +
    `<div class="deal-head">` +
    `<div class="deal-head-top"><h2>${esc(displayName(account))}</h2>` +
    (dealKindOf(account) ? `<span class="kind-badge ${dealKindOf(account) === "過去失注" ? "kind-lost" : "kind-cold"}">${dealKindOf(account)}</span>` : "") +
    `<div class="deal-status-pick"><span class="status-badge st-${statusOf(account)}" id="dealStBadge">${statusOf(account)}</span>` +
    `<select id="dealStSel">${STATUS_LIST.map((s) => `<option value="${s}" ${statusOf(account) === s ? "selected" : ""}>${s}</option>`).join("")}<option value="__auto">AIに任せる</option></select></div></div>` +
    `<div class="deal-head-meta"><span id="dealOwnerWrap" class="deal-owner-wrap"></span> ・ ${ms.length}回の商談` +
    (dealStatuses[pk] && dealStatuses[pk].manual ? ' ・ <span class="st-manual">手動設定</span>' : ' ・ <span class="st-auto">AI自動</span>') +
    `</div>` +
    (statusOf(account) === "失注" && lastLostReason(ms) ? `<div class="lost-reason">AI判定の失注理由: ${esc(lastLostReason(ms))}</div>` : "") +
    `</div>` +
    `<section class="deal-sec newproc-sec"><div class="deal-sec-h">📊 新プロセスの判定</div><div id="newProcBox"><div class="empty-state">読み込み中…</div></div></section>` +
    `<section class="deal-sec deal-profile"><div class="deal-sec-h">🏢 会社プロフィール</div>` +
    `<div class="prof-url"><input id="profUrl" type="text" placeholder="企業サイトURL（例: example.co.jp）" /><button class="btn" id="profGet">取得</button><span class="prof-status" id="profStatus"></span></div>` +
    `<div id="profBody"></div></section>` +
    `<section class="deal-sec"><div class="deal-sec-h">📋 ネクストアクション</div><div id="aiBox"><div class="empty-state">読み込み中…</div></div>` +
    `<div class="ai-add"><input id="aiNew" type="text" placeholder="やることを追加（例：見積もりを送付）" /><input id="aiDue" type="date" /><button class="btn" id="aiAddBtn">追加</button></div></section>` +
    `<section class="deal-sec"><div class="deal-sec-h">⚠️ 相手の懸念（これまでの集約）</div>` +
    (concerns.length ? `<ul class="deal-concerns">${concerns.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : '<div class="empty-state">記録なし</div>') +
    `</section>` +
    `<section class="deal-sec"><div class="deal-sec-h">🗂 商談の流れ</div><div class="deal-timeline" id="dealTimeline"></div></section>`;

  // ステータス変更
  $("dealStSel").addEventListener("change", async (e) => {
    const v = e.target.value;
    const body = v === "__auto" ? { account: pk, auto: true } : { account: pk, status: v };
    await fetch("/api/deal-status", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    // ローカル状態を更新
    if (v === "__auto") {
      if (dealStatuses[pk]) dealStatuses[pk].manual = false;
    } else {
      dealStatuses[pk] = { status: v, manual: true };
    }
    selectDeal(account);
    renderList();
  });

  // 会社プロフィール
  renderProfile(account);
  // 新プロセス（Feature A）の判定状態
  const npBox = document.getElementById("newProcBox");
  if (npBox) npBox._ctx = { botIds: ms.map((m) => m.bot_id).filter(Boolean), companyName: displayName(account) || account, pk, ms };
  loadNewProcess(displayName(account) || account, pk, ms);
  // 担当（アカウント単位で選択・保存）
  await renderOwnerPicker(account, last);
  const profUrl = $("profUrl"), profGet = $("profGet"), profStatus = $("profStatus");
  if (accountsMap[pk] && accountsMap[pk].site_url) profUrl.value = accountsMap[pk].site_url;
  profGet.addEventListener("click", async () => {
    const url = (profUrl.value || "").trim();
    if (!url) { profUrl.focus(); return; }
    profGet.disabled = true; profGet.textContent = "取得中…";
    if (window.kbProgress) window.kbProgress(profStatus, { percent: null, label: "サイトとWebから会社概要を取得中…" });
    try {
      const r = await fetch(`/api/accounts/${encodeURIComponent(pk)}/enrich`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "取得に失敗しました");
      accountsMap[pk] = { key: pk, site_url: d.siteUrl, official_name: d.officialName, owner: accountsMap[pk] && accountsMap[pk].owner, profile: d.profile };
      if (window.kbProgress) window.kbProgress(profStatus, { clear: true });
      renderProfile(account);
      const h = document.querySelector("#dealDetail h2"); if (h) h.textContent = displayName(account);
      renderList();
    } catch (e) {
      if (window.kbProgress) window.kbProgress(profStatus, { clear: true });
      profStatus.textContent = "失敗: " + e.message;
    } finally {
      profGet.disabled = false; profGet.textContent = "取得";
    }
  });

  // タイムライン
  const tl = $("dealTimeline");
  tl.innerHTML = "";
  for (const m of [...ms].reverse()) {
    const ov = (m.summary && m.summary.overview) || "（要約なし）";
    const item = document.createElement("div");
    item.className = "tl-item";
    item.innerHTML =
      `<div class="tl-dot"></div>` +
      `<div class="tl-body"><div class="tl-top"><b>${m.round_no ? m.round_no + "回目" : ""} ${esc(PHASE_LABEL[m.phase] || "")}</b><span class="tl-date">${fmtDate(m.created_at)}</span></div>` +
      `<div class="tl-title">${esc(m.title || "")}</div>` +
      `<div class="tl-ov">${esc(ov)}</div>` +
      `<a class="tl-link" href="history.html?m=${encodeURIComponent(m.bot_id)}">詳細を見る →</a></div>`;
    tl.appendChild(item);
  }

  // 追加ボタン
  $("aiAddBtn").addEventListener("click", async () => {
    const text = $("aiNew").value.trim();
    if (!text) return;
    await fetch("/api/action-items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account, text, due: $("aiDue").value || null }),
    });
    $("aiNew").value = ""; $("aiDue").value = "";
    loadActions(account);
  });
  $("aiNew").addEventListener("keydown", (e) => { if (e.key === "Enter") $("aiAddBtn").click(); });

  loadActions(account);
}

async function loadActions(account) {
  const box = $("aiBox");
  if (!box) return;
  try {
    const d = await (await fetch("/api/action-items?account=" + encodeURIComponent(account))).json();
    const items = d.items || [];
    const open = items.filter((i) => !i.done);
    const done = items.filter((i) => i.done);
    if (!items.length) {
      box.innerHTML = '<div class="empty-state">やることはまだありません。商談を重ねると、AIが抽出した「宿題」もここに自動で入ります。</div>';
      return;
    }
    box.innerHTML = renderActions(open) + (done.length ? `<div class="ai-done-h">完了（${done.length}）</div>` + renderActions(done) : "");
    box.querySelectorAll(".ai-item").forEach((row) => {
      const id = row.dataset.id;
      row.querySelector(".ai-chk").addEventListener("change", async (e) => {
        await fetch("/api/action-items/" + id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ done: e.target.checked }) });
        loadActions(account);
      });
      const del = row.querySelector(".ai-del");
      if (del) del.addEventListener("click", async () => {
        if (!confirm("削除しますか？")) return;
        await fetch("/api/action-items/" + id, { method: "DELETE" });
        loadActions(account);
      });
    });
  } catch {
    box.innerHTML = '<div class="empty-state">読み込みに失敗しました。</div>';
  }
}

function renderActions(list) {
  return list
    .map((i) => {
      const overdue = i.due_date && !i.done && new Date(i.due_date) < new Date(new Date().toDateString());
      const due = i.due_date ? `<span class="ai-due ${overdue ? "over" : ""}">期限 ${new Date(i.due_date).toLocaleDateString("ja-JP")}</span>` : "";
      const src = i.source === "ai" ? '<span class="ai-src">AI抽出</span>' : "";
      return (
        `<div class="ai-item ${i.done ? "done" : ""}" data-id="${i.id}">` +
        `<label class="ai-chk-wrap"><input type="checkbox" class="ai-chk" ${i.done ? "checked" : ""} /></label>` +
        `<div class="ai-text">${esc(i.text)}${src}${due}</div>` +
        `<button class="ai-del" title="削除">🗑</button>` +
        `</div>`
      );
    })
    .join("");
}

$("fOwner").addEventListener("change", renderList);
$("fSearch").addEventListener("input", renderList);
load();
