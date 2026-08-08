// 通知（トーストが使えないときはダイアログ）
function kbNotify(msg) { if (window.kbToast) window.kbToast(msg); else alert(msg); }

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

// ===== Zoom自動入室：登録URLの読み込み・追加・削除 =====
async function loadAutoJoin() {
  const list = $("autoJoinList");
  const status = $("autoJoinStatus");
  const wh = $("autoJoinWebhookUrl");
  if (!list) return;
  try {
    const d = await (await fetch("/api/auto-join")).json();
    const items = (d && d.items) || [];
    if (wh && d.webhookUrl) wh.textContent = d.webhookUrl;
    if (status) {
      status.className = "autojoin-status " + (d.zoomConfigured ? "ok" : "ok");
      status.textContent = d.zoomConfigured
        ? "カレンダー方式が有効です（予定の開始時刻に自動入室）。さらにZoom Webhook連携も設定済みで、会議開始を即時検知します。"
        : "カレンダー方式が有効です。Googleカレンダーにその会議の予定が入っていれば、開始時刻に自動入室します（Zoomアプリ不要）。即時検知したい場合は下のZoom連携を設定してください。";
    }
    if (!items.length) {
      list.innerHTML = '<li class="empty-state">まだ登録がありません。</li>';
      return;
    }
    list.innerHTML = "";
    items.forEach((it) => {
      const li = document.createElement("li");
      li.innerHTML =
        `<span class="ln-name"></span><span class="ln-url"></span>` +
        `<label class="aj-toggle"><input type="checkbox" class="aj-enabled" ${it.enabled ? "checked" : ""} /> 有効</label>` +
        `<label class="aj-toggle"><input type="checkbox" class="aj-calany" ${it.calendar_any ? "checked" : ""} /> 予定の時間に入室（URL照合なし）</label>` +
        `<button class="ln-del">削除</button>`;
      li.querySelector(".ln-name").textContent = it.label || "(名前なし)";
      li.querySelector(".ln-url").textContent = it.url;
      li.querySelector(".aj-enabled").addEventListener("change", async (e) => {
        await fetch(`/api/auto-join/${it.id}`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: e.target.checked }),
        });
      });
      li.querySelector(".aj-calany").addEventListener("change", async (e) => {
        await fetch(`/api/auto-join/${it.id}`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ calendar_any: e.target.checked }),
        });
      });
      li.querySelector(".ln-del").addEventListener("click", async () => {
        await fetch(`/api/auto-join/${it.id}`, { method: "DELETE" });
        loadAutoJoin();
      });
      list.appendChild(li);
    });
  } catch {
    list.innerHTML = '<li class="empty-state">読み込みに失敗しました。</li>';
  }
}
if ($("addAutoJoinBtn")) {
  $("addAutoJoinBtn").addEventListener("click", async () => {
    const label = $("newAutoJoinLabel").value.trim();
    const url = $("newAutoJoinUrl").value.trim();
    const msg = $("autoJoinMsg");
    if (!url) return;
    try {
      const r = await fetch("/api/auto-join", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, label }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "登録に失敗しました");
      $("newAutoJoinLabel").value = "";
      $("newAutoJoinUrl").value = "";
      if (msg) { msg.hidden = false; msg.textContent = "登録しました。"; setTimeout(() => (msg.hidden = true), 2500); }
      loadAutoJoin();
    } catch (e) {
      if (msg) { msg.hidden = false; msg.textContent = "エラー: " + e.message; }
    }
  });
}
loadAutoJoin();

