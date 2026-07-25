// home.js — 今日の商談一覧（自分/全員）＋商談を開く/失注にする
const $h = (id) => document.getElementById(id);
const escH = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let homeScope = "mine";
let meEmail = "";
let allMeetings = [];
let todayEvents = [];

function isToday(d) {
  if (!d) return false;
  const x = new Date(d), n = new Date();
  return x.getFullYear() === n.getFullYear() && x.getMonth() === n.getMonth() && x.getDate() === n.getDate();
}
function isOtherCat(m) {
  const t = (m.title || "");
  return /【ユ\/フォ】|【社内MTG】/.test(t);
}
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

function render() {
  const box = $h("homeList");
  let list = allMeetings.filter((m) => isToday(m.created_at) && !isOtherCat(m));
  if (homeScope === "mine") list = list.filter(isMine);
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  // 録音済み商談のタイトルを控えて、カレンダー予定の重複を避ける
  const recordedTitles = new Set(list.map((m) => (m.title || "").replace(/^【[^】]*】\s*/, "").trim()));
  const now = Date.now();
  const upcoming = (todayEvents || [])
    .filter((e) => !recordedTitles.has((e.title || "").replace(/^【[^】]*】\s*/, "").trim()))
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  let html = "";
  // これからの予定（カレンダー）
  if (upcoming.length) {
    html += `<div class="home-sec-title">今日の予定（カレンダー）</div>`;
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
  } else if (window._calConnected === false) {
    html += `<div class="home-sec-title">今日の予定（カレンダー）</div><div class="home-empty">Googleカレンダーが連携されていません。設定で連携すると、今日の予定がここに表示され、開始時刻にボットが自動入室します。</div>`;
  }
  // 録音済みの商談
  html += `<div class="home-sec-title">今日の録音済み商談</div>`;
  if (!list.length) {
    html += '<div class="home-empty">今日の録音済み商談はまだありません。</div>';
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
    const cr = await fetch("/api/calendar/today");
    const cd = await cr.json();
    todayEvents = (cd && cd.events) || [];
    window._calConnected = cd && cd.connected !== false;
  } catch { todayEvents = []; window._calConnected = false; }
  $h("homeDate").textContent = "今日の商談（" + new Date().toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" }) + "）";
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
  load();
});
