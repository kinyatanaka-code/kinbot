// public/analysis.js
const $ = (id) => document.getElementById(id);
let all = [];

const PHASES = [
  { code: "01", label: "01 初回商談" },
  { code: "02", label: "02 有効商談" },
  { code: "03", label: "03 担当者合意" },
  { code: "04", label: "04 企画決定者合意" },
];
const phaseLabel = (c) => (PHASES.find((p) => p.code === c) || {}).label || "未設定";

const fmtDate = (s) => {
  try {
    return new Date(s).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return s || "";
  }
};
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function init() {
  try {
    all = await (await fetch("/api/meetings")).json();
    if (!Array.isArray(all)) all = [];
  } catch {
    all = [];
  }
  // 所有者（録画したアカウント）でプルダウンを構築
  const seen = new Map(); // owner -> label
  for (const m of all) {
    const owner = (m.owner || "").trim();
    if (!owner) continue;
    if (!seen.has(owner)) seen.set(owner, (m.owner_name || "").trim() || owner);
  }
  for (const [owner, label] of seen) {
    const o = document.createElement("option");
    o.value = owner;
    o.textContent = label;
    $("fRep").appendChild(o);
  }
  // フェーズ選択肢
  for (const p of PHASES) {
    const o = document.createElement("option");
    o.value = p.code;
    o.textContent = p.label;
    $("fPhase").appendChild(o);
  }
  render();
}

