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
  // 会社名部分だけを抽出（日本の主要な法人形態を網羅）
  const suffix = "(?:株式会社|有限会社|合同会社|合名会社|合資会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|特定非営利活動法人|NPO法人|医療法人(?:社団|財団)?|学校法人|宗教法人|社会福祉法人|独立行政法人|生活協同組合|農業協同組合|漁業協同組合|信用金庫|信用組合)";
  const prePattern = new RegExp("(" + suffix + "[^\\s(（/／|｜:：,、]+)");
  const postPattern = new RegExp("([^\\s(（/／|｜:：,、]+" + suffix + ")");
  const preMatch = t.match(prePattern);
  const postMatch = t.match(postPattern);
  if (preMatch && postMatch) return preMatch[0].length >= postMatch[0].length ? preMatch[0] : postMatch[0];
  if (preMatch) return preMatch[0];
  if (postMatch) return postMatch[0];
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
// 旧ラベル「案件化中」を新ラベル「進行中」に読み替える（既存データ互換）
function npStatusLabel(s) { return String(s || "").replace("案件化中", "進行中"); }
let groups = {}; // groupKey -> meetings[]
let groupPrimary = {}; // groupKey -> 代表rawキー
let current = null;
let dealStatuses = {}; // account -> {status, manual}
let currentUserEmail = "";
let isImpersonating = false;
let impersonatorEmail = "";
fetch("/api/me").then((r) => r.json()).then((d) => {
  currentUserEmail = String((d && d.username) || "").toLowerCase();
  isImpersonating = !!(d && d.impersonating);
  impersonatorEmail = String((d && d.impersonator_email) || "").toLowerCase();
}).catch(() => {});
// ステータス変更を許可するアカウント（中澤・浦林）と、代理ログイン権限を持つアカウント（田中）
const STATUS_APPROVER_EMAILS = new Set([
  "ryota.nakazawa@neo-career.co.jp",
  "takaya.urabayashi@neo-career.co.jp",
]);
const IMPERSONATOR_EMAILS = new Set(["kinya.tanaka@neo-career.co.jp"]);
const isStatusApprover = () => {
  // 代理ログイン中は元アカウント（田中さん）が代理権限を持つならOK
  if (isImpersonating && IMPERSONATOR_EMAILS.has(impersonatorEmail)) return true;
  // それ以外は現在のログインアカウントで判定
  return STATUS_APPROVER_EMAILS.has(currentUserEmail);
};
let accountsMap = {}; // key -> {site_url, official_name, owner, profile}
let npSelectMode = false; // 「選択して判定」モード
let npSelected = new Set(); // 選択中の案件（groupsのキー）
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
  const t = String(title || "");
  if (/【ユ[/／]フォ】|ユーザーフォロー/.test(t)) return "ユーザーフォロー";
  if (/【社内MTG】|社内ミーティング|社内打ち合わせ/.test(t)) return "社内MTG";
  if (/過去失注|既存失注|失注済|再アプローチ|掘り起こし|ほりおこし/.test(t)) return "過去失注";
  if (/コールド|新規開拓|テレアポ|飛び込み|とびこみ/.test(t) || /\bcold\b/i.test(t)) return "コールド";
  return "";
}
// 営業案件かどうか（ユーザーフォロー・社内MTGでない）
function isSalesDeal(account) {
  const kind = dealKindOf(account);
  return kind !== "ユーザーフォロー" && kind !== "社内MTG";
}
// 案件（複数商談）の種別を決める：保存済みdeal_kind優先、無ければタイトル推定。過去失注 > コールド。
function dealKindOf(account) {
  const ms = groups[account] || [];
  let cold = false, lost = false, userFollow = false, internalMtg = false;
  for (const m of ms) {
    const k = m.deal_kind || inferDealKindD(m.title);
    if (k === "ユーザーフォロー") userFollow = true;
    else if (k === "社内MTG") internalMtg = true;
    else if (k === "過去失注") lost = true;
    else if (k === "コールド") cold = true;
  }
  if (userFollow) return "ユーザーフォロー";
  if (internalMtg) return "社内MTG";
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
  const known = lookupNewProc(companyName) || lookupNewProc(pk);
  const q = known && known.deal_id
    ? "deal_id=" + encodeURIComponent(known.deal_id)
    : "company=" + encodeURIComponent(companyName);
  let d;
  try {
    d = await (await fetch("/api/deal-status-by-company?" + q, { cache: "no-store" })).json();
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
  // 描画で例外が出ても「読み込み中…」のまま固まらないようにする
  try {
    renderNewProcess(box, d);
  } catch (e) {
    console.error("[新プロセス] 描画に失敗", e);
    box.innerHTML = `<div class="empty-state">判定の表示に失敗しました（${escapeHtmlSafe(e.message)}）。ページを再読み込みしてください。</div>`;
  }
}

// エラーメッセージ表示用の簡易エスケープ（esc が未定義でも落ちないように）
function escapeHtmlSafe(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// この会社の商談を順に抽出APIにかけて判定する
async function runNewProcess(botIds, companyName, pk, ms) {
  const box = document.getElementById("newProcBox");
  if (!box) return;
  const total = botIds.length;
  let ok = 0, fail = 0;

  // 進捗UIを描画
  const renderProgress = (done, label, phase) => {
    const pct = total ? Math.round((done / total) * 100) : 0;
    box.innerHTML =
      `<div class="np-prog">` +
      `<div class="np-prog-head"><span class="np-prog-spinner"></span><span class="np-prog-label">${esc(label)}</span><span class="np-prog-count">${done}/${total}</span></div>` +
      `<div class="np-prog-track"><div class="np-prog-fill" style="width:${pct}%"></div></div>` +
      `<div class="np-prog-steps">` +
      ["文字起こしを読み込み", "商談の種別を判定", "AIで内容を抽出", "判定結果を保存"].map((s, i) =>
        `<div class="np-prog-step ${phase > i ? "done" : phase === i ? "active" : ""}"><span class="np-prog-dot">${phase > i ? "✓" : i + 1}</span>${s}</div>`
      ).join("") +
      `</div></div>`;
  };

  renderProgress(0, "判定を開始しています…", 0);
  await new Promise((r) => setTimeout(r, 200));

  for (let i = 0; i < botIds.length; i++) {
    // 疑似的にステップを進めて「今何をしているか」を見せる（実処理はサーバー側で一括）
    renderProgress(i, `商談 ${i + 1}/${total} を処理中`, 0);
    await new Promise((r) => setTimeout(r, 150));
    renderProgress(i, `商談 ${i + 1}/${total}：種別を判定中`, 1);
    const selProvider = (document.getElementById("judgeModel") && document.getElementById("judgeModel").value) || "";
    const p = fetch("/api/meetings/" + encodeURIComponent(botIds[i]) + "/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: selProvider }),
    });
    await new Promise((r) => setTimeout(r, 400));
    renderProgress(i, `商談 ${i + 1}/${total}：AIで抽出中`, 2);
    let r;
    try { r = await p; } catch { r = null; }
    renderProgress(i, `商談 ${i + 1}/${total}：結果を保存中`, 3);
    await new Promise((res) => setTimeout(res, 200));
    if (r && r.ok) ok++; else fail++;
    renderProgress(i + 1, `商談 ${i + 1}/${total} 完了`, 4);
  }

  // 完了表示
  box.innerHTML = `<div class="np-prog-done">判定が完了しました（成功 ${ok}件${fail ? " / 失敗 " + fail + "件" : ""}）。最新の状態に更新しています…</div>`;
  await new Promise((r) => setTimeout(r, 300));
  // 先にカード一覧を最新化する（詳細パネルの再描画が失敗しても、カードは必ず更新されるよう分離）
  try { await refreshNewProcMap(); } catch {}
  try { renderList(); } catch {}
  // 詳細パネルも最新化
  try { await loadNewProcess(companyName, pk, ms); } catch {}
}

// 判定データから現在ステージ番号と失注情報を決める
// ステージ: 1初回商談 → 2時期明確化 → 3今月/来月判断 → 4再商談実施 → 5受注
function npStageInfo(d) {
  const f = d.first || {};
  const st = d.status || "";
  const hasFirst = !!d.first;                 // 初回商談の判定データがあるか
  const hasNext = !!f.next_meeting_scheduled; // 再商談の日程が設定されたか
  const isReview = st === "要確認";
  const isPending10day = st === "進行中(未設定)"; // 初回商談その場で再商談未設定、10日間の猶予中
  const scOk = hasFirst && f.schedule_choice && !["未定", "不明"].includes(f.schedule_choice);
  const atOk = hasFirst && (f.apply_timing === "今月" || f.apply_timing === "来月");
  const isWon = d.latest_result === "受注" || st === "受注";
  // 手動進捗（人がクリックで進めた進捗）。設定されていれば、そのステージまでは達成扱い。
  const mp = d.manual_progress && Number.isInteger(d.manual_progress.stage) ? d.manual_progress.stage : 0;
  // 各ステージは「そのステージの根拠があるとき」だけ達成扱いにする。
  // 初回商談が未判定なのに「時期明確化」「今月/来月判断」に✓が付かないようにするため、
  // 通し番号(reached)ではなくステージ単位で判定する。
  const done = {
    1: hasFirst || mp >= 1,
    2: scOk || mp >= 2,
    3: (scOk && atOk) || mp >= 3,
    4: !!d.re || mp >= 4,        // 実際に再商談を実施した（予定だけでは達成しない）
    5: isWon || mp >= 5,
  };
  // 手動 or AI で1つでも根拠が有れば「不明」ではない
  const unknown = { 1: !done[1], 2: !hasFirst && mp === 0, 3: !hasFirst && mp === 0, 4: false, 5: false };
  let reached = 0;
  for (const n of [1, 2, 3, 4, 5]) if (done[n]) reached = n;
  if (!reached) reached = 1;
  let lostAt = null;
  if (st.startsWith("失注")) {
    if (d.re && d.latest_result === "失注") lostAt = 4; // 再商談後に失注
    else if (!hasNext) lostAt = 3; // 再商談が設定されず失注
    else lostAt = reached;
  }
  return { reached, lostAt, isWon, isReview, hasNext, isPending10day, done, unknown, hasFirst, manualStage: mp };
}

function renderNewProcess(box, d) {
  const stages = [
    { n: 1, label: "初回商談" },
    { n: 2, label: "時期明確化" },
    { n: 3, label: "今月/来月判断" },
    { n: 4, label: "再商談実施" },
    { n: 5, label: "受注" },
  ];
  const { reached, lostAt, isWon, isReview, isPending10day, hasNext, done: doneMap, unknown: unknownMap } = npStageInfo(d);
  const f = d.first || {};

  // ステージバー（丸＋ラベル＋矢印）
  // クリック可否は権限で決まる（中澤・浦林、または代理ログイン中の田中さん）
  const clickable = isStatusApprover();
  const dealId = d.deal_id || "";
  const manualStage = (d.manual_progress && d.manual_progress.stage) || 0;
  const steps = stages.map((s) => {
    const done = !!doneMap[s.n];
    const isUnknown = !done && !!unknownMap[s.n];
    const cur = s.n === reached && !isWon && lostAt == null;
    const isLost = lostAt != null && s.n === lostAt;
    let cls = done ? "done" : "todo";
    if (isUnknown) cls = "todo unknown";
    if (cur && done) cls += " cur";
    if (isReview && s.n === 1) cls = "done review";
    if (isLost) cls = "lost";
    if (s.n === 5 && isWon) cls = "won";
    if (clickable && dealId) cls += " clickable";
    if (manualStage === s.n) cls += " manual";
    const mark = isLost ? "×" : ((isReview && s.n === 1) || isUnknown ? "?" : (done ? "✓" : s.n));
    // クリッカブルなら button、そうでなければ div
    if (clickable && dealId) {
      const title = `「${s.label}」まで進める（クリック）／解除は同じ◯をもう一度クリック`;
      return `<button type="button" class="np-step ${cls}" data-stage="${s.n}" title="${esc(title)}"><span class="np-dot">${mark}</span><span class="np-step-label">${s.label}</span></button>`;
    }
    return `<div class="np-step ${cls}"><span class="np-dot">${mark}</span><span class="np-step-label">${s.label}</span></div>`;
  }).join('<span class="np-arrow">›</span>');

  // ステータス見出し
  const statusBadge = `<span class="np-status np-${npStatusLabel(d.status || "").replace(/[()]/g, "")}">${esc(npStatusLabel(d.status) || "-")}</span>`;
  const review = d.needs_review ? '<span class="np-review">要確認あり</span>' : "";
  const reviewNote = isReview
    ? '<div class="np-review-note">AIが商談から「開始スケジュール」「今月申込可否」を明確に読み取れませんでした。判定は保留（集計対象外）です。文字起こしを確認のうえ、誤りがあれば実績の日次データ確認から修正できます。</div>'
    : "";
  const pendingNote = isPending10day
    ? `<div class="np-pending-note">初回商談その場で再商談が設定できませんでした。<b>${esc(d.auto_lose_deadline || "")}</b> までに再商談が設定されなければ、自動的に失注になります（残り猶予中）。</div>`
    : "";
  // 再商談の日程は入っているが、まだ実施していない（＝KPIの再商談実施には計上されない）
  const scheduledNote = (hasNext && !d.re)
    ? `<div class="np-scheduled-note">再商談は<b>${esc(f.next_meeting_date || "予定日未取得")}</b>に予定されています。<b>実施後に判定</b>すると「再商談実施」として計上されます（予定だけでは計上されません）。</div>`
    : "";

  // 詳細行
  const jm = f.judgment_month ? f.judgment_month.replace("-", "年") + "月" : "—";
  const nextInfo = f.next_meeting_scheduled
    ? `<span class="np-next-yes">設定済み${f.next_meeting_date ? "（" + esc(f.next_meeting_date) + "）" : ""}</span>`
    : (String(d.status || "").startsWith("失注")
        ? `<span class="np-next-no">未設定（次につながらず失注）</span>`
        : isPending10day
          ? `<span class="np-next-pending">未設定（${esc(d.auto_lose_deadline || "")} までの猶予中）</span>`
          : `<span class="np-next-no">未設定</span>`);
  let rows = "";
  // 初回商談の判定データが無い場合でも、項目行は常に出す（値は「不明」「未設定」等の既定表示）。
  // ただし編集ができるのは、AI判定で初回商談イベントが1件でもある（f.id が存在する）ときのみ。
  // 未判定案件を編集したい場合は、右上の「再判定」を実行してから編集する。
  {
    // AI判定が無くても、承認アカウントなら編集できる（保存時に空のイベントを自動生成する）。
    const editable = clickable && dealId;
    const SCHEDULE_OPTS = ["今月", "来月", "再来月", "それ以降", "未定", "不明"];
    const APPLY_OPTS = ["今月", "来月", "該当なし", "不明"];
    // data-eid は無い場合もある（AI未判定 → 保存時に生成）。空文字で埋めておく。
    const eid = f.id || "";
    const selectOf = (name, opts, current) => {
      const options = opts.map((v) => `<option value="${esc(v)}"${v === current ? " selected" : ""}>${esc(v)}</option>`).join("");
      const empty = current && !opts.includes(current) ? `<option value="${esc(current)}" selected>${esc(current)}</option>` : "";
      return `<select class="np-edit-sel" data-field="${name}" data-eid="${eid}">${empty}${options}</select>`;
    };
    const scheduleCell = editable
      ? selectOf("schedule_choice", SCHEDULE_OPTS, f.schedule_choice || "")
      : esc(f.schedule_choice || "不明");
    const applyCell = editable
      ? selectOf("apply_timing", APPLY_OPTS, f.apply_timing || "")
      : (f.apply_timing ? `${esc(f.apply_timing)}判断` : "不明");
    // 再商談の予定日：日付入力＋「未設定に戻す」ボタン
    let nextCell;
    if (editable) {
      const dateVal = f.next_meeting_date ? String(f.next_meeting_date).slice(0, 10) : "";
      nextCell = `<span class="np-next-edit">` +
        `<input type="date" class="np-edit-date" data-field="next_meeting_date" data-eid="${eid}" value="${esc(dateVal)}" />` +
        (f.next_meeting_scheduled
          ? `<button type="button" class="np-next-clear" data-eid="${eid}" title="再商談を未設定に戻す">未設定に戻す</button>`
          : `<span class="np-next-hint">日付を入れると「設定済み」になります</span>`) +
        `</span>`;
    } else {
      nextCell = nextInfo;
    }
    // 手動編集の印
    const editedBy = f.judgment_month_basis && String(f.judgment_month_basis).includes("手動編集") ? '<span class="np-edited">✎ 手動</span>' : "";
    // AIが初回商談を判定できていない案件では、詳細行の上に注記を出す（編集は可能）
    const noJudgeHint = !d.first
      ? (clickable
          ? `<div class="np-hint">この会社の初回商談はまだAI判定されていません。下の項目を編集すると、そのまま手動で判定内容を登録できます。</div>`
          : `<div class="np-hint">この会社の初回商談はまだAI判定されていません。<b>右上の「再判定」</b>を実行すると、下の項目に判定結果が入ります。</div>`)
      : "";
    rows = noJudgeHint +
      `<div class="np-row"><span class="np-k">ご利用開始スケジュール</span><span class="np-v">${scheduleCell}</span></div>` +
      `<div class="np-row"><span class="np-k">今月中の申込可否</span><span class="np-v">${applyCell}</span></div>` +
      `<div class="np-row"><span class="np-k">判断月（KPI計上）</span><span class="np-v" id="npJmCell">${jm}${editedBy}${f.judgment_month_basis ? `<span class="np-basis-inline">${esc(f.judgment_month_basis)}</span>` : ""}</span></div>` +
      `<div class="np-row"><span class="np-k">次回商談(再商談)</span><span class="np-v">${nextCell}</span></div>` +
      (d.latest_result ? `<div class="np-row"><span class="np-k">再商談の結果</span><span class="np-v">${esc(d.latest_result)}</span></div>` : "");
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
    reviewNote +
    pendingNote +
    scheduledNote +
    `<div class="np-body">${rows}</div>` +
    reasonsBlock;
  const rr = document.getElementById("npReRun");
  if (rr && box._ctx) rr.addEventListener("click", () => runNewProcess(box._ctx.botIds, box._ctx.companyName, box._ctx.pk, box._ctx.ms));

  // ステッパーの◯クリックで進捗を進める（承認アカウントのみ・デイルIDが必要）
  if (clickable && dealId) {
    box.querySelectorAll(".np-step.clickable").forEach((el) => {
      el.addEventListener("click", async () => {
        const clickedStage = Number(el.dataset.stage);
        // 同じ◯を再度クリック → その進捗を1つ手前に戻す（4を押した状態で4を再度押すと3へ）。
        // 1で1を押した場合は解除（AI判定に戻す）。
        const cur = (d.manual_progress && d.manual_progress.stage) || 0;
        let nextStage = clickedStage === cur ? clickedStage - 1 : clickedStage;
        if (nextStage <= 0) nextStage = null;
        // 「受注」に進めるときは、事故防止のため確認ダイアログを出す。
        // （5→4に戻すときは確認不要。5をクリックして5になる＝新規で受注扱いにするときだけ確認）
        if (nextStage === 5) {
          const companyName = (box._ctx && box._ctx.companyName) || dealId;
          if (!confirm(`「${companyName}」を『受注』ステータスに変更します。\n\n実績サマリー（月次の受注件数・転換率）に即座に反映されます。\n本当に受注しましたか？`)) {
            return;
          }
        }
        // 二重クリック防止
        box.querySelectorAll(".np-step.clickable").forEach((x) => (x.disabled = true));
        try {
          const r = await fetch(`/api/deals/${encodeURIComponent(dealId)}/manual-progress`, {
            method: "PUT", headers: { "content-type": "application/json" },
            body: JSON.stringify({ stage: nextStage }),
          });
          const dd = await r.json();
          if (!r.ok) throw new Error(dd.error || "進捗の変更に失敗しました");
          // ローカルの d を更新
          d.manual_progress = nextStage == null ? null : { stage: nextStage, updated_by: dd.updated_by || "" };
          // ステージ変更でサーバー側が案件ステータスも連動更新している場合、
          // 判定ブロック・案件カード・右上バッジをまとめて反映する。
          if (dd.status) d.status = dd.status;
          try {
            await refreshNewProcMap();
            const st = await (await fetch("/api/deal-status", { cache: "no-store" })).json();
            dealStatuses = st.statuses || {};
          } catch {}
          renderNewProcess(box, d);
          renderList();
          const badgeEl = document.getElementById("dealStBadge");
          if (badgeEl && box._ctx) {
            const stNow = statusOf(box._ctx.pk);
            badgeEl.textContent = stNow;
            badgeEl.className = `status-badge st-${stNow}`;
          }
        } catch (e) {
          alert(e.message);
          box.querySelectorAll(".np-step.clickable").forEach((x) => (x.disabled = false));
        }
      });
    });
  }

  // 判定詳細のプルダウン（スケジュール／申込可否／再商談日）の変更を保存する。
  // AI判定がまだ無い（f.id が空）場合は、その場で空のイベントを作ってから編集を適用する。
  if (clickable && dealId) {
    // イベントIDを確実に用意する（無ければ作る）
    const ensureEventId = async () => {
      if (f && f.id) return f.id;
      const r = await fetch(`/api/deals/${encodeURIComponent(dealId)}/first-event`, { method: "POST" });
      const dd = await r.json();
      if (!r.ok) throw new Error(dd.error || "初回商談イベントの作成に失敗しました");
      // ローカル状態に空の first を用意（IDだけ埋める）
      d.first = d.first || {};
      d.first.id = dd.event_id;
      return dd.event_id;
    };
    // 保存＋UI全体反映の共通処理
    const saveField = async (patch) => {
      const jmCell = document.getElementById("npJmCell");
      if (jmCell) jmCell.innerHTML = '<span class="np-saving">保存中…</span>';
      box.querySelectorAll(".np-edit-sel, .np-edit-date, .np-next-clear").forEach((x) => (x.disabled = true));
      try {
        const eventId = await ensureEventId();
        const r = await fetch(`/api/deal-events/${encodeURIComponent(eventId)}/manual-fields`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        });
        const dd = await r.json();
        if (!r.ok) throw new Error(dd.error || "変更に失敗しました");
        // ローカルの d.first を最新化
        for (const [k, v] of Object.entries(patch)) d.first[k] = v;
        d.first.judgment_month = dd.judgment_month;
        d.first.judgment_month_basis = dd.judgment_month_basis;
        if (dd.status) d.status = dd.status;
        // 全UIに反映（判定ブロック→newProcMap→dealStatuses→案件カード→右上バッジ）
        try {
          await refreshNewProcMap();
          const st = await (await fetch("/api/deal-status", { cache: "no-store" })).json();
          dealStatuses = st.statuses || {};
        } catch {}
        renderNewProcess(box, d);
        renderList();
        const badgeEl = document.getElementById("dealStBadge");
        if (badgeEl && box._ctx) {
          const stNow = statusOf(box._ctx.pk);
          badgeEl.textContent = stNow;
          badgeEl.className = `status-badge st-${stNow}`;
        }
      } catch (e) {
        alert(e.message);
        box.querySelectorAll(".np-edit-sel, .np-edit-date, .np-next-clear").forEach((x) => (x.disabled = false));
      }
    };
    // プルダウン変更
    box.querySelectorAll(".np-edit-sel").forEach((sel) => {
      sel.addEventListener("change", () => saveField({ [sel.dataset.field]: sel.value }));
    });
    // 日付入力（変更後にフォーカスを外したときに保存）
    box.querySelectorAll(".np-edit-date").forEach((dt) => {
      dt.addEventListener("change", () => {
        const v = dt.value;
        // 空欄クリア＝未設定に戻す扱い
        if (!v) saveField({ next_meeting_date: null, next_meeting_scheduled: false });
        else saveField({ next_meeting_date: v, next_meeting_scheduled: true });
      });
    });
    // 「未設定に戻す」ボタン
    box.querySelectorAll(".np-next-clear").forEach((btn) => {
      btn.addEventListener("click", () => saveField({ next_meeting_date: null, next_meeting_scheduled: false }));
    });
  }
}

// gBizINFOで複数候補が出て「選択が必要」な案件の印。accounts.profile.gbiz_pending に保存する。
function markGbizNeedsPick(pk, candidates) {
  const acc = accountsMap[pk] || { key: pk };
  // 実プロフィールが既にあるなら上書きしない（選択待ちは未取得のときだけ）
  if (acc.profile && !acc.profile.gbiz_pending && (acc.profile.industry || acc.profile.location || acc.profile.employees)) return;
  acc.profile = { gbiz_pending: true, gbiz_candidates: candidates || [] };
  accountsMap[pk] = acc;
  // サーバーにも保存して、リロード後もカードに印が出るようにする
  fetch(`/api/accounts/${encodeURIComponent(pk)}`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ profile: acc.profile }),
  }).catch(() => {});
}
function clearGbizNeedsPick(pk) {
  const acc = accountsMap[pk];
  if (acc && acc.profile && acc.profile.gbiz_pending) {
    // 確定時は confirm 側で実プロフィールが入るため、ここではローカルの印だけ消す
    delete acc.profile.gbiz_pending;
  }
}

