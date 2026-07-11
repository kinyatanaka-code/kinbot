// public/settings.js
const $ = (id) => document.getElementById(id);

async function load() {
  try {
    const res = await fetch("/api/settings");
    const data = await res.json();
    const s = data.settings || {};
    $("botName").value = s.botName || "";
    $("repName").value = s.repName || "";
    $("languageCode").value = s.languageCode || "ja";
    $("transcribeProvider").value = s.transcribeProvider || "recallai";
    $("deepgramModel").value = s.deepgramModel || "nova-2";
    $("analyzeIntervalSec").value = Math.round((s.analyzeIntervalMs || 20000) / 1000);
    $("calendarFilter").value = s.calendarFilter || "";

    const st = data.status || {};
    $("statusTable").innerHTML = `
      <tr><td>要約エンジン</td><td>${st.llmProvider || "-"}（${st.llmModel || "-"}）</td></tr>
      <tr><td>履歴の保存(DB)</td><td>${st.dbEnabled ? "有効" : "無効（DATABASE_URL未設定）"}</td></tr>
      <tr><td>ライブ映像配信(Mux)</td><td id="muxStatusCell">${st.muxConfigured ? "確認中…" : "未設定（MUX_TOKEN_ID/SECRET未設定）"}</td></tr>
      <tr><td>公開URL</td><td>${st.publicUrl || "-"}</td></tr>`;
    if (st.muxConfigured) {
      try {
        const mx = await (await fetch("/api/mux/status")).json();
        const cell = document.getElementById("muxStatusCell");
        if (cell) cell.textContent = mx.ok ? "有効（接続OK）" : "キーが無効の可能性: " + (mx.error || "認証エラー");
      } catch {}
    }
  } catch {
    $("persistNote").textContent = "設定の読み込みに失敗しました。";
  }
}

$("saveBtn").addEventListener("click", async () => {
  const body = {
    botName: $("botName").value.trim(),
    repName: $("repName").value.trim(),
    languageCode: $("languageCode").value,
    transcribeProvider: $("transcribeProvider").value,
    deepgramModel: $("deepgramModel").value.trim() || "nova-2",
    analyzeIntervalMs: (Number($("analyzeIntervalSec").value) || 20) * 1000,
  };
  try {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const r = await res.json();
    $("saved").hidden = false;
    setTimeout(() => ($("saved").hidden = true), 1500);
    $("persistNote").textContent = r.persisted
      ? "保存しました（次回の入室から反映）。"
      : "一時保存しました。永続化には DATABASE_URL（Postgres）の設定が必要です。再起動で消えます。";
  } catch {
    $("persistNote").textContent = "保存に失敗しました。";
  }
});

