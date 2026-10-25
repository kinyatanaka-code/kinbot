// kinXs 更新管理（更新月×更新確度）
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const RANKS = [["S", "更新確定"], ["A", "更新予定"], ["B", "検討中"], ["C", "解約検討"], ["Z", "未アプローチ"], ["F", "解約企業"]];
let data = null;
async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { "content-type": "application/json" }, ...opts });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `エラー（${r.status}）`);
  return d;
}
// CS担当は苗字だけにそろえる（「鶴川」「鶴川 夏海」「久野沙織」などが混ざっていても、同じ人は1つに）
function kxSurnameMap(names) {
  const base = (n) => String(n || "").normalize("NFKC").trim().split(/[\s　]+/)[0];
  const bases = [...new Set(names.map(base).filter(Boolean))].sort((a, b) => a.length - b.length);
  const map = new Map();
  for (const n of names) {
    const b = base(n); if (!b) continue;
    const shorter = bases.find((x) => x !== b && x.length >= 2 && b.startsWith(x));
    map.set(n, shorter || (b.length >= 4 && /^[\p{Script=Han}]{2}/u.test(b) && !/[\s　]/.test(String(n).trim()) ? b.slice(0, 2) : b));
  }
  return map;
}
let kxSur = new Map();
const kxSurname = (n) => (n ? (kxSur.get(n) || String(n).normalize("NFKC").trim().split(/[\s　]+/)[0]) : "");
// 検索：入れた文字を含む会社を全部出す（大文字・小文字、カタカナ・ひらがな、全角・半角、空白・記号の違いは気にしない。空白で区切ると全部を含むもの）
function kxNormQ(t) {
  return String(t || "").normalize("NFKC").toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s・\-ー‐－_.,，、。()（）「」『』【】\[\]'"’”&＆/／]/g, "");
}
function kxMatch(qRaw, ...fields) {
  const terms = String(qRaw || "").normalize("NFKC").split(/[\s　]+/).map(kxNormQ).filter(Boolean);
  if (!terms.length) return true;
  const hay = kxNormQ(fields.flat().filter(Boolean).join(" "));
  return terms.every((t) => hay.includes(t));
}
const ymLabel = (ym) => ym ? `${ym.slice(0, 4)}/${ym.slice(5, 7)}` : "未定";
function addMonths(ym, n) { const d = new Date(`${ym}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); }
async function load() {
  try { data = await api("/api/kinxs/renewals"); render(); }
  catch (e) { $("kxTable").innerHTML = `<div class="kx-empty">読み込めませんでした：${esc(e.message)}</div>`; }
}
function render() {
  const d = data; if (!d) return;
  if ($("kxDays")) $("kxDays").textContent = d.warnDays;
  // CS担当の選択肢
  const sel = $("kxCs"), cur = sel.value;
  kxSur = kxSurnameMap(d.items.map((x) => x.cs).filter(Boolean));
  const css = [...new Set(d.items.map((x) => kxSurname(x.cs)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
  sel.innerHTML = `<option value="">CS担当：全員</option>` + css.map((c) => `<option ${c === cur ? "selected" : ""}>${esc(c)}</option>`).join("") + `<option value="__none" ${cur === "__none" ? "selected" : ""}>CS担当：未定</option>`;
  const q = $("kxQ").value || "";
  const items = d.items.filter((x) => kxMatch(q, x.name, x.cs, x.fs, x.products) && (!sel.value || (sel.value === "__none" ? !x.cs : kxSurname(x.cs) === sel.value)));
  // KPI（90日以内）
  const near = items.filter((x) => x.left != null && x.left >= -31 && x.left <= d.warnDays && x.rank !== "F");
  const warn = near.filter((x) => x.warn);
  const kpis = [
    { l: "3か月以内に更新月", v: `${near.length}社`, s: `今日から${d.warnDays}日以内に更新月が来る会社（解約企業を除く）。うち確度B以下 ${warn.length}社` },
    { l: "うち要注意（確度B以下）", v: `${warn.length}社`, s: `未アプローチ（Z）が ${warn.filter((x) => x.rank === "Z").length}社`, st: "color:#7A3300" },
    { l: "うち更新確定・予定（S・A）", v: `${near.filter((x) => ["S", "A"].includes(x.rank)).length}社`, s: `3か月以内に更新月が来る ${near.length}社のうち、確度がSかA`, st: "color:#0A5440" },
    { l: "解約検討（C）", v: `${items.filter((x) => x.rank === "C").length}社`, s: items.filter((x) => x.rank === "C").slice(0, 2).map((x) => x.name).join("・") || "—", st: "color:#8C1F1F" },
  ];
  $("kxKpis").innerHTML = kpis.map((k) => `<div class="kx-kpi" title="${esc(k.s)}"><div class="l">${esc(k.l)}</div><div class="v" style="${k.st || ""}">${esc(k.v)}</div><div class="s">${esc(k.s)}</div></div>`).join("");
  // ===== 案2：月ごとの行に、会社をチップで並べる =====
  const flt = window.__kxFilter || "all";
  const myName = window.__kxMe || "";
  // 確度で絞る（凡例の S〜F を押す。複数選べる、もう一度押すと外す）
  const rsel = window.__kxRanks || new Set();
  const shown = items.filter((x) => (flt === "all" ? true : flt === "warn" ? x.warn : flt === "mine" ? (myName && String(x.cs || "").replace(/\s/g, "").includes(myName.replace(/\s/g, ""))) : flt === "Z" ? x.rank === "Z" : true) && (!rsel.size || rsel.has(x.rank)));
  // 更新月を過ぎた会社も、いつも出す（いちばん古い更新月から）
  const start = [items.map((x) => x.renew).filter(Boolean).sort()[0], addMonths(d.thisMonth, -1)].filter(Boolean).sort()[0];
  const months = []; for (let m = start; m <= addMonths(d.thisMonth, 12); m = addMonths(m, 1)) months.push(m);
  const noMonth = shown.filter((x) => !x.renew);
  const rows = months.map((m) => ({ m, list: shown.filter((x) => x.renew === m) })).filter((r) => r.list.length || (r.m >= d.thisMonth && r.m <= addMonths(d.thisMonth, 3)));
  const rankOrder = { S: 0, A: 1, B: 2, C: 3, Z: 4, F: 5 };
  const chip = (x) => `<button type="button" class="kx-chipco ${x.warn ? "warn" : ""}" draggable="true" data-id="${esc(x.id)}" title="${esc(`${x.name}\nCS ${kxSurname(x.cs) || "未定"}${x.estimated ? "・終了日は推定" : ""}\n押すと詳細／ドラッグで確度・更新月を変える／右クリックで確度を選ぶ`)}"><span class="kx-rank r-${x.rank}">${x.rank}</span>${esc(x.name)}${x.warn ? '<i class="dot" aria-label="要注意"></i>' : ""}</button>`;
  const rowHtml = (m, list, label, dl, cls) => `<div class="kx-mrow ${cls}" data-month="${esc(m || "")}">
      <div class="kx-mhead"><b>${esc(label)}</b><div class="d">${esc(dl)}</div><div class="n">${list.length}社</div></div>
      <div class="kx-chips2">${list.sort((a, b) => (rankOrder[a.rank] - rankOrder[b.rank]) || a.name.localeCompare(b.name, "ja")).map(chip).join("") || '<span class="kx-note">この月の会社はありません</span>'}</div></div>`;
  const body = rows.map((r) => {
    const left = Math.round((Date.parse(`${r.m}-01T00:00:00+09:00`) - Date.now()) / 86400000);
    const isNow = r.m === d.thisMonth;
    const cls = isNow ? "now" : left < 0 ? "past" : left <= d.warnDays ? "warn" : "";
    return rowHtml(r.m, r.list, ymLabel(r.m), isNow ? "今月" : left < 0 ? `${-left}日過ぎ` : `あと${left}日`, cls);
  }).join("") + (noMonth.length ? rowHtml("", noMonth, "未定", "契約終了日が無い", "past") : "");
  const fcount = { warn: items.filter((x) => x.warn).length, all: items.length, Z: items.filter((x) => x.rank === "Z").length, mine: myName ? items.filter((x) => String(x.cs || "").replace(/\s/g, "").includes(myName.replace(/\s/g, ""))).length : 0 };
  const fbtn = (k, t) => `<button type="button" class="kx-chip ${flt === k ? "on" : ""}" data-flt="${k}">${t} ${fcount[k]}</button>`;
  const rcount = {}; for (const x of items) rcount[x.rank] = (rcount[x.rank] || 0) + 1;
  const legend = RANKS.map(([k, l]) => `<button type="button" class="kx-drop ${rsel.has(k) ? "on" : ""} ${rsel.size && !rsel.has(k) ? "dim" : ""}" data-rank-drop="${k}" data-rank-pick="${k}" aria-pressed="${rsel.has(k)}" title="押すと確度${k}の会社だけを出します（もう一度押すと外す）。会社をここにドラッグすると確度${k}になります"><span class="kx-rank r-${k}">${k}</span>${esc(l)}<span class="kx-rc">${rcount[k] || 0}</span></button>`).join("")
    + (rsel.size ? `<button type="button" class="kx-chip" data-rank-clear style="height:28px">確度の絞り込みを外す</button>` : "");
  $("kxTable").innerHTML = d.items.length ? `<div class="kx-legend">${legend}<span class="kx-note" style="color:#7A3300;font-weight:700"><i class="dot"></i> 要注意</span></div>
    <div class="kx-fbar">${fbtn("all", "すべて")}${fbtn("warn", "要注意だけ")}${myName ? fbtn("mine", "自分の担当") : ""}${fbtn("Z", "未アプローチ")}</div>
    <div class="kx-mrows">${body || '<div class="kx-empty">当てはまる会社がありません</div>'}</div>` : `<div class="kx-empty">まだ会社がありません。「SFから取り込み直す」を押すと、申込書回収（06）以降の、空間デザイン制作かアチコチバースの商談から取り込みます。</div>`;
  const box = $("kxTable");
  kxFitRows();
  box.querySelectorAll("[data-flt]").forEach((b) => b.addEventListener("click", () => { window.__kxFilter = b.dataset.flt; render(); }));
  box.querySelectorAll("[data-rank-pick]").forEach((b) => b.addEventListener("click", () => {
    const set = window.__kxRanks || (window.__kxRanks = new Set());
    const k = b.dataset.rankPick; if (set.has(k)) set.delete(k); else set.add(k); render();
  }));
  const rc = box.querySelector("[data-rank-clear]"); if (rc) rc.addEventListener("click", () => { window.__kxRanks = new Set(); render(); });
  box.querySelectorAll(".kx-chipco").forEach((b) => {
    b.addEventListener("click", () => openDetail(b.dataset.id));
    b.addEventListener("contextmenu", (e) => { e.preventDefault(); kxRankMenu(b.dataset.id, e.clientX, e.clientY); });
    b.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", b.dataset.id); e.dataTransfer.effectAllowed = "move"; b.classList.add("dragging"); document.body.classList.add("kx-dragging"); });
    b.addEventListener("dragend", () => { b.classList.remove("dragging"); document.body.classList.remove("kx-dragging"); box.querySelectorAll(".over").forEach((x) => x.classList.remove("over")); });
  });
  const dropOn = (el, fn) => {
    el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("over"); });
    el.addEventListener("dragleave", () => el.classList.remove("over"));
    el.addEventListener("drop", async (e) => { e.preventDefault(); el.classList.remove("over"); const id = e.dataTransfer.getData("text/plain"); if (id) await fn(id); });
  };
  box.querySelectorAll("[data-rank-drop]").forEach((el) => dropOn(el, (id) => kxSetRank(id, el.dataset.rankDrop)));
  box.querySelectorAll(".kx-mrow[data-month]").forEach((el) => dropOn(el, async (id) => {
    const m = el.dataset.month; const x = d.items.find((i2) => i2.id === id);
    if (!m || !x || x.renew === m) return;
    if (!confirm(`「${x.name}」の更新月を ${ymLabel(m)} にしますか？（手で決めた更新月になり、SFの取り込みで上書きしません）`)) return;
    try { await api(`/api/kinxs/accounts/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ renew_month: m, renew_locked: true }) }); await load(); } catch (er) { alert(er.message); }
  }));

  const f = d.fields || {};
  $("kxFoot").textContent = `全${d.items.length}社。契約終了日は${f.end ? `SFの「${f.end}」から取っています。` : "SFの商談に値の入った項目が見つからないので、計上日から1年で推定しています（カードに「終了日は推定」と出ます）。"}${d.sync ? `　最後に取り込んだ時刻：${new Date(d.sync.at).toLocaleString("ja-JP")}` : ""}`;
}
// 更新管理：画面は止めて、月ごとの行（会社のチップ）のところだけをスクロールする
function kxFitRows() {
  const el = document.querySelector("#kxTable .kx-mrows");
  if (!el || VIEW !== "renew") return;
  const top = el.getBoundingClientRect().top;
  el.style.maxHeight = `${Math.max(220, window.innerHeight - top - 18)}px`;
  el.style.overflowY = "auto";
  document.documentElement.style.overflow = "hidden";   // ページ全体はスクロールしない
}
// ユーザー一覧：画面は止めて、カードのところだけスクロールする
function kxFitCards() {
  const el = $("lsTable");
  if (!el || VIEW !== "list") return;
  const top = el.getBoundingClientRect().top;
  el.style.maxHeight = `${Math.max(220, window.innerHeight - top - 16)}px`;
  el.style.overflowY = "auto";
  el.style.overscrollBehavior = "contain";
  el.style.paddingRight = "4px";
  document.documentElement.style.overflow = "hidden";
}
window.addEventListener("resize", () => { kxFitRows(); kxFitCards(); });
async function kxSetRank(id, rank) {
  const x = data && data.items.find((i) => i.id === id);
  if (!x || x.rank === rank) return;
  try { await api(`/api/kinxs/accounts/${encodeURIComponent(id)}/rank`, { method: "PUT", body: JSON.stringify({ rank }) }); x.rank = rank; await load(); }
  catch (e) { alert(e.message); }
}
function kxRankMenu(id, x, y) {
  document.querySelectorAll(".kx-ctx").forEach((m) => m.remove());
  const m = document.createElement("div"); m.className = "kx-ctx";
  m.style.left = `${Math.min(x, innerWidth - 200)}px`; m.style.top = `${Math.min(y, innerHeight - 260)}px`;
  m.innerHTML = `<div class="kx-note" style="padding:4px 8px">確度を変える</div>` + RANKS.map(([k, l]) => `<button type="button" data-r="${k}"><span class="kx-rank r-${k}">${k}</span>${esc(l)}</button>`).join("") + `<button type="button" data-open>詳細を開く</button>`;
  document.body.appendChild(m);
  const off = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener("mousedown", off); } };
  setTimeout(() => document.addEventListener("mousedown", off), 0);
  m.querySelectorAll("[data-r]").forEach((b) => b.addEventListener("click", () => { m.remove(); kxSetRank(id, b.dataset.r); }));
  m.querySelector("[data-open]").addEventListener("click", () => { m.remove(); openDetail(id); });
}
async function openCo(id) {
  const x = data.items.find((i) => i.id === id); if (!x) return;
  let hist = [];
  try { hist = (await api(`/api/kinxs/accounts/${encodeURIComponent(id)}/history`)).items || []; } catch {}
  const bg = document.createElement("div"); bg.className = "kx-drawer-bg";
  bg.innerHTML = `<aside class="kx-drawer" role="dialog" aria-label="${esc(x.name)}">
    <div style="display:flex;align-items:flex-start;gap:10px"><h2>${esc(x.name)}</h2><button type="button" class="kx-btn" data-x style="margin-left:auto" aria-label="閉じる">閉じる</button></div>
    ${x.warn ? `<div class="kx-sec" style="background:#FFF7EA;border-color:#F0D5B0;color:#6B3700;font-weight:700;font-size:13px">要注意：更新月接近（${esc(ymLabel(x.renew))}・あと${x.left}日・確度${esc(x.rank)}）</div>` : ""}
    <div class="kx-sec"><div class="lb">更新確度</div><div class="kx-ranks">${RANKS.map(([k, l]) => `<button type="button" class="r-${k} ${x.rank === k ? "on" : ""}" data-rank="${k}" title="${esc(l)}" aria-label="${k} ${esc(l)}">${k}</button>`).join("")}</div>
      <div class="kx-note" style="margin-top:6px" data-st>${x.rankAt ? `${new Date(x.rankAt).toLocaleString("ja-JP")} に ${esc(x.rankBy)} が変更` : "まだ付けていません（Z＝未アプローチ）"}</div></div>
    <div class="kx-sec kx-kv"><span>更新月</span><span>${esc(ymLabel(x.renew))}${x.left != null ? `（${x.left < 0 ? `${-x.left}日過ぎ` : `あと${x.left}日`}）` : ""}</span>
      <span>契約終了</span><span>${esc(x.end || "—")}${x.estimated ? "（計上日から推定）" : ""}</span><span>計上日</span><span>${esc(x.booked || "—")}</span>
      <span>契約商品</span><span>${x.products.map(esc).join("<br>") || "—"}</span><span>CS担当</span><span>${esc(x.cs || "未定")}</span><span>FS担当</span><span>${esc(x.fs || "—")}</span></div>
    <div class="kx-sec"><div class="lb">変更の履歴</div><div class="kx-hist">${hist.length ? hist.map((h) => `<div>${esc(new Date(h.at).toLocaleString("ja-JP"))}　更新確度 ${esc(h.from_v || "—")} → <b>${esc(h.to_v)}</b>（${esc(h.by_user || "")}${h.auto ? "・自動" : ""}）</div>`).join("") : "まだありません"}</div></div>
    <a class="kx-btn" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none" href="https://neo-media.my.salesforce.com/lightning/r/Account/${encodeURIComponent(x.id)}/view" target="_blank" rel="noopener">SFの取引先を開く ↗</a>
  </aside>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
  bg.querySelector("[data-x]").addEventListener("click", close);
  bg.querySelectorAll("[data-rank]").forEach((b) => b.addEventListener("click", async () => {
    const st = bg.querySelector("[data-st]");
    try {
      await api(`/api/kinxs/accounts/${encodeURIComponent(id)}/rank`, { method: "PUT", body: JSON.stringify({ rank: b.dataset.rank }) });
      st.textContent = `更新確度を ${b.dataset.rank} にしました`;
      bg.querySelectorAll("[data-rank]").forEach((x2) => x2.classList.toggle("on", x2 === b));
      await load();
    } catch (e) { st.textContent = "変えられませんでした：" + e.message; }
  }));
}
$("kxQ").addEventListener("input", render);
$("kxCs").addEventListener("change", render);
if ($("kxPast")) $("kxPast").addEventListener("change", render);
$("kxSync").addEventListener("click", async () => {
  const b = $("kxSync"); b.disabled = true; $("kxSt").textContent = "SFから取り込んでいます…（1〜2分かかることがあります）";
  try { const r = (await api("/api/kinxs/sync", { method: "POST" })).result || {}; $("kxSt").textContent = `取り込みました：新しく ${r.added || 0}社・更新 ${r.updated || 0}社${r.removed ? `・対象外で外した ${r.removed}社` : ""}${(r.errors || []).length ? `・エラー ${r.errors.join("／")}` : ""}`; await load(); }
  catch (e) { $("kxSt").textContent = "取り込めませんでした：" + e.message; }
  b.disabled = false;
});

// ===== 画面の切りかえ（更新管理／ユーザー一覧）=====
const VIEW = ({ renew: "renew", list: "list", import: "import", cs: "cs", board: "board", settings: "settings" })[new URLSearchParams(location.search).get("p")] || "renew";
document.querySelectorAll(".kx-nav[data-view], .kx-side-set[data-view]").forEach((a) => a.classList.toggle("on", a.dataset.view === VIEW));
$("vList").hidden = VIEW !== "list"; $("vRenew").hidden = VIEW !== "renew"; $("vImport").hidden = VIEW !== "import"; $("vCs").hidden = VIEW !== "cs"; $("vBoard").hidden = VIEW !== "board"; $("vSet").hidden = VIEW !== "settings";
// ブラウザのタブは、どの画面でも「kinXs」だけ
document.title = "kinXs";
// ヘッダー：今の画面の名前、画面に合わせたボタン、ログインしている人
$("kxPageName").textContent = ({ settings: "設定", board: "フェーズ別", renew: "更新管理", list: "ユーザー一覧", import: "CS管理ボードから取り込む", cs: "CS連携（回収MTG）" })[VIEW] || "更新管理";
document.querySelectorAll("[data-top-act]").forEach((b) => { b.hidden = !["renew", "list", "board"].includes(VIEW); });
if ($("kxSyncTop")) $("kxSyncTop").hidden = !["renew", "list"].includes(VIEW);
if ($("kxSyncTop")) $("kxSyncTop").addEventListener("click", () => $("kxSync").click());
api("/api/me").then((me) => {
  const n = (me && (me.name || me.email)) || "";
  $("kxMeName").textContent = n; $("kxMeAv").textContent = n ? n.slice(0, 1) : "・"; $("kxMe").title = (me && me.email) || "";
  if ($("kxSideName")) { $("kxSideName").textContent = n; $("kxSideAv").textContent = n ? n.slice(0, 1) : "・"; }
}).catch(() => {});
// 要注意の社数をヘッダーに（押すと、ユーザー一覧の要注意企業へ）
api("/api/kinxs/users").then((u) => {
  const n = ((u && u.items) || []).filter((x) => (x.alerts || []).length).length;
  const c = $("kxTopChip"); if (!c || !n) return;
  c.hidden = false; c.textContent = `要注意 ${n}社`;
  c.addEventListener("click", () => { location.href = "/kinxs?p=list"; });
}).catch(() => {});
if (VIEW === "settings") {
  // kinbotの設定（Google連携・アカウントなど）を、kinXsの中に埋め込んで開く
  $("kxSetFrame").src = "/settings.html?embed=1";
  document.querySelector(".kx-main").style.padding = "14px 16px 0";
}
if (VIEW === "cs") {
  // CS連携は、kinXsの中に埋め込んで開く（kinbotのメニューは出さない）。企業カードを指定されたらそのまま開く
  const bot = new URLSearchParams(location.search).get("bot");
  $("kxCsFrame").src = `/cs.html?embed=1${bot ? `&bot=${encodeURIComponent(bot)}` : ""}`;
  document.querySelector(".kx-main").style.padding = "14px 16px 0";
}

// ===== ユーザー一覧 =====
let lsData = null, lsLabel = "";
const fmtD = (t) => { if (!t) return "—"; const d = new Date(t); return isNaN(d) ? "—" : `${d.getMonth() + 1}/${d.getDate()}`; };
async function loadList() {
  try { lsData = await api("/api/kinxs/users"); renderList(); }
  catch (e) { $("lsTable").innerHTML = `<div class="kx-empty">読み込めませんでした：${esc(e.message)}</div>`; }
}
function renderList() {
  const d = lsData; if (!d) return;
  const sel = $("lsCs"), cur = sel.value;
  kxSur = kxSurnameMap(d.items.map((x) => x.cs).filter(Boolean));
  const css = [...new Set(d.items.map((x) => kxSurname(x.cs)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
  sel.innerHTML = `<option value="">CS担当：全員</option>` + css.map((c) => `<option ${c === cur ? "selected" : ""}>${esc(c)}</option>`).join("") + `<option value="__none" ${cur === "__none" ? "selected" : ""}>CS担当：未定</option>`;
  const q = $("lsQ").value || "";
  const base = d.items.filter((x) => kxMatch(q, x.name, x.cs, x.fs, x.products, x.label) && (!sel.value || (sel.value === "__none" ? !x.cs : kxSurname(x.cs) === sel.value)));
  // ラベルの絞り込み
  const counts = {}; for (const x of base) counts[x.label] = (counts[x.label] || 0) + 1;
  $("lsChips").hidden = true;
  $("lsChips").innerHTML = [["", `すべて ${base.length}`], ...d.labels.filter((l) => counts[l]).map((l) => [l, `${l} ${counts[l]}`])]
    .map(([v, t]) => `<button type="button" class="kx-chip ${lsLabel === v ? "on" : ""}" data-lab="${esc(v)}">${esc(t)}</button>`).join("");
  $("lsChips").querySelectorAll("[data-lab]").forEach((b) => b.addEventListener("click", () => { lsLabel = b.dataset.lab; renderList(); }));
  // 受注日（計上日）が新しい順。日付が無い会社は最後
  const items = base.filter((x) => !lsLabel || x.label === lsLabel).slice().sort((a, b) => String(b.booked || "").localeCompare(String(a.booked || "")) || a.name.localeCompare(b.name, "ja"));
  // 要注意企業（上に固定）
  const al = base.filter((x) => x.alerts.length).sort((a, b) => b.score - a.score);
  $("lsAlerts").innerHTML = `<h2><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9A5B00" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>要注意企業 <span class="kx-note">${al.length}社・上ほど急ぎ</span></h2>` +
    (al.length ? `<div class="kx-alerts">${al.slice(0, 12).map((x) => `<div class="kx-al">
      <div style="display:flex;align-items:center;gap:8px"><button type="button" class="n" data-open="${esc(x.id)}">${esc(x.name)}</button><span class="kx-rank r-${x.rank}" style="margin-left:auto">${x.rank}</span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${x.alerts.map((a) => `<span class="kx-rule">${esc(a.rule)}</span>`).join("")}</div>
      <div class="kx-note">${x.alerts.map((a) => esc(a.detail)).join("／")}</div>
      <div style="display:flex;align-items:center;gap:8px" class="kx-note">CS ${esc(kxSurname(x.cs) || "未定")}<button type="button" class="kx-btn" style="height:30px;font-size:11.5px;margin-left:auto" data-dis="${esc(x.id)}" data-rule="${esc(x.alerts.map((a) => a.rule).join(","))}">対応済みにする</button></div>
    </div>`).join("")}</div>${al.length > 12 ? `<div class="kx-note" style="margin-top:8px">ほか ${al.length - 12}社</div>` : ""}` : `<div class="kx-note">いま要注意の会社はありません</div>`);
  // 会社のカード（シンプルに：会社名・ラベル・確度・CS・更新月・次回アクション）
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  // 会社名だけのカード（詳細は押すと開くモーダルで）
  // 会社名だけのカード（左の色はフェーズ、頭文字のマーク）
  const PH = { "計上予定": "#7C8AA5", "フォローMTG設定中": "#E0A100", "フォローMTG設定済": "#3F72C9", "オンボーディング中": "#7A55C7", "利用中": "#1D9E75", "更新検討時期": "#E07A1F", "解約予定": "#C43D3D", "解約済み": "#3A3F3D", "キャンセル": "#9AA5A0", "エラー": "#A51F16" };
  const mono = (n) => { const t = String(n || "").normalize("NFKC").replace(/株式会社|有限会社|合同会社|一般社団法人|公益社団法人|一般財団法人|社会福祉法人|医療法人社団|医療法人|学校法人|\(株\)|（株）|[\s　]/g, ""); return t.slice(0, 1) || "・"; };
  // ロゴ（会社のHPから）があれば白い四角に、読めなければ頭文字
  const card = (x) => `<div class="kx-uc kx-uc-lux" style="--accent:${PH[x.label] || "#1D9E75"}" data-open="${esc(x.id)}" role="button" tabindex="0" title="${esc(`${x.name}（${x.label}）`)}">${x.logo
      ? `<span class="mono logo" aria-hidden="true"><img src="${esc(x.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.remove('logo');this.parentNode.textContent='${esc(mono(x.name)).replace(/'/g, "")}'"></span>`
      : `<span class="mono" aria-hidden="true">${esc(mono(x.name))}</span>`}<div class="nm">${esc(x.name)}</div></div>`;
  const lsTab = window.__lsTab || "all";
  document.querySelectorAll("[data-lstab]").forEach((b) => b.classList.toggle("on", b.dataset.lstab === lsTab));
  if (lsTab === "cs") {
    // 担当別：CS担当ごとの列。カードを別の列にドラッグすると、その人の担当になる
    const sur = (n) => kxSurname(n);
    const opts = [...new Set((d.csOptions || []).filter(Boolean))];
    const cols = opts.map((o) => ({ name: o, key: sur(o), list: [] }));
    const none = { name: "", key: "", list: [] };
    for (const x of items) {
      const k = sur(x.cs);
      if (!k) { none.list.push(x); continue; }
      let c = cols.find((c2) => c2.key === k);
      if (!c) { c = { name: x.cs, key: k, list: [] }; cols.push(c); }
      c.list.push(x);
    }
    const colHtml = (c, isNone) => `<section class="kx-cscol${isNone ? " none" : ""}" data-cscol="${esc(c.name)}"><div class="kx-cscol-h"><span class="av">${isNone ? "？" : esc(c.key.slice(0, 1))}</span><b>${isNone ? "未定" : esc(c.key)}</b><span class="n">${c.list.length}</span></div><div class="kx-cscol-b">${c.list.map((x) => card(x).replace('<div class="kx-uc ', '<div draggable="true" class="kx-uc ')).join("") || '<div class="kx-note" style="padding:6px 2px">ここにカードを動かすと、この人の担当になります</div>'}</div></section>`;
    $("lsTable").innerHTML = `<div class="kx-csboard">${colHtml(none, true)}${cols.map((c) => colHtml(c, false)).join("")}</div>`;
    kxFitCards();
    const board = $("lsTable").querySelector(".kx-csboard");
    // 画面は止めて、列ごとにスクロール
    $("lsTable").style.overflowY = "hidden";
    board.style.height = `${Math.max(260, window.innerHeight - board.getBoundingClientRect().top - 16)}px`;
    board.querySelectorAll("[data-open]").forEach((c) => {
      c.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", c.dataset.open); c.classList.add("dragging"); });
      c.addEventListener("dragend", () => { c.classList.remove("dragging"); board.querySelectorAll(".over").forEach((x) => x.classList.remove("over")); });
    });
    board.querySelectorAll("[data-cscol]").forEach((col) => {
      col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("over"); });
      col.addEventListener("dragleave", (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove("over"); });
      col.addEventListener("drop", async (e) => {
        e.preventDefault(); col.classList.remove("over");
        const id = e.dataTransfer.getData("text/plain"); const x = d.items.find((i2) => i2.id === id);
        const to = col.dataset.cscol;
        if (!x || sur(x.cs) === sur(to)) return;
        try { await api(`/api/kinxs/accounts/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ cs_name: to }) }); x.cs = to; renderList(); }
        catch (er) { alert(er.message); }
      });
    });
  } else {
    $("lsTable").style.overflowY = "";
    $("lsTable").innerHTML = items.length ? `<div class="kx-ucards">${items.map(card).join("")}</div>` : `<div class="kx-empty">${d.items.length ? "当てはまる会社がありません" : "まだ会社がありません。「SFから取り込み直す」か「＋ ユーザーを追加」で入れられます。"}</div>`;
    kxFitCards();
  }
  document.querySelectorAll("#vList [data-open]").forEach((el) => el.addEventListener("click", () => openDetail(el.dataset.open)));
  document.querySelectorAll("#vList [data-dis]").forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    try { for (const rule of b.dataset.rule.split(",")) await api(`/api/kinxs/accounts/${encodeURIComponent(b.dataset.dis)}`, { method: "PUT", body: JSON.stringify({ dismiss: rule }) }); await loadList(); }
    catch (er) { alert(er.message); }
  }));
  $("lsSt").textContent = `全${d.items.length}社`;
}
$("lsQ").addEventListener("input", renderList);
document.querySelectorAll("[data-lstab]").forEach((b) => b.addEventListener("click", () => { window.__lsTab = b.dataset.lstab; renderList(); }));
$("lsCs").addEventListener("change", renderList);

// ===== 企業詳細（どちらの画面からも開く）=====
// ① 企業情報（HP・住所・電話・担当者／受注日・受注者／ヘルプサイト／DOCのURL：VR・AI）
function kxCoPane(d) {
  const f = d.info || {}; const src = f.source || {};
  const tag = (k) => (src[k] ? `<span class="kx-src">${esc(src[k])}</span>` : "");
  const href = (u) => (/^https?:/.test(u) ? u : `https://${u}`);
  const val = (v, kind) => !v ? '<span class="kx-none">未登録</span>' : kind === "url" ? `<a href="${esc(href(v))}" target="_blank" rel="noopener">${esc(String(v).replace(/^https?:\/\//, "").replace(/\/$/, ""))} ↗</a>` : kind === "tel" ? `<a href="tel:${esc(v)}">${esc(v)}</a>` : kind === "mail" ? `<a href="mailto:${esc(v)}">${esc(v)}</a>` : esc(v);
  const contacts = f.contacts || [];
  const pw = (v) => `<span class="kx-pw" data-pw="${esc(v || "")}">••••••••</span><button type="button" class="hp-b" data-pw-show>見る</button><button type="button" class="hp-b" data-copy="${esc(v || "")}">コピー</button>`;
  const head = (t, edit) => `<div class="kx-c2h"><b>${t}</b>${edit ? '<button type="button" class="kx-ed" data-edit>編集</button>' : ""}</div>`;
  return `<div class="kx-co-grid">
    <div class="kx-co-col">
      <section class="kx-c2" data-sec>
        ${head("企業情報", true)}
        <div class="kx-view">
          <div class="kx-dl"><span>HP</span><div>${val(f.website, "url")} ${tag("website")}</div><span>住所</span><div>${val(f.address)} ${tag("address")}</div><span>電話番号</span><div>${val(f.phone, "tel")} ${tag("phone")}</div></div>
        </div>
        <div class="kx-editbox kx-form">
          <label>HP</label><input class="kx-in" data-info="website" value="${esc(f.website || "")}" placeholder="https://" />
          <label>住所</label><input class="kx-in" data-info="address" value="${esc(f.address || "")}" />
          <label>電話番号</label><input class="kx-in" data-info="phone" value="${esc(f.phone || "")}" />
          <div class="kx-edact"><button type="button" class="hp-b" data-cancel>やめる</button><button type="button" class="kx-btn kx-pri" data-save-info>保存</button></div>
        </div>
      </section>
      <section class="kx-c2" data-sec>
        ${head(`先方の担当者 ${tag("contacts")}`, true)}
        <div class="kx-view">${contacts.length ? contacts.map((c) => `<div class="kx-person"><div class="av">${esc((c.name || "？").slice(0, 1))}</div><div style="min-width:0"><div class="nm">${esc(c.name || "（お名前なし）")}${c.title ? `<span>${esc(c.title)}</span>` : ""}</div><div class="ct">${c.phone ? `📞 ${val(c.phone, "tel")}` : ""}${c.email ? `　✉ ${val(c.email, "mail")}` : ""}</div></div></div>`).join("") : '<span class="kx-none">未登録</span>'}</div>
        <div class="kx-editbox">
          <div data-ct-rows>${(contacts.length ? contacts : [{}]).map((c) => `<div class="kx-ct"><input class="kx-in" data-ct="name" value="${esc(c.name || "")}" placeholder="お名前" /><input class="kx-in" data-ct="title" value="${esc(c.title || "")}" placeholder="部署・役職" /><input class="kx-in" data-ct="phone" value="${esc(c.phone || "")}" placeholder="電話番号" /><input class="kx-in" data-ct="email" value="${esc(c.email || "")}" placeholder="メールアドレス" /><button type="button" class="hp-b" data-ct-del>消す</button></div>`).join("")}</div>
          <div class="kx-edact"><button type="button" class="hp-b" data-ct-add style="margin-right:auto">＋ 担当者を追加</button><button type="button" class="hp-b" data-cancel>やめる</button><button type="button" class="kx-btn kx-pri" data-save-info>保存</button></div>
        </div>
      </section>
    </div>
    <div class="kx-co-col">
      <section class="kx-c2">
        ${head("受注")}
        <div class="kx-kpi2"><div><span>受注日</span><b>${f.booked ? esc(f.booked.replace(/-/g, "/")) : "—"}</b></div><div><span>受注者</span><b>${esc(f.bookedBy || "—")}</b></div></div>
      </section>
      <section class="kx-c2">
        ${head("ヘルプサイト")}
        ${f.portal ? `<div class="kx-dl"><span>URL</span><div>${f.portal.url ? `${val(f.portal.url, "url")} <button type="button" class="hp-b" data-copy="${esc(f.portal.url)}">コピー</button>` : '<span class="kx-none">—</span>'}</div>
          <span>企業ID</span><div><b>${esc(f.portal.id || "—")}</b>${f.portal.id ? ` <button type="button" class="hp-b" data-copy="${esc(f.portal.id)}">コピー</button>` : ""}</div>
          <span>パスワード</span><div>${f.portal.pw ? pw(f.portal.pw) : '<span class="kx-none">案内文にありません</span>'}</div></div>`
          : `<span class="kx-none">まだ用意していません（CS連携の企業カードで用意できます）</span>`}
      </section>
      <section class="kx-c2" data-sec>
        ${head("DOC", true)}
        <div class="kx-view"><div class="kx-dl"><span>VR</span><div>${val(f.vrUrl, "url")} ${tag("vrUrl")}</div><span>AI<br><small>候補者画面</small></span><div>${val(f.aiUrl, "url")} ${tag("aiUrl")}</div><span>AI<br><small>管理画面</small></span><div>${val(f.adminUrl || "https://casual-interview-api.brainverse-ai.com/", "url")} <span class="kx-none">（全社共通）</span></div></div></div>
        <div class="kx-editbox kx-form">
          <label>VR（URL）</label><input class="kx-in" data-info="vr_url" value="${esc(f.vrUrl || "")}" placeholder="https://" />
          <label>AI（候補者画面のURL）</label><input class="kx-in" data-info="ai_url" value="${esc(f.aiUrl || "")}" placeholder="https://" />
          <div class="kx-edact"><button type="button" class="hp-b" data-cancel>やめる</button><button type="button" class="kx-btn kx-pri" data-save-info>保存</button></div>
        </div>
        <div class="kx-sub2">AIの管理者のログイン情報</div>
        ${(f.ai || []).length ? f.ai.map((a) => `<div class="kx-acc" data-ai-i="${esc(a.id)}"><div class="lb2">${esc(a.label || "アカウント")}</div><div class="v"><span class="id">${esc(a.login || "—")}</span>${a.login ? `<button type="button" class="hp-b" data-copy="${esc(a.login)}">IDコピー</button>` : ""}</div>${a.has_pass ? `<div class="v"><span class="kx-pw" data-ai-pw>••••••••</span><button type="button" class="hp-b" data-ai-show>見る</button><button type="button" class="hp-b" data-ai-copy>コピー</button></div>` : ""}</div>`).join("")
          : `<span class="kx-none">まだありません（CS連携の企業カードの「AIアカウント」で入れられます）</span>`}
      </section>
    </div>
  </div>`;
}
// ② ステータス（CS担当・利用目的・活用）。フェーズ・次回アクションは下に続く
function kxStatusPane(d) {
  const st = d.status || {};
  const usages = (lsData && lsData.usages) || ["活用：公開掲載", "活用：限定公開", "活用予定", "活用検討中", "不明", "発生済み未納品", "解約企業"];
  return `<div class="kx-sec kx-form"><div class="lb">ステータス</div>
      <label>CS担当</label>${(() => {
        // 選択肢は CSのメンバー。今の担当が選択肢に無い書き方（「鶴川」と「鶴川 夏海」など）なら、苗字が同じ人を選んだ状態に
        const opts = [...new Set((st.csOptions || []).filter(Boolean))];
        const sur = (n) => String(n || "").normalize("NFKC").trim().split(/[\s　]+/)[0];
        let cur = st.cs || "";
        if (cur && !opts.includes(cur)) { const hit = opts.find((o) => sur(o) === sur(cur) || o.startsWith(sur(cur)) || sur(cur).startsWith(sur(o))); if (hit) cur = hit; else opts.push(cur); }
        return `<select class="kx-in" data-st="cs_name"><option value="">（未定）</option>${opts.map((o) => `<option ${o === cur ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
      })()}
      <label>利用目的</label><input class="kx-in" data-st="purpose" value="${esc(st.purpose || "")}" placeholder="例：採用サイト掲載・カジュアル面談" />
      <label>活用</label><div class="kx-usage">${usages.map((u) => `<button type="button" class="kx-us ${st.usage === u ? "on" : ""}" data-usage="${esc(u)}">${esc(u)}</button>`).join("")}</div>
      <div style="grid-column:1 / -1;display:flex;margin-top:6px"><button type="button" class="kx-btn" data-save-status style="margin-left:auto">保存</button></div>
    </div>`;
}
async function openDetail(id, reuse) {
  let d;
  try { d = await api(`/api/kinxs/accounts/${encodeURIComponent(id)}/detail`); } catch (e) { alert(e.message); return; }
  const x = d.item;
  // 保存したあとは、モーダルを閉じずに中身だけ描き直す（開いていたタブ・スクロールの位置もそのまま）
  const bg = (reuse && reuse.bg) || document.createElement("div"); bg.className = "kx-drawer-bg";
  const tog = (key, val, opts) => `<div class="kx-tog" data-tog="${key}">${opts.map(([v, t]) => `<button type="button" data-v="${v}" class="${String(val) === String(v) ? "on" : ""}">${t}</button>`).join("")}</div>`;
  bg.innerHTML = `<aside class="kx-drawer" role="dialog" aria-label="${esc(x.name)}" style="width:min(560px,100%)">
    <div style="display:flex;align-items:flex-start;gap:10px"><div><h2>${esc(x.name)}</h2><div class="kx-note">${esc(x.products.join("・"))}</div></div><button type="button" class="kx-btn" data-x style="margin-left:auto">閉じる</button></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="kx-lab l-${esc(x.label)}">${esc(x.label)}</span><span class="kx-rank r-${x.rank}">${x.rank}</span><span class="kx-note">更新月 ${x.renew ? esc(x.renew.replace("-", "/")) : "—"}${x.left != null ? `（${x.left < 0 ? `${-x.left}日過ぎ` : `あと${x.left}日`}）` : ""}</span></div>
    ${x.alerts.length ? `<div class="kx-sec" style="background:#FFF7EA;border-color:#F0D5B0;color:#6B3700;font-size:12.5px"><b>要注意：</b>${x.alerts.map((a) => `${esc(a.rule)}（${esc(a.detail)}）`).join("／")}</div>` : ""}
    <div class="kx-tabs"><button type="button" class="on" data-tab="co">企業情報</button><button type="button" data-tab="info">ステータス</button><button type="button" data-tab="tl">議事録（${d.timeline.filter((t) => t.kind === "mtg").length}）</button></div>
    <div data-pane="co" style="display:flex;flex-direction:column;gap:12px">${kxCoPane(d)}</div>
    <div data-pane="info" hidden style="display:flex;flex-direction:column;gap:12px">
      ${kxStatusPane(d)}
      <div class="kx-sec"><div class="lb">更新確度</div><div class="kx-ranks">${RANKS.map(([k, l]) => `<button type="button" class="r-${k} ${x.rank === k ? "on" : ""}" data-rank="${k}" title="${esc(l)}" aria-label="${k} ${esc(l)}">${k}</button>`).join("")}</div></div>
      <div class="kx-sec"><div class="lb">フェーズ${x.locked ? "（手で決めています）" : "（自動）"}</div>
        <select class="kx-in" data-label><option value="">自動に任せる（いま：${esc(x.autoLabel)}）</option>${(lsData && lsData.labels || ["計上予定", "フォローMTG設定中", "フォローMTG設定済", "オンボーディング中", "利用中", "更新検討時期", "解約予定", "解約済み", "キャンセル", "エラー"]).map((l) => `<option ${x.locked && x.label === l ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <div class="kx-note" style="margin-top:6px">手で決めると、自動では戻しません（自動に任せるに戻すと、また自動で付きます）</div></div>
      <div class="kx-sec" style="display:grid;grid-template-columns:96px 1fr;gap:8px 10px;align-items:center">
        <span class="kx-note">検収書</span><div>${tog("kenshu_done", x.kenshuDone === true ? true : x.kenshuDone === false ? false : "", [["true", "回収済み"], ["false", "未回収"]])}${x.kenshuDone == null ? `<div class="kx-note" style="margin-top:3px">いま：${esc(x.kenshu)}${x.kenshu.includes("自動") ? "（もう使っている会社なので、完了あつかい）" : ""}</div>` : ""}</div>
        <span class="kx-note">納品メール</span><div>${tog("mail_done", x.mailDone === true ? true : x.mailDone === false ? false : "", [["true", "送付済み"], ["false", "未送付"]])}${x.mailDone == null ? `<div class="kx-note" style="margin-top:3px">いま：${esc(x.mail)}${x.mail.includes("自動") ? "（もう使っている会社なので、完了あつかい）" : ""}</div>` : ""}</div>
        <span class="kx-note">掲載</span>${tog("published", x.published, [["true", "確認した（利用中）"], ["false", "まだ"]])}
      </div>
      <div class="kx-sec"><div class="lb" style="display:flex;align-items:center;gap:8px">次回アクション${x.naSource && x.naSource.startsWith("auto") ? `<span class="kx-auto">${esc(x.naSource.replace("auto:", ""))}から自動で入れました</span>` : ""}<button type="button" class="kx-btn" data-read-na style="margin-left:auto;height:28px;font-size:11.5px">Gmail・議事録から読む</button></div>
        ${x.naSuggest ? `<div class="kx-sug"><div><b>提案</b>（${esc(x.naSuggest.source)}より）${esc(x.naSuggest.type)}・${esc(x.naSuggest.at ? new Date(x.naSuggest.at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "日時なし")}<div style="margin-top:2px">${esc(x.naSuggest.content)}</div>${x.naSuggest.basis ? `<div class="kx-note">根拠：${esc(x.naSuggest.basis)}</div>` : ""}</div><div style="display:flex;gap:6px;flex:none"><button type="button" class="kx-btn" data-adopt>採用する</button><button type="button" class="kx-btn" data-dismiss-sug>使わない</button></div></div>` : ""}
        <div style="display:flex;gap:8px;align-items:center"><select class="kx-in" data-natype style="max-width:120px">${["", "電話", "メール", "MTG", "資料送付", "その他"].map((t) => `<option value="${t}" ${x.naType === t ? "selected" : ""}>${t || "種別"}</option>`).join("")}</select>
          <input class="kx-in" data-na value="${esc(x.na)}" placeholder="例：更新の打診（料金の比較資料を送る）" /></div>
        <div style="display:flex;gap:8px;margin-top:8px;align-items:center"><span class="kx-note">日時</span><input type="datetime-local" class="kx-in" data-due value="${esc(x.naAt ? new Date(new Date(x.naAt).getTime() + 9 * 3600000).toISOString().slice(0, 16) : (x.naDue ? `${x.naDue}T09:00` : ""))}" style="max-width:220px" /><span class="kx-note" data-na-st></span><button type="button" class="kx-btn" data-save-na style="margin-left:auto">保存</button></div></div>
      <div class="kx-sec"><div class="lb">メモ</div><textarea class="kx-in" data-memo rows="3">${esc(x.memo)}</textarea><div style="display:flex;margin-top:8px"><button type="button" class="kx-btn" data-save-memo style="margin-left:auto">メモを保存</button></div></div>
      <div class="kx-sec kx-kv"><span>CS担当</span><span>${esc(x.cs || "未定")}</span><span>FS担当</span><span>${esc(x.fs || "—")}</span><span>最終接触</span><span>${x.lastTouch ? `${esc(fmtD(x.lastTouch))}（${x.sinceTouch}日前）` : "—"}</span><span>議事録</span><span>${x.meetings}件</span></div>
      ${x.kickBot ? `<a class="kx-btn" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none" href="/kinxs?p=cs&bot=${encodeURIComponent(x.kickBot)}">CS連携の企業カードを開く</a>` : ""}
      ${x.manual ? `<button type="button" class="kx-btn" data-del-user style="color:#8C1F1F;border-color:#F0C2BE">このユーザーを消す（手で追加したもの）</button>` : `<a class="kx-btn" style="display:inline-flex;align-items:center;justify-content:center;text-decoration:none" href="https://neo-media.my.salesforce.com/lightning/r/Account/${encodeURIComponent(x.id)}/view" target="_blank" rel="noopener">SFの取引先を開く ↗</a>`}
    </div>
    <div data-pane="tl" hidden style="display:flex;flex-direction:column;gap:12px">
      <div class="kx-sec"><div class="lb">電話・メールなど（議事録のない接触）を記録する</div>
        <div style="display:flex;gap:8px"><select class="kx-in" data-ctype style="max-width:110px"><option>電話</option><option>メール</option><option>Chat</option><option>その他</option></select><input class="kx-in" data-ctext placeholder="話した内容を短く" /><button type="button" class="kx-btn" data-add-contact style="white-space:nowrap">記録する</button></div></div>
      ${(() => {
        const fmt = (t) => { const d0 = new Date(t); return isNaN(d0) ? "" : `${d0.getFullYear()}/${d0.getMonth() + 1}/${d0.getDate()} ${String(d0.getHours()).padStart(2, "0")}:${String(d0.getMinutes()).padStart(2, "0")}`; };
        const main = d.timeline.filter((t) => t.kind !== "label");
        const chg = d.timeline.filter((t) => t.kind === "label");
        const item = (t) => `<div class="it ${t.kind}" ${t.botId ? `data-mt="${esc(t.botId)}" role="button" tabindex="0" title="押すと議事録を開きます"` : ""}>
            <div class="t">${esc(t.title)}${t.botId ? ' <span class="kx-open">議事録を開く ›</span>' : ""}</div>
            <div class="m">${esc(fmt(t.at))}${t.owner ? `・${esc(t.owner)}` : ""}</div>${t.summary ? `<div class="b">${esc(t.summary)}</div>` : ""}</div>`;
        const follow = main.filter((t) => t.kind !== "mtg" || t.phase === "フォロー");
        const pre = main.filter((t) => t.kind === "mtg" && t.phase !== "フォロー");
        const mainHtml = main.length ? `<div class="kx-mgrp"><div class="h">フォロー（キックオフ含めそれ以降）<span>${follow.filter((t) => t.kind === "mtg").length}件</span></div>${follow.length ? follow.map(item).join("") : '<div class="kx-note">まだありません</div>'}</div>
          <div class="kx-mgrp"><div class="h">商談（キックオフより前）<span>${pre.length}件</span></div>${pre.length ? pre.map(item).join("") : '<div class="kx-note">ありません</div>'}</div>`
          : `<div class="kx-note">まだありません。会社名が予定名に入った商談の議事録が、ここに自動で並びます</div>`;
        const chgHtml = chg.length ? `<details class="kx-chg"><summary>変更の履歴（${chg.length}件）</summary><div class="kx-chg-list">${chg.map((t) => `<div class="c"><span class="w">${esc(fmt(t.at))}</span><b>${esc(t.title)}</b><span>${esc(t.summary)}</span><span class="who">${esc(t.owner || "")}</span></div>`).join("")}</div></details>` : "";
        return `<div class="kx-tl">${mainHtml}</div>${chgHtml}`;
      })()}
    </div>
  </aside>`;
  // ステータスのタブの並び：CS担当・利用目的・活用 → フェーズ → 次回アクション → メモ → そのほか（更新確度・納品）
  (() => {
    const pane = bg.querySelector('[data-pane="info"]'); if (!pane) return;
    const top = pane.firstElementChild;
    const lbl = (pane.querySelector("[data-label]") || {}).closest?.(".kx-sec");
    const rk = (pane.querySelector(".kx-ranks") || {}).closest?.(".kx-sec");
    const dl = (pane.querySelector('[data-tog="kenshu_done"]') || {}).closest?.(".kx-sec");
    if (lbl && top) top.after(lbl);
    if (rk || dl) { const h = document.createElement("div"); h.className = "kx-other-h"; h.textContent = "そのほか（更新確度・納品）"; pane.appendChild(h); if (rk) pane.appendChild(rk); if (dl) pane.appendChild(dl); }
  })();
  if (!bg.isConnected) document.body.appendChild(bg);
  if (reuse) {
    if (reuse.tab) { bg.querySelectorAll("[data-tab]").forEach((x2) => x2.classList.toggle("on", x2.dataset.tab === reuse.tab)); bg.querySelectorAll("[data-pane]").forEach((p2) => { p2.hidden = p2.dataset.pane !== reuse.tab; }); }
    const dr = bg.querySelector(".kx-drawer"); if (dr && reuse.scroll) dr.scrollTop = reuse.scroll;
    if (reuse.msg) { const t = document.createElement("div"); t.className = "kx-saved"; t.textContent = reuse.msg; bg.querySelector(".kx-drawer").appendChild(t); setTimeout(() => t.remove(), 1600); }
  }
  const close = () => bg.remove();
  const again = async (msg = "保存しました") => {
    const tab = (bg.querySelector("[data-tab].on") || {}).dataset?.tab || "co";
    const scroll = (bg.querySelector(".kx-drawer") || {}).scrollTop || 0;
    await openDetail(id, { bg, tab, scroll, msg });
  };
  const refresh = async () => { if (VIEW === "list") await loadList(); else if (VIEW === "board") await loadBoard(); else await load(); };
  const put = async (body, redraw = true) => { try { await api(`/api/kinxs/accounts/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }); refresh().catch(() => {}); if (redraw) await again(); } catch (e) { alert(e.message); } };
  if (!bg.dataset.wired) { bg.dataset.wired = "1"; bg.addEventListener("click", (e) => { if (e.target === bg) bg.remove(); }); }
  bg.querySelector("[data-x]").addEventListener("click", close);
  bg.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
    bg.querySelectorAll("[data-tab]").forEach((x2) => x2.classList.toggle("on", x2 === b));
    bg.querySelectorAll("[data-pane]").forEach((p2) => { p2.hidden = p2.dataset.pane !== b.dataset.tab; });
  }));
  bg.querySelectorAll("[data-rank]").forEach((b) => b.addEventListener("click", async () => {
    try { await api(`/api/kinxs/accounts/${encodeURIComponent(id)}/rank`, { method: "PUT", body: JSON.stringify({ rank: b.dataset.rank }) }); refresh().catch(() => {}); await again(`更新確度を ${b.dataset.rank} にしました`); } catch (e) { alert(e.message); }
  }));
  bg.querySelector("[data-label]").addEventListener("change", (e) => put({ main_label: e.target.value || "" }));
  bg.querySelectorAll("[data-tog]").forEach((g) => g.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => put({ [g.dataset.tog]: b.dataset.v === "true" }))));
  bg.querySelector("[data-save-na]").addEventListener("click", () => put({ na_text: bg.querySelector("[data-na]").value, na_type: bg.querySelector("[data-natype]").value, na_at: bg.querySelector("[data-due]").value }));
  const rd = bg.querySelector("[data-read-na]");
  if (rd) rd.addEventListener("click", async () => {
    const st = bg.querySelector("[data-na-st]"); rd.disabled = true; st.textContent = "Gmail・議事録を読んでいます…（30秒ほど）";
    try {
      const r = await api(`/api/kinxs/accounts/${encodeURIComponent(id)}/read-na`, { method: "POST" });
      if (!r.ok) { st.textContent = r.reason || "読み取れませんでした"; rd.disabled = false; return; }
      refresh().catch(() => {}); await again(r.applied ? "次回アクションを入れました" : "提案を出しました（手で入れた次回アクションはそのまま）");
    } catch (e) { st.textContent = "読めませんでした：" + e.message; rd.disabled = false; }
  });
  const ad = bg.querySelector("[data-adopt]"); if (ad) ad.addEventListener("click", () => put({ adopt_suggest: true }));
  const ds = bg.querySelector("[data-dismiss-sug]"); if (ds) ds.addEventListener("click", () => put({ dismiss_suggest: true }));
  bg.querySelector("[data-save-memo]").addEventListener("click", () => put({ memo: bg.querySelector("[data-memo]").value }));
  bg.querySelectorAll("[data-mt]").forEach((el) => {
    el.addEventListener("click", () => openMeeting(el.dataset.mt));
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") openMeeting(el.dataset.mt); });
  });
  bg.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => { const sec = b.closest("[data-sec]"); sec.classList.add("editing"); const first = sec.querySelector(".kx-editbox input"); if (first) first.focus(); }));
  bg.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", () => b.closest("[data-sec]").classList.remove("editing")));
  // 企業情報：担当者の行・保存・パスワード
  const ctBox = bg.querySelector("[data-ct-rows]");
  const ctRow = () => `<div class="kx-ct"><input class="kx-in" data-ct="name" placeholder="お名前" /><input class="kx-in" data-ct="title" placeholder="部署・役職" /><input class="kx-in" data-ct="phone" placeholder="電話番号" /><input class="kx-in" data-ct="email" placeholder="メールアドレス" /><button type="button" class="hp-b" data-ct-del>消す</button></div>`;
  const wireCt = () => bg.querySelectorAll("[data-ct-del]").forEach((b) => { b.onclick = () => { b.closest(".kx-ct").remove(); if (!ctBox.querySelector(".kx-ct")) { ctBox.insertAdjacentHTML("beforeend", ctRow()); wireCt(); } }; });
  if (ctBox) { wireCt(); bg.querySelector("[data-ct-add]").addEventListener("click", () => { ctBox.insertAdjacentHTML("beforeend", ctRow()); wireCt(); }); }
  bg.querySelectorAll("[data-save-info]").forEach((b) => b.addEventListener("click", () => {
    // 直した欄だけを保存する（SFから来た値をそのまま手入力として残さないため）
    const info = {}; bg.querySelectorAll("[data-info]").forEach((el) => { if (el.value !== el.defaultValue) info[el.dataset.info] = el.value; });
    const ctSec = bg.querySelector("[data-ct-rows]") && bg.querySelector("[data-ct-rows]").closest("[data-sec]");
    if (ctSec && ctSec.classList.contains("editing")) info.contacts = [...bg.querySelectorAll(".kx-ct")].map((r) => ({ name: r.querySelector('[data-ct="name"]').value, title: r.querySelector('[data-ct="title"]').value, phone: r.querySelector('[data-ct="phone"]').value, email: r.querySelector('[data-ct="email"]').value }));
    if (!Object.keys(info).length) { b.closest("[data-sec]")?.classList.remove("editing"); return; }
    put({ info });
  }));
  bg.querySelectorAll("[data-pw-show]").forEach((b) => b.addEventListener("click", () => { const v = b.previousElementSibling; const sh = v.textContent !== "●●●●●●"; v.textContent = sh ? "●●●●●●" : v.dataset.pw; b.textContent = sh ? "見る" : "隠す"; }));
  bg.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(b.dataset.copy); const o = b.textContent; b.textContent = "コピーしました"; setTimeout(() => { b.textContent = o; }, 1400); } catch { prompt("コピーしてください", b.dataset.copy); } }));
  const kb = (d.info || {}).kickBot;
  bg.querySelectorAll("[data-ai-show],[data-ai-copy]").forEach((b) => b.addEventListener("click", async () => {
    const row = b.closest("[data-ai-i]");
    try {
      const r = await api(`/api/cs/kickoffs/${encodeURIComponent(kb)}/ai-account?i=${encodeURIComponent(row.dataset.aiI)}`);
      if (b.hasAttribute("data-ai-show")) { row.querySelector("[data-ai-pw]").textContent = r.password || "（空）"; } else { await navigator.clipboard.writeText(r.password || ""); const o = b.textContent; b.textContent = "コピーしました"; setTimeout(() => { b.textContent = o; }, 1400); }
    } catch (e) { alert(e.message); }
  }));
  // ステータス：CS担当・利用目的・活用
  let usagePick = (d.status || {}).usage || "";
  bg.querySelectorAll("[data-usage]").forEach((b) => b.addEventListener("click", () => { usagePick = usagePick === b.dataset.usage ? "" : b.dataset.usage; bg.querySelectorAll("[data-usage]").forEach((x2) => x2.classList.toggle("on", x2.dataset.usage === usagePick)); }));
  const ss = bg.querySelector("[data-save-status]");
  if (ss) ss.addEventListener("click", () => put({ cs_name: bg.querySelector('[data-st="cs_name"]').value, purpose: bg.querySelector('[data-st="purpose"]').value, usage_status: usagePick }));
  const delU = bg.querySelector("[data-del-user]");
  if (delU) delU.addEventListener("click", async () => {
    if (!confirm(`「${x.name}」をユーザーから消します。よろしいですか？`)) return;
    try { await api(`/api/kinxs/accounts/${encodeURIComponent(id)}`, { method: "DELETE" }); close(); await refresh(); } catch (e) { alert(e.message); }
  });
  bg.querySelector("[data-add-contact]").addEventListener("click", () => { const t = bg.querySelector("[data-ctext]").value.trim(); if (!t) return; put({ contact: { type: bg.querySelector("[data-ctype]").value, text: t } }); });
}
// 議事録のモーダル（企業詳細の上に重ねて出す）
async function openMeeting(botId) {
  const bg = document.createElement("div"); bg.className = "kx-mt-bg";
  bg.innerHTML = `<div class="kx-mt" role="dialog" aria-label="議事録"><div class="kx-note">読み込み中…</div></div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
  const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
  let m;
  try { m = await api(`/api/kinxs/meetings/${encodeURIComponent(botId)}`); }
  catch (e) { bg.querySelector(".kx-mt").innerHTML = `<div class="kx-note">開けませんでした：${esc(e.message)}</div><button type="button" class="kx-btn" data-x>閉じる</button>`; bg.querySelector("[data-x]").addEventListener("click", close); return; }
  const sm = m.summary || {};
  const list = (v) => (Array.isArray(v) ? v : []).map((x) => typeof x === "string" ? x : [x.task || x.item || x.text || x.content || x.title || "", x.owner || x.who ? `（${x.owner || x.who}）` : "", x.due ? `〜${x.due}` : ""].join("")).filter(Boolean);
  const sec = (title, v) => { const l = list(v); return l.length ? `<h4>${esc(title)}</h4><ul>${l.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""; };
  const known = ["overview", "key_points", "agreements", "customer_concerns", "action_items"];
  const extra = Object.entries(sm).filter(([k, v]) => !known.includes(k) && Array.isArray(v) && v.length && v.every((x) => typeof x === "string")).slice(0, 4);
  bg.querySelector(".kx-mt").innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:10px"><div><h3>${esc(m.title || "（題名なし）")}</h3><div class="kx-note">${esc(new Date(m.at).toLocaleString("ja-JP"))}${m.owner ? `・${esc(m.owner)}` : ""}</div></div>
      <button type="button" class="kx-btn" data-x style="margin-left:auto">閉じる</button></div>
    <div data-video class="kx-video"><div class="kx-note">録画を探しています…</div></div>
    ${sm.overview ? `<h4>概要</h4><p>${esc(sm.overview)}</p>` : ""}
    ${sec("話したこと", sm.key_points)}${sec("決まったこと", sm.agreements)}${sec("先方の気にしていること", sm.customer_concerns)}${sec("やること", sm.action_items)}
    ${extra.map(([k, v]) => sec(k, v)).join("")}
    ${!sm.overview && !list(sm.key_points).length ? `<div class="kx-note">要約はまだありません</div>` : ""}
    <details ${m.transcript.length && !sm.overview ? "open" : ""}><summary class="kx-note" style="cursor:pointer;font-weight:700">文字起こし（${m.transcript.length + (m.more || 0)}発言）</summary>
      <div class="kx-tr" style="margin-top:8px">${m.transcript.length ? m.transcript.map((u) => `<div><b>${esc(u.who || "話者")}</b>${esc(u.text)}</div>`).join("") : "文字起こしはありません"}${m.more ? `<div class="kx-note">ほか ${m.more}発言（議事録のページで見られます）</div>` : ""}</div></details>
    <a class="kx-btn" style="align-self:flex-start;display:inline-flex;align-items:center;text-decoration:none" href="/history.html?bot=${encodeURIComponent(m.botId)}" target="_blank" rel="noopener">議事録のページで開く（録画・分析など）↗</a>`;
  bg.querySelector("[data-x]").addEventListener("click", close);
  // 録画（あれば）
  try {
    const r = await api(`/api/kinxs/meetings/${encodeURIComponent(botId)}/recording`);
    const box = bg.querySelector("[data-video]");
    if (!box) return;
    box.innerHTML = r.url ? `<video controls preload="metadata" playsinline src="${esc(r.url)}"></video>${r.source === "recall" ? `<div class="kx-note" style="margin-top:4px">録画はRecallから流しています（保存期限があります）</div>` : ""}` : `<div class="kx-note">この商談の録画はありません</div>`;
  } catch { const box = bg.querySelector("[data-video]"); if (box) box.innerHTML = `<div class="kx-note">録画を読み込めませんでした</div>`; }
}

// ユーザーを手で追加する
function openAddUser() {
  const bg = document.createElement("div"); bg.className = "kx-drawer-bg";
  bg.innerHTML = `<aside class="kx-drawer" role="dialog" aria-label="ユーザーを追加">
    <div style="display:flex;align-items:center;gap:10px"><h2>ユーザーを追加</h2><button type="button" class="kx-btn" data-x style="margin-left:auto">閉じる</button></div>
    <div class="kx-note">SFに無い会社や、取り込みに出てこない会社を手で足します。あとから企業詳細で、ラベル・確度・次回アクションなどを入れられます。</div>
    <div class="kx-sec" style="display:grid;grid-template-columns:110px 1fr;gap:10px;align-items:center">
      <label class="kx-note" for="auName">企業名 *</label><input class="kx-in" id="auName" placeholder="株式会社〇〇" />
      <label class="kx-note" for="auProd">契約商品</label><input class="kx-in" id="auProd" value="アチコチバース（年間プラン）" />
      <label class="kx-note" for="auBooked">計上日</label><input class="kx-in" id="auBooked" type="date" />
      <label class="kx-note" for="auEnd">契約終了日</label><div><input class="kx-in" id="auEnd" type="date" /><div class="kx-note" style="margin-top:4px">空のときは、計上日から1年で推定します</div></div>
      <label class="kx-note" for="auCs">CS担当</label><input class="kx-in" id="auCs" placeholder="例：鶴川 夏海" />
      <label class="kx-note" for="auFs">FS担当</label><input class="kx-in" id="auFs" placeholder="例：植野ひかり" />
      <label class="kx-note" for="auMemo">メモ</label><textarea class="kx-in" id="auMemo" rows="3"></textarea>
    </div>
    <div style="display:flex;gap:8px;align-items:center"><span class="kx-note" data-st></span><button type="button" class="kx-btn" data-save style="margin-left:auto;background:#0E6B4E;color:#fff;border-color:#0E6B4E">追加する</button></div>
  </aside>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
  bg.querySelector("[data-x]").addEventListener("click", close);
  bg.querySelector("#auName").focus();
  bg.querySelector("[data-save]").addEventListener("click", async () => {
    const st = bg.querySelector("[data-st]");
    const body = { name: bg.querySelector("#auName").value, product: bg.querySelector("#auProd").value, booked_on: bg.querySelector("#auBooked").value, end_on: bg.querySelector("#auEnd").value,
      cs_name: bg.querySelector("#auCs").value, fs_name: bg.querySelector("#auFs").value, memo: bg.querySelector("#auMemo").value };
    if (!body.name.trim()) { st.textContent = "企業名を入れてください"; return; }
    try {
      const r = await api("/api/kinxs/accounts", { method: "POST", body: JSON.stringify(body) });
      close();
      if (VIEW === "list") await loadList(); else if (VIEW === "board") await loadBoard(); else await load();
      if (r.item && r.item.account_id) openDetail(r.item.account_id);
    } catch (e) { st.textContent = "追加できませんでした：" + e.message; }
  });
}
document.querySelectorAll(".kx-add-user").forEach((b) => b.addEventListener("click", openAddUser));
// ===== CS管理ボードから取り込む =====
const IM_FIELDS = [["name", "企業名（必須）"], ["renew", "更新月"], ["rank", "確度（S/A/B/C/Z/F）"], ["cs", "CS担当"], ["product", "契約商品"], ["start", "契約開始日"], ["end", "契約終了日"], ["memo", "メモ"]];
let imData = null;
async function imLoad(sheet) {
  const st = $("imSt"); st.textContent = "読み込んでいます…";
  try {
    const body = $("imCsv").value.trim() ? { csv: $("imCsv").value } : { url: $("imUrl").value.trim(), sheet: sheet || "" };
    imData = await api("/api/kinxs/import/preview", { method: "POST", body: JSON.stringify(body) });
    st.textContent = `${imData.book ? `「${imData.book}」の` : ""}${imData.sheet ? `「${imData.sheet}」` : ""} ${imData.rows.length}行を読みました（見出しは${imData.headerRow}行目）`;
    const tab = $("imTab");
    if (imData.tabs && imData.tabs.length > 1) { tab.hidden = false; tab.innerHTML = imData.tabs.map((t) => `<option ${t === imData.sheet ? "selected" : ""}>${esc(t)}</option>`).join(""); } else tab.hidden = true;
    $("imMap").innerHTML = IM_FIELDS.map(([k, l]) => `<label class="kx-note" style="display:flex;flex-direction:column;gap:4px">${esc(l)}<select class="kx-in" data-map="${k}"><option value="">（使わない）</option>${imData.headers.map((h, i) => `<option value="${i}" ${imData.guess[k] === i ? "selected" : ""}>${esc(h)}</option>`).join("")}</select></label>`).join("");
    $("imMapBox").style.display = "flex"; $("imApply").disabled = true; $("imPrevBox").style.display = "none";
  } catch (e) { st.textContent = "読み込めませんでした：" + e.message; }
}
function imMapping() { const m = {}; document.querySelectorAll("[data-map]").forEach((s2) => { m[s2.dataset.map] = s2.value === "" ? "" : Number(s2.value); }); return m; }
async function imRun(dryRun) {
  const st = $("imSt2"); const mapping = imMapping();
  if (mapping.name === "") { st.textContent = "企業名の列を選んでください"; return; }
  if (!dryRun && !confirm("この内容で反映します。よろしいですか？")) return;
  st.textContent = dryRun ? "照らし合わせています…" : "反映しています…";
  try {
    const r = await api("/api/kinxs/import/apply", { method: "POST", body: JSON.stringify({ rows: imData.rows, mapping, createMissing: $("imCreate").checked, dryRun }) });
    st.textContent = `${dryRun ? "プレビュー：" : "反映しました："}一致 ${r.matched}社・${$("imCreate").checked ? `新しく追加 ${r.created}社・` : ""}スキップ ${r.skipped}件`;
    $("imPrevBox").style.display = "block";
    $("imPrev").innerHTML = `<div class="ls-grid" style="grid-template-columns:minmax(200px,1.6fr) minmax(200px,1.6fr) minmax(140px,1fr) 100px 70px minmax(120px,1fr);min-width:900px">${["CS管理ボードの企業名", "kinXsの会社", "結果", "更新月", "確度", "CS担当"].map((h) => `<div class="ls-h">${h}</div>`).join("")}` +
      r.items.map((x) => `<div class="ls-r" style="cursor:default">${esc(x.name)}</div><div class="ls-r" style="cursor:default">${esc(x.match || "—")}</div><div class="ls-r ${x.status === "一致" ? "ok-t" : x.status.startsWith("新しく") ? "mid-t" : "ng-t"}" style="cursor:default">${esc(x.status)}</div><div class="ls-r" style="cursor:default">${esc(x.renew ? x.renew.replace("-", "/") : "—")}</div><div class="ls-r" style="cursor:default">${x.rank ? `<span class="kx-rank r-${x.rank}">${x.rank}</span>` : "—"}</div><div class="ls-r" style="cursor:default">${esc(x.cs || "—")}</div>`).join("") + `</div>`;
    $("imApply").disabled = !dryRun;
    if (!dryRun) $("imApply").disabled = true;
  } catch (e) { st.textContent = "できませんでした：" + e.message; }
}
if ($("imLoad")) {
  $("imLoad").addEventListener("click", () => imLoad());
  $("imTab").addEventListener("change", (e) => imLoad(e.target.value));
  $("imPreview").addEventListener("click", () => imRun(true));
  $("imApply").addEventListener("click", () => imRun(false));
}
// ===== ラベル別ボード =====
const BD_COLS = [
  ["計上予定", "リストに入った直後。キックオフMTGがまだ", "#7C8AA5"],
  ["フォローMTG設定中", "キックオフ済み、フォローMTGが未設定", "#E0A100"],
  ["フォローMTG設定済", "フォローMTGを設定済み、まだ実施前", "#3F72C9"],
  ["オンボーディング中", "フォローMTG済み、まだ掲載できていない", "#7A55C7"],
  ["利用中", "掲載状況を確認したあと", "#1D9E75"],
  ["更新検討時期", "更新月の2か月前から", "#E07A1F"],
  ["解約予定", "解約の意向あり（確度C）", "#C43D3D"],
  ["解約済み", "契約が終わった（確度F）", "#3A3F3D"],
  ["キャンセル", "SFで計上を取り消した", "#9AA5A0"],
  ["エラー", "SFの取り込みで必要な項目が無い", "#A51F16"],
];
let bdData = null;
async function loadBoard() {
  try { bdData = await api("/api/kinxs/users"); renderBoard(); }
  catch (e) { $("bdCols").innerHTML = `<div class="kx-empty">読み込めませんでした：${esc(e.message)}</div>`; }
}
function renderBoard() {
  const d = bdData; if (!d) return;
  const sel = $("bdCs"), cur = sel.value;
  kxSur = kxSurnameMap(d.items.map((x) => x.cs).filter(Boolean));
  const css = [...new Set(d.items.map((x) => kxSurname(x.cs)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
  sel.innerHTML = `<option value="">CS担当：全員</option>` + css.map((c) => `<option ${c === cur ? "selected" : ""}>${esc(c)}</option>`).join("") + `<option value="__none" ${cur === "__none" ? "selected" : ""}>CS担当：未定</option>`;
  const q = $("bdQ").value || "";
  const items = d.items.filter((x) => kxMatch(q, x.name, x.cs, x.fs, x.products, x.label) && (!sel.value || (sel.value === "__none" ? !x.cs : kxSurname(x.cs) === sel.value)));
  const showEnd = $("bdEnd").checked;
  const cols = BD_COLS.filter(([l]) => showEnd || !["解約済み", "キャンセル"].includes(l)).filter(([l]) => l !== "エラー" || items.some((x) => x.label === "エラー"));
  const good = "background:#E1F5EE;color:#0A5440", bad = "background:#FBE4E4;color:#8C1F1F", mid = "background:#FFF1DC;color:#7A3F00";
  const card = (x) => `<div class="kx-card ${x.alerts.length ? "warn" : ""}" draggable="true" data-card="${esc(x.id)}" role="button" tabindex="0" title="押すと詳細／別の列にドラッグでラベルを変える">
      <div class="t"><span>${esc(x.name)}</span>${x.alerts.length ? '<span class="kx-rule" style="flex:none;font-size:10.5px">要注意</span>' : ""}</div>
      <div class="p">${esc(x.products.join("・"))}</div>
      <div class="bd"><span class="kx-rank r-${x.rank}" style="width:22px;height:22px;font-size:11.5px">${x.rank}</span>
        <span class="s" style="${x.kenshu.startsWith("回収済み") ? good : x.kenshu === "依頼済み" ? mid : bad}">検収 ${x.kenshu.startsWith("回収済み") ? "済" : x.kenshu === "依頼済み" ? "依頼済" : "未"}</span>
        <span class="s" style="${x.mail.startsWith("送付済み") ? good : x.mail === "下書きあり" ? mid : bad}">納品メール ${x.mail.startsWith("送付済み") ? "済" : x.mail === "下書きあり" ? "下書き" : "未"}</span>
        ${x.locked ? '<span class="lock" title="手で決めたラベル">🔒</span>' : ""}</div>
      <div class="f"><span class="av">${esc((kxSurname(x.cs) || "？").slice(0, 1))}</span>${esc(kxSurname(x.cs) || "CS未定")}<span style="margin-left:auto;${x.naDue && x.naDue < new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10) ? "color:#8C1F1F;font-weight:700" : ""}">${x.naDue ? `NA ${esc(x.naDue.slice(5).replace("-", "/"))}` : x.renew ? `更新 ${esc(x.renew.replace("-", "/"))}` : ""}</span></div>
    </div>`;
  $("bdCols").innerHTML = cols.map(([l, rule, color]) => {
    const list = items.filter((x) => x.label === l).sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name, "ja"));
    return `<section class="kx-col" data-col="${esc(l)}"><div class="kx-col-h"><span style="width:10px;height:10px;border-radius:3px;background:${color}"></span><b>${esc(l)}</b><span class="n">${list.length}</span></div><div class="kx-col-r">${esc(rule)}</div>${list.map(card).join("")}</section>`;
  }).join("");
  $("bdSt").textContent = `全${items.length}社`;
  document.querySelectorAll("#bdCols [data-card]").forEach((c) => {
    c.addEventListener("click", () => openDetail(c.dataset.card));
    c.addEventListener("keydown", (e) => { if (e.key === "Enter") openDetail(c.dataset.card); });
    c.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", c.dataset.card); c.classList.add("dragging"); });
    c.addEventListener("dragend", () => { c.classList.remove("dragging"); document.querySelectorAll(".kx-col.over").forEach((x) => x.classList.remove("over")); });
  });
  document.querySelectorAll("#bdCols [data-col]").forEach((col) => {
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("over"); });
    col.addEventListener("dragleave", (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove("over"); });
    col.addEventListener("drop", async (e) => {
      e.preventDefault(); col.classList.remove("over");
      const id = e.dataTransfer.getData("text/plain"); const x = d.items.find((i) => i.id === id);
      if (!x || x.label === col.dataset.col) return;
      try { await api(`/api/kinxs/accounts/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ main_label: col.dataset.col }) }); x.label = col.dataset.col; x.locked = true; renderBoard(); }
      catch (er) { alert(er.message); }
    });
  });
}
if ($("bdQ")) { $("bdQ").addEventListener("input", renderBoard); $("bdCs").addEventListener("change", renderBoard); $("bdEnd").addEventListener("change", renderBoard); }
api("/api/me").then((me) => { window.__kxMe = (me && me.name) || ""; if (VIEW === "renew" && data) render(); }).catch(() => {});
if (VIEW === "list") loadList(); else if (VIEW === "renew") load(); else if (VIEW === "board") loadBoard();
