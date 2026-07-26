// home.js — 日付ごとの商談一覧（自分/全員）＋SF商談の選択・リスケ失注
// ・カレンダーの予定は【】付き（商談）のみ表示
// ・日付を切り替えて他の日の商談も見られる（選んだ日付はページを移動しても保持）
// ・予定カードからSalesforceの商談を選び、リスケならボタン一つで失注にできる
const $h = (id) => document.getElementById(id);
const cssEsc = (s) => (window.CSS && window.CSS.escape) ? window.CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&");
const escH = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let homeScope = "mine";
let meEmail = "";
let allMeetings = [];
let dayEvents = [];
let allDeals = [];
let rankSort = "score";
let rankCache = {};
let calLoading = false;
const calCache = {};
const sfState = {}; // 予定ごとのSalesforceパネルの状態
const homeItems = {}; // カードの中身（スマホのシート表示用）

function ymd(d) {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, "0");
  return x.getFullYear() + "-" + p(x.getMonth() + 1) + "-" + p(x.getDate());
}
const todayStr = ymd(new Date());

// 選んだ日付・表示範囲は保存して、他のページから戻っても同じ状態で開く（日付は日をまたいだら今日に戻す）
const PREF_KEY = "kinbot_home_pref";
function loadPref() {
  try {
    const p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
    if (p.scope === "mine" || p.scope === "all") homeScope = p.scope;
    if (p.savedOn === todayStr && /^\d{4}-\d{2}-\d{2}$/.test(p.date || "")) return p.date;
  } catch {}
  return todayStr;
}
function savePref() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ date: selDate, scope: homeScope, savedOn: todayStr })); } catch {}
}
let selDate = todayStr;

function isOnSelectedDay(d) {
  if (!d) return false;
  return ymd(d) === selDate;
}
function isOtherCat(m) {
  const t = (m.title || "");
  return /【ユ\/フォ】|【社内MTG】/.test(t);
}
// 商談の予定は【】付きのタイトル。それ以外（BBQ・お昼など）はホームに出さない。
function hasBracket(t) { return /【[^】]*】/.test(String(t || "")); }
function repOf(m) { return m.owner_name || m.rep_name || m.owner || "-"; }

function isMine(m) {
  if (!meEmail) return true;
  const o = (m.owner || "").toLowerCase();
  const rn = (m.rep_name || "").toLowerCase();
  const on = (m.owner_name || "").toLowerCase();
  return o === meEmail || rn.includes(meEmail.split("@")[0]) || on.includes(meEmail.split("@")[0]) || o === "";
}

function companyFromTitle(t) {
  if (!t) return "";
  return String(t).replace(/^【[^】]*】\s*/, "").replace(/[、,].*$/, "").split("/")[0].trim();
}
// Salesforce検索用に、予定タイトルから会社名だけを推測する（担当者名や敬称、【】表記は落とす）
const CO_HINT = /(株式会社|有限会社|合同会社|合資会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|医療法人|学校法人|社会福祉法人|㈱|\(株\)|（株）|Inc|Corp|LLC|Ltd)/i;
function searchNameFromTitle(t) {
  let s = String(t || "").replace(/【[^】]*】/g, " ");
  s = s.split(/[\/／|｜]/)[0];
  const toks = s.split(/[\s　、,]+/).filter(Boolean);
  let pick = toks.find((x) => CO_HINT.test(x)) || toks[0] || "";
  pick = pick.replace(/(様|さま|さん|御中)$/u, "");
  return pick.trim();
}

function dateLabel(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" });
}

function updateHead() {
  const isToday = selDate === todayStr;
  $h("homeDate").textContent = (isToday ? "今日の商談（" : "商談（") + dateLabel(selDate) + "）";
  const pick = $h("datePick");
  if (pick && pick.value !== selDate) pick.value = selDate;
  const tb = $h("dateToday");
  if (tb) tb.style.visibility = isToday ? "hidden" : "visible";
  renderWeek();
}