function renderProfile(account) {
  const body = document.getElementById("profBody");
  if (!body) return;
  const acc = accountsMap[primaryOf(account)];
  const p = acc && acc.profile;
  if (!p || p.gbiz_pending || !(p.industry || p.employees || p.hiring || p.founded || p.location || p.business)) {
    body.innerHTML = '<div class="empty-state">会社情報を自動で検索しています…見つからない場合は「gBizINFOで会社を検索」を押すか、サイトURLから取得してください。</div>';
    return;
  }
  const cell = (label, val) => (val ? `<div class="prof-cell"><div class="prof-k">${label}</div><div class="prof-v">${esc(val)}</div></div>` : "");
  // 業界・設立・本社をWeb検索で補完した場合、その項目に「Web検索」バッジを付ける
  const bs = p.basics_source;
  const wasFilledBy = (fieldName) => bs && Array.isArray(bs.filled) && bs.filled.includes(fieldName);
  const cellWithSrc = (label, val, fieldName) => {
    if (!val) return "";
    const badge = wasFilledBy(fieldName)
      ? ` <span class="prof-empsrc">（${esc(bs.source_name || "Web検索")}）</span>`
      : "";
    return `<div class="prof-cell"><div class="prof-k">${label}</div><div class="prof-v">${esc(val)}${badge}</div></div>`;
  };
  // 従業員数に出典・確信度のバッジを添える
  let empVal = p.employees || "";
  if (empVal && p.employees_source) {
    const src = p.employees_source;
    const conf = src.confidence === "high" ? "" : src.confidence === "medium" ? " ⚠" : " ⚠要確認";
    const label = src.source_name ? `${src.source_name}${conf}` : `出典あり${conf}`;
    empVal = `${esc(p.employees)} <span class="prof-empsrc">（${esc(label)}）</span>`;
  }
  const empCell = empVal ? `<div class="prof-cell"><div class="prof-k">従業員数</div><div class="prof-v">${empVal}</div></div>` : "";
  const badge = p.source === "gBizINFO" ? '<span class="prof-src-badge">gBizINFO</span>' : '<span class="prof-src-badge prof-src-ai">AI取得</span>';
  // リセットボタン：承認アカウントだけに表示。プロフィール一切を消して未取得状態に戻す。
  const resetBtn = isStatusApprover() ? '<button type="button" class="prof-reset-btn" id="profResetBtn" title="会社プロフィールをリセットして未取得状態に戻す">リセット</button>' : "";
  const pk = primaryOf(account);
  body.innerHTML =
    `<div class="prof-src-line">${badge}${p.corporate_number ? `<span class="prof-corpnum">法人番号 ${esc(p.corporate_number)}</span>` : ""}${resetBtn}</div>` +
    `<div class="prof-grid">` +
    cellWithSrc("業界", p.industry, "industry") + empCell + cell("採用予定", p.hiring) +
    cellWithSrc("設立", p.founded, "founded") + cell("資本金", p.capital) + cell("代表者", p.representative) + cellWithSrc("本社", p.location, "location") +
    `</div>` +
    (p.business ? `<div class="prof-biz">事業内容：${esc(p.business)}${p.source === "gBizINFO" ? "" : ' <span class="prof-note">（AI自動取得・要確認）</span>'}</div>` : "") +
    (p.employees_source && p.employees_source.source_url ? `<div class="prof-empurl">従業員数の出典：<a href="${esc(p.employees_source.source_url)}" target="_blank" rel="noopener">${esc(p.employees_source.source_url)} ↗</a>${p.employees_source.as_of ? "（" + esc(p.employees_source.as_of) + "）" : ""}</div>` : "") +
    (bs && bs.source_url ? `<div class="prof-empurl">業界・設立の出典：<a href="${esc(bs.source_url)}" target="_blank" rel="noopener">${esc(bs.source_url)} ↗</a></div>` : "") +
    (acc.site_url ? `<div class="prof-site"><a href="${esc(acc.site_url)}" target="_blank" rel="noopener">サイトを開く ↗</a></div>` : "");
  // リセットボタンの動作
  const rb = document.getElementById("profResetBtn");
  if (rb) {
    rb.addEventListener("click", async () => {
      if (!confirm("この案件の会社プロフィール（業界・従業員数・住所など）を全て削除して未取得状態に戻します。\n\nこの操作は元に戻せません。実行しますか？")) return;
      rb.disabled = true; rb.textContent = "リセット中…";
      try {
        const r = await fetch(`/api/accounts/${encodeURIComponent(pk)}/profile-reset`, { method: "POST" });
        const dd = await r.json();
        if (!r.ok) throw new Error(dd.error || "リセットに失敗しました");
        // ローカル状態からプロフィールを消し、UIを更新
        if (accountsMap[pk]) { accountsMap[pk].profile = null; accountsMap[pk].site_url = ""; }
        renderProfile(account);
        renderList();
      } catch (e) {
        alert(e.message);
        rb.disabled = false; rb.textContent = "リセット";
      }
    });
  }
}

