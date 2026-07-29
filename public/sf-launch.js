// sf-launch.js — カレンダーの【初回】【新/ヒ】の予定から、Salesforceのリードを探して商談を立ち上げる
const $l = (id) => document.getElementById(id);
const escL = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const CO_HINT_L = /(株式会社|有限会社|合同会社|合資会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|医療法人|学校法人|社会福祉法人|㈱|\(株\)|（株）|Inc|Corp|LLC|Ltd)/i;

function ymdL(d) {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, "0");
  return x.getFullYear() + "-" + p(x.getMonth() + 1) + "-" + p(x.getDate());
}
const todayL = ymdL(new Date());
let selDateL = todayL;
let leadFields = null;     // 入力項目の定義（Salesforceのdescribeから）
let convertedStatus = "";
const state = {};          // 予定ごとの状態

// かっこ類を【】にそろえてから中身を落とす
function stripTags(title) {
  return String(title || "")
    .replace(/[［\[〔（(]/g, "【")
    .replace(/[］\]〕）)]/g, "】")
    .replace(/【[^】]*】/g, " ");
}

// 予定タイトルから会社名を取り出す
function companyOf(title) {
  let s = stripTags(title);
  s = s.split(/[\/／|｜]/)[0];
  const toks = s.split(/[\s　、,]+/).filter(Boolean);
  let pick = toks.find((x) => CO_HINT_L.test(x)) || toks[0] || "";
  return pick.replace(/(様|さま|さん|御中)$/u, "").trim();
}
// 予定タイトルから「〇〇様」の担当者名を取り出す
function personOf(title) {
  const t = stripTags(title);
  const m = t.match(/([一-龥ぁ-んァ-ヶa-zA-Z]{1,10})\s*(様|さま|さん)/);
  if (m) return m[1];
  const parts = t.split(/[\/／|｜]/);
  if (parts.length > 1) return parts[1].replace(/(様|さま|さん|御中)/g, "").trim();
  return "";
}
// 【初回】【新/ヒ】の判定。かっこ・スラッシュ・スペースは半角全角どちらでもOK。
function isTarget(title) {
  const t = String(title || "")
    .replace(/[［\[〔（(]/g, "【")
    .replace(/[］\]〕）)]/g, "】")
    .replace(/[／]/g, "/")
    .replace(/[\s　]/g, "");
  return /【[^】]*初回/.test(t) || /【[^】]*新\/ヒ/.test(t) || /【[^】]*新規/.test(t);
}

function stOf(key) {
  if (!state[key]) state[key] = { open: false, loading: false, error: "", leads: null, picked: null, done: null, q: "", qp: "" };
  return state[key];
}

function dateLabelL(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" });
}

// ---- 入力フォーム ----
function fieldInput(f, key, value) {
  if (!f.found) {
    return `<div class="sf-field"><label>${escL(f.label)}</label><div class="home-panel-empty">この項目がSalesforceに見つかりませんでした（入力せずに進みます）</div></div>`;
  }
  const id = `f_${key}_${f.key}`;
  if (f.options && f.options.length) {
    const opts = ['<option value=""></option>'].concat(
      f.options.map((o) => `<option value="${escL(o.value)}" ${o.value === value || o.label === value ? "selected" : ""}>${escL(o.label)}</option>`)
    ).join("");
    return `<div class="sf-field"><label>${escL(f.label)}</label><select class="sf-select" id="${id}" data-api="${escL(f.name)}">${opts}</select></div>`;
  }
  if (f.type === "date") {
    return `<div class="sf-field"><label>${escL(f.label)}</label><input type="date" class="sf-input" id="${id}" data-api="${escL(f.name)}" value="${escL(value || "")}"/></div>`;
  }
  if (f.type === "int" || f.type === "double") {
    return `<div class="sf-field"><label>${escL(f.label)}</label><input type="number" class="sf-input" id="${id}" data-api="${escL(f.name)}" data-num="1" value="${escL(value || "")}"/></div>`;
  }
  if (f.type === "textarea") {
    return `<div class="sf-field"><label>${escL(f.label)}</label><textarea class="sf-textarea" id="${id}" data-api="${escL(f.name)}" rows="2">${escL(value || "")}</textarea></div>`;
  }
  return `<div class="sf-field"><label>${escL(f.label)}</label><input type="text" class="sf-input" id="${id}" data-api="${escL(f.name)}" value="${escL(value || "")}"/></div>`;
}