async function loadCalendar() {
  const statusEl = $("calStatus");
  const connectBtn = $("calConnect");
  const disconnectBtn = $("calDisconnect");
  const eventsEl = $("calEvents");
  const gsCal = $("gsCalendar");
  const gsDrive = $("gsDrive");
  try {
    const res = await fetch("/api/calendar/status");
    const d = await res.json();
    if (!d.configured) {
      statusEl.textContent = "未設定（GOOGLE_CLIENT_ID / SECRET が必要）";
      eventsEl.innerHTML = "";
      if (gsCal) gsCal.textContent = "—";
      if (gsDrive) gsDrive.textContent = "—";
      return;
    }
    // カレンダー/ドライブの個別状態
    if (gsCal) gsCal.textContent = d.connected ? (d.error ? "権限エラー" : "連携済み") : "未連携";
    if (gsDrive) {
      gsDrive.textContent = "確認中…";
      fetch("/api/drive/status")
        .then((r) => r.json())
        .then((ds) => {
          if (gsDrive) gsDrive.textContent = !ds.googleConnected ? "未連携" : ds.driveReady ? "連携済み" : "未許可（再連携が必要）";
        })
        .catch(() => { if (gsDrive) gsDrive.textContent = "確認失敗"; });
    }
    if (d.connected) {
      connectBtn.hidden = true;
      disconnectBtn.hidden = false;
      if (d.error) {
        statusEl.textContent = "連携済み（権限エラー）";
        statusEl.classList.remove("ok");
        eventsEl.innerHTML = `<li><span class="ev-when">エラー: ${escapeHtml(d.error)}<br>「解除」→「連携する」でやり直し、Googleの画面で<b>カレンダー閲覧の許可にチェック</b>を入れてください。</span></li>`;
        return;
      }
      statusEl.textContent = d.email ? `連携済み（${d.email}）` : "連携済み（アカウント取得中…再連携で表示されます）";
      statusEl.classList.add("ok");
      const evs = d.events || [];
      eventsEl.innerHTML = evs.length
        ? evs
            .map((e) => {
              const when = new Date(e.start).toLocaleString("ja-JP", {
                hour: "2-digit",
                minute: "2-digit",
              });
              const done = new Date(e.start).getTime() < Date.now();
              return `<li><span>${escapeHtml(e.title)} <span class="badge">Zoom</span></span><span class="ev-when">${when}${done ? "（済）" : " 入室予定"}</span></li>`;
            })
            .join("")
        : '<li><span class="ev-when">今日、Zoomリンク付きの予定はありません。</span></li>';
    } else {
      statusEl.textContent = "未連携";
      statusEl.classList.remove("ok");
      connectBtn.hidden = false;
      disconnectBtn.hidden = true;
      eventsEl.innerHTML = "";
    }
  } catch {
    statusEl.textContent = "状態の取得に失敗しました";
  }
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
document.getElementById("calDisconnect").addEventListener("click", async () => {
  await fetch("/api/calendar/disconnect", { method: "POST" });
  loadCalendar();
});

load();
loadCalendar();

// ---- 登録リンク ----
let links = [];
async function loadLinks() {
  try {
    const res = await fetch("/api/links");
    const d = await res.json();
    links = Array.isArray(d.links) ? d.links : [];
  } catch {
    links = [];
  }
  renderLinks();
}
function renderLinks() {
  const list = $("linkList");
  if (!links.length) {
    list.innerHTML = '<li class="empty-state">まだ登録がありません。</li>';
    return;
  }
  list.innerHTML = "";
  links.forEach((l, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="ln-name"></span><span class="ln-url"></span><button class="ln-del" data-i="${i}">削除</button>`;
    li.querySelector(".ln-name").textContent = l.name;
    li.querySelector(".ln-url").textContent = l.url;
    li.querySelector(".ln-del").addEventListener("click", async () => {
      links.splice(i, 1);
      await saveLinks();
    });
    list.appendChild(li);
  });
}
async function saveLinks() {
  try {
    const res = await fetch("/api/links", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ links }),
    });
    const d = await res.json();
    links = d.links || links;
  } catch {}
  renderLinks();
}
$("addLinkBtn").addEventListener("click", async () => {
  const name = $("newLinkName").value.trim();
  const url = $("newLinkUrl").value.trim();
  if (!name || !url) return;
  links.push({ name, url });
  $("newLinkName").value = "";
  $("newLinkUrl").value = "";
  await saveLinks();
});
loadLinks();

// ===== 御礼メールの例文（ラウンド別） =====
const THANKS_ROUNDS = [
  { key: "1", label: "1回目の商談" },
  { key: "2", label: "2回目の商談" },
  { key: "3", label: "3回目の商談" },
];
let thanksData = {};

function renderThanksEditor() {
  const root = document.getElementById("thanksEditor");
  if (!root) return;
  root.innerHTML = "";
  for (const r of THANKS_ROUNDS) {
    const list = Array.isArray(thanksData[r.key]) ? thanksData[r.key] : [];
    const block = document.createElement("div");
    block.className = "thanks-round";
    block.innerHTML = `<div class="thanks-round-head">${r.label}（例文 ${list.length}件）</div><div class="thanks-list"></div><button type="button" class="btn ghost thanks-add">＋例を追加</button>`;
    const listEl = block.querySelector(".thanks-list");
    const addOne = (val) => {
      const row = document.createElement("div");
      row.className = "thanks-ex";
      row.innerHTML = `<textarea rows="5" placeholder="過去に送ったお礼メールを貼り付け"></textarea><button type="button" class="btn ghost thanks-del">削除</button>`;
      row.querySelector("textarea").value = val || "";
      row.querySelector(".thanks-del").addEventListener("click", () => row.remove());
      listEl.appendChild(row);
    };
    list.forEach((v) => addOne(v));
    block.querySelector(".thanks-add").addEventListener("click", () => addOne(""));
    root.appendChild(block);
  }
}
async function loadThanks() {
  try {
    thanksData = await (await fetch("/api/thanks-examples")).json();
    if (!thanksData || typeof thanksData !== "object") thanksData = {};
  } catch {
    thanksData = {};
  }
  renderThanksEditor();
}
function collectThanks() {
  const root = document.getElementById("thanksEditor");
  const out = {};
  const blocks = root.querySelectorAll(".thanks-round");
  blocks.forEach((block, i) => {
    const key = THANKS_ROUNDS[i].key;
    const vals = [...block.querySelectorAll("textarea")].map((t) => t.value.trim()).filter(Boolean);
    if (vals.length) out[key] = vals;
  });
  return out;
}
const saveThanksBtn = document.getElementById("saveThanksBtn");
if (saveThanksBtn) {
  saveThanksBtn.addEventListener("click", async () => {
    thanksData = collectThanks();
    try {
      await fetch("/api/thanks-examples", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ examples: thanksData }),
      });
      const s = document.getElementById("thanksSaved");
      s.hidden = false;
      setTimeout(() => (s.hidden = true), 1500);
      renderThanksEditor();
    } catch {}
  });
}
loadThanks();

// ===== メニュー切替 =====
(function () {
  const menu = document.getElementById("setMenu");
  if (!menu) return;
  menu.querySelectorAll(".set-menu-item").forEach((item) => {
    item.addEventListener("click", () => {
      menu.querySelectorAll(".set-menu-item").forEach((t) => t.classList.toggle("active", t === item));
      const name = item.dataset.tab;
      document.querySelectorAll(".set-pane").forEach((p) => (p.hidden = p.dataset.pane !== name));
      if (name === "teams") loadTeams();
      if (name === "knowledge") loadKnowledge();
      if (name === "interns") { loadInterns(); loadApoOwner(); loadApoInvite(); }
      if (name === "thanks") loadThanksPrompt();
      if (name === "integrations") showIntegGrid();
      if (name === "smartlinks") initSmartLinks();
    });
  });
})();

// ===== 連携タブ：アイコングリッド ⇄ 各連携の詳細 =====
function showIntegGrid() {
  const grid = document.getElementById("integGrid");
  const detail = document.getElementById("integDetail");
  if (grid) grid.hidden = false;
  if (detail) detail.hidden = true;
  document.querySelectorAll(".set-pane-inner").forEach((p) => (p.hidden = true));
  refreshIntegStates();
}
function showIntegDetail(name) {
  const grid = document.getElementById("integGrid");
  const detail = document.getElementById("integDetail");
  if (grid) grid.hidden = true;
  if (detail) detail.hidden = false;
  document.querySelectorAll(".set-pane-inner").forEach((p) => (p.hidden = p.dataset.integ !== name));
  if (name === "status") { loadIntegrations(); loadRecallStatus(); }
  if (name === "claudecode") { fillApiBaseUrl(); initCcToken(); }
  if (name === "chatgpt") { initGptConnector(); }
}
(function () {
  const grid = document.getElementById("integGrid");
  if (grid) {
    grid.querySelectorAll(".integ-card").forEach((card) => {
      card.addEventListener("click", () => showIntegDetail(card.dataset.integ));
    });
  }
  const back = document.getElementById("integBack");
  if (back) back.addEventListener("click", showIntegGrid);
})();
// 各連携カードに、接続済み/未接続の状態バッジを反映する
async function refreshIntegStates() {
  // Google連携
  try {
    const r = await fetch("/api/calendar/status");
    if (r.ok) {
      const d = await r.json();
      setIntegState("calendar", d && d.connected ? "連携済み" : "未連携", d && d.connected);
    }
  } catch {}
  // Salesforce連携
  try {
    const r = await fetch("/api/salesforce/status");
    if (r.ok) {
      const d = await r.json();
      setIntegState("salesforce", d && d.connected ? "連携済み" : "未連携", d && d.connected);
    }
  } catch {}
  // Notion連携（自分専用）
  try {
    const r = await fetch("/api/notion/config");
    if (r.ok) {
      const d = await r.json();
      setIntegState("notion", d && d.configured ? "連携済み" : "未連携", d && d.configured);
    }
  } catch {}
}
function setIntegState(key, label, ok) {
  const el = document.getElementById(`integState-${key}`);
  if (!el) return;
  el.textContent = label;
  el.classList.toggle("integ-state-connected", !!ok);
}

// Claude Code連携カードのベースURLを、このアプリの実URLで埋める
function fillApiBaseUrl() {
  const origin = window.location.origin;
  const head = document.getElementById("apiBaseUrl");
  if (head) head.textContent = origin;
  document.querySelectorAll(".apidoc-base").forEach((el) => { el.textContent = origin; });
}

// APIトークンをこのブラウザに保存し、コード例に差し込む（サーバーには送らない）
const CC_TOKEN_KEY = "kinbot_api_token";
function applyCcToken(tok) {
  const t = tok && tok.trim() ? tok.trim() : "";
  document.querySelectorAll(".cc-tok").forEach((el) => {
    if (t) el.textContent = t;
    else el.innerHTML = "&lt;トークン&gt;";
  });
}
function initCcToken() {
  fillApiBaseUrl();
  // みんな用の管理者コネクタURL（固定値・HTMLに直接記載）のコピー機能
  const mcpAdminEl = document.getElementById("mcpUrlAdmin");
  const mcpAdminCopyBtn = document.getElementById("mcpUrlAdminCopy");
  if (mcpAdminCopyBtn && !mcpAdminCopyBtn._wired) {
    mcpAdminCopyBtn._wired = true;
    mcpAdminCopyBtn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(mcpAdminEl.textContent.trim()); mcpAdminCopyBtn.textContent = "コピーしました"; } catch { mcpAdminCopyBtn.textContent = "コピーに失敗しました"; }
      setTimeout(() => (mcpAdminCopyBtn.textContent = "URLをコピー"), 1500);
    });
  }
  const input = document.getElementById("ccToken");
  if (!input) return;
  let saved = "";
  try { saved = localStorage.getItem(CC_TOKEN_KEY) || ""; } catch {}
  input.value = saved;
  applyCcToken(saved);
  if (input._wired) return;
  input._wired = true;
  const showBtn = document.getElementById("ccTokenShow");
  if (showBtn) showBtn.addEventListener("click", () => {
    input.type = input.type === "password" ? "text" : "password";
    showBtn.textContent = input.type === "password" ? "表示" : "隠す";
  });
  const saveBtn = document.getElementById("ccTokenSave");
  if (saveBtn) saveBtn.addEventListener("click", () => {
    const v = (input.value || "").trim();
    try { localStorage.setItem(CC_TOKEN_KEY, v); } catch {}
    applyCcToken(v);
    saveBtn.textContent = "保存しました";
    setTimeout(() => (saveBtn.textContent = "保存"), 1200);
  });
  const clearBtn = document.getElementById("ccTokenClear");
  if (clearBtn) clearBtn.addEventListener("click", () => {
    input.value = "";
    try { localStorage.removeItem(CC_TOKEN_KEY); } catch {}
    applyCcToken("");
  });
}

// ===== ChatGPT（Custom GPT）連携カード =====
// ボタンにコピー機能を割り当てる（クリック→クリップボードへコピー→一時的にラベル変更）
function wireCopyBtn(btnId, getText, doneLabel, defaultLabel) {
  const btn = document.getElementById(btnId);
  if (!btn || btn._wired) return;
  btn._wired = true;
  btn.addEventListener("click", async () => {
    try {
      const text = await getText();
      await navigator.clipboard.writeText(text);
      btn.textContent = doneLabel;
    } catch {
      btn.textContent = "コピーに失敗しました";
    }
    setTimeout(() => (btn.textContent = defaultLabel), 1500);
  });
}
function initGptConnector() {
  // ① スキーマURL、② トークンは固定値（HTMLに直接記載）をそのままコピー
  wireCopyBtn("gptSchemaUrlCopy",
    () => document.getElementById("gptSchemaUrl").textContent.trim(),
    "コピーしました", "URLをコピー");
  wireCopyBtn("gptTokenCopy",
    () => document.getElementById("gptToken").textContent.trim(),
    "コピーしました", "トークンをコピー");
  // スキーマ全文は、公開URLから取得してコピー（HTMLに全文を持たない＝単一の元ファイル）
  const schemaBtn = document.getElementById("gptSchemaCopy");
  const schemaNote = document.getElementById("gptSchemaCopyNote");
  if (schemaBtn && !schemaBtn._wired) {
    schemaBtn._wired = true;
    schemaBtn.addEventListener("click", async () => {
      const prev = schemaBtn.textContent;
      schemaBtn.textContent = "取得中…";
      try {
        const url = document.getElementById("gptSchemaUrl").textContent.trim();
        const res = await fetch(url);
        if (!res.ok) throw new Error("fetch failed");
        const text = await res.text();
        await navigator.clipboard.writeText(text);
        schemaBtn.textContent = "コピーしました";
        if (schemaNote) schemaNote.textContent = "";
      } catch {
        schemaBtn.textContent = prev;
        if (schemaNote) schemaNote.textContent = "取得に失敗しました。上の①のURLをブラウザで開いて全文をコピーしてください。";
      }
      setTimeout(() => (schemaBtn.textContent = "スキーマ全文をコピー"), 1500);
    });
  }
}

// ===== 接続している外部API一覧 =====
async function loadIntegrations() {
  const host = document.getElementById("integrationsList");
  if (!host) return;
  host.innerHTML = '<div class="empty-state">読み込み中…</div>';
  try {
    const d = await (await fetch("/api/integrations")).json();
    const svcs = d.services || [];
    const billable = svcs.filter((s) => s.billable);
    const free = svcs.filter((s) => !s.billable);
    const row = (s) => {
      const status = !s.configured
        ? '<span class="integ-badge off">未設定</span>'
        : s.inUse
          ? '<span class="integ-badge on">接続中</span>'
          : '<span class="integ-badge idle">キーあり（未使用）</span>';
      const key = s.configured && s.keyLast4 ? `<span class="integ-key">****${escapeHtml(s.keyLast4)}</span>` : "";
      const dash = s.dashboardUrl ? `<a class="integ-link" href="${escapeHtml(s.dashboardUrl)}" target="_blank" rel="noopener">請求 ›</a>` : "";
      return `<div class="integ-row">` +
        `<div class="integ-main"><div class="integ-name">${escapeHtml(s.name)} ${status}</div>` +
        `<div class="integ-sub">${escapeHtml(s.role || "")}${s.detail ? " ・ " + escapeHtml(s.detail) : ""}</div></div>` +
        `<div class="integ-right">${key}${dash}</div></div>`;
    };
    let html = "";
    html += `<div class="integ-group-title">課金が発生するAPI</div>`;
    html += billable.map(row).join("") || '<div class="empty-state">なし</div>';
    if (free.length) {
      html += `<div class="integ-group-title">無料の連携</div>`;
      html += free.map(row).join("");
    }
    host.innerHTML = html;
  } catch {
    host.innerHTML = '<div class="empty-state">一覧の取得に失敗しました。</div>';
  }
}
(function () {
  const btn = document.getElementById("integReload");
  if (btn && !btn._wired) { btn._wired = true; btn.addEventListener("click", loadIntegrations); }
})();

// ===== Recall接続状況 =====
function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}時間${m}分`;
  if (m > 0) return `${m}分`;
  return `${sec}秒`;
}
async function loadRecallStatus() {
  const host = document.getElementById("recallStatus");
  if (!host) return;
  host.innerHTML = '<div class="empty-state">読み込み中…</div>';
  try {
    const d = await (await fetch("/api/recall/status")).json();
    const link = document.getElementById("recallDashLink");
    if (link && d.dashboardUrl) link.href = d.dashboardUrl;

    // 直近のボット起動結果（残高不足などをはっきり出す）
    let alert = "";
    const lc = d.lastCreate;
    if (lc && !lc.ok) {
      const is402 = lc.status === 402 || /credit/i.test(lc.code || "");
      alert = `<div class="recall-alert ${is402 ? "bad" : "warn"}">` +
        (is402
          ? "直近のボット起動が<b>残高不足（402）で失敗</b>しています。下の「接続先」がチャージしたRecallアカウントと一致しているか確認してください。"
          : `直近のボット起動が失敗しています（${escapeHtml(String(lc.status || ""))} ${escapeHtml(lc.code || "")}）。`) +
        `<div class="recall-alert-time">${lc.at ? new Date(lc.at).toLocaleString() : ""}</div></div>`;
    } else if (lc && lc.ok) {
      alert = `<div class="recall-alert ok">直近のボット起動は成功しています（${lc.at ? new Date(lc.at).toLocaleString() : ""}）。</div>`;
    }

    let usageHtml;
    if (d.usage) {
      usageHtml = `<b>${fmtDuration(d.usage.botTotalSeconds)}</b>（今月）`;
    } else {
      const is402 = /402/.test(d.usageError || "");
      const is401 = /401/.test(d.usageError || "");
      usageHtml = `<span class="recall-err">${is402 ? "残高不足の可能性（402）" : is401 ? "APIキーが無効（401）" : "取得できませんでした"}</span>`;
    }

    host.innerHTML = alert +
      `<table class="status-table recall-table">` +
      `<tr><th>接続リージョン</th><td>${escapeHtml(d.regionLabel || d.region || "-")}</td></tr>` +
      `<tr><th>APIキー</th><td>${d.keyPresent ? "設定あり（末尾 ****" + escapeHtml(d.keyLast4 || "") + "）" : '<span class="recall-err">未設定</span>'}</td></tr>` +
      `<tr><th>今月の録音利用時間</th><td>${usageHtml}</td></tr>` +
      `</table>`;
  } catch (e) {
    host.innerHTML = '<div class="empty-state">接続状況の取得に失敗しました。</div>';
  }
}
(function () {
  const btn = document.getElementById("recallStatusReload");
  if (btn && !btn._wired) { btn._wired = true; btn.addEventListener("click", loadRecallStatus); }
})();

// ===== 担当者→チーム マッピング編集 =====
let teamsCache = [];
async function loadTeams() {
  const tbl = document.getElementById("tmTable");
  if (!tbl) return;
  tbl.innerHTML = '<tr><td class="note">読み込み中…</td></tr>';
  let reps = [], users = [];
  try { teamsCache = await (await fetch("/api/teams")).json(); } catch { teamsCache = []; }
  try { reps = await (await fetch("/api/teams/reps")).json(); } catch { reps = []; }
  try { users = await (await fetch("/api/users")).json(); } catch { users = []; }
  // 候補（担当者名）：判定実績 + ユーザー名
  const nameSet = new Set();
  (reps || []).forEach((r) => r.rep_name && nameSet.add(r.rep_name));
  (users || []).forEach((u) => (u.name || u.email) && nameSet.add(u.name || u.email));
  const repList = document.getElementById("tmRepList");
  if (repList) repList.innerHTML = [...nameSet].map((n) => `<option value="${escapeHtml(n)}">`).join("");
  const teamList = document.getElementById("tmTeamList");
  if (teamList) teamList.innerHTML = [...new Set(teamsCache.map((t) => t.team_name))].map((n) => `<option value="${escapeHtml(n)}">`).join("");
  // 未マッピングの担当者（判定実績はあるがマッピングが無い）
  const mapped = new Set(teamsCache.map((t) => t.rep_name));
  const unmapped = (reps || []).filter((r) => !mapped.has(r.rep_name));
  const um = document.getElementById("tmUnmapped");
  if (um) {
    if (unmapped.length) {
      um.innerHTML = `<div class="tm-unmapped"><b>未割り当ての担当者</b>（フェーズ分析で「未分類」に入っています。クリックで上の入力欄に取り込み）<div class="tm-chips">` +
        unmapped.map((r) => `<button type="button" class="tm-chip" data-rep="${escapeHtml(r.rep_name)}">${escapeHtml(r.rep_name)}（${r.n}件）</button>`).join("") +
        `</div></div>`;
      um.querySelectorAll(".tm-chip").forEach((b) =>
        b.addEventListener("click", () => { document.getElementById("tmRep").value = b.dataset.rep; document.getElementById("tmTeam").focus(); })
      );
    } else um.innerHTML = "";
  }
  // 一覧テーブル
  if (!teamsCache.length) {
    tbl.innerHTML = '<tr><td class="note">まだ登録がありません。上の入力欄から追加してください。</td></tr>';
    return;
  }
  tbl.innerHTML =
    "<tr><th>担当者</th><th>チーム</th><th>グループ</th><th></th></tr>" +
    teamsCache.map((t) =>
      `<tr><td>${escapeHtml(t.rep_name)}</td><td>${escapeHtml(t.team_name)}</td><td>${escapeHtml(t.group_name)}</td>` +
      `<td><button class="btn ghost tm-edit" data-rep="${escapeHtml(t.rep_name)}" data-team="${escapeHtml(t.team_name)}" data-group="${escapeHtml(t.group_name)}">編集</button> ` +
      `<button class="btn danger tm-del" data-rep="${escapeHtml(t.rep_name)}">削除</button></td></tr>`
    ).join("");
  tbl.querySelectorAll(".tm-edit").forEach((b) =>
    b.addEventListener("click", () => {
      document.getElementById("tmRep").value = b.dataset.rep;
      document.getElementById("tmTeam").value = b.dataset.team;
      document.getElementById("tmGroup").value = b.dataset.group;
      document.getElementById("tmRep").focus();
    })
  );
  tbl.querySelectorAll(".tm-del").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm(`「${b.dataset.rep}」のマッピングを削除しますか？`)) return;
      await fetch("/api/teams/" + encodeURIComponent(b.dataset.rep), { method: "DELETE" });
      loadTeams();
    })
  );
}
(function () {
  const add = document.getElementById("tmAdd");
  if (!add) return;
  add.addEventListener("click", async () => {
    const repName = (document.getElementById("tmRep").value || "").trim();
    const teamName = (document.getElementById("tmTeam").value || "").trim();
    const groupName = (document.getElementById("tmGroup").value || "").trim() || "直販";
    const st = document.getElementById("tmStatus");
    if (!repName || !teamName) { if (st) st.textContent = "担当者名とチーム名を入れてください"; return; }
    if (st) st.textContent = "保存中…";
    try {
      const r = await fetch("/api/teams", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ rep_name: repName, team_name: teamName, group_name: groupName, product: (document.getElementById("tmProduct") || {}).value || "" }),
      });
      if (!r.ok) throw new Error("保存に失敗");
      if (st) st.textContent = "保存しました";
      document.getElementById("tmRep").value = "";
      document.getElementById("tmTeam").value = "";
      document.getElementById("tmGroup").value = "";
      loadTeams();
      setTimeout(() => { if (st) st.textContent = ""; }, 1500);
    } catch (e) { if (st) st.textContent = "失敗: " + e.message; }
  });
})();

