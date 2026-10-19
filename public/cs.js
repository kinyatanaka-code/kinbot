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
  // 企業カード：1社1枚。押すと、直す画面（窓）が開く
  const coName = (k) => { const f = k.fields || {}; return f.企業名 && f.企業名 !== "未確認" ? f.企業名 : k.company; };
  const v = (x) => (x && x !== "未確認" ? esc(x) : '<span class="cs-unk">未確認</span>');
  const q = String(($("csQ") && $("csQ").value) || "").normalize("NFKC").replace(/[\s　]|株式会社|有限会社|医療法人|社会福祉法人/g, "").toLowerCase();
  const shown = d.kickoffs.filter((k) => !q || String(coName(k) || "").normalize("NFKC").replace(/[\s　]|株式会社|有限会社|医療法人|社会福祉法人/g, "").toLowerCase().includes(q));
  if ($("csCount")) $("csCount").textContent = q ? `${shown.length}／${d.kickoffs.length}社` : `${d.kickoffs.length}社`;
  const cards = shown.map((k) => {
    const f = k.fields || {};
    const unk = FIELDS.filter(([key]) => !f[key] || f[key] === "未確認").length;
    const confirm = k.confirm_start ? fmtDT(k.confirm_start) : (f.次回MTGの日時 && f.次回MTGの日時 !== "未確認" ? f.次回MTGの日時 : "");
    const bill = String(f.請求書着日スケジュール || "");
    return `<div class="cs-co" data-bot="${esc(k.bot_id)}" tabindex="0">
      <div class="cs-co-top"><div class="cs-co-name">${esc(coName(k))}</div>${k.posted_at ? '<span class="cs-dot ok" title="OBスレ投稿済み"></span>' : '<span class="cs-dot ng" title="OBスレ未投稿"></span>'}</div>
      <div class="cs-co-who"><span>FS ${esc(k.fs_name || "-")}</span>${k.cs_name ? `<span class="ok">CS ${esc(k.cs_name)}</span>` : '<span class="warn">CS 未定</span>'}</div>
      <dl class="cs-co-dl">
        <dt>回収MTG</dt><dd>${esc(fmtDT(k.meeting_at))}</dd>
        <dt>確認MTG</dt><dd>${confirm ? `<b>${esc(confirm)}</b>` : '<span class="cs-unk">未確認</span>'}</dd>
        <dt>納品月</dt><dd>${v(f.納品月)}</dd>
        <dt>公開予定</dt><dd>${v(f.公開予定時期)}</dd>
        <dt>活用場所</dt><dd class="cl">${v(f.活用場所)}</dd>
        <dt>請求</dt><dd>${bill && bill !== "未確認" ? `<span class="${/問題なし/.test(bill) ? "okt" : "wt"}">${esc(bill)}</span>` : '<span class="cs-unk">未確認</span>'}</dd>
      </dl>
      <div class="cs-co-foot">
        ${k.draft_at ? '<span class="cs-pill ok">御礼メール下書きあり</span>' : '<span class="cs-pill">御礼メール：まだ</span>'}
        ${unk ? `<span class="cs-pill warn">未確認 ${unk}</span>` : ""}
        ${k.error ? '<span class="cs-pill ng">エラー</span>' : ""}
      </div>
    </div>`;
  }).join("");
  const openK = d.kickoffs.find((k) => k.bot_id === csOpen);
  // 直す窓は、画面のいちばん手前（メニューより上）に出すため body の直下に置く
  let host = document.getElementById("csModalHost");
  if (!host) { host = document.createElement("div"); host.id = "csModalHost"; document.body.appendChild(host); }
  box.innerHTML = shown.length ? `<div class="cs-cards">${cards}</div>` : `<div class="empty-state">「${esc(($("csQ") || {}).value || "")}」に合う企業はありません</div>`;
  host.innerHTML = (openK ? `<div class="cs-modal-back" id="csBack"><div class="cs-modal">${(() => {
    const k = openK, f = k.fields || {};
    const unk = FIELDS.filter(([key]) => !f[key] || f[key] === "未確認").length;
    const pills = [
      k.posted_at ? `<span class="cs-pill ok">OBスレ投稿済み</span>` : `<span class="cs-pill ng">未投稿</span>`,
      k.cs_name ? `<span class="cs-pill ok">CS：${esc(k.cs_name)}</span>` : `<span class="cs-pill warn">CS担当：未定</span>`,
      k.draft_at ? `<span class="cs-pill ok">御礼メール下書きあり</span>` : `<span class="cs-pill">御礼メール：まだ</span>`,
      unk ? `<span class="cs-pill warn">未確認 ${unk}項目</span>` : "",
    ].join("");
    const head = `<div class="cs-h" style="cursor:default"><b>${esc(coName(k))}</b>
      <span class="cs-sub">回収MTG ${esc(fmtDT(k.meeting_at))}・FS ${esc(k.fs_name || "")}</span>${pills}<button type="button" class="cs-x" id="csClose" aria-label="閉じる">✕</button></div>`;
    const csOpts = `<option value="">未定</option>` + d.members.map((m) => `<option value="${esc(m.email)}"${m.email === k.cs_email ? " selected" : ""}>${esc(m.name)}</option>`).join("");
    const rows = FIELDS.map(([key, lb]) => `<label>${esc(lb)}</label><input data-f="${esc(key)}" value="${esc(f[key] || "")}" class="${!f[key] || f[key] === "未確認" ? "unk" : ""}">`).join("");
    return `<div class="cs-card open" style="border:0;box-shadow:none;padding:0">${head}
      <div class="cs-grid">
        ${rows}
        <label>弊社の宿題</label><textarea data-list="弊社の宿題" rows="3" placeholder="1行に1つ。無ければ空（メールの項目ごと出しません）">${esc((f.弊社の宿題 || []).join("\n"))}</textarea>
        <label>貴社の宿題</label><textarea data-list="貴社の宿題" rows="2" placeholder="初期学習のほかにお願いしたこと（1行に1つ）">${esc((f.貴社の宿題 || []).join("\n"))}</textarea>
        <label>CS担当</label><div style="display:flex;gap:8px;align-items:center"><select data-k="csEmail" style="flex:1">${csOpts}</select><button type="button" class="btn ghost" data-act="autocs" style="white-space:nowrap">空いている人を自動で選ぶ</button></div>
        <label>確認MTGの日時</label><div><input type="datetime-local" data-k="confirmStart" value="${esc(toLocal(k.confirm_start))}"><div class="cs-sub">${k.confirm_from ? `（${esc(k.confirm_from)}から）` : "カレンダー・議事録から見つかりませんでした"}${k.confirm_url ? `　参加URL：<a href="${esc(k.confirm_url)}" target="_blank" rel="noopener">${esc(k.confirm_url)}</a>` : ""}</div></div>
        <label>SFの商談</label><div><input data-k="sfUrl" value="${esc(k.sf_url || "")}" placeholder="SFの商談のURL（見つからなかったときは貼ってください）">${k.sf_url ? `<div class="cs-sub"><a href="${esc(k.sf_url)}" target="_blank" rel="noopener">SFで開く ↗</a></div>` : ""}</div>
        <label>先方のメール</label><input data-k="clientEmail" value="${esc(k.client_email || "")}" placeholder="御礼メールの宛先">
        <label>候補者用画面のURL</label><div><input data-k="candidateUrl" value="${esc(k.doc_candidate_url || "")}" placeholder="${esc(k.sheet_candidate_url ? `スプレッドシートの値を使います：${k.sheet_candidate_url}` : "スプレッドシートに見つかりません。ここに入れるとこちらを使います")}">
          <div class="cs-sub">${k.doc_candidate_url ? "手で入れたURLを使います" : k.sheet_candidate_url ? `スプレッドシートから：<a href="${esc(k.sheet_candidate_url)}" target="_blank" rel="noopener">${esc(k.sheet_candidate_url)}</a>` : (d.candidateSheetError ? `スプレッドシートを読めませんでした：${esc(d.candidateSheetError)}` : "スプレッドシート（C列＝会社名）に、この会社が見つかりません")}</div></div>
        <label>管理画面のURL</label><div class="cs-sub" style="padding-top:7px;">${esc(d.adminUrl || "")}（全社共通）</div>
        <label>ヘルプサイト</label><div>
          ${k.portal_text ? `<div class="cs-sub">企業ID：<b>${esc(k.portal_id || "-")}</b>（${esc(fmtDT(k.portal_at))} に用意）</div><pre class="cs-portal">${esc(k.portal_text)}</pre>` : `<div class="cs-sub">まだ用意していません</div>`}
          ${k.portal_error ? `<div class="cs-err">用意できませんでした：${esc(k.portal_error)}${k.has_portal_shot ? `　<a href="/api/cs/kickoffs/${encodeURIComponent(k.bot_id)}/portal-shot" target="_blank" rel="noopener">そのときの画面</a>` : ""}</div>` : ""}
          <button type="button" class="btn ghost" data-act="portal" style="margin-top:6px">${k.portal_text ? "アカウントを用意し直す" : "ヘルプサイトのアカウントを用意する"}</button></div>
      </div>
      ${k.error ? `<div class="cs-err">${esc(k.error)}</div>` : ""}
      <div class="cs-act">
        <button type="button" class="btn" data-act="save">保存</button>
        <button type="button" class="btn ghost" data-act="repost">保存してOBスレに修正版を投稿</button>
        <button type="button" class="btn ghost" data-act="draft">${k.draft_at ? "御礼メールの下書きを作り直す" : "御礼メールの下書きを作る"}</button>
        <button type="button" class="btn ghost" data-act="preview">御礼メールを見る</button>
        <button type="button" class="btn ghost" data-act="redo">議事録から読み取り直す</button>
        <a class="btn ghost" href="${esc(k.meeting_url)}" target="_blank" rel="noopener">議事録を開く</a>
        ${k.sf_url ? `<a class="btn ghost" href="${esc(k.sf_url)}" target="_blank" rel="noopener">SFの商談を開く</a>` : ""}
      </div>
      <div class="cs-mail" data-mail hidden></div>
    </div>`;
  })()}</div></div>` : "");
  box.querySelectorAll(".cs-co").forEach((c) => {
    const go = () => { csOpen = c.dataset.bot; render(); };
    c.addEventListener("click", go);
    c.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  });
  const back = $("csBack");
  if (back) {
    const close = () => { csOpen = ""; render(); };
    back.addEventListener("click", (e) => { if (e.target === back) close(); });
    $("csClose").addEventListener("click", close);
    document.onkeydown = (e) => { if (e.key === "Escape" && csOpen) close(); };
  }
  const card = host.querySelector(".cs-card.open");
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
      if (act === "save") { const r = await save(); say(r && r.autoNote ? `保存しました。${r.autoNote}` : "保存しました"); await load(); }
      else if (act === "portal") {
        say("CS Platformで用意しています…（ブラウザを動かすので30秒ほどかかります）");
        try { await api(`/api/cs/kickoffs/${encodeURIComponent(bot)}/portal`, { method: "POST" }); say("ヘルプサイトのアカウントを用意しました（御礼メールに入ります）"); }
        catch (e) { say(""); alert(e.message); }
        await load();
      }
      else if (act === "autocs") {
        const r = await api(`/api/cs/kickoffs/${encodeURIComponent(bot)}/autocs`, { method: "POST", body: JSON.stringify({ exceptCurrent: !!card.querySelector('[data-k="csEmail"]').value }) });
        say(`CS担当を ${r.picked} さんにしました（${r.reason}）`); await load();
      }
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
  box.innerHTML = `<p class="note" style="margin:0 0 8px;">CS担当の候補には、設定 → メンバー管理 で役割「CS」を付けた人が出ます（いま ${d.members.length}名）。下の欄は、メンバー管理にいない人を足したいときだけ使います。</p><div class="cs-set">
      ${mem.map((m, i) => `<label>CS ${i + 1}</label><div style="display:flex;gap:6px"><input data-ce="${i}" value="${esc(m.email)}" placeholder="メールアドレス"><input data-cn="${i}" value="${esc(m.name)}" placeholder="名前"></div>`).join("")}
      <label>OBスレ</label><div><input id="csSpace" value="${esc(d.space)}" placeholder="https://chat.google.com/room/… または spaces/…"><div class="cs-sub">設定 → 通知先 で「CS連携（回収MTG）」にチェックした送り先があれば、そちらに送ります（ここは予備）。</div></div>
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
$("csQ").addEventListener("input", render);
// 企業カードの中身をCSV（Excelで開ける・UTF-8のBOMつき）で書き出す。検索で絞っているときは、その分だけ
$("csCsv").addEventListener("click", () => {
  const d = csData; if (!d) return;
  const q = String(($("csQ") && $("csQ").value) || "").normalize("NFKC").replace(/[\s　]|株式会社|有限会社|医療法人|社会福祉法人/g, "").toLowerCase();
  const nm = (k) => { const f = k.fields || {}; return f.企業名 && f.企業名 !== "未確認" ? f.企業名 : k.company; };
  const rows = d.kickoffs.filter((k) => !q || String(nm(k) || "").normalize("NFKC").replace(/[\s　]|株式会社|有限会社|医療法人|社会福祉法人/g, "").toLowerCase().includes(q));
  const dt = (iso) => { const t = Date.parse(iso || ""); if (!isFinite(t)) return ""; const j = new Date(t + 9 * 3600000); return `${j.getUTCFullYear()}/${j.getUTCMonth() + 1}/${j.getUTCDate()} ${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`; };
  const head = ["企業名", "回収MTG", "FS", "CS担当", "確認MTG", "先方ご担当者名", "活用場所・利用シーン", "公開予定時期", "納品月", "請求スケジュール", "特記事項", "弊社の宿題", "貴社の宿題", "先方のメール", "候補者用画面URL", "SFの商談", "議事録", "OBスレ投稿", "御礼メールの下書き"];
  const body = rows.map((k) => { const f = k.fields || {}; return [
    nm(k), dt(k.meeting_at), k.fs_name || "", k.cs_name || "", k.confirm_start ? dt(k.confirm_start) : (f.次回MTGの日時 || ""),
    f.先方ご担当者名 || "", f.活用場所 || "", f.公開予定時期 || "", f.納品月 || "", f.請求書着日スケジュール || "", f.特記事項 || "",
    (f.弊社の宿題 || []).join("／"), (f.貴社の宿題 || []).join("／"), k.client_email || "", k.doc_candidate_url || k.sheet_candidate_url || "",
    k.sf_url || "", k.meeting_url || "", k.posted_at ? dt(k.posted_at) : "", k.draft_at ? dt(k.draft_at) : "",
  ]; });
  const cell = (v) => { const t = String(v == null ? "" : v); return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = "\uFEFF" + [head, ...body].map((r) => r.map(cell).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const j = new Date(Date.now() + 9 * 3600000);
  a.download = `CS連携_企業一覧_${j.toISOString().slice(0, 10).replace(/-/g, "")}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  say(`${rows.length}社をCSVで書き出しました`);
});
window.csRenderSettings = () => { if (csData) renderSettings(); };
$("csImportBtn").addEventListener("click", async () => {
  const v = $("csImport").value.trim(); if (!v) return;
  const st = $("csImpSt"); st.textContent = "取り込んでいます…（議事録を読むので、少しかかります）";
  try {
    const r = await api("/api/cs/import", { method: "POST", body: JSON.stringify({ botId: v }) });
    $("csImport").value = ""; st.textContent = "取り込んで、OBスレに投稿しました";
    csOpen = r.bot; await load();
    document.querySelector('.cs-tab[data-tab="cards"]').click();
  } catch (e) { st.textContent = "失敗：" + e.message; }
});

