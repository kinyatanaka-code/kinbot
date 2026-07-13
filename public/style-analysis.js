// Feature C 営業スタイル分析（フェーズ1）
// - ヒートマップ：メンバー × 選択軸 のクロス集計、受注率＋n数
// - 同条件比較：売り先条件でフィルタしたうえで、メンバーごとの受注率と売り方タグ分布
// n閾値：n<5 は「参考情報」扱い（薄色表示、自動示唆対象外。依頼書6章冒頭のn閾値ポリシー準拠）
// 権限：ユーザーの選択どおり全員が全メンバーの分析を見られる（フロント側での制限なし）

const N_THRESHOLD_LOW = 5;   // これ未満は「参考」扱いで薄く表示
const N_THRESHOLD_MID = 10;  // 5〜10は「注意」扱い

// ---- ユーティリティ ----
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---- 状態 ----
let allTags = [];    // /api/feature-c/tags のレスポンス
let owners = [];     // ユニークな担当者名
let filters = { employee_size: "", hire_count: "", hiring_type: "", region: "", industry: "" };
let userMap = {};    // email → 表示名のマップ

// メールアドレスを表示名に変換
const ownerName = (email) => userMap[String(email || "").toLowerCase()] || email || "不明";

// ---- 初期化 ----
window.addEventListener("DOMContentLoaded", async () => {
  // タブ切り替え
  document.querySelectorAll(".sa-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".sa-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".sa-tab-pane").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      const pane = document.getElementById("tab-" + tab.dataset.tab);
      if (pane) pane.classList.add("active");
    });
  });

  // 期間デフォルト：直近90日
  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 90);
  $("dateFrom").value = from.toISOString().slice(0, 10);
  $("dateTo").value = now.toISOString().slice(0, 10);

  // 期間・軸・指標の変更で自動更新
  $("dateFrom").addEventListener("change", loadAndRender);
  $("dateTo").addEventListener("change", loadAndRender);
  $("axisSelect").addEventListener("change", renderHeatmap);
  $("metricSelect").addEventListener("change", renderHeatmap);
  ["fltEmployeeSize", "fltHireCount", "fltHiringType", "fltRegion", "fltIndustry"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("change", () => {
      filters = {
        employee_size: $("fltEmployeeSize").value,
        hire_count: $("fltHireCount").value,
        hiring_type: $("fltHiringType").value,
        region: $("fltRegion").value,
        industry: $("fltIndustry") ? $("fltIndustry").value : "",
      };
      renderCompare();
    });
  });

  // バックフィル・パイロット検証は設定ページに移動済み
  // データ抽出タブのイベント
  const bfBtn = $("backfillBtn");
  if (bfBtn) bfBtn.addEventListener("click", runBackfill);
  const syncBtn = $("fcSyncBtn");
  if (syncBtn) syncBtn.addEventListener("click", runSyncStatus);
  const pilotSel = $("pilotDealSelect");
  if (pilotSel) pilotSel.addEventListener("change", showPilotDetail);

  await loadBackfillStatus();
  await loadProfileStatus();
  // ユーザー一覧を取得してメール→表示名マップを作る
  try {
    const users = await (await fetch("/api/users")).json();
    for (const u of users || []) {
      if (u.email) userMap[u.email.toLowerCase()] = u.name || u.email;
    }
  } catch {}
  await loadAndRender();
});

async function loadAndRender() {
  const status = $("saStatus");
  status.className = "sa-status";
  status.textContent = "読み込み中…";
  try {
    const from = $("dateFrom").value || "";
    const to = $("dateTo").value || "";
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const r = await fetch("/api/feature-c/tags?" + qs.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "取得に失敗しました");
    allTags = d.tags || [];
    // ownerを集計（メール→表示名に変換）、フィルタの選択肢も生成
    owners = [...new Set(allTags.map((t) => t.owner).filter(Boolean))].sort();
    // タグデータにowner_nameフィールドを追加（ヒートマップ等で使う）
    for (const t of allTags) t.owner_name = ownerName(t.owner);
    populateFilterOptions();
    status.textContent = `全 ${allTags.length}件の案件タグを取得（期間: ${from} 〜 ${to}）`;
    renderHeatmap();
    renderCompare();
    loadProfileStatus();
    // 傾向ハイライトをデータが十分あれば自動生成
    if (allTags.length >= 10) loadInsights();
  } catch (e) {
    status.className = "sa-status err";
    status.textContent = "失敗: " + e.message;
  }
}

