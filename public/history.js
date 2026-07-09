// public/history.js
const hlist = document.getElementById("hlist");
const hdetail = document.getElementById("hdetail");

const PHASES = [
  { code: "01", label: "01 初回商談" },
  { code: "02", label: "02 有効商談" },
  { code: "03", label: "03 担当者合意" },
  { code: "04", label: "04 企画決定者合意" },
];
const phaseLabel = (c) => (PHASES.find((p) => p.code === c) || {}).label || "";

let allMeetings = [];
let usersCache = null;

// 商談名から種別（コールド/過去失注）を自動判定する
function inferDealKind(title) {
  const t = String(title || "").toLowerCase();
  // 過去失注（表記ゆれに対応）
  if (/過去失注|既存失注|失注済|再アプローチ|掘り起こし|ほりおこし/.test(title || "")) return "過去失注";
  // コールド（日本語・英語・カタカナ表記に対応）
  if (/コールド|新規開拓|テレアポ|飛び込み|とびこみ/.test(title || "") || /\bcold\b/.test(t)) return "コールド";
  return "";
}

// JSTのISO ⇄ datetime-local 文字列
function isoToLocalInput(iso) {
  try {
    return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16);
  } catch {
    return "";
  }
}
function localInputToIso(v) {
  // 入力（JSTのwall-clock）を +09:00 とみなしてISO化
  const s = v.length <= 16 ? v + ":00+09:00" : v + "+09:00";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toISOString();
}
function jstToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function shiftDate(dateStr, delta) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
// カレンダー予定ピッカー（日付切替つき）
function openCalPicker(panel, onPick) {
  panel.hidden = false;
  let date = jstToday();
  const render = async () => {
    panel.innerHTML = `<div class="cal-bar"><button type="button" class="cal-nav" data-d="-1">‹</button><input type="date" class="cal-date" value="${date}"><button type="button" class="cal-nav" data-d="1">›</button></div><div class="cal-list"><div class="cal-empty">読み込み中…</div></div>`;
    const dateInput = panel.querySelector(".cal-date");
    const list = panel.querySelector(".cal-list");
    panel.querySelectorAll(".cal-nav").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        date = shiftDate(date, Number(b.dataset.d));
        render();
      })
    );
    dateInput.addEventListener("click", (e) => e.stopPropagation());
    dateInput.addEventListener("change", () => {
      date = dateInput.value || date;
      render();
    });
    try {
      const d = await (await fetch("/api/calendar/events?date=" + encodeURIComponent(date))).json();
      if (!d.connected) {
        list.innerHTML = '<div class="cal-empty">カレンダー未連携です。「設定」から連携してください。</div>';
        return;
      }
      const events = d.events || [];
      if (!events.length) {
        list.innerHTML = d.filtered
          ? '<div class="cal-empty">条件に一致する予定はありません（設定のフィルター文字を確認）。</div>'
          : '<div class="cal-empty">この日の予定はありません。</div>';
        return;
      }
      list.innerHTML = "";
      for (const ev of events) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "calp-row";
        const time = ev.allDay
          ? "終日"
          : new Date(ev.start).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
        row.innerHTML = `<span class="cal-time"></span><span class="cal-name"></span>${ev.url ? '<span class="cal-mark">URL</span>' : ""}`;
        row.querySelector(".cal-time").textContent = time;
        row.querySelector(".cal-name").textContent = ev.title;
        row.addEventListener("click", () => {
          onPick(ev);
          panel.hidden = true;
        });
        list.appendChild(row);
      }
    } catch {
      list.innerHTML = '<div class="cal-empty">読み込みに失敗しました。</div>';
    }
  };
  render();
}
// パネル外クリックで閉じる
document.addEventListener("click", (e) => {
  document.querySelectorAll(".cal-panel").forEach((p) => {
    if (!p.hidden && !p.contains(e.target) && !(e.target.id === "calBtnH")) p.hidden = true;
  });
});
async function loadUsers() {
  if (usersCache) return usersCache;
  try {
    usersCache = await (await fetch("/api/users")).json();
  } catch {
    usersCache = [];
  }
  return usersCache || [];
}

const fmtDate = (s) => {
  try {
    return new Date(s).toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return s || "";
  }
};
const labelOf = (sp) => (sp ? sp.name || "話者" + (sp.id ?? "") : "話者");

function selectedPhases() {
  return [...document.querySelectorAll("#fPhaseGroup input:checked")].map((c) => c.value);
}

// 開閉式の複数選択ドロップダウン
function initMultiDropdown(group, labelText, items, onChange) {
  if (!group) return;
  group.classList.add("msel");
  group.innerHTML = `<button type="button" class="msel-btn"><span class="msel-cap">${labelText}：</span><span class="msel-sum">すべて</span><span class="msel-caret">▾</span></button><div class="msel-panel" hidden></div>`;
  const btn = group.querySelector(".msel-btn");
  const panel = group.querySelector(".msel-panel");
  const sum = group.querySelector(".msel-sum");
  for (const it of items) {
    const lab = document.createElement("label");
    lab.className = "msel-opt";
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.value = it.value;
    const span = document.createElement("span");
    span.className = "msel-optlabel";
    span.textContent = it.label;
    lab.appendChild(inp);
    lab.appendChild(span);
    panel.appendChild(lab);
  }
  const update = () => {
    const checked = [...panel.querySelectorAll("input:checked")];
    sum.textContent = checked.length
      ? items.filter((it) => checked.some((c) => c.value === it.value)).map((it) => it.label).join("・")
      : "すべて";
  };
  group._mselUpdate = update;
  panel.addEventListener("change", () => {
    update();
    onChange();
  });
  panel.addEventListener("click", (e) => e.stopPropagation());
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = panel.hidden;
    closeAllMsel();
    panel.hidden = !willOpen;
    btn.classList.toggle("open", willOpen);
  });
}
function closeAllMsel() {
  document.querySelectorAll(".msel-panel").forEach((p) => (p.hidden = true));
  document.querySelectorAll(".msel-btn.open").forEach((b) => b.classList.remove("open"));
}
document.addEventListener("click", closeAllMsel);

