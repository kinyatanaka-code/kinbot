// deals.js — 案件単位ビュー＋ネクストアクション管理
const $ = (id) => document.getElementById(id);
const PHASE_LABEL = { "01": "01 初回商談", "02": "02 有効商談", "03": "03 担当者合意", "04": "04 企画決定者合意" };
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function fmtDate(d) {
  const x = new Date(d);
  return `${x.getMonth() + 1}/${x.getDate()} ${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;
}
function companyFromTitle(title) {
  let t = String(title || "").trim();
  if (!t) return "(無題)";
  t = t.replace(/^[\s　・※•◆◇■□▶▷*\-–—✉⊠]+/u, "");
  t = t.replace(/[【\[［][^】\]］]*[】\]］]/gu, " ");
  t = t.replace(/[\s　/／|｜:：][^\s　/／|｜]{0,16}様(?:\s*[・,、][^\s　/／|｜]{0,16}様)*\s*$/u, "");
  t = t.replace(/[^\s　/／|｜]{0,16}様\s*$/u, "");
  t = t.replace(/\s+/g, " ").trim();
  return t || String(title || "(無題)").trim();
}
const acctOf = (m) => (m.account && m.account.trim()) || companyFromTitle(m.title) || "(無題)";
function lastLostReason(ms) {
  for (let i = ms.length - 1; i >= 0; i--) {
    const a = ms[i].analysis;
    if (a && a.deal_status === "失注" && a.deal_status_reason) return a.deal_status_reason;
  }
  for (let i = ms.length - 1; i >= 0; i--) {
    const a = ms[i].analysis;
    if (a && a.deal_status_reason) return a.deal_status_reason;
  }
  return "";
}

let all = [];
let groups = {}; // account -> meetings[]
let current = null;
let dealStatuses = {}; // account -> {status, manual}
let accountsMap = {}; // key -> {site_url, official_name, profile}
const STATUS_LIST = ["進行中", "受注", "失注", "保留"];
const statusOf = (a) => (dealStatuses[a] && dealStatuses[a].status) || "進行中";
const displayName = (a) => (accountsMap[a] && accountsMap[a].official_name) || a;

let usersCacheD = null;
async function loadUsersD() {
  if (usersCacheD) return usersCacheD;
  try { usersCacheD = await (await fetch("/api/users")).json(); } catch { usersCacheD = []; }
  return usersCacheD;
}
async function renderOwnerPicker(account, last) {
  const wrap = document.getElementById("dealOwnerWrap");
  if (!wrap) return;
  const users = await loadUsersD();
  const acc = accountsMap[account] || {};
  const cur = acc.owner || last.owner || "";
  const curName = (() => {
    const u = (users || []).find((x) => x.email === cur);
    return u ? (u.name || u.email) : (last.owner_name || cur || "未設定");
  })();
  const initial = (curName || "?").trim().charAt(0);
  const opts = ['<option value="">未設定</option>']
    .concat((users || []).map((u) => `<option value="${esc(u.email)}" ${u.email === cur ? "selected" : ""}>${esc(u.name || u.email)}</option>`))
    .join("");
  wrap.innerHTML =
    `<span class="deal-owner"><span class="deal-owner-ava">${esc(initial)}</span>` +
    `担当 <select id="dealOwnerSel" class="deal-owner-sel">${opts}</select></span>`;
  const sel = wrap.querySelector("#dealOwnerSel");
  sel.addEventListener("change", async () => {
    const owner = sel.value;
    try {
      await fetch(`/api/accounts/${encodeURIComponent(account)}`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner }),
      });
      accountsMap[account] = { ...(accountsMap[account] || { key: account }), owner };
      // アバター文字を更新
      const u = (users || []).find((x) => x.email === owner);
      const nm = u ? (u.name || u.email) : (owner || "未設定");
      const ava = wrap.querySelector(".deal-owner-ava");
      if (ava) ava.textContent = (nm || "?").trim().charAt(0);
    } catch {}
  });
}

function renderProfile(account) {
  const body = document.getElementById("profBody");
  if (!body) return;
  const acc = accountsMap[account];
  const p = acc && acc.profile;
  if (!p || !(p.industry || p.employees || p.hiring || p.founded || p.location || p.business)) {
    body.innerHTML = '<div class="empty-state">企業サイトURLを入れて「取得」すると、業界・従業員数・採用人数などの会社概要が表示されます。</div>';
    return;
  }
  const cell = (label, val) => (val ? `<div class="prof-cell"><div class="prof-k">${label}</div><div class="prof-v">${esc(val)}</div></div>` : "");
  body.innerHTML =
    `<div class="prof-grid">` +
    cell("業界", p.industry) + cell("従業員数", p.employees) + cell("採用予定", p.hiring) +
    cell("設立", p.founded) + cell("本社", p.location) +
    `</div>` +
    (p.business ? `<div class="prof-biz">事業内容：${esc(p.business)} <span class="prof-note">（AI自動取得・要確認）</span></div>` : "") +
    (acc.site_url ? `<div class="prof-site"><a href="${esc(acc.site_url)}" target="_blank" rel="noopener">サイトを開く ↗</a></div>` : "");
}

async function load() {
  try {
    all = await (await fetch("/api/meetings")).json();
    const ds = await (await fetch("/api/deal-status")).json();
    dealStatuses = ds.statuses || {};
    try {
      const accs = await (await fetch("/api/accounts")).json();
      accountsMap = {};
      for (const a of accs || []) accountsMap[a.key] = a;
    } catch {}
  } catch {
    $("dealList").innerHTML = '<div class="empty-state">読み込みに失敗しました。</div>';
    return;
  }
  // 営業担当フィルタの選択肢
  const owners = [...new Set(all.map((m) => m.owner_name || m.owner).filter(Boolean))];
  const sel = $("fOwner");
  for (const o of owners) {
    const opt = document.createElement("option");
    opt.value = o; opt.textContent = o; sel.appendChild(opt);
  }
  renderList();
}

function buildGroups() {
  const ownerF = $("fOwner").value;
  const q = ($("fSearch").value || "").trim().toLowerCase();
  groups = {};
  for (const m of all) {
    if (m.category && m.category !== "商談") continue; // 社内MTG/フォロー等は案件に含めない
    if (ownerF && (m.owner_name || m.owner) !== ownerF) continue;
    const a = acctOf(m);
    if (q && !a.toLowerCase().includes(q)) continue;
    (groups[a] = groups[a] || []).push(m);
  }
  for (const a in groups) groups[a].sort((x, y) => new Date(x.created_at) - new Date(y.created_at));
}

function renderList() {
  buildGroups();
  const el = $("dealList");
  const names = Object.keys(groups).sort((a, b) => {
    const la = groups[a][groups[a].length - 1].created_at;
    const lb = groups[b][groups[b].length - 1].created_at;
    return new Date(lb) - new Date(la);
  });
  if (!names.length) {
    el.innerHTML = '<div class="empty-state">該当する案件がありません。</div>';
    return;
  }
  el.innerHTML = "";
  for (const a of names) {
    const ms = groups[a];
    const last = ms[ms.length - 1];
    const st = statusOf(a);
    const card = document.createElement("div");
    card.className = "deal-card" + (a === current ? " active" : "");
    card.innerHTML =
      `<div class="deal-name">${esc(displayName(a))} <span class="status-badge st-${st}">${st}</span></div>` +
      `<div class="deal-meta"><span>${ms.length}件</span><span>${esc(last.owner_name || last.owner || "")}</span></div>` +
      `<div class="deal-sub">${esc(PHASE_LABEL[last.phase] || "フェーズ未設定")} ・ 最終 ${fmtDate(last.created_at)}</div>`;
    card.addEventListener("click", () => selectDeal(a));
    el.appendChild(card);
  }
}

async function selectDeal(account) {
  current = account;
  renderList();
  const ms = groups[account] || [];
  const det = $("dealDetail");
  const wrap = document.querySelector(".history");
  if (wrap) wrap.classList.add("m-detail");
  if (!selectDeal._wired && wrap) {
    selectDeal._wired = true;
    det.addEventListener("click", (e) => { if (e.target.closest(".m-back")) wrap.classList.remove("m-detail"); });
  }
  det.scrollTop = 0;
  const last = ms[ms.length - 1];

  // 相手の懸念（集約・重複除去）
  const concerns = [];
  const seen = new Set();
  for (const m of ms) {
    const cs = (m.summary && m.summary.customer_concerns) || [];
    for (const c of cs) {
      const k = String(c).replace(/\s+/g, "");
      if (k && !seen.has(k)) { seen.add(k); concerns.push(String(c)); }
    }
  }

  det.innerHTML =
    `<button class="m-back" type="button">← 一覧へ戻る</button>` +
    `<div class="deal-head">` +
    `<div class="deal-head-top"><h2>${esc(displayName(account))}</h2>` +
    `<div class="deal-status-pick"><span class="status-badge st-${statusOf(account)}" id="dealStBadge">${statusOf(account)}</span>` +
    `<select id="dealStSel">${STATUS_LIST.map((s) => `<option value="${s}" ${statusOf(account) === s ? "selected" : ""}>${s}</option>`).join("")}<option value="__auto">AIに任せる</option></select></div></div>` +
    `<div class="deal-head-meta"><span id="dealOwnerWrap" class="deal-owner-wrap"></span> ・ ${ms.length}回の商談 ・ 現在 ${esc(PHASE_LABEL[last.phase] || "フェーズ未設定")}` +
    (dealStatuses[account] && dealStatuses[account].manual ? ' ・ <span class="st-manual">手動設定</span>' : ' ・ <span class="st-auto">AI自動</span>') +
    `</div>` +
    (statusOf(account) === "失注" && lastLostReason(ms) ? `<div class="lost-reason">AI判定の失注理由: ${esc(lastLostReason(ms))}</div>` : "") +
    `</div>` +
    `<section class="deal-sec deal-profile"><div class="deal-sec-h">🏢 会社プロフィール</div>` +
    `<div class="prof-url"><input id="profUrl" type="text" placeholder="企業サイトURL（例: example.co.jp）" /><button class="btn" id="profGet">取得</button><span class="prof-status" id="profStatus"></span></div>` +
    `<div id="profBody"></div></section>` +
    `<section class="deal-sec"><div class="deal-sec-h">📋 ネクストアクション</div><div id="aiBox"><div class="empty-state">読み込み中…</div></div>` +
    `<div class="ai-add"><input id="aiNew" type="text" placeholder="やることを追加（例：見積もりを送付）" /><input id="aiDue" type="date" /><button class="btn" id="aiAddBtn">追加</button></div></section>` +
    `<section class="deal-sec"><div class="deal-sec-h">⚠️ 相手の懸念（これまでの集約）</div>` +
    (concerns.length ? `<ul class="deal-concerns">${concerns.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : '<div class="empty-state">記録なし</div>') +
    `</section>` +
    `<section class="deal-sec"><div class="deal-sec-h">🗂 商談の流れ</div><div class="deal-timeline" id="dealTimeline"></div></section>`;

  // ステータス変更
  $("dealStSel").addEventListener("change", async (e) => {
    const v = e.target.value;
    const body = v === "__auto" ? { account, auto: true } : { account, status: v };
    await fetch("/api/deal-status", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    // ローカル状態を更新
    if (v === "__auto") {
      if (dealStatuses[account]) dealStatuses[account].manual = false;
    } else {
      dealStatuses[account] = { status: v, manual: true };
    }
    selectDeal(account);
    renderList();
  });

  // 会社プロフィール
  renderProfile(account);
  // 担当（アカウント単位で選択・保存）
  await renderOwnerPicker(account, last);
  const profUrl = $("profUrl"), profGet = $("profGet"), profStatus = $("profStatus");
  if (accountsMap[account] && accountsMap[account].site_url) profUrl.value = accountsMap[account].site_url;
  profGet.addEventListener("click", async () => {
    const url = (profUrl.value || "").trim();
    if (!url) { profUrl.focus(); return; }
    profGet.disabled = true; profGet.textContent = "取得中…";
    if (window.kbProgress) window.kbProgress(profStatus, { percent: null, label: "サイトとWebから会社概要を取得中…" });
    try {
      const r = await fetch(`/api/accounts/${encodeURIComponent(account)}/enrich`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "取得に失敗しました");
      accountsMap[account] = { key: account, site_url: d.siteUrl, official_name: d.officialName, profile: d.profile };
      if (window.kbProgress) window.kbProgress(profStatus, { clear: true });
      renderProfile(account);
      // 見出し・カード名を正式社名に反映
      const h = document.querySelector("#dealDetail h2"); if (h) h.textContent = displayName(account);
      renderList();
    } catch (e) {
      if (window.kbProgress) window.kbProgress(profStatus, { clear: true });
      profStatus.textContent = "失敗: " + e.message;
    } finally {
      profGet.disabled = false; profGet.textContent = "取得";
    }
  });

  // タイムライン
  const tl = $("dealTimeline");
  tl.innerHTML = "";
  for (const m of [...ms].reverse()) {
    const ov = (m.summary && m.summary.overview) || "（要約なし）";
    const item = document.createElement("div");
    item.className = "tl-item";
    item.innerHTML =
      `<div class="tl-dot"></div>` +
      `<div class="tl-body"><div class="tl-top"><b>${m.round_no ? m.round_no + "回目" : ""} ${esc(PHASE_LABEL[m.phase] || "")}</b><span class="tl-date">${fmtDate(m.created_at)}</span></div>` +
      `<div class="tl-title">${esc(m.title || "")}</div>` +
      `<div class="tl-ov">${esc(ov)}</div>` +
      `<a class="tl-link" href="history.html?m=${encodeURIComponent(m.bot_id)}">詳細を見る →</a></div>`;
    tl.appendChild(item);
  }

  // 追加ボタン
  $("aiAddBtn").addEventListener("click", async () => {
    const text = $("aiNew").value.trim();
    if (!text) return;
    await fetch("/api/action-items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account, text, due: $("aiDue").value || null }),
    });
    $("aiNew").value = ""; $("aiDue").value = "";
    loadActions(account);
  });
  $("aiNew").addEventListener("keydown", (e) => { if (e.key === "Enter") $("aiAddBtn").click(); });

  loadActions(account);
}