// Salesforce：商談の項目一覧（ラベル ↔ API名）
let sfFieldsCache = null;
function renderSfFieldsList(fields, q) {
  const box = $("sfFieldsResult");
  const query = (q || "").trim().toLowerCase();
  const list = query
    ? fields.filter((f) => (f.label || "").toLowerCase().includes(query) || (f.name || "").toLowerCase().includes(query))
    : fields;
  if (!list.length) { box.innerHTML = '<div class="note">該当する項目がありません。</div>'; return; }
  box.innerHTML =
    `<div class="note">${list.length}件（行をクリックでAPI名をコピー）</div>` +
    '<div class="sf-fields-table">' +
    list.map((f) => `<div class="sf-fields-row" data-api="${escapeHtml(f.name)}">` +
      `<span class="sf-fld-label">${escapeHtml(f.label || "")}</span>` +
      `<span class="sf-fld-api">${escapeHtml(f.name)}</span>` +
      `<span class="sf-fld-type">${escapeHtml(f.type || "")}${f.custom ? " ・カスタム" : ""}${f.updateable ? "" : " ・読取専用"}</span>` +
      `</div>`).join("") +
    '</div>';
  box.querySelectorAll(".sf-fields-row").forEach((row) => {
    row.addEventListener("click", () => {
      const api = row.dataset.api;
      if (navigator.clipboard) {
        navigator.clipboard.writeText(api).then(() => {
          row.classList.add("copied");
          setTimeout(() => row.classList.remove("copied"), 1000);
        }).catch(() => {});
      }
    });
  });
}
if ($("sfFieldsBtn")) {
  $("sfFieldsBtn").addEventListener("click", async () => {
    const box = $("sfFieldsResult");
    const btn = $("sfFieldsBtn");
    btn.disabled = true; const o = btn.textContent; btn.textContent = "取得中…";
    box.innerHTML = "";
    try {
      const d = await (await fetch("/api/salesforce/describe")).json();
      if (d.error) throw new Error(d.error);
      sfFieldsCache = d.fields || [];
      renderSfFieldsList(sfFieldsCache, $("sfFieldsQuery") ? $("sfFieldsQuery").value : "");
    } catch (e) {
      box.innerHTML = `<div class="diag-ng">取得に失敗しました：${escapeHtml(e.message)}<br>Salesforce未連携・セッション切れの場合は、上で連携／再接続してからお試しください。</div>`;
    } finally { btn.disabled = false; btn.textContent = o; }
  });
}
if ($("sfFieldsQuery")) {
  $("sfFieldsQuery").addEventListener("input", () => {
    if (sfFieldsCache) renderSfFieldsList(sfFieldsCache, $("sfFieldsQuery").value);
  });
}
if ($("sfDiagIpBtn")) {
  $("sfDiagIpBtn").addEventListener("click", async () => {
    const box = $("sfDiagIp");
    const btn = $("sfDiagIpBtn");
    btn.disabled = true; const o = btn.textContent; btn.textContent = "確認中…";
    box.innerHTML = "";
    try {
      const d = await (await fetch("/api/salesforce/diag-ip")).json();
      const ips = d.outboundIps || [];
      const lines = [];
      // 接続先（本番/サンドボックス）と接続アプリ
      lines.push(`<div class="diag-row"><b>接続先：</b>${escapeHtml(d.loginUrl || "")}（${d.isSandbox ? "サンドボックス" : "本番"}）</div>`);
      lines.push(`<div class="diag-row diag-muted">接続アプリ Client ID：${escapeHtml(d.clientIdPrefix || "")}</div>`);
      if (!d.isSandbox) {
        lines.push('<div class="diag-ng">△ 接続先が「本番（login.salesforce.com）」になっています。連携先がサンドボックス（neoDV）なら、環境変数 SF_LOGIN_URL を https://test.salesforce.com に設定してください。組織がズレていると、SDGがサンドボックスで直しても効きません。</div>');
      }
      // 送信元IP
      if (!ips.length) {
        lines.push('<div class="diag-ng">送信元IPを取得できませんでした。時間をおいて再度お試しください。</div>');
      } else {
        lines.push(`<div class="diag-row"><b>実際の送信元IP：</b>${ips.map(escapeHtml).join(" ／ ")}${ips.length > 1 ? "（複数のIPから出ています）" : ""}</div>`);
        lines.push(`<div class="diag-row diag-muted">登録済み（想定）：${(d.expected || []).join(" ／ ")}</div>`);
        const notReg = d.notRegistered || ips.filter((ip) => !(d.expected || []).includes(ip));
        if (notReg.length) {
          lines.push(`<div class="diag-ng">× 未登録のIPがあります：<b>${notReg.map(escapeHtml).join(" ／ ")}</b><br><span class="diag-hint">→ このIPをSalesforceに追加してください。</span></div>`);
        } else {
          lines.push('<div class="diag-ok">✓ 送信元IPはすべて登録済みの想定IPに含まれています。');
          if (ips.length > 1) lines[lines.length - 1] += '（複数IPが確認できたので、3つすべてがSalesforce側に登録されているか確認してください）';
          lines[lines.length - 1] += '</div>';
        }
      }
      box.innerHTML = lines.join("");
    } catch (e) {
      box.innerHTML = `<div class="diag-ng">確認に失敗しました：${escapeHtml(e.message)}</div>`;
    } finally {
      btn.disabled = false; btn.textContent = o;
    }
  });
}

