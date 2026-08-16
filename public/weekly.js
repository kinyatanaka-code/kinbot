// weekly.js — 週のボード。
// ホワイトボードに書いていた「テーマ・定量目標・具体的な施策」と、
// 金曜の「振り返り」を、1人1枚のカードにまとめる。
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let WEEK = "";      // いま見ている週の月曜日
let ME = "";
let ITEMS = [];

function say(t, ms) {
  const e = $("wbStatus");
  if (!e) return;
  e.textContent = t || "";
  if (ms) setTimeout(() => { if (e.textContent === t) e.textContent = ""; }, ms);
}

function label(d) {
  const x = new Date(d + "T00:00:00");
  return `${x.getMonth() + 1}/${x.getDate()}`;
}

function addDays(d, n) {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

function render(d) {
  WEEK = d.week;
  ME = d.me || "";
  ITEMS = d.items || [];
  const isThis = d.week === d.thisWeek;
  $("wbRange").textContent = `${label(d.week)}（月）〜 ${label(d.weekEnd)}（日）${isThis ? "　今週" : ""}`;

  const done = ITEMS.filter((x) => x.written).length;
  const rev = ITEMS.filter((x) => x.reviewed).length;
  const acts = ITEMS.reduce((n, x) => n + (x.items || []).length, 0);
  const actsDone = ITEMS.reduce((n, x) => n + (x.items || []).filter((i) => i.done).length, 0);
  const box = $("wbList");
  if (!ITEMS.length) {
    box.innerHTML = '<div class="empty-state">メンバーが登録されていません（設定→メンバー管理）。</div>';
    return;
  }

  box.innerHTML =
    `<div class="note wb-sum">記入 ${done}/${ITEMS.length}人　振り返り ${rev}/${ITEMS.length}人` +
    (acts ? `　施策 ${actsDone}/${acts} 達成` : "") + `</div>` +
    `<div class="wb-grid">` + ITEMS.map((x) => {
      const mine = String(x.member).toLowerCase() === String(ME).toLowerCase();
      return `<div class="wb-card${mine ? " wb-mine" : ""}" data-m="${esc(x.member)}" data-name="${esc(x.name)}">
        <div class="wb-name">
          ${esc(x.name)}${mine ? '<span class="wb-you">あなた</span>' : ""}
          <span class="wb-apo">今週のアポ ${x.apos}件</span>
        </div>
        <label class="wb-lb">テーマ（やり切ること）
          <input type="text" class="wb-f" data-k="theme" value="${esc(x.theme)}" />
        </label>
        <label class="wb-lb">定量目標
          <textarea class="wb-f" data-k="targets" rows="2" >${esc(x.targets)}</textarea>
        </label>
        <div class="wb-lb">具体的な施策
          <div class="wb-items">${(x.items || []).map((it) => itemHtml(it)).join("")}</div>
          <button type="button" class="wb-add">＋ 施策を足す</button>
        </div>
        <label class="wb-lb wb-review">全体の振り返り（金曜の終礼）
          <textarea class="wb-f" data-k="review" rows="2" >${esc(x.review)}</textarea>
        </label>
        <div class="wb-foot">
          <button type="button" class="btn ghost wb-copy">先週の内容を写す</button>
          <span class="wb-saved"></span>
        </div>
      </div>`;
    }).join("") + `</div>`;

  wireCards(box);
}

// 施策1つぶんのカード。できたかどうかと、その施策の振り返りを書ける。
function itemHtml(it) {
  const id = esc(it.id || ("a" + Math.random().toString(36).slice(2, 8)));
  return `<div class="wb-item${it.done ? " done" : ""}" data-id="${id}">
    <div class="wb-item-top">
      <label class="wb-chk"><input type="checkbox" class="wb-done"${it.done ? " checked" : ""} />
        <span>できた</span></label>
      <input type="text" class="wb-text" value="${esc(it.text)}" />
      <button type="button" class="wb-del" title="この施策を消す">✕</button>
    </div>
    <textarea class="wb-item-rv" rows="2" >${esc(it.review)}</textarea>
  </div>`;
}

// カードの中の操作をつなぐ（作り直すたびに呼ぶ）
function wireCards(box) {
  box.querySelectorAll(".wb-f").forEach((el) => {
    el.addEventListener("change", () => saveCard(el.closest(".wb-card")));
  });
  box.querySelectorAll(".wb-copy").forEach((b) =>
    b.addEventListener("click", () => copyLast(b.closest(".wb-card"))));

  box.querySelectorAll(".wb-add").forEach((b) =>
    b.addEventListener("click", () => {
      const card = b.closest(".wb-card");
      const list = card.querySelector(".wb-items");
      const div = document.createElement("div");
      div.innerHTML = itemHtml({ id: "a" + Date.now(), text: "", done: false, review: "" });
      const el = div.firstElementChild;
      list.appendChild(el);
      wireItem(el, card);
      const t = el.querySelector(".wb-text");
      if (t) t.focus();
    }));

  box.querySelectorAll(".wb-item").forEach((el) => wireItem(el, el.closest(".wb-card")));
}

function wireItem(el, card) {
  el.querySelectorAll(".wb-text, .wb-item-rv").forEach((x) =>
    x.addEventListener("change", () => saveCard(card)));
  const done = el.querySelector(".wb-done");
  if (done) done.addEventListener("change", () => {
    el.classList.toggle("done", done.checked);
    saveCard(card);
  });
  const del = el.querySelector(".wb-del");
  if (del) del.addEventListener("click", () => {
    const t = (el.querySelector(".wb-text") || {}).value || "";
    if (t && !confirm(`「${t}」を消しますか？`)) return;
    el.remove();
    saveCard(card);
  });
}

async function saveCard(card) {
  if (!card) return;
  const body = { week: WEEK, member: card.dataset.m, name: card.dataset.name };
  card.querySelectorAll(".wb-f").forEach((el) => { body[el.dataset.k] = el.value; });
  body.items = [...card.querySelectorAll(".wb-item")].map((el) => ({
    id: el.dataset.id,
    text: (el.querySelector(".wb-text") || {}).value || "",
    done: !!(el.querySelector(".wb-done") || {}).checked,
    review: (el.querySelector(".wb-item-rv") || {}).value || "",
  }));
  const mark = card.querySelector(".wb-saved");
  if (mark) mark.textContent = "保存しています…";
  try {
    const r = await fetch("/api/weekly", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(((await r.json()) || {}).error || "保存できませんでした");
    if (mark) { mark.textContent = "保存しました"; setTimeout(() => (mark.textContent = ""), 2500); }
  } catch (e) {
    if (mark) mark.textContent = "失敗：" + e.message;
  }
}

async function copyLast(card) {
  if (!card) return;
  if (!confirm("先週の内容を写します。いま書いてある内容は上書きされます。よろしいですか？")) return;
  try {
    const r = await fetch("/api/weekly/copy-last", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ week: WEEK, member: card.dataset.m }),
    });
    const d = await r.json();
    if (!d.ok) { say(d.reason || "写せませんでした", 5000); return; }
    load(WEEK);
    say("先週の内容を写しました", 4000);
  } catch (e) { say("失敗：" + e.message, 6000); }
}