// 案件カードに新プロセスの判定を出すための状態マップ（正規化会社名キー → deal）
let newProcMap = {};
let newProcList = []; // 部分一致照合用に全dealを保持
async function refreshNewProcMap() {
  try {
    const deals = await (await fetch("/api/deals", { cache: "no-store" })).json();
    newProcMap = {};
    newProcList = deals || [];
    // listDealsは updated_at DESC（新しい順）で返るが、同じ会社名で複数のdealが
    // 存在する場合に古い方で上書きしないよう、既にある場合は新しい方（更新日時が新しい方）を優先する。
    for (const d of deals || []) {
      const k = normName(d.company_name);
      if (!k) continue;
      const existing = newProcMap[k];
      if (!existing || new Date(d.updated_at || 0) > new Date(existing.updated_at || 0)) {
        newProcMap[k] = d;
      }
    }
  } catch { newProcMap = {}; newProcList = []; }
}
// 会社名から新プロセスのdealを引く。
// 同じ会社で複数のdealレコード（表記ゆれ等）が残っていても、常に「最も新しく更新された」
// 一致レコードを返す。これで再判定直後（updated_atが最新になる）に必ず反映される。
function lookupNewProc(name) {
  const k = normName(name);
  if (!k) return null;
  let best = null;
  const consider = (d) => {
    if (!best || new Date(d.updated_at || 0) > new Date(best.updated_at || 0)) best = d;
  };
  // まず完全一致（正規化名）。無ければ部分一致（どちらかがもう一方を含む）。
  for (const d of newProcList) {
    if (normName(d.company_name) === k) consider(d);
  }
  if (best) return best;
  for (const d of newProcList) {
    const k2 = normName(d.company_name);
    if (k2 && (k2.includes(k) || k.includes(k2))) consider(d);
  }
  return best;
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
  wireNpSelect();
  renderList();
  showProfileNotification();
  // 他の画面（実績など）から ?company=... で開かれた場合、その案件を自動で開く
  try {
    const params = new URLSearchParams(location.search);
    const want = params.get("company");
    if (want) {
      const names = Object.keys(groups);
      const hit = names.find((n) => n === want)
        || names.find((n) => normName(n) === normName(want))
        || names.find((n) => { const a = normName(n), b = normName(want); return a && b && (a.includes(b) || b.includes(a)); });
      if (hit) selectDeal(hit);
      else {
        const dp = $("dealDetail");
        if (dp) dp.innerHTML = `<div class="empty-state">「${esc(want)}」に一致する案件が見つかりませんでした。左の一覧から選んでください。</div>`;
      }
    }
  } catch {}
  renderBackLink();
}