// ===== カレンダー照合の代表者 =====
async function loadApoOwner() {
  const sel = document.getElementById("apoOwnerSel");
  if (!sel) return;
  try {
    const d = await (await fetch("/api/apo-calendar-owner")).json();
    sel.innerHTML = '<option value="">（未設定：押した本人の連携を使う）</option>';
    for (const c of d.candidates || []) {
      const o = document.createElement("option");
      o.value = c.owner;
      o.textContent = c.email ? `${c.owner}（${c.email}）` : c.owner;
      sel.appendChild(o);
    }
    sel.value = d.owner || "";
    const st = document.getElementById("apoOwnerStatus");
    if (st) st.textContent = d.owner ? (d.connected ? "連携OK" : "⚠ この人のGoogle連携が切れています") : "";
  } catch {}
}
(function () {
  const btn = document.getElementById("apoOwnerSave");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const sel = document.getElementById("apoOwnerSel");
    const st = document.getElementById("apoOwnerStatus");
    try {
      const r = await fetch("/api/apo-calendar-owner", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: sel.value }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "保存に失敗しました");
      if (st) { st.textContent = "保存しました"; setTimeout(() => (st.textContent = ""), 1800); }
    } catch (e) { if (st) st.textContent = e.message; }
  });
})();

// ===== 商談予定の自動作成（招待方式）=====
async function loadApoInvite() {
  const sel = document.getElementById("apoInviteOwnerSel");
  if (!sel) return;
  try {
    const d = await (await fetch("/api/apo-invite-config")).json();
    sel.innerHTML = '<option value="">（未設定：自動作成しない）</option>';
    for (const c of d.candidates || []) {
      const o = document.createElement("option");
      o.value = c.owner;
      o.textContent = c.email ? `${c.owner}（${c.email}）` : c.owner;
      sel.appendChild(o);
    }
    sel.value = d.owner || "";
    const cal = document.getElementById("apoInviteCal");
    if (cal) cal.value = d.calendar_id || "";
    const auto = document.getElementById("apoAutoInvite");
    if (auto) auto.checked = d.auto !== false;
    const st = document.getElementById("apoInviteStatus");
    if (st) st.textContent = d.owner ? (d.connected ? "連携OK" : "⚠ この人のGoogle連携が切れています") : "";
  } catch {}
}
(function () {
  const btn = document.getElementById("apoInviteSave");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const st = document.getElementById("apoInviteStatus");
    try {
      const r = await fetch("/api/apo-invite-config", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          owner: document.getElementById("apoInviteOwnerSel").value,
          calendar_id: document.getElementById("apoInviteCal").value,
          auto: document.getElementById("apoAutoInvite").checked,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "保存に失敗しました");
      if (st) { st.textContent = "保存しました"; setTimeout(() => (st.textContent = ""), 1800); }
    } catch (e) { if (st) st.textContent = e.message; }
  });
})();

