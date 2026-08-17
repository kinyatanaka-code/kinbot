// 通知（トーストが使えないときはダイアログ）
function kbNotify(msg) { if (window.kbToast) window.kbToast(msg); else alert(msg); }

// deals.js — 案件単位ビュー＋ネクストアクション管理
const $ = (id) => document.getElementById(id);
// ホームの「失注にする」から来たときのフラグ（自動で99失注を選ぶ）
window._kbAutoLose = new URLSearchParams(location.search).get("sf") === "lose";
// ホームで選んだSF商談のID（あればそのまま紐づける）
window._kbOppId = new URLSearchParams(location.search).get("opp") || "";
// 商談履歴の会社ページからiframeで埋め込まれたときの表示制御
try {
  const q = new URLSearchParams(location.search);
  if (q.get("embed") === "1") document.body.classList.add("kb-embed");
  if (q.get("view") === "profile") document.body.classList.add("kb-only-profile");
  if (q.get("view") === "judge") document.body.classList.add("kb-only-judge");
  if (q.get("view") === "proposals") document.body.classList.add("kb-only-proposals");
  if (q.get("view") === "salesforce") document.body.classList.add("kb-only-salesforce");
  // 埋め込み時は、中身の高さを親に伝えてiframeの高さを合わせる（内部スクロールを無くす）
  if (q.get("embed") === "1") {
    const postH = () => {
      try {
        const t = document.getElementById("dealDetail");
        const h = t ? Math.ceil(t.getBoundingClientRect().height) : document.body.scrollHeight;
        parent.postMessage({ type: "kb-embed-height", height: h }, "*");
      } catch {}
    };
    window.addEventListener("load", postH);
    setTimeout(postH, 400);
    setTimeout(postH, 1200);
    setTimeout(postH, 2500);
    if (window.ResizeObserver) {
      try {
        const t = document.getElementById("dealDetail");
        new ResizeObserver(postH).observe(t || document.documentElement);
      } catch {}
    }
  }
} catch {}
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
          kbNotify(e.message);
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
        kbNotify(e.message);
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
  const hasProfile = p && !p.gbiz_pending && (p.industry || p.employees || p.hiring || p.founded || p.location || p.business);
  // 取得済みなら「取得・更新」パネルは閉じて、情報を見やすくする。未取得なら開いて検索を促す。
  const fetchDet = document.querySelector('.dc-page[data-page="profile"] .prof-fetch');
  if (fetchDet) fetchDet.open = !hasProfile;
  if (!hasProfile) {
    body.innerHTML = '<div class="empty-state">会社情報を自動で検索しています…見つからない場合は下の「会社情報を取得・更新」を開いて、「gBizINFOで会社を検索」またはサイトURLから取得してください。</div>';
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
  // プレビューカードも更新
  if (current) updateCardPreviews(current, groups[current] || []);
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
        kbNotify(e.message);
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
      // 「アールプランナーグループ 水谷様」のように担当者名が混ざっていることがある。
      // 会社名だけを取り出して照合する。
      const onlyCompany = (v) => String(v || "")
        .replace(/[／\/｜|]/g, " ")
        .replace(/[^\s]*(?:様|さま|さん|御中)\s*$/, "")
        .replace(/[\s　]+$/, "")
        .trim();
      const names = Object.keys(groups);
      const cands = [want, onlyCompany(want)].filter(Boolean);
      let hit = null;
      for (const w of cands) {
        hit = names.find((n) => n === w)
          || names.find((n) => normName(n) === normName(w))
          || names.find((n) => { const a = normName(n), b = normName(w); return a && b && b.length >= 2 && (a.includes(b) || b.includes(a)); });
        if (hit) break;
      }
      if (hit) selectDeal(hit);
      else {
        const dp = $("dealDetail");
        // 埋め込み時は左の一覧が見えていないので、案内の文言を変える
        const embedded = document.body.classList.contains("kb-embed");
        if (dp) {
          const co = onlyCompany(want) || want;
          // 見つからなくても、この場で商談を探せるようにする。
          // 「案件画面から探してください」と突き放すと、そこで手が止まってしまう。
          dp.innerHTML =
            `<div class="empty-state" style="padding-bottom:4px">kinbotに「${esc(want)}」の商談履歴がありません。` +
            `${embedded ? "" : "左の一覧から選ぶか、"}下の欄からSalesforceの案件を探して更新できます。</div>` +
            `<div class="sf-search" style="margin:10px 0">
               <input type="text" id="sfSoloQ" class="sf-input sf-search-q" value="${esc(co)}" placeholder="会社名や商談名で検索" />
               <button class="btn sf-search-btn" id="sfSoloBtn">商談を検索</button>
             </div>
             <div id="sfSoloList"></div>`;
          wireSoloSearch();
        }
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
    .normalize("NFKC")
    // 「（山崎さん・男性）」のような補足は外して比べる
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/株式会社|（株）|\(株\)|㈱|有限会社|（有）|\(有\)|合同会社|合資会社|一般社団法人|公益社団法人|社会福祉法人|学校法人|医療法人社団|医療法人|税理士法人|司法書士法人|特定非営利活動法人|独立行政法人/g, "")
    // 「/山崎様」のような担当者名も外す
    .replace(/[\/／].*$/u, "")
    .replace(/[\s　]+/g, "")
    .replace(/(様|御中|さん)$/u, "")
    .trim()
    .toLowerCase();
}
async function mergeDuplicates() {
  const status = $("mergeStatus");
  const setSt = (t) => { if (status) status.textContent = t; };
  const rawKeys = [...new Set(all.filter((m) => {
    if (m.category && m.category !== "商談") return false;
    const t = String(m.title || "");
    if (/【ユ[/／]フォ】|ユーザーフォロー|【社内MTG】|社内ミーティング/.test(t)) return false;
    return true;
  }).map((m) => acctOf(m)))];
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
    const mt = String(m.title || "");
    if (/【ユ[/／]フォ】|ユーザーフォロー|【社内MTG】|社内ミーティング/.test(mt)) continue;
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
    // ▼ カード一覧（ホーム画面）
    `<div class="dc-home" id="dcHome">` +
    `<div class="dc-grid">` +
    // 進捗・判定カード（全幅）
    `<div class="dc-card dc-card-full" data-page="judge"><div class="dc-card-inner">` +
    `<div class="dc-card-top"><span class="dc-card-title"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><rect x="1" y="6" width="4" height="9" rx="1" fill="#0d5b47"/><rect x="6" y="3" width="4" height="12" rx="1" fill="#1d9e75"/><rect x="11" y="1" width="4" height="14" rx="1" fill="#5DCAA5"/></svg>進捗・判定</span><span class="dc-card-arrow"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="#8a938c" stroke-width="1.5" stroke-linecap="round"/></svg></span></div>` +
    `<div class="dc-card-preview" id="dcPreviewJudge">読み込み中...</div>` +
    `</div></div>` +
    // 会社カード
    `<div class="dc-card" data-page="profile"><div class="dc-card-inner">` +
    `<div class="dc-card-top"><span class="dc-card-title"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><rect x="2" y="4" width="12" height="11" rx="1.5" fill="#0d5b47"/><rect x="5" y="1" width="6" height="4" rx="1" fill="#1d9e75"/></svg>会社</span><span class="dc-card-arrow"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="#8a938c" stroke-width="1.5" stroke-linecap="round"/></svg></span></div>` +
    `<div class="dc-card-preview" id="dcPreviewProfile">--</div>` +
    `</div></div>` +
    // 懸念・課題カード
    `<div class="dc-card" data-page="concerns"><div class="dc-card-inner">` +
    `<div class="dc-card-top"><span class="dc-card-title"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><circle cx="8" cy="8" r="7" fill="#D85A30"/><path d="M8 5v4M8 11h.01" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>懸念・課題</span><span class="dc-card-arrow"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="#8a938c" stroke-width="1.5" stroke-linecap="round"/></svg></span></div>` +
    `<div class="dc-card-preview">${concerns.length ? concerns.slice(0,2).map(c=>esc(c)).join("、") + (concerns.length>2?"...":"") : "なし"}</div>` +
    `</div></div>` +
    // 商談準備カード
    `<div class="dc-card" data-page="brief"><div class="dc-card-inner">` +
    `<div class="dc-card-top"><span class="dc-card-title"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><circle cx="8" cy="8" r="7" fill="#0d5b47"/><path d="M8 4v4l3 2" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>商談準備</span><span class="dc-card-arrow"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="#8a938c" stroke-width="1.5" stroke-linecap="round"/></svg></span></div>` +
    `<div class="dc-card-preview">事前ブリーフ・チェックリスト</div>` +
    `</div></div>` +
    // 想定問答カード
    `<div class="dc-card" data-page="qa"><div class="dc-card-inner">` +
    `<div class="dc-card-top"><span class="dc-card-title"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><path d="M2 3h12a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V4a1 1 0 011-1z" fill="#534AB7"/></svg>想定問答</span><span class="dc-card-arrow"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="#8a938c" stroke-width="1.5" stroke-linecap="round"/></svg></span></div>` +
    `<div class="dc-card-preview">よくある質問と回答</div>` +
    `</div></div>` +
    // 提案資料カード
    `<div class="dc-card" data-page="proposals"><div class="dc-card-inner">` +
    `<div class="dc-card-top"><span class="dc-card-title"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><path d="M3 2h7l4 4v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" fill="#1d9e75"/><path d="M10 2v4h4" fill="#5DCAA5"/></svg>提案資料</span><span class="dc-card-arrow"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="#8a938c" stroke-width="1.5" stroke-linecap="round"/></svg></span></div>` +
    `<div class="dc-card-preview" id="dcPreviewProposals">--</div>` +
    `</div></div>` +
    // Salesforceカード
    `<div class="dc-card" data-page="salesforce"><div class="dc-card-inner">` +
    `<div class="dc-card-top"><span class="dc-card-title"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><path d="M8 1a7 7 0 110 14A7 7 0 018 1z" fill="#185FA5"/><path d="M5.5 8.5l2 2 3.5-4" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Salesforce</span><span class="dc-card-arrow"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="#8a938c" stroke-width="1.5" stroke-linecap="round"/></svg></span></div>` +
    `<div class="dc-card-preview" id="dcPreviewSf">Stage更新・活動記録</div>` +
    `</div></div>` +
    // 商談履歴カード（全幅）
    `<div class="dc-card dc-card-full" data-page="flow"><div class="dc-card-inner">` +
    `<div class="dc-card-top"><span class="dc-card-title"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><rect x="1" y="1" width="14" height="14" rx="2" fill="#0d5b47"/><rect x="3" y="4" width="10" height="1.5" rx=".5" fill="#5DCAA5"/><rect x="3" y="7" width="7" height="1.5" rx=".5" fill="#5DCAA5"/><rect x="3" y="10" width="9" height="1.5" rx=".5" fill="#5DCAA5"/></svg>商談の流れ</span><span class="dc-card-arrow"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="#8a938c" stroke-width="1.5" stroke-linecap="round"/></svg></span></div>` +
    `<div class="dc-card-preview">${ms.length}回の商談</div>` +
    `</div></div>` +
    `</div></div>` +
    // ▼ 各ページ（非表示）
    `<div class="dc-page" data-page="judge" hidden>` +
    `<button class="dc-back" type="button"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><path d="M10 4L6 8l4 4" stroke="#0d5b47" stroke-width="1.5" stroke-linecap="round"/></svg>${esc(displayName(account))}</button>` +
    `<section class="deal-sec newproc-sec"><div class="deal-sec-h"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><rect x="1" y="6" width="4" height="9" rx="1" fill="#0d5b47"/><rect x="6" y="3" width="4" height="12" rx="1" fill="#1d9e75"/><rect x="11" y="1" width="4" height="14" rx="1" fill="#5DCAA5"/></svg>進捗・判定 <select class="judge-model" id="judgeModel" title="判定に使うAIモデル（チーム共通の設定）"><option value="">モデル: 既定(Gemini)</option><option value="anthropic">モデル: Claude</option><option value="gemini">モデル: Gemini</option></select></div><div id="newProcBox"><div class="empty-state">読み込み中…</div></div></section>` +
    `</div>` +
    `<div class="dc-page" data-page="brief" hidden>` +
    `<button class="dc-back" type="button"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><path d="M10 4L6 8l4 4" stroke="#0d5b47" stroke-width="1.5" stroke-linecap="round"/></svg>${esc(displayName(account))}</button>` +
    `<section class="deal-sec brief-sec"><div class="deal-sec-h"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><circle cx="8" cy="8" r="7" fill="#0d5b47"/><path d="M8 4v4l3 2" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>商談準備<button class="btn ghost brief-gen-btn" id="briefGen">再作成</button><span class="brief-status" id="briefStatus"></span></div><div id="briefBox"><div class="empty-state">読み込み中…</div></div></section>` +
    `</div>` +
    `<div class="dc-page" data-page="qa" hidden>` +
    `<button class="dc-back" type="button"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><path d="M10 4L6 8l4 4" stroke="#0d5b47" stroke-width="1.5" stroke-linecap="round"/></svg>${esc(displayName(account))}</button>` +
    `<section class="deal-sec brief-qa-sec"><div class="deal-sec-h"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><path d="M2 3h12a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V4a1 1 0 011-1z" fill="#534AB7"/></svg>想定問答</div><div id="briefQaBox"><div class="empty-state">読み込み中…</div></div></section>` +
    `</div>` +
    `<div class="dc-page" data-page="concerns" hidden>` +
    `<button class="dc-back" type="button"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><path d="M10 4L6 8l4 4" stroke="#0d5b47" stroke-width="1.5" stroke-linecap="round"/></svg>${esc(displayName(account))}</button>` +
    `<section class="deal-sec"><div class="deal-sec-h"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><circle cx="8" cy="8" r="7" fill="#D85A30"/><path d="M8 5v4M8 11h.01" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>懸念・課題</div>` +
    `<div id="concernsBody">${concerns.length ? concerns.map(c=>`<div class="concern-item">${esc(c)}</div>`).join("") : '<div class="empty-state">懸念・課題は検出されていません</div>'}</div></section>` +
    `</div>` +
    `<div class="dc-page" data-page="profile" hidden>` +
    `<button class="dc-back" type="button"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><path d="M10 4L6 8l4 4" stroke="#0d5b47" stroke-width="1.5" stroke-linecap="round"/></svg>${esc(displayName(account))}</button>` +
    `<section class="deal-sec deal-profile"><div class="deal-sec-h"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><rect x="2" y="4" width="12" height="11" rx="1.5" fill="#0d5b47"/><rect x="5" y="1" width="6" height="4" rx="1" fill="#1d9e75"/></svg>会社プロフィール</div>` +
    `<div class="prof-status" id="profStatus"></div><div id="profBody"></div>` +
    `<details class="prof-fetch"><summary>会社情報を取得・更新（gBizINFO／サイトURL）</summary>` +
    `<div class="gbiz-box"><div class="gbiz-row"><button class="btn" id="gbizSearch">gBizINFOで会社を検索</button><span class="gbiz-hint">会社名から公式の企業情報を取得します</span></div><div class="gbiz-manual-row"><input id="gbizQuery" type="text" placeholder="別の会社名、または法人番号（13桁）で検索" /><button class="btn btn-ghost" id="gbizQueryBtn" type="button">検索</button></div><div id="gbizCandidates"></div></div>` +
    `<div class="prof-url"><textarea id="profUrl" rows="2" placeholder="企業サイトURL"></textarea><button class="btn" id="profGet">サイトURLから取得</button></div>` +
    `</details></section>` +
    `</div>` +
    `<div class="dc-page" data-page="proposals" hidden>` +
    `<button class="dc-back" type="button"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><path d="M10 4L6 8l4 4" stroke="#0d5b47" stroke-width="1.5" stroke-linecap="round"/></svg>${esc(displayName(account))}</button>` +
    `<section class="deal-sec"><div class="deal-sec-h"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><path d="M3 2h7l4 4v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" fill="#1d9e75"/><path d="M10 2v4h4" fill="#5DCAA5"/></svg>提案資料</div>` +
    `<div class="proposal-add"><input type="text" id="proposalUrl" class="proposal-url-input" placeholder="GoogleスライドのURLを貼り付け" /><button class="btn" id="proposalAddBtn">登録</button></div>` +
    `<div class="proposal-find">
       <div class="proposal-find-h">社内のGoogleドライブから探す</div>
       <div class="proposal-find-row">
         <input type="text" id="propSearchQ" class="proposal-url-input" placeholder="会社名や資料名で検索" />
         <button class="btn sf-btn-secondary" id="propSearchBtn">検索</button>
       </div>
       <div id="propSearchList"></div>
     </div>` +
    `<div id="proposalList"><div class="empty-state">読み込み中…</div></div></section>` +
    `</div>` +
    `<div class="dc-page" data-page="salesforce" hidden>` +
    `<button class="dc-back" type="button"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><path d="M10 4L6 8l4 4" stroke="#0d5b47" stroke-width="1.5" stroke-linecap="round"/></svg>${esc(displayName(account))}</button>` +
    `<section class="deal-sec"><div class="deal-sec-h"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><path d="M8 1a7 7 0 110 14A7 7 0 018 1z" fill="#185FA5"/><path d="M5.5 8.5l2 2 3.5-4" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>Salesforce</div>` +
    `<div id="sfSearch" class="sf-search">
       <input type="text" id="sfSearchQ" class="sf-input sf-search-q" placeholder="会社名や商談名で検索" />
       <button class="btn sf-search-btn" id="sfSearchBtn">商談を検索</button>
     </div>` +
    `<div id="sfMatches"></div>` +
    `<div id="sfLinked" style="display:none"><div id="sfLinkedInfo" class="sf-linked-info"></div>` +
    `<div class="sf-field" id="sfReadMeetingWrap" style="display:none;margin:8px 0 4px"><label>読み取る商談（自動入力の元）</label><select id="sfReadMeeting" class="sf-select"></select></div>` +
    `<div class="sf-subtabs" id="sfSubtabs"><button type="button" class="sf-subtab active" data-sftab="task">活動記録</button><button type="button" class="sf-subtab" data-sftab="stage">ステージ・項目更新</button></div>` +
    `<div class="sf-subpanel" data-sfpanel="task">` +
    `<div class="sf-section-box"><div class="sf-section-title"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><circle cx="8" cy="8" r="7" fill="#0d5b47"/><path d="M8 4v4l3 2" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>活動を記録</div>` +
    `<div id="sfTaskFields"><div class="empty-state">項目を読み込み中…</div></div>` +
    `<div class="sf-autofill-row"><button type="button" class="btn btn-ghost" id="sfTaskReadBtn">商談から読み取る</button><span id="sfTaskReadSelWrap"></span><span class="sf-autofill-note" id="sfTaskReadNote">選んだ商談から活動種別・次回アクション・説明を埋めます</span></div>` +
    `<div class="sf-field" style="margin-top:8px"><button class="btn sf-btn-secondary" id="sfTaskBtn">活動を記録</button></div><div id="sfTaskMsg"></div></div>` +
    `<div class="sf-section-box"><div class="sf-section-title"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><rect x="2" y="3" width="12" height="11" rx="1.5" fill="#0d5b47"/><rect x="4" y="6" width="8" height="1.3" rx=".5" fill="#5DCAA5"/><rect x="4" y="9" width="6" height="1.3" rx=".5" fill="#5DCAA5"/></svg>過去の活動</div><div id="sfTaskHistory"><div class="sf-ss-note">商談をリンクすると表示されます。</div></div></div>` +
    `</div>` +
    `<div class="sf-subpanel" data-sfpanel="stage" hidden>` +
    `<div class="sf-section-box"><div class="sf-section-title"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><rect x="1" y="6" width="4" height="9" rx="1" fill="#0d5b47"/><rect x="6" y="3" width="4" height="12" rx="1" fill="#1d9e75"/><rect x="11" y="1" width="4" height="14" rx="1" fill="#5DCAA5"/></svg>ステージ・項目の更新</div>` +
    `<div id="sfStageFields"></div>` +
    `<div class="sf-field" style="margin-top:8px"><button class="btn" id="sfUpdateBtn">ステージ・項目を更新</button></div><div id="sfUpdateMsg"></div></div>` +
    `<div class="sf-section-box"><div class="sf-section-title"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><rect x="2" y="3" width="12" height="11" rx="1.5" fill="#0d5b47"/><rect x="4" y="6" width="8" height="1.3" rx=".5" fill="#5DCAA5"/><rect x="4" y="9" width="6" height="1.3" rx=".5" fill="#5DCAA5"/></svg>商品</div><div id="sfProducts"><div class="sf-ss-note">商談をリンクすると表示されます。</div></div><div class="sf-field" style="margin-top:8px"><button class="btn sf-btn-secondary" id="sfAddProductBtn">商品を追加</button> <button class="btn btn-ghost" id="sfDiagProductBtn">SFから商品を探す（診断）</button></div><div id="sfProductMsg"></div></div>` +
    `</div>` +
    `</div></section>` +
    `</div>` +
    `<div class="dc-page" data-page="flow" hidden>` +
    `<button class="dc-back" type="button"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><path d="M10 4L6 8l4 4" stroke="#0d5b47" stroke-width="1.5" stroke-linecap="round"/></svg>${esc(displayName(account))}</button>` +
    `<section class="deal-sec"><div class="deal-sec-h"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="vertical-align:-2px;margin-right:4px"><rect x="1" y="1" width="14" height="14" rx="2" fill="#0d5b47"/><rect x="3" y="4" width="10" height="1.5" rx=".5" fill="#5DCAA5"/><rect x="3" y="7" width="7" height="1.5" rx=".5" fill="#5DCAA5"/><rect x="3" y="10" width="9" height="1.5" rx=".5" fill="#5DCAA5"/></svg>商談の流れ</div><div class="deal-timeline" id="dealTimeline"></div></section>` +
    `</div>`;

  // カード→ページ遷移のイベント
  det.querySelectorAll(".dc-card").forEach(card => {
    card.addEventListener("click", () => {
      const page = card.dataset.page;
      $("dcHome").hidden = true;
      det.querySelectorAll(".dc-page").forEach(p => p.hidden = p.dataset.page !== page);
      det.scrollTop = 0;
    });
  });
  // 戻るボタン
  det.querySelectorAll(".dc-back").forEach(btn => {
    btn.addEventListener("click", () => {
      det.querySelectorAll(".dc-page").forEach(p => p.hidden = true);
      $("dcHome").hidden = false;
      det.scrollTop = 0;
    });
  });

  // ステータス変更
  // 案件のステータス変更は、中澤・浦林のみ可能。それ以外は参照のみ（プルダウンをロック）。

  // 提案資料タブの処理
  // 社内のドライブから資料を探して、そのまま登録できるようにする
  const propSearchBtn = $("propSearchBtn");
  if (propSearchBtn && !propSearchBtn._wired) {
    propSearchBtn._wired = true;
    const qEl = $("propSearchQ");
    if (qEl && !qEl.value) qEl.value = displayName(account);
    const listEl = $("propSearchList");

    const runSearch = async () => {
      const q = (qEl && qEl.value.trim()) || displayName(account);
      listEl.innerHTML = '<div class="empty-state">探しています…</div>';
      try {
        const r = await fetch("/api/drive/company-files?company=" + encodeURIComponent(q));
        const d = await r.json();
        if (d.error) { listEl.innerHTML = `<div class="empty-state">${esc(d.error)}</div>`; return; }
        const files = d.files || [];
        listEl.innerHTML = files.length
          ? files.map((f) => `
              <div class="prop-hit">
                <span class="ov-file-kind ${f.kind === "スライド" ? "is-slide" : f.kind === "PDF" ? "is-pdf" : "is-doc"}">${esc(f.kind)}</span>
                <a class="prop-hit-name" href="${esc(f.link)}" target="_blank" rel="noopener">${esc(f.name)}</a>
                <span class="prop-hit-meta">${esc(f.modified)}${f.owner ? " ・ " + esc(f.owner) : ""}</span>
                <button type="button" class="btn sf-btn-secondary prop-hit-add" data-url="${esc(f.link)}" data-name="${esc(f.name)}">この資料を登録</button>
              </div>`).join("")
          : '<div class="empty-state">見つかりませんでした。社内共有されていない資料は表示されません。</div>';
      } catch (e) {
        listEl.innerHTML = '<div class="empty-state">検索に失敗しました。</div>';
      }
    };

    propSearchBtn.addEventListener("click", runSearch);
    if (qEl) qEl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } });
    if (listEl) listEl.addEventListener("click", (e) => {
      const b = e.target.closest(".prop-hit-add");
      if (!b) return;
      const u = $("proposalUrl");
      if (u) { u.value = b.dataset.url; u.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
      const add = $("proposalAddBtn");
      if (add) add.click();
    });
    runSearch();
  }

  const proposalAddBtn = $("proposalAddBtn");
  if (proposalAddBtn) {
    proposalAddBtn.addEventListener("click", async () => {
      const url = $("proposalUrl").value.trim();
      if (!url) return kbNotify("GoogleスライドのURLを入力してください");
      if (!/^https?:\/\/(docs|drive)\.google\.com\//.test(url)) return kbNotify("GoogleスライドやドライブのURLを入力してください\n例: https://docs.google.com/presentation/d/xxxxx/edit");
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
      } catch (e) { kbNotify("登録失敗: " + e.message); }
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
      if (!trimmed) { kbNotify("会社名を空にはできません"); return; }
      if (trimmed === currentName) return; // 変更なし
      // deal_id を lookup（会社名で引く）
      const np = lookupNewProc(displayName(account)) || lookupNewProc(account);
      const dealId = np && np.deal_id;
      if (!dealId) { kbNotify("案件が見つかりません。ページを再読み込みしてください。"); return; }
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
        kbNotify(e.message);
      }
    });
  }

  stSel.addEventListener("change", async (e) => {
    const v = e.target.value;
    const body = v === "__auto" ? { account: pk, auto: true } : { account: pk, status: v };
    const r = await fetch("/api/deal-status", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      kbNotify(d.error || "ステータスを変更できませんでした");
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
  loadNewProcess(displayName(account) || account, pk, ms).then(() => updateCardPreviews(account, ms));
  // プロフィールのプレビューも更新
  updateCardPreviews(account, ms);
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

  // gBizINFO検索を実行。auto=true のときは自動起動。queryOverride があれば会社名/法人番号で検索。
  const runGbizSearch = async (auto, queryOverride) => {
    const raw = (queryOverride != null ? queryOverride : companyName) || "";
    const q = String(raw).trim();
    const digits = q.replace(/\D/g, "");
    const byNumber = digits.length === 13 && /^[0-9\-\s]+$/.test(q);
    if (gbizSearch) { gbizSearch.disabled = true; gbizSearch.textContent = "検索中…"; }
    gbizCandidates.innerHTML = '<div class="gbiz-loading">gBizINFOを検索しています…</div>';
    try {
      const url = byNumber
        ? `/api/gbiz/search?number=${encodeURIComponent(digits)}`
        : `/api/gbiz/search?name=${encodeURIComponent(q)}`;
      const r = await fetch(url);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "検索に失敗しました");
      const cands = d.candidates || [];
      if (!cands.length) {
        gbizCandidates.innerHTML = `<div class="gbiz-empty">「${escapeHtmlSafe(q)}」に一致する法人が見つかりませんでした。名称や法人番号を変えて再検索するか、下の「サイトURLから取得」をお使いください。</div>`;
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

  // 会社名/法人番号での任意検索
  const gbizQuery = $("gbizQuery"), gbizQueryBtn = $("gbizQueryBtn");
  if (gbizQueryBtn) gbizQueryBtn.addEventListener("click", () => {
    const v = (gbizQuery && gbizQuery.value || "").trim();
    if (!v) return;
    runGbizSearch(false, v);
  });
  if (gbizQuery) gbizQuery.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); if (gbizQueryBtn) gbizQueryBtn.click(); }
  });

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



// ===== Salesforce連携タブ（SS01〜SS06固有フィールド対応） =====

// SF再認証ボタンを表示するヘルパー（ポップアップで認証、ページ遷移なし）
// retryFn: 再接続後に自動で再実行する関数（任意）
function showSfReauth(container, msg, retryFn) {
  container.innerHTML = `<div class="sf-reauth-box">
    <div class="sf-reauth-msg">${esc(msg || "Salesforceのセッションが切れました")}</div>
    <button class="btn sf-reauth-btn" id="sfReauthBtn_${Date.now()}">Salesforceに再接続</button>
  </div>`;
  const btn = container.querySelector(".sf-reauth-btn");
  if (btn) btn.onclick = () => openSfReauthWithRetry(btn, retryFn);
}

function openSfReauthWithRetry(btn, retryFn) {
  btn.textContent = "認証画面を開いています…";
  btn.disabled = true;
  const popup = window.open(
    "/auth/salesforce?return=/auth/salesforce/done",
    "sf_reauth",
    "width=600,height=700,menubar=no,toolbar=no,location=yes"
  );
  const check = setInterval(() => {
    if (!popup || popup.closed) {
      clearInterval(check);
      btn.textContent = "再接続完了！";
      // 再認証ボックスを消す
      const box = btn.closest(".sf-reauth-box");
      if (box) box.innerHTML = '<div style="padding:8px;color:#0d5b47;font-size:13px;">再接続しました</div>';
      // キャッシュクリア
      sfStageOptions = [];
      // 再試行
      if (retryFn) setTimeout(retryFn, 500);
    }
  }, 500);
}

// SF API呼び出しのラッパー（再認証エラーを自動検知）
async function sfFetch(url, options) {
  const r = await fetch(url, options);
  if (!r.ok) {
    const d = await r.clone().json().catch(() => ({}));
    if (d.sfReauth || /expired|invalid_grant/.test(d.error || "")) {
      throw { sfReauth: true, message: d.error || "セッション切れ" };
    }
  }
  return r;
}
let sfLinkedOpp = null;
let sfStageOptions = [];
let sfFieldDefs = null; // Opportunityのフィールド定義キャッシュ
let sfFieldTypes = null; // { apiName: { type, updateable } } 型チェック用
let sfFieldList = null;  // describeの全項目（名前・ラベル・型・選択肢）
async function loadSfFields() {
  if (sfFieldList && sfFieldList.length) return sfFieldList;
  try {
    const r = await sfFetch("/api/salesforce/describe");
    const d = await r.json();
    const list = d.fields || [];
    if (!list.length) { sfFieldList = null; return []; } // 空はキャッシュしない（次回再取得）
    sfFieldList = list;
    sfFieldTypes = {};
    for (const f of sfFieldList) sfFieldTypes[f.name] = { type: f.type, updateable: f.updateable };
  } catch { sfFieldList = null; return []; }
  return sfFieldList;
}
async function loadSfFieldTypes() {
  if (sfFieldTypes && Object.keys(sfFieldTypes).length) return sfFieldTypes;
  await loadSfFields();
  return sfFieldTypes || {};
}

// Taskの項目定義（活動記録フォーム用）
let sfTaskFieldList = null;
let sfTaskFieldTypes = null;
async function loadSfTaskFields() {
  if (sfTaskFieldList && sfTaskFieldList.length) return sfTaskFieldList;
  try {
    const r = await sfFetch("/api/salesforce/task-describe");
    const d = await r.json();
    const list = d.fields || [];
    if (!list.length) { sfTaskFieldList = null; return []; } // 空はキャッシュしない
    sfTaskFieldList = list;
    sfTaskFieldTypes = {};
    for (const f of sfTaskFieldList) sfTaskFieldTypes[f.name] = { type: f.type };
  } catch { sfTaskFieldList = null; return []; }
  return sfTaskFieldList;
}
async function loadSfTaskTypes() {
  if (sfTaskFieldTypes && Object.keys(sfTaskFieldTypes).length) return sfTaskFieldTypes;
  await loadSfTaskFields();
  return sfTaskFieldTypes || {};
}
// 活動記録の「説明」に入れる文章。商談画面で見えている要約・商談メモをそのまま貼れる形にする。
function buildActivityComment(latestMeeting) {
  if (!latestMeeting) return "";
  const m = latestMeeting;
  const s = m.summary || {};
  const parts = [];

  // 1) 旧データで formatted しか無い場合は、それをそのまま使う（画面の表示と同じ）
  if (s.formatted && !s.key_points && !s.agreements && String(s.formatted).trim()) {
    parts.push(String(s.formatted).trim());
  } else {
    // 2) 無ければ、要約の各項目を組み立てる
    const lines = [];
    if (s.overview) lines.push(String(s.overview).trim(), "");
    const sec = (label, items) => {
      if (Array.isArray(items) && items.length) {
        lines.push("■" + label);
        items.forEach((i) => lines.push("・" + (typeof i === "string" ? i : (i && (i.text || i.title)) || "")));
        lines.push("");
      }
    };
    sec("要点", s.key_points);
    sec("合意事項", s.agreements);
    sec("宿題・次アクション", s.action_items);
    sec("相手の懸念", s.customer_concerns);
    if (lines.length) parts.push(lines.join("\n").trim());
  }

  // 3) 商談メモ（手入力・ヒアリング内容）があれば続けて入れる
  if (m.note && String(m.note).trim()) parts.push(String(m.note).trim());

  return parts.join("\n\n").trim();
}
async function renderTaskFields(account, latestMeeting) {
  const container = $("sfTaskFields");
  if (!container) return;
  container.innerHTML = '<div class="empty-state">項目を読み込み中…</div>';
  let fields = [];
  try { fields = await loadSfTaskFields(); } catch {}
  if (!fields.length) { renderTaskFieldsStatic(); return; }
  // 表示する項目（ラベルで指定）：活動種別・次回アクション種別・次回アクション日・説明
  const WANT = ["活動種別", "次回アクション種別", "次回アクション日", "説明", "コメント"];
  const normL = (s) => String(s || "").replace(/[\s　()（）_]/g, "").toLowerCase();
  const byLabel = {};
  for (const f of fields) if (f.label) byLabel[normL(f.label)] = f;
  const picked = [];
  const seen = new Set();
  for (const w of WANT) {
    const f = byLabel[normL(w)];
    if (f && !seen.has(f.name)) { picked.push(f); seen.add(f.name); }
  }
  if (!picked.length) { renderTaskFieldsStatic(); return; }
  const defaults = {};
  const descF = picked.find((f) => /説明|コメント|description/i.test(f.label || f.name));
  if (descF) defaults[descF.name] = buildActivityComment(latestMeeting);
  container.innerHTML = picked.map((f) => renderTaskField(f, defaults[f.name])).join("");
}
function renderTaskField(f, def) {
  const label = esc(f.label || f.name) + (f.required ? ' <span class="sf-req">＊必須</span>' : "");
  const val = def == null ? "" : def;
  if (f.type === "boolean") {
    return `<div class="sf-field sf-field-chk"><label><input type="checkbox" data-sf-task-field="${f.name}"/> ${label}</label></div>`;
  }
  if (f.type === "picklist" && f.picklistValues && f.picklistValues.length) {
    let pv = f.picklistValues;
    // 活動種別は指定の5つ（電話/メール/商談/再商談/ネクストアクション）だけに絞る
    if (/活動種別/.test(f.label || "")) {
      const allow = ["電話", "メール", "商談", "再商談", "ネクストアクション"];
      const ord = (o) => { const i = allow.indexOf(o.label || o.value); return i === -1 ? allow.indexOf(o.value) : i; };
      pv = pv.filter((o) => ord(o) !== -1).sort((a, b) => ord(a) - ord(b));
    }
    const opts = ['<option value=""></option>'].concat(pv.map(o => `<option value="${esc(o.value)}" ${o.value === val ? "selected" : ""}>${esc(o.label || o.value)}</option>`)).join("");
    return `<div class="sf-field"><label>${label}</label><select class="sf-select" data-sf-task-field="${f.name}">${opts}</select></div>`;
  }
  if (f.type === "textarea") {
    return `<div class="sf-field"><label>${label}</label><textarea class="sf-textarea" data-sf-task-field="${f.name}" rows="3">${esc(val)}</textarea></div>`;
  }
  if (f.type === "date") {
    return `<div class="sf-field"><label>${label}</label><input type="date" class="sf-input" data-sf-task-field="${f.name}" value="${esc(String(val).slice(0, 10))}"/></div>`;
  }
  return `<div class="sf-field"><label>${label}</label><input type="text" class="sf-input" data-sf-task-field="${f.name}" value="${esc(val)}"/></div>`;
}
function renderTaskFieldsStatic() {
  const container = $("sfTaskFields");
  if (!container) return;
  container.innerHTML =
    `<div class="sf-field"><label>件名</label><input type="text" class="sf-input" data-sf-task-field="Subject" value="[kinbot] 活動記録"/></div>` +
    `<div class="sf-field"><label>期日</label><input type="date" class="sf-input" data-sf-task-field="ActivityDate" value="${new Date().toISOString().slice(0, 10)}"/></div>` +
    `<div class="sf-field"><label>コメント</label><textarea class="sf-textarea" data-sf-task-field="Description" rows="3"></textarea></div>`;
}

// SS固有フィールドの定義（スクショから読み取った項目）
const SS_FIELDS = {
  "01 : アポ獲得": [
    { api: "SS01__c", label: "SS01昇格日", type: "date" },
    { api: "AppointmentDate__c", label: "アポ獲得日", type: "date" },
    { api: "FirstAppointmentDate__c", label: "初回アポ設定日", type: "date" },
    { api: "CustomerCurrentStatus__c", label: "顧客の現状", type: "textarea" },
  ],
  "02 : 有効商談（3ヵ月以内検討）": [
    { api: "SS02__c", label: "SS02昇格日", type: "date" },
    { api: "FirstProposalPlan__c", label: "初回提案プラン", type: "text" },
    { api: "UsagePurpose__c", label: "利用目的", type: "text" },
    { api: "CustomerChallenge__c", label: "担当者が解決したい課題", type: "textarea" },
    { api: "CustomerChallengeOther__c", label: "担当者の解決したい課題（その他）", type: "textarea" },
    { api: "NextMeetingDateTime__c", label: "次回お打合せ日時", type: "datetime" },
    { api: "ClosingMemo__c", label: "商談メモ", type: "textarea" },
  ],
  "03 : 担当者合意": [
    { api: "SS03__c", label: "SS03昇格日", type: "date" },
    { api: "WhyNow__c", label: "今やるべき理由", type: "textarea" },
    { api: "WhyDOC__c", label: "DOCでないといけない理由", type: "textarea" },
    { api: "CompetitorAlternative__c", label: "比較されてる代替手段", type: "text" },
    { api: "EscalationTarget__c", label: "上申先", type: "text" },
    { api: "JointMeeting__c", label: "同席打診", type: "text" },
    { api: "EscalationDate__c", label: "上申日", type: "date" },
  ],
  "04：企画決定者合意": [
    { api: "SS04__c", label: "SS04昇格日", type: "date" },
    { api: "DecisionFlow__c", label: "決裁フロー", type: "textarea" },
    { api: "DesiredStartDate__c", label: "利用開始希望時期", type: "text" },
    { api: "BoardDocuments__c", label: "役員等への書類等に必要な書類", type: "text" },
    { api: "LegalSecurityCheck__c", label: "リーガル・セキュリティチェック", type: "text" },
    { api: "ApplicationFormDate__c", label: "申込書回収想定日", type: "date" },
  ],
  "05 : 決裁者合意": [
    { api: "SS05__c", label: "目標用_SS05昇格日", type: "date" },
    { api: "FinalDecisionPoint__c", label: "最終的な決裁の決め手", type: "textarea" },
  ],
  "06 : 申込書回収完了": [
    { api: "SS06__c", label: "SS06昇格日", type: "date" },
    { api: "KillerContent__c", label: "キラーコンテンツ", type: "text" },
    { api: "WinDate__c", label: "受注日", type: "date" },
  ],
};

// ステージ名の部分一致でSSフィールドを取得
function getSSFields(stageName) {
  const s = String(stageName || "");
  for (const [key, fields] of Object.entries(SS_FIELDS)) {
    // "01" で始まるか、キー全体が含まれるか
    const num = key.match(/^(\d+)/)?.[1];
    if (num && s.includes(num)) return fields;
    if (s.includes(key)) return fields;
  }
  return [];
}

// SFのエラー文（[{message,errorCode}] 形式）から読みやすいメッセージを取り出す
function cleanSfError(msg) {
  const s = String(msg || "");
  try {
    const m = s.match(/\[[\s\S]*\]/);
    if (m) {
      const arr = JSON.parse(m[0]);
      if (Array.isArray(arr) && arr.length && arr[0] && arr[0].message) return arr.map((x) => x.message).join(" / ");
    }
  } catch {}
  return s;
}

// 「取引先責任者の役割（主担当）」が必須のエラー時に、設定して再更新するUI
async function showContactRolePrompt(container, errMsg, retry) {
  if (!container) return;
  container.innerHTML = `<div class="sf-err-box">${esc(errMsg)}</div><div class="sf-cr-box"><div class="sf-cr-title">主担当（取引先責任者の役割）を設定して再更新します</div><div class="sf-ss-note">取引先責任者を読み込み中…</div></div>`;
  const box = container.querySelector(".sf-cr-box");
  try {
    const r = await sfFetch("/api/salesforce/contacts?accountId=" + encodeURIComponent((sfLinkedOpp && sfLinkedOpp.AccountId) || ""));
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "取得失敗");
    const contacts = d.contacts || [];
    const roles = d.roles || [];
    const roleSelHtml = roles.length
      ? `<div class="sf-field"><label>役割</label><select class="sf-select" id="crRole"><option value="">（役割なし）</option>${roles.map((rr) => `<option value="${esc(rr)}">${esc(rr)}</option>`).join("")}</select></div>`
      : "";
    // 既存の取引先責任者から選ぶ（いれば）＋ 新規作成
    const existingHtml = contacts.length
      ? `<div class="sf-cr-title">既存の取引先責任者から主担当を設定</div>` +
        `<div class="sf-field"><label>取引先責任者</label><select class="sf-select" id="crContact">${contacts.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}${c.title ? "（" + esc(c.title) + "）" : ""}</option>`).join("")}</select></div>` +
        roleSelHtml +
        `<div class="sf-field" style="margin-top:6px"><button class="btn" id="crSetBtn">主担当として設定して再更新</button></div>`
      : `<div class="sf-cr-title">この取引先には取引先責任者がまだありません。新しく作成します。</div>`;
    const createHtml =
      `<div class="sf-cr-title" style="margin-top:14px">新しい取引先責任者を作成して主担当に設定</div>` +
      `<div class="sf-field"><label>氏名（姓）※必須</label><input type="text" class="sf-input" id="crNewLast" placeholder="例：松下" /></div>` +
      `<div class="sf-field"><label>名（任意）</label><input type="text" class="sf-input" id="crNewFirst" placeholder="例：太郎" /></div>` +
      `<div class="sf-field"><label>役職（任意）</label><input type="text" class="sf-input" id="crNewTitle" placeholder="例：人事部長" /></div>` +
      `<div class="sf-field"><label>メール（任意）</label><input type="text" class="sf-input" id="crNewEmail" placeholder="例：matsushita@example.com" /></div>` +
      (roles.length ? `<div class="sf-field"><label>役割</label><select class="sf-select" id="crNewRole"><option value="">（役割なし）</option>${roles.map((rr) => `<option value="${esc(rr)}">${esc(rr)}</option>`).join("")}</select></div>` : "") +
      `<div class="sf-field" style="margin-top:6px"><button class="btn sf-btn-secondary" id="crCreateBtn">作成して主担当に設定して再更新</button></div>`;
    box.innerHTML = existingHtml + createHtml + `<div id="crMsg" class="sf-ss-note"></div>`;
    const crMsg = () => box.querySelector("#crMsg");
    // 既存から設定
    const setBtn = box.querySelector("#crSetBtn");
    if (setBtn) setBtn.addEventListener("click", async () => {
      const contactId = box.querySelector("#crContact").value;
      const roleSel = box.querySelector("#crRole");
      setBtn.disabled = true; setBtn.textContent = "設定中…";
      try {
        const rr = await sfFetch("/api/salesforce/contact-role", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ opportunityId: sfLinkedOpp.Id, contactId, role: roleSel ? roleSel.value : "", isPrimary: true }),
        });
        const dd = await rr.json();
        if (!rr.ok) throw new Error(dd.error || "設定失敗");
        if (crMsg()) crMsg().textContent = "主担当を設定しました。再更新します…";
        setTimeout(retry, 500);
      } catch (e) {
        if (crMsg()) crMsg().textContent = "設定に失敗しました：" + cleanSfError(e.message);
        setBtn.disabled = false; setBtn.textContent = "主担当として設定して再更新";
      }
    });
    // 新規作成して設定
    const createBtn = box.querySelector("#crCreateBtn");
    if (createBtn) createBtn.addEventListener("click", async () => {
      const lastName = box.querySelector("#crNewLast").value.trim();
      if (!lastName) { if (crMsg()) crMsg().textContent = "氏名（姓）を入力してください。"; return; }
      const firstName = box.querySelector("#crNewFirst").value.trim();
      const title = box.querySelector("#crNewTitle").value.trim();
      const email = box.querySelector("#crNewEmail").value.trim();
      const roleSel = box.querySelector("#crNewRole");
      createBtn.disabled = true; createBtn.textContent = "作成中…";
      try {
        const cr = await sfFetch("/api/salesforce/contact", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ accountId: (sfLinkedOpp && sfLinkedOpp.AccountId) || "", lastName, firstName, title, email }),
        });
        const cd = await cr.json();
        if (!cr.ok || !cd.id) throw new Error(cd.error || "作成失敗");
        if (crMsg()) crMsg().textContent = "取引先責任者を作成しました。主担当に設定中…";
        const rr = await sfFetch("/api/salesforce/contact-role", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ opportunityId: sfLinkedOpp.Id, contactId: cd.id, role: roleSel ? roleSel.value : "", isPrimary: true }),
        });
        const dd = await rr.json();
        if (!rr.ok) throw new Error(dd.error || "主担当設定失敗");
        if (crMsg()) crMsg().textContent = "作成・主担当設定が完了しました。再更新します…";
        setTimeout(retry, 500);
      } catch (e) {
        if (crMsg()) crMsg().textContent = "失敗しました：" + cleanSfError(e.message);
        createBtn.disabled = false; createBtn.textContent = "作成して主担当に設定して再更新";
      }
    });
    return;
  } catch (e) {
    if (box) box.innerHTML = '<div class="sf-ss-note">取引先責任者の取得に失敗しました：' + esc(cleanSfError(e.message)) + "</div>";
  }
}

// 「〜の入力が必要」エラー時に、不足項目を入力して再更新するUI

// 項目名の比較用に、記号・長音・助詞の「の」をそろえる
function normFieldLabel(s) {
  return String(s || "")
    .replace(/[\s　・（）()【】\[\]「」『』:：;；,，、。.\-‐―ー_＿"'`]/g, "")
    .replace(/の/g, "")
    .toLowerCase();
}

