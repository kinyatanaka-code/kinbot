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

// 行の操作に使う小さなアイコン。名前は吹き出しで出す。
const HOME_ICONS = {
  rec:  "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zm7 9a7 7 0 0 1-6 6.9V22h-2v-3.1A7 7 0 0 1 5 12h2a5 5 0 0 0 10 0z",
  sf:   "M10.3 7.2a3.1 3.1 0 0 1 5.2.9 2.6 2.6 0 0 1 1.1-.2 2.7 2.7 0 0 1 2.6 2.2 2.5 2.5 0 0 1 1.8 2.4 2.6 2.6 0 0 1-2.6 2.6H7.6a3.8 3.8 0 0 1-3.8-3.8 3.8 3.8 0 0 1 3.8-3.8c.4 0 .9.1 1.3.3a3.1 3.1 0 0 1 1.4-.6z",
  open: "M4 4h7v2H6v12h12v-5h2v7H4zm9 0h7v7h-2V7.4l-8.3 8.3-1.4-1.4L16.6 6H13z",
  mail: "M3 5h18v14H3zm2 2v.6l7 4.4 7-4.4V7zm0 3v7h14v-7l-7 4.4z",
  cal:  "M7 2v2h10V2h2v2h3v18H2V4h3V2zm13 8H4v10h16zm-9 2v2H7v-2zm6 0v2h-4v-2z",
  trash: "M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12H7zm3 2v8h1.5v-8zm4.5 0v8H15v-8z",
  more: "M5 10.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4zm7 0a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4zm7 0a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z",
  sfcheck: "M10.5 3a7.5 7.5 0 1 0 4.55 13.46l4.24 4.25 1.42-1.42-4.25-4.24A7.5 7.5 0 0 0 10.5 3zm0 2a5.5 5.5 0 1 1 0 11 5.5 5.5 0 0 1 0-11zm-.7 7.9L6.8 9.9l1.2-1.2 1.8 1.8 3.4-3.4 1.2 1.2z",
  // 御礼メールの画面で使うもの
  gen: "M12 2.5l1.9 5.1 5.1 1.9-5.1 1.9L12 16.5l-1.9-5.1L5 9.5l5.1-1.9zM19 15l.9 2.4 2.4.9-2.4.9L19 21.6l-.9-2.4-2.4-.9 2.4-.9zM5.5 14l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z",
  draft: "M2 21l20-9L2 3v7l13 2-13 2z",
  copy: "M8 3h9a2 2 0 0 1 2 2v11h-2V5H8zM5 7h9a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zm0 2v10h9V9z",
  gmail: "M3 5h18v14H3zm2 2v.6l7 4.4 7-4.4V7zm0 3v7h14v-7l-7 4.4z",
  tpl: "M4 4h16v4H4zm0 6h7v10H4zm9 0h7v4h-7zm0 6h7v4h-7z",
  doc: "M4 3h9l7 7v11H4zm2 2v14h12v-8h-6V5zm2 8h8v2H8zm0 3h8v2H8z",
  // テンプレート（型）の呼び出し・保存
  tplin: "M3 5h9v2H3zm0 5h9v2H3zm0 5h9v2H3zm14-8 5 5-5 5v-3.2h-4.2v-3.6H17z",
  tpluse: "M3 5h9v2H3zm0 5h9v2H3zm0 5h9v2H3zm14-8 5 5-5 5v-3.2h-4.2v-3.6H17z",
  tplsave: "M11 3h2v8h3.2L12 16.4 7.8 11H11zM4 17h16v3H4z",
  tpledit: "M3 17.3 14.1 6.2l3.7 3.7L6.7 21H3zM15.5 4.8l2-2a1.4 1.4 0 0 1 2 0l1.7 1.7a1.4 1.4 0 0 1 0 2l-2 2z",
  tpldel: "M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12H7zm3 2v8h1.5v-8zm4.5 0v8H15v-8z",
  // チームへ共有（人が3人）
  tplshare: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 1.5c-3 0-6 1.5-6 3.5V19h12v-3c0-2-3-3.5-6-3.5zM17.5 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zm0 1.5c-.8 0-1.6.15-2.3.42 1.1.8 1.8 1.85 1.8 3.08V19H23v-2.6c0-1.7-2.5-2.9-5.5-2.9z",
};

// アイコンのボタンを1つ作る。
// state は need（やることが残っている）／done（もう済んだ）／空。
// アイコンの下に出す短い名前。長いと横に広がるので、2〜4文字にそろえる。
const HOME_ICON_NAMES = {
  rec: "録音", sf: "SF", open: "開く", mail: "メール", cal: "会議室", trash: "外す", more: "その他",
  sfcheck: "SF確認",
  gen: "文面を作る", draft: "下書き", copy: "コピー", gmail: "Gmail", tpl: "テンプレ", doc: "資料URL",
  tplin: "型を入れる", tpluse: "この型で作る", tplsave: "型を保存", tpledit: "型を直す", tpldel: "型を消す", tplshare: "みんなへ",
};

