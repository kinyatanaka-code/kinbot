// public/analysis.js
const $ = (id) => document.getElementById(id);
let all = [];
let ownerLabels = {};
let greetName = "";
let dealStatusMap = {};
function companyFromTitleA(title) {
  let t = String(title || "").trim();
  if (!t) return "(無題)";
  t = t.replace(/^[\s　・※•◆◇■□▶▷*\-–—✉⊠]+/u, "");
  t = t.replace(/[【\[［][^】\]］]*[】\]］]/gu, " ");
  t = t.replace(/[\s　/／|｜:：][^\s　/／|｜]{0,16}様(?:\s*[・,、][^\s　/／|｜]{0,16}様)*\s*$/u, "");
  t = t.replace(/[^\s　/／|｜]{0,16}様\s*$/u, "");
  t = t.replace(/\s+/g, " ").trim();
  return t || String(title || "(無題)").trim();
}
const acctOfA = (m) => (m.account && m.account.trim()) || companyFromTitleA(m.title) || "(無題)";

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
  // 挨拶用の名前＋案件ステータス（いま追うべき案件用）
  try {
    const me = await (await fetch("/api/me")).json();
    let nm = me && me.username ? me.username : "";
    try {
      const users = await (await fetch("/api/users")).json();
      const u = (users || []).find((x) => x.email === me.username);
      if (u && u.name) nm = u.name;
    } catch {}
    if (nm && nm.includes("@")) nm = nm.split("@")[0];
    greetName = nm || "";
  } catch {}
  try {
    const ds = await (await fetch("/api/deal-status")).json();
    dealStatusMap = ds.statuses || {};
  } catch {}
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
  initAnaTabs();
  restoreAnaFilter();
  render();
}

// 絞り込み条件をページ間/再訪でも保持
const ANA_FILTER_KEY = "kinbot_ana_filter_v1";
function saveAnaFilter() {
  try {
    localStorage.setItem(ANA_FILTER_KEY, JSON.stringify({
      owners: selectedOwners(),
      phases: selectedPhases(),
      from: $("fFrom") ? $("fFrom").value || "" : "",
      to: $("fTo") ? $("fTo").value || "" : "",
    }));
  } catch {}
}
function restoreAnaFilter() {
  try {
    const raw = localStorage.getItem(ANA_FILTER_KEY);
    if (!raw) return;
    const d = JSON.parse(raw) || {};
    if (Array.isArray(d.owners)) document.querySelectorAll("#fRepGroup input:not(.msel-all-cb)").forEach((c) => (c.checked = d.owners.includes(c.value)));
    if (Array.isArray(d.phases)) document.querySelectorAll("#fPhaseGroup input:not(.msel-all-cb)").forEach((c) => (c.checked = d.phases.includes(c.value)));
    if (d.from && $("fFrom")) $("fFrom").value = d.from;
    if (d.to && $("fTo")) $("fTo").value = d.to;
    $("fRepGroup")._mselUpdate && $("fRepGroup")._mselUpdate();
    $("fPhaseGroup")._mselUpdate && $("fPhaseGroup")._mselUpdate();
  } catch {}
}

function selectedOwners() {
  return [...document.querySelectorAll("#fRepGroup input:checked:not(.msel-all-cb)")].map((c) => c.value);
}
function selectedPhases() {
  return [...document.querySelectorAll("#fPhaseGroup input:checked:not(.msel-all-cb)")].map((c) => c.value);
}

// 開閉式の複数選択ドロップダウン
function initMultiDropdown(group, labelText, items, onChange) {
  if (!group) return;
  group.classList.add("msel");
  group.innerHTML = `<button type="button" class="msel-btn"><span class="msel-cap">${labelText}：</span><span class="msel-sum">すべて</span><span class="msel-caret">▾</span></button><div class="msel-panel" hidden></div>`;
  const btn = group.querySelector(".msel-btn");
  const panel = group.querySelector(".msel-panel");
  const sum = group.querySelector(".msel-sum");
  // すべて選択
  const allLab = document.createElement("label");
  allLab.className = "msel-opt msel-all";
  const allCb = document.createElement("input");
  allCb.type = "checkbox";
  allCb.className = "msel-all-cb";
  const allSpan = document.createElement("span");
  allSpan.className = "msel-optlabel";
  allSpan.textContent = "すべて選択";
  allLab.appendChild(allCb);
  allLab.appendChild(allSpan);
  panel.appendChild(allLab);
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
  const optInputs = () => [...panel.querySelectorAll("input:not(.msel-all-cb)")];
  const update = () => {
    const ins = optInputs();
    const checked = ins.filter((c) => c.checked);
    sum.textContent = checked.length
      ? items.filter((it) => checked.some((c) => c.value === it.value)).map((it) => it.label).join("・")
      : "すべて";
    allCb.checked = ins.length > 0 && checked.length === ins.length;
    allCb.indeterminate = checked.length > 0 && checked.length < ins.length;
  };
  group._mselUpdate = update;
  panel.addEventListener("change", (e) => {
    if (e.target.classList.contains("msel-all-cb")) {
      optInputs().forEach((c) => (c.checked = e.target.checked));
    }
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
    if (m.category && m.category !== "商談") return false; // 社内MTG/フォロー等は分析対象外
    if (owners.length && !owners.includes((m.owner || "").trim())) return false;
    if (phases.length && !phases.includes(m.phase || "")) return false;
    const d = new Date(m.created_at);
    if (from && d < from) return false;
    if (to && d > to) return false;
    return true;
  });
}

let curRows = [];
let activeTab = "dash";
let dashDirty = false;
function render(triggered) {
  const rows = applyFilter();
  curRows = rows;
  saveAnaFilter();
  const safe = (fn, ...args) => { try { fn(...args); } catch (e) { console.error("[render]", fn.name, e); } };
  // ダッシュボードのグラフはタブ表示中のみ描画（非表示中はcanvasが潰れるため）
  if (activeTab === "dash") { safe(renderDashboard, rows); dashDirty = false; }
  else dashDirty = true;
  safe(renderAgg, rows);
  safe(renderSetPanel, rows, !!triggered);
  safe(renderWinLoss, rows);
  safe(renderLostSignals);
  safe(renderFreeBox, rows);
  safe(renderList, rows);
}

