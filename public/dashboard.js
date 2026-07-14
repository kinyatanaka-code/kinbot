// ===== ダッシュボードビルダー =====
// プリセットウィジェットを選んでグリッドに配置。レイアウトはlocalStorageに保存。
// データは /api/feature-c/tags から取得（Feature Cのタグデータ）。

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const PIE_COLORS = ["#0d5b47", "#1d9e75", "#5DCAA5", "#9FE1CB", "#E1F5EE", "#BA7517", "#378ADD", "#D85A30", "#534AB7", "#D4537E"];

let allTags = [];
let userMap = {};
const ownerName = (email) => userMap[String(email || "").toLowerCase()] || email || "不明";

// ===== ウィジェットカタログ =====
const WIDGET_CATALOG = [
  { type: "kpi_total",       icon: "📊", name: "案件数",           desc: "全案件数を表示" },
  { type: "kpi_response",    icon: "📈", name: "案件化率",         desc: "担当者合意+案件化の割合" },
  { type: "kpi_won",         icon: "🏆", name: "受注率",           desc: "受注/全体" },
  { type: "pie_employee",    icon: "🍩", name: "従業員規模の分布",  desc: "円グラフ" },
  { type: "pie_industry",    icon: "🍩", name: "業界の分布",       desc: "円グラフ" },
  { type: "pie_region",      icon: "🍩", name: "地域の分布",       desc: "円グラフ" },
  { type: "bar_member_rate", icon: "📊", name: "メンバー別案件化率", desc: "横棒グラフ" },
  { type: "bar_appeal",      icon: "📊", name: "訴求内容の利用回数", desc: "横棒グラフ" },
  { type: "rank_talk",       icon: "🏅", name: "話法ランキング",    desc: "よく使われるTop5" },
  { type: "rank_pain",       icon: "🏅", name: "課題ランキング",    desc: "顧客の課題Top5" },
  { type: "step_rate",       icon: "📋", name: "ステップ実施率",    desc: "6ステップの実施率" },
  { type: "heatmap_mini",    icon: "🗺", name: "ミニヒートマップ",  desc: "メンバー×規模の受注率" },
];

// ===== 状態管理 =====
let widgets = []; // [{id, type}, ...]
const STORAGE_KEY = "kinbot_dashboard_layout";

function saveLayout() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets.map((w) => w.type))); } catch {}
}
function loadLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (Array.isArray(saved) && saved.length) return saved.map((type, i) => ({ id: "w" + i, type }));
  } catch {}
  // デフォルトレイアウト
  return [
    { id: "w0", type: "kpi_total" },
    { id: "w1", type: "kpi_response" },
    { id: "w2", type: "kpi_won" },
    { id: "w3", type: "pie_employee" },
    { id: "w4", type: "bar_member_rate" },
    { id: "w5", type: "rank_talk" },
  ];
}

// ===== 初期化 =====
window.addEventListener("DOMContentLoaded", async () => {
  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 90);
  $("dbFrom").value = from.toISOString().slice(0, 10);
  $("dbTo").value = now.toISOString().slice(0, 10);

  $("dbFrom").addEventListener("change", reload);
  $("dbTo").addEventListener("change", reload);
  $("dbOwner").addEventListener("change", reload);

  $("addWidgetBtn").addEventListener("click", openCatalog);
  $("closeModal").addEventListener("click", () => $("addModal").hidden = true);
  $("addModal").addEventListener("click", (e) => { if (e.target === $("addModal")) $("addModal").hidden = true; });

  // ユーザー名マップ
  try {
    const users = await (await fetch("/api/users")).json();
    for (const u of users || []) if (u.email) userMap[u.email.toLowerCase()] = u.name || u.email;
  } catch {}

  widgets = loadLayout();
  await reload();
});

async function reload() {
  const from = $("dbFrom").value;
  const to = $("dbTo").value;
  const owner = $("dbOwner").value;
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  if (owner) qs.set("owner", owner);
  try {
    const r = await fetch("/api/feature-c/tags?" + qs.toString());
    const d = await r.json();
    allTags = d.tags || [];
  } catch { allTags = []; }
  // 担当者セレクト更新
  const ownerSel = $("dbOwner");
  const curVal = ownerSel.value;
  const owners = [...new Set(allTags.map((t) => t.owner).filter(Boolean))].sort();
  ownerSel.innerHTML = '<option value="">全員</option>' + owners.map((o) => `<option value="${esc(o)}">${esc(ownerName(o))}</option>`).join("");
  ownerSel.value = curVal;
  renderGrid();
}