function hIcon(kind, label, attrs = "", state = "", tag = "button") {
  const path = HOME_ICONS[kind] || "";
  const name = HOME_ICON_NAMES[kind] || "";
  const inner = `<span class="hib-btn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg></span>` +
    `<span class="hib-name">${escH(name)}</span>` +
    `<span class="hib-tip">${escH(label)}</span>`;
  const cls = `hib${state ? " hib-" + state : ""}`;
  return tag === "a"
    ? `<a class="${cls}" ${attrs} aria-label="${escH(label)}">${inner}</a>`
    : `<button type="button" class="${cls}" ${attrs} aria-label="${escH(label)}">${inner}</button>`;
}

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
// その週の日曜日を返す（Googleカレンダーに合わせて日曜はじまり）
function mondayOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const x = new Date(y, m - 1, d);
  x.setDate(x.getDate() - x.getDay());
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
  const w = ["日", "月", "火", "水", "木", "金", "土"];
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
  lastRows = items;
  renderTodoBar(items);
  // 今日の商談だけ、Gmailの送信済みと照らし合わせる（1回だけ聞く）
  if (selDate === todayStr && !mailSentAsked) {
    mailSentAsked = true;
    checkMailSent(items);
    checkSfUpdated(items);
  }

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
      // 1行なので短く。詳しい案内は印（バッジ）で足りる。
      meta = window._autoJoin && !e.hasUrl ? "URLなし（自動入室されません）" : "";
    }
    const summary = (m && m.summary && m.summary.overview) ? String(m.summary.overview).slice(0, 90) + "…" : "";
    const openLabel = m ? "商談を開く" : "会社を開く";
    const link = m && m.bot_id ? "history.html?m=" + encodeURIComponent(m.bot_id) : "history.html?company=" + enc;
    homeItems[key] = { title, time, company, done: !!m, link, openLabel, botId: (m && m.bot_id) || "" };
    // 1行1商談。操作は小さなアイコンにして、押すとモーダルが開く。
    // やることが残っているものだけ色を付けるので、見れば次の一手が分かる。
    // 並びは 録音 → SF → メール → 開く。4つとも必ず出す。
    // 押せない場合も場所は空けておく（行ごとに並びが変わると探しにくいため）。
    // 4つとも、いつでも押せる。
    // まだ済んでいないものだけ色を濃くして、次にやることが分かるようにする。
    const acts =
      (m
        ? hIcon("rec", "録音済み（もう一度録る）", `data-rec="${escH(key)}"`, "done")
        : hIcon("rec", "録音する", `data-rec="${escH(key)}"`, "need")) +
      (m
        ? hIcon("sf",
            sfDoneMap[m.bot_id] ? `SFを更新（済み：${sfDoneMap[m.bot_id]}）` : "SFを更新",
            `data-sfedit="${escH(key)}"`,
            sfDoneMap[m.bot_id] ? "done" : "need")
        : hIcon("sf", s.open ? "SF商談を閉じる" : "SF商談を選ぶ", `data-sf-open="${escH(key)}"`, "done")) +
      (m && m.bot_id
        ? hIcon("mail",
            mailSentMap[m.bot_id] ? `御礼メール（送信済み：${mailSentMap[m.bot_id]}）` : "御礼メール",
            `data-mail="${escH(m.bot_id)}" data-key="${escH(key)}"`,
            mailSentMap[m.bot_id] ? "done" : "need")
        : hIcon("mail", "御礼メール（商談の記録がまだありません）", `data-mail-none="${escH(key)}"`, "done")) +
      hIcon("open", openLabel, `href="${link}"`, "done", "a");

    return `<div class="home-row" style="--i:${idx}"><div class="home-card home-line${m ? " is-done" : ""}" data-card="${escH(key)}" data-company="${escH(company || "")}">
      <div class="hl-row">
        <div class="hl-time">${escH(time)}</div>
        <div class="hl-main">
          <div class="hl-title">${escH(title)}</div>
          <div class="hl-meta"${summary ? ` title="${escH(summary)}"` : ""}>${badges}${meta}</div>
        </div>
        <div class="hl-acts">${acts}</div>
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
  const lead = first.getDay(); // 日曜はじまり（Googleカレンダーに合わせる）
  const days = new Date(y, mo, 0).getDate();
  const marks = new Set(allMeetings.filter((m) => !isOtherCat(m)).map((m) => ymd(m.created_at)));
  let html = '<div class="home-mini-w">' +
    ["日","月","火","水","木","金","土"].map((w, i) =>
      `<span class="${i === 0 ? "is-sun" : i === 6 ? "is-sat" : ""}">${w}</span>`).join("") + "</div>";
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

// 御礼メールのテンプレート。
// 選んで作り直す／いまの文面を型として保存する。
// 「新規作成」と「返信」を切り替える。
// 返信のときは、これまでのやり取りを一覧で出して、どのメールに返すかを選んでもらう。
// 選ぶと、そのやり取りの流れに合わせた文面をAIが作り直す。
function wireMailMode(box, botId, side) {
  // いま画面に出ている文面は、モードごとに覚えておく。
  // 行ったり来たりしても、書きかけの文面が消えないようにするため。
  // 送り方は「返信」を既定にする。
  // やり取りが見つからなかったときだけ、新規作成に戻す。
  const ctx = { mode: "reply", threadId: "", to: "", stash: { new: null, reply: null } };
  const su = () => box.querySelector(".home-mail-subj");
  const ta = () => box.querySelector(".home-mail-body");
  const list = box.querySelector(".mail-reply-list");
  const st = box.querySelector(".mail-mode-st");
  const qIn = box.querySelector(".mail-reply-q");
  const say = (t) => { if (st) st.textContent = t || ""; };
  let loaded = false;

  const setMode = (mode) => {
    if (mode === ctx.mode) return;
    ctx.stash[ctx.mode] = { subject: su().value, body: ta().value };
    ctx.mode = mode;
    box.querySelectorAll(".mail-mode-b").forEach((b) => b.classList.toggle("on", b.dataset.mode === mode));
    // 返信のときだけ、右の欄に返信先の一覧を出す
    if (mode === "reply") side.open("reply", "どのメールに返信しますか");
    else if (side.current === "reply") side.close();
    const keep = ctx.stash[mode];
    if (keep) { su().value = keep.subject; ta().value = keep.body; ta().dispatchEvent(new Event("input")); }
    if (mode === "new") { ctx.threadId = ""; ctx.to = ""; say(""); }
    else {
      say(ctx.threadId ? (ctx.to ? `返信先：${ctx.to}` : "返信先を選びました") : "返信するメールを選んでください");
      if (!loaded) loadThreads("");
    }
  };

  // 開いたときに、返信の準備をしておく。
  // やり取りが1件だけなら、それを自動で選んで返信の文面まで作る。
  async function startAsReply() {
    box.querySelectorAll(".mail-mode-b").forEach((b) => b.classList.toggle("on", b.dataset.mode === "reply"));
    side.open("reply", "どのメールに返信しますか");
    say("これまでのやり取りを探しています…");
    const found = await loadThreads("");
    if (!found) {
      // やり取りが無いので、新規作成に戻す
      ctx.mode = "new";
      box.querySelectorAll(".mail-mode-b").forEach((b) => b.classList.toggle("on", b.dataset.mode === "new"));
      if (side.current === "reply") side.close();
      say("やり取りが見つからないので、新規作成にしました");
      return;
    }
    // 1件だけなら、迷わないので自動で選ぶ
    const btns = list.querySelectorAll(".mail-th");
    if (btns.length === 1) {
      await pickThread(btns[0]);
    } else {
      say("返信するメールを選んでください");
    }
  }

  // 過去のやり取りを探して一覧にする。
  // やり取りが見つかったかどうかを返す。
  async function loadThreads(q) {
    if (!list) return false;
    loaded = true;
    list.innerHTML = '<div class="mail-reply-note">これまでのやり取りを探しています…</div>';
    try {
      const url = `/api/meetings/${encodeURIComponent(botId)}/gmail-threads` + (q ? `?q=${encodeURIComponent(q)}` : "");
      const d = await (await fetch(url)).json();
      if (d.needScope) {
        list.innerHTML = '<div class="mail-reply-note">Gmailの権限が足りません。<a class="home-sf-link" href="settings.html">設定</a>から連携し直してください。</div>';
        return false;
      }
      if (!d.connected) {
        list.innerHTML = '<div class="mail-reply-note">Googleが連携されていません。<a class="home-sf-link" href="settings.html">設定</a>から連携してください。</div>';
        return false;
      }
      const th = d.threads || [];
      if (qIn && !qIn.value) qIn.value = d.query || "";
      if (!th.length) {
        list.innerHTML = `<div class="mail-reply-note">「${escH(d.query || "")}」ではやり取りが見つかりませんでした。上の欄で別の言葉でも探せます。</div>`;
        return false;
      }
      list.innerHTML = th.map((t) => `
        <button type="button" class="mail-th" data-th="${escH(t.threadId)}" data-to="${escH(t.from || "")}">
          <span class="mail-th-top">
            <span class="mail-th-from">${escH(t.from || "")}</span>
            <span class="mail-th-date">${escH(fmtMailDate(t.date))}${t.count > 1 ? `・${t.count}通` : ""}</span>
          </span>
          <span class="mail-th-subj">${escH(t.subject || "（件名なし）")}</span>
          <span class="mail-th-snip">${escH((t.snippet || "").slice(0, 90))}</span>
        </button>`).join("");
      return true;
    } catch (e) {
      list.innerHTML = `<div class="mail-reply-note">読み込みに失敗しました（${escH(e.message)}）</div>`;
      return false;
    }
  }

  // 返信先を選んだら、そのやり取りに合わせた文面をAIが作る
  async function pickThread(btn) {
    const threadId = btn.dataset.th;
    list.querySelectorAll(".mail-th").forEach((b) => b.classList.toggle("on", b === btn));
    ctx.threadId = threadId;
    // 書きかけの文面があるときは、消してよいか聞く
    if (ta().value.trim() && !confirm("このやり取りに合わせた返信を作ります。いま書いてある文面は置き換わります。よろしいですか。")) {
      say("返信先を選びました（文面はそのままです）");
      return;
    }
    say("この相手への返信を作っています…");
    try {
      const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/gmail-reply-draft`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId }),
      });
      const d = await r.json();
      if (!r.ok || !d.body) throw new Error(d.error || "作れませんでした");
      su().value = d.subject || su().value;
      ta().value = d.body;
      ta().dispatchEvent(new Event("input"));
      ctx.to = d.to || "";
      const toEl = box.querySelector(".home-mail-to");
      if (toEl && ctx.to) { toEl.value = ctx.to; toEl.dispatchEvent(new Event("input")); }
      say(ctx.to ? `返信先：${ctx.to}` : "返信先を選びました");
    } catch (e) {
      say("文面を作れませんでした（" + e.message + "）。文面はそのまま返信として送れます。");
    }
  }

  box.querySelectorAll(".mail-mode-b").forEach((b) =>
    b.addEventListener("click", () => setMode(b.dataset.mode)));
  if (list) list.addEventListener("click", (e) => {
    const b = e.target.closest(".mail-th");
    if (b) pickThread(b);
  });
  const sb = box.querySelector("[data-reply-search]");
  if (sb) sb.addEventListener("click", () => loadThreads(qIn ? qIn.value.trim() : ""));
  if (qIn) qIn.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); loadThreads(qIn.value.trim()); }
  });

  // 本文のURLを、押して開ける形で下に並べる。
  // 文面に貼ったURLが正しいか、送る前に確かめられるようにする。
  const linksBox = box.querySelector(".mail-links");
  function showLinks() {
    if (!linksBox) return;
    const text = ta() ? ta().value : "";
    // http/https で始まるものを拾う。末尾の句読点やカッコは外す。
    // 全角のカッコや句読点は、URLの一部ではないので拾わない
    const found = [...new Set((String(text).match(/https?:\/\/[^\s<>"'（）()【】「」、。]+/g) || [])
      .map((u) => u.replace(/[.,:;]+$/, "")))];
    if (!found.length) { linksBox.hidden = true; linksBox.innerHTML = ""; return; }
    linksBox.hidden = false;
    linksBox.innerHTML =
      `<span class="mail-links-lb">本文のリンク（押すと開きます）</span>` +
      found.map((u) => {
        const kind = /\/j\//.test(u) ? "会議室" : /\/d\//.test(u) ? "資料" : "";
        return `<a class="mail-link" href="${escH(u)}" target="_blank" rel="noopener">` +
          (kind ? `<b>${kind}</b>` : "") +
          `<span>${escH(u.length > 64 ? u.slice(0, 61) + "…" : u)}</span></a>`;
      }).join("");
  }
  if (ta()) {
    ta().addEventListener("input", showLinks);
    showLinks();
  }

  // 開いたら、まず返信の準備をする（やり取りが無ければ新規作成に戻る）
  startAsReply();

  return ctx;
}

// メールの日付を「8/4(月) 14:30」の形にする
function fmtMailDate(s) {
  const d = new Date(s);
  if (!s || isNaN(d.getTime())) return String(s || "").slice(0, 16);
  const w = "日月火水木金土"[d.getDay()];
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()}(${w}) ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// メールの右側に出す欄。テンプレ・返信先・資料URL・下書きの結果を、
// 同じ場所に入れ替えて出す（アイコンを押したら右に出る、で統一する）。
function mailSide(box) {
  const el = box.querySelector(".mail-side");
  const titleEl = box.querySelector(".mail-side-t");
  const modalBox = box.closest(".sfm-box");
  const secs = [...box.querySelectorAll(".mail-side-sec")];
  const iconOf = { tpl: "[data-tpl-toggle]", reply: null, doc: "[data-doc-make]", draft: null };
  let now = "";

  const markIcons = () => {
    for (const [kind, sel] of Object.entries(iconOf)) {
      if (!sel) continue;
      const b = box.querySelector(sel);
      if (b) b.classList.toggle("hib-need", now === kind);
    }
  };

  return {
    get current() { return now; },
    open(kind, title) {
      now = kind;
      if (el) el.hidden = false;
      if (titleEl) titleEl.textContent = title || "";
      secs.forEach((x) => { x.hidden = x.dataset.sec !== kind; });
      if (modalBox) modalBox.classList.add("sfm-box-mailwide");
      markIcons();
      return box.querySelector(`.mail-side-sec[data-sec="${kind}"]`);
    },
    close() {
      now = "";
      if (el) el.hidden = true;
      if (modalBox) modalBox.classList.remove("sfm-box-mailwide");
      markIcons();
    },
    toggle(kind, title) {
      if (now === kind) this.close();
      else this.open(kind, title);
    },
    sec(kind) { return box.querySelector(`.mail-side-sec[data-sec="${kind}"]`); },
  };
}

function wireMailTemplates(box, botId, tpls, side) {
  const sel = box.querySelector(".mail-tpl-sel");
  const st = box.querySelector(".mail-tpl-st");
  const say = (t, ms) => {
    if (!st) return;
    st.textContent = t || "";
    if (ms) setTimeout(() => { if (st.textContent === t) st.textContent = ""; }, ms);
  };

  // 文面を作る。
  // 「文面を作る」＝商談の内容から、「型を入れる」＝選んだ型に沿って作る。
  // どちらも同じ作り方なので、ひとつにまとめる。
  const note = box.querySelector(".home-mail-note");
  const doGen = async (btn, useTpl) => {
    const nm = btn.querySelector(".hib-name");
    const before = nm ? nm.textContent : "";
    const tell = (t, ms) => {
      say(t, ms);
      if (note) {
        note.textContent = t || "";
        if (ms) setTimeout(() => { if (note.textContent === t) note.textContent = ""; }, ms);
      }
    };
    const ta = box.querySelector(".home-mail-body");
    if (ta.value.trim() && !confirm("いま書いてある文面を、作り直したもので置き換えます。よろしいですか。")) return;
    btn.disabled = true;
    if (nm) nm.textContent = "作成中…";
    tell("文面を作っています…");
    try {
      const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/thanks`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId: useTpl && sel ? sel.value : "" }),
      });
      const d = await r.json();
      if (!r.ok || !(d.body || d.text)) throw new Error(d.error || "作れませんでした");
      box.querySelector(".home-mail-subj").value = d.subject || box.querySelector(".home-mail-subj").value;
      ta.value = d.body || d.text || "";
      ta.dispatchEvent(new Event("input"));
      tell(d.templateName ? `「${d.templateName}」で作りました` : "商談内容から作りました", 6000);
    } catch (e) { tell("失敗: " + e.message, 8000); }
    finally { btn.disabled = false; if (nm) nm.textContent = before; }
  };

  // 商談の内容から文面を作る（開いたときには作らない）
  const genBtn = box.querySelector("[data-mail-gen]");
  if (genBtn) genBtn.addEventListener("click", () => doGen(genBtn, false));

  // 選んだ型で作り直す
  const applyBtn = box.querySelector("[data-tpl-apply]");
  if (applyBtn) applyBtn.addEventListener("click", () => doGen(applyBtn, true));

  // 資料URLをその場で発行する。
  // どの資料にするかは、右の欄から選んでもらう（番号を打つより間違えにくい）。
  const docBtn = box.querySelector("[data-doc-make]");
  if (docBtn) docBtn.addEventListener("click", async () => {
    if (side.current === "doc") { side.close(); return; }
    const sec = side.open("doc", "資料URLを作る");
    const list = sec.querySelector(".mail-doc-list");
    list.innerHTML = `<div class="mail-side-note">資料の一覧を読んでいます…</div>`;
    try {
      const d2 = await (await fetch("/api/docs")).json();
      const docs = (d2.docs || []).filter((x) => x.active !== false);
      if (!docs.length) {
        list.innerHTML = `<div class="mail-side-note">登録されている資料がありません。` +
          `<a class="home-sf-link" href="docs.html">資料トラッキング</a>で先に登録してください。</div>`;
        return;
      }
      list.innerHTML = docs.slice(0, 30).map((x) =>
        `<button type="button" class="mail-doc-pick" data-id="${escH(x.id)}" data-name="${escH(x.name)}">
           <span class="mail-doc-nm">${escH(x.name)}</span>
           <span class="mail-doc-sub">発行済み ${x.links || 0}件 ／ 閲覧 ${x.views || 0}回</span>
         </button>`).join("");
      list.querySelectorAll(".mail-doc-pick").forEach((b) =>
        b.addEventListener("click", async () => {
          const name = b.dataset.name;
          list.querySelectorAll(".mail-doc-pick").forEach((x) => x.classList.toggle("on", x === b));
          const st = document.createElement("div");
          st.className = "mail-side-note";
          st.textContent = "URLを作っています…";
          list.appendChild(st);
          try {
            const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/doc-link`, {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify({ docId: parseInt(b.dataset.id, 10) }),
            });
            const d3 = await r.json();
            if (!r.ok || !(d3.links && d3.links.length)) throw new Error(d3.error || "作れませんでした");
            // できたURLを本文に入れる（{資料URL} があればそこを置き換える）
            const ta = box.querySelector(".home-mail-body");
            const line = `${name}：${d3.links[0].url}`;
            if (ta.value.includes("{資料URL}")) ta.value = ta.value.replace(/\{資料URL\}/g, line);
            else ta.value = ta.value.trimEnd() + "\n\n" + line + "\n";
            ta.dispatchEvent(new Event("input"));
            st.innerHTML = `本文に入れました。<br><span class="dk-dim">${escH(d3.links[0].url)}</span>`;
          } catch (e) { st.textContent = "失敗: " + e.message; }
        }));
    } catch (e) {
      list.innerHTML = `<div class="mail-side-note">読み込めませんでした：${escH(e.message)}</div>`;
    }
  });

  // テンプレートのアイコンで、右の欄を開け閉めする
  const toggle = box.querySelector("[data-tpl-toggle]");
  if (toggle) toggle.addEventListener("click", () => side.toggle("tpl", "テンプレート"));

  // 差し込み語を、カーソルの位置に入れる
  box.querySelectorAll(".tag-ins").forEach((b) =>
    b.addEventListener("click", () => {
      // 押したボタンと同じ画面（メール／型を直す）の本文に入れる
      const pane = b.closest(".tple-edit") || box;
      const ta = pane.querySelector("textarea");
      if (!ta) return;
      const t = b.dataset.ins;
      const i = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, i) + t + ta.value.slice(ta.selectionEnd ?? i);
      ta.focus();
      ta.selectionStart = ta.selectionEnd = i + t.length;
    })
  );

  // 一覧（プルダウン）を作り直す。消したり名前を変えたあとに使う。
  const refreshSel = (keepId) => {
    if (!sel) return;
    // 自分のものと、チームで共有されているものを分けて並べる
    const mine = tpls.filter((t) => t.mine !== false);
    const team = tpls.filter((t) => t.mine === false);
    const opt = (t) => `<option value="${escH(t.id)}">${escH(t.name)}</option>`;
    sel.innerHTML =
      `<option value="">使わない（商談内容から作る）</option>` +
      (mine.length ? `<optgroup label="自分の型">${mine.map(opt).join("")}</optgroup>` : "") +
      (team.length
        ? `<optgroup label="チームの型">${team.map((t) =>
            `<option value="${escH(t.id)}">${escH(t.name)}（${escH(t.ownerName || t.owner || "")}）</option>`).join("")}</optgroup>`
        : "");
    sel.value = tpls.some((t) => t.id === keepId) ? keepId : "";
    syncBtns();
  };

  // 型を選んでいないときは「型を入れる」は押せない
  const applyBtn0 = box.querySelector("[data-tpl-apply]");
  const syncBtns = () => {
    const on = !!(sel && sel.value);
    if (applyBtn0) applyBtn0.classList.toggle("hib-off", !on);
  };

  // ── テンプレートを直す欄（アイコンの右に出す） ──
  const tName = box.querySelector(".tple-name");
  const tSubj = box.querySelector(".tple-subj");
  const tBody = box.querySelector(".tple-body");
  const tSt = box.querySelector(".tple-st");
  const tellT = (t, ms) => {
    if (!tSt) return;
    tSt.textContent = t || "";
    if (ms) setTimeout(() => { if (tSt.textContent === t) tSt.textContent = ""; }, ms);
  };

  // いま直している型のid
  let editingId = "";

  // 型を選んだときだけ、直す欄を出す
  const tplEdit = box.querySelector(".tple-edit");
  const showTpl = (on) => {
    if (tplEdit) tplEdit.hidden = !on;
    if (!on) editingId = "";
  };

  const openTplEditor = (id) => {
    const cur = tpls.find((t) => t.id === id);
    if (!cur) return;
    editingId = cur.id;
    if (tName) tName.value = cur.name || "";
    if (tSubj) tSubj.value = cur.subject || "";
    if (tBody) tBody.value = cur.body || "";

    // チームの型（他の人が共有したもの）は、そのまま使えるが直せない
    const own = cur.mine !== false;
    [tName, tSubj, tBody].forEach((el) => { if (el) el.readOnly = !own; });
    const saveB = box.querySelector("[data-tple-save]");
    const delB = box.querySelector("[data-tple-del]");
    [saveB, delB].forEach((b) => { if (b) b.classList.toggle("hib-off", !own); });
    const shareB = box.querySelector("[data-tple-share]");
    if (shareB) {
      shareB.hidden = !own;
      shareB.classList.toggle("hib-need", cur.shared === true);
      const nm = shareB.querySelector(".hib-name");
      if (nm) nm.textContent = cur.shared === true ? "共有中" : "みんなへ";
    }
    tellT(own ? "" : `${cur.ownerName || cur.owner || "ほかの人"}が共有した型です（そのまま使えます）`, 8000);
    showTpl(true);
  };

  // チームに共有する／やめる
  const shareBtn = box.querySelector("[data-tple-share]");
  if (shareBtn) shareBtn.addEventListener("click", async () => {
    const cur = tpls.find((t) => t.id === editingId);
    if (!cur || cur.mine === false) { tellT("自分の型だけ共有できます", 5000); return; }
    const on = cur.shared !== true;
    if (on && !confirm(`「${cur.name}」をチームのみんなが使えるようにします。よろしいですか？`)) return;
    shareBtn.disabled = true;
    tellT(on ? "共有しています…" : "共有を外しています…");
    try {
      const r = await fetch("/api/mail-templates/share", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: cur.id, shared: on }),
      });
      if (!r.ok) throw new Error(((await r.json()) || {}).error || "できませんでした");
      cur.shared = on;
      openTplEditor(cur.id);
      tellT(on ? "チームに共有しました" : "共有をやめました", 6000);
    } catch (e) { tellT("失敗: " + e.message, 8000); }
    finally { shareBtn.disabled = false; }
  });

  // 型を選んだら、その中身を右の欄に出す（メールの文面はそのまま）。
  // 「使わない」に戻したら閉じる。
  if (sel) sel.addEventListener("change", () => {
    syncBtns();
    if (sel.value) openTplEditor(sel.value);
    else showTpl(false);
  });
  syncBtns();

  // 型を保存する（名前も変えられる）
  const tSaveBtn = box.querySelector("[data-tple-save]");
  if (tSaveBtn) tSaveBtn.addEventListener("click", async () => {
    const cur = tpls.find((t) => t.id === editingId);
    if (!cur) { tellT("直す型が選ばれていません", 5000); return; }
    if (cur.mine === false) {
      tellT("これはほかの人が共有した型なので直せません。使うだけならそのままどうぞ", 8000);
      return;
    }
    const name = (tName ? tName.value : "").trim();
    const bodyText = (tBody ? tBody.value : "").trim();
    if (!name) { tellT("名前を入れてください", 5000); return; }
    if (!bodyText) { tellT("本文が空です", 5000); return; }
    tSaveBtn.disabled = true;
    tellT("保存しています…");
    try {
      // 送るのは自分の型だけ。チームの型を混ぜると、他の人の型を自分のものとして持ってしまう。
      const next = tpls
        .filter((t) => t.mine !== false)
        .map((t) => (t.id === cur.id
          ? { ...t, name, subject: (tSubj ? tSubj.value : "").trim(), body: bodyText } : t));
      const r = await fetch("/api/mail-templates", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ templates: next }),
      });
      if (!r.ok) throw new Error(((await r.json()) || {}).error || "保存できませんでした");
      const team1 = tpls.filter((t) => t.mine === false);
      tpls.length = 0; tpls.push(...next.map((t) => ({ ...t, mine: true })), ...team1);
      refreshSel(cur.id);
      tellT(`「${name}」を保存しました`, 6000);
    } catch (e) { tellT("失敗: " + e.message, 8000); }
    finally { tSaveBtn.disabled = false; }
  });

  // 型を消す
  const tDelBtn = box.querySelector("[data-tple-del]");
  if (tDelBtn) tDelBtn.addEventListener("click", async () => {
    const cur = tpls.find((t) => t.id === editingId);
    if (!cur) { tellT("消す型が選ばれていません", 5000); return; }
    if (cur.mine === false) {
      tellT("これはほかの人の型なので消せません", 6000);
      return;
    }
    if (!confirm(`テンプレート「${cur.name}」を消します。元には戻せません。よろしいですか。`)) return;
    tDelBtn.disabled = true;
    tellT("消しています…");
    try {
      const next = tpls.filter((t) => t.mine !== false && t.id !== cur.id);
      const r = await fetch("/api/mail-templates", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ templates: next }),
      });
      if (!r.ok) throw new Error(((await r.json()) || {}).error || "消せませんでした");
      const team2 = tpls.filter((t) => t.mine === false);
      tpls.length = 0; tpls.push(...next.map((t) => ({ ...t, mine: true })), ...team2);
      editingId = "";
      refreshSel("");
      showTpl(false);
      say(`「${cur.name}」を消しました`, 6000);
    } catch (e) { tellT("失敗: " + e.message, 8000); }
    finally { tDelBtn.disabled = false; }
  });

  // いまの文面を、新しいテンプレートとして保存する。
  // すでにある型を直したいときは、上のプルダウンから選ぶと直す画面が開く。
  const saveBtn = box.querySelector("[data-tpl-save]");
  if (saveBtn) saveBtn.addEventListener("click", async () => {
    const bodyText = box.querySelector(".home-mail-body").value.trim();
    const subj = box.querySelector(".home-mail-subj").value.trim();
    if (!bodyText) { say("本文が空です", 4000); return; }

    const input = prompt(
      "この文面に名前を付けて保存します。\n（例：初回・価格の話が出たとき）\n\n" +
      "次に使うときは、この形に沿って商談の内容が差し込まれます。", "");
    if (input === null) return;
    if (!input.trim()) { say("名前を入れてください", 4000); return; }
    const name = input.trim();

    saveBtn.disabled = true;
    say("保存しています…");
    try {
      const saved = { id: "t" + Date.now(), name, subject: subj, body: bodyText, mine: true };
      const next = [...tpls.filter((t) => t.mine !== false), saved];
      const r = await fetch("/api/mail-templates", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ templates: next }),
      });
      if (!r.ok) throw new Error(((await r.json()) || {}).error || "保存できませんでした");
      tpls.length = 0;
      tpls.push(...next);
      refreshSel("");
      say(`「${saved.name}」として保存しました`, 6000);
    } catch (e) { say("失敗: " + e.message); }
    finally { saveBtn.disabled = false; }
  });
}

