// kinXs と、そのコピー（kincs：/kincs）で同じ画面を使う。ページの移動先はここで切りかえる（2026-11-07）
const KX_BASE = window.KX_COPY ? "/kincs" : "/kinxs";
// kinXs 更新管理（更新月×更新確度）
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const RANKS = [["S", "更新確定"], ["A", "更新予定"], ["B", "検討中"], ["C", "解約検討"], ["Z", "未アプローチ"], ["F", "解約企業"]];
let data = null;
async function api(url, opts = {}) {
  // kincs（コピー）から呼ぶときは、その印を付ける（kincs だけに保存した内容を重ねて返してもらう）
  const r = await fetch(url, { headers: { "content-type": "application/json", ...(window.KX_COPY ? { "x-kx-app": "kincs" } : {}) }, ...opts });
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
// 苗字：早見表（kxSur）に無い名前でも、空白の無い漢字4文字以上の名前は頭の2文字にする（「皆葉優ブラッド」→「皆葉」）（2026-11-07：ホームで苗字とフルネームが混ざっていた）
const kxSurname = (n) => { if (!n) return ""; if (kxSur.has(n)) return kxSur.get(n); const t = String(n).normalize("NFKC").trim(); const b = t.split(/[\s　]+/)[0]; return /[\s　]/.test(t) ? b : (b.length >= 4 && /^[\p{Script=Han}]{2}/u.test(b) ? b.slice(0, 2) : b); };
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
  // DOC更新管理の対象は、受注商品に「アチコチバース」が入っている会社だけ（2026-11-06 久野さん）
  const items = d.items.filter((x) => kxIsAchiX(x) && kxTrackOk(x) && kxMatch(q, x.name, x.formerNames || [], x.cs, x.fs, x.products) && (!sel.value || (sel.value === "__none" ? !x.cs : kxSurname(x.cs) === sel.value)));
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
  if (kxRenewV2(items)) return;   // UI刷新（第1弾）：今月・来月・再来月のカード＋解約企業＋更新表の窓
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
  const chip = (x) => `<button type="button" class="kx-chipco v2" data-rk="${esc(x.rank)}" style="--rc:${RC[x.rank] || "#9AA8B8"}" draggable="true" data-id="${esc(x.id)}" title="${esc(`${x.name}${(x.formerNames || []).length ? `（旧：${x.formerNames.join("・")}）` : ""}\n確度 ${x.rank}・CS ${kxSurname(x.cs) || "未定"}${x.estimated ? "・終了日は推定" : ""}${x.warn ? "\n要注意（更新月が近いのに確度がB以下）" : ""}\n押すと詳細／ドラッグで確度・更新月を変える／右クリックで確度を選ぶ`)}">`
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
  const body = (pastRows.length ? `<div class="kx-sec-h past kx-band" data-past-toggle role="button" tabindex="0"><span>${pastOpen ? "▾" : "▸"}</span>更新月を過ぎた会社<em>${pastN}社</em><small>古い月から・チップの左が更新月／押すとたたむ・開く</small></div>${pastOpen ? `<div class="kx-mrow v2 past kx-pastbox" data-month=""><div class="kx-chips2">${pastChips.join("")}</div></div>` : ""}` : "")
    + `<div class="kx-sec-h kx-band next">これからの更新<em>${nextN}社</em></div>${nextRows.map((r) => r.html).join("")}`
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
      if (wrap.querySelector(".v2-board")) return;   // UI刷新：縦の表は、ふつうに縦へスクロール
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
const VIEW = ({ missing: "missing", home: "home", renew: "renew", list: "list", import: "import", cs: "cs", board: "board", settings: "settings", plan: "plan", trend: "trend", call: "call" })[new URLSearchParams(location.search).get("p")] || "home";
document.querySelectorAll(".kx-nav[data-view], .kx-side-set[data-view]").forEach((a) => a.classList.toggle("on", a.dataset.view === VIEW));
$("vList").hidden = VIEW !== "list"; if ($("vHome")) $("vHome").hidden = VIEW !== "home"; if ($("vMissing")) $("vMissing").hidden = VIEW !== "missing"; $("vRenew").hidden = VIEW !== "renew"; $("vImport").hidden = VIEW !== "import"; $("vCs").hidden = VIEW !== "cs"; $("vBoard").hidden = VIEW !== "board"; $("vSet").hidden = VIEW !== "settings"; if ($("vPlan")) $("vPlan").hidden = VIEW !== "plan"; if ($("vTrend")) $("vTrend").hidden = VIEW !== "trend"; if ($("vCall")) $("vCall").hidden = VIEW !== "call";
// ブラウザのタブは、どの画面でも「kinXs」だけ
document.title = window.KX_COPY ? "kincs" : "kinXs";   // コピー（kincs）ではタブの題名も kincs（2026-11-07）
// ヘッダー：今の画面の名前、画面に合わせたボタン、ログインしている人
$("kxPageName").textContent = ({ settings: "設定", board: "フェーズ別", renew: "DOC更新管理", list: "ユーザー一覧", import: "CS管理ボードから取り込む", cs: "CS連携（回収MTG）" })[VIEW] || "DOC更新管理";
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
      else location.href = `${KX_BASE}?p=list&kpi=${b.dataset.tk}`;
    }));
  }
  const n = ((u && u.items) || []).filter((x) => (x.alerts || []).length).length;
  const c = $("kxTopChip"); if (!c || !n) return;
  if (!window.KX_SHOW_TOP_ALERT) return;   // ヘッダーの「要注意 ○社」は、いまは出さない（2026-10-26）
  c.hidden = false; c.textContent = `要注意 ${n}社`;
  c.addEventListener("click", () => { location.href = KX_BASE + "?p=list"; });
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
const KX_DOC_L = ["空間", "AI"], KX_SNS_L = ["SNS", "Instagram", "配信代行", "動画制作"];
function kxPlTags(x) { const l = (x.prodLabels || []).map((t) => (t === "インスタ" ? "Instagram" : t)); return (l.length || x.manual) ? `<span class="kx-pltags">${l.map((t) => `<span class="kx-pl ${KX_SNS_L.includes(t) ? "sns" : "doc"}">${esc(t)}</span>`).join("")}${x.manual ? '<span class="kx-pl nosf" title="SFの商談に紐づいていません（モーダルの企業情報で紐づけられます）">SF未連携</span>' : ""}</span>` : ""; }
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
  window.__lsShown = items;   // CSVで書き出す用（いま表示している会社）
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
      <!-- ヘルプサイトのカードは、UI刷新（2026-11-04 久野さんの要望書）で外した -->
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
      <div style="min-width:0"><h2>${esc(x.name)}${(x.formerNames || []).length ? `<span class="kx-former-h">（旧：${esc(x.formerNames.slice().reverse().join("・旧："))}）</span>` : ""} <button type="button" class="kx-ren" data-ren-open title="社名が変わったとき">社名を変える</button></h2><div class="kx-prods" data-prods><div class="t">${esc(x.products.join("・"))}</div><button type="button" class="ar" data-prods-tog hidden aria-label="商品をすべて見る">▼ すべて見る</button></div></div><button type="button" class="kx-btn" data-archive style="margin-left:auto" title="${x.archived ? "ユーザー一覧・フェーズ別に戻す" : "動いていない会社を、ユーザー一覧・フェーズ別から見えなくする（あとで戻せる）"}">${x.archived ? "アーカイブから戻す" : "アーカイブする"}</button><button type="button" class="kx-btn" data-x>閉じる</button></div>
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
      ${kxNextActSection(x)}
      ${kxOpsSection(x)}
      ${kxStatusPane(d)}
      ${kxLabelSchedPane(d)}
      <div class="kx-sec"><div class="lb">更新確度</div><div class="kx-ranks">${RANKS.map(([k, l]) => `<button type="button" class="r-${k} ${x.rank === k ? "on" : ""}" data-rank="${k}" title="${esc(l)}" aria-label="${k} ${esc(l)}">${k}</button>`).join("")}</div></div>
      <div class="kx-sec"><div class="lb">フェーズ${x.locked ? "（手で決めています）" : "（自動）"}</div>
        <select class="kx-in" data-label><option value="">自動に任せる（いま：${esc(x.autoLabel)}）</option>${(lsData && lsData.labels || ["計上予定", "フォローMTG設定済", "オンボーディング中", "利用中", "更新検討時期", "解約予定", "解約済み", "キャンセル", "エラー"]).map((l) => `<option ${x.locked && x.label === l ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <div class="kx-note" style="margin-top:6px">手で決めると、自動では戻しません（自動に任せるに戻すと、また自動で付きます）</div></div>
      <div class="kx-sec" style="display:grid;grid-template-columns:96px 1fr;gap:8px 10px;align-items:center">
        <span class="kx-note">検収書</span><div>${tog("kenshu_done", x.kenshuNa ? "na" : x.kenshuDone === true ? true : x.kenshuDone === false ? false : "", [["true", "回収済み"], ["false", "未回収"], ["na", "対象外"]])}${x.kenshuDone == null && !x.kenshuNa ? `<div class="kx-note" style="margin-top:3px">いま：${esc(x.kenshu)}${x.kenshu.includes("自動") ? "（もう使っている会社なので、完了あつかい）" : ""}</div>` : ""}</div>
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
      ${kxSummarySection(x)}
      <div class="kx-sec"><div class="lb">電話・メールなど（議事録のない接触）を記録する</div>
        <div style="display:flex;gap:8px"><select class="kx-in" data-ctype style="max-width:110px"><option>電話</option><option>メール</option><option>Chat</option><option>商談</option><option>その他</option></select><input class="kx-in" data-ctext placeholder="話した内容を短く" /><button type="button" class="kx-btn" data-add-contact style="white-space:nowrap">記録する</button></div></div>
      ${(() => {
        const fmt = (t) => { const d0 = new Date(t); return isNaN(d0) ? "" : `${d0.getFullYear()}/${d0.getMonth() + 1}/${d0.getDate()} ${String(d0.getHours()).padStart(2, "0")}:${String(d0.getMinutes()).padStart(2, "0")}`; };
        const main = d.timeline.filter((t) => t.kind !== "label");
        const chg = d.timeline.filter((t) => t.kind === "label");
        const item = (t) => `<div class="it ${t.kind}" ${t.botId ? `data-mt="${esc(t.botId)}" role="button" tabindex="0" title="押すと議事録を開きます"` : ""}>
            <div class="t">${esc(t.title)}${t.botId ? ' <span class="kx-open">議事録を開く ›</span>' : ""}</div>
            <div class="m">${esc(fmt(t.at))}${t.owner ? `・${esc(t.owner)}` : ""}${(() => { const pm = t.botId && x.mtgSummary && x.mtgSummary.perMeeting && x.mtgSummary.perMeeting[t.botId]; return pm ? `<span class="v2-hwc">この回で決まった宿題：先方${pm.theirs}件／当社${pm.ours}件</span>` : ""; })()}</div>${t.summary ? `<div class="b">${esc(t.summary)}</div>` : ""}</div>`;
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
  bg.querySelectorAll("[data-tog]").forEach((g) => g.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => put(g.dataset.tog === "kenshu_done" && b.dataset.v === "na" ? { kenshu_na: true } : { [g.dataset.tog]: b.dataset.v === "true" }))));
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
const IM_FIELDS = [["name", "企業名（必須）"], ["renew", "更新月"], ["renew2", "更新月②（2回目の更新月）"], ["rank", "確度（S/A/B/C/Z/F）"], ["cs", "CS担当"], ["prod", "本番サイト（aticotiならVR、ほかはAI）"], ["product", "契約商品"], ["start", "契約開始日"], ["end", "契約終了日"], ["memo", "メモ"]];
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
  if (kxBoardV2(items, bdTrack, d)) return;   // UI刷新（第1弾）：横スクロールをやめて縦の表に
  // 解約済み・キャンセルの列もいつも出す
  const cols = bdTrack === "SNS" ? (d.snsPhases || ["計上"]).map((l, i) => [l, "", SNS_C[i % SNS_C.length]]) : BD_COLS.filter(([l]) => l !== "エラー" || items.some((x) => x.label === "エラー"));
  const good = "background:#E1F5EE;color:#0A5440", bad = "background:#FBE4E4;color:#8C1F1F", mid = "background:#FFF1DC;color:#7A3F00";
  const card = (x) => `<div class="kx-card ${x.alerts.length ? "warn" : ""}" draggable="true" data-card="${esc(x.id)}" role="button" tabindex="0" title="押すと詳細／別の列にドラッグでラベルを変える">
      <div class="t">${bdLogo(x)}<span>${esc(x.name)}${(x.formerNames || []).length ? `<span class="kx-former" title="旧社名：${esc(x.formerNames.join("・"))}">旧：${esc(x.formerNames[x.formerNames.length - 1])}</span>` : ""}</span>${x.alerts.length ? '<span class="kx-rule" style="flex:none;font-size:10.5px">要注意</span>' : ""}</div>${kxPlTags(x)}${bdTrack === "DOC" && kxHasSns(x) ? `<div class="kx-other-ph sns">SNS：${esc(x.snsPhase || "計上")}</div>` : ""}${bdTrack === "SNS" && (x.prodLabels || []).some((t) => KX_DOC_L.includes(t)) ? `<div class="kx-other-ph doc">DOC：${esc(x.label)}</div>` : ""}
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
// 情報不足：画面全体は止めて、会社の表のところだけスクロールする（2026-10-28）
function kxFitMissing() {
  if (VIEW !== "missing") return;
  const el = $("msList"); if (!el) return;
  document.documentElement.style.overflow = "hidden";
  el.style.maxHeight = `${Math.max(220, window.innerHeight - el.getBoundingClientRect().top - 16)}px`;
  el.style.overflowY = "auto"; el.style.overscrollBehavior = "contain"; el.style.paddingRight = "4px";
}
window.addEventListener("resize", () => kxFitMissing());
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
  kxFitMissing();
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
if ($("msQ")) { const st0 = document.querySelector(".kx-ms-set"); if (st0) st0.addEventListener("toggle", () => kxFitMissing()); $("msQ").addEventListener("input", renderMissing); $("msFs").addEventListener("change", renderMissing); $("msReload").addEventListener("click", () => loadMissing(true)); }
if (VIEW === "missing") loadMissing(true);   // 情報不足のページは、開くたびにSFを読み直す（2026-11-06）
if (VIEW === "home") { if ($("kxPageName")) $("kxPageName").textContent = "ホーム"; }   // ホームは UI刷新（第1弾）の loadHomeV2 で描く
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
    bar.querySelector(".kx-imp-back").addEventListener("click", async () => { try { const r = await fetch("/api/impersonate/stop", { method: "POST" }); if (!r.ok) throw new Error("戻れませんでした"); location.href = KX_BASE + "?p=home"; } catch (e) { alert(e.message); } });
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
        try { const r = await fetch("/api/impersonate/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: el.dataset.email }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "切りかえられませんでした"); location.href = KX_BASE + "?p=home"; } catch (e) { alert(e.message); }
      })); };
    m.querySelector(".imp-modal-filter").addEventListener("input", (e) => render(e.target.value));
    m.querySelector(".imp-modal-x").addEventListener("click", () => m.remove());
    m.addEventListener("click", (e) => { if (e.target === m) m.remove(); });
    render(""); setTimeout(() => m.querySelector(".imp-modal-filter").focus(), 30);
  });
})();