// ===== インターン生（アポ獲得者）=====
async function loadInterns() {
  const tbl = document.getElementById("inTable");
  if (!tbl) return;
  tbl.innerHTML = '<tr><td class="note">読み込み中…</td></tr>';
  let list = [];
  try { list = await (await fetch("/api/interns")).json(); } catch { list = []; }
  if (!list.length) {
    tbl.innerHTML = '<tr><td class="note">まだ登録がありません。上の入力欄から追加してください。</td></tr>';
    return;
  }
  tbl.innerHTML =
    "<tr><th>名前</th><th>メールアドレス</th><th></th></tr>" +
    list.map((it) =>
      `<tr><td>${escapeHtml(it.name)}</td><td>${escapeHtml(it.email)}</td>` +
      `<td><button class="btn ghost in-edit" data-name="${escapeHtml(it.name)}" data-email="${escapeHtml(it.email)}">編集</button> ` +
      `<button class="btn danger in-del" data-email="${escapeHtml(it.email)}" data-name="${escapeHtml(it.name)}">削除</button></td></tr>`
    ).join("");
  tbl.querySelectorAll(".in-edit").forEach((b) =>
    b.addEventListener("click", () => {
      document.getElementById("inName").value = b.dataset.name;
      document.getElementById("inEmail").value = b.dataset.email;
      document.getElementById("inName").focus();
    })
  );
  tbl.querySelectorAll(".in-del").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm(`「${b.dataset.name}」を削除しますか？`)) return;
      await fetch("/api/interns/" + encodeURIComponent(b.dataset.email), { method: "DELETE" });
      loadInterns();
    })
  );
}
(function () {
  const add = document.getElementById("inAdd");
  if (!add) return;
  add.addEventListener("click", async () => {
    const name = (document.getElementById("inName").value || "").trim();
    const email = (document.getElementById("inEmail").value || "").trim();
    const st = document.getElementById("inStatus");
    if (!name || !email) { if (st) st.textContent = "名前とメールアドレスを入れてください"; return; }
    if (st) st.textContent = "保存中…";
    try {
      const r = await fetch("/api/interns", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "保存に失敗");
      if (st) st.textContent = "保存しました";
      document.getElementById("inName").value = "";
      document.getElementById("inEmail").value = "";
      loadInterns();
      setTimeout(() => { if (st) st.textContent = ""; }, 1500);
    } catch (e) { if (st) st.textContent = "失敗: " + e.message; }
  });
})();

// ===== フェーズ判定の定義（プロンプト）編集 =====
let phasePromptDefault = "";
async function loadPhasePrompt() {
  const ta = document.getElementById("phasePromptText");
  const state = document.getElementById("phasePromptState");
  if (!ta) return;
  ta.value = "読み込み中…";
  try {
    const d = await (await fetch("/api/phase/prompt")).json();
    phasePromptDefault = d.defaultPrompt || "";
    ta.value = d.prompt || "";
    if (state) state.textContent = d.isDefault ? "現在：既定の文面のまま（未編集）" : "現在：カスタム編集済み";
  } catch {
    ta.value = "";
    if (state) state.textContent = "読み込みに失敗しました。";
  }
}
(function () {
  const saveBtn = document.getElementById("phasePromptSave");
  const resetBtn = document.getElementById("phasePromptReset");
  const ta = document.getElementById("phasePromptText");
  const st = document.getElementById("phasePromptStatus");
  const state = document.getElementById("phasePromptState");
  if (!saveBtn || !ta) return;
  saveBtn.addEventListener("click", async () => {
    const text = ta.value;
    if (!text.trim()) { if (st) st.textContent = "空のままでは保存できません（既定に戻す場合は右のボタンを使ってください）"; return; }
    if (st) st.textContent = "保存中…";
    try {
      const r = await fetch("/api/phase/prompt", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: text }),
      });
      if (!r.ok) throw new Error("保存に失敗");
      if (st) st.textContent = "保存しました。次回の判定から反映されます。";
      if (state) state.textContent = text.trim() === phasePromptDefault.trim() ? "現在：既定の文面のまま（未編集）" : "現在：カスタム編集済み";
      setTimeout(() => { if (st) st.textContent = ""; }, 3000);
    } catch (e) { if (st) st.textContent = "失敗: " + e.message; }
  });
  if (resetBtn) resetBtn.addEventListener("click", async () => {
    if (!confirm("カスタム編集を破棄して、既定の文面に戻します。よろしいですか？")) return;
    if (st) st.textContent = "戻しています…";
    try {
      await fetch("/api/phase/prompt", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "" }),
      });
      ta.value = phasePromptDefault;
      if (state) state.textContent = "現在：既定の文面のまま（未編集）";
      if (st) st.textContent = "既定の文面に戻しました";
      setTimeout(() => { if (st) st.textContent = ""; }, 2500);
    } catch (e) { if (st) st.textContent = "失敗: " + e.message; }
  });
})();

