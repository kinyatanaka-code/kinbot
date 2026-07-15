// ===== ダッシュボードビルダー（Salesforce風） =====
// ユーザーが軸・指標・グラフ種類を自由に選んでウィジェットを作成できる。

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PIE_COLORS = ["#0d5b47","#1d9e75","#5DCAA5","#9FE1CB","#BA7517","#378ADD","#D85A30","#534AB7","#D4537E","#E1F5EE"];

let allTags = [];
let userMap = {};
const ownerName = (email) => userMap[String(email||"").toLowerCase()] || email || "不明";

// ===== 軸・指標の定義 =====
const AXIS_OPTIONS = [
  { value: "owner",                   label: "担当者" },
  { value: "customer_employee_size",   label: "従業員規模" },
  { value: "customer_industry",        label: "業界" },
  { value: "customer_hq_region",       label: "地域" },
  { value: "hiring_type_need",         label: "新卒/中途" },
  { value: "target_hire_count",        label: "採用人数" },
  { value: "appeal_points_used",       label: "訴求内容" },
  { value: "talk_patterns",            label: "話法の型" },
  { value: "objection_handling_style", label: "懸念対応" },
  { value: "discovery_items_covered",  label: "ヒアリング深度" },
  { value: "customer_response_status", label: "顧客反応" },
  { value: "result",                   label: "受注結果" },
];
const METRIC_OPTIONS = [
  { value: "count",         label: "件数" },
  { value: "response_rate", label: "案件化率" },
  { value: "won_rate",      label: "受注率" },
  { value: "pct",           label: "構成比（%）" },
];
const CHART_TYPES = [
  { value: "bar",   label: "棒グラフ",   icon: "📊" },
  { value: "pie",   label: "円グラフ",   icon: "🍩" },
  { value: "kpi",   label: "KPIカード", icon: "🔢" },
  { value: "table", label: "テーブル",   icon: "📋" },
];
const ARRAY_FIELDS = new Set(["appeal_points_used","talk_patterns","discovery_items_covered","key_pain_points","objections_raised","meeting_stages"]);

// ===== 状態管理 =====
let widgets = []; // [{id, chart, axis, metric, title}, ...]
const STORAGE_KEY = "kinbot_dashboard_v2";
let widgetIdCounter = Date.now();

function saveLayout() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets)); } catch {}
}
function loadLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (Array.isArray(saved) && saved.length) return saved;
  } catch {}
  return [];
}

// ===== 初期化 =====
window.addEventListener("DOMContentLoaded", async () => {
  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 90);
  $("dbFrom").value = from.toISOString().slice(0, 10);
  $("dbTo").value = now.toISOString().slice(0, 10);
  $("dbFrom").addEventListener("change", reloadData);
  $("dbTo").addEventListener("change", reloadData);
  $("dbOwner").addEventListener("change", reloadData);
  $("addWidgetBtn").addEventListener("click", openCreator);
  $("closeModal").addEventListener("click", () => $("addModal").hidden = true);
  $("addModal").addEventListener("click", (e) => { if (e.target === $("addModal")) $("addModal").hidden = true; });

  try {
    const users = await (await fetch("/api/users")).json();
    for (const u of users || []) if (u.email) userMap[u.email.toLowerCase()] = u.name || u.email;
  } catch {}
  widgets = loadLayout();
  await reloadData();
});

async function reloadData() {
  const from = $("dbFrom").value;
  const to = $("dbTo").value;
  const owner = $("dbOwner").value;
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  if (owner) qs.set("owner", owner);
  try {
    const r = await fetch("/api/feature-c/tags?" + qs.toString());
    allTags = (await r.json()).tags || [];
  } catch { allTags = []; }
  const ownerSel = $("dbOwner");
  const curVal = ownerSel.value;
  const owners = [...new Set(allTags.map((t) => t.owner).filter(Boolean))].sort();
  ownerSel.innerHTML = '<option value="">全員</option>' + owners.map((o) => `<option value="${esc(o)}">${esc(ownerName(o))}</option>`).join("");
  ownerSel.value = curVal;
  renderGrid();
}