// 別の画面から遷移してきたときに「戻る」リンクを出す
function renderBackLink() {
  const params = new URLSearchParams(location.search);
  const from = params.get("from");
  if (!from) return;
  const labels = { report: "実績", history: "商談履歴", apo: "アポ振り分け" };
  const bar = document.querySelector(".topbar") || document.querySelector(".main");
  if (!bar || document.getElementById("dealBackLink")) return;
  const a = document.createElement("button");
  a.id = "dealBackLink";
  a.className = "deal-back";
  a.type = "button";
  a.innerHTML = `← ${esc(labels[from] || "前の画面")}に戻る`;
  a.addEventListener("click", () => {
    // 直前がkinbot内なら履歴を戻す（スクロール位置や絞り込みが保たれる）
    if (document.referrer && document.referrer.startsWith(location.origin)) history.back();
    else location.href = (labels[from] ? from : "report") + ".html";
  });
  bar.prepend(a);
}

// 「選択して判定」モードの配線
function wireNpSelect() {
  const sb = $("npSelectBtn");
  if (sb && !sb._wired) { sb._wired = true; sb.addEventListener("click", () => { npSelectMode = true; npSelected.clear(); updateNpSelectBar(); renderList(); }); }
  const cancel = $("npSelectCancel");
  if (cancel && !cancel._wired) { cancel._wired = true; cancel.addEventListener("click", () => { npSelectMode = false; npSelected.clear(); updateNpSelectBar(); renderList(); }); }
  const clr = $("npSelectClear");
  if (clr && !clr._wired) { clr._wired = true; clr.addEventListener("click", () => { npSelected.clear(); updateNpSelectBar(); renderList(); }); }
  const all2 = $("npSelectAll");
  if (all2 && !all2._wired) { all2._wired = true; all2.addEventListener("click", () => { selectAllVisibleNp(); }); }
  const run = $("npSelectRun");
  if (run && !run._wired) { run._wired = true; run.addEventListener("click", runSelectedNp); }
}

function updateNpSelectBar() {
  const bar = $("npSelectBar");
  if (bar) bar.hidden = !npSelectMode;
  const cnt = $("npSelectCount");
  if (cnt) cnt.textContent = `${npSelected.size}件選択中`;
  const run = $("npSelectRun");
  if (run) run.disabled = npSelected.size === 0;
  const sb = $("npSelectBtn");
  if (sb) sb.style.display = npSelectMode ? "none" : "";
}

// 表示中の案件をすべて選択
function selectAllVisibleNp() {
  const names = Object.keys(groups);
  const q = ($("fSearch").value || "").trim().toLowerCase();
  const searching = !!q || !!(($("fFrom") && $("fFrom").value) || ($("fTo") && $("fTo").value));
  const visible = (selectedRep && !showAll && !searching)
    ? names.filter((a) => repInfo(a).key === selectedRep)
    : names;
  for (const a of visible) npSelected.add(a);
  updateNpSelectBar();
  renderList();
}