// ---- ヒートマップ ----
function renderHeatmap() {
  const wrap = $("heatmap");
  const axis = $("axisSelect").value;
  const metric = $("metricSelect").value;
  if (!allTags.length) { wrap.innerHTML = '<div class="sa-empty">データがありません。期間を広げるか、バックフィルを実行してください。</div>'; return; }

  // 軸の値を集める
  const axisValues = extractAxisValues(allTags, axis);
  if (!axisValues.length) { wrap.innerHTML = '<div class="sa-empty">この軸で分類できる案件がありません。</div>'; return; }

  // owner × axisValue のクロス集計
  const grid = {}; // {owner: {axisVal: {won:n, total:n}}}
  const rowTotals = {}; // {owner: {won, total}}
  const colTotals = {}; // {axisVal: {won, total}}
  let grandWon = 0, grandTot = 0;

  for (const t of allTags) {
    if (!t.owner) continue;
    const vals = getValuesForAxis(t, axis);
    if (!vals.length) continue;
    const denomIncluded = includedInDenominator(t, metric);
    if (!denomIncluded) continue;
    const won = t.result === "受注" ? 1 : 0;
    // hiring_type_needの集計除外セーフティネット
    if (axis === "hiring_type_need" && t.tag_confidence === "low") continue;

    for (const v of vals) {
      if (!grid[t.owner]) grid[t.owner] = {};
      if (!grid[t.owner][v]) grid[t.owner][v] = { won: 0, total: 0 };
      grid[t.owner][v].won += won;
      grid[t.owner][v].total += 1;
      if (!colTotals[v]) colTotals[v] = { won: 0, total: 0 };
      colTotals[v].won += won;
      colTotals[v].total += 1;
    }
    if (!rowTotals[t.owner]) rowTotals[t.owner] = { won: 0, total: 0 };
    rowTotals[t.owner].won += won;
    rowTotals[t.owner].total += 1;
    grandWon += won;
    grandTot += 1;
  }

  // 列（軸区分）は出現順ではなく、依頼書の順序 or アルファベット順に並べたい
  const ordered = orderAxisValues(axis, axisValues);
  const ownerList = owners.filter((o) => rowTotals[o]);

  // HTML生成
  let html = '<table class="sa-heatmap">';
  html += '<thead><tr><th class="sa-h-owner">担当者</th>';
  for (const v of ordered) html += `<th>${esc(v)}</th>`;
  html += `<th>全体</th></tr></thead><tbody>`;
  for (const owner of ownerList) {
    html += `<tr><td class="sa-c-owner">${esc(ownerName(owner))}</td>`;
    for (const v of ordered) {
      const cell = (grid[owner] || {})[v];
      html += renderCell(cell, false, owner, v);
    }
    const rt = rowTotals[owner] || { won: 0, total: 0 };
    html += renderCell(rt, true, owner, "__total");
    html += `</tr>`;
  }
  // 列合計行
  html += `<tr><td class="sa-c-owner">全体</td>`;
  for (const v of ordered) html += renderCell(colTotals[v], true, "__total", v);
  html += renderCell({ won: grandWon, total: grandTot }, true, "__total", "__total");
  html += `</tr></tbody></table>`;
  html += `<div class="sa-cell-legend">
    <span><span class="lg" style="background:${rateToColor(0)}"></span>0%</span>
    <span><span class="lg" style="background:${rateToColor(0.25)}"></span>25%</span>
    <span><span class="lg" style="background:${rateToColor(0.5)}"></span>50%</span>
    <span><span class="lg" style="background:${rateToColor(1)}"></span>100%</span>
    <span style="margin-left:16px;">・薄い＝n&lt;5（参考）・やや薄い＝n5〜9（注意）・セルクリックで商談一覧</span>
  </div>`;
  wrap.innerHTML = html;

  // --- 参考事例ドリルダウン（依頼書7.1）---
  // ヒートマップのセルをクリック→該当する案件の talk_example, company_name, result を表示
  wrap.querySelectorAll("td.sa-cell[data-owner][data-val]").forEach((td) => {
    td.style.cursor = "pointer";
    td.addEventListener("click", () => {
      const owner = td.dataset.owner;
      const val = td.dataset.val;
      const axis = $("axisSelect").value;
      const matching = allTags.filter((t) => {
        if (owner !== "__total" && t.owner !== owner) return false;
        const vals = getValuesForAxis(t, axis);
        if (val !== "__total" && !vals.includes(val)) return false;
        return true;
      });
      showDrilldown(owner, val, axis, matching);
    });
  });
}

function renderCell(cell, isTotal, ownerKey, valKey) {
  if (!cell || !cell.total) return `<td class="sa-cell-empty">—</td>`;
  const rate = cell.won / cell.total;
  const lowN = cell.total < N_THRESHOLD_LOW;
  const midN = !lowN && cell.total < N_THRESHOLD_MID;
  const color = rateToColor(rate);
  const classes = ["sa-cell", lowN ? "sa-low-n" : "", midN ? "sa-mid-n" : ""].filter(Boolean).join(" ");
  const bg = isTotal ? "" : `style="background:${color};"`;
  const totalClass = isTotal ? " sa-cell-total" : "";
  const dataAttrs = ownerKey ? ` data-owner="${esc(ownerKey)}" data-val="${esc(valKey || "")}"` : "";
  // 背景の明るさに応じてテキスト色を切り替え（赤〜黄は白文字、明るい黄は黒文字）
  const textColor = rate < 0.35 ? "#fff" : (rate > 0.7 ? "#fff" : "#1b241f");
  return `<td class="${classes}${totalClass}" ${bg}${dataAttrs} style="${isTotal ? "" : `background:${color};color:${textColor};`}">
    <span class="sa-cell-rate">${(rate * 100).toFixed(0)}%</span>
    <span class="sa-cell-n">${cell.won}/${cell.total}</span>
  </td>`;
}

// 受注率の値を赤→黄→緑のグラデーションに変換（0%=赤、50%=黄、100%=濃緑）
// 「ここが弱い」が直感的に分かる配色
function rateToColor(rate) {
  const r = Math.max(0, Math.min(1, rate));
  let red, green, blue;
  if (r < 0.5) {
    // 0〜50%: 赤→黄（暖色で「弱い」を表現）
    const t = r / 0.5;
    red = 220; green = Math.round(100 + 120 * t); blue = Math.round(70 * (1 - t));
  } else {
    // 50〜100%: 黄→緑（寒色で「強い」を表現）
    const t = (r - 0.5) / 0.5;
    red = Math.round(220 - 207 * t); green = Math.round(220 - 129 * t); blue = Math.round(0 + 71 * t);
  }
  return `rgb(${red},${green},${blue})`;
}

// 軸の値の並び順（人が読みやすい順）
function orderAxisValues(axis, values) {
  const orders = {
    customer_employee_size: ["〜50人", "51〜200人", "201〜500人", "501〜1000人", "1001人以上", "不明"],
    target_hire_count: ["1〜2名", "3〜5名", "6〜10名", "11名以上", "未定"],
    hiring_type_need: ["新卒中心", "中途中心", "新卒・中途両方"],
    objection_handling_style: ["即座に切り返す型", "一旦受け止めてから返す型", "数値・データで返す型", "類似事例で返す型", "明確な回答をせず次に進める型", "該当する懸念なし"],
  };
  const ord = orders[axis];
  if (ord) return ord.filter((v) => values.includes(v));
  return values.slice().sort();
}

// 案件tagsから、指定軸の全ユニーク値を抜き出す
function extractAxisValues(tags, axis) {
  const set = new Set();
  for (const t of tags) for (const v of getValuesForAxis(t, axis)) set.add(v);
  return [...set];
}

// 1案件から、指定軸の値（配列項目は複数値、単一項目は1値）を取り出す
function getValuesForAxis(t, axis) {
  const v = t[axis];
  if (Array.isArray(v)) return v.filter(Boolean);
  if (v == null || v === "") return [];
  return [v];
}

