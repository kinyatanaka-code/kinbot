// dev.js — 開発メモの画面
//   1. 自己点検（kinbotが自分の動きを見る）
//   2. 画面の使いやすさの見直し
//   3. 直したいことの一覧
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nl = (s) => esc(s).replace(/\n/g, "<br>");
const when = (v) => {
  const d = new Date(v);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("ja-JP", { hour12: false }).slice(5, 16);
};
const setStatus = (id, t, ms) => {
  const e = $(id);
  if (!e) return;
  e.textContent = t || "";
  if (ms) setTimeout(() => { if (e.textContent === t) e.textContent = ""; }, ms);
};

// ─────────────────── 0. 自動で直す（1時間ごと） ───────────────────
async function aaLoad() {
  if (!$("aaRun")) return;
  try {
    const d = await (await fetch("/api/auto-apply")).json();
    $("aaRun").checked = !!d.enabled;
    $("aaApply").checked = !!(d.autoApply || (d.hours && !d.hours.inHours));
    $("aaFrom").value = d.hours?.from ?? 0;
    $("aaTo").value = d.hours?.to ?? 24;
    const state = !d.enabled ? "止まっています"
      : d.autoApply ? "動いています（直したら本番に入ります）"
      : "動いています（直したものはPRになります）";
    $("aaBox").innerHTML = `<span class="${d.enabled ? "cc-ok" : "cc-warn"}">いまの状態：${esc(state)}</span>` +
      `<br>いまは ${d.hours?.now ?? "-"} 時。入れてよい時間帯：${d.hours?.from ?? 0}〜${d.hours?.to ?? 24}時` +
      `（${d.hours?.inHours ? "いまは入れてよい時間です" : "いまは時間外なのでPRになります"}）`;
  } catch {}
}

async function aaSave() {
  setStatus("aaStatus", "保存しています…");
  try {
    await fetch("/api/auto-apply", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: $("aaRun").checked,
        autoApply: $("aaApply").checked,
        from: parseInt($("aaFrom").value, 10),
        to: parseInt($("aaTo").value, 10),
      }),
    });
    setStatus("aaStatus", "保存しました", 4000);
    aaLoad();
  } catch (e) { setStatus("aaStatus", "失敗：" + e.message, 6000); }
}

// ───────────────────────── 1. 自己点検 ─────────────────────────
// 自動で動いているかを、いちばん上に出す
function autoLine(a, on) {
  if (!a) return "";
  const t = (v) => (v ? when(v) : "まだ");
  const state = !on ? "自動：OFF"
    : a.timer ? "自動：動いています" : "自動：まもなく始まります（起動から数分お待ちください）";
  return `<div class="note ${on && a.timer ? "cc-ok" : "cc-warn"}">` +
    `${esc(state)}　／　最後に見た時刻：${esc(t(a.lastTry))}　／　最後に実行：${esc(t(a.lastRun))}<br>` +
    `いまの状態：${esc(a.reason || "")}</div>`;
}

function scRender(d) {
  const box = $("scBox");
  if (!box) return;
  const last = d.last;
  if (!last) { box.innerHTML = autoLine(d.auto, d.enabled) + '<div class="note">まだ点検していません。</div>'; return; }
  box.innerHTML = autoLine(d.auto, d.enabled) +
    `<div class="note">最後の点検：${esc(when(last.at))}　問題 ${last.bad}件</div>` +
    `<div class="cal-list">` + (last.checks || []).map((c) =>
      `<div class="cal-row ${c.ok ? "cal-ok" : "cal-ng"}">
         <div class="cal-head"><b>${esc(c.title)}</b></div>
         <div class="ap-rot-cnt">${esc(c.detail)}</div>
         ${!c.ok && c.fix ? `<div class="cal-verdict">直し方の案：${esc(c.fix)}</div>` : ""}
       </div>`).join("") + `</div>` +
    (d.proposal ? `<div class="note"><b>まとめた案</b><br>${nl(d.proposal)}</div>` : "");
}

