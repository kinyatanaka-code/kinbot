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
let filters = { employee_size: "", hire_count: "", hiring_type: "", region: "" };

// ---- 初期化 ----
window.addEventListener("DOMContentLoaded", async () => {
  // 期間デフォルト：直近90日
  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 90);
  $("dateFrom").value = from.toISOString().slice(0, 10);
  $("dateTo").value = now.toISOString().slice(0, 10);

  $("reloadBtn").addEventListener("click", loadAndRender);
  $("axisSelect").addEventListener("change", renderHeatmap);
  $("metricSelect").addEventListener("change", renderHeatmap);
  ["fltEmployeeSize", "fltHireCount", "fltHiringType", "fltRegion"].forEach((id) => {
    $(id).addEventListener("change", () => {
      filters = {
        employee_size: $("fltEmployeeSize").value,
        hire_count: $("fltHireCount").value,
        hiring_type: $("fltHiringType").value,
        region: $("fltRegion").value,
      };
      renderCompare();
    });
  });

  $("backfillBtn").addEventListener("click", runBackfill);
  await loadBackfillStatus();
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
    // ownerを集計、フィルタの選択肢も生成
    owners = [...new Set(allTags.map((t) => t.owner).filter(Boolean))].sort();
    populateFilterOptions();
    status.textContent = `全 ${allTags.length}件の案件タグを取得（期間: ${from} 〜 ${to}）`;
    renderHeatmap();
    renderCompare();
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
    html += `<tr><td class="sa-c-owner">${esc(owner)}</td>`;
    for (const v of ordered) {
      const cell = (grid[owner] || {})[v];
      html += renderCell(cell);
    }
    // 全体
    const rt = rowTotals[owner] || { won: 0, total: 0 };
    html += renderCell(rt, true);
    html += `</tr>`;
  }
  // 列合計行
  html += `<tr><td class="sa-c-owner">全体</td>`;
  for (const v of ordered) html += renderCell(colTotals[v], true);
  html += renderCell({ won: grandWon, total: grandTot }, true);
  html += `</tr></tbody></table>`;
  html += `<div class="sa-cell-legend">
    <span><span class="lg" style="background:${rateToColor(0)}"></span>0%</span>
    <span><span class="lg" style="background:${rateToColor(0.25)}"></span>25%</span>
    <span><span class="lg" style="background:${rateToColor(0.5)}"></span>50%</span>
    <span><span class="lg" style="background:${rateToColor(0.75)}"></span>75%</span>
    <span><span class="lg" style="background:${rateToColor(1)}"></span>100%</span>
    <span style="margin-left:20px;">・薄い＝n&lt;5（参考）</span>
  </div>`;
  wrap.innerHTML = html;
}

function renderCell(cell, isTotal) {
  if (!cell || !cell.total) return `<td class="sa-cell-empty">—</td>`;
  const rate = cell.won / cell.total;
  const lowN = cell.total < N_THRESHOLD_LOW;
  const color = rateToColor(rate);
  const classes = ["sa-cell", lowN ? "sa-low-n" : ""].filter(Boolean).join(" ");
  const bg = isTotal ? "" : `style="background:${color};"`;
  const totalClass = isTotal ? " sa-cell-total" : "";
  return `<td class="${classes}${totalClass}" ${bg}>
    <span class="sa-cell-rate">${(rate * 100).toFixed(0)}%</span>
    <span class="sa-cell-n">${cell.won}/${cell.total}</span>
  </td>`;
}

// 受注率の値を kinbot緑のグラデーションに変換（0=白っぽい→100%=濃い緑）
function rateToColor(rate) {
  const r = Math.max(0, Math.min(1, rate));
  // 淡いグレー → kinbot緑（#0d5b47）
  const start = [200, 208, 202];
  const end = [13, 91, 71];
  const c = start.map((s, i) => Math.round(s + (end[i] - s) * r));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
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
  const any = filters.employee_size || filters.hire_count || filters.hiring_type || filters.region;
  if (!any) { wrap.innerHTML = '<div class="sa-empty">上のフィルタで条件を1つ以上選んでください。</div>'; return; }

  const filtered = allTags.filter((t) => {
    if (filters.employee_size && t.customer_employee_size !== filters.employee_size) return false;
    if (filters.hire_count && t.target_hire_count !== filters.hire_count) return false;
    if (filters.hiring_type && t.hiring_type_need !== filters.hiring_type) return false;
    if (filters.region && t.customer_hq_region !== filters.region) return false;
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
      <h3>${esc(owner)} <span class="sa-owner-rate">${rate}%</span></h3>
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

// ---- バックフィル ----
async function loadBackfillStatus() {
  try {
    const r = await fetch("/api/feature-c/status");
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "取得失敗");
    const el = $("backfillStatus");
    if (d.needing === 0) {
      el.innerHTML = `✓ すべての案件（${d.existing}件）にタグが付いています。`;
      $("backfillBtn").disabled = true;
    } else {
      el.innerHTML = `<b>${d.needing}件</b>の案件がまだタグ抽出されていません（抽出済み: ${d.existing}件）`;
    }
  } catch (e) {
    $("backfillStatus").textContent = "状態の取得に失敗しました";
  }
}

async function runBackfill() {
  const btn = $("backfillBtn");
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "処理中…（1〜2分かかります）";
  try {
    const r = await fetch("/api/feature-c/backfill", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 20 }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "実行に失敗しました");
    alert(`完了：${d.processed}件を抽出（失敗 ${d.failed}件）\n残り: ${d.remaining}件`);
    await loadBackfillStatus();
    await loadAndRender();
  } catch (e) {
    alert("失敗: " + e.message);
  } finally {
    btn.textContent = orig;
    btn.disabled = false;
  }
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
    html += rowHtml(owner, byOwner[owner] || {}, ownerDeals[owner], false);
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
    html += rowHtml(owner, byOwner[owner] || {}, ownerDeals[owner], false);
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
  const enrichBtn = $("enrichBtn");
  if (enrichBtn) enrichBtn.addEventListener("click", runEnrich);
  loadEnrichStatus();
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

async function loadEnrichStatus() {
  const el = $("enrichStatus");
  if (!el) return;
  try {
    const r = await fetch("/api/feature-c/enrich-status");
    const d = await r.json();
    if (!r.ok) throw new Error();
    if (d.needing === 0) {
      el.innerHTML = `✓ すべての企業（${d.enriched}社）の業界・職種を取得済み`;
      const b = $("enrichBtn");
      if (b) b.disabled = true;
    } else {
      el.innerHTML = `業界・職種：<b>${d.needing}社</b>が未取得（取得済み: ${d.enriched}社）`;
    }
  } catch { el.textContent = "企業属性の状態取得に失敗"; }
}

async function runEnrich() {
  const btn = $("enrichBtn");
  const orig = btn.textContent;
  btn.disabled = true;
  btn.textContent = "取得中…（1社10〜20秒）";
  try {
    const r = await fetch("/api/feature-c/enrich", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 10 }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "実行に失敗しました");
    alert(`完了：${d.processed}社を取得（失敗 ${d.failed}社）\n残り: ${d.remaining}社`);
    await loadEnrichStatus();
    await loadAndRender();
  } catch (e) {
    alert("失敗: " + e.message);
  } finally {
    btn.textContent = orig;
    btn.disabled = false;
  }
}

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
