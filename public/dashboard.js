// ===== ダッシュボードビルダー（Salesforce風・営業スタイル分析の全要素対応） =====
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const PIE_COLORS = ["#0d5b47","#1d9e75","#5DCAA5","#9FE1CB","#BA7517","#378ADD","#D85A30","#534AB7","#D4537E","#E1F5EE"];
let allTags = [], userMap = {};
const ownerName = (e) => userMap[String(e||"").toLowerCase()] || e || "不明";
const ARRAY_FIELDS = new Set(["appeal_points_used","talk_patterns","discovery_items_covered","key_pain_points","objections_raised","meeting_stages","target_job_type"]);

// ===== 定義 =====
const AXIS_OPTIONS = [
  { value:"owner", label:"担当者", group:"基本" },
  { value:"customer_employee_size", label:"従業員規模", group:"売り先" },
  { value:"customer_industry", label:"業界", group:"売り先" },
  { value:"customer_hq_region", label:"地域", group:"売り先" },
  { value:"hiring_type_need", label:"新卒/中途", group:"売り先" },
  { value:"target_hire_count", label:"採用人数", group:"売り先" },
  { value:"target_job_type", label:"職種", group:"売り先" },
  { value:"appeal_points_used", label:"訴求内容", group:"売り方" },
  { value:"talk_patterns", label:"話法の型", group:"売り方" },
  { value:"objection_handling_style", label:"懸念対応", group:"売り方" },
  { value:"discovery_items_covered", label:"ヒアリング深度", group:"売り方" },
  { value:"meeting_stages", label:"ステップ構成", group:"売り方" },
  { value:"key_pain_points", label:"顧客の課題", group:"商談状況" },
  { value:"customer_response_status", label:"顧客反応", group:"商談状況" },
  { value:"result", label:"受注結果", group:"商談状況" },
];
const METRIC_OPTIONS = [
  { value:"count", label:"件数" },
  { value:"pct", label:"構成比" },
  { value:"response_rate", label:"案件化率" },
  { value:"re_meeting_rate", label:"再商談実施率" },
  { value:"won_rate", label:"受注率" },
];
const CHART_TYPES = [
  { value:"kpi", label:"KPIカード", icon:"🔢" },
  { value:"bar", label:"棒グラフ", icon:"📊" },
  { value:"hbar", label:"ランキング", icon:"🏅" },
  { value:"pie", label:"円グラフ", icon:"🍩" },
  { value:"table", label:"テーブル", icon:"📋" },
  { value:"crosstab", label:"クロス集計", icon:"🗺" },
];

// ===== 状態 =====
let widgets = [];
const STORAGE_KEY = "kinbot_db_v3";
let wid = Date.now();
function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets)); } catch {} }
function load() {
  try { const s = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (Array.isArray(s) && s.length && s[0].chart) return s; } catch {}
  return [];
}

// ===== 初期化 =====
window.addEventListener("DOMContentLoaded", async () => {
  const now = new Date(), from = new Date(now); from.setDate(from.getDate() - 90);
  $("dbFrom").value = from.toISOString().slice(0, 10);
  $("dbTo").value = now.toISOString().slice(0, 10);
  $("dbFrom").addEventListener("change", reload);
  $("dbTo").addEventListener("change", reload);
  $("dbOwner").addEventListener("change", reload);
  $("addWidgetBtn").addEventListener("click", () => openCreator());
  $("closeModal").addEventListener("click", () => $("addModal").hidden = true);
  $("addModal").addEventListener("click", (e) => { if (e.target === $("addModal")) $("addModal").hidden = true; });
  try { const u = await (await fetch("/api/users")).json(); for (const x of u||[]) if (x.email) userMap[x.email.toLowerCase()] = x.name||x.email; } catch {}
  widgets = load();
  await reload();
});