// ===== 御礼メール生成プロンプト編集 =====
let thanksPromptDefault = "";
async function loadThanksPrompt() {
  const ta = document.getElementById("thanksPromptText");
  const state = document.getElementById("thanksPromptState");
  if (!ta) return;
  ta.value = "読み込み中…";
  try {
    const d = await (await fetch("/api/thanks-prompt")).json();
    thanksPromptDefault = d.defaultPrompt || "";
    ta.value = d.prompt || "";
    if (state) state.textContent = d.isDefault ? "現在：既定の文面のまま（未編集）" : "現在：カスタム編集済み";
  } catch {
    ta.value = "";
    if (state) state.textContent = "読み込みに失敗しました。";
  }
}
(function () {
  const saveBtn = document.getElementById("thanksPromptSave");
  const resetBtn = document.getElementById("thanksPromptReset");
  const ta = document.getElementById("thanksPromptText");
  const st = document.getElementById("thanksPromptStatus");
  const state = document.getElementById("thanksPromptState");
  if (!saveBtn || !ta) return;
  saveBtn.addEventListener("click", async () => {
    const text = ta.value;
    if (!text.trim()) { if (st) st.textContent = "空のままでは保存できません（既定に戻す場合は右のボタンを使ってください）"; return; }
    if (st) st.textContent = "保存中…";
    try {
      const r = await fetch("/api/thanks-prompt", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: text }),
      });
      if (!r.ok) throw new Error("保存に失敗");
      if (st) st.textContent = "保存しました。次回の生成から反映されます。";
      if (state) state.textContent = text.trim() === thanksPromptDefault.trim() ? "現在：既定の文面のまま（未編集）" : "現在：カスタム編集済み";
      setTimeout(() => { if (st) st.textContent = ""; }, 3000);
    } catch (e) { if (st) st.textContent = "失敗: " + e.message; }
  });
  if (resetBtn) resetBtn.addEventListener("click", async () => {
    if (!confirm("カスタム編集を破棄して、既定の文面に戻します。よろしいですか？")) return;
    if (st) st.textContent = "戻しています…";
    try {
      await fetch("/api/thanks-prompt", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "" }),
      });
      ta.value = thanksPromptDefault;
      if (state) state.textContent = "現在：既定の文面のまま（未編集）";
      if (st) st.textContent = "既定の文面に戻しました";
      setTimeout(() => { if (st) st.textContent = ""; }, 2500);
    } catch (e) { if (st) st.textContent = "失敗: " + e.message; }
  });
})();

// ===== プロンプト設定：サブタブ（自社ナレッジ / チェック項目 / 要約の指示） =====
(function () {
  const bar = document.getElementById("aiSubtabs");
  if (!bar) return;
  bar.querySelectorAll(".subtab").forEach((t) =>
    t.addEventListener("click", () => {
      bar.querySelectorAll(".subtab").forEach((x) => x.classList.toggle("active", x === t));
      const sub = t.dataset.sub;
      document.querySelectorAll('.set-pane[data-pane="ai"] .subpane').forEach((p) => (p.hidden = p.dataset.sub !== sub));
    })
  );
})();

// ===== カレンダーのフィルター文字を保存 =====
const saveCalFilterBtn = document.getElementById("saveCalFilterBtn");
if (saveCalFilterBtn) {
  saveCalFilterBtn.addEventListener("click", async () => {
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ calendarFilter: $("calendarFilter").value.trim() }),
      });
      const s = document.getElementById("calFilterSaved");
      s.hidden = false;
      setTimeout(() => (s.hidden = true), 1500);
    } catch {}
  });
}

// ===== Salesforce 連携 =====
async function loadSalesforce() {
  const statusEl = document.getElementById("sfStatus");
  if (!statusEl) return;
  try {
    const d = await (await fetch("/api/salesforce/status")).json();
    const connect = document.getElementById("sfConnect");
    const disconnect = document.getElementById("sfDisconnect");
    if (!d.configured) {
      statusEl.textContent = "未設定（後日の連携作業で有効化）";
      connect.hidden = true;
      disconnect.hidden = true;
    } else if (d.connected) {
      statusEl.textContent = "連携済み" + (d.sfUser ? "" : "");
      statusEl.classList.add("ok");
      connect.hidden = true;
      disconnect.hidden = false;
    } else {
      statusEl.textContent = "未連携";
      connect.hidden = false;
      disconnect.hidden = true;
    }
    const map = d.mapping || {};
    if (document.getElementById("sfmap_stage")) {
      $("sfmap_stage").value = map.stage || "";
      $("sfmap_nextStep").value = map.nextStep || "";
      $("sfmap_issues").value = map.issues || "";
      $("sfmap_summary").value = map.summary || "";
    }
  } catch {
    statusEl.textContent = "状態の取得に失敗しました";
  }
}
const sfDisconnectBtn = document.getElementById("sfDisconnect");
if (sfDisconnectBtn) {
  sfDisconnectBtn.addEventListener("click", async () => {
    await fetch("/api/salesforce/disconnect", { method: "POST" });
    loadSalesforce();
  });
}
const saveSfMapBtn = document.getElementById("saveSfMapBtn");
if (saveSfMapBtn) {
  saveSfMapBtn.addEventListener("click", async () => {
    const mapping = {
      stage: $("sfmap_stage").value.trim(),
      nextStep: $("sfmap_nextStep").value.trim(),
      issues: $("sfmap_issues").value.trim(),
      summary: $("sfmap_summary").value.trim(),
    };
    try {
      await fetch("/api/salesforce/mapping", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mapping }),
      });
      const s = document.getElementById("sfMapSaved");
      s.hidden = false;
      setTimeout(() => (s.hidden = true), 1500);
    } catch {}
  });
}
loadSalesforce();