// ───────────────────────────────────────────────────────────
// 会社名で探す
// 商談履歴を開かなくても、ここから直接その会社を開けるようにする。
// 一番よく使われている操作なので、ホームに置く。
// ───────────────────────────────────────────────────────────
function hfCompanies() {
  // これまでの商談から、会社ごとにまとめる
  const map = new Map();
  for (const m of allMeetings || []) {
    if (isOtherCat(m)) continue;
    // 「株式会社ベルク／町田様」から会社名だけを取り出す
    const name = String(companyFromTitle(m.title || ""))
      .split(/[／\/｜|]/)[0]
      .replace(/[^\s]*(?:様|さま|さん|御中)\s*$/, "")
      .replace(/[\s　]+$/, "")
      .trim();
    if (!name) continue;
    const cur = map.get(name);
    const at = +new Date(m.created_at);
    if (!cur) map.set(name, { name, n: 1, last: at, rep: repOf(m) });
    else { cur.n++; if (at > cur.last) { cur.last = at; cur.rep = repOf(m); } }
  }
  return [...map.values()].sort((a, b) => b.last - a.last);
}

function hfRender(word) {
  const box = $h("hfList");
  const clear = $h("hfClear");
  if (!box) return;
  const w = String(word || "").trim();
  if (clear) clear.hidden = false;   // クリアボタンは常に表示する
  if (!w) { box.hidden = true; box.innerHTML = ""; return; }

  // 空白や記号の違いは無視して探す。
  // 会社名だけでなく、営業担当の名前でも探せるようにする
  // （「田中さんの商談どれだっけ」を、ここから引けるようにするため）。
  const norm = (v) => String(v || "").replace(/[\s　（）()・,、.。]/g, "").toLowerCase();
  const key = norm(w);
  const hit = hfCompanies()
    .filter((c) => norm(c.name).includes(key) || norm(c.rep).includes(key))
    .slice(0, 8);

  box.hidden = false;
  box.innerHTML = hit.length
    ? hit.map((c) =>
        `<a class="hf-item" href="history.html?company=${encodeURIComponent(c.name)}">` +
        `<span class="hf-n">${escH(c.name)}</span>` +
        `<span class="hf-m">${c.n}件 ・ 最後は${escH(hfWhen(c.last))}${c.rep ? " ・ " + escH(c.rep) : ""}</span></a>`).join("")
    : `<div class="hf-none">「${escH(w)}」に当てはまる会社はありません。` +
      `<a href="history.html">商談履歴で探す</a></div>`;
}