// 自動入室の診断：今のカレンダーと登録URLの突合状況を表示
if ($("autoJoinTestBtn")) {
  $("autoJoinTestBtn").addEventListener("click", async () => {
    const box = $("autoJoinDiag");
    const btn = $("autoJoinTestBtn");
    btn.disabled = true; const o = btn.textContent; btn.textContent = "確認中…";
    box.innerHTML = "";
    try {
      const d = await (await fetch("/api/auto-join/diagnose")).json();
      const lines = [];
      lines.push(d.calendarConnected
        ? '<div class="diag-ok">✓ Googleカレンダー：連携済み</div>'
        : '<div class="diag-ng">× Googleカレンダーが読み取れません。設定→外部連携でGoogleを連携してください。</div>');
      if (!d.publicUrl) lines.push('<div class="diag-ng">× 公開URL(PUBLIC_URL)が未設定です。</div>');
      if (!d.count) lines.push('<div class="diag-ng">× 自動入室のURLが未登録です。上で登録してください。</div>');
      (d.items || []).forEach((it) => {
        const name = it.label || it.url;
        if (!it.enabled) { lines.push(`<div class="diag-row diag-muted">・${escapeHtml(name)}：無効（有効のチェックを入れてください）</div>`); return; }
        if (it.matchedEvent) {
          const when = new Date(it.matchedEvent.start).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
          lines.push(`<div class="diag-row diag-ok">✓ ${escapeHtml(name)}：予定「${escapeHtml(it.matchedEvent.title || "")}」（${when}開始）${it.calendar_any ? "の時間にこの部屋へ入室します" : "とURLが一致しました"}。${it.wouldJoinNow ? "＝今が入室タイミングです" : "＝開始時刻の直前に自動入室します"}</div>`);
        } else if (it.calendar_any) {
          lines.push(`<div class="diag-row diag-ng">× ${escapeHtml(name)}：これからの3時間に、相手のいる予定がカレンダーに見つかりません。<br><span class="diag-hint">→ 予定（相手を招待した会議）がカレンダーにあれば、その開始時刻に自動入室します。</span></div>`);
        } else {
          lines.push(`<div class="diag-row diag-ng">× ${escapeHtml(name)}：このURL（会議ID ${escapeHtml(it.meeting_id)}）と一致する予定が、これからの3時間のカレンダーに見つかりません。<br><span class="diag-hint">→ URLを貼らずに入室したい場合は、この行の「予定の時間に入室（URL照合なし）」にチェックを入れてください。</span></div>`);
        }
      });
      box.innerHTML = lines.join("");
    } catch (e) {
      box.innerHTML = `<div class="diag-ng">確認に失敗しました：${escapeHtml(e.message)}</div>`;
    } finally {
      btn.disabled = false; btn.textContent = o;
    }
  });
}

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
  // 他の画面から settings.html#members のように来たとき、そのタブを開く
  const openFromHash = () => {
    const want = (location.hash || "").replace("#", "");
    if (!want) return;
    const item = menu.querySelector(`.set-menu-item[data-tab="${want}"]`);
    if (item) item.click();
  };
  window.addEventListener("hashchange", openFromHash);
  setTimeout(openFromHash, 0);
  menu.querySelectorAll(".set-menu-item").forEach((item) => {
    item.addEventListener("click", () => {
      menu.querySelectorAll(".set-menu-item").forEach((t) => t.classList.toggle("active", t === item));
      const name = item.dataset.tab;
      document.querySelectorAll(".set-pane").forEach((p) => (p.hidden = p.dataset.pane !== name));
      if (name === "members") { loadMembers(); loadApoOwner(); loadApoInvite(); }
      if (name === "knowledge") loadKnowledge();
      if (name === "ai") loadThanksPrompt();
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

// ===== メンバー管理 =====
// ここが唯一の登録元。保存すると closer_rotation / interns / rep_team_mapping へ同期される。
const ROLE_LABEL = { closer: "クローザー", inside: "インサイド", fallback: "予備" };
// 姓の自動判定（サーバー側と同じ規則）。表示用。
const THREE_CHAR_SURNAMES = ["佐々木","長谷川","小野寺","久保田","佐久間","五十嵐","小早川","大河原",
  "宇佐美","小笠原","阿久津","長谷部","八木橋","宇都宮","喜多村","小田切","西園寺","早乙女"];
function guessFamilyName(name) {
  const n = String(name || "").trim().replace(/[\s\u3000]+/g, " ");
  if (!n) return "";
  if (n.includes(" ")) return n.split(" ")[0];
  for (const f of THREE_CHAR_SURNAMES) if (n.startsWith(f)) return f;
  const m = n.match(/^([\u4E00-\u9FFF々]{1,4})[\u3040-\u309F\u30A0-\u30FF]/);
  if (m) return m[1];
  if (/^[\u4E00-\u9FFF々]{3,}$/.test(n)) return n.slice(0, 2);
  return n;
}
const BIZ = ["DOC", "MOCHICA"];
let mbState = { members: [], candidates: [], teams: [] };

function mbSay(msg, ms) {
  const el = document.getElementById("mbStatus");
  if (!el) return;
  el.textContent = msg;
  if (ms) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, ms);
}

async function loadMembers() {
  const box = document.getElementById("mbList");
  if (!box) return;
  box.innerHTML = '<p class="note">読み込み中…</p>';
  try {
    const d = await (await fetch("/api/members")).json();
    mbState.members = (d.members || []).map((m) => ({
      ...m,
      businesses: Array.isArray(m.businesses) ? m.businesses : [],
      roles: Array.isArray(m.roles) ? m.roles : [],
      profile: (m.profile && typeof m.profile === "object") ? { ...m.profile } : {},
    }));
    mbState.candidates = d.candidates || [];
    mbState.teams = d.teams || [];
    mbRender();
  } catch (e) {
    box.innerHTML = `<p class="note cc-warn">読み込めませんでした：${mbEsc(e.message)}</p>`;
  }
}

function mbEsc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function mbRender() {
  const box = document.getElementById("mbList");
  if (!box) return;

  // チーム名の候補
  let dl = document.getElementById("mbTeamList");
  if (!dl) { dl = document.createElement("datalist"); dl.id = "mbTeamList"; document.body.appendChild(dl); }
  const teamNames = [...new Set(mbState.members.map((m) => (m.team || "").trim()).filter(Boolean))];
  dl.innerHTML = teamNames.map((t) => `<option value="${mbEsc(t)}"></option>`).join("");

  // 未登録の候補をメールの入力補完に出す
  const cl = document.getElementById("mbCandList");
  if (cl) cl.innerHTML = mbState.candidates.map((c) => `<option value="${mbEsc(c.email)}">${mbEsc(c.name)}</option>`).join("");

  if (!mbState.members.length) {
    box.innerHTML = '<p class="note">まだ誰も登録されていません。下の欄から追加してください。</p>';
  } else {
    box.innerHTML = "";
    mbState.members.forEach((m, i) => {
      const p = m.profile || {};
      const row = document.createElement("div");
      row.className = "mb-row" + (m.active === false ? " mb-off" : "");
      row.draggable = true;
      row.innerHTML =
        `<div class="mb-main">
           <input class="mb-name" value="${mbEsc(m.name)}" placeholder="名前" />
           <input class="mb-email" value="${mbEsc(m.email)}" placeholder="メールアドレス" />
           <input class="mb-team" list="mbTeamList" value="${mbEsc(m.team || "")}" placeholder="チーム" />
         </div>
         <div class="mb-tags">
           <span class="mb-tag-label">事業</span>
           ${BIZ.map((b) => `<label class="mb-chk"><input type="checkbox" class="mb-biz" data-v="${b}" ${m.businesses.includes(b) ? "checked" : ""} /> ${b}</label>`).join("")}
           <span class="mb-tag-label">役割</span>
           ${Object.keys(ROLE_LABEL).map((r) => `<label class="mb-chk mb-chk-${r}"><input type="checkbox" class="mb-role" data-v="${r}" ${m.roles.includes(r) ? "checked" : ""} /> ${ROLE_LABEL[r]}</label>`).join("")}
           <label class="mb-chk">1日上限 <input type="number" class="mb-cap" min="1" max="20" placeholder="なし" value="${m.daily_cap || ""}" /> 件</label>
           <label class="mb-chk"><input type="checkbox" class="mb-active" ${m.active === false ? "" : "checked"} /> 在籍中</label>
           <button type="button" class="btn ghost mb-sig">署名</button>
           <button type="button" class="btn ghost mb-del">外す</button>
         </div>
         <div class="mb-sigbox" hidden>
           <p class="note">アポ確定メール・リマインドメールの署名に入ります。空欄のままだと本文がその行だけ空になります。<br>
           「◯◯でございます」の姓は<b>名前から自動で判定</b>します（違うときだけ下の欄で上書きしてください）。会議室のURLとミーティングIDは<b>設定 → 登録リンク</b>で各自が登録したものが入ります。</p>
           <div class="mb-sig-grid">
             <label>姓（自動判定：<b>${mbEsc(guessFamilyName(m.name))}</b>）<input class="mb-p" data-k="shortName" value="${mbEsc(p.shortName || "")}" placeholder="自動判定のままでよければ空欄" /></label>
             <label>ローマ字<input class="mb-p" data-k="nameRoman" value="${mbEsc(p.nameRoman || "")}" placeholder="Kinya Tanaka" /></label>
             <label>電話番号<input class="mb-p" data-k="phone" value="${mbEsc(p.phone || "")}" placeholder="080-0000-0000" /></label>
             <label>部署<input class="mb-p" data-k="dept" value="${mbEsc(p.dept || "")}" placeholder="事業統括本部 事業開発部" /></label>
             <label>ユニット・グループ<input class="mb-p" data-k="unit" value="${mbEsc(p.unit || "")}" placeholder="DOCユニット FSグループ" /></label>
           </div>
         </div>`;

      const q = (sel) => row.querySelector(sel);
      q(".mb-sig").addEventListener("click", () => {
        const box = q(".mb-sigbox");
        box.hidden = !box.hidden;
      });
      row.querySelectorAll(".mb-p").forEach((el) => el.addEventListener("input", (e) => {
        m.profile = m.profile || {};
        m.profile[e.target.dataset.k] = e.target.value;
      }));
      q(".mb-name").addEventListener("input", (e) => { m.name = e.target.value; });
      q(".mb-name").addEventListener("change", () => mbRender());
      q(".mb-email").addEventListener("input", (e) => { m.email = e.target.value.trim().toLowerCase(); });
      q(".mb-team").addEventListener("input", (e) => { m.team = e.target.value.trim(); });
      q(".mb-cap").addEventListener("change", (e) => {
        const v = parseInt(e.target.value, 10);
        m.daily_cap = Number.isFinite(v) && v > 0 ? v : null;
      });
      q(".mb-active").addEventListener("change", (e) => { m.active = e.target.checked; mbRender(); });
      row.querySelectorAll(".mb-biz").forEach((c) => c.addEventListener("change", (e) => {
        const v = e.target.dataset.v;
        m.businesses = e.target.checked ? [...new Set([...m.businesses, v])] : m.businesses.filter((x) => x !== v);
      }));
      row.querySelectorAll(".mb-role").forEach((c) => c.addEventListener("change", (e) => {
        const v = e.target.dataset.v;
        m.roles = e.target.checked ? [...new Set([...m.roles, v])] : m.roles.filter((x) => x !== v);
        mbRender();
      }));
      q(".mb-del").addEventListener("click", () => {
        if (!confirm(`${m.name || m.email} をメンバーから外します。よろしいですか？（保存を押すまで反映されません）`)) return;
        mbState.members.splice(i, 1); mbRender();
      });

      row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", String(i)); row.classList.add("mb-drag"); });
      row.addEventListener("dragend", () => row.classList.remove("mb-drag"));
      row.addEventListener("dragover", (e) => e.preventDefault());
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
        if (!Number.isFinite(from) || from === i) return;
        const moved = mbState.members.splice(from, 1)[0];
        mbState.members.splice(i, 0, moved);
        mbRender();
      });
      box.appendChild(row);
    });
  }

  // 内訳のまとめ
  const count = (r) => mbState.members.filter((m) => m.active !== false && m.roles.includes(r)).length;
  const sum = document.createElement("p");
  sum.className = "note mb-sum";
  sum.innerHTML = `在籍 <b>${mbState.members.filter((m) => m.active !== false).length}</b>名` +
    `／クローザー <b>${count("closer")}</b>名・インサイド <b>${count("inside")}</b>名・予備 <b>${count("fallback")}</b>名` +
    `／チーム <b>${teamNames.length}</b>`;
  box.appendChild(sum);

  // 未登録の候補
  const cand = document.getElementById("mbCandidates");
  if (cand) {
    const rest = mbState.candidates.filter((c) => !mbState.members.some((m) => m.email === c.email));
    cand.innerHTML = rest.length
      ? `<p class="note">未登録の人がいます：${rest.map((c) =>
          `<button type="button" class="btn ghost mb-quick" data-e="${mbEsc(c.email)}" data-n="${mbEsc(c.name)}">${mbEsc(c.name)} を追加</button>`).join(" ")}</p>`
      : "";
    cand.querySelectorAll(".mb-quick").forEach((b) => b.addEventListener("click", () => {
      mbAddMember(b.dataset.n, b.dataset.e);
    }));
  }
}

function mbAddMember(name, email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) { mbSay("メールアドレスを入力してください", 3000); return; }
  if (mbState.members.some((m) => m.email === e)) { mbSay("すでに登録されています", 3000); return; }
  mbState.members.push({
    email: e, name: String(name || "").trim() || e,
    businesses: [], team: "", roles: [], active: true, daily_cap: null, profile: {},
  });
  mbRender();
  mbSay("追加しました。役割を選んで［保存］を押してください", 5000);
}

