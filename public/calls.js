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
        <th class="kc-co"><button type="button" class="kc-th-b" data-sort="company">会社名${arrow("company")}</button></th>
        <th class="kc-th-p">担当者</th>
        <th class="kc-th-t">電話番号</th>
        <th class="kc-th-m">メールアドレス</th>
        <th class="kc-th-s"><button type="button" class="kc-th-b${on("status")}" data-flt="status">最終ステータス ▾</button></th>
        <th class="kc-th-h"><button type="button" class="kc-th-b${filt.hist ? " on" : ""}" data-hist="1">履歴${arrow("hist")}</button></th>
        <th class="kc-th-r">記録</th>
        <th class="kc-th-e">編集</th>
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
        <td><button type="button" class="kc-btn kc-edit" data-id="${x.id}">編集</button></td>
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
    b.addEventListener("click", () => openTarget(b.dataset.id, null, { histOnly: true })));
  box.querySelectorAll(".kc-rec").forEach((b) =>
    b.addEventListener("click", () => openTarget(b.dataset.id)));
  box.querySelectorAll(".kc-edit").forEach((b) =>
    b.addEventListener("click", () => openEdit(b.dataset.id)));
}

// ───────── 窓（モーダル） ─────────
function openModal(title, inner, opts = {}) {
  const back = document.createElement("div");
  back.className = "kc-modal-back";
  const wide = opts.wide ? " kc-modal-wide" : "";
  const minBtn = opts.onMinimize
    ? '<button type="button" class="kc-modal-min" aria-label="小さくする" title="小さくする">—</button>'
    : "";
  back.innerHTML =
    `<div class="kc-modal${wide}">
       <div class="kc-modal-head"><b>${esc(title)}</b>
         <span class="kc-modal-btns">${minBtn}<button type="button" class="kc-modal-x" aria-label="閉じる">✕</button></span></div>
       <div class="kc-modal-body">${inner}</div>
     </div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.querySelector(".kc-modal-x").addEventListener("click", close);
  back.addEventListener("click", (e) => { if (e.target === back) close(); });
  const min = back.querySelector(".kc-modal-min");
  if (min && opts.onMinimize) min.addEventListener("click", () => opts.onMinimize());
  document.addEventListener("keydown", function escKey(e) {
    if (e.key === "Escape") { close(); document.removeEventListener("keydown", escKey); }
  });
  return { el: back, close };
}

// これまでのやり取りを、指定した箱の中に描く（記録の窓の左側で使う）
async function renderHistoryInto(box, id) {
  if (!box) return;
  try {
    const d = await (await fetch(`/api/calls/targets/${encodeURIComponent(id)}/history`)).json();
    if (d.error) throw new Error(d.error);
    const items = d.items || [];
    box.innerHTML =
      (d.note ? `<div class="note">${esc(d.note)}</div>` : "") +
      (items.length
        ? items.map((h) => `
            <div class="kc-hist-row">
              <div class="kc-hist-top">
                <span class="kc-hist-at">${esc(h["日付のみ"] ? String(when(h.at)).replace(/\s*\d{1,2}:\d{2}$/, "") : when(h.at))}</span>
                <span class="kc-hist-r">${esc(h["件名"] || h["結果"] || "")}</span>
                ${h["件名"] && h["結果"] ? `<span class="kc-hist-res">${esc(h["結果"])}</span>` : ""}
                <span class="kc-hist-who">${esc(h["誰"] || "")}</span>
                ${h["元"] === "salesforce" ? '<span class="kc-hist-sf">SF</span>' : ""}
              </div>
              ${h["メモ"] ? `<div class="kc-hist-m">${esc(h["メモ"])}</div>` : ""}
            </div>`).join("")
        : `<div class="note">まだ記録がありません。</div>`);
  } catch (e) {
    box.innerHTML = `<div class="note">読み込めませんでした：${esc(e.message)}</div>`;
  }
}

// ───────── ページ下部に溜まる記録カード（連続架電向き・リロードまで残る） ─────────
let dockItems = [];
function dockEl() {
  let el = document.getElementById("kcDock");
  if (!el) {
    el = document.createElement("div");
    el.id = "kcDock";
    el.className = "kc-dock";
    document.body.appendChild(el);
  }
  return el;
}
// 同じ相手の「記録中（下書き）」は1つにまとめる。「記録済み」は積み増していく。
function dockUpsert(item) {
  const i = dockItems.findIndex((d) => d.id === item.id && d.state === item.state);
  if (i >= 0) dockItems[i] = { ...dockItems[i], ...item };
  else dockItems.push({ ...item, key: Math.random().toString(36).slice(2) });
  // 記録済みになったら、その相手の下書きは消す
  if (item.state === "done") {
    dockItems = dockItems.filter((d) => !(d.id === item.id && d.state === "draft"));
  }
  renderDock();
}
function dockRemove(key) { dockItems = dockItems.filter((d) => d.key !== key); renderDock(); }
function renderDock() {
  const el = dockEl();
  if (!dockItems.length) { el.innerHTML = ""; el.classList.remove("on"); return; }
  el.classList.add("on");
  el.innerHTML =
    `<div class="kc-dock-h"><span>記録 ${dockItems.length}</span>` +
    `<button type="button" class="kc-dock-clear">全部消す</button></div>` +
    `<div class="kc-dock-list">` +
    dockItems.map((d) => `
      <div class="kc-chip ${d.state}" data-key="${d.key}"${d.state === "draft" ? ` data-open="${esc(String(d.id))}"` : ""}>
        <span class="kc-chip-co">${esc(d.company || "（名前なし）")}</span>
        <span class="kc-chip-r">${esc(d.result || (d.state === "draft" ? "記録中" : ""))}</span>
        <button type="button" class="kc-chip-x" data-x="${d.key}" aria-label="消す">✕</button>
      </div>`).join("") +
    `</div>`;
  el.querySelectorAll(".kc-chip-x").forEach((b) =>
    b.addEventListener("click", (e) => { e.stopPropagation(); dockRemove(b.dataset.x); }));
  el.querySelectorAll(".kc-chip[data-open]").forEach((c) =>
    c.addEventListener("click", () => {
      const d = dockItems.find((z) => z.key === c.dataset.key);
      dockRemove(c.dataset.key);
      openTarget(c.dataset.open, d);
    }));
  const clr = el.querySelector(".kc-dock-clear");
  if (clr) clr.addEventListener("click", () => { dockItems = []; renderDock(); });
}

// 統合モーダルとドックの見た目（1回だけ差し込む）
(function injectKcComboStyle() {
  if (document.getElementById("kc-combo-style")) return;
  const s = document.createElement("style");
  s.id = "kc-combo-style";
  s.textContent = `
    .kc-modal-wide{max-width:920px;width:calc(100vw - 40px);}
    .kc-modal-head{display:flex;align-items:center;gap:10px;}
    .kc-modal-btns{margin-left:auto;display:inline-flex;gap:8px;align-items:center;}
    .kc-modal-min,.kc-modal-x{border:1px solid #d7e5dd;background:#f4faf7;color:#0d5b47;width:32px;height:32px;border-radius:8px;line-height:1;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;padding:0;}
    .kc-modal-min:hover{background:#e3f3ea;border-color:#1d9e75;}
    .kc-modal-x{color:#b05a5a;background:#fbf1f1;border-color:#f0d7d7;}
    .kc-modal-x:hover{background:#f7e2e2;border-color:#e0a3a3;color:#c0392b;}
    .kc-modal-btns{display:inline-flex;gap:4px;align-items:center;}
    .kc-modal-min{border:none;background:transparent;font-size:18px;line-height:1;cursor:pointer;color:#6b7c74;width:26px;height:26px;border-radius:6px;}
    .kc-modal-min:hover{background:#eef3f0;color:#0d5b47;}
    .kc-two{display:flex;gap:16px;align-items:flex-start;}
    .kc-two-l{flex:1 1 45%;min-width:0;border-right:1px solid #e6ece9;padding-right:14px;max-height:60vh;overflow:auto;}
    .kc-two-histonly .kc-two-r{display:none;}
    .kc-two-histonly .kc-two-l{flex:1 1 100%;border-right:none;padding-right:0;max-height:70vh;}
    .kc-two-r{flex:1 1 55%;min-width:0;}
    .kc-two-h{font-weight:700;color:#0d5b47;margin-bottom:8px;font-size:13px;}
    .kc-dock{position:fixed;right:16px;bottom:16px;z-index:60;width:280px;max-width:calc(100vw - 32px);background:#fff;border:1px solid #d7e5dd;border-radius:14px;box-shadow:0 14px 40px -16px rgba(13,91,71,.5);display:none;overflow:hidden;}
    .kc-dock.on{display:block;}
    .kc-dock-h{display:flex;align-items:center;justify-content:space-between;padding:9px 12px;background:#eaf5ef;color:#0d5b47;font-size:12px;font-weight:700;}
    .kc-dock-clear{border:none;background:transparent;color:#5b7a6d;font-size:11px;cursor:pointer;}
    .kc-dock-clear:hover{color:#0d5b47;text-decoration:underline;}
    .kc-dock-list{max-height:40vh;overflow:auto;padding:8px;display:flex;flex-direction:column;gap:6px;}
    .kc-chip{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:9px;border:1px solid #e6ece9;background:#fff;font-size:12px;}
    .kc-chip.draft{border-style:dashed;cursor:pointer;}
    .kc-chip.draft:hover{border-color:#1d9e75;background:#f6fbf8;}
    .kc-chip.done{border-color:#cbe7d8;background:#f4faf7;}
    .kc-chip-co{font-weight:600;color:#1f2a26;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1 1 auto;min-width:0;}
    .kc-chip-r{color:#217a54;white-space:nowrap;flex:0 0 auto;}
    .kc-chip.draft .kc-chip-r{color:#8a9a92;}
    .kc-chip-x{border:none;background:transparent;color:#b6c3bc;cursor:pointer;font-size:12px;flex:0 0 auto;}
    .kc-chip-x:hover{color:#e05a5a;}
    @media(max-width:720px){.kc-two{flex-direction:column;}.kc-two-l{border-right:none;border-bottom:1px solid #e6ece9;padding-right:0;padding-bottom:12px;max-height:40vh;}}
    /* 表は内容にあわせて広げ、途中で切らずに全部見えるようにする（必要なら横スクロール） */
    /* 表は1画面に収める。縦は表の中だけスクロールし、見出しは残す。 */
    .kc-table{table-layout:auto;width:100%;}
    .kc-table th{white-space:nowrap;position:sticky;top:0;background:#fff;z-index:2;box-shadow:0 1px 0 #e6ece9;}
    /* 会社名は省略せず全部出す。長ければ折り返す。 */
    .kc-table td{overflow:visible;text-overflow:clip;white-space:nowrap;}
    .kc-table td.kc-co,.kc-table th.kc-co{white-space:normal;word-break:break-word;min-width:220px;}
    .kc-tablewrap{overflow:auto;max-height:calc(100vh - 210px);}
    .kc-tablewrap table{margin:0;}
    /* 「かける」の画面自体もはみ出さないようにする */
    /* 「かける」は1画面に収める。表の中だけが縦に動く。 */
    #call.kc-pane{display:flex;flex-direction:column;height:calc(100vh - 96px);min-height:0;overflow:hidden;}
    #call.kc-pane #clTable{flex:1;min-height:0;display:flex;flex-direction:column;}
    #call.kc-pane #clTable > .kc-tablewrap{flex:1;min-height:0;max-height:none;}
    /* リスト管理：カード一覧 */
    .kc-lists-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin-top:6px;}
    #asCards .kc-lists-grid-in{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;width:100%;}
    .kc-list-card{position:relative;background:#fff;border:1.5px solid #e6ece9;border-radius:14px;padding:16px 16px 14px;cursor:pointer;transition:border-color .15s,box-shadow .15s,transform .12s;}
    .kc-list-card:hover{border-color:#bfe0cf;box-shadow:0 8px 22px -12px rgba(33,122,84,.35);transform:translateY(-2px);}
    .kc-list-del{position:absolute;top:10px;right:10px;width:26px;height:26px;border-radius:999px;border:none;background:transparent;color:#b6c3bc;font-size:13px;line-height:1;cursor:pointer;display:grid;place-items:center;transition:background .15s,color .15s;}
    .kc-list-del:hover{background:#fbe9e9;color:#e05a5a;}
    .kc-list-name{font-size:14px;font-weight:700;color:#1f2a26;line-height:1.45;padding-right:24px;margin-bottom:12px;}
    .kc-list-meta{display:flex;flex-wrap:wrap;gap:6px;}
    .kc-list-chip{font-size:11px;color:#5b7a6d;background:#f4f7f5;border-radius:6px;padding:3px 8px;}
    .kc-list-chip.done{color:#217a54;background:#eaf5ef;}
    .kc-list-chip.rest{color:#8a5a2b;background:#fbf3e8;}
    /* メンバーカード（第1階層）：名前だけ。全員が1画面に収まるようにする */
    #asCards .kc-mem-grid{display:flex !important;flex-wrap:wrap;gap:12px;width:100%;}
    #asCards .kc-mem-grid > .kc-mem-card{flex:0 0 calc(20% - 10px);max-width:calc(20% - 10px);}
    @media (max-width:1100px){ #asCards .kc-mem-grid > .kc-mem-card{flex-basis:calc(25% - 9px);max-width:calc(25% - 9px);} }
    @media (max-width:820px){ #asCards .kc-mem-grid > .kc-mem-card{flex-basis:calc(33.333% - 8px);max-width:calc(33.333% - 8px);} }
    #asCards .kc-mem-card{position:relative;display:flex;align-items:center;justify-content:center;text-align:center;
      min-height:64px;padding:12px;background:#fff;border:1.5px solid #e6ece9;border-radius:12px;
      cursor:pointer;transition:border-color .15s,box-shadow .15s,transform .12s;}
    .kc-mem-hide{position:absolute;top:5px;right:5px;width:22px;height:22px;border:none;background:transparent;
      color:#c3cec8;font-size:12px;line-height:1;border-radius:999px;cursor:pointer;display:grid;place-items:center;opacity:0;transition:opacity .12s;}
    #asCards .kc-mem-card:hover .kc-mem-hide{opacity:1;}
    .kc-mem-hide:hover{background:#fbe9e9;color:#e05a5a;}
    .kc-mem-foot{margin-top:12px;font-size:12px;color:#6b7c74;display:flex;align-items:center;gap:10px;}
    .kc-mem-restore{border:1px solid #e6ece9;background:#fff;color:#0d5b47;border-radius:8px;padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer;}
    .kc-mem-restore:hover{background:#f4faf7;border-color:#1d9e75;}
    #asCards .kc-mem-card:hover{border-color:#bfe0cf;box-shadow:0 8px 20px -12px rgba(33,122,84,.35);transform:translateY(-2px);}
    .kc-mem-name{font-size:14px;font-weight:700;color:#1f2a26;line-height:1.35;}
    #asCards .kc-mem-add{border-style:dashed;}
    #asCards .kc-mem-add .kc-mem-name{font-weight:600;color:#5b7a6d;}
    .kc-mem-pick{margin-top:12px;padding:12px;border:1px solid #e6ece9;border-radius:12px;background:#fcfefe;display:flex;flex-wrap:wrap;gap:8px;align-items:center;}
    .kc-mem-pick-h{width:100%;font-size:12px;font-weight:600;color:#5b7a6d;}
    .kc-mem-pick-b{border:1px solid #e6ece9;background:#fff;color:#1f2a26;border-radius:9px;padding:7px 12px;font-size:13px;cursor:pointer;}
    .kc-mem-pick-b:hover{border-color:#1d9e75;background:#f4faf7;}
    #asCards .kc-mem-head{display:flex;align-items:center;gap:12px;margin-bottom:14px;}
    #asCards .kc-mem-back{flex:0 0 auto;width:auto;min-height:0;height:auto;
      border:1px solid #e6ece9;background:#fff;color:#0d5b47;border-radius:9px;
      padding:6px 12px;font-size:12px;font-weight:600;line-height:1.2;cursor:pointer;margin:0;}
    #asCards .kc-mem-back:hover{background:#f4faf7;border-color:#1d9e75;}
    #asCards .kc-mem-title{font-size:14px;font-weight:700;color:#1f2a26;margin:0;}
    .kc-split{display:flex;flex-direction:column;gap:14px;}
    /* リスト作成の画面を見やすくする */
    [data-mk-pane="sf"] .sr-wrap{display:flex;gap:14px;align-items:flex-start;}
    [data-mk-pane="sf"] .sr-list{flex:0 0 240px;max-height:52vh;overflow:auto;}
    [data-mk-pane="sf"] .sr-right{flex:1;min-width:0;}
    [data-mk-pane="sf"] .sr-filters{max-height:44vh;overflow:auto;}
    [data-mk-pane="sf"] .sr-view{max-height:52vh;overflow:auto;}
    [data-mk-pane="sf"] .sr-actions{display:flex;gap:8px;align-items:center;}
    .kc-csv{border:1px solid #e6ece9;border-radius:12px;padding:14px 16px;margin-bottom:18px;background:#fcfefe;}
    .kc-csv-h{font-size:14px;font-weight:700;color:#0d5b47;margin-bottom:6px;}
    .kc-share-box{border:1px solid #e6ece9;border-radius:10px;padding:10px 12px;margin:10px 0;background:#fff;}
    .kc-share-head{display:flex;align-items:center;gap:10px;margin-bottom:8px;}
    .kc-share-lb{font-size:13px;font-weight:700;color:#0d5b47;}
    .kc-share-hint{font-size:12px;color:#6b7c74;}
    .kc-share-clear{margin-left:auto;border:1px solid #e6ece9;background:#fff;color:#5b7a6d;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer;}
    .kc-share-clear:hover{border-color:#1d9e75;color:#0d5b47;}
    .kc-share{display:flex;flex-wrap:wrap;gap:8px;}
    .kc-filter-row{display:flex;gap:10px;align-items:flex-start;margin-bottom:8px;}
    .kc-filter-lb{font-size:12px;font-weight:600;color:#5b7a6d;min-width:74px;padding-top:6px;}
    .kc-n{opacity:.75;font-size:11px;}
    .kc-share-b{border:1px solid #e6ece9;background:#fff;color:#1f2a26;border-radius:999px;padding:6px 14px;font-size:13px;cursor:pointer;transition:all .12s;}
    .kc-share-b:hover{border-color:#1d9e75;background:#f4faf7;}
    .kc-share-b.on{background:#1d9e75;border-color:#1d9e75;color:#fff;font-weight:600;}
    .kc-cmt{max-width:320px;white-space:normal;word-break:break-word;color:#5b7a6d;font-size:12px;}
    .kc-split-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}
    .kc-split-lb{font-size:12px;font-weight:600;color:#5b7a6d;min-width:110px;}
    .kc-split-opts{display:flex;flex-wrap:wrap;gap:10px;flex:1;min-width:0;}
    /* 実績の 日/週/月 タブ */
    .an-team{font-size:13px;font-weight:600;color:#0d5b47;background:#eaf5ef;border-radius:10px;padding:10px 14px;margin-bottom:14px;}
    .an-card{border:1px solid #e6ece9;border-radius:14px;padding:16px 18px;margin-bottom:16px;background:#fcfefe;}
    .an-h{font-size:15px;font-weight:700;color:#1f2a26;margin-bottom:12px;}
    .an-kpi{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px;}
    .an-k{flex:1;min-width:96px;border:1px solid #e6ece9;border-radius:10px;padding:8px 10px;background:#fff;text-align:center;}
    .an-kn{font-size:18px;font-weight:700;color:#0d5b47;font-variant-numeric:tabular-nums;}
    .an-kl{font-size:11px;color:#6b7c74;margin-top:2px;}
    .an-up{color:#217a54;font-weight:600;}
    .an-down{color:#c2603f;font-weight:600;}
    .an-eq{color:#8a9a93;}
    .an-cols{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px;}
    .an-col{flex:1;min-width:260px;}
    .an-t{font-size:12px;font-weight:700;color:#5b7a6d;margin:6px 0;}
    .an-funnel{font-size:12px;color:#1f2a26;background:#f4f7f5;border-radius:8px;padding:6px 10px;margin-bottom:6px;}
    .an-tb td,.an-tb th{padding:4px 8px;font-size:12px;}
    .an-n{text-align:right;font-variant-numeric:tabular-nums;}
    .an-bar{display:inline-block;width:70px;height:7px;background:#eef3f0;border-radius:4px;overflow:hidden;vertical-align:middle;}
    .an-bar i{display:block;height:100%;background:#1d9e75;}
    .kc-g-block{margin-bottom:18px;}
    .kc-g-title{font-size:13px;font-weight:700;color:#0d5b47;margin-bottom:6px;}
    .kc-grid th,.kc-grid td{text-align:center;padding:6px 8px;white-space:nowrap;}
    .kc-grid .kc-g-name{text-align:left;font-weight:600;position:sticky;left:0;background:#fff;z-index:1;}
    .kc-g-h{font-size:12px;line-height:1.2;}
    .kc-g-w{font-size:10px;color:#8a9a93;font-weight:400;}
    .kc-g-n{font-variant-numeric:tabular-nums;}
    .kc-g-sum td{font-weight:700;background:#f4f7f5;}
    .kc-period-tabs{display:inline-flex;gap:4px;background:#f4f7f5;border-radius:10px;padding:3px;margin-bottom:12px;}
    .kc-ptab{border:none;background:transparent;color:#5b7a6d;font-size:13px;font-weight:600;padding:6px 16px;border-radius:8px;cursor:pointer;}
    .kc-ptab.active{background:#1d9e75;color:#fff;}
    .kc-ptab:not(.active):hover{background:#eaf5ef;color:#0d5b47;}
  `;
  document.head.appendChild(s);
})();

// 記録の窓
// 架電の結果の選択肢（Salesforceから取ってくる）
let kcPicks = null;
async function loadPicks() {
  // 前に取ったものが空っぽ（ステージが無い）なら、取り直す
  if (kcPicks && ((kcPicks["リードの状態"] || []).length)) return kcPicks;
  try {
    const d = await (await fetch("/api/calls/picklists?refresh=1")).json();
    if (!d.error) kcPicks = d;
  } catch {}
  return kcPicks;
}

// 履歴と記録を1つの窓で見せる。左：これまでのやり取り／右：記録フォーム。
// draft を渡すと、下書き（結果・メモ・状態）を復元して開く。
async function openTarget(id, draft, opt) {
  const histOnly = !!(opt && opt.histOnly);   // 履歴ボタンから開いたときは履歴だけ出す
  const x = rows.find((r) => String(r.id) === String(id));
  if (!x) return;
  // Salesforceの選択肢を使う（担当者不在・コールのみ・担当者接触：アポ獲得 など）
  const pk = await loadPicks();
  const 結果の選択肢 = (pk && pk["活動の結果"] && pk["活動の結果"].length)
    ? pk["活動の結果"].map((v) => v.label)
    : kinds;
  const 状態の選択肢 = (pk && pk["リードの状態"]) || [];
  const 相手名 = `${x["会社名"] || ""}${x["担当者"] ? `　${x["担当者"]}` : ""}`;
  const m = openModal(相手名 || (histOnly ? "これまでのやり取り" : "記録する"), `
    <div class="kc-two${histOnly ? " kc-two-histonly" : ""}">
      <div class="kc-two-l">
        <div class="kc-two-h">これまでのやり取り</div>
        <div id="kcHist"><div class="note">読み込んでいます…</div></div>
      </div>
      <div class="kc-two-r">
        <div class="kc-rec-top">
          <div>
            ${x["電話番号"] ? `<a class="kc-tel kc-tel-big" href="tel:${esc(telOf(x["電話番号"]))}">${esc(x["電話番号"])}</a>` : ""}
          </div>
          <!-- いまのステージと、変えるところ -->
          <div class="kc-rec-stage">
            <div class="kc-lb">いまのステージ</div>
            <div class="kc-stage-now">${esc(x["ステージ"] || "（なし）")}</div>
            ${true
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
        </div>
      </div>
    </div>`, {
    wide: true,
    // 「小さくする」＝下書きをページ下部のドックへ入れて、窓を閉じる
    onMinimize: () => {
      dockUpsert({
        id, company: x["会社名"] || "", person: x["担当者"] || "",
        result: (m.el.querySelector("#kcResult") || {}).value || "",
        memo: (m.el.querySelector("#kcMemo") || {}).value || "",
        status: (m.el.querySelector("#kcStatus") || {}).value || "",
        state: "draft",
      });
      m.close();
    },
  });

  // 左側にこれまでのやり取りを読み込む
  renderHistoryInto(m.el.querySelector("#kcHist"), id);

  // 下書きがあれば復元する
  if (draft) {
    const rs = m.el.querySelector("#kcResult"); if (rs && draft.result) rs.value = draft.result;
    const mm = m.el.querySelector("#kcMemo"); if (mm && draft.memo) mm.value = draft.memo;
    const ss = m.el.querySelector("#kcStatus"); if (ss && draft.status) ss.value = draft.status;
  }

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
      // 記録しただけでは下に残さない（「—」で最小化したときだけ残す）。
      // もし最小化してあった同じ相手が残っていれば、それは消す。
      dockItems = dockItems.filter((d) => d.id !== id);
      renderDock();
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

// 会社名・担当者・電話・メールの表示セルを書き換える（編集の反映用）
function updateRowContact(x) {
  const tr = document.querySelector(`.kc-table tr[data-id="${x.id}"]`);
  if (!tr) return;
  const td = tr.children;
  if (td[1]) td[1].textContent = x["会社名"] || "";
  if (td[2]) td[2].textContent = x["担当者"] || "";
  if (td[3]) {
    td[3].innerHTML = x["電話番号"]
      ? `<a class="kc-tel" href="tel:${esc(telOf(x["電話番号"]))}">${esc(x["電話番号"])}</a>`
      : `<span class="kc-none">なし</span>`;
  }
  if (td[4]) td[4].textContent = x["メール"] || "";
  tr.classList.add("kc-just");
  setTimeout(() => tr.classList.remove("kc-just"), 1600);
}

// 会社名・担当者名・電話番号・メールアドレスを直す窓。SFのリードにも反映する。
function openEdit(id) {
  const x = rows.find((r) => String(r.id) === String(id));
  if (!x) return;
  const m = openModal("お客さまの情報を直す", `
    <div class="kc-edit">
      <div class="kc-lb">会社名</div>
      <input type="text" class="kc-input" id="edCompany" value="${esc(x["会社名"] || "")}" />
      <div class="kc-lb">担当者名</div>
      <input type="text" class="kc-input" id="edPerson" value="${esc(x["担当者"] || "")}" />
      <div class="kc-lb">電話番号</div>
      <input type="text" class="kc-input" id="edPhone" value="${esc(x["電話番号"] || "")}" />
      <div class="kc-lb">メールアドレス</div>
      <input type="text" class="kc-input" id="edEmail" value="${esc(x["メール"] || "")}" />
      ${x.leadId
        ? `<div class="note">保存すると、Salesforceのリードにも同じ内容が反映されます。</div>`
        : `<div class="note cc-warn">この相手はSalesforceのリードと結びついていないため、Salesforceには反映されません。</div>`}
      <div class="kc-modal-foot">
        <button type="button" class="btn" id="edSave">保存する</button>
        <span class="rev-status" id="edSaveSt"></span>
      </div>
    </div>`);

  m.el.querySelector("#edSave").addEventListener("click", async () => {
    const body = {
      company: m.el.querySelector("#edCompany").value,
      person:  m.el.querySelector("#edPerson").value,
      phone:   m.el.querySelector("#edPhone").value,
      email:   m.el.querySelector("#edEmail").value,
    };
    const btn = m.el.querySelector("#edSave");
    btn.disabled = true;
    say("edSaveSt", "保存しています…");
    try {
      const r = await fetch(`/api/calls/targets/${encodeURIComponent(id)}/edit`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "保存できませんでした");
      // 手元の行を書き換える（一覧は読み直さない）
      x["会社名"] = (d.項目 && d.項目["会社名"]) ?? body.company;
      x["担当者"] = (d.項目 && d.項目["担当者"]) ?? body.person;
      x["電話番号"] = (d.項目 && d.項目["電話番号"]) ?? body.phone;
      x["メール"] = (d.項目 && d.項目["メール"]) ?? body.email;
      updateRowContact(x);
      m.close();
      const sfMsg = !d.sf ? ""
        : d.sf.ok ? "（Salesforceにも反映しました）"
        : `（Salesforceへは反映できません：${d.sf.reason || ""}）`;
      say("clStatus", `保存しました${sfMsg}`, 8000);
    } catch (e) {
      say("edSaveSt", "失敗：" + e.message, 8000);
      btn.disabled = false;
    }
  });
}

// ───────── 実績（日・週・月） ─────────
let statsPeriod = "day";
async function loadStats() {
  const box = $("clStats");
  if (!box) return;
  if (statsPeriod === "analysis") return loadAnalysis();
  try {
    const d = await (await fetch(`/api/calls/stats-grid?period=${encodeURIComponent(statsPeriod)}`)).json();
    if (d.error) throw new Error(d.error);
    const 区切り = d["区切り"] || [];
    const items = d.items || [];
    const 合計 = d["合計"] || [];

    const rg = $("stRange");
    if (rg) rg.textContent = 区切り.length
      ? `${区切り[0]["名前"]} 〜 ${区切り[区切り.length - 1]["名前"]}` : "";

    // 見出し（日付／週／月）
    const 頭 = `<tr><th class="kc-g-name">メンバー</th>` +
      区切り.map((c) => `<th class="kc-g-h"><div>${esc(c["名前"])}</div>` +
        (c["曜日"] ? `<div class="kc-g-w">${esc(c["曜日"])}</div>` : "") + `</th>`).join("") + `</tr>`;

    // 見やすさのため、指標ごとに小さな表を3つ並べる
    const 表 = (key, 見出し) => `
      <div class="kc-g-block">
        <div class="kc-g-title">${esc(見出し)}</div>
        <div class="kc-tablewrap"><table class="sh-table kc-grid">
          ${頭}
          ${items.map((x) => `<tr><td class="kc-g-name">${esc(x["誰"])}</td>` +
            x["値"].map((v) => `<td class="kc-g-n">${v[key] || 0}</td>`).join("") + `</tr>`).join("")}
          <tr class="kc-g-sum"><td class="kc-g-name">合計</td>` +
            合計.map((v) => `<td class="kc-g-n">${v[key] || 0}</td>`).join("") + `</tr>
        </table></div>
      </div>`;

    box.innerHTML = items.length
      ? 表("コール", "コール") + 表("接触", "接触") + 表("アポ", "アポ")
      : `<div class="note">この期間の記録はまだありません。</div>`;
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
// 日・週・月の切り替え
if ($("stPeriod")) {
  $("stPeriod").querySelectorAll(".kc-ptab").forEach((b) =>
    b.addEventListener("click", () => {
      statsPeriod = b.dataset.period || "day";
      $("stPeriod").querySelectorAll(".kc-ptab").forEach((x) => x.classList.toggle("active", x === b));
      loadStats();
    }));
}

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
  if (p === "lists") asLoad();
}

// リスト管理の中のタブ（リスト管理／リスト作成）
(function wireListTabs() {
  const tabs = document.getElementById("lsTabs");
  if (!tabs) return;
  tabs.addEventListener("click", (ev) => {
    const b = ev.target && ev.target.closest ? ev.target.closest(".kc-ptab") : null;
    if (!b) return;
    const name = b.dataset.ls || "manage";
    tabs.querySelectorAll(".kc-ptab").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll("[data-ls-pane]").forEach((el) => {
      el.hidden = el.dataset.lsPane !== name;
    });
    if (name === "manage") asLoad();
    // リスト作成は、Salesforceのリード一覧をそのまま使う
    if (name === "make") {
      // 最初はSalesforceのレポートを出す
      if (typeof window.initSfReport === "function") window.initSfReport("lead");
      if (typeof srFillShare === "function") srFillShare();
    }
  });
})();

// 「kincallだけ」の人には、kinbotへ戻る道を見せない
(async () => {
  try {
    const me = await (await fetch("/api/me")).json();
    if (me && me.kincallOnly) {
      document.querySelectorAll(".kc-side .side-app, .kc-side .side-sep")
        .forEach((el) => el.remove());
      // リスト管理は見せる（メンバーカードを選んでリストを使えるように）。
      // ただし「リスト作成」はSalesforceの中身が見えるので、kincallだけの人には出さない。
      const mk = document.querySelector('.kc-ptab[data-ls="make"]');
      if (mk) mk.remove();
      const mkp = document.querySelector('[data-ls-pane="make"]');
      if (mkp) mkp.remove();
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
// 第1階層：メンバーのカード一覧
// 消したメンバー／足したメンバーは、みんな同じ並びになるようサーバーに覚えておく
let memberView = { hidden: new Set(), extra: new Set() };
function hiddenMembers() { return memberView.hidden; }
function extraMembers() { return memberView.extra; }
async function saveMemberView() {
  try {
    await fetch("/api/calls/member-view", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ "消した": [...memberView.hidden], "足した": [...memberView.extra] }),
    });
  } catch {}
}

async function asLoad() {
  const box = $("asCards");
  if (!box) return;
  box.classList.remove("kc-lists-grid");
  box.innerHTML = '<div class="note">読み込んでいます…</div>';
  try {
    const d = await (await fetch("/api/calls/members")).json();
    const items = d.items || [];
    if (!items.length) {
      box.innerHTML = '<div class="empty-state">メンバーがいません。設定→メンバー管理で追加してください。</div>';
      return;
    }
    // 並び（消した・足した）はサーバーが決めて返してくれる。全員が同じ並びになる。
    const v = d["表示"] || {};
    memberView = {
      hidden: new Set((v["消した"] || []).map((x) => String(x).toLowerCase())),
      extra: new Set((v["足した"] || []).map((x) => String(x).toLowerCase())),
    };
    const 変えられる = d["変えられる"] !== false;
    const 候補 = d["候補"] || [];
    const shown = items;
    const shownKeys = new Set(shown.map((m) => String(m.email || "").toLowerCase()));
    const addable = 候補.filter((c) => !shownKeys.has(String(c.email || "").toLowerCase()));

    box.classList.remove("kc-lists-grid");   // 親が格子だと1列になるので外す
    box.innerHTML =
      '<div class="kc-mem-grid">' + shown.map((m) => `
        <div class="kc-mem-card" data-email="${esc(m.email)}" data-name="${esc(m.name)}">
          ${変えられる ? `<button type="button" class="kc-mem-hide" data-hide="${esc(m.email)}" title="このカードを消す" aria-label="消す">✕</button>` : ""}
          <span class="kc-mem-name">${esc(m.name)}</span>
        </div>`).join("") +
        (addable.length && 変えられる ? '<div class="kc-mem-card kc-mem-add" id="kcAddCard"><span class="kc-mem-name">＋ メンバーを足す</span></div>' : "") +
      '</div>' +
      '<div class="kc-mem-pick" id="kcPick" hidden></div>';

    // 「＋ メンバーを足す」でカードを増やせる
    const addCard = $("kcAddCard");
    if (addCard) addCard.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const pick = $("kcPick");
      if (!pick) return;
      pick.hidden = false;
      pick.innerHTML = '<div class="kc-mem-pick-h">足したい人を押してください</div>' +
        addable.map((c) => `<button type="button" class="kc-mem-pick-b" data-add="${esc(c.email)}">${esc(c.name)}</button>`).join("");
      pick.querySelectorAll("[data-add]").forEach((b) =>
        b.addEventListener("click", async () => {
          const k = String(b.dataset.add || "").toLowerCase();
          memberView.extra.add(k);
          memberView.hidden.delete(k);
          await saveMemberView();
          asLoad();
        }));
    });

    box.querySelectorAll(".kc-mem-card").forEach((c) => {
      if (c.id === "kcAddCard") return;   // 「＋」は追加用なので開かない
      c.addEventListener("click", () => asLoadMember(c.dataset.email, c.dataset.name));
    });
    box.querySelectorAll(".kc-mem-hide").forEach((b) =>
      b.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        const k = String(b.dataset.hide || "").toLowerCase();
        memberView.hidden.add(k);
        memberView.extra.delete(k);
        await saveMemberView();
        asLoad();
      }));

  } catch (e) {
    box.innerHTML = `<div class="note">読み込めませんでした：${esc(e.message)}</div>`;
  }
}

// 第2階層：あるメンバーのリスト一覧（今までのカード表示）
async function asLoadMember(email, name) {
  const box = $("asCards");
  if (!box) return;
  box.innerHTML = '<div class="note">読み込んでいます…</div>';
  try {
    const d = await (await fetch("/api/calls/lists?member=" + encodeURIComponent(email))).json();
    const items = d.items || [];
    box.classList.remove("kc-lists-grid");
    const head =
      `<div class="kc-mem-head">` +
      `<button type="button" class="kc-mem-back" id="asBack">← 戻る</button>` +
      `<span class="kc-mem-title">${esc(name || email)} のリスト</span>` +
      `</div>`;
    if (!items.length) {
      box.innerHTML = head + '<div class="empty-state">このメンバーのリストはまだありません。</div>';
    } else {
      box.innerHTML = head + '<div class="kc-lists-grid kc-lists-grid-in">' + items.map((x) => `
        <div class="kc-list-card" data-id="${x.id}">
          <button type="button" class="kc-list-del" data-del="${x.id}" aria-label="削除" title="削除">✕</button>
          <div class="kc-list-name">${esc(x.name)}</div>
          <div class="kc-list-meta"><span class="kc-list-chip">全 ${x["全部"]}件</span>${
            x["自分のぶん"] && x["自分のぶん"] !== x["全部"]
              ? `<span class="kc-list-chip done">この人 ${x["自分のぶん"]}件</span>` : ""}</div>
        </div>`).join("") + '</div>';
      box.querySelectorAll(".kc-list-card").forEach((c) =>
        c.addEventListener("click", () => openSplit(c.dataset.id, (c.querySelector(".kc-list-name") || {}).textContent || "", email, name)));
      box.querySelectorAll(".kc-list-del").forEach((b) =>
        b.addEventListener("click", (e) => { e.stopPropagation(); deleteListCard(b.dataset.del, () => asLoadMember(email, name)); }));
    }
    const bk = $("asBack");
    if (bk) bk.addEventListener("click", asLoad);
  } catch (e) {
    box.innerHTML = `<div class="note">読み込めませんでした：${esc(e.message)}</div>`;
  }
}

// カードを押したら「かける」に移り、そのリストを選ぶ
function selectListAndCall(id) {
  const sel = $("clList");
  if (sel) {
    sel.value = String(id);
    listId = Number(id) || 0;
    loadTable();
  }
  // 「かける」画面に切り替える（再読み込みしない）
  document.querySelectorAll(".kc-pane").forEach((el) => { el.hidden = el.dataset.p !== "call"; });
  document.querySelectorAll(".kc-side .side-item").forEach((a) => {
    a.classList.toggle("active", (a.getAttribute("href") || "") === "/kincall");
  });
  history.replaceState(null, "", "/kincall");
}

// カードの × で、そのリストを削除する
async function deleteListCard(id, after) {
  const card = document.querySelector(`.kc-list-card[data-id="${id}"]`);
  const name = card ? ((card.querySelector(".kc-list-name") || {}).textContent || "") : "";
  if (!confirm(`リスト「${name}」を、中身ごと消します。戻せません。よろしいですか？`)) return;
  say("asStatus", "消しています…");
  try {
    const r = await fetch(`/api/calls/lists/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!r.ok) throw new Error("消せませんでした");
    say("asStatus", `「${name}」を消しました`, 8000);
    (typeof after === "function" ? after : asLoad)();  // 元の画面を描き直す
    loadLists();  // 「かける」のリスト選び欄も更新する
  } catch (e) { say("asStatus", "失敗：" + e.message, 8000); }
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


// ───────────────────────────────────────────────────────────
// リスト管理：中身をしぼって消す
// ───────────────────────────────────────────────────────────
async function dlFacets() {
  const box = $("dlFacets");
  const id = $("asList") && $("asList").value;
  if (!box || !id) return;
  box.innerHTML = "読み込んでいます…";
  try {
    const d = await (await fetch(`/api/calls/facets?list=${encodeURIComponent(id)}`)).json();
    if (d.error) throw new Error(d.error);
    const 並べる = (title, key, items) =>
      `<div class="dl-group">
         <div class="dl-lb">${title}</div>
         <div class="dl-list">
           ${(items || []).map((x) => `
             <label class="dl-row">
               <input type="checkbox" class="dl-${key}" value="${esc(x["生"] || "")}" />
               <span>${esc(x["値"])}</span>
               <span class="dl-n">${x["件数"]}</span>
             </label>`).join("")}
         </div>
       </div>`;
    box.innerHTML =
      `<div class="dl-facets">` +
      並べる("ステージ", "stage", d["ステージ"]) +
      並べる("最終ステータス", "status", d["最終ステータス"]) +
      `</div>`;
  } catch (e) { box.innerHTML = `<div class="note">読み込めませんでした：${esc(e.message)}</div>`; }
}

function dlCond() {
  return {
    listId: Number($("asList").value),
    stages: [...document.querySelectorAll(".dl-stage:checked")].map((c) => c.value),
    statuses: [...document.querySelectorAll(".dl-status:checked")].map((c) => c.value),
    hist: $("dlHist").value,
  };
}

async function dlCount() {
  say("dlStatus", "数えています…");
  try {
    const d = await (await fetch("/api/calls/targets/count", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(dlCond()),
    })).json();
    if (d.error) throw new Error(d.error);
    say("dlStatus", `この条件だと ${d["件数"]}件 消えます`, 10000);
  } catch (e) { say("dlStatus", "失敗：" + e.message, 8000); }
}

async function dlDelete() {
  const c = dlCond();
  if (!c.stages.length && !c.statuses.length && !c.hist) {
    say("dlStatus", "消すものの条件を選んでください", 6000);
    return;
  }
  // 何件消えるかを先に出してから確かめる
  let n = 0;
  try {
    const d = await (await fetch("/api/calls/targets/count", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c),
    })).json();
    n = d["件数"] || 0;
  } catch {}
  if (!n) { say("dlStatus", "この条件に当てはまるものがありません", 6000); return; }
  if (!confirm(`${n}件を消します。戻せません。よろしいですか？`)) return;
  say("dlStatus", "消しています…");
  try {
    const d = await (await fetch("/api/calls/targets/delete", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c),
    })).json();
    if (d.error) throw new Error(d.error);
    say("dlStatus", `${d["消した数"]}件を消しました`, 10000);
    dlFacets(); asNow(); loadLists();
  } catch (e) { say("dlStatus", "失敗：" + e.message, 8000); }
}

async function dlDeleteList() {
  const sel = $("asList");
  const name = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : "";
  if (!sel.value) return;
  if (!confirm(`リスト「${name}」を、中身ごと消します。戻せません。よろしいですか？`)) return;
  say("dlStatus", "消しています…");
  try {
    const r = await fetch(`/api/calls/lists/${encodeURIComponent(sel.value)}`, { method: "DELETE" });
    if (!r.ok) throw new Error("消せませんでした");
    say("dlStatus", `「${name}」を消しました`, 10000);
    asLoad(); loadLists();
  } catch (e) { say("dlStatus", "失敗：" + e.message, 8000); }
}

document.addEventListener("click", (ev) => {
  const t = ev.target && ev.target.closest ? ev.target.closest("button") : null;
  if (!t) return;
  if (t.id === "dlCount") { ev.preventDefault(); dlCount(); }
  if (t.id === "dlGo") { ev.preventDefault(); dlDelete(); }
  if (t.id === "dlList") { ev.preventDefault(); dlDeleteList(); }
});
document.addEventListener("change", (ev) => {
  if (ev.target && ev.target.id === "asList") dlFacets();
});

// リストを押したときの絞り込み画面。条件に合うものを、自分のリストとして切り出す。
async function openSplit(listId, listName, memberEmail, memberName) {
  const box = $("asCards");
  if (!box) return;
  box.classList.remove("kc-lists-grid");
  box.innerHTML = '<div class="note">読み込んでいます…</div>';
  try {
    const d = await (await fetch("/api/calls/targets?list=" + encodeURIComponent(listId))).json();
    const rows = d.items || [];
    const uniq = (key) => [...new Set(rows.map((r) => String(r[key] || "").trim()).filter(Boolean))].sort();
    const stages = uniq("ステージ").length ? uniq("ステージ") : uniq("stage");
    const statuses = uniq("最終ステータス").length ? uniq("最終ステータス") : uniq("status");

    box.innerHTML =
      `<div class="kc-mem-head">
         <button type="button" class="kc-mem-back" id="spBack">← 戻る</button>
         <span class="kc-mem-title">${esc(listName)}（${rows.length}件）から絞り込む</span>
       </div>
       <div class="kc-split">
         <div class="kc-split-row"><label>探す <input type="text" id="spQ" placeholder="会社名・担当者・電話" /></label></div>
         <div class="kc-split-row"><label class="ks-check"><input type="checkbox" id="spUndone" checked /> まだかけていないものだけ</label></div>
         ${stages.length ? `<div class="kc-split-row"><div class="kc-split-lb">ステージ</div><div class="kc-split-opts">` +
           stages.map((v) => `<label class="ks-check"><input type="checkbox" class="sp-stage" value="${esc(v)}" /> ${esc(v)}</label>`).join("") +
           `</div></div>` : ""}
         ${statuses.length ? `<div class="kc-split-row"><div class="kc-split-lb">最終ステータス</div><div class="kc-split-opts">` +
           statuses.map((v) => `<label class="ks-check"><input type="checkbox" class="sp-status" value="${esc(v)}" /> ${esc(v)}</label>`).join("") +
           `</div></div>` : ""}
         <div class="kc-split-row"><label>新しいリストの名前 <input type="text" id="spName" style="min-width:280px" value="${esc(listName)}（絞り込み）" /></label></div>
         <div class="kc-split-row">
           <button class="btn" id="spMake">この条件で自分のリストを作る</button>
           <button class="btn ghost" id="spOpen">このリストでかける</button>
           <span class="rev-status" id="spStatus"></span>
         </div>
       </div>`;

    const back = $("spBack");
    if (back) back.addEventListener("click", () => asLoadMember(memberEmail, memberName));
    const open = $("spOpen");
    if (open) open.addEventListener("click", () => selectListAndCall(listId));

    const make = $("spMake");
    if (make) make.addEventListener("click", async () => {
      const say = (m) => { const e = $("spStatus"); if (e) e.textContent = m || ""; };
      const name = ($("spName") && $("spName").value.trim()) || "";
      if (!name) { say("名前を入れてください"); return; }
      say("作っています…");
      try {
        const body = {
          list: listId, name,
          q: ($("spQ") && $("spQ").value.trim()) || "",
          onlyUndone: !!($("spUndone") && $("spUndone").checked),
          stages: [...document.querySelectorAll(".sp-stage:checked")].map((x) => x.value),
          statuses: [...document.querySelectorAll(".sp-status:checked")].map((x) => x.value),
        };
        const r = await fetch("/api/calls/lists/split", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "作れませんでした");
        say(`「${j.name}」を作りました（${j["件数"]}件）`);
        loadLists();
      } catch (e) { say("失敗：" + e.message); }
    });
  } catch (e) {
    box.innerHTML = `<div class="note">読み込めませんでした：${esc(e.message)}</div>`;
  }
}

// ───────── CSVから作る（クロスリードと突き合わせ） ─────────
// 1行1社で「会社名・担当者名・電話番号・メール」。見出し行があっても飛ばす。
function csvParse(text) {
  const out = [];
  const src = String(text || "");
  if (!src.trim()) return out;

  // 引用符の中のカンマ・改行も正しく扱う
  function splitAll(t) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (q) {
        if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === "," || ch === "\t") { row.push(cell); cell = ""; }
      else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (ch !== "\r") cell += ch;
    }
    row.push(cell); rows.push(row);
    return rows.filter((r) => r.some((v) => String(v).trim()));
  }

  const rows = splitAll(src).map((r) => r.map((v) => String(v || "").trim()));
  if (!rows.length) return out;

  const head = rows[0];
  const 見出しっぽい = /会社|company|担当|電話|phone|メール|mail|架電|日付|ステータス|状況|コメント|リード/i.test(head.join(","))
    && !/\d{3,}/.test(head.join(""));
  const 場所 = { company: 0, person: 1, phone: 2, email: 3, callDate: -1, status: -1, comment: -1, leadId: -1, stage: -1 };
  if (見出しっぽい) {
    const norm = (v) => String(v || "").replace(/[\s　_・\/]/g, "").toLowerCase();
    const find = (...words) => head.findIndex((h) => words.some((w) => norm(h).includes(norm(w))));
    const set = (key, ...words) => { const i = find(...words); if (i >= 0) 場所[key] = i; };
    場所.company = -1; 場所.person = -1; 場所.phone = -1; 場所.email = -1;
    set("company", "会社名/取引先", "会社名", "会社", "取引先", "company");
    set("person", "担当者名", "担当者", "姓", "氏名", "name");
    set("phone", "電話", "phone", "tel");
    set("email", "メール", "mail");
    set("leadId", "リードid", "leadid", "レコードid");
    set("callDate", "最終活動日", "架電日", "コール日", "活動日", "日付");
    set("stage", "リード状況", "リードステータス", "ステージ");
    set("status", "最終活動ステータス", "活動ステータス", "結果");
    if (場所.status < 0) set("status", "ステータス");
    set("comment", "最終活動コメント", "活動コメント", "コメント", "メモ");
    if (場所.company < 0) 場所.company = 0;
  }
  const 取る = (c, i) => (i >= 0 && i < c.length ? c[i] : "");

  for (let i = 見出しっぽい ? 1 : 0; i < rows.length; i++) {
    const c = rows[i];
    const company = 取る(c, 場所.company);
    if (!company) continue;
    out.push({
      company,
      person: 取る(c, 場所.person),
      phone: 取る(c, 場所.phone),
      email: 取る(c, 場所.email),
      leadId: 取る(c, 場所.leadId),
      callDate: 取る(c, 場所.callDate),
      status: 取る(c, 場所.status),
      stage: 取る(c, 場所.stage),
      comment: 取る(c, 場所.comment),
    });
  }
  return out;
}

async function csvSend(dryRun) {
  const say = (m) => { const e = $("csvSt"); if (e) e.textContent = m || ""; };
  const out = $("csvOut");
  const box = $("csvFilterBox");
  const rows = (box && !box.hidden) ? csvFiltered() : csvParse(($("csvText") && $("csvText").value) || "");
  if (!rows.length) { say("この条件に合うものがありません"); return; }

  // 件数が多いと途中で切れるので、少しずつ送る。進み具合も出す。
  const CHUNK = 20;
  const 合計 = { 件数: 0, 見つかった: 0, 新しく作った: 0, とばした: 0, 履歴: 0 };
  let listId = 0, listName = "";
  const meisai = [];
  const btns = [$("csvDry"), $("csvRun")].filter(Boolean);
  btns.forEach((b) => (b.disabled = true));
  if (out) out.innerHTML = "";

  try {
    for (let i = 0; i < rows.length; i += CHUNK) {
      const part = rows.slice(i, i + CHUNK);
      const 済み = Math.min(i + CHUNK, rows.length);
      say(`${dryRun ? "試算" : "作成"}しています… ${済み} / ${rows.length}件` +
          (合計.新しく作った ? `（新しく作った ${合計.新しく作った}）` : ""));

      const r = await fetch("/api/calls/from-csv", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: ($("csvName") && $("csvName").value.trim()) || "",
          rows: part, dryRun: !!dryRun,
          share: csvShareSelected(),
          ...(listId ? { listId } : {}),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `途中で止まりました（${済み}件目まで）`);

      if (!dryRun && !listId && d.id) { listId = d.id; listName = d.name || ""; }
      合計.件数 += Number(d["件数"] || 0);
      合計.見つかった += Number(d["見つかった"] || 0);
      合計.新しく作った += Number(d["新しく作った"] || d["新しく作る"] || 0);
      合計.とばした += Number(d["とばした"] || d["とばす"] || 0);
      合計.履歴 += Number(d["履歴を残した"] || 0);
      for (const x of (d["明細"] || [])) meisai.push(x);

      // 途中経過も出しておく
      if (out) {
        out.innerHTML = '<table class="sh-table"><tr><th>会社名</th><th>担当者</th><th>リード</th><th>架電日</th><th>最終ステータス</th><th>コメント</th><th>状態</th></tr>' +
          meisai.slice(0, 300).map((x) => `<tr><td>${esc(x.company || "")}</td><td>${esc(x.person || "")}</td>` +
            `<td>${esc(x["リード種別"] || "-")}</td>` +
            `<td>${esc(x["架電日"] || "")}</td>` +
            `<td>${esc(x["ステータス"] || "-")}</td>` +
            `<td class="kc-cmt">${esc(x["コメント"] || "")}</td>` +
            `<td>${esc(x["状態"] || "")}${x["履歴"] ? `／${esc(x["履歴"])}` : ""}${x["理由"] ? `（${esc(x["理由"])}）` : ""}</td></tr>`).join("") + "</table>";
      }
    }

    if (dryRun) {
      say(`試算おわり：${rows.length}件（見つかった ${合計.見つかった}／新しく作る ${合計.新しく作った}／とばす ${合計.とばした}）`);
    } else {
      say(`「${listName}」を作りました：${合計.件数}件` +
          `（見つかった ${合計.見つかった}／新しく作った ${合計.新しく作った}／とばした ${合計.とばした}` +
          (合計.履歴 ? `／履歴 ${合計.履歴}件` : "") + "）" +
          (csvShareSelected().length ? `　${csvShareSelected().length}人に分けました` : ""));
      loadLists();
    }
  } catch (e) {
    say("失敗：" + e.message);
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
}

// 分ける人の候補（チェックで選ぶ）
// 名前を押して選ぶ（押すと色が付く）
function csvShareSelected() {
  return [...document.querySelectorAll("#csvShare .kc-share-b.on")].map((b) => b.dataset.email);
}
function csvShareRefresh() {
  const n = csvShareSelected().length;
  const hint = $("csvShareHint");
  if (hint) hint.textContent = n ? `${n}人に順番に分けます` : "選ばないと、作った人のリストになります";
  const clr = $("csvShareClear");
  if (clr) clr.hidden = !n;
}
async function csvFillShare() {
  const box = $("csvShare");
  if (!box || box.dataset.filled) return;
  try {
    const d = await (await fetch("/api/calls/members")).json();
    const items = (d && d.items) || [];
    if (!items.length) { box.innerHTML = '<span class="note">メンバーがいません</span>'; return; }
    box.innerHTML = items.map((m) =>
      `<button type="button" class="kc-share-b" data-email="${esc(m.email)}">${esc(m.name)}</button>`
    ).join("");
    box.dataset.filled = "1";
    box.querySelectorAll(".kc-share-b").forEach((b) =>
      b.addEventListener("click", () => { b.classList.toggle("on"); csvShareRefresh(); }));
    const clr = $("csvShareClear");
    if (clr) clr.addEventListener("click", () => {
      box.querySelectorAll(".kc-share-b.on").forEach((b) => b.classList.remove("on"));
      csvShareRefresh();
    });
    csvShareRefresh();
  } catch { box.innerHTML = '<span class="note">読み込めませんでした</span>'; }
}

// CSVの中身から、ステージ・ステータスの選択肢を作る
let csvRowsCache = [];
let csvStageList = null;
async function csvLoadStages() {
  if (csvStageList) return csvStageList;
  try {
    const d = await (await fetch("/api/calls/picklists")).json();
    csvStageList = ((d && d["リードの状態"]) || []).map((x) => x.label || x.value);
  } catch { csvStageList = []; }
  // CSVの書き方（01：新規／01:新規／新規）の違いを、SFの言い方にそろえる
  const そろえる2 = (v) => String(v || "").replace(/[\s　:：]/g, "").toLowerCase();
  window.csvNormStage = (v) => {
    const t = String(v || "").trim();
    if (!t) return "（空）";
    const hit = (csvStageList || []).find((w) =>
      そろえる2(w) === そろえる2(t) ||
      そろえる2(w).startsWith(そろえる2(t)) ||
      そろえる2(t).startsWith(そろえる2(w)));
    return hit || t;
  };
  return csvStageList;
}

async function csvBuildFilters() {
  const box = $("csvFilterBox");
  if (!box) return;
  await csvLoadStages();
  csvRowsCache = csvParse(($("csvText") && $("csvText").value) || "");
  if (!csvRowsCache.length) { box.hidden = true; return; }
  // ステータスは決まった選択肢だけを見る。それ以外は「-（コメント扱い）」にまとめる。
  const 決まった結果 = [
    "受付ブロック", "担当者不在", "担当者接触：お断り", "担当者接触：アポ獲得",
    "担当者接触：営業フォロー", "現在使われていない", "コールのみ", "問い合わせ",
    "担当者接触ニーズなし",
  ];
  const そろえる = (v) => String(v || "").replace(/[\s　:：]/g, "");
  window.csvNormStatus = (v) => {
    const t = String(v || "").trim();
    if (!t) return "（空）";
    const hit = 決まった結果.find((w) => そろえる(w) === そろえる(t));
    return hit || "-（コメント扱い）";
  };
  const 数える = (key) => {
    const m = new Map();
    for (const r of csvRowsCache) {
      const v = key === "status" ? window.csvNormStatus(r[key])
        : (String(r[key] || "").trim() || "（空）");
      m.set(v, (m.get(v) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const 出す = (id, key) => {
    const el = $(id);
    if (!el) return;
    let list = 数える(key);
    if (key === "stage") {
      // SFの並び順にそろえる（01：新規 → 02：担当未接触 …）
      const 順 = (v) => { const i = (csvStageList || []).indexOf(v); return i < 0 ? 999 : i; };
      list = list.sort((a, b) => 順(a[0]) - 順(b[0]));
    }
    el.innerHTML = list.map(([v, n]) =>
      `<button type="button" class="kc-share-b on" data-v="${esc(v)}">${esc(v)} <span class="kc-n">${n}</span></button>`).join("");
    el.querySelectorAll(".kc-share-b").forEach((b) =>
      b.addEventListener("click", () => { b.classList.toggle("on"); csvFilterRefresh(); }));
  };
  出す("csvStages", "stage");   // SFのリード状況にそろえる
  出す("csvStatuses", "status");
  box.hidden = false;
  csvFilterRefresh();
}
function csvPicked(id) {
  return new Set([...document.querySelectorAll(`#${id} .kc-share-b.on`)].map((b) => b.dataset.v));
}
function csvFiltered() {
  const st = csvPicked("csvStages"), su = csvPicked("csvStatuses");
  const 段 = (v) => (window.csvNormStage ? window.csvNormStage(v) : (String(v || "").trim() || "（空）"));
  const 状 = (v) => (window.csvNormStatus ? window.csvNormStatus(v) : (String(v || "").trim() || "（空）"));
  return csvRowsCache.filter((r) => st.has(段(r.stage)) && su.has(状(r.status)));
}
function csvFilterRefresh() {
  const hint = $("csvFilterHint");
  if (hint) hint.textContent = `${csvFiltered().length} / ${csvRowsCache.length}件をリストにします`;
}

(function wireCsv() {
  csvFillShare();
  const ta = document.getElementById("csvText");
  if (ta) {
    let t = 0;
    ta.addEventListener("input", () => { clearTimeout(t); t = setTimeout(csvBuildFilters, 400); });
  }
  const fc = document.getElementById("csvFilterClear");
  if (fc) fc.addEventListener("click", () => {
    document.querySelectorAll("#csvStages .kc-share-b, #csvStatuses .kc-share-b")
      .forEach((b) => b.classList.add("on"));
    csvFilterRefresh();
  });
  const f = document.getElementById("csvFile");
  if (f) f.addEventListener("change", () => {
    const file = f.files && f.files[0];
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      if ($("csvText")) $("csvText").value = String(rd.result || "");
      if ($("csvName") && !$("csvName").value.trim()) $("csvName").value = file.name.replace(/\.csv$/i, "");
      const e = $("csvSt"); if (e) e.textContent = "読み込みました。中身を確かめてから進めてください。";
      csvBuildFilters();
    };
    rd.readAsText(file, "UTF-8");
  });
  const dry = document.getElementById("csvDry");
  if (dry) dry.addEventListener("click", () => csvSend(true));
  const run = document.getElementById("csvRun");
  if (run) run.addEventListener("click", () => csvSend(false));
})();

// リスト作成の中の切り替え（CSVから作る／Salesforceのレポートから作る）
(function wireMakeTabs() {
  const tabs = document.getElementById("mkTabs");
  if (!tabs) return;
  tabs.addEventListener("click", (ev) => {
    const b = ev.target && ev.target.closest ? ev.target.closest(".kc-ptab") : null;
    if (!b) return;
    const name = b.dataset.mk || "csv";
    tabs.querySelectorAll(".kc-ptab").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll("[data-mk-pane]").forEach((el) => { el.hidden = el.dataset.mkPane !== name; });
    if (name === "sf") {
      if (typeof window.initSfReport === "function") window.initSfReport("lead");
      srFillShare();
    }
  });
})();

// Salesforceレポートから作るときの「分ける人」
function srShareSelected() {
  return [...document.querySelectorAll("#srShare .kc-share-b.on")].map((b) => b.dataset.email);
}
function srShareRefresh() {
  const n = srShareSelected().length;
  const hint = $("srShareHint");
  if (hint) hint.textContent = n ? `${n}人に順番に分けます` : "選ばないと、作った人のリストになります";
  const clr = $("srShareClear");
  if (clr) clr.hidden = !n;
  // sf-data.js から読めるようにしておく
  window.kcShareMembers = srShareSelected();
}
async function srFillShare() {
  const box = $("srShare");
  if (!box || box.dataset.filled) return;
  try {
    const d = await (await fetch("/api/calls/members")).json();
    const items = (d && d.items) || [];
    if (!items.length) { box.innerHTML = '<span class="note">メンバーがいません</span>'; return; }
    box.innerHTML = items.map((m) =>
      `<button type="button" class="kc-share-b" data-email="${esc(m.email)}">${esc(m.name)}</button>`).join("");
    box.dataset.filled = "1";
    box.querySelectorAll(".kc-share-b").forEach((b) =>
      b.addEventListener("click", () => { b.classList.toggle("on"); srShareRefresh(); }));
    const clr = $("srShareClear");
    if (clr) clr.addEventListener("click", () => {
      box.querySelectorAll(".kc-share-b.on").forEach((b) => b.classList.remove("on"));
      srShareRefresh();
    });
    srShareRefresh();
  } catch { box.innerHTML = '<span class="note">読み込めませんでした</span>'; }
}

// ───────── メンバー別の分析 ─────────
async function loadAnalysis() {
  const box = $("clStats");
  if (!box) return;
  box.innerHTML = '<div class="note">読み込んでいます…</div>';
  try {
    const d = await (await fetch("/api/calls/analysis?days=30")).json();
    if (d.error) throw new Error(d.error);
    const rg = $("stRange");
    if (rg) rg.textContent = `${d.from} 〜 ${d.to}（直近${d["日数"]}日）`;
    const items = d.items || [];
    const t = d["チーム"] || {};
    if (!items.length) { box.innerHTML = '<div class="note">この期間の記録はまだありません。</div>'; return; }

    const 差 = (a, b) => {
      const v = +(a - b).toFixed(1);
      if (!v) return '<span class="an-eq">±0</span>';
      return `<span class="${v > 0 ? "an-up" : "an-down"}">${v > 0 ? "+" : ""}${v}</span>`;
    };
    const 棒 = (n, max) => `<span class="an-bar"><i style="width:${max ? Math.round(n / max * 100) : 0}%"></i></span>`;

    box.innerHTML =
      `<div class="an-team">チーム全体：コール ${t["コール"] || 0}／接触 ${t["接触"] || 0}（${t["接触率"] || 0}%）／アポ ${t["アポ"] || 0}（${t["アポ率"] || 0}%）</div>` +
      items.map((x) => {
        const 時最大 = Math.max(1, ...x["時間帯"].map((h) => h["コール"]));
        return `
        <div class="an-card">
          <div class="an-h">${esc(x["誰"])}</div>

          <div class="an-kpi">
            <div class="an-k"><div class="an-kn">${x["コール"]}</div><div class="an-kl">コール</div></div>
            <div class="an-k"><div class="an-kn">${x["接触率"]}%</div><div class="an-kl">接触率 ${差(x["接触率"], t["接触率"] || 0)}</div></div>
            <div class="an-k"><div class="an-kn">${x["アポ率"]}%</div><div class="an-kl">アポ率 ${差(x["アポ率"], t["アポ率"] || 0)}</div></div>
            <div class="an-k"><div class="an-kn">${x["稼働日数"]}日</div><div class="an-kl">かけた日</div></div>
            <div class="an-k"><div class="an-kn">${x["1日あたり"]}</div><div class="an-kl">1日あたり</div></div>
          </div>

          <div class="an-cols">
            <div class="an-col">
              <div class="an-t">どこで落ちているか</div>
              <div class="an-funnel">コール ${x["コール"]} → 接触 ${x["接触"]}（${x["接触率"]}%） → アポ ${x["アポ"]}（${x["アポ率"]}%）</div>
              <table class="sh-table an-tb">${x["内訳"].slice(0, 8).map((r) =>
                `<tr><td>${esc(r["名前"])}</td><td class="an-n">${r["件数"]}</td><td class="an-n">${r["割合"]}%</td></tr>`).join("")}</table>
            </div>

            <div class="an-col">
              <div class="an-t">時間帯（何時が繋がるか）</div>
              <table class="sh-table an-tb">${x["時間帯"].map((h) =>
                `<tr><td>${h["時"]}時</td><td class="an-n">${h["コール"]}</td>` +
                `<td>${棒(h["コール"], 時最大)}</td><td class="an-n">${h["接触率"]}%</td></tr>`).join("")}</table>
            </div>
          </div>

          <div class="an-cols">
            <div class="an-col">
              <div class="an-t">相手のステージ別</div>
              <table class="sh-table an-tb">${(x["ステージ"] || []).map((r) =>
                `<tr><td>${esc(r["名前"])}</td><td class="an-n">${r["コール"]}</td><td class="an-n">${r["接触率"]}%</td><td class="an-n">アポ${r["アポ"]}</td></tr>`).join("") || "<tr><td>—</td></tr>"}</table>
            </div>
            <div class="an-col">
              <div class="an-t">業種別</div>
              <table class="sh-table an-tb">${(x["業種"] || []).map((r) =>
                `<tr><td>${esc(r["名前"])}</td><td class="an-n">${r["コール"]}</td><td class="an-n">${r["接触率"]}%</td><td class="an-n">アポ${r["アポ"]}</td></tr>`).join("") || "<tr><td>—</td></tr>"}</table>
            </div>
          </div>

          <div class="an-t">週ごとの動き</div>
          <table class="sh-table an-tb">
            <tr><th>週</th>${x["週"].map((w) => `<th class="an-n">${w["週"].slice(5).replace("-", "/")}</th>`).join("")}</tr>
            <tr><td>コール</td>${x["週"].map((w) => `<td class="an-n">${w["コール"]}</td>`).join("")}</tr>
            <tr><td>接触率</td>${x["週"].map((w) => `<td class="an-n">${w["接触率"]}%</td>`).join("")}</tr>
            <tr><td>アポ</td>${x["週"].map((w) => `<td class="an-n">${w["アポ"]}</td>`).join("")}</tr>
          </table>
        </div>`;
      }).join("");
  } catch (e) { box.innerHTML = `<div class="note">読み込めませんでした：${esc(e.message)}</div>`; }
}