async function reload() {
  const qs = new URLSearchParams();
  if ($("dbFrom").value) qs.set("from", $("dbFrom").value);
  if ($("dbTo").value) qs.set("to", $("dbTo").value);
  if ($("dbOwner").value) qs.set("owner", $("dbOwner").value);
  try { allTags = (await (await fetch("/api/feature-c/tags?" + qs)).json()).tags || []; } catch { allTags = []; }
  const sel = $("dbOwner"), cv = sel.value;
  const ow = [...new Set(allTags.map(t => t.owner).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">全員</option>' + ow.map(o => `<option value="${esc(o)}">${esc(ownerName(o))}</option>`).join("");
  sel.value = cv;
  renderGrid();
}

// ===== 集計 =====
function getAxisValues(t, axis) {
  if (ARRAY_FIELDS.has(axis)) {
    const arr = Array.isArray(t[axis]) ? t[axis] : [];
    if (axis === "meeting_stages") return arr.filter(s => s?.step).map(s => s.step);
    return arr.filter(Boolean);
  }
  let v = t[axis]; if (axis === "owner") v = ownerName(v);
  return [v || "不明"];
}
function aggregate(tags, axis, metric) {
  const g = {};
  for (const t of tags) {
    const keys = getAxisValues(t, axis);
    const hit = isHit(t, metric);
    for (const k of keys) {
      if (!g[k]) g[k] = { n: 0, h: 0 };
      g[k].n++; if (hit) g[k].h++;
    }
  }
  const entries = Object.entries(g);
  if (metric === "count") return entries.map(([k, v]) => ({ k, val: v.n })).sort((a, b) => b.val - a.val);
  if (metric === "pct") { const tot = tags.length || 1; return entries.map(([k, v]) => ({ k, val: Math.round(v.n / tot * 100), n: v.n, d: tot })).sort((a, b) => b.val - a.val); }
  return entries.map(([k, v]) => ({ k, val: v.n ? Math.round(v.h / v.n * 100) : 0, n: v.h, d: v.n })).sort((a, b) => b.val - a.val);
}
function isHit(t, m) {
  if (m === "response_rate") return t.customer_response_status === "担当者合意" || t.customer_response_status === "案件化";
  if (m === "won_rate") return t.result === "受注";
  if (m === "re_meeting_rate") return t.result === "受注" || t.customer_response_status === "担当者合意";
  return false;
}

// ===== グリッド描画 =====
function renderGrid() {
  const grid = $("dbGrid");
  if (!widgets.length) {
    grid.innerHTML = '<div class="db-grid-empty"><div style="font-size:40px;margin-bottom:12px;">📊</div>ウィジェットがありません<br>「＋ ウィジェットを追加」で作成できます</div>';
    return;
  }
  grid.innerHTML = "";
  widgets.forEach(w => {
    const el = document.createElement("div");
    el.className = "db-widget";
    el.dataset.id = w.id;
    el.draggable = true;
    el.innerHTML = `<div class="db-widget-head"><div class="db-widget-drag" title="ドラッグで移動">⠿</div><span class="db-widget-title">${esc(w.title)}</span><div class="db-widget-actions"><button class="db-widget-btn" data-a="edit" title="編集">✎</button><button class="db-widget-btn" data-a="del" title="削除">✕</button></div></div><div class="db-widget-body" id="wb_${w.id}"></div>`;
    el.querySelector('[data-a="del"]').onclick = () => { widgets = widgets.filter(x => x.id !== w.id); save(); renderGrid(); };
    el.querySelector('[data-a="edit"]').onclick = () => openCreator(w);
    el.addEventListener("dragstart", e => { e.dataTransfer.setData("text/plain", w.id); el.classList.add("dragging"); });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));
    el.addEventListener("dragover", e => { e.preventDefault(); el.classList.add("drag-over"); });
    el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
    el.addEventListener("drop", e => {
      e.preventDefault(); el.classList.remove("drag-over");
      const did = e.dataTransfer.getData("text/plain"); if (did === w.id) return;
      const fi = widgets.findIndex(x => x.id === did), ti = widgets.findIndex(x => x.id === w.id);
      if (fi < 0 || ti < 0) return;
      const [mv] = widgets.splice(fi, 1); widgets.splice(ti, 0, mv); save(); renderGrid();
    });
    grid.appendChild(el);
    drawWidget(w, $("wb_" + w.id));
  });
}