(function () {
  const add = document.getElementById("mbAdd");
  if (add) add.addEventListener("click", () => {
    const n = document.getElementById("mbName");
    const e = document.getElementById("mbEmail");
    mbAddMember(n.value, e.value);
    n.value = ""; e.value = "";
  });
  const save = document.getElementById("mbSave");
  if (save) save.addEventListener("click", async () => {
    // 入力漏れを先に知らせる
    const bad = mbState.members.find((m) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.email || ""));
    if (bad) { mbSay(`メールアドレスを確認してください：${bad.name || "(名前なし)"}`); return; }
    const noRole = mbState.members.filter((m) => m.active !== false && !m.roles.length);
    if (noRole.length && !confirm(
      `役割が未設定の人がいます（${noRole.map((m) => m.name).join("、")}）。\nこのままでは割り振りにも照合にも使われません。保存しますか？`)) return;

    save.disabled = true;
    mbSay("保存中…");
    try {
      const r = await fetch("/api/members", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ members: mbState.members }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "保存に失敗しました");
      const sy = d.sync || {};
      mbSay(`保存しました（クローザー${sy.closers ?? 0}名・インサイド${sy.interns ?? 0}名に反映）`, 6000);
      await loadMembers();
    } catch (e) {
      mbSay("保存に失敗しました: " + e.message);
    } finally { save.disabled = false; }
  });
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
    const mode = document.getElementById("apoInviteMode");
    if (mode) mode.value = d.mode || "closer";
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
          mode: (document.getElementById("apoInviteMode") || {}).value || "closer",
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
          if (!r.ok) { const d = await r.json().catch(() => ({})); kbNotify(d.error || "削除できませんでした"); }
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
    if (/[\/"'\\]/.test(name)) return kbNotify("/ \" ' \\ は使えません");
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
      kbNotify("保存に失敗: " + e.message);
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
      } catch (e) { kbNotify("担当者の切り替えに失敗しました: " + e.message); }
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
      } catch (e) { kbNotify("保存に失敗しました: " + e.message); }
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
      } catch (e) { kbNotify("作成に失敗しました: " + e.message); }
      finally { createBtn.disabled = false; }
    });
  }
}