// エラー文から「入力が必要な項目」の手がかり語を取り出す
// 例：「セキュリティーチェックが不要な場合、その理由の入力が必要です」→ ["セキュリティーチェック", "理由"]
function requiredHints(errMsg) {
  const clauses = String(errMsg || "").split(/[。\n]+|\s*[\/／]\s*/).map((c) => c.trim()).filter(Boolean);
  const hints = [];
  for (const c of clauses) {
    const toks = [];
    // 「〜にはA・B・Cを入力してください」形式（項目が中黒で並ぶ）
    const mList = c.match(/([^。]+?)を(?:入力|選択|登録|設定|記入)して/);
    const mNeed = c.match(/([^。]+?)の(?:入力|選択|登録|設定|記入)が(?:必要|必須)/);
    // 「A」「B」のような列挙、または「AをBを入力してください」形式のときだけ、まとめて拾う
    const multi = mList || (mNeed && /[「『・]/.test(mNeed[1]) ? mNeed : null);
    if (multi) {
      let seg = String(multi[1]).replace(/^.*?(?:のためには|ためには|には|は)\s*/, "");
      // 「商談種別」「初回提案商品」のようなかぎかっこ区切りにも対応
      seg = seg.replace(/[「『]/g, "・").replace(/[」』]/g, "・");
      const items = seg.split(/[・､、,／\/]+/).map((x) => x.trim()).filter((x) => x.length >= 2 && x.length <= 30);
      if (items.length > 1) { items.forEach((x) => hints.push([x])); continue; }
      if (items.length === 1 && (mList || /[「『]/.test(String(multi[1])))) { hints.push([items[0]]); continue; }
    }
    let m = c.match(/([^、。：:！!]{2,}?)が(?:不要|必要|未入力|未選択|空|ない|無い)/);
    if (m) toks.push(m[1]);
    m = c.match(/([^、。：:！!]{1,24}?)の(?:入力|選択|登録|設定|記入|確認)が(?:必要|必須)/);
    if (m) toks.push(String(m[1]).replace(/^(その|この|上記|該当)/, ""));
    m = c.match(/([^、。：:！!]{2,}?)(?:は|が)(?:必須|未入力)/);
    if (m) toks.push(m[1]);
    const clean = [];
    for (let t of toks) {
      t = String(t).replace(/^[、\s　]+|[、\s　]+$/g, "");
      // 「失注時には失注日」のような前置きを落とす
      const cut = t.replace(/^.*?(?:時には|には|の場合、?)/, "");
      if (cut && cut.length >= 2) t = cut;
      t = t.replace(/の(?:入力|選択|登録|設定|記入)$/, "");
      if (t && t.length >= 2 && !clean.includes(t)) clean.push(t);
    }
    if (clean.length) hints.push(clean);
  }
  return hints;
}