const HIST_CAT_OTHER = new URLSearchParams(location.search).get("cat") === "other";
let histMode = "all"; // 既定は「すべて」。会社で絞り込み可能
let selectedAccount = null;
let histAccounts = {}; // key -> {official_name,...}
function companyFromTitleH(title) {
  let t = String(title || "").trim();
  if (!t) return "(無題)";
  t = t.replace(/^[\s　・※•◆◇■□▶▷*\-–—✉⊠]+/u, "");
  t = t.replace(/[【\[［][^】\]］]*[】\]］]/gu, " ");
  t = t.replace(/[\s　/／|｜:：][^\s　/／|｜]{0,16}様(?:\s*[・,、][^\s　/／|｜]{0,16}様)*\s*$/u, "");
  t = t.replace(/[^\s　/／|｜]{0,16}様\s*$/u, "");
  t = t.replace(/\s+/g, " ").trim();
  return t || String(title || "(無題)").trim();
}
const acctKey = (m) => (m.account && m.account.trim()) || companyFromTitleH(m.title) || "(無題)";
const acctName = (key) => (histAccounts[key] && histAccounts[key].official_name) || key;
if (HIST_CAT_OTHER) {
  const bn = document.querySelector(".brand-name");
  if (bn) bn.textContent = "社内・フォロー";
  try { document.title = "社内・フォロー — kinbot"; } catch {}
}
function isOtherCat(m) { return !!(m.category && m.category !== "商談"); }
function applyHistoryFilter() {
  const owner = document.getElementById("fOwner").value.trim();
  const phases = selectedPhases();
  return allMeetings.filter((m) => {
    if (HIST_CAT_OTHER ? !isOtherCat(m) : isOtherCat(m)) return false; // ビューに合うカテゴリのみ
    if (owner && (m.owner || "").trim() !== owner) return false;
    if (phases.length && !phases.includes(m.phase || "")) return false;
    return true;
  });
}

async function bulkSendNotion() {
  const btn = document.getElementById("bulkNotionBtn");
  const stat = document.getElementById("bulkNotionStatus");
  const rows = applyHistoryFilter().filter((m) => m.status !== "processing" && m.status !== "error");
  if (!rows.length) { if (stat) stat.textContent = "対象の商談がありません"; return; }
  const ids = rows.map((m) => m.bot_id);
  if (!confirm(`絞り込み中の ${rows.length} 件を、あなたのNotionに送信します。\n既に送信済みの商談は自動でスキップします。続けますか？`)) return;
  if (btn) { btn.disabled = true; btn.textContent = "送信中…"; }
  const setS = (label, percent) => window.kbProgress(stat, { label, percent });
  setS(`送信中… 0/${ids.length}`, 0);
  try {
    const d = await window.kinbotBulkNotion(ids, {
      onProgress: (p) => setS(`送信中… ${p.done}/${p.total}（成功${p.sent}・スキップ${p.skipped}${p.busy ? "・送信中…" : ""}）`, (p.done / p.total) * 100),
    });
    setS(`完了：成功 ${d.sent} / スキップ ${d.skipped} / 失敗 ${d.failed}` + (d.errors && d.errors.length ? `\n例: ${d.errors[0]}` : ""), 100);
  } catch (e) {
    if (stat) stat.textContent = "失敗: " + e.message;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "絞り込みをNotionに一括送信"; }
  }
}

function meetingCardEl(r) {
  const overview =
    r.status === "processing"
      ? "⏳ 文字起こし・分析を処理中…（数分後に表示されます）"
      : r.status === "error"
      ? "⚠️ 処理に失敗しました（ファイル形式やキー設定をご確認ください）"
      : r.summary && r.summary.overview
      ? r.summary.overview
      : "（要約なし）";
  const tags = [];
  if (r.round_no) tags.push(`${r.round_no}回目`);
  if (r.phase) tags.push(phaseLabel(r.phase));
  if (r.apo_setter) tags.push(`アポ獲得：${r.apo_setter}`);
  const card = document.createElement("button");
  card.className = "hcard";
  card.innerHTML = `<div class="hcard-title"></div><div class="hcard-top"><span class="hcard-date"></span><span class="hcard-rep"></span></div><div class="hcard-tags"></div><div class="hcard-ov"></div>`;
  card.querySelector(".hcard-title").textContent = r.title || "(商談名なし)";
  card.querySelector(".hcard-date").textContent = fmtDate(r.created_at);
  card.querySelector(".hcard-rep").textContent = r.owner_name || r.rep_name || "";
  card.querySelector(".hcard-tags").textContent = tags.join("　");
  card.querySelector(".hcard-ov").textContent = overview;
  card.addEventListener("click", () => {
    document.querySelectorAll(".hcard").forEach((c) => c.classList.remove("active"));
    card.classList.add("active");
    loadDetail(r.bot_id);
  });
  return card;
}