// 受注率（訴求機会あり）は「即失注（result=失注 かつ 訴求前に決着）」を除外したいが、
// 現状のスキーマだけでは即失注を厳密に区別できないため、フェーズ1では単純化：
// - all（受注率全体）: 全件を分母に含める
// - pitch（訴求機会あり）: customer_response_statusが"失注"以外を分母にする（訴求が始まった案件のみ）
function includedInDenominator(t, metric) {
  if (metric === "all") return true;
  // pitch: 訴求機会があった＝顧客が明確に前向きまたは検討可能を示した／不明のケースまで含める。
  //        商談前にほぼ即決失注（"失注"にラベル済み）はここでは除外。
  return t.customer_response_status !== "失注";
}

// ---- 同条件比較 ----
function populateFilterOptions() {
  fillOptions("fltEmployeeSize", uniqValues(allTags, "customer_employee_size"));
  fillOptions("fltHireCount", uniqValues(allTags, "target_hire_count"));
  fillOptions("fltHiringType", uniqValues(allTags, "hiring_type_need"));
  fillOptions("fltRegion", uniqValues(allTags, "customer_hq_region"));
  const industryEl = $("fltIndustry");
  if (industryEl) fillOptions("fltIndustry", uniqValues(allTags, "customer_industry"));
  // プリセットボタンを生成（よくある比較パターン）
  buildPresets();
}

function fillOptions(id, values) {
  const sel = $(id);
  const current = sel.value;
  const first = sel.querySelector("option");
  sel.innerHTML = "";
  sel.appendChild(first);
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v; opt.textContent = v;
    sel.appendChild(opt);
  }
  if (values.includes(current)) sel.value = current;
}

function uniqValues(tags, key) {
  const s = new Set();
  for (const t of tags) if (t[key]) s.add(t[key]);
  return [...s].sort();
}

function renderCompare() {
  const wrap = $("compare");
  const any = filters.employee_size || filters.hire_count || filters.hiring_type || filters.region || filters.industry;
  if (!any) { wrap.innerHTML = '<div class="sa-empty">上のフィルタで条件を1つ以上選んでください。</div>'; return; }

  const filtered = allTags.filter((t) => {
    if (filters.employee_size && t.customer_employee_size !== filters.employee_size) return false;
    if (filters.hire_count && t.target_hire_count !== filters.hire_count) return false;
    if (filters.hiring_type && t.hiring_type_need !== filters.hiring_type) return false;
    if (filters.region && t.customer_hq_region !== filters.region) return false;
    if (filters.industry && t.customer_industry !== filters.industry) return false;
    return true;
  });

  if (!filtered.length) { wrap.innerHTML = '<div class="sa-empty">この条件に合致する案件がありません。</div>'; return; }

  // 担当者ごとに集計
  const byOwner = {};
  for (const t of filtered) {
    if (!t.owner) continue;
    if (!byOwner[t.owner]) byOwner[t.owner] = { total: 0, won: 0, tags: t.owner ? [] : [], talks: {}, appeals: {}, discovery: {}, objectionStyle: {} };
    byOwner[t.owner].total += 1;
    if (t.result === "受注") byOwner[t.owner].won += 1;
    for (const p of (t.talk_patterns || [])) byOwner[t.owner].talks[p] = (byOwner[t.owner].talks[p] || 0) + 1;
    for (const a of (t.appeal_points_used || [])) byOwner[t.owner].appeals[a] = (byOwner[t.owner].appeals[a] || 0) + 1;
    for (const d of (t.discovery_items_covered || [])) byOwner[t.owner].discovery[d] = (byOwner[t.owner].discovery[d] || 0) + 1;
    if (t.objection_handling_style) byOwner[t.owner].objectionStyle[t.objection_handling_style] = (byOwner[t.owner].objectionStyle[t.objection_handling_style] || 0) + 1;
  }

  const ownersList = Object.keys(byOwner).sort();
  const totalN = filtered.length;
  let html = `<div class="sa-empty" style="font-style:normal;color:#5f6b63;padding-bottom:12px;">この条件で <b>${totalN}件</b> の案件を比較中</div>`;
  html += '<div class="sa-compare-owners">';
  for (const owner of ownersList) {
    const d = byOwner[owner];
    const rate = d.total ? (d.won / d.total * 100).toFixed(0) : "—";
    const lowN = d.total < N_THRESHOLD_LOW;
    const nWarning = lowN ? `<span style="color:#a32d2d;">⚠ 件数が少なく統計的にブレます</span>` : "";
    html += `<div class="sa-owner-card">
      <h3>${esc(ownerName(owner))} <span class="sa-owner-rate">${rate}%</span></h3>
      <div class="sa-owner-n">受注 ${d.won}/${d.total}件 ${nWarning}</div>
      ${renderTagCounts("訴求内容", d.appeals)}
      ${renderTagCounts("話法の型", d.talks)}
      ${renderTagCounts("ヒアリング深度", d.discovery)}
      ${renderTagCounts("懸念対応", d.objectionStyle)}
    </div>`;
  }
  html += '</div>';
  wrap.innerHTML = html;
}

function renderTagCounts(title, obj) {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return `<h4>${esc(title)}</h4><div style="font-size:11px;color:#8a938c;">記録なし</div>`;
  const items = entries.map(([k, v]) => `<span class="sa-tag">${esc(k)}<span class="sa-tag-n">${v}</span></span>`).join("");
  return `<h4>${esc(title)}</h4><div class="sa-tag-list">${items}</div>`;
}

// ---- データ抽出タブ ----
let pollTimer = null;

async function loadBackfillStatus() {
  try {
    const r = await fetch("/api/feature-c/status");
    const d = await r.json();
    if (!r.ok) throw new Error();
    const el = $("backfillStatus");
    if (!el) return;
    const btn = $("backfillBtn");
    const bf = d.backfill || {};

    if (bf.running) {
      el.innerHTML = `<b>処理中… ${bf.processed}/${bf.total}件</b>（失敗 ${bf.failed}件）`;
      if (btn) { btn.disabled = true; btn.textContent = `処理中… ${bf.processed}/${bf.total}`; }
      startPolling();
    } else if (d.needing === 0) {
      el.innerHTML = `✓ すべての案件（${d.existing}件）にタグ付与済み`;
      if (btn) { btn.disabled = true; btn.textContent = "完了済み"; }
      stopPolling();
    } else {
      el.innerHTML = `<b>${d.needing}件</b>が未抽出（抽出済み: ${d.existing}件）`;
      if (btn) { btn.disabled = false; btn.textContent = "20件を抽出する"; }
      stopPolling();
    }
    populatePilotSelect();
  } catch { const el = $("backfillStatus"); if (el) el.textContent = "状態の取得に失敗"; }
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    await loadBackfillStatus();
    const r = await fetch("/api/feature-c/status").then((r) => r.json()).catch(() => null);
    if (r && r.backfill && !r.backfill.running) {
      stopPolling();
      await loadAndRender();
    }
  }, 3000);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