// スマホ用の週バー（月曜はじまり）。選んだ日を含む週を出す。
let weekBase = null; // 表示中の週の月曜（YYYY-MM-DD）
function mondayOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const x = new Date(y, m - 1, d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return ymd(x);
}
function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const x = new Date(y, m - 1, d);
  x.setDate(x.getDate() + n);
  return ymd(x);
}
function renderWeek() {
  const box = $h("homeWeek");
  if (!box) return;
  const mon = weekBase || mondayOf(selDate);
  weekBase = mon;
  const w = ["月", "火", "水", "木", "金", "土", "日"];
  // 録音済み商談がある日に印を付ける
  const marks = new Set(allMeetings.filter((m) => !isOtherCat(m)).map((m) => ymd(m.created_at)));
  let html = "";
  for (let i = 0; i < 7; i++) {
    const ds = addDays(mon, i);
    const cls = ["home-week-day"];
    if (ds === selDate) cls.push("is-sel");
    if (ds === todayStr) cls.push("is-today");
    if (i >= 5) cls.push("is-off");
    if (marks.has(ds)) cls.push("has-item");
    html += `<button type="button" class="${cls.join(" ")}" data-day="${ds}"><span class="wd-w">${w[i]}</span><span class="wd-d">${Number(ds.slice(8))}</span></button>`;
  }
  box.innerHTML = html;
}

// ── Salesforceパネル ───────────────────────────────
function sfOf(key) {
  if (!sfState[key]) sfState[key] = { open: false, loading: false, error: "", reauth: false, records: null, picked: null, done: "", q: "" };
  return sfState[key];
}

function sfPanelHtml(key, ev) {
  const s = sfOf(key);
  if (!s.open) return "";
  let inner = "";
  if (s.done) {
    inner = `<div class="home-sf-done">${escH(s.done)}</div>
      <div class="home-sf-row"><button class="btn sf-btn-secondary home-sf-mini" data-sf-reset="${escH(key)}" type="button">別の商談を選ぶ</button></div>`;
  } else if (s.picked) {
    const p = s.picked;
    inner = `<div class="home-sf-picked">
        <div class="home-sf-name">${escH(p.Name || "")}</div>
        <div class="home-sf-meta">${escH(p.StageName || "")} · ${escH((p.Account && p.Account.Name) || "")} · ${escH(p.CloseDate || "")}</div>
      </div>
      ${s.error ? `<div class="home-sf-err">${escH(s.error)}</div>` : ""}
      <div class="home-sf-row">
        <button class="btn home-sf-lose" data-sf-lose="${escH(key)}" type="button"${s.loading ? " disabled" : ""}>${s.loading ? "更新中…" : "リスケで失注にする"}</button>
        <button class="btn sf-btn-secondary home-sf-mini" data-sf-reset="${escH(key)}" type="button">別の商談を選ぶ</button>
        <a class="home-sf-link" href="history.html?company=${encodeURIComponent(companyFromTitle(ev.title) || ev.title || "")}">SF更新画面で細かく編集する</a>
      </div>
      <div class="home-sf-note">ステージを「失注」、失注理由を「ニーズ・優先度不足 ／ 初回商談リスケ」で登録します。</div>`;
  } else {
    const rows = s.records;
    let listHtml = "";
    if (s.loading) listHtml = `<div class="home-sf-msg">検索中…</div>`;
    else if (s.reauth) listHtml = `<div class="home-sf-err">Salesforceの再連携が必要です。<a class="home-sf-link" href="settings.html">設定を開く</a></div>`;
    else if (s.error) listHtml = `<div class="home-sf-err">${escH(s.error)}</div>`;
    else if (rows && !rows.length) listHtml = `<div class="home-sf-msg">一致する商談が見つかりませんでした。会社名を変えて検索してください。</div>`;
    else if (rows) listHtml = `<div class="home-sf-list">` + rows.map((r) => `
        <button class="home-sf-item" data-sf-pick="${escH(key)}" data-sf-id="${escH(r.Id)}" type="button">
          <span class="home-sf-name">${escH(r.Name || "")}</span>
          <span class="home-sf-meta">${escH(r.StageName || "")} · ${escH((r.Account && r.Account.Name) || "")} · ${escH(r.CloseDate || "")}</span>
        </button>`).join("") + `</div>`;
    inner = `<div class="home-sf-search">
        <input type="text" class="home-sf-input" data-sf-q="${escH(key)}" value="${escH(s.q)}" placeholder="会社名" />
        <button class="btn sf-btn-secondary home-sf-mini" data-sf-search="${escH(key)}" type="button">検索</button>
      </div>${listHtml}`;
  }
  return `<div class="home-sf">${inner}<button type="button" class="home-sf-hide" data-sf-close="${escH(key)}">閉じる</button></div>`;
}