const PHASE_NAMES = { 1: "課題特定", 2: "カスタマイズデモ", 3: "顧客起点", 4: "クロージング" };
const PHASE_NEED = {
  1: "顧客が自社固有の状況（数字・「うちは/私が/今」）を具体的に話すと到達",
  2: "担当者がデモ中に顧客固有の課題・数字を使うと到達",
  3: "デモ後に顧客が『期日＋確定形（します/たい）』で次の動きを示すと到達（受注の分岐点）",
  4: "申込書を送付（または送付の明言）で到達",
};
function renderPhaseBox(box, j, botId) {
  if (!j) {
    box.innerHTML = `<div class="phase-empty">フェーズ判定はまだありません。<button class="btn ghost phase-judge" type="button">フェーズを判定する</button></div>`;
  } else {
    const cur = j.current_phase || 0;
    const steps = [1, 2, 3, 4].map((n) => {
      const reached = j[`phase${n}_reached`];
      const cls = reached ? "done" : "todo";
      const isCur = n === cur;
      return `<div class="phase-step ${cls} ${isCur ? "cur" : ""}"><span class="phase-dot">${reached ? "✓" : n}</span><span class="phase-label">${PHASE_NAMES[n]}</span></div>`;
    }).join('<span class="phase-arrow">›</span>');
    // 各フェーズの判定理由（到達=根拠の発言／未到達=何が必要か）
    const reasons = [1, 2, 3, 4].map((n) => {
      const reached = j[`phase${n}_reached`];
      const ev = j[`phase${n}_evidence`];
      if (reached) {
        return `<div class="pr-item reached"><div class="pr-h"><span class="pr-badge ok">到達</span>フェーズ${n}・${PHASE_NAMES[n]}</div>` +
          (ev ? `<div class="pr-ev">根拠：「${escapeHtmlH(ev)}」</div>` : `<div class="pr-ev pr-muted">根拠の記載なし</div>`) + `</div>`;
      }
      return `<div class="pr-item notyet"><div class="pr-h"><span class="pr-badge no">未到達</span>フェーズ${n}・${PHASE_NAMES[n]}</div>` +
        `<div class="pr-ev pr-muted">${escapeHtmlH(PHASE_NEED[n])}</div></div>`;
    }).join("");
    const next = j.next_action ? `<div class="phase-next"><b>次のアクション</b>：${escapeHtmlH(j.next_action)}</div>` : "";
    const risk = j.risk ? `<div class="phase-risk"><b>⚠ リスク</b>：${escapeHtmlH(j.risk)}</div>` : "";
    box.innerHTML =
      `<div class="phase-head"><span class="phase-badge p${cur}">現在フェーズ${cur}：${PHASE_NAMES[cur] || "-"}</span>` +
      `<button class="btn ghost phase-judge" type="button">再判定</button></div>` +
      `<div class="phase-steps">${steps}</div>${next}${risk}` +
      `<details class="phase-reasons" open><summary>判定の理由（フェーズごと）</summary><div class="pr-list">${reasons}</div></details>`;
  }
  const btn = box.querySelector(".phase-judge");
  if (btn) btn.addEventListener("click", async () => {
    btn.disabled = true; btn.textContent = "判定中…";
    try {
      const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/phase/judge`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "判定に失敗");
      renderPhaseBox(box, d, botId);
    } catch (e) {
      btn.disabled = false; btn.textContent = "再判定";
      const host = box.querySelector(".phase-empty, .phase-head");
      if (host) host.insertAdjacentHTML("beforeend", `<span class="phase-err">失敗: ${escapeHtmlH(e.message)}</span>`);
    }
  });
}
async function loadPhase(botId) {
  const box = document.getElementById("phaseBox");
  if (!box) return;
  try {
    const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/phase?auto=1`);
    const j = await r.json();
    renderPhaseBox(box, j, botId);
  } catch {
    renderPhaseBox(box, null, botId);
  }
}
function escapeHtmlH(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderList() {
  const rows = applyHistoryFilter();
  hlist.innerHTML = "";
  // ツールバー（会社別／すべて）。社内・フォロービューでもモード切替は使える。
  const bar = document.createElement("div");
  bar.className = "hl-toolbar";
  bar.innerHTML =
    `<div class="seg"><button class="seg-btn ${histMode === "account" ? "active" : ""}" data-mode="account">会社別</button>` +
    `<button class="seg-btn ${histMode === "all" ? "active" : ""}" data-mode="all">すべて</button></div>`;
  bar.querySelectorAll(".seg-btn").forEach((b) =>
    b.addEventListener("click", () => { histMode = b.dataset.mode; selectedAccount = null; renderList(); })
  );
  hlist.appendChild(bar);

  if (!rows.length) {
    const e = document.createElement("div");
    e.className = "empty-state";
    e.textContent = "該当する商談がありません。";
    hlist.appendChild(e);
    return;
  }

  // すべて表示：従来どおりフラット
  if (histMode === "all") {
    for (const r of rows) hlist.appendChild(meetingCardEl(r));
    return;
  }

  // 会社別：未選択なら会社カード、選択中ならその会社の商談
  if (!selectedAccount) {
    const groups = {};
    for (const m of rows) (groups[acctKey(m)] = groups[acctKey(m)] || []).push(m);
    const keys = Object.keys(groups).sort((a, b) => {
      const la = groups[a][0].created_at, lb = groups[b][0].created_at;
      return new Date(Math.max(...groups[b].map((x) => +new Date(x.created_at)))) - new Date(Math.max(...groups[a].map((x) => +new Date(x.created_at))));
    });
    for (const k of keys) {
      const ms = groups[k];
      const last = ms.reduce((a, b) => (new Date(a.created_at) > new Date(b.created_at) ? a : b));
      const card = document.createElement("button");
      card.className = "acard";
      card.innerHTML =
        `<div class="acard-name"></div>` +
        `<div class="acard-meta"><span class="acard-count">${ms.length}件</span><span class="acard-rep"></span></div>` +
        `<div class="acard-sub"></div>`;
      card.querySelector(".acard-name").textContent = acctName(k);
      card.querySelector(".acard-rep").textContent = last.owner_name || last.rep_name || "";
      card.querySelector(".acard-sub").textContent = `${phaseLabel(last.phase) || "フェーズ未設定"} ・ 最終 ${fmtDate(last.created_at)}`;
      card.addEventListener("click", () => { selectedAccount = k; renderList(); });
      hlist.appendChild(card);
    }
    return;
  }

  // 選択中の会社の商談
  const mine = rows.filter((m) => acctKey(m) === selectedAccount)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const back = document.createElement("div");
  back.className = "hl-back";
  back.innerHTML = `<button class="hl-backbtn" type="button">← 会社一覧</button><span class="hl-acct"></span>`;
  back.querySelector(".hl-acct").textContent = `${acctName(selectedAccount)}（${mine.length}件）`;
  back.querySelector(".hl-backbtn").addEventListener("click", () => { selectedAccount = null; renderList(); });
  hlist.appendChild(back);
  for (const r of mine) hlist.appendChild(meetingCardEl(r));
}

async function loadList() {
  // フェーズ（開閉式ドロップダウン・複数選択）
  initMultiDropdown(
    document.getElementById("fPhaseGroup"),
    "フェーズ",
    PHASES.map((p) => ({ value: p.code, label: p.label })),
    renderList
  );
  try {
    const res = await fetch("/api/meetings");
    const rows = await res.json();
    allMeetings = Array.isArray(rows) ? rows : [];
    if (allMeetings.length === 0) {
      hlist.innerHTML =
        '<div class="empty-state">まだ履歴がありません。商談を1件記録すると、ここに並びます。<br><small>（履歴の保存には DATABASE_URL の設定が必要です）</small></div>';
      return;
    }
    // 営業担当（所有者）選択肢
    const fOwner = document.getElementById("fOwner");
    const seen = new Map();
    for (const m of allMeetings) {
      const owner = (m.owner || "").trim();
      if (owner && !seen.has(owner)) seen.set(owner, (m.owner_name || "").trim() || owner);
    }
    for (const [owner, label] of seen) {
      const o = document.createElement("option");
      o.value = owner;
      o.textContent = label;
      fOwner.appendChild(o);
    }
    fOwner.addEventListener("change", () => { selectedAccount = null; renderList(); });
    const bulkBtn = document.getElementById("bulkNotionBtn");
    if (bulkBtn && !bulkBtn._wired) { bulkBtn._wired = true; bulkBtn.addEventListener("click", bulkSendNotion); }
    try {
      const accs = await (await fetch("/api/accounts")).json();
      histAccounts = {};
      for (const a of accs || []) histAccounts[a.key] = a;
    } catch {}
    renderList();
    // 案件などから ?m=商談ID で来たら、その会社を開いて該当商談を表示
    const wantId = new URLSearchParams(location.search).get("m");
    const want = wantId && allMeetings.find((x) => x.bot_id === wantId);
    if (want) {
      histMode = "account";
      selectedAccount = acctKey(want);
      renderList();
      loadDetail(wantId);
    }
  } catch (e) {
    hlist.innerHTML = '<div class="empty-state">読み込みに失敗しました。</div>';
  }
}

async function loadDetail(botId) {
  const histWrap = document.querySelector(".history");
  if (histWrap) histWrap.classList.add("m-detail");
  if (!loadDetail._wired && histWrap) {
    loadDetail._wired = true;
    hdetail.addEventListener("click", (e) => {
      if (e.target.closest(".m-back")) histWrap.classList.remove("m-detail");
    });
  }
  hdetail.innerHTML = '<div class="empty-state">読み込み中…</div>';
  hdetail.scrollTop = 0;
  try {
    const res = await fetch(`/api/meetings/${encodeURIComponent(botId)}`);
    const m = await res.json();
    let s = m.summary || {};
    const sug = Array.isArray(m.suggestions) ? m.suggestions : [];
    const tr = Array.isArray(m.transcript) ? m.transcript : [];

    hdetail.innerHTML = `
      <button class="m-back" type="button">← 一覧へ戻る</button>
      <div class="drec" id="drec"></div>
      <div class="dhead">
        <div class="dtitle-wrap">
          <input class="dtitle-input" id="mTitle" placeholder="商談名" />
          <button type="button" id="calBtnH" class="cal-btn" title="カレンダーから選ぶ">📅</button>
          <div class="cal-panel" id="calPanelH" hidden></div>
        </div>
        <div class="dactions">
          <button class="btn" id="genBtn">要約・FB生成</button>
          <button class="btn" id="deepBtn">分析を生成</button>
          <button class="btn" id="notionBtn">Notionに送る</button>
          <button class="btn danger" id="delBtn">削除</button>
        </div>
      </div>
      <div class="dmeta-edit">
        <label>営業担当 <select id="mOwner"><option value="">未設定</option></select></label>
        <label>日時 <input type="datetime-local" id="mDatetime" /></label>
        <label>何回目<span class="hint">（商談回数）</span> <input type="number" id="mRound" min="1" max="99" placeholder="-" /></label>
        <label>種別 <select id="mDealKind">
          <option value="">通常</option>
          <option value="コールド">コールド</option>
          <option value="過去失注">過去失注</option>
        </select></label>
        <label>区分 <select id="mCategory">
          <option value="商談">商談</option>
          <option value="社内MTG">社内MTG</option>
          <option value="ユーザーフォロー">ユーザーフォロー</option>
          <option value="その他">その他</option>
        </select></label>
        <span class="dmeta-saved" id="mSaved" hidden>保存しました</span>
      </div>
      <div class="tabs">
        <button class="tab active" data-tab="trans">文字起こし</button>
        <button class="tab" data-tab="summary">要約</button>
        <button class="tab" data-tab="ailog">AI提案ログ</button>
        <button class="tab" data-tab="fb">FB & 分析</button>
        <button class="tab" data-tab="thanks">御礼メール</button>
        <button class="tab" data-tab="sf">SF連携</button>
      </div>
      <div class="tabwrap">
        <div class="tabpane" data-pane="trans">
          <div class="pane-bar"><button class="btn ghost copy-mini" id="copyTrans">コピー</button></div>
          <div id="dtrans" class="pane-content"></div>
        </div>
        <div class="tabpane" data-pane="summary" hidden>
          <div id="dnoteWrap"></div>
          <div class="pane-bar"><button class="btn ghost" id="customRunBtn" hidden>再実行</button><button class="btn ghost copy-mini" id="copySummary">コピー</button></div>
          <div id="dcustom" class="pane-content" hidden></div>
          <div id="dsummary" class="pane-content"></div>
        </div>
        <div class="tabpane" data-pane="ailog" hidden>
          <div class="ai-feed" id="dailog"></div>
        </div>
        <div class="tabpane" data-pane="fb" hidden>
          <div class="pane-bar"><button class="btn ghost copy-mini" id="copyFb">コピー</button></div>
          <div class="pane-content" id="dfbwrap">
            <h3>営業フィードバック</h3>
            <div id="dfeedback"></div>
            <h3>客観指標（自動計算）</h3>
            <div id="dmetrics"></div>
            <h3>AIによる評価</h3>
            <div id="dai"></div>
            <h3>次の一手（記録）</h3>
            <div id="dmoves"></div>
          </div>
        </div>
        <div class="tabpane" data-pane="thanks" hidden>
          <div class="pane-bar">
            <button class="btn" id="thanksGen">御礼メールを生成</button>
            <span class="thanks-note" id="thanksNote"></span>
            <button class="btn ghost copy-mini" id="copyThanks">コピー</button>
          </div>
          <div class="thanks-wrap">
            <label class="thanks-field"><span>件名</span><input id="thanksSubject" type="text" placeholder="生成すると入ります" /></label>
            <label class="thanks-field"><span>本文</span><textarea id="thanksBody" rows="16" placeholder="「御礼メールを生成」を押すと、この商談（何回目か）に合わせて作成します。"></textarea></label>
          </div>
        </div>
        <div class="tabpane" data-pane="sf" hidden>
          <div class="thanks-wrap">
            <label class="thanks-field"><span>Salesforce 商談リンク</span><input id="sfUrl" type="url" placeholder="https://...lightning.force.com/lightning/r/Opportunity/.../view" /></label>
            <div class="pane-bar" style="justify-content:flex-start; gap:8px">
              <button class="btn" id="sfFetchBtn">更新候補を取得</button>
              <span class="thanks-note" id="sfNote"></span>
            </div>
            <div id="sfRows"></div>
            <div class="pane-bar" style="justify-content:flex-start">
              <button class="btn" id="sfPushBtn" hidden>Salesforceに更新</button>
            </div>
          </div>
        </div>
      </div>`;

    // タブ切替
    // 要約タブ：カスタムプロンプトが設定されていれば、標準要約の代わりにその出力を表示する
    const dcustom = hdetail.querySelector("#dcustom");
    const dsummaryEl = hdetail.querySelector("#dsummary");
    const customRunBtn = hdetail.querySelector("#customRunBtn");
    let customLoaded = false;
    let customMode = false; // カスタムプロンプトが設定されているか
    async function loadCustom(regen) {
      if (!dcustom) return;
      customLoaded = true;
      dcustom.hidden = false;
      if (dsummaryEl) dsummaryEl.hidden = true;
      window.kbProgress(dcustom, { percent: null, label: regen ? "設定したプロンプトで分析しています…（数十秒かかります）" : "分析結果を読み込んでいます…" });
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/custom-analysis`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ regen: !!regen }),
        });
        const data = await r.json();
        window.kbProgress(dcustom, { clear: true });
        if (!r.ok) { dcustom.innerHTML = `<div class="empty-state">${escapeHtml(data.error || "実行に失敗しました")}</div>`; return; }
        const t = (data.result || "").trim();
        dcustom.innerHTML = t ? `<div class="custom-out">${escapeHtml(t)}</div>` : '<div class="empty-state">結果がありません。「再実行」を押してください。</div>';
      } catch (e) {
        window.kbProgress(dcustom, { clear: true });
        dcustom.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
      }
    }
    // カスタムプロンプトの有無を確認し、あれば要約タブをカスタム出力に切り替える
    (async () => {
      try {
        const d = await (await fetch("/api/custom-prompt")).json();
        customMode = !!(d.prompt && d.prompt.trim());
      } catch {}
      if (customMode) {
        if (customRunBtn) customRunBtn.hidden = false;
        // 要約タブが最初から開いている場合に備えて即読み込み
        const summaryPane = hdetail.querySelector('.tabpane[data-pane="summary"]');
        if (summaryPane && !summaryPane.hidden && !customLoaded) loadCustom(false);
      }
    })();
    if (customRunBtn) customRunBtn.addEventListener("click", () => loadCustom(true));

    hdetail.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        hdetail.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
        const name = tab.dataset.tab;
        hdetail.querySelectorAll(".tabpane").forEach((p) => (p.hidden = p.dataset.pane !== name));
        if (name === "summary" && customMode && !customLoaded) loadCustom(false);
      });
    });

    // コピー（各タブの内容をプレーンテキストで）
    const copyText = async (text, btn) => {
      const done = () => {
        const o = btn.textContent;
        btn.textContent = "コピーしました";
        setTimeout(() => (btn.textContent = o), 1500);
      };
      try {
        await navigator.clipboard.writeText(text);
        done();
      } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        done();
      }
    };
    hdetail.querySelector("#copyTrans").addEventListener("click", (e) =>
      copyText(hdetail.querySelector("#dtrans").innerText, e.currentTarget)
    );
    hdetail.querySelector("#copySummary").addEventListener("click", (e) =>
      copyText(customMode ? hdetail.querySelector("#dcustom").innerText : summaryToText(s), e.currentTarget)
    );
    hdetail.querySelector("#copyFb").addEventListener("click", (e) =>
      copyText(hdetail.querySelector("#dfbwrap").innerText, e.currentTarget)
    );
    // 御礼メール生成
    const thanksGen = hdetail.querySelector("#thanksGen");
    const thanksSubject = hdetail.querySelector("#thanksSubject");
    const thanksBody = hdetail.querySelector("#thanksBody");
    const thanksNote = hdetail.querySelector("#thanksNote");
    thanksGen.addEventListener("click", async () => {
      thanksGen.disabled = true;
      const o = thanksGen.textContent;
      thanksGen.textContent = "生成中…";
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/thanks`, { method: "POST" });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "生成に失敗しました");
        thanksSubject.value = d.subject || "";
        thanksBody.value = d.body || "";
        thanksNote.textContent = `${d.round || "?"}回目${d.exampleCount ? `・例文${d.exampleCount}件を参照` : "・例文なし"}`;
      } catch (e) {
        alert("生成に失敗しました: " + e.message);
      } finally {
        thanksGen.disabled = false;
        thanksGen.textContent = o;
      }
    });
    hdetail.querySelector("#copyThanks").addEventListener("click", (e) => {
      const text = (thanksSubject.value ? "件名：" + thanksSubject.value + "\n\n" : "") + thanksBody.value;
      copyText(text, e.currentTarget);
    });

    // Salesforce連携タブ
    const sfUrl = hdetail.querySelector("#sfUrl");
    const sfFetchBtn = hdetail.querySelector("#sfFetchBtn");
    const sfRows = hdetail.querySelector("#sfRows");
    const sfNote = hdetail.querySelector("#sfNote");
    const sfPushBtn = hdetail.querySelector("#sfPushBtn");
    let sfRecordId = "";
    sfUrl.value = m.sf_url || "";
    sfUrl.addEventListener("change", () => {
      fetch(`/api/meetings/${encodeURIComponent(botId)}/sf-link`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: sfUrl.value.trim() }),
      }).catch(() => {});
    });
    sfFetchBtn.addEventListener("click", async () => {
      sfFetchBtn.disabled = true;
      const o = sfFetchBtn.textContent;
      sfFetchBtn.textContent = "取得中…";
      sfRows.innerHTML = "";
      sfPushBtn.hidden = true;
      sfNote.textContent = "";
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/sf-fields`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: sfUrl.value.trim() }),
        });
        const d = await r.json();
        if (!d.configured) {
          sfNote.textContent = "Salesforce未設定（設定→Salesforce連携、後日の連携作業で有効になります）";
          return;
        }
        if (!d.connected) {
          sfNote.textContent = "未連携です。設定→Salesforce連携から連携してください。";
          return;
        }
        if (d.needLink) {
          sfNote.textContent = "商談リンクを入力してください。";
          return;
        }
        if (d.needMapping) {
          sfNote.textContent = "項目マッピングが未設定です。設定→Salesforce連携で指定してください。";
          return;
        }
        if (d.fetchError) {
          sfNote.textContent = "取得失敗: " + d.fetchError;
          return;
        }
        sfRecordId = d.recordId || "";
        const rows = d.rows || [];
        if (!rows.length) {
          sfNote.textContent = "更新対象の項目がありません。";
          return;
        }
        sfRows.innerHTML = "";
        for (const row of rows) {
          const wrap = document.createElement("div");
          wrap.className = "sf-row";
          wrap.innerHTML = `<div class="sf-row-head"><b>${escapeHtml(row.label)}</b> <span class="sf-field">${escapeHtml(row.sfField)}</span></div>
            <div class="sf-current">現在: ${escapeHtml(String(row.current || "（空）"))}</div>
            <textarea class="sf-input" rows="2"></textarea>`;
          wrap.querySelector(".sf-input").value = row.proposed || "";
          wrap.dataset.sfField = row.sfField;
          sfRows.appendChild(wrap);
        }
        sfPushBtn.hidden = false;
        sfNote.textContent = "内容を確認・編集して「Salesforceに更新」を押してください。";
      } catch (e) {
        sfNote.textContent = "エラー: " + e.message;
      } finally {
        sfFetchBtn.disabled = false;
        sfFetchBtn.textContent = o;
      }
    });
    sfPushBtn.addEventListener("click", async () => {
      const fields = {};
      sfRows.querySelectorAll(".sf-row").forEach((w) => {
        const f = w.dataset.sfField;
        const v = w.querySelector(".sf-input").value;
        if (f) fields[f] = v;
      });
      sfPushBtn.disabled = true;
      const o = sfPushBtn.textContent;
      sfPushBtn.textContent = "更新中…";
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/sf-update`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ recordId: sfRecordId, fields }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "更新に失敗しました");
        sfNote.textContent = "Salesforceを更新しました。";
      } catch (e) {
        sfNote.textContent = "更新失敗: " + e.message;
      } finally {
        sfPushBtn.disabled = false;
        sfPushBtn.textContent = o;
      }
    });

    // 商談名（編集可）
    const mTitle = hdetail.querySelector("#mTitle");
    mTitle.value = m.title || "";

    // 何回目（商談回数）・日時
    const mRound = hdetail.querySelector("#mRound");
    const mOwner = hdetail.querySelector("#mOwner");
    const mDatetime = hdetail.querySelector("#mDatetime");
    const mCategory = hdetail.querySelector("#mCategory");
    const mDealKind = hdetail.querySelector("#mDealKind");
    const mSaved = hdetail.querySelector("#mSaved");
    if (m.created_at) mDatetime.value = isoToLocalInput(m.created_at);
    if (mCategory) mCategory.value = m.category && m.category !== "" ? m.category : "商談";
    if (m.round_no) mRound.value = m.round_no;
    // 種別（コールド/過去失注）：保存済みがあればそれを、無ければ商談名から自動判定
    if (mDealKind) {
      const inferred = inferDealKind(m.title);
      mDealKind.value = m.deal_kind || inferred || "";
      // 保存が無く、タイトルから推定できた場合は自動で保存しておく（次回以降も反映）
      if (!m.deal_kind && inferred) {
        m.deal_kind = inferred;
        fetch(`/api/meetings/${botId}/meta`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ round: mRound.value, dealKind: inferred }),
        }).catch(() => {});
        const row = allMeetings.find((x) => x.bot_id === botId);
        if (row) row.deal_kind = inferred;
      }
    }

    // 営業担当（登録ユーザーから選択して付け替え）
    const users = await loadUsers();
    const present = new Set();
    for (const u of users) {
      const o = document.createElement("option");
      o.value = u.email;
      o.textContent = u.name || u.email;
      mOwner.appendChild(o);
      present.add(u.email);
    }
    // 現在の担当者が一覧に無い場合（旧データ等）も選べるように追加
    if (m.owner && !present.has(m.owner)) {
      const o = document.createElement("option");
      o.value = m.owner;
      o.textContent = m.owner_name || m.owner;
      mOwner.appendChild(o);
    }
    mOwner.value = m.owner || "";

    const saveMeta = async () => {
      try {
        const createdAt = mDatetime.value ? localInputToIso(mDatetime.value) : "";
        await fetch(`/api/meetings/${encodeURIComponent(botId)}/meta`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: mTitle.value.trim(),
            round: mRound.value,
            owner: mOwner.value,
            createdAt,
            category: mCategory ? mCategory.value : undefined,
            dealKind: mDealKind ? mDealKind.value : undefined,
          }),
        });
        mSaved.hidden = false;
        setTimeout(() => (mSaved.hidden = true), 1500);
        // 一覧の表示にも反映
        const row = allMeetings.find((x) => x.bot_id === botId);
        if (row) {
          row.title = mTitle.value.trim();
          row.round_no = mRound.value ? Number(mRound.value) : null;
          row.owner = mOwner.value || "";
          if (mCategory) row.category = mCategory.value;
          if (mDealKind) row.deal_kind = mDealKind.value || null;
          if (createdAt) row.created_at = createdAt;
          const u = (usersCache || []).find((x) => x.email === mOwner.value);
          row.owner_name = u ? u.name || u.email : mOwner.value ? mOwner.value : null;
        }
        renderList();
      } catch {}
    };
    mTitle.addEventListener("change", () => {
      // 商談名を変えたら、種別が未設定のときだけタイトルから自動判定して反映
      if (mDealKind && !mDealKind.value) {
        const inferred = inferDealKind(mTitle.value);
        if (inferred) mDealKind.value = inferred;
      }
      saveMeta();
    });
    mRound.addEventListener("change", saveMeta);
    if (mCategory) mCategory.addEventListener("change", saveMeta);
    if (mDealKind) mDealKind.addEventListener("change", saveMeta);
    mOwner.addEventListener("change", saveMeta);
    mDatetime.addEventListener("change", saveMeta);

    // 商談名・日時をカレンダーから選ぶ
    const calBtnH = hdetail.querySelector("#calBtnH");
    const calPanelH = hdetail.querySelector("#calPanelH");
    if (calBtnH && calPanelH) {
      calBtnH.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!calPanelH.hidden) {
          calPanelH.hidden = true;
          return;
        }
        openCalPicker(calPanelH, (ev) => {
          mTitle.value = ev.title;
          if (ev.start) mDatetime.value = ev.allDay ? ev.start + "T00:00" : isoToLocalInput(ev.start);
          saveMeta();
        });
      });
    }

    // Notionに送る
    const notionBtn = hdetail.querySelector("#notionBtn");
    if (notionBtn) notionBtn.addEventListener("click", async () => {
      notionBtn.disabled = true;
      const orig = notionBtn.textContent;
      notionBtn.textContent = "送信中…";
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/notion`, { method: "POST" });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "送信に失敗しました");
        notionBtn.textContent = "Notionへ送信済み";
        if (d.url) window.open(d.url, "_blank", "noopener");
        setTimeout(() => { notionBtn.textContent = orig; notionBtn.disabled = false; }, 2500);
      } catch (e) {
        alert("Notion送信に失敗: " + e.message);
        notionBtn.textContent = orig; notionBtn.disabled = false;
      }
    });

    // 削除
    const delBtn = hdetail.querySelector("#delBtn");
    delBtn.addEventListener("click", async () => {
      if (!confirm(`「${m.title || "(商談名なし)"}」を削除します。よろしいですか？\nこの操作は取り消せません。`)) return;
      delBtn.disabled = true;
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}`, { method: "DELETE" });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || "削除に失敗しました");
        }
        allMeetings = allMeetings.filter((x) => x.bot_id !== botId);
        renderList();
        hdetail.innerHTML = '<div class="empty-state">削除しました。左の一覧から別の商談を選べます。</div>';
      } catch (e) {
        alert("削除に失敗しました: " + e.message);
        delBtn.disabled = false;
      }
    });

    renderSummaryInto(hdetail.querySelector("#dsummary"), s);
    const noteWrap = hdetail.querySelector("#dnoteWrap");
    if (noteWrap && m.note && m.note.trim()) {
      noteWrap.innerHTML = `<div class="dlabel">📝 商談メモ</div><div class="dnote">${escapeHtml(m.note)}</div>`;
    }
    renderFeedbackInto(hdetail.querySelector("#dfeedback"), m.feedback || {});
    renderMetricsInto(hdetail.querySelector("#dmetrics"), tr, m.rep_name);
    renderAiInto(hdetail.querySelector("#dai"), m.analysis);

    // 分析（スコア・BANT等）を生成
    const deepBtn = hdetail.querySelector("#deepBtn");
    if (tr.length === 0) deepBtn.disabled = true;
    deepBtn.addEventListener("click", async () => {
      deepBtn.disabled = true;
      const orig = deepBtn.textContent;
      deepBtn.textContent = "生成中…";
      window.kbProgress(hdetail.querySelector("#dai"), { percent: null, label: "AIが商談を多角的に分析しています…" });
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/deep-analyze`, { method: "POST" });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "生成に失敗しました");
        renderAiInto(hdetail.querySelector("#dai"), data);
      } catch (e) {
        window.kbProgress(hdetail.querySelector("#dai"), { clear: true });
        alert("生成に失敗しました: " + e.message);
      } finally {
        deepBtn.disabled = false;
        deepBtn.textContent = orig;
      }
    });

    // 次の一手（ライブ中の記録）
    const dm = hdetail.querySelector("#dmoves");
    dm.innerHTML = sug.length
      ? sug.map((x) => `<div class="mini-card"><b>${escapeHtml(x.title || "")}</b><br>${escapeHtml(x.detail || "")}</div>`).join("")
      : '<div class="empty-state">記録なし</div>';

    // AI提案ログ（ライブ中の吹き出し全履歴）
    renderAiLogInto(hdetail.querySelector("#dailog"), Array.isArray(m.ai_log) ? m.ai_log : []);

    // 文字起こしから 要約＋営業フィードバック を生成
    const genBtn = hdetail.querySelector("#genBtn");
    if (tr.length === 0) genBtn.disabled = true;
    genBtn.addEventListener("click", async () => {
      genBtn.disabled = true;
      const orig = genBtn.textContent;
      genBtn.textContent = "生成中…";
      window.kbProgress(hdetail.querySelector("#dsummary"), { percent: null, label: "文字起こしから要約・フィードバックを生成しています…" });
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/analyze`, { method: "POST" });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "生成に失敗しました");
        s = data.summary || s;
        renderSummaryInto(hdetail.querySelector("#dsummary"), data.summary || {});
        renderFeedbackInto(hdetail.querySelector("#dfeedback"), data.feedback || {});
        if (customMode) await loadCustom(true); // 要約タブはカスタム出力を表示しているので作り直す
        loadList(); // 一覧の「要約なし」表示を更新
      } catch (e) {
        window.kbProgress(hdetail.querySelector("#dsummary"), { clear: true });
        alert("生成に失敗しました: " + e.message);
      } finally {
        genBtn.disabled = false;
        genBtn.textContent = orig;
      }
    });

    // 文字起こし
    const dt = hdetail.querySelector("#dtrans");
    dt.innerHTML = tr.length
      ? tr.map((u) => `<div class="tline"><span class="spk2">${escapeHtml(labelOf(u.speaker))}</span>${escapeHtml(u.text)}</div>`).join("")
      : '<div class="empty-state">文字起こしなし</div>';

    // 録画（あれば）アプリ内で再生
    const drec = hdetail.querySelector("#drec");
    drec.innerHTML = '<div class="rec-loading">録画を確認中…</div>';
    fetch(`/api/meetings/${encodeURIComponent(botId)}/recording`)
      .then((r) => r.json())
      .then((d) => {
        if (d && d.url) {
          const isHls = d.hls || /\.m3u8(\?|$)/.test(d.url);
          drec.innerHTML = `
            <video class="rec-video" controls preload="metadata" playsinline></video>` +
            (isHls ? "" : `<a class="rec-open" href="${escapeHtml(d.url)}" target="_blank" rel="noopener">別タブで開く</a>`);
          const video = drec.querySelector("video");
          if (isHls && window.Hls && window.Hls.isSupported() && !video.canPlayType("application/vnd.apple.mpegurl")) {
            const hls = new Hls();
            hls.loadSource(d.url);
            hls.attachMedia(video);
          } else {
            video.src = d.url;
          }
        } else {
          drec.innerHTML = '<div class="rec-none">録画はまだありません（会議終了後・アップロード動画は変換完了後に表示されます）。</div>';
        }
      })
      .catch(() => {
        drec.innerHTML = '<div class="rec-none">録画を取得できませんでした。</div>';
      });
  } catch (e) {
    hdetail.innerHTML = '<div class="empty-state">読み込みに失敗しました。</div>';
  }
}

