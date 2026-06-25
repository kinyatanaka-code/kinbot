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
  initAnaTabs();
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

let curRows = [];
let activeTab = "dash";
let dashDirty = false;
function render(triggered) {
  const rows = applyFilter();
  curRows = rows;
  // ダッシュボードのグラフはタブ表示中のみ描画（非表示中はcanvasが潰れるため）
  if (activeTab === "dash") { renderDashboard(rows); dashDirty = false; }
  else dashDirty = true;
  renderAgg(rows);
  renderSetPanel(rows, !!triggered);
  renderWinLoss(rows);
  renderLostSignals();
  renderFreeBox(rows);
  renderList(rows);
}

// タブ切替（PC・スマホ共通）
function setAnaTab(mp) {
  activeTab = mp;
  document.querySelectorAll("#anaTabs .ana-tab").forEach((b) => b.classList.toggle("active", b.dataset.mp === mp));
  document.querySelectorAll("[data-mpanel]").forEach((el) => el.classList.toggle("m-active", el.dataset.mpanel === mp));
  if (mp === "dash" && dashDirty) { renderDashboard(curRows); dashDirty = false; }
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

// ===== AIと会話（Gemini） =====
let chatMsgs = [];
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
      body: JSON.stringify({ ...curFilter(), messages: chatMsgs, pro: $("chatPro").checked }),
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

  // KPIカード
  const kpis = [
    { label: "対象の商談", val: total },
    { label: "今月の商談", val: thisMonth },
    { label: "平均トーク比率(営業)", val: avgTalk == null ? "—" : avgTalk + "%", warn: avgTalk != null && avgTalk >= 65 },
    { label: "刺さったトーク", val: landedTotal, tone: "buy", click: "landed" },
    { label: "懸念", val: concernTotal, tone: "risk", click: "concern" },
    { label: "分析済み率", val: analyzedPct + "%" },
  ];
  let html = '<div class="dash-kpis6">';
  for (const k of kpis)
    html += `<div class="kpi ${k.tone || ""} ${k.click ? "kpi-click" : ""}" ${k.click ? `data-talk="${k.click}"` : ""}><div class="kpi-val ${k.warn ? "warn" : ""}">${k.val}</div><div class="kpi-label">${k.label}${k.click ? ' <span class="kpi-more">一覧 ›</span>' : ""}</div></div>`;
  html += "</div>";

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
