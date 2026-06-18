// public/analysis.js
const $ = (id) => document.getElementById(id);
let all = [];
let ownerLabels = {};

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
  // 営業担当者（開閉式ドロップダウン・複数選択）
  const ownerItems = [];
  for (const [owner, label] of seen) {
    ownerLabels[owner] = label;
    ownerItems.push({ value: owner, label });
  }
  initMultiDropdown($("fRepGroup"), "営業担当者", ownerItems, () => render(true));
  // フェーズ（開閉式ドロップダウン・複数選択）
  initMultiDropdown(
    $("fPhaseGroup"),
    "フェーズ",
    PHASES.map((p) => ({ value: p.code, label: p.label })),
    () => render(true)
  );
  render();
}

function selectedOwners() {
  return [...document.querySelectorAll("#fRepGroup input:checked")].map((c) => c.value);
}
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

function applyFilter() {
  const owners = selectedOwners();
  const phases = selectedPhases();
  const from = $("fFrom").value ? new Date($("fFrom").value + "T00:00:00") : null;
  const to = $("fTo").value ? new Date($("fTo").value + "T23:59:59") : null;
  return all.filter((m) => {
    if (owners.length && !owners.includes((m.owner || "").trim())) return false;
    if (phases.length && !phases.includes(m.phase || "")) return false;
    const d = new Date(m.created_at);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

function render(triggered) {
  const rows = applyFilter();
  renderAgg(rows);
  renderSetPanel(rows, !!triggered);
  renderList(rows);
}

let setReqSeq = 0;
function curFilter() {
  return {
    owners: selectedOwners(),
    phases: selectedPhases(),
    from: $("fFrom").value || "",
    to: $("fTo").value || "",
  };
}

function renderSetPanel(rows, triggered) {
  const el = $("tendency");
  if (!el) return;
  if (!rows.length) {
    el.innerHTML = "";
    return;
  }
  const ownersSel = selectedOwners();
  const ownerLabel = ownersSel.length ? ownersSel.map((o) => ownerLabels[o] || o).join("・") : "全員";
  const phs = selectedPhases();
  const phaseLbl = phs.length ? phs.map(phaseLabel).join("・") : "すべて";
  el.innerHTML = `<div class="tend-head"><span>絞り込んだ商談のまとめ分析（${escapeHtml(ownerLabel)} / ${escapeHtml(phaseLbl)} ・ ${rows.length}件）</span>
    <button class="btn" id="setBtn" hidden>再分析</button></div>
    <div class="tend-body" id="setBody"><div class="empty-state">読み込み中…</div></div>`;

  const seq = ++setReqSeq;
  const filter = curFilter();

  // まずキャッシュを確認（無料・LLMを呼ばない）
  fetchSet({ ...filter, cachedOnly: true })
    .then((d) => {
      if (seq !== setReqSeq) return; // 古い応答は無視
      if (d && d.overview !== undefined && d.cached) {
        renderSetResult(d, true);
        wireReanalyze(filter);
      } else if (triggered) {
        // 絞り込み操作なら自動生成（1回だけ・以後はキャッシュ）
        runGenerate(filter, seq);
      } else {
        // 初回表示はボタンだけ（勝手に課金しない）
        $("setBody").innerHTML = '<div class="empty-state">「この条件をまとめて分析」を押すと、傾向・口癖・顧客反応・スコアの理由をまとめます（結果は保存され、次回からは自動表示）。</div>';
        showSetButton("この条件をまとめて分析", () => runGenerate(filter, ++setReqSeq));
      }
    })
    .catch(() => {
      if (seq !== setReqSeq) return;
      $("setBody").innerHTML = '<div class="empty-state">読み込みに失敗しました。</div>';
    });
}

function showSetButton(label, onClick) {
  const btn = $("setBtn");
  if (!btn) return;
  btn.hidden = false;
  btn.textContent = label;
  btn.onclick = onClick;
}
function wireReanalyze(filter) {
  showSetButton("再分析", () => runGenerate(filter, ++setReqSeq, true));
}

async function runGenerate(filter, seq, force) {
  const btn = $("setBtn");
  if (btn) {
    btn.disabled = true;
    btn.hidden = false;
    btn.textContent = "分析中…";
  }
  $("setBody").innerHTML = '<div class="empty-state">分析中…（AIが商談内容を横断しています）</div>';
  try {
    const d = await fetchSet({ ...filter, force: !!force });
    if (seq !== setReqSeq) return;
    if (d.error) throw new Error(d.error);
    renderSetResult(d, d.cached);
    wireReanalyze(filter);
  } catch (e) {
    if (seq !== setReqSeq) return;
    $("setBody").innerHTML = `<div class="empty-state">${escapeHtml(e.message || "分析に失敗しました")}</div>`;
    showSetButton("もう一度試す", () => runGenerate(filter, ++setReqSeq, true));
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function fetchSet(body) {
  const r = await fetch("/api/analyze-set", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

function setGroup(label, items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return `<div class="sgroup"><div class="label">${label}</div><ul>` +
    items.map((i) => `<li>${escapeHtml(i)}</li>`).join("") + `</ul></div>`;
}
function renderSetResult(d, cached) {
  let html = `<p class="metric-note">対象 ${d.count || 0} 件${d.used && d.used < d.count ? `（うち直近${d.used}件を分析）` : ""}${cached ? "・保存済みの結果を表示" : "・たった今分析"}</p>`;
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

$("fApply").addEventListener("click", () => render(true));
$("fClear").addEventListener("click", () => {
  document.querySelectorAll("#fRepGroup input:checked, #fPhaseGroup input:checked").forEach((c) => (c.checked = false));
  $("fRepGroup")._mselUpdate && $("fRepGroup")._mselUpdate();
  $("fPhaseGroup")._mselUpdate && $("fPhaseGroup")._mselUpdate();
  $("fFrom").value = "";
  $("fTo").value = "";
  render(true);
});

init();