// ===== 自社ナレッジ（フォルダ＋ソース追加モーダル） =====
function escapeHtmlKb(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
let kbCurrentFolder = "";
let kbAllFolders = [];
const kbParentOf = (p) => p.split("/").slice(0, -1).join("/");
const kbLeaf = (p) => p.split("/").slice(-1)[0];
const kbCat = () => (document.getElementById("kbInCategory") ? document.getElementById("kbInCategory").value : "資料");
const kbStatus = (t) => { const e = document.getElementById("kbIngestNote"); if (e) e.textContent = t || ""; };

function kbRenderBreadcrumb() {
  const bc = document.getElementById("kbBreadcrumb");
  if (!bc) return;
  const parts = kbCurrentFolder ? kbCurrentFolder.split("/") : [];
  let acc = "";
  let html = `<a href="#" class="kb-crumb" data-path="">📁 ルート</a>`;
  for (const p of parts) {
    acc = acc ? `${acc}/${p}` : p;
    html += ` <span class="kb-crumb-sep">›</span> <a href="#" class="kb-crumb" data-path="${escapeHtmlKb(acc)}">${escapeHtmlKb(p)}</a>`;
  }
  bc.innerHTML = html;
  bc.querySelectorAll(".kb-crumb").forEach((a) =>
    a.addEventListener("click", (e) => { e.preventDefault(); kbCurrentFolder = e.currentTarget.dataset.path; loadKnowledge(); })
  );
}
function kbFolderOptions(selected) {
  const opts = ['<option value="">（ルート）</option>'];
  for (const f of kbAllFolders) opts.push(`<option value="${escapeHtmlKb(f)}"${f === selected ? " selected" : ""}>${escapeHtmlKb(f)}</option>`);
  return opts.join("");
}

async function loadKnowledge() {
  const list = document.getElementById("kbList");
  const folders = document.getElementById("kbFolders");
  if (!list) return;
  try {
    const [items, fids] = await Promise.all([
      (await fetch("/api/knowledge")).json(),
      (await fetch("/api/knowledge/folders")).json(),
    ]);
    kbAllFolders = Array.isArray(fids) ? fids : [];
    kbRenderBreadcrumb();

    if (folders) {
      const subs = kbAllFolders.filter((f) => kbParentOf(f) === kbCurrentFolder);
      folders.innerHTML = "";
      for (const f of subs) {
        const count = items.filter((it) => (it.folder || "") === f || (it.folder || "").startsWith(f + "/")).length;
        const li = document.createElement("li");
        li.className = "kb-folder";
        li.innerHTML =
          `<button class="kb-folder-open" data-path="${escapeHtmlKb(f)}">📁 ${escapeHtmlKb(kbLeaf(f))} <span class="kb-folder-count">${count}</span></button>` +
          `<button class="kb-folder-del" data-path="${escapeHtmlKb(f)}" title="フォルダを削除">🗑</button>`;
        li.querySelector(".kb-folder-open").addEventListener("click", (e) => { kbCurrentFolder = e.currentTarget.dataset.path; loadKnowledge(); });
        li.querySelector(".kb-folder-del").addEventListener("click", async (e) => {
          const path = e.currentTarget.dataset.path;
          if (!confirm(`フォルダ「${kbLeaf(path)}」を削除しますか？（空の場合のみ）`)) return;
          const r = await fetch("/api/knowledge/folders", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
          if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || "削除できませんでした"); }
          loadKnowledge();
        });
        folders.appendChild(li);
      }
    }

    const here = items.filter((it) => (it.folder || "") === kbCurrentFolder);
    list.innerHTML = "";
    if (!here.length) list.innerHTML = '<li class="kb-empty">このフォルダには資料がありません。「＋ ソースを追加」から取り込めます。</li>';
    for (const it of here) {
      const li = document.createElement("li");
      li.className = "kb-item";
      const srcLabel = { pdf: "PDF", url: "URL", video: "動画", gdrive: "Drive", image: "画像", text: "手入力" }[it.source_type] || "手入力";
      const ref = it.source_ref && it.source_type === "url"
        ? `<a class="kb-src" href="${escapeHtmlKb(it.source_ref)}" target="_blank" rel="noopener">${escapeHtmlKb(srcLabel)}</a>`
        : `<span class="kb-src">${srcLabel}</span>`;
      li.innerHTML =
        `<div class="kb-item-head"><span class="kb-cat">${escapeHtmlKb(it.category)}</span>` +
        ref +
        `<b>${escapeHtmlKb(it.title)}</b>` +
        `<select class="kb-move" title="フォルダを移動">${kbFolderOptions(it.folder || "")}</select>` +
        `<button class="kb-del" data-id="${it.id}">削除</button></div>` +
        `<div class="kb-body">${escapeHtmlKb(it.body || "")}</div>`;
      li.querySelector(".kb-del").addEventListener("click", async (e) => {
        if (!confirm("このナレッジを削除しますか？")) return;
        await fetch("/api/knowledge/" + e.currentTarget.dataset.id, { method: "DELETE" });
        loadKnowledge();
      });
      li.querySelector(".kb-move").addEventListener("change", async (e) => {
        await fetch("/api/knowledge/" + it.id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ folder: e.currentTarget.value }) });
        loadKnowledge();
      });
      list.appendChild(li);
    }
  } catch {
    list.innerHTML = '<li class="kb-empty">読み込みに失敗しました。</li>';
  }
}

// 新規フォルダ
(function () {
  const btn = document.getElementById("kbNewFolderBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const name = (prompt("新しいフォルダ名") || "").trim();
    if (!name) return;
    if (/[\/"'\\]/.test(name)) return alert("/ \" ' \\ は使えません");
    const path = kbCurrentFolder ? `${kbCurrentFolder}/${name}` : name;
    await fetch("/api/knowledge/folders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
    loadKnowledge();
  });
})();

// 再インデックス
(function () {
  const btn = document.getElementById("kbReindexBtn");
  const note = document.getElementById("kbReindexNote");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true; const o = btn.textContent; btn.textContent = "再構築中…";
    if (note) { note.hidden = false; note.textContent = "ナレッジを検索用に処理しています…"; }
    try {
      const d = await (await fetch("/api/knowledge/reindex", { method: "POST" })).json();
      if (note) note.textContent = `${d.count}件を再構築しました。` + (d.embeddings ? "（ベクトル検索が有効）" : "（キーワード検索で動作）");
    } catch (e) { if (note) note.textContent = "失敗: " + e.message; }
    finally { btn.disabled = false; btn.textContent = o; }
  });
})();