// ===== グリッド描画 =====
function renderGrid() {
  const grid = $("dbGrid");
  if (!widgets.length) {
    grid.innerHTML = '<div class="db-grid-empty">「＋ ウィジェットを追加」ボタンでウィジェットを配置してください</div>';
    return;
  }
  grid.innerHTML = "";
  for (const w of widgets) {
    const el = document.createElement("div");
    el.className = "db-widget";
    el.dataset.id = w.id;
    el.draggable = true;
    const cat = WIDGET_CATALOG.find((c) => c.type === w.type);
    el.innerHTML = `
      <div class="db-widget-head">
        <span class="db-widget-title">${esc(cat?.name || w.type)}</span>
        <div class="db-widget-actions">
          <button class="db-widget-btn" data-action="remove" title="削除">✕</button>
        </div>
      </div>
      <div class="db-widget-body" id="body_${w.id}"></div>
    `;
    // 削除ボタン
    el.querySelector('[data-action="remove"]').addEventListener("click", () => {
      widgets = widgets.filter((x) => x.id !== w.id);
      saveLayout();
      renderGrid();
    });
    // ドラッグ＆ドロップ
    el.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", w.id); el.classList.add("dragging"); });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));
    el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("drag-over"); });
    el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      el.classList.remove("drag-over");
      const draggedId = e.dataTransfer.getData("text/plain");
      if (draggedId === w.id) return;
      const fromIdx = widgets.findIndex((x) => x.id === draggedId);
      const toIdx = widgets.findIndex((x) => x.id === w.id);
      if (fromIdx < 0 || toIdx < 0) return;
      const [moved] = widgets.splice(fromIdx, 1);
      widgets.splice(toIdx, 0, moved);
      saveLayout();
      renderGrid();
    });
    grid.appendChild(el);
    renderWidget(w, $("body_" + w.id));
  }
}

// ===== ウィジェット描画 =====
function renderWidget(w, container) {
  if (!container) return;
  const tags = allTags;
  switch (w.type) {
    case "kpi_total": return renderKPI(container, tags.length, "案件数", "対象期間の全案件");
    case "kpi_response": {
      const pos = tags.filter((t) => t.customer_response_status === "担当者合意" || t.customer_response_status === "案件化").length;
      const rate = tags.length ? Math.round(pos / tags.length * 100) : 0;
      return renderKPI(container, rate + "%", "案件化率", `${pos}/${tags.length}件`);
    }
    case "kpi_won": {
      const won = tags.filter((t) => t.result === "受注").length;
      const rate = tags.length ? Math.round(won / tags.length * 100) : 0;
      return renderKPI(container, rate + "%", "受注率", `${won}/${tags.length}件`);
    }
    case "pie_employee": return renderPie(container, tags, "customer_employee_size");
    case "pie_industry": return renderPie(container, tags, "customer_industry");
    case "pie_region": return renderPie(container, tags, "customer_hq_region");
    case "bar_member_rate": return renderBarMembers(container, tags);
    case "bar_appeal": return renderBarArray(container, tags, "appeal_points_used");
    case "rank_talk": return renderRanking(container, tags, "talk_patterns", "話法");
    case "rank_pain": return renderRanking(container, tags, "key_pain_points", "課題");
    case "step_rate": return renderStepRate(container, tags);
    case "heatmap_mini": return renderMiniHeatmap(container, tags);
    default: container.innerHTML = '<div style="color:#8a938c;font-size:12px;">不明なウィジェット</div>';
  }
}

// --- KPI ---
function renderKPI(el, value, label, sub) {
  el.innerHTML = `<div class="db-kpi"><div class="db-kpi-value">${esc(String(value))}</div><div class="db-kpi-label">${esc(label)}</div><div class="db-kpi-sub">${esc(sub)}</div></div>`;
}

