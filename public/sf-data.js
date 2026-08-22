{
// sf-data.js — Salesforceのレポート／ダッシュボード／リードを表とグラフで見る
const $ = (id) => document.getElementById(id);

// ===== Salesforceのレポート =====
const _sr = { kind: "report", list: [], current: null, wired: false, dash: null };
function srEsc(v) { return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function initSfReport(kind) {
  if (kind) _sr.kind = kind;
  if (_sr.wired) { srLoadList(); return; }
  _sr.wired = true;
  const q = $("srQ"), btn = $("srSearch"), list = $("srList");
  if (btn) btn.addEventListener("click", srLoadList);
  if (q) q.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); srLoadList(); } });
  if (list) list.addEventListener("click", (e) => {
    const it = e.target.closest("[data-report-id]");
    if (it) { srRun(it.dataset.reportId); return; }
    const db = e.target.closest("[data-dash-id]");
    if (db) { srOpenDashboard(db.dataset.dashId); return; }
    const ld = e.target.closest("[data-lead]");
    if (ld) srLoadLeads(ld.dataset.lead);
  });
  srLoadList();
}

async function srLoadList() {
  const list = $("srList"), st = $("srStatus");
  if (!list) return;
  list.innerHTML = '<div class="empty-state">読み込み中…</div>';
  if (st) st.textContent = "";
  try {
    const q = ($("srQ") && $("srQ").value.trim()) || "";
    if (_sr.kind === "lead") {
      list.innerHTML =
        `<div class="sr-group">リードの一覧</div>` +
        `<button type="button" class="sr-item" data-lead="open">
           <span class="sr-item-name">未コンバートのリード</span><span class="sr-item-sub">まだ商談化していないもの</span></button>` +
        `<button type="button" class="sr-item" data-lead="converted">
           <span class="sr-item-name">コンバート済みのリード</span><span class="sr-item-sub">商談化したもの</span></button>` +
        `<button type="button" class="sr-item" data-lead="all">
           <span class="sr-item-name">すべてのリード</span><span class="sr-item-sub">直近から2000件まで</span></button>` +
        `<div class="sr-group">リードのレポート</div><div id="srLeadReports"><div class="empty-state">読み込み中…</div></div>`;
      if (st) st.textContent = "";
      // Salesforceにあるリード系のレポートも一覧に出す
      try {
        const rq = q || "リード";
        const rr = await fetch("/api/salesforce/reports?q=" + encodeURIComponent(rq));
        const rd = await rr.json().catch(() => ({}));
        const reps = (rd.reports || []);
        const box = $("srLeadReports");
        if (box) {
          box.innerHTML = reps.length
            ? reps.map((x) => `<button type="button" class="sr-item" data-report-id="${srEsc(x.id)}">
                <span class="sr-item-name">${srEsc(x.name)}</span>
                <span class="sr-item-sub">${srEsc(x.folder)}${x.format ? " ・ " + srEsc(x.format) : ""}</span>
              </button>`).join("")
            : `<div class="empty-state">「${srEsc(rq)}」を含むレポートが見つかりませんでした。上の欄に別の言葉を入れて検索してください。</div>`;
        }
      } catch {
        const box = $("srLeadReports");
        if (box) box.innerHTML = '<div class="empty-state">レポートの取得に失敗しました。</div>';
      }
      return;
    }
    const isDash = _sr.kind === "dashboard";
    const r = await fetch(`/api/salesforce/${isDash ? "dashboards" : "reports"}?q=` + encodeURIComponent(q));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "取得に失敗しました");
    _sr.list = (isDash ? d.dashboards : d.reports) || [];
    list.innerHTML = _sr.list.length
      ? _sr.list.map((x) => `<button type="button" class="sr-item" ${isDash ? `data-dash-id="${srEsc(x.id)}"` : `data-report-id="${srEsc(x.id)}"`}>
          <span class="sr-item-name">${srEsc(x.name)}</span>
          <span class="sr-item-sub">${srEsc(x.folder)}${x.format ? " ・ " + srEsc(x.format) : ""}</span>
        </button>`).join("")
      : `<div class="empty-state">${isDash ? "ダッシュボード" : "レポート"}が見つかりませんでした。</div>`;
    if (st) st.textContent = `${_sr.list.length}件`;
  } catch (e) {
    list.innerHTML = `<div class="empty-state">${srEsc(e.message)}</div>`;
  }
}

async function srRun(id) {
  const view = $("srView");
  if (!view) return;
  _sr.reportId = id;
  view.innerHTML = '<div class="empty-state">レポートを実行中…</div>';
  try {
    const r = await fetch("/api/salesforce/reports/" + encodeURIComponent(id));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "実行に失敗しました");
    srShowResult(d);
    loadReportFilters(id);   // 絞り込み条件も読んでおく
  } catch (e) {
    view.innerHTML = `<div class="empty-state">${srEsc(e.message)}</div>`;
  }
}