// インサイト自動分析：手動で「今すぐ全対象を分析」
(function () {
  const btn = document.getElementById("runAllInsightsBtn");
  const msg = document.getElementById("runAllInsightsMsg");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "開始しています…";
    try {
      const r = await fetch("/api/report/insights/run-all", { method: "POST" });
      const d = await r.json();
      if (msg) {
        msg.hidden = false;
        msg.textContent = d.started ? "分析を開始しました（完了まで数分かかります）" : (d.message || "すでに実行中です");
      }
    } catch (e) {
      if (msg) { msg.hidden = false; msg.textContent = "開始に失敗しました: " + e.message; }
    } finally {
      btn.textContent = orig;
      btn.disabled = false;
      setTimeout(() => { if (msg) msg.hidden = true; }, 6000);
    }
  });
})();

// ===== アカウント設定（表示名・パスワード変更） =====
(function () {
  const email = document.getElementById("accEmail");
  const nameI = document.getElementById("accName");
  if (!email || !nameI) return;
  // 現在の情報を読み込み
  fetch("/api/me").then((r) => r.json()).then((d) => {
    email.value = d.username || "";
    nameI.value = d.name || "";
  }).catch(() => {});

  const saveName = document.getElementById("accSaveName");
  const nameSaved = document.getElementById("accNameSaved");
  if (saveName) saveName.addEventListener("click", async () => {
    saveName.disabled = true;
    try {
      const r = await fetch("/api/me", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: nameI.value }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "保存に失敗しました");
      if (nameSaved) { nameSaved.hidden = false; nameSaved.textContent = "保存しました"; setTimeout(() => (nameSaved.hidden = true), 4000); }
    } catch (e) { kbNotify(e.message); }
    finally { saveName.disabled = false; }
  });

  const savePw = document.getElementById("accSavePw");
  const pwSaved = document.getElementById("accPwSaved");
  if (savePw) savePw.addEventListener("click", async () => {
    const cur = document.getElementById("accPwCur").value;
    const nw = document.getElementById("accPwNew").value;
    const nw2 = document.getElementById("accPwNew2").value;
    if (!nw || nw.length < 8) return kbNotify("新しいパスワードは8文字以上にしてください");
    if (nw !== nw2) return kbNotify("新しいパスワード（確認）が一致しません");
    savePw.disabled = true;
    try {
      const r = await fetch("/api/me", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ current_password: cur, new_password: nw }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "変更に失敗しました");
      document.getElementById("accPwCur").value = ""; document.getElementById("accPwNew").value = ""; document.getElementById("accPwNew2").value = "";
      if (pwSaved) { pwSaved.hidden = false; pwSaved.textContent = "パスワードを変更しました"; setTimeout(() => (pwSaved.hidden = true), 5000); }
    } catch (e) { kbNotify(e.message); }
    finally { savePw.disabled = false; }
  });
})();