// 手がかり語に当てはまるSF項目を探す
function fieldsForHint(fields, toks) {
  const nt = toks.map(normFieldLabel).filter(Boolean);
  if (!nt.length) return [];
  const cand = fields.filter((f) => f.updateable && f.name !== "StageName");
  const byLen = (a, b) => String(a.label || "").length - String(b.label || "").length;
  // すべての手がかり語をラベルに含む項目
  let hit = cand.filter((f) => nt.every((t) => normFieldLabel(f.label).includes(t)));
  // 見つからなければ、先頭の語＋「理由・備考」系
  if (!hit.length && nt.length > 1) {
    hit = cand.filter((f) => normFieldLabel(f.label).includes(nt[0]) && /理由|備考|コメント|内容|詳細/.test(f.label || ""));
  }
  // それでも無ければ、先頭の語を含む項目
  if (!hit.length) hit = cand.filter((f) => normFieldLabel(f.label).includes(nt[0]) && normFieldLabel(f.label).length <= nt[0].length + 8);
  hit.sort(byLen);
  return hit.slice(0, 2);
}

async function showRequiredFieldsPrompt(container, errMsg, retry) {
  if (!container) return;
  container.innerHTML = `<div class="sf-err-box">${esc(errMsg)}</div><div class="sf-cr-box"><div class="sf-cr-title">不足している項目を入力して再更新します</div><div class="sf-ss-note">項目を読み込み中…</div></div>`;
  const box = container.querySelector(".sf-cr-box");
  let fields = [];
  try { fields = await loadSfFields(); } catch {}
  const opp = sfLinkedOpp || {};

  // エラー文から必要な項目を推測する
  const matched = [];
  for (const toks of requiredHints(errMsg)) {
    for (const f of fieldsForHint(fields, toks)) {
      if (!matched.find((y) => y.name === f.name)) matched.push(f);
    }
  }

  const inputHtml = (f, required) => {
    const cur = opp[f.name] != null ? String(opp[f.name]) : "";
    const label = esc(f.label || f.name);
    const req = required ? ' <span class="sf-req">＊必須</span>' : "";
    if (f.type === "boolean") return `<div class="sf-field sf-field-chk" data-req-row="${f.name}"><label><input type="checkbox" data-req-field="${f.name}" data-req-type="boolean" ${opp[f.name] === true ? "checked" : ""}/> ${label}</label></div>`;
    if (f.type === "picklist" && f.picklistValues && f.picklistValues.length) {
      const opts = ['<option value=""></option>'].concat(f.picklistValues.map((o) => `<option value="${esc(o.value)}" ${o.value === cur ? "selected" : ""}>${esc(o.label || o.value)}</option>`)).join("");
      return `<div class="sf-field" data-req-row="${f.name}"><label>${label}${req}</label><select class="sf-select" data-req-field="${f.name}">${opts}</select></div>`;
    }
    if (f.type === "multipicklist" && f.picklistValues && f.picklistValues.length) {
      const opts = ['<option value=""></option>'].concat(f.picklistValues.map((o) => `<option value="${esc(o.value)}" ${o.value === cur ? "selected" : ""}>${esc(o.label || o.value)}</option>`)).join("");
      return `<div class="sf-field" data-req-row="${f.name}"><label>${label}${req}</label><select class="sf-select" data-req-field="${f.name}">${opts}</select></div>`;
    }
    if (f.type === "textarea") return `<div class="sf-field" data-req-row="${f.name}"><label>${label}${req}</label><textarea class="sf-textarea" data-req-field="${f.name}" rows="2">${esc(cur)}</textarea></div>`;
    if (f.type === "date") return `<div class="sf-field" data-req-row="${f.name}"><label>${label}${req}</label><input type="date" class="sf-input" data-req-field="${f.name}" value="${esc(cur.slice(0, 10))}"/></div>`;
    if (["double", "currency", "int", "percent"].includes(f.type)) return `<div class="sf-field" data-req-row="${f.name}"><label>${label}${req}</label><input type="text" class="sf-input" data-req-field="${f.name}" data-req-type="num" value="${esc(cur)}"/></div>`;
    return `<div class="sf-field" data-req-row="${f.name}"><label>${label}${req}</label><input type="text" class="sf-input" data-req-field="${f.name}" value="${esc(cur)}"/></div>`;
  };

  const head = matched.length
    ? `<div class="sf-cr-title">不足している項目を入力して再更新します</div>`
    : `<div class="sf-cr-title">不足している項目を選んで入力してください</div><div class="sf-ss-note">エラー文からは項目を特定できませんでした。下の検索から項目を追加して入力すると、そのまま再更新できます。</div>`;

  box.innerHTML = head +
    `<div id="reqFields">${matched.map((f) => inputHtml(f, true)).join("")}</div>` +
    `<div class="sf-req-add">
       <input type="text" class="sf-input" id="reqSearch" placeholder="項目名で検索して追加（例：セキュリティ、理由）" autocomplete="off" />
       <div id="reqSearchList" class="sf-req-list"></div>
     </div>` +
    `<div class="sf-field" style="margin-top:6px"><button class="btn" id="reqBtn">入力して再更新</button></div><div id="reqMsg" class="sf-ss-note"></div>`;

  // 項目検索：クリックで入力欄を追加
  const search = box.querySelector("#reqSearch");
  const searchList = box.querySelector("#reqSearchList");
  const fieldsBox = box.querySelector("#reqFields");
  const renderSearch = () => {
    const q = normFieldLabel(search.value);
    if (!q) { searchList.innerHTML = ""; return; }
    const hits = fields
      .filter((f) => f.updateable && f.name !== "StageName")
      .filter((f) => normFieldLabel(f.label).includes(q) || String(f.name).toLowerCase().includes(search.value.trim().toLowerCase()))
      .filter((f) => !fieldsBox.querySelector(`[data-req-row="${f.name}"]`))
      .slice(0, 12);
    searchList.innerHTML = hits.length
      ? hits.map((f) => `<button type="button" class="sf-req-item" data-add-field="${esc(f.name)}"><span class="sf-req-item-label">${esc(f.label || f.name)}</span><span class="sf-req-item-api">${esc(f.name)}</span></button>`).join("")
      : `<div class="sf-ss-note">一致する項目がありません。</div>`;
  };
  if (search) search.addEventListener("input", renderSearch);
  if (searchList) searchList.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-add-field]");
    if (!b) return;
    const f = fields.find((x) => x.name === b.dataset.addField);
    if (!f) return;
    fieldsBox.insertAdjacentHTML("beforeend", inputHtml(f, false));
    search.value = "";
    searchList.innerHTML = "";
  });

  box.querySelector("#reqBtn").addEventListener("click", async () => {
    const btn = box.querySelector("#reqBtn");
    const patch = {};
    box.querySelectorAll("[data-req-field]").forEach((el) => {
      const api = el.dataset.reqField;
      if (el.type === "checkbox") { patch[api] = el.checked; return; }
      const v = (el.value ?? "").trim();
      if (v === "") return;
      if (el.dataset.reqType === "num") { const n = Number(v.replace(/[,¥￥\s]/g, "")); if (!isNaN(n)) patch[api] = n; }
      else patch[api] = v;
    });
    const reqMsg = box.querySelector("#reqMsg");
    if (!Object.keys(patch).length) { if (reqMsg) reqMsg.textContent = "項目を入力してください。"; return; }
    btn.disabled = true; btn.textContent = "更新中…";
    // ステージ変更と同時に送らないと、同じバリデーションでまた弾かれるので、本更新にまとめて渡す
    window._sfExtraFields = Object.assign({}, window._sfExtraFields || {}, patch);
    if (reqMsg) reqMsg.textContent = "入力した項目を含めて再更新します…";
    setTimeout(() => {
      btn.disabled = false; btn.textContent = "入力して再更新";
      retry();
    }, 300);
  });
}

