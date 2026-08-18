// calls.js — kincall（架電ツール）
//
// リストを表で見て、そこから電話をかけ、結果を記録します。
// 「履歴」を押すと過去のやり取り、「記録」を押すと結果を入れる窓が開きます。
// 記録した内容は、Salesforceの活動履歴としても残ります。
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let listId = 0;
let rows = [];
let kinds = [];

function say(id, t, ms) {
  const e = $(id);
  if (!e) return;
  e.textContent = t || "";
  if (ms) setTimeout(() => { if (e.textContent === t) e.textContent = ""; }, ms);
}

// 電話番号から、かけるときの数字だけを取り出す（全角も直す）
function telOf(v) {
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
    const keep = sel.value;
    sel.innerHTML = items.length
      ? items.map((x) => `<option value="${x.id}">${esc(x.name)}（残り ${x["残り"]}）</option>`).join("")
      : `<option value="">まだリストがありません</option>`;
    if (keep && items.some((x) => String(x.id) === keep)) sel.value = keep;
    if (items.length) {
      listId = Number(sel.value);
      showProgress(items.find((x) => x.id === listId));
      loadTable();
    }
  } catch (e) { say("clStatus", "読み込めませんでした：" + e.message, 8000); }
}

function showProgress(x) {
  const el = $("clProg");
  if (!el || !x) return;
  const pct = x["全部"] ? Math.round((x["済み"] / x["全部"]) * 100) : 0;
  el.innerHTML =
    `<span class="cl-bar"><span class="cl-bar-in" style="width:${pct}%"></span></span>` +
    `<span class="cl-num">残り ${x["残り"]} / ${x["全部"]}件</span>`;
}

// ───────── 一覧（SFのリードレポートのような表） ─────────
async function loadTable() {
  const box = $("clTable");
  if (!listId) { box.innerHTML = '<div class="empty-state">リストを選んでください。</div>'; return; }
  box.innerHTML = '<div class="empty-state">読み込んでいます…</div>';
  try {
    const q = $("clFind") && $("clFind").value.trim();
    const d = await (await fetch(`/api/calls/targets?list=${listId}${q ? "&q=" + encodeURIComponent(q) : ""}`)).json();
    if (d.error) throw new Error(d.error);
    kinds = d["結果の種類"] || [];
    rows = d.items || [];
    render();
  } catch (e) {
    box.innerHTML = `<div class="empty-state">読み込めませんでした：${esc(e.message)}</div>`;
  }
}

function render() {
  const box = $("clTable");
  const hide = $("clHideDone") && $("clHideDone").checked;
  const list = hide ? rows.filter((x) => !x["済み"]) : rows;
  if (!list.length) {
    box.innerHTML = `<div class="empty-state">${hide && rows.length ? "全部かけ終わりました。" : "該当がありません。"}</div>`;
    return;
  }
  box.innerHTML =
    `<div class="kc-tablewrap"><table class="kc-table">
      <tr>
        <th>ステージ</th><th>会社名</th><th>担当者</th><th>電話番号</th>
        <th>メールアドレス</th><th>最終ステータス</th><th>履歴</th><th>記録</th>
      </tr>` +
    list.map((x) => `
      <tr class="${x["済み"] ? "kc-done" : ""}" data-id="${x.id}">
        <td>${esc(x["ステージ"] || "-")}</td>
        <td class="kc-co">${esc(x["会社名"] || "")}</td>
        <td>${esc(x["担当者"] || "")}</td>
        <td>${x["電話番号"]
          ? `<a class="kc-tel" href="tel:${esc(telOf(x["電話番号"]))}">${esc(x["電話番号"])}</a>`
          : `<span class="kc-none">なし</span>`}</td>
        <td class="kc-mail">${esc(x["メール"] || "")}</td>
        <td>${x["最終ステータス"]
          ? `<span class="kc-st">${esc(x["最終ステータス"])}</span>`
          : x["最終結果"] ? `<span class="kc-st kc-st-r">${esc(x["最終結果"])}</span>` : "-"}</td>
        <td><button type="button" class="kc-btn kc-hist" data-id="${x.id}">${x["履歴数"] ? `${x["履歴数"]}回` : "なし"}</button></td>
        <td><button type="button" class="kc-btn kc-rec" data-id="${x.id}">記録</button></td>
      </tr>`).join("") + `</table></div>`;

  box.querySelectorAll(".kc-hist").forEach((b) =>
    b.addEventListener("click", () => openHistory(b.dataset.id)));
  box.querySelectorAll(".kc-rec").forEach((b) =>
    b.addEventListener("click", () => openRecord(b.dataset.id)));
}