async function loadActions(account) {
  const box = $("aiBox");
  if (!box) return;
  try {
    const d = await (await fetch("/api/action-items?account=" + encodeURIComponent(account))).json();
    const items = d.items || [];
    const open = items.filter((i) => !i.done);
    const done = items.filter((i) => i.done);
    if (!items.length) {
      box.innerHTML = '<div class="empty-state">やることはまだありません。商談を重ねると、AIが抽出した「宿題」もここに自動で入ります。</div>';
      return;
    }
    box.innerHTML = renderActions(open) + (done.length ? `<div class="ai-done-h">完了（${done.length}）</div>` + renderActions(done) : "");
    box.querySelectorAll(".ai-item").forEach((row) => {
      const id = row.dataset.id;
      row.querySelector(".ai-chk").addEventListener("change", async (e) => {
        await fetch("/api/action-items/" + id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ done: e.target.checked }) });
        loadActions(account);
      });
      const del = row.querySelector(".ai-del");
      if (del) del.addEventListener("click", async () => {
        if (!confirm("削除しますか？")) return;
        await fetch("/api/action-items/" + id, { method: "DELETE" });
        loadActions(account);
      });
    });
  } catch {
    box.innerHTML = '<div class="empty-state">読み込みに失敗しました。</div>';
  }
}

function renderActions(list) {
  return list
    .map((i) => {
      const overdue = i.due_date && !i.done && new Date(i.due_date) < new Date(new Date().toDateString());
      const due = i.due_date ? `<span class="ai-due ${overdue ? "over" : ""}">期限 ${new Date(i.due_date).toLocaleDateString("ja-JP")}</span>` : "";
      const src = i.source === "ai" ? '<span class="ai-src">AI抽出</span>' : "";
      return (
        `<div class="ai-item ${i.done ? "done" : ""}" data-id="${i.id}">` +
        `<label class="ai-chk-wrap"><input type="checkbox" class="ai-chk" ${i.done ? "checked" : ""} /></label>` +
        `<div class="ai-text">${esc(i.text)}${src}${due}</div>` +
        `<button class="ai-del" title="削除">🗑</button>` +
        `</div>`
      );
    })
    .join("");
}

$("fOwner").addEventListener("change", renderList);
$("fSearch").addEventListener("input", renderList);
load();