async function showProductPrompt(container, errMsg, retry) {
  if (!container) return;
  const errBox = errMsg ? `<div class="sf-err-box">${esc(errMsg)}</div>` : "";
  container.innerHTML = errBox + `<div class="sf-cr-box"><div class="sf-cr-title">商品を登録して再更新します</div><div class="sf-ss-note">商品を読み込み中…</div></div>`;
  const box = container.querySelector(".sf-cr-box");
  try {
    const r = await sfFetch("/api/salesforce/products?opportunityId=" + encodeURIComponent(sfLinkedOpp.Id));
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "取得失敗");
    const entries = d.entries || [];
    const oliFields = d.fields || [];
    if (!entries.length) {
      box.innerHTML = '<div class="sf-cr-title">登録できる商品が見つかりませんでした。</div><div class="sf-ss-note">Salesforceの価格表（Pricebook）に有効な商品が登録されているか確認してください。</div>';
      return;
    }
    const oliFieldHtml = (f) => {
      const label = esc(f.label || f.name) + (f.required ? ' <span class="sf-req">＊必須</span>' : "");
      if (f.type === "picklist" && f.picklistValues && f.picklistValues.length) {
        return `<div class="sf-field"><label>${label}</label><select class="sf-select" data-oli-field="${f.name}"><option value=""></option>${f.picklistValues.map((o) => `<option value="${esc(o.value)}">${esc(o.label || o.value)}</option>`).join("")}</select></div>`;
      }
      if (f.type === "date") return `<div class="sf-field"><label>${label}</label><input type="date" class="sf-input" data-oli-field="${f.name}"/></div>`;
      if (["double", "currency", "int", "percent"].includes(f.type)) return `<div class="sf-field"><label>${label}</label><input type="text" class="sf-input" data-oli-field="${f.name}" data-num="1"/></div>`;
      return `<div class="sf-field"><label>${label}</label><input type="text" class="sf-input" data-oli-field="${f.name}"/></div>`;
    };
    box.innerHTML =
      `<div class="sf-cr-title">商品を登録して再更新します</div>` +
      `<div class="sf-field"><label>価格表で絞り込み</label><select class="sf-select" id="prodPb"></select></div>` +
      `<div class="sf-field"><label>商品を検索</label><input type="text" class="sf-input" id="prodSearch" placeholder="商品名で絞り込み（例：エントリー、スタンダード、ライト）" /></div>` +
      `<div class="sf-field"><label>商品</label><select class="sf-select" id="prodEntry" size="6" style="height:auto"></select></div>` +
      `<div class="sf-field"><label>数量</label><input type="text" class="sf-input" id="prodQty" value="1" /></div>` +
      `<div class="sf-field"><label>単価（任意・空欄なら価格表の価格）</label><input type="text" class="sf-input" id="prodPrice" value="" /></div>` +
      oliFields.map(oliFieldHtml).join("") +
      `<div class="sf-field" style="margin-top:6px"><button class="btn" id="prodBtn">商品を登録して再更新</button></div><div id="prodMsg" class="sf-ss-note"></div>`;
    const sel = box.querySelector("#prodEntry");
    const searchEl = box.querySelector("#prodSearch");
    const pbEl = box.querySelector("#prodPb");
    const priceInput = box.querySelector("#prodPrice");
    // 価格表の絞り込み肢（DOC等）。DOCらしい価格表があれば既定に。
    const pbNames = [...new Set(entries.map((e) => e.pricebookName).filter(Boolean))];
    const docPb = pbNames.find((n) => /doc/i.test(n));
    pbEl.innerHTML = `<option value="">すべての価格表</option>` + pbNames.map((n) => `<option value="${esc(n)}" ${n === docPb ? "selected" : ""}>${esc(n)}</option>`).join("");
    const syncPrice = () => { const p = sel.selectedOptions[0] && sel.selectedOptions[0].dataset.price; if (priceInput) priceInput.placeholder = p ? "価格表: " + p : ""; };
    const renderEntries = () => {
      const ql = (searchEl.value || "").toLowerCase();
      const pbf = pbEl.value;
      // 検索語があるときは価格表フィルタを無視して全価格表から探す
      const list = entries.filter((e) => {
        const matchName = !ql || (e.name || "").toLowerCase().includes(ql) || (e.pricebookName || "").toLowerCase().includes(ql);
        return ql ? matchName : (!pbf || e.pricebookName === pbf);
      }).slice(0, 800);
      sel.innerHTML = list.map((e) => `<option value="${esc(e.id)}" data-price="${e.unitPrice != null ? e.unitPrice : ""}" data-pb="${esc(e.pricebookId || "")}">${e.pricebookName ? "［" + esc(e.pricebookName) + "］" : ""}${esc(e.name)}${e.unitPrice != null ? "（¥" + Number(e.unitPrice).toLocaleString() + "）" : ""}${e.active === false ? " ※無効" : ""}</option>`).join("");
      if (sel.options.length) sel.options[0].selected = true;
      syncPrice();
    };
    renderEntries();
    searchEl.addEventListener("input", renderEntries);
    pbEl.addEventListener("change", renderEntries);
    sel.addEventListener("change", syncPrice);
    box.querySelector("#prodBtn").addEventListener("click", async () => {
      const btn = box.querySelector("#prodBtn");
      const opt = sel.selectedOptions[0];
      const pricebookEntryId = sel.value;
      const pricebookId = opt ? opt.dataset.pb : "";
      if (!pricebookEntryId) { const pm = box.querySelector("#prodMsg"); if (pm) pm.textContent = "商品を選んでください。"; return; }
      const quantity = box.querySelector("#prodQty").value.trim() || "1";
      const unitPrice = priceInput.value.trim();
      const fields = {};
      box.querySelectorAll("[data-oli-field]").forEach((el) => {
        const v = (el.value ?? "").trim();
        if (v === "") return;
        if (el.dataset.num) { const n = Number(v.replace(/[,¥￥\s]/g, "")); if (!isNaN(n)) fields[el.dataset.oliField] = n; }
        else fields[el.dataset.oliField] = v;
      });
      const pMsg = box.querySelector("#prodMsg");
      btn.disabled = true; btn.textContent = "登録中…";
      try {
        const rr = await sfFetch("/api/salesforce/product", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ opportunityId: sfLinkedOpp.Id, pricebookEntryId, pricebookId, quantity, unitPrice, fields }),
        });
        const dd = await rr.json();
        if (!rr.ok) throw new Error(dd.error || "登録失敗");
        if (pMsg) pMsg.textContent = "商品を登録しました。再更新します…";
        setTimeout(retry, 500);
      } catch (e) {
        if (pMsg) pMsg.textContent = "登録に失敗しました：" + cleanSfError(e.message);
        btn.disabled = false; btn.textContent = "商品を登録して再更新";
      }
    });
    return;
    return;
  } catch (e) {
    if (box) box.innerHTML = '<div class="sf-ss-note">商品の取得に失敗しました：' + esc(cleanSfError(e.message)) + "</div>";
  }
}

// Salesforce全体から商品を探して結果を表示（診断）
async function showProductDiagnose(container, q) {
  if (!container) return;
  container.innerHTML = `<div class="sf-cr-box"><div class="sf-cr-title">「${esc(q)}」をSalesforce全体から検索中…</div></div>`;
  const box = container.querySelector(".sf-cr-box");
  try {
    const r = await sfFetch("/api/salesforce/product-diagnose?q=" + encodeURIComponent(q));
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "取得失敗");
    const prod = d.products || [];
    const entries = d.entries || [];
    const pbs = d.pricebooks || [];
    let html = `<div class="sf-cr-title">「${esc(q)}」の検索結果</div>`;
    // 商品（Product2）
    html += `<div class="sf-diag-sec"><b>商品（Product2）：${prod.length}件</b>`;
    html += prod.length ? prod.map((p) => `<div class="sf-diag-line">${esc(p.name)}${p.active === false ? " <span class='sf-req'>※無効</span>" : ""}${p.family ? "（" + esc(p.family) + "）" : ""}</div>`).join("") : `<div class="sf-ss-note">この名前の商品はSalesforceに存在しません。</div>`;
    html += `</div>`;
    // 価格表への登録（PricebookEntry）
    html += `<div class="sf-diag-sec"><b>価格表への登録（PricebookEntry）：${entries.length}件</b>`;
    html += entries.length ? entries.map((e) => `<div class="sf-diag-line">［${esc(e.pricebook || "?")}］${esc(e.product || "?")}　${e.price != null ? "¥" + Number(e.price).toLocaleString() : ""}${e.active === false ? " <span class='sf-req'>※無効</span>" : ""}</div>`).join("") : `<div class="sf-ss-note">この商品は、どの価格表にも登録されていません（＝商談に追加できません）。</div>`;
    html += `</div>`;
    // 全価格表
    html += `<div class="sf-diag-sec"><b>存在する価格表（Pricebook）：${pbs.length}件</b>`;
    html += pbs.map((p) => `<div class="sf-diag-line">${esc(p.name)}${p.standard ? "（標準）" : ""}${p.active === false ? " <span class='sf-req'>※無効</span>" : ""}</div>`).join("");
    html += `</div>`;
    if (d.errors && (d.errors.products || d.errors.entries || d.errors.pricebooks)) {
      html += `<div class="sf-ss-note">一部の検索でエラー：${esc(d.errors.products || d.errors.entries || d.errors.pricebooks)}</div>`;
    }
    box.innerHTML = html;
  } catch (e) {
    box.innerHTML = `<div class="sf-ss-note">診断に失敗しました：${esc(cleanSfError(e.message))}</div>`;
  }
}

