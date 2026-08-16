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
  const box = $("wbList");
  if (!ITEMS.length) {
    box.innerHTML = '<div class="empty-state">メンバーが登録されていません（設定→メンバー管理）。</div>';
    return;
  }

  box.innerHTML =
    `<div class="note wb-sum">記入 ${done}/${ITEMS.length}人　振り返り ${rev}/${ITEMS.length}人</div>` +
    `<div class="wb-grid">` + ITEMS.map((x) => {
      const mine = String(x.member).toLowerCase() === String(ME).toLowerCase();
      return `<div class="wb-card${mine ? " wb-mine" : ""}" data-m="${esc(x.member)}" data-name="${esc(x.name)}">
        <div class="wb-name">
          ${esc(x.name)}${mine ? '<span class="wb-you">あなた</span>' : ""}
          <span class="wb-apo">今週のアポ ${x.apos}件</span>
        </div>
        <label class="wb-lb">テーマ（やり切ること）
          <input type="text" class="wb-f" data-k="theme" value="${esc(x.theme)}" placeholder="例：商談実施やりきる" />
        </label>
        <label class="wb-lb">定量目標
          <textarea class="wb-f" data-k="targets" rows="3" placeholder="例：アポ数 36件／商談実施 54件">${esc(x.targets)}</textarea>
        </label>
        <label class="wb-lb">具体的な施策
          <textarea class="wb-f" data-k="actions" rows="5" placeholder="例：17時半までのコール時間を3時間確保">${esc(x.actions)}</textarea>
        </label>
        <label class="wb-lb wb-review">振り返り（金曜の終礼）
          <textarea class="wb-f" data-k="review" rows="4" placeholder="できたこと／できなかったこと／来週やること">${esc(x.review)}</textarea>
        </label>
        <div class="wb-foot">
          <button type="button" class="btn ghost wb-copy">先週の内容を写す</button>
          <span class="wb-saved"></span>
        </div>
      </div>`;
    }).join("") + `</div>`;

  // 書き終えて離れたら保存する（打つたびに保存すると重いため）
  box.querySelectorAll(".wb-f").forEach((el) => {
    el.addEventListener("change", () => saveCard(el.closest(".wb-card")));
  });
  box.querySelectorAll(".wb-copy").forEach((b) =>
    b.addEventListener("click", () => copyLast(b.closest(".wb-card"))));
}

async function saveCard(card) {
  if (!card) return;
  const body = { week: WEEK, member: card.dataset.m, name: card.dataset.name };
  card.querySelectorAll(".wb-f").forEach((el) => { body[el.dataset.k] = el.value; });
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