// 案件名バックフィル：既存の案件名から会社名だけを取り出して書き直す
(function () {
  const btn = document.getElementById("backfillNamesBtn");
  const msg = document.getElementById("backfillNamesMsg");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!confirm("既存の全案件名を、会社名部分だけに書き直します。\n\nこの操作は元に戻せません。実行しますか？")) return;
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "整理中…";
    try {
      const r = await fetch("/api/deals/backfill-names", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "実行に失敗しました");
      const sampleLines = (d.sample || []).slice(0, 5).map((s) => `・「${s.before}」→「${s.after}」`).join("\n");
      kbNotify(`完了：${d.total}件中 ${d.updated}件の案件名を書き直しました。\n\n例：\n${sampleLines || "（変更なし）"}`);
      if (msg) { msg.hidden = false; msg.textContent = `${d.updated}件を書き直しました`; setTimeout(() => (msg.hidden = true), 6000); }
    } catch (e) {
      kbNotify("失敗: " + e.message);
    } finally {
      btn.textContent = orig;
      btn.disabled = false;
    }
  });
})();

// ステータス同期修復：deal_status（手動設定）→ deals.status（集計用）の不整合を直す
(function () {
  const btn = document.getElementById("syncStatusBtn");
  const msg = document.getElementById("syncStatusMsg");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!confirm("画面のステータスに合わせて、内部の集計用データを一括更新します。実行しますか？")) return;
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "同期中…";
    try {
      const r = await fetch("/api/deals/sync-status", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "実行に失敗しました");
      const sampleLines = (d.sample || []).slice(0, 5).map((s) => `・${s.company}: 「${s.before}」→「${s.after}」`).join("\n");
      kbNotify(`完了：${d.total}件中 ${d.updated}件を同期しました。\n\n${sampleLines ? "例：\n" + sampleLines : "（すべて既に一致していました）"}`);
      if (msg) { msg.hidden = false; msg.textContent = `${d.updated}件を同期しました`; setTimeout(() => (msg.hidden = true), 6000); }
    } catch (e) {
      kbNotify("失敗: " + e.message);
    } finally {
      btn.textContent = orig;
      btn.disabled = false;
    }
  });
})();

// ===== 商談から集めた質問と回答 =====
(function () {
  const $q = (id) => document.getElementById(id);
  const escQ = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  async function loadQaBank() {
    const box = $q("qaList");
    if (!box) return;
    box.innerHTML = '<div class="empty-state">読み込み中…</div>';
    try {
      const q = ($q("qaQ") && $q("qaQ").value.trim()) || "";
      const r = await fetch("/api/qa-bank?q=" + encodeURIComponent(q));
      const d = await r.json();
      const items = d.items || [];
      const st = $q("qaStatus");
      if (st) st.textContent = `${items.length}件`;
      box.innerHTML = items.length
        ? items.map((x) => `<div class="qa-row" data-id="${x.id}">
            <div class="qa-row-main">
              <div class="qa-row-q">${escQ(x.question)}</div>
              <div class="qa-row-a">${escQ(x.answer)}</div>
              <div class="qa-row-meta">${escQ(x.topic || "その他")}${x.rep_name ? " ・ " + escQ(x.rep_name) : ""}${x.company ? " ・ " + escQ(x.company) : ""}${x.good ? " ・ 使えた " + x.good : ""}</div>
            </div>
            <div class="qa-row-act">
              <button type="button" class="btn ghost" data-qa-good="${x.id}">使えた</button>
              <button type="button" class="btn ghost" data-qa-del="${x.id}">削除</button>
            </div>
          </div>`).join("")
        : '<div class="empty-state">まだ集まっていません。商談を録音すると自動でたまります。</div>';
    } catch (e) {
      box.innerHTML = '<div class="empty-state">読み込みに失敗しました。</div>';
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const btn = $q("qaSearch");
    if (btn) btn.addEventListener("click", loadQaBank);
    const inp = $q("qaQ");
    if (inp) inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); loadQaBank(); } });
    const imp = $q("qaImport");
    if (imp) imp.addEventListener("click", async () => {
      const note = $q("qaImportNote");
      imp.disabled = true;
      let total = 0, loops = 0;
      try {
        while (loops < 40) {
          loops++;
          if (note) note.textContent = `取り込み中… これまでに${total}件を追加しました`;
          const r = await fetch("/api/qa-bank/import", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ days: 90, max: 6 }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || "取り込みに失敗しました");
          total += d.added || 0;
          if (!d.processed || !d.remaining) {
            if (note) note.textContent = `取り込み完了。${total}件の質問と回答を追加しました。`;
            break;
          }
        }
      } catch (e) {
        if (note) note.textContent = "取り込みに失敗しました：" + e.message;
      } finally {
        imp.disabled = false;
        loadQaBank();
      }
    });

    const box = $q("qaList");
    if (box) box.addEventListener("click", async (e) => {
      const g = e.target.closest("[data-qa-good]");
      if (g) { await fetch("/api/qa-bank/" + g.dataset.qaGood + "/good", { method: "POST" }); loadQaBank(); return; }
      const d = e.target.closest("[data-qa-del]");
      if (d && confirm("この質問と回答を削除しますか？")) {
        await fetch("/api/qa-bank/" + d.dataset.qaDel, { method: "DELETE" });
        loadQaBank();
      }
    });
    if ($q("qaList")) loadQaBank();
  });
})();