// kinbotに商談履歴が無い会社でも、この場でSalesforceの案件を探して開けるようにする。
// 「案件画面から探してください」で終わらせると、そこで手が止まってしまうため。
function wireSoloSearch() {
  const btn = $("sfSoloBtn");
  const q = $("sfSoloQ");
  const list = $("sfSoloList");
  if (!btn || btn._wired) return;
  btn._wired = true;

  const run = async () => {
    const word = (q.value || "").trim();
    if (!word) return;
    btn.disabled = true;
    btn.textContent = "検索中…";
    list.innerHTML = "";
    try {
      const r = await sfFetch("/api/salesforce/search?q=" + encodeURIComponent(word));
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "検索できませんでした");
      const recs = d.records || [];
      if (!recs.length) {
        list.innerHTML =
          `<div class="empty-state">「${esc(word)}」で見つかりませんでした。` +
          `正式名称や略称など、別の言い方でもう一度お試しください。</div>`;
        return;
      }
      list.innerHTML = recs.slice(0, 20).map((x) => `
        <div class="sf-match" data-id="${esc(x.Id)}" data-name="${esc(x.Name || "")}">
          <div class="sf-match-name">${esc(x.Name || "(名称なし)")}</div>
          <div class="sf-match-meta">${esc(x.StageName || "")}${x.Account && x.Account.Name ? " ・ " + esc(x.Account.Name) : ""}${x.CloseDate ? " ・ " + esc(x.CloseDate) : ""}</div>
          <button type="button" class="btn sf-solo-pick">この案件を更新する</button>
        </div>`).join("");

      list.querySelectorAll(".sf-solo-pick").forEach((b) =>
        b.addEventListener("click", () => {
          const row = b.closest(".sf-match");
          // 選んだ案件を、そのままSalesforceの更新画面で開く
          sfLinkedOpp = { Id: row.dataset.id, Name: row.dataset.name };
          openSfForOpportunity(row.dataset.id, row.dataset.name);
        })
      );
    } catch (e) {
      list.innerHTML = `<div class="empty-state">検索できませんでした：${esc(e.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = "商談を検索";
    }
  };

  btn.addEventListener("click", run);
  q.addEventListener("keydown", (e) => { if (e.key === "Enter") run(); });
}

// 選んだ案件で、Salesforceの更新画面を開く。
// kinbotに商談履歴が無いので、案件名を仮の見出しにして画面を組み立てる。
async function openSfForOpportunity(oppId, oppName) {
  const account = oppName || "(選んだ案件)";
  // 商談履歴が無い会社として、空の入れ物を用意する
  if (!groups[account]) groups[account] = [];
  await selectDeal(account);
  // Salesforceのページに切り替える
  const card = document.querySelector('.dc-card[data-page="salesforce"]');
  if (card) card.click();
  // 少し待ってから、選んだ案件をそのまま探して紐づける
  setTimeout(() => {
    const qEl = $("sfSearchQ");
    if (qEl) qEl.value = oppName || "";
    const btn = $("sfSearchBtn");
    if (btn) btn.click();
  }, 250);
}

async function initSfTab(account) {
  const searchBtn = $("sfSearchBtn");
  const matchesEl = $("sfMatches");
  const linkedEl = $("sfLinked");
  if (!searchBtn) return;

  // 再接続後の復帰用に現在の案件を記憶
  window._sfCurrentAccount = account;

  sfLinkedOpp = null;
  matchesEl.innerHTML = "";
  linkedEl.style.display = "none";

  // サブタブ（活動記録／ステージ更新）の切替。活動記録を既定表示。
  const subtabs = $("sfSubtabs");
  if (subtabs) {
    subtabs.querySelectorAll(".sf-subtab").forEach((b) => {
      b.addEventListener("click", () => {
        const target = b.dataset.sftab;
        subtabs.querySelectorAll(".sf-subtab").forEach((x) => x.classList.toggle("active", x === b));
        document.querySelectorAll(".sf-subpanel[data-sfpanel]").forEach((p) => { p.hidden = p.dataset.sfpanel !== target; });
      });
    });
  }

  // この案件の商談データを取得
  const ms = groups[account] || [];
  const latestMeeting = ms.length ? ms[ms.length - 1] : null;
  window._sfCurrentBotId = latestMeeting && latestMeeting.bot_id; // 自動入力（商談から読み取り）の対象
  window._sfReadBotId = window._sfCurrentBotId;
  const meetingById = (id) => ms.find((m) => m.bot_id === id);
  // 選んだ商談の要約を、活動記録の「説明」欄に入れる
  const fillDescFromMeeting = (m) => {
    if (!m) return;
    const inputs = [...document.querySelectorAll("#sfTaskFields [data-sf-task-field]")];
    const descEl = inputs.find((el) => /説明|コメント/.test((el.closest(".sf-field") && el.closest(".sf-field").querySelector("label") && el.closest(".sf-field").querySelector("label").textContent) || ""));
    if (descEl) descEl.value = buildActivityComment(m);
  };
  // 「読み取る商談」セレクタは各ボタンの隣に置く。リストを保持し、上部の枠は隠す。
  const readWrap = $("sfReadMeetingWrap");
  if (readWrap) readWrap.style.display = "none";
  if (ms.length) {
    const sorted = ms.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    window._sfReadMeetings = sorted;
    window._sfReadBotId = sorted[0].bot_id;
  } else {
    window._sfReadMeetings = [];
  }
  // 読み取る商談セレクタのHTML（ボタンの隣に置く用）
  window._sfReadMeetingSelectHtml = () => {
    const list = window._sfReadMeetings || [];
    if (!list.length) return "";
    return `<select class="sf-select sf-read-inline" data-read-meeting="1">` + list.map((m) => {
      const dd = new Date(m.created_at).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
      const t = (m.title || "(商談名なし)").slice(0, 34);
      return `<option value="${esc(m.bot_id)}" ${m.bot_id === window._sfReadBotId ? "selected" : ""}>${esc(dd)}　${esc(t)}</option>`;
    }).join("") + `</select>`;
  };
  // 商品を追加
  const addProdBtn = $("sfAddProductBtn");
  if (addProdBtn) {
    addProdBtn.onclick = () => {
      if (!sfLinkedOpp) return;
      showProductPrompt($("sfProductMsg"), "", loadProducts);
    };
  }
  const diagBtn = $("sfDiagProductBtn");
  if (diagBtn) {
    diagBtn.onclick = () => {
      const q = prompt("Salesforce全体から探す商品名キーワード（例：エントリー、スタンダード、ライト、DOC）", "エントリー");
      if (q == null) return;
      showProductDiagnose($("sfProductMsg"), q.trim() || "エントリー");
    };
  }
  // 活動記録の「商談から読み取る」
  const taskReadSelWrap = $("sfTaskReadSelWrap");
  if (taskReadSelWrap && window._sfReadMeetingSelectHtml) {
    taskReadSelWrap.innerHTML = window._sfReadMeetingSelectHtml();
    const s = taskReadSelWrap.querySelector("[data-read-meeting]");
    if (s) s.addEventListener("change", () => { window._sfReadBotId = s.value; fillDescFromMeeting(meetingById(s.value)); });
  }
  const taskReadBtn = $("sfTaskReadBtn");
  if (taskReadBtn) {
    taskReadBtn.onclick = async () => {
      const note = $("sfTaskReadNote");
      const botId = window._sfReadBotId || window._sfCurrentBotId;
      if (!botId) { if (note) note.textContent = "対象の商談がありません"; return; }
      const inputs = [...document.querySelectorAll("#sfTaskFields [data-sf-task-field]")];
      const isDesc = (el) => /説明|コメント/.test((el.closest(".sf-field") && el.closest(".sf-field").querySelector("label") && el.closest(".sf-field").querySelector("label").textContent) || "");
      const fList = inputs.filter((el) => !isDesc(el)).map((el) => {
        const api = el.dataset.sfTaskField;
        const t = el.type === "checkbox" ? "boolean" : (el.tagName === "SELECT" ? "picklist" : (el.type === "date" ? "date" : "string"));
        const options = el.tagName === "SELECT" ? [...el.options].map((o) => o.textContent).filter((x) => x && x !== "") : [];
        const label = (el.closest(".sf-field")?.querySelector("label")?.textContent || api).trim();
        return { api, label, type: t, options };
      });
      taskReadBtn.disabled = true; taskReadBtn.textContent = "読み取り中…";
      if (note) note.textContent = "商談の内容を読み取っています…";
      try {
        // 説明は選んだ商談の要約をそのまま入れる
        fillDescFromMeeting(meetingById(botId));
        const r = await sfFetch("/api/salesforce/field-suggest", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ botId, fields: fList }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "取得失敗");
        const values = d.values || {};
        let filled = 0;
        for (const el of inputs) {
          if (isDesc(el)) continue;
          const v = values[el.dataset.sfTaskField];
          if (v == null || v === "") continue;
          if (el.tagName === "SELECT") { const opt = [...el.options].find((o) => o.value === v || o.textContent === v); if (opt) { el.value = opt.value; filled++; } }
          else if (el.type !== "checkbox") { el.value = v; filled++; }
        }
        // 次回アクション日が読み取れなかったときは、商談日の1週間後を仮で入れる
        const dEl = inputs.find((el) => el.type === "date" && /次回アクション日/.test((el.closest(".sf-field")?.querySelector("label")?.textContent) || ""));
        if (dEl && !dEl.value) {
          const base = new Date();
          base.setDate(base.getDate() + 7);
          dEl.value = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
          filled++;
        }
        if (note) note.textContent = `説明に要約を入れ、${filled}項目を読み取りました。確認・編集して記録してください。`;
      } catch (e) {
        if (note) note.textContent = "読み取りに失敗しました：" + e.message;
      } finally {
        taskReadBtn.disabled = false; taskReadBtn.textContent = "商談から読み取る";
      }
    };
  }

  // 活動記録フォームをTaskの実項目から自動生成
  renderTaskFields(account, latestMeeting);


  // ホームから商談IDを渡されたら、検索せずにそのまま紐づける
  if (window._kbOppId) {
    const oppId = window._kbOppId;
    window._kbOppId = "";
    linkOpportunity(oppId);
  }

  // 検索欄に会社名を入れておき、開いたら自動で検索する
  const sfQEl = $("sfSearchQ");
  if (sfQEl && !sfQEl._wired) {
    sfQEl._wired = true;
    if (!sfQEl.value) sfQEl.value = displayName(account);
    sfQEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); searchBtn.click(); }
    });
    // 開いた直後に一度だけ自動検索（何度も走らないように印を付ける）
    if (!sfLinkedOpp && !searchBtn._autoRan) {
      searchBtn._autoRan = true;
      setTimeout(() => searchBtn.click(), 60);
    }
  }

  // 商談検索
  searchBtn.onclick = async () => {
    searchBtn.disabled = true;
    searchBtn.textContent = "検索中…";
    try {
      const qEl = $("sfSearchQ");
      const typed = qEl && qEl.value.trim();
      const companyName = typed || displayName(account);
      if (qEl && !typed) qEl.value = companyName; // 何で探したか分かるように入れておく
      const r = await sfFetch("/api/salesforce/search?q=" + encodeURIComponent(companyName));
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "検索失敗");
      const records = d.records || [];
      if (records.length) {
        // デバッグ: 最初のレコードの全フィールドをログ出力
        const firstRec = records[0];
        const allKeys = Object.keys(firstRec).filter(k => k !== "attributes");
        const customKeys = allKeys.filter(k => k.endsWith("__c"));
        console.log("[SF] 取得フィールド数:", allKeys.length, "うちカスタム:", customKeys.length);
        console.log("[SF] カスタムフィールド一覧:", customKeys.sort().join(", "));
        // SS関連のフィールドを抽出
        const ssKeys = customKeys.filter(k => /ss|SS|apo|Apo|stage|Stage|昇格|appointment/i.test(k));
        if (ssKeys.length) console.log("[SF] SS関連フィールド:", ssKeys.join(", "));
      }
      if (!records.length) {
        matchesEl.innerHTML =
          `<div style="padding:12px;color:#8a938c;font-size:13px;line-height:1.8">
             「${esc(companyName)}」で見つかりませんでした。<br>
             上の欄に別の言い方（正式名称・略称・担当者名など）を入れて、もう一度検索してください。
           </div>`;
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
    } catch (e) {
      if (e.sfReauth) {
        showSfReauth(matchesEl, null, () => searchBtn.click());
      } else {
        matchesEl.innerHTML = `<div style="padding:12px;color:#a32d2d;font-size:13px;">エラー: ${esc(e.message)}</div>`;
      }
    }
    finally { searchBtn.disabled = false; searchBtn.textContent = "商談を検索"; }
  };

  // SF更新ボタン
  const updateBtn = $("sfUpdateBtn");
  if (updateBtn) {
    updateBtn.onclick = async () => {
      if (!sfLinkedOpp) return;
      updateBtn.disabled = true;
      updateBtn.textContent = "更新中…";
      try {
        const fields = {};
        const stage = $("sfStage")?.value;
        if (stage && stage !== sfLinkedOpp.StageName) fields.StageName = stage;
        // 実際のフィールド型を取得し、変更のあった項目だけ型に合わせて送る
        const types = await loadSfFieldTypes();
        document.querySelectorAll("[data-sf-field]").forEach(el => {
          const api = el.dataset.sfField;
          const orig = el.dataset.sfOrig;
          // チェックボックス（boolean）
          if (el.type === "checkbox") {
            const cur = el.checked;
            if (orig !== undefined && (orig === "true") === cur) return; // 変更なし
            fields[api] = cur;
            return;
          }
          const val = (el.value ?? "").trim();
          if (orig !== undefined && val === orig) return; // 変更なしは送らない（既存値の再送防止）
          if (val === "") { if (orig) fields[api] = null; return; } // 値を消した場合のみ空で更新
          const meta = types[api];
          if (meta && meta.updateable === false) return;
          const t = meta ? meta.type : "";
          if (t === "boolean") {
            if (/^(true|1|yes|はい|on|有)$/i.test(val)) fields[api] = true;
            else if (/^(false|0|no|いいえ|off|無)$/i.test(val)) fields[api] = false;
            return;
          }
          if (t === "double" || t === "currency" || t === "int" || t === "percent") {
            const n = Number(val.replace(/[,¥￥\s]/g, ""));
            if (!isNaN(n)) fields[api] = n;
            return;
          }
          fields[api] = val;
        });
        // 「不足項目を入力して再更新」で入れた項目も一緒に送る（別々に送るとバリデーションで弾かれるため）
        if (window._sfExtraFields) Object.assign(fields, window._sfExtraFields);
        let ownerChanged = false;
        if (Object.keys(fields).length) {
          // どの商談から更新したかも送る（ホームの「SF更新まだ」の判定に使う）
          const body = { ...fields };
          const botId = window._sfReadBotId || window._sfCurrentBotId || "";
          if (botId) body.botId = botId;
          const r = await sfFetch("/api/salesforce/opportunity/" + sfLinkedOpp.Id, {
            method: "PATCH", headers: {"content-type":"application/json"},
            body: JSON.stringify(body),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) {
            if (d.sfReauth) { showSfReauth($("sfStageFields")); return; }
            throw new Error(d.error || "更新失敗");
          }
          ownerChanged = !!d.ownerChanged;
        }
        window._sfExtraFields = null;
        kbNotify("Salesforceを更新しました" + (ownerChanged ? "（商談所有者を自分に変更しました）" : ""));
        linkOpportunity(sfLinkedOpp.Id);
      } catch (e) {
        const msg = String(e.message || "");
        if (e.sfReauth || /expired|invalid_grant/.test(msg)) {
          showSfReauth($("sfUpdateMsg"), null, () => updateBtn.click());
        } else if (/取引先責任者の役割|ContactRole|プライマリ|主担当|primary contact/i.test(msg)) {
          showContactRolePrompt($("sfUpdateMsg"), cleanSfError(msg), () => updateBtn.click());
        } else if (/商品|product|OpportunityLineItem|価格表|Pricebook/i.test(msg)) {
          showProductPrompt($("sfUpdateMsg"), cleanSfError(msg), () => updateBtn.click());
        } else if (/の入力が必要|の確認が必要|の選択が必要|の登録が必要|の設定が必要|が必須|required/i.test(msg)) {
          showRequiredFieldsPrompt($("sfUpdateMsg"), cleanSfError(msg), () => updateBtn.click());
        } else {
          $("sfUpdateMsg").innerHTML = `<div class="sf-err-box">更新できませんでした：<br>${esc(cleanSfError(msg))}</div>`;
        }
      }
      finally { updateBtn.disabled = false; updateBtn.textContent = "ステージ・項目を更新"; }
    };
  }

  // 活動記録ボタン
  const taskBtn = $("sfTaskBtn");
  if (taskBtn) {
    taskBtn.onclick = async () => {
      if (!sfLinkedOpp) { kbNotify("先に商談をリンクしてください"); return; }
      taskBtn.disabled = true;
      taskBtn.textContent = "記録中…";
      try {
        // 活動記録フォーム（実項目）の値を型に合わせて集める
        const types = await loadSfTaskTypes();
        const fields = {};
        document.querySelectorAll("[data-sf-task-field]").forEach((el) => {
          const api = el.dataset.sfTaskField;
          if (el.type === "checkbox") { fields[api] = el.checked; return; }
          const val = (el.value ?? "").trim();
          if (val === "") return;
          const t = types[api] ? types[api].type : "";
          if (t === "boolean") {
            if (/^(true|1|yes|はい|on|有)$/i.test(val)) fields[api] = true;
            else if (/^(false|0|no|いいえ|off|無)$/i.test(val)) fields[api] = false;
            return;
          }
          if (t === "double" || t === "currency" || t === "int" || t === "percent") {
            const n = Number(val.replace(/[,¥￥\s]/g, ""));
            if (!isNaN(n)) fields[api] = n;
            return;
          }
          fields[api] = val;
        });
        const r = await sfFetch("/api/salesforce/task", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ opportunityId: sfLinkedOpp.Id, fields }),
        });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          if (d.sfReauth) { showSfReauth($("sfTaskMsg"), null, () => taskBtn.click()); return; }
          throw new Error(d.error || "記録失敗");
        }
        $("sfTaskMsg").innerHTML = '<div style="color:#0d5b47;font-size:13px;padding:6px 2px;">活動を記録しました</div>';
        if (sfLinkedOpp) loadSfTaskHistory(sfLinkedOpp.Id);
      } catch (e) {
        if (e.sfReauth || /expired|invalid_grant/.test(e.message || "")) {
          showSfReauth($("sfTaskMsg"), null, () => taskBtn.click());
        } else {
          kbNotify("記録失敗: " + e.message);
        }
      }
      finally { taskBtn.disabled = false; taskBtn.textContent = "活動を記録"; }
    };
  }

  // ステージのプルダウンは値だけ変える（項目フォームは実項目ベースなので再描画しない＝編集を保持）
}

// Opportunityのページレイアウト（SSセクション）キャッシュ
let sfLayoutSections = null;
async function loadSfLayout() {
  if (sfLayoutSections && sfLayoutSections.length) return sfLayoutSections;
  try {
    const r = await sfFetch("/api/salesforce/opportunity-layout");
    const d = await r.json();
    const secs = d.sections || [];
    if (!secs.length) { sfLayoutSections = null; return []; }
    sfLayoutSections = secs;
  } catch { sfLayoutSections = null; return []; }
  return sfLayoutSections;
}

// 従属ピックリスト（依存関係）用：validFor（base64ビットマップ）を判定関数に変換
function decodeValidFor(b64) {
  if (!b64) return () => false;
  let bytes;
  try { const bin = atob(b64); bytes = []; for (let i = 0; i < bin.length; i++) bytes.push(bin.charCodeAt(i)); }
  catch { return () => false; }
  return (i) => { const byte = bytes[Math.floor(i / 8)]; if (byte == null) return false; return (byte & (0x80 >> (i % 8))) !== 0; };
}
// 制御値に対して有効な従属選択肢を返す
function depValidOptions(field, controllerField, controllerValue) {
  if (!field || !field.picklistValues) return [];
  const opts = (controllerField && controllerField.picklistValues) || [];
  const idx = opts.findIndex((o) => o.value === controllerValue);
  if (idx < 0) return []; // 制御値が未選択・不一致なら空
  return field.picklistValues.filter((o) => decodeValidFor(o.validFor)(idx));
}
function depOptionsHtml(options, selectedVal) {
  return ['<option value=""></option>'].concat(
    (options || []).map((o) => `<option value="${esc(o.value)}" ${o.value === selectedVal ? "selected" : ""}>${esc(o.label || o.value)}</option>`)
  ).join("");
}

// 失注理由の連動（大→中→小）。SFの従属設定が取得できない環境向けに、画像の対応をそのまま使う。
const LOSS_REASON_CASCADE = {
  "予算・タイミング不一致": { "予算が確保できない（来期以降も不可）": [], "予算検討のタイミングでない": [] },
  "採用計画上の理由（規模・状況）": { "採用自体をストップ／縮小している": [], "年間採用人数が少ない（5名以下）": [], "採用が順調で追加施策の必要がない": [] },
  "社内事情・決裁関連": { "親会社やグループ方針による制約": [], "拠点移転や組織変更の影響": [], "担当者の変更で進められなくなった": [], "導入実績の壁がある": [] },
  "他施策負け": { "競合サービスに負けた": ["母集団形成施策", "人材紹介", "HP/LP", "動画", "その他"], "すでに同業サービスを利用している": [], "対面施策を重視している": [] },
  "サービス機能・品質への懸念": { "セキュリティ面への不安": [], "オフィス環境の再現が難しい／公開できない": [], "機能が未実装": [] },
  "バーチャル／オンラインへの抵抗": { "バーチャルそのものに抵抗がある": [] },
  "ニーズ・優先度不足": { "次回接点が取れなかった／途切れた": [], "初回商談リスケ": [], "コンサル（外部）の判断でNG": [] },
  "受注修正のため不要": {},
};
const LOSS_FIELD = { dai: "Loss_Reason__c", chu: "Loss_Reason1__c", sho: "Loss_Reason2__c" };

async function renderSSFields(stageName) {
  const container = $("sfStageFields");
  if (!container) return;
  container.innerHTML = '<div class="empty-state">項目を読み込み中…</div>';
  const opp = sfLinkedOpp || {};
  // describeはラベル・型の補助として使う（取れなくても現在値は出す）
  let meta = {};
  try {
    const list = await loadSfFields();
    for (const f of list) meta[f.name] = f;
  } catch {}

  const SKIP = /^(attributes|Id|IsDeleted|IsClosed|IsWon|SystemModstamp|CreatedById|CreatedDate|LastModifiedById|LastModifiedDate|LastActivityDate|LastViewedDate|LastReferencedDate|StageName|Name|Account|Owner|Amount|Probability|CloseDate|OwnerId|AccountId|RecordTypeId|Fiscal|Forecast)$/i;
  const STD = new Set(["NextStep", "Description"]);

  const typeOf = (api) => {
    if (meta[api]) return meta[api].type;
    const v = opp[api];
    if (typeof v === "boolean") return "boolean";
    if (typeof v === "number") return "double";
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return "date";
    return "string";
  };
  const labelOf = (api) => (meta[api] && meta[api].label) || api;
  // 失注理由の連動用：ラベル↔SF値の変換（更新時は正しいSF値を送る）
  const lossVal = (api, label) => {
    const m = meta[api];
    if (m && m.picklistValues) { const o = m.picklistValues.find((p) => (p.label || p.value) === label); if (o) return o.value; }
    return label;
  };
  const lossLabelOf = (api, val) => {
    const m = meta[api];
    if (m && m.picklistValues) { const o = m.picklistValues.find((p) => p.value === val); if (o) return o.label || o.value; }
    return val || "";
  };
  const lossOptsHtml = (api, labels, selVal) => ['<option value=""></option>'].concat(
    (labels || []).map((lb) => { const v = lossVal(api, lb); return `<option value="${esc(v)}" ${v === selVal ? "selected" : ""}>${esc(lb)}</option>`; })
  ).join("");
  const hasVal = (api) => { const v = opp[api]; return v !== null && v !== undefined && v !== ""; };
  const valStr = (api) => {
    const v = opp[api]; if (v === null || v === undefined || v === "") return "";
    const t = typeOf(api);
    if (t === "date") return String(v).slice(0, 10);
    if (t === "datetime") return String(v).slice(0, 16).replace("T", " ");
    return String(v);
  };
  const render1 = (api) => {
    const t = typeOf(api);
    const label = esc(labelOf(api));
    // 失注理由の連動（大→中→小）は対応表で描画
    if (api === LOSS_FIELD.dai || api === LOSS_FIELD.chu || api === LOSS_FIELD.sho) {
      const curV = valStr(api);
      const orig = ` data-sf-orig="${esc(curV)}"`;
      let labels = [];
      if (api === LOSS_FIELD.dai) {
        labels = Object.keys(LOSS_REASON_CASCADE);
      } else if (api === LOSS_FIELD.chu) {
        const daiL = lossLabelOf(LOSS_FIELD.dai, opp[LOSS_FIELD.dai]);
        labels = LOSS_REASON_CASCADE[daiL] ? Object.keys(LOSS_REASON_CASCADE[daiL]) : [];
      } else {
        const daiL = lossLabelOf(LOSS_FIELD.dai, opp[LOSS_FIELD.dai]);
        const chuL = lossLabelOf(LOSS_FIELD.chu, opp[LOSS_FIELD.chu]);
        labels = (LOSS_REASON_CASCADE[daiL] && LOSS_REASON_CASCADE[daiL][chuL]) || [];
      }
      const role = api === LOSS_FIELD.dai ? "dai" : (api === LOSS_FIELD.chu ? "chu" : "sho");
      return `<div class="sf-field"><label>${label}</label><select class="sf-select" data-sf-field="${api}" data-loss="${role}"${orig}>${lossOptsHtml(api, labels, curV)}</select></div>`;
    }
    if (t === "boolean") {
      const checked = opp[api] === true;
      return `<div class="sf-field sf-field-chk"><label><input type="checkbox" data-sf-field="${api}" data-sf-orig="${checked ? "true" : "false"}" ${checked ? "checked" : ""}/> ${label}</label></div>`;
    }
    const cur = valStr(api);
// 複数選択（チェックボックス）は、選ばれているものだけを出す。
// 選択肢が20個近く並ぶと、その商談に関係ないものまで目に入って選び間違えるため。
// 「ほかの選択肢」を押せば全部出る。
function refreshMpick(wrap) {
  if (!wrap) return;
  const items = [...wrap.querySelectorAll(".sf-mpick-item")];
  const more = wrap.querySelector(".sf-mpick-more");
  if (!more || !items.length) return;
  const checked = items.filter((el) => el.querySelector("input").checked);

  // ひとつも選ばれていないときは、選ぶ手立てが無くなるので全部出す
  if (!checked.length || wrap.dataset.expanded === "1") {
    items.forEach((el) => (el.hidden = false));
    more.hidden = checked.length === 0;
    more.textContent = `選ばれているものだけ表示`;
    return;
  }
  let hidden = 0;
  for (const el of items) {
    const on = el.querySelector("input").checked;
    el.hidden = !on;
    if (!on) hidden++;
  }
  more.hidden = hidden === 0;
  more.textContent = `ほかの選択肢を表示（${hidden}）`;
}

// 「ほかの選択肢」の開閉と、チェックの上げ下げに応じた表示の作り直し
document.addEventListener("click", (ev) => {
  const b = ev.target.closest(".sf-mpick-more");
  if (!b) return;
  ev.preventDefault();
  const wrap = b.closest(".sf-mpick");
  wrap.dataset.expanded = wrap.dataset.expanded === "1" ? "0" : "1";
  refreshMpick(wrap);
});

    const orig = ` data-sf-orig="${esc(cur)}"`;
    const m = meta[api];
    // 複数選択のピックリスト（multipicklist）はチェックボックスで出す。値はセミコロン区切り。
    if (t === "multipicklist" && m && m.picklistValues && m.picklistValues.length) {
      const chosen = new Set(String(cur || "").split(";").map((x) => x.trim()).filter(Boolean));
      const boxes = m.picklistValues.map((o, i) => {
        const on = chosen.has(o.value) || chosen.has(o.label);
        return `<label class="sf-mpick-item"><input type="checkbox" data-mpick="${esc(api)}" value="${esc(o.value)}" ${on ? "checked" : ""}/>${esc(o.label || o.value)}</label>`;
      }).join("");
      return `<div class="sf-field"><label>${label}<span class="sf-api">${esc(api)}</span></label>` +
        `<input type="hidden" class="sf-input" data-sf-field="${esc(api)}"${orig} value="${esc(cur)}"/>` +
        `<div class="sf-mpick" data-mpick-for="${esc(api)}">${boxes}` +
        `<button type="button" class="sf-mpick-more" hidden></button></div></div>`;
    }
    if (t === "picklist" && m && m.picklistValues && m.picklistValues.length) {
      if (m.dependentPicklist && m.controllerName) {
        // 従属ピックリスト：制御値で選択肢を絞る。制御がステージ(StageName)の場合は、
        // 今の商談ステージではなく「選択中の段階」の値で絞る（99失注を選んだら失注用の選択肢）。
        const ctrl = meta[m.controllerName];
        let ctrlVal = opp[m.controllerName];
        if (m.controllerName === "StageName") {
          const stageSel = document.getElementById("sfStage");
          if (stageSel && stageSel.value) ctrlVal = stageSel.value;
        }
        const valid = depValidOptions(m, ctrl, ctrlVal);
        const opts = depOptionsHtml(valid, cur);
        return `<div class="sf-field"><label>${label}</label><select class="sf-select" data-sf-field="${api}" data-dependent-on="${esc(m.controllerName)}"${orig}>${opts}</select></div>`;
      }
      const opts = ['<option value=""></option>'].concat(
        m.picklistValues.map((o) => `<option value="${esc(o.value)}" ${o.value === cur ? "selected" : ""}>${esc(o.label || o.value)}</option>`)
      ).join("");
      return `<div class="sf-field"><label>${label}<span class="sf-api">${esc(api)}</span></label><select class="sf-select" data-sf-field="${api}"${orig}>${opts}</select></div>`;
    }
    if (t === "textarea") return `<div class="sf-field"><label>${label}<span class="sf-api">${esc(api)}</span></label><textarea class="sf-textarea" data-sf-field="${api}"${orig} rows="2">${esc(cur)}</textarea></div>`;
    if (t === "date") return `<div class="sf-field"><label>${label}<span class="sf-api">${esc(api)}</span></label><input type="date" class="sf-input" data-sf-field="${api}"${orig} value="${esc(cur)}"/></div>`;
    return `<div class="sf-field"><label>${label}<span class="sf-api">${esc(api)}</span></label><input type="text" class="sf-input" data-sf-field="${api}"${orig} value="${esc(cur)}"/></div>`;
  };

  // 段階（SS01〜SS06）ごとの項目。画像の項目リストを基準に、describeのラベル→API名で解決する。
  const SS_STAGE_LABELS = [
    { key: "01：アポ獲得", labels: ["SS01昇格日", "担当領域", "アポ獲得日", "初回アポ設定日", "顧客の現状"] },
    { key: "02：有効商談(3ヶ月以内検討)", labels: ["SS02昇格日", "営業種別", "初回提案商品", "初回提案プラン", "利用目的", "担当者が解決したい課題", "商談メモ", "担当者の解決したい課題（その他）", "次回お打合せ日時"] },
    { key: "03：担当者合意", labels: ["SS03昇格日", "今やるべき理由", "比較されてる代替手段", "DOCでないといけない理由", "上申先", "同席打診", "上申日", "上申に必要な書類"] },
    { key: "04：企画決定者合意", labels: ["SS04昇格日", "役員等への業績等に必要な書類", "決裁フロー", "利用開始希望時期", "リーガル・セキュリティチェック", "申込書回収想定日"] },
    { key: "05：決裁者合意", labels: ["目標用_SS05昇格日", "最終的な決裁の決め手"] },
    { key: "06：申込書回収完了", labels: ["SS06昇格日", "キラーコンテンツ", "サーカスNO(メディア用)", "☆受失注日", "納品への引き継ぎ内容"] },
    { key: "99：失注", labels: ["order_date__c", "Loss_Reason__c", "Loss_Reason1__c", "Loss_Reason2__c", "order_reason_detail__c", "失注後次回アクション日"] },
  ];
  const normLbl = (s) => String(s || "").replace(/[\s　()（）:：★☆・_]/g, "").toLowerCase();
  // 項目の取り違えを手で直せるようにする（ラベル→API名の差し替えを保存）
  const OVR_KEY = "kinbot_sf_field_override";
  const loadOvr = () => { try { return JSON.parse(localStorage.getItem(OVR_KEY) || "{}"); } catch { return {}; } };
  let fieldOvr = loadOvr();
  // 同じラベルの項目が複数ある場合に備えて、候補をすべて持つ
  const labelCands = {};
  for (const f of Object.values(meta)) {
    if (!f.label) continue;
    const k = normLbl(f.label);
    (labelCands[k] = labelCands[k] || []).push(f);
  }
  // 選択肢のある項目・独自項目（__c）を優先して1つ選ぶ
  const bestOf = (arr) => {
    if (!arr || !arr.length) return null;
    const score = (f) => {
      let n = 0;
      if (f.picklistValues && f.picklistValues.length) n += 4;
      if (/__c$/.test(f.name)) n += 2;
      if (f.updateable) n += 1;
      return n;
    };
    return arr.slice().sort((a, b) => score(b) - score(a) || String(a.label).length - String(b.label).length)[0];
  };
  const labelToApi = {};
  for (const k of Object.keys(labelCands)) labelToApi[k] = bestOf(labelCands[k]).name;
  // ラベル、またはAPI名（末尾__cなど、metaに存在するもの）で解決する。
  // 組織によって項目名が少し違う（例：同席打診 ↔ 同席打診有無）ので、部分一致でも探す。
  const labelKeys = Object.keys(labelToApi);
  const resolveLabel = (lb) => {
    if (meta[lb]) return lb;
    const n = normLbl(lb);
    if (fieldOvr[n] && meta[fieldOvr[n]]) return fieldOvr[n]; // 手で選び直した項目
    if (labelToApi[n]) return labelToApi[n];
    if (n.length < 3) return null;
    // 部分一致。候補が複数あるときは選択肢つき・独自項目を優先する
    const partial = labelKeys.filter((k) => k.includes(n));
    if (partial.length) {
      const pool = partial.flatMap((k) => labelCands[k] || []);
      const b = bestOf(pool);
      if (b) return b.name;
    }
    const loose = labelKeys.filter((k) => k.length >= 4 && n.includes(k));
    if (loose.length) {
      const b = bestOf(loose.flatMap((k) => labelCands[k] || []));
      if (b) return b.name;
    }
    return null;
  };
  // この組織で必須（空を許さない）になっている項目。段階を問わず必ず出しておく。
  const requiredApis = Object.values(meta)
    .filter((f) => f.updateable && f.nillable === false && !f.defaultedOnCreate && f.name !== "StageName")
    .map((f) => f.name);
  const ssSections = SS_STAGE_LABELS.map((s) => {
    const fields = [];
    const wanted = {}; // API名 → もとの項目名（差し替えのキー）
    for (const lb of s.labels) {
      const api = resolveLabel(lb);
      if (api && !fields.includes(api)) { fields.push(api); wanted[api] = lb; }
    }
    for (const api of requiredApis) if (!fields.includes(api)) fields.push(api);
    return { heading: s.key, fields, wanted };
  }).filter((s) => s.fields.length);

  if (ssSections.length) {
    // 各SS段階に対応するSalesforceのステージ値をマッピング（先頭番号で対応。99などの多桁にも対応）
    const numOf = (s) => { const mm = String(s || "").match(/^\s*0*(\d+)\s*[:：]/); return mm ? mm[1] : null; };
    const matchStage = (heading) => {
      const hNum = numOf(heading);
      const nm = normLbl(heading.replace(/^[0-9]+\s*[:：]\s*/, "").replace(/[／/].*$/, ""));
      const opts = sfStageOptions || [];
      if (!opts.length || !hNum) return "";
      const byNum = opts.filter((o) => numOf(o.value || o.label) === hNum);
      const exact = byNum.find((o) => normLbl(o.value || o.label).includes(nm));
      return (exact || byNum[0] || {}).value || "";
    };
    const stageNum = numOf(stageName);
    let defaultIdx = 0;
    ssSections.forEach((s, i) => { if (stageNum && numOf(s.heading) === stageNum) defaultIdx = i; });
    const optHtml = ssSections.map((s, i) => {
      const sv = matchStage(s.heading);
      return `<option value="${esc(sv)}" data-secidx="${i}" ${i === defaultIdx ? "selected" : ""}>${esc(s.heading)}</option>`;
    }).join("");
    container.innerHTML =
      `<div class="sf-field"><label>ステージ（段階）を選ぶ</label><select id="sfStage" class="sf-select">${optHtml}</select></div>` +
      `<div id="ssSectionFields" class="sf-ss-section"></div>`;
    // 段階の項目を商談から自動入力する
    // 昇格日・受失注日などは「更新しようとしている日（今日）」を既定で入れる
    const fillDefaultDates = () => {
      const today = new Date();
      const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      let n = 0;
      document.querySelectorAll('#ssSectionFields input[type="date"][data-sf-field]').forEach((el) => {
        if (el.value) return;
        const lb = (el.closest(".sf-field") && el.closest(".sf-field").querySelector("label") && el.closest(".sf-field").querySelector("label").textContent) || "";
        if (/昇格日|受失注日|失注日|失注後次回アクション日/.test(lb)) { el.value = ymd; n++; }
      });
      return n;
    };

    // 初回提案商品が読み取れなかったときは「エントリープラン」を入れる。
    // 初回商談での標準提案なので、空のままにして選び忘れるより安全。
    const fillDefaultProduct = () => {
      let n = 0;
      document.querySelectorAll("#ssSectionFields .sf-mpick").forEach((wrap) => {
        const lb = (wrap.closest(".sf-field")?.querySelector("label")?.textContent) || "";
        if (!/初回提案商品/.test(lb)) return;
        if (wrap.querySelector("input[type=checkbox]:checked")) return; // 読み取れていれば触らない
        const box = [...wrap.querySelectorAll("input[type=checkbox]")].find((c) => {
          const t = (c.parentElement.textContent || "").replace(/\s/g, "");
          return c.value === "エントリープラン" || t === "エントリープラン";
        });
        if (!box) return;
        box.checked = true;
        const hidden = document.querySelector(
          `#ssSectionFields input[type="hidden"][data-sf-field="${wrap.dataset.mpickFor}"]`);
        if (hidden) hidden.value = box.value;
        if (typeof refreshMpick === "function") refreshMpick(wrap);
        n++;
      });
      return n;
    };

    const autofillSection = async (sec) => {
      const btn = document.getElementById("ssAutofillBtn");
      const note = document.getElementById("ssAutofillNote");
      const botId = window._sfReadBotId || window._sfCurrentBotId;
      if (!botId) { if (note) note.textContent = "対象の商談が見つかりません"; return; }
      const fList = sec.fields.map((api) => {
        const mm = meta[api] || {};
        const options = (mm.picklistValues || []).map((o) => o.label || o.value);
        return { api, label: mm.label || api, type: mm.type || "string", options };
      });
      if (btn) { btn.disabled = true; btn.textContent = "商談から読み取り中…"; }
      if (note) note.textContent = "商談の内容を読み取っています…";
      try {
        const r = await sfFetch("/api/salesforce/field-suggest", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ botId, fields: fList }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "取得失敗");
        const values = d.values || {};
        let filled = 0;
        const inputs = [...document.querySelectorAll("#ssSectionFields [data-sf-field]")];
        // 選択肢は「大→中→小」の順に入れる（中は大を選ぶまで選択肢が出ないため）
        const selects = inputs.filter((el) => el.tagName === "SELECT");
        const others = inputs.filter((el) => el.tagName !== "SELECT");
        const setSelect = (el, v) => {
          const opt = [...el.options].find((o) => o.value === v || o.textContent === v) ||
                      [...el.options].find((o) => o.textContent && v && o.textContent.includes(v));
          if (opt && !el.value) {
            el.value = opt.value;
            el.dispatchEvent(new Event("change", { bubbles: true })); // 従属の選択肢を作り直す
            return true;
          }
          return false;
        };
        // 親（従属でないもの）→ 子（従属）の順
        const parents = selects.filter((el) => !el.dataset.dependentOn);
        const children = selects.filter((el) => el.dataset.dependentOn);
        for (const el of parents) { const v = values[el.dataset.sfField]; if (v) filled += setSelect(el, v) ? 1 : 0; }
        await new Promise((ok) => setTimeout(ok, 30));
        for (const el of children) { const v = values[el.dataset.sfField]; if (v) filled += setSelect(el, v) ? 1 : 0; }
        for (const el of others) {
          const v = values[el.dataset.sfField];
          if (v == null || v === "" || el.type === "checkbox") continue;

          // 複数選択（チェックボックス）は、既に値が入っていても読み取り結果を反映する。
          // ここで el.value を見て飛ばすと、初期値が入っている項目が一生埋まらない。
          const mwrap = document.querySelector(`[data-mpick-for="${el.dataset.sfField}"]`);
          if (mwrap) {
            const norm = (x) => String(x || "").replace(/[\s　（）()]/g, "").toLowerCase();
            const wants = String(v).split(/[;；、,，・\n]+/).map((x) => x.trim()).filter(Boolean);
            let hit = false;
            mwrap.querySelectorAll("input[type=checkbox]").forEach((c) => {
              const lb = (c.parentElement.textContent || "").trim();
              const match = wants.some((w) =>
                norm(c.value) === norm(w) || norm(lb) === norm(w) ||
                (norm(w).length >= 2 && (norm(lb).includes(norm(w)) || norm(w).includes(norm(lb)))));
              if (match) { c.checked = true; hit = true; }
            });
            if (hit) {
              el.value = [...mwrap.querySelectorAll("input[type=checkbox]:checked")].map((c) => c.value).join(";");
              filled++;
            }
            // 読み取ったあと、選ばれていない選択肢は畳む
            if (typeof refreshMpick === "function") refreshMpick(mwrap);
            continue;
          }

          if (el.value) continue;
          el.value = v; filled++;
        }
        filled += fillDefaultDates();
        filled += fillDefaultProduct();
        if (note) note.textContent = filled ? `${filled}項目を自動入力しました。内容を確認・編集してから更新してください。` : "商談から埋められる項目はありませんでした。";
      } catch (e) {
        if (note) note.textContent = "自動入力に失敗しました：" + e.message;
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "商談から自動入力"; }
      }
    };
    // スマホでは項目が縦に長くなりすぎるので、5つずつのページに分ける
    const paginateFields = (box) => {
      if (!box || !(window.matchMedia && window.matchMedia("(max-width: 760px)").matches)) return;
      const fields = [...box.querySelectorAll(".sf-field, .ln-missing, .ln-group")];
      if (fields.length <= 6) return;
      const per = 5;
      const pages = [];
      for (let i = 0; i < fields.length; i += per) pages.push(fields.slice(i, i + per));
      const wrap = document.createElement("div");
      wrap.className = "sf-step-pages";
      pages.forEach((group, i) => {
        const pg = document.createElement("div");
        pg.className = "sf-step-page" + (i === 0 ? " is-on" : "");
        group.forEach((f) => pg.appendChild(f));
        wrap.appendChild(pg);
      });
      const nav = document.createElement("div");
      nav.className = "sf-step-nav";
      nav.innerHTML =
        `<button type="button" class="btn sf-btn-secondary" data-step="-1">戻る</button>
         <span class="sf-step-count">1 / ${pages.length}</span>
         <button type="button" class="btn" data-step="1">次へ</button>`;
      box.appendChild(wrap);
      box.appendChild(nav);
      let cur = 0;
      const show = () => {
        wrap.querySelectorAll(".sf-step-page").forEach((p, i) => p.classList.toggle("is-on", i === cur));
        nav.querySelector(".sf-step-count").textContent = `${cur + 1} / ${pages.length}`;
        nav.querySelector('[data-step="-1"]').disabled = cur === 0;
        const next = nav.querySelector('[data-step="1"]');
        next.textContent = cur === pages.length - 1 ? "入力おわり" : "次へ";
        box.scrollIntoView({ behavior: "smooth", block: "nearest" });
      };
      nav.addEventListener("click", (e) => {
        const b = e.target.closest("[data-step]");
        if (!b) return;
        const d = Number(b.dataset.step);
        if (d > 0 && cur === pages.length - 1) {
          const btn = document.getElementById("sfUpdateBtn");
          if (btn) btn.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
        cur = Math.max(0, Math.min(pages.length - 1, cur + d));
        show();
      });
      show();
    };

    const renderSection = (idx, auto) => {
      const sec = ssSections[idx];
      const box = document.getElementById("ssSectionFields");
      box.innerHTML = `<div class="sf-ss-title">${esc(sec.heading)} の項目</div>` +
        `<div class="sf-autofill-row"><button type="button" class="btn btn-ghost" id="ssAutofillBtn">商談から自動入力</button>${window._sfReadMeetingSelectHtml ? window._sfReadMeetingSelectHtml() : ""}<span class="sf-autofill-note" id="ssAutofillNote">選んだ商談の内容で空欄を埋めます</span></div>` +
        (sec.fields.length ? sec.fields.map(render1).join("") : '<div class="sf-ss-note">この段階に編集できる項目がありません。</div>');
      // ボタンの取り付けは、いちばん先に行う。
      // あとの処理（選択肢の組み立てなど）でつまずいても、
      // 「押しても反応しない」状態にならないようにするため。
      // 枠ごと受け止める（ボタンを作り直しても効く／二重には動かない）
      box._autofillSec = sec;
      if (!box._autofillDelegated) {
        box._autofillDelegated = true;
        box.addEventListener("click", (ev) => {
          const b = ev.target && ev.target.closest && ev.target.closest("#ssAutofillBtn");
          if (!b || b.disabled) return;
          autofillSection(box._autofillSec);
        });
      }

      // 読み取る商談セレクタの変更を反映
      box.querySelectorAll("[data-read-meeting]").forEach((s) => s.addEventListener("change", () => { window._sfReadBotId = s.value; }));
      // ここから下は、途中でつまずいてもボタンが動くように、まとめて包む
      try {

      // 複数選択ピックリスト：チェックの内容をセミコロン区切りでまとめる
      const syncMpick = (api) => {
        const wrap = box.querySelector(`[data-mpick-for="${api}"]`);
        const hidden = box.querySelector(`input[type="hidden"][data-sf-field="${api}"]`);
        if (!wrap || !hidden) return;
        hidden.value = [...wrap.querySelectorAll("input[type=checkbox]:checked")].map((c) => c.value).join(";");
      };
      box.querySelectorAll("[data-mpick]").forEach((c) => {
        c.addEventListener("change", () => syncMpick(c.dataset.mpick));
      });
      // 描いた直後に、選ばれていない選択肢を畳む
      box.querySelectorAll(".sf-mpick").forEach((w) => refreshMpick(w));
      // 従属ピックリスト（大→中→小）の連動を配線
      box.querySelectorAll("select[data-dependent-on]").forEach((depSel) => {
        const depApi = depSel.dataset.sfField;
        const ctrlApi = depSel.dataset.dependentOn;
        const ctrlSel = [...box.querySelectorAll("select[data-sf-field]")].find((s) => s.dataset.sfField === ctrlApi);
        if (!ctrlSel) return;
        ctrlSel.addEventListener("change", () => {
          const valid = depValidOptions(meta[depApi], meta[ctrlApi], ctrlSel.value);
          const prev = depSel.value;
          depSel.innerHTML = depOptionsHtml(valid, valid.some((o) => o.value === prev) ? prev : "");
          depSel.dispatchEvent(new Event("change")); // さらに下位（小項目）へ連鎖
        });
      });
      // 失注理由の連動（大→中→小）を対応表で配線
      const daiSel = box.querySelector('select[data-loss="dai"]');
      const chuSel = box.querySelector('select[data-loss="chu"]');
      const shoSel = box.querySelector('select[data-loss="sho"]');
      const fillSho = () => {
        if (!shoSel) return;
        const daiL = lossLabelOf(LOSS_FIELD.dai, daiSel ? daiSel.value : "");
        const chuL = lossLabelOf(LOSS_FIELD.chu, chuSel ? chuSel.value : "");
        const labels = (LOSS_REASON_CASCADE[daiL] && LOSS_REASON_CASCADE[daiL][chuL]) || [];
        shoSel.innerHTML = lossOptsHtml(LOSS_FIELD.sho, labels, shoSel.value);
      };
      const fillChu = () => {
        if (!chuSel) return;
        const daiL = lossLabelOf(LOSS_FIELD.dai, daiSel ? daiSel.value : "");
        const labels = LOSS_REASON_CASCADE[daiL] ? Object.keys(LOSS_REASON_CASCADE[daiL]) : [];
        chuSel.innerHTML = lossOptsHtml(LOSS_FIELD.chu, labels, chuSel.value);
        fillSho();
      };
      if (daiSel) daiSel.addEventListener("change", fillChu);
      if (chuSel) chuSel.addEventListener("change", fillSho);
      fillDefaultDates(); // 昇格日などに今日の日付を入れておく
      paginateFields(box); // スマホでは項目を数個ずつに分ける

      } catch (e) {
        console.error("[SF] 項目の組み立てでつまずきました:", e);
        const note = box.querySelector("#ssAutofillNote");
        if (note) note.textContent = "一部の項目を作れませんでした（自動入力は使えます）";
      }

      if (auto && sec.fields.length) autofillSection(sec); // 段階を選んだら自動で読み取り
    };
    const sel = document.getElementById("sfStage");
    if (sel) sel.addEventListener("change", () => {
      const idx = Number((sel.selectedOptions[0] && sel.selectedOptions[0].dataset.secidx) || 0);
      renderSection(idx, true);
    });
    renderSection(defaultIdx, false);
    // ホームの「失注にする」から来たときは、自動で99失注を選んでステージタブを開く
    if (window._kbAutoLose && sel) {
      window._kbAutoLose = false;
      const loseIdx = ssSections.findIndex((s) => /^0*99[:：]|失注/.test(s.heading));
      if (loseIdx >= 0) {
        const opt = [...sel.options].find((o) => Number(o.dataset.secidx) === loseIdx);
        if (opt) { sel.value = opt.value; renderSection(loseIdx, true); }
      }
      const stageTab = document.querySelector('.sf-subtab[data-sftab="stage"]');
      if (stageTab) stageTab.click();
    }
    return;
  }

  // フォールバック：レイアウトが取れない場合は「現在SFに記載されている項目 / その他」
  const apiSet = new Set();
  for (const f of Object.values(meta)) {
    if (!f.updateable) continue;
    if (SKIP.test(f.name)) continue;
    if (["reference", "address", "location"].includes(f.type)) continue;
    if (f.custom || STD.has(f.name)) apiSet.add(f.name);
  }
  for (const k of Object.keys(opp)) {
    if (SKIP.test(k)) continue;
    const v = opp[k];
    if (k.endsWith("__c") && v !== null && v !== undefined && v !== "") apiSet.add(k);
  }
  const apis = [...apiSet];
  if (!apis.length) { renderSSFieldsStatic(stageName); return; }
  const withVal = apis.filter(hasVal);
  const empty = apis.filter((a) => !hasVal(a));
  let html = "";
  if (withVal.length) {
    html += `<div class="sf-ss-section sf-ss-current"><div class="sf-ss-title">● 現在SFに記載されている項目（そのまま編集できます）</div>${withVal.map(render1).join("")}</div>`;
  } else {
    html += `<div class="sf-ss-note">この商談にはまだ記載済みの項目がありません。下から項目を開いて入力できます。</div>`;
  }
  html += `<details class="sf-empty-fields"><summary>その他の項目（${empty.length}）を表示</summary><div class="sf-empty-inner">${empty.map(render1).join("")}</div></details>`;
  container.innerHTML = html;
}