// ===== 描画 =====
function drawWidget(w, el) {
  if (!el) return;
  try {
    const fn = { kpi: drawKpi, bar: drawBar, hbar: drawHbar, pie: drawPie, table: drawTable, crosstab: drawCrosstab }[w.chart];
    if (fn) fn(el, allTags, w); else el.innerHTML = '<div class="db-empty">未対応</div>';
  } catch (e) { el.innerHTML = `<div class="db-empty">エラー: ${esc(e.message)}</div>`; }
}

function drawKpi(el, tags, w) {
  const t = tags.length;
  let val = "0", sub = "データなし";
  if (t) {
    if (w.metric === "count") { val = String(t); sub = "対象期間の全案件"; }
    else { const h = tags.filter(x => isHit(x, w.metric)).length; val = Math.round(h/t*100) + "%"; sub = `${h}/${t}件`; }
  }
  el.innerHTML = `<div class="db-kpi"><div class="db-kpi-value">${esc(val)}</div><div class="db-kpi-sub">${esc(sub)}</div></div>`;
}

function drawBar(el, tags, w) {
  const d = aggregate(tags, w.axis, w.metric).slice(0, 15);
  if (!d.length) { el.innerHTML = '<div class="db-empty">データなし</div>'; return; }
  const max = Math.max(...d.map(x => x.val)) || 1;
  const isR = w.metric !== "count";
  el.innerHTML = d.map(r => {
    const pct = Math.round(r.val / max * 100);
    const suf = isR ? "%" : "件";
    const det = r.d != null ? ` <span style="color:#8a938c;font-size:10px;">(${r.n}/${r.d})</span>` : "";
    return `<div class="db-bar-row"><div class="db-bar-label" title="${esc(r.k)}">${esc(r.k)}</div><div class="db-bar-track"><div class="db-bar-fill" style="width:${pct}%;background:#1d9e75;">${pct>12?r.val+suf:""}</div></div><div class="db-bar-val">${r.val}${suf}${det}</div></div>`;
  }).join("");
}

function drawHbar(el, tags, w) {
  const d = aggregate(tags, w.axis, "count").slice(0, 10);
  if (!d.length) { el.innerHTML = '<div class="db-empty">データなし</div>'; return; }
  const max = d[0].val || 1;
  el.innerHTML = d.map((r, i) => {
    const pct = Math.round(r.val / max * 100);
    return `<div class="db-bar-row"><div style="width:20px;text-align:center;font-weight:700;color:#0d5b47;font-size:13px;">${i+1}</div><div class="db-bar-label" title="${esc(r.k)}">${esc(r.k)}</div><div class="db-bar-track"><div class="db-bar-fill" style="width:${pct}%;background:#0d5b47;">${pct>15?r.val+"件":""}</div></div><div class="db-bar-val">${r.val}件</div></div>`;
  }).join("");
}

function drawPie(el, tags, w) {
  const d = aggregate(tags, w.axis, "count").slice(0, 8);
  if (!d.length) { el.innerHTML = '<div class="db-empty">データなし</div>'; return; }
  const tot = d.reduce((s, r) => s + r.val, 0) || 1;
  let cum = 0;
  const xy = (a, r) => [60 + r * Math.cos((a-90)*Math.PI/180), 60 + r * Math.sin((a-90)*Math.PI/180)];
  let svg = '<svg viewBox="0 0 120 120" class="db-pie-svg">';
  const segs = d.map((r, i) => { const p = r.val/tot, s = cum*360; cum += p; return { s, e: cum*360, c: PIE_COLORS[i%PIE_COLORS.length], k: r.k, n: r.val }; });
  segs.forEach(seg => {
    if (seg.e - seg.s >= 359.9) { svg += `<circle cx="60" cy="60" r="50" fill="${seg.c}"/>`; return; }
    const [x1,y1] = xy(seg.s,50), [x2,y2] = xy(seg.e,50), l = seg.e-seg.s>180?1:0;
    svg += `<path d="M60,60 L${x1},${y1} A50,50 0 ${l},1 ${x2},${y2} Z" fill="${seg.c}"/>`;
  });
  svg += '</svg>';
  const leg = segs.map(s => `<div class="db-pie-leg-item"><div class="db-pie-leg-dot" style="background:${s.c}"></div>${esc(s.k)} (${s.n})</div>`).join("");
  el.innerHTML = `<div class="db-pie-wrap">${svg}<div class="db-pie-legend">${leg}</div></div>`;
}