function applyFilter() {
  const owner = $("fRep").value.trim();
  const phase = $("fPhase").value.trim();
  const from = $("fFrom").value ? new Date($("fFrom").value + "T00:00:00") : null;
  const to = $("fTo").value ? new Date($("fTo").value + "T23:59:59") : null;
  return all.filter((m) => {
    if (owner && (m.owner || "").trim() !== owner) return false;
    if (phase && (m.phase || "") !== phase) return false;
    const d = new Date(m.created_at);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

function render() {
  const rows = applyFilter();
  renderAgg(rows);
  renderSetPanel(rows);
  renderList(rows);
}

function renderSetPanel(rows) {
  const el = $("tendency");
  if (!el) return;
  if (!rows.length) {
    el.innerHTML = "";
    return;
  }
  const ownerSel = $("fRep");
  const ownerLabel = ownerSel.value ? ownerSel.options[ownerSel.selectedIndex]?.textContent : "全員";
  const phaseLbl = $("fPhase").value ? phaseLabel($("fPhase").value) : "すべて";
  el.innerHTML = `<div class="tend-head"><span>絞り込んだ商談のまとめ分析（${escapeHtml(ownerLabel)} / ${escapeHtml(phaseLbl)} ・ ${rows.length}件）</span>
    <button class="btn" id="setBtn">この条件をまとめて分析</button></div>
    <div class="tend-body" id="setBody"><div class="empty-state">ボタンを押すと、絞り込んだ商談の内容を横断して、傾向・口癖・顧客反応と、スコアがその水準になっている理由をまとめます。</div></div>`;
  $("setBtn").addEventListener("click", async () => {
    const btn = $("setBtn");
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "分析中…";
    try {
      const r = await fetch("/api/analyze-set", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          owner: $("fRep").value.trim(),
          phase: $("fPhase").value.trim(),
          from: $("fFrom").value || "",
          to: $("fTo").value || "",
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "分析に失敗しました");
      renderSetResult(d);
    } catch (e) {
      $("setBody").innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  });
}

function setGroup(label, items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return `<div class="sgroup"><div class="label">${label}</div><ul>` +
    items.map((i) => `<li>${escapeHtml(i)}</li>`).join("") + `</ul></div>`;
}
function renderSetResult(d) {
  let html = `<p class="metric-note">対象 ${d.count || 0} 件${d.used && d.used < d.count ? `（うち直近${d.used}件を分析）` : ""}</p>`;
  if (d.overview) html += `<div class="sgroup"><div class="label">全体所感</div><p>${escapeHtml(d.overview)}</p></div>`;
  if (d.score_rationale) html += `<div class="sgroup"><div class="label">スコアの理由</div><p>${escapeHtml(d.score_rationale)}</p></div>`;
  html += setGroup("強み", d.strengths);
  html += setGroup("弱み・改善余地", d.weaknesses);
  html += setGroup("話し方の癖・口癖", d.habits);
  html += setGroup("顧客の反応の傾向", d.customer_tendencies);
  html += setGroup("改善アドバイス", d.advice);
  $("setBody").innerHTML = html || '<div class="empty-state">まとめられませんでした。</div>';
}

function avgScore(list, k) {
  const vals = list.map((m) => Number(m.analysis.scores[k]) || 0).filter((v) => v > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
}

function renderAgg(rows) {
  const analyzed = rows.filter((m) => m.analysis && m.analysis.scores);
  const dims = [["hearing", "ヒアリング"], ["proposal", "提案"], ["closing", "クロージング"], ["listening", "傾聴"]];
  let html = `<div class="agg-head">対象 <b>${rows.length}</b> 件（うち分析済み <b>${analyzed.length}</b> 件）</div>`;
  if (analyzed.length) {
    html += '<div class="agg-scores">';
    for (const [k, jp] of dims) {
      const avg = avgScore(analyzed, k);
      const pct = Math.round((avg / 5) * 100);
      html += `<div class="agg-row"><span class="agg-name">${jp}</span><span class="bar-track"><span class="bar-fill rep" style="width:${pct}%"></span></span><span class="agg-val">${avg.toFixed(1)}/5</span></div>`;
    }
    html += "</div>";

    // フェーズ別の平均スコア（振り返り用）
    const byPhase = PHASES
      .map((p) => ({ p, list: analyzed.filter((m) => (m.phase || "") === p.code) }))
      .filter((x) => x.list.length);
    if (byPhase.length) {
      html += '<div class="phase-breakdown"><div class="pb-title">フェーズ別 平均スコア</div><table class="pb-table"><tr><th>フェーズ</th><th>件数</th><th>ヒアリング</th><th>提案</th><th>クロージング</th><th>傾聴</th></tr>';
      for (const { p, list } of byPhase) {
        html += `<tr><td>${p.label}</td><td>${list.length}</td>` +
          dims.map(([k]) => `<td>${avgScore(list, k).toFixed(1)}</td>`).join("") +
          "</tr>";
      }
      html += "</table></div>";
    }
    html += '<p class="metric-note">※ 平均スコアは「分析を生成」済みの商談のみで計算します。営業担当・フェーズで絞り込むと、その条件での平均になります。</p>';
  } else {
    html += '<p class="metric-note">この条件で分析済みの商談がありません。各商談の詳細で「分析を生成」すると、ここに平均スコアが出ます。</p>';
  }
  $("agg").innerHTML = html;
}

function renderList(rows) {
  const el = $("alist");
  if (!rows.length) {
    el.innerHTML = '<li class="empty-state">該当する商談がありません。</li>';
    return;
  }
  el.innerHTML = "";
  for (const m of rows) {
    const li = document.createElement("li");
    li.className = "arow";
    const ok = m.analysis && m.analysis.scores;
    li.innerHTML = `<span class="a-title">${escapeHtml(m.title || "(商談名なし)")}</span>
      <span class="a-rep">${escapeHtml(m.owner_name || m.owner || m.rep_name || "")}</span>
      <span class="a-phase">${m.phase ? escapeHtml(phaseLabel(m.phase)) : ""}</span>
      <span class="a-date">${fmtDate(m.created_at)}</span>
      <span class="a-flag ${ok ? "ok" : ""}">${ok ? "分析済み" : "未分析"}</span>`;
    li.addEventListener("click", () => {
      location.href = `history.html?id=${encodeURIComponent(m.bot_id)}`;
    });
    el.appendChild(li);
  }
}

$("fApply").addEventListener("click", render);
$("fClear").addEventListener("click", () => {
  $("fRep").value = "";
  $("fPhase").value = "";
  $("fFrom").value = "";
  $("fTo").value = "";
  render();
});

init();