// ===================== kinXs UI刷新（第1弾）2026-11-04 久野さんの要望書 =====================
// ホーム（DOC受注社数・要アクション・更新表・情報不足）／更新管理（3か月分のカード・解約企業・更新表の窓）／フェーズ別（縦の表＋開閉）／年間施策・傾向分析（準備中）
const KX_RC2 = { S: "#0E6B4E", A: "#1D9E75", B: "#C99700", C: "#C43D3D", Z: "#8A949C", F: "#2F3532" };
const kxNowYm = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 7);
const kxYmAdd = (ym, n) => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const kxYmEnd = (ym) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
const kxYmLabel = (ym) => `${ym.slice(0, 4)}年${Number(ym.slice(5))}月`;
// 期（更新表）：CS管理DB（GAS）の更新表に合わせる（2026-11-06 久野さん）。27期＝2026年3月〜2027年1月、28期から＝2月〜翌1月
function kxPeriodOf(ym) { const [y, m] = ym.split("-").map(Number); if (ym >= "2027-02") return (m >= 2 ? y : y - 1) - 1999; return (m >= 3 ? y : y - 1) - 1999; }
function kxPeriodMonths(p) { if (p >= 28) return Array.from({ length: 12 }, (_, i) => kxYmAdd(`${p + 1999}-02`, i)); if (p === 27) return Array.from({ length: 11 }, (_, i) => kxYmAdd("2026-03", i)); return Array.from({ length: 12 }, (_, i) => kxYmAdd(`${p + 1999}-03`, i)); }
const kxPeriodLabel = (p) => { const ms = kxPeriodMonths(p); return `${p}期（${ms[0].slice(0, 4)}年${Number(ms[0].slice(5))}月〜${ms[ms.length - 1].slice(0, 4)}年${Number(ms[ms.length - 1].slice(5))}月）`; };
// 更新月か更新月②がその月の会社（更新表は両方で数える：CS管理DBと同じ）
const kxRenewIn = (x, ym) => x.renew === ym || (x.renew2 && x.renew2 === ym);
function kxRankBadge(r) { return `<span class="v2-rk" style="background:${KX_RC2[r] || "#8A949C"}">${esc(r || "Z")}</span>`; }
function kxLogoMini(x) { return `<span class="v2-lg">${x.logo ? `<img src="${esc(x.logo)}" alt="" loading="lazy" onerror="this.parentNode.textContent='・'" />` : esc(bdMono(x.name))}</span>`; }
// 会社の一覧を窓で出す（数字やカードを押したとき）。会社を押すと企業詳細
function kxCoListPopup(title, list) {
  document.querySelectorAll(".v2-pop-bg").forEach((x) => x.remove());
  const bg = document.createElement("div"); bg.className = "v2-pop-bg";
  bg.innerHTML = `<div class="v2-pop" role="dialog" aria-label="${esc(title)}"><div class="v2-pop-h"><b>${esc(title)}</b><span class="kx-note">${list.length}社</span><button type="button" class="kx-btn" data-x style="margin-left:auto">閉じる</button></div>
    <div class="v2-pop-b">${list.length ? list.map((x) => `<div class="v2-row" data-open="${esc(x.id)}" role="button" tabindex="0">${kxLogoMini(x)}<span class="nm">${esc(x.name)}</span>${kxRankBadge(x.rank)}<span class="kx-note">${esc(x.label || "")}</span><span class="kx-note">${esc(kxSurname(x.cs) || "CS未定")}</span><span class="kx-note">${x.renew ? `更新 ${esc(x.renew.replace("-", "/"))}` : ""}</span></div>`).join("") : '<div class="kx-empty">ありません</div>'}</div></div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
  bg.querySelector("[data-x]").addEventListener("click", close);
  bg.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", () => { close(); openDetail(el.dataset.open); }));
}
// 更新表：行＝更新月（3月〜翌2月）、列＝S・A・B・C・Z・他・計。B・Cは社数があるセルに色、表示中の月の行をハイライト
function kxRenewTableHtml(items, period, hlYm) {
  const months = kxPeriodMonths(period); const R = ["S", "A", "B", "C", "Z"];
  const hasOther = items.some((x) => months.includes(x.renew) && !R.includes(x.rank));
  const COLS = [...R, ...(hasOther ? ["他"] : []), "計"];
  const cell = (ym, r) => items.filter((x) => kxRenewIn(x, ym) && (r === "他" ? !R.includes(x.rank) : r === "計" ? true : x.rank === r));
  const tot = { S: 0, A: 0, B: 0, C: 0, Z: 0, 他: 0, 計: 0 };
  const rows = months.map((ym) => `<tr class="${ym === hlYm ? "hl" : ""}"><th>${Number(ym.slice(5))}月<small>${ym.slice(0, 4)}</small></th>${COLS.map((r) => { const n = cell(ym, r).length; tot[r] += n; return `<td class="${n && r === "B" ? "cb" : ""}${n && r === "C" ? " cc" : ""}${r === "計" ? " ct" : ""}">${n ? `<button type="button" data-rt="${ym}|${r}">${n}</button>` : '<span class="z">0</span>'}</td>`; }).join("")}</tr>`).join("");
  return `<div class="v2-rt-wrap"><table class="v2-rt"><thead><tr><th>更新月</th>${COLS.map((r) => `<th class="${r === "計" ? "ct" : ""}">${KX_RC2[r] ? kxRankBadge(r) : r}</th>`).join("")}</tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><th>合計</th>${COLS.map((r) => `<td class="${r === "計" ? "ct" : ""}">${tot[r]}</td>`).join("")}</tr></tfoot></table></div>
    <div class="kx-note" style="margin-top:4px">C：解約／B：継続か解約か未決定。数字を押すと会社の一覧</div>`;
}
function kxWireRenewTable(root, items) {
  root.querySelectorAll("[data-rt]").forEach((b) => b.addEventListener("click", () => {
    const [ym, r] = b.dataset.rt.split("|"); const R = ["S", "A", "B", "C", "Z"];
    kxCoListPopup(`${kxYmLabel(ym)} 更新・${r}`, items.filter((x) => kxRenewIn(x, ym) && (r === "他" ? !R.includes(x.rank) : r === "計" ? true : x.rank === r)));
  }));
}
function kxPeriodsOf(items) { const ps = [...new Set(items.map((x) => x.renew).filter(Boolean).map(kxPeriodOf))].sort((a, b) => b - a); const cur = kxPeriodOf(kxNowYm()); if (!ps.includes(cur)) ps.unshift(cur); return ps.sort((a, b) => b - a); }

// ---------- ホーム ----------
let kh2 = { ym: kxNowYm(), open: {}, period: null, miss: null };
async function loadHomeV2() {
  const box = $("kh2"); if (!box) return;
  if (!lsData) box.innerHTML = kxSkel("home");
  try { if (!lsData) lsData = await api("/api/kinxs/users"); kxSur = kxSurnameMap((lsData.items || []).map((x) => x.cs).filter(Boolean)); } catch (e) { box.innerHTML = `<div class="kx-empty">読み込めませんでした：${esc(e.message)}</div>`; return; }
  renderHomeV2();
  api("/api/kinxs/missing").then((d) => { kh2.miss = d; renderHomeV2(); }).catch(() => {});
}
// その月の月末の時点で数える（2026-11-04 直し：前は今の状態で数えていたので、前月比がいつも±0だった）
//   受注＝DOCを最初に受注した日（無ければ最初の受注日）が月末まで／稼働＝納品した日が月末まで／解約＝解約済みで、契約終了日（無ければ更新月）が月末まで
// 2026-11-06 久野さん：解約はアーカイブした会社も数える／申し込みは「今月お申込者数」（その月に受注した会社）／稼働は積み上げ（その月末までに納品した会社。あとで解約した会社も入れる）
function kxDocCounts(items, ym) {
  const E = kxYmEnd(ym), S = `${ym}-01`;
  const bk = (x) => x.docBooked || x.booked;
  const docs = items.filter((x) => kxHasDoc(x) && bk(x) && bk(x) <= E);   // アーカイブも入れる
  const churnOn = (x) => x.endOn || (x.renew ? `${x.renew}-01` : "");
  // 解約は、受注商品に「アチコチバース」が入っている会社だけ数える（2026-11-06 久野さん）
  const kai = docs.filter((x) => kxIsAchiX(x) && (x.label === "解約済み" || x.rank === "F" || x.archived) && (!churnOn(x) || churnOn(x) <= E));
  const ka = docs.filter((x) => x.delivered && (!x.deliveredOn || x.deliveredOn <= E));
  // 申し込みは「先月お申込者数」：表示している月の前の月に受注した会社（2026-11-06 久野さん）
  const pm = kxYmAdd(ym, -1), PS = `${pm}-01`, PE = kxYmEnd(pm);
  const mo = docs.filter((x) => bk(x) >= PS && bk(x) <= PE);
  return { all: docs, ka, mo, kai };
}
// ホームは1画面に収める（ページ全体はスクロールせず、要アクションの一覧だけが中で動く）（2026-11-04）
function kxFitHome2() {
  const box = $("kh2"); if (!box || VIEW !== "home") return;
  document.documentElement.style.overflow = "hidden";
  box.style.height = `${Math.max(480, window.innerHeight - box.getBoundingClientRect().top - 14)}px`;
}
window.addEventListener("resize", () => kxFitHome2());
// ヘッダーの月の切りかえ（ホーム・年間施策で使う）
function kxHeadMonth(ym, onMove) {
  const hm = $("kxHeadMonth"); if (!hm) return;
  hm.hidden = false;
  hm.innerHTML = `<button type="button" data-hm="-1" aria-label="前の月">‹</button><b>${kxYmLabel(ym)}</b><button type="button" data-hm="1" aria-label="次の月">›</button>${ym !== kxNowYm() ? '<button type="button" class="now" data-hm="0">今月</button>' : ""}`;
  hm.querySelectorAll("[data-hm]").forEach((b) => b.addEventListener("click", () => onMove(Number(b.dataset.hm))));
}
function renderHomeV2() {
  const box = $("kh2"); if (!box || !lsData) return;
  const items = (lsData.items || []).filter((x) => !x.archived);
  const allIt = lsData.items || [];   // 数字はアーカイブした会社も入れて数える
  const ym = kh2.ym; const c = kxDocCounts(allIt, ym), p = kxDocCounts(allIt, kxYmAdd(ym, -1));
  kxHeadMonth(ym, (n) => { kh2.ym = n === 0 ? kxNowYm() : kxYmAdd(kh2.ym, n); kh2.period = null; renderHomeV2(); });
  const dl = (a, b) => { const d = a - b; return `<span class="h2-d ${d > 0 ? "up" : d < 0 ? "dn" : ""}">${d > 0 ? "▲" : d < 0 ? "▼" : "±"}${Math.abs(d)}<small>前月比</small></span>`; };
  const tot = Math.max(1, c.all.length);
  // 要アクション
  const actRows = items.filter((x) => kxHasDoc(x)).flatMap((x) => (x.actions || []).map((a) => ({ x, a }))).sort((u, v) => (u.a.left ?? 0) - (v.a.left ?? 0));
  const actCos = new Set(actRows.map((r) => r.x.id)).size;
  const kinds = [["ko", "キックオフ未実施", (a) => a.kind === "キックオフ未実施", "#E0A100"], ["ks", "検収書 未回収", (a) => a.kind === "検収書 未回収", "#C43D3D"], ["na", "施策・次回アクション", (a) => a.group === "納品後", "#3F72C9"]];
  const kf = kh2.kf || ""; const shown = actRows.filter((r) => !kf || kinds.find((k) => k[0] === kf)[2](r.a));
  // 3か月の更新
  const docs = items.filter((x) => kxHasDoc(x));
  const R = ["S", "A", "B", "C", "Z"];
  const renewMonths = [0, 1, 2].map((n) => { const m = kxYmAdd(kxNowYm(), n); const l = docs.filter((x) => kxRenewIn(x, m) && x.label !== "解約済み" && x.rank !== "F"); return { m, l, by: R.map((r) => [r, l.filter((x) => x.rank === r).length]) }; });
  // 情報不足
  const ms = kh2.miss; const msItems = ms ? ms.items || [] : []; const req = ms ? ms.required || [] : [];
  const reqN = req.map((r) => [r, msItems.filter((x) => (x.missKeys || []).includes(r.key)).length]).sort((a, b) => b[1] - a[1]);
  const maxReq = Math.max(1, ...reqN.map((x) => x[1]));
  box.innerHTML = `
  <div class="h2-kpi">
    <button type="button" class="h2-hero" data-kpi="all"><span class="l">DOC受注社数</span><span class="v" data-cu="${c.all.length}">${c.all.length}<small>社</small></span>${dl(c.all.length, p.all.length)}
      <span class="h2-mix" data-grow><i style="width:${(c.ka.length / tot) * 100}%" class="ka"></i><i style="width:${(c.mo.length / tot) * 100}%" class="mo"></i><i style="width:${(c.kai.length / tot) * 100}%" class="kai"></i></span>
      <span class="h2-leg"><span><i class="ka"></i>稼働 ${Math.round((c.ka.length / tot) * 100)}%</span><span><i class="mo"></i>先月お申込み ${Math.round((c.mo.length / tot) * 100)}%</span><span><i class="kai"></i>解約 ${Math.round((c.kai.length / tot) * 100)}%</span></span></button>
    ${[["ka", "稼働社数（積み上げ）", "その月末までに納品した会社", c.ka, p.ka, "ka"], ["mo", "先月お申込者数", `${Number(kxYmAdd(ym, -1).slice(5))}月に受注した会社`, c.mo, p.mo, "mo"], ["kai", "解約社数", "アチコチバースの解約（アーカイブも含む）", c.kai, p.kai, "kai"]].map(([k, l, s, cur, prev, cls]) => `<button type="button" class="h2-card ${cls}" data-kpi="${k}"><span class="dot"></span><span class="l">${l}</span><span class="v" data-cu="${cur.length}">${cur.length}<small>社</small></span><span class="s">${s}</span>${dl(cur.length, prev.length)}</button>`).join("")}
  </div>
  <div class="h2-row">
    <section class="h2-box h2-act"><div class="h2-h"><h2>要アクション</h2><span class="h2-big" data-cu="${actCos}">${actCos}<small>社</small></span><span class="h2-sub">事前アラート</span></div>
      <div class="h2-tiles">${kinds.map(([k, l, f, col]) => `<button type="button" class="${kf === k ? "on" : ""}" data-kf="${k}" style="--c:${col}"><b>${actRows.filter((r) => f(r.a)).length}</b><span>${l}</span></button>`).join("")}</div>
      <div class="h2-list">${shown.map(({ x, a }) => `<div class="h2-li" data-open="${esc(x.id)}" role="button" tabindex="0"><span class="pin ${a.left < 0 ? "over" : a.left <= 3 ? "soon" : ""}">${a.left == null ? "" : a.left < 0 ? `${-a.left}日過ぎ` : `あと${a.left}日`}</span><span class="co">${kxLogoMini(x)}<b>${esc(x.name)}</b></span><span class="what">${esc(a.detail.replace(/（[^）]*日[^）]*）$/, ""))}</span><span class="who">${esc(kxSurname(x.cs) || "CS未定")}</span></div>`).join("") || '<div class="kx-empty">ありません 🎉</div>'}</div>
      </section>
    <div class="h2-side"><section class="h2-box h2-ren"><div class="h2-h"><h2>これからの更新</h2><button type="button" class="h2-link" data-rt-modal>更新表を見る ›</button></div>
      ${renewMonths.map((r, i) => `<button type="button" class="h2-rm" data-rm="${r.m}"><span class="m"><b>${Number(r.m.slice(5))}月</b><small>${["今月", "来月", "再来月"][i]}</small></span><span class="st" data-grow>${r.by.map(([rk, n]) => `<i style="flex:${n};background:${KX_RC2[rk]}" title="${rk} ${n}社"></i>`).join("")}${r.l.length ? "" : '<em>なし</em>'}</span><span class="rk">${r.by.filter(([, n]) => n).map(([rk, n]) => `<span>${kxRankBadge(rk)}${n}</span>`).join("")}</span><span class="n">${r.l.length}<small>社</small></span></button>`).join("")}
      </section>
  <section class="h2-box h2-miss"><div class="h2-h"><h2>情報不足の企業</h2>${ms ? `<span class="h2-big" data-cu="${msItems.length}">${msItems.length}<small>社</small></span>` : ""}<a class="h2-link" href="/kinxs?p=missing">情報不足へ ›</a></div>
    ${ms ? `<div class="h2-bars">${reqN.filter(([, n]) => n).map(([r, n]) => `<button type="button" class="h2-bar" data-miss="${esc(r.key)}"><span class="k">${esc(r.short || r.name)}</span><span class="b" data-grow><i style="width:${(n / maxReq) * 100}%"></i></span><span class="n">${n}</span></button>`).join("") || '<div class="h2-note">足りない情報はありません</div>'}</div>` : '<div class="h2-note">SFを読んでいます…</div>'}</section></div>
  </div>`;
  kxFitHome2();
  // 動きは1回だけ：月を開いた（変えた）ときに全体を1回。情報不足は、あとから読めたときにその枠だけ1回（2026-11-04 「2回読み込まれるのやめてほしい」）
  if (kh2.animKey !== ym) { kh2.animKey = ym; kh2.missAnim = !!ms; kxCountUp(box); }
  else if (ms && !kh2.missAnim) { kh2.missAnim = true; kxCountUp(box.querySelector(".h2-miss")); }
  box.querySelectorAll("[data-kpi]").forEach((b) => b.addEventListener("click", () => { const k = b.dataset.kpi; kxCoListPopup({ all: "DOC受注社数", ka: "稼働社数（積み上げ）", mo: "先月お申込者数", kai: "解約社数（アーカイブも含む）" }[k] + `（${kxYmLabel(ym)}）`, c[k]); }));
  box.querySelectorAll("[data-kf]").forEach((b) => b.addEventListener("click", () => { kh2.kf = kh2.kf === b.dataset.kf ? "" : b.dataset.kf; renderHomeV2(); }));
  box.querySelectorAll("[data-open-sec]").forEach((b) => b.addEventListener("click", () => { kh2.open[b.dataset.openSec] = !kh2.open[b.dataset.openSec]; renderHomeV2(); }));
  box.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", () => openDetail(el.dataset.open)));
  box.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { const m = b.dataset.rm; kxCoListPopup(`${kxYmLabel(m)} 更新`, docs.filter((x) => kxRenewIn(x, m) && x.label !== "解約済み" && x.rank !== "F")); }));
  const rtm = box.querySelector("[data-rt-modal]"); if (rtm) rtm.addEventListener("click", () => kxRenewTableModal(docs));
  box.querySelectorAll("[data-miss]").forEach((b) => b.addEventListener("click", () => { const r = req.find((x) => x.key === b.dataset.miss); kxCoListPopup(`情報不足：${r.short || r.name}がない`, msItems.filter((x) => (x.missKeys || []).includes(r.key)).map((x) => ({ ...x, ...(items.find((y) => y.id === x.id) || {}) }))); }));
}

// ---------- 更新管理：今月・来月・再来月の会社カード、期の区切り、解約企業、更新表の窓 ----------
function kxRenewV2(itemsR) {
  const host = $("kxTable"); if (!host) return false;
  const ranks = window.__rnRanks || new Set();
  const all = (lsData && lsData.items) ? lsData.items.filter((x) => !x.archived) : null;
  if (!all) { api("/api/kinxs/users").then((d) => { lsData = d; render(); }).catch(() => {}); host.innerHTML = '<div class="kx-empty">読み込み中…</div>'; return true; }
  const okIds = new Set(itemsR.map((x) => x.id));
  const items = all.filter((x) => okIds.has(x.id) && (!ranks.size || ranks.has(x.rank)));
  const ym0 = kxNowYm(); const months = [0, 1, 2].map((n) => kxYmAdd(ym0, n));
  const card = (x) => `<button type="button" class="v2-card" data-open="${esc(x.id)}">${kxLogoMini(x)}<span class="nm">${esc(x.name)}</span><span class="kx-note">担当：${esc(kxSurname(x.cs) || "未定")}</span>${kxRankBadge(x.rank)}</button>`;
  const past = items.filter((x) => x.renew && x.renew < ym0 && x.label !== "解約済み" && x.rank !== "F");
  let html = `<div class="v2-rn-bar"><span class="kx-note">ランク：</span>${["S", "A", "B", "C", "Z"].map((r) => `<button type="button" class="v2-rkb ${ranks.has(r) ? "on" : ""}" data-rk="${r}" style="--c:${KX_RC2[r]}">${r}</button>`).join("")}<button type="button" class="kx-btn kx-pri" data-rt-open style="margin-left:auto">更新表を見る</button></div>`;
  if (past.length) html += `<details class="v2-past"><summary>更新月を過ぎた会社（${past.length}社）</summary><div class="v2-cards">${past.sort((a, b) => a.renew.localeCompare(b.renew)).map(card).join("")}</div></details>`;
  months.forEach((ym, i) => {
    if (i > 0 && ym.slice(5) === "03") { const p = kxPeriodOf(ym); html += `<div class="v2-cut"><span>${p - 1}期 ここまで ／ ここから${p}期</span></div>`; }
    const list = items.filter((x) => kxRenewIn(x, ym) && x.label !== "解約済み" && x.rank !== "F");
    html += `<section class="v2-sec"><h2>${["今月更新", "来月更新", "再来月更新"][i]} <span class="kx-note">${kxYmLabel(ym)}・${list.length}社</span></h2><div class="v2-cards">${list.map(card).join("") || '<div class="kx-empty">ありません</div>'}</div></section>`;
  });
  const kai = items.filter((x) => x.label === "解約済み" || x.rank === "F").sort((a, b) => String(b.endOn || b.renew || "").localeCompare(String(a.endOn || a.renew || "")));
  const showAll = window.__rnKaiAll;
  html += `<section class="v2-sec"><h2>解約企業 <span class="kx-note">これまでの解約企業すべて・${kai.length}社</span></h2><div class="v2-cards">${(showAll ? kai : kai.slice(0, 12)).map((x) => `<button type="button" class="v2-card" data-open="${esc(x.id)}">${kxLogoMini(x)}<span class="nm">${esc(x.name)}</span><span class="kx-note">解約月：${esc(((x.endOn || x.renew || "").slice(0, 7)).replace("-", "年") + ((x.endOn || x.renew) ? "月" : "—"))}</span>${kxRankBadge("C")}</button>`).join("") || '<div class="kx-empty">ありません</div>'}</div>${kai.length > 12 ? `<button type="button" class="kx-btn" data-kai-all>${showAll ? "たたむ" : `すべて見る（${kai.length}社）`}</button>` : ""}</section>`;
  host.innerHTML = html;
  host.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", () => openDetail(el.dataset.open)));
  host.querySelectorAll("[data-rk]").forEach((b) => b.addEventListener("click", () => { const s = window.__rnRanks = window.__rnRanks || new Set(); s.has(b.dataset.rk) ? s.delete(b.dataset.rk) : s.add(b.dataset.rk); render(); }));
  const ka = host.querySelector("[data-kai-all]"); if (ka) ka.addEventListener("click", () => { window.__rnKaiAll = !window.__rnKaiAll; render(); });
  host.querySelector("[data-rt-open]").addEventListener("click", () => kxRenewTableModal(all.filter((x) => kxIsAchiX(x))));
  return true;
}
function kxRenewTableModal(items) {
  document.querySelectorAll(".v2-pop-bg").forEach((x) => x.remove());
  let period = kxPeriodOf(kxNowYm()); const periods = kxPeriodsOf(items);
  const bg = document.createElement("div"); bg.className = "v2-pop-bg v2-main-only";
  const paint = () => {
    bg.innerHTML = `<div class="v2-pop wide" role="dialog" aria-label="DOC更新表"><div class="v2-pop-h"><b>DOC更新表</b><select class="kx-in" data-period style="max-width:140px">${periods.map((p) => `<option value="${p}" ${p === period ? "selected" : ""}>${p}期</option>`).join("")}</select><span class="kx-note">${kxPeriodLabel(period)}</span><button type="button" class="kx-btn" data-x style="margin-left:auto">×</button></div><div class="v2-pop-b">${kxRenewTableHtml(items, period, kxNowYm())}</div></div>`;
    bg.querySelector("[data-x]").addEventListener("click", () => bg.remove());
    bg.querySelector("[data-period]").addEventListener("change", (e) => { period = Number(e.target.value); paint(); });
    kxWireRenewTable(bg, items);
  };
  paint(); document.body.appendChild(bg);
  bg.addEventListener("click", (e) => { if (e.target === bg) bg.remove(); });
}

// ---------- フェーズ別：縦の表（行を押すと会社の一覧が開く）＋ 納品前・納品後の要アクション ----------
const KX_PH2 = [
  ["納品前（計上〜検収書回収）", [["計上予定", "FS", "リストに入った直後。キックオフMTGがまだ"], ["フォローMTG設定済", "FS", "キックオフMTG済み、フォローMTGの前"], ["検収書回収待ち", "CS", "検収書の回収待ち"]]],
  ["納品後（検収書回収後）", [["オンボーディング中", "CS", "掲載・活用ができていない"], ["掲載・活用開始", "CS", "掲載日から1か月以内"], ["利用中", "CS", "掲載日から1か月〜更新月の3か月前まで"], ["更新検討時期", "CS", "更新月の2か月前から"], ["解約予定", "CS", "解約の意向あり（確度C）"]]],
  ["解約済み", [["解約済み", "—", "契約が終了した企業（アラート対象外）"]]],
];
function kxBoardV2(items, track, d) {
  const host = $("bdCols"); if (!host) return false;
  const open = window.__bdOpen = window.__bdOpen || new Set();
  const groups = track === "SNS" ? [["SNS", (d.snsPhases || ["計上"]).map((l) => [l, "CS", ""])]] : KX_PH2;
  const actRows = track === "SNS" ? [] : items.flatMap((x) => (x.actions || []).map((a) => ({ x, a })));
  const panel = (g) => { const rs = actRows.filter((r) => r.a.group === g).sort((u, v) => (u.a.left ?? 0) - (v.a.left ?? 0)); const rules = g === "納品前" ? ["受注から2週間以内にキックオフ未実施", "検収書の回収予定月の1週間前で未回収"] : ["次回アクション（施策）の期日まで1週間以内"];
    return `<div class="v2-alp"><div class="h"><b>${g}：要アクション</b><span class="v2-chip red">アラート ${new Set(rs.map((r) => r.x.id)).size}社</span></div><div class="kx-note">${rules.map((r) => `・${r}`).join("　")}</div><div class="v2-alp-list">${rs.map(({ x, a }) => `<div class="v2-tr al" data-open="${esc(x.id)}" role="button" tabindex="0"><span class="co">${esc(x.name)}</span><span class="al ${a.left < 0 ? "over" : ""}">${esc(a.detail)}</span><span>${esc(x.label)}</span><span>担当 ${esc(kxSurname(x.cs) || "未定")}</span><span>期限 ${esc((a.due || "").slice(5).replace("-", "/"))}</span></div>`).join("") || '<div class="kx-empty" style="padding:8px">ありません</div>'}</div></div>`; };
  let html = track === "SNS" ? "" : `<div class="v2-alps">${panel("納品前")}${panel("納品後")}</div>`;
  html += `<div class="v2-ph">`;
  for (const [gname, phs] of groups) {
    html += `<div class="v2-ph-g">${esc(gname)}</div>`;
    for (const [ph, ball, desc] of phs) {
      const list = items.filter((x) => (track === "SNS" ? x._ph : x.label) === ph);
      const al = list.filter((x) => (x.actions || []).length).length;
      const isOpen = open.has(ph);
      html += `<div class="v2-ph-r ${isOpen ? "open" : ""}" data-ph="${esc(ph)}" role="button" tabindex="0"><span class="nm">${esc(ph)}</span><span class="ball ${ball === "FS" ? "fs" : ball === "CS" ? "cs" : ""}">${esc(ball)}</span><span class="desc">${esc(desc)}</span><span class="al">${al ? `アラート ${al}` : ""}</span><span class="n">${list.length}<small>社</small></span><span class="chev">${isOpen ? "▲" : "▼"}</span></div>`;
      if (isOpen) html += `<div class="v2-ph-list"><div class="v2-tr h ph"><span>企業名</span><span>ランク</span><span>タグ</span><span>担当</span><span>NA日</span><span>更新月</span></div>${list.map((x) => `<div class="v2-tr ph" data-open="${esc(x.id)}" role="button" tabindex="0"><span class="co">${kxLogoMini(x)}${esc(x.name)}</span><span>${kxRankBadge(x.rank)}</span><span>${(x.prodLabels || []).map((l) => `<span class="v2-tag">${esc(l)}</span>`).join("")}</span><span>${esc(kxSurname(x.cs) || "未定")}</span><span>${x.naDue ? esc(x.naDue.slice(5).replace("-", "/")) : "—"}</span><span>${x.renew ? esc(x.renew.replace("-", "/")) : "—"}</span></div>`).join("") || '<div class="kx-empty" style="padding:8px">ありません</div>'}</div>`;
    }
  }
  html += `</div>`;
  host.innerHTML = html; host.classList.add("v2-board");
  host.querySelectorAll("[data-ph]").forEach((el) => el.addEventListener("click", () => { const p = el.dataset.ph; open.has(p) ? open.delete(p) : open.add(p); renderBoard(); }));
  host.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", (e) => { e.stopPropagation(); openDetail(el.dataset.open); }));
  host.querySelectorAll("[data-act-all]").forEach((b) => b.addEventListener("click", () => { const g = b.dataset.actAll; kxCoListPopup(`${g}：要アクション`, [...new Map(actRows.filter((r) => r.a.group === g).map((r) => [r.x.id, r.x])).values()]); }));
  const st = $("bdSt"); if (st) st.textContent = `全${items.length}社`;
  kxFitBoard();   // 画面の高さに合わせる（前は描いたあとに呼ばれず、ページ全体がスクロールしていた）
  return true;
}

// ---------- 年間施策・傾向分析（第3弾・第4弾で作る。年間カレンダーだけ先に出す）----------
const KX_PLAN_CAL = [["1月", "ウェビナー", "ロー"], ["2月", "お役立ち情報メール（＋1月ウェビナーのアーカイブ）", "テック"], ["3月", "レイヤー別メール①（AIを活用した採用計画）", "テック"], ["4月", "お手紙（ポニー）入社おめでとう／年度初めのご挨拶 ＋ 電話フォロー", "テック＋ロー"], ["5月", "お役立ち情報メール", "テック"], ["6月", "ウェビナー", "ロー"], ["7月", "レイヤー別メール②（他社事例）＋2か月連続0件企業へ電話", "テック＋ロー"], ["8月", "暑中見舞い", "ロー"], ["9月", "お役立ち情報メール", "テック"], ["10月", "レイヤー別メール③（選考中・フォロー中の活用）", "テック"], ["11月", "お手紙（ポニー）＋1月ウェビナー告知 ＋ 電話フォロー", "テック＋ロー"], ["12月", "年賀状送付", "ロー"]];
let kt = { period: null, axis: "industry", data: null, busy: false };
async function renderTrendV2() {
  const box = $("vTrendBody"); if (!box) return;
  if (!kt.data) {
    box.innerHTML = kxSkel();
    try { kt.data = await api(`/api/kinxs/trend${kt.period ? `?period=${kt.period}` : ""}`); kt.period = kt.data.period; } catch (e) { box.innerHTML = `<div class="kx-empty">読み込めませんでした：${esc(e.message)}</div>`; return; }
  }
  const d = kt.data; const curP = kxPeriodOf(kxNowYm());
  const arr = d.axes[kt.axis] || [];
  const maxWon = Math.max(1, ...arr.map((o) => o.won));
  const bars = (title, val, max, color, unit, fmt) => `<div class="v2-tc"><h3>${title}</h3>${arr.map((o) => { const v = val(o); return `<div class="v2-hb"><span class="k" title="${esc(o.k)}">${esc(o.k)}</span><span class="b"><i style="width:${v == null ? 0 : Math.max(2, Math.round((v / max) * 100))}%;background:${color}"></i></span><span class="v">${v == null ? "—" : `${v}${unit}`}<small>${fmt ? fmt(o) : ""}</small></span></div>`; }).join("") || '<div class="kx-empty">ありません</div>'}</div>`;
  box.innerHTML = `
    <div class="v2-month"><div class="kx-seg">${[[String(curP), `${curP}期`], [String(curP - 1), `${curP - 1}期`], ["all", "全期間"]].map(([v, l]) => `<button type="button" class="${String(kt.period) === v ? "on" : ""}" data-tp="${v}">${l}</button>`).join("")}</div>
      <div class="kx-seg">${[["industry", "業界"], ["region", "地域"], ["size", "企業規模（社員数）"]].map(([v, l]) => `<button type="button" class="${kt.axis === v ? "on" : ""}" data-ta="${v}">${l}</button>`).join("")}</div>
      <span class="kx-note">${d.period === "all" ? "全期間" : `${d.period}期（${Number(d.period) + 1999}年3月〜${Number(d.period) + 2000}年2月）`}・DOC ${d.n}社</span></div>
    <div class="v2-kpis">${[["受注社数", `${d.total.won}社`, "この期間に受注"], ["更新月が来た会社", `${d.total.due}社`, "今日までに更新月が来た"], ["更新率", d.total.renewRate == null ? "—" : `${d.total.renewRate}%`, "続けた／更新月が来た"], ["解約率", d.total.churnRate == null ? "—" : `${d.total.churnRate}%`, "解約した／更新月が来た"]].map(([l, v, s0], i) => `<div class="v2-kpi ${i === 0 ? "strong" : ""}"><span class="l">${l}</span><span class="v" style="font-size:26px">${v}</span><span class="d">${s0}</span></div>`).join("")}</div>
    <section class="v2-sec" style="margin-top:14px"><h2>傾向サマリ <span class="kx-src">自動（数字から作成）</span>${d.summary ? `<span class="kx-note">${esc(new Date(d.summary.at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }))}</span>` : ""}<button type="button" class="hp-b" data-tsum style="margin-left:auto">${d.summary ? "作り直す" : "作る"}</button></h2>
      <div class="v2-story">${d.summary ? esc(d.summary.text) : "まだ作っていません。「作る」を押すと、下の数字から3〜4文のまとめを作ります。"}</div></section>
    <section class="v2-sec"><h2>${{ industry: "業界", region: "地域", size: "企業規模（社員数）" }[kt.axis]}ごと</h2><div class="v2-tcs">
      ${bars("受注社数", (o) => o.won, maxWon, "#1D9E75", "社")}
      ${bars("更新率", (o) => o.renewRate, 100, "#3F72C9", "%", (o) => (o.due ? `（${o.renewed}/${o.due}）` : ""))}
      ${bars("解約率", (o) => o.churnRate, 100, "#C43D3D", "%", (o) => (o.due ? `（${o.churned}/${o.due}）` : ""))}
    </div>${kt.axis === "industry" && d.sfMissing ? `<div class="kx-note">SFの取引先に業種が入っていない会社が ${d.sfMissing}社あります（「（SFに業種なし）」にまとめています）。</div>` : ""}<div class="kx-note">更新率・解約率は、その期間に更新月が来た（今日まで）会社で数えます。解約＝フェーズが解約済みか確度F。</div></section>`;
  box.querySelectorAll("[data-tp]").forEach((b) => b.addEventListener("click", () => { kt.period = b.dataset.tp; kt.data = null; renderTrendV2(); }));
  box.querySelectorAll("[data-ta]").forEach((b) => b.addEventListener("click", () => { kt.axis = b.dataset.ta; renderTrendV2(); }));
  box.querySelector("[data-tsum]").addEventListener("click", async (e) => {
    const b = e.currentTarget; b.disabled = true; b.textContent = "作っています…";
    try { const r = await api("/api/kinxs/trend/summary", { method: "POST", body: JSON.stringify({ period: kt.period }) }); kt.data.summary = r.summary; renderTrendV2(); } catch (er) { alert(er.message); b.disabled = false; b.textContent = "作る"; }
  });
}

// 起動（UI刷新の画面）
if (VIEW === "home") loadHomeV2();

// ---------- 企業詳細：請求・納品（掲載日・キックオフ実施日・検収書・請求書）。フェーズと要アクションの判定に使う（UI刷新 第1弾）----------
function kxOpsSection(x) {
  const v = (s) => esc(s || "");
  const sel = (k, opts, cur) => `<select class="kx-in" data-ops="${k}">${opts.map(([val, lab]) => `<option value="${val}" ${String(cur) === String(val) ? "selected" : ""}>${lab}</option>`).join("")}</select>`;
  return `<section class="kx-sec v2-ops" data-ops-box="${esc(x.id)}"><div class="lb" style="display:flex;align-items:center;gap:8px">請求・納品<span class="kx-note">フェーズ（納品前・納品後）と要アクションの判定に使います</span><button type="button" class="kx-btn kx-pri" data-ops-save style="margin-left:auto">保存</button></div>
    <div class="v2-ops-g">
      <label>キックオフ実施日<input type="date" class="kx-in" data-ops="kickoff_on" value="${v(x.kickoffManual ? x.kickoffOn : "")}" /><small>${x.kickoffOn && !x.kickoffManual ? `CS連携から：${v(x.kickoffOn)}` : "空ならCS連携の回収MTGの日"}</small></label>
      <label>検収書の回収予定月<input type="month" class="kx-in" data-ops="kenshu_month" value="${v(x.kenshuMonth)}" /><small>この月の1週間前で未回収ならアラート</small></label>
      <label>検収書の回収日<input type="date" class="kx-in" data-ops="kenshu_on" value="${v(x.kenshuOn)}" /><small>${v(x.kenshu || "")}${x.kenshuOn ? "" : "（入れると納品後になります）"}</small></label>
      <label>掲載日<input type="date" class="kx-in" data-ops="published_on" value="${v(x.publishedOn)}" /><small>掲載日から1か月は「掲載・活用開始」</small></label>
      <label>請求書の発行${sel("invoice_need", [["", "未定"], ["true", "必要"], ["false", "不要"]], x.invoiceNeed == null ? "" : String(x.invoiceNeed))}</label>
      <label>請求書の状態${sel("invoice_state", [["", "—"], ["未発行", "未発行"], ["発行済み", "発行済み"]], x.invoiceState || "")}</label>
      <label>請求予定日<input type="date" class="kx-in" data-ops="invoice_date" value="${v(x.invoiceDate)}" /></label>
      <label>納品メール<span class="kx-note" style="display:block;padding:6px 0">${v(x.mail || "—")}</span></label>
    </div><span class="kx-note" data-ops-st></span></section>`;
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest && e.target.closest("[data-ops-save]"); if (!b) return;
  const box = b.closest("[data-ops-box]"); if (!box) return;
  const body = {};
  box.querySelectorAll("[data-ops]").forEach((el) => { const k = el.dataset.ops; let val = el.value; if (k === "invoice_need") val = val === "" ? null : val === "true"; body[k] = val; });
  const st = box.querySelector("[data-ops-st]"); if (st) st.textContent = "保存しています…"; b.disabled = true;
  try { await api(`/api/kinxs/accounts/${encodeURIComponent(box.dataset.opsBox)}`, { method: "PUT", body: JSON.stringify(body) }); if (st) st.textContent = "保存しました（フェーズは読み直すと変わります）"; lsData = null; bdData && (bdData = null); }
  catch (er) { if (st) st.textContent = er.message; }
  finally { b.disabled = false; }
});

// ---------- 議事録タブ：これまでのサマリ（UI刷新 第2弾）----------
function kxSummarySection(x) {
  const sm = x.mtgSummary;
  const head = `<div class="lb" style="display:flex;align-items:center;gap:8px">これまでのサマリ<span class="kx-src">自動（議事録から作成）</span>${sm ? `<span class="kx-note">最終更新 ${esc(new Date(sm.at).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }))}</span>` : ""}<button type="button" class="hp-b" data-sum-make="${esc(x.id)}" style="margin-left:auto">${sm ? "議事録から作り直す" : "議事録から作る"}</button></div>`;
  if (!sm) return `<section class="kx-sec v2-sum">${head}<div class="kx-note">まだ作っていません。議事録が入った会社は、1時間ごとに自動で作ります（すぐ見たいときは「議事録から作る」）。</div><span class="kx-note" data-sum-st></span></section>`;
  const st = (s) => (s === "済" ? "done" : s === "次" ? "next" : "plan");
  const d = (v) => (v ? v.slice(5).replace("-", "/") : "");
  const n = sm.next || {};
  return `<section class="kx-sec v2-sum">${head}
    <div class="v2-sum-h">全体のスケジュール</div>
    <div class="v2-tl">${(sm.schedule || []).map((s0) => `<div class="v2-tl-i ${st(s0.state)}"><span class="dot"></span><b>${esc(s0.name)}</b><small>${esc(d(s0.date) || "—")}</small><em>${esc(s0.state)}</em></div>`).join("")}</div>
    <div class="v2-sum-g">
      <div><div class="v2-sum-h">前回の宿題</div>${(sm.homework || []).length ? `<div class="v2-hw">${sm.homework.map((h) => `<div class="r"><span class="who ${h.who === "当社" ? "ours" : ""}">${esc(h.who)}</span><span class="t">${esc(h.task)}</span><span class="kx-note">${esc(d(h.due))}</span><span class="s s-${esc(h.state)}">${esc(h.state)}</span></div>`).join("")}</div>` : '<div class="kx-note">ありません</div>'}</div>
      <div><div class="v2-sum-h">次のMTG・次のアクション</div>${n.title || n.date ? `<div class="v2-next"><b>${esc(n.title || "次のMTG")}</b><div class="kx-note">日時：${esc(n.date ? `${n.date.replace(/-/g, "/")}${n.time ? ` ${n.time}` : ""}` : "未定")}${n.place ? `／${esc(n.place)}` : ""}${n.purpose ? `／目的：${esc(n.purpose)}` : ""}</div>${(n.talk || []).length ? `<ul>${n.talk.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}<div class="kx-note">ステータスタブの次回アクションと同じ内容です</div></div>` : '<div class="kx-note">議事録にありません</div>'}</div>
    </div>
    <div class="v2-sum-h">これまでの経緯</div><div class="v2-story">${esc(sm.story || "—")}</div>
    <span class="kx-note" data-sum-st></span></section>`;
}
// ---------- ステータスタブ：次回アクション（詳しく）----------
function kxNextActSection(x) {
  const nd = x.naDetail || {}; const sm = x.mtgSummary || {}; const n = sm.next || {};
  const agenda = Array.isArray(nd.agenda) ? nd.agenda : [];
  const hw = Array.isArray(nd.homework) ? nd.homework : (sm.homework || []).filter((h) => h.state !== "完了");
  const when = x.naAt ? new Date(x.naAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }) : (x.naDue ? x.naDue.replace(/-/g, "/") : "未定");
  const alertTxt = x.naDue ? (() => { const l = Math.ceil((Date.parse(x.naDue + "T23:59:59+09:00") - Date.now()) / 86400000); return l < 0 ? `<span class="v2-miss">${-l}日過ぎ</span>` : l <= 7 ? `<span class="v2-miss">あと${l}日（アラート）</span>` : `<span class="kx-note">あと${l}日（期限の1週間前にアラート）</span>`; })() : "";
  return `<section class="kx-sec v2-na" data-na-box="${esc(x.id)}"><div class="lb" style="display:flex;align-items:center;gap:8px">次回アクション<span class="kx-src">${nd.manual ? "手で直した" : nd.auto ? "自動（議事録から）" : "—"}</span>${alertTxt}<button type="button" class="kx-btn kx-pri" data-na-save style="margin-left:auto">保存</button></div>
    <div class="v2-na-g">
      <label>種別・タイトル<input class="kx-in" data-nad="title" value="${esc(nd.title || x.na || n.title || "")}" placeholder="例：運用開始前の最終確認ミーティング" /></label>
      <label>日時<span class="kx-note" style="padding:6px 0">${esc(when)}</span></label>
      <label>場所<input class="kx-in" data-nad="place" value="${esc(nd.place || n.place || "")}" placeholder="オンライン など" /></label>
      <label>参加者<input class="kx-in" data-nad="participants" value="${esc(nd.participants || "")}" placeholder="先方：○○様／当社：○○" /></label>
      <label style="grid-column:1/-1">目的<input class="kx-in" data-nad="purpose" value="${esc(nd.purpose || n.purpose || "")}" /></label>
    </div>
    <div class="v2-sum-h">当日に確認すること</div>
    <div data-na-agenda>${(agenda.length ? agenda : (n.talk || []).map((t) => ({ t, done: false }))).map((a) => `<label class="v2-ag"><input type="checkbox" ${a.done ? "checked" : ""} /><input class="kx-in" value="${esc(a.t)}" /></label>`).join("")}<label class="v2-ag"><input type="checkbox" /><input class="kx-in" placeholder="＋ 確認することを足す" /></label></div>
    <div class="v2-sum-h">前回の宿題（この日までに）</div>
    <div data-na-hw>${hw.map((h) => `<div class="v2-hw-ed"><select class="kx-in" data-k="who"><option ${h.who !== "当社" ? "selected" : ""}>先方</option><option ${h.who === "当社" ? "selected" : ""}>当社</option></select><input class="kx-in" data-k="task" value="${esc(h.task)}" /><input type="date" class="kx-in" data-k="due" value="${esc(h.due || "")}" /><select class="kx-in" data-k="state">${["未完了", "確認中", "完了"].map((s0) => `<option ${h.state === s0 ? "selected" : ""}>${s0}</option>`).join("")}</select></div>`).join("")}<div class="v2-hw-ed"><select class="kx-in" data-k="who"><option>先方</option><option>当社</option></select><input class="kx-in" data-k="task" placeholder="＋ 宿題を足す" /><input type="date" class="kx-in" data-k="due" /><select class="kx-in" data-k="state"><option>未完了</option><option>確認中</option><option>完了</option></select></div></div>
    ${nd.source ? `<div class="kx-note">元になった議事録を開く → 議事録タブ</div>` : ""}
    <div class="kx-note">日時・期限（NA日）は、下の「次回アクション」の欄で直せます。<span data-na-st></span></div></section>`;
}
document.addEventListener("click", async (e) => {
  const mk = e.target.closest && e.target.closest("[data-sum-make]");
  if (mk) {
    const box = mk.closest(".v2-sum"); const st = box && box.querySelector("[data-sum-st]"); if (st) st.textContent = "議事録を読んでいます…（30秒ほど）"; mk.disabled = true;
    try { const r = await api(`/api/kinxs/accounts/${encodeURIComponent(mk.dataset.sumMake)}/summary`, { method: "POST" }); if (!r.ok) throw new Error(r.reason || "作れませんでした"); lsData = null; const bg0 = mk.closest(".kx-drawer-bg"); openDetail(mk.dataset.sumMake, { bg: bg0, tab: "tl", msg: "まとめを作りました" }); }
    catch (er) { if (st) st.textContent = er.message; mk.disabled = false; }
    return;
  }
  const sv = e.target.closest && e.target.closest("[data-na-save]");
  if (sv) {
    const box = sv.closest("[data-na-box]"); const st = box.querySelector("[data-na-st]");
    const body = { title: box.querySelector('[data-nad="title"]').value, place: box.querySelector('[data-nad="place"]').value, participants: box.querySelector('[data-nad="participants"]').value, purpose: box.querySelector('[data-nad="purpose"]').value,
      agenda: [...box.querySelectorAll("[data-na-agenda] .v2-ag")].map((l) => ({ done: l.querySelector("input[type=checkbox]").checked, t: l.querySelector("input.kx-in").value.trim() })).filter((a) => a.t),
      homework: [...box.querySelectorAll("[data-na-hw] .v2-hw-ed")].map((r) => ({ who: r.querySelector('[data-k="who"]').value, task: r.querySelector('[data-k="task"]').value.trim(), due: r.querySelector('[data-k="due"]').value, state: r.querySelector('[data-k="state"]').value })).filter((h) => h.task) };
    if (st) st.textContent = "　保存しています…"; sv.disabled = true;
    try { await api(`/api/kinxs/accounts/${encodeURIComponent(box.dataset.naBox)}/na-detail`, { method: "PUT", body: JSON.stringify(body) }); if (st) st.textContent = "　保存しました"; lsData = null; }
    catch (er) { if (st) st.textContent = "　" + er.message; }
    finally { sv.disabled = false; }
  }
});