// ===== 商談録画のGoogleドライブ移行 =====
(function () {
  const $d = (id) => document.getElementById(id);
  const escD = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let stop = false;

  async function check() {
    const st = $d("dmStatus");
    if (!st) return;
    st.textContent = "確認しています…";
    try {
      const days = ($d("dmDays") && $d("dmDays").value) || 180;
      const r = await fetch("/api/drive/archive-status?days=" + encodeURIComponent(days));
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "確認に失敗しました");
      st.innerHTML =
        `対象 ${d.meetings} 件のうち、<b>${d.savedToDrive} 件</b>がドライブに保存済み。` +
        `<b>${d.notSaved} 件</b>が未保存です。` +
        (d.auto ? "（これからの商談は自動で保存されます）" : "（自動保存は止まっています）");
    } catch (e) {
      st.textContent = "確認に失敗しました：" + e.message;
    }
  }

  async function start() {
    const st = $d("dmStatus"), log = $d("dmLog");
    const btn = $d("dmStart"), stopBtn = $d("dmStop");
    if (!st) return;
    stop = false;
    btn.disabled = true;
    stopBtn.hidden = false;
    log.innerHTML = "";
    let done = 0, loops = 0, offset = 0, noRec = 0, total = 0;
    const days = Number(($d("dmDays") && $d("dmDays").value) || 180);
    try {
      // 1) まずMuxに「ダウンロード用のMP4を作って」と全件ぶん頼む
      let pOffset = 0, asked = 0;
      for (let i = 0; i < 100 && !stop; i++) {
        st.innerHTML = `準備を依頼しています…（${pOffset} 件）`;
        const r = await fetch("/api/drive/migrate", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ days, prepareOnly: true, offset: pOffset, max: 20 }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "準備の依頼に失敗しました");
        asked += d.asked || 0;
        (d.errors || []).forEach((m) => {
          const p = document.createElement("div");
          p.className = "dm-log-line";
          p.textContent = m;
          log.appendChild(p);
        });
        pOffset += d.processed || 0;
        if (!d.remaining || !d.processed) break;
      }

      // 2) Muxが作り終わるのを待つ（動画の長さによって数分かかります）
      if (asked && !stop) {
        for (let sec = 180; sec > 0 && !stop; sec -= 5) {
          st.innerHTML = `Muxがダウンロード用ファイルを作っています… あと約 ${sec} 秒`;
          await new Promise((r) => setTimeout(r, 5000));
        }
      }

      // 3) ドライブへ保存する
      while (!stop && loops < 800) {
        loops++;
        st.innerHTML = `移行中… <b>${done} 件</b>を保存${total ? `（${offset}/${total} 件を確認）` : ""}`;
        const r = await fetch("/api/drive/migrate", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ days, max: 2, offset }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "移行に失敗しました");
        done += d.done || 0;
        total = d.total || total;
        noRec += (d.reasons && d.reasons["録画なし"]) || 0;
        // 保存できたぶんは一覧から消えるので位置は進めない。飛ばしたぶんだけ先へ進む。
        offset += Math.max(0, (d.processed || 0) - (d.done || 0));
        let scopeError = false;
        (d.errors || []).forEach((m) => {
          if (/権限がありません/.test(m)) scopeError = true;
          const p = document.createElement("div");
          p.className = "dm-log-line";
          p.textContent = m;
          log.appendChild(p);
        });
        if (scopeError) {
          st.innerHTML =
            'Googleの<b>書き込み権限</b>が足りません。下の「Google連携」カードから連携し直してください' +
            '（同意画面でドライブの項目にチェックを入れてください）。';
          break;
        }
        if (!d.processed || (!d.remaining && !d.done)) {
          st.innerHTML =
            `移行が終わりました。<b>${done} 件</b>を保存しました。` +
            (noRec ? `<br>${noRec} 件は録画が残っていないため保存できませんでした（Recallの保存期限切れ・Muxにも無し）。` : "");
          break;
        }
      }
      if (stop) st.innerHTML = `中止しました。ここまでに <b>${done} 件</b>を保存しています。`;
    } catch (e) {
      st.textContent = "移行に失敗しました：" + e.message;
    } finally {
      btn.disabled = false;
      stopBtn.hidden = true;
    }
  }

  async function probe() {
    const st = $d("dmStatus"), log = $d("dmLog");
    if (!st) return;
    st.textContent = "調べています…";
    log.innerHTML = "";
    try {
      const days = Number(($d("dmDays") && $d("dmDays").value) || 180);
      const r = await fetch("/api/drive/migrate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ days, probe: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "調査に失敗しました");
      st.innerHTML = `未保存 ${d.total} 件のうち、先頭5件を調べました。`;
      log.innerHTML = (d.probe || []).map((x) =>
        `<div class="dm-log-line">${escD(x.date)} ${escD(x.title)}｜Recallの録画：${x.recall ? "あり" : "なし"}｜Muxの録画：${x.mux ? "あり" : "なし"}${x.error ? "｜" + escD(x.error) : ""}</div>`
      ).join("");
    } catch (e) {
      st.textContent = "調査に失敗しました：" + e.message;
    }
  }

  // 録画の保存先フォルダを、kinbotのデータどおりに作り直す
  async function rebuildFolders() {
    const st = $d("dmStatus"), log = $d("dmLog"), btn = $d("dmRebuild");
    if (!st) return;
    if (!confirm("録画を「担当者 / ◯月 / ◯日」のフォルダへ並べ替え、空になったフォルダをゴミ箱へ送ります。よろしいですか？")) return;
    stop = false;
    btn.disabled = true;
    log.innerHTML = "";
    let moved = 0, already = 0, offset = 0, total = 0, trashed = 0, loops = 0;
    const addLog = (arr) => (arr || []).slice(0, 5).forEach((m) => {
      const p = document.createElement("div");
      p.className = "dm-log-line";
      p.textContent = m;
      log.appendChild(p);
    });
    try {
      // 1) 正しいフォルダへ移動
      while (!stop && loops < 400) {
        loops++;
        st.innerHTML = `並べ替え中… <b>${moved} 件</b>を移動${total ? `（${offset}/${total} 件を確認）` : ""}`;
        const r = await fetch("/api/drive/rebuild", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ phase: "move", offset, budget: 40, days: 730 }),
        });
        const text = await r.text();
        let d = {};
        try { d = JSON.parse(text); } catch { throw new Error("サーバーの応答が途切れました。もう一度押してください。"); }
        if (!r.ok) throw new Error([d.error, d.hint].filter(Boolean).join(" / ") || `並べ替えに失敗しました（HTTP ${r.status}）`);
        moved += d.moved || 0;
        already += d.already || 0;
        total = d.total || total;
        offset += d.processed || 0;
        addLog(d.errors);
        if (!d.processed || !d.remaining) break;
      }

      // 2) 空になったフォルダをゴミ箱へ
      loops = 0;
      let checked = 0, kept = 0, folders = 0;
      while (!stop && loops < 400) {
        loops++;
        st.innerHTML =
          `空フォルダを片付けています… 確認した数 <b>${checked}</b>／` +
          `ゴミ箱へ <b>${trashed}</b>／中身があり残した <b>${kept}</b>` +
          (folders ? `　（担当者フォルダは残り ${folders} 個）` : "");
        const r = await fetch("/api/drive/rebuild", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ phase: "clean", budget: 40 }),
        });
        const text = await r.text();
        let d = {};
        try { d = JSON.parse(text); } catch { throw new Error("サーバーの応答が途切れました。もう一度押してください。"); }
        if (!r.ok) throw new Error([d.error, d.hint].filter(Boolean).join(" / ") || `片付けに失敗しました（HTTP ${r.status}）`);
        trashed += d.trashed || 0;
        checked += d.checked || 0;
        kept += d.kept || 0;
        folders = d.folders || folders;
        addLog(d.errors);
        if (!d.more) break;
      }

      st.innerHTML =
        `作り直しが終わりました。<br>` +
        `録画の移動：<b>${moved} 件</b>${already ? `（${already} 件はすでに正しい場所）` : ""}<br>` +
        `フォルダの確認：<b>${checked} 個</b>　→　ゴミ箱へ <b>${trashed} 個</b>／中身があり残した <b>${kept} 個</b><br>` +
        (folders ? `いま担当者フォルダは <b>${folders} 個</b>です。まだ重複していれば、もう一度押してください。` : "");
    } catch (e) {
      st.textContent = "作り直しに失敗しました：" + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  // 文字起こしが消えて一覧に出なくなった商談を、ドライブの録画から復元する
  async function restoreHidden() {
    const st = $d("dmStatus"), log = $d("dmLog"), btn = $d("dmRestore");
    if (!st) return;
    btn.disabled = true;
    log.innerHTML = "";
    st.textContent = "一覧に出ていない商談を調べています…";
    try {
      const r = await fetch("/api/meetings/hidden?days=180");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "調査に失敗しました");
      const items = d.items || [];
      const withDrive = items.filter((x) => x.drive);
      log.innerHTML = items.slice(0, 30).map((x) =>
        `<div class="dm-log-line">${escD(x.date)} ${escD(x.title || x.botId)}｜録画：${x.drive ? "ドライブにあり" : "なし"}</div>`
      ).join("");
      if (!withDrive.length) {
        st.innerHTML = `一覧に出ていない商談は <b>${items.length} 件</b>です。うち録画が残っているものはありませんでした。`;
        return;
      }
      if (!confirm(`${withDrive.length} 件を、ドライブの録画から文字起こしし直します。1件あたり数分かかり、文字起こしの費用が発生します。進めますか？`)) {
        st.innerHTML = `${withDrive.length} 件が復元できます。`;
        return;
      }
      let done = 0;
      for (const x of withDrive) {
        st.innerHTML = `復元中… <b>${done}/${withDrive.length}</b> 件（${escD(x.title || x.botId)}）`;
        try {
          const rr = await fetch(`/api/meetings/${encodeURIComponent(x.botId)}/retranscribe`, { method: "POST" });
          const dd = await rr.json().catch(() => ({}));
          if (!rr.ok) throw new Error(dd.error || "失敗");
          done++;
        } catch (e) {
          const p = document.createElement("div");
          p.className = "dm-log-line";
          p.textContent = `${x.title || x.botId}: ${e.message}`;
          log.appendChild(p);
        }
      }
      st.innerHTML = `復元が終わりました。<b>${done} 件</b>の文字起こし・要約・分析をやり直しました。商談履歴を再読み込みしてください。`;
    } catch (e) {
      st.textContent = "復元に失敗しました：" + e.message;
    } finally {
      btn.disabled = false;
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const rs = $d("dmRestore"); if (rs) rs.addEventListener("click", restoreHidden);
    const rb = $d("dmRebuild"); if (rb) rb.addEventListener("click", rebuildFolders);
    const pb = $d("dmProbe"); if (pb) pb.addEventListener("click", probe);
    const c = $d("dmCheck"); if (c) c.addEventListener("click", check);
    const s = $d("dmStart"); if (s) s.addEventListener("click", start);
    const x = $d("dmStop"); if (x) x.addEventListener("click", () => { stop = true; });
  });
})();