const HTYPE_LABEL = { question: "深掘り質問", objection: "切り返し", closing: "クロージング", risk: "リスク", info: "補足" };
function renderAiLogInto(el, log) {
  if (!el) return;
  if (!log || !log.length) {
    el.innerHTML = '<div class="empty-state">この商談ではAI提案の記録がありません（旧データ、または提案が出る前に終了）。</div>';
    return;
  }
  // 一覧（刺さったトーク／懸念→刺さった言い返し）
  const lands = log.filter((e) => e.t === "land");
  const objs = log.filter((e) => e.t === "obj");
  let summary = "";
  if (lands.length) {
    summary += `<div class="ailog-sec"><div class="ailog-sec-h">💡 刺さったトーク（${lands.length}）</div><ul class="ailog-list">` +
      lands.map((e) => `<li>${escapeHtml(e.text || "")}${e.why ? `<span class="ailog-sub">（${escapeHtml(e.why)}）</span>` : ""}</li>`).join("") +
      `</ul></div>`;
  }
  if (objs.length) {
    summary += `<div class="ailog-sec"><div class="ailog-sec-h">⚠️ 懸念 → 刺さった言い返し（${objs.length}）</div><div class="ailog-pairs">` +
      objs.map((e) =>
        `<div class="ailog-pair"><div class="ailog-q">「${escapeHtml(e.objection || "")}」</div>` +
        `<div class="ailog-a">${escapeHtml(e.response || "")}</div>` +
        (e.basis ? `<div class="ailog-basis">根拠: ${escapeHtml(e.basis)}</div>` : "") + `</div>`
      ).join("") +
      `</div></div>`;
  }
  const feedHtml = '<div class="ailog-sec-h" style="margin-top:14px;">🗨 タイムライン</div>';

  el.innerHTML = summary + feedHtml + '<div class="ai-feed-inline"></div>';
  const feed = el.querySelector(".ai-feed-inline");
  for (const e of log) {
    const time = e.ts ? new Date(e.ts).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : "";
    const wrap = document.createElement("div");
    wrap.className = "ai-msg";
    let kind, label, title, text, sub = "";
    if (e.t === "obj") {
      kind = "obj"; label = "懸念 → 刺さる言い返し";
      title = e.objection ? "「" + e.objection + "」" : "";
      text = e.response || "";
      sub = e.basis ? "根拠: " + e.basis : "";
    } else if (e.t === "land") {
      kind = "land"; label = "💡 刺さったトーク";
      title = e.text || ""; text = e.why || "";
    } else if (e.t === "sig") {
      // 旧データ互換
      const buy = e.sigType !== "risk";
      kind = buy ? "land" : "obj";
      label = buy ? "刺さり（旧）" : "懸念（旧）";
      title = e.text || ""; text = e.hint || "";
    } else {
      kind = HTYPE_LABEL[e.sugType] ? e.sugType : "info";
      label = HTYPE_LABEL[kind] || "補足";
      title = e.title || ""; text = e.detail || "";
    }
    const lbl = label ? `<span class="ai-label ai-label-${kind}">${escapeHtml(label)}</span>` : "";
    const ttl = title ? `<div class="ai-b-title">${escapeHtml(title)}</div>` : "";
    const sb = sub ? `<div class="ai-b-sub">${escapeHtml(sub)}</div>` : "";
    const tm = time ? `<div class="ai-b-time">${escapeHtml(time)}</div>` : "";
    wrap.innerHTML =
      `<img class="ai-ava" src="kinbot.svg" alt="kinbot" />` +
      `<div class="ai-bubble ai-bubble-${kind}">${lbl}${ttl}<div class="ai-b-text">${escapeHtml(text)}</div>${sb}${tm}</div>`;
    feed.appendChild(wrap);
  }
}