// 選択した案件をまとめて判定
async function runSelectedNp() {
  const targets = [...npSelected];
  if (!targets.length) return;
  const status = $("npSelectStatus");
  const run = $("npSelectRun");
  if (run) run.disabled = true;
  let doneAccounts = 0, okBots = 0, failBots = 0;
  for (const a of targets) {
    const ms = groups[a] || [];
    const botIds = ms.map((m) => m.bot_id).filter(Boolean);
    if (status) status.textContent = `判定中… 案件 ${doneAccounts + 1}/${targets.length}（${displayName(a)}）`;
    const bulkProvider = ($("npBulkModel") && $("npBulkModel").value) || "";
    for (const bid of botIds) {
      try {
        const r = await fetch("/api/meetings/" + encodeURIComponent(bid) + "/extract", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: bulkProvider }),
        });
        if (r.ok) okBots++; else failBots++;
      } catch { failBots++; }
    }
    doneAccounts++;
  }
  if (status) status.textContent = `完了：${doneAccounts}件の案件を判定（商談 成功${okBots}${failBots ? " / 失敗" + failBots : ""}）`;
  // 状態を更新
  try { await refreshNewProcMap(); } catch {}
  try { renderList(); } catch {}
  if (run) run.disabled = false;
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
  // 新プロセスの案件（deals）側で、同じ会社名の重複レコードができていないかも合わせて統合する
  let mergedDeals = 0;
  try {
    const r = await fetch("/api/deals/merge-duplicates", { method: "POST" });
    if (r.ok) { const d = await r.json(); mergedDeals = d.merged || 0; }
  } catch {}
  await refreshNewProcMap();
  selectedRep = null; showAll = false; current = null;
  renderList();
  setSt(`${count}組をまとめました${mergedDeals ? `（新プロセスの重複案件も${mergedDeals}件統合）` : ""}`);
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
  // 新プロセスの判定（会社名で照合。完全一致→部分一致で緩く引く）
  const np = lookupNewProc(displayName(a)) || lookupNewProc(a);
  const npBadge = np && np.status
    ? `<span class="np-card-badge np-${npStatusLabel(np.status).replace(/[()]/g, "")}">${esc(npStatusLabel(np.status))}</span>`
    : `<span class="np-card-badge np-none">未判定</span>`;
  const checked = npSelected.has(a);
  // gBizINFOで複数候補 → 会社の選択待ち
  const accForBadge = accountsMap[primaryOf(a)];
  const gbizPick = accForBadge && accForBadge.profile && accForBadge.profile.gbiz_pending
    ? '<span class="gbiz-pick-badge">企業選択が必要</span>' : "";
  const card = document.createElement("div");
  card.className = "deal-card" + (a === current ? " active" : "") + (npSelectMode ? " selectable" : "") + (checked ? " selected" : "");
  card.innerHTML =
    (npSelectMode ? `<span class="np-check">${checked ? "✓" : ""}</span>` : "") +
    `<div class="deal-name">${esc(displayName(a))} ${kindBadge}${gbizPick}<span class="status-badge st-${st}">${st}</span></div>` +
    `<div class="deal-meta"><span>${ms.length}件</span><span>${esc(last.owner_name || last.owner || "")}</span></div>` +
    `<div class="deal-sub"><span class="np-card-label">新プロセス:</span> ${npBadge} ・ 最終 ${fmtDate(last.created_at)}</div>`;
  card.addEventListener("click", () => {
    if (npSelectMode) {
      if (npSelected.has(a)) npSelected.delete(a); else npSelected.add(a);
      updateNpSelectBar();
      renderList();
    } else {
      selectDeal(a);
    }
  });
  return card;
}