async function load(week) {
  try {
    const q = week ? `?week=${encodeURIComponent(week)}` : "";
    const d = await (await fetch("/api/weekly" + q)).json();
    if (d.error) throw new Error(d.error);
    render(d);
  } catch (e) {
    $("wbList").innerHTML = `<div class="empty-state">読み込めませんでした：${esc(e.message)}</div>`;
  }
}

// ===== 書き忘れへの声かけ =====
function wrSay(t, ms) {
  const e = $("wrStatus");
  if (!e) return;
  e.textContent = t || "";
  if (ms) setTimeout(() => { if (e.textContent === t) e.textContent = ""; }, ms);
}

// 書く人の設定
async function memLoad() {
  if (!$("wbMembers")) return;
  try {
    const d = await (await fetch("/api/weekly/members")).json();
    $("wbMembers").value = d["指定"] || "";
    const st = $("wbMemStatus");
    if (st) st.textContent = `いまの対象：${(d["いまの対象"] || []).join("、") || "（見つかりません）"}`;
  } catch {}
}

async function memSave() {
  const st = $("wbMemStatus");
  if (st) st.textContent = "保存しています…";
  try {
    const r = await fetch("/api/weekly/members", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ members: $("wbMembers").value }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    if (st) st.textContent = `いまの対象：${(d["いまの対象"] || []).join("、")}`;
    load(WEEK);
  } catch (e) { if (st) st.textContent = "失敗：" + e.message; }
}

async function wrLoad() {
  if (!$("wrOn")) return;
  try {
    const d = await (await fetch("/api/weekly/remind")).json();
    $("wrOn").checked = !!d.enabled;
    $("wrPlan").value = d.planHour ?? 8;
    $("wrReview").value = d.reviewHour ?? 17;
  } catch {}
}

async function wrSave() {
  wrSay("保存しています…");
  try {
    await fetch("/api/weekly/remind", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: $("wrOn").checked,
        planHour: parseInt($("wrPlan").value, 10),
        reviewHour: parseInt($("wrReview").value, 10),
      }),
    });
    wrSay("保存しました", 4000);
  } catch (e) { wrSay("失敗：" + e.message, 6000); }
}

async function wrRun(kind) {
  wrSay("送っています…");
  try {
    const r = await fetch("/api/weekly/remind/run", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind }),
    });
    const d = await r.json();
    if (d.error) throw new Error(d.error);
    wrSay(`${d.sent}人に送りました${(d.todo || []).length ? `（対象：${d.todo.join("、")}）` : ""}`, 8000);
  } catch (e) { wrSay("失敗：" + e.message, 6000); }
}

if ($("wbMembers")) {
  memLoad();
  $("wbMemSave").addEventListener("click", memSave);
}
if ($("wrOn")) {
  wrLoad();
  $("wrSave").addEventListener("click", wrSave);
  $("wrNow").addEventListener("click", () => wrRun("plan"));
  $("wrNowR").addEventListener("click", () => wrRun("review"));
}

$("wbPrev").addEventListener("click", () => load(addDays(WEEK, -7)));
$("wbNext").addEventListener("click", () => load(addDays(WEEK, 7)));
$("wbThis").addEventListener("click", () => load(""));

load("");
