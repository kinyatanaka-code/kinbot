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
      <tr><td>公開URL</td><td>${st.publicUrl || "-"}</td></tr>`;
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
  try {
    const res = await fetch("/api/calendar/status");
    const d = await res.json();
    if (!d.configured) {
      statusEl.textContent = "未設定（GOOGLE_CLIENT_ID / SECRET が必要）";
      eventsEl.innerHTML = "";
      return;
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
    });
  });
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