// describe取得に失敗した場合のフォールバック（推測のSS_FIELDS）
function renderSSFieldsStatic(stageName) {
  const container = $("sfStageFields");
  if (!container) return;
  let html = "";
  for (const [ssLabel, fields] of Object.entries(SS_FIELDS)) {
    const ssNum = ssLabel.match(/^(\d+)/)?.[1] || "";
    const isCurrent = stageName && stageName.includes(ssNum);
    html += `<div class="sf-ss-section ${isCurrent ? "sf-ss-current" : "sf-ss-other"}">`;
    html += `<div class="sf-ss-title">${isCurrent ? "● " : ""}${esc(ssLabel)} の項目</div>`;
    html += fields.map((f) => {
      const currentVal = sfLinkedOpp?.[f.api] || "";
      if (f.type === "textarea") return `<div class="sf-field"><label>${esc(f.label)}</label><textarea class="sf-textarea" data-sf-field="${f.api}" rows="2">${esc(currentVal)}</textarea></div>`;
      if (f.type === "date" || f.type === "datetime") return `<div class="sf-field"><label>${esc(f.label)}</label><input type="date" class="sf-input" data-sf-field="${f.api}" value="${esc(String(currentVal).slice(0, 10))}" /></div>`;
      return `<div class="sf-field"><label>${esc(f.label)}</label><input type="text" class="sf-input" data-sf-field="${f.api}" value="${esc(currentVal)}" /></div>`;
    }).join("");
    html += `</div>`;
  }
  container.innerHTML = html;
}

