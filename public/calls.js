// calls.js — コールリスト
//
// インターン生が上から順にかけていく画面。
// 1件ずつ大きく出し、結果はボタン1つで記録して次へ進む。
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let listId = 0;
let target = null;
let busy = false;

function say(id, t, ms) {
  const e = $(id);
  if (!e) return;
  e.textContent = t || "";
  if (ms) setTimeout(() => { if (e.textContent === t) e.textContent = ""; }, ms);
}

// 電話番号から、かけるときに使う数字だけを取り出す（ハイフンやカッコを外す）
function telOf(v) {
  // 全角の数字で入っていることがあるので、半角にそろえてから取り出す
  return String(v || "").normalize("NFKC").replace(/[^0-9+]/g, "");
}

// 日本時間で「8/12 14:30」の形にする
function when(v) {
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
}

// ───────── リストを選ぶ ─────────
async function loadLists() {
  try {
    const d = await (await fetch("/api/calls/lists")).json();
    const items = d.items || [];
    const sel = $("clList");
    sel.innerHTML = items.length
      ? items.map((x) => `<option value="${x.id}">${esc(x.name)}（残り ${x.残り}）</option>`).join("")
      : `<option value="">まだリストがありません</option>`;
    if (items.length) {
      listId = Number(sel.value);
      showProgress(items.find((x) => x.id === listId));
      loadNext();
    }
  } catch (e) { say("clStatus", "読み込めませんでした：" + e.message, 8000); }
}

function showProgress(x) {
  const el = $("clProg");
  if (!el || !x) return;
  const pct = x.全部 ? Math.round((x.済み / x.全部) * 100) : 0;
  el.innerHTML =
    `<span class="cl-bar"><span class="cl-bar-in" style="width:${pct}%"></span></span>` +
    `<span class="cl-num">残り ${x.残り} / ${x.全部}件</span>`;
}

// ───────── 次の1件を出す ─────────
async function loadNext() {
  const box = $("clTarget");
  if (!listId) { box.innerHTML = '<div class="empty-state">リストを選んでください。</div>'; return; }
  box.innerHTML = '<div class="empty-state">読み込んでいます…</div>';
  try {
    const d = await (await fetch(`/api/calls/next?list=${listId}`)).json();
    if (d.error) throw new Error(d.error);
    if (d.done) {
      target = null;
      box.innerHTML = '<div class="cl-done">このリストは終わりました。お疲れさまでした。</div>';
      return;
    }
    target = d.target;
    const past = d["履歴"] || [];
    const kinds = d["結果の種類"] || [];
    box.innerHTML = `
      <div class="cl-card">
        <div class="cl-co">${esc(target.company || "（会社名なし）")}</div>
        ${target.phone
          ? `<a class="cl-tel" href="tel:${esc(telOf(target.phone))}">${esc(target.phone)}</a>
             <span class="cl-telnote">押すと電話がかかります</span>`
          : `<span class="cl-nophone">電話番号が入っていません</span>`}
        <div class="cl-meta">
          ${[target.person && `担当：${esc(target.person)}`,
             target.industry && esc(target.industry),
             target.area && esc(target.area),
             target.email && esc(target.email)].filter(Boolean).join("　")}
        </div>
        ${target.memo ? `<div class="cl-memo">${esc(target.memo)}</div>` : ""}
        ${past.length ? `<div class="cl-past">
            <div class="cl-past-lb">これまでのやり取り</div>
            ${past.map((h) => `<div class="cl-past-row">
              <span class="cl-past-at">${esc(when(h.at))}</span>
              <span class="cl-past-r">${esc(h["結果"])}</span>
              <span class="cl-past-m">${esc(h["メモ"] || "")}</span>
            </div>`).join("")}
          </div>` : ""}

        <div class="cl-lb">結果を選ぶ</div>
        <div class="cl-results">
          ${kinds.map((k) => `<button type="button" class="cl-r${k === "アポ獲得" ? " on" : ""}" data-r="${esc(k)}">${esc(k)}</button>`).join("")}
        </div>
        <label class="cl-memolb">メモ（任意）
          <textarea id="clMemo" rows="2" placeholder="担当者は佐藤様・14時以降が良いとのこと"></textarea>
        </label>
        <div class="cl-foot">
          <button type="button" class="btn" id="clNext">記録して次へ</button>
          <button type="button" class="btn ghost" id="clSkip">とばす</button>
          <span class="rev-status" id="clSaveSt"></span>
        </div>
      </div>`;

    let picked = "";
    box.querySelectorAll(".cl-r").forEach((b) =>
      b.addEventListener("click", () => {
        picked = b.dataset.r;
        box.querySelectorAll(".cl-r").forEach((x) => x.classList.toggle("on", x === b));
      }));
    $("clNext").addEventListener("click", () => save(() => picked));
    $("clSkip").addEventListener("click", () => { loadNext(); });
  } catch (e) {
    box.innerHTML = `<div class="empty-state">読み込めませんでした：${esc(e.message)}</div>`;
  }
}