function drawTable(el, tags, w) {
  const d = aggregate(tags, w.axis, w.metric).slice(0, 20);
  if (!d.length) { el.innerHTML = '<div class="db-empty">データなし</div>'; return; }
  const al = AXIS_OPTIONS.find(a => a.value === w.axis)?.label || w.axis;
  const ml = METRIC_OPTIONS.find(m => m.value === w.metric)?.label || w.metric;
  const isR = w.metric !== "count";
  const suf = isR ? "%" : "件";
  let h = `<table class="db-table"><thead><tr><th>${esc(al)}</th><th style="text-align:right">${esc(ml)}</th>${d[0].d!=null?'<th style="text-align:right">内訳</th>':''}</tr></thead><tbody>`;
  d.forEach(r => { h += `<tr><td>${esc(r.k)}</td><td style="text-align:right;font-weight:600">${r.val}${suf}</td>${r.d!=null?`<td style="text-align:right;color:#8a938c">${r.n}/${r.d}</td>`:''}</tr>`; });
  h += '</tbody></table>';
  el.innerHTML = h;
}

function drawCrosstab(el, tags, w) {
  const ra = w.axis, ca = w.axis2 || "owner";
  const isR = w.metric !== "count" && w.metric !== "pct";
  const rSet = new Set(), cSet = new Set(), cells = {};
  tags.forEach(t => {
    const rk = getAxisValues(t, ra), ck = getAxisValues(t, ca), hit = isHit(t, w.metric);
    rk.forEach(r => { rSet.add(r); ck.forEach(c => { cSet.add(c);
      const k = r+"|||"+c; if (!cells[k]) cells[k]={n:0,h:0}; cells[k].n++; if(hit) cells[k].h++;
    }); });
  });
  const rows = [...rSet].sort(), cols = [...cSet].sort();
  if (!rows.length||!cols.length) { el.innerHTML = '<div class="db-empty">データなし</div>'; return; }
  let h = '<div style="overflow-x:auto"><table class="db-table"><thead><tr><th></th>';
  cols.forEach(c => h += `<th style="text-align:center;font-size:10.5px">${esc(c)}</th>`);
  h += '</tr></thead><tbody>';
  rows.forEach(r => {
    h += `<tr><td style="font-weight:500;white-space:nowrap">${esc(r)}</td>`;
    cols.forEach(c => {
      const cell = cells[r+"|||"+c];
      if (!cell||!cell.n) { h += '<td style="text-align:center;color:#ccc">—</td>'; return; }
      const val = isR ? Math.round(cell.h/cell.n*100) : cell.n;
      const rate = isR ? cell.h/cell.n : cell.n/(tags.length||1);
      const bg = rate>0.5?"#1d9e75":rate>0.25?"#BA7517":rate>0?"#D85A30":"#f2f0eb";
      const fc = rate>0?"#fff":"#ccc";
      h += `<td style="text-align:center;background:${bg};color:${fc};border-radius:4px;font-weight:600;font-size:11px;padding:6px 4px">${val}${isR?"%":""}<div style="font-size:9px;opacity:0.8">${cell.h}/${cell.n}</div></td>`;
    });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  el.innerHTML = h;
}

// ===== 作成/編集モーダル =====
function openCreator(edit) {
  const isEdit = !!edit;
  const d = edit || { chart:"bar", axis:"owner", axis2:"customer_employee_size", metric:"response_rate", title:"" };
  const modal = $("addModal"), body = $("widgetCatalog");
  const axisChips = (id, sel) => {
    let h = "", lg = "";
    AXIS_OPTIONS.forEach(a => {
      if (a.group !== lg) { if (lg) h += '<div style="width:100%;height:0"></div>'; h += `<span class="db-chip-group">${a.group}</span>`; lg = a.group; }
      h += `<button class="db-chip${a.value===sel?" active":""}" data-value="${a.value}">${a.label}</button>`;
    });
    return h;
  };
  body.innerHTML = `<div class="db-creator">
    <div class="db-creator-section"><label class="db-creator-label">タイトル</label><input type="text" id="wcTitle" class="db-creator-input" value="${esc(d.title)}" placeholder="（自動生成）"/></div>
    <div class="db-creator-section"><label class="db-creator-label">グラフの種類</label><div class="db-creator-chips" id="wcChart">${CHART_TYPES.map(c=>`<button class="db-chip${c.value===d.chart?" active":""}" data-value="${c.value}">${c.icon} ${c.label}</button>`).join("")}</div></div>
    <div class="db-creator-section" id="wcAxisSec"><label class="db-creator-label">集計軸</label><div class="db-creator-chips" id="wcAxis">${axisChips("a",d.axis)}</div></div>
    <div class="db-creator-section" id="wcAxis2Sec" style="display:none"><label class="db-creator-label">列軸（クロス集計の2つ目）</label><div class="db-creator-chips" id="wcAxis2">${axisChips("b",d.axis2)}</div></div>
    <div class="db-creator-section" id="wcMetricSec"><label class="db-creator-label">指標</label><div class="db-creator-chips" id="wcMetric">${METRIC_OPTIONS.map(m=>`<button class="db-chip${m.value===d.metric?" active":""}" data-value="${m.value}">${m.label}</button>`).join("")}</div></div>
    <div class="db-creator-preview"><label class="db-creator-label">プレビュー</label><div class="db-widget" style="cursor:default"><div class="db-widget-head"><span class="db-widget-title" id="wcPT">...</span></div><div class="db-widget-body" id="wcPB"></div></div></div>
    <div class="db-creator-actions"><button class="db-creator-cancel" id="wcCancel">キャンセル</button><button class="db-creator-save" id="wcSave">${isEdit?"更新":"追加"}</button></div>
  </div>`;
  let st = { chart:d.chart, axis:d.axis, axis2:d.axis2||"customer_employee_size", metric:d.metric };
  function upd() {
    const t = $("wcTitle").value || autoTitle(st);
    $("wcPT").textContent = t;
    $("wcAxisSec").style.display = st.chart==="kpi"?"none":"";
    $("wcAxis2Sec").style.display = st.chart==="crosstab"?"":"none";
    $("wcMetricSec").style.display = st.chart==="hbar"?"none":"";
    drawWidget({...st, title:t}, $("wcPB"));
  }
  function bind(id, key) {
    const c = $(id); if (!c) return;
    c.querySelectorAll(".db-chip").forEach(b => b.addEventListener("click", () => {
      c.querySelectorAll(".db-chip").forEach(x => x.classList.remove("active"));
      b.classList.add("active"); st[key] = b.dataset.value; upd();
    }));
  }
  bind("wcChart","chart"); bind("wcAxis","axis"); bind("wcAxis2","axis2"); bind("wcMetric","metric");
  $("wcTitle").addEventListener("input", upd);
  $("wcCancel").onclick = () => modal.hidden = true;
  $("wcSave").onclick = () => {
    const t = $("wcTitle").value || autoTitle(st);
    if (isEdit) { const w = widgets.find(x => x.id===edit.id); if(w){Object.assign(w,st);w.title=t;} }
    else widgets.push({ id:"w"+(++wid), ...st, title:t });
    save(); modal.hidden = true; renderGrid();
  };
  upd(); modal.hidden = false;
}

function autoTitle(s) {
  const al = AXIS_OPTIONS.find(a=>a.value===s.axis)?.label||s.axis;
  const ml = METRIC_OPTIONS.find(m=>m.value===s.metric)?.label||s.metric;
  if (s.chart==="kpi") return ml;
  if (s.chart==="hbar") return `${al} ランキング`;
  if (s.chart==="crosstab") { const cl = AXIS_OPTIONS.find(a=>a.value===s.axis2)?.label||s.axis2; return `${al} × ${cl} ${ml}`; }
  return `${al}別 ${ml}`;
}