function hfWhen(t) {
  const d = new Date(t);
  if (isNaN(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "今日";
  if (days === 1) return "昨日";
  if (days < 30) return `${days}日前`;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

(function hfInit() {
  const q = $h("hfQ");
  if (!q) return;
  let t = null;
  q.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => hfRender(q.value), 120);
  });
  // 最初の候補をそのまま開けるようにする
  q.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { q.value = ""; hfRender(""); q.blur(); return; }
    if (ev.key !== "Enter") return;
    const first = document.querySelector(".hf-item");
    if (first) location.href = first.getAttribute("href");
  });
  const clear = $h("hfClear");
  if (clear) clear.addEventListener("click", () => { q.value = ""; hfRender(""); q.focus(); });
  // 外を押したら閉じる
  document.addEventListener("click", (ev) => {
    if (!ev.target.closest(".home-find")) {
      const box = $h("hfList");
      if (box) box.hidden = true;
    } else if (ev.target === q && q.value.trim()) {
      hfRender(q.value);
    }
  });
})();

// ───────────────────────────────────────────────────────────
// やり残しの帯
// SFの更新・御礼メール・立ち上げの「し忘れ」を、上にまとめて出す。
// 押すと、その件だけに絞り込める。
// ───────────────────────────────────────────────────────────
let todoFilter = "";
let lastRows = [];

function renderTodoBar(rows) {
  setTimeout(applyTodoFilter, 0);
  const bar = $h("todoBar");
  if (!bar) return;

  // 今日の商談のうち、まだ済んでいないもの
  const now = Date.now();
  let recLeft = 0, sfLeft = 0, mailLeft = 0;
  for (const it of rows || []) {
    if (it.rec) {
      // 録音できている商談は、SF更新と御礼メールが残っていないかを見る。
      // ステージを更新した、または活動履歴が自動で作られたものは数えない。
      if (!sfDoneMap[it.rec.bot_id]) sfLeft++;
      // 実際にGmailから送っていれば、御礼メールは済んだものとして数えない
      if (it.rec.bot_id && !mailSentMap[it.rec.bot_id]) mailLeft++;
    } else if (it.ev && new Date(it.ev.start).getTime() < now) {
      // 時間が過ぎたのに録音が無いもの
      recLeft++;
    }
  }
  // 割り振られたアポのうち、まだ済んでいないもの
  const apos = myApos || [];
  const apoMail = apos.filter((x) => !(x.mail && x.mail.confirm)).length;
  const apoSf = apos.filter((x) => !(x.launch && x.launch.ok)).length;

  const items = [
    { key: "rec", n: recLeft, label: "録音まだ" },
    { key: "sf", n: sfLeft, label: "SF更新まだ" },
    { key: "mail", n: mailLeft, label: "御礼メールまだ" },
    { key: "apoSf", n: apoSf, label: "SF立ち上げまだ" },
    { key: "apoMail", n: apoMail, label: "確定メールまだ" },
  ].filter((x) => x.n > 0);

  if (!items.length) {
    bar.hidden = false;
    bar.innerHTML = '<div class="todo-none">やり残しはありません。</div>';
    return;
  }
  bar.hidden = false;
  bar.innerHTML =
    '<span class="todo-lb">やり残し</span>' +
    items.map((x) =>
      `<button type="button" class="todo-chip${todoFilter === x.key ? " on" : ""}" data-todo="${x.key}">` +
      `<b>${x.n}</b>${escH(x.label)}</button>`).join("") +
    (todoFilter ? '<button type="button" class="todo-clear" data-todo="">絞り込みを解除</button>' : "");

  // 押した種類だけに絞り込む。もう一度押すと元に戻る。
  if (!bar._wired) {
    bar._wired = true;
    bar.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-todo]");
      if (!b) return;
      const k = b.dataset.todo;
      todoFilter = todoFilter === k ? "" : k;
      applyTodoFilter();
      renderTodoBar(lastRows);
    });
  }
}