// --- 円グラフ ---
function renderPie(el, tags, key) {
  const counts = {};
  for (const t of tags) {
    const v = t[key] || "不明";
    counts[v] = (counts[v] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const total = sorted.reduce((s, [, n]) => s + n, 0) || 1;
  // SVG円グラフ
  let cumPct = 0;
  const segments = sorted.map(([, n], i) => {
    const pct = n / total;
    const startAngle = cumPct * 360;
    cumPct += pct;
    const endAngle = cumPct * 360;
    return { startAngle, endAngle, color: PIE_COLORS[i % PIE_COLORS.length] };
  });
  const toXY = (angle, r) => [60 + r * Math.cos((angle - 90) * Math.PI / 180), 60 + r * Math.sin((angle - 90) * Math.PI / 180)];
  let svg = '<svg viewBox="0 0 120 120" class="db-pie-svg">';
  for (const seg of segments) {
    if (seg.endAngle - seg.startAngle >= 359.9) {
      svg += `<circle cx="60" cy="60" r="50" fill="${seg.color}" />`;
    } else {
      const [x1, y1] = toXY(seg.startAngle, 50);
      const [x2, y2] = toXY(seg.endAngle, 50);
      const large = seg.endAngle - seg.startAngle > 180 ? 1 : 0;
      svg += `<path d="M60,60 L${x1},${y1} A50,50 0 ${large},1 ${x2},${y2} Z" fill="${seg.color}" />`;
    }
  }
  svg += '</svg>';
  const legend = sorted.map(([name, n], i) =>
    `<div class="db-pie-leg-item"><div class="db-pie-leg-dot" style="background:${PIE_COLORS[i % PIE_COLORS.length]}"></div>${esc(name)} (${n})</div>`
  ).join("");
  el.innerHTML = `<div class="db-pie-wrap">${svg}<div class="db-pie-legend">${legend}</div></div>`;
}

// --- 棒グラフ（メンバー別案件化率） ---
function renderBarMembers(el, tags) {
  const byOwner = {};
  for (const t of tags) {
    if (!t.owner) continue;
    if (!byOwner[t.owner]) byOwner[t.owner] = { total: 0, pos: 0 };
    byOwner[t.owner].total++;
    if (t.customer_response_status === "担当者合意" || t.customer_response_status === "案件化") byOwner[t.owner].pos++;
  }
  const entries = Object.entries(byOwner).sort((a, b) => {
    const ra = a[1].total ? a[1].pos / a[1].total : 0;
    const rb = b[1].total ? b[1].pos / b[1].total : 0;
    return rb - ra;
  });
  if (!entries.length) { el.innerHTML = '<div style="color:#8a938c;font-size:12px;">データなし</div>'; return; }
  el.innerHTML = entries.map(([owner, d]) => {
    const rate = d.total ? Math.round(d.pos / d.total * 100) : 0;
    return `<div class="db-bar-row">
      <div class="db-bar-label">${esc(ownerName(owner))}</div>
      <div class="db-bar-track"><div class="db-bar-fill" style="width:${rate}%;background:#1d9e75;">${rate > 10 ? rate + "%" : ""}</div></div>
      <div class="db-bar-val">${rate}% <span style="color:#8a938c;font-size:10px;">(${d.pos}/${d.total})</span></div>
    </div>`;
  }).join("");
}

// --- 棒グラフ（配列タグの出現回数） ---
function renderBarArray(el, tags, key) {
  const counts = {};
  for (const t of tags) for (const v of (Array.isArray(t[key]) ? t[key] : [])) if (v) counts[v] = (counts[v] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const max = sorted.length ? sorted[0][1] : 1;
  if (!sorted.length) { el.innerHTML = '<div style="color:#8a938c;font-size:12px;">データなし</div>'; return; }
  el.innerHTML = sorted.map(([name, n]) => {
    const pct = Math.round(n / max * 100);
    return `<div class="db-bar-row">
      <div class="db-bar-label">${esc(name)}</div>
      <div class="db-bar-track"><div class="db-bar-fill" style="width:${pct}%;background:#0d5b47;">${n}</div></div>
      <div class="db-bar-val">${n}回</div>
    </div>`;
  }).join("");
}

// --- ランキング ---
function renderRanking(el, tags, key, label) {
  const counts = {};
  for (const t of tags) for (const v of (Array.isArray(t[key]) ? t[key] : [])) if (v) counts[v] = (counts[v] || 0) + 1;
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!sorted.length) { el.innerHTML = '<div style="color:#8a938c;font-size:12px;">データなし</div>'; return; }
  el.innerHTML = sorted.map(([name, n], i) =>
    `<div class="db-rank-item"><div class="db-rank-num">${i + 1}</div><div class="db-rank-name">${esc(name)}</div><div class="db-rank-count">${n}回</div></div>`
  ).join("");
}

// --- ステップ実施率 ---
function renderStepRate(el, tags) {
  const steps = ["導入・アイスブレイク", "市況・トレンド説明", "ヒアリング", "サービス説明", "デモ・仮想体験提案", "クロージング（スケジュール確認）"];
  const shortNames = ["導入", "市況説明", "ヒアリング", "サービス説明", "デモ提案", "クロージング"];
  const total = tags.length || 1;
  const stepCounts = {};
  for (const t of tags) for (const s of (Array.isArray(t.meeting_stages) ? t.meeting_stages : [])) if (s && s.step) stepCounts[s.step] = (stepCounts[s.step] || 0) + 1;
  el.innerHTML = steps.map((step, i) => {
    const n = stepCounts[step] || 0;
    const rate = Math.round(n / total * 100);
    return `<div class="db-bar-row">
      <div class="db-bar-label">${esc(shortNames[i])}</div>
      <div class="db-bar-track"><div class="db-bar-fill" style="width:${rate}%;background:${rate > 70 ? '#1d9e75' : rate > 40 ? '#BA7517' : '#D85A30'};">${rate}%</div></div>
      <div class="db-bar-val">${n}/${total}</div>
    </div>`;
  }).join("");
}

// --- ミニヒートマップ ---
function renderMiniHeatmap(el, tags) {
  const sizes = ["〜50人", "51〜200人", "201〜500人", "501〜1000人", "1001人以上"];
  const owners = [...new Set(tags.map((t) => t.owner).filter(Boolean))].sort();
  const grid = {};
  for (const t of tags) {
    if (!t.owner || !t.customer_employee_size) continue;
    const key = t.owner + "|||" + t.customer_employee_size;
    if (!grid[key]) grid[key] = { won: 0, total: 0 };
    grid[key].total++;
    if (t.customer_response_status === "担当者合意" || t.customer_response_status === "案件化") grid[key].won++;
  }
  let html = '<table class="db-table"><thead><tr><th></th>';
  for (const s of sizes) html += `<th style="font-size:10px;text-align:center;">${esc(s)}</th>`;
  html += '</tr></thead><tbody>';
  for (const owner of owners) {
    html += `<tr><td style="font-weight:500;">${esc(ownerName(owner))}</td>`;
    for (const s of sizes) {
      const cell = grid[owner + "|||" + s];
      if (!cell || !cell.total) { html += '<td style="text-align:center;color:#ccc;">—</td>'; continue; }
      const rate = Math.round(cell.won / cell.total * 100);
      const bg = rate > 50 ? '#1d9e75' : rate > 25 ? '#BA7517' : '#D85A30';
      html += `<td style="text-align:center;color:#fff;background:${bg};border-radius:4px;font-weight:600;font-size:11px;">${rate}%<div style="font-size:9px;opacity:0.8;">${cell.won}/${cell.total}</div></td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  el.innerHTML = html;
}

// ===== ウィジェット追加モーダル =====
function openCatalog() {
  const cat = $("widgetCatalog");
  cat.innerHTML = WIDGET_CATALOG.map((c) =>
    `<div class="db-catalog-item" data-type="${c.type}">
      <div class="db-catalog-icon">${c.icon}</div>
      <div class="db-catalog-name">${esc(c.name)}</div>
      <div class="db-catalog-desc">${esc(c.desc)}</div>
    </div>`
  ).join("");
  cat.querySelectorAll(".db-catalog-item").forEach((item) => {
    item.addEventListener("click", () => {
      const type = item.dataset.type;
      const id = "w" + Date.now();
      widgets.push({ id, type });
      saveLayout();
      $("addModal").hidden = true;
      renderGrid();
    });
  });
  $("addModal").hidden = false;
}