async function runBackfill() {
  const btn = $("backfillBtn");
  btn.disabled = true;
  btn.textContent = "開始中…";
  try {
    const r = await fetch("/api/feature-c/backfill", { method: "POST" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "失敗");
    if (d.already_running) {
      // 既に実行中ならポーリングだけ開始
    }
    startPolling();
    await loadBackfillStatus();
  } catch (e) {
    alert("失敗: " + e.message);
    btn.disabled = false;
    btn.textContent = "20件を抽出する";
  }
}

async function runSyncStatus() {
  const btn = $("fcSyncBtn");
  const result = $("syncStatusResult");
  btn.disabled = true; btn.textContent = "同期中…";
  try {
    const r = await fetch("/api/feature-c/sync-status", { method: "POST" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "失敗");
    const msg = d.updated > 0
      ? `${d.updated}件を同期しました`
      : "すべて最新です（同期の必要なし）";
    if (result) result.textContent = msg;
    alert(msg);
    await loadAndRender();
  } catch (e) { alert("失敗: " + e.message); }
  finally { btn.textContent = "ステータスを同期する"; btn.disabled = false; }
}

function populatePilotSelect() {
  const sel = $("pilotDealSelect");
  if (!sel) return;
  sel.innerHTML = '<option value="">案件を選んでください</option>';
  for (const t of allTags.slice(0, 200)) {
    const label = `${t.company_name || t.deal_id} (${ownerName(t.owner)}) ${t.result || ""}`;
    sel.insertAdjacentHTML("beforeend", `<option value="${esc(t.deal_id)}">${esc(label)}</option>`);
  }
}

function showPilotDetail() {
  const wrap = $("pilotResult");
  const dealId = $("pilotDealSelect")?.value;
  if (!dealId || !wrap) { if (wrap) wrap.innerHTML = ""; return; }
  const t = allTags.find((x) => x.deal_id === dealId);
  if (!t) { wrap.innerHTML = '<div class="sa-empty">見つかりません</div>'; return; }
  const row = (label, value, type) => {
    const badge = type === "obj" ? '<span style="color:#0d5b47;font-size:9px;">客観</span>' : '<span style="color:#8a5a1a;font-size:9px;">主観</span>';
    const v = Array.isArray(value) ? value.map((x) => typeof x === "object" ? JSON.stringify(x) : x).join(", ") : String(value ?? "—");
    return `<tr><td style="font-weight:600;color:#5f6b63;padding:6px 10px;white-space:nowrap;">${badge} ${esc(label)}</td><td style="padding:6px 10px;">${esc(v)}</td></tr>`;
  };
  wrap.innerHTML = `
    <div style="padding:14px;background:#f7faf8;border:1px solid #e6e8e5;border-radius:10px;max-width:700px;">
      <div style="font-size:14px;font-weight:700;color:#1b241f;margin-bottom:4px;">${esc(t.company_name || t.deal_id)}</div>
      <div style="font-size:11.5px;color:#8a938c;margin-bottom:10px;">${esc(ownerName(t.owner))} · ${String(t.first_meeting_date || "").slice(0, 10)} · ${esc(t.result)} · confidence: ${esc(t.tag_confidence)}</div>
      <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
        <thead><tr><th style="text-align:left;padding:6px 10px;border-bottom:1px solid #dfe4df;">項目</th><th style="text-align:left;padding:6px 10px;border-bottom:1px solid #dfe4df;">AI抽出結果</th></tr></thead>
        <tbody>
          ${row("従業員規模", t.customer_employee_size, "obj")}
          ${row("採用人数", t.target_hire_count, "obj")}
          ${row("新卒/中途ニーズ", t.hiring_type_need, "sub")}
          ${row("本社地域", t.customer_hq_region, "obj")}
          ${row("業界", t.customer_industry, "obj")}
          ${row("顧客反応", t.customer_response_status, "sub")}
          ${row("決裁者同席", t.decision_maker_present, "obj")}
          ${row("競合言及", t.competitor_mentioned, "obj")}
          ${row("課題・困りごと", t.key_pain_points, "sub")}
          ${row("訴求内容", t.appeal_points_used, "sub")}
          ${row("話法の型", t.talk_patterns, "sub")}
          ${row("象徴的話法", t.talk_example, "sub")}
          ${row("商談ステップ", t.meeting_stages, "sub")}
          ${row("ヒアリング到達", t.discovery_items_covered, "sub")}
          ${row("懸念対応", t.objection_handling_style, "sub")}
          ${row("顧客懸念", t.objections_raised, "sub")}
        </tbody>
      </table>
    </div>`;
}

// ============================================================
// フェーズ2: ステップ構成タイムライン & ヒアリング項目カバー率
// ============================================================

const CANONICAL_STEPS = ["導入・アイスブレイク", "市況・トレンド説明", "ヒアリング", "サービス説明", "デモ・仮想体験提案", "クロージング（スケジュール確認）"];
const DISCOVERY_ITEMS = ["現状把握", "課題認識", "危機感・影響確認", "意思決定プロセス確認"];
const EMPHASIS_COLOR = { "厚め": "#0d5b47", "普通": "#1d9e75", "簡潔": "#9fe1cb" };

// ステップ構成タイムライン（メンバーごとの実施率×厚み）
function renderStagesTimeline() {
  const wrap = $("heatmap");
  if (!allTags.length) { wrap.innerHTML = '<div class="sa-empty">データがありません。</div>'; return; }

  // 集計: owner → step → {count, emphasisCounts:{厚め,普通,簡潔}, dealTotal}
  const byOwner = {};
  const teamAgg = {};
  const ownerDeals = {};
  for (const t of allTags) {
    if (!t.owner) continue;
    ownerDeals[t.owner] = (ownerDeals[t.owner] || 0) + 1;
    const stages = Array.isArray(t.meeting_stages) ? t.meeting_stages : [];
    for (const s of stages) {
      if (!s || !s.step) continue;
      if (!byOwner[t.owner]) byOwner[t.owner] = {};
      if (!byOwner[t.owner][s.step]) byOwner[t.owner][s.step] = { count: 0, emph: { "厚め": 0, "普通": 0, "簡潔": 0 } };
      byOwner[t.owner][s.step].count++;
      if (s.emphasis) byOwner[t.owner][s.step].emph[s.emphasis] = (byOwner[t.owner][s.step].emph[s.emphasis] || 0) + 1;
      if (!teamAgg[s.step]) teamAgg[s.step] = { count: 0, emph: { "厚め": 0, "普通": 0, "簡潔": 0 } };
      teamAgg[s.step].count++;
      if (s.emphasis) teamAgg[s.step].emph[s.emphasis] = (teamAgg[s.step].emph[s.emphasis] || 0) + 1;
    }
  }
  const totalDeals = allTags.filter((t) => t.owner).length;
  const ownersList = Object.keys(ownerDeals).sort();

  // 1行分のタイムライン（各canonical stepを1マスずつ、実施率＋主要emphasisで表示）
  const rowHtml = (label, agg, dealCount, isTeam) => {
    let cells = "";
    for (const step of CANONICAL_STEPS) {
      const d = agg[step];
      if (!d || !d.count) {
        cells += `<div class="sa-tl-cell sa-tl-skip" title="${esc(step)}: 実施記録なし">—</div>`;
        continue;
      }
      const rate = dealCount ? Math.round(d.count / dealCount * 100) : 0;
      // 主要emphasis（最頻値）
      const em = Object.entries(d.emph).sort((a, b) => b[1] - a[1])[0][0];
      const color = EMPHASIS_COLOR[em] || "#1d9e75";
      cells += `<div class="sa-tl-cell" style="background:${color};" title="${esc(step)}: 実施率${rate}%・主に${esc(em)}">
        <span class="sa-tl-rate">${rate}%</span>
        <span class="sa-tl-emph">${esc(em)}</span>
      </div>`;
    }
    return `<div class="sa-tl-row ${isTeam ? "sa-tl-team" : ""}">
      <div class="sa-tl-owner">${esc(label)}<span class="sa-tl-n">${dealCount}件</span></div>
      <div class="sa-tl-cells">${cells}</div>
    </div>`;
  };

  let html = `<div class="sa-tl-header"><div class="sa-tl-owner"></div><div class="sa-tl-cells">` +
    CANONICAL_STEPS.map((s) => `<div class="sa-tl-head-cell">${esc(s.replace("（スケジュール確認）", ""))}</div>`).join("") +
    `</div></div>`;
  html += rowHtml("チーム全体", teamAgg, totalDeals, true);
  for (const owner of ownersList) {
    html += rowHtml(ownerName(owner), byOwner[owner] || {}, ownerDeals[owner], false);
  }
  html += `<div class="sa-cell-legend" style="margin-top:14px;">
    <span><span class="lg" style="background:${EMPHASIS_COLOR["厚め"]}"></span>厚め</span>
    <span><span class="lg" style="background:${EMPHASIS_COLOR["普通"]}"></span>普通</span>
    <span><span class="lg" style="background:${EMPHASIS_COLOR["簡潔"]}"></span>簡潔</span>
    <span style="margin-left:16px;">セル内の%＝そのステップの実施率、色＝最も多い厚み。「—」＝実施記録なし（スキップ）</span>
  </div>`;
  wrap.innerHTML = html;
}

// ヒアリング項目カバー率チャート（メンバー×4項目の到達率横棒）
function renderDiscoveryChart() {
  const wrap = $("heatmap");
  if (!allTags.length) { wrap.innerHTML = '<div class="sa-empty">データがありません。</div>'; return; }

  const byOwner = {};
  const ownerDeals = {};
  const teamHit = {};
  for (const t of allTags) {
    if (!t.owner) continue;
    ownerDeals[t.owner] = (ownerDeals[t.owner] || 0) + 1;
    const items = Array.isArray(t.discovery_items_covered) ? t.discovery_items_covered : [];
    for (const item of items) {
      if (!byOwner[t.owner]) byOwner[t.owner] = {};
      byOwner[t.owner][item] = (byOwner[t.owner][item] || 0) + 1;
      teamHit[item] = (teamHit[item] || 0) + 1;
    }
  }
  const totalDeals = allTags.filter((t) => t.owner).length;
  const ownersList = Object.keys(ownerDeals).sort();

  // チーム平均を計算（低到達項目のハイライトに使う）
  const teamRates = {};
  for (const item of DISCOVERY_ITEMS) teamRates[item] = totalDeals ? (teamHit[item] || 0) / totalDeals : 0;

  const rowHtml = (label, hits, dealCount, isTeam) => {
    let bars = "";
    for (const item of DISCOVERY_ITEMS) {
      const rate = dealCount ? ((hits[item] || 0) / dealCount) : 0;
      const pct = Math.round(rate * 100);
      // チーム平均より20pt以上低い項目を強調（依頼書7.1「到達率が低い項目を強調表示」）
      const isWeak = !isTeam && rate < teamRates[item] - 0.2 && dealCount >= N_THRESHOLD_LOW;
      bars += `<div class="sa-dc-item">
        <div class="sa-dc-label">${esc(item)}${isWeak ? ' <span class="sa-dc-weak">⚠低い</span>' : ""}</div>
        <div class="sa-dc-bar-bg"><div class="sa-dc-bar" style="width:${pct}%;${isWeak ? "background:#e24b4a;" : ""}"></div></div>
        <div class="sa-dc-pct">${pct}%</div>
      </div>`;
    }
    return `<div class="sa-dc-row ${isTeam ? "sa-dc-team" : ""}">
      <div class="sa-dc-owner">${esc(label)}<span class="sa-tl-n">${dealCount}件</span></div>
      <div class="sa-dc-bars">${bars}</div>
    </div>`;
  };

  let html = rowHtml("チーム全体", teamHit, totalDeals, true);
  for (const owner of ownersList) {
    html += rowHtml(ownerName(owner), byOwner[owner] || {}, ownerDeals[owner], false);
  }
  html += `<div class="sa-cell-legend" style="margin-top:14px;"><span>⚠低い＝チーム平均より20pt以上低い到達率（n≥5のメンバーのみ判定）</span></div>`;
  wrap.innerHTML = html;
}

// renderHeatmapをオーバーライドして、特殊軸ならビューを切り替える
const _origRenderHeatmap = renderHeatmap;
renderHeatmap = function () {
  const axis = $("axisSelect").value;
  if (axis === "meeting_stages") return renderStagesTimeline();
  if (axis === "discovery_items_covered") return renderDiscoveryChart();
  return _origRenderHeatmap();
};

// target_job_type は配列（JSONB）なのでgetValuesForAxisが対応済み（Array対応）だが、
// 業界/職種のconfidenceがlowのものを除外するオプションはフェーズ3では入れない（データ量優先）。

// ============================================================
// フェーズ3: 傾向ハイライト & エンリッチメント
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  const btn = $("insightsBtn");
  if (btn) btn.addEventListener("click", loadInsights);
  const trendBtn = $("trendBtn");
  if (trendBtn) trendBtn.addEventListener("click", renderTrend);
});