// 予定と録音済み商談を突き合わせるためのタイトル正規化
function normTitle(t) {
  return String(t || "")
    .replace(/【[^】]*】/g, " ")
    .replace(/(様|さま|さん|御中)/g, "")
    .replace(/[\s　、,.。・:：\/／|｜()（）\-‐―ー]/g, "")
    .toLowerCase();
}
// 同じ商談かどうか（同じ日の予定と録音を突き合わせる）
function sameDeal(a, b) {
  const x = normTitle(a), y = normTitle(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x))) return true;
  const ca = normTitle(searchNameFromTitle(a)), cb = normTitle(searchNameFromTitle(b));
  return !!ca && ca.length >= 2 && ca === cb;
}

function render() {
  const box = $h("homeList");
  const isToday = selDate === todayStr;
  const dayWord = isToday ? "今日" : "この日";
  const now = Date.now();

  // 録音済み商談（この日・表示範囲でしぼる）
  let recs = allMeetings.filter((m) => isOnSelectedDay(m.created_at) && !isOtherCat(m));
  if (homeScope === "mine") recs = recs.filter(isMine);

  // カレンダーの予定（【】付きのみ）
  const events = (dayEvents || []).filter((e) => hasBracket(e.title) && !isOtherCat(e));

  // 予定に録音済み商談をひも付けて、1件1カードにまとめる
  const used = new Set();
  const items = events.map((e) => {
    let rec = null;
    for (let i = 0; i < recs.length; i++) {
      if (used.has(i)) continue;
      if (sameDeal(e.title, recs[i].title)) { rec = recs[i]; used.add(i); break; }
    }
    return { key: e.id || (e.title + "@" + e.start), when: new Date(e.start).getTime(), ev: e, rec };
  });
  // 予定に無い録音済み商談も同じ並びに混ぜる
  recs.forEach((m, i) => {
    if (used.has(i)) return;
    items.push({ key: "m:" + (m.bot_id || m.title || i), when: new Date(m.created_at).getTime(), ev: null, rec: m });
  });
  items.sort((a, b) => a.when - b.when);
  renderMini();
  renderTodo(items);

  let html = "";
  if (window._calConnected === false) {
    html += `<div class="home-note">Googleカレンダーが連携されていません。設定で連携すると、予定がここに表示され、開始時刻にボットが自動入室します。</div>`;
  }
  if (calLoading) {
    html += '<div class="home-empty">読み込み中…</div>';
    box.innerHTML = html;
    return;
  }
  if (!items.length) {
    html += `<div class="home-empty">${dayWord}の商談はありません。</div>`;
    box.innerHTML = html;
    return;
  }

  html += items.map((it) => {
    const e = it.ev, m = it.rec;
    const key = it.key;
    const s = sfOf(key);
    const title = (e && e.title) || (m && m.title) || "(無題)";
    const time = new Date(it.when).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    const company = companyFromTitle(title) || (m && m.company_name) || "";
    const enc = encodeURIComponent(company || title);
    // バッジ：商談済み／予定
    let badges = "";
    if (m) {
      badges += '<span class="home-badge home-badge-done">商談済み</span>';
      if (m.phase) badges += `<span class="home-badge">${escH(m.phase)}</span>`;
      if (m.status) badges += `<span class="home-badge home-badge-st">${escH(m.status)}</span>`;
    } else if (e) {
      const past = new Date(e.start).getTime() < now;
      badges += `<span class="home-badge home-badge-plan">${past ? "実施済み予定" : "予定"}</span>`;
      badges += e.hasUrl ? '<span class="home-badge">自動入室対象</span>' : '<span class="home-badge home-badge-st">URLなし</span>';
    }
    // 補足行
    let meta = "";
    if (m) meta = `担当：${escH(repOf(m))}`;
    else if (e) meta = e.hasUrl ? "開始時刻にボットが自動入室します" : "予定にZoom等のURLがありません（自動入室されません）";
    const summary = (m && m.summary && m.summary.overview) ? String(m.summary.overview).slice(0, 90) + "…" : "";
    const openLabel = m ? "商談を開く" : "会社を開く";
    homeItems[key] = { title, time, company, done: !!m, link: "history.html?company=" + enc, openLabel };
    return `<div class="home-row"><div class="home-rail">${escH(time)}</div><div class="home-card home-card-v${m ? " is-done" : " home-card-plan"}" data-card="${escH(key)}">
      <div class="home-card-row">
        <div class="home-card-main">
          <div class="home-card-top"><span class="home-time">${escH(time)}</span>${badges}</div>
          <div class="home-card-title">${escH(title)}</div>
          ${meta ? `<div class="home-card-meta">${meta}</div>` : ""}
          ${summary ? `<div class="home-card-sum">${escH(summary)}</div>` : ""}
        </div>
        <div class="home-card-actions">
          <a class="btn" href="history.html?company=${enc}">${openLabel}</a>
          <button class="btn sf-btn-secondary" data-sf-open="${escH(key)}" type="button">${s.open ? "SF商談を閉じる" : "SF商談を選ぶ"}</button>
        </div>
      </div>
      ${sfPanelHtml(key, { title })}
    </div></div>`;
  }).join("");

  box.innerHTML = html;
}

