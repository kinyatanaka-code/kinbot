// calls.js — kincall（架電ツール）
//
// リストを表で見て、そこから電話をかけ、結果を記録します。
// 「履歴」を押すと過去のやり取り、「記録」を押すと結果を入れる窓が開きます。
// 記録した内容は、Salesforceの活動履歴としても残ります。
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let listId = 0;
// 選んでいたリストを覚えておき、画面を切り替えてもリロードしても同じリストに戻す
function savedListId() {
  try { return localStorage.getItem("kincall_list") || ""; } catch { return ""; }
}
function rememberListId(v) {
  try { if (v || v === 0) localStorage.setItem("kincall_list", String(v)); } catch {}
}
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
    const keep = sel.value || savedListId();   // リロード時は、前回選んでいたリストに戻す
    const allOpt = `<option value="all">☆ 全てのリード（自分の全リストをまとめて）</option>`;
    const specialOpt = `<option value="archive">🗄 アーカイブ（まとめ）</option><option value="recycle">♻ リサイクル（まとめ）</option>`;
    sel.innerHTML = allOpt + (items.length
      ? items.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")
      : "") + specialOpt;
    if (keep && (["all", "archive", "recycle"].includes(keep) || items.some((x) => String(x.id) === keep))) sel.value = keep;
    {
      const v = sel.value;
      listId = ["all", "archive", "recycle"].includes(v) ? v : (Number(v) || 0);
      rememberListId(v);
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
  // ドロップダウンの現在値を優先（「全てのリード」= all を確実に扱う）
  const selV = ($("clList") && $("clList").value) || "";
  if (selV) listId = ["all", "archive", "recycle"].includes(selV) ? selV : (Number(selV) || 0);
  if (!listId) { box.innerHTML = '<div class="empty-state">リストを選んでください。</div>'; return; }
  if (listId === "all" || listId === "archive" || listId === "recycle") selectedIds.clear();
  box.innerHTML = '<div class="empty-state">読み込んでいます…</div>';
  try {
    const q = $("clFind") && $("clFind").value.trim();
    const who = (callAsMember && listId !== "all") ? "&assignedTo=" + encodeURIComponent(callAsMember) : "";
    const d = await (await fetch(`/api/calls/targets?list=${encodeURIComponent(listId)}${q ? "&q=" + encodeURIComponent(q) : ""}${who}`)).json();
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
  if (filt.stage.size) list = list.filter((x) => filt.stage.has((x["ステージ"] || "").trim()));
  if (filt.status.size) list = list.filter((x) => filt.status.has((x["最終ステータス"] || "").trim()));
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
  // 並びの優先度：
  //  1) 架電予定の時刻が来たもの（次回予定 <= 今）を、いちばん上に（予定が早い順）
  //  2) まだかけていない未対応
  //  3) kincallでかけた（記録済み＝最終架電日時がある）ものは、下にまとめる（どこまでかけたか分かるように）
  //  4) アポ獲得済みは、いつも一番下
  const now = Date.now();
  const due = (x) => {
    const v = x["次回予定"]; if (!v) return 0;
    const t = new Date(v).getTime();
    return (!isNaN(t) && t <= now) ? t : 0;
  };
  const かけた = (x) => !!x["最終日時"];
  // 営業時間外は下に沈める（営業中・不明→営業時間外の順）。
  const closedRank = (x) => (bizState(x) === "closed" ? 1 : 0);
  // 済み（対象外）＝アポ獲得・ユーザー・失注。最下部にまとめる（アポ→ユーザー→失注の順）。
  const rank = (x) => isApoDone(x) ? 0 : isUser(x) ? 1 : 2;
  const 済 = list.filter(isDone).sort((a, b) => rank(a) - rank(b));
  const 未済 = list.filter((x) => !isDone(x));
  const 予定来た = 未済.filter((x) => due(x)).sort((a, b) => due(a) - due(b));
  const 残り = 未済.filter((x) => !due(x));
  const まだ = 残り.filter((x) => !かけた(x)).sort((a, b) => closedRank(a) - closedRank(b));
  const かけ済み = 残り.filter((x) => かけた(x))
    .sort((a, b) => closedRank(a) - closedRank(b) || new Date(a["最終日時"]).getTime() - new Date(b["最終日時"]).getTime());
  return [...予定来た, ...まだ, ...かけ済み, ...済];
}

// 最終ステータスの文字列
function 状況(x) { return String((x && x["最終ステータス"]) || ""); }
// ユーザー（クロス受注＝既存顧客）。かける対象から外す。
function isUser(x) { return /ユーザー/.test(状況(x)); }
// 直近失注（クロス失注）。かける対象から外す。
function isLost(x) { return /失注/.test(状況(x)); }
// アポ獲得済みかどうか（最終ステータスに「アポ獲得」が入っているか。ユーザーは除く）
function isApoDone(x) { return /アポ獲得/.test(状況(x)) && !isUser(x); }
// かける対象から外すもの（アポ獲得済み・ユーザー・失注）。まとめて下に沈める／隠せる。
// 使われていない番号（不通・現アナ・欠番）。かける対象から外して自動でフラグ化する。
function isDeadNumber(x) { return /使われて|使わない|現在使わ|現アナ|欠番|不通|【使われていない番号】/.test(状況(x)); }
function isDone(x) { return isApoDone(x) || isUser(x) || isLost(x) || isDeadNumber(x); }
// 行のバッジ（会社名の右）
function doneBadge(x) {
  if (isDeadNumber(x)) return ' <span class="kc-dead-badge">使われていない番号</span>';
  if (isUser(x)) return ' <span class="kc-user-badge">ユーザー</span>';
  if (isLost(x)) return ' <span class="kc-lost-badge">失注</span>';
  if (isApoDone(x)) return ' <span class="kc-apo-badge">アポ獲得済み</span>';
  return "";
}
// 営業中/営業時間外（Googleの営業時間から）。会社名の下に小さく出す。
function bizState(x) { return (x && x["営業"] && x["営業"]["状態"]) || ""; }
function bizBadge(x) {
  const st = bizState(x);
  const ai = (x && x["営業"] && x["営業"]["出典"]) === "ai";
  const tag = ai ? "<span class=\"kc-biz-ai\">AI</span>" : "";
  const desc = (x && x["営業"] && x["営業"]["説明"]) ? ` title="${esc(x["営業"]["説明"])}${ai ? "（AIがWeb検索で取得）" : ""}"` : (ai ? ' title="AIがWeb検索で取得"' : "");
  if (st === "open") return `<span class="kc-biz kc-biz-open"${desc}>営業中${tag}</span>`;
  if (st === "closed") return `<span class="kc-biz kc-biz-closed"${desc}>営業時間外${tag}</span>`;
  if (st === "unknown") return `<span class="kc-biz kc-biz-unknown">不明</span>`;   // 取得したが営業時間の掲載なし
  return "";   // 未取得は出さない
}

// 次回架電の予定時刻が来ているか（来ていれば表示用の文言）
function nextDueLabel(x) {
  const v = x && x["次回予定"]; if (!v) return "";
  const t = new Date(v).getTime(); if (isNaN(t)) return "";
  const d = new Date(v);
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return { due: t <= Date.now(), md, hhmm, iso: v };
}

// 絞り込みの窓を出す（チェックで選ぶ）
function openFilter(which, btn) {
  const key = which === "stage" ? "ステージ" : "最終ステータス";
  const values = [...new Set(rows.map((x) => (x[key] || "").trim()).filter((v) => v !== ""))].sort();
  const emptyN = rows.filter((x) => !(x[key] || "").trim()).length;
  // 空欄（-）も選べるように、末尾に「（空欄）」を足す。値は "" を使う。
  const options = emptyN ? [...values, ""] : values;
  const cur = filt[which];
  const inner =
    `<div class="kc-flt-list">` +
    options.map((v) => `<label class="kc-flt-row">
       <input type="checkbox" value="${esc(v)}"${cur.size === 0 || cur.has(v) ? " checked" : ""} />
       <span>${v === "" ? "（空欄・未入力）" : esc(v)}</span>
       <span class="kc-flt-n">${v === "" ? emptyN : rows.filter((x) => (x[key] || "").trim() === v).length}</span>
     </label>`).join("") + `</div>
     <div class="kc-modal-foot">
       <button type="button" class="btn" id="fltOk">この条件で見る</button>
       <button type="button" class="btn ghost" id="fltAll">すべて</button>
     </div>`;
  const m = openModal(`${key}でしぼる`, inner);
  m.el.querySelector("#fltOk").addEventListener("click", () => {
    const picked = [...m.el.querySelectorAll("input:checked")].map((c) => c.value);
    filt[which] = picked.length === options.length ? new Set() : new Set(picked);
    m.close(); render();
  });
  m.el.querySelector("#fltAll").addEventListener("click", () => {
    filt[which] = new Set(); m.close(); render();
  });
}

// ===== 追加カラム（読み込んだCSVの列を、そのまま一覧に出す）=====
// x.追加（CSV由来）や x.求人（会社名で紐づけた分）のキーを、そのまま列にする。
// 列の表示・並び順は「列を選ぶ」から自由に変えられる（この端末に保存）。
const RECRUIT_DATE_KEYS = new Set(["掲載終了日", "doda掲載終了日"]);   // 期限が近いと色を変える列
function rowExtra(x) {
  const a = (x && x.追加 && typeof x.追加 === "object") ? x.追加 : null;
  const b = (x && x.求人 && typeof x.求人 === "object") ? x.求人 : null;
  if (a && b) return { ...b, ...a };
  return a || b || null;
}
// リスト内に出てくる追加列の見出しを、出てきた順にすべて集める
function extraKeysOf(list) {
  const keys = [];
  const seen = new Set();
  for (const x of list) {
    const e = rowExtra(x);
    if (!e) continue;
    for (const k of Object.keys(e)) {
      const v = cleanRecruitVal(e[k]);
      if (!v) continue;
      if (!seen.has(k)) { seen.add(k); keys.push(k); }
    }
  }
  return keys;
}
// いま出す列（保存された表示・並びを反映。新しく増えた列は末尾に足す）
function extraCols(allKeys) {
  let cfg = null;
  try { cfg = JSON.parse(localStorage.getItem("kcExtraCols") || "null"); } catch {}
  const order = (cfg && Array.isArray(cfg.order)) ? cfg.order : [];
  const hidden = new Set((cfg && Array.isArray(cfg.hidden)) ? cfg.hidden : []);
  const ordered = [];
  for (const k of order) if (allKeys.includes(k)) ordered.push(k);
  for (const k of allKeys) if (!ordered.includes(k)) ordered.push(k);   // 新しい列は末尾へ
  return ordered.filter((k) => !hidden.has(k));
}
function saveExtraCols(order, hidden) {
  try { localStorage.setItem("kcExtraCols", JSON.stringify({ order, hidden })); } catch {}
}
// 掲載終了日などの「あと何日で切れるか」で色を返す。切れている/近い=赤、まもなく=橙。
function deadlineClass(v) {
  const d = parseDateLoose(v);
  if (!d) return "";
  const days = Math.floor((d.getTime() - Date.now()) / 86400000);
  if (days <= 3) return "kc-rc-red";
  if (days <= 14) return "kc-rc-amber";
  return "";
}
function parseDateLoose(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const m = s.match(/(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const t = Date.parse(s);
  return isNaN(t) ? null : new Date(t);
}
// 取り込み時に混ざる無効値（列が狭くて「####」表示になったもの、#N/A 等）は空扱いにする。
function cleanRecruitVal(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return "";
  if (/^#+$/.test(s)) return "";                       // ########（列が狭い表示）
  if (/^#(N\/A|REF!|VALUE!|DIV\/0!|NAME\?|NULL!)$/i.test(s)) return "";
  return s;
}

function render() {
  const box = $("clTable");
  const fullList = visibleRows();
  const list = hideApo ? fullList.filter((x) => !isDone(x)) : fullList;
  const arrow = (k) => sortBy === k ? (sortDesc ? " ▾" : " ▴") : "";
  const on = (k) => filt[k] && filt[k].size ? " on" : "";
  if (!fullList.length) {
    box.innerHTML = `<div class="empty-state">${rows.length ? "この条件に当てはまるものがありません。" : "リストを選んでください。"}</div>`;
    return;
  }
  const apoN = fullList.filter(isApoDone).length;
  const userN = fullList.filter(isUser).length;
  const lostN = fullList.filter(isLost).length;
  const doneN = apoN + userN + lostN;
  const 内訳 = [
    apoN ? `<span class="kc-sum-apo">アポ獲得済み <b>${apoN}</b></span>` : "",
    userN ? `<span class="kc-sum-user">ユーザー <b>${userN}</b></span>` : "",
    lostN ? `<span class="kc-sum-lost">失注 <b>${lostN}</b></span>` : "",
  ].filter(Boolean).join("／");
  // 読み込んだCSVの列（追加カラム）。データがある行があるリストだけ出す。
  const rcMatched = fullList.filter((x) => rowExtra(x)).length;
  const allKeys = extraKeysOf(fullList);
  const rcols = allKeys.length ? extraCols(allKeys) : [];
  const hasRecruit = rcols.length > 0;
  box.innerHTML =
    `<div class="kc-summary">かける先 <b>${fullList.length - doneN}</b> 件` +
    (doneN
      ? `／${内訳}` +
        `<button type="button" class="kc-sum-btn" id="kcHideApo">${hideApo ? "対象外も表示" : "対象外を隠す"}</button>`
      : "") +
    (allKeys.length ? `／<span class="kc-sum-user">列データ <b>${rcMatched}</b>件</span><button type="button" class="kc-sum-btn" id="kcRcCols">列を選ぶ</button>` : "") +
    `</div>` +
    ((listId !== "all")
      ? `<div class="kc-selbar" id="kcSelBar" hidden style="display:flex;align-items:center;gap:10px;padding:8px 4px;">
       <span id="kcSelCount" style="font-size:13px;color:#0d5b47;font-weight:600;"></span>
       <button type="button" class="btn" id="kcSelMove">選択したリードを他のリストへ移す</button>
       <button type="button" class="btn kc-outline" id="kcSelClear">選択を外す</button>
     </div>` : "") +
    `<div class="kc-tablewrap"><table class="kc-table${listId !== "all" ? " kc-has-check" : ""}">
      <tr>
        ${listId !== "all" ? `<th class="kc-th-c kc-fx-check" style="width:28px"><input type="checkbox" id="kcSelAll" title="全部を選ぶ" /></th>` : ""}
        <th class="kc-th-s kc-fx-stage"><button type="button" class="kc-th-b${on("stage")}" data-flt="stage">ステージ ▾</button></th>
        <th class="kc-co kc-fx-co"><button type="button" class="kc-th-b" data-sort="company">会社名${arrow("company")}</button></th>
        <th class="kc-th-p">担当者</th>
        <th class="kc-th-t">電話番号</th>
        <th class="kc-th-m">メールアドレス</th>
        <th class="kc-th-s"><button type="button" class="kc-th-b${on("status")}" data-flt="status">最終ステータス ▾</button></th>
        <th class="kc-th-h"><button type="button" class="kc-th-b${filt.hist ? " on" : ""}" data-hist="1">履歴${arrow("hist")}</button></th>
        <th class="kc-th-l">最終架電日</th>
        <th class="kc-th-r">記録</th>
        <th class="kc-th-e">編集</th>
        <th class="kc-th-d">資料送付</th>
        ${rcols.map((k) => `<th class="kc-th-rc" draggable="true" data-rck="${esc(k)}" title="ドラッグで並べ替え">${esc(k)}</th>`).join("")}
      </tr>` +
    list.map((x, i) => {
      const 済 = isDone(x);
      const 予定 = nextDueLabel(x);
      const かけた = (r) => !!(r && r["最終日時"]) && !isDone(r) && !(r["次回予定"] && new Date(r["次回予定"]).getTime() <= Date.now());
      const cols = (listId !== "all" ? 12 : 11) + rcols.length;
      const 直前未済 = i > 0 && !isDone(list[i - 1]);
      const 区切り = (済 && (i === 0 || 直前未済))
        ? `<tr class="kc-apo-sep"><td colspan="${cols}">ここから下は、かける対象外（アポ獲得・ユーザー・失注）（${list.filter(isDone).length}件）</td></tr>`
        : "";
      // かけた（記録済み）グループの先頭に、区切りを出す（どこまでかけたか分かるように）
      const かけ区切り = (かけた(x) && (i === 0 || !かけた(list[i - 1])))
        ? `<tr class="kc-apo-sep"><td colspan="${cols}">ここから下は、かけ済み（${list.filter(かけた).length}件）</td></tr>`
        : "";
      return 区切り + かけ区切り + `
      <tr data-id="${x.id}" class="${済 ? "kc-apo-done" : ""}">
        ${listId !== "all" ? `<td class="kc-fx-check"><input type="checkbox" class="kc-sel" data-id="${x.id}"${selectedIds.has(String(x.id)) ? " checked" : ""} /></td>` : ""}
        <td class="kc-stage kc-fx-stage">${esc(x["ステージ"] || "-")}</td>
        <td class="kc-co kc-fx-co">${esc(x["会社名"] || "")}${doneBadge(x)}${bizBadge(x)}${
          予定 ? ` <span class="kc-next-badge${予定.due ? " due" : ""}">${予定.due ? "架電予定 " : "予定 "}${esc(予定.md)} ${esc(予定.hhmm)}<button type="button" class="kc-next-x" data-id="${x.id}" title="この架電予定を消す">×</button></span>` : ""}</td>
        <td class="kc-person">${x["ふりがな"] ? `<span class="kc-kana">${esc(x["ふりがな"])}</span>` : ""}<span class="kc-pname">${esc(x["担当者"] || "")}</span></td>
        <td>${x["電話番号"]
          ? `<a class="kc-tel" href="tel:${esc(telOf(x["電話番号"]))}">${esc(x["電話番号"])}</a>`
          : `<span class="kc-none">なし</span>`}</td>
        <td class="kc-mail">${esc(x["メール"] || "")}</td>
        <td class="kc-status">${x["最終ステータス"] ? esc(x["最終ステータス"]) : "-"}</td>
        <td><button type="button" class="kc-btn kc-hist" data-id="${x.id}">${x["履歴数"] ? `${x["履歴数"]}件` : "なし"}</button></td>
        <td class="kc-lastcall">${esc(lastCallLabel(x["最終日時"]))}</td>
        <td><button type="button" class="kc-btn kc-rec" data-id="${x.id}">記録</button></td>
        <td><button type="button" class="kc-btn kc-edit" data-id="${x.id}">編集</button></td>
        <td><button type="button" class="kc-btn kc-doc" data-id="${x.id}">資料送付</button></td>
        ${rcols.map((k) => {
          const e = rowExtra(x);
          const v = cleanRecruitVal(e && e[k]);
          const cls = RECRUIT_DATE_KEYS.has(k) ? deadlineClass(v) : "";
          return `<td class="kc-rc${cls ? " " + cls : ""}">${v ? esc(v) : '<span class="kc-none">—</span>'}</td>`;
        }).join("")}
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
  // 架電予定タグの × ：その予定を消す
  box.querySelectorAll(".kc-next-x").forEach((b) =>
    b.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      const id = b.dataset.id;
      b.disabled = true;
      try {
        const r = await fetch(`/api/calls/targets/${encodeURIComponent(id)}/clear-next`, { method: "POST" });
        if (!r.ok) throw new Error();
        const row = rows.find((x) => String(x.id) === String(id));
        if (row) row["次回予定"] = null;   // 手元のデータからも消して、並びも直す
        render();
      } catch { b.disabled = false; }
    }));

  // 選択（チェック）の配線
  const updateSelBar = () => {
    const bar = $("kcSelBar"), cnt = $("kcSelCount");
    if (!bar) return;
    if (selectedIds.size) { bar.hidden = false; if (cnt) cnt.textContent = `${selectedIds.size}件を選択中`; }
    else bar.hidden = true;
    const all = $("kcSelAll");
    if (all) { const boxes = box.querySelectorAll(".kc-sel"); all.checked = boxes.length > 0 && [...boxes].every((c) => c.checked); }
  };
  box.querySelectorAll(".kc-sel").forEach((c) =>
    c.addEventListener("change", () => {
      if (c.checked) selectedIds.add(String(c.dataset.id)); else selectedIds.delete(String(c.dataset.id));
      updateSelBar();
    }));
  const selAll = $("kcSelAll");
  if (selAll) selAll.addEventListener("change", () => {
    box.querySelectorAll(".kc-sel").forEach((c) => {
      c.checked = selAll.checked;
      if (c.checked) selectedIds.add(String(c.dataset.id)); else selectedIds.delete(String(c.dataset.id));
    });
    updateSelBar();
  });
  const selMove = $("kcSelMove");
  if (selMove) selMove.addEventListener("click", () => openMoveTargets([...selectedIds]));
  const selClear = $("kcSelClear");
  if (selClear) selClear.addEventListener("click", () => { selectedIds.clear(); box.querySelectorAll(".kc-sel").forEach((c) => (c.checked = false)); updateSelBar(); });
  updateSelBar();
  const hideBtn = $("kcHideApo");
  if (hideBtn) hideBtn.addEventListener("click", () => { hideApo = !hideApo; render(); });

  // 追加列の見出しを、ドラッグでエクセルのように並べ替える
  let dragKey = null;
  box.querySelectorAll("th.kc-th-rc[draggable]").forEach((th) => {
    th.addEventListener("dragstart", (e) => {
      dragKey = th.dataset.rck;
      th.classList.add("kc-th-drag");
      try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragKey); } catch {}
    });
    th.addEventListener("dragend", () => { th.classList.remove("kc-th-drag"); box.querySelectorAll(".kc-th-over").forEach((el) => el.classList.remove("kc-th-over")); });
    th.addEventListener("dragover", (e) => { e.preventDefault(); try { e.dataTransfer.dropEffect = "move"; } catch {} th.classList.add("kc-th-over"); });
    th.addEventListener("dragleave", () => th.classList.remove("kc-th-over"));
    th.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = dragKey || (e.dataTransfer && e.dataTransfer.getData("text/plain"));
      const to = th.dataset.rck;
      th.classList.remove("kc-th-over");
      if (from && to && from !== to) moveExtraCol(from, to);
    });
  });

  const rcBtn = $("kcRcCols");
  if (rcBtn) rcBtn.addEventListener("click", () => {
    const allKeys = extraKeysOf(visibleRows());
    let cfg = null;
    try { cfg = JSON.parse(localStorage.getItem("kcExtraCols") || "null"); } catch {}
    const hidden = new Set((cfg && Array.isArray(cfg.hidden)) ? cfg.hidden : []);
    let order = (cfg && Array.isArray(cfg.order)) ? cfg.order.filter((k) => allKeys.includes(k)) : [];
    for (const k of allKeys) if (!order.includes(k)) order.push(k);
    const inner =
      `<p class="note" style="margin:0 0 8px">かける一覧に出す列を選べます（この端末に保存）。並び順は、一覧の見出しをドラッグして変えられます。</p>` +
      `<div style="max-height:50vh;overflow:auto">` +
      order.map((k) =>
        `<label class="ks-check" style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid #eef2f0">
           <input type="checkbox" class="kc-colshow" value="${esc(k)}"${hidden.has(k) ? "" : " checked"}/>
           <span style="flex:1;font-size:13px">${esc(k)}</span>
         </label>`).join("") +
      `</div>` +
      `<div class="modal-actions" style="margin-top:12px"><button type="button" class="btn" id="kcColSave">保存</button>` +
      `<button type="button" class="btn ghost" id="kcColReset">既定に戻す</button></div>`;
    const m = openModal("列を選ぶ", inner);
    m.el.querySelector("#kcColSave").addEventListener("click", () => {
      const boxes = [...m.el.querySelectorAll(".kc-colshow")];
      const hid = order.filter((k, i) => boxes[i] && !boxes[i].checked);
      saveExtraCols(order, hid); m.close(); render();
    });
    m.el.querySelector("#kcColReset").addEventListener("click", () => {
      try { localStorage.removeItem("kcExtraCols"); } catch {}
      m.close(); render();
    });
  });
}

// 追加列 from を、to の位置へ移動して保存・再描画する（保存された並び順を編集）
function moveExtraCol(from, to) {
  const allKeys = extraKeysOf(visibleRows());
  let cfg = null;
  try { cfg = JSON.parse(localStorage.getItem("kcExtraCols") || "null"); } catch {}
  const hidden = (cfg && Array.isArray(cfg.hidden)) ? cfg.hidden : [];
  let order = (cfg && Array.isArray(cfg.order)) ? cfg.order.filter((k) => allKeys.includes(k)) : [];
  for (const k of allKeys) if (!order.includes(k)) order.push(k);
  const fi = order.indexOf(from), ti = order.indexOf(to);
  if (fi < 0 || ti < 0) return;
  order.splice(fi, 1);
  order.splice(order.indexOf(to) + (fi < ti ? 1 : 0), 0, from);
  saveExtraCols(order, hidden);
  render();
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
    #asCards .kc-mem-special{background:#f4faf7;border-color:#cfe6db;}
    #asCards .kc-mem-special .kc-mem-name{font-weight:600;color:#0d5b47;}
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
    .kc-g-sec{font-size:13px;font-weight:800;color:#0d5b47;margin:14px 2px 6px;border-left:3px solid #1d9e75;padding-left:8px;}
    .kc-g-sub td{color:#7d8c86;font-size:11.5px;}
    /* 個別：メンバーごとのカード（幅が広いと2枚並ぶ） */
    .kc-cardgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(560px,1fr));gap:14px;margin-bottom:8px;}
    .kc-g-card{background:#fff;border:1px solid #e6ece9;border-radius:14px;box-shadow:0 2px 10px rgba(13,91,71,.06);padding:12px 14px;}
    .kc-g-card .kc-g-title{font-size:14px;font-weight:800;}
    .kc-g-card .kc-g-tsum{color:#7d8c86;font-weight:600;}
    .kc-g-card .kc-g-body{overflow-x:auto;}
    @media (max-width:640px){ .kc-cardgrid{grid-template-columns:1fr;} }
    /* 案A：セールス/インサイドの大カード。中に合計＋各メンバーの表を並べる */
    .kc-bigwrap{display:grid;grid-template-columns:repeat(auto-fit,minmax(600px,1fr));gap:16px;}
    .kc-bigcard{background:#fff;border:1px solid #dfeae5;border-radius:16px;box-shadow:0 3px 14px rgba(13,91,71,.07);padding:14px 16px;}
    .kc-bigcard-h{font-size:15px;font-weight:800;color:#0d5b47;border-left:4px solid #1d9e75;padding-left:10px;margin-bottom:10px;display:flex;align-items:center;gap:8px;}
    .kc-bigcard-c{font-size:12px;font-weight:600;color:#7d8c86;}
    .kc-bigcard-body{overflow-x:auto;}
    .kc-bigcard .kc-g-block{background:#fbfefd;}
    .kc-bigcard .kc-g-block.kc-mem{background:#fff;border-color:#eef3f0;}
    .kc-bigcard .kc-g-block.kc-g-team{background:#eaf5ef;border-color:#cfe6da;}
    @media (max-width:900px){ .kc-bigwrap{grid-template-columns:1fr;} }
    /* リスト別 */
    .kc-listgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:12px;}
    .kc-listcard{background:#fff;border:1px solid #e6ece9;border-radius:14px;box-shadow:0 2px 10px rgba(13,91,71,.06);padding:12px 14px;overflow-x:auto;}
    .kc-listcard-h{font-size:14px;font-weight:800;color:#0d5b47;margin-bottom:8px;display:flex;flex-direction:column;gap:2px;}
    .kc-listcard-sum{font-size:11.5px;font-weight:600;color:#7d8c86;}
    .fn-row{display:flex;gap:6px;align-items:stretch;overflow-x:auto;padding:2px 0;}
    .fn-step{flex:1 0 78px;background:#f6faf8;border-radius:10px;padding:8px 6px;text-align:center;position:relative;}
    .fn-step b{display:block;font-size:18px;font-weight:800;color:#20302b;}
    .fn-step span{display:block;font-size:10.5px;color:#7d8c86;}
    .fn-step i{display:block;font-size:10.5px;color:#1d9e75;font-style:normal;font-weight:700;min-height:14px;}
    .kc-fn-range{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px;font-size:12px;color:#5b7a6d;}
    .kc-fn-range input[type=date]{border:1px solid #d7ded9;border-radius:8px;padding:5px 8px;font-size:12px;}
    .apo-row td{background:#fbfefd;}
    .st-chip{display:inline-block;font-size:10.5px;font-weight:700;border-radius:6px;padding:2px 7px;}
    .st-chip.none{background:#f4f5f4;color:#9aa39d;}
    .st-chip.apo{background:#eef2ff;color:#5b6be0;}
    .st-chip.ok{background:#e6f7ef;color:#1d9e75;}
    .st-chip.kpi{background:#e3f2fd;color:#1976d2;}
    .st-chip.mid{background:#fff3e0;color:#e65100;}
    .st-chip.won{background:#0d5b47;color:#fff;}
    .kc-grp-box{margin-top:18px;padding-top:14px;border-top:1px solid #eef3f0;}
    .kc-grp-h{font-size:13px;font-weight:800;color:#0d5b47;margin-bottom:8px;}
    .kc-grp-list{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:6px;}
    .kc-grp-chip{display:inline-flex;align-items:center;gap:6px;background:#f2f8f5;border:1px solid #dfeae5;border-radius:999px;padding:5px 10px;font-size:12.5px;color:#0d5b47;}
    .kc-grp-chip i{font-style:normal;font-size:11px;color:#7d8c86;background:#fff;border-radius:999px;padding:1px 7px;}
    .kc-grp-chip button{border:0;background:transparent;cursor:pointer;color:#7d8c86;font-size:12px;padding:0 2px;}
    .kc-grp-chip button:hover{color:#0d5b47;}
    .kc-grp-detail{margin-top:6px;display:flex;flex-direction:column;gap:3px;}
    .kc-grp-line{font-size:11.5px;color:#5b7a6d;}
    .kc-grp-line b{color:#0d5b47;}
    .kc-grp-add{border:1px dashed #cfe0d8;background:#fff;color:#0d5b47;border-radius:999px;padding:5px 12px;font-size:12.5px;cursor:pointer;}
    .kc-list-grp{margin-top:6px;}
    .kc-list-chip.grp{background:#e6f7ef;color:#0d5b47;border-color:#cfe6da;font-weight:700;}
    .kc-list-chip.nogrp{background:#f4f5f4;color:#9aa39d;}
    .kc-list-grp select{width:100%;border:1px solid #e2eae6;border-radius:8px;padding:4px 6px;font-size:11.5px;color:#20302b;background:#fff;}
    @media (max-width:640px){ .kc-listgrid{grid-template-columns:1fr;} }
    /* 設定・管理タブ */
    .kc-admin{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
    .kc-adcard{background:#fff;border:1px solid #e6ece9;border-radius:14px;padding:14px 16px;box-shadow:0 2px 10px rgba(13,91,71,.05);}
    .kc-adcard h3{margin:0 0 6px;font-size:15px;color:#0d5b47;font-weight:800;}
    .kc-adrow{display:flex;gap:10px;align-items:center;font-size:13px;padding:5px 0;border-top:1px solid #f0f4f2;}
    .kc-adrow:first-of-type{border-top:0;}
    .kc-adk{flex:0 0 130px;color:#7d8c86;font-size:12px;}
    @media (max-width:900px){ .kc-admin{grid-template-columns:1fr;} }
    /* プロセス */
    .kc-proc{background:#fff;border:1px solid #e6ece9;border-radius:14px;padding:14px 16px;box-shadow:0 2px 10px rgba(13,91,71,.05);overflow-x:auto;}
    .kc-proc-head{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:10px;}
    .kc-proc-head input[type=month]{border:1px solid #d7ded9;border-radius:8px;padding:6px 8px;}
    .proc-week:hover{background:#f2f8f5;}
    .proc-caret{display:inline-block;width:12px;color:#1d9e75;}
    .proc-day td{background:#fbfefd;font-size:12px;}
    /* 実績タブの段組み：上段＝全体/個別＋アポ、下段＝日週月 */
    .kc-st-row{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin-bottom:6px;}
    .kc-st-row .kc-period-tabs{margin-bottom:0;}
    #stPeriod{margin-top:2px;}
    @media (max-width:640px){ .kc-st-row{gap:8px;} }
    /* ===== スマホ対応（kincall） ===== */
    @media (max-width:760px){
      /* 左サイドバーを下部バーに畳むとき、各項目が .side-wrap で包まれていて崩れるのを直す */
      .kc-side .side-wrap{ display:contents; }
      .kc-side .side-app-tag{ display:none; }
      .kc-side .side-app-ico{ width:19px; height:19px; }
      .kc-side-brand{ display:none; }
      .main{ min-width:0; }
      .topbar{ position:sticky; top:0; z-index:30; }
      .kc-brand .kc-sub{ display:none; }
      /* 広い表・グリッドは横スクロールにして見えるように */
      #clStats, .kc-tablewrap, .kc-two, .an-wrap{ overflow-x:auto; -webkit-overflow-scrolling:touch; }
      .kc-cardgrid, .kc-bigwrap, .kc-listgrid{ grid-template-columns:1fr; }
      .kc-bigcard, .kc-listcard, .kc-g-card{ overflow-x:auto; }
      /* タブ類は横スクロールで全部触れるように */
      .kc-period-tabs, .kc-st-row{ overflow-x:auto; -webkit-overflow-scrolling:touch; flex-wrap:nowrap; }
      .kc-ptab{ flex:0 0 auto; }
      /* 実績の日付列が詰まりすぎないように最小幅 */
      .kc-grid th, .kc-grid td{ white-space:nowrap; }
    }
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
    .kc-user-badge{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:10px;background:#0d5b47;color:#fff;font-size:11px;font-weight:700;vertical-align:middle;}
    .kc-lost-badge{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:10px;background:#e9edeb;color:#6b7a74;font-size:11px;font-weight:700;vertical-align:middle;}
    .kc-dead-badge{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:10px;background:#fbe7e6;color:#a32d2d;font-size:11px;font-weight:700;vertical-align:middle;}
    .kc-reason{margin:6px 0 2px;}
    .kc-reason-chips{display:flex;flex-wrap:wrap;gap:6px;}
    .kc-reason-chip{border:1px solid #cfe0d9;background:#fff;color:#1f2a26;border-radius:999px;padding:5px 12px;font-size:12px;cursor:pointer;transition:all .12s;}
    .kc-reason-chip:hover{background:#eef7f2;border-color:#5DCAA5;}
    .kc-sum-user{color:#0d5b47;}
    .kc-sum-lost{color:#8a9691;}
    .kc-summary{display:flex;align-items:center;gap:10px;padding:8px 4px;font-size:13px;color:#0d5b47;}
    .kc-summary b{font-size:15px;}
    .kc-sum-apo{color:#0b7a5e;}
    .kc-sum-btn{margin-left:4px;font-size:12px;padding:3px 10px;border:1px solid #1d9e75;border-radius:8px;background:#fff;color:#1d9e75;cursor:pointer;}
    .kc-sum-btn:hover{background:#eaf5ef;}
    .kc-append-bar{display:flex;align-items:center;gap:12px;background:#eaf6f0;border:1px solid #1d9e75;border-radius:10px;padding:10px 14px;margin-bottom:12px;color:#0d5b47;font-size:14px;}
    .kc-append-bar b{font-size:15px;}
    .kc-append-bar button{margin-left:auto;font-size:12px;padding:4px 12px;border:1px solid #cfe6db;border-radius:8px;background:#fff;color:#0d5b47;cursor:pointer;}
    .kc-append-bar button:hover{background:#f2f8f5;}
    .kc-plan-row{display:flex;align-items:center;gap:8px;margin:4px 0;}
    .kc-plan-row .kc-plan-name{min-width:120px;text-align:left;}
    .kc-plan-n{width:80px;border:1px solid #e6ece9;border-radius:8px;padding:5px 8px;font-size:13px;font-family:inherit;}
    .kc-plan-list{border:1px solid #e6ece9;border-radius:8px;padding:5px 8px;font-size:13px;font-family:inherit;max-width:240px;}
    .kc-plan-row:not(.on) .kc-plan-n,.kc-plan-row:not(.on) .kc-plan-list{opacity:.4;}
    .kc-plan-rest{font-size:12px;color:#0d5b47;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;}
    .kc-plan-row:not(.on) .kc-plan-rest{opacity:.4;}
    .kc-next-badge{display:inline-block;margin-left:6px;padding:1px 8px;border-radius:10px;background:#eef3f1;color:#5b7a6d;font-size:11px;font-weight:700;vertical-align:middle;}
    .kc-next-badge.due{background:#f0a020;color:#fff;}
    .kc-next-x{margin-left:5px;border:0;background:transparent;color:inherit;font-size:12px;font-weight:700;cursor:pointer;padding:0 1px;line-height:1;opacity:.75;}
    .kc-next-x:hover{opacity:1;}
    .kc-quick{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:2px 0 6px;}
    .kc-qchip{border:1px solid #cfe0d9;background:#fff;color:#1f2a26;border-radius:999px;padding:7px 15px;font-size:13px;cursor:pointer;transition:all .12s;}
    .kc-qchip:hover{border-color:#1d9e75;background:#f4faf7;}
    .kc-qchip.on{background:#1d9e75;border-color:#1d9e75;color:#fff;font-weight:600;}
    .kc-qclear{color:#a04040;border-color:#e6cccc;}
    .kc-next-fine{display:flex;flex-wrap:wrap;gap:14px;align-items:center;margin:8px 0 4px;}
    .kc-fine-lb{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:#5b7a6d;}
    .kc-fine-in{width:auto;flex:0 0 auto;}
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
        <div class="kc-reason" id="kcReason" hidden></div>

        <div class="kc-lb">説明（任意）</div>
        <textarea class="kc-input" id="kcMemo" rows="3" placeholder="担当者は佐藤様・14時以降が良いとのこと"></textarea>

        <div class="kc-lb">次回いつかける？（任意）</div>
        <div class="kc-quick" id="kcQuickDate">
          <button type="button" class="kc-qchip" data-qd="today">今日</button>
          <button type="button" class="kc-qchip" data-qd="tomorrow">明日</button>
          <button type="button" class="kc-qchip" data-qd="nextmon">週明け</button>
          <button type="button" class="kc-qchip" data-qd="nextmonth">来月</button>
          <button type="button" class="kc-qchip kc-qclear" data-qd="clear" style="display:none">消す</button>
        </div>
        <div class="kc-lb" id="kcQuickTimeLb" style="display:none">何時ごろ？</div>
        <div class="kc-quick" id="kcQuickTime" style="display:none">
          <button type="button" class="kc-qchip" data-qt="10:00">午前 10:00</button>
          <button type="button" class="kc-qchip" data-qt="13:00">昼 13:00</button>
          <button type="button" class="kc-qchip" data-qt="15:00">午後 15:00</button>
          <button type="button" class="kc-qchip" data-qt="17:00">夕方 17:00</button>
        </div>
        <div class="kc-next-fine">
          <label class="kc-fine-lb">日付 <input type="date" class="kc-input kc-fine-in" id="kcNext" /></label>
          <label class="kc-fine-lb">時間 <input type="time" class="kc-input kc-fine-in" id="kcNextTime" step="900" /></label>
        </div>
        <div class="note" id="kcNextSummary" style="margin-top:4px"></div>

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

  // 結果に応じて理由チップを出す。チップを押すとメモに追記される。
  const 断り理由 = ["予算・費用が合わない", "ニーズがない", "他社導入済み", "時期尚早・検討中", "決裁権がない", "資料だけ希望", "情報提供は不要", "一律お断り", "着信拒否・今後不要"];
  const 不在文言 = ["終日不在", "席を外している", "来客中", "打ち合わせ中", "戻り時間不明", "外出中", "電話中"];
  const 不通文言 = ["現在使われていない番号", "アナウンスが流れる", "欠番"];
  const memoEl = () => m.el.querySelector("#kcMemo");
  const appendMemo = (text) => {
    const el = memoEl(); if (!el) return;
    const cur = String(el.value || "").trim();
    if (cur.split(/[、,\n]/).map((s) => s.trim()).includes(text)) return;   // 同じものは足さない
    el.value = cur ? `${cur}、${text}` : text;
  };
  const reasonBox = m.el.querySelector("#kcReason");
  const drawReason = () => {
    if (!reasonBox) return;
    const v = picked();
    let title = "", chips = [];
    if (/お断り|断り/.test(v)) { title = "断り理由（押すとメモに追加）"; chips = 断り理由; }
    else if (/不在/.test(v)) { title = "不在の状況（押すとメモに追加）"; chips = 不在文言; }
    else if (/使わ|現アナ|アナ|欠番|不通/.test(v)) { title = "番号の状態（押すとメモに追加）"; chips = 不通文言; }
    if (!chips.length) { reasonBox.hidden = true; reasonBox.innerHTML = ""; return; }
    reasonBox.hidden = false;
    reasonBox.innerHTML = `<div class="kc-lb">${esc(title)}</div><div class="kc-reason-chips">` +
      chips.map((c) => `<button type="button" class="kc-reason-chip">${esc(c)}</button>`).join("") + `</div>`;
    reasonBox.querySelectorAll(".kc-reason-chip").forEach((b) =>
      b.addEventListener("click", () => appendMemo(b.textContent)));
    // 使われていない番号は、メモに自動でフラグを付ける
    if (/使わ|現アナ|欠番|不通/.test(v)) appendMemo("【使われていない番号】");
  };
  const resultSel = m.el.querySelector("#kcResult");
  if (resultSel) resultSel.addEventListener("change", drawReason);
  drawReason();

  wireQuickNext(m);

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
          // 次回の架電時間（HH:MM）。kincallで予定日時として持ち、時刻が来たら上に出す。
          nextTime: (m.el.querySelector("#kcNextTime") || {}).value || "",
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
      if (d.sf && d.sf.nextCallAt) x["次回予定"] = d.sf.nextCallAt;
      updateRow(x);
      // アポ獲得、または次回予定を入れたときは、一覧を描き直して並びを整える
      if (isApoDone(x) || (d.sf && d.sf.nextCallAt)) render();
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
// 最終架電日を「M/D」で短く表示する（無ければ空）
function lastCallLabel(v) {
  if (!v) return "";
  const t = new Date(v);
  if (isNaN(t.getTime())) return "";
  return `${t.getMonth() + 1}/${t.getDate()}`;
}

function updateRow(x) {
  const tr = document.querySelector(`.kc-table tr[data-id="${x.id}"]`);
  if (!tr) return;
  const stage = tr.querySelector(".kc-stage"); if (stage) stage.textContent = x["ステージ"] || "-";
  const status = tr.querySelector(".kc-status"); if (status) status.textContent = x["最終ステータス"] || "-";
  const hist = tr.querySelector(".kc-hist"); if (hist) hist.textContent = x["履歴数"] ? `${x["履歴数"]}件` : "なし";
  const last = tr.querySelector(".kc-lastcall"); if (last) last.textContent = lastCallLabel(x["最終日時"]);
  // 記録したことが分かるよう、少し光らせる
  tr.classList.add("kc-just");
  setTimeout(() => tr.classList.remove("kc-just"), 1600);
}

// 会社名・担当者・電話・メールの表示セルを書き換える（編集の反映用）
function updateRowContact(x) {
  const tr = document.querySelector(`.kc-table tr[data-id="${x.id}"]`);
  if (!tr) return;
  const co = tr.querySelector(".kc-co");
  if (co) {
    // 会社名セルはバッジ（アポ獲得済み・予定）も含むので、先頭のテキストだけ書き換える
    if (co.firstChild && co.firstChild.nodeType === 3) co.firstChild.textContent = x["会社名"] || "";
    else co.insertBefore(document.createTextNode(x["会社名"] || ""), co.firstChild);
    const person = co.nextElementSibling;              // 担当者
    if (person) person.innerHTML = (x["ふりがな"] ? `<span class="kc-kana">${esc(x["ふりがな"])}</span>` : "") + `<span class="kc-pname">${esc(x["担当者"] || "")}</span>`;
    const tel = person && person.nextElementSibling;   // 電話番号
    if (tel) tel.innerHTML = x["電話番号"]
      ? `<a class="kc-tel" href="tel:${esc(telOf(x["電話番号"]))}">${esc(x["電話番号"])}</a>`
      : `<span class="kc-none">なし</span>`;
  }
  const mail = tr.querySelector(".kc-mail"); if (mail) mail.textContent = x["メール"] || "";
  tr.classList.add("kc-just");
  setTimeout(() => tr.classList.remove("kc-just"), 1600);
}

// 「次回いつかける？」のクイック入力（今日・明日・週明け・来月＋時間ボタン）を動かす
function quickNextDate(kind) {
  const d = new Date(Date.now() + 9 * 3600 * 1000);   // 日本時間の「今」
  const y = d.getUTCFullYear(), mo = d.getUTCMonth(), day = d.getUTCDate(), dow = d.getUTCDay();
  let t;
  if (kind === "today") t = new Date(Date.UTC(y, mo, day));
  else if (kind === "tomorrow") t = new Date(Date.UTC(y, mo, day + 1));
  else if (kind === "nextmon") { const add = ((8 - dow) % 7) || 7; t = new Date(Date.UTC(y, mo, day + add)); }
  else if (kind === "nextmonth") t = new Date(Date.UTC(y, mo + 1, 1));
  else return "";
  return t.toISOString().slice(0, 10);
}
function fmtNextSummary(dateStr, timeStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00Z");
  if (isNaN(d.getTime())) return "";
  const 曜 = ["日", "月", "火", "水", "木", "金", "土"][d.getUTCDay()];
  const md = `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${曜}）`;
  const hm = /^\d{1,2}:\d{2}$/.test(timeStr || "") ? (timeStr.length === 4 ? "0" + timeStr : timeStr) : "";
  return hm ? `${md} ${hm} になったら、かける画面で上に出ます` : `${md}（時間を入れると、その時刻に上に出ます）`;
}
function wireQuickNext(m) {
  const dateInput = m.el.querySelector("#kcNext");
  const timeInput = m.el.querySelector("#kcNextTime");
  const timeLb = m.el.querySelector("#kcQuickTimeLb");
  const timeBox = m.el.querySelector("#kcQuickTime");
  const summary = m.el.querySelector("#kcNextSummary");
  const clearBtn = m.el.querySelector('#kcQuickDate [data-qd="clear"]');
  if (!dateInput) return;
  const dateBox = m.el.querySelector("#kcQuickDate");

  const refresh = () => {
    if (summary) summary.textContent = fmtNextSummary(dateInput.value, timeInput ? timeInput.value : "");
    const on = !!dateInput.value;
    if (timeLb) timeLb.style.display = on ? "" : "none";
    if (timeBox) timeBox.style.display = on ? "" : "none";
    if (clearBtn) clearBtn.style.display = on ? "" : "none";
  };
  const light = (box, el) => box && box.querySelectorAll(".kc-qchip").forEach((b) => b.classList.toggle("on", b === el));

  dateBox.querySelectorAll("[data-qd]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.qd;
    if (k === "clear") { dateInput.value = ""; if (timeInput) timeInput.value = ""; light(dateBox, null); light(timeBox, null); refresh(); return; }
    dateInput.value = quickNextDate(k);
    light(dateBox, b);
    refresh();
  }));
  dateInput.addEventListener("change", () => { light(dateBox, null); refresh(); });

  m.el.querySelectorAll('#kcQuickTime [data-qt]').forEach((b) => b.addEventListener("click", () => {
    if (timeInput) timeInput.value = b.dataset.qt;
    light(timeBox, b);
    refresh();
  }));
  if (timeInput) timeInput.addEventListener("change", () => { light(timeBox, null); refresh(); });
  refresh();
}


async function openDocSettings() {
  const m = openModal("資料送付設定", `
    <div class="kc-doc-set">
      <div class="note" id="kcDsLoad">読み込んでいます…</div>
      <div id="kcDsForm" style="display:none">
        <div class="kc-lb">既定の資料（トラッキングで送るもの）</div>
        <select class="kc-input" id="kcDsDoc"></select>
        <div class="kc-lb">メールの件名（テンプレ）</div>
        <input type="text" class="kc-input" id="kcDsSub" />
        <div class="kc-lb">メールの本文（テンプレ）</div>
        <textarea class="kc-input" id="kcDsBody" rows="10"></textarea>
        <div class="note">差し込みできる目印：{担当者}／{会社名}／{差出人}／{資料名}／{URL}（資料のトラッキングURL）</div>
        <div class="kc-modal-foot">
          <button type="button" class="btn" id="kcDsSave">保存する</button>
          <span class="rev-status" id="kcDsSt"></span>
        </div>
      </div>
    </div>`, { wide: true });

  try {
    const d = await (await fetch("/api/calls/doc-settings")).json();
    if (!d.ok) throw new Error(d.error || "読み込めませんでした");
    m.el.querySelector("#kcDsLoad").style.display = "none";
    m.el.querySelector("#kcDsForm").style.display = "";
    m.el.querySelector("#kcDsDoc").innerHTML =
      `<option value="">いちばん新しい資料を使う</option>` +
      (d.docs || []).map((x) => `<option value="${x.id}"${String(d.defaultDocId) === String(x.id) ? " selected" : ""}>${esc(x.name)}</option>`).join("");
    m.el.querySelector("#kcDsSub").value = d.subject || "";
    m.el.querySelector("#kcDsBody").value = d.body || "";
  } catch (e) { m.el.querySelector("#kcDsLoad").textContent = "読み込めませんでした：" + e.message; return; }

  m.el.querySelector("#kcDsSave").addEventListener("click", async () => {
    const st = m.el.querySelector("#kcDsSt");
    st.textContent = "保存しています…";
    try {
      const r = await fetch("/api/calls/doc-settings", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject: m.el.querySelector("#kcDsSub").value,
          body: m.el.querySelector("#kcDsBody").value,
          defaultDocId: m.el.querySelector("#kcDsDoc").value,
        }),
      });
      const dd = await r.json();
      if (!r.ok) throw new Error(dd.error || "保存できませんでした");
      st.textContent = "保存しました";
      setTimeout(() => m.close(), 900);
    } catch (e) { st.textContent = "失敗：" + e.message; }
  });
}

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
      <div class="kc-lb">ふりがな</div>
      <input type="text" class="kc-input" id="edKana" value="${esc(x["ふりがな"] || "")}" placeholder="たとえば：たなか きんや" />
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
      kana:    m.el.querySelector("#edKana").value,
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
      x["ふりがな"] = (d.項目 && d.項目["ふりがな"]) ?? body.kana;
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

// ───────── ダッシュボード（アポの目標・実績・差分／月次のみ） ─────────
let _dashData = null;
async function loadDash() {
  const box = $("clDash");
  if (!box) return;
  box.innerHTML = `<div class="note">読み込んでいます…</div>`;
  try {
    const d = await (await fetch(`/api/calls/apo-dashboard`)).json();
    if (d.error) throw new Error(d.error);
    _dashData = d;
    const rg = $("dashRange"); if (rg) rg.textContent = d.periodLabel ? `対象：${d.periodLabel}（月次）` : "";
    renderDash(d);
  } catch (e) { box.innerHTML = `<div class="note">読み込めませんでした：${esc(e.message)}</div>`; }
}
function dashCard(c, big) {
  const diff = c.diff;
  const dcls = diff > 0 ? "kc-d-plus" : diff < 0 ? "kc-d-minus" : "kc-d-zero";
  const dtxt = diff > 0 ? `+${diff}` : `${diff}`;
  // ダッシュボードでは、チームも個人も目標を直接（月次）変更できる。
  const editable = iAmRedistributor;
  const goalCell = editable
    ? `<input type="number" class="kc-goal kc-dgoal" data-subj="${esc(c.key)}" value="${c.goal}" min="0" />`
    : `<div class="kc-d-act">${c.goal}</div>`;
  return `<div class="kc-dcard${big ? " kc-dcard-big" : ""}" data-subj="${esc(c.key)}" data-label="${esc(c.label)}">
    <div class="kc-dname">${esc(c.label)}</div>
    <div class="kc-drow">
      <div class="kc-dcol"><div class="kc-dlb">目標</div>${goalCell}</div>
      <div class="kc-dcol"><div class="kc-dlb">実績</div><div class="kc-d-act">${c.actual}</div></div>
      <div class="kc-dcol"><div class="kc-dlb">差分</div><div class="kc-d-diff ${dcls}">${dtxt}</div></div>
    </div>
  </div>`;
}
function renderDash(d) {
  const box = $("clDash");
  const teams = (d.teams || []).map((c) => dashCard(c, true)).join("");
  const sales = (d.sales || []).map((c) => dashCard(c, false)).join("");
  const inside = (d.inside || []).map((c) => dashCard(c, false)).join("");
  box.innerHTML =
    `<div class="kc-dgrid kc-dteams">${teams}</div>` +
    (sales ? `<div class="kc-dsub">セールス</div><div class="kc-dgrid">${sales}</div>` : "") +
    (inside ? `<div class="kc-dsub">インサイド</div><div class="kc-dgrid">${inside}</div>` : "") +
    `<p class="note" style="margin-top:10px">目標はここで直接（月次）変更できます（入力するとその月の平日に配分されます）。グループ・セールス・インサイドも手動で設定でき、実績はメンバーの合計です。差分は 実績−目標。カードをクリックすると内訳（日次）が出ます。</p>`;
  // 目標の直接編集（月次→平日に配分）。入力欄クリックはカードの内訳を開かないように。
  box.querySelectorAll(".kc-dgoal").forEach((inp) => {
    inp.addEventListener("click", (e) => e.stopPropagation());
    inp.addEventListener("change", async (e) => {
      e.stopPropagation();
      const subject = inp.dataset.subj;
      const card = inp.closest(".kc-dcard");
      const actual = Number((card.querySelector(".kc-dcol:nth-child(2) .kc-d-act") || {}).textContent || 0);
      const goal = Number(inp.value) || 0;
      // 差分をその場で更新
      const de = card.querySelector(".kc-d-diff");
      if (de) { const df = actual - goal; de.textContent = df > 0 ? `+${df}` : `${df}`; de.className = "kc-d-diff " + (df > 0 ? "kc-d-plus" : df < 0 ? "kc-d-minus" : "kc-d-zero"); }
      try {
        await fetch("/api/calls/apo-goals", {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ subject, period: "month", periodKey: d.periodKey, metric: "アポ", value: goal }),
        });
        if (typeof _statsGoals === "object") for (const k in _statsGoals) delete _statsGoals[k];
      } catch (err) { inp.style.borderColor = "#e24b4a"; }
    });
  });
  box.querySelectorAll(".kc-dcard").forEach((card) => card.addEventListener("click", () =>
    openDashDetail(card.dataset.subj, card.dataset.label)));
}
async function openDashDetail(subject, label) {
  const isTeam = subject === "group" || subject === "sales" || subject === "inside";
  const inner =
    `<div class="kc-period-tabs" id="ddPeriod" style="margin-bottom:8px">
       <button type="button" class="kc-ptab active" data-dp="day">日次</button>
       <button type="button" class="kc-ptab" data-dp="week">週次</button>
       <button type="button" class="kc-ptab" data-dp="month">月次</button>
     </div><div id="ddBody"><div class="note">読み込んでいます…</div></div>`;
  const m = openModal(`${label} ・ 内訳`, inner, { wide: true });
  let p = "day";   // 最初は日次
  const SALES_NAMES = ["田中欽也"], EXCLUDE_NAMES = ["中澤", "浦林", "森田", "笹原", "迫間"];
  const nameHas = (n, ts) => ts.some((t) => String(n || "").includes(t));
  const load = async () => {
    const body = m.el.querySelector("#ddBody");
    body.innerHTML = `<div class="note">読み込んでいます…</div>`;
    try {
      const d = await (await fetch(`/api/calls/stats-grid?period=${encodeURIComponent(p)}`)).json();
      if (d.error) throw new Error(d.error);
      const cols = d.区切り || [];
      const members = d.members || [];
      // 対象の実績（バケットごとのコール/接触/アポ）
      let vals = null;
      if (isTeam) { vals = (d.totals || {})[subject]; }
      else { const mm = members.find((x) => String(x.email || x.誰).toLowerCase() === subject); vals = mm && mm.値; }
      const memberEmails = [subject];   // 目標は本人／チーム自身の目標（subject）で見る
      // 目標は「その期間・そのキー」で取る（配分・合計はしない）
      let subjGoals = {};
      if (cols.length) {
        try {
          const keys = cols.map((c) => c.key).join(",");
          const g = await (await fetch(`/api/calls/apo-goals-cells?period=${encodeURIComponent(p)}&keys=${encodeURIComponent(keys)}`)).json();
          subjGoals = (g.goals && g.goals[subject]) || {};
        } catch {}
      }
      body.innerHTML = vals
        ? ddTable(cols, vals, d.今, subject, isTeam, subjGoals, p)
        : `<div class="note">この対象のデータがありません。</div>`;
      bindGoalInputs(body, subject, load);
    } catch (e) { body.innerHTML = `<div class="note">読み込めませんでした：${esc(e.message)}</div>`; }
  };
  m.el.querySelectorAll("#ddPeriod .kc-ptab").forEach((b) => b.addEventListener("click", () => {
    p = b.dataset.dp; m.el.querySelectorAll("#ddPeriod .kc-ptab").forEach((x) => x.classList.toggle("active", x === b)); load();
  }));
  load();
}
function ddTable(cols, vals, now, subject, isTeam, subjGoals, period) {
  const V = vals.map((v) => ({ コール: v.コール || 0, 接触: v.接触 || 0, アポ: (v.アポ内 || 0) + (v.アポ外 || 0) }));
  const nowCls = (c) => (c.key === now ? " kc-g-now" : "");
  const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + "%" : "—");
  const editable = !isTeam && iAmRedistributor;   // 個人は各期間で編集可。チームはダッシュボードで。
  const g1 = (c, metric) => Number((subjGoals[c.key] || {})[metric] || 0);
  const G = cols.map((c) => ({ コール: g1(c, "コール"), 接触: g1(c, "接触"), アポ: g1(c, "アポ") }));
  const h1 = `<tr><th class="kc-g-name" rowspan="2">　</th>${cols.map((c) => `<th class="kc-g-h${nowCls(c)}" colspan="2">${esc(c["名前"])}${c["曜日"] ? `<span class="kc-g-w">${esc(c["曜日"])}</span>` : ""}</th>`).join("")}</tr>`;
  const h2 = `<tr>${cols.map((c) => `<th class="kc-g-h kc-g-sub${nowCls(c)}">目標</th><th class="kc-g-h kc-g-sub${nowCls(c)}">実績</th>`).join("")}</tr>`;
  const cntRow = (lb, k) => `<tr><td class="kc-g-name">${lb}</td>${cols.map((c, i) => {
    const g = G[i][k];
    const goalCell = editable
      ? `<td class="kc-g-n${nowCls(c)}"><input type="number" class="kc-goal kc-goal-cell" data-subj="${esc(subject)}" data-period="${esc(period)}" data-date="${esc(c.key)}" data-metric="${lb}" value="${g}" min="0"/></td>`
      : `<td class="kc-g-n${nowCls(c)}">${g}</td>`;
    return goalCell + `<td class="kc-g-n${nowCls(c)}">${V[i][k]}</td>`;
  }).join("")}</tr>`;
  const rateRow = (lb, an, bn) => `<tr class="kc-g-rate"><td class="kc-g-name">${lb}</td>${cols.map((c, i) => {
    const gr = pct(G[i][an], G[i][bn]);
    const ar = pct(V[i][an], V[i][bn]);
    return `<td class="kc-g-n${nowCls(c)}">${gr}</td><td class="kc-g-n${nowCls(c)}">${ar}</td>`;
  }).join("")}</tr>`;
  const table = `<table class="sh-table kc-grid kc-grid-gr">${h1}${h2}
    ${cntRow("コール", "コール")}${cntRow("接触", "接触")}${cntRow("アポ", "アポ")}
    ${rateRow("コール→接触率", "接触", "コール")}${rateRow("接触→アポ率", "アポ", "接触")}${rateRow("コール→アポ率", "アポ", "コール")}</table>`;
  return `<div class="kc-tablewrap">${table}</div>` +
    (isTeam ? `<p class="note" style="margin-top:6px">実績はメンバーの合計です。目標はダッシュボードで設定します。</p>` : "");
}
// 目標入力欄（日次）の保存を配線（項目つき・入力ごとに再読み込みしない）
function bindGoalInputs(scope, subject, reload) {
  scope.querySelectorAll(".kc-goal-cell").forEach((inp) => {
    inp.addEventListener("change", async () => {
      try {
        await fetch("/api/calls/apo-goals", {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ subject: inp.dataset.subj, period: inp.dataset.period, periodKey: inp.dataset.date, metric: inp.dataset.metric || "アポ", value: Number(inp.value) || 0 }),
        });
        if (typeof _statsGoals === "object") for (const k in _statsGoals) delete _statsGoals[k];
        if (typeof loadDash === "function") loadDash();
      } catch (e) { inp.style.borderColor = "#e24b4a"; }
    });
  });
}

// ───────── 実績（日・週・月） ─────────
let statsPeriod = "day";
let statsScope = "all";   // all=全体（グループ/セールス/インサイド）, each=個別（案A：セールス/インサイドの大カード）
const _statsCache = {};   // period -> data（切替を速くするためキャッシュ）
const _statsGoals = {};   // period -> { subject: { date: goal } }（日次目標）

// データ取得（ネットワーク）。キャッシュがあれば使い、無ければ取りに行く。
async function fetchStats(force) {
  if (!force && _statsCache[statsPeriod]) return _statsCache[statsPeriod];
  const d = await (await fetch(`/api/calls/stats-grid?period=${encodeURIComponent(statsPeriod)}`)).json();
  if (d.error) throw new Error(d.error);
  _statsCache[statsPeriod] = d;
  return d;
}

async function loadStats(force) {
  const box = $("clStats");
  if (!box) return;
  if (statsPeriod === "analysis") return loadAnalysis();
  if (statsPeriod === "list") return loadListStats();
  try {
    if (force || !_statsCache[statsPeriod]) box.innerHTML = `<div class="note">読み込んでいます…</div>`;
    const d = await fetchStats(force);
    // 目標を「その期間・そのキー」で取得（配分・合計はしない）
    try {
      const cols = d["区切り"] || [];
      if (cols.length && (force || !_statsGoals[statsPeriod])) {
        const keys = cols.map((c) => c.key).join(",");
        const g = await (await fetch(`/api/calls/apo-goals-cells?period=${encodeURIComponent(statsPeriod)}&keys=${encodeURIComponent(keys)}`)).json();
        _statsGoals[statsPeriod] = g.goals || {};
      }
    } catch {}
    renderStats(d);
  } catch (e) { box.innerHTML = `<div class="note">読み込めませんでした：${esc(e.message)}</div>`; }
}

// 描画（ネットワークなし＝全体/個別の切替はここだけで即反映）
function renderStats(d) {
  const box = $("clStats");
  if (!box) return;
  const 区切り = d["区切り"] || [];
  const members = d.members || [];
  const totals = d.totals || { group: [], sales: [], inside: [] };
  const 今 = d["今"] || "";
  const goals = _statsGoals[statsPeriod] || {};   // 日次目標 { subject: { date: goal } }

  const rg = $("stRange");
  if (rg) rg.textContent = 区切り.length ? `${区切り[0]["名前"]} 〜 ${区切り[区切り.length - 1]["名前"]}` : "";

  const chev = '<svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true"><path d="M6 8l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // モーダルと同じ内容（日付ごとに 目標|実績、行はコール/接触/アポ/3率）を、各対象で描く。
  const SALES_NAMES = ["田中欽也"], EXCLUDE_NAMES = ["中澤", "浦林", "森田", "笹原", "迫間"];
  const nameHas = (n, ts) => ts.some((t) => String(n || "").includes(t));
  const withRole = members.filter((m) => !nameHas(m.誰, EXCLUDE_NAMES))
    .map((m) => ({ email: String(m.email || m.誰).toLowerCase(), role: nameHas(m.誰, SALES_NAMES) ? "sales" : m.role, 誰: m.誰, 値: m.値 }));
  const teamEmails = (team) => team === "group" ? withRole.map((x) => x.email) : withRole.filter((x) => x.role === team).map((x) => x.email);
  const block = (title, vals, subject, isTeam, collapsed) =>
    `<div class="kc-g-block${isTeam ? " kc-g-team" : " kc-mem"}${collapsed ? " kc-g-collapsed" : ""}">
      <button type="button" class="kc-g-title" aria-expanded="${collapsed ? "false" : "true"}">
        <span class="kc-g-chev">${chev}</span><span class="kc-g-tname">${esc(title)}</span>
      </button>
      <div class="kc-g-body">${ddTable(区切り, vals || [], 今, subject, isTeam, goals[subject] || {}, statsPeriod)}</div>
    </div>`;

  if (statsScope === "all") {
    box.innerHTML =
      block("グループ全体", totals.group, "group", true) +
      block("セールス全体", totals.sales, "sales", true) +
      block("インサイド全体", totals.inside, "inside", true) +
      (d.sfError ? `<div class="note">${esc(d.sfError)}</div>` : "");
  } else {
    const has = (x) => (x["値"] || []).some((v) => v.コール || v.接触 || v.アポ内 || v.アポ外);
    const sales = withRole.filter((x) => x.role === "sales");
    const inside = withRole.filter((x) => x.role === "inside");
    const 大カード = (title, arr, 合計値, teamKey) => {
      if (!arr.length) return "";
      const ある = arr.filter(has), ない = arr.filter((x) => !has(x));
      const inner = block("＜チーム合計＞", 合計値, teamKey, true) +
        ある.map((x) => block(x["誰"], x["値"], x.email, false, true)).join("");
      return `<div class="kc-bigcard">
        <div class="kc-bigcard-h">${esc(title)}<span class="kc-bigcard-c">${arr.length}名</span></div>
        <div class="kc-bigcard-body">${inner}</div>
        ${ない.length ? `<div class="note">この期間に記録がない人：${ない.map((x) => esc(x["誰"])).join("、")}</div>` : ""}
      </div>`;
    };
    box.innerHTML =
      `<div class="kc-bigwrap">` +
        大カード("セールス", sales, totals.sales, "sales") +
        大カード("インサイド", inside, totals.inside, "inside") +
      `</div>` +
      (d.sfError ? `<div class="note">${esc(d.sfError)}</div>` : "");
  }
  // 目標入力（個人・日次）の保存
  box.querySelectorAll(".kc-g-body").forEach((bd) => {
    const inp0 = bd.querySelector(".kc-goal-cell");
    if (inp0) bindGoalInputs(bd, inp0.dataset.subj, () => loadStats(true));
  });
}

// ───────── プロセス（クローザー×月／全体×週） ─────────
let processMonth = "";
let processGrain = "month";   // month=クローザー別・月ごと / week=全体・週ごと
async function loadProcess() {
  const box = $("clStats");
  if (!box) return;
  box.innerHTML = `<div class="note">読み込んでいます…</div>`;
  try {
    const params = new URLSearchParams({ grain: processGrain });
    if (processMonth) params.set("month", processMonth);
    const d = await (await fetch("/api/calls/process?" + params.toString())).json();
    if (d.error) throw new Error(d.error);
    if (d.month) processMonth = d.month;
    const rg = $("stRange");
    const toggle = `<div class="kc-period-tabs" style="margin:0 0 10px;">
        <button type="button" class="kc-ptab ${processGrain === "month" ? "active" : ""}" data-pg="month">月ごと（クローザー別）</button>
        <button type="button" class="kc-ptab ${processGrain === "week" ? "active" : ""}" data-pg="week">週ごと（全体）</button>
      </div>`;
    const monthPicker = `<label>月：<input type="month" id="procMonth" value="${esc(d.month || "")}" /></label>`;

    if (d.grain === "week") {
      if (rg) rg.textContent = d.from && d.to ? `${d.from} 〜 ${d.to}（商談日）` : "";
      const rows = (d.items || []).map((w) =>
        `<tr class="proc-week" data-from="${esc(w.from)}" data-to="${esc(w.to)}" style="cursor:pointer">` +
        `<td class="kc-g-name"><span class="proc-caret">▸</span> ${esc(w["名前"])}<div class="ww">${esc(w.from)}〜${esc(w.to)}</div></td>` +
        `<td class="kc-g-n">${w["設定数"]}</td><td class="kc-g-n">${w["実施数"]}</td><td class="kc-g-n">${esc(w["実施率"])}</td></tr>`).join("");
      box.innerHTML = `<div class="kc-proc">${toggle}
        <div class="kc-proc-head">${monthPicker}<span class="note">その月の各週の全体合計（インサイド獲得も含む・商談日ベース）。週の行を押すと日ごとに開きます。範囲：${esc(d.from)}〜${esc(d.to)}</span></div>
        <table class="sh-table kc-grid" id="procWeekTable">
          <tr><th class="kc-g-name">週</th><th class="kc-g-h">設定数</th><th class="kc-g-h">実施数</th><th class="kc-g-h">実施率</th></tr>
          ${rows || `<tr><td class="kc-g-name" colspan="4">データがありません。</td></tr>`}
          <tr class="kc-g-team"><td class="kc-g-name">合計</td><td class="kc-g-n">${d["合計"]["設定数"]}</td><td class="kc-g-n">${d["合計"]["実施数"]}</td><td class="kc-g-n">${esc(d["合計"]["実施率"])}</td></tr>
        </table></div>`;
      // 週の行クリックで日ごとを開閉
      box.querySelectorAll(".proc-week").forEach((tr) => tr.addEventListener("click", async () => {
        const open = tr.getAttribute("data-open") === "1";
        // すでに開いていたら閉じる（差し込んだ日行を消す）
        let nx = tr.nextElementSibling;
        while (nx && nx.classList.contains("proc-day")) { const rm = nx; nx = nx.nextElementSibling; rm.remove(); }
        const caret = tr.querySelector(".proc-caret");
        if (open) { tr.setAttribute("data-open", "0"); if (caret) caret.textContent = "▸"; return; }
        tr.setAttribute("data-open", "1"); if (caret) caret.textContent = "▾";
        try {
          const dd = await (await fetch(`/api/calls/process?grain=day&from=${encodeURIComponent(tr.dataset.from)}&to=${encodeURIComponent(tr.dataset.to)}`)).json();
          const frag = (dd.items || []).map((x) =>
            `<tr class="proc-day"><td class="kc-g-name" style="padding-left:22px;color:#5b7a6d">${esc(x["名前"])}（${esc(x["曜日"])}）</td><td class="kc-g-n">${x["設定数"]}</td><td class="kc-g-n">${x["実施数"]}</td><td class="kc-g-n">${esc(x["実施率"])}</td></tr>`).join("");
          tr.insertAdjacentHTML("afterend", frag);
        } catch (e) { tr.insertAdjacentHTML("afterend", `<tr class="proc-day"><td colspan="4" class="kc-g-name">読み込めませんでした</td></tr>`); }
      }));
    } else {
      if (rg) rg.textContent = d.from && d.to ? `${d.from} 〜 ${d.to}（商談日）` : "";
      const rows = (d.items || []).map((x) =>
        `<tr><td class="kc-g-name">${esc(x["誰"])}</td><td class="kc-g-n">${x["設定数"]}</td><td class="kc-g-n">${x["実施数"]}</td><td class="kc-g-n">${esc(x["実施率"])}</td></tr>`).join("");
      box.innerHTML = `<div class="kc-proc">${toggle}
        <div class="kc-proc-head">${monthPicker}
          <span class="note">商談予定（【初回】【新/ヒ】・メルマガ含む）の「設定数」と、記録のある商談の「実施数」。クローザー別＋その他（インサイド・未定）。範囲：${esc(d.from)}〜${esc(d.to)}</span>
        </div>
        <table class="sh-table kc-grid">
          <tr><th class="kc-g-name">クローザー</th><th class="kc-g-h">設定数</th><th class="kc-g-h">実施数</th><th class="kc-g-h">実施率</th></tr>
          ${rows || `<tr><td class="kc-g-name" colspan="4">この月のデータはありません。</td></tr>`}
          <tr class="kc-g-team"><td class="kc-g-name">合計</td><td class="kc-g-n">${d["合計"]["設定数"]}</td><td class="kc-g-n">${d["合計"]["実施数"]}</td><td class="kc-g-n">${esc(d["合計"]["実施率"])}</td></tr>
        </table></div>`;
    }
    const mEl = $("procMonth");
    if (mEl) mEl.addEventListener("change", () => { processMonth = mEl.value; loadProcess(); });
    box.querySelectorAll("[data-pg]").forEach((b) => b.addEventListener("click", () => { processGrain = b.dataset.pg; loadProcess(); }));
  } catch (e) { box.innerHTML = `<div class="note">読み込めませんでした：${esc(e.message)}</div>`; }
}

// ───────── 設定・管理（アポ基準＋プロセスシート管理） ─────────
async function loadAdmin() {
  const box = $("clStats");
  if (!box) return;
  box.innerHTML = `<div class="note">読み込んでいます…</div>`;
  try {
    const [aw, ps] = await Promise.all([
      (await fetch("/api/calls/apo-window")).json().catch(() => ({})),
      (await fetch("/api/process-sheet")).json().catch(() => ({})),
    ]);
    const months = (aw && aw.months) || {};
    const mrow = (k, f, t) =>
      `<div class="apo-month-row" style="display:flex;gap:8px;align-items:center;margin:4px 0;flex-wrap:wrap;">
        <input type="month" class="am-key" value="${k || ""}" style="width:130px" /> ：
        <input type="date" class="am-from" value="${f || ""}" /> <span>〜</span>
        <input type="date" class="am-to" value="${t || ""}" />
        <button type="button" class="btn ghost am-del" style="padding:4px 10px">削除</button>
      </div>`;
    const mkeys = Object.keys(months).sort();
    const last = (ps && ps.last) || null;
    const lastTxt = last && last.at
      ? `${new Date(last.at).toLocaleString("ja-JP")}・${last.ok ? `${last.count ?? 0}箇所を更新` : "失敗"}${last.error ? "（" + esc(last.error) + "）" : ""}`
      : "まだ一度も実行されていません";

    box.innerHTML = `
      <div class="kc-admin">
        <div class="kc-adcard">
          <h3>アポの「期間内 / 期間外」の基準</h3>
          <p class="note">実績のアポ獲得を、商談日（アポ一覧＝カレンダーの商談予定日）で「期間内 / 期間外」に分けます。その境目をここで決めます。</p>
          <label class="field"><span>基準</span>
            <select id="awMode">
              <option value="span">表示期間内（表示している期間に商談があれば「内」）</option>
              <option value="days">今日から◯日以内（商談日が今日〜◯日先までなら「内」）</option>
            </select>
          </label>
          <label class="field" id="awDaysRow"><span>◯日以内</span>
            <input id="awDays" type="number" min="0" max="365" step="1" style="width:90px" /> <span class="note" style="margin:0 0 0 6px;">日</span>
          </label>
          <div class="modal-actions"><button class="btn" id="awSave">保存</button><span class="saved" id="awMsg" hidden>保存しました</span></div>

          <h4 class="ap-rot-h" style="margin-top:14px">月ごとの「期間内」の範囲（月ごと表示のとき）</h4>
          <p class="note">「月ごと」で見るとき、各月の“期間内”を日付で指定できます（例：8月＝8/10〜9/4）。設定しない月は「その月の1日〜末日」。</p>
          <div id="awMonths">${mkeys.length ? mkeys.map((k) => mrow(k, months[k].from, months[k].to)).join("") : mrow("", "", "")}</div>
          <div class="modal-actions">
            <button class="btn ghost" id="awMonthAdd" type="button">＋ 月を追加</button>
            <button class="btn" id="awMonthSave" type="button">月ごとの範囲を保存</button>
            <span class="saved" id="awMonthMsg" hidden>保存しました</span>
          </div>
        </div>

        <div class="kc-adcard">
          <h3>プロセスシートの管理</h3>
          <p class="note">SFレポートを読み取って、架電結果を「反映先のプロセスシート」に書き込みます。反映先やレポートはここで設定できます。</p>
          <label class="field"><span>反映先スプレッドシート</span>
            <input id="psSheet" type="text" placeholder="Googleスプレッドシートの共有URL または ID" value="${esc(ps.sheetId || "")}" />
          </label>
          <label class="field"><span>シート名（タブ）</span>
            <input id="psSheetName" type="text" placeholder="例：8月アポ管理" value="${esc(ps.sheetName || "")}" />
          </label>
          <label class="field"><span>SFレポートID</span>
            <input id="psReport" type="text" placeholder="例：00OIR000..." value="${esc(ps.reportId || "")}" />
          </label>
          <label class="field"><span>実行するSFユーザー</span>
            <input id="psOwner" type="text" placeholder="例：kinya.tanaka@neo-career.co.jp" value="${esc(ps.owner || "")}" />
          </label>
          <div class="modal-actions"><button class="btn" id="psSave" type="button">反映先・設定を保存</button><span class="saved" id="psSaveMsg" hidden>保存しました</span></div>

          <details class="kc-advanced" style="margin-top:8px">
            <summary style="cursor:pointer;color:#0d5b47;font-weight:600">詳細設定（期間・書き込み・稼働時間・Apps Script）</summary>
            <div style="margin-top:8px">
              <label class="field"><span>期間の決め方</span>
                <select id="psTermMode">
                  <option value="auto">自動（アポを取った月と商談の月が同じなら期内）</option>
                  <option value="fixed">決めた期間で（下の固定期間、または「月ごとの範囲」）</option>
                </select>
              </label>
              <div id="psFixedRow" hidden>
                <label class="field"><span>固定期間（開始）</span><input id="psFrom" type="date" value="${esc(ps.termFrom || "")}" /></label>
                <label class="field"><span>固定期間（終了）</span><input id="psTo" type="date" value="${esc(ps.termTo || "")}" /></label>
              </div>
              <label class="field"><span>この日から書き込む</span><input id="psWriteFrom" type="date" value="${esc(ps.writeFrom || "")}" /></label>
              <label class="field"><span>休み（この日は0で書く）</span><input id="psZeroDates" type="text" placeholder="例：8/21, 8/22" value="${esc(ps.zeroDates || "")}" /></label>
              <label class="ks-check" style="margin:4px 0"><input type="checkbox" id="psHours" ${ps.withHours ? "checked" : ""} /> 稼働時間目標もカレンダーから入れる</label>
              <label class="field"><span>Apps Script URL（保護シート用・任意）</span><input id="psGasUrl" type="text" placeholder="https://script.google.com/…/exec" value="${esc(ps.gasUrl || "")}" /></label>
              <label class="field"><span>合言葉</span><input id="psGasSecret" type="password" placeholder="${ps.gasSecretSet ? "保存済み（変えるときだけ入力）" : "未設定"}" /></label>
              <p class="note" style="margin:2px 0 0">SFレポートの絞り込み条件は「SF連携」画面で設定します。ここで保存した設定は両方の画面で共通です。</p>
            </div>
          </details>

          <div class="kc-adrow" style="margin-top:8px"><span class="kc-adk">最後の実行</span><span id="psLast">${lastTxt}</span></div>
          <div class="kc-adrow"><span class="kc-adk">自動実行</span>
            <label class="ks-check"><input type="checkbox" id="psAuto" ${ps.autoRun ? "checked" : ""} /> ${ps.autoRun ? "ON（間隔ごとに自動で書き込み）" : "OFF"}</label>
          </div>
          <div class="modal-actions">
            <button class="btn" id="psRun" type="button">今すぐ実行</button>
            <button class="btn ghost" id="psDry" type="button">お試し（書き込まず件数だけ）</button>
            <button class="btn ghost" id="psForce" type="button">実績で強制上書き</button>
            <span class="saved" id="psMsg" hidden></span>
          </div>
          <p class="note" style="margin:2px 0 0">通常の実行は、人が手で直したセルは上書きしません（kinbotが前回書いた値のままのセルだけ最新の実績に更新）。「強制上書き」は手入力も含めて実績で置き換えます。</p>
          <div class="note" id="psResult" style="margin-top:6px"></div>
          <div id="psDetail" style="margin-top:6px;font-size:12px;line-height:1.6"></div>
        </div>
      </div>`;

    // --- アポ基準の配線 ---
    const modeEl = $("awMode"), daysEl = $("awDays"), daysRow = $("awDaysRow");
    modeEl.value = aw.mode === "days" ? "days" : "span";
    daysEl.value = aw.days != null ? aw.days : 14;
    const syncRow = () => { daysRow.style.display = modeEl.value === "days" ? "" : "none"; };
    syncRow(); modeEl.addEventListener("change", syncRow);
    $("awSave").addEventListener("click", async () => {
      try {
        const r = await fetch("/api/calls/apo-window", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: modeEl.value, days: parseInt(daysEl.value, 10) || 14 }) });
        if (!r.ok) throw new Error((await r.json()).error || "保存できません");
        const m = $("awMsg"); m.hidden = false; setTimeout(() => (m.hidden = true), 3000);
      } catch (e) { alert("保存できませんでした：" + e.message); }
    });
    $("awMonthAdd").addEventListener("click", () => { const d = document.createElement("div"); d.innerHTML = mrow("", "", ""); $("awMonths").appendChild(d.firstElementChild); });
    box.addEventListener("click", (ev) => { const b = ev.target.closest && ev.target.closest(".am-del"); if (b) b.closest(".apo-month-row").remove(); });
    $("awMonthSave").addEventListener("click", async () => {
      const ms = {};
      $("awMonths").querySelectorAll(".apo-month-row").forEach((row) => {
        const key = row.querySelector(".am-key").value, f = row.querySelector(".am-from").value, t = row.querySelector(".am-to").value;
        if (/^\d{4}-\d{2}$/.test(key) && f && t) ms[key] = { from: f, to: t };
      });
      try {
        const r = await fetch("/api/calls/apo-window", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ months: ms }) });
        if (!r.ok) throw new Error((await r.json()).error || "保存できません");
        const m = $("awMonthMsg"); m.hidden = false; setTimeout(() => (m.hidden = true), 3000);
      } catch (e) { alert("保存できませんでした：" + e.message); }
    });

    // --- プロセスシートの配線 ---
    // 詳細設定：期間の決め方の初期値と、固定期間の表示切替。
    const psTermModeEl = $("psTermMode");
    if (psTermModeEl) {
      psTermModeEl.value = ps.termMode === "fixed" ? "fixed" : "auto";
      const syncFixed = () => { const r = $("psFixedRow"); if (r) r.hidden = psTermModeEl.value !== "fixed"; };
      syncFixed();
      psTermModeEl.addEventListener("change", syncFixed);
    }
    const psVal = (id) => { const el = $(id); return el ? el.value.trim() : undefined; };
    $("psSave").addEventListener("click", async () => {
      const body = {
        sheetId: $("psSheet").value.trim(),
        sheetName: $("psSheetName").value.trim(),
        reportId: $("psReport").value.trim(),
        owner: $("psOwner").value.trim(),
      };
      // 詳細設定（ある項目だけ送る）
      if (psTermModeEl) body.termMode = psTermModeEl.value === "fixed" ? "fixed" : "auto";
      if ($("psFrom")) body.termFrom = psVal("psFrom");
      if ($("psTo")) body.termTo = psVal("psTo");
      if ($("psWriteFrom")) body.writeFrom = psVal("psWriteFrom");
      if ($("psZeroDates")) body.zeroDates = psVal("psZeroDates");
      if ($("psHours")) body.withHours = $("psHours").checked;
      if ($("psGasUrl")) body.gasUrl = psVal("psGasUrl");
      if ($("psGasSecret") && $("psGasSecret").value.trim()) body.gasSecret = $("psGasSecret").value.trim();
      try {
        const r = await fetch("/api/process-sheet", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error((await r.json()).error || "保存できません");
        const m = $("psSaveMsg"); m.hidden = false; setTimeout(() => (m.hidden = true), 3000);
        const gsEl = $("psGasSecret"); if (gsEl) { gsEl.value = ""; if (body.gasSecret) gsEl.placeholder = "保存済み（変えるときだけ入力）"; }
      } catch (e) { alert("保存できませんでした：" + e.message); }
    });
    $("psAuto").addEventListener("change", async (e) => {
      try {
        const r = await fetch("/api/process-sheet", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ autoRun: e.target.checked }) });
        if (!r.ok) throw new Error((await r.json()).error || "変更できません");
      } catch (err) { alert("変更できませんでした：" + err.message); e.target.checked = !e.target.checked; }
    });
    const runPs = async (dry, force) => {
      const rs = $("psResult"); rs.textContent = dry ? "お試し中…" : (force ? "強制上書き中…" : "実行中…");
      try {
        const r = await fetch("/api/process-sheet/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dryRun: dry, force: !!force }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "実行に失敗しました");
        const tu = d.termUsed || {};
        const termTxt = tu.from && tu.to ? `　期間 ${tu.from}〜${tu.to}（${tu.source || ""}）` : "";
        const prot = Number(d.protectedCount || 0);
        const protTxt = prot ? `　手入力を尊重して据え置き ${prot}箇所` : "";
        rs.textContent = dry
          ? `お試し：${d.count ?? 0}箇所を更新予定（まだ書き込んでいません）${protTxt}${termTxt}`
          : `完了：${d.count ?? 0}箇所を更新しました${d.forced ? "（強制上書き）" : protTxt}${termTxt}`;
        // 内訳（誰の・どの日に・何を書くか）。原因を画面だけで追えるようにする。
        const det = $("psDetail");
        if (det) {
          const parts = [];
          const warns = Array.isArray(d.warnings) ? d.warnings : [];
          if (warns.length) parts.push(`<div style="color:#b45309">注意：${warns.map(esc).join("／")}</div>`);
          if (d.internNote) parts.push(`<div style="color:#b45309">${esc(d.internNote)}</div>`);
          const sk = Array.isArray(d.skipped) ? d.skipped : [];
          if (sk.length) parts.push(`<div>スキップ：${esc(sk.slice(0, 8).join("／"))}${sk.length > 8 ? `…他${sk.length - 8}件` : ""}</div>`);
          const pc = Array.isArray(d.protectedCells) ? d.protectedCells : [];
          if (pc.length) {
            const rows = pc.slice(0, 30).map((c) =>
              `<tr><td>${esc(c.who)}</td><td>${esc(c.date)}</td><td>${esc(c.metric)}</td><td>${esc(c.current)}</td><td>${esc(c.want)}</td></tr>`).join("");
            parts.push(`<div style="margin-top:4px">手入力とみなして据え置いたセル（${pc.length}）：</div>` +
              `<table class="tbl"><thead><tr><th>担当者</th><th>日</th><th>項目</th><th>今の値(手入力)</th><th>実績</th></tr></thead><tbody>${rows}</tbody></table>`);
          }
          if (dry) {
            const ppl = Array.isArray(d.people) ? d.people : [];
            const mt = Array.isArray(d.matched) ? d.matched : [];
            const sameN = (x, y) => { const a2 = String(x).replace(/[\s　]/g, ""), b2 = String(y).replace(/[\s　]/g, ""); return a2 === b2 || a2.startsWith(b2) || b2.startsWith(a2); };
            const miss = ppl.filter((p) => !mt.some((m) => sameN(p, m)));
            parts.push(`<div>シートの担当者（${ppl.length}）：${esc(ppl.join("、"))}</div>`);
            parts.push(`<div>集計に出てきた名前（${mt.length}）：${esc(mt.join("、"))}</div>`);
            if (miss.length) parts.push(`<div style="color:#b45309">実績が見つからない担当者：${esc(miss.join("、"))}</div>`);
            const tbp = Array.isArray(d.talliedByPerson) ? d.talliedByPerson : [];
            const tbpLines = tbp.map((x) => {
              const days = Object.entries(x.days || {});
              if (!days.length) return `<div>${esc(x.name)}：集計に実績なし</div>`;
              const ds = days.map(([dk, v]) => `${esc(dk)}[コール${v.コール}/接触${v.接触}/内${v.内}/外${v.外}]`).join("　");
              return `<div>${esc(x.name)}：${ds}</div>`;
            });
            if (tbpLines.length) parts.push(`<div style="margin-top:4px">集計の生値（担当者ごと・実績のある日だけ）：</div>${tbpLines.join("")}`);
            const ups = Array.isArray(d.updates) ? d.updates : [];
            if (ups.length) {
              const by = new Map();
              for (const u of ups) { const k = `${u.who}｜${u.date}`; if (!by.has(k)) by.set(k, {}); by.get(k)[u.metric] = u.value; }
              const lines = [...by.entries()].map(([k, v]) => {
                const [who, date] = k.split("｜");
                const cell = (m) => (v[m] === undefined ? "-" : v[m]);
                return `<tr><td>${esc(who)}</td><td>${esc(date)}</td><td>${cell("コール")}</td><td>${cell("接触")}</td><td>${cell("アポ（期内）")}</td><td>${cell("アポ（期外）")}</td><td>${cell("稼働時間")}</td></tr>`;
              });
              parts.push(`<table class="tbl" style="margin-top:4px"><thead><tr><th>担当者</th><th>日</th><th>コール</th><th>接触</th><th>アポ内</th><th>アポ外</th><th>稼働</th></tr></thead><tbody>${lines.join("")}</tbody></table>`);
            } else {
              parts.push(`<div>書き込む内容がありません。</div>`);
            }
          }
          det.innerHTML = parts.join("");
        }
        if (!dry) { const pl = $("psLast"); if (pl) pl.textContent = `${new Date().toLocaleString("ja-JP")}・${d.count ?? 0}箇所を更新`; }
      } catch (e) { rs.textContent = "失敗：" + e.message; }
    };
    $("psRun").addEventListener("click", () => runPs(false, false));
    $("psDry").addEventListener("click", () => runPs(true, false));
    if ($("psForce")) $("psForce").addEventListener("click", () => {
      if (confirm("手入力したセルも含めて、実績で上書きします。よろしいですか？")) runPs(false, true);
    });
  } catch (e) { box.innerHTML = `<div class="note">読み込めませんでした：${esc(e.message)}</div>`; }
}

// ───────── リスト別の実績（kincall架電ログ基準） ─────────
let LIST_FROM = "", LIST_TO = "";
try { LIST_FROM = localStorage.getItem("kcListFrom") || ""; LIST_TO = localStorage.getItem("kcListTo") || ""; } catch {}
async function loadListStats() {
  const box = $("clStats");
  if (!box) return;
  box.innerHTML = `<div class="note">読み込んでいます…</div>`;
  try {
    // 期間：入力があればその範囲、無ければ日/週/月の既定
    const per = ["day", "week", "month"].includes(statsPeriod) ? statsPeriod : "day";
    const q = (LIST_FROM && LIST_TO)
      ? `from=${encodeURIComponent(LIST_FROM)}&to=${encodeURIComponent(LIST_TO)}`
      : `period=${encodeURIComponent(per)}`;
    const d = await (await fetch(`/api/calls/group-funnel?${q}`)).json();
    if (d.error) throw new Error(d.error);
    const rg = $("stRange"); if (rg) rg.textContent = d.from && d.to ? `${d.from} 〜 ${d.to}` : "";
    const items = d.items || [];
    if (!items.length) { box.innerHTML = `<div class="note">グループがまだありません。リスト管理でグループを作り、各リストに割り当ててください。</div>`; return; }
    const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + "%" : "—");
    const card = (L) => {
      const step = (名, 数, 率) => `<div class="fn-step"><b>${数}</b><span>${esc(名)}</span><i>${esc(率 || "")}</i></div>`;
      return `<div class="kc-listcard grp-card" data-gid="${L.group_id}" style="cursor:pointer">
        <div class="kc-listcard-h">${esc(L.group_name)}<span class="kc-listcard-sum">リスト ${L["リスト数"] || 0}件</span>
          <span class="kc-listcard-sum">コール ${L["コール"]}｜接触率 ${esc(L["接触率"])}｜アポ率 ${esc(L["アポ率"])}｜案件化率 ${esc(L["案件化率"])}</span>
        </div>
        <div class="fn-row">
          ${step("コール", L["コール"], "")}
          ${step("接触", L["接触"], L["接触率"])}
          ${step("アポ", L["アポ"], L["アポ率"])}
          ${step("実施", L["実施"], L["実施率"])}
          ${step("案件化", L["案件化"], L["案件化率"])}
          ${step("KPI", L["KPI"], L["KPI率"])}
          ${step("MID", L["MID"], L["MID率"])}
          ${step("受注", L["受注"], L["受注率"])}
        </div>
      </div>`;
    };
    const 期間欄 = `<div class="kc-fn-range">
        <label>期間 <input type="date" id="lfFrom" value="${esc(LIST_FROM || d.from || "")}" /></label>
        <span>〜</span>
        <label><input type="date" id="lfTo" value="${esc(LIST_TO || d.to || "")}" /></label>
        <button class="pr-b" id="lfApply" type="button">この期間で見る</button>
        <button class="pr-b" id="lfClear" type="button">既定に戻す</button>
      </div>`;
    box.innerHTML = 期間欄 + `<div class="kc-listgrid">${items.map(card).join("")}</div><div id="grpDetail"></div>`;
    const ap = $("lfApply"); if (ap) ap.addEventListener("click", () => {
      const f = ($("lfFrom") || {}).value, t = ($("lfTo") || {}).value;
      if (!f || !t) { alert("開始日と終了日を入れてください"); return; }
      LIST_FROM = f; LIST_TO = t;
      try { localStorage.setItem("kcListFrom", f); localStorage.setItem("kcListTo", t); } catch {}
      loadListStats();
    });
    const cl = $("lfClear"); if (cl) cl.addEventListener("click", () => {
      LIST_FROM = ""; LIST_TO = "";
      try { localStorage.removeItem("kcListFrom"); localStorage.removeItem("kcListTo"); } catch {}
      loadListStats();
    });
    box.querySelectorAll(".grp-card").forEach((c) => c.addEventListener("click", () => openGroupDetail(c.dataset.gid, c)));
  } catch (e) { box.innerHTML = `<div class="note">読み込めませんでした：${esc(e.message)}</div>`; }
}

// グループの内訳（リストごと＋会社ごとのSFステージ）
async function openGroupDetail(gid, card) {
  const box = document.getElementById("grpDetail"); if (!box) return;
  if (box.dataset.open === String(gid)) { box.innerHTML = ""; box.dataset.open = ""; return; }
  box.dataset.open = String(gid);
  box.innerHTML = `<div class="note">内訳を読み込んでいます…</div>`;
  try {
    const qq = (LIST_FROM && LIST_TO) ? `?from=${encodeURIComponent(LIST_FROM)}&to=${encodeURIComponent(LIST_TO)}` : "";
    const d = await (await fetch(`/api/calls/group-detail/${encodeURIComponent(gid)}${qq}`)).json();
    if (d.error) throw new Error(d.error);
    const name = card ? (card.querySelector(".kc-listcard-h") || {}).textContent || "" : "";
    const lists = (d.lists || []).map((L) =>
      `<tr><td class="kc-g-name">${esc(L.list_name)}</td><td class="kc-g-n">${L["コール"]}</td><td class="kc-g-n">${L["接触"]}（${esc(L["接触率"])}）</td><td class="kc-g-n">${L["アポ"]}（${esc(L["アポ率"])}）</td></tr>`).join("");
    const stageChip = (s2) => {
      const cls = /受注処理完了/.test(s2) ? "won" : /04/.test(s2) ? "mid" : /03/.test(s2) ? "kpi" : /02/.test(s2) ? "ok" : /01/.test(s2) ? "apo" : "none";
      return `<span class="st-chip ${cls}">${esc(s2)}</span>`;
    };
    const comps = (d.companies || []).map((c) =>
      `<tr${c["この期間のアポ"] ? ' class="apo-row"' : ""}><td class="kc-g-name">${esc(c["会社"])}${c["この期間のアポ"] ? ' <span class="st-chip apo">アポ</span>' : ""}<div class="ww">${esc(c["リスト"])}</div></td>` +
      `<td class="kc-g-n">${c["コール数"]}</td>` +
      `<td class="kc-g-n">${esc(c["最終結果"] || "—")}<div class="ww">${esc(c["最終日時"] || "")}</div></td>` +
      `<td class="kc-g-n">${c["実施"] ? "実施済み" : "—"}</td>` +
      `<td class="kc-g-n">${stageChip(c["SFステージ"])}</td></tr>`).join("");
    box.innerHTML = `
      <div class="kc-listcard" style="margin-top:12px">
        <div class="kc-listcard-h">${esc(name)} の内訳<span class="kc-listcard-sum">${esc(d.from)}〜${esc(d.to)}</span></div>
        <div class="ai-subh">リストごと</div>
        <table class="sh-table kc-grid"><tr><th class="kc-g-name">リスト</th><th class="kc-g-h">コール</th><th class="kc-g-h">接触</th><th class="kc-g-h">アポ</th></tr>${lists || `<tr><td colspan="4" class="kc-g-name">この期間の架電はありません。</td></tr>`}</table>
        <div class="ai-subh" style="margin-top:10px">会社ごと（SFのステージ）</div>
        <div style="max-height:420px;overflow:auto">
        <table class="sh-table kc-grid"><tr><th class="kc-g-name">会社</th><th class="kc-g-h">コール</th><th class="kc-g-h">最終結果</th><th class="kc-g-h">商談</th><th class="kc-g-h">SFステージ</th></tr>${comps || `<tr><td colspan="5" class="kc-g-name">対象がありません。</td></tr>`}</table>
        </div>
      </div>`;
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
  if (t.id === "clStatsReload") { ev.preventDefault(); loadStats(true); }
});

if ($("clList")) {
  $("clList").addEventListener("change", () => {
    const v = $("clList").value;
    listId = v === "all" ? "all" : (Number(v) || 0);
    rememberListId(v);   // 選んだリストを覚える
    callAsMember = "";   // ドロップダウンで選び直したら、担当の絞り込みは外す
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
      // リスト別・メンバー別の分析・設定管理のときは、全体/個別は効かない
      const off = statsPeriod === "analysis" || statsPeriod === "list" || statsPeriod === "admin";
      const sc = $("stScope"); if (sc) sc.style.opacity = off ? "0.4" : "1";
      loadStats();
    }));
}
let statsTop = "dash";   // dash / jisseki / admin / process
if ($("stTop")) {
  $("stTop").querySelectorAll(".kc-ptab").forEach((b) =>
    b.addEventListener("click", () => {
      statsTop = b.dataset.top || "jisseki";
      $("stTop").querySelectorAll(".kc-ptab").forEach((x) => x.classList.toggle("active", x === b));
      const showJisseki = statsTop === "jisseki";
      const isDash = statsTop === "dash";
      const sw = $("stScopeWrap"), sp = $("stPeriod"), jw = $("clJissekiWrap"), dw = $("clDashWrap");
      if (sw) sw.style.display = showJisseki ? "" : "none";
      if (sp) sp.style.display = showJisseki ? "" : "none";
      if (jw) jw.hidden = !showJisseki;
      if (dw) dw.hidden = !isDash;
      if (isDash) loadDash();
      else if (statsTop === "admin") loadAdmin();
      else if (statsTop === "process") loadProcess();
      else loadStats();
    }));
}
if ($("stScope")) {
  $("stScope").querySelectorAll(".kc-ptab").forEach((b) =>
    b.addEventListener("click", () => {
      statsScope = b.dataset.scope || "all";
      $("stScope").querySelectorAll(".kc-ptab").forEach((x) => x.classList.toggle("active", x === b));
      // 取得済みなら再取得せず即描画（切替を速く）。無ければ取りに行く。
      if (_statsCache[statsPeriod]) renderStats(_statsCache[statsPeriod]); else loadStats();
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
  // ヘッダーの表示を、いま開いているページに合わせる
  const 名前 = { call: ["kincall", "架電リスト"], stats: ["実績", ""], lists: ["リスト管理", ""] }[p] || ["kincall", ""];
  const nm = document.querySelector(".kc-name"); if (nm) nm.textContent = 名前[0];
  const sub = document.querySelector(".kc-sub"); if (sub) { sub.textContent = 名前[1]; sub.style.display = 名前[1] ? "" : "none"; }
  if (p === "stats") { if (statsTop === "dash") loadDash(); else loadStats(); }
  if (p === "lists") asLoad();
}

// サイドメニューの「資料送付設定」→ モーダルを開く（ページ遷移はしない）
(function wireSideDoc() {
  const a = document.getElementById("kcSideDoc");
  if (!a) return;
  a.addEventListener("click", (ev) => { ev.preventDefault(); openDocSettings(); });
})();

// リスト管理の中のタブ（リスト管理／リスト作成）
(function wireListTabs() {
  const tabs = document.getElementById("lsTabs");
  if (!tabs) return;
  tabs.addEventListener("click", (ev) => {
    const b = ev.target && ev.target.closest ? ev.target.closest(".kc-ptab") : null;
    if (!b) return;
    if (b.id === "kcDocSettings") { openDocSettings(); return; }
    const name = b.dataset.ls || "manage";
    tabs.querySelectorAll(".kc-ptab").forEach((x) => x.classList.toggle("active", x === b && !!x.dataset.ls));
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
let iAmCloser = false;               // クローザー（管理者含む）＝リストを追加できる
let iAmRedistributor = false;        // 他メンバーへ割り振れる（クローザー・管理者＋インサイド）
let appendTarget = null;             // {id, name}：既存リストに追加する先
let csvAddMode = false;              // CSV：作成する(false)／追加する(true)
let callAsMember = "";               // かける画面を、この担当の割り振りぶんだけで見る（空＝全部）
let selectedIds = new Set();          // 一覧で選択した架電先のid
(async () => {
  try {
    const me = await (await fetch("/api/me")).json();
    iAmCloser = !!(me && (me.closer || me.admin));
    iAmRedistributor = !!(me && (me.canRedistribute || me.closer || me.admin));
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

// 「操作 ▾」メニューの開閉。項目のハンドラは下の委譲リスナーがidで実行する。
document.addEventListener("click", (ev) => {
  const menu = document.getElementById("clMenuList");
  if (!menu) return;
  const btn = ev.target.closest && ev.target.closest("#clMenuBtn");
  if (btn) { menu.hidden = !menu.hidden; btn.setAttribute("aria-expanded", String(!menu.hidden)); return; }
  const item = ev.target.closest && ev.target.closest(".cl-menu-item");
  if (item) { menu.hidden = true; return; }                 // 項目を選んだら閉じる
  if (!(ev.target.closest && ev.target.closest("#clMenuList"))) menu.hidden = true;   // 外側で閉じる
});

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
  if (t.id === "clToCross") {
    ev.preventDefault();
    (async () => {
      if (!listId || listId === "all") { say("clStatus", "リストを選んでください（全てのリードでは実行できません）", 5000); return; }
      say("clStatus", "対象を調べています…");
      let 対象 = 0;
      try {
        const dry = await (await fetch(`/api/calls/lists/${encodeURIComponent(listId)}/to-cross`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dryRun: true }),
        })).json();
        if (dry.error) throw new Error(dry.error);
        対象 = dry["クロス以外"] || 0;
      } catch (e) { say("clStatus", "調べられませんでした：" + e.message, 8000); return; }
      if (!対象) { say("clStatus", "変更が必要なリードはありません（すべてクロス、またはSF未連携）", 6000); return; }
      if (!confirm(`このリストのSF連携済みリードのうち、クロス以外の ${対象}件 を Salesforce で Cross_lead（クロスリード）に変更します。\n既にクロスのものは変更しません。\nこの操作はSFのデータを書き換えます（自動では元に戻せません）。\nよろしいですか？`)) { say("clStatus", ""); return; }
      let 変更 = 0, 失敗 = 0, 回 = 0;
      try {
        while (true) {
          回++;
          const r = await fetch(`/api/calls/lists/${encodeURIComponent(listId)}/to-cross`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 20 }),
          });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || "変更できませんでした");
          変更 += d["変更"] || 0; 失敗 += d["失敗"] || 0;
          say("clStatus", `クロスリードに変更中… ${変更}/${対象}件${失敗 ? `（失敗${失敗}）` : ""}`);
          if (d.done || 回 > 500) break;
        }
        say("clStatus", `クロスリードに変更しました：${変更}件${失敗 ? `（失敗${失敗}）` : ""}`, 12000);
      } catch (e) { say("clStatus", "できませんでした：" + e.message, 8000); }
    })();
  }
  if (t.id === "clBizHours") {
    ev.preventDefault();
    (async () => {
      const lst = ($("clList") && $("clList").value) || String(listId || "");
      if (!lst) { say("clStatus", "リストを選んでください", 5000); return; }
      if (!confirm("このリストの会社の営業時間をGoogleから取得します。\n（まだ取れていない会社＋前回『不明』だった会社を、Places→AI検索で調べます）\nよろしいですか？")) return;
      say("clStatus", "営業時間を取得しています…", 60000);
      try {
        const d = await (await fetch("/api/calls/place-hours/refresh", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ list: lst, member: callAsMember || undefined }),
        })).json();
        if (!d.ok) throw new Error(d.error || "取得できませんでした");
        if (!d.取得対象) { say("clStatus", "営業時間は取得済みです（新しく取るものはありませんでした）", 6000); return; }
        // 進み具合をポーリングして表示。完了したら一覧を更新して反映。
        let stopped = 0;
        const poll = async () => {
          try {
            const s = await (await fetch("/api/calls/place-hours/status")).json();
            const done = s.done || 0, total = s.total || d.取得対象;
            say("clStatus", `営業時間を取得中… ${Math.min(done, total)}/${total}社`, 60000);
            if (!s.running && done >= total) { say("clStatus", `営業時間の取得が完了しました（${s.ok || done}社）。表示を更新します。`, 8000); loadTable(); return; }
            if (++stopped > 300) { say("clStatus", "取得に時間がかかっています。少し待ってからリストを開き直してください。", 10000); return; }
            setTimeout(poll, 2000);
          } catch { setTimeout(poll, 3000); }
        };
        poll();
      } catch (e) { say("clStatus", "できませんでした：" + e.message, 8000); }
    })();
  }
  if (t.id === "clFixLinks") {
    ev.preventDefault();
    (async () => {
      if (!listId) { say("clStatus", "リストを選んでください", 4000); return; }
      say("clStatus", "紐づけの誤りを調べています…");
      try {
        const pre = await (await fetch(`/api/calls/lists/${encodeURIComponent(listId)}/relink-reset`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apply: false }),
        })).json();
        if (!pre.ok) throw new Error(pre.error || "調べられませんでした");
        if (!pre["対象件数"]) { say("clStatus", "誤った紐づけは見つかりませんでした", 8000); return; }
        const 例 = (pre["内訳"] || []).slice(0, 3)
          .map((d) => `${(d["会社例"] || []).slice(0, 3).join("・")} ほか（${d["件数"]}件が同じリード）`).join("\n");
        if (!confirm(`1つのリードが複数の会社に付いている誤りが見つかりました。\n重複リード ${pre["重複リード"]}件／付け直す架電先 ${pre["対象件数"]}件。\n\n${例}\n\nこれらの紐づけを一旦外し、会社名で付け直します（過去の記録は消えません）。よろしいですか？`)) {
          say("clStatus", "やめました", 4000); return;
        }
        say("clStatus", "誤った紐づけを外しています…");
        const r = await (await fetch(`/api/calls/lists/${encodeURIComponent(listId)}/relink-reset`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apply: true }),
        })).json();
        if (!r.ok) throw new Error(r.error || "外せませんでした");
        // 続けて会社名で正しく付け直す
        say("clStatus", `外しました（${r["リセット"]}件）。会社名で付け直しています…`);
        let 見 = 0, 作 = 0, 失 = 0, 回 = 0;
        while (true) {
          回++;
          const d = await (await fetch(`/api/calls/lists/${encodeURIComponent(listId)}/to-sf`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 20 }),
          })).json();
          if (!d || d.error) throw new Error((d && d.error) || "付け直せませんでした");
          見 += d["見つかった"] || 0; 作 += d["新しく作った"] || 0; 失 += d["失敗"] || 0;
          say("clStatus", `付け直し中… 残り${d["残り"]}件（結びつけ${見}／新規作成${作}${失 ? `／失敗${失}` : ""}）`);
          if (d.done || 回 > 2000) break;
        }
        say("clStatus", `修復しました（外した${r["リセット"]}件→結びつけ${見}／新規作成${作}${失 ? `／失敗${失}` : ""}）`, 12000);
        loadTable();
      } catch (e) { say("clStatus", "できませんでした：" + e.message, 8000); }
    })();
  }
  if (t.id === "clLinkSf") {
    ev.preventDefault();
    (async () => {
      if (!listId) { say("clStatus", "リストを選んでください", 4000); return; }
      if (!confirm("このリストで、まだSalesforceに結びついていない（作成時にSFを読み込まなかった）架電先を、会社名でSFのリードに結びつけます。\n続けてSFの最新状態も反映します。よろしいですか？")) return;
      let 見 = 0, 作 = 0, 失 = 0, 回 = 0;
      try {
        while (true) {
          回++;
          const r = await fetch(`/api/calls/lists/${encodeURIComponent(listId)}/to-sf`, {
            method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 20 }),
          });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || "連携できませんでした");
          見 += d["見つかった"] || 0; 作 += d["新しく作った"] || 0; 失 += d["失敗"] || 0;
          say("clStatus", `SFと連携中… 残り${d["残り"]}件（結びつけ${見}／新規作成${作}${失 ? `／失敗${失}` : ""}）`);
          if (d.done || 回 > 2000) break;
        }
        // 続けてSFの最新状態も反映
        say("clStatus", "SFの状態を反映しています…");
        const rf = await (await fetch(`/api/calls/lists/${encodeURIComponent(listId)}/refresh-sf`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
        })).json();
        say("clStatus", `SFと連携しました（結びつけ${見}／新規作成${作}${失 ? `／失敗${失}` : ""}）`
          + (rf && rf["反映"] ? `／状態を反映 ${rf["反映"]}件` : ""), 12000);
        loadTable();
      } catch (e) { say("clStatus", "できませんでした：" + e.message, 8000); }
    })();
  }
  if (t.id === "clRefreshSf") {
    ev.preventDefault();
    (async () => {
      if (!listId) { say("clStatus", "リストを選んでください", 4000); return; }
      if (!confirm("このリストの各リードについて、Salesforceの最新の状態（最終ステータス・ステージ・所有者）とクロス商談の有無を読みに行って、kincallに反映します。\nよろしいですか？")) return;
      // SFの所有者を優先して、kincallの担当をSFのリード所有者に合わせるか
      const preferSfOwner = confirm("あわせて、SFのリード所有者を優先しますか？\n\nOKを押すと、SF上のリード所有者に一致するメンバーへ、kincallの担当を合わせます（担当のバッティング解消）。\nキャンセルを押すと、担当は変えずに状態だけ反映します。");
      say("clStatus", "Salesforceの状態を読み込んでいます…");
      try {
        const d = await (await fetch(`/api/calls/lists/${encodeURIComponent(listId)}/refresh-sf`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ preferSfOwner }),
        })).json();
        if (d.error) throw new Error(d.error);
        say("clStatus", `SFの最新に反映しました：${d["反映"] || 0}件`
          + (d["担当そろえ"] ? `／SF所有者に担当をそろえ ${d["担当そろえ"]}件` : "")
          + (d["ユーザー"] ? `／ユーザー ${d["ユーザー"]}件（クロス受注→対象外）` : "")
          + (d["クロス商談あり"] ? `／クロス商談 ${d["クロス商談あり"]}件（アポ獲得済み）` : "")
          + (d["直近失注"] ? `／直近失注 ${d["直近失注"]}件（対象外）` : "")
          + (d["SF未連携"] ? `／SF未連携 ${d["SF未連携"]}件（対象外）` : ""), 12000);
        loadTable();
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
        '<div class="kc-mem-card kc-mem-special" data-special="archive"><span class="kc-mem-name">🗄 アーカイブ</span></div>' +
        '<div class="kc-mem-card kc-mem-special" data-special="recycle"><span class="kc-mem-name">♻ リサイクル</span></div>' +
      '</div>' +
      '<div class="kc-mem-pick" id="kcPick" hidden></div>' +
      '<div class="kc-grp-box" id="kcGrpBox"></div>';
    renderGroups();

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
      if (c.dataset.special) return;      // アーカイブ/リサイクルは下で個別に配線
      c.addEventListener("click", () => asLoadMember(c.dataset.email, c.dataset.name));
    });
    box.querySelectorAll(".kc-mem-special").forEach((c) =>
      c.addEventListener("click", () => openStageCard(c.dataset.special, c.dataset.special === "archive" ? "アーカイブ" : "リサイクル")));
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
// 今あるリストを、少しずつSalesforceに反映する（大量でも止まらないよう繰り返し呼ぶ）
async function runToSf(listId, listName, btn) {
  if (!confirm(`「${listName}」の中で、まだSalesforceに載っていない架電先を、SFに反映します。\n（会社名でクロスリードを探し、無ければ作って結びつけます）\nよろしいですか？`)) return;
  const orig = btn.textContent;
  btn.disabled = true;
  let 見 = 0, 作 = 0, 失 = 0, 回 = 0;
  try {
    while (true) {
      回++;
      const r = await fetch(`/api/calls/lists/${encodeURIComponent(listId)}/to-sf`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ limit: 20 }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "反映できませんでした");
      見 += d["見つかった"] || 0; 作 += d["新しく作った"] || 0; 失 += d["失敗"] || 0;
      btn.textContent = `反映中… 残り${d["残り"]}件（見つかった${見}／作成${作}${失 ? `／失敗${失}` : ""}）`;
      if (d.done || (d["残り前"] !== undefined && d["残り"] >= d["残り前"] && 回 > 1)) break;   // 進まなくなったら止める
      if (回 > 2000) break;   // 念のための上限
    }
    btn.textContent = `SFに反映しました（見つかった${見}／作成${作}${失 ? `／失敗${失}` : ""}）`;
  } catch (e) {
    btn.textContent = "失敗：" + e.message;
  } finally {
    setTimeout(() => { btn.disabled = false; btn.textContent = orig; }, 4000);
  }
}

// 選んだ架電先を、他の（既存の）リストへそのまま移す窓
async function openMoveTargets(ids) {
  const idList = (ids || []).map(String).filter(Boolean);
  if (!idList.length) return;
  const m = openModal(`選んだ ${idList.length}件 を他のリストへ移す`, `
    <div class="kc-move">
      <p class="note">選んだ架電先を、下で選んだ<b>既存のリスト</b>へそのまま移します（コピーではなく移動。元のリストからは外れます）。担当は、移行先リストの持ち主に付け替わります。</p>
      <label style="display:block;font-size:13px;margin:6px 0">移行先のリスト
        <select id="kcMoveList" style="display:block;width:100%;margin-top:4px;border:1px solid #e6ece9;border-radius:8px;padding:6px 8px;font-size:13px">
          <option value="">読み込んでいます…</option>
        </select>
      </label>
      <div class="kc-modal-foot">
        <button type="button" class="btn" id="kcMoveRun">このリストへ移す</button>
        <span class="rev-status" id="kcMoveSt"></span>
      </div>
    </div>`, { wide: true });
  try {
    const d = await (await fetch("/api/calls/lists/all")).json();
    const lists = ((d && d.items) || []).filter((l) => String(l.id) !== String(listId));
    const sel = m.el.querySelector("#kcMoveList");
    sel.innerHTML = `<option value="">選んでください</option>` +
      lists.map((l) => `<option value="${l.id}">${esc(l.name)}${l["持ち主"] ? "（" + esc(String(l["持ち主"]).split("@")[0]) + "）" : ""}${l["件数"] != null ? " ・" + l["件数"] + "件" : ""}</option>`).join("");
  } catch { m.el.querySelector("#kcMoveList").innerHTML = `<option value="">読み込めませんでした</option>`; }

  m.el.querySelector("#kcMoveRun").addEventListener("click", async () => {
    const st = m.el.querySelector("#kcMoveSt");
    const toListId = parseInt(m.el.querySelector("#kcMoveList").value, 10) || 0;
    if (!toListId) { st.textContent = "移行先のリストを選んでください"; return; }
    st.textContent = "移しています…";
    try {
      const r = await fetch("/api/calls/targets/move", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: idList, toListId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "移せませんでした");
      st.textContent = `${d.moved || 0}件を移しました`;
      selectedIds.clear();
      setTimeout(() => { m.close(); loadTable(); loadLists(); }, 1000);
    } catch (e) { st.textContent = "失敗：" + e.message; }
  });
}

// リストの架電先を、他のメンバーへランダムに割り振り直す窓
async function openRedistribute(listId, listName, backEmail, backName) {
  const m = openModal(`他のメンバーに割り振る：${listName || ""}`, `
    <div class="kc-redist">
      <p class="note">このリストの未架電の架電先を、選んだメンバーの<b>すでにあるリスト</b>へ割り振ります（そのメンバーがリストを持っていなければ、新しいリストを作ります）。<b>入れた件数のぶんだけ</b>移り、余りは元のリスト（このリストの持ち主）に残します。件数を入れなかった人がいれば、その人が余りを受け取ります。</p>
      <div class="kc-quick" id="kcRdMembers"><span class="note">メンバーを読み込んでいます…</span></div>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-top:8px">
        <input type="checkbox" id="kcRdAll" /> 架電済みも含めて割り振り直す
      </label>
      <div class="kc-modal-foot">
        <button type="button" class="btn kc-outline" id="kcRdDry">まず試算する</button>
        <button type="button" class="btn" id="kcRdRun">この人たちに割り振る</button>
        <span class="rev-status" id="kcRdSt"></span>
      </div>
      <div id="kcRdPrev" class="note" style="margin-top:6px"></div>
    </div>`, { wide: true });

  try {
    const d = await (await fetch("/api/calls/members")).json();
    const items = (d && d.items) || [];
    m.el.querySelector("#kcRdMembers").innerHTML = items.map((x) =>
      `<div class="kc-plan-row" data-email="${esc(x.email)}" data-name="${esc(x.name)}">
         <button type="button" class="kc-share-b kc-plan-name">${esc(x.name)}</button>
         <input type="number" class="kc-plan-n" min="0" placeholder="件数" />
         <select class="kc-plan-list" title="この人のどのリストへ入れるか"><option value="">追加先を選ぶ…</option></select>
       </div>`).join("");
    m.el.querySelectorAll("#kcRdMembers .kc-plan-row").forEach((row) => {
      row.querySelector(".kc-plan-name").addEventListener("click", async () => {
        row.classList.toggle("on");
        row.querySelector(".kc-plan-name").classList.toggle("on", row.classList.contains("on"));
        const sel = row.querySelector(".kc-plan-list");
        if (row.classList.contains("on") && sel && !sel.dataset.loaded) {
          sel.dataset.loaded = "1";
          try {
            const dd = await (await fetch("/api/calls/lists?member=" + encodeURIComponent(row.dataset.email))).json();
            const lists = (dd && dd.items) || [];
            sel.innerHTML = `<option value="">新しいリストにする</option>` +
              lists.map((l) => `<option value="${l.id}">${esc(l.name)}（${l["全部"]}件）</option>`).join("");
          } catch { sel.innerHTML = `<option value="">新しいリストにする</option>`; }
        }
      });
    });
  } catch { m.el.querySelector("#kcRdMembers").innerHTML = '<span class="note">読み込めませんでした</span>'; }

  const 実行 = async (dryRun) => {
    const st = m.el.querySelector("#kcRdSt");
    const base = String(listName || "リスト").split(" - ")[0];
    const rows2 = [...m.el.querySelectorAll("#kcRdMembers .kc-plan-row.on")].map((r) => ({
      email: r.dataset.email, count: parseInt((r.querySelector(".kc-plan-n") || {}).value, 10) || 0,
      toListId: parseInt((r.querySelector(".kc-plan-list") || {}).value, 10) || 0,
      listName: `${base} - ${r.dataset.name || r.dataset.email.split("@")[0]}`,
    }));
    if (!rows2.length) { st.textContent = "割り振るメンバーを選んでください"; return; }
    st.textContent = dryRun ? "試算しています…" : "割り振っています…";
    try {
      const r = await fetch(`/api/calls/lists/${encodeURIComponent(listId)}/redistribute`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ members: rows2, onlyPending: !m.el.querySelector("#kcRdAll").checked, dryRun }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "できませんでした");
      const nameOf = (e) => e.split("@")[0];
      const 内訳 = Object.entries(d.byMember || {}).map(([e, n]) => `${nameOf(e)} ${n}件`).join("／");
      const jTxt = d["ジャッジ除外"] ? `／ジャッジ ${d["ジャッジ除外"]}件は移しません` : "";
      if (dryRun) {
        st.textContent = "";
        m.el.querySelector("#kcRdPrev").innerHTML =
          `試算：${esc(内訳)}${d.残した ? `／元のリストに残す ${d.残した}件` : ""}${esc(jTxt)}<br>（対象 ${d.total}件中 ${d.割り振った}件を移します）よければ「この人たちに割り振る」を押してください。`;
      } else {
        st.textContent = `${内訳}${d.残した ? `／元に残し ${d.残した}件` : ""}${jTxt} を分けました`;
        setTimeout(() => { m.close(); if (backEmail) asLoadMember(backEmail, backName); }, 1800);
      }
    } catch (e) { st.textContent = "失敗：" + e.message; }
  };
  m.el.querySelector("#kcRdDry").addEventListener("click", () => 実行(true));
  m.el.querySelector("#kcRdRun").addEventListener("click", () => 実行(false));
}

// このリストに追加する：リスト作成タブへ切り替えて、追加先を覚えておく。
// SFレポート／CSVのどちらから読み込んでも、この既存リストに足す（全リスト重複除外・
// クロス商談あり除外・ジャッジ以外は中澤所有への付け替え、はサーバ側でそのまま効く）。
function goAppendToList(id, name) {
  appendTarget = { id, name };
  window.__kcAppend = { id, name };
  const mk = document.querySelector('.kc-ptab[data-ls="make"]');
  if (mk) mk.click();
  renderAppendBanner();
  const pane = document.querySelector('[data-ls-pane="make"]');
  if (pane && pane.scrollIntoView) pane.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderAppendBanner() {
  const pane = document.querySelector('[data-ls-pane="make"]');
  if (!pane) return;
  let bar = document.getElementById("kcAppendBar");
  if (appendTarget) {
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "kcAppendBar";
      bar.className = "kc-append-bar";
      pane.insertBefore(bar, pane.firstChild);
    }
    bar.innerHTML =
      `このリストに追加します：<b>${esc(appendTarget.name)}</b>` +
      `<button type="button" id="kcAppendClear">やめる（新しいリストを作る）</button>`;
    const c = document.getElementById("kcAppendClear");
    if (c) c.onclick = () => { appendTarget = null; window.__kcAppend = null; renderAppendBanner(); };
  } else if (bar) {
    bar.remove();
  }
}

// リストのグループ（中途リスト・新卒リストなど）を作る・直す・消す
async function renderGroups() {
  const box = document.getElementById("kcGrpBox"); if (!box) return;
  await loadGroups();
  box.innerHTML =
    '<div class="kc-grp-h">リストのグループ</div>' +
    '<div class="kc-grp-list">' +
    GROUPS.map((g) => `<span class="kc-grp-chip" data-id="${g.id}" title="${esc(g["リスト名"] || "まだリストが入っていません")}">${esc(g.name)}<i>${g["リスト数"] || 0}</i>` +
      `<button type="button" class="kc-grp-ren" data-id="${g.id}" title="名前を変える">✎</button>` +
      `<button type="button" class="kc-grp-del" data-id="${g.id}" title="消す">✕</button></span>`).join("") +
    '<button type="button" class="kc-grp-add" id="kcGrpAdd">＋ グループを作る</button>' +
    '</div>' +
    '<div class="note">グループを作って、各リストのカードで選ぶと、実績がグループごとにまとまります。数字は入っているリストの数（カーソルを合わせるとリスト名が出ます）。</div>' +
    (GROUPS.some((g) => (g["リスト数"] || 0) > 0)
      ? '<div class="kc-grp-detail">' + GROUPS.filter((g) => (g["リスト数"] || 0) > 0).map((g) =>
          `<div class="kc-grp-line"><b>${esc(g.name)}</b>：${esc(g["リスト名"] || "")}</div>`).join("") + '</div>'
      : "");
  const add = document.getElementById("kcGrpAdd");
  if (add) add.addEventListener("click", async () => {
    const name = prompt("グループの名前（例：中途リスト／新卒リスト）");
    if (!name) return;
    await fetch("/api/calls/groups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    renderGroups();
  });
  box.querySelectorAll(".kc-grp-ren").forEach((b) => b.addEventListener("click", async () => {
    const cur = GROUPS.find((g) => String(g.id) === b.dataset.id);
    const name = prompt("新しい名前", cur ? cur.name : ""); if (!name) return;
    await fetch(`/api/calls/groups/${b.dataset.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    renderGroups();
  }));
  box.querySelectorAll(".kc-grp-del").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("このグループを消します（リストは残ります）。よろしいですか？")) return;
    await fetch(`/api/calls/groups/${b.dataset.id}`, { method: "DELETE" });
    renderGroups();
  }));
}

let GROUPS = [];
async function loadGroups() {
  try { const d = await (await fetch("/api/calls/groups")).json(); GROUPS = d.items || []; } catch { GROUPS = []; }
}
async function asLoadMember(email, name) {
  await loadGroups();
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
          <div class="kc-list-meta">${x.group_name
            ? `<span class="kc-list-chip grp">${esc(x.group_name)}</span>`
            : `<span class="kc-list-chip nogrp">グループ未設定</span>`}</div>
          <div class="kc-list-grp" onclick="event.stopPropagation()">
            <select class="kc-grp-sel" data-list="${x.id}"><option value="">グループなし</option>${
              GROUPS.map((g) => `<option value="${g.id}"${String(x.group_id || "") === String(g.id) ? " selected" : ""}>${esc(g.name)}</option>`).join("")}</select>
          </div>
        </div>`).join("") + '</div>';
      box.querySelectorAll(".kc-grp-sel").forEach((sel) => sel.addEventListener("change", async () => {
        try {
          const r = await fetch(`/api/calls/lists/${sel.dataset.list}/group`, {
            method: "PUT", headers: { "content-type": "application/json" },
            body: JSON.stringify({ groupId: sel.value ? Number(sel.value) : null }),
          });
          if (!r.ok) throw new Error((await r.json()).error || "変えられませんでした");
          say("clStatus", "グループを変えました", 4000);
          const card = sel.closest(".kc-list-card");
          const chip = card ? card.querySelector(".kc-list-chip.grp, .kc-list-chip.nogrp") : null;
          if (chip) {
            const g = GROUPS.find((x2) => String(x2.id) === sel.value);
            chip.textContent = g ? g.name : "グループ未設定";
            chip.className = "kc-list-chip " + (g ? "grp" : "nogrp");
          }
        } catch (e) { alert("できませんでした：" + e.message); }
      }));
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

// アーカイブ／リサイクルのカードを押したら、「かける」に移って、そのまとめビューを開く
function openStageCard(kind, label) {
  callAsMember = "";
  const sel = $("clList");
  if (sel) {
    if (!sel.querySelector(`option[value="${kind}"]`)) {
      const o = document.createElement("option"); o.value = kind; o.textContent = label; sel.appendChild(o);
    }
    sel.value = kind;
    listId = kind;
    rememberListId(kind);
    loadTable();
  }
  document.querySelectorAll(".kc-pane").forEach((el) => { el.hidden = el.dataset.p !== "call"; });
  document.querySelectorAll(".kc-side .side-item").forEach((a) => {
    a.classList.toggle("active", (a.getAttribute("href") || "") === "/kincall");
  });
  history.replaceState(null, "", "/kincall");
}

// カードを押したら「かける」に移り、そのリストを選ぶ
function selectListAndCall(id, member) {
  callAsMember = String(member || "").trim().toLowerCase();
  const sel = $("clList");
  if (sel) {
    sel.value = String(id);
    listId = Number(id) || 0;
    rememberListId(id);   // 選んだリストを覚える
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
    say("asStatus", `${d["配った数"]}件を${d["人数"]}人に配りました${d["ジャッジ除外"] ? `（ジャッジ ${d["ジャッジ除外"]}件は配っていません）` : ""}`, 8000);
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
         ${iAmCloser ? `<button type="button" class="btn kc-outline" id="spToSf" style="margin-left:auto">SFに反映</button>` : ""}
         ${iAmRedistributor ? `<button type="button" class="btn kc-outline" id="spRedist" style="margin-left:8px">他のメンバーに割り振る</button>` : ""}
         ${iAmCloser ? `<button type="button" class="btn" id="spAddMore"${iAmCloser ? ' style="margin-left:8px"' : ''}>＋ このリストに追加</button>` : ""}
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
    if (open) open.addEventListener("click", () => selectListAndCall(listId, memberEmail));

    // クローザー：このリストに、SFレポート／CSVから追加する（リスト作成タブを使う）
    const addMore = $("spAddMore");
    if (addMore) addMore.addEventListener("click", () => goAppendToList(listId, listName));
    const redist = $("spRedist");
    if (redist) redist.addEventListener("click", () => openRedistribute(listId, listName, memberEmail, memberName));
    const toSf = $("spToSf");
    if (toSf) toSf.addEventListener("click", () => runToSf(listId, listName, toSf));

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
// 求人CSV：1行目を見出しとして、会社名で紐づける行の配列に変換する
function recruitCsvRows(text) {
  const src = String(text || "");
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === "," || ch === "\t") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (ch !== "\r") cell += ch;
  }
  row.push(cell); rows.push(row);
  const cells = rows.map((r) => r.map((v) => String(v || "").trim())).filter((r) => r.some((v) => v));
  if (cells.length < 2) return { rows: [], head: [] };
  const head = cells[0];
  let ci = head.findIndex((h) => /企業名|会社名|会社|company/i.test(h));
  if (ci < 0) ci = 0;
  const out = [];
  for (let r = 1; r < cells.length; r++) {
    const line = cells[r];
    const company = String(line[ci] || "").trim();
    if (!company) continue;
    const data = {};
    for (let c = 0; c < head.length; c++) {
      const key = head[c]; const val = (line[c] || "").trim();
      if (!key || c === ci || !val) continue;
      data[key] = val;
    }
    out.push({ company, data });
  }
  return { rows: out, head };
}

function openRecruitImport() {
  const inner =
    `<p class="note" style="margin:0 0 10px">求人情報のCSV（1行目が見出し）を貼り付けるか、ファイルを選んでください。会社名（企業名）で各架電先に紐づけ、かける一覧に列で表示します。もとの見出しをそのまま列名として使います。</p>` +
    `<input type="file" id="rcFile" accept=".csv,text/csv" style="margin-bottom:8px" />` +
    `<textarea id="rcText" placeholder="企業名,担当者名,電話番号,Email,資本金,…,採用人数,掲載終了日" style="width:100%;height:160px;font-size:12px;font-family:monospace"></textarea>` +
    `<div class="modal-actions" style="margin-top:10px"><button type="button" class="btn" id="rcImport">取り込む</button>` +
    `<span class="note" id="rcMsg" style="margin-left:8px"></span></div>`;
  const m = openModal("求人情報を取り込む", inner);
  const fileEl = m.el.querySelector("#rcFile");
  const textEl = m.el.querySelector("#rcText");
  fileEl.addEventListener("change", () => {
    const f = fileEl.files && fileEl.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { textEl.value = String(rd.result || ""); };
    rd.readAsText(f);
  });
  m.el.querySelector("#rcImport").addEventListener("click", async () => {
    const msg = m.el.querySelector("#rcMsg");
    const parsed = recruitCsvRows(textEl.value);
    if (!parsed.rows.length) { msg.textContent = "会社名の入った行が見つかりませんでした。"; return; }
    msg.textContent = `${parsed.rows.length}件を取り込み中…`;
    try {
      const d = await (await fetch("/api/calls/recruit/import", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows: parsed.rows }),
      })).json();
      if (!d.ok) throw new Error(d.error || "取り込めませんでした");
      msg.textContent = `取り込みました：保存 ${d["保存"]}件${d["スキップ"] ? `／スキップ ${d["スキップ"]}件` : ""}（合計 ${d["合計"]}件）`;
      setTimeout(() => { m.close(); loadTable(); }, 1200);
    } catch (e) { msg.textContent = "できませんでした：" + e.message; }
  });
}

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
  // 「架電履歴」列があれば、そこから右の列を、見出しラベル付きで全部まとめてコメントにする。
  const histStart = 見出しっぽい ? head.findIndex((h) => /架電履歴|架電メモ|コール履歴/.test(String(h || ""))) : -1;
  // 最終活動コメント＋その後ろの続き欄を、1つのコメントにまとめる
  const コメントまとめ = (c) => {
    if (histStart >= 0) {
      // 架電履歴以降を、ラベル付き（例「事業部：RI西」）でまとめる
      const parts = [];
      for (let idx = histStart; idx < head.length; idx++) {
        const v = 取る(c, idx).trim();
        if (!v) continue;
        const lbl = String(head[idx] || "").trim();
        parts.push(lbl ? `${lbl}：${v}` : v);
      }
      return parts.join("\n");
    }
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

  // 標準の項目に割り当てなかった列を「_extra」として、見出し名をキーに丸ごと持つ。
  // （かける一覧で自由に列として出せるようにするため）
  const usedCols = new Set([場所.company, 場所.person, 場所.phone, 場所.email, 場所.leadId,
    場所.callDate, 場所.status, 場所.stage, 場所.comment].filter((i) => i >= 0));
  for (const idx of commentTail) usedCols.add(idx);
  for (const cc of callCols) { if (cc.r >= 0) usedCols.add(cc.r); if (cc.c >= 0) usedCols.add(cc.c); }
  if (histStart >= 0) for (let idx = histStart; idx < head.length; idx++) usedCols.add(idx);
  const extraOf = (c) => {
    if (!見出しっぽい) return {};
    const o = {};
    for (let idx = 0; idx < head.length; idx++) {
      if (usedCols.has(idx)) continue;
      const key = String(head[idx] || "").trim();
      const val = 取る(c, idx).trim();
      if (key && val) o[key] = val;
    }
    return o;
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
      _extra: extraOf(c),           // 標準以外の列（見出し名→値）
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

  // メンバーごとの件数（ランダム）や、追加先リストが指定されていれば、行に割り付ける
  const plan = csvPlan();
  const usePlan = plan.length && plan.some((p) => p.count > 0 || p.listId);
  if (csvAddMode) {
    if (!plan.length) { say("追加する人を選んでください"); return; }
    if (plan.some((p) => !p.listId && !p.newList)) { say("選んだ人それぞれの追加先を選んでください（既存リスト、または新しいリストにする）"); return; }
  }
  if (usePlan) applyPlanToRows(rows, plan);

  // 件数が多いと途中で切れるので、少しずつ送る。進み具合も出す。
  const CHUNK = 20;
  const 合計 = { 件数: 0, 見つかった: 0, 新しく作った: 0, とばした: 0, 履歴: 0, 重複除外: 0, 所有者変更: 0, 履歴済み: 0, 作れなかった: 0, 探せなかった: 0, 履歴失敗: 0 };
  const 失敗理由 = new Set();
  let listId = (csvAddMode ? ((plan.find((p) => p.listId) || {}).listId || 0) : 0) || (appendTarget && appendTarget.id) || 0, listName = (appendTarget && appendTarget.name) || "";
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
          ...(csvAddMode ? { addMode: true } : {}),
          ...(($("csvCrossFrom") && $("csvCrossFrom").value) ? { crossFrom: $("csvCrossFrom").value } : {}),
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
            `<td>${esc(x["状態"] || "")}${x["履歴"] ? `／${esc(x["履歴"])}` : ""}${x["まとめ履歴"] ? `／${esc(x["まとめ履歴"])}` : ""}${x["担当者記録"] ? `／${esc(x["担当者記録"])}` : ""}${x["理由"] ? `（${esc(x["理由"])}）` : ""}</td></tr>`).join("") + "</table>";
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
          (csvShareSelected().length ? `　${csvShareSelected().length}人に分けました` : "")
        + (appendTarget ? `（「${appendTarget.name}」に追加しました）` : ""));
      loadLists();
      if (appendTarget) { appendTarget = null; window.__kcAppend = null; renderAppendBanner(); }
    }
  } catch (e) {
    say("失敗：" + e.message);
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
}

// 分ける人の候補（チェックで選ぶ）。押すと件数入力（と、追加時は追加先リスト）が出る。
function csvShareSelected() {
  return [...document.querySelectorAll("#csvShare .kc-plan-row.on")].map((r) => r.dataset.email);
}
// メンバーごとの振り分けプラン：[{email, count, listId, newList, remainder}]
function csvPlan() {
  return [...document.querySelectorAll("#csvShare .kc-plan-row.on")].map((r) => {
    const v = ((r.querySelector(".kc-plan-list") || {}).value) || "";
    return {
      email: r.dataset.email,
      count: Math.max(0, parseInt((r.querySelector(".kc-plan-n") || {}).value, 10) || 0),
      listId: parseInt(v, 10) || 0,
      newList: v === "new",
      remainder: !!(r.querySelector(".kc-plan-rest-cb") && r.querySelector(".kc-plan-rest-cb").checked),
      kincallOnly: !!(r.querySelector(".kc-plan-kc-cb") && r.querySelector(".kc-plan-kc-cb").checked),
    };
  });
}
function csvShareRefresh() {
  const sel = csvShareSelected();
  const n = sel.length;
  const hint = $("csvShareHint");
  if (hint) {
    const plan = csvPlan();
    const 合計 = plan.reduce((a, p) => a + p.count, 0);
    hint.textContent = !n ? "選ばないと、作った人のリストになります"
      : 合計 ? `${n}人に振り分けます（件数の合計 ${合計}件。余りは順番に）`
      : `${n}人に順番に均等で分けます（件数を入れると人ごとの数を指定できます）`;
  }
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
    const 追加モード = csvAddMode || !!(appendTarget && appendTarget.id);
    box.innerHTML = items.map((m) =>
      `<div class="kc-plan-row" data-email="${esc(m.email)}">
         <button type="button" class="kc-share-b kc-plan-name">${esc(m.name)}</button>
         <input type="number" class="kc-plan-n" min="0" placeholder="件数" title="この人に配る件数（空なら均等）" />
         ${追加モード ? `<select class="kc-plan-list" title="この人のどのリストに追加するか"><option value="">追加先を選ぶ…</option></select>` : ""}
         ${追加モード ? `<label class="kc-plan-rest" title="件数を超えた余りを、この人に全部渡す"><input type="checkbox" class="kc-plan-rest-cb" /> 余り</label>` : ""}
         ${追加モード ? `<label class="kc-plan-rest" title="SFを更新せず、kincallのリストだけに保存する（大量でも速い）"><input type="checkbox" class="kc-plan-kc-cb" /> kincallのみ</label>` : ""}
       </div>`
    ).join("");
    box.dataset.filled = "1";
    box.querySelectorAll(".kc-plan-row").forEach((row) => {
      const nameBtn = row.querySelector(".kc-plan-name");
      nameBtn.addEventListener("click", async () => {
        row.classList.toggle("on");
        nameBtn.classList.toggle("on", row.classList.contains("on"));
        // 追加モードで初めて選んだら、その人のリストを読み込む
        const sel = row.querySelector(".kc-plan-list");
        if (row.classList.contains("on") && sel && !sel.dataset.loaded) {
          sel.dataset.loaded = "1";
          try {
            const dd = await (await fetch("/api/calls/lists?member=" + encodeURIComponent(row.dataset.email))).json();
            const lists = (dd && dd.items) || [];
            // 追加でも「新しいリストにする」は出す（余りを受ける人に既存リストが無い場合のため）。
            // ※かたまりごとの重複作成は修正済みで、同名・同持ち主なら1つに使い回す。
            sel.innerHTML = `<option value="">追加先を選ぶ…</option><option value="new">新しいリストにする</option>` +
              lists.map((l) => `<option value="${l.id}">${esc(l.name)}（${l["全部"]}件）</option>`).join("");
          } catch { sel.innerHTML = `<option value="">読み込めませんでした</option>`; }
        }
        csvShareRefresh();
      });
      row.querySelector(".kc-plan-n").addEventListener("input", csvShareRefresh);
    });
    const clr = $("csvShareClear");
    if (clr) clr.addEventListener("click", () => {
      box.querySelectorAll(".kc-plan-row.on").forEach((r) => { r.classList.remove("on"); const b = r.querySelector(".kc-plan-name"); if (b) b.classList.remove("on"); });
      csvShareRefresh();
    });
    csvShareRefresh();
  } catch { box.innerHTML = '<span class="note">読み込めませんでした</span>'; }
}

// 件数プランに従って、行に「担当」と「追加先リスト」をランダムに割り付ける
function applyPlanToRows(rows, plan) {
  const idx = rows.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  let pos = 0;
  const tag = (row, p) => {
    row.assignedTo = p.email;
    if (p.newList) { row.newListFor = p.email; row.targetList = 0; }
    else if (p.listId) { row.targetList = p.listId; }
    if (p.kincallOnly) row.kincallOnly = true;
  };
  // まず、指定件数ぶんを各メンバーへ
  for (const p of plan) for (let k = 0; k < p.count && pos < idx.length; k++, pos++) tag(rows[idx[pos]], p);
  // 余りは、「余り」に指定した人へ。指定が無ければ、選んだ人へ順番に。
  const rest = plan.filter((p) => p.remainder);
  const 配り先 = rest.length ? rest : plan;
  let r = 0;
  while (pos < idx.length && 配り先.length) { tag(rows[idx[pos]], 配り先[r % 配り先.length]); pos++; r++; }
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

// CSV：作成する／追加する の切り替え
(function wireCsvModeTabs() {
  const tabs = document.getElementById("csvModeTabs");
  if (!tabs) return;
  tabs.addEventListener("click", (ev) => {
    const b = ev.target && ev.target.closest ? ev.target.closest(".kc-ptab") : null;
    if (!b) return;
    csvAddMode = (b.dataset.csvmode === "add");
    tabs.querySelectorAll(".kc-ptab").forEach((x) => x.classList.toggle("active", x === b));
    // 分ける人の枠を作り直して、追加先リストの選択を出す／消す
    const box = document.getElementById("csvShare");
    if (box) { delete box.dataset.filled; box.innerHTML = '<span class="note">読み込んでいます…</span>'; }
    csvFillShare();
    const nameInput = document.getElementById("csvName");
    if (nameInput && nameInput.closest("label")) nameInput.closest("label").style.opacity = csvAddMode ? ".4" : "";
    const hint = document.getElementById("csvShareHint");
    if (hint && csvAddMode) hint.textContent = "追加する人を選び、それぞれの追加先リストと件数を指定してください";
    else if (hint) csvShareRefresh();
    const runBtn = document.getElementById("csvRun");
    if (runBtn) runBtn.textContent = csvAddMode ? "この内容で追加する" : "この内容でリストを作る";
  });
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
    // 週の見出しを「MM/DD〜MM/DD（月〜金）」にする。渡ってくるのは月曜の日付。
    const 週ラベル = (monday) => {
      const m = new Date(String(monday) + "T00:00:00Z");
      if (isNaN(m.getTime())) return String(monday || "").slice(5).replace("-", "/");
      const fri = new Date(m.getTime() + 4 * 86400000);
      const f = (dt) => `${String(dt.getUTCMonth() + 1).padStart(2, "0")}/${String(dt.getUTCDate()).padStart(2, "0")}`;
      return `${f(m)}〜${f(fri)}`;
    };

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
            <tr><th>週</th>${x["週"].map((w) => `<th class="an-n">${週ラベル(w["週"])}</th>`).join("")}</tr>
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

// SFの所有者を優先（担当のバッティング解消）。ONにするとSF監査でSFのリード所有者に担当をそろえる。
(function wireSfOwnerPref() {
  const cb = document.getElementById("clSfOwnerPref");
  if (!cb) return;
  fetch("/api/calls/sf-owner-priority").then((r) => r.json())
    .then((d) => { cb.checked = !!(d && d.enabled); }).catch(() => {});
  cb.addEventListener("change", async () => {
    try {
      const d = await (await fetch("/api/calls/sf-owner-priority", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: cb.checked }),
      })).json();
      if (d && d.error) throw new Error(d.error);
      if (typeof say === "function") say("clStatus", cb.checked
        ? "SFの所有者を優先します（SF監査でkincallの担当をSFのリード所有者に自動でそろえます）"
        : "SFの所有者の優先をやめました（担当は変えず、状態だけ反映します）", 7000);
    } catch (e) {
      cb.checked = !cb.checked;
      if (typeof say === "function") say("clStatus", "設定を保存できませんでした：" + e.message, 7000);
    }
  });
})();