async function loadInsights() {
  const btn = $("insightsBtn");
  const note = $("insightsNote");
  const wrap = $("insights");
  btn.disabled = true;
  const orig = btn.textContent;
  btn.textContent = "生成中…（20〜40秒）";
  note.textContent = "";
  try {
    const from = $("dateFrom").value || "";
    const to = $("dateTo").value || "";
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const r = await fetch("/api/feature-c/insights?" + qs.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "生成に失敗しました");
    if (!d.insights || !d.insights.length) {
      wrap.innerHTML = `<div class="sa-empty">${esc(d.message || "示唆を生成できるだけのデータがまだありません")}</div>`;
      return;
    }
    const kindIcon = { "傾向": "📊", "アクション提案": "💡", "注意": "⚠️" };
    wrap.innerHTML = d.insights.map((i) =>
      `<div class="sa-insight sa-insight-${i.kind === "アクション提案" ? "action" : i.kind === "注意" ? "warn" : "trend"}">
        <span class="sa-insight-icon">${kindIcon[i.kind] || "📊"}</span>
        <span class="sa-insight-text">${esc(i.text)}</span>
      </div>`
    ).join("");
    note.textContent = d.cached ? "（10分以内の生成結果を再利用）" : "生成しました";
  } catch (e) {
    wrap.innerHTML = `<div class="sa-empty">失敗: ${esc(e.message)}</div>`;
  } finally {
    btn.textContent = orig;
    btn.disabled = false;
  }
}