// タブ切替（PC・スマホ共通）
function setAnaTab(mp) {
  activeTab = mp;
  document.querySelectorAll("#anaTabs .ana-tab").forEach((b) => b.classList.toggle("active", b.dataset.mp === mp));
  document.querySelectorAll("[data-mpanel]").forEach((el) => el.classList.toggle("m-active", el.dataset.mpanel === mp));
  if (mp === "dash" && dashDirty) { renderDashboard(curRows); dashDirty = false; }
  if (mp === "prof") renderProfileAnalysis();
  if (mp === "phase") renderPhasePanel();
}
function initAnaTabs() {
  const tabs = document.getElementById("anaTabs");
  if (!tabs) return;
  tabs.querySelectorAll(".ana-tab").forEach((b) => b.addEventListener("click", () => setAnaTab(b.dataset.mp)));
  setAnaTab("dash");
  const bulk = document.getElementById("anaBulkNotion");
  if (bulk && !bulk._wired) { bulk._wired = true; bulk.addEventListener("click", anaBulkNotion); }
  const dash = $("dashboard");
  if (dash && !dash._talkWired) {
    dash._talkWired = true;
    dash.addEventListener("click", (e) => {
      const c = e.target.closest("[data-talk]");
      if (c) openTalkModal(c.dataset.talk);
    });
  }
  initChat();
}

// ===== 商談フェーズ ダッシュボード（機能B・マネージャー向け） =====
const PHASE_NAMES_A = { 1: "課題特定", 2: "カスタマイズデモ", 3: "顧客起点", 4: "クロージング" };
let phaseInited = false;
function renderPhasePanel() {
  const el = $("phasepanel");
  if (!el) return;
  if (!phaseInited) {
    phaseInited = true;
    el.innerHTML =
      `<div class="phase-ctrls">` +
      `<div class="seg" id="phGran"><button class="seg-btn" data-g="day">日次</button><button class="seg-btn active" data-g="week">週次</button><button class="seg-btn" data-g="month">月次</button></div>` +
      `<label class="phase-date">期間 <input type="date" id="phFrom"> 〜 <input type="date" id="phTo"></label>` +
      `<button class="btn" id="phApply">更新</button>` +
      `</div><div id="phBody"><div class="empty-state">「更新」を押すと集計します。</div></div>`;
    el.querySelectorAll("#phGran .seg-btn").forEach((b) =>
      b.addEventListener("click", () => {
        el.querySelectorAll("#phGran .seg-btn").forEach((x) => x.classList.toggle("active", x === b));
        loadPhaseDash();
      })
    );
    $("phApply").addEventListener("click", loadPhaseDash);
    loadPhaseDash();
  }
}
async function loadPhaseDash() {
  const body = $("phBody");
  if (!body) return;
  const g = (document.querySelector("#phGran .seg-btn.active") || {}).dataset?.g || "week";
  const from = $("phFrom") ? $("phFrom").value : "";
  const to = $("phTo") ? $("phTo").value : "";
  body.innerHTML = '<div class="empty-state">集計中…</div>';
  try {
    const q = new URLSearchParams({ granularity: g });
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    const d = await (await fetch("/api/phase/dashboard?" + q.toString())).json();
    renderPhaseDash(body, d);
    loadKindPanel(from, to);
  } catch (e) {
    body.innerHTML = '<div class="empty-state">集計に失敗しました。</div>';
  }
}