function formHtml(key, ev) {
  const s = stOf(key);
  const lead = s.picked;
  const def = (k) => {
    if (k === "campaign") return "3Dメタバース";
    if (k === "visitDate") return s.evDate || selDateL;  // 商談の開催日
    if (k === "apoDate") return selDateL;                // 予定を登録した日＝アポ獲得日
    if (k === "website") return lead.Website || "";
    if (k === "address") return [lead.State, lead.City, lead.Street].filter(Boolean).join("") || "";
    if (k === "employees") return lead.NumberOfEmployees != null ? String(lead.NumberOfEmployees) : "";
    return "";
  };
  const fields = (leadFields || []).map((f) => fieldInput(f, key, def(f.key))).join("");
  return `<div class="ln-form">
    <div class="ln-lead">
      <div class="home-sf-name">${escL(lead.Name || "")}（${escL(lead.Company || "")}）</div>
      <div class="home-sf-meta">${escL(lead.Status || "")}${lead.Owner && lead.Owner.Name ? " ・ " + escL(lead.Owner.Name) : ""}${lead.Email ? " ・ " + escL(lead.Email) : ""}</div>
    </div>
    ${fields}
    ${s.error ? `<div class="home-sf-err">${escL(s.error)}</div>` : ""}
    <div class="home-sf-row">
      <button class="btn" data-ln-go="${escL(key)}" type="button"${s.loading ? " disabled" : ""}>${s.loading ? "立ち上げ中…" : "この内容で立ち上げる"}</button>
      <button class="btn sf-btn-secondary home-sf-mini" data-ln-back="${escL(key)}" type="button">別のリードを選ぶ</button>
    </div>
    <div class="home-sf-note">主キャンペーンソースは「3Dメタバース」、初回訪問日はこの予定の日、アポ獲得日は今日を初期値にしています。</div>
  </div>`;
}

function panelHtml(key, ev) {
  const s = stOf(key);
  if (!s.open) return "";
  if (s.done) {
    const u = s.done;
    return `<div class="home-sf">
      <div class="home-sf-done">Salesforceで立ち上げました</div>
      <div class="home-sf-row">
        ${u.opportunityId ? `<a class="btn" href="${escL(u.instanceUrl)}/${escL(u.opportunityId)}" target="_blank" rel="noopener">商談を開く</a>` : ""}
        ${u.accountId ? `<a class="home-sf-link" href="${escL(u.instanceUrl)}/${escL(u.accountId)}" target="_blank" rel="noopener">取引先を開く</a>` : ""}
      </div>
    </div>`;
  }
  if (s.picked) return `<div class="home-sf">${formHtml(key, ev)}</div>`;

  let inner = "";
  if (s.loading) inner = `<div class="home-sf-msg">検索中…</div>`;
  else if (s.error) inner = `<div class="home-sf-err">${escL(s.error)}</div>`;
  else if (s.leads && !s.leads.length) inner = `<div class="home-sf-msg">一致するリードが見つかりませんでした。会社名や担当者名を変えて検索してください。</div>`;
  else if (s.leads) {
    inner = `<div class="home-sf-list">` + s.leads.map((r) => `
      <button class="home-sf-item" data-ln-pick="${escL(key)}" data-id="${escL(r.Id)}" type="button">
        <span class="home-sf-name">${escL(r.Name || "")}</span>
        <span class="home-sf-meta">${escL(r.Company || "")}${r.Status ? " ・ " + escL(r.Status) : ""}${r.Owner && r.Owner.Name ? " ・ " + escL(r.Owner.Name) : ""}</span>
      </button>`).join("") + `</div>`;
  }
  return `<div class="home-sf">
    <div class="home-sf-search">
      <input type="text" class="home-sf-input" data-ln-q="${escL(key)}" value="${escL(s.q)}" placeholder="会社名" />
      <input type="text" class="home-sf-input" data-ln-qp="${escL(key)}" value="${escL(s.qp)}" placeholder="担当者名" />
      <button class="btn sf-btn-secondary home-sf-mini" data-ln-search="${escL(key)}" type="button">検索</button>
    </div>
    ${inner}
  </div>`;
}