load();
// 管理シートの記録から、MOCHICAの商談の分を外す（全角の英字も見る）。直しの文の中のMOCHICAの会社の行も外す
function nbCleanLog(log) {
  const isMo = (x) => /MOCHI/i.test(`${x.plan || ""} ${x.products || ""} ${x.opp || ""}`.normalize("NFKC"));
  const moCos = new Set(log.filter(isMo).map((x) => String(x.company || "").normalize("NFKC").trim()).filter(Boolean));
  return log.filter((x) => !isMo(x)).map((x) => x.repair ? { ...x, repair: x.repair.filter((t) => ![...moCos].some((c) => String(t).normalize("NFKC").includes(c))) } : x)
    .filter((x) => !(x.repair && !x.repair.length));
}
async function loadNb() {
  const box = document.getElementById("nbLog"); if (!box) return;
  try {
    const d = await api("/api/cs/nb-sheet/log");
    box.innerHTML = (d.writer ? `書き込む人：${esc(d.writer)}<br>` : `<span style="color:#b3261e">シートに書けるGoogle連携の人がいません</span><br>`) +
      (d.planField ? `プラン名を読むSFの項目：${esc(d.planField)}<br>` : "") +
      // MOCHICAの商談の記録（前の版で書いてしまったもの）と、中身の無い「直し」は出さない
      ((d.log = nbCleanLog(d.log || [])).length ? d.log.slice(0, 15).map((x) => x.repair ? `${esc(fmtDT(x.at))}　<b>${x.company === "（空欄を埋めました）" ? "空欄を埋めました" : "直し"}</b>：${x.repair.map(esc).join("／")}` : `${esc(fmtDT(x.at))}　${x.error ? `<span style="color:#b3261e">${esc(x.company || "")}：${esc(x.error)}</span>` : `${esc(x.company)}（${x.row}行目）プラン：${esc(x.plan || "-")}${x.planField ? `（SFの「${esc(x.planField)}」）` : ""}・${esc(x.initial || "初期：書かず")}・担当：${esc(x.person || "-")}${x.products ? `・商品：${esc(x.products)}` : ""}`}`).join("<br>") : "まだ記入した会社はありません");
  } catch (e) { box.textContent = e.message; }
}
loadNb();
document.getElementById("nbRun").addEventListener("click", async () => {
  const st = document.getElementById("nbSt"); st.textContent = "確認しています…";
  try {
    const r = await api("/api/cs/nb-sheet/run", { method: "POST" });
    st.textContent = r.skipped === "busy" ? "いま動いています。少し待ってください" : `記入 ${(r.written || []).length}件${(r.filled || []).length ? `・空欄を埋めた ${(r.filled || []).length}社` : ""}${(r.skipped || []).length ? `・すでにある ${(r.skipped || []).length}件` : ""}${(r.errors || []).length ? `・エラー：${r.errors.join("／")}` : ""}`;
    loadNb();
  } catch (e) { st.textContent = "失敗：" + e.message; }
});