// ---- 右パネル：ミニカレンダー ----
let miniBase = null; // 表示中の月の1日（YYYY-MM-01）
function renderMini() {
  const box = $h("homeMini");
  if (!box) return;
  const base = miniBase || (selDate.slice(0, 7) + "-01");
  miniBase = base;
  const [y, mo] = base.split("-").map(Number);
  const lab = $h("miniLabel");
  if (lab) lab.textContent = y + "年" + mo + "月";
  const first = new Date(y, mo - 1, 1);
  const lead = (first.getDay() + 6) % 7; // 月曜はじまり
  const days = new Date(y, mo, 0).getDate();
  const marks = new Set(allMeetings.filter((m) => !isOtherCat(m)).map((m) => ymd(m.created_at)));
  let html = '<div class="home-mini-w">' + ["月","火","水","木","金","土","日"].map((w) => `<span>${w}</span>`).join("") + "</div>";
  html += '<div class="home-mini-g">';
  for (let i = 0; i < lead; i++) html += "<span></span>";
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const cls = ["home-mini-d"];
    if (ds === selDate) cls.push("is-sel");
    if (ds === todayStr) cls.push("is-today");
    if (marks.has(ds)) cls.push("has-item");
    html += `<button type="button" class="${cls.join(" ")}" data-day="${ds}">${d}</button>`;
  }
  html += "</div>";
  box.innerHTML = html;
}

// ---- 右パネル：温度感ランキング ----
async function loadRank() {
  const box = $h("homeRank");
  if (!box) return;
  const key = homeScope + ":" + rankSort;
  if (rankCache[key]) { renderRank(rankCache[key]); return; }
  box.innerHTML = '<div class="home-panel-empty">読み込み中…</div>';
  try {
    const r = await fetch(`/api/temperature-ranking?limit=5&scope=${homeScope === "mine" ? "mine" : "all"}&sort=${rankSort}`);
    const d = await r.json();
    rankCache[key] = (d && d.items) || [];
  } catch { rankCache[key] = []; }
  renderRank(rankCache[key]);
}
function renderRank(items) {
  const box = $h("homeRank");
  if (!box) return;
  if (!items.length) {
    box.innerHTML = '<div class="home-panel-empty">対象の商談がまだありません。</div>';
    return;
  }
  box.innerHTML = items.map((it, i) => {
    const name = it.company || companyFromTitle(it.title) || it.title || "(無題)";
    const val = rankSort === "swing" ? it.swing : it.score;
    const tone = rankSort === "swing" ? (it.swing >= 40 ? "hot" : it.swing >= 20 ? "warm" : "cool")
                                      : (it.score >= 70 ? "hot" : it.score >= 45 ? "warm" : "cool");
    const d = it.created_at ? new Date(it.created_at).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }) : "";
    const sub = rankSort === "swing" ? `スコア ${it.score}` : (it.swing ? `振れ幅 ${it.swing}` : "");
    return `<a class="home-rank" href="history.html?m=${encodeURIComponent(it.bot_id)}">
      <span class="home-rank-no">${i + 1}</span>
      <span class="home-rank-t"><b>${escH(name)}</b><em>${escH(d)}${it.owner_name ? " ・ " + escH(it.owner_name) : ""}${sub ? " ・ " + escH(sub) : ""}</em></span>
      <span class="home-rank-v is-${tone}">${val}</span>
    </a>`;
  }).join("");
}

