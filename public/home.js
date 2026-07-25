// home.js — 日付ごとの商談一覧（自分/全員）＋SF商談の選択・リスケ失注
// ・カレンダーの予定は【】付き（商談）のみ表示
// ・日付を切り替えて他の日の商談も見られる（選んだ日付はページを移動しても保持）
// ・予定カードからSalesforceの商談を選び、リスケならボタン一つで失注にできる
const $h = (id) => document.getElementById(id);
const escH = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let homeScope = "mine";
let meEmail = "";
let allMeetings = [];
let dayEvents = [];
let calLoading = false;
const calCache = {};
const sfState = {}; // 予定ごとのSalesforceパネルの状態

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
  return `<div class="home-sf">${inner}</div>`;
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
      const key = e.id || (e.title + "@" + e.start);
      const time = new Date(e.start).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
      const past = new Date(e.start).getTime() < now;
      const company = companyFromTitle(e.title);
      const enc = encodeURIComponent(company || e.title || "");
      const urlBadge = e.hasUrl ? '<span class="home-badge">自動入室対象</span>' : '<span class="home-badge home-badge-st">URLなし</span>';
      const s = sfOf(key);
      return `<div class="home-card home-card-plan home-card-v">
        <div class="home-card-row">
          <div class="home-card-main">
            <div class="home-card-top"><span class="home-time">${escH(time)}</span><span class="home-badge home-badge-plan">${past ? "実施済み予定" : "予定"}</span>${urlBadge}</div>
            <div class="home-card-title">${escH(e.title || "(無題)")}</div>
            <div class="home-card-meta">${e.hasUrl ? "開始時刻にボットが自動入室します" : "予定にZoom等のURLがありません（自動入室されません）"}</div>
          </div>
          <div class="home-card-actions">
            <a class="btn" href="history.html?company=${enc}">会社を開く</a>
            <button class="btn sf-btn-secondary" data-sf-open="${escH(key)}" type="button">${s.open ? "SF商談を閉じる" : "SF商談を選ぶ"}</button>
          </div>
        </div>
        ${sfPanelHtml(key, e)}
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
      const input = box.querySelector(`[data-sf-q="${CSS.escape(key)}"]`);
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
  wireList();
  updateHead();
  load();
});