// エンリッチメント・パイロット検証は設定ページに移動済み

// ============================================================
// フェーズ4: 施策後トレンド追跡
// ============================================================

function tagMatcher(tagSpec) {
  const [type, value] = String(tagSpec).split(":");
  if (type === "discovery") return (t) => (Array.isArray(t.discovery_items_covered) ? t.discovery_items_covered : []).includes(value);
  if (type === "appeal") return (t) => (Array.isArray(t.appeal_points_used) ? t.appeal_points_used : []).includes(value);
  if (type === "stage") return (t) => (Array.isArray(t.meeting_stages) ? t.meeting_stages : []).some((s) => s && s.step === value);
  return () => false;
}

function summarizeWindow(tags, matcher) {
  const total = tags.length;
  const withTag = tags.filter(matcher);
  const won = tags.filter((t) => t.result === "受注").length;
  const wonWithTag = withTag.filter((t) => t.result === "受注").length;
  return {
    total,
    won,
    winRate: total ? won / total : null,
    tagRate: total ? withTag.length / total : null,
    tagCount: withTag.length,
    tagWinRate: withTag.length ? wonWithTag / withTag.length : null,
  };
}

async function renderTrend() {
  const wrap = $("trend");
  const baseline = $("trendBaseline").value;
  const tagSpec = $("trendTag").value;
  if (!baseline || !tagSpec) {
    wrap.innerHTML = '<div class="sa-empty">基準日とタグの両方を選んでください。</div>';
    return;
  }
  wrap.innerHTML = '<div class="sa-loading">集計中…</div>';
  try {
    // 基準日の前後をそれぞれ取得。前=基準日の前日まで、後=基準日以降（当日の二重計上を防ぐ）
    const prevDay = new Date(baseline + "T00:00:00");
    prevDay.setDate(prevDay.getDate() - 1);
    const beforeEnd = prevDay.toISOString().slice(0, 10);
    const before = await (await fetch(`/api/feature-c/tags?to=${encodeURIComponent(beforeEnd)}`)).json();
    const after = await (await fetch(`/api/feature-c/tags?from=${encodeURIComponent(baseline)}`)).json();
    const matcher = tagMatcher(tagSpec);
    const b = summarizeWindow(before.tags || [], matcher);
    const a = summarizeWindow(after.tags || [], matcher);
    const tagLabel = $("trendTag").selectedOptions[0].textContent;

    const pct = (v) => v == null ? "—" : (v * 100).toFixed(0) + "%";
    const delta = (bv, av) => {
      if (bv == null || av == null) return "";
      const d = (av - bv) * 100;
      const sign = d > 0 ? "+" : "";
      const color = d > 0 ? "#0d5b47" : d < 0 ? "#a32d2d" : "#6b7770";
      return `<span style="color:${color};font-weight:700;">${sign}${d.toFixed(0)}pt</span>`;
    };
    const lowNWarn = (n) => n < N_THRESHOLD_LOW ? ` <span style="color:#a32d2d;font-size:10px;">⚠n少</span>` : "";

    wrap.innerHTML = `
      <div class="sa-trend-grid">
        <div class="sa-trend-card">
          <h3>基準日より前<span class="sa-tl-n">〜 ${esc(baseline)}</span></h3>
          <div class="sa-trend-metric"><span>案件数</span><b>${b.total}件</b></div>
          <div class="sa-trend-metric"><span>「${esc(tagLabel)}」実施率</span><b>${pct(b.tagRate)}${lowNWarn(b.total)}</b></div>
          <div class="sa-trend-metric"><span>全体受注率</span><b>${pct(b.winRate)}</b></div>
          <div class="sa-trend-metric"><span>タグ実施案件の受注率</span><b>${pct(b.tagWinRate)}${lowNWarn(b.tagCount)}</b></div>
        </div>
        <div class="sa-trend-arrow">→</div>
        <div class="sa-trend-card sa-trend-after">
          <h3>基準日以降<span class="sa-tl-n">${esc(baseline)} 〜</span></h3>
          <div class="sa-trend-metric"><span>案件数</span><b>${a.total}件</b></div>
          <div class="sa-trend-metric"><span>「${esc(tagLabel)}」実施率</span><b>${pct(a.tagRate)} ${delta(b.tagRate, a.tagRate)}${lowNWarn(a.total)}</b></div>
          <div class="sa-trend-metric"><span>全体受注率</span><b>${pct(a.winRate)} ${delta(b.winRate, a.winRate)}</b></div>
          <div class="sa-trend-metric"><span>タグ実施案件の受注率</span><b>${pct(a.tagWinRate)} ${delta(b.tagWinRate, a.tagWinRate)}${lowNWarn(a.tagCount)}</b></div>
        </div>
      </div>
      <div class="sa-hint" style="margin-top:12px;">💡 「実施率が上がった」＋「受注率も上がった」なら施策が機能している示唆になります。ただし件数が少ない期間は偶然のブレが大きいため、n表示を必ず確認してください。受注は商談から時間差で確定するため、基準日直後は受注率が低く見えることがあります。</div>
    `;
  } catch (e) {
    wrap.innerHTML = `<div class="sa-empty">失敗: ${esc(e.message)}</div>`;
  }
}