// ---- 右パネル：要対応 ----
function renderTodo(items) {
  const box = $h("homeTodo");
  if (!box) return;
  const rows = [];
  // 再商談が未設定のまま猶予中の案件
  let pend = allDeals.filter((d) => String(d.status || "").includes("進行中(未設定)") && d.auto_lose_deadline);
  if (homeScope === "mine" && meEmail) pend = pend.filter((d) => String(d.owner || "").toLowerCase() === meEmail);
  if (pend.length) {
    const near = pend.map((d) => String(d.auto_lose_deadline).slice(0, 10)).sort()[0];
    rows.push({ label: "再商談が未設定", sub: `${pend.length}件 ・ 最短 ${near} まで`, href: "history.html", warn: true });
  }
  // この日の予定でZoom等のURLが無いもの
  const noUrl = (items || []).filter((it) => it.ev && !it.ev.hasUrl && !it.rec).length;
  if (noUrl) rows.push({ label: "自動入室されない予定", sub: `${noUrl}件 ・ URLが未設定`, href: "", warn: false });
  box.innerHTML = rows.length
    ? rows.map((r) => (r.href
        ? `<a class="home-todo" href="${r.href}"><span class="home-todo-dot${r.warn ? " is-warn" : ""}"></span><span class="home-todo-t"><b>${escH(r.label)}</b><em>${escH(r.sub)}</em></span></a>`
        : `<div class="home-todo"><span class="home-todo-dot${r.warn ? " is-warn" : ""}"></span><span class="home-todo-t"><b>${escH(r.label)}</b><em>${escH(r.sub)}</em></span></div>`)).join("")
    : '<div class="home-panel-empty">いまのところ対応が必要なものはありません。</div>';
}

async function sfSearch(key) {
  const s = sfOf(key);
  s.loading = true; s.error = ""; s.reauth = false; s.records = null;
  render();
  try {
    const r = await fetch("/api/salesforce/search?q=" + encodeURIComponent(s.q));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (d.sfReauth || r.status === 401 || /未連携/.test(d.error || "")) s.reauth = true;
      else s.error = d.error || "検索に失敗しました";
      s.records = null;
    } else {
      s.records = d.records || [];
    }
  } catch (e) {
    s.error = "検索に失敗しました（通信エラー）";
  } finally {
    s.loading = false;
    render();
  }
}

async function sfLose(key) {
  const s = sfOf(key);
  if (!s.picked) return;
  const ok = confirm(`「${s.picked.Name}」をリスケ理由で失注にします。よろしいですか？`);
  if (!ok) return;
  s.loading = true; s.error = "";
  render();
  try {
    const r = await fetch("/api/salesforce/opportunity/" + encodeURIComponent(s.picked.Id) + "/lose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      s.error = ((d.sfReauth || /未連携/.test(d.error || "")) ? "Salesforceの再連携が必要です。設定から連携し直してください。" : (d.error || "更新に失敗しました"));
    } else {
      s.done = `失注にしました（ステージ：${d.stage || "失注"} ／ 理由：初回商談リスケ）`;
    }
  } catch (e) {
    s.error = "更新に失敗しました（通信エラー）";
  } finally {
    s.loading = false;
    render();
  }
}