// 絞り込みを、いま出ている行に反映する。
// 描き直すと重いので、当てはまらない行を隠すだけにする。
function applyTodoFilter() {
  const has = (row, kind) => {
    const names = [...row.querySelectorAll(".hib.hib-need .hib-name")].map((x) => x.textContent);
    if (kind === "rec") return names.includes("録音");
    if (kind === "sf" || kind === "apoSf") return names.includes("SF");
    if (kind === "mail" || kind === "apoMail") return names.includes("メール");
    return true;
  };
  const isApo = (row) => row.classList.contains("ap-home-card");
  document.querySelectorAll(".home-line").forEach((row) => {
    if (!todoFilter) { row.closest(".home-row, .home-card") && (row.hidden = false); row.hidden = false; return; }
    const forApo = todoFilter.startsWith("apo");
    row.hidden = (forApo !== isApo(row)) || !has(row, todoFilter);
  });
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

// 御礼メールをモーダルで作る。文面が長いので、カード内では読めないため。
// 開いただけではAIを動かさない。「文面を作る」を押したときだけ作る。
// （毎回作ると待たされるうえ、テンプレートを選び直すと作り直しになって無駄になるため）
async function openMail(botId, key) {
  const it = homeItems[key] || {};
  const mo = openModal({
    title: "御礼メール",
    sub: it.company || it.title || "",
    inner: '<div class="home-sf-msg">読み込んでいます…</div>',
    wide: false,
  });
  const box = mo.body;
  if (!box) return;
  try {
    // 型の一覧と、この会社の資料URLだけを読む（文面は作らない）
    const [tpls, d] = await Promise.all([
      fetch("/api/mail-templates").then((r) => r.json()).then((x) => x.templates || []).catch(() => []),
      fetch(`/api/meetings/${encodeURIComponent(botId)}/thanks-context`).then((r) => r.json()).catch(() => ({})),
    ]);
    const subject = d.subject || "【御礼】本日のお打ち合わせについて";
    const body = "";
    box.innerHTML =
      `<div class="mail-main">
       <div class="mail-mode">
         <span class="mail-mode-lb">送り方</span>
         <button type="button" class="mail-mode-b on" data-mode="new">新規作成</button>
         <button type="button" class="mail-mode-b" data-mode="reply">返信</button>
         <span class="mail-mode-st"></span>
       </div>

       <label class="mail-lb">宛先<input type="text" class="home-mail-to" value="${escH(d.to || "")}"
         placeholder="送り先のメールアドレス（空のままでもGmailで入れられます）" />
         <span class="mail-to-src">${d.to ? `${escH(d.toSource || "")}から入れました` : ""}</span></label>
       <label class="mail-lb">件名<input type="text" class="home-mail-subj" value="${escH(subject)}" /></label>
       <!-- 本文の右にアイコンを置く。下に置くと、長い文面のときに画面の外に出てしまうため。 -->
       <div class="mail-body-row">
         <label class="mail-lb mail-lb-body">本文<textarea class="home-mail-body" rows="16" placeholder="ここに文面を書きます。「文面を作る」を押すと、商談の内容からAIが下書きします。">${escH(body)}</textarea></label>
         <!-- 本文に入っているURLを、押して開ける形で並べる（中身の確認用） -->
         <div class="mail-links" hidden></div>
         <div class="mail-acts mail-acts-side">
           ${hIcon("gen", "商談の内容から文面を作る", `data-mail-gen="${escH(botId)}"`, "need")}
           ${hIcon("draft", "Gmailに下書きを作る", `data-gdraft="${escH(botId)}"`)}
           ${hIcon("copy", "コピー", 'data-mailcopy="1"')}
           ${hIcon("gmail", "Gmailの作成画面で開く", 'data-mailto="1" href="#" target="_blank" rel="noopener"', "", "a")}
           ${hIcon("doc", "資料URLを作る", `data-doc-make="${escH(botId)}"`)}
           ${hIcon("tpl", "テンプレートを使う", 'data-tpl-toggle="1"')}
         </div>

         <!-- アイコンを押すと、その中身がアイコンの右に出る（テンプレ・返信先・資料URL・下書き） -->
         <div class="mail-side" hidden>
           <div class="tple-head">
             <span class="tple-t mail-side-t">テンプレートを直す</span>
             <button type="button" class="tple-x" data-side-close="1" aria-label="閉じる" title="閉じる">✕</button>
           </div>

           <!-- 返信先を選ぶ -->
           <div class="mail-side-sec" data-sec="reply" hidden>
             <div class="mail-reply-hd">
               <input type="text" class="mail-reply-q" placeholder="会社名や担当者名で探す" />
               <button type="button" class="btn sf-btn-secondary home-sf-mini" data-reply-search="1">探す</button>
             </div>
             <div class="mail-reply-list"></div>
           </div>

           <!-- 資料URLを作る -->
           <div class="mail-side-sec" data-sec="doc" hidden>
             <div class="mail-side-note">送る資料を選ぶと、この会社あてのURLを作って本文に入れます。</div>
             <div class="mail-doc-list"></div>
           </div>

           <!-- Gmailの下書きの結果 -->
           <div class="mail-side-sec" data-sec="draft" hidden>
             <div class="mail-draft-box"></div>
           </div>

           <!-- テンプレート：選ぶ・使う・直す -->
           <div class="mail-side-sec" data-sec="tpl" hidden>
             <label class="mail-lb">使う型
               <select class="mail-tpl-sel">
                 <option value="">使わない（商談内容から作る）</option>
                 ${tpls.map((t) => `<option value="${escH(t.id)}">${escH(t.name)}</option>`).join("")}
               </select>
             </label>
             <div class="mail-acts tple-acts">
               ${hIcon("tplin", "選んだ型で本文を作る", `data-tpl-apply="${escH(botId)}"`)}
               ${hIcon("tplsave", "いまの文面を、新しい型として保存する", 'data-tpl-save="1"')}
             </div>
             <span class="mail-tpl-st"></span>

             <!-- 型を選んだときだけ、その中身を直せる -->
             <div class="tple-edit" hidden>
               <div class="tple-t2">この型を直す</div>
               <label class="mail-lb">型の名前<input type="text" class="tple-name" /></label>
               <label class="mail-lb">件名<input type="text" class="tple-subj" /></label>
               <label class="mail-lb">本文<textarea class="tple-body" rows="10"></textarea></label>
               <div class="mail-tpl-help">
                 <button type="button" class="tag-ins" data-ins="{資料URL}">{資料URL}</button>
                 <button type="button" class="tag-ins" data-ins="{会社名}">{会社名}</button>
                 <button type="button" class="tag-ins" data-ins="{担当者名}">{担当者名}</button>
                 <button type="button" class="tag-ins" data-ins="{自分の名前}">{自分の名前}</button>
                 <span class="mail-doc-st">【】で囲んだところと空欄は、商談の内容で埋まります。</span>
               </div>
               <div class="mail-acts">
                 ${hIcon("tplsave", "直した内容で、この型を上書きする", 'data-tple-save="1"')}
                 ${hIcon("tplshare", "この型をチームのみんなが使えるようにする", 'data-tple-share="1"')}
                 ${hIcon("tpldel", "この型を消す", 'data-tple-del="1"')}
               </div>
               <div class="tple-st"></div>
             </div>
             <div class="mail-side-note"><span class="mail-doc-st"></span></div>
           </div>
         </div>
       </div>
       <div class="home-mail-note"></div>
       </div>`;

    const side = mailSide(box);
    const closeBtn = box.querySelector("[data-side-close]");
    if (closeBtn) closeBtn.addEventListener("click", () => side.close());
    wireMailTemplates(box, botId, tpls, side);
    const mailCtx = wireMailMode(box, botId, side);

    // この会社あての資料URLを、開いた時点で用意しておく。
    // 文面に {資料URL} を入れたときに、その場で差し込めるようにするため。
    (async () => {
      const st = box.querySelector(".mail-side-note .mail-doc-st");
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/doc-link/ensure`, {
          method: "POST", headers: { "content-type": "application/json" }, body: "{}",
        });
        const dd = await r.json();
        if (!r.ok || !st) return;
        if (dd.created) {
          st.textContent = `資料URLを用意しました（${dd.docName || ""}）。誰が何ページ見たか追えます`;
        } else if ((dd.links || []).length) {
          st.textContent = `この会社の資料URL ${dd.links.length}件（誰が何ページ見たか追えます）`;
        } else {
          st.textContent = dd.reason || "この会社向けの資料URLはまだありません";
        }
      } catch {}
    })();
    const ta = box.querySelector(".home-mail-body");
    const su = box.querySelector(".home-mail-subj");
    // Gmailの作成画面を開く（メーラー未設定のパソコンでも動くように mailto は使わない）
    const toEl = box.querySelector(".home-mail-to");
    const sync = () => {
      const base = "https://mail.google.com/mail/?view=cm&fs=1&tf=1";
      const toQ = toEl && toEl.value.trim() ? `&to=${encodeURIComponent(toEl.value.trim())}` : "";
      let url = `${base}${toQ}&su=${encodeURIComponent(su.value)}&body=${encodeURIComponent(ta.value)}`;
      // URLが長すぎるとブラウザが開けないので、そのときは本文を切る
      if (url.length > 7000) {
        url = `${base}${toQ}&su=${encodeURIComponent(su.value)}&body=${encodeURIComponent(ta.value.slice(0, 1500) + "\n\n（続きはkinbotからコピーしてください）")}`;
      }
      const a = box.querySelector("[data-mailto]");
      a.href = url;
    };
    sync();
    // 本文が入ったら「下書き」を濃い緑にする（次に押すのはここ、と分かるように）
    const gdraftBtn = box.querySelector("[data-gdraft]");
    const syncGo = () => {
      if (gdraftBtn) gdraftBtn.classList.toggle("hib-go", !!ta.value.trim());
    };
    su.addEventListener("input", sync);
    ta.addEventListener("input", () => { sync(); syncGo(); });
    if (toEl) toEl.addEventListener("input", sync);
    syncGo();
    // Gmailに下書きを作る（やり取りがあれば返信として）
    box.querySelector("[data-gdraft]").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      const note = box.querySelector(".home-mail-note");
      const nm = btn.querySelector(".hib-name");
      btn.disabled = true; if (nm) nm.textContent = "作成中…";
      note.textContent = "";
      try {
        if (!ta.value.trim()) {
          throw new Error("本文が空です。「文面を作る」を押すか、自分で書いてください。");
        }
        if (mailCtx.mode === "reply" && !mailCtx.threadId) {
          throw new Error("返信するメールを選んでください");
        }
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/thanks-gmail-draft`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            subject: su.value, body: ta.value,
            to: toEl ? toEl.value.trim() : "",
            mode: mailCtx.mode, threadId: mailCtx.threadId || "",
          }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || "作成に失敗しました");
        // 結果は右の欄に出す（本文の下だと、長い文面のときに見えないため）
        const sec = side.open("draft", "Gmailの下書き");
        sec.querySelector(".mail-draft-box").innerHTML =
          `<div class="mail-side-ok">下書きを保存しました</div>` +
          `<div class="mail-side-note">` +
          `${d.replied ? "これまでのやり取りへの返信として作りました" : "新規メールとして作りました"}<br>` +
          (d.to ? `宛先：${escH(d.to)}` : "宛先は未設定です。Gmailで入れてください") + `</div>` +
          `<a class="btn sf-btn-secondary home-sf-mini" href="${escH(d.url)}" target="_blank" rel="noopener">Gmailで開く</a>`;
        note.textContent = "";
        if (nm) nm.textContent = "作成済み";
        btn.classList.add("hib-need");
      } catch (err) {
        const isInput = /本文が空|返信するメール/.test(err.message);
        const sec = side.open("draft", "Gmailの下書き");
        sec.querySelector(".mail-draft-box").innerHTML =
          `<div class="mail-side-ng">${escH(err.message)}</div>` + (isInput ? "" :
          `<div class="mail-side-note">` +
          `<a class="home-sf-link" href="/api/gmail/status" target="_blank" rel="noopener">接続を確認する</a>　` +
          `<a class="home-sf-link" href="settings.html">設定を開く</a></div>`);
        note.textContent = "";
        btn.disabled = false; if (nm) nm.textContent = "下書き";
      }
    });

    box.querySelector("[data-mailcopy]").addEventListener("click", (e) => {
      const nm = e.currentTarget.querySelector(".hib-name");
      navigator.clipboard.writeText(ta.value).then(() => {
        if (!nm) return;
        nm.textContent = "コピー済";
        setTimeout(() => { nm.textContent = "コピー"; }, 1500);
      }).catch(() => {});
    });
  } catch (e) {
    box.innerHTML = `<div class="home-sf-err">${escH(e.message)}</div>`;
  }
}