function renderSummaryInto(el, s) {
  s = s || {};
  // 旧データで formatted のみの場合はそれを表示
  if (s.formatted && !s.key_points && !s.agreements) {
    el.innerHTML = `<div class="summary-fmt"></div>`;
    el.querySelector(".summary-fmt").textContent = s.formatted;
    return;
  }
  let html = "";
  if (s.overview) html += `<p class="overview">${escapeHtml(s.overview)}</p>`;
  html += group("要点", s.key_points);
  html += group("合意事項", s.agreements);
  html += group("宿題・次アクション", s.action_items);
  html += group("相手の懸念", s.customer_concerns);
  el.innerHTML = html || '<div class="empty-state">要約なし（「要約・FB生成」で作成）</div>';
}

// Salesforce等に貼りやすいプレーンテキストを生成
function summaryToText(s) {
  s = s || {};
  if (s.formatted && !s.key_points && !s.agreements) return s.formatted;
  const lines = [];
  if (s.overview) {
    lines.push(s.overview, "");
  }
  const sec = (label, items) => {
    if (Array.isArray(items) && items.length) {
      lines.push("■" + label);
      items.forEach((i) => lines.push("・" + i));
      lines.push("");
    }
  };
  sec("要点", s.key_points);
  sec("合意事項", s.agreements);
  sec("宿題・次アクション", s.action_items);
  sec("相手の懸念", s.customer_concerns);
  return lines.join("\n").trim();
}
function renderFeedbackInto(el, fb) {
  fb = fb || {};
  let html = "";
  if (fb.overall) html += `<p class="overview">${escapeHtml(fb.overall)}</p>`;
  html += group("良かった点", fb.good_points);
  html += group("改善点", fb.improvements);
  html += group("見落とし・機会損失", fb.missed);
  html += group("次回への宿題", fb.next_steps);
  el.innerHTML = html || '<div class="empty-state">フィードバックなし（「要約・フィードバックを生成」で作成）</div>';
}