async function scLoad() {
  if (!$("scOn")) return;
  try {
    const d = await (await fetch("/api/self-check")).json();
    $("scOn").checked = !!d.enabled;
    $("scEvery").value = d.every ?? 30;
    $("scHook").value = d.webhook || "";
    scRender(d);
  } catch {}
}

async function scSave() {
  setStatus("scStatus", "保存しています…");
  try {
    await fetch("/api/self-check", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: $("scOn").checked,
        every: parseInt($("scEvery").value, 10),
        webhook: $("scHook").value,
      }),
    });
    setStatus("scStatus", "保存しました", 4000);
    scLoad();
  } catch (e) { setStatus("scStatus", "失敗：" + e.message, 6000); }
}

async function scRun() {
  setStatus("scStatus", "点検しています…");
  try {
    const r = await fetch("/api/self-check/run", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    scRender({ last: d, proposal: d.proposal });
    setStatus("scStatus", d.bad ? `${d.bad}件見つかりました` : "問題ありません", 6000);
    load();
// 自動の状態は、開いたままでも分かるように少しずつ読み直す
setInterval(() => { scLoad(); urLoad(); aaLoad(); }, 30 * 1000);
  } catch (e) { setStatus("scStatus", "失敗：" + e.message, 6000); }
}

// ─────────────────── 2. 画面の使いやすさの見直し ───────────────────
function urRender(d) {
  const box = $("urBox");
  if (!box) return;
  const last = d.last;
  if (!last) {
    box.innerHTML = autoLine(d.auto, d.enabled) + `次に見るのは <b>${esc(d.nextPage || "")}</b> です。`;
    return;
  }
  box.innerHTML = autoLine(d.auto, d.enabled) +
    `<b>${esc(last.page)}</b>（${esc(when(last.at))}／${last.count || 0}件）<br>` + nl(last.text || "");
}

async function urLoad() {
  if (!$("urOn")) return;
  try {
    const d = await (await fetch("/api/ui-review")).json();
    $("urOn").checked = !!d.enabled;
    $("urEvery").value = d.every ?? 30;
    $("urPage").innerHTML = (d.pages || []).map((p) =>
      `<option value="${esc(p.file)}">${esc(p.name)}</option>`).join("");
    urRender(d);
  } catch {}
}

async function urSave() {
  setStatus("urStatus", "保存しています…");
  try {
    await fetch("/api/ui-review", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: $("urOn").checked, every: parseInt($("urEvery").value, 10) }),
    });
    setStatus("urStatus", "保存しました", 4000);
    urLoad();
  } catch (e) { setStatus("urStatus", "失敗：" + e.message, 6000); }
}

async function urRun() {
  setStatus("urStatus", "見ています…（少し時間がかかります）");
  try {
    const r = await fetch("/api/ui-review/run", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: $("urPage").value }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    urRender({ last: d });
    setStatus("urStatus", `${d.count || 0}件の案が出ました`, 6000);
    load();
  } catch (e) { setStatus("urStatus", "失敗：" + e.message, 6000); }
}

// ─────────────────── 3. 直したいことの一覧 ───────────────────
let KINDS = {};
let ITEMS = [];