// ===== ソース追加モーダル =====
(function () {
  const modal = document.getElementById("kbModal");
  if (!modal) return;
  const openBtn = document.getElementById("kbAddSourceBtn");
  const closeBtn = document.getElementById("kbModalClose");
  const folderLabel = document.getElementById("kbModalFolder");
  const statusEl = document.getElementById("kbModalStatus");
  const setStatus = (t) => { if (statusEl) statusEl.textContent = t || ""; };

  const panels = { url: document.getElementById("kbPanelUrl"), text: document.getElementById("kbPanelText"), drive: document.getElementById("kbPanelDrive") };
  const showPanel = (name) => { for (const k in panels) if (panels[k]) panels[k].hidden = k !== name; };

  function openModal() {
    modal.hidden = false;
    if (folderLabel) folderLabel.textContent = "→ " + (kbCurrentFolder || "ルート");
    showPanel(null);
    setStatus("");
  }
  function closeModal() { modal.hidden = true; }
  if (openBtn) openBtn.addEventListener("click", openModal);
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

  // ソース種別ボタン
  modal.querySelectorAll(".kb-source-btn").forEach((b) =>
    b.addEventListener("click", async () => {
      const src = b.dataset.src;
      if (src === "file") { document.getElementById("kbFileInput").click(); return; }
      if (src === "drive") {
        // 公式Google Pickerを試し、APIキー未設定なら内製ブラウザにフォールバック
        let cfg = {};
        try { cfg = await (await fetch("/api/drive/picker-config")).json(); } catch {}
        if (cfg.apiKey) {
          openGooglePicker(cfg);
          return;
        }
        showPanel("drive");
        driveLoad("recent");
        return;
      }
      showPanel(src);
    })
  );

  // ---- 公式 Google Picker ----
  let pickerLoaded = false;
  function loadPickerApi(cb) {
    if (window.google && window.google.picker) return cb();
    if (pickerLoaded) { const t = setInterval(() => { if (window.google && window.google.picker) { clearInterval(t); cb(); } }, 200); return; }
    pickerLoaded = true;
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.onload = () => window.gapi.load("picker", { callback: cb });
    document.head.appendChild(s);
  }
  async function openGooglePicker(cfg) {
    setStatus("Googleドライブを開いています…");
    try {
      const st = await (await fetch("/api/drive/status")).json();
      if (!st.googleConnected || !st.driveReady) {
        setStatus("");
        showPanel("drive");
        driveLoad("recent");
        return;
      }
      const { token } = await (await fetch("/api/drive/token")).json();
      if (!token) throw new Error("トークン取得に失敗");
      loadPickerApi(() => {
        const g = window.google;
        const view = new g.picker.DocsView(g.picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false);
        const shared = new g.picker.DocsView(g.picker.ViewId.DOCS).setEnableDrives(true).setIncludeFolders(true);
        const builder = new g.picker.PickerBuilder()
          .addView(view)
          .addView(shared)
          .setOAuthToken(token)
          .setDeveloperKey(cfg.apiKey)
          .setCallback((data) => pickerCallback(g, data));
        if (cfg.appId) builder.setAppId(cfg.appId);
        builder.build().setVisible(true);
        setStatus("");
      });
    } catch (e) {
      setStatus("Pickerを開けませんでした: " + e.message + "（内製ブラウザに切替）");
      showPanel("drive");
      driveLoad("recent");
    }
  }
  async function pickerCallback(g, data) {
    if (data.action !== g.picker.Action.PICKED) return;
    const docs = data.docs || [];
    let ok = 0;
    for (const doc of docs) {
      setStatus(`「${doc.name}」を読み取っています…`);
      try {
        const rr = await fetch("/api/knowledge/drive", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fileId: doc.id, category: kbCat(), folder: kbCurrentFolder }),
        });
        const dd = await rr.json();
        if (!rr.ok) throw new Error(dd.error || "失敗");
        ok++;
      } catch (e) {
        setStatus(`「${doc.name}」失敗: ${e.message}`);
      }
    }
    if (ok) setStatus(`${ok}/${docs.length} 件を取り込みました。`);
    loadKnowledge();
  }

  // ---- ファイル（複数・ドロップ対応） ----
  async function uploadOneFile(f) {
    setStatus(`「${f.name}」を読み取り中…`);
    const fd = new FormData();
    fd.append("file", f);
    fd.append("category", kbCat());
    fd.append("folder", kbCurrentFolder);
    const r = await fetch("/api/knowledge/file", { method: "POST", body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "失敗");
    return d;
  }
  async function handleFiles(files) {
    const arr = [...files];
    let ok = 0;
    for (const f of arr) {
      try { await uploadOneFile(f); ok++; setStatus(`${ok}/${arr.length} 件 完了…`); }
      catch (e) { setStatus(`「${f.name}」失敗: ${e.message}`); }
    }
    setStatus(`${ok}/${arr.length} 件を取り込みました。`);
    loadKnowledge();
  }
  const fileInput = document.getElementById("kbFileInput");
  if (fileInput) fileInput.addEventListener("change", () => { if (fileInput.files.length) handleFiles(fileInput.files); fileInput.value = ""; });

  const dz = document.getElementById("kbDropzone");
  if (dz) {
    dz.addEventListener("click", () => fileInput && fileInput.click());
    ["dragover", "dragenter"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("over"); }));
    dz.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
  }

  // ---- URL ----
  const urlBtn = document.getElementById("kbUrlBtn");
  if (urlBtn) urlBtn.addEventListener("click", async () => {
    const url = document.getElementById("kbUrl").value.trim();
    if (!url) return;
    urlBtn.disabled = true; setStatus("URLを取り込んでいます…");
    try {
      const r = await fetch("/api/knowledge/url", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, category: kbCat(), folder: kbCurrentFolder }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "失敗");
      document.getElementById("kbUrl").value = "";
      setStatus(`取り込みました（約${(d.chars || 0).toLocaleString()}文字）。`);
      loadKnowledge();
    } catch (e) { setStatus("取り込み失敗: " + e.message); }
    finally { urlBtn.disabled = false; }
  });

  // ---- テキスト ----
  const addBtn = document.getElementById("kbAddBtn");
  if (addBtn) addBtn.addEventListener("click", async () => {
    const title = document.getElementById("kbTitle").value.trim();
    const body = document.getElementById("kbBody").value.trim();
    if (!title && !body) return;
    setStatus("追加しています…");
    await fetch("/api/knowledge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ category: kbCat(), title, body, folder: kbCurrentFolder }) });
    document.getElementById("kbTitle").value = ""; document.getElementById("kbBody").value = "";
    setStatus("追加しました。");
    loadKnowledge();
  });

  // ---- ドライブ閲覧 ----
  let driveMode = "recent";
  let driveStack = []; // {id, name}
  const results = document.getElementById("kbDriveResults");
  const crumb = document.getElementById("kbDriveCrumb");
  const qInput = document.getElementById("kbDriveQ");
  const mimeLabel = (mt) => {
    if (!mt) return "ファイル";
    if (mt.includes("folder")) return "フォルダ";
    if (mt.includes("google-apps.document")) return "ドキュメント";
    if (mt.includes("google-apps.spreadsheet")) return "シート";
    if (mt.includes("google-apps.presentation")) return "スライド";
    if (mt === "application/pdf") return "PDF";
    if (mt.startsWith("image/")) return "画像";
    return "ファイル";
  };
  function renderCrumb() {
    if (!crumb) return;
    let html = `<a href="#" data-i="-1">マイドライブ</a>`;
    driveStack.forEach((f, i) => { html += ` › <a href="#" data-i="${i}">${escapeHtmlKb(f.name)}</a>`; });
    crumb.innerHTML = driveMode === "mydrive" || driveStack.length ? html : "";
    crumb.querySelectorAll("a").forEach((a) => a.addEventListener("click", (e) => {
      e.preventDefault(); const i = Number(e.currentTarget.dataset.i);
      driveStack = i < 0 ? [] : driveStack.slice(0, i + 1);
      const parent = driveStack.length ? driveStack[driveStack.length - 1].id : "";
      driveLoad("mydrive", parent);
    }));
  }
  async function driveLoad(mode, parent = "", q = "") {
    driveMode = mode;
    if (!results) return;
    results.innerHTML = '<li class="kb-empty">読み込み中…</li>';
    renderCrumb();
    try {
      const st = await (await fetch("/api/drive/status")).json();
      if (!st.googleConnected) { results.innerHTML = '<li class="kb-empty">Google未連携です。設定→Google連携から連携してください。</li>'; return; }
      if (!st.driveReady) { results.innerHTML = '<li class="kb-empty">ドライブ未許可です。Google連携で「解除」→「連携する」をやり直し、ドライブの許可にチェックしてください。</li>'; return; }
      const params = new URLSearchParams(q ? { q } : parent ? { mode: "mydrive", parent } : { mode });
      const d = await (await fetch("/api/drive/list?" + params)).json();
      const files = d.files || [];
      if (!files.length) { results.innerHTML = '<li class="kb-empty">ファイルがありません。</li>'; return; }
      results.innerHTML = "";
      for (const f of files) {
        const isFolder = (f.mimeType || "").includes("folder");
        const li = document.createElement("li");
        li.className = "kb-drive-item";
        li.innerHTML =
          `<span class="kb-drive-ic">${isFolder ? "📁" : "📄"}</span>` +
          `<span class="kb-drive-name">${escapeHtmlKb(f.name)}</span>` +
          `<span class="kb-drive-type">${escapeHtmlKb(mimeLabel(f.mimeType))}</span>` +
          (isFolder ? "" : `<button class="btn ghost kb-drive-import">取り込む</button>`);
        if (isFolder) {
          li.querySelector(".kb-drive-name").style.cursor = "pointer";
          li.querySelector(".kb-drive-name").addEventListener("click", () => { driveStack.push({ id: f.id, name: f.name }); driveLoad("mydrive", f.id); });
          li.querySelector(".kb-drive-ic").style.cursor = "pointer";
          li.querySelector(".kb-drive-ic").addEventListener("click", () => { driveStack.push({ id: f.id, name: f.name }); driveLoad("mydrive", f.id); });
        } else {
          li.querySelector(".kb-drive-import").addEventListener("click", async (e) => {
            const btn = e.currentTarget; btn.disabled = true; btn.textContent = "取り込み中…";
            setStatus(`「${f.name}」を読み取っています…`);
            try {
              const rr = await fetch("/api/knowledge/drive", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ fileId: f.id, category: kbCat(), folder: kbCurrentFolder }) });
              const dd = await rr.json();
              if (!rr.ok) throw new Error(dd.error || "失敗");
              setStatus(`「${f.name}」を取り込みました（約${(dd.chars || 0).toLocaleString()}文字）。`);
              btn.textContent = "完了"; loadKnowledge();
            } catch (err) { setStatus("取り込み失敗: " + err.message); btn.disabled = false; btn.textContent = "取り込む"; }
          });
        }
        results.appendChild(li);
      }
    } catch (e) { results.innerHTML = `<li class="kb-empty">エラー: ${escapeHtmlKb(e.message)}</li>`; }
  }
  modal.querySelectorAll(".kb-drive-tab").forEach((t) => t.addEventListener("click", () => {
    modal.querySelectorAll(".kb-drive-tab").forEach((x) => x.classList.toggle("active", x === t));
    driveStack = []; if (qInput) qInput.value = "";
    driveLoad(t.dataset.mode);
  }));
  if (qInput) qInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { driveStack = []; driveLoad("search", "", qInput.value.trim()); } });
})();

loadKnowledge();