// 画面中央のモーダルを開く。中身は呼び出し側が入れる。
// SF更新と御礼メールで同じ枠を使い、狭いパネルで読みづらい問題をまとめて解消する。
function openModal({ title, sub, inner, wide = true }) {
  const old = document.querySelector(".sfm");
  if (old) old.remove();

  const m = document.createElement("div");
  m.className = "sfm";
  m.innerHTML =
    `<div class="sfm-back" data-modal-close="1"></div>
     <div class="sfm-box${wide ? "" : " sfm-box-narrow"}" role="dialog" aria-modal="true">
       <div class="sfm-head">
         <div>
           <div class="sfm-t">${escH(title || "")}</div>
           <div class="sfm-s">${escH(sub || "")}</div>
         </div>
         <div class="sfm-acts">
           <button type="button" class="sfm-min" data-modal-min="1" aria-label="小さくする" title="小さくして、ほかの画面も見る">－</button>
           <button type="button" class="sfm-x" data-modal-close="1" aria-label="閉じる" title="閉じる">✕</button>
         </div>
       </div>
       <div class="sfm-body">${inner || ""}</div>
     </div>`;
  document.body.appendChild(m);
  document.body.style.overflow = "hidden";

  const close = () => {
    m.remove();
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  m.querySelectorAll("[data-modal-close]").forEach((b) => b.addEventListener("click", close));

  // 小さくして右下に寄せる。後ろの画面をそのまま操作できるようにする。
  // 作りかけの文面を残したまま、別の商談を見に行けるようにするため。
  const minBtn = m.querySelector("[data-modal-min]");
  if (minBtn) minBtn.addEventListener("click", () => {
    const small = m.classList.toggle("sfm-small");
    minBtn.textContent = small ? "□" : "－";
    minBtn.title = small ? "元の大きさに戻す" : "小さくして、ほかの画面も見る";
    // 小さいときは、後ろを操作できるようにする
    document.body.style.overflow = small ? "" : "hidden";
  });

  return { el: m, body: m.querySelector(".sfm-body"), close };
}

// SF更新を開く。狭いパネルだと読めないので、画面中央の大きなモーダルで開く。
// 上に「次回アクション」（kinbot側のやることリスト）、下にSalesforceの画面を並べる。
function openSfEdit(key) {
  const it = homeItems[key];
  if (!it) return;
  const company = it.company || it.title || "";
  const src = `deals.html?company=${encodeURIComponent(company)}&embed=1&view=salesforce`;
  openModal({
    title: company || "Salesforce 更新",
    sub: it.title || "",
    inner: `<iframe class="sfm-frame" src="${escH(src)}" title="SF更新"></iframe>`,
  });
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
    // 商談の記録が無いと文面を作れないので、その理由を出す
    const mailNone = ev.target.closest("[data-mail-none]");
    if (mailNone) {
      alert("この商談はまだ録音・要約がないため、御礼メールの文面を作れません。\n\n" +
            "先に録音するか、商談履歴から要約を作ってからお試しください。");
      return;
    }
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
    // テストで作ったアポを、集計から外してカレンダーの予定も消す
    const dropBtn = ev.target.closest("[data-apo-drop]");
    if (dropBtn) {
      apoDropTest(dropBtn);
      return;
    }
    const openBtn = ev.target.closest("[data-sf-open]");
    if (openBtn) {
      const key = openBtn.dataset.sfOpen;
      const s = sfOf(key);
      s.open = !s.open;
      if (s.open && s.records === null && !s.picked && !s.done) {
        // 予定名は、記録しておいたものを使う。
        // 画面の見出しは幅に収めるため省略されている（…）ので、そこからは読まない。
        const card = openBtn.closest(".home-card");
        const el = card && (card.querySelector(".hl-title") || card.querySelector(".home-card-title"));
        const title = (homeItems[key] && homeItems[key].title) || (el && el.textContent) || "";
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
  // 日付が変わったら、送信済みの照合をやり直す
  mailSentAsked = false;
  mailSentMap = {};
  sfDoneMap = {};
  apoDoneAsked = false;
  apoDone = {};
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
  loadHomeTools();
  loadTomorrowReminders();
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
// 商談がいつなのかを「8/20(水) 15:30」の形にする。
// 今日なら「今日 15:30」、明日なら「明日 15:30」と書く。
function apoMeetingWhen(iso) {
  const d = new Date(iso);
  if (!iso || isNaN(d.getTime())) return "日時未定";
  // ほかの時刻表示と同じく、見ている人の時計に合わせる
  const now = new Date();
  const ymd = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const tomorrow = new Date(now.getTime() + 86400000);
  const p = (n) => String(n).padStart(2, "0");
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (ymd(d) === ymd(now)) return `今日 ${hm}`;
  if (ymd(d) === ymd(tomorrow)) return `明日 ${hm}`;
  const w = "日月火水木金土"[d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${w}) ${hm}`;
}

// ===== 明日リマインドを送る先 =====
// 送る前に、宛先や日時が正しいかを確かめられるようにする。
// いま見ているリマインドの条件（日付と、全員ぶんかどうか）
let rmDate = "";      // 空＝明日
let rmAll = false;
let rmOpen = false;   // 一覧を開いたままにしておくため

// リマインドの対象日（yyyy-mm-dd）。ふだんは翌日。金曜だけ土日を飛ばして月曜。
function tomorrowStr() {
  const j = new Date(Date.now() + 9 * 3600 * 1000);
  const off = j.getUTCDay() === 5 ? 3 : 1; // 金曜→月曜（+3）、他→翌日（+1）
  const t = new Date(j.getTime() + off * 24 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}
// 既定のときの見出し。金曜は対象が月曜なので「月曜のリマインド」と出す。
function defaultReminderLabel() {
  const j = new Date(Date.now() + 9 * 3600 * 1000);
  return j.getUTCDay() === 5 ? "月曜のリマインド" : "明日のリマインド";
}

async function loadTomorrowReminders() {
  const bar = document.getElementById("rmBar");
  if (!bar) return;
  try {
    const q = new URLSearchParams();
    if (rmDate) q.set("date", rmDate);
    if (rmAll) q.set("all", "1");
    const d = await (await fetch("/api/apo-mail/tomorrow?" + q.toString())).json();
    const items = d.items || [];
    // 0件でも枠は必ず出す（消えると分かりにくいため）。中身が無ければ下で空の案内を出す。
    // 日本時間で出す（見る人の端末の時差に左右されないように）
    const when = (iso) => {
      const x = new Date(iso);
      if (isNaN(x.getTime())) return "";
      const j = new Date(x.getTime() + 9 * 3600 * 1000);
      const p2 = (n) => String(n).padStart(2, "0");
      return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${p2(j.getUTCHours())}:${p2(j.getUTCMinutes())}`;
    };
    const okCount = items.filter((x) => x.送る).length;
    const ngCount = items.length - okCount;
    bar.hidden = false;
    const rmLabel = rmDate && rmDate !== tomorrowStr() ? escH(rmDate.slice(5).replace("-", "/")) + "のリマインド" : defaultReminderLabel();
    bar.innerHTML =
      `<button type="button" class="rm-head" id="rmToggle">` +
      `<span class="rm-lb">${rmLabel}</span>` +
      `<span class="rm-n">${okCount}件</span>` +
      `<span class="rm-when">${escH(d["送る時刻"] || "")}に送ります</span>` +
      `<span class="cc-warn rm-ngn">${ngCount ? `送れないもの ${ngCount}件` : ""}</span>` +
      (d["自動送信"] ? "" : `<span class="cc-warn">自動送信はOFFです</span>`) +
      `<span class="rm-arrow">▾</span></button>` +
      `<div class="rm-modal" id="rmModal"${rmOpen ? "" : " hidden"}>` +
      `<div class="rm-modal-backdrop" data-rm-close></div>` +
      `<div class="rm-modal-card">` +
      `<div class="rm-modal-head"><b>${rmLabel}</b><button type="button" class="rm-modal-x" data-rm-close aria-label="閉じる">×</button></div>` +
      `<div class="rm-list" id="rmList">` +
      `<div class="rm-tools">
         <label>日 <input type="date" class="rm-date" value="${escH(rmDate || tomorrowStr())}" /></label>
         <label class="ks-check"><input type="checkbox" class="rm-allchk"${rmAll ? " checked" : ""} /> 全員のぶん</label>
         <span class="rm-hint">送る相手はチェックで選べます</span>
       </div>` +
      (items.length ? "" : `<div class="rm-empty">この日の商談はありません。</div>`) +
      items.map((x) => `
        <div class="rm-row${x.送る ? "" : " rm-ng"}" data-slug="${escH(x.slug)}">
          <label class="rm-chk" title="${x["状態"] === "送信済み" ? "もう送りました" : "チェックを外すと、この会社には送りません"}">
            <input type="checkbox" class="rm-send"${x.送る ? " checked" : ""}
              ${x["状態"] === "送信済み" ? " disabled" : ""} />
          </label>
          <span class="rm-time">${escH(when(x.start))}</span>
          <span class="rm-co">${escH(x.company || x.label || "")}${x["重なり"] ? '<span class="rm-dup">重なり</span>' : ""}</span>
          <span class="rm-who">${escH(x["獲得者"] || "")}${x["担当"] ? `→${escH(x["担当"])}` : ""}</span>
          <span class="rm-to">${escH(x.to || "")}</span>
          <span class="rm-st${x.送る ? "" : " cc-warn"}">${escH(x["状態"] || "")}</span>
          ${x["状態"] === "送信済み" ? "" : `<button type="button" class="rm-fix">直す</button>`}
        </div>
        <!-- 宛先も担当も、いつでも直せるようにしておく -->
        <div class="rm-fixbox" hidden>
          <label>宛先 <input type="email" class="rm-fix-mail" placeholder="tanaka@example.co.jp" value="${escH(x.to || "")}" /></label>
          <label>担当 <select class="rm-fix-owner" data-now="${escH(x.owner || "")}">
            <option value="">（決まっていません）</option>
          </select></label>
          <button type="button" class="btn rm-fix-save">入れる</button>
          <span class="rm-fix-st"></span>
          <span class="rm-fix-note">担当を変えても、知らせやメールは出しません（会議室のURLだけ切り替わります）</span>
        </div>`).join("") +
      `</div></div></div>`;

    // 帯の件数を数え直す（開いたまま更新できるように）
    function updateRmCount() {
      const rows = [...bar.querySelectorAll(".rm-row")];
      const ok = rows.filter((r) => {
        const c = r.querySelector(".rm-send");
        const st = (r.querySelector(".rm-st") || {}).textContent || "";
        return c && c.checked && !c.disabled && st === "送ります";
      }).length;
      const ng = rows.length - ok;
      const n = bar.querySelector(".rm-n");
      if (n) n.textContent = `${ok}件`;
      const w = bar.querySelector(".rm-ngn");
      if (w) w.textContent = ng ? `送れないもの ${ng}件` : "";
    }

    // 「直す」を押したら、その場で宛先や担当を入れられるようにする
    bar.querySelectorAll(".rm-fix").forEach((b) =>
      b.addEventListener("click", async () => {
        const box = b.closest(".rm-row").nextElementSibling;
        if (!box || !box.classList.contains("rm-fixbox")) return;
        box.hidden = !box.hidden;
        if (box.hidden) return;
        // 担当の選択肢は、開いたときに読み込む
        const sel = box.querySelector(".rm-fix-owner");
        if (sel && sel.options.length <= 1) {
          try {
            const d = await (await fetch("/api/apo-mail/reps")).json();
            for (const r of d.reps || []) {
              const o = document.createElement("option");
              o.value = r.email; o.textContent = r.name;
              sel.appendChild(o);
            }
            // いまの担当を選んだ状態にする（変えたいところだけ直せる）
            const now = sel.dataset.now || "";
            if (now) sel.value = now;
          } catch {}
        }
        const first = box.querySelector("input, select");
        if (first) first.focus();
      }));

    bar.querySelectorAll(".rm-fix-save").forEach((b) =>
      b.addEventListener("click", async () => {
        const box = b.closest(".rm-fixbox");
        const row = box.previousElementSibling;
        const slug = row.dataset.slug;
        const mail = box.querySelector(".rm-fix-mail");
        const owner = box.querySelector(".rm-fix-owner");
        const st = box.querySelector(".rm-fix-st");
        const body = { slug };
        if (mail) body.email = mail.value.trim();
        if (owner) body.owner = owner.value;
        // 宛先も担当も空のままなら、直すものがない
        if (!body.email && !body.owner) {
          st.textContent = "宛先か担当を入れてください";
          return;
        }
        b.disabled = true;
        st.textContent = "入れています…";
        try {
          // 担当の差し替えだけを行う。
          // すでに案内が済んでいるアポなので、通知・確定メール・招待の作り直しはしない。
          // （スマートリンクの行き先は、担当に合わせて自動で切り替わる）
          const nowOwner = owner ? (owner.dataset.now || "") : "";
          if (owner && body.owner && body.owner !== nowOwner) {
            const r2 = await fetch(`/api/smart-links/${encodeURIComponent(slug)}/owner`, {
              method: "PUT", headers: { "content-type": "application/json" },
              body: JSON.stringify({ owner: body.owner, quiet: true }),
            });
            const d2 = await r2.json();
            if (!r2.ok) throw new Error(d2.error || "担当を変えられませんでした");
            delete body.owner;   // 担当はここで済んだので、残りだけ送る
          }
          if (body.email !== undefined) {
            const r = await fetch("/api/apo-mail/fix", {
              method: "POST", headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || "入れられませんでした");
          }
          st.textContent = "入れました";
          rmOpen = true;
          setTimeout(() => loadTomorrowReminders(), 500);
        } catch (e) {
          st.textContent = "失敗：" + e.message;
          b.disabled = false;
        }
      }));

    // チェックを外したら「送らない」、戻したら「送る」
    bar.querySelectorAll(".rm-send").forEach((el) =>
      el.addEventListener("change", async () => {
        const row = el.closest(".rm-row");
        const slug = row.dataset.slug;
        const off = !el.checked;
        el.disabled = true;
        try {
          const r = await fetch("/api/apo-mail/reminder-off", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ slug, off }),
          });
          if (!r.ok) throw new Error("変えられませんでした");
          // 開いたままにしておきたいので、その場の表示だけ書き換える
          const st = row.querySelector(".rm-st");
          if (st) {
            st.textContent = off ? "送らない" : "送ります";
            st.classList.toggle("cc-warn", off);
          }
          row.classList.toggle("rm-ng", off);
          el.disabled = false;
          updateRmCount();
        } catch (e) {
          el.checked = !el.checked;
          el.disabled = false;
        }
      }));
    const t = document.getElementById("rmToggle");
    const rmModal = document.getElementById("rmModal");
    const closeRm = () => { if (rmModal) rmModal.hidden = true; rmOpen = false; if (t) t.classList.remove("open"); };
    if (t) {
      t.classList.toggle("open", rmOpen);
      t.addEventListener("click", () => {
        if (rmModal) rmModal.hidden = false;
        rmOpen = true;
        t.classList.add("open");
      });
    }
    bar.querySelectorAll("[data-rm-close]").forEach((el) => el.addEventListener("click", closeRm));
    if (rmModal && !rmModal._escBound) {
      rmModal._escBound = true;
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && rmModal && !rmModal.hidden) closeRm(); });
    }

    // 日を変える／全員のぶんを見る
    const dateEl = bar.querySelector(".rm-date");
    if (dateEl) dateEl.addEventListener("change", () => {
      rmDate = dateEl.value || "";
      rmOpen = true;
      loadTomorrowReminders();
    });
    const allEl = bar.querySelector(".rm-allchk");
    if (allEl) allEl.addEventListener("change", () => {
      rmAll = allEl.checked;
      rmOpen = true;
      loadTomorrowReminders();
    });
  } catch { bar.hidden = true; }
}