function group(label, items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return (
    `<div class="sgroup"><div class="label">${label}</div><ul>` +
    items.map((i) => `<li>${escapeHtml(i)}</li>`).join("") +
    `</ul></div>`
  );
}
function computeMetrics(tr, repName) {
  const by = new Map();
  let total = 0;
  for (const u of tr) {
    const name = labelOf(u.speaker);
    const t = u.text || "";
    if (!by.has(name)) by.set(name, { chars: 0, turns: 0, questions: 0 });
    const o = by.get(name);
    o.chars += t.length;
    o.turns += 1;
    if (/[?？]/.test(t)) o.questions += 1;
    total += t.length;
  }
  const speakers = [...by.entries()]
    .map(([name, o]) => ({
      name, chars: o.chars, turns: o.turns, questions: o.questions,
      ratio: total ? Math.round((o.chars / total) * 100) : 0,
      isRep: repName && name.includes(repName),
    }))
    .sort((a, b) => b.chars - a.chars);
  return { speakers };
}
function renderMetricsInto(el, tr, repName) {
  if (!tr.length) {
    el.innerHTML = '<div class="empty-state">文字起こしがありません。</div>';
    return;
  }
  const m = computeMetrics(tr, repName);
  const rep = m.speakers.find((s) => s.isRep);
  let html = "";
  if (rep) {
    const judge = rep.ratio <= 50 ? "良い（相手に話させている）" : "自社が話しすぎ気味";
    html += `<p class="metric-note">自社トーク割合：<b>${rep.ratio}%</b>（目安40〜50%。${judge}）</p>`;
  }
  html += '<div class="bars">';
  for (const s of m.speakers) {
    html += `<div class="bar-row"><span class="bar-name">${escapeHtml(s.name)}${s.isRep ? "（自社）" : ""}</span><span class="bar-track"><span class="bar-fill${s.isRep ? " rep" : ""}" style="width:${s.ratio}%"></span></span><span class="bar-val">${s.ratio}%</span></div>`;
  }
  html += "</div>";
  const repQ = rep ? rep.questions : m.speakers.reduce((a, s) => a + s.questions, 0);
  html += `<p class="metric-note">質問の回数：<b>${repQ}</b>${rep ? "（自社）" : "（全体）"}　／　発話ターン合計：<b>${m.speakers.reduce((a, s) => a + s.turns, 0)}</b></p>`;
  el.innerHTML = html;
}
function renderAiInto(el, a) {
  if (!a || (!a.scores && !a.bant && !a.needs)) {
    el.innerHTML = '<div class="empty-state">「分析を生成」を押すと、スコア・BANT・購買シグナル等を作成します。</div>';
    return;
  }
  let html = "";
  const sc = a.scores || {};
  const dims = [["hearing", "ヒアリング"], ["proposal", "提案"], ["closing", "クロージング"], ["listening", "傾聴"]];
  html += '<div class="scores">';
  const reasons = a.score_reasons || {};
  for (const [k, jp] of dims) {
    const v = Number(sc[k]) || 0;
    html += `<div class="score-row"><span class="score-name">${jp}</span><span class="dots">${[1, 2, 3, 4, 5].map((n) => `<span class="dot${n <= v ? " on" : ""}"></span>`).join("")}</span><span class="score-val">${v}/5</span></div>`;
    if (reasons[k]) html += `<div class="score-reason">${escapeHtml(reasons[k])}</div>`;
  }
  html += "</div>";
  const b = a.bant || {};
  if (b.budget || b.authority || b.need || b.timeline) {
    html += '<div class="sgroup"><div class="label">BANT</div><table class="bant">';
    html += `<tr><td>予算</td><td>${escapeHtml(b.budget || "未確認")}</td></tr>`;
    html += `<tr><td>決裁者</td><td>${escapeHtml(b.authority || "未確認")}</td></tr>`;
    html += `<tr><td>必要性</td><td>${escapeHtml(b.need || "未確認")}</td></tr>`;
    html += `<tr><td>時期</td><td>${escapeHtml(b.timeline || "未確認")}</td></tr>`;
    html += "</table></div>";
  }
  if (a.next_step) html += `<div class="sgroup"><div class="label">次アクションの明確さ</div><p>${escapeHtml(a.next_step)}</p></div>`;
  html += group("把握した課題・ニーズ", a.needs);
  html += group("購買シグナル", a.buying_signals);
  html += group("懸念と対応", a.objections);
  html += group("競合の言及", a.competitors);
  html += group("話し方の癖・口癖", a.rep_habits);
  html += group("顧客の反応", a.customer_reactions);
  html += group("コーチング", a.coaching);
  el.innerHTML = html;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

loadList().then(() => {
  // 分析タブなどから ?id=botId で来たら、その商談を自動で開く
  const id = new URLSearchParams(location.search).get("id");
  if (id) loadDetail(id);
});