// 種別（コールド/過去失注/通常）別の集計を読み込んで、フェーズパネル末尾に描画する
async function loadKindPanel(from, to) {
  const host = $("phBody");
  if (!host) return;
  let box = document.getElementById("kindPanel");
  if (!box) {
    box = document.createElement("div");
    box.id = "kindPanel";
    host.appendChild(box);
  }
  box.innerHTML = '<div class="phase-card"><div class="dash-title">種別別（コールド／過去失注）</div><div class="empty-state">集計中…</div></div>';
  try {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    const d = await (await fetch("/api/phase/by-kind?" + q.toString())).json();
    renderKindPanel(box, d);
  } catch {
    box.innerHTML = '<div class="phase-card"><div class="dash-title">種別別（コールド／過去失注）</div><div class="empty-state">集計に失敗しました。</div></div>';
  }
}
const KIND_META = {
  "コールド": { cls: "kind-cold", label: "コールド" },
  "過去失注": { cls: "kind-lost", label: "過去失注" },
  "通常": { cls: "kind-normal", label: "通常" },
};
// 種別ごとの「件数・割合」と「フェーズ到達率(1/2/3+/4)」を表示
function kindBlock(title, data) {
  if (!data || !data.total) {
    return `<div class="kind-group"><div class="kind-group-head">${escapeHtml(title)}</div><div class="empty-state" style="padding:12px">対象の案件がありません。</div></div>`;
  }
  const order = ["コールド", "過去失注", "通常"];
  // 割合バー
  const bar = order.map((k) => {
    const v = data.kinds[k];
    if (!v || !v.count) return "";
    return `<span class="kdist-seg ${KIND_META[k].cls}" style="width:${v.pct}%" title="${KIND_META[k].label} ${v.count}件（${v.pct}%）"></span>`;
  }).join("");
  // 種別ごとのカード（件数・割合・フェーズ到達率）
  const cards = order.map((k) => {
    const v = data.kinds[k];
    if (!v) return "";
    const bars = [["1", v.phase1], ["2", v.phase2], ["3+", v.phase3], ["4", v.phase4]]
      .map(([lab, val]) => `<div class="kph"><div class="kph-track"><div class="kph-fill ${KIND_META[k].cls}" style="width:${val}%"></div></div><div class="kph-x">P${lab}</div><div class="kph-v">${val}%</div></div>`)
      .join("");
    return `<div class="kind-card">` +
      `<div class="kind-card-head"><span class="kind-badge ${KIND_META[k].cls}">${KIND_META[k].label}</span>` +
      `<span class="kind-count">${v.count}件 <span class="kind-pct">(${v.pct}%)</span></span></div>` +
      `<div class="kind-phases">${bars}</div></div>`;
  }).join("");
  return `<div class="kind-group"><div class="kind-group-head">${escapeHtml(title)}<span class="kind-total">全${data.total}件（案件）</span></div>` +
    `<div class="kdist">${bar}</div>` +
    `<div class="kind-cards">${cards}</div></div>`;
}
function renderKindPanel(box, d) {
  if (!d || !d.overall) {
    box.innerHTML = '<div class="phase-card"><div class="dash-title">種別別（コールド／過去失注）</div><div class="empty-state">対象の案件がありません。</div></div>';
    return;
  }
  let html = `<div class="phase-card"><div class="dash-title">種別別（コールド／過去失注）— 案件単位</div>`;
  html += `<p class="kind-note">各案件の商談の種別（保存済み／商談名から推定）で集計。フェーズ到達率は「その種別の案件のうち各フェーズに到達した割合」です。</p>`;
  html += kindBlock("グループ全体", d.overall);
  for (const t of d.teams || []) {
    html += kindBlock(t.team_name, t);
  }
  html += `</div>`;
  box.innerHTML = html;
}
function phaseDistBar(dist, total) {
  const seg = (n, cls) => (total ? `<span class="pdist-seg ${cls}" style="width:${(n / total) * 100}%" title="${n}件"></span>` : "");
  return `<div class="pdist">${seg(dist.p1, "p1")}${seg(dist.p2, "p2")}${seg(dist.p3plus, "p3")}</div>`;
}
function renderPhaseDash(body, d) {
  if (!d || !d.overall || !d.overall.total) {
    body.innerHTML = '<div class="empty-state">対象期間に判定済みの商談がありません。<br>商談を記録すると自動でフェーズ判定され、ここに集計されます。</div>';
    return;
  }
  const o = d.overall;
  let html = "";
  // グループ全体
  html += `<div class="phase-overall"><div class="po-title">グループ全体（直販）</div>` +
    `<div class="po-kpis"><div class="po-kpi"><div class="po-v">${o.total}</div><div class="po-l">商談数</div></div>` +
    `<div class="po-kpi hero"><div class="po-v">${o.phase3_rate}%</div><div class="po-l">フェーズ3到達率</div></div>` +
    `<div class="po-kpi"><div class="po-v">${o.dist.p3plus}</div><div class="po-l">フェーズ3+ 到達</div></div></div>` +
    phaseDistBar(o.dist, o.total) +
    `<div class="pdist-legend"><span><i class="dot p1"></i>フェーズ1</span><span><i class="dot p2"></i>フェーズ2</span><span><i class="dot p3"></i>フェーズ3+</span></div></div>`;

  // 推移（フェーズ3到達率）
  if (d.trend && d.trend.length) {
    const max = 100;
    const bars = d.trend.map((t) => {
      const label = fmtPeriod(t.period, d.granularity);
      const h = Math.round((t.phase3_rate / max) * 100);
      return `<div class="ptbar"><div class="ptbar-fill" style="height:${Math.max(2, h)}%" title="${t.phase3_rate}%（${t.total}件）"></div><div class="ptbar-x">${escapeHtml(label)}</div><div class="ptbar-v">${t.phase3_rate}%</div></div>`;
    }).join("");
    html += `<div class="phase-card"><div class="dash-title">フェーズ3到達率の推移（${d.granularity === "day" ? "日次" : d.granularity === "month" ? "月次" : "週次"}）</div><div class="ptchart">${bars}</div></div>`;
  }

  // チーム → 個人
  for (const t of d.teams || []) {
    html += `<div class="phase-team"><div class="pt-head"><b>${escapeHtml(t.team_name)}</b><span class="pt-rate">フェーズ3到達率 ${t.phase3_rate}%（${t.total}件）</span></div>`;
    html += phaseDistBar(t.dist, t.total);
    html += '<div class="pt-reps">';
    for (const r of t.reps || []) {
      const warn = r.atRisk ? `<span class="pt-risk">要注意 ${r.atRisk}件</span>` : "";
      html += `<div class="pt-rep"><span class="pt-rep-name">${escapeHtml(r.rep_name)}</span>` +
        `<span class="pt-rep-rate">フェーズ3 ${r.phase3_rate}%</span>` +
        `<span class="pt-rep-total">${r.total}件</span>${warn}</div>`;
    }
    html += "</div></div>";
  }
  body.innerHTML = html;
}
function fmtPeriod(iso, gran) {
  const d = new Date(iso);
  if (isNaN(d)) return String(iso || "");
  if (gran === "month") return d.getFullYear() + "/" + (d.getMonth() + 1);
  if (gran === "day") return d.getMonth() + 1 + "/" + d.getDate();
  return d.getMonth() + 1 + "/" + d.getDate(); // 週: 週初日
}

