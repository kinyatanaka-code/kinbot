// kinXs と、そのコピー（kincs：/kincs）で同じ画面を使う。ページの移動先はここで切りかえる（2026-11-07）
const KX_BASE = window.KX_COPY ? "/kincs" : "/kinxs";
// 電話番号は Zoom Phone でかける（Zoom の連携が入っていれば zoomphonecall://、無ければ tel:）（2026-11-09 田中さん「kincs・販売管理など kincall 以外の人も Zoom Phone を」）
let KX_ZOOM = true;
fetch("/api/zoom-phone/status").then((r) => r.json()).then((z) => { KX_ZOOM = !!(z && z.設定済み && z.接続 !== false && z.clickToCall !== false); }).catch(() => {});
function kxTelLink(v) {
  const s = String(v || "").trim(); const d = s.replace(/[^0-9+]/g, "");
  if (!d) return esc(s);
  // 「端末」のリンクはやめ、📞 は1つだけ（2026-11-10 田中さん）
  return KX_ZOOM ? `<a href="zoomphonecall://${esc(d)}" class="kx-zcall" title="Zoom Phone でかける">📞 ${esc(s)}</a>` : `<a href="tel:${esc(d)}">📞 ${esc(s)}</a>`;
}
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
// テスト用の会社を出すか（このブラウザだけ。DOC自動更新の上の「🧪 テスト」で切りかえ）（2026-11-10）
const KX_TEST = (() => { try { return localStorage.getItem("kxTest") === "1"; } catch { return false; } })();
const kxUsersUrl = () => `/api/kinxs/users${KX_TEST ? "?test=1" : ""}`;
const VIEW = ({ mail: "mail", ar: "ar", missing: "missing", home: "home", renew: "renew", list: "list", import: "import", cs: "cs", board: "board", settings: "settings", plan: "plan", trend: "trend", call: "call" })[new URLSearchParams(location.search).get("p")] || "home";
document.querySelectorAll(".kx-nav[data-view], .kx-side-set[data-view]").forEach((a) => a.classList.toggle("on", a.dataset.view === VIEW));
if ($("vAr")) $("vAr").hidden = VIEW !== "ar"; if ($("vMail")) $("vMail").hidden = VIEW !== "mail"; $("vList").hidden = VIEW !== "list"; if ($("vHome")) $("vHome").hidden = VIEW !== "home"; if ($("vMissing")) $("vMissing").hidden = VIEW !== "missing"; $("vRenew").hidden = VIEW !== "renew"; $("vImport").hidden = VIEW !== "import"; $("vCs").hidden = VIEW !== "cs"; $("vBoard").hidden = VIEW !== "board"; $("vSet").hidden = VIEW !== "settings"; if ($("vPlan")) $("vPlan").hidden = VIEW !== "plan"; if ($("vTrend")) $("vTrend").hidden = VIEW !== "trend"; if ($("vCall")) $("vCall").hidden = VIEW !== "call";
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
api(kxUsersUrl()).then((u) => {
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
  try { lsData = await api(kxUsersUrl()); renderList(); }
  catch (e) { $("lsTable").innerHTML = `<div class="kx-empty">読み込めませんでした：${esc(e.message)}</div>`; }
}
// 商品ラベルの小さな札（DOC＝緑、SNS＝紫）
const KX_DOC_L = ["空間", "AI"], KX_SNS_L = ["SNS", "Instagram", "配信代行", "動画制作"];
function kxPlTags(x) { const l = (x.prodLabels || []).map((t) => (t === "インスタ" ? "Instagram" : t)); return (l.length || x.manual) ? `<span class="kx-pltags">${l.map((t) => `<span class="kx-pl ${KX_SNS_L.includes(t) ? "sns" : "doc"}">${esc(t)}</span>`).join("")}${x.manual ? '<span class="kx-pl nosf" title="SFの商談に紐づいていません（モーダルの企業情報で紐づけられます）">SF未連携</span>' : ""}</span>` : ""; }
// ユーザー一覧・更新管理の「すべて／DOC／SNS」（2026-10-27）
function kxTrackGet() { try { return localStorage.getItem("kxTrack") || "all"; } catch { return "all"; } }
function kxTrackSet(v) { try { localStorage.setItem("kxTrack", v); } catch {} }
// DOC を選んだときは、さらに「すべて／直販／PS」で絞れる（2026-11-11 田中さん）
function kxChanGet() { try { return localStorage.getItem("kxChan") || "all"; } catch { return "all"; } }
function kxChanSet(v) { try { localStorage.setItem("kxChan", v); } catch {} }
function kxInitGet() { try { return localStorage.getItem("kxInit") || "all"; } catch { return "all"; } }
function kxInitSet(v) { try { localStorage.setItem("kxInit", v); } catch {} }
function kxTrackOk(x) { const t = kxTrackGet(); if (t === "DOC") { const c = kxChanGet(), ii = kxInitGet(); return kxHasDoc(x) && (c === "all" || x.channel === c) && (ii === "all" || (ii === "yes" ? x.initFee === true : x.initFee === false)); } return t === "SNS" ? kxHasSns(x) : true; }
function kxTrackSeg(onChange) {
  const t = kxTrackGet(), c = kxChanGet();
  const html = `<div class="kx-seg kx-trackseg" role="tablist">${[["all", "すべて"], ["DOC", "DOC"], ["SNS", "SNS"]].map(([k, l]) => `<button type="button" class="${t === k ? "on" : ""}" data-kxtrack="${k}">${l}</button>`).join("")}</div>${t === "DOC" ? `<div class="kx-seg kx-trackseg kx-chanseg" role="tablist" title="販売区分">${(() => { const src = (typeof lsData !== "undefined" && lsData && lsData.items) ? lsData.items.filter((x) => !x.archived && kxHasDoc(x)) : null;
      return [["all", "すべて"], ["直販", "直販"], ["PS", "PS"]].map(([k, l]) => `<button type="button" class="${c === k ? "on" : ""}" data-kxchan="${k}">${l}${src ? `<small style="margin-left:3px;opacity:.75">${k === "all" ? src.length : src.filter((x) => x.channel === k).length}</small>` : ""}</button>`).join(""); })()}</div>
      <div class="kx-seg kx-trackseg kx-chanseg" role="tablist" title="初期費用">${(() => { const ii = kxInitGet(); const src = (typeof lsData !== "undefined" && lsData && lsData.items) ? lsData.items.filter((x) => !x.archived && kxHasDoc(x) && (c === "all" || x.channel === c)) : null;
        return [["all", "初期：すべて"], ["yes", "初期あり"], ["no", "初期なし"]].map(([k, l]) => `<button type="button" class="${ii === k ? "on" : ""}" data-kxinit="${k}">${l}${src ? `<small style="margin-left:3px;opacity:.75">${k === "all" ? src.length : src.filter((x) => x.initFee === (k === "yes")).length}</small>` : ""}</button>`).join(""); })()}</div>` : ""}`;
  return { html, wire: (root) => { root.querySelectorAll("[data-kxtrack]").forEach((b) => b.addEventListener("click", () => { kxTrackSet(b.dataset.kxtrack); onChange(); }));
    root.querySelectorAll("[data-kxchan]").forEach((b) => b.addEventListener("click", () => { kxChanSet(b.dataset.kxchan); onChange(); }));
    root.querySelectorAll("[data-kxinit]").forEach((b) => b.addEventListener("click", () => { kxInitSet(b.dataset.kxinit); onChange(); })); } };
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
    kb.innerHTML = `${kp ? `<span class="kx-chip on" style="cursor:default">${esc(nm)}の会社だけ</span><button type="button" class="kx-chip" data-kpi="">絞り込みを外す</button>` : ""}`;   // 「SF未連携を自動で紐づける」はなくし、「アーカイブを見る」はヘッダーへ（2026-11-11 田中さん）
    { const ab = $("kxArcTop"); if (ab) { ab.hidden = VIEW !== "list"; ab.textContent = kp === "arc" ? "アーカイブを閉じる" : `アーカイブを見る${arcN ? `（${arcN}）` : ""}`; ab.classList.toggle("on", kp === "arc");
      if (!ab.dataset.wired) { ab.dataset.wired = "1"; ab.addEventListener("click", () => { window.__lsKpi = window.__lsKpi === "arc" ? "" : "arc"; document.querySelectorAll("#kxTopKpis [data-tk]").forEach((x) => x.classList.toggle("on", x.dataset.tk === window.__lsKpi)); renderList(); }); } } }
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
      : `<span class="mono" aria-hidden="true">${esc(mono(x.name))}</span>`}<div class="nm has-former"><span class="t">${esc(x.name)}</span>${(x.formerNames || []).length ? `<span class="kx-former" title="旧社名：${esc(x.formerNames.join("・"))}">旧：${esc(x.formerNames[x.formerNames.length - 1])}</span>` : ""}<span class="kx-uc-tags2">${x.channel ? `<span class="kx-chtag ${x.channel === "直販" ? "dr" : "ps"}" title="販売区分">${esc(x.channel)}</span>` : ""}${kxPlTags(x)}${x.initFee === true ? '<span class="kx-chtag init" title="初期費用（エントリープランなど）あり">初期あり</span>' : x.initFee === false ? '<span class="kx-chtag noinit" title="初期費用なし（アチコチバースのみ）">初期なし</span>' : ""}</span></div></div>`;
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
    navs.forEach((b) => b.addEventListener("click", () => { board.scrollBy({ left: Number(b.dataset.csnav) * Math.max(280, board.clientWidth - 280), behavior: "smooth" }); setTimeout(paintNav, 450); }));
    window.addEventListener("resize", paintNav);
    board.addEventListener("scroll", paintNav);
    // 横に動かす：列の中でも、横向きのスワイプ（トラックパッド）・Shift＋ホイールなら横に。列の外ではふつうのホイールも横に
    board.addEventListener("wheel", (e) => {
      const inCol = !!e.target.closest(".kx-cscol-b");
      const horiz = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (horiz) return;   // 横向きのスワイプは、ブラウザにそのまま任せる（自分で動かすと引っかかる）
      if (e.shiftKey) { board.scrollLeft += e.deltaY; e.preventDefault(); return; }
      if (inCol) {   // 列の中のふつうのホイールは、その列を縦に。ただし、その列がもう縦に動かないとき（短い列・端まで来た）は横に
        const cb = e.target.closest(".kx-cscol-b");
        const canV = e.deltaY > 0 ? cb.scrollTop + cb.clientHeight < cb.scrollHeight - 1 : cb.scrollTop > 0;
        if (canV) return;
      }
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
  // 絞り込んだときの社数（2026-11-11 田中さん）
  { const shown = items.length; const live0 = d.items.filter((x) => !x.archived).length;
    $("lsSt").innerHTML = shown != null && shown !== live0 ? `<b style="color:#0E6B4E;font-size:13px">${shown}社</b> ／ 全${d.items.length}社` : `全${d.items.length}社`; }
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
  const val = (v, kind) => !v ? '<span class="kx-none">未登録</span>' : kind === "url" ? `<a href="${esc(href(v))}" target="_blank" rel="noopener">${esc(String(v).replace(/^https?:\/\//, "").replace(/\/$/, ""))} ↗</a>` : kind === "tel" ? kxTelLink(v) : kind === "mail" ? `<a href="mailto:${esc(v)}">${esc(v)}</a>` : esc(v);
  const contacts = f.contacts || [];
  const pw = (v) => `<span class="kx-pw" data-pw="${esc(v || "")}">••••••••</span><button type="button" class="hp-b" data-pw-show>見る</button><button type="button" class="hp-b" data-copy="${esc(v || "")}">コピー</button>`;
  const head = (t, edit) => `<div class="kx-c2h"><b>${t}</b>${edit ? '<button type="button" class="kx-ed" data-edit>編集</button>' : ""}</div>`;
  return `${kxLinkBox(d)}<div class="kx-co-grid">
    <div class="kx-co-col">
      <section class="kx-c2" data-sec>
        ${head("企業情報", true)}
        <div class="kx-view">
          <div class="kx-dl"><span>HP</span><div>${val(f.website, "url")} ${tag("website")}</div><span>住所</span><div>${val(f.address)} ${tag("address")}</div><span>電話番号</span><div>${val(f.phone, "tel")} ${tag("phone")}</div>
            <span>販売区分</span><div data-sales="channel"><span class="kx-note">SFを読んでいます…</span></div><span>サーカスNo</span><div data-sales="circus"><span class="kx-note">…</span></div><span>初期費用</span><div data-sales="initial"><span class="kx-note">…</span></div></div>
          ${f.sfNote && (!f.website || !f.address || !f.phone) ? `<div class="kx-note" style="margin-top:8px">${esc(f.sfNote)}${/見つかりません/.test(f.sfNote) ? "。「編集」で入れられます" : ""}</div>` : ""}
        </div>
        <div class="kx-editbox kx-form">
          <label>HP</label><input class="kx-in" data-info="website" data-src="${esc(src.website || "")}" value="${esc(f.website || "")}" placeholder="https://" />
          <label>住所</label><input class="kx-in" data-info="address" data-src="${esc(src.address || "")}" value="${esc(f.address || "")}" />
          <label>電話番号</label><input class="kx-in" data-info="phone" data-src="${esc(src.phone || "")}" value="${esc(f.phone || "")}" />
          <div class="kx-edact"><button type="button" class="hp-b" data-cancel>やめる</button><button type="button" class="kx-btn kx-pri" data-save-info>保存</button></div>
        </div>
      </section>
      <section class="kx-c2" data-sec>
        ${head(`先方の担当者 ${tag("contacts")}`, true)}
        <div class="kx-view">${contacts.length ? contacts.map((c) => `<div class="kx-person"><div class="av">${esc((c.name || "？").slice(0, 1))}</div><div style="min-width:0"><div class="nm">${esc(c.name || "（お名前なし）")}${c.title ? `<span>${esc(c.title)}</span>` : ""}</div><div class="ct">${c.phone ? val(c.phone, "tel") : ""}${c.email ? `　✉ ${val(c.email, "mail")}` : ""}</div></div></div>`).join("") : '<span class="kx-none">未登録</span>'}</div>
        <div class="kx-editbox">
          <div data-ct-rows>${(contacts.length ? contacts : [{}]).map((c) => `<div class="kx-ct"><input class="kx-in" data-ct="name" value="${esc(c.name || "")}" placeholder="お名前" /><input class="kx-in" data-ct="title" value="${esc(c.title || "")}" placeholder="部署・役職" /><input class="kx-in" data-ct="phone" value="${esc(c.phone || "")}" placeholder="電話番号" /><input class="kx-in" data-ct="email" value="${esc(c.email || "")}" placeholder="メールアドレス" /><button type="button" class="hp-b" data-ct-del>消す</button></div>`).join("")}</div>
          <div class="kx-edact"><button type="button" class="hp-b" data-ct-add style="margin-right:auto">＋ 担当者を追加</button><button type="button" class="hp-b" data-cancel>やめる</button><button type="button" class="kx-btn kx-pri" data-save-info>保存</button></div>
        </div>
      </section>
      ${kxLabelSchedPane(d, "label")}
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
function kxLabelSchedPane(d, part = "all") {
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
      ${pis.length ? `<div class="kx-ptbl"><div class="h"><span>商品</span><span>区別</span><span>計上日</span><span>サーカスNo</span><span>SF商談ID</span><span>商談</span></div>${pis.map((p0) => `<div class="r"><span class="nm">${esc(p0.name)}</span><span>${clsTag(p0.cls)}</span><span>${esc(String(p0.booked || "").replace(/-/g, "/") || "—")}</span><span data-circus-opp="${esc(p0.opp || "")}" data-circus-name="${esc(p0.oppName || "")}" style="font-variant-numeric:tabular-nums">…</span><span class="kx-oppid">${p0.opp ? `<a href="https://neo-media.my.salesforce.com/lightning/r/Opportunity/${encodeURIComponent(p0.opp)}/view" target="_blank" rel="noopener" title="SFの商談を開く">${esc(p0.opp)}</a><button type="button" class="kx-oppcp" data-copy="${esc(p0.opp)}" title="商談IDをコピー" aria-label="商談IDをコピー">⧉</button>` : "—"}</span><span class="kx-note">${esc(p0.oppName || p0.stage || "")}</span></div>`).join("")}</div>` : '<div class="kx-note">SFの商談の商品がありません（手で追加した会社か、まだ取り込んでいません）</div>'}
    </div>`;
  const kenSec = `<div class="kx-sec" data-ken-sec><div class="lb">検収書<span class="kx-note" style="margin-left:8px">PDFを企業ごとに残し、回収をチャットで知らせます</span></div><div data-ken-list data-ken-mode="list" class="kx-note">読み込んでいます…</div></div>`;
  const labelSec = `<div class="kx-sec kx-form"><div class="lb">商品ラベル${x.prodLabelsAuto ? '<span class="kx-src" style="margin-left:6px">自動（SFの商品から）</span>' : ""}</div>
      <label>DOC</label><div class="kx-usage">${KX_DOC_L.map((t) => chip(t, "DOC")).join("")}</div>
      <label>SNS</label><div class="kx-usage">${KX_SNS_L.map((t) => chip(t, "SNS")).join("")}</div>
      <div class="kx-edact">${!x.prodLabelsAuto ? '<button type="button" class="hp-b" data-pl-auto>自動に戻す</button>' : ""}<button type="button" class="kx-btn kx-pri" data-pl-save>ラベルを保存</button></div>
      ${sns ? `<label>SNSのフェーズ</label><div><select class="kx-in" data-sns-phase>${phases.map((p0) => `<option ${p0 === (x.snsPhase || "計上") ? "selected" : ""}>${esc(p0)}</option>`).join("")}</select></div>` : ""}
    </div>`;
  const schedSec = `${doc ? `<div class="kx-sec"><div class="lb" style="display:flex;align-items:center;gap:8px">掲載までのスケジュール（DOC）${sc ? `<span class="kx-note">${esc(new Date(sc.at).toLocaleDateString("ja-JP"))} に議事録から作成</span>` : ""}<span style="margin-left:auto;display:flex;gap:6px">${sc ? '<button type="button" class="hp-b" data-sch-doc>スケジュール資料を開く</button>' : ""}<button type="button" class="hp-b" data-sch-make>${sc ? "議事録から作り直す" : "議事録から作る"}</button></span></div>
      ${sc ? `<div class="kx-sch">${schRows}</div>` : '<div class="kx-note">まだありません。キックオフ・フォローの議事録から、掲載までの段取りと日付を作ります（予定より遅れると要注意に出ます）。</div>'}<span class="kx-note" data-sch-st></span></div>` : ""}`;
  if (part === "prod") return prodTbl;   // 企業情報のタブ（2026-11-10 田中さん：SFの商品は企業情報へ。検収書はステータスで扱う）
  if (part === "label") return labelSec;   // 先方の担当者の下（2026-11-10 田中さん）
  if (part === "sched") return schedSec;
  return prodTbl + kenSec + labelSec + schedSec;
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
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><span class="kx-lab l-${esc(x.label)}">${esc(x.label)}</span><button type="button" class="kx-rank r-${x.rank} kx-rank-btn" data-rank-open title="押すと更新確度を変えられます" aria-expanded="false">${x.rank} <small>▾</small></button><span class="kx-note">更新月 ${x.renew ? esc(x.renew.replace("-", "/")) : "—"}${x.left != null ? `（${x.left < 0 ? `${-x.left}日過ぎ` : `あと${x.left}日`}）` : ""}${x.renewLocked ? "・手で決めた" : ""}</span>
      <button type="button" class="kx-ren" data-renew-open>更新月を変える</button>
      <span class="kx-renew-ed" data-renew-box hidden><input type="month" class="kx-in" data-renew-in value="${esc(x.renew || "")}" style="width:150px;height:30px" /><button type="button" class="hp-b" data-renew-save>保存</button>${x.renewLocked ? '<button type="button" class="hp-b" data-renew-auto title="手で決めた更新月をやめて、契約終了日の前月に戻す">自動に戻す</button>' : ""}<button type="button" class="hp-b" data-renew-cancel>やめる</button></span></div>
    <div class="kx-rank-pop" data-rank-pop hidden></div>
    ${x.alerts.length ? `<div class="kx-sec" style="background:#FFF7EA;border-color:#F0D5B0;color:#6B3700;font-size:12.5px"><b>要注意：</b>${x.alerts.map((a) => `${esc(a.rule)}（${esc(a.detail)}）`).join("／")}</div>` : ""}
    <div class="kx-tabs"><button type="button" class="on" data-tab="task">タスク</button><button type="button" data-tab="info">活動記録</button><button type="button" data-tab="tl">議事録（${d.timeline.filter((t) => t.kind === "mtg").length}）</button><button type="button" data-tab="co">企業情報</button></div>
    <div data-pane="task" style="display:flex;flex-direction:column;gap:12px">
      <section class="kx-tm">
        <div class="kx-tm-add">${window.KX_COPY ? "" : `<span class="kx-tm-plus">＋</span><input data-ctask-t placeholder="タスクを追加（例：検収書の回収をお願いする）　Enterで追加"><label class="kx-tm-due add" title="期日（なくてもよい）">期日<input type="date" data-ctask-d></label><label class="kx-tm-who add" title="だれのタスクにするか（CS担当以外にも託せます）"><span data-ctask-wl>自分</span><select data-ctask-who></select></label><button type="button" class="kx-btn kx-pri" data-ctask-add>追加</button>`}</div>
        <div data-ctask class="kx-note" style="padding:10px 4px">読み込んでいます…</div>
      </section>
      <details class="kx-more" data-na-more><summary>次回アクションの中身（目的・当日に確認すること・前回の宿題）</summary>${kxNextActSection(x)}</details>
    </div>
    <div data-pane="co" hidden style="display:flex;flex-direction:column;gap:12px">${kxCoPane(d)}${kxLabelSchedPane(d, "prod")}</div>
    <div data-pane="info" hidden style="display:flex;flex-direction:column;gap:12px">
      ${kxNowCard(d)}
      ${kxGuideSec(d)}
      <details class="kx-more"><summary>CS担当・フェーズ・利用目的・活用を見る・直す</summary>${kxStatusPane(d)}</details>
      ${kxLabelSchedPane(d, "sched")}
      <details class="kx-more"><summary>請求・納品（フェーズの判定に使う項目）</summary>${kxOpsSection(x)}</details>
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
            <div class="t">${esc(t.title)}${t.botId ? ' <span class="kx-open">議事録を開く ›</span>' : ""}${t.url ? ` <a class="kx-mtlink" href="${esc(t.url)}" target="_blank" rel="noopener" data-noopen title="kinbotの議事録のページを別のタブで開く">kinbotで開く ↗</a>` : ""}</div>
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
    // 更新確度は、上の確度の文字を押すと出る小窓へ。検収書・納品メール・掲載の切りかえは見せない（ステータスの道のりで1つずつ済みにする）（2026-11-10 田中さん）
    const pop = bg.querySelector("[data-rank-pop]"); if (rk && pop) { pop.appendChild(rk); }
    if (dl) dl.style.display = "none";
  })();
  if (!bg.isConnected) document.body.appendChild(bg);
  kxCircusMount(bg, x); kxKenshuMount(bg, x); kxNowMount(bg); kxSalesMount(bg, x); kxCTaskMount(bg, x); kxGuideMount(bg, x, d);
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
  const put = async (body, redraw = true) => { try { const r0 = await api(`/api/kinxs/accounts/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }); refresh().catch(() => {});
      // 情報不足（ホームの枠・情報不足のページ）も読み直す（2026-11-10 久野さん）
      if (typeof kh2 !== "undefined" && kh2 && VIEW === "home") api("/api/kinxs/missing").then((d) => { kh2.miss = d; renderHomeV2(); }).catch(() => {});
      if (VIEW === "missing" && typeof loadMissing === "function") loadMissing(false); if (redraw) await again(r0 && r0.logoRefetched ? "保存して、新しいHPからロゴを取り直しました" : undefined); } catch (e) { alert(e.message); } };
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
    el.addEventListener("click", (e) => { if (e.target.closest("a")) return; openMeeting(el.dataset.mt); });   // 「kinbotで開く ↗」はリンクのまま
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
    // 直した欄に加えて、SF にも手入力にも無い値（メールのドメイン・CS連携などから出していた値）も、そのまま保存して SF に書く（2026-11-12 田中さん）
    const info = {}; bg.querySelectorAll("[data-info]").forEach((el) => { const sk = String(el.dataset.src || ""); if (el.value !== el.defaultValue || (el.value.trim() && sk && !/^(SF|手入力)/.test(sk))) info[el.dataset.info] = el.value; });
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
  try { bdData = await api(kxUsersUrl()); renderBoard(); }
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
api("/api/me").then((me) => { window.__kxMe = (me && me.name) || ""; if (VIEW === "renew" && data) render(); if (VIEW === "home" && typeof lsData !== "undefined" && lsData) try { renderHomeV2(); } catch {} }).catch(() => {});

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
  try { if (!lsData) lsData = await api(kxUsersUrl()); kxSur = kxSurnameMap((lsData.items || []).map((x) => x.cs).filter(Boolean)); } catch (e) { box.innerHTML = `<div class="kx-empty">読み込めませんでした：${esc(e.message)}</div>`; return; }
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
// ホームの要アクションを、その場で済み・日付変更（2026-11-10 田中さん：要アクションを更新する手立てがない）
async function kxHomeAct(el) {
  const k = el.dataset.ha, id = el.dataset.id, today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const isDate = el.dataset.do === "date"; const v = isDate ? el.value : "";
  if (isDate && !v) return;
  try {
    if (k === "ko") await api(`/api/kinxs/accounts/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ kickoff_on: today }) });
    else if (k === "ks") await api(`/api/kinxs/accounts/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ kenshu_on: today }) });
    else if (k === "na") {
      if (isDate) { const tm = el.dataset.at ? new Date(new Date(el.dataset.at).getTime() + 9 * 3600000).toISOString().slice(11, 16) : "10:00"; await api(`/api/kinxs/accounts/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ na_at: `${v}T${tm}` }) }); }
      else { if (!confirm("この次回アクションを済みにしますか？（次回アクションが空になります）")) return; await api(`/api/kinxs/accounts/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ na_text: "", na_at: "" }) }); }
    } else if (k === "me") await api("/api/kinxs/actions", { method: "PUT", body: JSON.stringify({ mkey: el.dataset.mkey, ym: el.dataset.ym, account_id: id, ...(isDate ? { na_date: v } : { status: "完了" }) }) });
    // 済みにしたら、その行をすぐ消す（読み直しを待たない）（2026-11-10 田中さん）。日付を変えたときは読み直しで並びが変わる
    if (!isDate) { const row = el.closest(".h2-li"); if (row) { row.style.transition = "opacity .25s, height .25s"; row.style.opacity = "0"; setTimeout(() => row.remove(), 260); } }
    // 数字（何社・何件）は、読み直して合わせる。そのあいだ、消した行が戻ってこないように覚えておく
    if (!isDate) { const hd = (window.__kxHomeDone = window.__kxHomeDone || {}); (hd[id] = hd[id] || new Set()).add(`${k}|${el.dataset.mkey || ""}`); }
    api(kxUsersUrl()).then((d) => { lsData = d; renderHomeV2(); }).catch(() => {});
  } catch (e) { alert(e.message); }
}
// 託した次回アクションの担当の名前に使う（ホーム）
if (!window.__kxPeople) { window.__kxPeople = []; api("/api/kinxs/people").then((d) => { window.__kxPeople = d.items || []; if (VIEW === "home" && typeof lsData !== "undefined" && lsData) try { renderHomeV2(); } catch {} }).catch(() => {}); }
// ホームの要アクションの「タスク」（2026-11-12）：カードの数を入れ、タスクのカードを選んだら、会社の詳細のタスクと同じまとまりで出す
async function kh2LoadTasks(who0) {
  const my = ++kh2LoadTasks.seq; const who = who0 || "";
  let d; try { d = await api(`/api/kinxs/home/tasks${who ? `?who=${encodeURIComponent(who)}` : ""}`); }
  catch (e) { const b0 = $("kh2Tasks"); if (b0) b0.innerHTML = `<div class="kx-note" style="padding:10px 4px">読めませんでした：${esc(e.message)}</div>`; return; }
  if (my !== kh2LoadTasks.seq) return;
  // kinXs のお知らせ（期日が過ぎています・接触途絶など）は要アクション・会社のカードと重なるので、タスクには出さない（次回アクションそのものは出す）
  const items = (d.items || []).filter((t0) => t0.kind === "次回アクション" || !/^kinXs$/.test(String(t0.src || "")));
  kh2.tkN = items.length; const nb = document.querySelector("[data-tk-n]"); if (nb) nb.textContent = items.length;
  const box = $("kh2Tasks"); if (!box) return;
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const wk = new Date(Date.now() + 9 * 3600000 + 7 * 86400000).toISOString().slice(0, 10);
  const lbl = (s0) => { const v = String(s0 || ""); const au = /自動/.test(v) ? "（自動）" : ""; if (/メールワイズ/.test(v)) return "メールワイズ" + au; if (/Gmail|メール/.test(v)) return "Gmail" + au; if (/議事録/.test(v)) return "議事録" + au; if (/チャット/.test(v)) return "チャット"; if (/Claude/.test(v)) return "Claude"; return "手入力"; };
  const groups = [["期限切れ", (t0) => t0.due && t0.due < today, "over"], ["今日", (t0) => t0.due === today, "today"], ["1週間", (t0) => t0.due && t0.due > today && t0.due <= wk, ""], ["あとで", (t0) => t0.due && t0.due > wk, ""], ["日付なし", (t0) => !t0.due, "none"]];
  // 行の形は、キックオフ未実施などの要アクションの行と同じ（左に期日の札、会社、内容、担当、右に「✓ 済み」）（2026-11-12 田中さん）
  const coOf = new Map(((typeof lsData !== "undefined" && lsData && lsData.items) || []).map((x) => [x.id, x]));
  const row = (t0, i0) => { const n = t0.due ? Math.round((new Date(t0.due) - new Date(today)) / 86400000) : null;
    const em = n == null ? "" : n < 0 ? `<em class="over">${-n}日過ぎ</em>` : n === 0 ? '<em class="soon">今日</em>' : `<em class="${n <= 3 ? "soon" : ""}">あと${n}日</em>`;
    const dcls = `h2-due ${n != null && n < 0 ? "over" : n != null && n <= 3 ? "soon" : ""}`;
    const dl = t0.due ? `${Number(t0.due.slice(5, 7))}/${Number(t0.due.slice(8, 10))}` : "期日なし";
    const x = coOf.get(t0.accountId);
    const who = (() => { const pp = window.__kxPeople || []; const cur = String(t0.owner || "").toLowerCase(); const nm = t0.ownerName || (d.all ? "" : "自分");
      const canMove = (t0.kind === "次回アクション" && t0.accountId) || (t0.id && !String(t0.key || "").startsWith("auto:")) || (t0.id && /（自動）|Claude/.test(String(t0.src || "")));
      if (!canMove || !pp.length) return `<span class="who">${esc(nm)}</span>`;
      return `<label class="who h2-who" data-noopen title="押してほかの人に託す">${esc(nm || "担当")}<select data-tk-who="${i0}"><option value="">託す人を選ぶ</option>${pp.map((p0) => `<option value="${esc(p0.email)}" ${p0.email === cur ? "selected" : ""}>${esc(p0.name)}</option>`).join("")}</select></label>`; })();
    return `<div class="h2-li h2-tkrow" data-tk="${i0}" ${t0.accountId ? `data-tk-open="${esc(t0.accountId)}"` : ""} role="button" tabindex="0"><span class="${dcls}">${dl}${em}</span><span class="co">${x ? kxLogoMini(x) : ""}<b>${esc(t0.account || "（会社なし）")}</b></span><span class="what">${esc(t0.title)}<small class="h2-src">${esc(t0.kind === "次回アクション" ? "次回アクション" : lbl(t0.src))}</small></span>${who}<span class="h2-ops" data-noopen>${d.mine ? '<button type="button" class="h2-op done" data-tk-done title="済みにする">✓ 済み</button>' : ""}</span></div>`; };
  box.innerHTML = `<div class="kx-note" style="padding:2px 4px 6px">${d.all ? "全員" : d.mine ? "自分" : esc(who)}のタスク（期限の近い順）</div><div class="h2-list">` + (items.length ? items.map((t0, i0) => row(t0, i0)).join("") : '<div class="kx-empty">タスクはありません 🎉</div>') + "</div>";
  box.querySelectorAll("[data-tk-open]").forEach((el) => el.addEventListener("click", (e) => { if (e.target.closest("[data-noopen], button, select, label")) return; openDetail(el.dataset.tkOpen); }));
  box.querySelectorAll("[data-tk-co]").forEach((b) => b.addEventListener("click", () => { if (b.dataset.tkCo) openDetail(b.dataset.tkCo); }));
  box.querySelectorAll("[data-tk-who]").forEach((sel) => sel.addEventListener("change", async () => {
    const t0 = items[Number(sel.dataset.tkWho)]; const em = sel.value; if (!em) return;
    const p0 = (window.__kxPeople || []).find((q) => q.email === em);
    if (!confirm(`「${t0.title}」を${p0 ? p0.name : em}さんに託しますか？`)) { sel.value = ""; return; }
    // 託したら、その場ですぐ自分の一覧から消す（全員のときは担当の名前だけ変える）。うまくいかなければ戻す（2026-11-13 田中さん）
    const li = sel.closest("[data-tk]"); const lab = sel.closest("label"); const prevName = lab ? lab.firstChild && lab.firstChild.nodeValue : "";
    if (d.all) { if (lab && lab.firstChild) lab.firstChild.nodeValue = p0 ? kxSurname(p0.name) || p0.name : em; }
    else if (li) { li.classList.add("gone"); kh2.tkN = Math.max(0, (kh2.tkN || 1) - 1); const nb = document.querySelector("[data-tk-n]"); if (nb) nb.textContent = kh2.tkN; setTimeout(() => { li.style.display = "none"; }, 260); }
    if (typeof kxDoneToast === "function") kxDoneToast(`${p0 ? p0.name : em}さんに託しました`);
    try {
      if (t0.kind === "次回アクション" && t0.accountId) await api(`/api/kinxs/accounts/${encodeURIComponent(t0.accountId)}`, { method: "PUT", body: JSON.stringify({ na_owner: em }) });
      else await api(`/api/kinxs/tasks/${t0.id}`, { method: "PUT", body: JSON.stringify({ assignee: em }) });
    } catch (e) {
      alert("託せませんでした：" + e.message); sel.value = "";
      if (d.all) { if (lab && lab.firstChild) lab.firstChild.nodeValue = prevName; } else if (li) { li.classList.remove("gone"); li.style.display = ""; kh2.tkN += 1; const nb = document.querySelector("[data-tk-n]"); if (nb) nb.textContent = kh2.tkN; }
    }
  }));
  // 済み：押したらすぐ行を消して数を減らす（返事を待たない＝押した手ごたえ）。失敗したら戻す（2026-11-12 田中さん「押す判定が弱い」）
  box.querySelectorAll("[data-tk-done]").forEach((b) => b.addEventListener("click", async (e) => {
    e.stopPropagation(); const li = b.closest("[data-tk]"); if (!li || li.classList.contains("gone")) return;
    const t0 = items[Number(li.dataset.tk)]; b.classList.add("on"); li.classList.add("gone");
    kh2.tkN = Math.max(0, (kh2.tkN || 1) - 1); const nb = document.querySelector("[data-tk-n]"); if (nb) nb.textContent = kh2.tkN;
    setTimeout(() => { li.style.display = "none"; }, 260);
    try {
      if (t0.kind === "次回アクション" && t0.accountId) await api(`/api/kinxs/accounts/${encodeURIComponent(t0.accountId)}`, { method: "PUT", body: JSON.stringify({ na_text: "" }) });
      else if (t0.id && !String(t0.key).startsWith("auto:")) await api(`/api/kinxs/tasks/${t0.id}`, { method: "PUT", body: JSON.stringify({ status: "完了" }) });
      else await api("/api/kinxs/tasks/state", { method: "POST", body: JSON.stringify({ key: t0.key, title: t0.title, accountId: t0.accountId, account: t0.account, src: t0.src, status: "完了" }) });
      if (typeof kxDoneToast === "function") kxDoneToast("済みにしました");
    } catch (err) { li.classList.remove("gone"); li.style.display = ""; b.classList.remove("on"); kh2.tkN += 1; if (nb) nb.textContent = kh2.tkN; alert(err.message); }
  }));
}
kh2LoadTasks.seq = 0;
// タスクの一覧の高さを、画面の下までに合わせる（画面の幅が狭いときや、枠の高さが決まっていないときもスクロールできるように）（2026-11-12）
function kh2FitTasks() {
  const el = document.getElementById("kh2Tasks"); if (!el || el.closest(".h2-act.big")) { if (el) el.style.maxHeight = ""; return; }
  const top = el.getBoundingClientRect().top;
  el.style.maxHeight = `${Math.max(240, window.innerHeight - top - 28)}px`; el.style.overflowY = "auto"; el.style.overscrollBehavior = "contain";
}
window.addEventListener("resize", () => kh2FitTasks());
function renderHomeV2() {
  const box = $("kh2"); if (!box || !lsData) return;
  const items = (lsData.items || []).filter((x) => !x.archived);
  const allIt = lsData.items || [];   // 数字はアーカイブした会社も入れて数える
  // ホームはいつも今月（月の切りかえは出さない）（2026-11-13 田中さん「ホームには月選択いらない」）
  kh2.ym = kxNowYm(); const ym = kh2.ym; const c = kxDocCounts(allIt, ym), p = kxDocCounts(allIt, kxYmAdd(ym, -1));
  { const hm0 = $("kxHeadMonth"); if (hm0) { hm0.hidden = true; hm0.innerHTML = ""; } }
  const dl = (a, b) => { const d = a - b; return `<span class="h2-d ${d > 0 ? "up" : d < 0 ? "dn" : ""}">${d > 0 ? "▲" : d < 0 ? "▼" : "±"}${Math.abs(d)}<small>前月比</small></span>`; };
  const tot = Math.max(1, c.all.length);
  // 要アクション
  const kxDoneKey = (a) => `${a.kind === "キックオフ未実施" ? "ko" : a.kind === "検収書 未回収" ? "ks" : a.measure ? "me" : a.na ? "na" : ""}|${a.measure || ""}`;
  // 担当（CS）で絞る（2026-11-11 田中さん）。このブラウザに覚える
  // 2026-11-12 田中さん：ホームは基本そのアカウント個人のデータ。右上の「全員」で全員分
  const kxScope = (() => { try { return localStorage.getItem("kxHomeScope") || "me"; } catch { return "me"; } })();
  const kxCsF = kxScope === "all" ? "" : (kxSurname(window.__kxMe || "") || "");
  // 行ごとの担当：次回アクションをほかの人に託していれば、その人（2026-11-12 田中さん：久野で絞っても託した分が出なかった）
  const kxActWho = (x, a) => { if (a.na && x.naOwner) { const p0 = (window.__kxPeople || []).find((q) => q.email === x.naOwner); const nm = p0 ? (kxSurname(p0.name) || p0.name) : String(x.naOwner).split("@")[0]; if (nm) return nm; } return kxSurname(x.cs) || "（未定）"; };
  // 要アクションは緊急度の高いものだけ：キックオフ未実施と、検収書が今月回収で未回収の企業（2026-11-12 久野さんの要望）
  const kxThisYm = kxNowYm();
  const kxUrgent = (a) => a.kind === "キックオフ未実施" || (a.kind === "検収書 未回収" && String(a.due || "").slice(0, 7) === kxThisYm);
  const actAll = items.filter((x) => kxHasDoc(x)).flatMap((x) => (x.actions || []).filter(kxUrgent).filter((a) => { const hd = window.__kxHomeDone || {}; return !(hd[x.id] && hd[x.id].has(kxDoneKey(a))); }).map((a) => ({ x, a, who: kxActWho(x, a) })));
  const csNames = [...new Set(actAll.map((r) => r.who))].sort((a, b) => a.localeCompare(b, "ja"));
  const actRows = actAll.filter((r) => !kxCsF || r.who === kxCsF).sort((u, v) => (u.a.left ?? 0) - (v.a.left ?? 0));
  const actCos = new Set(actRows.map((r) => r.x.id)).size;
  const kinds = [["ko", "キックオフ未実施", (a) => a.kind === "キックオフ未実施", "#E0A100"], ["ks", "検収書 今月回収・未回収", (a) => a.kind === "検収書 未回収", "#C43D3D"], ["tk", "タスク", () => false, "#3F72C9"]];
  const kf = kh2.kf || ""; const shown = kf === "tk" ? [] : actRows.filter((r) => !kf || kinds.find((k) => k[0] === kf)[2](r.a));
  // 「自分」のときは、自分がCS担当の会社だけ（これからの更新・情報不足も）（2026-11-12 田中さん）
  const kxMineCo = (x) => !kxCsF || !x || (kxSurname(x.cs) || "") === kxCsF;
  // 3か月の更新
  const docs = items.filter((x) => kxHasDoc(x) && kxMineCo(x));
  const R = ["S", "A", "B", "C", "Z"];
  const renewMonths = [0, 1, 2].map((n) => { const m = kxYmAdd(kxNowYm(), n); const l = docs.filter((x) => kxRenewIn(x, m) && x.label !== "解約済み" && x.rank !== "F"); return { m, l, by: R.map((r) => [r, l.filter((x) => x.rank === r).length]) }; });
  // 情報不足
  const ms = kh2.miss; const coById = new Map(allIt.map((x) => [x.id, x])); const msItems = ms ? (ms.items || []).filter((m0) => kxMineCo(coById.get(m0.id) || m0)) : []; const req = ms ? ms.required || [] : [];
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
    ${window.__kxActBig ? '<div class="h2-act-bd" data-act-close></div>' : ""}<section class="h2-box h2-act${window.__kxActBig ? " big" : ""}"><div class="h2-h"><h2 class="h2-act-open" data-act-big title="押すと大きく表示">要アクション</h2><span class="h2-big h2-act-open" data-act-big data-cu="${actCos}">${actCos}<small>社</small></span><span class="h2-sub">事前アラート</span><span class="h2-scope" role="tablist"><button type="button" class="${kxScope !== "all" ? "on" : ""}" data-home-scope="me">自分</button><button type="button" class="${kxScope === "all" ? "on" : ""}" data-home-scope="all">全員</button></span>${window.__kxActBig ? '<button type="button" class="h2-act-x" data-act-close title="閉じる">✕ 閉じる</button>' : ""}</div>
      <div class="h2-tiles">${kinds.map(([k, l, f, col]) => `<button type="button" class="${kf === k ? "on" : ""}" data-kf="${k}" style="--c:${col}"><b ${k === "tk" ? 'data-tk-n' : ""}>${k === "tk" ? (kh2.tkN != null ? kh2.tkN : "…") : actRows.filter((r) => f(r.a)).length}</b><span>${l}</span></button>`).join("")}</div>
      ${kf === "tk" ? '<div class="h2-tk" id="kh2Tasks"><div class="kx-note" style="padding:10px 4px">読み込み中…</div></div>' : ""}<div class="h2-list"${kf === "tk" ? " hidden" : ""}>${shown.map(({ x, a }) => `<div class="h2-li" data-open="${esc(x.id)}" role="button" tabindex="0">${(() => {
        // 期日の札（タスクのタブと同じ形）：日付・時刻＋「n日過ぎ／あとn日」。次回アクション・施策は押すと日付を変えられる（2026-11-11 田中さん）
        const k0 = a.kind === "キックオフ未実施" ? "ko" : a.kind === "検収書 未回収" ? "ks" : a.measure ? "me" : a.na ? "na" : "";
        const due = a.due || ""; const tm = a.na && x.naAt ? new Date(new Date(x.naAt).getTime() + 9 * 3600000).toISOString().slice(11, 16) : "";
        const lbl = due ? `${Number(due.slice(5, 7))}/${Number(due.slice(8, 10))}${tm ? ` ${tm}` : ""}` : "期日なし";
        const em = a.left == null ? "" : a.left < 0 ? `<em class="over">${-a.left}日過ぎ</em>` : a.left === 0 ? '<em class="soon">今日</em>' : `<em class="${a.left <= 3 ? "soon" : ""}">あと${a.left}日</em>`;
        const cls = `h2-due ${a.left != null && a.left < 0 ? "over" : a.left != null && a.left <= 3 ? "soon" : ""}`;
        if (k0 === "na" || k0 === "me") return `<label class="${cls} edit" data-noopen title="押すと日付を変えられます">${lbl}${em}<input type="date" data-ha="${k0}" data-id="${esc(x.id)}" data-mkey="${esc(a.measure || "")}" data-ym="${esc(a.ym || "")}" data-at="${esc(x.naAt || "")}" data-do="date" value="${esc(due)}"></label>`;
        return `<span class="${cls}" title="${k0 === "ko" ? "受注から14日（キックオフの目安）" : "期日"}">${lbl}${em}</span>`; })()}<span class="co">${kxLogoMini(x)}<b>${esc(x.name)}</b></span><span class="what">${esc(a.detail.replace(/（[^）]*日[^）]*）$/, ""))}${a.kind === "キックオフ未実施" && x.fs ? `<small class="h2-fs" title="受注した人（${esc(x.channel || "直販")}）">${esc(x.channel === "PS" ? "PS" : "直販")}：${esc(kxSurname(x.fs) || x.fs)}</small>` : ""}</span>${(() => { const ppl = window.__kxPeople || []; const csEm = (ppl.find((p0) => kxSurname(p0.name) === kxSurname(x.cs || "")) || {}).email || "";
        const nm = a.na && x.naOwner ? (kxSurname((ppl.find((p0) => p0.email === x.naOwner) || {}).name || "") || x.naOwner.split("@")[0]) : (kxSurname(x.cs) || "CS未定");
        if (!a.na || !ppl.length || window.KX_COPY) return `<span class="who">${esc(nm)}</span>`;
        // 次回アクションの行は、担当を押すと別の人に移せる（2026-11-11 田中さん）
        const cur = x.naOwner || csEm;
        return `<label class="who h2-who" data-noopen title="押すと担当を移せます">${esc(nm)}${x.naOwner && x.naOwner !== csEm ? "<em>託</em>" : ""}<select data-home-naown="${esc(x.id)}" data-cs="${esc(csEm)}">${ppl.map((p0) => `<option value="${esc(p0.email)}" ${p0.email === cur ? "selected" : ""}>${esc(p0.name)}${p0.email === csEm ? "（CS担当）" : ""}</option>`).join("")}</select></label>`; })()}<span class="h2-ops" data-noopen>${(() => { const k = a.kind === "キックオフ未実施" ? "ko" : a.kind === "検収書 未回収" ? "ks" : a.measure ? "me" : a.na ? "na" : ""; if (!k) return "";
        const dat = `data-ha="${k}" data-id="${esc(x.id)}" data-mkey="${esc(a.measure || "")}" data-ym="${esc(a.ym || "")}" data-at="${esc(x.naAt || "")}"`;
        // ボタンの言葉は「✓ 済み」にそろえる（2026-11-11 田中さん：実施済み／済みが分かりにくい）。何が起きるかは、指を置くと出る説明に
        return `<button type="button" class="h2-op done" ${dat} data-do="done" title="${k === "ko" ? "キックオフMTGをやったことにします（実施日＝今日）" : k === "ks" ? "検収書を回収したことにします（回収日＝今日）" : "この次回アクションを終えたことにします"}">✓ 済み</button>`; })()}</span></div>`).join("") || '<div class="kx-empty">ありません 🎉</div>'}</div>
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
  box.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", (e) => { if (e.target.closest("[data-noopen]")) return; openDetail(el.dataset.open); }));
  box.querySelectorAll("[data-home-scope]").forEach((b) => b.addEventListener("click", () => { try { localStorage.setItem("kxHomeScope", b.dataset.homeScope); } catch {} renderHomeV2(); }));
  // 要アクションを大きく表示（モーダル）（2026-11-11 田中さん）
  box.querySelectorAll("[data-act-big]").forEach((el) => el.addEventListener("click", () => { window.__kxActBig = true; renderHomeV2(); }));
  // 要アクションの枠の余白を押しても大きく（行・ボタン・選択・枠の切りかえは除く）（2026-11-11 田中さん）
  { const act = box.querySelector(".h2-act"); if (act && !window.__kxActBig) act.addEventListener("click", (e) => { if (e.target.closest(".h2-li, .h2-tk, .h2-scope, button, select, label, input, a, .h2-tiles")) return; window.__kxActBig = true; renderHomeV2(); }); }
  box.querySelectorAll("[data-act-close]").forEach((el) => el.addEventListener("click", () => { window.__kxActBig = false; renderHomeV2(); }));
  if (window.__kxActBig && !window.__kxActEsc) { window.__kxActEsc = true; document.addEventListener("keydown", (e) => { if (e.key === "Escape" && window.__kxActBig) { window.__kxActBig = false; renderHomeV2(); } }); }
  box.querySelectorAll("[data-home-naown]").forEach((sel) => { sel.addEventListener("click", (e) => e.stopPropagation()); sel.addEventListener("change", async () => {
    try { await api(`/api/kinxs/accounts/${encodeURIComponent(sel.dataset.homeNaown)}`, { method: "PUT", body: JSON.stringify({ na_owner: sel.value === sel.dataset.cs ? "" : sel.value }) });
      const it = (lsData.items || []).find((y) => y.id === sel.dataset.homeNaown); if (it) it.naOwner = sel.value === sel.dataset.cs ? "" : sel.value; renderHomeV2(); } catch (e) { alert(e.message); } }); });
  box.querySelectorAll("button[data-ha]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); b.disabled = true; kxHomeAct(b).finally(() => { b.disabled = false; }); }));
  box.querySelectorAll("input[data-ha]").forEach((i) => { i.addEventListener("click", (e) => { e.stopPropagation(); try { i.showPicker(); } catch {} }); i.addEventListener("change", () => kxHomeAct(i)); });
  box.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { const m = b.dataset.rm; kxCoListPopup(`${kxYmLabel(m)} 更新`, docs.filter((x) => kxRenewIn(x, m) && x.label !== "解約済み" && x.rank !== "F")); }));
  const rtm = box.querySelector("[data-rt-modal]"); if (rtm) rtm.addEventListener("click", () => kxRenewTableModal(docs));
  box.querySelectorAll("[data-miss]").forEach((b) => b.addEventListener("click", () => { const r = req.find((x) => x.key === b.dataset.miss); kxCoListPopup(`情報不足：${r.short || r.name}がない`, msItems.filter((x) => (x.missKeys || []).includes(r.key)).map((x) => ({ ...x, ...(items.find((y) => y.id === x.id) || {}) }))); }));
  setTimeout(() => kh2LoadTasks(kxScope === "all" ? "all" : "").catch((e) => { const b0 = $("kh2Tasks"); if (b0) b0.innerHTML = `<div class="h2-tk-h"><b>タスク</b><span class="kx-note">読めませんでした：${esc(e.message)}</span></div>`; }), 0);
}

// ---------- 更新管理：今月・来月・再来月の会社カード、期の区切り、解約企業、更新表の窓 ----------
function kxRenewV2(itemsR) {
  const host = $("kxTable"); if (!host) return false;
  const ranks = window.__rnRanks || new Set();
  const all = (lsData && lsData.items) ? lsData.items.filter((x) => !x.archived) : null;
  if (!all) { api(kxUsersUrl()).then((d) => { lsData = d; render(); }).catch(() => {}); host.innerHTML = '<div class="kx-empty">読み込み中…</div>'; return true; }
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
  const alertTxt = x.naDue ? (() => { const l = Math.round((Date.parse(String(x.naDue).slice(0, 10) + "T00:00:00Z") - Date.parse(new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10) + "T00:00:00Z")) / 86400000); return l < 0 ? `<span class="v2-miss">${-l}日過ぎ</span>` : l <= 7 ? `<span class="v2-miss">あと${l}日（アラート）</span>` : `<span class="kx-note">あと${l}日（期限の1週間前にアラート）</span>`; })() : "";
  return `<section class="kx-sec v2-na" data-na-box="${esc(x.id)}"><div class="lb" style="display:flex;align-items:center;gap:8px">次回アクション<span class="kx-src">${nd.manual ? "手で直した" : nd.auto ? "自動（議事録から）" : "—"}</span>${alertTxt}<button type="button" class="hp-b" data-na-done style="margin-left:auto" title="この次回アクションを終えて、空にします">✓ 済みにする</button><button type="button" class="kx-btn kx-pri" data-na-save>保存</button></div>
    <div class="v2-na-g">
      <label>種別・タイトル<input class="kx-in" data-nad="title" value="${esc(nd.title || x.na || n.title || "")}" placeholder="例：運用開始前の最終確認ミーティング" /></label>
      <label>日時<input class="kx-in" type="datetime-local" data-na-at value="${esc(x.naAt ? new Date(new Date(x.naAt).getTime() + 9 * 3600000).toISOString().slice(0, 16) : (x.naDue ? `${x.naDue}T10:00` : ""))}" /></label>
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
  const nd0 = e.target.closest && e.target.closest("[data-na-done]");
  if (nd0) {
    const box = nd0.closest("[data-na-box]"); if (!confirm("この次回アクションを済みにしますか？（次回アクションが空になり、要アクションから外れます）")) return;
    nd0.disabled = true;
    try { await api(`/api/kinxs/accounts/${encodeURIComponent(box.dataset.naBox)}`, { method: "PUT", body: JSON.stringify({ na_text: "", na_at: "" }) }); lsData = null;
      const bgEl = box.closest(".kx-drawer-bg"); if (bgEl) openDetail(box.dataset.naBox, { bg: bgEl }); }
    catch (er) { alert(er.message); nd0.disabled = false; }
    return;
  }
  const sv = e.target.closest && e.target.closest("[data-na-save]");
  if (sv) {
    const box = sv.closest("[data-na-box]"); const st = box.querySelector("[data-na-st]");
    const body = { title: box.querySelector('[data-nad="title"]').value, place: box.querySelector('[data-nad="place"]').value, participants: box.querySelector('[data-nad="participants"]').value, purpose: box.querySelector('[data-nad="purpose"]').value,
      agenda: [...box.querySelectorAll("[data-na-agenda] .v2-ag")].map((l) => ({ done: l.querySelector("input[type=checkbox]").checked, t: l.querySelector("input.kx-in").value.trim() })).filter((a) => a.t),
      homework: [...box.querySelectorAll("[data-na-hw] .v2-hw-ed")].map((r) => ({ who: r.querySelector('[data-k="who"]').value, task: r.querySelector('[data-k="task"]').value.trim(), due: r.querySelector('[data-k="due"]').value, state: r.querySelector('[data-k="state"]').value })).filter((h) => h.task) };
    if (st) st.textContent = "　保存しています…"; sv.disabled = true;
    try { await api(`/api/kinxs/accounts/${encodeURIComponent(box.dataset.naBox)}/na-detail`, { method: "PUT", body: JSON.stringify(body) });
      // 日時・タイトルは次回アクションそのもの（要アクション・アラートの期限）にも入れる（2026-11-10 田中さん：手で直せるように）
      const atEl = box.querySelector("[data-na-at]"); const at = atEl ? atEl.value : "";
      await api(`/api/kinxs/accounts/${encodeURIComponent(box.dataset.naBox)}`, { method: "PUT", body: JSON.stringify({ na_text: body.title, na_at: at }) });
      if (st) st.textContent = "　保存しました"; lsData = null;
      const bgEl = box.closest(".kx-drawer-bg"); if (bgEl) openDetail(box.dataset.naBox, { bg: bgEl }); }
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
// 施策ごとのステータス（お手紙だけ「未対応・送付待ち・送付済み・架電済み（不在）・対応完了」）（2026-11-12 久野さんの要望）
function kxMeSt(me) { return (me.statuses || ["未対応", "架電済み（不在）", "対応中", "完了", "対象外"]).filter((s) => s !== "対象外"); }
function kxMeStCls(me, s) { if (s === "未対応") return 0; if (s === "完了" || s === "対応完了") return 3; if (s === "架電済み（不在）") return 1; return 2; }
async function kpSave(mkey, ym, body) {
  const r = await api("/api/kinxs/actions", { method: "PUT", body: JSON.stringify({ mkey, ym, ...body }) });
  if (body.status === "完了" || body.status === "対応完了") kxDoneToast(`${body.status}にしました`); else if (body.status === "送付済み") kxDoneToast("送付済みにしました");
  return r;
}
// 施策の対象会社を窓で出して、その場で状態・結果・メモ・NA日を直す
function kpActPopup(me, ym, onlyStatus, after) {
  document.querySelectorAll(".v2-pop-bg").forEach((x) => x.remove());
  const bg = document.createElement("div"); bg.className = "v2-pop-bg";
  const ST = me.statuses || (kp.data && kp.data.statuses) || ["未対応", "架電済み（不在）", "対応中", "完了", "対象外"];
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
    <div class="sts">${kxMeSt(me).filter((s) => me.call || me.key === "letter" || s !== "架電済み（不在）").map((s) => `<button type="button" data-mk-st="${esc(me.key)}|${esc(s)}" class="st-${kxMeStCls(me, s)}">${esc(s)} <b>${me.counts[s] || 0}</b></button>`).join("")}</div></div>`;
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
      <div class="p3-ms">${kxMeSt(me).filter((s) => (me.counts[s] || 0) > 0).map((s) => `<button type="button" class="s s${kxMeStCls(me, s)}" data-mk-st="${esc(me.key)}|${esc(s)}">${esc(s)} ${me.counts[s]}</button>`).join("") || '<span class="none">対象なし</span>'}</div></div>`; };
  const col = (list, label, cls, s0, extra) => { const act = list.filter((x) => x.rows.length), emp = list.filter((x) => !x.rows.length);
    return `<section class="p3-col ${cls}"><div class="p3-ch"><span class="dot"></span><b>${label}</b><span class="sm">完了 <b>${s0.d}</b> / ${s0.t}社</span><span class="ring" style="--p:${pct(s0.d, s0.t)}"><i>${pct(s0.d, s0.t)}%</i></span></div>${extra || ""}
      <div class="p3-list">${act.map(row).join("") || '<div class="kx-empty">今月、対象のある施策はありません</div>'}${emp.length ? `<details class="p3-emp"><summary>対象のない施策（${emp.length}）</summary>${emp.map(row).join("")}</details>` : ""}</div></section>`; };
  const band = `<a class="p3-live" href="/kinxs?p=call"><span class="lv">実施中</span><span class="nm">電話フォロー（今月）</span><b>${cDone}</b><small>/ ${cTot}社</small><span class="go">進捗表 ›</span></a>`;
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
  const tabs = "";   // 切りかえ・月の送り・期の選択・CSV はヘッダーに出す（2026-11-13 田中さん「スペースを取りすぎ」）
  let body = "";
  if (kc.tab === "month") {
    const past = d.months.filter((m) => !m.future); const tot = past.reduce((a, m) => a + m.total, 0), dn = past.reduce((a, m) => a + m.done, 0);
    const cur = d.months.find((m) => m.ym === d.nowYm) || { counts: {}, done: 0, total: 0 };
    const worry = d.months.reduce((a, m) => a + (m.results["懸念あり"] || 0), 0);
    body = `
      <div class="v2-kpis">${[["累計の完了", `${dn} / ${tot}社`, tot ? `${Math.round((dn / tot) * 100)}%` : "—", true], ["今月の未対応", `${cur.counts["未対応"] || 0}社`, ""], ["今月の完了", `${cur.done}社`, ""], ["懸念ありの企業（累計）", `${worry}社`, ""]].map(([l, v, s, strong]) => `<div class="v2-kpi ${strong ? "strong" : ""}"><span class="l">${l}</span><span class="v" style="font-size:24px">${v}</span><span class="d">${s}</span></div>`).join("")}</div>
      <div class="v2-rt-wrap"><table class="v2-rt v2-kct"><thead><tr><th>月</th><th>電話の理由</th><th>対象</th><th>未対応</th><th>架電済み（不在）</th><th>対応中</th><th>完了</th><th>完了率</th><th>良好</th><th>普通</th><th>懸念あり</th></tr></thead><tbody>
      ${d.months.map((m) => { const pct = m.total ? Math.round((m.done / m.total) * 100) : 0; const now = m.ym === d.nowYm; return `<tr class="${now ? "hl now" : ""} ${m.future ? "fut" : ""}"><th><button type="button" data-kc-ym="${m.ym}">${Number(m.ym.slice(5))}月</button></th><td class="rs">${esc(m.reasons.join("・") || "—")}</td>${m.future ? `<td colspan="9" class="kx-note">予定</td>` : `<td>${m.total}</td><td class="${now && m.counts["未対応"] ? "cc" : ""}">${m.counts["未対応"] || 0}</td><td>${m.counts["架電済み（不在）"] || 0}</td><td>${m.counts["対応中"] || 0}</td><td>${m.done}</td><td><div class="bar"><i style="width:${pct}%"></i></div><small>${pct}%</small></td><td>${m.results["良好"] || 0}</td><td>${m.results["普通"] || 0}</td><td class="${m.results["懸念あり"] ? "cc" : ""}">${m.results["懸念あり"] || 0}</td>`}</tr>`; }).join("")}
      </tbody><tfoot><tr><th>合計</th><td></td><td>${tot}</td><td>${past.reduce((a, m) => a + (m.counts["未対応"] || 0), 0)}</td><td>${past.reduce((a, m) => a + (m.counts["架電済み（不在）"] || 0), 0)}</td><td>${past.reduce((a, m) => a + (m.counts["対応中"] || 0), 0)}</td><td>${dn}</td><td>${tot ? Math.round((dn / tot) * 100) : 0}%</td><td>${past.reduce((a, m) => a + (m.results["良好"] || 0), 0)}</td><td>${past.reduce((a, m) => a + (m.results["普通"] || 0), 0)}</td><td>${worry}</td></tr></tfoot></table></div>
      <div class="kx-note">月を押すと、その月の企業ごとの進捗へ。対象：お手紙フォロー（4月・11月、お手紙を送付済みにした会社）・2か月連続0件（7月）・掲載1か月0件（毎月、月間アクセス数の取り込みが要ります）</div>`;
  } else {
    const ms = ((kc.plan && kc.plan.measures) || []).filter((x) => x.call);
    const rows0 = ms.flatMap((x) => x.rows.map((r) => ({ ...r, reason: x.reason, me: x })));
    const rows = rows0.filter((r) => (!kc.f.reason || r.reason === kc.f.reason) && (!kc.f.cs || kxSurname(r.cs) === kc.f.cs) && (!kc.f.st || r.status === kc.f.st));
    const eff = rows0.filter((r) => r.status !== "対象外"); const dn = eff.filter((r) => r.status === "完了").length; const pct = eff.length ? Math.round((dn / eff.length) * 100) : 0;
    const ST = ["未対応", "架電済み（不在）", "対応中", "完了", "対象外"];
    const needIds = rows0.map((r) => r.id).filter((id) => !(kc.inf && kc.inf[id]));
    if (needIds.length && !kc.infBusy) { kc.infBusy = true; api("/api/kinxs/sfinfo", { method: "POST", body: JSON.stringify({ ids: needIds }) }).then((d2) => { kc.inf = { ...(kc.inf || {}), ...(d2.info || {}) }; kc.infBusy = false; renderCallV2(); }).catch(() => { kc.infBusy = false; }); }
    body = `
      <div class="v2-strip">${d.months.map((m) => `<button type="button" class="${m.ym === kc.ym ? "on" : ""}" data-kc-ym="${m.ym}"><b>${Number(m.ym.slice(5))}月</b><small>${esc(m.reasons.join("・") || "—")}</small><span>${m.future ? "予定" : `完了 ${m.done}`}</span></button>`).join("")}</div>
      <section class="v2-sec"><div class="v2-big"><span class="l">今月のサマリ</span><span class="v">完了 ${dn}<small>/ ${eff.length}社</small></span><span class="pct" style="font-weight:800;color:#0E6B4E">${pct}%</span><div class="bar" style="flex:1;min-width:120px"><i style="width:${pct}%"></i></div></div>
        <div class="v2-big" style="margin-top:6px">${ST.map((s) => `<button type="button" class="v2-chip ${kc.f.st === s ? "red" : ""}" data-kc-st="${esc(s)}">${esc(s)} <b>${rows0.filter((r) => r.status === s).length}</b></button>`).join("")}</div></section>
      <div class="v2-month"><select class="kx-in" data-kc-f="reason" style="max-width:180px"><option value="">電話の理由：すべて</option>${[...new Set(rows0.map((r) => r.reason))].map((x) => `<option ${kc.f.reason === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select><select class="kx-in" data-kc-f="cs" style="max-width:160px"><option value="">担当：全員</option>${[...new Set(rows0.map((r) => kxSurname(r.cs)).filter(Boolean))].map((x) => `<option ${kc.f.cs === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div>
      <div class="v2-tbl" style="max-height:none"><div class="v2-act h call co2"><span>企業名</span><span>電話の理由</span><span>担当</span><span>電話番号（SF）</span><span>ステータス</span><span>架電</span><span>結果</span><span>メモ・次のアクション</span><span>NA日</span></div>
      ${rows.map((r) => `<div class="v2-act call co2" data-id="${esc(r.id)}" data-mkey="${esc(r.me.key)}"><span class="co" data-open="${esc(r.id)}" role="button" tabindex="0">${kxLogoMini(r)}${esc(r.name)}</span><span><span class="v2-tag">${esc(r.reason)}</span></span><span>${esc(kxSurname(r.cs) || "未定")}</span><span class="tel">${kc.inf && kc.inf[r.id] ? (kc.inf[r.id].phone ? kxTelLink(kc.inf[r.id].phone) : "—") : "…"}</span>
        <select class="kx-in" data-f="status">${ST.map((s) => `<option ${s === r.status ? "selected" : ""}>${s}</option>`).join("")}</select>
        <span class="calls"><b>${r.calls}</b>回 <button type="button" class="hp-b" data-call>＋架電</button><small>${esc(r.lastCall ? r.lastCall.slice(5).replace("-", "/") : "")}</small></span>
        <select class="kx-in" data-f="result">${["", "良好", "普通", "懸念あり", "未接続"].map((s) => `<option value="${s}" ${s === r.result ? "selected" : ""}>${s || "—"}</option>`).join("")}</select>
        <input class="kx-in" data-f="memo" value="${esc(r.memo)}" placeholder="メモ・次のアクション" /><input type="date" class="kx-in" data-f="na_date" value="${esc(r.naDate)}" /></div>`).join("") || '<div class="kx-empty">この月の電話の対象はありません</div>'}</div>
      <div class="kx-note">変えるとすぐ保存し、年間施策の数字と、企業詳細の議事録タブ（電話・メールなどの記録）にも入ります。</div>`;
  }
  // ヘッダー：月別進捗表／企業ごとの進捗、期の選択 or 月の送り、CSV
  let hc = $("kxHeadCall"); const hmEl = $("kxHeadMonth");
  if (!hc && hmEl) { hc = document.createElement("div"); hc.id = "kxHeadCall"; hc.className = "kx-headcall"; hmEl.insertAdjacentElement("afterend", hc); }
  if (hmEl) hmEl.hidden = true;
  if (hc) { hc.hidden = false;
    hc.innerHTML = `<span class="kx-seg hc-seg"><button type="button" class="${kc.tab === "month" ? "on" : ""}" data-kc-tab="month">月別進捗表</button><button type="button" class="${kc.tab === "co" ? "on" : ""}" data-kc-tab="co">企業ごとの進捗</button></span>`
      + (kc.tab === "month" ? `<select class="kx-in hc-sel" data-kc-period title="${d.period}期（${d.period + 1999}年3月〜${d.period + 2000}年2月）">${[curP, curP - 1].map((p) => `<option value="${p}" ${p === d.period ? "selected" : ""}>${p}期（${p + 1999}/3〜${p + 2000}/2）</option>`).join("")}</select><button type="button" class="kx-btn hc-csv" data-kc-csv title="スプレッドシート用に書き出す（CSV）">CSV ⬇</button>`
        : `<span class="v2-headm hc-m"><button type="button" data-kc-m="-1" aria-label="前の月">‹</button><b>${kxYmLabel(kc.ym)}</b><button type="button" data-kc-m="1" aria-label="次の月">›</button></span><button type="button" class="kx-btn hc-csv" data-kc-sheet title="「手紙送付リスト」のスプレッドシートを今すぐ読む（30分ごとにも自動）">シートから読む</button>`); }
  box.innerHTML = tabs + body;
  { const sb = hc && hc.querySelector("[data-kc-sheet]"); if (sb) sb.addEventListener("click", async () => {
      sb.disabled = true; sb.textContent = "読んでいます…";
      try { const r = await api("/api/kinxs/letter-sheet/sync", { method: "POST", body: JSON.stringify({}) });
        const cols = Object.entries(r.cols || {}).filter(([, v]) => v).map(([k, v]) => `${({ company: "会社", cs: "担当", status: "ステータス", result: "結果", memo: "メモ", na: "NA日", sent: "送付", calls: "架電回数", lastCall: "最終架電" })[k] || k}＝${v}`).join("、");
        alert(`「手紙送付リスト」を読みました（${r.ym.replace("-", "年")}月の分）\n\n行：${r.rows}／kinXs の会社に当たった：${r.matched}／記録を入れた：${r.updated}\n読んだ列：${cols || "なし"}${r.unmatched && r.unmatched.length ? `\n\n当たらなかった会社（${r.unmatched.length}）：${r.unmatched.slice(0, 15).join("、")}` : ""}`);
        location.reload();
      } catch (e) { alert("読めませんでした：" + e.message); } finally { sb.disabled = false; sb.textContent = "シートから読む"; } }); }
  const scope = { querySelectorAll: (q) => [...box.querySelectorAll(q), ...(hc ? hc.querySelectorAll(q) : [])], querySelector: (q) => box.querySelector(q) || (hc && hc.querySelector(q)) };
  scope.querySelectorAll("[data-kc-tab]").forEach((b) => b.addEventListener("click", () => { kc.tab = b.dataset.kcTab; renderCallV2(); }));
  const pe = scope.querySelector("[data-kc-period]"); if (pe) pe.addEventListener("change", () => { kc.period = Number(pe.value); kc.data = null; renderCallV2(); });
  box.querySelectorAll("[data-kc-ym]").forEach((b) => b.addEventListener("click", async () => { kc.ym = b.dataset.kcYm; kc.tab = "co"; kc.plan = await api(`/api/kinxs/plan?ym=${kc.ym}`).catch(() => null); renderCallV2(); }));
  scope.querySelectorAll("[data-kc-m]").forEach((b) => b.addEventListener("click", async () => { kc.ym = kxYmAdd(kc.ym, Number(b.dataset.kcM)); kc.plan = await api(`/api/kinxs/plan?ym=${kc.ym}`).catch(() => null); renderCallV2(); }));
  box.querySelectorAll("[data-kc-st]").forEach((b) => b.addEventListener("click", () => { kc.f.st = kc.f.st === b.dataset.kcSt ? "" : b.dataset.kcSt; renderCallV2(); }));
  box.querySelectorAll("[data-kc-f]").forEach((s) => s.addEventListener("change", () => { kc.f[s.dataset.kcF] = s.value; renderCallV2(); }));
  box.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", () => openDetail(el.dataset.open)));
  box.querySelectorAll(".v2-act[data-id]").forEach((row) => {
    const id = row.dataset.id, mkey = row.dataset.mkey;
    row.querySelectorAll("[data-f]").forEach((el) => el.addEventListener("change", async () => { try { await kpSave(mkey, kc.ym, { account_id: id, [el.dataset.f]: el.value }); el.style.borderColor = "#1D9E75"; kc.plan = await api(`/api/kinxs/plan?ym=${kc.ym}`).catch(() => kc.plan); } catch (e) { el.style.borderColor = "#C43D3D"; alert(e.message); } }));
    const cb = row.querySelector("[data-call]"); if (cb) cb.addEventListener("click", async () => { const stEl = row.querySelector('[data-f="status"]'); const st0 = stEl.value === "未対応" ? "架電済み（不在）" : stEl.value; try { await kpSave(mkey, kc.ym, { account_id: id, call: true, status: st0 }); kc.plan = await api(`/api/kinxs/plan?ym=${kc.ym}`); renderCallV2(); } catch (e) { alert(e.message); } });
  });
  const c1 = scope.querySelector("[data-kc-csv]"); if (c1) c1.addEventListener("click", () => kpCsv(`電話フォロー_${d.period}期_月別.csv`, ["月", "電話の理由", "対象", "未対応", "架電済み（不在）", "対応中", "完了", "完了率", "良好", "普通", "懸念あり"], d.months.map((m) => [m.ym, m.reasons.join("・"), m.total, m.counts["未対応"] || 0, m.counts["架電済み（不在）"] || 0, m.counts["対応中"] || 0, m.done, m.total ? Math.round((m.done / m.total) * 100) + "%" : "", m.results["良好"] || 0, m.results["普通"] || 0, m.results["懸念あり"] || 0])));
  const c2 = scope.querySelector("[data-kc-csv2]"); if (c2) c2.addEventListener("click", () => { const ms = ((kc.plan && kc.plan.measures) || []).filter((x) => x.call); kpCsv(`電話フォロー_${kc.ym}.csv`, ["企業名", "電話の理由", "担当", "電話番号", "ステータス", "架電回数", "最終架電日", "結果", "メモ・次のアクション", "NA日"], ms.flatMap((x) => x.rows.map((r) => [r.name, x.reason, r.cs, ((kc.inf || {})[r.id] || {}).phone || "", r.status, r.calls, r.lastCall, r.result, r.memo, r.naDate]))); });
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
    <div class="v2-dl-acts"><input class="kx-in" data-sheet placeholder="DOCユーザーリストのURL（一度入れれば覚えます）" style="min-width:280px" /><button type="button" class="kx-btn kx-pri" data-dl-sheet>スプレッドシートに書き出す（新しいタブ）</button><button type="button" class="kx-btn" data-dl-csv>CSVで書き出す</button>${me.key === "letter" ? '<button type="button" class="kx-btn" data-dl-wait>選んだ企業を「送付待ち」にする</button><button type="button" class="kx-btn" data-dl-done>選んだ企業を「送付済み」にする</button>' : me.ch === "郵送" ? '<button type="button" class="kx-btn" data-dl-done>選んだ企業を「発送済み」にする</button>' : '<button type="button" class="kx-btn" data-dl-done>選んだ企業を「完了」にする</button>'}<button type="button" class="kx-btn" data-dl-out>選んだ企業を「対象外」にする</button><span class="kx-note" data-dl-st></span></div>
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
  const bulk = async (status) => { if (!kp.chk.size) { alert("企業を選んでください"); return; } try { const n = kp.chk.size; await api("/api/kinxs/actions", { method: "PUT", body: JSON.stringify({ mkey: me.key, ym: kp.ym, ids: [...kp.chk], status }) }); if (status === "完了" || status === "送付済み" || status === "送付待ち") kxDoneToast(`${n}社を${status === "完了" && me.ch === "郵送" ? "発送済み" : status}にしました`); kp.chk.clear(); kp.tgKey = ""; kpLoad(true); } catch (e) { alert(e.message); } };
  const dn = box.querySelector("[data-dl-done]"); if (dn) dn.addEventListener("click", () => bulk(me.key === "letter" ? "送付済み" : "完了"));
  const dw = box.querySelector("[data-dl-wait]"); if (dw) dw.addEventListener("click", () => bulk("送付待ち"));
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
  // 設定は DOC自動更新 の下に（2026-11-09 田中さん「設定の上に自動更新のメニュー」）
  const nav = document.querySelector(".kx-nav[data-view='ar']") || document.querySelector(".kx-nav[data-view='renew']");
  if (nav && nav.parentElement && !document.getElementById("kcsSet")) {
    const a = document.createElement("a"); a.id = "kcsSet"; a.className = "kx-nav"; a.href = "/kincs/settings";
    a.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>設定`;
    nav.parentElement.insertBefore(a, nav.nextSibling);
  }
}

// ===================== DOC（アチコチバース）1ヶ月ごとの自動更新（2026-11-09 幸地美穂さんの要件・田中さん）=====================
//   販売管理部は kincs でこの画面を見て、締めの日に自分で Excel を落とす。事業部（kinXs）は企業の登録・ステータス・解約・SF計上・入金を直す
const ar = { ym: "", data: null, tab: "bill" };
function arYmNow() { const d = new Date(Date.now() + 9 * 3600000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; }
function arAddYm(ym, n) { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; }
const arJp = (ym) => ym ? `${ym.slice(0, 4)}年${Number(ym.slice(5, 7))}月` : "";
async function arLoad() {
  const box = $("vArBody"); if (!box) return;
  if (!ar.ym) ar.ym = arYmNow();
  box.innerHTML = '<div class="ar-empty">読み込んでいます…</div>';
  try { ar.data = await Promise.race([api(`/api/kinxs/autorenew?ym=${ar.ym}${KX_TEST ? "&test=1" : ""}`), new Promise((_, no) => setTimeout(() => no(new Error("時間がかかりすぎています。少し待ってから開き直してください")), 45000))]); arRender(); } catch (e) { box.innerHTML = `<div class="ar-empty">読み込めませんでした：${esc(e.message)}</div>`; }
}
// ステータスの札（2026-11-11 仕様変更指示書：開始待ち・更新確定・解約確定・解約済・未入金・停止）
function arStTag(s) { const c = { 更新確定: " ok", 開始待ち: " wait", 解約確定: " cx", 解約済: " done", 未入金: " bad", 停止: " bad" }[s] ?? ""; return `<span class="ar-st${c}">${esc(s)}</span>`; }
// 解約予定の列：翌月なら「翌月解約」（強調）、それ以外は解約予定月、申請なしは「—」
function arPlanCell(x, ym) { const E = (x.status === "解約予定" || x.status === "解約済") ? x.cancelMonth : ""; if (!E) return "—"; return E === arAddYm(ym, 1) ? '<b class="ar-next">翌月解約</b>' : esc(arJp(E)); }
const arPrevYm = (ym) => { const [y, m] = String(ym).split("-").map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
function arRender() {
  const box = $("vArBody"); const d = ar.data; if (!box || !d) return;
  if (ar.tab === "diff" || ar.tab === "recon") ar.tab = "bill";
  const ed = !!d.canEdit;
  const nNew = d.diff.filter((x) => x.kind === "新規").length, nCx = d.cancels.length, nStop = d.all.filter((x) => ["未入金", "停止"].includes(x.status)).length;
  const tabs = [["bill", `請求対象一覧（${d.bill.length}）`], ["cancel", `解約一覧（${nCx}）`], ["wait", `開始待ち（${(d.waiting || []).length}）`], ["all", `全企業（${d.all.length}）`],   /* 差分・突合はなくした（2026-11-10 幸地さん） */ ...(ed ? [["form", `解約フォーム${(d.inbox || []).length ? `（要確認 ${(d.inbox || []).length}）` : ""}`]] : [])];
  let body = "";
  const tbl = (head, rows, empty) => `<div class="ar-tbl"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("") || `<tr><td colspan="${head.length}" class="ar-empty">${empty}</td></tr>`}</tbody></table></div>`;
  if (ar.tab === "bill") body = tbl(["申込番号", "企業名", "プラン", "契約開始月", "請求金額", "ステータス", "解約予定", "解約申請日", "SF計上"], /* 入金の列はなくした（2026-11-10 田中さん。未入金は「直す」のステータスで） */ d.bill.map((x) => `<tr><td>${esc(x.no || "—")}</td><td><b>${esc(x.name)}</b></td><td>${esc(x.plan)}</td><td>${esc(arJp(x.start))}</td><td>${Number(x.amount).toLocaleString()}円</td><td>${arStTag(x.statusOn)}</td><td>${arPlanCell(x, d.ym)}</td><td>${esc(x.cancelApplied || "—")}${x.cancelApplied ? ` <button type="button" class="hp-b" data-ar-app="${esc(x.id)}" title="お客様が解約フォームに書いた内容を見る">申請内容</button>` : ""}</td>
      <td>${ed ? `<label><input type="checkbox" data-ar-sf="${esc(x.id)}" ${x.sf ? "checked" : ""}> 済</label>` : (x.sf ? "済" : "<span style='color:#B4441F'>未</span>")}</td></tr>`), `${arJp(d.ym)}に請求する企業はありません`);
  else if (ar.tab === "wait") body = tbl(["申込番号", "企業名", "プラン", "契約開始月", "ステータス", "担当CS"], (d.waiting || []).map((x) => `<tr><td>${esc(x.no || "—")}</td><td><b>${esc(x.name)}</b></td><td>${esc(x.plan)}</td><td>${esc(arJp(x.start))}</td><td>${arStTag(x.statusOn)}</td><td>${esc(kxSurname ? kxSurname(x.cs) : x.cs)}</td></tr>`), `${arJp(d.ym)}に開始待ちの企業はありません`);
  else if (ar.tab === "cancel") body = tbl(["申込番号", "企業名", "解約申請日", "解約希望月", "解約予定月", "申請者", "連絡先"], d.cancels.map((x) => `<tr><td>${esc(x.no || "—")}</td><td><b>${esc(x.name)}</b></td><td>${esc(x.cancelApplied || "—")}${x.cancelApplied ? ` <button type="button" class="hp-b" data-ar-app="${esc(x.id)}" title="お客様が解約フォームに書いた内容を見る">申請内容</button>` : ""}</td><td>${esc(arJp(x.cancelWish))}</td><td>${esc(arJp(x.cancelMonth))}</td><td>${esc(x.applicant || "—")}</td><td>${esc(x.contact || "—")}</td></tr>`), `${arJp(d.ym)}から解約済みになる企業はありません`);
  else if (ar.tab === "diff") body = tbl(["申込番号", "企業名", "区分", "変更月"], d.diff.map((x) => `<tr><td>${esc(x.no || "—")}</td><td><b>${esc(x.name)}</b></td><td>${arStTag(x.kind === "新規" ? "継続中" : x.kind).replace("継続中", "新規")}</td><td>${esc(arJp(x.changed))}</td></tr>`), `${arJp(d.prev)}からの増減はありません`);
  else if (ar.tab === "recon") {
    const r = d.recon; const base = r.kinxs;
    const row = (label, n, key) => { const ng = n != null && n !== "" && Number(n) !== base; return `<tr class="${ng ? "ng" : ""}"><td>${label}</td><td class="n">${key ? `<input type="number" min="0" data-ar-rc="${key}" value="${n == null ? "" : n}" placeholder="記入">` : (n == null ? "—" : n)}</td><td>${n == null || n === "" ? "<span style='color:#8FA39A'>未記入</span>" : ng ? `<b style="color:#B4441F">差異 ${Number(n) - base > 0 ? "+" : ""}${Number(n) - base}</b>` : "一致"}</td></tr>`; };
    body = `<div class="ar-tbl ar-recon"><table><thead><tr><th>項目</th><th>件数</th><th>kinXsの請求対象との差異</th></tr></thead><tbody>
      <tr><td>kinXsの請求対象社数</td><td class="n">${base}</td><td>基準</td></tr>${row("SF計上件数（SF計上「済」の数）", r.sf)}${row("請求書発行件数（販売管理部）", r.invoices, "invoices")}${row("ブレインバース社からの請求件数", r.bv, "bv")}</tbody></table></div>
      <div style="margin-top:8px;display:flex;gap:8px;align-items:center"><button type="button" class="kx-btn kx-pri" id="arRcSave">件数を保存</button><span class="kx-note" id="arRcSt"></span></div>`;
  } else if (ar.tab === "form") {
    const f = d.form || {}; const opts = d.all.filter((x) => x.plan === "自動更新").map((x) => `<option value="${esc(x.id)}">${esc(x.name)}${x.no ? `（${esc(x.no)}）` : ""}</option>`).join("");
    body = `<div class="ar-card" style="margin-bottom:10px"><small>解約フォームの回答のスプレッドシート（フォームの「回答」→「スプレッドシートにリンク」で作ったもの）</small>
        <div style="display:flex;gap:6px;margin-top:6px"><input id="arSheet" class="kx-in" style="flex:1" value="${esc(f.sheet || "")}" placeholder="https://docs.google.com/spreadsheets/d/…"><button type="button" class="kx-btn" id="arSheetSave">今すぐ読む</button></div><div class="kx-note" id="arAutoSt" style="margin-top:4px">変えた内容はすぐ保存されます</div>
        <div class="kx-note" style="margin-top:6px">フォームが送られたらすぐ（下の「すぐ取り込む設定」をしたとき）、この画面を開いたとき、念のため2分ごとに読み、申込番号（無ければ会社名）で企業を特定し、解約になる月の前までは「更新確定」、その月から「解約済み」にします。締切は解約になる月の2か月前の第15営業日（過ぎたら1か月うしろ）です。
          <button type="button" class="hp-b" id="arHookScript" style="margin-left:4px">⚡ すぐ取り込む設定（フォームに貼るスクリプト）</button></div><div id="arHookBox" hidden style="margin-top:6px"></div>
        <div class="kx-note" style="margin-top:6px">申請者には受付の自動返信を送ります（<label><input type="checkbox" id="arReplyOn" ${f.replyOn ? "checked" : ""}> 自動返信する</label>）。</div>
        <div style="display:grid;grid-template-columns:200px 1fr;gap:6px 10px;align-items:center;margin-top:10px;font-size:12.5px">
          <span>自動返信を送る人</span><div style="display:flex;gap:6px;align-items:center"><input id="arReplyOwner" class="kx-in" style="flex:1" value="${esc(f.replyOwner || "")}" placeholder="DOC事務局 か 幸地さんの kinbot のメール"><span class="${f.replyReady ? "ar-st" : "ar-st bad"}">${f.replyOwner ? (f.replyReady ? "Gmailで送れます" : "Google連携がまだ") : "未設定"}</span><button type="button" class="hp-b" id="arConnLink">Google連携のリンク</button></div>
          <span>差出人・返信先（事務局）</span><input id="arReplyFrom" class="kx-in" value="${esc(f.replyFrom || "")}" placeholder="例：doc-jimukyoku@neo-career.co.jp（空なら送る人のアドレス）">

          <span>共有日（販管・ブレインバース社）</span><div style="display:flex;gap:6px;align-items:center">毎月 第<input id="arShareDay" class="kx-in" type="number" min="1" max="23" style="width:64px" value="${esc(f.shareDay || 20)}">営業日<span class="kx-note">${f.shareDate ? `この月は ${esc(f.shareDate.slice(5).replace("-", "/"))}（土日・祝日・12/29〜1/3 を除いて数えます）` : ""}</span></div>
          <span>宛先（申請者といっしょに）</span><div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><input id="arReplyAlso" class="kx-in" style="flex:1;min-width:220px" value="${esc(f.replyAlso != null ? f.replyAlso : "support_x@mochica.jp")}" placeholder="例：support_x@mochica.jp（いくつでも・カンマ区切り）"><label style="white-space:nowrap"><input type="checkbox" id="arReplyCs" ${f.replyCs !== false ? "checked" : ""}> その企業のCS担当も入れる</label></div>
        </div>
        <div class="kx-note" style="margin-top:6px">送る人は、kinbot にログインして Google 連携をしている人です。差出人を事務局のアドレスにするときは、送る人の Gmail の「他のアドレスからメールを送信」に事務局のアドレスを入れておいてください（入っていないと、送る人のアドレスで届き、返信先だけ事務局になります）。${f.notReplied ? ` <b style="color:#B4441F">まだ自動返信を送れていない回答が ${f.notReplied}件あります</b>` : ""}${f.at ? `最後に読んだ日時：${esc(String(f.at).slice(0, 16).replace("T", " "))}` : ""}${f.error ? ` <b style="color:#B4441F">読めませんでした：${esc(f.error)}</b>` : ""}</div></div>
      ${tbl(["申請日", "貴社名（フォーム）", "申込番号", "解約希望月", "申請者・メール", "どの企業か"], (d.inbox || []).map((x) => `<tr><td>${esc(String(x.at || "").slice(0, 10))}</td><td><b>${esc(x.company)}</b></td><td>${esc(x.no || "—")}</td><td>${esc(arJp(x.wish))}</td><td>${esc(x.applicant)}<br><small>${esc(x.email)}</small></td>
        <td><select data-ib-sel="${x.id}"><option value="">企業を選ぶ…</option>${opts}</select> <button type="button" class="hp-b" data-ib-go="${x.id}">当てはめる</button> <button type="button" class="hp-b" data-ib-ig="${x.id}">無視</button></td></tr>`), "要確認の回答はありません（申込番号・会社名で企業を特定できなかった回答がここに出ます）")}`;
  } else {
    // 全企業：プランで絞る・納品一覧シートとの同期（2026-11-10 幸地さん）
    const pf = ar.plan || ""; const list = d.all.filter((x) => !pf || x.plan === pf);
    const sy = d.sync; const accts = d.all;
    const syncBox = ed ? `<div class="ar-card ar-panel" style="margin-bottom:10px"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b style="font-size:14px">納品一覧シートと同期</b><span class="kx-note">${sy ? `最後 ${esc(String(sy.at).slice(5, 16).replace("T", " ").replace("-", "/"))}・突合 ${sy.matched || 0}/${sy.rows || 0}社${(sy.unmatched || []).length ? `・<b style="color:#B4441F">未突合 ${(sy.unmatched || []).length}社</b>` : ""}${sy.error ? `・<b style="color:#B4441F">エラー</b>` : ""}` : "まだ同期していません"}</span><button type="button" class="kx-btn kx-pri" id="arSyncGo" style="margin-left:auto">今すぐ同期</button></div>
        <details class="ar-fold"><summary>くわしく（未突合の企業・商品名のルール・契約終了月のズレ）</summary>
        <div class="kx-note" style="margin-top:6px">【販管↔MO/事開】納品一覧／DOC_アチコチバース（年間）の D列（商品名）・E列（企業名）・X列（契約開始月）・Y列（契約終了月）を1時間ごとに読みます</div>
        <div class="kx-note" style="margin-top:6px">${sy ? `最後の同期：${esc(String(sy.at).slice(0, 16).replace("T", " "))}（${esc(sy.by || "")}）・シートの企業 ${sy.rows || 0}社・突合 ${sy.matched || 0}・更新 ${sy.changed || 0}${(sy.unmatched || []).length ? `・<b style="color:#B4441F">未突合 ${(sy.unmatched || []).length}社</b>` : ""}${sy.error ? ` <b style="color:#B4441F">エラー：${esc(sy.error)}</b>` : ""}` : "まだ同期していません"}</div>
        ${(sy && (sy.unmatched || []).length) ? `<details style="margin-top:8px"><summary class="kx-note" style="cursor:pointer">未突合の企業（kinXsの会社に紐づける）</summary>${(sy.unmatched || []).slice(0, 60).map((u) => `<div style="display:flex;gap:6px;align-items:center;margin-top:4px;font-size:12.5px"><span style="min-width:220px"><b>${esc(u.name)}</b> <small>${esc(arJp(u.start))}〜${esc(arJp(u.end))}</small></span><input list="arAcAll" data-un-in="${esc(u.key)}" class="kx-in" placeholder="kinXsの会社名" style="flex:1"><button type="button" class="hp-b" data-un-go="${esc(u.key)}">紐づける</button></div>`).join("")}</details>` : ""}
        <details style="margin-top:8px"><summary class="kx-note" style="cursor:pointer">商品名でプラン区分を決めるルール（下のルールのほか、商品名に「自動更新」があれば自動更新、ほかは年間。商品マスタ名が決まったら、ここで変えられます）</summary>
          <textarea id="arRules" class="kx-in" rows="3" style="width:100%;margin-top:6px" placeholder="1行に1つ：商品名に含む文字 → 自動更新 または 年間（例：アチコチバース月額 → 自動更新）">${esc((d.rules || []).map((r) => `${r.match} → ${r.plan}`).join("\n"))}</textarea><button type="button" class="hp-b" id="arRulesSave">ルールを保存して同期</button></details>
        <div id="arDiffs" style="margin-top:10px"></div></details></div>` : "";
    body = syncBox + `<div class="kx-seg" style="margin-bottom:8px">${[["", "すべて"], ["自動更新", "自動更新"], ["年間", "年間"]].map(([k, l]) => `<button type="button" class="${pf === k ? "on" : ""}" data-ar-pf="${k}">${l}（${k ? d.all.filter((x) => x.plan === k).length : d.all.length}）</button>`).join("")}</div>` +
      tbl(["申込番号", "企業名", "プラン", "商品名", "契約開始月", "契約終了月", "ステータス", "解約予定", "解約申請日", "担当CS", ""], list.map((x) => `<tr><td>${esc(x.no || "—")}</td><td><b>${esc(x.name)}</b></td><td>${esc(x.plan)}</td><td><small>${esc(x.product || "—")}</small></td><td>${esc(arJp(x.start))}</td><td>${esc(arJp(x.end) || "—")}</td><td>${x.plan === "自動更新" ? arStTag(x.statusOn) : "—"}</td><td>${x.plan === "自動更新" ? arPlanCell(x, d.ym) : "—"}</td><td>${esc(x.cancelApplied || "—")}${x.cancelApplied ? ` <button type="button" class="hp-b" data-ar-app="${esc(x.id)}" title="お客様が解約フォームに書いた内容を見る">申請内容</button>` : ""}</td><td>${esc(kxSurname ? kxSurname(x.cs) : x.cs)}</td><td>${ed ? `<button type="button" class="hp-b" data-ar-edit="${esc(x.id)}">直す</button>${String(x.id).startsWith("test-") ? ` <button type="button" class="hp-b" data-ar-deltest="${esc(x.id)}" style="color:#B4441F">消す</button>` : KX_TEST ? ` <button type="button" class="hp-b" data-ar-clone="${esc(x.id)}" title="この会社のテスト用コピーを作る（本物は変わりません）">🧪 この会社でテスト</button>` : ""}` : ""}</td></tr>`), "まだ企業がありません（納品一覧シートと同期すると出てきます）")
      + `<datalist id="arAcAll"></datalist>`;
  }
  const ex = (d.exports || [])[0];
  { const tb = $("kxTopAr"); if (tb) { tb.hidden = false; tb.innerHTML = `<div class="ar-mon"><button type="button" data-ar-mv="-1">‹</button><b>${arJp(d.ym)}分</b><button type="button" data-ar-mv="1">›</button></div>
      <button type="button" class="kx-btn kx-pri" id="arXlsx">月次Excelをダウンロード</button>${ed ? '<button type="button" class="kx-btn" id="arAdd">＋ 自動更新の企業を登録</button><button type="button" class="kx-btn" id="arCsv">CSVでまとめて登録</button><input type="file" id="arCsvF" accept=".csv,text/csv" hidden>' : ""}
      <span class="kx-note">${ex ? `最後の出力：${esc(String(ex.at).slice(0, 16).replace("T", " "))}・第${ex.version}版` : "この月分はまだ出力していません"}</span>
      ${ed ? `<button type="button" class="kx-btn ${KX_TEST ? "kx-test-on" : ""}" id="arTestTg" title="テスト用の会社を出す・隠す（このブラウザだけ）">🧪 テスト${KX_TEST ? "中" : ""}</button>${KX_TEST ? '<button type="button" class="kx-btn" id="arTestAdd">＋ テスト用の会社</button>' : ""}` : ""}`; } }
  box.innerHTML = `    ${(() => { const al = d.alerts || {}; const items = [];
      if ((al.sfNotDone || []).length) items.push(`今月のSF計上がまだの企業が <b>${al.sfNotDone.length}社</b>（${esc(al.sfNotDone.slice(0, 3).join("・"))}${al.sfNotDone.length > 3 ? " ほか" : ""}）`);
      if (ed && al.unmatched) items.push(`解約フォームの回答で、企業を特定できなかったものが <b>${al.unmatched}件</b>（「解約フォーム」のタブで当てはめてください）`);
      if ((al.unpaid || []).length) items.push(`未入金の企業が <b>${al.unpaid.length}社</b>（${esc(al.unpaid.slice(0, 3).join("・"))}）`);
      return items.length ? `<div style="background:#FFF6F3;border:1px solid #F0C9B8;border-radius:12px;padding:10px 14px;margin-bottom:12px;font-size:13px;color:#7A2E12">${items.map((t) => `⚠ ${t}`).join("<br>")}</div>` : ""; })()}
    <div class="ar-cards"><div class="ar-card"><small>請求対象（更新確定）</small><b>${d.bill.length}</b><span>社・${(d.bill.length * d.price).toLocaleString()}円（税別）</span></div><div class="ar-card"><small>開始待ち</small><b>${(d.waiting || []).length}</b><span>社</span></div><div class="ar-card"><small>この月から解約（解約確定）</small><b>${nCx}</b><span>社</span></div><div class="ar-card${nStop ? " warn" : ""}"><small>未入金・停止</small><b>${nStop}</b><span>社</span></div></div>
    <div class="kx-seg" style="margin-bottom:10px">${tabs.map(([k, l]) => `<button type="button" class="${ar.tab === k ? "on" : ""}" data-ar-tab="${k}">${l}</button>`).join("")}</div>${body}`;
  document.querySelectorAll("#kxTopAr [data-ar-mv]").forEach((b) => b.addEventListener("click", () => { ar.ym = arAddYm(ar.ym, Number(b.dataset.arMv)); arLoad(); }));
  box.querySelectorAll("[data-ar-tab]").forEach((b) => b.addEventListener("click", () => { ar.tab = b.dataset.arTab; arRender(); }));
  box.querySelectorAll("[data-ar-sf]").forEach((c) => c.addEventListener("change", () => arSaveMonth(c.dataset.arSf, { sf: c.checked })));
  box.querySelectorAll("[data-ar-paid]").forEach((c) => c.addEventListener("change", () => arSaveMonth(c.dataset.arPaid, { paid: c.value === "" ? null : c.value === "1" })));
  box.querySelectorAll("[data-ar-edit]").forEach((b) => b.addEventListener("click", () => arEdit(d.all.find((x) => String(x.id) === b.dataset.arEdit))));
  if ($("arAdd")) $("arAdd").addEventListener("click", () => arEdit(null));
  if ($("arXlsx")) $("arXlsx").addEventListener("click", arExcel);
  if ($("arTestTg")) $("arTestTg").onclick = () => { try { localStorage.setItem("kxTest", KX_TEST ? "0" : "1"); } catch {} location.reload(); };
  if ($("arTestAdd")) $("arTestAdd").onclick = async () => {
    const nm = prompt("テスト用の会社の名前（空ならおまかせ）。頭に【テスト】が付きます。\n自動更新・今月から・継続中で作り、申込番号は TEST-… になります", ""); if (nm == null) return;
    try { const r = await api("/api/kinxs/test-accounts", { method: "POST", body: JSON.stringify({ name: nm }) }); alert(`作りました：${r.name}\n申込番号：${r.no}\n\n解約フォームを試すときは、この申込番号と自分のメールアドレスで送ってください（自動返信は自分にだけ届きます）`); arLoad(); }
    catch (e) { alert(e.message); } };
  document.querySelectorAll("[data-ar-app]").forEach((b) => b.onclick = async () => {
    let r; try { r = await api(`/api/kinxs/autorenew/${encodeURIComponent(b.dataset.arApp)}/applications`); } catch (e) { alert(e.message); return; }
    const x0 = (ar.data.all || []).find((y) => String(y.id) === String(b.dataset.arApp)) || {};
    const bg = document.createElement("div"); bg.className = "kx-drawer-bg"; bg.style.cssText = "display:flex;align-items:center;justify-content:center;";
    const it = r.items || [];
    bg.innerHTML = `<div class="ar-card ar-panel ar-app" style="width:min(640px,94vw);max-height:84vh;overflow:auto;background:#fff;padding:18px 20px;border-radius:14px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><b style="font-size:15px">解約の申請内容：${esc(x0.name || "")}</b><button type="button" class="hp-b" data-x style="margin-left:auto">閉じる</button></div>
      ${it.length ? it.map((a) => `<div style="border:1px solid #E6ECE9;border-radius:10px;padding:10px 12px;margin-bottom:8px"><div class="kx-note" style="margin-bottom:6px">${esc(String(a.at || "").slice(0, 10))} に申請・${esc(a.state || "")}${a.replied ? "・受付メール送信済み" : ""}</div>
        <dl class="ar-app-dl">${Object.entries(a.raw || {}).filter(([k, v]) => k && String(v ?? "").trim() !== "").map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(String(v ?? ""))}</dd>`).join("")}</dl></div>`).join("")
        : `<div class="kx-note">フォームからの申請は見つかりませんでした（手で解約予定にした会社か、フォームの回答と結びついていません）</div>`}
      ${r.sheet ? `<a class="kx-btn" href="${esc(r.sheet)}" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px">回答シート（フォームの回答）を開く ↗</a>` : ""}</div>`;
    document.body.appendChild(bg);
    bg.addEventListener("click", (e) => { if (e.target === bg || e.target.closest("[data-x]")) bg.remove(); });
  });
  document.querySelectorAll("[data-ar-clone]").forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try { const r = await api("/api/kinxs/test-accounts", { method: "POST", body: JSON.stringify({ fromId: b.dataset.arClone }) });
      alert(`テスト用のコピーを作りました：${r.name}\n申込番号：${r.no}\n\n本物の会社は変わりません。解約を試すときは、このコピーを「直す」で解約予定にするか、解約フォームにこの申込番号と自分のメールアドレスで送ってください（自動返信は自分にだけ届きます）`); arLoad(); }
    catch (e) { alert(e.message); b.disabled = false; } });
  document.querySelectorAll("[data-ar-deltest]").forEach((b) => b.onclick = async () => { if (!confirm("このテスト用の会社を消しますか？（記録もいっしょに消えます）")) return; try { await api(`/api/kinxs/test-accounts/${encodeURIComponent(b.dataset.arDeltest)}`, { method: "DELETE" }); arLoad(); } catch (e) { alert(e.message); } });
  // 全企業：プランで絞る・同期・未突合の紐づけ・ルール
  box.querySelectorAll("[data-ar-pf]").forEach((b) => b.addEventListener("click", () => { ar.plan = b.dataset.arPf; arRender(); }));
  if ($("arSyncGo")) $("arSyncGo").addEventListener("click", async () => { $("arSyncGo").disabled = true; $("arSyncGo").textContent = "同期しています…"; try { const r = await api("/api/kinxs/autorenew-sync", { method: "POST", body: "{}" }); alert(`同期しました：シートの企業 ${r.rows || 0}社・突合 ${r.matched || 0}・更新 ${r.changed || 0}・未突合 ${(r.unmatched || []).length}`); } catch (e) { alert("同期できませんでした：" + e.message); } arLoad(); });
  if (box.querySelector("[data-un-go]")) { api(kxUsersUrl()).then((u) => { const dl = $("arAcAll"); if (dl) dl.innerHTML = (u.items || []).filter((i) => !i.archived).map((i) => `<option value="${esc(i.name)}"></option>`).join(""); ar._acc = u.items || []; }).catch(() => {}); }
  box.querySelectorAll("[data-un-go]").forEach((b) => b.addEventListener("click", async () => { const nm = (box.querySelector(`[data-un-in="${CSS.escape(b.dataset.unGo)}"]`) || {}).value || ""; const hit = (ar._acc || []).find((i) => i.name === nm.trim()); if (!hit) { alert("kinXsの会社を候補から選んでください"); return; } try { await api("/api/kinxs/autorenew-sync/link", { method: "POST", body: JSON.stringify({ key: b.dataset.unGo, accountId: hit.id }) }); arLoad(); } catch (e) { alert(e.message); } }));
  if ($("arRulesSave")) $("arRulesSave").addEventListener("click", async () => { const rules = $("arRules").value.split(/\n/).map((l) => l.split(/→|->|＝|=/)).filter((x) => x.length >= 2 && x[0].trim()).map((x) => ({ match: x[0].trim(), plan: /自動/.test(x[1]) ? "自動更新" : "年間" })); try { await api("/api/kinxs/autorenew-rules", { method: "PUT", body: JSON.stringify({ rules }) }); arLoad(); } catch (e) { alert(e.message); } });
  // 解約フォーム：シートの保存・要確認の当てはめ
  if ($("arDiffs")) (async () => { const box = $("arDiffs");
    try { const r = await api("/api/kinxs/autorenew-sync/diffs"); const it = r.items || [];
      box.innerHTML = `<details ${it.length ? "open" : ""}><summary class="kx-note" style="cursor:pointer"><b>納品一覧の契約終了月とkinXsの更新月のズレ：${it.length}社</b></summary>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0"><label style="font-size:12.5px"><input type="checkbox" id="arTruth" ${r.endTruth ? "checked" : ""}> 納品一覧の契約終了月を正にする（同期のたびにkinXsの更新月を合わせ、SFからは上書きしない）</label>${it.length ? '<button type="button" class="hp-b" id="arAlignAll">ズレを全部、納品一覧に合わせる</button>' : ""}</div>
        ${it.length ? `<div class="ar-tbl" style="max-height:320px;overflow:auto"><table><thead><tr><th>企業</th><th>納品一覧の契約終了月</th><th>kinXsの更新月</th><th>ズレ</th><th>CS</th><th></th></tr></thead><tbody>${it.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td>${esc(arJp(x.sheetEnd))}</td><td>${esc(arJp(x.renew) || "（なし）")}</td><td>${x.gap == null ? "—" : `${x.gap > 0 ? "+" : ""}${x.gap}ヶ月`}</td><td>${esc(x.cs || "")}</td><td><button type="button" class="hp-b" data-align="${esc(x.id)}">合わせる</button></td></tr>`).join("")}</tbody></table></div>` : '<div class="kx-note">ズレはありません</div>'}</details>`;
      const go = async (body) => { try { const a = await api("/api/kinxs/autorenew-sync/align", { method: "POST", body: JSON.stringify(body) }); if (a.aligned) alert(`${a.aligned}社の更新月を、納品一覧に合わせました`); arLoad(); } catch (e) { alert(e.message); } };
      $("arTruth").onchange = () => go({ truth: $("arTruth").checked, onlySetting: true });
      if ($("arAlignAll")) $("arAlignAll").onclick = () => { if (confirm(`${it.length}社のkinXsの更新月を、納品一覧の契約終了月に合わせます。よいですか？`)) go({}); };
      box.querySelectorAll("[data-align]").forEach((b) => b.onclick = () => go({ ids: [b.dataset.align] }));
    } catch (e) { box.innerHTML = `<div class="kx-note">ズレを読めませんでした：${esc(e.message)}</div>`; } })();
  if ($("arHookScript")) $("arHookScript").onclick = async () => {
    const box = $("arHookBox"); box.hidden = false; box.innerHTML = '<span class="kx-note">作っています…</span>';
    try { const r = await api("/api/kinxs/autorenew/form-hook-script");
      box.innerHTML = `<div class="kx-note">解約フォームの編集画面 → 右上の「︙」→「スクリプト エディタ」に下を貼って保存 → 左の「⏰ トリガー」→「トリガーを追加」→ 関数「kinxsNotify」・イベントのソース「フォームから」・種類「フォーム送信時」→ 保存（Googleの許可を求められたら「許可」）。これで、送られた瞬間に更新確定・解約月が変わります。</div>
        <textarea class="kx-in" rows="7" readonly style="width:100%;box-sizing:border-box;font-family:monospace;font-size:12px;margin-top:6px">${esc(r.script)}</textarea>
        <div style="display:flex;gap:6px;margin-top:4px"><button type="button" class="hp-b" id="arHookCopy">コピー</button><button type="button" class="hp-b" id="arHookRenew" title="合言葉を作り直す（前に貼ったスクリプトは動かなくなります）">合言葉を作り直す</button></div>`;
      $("arHookCopy").onclick = async () => { try { await navigator.clipboard.writeText(r.script); $("arHookCopy").textContent = "コピーしました"; } catch { box.querySelector("textarea").select(); } };
      $("arHookRenew").onclick = async () => { if (!confirm("合言葉を作り直しますか？前に貼ったスクリプトは動かなくなるので、貼り直しが要ります")) return; await api("/api/kinxs/autorenew/form-hook-script?renew=1"); $("arHookScript").click(); };
    } catch (e) { box.innerHTML = `<span class="kx-note">作れませんでした：${esc(e.message)}</span>`; } };
  if ($("arConnLink")) $("arConnLink").onclick = async () => {
    const em = $("arReplyOwner").value.trim(); if (!em) { alert("先に「自動返信を送る人」にアドレスを入れてください（例：doc_support@neo-career.co.jp）"); return; }
    try { const r = await api(`/api/kinxs/autorenew/connect-link?email=${encodeURIComponent(em)}`);
      try { await navigator.clipboard.writeText(r.link); } catch {}
      prompt(`${r.email} の Google 連携リンクです（コピーしました）。${r.connected ? "\n※ もう連携ずみです。つなぎ直すときだけ使ってください。" : ""}\n\n${r.email} で Google にログインしたブラウザ（シークレットウィンドウがおすすめ）でこのリンクを開き、「許可」を押すと連携できます。kinbot へのログインは要りません。終わったら、ここで「保存して読む」を押してください。`, r.link);
    } catch (e) { alert(e.message); } };
  // 設定は、変えたらすぐ保存（ボタンを押さなくてよい）（2026-11-10 田中さん）。シートのURLを変えたときだけ読み直して描き直す
  const arFormBody = () => ({ sheet: $("arSheet").value, replyOn: $("arReplyOn").checked, replyOwner: $("arReplyOwner").value, replyFrom: $("arReplyFrom").value, replyAlso: $("arReplyAlso") ? $("arReplyAlso").value : undefined, replyCs: $("arReplyCs") ? $("arReplyCs").checked : undefined, shareDay: $("arShareDay") ? $("arShareDay").value : undefined });
  const arFormSave = async (reload) => { const st = $("arAutoSt"); if (st) st.textContent = "保存しています…";
    try { const r = await api("/api/kinxs/autorenew-settings", { method: "PUT", body: JSON.stringify({ ...arFormBody(), intake: !!reload }) }); if (r.intake && r.intake.error) alert("シートを読めませんでした：" + r.intake.error);
      if (st) st.textContent = "✓ 保存しました"; if (reload) arLoad(); } catch (e) { if (st) st.textContent = "保存できませんでした：" + e.message; } };
  let arFormT = null;
  ["arReplyOwner", "arReplyFrom", "arReplyAlso", "arShareDay"].forEach((k) => { const el = $(k); if (!el) return; el.addEventListener("input", () => { clearTimeout(arFormT); arFormT = setTimeout(() => arFormSave(false), 900); }); el.addEventListener("change", () => { clearTimeout(arFormT); arFormSave(false); }); });
  ["arReplyOn", "arReplyCs"].forEach((k) => { const el = $(k); if (el) el.addEventListener("change", () => arFormSave(false)); });
  if ($("arSheet")) $("arSheet").addEventListener("change", () => arFormSave(true));
  if ($("arSheetSave")) $("arSheetSave").addEventListener("click", () => arFormSave(true));
  box.querySelectorAll("[data-ib-go]").forEach((b) => b.addEventListener("click", async () => { const sel = box.querySelector(`[data-ib-sel="${b.dataset.ibGo}"]`); if (!sel.value) { alert("企業を選んでください"); return; } try { const r = await api(`/api/kinxs/autorenew-inbox/${b.dataset.ibGo}`, { method: "POST", body: JSON.stringify({ accountId: sel.value }) }); alert(`解約の申請として取り込みました（${arJp(r.cancelMonth)}から解約済み）`); arLoad(); } catch (e) { alert(e.message); } }));
  box.querySelectorAll("[data-ib-ig]").forEach((b) => b.addEventListener("click", async () => { if (!confirm("この回答を無視しますか？（解約として扱いません）")) return; try { await api(`/api/kinxs/autorenew-inbox/${b.dataset.ibIg}`, { method: "POST", body: JSON.stringify({ ignore: true }) }); arLoad(); } catch (e) { alert(e.message); } }));
  // CSV でまとめて登録（見出し：企業名・申込番号・契約開始月・プラン・ステータス）
  if ($("arCsv")) $("arCsv").addEventListener("click", () => $("arCsvF").click());
  if ($("arCsvF")) $("arCsvF").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return; const txt = await f.text(); const rows = (typeof kxCsvParse === "function" ? kxCsvParse(txt) : txt.split(/\r?\n/).map((l) => l.split(","))).filter((r) => r.some((c) => String(c).trim()));
    if (rows.length < 2) { alert("見出しの行と、1行以上のデータが要ります"); return; }
    const h = rows[0].map((x) => String(x).replace(/[\s　]/g, "")); const ix = (re) => h.findIndex((x) => re.test(x));
    const iN = ix(/企業名|会社名|取引先/), iNo = ix(/申込番号|契約番号|サーカス/), iS = ix(/契約開始|開始月/), iP = ix(/プラン/), iSt = ix(/ステータス|状態/);
    if (iN < 0) { alert("「企業名」の列が見つかりません"); return; }
    const list = rows.slice(1).map((r) => ({ name: String(r[iN] || "").trim(), no: iNo >= 0 ? String(r[iNo] || "").trim() : "", start: iS >= 0 ? String(r[iS] || "").trim() : "", plan: iP >= 0 && String(r[iP] || "").trim() ? String(r[iP]).trim() : "自動更新", status: iSt >= 0 && String(r[iSt] || "").trim() ? String(r[iSt]).trim() : "継続中" })).filter((r) => r.name);
    if (!confirm(`${list.length}社を、自動更新の企業として登録します（kinXsの会社名と照らします）。よろしいですか？`)) { e.target.value = ""; return; }
    try { const r = await api("/api/kinxs/autorenew-import", { method: "POST", body: JSON.stringify({ rows: list }) }); const ng = (r.results || []).filter((x) => !x.ok); alert(`${(r.results || []).length - ng.length}社を登録しました${ng.length ? `\n\nkinXsに見つからなかった会社（${ng.length}社）：\n${ng.slice(0, 15).map((x) => x.name).join("\n")}` : ""}`); arLoad(); } catch (er) { alert(er.message); }
    e.target.value = "";
  });
  box.querySelectorAll("[data-ar-rc]").forEach((i) => i.addEventListener("change", () => { if ($("arRcSave")) $("arRcSave").click(); }));   // 突合の件数も、変えたらすぐ保存
  if ($("arRcSave")) $("arRcSave").addEventListener("click", async () => {
    const v = (k) => { const i = box.querySelector(`[data-ar-rc="${k}"]`); return i && i.value !== "" ? Number(i.value) : null; };
    try { await api(`/api/kinxs/autorenew-recon/${d.ym}`, { method: "PUT", body: JSON.stringify({ invoices: v("invoices"), bv: v("bv") }) }); $("arRcSt").textContent = "保存しました"; arLoad(); } catch (e) { $("arRcSt").textContent = e.message; }
  });
}
async function arSaveMonth(id, patch) {
  const cur = (ar.data.all.find((x) => String(x.id) === String(id)) || {});
  const mo = { sf: patch.sf !== undefined ? patch.sf : cur.sf, paid: patch.paid !== undefined ? patch.paid : cur.paid };
  try { await api(`/api/kinxs/autorenew/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ months: { [ar.ym]: mo }, ...(patch.paid === false ? { status: "未入金" } : {}) }) }); arLoad(); } catch (e) { alert(e.message); }
}
// 企業の登録・直す（プラン区分・申込番号・契約開始月・ステータス・解約）
async function arEdit(x) {
  const isNew = !x; let accts = [];
  if (isNew) { try { const u = await api(kxUsersUrl()); accts = (u.items || []).filter((i) => !i.archived); } catch {} }
  document.querySelectorAll(".ar-bg").forEach((n) => n.remove());
  const bg = document.createElement("div"); bg.className = "ar-bg"; bg.style.cssText = "position:fixed;inset:0;background:rgba(10,30,22,.45);z-index:9000;display:flex;align-items:flex-start;justify-content:center;padding:40px 14px;overflow:auto";
  const st = ["継続中", "解約予定", "解約済", "未入金", "停止"];
  bg.innerHTML = `<div style="background:#fff;border-radius:16px;width:min(560px,100%);padding:18px 20px">
    <b style="font-size:16px">${isNew ? "自動更新の企業を登録" : esc(x.name)}</b><div style="height:12px"></div>
    ${isNew ? `<div class="ar-f"><span>会社（kinXs）</span><input list="arAcList" id="arAc" placeholder="会社名で探す"><datalist id="arAcList">${accts.map((a) => `<option value="${esc(a.name)}"></option>`).join("")}</datalist></div>` : ""}
    <div class="ar-f"><span>プラン区分</span><select id="arPlan"><option ${!x || x.plan === "自動更新" ? "selected" : ""}>自動更新</option><option ${x && x.plan === "年間" ? "selected" : ""}>年間</option></select></div>
    <div class="ar-f"><span>申込番号（サーカス）</span><div style="display:flex;gap:6px"><input id="arNo" value="${esc((x && x.no) || "")}" placeholder="解約フォームとの突合キー" style="flex:1"><button type="button" class="hp-b" id="arNoSf">SFから読む</button></div></div>
    <div class="kx-note" id="arNoSt" style="margin:-4px 0 8px 138px"></div>
    <div class="ar-f"><span>契約開始月</span><input type="month" id="arStart" value="${esc((x && x.start) || arYmNow())}"></div>
    <div class="ar-f"><span>ステータス</span><select id="arSt">${st.map((s) => `<option value="${s}" ${(x ? x.status : "継続中") === s ? "selected" : ""}>${{ 継続中: "通常（解約の申請なし）", 解約予定: "解約の申請あり", 解約済: "解約済" }[s] || s}</option>`).join("")}</select></div>
    <div class="ar-f"><span>解約申請日</span><input type="date" id="arCxA" value="${esc((x && x.cancelApplied) || "")}"></div>
    <div class="ar-f"><span>解約希望月<small style="display:block;font-weight:400;color:#6A7A72">この月から使わない</small></span><input type="month" id="arCxW" value="${esc((x && x.cancelWish) || "")}"></div>
    <div class="ar-f"><span>申請者・連絡先</span><div style="display:flex;gap:6px"><input id="arAp" value="${esc((x && x.applicant) || "")}" placeholder="申請者名" style="flex:1"><input id="arCt" value="${esc((x && x.contact) || "")}" placeholder="メール・電話" style="flex:1"></div></div>
    <div class="ar-f"><span>メモ</span><input id="arNote" value="${esc((x && x.note) || "")}"></div>
    <div class="kx-note" id="arCxNote" style="margin:4px 0 10px"></div>
    ${!isNew ? '<details id="arHist"><summary class="kx-note" style="cursor:pointer">変更の履歴</summary><div class="kx-note">読み込み中…</div></details>' : ""}
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px"><button type="button" class="hp-b" data-x>やめる</button><button type="button" class="kx-btn kx-pri" data-save>${isNew ? "登録する" : "保存する"}</button></div></div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove(); bg.addEventListener("click", (e) => { if (e.target === bg) close(); }); bg.querySelector("[data-x]").addEventListener("click", close);
  const note = () => { const a = $("arCxA").value, w = $("arCxW").value; if (!w) { $("arCxNote").textContent = ""; return; } const dl = `${arAddYm(w, -1)}-15`; const m = !a || a <= dl ? w : arAddYm(w, 1); $("arCxNote").textContent = `解約月：${arJp(m)}末（締切 ${dl.replace(/-/g, "/")}${a && a > dl ? " を過ぎた申請なので翌月末" : " までの申請"}）`; };
  ["arCxA", "arCxW"].forEach((k) => $(k).addEventListener("input", note)); note();
  // サーカスの申込番号を SF の商談から読む（会社を選んだときは自動で）
  const readNo = async () => {
    let id = x && x.id; if (!id) { const nm = ($("arAc") || {}).value || ""; const hit = accts.find((a) => a.name === nm.trim()); id = hit && hit.id; }
    if (!id) { $("arNoSt").textContent = "先に会社を選んでください"; return; }
    $("arNoSt").textContent = "SFの商談から読んでいます…";
    try { const r = await api(`/api/kinxs/autorenew/${encodeURIComponent(id)}/circus`); const it = r.items || [];
      if (!it.length) { $("arNoSt").textContent = r.note || "SFの商談に申込番号が見つかりませんでした"; return; }
      if (!$("arNo").value) $("arNo").value = it[0].no;
      $("arNoSt").innerHTML = it.length > 1 ? `SFの「${esc(r.field || "サーカス")}」：${it.slice(0, 4).map((o) => `<a href="#" data-no="${esc(o.no)}">${esc(o.no)}</a>（${esc(o.close || "")}）`).join("・")}` : `SFの「${esc(r.field || "サーカス")}」から入れました（${esc(it[0].opp || "")}）`;
      $("arNoSt").querySelectorAll("[data-no]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); $("arNo").value = a.dataset.no; }));
    } catch (e) { $("arNoSt").textContent = e.message; }
  };
  $("arNoSf").addEventListener("click", readNo);
  if ($("arAc")) $("arAc").addEventListener("change", () => { if (!$("arNo").value) readNo(); });
  if (!isNew) api(`/api/kinxs/autorenew/${encodeURIComponent(x.id)}/history`).then((h) => { const el = bg.querySelector("#arHist div"); if (el) el.innerHTML = (h.items || []).map((i) => `${esc(String(i.at).slice(0, 16).replace("T", " "))}　${esc(i.by_user)}　${esc(Object.entries(i.change || {}).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join("・"))}`).join("<br>") || "まだありません"; }).catch(() => {});
  bg.querySelector("[data-save]").addEventListener("click", async () => {
    let id = x && x.id;
    if (isNew) { const nm = $("arAc").value.trim(); const hit = accts.find((a) => a.name === nm); if (!hit) { alert("kinXsの会社を一覧から選んでください（まだ無い会社は、SFで計上されると出てきます）"); return; } id = hit.id; }
    const body = { plan: $("arPlan").value, no: $("arNo").value, start: $("arStart").value, status: $("arSt").value, cancelApplied: $("arCxA").value, cancelWish: $("arCxW").value, applicant: $("arAp").value, contact: $("arCt").value, note: $("arNote").value };
    if (!body.cancelWish && body.status === "解約予定") { alert("解約の申請ありにするときは、解約希望月（使わなくなる最初の月）を入れてください"); return; }
    try { await api(`/api/kinxs/autorenew/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }); close(); arLoad(); } catch (e) { alert(e.message); }
  });
}
// 月次Excel（5つのシート）。ファイル名に対象月・出力日・版数
async function arExcel() {
  const d = ar.data; if (!d) return;
  if (!window.XLSX) { await new Promise((ok, ng) => { const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"; s.onload = ok; s.onerror = () => ng(new Error("Excelの部品を読み込めませんでした")); document.head.appendChild(s); }).catch((e) => alert(e.message)); if (!window.XLSX) return; }
  const counts = { bill: d.bill.length, new: (d.diff || []).filter((x) => x.kind === "新規").length, cancel: d.cancels.length, stop: (d.diff || []).filter((x) => x.kind === "停止").length };
  let ver = 1, by = window.__kxMe || ""; if (!KX_TEST) try { const r = await api("/api/kinxs/autorenew-export", { method: "POST", body: JSON.stringify({ ym: d.ym, counts }) }); ver = r.version || 1; by = r.by || by; } catch {}   // テスト中は出力の記録に残さない
  const now = new Date(Date.now() + 9 * 3600000); const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
  const nowStr = `${now.getUTCFullYear()}/${now.getUTCMonth() + 1}/${now.getUTCDate()} ${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  const X = window.XLSX, wb = X.utils.book_new();
  // 2026-11-11 仕様変更指示書：タブは「更新確定一覧」「解約確定」の2つ。A1＝○月分、2行目＝合計（SUM関数）、3行目＝見出し、4行目から
  const title = `${d.ym.slice(0, 4)}年${Number(d.ym.slice(5, 7))}月分`;
  const fmt = "#,##0";
  { const rows = d.bill; const last = 3 + rows.length;
    const aoa = [[title], ["", "", "合計", null, null], ["申込番号", "企業名", "ステータス", "売上", "原価"], ...rows.map((x) => [x.no, x.name, x.statusOn, d.price, d.cost || 3000])];
    const ws = X.utils.aoa_to_sheet(aoa);
    ws["D2"] = { t: "n", f: rows.length ? `SUM(D4:D${last})` : "0", z: fmt }; ws["E2"] = { t: "n", f: rows.length ? `SUM(E4:E${last})` : "0", z: fmt };
    for (let r = 4; r <= last; r++) { if (ws[`D${r}`]) ws[`D${r}`].z = fmt; if (ws[`E${r}`]) ws[`E${r}`].z = fmt; }
    ws["!cols"] = [{ wch: 18 }, { wch: 36 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    X.utils.book_append_sheet(wb, ws, "更新確定一覧"); }
  { const ws = X.utils.aoa_to_sheet([[title], [], ["申込番号", "企業名", "ステータス"], ...d.cancels.map((x) => [x.no, x.name, x.statusOn])]);
    ws["!cols"] = [{ wch: 18 }, { wch: 36 }, { wch: 12 }];
    X.utils.book_append_sheet(wb, ws, "解約確定"); }
  X.writeFile(wb, `${KX_TEST ? "テスト_" : ""}DOC自動更新_${d.ym.slice(0, 4)}年${Number(d.ym.slice(5, 7))}月分_${stamp}出力${ver > 1 ? `_第${ver}版` : ""}.xlsx`);
  arLoad();
}
if (VIEW === "ar") { if ($("kxPageName")) $("kxPageName").textContent = "DOC自動更新"; arLoad(); }

// ===================== メール配信（一斉配信・返信）（2026-11-10 田中さん）=====================
const ml = { users: null, sel: new Set(), targets: [], drafts: {}, prompt: "", results: {} };
async function mlLoad() {
  const box = $("vMailBody"); if (!box) return;
  box.innerHTML = '<div class="ar-empty">読み込んでいます…</div>';
  try { const ms = await api("/api/kinxs/mail/settings").catch(() => ({})); ml.mwAddr = ms.mwAddr || "support_x@mochica.jp"; ml.mwName = ms.mwName || ""; ml.mwUrl = ms.mwUrl || "https://mochica-mailwise.cybozu.com/m/mw.cgi?wid=37"; if (ml.mw === undefined) ml.mw = true; } catch {}
  try { const d = await api(kxUsersUrl()); ml.users = (d.items || []).filter((x) => !x.archived); kxSur = kxSurnameMap(ml.users.map((x) => x.cs).filter(Boolean)); mlRender(); } catch (e) { box.innerHTML = `<div class="ar-empty">読み込めませんでした：${esc(e.message)}</div>`; }
}
function mlRender() {
  const box = $("vMailBody"); const us = ml.users || [];
  const css = [...new Set(us.map((x) => kxSurname(x.cs)).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ja"));
  const phs = [...new Set(us.map((x) => x.label).filter(Boolean))];
  const f = ml.f || (ml.f = { cs: "", ph: "", q: "" });
  const view = us.filter((x) => (!f.cs || kxSurname(x.cs) === f.cs) && (!f.ph || x.label === f.ph) && (!f.q || String(x.name).includes(f.q)));
  const tg = ml.targets;
  box.innerHTML = `
  <div class="ml-step"><h3><span>1</span>送る会社を選ぶ</h3>
    <div class="ml-bar"><select id="mlCs"><option value="">CS担当：全員</option>${css.map((c) => `<option ${c === f.cs ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      <select id="mlPh"><option value="">フェーズ：すべて</option>${phs.map((c) => `<option ${c === f.ph ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>
      <input id="mlQ" class="kx-in" placeholder="会社名で探す" value="${esc(f.q)}" style="max-width:200px">
      <button type="button" class="hp-b" id="mlAll">表示中をすべて選ぶ</button><button type="button" class="hp-b" id="mlNone">選ぶのをやめる</button>
      <span class="kx-note" style="margin-left:auto">選んだ会社：<b>${ml.sel.size}</b>社（60社まで）</span></div>
    <div class="ml-list">${view.map((x) => `<label class="ml-row"><input type="checkbox" data-ml-c="${esc(x.id)}" ${ml.sel.has(x.id) ? "checked" : ""}><b>${esc(x.name)}</b><small>${esc(x.label || "")}${x.cs ? `・CS ${esc(kxSurname(x.cs))}` : ""}</small></label>`).join("") || '<div class="ar-empty">会社がありません</div>'}</div>
    <div class="ml-bar" style="margin-top:8px"><button type="button" class="kx-btn kx-pri" id="mlRead" ${ml.sel.size ? "" : "disabled"}>選んだ会社の宛先とやり取りを読む</button></div>
  </div>
  ${tg.length ? `<div class="ml-step"><h3><span>2</span>書きたいことを入れて、下書きを作る</h3>
    <textarea id="mlPrompt" class="kx-in" rows="4" style="width:100%;box-sizing:border-box" placeholder="例：12月の活用事例セミナーのご案内。日時は12/10(水)15時、オンライン。参加の可否を返信でもらいたい。返信のときは、相手の質問に答えたうえで同じ案内を添える">${esc(ml.prompt)}</textarea>
    <div class="ml-bar" style="margin-top:8px;background:#F4F8F6;border-radius:10px;padding:8px 10px"><label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="checkbox" id="mlMw" ${ml.mw ? "checked" : ""}><b>メールワイズで送る</b></label>
      <span class="kx-note">下書きをメールワイズ（${esc(ml.mwAddr || "")}）に渡して開きます。作成・返信の画面で「入れる」を押すと宛先・件名・本文が入り、送信はメールワイズで押します（Chromeの拡張機能「kinbot 補助」が要ります）${document.documentElement.dataset.kxMwExt ? "" : ' <b style="color:#B4441F">このChromeには新しい拡張機能が入っていません</b> <a href="/kinbot-ext.zip" download>ダウンロード</a>'}</span><button type="button" class="hp-b" id="mlMwEd">設定</button></div>
    <div class="ml-bar" style="margin-top:8px"><button type="button" class="kx-btn kx-pri" id="mlDraft">下書きを作る（${tg.filter((t) => t.on).length}社）</button><span class="kx-note">会社ごとに、宛先の名前・状況・返信ならそのやり取りをふまえて書きます</span></div>
    ${tg.map((t, i) => { const dr = ml.drafts[t.id] || {}; const rs = ml.results[t.id];
      return `<div class="ml-co ${t.on ? "" : "off"}"><div class="hd"><input type="checkbox" data-ml-on="${i}" ${t.on ? "checked" : ""}><b>${esc(t.name)}</b>${t.threads.some((h) => h.waiting) ? '<span class="ml-wait">返事待ちのメールあり</span>' : ""}${rs ? (rs.ok ? (rs.handoff ? '<span class="ml-res-ok">✓ メールワイズに渡しました</span>' : '<span class="ml-res-ok">✓ 送りました</span>') : `<span class="ml-res-ng">送れませんでした：${esc(rs.error || "")}</span>`) : ""}${t.error ? `<span class="ml-res-ng">${esc(t.error)}</span>` : ""}</div>
      <div class="ml-grid">
        <span>宛先</span><input class="kx-in" data-ml-to="${i}" value="${esc(t.to)}" placeholder="${t.contacts.length ? "" : "宛先のメールアドレスが見つかりません。入れてください"}" list="mlTo${i}"><datalist id="mlTo${i}">${t.contacts.map((c) => `<option value="${esc(c.email)}">${esc(c.name || "")}（${esc(c.src)}）</option>`).join("")}</datalist>
        <span>宛名</span><input class="kx-in" data-ml-nm="${i}" value="${esc(t.toName)}" placeholder="例：山田（空ならご担当者様）">
        <span>CC</span><input class="kx-in" data-ml-cc="${i}" value="${esc(t.cc)}" placeholder="任意">
        <span>送り方</span><select data-ml-th="${i}"><option value="">新しいメール</option>${t.threads.map((h) => `<option value="${esc(h.threadId)}" ${t.threadId === h.threadId ? "selected" : ""}>返信：${esc(String(h.subject).slice(0, 40))}（${esc(String(h.date).slice(5, 16))}${h.waiting ? "・返事待ち" : ""}）</option>`).join("")}</select>
        ${dr.body != null ? `<span>件名</span><input class="kx-in" data-ml-sb="${i}" value="${esc(dr.subject || "")}"><span>本文</span><textarea class="kx-in" data-ml-bd="${i}" rows="10">${esc(dr.body || "")}</textarea>` : (dr.error ? `<span></span><span class="ml-res-ng">${esc(dr.error)}</span>` : "")}
      </div></div>`; }).join("")}
    ${Object.keys(ml.drafts).length ? `<div class="ml-bar"><button type="button" class="kx-btn kx-pri" id="mlSend">${ml.mw ? "見直したのでメールワイズに渡す（" : "見直したので送る（"}${tg.filter((t) => t.on && ml.drafts[t.id] && ml.drafts[t.id].body && !(ml.results[t.id] || {}).ok).length}件）</button><span class="kx-note">${ml.mw ? "メールワイズが開きます。会社ごとに「入れる」→ メールワイズで「送信」" : "自分のGmailから1通ずつ送ります。送ったものは送信済みに残ります"}</span></div>` : ""}
  </div>` : ""}`;
  const keepF = () => { f.cs = $("mlCs").value; f.ph = $("mlPh").value; f.q = $("mlQ").value; };
  $("mlCs").onchange = () => { keepF(); mlRender(); }; $("mlPh").onchange = () => { keepF(); mlRender(); };
  $("mlQ").oninput = () => { keepF(); clearTimeout(ml._qt); ml._qt = setTimeout(() => { mlRender(); const q = $("mlQ"); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }, 300); };
  box.querySelectorAll("[data-ml-c]").forEach((c) => c.onchange = () => { if (c.checked) { if (ml.sel.size >= 60) { c.checked = false; alert("一度に選べるのは60社までです"); return; } ml.sel.add(c.dataset.mlC); } else ml.sel.delete(c.dataset.mlC); mlRender(); });
  $("mlAll").onclick = () => { for (const x of view) { if (ml.sel.size >= 60) break; ml.sel.add(x.id); } mlRender(); };
  $("mlNone").onclick = () => { ml.sel.clear(); mlRender(); };
  const keepT = () => { tg.forEach((t, i) => { const g = (k) => box.querySelector(`[data-ml-${k}="${i}"]`); if (g("to")) t.to = g("to").value; if (g("nm")) t.toName = g("nm").value; if (g("cc")) t.cc = g("cc").value; if (g("th")) t.threadId = g("th").value;
    const d = ml.drafts[t.id]; if (d && g("sb")) { d.subject = g("sb").value; d.body = g("bd").value; } }); if ($("mlPrompt")) ml.prompt = $("mlPrompt").value; };
  ml._keep = keepT;
  if ($("mlMw")) $("mlMw").onchange = () => { keepT(); ml.mw = $("mlMw").checked; mlRender(); };
  if ($("mlMwEd")) $("mlMwEd").onclick = async () => { const u = prompt("メールワイズを開くURL", ml.mwUrl || ""); if (u == null) return; const a = prompt("メールワイズの共通アドレス", ml.mwAddr || ""); if (a == null) return;
    try { await api("/api/kinxs/mail/settings", { method: "PUT", body: JSON.stringify({ mwUrl: u.trim(), mwAddr: a.trim() }) }); ml.mwUrl = u.trim() || ml.mwUrl; ml.mwAddr = a.trim() || ml.mwAddr; keepT(); mlRender(); } catch (e) { alert(e.message); } };
  $("mlRead").onclick = async () => { keepT(); const b = $("mlRead"); b.disabled = true; b.textContent = "読んでいます…（1社数秒）";
    try { const r = await api("/api/kinxs/mail/targets", { method: "POST", body: JSON.stringify({ ids: [...ml.sel] }) });
      if (!r.gmail) alert("Googleの連携（Gmail）ができていないため、やり取りは読めませんでした。宛先だけ出します");
      const old = new Map(ml.targets.map((t) => [t.id, t]));
      ml.targets = (r.items || []).map((x) => { const o = old.get(x.id); if (o) return { ...o, contacts: x.contacts || [], threads: x.threads || [] };
        const w = (x.threads || []).find((h) => h.waiting); const c0 = (x.contacts || [])[0] || {};
        const wFrom = w ? (String(w.lastFrom).match(/[^<>\s,]+@[^<>\s,]+/) || [""])[0] : "";
        return { ...x, on: true, to: wFrom || c0.email || "", toName: (w ? String(w.lastFrom).replace(/<.*$/, "").replace(/["']/g, "").trim() : (c0.name || "")).split(/[\s　]+/)[0].replace(/@.*$/, ""), cc: "", threadId: w ? w.threadId : "" }; });
    } catch (e) { alert(e.message); }
    mlRender(); };
  box.querySelectorAll("[data-ml-on]").forEach((c) => c.onchange = () => { keepT(); tg[Number(c.dataset.mlOn)].on = c.checked; mlRender(); });
  box.querySelectorAll("[data-ml-th]").forEach((c) => c.onchange = () => { keepT(); delete ml.drafts[tg[Number(c.dataset.mlTh)].id]; mlRender(); });
  if ($("mlDraft")) $("mlDraft").onclick = async () => { keepT(); if (!ml.prompt.trim()) { alert("書きたいことを入れてください"); return; }
    const on = tg.filter((t) => t.on); if (!on.length) { alert("会社を1つ以上選んでください"); return; }
    const b = $("mlDraft"); b.disabled = true; b.textContent = `下書きを作っています…（${on.length}社）`;
    try { const r = await api("/api/kinxs/mail/draft", { method: "POST", body: JSON.stringify({ prompt: ml.prompt, items: on.map((t) => ({ id: t.id, threadId: t.threadId || "", toName: t.toName })) }) });
      for (const d of (r.items || [])) ml.drafts[d.id] = d.error ? { error: d.error } : { subject: d.subject, body: d.body };
    } catch (e) { alert(e.message); }
    mlRender(); };
  if ($("mlSend")) $("mlSend").onclick = async () => { keepT();
    const go = tg.filter((t) => t.on && ml.drafts[t.id] && ml.drafts[t.id].body && !(ml.results[t.id] || {}).ok);
    const bad = go.filter((t) => !String(t.to).trim() || !String(ml.drafts[t.id].subject || "").trim()); if (bad.length) { alert(`宛先か件名が空の会社があります：\n${bad.map((t) => t.name).join("\n")}`); return; }
    if (!go.length) return;
    if (ml.mw) {   // メールワイズに渡す（拡張機能が下書きを持ち、メールワイズの作成画面に入れる）
      if (!document.documentElement.dataset.kxMwExt) { alert("このChromeに拡張機能「kinbot 補助」（新しい版）が入っていません。\n「ダウンロード」から入れ直して、このページを開き直してください。\n（入れ方：chrome://extensions →「デベロッパー モード」→ 古いものを削除 →「パッケージ化されていない拡張機能を読み込む」で、ダウンロードしたフォルダを選ぶ）"); return; }
      const list = go.map((t) => ({ id: t.id, company: t.name, to: t.to, cc: t.cc, subject: ml.drafts[t.id].subject, body: ml.drafts[t.id].body, reply: !!t.threadId, orig: t.threadId ? ((t.threads.find((h) => h.threadId === t.threadId) || {}).subject || "") : "" }));
      const res = await new Promise((resolve) => { const h = (e) => { if (e.source === window && e.data && e.data.source === "kc-zoom-ext" && e.data.type === "mw-drafts-result") { window.removeEventListener("message", h); resolve(e.data); } }; window.addEventListener("message", h); window.postMessage({ source: "kinxs", type: "mw-drafts", list, url: ml.mwUrl }, location.origin); setTimeout(() => { window.removeEventListener("message", h); resolve({ ok: false, error: "拡張機能から返事がありません" }); }, 5000); });
      if (!res.ok) { alert("メールワイズに渡せませんでした：" + (res.error || "")); return; }
      api("/api/kinxs/mail/handoff", { method: "POST", body: JSON.stringify({ items: list }) }).catch(() => {});
      for (const t of go) ml.results[t.id] = { ok: true, handoff: true };
      mlRender(); return;
    }
    if (!confirm(`${go.length}件のメールを、${ml.mw ? `メールワイズ（${ml.mwAddr}）の名前で、` : ""}自分のGmailから送ります。\n\n${go.slice(0, 12).map((t) => `・${t.name}（${t.threadId ? "返信" : "新規"}）→ ${t.to}`).join("\n")}${go.length > 12 ? `\n…ほか${go.length - 12}件` : ""}\n\n送ってよいですか？`)) return;
    const b = $("mlSend"); b.disabled = true; b.textContent = `送っています…（${go.length}件）`;
    try { const r = await api("/api/kinxs/mail/send", { method: "POST", body: JSON.stringify({ viaMailwise: !!ml.mw, items: go.map((t) => ({ id: t.id, company: t.name, to: t.to, cc: t.cc, subject: ml.drafts[t.id].subject, body: ml.drafts[t.id].body, threadId: t.threadId || "" })) }) });
      for (const x of (r.results || [])) ml.results[x.id] = x;
      alert(`${r.sent || 0}件送りました${(r.results || []).some((x) => !x.ok) ? `（送れなかったもの ${(r.results || []).filter((x) => !x.ok).length}件）` : ""}`);
    } catch (e) { alert("送れませんでした：" + e.message); }
    mlRender(); };
}
// サイドバーの「ツール」：押すと中のメニュー（メール配信・kinbotのツール）を開く。メール配信を見ているときは開いておく
(function () { const tg = $("kxToolsTog"), sub = $("kxToolsSub"); if (!tg || !sub) return;
  const set = (open) => { sub.hidden = !open; tg.setAttribute("aria-expanded", String(open)); if ($("kxToolsAr")) $("kxToolsAr").textContent = open ? "⌄" : "›"; };
  sub.querySelectorAll("[data-view]").forEach((a) => a.classList.toggle("on", a.dataset.view === VIEW));
  set(VIEW === "mail"); tg.addEventListener("click", () => set(sub.hidden)); })();
if (VIEW === "mail") { if ($("kxPageName")) $("kxPageName").textContent = "メール配信"; mlLoad(); }

// ===== 企業の詳細：SFの商談の商品にサーカスNo・検収書（2026-11-10 田中さん）=====
const _kxCircus = new Map();
// SF商談IDのコピー（2026-11-12 久野さんの要望）
document.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest(".kx-oppcp"); if (!b) return; e.preventDefault(); e.stopPropagation();
  const v = b.dataset.copy || ""; (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(() => { b.textContent = "✓"; setTimeout(() => { b.textContent = "⧉"; }, 1200); }).catch(() => { window.prompt("商談ID", v); }); });
async function kxCircusMount(bg, x) {
  const cells = [...bg.querySelectorAll("[data-circus-opp]")]; if (!cells.length) return;
  let r = _kxCircus.get(x.id);
  if (!r) { try { r = await api(`/api/kinxs/accounts/${encodeURIComponent(x.id)}/circus`); _kxCircus.set(x.id, r); } catch (e) { r = { items: [], note: e.message }; } }
  const its = r.items || []; const k15 = (v) => String(v || "").slice(0, 15);
  for (const c of cells) {
    const hit = its.find((i) => c.dataset.circusOpp && k15(i.oppId) === k15(c.dataset.circusOpp)) || its.find((i) => c.dataset.circusName && i.opp === c.dataset.circusName);
    c.textContent = hit ? hit.no : "—"; if (!hit && r.note) c.title = r.note;
  }
  x._circus = its;
}
async function kxKenshuMount(bg, x) {
  const boxes = [...bg.querySelectorAll("[data-ken-list]")]; if (!boxes.length) return;
  let d; try { d = await api(`/api/kinxs/accounts/${encodeURIComponent(x.id)}/files`); } catch (e) { boxes.forEach((b) => { b.textContent = "読めませんでした：" + e.message; }); return; }
  for (const box of boxes) kxKenshuOne(bg, x, box, d, box.dataset.kenMode || "full");
}
function kxKenshuOne(bg, x, box, d, mode) {
  const ro = !!window.KX_COPY;
  const fmt = (t) => String(t || "").slice(0, 16).replace("T", " ");
  const list = (d.items || []);
  const defNo = () => ((x._circus || [])[0] || {}).no || "";
  const tpl = (no) => `お疲れ様です。\n下記案件の検収書を回収いたしましたので\nご確認のほどよろしくお願いいたします。\n\n企業名：${x.name}\nサーカスNo：${no || ""}`;
  box.classList.remove("kx-note");
  box.innerHTML = `${list.length ? `<div class="kx-ken-box">${list.map((f) => `<div class="kx-ken-row">📄 <a href="/api/kinxs/files/${f.id}" target="_blank" rel="noopener">${esc(f.name)}</a><small>${esc(fmt(f.at))}・${esc(f.by_user || "")}${f.circus_no ? `・サーカスNo ${esc(f.circus_no)}` : ""}</small>${f.drive_link ? `<a href="${esc(f.drive_link)}" target="_blank" rel="noopener" style="font-size:12px">ドライブ ↗</a>` : ""}${f.chat_at ? '<small style="color:#0d5b47">✓ チャット済み</small>' : f.chat_error ? `<small style="color:#B4441F">チャット失敗：${esc(f.chat_error)}</small>` : ""}${ro ? "" : `<button type="button" class="hp-b" data-ken-del="${f.id}" style="margin-left:auto">消す</button>`}</div>`).join("")}</div>` : '<div class="kx-note" style="margin-bottom:8px">まだ検収書はありません</div>'}
  ${ro ? "" : mode === "list" ? '<button type="button" class="hp-b" data-ken-add>＋ 検収書を追加</button>' : ""}
  ${ro ? "" : `<div class="kx-ken-up" ${mode === "list" ? "hidden" : ""}>
    <span>PDF</span><input type="file" data-ken-file accept="application/pdf,image/*">
    <span>サーカスNo</span><input class="kx-in" data-ken-no value="${esc(defNo())}" placeholder="例：20260728BD005">
    <span>チャットで知らせる</span><label><input type="checkbox" data-ken-notify checked> 回収をチャットに送る（PDFは自分のGoogleドライブに置き、そのリンクを送ります）</label>
    <span>スペース</span><input class="kx-in" data-ken-space value="${esc(d.space || "")}" placeholder="Google ChatのスペースのURL（kinbot を追加したスペース）">
    <span>メンション</span><input class="kx-in" data-ken-men value="${esc((d.mention || []).join("、"))}" placeholder="例：相澤莉菜子、幸地美穂">
    <span>本文</span><textarea class="kx-in" data-ken-text rows="7">${esc(tpl(defNo()))}</textarea>
    <span></span><div><button type="button" class="kx-btn kx-pri" data-ken-go>検収書を保存${""}</button> <span class="kx-note" data-ken-st></span></div>
  </div>`}`;
  const addB = box.querySelector("[data-ken-add]"); if (addB) addB.onclick = () => { const up = box.querySelector(".kx-ken-up"); if (up) { up.hidden = false; addB.hidden = true; } };
  box.querySelectorAll("[data-ken-del]").forEach((b) => b.onclick = async () => { if (!confirm("この検収書を消しますか？")) return; try { await api(`/api/kinxs/files/${b.dataset.kenDel}`, { method: "DELETE" }); kxKenshuMount(bg, x); } catch (e) { alert(e.message); } });
  const no = box.querySelector("[data-ken-no]"), tx = box.querySelector("[data-ken-text]");
  if (no) no.oninput = () => { tx.value = tx.value.replace(/サーカスNo：.*$/m, `サーカスNo：${no.value.trim()}`); };
  const go = box.querySelector("[data-ken-go]"); if (!go) return;
  go.onclick = async () => {
    const fi = box.querySelector("[data-ken-file]").files[0]; if (!fi) { alert("PDFを選んでください"); return; }
    if (fi.size > 15 * 1024 * 1024) { alert("15MBまでのファイルにしてください"); return; }
    const notify = box.querySelector("[data-ken-notify]").checked; const space = box.querySelector("[data-ken-space]").value.trim();
    if (notify && !space) { alert("知らせるスペース（Google ChatのスペースのURL）を入れてください"); return; }
    const st = box.querySelector("[data-ken-st]"); go.disabled = true; st.textContent = "保存しています…";
    try {
      const data = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(new Error("ファイルを読めませんでした")); r.readAsDataURL(fi); });
      const r = await api(`/api/kinxs/accounts/${encodeURIComponent(x.id)}/files`, { method: "POST", body: JSON.stringify({ name: fi.name, mime: fi.type || "application/pdf", data, circusNo: no.value.trim(), notify, space, mention: box.querySelector("[data-ken-men]").value.split(/[、,\s]+/).filter(Boolean), text: tx.value }) });
      if (r.chat && !r.chat.ok) alert("検収書は保存しました。チャットは送れませんでした：" + (r.chat.error || ""));
      kxKenshuMount(bg, x);
    } catch (e) { alert(e.message); go.disabled = false; st.textContent = ""; }
  };
  // サーカスNo がまだ読めていなければ、読めたら入れ直す
  if (no && !no.value) setTimeout(() => { const v = defNo(); if (v && !no.value) { no.value = v; no.oninput(); } }, 2500);
}

// ===== 企業の詳細：ステータス＝道のり型（案A）（2026-11-10 田中さん：いまどこにいて、次は何か・対応事項）=====
function kxNowCard(d) {
  const x = d.item || {}; const st = d.status || {}; const info = d.info || {};
  const daysTo = (ymd) => Math.round((Date.parse(String(ymd).slice(0, 10) + "T00:00:00Z") - Date.parse(new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10) + "T00:00:00Z")) / 86400000);
  const md = (iso) => { const t = String(iso || "").slice(0, 10); return t ? `${Number(t.slice(5, 7))}/${Number(t.slice(8, 10))}` : ""; };
  const usage = st.usage || x.usage || "";
  const kenOk = x.kenshuNa || x.kenshuDone === true || String(x.kenshu || "").startsWith("回収済み");
  const mailOk = x.mailDone === true || String(x.mail || "").startsWith("送付済み");
  const pubOk = x.published === true || x.published === "true";
  const useOk = /^活用：(公開掲載|限定公開)/.test(usage);
  const koOk = !!(d.kickoffAt && Date.parse(d.kickoffAt) <= Date.now());
  const steps = [
    { k: "受注", ok: !!info.booked, sub: info.booked ? `${md(info.booked)} ✓` : "—" },
    { k: "キックオフ", ok: koOk, sub: d.kickoffAt ? `${md(d.kickoffAt)}${koOk ? " ✓" : "予定"}` : "まだ" },
    { k: "検収書", ok: kenOk, sub: x.kenshuNa ? "対象外" : kenOk ? "✓" : String(x.kenshu || "").startsWith("依頼済み") ? "依頼済み" : "まだ" },
    { k: "納品メール", ok: mailOk, sub: mailOk ? "✓" : "まだ" },
    { k: "掲載", ok: pubOk, sub: pubOk ? "✓" : "まだ" },
    { k: "活用", ok: useOk, sub: usage ? usage.replace(/^活用：/, "") : "—" },
    { k: "更新", ok: false, sub: x.renew ? x.renew.replace("-", "/") : "—" },
  ];
  // いまここ＝いちばん進んだ段の次（前の段が記録されていなくても進める。飛ばした段は「未記録」）（2026-11-11 田中さん）
  let lastOk = -1; for (let i = 0; i < 6; i++) if (steps[i].ok) lastOk = i;
  let cur = steps.findIndex((s0, i) => i > lastOk && !s0.ok); if (cur < 0) cur = 6;
  const head = { 0: "受注の手続き中", 1: "キックオフの前", 2: "納品の手前（検収書の回収待ち）", 3: "納品メールを送る段階", 4: "掲載の確認待ち", 5: "活用を始めるところ", 6: "活用中（次は更新）" }[cur] || "—";
  const since = info.booked ? Math.max(0, Math.floor((Date.now() - Date.parse(info.booked + "T00:00:00+09:00")) / 86400000)) : null;
  // 対応事項（急ぐ順）。act＝その場で片づけるボタンの種類
  const todo = [];
  for (const a of (x.alerts || [])) todo.push({ lv: 1, t: a.rule, s: a.detail, tag: "要注意", act: a.rule === "更新月接近" ? "renew" : a.rule === "NA期限切れ" ? "na" : "" });
  if (!kenOk) todo.push({ lv: cur === 2 ? 1 : 2, t: String(x.kenshu || "").startsWith("依頼済み") ? "検収書の回収を待つ（依頼済み）" : "検収書を回収する", s: since != null ? `受注から${since}日` : "", tag: "納品", act: "ken", sub: "回収できたらPDFを入れると、相澤さん・幸地さんにチャットで知らせます" });
  if (x.na) { const l = x.naDue ? daysTo(x.naDue) : null; const when = x.naAt ? new Date(x.naAt).toLocaleString("ja-JP", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }) : x.naDue ? md(x.naDue) : "日時未定";
    const n = ((x.naDetail || {}).agenda || []).length;
    todo.push({ lv: l != null && l < 0 ? 1 : l != null && l <= 7 ? 2 : 3, t: `${x.na}（${when}）の準備`, s: `${x.naType || "次回アクション"}${n ? `　確認すること${n}つ` : ""}`, right: l == null ? "" : l < 0 ? `${-l}日過ぎ` : `あと${l}日`, tag: "次回アクション", act: "na" }); }
  else todo.push({ lv: 2, t: "次回アクションを決める", s: "議事録・メールから読み取れます", tag: "次回アクション", act: "read" });
  const nd = x.naDetail || {}; const sm = x.mtgSummary || {};
  for (const h of (Array.isArray(nd.homework) ? nd.homework : (sm.homework || [])).filter((h) => h && h.state !== "完了" && (h.task || h.t)).slice(0, 6)) {
    const l = h.due ? daysTo(h.due) : null;
    todo.push({ lv: l != null && l < 0 ? 1 : 3, t: h.task || h.t, s: `${h.who || ""}の宿題${h.due ? `　${md(h.due)}まで` : ""}`, right: l != null && l < 0 ? `${-l}日過ぎ` : "", tag: "宿題", act: "na" }); }
  if (!mailOk) todo.push({ lv: 3, t: "納品メールを送る", s: kenOk ? "" : "検収書のあと", tag: "納品", act: "mail" });
  if (!pubOk && kenOk) todo.push({ lv: 3, t: "掲載を確認する", s: "", tag: "納品", act: "pub" });
  if (!(x.alerts || []).some((a) => a.rule === "更新月接近") && ["Z", ""].includes(x.rank || "")) todo.push({ lv: 4, t: "更新確度を決める", s: `いま ${x.rank || "Z"}（未判定）`, right: x.renew ? `${x.renew.replace("-", "/")}まで` : "", tag: "更新", act: "renew" });
  todo.sort((a, b) => a.lv - b.lv);
  const top = todo[0];
  const btn = (act, pri) => ({
    ken: [["ken-pdf", "PDFを入れる"], ["ken-done", "回収済みにする"], ["ken-na", "対象外"]], mail: [["mail-done", "送付済みにする"]], pub: [["pub-done", "掲載を確認した"]],
    na: [["na-open", "中身を開く"]], read: [["read", "議事録・メールから読み取る"]], renew: [["renew", "確度を決める"]],
  }[act] || []).map(([a, l], i) => `<button type="button" class="${pri && i === 0 ? "kx-a-pri" : "kx-a-sec"}" data-now="${a}">${esc(l)}</button>`).join("");
  const chk = (t) => ({ ken: "ken-done", mail: "mail-done", pub: "pub-done" })[t.act];
  const touchTxt = x.lastTouch ? `${x.sinceTouch}日前` : "—";
  return `<section class="kx-a-where">
      <div class="kx-a-row"><span class="kx-a-q">いまどこ？</span><b class="kx-a-head">${esc(head)}</b>${since != null ? `<span class="kx-a-since">受注から ${since}日</span>` : ""}</div>
      <div class="kx-a-steps">${steps.map((s0, i) => { const key = { 検収書: "kenshu_done", 納品メール: "mail_done", 掲載: "published" }[s0.k]; const cls = `kx-a-st ${s0.ok ? "ok" : i === cur ? "now" : ""}`; const inner = `<i></i><b>${esc(s0.k)}</b><small>${i === cur ? "いまここ" : esc(s0.sub)}</small>`;
        const skip = !s0.ok && i < cur && i < 6;   // 先の段は済んでいるのに、記録がない段
        const cls2 = skip ? `${cls} skip` : cls; const inner2 = skip ? `<i></i><b>${esc(s0.k)}</b><small>未記録</small>` : inner;
        if (s0.k === "キックオフ" && !s0.ok) return `<button type="button" class="${cls2} kx-a-stb" data-step-ko="1" title="押すとキックオフを実施済みにします（実施日＝今日）">${inner2}</button>`;
        return key && !(s0.k === "検収書" && x.kenshuNa) ? `<button type="button" class="${cls2} kx-a-stb" data-step="${key}" data-ok="${s0.ok ? 1 : 0}" title="${s0.ok ? "押すと未完了に戻します" : "押すと済みにします"}">${inner2}</button>` : `<div class="${cls2}">${inner2}</div>`; }).join("")}</div>
      <div class="kx-note" style="margin-top:-6px">検収書・納品メール・掲載は、道のりを押すと済みにできます</div>
    </section>
    ${top ? `<section class="kx-a-next"><div class="kx-a-nt"><small>次にやること</small><b>${esc(top.t)}</b>${top.sub || top.s ? `<span>${esc(top.sub || top.s)}</span>` : ""}</div><div class="kx-a-nb">${btn(top.act, true)}</div></section>` : ""}
    ${cur === 2 && !x.kenshuNa ? `<section class="kx-sec" data-ken-sec-st><div class="lb">検収書を入れる<span class="kx-note" style="margin-left:8px">PDFを残して、回収をチャットで知らせます</span></div><div data-ken-list data-ken-mode="full" class="kx-note">読み込んでいます…</div></section>` : ""}
    <section class="kx-a-todo"><div class="kx-a-th"><b>対応事項</b><small>${todo.length}件</small></div>
      ${todo.map((t) => `<div class="kx-a-it ${t.lv === 1 ? "hi" : ""}">${chk(t) ? `<input type="checkbox" aria-label="${esc(t.t)}を済みにする" data-now="${chk(t)}">` : `<span class="kx-a-dot" aria-hidden="true"></span>`}
        <div class="kx-a-tx"><b>${esc(t.t)}</b><small>${t.tag ? `<em>${esc(t.tag)}</em>` : ""}${esc(t.s || "")}</small></div>
        ${t.right ? `<span class="kx-a-r ${t.lv === 1 ? "hi" : ""}">${esc(t.right)}</span>` : t.lv === 1 ? '<span class="kx-a-r hi">急ぎ</span>' : ""}
        ${!chk(t) && t.act ? `<span class="kx-a-ib">${btn(t.act, false).replace(/<button[^>]*data-now="(ken-pdf)"[^>]*>[^<]*<\/button>/, "")}</span>` : ""}</div>`).join("") || '<div class="kx-note">いまの対応事項はありません</div>'}
    </section>
    <section class="kx-a-cards">
      <div><small>活用</small><b>${esc(usage ? usage.replace(/^活用：/, "") : "未入力")}</b></div>
      <div><small>最終接触</small><b class="${x.sinceTouch > 30 ? "warn" : ""}">${esc(touchTxt)}</b></div>
      <div><small>更新月</small><b>${esc(x.renew ? `${x.renew.replace("-", "/")}${x.left != null ? `（${x.left < 0 ? `${-x.left}日過ぎ` : `あと${x.left}日`}）` : ""}` : "—")}</b></div>
      <div><small>更新確度</small><b>${esc(x.rank || "Z")}${!x.rank || x.rank === "Z" ? "（未判定）" : ""}</b></div>
    </section>
    ${cur !== 2 && !x.kenshuNa ? `<section class="kx-sec" data-ken-sec><div class="lb">検収書<span class="kx-note" style="margin-left:8px">入れたPDFと、あとから足すとき</span></div><div data-ken-list data-ken-mode="list" class="kx-note">読み込んでいます…</div></section>` : ""}`;
}
// 「次にやること」「対応事項」のボタン：今ある欄のボタンを押す・開く（保存のしかたは今までと同じ）
function kxNowMount(bg) {
  const pane = bg.querySelector('[data-pane="info"]'); if (!pane) return;
  const tog = (key, v) => { const b = bg.querySelector(`[data-tog="${key}"] button[data-v="${v}"]`); if (b) b.click(); };
  const ob = bg.querySelector("[data-rank-open]"), pop = bg.querySelector("[data-rank-pop]");
  if (ob && pop && !ob.dataset.wired) { ob.dataset.wired = "1"; ob.addEventListener("click", () => { pop.hidden = !pop.hidden; ob.setAttribute("aria-expanded", String(!pop.hidden)); }); }
  pane.querySelectorAll("[data-step-ko]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("キックオフを実施済みにしますか？（実施日は今日で入れます。あとで企業情報から直せます）")) return;
    const id0 = (bg.querySelector("[data-na-box]") || {}).dataset?.naBox || bg.dataset.kxId;
    try { await api(`/api/kinxs/accounts/${encodeURIComponent(id0)}`, { method: "PUT", body: JSON.stringify({ kickoff_on: new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10) }) }); openDetail(id0, { bg, tab: "info" }); } catch (e) { alert(e.message); }
  }));
  pane.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
    const ok = b.dataset.ok === "1"; const name = b.querySelector("b").textContent;
    if (ok) { if (confirm(`「${name}」を未完了に戻しますか？`)) tog(b.dataset.step, "false"); } else tog(b.dataset.step, "true");
  }));
  const openNa = () => { const tb = bg.querySelector('[data-tab="task"]'); if (tb) tb.click(); const dt = bg.querySelector("details[data-na-more]"); if (dt) { dt.open = true; setTimeout(() => dt.scrollIntoView({ behavior: "smooth", block: "start" }), 60); } };
  pane.querySelectorAll("[data-now]").forEach((el) => el.addEventListener(el.tagName === "INPUT" ? "change" : "click", () => {
    const a = el.dataset.now;
    if (a === "ken-done") return tog("kenshu_done", "true");
    if (a === "ken-na") { if (confirm("この会社は検収書を回収しない（対象外）にしますか？")) tog("kenshu_done", "na"); return; }
    if (a === "mail-done") return tog("mail_done", "true");
    if (a === "pub-done") return tog("published", "true");
    if (a === "na-open") return openNa();
    if (a === "read") { const r = bg.querySelector("[data-read-all]"); if (r) { const dt = r.closest("details"); if (dt) dt.open = true; r.scrollIntoView({ behavior: "smooth", block: "center" }); r.click(); } return; }
    if (a === "renew") { const ob = bg.querySelector("[data-rank-open]"); if (ob) { ob.scrollIntoView({ behavior: "smooth", block: "center" }); const pop = bg.querySelector("[data-rank-pop]"); if (pop && pop.hidden) ob.click(); } return; }
    if (a === "ken-pdf") { const here = bg.querySelector("[data-ken-sec-st]"); if (here) { here.scrollIntoView({ behavior: "smooth", block: "start" }); const f = here.querySelector("[data-ken-file]"); if (f) setTimeout(() => f.click(), 350); return; }
      const k = bg.querySelector("[data-ken-sec]"); if (k) { k.scrollIntoView({ behavior: "smooth", block: "start" }); const b = k.querySelector("[data-ken-add]"); if (b) b.click(); } }
  }));
}

// 企業情報：販売区分・サーカスNo・初期費用（SFの受注商談から）（2026-11-11 CSの要望）
const _kxSalesC = new Map();
async function kxSalesMount(bg, x) {
  const cells = { channel: bg.querySelector('[data-sales="channel"]'), circus: bg.querySelector('[data-sales="circus"]'), initial: bg.querySelector('[data-sales="initial"]') };
  if (!cells.channel) return;
  let d = _kxSalesC.get(x.id);
  if (!d) { try { d = await api(`/api/kinxs/accounts/${encodeURIComponent(x.id)}/sales`); if (d && d.ok) _kxSalesC.set(x.id, d); } catch (e) { d = { error: e.message }; } }
  const none = '<span class="kx-none">SFに無し</span>';
  if (!d || d.none || d.error) { const m = d && d.error ? `<span class="kx-note">${esc(d.error)}</span>` : '<span class="kx-none">SFの会社ではありません</span>'; Object.values(cells).forEach((c) => { if (c) c.innerHTML = m; }); return; }
  const ch = d.channel === "社内代理店" ? "社内代理店（PS）" : d.channel;
  cells.channel.innerHTML = ch ? `<b class="kx-sales-chip ${d.channel === "直販" ? "dr" : "ps"}">${esc(ch)}</b>` : none;
  cells.circus.innerHTML = d.circus ? `<b>${esc(d.circus)}</b>${(d.circusAll || []).length > 1 ? ` <small class="kx-note">（ほか ${esc(d.circusAll.filter((c) => c !== d.circus).join("・"))}）</small>` : ""}` : none;
  cells.initial.innerHTML = d.initial && d.initial.has
    ? `<b class="kx-sales-chip yes">あり</b> <small>${d.initial.items.map((it) => `${esc(String(it.name).replace(/【ＤＯＣ】|【DOC】/, ""))}${it.price != null ? ` ${Number(it.price).toLocaleString()}円` : ""}`).join("・")}</small>`
    : '<b class="kx-sales-chip no">なし</b> <small class="kx-note">（アチコチバースのみ）</small>';
}

// ===== 企業の詳細「タスク」：この会社のタスク（2026-11-11 田中さん）=====
async function kxCTaskMount(bg, x) {
  const box = bg.querySelector("[data-ctask]"); if (!box) return;
  const ro = !!window.KX_COPY;
  const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const addD = (n) => new Date(Date.parse(today + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  const wk = addD(7);
  const md = (v) => v ? `${Number(v.slice(5, 7))}/${Number(v.slice(8, 10))}` : "";
  const srcCls = (s0) => /議事録/.test(s0) ? "mt" : /メール|Gmail|メールワイズ/.test(s0) ? "ml" : /チャット|Chat/.test(s0) ? "ch" : /Claude/.test(s0) ? "cl" : /手入力/.test(s0) ? "mn" : "kx";
  // 出どころの札の言葉（2026-11-12 田中さん：どこから取ってきたタスクか見えるように）
  const srcLabel = (s0) => { const v = String(s0 || ""); const auto = /自動/.test(v) ? "（自動）" : "";
    if (/メールワイズ/.test(v)) return "メールワイズ" + auto; if (/Gmail|メール/.test(v)) return "Gmail" + auto; if (/議事録/.test(v)) return "議事録" + auto;
    if (/チャット|Chat/.test(v)) return "チャット"; if (/Claude/.test(v)) return "Claude"; if (/手入力/.test(v)) return "手入力"; if (/kinXs/.test(v)) return "kinXsのお知らせ"; return v || "手入力"; };
  const naSrc = String(x.naSource || ""); const naSrcLabel = /議事録/.test(naSrc) ? "議事録" : /Gmail|メール/.test(naSrc) ? "Gmail" : "手入力";
  const openNa = () => { const dt = bg.querySelector("details[data-na-more]"); if (dt) { dt.open = true; dt.scrollIntoView({ behavior: "smooth", block: "start" }); } };
  let open = { done: false };
  let people = [], me = "";
  try { const pp = await api("/api/kinxs/people"); people = pp.items || []; me = pp.me || ""; } catch {}
  const whoName = (v) => { const s0 = String(v || ""); if (/@/.test(s0)) { const p0 = people.find((q) => q.email === s0.toLowerCase()); return p0 ? (kxSurname(p0.name) || p0.name) : s0.split("@")[0]; } return kxSurname(s0) || s0; };
  { const sel = bg.querySelector("[data-ctask-who]"), wl = bg.querySelector("[data-ctask-wl]");
    if (sel) { sel.innerHTML = people.map((p0) => `<option value="${esc(p0.email)}" ${p0.email === me ? "selected" : ""}>${esc(p0.name)}${p0.email === me ? "（自分）" : ""}</option>`).join("");
      sel.addEventListener("change", () => { const p0 = people.find((q) => q.email === sel.value); if (wl) wl.textContent = sel.value === me ? "自分" : (kxSurname(p0 ? p0.name : "") || (p0 ? p0.name : "")); }); } }
  const load = async () => {
    let d; try { d = await api(`/api/kinxs/accounts/${encodeURIComponent(x.id)}/tasks`); } catch (e) { box.textContent = "読めませんでした：" + e.message; return; }
    // 次回アクションも、この会社のタスクの1つとして並べる
    const naDue = x.naAt ? new Date(new Date(x.naAt).getTime() + 9 * 3600000).toISOString().slice(0, 10) : (x.naDue || "");
    const naTime = x.naAt ? new Date(new Date(x.naAt).getTime() + 9 * 3600000).toISOString().slice(11, 16) : "";
    const list = [...(x.na ? [{ key: "na", na: true, title: x.na, due: naDue, time: naTime, status: "未着手", src: "次回アクション", kind: x.naType || "" }] : []), ...(d.items || [])];
    const bucket = (t) => t.status === "完了" ? "done" : !t.due ? "none" : t.due < today ? "late" : t.due === today ? "today" : t.due <= wk ? "week" : "later";
    const G = [["late", "期限切れ"], ["today", "今日"], ["week", "1週間以内"], ["later", "あとで"], ["none", "日付なし"], ["done", "完了"]];
    box.classList.remove("kx-note");
    const row = (t, i) => {
      const b = bucket(t); const late = b === "late" ? Math.round((Date.parse(today) - Date.parse(t.due)) / 86400000) : 0;
      return `<div class="kx-tm-row ${t.status === "完了" ? "done" : ""} ${t.na ? "na" : ""}">
        ${ro ? "" : `<button type="button" class="kx-tm-chk" data-tm-done="${i}" title="${t.status === "完了" ? "未完了に戻す" : "済みにする"}" aria-label="済みにする">${t.status === "完了" ? "✓" : ""}</button>`}
        <div class="kx-tm-body" ${t.na ? 'data-tm-na role="button" tabindex="0" title="押すと次回アクションの中身を開きます"' : ""}>
          <div class="kx-tm-title">${esc(t.title)}</div>
          <div class="kx-tm-meta">${t.na ? `<span class="kx-tm-tag na">次回アクション</span><span class="kx-tm-tag ${srcCls(naSrcLabel)}" title="どこから読み取ったか">${esc(naSrcLabel)}</span>` : `<span class="kx-tm-tag ${srcCls(t.src)}" title="どこから取ってきたタスクか">${esc(srcLabel(t.src))}</span>`}${t.kind && t.na ? `<span class="kx-tm-tag kx">${esc(t.kind)}</span>` : ""}${t.detail ? `<span>${esc(t.detail)}</span>` : ""}${t.link ? `<a href="${esc(t.link)}" target="_blank" rel="noopener">開く ↗</a>` : ""}</div>
        </div>
        ${t.na ? (() => { const csEm = (people.find((p0) => kxSurname(p0.name) === kxSurname(x.cs || "")) || {}).email || ""; const curEm = x.naOwner || csEm; const curP = people.find((p0) => p0.email === curEm);
            const nm = curP ? (kxSurname(curP.name) || curP.name) : (kxSurname(x.cs || "") || "CS未定");
            return ro ? `<span class="kx-tm-who" title="担当">${esc(nm)}</span>` : `<label class="kx-tm-who" title="次回アクションの担当を変える（ふだんはCS担当）">${esc(nm)}${x.naOwner && x.naOwner !== csEm ? "<em>託</em>" : ""}<select data-tm-naown="1">${people.map((p0) => `<option value="${esc(p0.email)}" ${p0.email === curEm ? "selected" : ""}>${esc(p0.name)}${p0.email === csEm ? "（CS担当）" : ""}</option>`).join("")}</select></label>`; })() : (ro || !t.id ? `<span class="kx-tm-who" title="担当">${esc(whoName(t.ownerName || t.owner))}</span>` : `<label class="kx-tm-who" title="担当を変える（託す）${t.byName ? `／${esc(whoName(t.byName))}さんが託した` : ""}">${esc(whoName(t.ownerName || t.owner))}${t.byName ? '<em>託</em>' : ""}<select data-tm-who="${i}">${people.map((p0) => `<option value="${esc(p0.email)}" ${p0.email === String(t.owner || "").toLowerCase() ? "selected" : ""}>${esc(p0.name)}</option>`).join("")}</select></label>`)}
        ${ro ? `<span class="kx-tm-due ${b}">${t.due ? md(t.due) : ""}</span>` : `<label class="kx-tm-due ${b}" title="期日を変える">${t.due ? `${md(t.due)}${t.time ? ` ${t.time}` : ""}${late ? `<em>${late}日過ぎ</em>` : ""}` : "期日"}<input type="date" data-tm-due="${i}" value="${esc(t.due || "")}"></label>`}
        ${ro || t.na ? "" : `<button type="button" class="kx-tm-x" data-tm-del="${i}" title="消す" aria-label="消す">×</button>`}
      </div>`;
    };
    const idx = new Map(list.map((t, i) => [t, i]));
    box.innerHTML = list.length ? G.map(([k, l]) => { const g = list.filter((t) => bucket(t) === k); if (!g.length) return "";
        const fold = k === "done"; return `<div class="kx-tm-grp ${k}"><button type="button" class="kx-tm-gh" ${fold ? "data-tm-fold" : "disabled"}>${fold ? (open.done ? "▾ " : "▸ ") : ""}${l}<span>${g.length}</span></button>${fold && !open.done ? "" : g.map((t) => row(t, idx.get(t))).join("")}</div>`; }).join("")
      : '<div class="kx-tm-empty">この会社のタスクはまだありません。上の欄から追加できます。Claudeに「○○社のタスクを作って」と頼んでも入ります。</div>';
    const upd = async (t, body) => {
      if (t.na) {
        if (body.status === "完了") { await api(`/api/kinxs/accounts/${encodeURIComponent(x.id)}`, { method: "PUT", body: JSON.stringify({ na_text: "", na_at: "" }) });
          box.insertAdjacentHTML("beforebegin", '<div class="kx-note" data-na-reading style="padding:6px 12px">✓ 済みにしました。メール・議事録から次の次回アクションを読んでいます（30秒ほど）…</div>');
          setTimeout(() => { if (bg.isConnected) openDetail(x.id, { bg, tab: "task" }); }, 35000); }
        else if (body.due !== undefined) await api(`/api/kinxs/accounts/${encodeURIComponent(x.id)}`, { method: "PUT", body: JSON.stringify({ na_at: body.due ? `${body.due}T${t.time || "10:00"}` : "" }) });
        x.na = body.status === "完了" ? "" : x.na; if (body.due !== undefined) { x.naDue = body.due; x.naAt = body.due ? new Date(`${body.due}T${t.time || "10:00"}:00+09:00`).toISOString() : ""; }
        return;
      }
      if (t.id) await api(`/api/kinxs/accounts/${encodeURIComponent(x.id)}/tasks/${t.id}`, { method: "PUT", body: JSON.stringify(body) });
      else await api("/api/kinxs/tasks/state", { method: "POST", body: JSON.stringify({ key: t.key, title: t.title, accountId: x.id, account: x.name, src: t.src, status: body.status || t.status, ...(body.deleted ? { deleted: true } : {}), ...(body.due !== undefined ? { due: body.due } : {}) }) });
    };
    box.querySelectorAll("[data-tm-done]").forEach((b) => b.addEventListener("click", async () => { const t = list[Number(b.dataset.tmDone)];
      if (t.na && !confirm("次回アクションを済みにしますか？（次回アクションが空になります）")) return;
      b.disabled = true; try { await upd(t, { status: t.status === "完了" ? "未着手" : "完了" }); load(); } catch (e) { alert(e.message); b.disabled = false; } }));
    box.querySelectorAll("[data-tm-due]").forEach((inp) => { inp.addEventListener("click", () => { try { inp.showPicker(); } catch {} });
      inp.addEventListener("change", async () => { const t = list[Number(inp.dataset.tmDue)]; try { await upd(t, { due: inp.value || "" }); load(); } catch (e) { alert(e.message); } }); });
    box.querySelectorAll("[data-tm-naown]").forEach((sel) => sel.addEventListener("change", async () => {
      const csEm = (people.find((p0) => kxSurname(p0.name) === kxSurname(x.cs || "")) || {}).email || "";
      try { await api(`/api/kinxs/accounts/${encodeURIComponent(x.id)}`, { method: "PUT", body: JSON.stringify({ na_owner: sel.value === csEm ? "" : sel.value }) }); x.naOwner = sel.value === csEm ? "" : sel.value; load(); } catch (e) { alert(e.message); } }));
    box.querySelectorAll("[data-tm-who]").forEach((sel) => sel.addEventListener("change", async () => { const t = list[Number(sel.dataset.tmWho)];
      try { await api(`/api/kinxs/accounts/${encodeURIComponent(x.id)}/tasks/${t.id}`, { method: "PUT", body: JSON.stringify({ assignee: sel.value }) }); load(); } catch (e) { alert(e.message); } }));
    box.querySelectorAll("[data-tm-del]").forEach((b) => b.addEventListener("click", async () => { const t = list[Number(b.dataset.tmDel)]; if (!confirm(`「${t.title}」を消しますか？`)) return; try { await upd(t, { deleted: true }); load(); } catch (e) { alert(e.message); } }));
    box.querySelectorAll("[data-tm-na]").forEach((el) => { el.addEventListener("click", openNa); el.addEventListener("keydown", (e) => { if (e.key === "Enter") openNa(); }); });
    const fb = box.querySelector("[data-tm-fold]"); if (fb) fb.addEventListener("click", () => { open.done = !open.done; load(); });
  };
  const add = bg.querySelector("[data-ctask-add]"), tIn = bg.querySelector("[data-ctask-t]"), dIn = bg.querySelector("[data-ctask-d]");
  if (add) {
    const dl = dIn && dIn.closest("label"); if (dIn) { dIn.addEventListener("click", () => { try { dIn.showPicker(); } catch {} }); dIn.addEventListener("change", () => { if (dl) dl.firstChild.textContent = dIn.value ? md(dIn.value) : "期日"; }); }
    const go = async () => { const title = tIn.value.trim(); if (!title) { tIn.focus(); return; } add.disabled = true;
      const wSel = bg.querySelector("[data-ctask-who]"); const assignee = wSel && wSel.value && wSel.value !== me ? wSel.value : "";
      try { await api("/api/kinxs/tasks", { method: "POST", body: JSON.stringify({ title, accountId: x.id, accountName: x.name, due: dIn.value || "", ...(assignee ? { assignee } : {}) }) }); tIn.value = ""; dIn.value = ""; if (dl) dl.firstChild.textContent = "期日"; load(); } catch (e) { alert(e.message); } add.disabled = false; tIn.focus(); };
    add.addEventListener("click", go); tIn.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) go(); });
  }
  load();
}
// ===== 活動記録「案内済み・未案内」（2026-11-11）=====
const KX_GUIDE_C = [["invoice", "請求書", "送り方・支払い期日（翌月払い）"], ["kenshu", "検収書", "いつ・どう回収するか"], ["schedule", "納品までのスケジュール", "取材から約1か月で納品・全体で2か月ほど"], ["kickoff", "キックオフMTG・取材の日程と準備", ""], ["account", "アカウントの作成・AIの学習", ""], ["renew", "更新・解約のきまり", "自動更新なら解約の締切も"]];
function kxGuideSec(d) {
  return `<section class="kx-sec" data-guide-sec><div class="lb" style="display:flex;align-items:center;gap:8px">お客様への案内<span class="kx-note">営業・CSが説明したかどうか</span>${window.KX_COPY ? "" : '<button type="button" class="hp-b" data-guide-read style="margin-left:auto">議事録から読み取る</button>'}</div><div data-guide></div></section>`;
}
function kxGuideMount(bg, x, d) {
  const box = bg.querySelector("[data-guide]"); if (!box) return;
  let g = { ...(d.guide || {}) }; const ro = !!window.KX_COPY;
  const draw = () => {
    const todo = KX_GUIDE_C.filter(([k]) => !g[k] || g[k].state !== "done"), done = KX_GUIDE_C.filter(([k]) => g[k] && g[k].state === "done");
    const card = ([k, n, h], isDone) => `<div class="kx-gd-it ${isDone ? "done" : ""}"><div class="kx-gd-tx"><b>${esc(n)}</b>${h ? `<small>${esc(h)}</small>` : ""}${g[k] && g[k].by ? `<small class="kx-gd-by">${esc(g[k].by)}${g[k].why ? `：${esc(g[k].why)}` : ""}</small>` : ""}</div>${ro ? "" : `<button type="button" class="hp-b" data-gd="${k}" data-to="${isDone ? "todo" : "done"}">${isDone ? "← 未案内に戻す" : "案内済み →"}</button>`}</div>`;
    box.innerHTML = `<div class="kx-gd-cols"><div class="kx-gd-col"><div class="kx-gd-h todo">未案内 <span>${todo.length}</span></div>${todo.map((it) => card(it, false)).join("") || '<div class="kx-note">ぜんぶ案内済みです</div>'}</div>
      <div class="kx-gd-col"><div class="kx-gd-h done">案内済み <span>${done.length}</span></div>${done.map((it) => card(it, true)).join("") || '<div class="kx-note">まだありません</div>'}</div></div>`;
    box.querySelectorAll("[data-gd]").forEach((b) => b.addEventListener("click", async () => { b.disabled = true; try { const r = await api(`/api/kinxs/accounts/${encodeURIComponent(x.id)}/guide`, { method: "PUT", body: JSON.stringify({ key: b.dataset.gd, state: b.dataset.to }) }); g = r.guide || g; draw(); } catch (e) { alert(e.message); b.disabled = false; } }));
  };
  draw();
  const rb = bg.querySelector("[data-guide-read]");
  if (rb) rb.addEventListener("click", async () => { rb.disabled = true; rb.textContent = "読んでいます…";
    try { const r = await api(`/api/kinxs/accounts/${encodeURIComponent(x.id)}/guide/read`, { method: "POST", body: "{}" }); if (r.none) alert("この会社の議事録が見つかりませんでした"); else { g = r.guide || g; draw(); } }
    catch (e) { alert(e.message); } rb.disabled = false; rb.textContent = "議事録から読み取る"; });
}

// ===== 会社を探す（会社名・担当者・電話・メール）（2026-11-12）=====
(function () {
  const inp = document.getElementById("kxFindQ"), list = document.getElementById("kxFindList"); if (!inp || !list) return;
  let tm = null, seq = 0, sel = -1, rows = [];
  const hide = () => { list.hidden = true; sel = -1; };
  const draw = () => {
    list.innerHTML = rows.length ? rows.map((r, i) => `<div class="kx-find-it${i === sel ? " on" : ""}" data-id="${esc(r.id)}"><b>${esc(r.name)}</b><small>${esc([r.cs && "CS " + (kxSurname(r.cs) || r.cs), r.phase, r.archived ? "アーカイブ" : ""].filter(Boolean).join("・"))}</small><span class="hit">${esc(r.hit)}</span></div>`).join("") : '<div class="kx-find-none">見つかりませんでした</div>';
    list.hidden = false;
    list.querySelectorAll("[data-id]").forEach((el) => el.addEventListener("mousedown", (e) => { e.preventDefault(); hide(); inp.blur(); openDetail(el.dataset.id); }));
  };
  inp.addEventListener("input", () => {
    clearTimeout(tm); const q = inp.value.trim(); if (q.length < 2) { hide(); return; }
    tm = setTimeout(async () => { const my = ++seq; try { const d = await api(`/api/kinxs/search?q=${encodeURIComponent(q)}`); if (my !== seq) return; rows = d.items || []; sel = rows.length ? 0 : -1; draw(); } catch { } }, 250);
  });
  inp.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(rows.length - 1, sel + 1); draw(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === "Enter" && rows[sel]) { e.preventDefault(); const id = rows[sel].id; hide(); inp.blur(); openDetail(id); }
    else if (e.key === "Escape") hide();
  });
  inp.addEventListener("blur", () => setTimeout(hide, 150));
  document.addEventListener("keydown", (e) => { if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return; const tg = e.target; if (tg && (tg.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(tg.tagName))) return; e.preventDefault(); inp.focus(); inp.select(); });
  inp.addEventListener("focus", () => { if (rows.length && inp.value.trim().length >= 2) draw(); });
})();

// 電話フォローのヘッダーの部品は、ほかの画面では隠す（2026-11-13）
setInterval(() => { const hc = document.getElementById("kxHeadCall"); if (hc && typeof VIEW !== "undefined" && VIEW !== "call" && !hc.hidden) hc.hidden = true; }, 800);