// ===== データ集計ヘルパー =====
function getValues(tags, axis) {
  const counts = {};
  for (const t of tags) {
    if (ARRAY_FIELDS.has(axis)) {
      const arr = Array.isArray(t[axis]) ? t[axis] : [];
      if (axis === "meeting_stages") {
        for (const s of arr) if (s && s.step) counts[s.step] = (counts[s.step] || 0) + 1;
      } else {
        for (const v of arr) if (v) counts[v] = (counts[v] || 0) + 1;
      }
    } else {
      let v = t[axis];
      if (axis === "owner") v = ownerName(v);
      counts[v || "不明"] = (counts[v || "不明"] || 0) + 1;
    }
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function calcMetric(tags, axis, metric) {
  if (metric === "count" || metric === "pct") {
    const vals = getValues(tags, axis);
    const total = vals.reduce((s, [, n]) => s + n, 0) || 1;
    if (metric === "pct") return vals.map(([k, n]) => [k, Math.round(n / total * 100)]);
    return vals;
  }
  // 案件化率 or 受注率：軸の各値ごとに率を計算
  const groups = {};
  for (const t of tags) {
    let keys;
    if (ARRAY_FIELDS.has(axis)) {
      const arr = Array.isArray(t[axis]) ? t[axis] : [];
      keys = axis === "meeting_stages" ? arr.filter(s => s && s.step).map(s => s.step) : arr.filter(Boolean);
    } else {
      let v = t[axis];
      if (axis === "owner") v = ownerName(v);
      keys = [v || "不明"];
    }
    for (const k of keys) {
      if (!groups[k]) groups[k] = { total: 0, hit: 0 };
      groups[k].total++;
      if (metric === "response_rate") {
        if (t.customer_response_status === "担当者合意" || t.customer_response_status === "案件化") groups[k].hit++;
      } else if (metric === "won_rate") {
        if (t.result === "受注") groups[k].hit++;
      }
    }
  }
  return Object.entries(groups)
    .map(([k, v]) => [k, v.total ? Math.round(v.hit / v.total * 100) : 0, v.hit, v.total])
    .sort((a, b) => b[1] - a[1]);
}

function getKpiValue(tags, metric) {
  const total = tags.length;
  if (!total) return { value: "0", sub: "データなし" };
  if (metric === "count") return { value: String(total), sub: "対象期間の全案件" };
  if (metric === "response_rate") {
    const hit = tags.filter(t => t.customer_response_status === "担当者合意" || t.customer_response_status === "案件化").length;
    return { value: Math.round(hit / total * 100) + "%", sub: `${hit}/${total}件` };
  }
  if (metric === "won_rate") {
    const hit = tags.filter(t => t.result === "受注").length;
    return { value: Math.round(hit / total * 100) + "%", sub: `${hit}/${total}件` };
  }
  return { value: String(total), sub: "" };
}

// ===== グリッド描画 =====
function renderGrid() {
  const grid = $("dbGrid");
  if (!widgets.length) {
    grid.innerHTML = '<div class="db-grid-empty"><div style="font-size:40px;margin-bottom:12px;">📊</div>ダッシュボードにウィジェットがありません<br><br>「＋ ウィジェットを追加」ボタンで<br>グラフやKPIカードを自由に作成できます</div>';
    return;
  }
  grid.innerHTML = "";
  for (const w of widgets) {
    const el = document.createElement("div");
    el.className = "db-widget" + (w.chart === "kpi" ? " db-widget-kpi" : "");
    el.dataset.id = w.id;
    el.draggable = true;
    el.innerHTML = `
      <div class="db-widget-head">
        <div class="db-widget-drag" title="ドラッグで移動">⠿</div>
        <span class="db-widget-title">${esc(w.title || "")}</span>
        <div class="db-widget-actions">
          <button class="db-widget-btn" data-action="edit" title="編集">✎</button>
          <button class="db-widget-btn" data-action="remove" title="削除">✕</button>
        </div>
      </div>
      <div class="db-widget-body" id="body_${w.id}"></div>
    `;
    el.querySelector('[data-action="remove"]').addEventListener("click", () => {
      widgets = widgets.filter(x => x.id !== w.id);
      saveLayout(); renderGrid();
    });
    el.querySelector('[data-action="edit"]').addEventListener("click", () => openCreator(w));
    // ドラッグ&ドロップ
    el.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", w.id); el.classList.add("dragging"); });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));
    el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("drag-over"); });
    el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
    el.addEventListener("drop", (e) => {
      e.preventDefault(); el.classList.remove("drag-over");
      const draggedId = e.dataTransfer.getData("text/plain");
      if (draggedId === w.id) return;
      const fi = widgets.findIndex(x => x.id === draggedId);
      const ti = widgets.findIndex(x => x.id === w.id);
      if (fi < 0 || ti < 0) return;
      const [moved] = widgets.splice(fi, 1);
      widgets.splice(ti, 0, moved);
      saveLayout(); renderGrid();
    });
    grid.appendChild(el);
    drawWidget(w, $("body_" + w.id));
  }
}