// ===== 抜け漏れチェック項目（チーム共有） =====
(function () {
  const ta = document.getElementById("checkItems");
  const saveBtn = document.getElementById("saveCheckBtn");
  const resetBtn = document.getElementById("resetCheckBtn");
  const saved = document.getElementById("checkSaved");
  if (!ta || !saveBtn) return;
  const DEFAULTS = ["課題・ニーズ", "予算", "決裁者・決裁プロセス", "導入時期", "現状・競合（既存の取り組み/比較対象）", "次のステップ（合意）"];

  async function load() {
    try {
      const d = await (await fetch("/api/check-items")).json();
      ta.value = (d.items && d.items.length ? d.items : DEFAULTS).join("\n");
    } catch { ta.value = DEFAULTS.join("\n"); }
  }
  async function save(items) {
    const r = await fetch("/api/check-items", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const d = await r.json();
    if (r.ok && saved) { saved.hidden = false; setTimeout(() => (saved.hidden = true), 1500); }
    if (d.items) ta.value = d.items.join("\n");
  }
  saveBtn.addEventListener("click", () => {
    const items = ta.value.split("\n").map((s) => s.trim()).filter(Boolean);
    save(items);
  });
  if (resetBtn) resetBtn.addEventListener("click", () => save(DEFAULTS));
  load();
})();

// ===== 商談履歴の要約プロンプト（チーム共有） =====
(function () {
  const ta = document.getElementById("summaryPrompt");
  const saveBtn = document.getElementById("saveSummaryPromptBtn");
  const clearBtn = document.getElementById("clearSummaryPromptBtn");
  const saved = document.getElementById("summaryPromptSaved");
  if (!ta || !saveBtn) return;
  async function load() {
    try { const d = await (await fetch("/api/summary-prompt")).json(); ta.value = d.prompt || ""; } catch {}
  }
  async function save(val) {
    const r = await fetch("/api/summary-prompt", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: val }),
    });
    if (r.ok && saved) { saved.hidden = false; setTimeout(() => (saved.hidden = true), 1500); }
  }
  saveBtn.addEventListener("click", () => save(ta.value));
  if (clearBtn) clearBtn.addEventListener("click", () => { ta.value = ""; save(""); });
  load();
})();

// ===== カスタム分析プロンプト（チーム共有） =====
(function () {
  const ta = document.getElementById("customPrompt");
  const saveBtn = document.getElementById("saveCustomPromptBtn");
  const clearBtn = document.getElementById("clearCustomPromptBtn");
  const saved = document.getElementById("customPromptSaved");
  if (!ta || !saveBtn) return;
  async function load() {
    try { const d = await (await fetch("/api/custom-prompt")).json(); ta.value = d.prompt || ""; } catch {}
  }
  async function save(val) {
    const r = await fetch("/api/custom-prompt", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: val }),
    });
    if (r.ok && saved) { saved.hidden = false; setTimeout(() => (saved.hidden = true), 1500); }
  }
  saveBtn.addEventListener("click", () => save(ta.value));
  if (clearBtn) clearBtn.addEventListener("click", () => { ta.value = ""; save(""); });
  load();
})();

// ===== Notion連携 =====
(function () {
  const saveBtn = document.getElementById("saveNotionBtn");
  if (!saveBtn) return;
  const tokenEl = document.getElementById("notionToken");
  const dbEl = document.getElementById("notionDb");
  const statusEl = document.getElementById("notionStatus");
  const savedEl = document.getElementById("notionSaved");
  async function refresh() {
    try {
      const d = await (await fetch("/api/notion/config")).json();
      if (dbEl && d.db) dbEl.value = d.db;
      if (tokenEl && d.hasToken) tokenEl.value = "••••••••••••";
      if (statusEl) statusEl.textContent = d.configured ? "連携済み" : "未設定";
    } catch {}
  }
  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    try {
      const body = { db: (dbEl.value || "").trim() };
      const tv = (tokenEl.value || "").trim();
      if (tv && !tv.includes("•")) body.token = tv;
      const r = await fetch("/api/notion/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "保存に失敗");
      if (savedEl) { savedEl.hidden = false; setTimeout(() => (savedEl.hidden = true), 2000); }
      if (statusEl) statusEl.textContent = d.configured ? "連携済み" : "未設定";
      if (tokenEl && d.hasToken) tokenEl.value = "••••••••••••";
    } catch (e) {
      alert("保存に失敗: " + e.message);
    } finally {
      saveBtn.disabled = false;
    }
  });
  refresh();
})();

// ===== スマートリンク（担当者切り替えに追随する共有Zoom URL） =====
let smartLinksRepsCache = null;
async function loadSmartLinksReps() {
  if (smartLinksRepsCache) return smartLinksRepsCache;
  try { smartLinksRepsCache = await (await fetch("/api/smart-links/reps")).json(); } catch { smartLinksRepsCache = []; }
  return smartLinksRepsCache;
}
function escSL(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
async function loadMyZoomLink() {
  const input = document.getElementById("myZoomLink");
  if (!input) return;
  try {
    const d = await (await fetch("/api/my-zoom-link")).json();
    input.value = d.url || "";
  } catch {}
}
async function renderSmartLinkTable() {
  const table = document.getElementById("smartLinkTable");
  if (!table) return;
  table.innerHTML = "<tr><td>読み込み中…</td></tr>";
  let links = [];
  try { links = await (await fetch("/api/smart-links")).json(); } catch {}
  const reps = await loadSmartLinksReps();
  if (!links.length) { table.innerHTML = '<tr><td class="note">まだスマートリンクがありません。上で作成してください。</td></tr>'; return; }
  let html = "<tr><th>名前</th><th>URL</th><th>担当者</th><th></th></tr>";
  for (const l of links) {
    const options = ['<option value="">（未定）</option>']
      .concat(reps.map((r) => `<option value="${escSL(r.email)}" ${r.email === l.current_owner ? "selected" : ""}>${escSL(r.name)}${r.has_zoom_link ? "" : "（リンク未登録）"}</option>`));
    html += `<tr>
      <td>${escSL(l.label || "(名称未設定)")}</td>
      <td><code style="font-size:11px;">${escSL(l.url)}</code> <button class="btn ghost sl-copy" data-url="${escSL(l.url)}" type="button" style="padding:2px 8px;font-size:11px;">コピー</button></td>
      <td><select class="sl-owner" data-slug="${escSL(l.slug)}">${options.join("")}</select></td>
      <td><button class="btn ghost sl-delete" data-slug="${escSL(l.slug)}" type="button">削除</button></td>
    </tr>`;
  }
  table.innerHTML = html;
  table.querySelectorAll(".sl-owner").forEach((sel) => {
    sel.addEventListener("change", async () => {
      try {
        await fetch(`/api/smart-links/${encodeURIComponent(sel.dataset.slug)}/owner`, {
          method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: sel.value || null }),
        });
      } catch (e) { alert("担当者の切り替えに失敗しました: " + e.message); }
    });
  });
  table.querySelectorAll(".sl-copy").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(btn.dataset.url); btn.textContent = "コピーしました"; setTimeout(() => (btn.textContent = "コピー"), 1200); } catch {}
    });
  });
  table.querySelectorAll(".sl-delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("このスマートリンクを削除しますか？（すでに送信したメール内のURLは無効になります）")) return;
      try { await fetch(`/api/smart-links/${encodeURIComponent(btn.dataset.slug)}`, { method: "DELETE" }); renderSmartLinkTable(); } catch {}
    });
  });
}
function initSmartLinks() {
  loadMyZoomLink();
  renderSmartLinkTable();
  const saveBtn = document.getElementById("saveMyZoomLinkBtn");
  if (saveBtn && !saveBtn._wired) {
    saveBtn._wired = true;
    saveBtn.addEventListener("click", async () => {
      const input = document.getElementById("myZoomLink");
      const saved = document.getElementById("myZoomLinkSaved");
      saveBtn.disabled = true;
      try {
        await fetch("/api/my-zoom-link", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: input.value.trim() }) });
        if (saved) { saved.hidden = false; setTimeout(() => (saved.hidden = true), 2000); }
        smartLinksRepsCache = null; // 自分のリンク有無の表示を最新化
      } catch (e) { alert("保存に失敗しました: " + e.message); }
      finally { saveBtn.disabled = false; }
    });
  }
  const createBtn = document.getElementById("createSmartLinkBtn");
  if (createBtn && !createBtn._wired) {
    createBtn._wired = true;
    createBtn.addEventListener("click", async () => {
      const labelInput = document.getElementById("newSmartLinkLabel");
      createBtn.disabled = true;
      try {
        const r = await fetch("/api/smart-links", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: labelInput.value.trim() }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "作成に失敗しました");
        labelInput.value = "";
        await renderSmartLinkTable();
        try { await navigator.clipboard.writeText(d.url); createBtn.textContent = "作成＋コピーしました"; } catch { createBtn.textContent = "作成しました"; }
        setTimeout(() => (createBtn.textContent = "スマートリンクを作成"), 2000);
      } catch (e) { alert("作成に失敗しました: " + e.message); }
      finally { createBtn.disabled = false; }
    });
  }
}