async function linkOpportunity(oppId, cached) {
  window._sfExtraFields = null; // 前の商談で入力した不足項目を持ち越さない
  sfLinkedOpp = cached || null;
  const linkedEl = $("sfLinked");
  const matchesEl = $("sfMatches");
  const infoEl = $("sfLinkedInfo");

  // Stage選択肢を取得（失敗してもcachedデータで進む）
  if (!sfStageOptions.length) {
    try {
      const r = await sfFetch("/api/salesforce/stages");
      if (r.ok) {
        const d = await r.json();
        sfStageOptions = d.stages || [];
      }
    } catch {}
  }

  // 追加取得は試みるが、失敗してもcachedで進む（cachedを上書きしない）
  try {
    const r = await sfFetch("/api/salesforce/opportunity/" + oppId);
    if (r.ok) {
      const full = await r.json();
      // cachedにないフィールドだけマージ
      sfLinkedOpp = { ...sfLinkedOpp, ...full };
    }
  } catch {}

  if (!sfLinkedOpp) {
    matchesEl.innerHTML = '<div style="padding:12px;color:#a32d2d;font-size:13px;">商談データがありません</div>';
    return;
  }
  matchesEl.innerHTML = "";
  linkedEl.style.display = "";

  const stageName = sfLinkedOpp.StageName || "";
  const accountName = sfLinkedOpp.Account?.Name || sfLinkedOpp.AccountName__c || "";

  infoEl.innerHTML = `<div class="sf-linked-card">
    <div class="sf-linked-name">${esc(sfLinkedOpp.Name)}</div>
    <div class="sf-linked-meta">${esc(accountName)} · Stage: ${esc(stageName)} · Close: ${sfLinkedOpp.CloseDate || "未定"}</div>
    ${sfLinkedOpp.NextStep ? `<div class="sf-linked-next">Next Step: ${esc(sfLinkedOpp.NextStep)}</div>` : ""}
    <button class="sf-unlink-btn" onclick="sfLinkedOpp=null;$('sfLinked').style.display='none';$('sfMatches').innerHTML='';">解除</button>
  </div>`;

  // SS段階のプルダウン＋項目を表示（#sfStageはrenderSSFields内で生成）
  renderSSFields(stageName);
  loadSfTaskHistory(sfLinkedOpp.Id);
  loadProducts();
}