let dayEventsL = [];
let memberCount = 0;
function render() {
  const box = $l("lnList");
  $l("lnTitle").textContent = (selDateL === todayL ? "今日" : dateLabelL(selDateL)) + "に登録された【初回】【新/ヒ】の予定" + (memberCount ? `（${memberCount}名分）` : "");
  const pick = $l("lnDate");
  if (pick && pick.value !== selDateL) pick.value = selDateL;
  const tb = $l("lnToday");
  if (tb) tb.style.visibility = selDateL === todayL ? "hidden" : "visible";

  const list = (dayEventsL || []).filter((e) => isTarget(e.title));
  if (!list.length) {
    box.innerHTML = '<div class="home-empty">この日に登録された【初回】【新/ヒ】の予定はありません。</div>';
    return;
  }
  box.innerHTML = list.map((e) => {
    const key = e.id || (e.title + "@" + e.start);
    const s = stOf(key);
    const when = e.start
      ? new Date(e.start).toLocaleString("ja-JP", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" })
      : "日時未定";
    const madeAt = e.created ? new Date(e.created).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : "";
    const who = e.creatorName || e.creator || e.organizerName || e.organizer || e.calendarOwner || "";
    return `<div class="home-card home-card-v" data-ev="${escL(key)}">
      <div class="home-card-row">
        <div class="home-card-main">
          <div class="home-card-top"><span class="home-time">${escL(when)}</span><span class="home-badge home-badge-plan">商談予定</span>${madeAt ? `<span class="home-badge home-badge-st">${escL(madeAt)}に登録</span>` : ""}</div>
          <div class="home-card-title">${escL(e.title || "")}</div>
          <div class="home-card-meta">会社名：${escL(companyOf(e.title) || "—")}　／　担当者：${escL(personOf(e.title) || "—")}${who ? "　／　登録者：" + escL(who) : ""}</div>
        </div>
        <div class="home-card-actions">
          <button class="btn" data-ln-open="${escL(key)}" type="button">${s.open ? "閉じる" : "リードを探す"}</button>
        </div>
      </div>
      ${panelHtml(key, e)}
    </div>`;
  }).join("");
}

async function searchLeads(key) {
  const s = stOf(key);
  s.loading = true; s.error = ""; s.leads = null;
  render();
  try {
    const r = await fetch(`/api/salesforce/leads?company=${encodeURIComponent(s.q)}&person=${encodeURIComponent(s.qp)}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "検索に失敗しました");
    s.leads = d.records || [];
  } catch (e) {
    s.error = e.message;
  } finally {
    s.loading = false;
    render();
  }
}

async function convert(key) {
  const s = stOf(key);
  if (!s.picked) return;
  const card = document.querySelector(`[data-ev="${CSS.escape(key)}"]`);
  const fields = {};
  if (card) {
    card.querySelectorAll("[data-api]").forEach((el) => {
      const api = el.dataset.api;
      const v = (el.value || "").trim();
      if (!api || v === "") return;
      fields[api] = el.dataset.num ? Number(v.replace(/[^\d.-]/g, "")) : v;
    });
  }
  if (!confirm(`「${s.picked.Company || s.picked.Name}」のリードを商談として立ち上げます。よろしいですか？`)) return;
  s.loading = true; s.error = "";
  render();
  try {
    const r = await fetch(`/api/salesforce/leads/${encodeURIComponent(s.picked.Id)}/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields, convertedStatus, opportunityName: s.picked.Company || s.picked.Name }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "立ち上げに失敗しました");
    s.done = d;
  } catch (e) {
    s.error = e.message;
  } finally {
    s.loading = false;
    render();
  }
}