function render() {
  const box = $("dnList");
  const showAll = $("dnAll").checked;
  const list = showAll ? ITEMS : ITEMS.filter((x) => x.status !== "done");
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
        <button type="button" class="btn ghost dn-drop">見送る（消す）</button>
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
  // 見送る＝一覧から消える。中身は覚えておくので、同じ案はもう出てこない。
  box.querySelectorAll(".dn-drop").forEach((b) =>
    b.addEventListener("click", async () => {
      const row = b.closest(".dk-row");
      row.style.opacity = "0.4";
      await fetch(`/api/dev-notes/${row.dataset.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "dropped" }),
      });
      row.remove();
      setStatus("dnStatus", "見送りました（同じ案はもう出ません）", 4000);
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
    box.innerHTML = nl(d.text || "") + (d.sent ? '<br><b class="cc-ok">Chatにも送りました。</b>' : "");
  } catch (e) { box.textContent = "失敗：" + e.message; }
}

// ───────────────────────── 画面の組み立て ─────────────────────────
$("dnAdd").addEventListener("click", async () => {
  const t = $("dnTitle").value.trim();
  if (!t) return;
  setStatus("dnStatus", "足しています…");
  try {
    await fetch("/api/dev-notes", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: t, kind: $("dnKind").value }),
    });
    $("dnTitle").value = "";
    setStatus("dnStatus", "足しました", 3000);
    load();
  } catch (e) { setStatus("dnStatus", "失敗：" + e.message, 6000); }
});
$("dnTitle").addEventListener("keydown", (e) => { if (e.key === "Enter") $("dnAdd").click(); });
$("dnReload").addEventListener("click", load);
$("dnAll").addEventListener("change", render);
$("dnSummary").addEventListener("click", () => summary(false));
$("dnSend").addEventListener("click", () => summary(true));

// まとめて見送りにする（溜まりすぎた案を一度に片づける）
async function bulkDrop(where, label) {
  const n = ITEMS.filter((x) => x.status !== "done" &&
    (where.source ? x.source === where.source : true) &&
    (where.kind ? x.kind === where.kind : true)).length;
  if (!n) { setStatus("dnStatus", "対象がありません", 4000); return; }
  if (!confirm(`${label}を ${n}件、見送って一覧から消します。\n` +
    `内容は覚えておくので、同じ案がまた出ることはありません。よろしいですか？`)) return;
  setStatus("dnStatus", "片づけています…");
  try {
    const r = await fetch("/api/dev-notes/bulk", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...where, status: "dropped" }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    setStatus("dnStatus", `${d.changed}件を消しました（同じ案はもう出ません）`, 5000);
    load();
  } catch (e) { setStatus("dnStatus", "失敗：" + e.message, 6000); }
}

$("dnDropUi").addEventListener("click", () => bulkDrop({ source: "画面の見直し" }, "画面の見直しの案"));
$("dnDropIdea").addEventListener("click", () => bulkDrop({ kind: "idea" }, "アイデア"));
if ($("dnDropErr")) $("dnDropErr").addEventListener("click", () => bulkDrop({ kind: "error" }, "エラー"));
if ($("dnDropAll")) $("dnDropAll").addEventListener("click", () => bulkDrop({ all: true }, "残っているもの全部"));

// 未対応をまとめてコピー（そのままClaudeに貼れる形）
$("dnCopy").addEventListener("click", () => {
  const list = ITEMS.filter((x) => x.status !== "done" && x.status !== "dropped");
  const text = list.map((x, i) =>
    `${i + 1}. [${KINDS[x.kind] || x.kind}] ${x.title}${x.hits > 1 ? `（${x.hits}回）` : ""}` +
    (x.detail ? `\n   ${String(x.detail).replace(/\n/g, " ").slice(0, 300)}` : "")).join("\n");
  navigator.clipboard.writeText(`kinbotで直したいこと（${list.length}件）\n\n${text}`)
    .then(() => setStatus("dnStatus", "コピーしました", 3000))
    .catch(() => setStatus("dnStatus", "コピーできませんでした", 4000));
});

// 開発メモのChat通知の入り切り
if ($("dnChatOn")) {
  (async () => {
    try {
      const d = await (await fetch("/api/dev-notes/chat")).json();
      $("dnChatOn").checked = d.enabled !== false;
    } catch {}
  })();
  $("dnChatSave").addEventListener("click", async () => {
    setStatus("dnChatStatus", "保存しています…");
    try {
      await fetch("/api/dev-notes/chat", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: $("dnChatOn").checked }),
      });
      setStatus("dnChatStatus", $("dnChatOn").checked ? "Chatへ送ります" : "Chatへは送りません", 4000);
    } catch (e) { setStatus("dnChatStatus", "失敗：" + e.message, 6000); }
  });
}

if ($("aaRun")) {
  $("aaSave").addEventListener("click", aaSave);
  aaLoad();
}
if ($("scOn")) {
  $("scSave").addEventListener("click", scSave);
  $("scRun").addEventListener("click", scRun);
  scLoad();
}
if ($("urOn")) {
  $("urSave").addEventListener("click", urSave);
  $("urRun").addEventListener("click", urRun);
  urLoad();
}
load();