// ===== 企業傾向（プロフィール × 商談回数） =====
let accountsProfA = null;
function parseNumJP(s) {
  if (!s) return null;
  let t = String(s).replace(/[,，]/g, "");
  const man = /万/.test(t);
  const m = t.match(/\d+(\.\d+)?/);
  if (!m) return null;
  let n = parseFloat(m[0]);
  if (man) n *= 10000;
  return Math.round(n);
}
const avgOf = (arr) => {
  const v = arr.filter((x) => typeof x === "number" && !isNaN(x));
  return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null;
};
function empBucket(n) {
  if (n == null) return null;
  if (n < 50) return "〜50名";
  if (n < 100) return "50〜100名";
  if (n < 300) return "100〜300名";
  if (n < 1000) return "300〜1000名";
  return "1000名以上";
}
function hireBucket(n) {
  if (n == null) return null;
  if (n < 5) return "〜5名";
  if (n < 10) return "5〜10名";
  if (n < 30) return "10〜30名";
  if (n < 50) return "30〜50名";
  return "50名以上";
}
// 最頻レンジ（一番多い区分）を返す {label, n}
function modeBucket(arr, fn) {
  const c = {};
  for (const r of arr) {
    const b = fn(r);
    if (b == null) continue;
    c[b] = (c[b] || 0) + 1;
  }
  const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
  return top ? { label: top[0], n: top[1] } : null;
}
function topIndustries(arr, n = 3) {
  const c = {};
  for (const r of arr) { const k = (r.industry || "不明").trim() || "不明"; c[k] = (c[k] || 0) + 1; }
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, n);
}
async function renderProfileAnalysis() {
  const el = $("profanalysis");
  if (!el) return;
  if (el._loaded) return; // 一度描画したら据え置き（タブ切替で再計算しない）
  el.innerHTML = '<div class="empty-state">読み込み中…</div>';
  if (!accountsProfA) {
    try { accountsProfA = await (await fetch("/api/accounts")).json(); } catch { accountsProfA = []; }
  }
  const profByKey = {};
  for (const a of accountsProfA || []) profByKey[a.key] = a;
  // 商談回数（商談カテゴリのみ）をアカウント別に集計
  const rounds = {};
  for (const m of all) {
    if (m.category && m.category !== "商談") continue;
    const k = acctOfA(m);
    rounds[k] = (rounds[k] || 0) + 1;
  }
  const recs = [];
  for (const k in rounds) {
    const p = profByKey[k] && profByKey[k].profile;
    if (!p) continue;
    const emp = parseNumJP(p.employees);
    const hire = parseNumJP(p.hiring);
    if (emp == null && hire == null && !(p.industry || "").trim()) continue;
    recs.push({ key: k, rounds: rounds[k], emp, hire, industry: (p.industry || "不明").trim() || "不明" });
  }
  el._loaded = true;
  if (recs.length < 2) {
    el._loaded = false;
    el.innerHTML =
      '<div class="empty-state">会社プロフィールを取得した案件がまだ少ないため分析できません。<br>' +
      '案件の各社で「企業サイトURL → 取得」をすると、ここで <b>1回で終わる企業 / 2回・3回と進む企業</b> の傾向（従業員数・業界・採用人数）を比較できます。</div>';
    return;
  }
  const buckets = { "1回で終了": [], "2回継続": [], "3回以上継続": [] };
  for (const r of recs) {
    const b = r.rounds <= 1 ? "1回で終了" : r.rounds === 2 ? "2回継続" : "3回以上継続";
    buckets[b].push(r);
  }
  let html = `<div class="prof-an-note">会社プロフィール取得済み <b>${recs.length}社</b> を、商談回数で分けて比較しています（プロフィール未取得の案件は対象外）。</div>`;
  html += '<div class="prof-an-grid">';
  for (const name of Object.keys(buckets)) {
    const arr = buckets[name];
    const empM = modeBucket(arr, (r) => empBucket(r.emp));
    const hireM = modeBucket(arr, (r) => hireBucket(r.hire));
    const inds = topIndustries(arr);
    html += `<div class="prof-an-card"><div class="prof-an-h">${name}<span class="prof-an-n">${arr.length}社</span></div>`;
    html += `<div class="prof-an-row"><span>従業員数（多い）</span><b>${empM ? escapeHtml(empM.label) : "—"}</b></div>`;
    html += `<div class="prof-an-row"><span>採用人数（多い）</span><b>${hireM ? escapeHtml(hireM.label) : "—"}</b></div>`;
    html += `<div class="prof-an-row"><span>多い業界</span><b>${inds.length ? escapeHtml(inds.map((x) => x[0]).join("・")) : "—"}</b></div>`;
    html += "</div>";
  }
  html += "</div>";

  // 自動の気づき（最頻レンジ・業界の比較）
  const obs = [];
  const e1 = modeBucket(buckets["1回で終了"], (r) => empBucket(r.emp));
  const e3 = modeBucket(buckets["3回以上継続"], (r) => empBucket(r.emp));
  if (e1 && e3 && e1.label !== e3.label) {
    obs.push(`従業員数は、1回で終わる企業は「${e1.label}」、3回以上続く企業は「${e3.label}」が多い。`);
  } else if (e3) {
    obs.push(`続く企業は従業員数「${e3.label}」が多い。`);
  }
  const h1 = modeBucket(buckets["1回で終了"], (r) => hireBucket(r.hire));
  const h3 = modeBucket(buckets["3回以上継続"], (r) => hireBucket(r.hire));
  if (h1 && h3 && h1.label !== h3.label) {
    obs.push(`採用人数は、1回で終わる企業は「${h1.label}」、3回以上続く企業は「${h3.label}」が多い。`);
  } else if (h3) {
    obs.push(`続く企業は採用人数「${h3.label}」が多い。`);
  }
  const cont = [...buckets["2回継続"], ...buckets["3回以上継続"]];
  const contTop = topIndustries(cont, 1)[0];
  const oneTop = topIndustries(buckets["1回で終了"], 1)[0];
  if (contTop) obs.push(`続きやすい業界の上位は「${escapeHtml(contTop[0])}」。`);
  if (oneTop) obs.push(`1回で終わりやすい業界の上位は「${escapeHtml(oneTop[0])}」。`);
  if (obs.length) {
    html += '<div class="prof-an-insight"><div class="prof-an-ih">気づき</div><ul>' + obs.map((o) => `<li>${o}</li>`).join("") + "</ul>" +
      '<div class="prof-an-cap">※ サンプル数が少ないと偏ります。プロフィール取得を増やすほど精度が上がります。</div></div>';
  }
  el.innerHTML = html;
}