// ───────────────────────────────────────────────────────────
// レポートの絞り込み条件を、kinbotから変えて実行する。
// Salesforceに保存されているレポートは書き換えないので、何度でも試せる。
// ───────────────────────────────────────────────────────────
const SR_OPS = [
  ["equals", "＝ 等しい"],
  ["notEqual", "≠ 等しくない"],
  ["contains", "含む"],
  ["notContain", "含まない"],
  ["startsWith", "で始まる"],
  ["greaterThan", "＞ より大きい"],
  ["lessThan", "＜ より小さい"],
  ["greaterOrEqual", "≧ 以上"],
  ["lessOrEqual", "≦ 以下"],
];

async function loadReportFilters(id) {
  const box = $("srFilters");
  if (!box) return;
  box.innerHTML = '<div class="sr-f-note">条件を読み込んでいます…</div>';
  try {
    const d = await (await fetch(`/api/salesforce/reports/${encodeURIComponent(id)}/filters`)).json();
    if (d.error) throw new Error(d.error);
    _sr.filters = d;
    const fs = d.filters || [];
    const dr = d.dateRanges || [];

    box.innerHTML =
      `<div class="sr-f-head">絞り込み条件<span class="sr-f-note">ここで変えて実行しても、Salesforce側のレポートは変わりません</span></div>` +
      (d.standardDateFilter && dr.length
        ? `<div class="sr-f-row">
             <span class="sr-f-k">期間</span>
             <select class="sr-f-v" id="srDateRange">
               ${dr.map((x) => `<option value="${srEsc(x.value)}"${x.value === d.standardDateFilter.durationValue ? " selected" : ""}>${srEsc(x.label)}</option>`).join("")}
             </select>
           </div>`
        : "") +
      (fs.length
        ? fs.map((f) => `
            <div class="sr-f-row" data-col="${srEsc(f.column)}">
              <span class="sr-f-k">${srEsc(f.label)}</span>
              <select class="sr-f-op">
                ${SR_OPS.map(([v, l]) => `<option value="${v}"${v === f.operator ? " selected" : ""}>${l}</option>`).join("")}
              </select>
              <input type="text" class="sr-f-v" value="${srEsc(f.value || "")}" />
            </div>`).join("")
        : '<div class="sr-f-note">このレポートには変えられる条件がありません。</div>') +
      `<div class="sr-f-act">
         <button type="button" class="btn" id="srApply">この条件で実行</button>
         <button type="button" class="btn ghost" id="srReset">元に戻す</button>
         <span class="rev-status" id="srFStatus"></span>
       </div>`;

    $("srApply").addEventListener("click", () => applyReportFilters(id));
    $("srReset").addEventListener("click", () => { srRun(id); });
  } catch (e) {
    box.innerHTML = `<div class="sr-f-note">条件を読めませんでした：${srEsc(e.message)}</div>`;
  }
}

async function applyReportFilters(id) {
  const st = $("srFStatus");
  const view = $("srView");
  if (st) st.textContent = "実行しています…";
  try {
    const filters = [...document.querySelectorAll(".sr-f-row[data-col]")].map((row) => ({
      column: row.dataset.col,
      operator: row.querySelector(".sr-f-op").value,
      value: row.querySelector(".sr-f-v").value,
    }));
    const body = { filters };
    const dr = $("srDateRange");
    if (dr && _sr.filters && _sr.filters.standardDateFilter) {
      body.standardDateFilter = { ..._sr.filters.standardDateFilter, durationValue: dr.value };
    }
    if (_sr.filters && _sr.filters.booleanFilter) body.booleanFilter = _sr.filters.booleanFilter;

    if (view) view.innerHTML = '<div class="empty-state">レポートを実行中…</div>';
    const r = await fetch(`/api/salesforce/reports/${encodeURIComponent(id)}/run`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "実行できませんでした");
    srShowResult(d);
    if (st) { st.textContent = "この条件で実行しました"; setTimeout(() => (st.textContent = ""), 4000); }
  } catch (e) {
    if (st) st.textContent = "失敗: " + e.message;
    if (view) view.innerHTML = `<div class="empty-state">${srEsc(e.message)}</div>`;
  }
}

