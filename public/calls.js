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
      ? items.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")
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
  if (!el) return;
  // 残りの件数は出さない（リストを選ぶ欄にも出ていて、二重になるため）
  el.innerHTML = "";
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

// 絞り込みと並べ替えの状態
const filt = { stage: new Set(), status: new Set(), hist: "" };
let sortBy = "", sortDesc = false;

// いま出すぶんを決める
function visibleRows() {
  let list = rows.slice();
  if (filt.stage.size) list = list.filter((x) => filt.stage.has(x["ステージ"] || ""));
  if (filt.status.size) list = list.filter((x) => filt.status.has(x["最終ステータス"] || ""));
  if (filt.hist === "none") list = list.filter((x) => !x["履歴数"]);
  if (filt.hist === "some") list = list.filter((x) => x["履歴数"] > 0);
  const q = ($("clFind") && $("clFind").value || "").trim().toLowerCase();
  if (q) {
    const norm = (v) => String(v || "").replace(/[\s　-]/g, "").toLowerCase();
    list = list.filter((x) =>
      [x["会社名"], x["担当者"], x["電話番号"], x["メール"]].some((f) => norm(f).includes(norm(q))));
  }
  if (sortBy) {
    const key = { stage: "ステージ", company: "会社名", status: "最終ステータス", hist: "履歴数" }[sortBy];
    list.sort((a, b) => {
      const A = a[key], B = b[key];
      const n = (typeof A === "number") ? A - B : String(A || "").localeCompare(String(B || ""), "ja");
      return sortDesc ? -n : n;
    });
  }
  return list;
}

// 絞り込みの窓を出す（チェックで選ぶ）
function openFilter(which, btn) {
  const key = which === "stage" ? "ステージ" : "最終ステータス";
  const all = [...new Set(rows.map((x) => x[key] || "").filter(Boolean))].sort();
  const cur = filt[which];
  const inner =
    `<div class="kc-flt-list">` +
    all.map((v) => `<label class="kc-flt-row">
       <input type="checkbox" value="${esc(v)}"${cur.size === 0 || cur.has(v) ? " checked" : ""} />
       <span>${esc(v)}</span>
       <span class="kc-flt-n">${rows.filter((x) => (x[key] || "") === v).length}</span>
     </label>`).join("") + `</div>
     <div class="kc-modal-foot">
       <button type="button" class="btn" id="fltOk">この条件で見る</button>
       <button type="button" class="btn ghost" id="fltAll">すべて</button>
     </div>`;
  const m = openModal(`${key}でしぼる`, inner);
  m.el.querySelector("#fltOk").addEventListener("click", () => {
    const picked = [...m.el.querySelectorAll("input:checked")].map((c) => c.value);
    filt[which] = picked.length === all.length ? new Set() : new Set(picked);
    m.close(); render();
  });
  m.el.querySelector("#fltAll").addEventListener("click", () => {
    filt[which] = new Set(); m.close(); render();
  });
}

