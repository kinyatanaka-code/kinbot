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
  view.innerHTML = '<div class="empty-state">レポートを実行中…</div>';
  try {
    const r = await fetch("/api/salesforce/reports/" + encodeURIComponent(id));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "実行に失敗しました");
    srShowResult(d);
  } catch (e) {
    view.innerHTML = `<div class="empty-state">${srEsc(e.message)}</div>`;
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
    const panel = name === "launch" ? "launch" : name === "pending" ? "pending" : "data";
    document.querySelectorAll("[data-sfpanel]").forEach((p) => {
      p.hidden = p.dataset.sfpanel !== panel;
    });
    if (panel === "pending") {
      if (typeof loadPending === "function") loadPending();
      return;
    }
    if (panel === "data") {
      const q = document.getElementById("srQ");
      if (q) { q.placeholder = name === "lead" ? "リードのレポート名で絞り込み（例：リード、アポ）" : "名前で絞り込み"; q.value = ""; }
      initSfReport(name);
    }
  };
  tabs.querySelectorAll(".rep-tab").forEach((b) => b.addEventListener("click", () => show(b.dataset.sftab)));
  // 立ち上げ待ちの件数を、最初に一度だけ数えてタブに出す
  setTimeout(() => { if (typeof loadPending === "function") loadPending(); }, 1500);
});