// ===== ウィジェット描画 =====
function drawWidget(w, el) {
  if (!el) return;
  const tags = allTags;
  switch (w.chart) {
    case "kpi": return drawKpi(el, tags, w);
    case "bar": return drawBar(el, tags, w);
    case "pie": return drawPie(el, tags, w);
    case "table": return drawTable(el, tags, w);
  }
}

function drawKpi(el, tags, w) {
  const d = getKpiValue(tags, w.metric);
  el.innerHTML = `<div class="db-kpi"><div class="db-kpi-value">${esc(d.value)}</div><div class="db-kpi-sub">${esc(d.sub)}</div></div>`;
}

function drawBar(el, tags, w) {
  const data = calcMetric(tags, w.axis, w.metric);
  if (!data.length) { el.innerHTML = '<div class="db-empty">データなし</div>'; return; }
  const isRate = w.metric === "response_rate" || w.metric === "won_rate" || w.metric === "pct";
  const maxVal = Math.max(...data.map(d => isRate ? d[1] : d[1])) || 1;
  el.innerHTML = data.slice(0, 12).map(d => {
    const label = d[0];
    const val = d[1];
    const pct = Math.round(val / maxVal * 100);
    const suffix = isRate ? "%" : "件";
    const detail = d.length >= 4 ? `(${d[2]}/${d[3]})` : "";
    return `<div class="db-bar-row">
      <div class="db-bar-label" title="${esc(label)}">${esc(label)}</div>
      <div class="db-bar-track"><div class="db-bar-fill" style="width:${pct}%;background:#1d9e75;">${pct > 15 ? val + suffix : ""}</div></div>
      <div class="db-bar-val">${val}${suffix} <span style="color:#8a938c;font-size:10px;">${detail}</span></div>
    </div>`;
  }).join("");
}

function drawPie(el, tags, w) {
  const data = calcMetric(tags, w.axis, w.metric === "count" || w.metric === "pct" ? "count" : w.metric);
  if (!data.length) { el.innerHTML = '<div class="db-empty">データなし</div>'; return; }
  const slices = data.slice(0, 8);
  const total = slices.reduce((s, d) => s + d[1], 0) || 1;
  let cum = 0;
  const toXY = (a, r) => [60 + r * Math.cos((a - 90) * Math.PI / 180), 60 + r * Math.sin((a - 90) * Math.PI / 180)];
  let svg = '<svg viewBox="0 0 120 120" class="db-pie-svg">';
  const segments = slices.map((d, i) => {
    const pct = d[1] / total;
    const start = cum * 360; cum += pct;
    const end = cum * 360;
    return { start, end, color: PIE_COLORS[i % PIE_COLORS.length], label: d[0], count: d[1] };
  });
  for (const seg of segments) {
    if (seg.end - seg.start >= 359.9) {
      svg += `<circle cx="60" cy="60" r="50" fill="${seg.color}" />`;
    } else {
      const [x1, y1] = toXY(seg.start, 50);
      const [x2, y2] = toXY(seg.end, 50);
      const large = seg.end - seg.start > 180 ? 1 : 0;
      svg += `<path d="M60,60 L${x1},${y1} A50,50 0 ${large},1 ${x2},${y2} Z" fill="${seg.color}" />`;
    }
  }
  svg += '</svg>';
  const legend = segments.map(s =>
    `<div class="db-pie-leg-item"><div class="db-pie-leg-dot" style="background:${s.color}"></div>${esc(s.label)} (${s.count})</div>`
  ).join("");
  el.innerHTML = `<div class="db-pie-wrap">${svg}<div class="db-pie-legend">${legend}</div></div>`;
}

function drawTable(el, tags, w) {
  const data = calcMetric(tags, w.axis, w.metric);
  if (!data.length) { el.innerHTML = '<div class="db-empty">データなし</div>'; return; }
  const isRate = w.metric === "response_rate" || w.metric === "won_rate" || w.metric === "pct";
  const axisLabel = AXIS_OPTIONS.find(a => a.value === w.axis)?.label || w.axis;
  const metricLabel = METRIC_OPTIONS.find(m => m.value === w.metric)?.label || w.metric;
  let html = `<table class="db-table"><thead><tr><th>${esc(axisLabel)}</th><th style="text-align:right;">${esc(metricLabel)}</th>`;
  if (data[0]?.length >= 4) html += `<th style="text-align:right;">内訳</th>`;
  html += `</tr></thead><tbody>`;
  for (const d of data.slice(0, 20)) {
    const suffix = isRate ? "%" : (w.metric === "pct" ? "%" : "件");
    html += `<tr><td>${esc(d[0])}</td><td style="text-align:right;font-weight:600;">${d[1]}${suffix}</td>`;
    if (d.length >= 4) html += `<td style="text-align:right;color:#8a938c;">${d[2]}/${d[3]}</td>`;
    html += `</tr>`;
  }
  html += `</tbody></table>`;
  el.innerHTML = html;
}

