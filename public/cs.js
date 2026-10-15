// CS連携（DOC 回収MTG＝キックオフ → CS）
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let csData = null;
let csOpen = new URLSearchParams(location.search).get("bot") || "";
const FIELDS = [
  ["企業名", "企業名"], ["先方ご担当者名", "先方ご担当者名"], ["活用場所", "活用場所・利用シーン"], ["公開予定時期", "公開予定時期"],
  ["納品月", "納品月"], ["次回MTGの日時", "次回MTG（議事録から）"], ["請求書着日スケジュール", "請求スケジュール"], ["特記事項", "イレギュラー・特記事項"],
];
const fmtDT = (iso) => { const t = Date.parse(iso || ""); if (!isFinite(t)) return ""; const j = new Date(t + 9 * 3600000); return `${j.getUTCMonth() + 1}/${j.getUTCDate()}(${"日月火水木金土"[j.getUTCDay()]}) ${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`; };
const toLocal = (iso) => { const t = Date.parse(iso || ""); if (!isFinite(t)) return ""; return new Date(t + 9 * 3600000).toISOString().slice(0, 16); };
const say = (t) => { const el = $("csSt"); if (el) { el.textContent = t; clearTimeout(say._t); say._t = setTimeout(() => { el.textContent = ""; }, 6000); } };
async function api(url, opts = {}) {
  const r = await fetch(url, { headers: { "content-type": "application/json" }, ...opts });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `エラー（${r.status}）`);
  return d;
}
async function load() {
  try {
    csData = await api("/api/cs/kickoffs");
    render();
  } catch (e) { $("csList").innerHTML = `<div class="empty-state">${esc(e.message)}</div>`; }
}
function render() {
  const d = csData; if (!d) return;
  const box = $("csList");
  if (!d.kickoffs.length) { box.innerHTML = `<div class="empty-state">まだ連携したキックオフはありません。予定名に「キックオフ」が入った商談の議事録ができると、ここに出ます（5分ごとに確認）。</div>`; return; }
  box.innerHTML = d.kickoffs.map((k) => {
    const f = k.fields || {};
    const open = csOpen === k.bot_id;
    const unk = FIELDS.filter(([key]) => !f[key] || f[key] === "未確認").length;
    const pills = [
      k.posted_at ? `<span class="cs-pill ok">OBスレ投稿済み</span>` : `<span class="cs-pill ng">未投稿</span>`,
      k.cs_name ? `<span class="cs-pill ok">CS：${esc(k.cs_name)}</span>` : `<span class="cs-pill warn">CS担当：未定</span>`,
      k.draft_at ? `<span class="cs-pill ok">御礼メール下書きあり</span>` : `<span class="cs-pill">御礼メール：まだ</span>`,
      unk ? `<span class="cs-pill warn">未確認 ${unk}項目</span>` : "",
    ].join("");
    const head = `<div class="cs-h" data-bot="${esc(k.bot_id)}"><b>${open ? "▾" : "▸"} ${esc(f.企業名 && f.企業名 !== "未確認" ? f.企業名 : k.company)}</b>
      <span class="cs-sub">回収MTG ${esc(fmtDT(k.meeting_at))}・FS ${esc(k.fs_name || "")}</span>${pills}</div>`;
    if (!open) return `<div class="cs-card">${head}</div>`;
    const csOpts = `<option value="">未定</option>` + d.members.map((m) => `<option value="${esc(m.email)}"${m.email === k.cs_email ? " selected" : ""}>${esc(m.name)}</option>`).join("");
    const rows = FIELDS.map(([key, lb]) => `<label>${esc(lb)}</label><input data-f="${esc(key)}" value="${esc(f[key] || "")}" class="${!f[key] || f[key] === "未確認" ? "unk" : ""}">`).join("");
    return `<div class="cs-card open">${head}
      <div class="cs-grid">
        ${rows}
        <label>弊社の宿題</label><textarea data-list="弊社の宿題" rows="3" placeholder="1行に1つ。無ければ空（メールの項目ごと出しません）">${esc((f.弊社の宿題 || []).join("\n"))}</textarea>
        <label>貴社の宿題</label><textarea data-list="貴社の宿題" rows="2" placeholder="初期学習のほかにお願いしたこと（1行に1つ）">${esc((f.貴社の宿題 || []).join("\n"))}</textarea>
        <label>CS担当</label><select data-k="csEmail">${csOpts}</select>
        <label>確認MTGの日時</label><div><input type="datetime-local" data-k="confirmStart" value="${esc(toLocal(k.confirm_start))}"><div class="cs-sub">${k.confirm_from ? `（${esc(k.confirm_from)}から）` : "カレンダー・議事録から見つかりませんでした"}${k.confirm_url ? `　参加URL：<a href="${esc(k.confirm_url)}" target="_blank" rel="noopener">${esc(k.confirm_url)}</a>` : ""}</div></div>
        <label>先方のメール</label><input data-k="clientEmail" value="${esc(k.client_email || "")}" placeholder="御礼メールの宛先">
        <label>候補者用画面のURL</label><input data-k="candidateUrl" value="${esc(k.doc_candidate_url || "")}" placeholder="回収MTGで発行したアカウントのURL（会社プロフィールにも入ります）">
        <label>管理画面のURL</label><input data-k="adminUrl" value="${esc(k.doc_admin_url || "")}" placeholder="空なら https://casual-interview-api.brainverse-ai.com/">
      </div>
      ${k.error ? `<div class="cs-err">${esc(k.error)}</div>` : ""}
      <div class="cs-act">
        <button type="button" class="btn" data-act="save">保存</button>
        <button type="button" class="btn ghost" data-act="repost">保存してOBスレに修正版を投稿</button>
        <button type="button" class="btn ghost" data-act="draft">${k.draft_at ? "御礼メールの下書きを作り直す" : "御礼メールの下書きを作る"}</button>
        <button type="button" class="btn ghost" data-act="preview">御礼メールを見る</button>
        <button type="button" class="btn ghost" data-act="redo">議事録から読み取り直す</button>
        <a class="btn ghost" href="${esc(k.meeting_url)}" target="_blank" rel="noopener">議事録を開く</a>
      </div>
      <div class="cs-mail" data-mail hidden></div>
    </div>`;
  }).join("");
  box.querySelectorAll(".cs-h").forEach((h) => h.addEventListener("click", () => { csOpen = csOpen === h.dataset.bot ? "" : h.dataset.bot; render(); }));
  const card = box.querySelector(".cs-card.open");
  if (!card) return;
  const bot = csOpen;
  const collect = () => {
    const fields = {};
    card.querySelectorAll("[data-f]").forEach((el) => { fields[el.dataset.f] = el.value.trim() || "未確認"; });
    card.querySelectorAll("[data-list]").forEach((el) => { fields[el.dataset.list] = el.value.split(/\n/).map((x) => x.trim()).filter(Boolean); });
    const b = { fields };
    card.querySelectorAll("[data-k]").forEach((el) => { b[el.dataset.k] = el.dataset.k === "confirmStart" ? (el.value ? `${el.value}:00+09:00` : "") : el.value.trim(); });
    return b;
  };
  const save = async () => api(`/api/cs/kickoffs/${encodeURIComponent(bot)}`, { method: "PUT", body: JSON.stringify(collect()) });
  card.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", async () => {
    const act = b.dataset.act;
    b.disabled = true;
    try {
      if (act === "save") { await save(); say("保存しました"); await load(); }
      else if (act === "repost") { await save(); await api(`/api/cs/kickoffs/${encodeURIComponent(bot)}/repost`, { method: "POST" }); say("OBスレに修正版を投稿しました"); await load(); }
      else if (act === "draft") { await save(); const r = await api(`/api/cs/kickoffs/${encodeURIComponent(bot)}/draft`, { method: "POST" }); say(`FSのGmailに下書きを作りました${r.to ? `（宛先：${r.to}）` : "（宛先が空です）"}`); await load(); }
      else if (act === "redo") { if (!confirm("議事録から項目を読み取り直します（いま直した内容は上書きされます）。よろしいですか？")) { b.disabled = false; return; } await api(`/api/cs/kickoffs/${encodeURIComponent(bot)}/redo`, { method: "POST" }); say("読み取り直して、OBスレに修正版を投稿しました"); await load(); }
      else if (act === "preview") {
        await save();
        const r = await api(`/api/cs/kickoffs/${encodeURIComponent(bot)}/mail-preview`);
        const m = card.querySelector("[data-mail]"); m.hidden = false; m.textContent = `件名：${r.subject}\n\n${r.body}`;
      }
    } catch (e) { alert(e.message); }
    b.disabled = false;
  }));
}
function renderSettings() {
  const d = csData; const box = $("csSet"); if (!d || !box) return;
  const mem = [0, 1, 2].map((i) => d.members[i] || { email: "", name: "" });
  box.innerHTML = `<div class="cs-set">
      ${mem.map((m, i) => `<label>CS ${i + 1}</label><div style="display:flex;gap:6px"><input data-ce="${i}" value="${esc(m.email)}" placeholder="メールアドレス"><input data-cn="${i}" value="${esc(m.name)}" placeholder="名前"></div>`).join("")}
      <label>OBスレ</label><input id="csSpace" value="${esc(d.space)}" placeholder="https://chat.google.com/room/… または spaces/…">
      <label>御礼メールの件名</label><input id="csSubj" value="${esc(d.subject)}">
      <label>御礼メールの本文</label><textarea id="csBody" rows="16">${esc(d.body)}</textarea>
    </div>
    <p class="note">差し込み：{企業名} {先方ご担当者名} {確認MTGの日時} {確認MTGのURL} {管理画面URL} {候補者用画面URL} {貴社の宿題} {弊社の宿題}（無いときは項目ごと消えます） {差出人}。OBスレには、Google Chatで kinbot アプリを追加しておいてください。</p>
    <div class="cs-act"><button type="button" class="btn" id="csSetSave">設定を保存</button><button type="button" class="btn ghost" id="csSetDef">本文を最初のひな形に戻す</button></div>`;
  $("csSetDef").addEventListener("click", () => { $("csBody").value = d.defaultBody; });
  $("csSetSave").addEventListener("click", async () => {
    const members = [0, 1, 2].map((i) => ({ email: box.querySelector(`[data-ce="${i}"]`).value.trim(), name: box.querySelector(`[data-cn="${i}"]`).value.trim() })).filter((m) => m.email);
    try { await api("/api/cs/settings", { method: "PUT", body: JSON.stringify({ members, space: $("csSpace").value, subject: $("csSubj").value, body: $("csBody").value }) }); say("設定を保存しました"); await load(); renderSettings(); }
    catch (e) { alert(e.message); }
  });
}
$("csReload").addEventListener("click", load);
$("csImportBtn").addEventListener("click", async () => {
  const v = $("csImport").value.trim(); if (!v) return;
  say("取り込んでいます…（議事録を読むので、少しかかります）");
  try { const r = await api("/api/cs/import", { method: "POST", body: JSON.stringify({ botId: v }) }); csOpen = r.bot; $("csImport").value = ""; say("取り込んで、OBスレに投稿しました"); await load(); }
  catch (e) { alert(e.message); say(""); }
});
$("csSetBtn").addEventListener("click", () => { const b = $("csSet"); b.hidden = !b.hidden; if (!b.hidden) renderSettings(); });
load();