function srCsv() {
  const d = _sr.current;
  if (!d) return;
  const cell = (v) => {
    const t = String(v == null ? "" : v);
    return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const lines = [(d.columns || []).map((c) => cell(c.label)).join(",")]
    .concat((d.rows || []).map((r) => r.map(cell).join(",")));
  const blob = new Blob(["\ufeff" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (d.name || "report").replace(/[\\/:*?"<>|]/g, "_") + ".csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}


// ダッシュボードを開いて、中のグラフ（元レポート）を一覧表示する
async function srOpenDashboard(id) {
  const view = $("srView");
  if (!view) return;
  view.innerHTML = '<div class="empty-state">ダッシュボードを読み込み中…</div>';
  try {
    const r = await fetch("/api/salesforce/dashboards/" + encodeURIComponent(id));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "取得に失敗しました");
    _sr.dash = d;
    const comps = d.components || [];
    view.innerHTML =
      `<div class="sr-head">
         <div>
           <div class="sr-title">${srEsc(d.name)}</div>
           <div class="sr-sub">${comps.length}個のグラフ・表${d.description ? " ・ " + srEsc(d.description) : ""}</div>
         </div>
         <div class="sr-actions">
           <a class="btn ghost" href="${srEsc(d.instanceUrl)}/${srEsc(d.id)}" target="_blank" rel="noopener">Salesforceで開く</a>
         </div>
       </div>` +
      (comps.length
        ? `<div class="sr-comps">` + comps.map((c) => `
            <button type="button" class="sr-item" data-report-id="${srEsc(c.reportId)}">
              <span class="sr-item-name">${srEsc(c.title)}</span>
              <span class="sr-item-sub">${srEsc(c.type || "")} ・ クリックで中身を表示・CSV保存</span>
            </button>`).join("") + `</div>`
        : '<div class="empty-state">元になるレポートが見つかりませんでした。</div>');
    view.querySelectorAll("[data-report-id]").forEach((b) => {
      b.addEventListener("click", () => srRun(b.dataset.reportId));
    });
  } catch (e) {
    view.innerHTML = `<div class="empty-state">${srEsc(e.message)}</div>`;
  }
}


// リードを表で取り出す
async function srLoadLeads(kind) {
  const view = $("srView");
  if (!view) return;
  view.innerHTML = '<div class="empty-state">リードを取得中…</div>';
  try {
    const conv = kind === "converted" ? "converted" : kind === "all" ? "all" : "open";
    const r = await fetch("/api/salesforce/leads-export?converted=" + conv);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "取得に失敗しました");
    d.name = kind === "converted" ? "コンバート済みのリード" : kind === "all" ? "すべてのリード" : "未コンバートのリード";
    srShowResult(d);
  } catch (e) {
    view.innerHTML = `<div class="empty-state">${srEsc(e.message)}</div>`;
  }
}

// グラフ＋表で表示する（レポート・ダッシュボードの各グラフ・リード共通）
function srShowResult(d) {
  const view = $("srView");
  if (!view) return;
  _sr.current = d;
  const cols = d.columns || [];
  const rows = d.rows || [];
  const groups = (d.groups || []).filter((g) => g.label);
  const head = cols.map((c) => `<th>${srEsc(c.label)}</th>`).join("");
  const body = rows.slice(0, 500).map((row) => `<tr>${row.map((v) => `<td>${srEsc(v)}</td>`).join("")}</tr>`).join("");

  let chart = "";
  if (groups.length) {
    const max = Math.max(...groups.map((g) => Math.abs(g.value) || 0), 1);
    chart =
      `<div class="sr-chart"><div class="sr-chart-h">${srEsc(d.aggLabel || "集計")}</div>` +
      groups.slice(0, 20).map((g) => `
        <div class="sr-bar-row">
          <span class="sr-bar-label" title="${srEsc(g.label)}">${srEsc(g.label)}</span>
          <span class="sr-bar-track"><span class="sr-bar-fill" style="width:${Math.max(2, Math.round((Math.abs(g.value) / max) * 100))}%"></span></span>
          <span class="sr-bar-val">${srEsc(g.display || g.value)}</span>
        </div>`).join("") +
      `</div>`;
  }

  view.innerHTML =
    `<div class="sr-head">
       <div>
         <div class="sr-title">${srEsc(d.name)}</div>
         <div class="sr-sub">${rows.length}行${d.truncated ? "（2000行までの制限あり）" : ""}${rows.length > 500 ? " ・ 画面には500行まで表示" : ""}</div>
       </div>
       <div class="sr-actions">
         <button class="btn" id="srToCall">リストを作る</button>
         <button class="btn ghost" id="srCsv">CSVで保存</button>
         ${d.id ? `<a class="btn ghost" href="${srEsc(d.instanceUrl)}/${srEsc(d.id)}" target="_blank" rel="noopener">Salesforceで開く</a>` : ""}
       </div>
     </div>` + chart +
    (cols.length && rows.length
      ? `<div class="sr-table-wrap"><table class="sr-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
      : (groups.length ? "" : '<div class="empty-state">表にできる明細がありませんでした。</div>'));
  const csvBtn = $("srCsv");
  if (csvBtn) csvBtn.addEventListener("click", srCsv);
}


// ===== ページ上部のタブ切り替え =====
document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.getElementById("sfTabs");
  if (!tabs) return;
  const show = (name) => {
    tabs.querySelectorAll(".rep-tab").forEach((b) => b.classList.toggle("active", b.dataset.sftab === name));
    // 立ち上げ／立ち上げ待ち／レポート系の3種類でパネルを出し分ける
    const panel = name === "launch" ? "launch"
      : name === "pending" ? "pending"
      : name === "process" ? "process" : "data";
    document.querySelectorAll("[data-sfpanel]").forEach((p) => {
      p.hidden = p.dataset.sfpanel !== panel;
    });
    if (panel === "pending") {
      if (typeof loadPending === "function") loadPending();
      return;
    }
    if (panel === "process") {
      if (typeof loadProcessSheet === "function") loadProcessSheet();
      return;
    }
    if (panel === "data") {
      const q = document.getElementById("srQ");
      if (q) { q.placeholder = name === "lead" ? "リードのレポート名で絞り込み（例：リード、アポ）" : "名前で絞り込み"; q.value = ""; }
      initSfReport(name);
    }
  };
  tabs.querySelectorAll(".rep-tab").forEach((b) => b.addEventListener("click", () => show(b.dataset.sftab)));
  // メニューから ?tab=... で直接そのタブを開けるようにする
  const want = new URLSearchParams(location.search).get("tab");
  if (want && tabs.querySelector(`.rep-tab[data-sftab="${CSS.escape(want)}"]`)) show(want);
  // 立ち上げ待ちの件数を、最初に一度だけ数えてタブに出す
  setTimeout(() => { if (typeof loadPending === "function") loadPending(); }, 1500);
});

// ───────────────────────────────────────────────────────────
// プロセスシート — SFの架電結果を「実績」に入れる
// ───────────────────────────────────────────────────────────
// レポートの一覧を読んで、選べるようにする。
// IDを自分で調べるのは手間なので、名前で選べるようにする。
async function loadProcessReports(selectedId) {
  const sel = $("psReportSel");
  if (!sel) return;
  sel.innerHTML = '<option value="">読み込み中…</option>';
  try {
    const d = await (await fetch("/api/salesforce/reports")).json();
    const list = d.reports || [];
    if (!list.length) {
      sel.innerHTML = '<option value="">レポートが見つかりませんでした</option>';
      return;
    }
    sel.innerHTML = '<option value="">レポートを選んでください</option>' +
      list.map((r) =>
        `<option value="${srEsc(r.id)}"${r.id === selectedId ? " selected" : ""}>` +
        `${srEsc(r.name)}${r.folder ? "（" + srEsc(r.folder) + "）" : ""}</option>`).join("");
    // 選んだら、下のID欄にも入れる（何が選ばれているか分かるように）
    if (!sel._wired) {
      sel._wired = true;
      sel.addEventListener("change", () => {
        if (!sel.value) return;
        $("psReport").value = sel.value;
        loadProcessFilters(sel.value, null);   // 選び直したら条件も読み直す
      });
    }
  } catch {
    sel.innerHTML = '<option value="">一覧を読めませんでした。IDを直接入れてください</option>';
  }
}

// レポートの絞り込み条件を出して、覚えさせる。
// 「今月」で絞らないと中身が出てこないレポートがあるため、条件ごと保存しておく。
let _psFilters = null;
let _psTerm = null;   // 判定に使った期間（画面に出して確かめられるように）

async function loadProcessFilters(reportId, saved) {
  const box = $("psFilters");
  if (!box) return;
  if (!reportId) { box.innerHTML = ""; return; }
  box.innerHTML = '<div class="sr-f-note">レポートの条件を読み込んでいます…</div>';
  try {
    const d = await (await fetch(`/api/salesforce/reports/${encodeURIComponent(reportId)}/filters`)).json();
    if (d.error) throw new Error(d.error);
    _psFilters = d;

    // 覚えている条件があれば、そちらを初期値にする
    const savedFs = (saved && saved.reportFilters) || null;
    const savedDate = (saved && saved.standardDateFilter) || null;
    const fs = (d.filters || []).map((f, i) => savedFs && savedFs[i] ? { ...f, ...savedFs[i] } : f);
    const dr = d.dateRanges || [];
    const cur = (savedDate && savedDate.durationValue) ||
      (d.standardDateFilter && d.standardDateFilter.durationValue) || "";

    box.innerHTML =
      `<div class="sr-f-head">レポートの絞り込み<span class="sr-f-note">この条件でレポートを実行します。自動更新にも使われます。</span></div>` +
      (dr.length
        ? `<div class="sr-f-row"><span class="sr-f-k">期間</span>
             <select class="sr-f-v" id="psDate">
               ${dr.map((x) => `<option value="${srEsc(x.value)}"${x.value === cur ? " selected" : ""}>${srEsc(x.label)}</option>`).join("")}
             </select></div>`
        : "") +
      fs.map((f) => `
        <div class="sr-f-row" data-col="${srEsc(f.column)}">
          <span class="sr-f-k">${srEsc(f.label)}</span>
          <select class="sr-f-op">
            ${SR_OPS.map(([v, l]) => `<option value="${v}"${v === f.operator ? " selected" : ""}>${l}</option>`).join("")}
          </select>
          <input type="text" class="sr-f-v" value="${srEsc(f.value || "")}" />
        </div>`).join("") +
      (fs.length || dr.length ? "" : '<div class="sr-f-note">このレポートには変えられる条件がありません。</div>');
  } catch (e) {
    box.innerHTML = `<div class="sr-f-note">条件を読めませんでした：${srEsc(e.message)}</div>`;
  }
}

// 保存されているApps ScriptのURL。入力欄と食い違っていたら知らせる。
let _psSavedGas = "";

function checkGasSaved() {
  const el = $("psGasUrl");
  const gs = $("psGasState");
  if (!el || !gs) return;
  const typed = el.value.trim();
  if (typed && typed !== _psSavedGas) {
    gs.className = "note cc-warn";
    gs.textContent = "このURLはまだ保存されていません。「設定を保存」を押してください。" +
      "保存しないと、30分ごとの自動更新では使われません。";
  }
}

// 画面で指定されている条件を、保存や実行に渡せる形にする
function psFilterBody() {
  if (!$("psFilters") || !$("psFilters").innerHTML) return null;
  const reportFilters = [...$("psFilters").querySelectorAll(".sr-f-row[data-col]")].map((row) => ({
    column: row.dataset.col,
    operator: row.querySelector(".sr-f-op").value,
    value: row.querySelector(".sr-f-v").value,
  }));
  const out = {};
  if (reportFilters.length) out.reportFilters = reportFilters;
  const dsel = $("psDate");
  if (dsel && _psFilters && _psFilters.standardDateFilter) {
    out.standardDateFilter = { ..._psFilters.standardDateFilter, durationValue: dsel.value };
  }
  if (_psFilters && _psFilters.booleanFilter) out.reportBooleanFilter = _psFilters.booleanFilter;
  return Object.keys(out).length ? out : null;
}

// いま選ばれている分け方
function termMode() {
  const on = document.querySelector('input[name="psTermMode"]:checked');
  return on && on.value === "fixed" ? "fixed" : "auto";
}

// 「決めた期間」を使うときだけ、日付の欄を出す
function syncTermMode() {
  const box = $("psTermDates");
  if (box) box.hidden = termMode() !== "fixed";
}
document.addEventListener("change", (e) => {
  if (e.target && e.target.name === "psTermMode") syncTermMode();
});
// 画面を開いた時点でも、いまの選び方に合わせておく
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", syncTermMode);
else syncTermMode();

async function loadProcessSheet() {
  if (!$("psSheet")) return;
  try {
    const d = await (await fetch("/api/process-sheet")).json();
    $("psSheet").value = d.sheetId || "";
    $("psName").value = d.sheetName || "";
    $("psReport").value = d.reportId || "";
    $("psOwner").value = d.owner || "";
    $("psFrom").value = d.termFrom || "";
    $("psTo").value = d.termTo || "";
    const want = d.termMode === "fixed" ? "fixed" : "auto";
    const rb = document.querySelector(`input[name="psTermMode"][value="${want}"]`);
    if (rb) { rb.checked = true; syncTermMode(); }
    if ($("psAuto")) $("psAuto").checked = !!d.autoRun;
    if ($("psGasUrl")) $("psGasUrl").value = d.gasUrl || "";
    const gs = $("psGasState");
    if (gs) {
      gs.textContent = d.gasUrl
        ? `Apps Script経由で書き込みます${d.gasSecretSet ? "（合言葉は保存済み）" : "（合言葉が未設定です）"}`
        : "いまはkinbotのアカウントで直接書き込んでいます。";
      gs.className = "note";
    }
    _psSavedGas = d.gasUrl || "";
    checkGasSaved();
    loadProcessReports(d.reportId || "");
    loadProcessFilters(d.reportId || "", d.filters);

    // 自動更新の状態を、そのまま出す
    const note = $("psAutoNote");
    if (note) {
      const l = d.last || {};
      const when = l.at ? new Date(l.at).toLocaleString("ja-JP", { hour12: false }) : "";
      note.innerHTML =
        `${d.intervalMin || 30}分ごとに、平日の${srEsc(d.hours || "7-22")}時だけ動きます。手で押す必要はなくなります。` +
        (l.at
          ? `<br>直近の自動更新：${srEsc(when)}　${l.ok
              ? `${l.count}箇所を更新`
              : `<span class="ps-skip">失敗（${srEsc(l.error)}）` +
                (/403|PERMISSION_DENIED/.test(l.error || "") && !d.gasUrl
                  ? "<br>Apps ScriptのURLが保存されていません。下の設定を保存してください。" : "") +
                `</span>`}`
          : "");
    }
  } catch {}
}

function psBody(dryRun) {
  return {
    sheetId: $("psSheet").value, sheetName: $("psName").value,
    reportId: $("psReport").value, owner: $("psOwner").value,
    termFrom: $("psFrom").value, termTo: $("psTo").value,
    termMode: termMode(),
    autoRun: $("psAuto") ? $("psAuto").checked : false,
    gasUrl: $("psGasUrl") ? $("psGasUrl").value : undefined,
    gasSecret: $("psGasSecret") ? $("psGasSecret").value : undefined,
    filters: psFilterBody(),
    dryRun,
  };
}

// 獲得者ごとのアポ件数。Chatに流れたアポと突き合わせて確かめるための表。
function psApoByPerson(list) {
  if (!Array.isArray(list) || !list.length) return "";
  const rows = list.map((x) =>
    `<tr><td>${srEsc(x.setter)}</td>` +
    `<td class="ps-num">${x.inTerm}</td>` +
    `<td class="ps-num">${x.outTerm}</td>` +
    `<td class="ps-num${x.undecided ? " ps-out" : ""}">${x.undecided || 0}</td>` +
    `<td class="ps-days">${x.days.map((dd) =>
      `${srEsc(dd.day)}<span class="dk-dim">（内${dd.inTerm}/外${dd.outTerm}${dd.undecided ? `/未${dd.undecided}` : ""}）</span>`
    ).join("　")}</td></tr>`).join("");
  return `<details class="ps-detail" open><summary>獲得者ごとのアポ（シートに書く数）</summary>` +
    `<p class="note">コール・接触はSalesforceのレポートから、アポはkinbotのアポ記録（Chatに流れたもの）から数えています。` +
    `Chatの通知件数と見比べて、合っているか確かめられます。</p>` +
    `<table class="ps-table"><thead><tr><th>アポ獲得者</th><th>期内</th><th>期外</th><th>商談日未定</th><th>日ごと</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></details>`;
}

// アポが期内・期外のどちらに入ったかを、1件ずつ出す。
// 「期内のはずなのに期外」の原因を、その場で確かめられるようにする。
function psApoDetail(list) {
  if (!list || !list.length) return "";
  const ng = list.filter((x) => x.term !== "期内");
  return `<details class="ps-apo"${ng.length ? " open" : ""}>` +
    `<summary>アポの内訳（${list.length}件${ng.length ? `／うち期内でないもの ${ng.length}件` : ""}）` +
    `${_psTerm ? (_psTerm.mode === "auto"
        ? "　分け方：アポを取った月と商談の月が同じなら期内"
        : `　期内とみなす期間：${srEsc(_psTerm.from)} 〜 ${srEsc(_psTerm.to)}`) : ""}</summary>` +
    `<div class="ps-apo-bar">` +
    `<input type="text" id="psApoFind" class="sf-input" placeholder="予定名で絞り込み（例：テスト）" />` +
    `<button type="button" class="btn ghost" id="psApoPick">絞り込んだものに印を付ける</button>` +
    `<button type="button" class="btn ghost" id="psApoDrop">印を付けたものを集計から外す</button>` +
    `<span class="rev-status" id="psApoStatus"></span></div>` +
    `<table class="ps-table"><thead><tr><th></th><th>アポを取った日時</th><th>獲得者</th><th>商談日</th><th>判定</th><th>予定名</th></tr></thead><tbody>` +
    list.slice(0, 100).map((x) =>
      `<tr class="${x.term === "期内" ? "" : "ps-out"}" data-slug="${srEsc(x.slug || "")}" data-label="${srEsc(x.label || "")}">` +
      `<td><input type="checkbox" class="ps-apo-chk" ${x.slug ? "" : "disabled"} /></td>` +
      `<td>${srEsc(x.createdJst || x.day || "")}${x.apoAtMissing ? '<span class="dk-dim">（推定）</span>' : ""}</td>` +
      `<td>${srEsc(x.setter || "")}</td>` +
      `<td>${srEsc(x.meetingDate || "—")}</td><td>${srEsc(x.term || "")}</td>` +
      `<td>${srEsc((x.label || "").slice(0, 30))}</td></tr>`).join("") +
    `</tbody></table></details>`;
}

// 内訳から、テストで作ったアポを選んで集計から外す
function wireApoPicker() {
  const find = $("psApoFind");
  const pick = $("psApoPick");
  const drop = $("psApoDrop");
  if (!pick || pick._wired) return;
  pick._wired = true;

  const rows = () => [...document.querySelectorAll(".ps-apo tbody tr[data-slug]")];
  const say = (t, ms) => {
    const e = $("psApoStatus");
    if (!e) return;
    e.textContent = t || "";
    if (ms) setTimeout(() => { if (e.textContent === t) e.textContent = ""; }, ms);
  };

  // 入力した言葉を含むものに、まとめて印を付ける
  pick.addEventListener("click", () => {
    const w = (find.value || "").trim();
    if (!w) { say("絞り込む言葉を入れてください", 4000); return; }
    let n = 0;
    for (const r of rows()) {
      const hit = (r.dataset.label || "").includes(w);
      const c = r.querySelector(".ps-apo-chk");
      if (c && hit && !c.disabled) { c.checked = true; n++; }
    }
    say(`${n}件に印を付けました`, 4000);
  });

  // 入力に合わせて、行を絞る
  find.addEventListener("input", () => {
    const w = (find.value || "").trim();
    for (const r of rows()) r.hidden = !!w && !(r.dataset.label || "").includes(w);
  });

  drop.addEventListener("click", async () => {
    const slugs = rows()
      .filter((r) => r.querySelector(".ps-apo-chk")?.checked)
      .map((r) => r.dataset.slug).filter(Boolean);
    if (!slugs.length) { say("印を付けたものがありません", 4000); return; }
    if (!confirm(`${slugs.length}件を集計から外します。\n実績・均等化・通知の数から除かれます。よろしいですか？`)) return;
    say("外しています…");
    try {
      const r = await fetch("/api/smart-links/excluded-many", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ slugs, excluded: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "外せませんでした");
      say(`${d.count}件を外しました。もう一度「中身を確認する」を押してください`, 8000);
      for (const row of rows()) {
        if (row.querySelector(".ps-apo-chk")?.checked) row.remove();
      }
    } catch (e) { say("失敗: " + e.message); }
  });
}

function psSay(t, ms) {
  const e = $("psStatus");
  if (!e) return;
  e.textContent = t || "";
  if (ms) setTimeout(() => { if (e.textContent === t) e.textContent = ""; }, ms);
}

async function psRun(dryRun) {
  const box = $("psResult");
  psSay(dryRun ? "確認しています…" : "書き込んでいます…");
  box.innerHTML = "";
  try {
    const r = await fetch("/api/process-sheet/run", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(psBody(dryRun)),
    });
    const d = await r.json();
    if (!r.ok) {
      const err = new Error(d.error || "できませんでした");
      err.hint = d.hint || "";
      throw err;
    }

    if (!dryRun) {
      psSay(`${d.count}箇所に書き込みました`, 8000);
      box.innerHTML = `<div class="ps-done">シートを更新しました（${d.count}箇所）。シートを開いて確認してください。</div>`;
      return;
    }

    psSay("");
    const ups = d.updates || [];
    box.innerHTML =
      `<div class="ps-sum">レポートの明細 ${d.rows}行 ／ アポは${srEsc(d.apoSource || "-")}` +
      `<br>コール・接触はSFのレポートから、アポ（期内・期外）はkinbotのアポ記録からです` +
      (d.apoInSf ? `（SFのレポートにもアポの印が ${d.apoInSf}件ありますが、商談日が無く期内・期外を分けられないため使っていません）` : "") +
      `<br>` +
      `シートの担当者 ${(d.people || []).join("、")} ／ 数えられた人 ${(d.matched || []).join("、") || "なし"}</div>` +
      (d.skipped && d.skipped.length ? `<div class="ps-skip">${srEsc(d.skipped.join(" ／ "))}</div>` : "") +
      (d.apoFixed && d.apoFixed.checked
        ? `<div class="ps-note">日付が足りないアポ ${d.apoFixed.checked}件を調べ、` +
          `商談日 ${d.apoFixed.filled}件・アポ取得日 ${d.apoFixed.filledApoAt || 0}件をカレンダーから補いました。` +
          (d.apoFixed.notes && d.apoFixed.notes.length
            ? `<br><span class="ps-skip">補えなかったもの：${srEsc(d.apoFixed.notes.join(" ／ "))}</span>` : "") +
          `</div>`
        : "") +
      (() => { _psTerm = d.termUsed || null; return ""; })() +
      (d.undecided
        ? `<div class="ps-skip">商談日が分かっていないアポが ${d.undecided}件あります。` +
          `これらは「期外」に入ります（下の内訳で「商談日が未定」と出ているもの）。</div>`
        : "") +
      psApoByPerson(d.apoByPerson) +
      psApoDetail(d.apoDetail) +
      (ups.length
        ? `<div class="ps-note">この内容で書き込みます（${d.count}箇所）。問題なければ「シートに書き込む」を押してください。</div>` +
          `<table class="ps-table"><thead><tr><th>セル</th><th>担当</th><th>日付</th><th>項目</th><th>値</th></tr></thead><tbody>` +
          ups.slice(0, 200).map((u) =>
            `<tr><td>${srEsc(u.range)}</td><td>${srEsc(u.who)}</td><td>${srEsc(u.date)}</td><td>${srEsc(u.metric)}</td><td class="ps-v">${srEsc(u.value)}</td></tr>`).join("") +
          `</tbody></table>`
        : '<div class="ps-note">書き込む内容がありませんでした。レポートの期間や担当者名をご確認ください。</div>');
    wireApoPicker();
  } catch (e) {
    psSay("");
    box.innerHTML = `<div class="ps-err">${srEsc(e.message)}</div>` +
      (e.hint ? `<div class="ps-note">${srEsc(e.hint)}</div>` : "");
    // 保護が原因のときは、Apps Scriptの設定欄を開いて気づけるようにする
    if (/403|PERMISSION_DENIED|保護/.test(e.message + (e.hint || "")) && $("psGasBox")) {
      $("psGasBox").open = true;
    }
  }
}

if ($("psSave")) {
  $("psSave").addEventListener("click", async () => {
    psSay("保存しています…");
    try {
      const r = await fetch("/api/process-sheet", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify(psBody(true)),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "保存できませんでした");
      if (d.psSheetId) $("psSheet").value = d.psSheetId;
      if ($("psGasSecret")) $("psGasSecret").value = "";   // 合言葉は画面に残さない
      psSay("保存しました", 4000);
      loadProcessSheet();
    } catch (e) { psSay("失敗: " + e.message); }
  });
  if ($("psAuto")) $("psAuto").addEventListener("change", async () => {
    const on = $("psAuto").checked;
    if (on && !confirm(
      "30分ごとに、シートの「実績」を自動で書き換えます。\n" +
      "先に「中身を確認する」で内容を確かめましたか？\n\nよろしいですか？")) {
      $("psAuto").checked = false;
      return;
    }
    psSay("保存しています…");
    try {
      const r = await fetch("/api/process-sheet", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify(psBody(true)),
      });
      if (!r.ok) throw new Error(((await r.json()) || {}).error || "保存できませんでした");
      psSay(on ? "30分ごとに自動で書き込みます" : "自動更新を止めました", 5000);
      loadProcessSheet();
    } catch (e) { psSay("失敗: " + e.message); $("psAuto").checked = !on; }
  });

  if ($("psRepReload")) $("psRepReload").addEventListener("click", () => loadProcessReports($("psReport").value));

  if ($("psPerm")) $("psPerm").addEventListener("click", async () => {
    psSay("調べています…");
    $("psResult").innerHTML = "";
    try {
      const r = await fetch("/api/process-sheet/permission", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(psBody(true)),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "調べられませんでした");
      psSay("");
      const prot = (d.protected || []).map((p) =>
        `${srEsc(p.sheet)}の${srEsc(p.where)}${p.description ? `「${srEsc(p.description)}」` : ""}` +
        `${p.canEditThis ? "（編集できます）" : "（編集できません）"}`).join("<br>");
      $("psResult").innerHTML =
        `<div class="ps-sum">${srEsc(d.name || "")}　書き込むアカウント：${srEsc(d.owner)}` +
        `${d.probe ? `　試したセル：${srEsc(d.probe)}` : ""}` +
        `　経路：${d.via === "gas" ? "Apps Script経由" : "kinbotから直接"}</div>` +
        `<div class="${d.canWrite === false ? "ps-err" : "ps-note"}">` +
        `${d.canWrite === true ? "書き込めます"
          : d.canWrite === false ? "書き込めません"
          : d.canEdit === true ? "編集権限あり" : d.canEdit === false ? "編集権限なし" : "権限を確認できません"}</div>` +
        (prot ? `<div class="ps-sum">保護の一覧<br>${prot}</div>` : "") +
        (d.scopes && d.scopes.length
          ? `<div class="ps-sum">いまの権限：${srEsc(d.scopes.join("、"))}</div>` : "") +
        `<div class="ps-note">${srEsc(d.note || "")}</div>`;
    } catch (e) { psSay(""); $("psResult").innerHTML = `<div class="ps-err">${srEsc(e.message)}</div>`; }
  });

  if ($("psGasUrl")) $("psGasUrl").addEventListener("input", checkGasSaved);

  if ($("psGasCode")) $("psGasCode").addEventListener("click", async () => {
    const box = $("psGasCodeBox");
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false;
    box.textContent = "読み込んでいます…";
    try {
      const t = await (await fetch("/kinbot-sheet-writer.gs")).text();
      box.textContent = t;
    } catch { box.textContent = "コードを読み込めませんでした。"; }
  });

  $("psCheck").addEventListener("click", () => psRun(true));
  $("psRun").addEventListener("click", () => {
    if (!confirm("シートの「実績」の列を書き換えます。\n先に「中身を確認する」で内容を見ましたか？\n\n実行してよろしいですか？")) return;
    psRun(false);
  });
}


// ───────────────────────────────────────────────────────────
// 絞り込んだレポートを、そのまま kincall のリストにする
// ───────────────────────────────────────────────────────────
async function srToKincall() {
  const d = _sr.current;
  if (!d || !(d.rows || []).length) { alert("先にレポートを開いてください。"); return; }
  const name = prompt("kincallのリスト名を入れてください。", d.name || "コールリスト");
  if (!name) return;

  const btn = document.getElementById("srToCall");
  if (btn) { btn.disabled = true; btn.textContent = "送っています…"; }
  try {
    const r = await fetch("/api/calls/from-report", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name, columns: d.columns || [], rows: d.rows || [],
        share: (window.kcShareMembers || []),
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "送れませんでした");
    if (btn) { btn.textContent = `${j["件数"]}件を送りました`; }
    const 分けた = Number(j["分けた人数"] || 0);
    if (confirm(`「${j.name}」に${j["件数"]}件を入れました。` +
        (分けた ? `（${分けた}人に分けました）` : "") + `\nリストを見ますか？`)) {
      location.href = "/kincall";
    } else if (btn) {
      btn.disabled = false; btn.textContent = "リストを作る";
    }
  } catch (e) {
    alert("送れませんでした：" + e.message);
    if (btn) { btn.disabled = false; btn.textContent = "リストを作る"; }
  }
}


document.addEventListener("click", (ev) => {
  const t = ev.target && ev.target.closest ? ev.target.closest("button") : null;
  if (t && t.id === "srToCall") { ev.preventDefault(); srToKincall(); }
});





// kincallから使う入口だけ外に出す
window.initSfReport = initSfReport;
}