// ===================== UI刷新 第3弾：年間施策・電話フォロー（2026-11-04）=====================
let kp = { ym: kxNowYm(), data: null, sel: "", chk: new Set(), timer: null };
async function kpLoad(quiet) {
  try { kp.data = await api(`/api/kinxs/plan?ym=${kp.ym}`); } catch (e) { if (!quiet) { const b = $("vPlanBody"); if (b) b.innerHTML = `<div class="kx-empty">読み込めませんでした：${esc(e.message)}</div>`; } return; }
  renderPlanV2();
}
function kpCsv(name, header, rows) {
  const q = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const blob = new Blob(["\ufeff" + [header, ...rows].map((r) => r.map(q).join(",")).join("\r\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function kpSave(mkey, ym, body) {
  const r = await api("/api/kinxs/actions", { method: "PUT", body: JSON.stringify({ mkey, ym, ...body }) });
  if (body.status === "完了") kxDoneToast("完了にしました");
  return r;
}
// 施策の対象会社を窓で出して、その場で状態・結果・メモ・NA日を直す
function kpActPopup(me, ym, onlyStatus, after) {
  document.querySelectorAll(".v2-pop-bg").forEach((x) => x.remove());
  const bg = document.createElement("div"); bg.className = "v2-pop-bg";
  const ST = (kp.data && kp.data.statuses) || ["未対応", "架電済み（不在）", "対応中", "完了", "対象外"];
  const rows = me.rows.filter((r) => !onlyStatus || r.status === onlyStatus);
  bg.innerHTML = `<div class="v2-pop wide"><div class="v2-pop-h"><b>${esc(me.name)}</b><span class="kx-note">${esc(me.when)}・${rows.length}社${onlyStatus ? `（${esc(onlyStatus)}）` : ""}</span><button type="button" class="kx-btn" data-x style="margin-left:auto">閉じる</button></div>
    <div class="v2-pop-b"><div class="v2-act h ${me.call ? "call" : ""}"><span>企業名</span><span>担当</span><span>ステータス</span>${me.call ? "<span>架電</span><span>結果</span>" : ""}<span>メモ・次のアクション</span><span>NA日</span></div>
    ${rows.map((r) => `<div class="v2-act ${me.call ? "call" : ""}" data-id="${esc(r.id)}"><span class="co" data-open="${esc(r.id)}" role="button" tabindex="0">${kxLogoMini(r)}${esc(r.name)}</span><span>${esc(kxSurname(r.cs) || "未定")}</span>
      <select class="kx-in" data-f="status">${ST.map((s) => `<option ${s === r.status ? "selected" : ""}>${s}</option>`).join("")}</select>
      ${me.call ? `<span class="calls"><b>${r.calls}</b>回 <button type="button" class="hp-b" data-call>＋架電</button><small>${esc(r.lastCall ? r.lastCall.slice(5).replace("-", "/") : "")}</small></span><select class="kx-in" data-f="result">${["", "良好", "普通", "懸念あり", "未接続"].map((s) => `<option value="${s}" ${s === r.result ? "selected" : ""}>${s || "—"}</option>`).join("")}</select>` : ""}
      <input class="kx-in" data-f="memo" value="${esc(r.memo)}" placeholder="メモ・次のアクション" /><input type="date" class="kx-in" data-f="na_date" value="${esc(r.naDate)}" /></div>`).join("") || '<div class="kx-empty">ありません</div>'}
    <div class="kx-note" style="margin-top:6px">変えるとすぐ保存します。${me.call ? "電話の結果・メモは、企業詳細の議事録タブ（電話・メールなどの記録）にも残ります。" : ""}</div></div></div>`;
  document.body.appendChild(bg);
  const close = () => { bg.remove(); if (after) after(); };
  bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
  bg.querySelector("[data-x]").addEventListener("click", close);
  bg.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", () => openDetail(el.dataset.open)));
  bg.querySelectorAll(".v2-act[data-id]").forEach((row) => {
    const id = row.dataset.id; const r = me.rows.find((x) => x.id === id);
    row.querySelectorAll("[data-f]").forEach((el) => el.addEventListener("change", async () => {
      try { await kpSave(me.key, ym, { account_id: id, [el.dataset.f]: el.value }); r[el.dataset.f === "na_date" ? "naDate" : el.dataset.f] = el.value; el.style.borderColor = "#1D9E75"; } catch (e) { el.style.borderColor = "#C43D3D"; alert(e.message); }
    }));
    const cb = row.querySelector("[data-call]"); if (cb) cb.addEventListener("click", async () => {
      const stEl = row.querySelector('[data-f="status"]'); const st0 = stEl.value === "未対応" ? "架電済み（不在）" : stEl.value;
      try { await kpSave(me.key, ym, { account_id: id, call: true, status: st0 }); r.calls++; r.status = st0; stEl.value = st0; row.querySelector(".calls b").textContent = r.calls; } catch (e) { alert(e.message); }
    });
  });
}
function kpCard(me) {
  const pct = me.total ? Math.round((me.done / me.total) * 100) : 0;
  return `<div class="v2-mc" data-mk="${esc(me.key)}"><div class="t"><b>${esc(me.name)}</b><span class="v2-tag">${esc(me.when)}</span><span class="kx-note">${esc(me.ch)}</span></div>
    <button type="button" class="lnk" data-mk-all="${esc(me.key)}">対象 ${me.rows.length}社 ›</button>
    <div class="big">完了 <b>${me.done}</b> / ${me.total}社 <span class="pct">${pct}%</span></div><div class="bar"><i style="width:${pct}%"></i></div>
    <div class="sts">${["未対応", "架電済み（不在）", "対応中", "完了"].filter((s) => me.call || s !== "架電済み（不在）").map((s) => `<button type="button" data-mk-st="${esc(me.key)}|${esc(s)}" class="st-${["未対応", "架電済み（不在）", "対応中", "完了"].indexOf(s)}">${esc(s)} <b>${me.counts[s] || 0}</b></button>`).join("")}</div></div>`;
}
function renderPlanV2() {
  const box = $("vPlanBody"); if (!box) return;
  if (!kp.data) { box.innerHTML = kxSkel(); kpLoad(); return; }
  const d = kp.data; const cm = Number(kp.ym.slice(5));
  kp.tab = kp.tab || "send";
  const tech = d.measures.filter((x) => x.kind === "tech"), low = d.measures.filter((x) => x.kind === "low");
  const calls = d.measures.filter((x) => x.call); const cTot = calls.reduce((a, x) => a + x.total, 0), cDone = calls.reduce((a, x) => a + x.done, 0);
  const all = d.measures.reduce((a, x) => ({ t: a.t + x.total, d: a.d + x.done }), { t: 0, d: 0 });
  const pct = (dn, t) => (t ? Math.round((dn / t) * 100) : 0);
  const sum = (list) => list.reduce((a, x) => ({ t: a.t + x.total, d: a.d + x.done }), { t: 0, d: 0 });
  const ts = sum(tech), ls = sum(low);
  const CH = { メール: "✉", 郵送: "📮", 電話: "☎", 打ち合わせ: "👥", ウェビナー: "🖥" };
  // 施策の行（対象がある施策を上に。対象0件はたたんでまとめる）
  const row = (me) => { const p0 = pct(me.done, me.total); return `<div class="p3-m${me.rows.length ? "" : " empty"}"><button type="button" class="p3-mh" data-mk-all="${esc(me.key)}"><span class="ch">${CH[me.ch] || "•"}</span><span class="nm">${esc(me.name)}</span><span class="tg">${esc(me.when)}</span></button>
      <div class="p3-mb"><span class="bar" data-grow><i style="width:${p0}%"></i></span><b>${me.done}</b><small>/ ${me.total}社</small><em>${p0}%</em></div>
      <div class="p3-ms">${["未対応", "架電済み（不在）", "対応中", "完了"].filter((s) => (me.counts[s] || 0) > 0).map((s) => `<button type="button" class="s s${["未対応", "架電済み（不在）", "対応中", "完了"].indexOf(s)}" data-mk-st="${esc(me.key)}|${esc(s)}">${esc(s)} ${me.counts[s]}</button>`).join("") || '<span class="none">対象なし</span>'}</div></div>`; };
  const col = (list, label, cls, s0, extra) => { const act = list.filter((x) => x.rows.length), emp = list.filter((x) => !x.rows.length);
    return `<section class="p3-col ${cls}"><div class="p3-ch"><span class="dot"></span><b>${label}</b><span class="sm">完了 <b>${s0.d}</b> / ${s0.t}社</span><span class="ring" style="--p:${pct(s0.d, s0.t)}"><i>${pct(s0.d, s0.t)}%</i></span></div>${extra || ""}
      <div class="p3-list">${act.map(row).join("") || '<div class="kx-empty">今月、対象のある施策はありません</div>'}${emp.length ? `<details class="p3-emp"><summary>対象のない施策（${emp.length}）</summary>${emp.map(row).join("")}</details>` : ""}</div></section>`; };
  const band = `<a class="p3-live" href="/kinxs?p=call"><span class="lv">● LIVE</span><span>電話フォロー（今月）</span><b>${cDone}</b><small>/ ${cTot}社</small><span class="go">進捗表 ›</span></a>`;
  const selMe = d.measures.find((x) => x.key === kp.sel) || null;
  const tabBody = kp.tab === "prep"
    ? `<div data-prep>${(d.prep || []).map((p0) => `<label class="v2-ag"><input type="checkbox" ${p0.done ? "checked" : ""} /><input class="kx-in" value="${esc(p0.t)}" /></label>`).join("")}<label class="v2-ag"><input type="checkbox" /><input class="kx-in" placeholder="＋ 準備することを足す（例：1月ウェビナーのテーマを決める）" /></label></div><button type="button" class="kx-btn kx-pri" data-prep-save style="margin-top:8px">準備を保存</button>`
    : kp.tab === "acc"
      ? `<div class="kx-note">レイヤー（A：5件以上／B：0〜4件）と0件の判定に使います</div><textarea class="kx-in" data-acc rows="8" placeholder="会社名,月（2026-10）,アクセス数　を1行ずつ（CSVを貼り付け）" style="width:100%;margin-top:6px"></textarea><button type="button" class="kx-btn kx-pri" data-acc-save style="margin-top:8px">取り込む</button><span class="kx-note" data-acc-st></span>`
      : `<div class="kx-note">① 施策を選ぶ</div><div class="v2-pick">${d.measures.filter((x) => x.rows.length).map((x) => `<button type="button" class="${kp.sel === x.key ? "on" : ""}" data-pick="${esc(x.key)}"><b>${esc(x.name)}</b><small>${esc(x.kind === "tech" ? "テック" : "ロー")}・${esc(x.ch)}・対象${x.rows.length}社</small></button>`).join("") || '<span class="kx-note">今月、対象のある施策はありません</span>'}</div>${selMe ? kpTargetsHtml(selMe) : ""}`;
  box.innerHTML = `<div class="p3">
    <div class="p3-top">
      <div class="p3-hero"><span class="l">${kxYmLabel(kp.ym)}の施策</span><span class="v" data-cu="${all.d}">${all.d}<small>/ ${all.t}社 完了</small></span><span class="bar" data-grow><i style="width:${pct(all.d, all.t)}%"></i></span><span class="sub">テック ${ts.d}/${ts.t}・ロー ${ls.d}/${ls.t}・30秒ごとに新しくします</span></div>
      <div class="p3-cal">${KX_PLAN_CAL.map(([m, n, t]) => { const mn = Number(m.replace("月", "")); const P0 = cm >= 3 ? Number(kp.ym.slice(0, 4)) : Number(kp.ym.slice(0, 4)) - 1; const ymX = `${mn >= 3 ? P0 : P0 + 1}-${String(mn).padStart(2, "0")}`; return `<button type="button" class="p3-mo ${mn === cm ? "on" : ""}" data-goym="${ymX}" title="${esc(n)}"><b>${m}</b><span class="dots">${/テック/.test(t) ? '<i class="t"></i>' : ""}${/ロー/.test(t) ? '<i class="l"></i>' : ""}</span><small>${esc(n.replace(/（.*?）/g, "").slice(0, 12))}</small></button>`; }).join("")}</div>
    </div>
    <div class="p3-main">
      ${col(tech, "テックタッチ", "tech", ts, "")}
      ${col(low, "ロータッチ", "low", ls, band)}
      <section class="p3-side"><div class="p3-tabs">${[["send", "一斉配信"], ["prep", "来月の準備"], ["acc", "アクセス数"]].map(([k2, l]) => `<button type="button" class="${kp.tab === k2 ? "on" : ""}" data-ptab="${k2}">${l}</button>`).join("")}</div><div class="p3-tb">${tabBody}</div></section>
    </div></div>`;
  kxHeadMonth(kp.ym, (n) => { kp.ym = n === 0 ? kxNowYm() : kxYmAdd(kp.ym, n); kp.data = null; kp.sel = ""; kp.chk.clear(); renderPlanV2(); });
  box.querySelectorAll("[data-goym]").forEach((b) => b.addEventListener("click", () => { if (b.dataset.goym === kp.ym) return; kp.ym = b.dataset.goym; kp.data = null; kp.sel = ""; kp.chk.clear(); renderPlanV2(); }));
  box.querySelectorAll("[data-ptab]").forEach((b) => b.addEventListener("click", () => { kp.tab = b.dataset.ptab; renderPlanV2(); }));
  box.querySelectorAll("[data-mk-all]").forEach((b) => b.addEventListener("click", () => { const me = d.measures.find((x) => x.key === b.dataset.mkAll); kpActPopup(me, kp.ym, "", () => kpLoad(true)); }));
  box.querySelectorAll("[data-mk-st]").forEach((b) => b.addEventListener("click", () => { const [k2, s] = b.dataset.mkSt.split("|"); const me = d.measures.find((x) => x.key === k2); kpActPopup(me, kp.ym, s, () => kpLoad(true)); }));
  const ps = box.querySelector("[data-prep-save]"); if (ps) ps.addEventListener("click", async () => {
    const items = [...box.querySelectorAll("[data-prep] .v2-ag")].map((l) => ({ done: l.querySelector("input[type=checkbox]").checked, t: l.querySelector("input.kx-in").value.trim() })).filter((x) => x.t);
    try { await api("/api/kinxs/plan/prep", { method: "PUT", body: JSON.stringify({ ym: kp.ym, items }) }); kxDoneToast("準備を保存しました"); kpLoad(true); } catch (e) { alert(e.message); }
  });
  box.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => { kp.sel = kp.sel === b.dataset.pick ? "" : b.dataset.pick; kp.chk.clear(); renderPlanV2(); }));
  if (selMe && kp.tab === "send") kpWireTargets(box, selMe);
  const as = box.querySelector("[data-acc-save]"); if (as) as.addEventListener("click", async () => {
    const rows = box.querySelector("[data-acc]").value.split(/\r?\n/).map((l) => l.split(/[,\t]/).map((c) => c.trim().replace(/^"|"$/g, ""))).filter((c) => c.length >= 3 && /\d/.test(c[2])).map((c) => ({ name: c[0], ym: c[1], count: c[2] }));
    const st = box.querySelector("[data-acc-st]");
    try { const r = await api("/api/kinxs/access", { method: "POST", body: JSON.stringify({ rows }) }); st.textContent = `　${r.saved}件を取り込みました${r.unmatchedCount ? `（会社が見つからない ${r.unmatchedCount}件：${r.unmatched.slice(0, 5).join("・")}…）` : ""}`; kpLoad(true); } catch (e) { st.textContent = "　" + e.message; }
  });
  // 1画面に収める（それぞれの列の中だけスクロール）
  const p3 = box.querySelector(".p3"); if (p3) { document.documentElement.style.overflow = "hidden"; p3.style.height = `${Math.max(480, window.innerHeight - p3.getBoundingClientRect().top - 14)}px`; }
  if (kp.animYm !== kp.ym) { kp.animYm = kp.ym; kxCountUp(box); }
  if (!kp.timer) kp.timer = setInterval(() => { const ae = document.activeElement; if (!document.querySelector(".v2-pop-bg") && !(ae && ae.closest && ae.closest("#vPlanBody") && /INPUT|SELECT|TEXTAREA/.test(ae.tagName))) kpLoad(true); }, 30000);
}
window.addEventListener("resize", () => { if (VIEW === "plan" && kp.data) renderPlanV2(); });

// ---------- 電話フォロー ----------
let kc = { tab: "month", period: null, data: null, ym: kxNowYm(), plan: null, f: { reason: "", cs: "", st: "" } };
async function kcLoad() {
  try { kc.data = await api(`/api/kinxs/calls${kc.period ? `?period=${kc.period}` : ""}`); kc.period = kc.data.period; kc.plan = await api(`/api/kinxs/plan?ym=${kc.ym}`); } catch (e) { const b = $("vCallBody"); if (b) b.innerHTML = `<div class="kx-empty">読み込めませんでした：${esc(e.message)}</div>`; return; }
  renderCallV2();
}
function renderCallV2() {
  const box = $("vCallBody"); if (!box) return;
  if (!kc.data) { box.innerHTML = kxSkel(); kcLoad(); return; }
  const d = kc.data; const curP = kxPeriodOf(kxNowYm());
  const tabs = `<div class="kx-seg" style="margin-bottom:12px"><button type="button" class="${kc.tab === "month" ? "on" : ""}" data-kc-tab="month">月別進捗表</button><button type="button" class="${kc.tab === "co" ? "on" : ""}" data-kc-tab="co">企業ごとの進捗</button></div>`;
  let body = "";
  if (kc.tab === "month") {
    const past = d.months.filter((m) => !m.future); const tot = past.reduce((a, m) => a + m.total, 0), dn = past.reduce((a, m) => a + m.done, 0);
    const cur = d.months.find((m) => m.ym === d.nowYm) || { counts: {}, done: 0, total: 0 };
    const worry = d.months.reduce((a, m) => a + (m.results["懸念あり"] || 0), 0);
    body = `<div class="v2-month"><select class="kx-in" data-kc-period style="max-width:140px">${[curP, curP - 1].map((p) => `<option value="${p}" ${p === d.period ? "selected" : ""}>${p}期</option>`).join("")}</select><span class="kx-note">${d.period}期（${d.period + 1999}年3月〜${d.period + 2000}年2月）</span><button type="button" class="kx-btn" data-kc-csv style="margin-left:auto">スプレッドシート用に書き出す（CSV）</button></div>
      <div class="v2-kpis">${[["累計の完了", `${dn} / ${tot}社`, tot ? `${Math.round((dn / tot) * 100)}%` : "—", true], ["今月の未対応", `${cur.counts["未対応"] || 0}社`, ""], ["今月の完了", `${cur.done}社`, ""], ["懸念ありの企業（累計）", `${worry}社`, ""]].map(([l, v, s, strong]) => `<div class="v2-kpi ${strong ? "strong" : ""}"><span class="l">${l}</span><span class="v" style="font-size:24px">${v}</span><span class="d">${s}</span></div>`).join("")}</div>
      <div class="v2-rt-wrap"><table class="v2-rt v2-kct"><thead><tr><th>月</th><th>電話の理由</th><th>対象</th><th>未対応</th><th>架電済み（不在）</th><th>対応中</th><th>完了</th><th>完了率</th><th>良好</th><th>普通</th><th>懸念あり</th></tr></thead><tbody>
      ${d.months.map((m) => { const pct = m.total ? Math.round((m.done / m.total) * 100) : 0; const now = m.ym === d.nowYm; return `<tr class="${now ? "hl now" : ""} ${m.future ? "fut" : ""}"><th><button type="button" data-kc-ym="${m.ym}">${Number(m.ym.slice(5))}月</button></th><td class="rs">${esc(m.reasons.join("・") || "—")}</td>${m.future ? `<td colspan="9" class="kx-note">予定</td>` : `<td>${m.total}</td><td class="${now && m.counts["未対応"] ? "cc" : ""}">${m.counts["未対応"] || 0}</td><td>${m.counts["架電済み（不在）"] || 0}</td><td>${m.counts["対応中"] || 0}</td><td>${m.done}</td><td><div class="bar"><i style="width:${pct}%"></i></div><small>${pct}%</small></td><td>${m.results["良好"] || 0}</td><td>${m.results["普通"] || 0}</td><td class="${m.results["懸念あり"] ? "cc" : ""}">${m.results["懸念あり"] || 0}</td>`}</tr>`; }).join("")}
      </tbody><tfoot><tr><th>合計</th><td></td><td>${tot}</td><td>${past.reduce((a, m) => a + (m.counts["未対応"] || 0), 0)}</td><td>${past.reduce((a, m) => a + (m.counts["架電済み（不在）"] || 0), 0)}</td><td>${past.reduce((a, m) => a + (m.counts["対応中"] || 0), 0)}</td><td>${dn}</td><td>${tot ? Math.round((dn / tot) * 100) : 0}%</td><td>${past.reduce((a, m) => a + (m.results["良好"] || 0), 0)}</td><td>${past.reduce((a, m) => a + (m.results["普通"] || 0), 0)}</td><td>${worry}</td></tr></tfoot></table></div>
      <div class="kx-note">月を押すと、その月の企業ごとの進捗へ。対象：お手紙フォロー（4月・11月、お手紙を発送済みにした会社）・2か月連続0件（7月）・掲載1か月0件（毎月、月間アクセス数の取り込みが要ります）</div>`;
  } else {
    const ms = ((kc.plan && kc.plan.measures) || []).filter((x) => x.call);
    const rows0 = ms.flatMap((x) => x.rows.map((r) => ({ ...r, reason: x.reason, me: x })));
    const rows = rows0.filter((r) => (!kc.f.reason || r.reason === kc.f.reason) && (!kc.f.cs || kxSurname(r.cs) === kc.f.cs) && (!kc.f.st || r.status === kc.f.st));
    const eff = rows0.filter((r) => r.status !== "対象外"); const dn = eff.filter((r) => r.status === "完了").length; const pct = eff.length ? Math.round((dn / eff.length) * 100) : 0;
    const ST = ["未対応", "架電済み（不在）", "対応中", "完了", "対象外"];
    const needIds = rows0.map((r) => r.id).filter((id) => !(kc.inf && kc.inf[id]));
    if (needIds.length && !kc.infBusy) { kc.infBusy = true; api("/api/kinxs/sfinfo", { method: "POST", body: JSON.stringify({ ids: needIds }) }).then((d2) => { kc.inf = { ...(kc.inf || {}), ...(d2.info || {}) }; kc.infBusy = false; renderCallV2(); }).catch(() => { kc.infBusy = false; }); }
    body = `<div class="v2-month"><button type="button" class="kx-btn" data-kc-m="-1">◀</button><b>${kxYmLabel(kc.ym)}</b><button type="button" class="kx-btn" data-kc-m="1">▶</button><button type="button" class="kx-btn" data-kc-csv2 style="margin-left:auto">スプレッドシート用に書き出す（CSV）</button></div>
      <div class="v2-strip">${d.months.map((m) => `<button type="button" class="${m.ym === kc.ym ? "on" : ""}" data-kc-ym="${m.ym}"><b>${Number(m.ym.slice(5))}月</b><small>${esc(m.reasons.join("・") || "—")}</small><span>${m.future ? "予定" : `完了 ${m.done}`}</span></button>`).join("")}</div>
      <section class="v2-sec"><div class="v2-big"><span class="l">今月のサマリ</span><span class="v">完了 ${dn}<small>/ ${eff.length}社</small></span><span class="pct" style="font-weight:800;color:#0E6B4E">${pct}%</span><div class="bar" style="flex:1;min-width:120px"><i style="width:${pct}%"></i></div></div>
        <div class="v2-big" style="margin-top:6px">${ST.map((s) => `<button type="button" class="v2-chip ${kc.f.st === s ? "red" : ""}" data-kc-st="${esc(s)}">${esc(s)} <b>${rows0.filter((r) => r.status === s).length}</b></button>`).join("")}</div></section>
      <div class="v2-month"><select class="kx-in" data-kc-f="reason" style="max-width:180px"><option value="">電話の理由：すべて</option>${[...new Set(rows0.map((r) => r.reason))].map((x) => `<option ${kc.f.reason === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select><select class="kx-in" data-kc-f="cs" style="max-width:160px"><option value="">担当：全員</option>${[...new Set(rows0.map((r) => kxSurname(r.cs)).filter(Boolean))].map((x) => `<option ${kc.f.cs === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>
      <div class="v2-tbl" style="max-height:none"><div class="v2-act h call co2"><span>企業名</span><span>電話の理由</span><span>担当</span><span>電話番号（SF）</span><span>ステータス</span><span>架電</span><span>結果</span><span>メモ・次のアクション</span><span>NA日</span></div>
      ${rows.map((r) => `<div class="v2-act call co2" data-id="${esc(r.id)}" data-mkey="${esc(r.me.key)}"><span class="co" data-open="${esc(r.id)}" role="button" tabindex="0">${kxLogoMini(r)}${esc(r.name)}</span><span><span class="v2-tag">${esc(r.reason)}</span></span><span>${esc(kxSurname(r.cs) || "未定")}</span><span class="tel">${kc.inf && kc.inf[r.id] ? (kc.inf[r.id].phone ? `<a href="tel:${esc(kc.inf[r.id].phone)}">${esc(kc.inf[r.id].phone)}</a>` : "—") : "…"}</span>
        <select class="kx-in" data-f="status">${ST.map((s) => `<option ${s === r.status ? "selected" : ""}>${s}</option>`).join("")}</select>
        <span class="calls"><b>${r.calls}</b>回 <button type="button" class="hp-b" data-call>＋架電</button><small>${esc(r.lastCall ? r.lastCall.slice(5).replace("-", "/") : "")}</small></span>
        <select class="kx-in" data-f="result">${["", "良好", "普通", "懸念あり", "未接続"].map((s) => `<option value="${s}" ${s === r.result ? "selected" : ""}>${s || "—"}</option>`).join("")}</select>
        <input class="kx-in" data-f="memo" value="${esc(r.memo)}" placeholder="メモ・次のアクション" /><input type="date" class="kx-in" data-f="na_date" value="${esc(r.naDate)}" /></div>`).join("") || '<div class="kx-empty">この月の電話の対象はありません</div>'}</div>
      <div class="kx-note">変えるとすぐ保存し、年間施策の数字と、企業詳細の議事録タブ（電話・メールなどの記録）にも入ります。</div>`;
  }
  box.innerHTML = tabs + body;
  box.querySelectorAll("[data-kc-tab]").forEach((b) => b.addEventListener("click", () => { kc.tab = b.dataset.kcTab; renderCallV2(); }));
  const pe = box.querySelector("[data-kc-period]"); if (pe) pe.addEventListener("change", () => { kc.period = Number(pe.value); kc.data = null; renderCallV2(); });
  box.querySelectorAll("[data-kc-ym]").forEach((b) => b.addEventListener("click", async () => { kc.ym = b.dataset.kcYm; kc.tab = "co"; kc.plan = await api(`/api/kinxs/plan?ym=${kc.ym}`).catch(() => null); renderCallV2(); }));
  box.querySelectorAll("[data-kc-m]").forEach((b) => b.addEventListener("click", async () => { kc.ym = kxYmAdd(kc.ym, Number(b.dataset.kcM)); kc.plan = await api(`/api/kinxs/plan?ym=${kc.ym}`).catch(() => null); renderCallV2(); }));
  box.querySelectorAll("[data-kc-st]").forEach((b) => b.addEventListener("click", () => { kc.f.st = kc.f.st === b.dataset.kcSt ? "" : b.dataset.kcSt; renderCallV2(); }));
  box.querySelectorAll("[data-kc-f]").forEach((s) => s.addEventListener("change", () => { kc.f[s.dataset.kcF] = s.value; renderCallV2(); }));
  box.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", () => openDetail(el.dataset.open)));
  box.querySelectorAll(".v2-act[data-id]").forEach((row) => {
    const id = row.dataset.id, mkey = row.dataset.mkey;
    row.querySelectorAll("[data-f]").forEach((el) => el.addEventListener("change", async () => { try { await kpSave(mkey, kc.ym, { account_id: id, [el.dataset.f]: el.value }); el.style.borderColor = "#1D9E75"; kc.plan = await api(`/api/kinxs/plan?ym=${kc.ym}`).catch(() => kc.plan); } catch (e) { el.style.borderColor = "#C43D3D"; alert(e.message); } }));
    const cb = row.querySelector("[data-call]"); if (cb) cb.addEventListener("click", async () => { const stEl = row.querySelector('[data-f="status"]'); const st0 = stEl.value === "未対応" ? "架電済み（不在）" : stEl.value; try { await kpSave(mkey, kc.ym, { account_id: id, call: true, status: st0 }); kc.plan = await api(`/api/kinxs/plan?ym=${kc.ym}`); renderCallV2(); } catch (e) { alert(e.message); } });
  });
  const c1 = box.querySelector("[data-kc-csv]"); if (c1) c1.addEventListener("click", () => kpCsv(`電話フォロー_${d.period}期_月別.csv`, ["月", "電話の理由", "対象", "未対応", "架電済み（不在）", "対応中", "完了", "完了率", "良好", "普通", "懸念あり"], d.months.map((m) => [m.ym, m.reasons.join("・"), m.total, m.counts["未対応"] || 0, m.counts["架電済み（不在）"] || 0, m.counts["対応中"] || 0, m.done, m.total ? Math.round((m.done / m.total) * 100) + "%" : "", m.results["良好"] || 0, m.results["普通"] || 0, m.results["懸念あり"] || 0])));
  const c2 = box.querySelector("[data-kc-csv2]"); if (c2) c2.addEventListener("click", () => { const ms = ((kc.plan && kc.plan.measures) || []).filter((x) => x.call); kpCsv(`電話フォロー_${kc.ym}.csv`, ["企業名", "電話の理由", "担当", "電話番号", "ステータス", "架電回数", "最終架電日", "結果", "メモ・次のアクション", "NA日"], ms.flatMap((x) => x.rows.map((r) => [r.name, x.reason, r.cs, ((kc.inf || {})[r.id] || {}).phone || "", r.status, r.calls, r.lastCall, r.result, r.memo, r.naDate]))); });
}

// 起動（年間施策・電話フォロー）。let の変数を使うので、いちばん最後で呼ぶ
if (VIEW === "plan") { if ($("kxPageName")) $("kxPageName").textContent = "年間施策"; renderPlanV2(); }
if (VIEW === "call") { if ($("kxPageName")) $("kxPageName").textContent = "電話フォロー"; renderCallV2(); }

// ---------- 一斉配信：② 対象企業を確認する（SFの担当者・メール・電話・住所・商談所有者と判定）＋ 書き出し・発送済み ----------
kp.tg = null; kp.tgKey = ""; kp.jf = "";
function kpTargetsHtml(me) {
  if (kp.tgKey !== `${kp.ym}|${me.key}`) { kp.tgKey = `${kp.ym}|${me.key}`; kp.tg = null; api(`/api/kinxs/plan/targets?ym=${kp.ym}&mkey=${me.key}`).then((d) => { kp.tg = d; renderPlanV2(); }).catch((e) => { kp.tg = { error: e.message }; renderPlanV2(); }); }
  if (!kp.tg) return '<div class="kx-note" style="margin-top:10px">SFから担当者・住所などを読んでいます…</div>';
  if (kp.tg.error) return `<div class="kx-empty">読めませんでした：${esc(kp.tg.error)}</div>`;
  const rows = kp.tg.rows.filter((r) => !kp.jf || r.j === kp.jf);
  const J = { 対象: "ok", 要確認: "warn", 送れない: "ng", 対象外: "out" };
  const nJ = (s) => kp.tg.rows.filter((r) => r.j === s).length;
  return `<div class="kx-note" style="margin-top:10px">送る前に直したい情報</div>
    <div class="v2-big">${Object.entries(kp.tg.fix).map(([k, n]) => `<span class="v2-chip ${n ? "red" : ""}">${esc(k)} <b>${n}</b></span>`).join("")}</div>
    <div class="kx-note" style="margin-top:8px">② 対象企業を確認する　対象 ${nJ("対象")}社 ／ 要確認 ${nJ("要確認")}社 ／ 送れない ${nJ("送れない")}社 ／ 対象外 ${nJ("対象外")}社 ／ 選択中 ${kp.chk.size}社</div>
    <div class="v2-big" style="margin-top:4px">${["", "対象", "要確認", "送れない", "対象外"].map((s) => `<button type="button" class="v2-chip ${kp.jf === s ? "red" : ""}" data-jf="${s}">${s || "すべて"}</button>`).join("")}</div>
    <div class="v2-tbl" style="max-height:520px"><div class="v2-tr h dl2"><span><input type="checkbox" data-chk-all /></span><span>取引先名</span><span>プラン</span><span>担当者</span><span>メール</span><span>電話</span><span>郵便番号</span><span>住所</span><span>商談所有者</span><span>確認</span><span>判定</span></div>
    ${rows.map((r) => `<div class="v2-tr dl2" data-sid="${esc(r.id)}"><span><input type="checkbox" data-chk="${esc(r.id)}" ${kp.chk.has(r.id) ? "checked" : ""}/></span><span class="co" data-open="${esc(r.id)}" role="button" tabindex="0">${esc(r.name)}</span><span class="kx-note">${esc((r.products || []).slice(0, 1).join(""))}</span><span>${esc(r.contact || "—")}</span><span class="sm">${esc(r.email || "—")}</span><span class="sm">${esc(r.phone || "—")}</span>
      <span><input class="kx-in sm" data-sd="postal" value="${esc(r.postal || "")}" placeholder="〒" /></span><span><input class="kx-in sm" data-sd="address" value="${esc(r.address || "")}" placeholder="住所" title="${r.sendEdited ? "kinXsで直した送付先（SFの取り込みで消えません）" : "SFの請求先"}" /></span><span>${esc(r.owner || "—")}</span>
      <span><select class="kx-in sm" data-sd="check">${["", "確認OK", "修正必要", "対象外"].map((s) => `<option value="${s}" ${s === (r.check || "") ? "selected" : ""}>${s || "未確認"}</option>`).join("")}</select></span><span><span class="v2-j ${J[r.j]}">${esc(r.j)}</span>${r.why ? `<small>${esc(r.why)}</small>` : ""}</span></div>`).join("") || '<div class="kx-empty">ありません</div>'}</div>
    <div class="v2-dl-acts"><input class="kx-in" data-sheet placeholder="DOCユーザーリストのURL（一度入れれば覚えます）" style="min-width:280px" /><button type="button" class="kx-btn kx-pri" data-dl-sheet>スプレッドシートに書き出す（新しいタブ）</button><button type="button" class="kx-btn" data-dl-csv>CSVで書き出す</button>${me.ch === "郵送" ? '<button type="button" class="kx-btn" data-dl-done>選んだ企業を「発送済み」にする</button>' : '<button type="button" class="kx-btn" data-dl-done>選んだ企業を「完了」にする</button>'}<button type="button" class="kx-btn" data-dl-out>選んだ企業を「対象外」にする</button><span class="kx-note" data-dl-st></span></div>
    <div class="kx-note">郵便番号・住所はSFの請求先です。ここで直すと kinXs の送付先として残り、SFの取り込みで消えません（SFには書き戻しません）。③ メールの一斉配信（テンプレート・差し込み・予約・開封の数）は、このあと足します。</div>`;
}
function kpWireTargets(box, me) {
  if (!kp.tg || kp.tg.error) return;
  box.querySelectorAll(".v2-tr.dl2 [data-open]").forEach((el) => el.addEventListener("click", () => openDetail(el.dataset.open)));
  box.querySelectorAll("[data-jf]").forEach((b) => b.addEventListener("click", () => { kp.jf = b.dataset.jf; renderPlanV2(); }));
  box.querySelectorAll("[data-chk]").forEach((c) => c.addEventListener("change", () => { c.checked ? kp.chk.add(c.dataset.chk) : kp.chk.delete(c.dataset.chk); }));
  const ca = box.querySelector("[data-chk-all]"); if (ca) ca.addEventListener("change", () => { for (const r of kp.tg.rows.filter((x) => !kp.jf || x.j === kp.jf)) ca.checked ? kp.chk.add(r.id) : kp.chk.delete(r.id); renderPlanV2(); });
  box.querySelectorAll("[data-sd]").forEach((el) => el.addEventListener("change", async () => {
    const id = el.closest("[data-sid]").dataset.sid;
    try { await api(`/api/kinxs/accounts/${encodeURIComponent(id)}/send`, { method: "PUT", body: JSON.stringify({ [el.dataset.sd]: el.value }) }); el.style.borderColor = "#1D9E75"; kp.tgKey = ""; renderPlanV2(); }
    catch (e) { el.style.borderColor = "#C43D3D"; alert(e.message); }
  }));
  const sel = () => kp.tg.rows.filter((r) => kp.chk.size ? kp.chk.has(r.id) : (!kp.jf || r.j === kp.jf));
  const table = () => [["プラン", "取引先名", "担当者", "メール", "電話", "郵便番号", "住所", "商談所有者", "判定", "理由"], ...sel().map((r) => [(r.products || []).join("・"), r.name, r.contact || "", r.email || "", r.phone || "", r.postal || "", r.address || "", r.owner || "", r.j, r.why || ""])];
  const csvB = box.querySelector("[data-dl-csv]"); if (csvB) csvB.addEventListener("click", () => { const t = table(); kpCsv(`${kp.ym}_${me.name}対象.csv`, t[0], t.slice(1)); });
  const shB = box.querySelector("[data-dl-sheet]"); if (shB) shB.addEventListener("click", async () => {
    const st = box.querySelector("[data-dl-st]"); st.textContent = "　書き出しています…";
    try { const r = await api("/api/kinxs/plan/sheet", { method: "POST", body: JSON.stringify({ sheetId: box.querySelector("[data-sheet]").value.trim() || undefined, title: `${kp.ym}_${me.name.replace(/[（(].*$/, "")}対象`, rows: table() }) }); st.innerHTML = `　タブ「${esc(r.tab)}」に書き出しました　<a href="${esc(r.url)}" target="_blank" rel="noopener">開く ↗</a>`; }
    catch (e) { st.textContent = "　" + e.message; }
  });
  const bulk = async (status) => { if (!kp.chk.size) { alert("企業を選んでください"); return; } try { const n = kp.chk.size; await api("/api/kinxs/actions", { method: "PUT", body: JSON.stringify({ mkey: me.key, ym: kp.ym, ids: [...kp.chk], status }) }); if (status === "完了") kxDoneToast(`${n}社を${me.ch === "郵送" ? "発送済み" : "完了"}にしました`); kp.chk.clear(); kp.tgKey = ""; kpLoad(true); } catch (e) { alert(e.message); } };
  const dn = box.querySelector("[data-dl-done]"); if (dn) dn.addEventListener("click", () => bulk("完了"));
  const ot = box.querySelector("[data-dl-out]"); if (ot) ot.addEventListener("click", () => bulk("対象外"));
}
if (VIEW === "trend") { if ($("kxPageName")) $("kxPageName").textContent = "傾向分析"; renderTrendV2(); }

// ===================== 動きの仕上げ（2026-11-04 田中さん：1 カウントアップ・2 浮くカード・3 脈打つアラート・5 読み込みの光・6 完了のチェック）=====================
// 5 読み込み中は、カードの形のまま光が流れる仮の形
function kxSkel(kind) {
  const line = (w) => `<div class="fx-sk" style="width:${w}"></div>`;
  if (kind === "home") return `<div class="fx-skg"><div class="fx-skc big">${line("40%")}${line("60%")}${line("90%")}</div>${[1, 2, 3].map(() => `<div class="fx-skc">${line("50%")}${line("35%")}</div>`).join("")}</div><div class="fx-skg two"><div class="fx-skc tall">${[90, 80, 85, 70, 88, 75].map((w) => line(w + "%")).join("")}</div><div class="fx-skc tall">${[70, 90, 60, 80].map((w) => line(w + "%")).join("")}</div></div>`;
  return `<div class="fx-skc tall">${[60, 90, 80, 85, 70, 88].map((w) => line(w + "%")).join("")}</div>`;
}
// 1 数字のカウントアップと、帯が左から伸びる（data-cu="数" の要素・data-grow の帯）
function kxCountUp(root) {
  if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const els = [...root.querySelectorAll("[data-cu]")];
  const t0 = performance.now();
  els.forEach((el) => { el.dataset.cuTo = el.dataset.cu; el.firstChild && (el.firstChild.nodeValue = "0"); });
  const tick = (t) => {
    const p = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(1 - p, 3);
    for (const el of els) if (el.firstChild) el.firstChild.nodeValue = String(Math.round(Number(el.dataset.cuTo) * e));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  root.querySelectorAll("[data-grow] > i, i[data-grow]").forEach((i) => { const w = i.style.width; i.style.transition = "none"; i.style.width = "0"; requestAnimationFrame(() => requestAnimationFrame(() => { i.style.transition = "width 1s cubic-bezier(.2,.8,.2,1)"; i.style.width = w; })); });
}
// 6 完了にしたとき、チェックが弾んで下から知らせが出る
function kxDoneToast(msg) {
  document.querySelectorAll(".fx-toast").forEach((x) => x.remove());
  const t = document.createElement("div"); t.className = "fx-toast"; t.setAttribute("role", "status");
  t.innerHTML = `<span class="fx-ck">✓</span><span>${esc(msg || "完了にしました")}</span>`;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add("on"));
  setTimeout(() => { t.classList.remove("on"); setTimeout(() => t.remove(), 400); }, 2400);
}

// ===================== ユーザー一覧：CSVで書き出す・CSVでまとめて直す（2026-11-06 久野さんの要望）=====================
const KX_CSV_COLS = [
  ["ID", (x) => x.id, null], ["会社名", (x) => x.name, null], ["商品", (x) => (x.products || []).join("・"), null], ["FS", (x) => x.fs || "", null], ["受注日", (x) => x.booked || "", null],
  ["CS担当", (x) => x.cs || "", "cs"], ["フェーズ", (x) => x.label || "", "phase"], ["確度", (x) => x.rank || "", "rank"], ["更新月", (x) => x.renew || "", "renew"],
  ["次回アクション", (x) => x.na || "", "na"], ["NA日", (x) => x.naDue || "", "naDue"], ["利用目的", (x) => x.purpose || "", "purpose"], ["活用", (x) => x.usage || "", "usage"], ["メモ", (x) => x.memo || "", "memo"],
];
function kxCsvLine(arr) { return arr.map((v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`).join(","); }
function kxCsvParse(text) {
  const rows = []; let row = [], cur = "", q = false;
  const t = String(text || "").replace(/^\ufeff/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; continue; }
    if (c === '"') q = true; else if (c === ",") { row.push(cur); cur = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ""));
}
if ($("lsCsvOut")) $("lsCsvOut").addEventListener("click", () => {
  const items = window.__lsShown || [];
  if (!items.length) { alert("書き出す会社がありません"); return; }
  const body = [kxCsvLine(KX_CSV_COLS.map((c) => c[0])), ...items.map((x) => kxCsvLine(KX_CSV_COLS.map((c) => c[1](x))))].join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["\ufeff" + body], { type: "text/csv" }));
  a.download = `kinXs_ユーザー一覧_${new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
if ($("lsCsvIn")) $("lsCsvIn").addEventListener("click", () => $("lsCsvFile").click());
if ($("lsCsvFile")) $("lsCsvFile").addEventListener("change", async (e) => {
  const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return;
  const rows = kxCsvParse(await f.text()); if (rows.length < 2) { alert("CSVの中身がありません"); return; }
  const head = rows[0].map((h) => String(h).trim()); const idx = (n) => head.indexOf(n);
  if (idx("ID") < 0) { alert("「ID」の列がありません。「CSVで書き出す」で出したCSVを直して取り込んでください"); return; }
  const byId = new Map(((lsData && lsData.items) || []).map((x) => [String(x.id), x]));
  const labels = (lsData && lsData.labels) || [];
  const changes = []; const bad = [];
  for (const r of rows.slice(1)) {
    const id = String(r[idx("ID")] || "").trim(); const x = byId.get(id); if (!x) { if (id) bad.push(`${r[idx("会社名")] || id}（IDが見つからない）`); continue; }
    const ch = {};
    for (const [col, get, key] of KX_CSV_COLS) {
      if (!key || idx(col) < 0) continue;
      const nv = String(r[idx(col)] == null ? "" : r[idx(col)]).trim(); const ov = String(get(x) || "").trim();
      if (nv === ov) continue;
      if (key === "rank" && !["S", "A", "B", "C", "Z", "F"].includes(nv.toUpperCase())) { bad.push(`${x.name}：確度「${nv}」は S・A・B・C・Z・F のどれか`); continue; }
      if (key === "renew" && nv && !/^\d{4}-\d{2}$/.test(nv.replace(/\//g, "-"))) { bad.push(`${x.name}：更新月「${nv}」は 2027-03 の形`); continue; }
      if (key === "phase" && nv && !labels.includes(nv)) { bad.push(`${x.name}：フェーズ「${nv}」は ${labels.join("・")} のどれか`); continue; }
      if (key === "naDue" && nv && !/^\d{4}-\d{1,2}-\d{1,2}$/.test(nv.replace(/\//g, "-"))) { bad.push(`${x.name}：NA日「${nv}」は 2026-11-20 の形`); continue; }
      ch[key] = { from: ov, to: nv };
    }
    if (Object.keys(ch).length) changes.push({ x, ch });
  }
  const NAME = { cs: "CS担当", phase: "フェーズ", rank: "確度", renew: "更新月", na: "次回アクション", naDue: "NA日", purpose: "利用目的", usage: "活用", memo: "メモ" };
  document.querySelectorAll(".v2-pop-bg").forEach((x) => x.remove());
  const bg = document.createElement("div"); bg.className = "v2-pop-bg";
  bg.innerHTML = `<div class="v2-pop wide"><div class="v2-pop-h"><b>CSVでまとめて直す</b><span class="kx-note">${changes.length}社・${changes.reduce((a, c) => a + Object.keys(c.ch).length, 0)}か所が変わります${bad.length ? `／直せないもの ${bad.length}件` : ""}</span><button type="button" class="kx-btn" data-x style="margin-left:auto">やめる</button></div>
    <div class="v2-pop-b">${bad.length ? `<div class="kx-note" style="color:#A51F16;margin-bottom:8px">${bad.slice(0, 20).map(esc).join("<br>")}${bad.length > 20 ? "<br>…" : ""}</div>` : ""}
    ${changes.length ? changes.map(({ x, ch }) => `<div class="v2-csvr"><b>${esc(x.name)}</b>${Object.entries(ch).map(([k, v]) => `<span><em>${NAME[k]}</em>${esc(v.from || "（空）")} → <b>${esc(v.to || "（空）")}</b></span>`).join("")}</div>`).join("") : '<div class="kx-empty">変わるところはありません</div>'}</div>
    ${changes.length ? `<div class="v2-pop-h" style="border-top:1px solid #E6EDE9;border-bottom:0"><span class="kx-note" data-csv-st>確かめて「直す」を押してください。フェーズを空にすると自動に戻ります。</span><button type="button" class="kx-btn kx-pri" data-csv-go style="margin-left:auto">${changes.length}社を直す</button></div>` : ""}</div>`;
  document.body.appendChild(bg);
  bg.querySelector("[data-x]").addEventListener("click", () => bg.remove());
  const go = bg.querySelector("[data-csv-go]"); if (go) go.addEventListener("click", async () => {
    go.disabled = true; const st = bg.querySelector("[data-csv-st]"); let ok = 0, ng = 0;
    for (const { x, ch } of changes) {
      try {
        const body = {};
        if (ch.cs) body.cs_name = ch.cs.to; if (ch.na) body.na_text = ch.na.to; if (ch.naDue) body.na_due = ch.naDue.to.replace(/\//g, "-"); if (ch.purpose) body.purpose = ch.purpose.to; if (ch.usage) body.usage_status = ch.usage.to; if (ch.memo) body.memo = ch.memo.to;
        if (ch.phase) body.main_label = ch.phase.to || null; if (ch.renew && ch.renew.to) body.renew_month = ch.renew.to.replace(/\//g, "-");
        if (Object.keys(body).length) await api(`/api/kinxs/accounts/${encodeURIComponent(x.id)}`, { method: "PUT", body: JSON.stringify(body) });
        if (ch.rank) await api(`/api/kinxs/accounts/${encodeURIComponent(x.id)}/rank`, { method: "PUT", body: JSON.stringify({ rank: ch.rank.to.toUpperCase() }) });
        ok++;
      } catch { ng++; }
      if (st) st.textContent = `直しています… ${ok + ng}/${changes.length}`;
    }
    bg.remove(); kxDoneToast(`${ok}社を直しました${ng ? `（${ng}社は直せませんでした）` : ""}`);
    lsData = null; loadList();
  });
});

// 受注商品に「アチコチバース」が入っている会社か（DOC更新管理の対象）（2026-11-06）
function kxIsAchiX(x) { return (x && Array.isArray(x.products) ? x.products : []).some((p) => /アチコチバース/.test(String((p && p.name) || p || "").normalize("NFKC"))); }

// 企業詳細：会社名の下の商品は2行まで。長いときは「▼ すべて見る」で開く（2026-11-06 久野さん）
document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("[data-prods-tog]"); if (!b) return;
  const box = b.closest("[data-prods]"); const open = box.classList.toggle("open");
  b.textContent = open ? "▲ たたむ" : "▼ すべて見る";
});
new MutationObserver(() => {
  document.querySelectorAll("[data-prods]:not([data-prods-ck])").forEach((box) => {
    box.setAttribute("data-prods-ck", "1");
    requestAnimationFrame(() => { const t = box.querySelector(".t"); const b = box.querySelector("[data-prods-tog]"); if (t && b && t.scrollHeight > t.clientHeight + 2) b.hidden = false; });
  });
}).observe(document.body, { childList: true, subtree: true });

// kincs：管理者には「メンバーを招待」（kincs だけを使うアカウントを作るリンク）（2026-11-08）
if (window.KX_COPY) {
  fetch("/api/me").then((r) => r.json()).then((me) => {
    if (!me || !me.admin) return;
    const host = document.querySelector(".kx-head-r, .kx-top .r, header .kx-head, .topbar") || document.body;
    const b = document.createElement("button"); b.type = "button"; b.className = "kx-btn"; b.textContent = "＋ メンバーを招待";
    b.style.cssText = "margin-left:8px";
    b.title = "kincs だけを使うアカウントを作るリンクをコピーします（その人は kincs しか見られず、直した内容は kincs にだけ残ります）";
    b.addEventListener("click", async () => {
      try { const d = await api("/api/kincs/invite"); await navigator.clipboard.writeText(d.url).catch(() => {}); prompt("招待リンク（コピーしました）。この人は kincs しか見られず、直した内容は kincs にだけ残ります。", d.url); } catch (e) { alert(e.message); }
    });
    const pn = document.getElementById("kxPageName"); if (pn && pn.parentElement) pn.parentElement.appendChild(b); else host.appendChild(b);
  }).catch(() => {});
}

// kincs：サイドバーの下に「設定」（アカウント・Google連携・Salesforce連携だけの設定）（2026-11-08）
if (window.KX_COPY) {
  const nav = document.querySelector(".kx-nav[data-view='renew']");
  if (nav && nav.parentElement && !document.getElementById("kcsSet")) {
    const a = document.createElement("a"); a.id = "kcsSet"; a.className = "kx-nav"; a.href = "/kincs/settings";
    a.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>設定`;
    nav.parentElement.insertBefore(a, nav.nextSibling);
  }
}