// 登録済み商品の一覧・編集・削除
async function loadProducts() {
  const box = $("sfProducts");
  if (!box || !sfLinkedOpp) return;
  box.innerHTML = '<div class="sf-ss-note">読み込み中…</div>';
  try {
    const r = await sfFetch("/api/salesforce/line-items?opportunityId=" + encodeURIComponent(sfLinkedOpp.Id));
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "取得失敗");
    const items = d.items || [];
    if (!items.length) { box.innerHTML = '<div class="sf-ss-note">まだ商品が登録されていません。</div>'; return; }
    box.innerHTML = items.map((it) => `
      <div class="sf-prod-item" data-id="${esc(it.id)}">
        <div class="sf-prod-name">${esc(it.name)}</div>
        <div class="sf-prod-row">
          <label>数量<input type="text" class="sf-input" data-pf="Quantity" value="${it.quantity != null ? esc(String(it.quantity)) : ""}"/></label>
          <label>単価<input type="text" class="sf-input" data-pf="UnitPrice" value="${it.unitPrice != null ? esc(String(it.unitPrice)) : ""}"/></label>
          <label>提供日<input type="date" class="sf-input" data-pf="ServiceDate" value="${esc((it.serviceDate || "").slice(0, 10))}"/></label>
        </div>
        <div class="sf-prod-actions"><button class="btn btn-ghost sf-prod-save" type="button">保存</button><button class="btn btn-ghost sf-prod-del" type="button">削除</button></div>
      </div>`).join("");
    box.querySelectorAll(".sf-prod-item").forEach((el) => {
      const id = el.dataset.id;
      el.querySelector(".sf-prod-save").addEventListener("click", async () => {
        const fields = {};
        el.querySelectorAll("[data-pf]").forEach((inp) => {
          const v = (inp.value || "").trim(); const k = inp.dataset.pf;
          if (v === "") return;
          if (k === "Quantity" || k === "UnitPrice") { const n = Number(v.replace(/[,¥￥\s]/g, "")); if (!isNaN(n)) fields[k] = n; }
          else fields[k] = v;
        });
        const btn = el.querySelector(".sf-prod-save"); btn.disabled = true; btn.textContent = "保存中…";
        try {
          const rr = await sfFetch("/api/salesforce/line-item/" + encodeURIComponent(id), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(fields) });
          const dd = await rr.json().catch(() => ({}));
          if (!rr.ok) throw new Error(dd.error || "保存失敗");
          $("sfProductMsg").innerHTML = '<div style="color:#0d5b47;font-size:12px;padding:4px 2px;">商品を更新しました</div>';
          loadProducts();
        } catch (e) { $("sfProductMsg").innerHTML = `<div class="sf-ss-note">保存に失敗：${esc(cleanSfError(e.message))}</div>`; btn.disabled = false; btn.textContent = "保存"; }
      });
      el.querySelector(".sf-prod-del").addEventListener("click", async () => {
        if (!confirm("この商品を削除しますか？")) return;
        try {
          const rr = await sfFetch("/api/salesforce/line-item/" + encodeURIComponent(id), { method: "DELETE" });
          const dd = await rr.json().catch(() => ({}));
          if (!rr.ok) throw new Error(dd.error || "削除失敗");
          loadProducts();
        } catch (e) { $("sfProductMsg").innerHTML = `<div class="sf-ss-note">削除に失敗：${esc(cleanSfError(e.message))}</div>`; }
      });
    });
  } catch (e) {
    box.innerHTML = `<div class="sf-ss-note">商品の取得に失敗しました：${esc(cleanSfError(e.message))}</div>`;
  }
}

// 商談に紐づく過去の活動（Task）を表示
// 親（ホームのモーダル）から「過去の活動を読み直して」と言われたときに応じる
try {
  window.addEventListener("message", (ev) => {
    const d = ev && ev.data;
    if (!d || d.type !== "kb-sf-reload-tasks") return;
    const id = (window.sfLinkedOpp && (sfLinkedOpp.Id || sfLinkedOpp.id)) || "";
    if (id) loadSfTaskHistory(id);
  });
} catch {}

// 埋め込みのとき、いま紐づいている商談を親に伝える（次回アクションをSFへ書くために使う）
function postLinkedOpp(opp) {
  try {
    if (!document.body.classList.contains("kb-embed")) return;
    parent.postMessage({
      type: "kb-sf-opp",
      id: (opp && (opp.Id || opp.id)) || "",
      name: (opp && (opp.Name || opp.name)) || "",
    }, "*");
  } catch {}
}

async function loadSfTaskHistory(oppId) {
  const box = $("sfTaskHistory");
  if (!box || !oppId) return;
  postLinkedOpp(sfLinkedOpp || { Id: oppId });
  box.innerHTML = '<div class="sf-ss-note">読み込み中…</div>';
  try {
    const r = await sfFetch("/api/salesforce/tasks?opportunityId=" + encodeURIComponent(oppId));
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "取得失敗");
    const tasks = d.tasks || [];
    if (!tasks.length) { box.innerHTML = '<div class="sf-ss-note">まだ活動の記録がありません。</div>'; return; }
    box.innerHTML = tasks.map((t) => {
      const date = (t.activityDate || (t.createdDate || "").slice(0, 10) || "");
      const desc = (t.description || "").trim();
      const short = desc.length > 140 ? desc.slice(0, 140) + "…" : desc;
      // 次回アクション（種別・日）と説明は、別々の行に分けて見せる
      const nextDate = (t.nextDate || "").slice(0, 10);
      const late = nextDate && !t.isClosed && new Date(nextDate + "T23:59:59").getTime() < Date.now();
      // 次回アクションがある活動だけ、その行にチェックを出す。
      // チェック＝この次回アクションが終わった（Salesforceの状況を「完了」にする）。
      const hasNext = !!(t.nextKind || nextDate);
      const nextRow = hasNext
        ? `<label class="sf-task-row sf-task-nextrow${t.isClosed ? " sf-next-done" : ""}" title="チェックすると、この次回アクションを完了にします">
             <span class="sf-task-k">次回アクション</span>
             <span class="sf-next-body">
               <input type="checkbox" class="sf-task-done-chk" ${t.isClosed ? "checked" : ""} />
               <span class="sf-next-label">${t.nextKind ? esc(t.nextKind) : "（種別なし）"}</span>
               ${nextDate ? `<span class="sf-task-next${late && !t.isClosed ? " sf-task-late" : ""}" data-late="${late ? "1" : "0"}">${esc(nextDate)}</span>` : ""}
               <span class="sf-next-state">${t.isClosed ? "完了" : "未完了"}</span>
             </span>
           </label>`
        : "";

      const rows =
        (t.actKind ? `<div class="sf-task-row"><span class="sf-task-k">活動種別</span><span>${esc(t.actKind)}</span></div>` : "") +
        nextRow +
        (short ? `<div class="sf-task-row"><span class="sf-task-k">説明</span><span class="sf-task-desc">${esc(short)}</span></div>` : "");

      return `<div class="sf-task-item" data-tid="${esc(t.id)}" data-subject="${esc(t.subject || "")}" data-status="${esc(t.status || "")}" data-date="${esc(t.activityDate || "")}" data-desc="${esc(t.description || "")}">
        <div class="sf-task-head">
          <span class="sf-task-subj">${esc(t.subject || "(件名なし)")}</span>
          <span class="sf-task-meta">${esc(date)}${t.owner ? " ・ " + esc(t.owner) : ""}</span>
        </div>
        ${rows}
        <div class="sf-task-actions"><button type="button" class="btn btn-ghost sf-task-edit">編集</button><button type="button" class="btn btn-ghost sf-task-del">削除</button></div>
      </div>`;
    }).join("");
    box.querySelectorAll(".sf-task-item").forEach((el) => wireTaskItem(el, oppId));
    // チェックで Salesforce の状況（完了／未着手）を切り替える
    box.querySelectorAll(".sf-task-done-chk").forEach((c) => {
      c.addEventListener("change", async (ev) => {
        ev.stopPropagation();
        const item = c.closest(".sf-task-item");
        c.disabled = true;
        try {
          const r = await sfFetch(`/api/salesforce/task/${encodeURIComponent(item.dataset.tid)}/status`, {
            method: "PUT", headers: { "content-type": "application/json" },
            body: JSON.stringify({ done: c.checked }),
          });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || "変更できませんでした");
          const row = c.closest(".sf-task-nextrow");
          if (row) {
            row.classList.toggle("sf-next-done", c.checked);
            const st = row.querySelector(".sf-next-state");
            if (st) st.textContent = c.checked ? "完了" : "未完了";
            // 完了にしたら、期限切れの赤は消す
            const nd = row.querySelector(".sf-task-next");
            if (nd) nd.classList.toggle("sf-task-late", !c.checked && nd.dataset.late === "1");
          }
        } catch (e) {
          alert("状況を変更できませんでした：" + e.message);
          c.checked = !c.checked;
        } finally { c.disabled = false; }
      });
      // 行のクリックで編集モードに入らないようにする
      const row = c.closest(".sf-task-nextrow");
      if (row) row.addEventListener("click", (ev) => ev.stopPropagation());
    });
  } catch (e) {
    box.innerHTML = `<div class="sf-ss-note">履歴の取得に失敗しました：${esc(e.message)}</div>`;
  }
}

function wireTaskItem(el, oppId) {
  const tid = el.dataset.tid;
  el.querySelector(".sf-task-edit").addEventListener("click", () => {
    if (el.querySelector(".sf-task-editbox")) return; // 既に編集中
    const subject = el.dataset.subject, status = el.dataset.status, date = (el.dataset.date || "").slice(0, 10), desc = el.dataset.desc;
    const box = document.createElement("div");
    box.className = "sf-task-editbox";
    box.innerHTML =
      `<div class="sf-field"><label>件名</label><input type="text" class="sf-input" data-tf="Subject" value="${esc(subject)}"/></div>` +
      `<div class="sf-field"><label>期日</label><input type="date" class="sf-input" data-tf="ActivityDate" value="${esc(date)}"/></div>` +
      `<div class="sf-field"><label>状況</label><input type="text" class="sf-input" data-tf="Status" value="${esc(status)}"/></div>` +
      `<div class="sf-field"><label>説明</label><textarea class="sf-textarea" data-tf="Description" rows="3">${esc(desc)}</textarea></div>` +
      `<div class="sf-task-actions"><button type="button" class="btn sf-task-save">保存</button><button type="button" class="btn btn-ghost sf-task-cancel">キャンセル</button></div><div class="sf-ss-note sf-task-msg"></div>`;
    el.appendChild(box);
    box.querySelector(".sf-task-cancel").addEventListener("click", () => box.remove());
    box.querySelector(".sf-task-save").addEventListener("click", async () => {
      const fields = {};
      box.querySelectorAll("[data-tf]").forEach((inp) => { const v = (inp.value || "").trim(); if (v !== "") fields[inp.dataset.tf] = v; });
      const btn = box.querySelector(".sf-task-save"); btn.disabled = true; btn.textContent = "保存中…";
      try {
        const rr = await sfFetch("/api/salesforce/task/" + encodeURIComponent(tid), { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(fields) });
        const dd = await rr.json().catch(() => ({}));
        if (!rr.ok) throw new Error(dd.error || "保存失敗");
        loadSfTaskHistory(oppId);
      } catch (e) { box.querySelector(".sf-task-msg").textContent = "保存に失敗：" + cleanSfError(e.message); btn.disabled = false; btn.textContent = "保存"; }
    });
  });
  el.querySelector(".sf-task-del").addEventListener("click", async () => {
    if (!confirm("この活動を削除しますか？")) return;
    try {
      const rr = await sfFetch("/api/salesforce/task/" + encodeURIComponent(tid), { method: "DELETE" });
      const dd = await rr.json().catch(() => ({}));
      if (!rr.ok) throw new Error(dd.error || "削除失敗");
      loadSfTaskHistory(oppId);
    } catch (e) { kbNotify("削除に失敗：" + cleanSfError(e.message)); }
  });
}

// ===== カードプレビューの更新 =====
function updateCardPreviews(account, ms) {
  const pk = primaryOf(account);
  const np = lookupNewProc(displayName(account)) || lookupNewProc(account);

  // 進捗・判定プレビュー
  const judgePreview = document.getElementById("dcPreviewJudge");
  if (judgePreview && np) {
    const phase = np.phase != null ? `Phase ${np.phase}` : "";
    const status = statusOf(account) || "";
    const nextDate = np.next_meeting_date ? String(np.next_meeting_date).slice(5, 10).replace("-", "/") : "";
    const parts = [status, phase, nextDate ? `次回 ${nextDate}` : ""].filter(Boolean);
    judgePreview.textContent = parts.join(" / ") || `${ms.length}回の商談`;
  } else if (judgePreview) {
    judgePreview.textContent = `${ms.length}回の商談`;
  }

  // 会社プレビュー
  const profPreview = document.getElementById("dcPreviewProfile");
  if (profPreview) {
    const acc = accountsMap[pk];
    if (acc && acc.profile) {
      const p = acc.profile;
      const parts = [p.industry, p.employee_count ? p.employee_count + "人" : "", p.hq_region].filter(Boolean);
      profPreview.textContent = parts.join(" / ") || "プロフィール取得済み";
    } else {
      profPreview.textContent = "未取得（クリックで検索）";
    }
  }

  // 提案資料プレビュー
  const propPreview = document.getElementById("dcPreviewProposals");
  if (propPreview) {
    const propList = document.getElementById("proposalList");
    if (propList) {
      const cards = propList.querySelectorAll(".proposal-card");
      propPreview.textContent = cards.length ? `${cards.length}件の資料` : "未登録";
    }
  }
}