function wireList() {
  const box = $h("homeList");
  box.addEventListener("click", (ev) => {
    const openBtn = ev.target.closest("[data-sf-open]");
    if (openBtn) {
      const key = openBtn.dataset.sfOpen;
      const s = sfOf(key);
      s.open = !s.open;
      if (s.open && s.records === null && !s.picked && !s.done) {
        const card = openBtn.closest(".home-card");
        const title = card ? (card.querySelector(".home-card-title") || {}).textContent || "" : "";
        s.q = searchNameFromTitle(title);
        render();
        sfSearch(key);
        return;
      }
      render();
      return;
    }
    const searchBtn = ev.target.closest("[data-sf-search]");
    if (searchBtn) {
      const key = searchBtn.dataset.sfSearch;
      const input = box.querySelector(`[data-sf-q="${cssEsc(key)}"]`);
      sfOf(key).q = input ? input.value.trim() : "";
      sfSearch(key);
      return;
    }
    const pick = ev.target.closest("[data-sf-pick]");
    if (pick) {
      const key = pick.dataset.sfPick;
      const s = sfOf(key);
      s.picked = (s.records || []).find((r) => r.Id === pick.dataset.sfId) || null;
      s.error = "";
      render();
      return;
    }
    const reset = ev.target.closest("[data-sf-reset]");
    if (reset) {
      const key = reset.dataset.sfReset;
      const s = sfOf(key);
      s.picked = null; s.done = ""; s.error = "";
      render();
      return;
    }
    const lose = ev.target.closest("[data-sf-lose]");
    if (lose) { sfLose(lose.dataset.sfLose); return; }
    const closeBtn = ev.target.closest("[data-sf-close]");
    if (closeBtn) { sfOf(closeBtn.dataset.sfClose).open = false; render(); return; }
    // スマホ：カードをタップしたら操作シートを出す
    if (window.kbIsMobile && window.kbIsMobile() && window.kbSheet) {
      if (ev.target.closest("a, button, input, select, textarea, .home-sf")) return;
      const card = ev.target.closest("[data-card]");
      if (card) openCardSheet(card.dataset.card);
    }
  });
  // 検索ボックスでEnter＝検索、入力内容は状態に控える
  box.addEventListener("input", (ev) => {
    const inp = ev.target.closest("[data-sf-q]");
    if (inp) sfOf(inp.dataset.sfQ).q = inp.value;
  });
  box.addEventListener("keydown", (ev) => {
    const inp = ev.target.closest("[data-sf-q]");
    if (inp && ev.key === "Enter") { ev.preventDefault(); sfOf(inp.dataset.sfQ).q = inp.value.trim(); sfSearch(inp.dataset.sfQ); }
  });
}

