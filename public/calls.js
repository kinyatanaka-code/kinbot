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
let hideApo = false;   // アポ獲得済みを隠しているか
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
  // アポ獲得済みは、いつも一番下にまとめる（並べ替え・絞り込みのあとで寄せる）
  const 済 = list.filter((x) => isApoDone(x));
  const 未 = list.filter((x) => !isApoDone(x));
  return [...未, ...済];
}

// アポ獲得済みかどうか（最終ステータスに「アポ獲得」が入っているか）
function isApoDone(x) {
  return /アポ獲得/.test(String((x && x["最終ステータス"]) || ""));
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
  const fullList = visibleRows();
  const list = hideApo ? fullList.filter((x) => !isApoDone(x)) : fullList;
  const arrow = (k) => sortBy === k ? (sortDesc ? " ▾" : " ▴") : "";
  const on = (k) => filt[k] && filt[k].size ? " on" : "";
  if (!fullList.length) {
    box.innerHTML = `<div class="empty-state">${rows.length ? "この条件に当てはまるものがありません。" : "リストを選んでください。"}</div>`;
    return;
  }
  const apoN = fullList.filter(isApoDone).length;
  box.innerHTML =
    `<div class="kc-summary">かける先 <b>${fullList.length - apoN}</b> 件` +
    (apoN
      ? `／<span class="kc-sum-apo">アポ獲得済み <b>${apoN}</b> 件</span>` +
        `<button type="button" class="kc-sum-btn" id="kcHideApo">${hideApo ? "アポ獲得も表示" : "アポ獲得を隠す"}</button>`
      : "") +
    `</div>` +
    `<div class="kc-tablewrap"><table class="kc-table">
      <tr>
        <th class="kc-th-o">現所有者</th>
        <th class="kc-th-s"><button type="button" class="kc-th-b${on("stage")}" data-flt="stage">ステージ ▾</button></th>
        <th class="kc-co"><button type="button" class="kc-th-b" data-sort="company">会社名${arrow("company")}</button></th>
        <th class="kc-th-p">担当者</th>
        <th class="kc-th-t">電話番号</th>
        <th class="kc-th-m">メールアドレス</th>
        <th class="kc-th-s"><button type="button" class="kc-th-b${on("status")}" data-flt="status">最終ステータス ▾</button></th>
        <th class="kc-th-h"><button type="button" class="kc-th-b${filt.hist ? " on" : ""}" data-hist="1">履歴${arrow("hist")}</button></th>
        <th class="kc-th-r">記録</th>
        <th class="kc-th-e">編集</th>
        <th class="kc-th-d">資料送付</th>
      </tr>` +
    list.map((x, i) => {
      const 済 = isApoDone(x);
      const 直前未済 = i > 0 && !isApoDone(list[i - 1]);
      const 区切り = (済 && (i === 0 || 直前未済))
        ? `<tr class="kc-apo-sep"><td colspan="11">アポ獲得済み（${list.filter(isApoDone).length}件）</td></tr>`
        : "";
      return 区切り + `
      <tr data-id="${x.id}" class="${済 ? "kc-apo-done" : ""}">
        <td class="kc-owner">${esc(x["所有者"] || "")}</td>
        <td>${esc(x["ステージ"] || "-")}</td>
        <td class="kc-co">${esc(x["会社名"] || "")}${済 ? ' <span class="kc-apo-badge">アポ獲得済み</span>' : ""}</td>
        <td>${esc(x["担当者"] || "")}</td>
        <td>${x["電話番号"]
          ? `<a class="kc-tel" href="tel:${esc(telOf(x["電話番号"]))}">${esc(x["電話番号"])}</a>`
          : `<span class="kc-none">なし</span>`}</td>
        <td class="kc-mail">${esc(x["メール"] || "")}</td>
        <td>${x["最終ステータス"] ? esc(x["最終ステータス"]) : "-"}</td>
        <td><button type="button" class="kc-btn kc-hist" data-id="${x.id}">${x["履歴数"] ? `${x["履歴数"]}件` : "なし"}</button></td>
        <td><button type="button" class="kc-btn kc-rec" data-id="${x.id}">記録</button></td>
        <td><button type="button" class="kc-btn kc-edit" data-id="${x.id}">編集</button></td>
        <td><button type="button" class="kc-btn kc-doc" data-id="${x.id}">資料送付</button></td>
      </tr>`;
    }).join("") + `</table></div>`;

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
  box.querySelectorAll(".kc-doc").forEach((b) =>
    b.addEventListener("click", () => openDocSend(b.dataset.id)));
  const hideBtn = $("kcHideApo");
  if (hideBtn) hideBtn.addEventListener("click", () => { hideApo = !hideApo; render(); });
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
  box._targetId = id;
  try {
    const d = await (await fetch(`/api/calls/targets/${encodeURIComponent(id)}/history`)).json();
    if (d.error) throw new Error(d.error);
    const items = d.items || [];
    box.innerHTML =
      (d.note ? `<div class="note">${esc(d.note)}</div>` : "") +
      (items.length
        ? items.map((h, i) => `
            <div class="kc-hist-row" data-hi="${i}"
                 data-task="${esc(h.taskId || "")}" data-log="${esc(h.logId || "")}"
                 data-result="${esc(h["結果"] || "")}" data-memo="${esc(h["メモ"] || "")}">
              <div class="kc-hist-top">
                <span class="kc-hist-at">${esc(h["日付のみ"] ? String(when(h.at)).replace(/\s*\d{1,2}:\d{2}$/, "") : when(h.at))}</span>
                <span class="kc-hist-r">${esc(h["件名"] || h["結果"] || "")}</span>
                ${h["件名"] && h["結果"] ? `<span class="kc-hist-res">${esc(h["結果"])}</span>` : ""}
                <span class="kc-hist-who">${esc(h["誰"] || "")}</span>
                ${h["元"] === "salesforce" ? '<span class="kc-hist-sf">SF</span>' : ""}
                ${h["直せる"] ? '<button type="button" class="kc-hist-edit" data-hedit="1">直す</button>' : ""}
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
    .an-range{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px;}
    .an-range input[type=date]{border:1px solid #e6ece9;border-radius:8px;padding:5px 8px;font-size:13px;font-family:inherit;}
    .an-sep{font-size:12px;color:#8a9a93;margin:0 2px;}
    .an-clear{margin-top:12px;padding-top:10px;border-top:1px solid #eef3f0;display:flex;gap:10px;align-items:center;}
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
    .an-ex{font-size:11px;color:#6b7c74;max-width:420px;white-space:normal;}
    .an-ul{margin:4px 0 0;padding-left:20px;font-size:12px;color:#1f2a26;}
    .an-ul li{margin-bottom:4px;}
    .kc-g-block{margin-bottom:10px;border:1px solid #e6ece9;border-radius:12px;padding:8px 12px;background:#fcfefe;}
    .kc-g-block table{width:100%;}
    .kc-g-title{font-size:13px;font-weight:700;color:#0d5b47;margin:0 0 4px;}
    .kc-g-team{background:#eaf5ef;border-color:#cfe6da;}
    .kc-grid th,.kc-grid td{padding:3px 8px;}
    .kc-g-now{background:#eaf5ef;}
    .kc-grid th.kc-g-now{background:#1d9e75;color:#fff;border-radius:6px 6px 0 0;}
    .kc-grid th.kc-g-now .kc-g-w{color:#dff2e8;}
    .kc-grid td.kc-g-now{font-weight:700;color:#0d5b47;}
    .kc-g-apo td{font-weight:700;}
    .kc-g-tot{background:#f4f7f5;font-weight:700;}
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
    .kc-g-title{display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:none;border:0;cursor:pointer;padding:2px 0;margin:0 0 4px;font-family:inherit;font-size:13px;font-weight:700;color:#0d5b47;}
    .kc-g-title:hover .kc-g-tname{color:#0b7a5e;}
    .kc-g-chev{display:inline-flex;color:#1d9e75;transition:transform .15s ease;}
    .kc-g-block.kc-g-collapsed .kc-g-chev{transform:rotate(-90deg);}
    .kc-g-block.kc-g-collapsed .kc-g-body{display:none;}
    .kc-g-tname{flex:none;color:#0d5b47;}
    .kc-g-tsum{margin-left:auto;font-size:11px;font-weight:600;color:#5b7a6d;font-variant-numeric:tabular-nums;}
    .kc-g-rate td{color:#0F6E56;background:#f6fbf9;font-variant-numeric:tabular-nums;}
    .kc-g-rate .kc-g-name{color:#0F6E56;}
    .kc-g-rate.kc-g-rate-top td{border-top:2px solid #d6efe2;}
    .kc-hist-edit{margin-left:auto;background:none;border:0;color:#1d9e75;font-size:11px;cursor:pointer;padding:0 2px;text-decoration:underline;}
    .kc-hist-edit:hover{color:#0b7a5e;}
    .kc-stage-only{margin-left:8px;font-size:12px;padding:4px 10px;}
    .an-card-all{border:2px solid #1d9e75;background:#f6fbf9;}
    .an-card-all .an-h{color:#0d5b47;}
    .kc-apo-done{background:#f2f8f5;color:#5b7a6d;}
    .kc-apo-done .kc-co{color:#0d5b47;}
    .kc-apo-sep td{background:#e8f5ef;color:#0d5b47;font-weight:700;font-size:12px;padding:6px 10px;border-top:2px solid #1d9e75;}
    .kc-apo-badge{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:10px;background:#1d9e75;color:#fff;font-size:11px;font-weight:700;vertical-align:middle;}
    .kc-summary{display:flex;align-items:center;gap:10px;padding:8px 4px;font-size:13px;color:#0d5b47;}
    .kc-summary b{font-size:15px;}
    .kc-sum-apo{color:#0b7a5e;}
    .kc-sum-btn{margin-left:4px;font-size:12px;padding:3px 10px;border:1px solid #1d9e75;border-radius:8px;background:#fff;color:#1d9e75;cursor:pointer;}
    .kc-sum-btn:hover{background:#eaf5ef;}
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
            <button type="button" class="btn ghost kc-stage-only" id="kcStageOnly">ステージだけ変える</button>
            <span class="rev-status" id="kcStageSt"></span>
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

        <div class="kc-lb">次回架電日（ネクストアクション・任意）</div>
        <input type="date" class="kc-input" id="kcNext" />

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
  const histBox = m.el.querySelector("#kcHist");
  renderHistoryInto(histBox, id);

  // 履歴の「直す」→ その行を編集フォームに差し替えて、結果・メモを直す。
  // モーダル内の箱に付ける（documentに付けると、モーダルが伝播を止めていて届かないため）。
  if (histBox) histBox.addEventListener("click", async (ev) => {
    const tt = ev.target;
    if (!tt || !tt.closest) return;

    const editBtn = tt.closest(".kc-hist-edit");
    if (editBtn) {
      const row = editBtn.closest(".kc-hist-row");
      const cur = row.getAttribute("data-result") || "";
      const memo = row.getAttribute("data-memo") || "";
      row._ctx = { taskId: row.getAttribute("data-task") || "", logId: row.getAttribute("data-log") || "" };
      row.innerHTML = `
        <div class="kc-lb">結果</div>
        <select class="kc-input kc-he-result">
          <option value="">（変えない）</option>
          ${結果の選択肢.map((k) => `<option value="${esc(k)}"${k === cur ? " selected" : ""}>${esc(k)}</option>`).join("")}
        </select>
        <div class="kc-lb">メモ</div>
        <textarea class="kc-input kc-he-memo" rows="3">${esc(memo)}</textarea>
        <div class="kc-modal-foot">
          <button type="button" class="btn kc-he-save">直す</button>
          <button type="button" class="btn ghost kc-he-cancel">やめる</button>
          <span class="rev-status kc-he-st"></span>
        </div>`;
      return;
    }

    if (tt.closest(".kc-he-cancel")) { renderHistoryInto(histBox, id); return; }

    const saveBtn = tt.closest(".kc-he-save");
    if (saveBtn) {
      const row = saveBtn.closest(".kc-hist-row");
      const ctx = (row && row._ctx) || {};
      const result = (row.querySelector(".kc-he-result") || {}).value || "";
      const memo = (row.querySelector(".kc-he-memo") || {}).value || "";
      const st = row.querySelector(".kc-he-st");
      if (!result && !memo) { if (st) st.textContent = "結果かメモを入れてください"; return; }
      if (st) st.textContent = "直しています…";
      try {
        const r = await fetch(`/api/calls/targets/${encodeURIComponent(id)}/history/edit`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ taskId: ctx.taskId || undefined, logId: ctx.logId || undefined, result, memo }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "直せませんでした");
        renderHistoryInto(histBox, id);
      } catch (e) { if (st) st.textContent = "失敗：" + e.message; }
      return;
    }
  });

  // 「ステージだけ変える」：記録はせず、ステージ（リード状況）だけを変えてSFにも反映
  const stageOnly = m.el.querySelector("#kcStageOnly");
  if (stageOnly) stageOnly.addEventListener("click", async () => {
    const sel = m.el.querySelector("#kcStatus");
    const val = sel ? sel.value : "";
    if (!val) { say("kcStageSt", "変えるステージを選んでください", 4000); return; }
    stageOnly.disabled = true;
    say("kcStageSt", "変えています…");
    try {
      const r = await fetch(`/api/calls/targets/${encodeURIComponent(id)}/stage`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ stage: val }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "変えられませんでした");
      const lb = sel.tagName === "SELECT" ? (sel.options[sel.selectedIndex] || {}).textContent : val;
      const now = m.el.querySelector(".kc-stage-now"); if (now) now.textContent = lb || val;
      x["ステージ"] = val;
      const rowCell = document.querySelector(`tr[data-id="${id}"] td:nth-child(2)`);
      if (rowCell) rowCell.textContent = lb || val;
      say("kcStageSt", d.sf && d.sf.ok ? "変えました（SFにも反映）" : `変えました${d.sf && d.sf.reason ? `（SFは未反映：${d.sf.reason}）` : ""}`, 6000);
    } catch (e) { say("kcStageSt", "失敗：" + e.message, 6000); }
    finally { stageOnly.disabled = false; }
  });

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
          // 次回架電日（ネクストアクション日）。SFのリード項目に書く。
          nextAction: (m.el.querySelector("#kcNext") || {}).value || "",
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
      // アポ獲得のときは、一覧を描き直して「アポ獲得済み」として下にまとめる
      if (isApoDone(x)) render();
      // 記録しただけでは下に残さない（「—」で最小化したときだけ残す）。
      // もし最小化してあった同じ相手が残っていれば、それは消す。
      dockItems = dockItems.filter((d) => d.id !== id);
      renderDock();
      m.close();
      const 代理 = d.sf && d.sf["代理"] ? `（${d.sf["代理"]}さんとして残しました）` : "";
      const 次回 = d.sf && d.sf.nextAction ? `　次回架電日=${d.sf.nextAction} をSFに書きました` : "";
      const 次回注意 = d.sf && d.sf.nextActionNote ? `　※${d.sf.nextActionNote}` : "";
      say("clStatus", (d.sf && d.sf.ok
        ? `記録しました${代理 || "（Salesforceにも残しました）"}`
        : `記録しました${d.sf && d.sf.reason ? `（SFへは残せません：${d.sf.reason}）` : ""}`) + 次回 + 次回注意, 8000);
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
  if (td[1]) td[1].textContent = x["ステージ"] || "-";
  if (td[6]) td[6].textContent = x["最終ステータス"] || "-";
  if (td[7]) {
    const b = td[7].querySelector("button");
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
  if (td[2]) td[2].textContent = x["会社名"] || "";
  if (td[3]) td[3].textContent = x["担当者"] || "";
  if (td[4]) {
    td[4].innerHTML = x["電話番号"]
      ? `<a class="kc-tel" href="tel:${esc(telOf(x["電話番号"]))}">${esc(x["電話番号"])}</a>`
      : `<span class="kc-none">なし</span>`;
  }
  if (td[5]) td[5].textContent = x["メール"] || "";
  tr.classList.add("kc-just");
  setTimeout(() => tr.classList.remove("kc-just"), 1600);
}

// トラッキング資料を送る。まずプレビューを出して、確認してから送信する。
async function openDocSend(id) {
  const x = rows.find((r) => String(r.id) === String(id));
  const 相手名 = x ? [x["会社名"], x["担当者"]].filter(Boolean).join("　") : "";
  const m = openModal(`資料送付${相手名 ? "：" + 相手名 : ""}`, `
    <div class="kc-doc-send">
      <div id="kcDocLoad" class="note">資料URLを用意しています…</div>
      <div id="kcDocForm" style="display:none">
        <div class="kc-lb">宛先（メール）</div>
        <input type="email" class="kc-input" id="kcDocTo" />
        <div class="kc-lb">件名</div>
        <input type="text" class="kc-input" id="kcDocSub" />
        <div class="kc-lb">本文（この内容で送られます。URLは本文内に入っています）</div>
        <textarea class="kc-input" id="kcDocBody" rows="10"></textarea>
        <div class="note" id="kcDocMeta"></div>
        <div class="kc-modal-foot">
          <button type="button" class="btn" id="kcDocSend">この内容で送る</button>
          <span class="rev-status" id="kcDocSt"></span>
        </div>
      </div>
    </div>`, { wide: true });

  try {
    const r = await fetch(`/api/calls/targets/${encodeURIComponent(id)}/doc/preview`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "用意できませんでした");
    m.el.querySelector("#kcDocLoad").style.display = "none";
    m.el.querySelector("#kcDocForm").style.display = "";
    m.el.querySelector("#kcDocTo").value = d.to || "";
    m.el.querySelector("#kcDocSub").value = d.subject || "";
    m.el.querySelector("#kcDocBody").value = d.body || "";
    m.el.querySelector("#kcDocMeta").textContent =
      `資料：${d.docName || "（既定の資料）"}　／　URL：${d.url || ""}` + (d.warn ? `　⚠${d.warn}` : "");
  } catch (e) {
    m.el.querySelector("#kcDocLoad").textContent = "用意できませんでした：" + e.message;
    return;
  }

  m.el.querySelector("#kcDocSend").addEventListener("click", async () => {
    const to = m.el.querySelector("#kcDocTo").value.trim();
    const subject = m.el.querySelector("#kcDocSub").value.trim();
    const body = m.el.querySelector("#kcDocBody").value;
    const st = m.el.querySelector("#kcDocSt");
    const btn = m.el.querySelector("#kcDocSend");
    if (!to) { st.textContent = "宛先を入れてください"; return; }
    btn.disabled = true; st.textContent = "送っています…";
    try {
      const r = await fetch(`/api/calls/targets/${encodeURIComponent(id)}/doc/send`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, subject, body }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "送れませんでした");
      st.textContent = `${d.to} に送りました`;
      setTimeout(() => m.close(), 1200);
    } catch (e) { st.textContent = "失敗：" + e.message; btn.disabled = false; }
  });
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
    const 今 = d["今"] || "";

    const rg = $("stRange");
    if (rg) rg.textContent = 区切り.length
      ? `${区切り[0]["名前"]} 〜 ${区切り[区切り.length - 1]["名前"]}` : "";

    const いま = (c) => (c.key === 今 ? " kc-g-now" : "");
    const 頭 = `<tr><th class="kc-g-name">　</th>` +
      区切り.map((c) => `<th class="kc-g-h${いま(c)}"><div>${esc(c["名前"])}</div>` +
        (c["曜日"] ? `<div class="kc-g-w">${esc(c["曜日"])}</div>` : "") + `</th>`).join("") +
      `<th class="kc-g-h kc-g-tot">合計</th></tr>`;

    const chev = '<svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">' +
      '<path d="M6 8l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + "%" : "—");

    const 表 = (名前, 値, cls) => {
      const 計 = (key) => 値.reduce((a, v) => a + (v[key] || 0), 0);
      const 行 = (lb, key, rcls) =>
        `<tr class="${rcls || ""}"><td class="kc-g-name">${esc(lb)}</td>` +
        値.map((v, i) => `<td class="kc-g-n${いま(区切り[i])}">${v[key] || 0}</td>`).join("") +
        `<td class="kc-g-n kc-g-tot">${計(key)}</td></tr>`;
      // 率の行（分子an ÷ 分母bn）。0で割るところは「—」にする。
      const 率行 = (lb, an, bn, top) =>
        `<tr class="kc-g-rate${top ? " kc-g-rate-top" : ""}"><td class="kc-g-name">${esc(lb)}</td>` +
        値.map((v, i) => `<td class="kc-g-n${いま(区切り[i])}">${pct(v[an] || 0, v[bn] || 0)}</td>`).join("") +
        `<td class="kc-g-n kc-g-tot">${pct(計(an), 計(bn))}</td></tr>`;
      const tc = 計("コール");
      const sum = `コール ${tc}｜接触率 ${pct(計("接触"), tc)}｜アポ率 ${pct(計("アポ"), tc)}`;
      return `<div class="kc-g-block${cls || ""}">
        <button type="button" class="kc-g-title" aria-expanded="true">
          <span class="kc-g-chev">${chev}</span>
          <span class="kc-g-tname">${esc(名前)}</span>
          <span class="kc-g-tsum">${sum}</span>
        </button>
        <div class="kc-g-body">
          <table class="sh-table kc-grid">
            ${頭}
            ${行("コール", "コール")}
            ${行("接触", "接触")}
            ${行("アポ", "アポ", "kc-g-apo")}
            ${率行("コール→接触率", "接触", "コール", true)}
            ${率行("接触→アポ率", "アポ", "接触")}
            ${率行("コール→アポ率", "アポ", "コール")}
          </table>
        </div>
      </div>`;
    };

    const ある = items.filter((x) => x["値"].some((v) => v.コール || v.接触 || v.アポ));
    const ない = items.filter((x) => !x["値"].some((v) => v.コール || v.接触 || v.アポ));

    box.innerHTML = items.length
      ? 表("チーム合計", 合計, " kc-g-team") +
        ある.map((x) => 表(x["誰"], x["値"])).join("") +
        (ない.length ? `<div class="note">この期間に記録がない人：${ない.map((x) => esc(x["誰"])).join("、")}</div>` : "")
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
    say("clNewStatus", `「${d.name}」を作りました（${d["件数"]}件${d["重複除外"] ? `／重複を${d["重複除外"]}件外した` : ""}${d["所有者変更"] ? `／所有者を${d["所有者変更"]}件を中澤さんに変更` : ""}）`, 8000);
    if ($("clPaste")) $("clPaste").value = "";
    loadLists();
  } catch (e) { say("clNewStatus", "失敗：" + e.message, 10000); }
}

// 画面ぜんたいでクリックを受け止める（途中で止まっても押せるように）
document.addEventListener("click", (ev) => {
  const t = ev.target && ev.target.closest ? ev.target.closest("button") : null;
  if (!t) return;
  // 実績カードの見出しを押したら、たたむ・ひらく
  if (t.classList.contains("kc-g-title")) {
    const block = t.closest(".kc-g-block");
    if (block) {
      const collapsed = block.classList.toggle("kc-g-collapsed");
      t.setAttribute("aria-expanded", collapsed ? "false" : "true");
    }
    return;
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
    say("clSfStatus", `「${d.name}」に${d["件数"] ?? d["入れた数"]}件入れました${d["重複除外"] ? `（重複を${d["重複除外"]}件外した）` : ""}`, 8000);
    box.innerHTML = "";
    loadLists();
  } catch (e) { say("clSfStatus", "失敗：" + e.message, 8000); }
}

document.addEventListener("click", (ev) => {
  const t = ev.target && ev.target.closest ? ev.target.closest("button") : null;
  if (!t) return;
  if (t.id === "clSfFind") { ev.preventDefault(); sfFind(); }
  if (t.id === "clDedup") {
    ev.preventDefault();
    (async () => {
      if (!listId) { say("clStatus", "リストを選んでください", 4000); return; }
      say("clStatus", "重複を調べています…");
      try {
        // まず件数を出す（消さない）
        const pre = await (await fetch(`/api/calls/lists/${encodeURIComponent(listId)}/dedupe-activities`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dryRun: true }),
        })).json();
        if (pre.error) throw new Error(pre.error);
        if (!pre["重複"]) { say("clStatus", `重複した活動履歴はありませんでした（リード${pre["リード数"] || 0}件を確認）`, 8000); return; }
        if (!confirm(`重複した活動履歴が ${pre["重複"]}件 見つかりました。\n各まとまりで一番古い1件は残し、Salesforceから ${pre["重複"]}件を削除します。よろしいですか？`)) {
          say("clStatus", "やめました", 4000); return;
        }
        say("clStatus", "重複を整理しています…");
        const d = await (await fetch(`/api/calls/lists/${encodeURIComponent(listId)}/dedupe-activities`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dryRun: false }),
        })).json();
        if (d.error) throw new Error(d.error);
        say("clStatus", `整理しました：${d["消した"] || 0}件を削除（リード${d["リード数"] || 0}件）`
          + (d.errors && d.errors.length ? `／一部失敗 ${d.errors.length}件` : ""), 10000);
      } catch (e) { say("clStatus", "できませんでした：" + e.message, 8000); }
    })();
  }
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
         <div class="kc-split-row" style="border-bottom:1px solid #e6ece9;padding-bottom:10px;margin-bottom:6px">
           <label>今のリストの名前 <input type="text" id="spRename" style="min-width:280px" value="${esc(listName)}" /></label>
           <button class="btn ghost" id="spRenameBtn">名前を変える</button>
           <span class="rev-status" id="spRenameSt"></span>
         </div>
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

    // 今のリストの名前を変える
    const renameBtn = $("spRenameBtn");
    if (renameBtn) renameBtn.addEventListener("click", async () => {
      const st = $("spRenameSt");
      const 新名 = ($("spRename") && $("spRename").value.trim()) || "";
      if (!新名) { if (st) st.textContent = "名前を入れてください"; return; }
      if (st) st.textContent = "変えています…";
      try {
        const r = await fetch(`/api/calls/lists/${encodeURIComponent(listId)}/name`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: 新名 }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "変えられませんでした");
        listName = d.name || 新名;
        const title = document.querySelector(".kc-mem-title");
        if (title) title.textContent = `${listName}（${rows.length}件）から絞り込む`;
        const spN = $("spName"); if (spN) spN.value = `${listName}（絞り込み）`;
        if (st) st.textContent = "変えました";
        setTimeout(() => { if (st) st.textContent = ""; }, 5000);
        loadLists();
      } catch (e) { if (st) st.textContent = "失敗：" + e.message; }
    });

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
        say(`「${j.name}」を作りました（${j["件数"]}件${j["重複除外"] ? `／重複を${j["重複除外"]}件外した` : ""}${j["所有者変更"] ? `／所有者を${j["所有者変更"]}件を中澤さんに変更` : ""}）${j["所有者メモ"] ? `　※${j["所有者メモ"]}` : ""}`);
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
  // 「コール結果1：結果 / コール結果1：コメント」…の列を拾う。番号が大きいほど新しい履歴。
  const callCols = [];
  if (見出しっぽい) {
    head.forEach((h, idx) => {
      const m = String(h).match(/コール結果\s*(\d+)\s*[：:]\s*(結果|コメント)/);
      if (!m) return;
      const n = parseInt(m[1], 10);
      let e = callCols.find((x) => x.n === n);
      if (!e) { e = { n, r: -1, c: -1 }; callCols.push(e); }
      if (m[2] === "結果") e.r = idx; else e.c = idx;
    });
    callCols.sort((a, b) => b.n - a.n);   // 大きい番号（新しい）を上にする
  }
  // 「最終活動コメント」列より後ろで、見出しが空の列は「続きのコメント欄」とみなし、
  // すべて最終活動コメントにまとめる（コール結果のように見出しのある列は対象外）。
  const commentTail = [];
  if (見出しっぽい && 場所.comment >= 0) {
    for (let idx = 場所.comment + 1; idx < head.length; idx++) {
      if (String(head[idx] || "").trim() === "") commentTail.push(idx);
    }
  }
  const 取る = (c, i) => (i >= 0 && i < c.length ? c[i] : "");
  // 最終活動コメント＋その後ろの続き欄を、1つのコメントにまとめる
  const コメントまとめ = (c) => {
    const parts = [];
    const 主 = 取る(c, 場所.comment).trim();
    if (主) parts.push(主);
    for (const idx of commentTail) { const v = 取る(c, idx).trim(); if (v) parts.push(v); }
    return parts.join("\n");
  };
  // その行のコール結果1〜Nを、新しい順にまとめた1つの文字列にする
  const まとめる = (c) => {
    const parts = [];
    for (const cc of callCols) {
      const 結 = 取る(c, cc.r).trim();
      const コ = 取る(c, cc.c).trim();
      if (!結 && !コ) continue;
      parts.push(結 ? (コ ? `${結}\n　${コ}` : 結) : `　${コ}`);
    }
    return parts.join("\n");
  };

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
      comment: コメントまとめ(c),   // 最終活動コメント＋その後ろの続き欄をまとめたもの
      history: まとめる(c),         // 「コール結果1〜N」形式のときの、新しい順のまとめ
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
  const 合計 = { 件数: 0, 見つかった: 0, 新しく作った: 0, とばした: 0, 履歴: 0, 重複除外: 0, 所有者変更: 0, 履歴済み: 0, 作れなかった: 0, 探せなかった: 0, 履歴失敗: 0 };
  const 失敗理由 = new Set();
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
          ...(($("csvListOnly") && $("csvListOnly").checked) ? { listOnly: true } : {}),
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
      合計.履歴済み = (合計.履歴済み || 0) + Number(d["履歴済み"] || 0);
      合計.重複除外 += Number(d["重複除外"] || 0);
      合計.所有者変更 += Number(d["所有者変更"] || 0);
      合計.クロス商談あり = (合計.クロス商談あり || 0) + Number(d["クロス商談あり"] || 0);
      合計.作れなかった += Number(d["作れなかった"] || 0);
      合計.探せなかった += Number(d["探せなかった"] || 0);
      合計.履歴失敗 += Number(d["履歴失敗"] || 0);
      for (const rr of (d["失敗理由"] || [])) if (rr) 失敗理由.add(rr);
      for (const x of (d["明細"] || [])) meisai.push(x);

      // 途中経過も出しておく
      if (out) {
        out.innerHTML = '<table class="sh-table"><tr><th>会社名</th><th>担当者</th><th>現所有者</th><th>リード</th><th>架電日</th><th>最終ステータス</th><th>コメント（G列）</th><th>まとめ（H列以降・新しい順）</th><th>状態</th></tr>' +
          meisai.slice(0, 300).map((x) => `<tr${x["クロス商談"] || String(x["状態"] || "").includes("クロス商談あり") ? ' style="background:#f2f8f5"' : ""}><td>${esc(x.company || "")}</td><td>${esc(x.person || "")}</td>` +
            `<td>${esc(x["所有者"] || "")}</td>` +
            `<td>${esc(x["リード種別"] || "-")}</td>` +
            `<td>${esc(x["架電日"] || "")}</td>` +
            `<td>${esc(x["ステータス"] || "-")}</td>` +
            `<td class="kc-cmt">${esc(x["コメント"] || "")}</td>` +
            `<td class="kc-cmt">${x["まとめ"] ? esc(x["まとめ"]).replace(/\n/g, "<br>") : '<span class="note">（なし）</span>'}</td>` +
            `<td>${esc(x["状態"] || "")}${x["履歴"] ? `／${esc(x["履歴"])}` : ""}${x["まとめ履歴"] ? `／${esc(x["まとめ履歴"])}` : ""}${x["理由"] ? `（${esc(x["理由"])}）` : ""}</td></tr>`).join("") + "</table>";
      }
    }

    if (dryRun) {
      const listOnly = $("csvListOnly") && $("csvListOnly").checked;
      say(listOnly
        ? `試算おわり：${rows.length}件（そのままリストに追加。とばす ${合計.とばした}）`
        : `試算おわり：${rows.length}件（見つかった ${合計.見つかった}／新しく作る ${合計.新しく作った}／とばす ${合計.とばした}${合計.クロス商談あり ? `／クロス商談あり ${合計.クロス商談あり}（クロスリード作らない）` : ""}）`);
    } else {
      const listOnly = $("csvListOnly") && $("csvListOnly").checked;
      say(listOnly
        ? `「${listName}」を作りました：${合計.件数}件（SFは更新していません` +
          (合計.重複除外 ? `／重複を${合計.重複除外}件外した` : "") + "）" +
          (csvShareSelected().length ? `　${csvShareSelected().length}人に分けました` : "")
        : `「${listName}」を作りました：${合計.件数}件` +
          `（見つかった ${合計.見つかった}／新しく作った ${合計.新しく作った}／とばした ${合計.とばした}` +
          (合計.履歴 ? `／履歴 ${合計.履歴}件` : "") +
          (合計.履歴済み ? `／既にあり ${合計.履歴済み}件は残さず` : "") +
          (合計.重複除外 ? `／重複を${合計.重複除外}件外した` : "") +
          (合計.所有者変更 ? `／所有者を${合計.所有者変更}件を中澤さんに変更` : "") + "）" +
          ((合計.作れなかった || 合計.探せなかった || 合計.履歴失敗)
            ? `　失敗：${合計.作れなかった + 合計.探せなかった + 合計.履歴失敗}件（作れず ${合計.作れなかった}／探せず ${合計.探せなかった}／履歴失敗 ${合計.履歴失敗}）`
              + ([...失敗理由].length ? `　例：${[...失敗理由].slice(0, 3).join(" ／ ")}` : "")
            : "") +
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
// 分析する期間。はじめは「今日」を見る。
function 今日JST() {
  const j = new Date(Date.now() + 9 * 3600 * 1000);
  return j.toISOString().slice(0, 10);
}
let anDays = 0;
let anFrom = 今日JST(), anTo = 今日JST();
async function loadAnalysis() {
  const box = $("clStats");
  if (!box) return;
  box.innerHTML = '<div class="note">読み込んでいます…</div>';
  try {
    const q = (anFrom && anTo)
      ? `from=${encodeURIComponent(anFrom)}&to=${encodeURIComponent(anTo)}`
      : `days=${encodeURIComponent(anDays)}`;
    const d = await (await fetch("/api/calls/analysis?" + q)).json();
    if (d.error) throw new Error(d.error);
    const rg = $("stRange");
    if (rg) rg.textContent = `${d.from} 〜 ${d.to}（直近${d["日数"]}日）`;
    const items = d.items || [];
    const t = d["チーム"] || {};

    // 期間の選択とチーム全体は、記録が無くても必ず出す。
    // （ここが出ないと期間を変えられず、直近1日から動かせなくなる）
    const rangeHtml =
      `<div class="an-range">
         <span class="kc-share-lb">期間</span>
         ${[[7, "直近7日"], [14, "直近14日"], [30, "直近30日"], [60, "直近60日"], [90, "直近90日"], [180, "直近半年"]]
           .map(([n, lb]) => `<button type="button" class="kc-share-b an-days${(!anFrom && anDays === n) ? " on" : ""}" data-days="${n}">${lb}</button>`).join("")}
         <span class="an-sep">または</span>
         <input type="date" id="anFrom" value="${esc(anFrom || d.from || "")}" />
         <span>〜</span>
         <input type="date" id="anTo" value="${esc(anTo || d.to || "")}" />
         <button type="button" class="kc-share-b${anFrom ? " on" : ""}" id="anApply">この期間で見る</button>
       </div>`;
    const teamHtml = `<div class="an-team">チーム全体：コール ${t["コール"] || 0}／接触 ${t["接触"] || 0}（${t["接触率"] || 0}%）／アポ ${t["アポ"] || 0}（${t["アポ率"] || 0}%）</div>`;

    if (!items.length) {
      box.innerHTML = rangeHtml + teamHtml + '<div class="note">この期間の記録はまだありません。期間を変えてみてください。</div>';
      return;
    }

    const 差 = (a, b) => {
      const v = +(a - b).toFixed(1);
      if (!v) return '<span class="an-eq">±0</span>';
      return `<span class="${v > 0 ? "an-up" : "an-down"}">${v > 0 ? "+" : ""}${v}</span>`;
    };
    const 棒 = (n, max) => `<span class="an-bar"><i style="width:${max ? Math.round(n / max * 100) : 0}%"></i></span>`;

    // 1人（またはインサイド全体）の分析カードを作る。showDiff=false のときは差の表示を出さない。
    const anCard = (x, showDiff = true, all = false) => {
      const 時最大 = Math.max(1, ...x["時間帯"].map((h) => h["コール"]));
      return `
        <div class="an-card${all ? " an-card-all" : ""}">
          <div class="an-h">${esc(x["誰"])}</div>

          <div class="an-kpi">
            <div class="an-k"><div class="an-kn">${x["コール"]}</div><div class="an-kl">コール</div></div>
            <div class="an-k"><div class="an-kn">${x["接触率"]}%</div><div class="an-kl">接触率${showDiff ? " " + 差(x["接触率"], t["接触率"] || 0) : ""}</div></div>
            <div class="an-k"><div class="an-kn">${x["アポ率"]}%</div><div class="an-kl">アポ率${showDiff ? " " + 差(x["アポ率"], t["アポ率"] || 0) : ""}</div></div>
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
    };

    box.innerHTML =
      rangeHtml + teamHtml +
      `<div class="an-card">
         <div class="an-h">コメントから、断られ方を調べる</div>
         <p class="note">記録に書かれたコメントをAIが読んで、断られ方・進まない理由をまとめます。</p>
         <div class="ap-cfg-row">
           <label>だれの <select id="anWho"><option value="">全員</option>${
             items.map((x) => `<option value="${esc(x["メール"] || "")}">${esc(x["誰"])}</option>`).join("")}</select></label>
           <button class="btn" id="anRun">コメントを読ませる</button>
           <span class="rev-status" id="anSt"></span>
         </div>
         <div id="anOut"></div>
         <div class="an-clear">
           <button type="button" class="kc-share-clear" id="anSfList">Salesforceに書いた記録を見る</button>
           <button type="button" class="kc-share-clear" id="anClear">kinbotの記録を全部消す</button>
           <span class="rev-status" id="anClearSt"></span>
         </div>
         <div id="anSfOut"></div>
       </div>` +
      (d["全体"] ? anCard(d["全体"], false, true) : "") +
      items.map((x) => anCard(x, true)).join("");
  } catch (e) { box.innerHTML = `<div class="note">読み込めませんでした：${esc(e.message)}</div>`; }
}

// コメントをAIに読ませて、断られ方をまとめる
async function runMemoAnalysis() {
  const say = (m) => { const e = $("anSt"); if (e) e.textContent = m || ""; };
  const out = $("anOut");
  const btn = $("anRun");
  if (btn) btn.disabled = true;
  say("コメントを読んでいます…（少し時間がかかります）");
  if (out) out.innerHTML = "";
  try {
    const r = await fetch("/api/calls/memo-analysis", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(anFrom && anTo ? { from: anFrom, to: anTo } : { days: anDays }),
        caller: ($("anWho") && $("anWho").value) || "",
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "読めませんでした");
    if (!d["件数"]) { say("この期間にコメントの記録がありません"); return; }
    say(`${d["件数"]}件のうち ${d["読んだ数"]}件を読みました`);
    const 最大 = Math.max(1, ...(d["分類"] || []).map((x) => x["件数"]));
    if (out) out.innerHTML =
      `<table class="sh-table an-tb">` +
      (d["分類"] || []).map((x) =>
        `<tr><td>${esc(x["名前"])}</td><td class="an-n">${x["件数"]}</td>` +
        `<td><span class="an-bar"><i style="width:${Math.round(x["件数"] / 最大 * 100)}%"></i></span></td>` +
        `<td class="an-ex">${(x["例"] || []).map((v) => esc(v)).join("／")}</td></tr>`).join("") +
      `</table>` +
      ((d["打ち手"] || []).length
        ? `<div class="an-t">打ち手の案</div><ul class="an-ul">${
            d["打ち手"].map((v) => `<li>${esc(v)}</li>`).join("")}</ul>`
        : "");
  } catch (e) { say("失敗：" + e.message); }
  finally { if (btn) btn.disabled = false; }
}
document.addEventListener("click", (ev) => {
  const t = ev.target && ev.target.closest ? ev.target.closest("#anRun") : null;
  if (t) { ev.preventDefault(); runMemoAnalysis(); }
  const dbtn = ev.target && ev.target.closest ? ev.target.closest(".an-days") : null;
  if (dbtn) { ev.preventDefault(); anDays = Number(dbtn.dataset.days) || 30; anFrom = ""; anTo = ""; loadAnalysis(); }
  const sfb = ev.target && ev.target.closest ? ev.target.closest("#anSfList") : null;
  if (sfb) {
    ev.preventDefault();
    const say = (m) => { const e = $("anClearSt"); if (e) e.textContent = m || ""; };
    const out = $("anSfOut");
    say("調べています…");
    const q = (anFrom && anTo) ? `from=${encodeURIComponent(anFrom)}&to=${encodeURIComponent(anTo)}` : "";
    fetch("/api/calls/sf-written?" + q).then((r) => r.json().then((d) => {
      if (!r.ok) throw new Error(d.error || "調べられませんでした");
      say(`${d.from} 〜 ${d.to}：${d["件数"]}件がSalesforceに書かれています`);
      if (!out) return;
      out.innerHTML = d["件数"]
        ? `<div class="an-t">人ごと</div><table class="sh-table an-tb">${
             d["人ごと"].map((x) => `<tr><td>${esc(x["誰"])}</td><td class="an-n">${x["件数"]}件</td></tr>`).join("")}</table>` +
          `<div class="an-t">中身（最新500件まで）</div><div class="kc-tablewrap" style="max-height:40vh">` +
          `<table class="sh-table an-tb"><tr><th>日時</th><th>誰</th><th>会社</th><th>結果</th><th>メモ</th></tr>` +
          d.items.map((x) => `<tr><td>${esc(x["日時"])}</td><td>${esc(x["誰"])}</td><td>${esc(x["会社"])}</td>` +
            `<td>${esc(x["結果"])}</td><td class="an-ex">${esc(x["メモ"])}</td></tr>`).join("") +
          `</table></div><p class="note">ここは見るだけです。Salesforceの記録は消していません。</p>`
        : `<p class="note">この期間に、kinbotからSalesforceへ書いた記録はありません。</p>`;
    })).catch((e) => say("失敗：" + e.message));
    return;
  }
  const cl = ev.target && ev.target.closest ? ev.target.closest("#anClear") : null;
  if (cl) {
    ev.preventDefault();
    const say = (m) => { const e = $("anClearSt"); if (e) e.textContent = m || ""; };
    if (!confirm("架電記録を全部消します。実績も分析も0になり、元には戻せません。よろしいですか？")) return;
    const w = prompt("本当に消す場合は「消します」と入れてください");
    if (w !== "消します") { say("やめました"); return; }
    say("消しています…");
    fetch("/api/calls/clear-logs", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: w }),
    }).then((r) => r.json().then((d) => {
      if (!r.ok) throw new Error(d.error || "消せませんでした");
      say(`${d["消した件数"]}件を消しました`);
      loadAnalysis();
    })).catch((e) => say("失敗：" + e.message));
    return;
  }
  const ap = ev.target && ev.target.closest ? ev.target.closest("#anApply") : null;
  if (ap) {
    ev.preventDefault();
    const f = ($("anFrom") && $("anFrom").value) || "", t = ($("anTo") && $("anTo").value) || "";
    if (!f || !t) { const e = $("anSt"); if (e) e.textContent = "日付を両方えらんでください"; return; }
    anFrom = f; anTo = t; loadAnalysis();
  }
});