// ───────── 窓（モーダル） ─────────
function openModal(title, inner) {
  const back = document.createElement("div");
  back.className = "kc-modal-back";
  back.innerHTML =
    `<div class="kc-modal">
       <div class="kc-modal-head"><b>${esc(title)}</b>
         <button type="button" class="kc-modal-x" aria-label="閉じる">✕</button></div>
       <div class="kc-modal-body">${inner}</div>
     </div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.querySelector(".kc-modal-x").addEventListener("click", close);
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  document.addEventListener("keydown", function escKey(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", escKey); }
  });
  return { el: back, close };
}

// 履歴の窓
async function openHistory(id) {
  const m = openModal("これまでのやり取り", '<div class="note">読み込んでいます…</div>');
  try {
    const d = await (await fetch(`/api/calls/targets/${encodeURIComponent(id)}/history`)).json();
    if (d.error) throw new Error(d.error);
    const a = d["相手"] || {};
    const items = d.items || [];
    m.el.querySelector(".kc-modal-body").innerHTML =
      `<div class="kc-modal-co">${esc(a["会社名"] || "")}${a["担当者"] ? `　${esc(a["担当者"])}` : ""}</div>` +
      (items.length
        ? items.map((h) => `
            <div class="kc-hist-row">
              <div class="kc-hist-top">
                <span class="kc-hist-at">${esc(when(h.at))}</span>
                <span class="kc-hist-r">${esc(h["結果"])}</span>
                <span class="kc-hist-who">${esc(h["誰"] || "")}</span>
              </div>
              ${h["メモ"] ? `<div class="kc-hist-m">${esc(h["メモ"])}</div>` : ""}
            </div>`).join("")
        : `<div class="note">まだ記録がありません。</div>`);
  } catch (e) {
    m.el.querySelector(".kc-modal-body").innerHTML =
      `<div class="note">読み込めませんでした：${esc(e.message)}</div>`;
  }
}

// 記録の窓
function openRecord(id) {
  const x = rows.find((r) => String(r.id) === String(id));
  if (!x) return;
  const m = openModal("記録する", `
    <div class="kc-modal-co">${esc(x["会社名"] || "")}${x["担当者"] ? `　${esc(x["担当者"])}` : ""}</div>
    ${x["電話番号"] ? `<a class="kc-tel kc-tel-big" href="tel:${esc(telOf(x["電話番号"]))}">${esc(x["電話番号"])}</a>` : ""}
    ${x.leadId ? "" : `<div class="note cc-warn">この相手はSalesforceのリードと結びついていないため、活動履歴は残りません。</div>`}

    <div class="kc-lb">結果</div>
    <div class="kc-results">
      ${kinds.map((k) => `<button type="button" class="kc-r" data-r="${esc(k)}">${esc(k)}</button>`).join("")}
    </div>

    <div class="kc-lb">最終ステータス（任意）</div>
    <input type="text" class="kc-input" id="kcStatus" value="${esc(x["最終ステータス"] || "")}" placeholder="例：掘り起こし10月" />

    <div class="kc-lb">説明（任意）</div>
    <textarea class="kc-input" id="kcMemo" rows="3" placeholder="担当者は佐藤様・14時以降が良いとのこと"></textarea>

    <div class="kc-modal-foot">
      <button type="button" class="btn" id="kcSave">記録する</button>
      <span class="rev-status" id="kcSaveSt"></span>
    </div>`);

  let picked = "";
  m.el.querySelectorAll(".kc-r").forEach((b) =>
    b.addEventListener("click", () => {
      picked = b.dataset.r;
      m.el.querySelectorAll(".kc-r").forEach((y) => y.classList.toggle("on", y === b));
    }));

  m.el.querySelector("#kcSave").addEventListener("click", async () => {
    if (!picked) { say("kcSaveSt", "結果を選んでください", 4000); return; }
    const btn = m.el.querySelector("#kcSave");
    btn.disabled = true;
    say("kcSaveSt", "記録しています…");
    try {
      const r = await fetch(`/api/calls/targets/${encodeURIComponent(id)}/record`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          result: picked,
          memo: m.el.querySelector("#kcMemo").value,
          status: m.el.querySelector("#kcStatus").value,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "記録できませんでした");
      m.close();
      say("clStatus", d.sf && d.sf.ok
        ? "記録しました（Salesforceにも残しました）"
        : `記録しました${d.sf && d.sf.reason ? `（SFへは残せません：${d.sf.reason}）` : ""}`, 8000);
      loadLists();
      loadStats();
    } catch (e) {
      say("kcSaveSt", "失敗：" + e.message, 8000);
      btn.disabled = false;
    }
  });
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
    const rate = s["コール"] ? ((s["アポ"] / s["コール"]) * 100).toFixed(1) : "0.0";
    const touch = s["コール"] ? ((s["接触"] / s["コール"]) * 100).toFixed(1) : "0.0";
    box.innerHTML =
      `<div class="cl-sum">コール ${s["コール"] || 0}　接触 ${s["接触"] || 0}（${touch}%）　アポ ${s["アポ"] || 0}（${rate}%）</div>` +
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
    }).filter((y) => y.company || y.phone);
    if (!items.length) { say("clNewStatus", "貼り付けた中身が読めませんでした", 6000); return; }
    createList({ name: $("clNewName").value, items });
  }
  if (t.id === "clStatsReload") { ev.preventDefault(); loadStats(); }
});

if ($("clList")) {
  $("clList").addEventListener("change", () => {
    listId = Number($("clList").value) || 0;
    loadTable();
  });
}
if ($("clMine")) $("clMine").addEventListener("change", loadStats);
if ($("clHideDone")) $("clHideDone").addEventListener("change", render);
if ($("clFind")) {
  let timer = null;
  $("clFind").addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(loadTable, 250);
  });
}

loadLists();
loadStats();