// ===== 御礼メールを実際に送ったか =====
// kinbotで下書きを作っただけでは「送った」ことにならない。
// その人が今日送ったメールの宛先・件名と照らし合わせて、送ったものは数から外す。
let mailSentMap = {};
let mailSentAsked = false;
// Salesforceを更新済みの商談（ステージ変更・活動履歴の自動作成）
let sfDoneMap = {};
// アポごとの「SF立ち上げ済み」「メール送信済み」（実データから見分けたもの）
let apoDone = {};
let apoDoneAsked = false;

// アポについて、SFとメールが済んでいるかを聞く
async function checkApoDone(rows) {
  const items = (rows || [])
    .filter((x) => x.slug)
    .map((x) => ({ slug: x.slug, company: x.company || "", email: x.clientEmail || "", start: x.start }));
  if (!items.length) return;
  try {
    const r = await fetch("/api/apo/done-check", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const d = await r.json();
    if (d.error || !d.results) return;
    apoDone = d.results;
    renderMyApos();
  } catch {}
}

// Salesforceを更新したかどうかを聞く
async function checkSfUpdated(rows) {
  const botIds = (rows || []).filter((x) => x.rec && x.rec.bot_id).map((x) => x.rec.bot_id);
  if (!botIds.length) return;
  try {
    const r = await fetch("/api/sf-updated-check", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ botIds }),
    });
    const d = await r.json();
    if (d.error || !d.results) return;
    const next = {};
    for (const [id, v] of Object.entries(d.results)) if (v && v.updated) next[id] = v.why || true;
    sfDoneMap = next;
    render();
  } catch {}
}

async function checkMailSent(rows) {
  const items = [];
  for (const it of rows || []) {
    if (!it.rec || !it.rec.bot_id) continue;
    items.push({
      id: it.rec.bot_id,
      company: (it.rec.account || "").trim() || companyOfTitle(it.rec.title || ""),
      email: it.rec.client_email || "",
    });
  }
  if (!items.length) return;
  try {
    const r = await fetch("/api/mail-sent-check", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ items }),
    });
    const d = await r.json();
    if (d.error || !d.results) return;
    const next = {};
    for (const [id, v] of Object.entries(d.results)) if (v && v.sent) next[id] = v.why || true;
    mailSentMap = next;
    render();   // 帯とカードを描き直す
  } catch {}
}

// 予定名から会社名を取り出す（サーバー側と同じ考え方）
function companyOfTitle(t) {
  return String(t || "").normalize("NFKC")
    .replace(/【[^】]*】/g, "")
    .split(/[\/｜|:：・、,]/)[0]
    .replace(/[^\s　]{0,16}\s*(?:様|さま|さん|殿)\s*$/u, "")
    .trim();
}

// ===== よく使うツール =====
// ホームから、よく使う画面へすぐ飛べるようにする。
// 並べるものは人ごとに選べる（天気予報は全員に必ず入る）。
const TOOL_ICONS = {
  weekly: "M4 5h16v3H4zm0 5h16v3H4zm0 5h10v3H4z",
  apo: "M7 3v2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2V3h-2v2H9V3zm12 8v8H5v-8z",
  launch: "M12 2l3 6 6 .9-4.5 4.2 1.1 6.1L12 16.9 6.4 19.2l1.1-6.1L3 8.9 9 8z",
  pending: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5h-2v6l5 3 1-1.7-4-2.3z",
  process: "M4 4h16v3H4zm0 5h16v3H4zm0 5h16v3H4zm0 5h9v2H4z",
  docs: "M6 2h8l6 6v14H6zm7 1.5V9h5.5z",
  history: "M13 3a9 9 0 1 0 8.5 12h-2.1A7 7 0 1 1 13 5v4l5-4.5L13 0z",
  report: "M4 20h4V10H4zm6 0h4V4h-4zm6 0h4v-7h-4z",
  style: "M12 3a9 9 0 1 0 9 9h-9z",
  deals: "M3 6h18v3H3zm2 5h14v9H5zm4 3h6v2H9z",
  rec: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zm7 9a7 7 0 0 1-6 6.9V22h-2v-3.1A7 7 0 0 1 5 12h2a5 5 0 0 0 10 0z",
  kincall: "M6.6 4.5c-1 0-1.8.8-1.8 1.8 0 6.9 5.6 12.5 12.5 12.5 1 0 1.8-.8 1.8-1.8v-2.3c0-.9-.6-1.6-1.5-1.8l-2.3-.5c-.8-.2-1.6.2-2 .9l-.6 1a11 11 0 0 1-4.4-4.4l1-.6c.7-.4 1.1-1.2.9-2l-.5-2.3c-.2-.9-.9-1.5-1.8-1.5z",
  dev: "M9 3h6l1 3h3v14H5V6h3zm3 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
};

async function loadHomeTools() {
  const box = document.getElementById("homeTools");
  if (!box) return;
  try {
    const d = await (await fetch("/api/home-tools")).json();
    const tools = d.tools || [];
    const svg = (id) =>
      `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">` +
      `<path d="${TOOL_ICONS[id] || TOOL_ICONS.weekly}"/></svg>`;
    box.innerHTML =
      tools.map((t) =>
        `<a class="ht-item" href="${escH(t.href)}" title="${escH(t.label)}"><span class="ht-ico">${svg(t.id)}</span>` +
        `<span class="ht-name">${escH(t.label)}</span></a>`).join("") +
      `<button type="button" class="ht-item ht-edit" id="htEdit" title="並べるツールを選ぶ">` +
      `<span class="ht-ico"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">` +
      `<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg></span>` +
      `<span class="ht-name">えらぶ</span></button>`;
    box.hidden = false;
    const ed = document.getElementById("htEdit");
    if (ed) ed.addEventListener("click", () => openToolPicker(d));
  } catch { box.hidden = true; }
}

// 並べるツールを選ぶ画面
function openToolPicker(d) {
  const all = d["使えるもの"] || [];
  const now = new Set(d["選んでいるもの"] || []);
  const body =
    `<p class="note">ホームに並べるものを選んでください（8つまで）。<br>` +
    `天気予報は全員に必ず出るので、外せません。</p>` +
    `<div class="ht-pick">` + all.map((t) =>
      `<label class="ht-pick-item${t.always ? " fixed" : ""}">` +
      `<input type="checkbox" value="${escH(t.id)}"${now.has(t.id) ? " checked" : ""}` +
      `${t.always ? " checked disabled" : ""} />` +
      `<span>${escH(t.label)}${t.always ? "（必ず出ます）" : ""}</span></label>`).join("") +
    `</div>`;
  const mo = openModal({
    title: "ホームに並べるツール",
    sub: "よく使うものだけを出して、すぐ開けるようにします",
    inner: body + `<div class="ap-cfg-actions" style="margin-top:10px">` +
      `<button class="btn" id="htSave">保存する</button>` +
      `<span class="rev-status" id="htMsg"></span></div>`,
    wide: false,
  });
  const box = mo.body;
  box.querySelector("#htSave").addEventListener("click", async () => {
    const picked = [...box.querySelectorAll(".ht-pick input:checked")].map((x) => x.value);
    const msg = box.querySelector("#htMsg");
    msg.textContent = "保存しています…";
    try {
      const r = await fetch("/api/home-tools", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tools: picked }),
      });
      if (!r.ok) throw new Error(((await r.json()) || {}).error || "保存できませんでした");
      msg.textContent = "保存しました";
      await loadHomeTools();
      setTimeout(() => mo.close(), 700);
    } catch (e) { msg.textContent = "失敗：" + e.message; }
  });
}

// 自分のアポ（その日に取ったアポ）
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
let homeReps = [];   // 担当変更の候補（/api/smart-links/reps）

// アポ一覧で担当を変えたら、その場でSF側へ反映する（1回だけ配線）。
document.addEventListener("change", async (ev) => {
  const sel = ev.target && ev.target.closest ? ev.target.closest(".apo-rep-mini") : null;
  if (!sel) return;
  const slug = sel.dataset.slug;
  const owner = sel.value || null;
  sel.disabled = true;
  try {
    const r = await fetch(`/api/smart-links/${encodeURIComponent(slug)}/owner`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "変更に失敗しました");
    // 手元のデータも更新して、担当バッジ等の表示を合わせる
    const a = myApos.find((x) => x.slug === slug);
    if (a) a.owner = owner || "";
    await loadMyApos();
  } catch (e) {
    alert("担当を変えられませんでした：" + e.message);
    sel.disabled = false;
  }
});

// 担当変更のプルダウン。現在の担当を選択済みにする。
function repOptionsHome(cur) {
  let o = '<option value="">担当未定</option>';
  for (const r of homeReps) {
    const em = r.email || "";
    o += `<option value="${apoEsc(em)}"${em === cur ? " selected" : ""}>${apoEsc(r.name || em)}</option>`;
  }
  return o;
}

async function loadMyApos() {
  const box = document.getElementById("homeApoList");
  if (!box) return;
  box.innerHTML = '<div class="home-empty">読み込み中…</div>';
  if (!homeReps.length) {
    try { const r = await (await fetch("/api/smart-links/reps")).json(); homeReps = Array.isArray(r) ? r : []; } catch {}
  }
  try {
    const q = new URLSearchParams({ date: selDate || todayStr });
    // 動作確認用：?many=1 で件数を増やせる（本番では無視される）
    try { if (new URLSearchParams(location.search).get("many")) q.set("many", "1"); } catch {}
    const d = await (await fetch("/api/apo/mine?" + q.toString())).json();
    if (d.error) throw new Error(d.error);
    myApos = d.items || [];
    renderMyApos();
    // SFを立ち上げたか・メールを送ったかを、実データから見分ける（1回だけ）
    if (!apoDoneAsked) { apoDoneAsked = true; checkApoDone(myApos); }
    // 会社名でSFのクロス商談が立ち上がっているか調べて、立ち上げ済みの表示にする
    checkApoCross(myApos);
  } catch (e) {
    myApos = [];
    box.innerHTML = `<div class="home-empty home-empty-s">読み込めませんでした：${apoEsc(e.message)}</div>`;
  }
}

