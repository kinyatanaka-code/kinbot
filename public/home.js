// home.js — 今日の商談一覧（自分/全員）＋商談を開く/失注にする
const $h = (id) => document.getElementById(id);
const escH = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let homeScope = "mine";
let meEmail = "";
let allMeetings = [];

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

function render() {
  const box = $h("homeList");
  let list = allMeetings.filter((m) => isToday(m.created_at) && !isOtherCat(m));
  if (homeScope === "mine") list = list.filter(isMine);
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (!list.length) { box.innerHTML = '<div class="home-empty">今日の商談はまだありません。</div>'; return; }
  box.innerHTML = list.map((m) => {
    const time = new Date(m.created_at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    const company = m.title ? String(m.title).replace(/^【[^】]*】\s*/, "").split("/")[0].trim() : (m.company_name || "");
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