function renderList() {
  buildGroups();
  const el = $("dealList");
  // プロダクト（DOC/MOCHICA）タブの絞り込み
  const inProduct = (a) => {
    if (!window.kbProduct) return true;
    const ms = groups[a] || [];
    const last = ms[ms.length - 1] || {};
    return window.kbProduct.matches(last.owner_name || last.owner);
  };
  const names = Object.keys(groups).filter(a => inProduct(a)).sort((a, b) => {
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

// ===== 事前ブリーフ =====
async function loadBrief(company, botIds, regen, peek) {
  const box = document.getElementById("briefBox");
  const qaBox = document.getElementById("briefQaBox");
  const st = document.getElementById("briefStatus");
  const btn = document.getElementById("briefGen");
  if (!box) return;
  if (!peek) {
    box.innerHTML = '<div class="empty-state">過去の商談からブリーフを作成中…（10〜20秒ほど）</div>';
    if (qaBox) qaBox.innerHTML = '<div class="empty-state">作成中…</div>';
    if (btn) btn.disabled = true;
    if (st) st.textContent = "";
  }
  try {
    const r = await fetch("/api/deals/brief", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ company, botIds: Array.isArray(botIds) ? botIds : [], regen: !!regen, peek: !!peek }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "作成に失敗しました");
    if (!d.brief) { if (btn) btn.disabled = false; return; } // peekでキャッシュ無し
    renderBrief(d);
    if (btn) { btn.disabled = false; btn.textContent = "再作成"; }
  } catch (e) {
    if (!peek) {
      box.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
      if (qaBox) qaBox.innerHTML = '<div class="empty-state">—</div>';
    }
    if (btn) btn.disabled = false;
  }
}
function renderBrief(d) {
  const b = d.brief || {};
  const box = document.getElementById("briefBox");
  const qaBox = document.getElementById("briefQaBox");
  // 商談準備カード（4枚）
  if (box) {
    const card = (icon, title, items, cls) =>
      `<div class="brief-card ${cls}"><div class="brief-card-h">${icon} ${title}</div>` +
      (items && items.length ? `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : '<div class="brief-empty">記録なし</div>') +
      `</div>`;
    let html = '<div class="brief-grid">';
    html += card("📌", "前回までの要点", b.recap, "bc-recap");
    html += card("📝", "未解決の宿題", b.open_items, "bc-open");
    html += card("⚠️", "相手の懸念", b.concerns, "bc-concern");
    html += card("🎯", "今日詰めるべき点", b.focus, "bc-focus");
    html += "</div>";
    if (d.generated_at) {
      const dt = new Date(d.generated_at);
      const when = isNaN(dt.getTime()) ? "" : ` ・ ${dt.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}時点`;
      html += `<div class="brief-meta">${d.based_on || "?"}件の商談から作成${when}</div>`;
    }
    box.innerHTML = html;
  }
  // 想定問答
  if (qaBox) {
    if (b.qa && b.qa.length) {
      qaBox.innerHTML = b.qa.map((qa) =>
        `<details class="brief-qa-item"><summary>Q. ${esc(qa.q)}</summary><div class="brief-qa-a">A. ${esc(qa.a)}</div></details>`
      ).join("");
    } else {
      qaBox.innerHTML = '<div class="empty-state">想定問答はありません</div>';
    }
  }
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
    `<div class="deal-head-top">` +
    (isStatusApprover()
      ? `<h2 id="dealTitleH2">${esc(displayName(account))}<button type="button" class="deal-name-edit" id="dealNameEditBtn" title="会社名を編集">✎</button></h2>`
      : `<h2>${esc(displayName(account))}</h2>`) +
    (dealKindOf(account) ? `<span class="kind-badge ${{"過去失注":"kind-lost","コールド":"kind-cold","ユーザーフォロー":"kind-follow","社内MTG":"kind-internal"}[dealKindOf(account)] || "kind-normal"}">${dealKindOf(account)}</span>` : "") +
    `<div class="deal-status-pick"><span class="status-badge st-${statusOf(account)}" id="dealStBadge">${statusOf(account)}</span>` +
    `<select id="dealStSel">${STATUS_LIST.map((s) => `<option value="${s}" ${statusOf(account) === s ? "selected" : ""}>${s}</option>`).join("")}<option value="__auto">AIに任せる</option></select></div></div>` +
    `<div class="deal-head-meta"><span id="dealOwnerWrap" class="deal-owner-wrap"></span> ・ ${ms.length}回の商談` +
    (dealStatuses[pk] && dealStatuses[pk].manual ? ' ・ <span class="st-manual">手動設定</span>' : ' ・ <span class="st-auto">AI自動</span>') +
    `</div>` +
    (statusOf(account) === "失注" && lastLostReason(ms) ? `<div class="lost-reason">AI判定の失注理由: ${esc(lastLostReason(ms))}</div>` : "") +
    `</div>` +
    // ▼ 画面ごと切り替えるタブ
    `<div class="deal-tabs" id="dealTabs">` +
    `<button class="deal-tab active" data-dtab="judge">📊 判定</button>` +
    `<button class="deal-tab" data-dtab="brief">🎯 商談準備</button>` +
    `<button class="deal-tab" data-dtab="qa">💬 想定問答</button>` +
    `<button class="deal-tab" data-dtab="profile">🏢 会社プロフィール</button>` +
    `<button class="deal-tab" data-dtab="proposals"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:3px"><path d="M3 2h7l4 4v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" fill="#1d9e75"/><path d="M10 2v4h4" fill="#5DCAA5"/></svg>提案資料</button>` +
    `<button class="deal-tab" data-dtab="salesforce"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:3px"><path d="M8 1a7 7 0 110 14A7 7 0 018 1z" fill="#0d5b47"/><path d="M5.5 8.5l2 2 3.5-4" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Salesforce</button>` +
    `<button class="deal-tab" data-dtab="flow"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:3px"><rect x="1" y="1" width="14" height="14" rx="2" fill="#0d5b47"/><rect x="3" y="4" width="10" height="1.5" rx=".5" fill="#5DCAA5"/><rect x="3" y="7" width="7" height="1.5" rx=".5" fill="#5DCAA5"/><rect x="3" y="10" width="9" height="1.5" rx=".5" fill="#5DCAA5"/></svg>商談の流れ</button>` +
    `</div>` +
    // 判定（既定タブ）
    `<div class="deal-tabpane" data-dtab="judge">` +
    `<section class="deal-sec newproc-sec"><div class="deal-sec-h">📊 新プロセスの判定 <select class="judge-model" id="judgeModel" title="判定に使うAIモデル（チーム共通の設定）"><option value="">モデル: 既定(Gemini)</option><option value="anthropic">モデル: Claude</option><option value="gemini">モデル: Gemini</option></select></div><div id="newProcBox"><div class="empty-state">読み込み中…</div></div></section>` +
    `</div>` +
    // 商談準備（事前ブリーフ）
    `<div class="deal-tabpane" data-dtab="brief" hidden>` +
    `<section class="deal-sec brief-sec"><div class="deal-sec-h">🎯 商談準備（事前ブリーフ）<button class="btn ghost brief-gen-btn" id="briefGen">再作成</button><span class="brief-status" id="briefStatus"></span></div>` +
    `<div id="briefBox"><div class="empty-state">読み込み中…</div></div></section>` +
    `</div>` +
    // 想定問答
    `<div class="deal-tabpane" data-dtab="qa" hidden>` +
    `<section class="deal-sec brief-qa-sec"><div class="deal-sec-h">💬 想定問答</div><div id="briefQaBox"><div class="empty-state">読み込み中…</div></div></section>` +
    `</div>` +
    // 会社プロフィール
    `<div class="deal-tabpane" data-dtab="profile" hidden>` +
    `<section class="deal-sec deal-profile"><div class="deal-sec-h">🏢 会社プロフィール</div>` +
    `<div class="gbiz-box"><div class="gbiz-row"><button class="btn" id="gbizSearch">gBizINFOで会社を検索</button><span class="gbiz-hint">会社名から公式の企業情報（業界・所在地・設立など）を取得します</span></div><div id="gbizCandidates"></div></div>` +
    `<details class="prof-manual"><summary>サイトURLから取得（手動）</summary>` +
    `<div class="prof-url"><textarea id="profUrl" rows="2" placeholder="企業サイトURL（複数可・改行かカンマで区切り。空でも会社名でWeb検索します）"></textarea><button class="btn" id="profGet">取得</button></div></details>` +
    `<div class="prof-status" id="profStatus"></div>` +
    `<div id="profBody"></div></section>` +
    `</div>` +
    // 提案資料
    `<div class="deal-tabpane" data-dtab="proposals" hidden>` +
    `<section class="deal-sec"><div class="deal-sec-h">📎 提案資料</div>` +
    `<div class="proposal-add"><input type="text" id="proposalUrl" class="proposal-url-input" placeholder="GoogleスライドのURLを貼り付け" /><button class="btn" id="proposalAddBtn">登録</button></div>` +
    `<div id="proposalList"><div class="empty-state">読み込み中…</div></div></section>` +
    `</div>` +
    // Salesforce連携
    `<div class="deal-tabpane" data-dtab="salesforce" hidden>` +
    `<section class="deal-sec"><div class="deal-sec-h"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><path d="M8 1a7 7 0 110 14A7 7 0 018 1z" fill="#0d5b47"/><path d="M5.5 8.5l2 2 3.5-4" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Salesforce 商談</div>` +
    `<div id="sfSearch" class="sf-search"><button class="btn sf-search-btn" id="sfSearchBtn">商談を検索</button></div>` +
    `<div id="sfMatches"></div>` +
    `<div id="sfLinked" style="display:none">` +
    `<div id="sfLinkedInfo" class="sf-linked-info"></div>` +
    `<div class="sf-update-form">` +
    `<div class="sf-field"><label>Stage</label><select id="sfStage" class="sf-select"></select></div>` +
    `<div class="sf-field"><label>Next Step</label><input type="text" id="sfNextStep" class="sf-input" placeholder="次のアクション" /></div>` +
    `<div class="sf-field"><label>ログ / メモ</label><textarea id="sfLog" class="sf-textarea" rows="3" placeholder="商談メモを入力"></textarea></div>` +
    `<button class="btn" id="sfUpdateBtn">Salesforceを更新</button>` +
    `</div></div></section>` +
    `</div>` +
    // 商談の流れ
    `<div class="deal-tabpane" data-dtab="flow" hidden>` +
    `<section class="deal-sec"><div class="deal-sec-h">🗂 商談の流れ</div><div class="deal-timeline" id="dealTimeline"></div></section>` +
    `</div>`;

  // タブ切り替え（画面ごと）
  const dealTabs = document.getElementById("dealTabs");
  if (dealTabs) {
    dealTabs.querySelectorAll(".deal-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const t = btn.dataset.dtab;
        dealTabs.querySelectorAll(".deal-tab").forEach((b) => b.classList.toggle("active", b === btn));
        document.querySelectorAll(".deal-tabpane").forEach((p) => (p.hidden = p.dataset.dtab !== t));
      });
    });
  }

  // ステータス変更
  // 案件のステータス変更は、中澤・浦林のみ可能。それ以外は参照のみ（プルダウンをロック）。

  // 提案資料タブの処理
  const proposalAddBtn = $("proposalAddBtn");
  if (proposalAddBtn) {
    proposalAddBtn.addEventListener("click", async () => {
      const url = $("proposalUrl").value.trim();
      if (!url) return alert("GoogleスライドのURLを入力してください");
      if (!url.includes("docs.google.com/presentation")) return alert("GoogleスライドのURLを入力してください\n例: https://docs.google.com/presentation/d/xxxxx/edit");
      proposalAddBtn.disabled = true;
      proposalAddBtn.textContent = "登録中…";
      try {
        const np = lookupNewProc(displayName(account)) || lookupNewProc(account);
        const dealId = np?.deal_id || "";
        const acc2 = accountsMap[primaryOf(account)] || {};
        const prof = acc2.profile || {};

        // スライドのタイトルをURLから推測（ブラウザからはAPIアクセスが制限される）
        const slideTitle = displayName(account) + " 提案資料";

        const r = await fetch("/api/proposals", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            slide_url: url,
            deal_id: dealId,
            title: slideTitle,
            text: "", // テキストはサーバー側で取得不可のため空。検索はメタデータで行う
            company_name: displayName(account),
            industry: prof.industry || "",
            employee_size: prof.employees || "",
            region: prof.location || "",
            result: statusOf(account),
          }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "登録失敗");
        $("proposalUrl").value = "";
        loadProposals(dealId);
      } catch (e) { alert("登録失敗: " + e.message); }
      finally { proposalAddBtn.disabled = false; proposalAddBtn.textContent = "登録"; }
    });
    // 提案資料の読み込み
    const np = lookupNewProc(displayName(account)) || lookupNewProc(account);
    loadProposals(np?.deal_id || "");
  }

  // Salesforceタブの初期化
  initSfTab(account);

  const stSel = $("dealStSel");
  if (!isStatusApprover()) {
    stSel.disabled = true;
    stSel.title = "案件のステータス変更は、中澤さん・浦林さんのみ可能です";
  }

  // 会社名の編集（承認アカウントのみ・鉛筆アイコンをクリック）
  const nameEditBtn = $("dealNameEditBtn");
  if (nameEditBtn) {
    nameEditBtn.addEventListener("click", async () => {
      const currentName = displayName(account);
      const newName = prompt("この案件の会社名を編集します。\n\n※過去の商談履歴や判定結果はそのまま保持され、案件名だけが変わります。", currentName);
      if (newName == null) return; // キャンセル
      const trimmed = newName.trim();
      if (!trimmed) { alert("会社名を空にはできません"); return; }
      if (trimmed === currentName) return; // 変更なし
      // deal_id を lookup（会社名で引く）
      const np = lookupNewProc(displayName(account)) || lookupNewProc(account);
      const dealId = np && np.deal_id;
      if (!dealId) { alert("案件が見つかりません。ページを再読み込みしてください。"); return; }
      try {
        const r = await fetch(`/api/deals/${encodeURIComponent(dealId)}/company-name`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ company_name: trimmed }),
        });
        const dd = await r.json();
        if (!r.ok) throw new Error(dd.error || "変更に失敗しました");
        // 全UIを最新化：案件カード・詳細ヘッダ・判定ブロックの照合キー等
        await refreshNewProcMap();
        try {
          const st = await (await fetch("/api/deal-status", { cache: "no-store" })).json();
          dealStatuses = st.statuses || {};
        } catch {}
        // 一覧を再取得。会社名が変わったので groups の再構築が必要。
        await load();
      } catch (e) {
        alert(e.message);
      }
    });
  }

  stSel.addEventListener("change", async (e) => {
    const v = e.target.value;
    const body = v === "__auto" ? { account: pk, auto: true } : { account: pk, status: v };
    const r = await fetch("/api/deal-status", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(d.error || "ステータスを変更できませんでした");
      selectDeal(account); // 元の表示に戻す
      return;
    }
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
  // 判定モデル（Claude/Gemini）: 現在の設定を反映し、変更したらチーム共通設定として保存
  const jm = document.getElementById("judgeModel");
  if (jm) {
    fetch("/api/judge-provider").then((r) => r.json()).then((d) => { jm.value = d.provider || ""; }).catch(() => {});
    jm.addEventListener("change", async () => {
      try {
        await fetch("/api/judge-provider", {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ provider: jm.value }),
        });
      } catch {}
    });
  }
  // 事前ブリーフ：開いたら自動表示（キャッシュがあれば即／無ければ自動生成）。ボタンは再作成。
  const briefCompany = displayName(account) || account;
  const briefBotIds = ms.map((m) => m.bot_id).filter(Boolean);
  const briefGenBtn = document.getElementById("briefGen");
  if (briefGenBtn) briefGenBtn.addEventListener("click", () => loadBrief(briefCompany, briefBotIds, true, false));
  loadBrief(briefCompany, briefBotIds, false, false);
  // 担当（アカウント単位で選択・保存）
  await renderOwnerPicker(account, last);
  const profUrl = $("profUrl"), profGet = $("profGet"), profStatus = $("profStatus");
  if (accountsMap[pk] && accountsMap[pk].site_url) profUrl.value = accountsMap[pk].site_url;
  profGet.addEventListener("click", async () => {
    const urls = (profUrl.value || "").trim();
    profGet.disabled = true; profGet.textContent = "取得中…";
    if (window.kbProgress) window.kbProgress(profStatus, { percent: null, label: urls ? "サイトとWebから会社概要を取得中…" : "会社名でWeb検索中…" });
    try {
      const r = await fetch(`/api/accounts/${encodeURIComponent(pk)}/enrich`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: urls }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "取得に失敗しました");
      accountsMap[pk] = { key: pk, site_url: d.siteUrl, official_name: d.officialName, owner: accountsMap[pk] && accountsMap[pk].owner, profile: d.profile };
      if (window.kbProgress) window.kbProgress(profStatus, { clear: true });
      renderProfile(account);
      const h = document.querySelector("#dealDetail h2"); if (h) h.textContent = displayName(account);
      renderList();
      // profileが全項目空 = 会社概要を読み取れなかった場合の明示
      const pf = d.profile || {};
      const hasAny = pf.industry || pf.employees || pf.hiring || pf.founded || pf.location || pf.business;
      const sourceNote = d.sourcesRequested
        ? `（${d.sourcesFetched || 0}/${d.sourcesRequested}サイト取得）`
        : "（Web検索のみ）";
      if (!hasAny) {
        profStatus.textContent = d.siteError
          ? `サイトを取得できませんでした（${d.siteError}）。Web検索でも情報が見つかりませんでした。`
          : `会社概要を読み取れませんでした${sourceNote}。`;
      } else {
        // マージの結果（既存を保持し、空だけ埋めた場合）を明示的に伝える
        const filled = Array.isArray(d.filledFields) ? d.filledFields : [];
        const fieldNamesJa = { official_name: "正式社名", industry: "業界", employees: "従業員数", hiring: "採用予定", founded: "設立", location: "本社", business: "事業内容", capital: "資本金", representative: "代表者", note: "備考" };
        if (filled.length > 0 && d.mergedWith) {
          const filledJa = filled.map((f) => fieldNamesJa[f] || f).join("・");
          profStatus.textContent = `既存の${d.mergedWith}情報は保持し、空だった${filled.length}項目（${filledJa}）を追加しました${sourceNote}`;
        } else if (filled.length === 0 && d.mergedWith) {
          profStatus.textContent = `既存の${d.mergedWith}情報が完全で、追加する項目はありませんでした${sourceNote}`;
        } else {
          profStatus.textContent = d.siteError ? `一部のみ取得${sourceNote}（${d.siteError}）` : `取得しました${sourceNote}`;
        }
      }
    } catch (e) {
      if (window.kbProgress) window.kbProgress(profStatus, { clear: true });
      profStatus.textContent = "失敗: " + e.message;
    } finally {
      profGet.disabled = false; profGet.textContent = "取得";
    }
  });

  // gBizINFO：会社名で候補を検索 → 候補から選ぶ → 確定
  const gbizSearch = $("gbizSearch"), gbizCandidates = $("gbizCandidates");
  const companyName = displayName(account) || account;

  // 候補を1件確定する共通処理
  const confirmGbiz = async (num) => {
    profStatus.textContent = "";
    if (window.kbProgress) window.kbProgress(profStatus, { percent: null, label: "企業情報を取得し、従業員数を検索しています…" });
    try {
      const rr = await fetch(`/api/accounts/${encodeURIComponent(pk)}/gbiz-confirm`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ corporate_number: num }),
      });
      const dd = await rr.json();
      if (!rr.ok) throw new Error(dd.error || "取得に失敗しました");
      accountsMap[pk] = { key: pk, site_url: (accountsMap[pk] && accountsMap[pk].site_url) || "", official_name: dd.officialName, owner: accountsMap[pk] && accountsMap[pk].owner, profile: dd.profile };
      if (window.kbProgress) window.kbProgress(profStatus, { clear: true });
      renderProfile(account);
      const h = document.querySelector("#dealDetail h2"); if (h) h.textContent = displayName(account);
      const emp = dd.profile && dd.profile.employees;
      profStatus.textContent = emp ? "取得しました（従業員数も取得）" : "取得しました（従業員数はWebで確認できませんでした）";
      gbizCandidates.innerHTML = "";
      // 選択が済んだので、カードの「要選択」フラグを消す
      clearGbizNeedsPick(pk);
      renderList();
    } catch (e) {
      if (window.kbProgress) window.kbProgress(profStatus, { clear: true });
      profStatus.textContent = "失敗: " + e.message;
    }
  };

  // 候補リストを描画してクリックで確定できるようにする
  const renderGbizCands = (cands, head) => {
    gbizCandidates.innerHTML =
      `<div class="gbiz-cand-head">${escapeHtmlSafe(head || "候補から正しい会社を選んでください")}（${cands.length}件）</div>` +
      cands.map((c, i) => `
        <div class="gbiz-cand" data-num="${escapeHtmlSafe(c.corporate_number)}" data-i="${i}" role="button" tabindex="0">
          <div class="gbiz-cand-main">
            <span class="gbiz-cand-name">${escapeHtmlSafe(c.name)}</span>
            ${c.status === "閉鎖" ? '<span class="gbiz-cand-closed">閉鎖</span>' : ""}
          </div>
          <div class="gbiz-cand-sub">${escapeHtmlSafe(c.location || "所在地不明")}${c.industry ? " ・ " + escapeHtmlSafe(c.industry) : ""}${c.founded ? " ・ 設立" + escapeHtmlSafe(c.founded) : ""}</div>
          <div class="gbiz-cand-num">法人番号: ${escapeHtmlSafe(c.corporate_number)}</div>
        </div>`).join("");
    gbizCandidates.querySelectorAll(".gbiz-cand").forEach((el) => {
      const pick = () => {
        gbizCandidates.querySelectorAll(".gbiz-cand").forEach((x) => x.classList.remove("selected"));
        el.classList.add("selected");
        confirmGbiz(el.dataset.num);
      };
      el.addEventListener("click", pick);
      el.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pick(); } });
    });
  };

  // gBizINFO検索を実行。auto=true のときは自動起動（候補1件なら自動確定、複数なら候補提示＋カードに印）。
  const runGbizSearch = async (auto) => {
    if (gbizSearch) { gbizSearch.disabled = true; gbizSearch.textContent = "検索中…"; }
    gbizCandidates.innerHTML = '<div class="gbiz-loading">gBizINFOを検索しています…</div>';
    try {
      const r = await fetch(`/api/gbiz/search?name=${encodeURIComponent(companyName)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "検索に失敗しました");
      const cands = d.candidates || [];
      if (!cands.length) {
        gbizCandidates.innerHTML = `<div class="gbiz-empty">「${escapeHtmlSafe(companyName)}」に一致する法人が見つかりませんでした。名称を変えて再検索するか、下の「サイトURLから取得」をお使いください。</div>`;
        clearGbizNeedsPick(pk);
        return;
      }
      // 営業中の候補が1件に絞れたら自動で確定（閉鎖のみの重複は選択に回す）
      const openCands = cands.filter((c) => c.status !== "閉鎖");
      if (openCands.length === 1) {
        gbizCandidates.innerHTML = "";
        clearGbizNeedsPick(pk);
        await confirmGbiz(openCands[0].corporate_number);
        return;
      }
      // 複数候補：選択を促す。自動起動時はカードに「要選択」の印を付ける。
      if (auto) { markGbizNeedsPick(pk, cands); renderList(); }
      renderGbizCands(cands, auto ? "複数の会社が見つかりました。正しい会社を選んでください" : "候補から正しい会社を選んでください");
    } catch (e) {
      gbizCandidates.innerHTML = `<div class="gbiz-empty">検索に失敗しました：${escapeHtmlSafe(e.message)}</div>`;
    } finally {
      if (gbizSearch) { gbizSearch.disabled = false; gbizSearch.textContent = "gBizINFOで会社を検索"; }
    }
  };

  if (gbizSearch) gbizSearch.addEventListener("click", () => runGbizSearch(false));

  // 案件を開いた瞬間に自動でgBiz検索する（ボタン不要）。
  //  - 実プロフィール取得済み → 何もしない
  //  - 選択待ち（複数候補が保存済み）→ キャッシュから候補を即表示
  //  - 未取得 → 自動検索（1件なら自動確定・複数なら候補提示＋カードに印）
  const accNow = accountsMap[pk];
  const profNow = accNow && accNow.profile;
  const hasRealProfile = profNow && !profNow.gbiz_pending && (profNow.industry || profNow.employees || profNow.location);
  if (!hasRealProfile) {
    if (profNow && profNow.gbiz_pending && Array.isArray(profNow.gbiz_candidates) && profNow.gbiz_candidates.length) {
      renderGbizCands(profNow.gbiz_candidates, "複数の会社が見つかっています。正しい会社を選んでください");
    } else {
      runGbizSearch(true);
    }
  }

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


// プロダクトタブ（全体 / DOC / MOCHICA）
(async function () {
  if (!window.kbProduct) return;
  await window.kbProduct.loadMap();
  window.kbProduct.mount(() => { try { renderList(); } catch {} });
})();

// ===== kinbot ロボからの通知（会社プロフィール未取得） =====
// 右側の詳細パネル（案件未選択時の空白エリア）に表示。案件一覧には被らない。
let profileNotifDismissed = false;

function showProfileNotification() {
  if (profileNotifDismissed) return;
  const old = document.querySelector(".kb-notif");
  if (old) old.remove();

  const myDeals = [];
  for (const [account, ms] of Object.entries(groups)) {
    if (!ms || !ms.length) continue;
    const last = ms[ms.length - 1];
    const ownerEmail = String(last.owner || "").toLowerCase();
    const ownerName = String(last.owner_name || last.rep_name || "");
    const whoText = (document.getElementById("who")?.textContent || "").trim();
    const isMyDeal = ownerEmail === currentUserEmail || ownerName === whoText;
    if (!isMyDeal) continue;
    const pk = primaryOf(account);
    const acc = accountsMap[pk];
    const prof = acc && acc.profile;
    const hasProfile = prof && (prof.industry || prof.employees || prof.location || prof.business);
    if (!hasProfile) myDeals.push(account);
  }

  if (!myDeals.length) return;

  const count = myDeals.length;
  const names = myDeals.slice(0, 3).map((a) => displayName(a));
  const nameText = names.join("、") + (count > 3 ? ` など${count}件` : "");

  const detail = $("dealDetail");
  if (!detail) return;
  const emptyState = detail.querySelector(".empty-state");
  if (!emptyState) return;

  const notif = document.createElement("div");
  notif.className = "kb-notif";
  notif.innerHTML = `
    <div class="kb-notif-bubble">
      <img class="kb-notif-avatar" src="kinbot.svg" alt="kinbot" />
      <div class="kb-notif-body">
        <div class="kb-notif-msg">
          ${esc(nameText)}の<b>会社プロフィール</b>がまだ空です！<br>
          「gBizINFOで会社を検索」を押してもらえると、分析の精度が上がります 📈
        </div>
      </div>
      <button class="kb-notif-close" title="閉じる">✕</button>
    </div>
  `;

  notif.querySelector(".kb-notif-close").addEventListener("click", (e) => {
    e.stopPropagation();
    profileNotifDismissed = true;
    notif.remove();
  });

  emptyState.after(notif);
}

// ===== 提案資料の読み込み・表示 =====
async function loadProposals(dealId) {
  const el = $("proposalList");
  if (!el) return;
  if (!dealId) { el.innerHTML = '<div class="empty-state">この案件に紐づく提案資料はありません</div>'; return; }
  try {
    const r = await fetch("/api/proposals?deal_id=" + encodeURIComponent(dealId));
    const d = await r.json();
    const proposals = d.proposals || [];
    if (!proposals.length) {
      el.innerHTML = '<div class="empty-state" style="font-size:13px;color:#8a938c;padding:20px;">提案資料がまだ登録されていません。<br>上のフォームにGoogleスライドのURLを貼って登録してください。</div>';
      return;
    }
    el.innerHTML = proposals.map(p => {
      const tags = [];
      if (p.industry) tags.push(p.industry);
      if (p.employee_size) tags.push(p.employee_size);
      if (p.tags?.keywords) for (const k of p.tags.keywords) tags.push(k);
      return `<div class="proposal-item">
        <div class="proposal-item-head">
          <span class="proposal-item-title" onclick="window.open('${esc(p.slide_url)}','_blank')" style="cursor:pointer;">📊 ${esc(p.filename)}</span>
          <div style="display:flex;align-items:center;gap:8px;">
            <span class="proposal-item-date">${p.uploaded_at ? new Date(p.uploaded_at).toLocaleDateString("ja") : ""}</span>
            <button class="proposal-del-btn" onclick="deleteProposal(${p.id},'${esc(dealId)}')" title="削除">✕</button>
          </div>
        </div>
        <div class="proposal-item-summary" onclick="window.open('${esc(p.slide_url)}','_blank')" style="cursor:pointer;">${esc(p.summary || "")}</div>
        ${tags.length ? '<div class="proposal-item-tags">' + tags.map(t => `<span class="proposal-tag">${esc(t)}</span>`).join("") + '</div>' : ""}
      </div>`;
    }).join("");
  } catch { el.innerHTML = '<div class="empty-state">読み込み失敗</div>'; }
}

// 提案資料の削除
async function deleteProposal(id, dealId) {
  if (!confirm("この提案資料を削除しますか？")) return;
  try {
    await fetch("/api/proposals/" + id, { method: "DELETE" });
    loadProposals(dealId);
  } catch {}
}


// ===== Salesforce連携タブ =====
let sfLinkedOpp = null; // 紐付け済みの商談
let sfStageOptions = []; // Stage選択肢キャッシュ

async function initSfTab(account) {
  const searchBtn = $("sfSearchBtn");
  const matchesEl = $("sfMatches");
  const linkedEl = $("sfLinked");
  if (!searchBtn) return;

  sfLinkedOpp = null;
  matchesEl.innerHTML = "";
  linkedEl.style.display = "none";

  searchBtn.onclick = async () => {
    searchBtn.disabled = true;
    searchBtn.textContent = "検索中…";
    try {
      const companyName = displayName(account);
      const r = await fetch("/api/salesforce/search?q=" + encodeURIComponent(companyName));
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "検索失敗");
      const records = d.records || [];
      if (!records.length) {
        matchesEl.innerHTML = '<div style="padding:12px;color:#8a938c;font-size:13px;">Salesforceに一致する商談が見つかりませんでした</div>';
        return;
      }
      matchesEl.innerHTML = '<div class="sf-match-list">' + records.map(r =>
        `<div class="sf-match-item" data-id="${esc(r.Id)}">
          <div class="sf-match-name">${esc(r.Name)}</div>
          <div class="sf-match-detail">${esc(r.StageName || "")} · ${esc(r.Account?.Name || "")} · ${r.CloseDate || ""}</div>
        </div>`
      ).join("") + '</div>';
      matchesEl.querySelectorAll(".sf-match-item").forEach(item => {
        item.onclick = () => linkOpportunity(item.dataset.id, records.find(r => r.Id === item.dataset.id));
      });
    } catch (e) { matchesEl.innerHTML = `<div style="padding:12px;color:#a32d2d;font-size:13px;">エラー: ${esc(e.message)}</div>`; }
    finally { searchBtn.disabled = false; searchBtn.textContent = "商談を検索"; }
  };

  // 更新ボタン
  const updateBtn = $("sfUpdateBtn");
  if (updateBtn) {
    updateBtn.onclick = async () => {
      if (!sfLinkedOpp) return;
      updateBtn.disabled = true;
      updateBtn.textContent = "更新中…";
      try {
        const fields = {};
        const stage = $("sfStage").value;
        const nextStep = $("sfNextStep").value.trim();
        const log = $("sfLog").value.trim();
        if (stage && stage !== sfLinkedOpp.StageName) fields.StageName = stage;
        if (nextStep) fields.NextStep = nextStep;
        if (Object.keys(fields).length) {
          const r = await fetch("/api/salesforce/opportunity/" + sfLinkedOpp.Id, {
            method: "PATCH", headers: {"content-type":"application/json"},
            body: JSON.stringify(fields),
          });
          if (!r.ok) throw new Error((await r.json()).error || "更新失敗");
        }
        if (log) {
          const r = await fetch("/api/salesforce/opportunity/" + sfLinkedOpp.Id + "/log", {
            method: "POST", headers: {"content-type":"application/json"},
            body: JSON.stringify({ text: log }),
          });
          if (!r.ok) throw new Error((await r.json()).error || "ログ投稿失敗");
        }
        alert("Salesforceを更新しました");
        $("sfLog").value = "";
        // 最新情報を再取得
        linkOpportunity(sfLinkedOpp.Id);
      } catch (e) { alert("更新失敗: " + e.message); }
      finally { updateBtn.disabled = false; updateBtn.textContent = "Salesforceを更新"; }
    };
  }
}

async function linkOpportunity(oppId, cached) {
  sfLinkedOpp = cached || null;
  const linkedEl = $("sfLinked");
  const matchesEl = $("sfMatches");
  const infoEl = $("sfLinkedInfo");

  // Stage選択肢を取得
  if (!sfStageOptions.length) {
    try {
      const r = await fetch("/api/salesforce/stages");
      const d = await r.json();
      sfStageOptions = d.stages || [];
    } catch {}
  }

  // 商談の最新情報を取得
  if (!sfLinkedOpp) {
    try {
      const r = await fetch("/api/salesforce/opportunity/" + oppId + "?fields=Id,Name,StageName,Amount,CloseDate,NextStep,Account.Name");
      sfLinkedOpp = await r.json();
    } catch {}
  }
  if (!sfLinkedOpp) return;

  matchesEl.innerHTML = "";
  linkedEl.style.display = "";
  infoEl.innerHTML = `<div class="sf-linked-card">
    <div class="sf-linked-name">${esc(sfLinkedOpp.Name)}</div>
    <div class="sf-linked-meta">${esc(sfLinkedOpp.Account?.Name || "")} · Stage: ${esc(sfLinkedOpp.StageName || "")} · Close: ${sfLinkedOpp.CloseDate || "未定"}</div>
    ${sfLinkedOpp.NextStep ? `<div class="sf-linked-next">Next Step: ${esc(sfLinkedOpp.NextStep)}</div>` : ""}
    <button class="sf-unlink-btn" onclick="sfLinkedOpp=null;$('sfLinked').style.display='none';$('sfMatches').innerHTML='';">解除</button>
  </div>`;

  // Stage選択肢を設定
  const stageSel = $("sfStage");
  if (stageSel) {
    stageSel.innerHTML = sfStageOptions.map(s =>
      `<option value="${esc(s.value)}" ${s.value === sfLinkedOpp.StageName ? "selected" : ""}>${esc(s.label)}</option>`
    ).join("");
  }
  const nextStep = $("sfNextStep");
  if (nextStep) nextStep.value = sfLinkedOpp.NextStep || "";
}