// 手元の配列から描き直す（Salesforceのパネルを開いたときにも呼ぶ）
let apoCrossAsked = false;
// 会社名でSFのクロス商談が「立ち上げ済み（01：アポ獲得以上／受注）」かを調べ、
// 立ち上げ済みのカードはSFアイコンを薄くし、「立ち上げ済み」バッジを付ける。
async function checkApoCross(rows) {
  const box = document.getElementById("homeApoList");
  if (!box) return;
  const companies = [...new Set((rows || []).map((x) => (x.company || companyOfTitle(x.title || "")).trim()).filter(Boolean))];
  if (!companies.length) return;
  try {
    const d = await (await fetch("/api/apo/cross-status", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companies }),
    })).json();
    if (!d || !d.byCompany) return;
    applyApoCross(d.byCompany);
  } catch {}
}
function normCo(s) { return String(s || "").normalize("NFKC").replace(/[\s　]/g, "").replace(/(株式会社|有限会社|合同会社|\(株\)|（株）)/g, "").toLowerCase(); }
function applyApoCross(byCompany) {
  const box = document.getElementById("homeApoList");
  if (!box) return;
  const map = new Map();
  for (const k of Object.keys(byCompany)) map.set(k, byCompany[k]);
  box.querySelectorAll(".ap-home-card").forEach((card) => {
    const co = card.getAttribute("data-company") || "";
    // サーバーの正規化キーと突き合わせ（会社名そのもの／簡易正規化の両方で当てる）
    let hit = null;
    for (const [, v] of map) {
      if (!v || !v.launched) continue;
      if (normCo(v.company) === normCo(co)) { hit = v; break; }
    }
    if (!hit) return;
    // SFアイコンを薄く（立ち上げ済み扱い）
    const sfBtn = card.querySelector('[data-apo-sf]');
    if (sfBtn) { sfBtn.classList.remove("hib-need"); sfBtn.classList.add("hib-done"); }
    // バッジを付ける（重複しないように）
    const meta = card.querySelector(".hl-meta");
    if (meta && !meta.querySelector(".home-badge-sflaunched")) {
      const b = document.createElement("span");
      b.className = "home-badge home-badge-done home-badge-sflaunched";
      b.textContent = "SF立ち上げ済み";
      b.title = (hit.name ? hit.name + "／" : "") + (hit.stage || "");
      meta.insertBefore(b, meta.firstChild);
    }
  });
}

// 今日の商談：ヘッダーの「SF確認」ボタン → 今日の商談すべてについて、
// SFが今日更新されたか・商談が立ち上がっているかをまとめて調べて、各カードに反映する。
async function checkSfForOneCard(card) {
  const company = card.getAttribute("data-company") || "";
  let line = card.querySelector(".hl-sfcheck");
  if (!line) {
    line = document.createElement("div");
    line.className = "hl-sfcheck";
    line.style.cssText = "font-size:12px;color:#0d5b47;margin-top:4px;";
    const main = card.querySelector(".hl-main"); if (main) main.appendChild(line);
  }
  if (!company) { line.textContent = "会社名が取れませんでした"; return; }
  line.textContent = "SFを確認しています…";
  try {
    const d = await (await fetch("/api/meetings/sf-check", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ company }),
    })).json();
    if (!d || d.error) throw new Error((d && d.error) || "確認できませんでした");
    const 立 = d.launched ? `✓ 商談 立ち上げ済み（${d.stage || "アポ獲得以上"}${d.name ? "／" + d.name : ""}）` : "商談 未立ち上げ";
    const 更 = d.updatedToday ? "／SF 今日更新済み" : "／SF 今日の更新なし";
    line.textContent = 立 + 更;
    if (d.launched || d.updatedToday) {
      const sfBtn = card.querySelector('[data-sfedit], [data-sf-open]');
      if (sfBtn) { sfBtn.classList.remove("hib-need"); sfBtn.classList.add("hib-done"); }
    }
  } catch (e) { line.textContent = "確認できませんでした：" + e.message; }
}
document.addEventListener("click", (ev) => {
  const btn = ev.target && ev.target.closest ? ev.target.closest("#homeSfCheckAll") : null;
  if (!btn) return;
  ev.preventDefault();
  const cards = [...document.querySelectorAll("#homeList .home-card[data-company]")];
  if (!cards.length) return;
  btn.disabled = true; const before = btn.textContent; btn.textContent = "確認中…";
  (async () => {
    for (const card of cards) { await checkSfForOneCard(card); }
    btn.textContent = "確認しました"; setTimeout(() => { btn.textContent = before; btn.disabled = false; }, 2500);
  })();
});

// SF確認アイコン：押すと、その会社のSFクロス商談の状態を調べて、その場に結果を出す
document.addEventListener("click", (ev) => {
  const btn = ev.target && ev.target.closest ? ev.target.closest("[data-apo-sfcheck]") : null;
  if (!btn) return;
  ev.preventDefault();
  const co = btn.getAttribute("data-apo-sfcheck") || "";
  if (!co) return;
  const card = btn.closest(".ap-home-card");
  let line = card && card.querySelector(".hl-sfcheck");
  if (card && !line) {
    line = document.createElement("div");
    line.className = "hl-sfcheck";
    line.style.cssText = "font-size:12px;color:#0d5b47;margin-top:4px;";
    const main = card.querySelector(".hl-main"); if (main) main.appendChild(line);
  }
  if (line) line.textContent = "SFを確認しています…";
  (async () => {
    try {
      const d = await (await fetch("/api/apo/cross-status", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ companies: [co] }),
      })).json();
      if (!d || !d.byCompany) throw new Error("確認できませんでした");
      const v = Object.values(d.byCompany)[0] || { launched: false };
      if (v.launched) {
        if (line) line.textContent = `✓ SF立ち上げ済み（${v.stage || "アポ獲得以上"}${v.name ? "／" + v.name : ""}）`;
        applyApoCross(d.byCompany);
      } else {
        if (line) line.textContent = "SFにクロス商談の立ち上げは見つかりませんでした（まだ未立ち上げ）";
      }
    } catch (e) { if (line) line.textContent = "確認できませんでした：" + e.message; }
  })();
});

function renderMyApos() {
  const box = document.getElementById("homeApoList");
  const cnt = document.getElementById("homeApoCount");
  if (!box) return;
  if (cnt) cnt.textContent = myApos.length ? `${myApos.length}件` : "";
  box.innerHTML = myApos.length
    ? myApos.map(apoHomeCard).join("")
    : '<div class="home-empty home-empty-s">この日のアポはありません（割り振られたぶんと、自分で取ったぶんが出ます）。</div>';
}

// 商談リストとアポリストの両方を描き直す
function renderBoth() {
  render();
  renderMyApos();
}

// Salesforceの自動立ち上げの結果を1行で出す。
// 通せなかったときは、なぜ通らなかったかをそのまま見せる（探しに行かせない）。
function launchLine(x) {
  const l = x.launch;
  if (!l) return "";
  if (l.ok) {
    // 立ち上がったものは、アイコンの色で分かるので行には出さない
    return "";
  }
  // 理由は長いので1行に省略する。全文はカーソルを合わせると出る。
  const full = `SFを自動で立ち上げられませんでした：${l.reasonText || ""}`;
  return `<div class="home-sf-err al-ng" title="${apoEsc(full)}">⚠ ${apoEsc(l.reasonText || "立ち上げできません")}</div>`;
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
      // 商談と同じく1行にして、操作は小さなアイコンにする。
      // やることが残っているものだけ色が付くので、押す先が分かる。
      const launched = !!(x.launch && x.launch.ok);
      const mailLabel = m.confirm
        ? (m.confirm.status === "sent" ? "送信済み" : "下書き作成済み")
        : (x.clientEmail ? "メールを作る" : "宛先が未登録");
      const acts =
        hIcon("sf",
          apoDone[x.slug] && apoDone[x.slug].sf済み
            ? `SFを開く（${apoDone[x.slug].sf.名前 || "立ち上げ済み"}）`
            : launched ? "SFを開く" : "SF立ち上げ",
          `data-apo-sf="${apoEsc(x.slug)}"`,
              (launched || (apoDone[x.slug] && apoDone[x.slug].sf済み)) ? "done" : "need") +
        hIcon("mail",
          apoDone[x.slug] && apoDone[x.slug].メール済み
            ? `送信済み（${apoDone[x.slug].メールの理由}）`
            : mailLabel,
          `data-apo-mail="${apoEsc(x.slug)}"${m.confirm ? " disabled" : ""}`,
          (m.confirm || (apoDone[x.slug] && apoDone[x.slug].メール済み)) ? "done" : "need") +
        hIcon("cal", "会議室", `href="${apoEsc(x.smartUrl)}" target="_blank" rel="noopener"`, "done", "a") +
        hIcon("sfcheck", "SFの状態を確認（クロス商談が立ち上がっているか）", `data-apo-sfcheck="${apoEsc(x.company || companyOfTitle(x.title))}" data-apo-slug="${apoEsc(x.slug)}"`, "") +
        // テストで作ったアポを、その場で片付けられるようにする。
        // 実績・均等化・通知の数から外し、カレンダーの予定も消す。
        `<span class="hl-more">${hIcon("trash", "テストとして外す", `data-apo-drop="${apoEsc(x.slug)}"`)}</span>`;

      // 補足行。宛先が無い・立ち上げできない場合は、その理由を出す。
      const warn = !x.clientEmail ? '<span class="cc-warn">宛先が未登録</span>' : "";
      // ここは「その日に取ったアポ」の一覧なので、商談がいつなのかを添える
      const when = apoMeetingWhen(x.start);
      const meta = [
        when ? `商談 ${apoEsc(when)}` : "",
        x.business ? apoEsc(x.business) : "",
        `獲得 ${apoEsc(x.setter || "-")}`,
        warn || (x.clientEmail ? apoEsc(x.clientEmail) : ""),
      ].filter(Boolean).join(" ・ ");

      return `<div class="home-card home-line ap-home-card${needMail ? " home-card-plan" : ""}" data-card="${apoEsc(sfKey)}" data-company="${apoEsc(x.company || companyOfTitle(x.title))}" data-slug="${apoEsc(x.slug)}">
        <div class="hl-row">
          <div class="hl-time">${apoEsc(apoTime(x.takenAt || x.start))}</div>
          <div class="hl-main">
            <div class="hl-title">${apoEsc(x.title || "")}</div>
            <div class="hl-meta">${x.selfGot ? '<span class="home-badge home-badge-self">自分で獲得</span>' : ""}${x.inviteEventId ? '<span class="home-badge home-badge-done">予定作成済</span>' : ""}${meta}</div>
            ${launchLine(x)}
            <div class="hl-owner">担当：<select class="apo-rep-mini" data-slug="${apoEsc(x.slug)}" title="担当を変える">${repOptionsHome(x.owner)}</select></div>
          </div>
          <div class="hl-acts">${acts}</div>
        </div>
      </div>`;
  })(x);
}

// テストで作ったアポを片付ける。
// 実績・均等化・通知の数から外し、カレンダーに作った商談予定も消す。
async function apoDropTest(btn) {
  const slug = btn.dataset.apoDrop;
  const row = btn.closest(".home-card");
  const name = row ? (row.querySelector(".hl-title") || {}).textContent || "" : "";
  if (!confirm(
    `${name}\n\nこのアポを集計から外します。\n` +
    "実績・均等化・通知の数から除き、カレンダーに作った商談予定も消します。\n\nよろしいですか？")) return;
  btn.disabled = true;
  try {
    const r = await fetch(`/api/smart-links/${encodeURIComponent(slug)}/excluded`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ excluded: true }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "外せませんでした");
    // 予定を消せなかったときだけ知らせる
    if (d.calendar && !/消しました|ありませんでした/.test(d.calendar)) alert(d.calendar);
    if (row) { row.style.opacity = "0"; setTimeout(() => row.remove(), 180); }
  } catch (e) {
    alert("外せませんでした：" + e.message);
    btn.disabled = false;
  }
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
// 埋め込みのSalesforce画面から、いま紐づいている商談を受け取る
window.sfLinkedOppId = "";
window.addEventListener("message", (ev) => {
  const x = ev && ev.data;
  if (x && x.type === "kb-sf-opp") {
    // 埋め込み側で紐づいた商談を覚えておく（今は表示に使わないが、他の機能から参照できる）
    window.sfLinkedOppId = x.id || "";
    return;
  }
});

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