// ============================================================
// 未実装項目1: 参考事例ドリルダウン（依頼書7.1）
// ============================================================
function showDrilldown(owner, val, axis, matching) {
  // 既存モーダルがあれば消す
  let modal = document.querySelector(".sa-drilldown-overlay");
  if (modal) modal.remove();

  const label = owner === "__total" ? "全体" : ownerName(owner);
  const valLabel = val === "__total" ? "全体" : val;
  const won = matching.filter((t) => t.result === "受注");
  const lost = matching.filter((t) => t.result !== "受注");

  const cardHtml = (t) => {
    const resultBadge = t.result === "受注"
      ? '<span class="sa-dd-badge sa-dd-won">受注</span>'
      : `<span class="sa-dd-badge sa-dd-other">${esc(t.result || "進行中")}</span>`;
    const appeals = (t.appeal_points_used || []).map((a) => `<span class="sa-tag">${esc(a)}</span>`).join("");
    const talks = (t.talk_patterns || []).map((a) => `<span class="sa-tag">${esc(a)}</span>`).join("");
    const example = t.talk_example ? `<div class="sa-dd-example">💬 ${esc(t.talk_example)}</div>` : "";
    const date = t.first_meeting_date ? String(t.first_meeting_date).slice(0, 10) : "";
    return `<div class="sa-dd-card">
      <div class="sa-dd-card-head">
        <span class="sa-dd-company">${esc(t.company_name || t.deal_id)}</span>
        ${resultBadge}
        <span class="sa-dd-date">${esc(date)}</span>
      </div>
      ${example}
      ${appeals ? `<div class="sa-dd-tags"><span class="sa-dd-tags-label">訴求:</span>${appeals}</div>` : ""}
      ${talks ? `<div class="sa-dd-tags"><span class="sa-dd-tags-label">話法:</span>${talks}</div>` : ""}
    </div>`;
  };

  modal = document.createElement("div");
  modal.className = "sa-drilldown-overlay";
  modal.innerHTML = `<div class="sa-drilldown-modal">
    <div class="sa-dd-header">
      <h3>${esc(label)} × ${esc(valLabel)} の商談一覧（${matching.length}件）</h3>
      <button class="sa-dd-close" id="ddClose">✕</button>
    </div>
    <div class="sa-dd-body">
      ${won.length ? `<h4>受注（${won.length}件）</h4>${won.map(cardHtml).join("")}` : ""}
      ${lost.length ? `<h4>${won.length ? "その他" : "全件"}（${lost.length}件）</h4>${lost.map(cardHtml).join("")}` : ""}
      ${!matching.length ? '<div class="sa-empty">該当する商談がありません</div>' : ""}
    </div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector("#ddClose").addEventListener("click", () => modal.remove());
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
}

// ============================================================
// 未実装項目2: 売り先×売り方 2軸掛け合わせ集計（依頼書6.1）
// ============================================================
// HTMLに2軸セクションを動的追加
document.addEventListener("DOMContentLoaded", () => {
  const compareSection = document.querySelector("#compare")?.closest(".sa-section");
  if (!compareSection) return;

  const crossSection = document.createElement("section");
  crossSection.className = "sa-section";
  crossSection.innerHTML = `
    <h2>2軸掛け合わせ集計</h2>
    <p class="sa-hint">売り先軸と売り方軸を同時に指定し、組み合わせごとの受注率を見ます。件数が少なくなりやすいので、n数に注意してください。</p>
    <div class="sa-filter-row">
      <div class="sa-filter">
        <label>行軸（売り先）</label>
        <select id="crossRowAxis">
          <option value="customer_employee_size">従業員規模</option>
          <option value="target_hire_count">採用人数</option>
          <option value="hiring_type_need">新卒/中途</option>
        </select>
      </div>
      <div class="sa-filter">
        <label>列軸（売り方）</label>
        <select id="crossColAxis">
          <option value="appeal_points_used">訴求内容</option>
          <option value="talk_patterns">話法の型</option>
          <option value="objection_handling_style">懸念対応</option>
        </select>
      </div>
      <button class="btn" id="crossBtn">集計する</button>
    </div>
    <div id="crossResult" class="sa-heatmap-wrap"></div>
  `;
  compareSection.parentNode.insertBefore(crossSection, compareSection);

  $("crossBtn").addEventListener("click", renderCrossAxis);
});

function renderCrossAxis() {
  const wrap = $("crossResult");
  const rowAxis = $("crossRowAxis").value;
  const colAxis = $("crossColAxis").value;
  if (!allTags.length) { wrap.innerHTML = '<div class="sa-empty">データがありません</div>'; return; }

  const rowVals = orderAxisValues(rowAxis, extractAxisValues(allTags, rowAxis));
  const colVals = orderAxisValues(colAxis, extractAxisValues(allTags, colAxis));
  if (!rowVals.length || !colVals.length) { wrap.innerHTML = '<div class="sa-empty">データがありません</div>'; return; }

  const grid = {};
  for (const t of allTags) {
    const rows = getValuesForAxis(t, rowAxis);
    const cols = getValuesForAxis(t, colAxis);
    const won = t.result === "受注" ? 1 : 0;
    for (const r of rows) for (const c of cols) {
      const key = `${r}|||${c}`;
      if (!grid[key]) grid[key] = { won: 0, total: 0 };
      grid[key].won += won;
      grid[key].total++;
    }
  }

  let html = '<table class="sa-heatmap"><thead><tr><th></th>';
  for (const c of colVals) html += `<th>${esc(c)}</th>`;
  html += '</tr></thead><tbody>';
  for (const r of rowVals) {
    html += `<tr><td class="sa-c-owner">${esc(r)}</td>`;
    for (const c of colVals) {
      const cell = grid[`${r}|||${c}`];
      html += renderCell(cell, false);
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  html += '<div class="sa-cell-legend" style="margin-top:8px;">💡 件数が少ない組み合わせが多くなります。n≥5以上のセルだけを参考にしてください。</div>';
  wrap.innerHTML = html;
}

// ============================================================
// 未実装項目7: ステップemphasis別受注率クロス集計（依頼書6.1）
// ============================================================
// タイムラインビュー内に「emphasis別受注率」テーブルを追加
const _savedRenderTimeline = renderStagesTimeline;
renderStagesTimeline = function () {
  _savedRenderTimeline();
  const wrap = $("heatmap");
  // emphasis × step の受注率クロス集計を追記
  const emphGrid = {};
  for (const t of allTags) {
    const stages = Array.isArray(t.meeting_stages) ? t.meeting_stages : [];
    const won = t.result === "受注" ? 1 : 0;
    for (const s of stages) {
      if (!s || !s.step || !s.emphasis) continue;
      const key = `${s.step}|||${s.emphasis}`;
      if (!emphGrid[key]) emphGrid[key] = { won: 0, total: 0 };
      emphGrid[key].won += won;
      emphGrid[key].total++;
    }
  }
  const emphases = ["厚め", "普通", "簡潔"];
  let html = '<div style="margin-top:20px;"><h4 style="font-size:13px;font-weight:600;color:#0d5b47;margin-bottom:8px;">ステップ × 厚み別 受注率</h4>';
  html += '<table class="sa-heatmap"><thead><tr><th>ステップ</th>';
  for (const e of emphases) html += `<th>${esc(e)}</th>`;
  html += '</tr></thead><tbody>';
  for (const step of CANONICAL_STEPS) {
    html += `<tr><td class="sa-c-owner" style="font-size:11px;">${esc(step.replace("（スケジュール確認）", ""))}</td>`;
    for (const e of emphases) {
      const cell = emphGrid[`${step}|||${e}`];
      html += renderCell(cell, false);
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  html += '<div class="sa-cell-legend" style="margin-top:6px;">「ヒアリングを厚めにした商談は受注率が高い」等の傾向を読み取れます</div></div>';
  wrap.insertAdjacentHTML("beforeend", html);
};



// ============================================================
// 改善2: 同条件比較プリセット
// ============================================================
function buildPresets() {
  const wrap = $("comparePresets");
  if (!wrap) return;
  // データから上位3パターンを自動生成
  const sizeCounts = {};
  const typeCounts = {};
  for (const t of allTags) {
    if (t.customer_employee_size && t.customer_employee_size !== "不明") {
      sizeCounts[t.customer_employee_size] = (sizeCounts[t.customer_employee_size] || 0) + 1;
    }
    if (t.hiring_type_need) {
      typeCounts[t.hiring_type_need] = (typeCounts[t.hiring_type_need] || 0) + 1;
    }
  }
  const topSizes = Object.entries(sizeCounts).sort((a, b) => b[1] - a[1]).slice(0, 2);
  const topTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).slice(0, 1);

  const presets = [];
  for (const [size, n] of topSizes) {
    if (n >= 5) presets.push({ label: `${size}（${n}件）`, filters: { employee_size: size } });
  }
  for (const [type, n] of topTypes) {
    if (n >= 5) presets.push({ label: `${type}（${n}件）`, filters: { hiring_type: type } });
  }

  if (!presets.length) { wrap.innerHTML = ""; return; }
  wrap.innerHTML = '<span class="sa-preset-label">よく使う条件:</span>' +
    presets.map((p) =>
      `<button class="sa-preset-btn" data-preset='${JSON.stringify(p.filters)}'>${esc(p.label)}</button>`
    ).join("");

  wrap.querySelectorAll(".sa-preset-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const f = JSON.parse(btn.dataset.preset);
      $("fltEmployeeSize").value = f.employee_size || "";
      $("fltHireCount").value = f.hire_count || "";
      $("fltHiringType").value = f.hiring_type || "";
      $("fltRegion").value = f.region || "";
      if ($("fltIndustry")) $("fltIndustry").value = f.industry || "";
      filters = {
        employee_size: f.employee_size || "",
        hire_count: f.hire_count || "",
        hiring_type: f.hiring_type || "",
        region: f.region || "",
        industry: f.industry || "",
      };
      renderCompare();
    });
  });
}

// ============================================================
// 会社プロフィール未取得の一覧表示
// ============================================================
async function loadProfileStatus() {
  const el = $("profileStatus");
  const list = $("profileList");
  if (!el) return;
  try {
    const missing = allTags.filter((t) => !t.customer_industry);
    const total = allTags.length;
    if (total === 0) {
      el.innerHTML = "タグ抽出後に確認できます";
      if (list) list.innerHTML = "";
    } else if (missing.length === 0) {
      el.innerHTML = `✓ 全${total}件の業界情報を取得済み`;
      if (list) list.innerHTML = "";
    } else {
      el.innerHTML = `<b>${missing.length}件</b>/${total}件が業界未取得。案件を開いて「gBizINFOで会社を検索」を押してください。`;
      if (list) {
        // 重複する会社名を除去してリスト化
        const seen = new Set();
        const unique = [];
        for (const t of missing) {
          const name = t.company_name || t.deal_id;
          if (seen.has(name)) continue;
          seen.add(name);
          unique.push({ name, owner: t.owner || "" });
        }
        list.innerHTML = unique.map((u) =>
          `<a href="deals.html?company=${encodeURIComponent(u.name)}" class="sa-profile-item">
            <span class="sa-profile-name">${esc(u.name)}</span>
            <span class="sa-profile-owner">${esc(u.owner)}</span>
          </a>`
        ).join("");
      }
    }
  } catch { el.textContent = ""; }
}