function render() {
  const box = $("clTable");
  const list = visibleRows();
  const arrow = (k) => sortBy === k ? (sortDesc ? " ▾" : " ▴") : "";
  const on = (k) => filt[k] && filt[k].size ? " on" : "";
  if (!list.length) {
    box.innerHTML = `<div class="empty-state">${rows.length ? "この条件に当てはまるものがありません。" : "リストを選んでください。"}</div>`;
    return;
  }
  box.innerHTML =
    `<div class="kc-tablewrap"><table class="kc-table">
      <tr>
        <th class="kc-th-s"><button type="button" class="kc-th-b${on("stage")}" data-flt="stage">ステージ ▾</button></th>
        <th><button type="button" class="kc-th-b" data-sort="company">会社名${arrow("company")}</button></th>
        <th class="kc-th-p">担当者</th>
        <th class="kc-th-t">電話番号</th>
        <th class="kc-th-m">メールアドレス</th>
        <th class="kc-th-s"><button type="button" class="kc-th-b${on("status")}" data-flt="status">最終ステータス ▾</button></th>
        <th class="kc-th-h"><button type="button" class="kc-th-b${filt.hist ? " on" : ""}" data-hist="1">履歴${arrow("hist")}</button></th>
        <th class="kc-th-r">記録</th>
      </tr>` +
    list.map((x) => `
      <tr data-id="${x.id}">
        <td>${esc(x["ステージ"] || "-")}</td>
        <td class="kc-co">${esc(x["会社名"] || "")}</td>
        <td>${esc(x["担当者"] || "")}</td>
        <td>${x["電話番号"]
          ? `<a class="kc-tel" href="tel:${esc(telOf(x["電話番号"]))}">${esc(x["電話番号"])}</a>`
          : `<span class="kc-none">なし</span>`}</td>
        <td class="kc-mail">${esc(x["メール"] || "")}</td>
        <td>${x["最終ステータス"] ? esc(x["最終ステータス"]) : "-"}</td>
        <td><button type="button" class="kc-btn kc-hist" data-id="${x.id}">${x["履歴数"] ? `${x["履歴数"]}件` : "なし"}</button></td>
        <td><button type="button" class="kc-btn kc-rec" data-id="${x.id}">記録</button></td>
      </tr>`).join("") + `</table></div>`;

  // 見出しの絞り込み・並べ替え
  box.querySelectorAll("[data-flt]").forEach((b) =>
    b.addEventListener("click", () => openFilter(b.dataset.flt, b)));
  box.querySelectorAll("[data-sort]").forEach((b) =>
    b.addEventListener("click", () => {
      if (sortBy === b.dataset.sort) sortDesc = !sortDesc;
      else { sortBy = b.dataset.sort; sortDesc = false; }
      render();
    }));
  const hb = box.querySelector("[data-hist]");
  if (hb) hb.addEventListener("click", () => {
    // 履歴は「なし → あり → 全部」で切り替える
    filt.hist = filt.hist === "" ? "none" : filt.hist === "none" ? "some" : "";
    if (!filt.hist) { sortBy = "hist"; sortDesc = !sortDesc; }
    render();
  });

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
      (d.note ? `<div class="note">${esc(d.note)}</div>` : "") +
      (items.length
        ? items.map((h) => `
            <div class="kc-hist-row">
              <div class="kc-hist-top">
                <span class="kc-hist-at">${esc(when(h.at))}</span>
                <span class="kc-hist-r">${esc(h["件名"] || h["結果"] || "")}</span>
                ${h["件名"] && h["結果"] ? `<span class="kc-hist-res">${esc(h["結果"])}</span>` : ""}
                <span class="kc-hist-who">${esc(h["誰"] || "")}</span>
                ${h["元"] === "salesforce" ? '<span class="kc-hist-sf">SF</span>' : ""}
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
// 架電の結果の選択肢（Salesforceから取ってくる）
let kcPicks = null;
async function loadPicks() {
  if (kcPicks) return kcPicks;
  try {
    const d = await (await fetch("/api/calls/picklists")).json();
    if (!d.error) kcPicks = d;
  } catch {}
  return kcPicks;
}

async function openRecord(id) {
  const x = rows.find((r) => String(r.id) === String(id));
  if (!x) return;
  // Salesforceの選択肢を使う（担当者不在・コールのみ・担当者接触：アポ獲得 など）
  const pk = await loadPicks();
  const 結果の選択肢 = (pk && pk["活動の結果"] && pk["活動の結果"].length)
    ? pk["活動の結果"].map((v) => v.label)
    : kinds;
  const 状態の選択肢 = (pk && pk["リードの状態"]) || [];
  const m = openModal("記録する", `
    <div class="kc-rec-top">
      <div>
        <div class="kc-modal-co">${esc(x["会社名"] || "")}${x["担当者"] ? `　${esc(x["担当者"])}` : ""}</div>
        ${x["電話番号"] ? `<a class="kc-tel kc-tel-big" href="tel:${esc(telOf(x["電話番号"]))}">${esc(x["電話番号"])}</a>` : ""}
      </div>
      <!-- いまのステージと、変えるところ -->
      <div class="kc-rec-stage">
        <div class="kc-lb">いまのステージ</div>
        <div class="kc-stage-now">${esc(x["ステージ"] || "（なし）")}</div>
        ${状態の選択肢.length
          ? `<select class="kc-input kc-stage-sel" id="kcStatus">
               <option value="">（変えない）</option>
               ${状態の選択肢.map((v) => `<option value="${esc(v.value)}">${esc(v.label)}</option>`).join("")}
             </select>`
          : `<input type="text" class="kc-input kc-stage-sel" id="kcStatus" placeholder="変えるときだけ" />`}
      </div>
    </div>
    ${x.leadId ? "" : `<div class="note cc-warn">この相手はSalesforceのリードと結びついていないため、活動履歴は残りません。</div>`}

    <div class="kc-lb">結果</div>
    <select class="kc-input" id="kcResult">
      <option value="">選んでください</option>
      ${結果の選択肢.map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join("")}
    </select>

    <div class="kc-lb">説明（任意）</div>
    <textarea class="kc-input" id="kcMemo" rows="3" placeholder="担当者は佐藤様・14時以降が良いとのこと"></textarea>

    <div class="kc-modal-foot">
      <button type="button" class="btn" id="kcSave">記録する</button>
      <span class="rev-status" id="kcSaveSt"></span>
    </div>`);

  const picked = () => (m.el.querySelector("#kcResult") || {}).value || "";

  m.el.querySelector("#kcSave").addEventListener("click", async () => {
    const 結果 = picked();
    if (!結果) { say("kcSaveSt", "結果を選んでください", 4000); return; }
    const btn = m.el.querySelector("#kcSave");
    btn.disabled = true;
    say("kcSaveSt", "記録しています…");
    try {
      const r = await fetch(`/api/calls/targets/${encodeURIComponent(id)}/record`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          result: 結果,
          memo: m.el.querySelector("#kcMemo").value,
          status: m.el.querySelector("#kcStatus").value,
          // Salesforceのリードの状態も、この値で書き換える
          leadStatus: m.el.querySelector("#kcStatus").value,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "記録できませんでした");

      // 読み込み直さず、その行だけを書き換える。
      // （毎回読み込むと、しぼり込みや見ている場所が消えてしまうため）
      const sel = m.el.querySelector("#kcStatus");
      if (sel && sel.value) {
        const lb = sel.tagName === "SELECT"
          ? (sel.options[sel.selectedIndex] || {}).textContent
          : sel.value;
        if (lb) x["ステージ"] = String(lb).trim();
      }
      x["履歴数"] = Number(x["履歴数"] || 0) + 1;
      x["最終ステータス"] = 結果;
      updateRow(x);
      m.close();
      const 代理 = d.sf && d.sf["代理"] ? `（${d.sf["代理"]}さんとして残しました）` : "";
      say("clStatus", d.sf && d.sf.ok
        ? `記録しました${代理 || "（Salesforceにも残しました）"}`
        : `記録しました${d.sf && d.sf.reason ? `（SFへは残せません：${d.sf.reason}）` : ""}`, 8000);
      // 実績の数だけ、そっと更新する（一覧は読み直さない）
      loadStats();
    } catch (e) {
      say("kcSaveSt", "失敗：" + e.message, 8000);
      btn.disabled = false;
    }
  });
}

// 表の1行だけを書き換える。
// 一覧ぜんたいを読み直さないので、しぼり込みや見ている場所がそのまま残る。
function updateRow(x) {
  const tr = document.querySelector(`.kc-table tr[data-id="${x.id}"]`);
  if (!tr) return;
  const td = tr.children;
  if (td[0]) td[0].textContent = x["ステージ"] || "-";
  if (td[5]) td[5].textContent = x["最終ステータス"] || "-";
  if (td[6]) {
    const b = td[6].querySelector("button");
    if (b) b.textContent = x["履歴数"] ? `${x["履歴数"]}件` : "なし";
  }
  // 記録したことが分かるよう、少し光らせる
  tr.classList.add("kc-just");
  setTimeout(() => tr.classList.remove("kc-just"), 1600);
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

if ($("clFind")) {
  let timer = null;
  $("clFind").addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(loadTable, 250);
  });
}

// ───────── 画面の切り替え ─────────
// メニューを押すと、その画面だけを出す（かける／今日の実績／リストを作る）
function showPane() {
  const p = new URLSearchParams(location.search).get("p") || "call";
  document.querySelectorAll(".kc-pane").forEach((el) => { el.hidden = el.dataset.p !== p; });
  document.querySelectorAll(".kc-side .side-item").forEach((a) => {
    const href = a.getAttribute("href") || "";
    const mine = href.includes("p=" + p) || (p === "call" && href === "/kincall");
    a.classList.toggle("active", mine);
  });
  if (p === "stats") loadStats();
  if (p === "assign") asLoad();
}

// 「kincallだけ」の人には、kinbotへ戻る道を見せない
(async () => {
  try {
    const me = await (await fetch("/api/me")).json();
    if (me && me.kincallOnly) {
      document.querySelectorAll(".kc-side .side-app, .kc-side .side-sep")
        .forEach((el) => el.remove());
    }
  } catch {}
})();

showPane();
loadLists();


// ───────── Salesforceのリードから入れる ─────────
let sfFound = [];

async function sfFind() {
  const st = $("clSfStatus"), box = $("clSfBox");
  if (st) st.textContent = "探しています…";
  box.innerHTML = "";
  try {
    const d = await (await fetch("/api/calls/from-leads", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        company: $("clSfCompany").value, person: $("clSfPerson").value,
        limit: parseInt($("clSfLimit").value, 10) || 30,
      }),
    })).json();
    if (d.error) throw new Error(d.error);
    sfFound = d.items || [];
    if (st) st.textContent = "";
    if (!sfFound.length) { box.innerHTML = '<div class="note">見つかりませんでした。</div>'; return; }
    box.innerHTML =
      `<div class="note"><b>${sfFound.length}件</b>見つかりました。入れるものを選んでください。</div>` +
      `<div class="kc-tablewrap"><table class="kc-table">
         <tr><th><input type="checkbox" class="sf-all" checked /></th>
             <th>ステージ</th><th>会社名</th><th>担当者</th><th>電話番号</th><th>リードの状態</th></tr>` +
      sfFound.map((x, i) => `<tr>
        <td><input type="checkbox" class="sf-pick" data-i="${i}" checked /></td>
        <td>${esc(x.stage || "-")}</td>
        <td class="kc-co">${esc(x.company)}</td>
        <td>${esc(x.person)}</td>
        <td>${esc(x.phone || "")}</td>
        <td>${esc(x.status || "")}</td>
      </tr>`).join("") + `</table></div>` +
      `<div class="ap-cfg-actions">
         <label>リストの名前 <input type="text" class="sf-name" value="${esc($("clNewName").value || "リード（" + new Date().toISOString().slice(5,10).replace("-","/") + "）")}" style="width:220px" /></label>
         <button type="button" class="btn sf-go">選んだものを入れる</button>
       </div>`;
    const all = box.querySelector(".sf-all");
    if (all) all.addEventListener("change", () =>
      box.querySelectorAll(".sf-pick").forEach((c) => { c.checked = all.checked; }));
    box.querySelector(".sf-go").addEventListener("click", () => sfPut(box));
  } catch (e) { if (st) st.textContent = "失敗：" + e.message; }
}

async function sfPut(box) {
  const picked = [...box.querySelectorAll(".sf-pick")]
    .filter((c) => c.checked).map((c) => sfFound[Number(c.dataset.i)]);
  if (!picked.length) { say("clSfStatus", "入れるものを選んでください", 5000); return; }
  const name = (box.querySelector(".sf-name") || {}).value || "リード";
  say("clSfStatus", "入れています…");
  try {
    // リストを作って、そこへ入れる
    const r = await fetch("/api/calls/lists", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, items: picked }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "入れられませんでした");
    say("clSfStatus", `「${d.name}」に${d["件数"]}件入れました`, 8000);
    box.innerHTML = "";
    loadLists();
  } catch (e) { say("clSfStatus", "失敗：" + e.message, 8000); }
}

document.addEventListener("click", (ev) => {
  const t = ev.target && ev.target.closest ? ev.target.closest("button") : null;
  if (!t) return;
  if (t.id === "clSfFind") { ev.preventDefault(); sfFind(); }
  if (t.id === "clCheck") {
    ev.preventDefault();
    (async () => {
      const m = openModal("履歴の件数を調べる", '<div class="note">調べています…</div>');
      try {
        const d = await (await fetch(`/api/calls/count-check?list=${listId}`)).json();
        const 生 = d["生の答え"];
        m.el.querySelector(".kc-modal-body").innerHTML =
          `<div class="kc-chk">
             <div><b>${esc(d.hint || "")}</b></div>
             <table class="sh-table">
               <tr><th>調べたこと</th><th>結果</th></tr>
               <tr><td>Salesforceを見る人</td><td>${esc(d["数える人"] || "-")}${d["代理を使った"] ? "（代わりに更新する人）" : ""}</td></tr>
               <tr><td>Salesforceにつながっているか</td><td>${d["つながっている"] ? "つながっています" : "つながっていません"}</td></tr>
               <tr><td>リードと結びついている数</td><td>${(d["リードのID"] || []).length}件（先頭5件を見ました）</td></tr>
               <tr><td>Salesforceからの答え</td><td>${生 ? `${生.length}件ぶん返ってきました` : "返ってきませんでした"}</td></tr>
               ${d["エラー"] ? `<tr><td>つまずいた内容</td><td class="cc-warn">${esc(d["エラー"])}</td></tr>` : ""}
             </table>
             <p class="note">リードと結びついていない場合は、<b>kinbotのリードレポートから送り直す</b>と結びつきます。</p>
           </div>`;
      } catch (e) {
        m.el.querySelector(".kc-modal-body").innerHTML = `<div class="note">調べられませんでした：${esc(e.message)}</div>`;
      }
    })();
  }
  if (t.id === "clReset") {
    ev.preventDefault();
    filt.stage = new Set(); filt.status = new Set(); filt.hist = "";
    sortBy = ""; sortDesc = false;
    if ($("clFind")) $("clFind").value = "";
    render();
  }
});


// ───────────────────────────────────────────────────────────
// リストの割り振り
// ───────────────────────────────────────────────────────────
async function asLoad() {
  // リストの選び欄を用意する
  const sel = $("asList");
  if (!sel) return;
  try {
    const d = await (await fetch("/api/calls/lists")).json();
    const items = d.items || [];
    sel.innerHTML = items.length
      ? items.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")
      : `<option value="">まだリストがありません</option>`;
    if (items.length) { asNow(); asWho(); }
  } catch (e) { say("asStatus", "読み込めませんでした：" + e.message, 8000); }
}

// いまの配り具合
async function asNow() {
  const box = $("asNow");
  const id = $("asList").value;
  if (!box || !id) return;
  box.innerHTML = "読み込んでいます…";
  try {
    const d = await (await fetch(`/api/calls/assign?list=${encodeURIComponent(id)}`)).json();
    const items = d.items || [];
    box.innerHTML = items.length
      ? `<table class="sh-table"><tr><th>かける人</th><th>全部</th><th>済み</th><th>残り</th></tr>` +
        items.map((x) => `<tr${x.email ? "" : ' class="ml-ng"'}>
          <td>${esc(x.name)}</td><td>${x["全部"]}</td><td>${x["済み"]}</td><td>${x["残り"]}</td>
        </tr>`).join("") + `</table>`
      : `<div class="note">まだ中身がありません。</div>`;
  } catch (e) { box.innerHTML = "読み込めませんでした：" + esc(e.message); }
}

// かける人の一覧
async function asWho() {
  const box = $("asWho");
  if (!box) return;
  try {
    const d = await (await fetch("/api/calls/members")).json();
    const items = d.items || [];
    box.innerHTML = items.length
      ? `<div class="as-who">` + items.map((m) => `
          <label class="as-who-row">
            <input type="checkbox" class="as-pick" value="${esc(m.email)}" />
            <span class="as-who-n">${esc(m.name)}</span>
            ${m["kincallだけ"] ? '<span class="as-tag">kincallだけ</span>' : ""}
            ${m["インサイド"] ? '<span class="as-tag as-tag-i">インサイド</span>' : ""}
          </label>`).join("") + `</div>`
      : `<div class="note">メンバーがいません。設定→メンバー管理で追加してください。</div>`;
  } catch (e) { box.innerHTML = "読み込めませんでした：" + esc(e.message); }
}

async function asAssign(clear) {
  const id = $("asList").value;
  if (!id) { say("asStatus", "リストを選んでください", 5000); return; }
  if (clear) {
    if (!confirm("配ったものを全部戻します。よろしいですか？（済みのものはそのままです）")) return;
    say("asStatus", "戻しています…");
    try {
      const d = await (await fetch("/api/calls/assign/clear", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ listId: Number(id) }),
      })).json();
      say("asStatus", `${d["戻した数"]}件を戻しました`, 8000);
      asNow();
    } catch (e) { say("asStatus", "失敗：" + e.message, 8000); }
    return;
  }
  const emails = [...document.querySelectorAll(".as-pick:checked")].map((c) => c.value);
  if (!emails.length) { say("asStatus", "かける人を選んでください", 5000); return; }
  say("asStatus", "配っています…");
  try {
    const d = await (await fetch("/api/calls/assign", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ listId: Number(id), emails, redo: $("asRedo").checked }),
    })).json();
    if (d.error) throw new Error(d.error);
    say("asStatus", `${d["配った数"]}件を${d["人数"]}人に配りました`, 8000);
    asNow();
  } catch (e) { say("asStatus", "失敗：" + e.message, 8000); }
}

document.addEventListener("click", (ev) => {
  const t = ev.target && ev.target.closest ? ev.target.closest("button") : null;
  if (!t) return;
  if (t.id === "asReload") { ev.preventDefault(); asNow(); }
  if (t.id === "asGo") { ev.preventDefault(); asAssign(false); }
  if (t.id === "asClear") { ev.preventDefault(); asAssign(true); }
});
document.addEventListener("change", (ev) => {
  if (ev.target && ev.target.id === "asList") { asNow(); }
});