function initChat() {
  const send = $("chatSend");
  if (!send || send._wired) return;
  send._wired = true;
  const ta = $("chatText");
  send.addEventListener("click", sendChat);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendChat(); }
  });
  $("chatClear").addEventListener("click", () => { chatMsgs = []; renderChat(); });
  renderChat();
}
function renderChat() {
  const log = $("chatLog");
  if (!log) return;
  if (!chatMsgs.length) {
    log.innerHTML = '<div class="empty-state">商談データをもとに会話できます。質問を入力してください。</div>';
    return;
  }
  log.innerHTML = chatMsgs.map((m) => {
    if (m.role === "user") return `<div class="cmsg cmsg-u"><div class="cbub">${escapeHtml(m.content)}</div></div>`;
    if (m.role === "assistant") return `<div class="cmsg cmsg-a"><img class="cava" src="kinbot.svg" alt="kinbot"/><div class="cbub">${mdToHtml(m.content)}</div></div>`;
    return `<div class="cmsg cmsg-sys">${escapeHtml(m.content)}</div>`;
  }).join("");
  log.scrollTop = log.scrollHeight;
}
async function sendChat() {
  const ta = $("chatText");
  const text = (ta.value || "").trim();
  if (!text) return;
  const send = $("chatSend");
  chatMsgs.push({ role: "user", content: text });
  ta.value = "";
  renderChat();
  const log = $("chatLog");
  const typing = document.createElement("div");
  typing.className = "cmsg cmsg-a";
  typing.innerHTML = '<img class="cava" src="kinbot.svg" alt="kinbot"/><div class="cbub"><span class="cdots">考え中…</span></div>';
  log.appendChild(typing);
  log.scrollTop = log.scrollHeight;
  send.disabled = true;
  try {
    const r = await fetch("/api/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...curFilter(), messages: chatMsgs, pro: $("chatPro").checked, web: $("chatWeb").checked }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "応答に失敗しました");
    chatMsgs.push({ role: "assistant", content: d.reply || "（空の応答）" });
    renderChat();
  } catch (e) {
    typing.remove();
    chatMsgs.push({ role: "system", content: "エラー: " + e.message });
    renderChat();
  } finally {
    send.disabled = false;
  }
}

// 刺さったトーク・懸念の一覧モーダル
async function openTalkModal(type) {
  let ov = document.getElementById("talkModal");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "talkModal";
    ov.className = "talk-ov";
    ov.innerHTML = `<div class="talk-modal"><div class="talk-head"><span class="talk-title"></span><button class="talk-x" aria-label="閉じる">×</button></div><div class="talk-body"></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => { if (e.target === ov || e.target.classList.contains("talk-x")) ov.classList.remove("open"); });
  }
  const titleEl = ov.querySelector(".talk-title");
  const bodyEl = ov.querySelector(".talk-body");
  titleEl.textContent = type === "landed" ? "💡 刺さったトーク一覧" : "⚠️ 懸念 → 刺さった言い返し 一覧";
  ov.classList.add("open");
  window.kbProgress(bodyEl, { percent: null, label: "読み込み中…" });
  try {
    const r = await fetch("/api/talks", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(curFilter()),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "取得に失敗しました");
    const items = type === "landed" ? d.landed : d.concerns;
    if (!items || !items.length) { bodyEl.innerHTML = '<div class="empty-state">該当するトークがありません（商談で「分析を生成」やライブ記録があると表示されます）。</div>'; return; }
    const meta = (i) => `<div class="talk-meta">${escapeHtml(i.title)} ・ ${escapeHtml(i.owner)} ・ ${fmtDate(i.date)}</div>`;
    let html = `<div class="talk-count">${items.length}件</div>`;
    if (type === "landed") {
      html += items.map((i) => `<div class="talk-item talk-land"><div class="talk-main">${escapeHtml(i.text)}</div>${i.why ? `<div class="talk-sub">${escapeHtml(i.why)}</div>` : ""}${meta(i)}</div>`).join("");
    } else {
      html += items.map((i) => `<div class="talk-item talk-obj"><div class="talk-q">「${escapeHtml(i.objection)}」</div><div class="talk-a">${escapeHtml(i.response)}</div>${i.basis ? `<div class="talk-sub">根拠: ${escapeHtml(i.basis)}</div>` : ""}${meta(i)}</div>`).join("");
    }
    bodyEl.innerHTML = html;
  } catch (e) {
    bodyEl.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  }
}

async function anaBulkNotion() {
  const btn = $("anaBulkNotion");
  const stat = $("anaBulkStatus");
  const rows = (curRows || []).filter((m) => m.status !== "processing" && m.status !== "error");
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

// ===== なんでも分析（フリー） =====
let freeWired = false;
let lastFreeAnswer = "";
function renderFreeBox(rows) {
  const el = $("freebox");
  if (!el) return;
  if (el.dataset.ready) { // 件数表示だけ更新
    const c = el.querySelector("#freeCount");
    if (c) c.textContent = `対象 ${rows.length} 件`;
    return;
  }
  el.dataset.ready = "1";
  el.innerHTML = `
    <div class="tend-head"><span>🧠 なんでも分析（自由に質問）</span><span class="metric-note" id="freeCount">対象 ${rows.length} 件</span></div>
    <p class="metric-note">上の絞り込み（担当・フェーズ・期間）が対象になります。例：「失注の共通点は？」「田中の強み・弱みは？」「来月の重点アクションを3つ」「価格懸念への切り返しを定型化して」</p>
    <textarea id="freeQ" class="free-q" placeholder="分析したいことを自由に入力…"></textarea>
    <div class="free-actions">
      <button class="btn" id="freeRun">分析する</button>
      <button class="btn ghost" id="freeCopy" hidden>コピー（Markdown）</button>
      <button class="btn ghost" id="freeNotion" hidden>Notionに送る</button>
    </div>
    <div class="free-answer" id="freeAns"></div>`;
  if (!freeWired) {
    freeWired = true;
    el.addEventListener("click", async (e) => {
      if (e.target.id === "freeRun") return runFree();
      if (e.target.id === "freeCopy") {
        try { await navigator.clipboard.writeText(lastFreeAnswer); e.target.textContent = "コピーしました"; setTimeout(() => (e.target.textContent = "コピー（Markdown）"), 1500); } catch {}
      }
      if (e.target.id === "freeNotion") return sendFreeToNotion(e.target);
    });
  }
}
async function runFree() {
  const q = ($("freeQ").value || "").trim();
  if (!q) { $("freeQ").focus(); return; }
  const btn = $("freeRun");
  btn.disabled = true; btn.textContent = "分析中…";
  window.kbProgress($("freeAns"), { percent: null, label: "AIが対象の商談を読み込んで分析しています…" });
  try {
    const r = await fetch("/api/free-analysis", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...curFilter(), question: q }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "分析に失敗しました");
    lastFreeAnswer = d.answer || "";
    $("freeAns").innerHTML = mdToHtml(lastFreeAnswer);
    $("freeCopy").hidden = false;
    $("freeNotion").hidden = false;
  } catch (e) {
    $("freeAns").innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  } finally {
    btn.disabled = false; btn.textContent = "分析する";
  }
}
async function sendFreeToNotion(btn) {
  if (!lastFreeAnswer) return;
  btn.disabled = true; const orig = btn.textContent; btn.textContent = "送信中…";
  try {
    const title = "分析: " + (($("freeQ").value || "").trim().slice(0, 40) || "なんでも分析");
    const r = await fetch("/api/notion/report", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, markdown: lastFreeAnswer }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "送信に失敗");
    btn.textContent = "送信済み";
    if (d.url) window.open(d.url, "_blank", "noopener");
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
  } catch (e) {
    alert("Notion送信に失敗: " + e.message);
    btn.textContent = orig; btn.disabled = false;
  }
}
// ごく簡易なMarkdown→HTML（見出し・箇条書き・段落）
function mdToHtml(md) {
  const lines = String(md).replace(/\r/g, "").split("\n");
  let html = "", inUl = false;
  const esc = (s) => escapeHtml(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  for (const raw of lines) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^#{1,3}\s+(.*)/))) { if (inUl) { html += "</ul>"; inUl = false; } html += `<h4>${esc(m[1])}</h4>`; }
    else if ((m = line.match(/^\s*[-*・]\s+(.*)/))) { if (!inUl) { html += "<ul>"; inUl = true; } html += `<li>${esc(m[1])}</li>`; }
    else if (!line.trim()) { if (inUl) { html += "</ul>"; inUl = false; } }
    else { if (inUl) { html += "</ul>"; inUl = false; } html += `<p>${esc(line)}</p>`; }
  }
  if (inUl) html += "</ul>";
  return html || '<div class="empty-state">（空の回答）</div>';
}

// ===== 失注サイン（学習） =====
let lostSigLoaded = false;
async function renderLostSignals() {
  const el = $("lostsig");
  if (!el) return;
  el.innerHTML = `<div class="tend-head"><span>🚩 失注サイン（これを言われたら危険）</span><button class="btn" id="lsLearn">失注商談から学習</button></div>
    <div class="tend-body" id="lsBody"><div class="empty-state">失注した商談から「失注の予兆フレーズ」をAIが抽出します。学習すると、以後の商談終了時の失注判定にも自動で反映されます。</div></div>`;
  $("lsLearn").onclick = learnLostSignals;
  if (!lostSigLoaded) {
    lostSigLoaded = true;
    try {
      const d = await (await fetch("/api/lost-signals")).json();
      if (d.signals && d.signals.length) paintLostSignals(d.signals);
    } catch {}
  }
}
function paintLostSignals(signals) {
  const body = $("lsBody");
  if (!body) return;
  if (!signals || !signals.length) { body.innerHTML = '<div class="empty-state">まだ学習結果がありません。</div>'; return; }
  body.innerHTML = `<ul class="ls-list">` +
    signals.map((g) => `<li><b>${escapeHtml(g.phrase || "")}</b>${g.why ? `<span class="ls-why">${escapeHtml(g.why)}</span>` : ""}</li>`).join("") +
    `</ul><p class="metric-note">この内容は商談終了時の失注判定にも反映されます。</p>`;
}
async function learnLostSignals() {
  const btn = $("lsLearn");
  if (btn) { btn.disabled = true; btn.textContent = "学習中…"; }
  window.kbProgress($("lsBody"), { percent: null, label: "失注商談を分析して予兆を抽出しています…" });
  try {
    const r = await fetch("/api/lost-signals/learn", { method: "POST" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "学習に失敗");
    paintLostSignals(d.signals);
  } catch (e) {
    $("lsBody").innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "再学習"; }
  }
}

// ===== 失注 vs 進行中の傾向分析 =====
let wlSeq = 0;
function renderWinLoss(rows) {
  const el = $("winloss");
  if (!el) return;
  if (!rows.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div class="tend-head"><span>🏆 失注 vs 進行中・受注 の傾向分析</span><button class="btn" id="wlBtn">分析する</button></div>
    <div class="tend-body" id="wlBody"><div class="empty-state">案件ステータス（失注／進行中／受注）をもとに、AIが「負けパターン」と「勝ちパターン」を比較してまとめます。ボタンを押すと分析します。</div></div>`;
  const filter = curFilter();
  $("wlBtn").onclick = () => runWinLoss(filter, ++wlSeq, true);
}
async function runWinLoss(filter, seq, force) {
  const btn = $("wlBtn");
  if (btn) { btn.disabled = true; btn.textContent = "分析中…"; }
  window.kbProgress($("wlBody"), { percent: null, label: "失注・進行中の商談を横断分析しています…" });
  try {
    const r = await fetch("/api/winloss-analysis", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...filter, force: !!force }),
    });
    const d = await r.json();
    if (seq !== wlSeq) return;
    if (d.error) throw new Error(d.error);
    renderWinLossResult(d);
    if (btn) { btn.disabled = false; btn.textContent = "再分析"; }
  } catch (e) {
    if (seq !== wlSeq) return;
    $("wlBody").innerHTML = `<div class="empty-state">${escapeHtml(e.message || "分析に失敗しました")}</div>`;
    if (btn) { btn.disabled = false; btn.textContent = "もう一度試す"; }
  }
}
function wlGroup(label, items, cls) {
  if (!Array.isArray(items) || !items.length) return "";
  return `<div class="sgroup ${cls || ""}"><div class="label">${label}</div><ul>` +
    items.map((i) => `<li>${escapeHtml(i)}</li>`).join("") + `</ul></div>`;
}
function renderWinLossResult(d) {
  let html = `<p class="metric-note">失注 ${d.lostCount || 0}件 ・ 進行中/受注 ${d.activeCount || 0}件 を比較${d.cached ? "・保存済みの結果" : "・たった今分析"}</p>`;
  html += '<div class="wl-cols">';
  html += `<div class="wl-col wl-lost"><div class="wl-col-h">⚠️ 失注に多い傾向</div><ul>${(d.lost_patterns || []).map((i) => `<li>${escapeHtml(i)}</li>`).join("") || "<li>—</li>"}</ul></div>`;
  html += `<div class="wl-col wl-win"><div class="wl-col-h">✅ 進行/受注に多い傾向</div><ul>${(d.active_patterns || []).map((i) => `<li>${escapeHtml(i)}</li>`).join("") || "<li>—</li>"}</ul></div>`;
  html += "</div>";
  html += wlGroup("勝ち負けを分ける決定的な違い", d.key_differences, "wl-diff");
  html += wlGroup("明日からの打ち手", d.recommendations, "wl-rec");
  $("wlBody").innerHTML = html;
}