async function loadFields() {
  try {
    const r = await fetch("/api/salesforce/lead-fields");
    const d = await r.json().catch(() => ({}));
    if (r.ok) { leadFields = d.fields || []; convertedStatus = d.convertedStatus || ""; }
  } catch {}
}

async function loadDay() {
  const box = $l("lnList");
  box.innerHTML = '<div class="home-empty">読み込み中…（全員のカレンダーを見ています）</div>';
  try {
    // その日にカレンダーへ登録された予定を、Google連携している全員分まとめて取る
    const r = await fetch("/api/calendar/created?date=" + encodeURIComponent(selDateL));
    const d = await r.json();
    dayEventsL = (d && d.events) || [];
    memberCount = (d && d.count) || 0;
    if (d && d.connected === false) {
      box.innerHTML = '<div class="home-empty">Googleカレンダーが連携されているメンバーがいません。設定から連携してください。</div>';
      return;
    }
  } catch {
    dayEventsL = [];
  }
  render();
}

function shiftDay(n) {
  const [y, m, d] = selDateL.split("-").map(Number);
  const x = new Date(y, m - 1, d);
  x.setDate(x.getDate() + n);
  selDateL = ymdL(x);
  loadDay();
}

document.addEventListener("DOMContentLoaded", async () => {
  $l("lnDate").value = selDateL;
  $l("lnDate").addEventListener("change", (e) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { selDateL = e.target.value; loadDay(); }
  });
  $l("lnPrev").addEventListener("click", () => shiftDay(-1));
  $l("lnNext").addEventListener("click", () => shiftDay(1));
  $l("lnToday").addEventListener("click", () => { selDateL = todayL; loadDay(); });

  const box = $l("lnList");
  box.addEventListener("click", (ev) => {
    const open = ev.target.closest("[data-ln-open]");
    if (open) {
      const key = open.dataset.lnOpen;
      const s = stOf(key);
      s.open = !s.open;
      if (s.open && s.leads === null && !s.picked) {
        const ev = (dayEventsL || []).find((x) => (x.id || (x.title + "@" + x.start)) === key);
        const title = ev ? ev.title : "";
        s.evDate = ev && ev.start ? ymdL(new Date(ev.start)) : selDateL;
        s.q = companyOf(title);
        s.qp = personOf(title);
        render();
        searchLeads(key);
        return;
      }
      render();
      return;
    }
    const sb = ev.target.closest("[data-ln-search]");
    if (sb) {
      const key = sb.dataset.lnSearch;
      const c = box.querySelector(`[data-ln-q="${CSS.escape(key)}"]`);
      const p = box.querySelector(`[data-ln-qp="${CSS.escape(key)}"]`);
      const s = stOf(key);
      s.q = c ? c.value.trim() : "";
      s.qp = p ? p.value.trim() : "";
      searchLeads(key);
      return;
    }
    const pk = ev.target.closest("[data-ln-pick]");
    if (pk) {
      const key = pk.dataset.lnPick;
      const s = stOf(key);
      s.picked = (s.leads || []).find((r) => r.Id === pk.dataset.id) || null;
      s.error = "";
      render();
      return;
    }
    const back = ev.target.closest("[data-ln-back]");
    if (back) {
      const s = stOf(back.dataset.lnBack);
      s.picked = null; s.error = "";
      render();
      return;
    }
    const go = ev.target.closest("[data-ln-go]");
    if (go) { convert(go.dataset.lnGo); return; }
  });
  box.addEventListener("input", (ev) => {
    const c = ev.target.closest("[data-ln-q]");
    if (c) stOf(c.dataset.lnQ).q = c.value;
    const p = ev.target.closest("[data-ln-qp]");
    if (p) stOf(p.dataset.lnQp).qp = p.value;
  });

  await loadFields();
  loadDay();
});