// ───────────────────────────────────────────────────────────
// kincall の使い方ツアー
// kinbotロボが、選ぶ場所まで案内して、その場で説明する。
// 初めて開いた人には自動で出し、あとは右上の「使い方」からいつでも見られる。
// ───────────────────────────────────────────────────────────
(function kcTutorial() {
  const SEEN_KEY = "kctut_seen_v2";

  // まだリストが割り振られていない人には、案内を変える。
  function hasAnyList() {
    const sel = document.getElementById("clList");
    return !!sel && Array.from(sel.options).some((o) => o.value);
  }
  function canMakeList() {
    // 「リスト作成」タブがある人＝自分で作れる（kincallだけの人には無い）
    return !!document.querySelector('.kc-ptab[data-ls="make"]');
  }

  // 案内する順番を、そのときの状況に合わせて組み立てる。
  // sel＝光らせる場所、p＝どの画面か、ls＝リスト管理の中のどのタブか。
  function buildSteps() {
    const hasList = hasAnyList();
    const canMake = canMakeList();
    const s = [];
    s.push({ p: "call", sel: null,
      title: "kincallへようこそ",
      body: "リストの用意から、電話の記録、実績まで。使う場所を順番に案内します。" });
    s.push({ p: "call", sel: '.kc-side .side-item[href="/kincall"]',
      title: "かける",
      body: "ふだんはここ。リストを選んで電話をかけ、結果をその場で記録します。" });

    if (hasList) {
      s.push({ p: "call", sel: "#clList",
        title: "リストを選ぶ",
        body: "まず、かけるリストをここで選びます。人ごと・目的ごとに切り替えられます。" });
      s.push({ p: "call", sel: "#clFind",
        title: "すばやく探す",
        body: "会社名・担当者・電話番号で絞り込めます。かけ先が多いときに便利です。" });
      s.push({ p: "call", sel: "#clTable",
        title: "記録する",
        body: "選んだリストがここに並びます。行を押すと、その相手の履歴を見て、結果を残せます。" });
    } else {
      // 初めての人はまだリストが無い。どうやって用意するかを案内する。
      s.push({ p: "call", sel: "#clList",
        title: "まだリストがありません",
        body: canMake
          ? "はじめは、かけるリストが空です。次に出てくる「リスト管理」→「リスト作成」で用意します。作るとここに出て、選べるようになります。"
          : "はじめは、かけるリストが空です。担当者があなたにリストを分けると、ここに出て、選べるようになります。それまでは待っていて大丈夫です。" });
    }

    s.push({ p: "stats", sel: "#stPeriod",
      title: "実績を見る",
      body: "日ごと・週ごと・月ごとに、メンバーの実績を並べて比べられます。「メンバー別の分析」では、断られ方や時間帯まで見られます。" });
    s.push({ p: "lists", sel: "#lsTabs", ls: "manage",
      title: "リスト管理",
      body: hasList
        ? "メンバーを選ぶと、その人のリストを扱えます。カードを押すと「かける」に移ります。"
        : "ここでリストを用意します。メンバーを選ぶと、その人のリストを扱えます。" });

    if (canMake) {
      s.push({ p: "lists", sel: "#mkTabs", ls: "make",
        title: "リストを作る",
        body: "Salesforceのレポートからか、CSVから、架電リストを作れます。ここで作ると「かける」で選べるようになります。" });
      s.push({ p: "lists", sel: "#srShare", ls: "make",
        title: "みんなで分ける",
        body: "「分ける人」を選ぶと、選んだメンバーに均等に配れます。選ばなければ、作った人のリストになります。" });
    }

    s.push({ p: "call", sel: null,
      title: "これで準備OK",
      body: hasList
        ? "迷ったら、右上の「使い方」からいつでもこの案内を開けます。"
        : (canMake
            ? "まずは「リスト管理」→「リスト作成」でリストを用意しましょう。迷ったら、右上の「使い方」からもう一度見られます。"
            : "リストが分けられると「かける」に出ます。迷ったら、右上の「使い方」からもう一度見られます。") });
    return s;
  }

  // 見た目（この画面だけに効くように、ここで入れる）
  if (!document.getElementById("kctut-style")) {
    const st = document.createElement("style");
    st.id = "kctut-style";
    st.textContent = `
      #kctut{position:fixed;inset:0;z-index:9998;display:none;}
      #kctut.on{display:block;}
      #kctut-hole{position:absolute;border-radius:12px;pointer-events:none;
        box-shadow:0 0 0 9999px rgba(15,40,32,.55);outline:2px solid #5DCAA5;
        transition:top .18s ease,left .18s ease,width .18s ease,height .18s ease;}
      #kctut-pop{position:absolute;max-width:340px;width:calc(100vw - 32px);
        background:#fff;border:1px solid #cdeee0;border-radius:16px;
        box-shadow:0 14px 40px rgba(13,91,71,.28);padding:14px 16px 12px;
        pointer-events:auto;box-sizing:border-box;}
      #kctut-pop .kctut-top{display:flex;gap:11px;align-items:flex-start;}
      #kctut-pop .kctut-ava{flex:none;width:52px;height:52px;border-radius:50%;
        background:#eaf7f2;border:1px solid #cdeee0;padding:4px;box-sizing:border-box;}
      #kctut-pop .kctut-ava img{width:100%;height:100%;display:block;}
      #kctut-pop .kctut-ttl{font-size:14px;font-weight:700;color:#0d5b47;margin:2px 0 4px;}
      #kctut-pop .kctut-body{font-size:12.5px;line-height:1.6;color:#2a4f43;}
      #kctut-pop .kctut-foot{display:flex;align-items:center;gap:8px;margin-top:12px;}
      #kctut-pop .kctut-step{font-size:11px;color:#7aa093;margin-right:auto;}
      #kctut-pop .kctut-btn{font:inherit;font-size:12.5px;border-radius:9px;padding:6px 13px;
        cursor:pointer;border:1px solid #1d9e75;background:#1d9e75;color:#fff;font-weight:700;}
      #kctut-pop .kctut-btn.ghost{background:#fff;color:#0d5b47;border-color:#bfe6d7;font-weight:600;}
      #kctut-pop .kctut-btn:disabled{opacity:.45;cursor:default;}
      #kctut-pop .kctut-tail{position:absolute;width:14px;height:14px;background:#fff;
        border:1px solid #cdeee0;transform:rotate(45deg);display:none;}
      #kctut-pop.tail-up .kctut-tail{display:block;top:-8px;border-right:0;border-bottom:0;}
      #kctut-pop.tail-down .kctut-tail{display:block;bottom:-8px;border-left:0;border-top:0;}
      #kctut-pop .kctut-x{position:absolute;top:8px;right:9px;width:24px;height:24px;border:0;
        background:none;cursor:pointer;color:#7aa093;font-size:18px;line-height:1;border-radius:6px;}
      #kctut-pop .kctut-x:hover{background:#eef7f3;color:#0d5b47;}
      #kctut-menu{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
        width:calc(100vw - 32px);max-width:360px;background:#fff;border:1px solid #cdeee0;
        border-radius:16px;box-shadow:0 14px 40px rgba(13,91,71,.28);padding:16px;
        box-sizing:border-box;pointer-events:auto;max-height:82vh;overflow:auto;}
      #kctut-menu .kctut-mh{display:flex;align-items:flex-start;gap:11px;margin-bottom:12px;}
      #kctut-menu .kctut-ava{flex:none;width:46px;height:46px;border-radius:50%;background:#eaf7f2;
        border:1px solid #cdeee0;padding:4px;box-sizing:border-box;}
      #kctut-menu .kctut-ava img{width:100%;height:100%;display:block;}
      #kctut-menu .kctut-mt{font-size:14px;font-weight:700;color:#0d5b47;margin:2px 0 3px;}
      #kctut-menu .kctut-ms{font-size:12px;color:#5c7f72;line-height:1.5;}
      #kctut-menu .kctut-mlist{display:flex;flex-direction:column;gap:7px;}
      #kctut-menu .kctut-mi{display:block;width:100%;text-align:left;font:inherit;font-size:13px;
        color:#20463a;background:#f4fbf8;border:1px solid #d6efe2;
        border-radius:10px;padding:10px 13px;cursor:pointer;font-weight:600;}
      #kctut-menu .kctut-mi:hover{background:#e6f5ee;border-color:#9fe1cb;}
      #kctut-menu .kctut-mi-all{background:#1d9e75;color:#fff;border-color:#1d9e75;}
      #kctut-menu .kctut-mi-all:hover{background:#178a66;}
      #kctut-menu .kctut-mfoot{margin-top:12px;text-align:right;}
      #kctut-menu .kctut-mclose{font:inherit;font-size:12.5px;color:#0d5b47;background:#fff;
        border:1px solid #bfe6d7;border-radius:9px;padding:6px 14px;cursor:pointer;font-weight:600;}
      .kctut-help{display:inline-flex;align-items:center;gap:6px;margin-left:auto;
        font:inherit;font-size:12.5px;color:#0d5b47;background:#eaf7f2;border:1px solid #bfe6d7;
        border-radius:999px;padding:5px 12px;cursor:pointer;font-weight:600;}
      .kctut-help:hover{background:#dcf1e8;}
      .kctut-help svg{width:15px;height:15px;fill:none;stroke:#1d9e75;stroke-width:2;}
    `;
    document.head.appendChild(st);
  }

  // 右上に「使い方」ボタンを置く
  (function addHelp() {
    const bar = document.querySelector(".topbar");
    if (!bar || bar.querySelector(".kctut-help")) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "kctut-help";
    b.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/>' +
      '<path d="M9.5 9a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8" stroke-linecap="round"/>' +
      '<circle cx="12" cy="16.5" r="1" fill="#1d9e75" stroke="none"/></svg>使い方';
    b.addEventListener("click", () => openMenu());
    bar.appendChild(b);
  })();

  // 土台
  const root = document.createElement("div");
  root.id = "kctut";
  root.innerHTML =
    '<div id="kctut-hole"></div>' +
    '<div id="kctut-pop">' +
      '<span class="kctut-tail"></span>' +
      '<button type="button" class="kctut-x" data-act="skip" aria-label="とじる">×</button>' +
      '<div class="kctut-top">' +
        '<div class="kctut-ava"><img src="/kinbot-avatar-talk.svg" alt="kinbot" /></div>' +
        '<div><div class="kctut-ttl"></div><div class="kctut-body"></div></div>' +
      '</div>' +
      '<div class="kctut-foot">' +
        '<span class="kctut-step"></span>' +
        '<button type="button" class="kctut-btn ghost" data-act="menu">一覧</button>' +
        '<button type="button" class="kctut-btn ghost" data-act="back">戻る</button>' +
        '<button type="button" class="kctut-btn" data-act="next">次へ</button>' +
      '</div>' +
    '</div>' +
    '<div id="kctut-menu" hidden>' +
      '<div class="kctut-mh">' +
        '<div class="kctut-ava"><img src="/kinbot-avatar-talk.svg" alt="kinbot" /></div>' +
        '<div><div class="kctut-mt">kincallの使い方</div>' +
        '<div class="kctut-ms">見たい項目を選んでください。</div></div>' +
      '</div>' +
      '<div class="kctut-mlist"></div>' +
      '<div class="kctut-mfoot"><button type="button" class="kctut-mclose">とじる</button></div>' +
    '</div>';
  document.body.appendChild(root);

  const hole = root.querySelector("#kctut-hole");
  const pop = root.querySelector("#kctut-pop");
  const menuCard = root.querySelector("#kctut-menu");
  const menuList = menuCard.querySelector(".kctut-mlist");
  const elTtl = pop.querySelector(".kctut-ttl");
  const elBody = pop.querySelector(".kctut-body");
  const elStep = pop.querySelector(".kctut-step");
  const btnBack = pop.querySelector('[data-act="back"]');
  const btnNext = pop.querySelector('[data-act="next"]');
  const tail = pop.querySelector(".kctut-tail");

  let idx = 0;
  let visible = [];   // 実際に見せる手順（無い場所は除く）

  function switchTo(step) {
    // 画面（かける／実績／リスト管理）を切り替える
    try {
      const url = step.p === "call" ? "/kincall" : `/kincall?p=${step.p}`;
      history.replaceState(null, "", url);
    } catch {}
    if (typeof showPane === "function") showPane();
    // リスト管理の中のタブ
    if (step.ls) {
      const tab = document.querySelector(`.kc-ptab[data-ls="${step.ls}"]`);
      if (tab && !tab.classList.contains("active")) tab.click();
    }
  }

  function place(step) {
    const target = step.sel ? document.querySelector(step.sel) : null;
    if (target) {
      try { target.scrollIntoView({ block: "center", inline: "nearest" }); } catch {}
    }
    requestAnimationFrame(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      let rect = null;
      if (target) {
        const r = target.getBoundingClientRect();
        if (r.width || r.height) rect = r;
      }
      if (rect) {
        const pad = 6;
        hole.style.display = "block";
        hole.style.left = Math.max(2, rect.left - pad) + "px";
        hole.style.top = Math.max(2, rect.top - pad) + "px";
        hole.style.width = Math.min(vw - 4, rect.width + pad * 2) + "px";
        hole.style.height = rect.height + pad * 2 + "px";
      } else {
        hole.style.display = "none";
      }
      // ふきだしの位置
      const pw = pop.offsetWidth, ph = pop.offsetHeight, gap = 16;
      pop.classList.remove("tail-up", "tail-down");
      if (rect) {
        let top;
        if (rect.bottom + gap + ph <= vh) { top = rect.bottom + gap; pop.classList.add("tail-up"); }
        else if (rect.top - gap - ph >= 0) { top = rect.top - gap - ph; pop.classList.add("tail-down"); }
        else { top = Math.max(10, Math.min(vh - ph - 10, rect.top)); }
        let left = rect.left + rect.width / 2 - pw / 2;
        left = Math.max(12, Math.min(left, vw - pw - 12));
        pop.style.top = top + "px";
        pop.style.left = left + "px";
        const center = Math.max(left + 16, Math.min(rect.left + rect.width / 2, left + pw - 16));
        tail.style.left = center - left - 7 + "px";
      } else {
        pop.style.top = vh / 2 - ph / 2 + "px";
        pop.style.left = Math.max(12, vw / 2 - pw / 2) + "px";
      }
    });
  }

  function render() {
    const step = visible[idx];
    if (!step) return finish();
    switchTo(step);
    elTtl.textContent = step.title;
    elBody.textContent = step.body;
    elStep.textContent = `${idx + 1} / ${visible.length}`;
    btnBack.disabled = idx === 0;
    btnNext.textContent = idx === visible.length - 1 ? "おわり" : "次へ";
    // 画面の切り替え・読み込みが終わってから位置を測る
    setTimeout(() => place(step), 60);
  }

  function buildVisible() {
    // そのときの状況（リストの有無・作れるか）に合わせて組み立てる
    visible = buildSteps();
  }

  function start(from) {
    buildVisible();
    if (!visible.length) return;
    idx = Math.max(0, Math.min(from || 0, visible.length - 1));
    menuCard.hidden = true;
    pop.style.display = "";
    root.classList.add("on");
    render();
  }

  // 2回目以降は、見たい項目を選べるように一覧を出す
  function openMenu() {
    buildVisible();
    if (!visible.length) return;
    menuList.innerHTML = "";
    const add = (label, cls, on) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "kctut-mi" + (cls ? " " + cls : "");
      b.textContent = label;
      b.addEventListener("click", on);
      menuList.appendChild(b);
    };
    add("最初から通して見る", "kctut-mi-all", () => start(0));
    // 導入・まとめ以外を、項目として並べる
    visible.forEach((s, i) => {
      if (i === 0 || i === visible.length - 1) return;
      add(s.title, "", () => start(i));
    });
    pop.style.display = "none";
    hole.style.display = "none";
    menuCard.hidden = false;
    root.classList.add("on");
  }

  function finish() {
    root.classList.remove("on");
    menuCard.hidden = true;
    pop.style.display = "";
    try { localStorage.setItem(SEEN_KEY, "1"); } catch {}
    // かける画面に戻しておく
    try { history.replaceState(null, "", "/kincall"); } catch {}
    if (typeof showPane === "function") showPane();
  }

  pop.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "skip") return finish();
    if (act === "menu") return openMenu();
    if (act === "back") { if (idx > 0) { idx--; render(); } return; }
    if (act === "next") { if (idx < visible.length - 1) { idx++; render(); } else finish(); }
  });
  menuCard.querySelector(".kctut-mclose").addEventListener("click", finish);

  // 画面の大きさが変わったら、位置を測り直す
  let rz;
  window.addEventListener("resize", () => {
    if (!root.classList.contains("on") || !menuCard.hidden) return;
    clearTimeout(rz);
    rz = setTimeout(() => place(visible[idx]), 120);
  });
  document.addEventListener("keydown", (ev) => {
    if (!root.classList.contains("on")) return;
    if (ev.key === "Escape") return finish();
    if (!menuCard.hidden) return;   // 一覧を出しているときは矢印で動かさない
    if (ev.key === "ArrowRight") { if (idx < visible.length - 1) { idx++; render(); } }
    else if (ev.key === "ArrowLeft") { if (idx > 0) { idx--; render(); } }
  });

  // 初めての人には自動で出す
  let seen = "1";
  try { seen = localStorage.getItem(SEEN_KEY); } catch {}
  if (!seen) setTimeout(() => start(0), 900);
})();