// ===== ダッシュボード（フィルタ連動のKPI・チャート） =====
function ymKey(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
let _charts = {};
function destroyCharts() { for (const k in _charts) { try { _charts[k].destroy(); } catch {} } _charts = {}; }
const DIMS = [["hearing", "ヒアリング"], ["proposal", "提案"], ["closing", "クロージング"], ["listening", "傾聴"]];
function heatColor(v) {
  if (v == null) return "var(--panel-2)";
  if (v >= 4.2) return "#1aa884";
  if (v >= 3.5) return "#7fccae";
  if (v >= 2.8) return "#f2d27a";
  if (v >= 2) return "#eab168";
  return "#df8a6a";
}

function renderDashboard(rows) {
  const el = $("dashboard");
  if (!el) return;
  const now = new Date();
  const thisYm = ymKey(now);
  const total = rows.length;
  const thisMonth = rows.filter((m) => ymKey(new Date(m.created_at)) === thisYm).length;
  const analyzed = rows.filter((m) => m.analysis && m.analysis.scores).length;
  const analyzedPct = total ? Math.round((analyzed / total) * 100) : 0;

  // 勝ち筋指標（metricsから）
  const withTalk = rows.filter((m) => m.metrics && typeof m.metrics.repTalkPct === "number");
  const avgTalk = withTalk.length ? Math.round(withTalk.reduce((s, m) => s + m.metrics.repTalkPct, 0) / withTalk.length) : null;
  const landedTotal = rows.reduce((s, m) => s + ((m.metrics && m.metrics.landedCount) || 0), 0);
  const concernTotal = rows.reduce((s, m) => s + ((m.metrics && m.metrics.concernCount) || 0), 0);
  const sfLinked = rows.filter((m) => m.sf_url && String(m.sf_url).trim()).length;
  const sfPct = total ? Math.round((sfLinked / total) * 100) : 0;

  // 月別（直近6ヶ月）
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: ymKey(d), label: d.getMonth() + 1 + "月", n: 0 });
  }
  for (const m of rows) {
    const hit = months.find((x) => x.key === ymKey(new Date(m.created_at)));
    if (hit) hit.n++;
  }

  // フェーズ分布
  const phaseCounts = PHASES.map((p) => ({ code: p.code, label: p.label, n: rows.filter((m) => (m.phase || "") === p.code).length }));
  const unset = rows.filter((m) => !m.phase).length;

  // 担当別 件数
  const repMap = {};
  for (const m of rows) {
    const name = m.owner_name || m.owner || m.rep_name || "(不明)";
    repMap[name] = (repMap[name] || 0) + 1;
  }
  const repRank = Object.entries(repMap).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxRep = Math.max(1, ...repRank.map(([, n]) => n));

  // 挨拶ヘッダー（失敗しても本体は描画する）
  let html = "";
  try {
    const wonCount = Object.values(dealStatusMap || {}).filter((s) => s && s.status === "受注").length;
    const sub = wonCount > 0 ? `これまでに受注${wonCount}件。いい流れです。` : "今日もいきましょう。";
    html += `<div class="dash-greet"><img class="dash-greet-ava" src="kinbot.svg" alt="" /><div><div class="dash-greet-h">おかえりなさい${greetName ? "、" + escapeHtml(greetName) + "さん" : ""}</div><div class="dash-greet-sub">${escapeHtml(sub)}</div></div></div>`;
  } catch (e) { console.error("[dash greet]", e); }

  // KPIカード
  const kpis = [
    { label: "対象の商談", val: total },
    { label: "今月の商談", val: thisMonth },
    { label: "平均トーク比率(営業)", val: avgTalk == null ? "—" : avgTalk + "%", warn: avgTalk != null && avgTalk >= 65 },
    { label: "刺さったトーク", val: landedTotal, tone: "buy", click: "landed" },
    { label: "懸念", val: concernTotal, tone: "risk", click: "concern" },
    { label: "分析済み率", val: analyzedPct + "%" },
  ];
  html += '<div class="dash-kpis6">';
  for (const k of kpis)
    html += `<div class="kpi ${k.tone || ""} ${k.click ? "kpi-click" : ""}" ${k.click ? `data-talk="${k.click}"` : ""}><div class="kpi-val ${k.warn ? "warn" : ""}">${k.val}</div><div class="kpi-label">${k.label}${k.click ? ' <span class="kpi-more">一覧 ›</span>' : ""}</div></div>`;
  html += "</div>";

  // いま追うべき案件（進行中・最近動いた順）
  try {
    const groups = {};
    for (const m of rows) {
      const k = acctOfA(m);
      (groups[k] = groups[k] || []).push(m);
    }
    const items = [];
    for (const k in groups) {
      const st = (dealStatusMap[k] && dealStatusMap[k].status) || "進行中";
      if (st !== "進行中") continue;
      const last = groups[k].reduce((a, b) => (new Date(a.created_at) > new Date(b.created_at) ? a : b));
      items.push({ key: k, last, n: groups[k].length });
    }
    items.sort((a, b) => new Date(b.last.created_at) - new Date(a.last.created_at));
    const top = items.slice(0, 4);
    html += '<div class="dash-card follow-card"><div class="dash-title">🔥 いま追うべき案件</div>';
    if (!top.length) html += '<div class="empty-state">進行中の案件はありません。</div>';
    else {
      html += '<div class="follow-list">';
      for (const it of top) {
        html += `<a class="follow-row" href="history.html?m=${encodeURIComponent(it.last.bot_id)}"><span class="follow-name">${escapeHtml(it.key)}</span><span class="follow-sub">${escapeHtml(phaseLabel(it.last.phase))} ・ 最終 ${fmtDate(it.last.created_at)}</span><span class="follow-go">›</span></a>`;
      }
      html += "</div>";
    }
    html += "</div>";
  } catch (e) { console.error("[dash follow]", e); }

  try {
  // 行1：推移(折れ線) + フェーズ分布(ドーナツ)
  html += '<div class="dash-grid2">';
  html += '<div class="dash-card"><div class="dash-title">商談数の推移（月別）</div><div class="chart-box"><canvas id="chTrend"></canvas></div></div>';
  html += '<div class="dash-card"><div class="dash-title">フェーズ分布</div><div class="chart-box"><canvas id="chPhase"></canvas></div></div>';
  html += "</div>";

  // 行2：コンバージョン(ファネル+SF) + 担当別件数
  html += '<div class="dash-grid2">';
  html += '<div class="dash-card"><div class="dash-title">コンバージョン（フェーズ到達）</div><div class="hbars">';
  const base01 = phaseCounts[0].n || total || 1;
  for (const p of phaseCounts) {
    const w = Math.round((p.n / Math.max(1, base01)) * 100);
    html += `<div class="hbar"><span class="hbar-name">${escapeHtml(p.label)}</span><span class="hbar-track"><span class="hbar-fill green" style="width:${Math.min(100, w)}%"></span></span><span class="hbar-n">${p.n}</span></div>`;
  }
  if (unset) html += `<div class="hbar"><span class="hbar-name">未設定</span><span class="hbar-track"><span class="hbar-fill" style="width:${Math.round((unset / Math.max(1, base01)) * 100)}%"></span></span><span class="hbar-n">${unset}</span></div>`;
  html += `</div><div class="conv-foot">Salesforce登録済み <b>${sfLinked}</b> 件（${sfPct}%）<span class="metric-note">※受注の実数はSF側のデータ連携が必要です。ここでは登録率を表示。</span></div></div>`;

  html += '<div class="dash-card"><div class="dash-title">営業担当別 件数</div><div class="hbars">';
  if (!repRank.length) html += '<div class="empty-state">データがありません。</div>';
  for (const [name, n] of repRank) {
    const w = Math.round((n / maxRep) * 100);
    html += `<div class="hbar"><span class="hbar-name">${escapeHtml(name)}</span><span class="hbar-track"><span class="hbar-fill green" style="width:${w}%"></span></span><span class="hbar-n">${n}</span></div>`;
  }
  html += "</div></div>";
  html += "</div>";

  // 担当別の質（ヒートマップ）
  const repScored = {};
  for (const m of rows) {
    if (!(m.analysis && m.analysis.scores)) continue;
    const name = m.owner_name || m.owner || m.rep_name || "(不明)";
    (repScored[name] = repScored[name] || []).push(m);
  }
  const repNames = Object.keys(repScored);
  html += '<div class="dash-card heatmap-card"><div class="dash-title">担当別の質（平均スコア・強み/弱み）</div>';
  if (!repNames.length) {
    html += '<div class="empty-state">分析済みの商談がありません。各商談で「分析を生成」すると表示されます。</div>';
  } else {
    html += '<table class="heat"><tr><th>営業担当</th><th>件数</th>' + DIMS.map(([, jp]) => `<th>${jp}</th>`).join("") + "<th>平均</th></tr>";
    for (const name of repNames) {
      const list = repScored[name];
      const cells = DIMS.map(([k]) => avgScore(list, k));
      const overall = cells.reduce((a, b) => a + b, 0) / cells.length;
      html += `<tr><td class="heat-rep">${escapeHtml(name)}</td><td>${list.length}</td>` +
        cells.map((v) => `<td class="heat-cell" style="background:${heatColor(v)}">${v.toFixed(1)}</td>`).join("") +
        `<td class="heat-cell" style="background:${heatColor(overall)}"><b>${overall.toFixed(1)}</b></td></tr>`;
    }
    html += "</table><p class=\"metric-note\">5点満点。色が濃い緑ほど高評価、オレンジは要改善。</p>";
  }
  html += "</div>";
  } catch (e) { console.error("[dash body]", e); }

  el.innerHTML = html;

  // Chart.js 描画
  destroyCharts();
  if (window.Chart) {
    const trend = document.getElementById("chTrend");
    if (trend) {
      _charts.trend = new Chart(trend, {
        type: "line",
        data: { labels: months.map((m) => m.label), datasets: [{ data: months.map((m) => m.n), borderColor: "#0f6e62", backgroundColor: "rgba(57,224,180,.18)", fill: true, tension: 0.3, pointBackgroundColor: "#0f6e62" }] },
        options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }, maintainAspectRatio: false },
      });
    }
    const ph = document.getElementById("chPhase");
    if (ph) {
      const data = phaseCounts.map((p) => p.n).concat(unset ? [unset] : []);
      const labels = phaseCounts.map((p) => p.label).concat(unset ? ["未設定"] : []);
      _charts.phase = new Chart(ph, {
        type: "doughnut",
        data: { labels, datasets: [{ data, backgroundColor: ["#0f6e62", "#1aa884", "#5dcaa5", "#9fe1cb", "#cbd5d0"] }] },
        options: { plugins: { legend: { position: "bottom", labels: { font: { size: 11 }, boxWidth: 12 } } }, maintainAspectRatio: false },
      });
    }
  }
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
  $("setBody").innerHTML = "";
  window.kbProgress($("setBody"), { percent: null, label: "AIが商談内容を横断して傾向をまとめています…" });
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
