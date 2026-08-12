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
let rankRound = "";
let rankBy = "deal";
let rankCache = {};
let myRooms = null; // 設定に登録しているZoomルーム
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
  $h("homeDate").textContent = (isToday ? "今日（" : "") + dateLabel(selDate) + (isToday ? "）" : "");
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
        <button class="btn home-sf-lose" data-sf-lose="${escH(key)}" type="button"${s.loading ? " disabled" : ""}>${s.loading ? "更新中…" : "リスケ失注"}</button>
        <a class="btn sf-btn-secondary home-sf-mini" href="history.html?company=${encodeURIComponent(companyFromTitle(ev.title) || ev.title || "")}&sf=update&opp=${encodeURIComponent(p.Id || "")}">SF更新</a>
        <button class="btn sf-btn-secondary home-sf-mini" data-sf-reset="${escH(key)}" type="button">別商談を選ぶ</button>
      </div>
      <div class="home-sf-note">ステージを「失注」、失注理由を「ニーズ・優先度不足 ／ 初回商談リスケ」、理由詳細を「リスケ」、失注日と失注後次回アクション日を今日の日付で登録し、商談所有者を自分に変更します。</div>`;
  } else {
    const rows = s.records;
    let listHtml = "";
    if (s.loading) listHtml = `<div class="home-sf-msg">検索中…</div>`;
    else if (s.reauth) listHtml = `<div class="home-sf-err">Salesforceにつながりませんでした。<a class="home-sf-link" href="settings.html">設定を開いて再連携</a>${s.raw ? `<br><span class="home-sf-note">${escH(s.raw)}</span>` : ""}<br><a class="home-sf-link" href="/api/salesforce/diag" target="_blank" rel="noopener">接続の状態を確認する</a></div>`;
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

  let html = "";
  if (window._calConnected === false) {
    html += `<div class="home-note">Googleカレンダーが連携されていません。設定で連携すると、予定がここに表示され、開始時刻にボットが自動入室します。</div>`;
  }
  const setCount = (n) => {
    const c = document.getElementById("homeMtgCount");
    if (c) c.textContent = n ? `${n}件` : "";
  };
  if (calLoading) {
    html += '<div class="home-empty"><span class="empty-state is-loading">読み込み中…</span></div>';
    box.innerHTML = html; setCount(0);
    return;
  }
  if (!items.length) {
    html += `<div class="home-empty">${dayWord}の商談はありません。</div>`;
    box.innerHTML = html; setCount(0);
    return;
  }

  html += items.map((it, idx) => {
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
      if (window._autoJoin) {
        badges += e.hasUrl ? '<span class="home-badge">自動入室対象</span>' : '<span class="home-badge home-badge-st">URLなし</span>';
      }
    }
    // 補足行
    let meta = "";
    if (m) meta = `担当：${escH(repOf(m))}`;
    else if (e) {
      meta = window._autoJoin
        ? (e.hasUrl ? "開始時刻にボットが自動入室します" : "予定にZoom等のURLがありません（自動入室されません）")
        : "録音するときは、レコーディング画面からボットを入れてください";
    }
    const summary = (m && m.summary && m.summary.overview) ? String(m.summary.overview).slice(0, 90) + "…" : "";
    const openLabel = m ? "商談を開く" : "会社を開く";
    const link = m && m.bot_id ? "history.html?m=" + encodeURIComponent(m.bot_id) : "history.html?company=" + enc;
    homeItems[key] = { title, time, company, done: !!m, link, openLabel, botId: (m && m.bot_id) || "" };
    return `<div class="home-row" style="--i:${idx}"><div class="home-rail">${escH(time)}</div><div class="home-card home-card-v${m ? " is-done" : " home-card-plan"}" data-card="${escH(key)}">
      <div class="home-card-row">
        <div class="home-card-main">
          <div class="home-card-top"><span class="home-time">${escH(time)}</span>${badges}</div>
          <div class="home-card-title">${escH(title)}</div>
          ${meta ? `<div class="home-card-meta">${meta}</div>` : ""}
          ${summary ? `<div class="home-card-sum">${escH(summary)}</div>` : ""}
        </div>
        <div class="home-card-actions">
          ${!m && e ? `<button class="btn kb-prio" type="button" data-rec="${escH(key)}"><span class="lb-l">録音する</span><span class="lb-s">録音</span></button>` : ""}
          ${m && m.bot_id ? `<button class="btn kb-prio" type="button" data-mail="${escH(m.bot_id)}" data-key="${escH(key)}"><span class="lb-l">御礼メール</span><span class="lb-s">メール</span></button>` : ""}
          ${m ? `<button class="btn sf-btn-secondary kb-more" type="button" data-sfedit="${escH(key)}"><span class="lb-l">SF更新</span><span class="lb-s">SF</span></button>` : ""}
          <a class="btn sf-btn-secondary kb-more" href="${link}"><span class="lb-l">${openLabel}</span><span class="lb-s">開く</span></a>
          ${!m ? `<button class="btn sf-btn-secondary kb-more" data-sf-open="${escH(key)}" type="button"><span class="lb-l">${s.open ? "SF商談を閉じる" : "SF商談を選ぶ"}</span><span class="lb-s">${s.open ? "閉じる" : "SF商談"}</span></button>` : ""}
          <button type="button" class="home-card-more" data-sheet-open="${escH(key)}" aria-label="そのほかの操作">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>
          </button>
        </div>
      </div>
      ${sfPanelHtml(key, { title })}
    </div></div>`;
  }).join("");

  box.innerHTML = html;
  const c = document.getElementById("homeMtgCount");
  if (c) c.textContent = items.length ? `${items.length}件` : "";
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
// 設定に登録しているZoomルームを読む（録音のURL候補に出す）
async function loadRooms() {
  if (myRooms) return myRooms;
  try {
    const r = await fetch("/api/auto-join");
    const d = await r.json();
    myRooms = (d.items || []).filter((x) => x.url);
  } catch { myRooms = []; }
  return myRooms;
}

async function loadRank() {
  const box = $h("homeRank");
  if (!box) return;
  const key = rankBy + ":" + (rankBy === "member" ? "all" : homeScope) + ":" + rankSort + ":" + rankRound;
  if (rankCache[key]) { renderRank(rankCache[key]); return; }
  box.innerHTML = '<div class="home-panel-empty is-loading">読み込み中…</div>';
  try {
    // メンバー別は全員で比較する
    const scope = rankBy === "member" ? "all" : (homeScope === "mine" ? "mine" : "all");
    const lim = rankBy === "member" ? 8 : 5;
    const r = await fetch(`/api/temperature-ranking?limit=${lim}&scope=${scope}&sort=${rankSort}&round=${rankRound}&by=${rankBy === "member" ? "member" : "deal"}`);
    const d = await r.json();
    rankCache[key] = rankBy === "member" ? ((d && d.members) || []) : ((d && d.items) || []);
  } catch { rankCache[key] = []; }
  renderRank(rankCache[key]);
}
// ランキングのスコアを円のゲージで見せる
function rankRing(val, tone) {
  const v = Math.max(0, Math.min(100, Number(val) || 0));
  const r = 18, c = 2 * Math.PI * r;
  const off = c * (1 - v / 100);
  rankRing._n = (rankRing._n || 0) + 1;
  const gid = "kbRankGrad" + rankRing._n;
  const from = tone === "cool" ? "#8f9c96" : tone === "warm" ? "#b8791a" : "#0d5b47";
  const to = tone === "cool" ? "#b4b2a9" : tone === "warm" ? "#e0b25e" : "#5DCAA5";
  return `<span class="home-rank-ring is-${tone}">
    <svg viewBox="0 0 44 44" aria-hidden="true">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>
      </linearGradient></defs>
      <circle class="bg" cx="22" cy="22" r="${r}"/>
      <circle class="fg" cx="22" cy="22" r="${r}" stroke="url(#${gid})" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
    </svg>
    <b>${v}</b>
  </span>`;
}

function animateRankNumbers() {
  if (!window.kbCountUp) return;
  document.querySelectorAll("#homeRank .home-rank-ring b").forEach((el) => {
    const v = Number(el.textContent);
    if (isFinite(v)) window.kbCountUp(el, v, 600);
  });
}

function renderRank(items) {
  const box = $h("homeRank");
  if (!box) return;
  if (rankBy === "member") {
    box.innerHTML = items.length
      ? items.map((m, i) => {
          const val = rankSort === "swing" ? m.swing : rankSort === "skill" ? m.skill : m.score;
          const tone = rankSort === "swing" ? (m.swing >= 40 ? "hot" : m.swing >= 20 ? "warm" : "cool")
                     : rankSort === "skill" ? (m.skill >= 70 ? "hot" : m.skill >= 45 ? "warm" : "cool")
                     : (m.score >= 70 ? "hot" : m.score >= 45 ? "warm" : "cool");
          const sub = rankSort === "skill"
            ? `${m.count}件 ・ 次回設定 ${m.nextRate}% ・ フィラー ${m.filler}`
            : rankSort === "swing"
              ? `${m.count}件 ・ 最高 ${m.best} ・ 平均温度感 ${m.score}`
              : `${m.count}件 ・ 最高 ${m.best} ・ 平均振れ幅 ${m.swing}`;
          return `<div class="home-rank">
            ${rankRing(val, tone)}
            <span class="home-rank-t"><b>${escH(m.name)}</b><em>${i + 1}位 ・ ${escH(sub)}</em></span>
          </div>`;
        }).join("")
      : '<div class="home-panel-empty">2件以上の商談があるメンバーがまだいません。</div>';
    animateRankNumbers();
    return;
  }
  if (!items.length) {
    box.innerHTML = `<div class="home-panel-empty">${rankRound ? "この回数の商談がまだありません。" : "対象の商談がまだありません。"}</div>`;
    return;
  }
  box.innerHTML = items.map((it, i) => {
    const name = it.company || companyFromTitle(it.title) || it.title || "(無題)";
    const val = rankSort === "swing" ? it.swing : rankSort === "skill" ? it.skill : it.score;
    const tone = rankSort === "swing" ? (it.swing >= 40 ? "hot" : it.swing >= 20 ? "warm" : "cool")
               : rankSort === "skill" ? (it.skill >= 70 ? "hot" : it.skill >= 45 ? "warm" : "cool")
               : (it.score >= 70 ? "hot" : it.score >= 45 ? "warm" : "cool");
    const d = it.created_at ? new Date(it.created_at).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" }) : "";
    const rn = it.round_no ? `${it.round_no}回目` : "";
    const sub = rankSort === "swing" ? `温度感 ${it.score}`
              : rankSort === "skill" ? (it.nextLevel || `温度感 ${it.score}`)
              : (it.swing ? `振れ幅 ${it.swing}` : "");
    return `<a class="home-rank" href="history.html?m=${encodeURIComponent(it.bot_id)}">
      ${rankRing(val, tone)}
      <span class="home-rank-t"><b>${escH(name)}</b><em>${i + 1}位 ・ ${escH(d)}${rn ? " ・ " + escH(rn) : ""}${it.owner_name ? " ・ " + escH(it.owner_name) : ""}${sub ? " ・ " + escH(sub) : ""}</em></span>
    </a>`;
  }).join("");
  animateRankNumbers();
}

async function sfSearch(key) {
  const s = sfOf(key);
  s.loading = true; s.error = ""; s.reauth = false; s.records = null;
  renderBoth();
  try {
    const r = await fetch("/api/salesforce/search?q=" + encodeURIComponent(s.q));
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (d.sfReauth || r.status === 401 || /未連携/.test(d.error || "")) { s.reauth = true; s.raw = d.error || ""; }
      else s.error = d.error || "検索に失敗しました";
      s.records = null;
    } else {
      s.records = d.records || [];
    }
  } catch (e) {
    s.error = "検索に失敗しました（通信エラー）";
  } finally {
    s.loading = false;
    renderBoth();
  }
}

async function sfLose(key) {
  const s = sfOf(key);
  if (!s.picked) return;
  const ok = confirm(`「${s.picked.Name}」をリスケ理由で失注にします。よろしいですか？`);
  if (!ok) return;
  s.loading = true; s.error = "";
  renderBoth();
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
      s.done = `失注にしました（ステージ：${d.stage || "失注"} ／ 理由：初回商談リスケ${d.ownerChanged ? " ／ 所有者を自分に変更" : ""}）`;
    }
  } catch (e) {
    s.error = "更新に失敗しました（通信エラー）";
  } finally {
    s.loading = false;
    renderBoth();
  }
}

// カードの中にパネルを出す（画面を移動せずに操作する）
function cardPanel(key, html) {
  const card = document.querySelector(`[data-card="${cssEsc(key)}"]`);
  if (!card) return null;
  const old = card.querySelector(".home-inline");
  if (old) old.remove();
  const box = document.createElement("div");
  box.className = "home-inline";
  box.innerHTML = html;
  card.appendChild(box);
  if (box.scrollIntoView) box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return box;
}

// 御礼メールをその場で作る
async function openMail(botId, key) {
  const box = cardPanel(key, '<div class="home-inline-h">御礼メール</div><div class="home-sf-msg">文面を作っています…</div>');
  if (!box) return;
  try {
    const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/thanks`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    const d = await r.json().catch(() => ({}));
    const body = d.body || d.text || "";
    if (!body) throw new Error(d.error || "文面を作れませんでした");
    const subject = d.subject || "【御礼】本日のお打ち合わせについて";
    box.innerHTML =
      `<div class="home-inline-h">御礼メール</div>
       <input type="text" class="home-mail-subj" value="${escH(subject)}" />
       <textarea class="home-mail-body" rows="10">${escH(body)}</textarea>
       <div class="home-sf-row">
         <button type="button" class="btn" data-gdraft="${escH(botId)}">Gmailに下書きを作る</button>
         <button type="button" class="btn sf-btn-secondary home-sf-mini" data-mailcopy="1">コピー</button>
         <a class="btn sf-btn-secondary home-sf-mini" data-mailto="1" href="#" target="_blank" rel="noopener">Gmailの作成画面で開く</a>
         <button type="button" class="btn sf-btn-secondary home-sf-mini" data-inline-close="1">閉じる</button>
       </div>
       <div class="home-mail-note"></div>`;
    const ta = box.querySelector(".home-mail-body");
    const su = box.querySelector(".home-mail-subj");
    // Gmailの作成画面を開く（メーラー未設定のパソコンでも動くように mailto は使わない）
    const sync = () => {
      const base = "https://mail.google.com/mail/?view=cm&fs=1&tf=1";
      let url = `${base}&su=${encodeURIComponent(su.value)}&body=${encodeURIComponent(ta.value)}`;
      // URLが長すぎるとブラウザが開けないので、そのときは本文を切る
      if (url.length > 7000) {
        url = `${base}&su=${encodeURIComponent(su.value)}&body=${encodeURIComponent(ta.value.slice(0, 1500) + "\n\n（続きはkinbotからコピーしてください）")}`;
      }
      const a = box.querySelector("[data-mailto]");
      a.href = url;
    };
    sync();
    su.addEventListener("input", sync);
    ta.addEventListener("input", sync);
    // Gmailに下書きを作る（やり取りがあれば返信として）
    box.querySelector("[data-gdraft]").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const note = box.querySelector(".home-mail-note");
      btn.disabled = true; btn.textContent = "作成中…";
      note.textContent = "";
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/thanks-gmail-draft`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ subject: su.value, body: ta.value }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "作成に失敗しました");
        note.innerHTML =
          `${d.replied ? "これまでのやり取りへの返信として" : "新規メールとして"}下書きを保存しました` +
          (d.to ? `（宛先：${escH(d.to)}）` : "（宛先は未設定です。Gmailで入れてください）") +
          ` <a class="home-sf-link" href="${escH(d.url)}" target="_blank" rel="noopener">Gmailで開く</a>`;
        btn.textContent = "下書きを作成しました";
      } catch (err) {
        note.innerHTML = escH(err.message) +
          ` <a class="home-sf-link" href="/api/gmail/status" target="_blank" rel="noopener">接続を確認する</a>` +
          ` <a class="home-sf-link" href="settings.html">設定を開く</a>`;
        btn.disabled = false; btn.textContent = "Gmailに下書きを作る";
      }
    });

    box.querySelector("[data-mailcopy]").addEventListener("click", (e) => {
      navigator.clipboard.writeText(ta.value).then(() => {
        e.target.textContent = "コピーしました";
        setTimeout(() => { e.target.textContent = "コピー"; }, 1500);
      }).catch(() => {});
    });
  } catch (e) {
    box.innerHTML = `<div class="home-inline-h">御礼メール</div><div class="home-sf-err">${escH(e.message)}</div>
      <div class="home-sf-row"><button type="button" class="btn sf-btn-secondary home-sf-mini" data-inline-close="1">閉じる</button></div>`;
  }
}

// SF更新を開く。狭いパネルだと読めないので、画面中央の大きなモーダルで開く。
// 上に「次回アクション」（kinbot側のやることリスト）、下にSalesforceの画面を並べる。
function openSfEdit(key) {
  const it = homeItems[key];
  if (!it) return;
  const company = it.company || it.title || "";
  const enc = encodeURIComponent(company);
  const src = `deals.html?company=${enc}&embed=1&view=salesforce`;

  const old = document.querySelector(".sfm");
  if (old) old.remove();

  const m = document.createElement("div");
  m.className = "sfm";
  m.innerHTML =
    `<div class="sfm-back" data-modal-close="1"></div>
     <div class="sfm-box" role="dialog" aria-modal="true">
       <div class="sfm-head">
         <div>
           <div class="sfm-t">${escH(company || "Salesforce 更新")}</div>
           <div class="sfm-s">${escH(it.title || "")}</div>
         </div>
         <button type="button" class="sfm-x" data-modal-close="1" aria-label="閉じる">閉じる</button>
       </div>
       <div class="sfm-body">
         <section class="na-box">
           <div class="na-head">
             <span class="na-title">次回アクション</span>
             <span class="na-note">Salesforceの活動記録とは別に、kinbot側のやることとして残します</span>
           </div>
           <div class="na-form">
             <select class="na-kind" aria-label="種別"></select>
             <input type="text" class="na-content" placeholder="内容（例：見積を作って送付する）" />
             <input type="date" class="na-due" aria-label="期日" />
             <button type="button" class="btn na-add">記録する</button>
           </div>
           <div class="na-msg"></div>
           <div class="na-list"><div class="na-empty">読み込み中…</div></div>
         </section>
         <section class="sf-embed-box">
           <div class="na-head"><span class="na-title">Salesforce</span></div>
           <iframe class="sfm-frame" src="${escH(src)}" title="SF更新"></iframe>
         </section>
       </div>
     </div>`;
  document.body.appendChild(m);
  document.body.style.overflow = "hidden";

  const close = () => { m.remove(); document.body.style.overflow = ""; document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  m.querySelectorAll("[data-modal-close]").forEach((b) => b.addEventListener("click", close));

  wireNextActions(m, { company, title: it.title || "", botId: it.botId || "" });
}

// 次回アクションの一覧・追加・完了チェック
function wireNextActions(root, ctx) {
  const q = (sel) => root.querySelector(sel);
  const list = q(".na-list");
  const msg = q(".na-msg");
  const say = (t, ms) => {
    msg.textContent = t || "";
    if (ms) setTimeout(() => { if (msg.textContent === t) msg.textContent = ""; }, ms);
  };

  const fmtDue = (d) => {
    if (!d) return "";
    const x = new Date(d);
    if (isNaN(x.getTime())) return "";
    const wd = ["日", "月", "火", "水", "木", "金", "土"][x.getDay()];
    return `${x.getMonth() + 1}/${x.getDate()}(${wd})`;
  };
  const isLate = (d) => {
    if (!d) return false;
    const x = new Date(d); x.setHours(23, 59, 59);
    return x.getTime() < Date.now();
  };

  async function load() {
    try {
      const d = await (await fetch("/api/next-actions?company=" + encodeURIComponent(ctx.company))).json();
      if (d.error) throw new Error(d.error);
      const sel = q(".na-kind");
      if (sel && !sel.options.length) {
        for (const k of d.kinds || []) sel.add(new Option(k, k));
      }
      const items = d.items || [];
      if (!items.length) {
        list.innerHTML = '<div class="na-empty">まだ登録がありません。上の欄から記録してください。</div>';
        return;
      }
      list.innerHTML = items.map((x) => `
        <label class="na-item${x.done ? " na-done" : ""}">
          <input type="checkbox" class="na-check" data-id="${x.id}" ${x.done ? "checked" : ""} />
          <span class="na-kind-tag">${escH(x.kind)}</span>
          <span class="na-text">${escH(x.content)}</span>
          ${x.due_date ? `<span class="na-due-tag${!x.done && isLate(x.due_date) ? " na-late" : ""}">${escH(fmtDue(x.due_date))}</span>` : ""}
          ${x.done ? `<span class="na-doneby">完了${x.done_by ? "・" + escH(String(x.done_by).split("@")[0]) : ""}</span>` : ""}
          <button type="button" class="na-del" data-id="${x.id}" aria-label="削除">×</button>
        </label>`).join("");

      list.querySelectorAll(".na-check").forEach((c) =>
        c.addEventListener("change", async () => {
          c.disabled = true;
          try {
            const r = await fetch(`/api/next-actions/${c.dataset.id}`, {
              method: "PUT", headers: { "content-type": "application/json" },
              body: JSON.stringify({ done: c.checked }),
            });
            if (!r.ok) throw new Error((await r.json()).error || "変更できませんでした");
            load();
          } catch (e) { say("失敗: " + e.message, 5000); c.checked = !c.checked; c.disabled = false; }
        })
      );
      list.querySelectorAll(".na-del").forEach((b) =>
        b.addEventListener("click", async (e) => {
          e.preventDefault();
          if (!confirm("この次回アクションを削除します。よろしいですか？")) return;
          try {
            await fetch(`/api/next-actions/${b.dataset.id}`, { method: "DELETE" });
            load();
          } catch {}
        })
      );
    } catch (e) {
      list.innerHTML = `<div class="na-empty">読み込めませんでした：${escH(e.message)}</div>`;
    }
  }

  q(".na-add").addEventListener("click", async () => {
    const kind = q(".na-kind").value;
    const content = q(".na-content").value.trim();
    const dueDate = q(".na-due").value;
    if (!content) { say("内容を入れてください", 4000); return; }
    say("記録しています…");
    try {
      const r = await fetch("/api/next-actions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...ctx, kind, content, dueDate: dueDate || null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "記録できませんでした");
      q(".na-content").value = ""; q(".na-due").value = "";
      say("記録しました", 3000);
      load();
    } catch (e) { say("失敗: " + e.message); }
  });

  q(".na-content").addEventListener("keydown", (e) => {
    if (e.key === "Enter") q(".na-add").click();
  });

  load();
}

// 会議URLの候補が複数あるときは、どれで録音するかを選ばせる（1回選べば次から覚える）
const REC_URL_KEY = "kinbot_rec_url";
function recUrlPref() { try { return JSON.parse(localStorage.getItem(REC_URL_KEY) || "{}"); } catch { return {}; } }
function saveRecUrl(key, url) {
  try { const o = recUrlPref(); o[key] = url; localStorage.setItem(REC_URL_KEY, JSON.stringify(o)); } catch {}
}
// 「録音する」を押したら、会議URLのボタンを出す。押したURLで録音を始める。
function startRecording(key) {
  showRecPicker(key);
}

// 別のURLで録音したいとき（候補が複数あるときだけ出す）
async function showRecPicker(key) {
  const ev = (dayEvents || []).find((x) => (x.id || (x.title + "@" + x.start)) === key);
  const card = document.querySelector(`[data-card="${cssEsc(key)}"]`);
  if (!ev || !card) return;
  const old = card.querySelector(".home-rec-pick");
  if (old) { old.remove(); return; }
  const rooms = await loadRooms();

  // 予定に書かれているリンク
  let cands = (ev.urls || []).filter((c) => c && c.url);
  if (!cands.length && ev.url) cands = [{ url: ev.url, source: "予定のリンク", used: null }];
  const remembered = recUrlPref()[key];
  if (remembered) cands.sort((a, b) => (b.url === remembered ? 1 : 0) - (a.url === remembered ? 1 : 0));
  // 設定に登録しているZoomルーム
  const have = new Set(cands.map((c) => String(c.url)));
  const roomCands = (rooms || [])
    .filter((r) => !have.has(String(r.url)))
    .map((r) => ({ url: r.url, label: r.label || "登録ルーム" }));

  const box = document.createElement("div");
  box.className = "home-rec-pick";
  const chip = (label, url, on) =>
    `<button type="button" class="quick-link-btn${on ? " active" : ""}" data-url="${escH(url)}" title="${escH(url)}">${escH(label)}</button>`;

  let html = "";
  if (cands.length) {
    html += `<div class="quick-links-label">この予定のリンク（押すと録音が始まります）</div><div class="quick-links">` +
      cands.map((c, i) => chip(
        c.source + (c.used && c.used.mine ? `（${c.used.mine}回）` : ""),
        c.url,
        i === 0
      )).join("") + `</div>`;
  }
  if (roomCands.length) {
    html += `<div class="quick-links-label" style="margin-top:10px">よく使うリンク</div><div class="quick-links">` +
      roomCands.map((r) => chip(r.label, r.url, false)).join("") + `</div>`;
  }
  if (!html) html = '<div class="home-rec-pick-h">この予定にはZoom等のURLがありません。レコーディング画面から入室してください。</div>';
  box.innerHTML = html;
  card.appendChild(box);

  box.addEventListener("click", (e2) => {
    const b = e2.target.closest("[data-url]");
    if (!b) return;
    b.textContent = "入室しています…";
    b.disabled = true;
    saveRecUrl(key, b.dataset.url);
    location.href = `index.html?auto=1&url=${encodeURIComponent(b.dataset.url)}&title=${encodeURIComponent(ev.title || "")}`;
  });
}

function wireList() {
  // 商談リストと「割り振られたアポ」リストの両方で同じ操作を効かせる
  [$h("homeList"), document.getElementById("homeApoList")].forEach((el) => {
    if (el) wireListBox(el);
  });
}

function wireListBox(box) {
  box.addEventListener("click", (ev) => {
    const more = ev.target.closest("[data-sheet-open]");
    if (more) { openCardSheet(more.dataset.sheetOpen); return; }
    const rec = ev.target.closest("[data-rec]");
    if (rec) { startRecording(rec.dataset.rec); return; }
    const mail = ev.target.closest("[data-mail]");
    if (mail) { openMail(mail.dataset.mail, mail.dataset.key); return; }
    const sfe = ev.target.closest("[data-sfedit]");
    if (sfe) { openSfEdit(sfe.dataset.sfedit); return; }
    const cls = ev.target.closest("[data-inline-close]");
    if (cls) { const p = cls.closest(".home-inline"); if (p) p.remove(); return; }
    const sfBtn = ev.target.closest("[data-apo-sf]");
    if (sfBtn) {
      openApoSfLaunch(sfBtn.dataset.apoSf);
      return;
    }
    const mailBtn = ev.target.closest("[data-apo-mail]");
    if (mailBtn) {
      apoMakeDraft(mailBtn);
      return;
    }
    const openBtn = ev.target.closest("[data-sf-open]");
    if (openBtn) {
      const key = openBtn.dataset.sfOpen;
      const s = sfOf(key);
      s.open = !s.open;
      if (s.open && s.records === null && !s.picked && !s.done) {
        const card = openBtn.closest(".home-card");
        const title = card ? (card.querySelector(".home-card-title") || {}).textContent || "" : "";
        s.q = searchNameFromTitle(title);
        renderBoth();
        sfSearch(key);
        return;
      }
      renderBoth();
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
      renderBoth();
      return;
    }
    const reset = ev.target.closest("[data-sf-reset]");
    if (reset) {
      const key = reset.dataset.sfReset;
      const s = sfOf(key);
      s.picked = null; s.done = ""; s.error = "";
      renderBoth();
      return;
    }
    const lose = ev.target.closest("[data-sf-lose]");
    if (lose) { sfLose(lose.dataset.sfLose); return; }
    const closeBtn = ev.target.closest("[data-sf-close]");
    if (closeBtn) { sfOf(closeBtn.dataset.sfClose).open = false; renderBoth(); return; }
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
  mail: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  doc: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 3.5h8l4 4v13H6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 12h6M9 15.5h6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

function openCardSheet(key) {
  const it = homeItems[key];
  if (!it) return;
  const ev0 = (dayEvents || []).find((x) => (x.id || (x.title + "@" + x.start)) === key);
  const botId = (homeItems[key] && homeItems[key].botId) || "";
  const sub = `${dateLabel(selDate)} ${it.time} ・ ${it.done ? "商談済み" : "予定"}`;
  const act = (attr, ico, label) =>
    `<button type="button" class="kb-sheet-act" ${attr}><span class="kb-sheet-ico">${ico}</span>${label}<span class="kb-sheet-arrow">${ICO.arrow}</span></button>`;
  const html =
    `<div class="kb-sheet-title">${escH(it.company || it.title)}</div>
     <div class="kb-sheet-sub">${escH(sub)}</div>
     ${!it.done && ev0 ? act("data-sheet-rec", ICO.mic, "録音する") : ""}
     ${it.done && botId ? act("data-sheet-mail", ICO.mail, "御礼メールを作る") : ""}
     ${it.done ? act("data-sheet-sfedit", ICO.cloud, "Salesforceを更新") : ""}
     <a class="kb-sheet-act" href="${it.link}"><span class="kb-sheet-ico">${ICO.doc}</span>${escH(it.openLabel)}<span class="kb-sheet-arrow">${ICO.arrow}</span></a>
     ${!it.done ? act("data-sheet-sf", ICO.cloud, "SF商談を選ぶ・リスケ失注") : ""}
     <button type="button" class="kb-sheet-close" data-sheet-close>閉じる</button>`;
  const sheet = window.kbSheet(html);
  sheet.el.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-sheet-rec]")) { sheet.close(); setTimeout(() => startRecording(key), 120); return; }
    if (ev.target.closest("[data-sheet-mail]")) { sheet.close(); setTimeout(() => openMail(botId, key), 120); return; }
    if (ev.target.closest("[data-sheet-sfedit]")) { sheet.close(); setTimeout(() => openSfEdit(key), 120); return; }
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
    window._autoJoin = !!(cd && cd.autoJoin);
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
  loadMyApos();
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
  loadMyApos();
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
      rankBy = b.dataset.by;
      document.querySelectorAll(".home-rank-tab").forEach((x) => x.classList.toggle("active", x === b));
      loadRank();
    });
  });
  document.querySelectorAll(".home-rank-round").forEach((b) => {
    b.addEventListener("click", () => {
      const row = b.parentElement;
      if (b.dataset.rank) rankSort = b.dataset.rank;
      else rankRound = b.dataset.round || "";
      row.querySelectorAll(".home-rank-round").forEach((x) => x.classList.toggle("active", x === b));
      loadRank();
    });
  });
  updateHead();
  load();
  loadRank();
});

// ───────────────────────────────────────────────────────────
// 割り振られたアポ（自分が担当になった商談）
// メールが用意できているか、Salesforceを立ち上げたかがここで分かる。
// ───────────────────────────────────────────────────────────
function apoEsc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function apoTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "時刻未定";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

let myApos = [];

async function loadMyApos() {
  const box = document.getElementById("homeApoList");
  if (!box) return;
  box.innerHTML = '<div class="home-empty">読み込み中…</div>';
  try {
    const q = new URLSearchParams({ date: selDate || todayStr });
    // 動作確認用：?many=1 で件数を増やせる（本番では無視される）
    try { if (new URLSearchParams(location.search).get("many")) q.set("many", "1"); } catch {}
    const d = await (await fetch("/api/apo/mine?" + q.toString())).json();
    if (d.error) throw new Error(d.error);
    myApos = d.items || [];
    renderMyApos();
  } catch (e) {
    myApos = [];
    box.innerHTML = `<div class="home-empty home-empty-s">読み込めませんでした：${apoEsc(e.message)}</div>`;
  }
}

// 手元の配列から描き直す（Salesforceのパネルを開いたときにも呼ぶ）
function renderMyApos() {
  const box = document.getElementById("homeApoList");
  const cnt = document.getElementById("homeApoCount");
  if (!box) return;
  if (cnt) cnt.textContent = myApos.length ? `${myApos.length}件` : "";
  box.innerHTML = myApos.length
    ? myApos.map(apoHomeCard).join("")
    : '<div class="home-empty home-empty-s">この日に割り振られたアポはありません。</div>';
}

// 商談リストとアポリストの両方を描き直す
function renderBoth() {
  render();
  renderMyApos();
}

function apoHomeCard(x) {
  return ((x) => {
      const chip = (label, st) => {
        if (!st) return `<span class="ln-tag">${label}：未作成</span>`;
        if (st.status === "draft") return `<span class="ln-tag ln-tag-draft">${label}：下書き済</span>`;
        if (st.status === "sent") return `<span class="ln-tag ln-tag-rep">${label}：送信済</span>`;
        return `<span class="ln-tag ln-tag-none">${label}：失敗</span>`;
      };
      const m = x.mail || {};
      const needMail = !m.confirm;
      const sfKey = "apo:" + x.slug;   // カードを特定するキー（パネルの差し込み先）
      return `<div class="home-card home-card-v ap-home-card${needMail ? " home-card-plan" : ""}" data-card="${apoEsc(sfKey)}">
        <div class="home-card-row">
          <div class="home-card-main">
            <div class="home-card-top">
              <span class="home-time">${apoEsc(apoTime(x.start))}</span>
              ${x.business ? `<span class="ap-biz-badge ap-biz-${apoEsc(x.business)}">${apoEsc(x.business)}</span>` : ""}
              ${x.inviteEventId ? '<span class="home-badge home-badge-done">予定作成済</span>' : ""}
            </div>
            <div class="home-card-title">${apoEsc(x.title || "")}</div>
            <div class="home-card-meta ln-who">
              <span class="ln-tag ln-tag-intern">アポ獲得：${apoEsc(x.setter || "-")}</span>
              ${chip("確定メール", m.confirm)}${chip("前日", m.reminder)}
            </div>
            ${x.clientEmail
              ? `<div class="home-card-meta ap-home-addr">${apoEsc(x.clientEmail)}</div>`
              : '<div class="home-card-meta cc-warn">お客様の宛先が未登録です（メールを出せません）</div>'}
          </div>
          <div class="home-card-actions">
            <button type="button" class="btn" data-apo-mail="${apoEsc(x.slug)}"${m.confirm ? " disabled" : ""}>${
              m.confirm ? (m.confirm.status === "sent" ? "送信済み" : "下書き作成済み") : "メール送付（下書きへ）"
            }</button>
            <button type="button" class="btn sf-btn-secondary" data-apo-sf="${apoEsc(x.slug)}">SF立ち上げ</button>
            <a class="btn ghost" href="${apoEsc(x.smartUrl)}" target="_blank" rel="noopener">会議室</a>
          </div>
        </div>
      </div>`;
  })(x);
}

// 「メール送付（下書きへ）」…担当者のGmailに下書きを作り、Gmailを開くリンクを出す
async function apoMakeDraft(btn) {
  const slug = btn.dataset.apoMail;
  const x = myApos.find((a) => a.slug === slug);
  if (!x) return;
  if (!x.clientEmail) {
    alert("お客様の宛先が未登録です。\n\nアポ振り分けの画面で宛先を入れてから、もう一度お試しください。");
    return;
  }
  if (!confirm(`アポ確定メールを用意します。\n\n${x.title}\n宛先：${x.clientEmail}\n\nよろしいですか？`)) return;
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "作成中…";
  try {
    const r = await fetch(`/api/smart-links/${encodeURIComponent(slug)}/mail`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "confirm" }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "用意できませんでした");
    x.mail = Object.assign({}, x.mail, {
      confirm: { status: d.draft ? "draft" : "sent", at: new Date().toISOString() },
    });
    renderMyApos();
    cardPanel("apo:" + slug,
      `<div class="home-inline-h">${d.draft ? "下書きを作りました" : "送信しました"}</div>` +
      `<div class="home-sf-msg">宛先：${apoEsc(x.clientEmail)}</div>` +
      (d.draft
        ? `<div class="home-sf-row"><a class="btn" href="https://mail.google.com/mail/u/0/#drafts" target="_blank" rel="noopener">Gmailの下書きを開く</a>` +
          `<button class="btn sf-btn-secondary home-sf-mini" data-inline-close="1" type="button">閉じる</button></div>` +
          `<div class="home-sf-note">内容を確認してから、Gmailの画面で送信してください。</div>`
        : `<div class="home-sf-row"><button class="btn sf-btn-secondary home-sf-mini" data-inline-close="1" type="button">閉じる</button></div>`) +
      (d.noRoom
        ? `<div class="home-sf-err">「設定 → 登録リンク」に会議室URLが登録されていません。このままだとお客様が入室できません。</div>`
        : ""));
  } catch (e) {
    alert("メールを用意できませんでした:\n" + e.message);
    btn.disabled = false; btn.textContent = label;
  }
}

// 「SF立ち上げ」…Salesforce商談立ち上げの画面を、その1件に絞ってカード内に開く。
// 画面を移動せずに、リード検索からコンバートまでそのまま行える。
function openApoSfLaunch(slug) {
  const x = myApos.find((a) => a.slug === slug);
  if (!x) return;
  const day = String(x.start || "").slice(0, 10) || selDate;
  const src = `sf-launch.html?embed=1&date=${encodeURIComponent(day)}&q=${encodeURIComponent(x.title || "")}`;
  const key = "apo:" + slug;

  if (window.kbIsMobile && window.kbIsMobile()) {
    const old = document.querySelector(".kb-full");
    if (old) old.remove();
    const full = document.createElement("div");
    full.className = "kb-full";
    full.innerHTML =
      `<div class="kb-full-head">
         <span class="kb-full-t">${escH(x.title || "Salesforce 立ち上げ")}</span>
         <button type="button" class="kb-full-x" aria-label="閉じる">閉じる</button>
       </div>
       <iframe class="kb-full-frame" src="${escH(src)}" title="SF立ち上げ"></iframe>`;
    document.body.appendChild(full);
    document.body.style.overflow = "hidden";
    const close = () => { full.remove(); document.body.style.overflow = ""; };
    full.querySelector(".kb-full-x").addEventListener("click", close);
    return;
  }

  cardPanel(key,
    `<div class="home-inline-h">Salesforce 立ち上げ
       <button type="button" class="home-sf-hide" data-inline-close="1" style="width:auto;padding:0 0 0 10px">閉じる</button>
     </div>
     <iframe class="home-sf-frame apo-sf-frame" src="${escH(src)}" title="SF立ち上げ"></iframe>`);
}

// 埋め込んだ画面から高さを受け取って、iframeの高さを合わせる
window.addEventListener("message", (ev) => {
  const d = ev && ev.data;
  if (!d || d.type !== "kb-embed-height") return;
  const h = Math.max(220, Math.min(1600, parseInt(d.height, 10) || 0));
  // かささぎの埋め込み
  document.querySelectorAll(".apo-sf-frame").forEach((f) => { f.style.height = Math.min(h, 900) + "px"; });
  // SF更新モーダルの埋め込み（中身の高さに合わせて、下の空白を作らない）
  document.querySelectorAll(".sfm-frame").forEach((f) => { f.style.height = h + "px"; });
  // カード内に開いた旧パネル
  document.querySelectorAll(".home-sf-frame").forEach((f) => { f.style.height = Math.min(h, 700) + "px"; });
});
