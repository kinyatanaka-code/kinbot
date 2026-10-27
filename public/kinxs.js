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
  const items = d.items.filter((x) => kxTrackOk(x) && kxMatch(q, x.name, x.formerNames || [], x.cs, x.fs, x.products) && (!sel.value || (sel.value === "__none" ? !x.cs : kxSurname(x.cs) === sel.value)));
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
  const RC = { S: "#0E6B4E", A: "#178A66", B: "#E0A100", C: "#C43D3D", Z: "#9AA8B8", F: "#3A3F3D" };
  const mono1 = (n) => String(n || "？").replace(/^(株式会社|有限会社|合同会社|社会福祉法人|医療法人社団|医療法人|一般社団法人|一般財団法人|公益社団法人|公益財団法人|学校法人)\s*/, "").trim().slice(0, 1) || "？";
  // 会社のチップ：左の色の帯＝確度、ロゴ、会社名。要注意は小さな橙の点だけ（枠で光らせない）
  const chip = (x) => `<button type="button" class="kx-chipco v2" style="--rc:${RC[x.rank] || "#9AA8B8"}" draggable="true" data-id="${esc(x.id)}" title="${esc(`${x.name}${(x.formerNames || []).length ? `（旧：${x.formerNames.join("・")}）` : ""}\n確度 ${x.rank}・CS ${kxSurname(x.cs) || "未定"}${x.estimated ? "・終了日は推定" : ""}${x.warn ? "\n要注意（更新月が近いのに確度がB以下）" : ""}\n押すと詳細／ドラッグで確度・更新月を変える／右クリックで確度を選ぶ`)}">`
    + `<span class="lg">${x.logo ? `<img src="${esc(x.logo)}" alt="" loading="lazy" data-mono="${esc(mono1(x.name))}" />` : esc(mono1(x.name))}</span>`
    + `<span class="nm">${esc(x.name)}</span><span class="rk">${x.rank}</span>${x.warn ? '<i class="dot" aria-label="要注意"></i>' : ""}</button>`;
  const rowHtml = (m, list, label, dl, cls) => `<div class="kx-mrow v2 ${cls}" data-month="${esc(m || "")}">
      <div class="kx-mhead"><b>${esc(label)}</b><span class="pill">${esc(dl)}</span><div class="n">${list.length}社</div></div>
      <div class="kx-chips2">${list.sort((a, b) => (rankOrder[a.rank] - rankOrder[b.rank]) || a.name.localeCompare(b.name, "ja")).map(chip).join("") || '<span class="kx-note">この月の会社はありません</span>'}</div></div>`;
  const rowsInfo = rows.map((r) => {
    const left = Math.round((Date.parse(`${r.m}-01T00:00:00+09:00`) - Date.now()) / 86400000);
    const isNow = r.m === d.thisMonth;
    const cls = isNow ? "now" : left < 0 ? "past" : left <= d.warnDays ? "warn" : "";
    return { ...r, html: rowHtml(r.m, r.list, ymLabel(r.m), isNow ? "今月" : left < 0 ? `${-left}日過ぎ` : `あと${left}日`, cls), past: !isNow && left < 0 };
  });
  const pastRows = rowsInfo.filter((r) => r.past), nextRows = rowsInfo.filter((r) => !r.past);
  const pastN = pastRows.reduce((a, r) => a + r.list.length, 0), nextN = nextRows.reduce((a, r) => a + r.list.length, 0);
  const pastOpen = window.__kxPastOpen !== false;
  // 更新月を過ぎた会社は、月ごとの行にせず、1つの箱にまとめて並べる（チップに月を小さく付ける）。行が長くなって見づらかったので（2026-10-27）
  const pastChips = pastRows.slice().sort((a2, b2) => String(a2.m).localeCompare(String(b2.m))).flatMap((r) => r.list.slice().sort((a3, b3) => (rankOrder[a3.rank] - rankOrder[b3.rank]) || a3.name.localeCompare(b3.name, "ja")).map((x) => chip(x).replace('<span class="nm">', `<span class="mo">${esc(String(r.m).slice(2).replace("-", "/"))}</span><span class="nm">`)));
  const body = (pastRows.length ? `<div class="kx-sec-h past" data-past-toggle role="button" tabindex="0"><span>${pastOpen ? "▾" : "▸"}</span>更新月を過ぎた会社<em>${pastN}社</em><small>古い月から・チップの左が更新月／押すとたたむ・開く</small></div>${pastOpen ? `<div class="kx-mrow v2 past kx-pastbox" data-month=""><div class="kx-chips2">${pastChips.join("")}</div></div>` : ""}` : "")
    + `<div class="kx-sec-h">これからの更新<em>${nextN}社</em></div>${nextRows.map((r) => r.html).join("")}`
    + (noMonth.length ? `<div class="kx-sec-h">更新月が未定<em>${noMonth.length}社</em></div>${rowHtml("", noMonth, "未定", "契約終了日が無い", "past")}` : "");
  const fcount = { warn: items.filter((x) => x.warn).length, all: items.length, Z: items.filter((x) => x.rank === "Z").length, mine: myName ? items.filter((x) => String(x.cs || "").replace(/\s/g, "").includes(myName.replace(/\s/g, ""))).length : 0 };
  const fbtn = (k, t) => `<button type="button" class="kx-chip ${flt === k ? "on" : ""}" data-flt="${k}">${t} ${fcount[k]}</button>`;
  const rcount = {}; for (const x of items) rcount[x.rank] = (rcount[x.rank] || 0) + 1;
  const legend = RANKS.map(([k, l]) => `<button type="button" class="kx-drop v2 ${rsel.has(k) ? "on" : ""} ${rsel.size && !rsel.has(k) ? "dim" : ""}" style="--rc:${RC[k]}" data-rank-drop="${k}" data-rank-pick="${k}" aria-pressed="${rsel.has(k)}" title="押すと確度${k}（${esc(l)}）の会社だけを出します（もう一度押すと外す）。会社をここにドラッグすると確度${k}になります"><span class="kx-rank r-${k}">${k}</span>${esc(l)}<span class="kx-rc">${rcount[k] || 0}</span></button>`).join("")
    + (rsel.size ? `<button type="button" class="kx-chip" data-rank-clear style="height:28px">外す</button>` : "");
  const trk = kxTrackSeg(() => render());
  $("kxTable").innerHTML = d.items.length ? `<div class="kx-tools"><div class="f">${trk.html}${fbtn("all", "すべて")}${fbtn("warn", "要注意だけ")}${myName ? fbtn("mine", "自分の担当") : ""}</div><div class="r">${legend}</div></div>
    <div class="kx-mrows">${body || '<div class="kx-empty">当てはまる会社がありません</div>'}</div>` : `<div class="kx-empty">まだ会社がありません。「SFから取り込み直す」を押すと、申込書回収（06）以降の、空間デザイン制作かアチコチバースの商談から取り込みます。</div>`;
  trk.wire($("kxTable"));
  document.querySelectorAll("#kxTable img[data-mono]").forEach((im) => im.addEventListener("error", () => { const p0 = im.parentNode; p0.textContent = im.dataset.mono; }));
  const pt = document.querySelector("#kxTable [data-past-toggle]"); if (pt) pt.addEventListener("click", () => { window.__kxPastOpen = !(window.__kxPastOpen !== false); render(); });

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
// フェーズ別：画面は止めて、列ごとに縦スクロール（列の並びは横スクロール）。ユーザー一覧の担当別と同じ動き
function kxFitBoard() {
  const wrap = document.querySelector("#vBoard .kx-board-wrap");
  if (!wrap || VIEW !== "board") return;
  wrap.scrollTop = 0;
  wrap.style.height = `${Math.max(260, window.innerHeight - wrap.getBoundingClientRect().top - 16)}px`;
  document.documentElement.style.overflow = "hidden";
  if (!wrap._wired) {
    wrap._wired = true;
    wrap.addEventListener("wheel", (e) => {
      const inCol = !!e.target.closest(".kx-col-b");
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) { wrap.scrollLeft += e.deltaX; e.preventDefault(); return; }
      if (e.shiftKey) { wrap.scrollLeft += e.deltaY; e.preventDefault(); return; }
      if (inCol) return;
      wrap.scrollLeft += e.deltaY; e.preventDefault();
    }, { passive: false });
    wrap.addEventListener("dragover", (e) => { const r0 = wrap.getBoundingClientRect(); if (e.clientX > r0.right - 70) wrap.scrollLeft += 18; else if (e.clientX < r0.left + 70) wrap.scrollLeft -= 18; });
  }
}
window.addEventListener("resize", () => kxFitBoard());
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
const VIEW = ({ missing: "missing", home: "home", renew: "renew", list: "list", import: "import", cs: "cs", board: "board", settings: "settings" })[new URLSearchParams(location.search).get("p")] || "home";
document.querySelectorAll(".kx-nav[data-view], .kx-side-set[data-view]").forEach((a) => a.classList.toggle("on", a.dataset.view === VIEW));
$("vList").hidden = VIEW !== "list"; if ($("vHome")) $("vHome").hidden = VIEW !== "home"; if ($("vMissing")) $("vMissing").hidden = VIEW !== "missing"; $("vRenew").hidden = VIEW !== "renew"; $("vImport").hidden = VIEW !== "import"; $("vCs").hidden = VIEW !== "cs"; $("vBoard").hidden = VIEW !== "board"; $("vSet").hidden = VIEW !== "settings";
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
  // 今月の受注・先月の受注（SS06昇格日）・今月の納品予定。押すと、ユーザー一覧でその会社だけ
  const items0 = ((u && u.items) || []).filter((x) => !x.archived);
  const nowJ = new Date(Date.now() + 9 * 3600000); const ym = nowJ.toISOString().slice(0, 7);
  const pm = new Date(Date.UTC(nowJ.getUTCFullYear(), nowJ.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const bm = (x) => String(x.lastBooked || x.booked || "").slice(0, 7);
  const cnt = { won: items0.filter((x) => bm(x) === ym).length, last: items0.filter((x) => bm(x) === pm).length, del: items0.filter((x) => x.deliveryMonth === ym).length };
  const tk = $("kxTopKpis");
  if (tk) {
    const cur = VIEW === "list" ? (window.__lsKpi || "") : "";
    tk.innerHTML = [["won", "今月受注"], ["last", "先月受注"], ["del", "今月納品予定"]].map(([k, t]) => `<button type="button" class="kx-tk ${cur === k ? "on" : ""}" data-tk="${k}">${t}<b>${cnt[k]}</b>社</button>`).join("");
    tk.querySelectorAll("[data-tk]").forEach((b) => b.addEventListener("click", () => {
      if (VIEW === "list") { window.__lsKpi = window.__lsKpi === b.dataset.tk ? "" : b.dataset.tk; tk.querySelectorAll("[data-tk]").forEach((x) => x.classList.toggle("on", x.dataset.tk === window.__lsKpi)); window.__lsTab = "all"; renderList(); }
      else location.href = `/kinxs?p=list&kpi=${b.dataset.tk}`;
    }));
  }
  const n = ((u && u.items) || []).filter((x) => (x.alerts || []).length).length;
  const c = $("kxTopChip"); if (!c || !n) return;
  if (!window.KX_SHOW_TOP_ALERT) return;   // ヘッダーの「要注意 ○社」は、いまは出さない（2026-10-26）
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
// 商品ラベルの小さな札（DOC＝緑、SNS＝紫）
const KX_DOC_L = ["空間", "AI"], KX_SNS_L = ["SNS", "インスタ", "配信代行", "動画制作"];
function kxPlTags(x) { const l = x.prodLabels || []; return (l.length || x.manual) ? `<span class="kx-pltags">${l.map((t) => `<span class="kx-pl ${KX_SNS_L.includes(t) ? "sns" : "doc"}">${esc(t)}</span>`).join("")}${x.manual ? '<span class="kx-pl nosf" title="SFの商談に紐づいていません（モーダルの企業情報で紐づけられます）">SF未連携</span>' : ""}</span>` : ""; }
// ユーザー一覧・更新管理の「すべて／DOC／SNS」（2026-10-27）
function kxTrackGet() { try { return localStorage.getItem("kxTrack") || "all"; } catch { return "all"; } }
function kxTrackSet(v) { try { localStorage.setItem("kxTrack", v); } catch {} }
function kxTrackOk(x) { const t = kxTrackGet(); return t === "DOC" ? kxHasDoc(x) : t === "SNS" ? kxHasSns(x) : true; }
function kxTrackSeg(onChange) {
  const t = kxTrackGet();
  const html = `<div class="kx-seg kx-trackseg" role="tablist">${[["all", "すべて"], ["DOC", "DOC"], ["SNS", "SNS"]].map(([k, l]) => `<button type="button" class="${t === k ? "on" : ""}" data-kxtrack="${k}">${l}</button>`).join("")}</div>`;
  return { html, wire: (root) => root.querySelectorAll("[data-kxtrack]").forEach((b) => b.addEventListener("click", () => { kxTrackSet(b.dataset.kxtrack); onChange(); })) };
}
const kxHasSns = (x) => (x.prodLabels || []).some((t) => KX_SNS_L.includes(t));
const kxHasDoc = (x) => (x.prodLabels || []).some((t) => KX_DOC_L.includes(t)) || !(x.prodLabels || []).length;
function renderList() {
  const d = lsData; if (!d) return;
  const sel = $("lsCs"), cur = sel.value;
  kxSur = kxSurnameMap(d.items.map((x) => x.cs).filter(Boolean));
  const css = [...new Set(d.items.map((x) => kxSurname(x.cs)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
  sel.innerHTML = `<option value="">CS担当：全員</option>` + css.map((c) => `<option ${c === cur ? "selected" : ""}>${esc(c)}</option>`).join("") + `<option value="__none" ${cur === "__none" ? "selected" : ""}>CS担当：未定</option>`;
  const q = $("lsQ").value || "";
  // 今月の受注・今月の納品予定（上の数字。押すとその会社だけ）／アーカイブ（動いていない会社は、ふだん出さない）
  const ym = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
  const live = d.items.filter((x) => !x.archived);
  const wonM = live.filter((x) => String(x.lastBooked || x.booked || "").slice(0, 7) === ym);
  const pmK = (() => { const n0 = new Date(Date.now() + 9 * 3600000); return new Date(Date.UTC(n0.getUTCFullYear(), n0.getUTCMonth() - 1, 1)).toISOString().slice(0, 7); })();
  const lastM = live.filter((x) => String(x.lastBooked || x.booked || "").slice(0, 7) === pmK);
  const delM = live.filter((x) => x.deliveryMonth === ym);
  const arcN = d.items.filter((x) => x.archived).length;
  { const holder = $("lsTrack"); if (holder) { const sg = kxTrackSeg(() => renderList()); holder.innerHTML = sg.html; sg.wire(holder); } }
  if (window.__lsKpi === undefined) { const qk = new URLSearchParams(location.search).get("kpi"); window.__lsKpi = ["won", "last", "del", "arc"].includes(qk) ? qk : ""; }
  const kp = window.__lsKpi || "";
  const kb = $("lsKpi");
  if (kb) {
    // 数はヘッダーに出す。ここは、絞り込み中の表示と、アーカイブを見る入口だけ
    const nm = { won: "今月受注", last: "先月受注", del: "今月納品予定", arc: "アーカイブ" }[kp];
    kb.innerHTML = `${kp ? `<span class="kx-chip on" style="cursor:default">${esc(nm)}の会社だけ</span><button type="button" class="kx-chip" data-kpi="">絞り込みを外す</button>` : ""}${(() => { const n0 = d.items.filter((x) => x.manual && !x.archived).length; return n0 ? `<button type="button" class="kx-chip" data-link-auto title="取引先名がぴったり同じで、クロスの商談で受注している商談に、まとめて紐づけます">SF未連携 ${n0}社を自動で紐づける</button>` : ""; })()}<button type="button" class="kx-chip" data-kpi="arc">${kp === "arc" ? "アーカイブを閉じる" : `アーカイブを見る${arcN ? `（${arcN}）` : ""}`}</button>`;
    const la = kb.querySelector("[data-link-auto]");
    if (la) la.addEventListener("click", async () => {
      if (!confirm("取引先名がぴったり同じで、クロスの商談で受注している商談に、まとめて紐づけます。よろしいですか？（手で入れた中身は、SFの会社に引き継ぎます）")) return;
      la.disabled = true; la.textContent = "SFを探しています…";
      try { const r = await api("/api/kinxs/link-sf-auto", { method: "POST" }); alert(`紐づけました：${r.linked.length}社${r.linked.some((n) => n.includes("商談")) ? `（${r.linked.filter((n) => n.includes("商談")).join("、")}）` : ""}\n${r.notFound.length ? `SFで見つからない・クロスの受注の商談が無い：${r.notFound.join("、")}（モーダルの企業情報で、名前を変えて探せます）` : ""}`); await loadList(); }
      catch (e) { alert(e.message); la.disabled = false; }
    });
    kb.querySelectorAll("[data-kpi]").forEach((b) => b.addEventListener("click", () => { window.__lsKpi = window.__lsKpi === b.dataset.kpi ? "" : b.dataset.kpi; document.querySelectorAll("#kxTopKpis [data-tk]").forEach((x) => x.classList.toggle("on", x.dataset.tk === window.__lsKpi)); renderList(); }));
  }
  const pool0 = kp === "arc" ? d.items.filter((x) => x.archived) : kp === "won" ? wonM : kp === "last" ? lastM : kp === "del" ? delM : live;
  const base = pool0.filter((x) => kxTrackOk(x)).filter((x) => kxMatch(q, x.name, x.formerNames || [], x.cs, x.fs, x.products, x.label, (x.prodLabels || []).join(" ")) && (!sel.value || (sel.value === "__none" ? !x.cs : kxSurname(x.cs) === sel.value)));
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
  const PH = { "計上予定": "#7C8AA5", "キックオフMTG済": "#D9822B", "フォローMTG設定済": "#3F72C9", "オンボーディング中": "#7A55C7", "利用中": "#1D9E75", "更新検討時期": "#E07A1F", "解約予定": "#C43D3D", "解約済み": "#3A3F3D", "キャンセル": "#9AA5A0", "エラー": "#A51F16" };
  const mono = (n) => { const t = String(n || "").normalize("NFKC").replace(/株式会社|有限会社|合同会社|一般社団法人|公益社団法人|一般財団法人|社会福祉法人|医療法人社団|医療法人|学校法人|\(株\)|（株）|[\s　]/g, ""); return t.slice(0, 1) || "・"; };
  // ロゴ（会社のHPから）があれば白い四角に、読めなければ頭文字
  const card = (x) => `<div class="kx-uc kx-uc-lux" style="--accent:${PH[x.label] || "#1D9E75"}" data-open="${esc(x.id)}" role="button" tabindex="0" title="${esc(`${x.name}（${x.label}）`)}">${x.logo
      ? `<span class="mono logo" aria-hidden="true"><img src="${esc(x.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.classList.remove('logo');this.parentNode.textContent='${esc(mono(x.name)).replace(/'/g, "")}'"></span>`
      : `<span class="mono" aria-hidden="true">${esc(mono(x.name))}</span>`}<div class="nm has-former"><span class="t">${esc(x.name)}</span>${(x.formerNames || []).length ? `<span class="kx-former" title="旧社名：${esc(x.formerNames.join("・"))}">旧：${esc(x.formerNames[x.formerNames.length - 1])}</span>` : ""}${kxPlTags(x)}</div></div>`;
  const lsTab = window.__lsTab || "all";
  const lsTabPrevSeen = window.__lsTabSeen; window.__lsTabPrev = lsTabPrevSeen; window.__lsTabSeen = lsTab;
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
    // 列の並び：見出しをつかんで動かせる（このブラウザに覚える）
    let colOrder = []; try { colOrder = JSON.parse(localStorage.getItem("kxCsColOrder") || "[]"); } catch {}
    const allCols = [{ ...none, key: "__none", isNone: true }, ...cols.map((c) => ({ ...c, isNone: false }))];
    allCols.sort((a2, b2) => { const ia = colOrder.indexOf(a2.key), ib = colOrder.indexOf(b2.key); return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib); });
    const colHtml = (c, isNone) => `<section class="kx-cscol${isNone ? " none" : ""}" data-cscol="${esc(c.name)}" data-colkey="${esc(isNone ? "__none" : c.key)}" draggable="true" title="列のどこでもつかむと、列を動かせます（会社のカードをつかむと、その会社が動きます）"><div class="kx-cscol-h"><span class="kx-grip" aria-hidden="true">⋮⋮</span><span class="av">${isNone ? "？" : esc(c.key.slice(0, 1))}</span><b>${isNone ? "未定" : esc(c.key)}</b><span class="n">${c.list.length}</span></div><div class="kx-cscol-b">${c.list.map((x) => card(x).replace('<div class="kx-uc ', '<div draggable="true" class="kx-uc ')).join("") || '<div class="kx-note" style="padding:6px 2px">ここにカードを動かすと、この人の担当になります</div>'}</div></section>`;
    $("lsTable").innerHTML = `<div class="kx-cswrap"><button type="button" class="kx-csnav l" data-csnav="-1" aria-label="左の担当へ" hidden>‹</button><div class="kx-csboard">${allCols.map((c) => colHtml(c, c.isNone)).join("")}</div><button type="button" class="kx-csnav r" data-csnav="1" aria-label="右の担当へ" hidden>›</button></div>`;
    kxFitCards();
    const board = $("lsTable").querySelector(".kx-csboard");
    // 画面は止めて、列ごとにスクロール。一覧で下までスクロールしていた位置が残ると、列の見出しが上に隠れるので戻す
    $("lsTable").style.overflowY = "hidden";
    $("lsTable").scrollTop = 0; board.scrollTop = 0;
    board.style.height = `${Math.max(260, window.innerHeight - board.getBoundingClientRect().top - 16)}px`;
    // まとめて選ぶ：Shiftを押しながらクリック、または右クリックで選ぶ／外す。選んだカードのどれかをつかむと、まとめて動く
    const sel = window.__csSel || (window.__csSel = new Set());
    for (const id of [...sel]) if (!d.items.some((i2) => i2.id === id)) sel.delete(id);
    const paintSel = () => {
      board.querySelectorAll("[data-open]").forEach((c) => c.classList.toggle("kx-picked", sel.has(c.dataset.open)));
      let bar = $("lsTable").querySelector(".kx-selbar");
      if (!sel.size) { if (bar) { bar.remove(); board.style.height = `${Math.max(260, window.innerHeight - board.getBoundingClientRect().top - 16)}px`; } return; }
      if (!bar) { bar = document.createElement("div"); bar.className = "kx-selbar"; $("lsTable").prepend(bar); }
      bar.innerHTML = `<b>${sel.size}社を選んでいます</b><span class="kx-note">選んだカードのどれかをつかんで、別の担当の列に動かすと、まとめて担当が変わります</span><button type="button" class="hp-b" data-sel-clear>選ぶのをやめる</button>`;
      bar.querySelector("[data-sel-clear]").onclick = () => { sel.clear(); paintSel(); };
      board.style.height = `${Math.max(260, window.innerHeight - board.getBoundingClientRect().top - 16)}px`;
    };
    const toggle = (id) => { if (sel.has(id)) sel.delete(id); else sel.add(id); paintSel(); };
    board.querySelectorAll("[data-open]").forEach((c) => {
      // Shift＋クリックは選ぶ（詳細は開かない）
      c.addEventListener("click", (e) => { if (e.shiftKey) { e.preventDefault(); e.stopImmediatePropagation(); toggle(c.dataset.open); } }, true);
      c.addEventListener("contextmenu", (e) => { e.preventDefault(); toggle(c.dataset.open); });
      c.addEventListener("dragstart", (e) => {
        const ids = sel.has(c.dataset.open) ? [...sel] : [c.dataset.open];
        e.dataTransfer.setData("text/plain", ids.join(","));
        board.querySelectorAll("[data-open]").forEach((x) => { if (ids.includes(x.dataset.open)) x.classList.add("dragging"); });
        if (ids.length > 1) { const g = document.createElement("div"); g.className = "kx-dragghost"; g.textContent = `${ids.length}社`; document.body.appendChild(g); e.dataTransfer.setDragImage(g, 20, 20); setTimeout(() => g.remove(), 0); }
      });
      c.addEventListener("dragend", () => { board.querySelectorAll(".dragging").forEach((x) => x.classList.remove("dragging")); board.querySelectorAll(".over").forEach((x) => x.classList.remove("over")); });
    });
    paintSel();
    // 横にスクロール：左右のボタン・Shift＋ホイール・カードを運びながら端に近づけると流れる
    const navs = $("lsTable").querySelectorAll("[data-csnav]");
    const paintNav = () => { const max = board.scrollWidth - board.clientWidth - 2; navs[0].hidden = board.scrollLeft <= 2; navs[1].hidden = board.scrollLeft >= max; };
    navs.forEach((b) => b.addEventListener("click", () => { board.scrollBy({ left: Number(b.dataset.csnav) * 540, behavior: "smooth" }); setTimeout(paintNav, 400); }));
    board.addEventListener("scroll", paintNav);
    // 横に動かす：列の中でも、横向きのスワイプ（トラックパッド）・Shift＋ホイールなら横に。列の外ではふつうのホイールも横に
    board.addEventListener("wheel", (e) => {
      const inCol = !!e.target.closest(".kx-cscol-b");
      const horiz = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (horiz) { board.scrollLeft += e.deltaX; e.preventDefault(); return; }
      if (e.shiftKey) { board.scrollLeft += e.deltaY; e.preventDefault(); return; }
      if (inCol) return;   // 列の中のふつうのホイールは、その列を縦に
      board.scrollLeft += e.deltaY; e.preventDefault();
    }, { passive: false });
    board.addEventListener("dragover", (e) => { const r0 = board.getBoundingClientRect(); if (e.clientX > r0.right - 70) board.scrollLeft += 18; else if (e.clientX < r0.left + 70) board.scrollLeft -= 18; });
    setTimeout(paintNav, 0);
    const COLT = "application/x-kx-col";
    // 列そのもの（どこでも）をつかむと列が動く。会社のカードをつかんだときは、カードの方
    board.querySelectorAll(".kx-cscol[draggable]").forEach((col0) => {
      col0.addEventListener("dragstart", (e) => {
        if (e.target.closest && e.target.closest("[data-open]")) return;
        e.dataTransfer.setData(COLT, col0.dataset.colkey); e.dataTransfer.effectAllowed = "move"; col0.classList.add("col-dragging");
      });
      col0.addEventListener("dragend", () => { board.querySelectorAll(".col-dragging,.col-over-l,.col-over-r").forEach((x) => x.classList.remove("col-dragging", "col-over-l", "col-over-r")); });
    });
    const isColDrag = (e) => [...(e.dataTransfer.types || [])].includes(COLT);
    board.querySelectorAll("[data-cscol]").forEach((col) => {
      col.addEventListener("dragover", (e) => {
        if (!isColDrag(e)) return;
        e.preventDefault(); e.stopImmediatePropagation();
        const r0 = col.getBoundingClientRect(); const left = e.clientX < r0.left + r0.width / 2;
        col.classList.toggle("col-over-l", left); col.classList.toggle("col-over-r", !left);
      }, true);
      col.addEventListener("dragleave", (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove("col-over-l", "col-over-r"); }, true);
      col.addEventListener("drop", (e) => {
        if (!isColDrag(e)) return;
        e.preventDefault(); e.stopImmediatePropagation();
        const from = e.dataTransfer.getData(COLT); const to = col.dataset.colkey;
        const left = col.classList.contains("col-over-l");
        col.classList.remove("col-over-l", "col-over-r");
        if (!from || from === to) return;
        const keys = [...board.querySelectorAll("[data-colkey]")].map((x) => x.dataset.colkey).filter((k2) => k2 !== from);
        const at = keys.indexOf(to) + (left ? 0 : 1);
        keys.splice(at, 0, from);
        try { localStorage.setItem("kxCsColOrder", JSON.stringify(keys)); } catch {}
        const sl = board.scrollLeft; renderList(); const nb = $("lsTable").querySelector(".kx-csboard"); if (nb) nb.scrollLeft = sl;
      }, true);
    });
    board.querySelectorAll("[data-cscol]").forEach((col) => {
      col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("over"); });
      col.addEventListener("dragleave", (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove("over"); });
      col.addEventListener("drop", async (e) => {
        e.preventDefault(); col.classList.remove("over");
        const ids = String(e.dataTransfer.getData("text/plain") || "").split(",").filter(Boolean);
        const to = col.dataset.cscol;
        const moving = ids.map((id2) => d.items.find((i2) => i2.id === id2)).filter((x) => x && sur(x.cs) !== sur(to));
        if (!moving.length) return;
        if (moving.length > 1 && !confirm(`${moving.length}社の担当を「${to ? sur(to) : "未定"}」にします。よろしいですか？`)) return;
        let ng = 0;
        for (const x of moving) {
          try { await api(`/api/kinxs/accounts/${encodeURIComponent(x.id)}`, { method: "PUT", body: JSON.stringify({ cs_name: to }) }); x.cs = to; }
          catch { ng++; }
        }
        sel.clear();
        renderList();
        if (ng) alert(`${ng}社は変えられませんでした。もう一度ためしてください`);
      });
    });
  } else {
    $("lsTable").style.overflowY = "";
    if (window.__lsTabPrev && window.__lsTabPrev !== "all") $("lsTable").scrollTop = 0;
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
function kxLinkBox(d) {
  const x = d.item || {};
  if (!x.manual) return "";
  return `<section class="kx-c2 kx-linkbox"><div class="kx-c2h"><b>SFの商談に紐づいていません</b><span class="kx-note">クロスの商談で受注しているもの（申込書回収（06）以降）か、追加商談（追加商談_X_）を選ぶと、その商談の商品・受注日・契約終了日、取引先のHPなどがSFから入ります（手で入れた中身は引き継ぎます）</span></div>
    <div class="row"><input class="kx-in" data-lk-q value="${esc(x.name)}" placeholder="会社名・商談名で探す" /><button type="button" class="hp-b" data-lk-search>探す</button></div>
    <div data-lk-list class="kx-lk-list"><span class="kx-note">探しています…</span></div>
    <div class="row"><input class="kx-in" data-lk-id placeholder="または、SFの商談のURL・ID（006…）を貼る（いくつでも、空白で区切る）" /><button type="button" class="hp-b" data-lk-id-go>この商談と紐づける</button></div>
  </section>`;
}
function kxCoPane(d) {
  const f = d.info || {}; const src = f.source || {};
  const tag = (k) => (src[k] ? `<span class="kx-src">${esc(src[k])}</span>` : "");
  const href = (u) => (/^https?:/.test(u) ? u : `https://${u}`);
  const val = (v, kind) => !v ? '<span class="kx-none">未登録</span>' : kind === "url" ? `<a href="${esc(href(v))}" target="_blank" rel="noopener">${esc(String(v).replace(/^https?:\/\//, "").replace(/\/$/, ""))} ↗</a>` : kind === "tel" ? `<a href="tel:${esc(v)}">${esc(v)}</a>` : kind === "mail" ? `<a href="mailto:${esc(v)}">${esc(v)}</a>` : esc(v);
  const contacts = f.contacts || [];
  const pw = (v) => `<span class="kx-pw" data-pw="${esc(v || "")}">••••••••</span><button type="button" class="hp-b" data-pw-show>見る</button><button type="button" class="hp-b" data-copy="${esc(v || "")}">コピー</button>`;
  const head = (t, edit) => `<div class="kx-c2h"><b>${t}</b>${edit ? '<button type="button" class="kx-ed" data-edit>編集</button>' : ""}</div>`;
  return `${kxLinkBox(d)}<div class="kx-co-grid">
    <div class="kx-co-col">
      <section class="kx-c2" data-sec>
        ${head("企業情報", true)}
        <div class="kx-view">
          <div class="kx-dl"><span>HP</span><div>${val(f.website, "url")} ${tag("website")}</div><span>住所</span><div>${val(f.address)} ${tag("address")}</div><span>電話番号</span><div>${val(f.phone, "tel")} ${tag("phone")}</div></div>
          ${f.sfNote && (!f.website || !f.address || !f.phone) ? `<div class="kx-note" style="margin-top:8px">${esc(f.sfNote)}${/見つかりません/.test(f.sfNote) ? "。「編集」で入れられます" : ""}</div>` : ""}
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
function kxLabelSchedPane(d) {
  const x = d.item || {}; const labs = new Set(x.prodLabels || []);
  const chip = (t, g) => `<button type="button" class="kx-us ${labs.has(t) ? "on" : ""}" data-pl="${esc(t)}" data-plg="${g}">${esc(t)}</button>`;
  const sns = (x.prodLabels || []).some((t) => KX_SNS_L.includes(t));
  const doc = (x.prodLabels || []).some((t) => KX_DOC_L.includes(t)) || !(x.prodLabels || []).length;
  const phases = (lsData && lsData.snsPhases) || (bdData && bdData.snsPhases) || ["計上", "コンテンツfix", "素材回収済", "制作指示出し済み", "初稿チェック前", "お客様初稿確認", "修正中", "修正チェック", "お客様修正案確認", "投稿依頼", "契約終了"];
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const order = ["計上予定", "フォローMTG設定済", "オンボーディング中", "利用中"]; const cur = order.indexOf(x.label);
  const sc = x.schedule;
  const schRows = sc && Array.isArray(sc.steps) ? sc.steps.map((st0) => { const pi = order.indexOf(st0.phase); const done = cur >= 0 && pi >= 0 && cur >= pi; const late = !done && st0.due < today; return `<div class="kx-sch-r ${done ? "done" : late ? "late" : "todo"}"><span class="d">${esc(st0.due.slice(5).replace("-", "/"))}${st0.estimated ? '<small class="kx-note">（目安）</small>' : ""}</span><span class="n">${esc(st0.name)}</span><span class="kx-note">${esc(st0.note || "")}</span><span class="st">${done ? "済" : late ? "遅れ" : "予定"}</span></div>`; }).join("") : "";
  const pis = x.productItems || [];
  const clsTag = (c) => (c ? `<span class="kx-pl ${KX_SNS_L.includes(c) ? "sns" : "doc"}">${esc(c)}</span>` : '<span class="kx-pl nosf" title="商品ラベルには入れない商品（取材費など）">対象外</span>');
  const prodTbl = `<div class="kx-sec"><div class="lb">SFの商談の商品<span class="kx-note" style="margin-left:8px">空間デザイン制作・スタンダード・ライト→空間／エントリー・アチコチバース→AI／取材費→対象外／それ以外→SNS</span></div>
      ${pis.length ? `<div class="kx-ptbl"><div class="h"><span>商品</span><span>区別</span><span>計上日</span><span>商談</span></div>${pis.map((p0) => `<div class="r"><span class="nm">${esc(p0.name)}</span><span>${clsTag(p0.cls)}</span><span>${esc(String(p0.booked || "").replace(/-/g, "/") || "—")}</span><span class="kx-note">${esc(p0.oppName || p0.stage || "")}</span></div>`).join("")}</div>` : '<div class="kx-note">SFの商談の商品がありません（手で追加した会社か、まだ取り込んでいません）</div>'}
    </div>`;
  return prodTbl + `<div class="kx-sec kx-form"><div class="lb">商品ラベル${x.prodLabelsAuto ? '<span class="kx-src" style="margin-left:6px">自動（SFの商品から）</span>' : ""}</div>
      <label>DOC</label><div class="kx-usage">${KX_DOC_L.map((t) => chip(t, "DOC")).join("")}</div>
      <label>SNS</label><div class="kx-usage">${KX_SNS_L.map((t) => chip(t, "SNS")).join("")}</div>
      <div class="kx-edact">${!x.prodLabelsAuto ? '<button type="button" class="hp-b" data-pl-auto>自動に戻す</button>' : ""}<button type="button" class="kx-btn kx-pri" data-pl-save>ラベルを保存</button></div>
      ${sns ? `<label>SNSのフェーズ</label><div><select class="kx-in" data-sns-phase>${phases.map((p0) => `<option ${p0 === (x.snsPhase || "計上") ? "selected" : ""}>${esc(p0)}</option>`).join("")}</select></div>` : ""}
    </div>
    ${doc ? `<div class="kx-sec"><div class="lb" style="display:flex;align-items:center;gap:8px">掲載までのスケジュール（DOC）${sc ? `<span class="kx-note">${esc(new Date(sc.at).toLocaleDateString("ja-JP"))} に議事録から作成</span>` : ""}<span style="margin-left:auto;display:flex;gap:6px">${sc ? '<button type="button" class="hp-b" data-sch-doc>スケジュール資料を開く</button>' : ""}<button type="button" class="hp-b" data-sch-make>${sc ? "議事録から作り直す" : "議事録から作る"}</button></span></div>
      ${sc ? `<div class="kx-sch">${schRows}</div>` : '<div class="kx-note">まだありません。キックオフ・フォローの議事録から、掲載までの段取りと日付を作ります（予定より遅れると要注意に出ます）。</div>'}<span class="kx-note" data-sch-st></span></div>` : ""}`;
}
function kxStatusPane(d) {
  const st = d.status || {}; const x = d.item || {}; const au = st.auto || {};
  const usages = (lsData && lsData.usages) || ["活用：公開掲載", "活用：限定公開", "活用予定", "活用検討中", "不明", "発生済み未納品", "解約企業"];
  const autoTag = (k) => (au[k] ? `<span class="kx-src">自動（${esc(au[k])}）</span>` : "");
  const none = '<span class="kx-none">未入力</span>';
  const naWhen = x.naAt ? new Date(x.naAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }) : x.naDue ? x.naDue.slice(5).replace("-", "/") : "";
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const late = x.naDue && x.naDue < today;
  // ふだんの表示（文字で見やすく）
  const view = `<section class="kx-c2 kx-view kx-stsum">
      <div class="kx-c2h"><b>ステータス</b><button type="button" class="kx-ed" data-read-all style="margin-left:auto">議事録・メールから読み取る</button><button type="button" class="kx-ed" data-edit style="margin-left:6px">編集</button></div>
      <div class="kx-stgrid">
        <div class="cell"><span>CS担当</span><b>${st.cs ? esc(st.cs) : none}</b>${autoTag("cs")}</div>
        <div class="cell"><span>フェーズ</span><b><span class="kx-lab l-${esc(st.phase || "")}">${esc(st.phase || "—")}</span></b>${st.locked ? '<span class="kx-src">手で決めた</span>' : '<span class="kx-src">自動</span>'}</div>
        <div class="cell wide"><span>利用目的</span><b>${st.purpose ? esc(st.purpose) : none}</b>${autoTag("purpose")}</div>
        <div class="cell wide"><span>活用</span><b>${st.usage ? `<span class="kx-usage-v">${esc(st.usage)}</span>` : none}</b>${autoTag("usage")}</div>
      </div>
      <div class="kx-nabox${late ? " late" : ""}">
        <div class="h"><span>次回アクション</span>${String(st.naSource || "").startsWith("auto") ? `<span class="kx-src">自動（${esc(String(st.naSource).replace("auto:", ""))}）</span>` : ""}</div>
        ${x.na ? `<div class="t">${x.naType ? `<span class="kx-natag">${esc(x.naType)}</span>` : ""}${esc(x.na)}</div><div class="w">${naWhen ? `${late ? "⚠ 期日を過ぎています　" : ""}${esc(naWhen)}` : "日時：未定"}</div>` : '<div class="kx-none">まだありません（「議事録・メールから読み取る」で自動で入れられます）</div>'}
        ${x.naSuggest ? `<div class="kx-note" style="margin-top:6px">提案があります（編集で確認できます）：${esc(x.naSuggest.content)}</div>` : ""}
      </div>
      <span class="kx-note" data-read-st></span>
    </section>`;
  // 編集（今までの入力欄）
  const edit = `<div class="kx-sec kx-form kx-editbox"><div class="lb">ステータスを編集</div>
      <label>CS担当</label>${(() => {
        const opts = [...new Set((st.csOptions || []).filter(Boolean))];
        const sur = (n) => String(n || "").normalize("NFKC").trim().split(/[\s　]+/)[0];
        let cur = st.cs || "";
        if (cur && !opts.includes(cur)) { const hit = opts.find((o) => sur(o) === sur(cur) || o.startsWith(sur(cur)) || sur(cur).startsWith(sur(o))); if (hit) cur = hit; else opts.push(cur); }
        return `<select class="kx-in" data-st="cs_name"><option value="">（未定）</option>${opts.map((o) => `<option ${o === cur ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
      })()}
      <label>利用目的</label><input class="kx-in" data-st="purpose" value="${esc(st.purpose || "")}" placeholder="例：採用サイト掲載・カジュアル面談" />
      <label>活用</label><div class="kx-usage">${usages.map((u) => `<button type="button" class="kx-us ${st.usage === u ? "on" : ""}" data-usage="${esc(u)}">${esc(u)}</button>`).join("")}</div>
      <div class="kx-edact"><button type="button" class="hp-b" data-cancel>やめる</button><button type="button" class="kx-btn kx-pri" data-save-status>保存</button></div>
    </div>`;
  return view + edit;
}
async function openDetail(id, reuse) {
  let d;
  try { d = await api(`/api/kinxs/accounts/${encodeURIComponent(id)}/detail`); } catch (e) { alert(e.message); return; }
  const x = d.item;
  // 保存したあとは、モーダルを閉じずに中身だけ描き直す（開いていたタブ・スクロールの位置もそのまま）
  const bg = (reuse && reuse.bg) || document.createElement("div"); bg.className = "kx-drawer-bg";
  const tog = (key, val, opts) => `<div class="kx-tog" data-tog="${key}">${opts.map(([v, t]) => `<button type="button" data-v="${v}" class="${String(val) === String(v) ? "on" : ""}">${t}</button>`).join("")}</div>`;
  bg.innerHTML = `<aside class="kx-drawer" role="dialog" aria-label="${esc(x.name)}" style="width:min(560px,100%)">
    <div style="display:flex;align-items:center;gap:14px">
      <div class="kx-dlogo" data-logo-btn role="button" tabindex="0" title="押すと、ロゴを取り直す・手で入れる">${x.logo ? `<img src="${esc(x.logo)}" alt="" data-logo-img" />` : `<span class="mono">${esc((x.name || "？").replace(/^(株式会社|有限会社|社会福祉法人|医療法人社団|医療法人|一般社団法人|公益財団法人|学校法人)\s*/, "").slice(0, 1))}</span>`}<span class="ed">ロゴ</span></div>
      <div style="min-width:0"><h2>${esc(x.name)}${(x.formerNames || []).length ? `<span class="kx-former-h">（旧：${esc(x.formerNames.slice().reverse().join("・旧："))}）</span>` : ""} <button type="button" class="kx-ren" data-ren-open title="社名が変わったとき">社名を変える</button></h2><div class="kx-note">${esc(x.products.join("・"))}</div></div><button type="button" class="kx-btn" data-archive style="margin-left:auto" title="${x.archived ? "ユーザー一覧・フェーズ別に戻す" : "動いていない会社を、ユーザー一覧・フェーズ別から見えなくする（あとで戻せる）"}">${x.archived ? "アーカイブから戻す" : "アーカイブする"}</button><button type="button" class="kx-btn" data-x>閉じる</button></div>
    ${x.archived ? '<div class="kh-warn" style="margin:0">この会社はアーカイブしています（ユーザー一覧・フェーズ別には出ません）</div>' : ""}
    <div class="kx-logo-menu" data-ren-box hidden>
      <div class="h" style="width:100%"><b>社名を変える</b><span class="kx-note">今の名前は「旧社名」として残り、「新しい社名（旧：今の社名）」と出ます</span><button type="button" class="hp-b" data-ren-close style="margin-left:auto">しまう ▲</button></div>
      <div class="row"><input class="kx-in" data-ren-name placeholder="新しい社名（例：株式会社ASCare）" /><button type="button" class="hp-b" data-ren-save>変える</button></div>
      <div class="row"><input class="kx-in" data-ren-former value="${esc((x.formerNames || []).join("、"))}" placeholder="旧社名（、で区切る）" /><button type="button" class="hp-b" data-ren-former-save>旧社名を直す</button><span class="kx-note" data-ren-st></span></div>
    </div>
    <div class="kx-logo-menu" data-logo-menu hidden>
      <div class="h" style="width:100%"><b>ロゴ</b>${x.logoManual ? '<span class="kx-src">手で決めたロゴ</span>' : '<span class="kx-src">自動（HPから）</span>'}<button type="button" class="hp-b" data-logo-close style="margin-left:auto">しまう ▲</button></div>
      <button type="button" class="hp-b" data-logo="refetch">HPから取り直す</button>
      <div class="row"><input class="kx-in" data-logo-url placeholder="画像のURLを貼る（https://…）" /><button type="button" class="hp-b" data-logo="url">使う</button></div>
      <div class="row"><label class="hp-b" style="cursor:pointer">画像ファイルを選ぶ<input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" data-logo-file hidden /></label><span class="kx-note">1MBまで。画面のスクリーンショットの切り抜きでも大丈夫です</span></div>
      <div class="row"><button type="button" class="hp-b" data-logo="clear">ロゴなし（頭文字）にする</button><span class="kx-note" data-logo-st style="margin-left:auto"></span></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="kx-lab l-${esc(x.label)}">${esc(x.label)}</span><span class="kx-rank r-${x.rank}">${x.rank}</span><span class="kx-note">更新月 ${x.renew ? esc(x.renew.replace("-", "/")) : "—"}${x.left != null ? `（${x.left < 0 ? `${-x.left}日過ぎ` : `あと${x.left}日`}）` : ""}${x.renewLocked ? "・手で決めた" : ""}</span>
      <button type="button" class="kx-ren" data-renew-open>更新月を変える</button>
      <span class="kx-renew-ed" data-renew-box hidden><input type="month" class="kx-in" data-renew-in value="${esc(x.renew || "")}" style="width:150px;height:30px" /><button type="button" class="hp-b" data-renew-save>保存</button>${x.renewLocked ? '<button type="button" class="hp-b" data-renew-auto title="手で決めた更新月をやめて、契約終了日の前月に戻す">自動に戻す</button>' : ""}<button type="button" class="hp-b" data-renew-cancel>やめる</button></span></div>
    ${x.alerts.length ? `<div class="kx-sec" style="background:#FFF7EA;border-color:#F0D5B0;color:#6B3700;font-size:12.5px"><b>要注意：</b>${x.alerts.map((a) => `${esc(a.rule)}（${esc(a.detail)}）`).join("／")}</div>` : ""}
    <div class="kx-tabs"><button type="button" class="on" data-tab="co">企業情報</button><button type="button" data-tab="info">ステータス</button><button type="button" data-tab="tl">議事録（${d.timeline.filter((t) => t.kind === "mtg").length}）</button></div>
    <div data-pane="co" style="display:flex;flex-direction:column;gap:12px">${kxCoPane(d)}</div>
    <div data-pane="info" hidden style="display:flex;flex-direction:column;gap:12px">
      ${kxStatusPane(d)}
      ${kxLabelSchedPane(d)}
      <div class="kx-sec"><div class="lb">更新確度</div><div class="kx-ranks">${RANKS.map(([k, l]) => `<button type="button" class="r-${k} ${x.rank === k ? "on" : ""}" data-rank="${k}" title="${esc(l)}" aria-label="${k} ${esc(l)}">${k}</button>`).join("")}</div></div>
      <div class="kx-sec"><div class="lb">フェーズ${x.locked ? "（手で決めています）" : "（自動）"}</div>
        <select class="kx-in" data-label><option value="">自動に任せる（いま：${esc(x.autoLabel)}）</option>${(lsData && lsData.labels || ["計上予定", "フォローMTG設定済", "オンボーディング中", "利用中", "更新検討時期", "解約予定", "解約済み", "キャンセル", "エラー"]).map((l) => `<option ${x.locked && x.label === l ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
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
    pane.setAttribute("data-sec", "");
    const top = pane.querySelector(".kx-editbox") || pane.firstElementChild;
    const lbl = (pane.querySelector("[data-label]") || {}).closest?.(".kx-sec");
    const rk = (pane.querySelector(".kx-ranks") || {}).closest?.(".kx-sec");
    const dl = (pane.querySelector('[data-tog="kenshu_done"]') || {}).closest?.(".kx-sec");
    if (lbl && top) { top.after(lbl); lbl.classList.add("kx-editbox"); }
    const naSec = (pane.querySelector("[data-na]") || {}).closest?.(".kx-sec");
    if (naSec) { naSec.classList.add("kx-editbox"); (lbl || top).after(naSec); }
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
  const refresh = async () => { if (VIEW === "list") await loadList(); else if (VIEW === "board") await loadBoard(); else if (VIEW === "home") return; else if (VIEW === "missing") return; else await load(); };
  const put = async (body, redraw = true) => { try { const r0 = await api(`/api/kinxs/accounts/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }); refresh().catch(() => {}); if (redraw) await again(r0 && r0.logoRefetched ? "保存して、新しいHPからロゴを取り直しました" : undefined); } catch (e) { alert(e.message); } };
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
  const ra = bg.querySelector("[data-read-all]");
  if (ra) ra.addEventListener("click", async () => {
    const st2 = bg.querySelector("[data-read-st]"); ra.disabled = true; st2.textContent = "議事録・メールを読んでいます…（30秒ほど）";
    try {
      const r = await api(`/api/kinxs/accounts/${encodeURIComponent(id)}/read-na`, { method: "POST" });
      if (!r.ok) { st2.textContent = r.reason || "読み取れませんでした"; ra.disabled = false; return; }
      refresh().catch(() => {}); await again((r.filled || []).length ? `${r.filled.join("・")}を入れました` : r.suggest ? "次回アクションの提案を出しました" : "読み取りました");
    } catch (e) { st2.textContent = "読めませんでした：" + e.message; ra.disabled = false; }
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
  { const li = bg.querySelector("[data-logo-img]"); if (li) li.addEventListener("error", () => { const sp = document.createElement("span"); sp.className = "mono"; sp.textContent = (x.name || "？").replace(/^(株式会社|有限会社|社会福祉法人|医療法人社団|医療法人|一般社団法人|公益財団法人|学校法人)\s*/, "").slice(0, 1); li.replaceWith(sp); }); }
  // 更新月を変える（手で決めた更新月は、SFからの取り込みでも上書きしない）
  { const rbx = bg.querySelector("[data-renew-box]"), rop = bg.querySelector("[data-renew-open]");
    if (rop) rop.addEventListener("click", () => { rbx.hidden = false; rop.hidden = true; rbx.querySelector("[data-renew-in]").focus(); });
    const rcn = bg.querySelector("[data-renew-cancel]"); if (rcn) rcn.addEventListener("click", () => { rbx.hidden = true; rop.hidden = false; });
    // 保存したら、待たずにその場で表示を変える（モーダルの上・後ろの画面）。サーバーで読み直した内容はあとから入れ直す
    const applyRenewLocal = (v) => {
      const left = v ? Math.round((Date.parse(`${v}-01T00:00:00+09:00`) - Date.now()) / 86400000) : null;
      const note = rop && rop.previousElementSibling;
      if (note) note.textContent = `更新月 ${v ? v.replace("-", "/") : "—"}${left != null ? `（${left < 0 ? `${-left}日過ぎ` : `あと${left}日`}）` : ""}・手で決めた`;
      rbx.hidden = true; rop.hidden = false;
      const fix = (arr) => { for (const it of (arr || [])) if (it.id === id) { it.renew = v; it.left = left; it.renewLocked = true; } };
      try { if (typeof data !== "undefined" && data && data.items) { fix(data.items); if (VIEW === "renew") render(); } } catch {}
      try { if (typeof lsData !== "undefined" && lsData && lsData.items) { fix(lsData.items); if (VIEW === "list") renderList(); } } catch {}
      try { if (typeof bdData !== "undefined" && bdData && bdData.items) { fix(bdData.items); if (VIEW === "board") renderBoard(); } } catch {}
    };
    const rsv = bg.querySelector("[data-renew-save]"); if (rsv) rsv.addEventListener("click", async () => {
      const v = rbx.querySelector("[data-renew-in]").value; if (!/^\d{4}-\d{2}$/.test(v)) { alert("更新月を選んでください"); return; }
      rsv.disabled = true;
      try { await api(`/api/kinxs/accounts/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ renew_month: v }) }); }
      catch (e) { rsv.disabled = false; alert(e.message); return; }
      applyRenewLocal(v);
      let toast = bg.querySelector(".kx-saved"); if (!toast) { toast = document.createElement("div"); toast.className = "kx-saved"; bg.querySelector(".kx-drawer").prepend(toast); }
      toast.textContent = `更新月を ${v.replace("-", "/")} にしました`; setTimeout(() => toast.remove(), 1800);
      refresh().catch(() => {}); again(`更新月を ${v.replace("-", "/")} にしました`).catch(() => {});
    });
    const rau = bg.querySelector("[data-renew-auto]"); if (rau) rau.addEventListener("click", async () => { try { await api(`/api/kinxs/accounts/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ renew_auto: true }) }); refresh().catch(() => {}); await again("更新月を自動（契約終了日の前月）に戻しました"); } catch (e) { alert(e.message); } }); }
  // SFの商談と紐づける（手で入れた会社）
  const lkList = bg.querySelector("[data-lk-list]");
  if (lkList) {
    const doLink = async (oppIds, label) => {
      if (!oppIds.length) return;
      if (!confirm(`「${x.name}」を、SFの${label}に紐づけます。よろしいですか？`)) return;
      lkList.innerHTML = '<span class="kx-note">紐づけています…（SFの商談・商品を読むので、少しかかります）</span>';
      try { const r = await api(`/api/kinxs/accounts/${encodeURIComponent(id)}/link-opps`, { method: "POST", body: JSON.stringify({ oppIds }) }); close(); refresh().catch(() => {}); setTimeout(() => openDetail(r.id).catch(() => {}), 400); }
      catch (e) { lkList.innerHTML = `<span class="kx-note">紐づけられませんでした：${esc(e.message)}</span>`; }
    };
    const search = async (q) => {
      lkList.innerHTML = '<span class="kx-note">探しています…</span>';
      try {
        const r = await api(`/api/kinxs/accounts/${encodeURIComponent(id)}/sf-opps${q ? `?q=${encodeURIComponent(q)}` : ""}`);
        const its = r.items || [];
        if (!its.length) { lkList.innerHTML = '<span class="kx-note">クロスの受注・追加商談が見つかりませんでした。名前を短くして探すか、商談のURLを貼ってください</span>'; return; }
        lkList.innerHTML = its.map((c) => `<label class="kx-lk${c.kind === "追加商談" ? " xadd" : ""}"><input type="checkbox" data-lk-cb="${esc(c.id)}" ${c.same && c.kind !== "追加商談" ? "checked" : ""} /><div class="nm">${esc(c.name)}<span class="kx-src" style="${c.kind === "追加商談" ? "background:#F0EAFB;color:#523490" : ""}">${esc(c.kind || "クロス")}</span>${c.same ? '<span class="kx-src">取引先名が同じ</span>' : ""}<small>${esc(c.account)}・${esc(c.stage)}${c.booked ? `・受注 ${esc(c.booked.replace(/-/g, "/"))}` : ""}${c.owner ? `・FS ${esc(c.owner)}` : ""}</small></div></label>`).join("")
          + `<div style="display:flex;justify-content:flex-end"><button type="button" class="kx-btn kx-pri" data-lk-sel>選んだ商談と紐づける</button></div>`;
        lkList.querySelector("[data-lk-sel]").addEventListener("click", () => { const ids = [...lkList.querySelectorAll("[data-lk-cb]:checked")].map((cb) => cb.dataset.lkCb); if (!ids.length) { alert("商談を選んでください"); return; } doLink(ids, `商談${ids.length}件`); });
      } catch (e) { lkList.innerHTML = `<span class="kx-note">探せませんでした：${esc(e.message)}</span>`; }
    };
    search("");
    bg.querySelector("[data-lk-search]").addEventListener("click", () => search(bg.querySelector("[data-lk-q]").value.trim()));
    bg.querySelector("[data-lk-id-go]").addEventListener("click", () => { const ids = (bg.querySelector("[data-lk-id]").value.match(/006[0-9a-zA-Z]{12}(?:[0-9a-zA-Z]{3})?/g) || []); if (!ids.length) { alert("商談のURLかID（006…）を貼ってください"); return; } doLink(ids, `商談${ids.length}件`); });
  }
  // アーカイブ
  const arcB = bg.querySelector("[data-archive]");
  if (arcB) arcB.addEventListener("click", async () => {
    const to = !x.archived;
    if (to && !confirm(`${x.name} をアーカイブします。ユーザー一覧・フェーズ別に出なくなります（ユーザー一覧の「アーカイブ」から戻せます）。よろしいですか？`)) return;
    try { await api(`/api/kinxs/accounts/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ archived: to }) }); for (const dd of [lsData, bdData]) if (dd && dd.items) for (const it of dd.items) if (it.id === id) it.archived = to; if (VIEW === "list") renderList(); if (VIEW === "board") renderBoard(); refresh().catch(() => {}); await again(to ? "アーカイブしました" : "アーカイブから戻しました"); } catch (e) { alert(e.message); }
  });
  // 商品ラベル・SNSのフェーズ・スケジュール
  bg.querySelectorAll("[data-pl]").forEach((b) => b.addEventListener("click", () => b.classList.toggle("on")));
  const pls = bg.querySelector("[data-pl-save]"); if (pls) pls.addEventListener("click", () => put({ prod_labels: [...bg.querySelectorAll("[data-pl].on")].map((b) => b.dataset.pl) }));
  const pla = bg.querySelector("[data-pl-auto]"); if (pla) pla.addEventListener("click", () => put({ prod_labels: null }));
  const snsS = bg.querySelector("[data-sns-phase]"); if (snsS) snsS.addEventListener("change", () => put({ sns_phase: snsS.value }));
  const schM = bg.querySelector("[data-sch-make]");
  if (schM) schM.addEventListener("click", async () => {
    const st2 = bg.querySelector("[data-sch-st]"); schM.disabled = true; st2.textContent = "議事録を読んでスケジュールを作っています…（30秒ほど）";
    try { const r = await api(`/api/kinxs/accounts/${encodeURIComponent(id)}/schedule`, { method: "POST" }); if (!r.ok) { st2.textContent = r.reason || "作れませんでした"; schM.disabled = false; return; } refresh().catch(() => {}); await again("スケジュールを作りました"); }
    catch (e) { st2.textContent = e.message; schM.disabled = false; }
  });
  const schD = bg.querySelector("[data-sch-doc]");
  if (schD) schD.addEventListener("click", () => {
    const sc = x.schedule; if (!sc) return; const w = window.open("", "_blank"); if (!w) return;
    const rowsH = sc.steps.map((st0) => `<tr><td>${esc(st0.due.replace(/-/g, "/"))}${st0.estimated ? "（目安）" : ""}</td><td>${esc(st0.name)}</td><td>${esc(st0.note || "")}</td></tr>`).join("");
    w.document.write(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(x.name)} 掲載までのスケジュール</title><style>body{font-family:"Hiragino Sans","Noto Sans JP",sans-serif;padding:32px;color:#1F2A26}h1{font-size:20px;margin:0 0 4px}p{color:#5A6B63;font-size:12px;margin:0 0 18px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #D5E2DB;padding:9px 12px;font-size:13px;text-align:left}th{background:#EEF6F1}td:first-child{white-space:nowrap;font-weight:700;width:130px}</style></head><body><h1>${esc(x.name)} 様　掲載までのスケジュール</h1><p>DOC（どこでもオープンカンパニー）／作成日 ${esc(new Date().toLocaleDateString("ja-JP"))}</p><table><thead><tr><th>日付</th><th>内容</th><th>備考</th></tr></thead><tbody>${rowsH}</tbody></table></body></html>`);
    w.document.close();
  });
  // 社名を変える
  const rbox = bg.querySelector("[data-ren-box]");
  const ro = bg.querySelector("[data-ren-open]"); if (ro) ro.addEventListener("click", (e) => { e.stopPropagation(); rbox.hidden = !rbox.hidden; if (!rbox.hidden) rbox.querySelector("[data-ren-name]").focus(); });
  const rc = bg.querySelector("[data-ren-close]"); if (rc) rc.addEventListener("click", () => { rbox.hidden = true; });
  const rst = bg.querySelector("[data-ren-st]");
  const rs = bg.querySelector("[data-ren-save]");
  if (rs) rs.addEventListener("click", async () => {
    const nn = bg.querySelector("[data-ren-name]").value.trim(); if (!nn) { rst.textContent = "新しい社名を入れてください"; return; }
    try { await api(`/api/kinxs/accounts/${encodeURIComponent(id)}/rename`, { method: "POST", body: JSON.stringify({ name: nn }) }); refresh().catch(() => {}); await again(`社名を「${nn}」にしました（旧：${x.name}）`); } catch (e) { rst.textContent = e.message; }
  });
  const rfs = bg.querySelector("[data-ren-former-save]");
  if (rfs) rfs.addEventListener("click", async () => {
    const list = bg.querySelector("[data-ren-former]").value.split(/[、,，\n]/).map((v) => v.trim()).filter(Boolean);
    try { await api(`/api/kinxs/accounts/${encodeURIComponent(id)}/rename`, { method: "POST", body: JSON.stringify({ former: list }) }); refresh().catch(() => {}); await again("旧社名を直しました"); } catch (e) { rst.textContent = e.message; }
  });
  // ロゴ：取り直す・URL・ファイル・なし
  const lmenu = bg.querySelector("[data-logo-menu]");
  const lbtn = bg.querySelector("[data-logo-btn]");
  // ふだんはしまっておく。ロゴを押すと開き、「しまう」・外を押す・Esc で閉じる
  if (lmenu) lmenu.hidden = true;
  if (lbtn) lbtn.addEventListener("click", (e) => { e.stopPropagation(); lmenu.hidden = !lmenu.hidden; });
  const lclose = bg.querySelector("[data-logo-close]"); if (lclose) lclose.addEventListener("click", () => { lmenu.hidden = true; });
  bg.addEventListener("click", (e) => { if (lmenu && !lmenu.hidden && !lmenu.contains(e.target) && !(lbtn && lbtn.contains(e.target))) lmenu.hidden = true; });
  bg.addEventListener("keydown", (e) => { if (e.key === "Escape" && lmenu && !lmenu.hidden) { e.stopPropagation(); lmenu.hidden = true; } });
  const lst = bg.querySelector("[data-logo-st]");
  const logoDo = async (body, msg) => {
    lst.textContent = "反映しています…";
    try {
      const r = await api(`/api/kinxs/accounts/${encodeURIComponent(id)}/logo`, { method: "POST", body: JSON.stringify(body) });
      refresh().catch(() => {});
      await again(body.mode === "refetch" ? (r.found ? "ロゴを取り直しました" : "HPからロゴが見つかりませんでした（URLかファイルで入れられます）") : msg);
    } catch (e) { lst.textContent = "できませんでした：" + e.message; }
  };
  bg.querySelectorAll("[data-logo]").forEach((b) => b.addEventListener("click", () => {
    const m = b.dataset.logo;
    if (m === "url") { const u = bg.querySelector("[data-logo-url]").value.trim(); if (!u) { lst.textContent = "画像のURLを入れてください"; return; } return logoDo({ mode: "url", url: u }, "ロゴを入れました"); }
    if (m === "clear") return logoDo({ mode: "clear" }, "ロゴなしにしました");
    return logoDo({ mode: "refetch" });
  }));
  const lf = bg.querySelector("[data-logo-file]");
  if (lf) lf.addEventListener("change", () => {
    const f = lf.files && lf.files[0]; if (!f) return;
    if (f.size > 1024 * 1024) { lst.textContent = "画像は1MBまでにしてください"; return; }
    const rd = new FileReader(); rd.onload = () => logoDo({ mode: "upload", data: rd.result }, "ロゴを入れました"); rd.readAsDataURL(f);
  });
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
const IM_FIELDS = [["name", "企業名（必須）"], ["renew", "更新月"], ["rank", "確度（S/A/B/C/Z/F）"], ["cs", "CS担当"], ["prod", "本番サイト（aticotiならVR、ほかはAI）"], ["product", "契約商品"], ["start", "契約開始日"], ["end", "契約終了日"], ["memo", "メモ"]];
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
    $("imPrev").innerHTML = `<div class="ls-grid" style="grid-template-columns:minmax(200px,1.6fr) minmax(200px,1.6fr) minmax(140px,1fr) 100px 70px minmax(110px,1fr) 130px;min-width:1000px">${["CS管理ボードの企業名", "kinXsの会社", "結果", "更新月", "確度", "CS担当", "本番サイト"].map((h) => `<div class="ls-h">${h}</div>`).join("")}` +
      r.items.map((x) => `<div class="ls-r" style="cursor:default">${esc(x.name)}</div><div class="ls-r" style="cursor:default">${esc(x.match || "—")}</div><div class="ls-r ${x.status === "一致" ? "ok-t" : x.status.startsWith("新しく") ? "mid-t" : "ng-t"}" style="cursor:default">${esc(x.status)}</div><div class="ls-r" style="cursor:default">${esc(x.renew ? x.renew.replace("-", "/") : "—")}</div><div class="ls-r" style="cursor:default">${x.rank ? `<span class="kx-rank r-${x.rank}">${x.rank}</span>` : "—"}</div><div class="ls-r" style="cursor:default">${esc(x.cs || "—")}</div><div class="ls-r" style="cursor:default;font-size:11.5px">${x.prod ? `${esc(x.prod)}へ` : "—"}</div>`).join("") + `</div>`;
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
  ["フォローMTG設定済", "CS連携に入った（キックオフMTG済み）、フォローMTGの前", "#3F72C9"],
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
// フェーズ別のカードの、会社名の隣のロゴ（無い・読めないときは頭文字）
function bdMono(n) { return String(n || "？").replace(/^(株式会社|有限会社|合同会社|社会福祉法人|医療法人社団|医療法人|一般社団法人|一般財団法人|公益社団法人|公益財団法人|学校法人)\s*/, "").replace(/(株式会社|有限会社)$/, "").trim().slice(0, 1) || "？"; }
function bdLogo(x) {
  return x.logo ? `<span class="bd-logo"><img src="${esc(x.logo)}" alt="" loading="lazy" data-bd-mono="${esc(bdMono(x.name))}" /></span>` : `<span class="bd-logo mono">${esc(bdMono(x.name))}</span>`;
}
function renderBoard() {
  const d = bdData; if (!d) return;
  const sel = $("bdCs"), cur = sel.value;
  kxSur = kxSurnameMap(d.items.map((x) => x.cs).filter(Boolean));
  const css = [...new Set(d.items.map((x) => kxSurname(x.cs)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
  sel.innerHTML = `<option value="">CS担当：全員</option>` + css.map((c) => `<option ${c === cur ? "selected" : ""}>${esc(c)}</option>`).join("") + `<option value="__none" ${cur === "__none" ? "selected" : ""}>CS担当：未定</option>`;
  const q = $("bdQ").value || "";
  const bdTrack = window.__bdTrack || "DOC";
  document.querySelectorAll("[data-bdtrack]").forEach((b) => b.classList.toggle("on", b.dataset.bdtrack === bdTrack));
  const items = d.items.filter((x) => !x.archived && (bdTrack === "SNS" ? kxHasSns(x) : kxHasDoc(x)) && kxMatch(q, x.name, x.formerNames || [], x.cs, x.fs, x.products, x.label) && (!sel.value || (sel.value === "__none" ? !x.cs : kxSurname(x.cs) === sel.value)));
  // SNSは、SNSのフェーズの列（DOCとSNSの両方をやっている会社は、カードにもう一方のフェーズを出す）
  const SNS_C = ["#7C8AA5", "#9B6BD6", "#3F72C9", "#2E8FB0", "#1D9E75", "#C9A227", "#E07A1F", "#D25F5F", "#B54F8E", "#5A63C7", "#3A3F3D"];
  if (bdTrack === "SNS") for (const x of items) x._ph = x.snsPhase || "計上"; else for (const x of items) x._ph = x.label;
  // 解約済み・キャンセルの列もいつも出す
  const cols = bdTrack === "SNS" ? (d.snsPhases || ["計上"]).map((l, i) => [l, "", SNS_C[i % SNS_C.length]]) : BD_COLS.filter(([l]) => l !== "エラー" || items.some((x) => x.label === "エラー"));
  const good = "background:#E1F5EE;color:#0A5440", bad = "background:#FBE4E4;color:#8C1F1F", mid = "background:#FFF1DC;color:#7A3F00";
  const card = (x) => `<div class="kx-card ${x.alerts.length ? "warn" : ""}" draggable="true" data-card="${esc(x.id)}" role="button" tabindex="0" title="押すと詳細／別の列にドラッグでラベルを変える">
      <div class="t">${bdLogo(x)}<span>${esc(x.name)}${(x.formerNames || []).length ? `<span class="kx-former" title="旧社名：${esc(x.formerNames.join("・"))}">旧：${esc(x.formerNames[x.formerNames.length - 1])}</span>` : ""}</span>${x.alerts.length ? '<span class="kx-rule" style="flex:none;font-size:10.5px">要注意</span>' : ""}</div>${kxPlTags(x)}${bdTrack === "DOC" && kxHasSns(x) ? `<div class="kx-other-ph sns">SNS：${esc(x.snsPhase || "計上")}</div>` : ""}${bdTrack === "SNS" && (x.prodLabels || []).some((t) => KX_DOC_L.includes(t)) ? `<div class="kx-other-ph doc">DOC：${esc(x.label)}</div>` : ""}
      <div class="p">${esc(x.products.join("・"))}</div>
      ${(x._ph === "更新検討時期" && bdTrack !== "SNS") || x.locked ? `<div class="bd">${x._ph === "更新検討時期" && bdTrack !== "SNS" ? `<span class="kx-rank r-${x.rank}" style="width:22px;height:22px;font-size:11.5px" title="更新の確度">${x.rank}</span>` : ""}
        ${x.locked ? '<span class="lock" title="手で決めたラベル">🔒</span>' : ""}</div>` : ""}
      <div class="f"><span class="av">${esc((kxSurname(x.cs) || "？").slice(0, 1))}</span>${esc(kxSurname(x.cs) || "CS未定")}<span style="margin-left:auto;${x.naDue && x.naDue < new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10) ? "color:#8C1F1F;font-weight:700" : ""}">${x.naDue ? `NA ${esc(x.naDue.slice(5).replace("-", "/"))}` : x.renew ? `更新 ${esc(x.renew.replace("-", "/"))}` : ""}</span></div>
    </div>`;
  $("bdCols").innerHTML = cols.map(([l, rule, color]) => {
    const list = items.filter((x) => x._ph === l).sort((a, b) => (b.score - a.score) || a.name.localeCompare(b.name, "ja"));
    return `<section class="kx-col" data-col="${esc(l)}"><div class="kx-col-h"><span style="width:10px;height:10px;border-radius:3px;background:${color}"></span><b>${esc(l)}</b><span class="n">${list.length}</span></div><div class="kx-col-r">${esc(rule)}</div><div class="kx-col-b">${list.map(card).join("") || '<div class="kx-note" style="padding:4px 2px">ありません</div>'}</div></section>`;
  }).join("");
  $("bdSt").textContent = `全${items.length}社`;
  kxFitBoard();
  document.querySelectorAll("#bdCols img[data-bd-mono]").forEach((im) => im.addEventListener("error", () => { const p0 = im.parentNode; p0.classList.add("mono"); p0.textContent = im.dataset.bdMono; }));
  // まとめて選ぶ：Shift＋クリック、または右クリックで選ぶ／外す。選んだカードのどれかをつかむと、まとめて動く（ユーザー一覧の担当別と同じ）
  const bsel = window.__bdSel || (window.__bdSel = new Set());
  for (const id0 of [...bsel]) if (!d.items.some((i) => i.id === id0)) bsel.delete(id0);
  const wrap = document.querySelector("#vBoard .kx-board-wrap");
  const paintB = () => {
    document.querySelectorAll("#bdCols [data-card]").forEach((c) => c.classList.toggle("kx-picked", bsel.has(c.dataset.card)));
    let bar = document.querySelector("#vBoard .kx-selbar");
    if (!bsel.size) { if (bar) { bar.remove(); kxFitBoard(); } return; }
    if (!bar) { bar = document.createElement("div"); bar.className = "kx-selbar"; wrap.parentNode.insertBefore(bar, wrap); }
    bar.innerHTML = `<b>${bsel.size}社を選んでいます</b><span class="kx-note">選んだカードのどれかをつかんで、別のフェーズの列に動かすと、まとめてフェーズが変わります</span><button type="button" class="hp-b" data-bsel-clear>選ぶのをやめる</button>`;
    bar.querySelector("[data-bsel-clear]").onclick = () => { bsel.clear(); paintB(); };
    kxFitBoard();
  };
  const toggleB = (id0) => { if (bsel.has(id0)) bsel.delete(id0); else bsel.add(id0); paintB(); };
  document.querySelectorAll("#bdCols [data-card]").forEach((c) => {
    c.addEventListener("click", (e) => { if (e.shiftKey) { e.preventDefault(); toggleB(c.dataset.card); return; } openDetail(c.dataset.card); });
    c.addEventListener("contextmenu", (e) => { e.preventDefault(); toggleB(c.dataset.card); });
    c.addEventListener("keydown", (e) => { if (e.key === "Enter") openDetail(c.dataset.card); });
    c.addEventListener("dragstart", (e) => {
      const ids = bsel.has(c.dataset.card) ? [...bsel] : [c.dataset.card];
      e.dataTransfer.setData("text/plain", ids.join(","));
      document.querySelectorAll("#bdCols [data-card]").forEach((x) => { if (ids.includes(x.dataset.card)) x.classList.add("dragging"); });
      if (ids.length > 1) { const g = document.createElement("div"); g.className = "kx-dragghost"; g.textContent = `${ids.length}社`; document.body.appendChild(g); e.dataTransfer.setDragImage(g, 20, 20); setTimeout(() => g.remove(), 0); }
    });
    c.addEventListener("dragend", () => { document.querySelectorAll("#bdCols .dragging").forEach((x) => x.classList.remove("dragging")); document.querySelectorAll(".kx-col.over").forEach((x) => x.classList.remove("over")); });
  });
  document.querySelectorAll("#bdCols [data-col]").forEach((col) => {
    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("over"); });
    col.addEventListener("dragleave", (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove("over"); });
    col.addEventListener("drop", async (e) => {
      e.preventDefault(); col.classList.remove("over");
      const ids = String(e.dataTransfer.getData("text/plain") || "").split(",").filter(Boolean);
      const to = col.dataset.col;
      const moving = ids.map((id0) => d.items.find((i) => i.id === id0)).filter((x) => x && (bdTrack === "SNS" ? (x.snsPhase || "計上") !== to : x.label !== to));
      if (!moving.length) return;
      if (moving.length > 1 && !confirm(`${moving.length}社の${bdTrack === "SNS" ? "SNSの" : ""}フェーズを「${to}」にします。よろしいですか？${bdTrack === "SNS" ? "" : "（手で決めたフェーズになります）"}`)) return;
      let ng = 0;
      for (const x of moving) {
        try { await api(`/api/kinxs/accounts/${encodeURIComponent(x.id)}`, { method: "PUT", body: JSON.stringify(bdTrack === "SNS" ? { sns_phase: to } : { main_label: to }) }); if (bdTrack === "SNS") x.snsPhase = to; else { x.label = to; x.locked = true; } }
        catch { ng++; }
      }
      bsel.clear(); renderBoard();
      if (ng) alert(`${ng}社は変えられませんでした。もう一度ためしてください`);
    });
  });
  paintB();
}
if ($("bdQ")) { $("bdQ").addEventListener("input", renderBoard); $("bdCs").addEventListener("change", renderBoard); }
document.querySelectorAll("[data-bdtrack]").forEach((b) => b.addEventListener("click", () => { window.__bdTrack = b.dataset.bdtrack; window.__bdSel && window.__bdSel.clear(); renderBoard(); }));
api("/api/me").then((me) => { window.__kxMe = (me && me.name) || ""; if (VIEW === "renew" && data) render(); }).catch(() => {});

// ===== ホーム：自分の担当ユーザーと、やること（kinXs・メール・チャット）=====
let _khBase = null, _khInbox = null, _khBusy = false, _khOwn = [];
async function loadHome(fresh) {
  const box = $("khTasks"); if (!box) return;
  if (fresh) { _khInbox = null; }
  try { [_khBase, _khOwn] = await Promise.all([api("/api/kinxs/home"), api("/api/kinxs/tasks").then((r) => r.items || []).catch(() => [])]); } catch (e) { box.innerHTML = `<div class="kx-empty">読み込めませんでした：${esc(e.message)}</div>`; return; }
  renderHome();
  // メール・チャットは、あとから足す（時間がかかるので、先に kinXs のやることを出しておく）
  _khBusy = true; renderHome();
  try { _khInbox = await api(`/api/kinxs/home/inbox${fresh ? "?fresh=1" : ""}`); } catch (e) { _khInbox = { tasks: [], notes: [`メール・チャットを読めませんでした：${e.message}`] }; }
  _khBusy = false; renderHome();
  // 前に読んだ結果を出したときは、裏で読み直しているので、少ししてもう一度
  if (_khInbox && _khInbox.stale) setTimeout(async () => { try { _khInbox = await api("/api/kinxs/home/inbox"); renderHome(); } catch {} }, 20000);
}
// ホーム：画面全体は止めて、「やること」と「自分の担当ユーザー」をそれぞれスクロールする
function kxFitHome() {
  if (VIEW !== "home") return;
  document.documentElement.style.overflow = "hidden";
  for (const id of ["khTasks", "khMine"]) {
    const el = $(id); if (!el) continue;
    const top = el.getBoundingClientRect().top;
    el.style.maxHeight = `${Math.max(200, window.innerHeight - top - 30)}px`;
    el.style.overflowY = "auto"; el.style.overscrollBehavior = "contain"; el.style.paddingRight = "4px";
  }
}
window.addEventListener("resize", () => kxFitHome());
function renderHome() {
  const d = _khBase; if (!d) return;
  const ib = _khInbox || { tasks: [], notes: [] };
  const today0 = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const ownBy = new Map((_khOwn || []).map((o) => [o.key, o]));
  const keyOf = (t) => t.key || `auto:c${Array.from(`${t.src}|${t.accountId || ""}|${t.kind}|${t.link || t.title}`).reduce((h, ch) => ((h * 31 + ch.charCodeAt(0)) >>> 0), 7).toString(36)}`;
  const auto = [...d.tasks, ...(ib.tasks || [])].map((t) => ({ ...t, key: keyOf(t) })).map((t) => { const o = ownBy.get(t.key); return o && o.deleted ? null : { ...t, id: o ? o.id : null, status: (o && o.status) || "未着手", due: (o && o.due) || t.due || "" }; }).filter(Boolean);
  const manual = (_khOwn || []).filter((o) => !o.deleted && String(o.key).startsWith("m:")).map((o) => ({ key: o.key, id: o.id, src: o.src || "手入力", kind: "タスク", title: o.title || "", account: o.account_name || "", accountId: o.account_id || "", due: o.due || "", status: o.status || "未着手", note: o.note || "" }));
  const bucketOf = (t) => (t.due && t.due < today0 ? "期限切れ" : t.due === today0 ? "今日" : t.due && t.due <= new Date(Date.now() + 9 * 3600000 + 6 * 86400000).toISOString().slice(0, 10) ? "今週" : (t.src !== "kinXs" ? "返事・依頼" : t.due ? "これから" : "期日なし"));
  const all = [...manual, ...auto].map((t) => ({ ...t, bucket: bucketOf(t) }));
  const tab = window.__khTab || "open";
  const cnt = { open: all.filter((t) => t.status !== "完了").length, doing: all.filter((t) => t.status === "進行中").length, done: all.filter((t) => t.status === "完了").length };
  const tasks = all.filter((t) => (tab === "done" ? t.status === "完了" : tab === "doing" ? t.status === "進行中" : t.status !== "完了"));
  const box = $("khTasks");
  $("khHi").textContent = `お疲れ様です${d.meSur || d.me ? `、${d.meSur || d.me}さん` : ""}`;
  $("khAt").textContent = `${_khBusy ? "メール・チャットを読んでいます…　" : ""}${ib.at ? `メール・チャットは ${new Date(ib.at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} に読みました（10分ごとに新しくします）` : ""}`;
  $("khNote").innerHTML = (ib.chatNeed ? `<div class="kh-warn">チャットを読むには、Google連携をやり直してください（チャットを読む許可を足しました）。<a href="/settings.html" target="_blank" rel="noopener">設定を開く ↗</a></div>` : "") + (ib.notes || []).map((n) => `<div class="kh-warn">${esc(n)}</div>`).join("");
  const order = ["期限切れ", "今日", "返事・依頼", "今週", "これから", "期日なし"];
  const cls = { "期限切れ": "late", "今日": "today" };
  const srcCls = { "kinXs": "kx", "メール": "ml", "チャット": "ch" };
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const row = (t) => `<div class="kh-t ${t.status === "完了" ? "done" : t.status === "進行中" ? "doing" : ""}" data-kh-key="${esc(t.key)}"><input type="checkbox" class="kh-cb" data-kh-done ${t.status === "完了" ? "checked" : ""} title="完了にする" /><span class="kh-src ${srcCls[t.src] || (t.src === "Claude" ? "cl" : "kx")}">${esc(t.src)}</span><div class="kh-main"><div class="tt">${esc(t.title)}</div>
      <div class="mt"><span>${esc(t.kind)}</span>${t.account ? `<span class="co" data-kh-open="${esc(t.accountId)}">${esc(t.account)}</span>` : ""}${t.from ? `<span>${esc(String(t.from).replace(/<.*>/, "").trim())}</span>` : ""}${t.space ? `<span>${esc(t.space)}</span>` : ""}${t.link ? `<a class="op" href="${esc(t.link)}" target="_blank" rel="noopener">${t.src === "メール" ? "Gmailで開く" : "チャットで開く"} ↗</a>` : ""}</div></div>
      <div class="kh-ctl"><span class="kh-duev ${t.due && t.due < today && t.status !== "完了" ? "late" : ""}">${t.due ? `期日 ${esc(t.due.slice(5).replace("-", "/"))}` : "期日なし"}</span><button type="button" class="kh-pen" data-kh-pen title="期日を直す" aria-label="期日を直す">✏️</button><input type="date" class="kh-due" data-kh-due value="${esc(t.due || "")}" hidden /><select class="kh-st" data-kh-st>${["未着手", "進行中", "完了"].map((v) => `<option ${v === t.status ? "selected" : ""}>${v}</option>`).join("")}</select><button type="button" class="kh-x" data-kh-del title="消す">×</button></div></div>`;
  const groups = tab === "done" ? (tasks.length ? [{ g: "完了", list: tasks }] : []) : order.map((g) => ({ g, list: tasks.filter((t) => t.bucket === g) })).filter((x) => x.list.length);
  const tb = $("khTabs");
  if (tb) {
    tb.innerHTML = [["open", "未完了", cnt.open], ["doing", "進行中", cnt.doing], ["done", "完了", cnt.done]].map(([k, l, n]) => `<button type="button" class="${tab === k ? "on" : ""}" data-kh-tab="${k}">${l} ${n}</button>`).join("");
    tb.querySelectorAll("[data-kh-tab]").forEach((b) => b.addEventListener("click", () => { window.__khTab = b.dataset.khTab; renderHome(); }));
  }
  const addSel = $("khAddCo");
  if (addSel && !addSel.dataset.filled) { addSel.innerHTML = '<option value="">会社（任意）</option>' + d.mine.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join(""); addSel.dataset.filled = "1"; }
  $("khCount").textContent = `${tasks.length}件`;
  box.innerHTML = (groups.length ? groups.map((x) => `<div class="kh-g"><div class="kh-gh ${cls[x.g] || ""}">${esc(x.g)}<span class="kx-rc">${x.list.length}</span></div>${x.list.map(row).join("")}</div>`).join("") : (_khBusy ? "" : '<div class="kx-empty">いまのところ、やることはありません</div>'))
    + (_khBusy ? '<div class="kh-loading"><span class="sp"></span>メールとチャットを読んでいます…（kinXsのやることは先に出しています）</div>' : "");
  const findT = (el) => all.find((t) => t.key === el.closest("[data-kh-key]").dataset.khKey);
  const setState = async (t, patch) => {
    try {
      if (t.id && !String(t.key).startsWith("auto:")) await api(`/api/kinxs/tasks/${t.id}`, { method: "PUT", body: JSON.stringify(patch) });
      else await api("/api/kinxs/tasks/state", { method: "POST", body: JSON.stringify({ key: t.key, title: t.title, accountId: t.accountId, account: t.account, src: t.src, status: patch.status || t.status, ...(patch.due !== undefined ? { due: patch.due } : {}), ...(patch.deleted ? { deleted: true } : {}) }) });
      _khOwn = await api("/api/kinxs/tasks").then((r) => r.items || []).catch(() => _khOwn); renderHome();
    } catch (e) { alert(e.message); }
  };
  const toast = (m) => { let el = document.querySelector(".kh-toast"); if (!el) { el = document.createElement("div"); el.className = "kh-toast"; document.body.appendChild(el); } el.textContent = m; el.classList.add("on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), 1800); };
  box.querySelectorAll("[data-kh-done]").forEach((cb) => cb.addEventListener("change", async () => { const t = findT(cb); if (!t) return; await setState(t, { status: cb.checked ? "完了" : "未着手" }); if (cb.checked) toast("完了にしました（「完了」のタブに移しました）"); }));
  box.querySelectorAll("[data-kh-st]").forEach((sl) => sl.addEventListener("change", async () => { const t = findT(sl); if (!t) return; await setState(t, { status: sl.value }); if (sl.value === "完了") toast("完了にしました（「完了」のタブに移しました）"); }));
  box.querySelectorAll("[data-kh-pen]").forEach((b) => b.addEventListener("click", () => {
    const di = b.parentNode.querySelector("[data-kh-due]"); const lab = b.parentNode.querySelector(".kh-duev");
    di.hidden = false; b.hidden = true; lab.hidden = true; di.focus(); try { di.showPicker && di.showPicker(); } catch {}
  }));
  box.querySelectorAll("[data-kh-due]").forEach((di) => {
    di.addEventListener("change", () => { const t = findT(di); if (t) setState(t, { due: di.value || null }); });
    di.addEventListener("blur", () => setTimeout(() => { if (!di.isConnected) return; di.hidden = true; const p0 = di.parentNode; p0.querySelector("[data-kh-pen]").hidden = false; p0.querySelector(".kh-duev").hidden = false; }, 200));
  });
  box.querySelectorAll("[data-kh-del]").forEach((b) => b.addEventListener("click", () => { const t = findT(b); if (t && confirm(`「${t.title}」を消しますか？`)) setState(t, { deleted: true }); }));
  const mono = (n) => String(n || "？").replace(/^(株式会社|有限会社|合同会社|社会福祉法人|医療法人社団|医療法人|一般社団法人|一般財団法人|公益社団法人|公益財団法人|学校法人)\s*/, "").slice(0, 1);
  $("khMineN").textContent = `${d.mine.length}社`;
  $("khMine").innerHTML = d.mine.length ? d.mine.map((x) => `<div class="kh-m" data-kh-open="${esc(x.id)}"><span class="lg">${x.logo ? `<img src="${esc(x.logo)}" alt="" loading="lazy" />` : esc(mono(x.name))}</span><span class="nm">${esc(x.name)}<small>${esc(x.label)}・更新 ${x.renew ? esc(x.renew.replace("-", "/")) : "—"}</small></span>${x.alerts ? `<span class="al">要注意</span>` : ""}<span class="kx-rank r-${x.rank}">${x.rank}</span></div>`).join("") : `<div class="kx-note">担当している会社がまだありません（ユーザー一覧の「担当別」で割り振れます）</div>`;
  document.querySelectorAll("#vHome [data-kh-open]").forEach((el) => el.addEventListener("click", () => el.dataset.khOpen && openDetail(el.dataset.khOpen)));
  document.querySelectorAll("#khMine img").forEach((im) => im.addEventListener("error", () => { im.parentNode.textContent = "・"; }));
  kxFitHome();
}
if ($("khReload")) $("khReload").addEventListener("click", () => loadHome(true));
if ($("khAddGo")) $("khAddGo").addEventListener("click", async () => {
  const title = $("khAddT").value.trim(); if (!title) { $("khAddT").focus(); return; }
  const sel = $("khAddCo"); const accId = sel.value; const accName = accId ? sel.options[sel.selectedIndex].text : "";
  try { await api("/api/kinxs/tasks", { method: "POST", body: JSON.stringify({ title, accountId: accId, accountName: accName, due: $("khAddD").value || null }) }); $("khAddT").value = ""; $("khAddD").value = ""; _khOwn = await api("/api/kinxs/tasks").then((r) => r.items || []); window.__khTab = "open"; renderHome(); }
  catch (e) { alert(e.message); }
});
if ($("khAddT")) $("khAddT").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) $("khAddGo").click(); });

// ===== 情報不足：FSにSFへ入れてもらう必須情報が足りない会社 =====
let msData = null;
async function loadMissing(fresh) {
  if ($("kxPageName")) $("kxPageName").textContent = "情報不足";
  $("msSt").textContent = "SFを読んでいます…";
  try { msData = await api(`/api/kinxs/missing${fresh ? "?fresh=1" : ""}`); } catch (e) { $("msList").innerHTML = `<div class="kx-empty">読み込めませんでした：${esc(e.message)}</div>`; return; }
  $("msSt").textContent = `${new Date(msData.at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} に読みました${msData.sfNote ? `（${msData.sfNote}）` : ""}`;
  const req = new Set(msData.required.map((r) => r.key));
  $("msReq").innerHTML = msData.allRequired.map((r) => `<label><input type="checkbox" data-req="${esc(r.key)}" ${req.has(r.key) ? "checked" : ""} />${esc(r.name)}</label>`).join("");
  $("msReq").querySelectorAll("[data-req]").forEach((cb) => cb.addEventListener("change", async () => {
    const list = [...$("msReq").querySelectorAll("[data-req]:checked")].map((x) => x.dataset.req);
    try { await api("/api/kinxs/missing/required", { method: "PUT", body: JSON.stringify({ required: list }) }); loadMissing(true); } catch (e) { alert(e.message); }
  }));
  renderMissing();
}
function renderMissing() {
  if (!msData) return;
  const q = ($("msQ").value || "").trim(); const fsSel = $("msFs"); const cur = fsSel.value;
  const who0 = window.__msWho || "FS";
  const fss = [...new Set(msData.items.filter((x) => (x.who || "FS") === who0).map((x) => x.fs || "（FS不明）"))].sort((a, b) => a.localeCompare(b, "ja"));
  fsSel.innerHTML = `<option value="">FS：全員</option>` + fss.map((f) => `<option ${f === cur ? "selected" : ""}>${esc(f)}</option>`).join("");
  const fk = window.__msField || "";
  // FSに頼む（9月以降に受注）／CSが入力（それより前）
  const who = window.__msWho || "FS";
  const pool = msData.items.filter((x) => (x.who || "FS") === who);
  const fromL = String(msData.from || "2026-09-01").slice(0, 7).replace("-", "年") + "月";
  const nFS = msData.items.filter((x) => (x.who || "FS") === "FS").length, nCS = msData.items.length - nFS;
  const list = pool.filter((x) => (!q || kxMatch(q, x.name, [], x.fs, x.cs)) && (!fsSel.value || (x.fs || "（FS不明）") === fsSel.value) && (!fk || (x.missKeys || []).includes(fk)));
  const req = msData.required;
  // まとめ：足りない会社の数、項目ごとの数（押すとその項目が足りない会社だけ）
  const perField = Object.fromEntries(req.map((r) => [r.key, pool.filter((x) => (x.missKeys || []).includes(r.key)).length]));
  const sum = $("msSum");
  if (sum) sum.innerHTML = `<div class="kx-seg kx-ms-who" role="tablist"><button type="button" class="${who === "FS" ? "on" : ""}" data-mswho="FS">FSに頼む（${esc(fromL)}以降の受注）${nFS}</button><button type="button" class="${who === "CS" ? "on" : ""}" data-mswho="CS">CSが入力（それより前）${nCS}</button></div>
    <div class="kx-ms-big"><span>情報が足りない会社</span><b>${pool.length}<small>社</small></b><em>${who === "FS" ? `${esc(fromL)}以降に受注した会社` : `${esc(fromL)}より前に受注した会社`}</em></div>
    <div class="kx-ms-fields">${req.map((r) => `<button type="button" class="kx-ms-f ${fk === r.key ? "on" : ""} ${perField[r.key] ? "" : "zero"}" data-msf="${esc(r.key)}" title="${esc(r.name)}"><span>${esc(r.short || r.name)}</span><b>${perField[r.key]}</b></button>`).join("")}${fk ? '<button type="button" class="kx-chip" data-msf="">項目の絞り込みを外す</button>' : ""}</div>`;
  if (sum) sum.querySelectorAll("[data-msf]").forEach((b) => b.addEventListener("click", () => { window.__msField = window.__msField === b.dataset.msf ? "" : b.dataset.msf; renderMissing(); }));
  if (sum) sum.querySelectorAll("[data-mswho]").forEach((b) => b.addEventListener("click", () => { window.__msWho = b.dataset.mswho; renderMissing(); }));
  // 表：FSごとのまとまり。行＝会社、列＝必須の項目（×＝足りない）
  const by = new Map(); for (const x of list) { const k2 = who === "CS" ? (x.cs ? kxSurname(x.cs) : "（CS未定）") : (x.fs || "（FS不明）"); (by.get(k2) || by.set(k2, []).get(k2)).push(x); }
  const cols = `minmax(220px,1.8fr) 84px ${req.map(() => "minmax(54px,.6fr)").join(" ")}`;
  const head = `<div class="kx-msx-h" style="grid-template-columns:${cols}"><span>会社</span><span>受注</span>${req.map((r) => `<span title="${esc(r.name)}">${esc(r.short || r.name)}</span>`).join("")}</div>`;
  const mono = (n) => String(n || "？").replace(/^(株式会社|有限会社|合同会社|社会福祉法人|医療法人社団|医療法人|一般社団法人|一般財団法人|公益社団法人|公益財団法人|学校法人)\s*/, "").slice(0, 1);
  $("msList").innerHTML = list.length ? [...by.entries()].sort((a, b) => b[1].length - a[1].length).map(([fs, xs]) => `<section class="kx-msx">
      <div class="kx-msx-g"><span class="av">${esc(fs.slice(0, 1))}</span><b>${esc(fs)}</b><span class="kx-rc">${xs.length}社</span><button type="button" class="hp-b" data-ms-copy="${esc(fs)}" style="margin-left:auto">${who === "CS" ? "CSに送る文をコピー" : "FSに送る文をコピー"}</button></div>
      <div class="kx-msx-tbl">${head}${xs.map((x) => `<div class="kx-msx-r" style="grid-template-columns:${cols}" data-ms-open="${esc(x.id)}" role="button" tabindex="0"><span class="co"><span class="lg">${x.logo ? `<img src="${esc(x.logo)}" alt="" loading="lazy" />` : esc(mono(x.name))}</span>${esc(x.name)}</span><span class="kx-note">${x.booked ? esc(x.booked.slice(2).replace(/-/g, "/")) : "—"}</span>${req.map((r) => (x.missKeys || []).includes(r.key) ? '<span class="c ng" title="足りない">×</span>' : '<span class="c ok">✓</span>').join("")}</div>`).join("")}</div>
    </section>`).join("") : '<div class="kx-empty">足りない会社はありません</div>';
  $("msList").querySelectorAll("[data-ms-open]").forEach((el) => el.addEventListener("click", () => openDetail(el.dataset.msOpen)));
  $("msList").querySelectorAll(".kx-msx-r img").forEach((im) => im.addEventListener("error", () => { im.parentNode.textContent = "・"; }));
  $("msList").querySelectorAll("[data-ms-copy]").forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation();
    const xs = by.get(b.dataset.msCopy) || [];
    const text = `${b.dataset.msCopy}さん\nお疲れ様です。kinXsで、Salesforceに入っていない情報がある会社をまとめました。お手数ですが、入力をお願いします。\n\n${xs.map((x) => `■${x.name}\n　${x.missing.join("・")}`).join("\n")}`;
    const lab0 = b.textContent;
    try { await navigator.clipboard.writeText(text); b.textContent = "コピーしました"; setTimeout(() => (b.textContent = lab0), 1500); } catch { prompt("コピーしてください", text); }
  }));
}
if ($("msQ")) { $("msQ").addEventListener("input", renderMissing); $("msFs").addEventListener("change", renderMissing); $("msReload").addEventListener("click", () => loadMissing(true)); }
if (VIEW === "missing") loadMissing(false);
if (VIEW === "home") { if ($("kxPageName")) $("kxPageName").textContent = "ホーム"; loadHome(false); }
if (VIEW === "list") loadList(); else if (VIEW === "renew") load(); else if (VIEW === "board") loadBoard();

// ===== 他のメンバーとして見る（田中欽也さんだけ。kinbotの「他メンバーとして操作」と同じ仕組み）=====
(async function kxImpersonation() {
  let me; try { me = await (await fetch("/api/me")).json(); } catch { return; }
  if (!me || !me.username) return;
  const H = (x) => String(x || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  if (me.impersonating) {
    const bar = document.createElement("div"); bar.className = "kx-imp-bar";
    bar.innerHTML = `<span aria-hidden="true">👤</span><span><b>${H(me.impersonator_name || me.impersonator_email || "元のアカウント")}</b> として、<b>${H(me.name || me.username)}</b> の kinXs を見ています（直した内容は、あなたの操作として残ります）</span><button type="button" class="kx-imp-back">← 元のアカウントに戻る</button>`;
    document.body.prepend(bar); document.body.classList.add("kx-imp-on");
    bar.querySelector(".kx-imp-back").addEventListener("click", async () => { try { const r = await fetch("/api/impersonate/stop", { method: "POST" }); if (!r.ok) throw new Error("戻れませんでした"); location.href = "/kinxs?p=home"; } catch (e) { alert(e.message); } });
  }
  if (!me.can_impersonate) return;
  const side = document.querySelector(".kx-side"); if (!side) return;
  const btn = document.createElement("button"); btn.type = "button"; btn.className = "kx-imp-btn";
  btn.innerHTML = `<span aria-hidden="true">🔀</span><span>${me.impersonating ? "ほかのメンバーに切りかえる" : "他メンバーとして見る"}</span>`;
  const back = side.querySelector(".kx-back") || side.lastElementChild;
  side.insertBefore(btn, back && back.nextSibling ? back.nextSibling : null);
  btn.addEventListener("click", async () => {
    const old = document.getElementById("kxImpPicker"); if (old) { old.remove(); return; }
    let users = []; try { users = (await (await fetch("/api/impersonate/users")).json()).users || []; } catch { alert("メンバーの一覧を読めませんでした"); return; }
    const mine = String(me.impersonator_email || me.username).toLowerCase();
    users = users.filter((u) => String(u.email || "").toLowerCase() !== mine);
    const m = document.createElement("div"); m.id = "kxImpPicker"; m.className = "imp-modal";
    m.innerHTML = `<div class="imp-modal-panel"><div class="imp-modal-h"><span>他のメンバーとして kinXs を見る</span><button type="button" class="imp-modal-x" aria-label="閉じる">×</button></div>
      <div class="imp-modal-note">選んだメンバーのホーム（担当ユーザー・やること）や画面を、その人として見られます。<b>直した内容は、あなたの操作として記録に残ります。</b></div>
      <input type="search" class="imp-modal-filter" placeholder="名前・メールで絞り込み" autocomplete="off" /><div class="imp-modal-list"></div></div>`;
    document.body.appendChild(m);
    const list = m.querySelector(".imp-modal-list");
    const render = (q) => { const qq = String(q || "").trim().toLowerCase(); const sh = users.filter((u) => !qq || String(u.name || "").toLowerCase().includes(qq) || String(u.email || "").toLowerCase().includes(qq));
      list.innerHTML = sh.length ? sh.map((u) => `<button type="button" class="imp-user" data-email="${H(u.email)}"><span class="imp-user-name">${H(u.name || u.email)}</span><span class="imp-user-email">${H(u.email)}</span></button>`).join("") : '<div class="imp-empty">該当するメンバーがいません</div>';
      list.querySelectorAll(".imp-user").forEach((el) => el.addEventListener("click", async () => {
        const nm = el.querySelector(".imp-user-name").textContent;
        if (!confirm(`${nm} として kinXs を見ます。よろしいですか？（記録に残ります）`)) return;
        try { const r = await fetch("/api/impersonate/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: el.dataset.email }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "切りかえられませんでした"); location.href = "/kinxs?p=home"; } catch (e) { alert(e.message); }
      })); };
    m.querySelector(".imp-modal-filter").addEventListener("input", (e) => render(e.target.value));
    m.querySelector(".imp-modal-x").addEventListener("click", () => m.remove());
    m.addEventListener("click", (e) => { if (e.target === m) m.remove(); });
    render(""); setTimeout(() => m.querySelector(".imp-modal-filter").focus(), 30);
  });
})();