// ───────── 記録して次へ ─────────
async function save(getPicked) {
  if (busy || !target) return;
  const result = getPicked();
  if (!result) { say("clSaveSt", "結果を選んでください", 4000); return; }
  busy = true;
  say("clSaveSt", "記録しています…");
  try {
    const r = await fetch("/api/calls/record", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetId: target.id, leadId: target.leadId, company: target.company,
        result, memo: ($("clMemo") && $("clMemo").value) || "",
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "記録できませんでした");
    say("clSaveSt", "");
    loadLists();       // 残り件数を数え直して、次の1件を出す
    loadStats();
  } catch (e) {
    say("clSaveSt", "失敗：" + e.message, 8000);
  } finally { busy = false; }
}

// ───────── 今日の実績 ─────────
async function loadStats() {
  const box = $("clStats");
  if (!box) return;
  try {
    const mine = $("clMine") && $("clMine").checked ? "&mine=1" : "";
    const d = await (await fetch(`/api/calls/stats?x=1${mine}`)).json();
    if (d.error) throw new Error(d.error);
    const s = d["合計"] || {};
    const rate = s.コール ? ((s.アポ / s.コール) * 100).toFixed(1) : "0.0";
    const touch = s.コール ? ((s.接触 / s.コール) * 100).toFixed(1) : "0.0";
    box.innerHTML =
      `<div class="cl-sum">コール ${s.コール || 0}　接触 ${s.接触 || 0}（${touch}%）　アポ ${s.アポ || 0}（${rate}%）</div>` +
      ((d.items || []).length
        ? `<table class="sh-table"><tr><th>誰</th><th>コール</th><th>接触</th><th>アポ</th></tr>` +
          d.items.map((x) => `<tr><td>${esc(x["誰"])}</td><td>${x["コール"]}</td><td>${x["接触"]}</td><td>${x["アポ"]}</td></tr>`).join("") +
          `</table>`
        : `<div class="note">まだ記録がありません。</div>`);
  } catch (e) { box.innerHTML = `<div class="note">読み込めませんでした：${esc(e.message)}</div>`; }
}

// ───────── リストを作る ─────────
async function createList(body) {
  say("clNewStatus", "作っています…");
  try {
    const r = await fetch("/api/calls/lists", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "作れませんでした");
    say("clNewStatus", `「${d.name}」を作りました（${d["件数"]}件）`, 8000);
    if ($("clPaste")) $("clPaste").value = "";
    loadLists();
  } catch (e) { say("clNewStatus", "失敗：" + e.message, 10000); }
}

// 画面ぜんたいでクリックを受け止める（途中で止まっても押せるように）
document.addEventListener("click", (ev) => {
  const t = ev.target && ev.target.closest ? ev.target.closest("button") : null;
  if (!t) return;
  if (t.id === "clFromSf") {
    ev.preventDefault();
    createList({
      name: $("clNewName").value, fromSalesforce: true,
      company: $("clSfCompany").value, limit: parseInt($("clSfLimit").value, 10) || 50,
    });
  }
  if (t.id === "clFromPaste") {
    ev.preventDefault();
    const lines = String($("clPaste").value || "").split(/\r?\n/).filter((l) => l.trim());
    const items = lines.map((l) => {
      const c = l.includes("\t") ? l.split("\t") : l.split(",");
      return { company: (c[0] || "").trim(), person: (c[1] || "").trim(), phone: (c[2] || "").trim() };
    }).filter((x) => x.company || x.phone);
    if (!items.length) { say("clNewStatus", "貼り付けた中身が読めませんでした", 6000); return; }
    createList({ name: $("clNewName").value, items });
  }
  if (t.id === "clStatsReload") { ev.preventDefault(); loadStats(); }
});

if ($("clList")) {
  $("clList").addEventListener("change", () => {
    listId = Number($("clList").value) || 0;
    loadNext();
    loadLists();
  });
}
if ($("clMine")) $("clMine").addEventListener("change", loadStats);

loadLists();
loadStats();
