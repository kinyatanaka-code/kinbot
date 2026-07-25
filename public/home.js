// home.js — 日付ごとの商談一覧（自分/全員）＋商談を開く/失注にする
// ・カレンダーの予定は【】付き（商談）のみ表示
// ・日付を切り替えて他の日の商談も見られる
const $h = (id) => document.getElementById(id);
const escH = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let homeScope = "mine";
let meEmail = "";
let allMeetings = [];
let dayEvents = [];
let calLoading = false;
const calCache = {};

function ymd(d) {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, "0");
  return x.getFullYear() + "-" + p(x.getMonth() + 1) + "-" + p(x.getDate());
}
const todayStr = ymd(new Date());
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
}

function render() {
  const box = $h("homeList");
  const isToday = selDate === todayStr;
  const dayWord = isToday ? "今日" : "この日";

  let list = allMeetings.filter((m) => isOnSelectedDay(m.created_at) && !isOtherCat(m));
  if (homeScope === "mine") list = list.filter(isMine);
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // 録音済み商談のタイトルを控えて、カレンダー予定の重複を避ける
  const recordedTitles = new Set(list.map((m) => (m.title || "").replace(/^【[^】]*】\s*/, "").trim()));
  const now = Date.now();
  const upcoming = (dayEvents || [])
    .filter((e) => hasBracket(e.title))
    .filter((e) => !recordedTitles.has((e.title || "").replace(/^【[^】]*】\s*/, "").trim()))
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  let html = "";
  // 予定（カレンダー）
  html += `<div class="home-sec-title">${dayWord}の予定（カレンダー）</div>`;
  if (calLoading) {
    html += '<div class="home-empty">読み込み中…</div>';
  } else if (window._calConnected === false) {
    html += `<div class="home-empty">Googleカレンダーが連携されていません。設定で連携すると、予定がここに表示され、開始時刻にボットが自動入室します。</div>`;
  } else if (!upcoming.length) {
    html += `<div class="home-empty">${dayWord}の商談の予定（【】付き）はありません。</div>`;
  } else {
    html += upcoming.map((e) => {
      const time = new Date(e.start).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
      const past = new Date(e.start).getTime() < now;
      const company = companyFromTitle(e.title);
      const enc = encodeURIComponent(company || e.title || "");
      const urlBadge = e.hasUrl ? '<span class="home-badge">自動入室対象</span>' : '<span class="home-badge home-badge-st">URLなし</span>';
      return `<div class="home-card home-card-plan">
        <div class="home-card-main">
          <div class="home-card-top"><span class="home-time">${escH(time)}</span><span class="home-badge home-badge-plan">${past ? "実施済み予定" : "予定"}</span>${urlBadge}</div>
          <div class="home-card-title">${escH(e.title || "(無題)")}</div>
          <div class="home-card-meta">${e.hasUrl ? "開始時刻にボットが自動入室します" : "予定にZoom等のURLがありません（自動入室されません）"}</div>
        </div>
        <div class="home-card-actions">
          <a class="btn" href="history.html?company=${enc}">会社を開く</a>
          <a class="btn sf-btn-secondary" href="history.html?company=${enc}&sf=lose">失注にする</a>
        </div>
      </div>`;
    }).join("");
  }
  // 録音済みの商談
  html += `<div class="home-sec-title">${dayWord}の録音済み商談</div>`;
  if (!list.length) {
    html += `<div class="home-empty">${dayWord}の録音済み商談はありません。</div>`;
  } else {
    html += list.map((m) => {
      const time = new Date(m.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
      const company = companyFromTitle(m.title) || (m.company_name || "");
      const enc = encodeURIComponent(company || m.title || "");
      const phase = m.phase ? `<span class="home-badge">${escH(m.phase)}</span>` : "";
      const status = m.status ? `<span class="home-badge home-badge-st">${escH(m.status)}</span>` : "";
      const summary = (m.summary && m.summary.overview) ? String(m.summary.overview).slice(0, 90) + "…" : "";
      return `<div class="home-card">
        <div class="home-card-main">
          <div class="home-card-top"><span class="home-time">${escH(time)}</span>${phase}${status}</div>
          <div class="home-card-title">${escH(m.title || "(商談名なし)")}</div>
          <div class="home-card-meta">担当：${escH(repOf(m))}</div>
          ${summary ? `<div class="home-card-sum">${escH(summary)}</div>` : ""}
        </div>
        <div class="home-card-actions">
          <a class="btn" href="history.html?company=${enc}">商談を開く</a>
          <a class="btn sf-btn-secondary" href="history.html?company=${enc}&sf=lose">失注にする</a>
        </div>
      </div>`;
    }).join("");
  }
  box.innerHTML = html;
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
  await loadCalendar();
  updateHead();
  render();
}

document.addEventListener("DOMContentLoaded", () => {
  $h("homeToggle").querySelectorAll(".home-tg").forEach((b) => {
    b.addEventListener("click", () => {
      homeScope = b.dataset.scope;
      $h("homeToggle").querySelectorAll(".home-tg").forEach((x) => x.classList.toggle("active", x === b));
      render();
    });
  });
  $h("datePick").value = selDate;
  $h("datePick").addEventListener("change", (e) => {
    const v = e.target.value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) changeDate(v);
  });
  $h("datePrev").addEventListener("click", () => shiftDate(-1));
  $h("dateNext").addEventListener("click", () => shiftDate(1));
  $h("dateToday").addEventListener("click", () => changeDate(todayStr));
  updateHead();
  load();
});
