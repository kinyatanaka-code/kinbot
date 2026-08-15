// dev.js — 開発メモの画面。溜まった「直したいこと」を見て、状態を変える。
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let KINDS = {};
let ITEMS = [];

function say(t, ms) {
  const e = $("dnStatus");
  if (!e) return;
  e.textContent = t || "";
  if (ms) setTimeout(() => { if (e.textContent === t) e.textContent = ""; }, ms);
}

function when(v) {
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("ja-JP", { hour12: false }).slice(5, 16);
}

function render() {
  const box = $("dnList");
  const showAll = $("dnAll").checked;
  const list = showAll ? ITEMS : ITEMS.filter((x) => x.status !== "done" && x.status !== "dropped");
  if (!list.length) {
    box.innerHTML = '<div class="empty-state">いまは何もありません。</div>';
    return;
  }
  box.innerHTML = `<div class="dk-list">` + list.map((x) => `
    <div class="dk-row${x.status === "done" ? " dk-none" : ""}" data-id="${x.id}">
      <div class="dk-main">
        <div class="dk-t">
          <span class="home-badge dn-kind dn-${esc(x.kind)}">${esc(KINDS[x.kind] || x.kind)}</span>
          ${esc(x.title)}
          ${x.hits > 1 ? `<span class="dk-dim">（${x.hits}回）</span>` : ""}
        </div>
        <div class="dk-s">${esc(x.source || "")}　${esc(when(x.last_at))}${x.created_by ? "　" + esc(x.created_by) : ""}</div>
        ${x.detail ? `<div class="dk-s dk-dim">${esc(String(x.detail).slice(0, 300))}</div>` : ""}
      </div>
      <div class="dk-act">
        <button type="button" class="btn ghost dn-st" data-st="doing">やる</button>
        <button type="button" class="btn ghost dn-st" data-st="done">済み</button>
        <button type="button" class="btn ghost dn-st" data-st="dropped">見送り</button>
        <button type="button" class="btn ghost dn-del">削除</button>
      </div>
    </div>`).join("") + `</div>`;

  box.querySelectorAll(".dn-st").forEach((b) =>
    b.addEventListener("click", async () => {
      const row = b.closest(".dk-row");
      await fetch(`/api/dev-notes/${row.dataset.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: b.dataset.st }),
      });
      load();
    }));
  box.querySelectorAll(".dn-del").forEach((b) =>
    b.addEventListener("click", async () => {
      const row = b.closest(".dk-row");
      if (!confirm("この項目を消します。よろしいですか？")) return;
      await fetch(`/api/dev-notes/${row.dataset.id}`, { method: "DELETE" });
      load();
    }));
}

async function load() {
  try {
    const d = await (await fetch("/api/dev-notes")).json();
    KINDS = d.kinds || {};
    ITEMS = d.items || [];
    render();
  } catch (e) {
    $("dnList").innerHTML = `<div class="empty-state">読み込めませんでした：${esc(e.message)}</div>`;
  }
}

async function summary(send) {
  const box = $("dnSummaryBox");
  box.textContent = "まとめています…（少し時間がかかります）";
  try {
    const r = await fetch("/api/dev-notes/summary", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ send: !!send }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    box.innerHTML = esc(d.text || "").replace(/\n/g, "<br>") +
      (d.sent ? '<br><b class="cc-ok">Chatにも送りました。</b>' : "");
  } catch (e) { box.textContent = "失敗：" + e.message; }
}

$("dnAdd").addEventListener("click", async () => {
  const t = $("dnTitle").value.trim();
  if (!t) return;
  say("足しています…");
  try {
    await fetch("/api/dev-notes", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: t, kind: $("dnKind").value }),
    });
    $("dnTitle").value = "";
    say("足しました", 3000);
    load();
  } catch (e) { say("失敗：" + e.message, 6000); }
});
$("dnTitle").addEventListener("keydown", (e) => { if (e.key === "Enter") $("dnAdd").click(); });
$("dnReload").addEventListener("click", load);
$("dnAll").addEventListener("change", render);
$("dnSummary").addEventListener("click", () => summary(false));
$("dnSend").addEventListener("click", () => summary(true));

// 未対応をまとめてコピー（そのままClaudeに貼れる形）
$("dnCopy").addEventListener("click", () => {
  const list = ITEMS.filter((x) => x.status !== "done" && x.status !== "dropped");
  const text = list.map((x, i) =>
    `${i + 1}. [${KINDS[x.kind] || x.kind}] ${x.title}${x.hits > 1 ? `（${x.hits}回）` : ""}` +
    (x.detail ? `\n   ${String(x.detail).replace(/\n/g, " ").slice(0, 300)}` : "")).join("\n");
  navigator.clipboard.writeText(`kinbotで直したいこと（${list.length}件）\n\n${text}`)
    .then(() => say("コピーしました", 3000))
    .catch(() => say("コピーできませんでした", 4000));
});

load();