const ICO = {
  building: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="4" y="3.5" width="12" height="17" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 9h4v11.5M7.5 7.5h5M7.5 11h5M7.5 14.5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  cloud: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M7 18.5a4 4 0 0 1-.3-8 5.5 5.5 0 0 1 10.6 1.2A3.6 3.6 0 0 1 17 18.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  mic: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="9.5" y="3" width="5" height="10" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6.5 11a5.5 5.5 0 0 0 11 0M12 16.5V21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 5.5 15.5 12 9 18.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function openCardSheet(key) {
  const it = homeItems[key];
  if (!it) return;
  const sub = `${dateLabel(selDate)} ${it.time} ・ ${it.done ? "商談済み" : "予定"}`;
  const html =
    `<div class="kb-sheet-title">${escH(it.title)}</div>
     <div class="kb-sheet-sub">${escH(sub)}</div>
     <a class="kb-sheet-act" href="${it.link}"><span class="kb-sheet-ico">${ICO.building}</span>${escH(it.openLabel)}<span class="kb-sheet-arrow">${ICO.arrow}</span></a>
     <button type="button" class="kb-sheet-act" data-sheet-sf><span class="kb-sheet-ico">${ICO.cloud}</span>SF商談を選ぶ・リスケ失注<span class="kb-sheet-arrow">${ICO.arrow}</span></button>
     <button type="button" class="kb-sheet-close" data-sheet-close>閉じる</button>`;
  const sheet = window.kbSheet(html);
  sheet.el.addEventListener("click", (ev) => {
    if (!ev.target.closest("[data-sheet-sf]")) return;
    sheet.close();
    const s = sfOf(key);
    s.open = true;
    if (s.records === null && !s.picked && !s.done) {
      s.q = searchNameFromTitle(homeItems[key].title);
      render();
      sfSearch(key);
    } else {
      render();
    }
    setTimeout(() => {
      const card = document.querySelector(`[data-card="${cssEsc(key)}"]`);
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  });
}

async function loadCalendar() {
  if (calCache[selDate]) {
    dayEvents = calCache[selDate].events;
    window._calConnected = calCache[selDate].connected;
    return;
  }
  const target = selDate;
  calLoading = true;
  updateHead();
  render();
  try {
    const cr = await fetch("/api/calendar/today?date=" + encodeURIComponent(target));
    const cd = await cr.json();
    const events = (cd && cd.events) || [];
    const connected = !!(cd && cd.connected !== false);
    calCache[target] = { events, connected };
    if (target !== selDate) return; // 連打で日付が変わっていたら破棄
    dayEvents = events;
    window._calConnected = connected;
  } catch {
    if (target !== selDate) return;
    dayEvents = [];
    window._calConnected = false;
  } finally {
    if (target === selDate) calLoading = false;
  }
}

async function changeDate(next) {
  selDate = next;
  weekBase = mondayOf(next);
  miniBase = next.slice(0, 7) + "-01";
  savePref();
  updateHead();
  await loadCalendar();
  updateHead();
  render();
}

function shiftDate(days) {
  const [y, m, d] = selDate.split("-").map(Number);
  const x = new Date(y, m - 1, d);
  x.setDate(x.getDate() + days);
  changeDate(ymd(x));
}

async function load() {
  try {
    const me = await (await fetch("/api/me")).json().catch(() => ({}));
    meEmail = (me.username || "").toLowerCase();
  } catch {}
  try {
    const r = await fetch("/api/meetings");
    const d = await r.json();
    allMeetings = Array.isArray(d) ? d : (d.meetings || []);
  } catch { allMeetings = []; }
  try {
    const rd = await fetch("/api/deals");
    const dd = await rd.json();
    allDeals = Array.isArray(dd) ? dd : (dd.deals || []);
  } catch { allDeals = []; }
  await loadCalendar();
  updateHead();
  render();
}

document.addEventListener("DOMContentLoaded", () => {
  selDate = loadPref();
  $h("homeToggle").querySelectorAll(".home-tg").forEach((b) => {
    b.classList.toggle("active", b.dataset.scope === homeScope);
    b.addEventListener("click", () => {
      homeScope = b.dataset.scope;
      savePref();
      loadRank();
      $h("homeToggle").querySelectorAll(".home-tg").forEach((x) => x.classList.toggle("active", x === b));
      render();
    });
  });
  $h("datePick").value = selDate;
  $h("datePick").addEventListener("change", (e) => {
    const v = e.target.value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) changeDate(v);
  });
  const mp = $h("miniPrev"), mn = $h("miniNext");
  const shiftMonth = (n) => {
    const [y, mo] = (miniBase || (selDate.slice(0, 7) + "-01")).split("-").map(Number);
    const x = new Date(y, mo - 1 + n, 1);
    miniBase = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-01`;
    renderMini();
  };
  if (mp) mp.addEventListener("click", () => shiftMonth(-1));
  if (mn) mn.addEventListener("click", () => shiftMonth(1));
  const mini = $h("homeMini");
  if (mini) mini.addEventListener("click", (e) => {
    const b = e.target.closest("[data-day]");
    if (b) changeDate(b.dataset.day);
  });
  const wp = $h("weekPrev"), wn = $h("weekNext");
  if (wp) wp.addEventListener("click", () => { weekBase = addDays(weekBase || mondayOf(selDate), -7); renderWeek(); });
  if (wn) wn.addEventListener("click", () => { weekBase = addDays(weekBase || mondayOf(selDate), 7); renderWeek(); });
  const wk = $h("homeWeek");
  if (wk) wk.addEventListener("click", (e) => {
    const b = e.target.closest("[data-day]");
    if (b) changeDate(b.dataset.day);
  });
  $h("datePrev").addEventListener("click", () => shiftDate(-1));
  $h("dateNext").addEventListener("click", () => shiftDate(1));
  $h("dateToday").addEventListener("click", () => changeDate(todayStr));
  wireList();
  document.querySelectorAll(".home-rank-tab").forEach((b) => {
    b.addEventListener("click", () => {
      rankSort = b.dataset.rank;
      document.querySelectorAll(".home-rank-tab").forEach((x) => x.classList.toggle("active", x === b));
      loadRank();
    });
  });
  updateHead();
  load();
  loadRank();
});