// ===== ウィジェット作成/編集モーダル =====
function openCreator(editWidget) {
  const isEdit = !!editWidget;
  const modal = $("addModal");
  const body = $("widgetCatalog");

  const defaults = editWidget || { chart: "bar", axis: "owner", metric: "response_rate", title: "" };

  body.innerHTML = `
    <div class="db-creator">
      <div class="db-creator-section">
        <label class="db-creator-label">タイトル</label>
        <input type="text" id="wcTitle" class="db-creator-input" value="${esc(defaults.title)}" placeholder="（自動生成）" />
      </div>

      <div class="db-creator-section">
        <label class="db-creator-label">グラフの種類</label>
        <div class="db-creator-chips" id="wcChart">
          ${CHART_TYPES.map(c => `<button class="db-chip${c.value === defaults.chart ? " active" : ""}" data-value="${c.value}">${c.icon} ${c.label}</button>`).join("")}
        </div>
      </div>

      <div class="db-creator-section" id="wcAxisSection">
        <label class="db-creator-label">集計軸（横軸）</label>
        <div class="db-creator-chips" id="wcAxis">
          ${AXIS_OPTIONS.map(a => `<button class="db-chip${a.value === defaults.axis ? " active" : ""}" data-value="${a.value}">${a.label}</button>`).join("")}
        </div>
      </div>

      <div class="db-creator-section">
        <label class="db-creator-label">指標</label>
        <div class="db-creator-chips" id="wcMetric">
          ${METRIC_OPTIONS.map(m => `<button class="db-chip${m.value === defaults.metric ? " active" : ""}" data-value="${m.value}">${m.label}</button>`).join("")}
        </div>
      </div>

      <div class="db-creator-preview">
        <label class="db-creator-label">プレビュー</label>
        <div class="db-widget" style="cursor:default;">
          <div class="db-widget-head"><span class="db-widget-title" id="wcPreviewTitle">...</span></div>
          <div class="db-widget-body" id="wcPreviewBody"></div>
        </div>
      </div>

      <div class="db-creator-actions">
        <button class="db-creator-cancel" id="wcCancel">キャンセル</button>
        <button class="db-creator-save" id="wcSave">${isEdit ? "更新" : "追加"}</button>
      </div>
    </div>
  `;

  let state = { chart: defaults.chart, axis: defaults.axis, metric: defaults.metric };

  function updatePreview() {
    const title = $("wcTitle").value || autoTitle(state);
    $("wcPreviewTitle").textContent = title;
    // KPIの場合は軸セクション非表示
    const axisSec = $("wcAxisSection");
    if (axisSec) axisSec.style.display = state.chart === "kpi" ? "none" : "";
    drawWidget({ ...state, title }, $("wcPreviewBody"));
  }

  function bindChips(containerId, key) {
    const container = $(containerId);
    if (!container) return;
    container.querySelectorAll(".db-chip").forEach(btn => {
      btn.addEventListener("click", () => {
        container.querySelectorAll(".db-chip").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        state[key] = btn.dataset.value;
        updatePreview();
      });
    });
  }

  bindChips("wcChart", "chart");
  bindChips("wcAxis", "axis");
  bindChips("wcMetric", "metric");
  $("wcTitle").addEventListener("input", updatePreview);

  $("wcCancel").addEventListener("click", () => modal.hidden = true);
  $("wcSave").addEventListener("click", () => {
    const title = $("wcTitle").value || autoTitle(state);
    if (isEdit) {
      const w = widgets.find(x => x.id === editWidget.id);
      if (w) { w.chart = state.chart; w.axis = state.axis; w.metric = state.metric; w.title = title; }
    } else {
      widgets.push({ id: "w" + (++widgetIdCounter), chart: state.chart, axis: state.axis, metric: state.metric, title });
    }
    saveLayout(); modal.hidden = true; renderGrid();
  });

  updatePreview();
  modal.hidden = false;
}

function autoTitle(state) {
  const axisLabel = AXIS_OPTIONS.find(a => a.value === state.axis)?.label || state.axis;
  const metricLabel = METRIC_OPTIONS.find(m => m.value === state.metric)?.label || state.metric;
  const chartLabel = CHART_TYPES.find(c => c.value === state.chart)?.label || "";
  if (state.chart === "kpi") return metricLabel;
  return `${axisLabel}別 ${metricLabel}`;
}
