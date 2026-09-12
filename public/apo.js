const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const apState = { reps: [], appts: [], errors: [] };

// 現在選択中の事業（全体なら空文字）。トップバーの 全体/DOC/MOCHICA と連動する。
function curBiz() {
  try { return (window.kbProduct && window.kbProduct.current()) || ""; } catch { return ""; }
}
function bizQuery() {
  const b = curBiz();
  return b ? "&product=" + encodeURIComponent(b) : "";
}
function bizLabel(id) {
  const el = $(id);
  if (!el) return;
  const b = curBiz();
  el.textContent = b || "全体";
  el.className = "ap-biz-badge" + (b ? " ap-biz-" + b : "");
}

// ISO日時 → 「7/10(水) 14:00」（ブラウザのタイムゾーン＝通常JST）
function fmtDT(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return esc(iso);
  const wd = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()}(${wd}) ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// "YYYY-MM-DD" → "M/D"
function fmtYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ""));
  return m ? `${Number(m[2])}/${Number(m[3])}` : esc(ymd);
}
// ISO → "HH:MM"（時刻だけ）
function fmtHM(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
// カード内で使う小さなアイコン（kinbotはインラインSVG。Tablerは読み込んでいない）
const AP_ICO = {
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 2.5v4M16 2.5v4"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3 10.5 13.5M21 3l-6.5 18-4-8.5L2 8.5 21 3z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="12" cy="19" r="1.7"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 6.5"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3 4 14h7l-1 7 9-11h-7l1-7z"/></svg>',
};
function repOptions(selected) {
  let o = `<option value="">担当未定</option>`;
  for (const r of apState.reps) {
    const sel = r.email === selected ? " selected" : "";
    o += `<option value="${esc(r.email)}"${sel}>${esc(r.name)}${r.has_zoom_link ? "" : "（Zoom未設定）"}</option>`;
  }
  return o;
}
// アポ獲得者の選択肢（候補＝アポ獲得者マスタ。現在の獲得者が候補に無ければ先頭に足す）
function setterOptions(curName, curEmail) {
  const list = apState.setters || [];
  const curE = String(curEmail || "").toLowerCase();
  const cur = String(curName || "").trim();
  const match = (s) => (curE && String(s.email || "").toLowerCase() === curE) || (!curE && cur && String(s.name || "").trim() === cur);
  const inList = list.some(match);
  let o = "";
  if (cur && !inList) o += `<option value="__cur__" data-name="${esc(cur)}" selected>${esc(cur)}（現在）</option>`;
  else if (!cur) o += `<option value="__cur__" data-name="" selected>（未設定）</option>`;
  for (const s of list) {
    const sel = match(s) ? " selected" : "";
    o += `<option value="${esc(s.email || "")}" data-name="${esc(s.name || "")}"${sel}>${esc(s.name || s.email)}</option>`;
  }
  return o;
}


function statusCell(a) {
  if (!a.current_owner) return `<span class="ap-badge ap-pending">担当未定</span>`;
  const rep = apState.reps.find((r) => r.email === a.current_owner);
  if (rep && rep.has_zoom_link) return `<span class="ap-badge ap-ok">${esc(rep.name)}のZoomへ転送中</span>`;
  return `<span class="ap-badge ap-warn">${esc(rep ? rep.name : a.current_owner)}：Zoom未設定</span>`;
}
// 宛先の編集と手動送信のボタンをつなぐ。セルを描き直したあとにも呼ぶ。
function bindMailButtons(scope) {
  scope.querySelectorAll(".ap-mailedit").forEach((b) => {
    b.addEventListener("click", async () => {
      const i = +b.dataset.i;
      const a = apState.appts[i];
      const cur = a.client_email || "";
      const next = prompt("お客様のメールアドレスを入力してください。\n（空にすると宛先を削除します）", cur);
      if (next === null) return;
      const email = String(next).trim();
      b.disabled = true;
      try {
        const r = await fetch(`/api/smart-links/${encodeURIComponent(a.slug)}/client`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, name: a.client_name || "" }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "保存に失敗しました");
        a.client_email = (d.link && d.link.client_email) || "";
        a.client_email_source = (d.link && d.link.client_email_source) || "";
        refreshMailCell(i);
      } catch (e) {
        alert("宛先の保存に失敗しました: " + e.message);
      } finally { b.disabled = false; }
    });
  });
  scope.querySelectorAll(".ap-sendmail").forEach((b) => {
    b.addEventListener("click", async () => {
      const i = +b.dataset.i;
      const a = apState.appts[i];
      const kind = b.dataset.kind || "confirm";
      const already = (a.mail || {})[kind] && (a.mail || {})[kind].status === "sent";
      const label = kind === "reminder" ? "前日リマインド" : "アポ確定メール";
      const dm = (apState.mailConfig || {}).deliverMode !== "send";
      const verb = dm ? "下書きを作成" : "送信";
      const msg = already
        ? `この商談の${label}はすでに${dm ? "下書きを作成" : "送信"}済みです。もう一度${verb}しますか？`
        : `${a.current_owner} のGmailに${label}の${dm ? "下書きを作成" : "送信を実行"}します。よろしいですか？`;
      if (!confirm(msg)) return;
      b.disabled = true;
      const orig = b.textContent;
      b.textContent = "送信中…";
      try {
        const r = await fetch(`/api/smart-links/${encodeURIComponent(a.slug)}/mail`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ kind, force: !!already }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "送信に失敗しました");
        a.mail = Object.assign({}, a.mail, { [kind]: { status: d.draft ? "draft" : "sent", at: new Date().toISOString() } });
        refreshMailCell(i);
        if (d.noRoom) {
          alert(`${a.current_owner} が「設定 → 登録リンク」に会議室URLを登録していません。\n\n` +
            `メールのURLはkinbotのスマートリンクなので、このままだとお客様が開いても入室できません。\n` +
            `本人に登録してもらってから送信してください。`);
        }
      } catch (e) {
        a.mail = Object.assign({}, a.mail, { [kind]: { status: "failed", error: e.message } });
        refreshMailCell(i);
        alert("送信に失敗しました: " + e.message);
      } finally { b.disabled = false; b.textContent = orig; }
    });
  });
}
// 1枚のカードだけを描き直す（メールの状態や宛先が変わったとき）
function refreshMailCell(i) {
  const card = document.querySelector(`.ap-card[data-i="${i}"]`);
  if (!card) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = apoCard(apState.appts[i], i);
  const next = wrap.firstElementChild;
  card.replaceWith(next);
  bindCardEvents(next);
}

// 「8/9(日)」のような1行の見出し
function fmtDay(iso) {
  if (!iso) return "日付未定";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "日付未定";
  const wd = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  const t = new Date();
  const same = (x, y) => x.toDateString() === y.toDateString();
  const tomorrow = new Date(t.getTime() + 86400000);
  const head = `${d.getMonth() + 1}月${d.getDate()}日(${wd})`;
  if (same(d, t)) return head + "　今日";
  if (same(d, tomorrow)) return head + "　明日";
  return head;
}
function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

// アポ1件をカードにする（整理版：8項目を1枚で管理・稀な操作は「⋯」へ）
function apoCard(a, i) {
  const assigned = !!a.current_owner;
  const rep = apState.reps.find((r) => r.email === a.current_owner);
  const repName = rep ? (rep.name || rep.email) : a.current_owner;
  const m = a.mail || {};
  const sf = a.sf; // {stage,linked,launched,oppId} ／ null=SF未接続 ／ undefined=取得前

  // チップ部品
  const chipOk = (t) => `<span class="ap-c2-chip ap-c2-ok">${AP_ICO.check}${esc(t)}</span>`;
  const chipMuted = (t) => `<span class="ap-c2-chip ap-c2-muted">${esc(t)}</span>`;
  const chipWarn = (t) => `<span class="ap-c2-chip ap-c2-warn">${esc(t)}</span>`;

  // メール状態チップ
  const mchip = (label, s) => {
    if (!s) return chipMuted(label + "：未");
    if (s.status === "sent") return chipOk(label);
    if (s.status === "draft") return `<span class="ap-c2-chip ap-c2-draft">${esc(label)}：下書き</span>`;
    return chipWarn(label + "：失敗");
  };

  // 商談ステージ（Salesforceから）
  let stage;
  if (!assigned) stage = `<span class="ap-c2-stagepill ap-c2-stage-plan">担当未定</span>`;
  else if (sf === undefined) stage = `<span class="ap-c2-stagepill ap-c2-stage-load">ステージ取得中…</span>`;
  else if (sf && sf.stage) stage = `<span class="ap-c2-stagepill" title="Salesforceの商談ステージ">${esc(sf.stage)}</span>`;
  else stage = `<span class="ap-c2-stagepill ap-c2-stage-load">ステージ未取得</span>`;

  // SFチップ（紐付け・立ち上げ）
  let sfChips;
  if (sf === undefined) sfChips = `<span class="ap-c2-chip ap-c2-muted">SF：取得中…</span>`;
  else if (sf === null) sfChips = `<button class="ap-c2-chip ap-c2-muted ap-c2-btnchip ap-sflink" data-i="${i}" title="SF商談を選ぶ／立ち上げる">SF：未接続</button>`;
  else {
    const linkChip = sf.linked
      ? `<button class="ap-c2-chip ap-c2-ok ap-c2-btnchip ap-sflink" data-i="${i}" title="紐付けを変更">${AP_ICO.check}SF紐付け</button>`
      : `<button class="ap-c2-chip ap-c2-muted ap-c2-btnchip ap-sflink" data-i="${i}" title="SF商談を紐付ける">SF未紐付け</button>`;
    const launchChip = sf.launched
      ? chipOk("商談立ち上げ")
      : (assigned
          ? `<button class="ap-c2-chip ap-c2-launch ap-sflaunch" data-slug="${esc(a.slug)}" data-i="${i}" title="Salesforceの商談を立ち上げます">${AP_ICO.bolt}SF立ち上げ</button>`
          : chipMuted("立ち上げ前"));
    sfChips = linkChip + launchChip;
  }

  // Zoom転送
  let zoomChip = "";
  if (assigned) {
    zoomChip = (rep && rep.has_zoom_link)
      ? `<span class="ap-c2-chip ap-c2-zoom"><span class="ap-c2-dot"></span>${esc(rep.name)}のZoomへ転送中</span>`
      : chipWarn(`${esc(rep ? rep.name : a.current_owner)}：Zoom未設定`);
  }
  const exChip = a.excluded ? chipWarn("集計から除外") : "";

  // 宛先（クラス・data属性は既存のまま：ap-mailedit）
  const srcChip = a.client_email_source === "description" ? '<span class="ap-src-chip">説明欄</span>' : "";
  const mailBody = a.client_email
    ? `<span class="ap-c2-addr">${esc(a.client_email)}</span>${srcChip}` +
      `<button class="btn-ico ap-mailedit" data-i="${i}" title="宛先を変更" aria-label="宛先を変更">${AP_ICO.edit}</button>`
    : `<button class="btn ghost ap-mailedit ap-warn-btn" data-i="${i}">宛先を入力</button>`;

  const canSend = assigned && !!a.client_email;
  const draftMode = (apState.mailConfig || {}).deliverMode !== "send";
  const sendBtn = canSend
    ? `<button class="btn ap-c2-send ap-sendmail" data-i="${i}" data-kind="confirm">${draftMode ? "下書きを作る" : "メールを送信"}</button>`
    : "";

  const initial = (nm) => esc(String(nm || "？").trim().charAt(0) || "？");
  const bizPill = a.business ? `<span class="ap-c2-biz ap-biz-${esc(a.business)}">${esc(a.business)}</span>` : "";

  return `<div class="home-card home-card-v ap-card ap-card2${assigned ? "" : " home-card-plan"}" data-i="${i}">
    <div class="ap-c2">
      <div class="ap-c2-rail">
        <div class="ap-c2-date">取得 ${esc(fmtYmd(a.created_date))}</div>
        <div class="ap-c2-timerow">
          <span class="ap-c2-time">${esc(fmtHM(a.start))}</span>
          <button class="btn-ico ap-resched" data-slug="${esc(a.slug)}" data-start="${esc(a.start_time || "")}" data-label="${esc(a.label || "")}" title="時間を変更" aria-label="時間を変更">${AP_ICO.cal}</button>
        </div>
        ${stage}
      </div>
      <div class="ap-c2-main">
        <div class="ap-c2-head">
          <div class="ap-c2-title">${esc(a.title)} ${bizPill}</div>
          <div class="ap-c2-more">
            <button class="btn-ico ap-more-btn" aria-label="そのほかの操作" title="そのほかの操作">${AP_ICO.dots}</button>
            <div class="ap-more-menu">
              <a class="ap-more-item" href="${esc(a.smart_url)}" target="_blank" rel="noopener">お客様ページを開く</a>
              <button class="ap-more-item ap-launch-detail" data-i="${i}">SF立ち上げ（細かく入力）</button>
              <button class="ap-more-item ap-sflink-menu" data-i="${i}">SF商談の紐付けを変更</button>
              <button class="ap-more-item ap-copy" data-url="${esc(a.smart_url)}">リンクをコピー</button>
              <button class="ap-more-item ap-calonly" data-i="${i}" data-slug="${esc(a.slug)}">カレンダーだけ作る</button>
              <button class="ap-more-item ap-renotify" data-slug="${esc(a.slug)}">割り振り通知だけ再送</button>
              <button class="ap-more-item ap-why" data-slug="${esc(a.slug)}">メール・SF・通知の状態を調べる</button>
              <button class="ap-more-item ap-exclude" data-slug="${esc(a.slug)}" data-on="${a.excluded ? "1" : "0"}">${a.excluded ? "集計に戻す" : "テストとして外す"}</button>
            </div>
          </div>
        </div>
        <div class="ap-c2-chips">
          ${mchip("確定メール", m.confirm)}${mchip("前日リマインド", m.reminder)}${sfChips}${zoomChip}${exChip}
        </div>
        <div class="ap-c2-people">
          <div class="ap-c2-setter"><span class="ap-c2-av">${initial(a.setter_name)}</span><div><div class="ap-c2-k">獲得者</div><select class="ap-setter" data-i="${i}">${setterOptions(a.setter_name, a.setter_email)}</select></div></div>
          <div class="ap-c2-owner"><span class="ap-c2-k">担当</span><select class="ap-rep" data-i="${i}">${repOptions(a.current_owner)}</select>${assigned ? "" : `<button class="btn ghost ap-auto" data-i="${i}">自動で決める</button>`}</div>
        </div>
        <div class="ap-c2-mail">
          <span class="ap-c2-mailico">${AP_ICO.mail}</span>${mailBody}${sendBtn}
        </div>
      </div>
    </div>
  </div>`;
}

// 探す欄の言葉で、アポを絞り込む。
// 会社名・担当者名・獲得者・予定名・宛先のどれかに当たれば残す。
function apoMatches(x, word) {
  const w = String(word || "").replace(/[\s　]/g, "").toLowerCase();
  if (!w) return true;
  const norm = (v) => String(v || "").replace(/[\s　（）()・,、.。「」]/g, "").toLowerCase();
  const fields = [x.title, x.label, x.company, x.person, x.setter, x.owner_name,
                  x.current_owner, x.client_email, x.business];
  return fields.some((f) => norm(f).includes(w));
}

function renderApo() {
  const body = $("apoBody");
  const word = ($("apFind") && $("apFind").value) || "";
  const all = apState.appts || [];
  const appts = word ? all.filter((x) => apoMatches(x, word)) : all;
  const errNote = (apState.errors || []).length
    ? '<p class="note cc-warn">一部のカレンダーを読めませんでした：' +
      apState.errors.map((e) => esc(e.setter) + "（" + esc(e.error) + "）").join("、") + '</p>'
    : "";
  if (!appts.length) {
    body.innerHTML = word
      ? `<div class="empty-state">「${esc(word)}」に当てはまるアポはありませんでした（全${all.length}件のうち）。</div>` + errNote
      : '<div class="empty-state">該当するアポがありませんでした。取得日・商談日の指定を変えて［表示］を押すか、' +
        '<a href="settings.html#members">設定 → メンバー管理</a>の登録内容とカレンダー共有をご確認ください。</div>' + errNote;
    return;
  }

  // 商談日でグループにまとめる（ホームと同じ見せ方）
  // data-i は必ず「全体リスト（apState.appts）での番号」にする。
  // 検索でしぼり込むと並び番号がズレて、担当変更が別の企業に効いてしまうため。
  const groups = [];
  let last = null;
  appts.forEach((a) => {
    const i = all.indexOf(a);
    const key = String(a.start || "").slice(0, 10);
    if (!last || last.key !== key) { last = { key, label: fmtDay(a.start), items: [] }; groups.push(last); }
    last.items.push({ a, i });
  });

  let html = "";
  for (const g of groups) {
    html += `<div class="ap-daysec"><span class="ap-dayname">${esc(g.label)}</span>` +
      `<span class="ap-daycount">${g.items.length}件</span></div>`;
    for (const { a, i } of g.items) {
      html += apoCard(a, i);
    }
  }
  body.innerHTML = html + errNote;

  body.querySelectorAll(".ap-card").forEach(bindCardEvents);
}

// カード1枚ぶんのボタン・セレクトをつなぐ（描き直したあとにも呼ぶ）
function bindCardEvents(card) {
  const q = (sel) => card.querySelector(sel);

  const rep = q(".ap-rep");
  if (rep) rep.addEventListener("change", async () => {
    const i = +rep.dataset.i;
    const a = apState.appts[i];
    const owner = rep.value || null;
    rep.disabled = true;
    try {
      // 担当変更だけ：メール・通知・SF立ち上げ・商談予定の招待は動かさない（quiet）。
      // メールや通知は必要なときに、それぞれのボタン（メールを送信／⋯→通知だけ再送）で送る。
      const r = await fetch(`/api/smart-links/${encodeURIComponent(a.slug)}/owner`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner, quiet: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "変更に失敗しました");
      a.current_owner = owner;
      refreshMailCell(i);
      if (window.kbToast) kbToast(owner ? "担当を変更しました（メール・通知は送っていません）" : "担当を外しました");
    } catch (e) {
      alert("担当者の変更に失敗しました: " + e.message);
      rep.disabled = false;
    }
  });


  const setterSel = q(".ap-setter");
  if (setterSel) setterSel.addEventListener("change", async () => {
    const i = +setterSel.dataset.i;
    const a = apState.appts[i];
    const val = setterSel.value;
    if (val === "__cur__") return;
    const opt = setterSel.options[setterSel.selectedIndex];
    const name = (opt && opt.getAttribute("data-name")) || "";
    setterSel.disabled = true;
    try {
      const r = await fetch(`/api/smart-links/${encodeURIComponent(a.slug)}/setter`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email: val || "" }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "変更に失敗しました");
      a.setter_name = d.setter || name; a.setter_email = d.setter_email || val || "";
      if (window.kbToast) kbToast("アポ獲得者を変更しました");
      refreshMailCell(i);
    } catch (e) {
      alert("アポ獲得者の変更に失敗しました: " + e.message);
      setterSel.disabled = false;
    }
  });

  const calOnly = q(".ap-calonly");
  if (calOnly) calOnly.addEventListener("click", async () => {
    const i = +calOnly.dataset.i;
    const a = apState.appts[i];
    if (!a.current_owner) { alert("先に担当を選んでください。\n担当のカレンダーに予定を作ります。"); return; }
    if (!confirm("担当のカレンダーに商談予定だけを作ります。\nメールは送りません。よろしいですか？")) return;
    calOnly.disabled = true;
    const bo = calOnly.textContent;
    calOnly.textContent = "作成中…";
    try {
      const r = await fetch(`/api/smart-links/${encodeURIComponent(a.slug)}/invite`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "作れませんでした");
      calOnly.textContent = "作りました";
      setTimeout(() => { calOnly.textContent = bo; calOnly.disabled = false; }, 2500);
    } catch (e) {
      alert("カレンダーに作れませんでした:\n" + e.message);
      calOnly.textContent = bo; calOnly.disabled = false;
    }
  });

  const auto = q(".ap-auto");
  if (auto) auto.addEventListener("click", async () => {
    const i = +auto.dataset.i;
    const a = apState.appts[i];
    auto.disabled = true;
    const bo = auto.textContent;
    auto.textContent = "判定中…";
    try {
      const r = await fetch(`/api/smart-links/${encodeURIComponent(a.slug)}/auto-assign`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "割り振れませんでした");
      loadApo();
    } catch (e) {
      alert("自動で決められませんでした:\n" + e.message);
      auto.disabled = false; auto.textContent = bo;
    }
  });

  const why = q(".ap-why");
  if (why) why.addEventListener("click", async () => {
    const card = why.closest(".ap-card");
    let box = card.querySelector(".ap-why-box");
    if (box) { box.remove(); return; }
    box = document.createElement("div");
    box.className = "ap-why-box";
    box.textContent = "調べています…";
    card.appendChild(box);
    try {
      const d = await (await fetch(`/api/apo/${encodeURIComponent(why.dataset.slug)}/why`)).json();
      if (d.error) throw new Error(d.error);
      box.innerHTML = (d.steps || []).map((x) =>
        `<div class="ap-why-row ${x.ok ? "ok" : "ng"}"><b>${x.ok ? "OK" : "要確認"}</b> ${esc(x.name)}` +
        `${x.detail ? `<span>${esc(x.detail)}</span>` : ""}</div>`).join("") +
        `<div class="ap-why-act"><button type="button" class="btn ap-redo">メール・SF・通知をやり直す</button>` +
        `<span class="rev-status ap-redo-st"></span></div>`;
      box.querySelector(".ap-redo").addEventListener("click", async (ev) => {
        const b = ev.target;
        const st2 = box.querySelector(".ap-redo-st");
        if (!confirm("メールの作成・SF立ち上げ・通知をもう一度行います。\nよろしいですか？")) return;
        b.disabled = true;
        st2.textContent = "やり直しています…";
        try {
          const r = await fetch(`/api/apo/${encodeURIComponent(why.dataset.slug)}/redo`, { method: "POST" });
          const d2 = await r.json();
          if (!r.ok) throw new Error(d2.error || "できませんでした");
          st2.textContent = d2.ok ? "やり直しました。通知を確認してください" : `できませんでした：${d2.reason || ""}`;
          if (d2.ok) setTimeout(load, 2000);
        } catch (e) { st2.textContent = "失敗: " + e.message; b.disabled = false; }
      });
    } catch (e) { box.innerHTML = `<div class="ap-why-row ng">${esc(e.message)}</div>`; }
  });

  const ex = q(".ap-exclude");
  if (ex) ex.addEventListener("click", async () => {
    const on = ex.dataset.on !== "1";
    if (on && !confirm(
      "このアポを、実績・均等化・通知の件数から外します。\n" +
      "担当者のカレンダーに作った商談予定も消します。\n\nよろしいですか？")) return;
    ex.disabled = true;
    try {
      const r = await fetch(`/api/smart-links/${encodeURIComponent(ex.dataset.slug)}/excluded`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ excluded: on }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "変えられませんでした");
      // 予定を消せなかったときだけ知らせる（消せたときは黙って進む）
      if (d.calendar && !/消しました|ありませんでした/.test(d.calendar)) alert(d.calendar);
      load();
    } catch (e) { alert(e.message); ex.disabled = false; }
  });

  const renotify = q(".ap-renotify");
  if (renotify) renotify.addEventListener("click", async () => {
    renotify.disabled = true;
    const before = renotify.textContent;
    renotify.textContent = "再送しています…";
    try {
      const r = await fetch(`/api/apo/${encodeURIComponent(renotify.dataset.slug)}/renotify`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "できませんでした");
      renotify.textContent = "再送しました";
    } catch (e) { renotify.textContent = "失敗"; alert(e.message); }
    setTimeout(() => { renotify.textContent = before; renotify.disabled = false; }, 2500);
  });

  const resched = q(".ap-resched");
  if (resched) resched.addEventListener("click", () => {
    const cur = resched.dataset.start ? new Date(resched.dataset.start) : null;
    const p2 = (n) => String(n).padStart(2, "0");
    let d0 = "", t0 = "";
    if (cur && !isNaN(cur.getTime())) {
      const j = new Date(cur.getTime() + 9 * 3600000);
      d0 = `${j.getUTCFullYear()}-${p2(j.getUTCMonth() + 1)}-${p2(j.getUTCDate())}`;
      t0 = `${p2(j.getUTCHours())}:${p2(j.getUTCMinutes())}`;
    }
    const back = document.createElement("div");
    back.className = "ap-rs-back";
    back.innerHTML = `
      <div class="ap-rs-modal">
        <div class="ap-rs-h">日程を変更</div>
        <div class="ap-rs-name">${esc(resched.dataset.label || "")}</div>
        <div class="ap-rs-now">いまの日時：${esc(d0 && t0 ? `${d0} ${t0}` : "未設定")}</div>
        <div class="ap-rs-row">
          <label>日付 <input type="date" id="apRsDate" value="${esc(d0)}"></label>
          <label>時間 <input type="time" id="apRsTime" step="900" value="${esc(t0)}"></label>
        </div>
        <div class="ap-rs-quick">
          <button type="button" class="btn ghost" data-q="10:00">10:00</button>
          <button type="button" class="btn ghost" data-q="11:00">11:00</button>
          <button type="button" class="btn ghost" data-q="13:00">13:00</button>
          <button type="button" class="btn ghost" data-q="14:00">14:00</button>
          <button type="button" class="btn ghost" data-q="15:00">15:00</button>
          <button type="button" class="btn ghost" data-q="16:00">16:00</button>
          <button type="button" class="btn ghost" data-q="17:00">17:00</button>
        </div>
        <p class="ap-rs-note">日程変更のお知らせだけ送ります。リマインドは変更後の日時で送ります。</p>
        <div class="ap-rs-foot">
          <button type="button" class="btn" id="apRsOk">変更する</button>
          <button type="button" class="btn ghost" id="apRsCancel">やめる</button>
          <span class="ap-rs-st" id="apRsSt"></span>
        </div>
      </div>`;
    document.body.appendChild(back);
    const close = () => back.remove();
    back.addEventListener("click", (ev) => { if (ev.target === back) close(); });
    back.querySelector("#apRsCancel").addEventListener("click", close);
    back.querySelectorAll(".ap-rs-quick .btn").forEach((b) =>
      b.addEventListener("click", () => { back.querySelector("#apRsTime").value = b.dataset.q; }));
    back.querySelector("#apRsOk").addEventListener("click", async () => {
      const dv = back.querySelector("#apRsDate").value;
      const tv = back.querySelector("#apRsTime").value;
      const st = back.querySelector("#apRsSt");
      if (!dv || !tv) { st.textContent = "日付と時間を入れてください"; return; }
      const [y, mo, da] = dv.split("-").map(Number);
      const [hh, mi] = tv.split(":").map(Number);
      const iso = new Date(Date.UTC(y, mo - 1, da, hh - 9, mi)).toISOString();
      st.textContent = "変更しています…";
      try {
        const r = await fetch(`/api/apo/${encodeURIComponent(resched.dataset.slug)}/reschedule`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ start: iso }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "できませんでした");
        st.textContent = "変更しました";
        setTimeout(() => location.reload(), 700);
      } catch (e) { st.textContent = "失敗：" + e.message; }
    });
  });

  const copy = q(".ap-copy");
  if (copy) copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(copy.dataset.url); copy.textContent = "コピーしました"; }
    catch { copy.textContent = "失敗"; }
    setTimeout(() => (copy.textContent = "リンクをコピー"), 1500);
  });

  // 「⋯」その他の操作メニューの開閉
  const moreBtn = q(".ap-more-btn");
  const moreWrap = q(".ap-c2-more");
  if (moreBtn && moreWrap) {
    moreBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const open = moreWrap.classList.contains("open");
      document.querySelectorAll(".ap-c2-more.open").forEach((el) => el.classList.remove("open"));
      if (!open) moreWrap.classList.add("open");
    });
    // メニュー内クリックで即閉じない（コピー等の結果表示のため）が、項目を押したら閉じる
    moreWrap.querySelectorAll(".ap-more-item").forEach((it) =>
      it.addEventListener("click", () => setTimeout(() => moreWrap.classList.remove("open"), 60)));
  }

  // SF商談を立ち上げる（このカードから）
  const sflaunch = q(".ap-sflaunch");
  if (sflaunch) sflaunch.addEventListener("click", async () => {
    const i = +sflaunch.dataset.i;
    const a = apState.appts[i];
    if (!confirm("Salesforceの商談を立ち上げます。よろしいですか？")) return;
    sflaunch.disabled = true;
    const bo = sflaunch.innerHTML;
    sflaunch.textContent = "立ち上げ中…";
    try {
      const r = await fetch("/api/sf-autolaunch/run", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: a.slug }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "立ち上げに失敗しました");
      if (d.ok) {
        a.sf = Object.assign({}, a.sf, { launched: true, linked: true });
        if (window.kbToast) kbToast("SF商談を立ち上げました");
        refreshMailCell(i);
        refreshSfOne(a.slug, i); // 正確なステージ等を取り直す
      } else {
        sflaunch.disabled = false; sflaunch.innerHTML = bo;
        openLaunchModal(i, d.reasonText || d.reason || "条件を満たしていません");
      }
    } catch (e) {
      sflaunch.disabled = false; sflaunch.innerHTML = bo;
      openLaunchModal(i, e.message);
    }
  });

  // ⋯メニュー「細かく入力して立ち上げる」
  const launchDetail = q(".ap-launch-detail");
  if (launchDetail) launchDetail.addEventListener("click", () => openLaunchModal(+launchDetail.dataset.i, ""));

  // SF紐付けの変更（チップ／メニューから）
  const sflink = q(".ap-sflink");
  if (sflink) sflink.addEventListener("click", () => openSfLinkModal(+sflink.dataset.i));
  const sflinkMenu = q(".ap-sflink-menu");
  if (sflinkMenu) sflinkMenu.addEventListener("click", () => openSfLinkModal(+sflinkMenu.dataset.i));

  bindMailButtons(card);
}
// 1件だけSF状態（ステージ・紐付け・立ち上げ）を取り直してカードに反映する。
async function refreshSfOne(slug, i) {
  try {
    const r = await fetch("/api/apo/sf-status", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ slugs: [slug] }),
    });
    const d = await r.json();
    if (r.ok && d && d.bySlug && d.bySlug[slug]) {
      const a = apState.appts[i];
      if (a && a.slug === slug) { a.sf = d.bySlug[slug]; refreshMailCell(i); }
    }
  } catch { /* 取り直せなくても、立ち上げ自体は済んでいる */ }
}

// SF立ち上げの「細かい入力」モーダル。失敗時や、手で内容を指定して立ち上げたいときに使う。
function openLaunchModal(i, reasonText) {
  const a = apState.appts[i];
  if (!a) return;
  if (document.querySelector(".ap-lc-back")) return; // 二重表示を防ぐ
  const ymdLocal = (iso) => { const d = new Date(iso); if (isNaN(d.getTime())) return ""; const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
  const back = document.createElement("div");
  back.className = "ap-lc-back";
  back.innerHTML =
    `<div class="ap-lc">
      <div class="ap-lc-h"><span>SF商談を立ち上げる</span><button type="button" class="ap-lc-x" aria-label="閉じる">×</button></div>
      ${reasonText ? `<div class="ap-lc-reason">立ち上げできませんでした：<br>${esc(reasonText)}</div>` : ""}
      <div class="ap-lc-note">予定名から会社名・担当者を、gBizINFO→ネット検索で会社情報を自動で補います。内容を確認・修正してから立ち上げてください。組織に無い項目は自動で省きます。</div>
      <button type="button" class="btn ap-lc-fill">会社情報を自動で補完</button>
      <label class="ap-lc-f"><span>会社名</span><input id="lcCompany" type="text" placeholder="空なら予定名から自動" /></label>
      <label class="ap-lc-f"><span>担当者（姓）</span><input id="lcPerson" type="text" placeholder="空なら予定名から自動" /></label>
      <label class="ap-lc-f"><span>メール</span><input id="lcEmail" type="email" value="${esc(a.client_email || "")}" /></label>
      <label class="ap-lc-f"><span>商談日</span><input id="lcMeeting" type="date" value="${esc(ymdLocal(a.start))}" /></label>
      <label class="ap-lc-f"><span>電話</span><input id="lcPhone" type="text" /></label>
      <label class="ap-lc-f"><span>Webサイト</span><input id="lcWeb" type="text" placeholder="https://..." /></label>
      <label class="ap-lc-f"><span>都道府県</span><input id="lcState" type="text" placeholder="例：東京都" /></label>
      <label class="ap-lc-f"><span>住所</span><input id="lcStreet" type="text" /></label>
      <label class="ap-lc-f"><span>従業員数</span><input id="lcEmp" type="text" inputmode="numeric" /></label>
      <div class="ap-lc-msg" id="lcMsg"></div>
      <div class="ap-lc-actions"><button type="button" class="btn ghost ap-lc-cancel">閉じる</button><button type="button" class="btn ap-lc-go">この内容で立ち上げる</button></div>
    </div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.addEventListener("click", (ev) => { if (ev.target === back) close(); });
  back.querySelector(".ap-lc-x").addEventListener("click", close);
  back.querySelector(".ap-lc-cancel").addEventListener("click", close);
  const go = back.querySelector(".ap-lc-go");
  // 予定名から会社名・担当者を、SF取引先→gBiz→ネット→サイト読込 の順で補う。空欄だけ埋める（入力済みは尊重）。
  const setIfEmpty = (id, v) => { const el = back.querySelector("#" + id); if (el && !(el.value || "").trim() && v) { el.value = v; return true; } return false; };
  const autofill = async (silent) => {
    const btn = back.querySelector(".ap-lc-fill");
    const msg = back.querySelector("#lcMsg");
    const val = (id) => (back.querySelector("#" + id).value || "").trim();
    const allFilled = () => ["lcPhone", "lcWeb", "lcState", "lcStreet", "lcEmp"].every((id) => val(id));
    btn.disabled = true; const bo0 = btn.textContent;
    const stages = [["sf", "SFの取引先を確認中…"], ["gbiz", "gBizINFO・メールで検索中…"], ["web", "ネットで検索中…"], ["deep", "公式サイトを読み込み中…"]];
    let filledAny = false;
    for (const [stage, label] of stages) {
      if (allFilled()) break;
      btn.textContent = label;
      if (!silent) { msg.className = "ap-lc-msg"; msg.textContent = "検索中… " + label; }
      const params = new URLSearchParams({ stage });
      for (const [id, key] of [["lcCompany", "company"], ["lcEmail", "email"], ["lcStreet", "street"], ["lcState", "state"], ["lcWeb", "website"]]) {
        if (val(id)) params.set(key, val(id));
      }
      try {
        const r = await fetch(`/api/apo/${encodeURIComponent(a.slug)}/company-info?` + params.toString());
        const d = await r.json();
        if (r.ok) {
          setIfEmpty("lcCompany", d.company || "");
          setIfEmpty("lcPerson", d.person || "");
          const info = d.info || {};
          for (const [id, key] of [["lcPhone", "phone"], ["lcWeb", "website"], ["lcState", "state"], ["lcStreet", "street"], ["lcEmp", "employees"]]) {
            if (setIfEmpty(id, info[key] || "")) filledAny = true;
          }
        }
      } catch { /* この段は飛ばして次へ */ }
    }
    btn.disabled = false; btn.textContent = bo0;
    if (!silent) {
      msg.className = "ap-lc-msg";
      msg.textContent = allFilled() ? "自動で補完しました。内容を確認してください。"
        : (filledAny ? "空欄を埋めました。残りは手で入力してください。" : "見つかりませんでした。手で入力してください。");
    }
  };
  back.querySelector(".ap-lc-fill").addEventListener("click", () => autofill(false));
  // 開いたときに、予定名・メールを手がかりに自動で1回補完する
  autofill(true);


  go.addEventListener("click", async () => {
    const val = (id) => (back.querySelector("#" + id).value || "").trim();
    const lead = {};
    for (const [id, key] of [["lcCompany", "company"], ["lcPerson", "person"], ["lcEmail", "email"],
      ["lcMeeting", "meetingDate"], ["lcPhone", "phone"], ["lcWeb", "website"], ["lcState", "state"], ["lcStreet", "street"], ["lcEmp", "employees"]]) {
      if (val(id)) lead[key] = val(id);
    }
    const msg = back.querySelector("#lcMsg");
    go.disabled = true; const bo = go.textContent; go.textContent = "立ち上げ中…"; msg.className = "ap-lc-msg"; msg.textContent = "";
    try {
      const r = await fetch("/api/sf-autolaunch/run", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: a.slug, lead }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "立ち上げに失敗しました");
      if (d.ok) {
        a.sf = Object.assign({}, a.sf, { launched: true, linked: true });
        if (window.kbToast) kbToast("SF商談を立ち上げました");
        refreshMailCell(i); refreshSfOne(a.slug, i);
        close();
      } else {
        msg.className = "ap-lc-msg ng";
        msg.textContent = "立ち上げできませんでした：" + (d.reasonText || d.reason || "条件を満たしていません");
        go.disabled = false; go.textContent = bo;
      }
    } catch (e) {
      msg.className = "ap-lc-msg ng";
      msg.textContent = "失敗：" + e.message;
      go.disabled = false; go.textContent = bo;
    }
  });
}

// SF商談の紐付けを変更するモーダル（候補から選ぶ／外す）
function openSfLinkModal(i) {
  const a = apState.appts[i];
  if (!a) return;
  if (document.querySelector(".ap-lc-back")) return;
  const curOpp = (a.sf && a.sf.oppId) || "";
  const back = document.createElement("div");
  back.className = "ap-lc-back";
  back.innerHTML =
    `<div class="ap-lc ap-lk">
      <div class="ap-lc-h"><span>SF商談の紐付け</span><button type="button" class="ap-lc-x" aria-label="閉じる">×</button></div>
      <div class="ap-lc-note">この商談に紐付けるSF商談（クロス）を選びます。会社名で候補を探せます。無ければ「SF商談を立ち上げる」で新規に立ち上げられます。</div>
      <div class="ap-lk-search"><input id="lkCompany" type="text" placeholder="会社名で探す" /><button type="button" class="btn ghost ap-lk-find">候補を探す</button></div>
      <div class="ap-lk-list" id="lkList"><div class="ap-lk-empty">読み込み中…</div></div>
      <div class="ap-lc-msg" id="lkMsg"></div>
      <div class="ap-lc-actions">
        ${curOpp ? `<button type="button" class="btn ghost ap-lk-unlink">紐付けを外す</button>` : ""}
        <button type="button" class="btn ghost ap-lk-cancel">閉じる</button>
        <button type="button" class="btn ap-lk-launch">SF商談を立ち上げる</button>
      </div>
    </div>`;
  document.body.appendChild(back);
  const close = () => back.remove();
  back.addEventListener("click", (ev) => { if (ev.target === back) close(); });
  back.querySelector(".ap-lc-x").addEventListener("click", close);
  back.querySelector(".ap-lk-cancel").addEventListener("click", close);
  const listEl = back.querySelector("#lkList");
  const msg = back.querySelector("#lkMsg");
  const setMsg = (t, ng) => { msg.className = "ap-lc-msg" + (ng ? " ng" : ""); msg.textContent = t || ""; };

  const doLink = async (oppId) => {
    setMsg("");
    try {
      const r = await fetch(`/api/apo/${encodeURIComponent(a.slug)}/sf-link`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ oppId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "紐付けに失敗しました");
      a.sf = Object.assign({}, a.sf || {}, { linked: !!d.linked, oppId: d.oppId || "", stage: d.stage || (a.sf && a.sf.stage) || "" });
      if (window.kbToast) kbToast(d.linked ? "SF商談に紐付けました" : "紐付けを外しました");
      refreshMailCell(i); refreshSfOne(a.slug, i);
      close();
    } catch (e) { setMsg("失敗：" + e.message, true); }
  };

  const render = (items) => {
    if (!items || !items.length) { listEl.innerHTML = `<div class="ap-lk-empty">候補が見つかりませんでした。会社名を変えて探すか、右下の「SF商談を立ち上げる」で新規に立ち上げてください。</div>`; return; }
    listEl.innerHTML = items.map((o) => {
      const cur = curOpp && o.id === curOpp;
      const meta = [o.account, o.stage, o.closed ? "終了" : ""].filter(Boolean).join(" ・ ");
      return `<div class="ap-lk-item${cur ? " cur" : ""}">
        <div class="ap-lk-item-t">${esc(o.name || "(名称なし)")}</div>
        <div class="ap-lk-item-m">${esc(meta)}</div>
        <button type="button" class="btn ap-lk-pick" data-id="${esc(o.id)}">${cur ? "紐付け中" : "紐付ける"}</button>
      </div>`;
    }).join("");
    listEl.querySelectorAll(".ap-lk-pick").forEach((b) => b.addEventListener("click", () => doLink(b.dataset.id)));
  };

  const load = async () => {
    listEl.innerHTML = `<div class="ap-lk-empty">読み込み中…</div>`;
    const coIn = back.querySelector("#lkCompany");
    const params = new URLSearchParams();
    if ((coIn.value || "").trim()) params.set("company", coIn.value.trim());
    try {
      const r = await fetch(`/api/apo/${encodeURIComponent(a.slug)}/sf-candidates?` + params.toString());
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "候補を取得できませんでした");
      if (d.company && !(coIn.value || "").trim()) coIn.value = d.company;
      render(d.items || []);
    } catch (e) { listEl.innerHTML = `<div class="ap-lk-empty ng">${esc(e.message)}<br>「SF商談を立ち上げる」で新規に立ち上げるか、Salesforceの再連携をご確認ください。</div>`; }
  };
  back.querySelector(".ap-lk-find").addEventListener("click", load);
  back.querySelector(".ap-lk-launch").addEventListener("click", () => { close(); openLaunchModal(i, ""); });
  const unlinkBtn = back.querySelector(".ap-lk-unlink");
  if (unlinkBtn) unlinkBtn.addEventListener("click", () => { if (confirm("この商談の紐付けを外します。よろしいですか？")) doLink(""); });
  load();
}
// メニューの外側クリックで閉じる（1回だけ登録）
if (!window.__apMoreOutside) {
  window.__apMoreOutside = true;
  document.addEventListener("click", (ev) => {
    if (ev.target.closest && ev.target.closest(".ap-c2-more")) return;
    document.querySelectorAll(".ap-c2-more.open").forEach((el) => el.classList.remove("open"));
  });
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
async function loadApo() {
  const body = $("apoBody");
  const st = $("apStatus");
  const created = ($("apCreated") && $("apCreated").value) || "";
  const start = ($("apStart") && $("apStart").value) || "";
  apState.fCreated = created;
  apState.fStart = start;
  body.innerHTML = '<div class="empty-state">カレンダーから取り込み中…（件数によっては数十秒かかります）</div>';
  try {
    const reps = await (await fetch("/api/smart-links/reps")).json();
    apState.reps = Array.isArray(reps) ? reps : [];
  } catch { apState.reps = []; }
  try {
    const s = await (await fetch("/api/smart-links/setters")).json();
    apState.setters = (s && s.setters) || [];
  } catch { apState.setters = []; }
  loadRotation();
  try {
    const q = new URLSearchParams();
    if (created) q.set("created", created);
    if (start) q.set("start", start);
    if (curBiz()) q.set("product", curBiz());
    const r = await fetch("/api/apo/pickup?" + q.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "取り込みに失敗しました");
    apState.appts = d.appointments || [];
    apState.errors = d.errors || [];
    apState.mailConfig = d.mail_config || {};
    renderApo();
    if (st) st.textContent = `${apState.appts.length}件`;
    setTimeout(() => { if (st) st.textContent = ""; }, 2500);
    loadSfStatus();
  } catch (e) {
    body.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
  }
}
// Salesforceから各アポの「商談ステージ・紐付け・立ち上げ」をまとめて取り、カードに反映する。
// 未接続・失敗時はチップを「未接続」表示のままにする（一覧自体は止めない）。
async function loadSfStatus() {
  const slugs = (apState.appts || []).map((a) => a.slug).filter(Boolean);
  if (!slugs.length) return;
  try {
    const r = await fetch("/api/apo/sf-status", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ slugs }),
    });
    const d = await r.json();
    const bySlug = (r.ok && d && d.bySlug) ? d.bySlug : null;
    for (const a of apState.appts) a.sf = bySlug ? (bySlug[a.slug] || null) : null;
    renderApo();
  } catch {
    for (const a of apState.appts) a.sf = null;
    renderApo();
  }
}
// ===== 今動いているビルドの表示 =====
// 「アップロードしたのに機能が出てこない」ときに、まずここを見れば反映されたか分かる。
// ===== タブ切り替え =====
// 選んだタブは記憶して、リロードしても同じタブに戻る。
function setupTabs() {
  const tabs = Array.from(document.querySelectorAll(".ap-tab"));
  const panes = Array.from(document.querySelectorAll(".ap-pane"));
  if (!tabs.length) return;
  const show = (name) => {
    tabs.forEach((t) => t.classList.toggle("active", t.dataset.pane === name));
    panes.forEach((p) => { p.hidden = p.dataset.pane !== name; });
    try { localStorage.setItem("apoTab", name); } catch {}
    // 設定タブを開いたときに最新値を読み直す
    if (name === "rot") loadRotation();
    if (name === "team") { loadTeamStats(); loadCountAdjust(); }
    if (name === "perf") loadPerf();
    if (name === "sys") loadBuild();
  };
  tabs.forEach((t) => t.addEventListener("click", () => show(t.dataset.pane)));
  // メニューから ?tab=... で直接そのタブを開けるようにする。
  // 指定が無ければ、前に開いていたタブに戻る。
  let init = new URLSearchParams(location.search).get("tab") || "";
  if (!init) { try { init = localStorage.getItem("apoTab") || "list"; } catch { init = "list"; } }
  if (!tabs.some((t) => t.dataset.pane === init)) init = "list";
  show(init);
}

async function loadBuild() {
  const el = $("dbBuild");
  if (!el) return;
  try {
    const d = await (await fetch("/api/version")).json();
    if (!d.build) throw new Error("バージョン情報を取得できません");
    el.innerHTML = `<b>動いているビルド：</b>${esc(d.build)}<br><span class="note">起動: ${esc(new Date(d.startedAt).toLocaleString("ja-JP"))}</span>`;
    el.classList.remove("ap-build-old");
  } catch {
    el.textContent = "動いているのは古いビルドです（/api/version がまだありません）。アップロードとデプロイを確認してください。";
    el.classList.add("ap-build-old");
  }
}

// ===== アポ実績タブ（メンバー別ファネル） =====
let _pfWired = false;
async function loadPerf() {
  const body = $("pfBody");
  if (!body) return;
  if (!_pfWired) {
    _pfWired = true;
    const rl = $("pfReload"); if (rl) rl.addEventListener("click", loadPerf);
    const w = $("pfWindow"); if (w) w.addEventListener("change", loadPerf);
  }
  const win = ($("pfWindow") && $("pfWindow").value) || "month";
  const st = $("pfStatus"); if (st) st.textContent = "読み込み中…";
  body.innerHTML = '<div class="empty-state">Salesforceから集計中…（件数によっては時間がかかります）</div>';
  try {
    const r = await fetch("/api/apo/perf?window=" + encodeURIComponent(win));
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "取得に失敗しました");
    renderPerf(d);
    if (st) st.textContent = `${d.members.length}名 / アポ${d.count}件` + (d.sfConnected ? "" : "（SF未接続のため記録の値で表示）");
  } catch (e) {
    body.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
    if (st) st.textContent = "";
  }
}
function renderPerf(d) {
  const body = $("pfBody");
  const funnel = d.funnel || [];
  if (!d.members || !d.members.length) { body.innerHTML = '<div class="empty-state">この期間のクロス商談がありませんでした。</div>'; return; }
  // ステージ名を短くする（"01：アポ獲得" → "アポ獲得"）
  const shortStage = (s) => String(s).replace(/^\s*\d+\s*[:：.、)]\s*/, "");
  // 表示するステージ（この語を含むステージだけ出す。順番はSFのステージ順に合わせる）
  const PF_KEEP = ["アポ獲得", "有効商談", "担当者合意", "企画決定者合意", "申込書回収"];
  let cols = [...new Set(PF_KEEP.map((kw) => funnel.findIndex((s) => String(s).includes(kw))).filter((i) => i >= 0))].sort((a, b) => a - b);
  if (!cols.length) cols = funnel.map((_, i) => i); // 一致しなければ全ステージ
  // 表示列を作る。アポ獲得の直後に「実施（kinbotに商談記録あり）」を挿入する。
  const columns = [];
  cols.forEach((ci, j) => {
    columns.push({ kind: "sf", idx: ci, label: shortStage(funnel[ci]) });
    if (j === 0) columns.push({ kind: "conducted", label: "実施" });
  });
  const cellN = (m, c) => (c.kind === "conducted" ? (m.conducted || 0) : (m.reached[c.idx] || 0));

  let html = '<div class="pf-wrap"><table class="pf-table"><thead><tr><th class="pf-mem">アポ獲得者</th>';
  for (const c of columns) html += `<th>${esc(c.label)}</th>`;
  html += '<th class="pf-lost">失注</th></tr></thead><tbody>';
  d.members.forEach((m, mi) => {
    html += `<tr class="pf-row"><td class="pf-mem">${esc(m.setter)}</td>`;
    columns.forEach((c, j) => {
      const n = cellN(m, c);
      const prev = j === 0 ? null : cellN(m, columns[j - 1]);
      const rate = j === 0 ? null : (prev ? Math.round((n / prev) * 100) : null);
      const dk = c.kind === "conducted" ? "conducted" : c.idx;
      html += `<td class="pf-cell${n ? " pf-has" : ""}" data-mi="${mi}" data-k="${dk}">` +
        `<span class="pf-n">${n}</span>` +
        (rate == null ? "" : `<span class="pf-rate">${rate}%</span>`) + `</td>`;
    });
    html += `<td class="pf-cell pf-lost" data-mi="${mi}" data-k="lost"><span class="pf-n">${m.lost || 0}</span></td>`;
    html += `</tr>`;
  });
  html += '</tbody></table></div><div class="pf-detail" id="pfDetail"></div>';
  body.innerHTML = html;

  const detail = $("pfDetail");
  body.querySelectorAll(".pf-cell").forEach((cell) => {
    cell.addEventListener("click", () => {
      const mi = +cell.dataset.mi;
      const m = d.members[mi];
      const k = cell.dataset.k;
      let list, label;
      if (k === "lost") { list = m.lostCompanies || []; label = `${m.setter}：失注`; }
      else if (k === "conducted") { list = m.conductedCompanies || []; label = `${m.setter}：実施（${m.conducted || 0}）`; }
      else { const kk = +k; list = m.companies[kk] || []; label = `${m.setter}：${shortStage(funnel[kk])}（到達 ${m.reached[kk] || 0}）`; }
      const active = cell.classList.contains("pf-open");
      body.querySelectorAll(".pf-cell.pf-open").forEach((c) => c.classList.remove("pf-open"));
      if (active || !list.length) { detail.innerHTML = list.length ? "" : `<div class="pf-detail-box"><b>${esc(label)}</b><div class="note">企業がありません。</div></div>`; if (active) return; }
      cell.classList.add("pf-open");
      detail.innerHTML = `<div class="pf-detail-box"><b>${esc(label)}</b><div class="pf-companies">` +
        list.map((c) => `<span class="pf-co">${esc(c)}</span>`).join("") + `</div></div>`;
      detail.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });
}

// ===== チーム実績タブ =====
// アポ通知カウントの手修正パネル
async function loadCountAdjust() {
  const biz = $("caBiz");
  if (!biz) return;
  const say = (m) => { const e = $("caStatus"); if (e) e.textContent = m || ""; };
  try {
    const d = await (await fetch("/api/apo/count-adjust?business=" + encodeURIComponent(biz.value || ""))).json();
    if (d.error) throw new Error(d.error);
    const e = d.effective || {};
    // いまの数字を初期値として入れておく（そのまま保存すれば現状維持）
    if ($("caToday")) $("caToday").value = e.today ?? "";
    if ($("caWeek")) $("caWeek").value = e.week ?? "";
    if ($("caMonth")) $("caMonth").value = e.month ?? "";
    say("");
  } catch (err) { say("読み込めませんでした：" + err.message); }
}

(function wireCountAdjust() {
  const save = document.getElementById("caSave");
  const biz = document.getElementById("caBiz");
  if (biz) biz.addEventListener("change", loadCountAdjust);
  if (save) save.addEventListener("click", async () => {
    const say = (m) => { const e = $("caStatus"); if (e) e.textContent = m || ""; };
    say("保存しています…");
    try {
      const body = {
        business: (biz && biz.value) || "",
        today: $("caToday") ? $("caToday").value : "",
        week: $("caWeek") ? $("caWeek").value : "",
        month: $("caMonth") ? $("caMonth").value : "",
      };
      const r = await fetch("/api/apo/count-adjust", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "保存できませんでした");
      const e = d.effective || {};
      say(`保存しました（本日 ${e.today} / 今週 ${e.week} / 今月 ${e.month}）`);
    } catch (err) { say("失敗：" + err.message); }
  });
})();

async function loadTeamStats() {
  const box = $("tsBody");
  if (!box) return;
  const say = (m) => { const e = $("tsStatus"); if (e) e.textContent = m; };
  const w = $("tsWindow") ? $("tsWindow").value : "month";
  say("読み込み中…");
  try {
    const d = await (await fetch("/api/apo/team-stats?window=" + encodeURIComponent(w) + bizQuery())).json();
    if (d.error) throw new Error(d.error);
    const stats = (d.teamStats || []).slice();
    if (!stats.length) {
      box.innerHTML = `<div class="empty-state">クローザーがまだ登録されていません。「割り振り設定」タブで登録してください。</div>`;
      say(""); return;
    }
    const modeLabel = { off: "チームを見ない", total: "チーム合計で均等",
      perHead: "1人あたりで均等", perDay: "稼働1日あたりで均等" }[d.mode] || d.mode;
    const max = Math.max(1, ...stats.map((t) => t.count));
    const usePerDay = d.mode === "perDay";
    const maxPer = usePerDay
      ? Math.max(0.001, ...stats.map((t) => t.perDay || 0))
      : Math.max(0.01, ...stats.map((t) => t.perHead || 0));
    const usePer = d.mode === "perHead" || usePerDay;

    let html = `<p class="note">期間：<b>${esc(d.period.label)}</b>／配り方：<b>${esc(modeLabel)}</b>` +
      `（商談日を基準に集計しています）</p>`;
    html += `<div class="ts-teams">`;
    for (const t of stats) {
      const val = usePerDay ? (t.perDay || 0) : usePer ? (t.perHead || 0) : t.count;
      const pct = Math.round((val / (usePer ? maxPer : max)) * 100);
      html += `<div class="ts-team${t.active === false ? " ap-rot-off" : ""}">
        <div class="ts-head">
          <span class="ts-name">${esc(t.team)}</span>
          ${t.priority ? '<span class="ap-badge ap-warn">次を優先</span>' : ""}
          ${t.active === false ? '<span class="ap-badge ap-pending">配布対象外</span>' : ""}
          <span class="ts-num">${t.count}件<span class="ts-sub">／通常${t.activeMembers}名${t.fallbackMembers ? "・予備" + t.fallbackMembers + "名" : ""}` +
          `・1人あたり${t.perHead ?? 0}件${t.personDays ? "・稼働" + t.personDays + "人日で1日" + (t.perDay ?? 0) + "件" : ""}` +
          `${t.baseline ? "・過去" + t.baseline + "件含む" : ""}</span></span>
        </div>
        <div class="ts-bar"><span style="width:${pct}%"></span></div>
        <div class="ts-members">`;
      for (const m of (d.members || {})[t.team] || []) {
        html += `<span class="ts-member${m.active === false ? " ts-off" : ""}">${esc(m.name)} <b>${m.count}</b></span>`;
      }
      html += `</div></div>`;
    }
    html += `</div>`;

    // 偏りの目安を出す
    const values = stats.filter((t) => t.active !== false).map((t) => (usePer ? (t.perHead || 0) : t.count));
    if (values.length > 1) {
      const gap = (Math.max(...values) - Math.min(...values)).toFixed(usePerDay ? 3 : usePer ? 2 : 0);
      const thr = usePerDay ? 0.15 : usePer ? 1.5 : 3;
      html += `<p class="note ${(+gap > thr) ? "cc-warn" : ""}">` +
        `最も多いチームと少ないチームの差：<b>${gap}${usePerDay ? "件/稼働日" : usePer ? "件/人" : "件"}</b>` +
        `${(+gap > thr) ? "　偏りが出ています。配り方の設定を見直すか、チームの稼働状態を確認してください。" : "　均等に配れています。"}</p>`;
    }
    box.innerHTML = html;
    bizLabel("tsBizLabel");
    say("");
  } catch (e) {
    box.innerHTML = `<div class="empty-state">読み込めませんでした：${esc(e.message)}</div>`;
    say("");
  }
}

// ===== 作ってしまった商談予定の取り消し =====
function fmtWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return esc(iso);
  const wd = ["日","月","火","水","木","金","土"][d.getDay()];
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()}(${wd}) ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function loadInvites() {
  const box = $("ivBox");
  const say = (m) => { const e = $("ivStatus"); if (e) e.textContent = m; };
  if (!box) return;
  say("読み込み中…");
  box.innerHTML = "";
  try {
    const h = $("ivHours") ? $("ivHours").value : "24";
    const d = await (await fetch("/api/apo/invites?hours=" + encodeURIComponent(h))).json();
    if (d.error) throw new Error(d.error);
    const list = d.invites || [];
    if (!list.length) { box.innerHTML = `<p class="note">この期間に作られた商談予定はありません。</p>`; say(""); return; }
    box.innerHTML = `<div class="iv-list">` + list.map((x) => `
      <div class="iv-row" data-slug="${esc(x.slug)}">
        <div class="iv-main">
          <span class="iv-when">${fmtWhen(x.start)}</span>
          <span class="iv-title">${esc(x.label || "(予定名なし)")}</span>
        </div>
        <div class="iv-sub">
          担当 <b>${esc(x.ownerName)}</b>／予定は <b>${esc(x.eventOwnerName)}</b> のカレンダー
          ${x.business ? `／${esc(x.business)}` : ""}
          ／作成 ${fmtWhen(x.updatedAt)}
        </div>
        <button type="button" class="btn ghost iv-del">この予定を消す</button>
      </div>`).join("") + `</div>`;
    box.querySelectorAll(".iv-del").forEach((b) => b.addEventListener("click", async () => {
      const row = b.closest(".iv-row");
      const slug = row.dataset.slug;
      const t = row.querySelector(".iv-title").textContent;
      if (!confirm(`この商談予定をカレンダーから消します。\n\n${t}\n\n※ 担当の割り当ては残ります。よろしいですか？`)) return;
      b.disabled = true; b.textContent = "削除中…";
      try {
        const r = await fetch(`/api/apo/invites/${encodeURIComponent(slug)}`, { method: "DELETE" });
        const dd = await r.json();
        if (!r.ok) throw new Error(dd.error || "削除に失敗しました");
        row.classList.add("iv-done");
        row.querySelector(".iv-del").outerHTML = `<span class="ap-badge ap-ok">削除しました</span>`;
      } catch (e) {
        alert("削除できませんでした: " + e.message);
        b.disabled = false; b.textContent = "この予定を消す";
      }
    }));
    say(`${list.length}件`);
  } catch (e) {
    box.innerHTML = `<p class="note cc-warn">読み込めませんでした：${esc(e.message)}</p>`;
    say("");
  }
}

// APIの返事を受け取る。
// JSONでない（＝ログイン画面やExpressの404ページが返ってきた）ときは、
// 「Unexpected token '<'」ではなく、何が起きているかが分かる文にする。
async function apiJson(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let d = null;
  try { d = JSON.parse(text); } catch {}
  if (d === null) {
    if (r.status === 404) {
      throw new Error(
        "この機能がサーバー側にまだありません。デプロイが反映されていない可能性があります。" +
        "数分待ってから、シークレットウィンドウで開き直してください。" +
        "（設定の一番下「今動いているバージョン」でも確かめられます）");
    }
    if (r.status === 413) {
      throw new Error("一度に送る量が多すぎます。件数を分けて実行してください。");
    }
    if (r.status === 401) {
      throw new Error("ログインが切れている可能性があります。画面を開き直してログインし直してください。");
    }
    if (/<!DOCTYPE/i.test(text.slice(0, 40))) {
      throw new Error(`サーバーがエラーページを返しました（${r.status}）。少し待ってからもう一度お試しください。`);
    }
    throw new Error(`サーバーから予期しない返事が来ました（${r.status}）`);
  }
  if (!r.ok) throw new Error(d.error || `失敗しました（${r.status}）`);
  return d;
}

// 即時通知（Googleカレンダーのプッシュ通知）の状態
function pushRender(d) {
  const box = $("pushBox");
  if (!box) return;
  const rows = d.watches || [];
  let html = "";
  if (!d.publicUrl) {
    html += `<p class="note cc-warn">公開URLが未設定のため、即時通知は使えません（PUBLIC_URL）。</p>`;
  } else {
    html += `<p class="note">受け口：${esc(d.address)}<br>` +
      `いまの状態：${d.enabled ? "オン" : "オフ"}　` +
      `最後に通知が来たとき：${d.lastPushAt ? esc(fmtWhen(d.lastPushAt)) : "まだありません"}</p>`;
  }
  if (!rows.length) {
    html += `<p class="note cc-warn">見張っているカレンダーがありません。「今すぐ設定し直す」を押してください。</p>`;
  } else {
    html += `<div class="cal-list">` + rows.map((w) =>
      `<div class="cal-row cal-ok"><div class="cal-head"><b>${esc(w.calendar)}</b></div>` +
      `<div class="ap-rot-cnt">期限：${esc(fmtWhen(w.expires))}</div></div>`).join("") + `</div>`;
  }
  box.innerHTML = html;
}

async function pushCheck() {
  const say = (m) => { const e = $("pushStatus"); if (e) e.textContent = m; };
  say("確認中…");
  try { pushRender(await apiJson("/api/apo/push-status")); say(""); }
  catch (e) { say("失敗: " + e.message); }
}

async function pushSetup() {
  const say = (m) => { const e = $("pushStatus"); if (e) e.textContent = m; };
  const btn = $("pushSetup");
  if (btn) btn.disabled = true;
  say("設定しています…（人数分の登録に少し時間がかかります）");
  try {
    const d = await apiJson("/api/apo/push-setup", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, force: true }),
    });
    if (d.skipped) { say("設定できません：" + esc(d.reason || "")); }
    else {
      say(`${(d.made || []).length}件を登録しました` +
        ((d.failed || []).length ? `（${d.failed.length}件は失敗）` : ""));
      if ((d.failed || []).length) {
        const box = $("pushBox");
        if (box) box.innerHTML = `<p class="note cc-warn">登録できなかったもの：` +
          d.failed.map((f) => `${esc(f.email)}（${esc(f.error).slice(0, 80)}）`).join("、") + `</p>`;
      }
    }
    pushCheck();
  } catch (e) { say("失敗: " + e.message); }
  finally { if (btn) btn.disabled = false; }
}

// アポとして数えない招待者
async function loadSkipInviters() {
  if (!$("siWords")) return;
  try {
    const d = await apiJson("/api/skip-inviters");
    $("siWords").value = d.inviters || "";
  } catch {}
}
async function saveSkipInviters() {
  const st = $("siStatus");
  if (st) st.textContent = "保存しています…";
  try {
    await apiJson("/api/skip-inviters", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ inviters: $("siWords").value }),
    });
    if (st) { st.textContent = "保存しました"; setTimeout(() => (st.textContent = ""), 4000); }
  } catch (e) { if (st) st.textContent = "失敗: " + e.message; }
}

// テスト用アポの見分け方
async function loadTestWords() {
  if (!$("twWords")) return;
  try {
    const d = await apiJson("/api/test-apo-words");
    $("twWords").value = d.words || "";
  } catch {}
}
async function saveTestWords() {
  const st = $("twStatus");
  if (st) st.textContent = "保存しています…";
  try {
    await apiJson("/api/test-apo-words", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ words: $("twWords").value }),
    });
    if (st) { st.textContent = "保存しました"; setTimeout(() => (st.textContent = ""), 4000); }
  } catch (e) { if (st) st.textContent = "失敗: " + e.message; }
}

// 夕方のお知らせ（本人だけに送る）
async function loadEvening() {
  if (!$("evOn")) return;
  try {
    const d = await apiJson("/api/evening-reminder");
    $("evOn").checked = !!d.enabled;
    $("evHour").value = d.hour ?? 18;
    $("evMin").value = d.minute ?? 30;
    if (!d.appReady) {
      $("evBox").innerHTML = '<span class="cc-warn">1対1で送るには、Chatアプリ（kinbot名義）の設定が必要です。' +
        '設定→外部連携→Google Chat の「送信者名を『kinbot』にする」をご確認ください。</span>';
    }
  } catch (e) { $("evBox").textContent = "確認できませんでした：" + e.message; }
}

async function saveEvening() {
  setStatusAp("evStatus", "保存しています…");
  try {
    await apiJson("/api/evening-reminder", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: $("evOn").checked,
        hour: parseInt($("evHour").value, 10),
        minute: parseInt($("evMin").value, 10),
      }),
    });
    setStatusAp("evStatus", "保存しました", 4000);
  } catch (e) { setStatusAp("evStatus", "失敗: " + e.message, 6000); }
}

async function testEvening() {
  const box = $("evBox");
  setStatusAp("evStatus", "見ています…");
  try {
    const d = await apiJson("/api/evening-reminder/test", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    const people = d.people || [];
    if (!people.length) {
      box.innerHTML = "いま送るものはありません（やり残しなし）。";
    } else {
      box.innerHTML = `<b>${people.length}人</b>に送ることになります。<br>` +
        people.map((p) =>
          `・${esc(p.name || p.email)}：SF更新 ${p.sf} ／ 立ち上げ ${p.launch} ／ 確定メール ${p.mail}`).join("<br>");
    }
    setStatusAp("evStatus", "");
  } catch (e) { setStatusAp("evStatus", "失敗: " + e.message, 6000); }
}

// 状態表示のちいさな共通処理
function setStatusAp(id, t, ms) {
  const e = $(id);
  if (!e) return;
  e.textContent = t || "";
  if (ms) setTimeout(() => { if (e.textContent === t) e.textContent = ""; }, ms);
}

// コール進捗のお知らせ
async function loadCallReport() {
  if (!$("crOn")) return;
  try {
    const d = await apiJson("/api/call-report");
    $("crOn").checked = !!d.enabled;
    $("crFrom").value = d.from ?? 11;
    $("crTo").value = d.to ?? 18;
    if ($("crGoalMode")) $("crGoalMode").value = d.goalMode || "zero";
    $("crGoals").value = Object.entries(d.goals || {})
      .map(([k, v]) => `${k}, ${v.calls || 0}, ${v.apos || 0}`).join("\n");
    if (!d.reportReady) {
      $("crBox").innerHTML = `<span class="cc-warn">SFのレポートが未設定です。` +
        `SF連携→プロセスシートで先に設定してください。</span>`;
    }
  } catch (e) { $("crBox").textContent = "確認できませんでした：" + e.message; }
}

// 「名前, コール数, アポ数」の行を読み取る
function parseGoals(text) {
  const out = {};
  for (const line of String(text || "").split("\n")) {
    const p = line.split(/[,、\t]/).map((x) => x.trim());
    if (!p[0]) continue;
    out[p[0]] = { calls: parseInt(p[1], 10) || 0, apos: parseInt(p[2], 10) || 0 };
  }
  return out;
}

async function saveCallReport() {
  const st = $("crStatus");
  if (st) st.textContent = "保存しています…";
  try {
    await apiJson("/api/call-report", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: $("crOn").checked,
        from: parseInt($("crFrom").value, 10),
        to: parseInt($("crTo").value, 10),
        goals: parseGoals($("crGoals").value),
        goalMode: $("crGoalMode") ? $("crGoalMode").value : undefined,
      }),
    });
    if (st) { st.textContent = "保存しました"; setTimeout(() => (st.textContent = ""), 4000); }
  } catch (e) { if (st) st.textContent = "失敗: " + e.message; }
}

async function testCallReport(send) {
  const st = $("crStatus");
  const box = $("crBox");
  if (st) st.textContent = "作っています…";
  try {
    const d = await apiJson("/api/call-report/test", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ send: !!send }),
    });
    if (!d.ok) { if (box) box.innerHTML = `<span class="cc-warn">${esc(d.reason || "作れませんでした")}</span>`; }
    else if (box) box.innerHTML = esc(d.text).replace(/\n/g, "<br>");
    if (st) st.textContent = "";
  } catch (e) { if (st) st.textContent = "失敗: " + e.message; }
}

// 更新（デプロイ）の通知
async function loadDeploy() {
  const box = $("depBox");
  if (!box) return;
  try {
    const d = await apiJson("/api/deploy/info");
    if ($("depOn")) $("depOn").checked = d.enabled !== false;
    box.innerHTML =
      (d.message ? `いまの中身：<b>${esc(d.message)}</b>${d.commit ? `（${esc(d.commit)}）` : ""}<br>` : "") +
      (d.hookUrl
        ? `Railwayの Webhook にこのURLを入れると、失敗したときも知らせます：<br>` +
          `<code class="dep-url">${esc(d.hookUrl)}</code>`
        : `公開URL（PUBLIC_URL）が未設定のため、Webhookは使えません。`);
  } catch (e) { box.textContent = "確認できませんでした：" + e.message; }
}

// 今動いているバージョンを出す（デプロイが反映されたか確かめる用）
async function showVersion() {
  const el = $("verBox");
  if (!el) return;
  try {
    const d = await apiJson("/api/version");
    el.innerHTML = `<b>${esc(d.build || "-")}</b><br>` +
      `起動：${esc(d.startedAt ? new Date(d.startedAt).toLocaleString("ja-JP", { hour12: false }) : "-")}<br>` +
      (d.features || []).map((f) => `・${esc(f)}`).join("<br>");
  } catch (e) { el.textContent = "確認できませんでした：" + e.message; }
}

// カレンダーを直接見て、同じ商談の予定が2つ以上あるものを探して消す。
// 「探す」「消す」を同じ行に並べる（一覧が長いと、下まで送らないと押せないため）。
let siList = [];

function siSetActions(on) {
  ["siDel", "siAll", "siNone"].forEach((id) => { const b = $(id); if (b) b.hidden = !on; });
}

async function loadSelfInvites() {
  const box = $("siBox");
  const say = (m) => { const e = $("siStatus"); if (e) e.textContent = m; };
  const btn = $("siLoad");
  if (!box) return;
  if (btn) btn.disabled = true;
  siSetActions(false);
  siList = [];
  say("探しています…（人数分カレンダーを読むので少し時間がかかります）");
  box.innerHTML = "";
  try {
    const d = await apiJson("/api/apo/duplicate-events");
    const list = d.found || [];
    siList = list;
    let html = "";
    if ((d.checked || []).length) {
      html += `<p class="note">調べたカレンダー：` +
        d.checked.map((c) => `${esc(c.name || c.email)}（${c.events}件）`).join("、") + `</p>`;
    }
    if ((d.errors || []).length) {
      html += `<p class="note cc-warn">読めなかったカレンダー：` +
        d.errors.map((x) => `${esc(x.email)}（${esc(x.error).slice(0, 60)}）`).join("、") + `</p>`;
    }
    if (!list.length) {
      html += `<p class="note">重複した予定は見つかりませんでした。</p>`;
      box.innerHTML = html; say(""); return;
    }
    html += `<div class="iv-list">` + list.map((x, k) => `
      <label class="iv-row">
        <input type="checkbox" class="si-chk" data-i="${k}" checked />
        <div class="iv-main"><span class="iv-when">${fmtWhen(x.start)}</span>
          <span class="iv-title">${esc(x.title || "(予定名なし)")}</span></div>
        <div class="iv-sub">${esc(x.name || x.calendarEmail)} のカレンダー ／ kinbotが作った予定</div>
      </label>`).join("") + `</div>`;
    box.innerHTML = html;
    siSetActions(true);
    say(`${list.length}件見つかりました（上の「チェックしたものを消す」で消せます）`);
  } catch (e) {
    box.innerHTML = `<p class="note cc-warn">探せませんでした：${esc(e.message)}</p>`;
    say("");
  } finally { if (btn) btn.disabled = false; }
}

// 「消す」を押したとき
async function delSelfInvites() {
  const box = $("siBox");
  const say = (m) => { const e = $("siStatus"); if (e) e.textContent = m; };
  const items = [...box.querySelectorAll(".si-chk")].filter((c) => c.checked).map((c) => siList[+c.dataset.i]);
  if (!items.length) { say("チェックがありません"); return; }
  if (!confirm(`${items.length}件の予定をカレンダーから消して、1つに戻します。よろしいですか？\n（アポ獲得者が作った元の予定は残ります）`)) return;

  // 件数が多いと一度に送れないので、50件ずつに分けて送る
  const CHUNK = 50;
  let deleted = 0;
  const failed = [];
  const del = $("siDel");
  if (del) del.disabled = true;
  try {
    for (let i = 0; i < items.length; i += CHUNK) {
      const part = items.slice(i, i + CHUNK).map((x) => ({
        eventId: x.eventId, calendarEmail: x.calendarEmail, tokenOwner: x.tokenOwner,
      }));
      say(`削除中… ${Math.min(i + part.length, items.length)} / ${items.length}件`);
      const dd = await apiJson("/api/apo/duplicate-events/delete", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ items: part }),
      });
      deleted += dd.deleted || 0;
      for (const f of dd.failed || []) failed.push(f);
    }
    say(`${deleted}件を消しました${failed.length ? `（${failed.length}件は失敗）` : ""}`);
    if (failed.length) {
      box.innerHTML += `<p class="note cc-warn">消せなかったもの：` +
        failed.slice(0, 10).map((f) => `${esc(f.calendarEmail || "")}（${esc(f.error || "")}）`).join("、") +
        (failed.length > 10 ? ` ほか${failed.length - 10}件` : "") + `</p>`;
    }
    loadSelfInvites();
  } catch (e) {
    say(`失敗: ${e.message}${deleted ? `（${deleted}件までは消えました）` : ""}`);
  } finally { if (del) del.disabled = false; }
}

async function loadOrphans() {
  const box = $("orBox");
  const say = (m) => { const e = $("orStatus"); if (e) e.textContent = m; };
  const btn = $("orLoad");
  if (!box) return;
  if (btn) btn.disabled = true;
  say("探しています…（人数分カレンダーを読むので少し時間がかかります）");
  box.innerHTML = "";
  try {
    const d = await (await fetch("/api/apo/orphan-invites")).json();
    if (d.error) throw new Error(d.error);
    const list = d.found || [];
    let html = `<p class="note">調べたカレンダー：${(d.owners || []).map(esc).join("、")}</p>`;
    if ((d.errors || []).length) {
      html += `<p class="note cc-warn">読めなかったカレンダー：` +
        d.errors.map((x) => `${esc(x.owner)}（${esc(x.error).slice(0, 60)}）`).join("、") + `</p>`;
    }
    if (!list.length) {
      html += `<p class="note">取り残しの予定はありません。</p>`;
      box.innerHTML = html; say(""); return;
    }
    html += `<div class="iv-list">` + list.map((x, k) => `
      <label class="iv-row">
        <input type="checkbox" class="or-chk" data-i="${k}" checked />
        <div class="iv-main"><span class="iv-when">${fmtWhen(x.start)}</span>
          <span class="iv-title">${esc(x.title || "(予定名なし)")}</span></div>
        <div class="iv-sub">${esc(x.owner)} のカレンダー</div>
      </label>`).join("") + `</div>
      <div class="ap-cfg-actions">
        <button class="btn ghost" id="orDel">チェックしたものを消す</button>
      </div>`;
    box.innerHTML = html;
    box.querySelector("#orDel").addEventListener("click", async () => {
      const items = [...box.querySelectorAll(".or-chk")].filter((c) => c.checked).map((c) => list[+c.dataset.i]);
      if (!items.length) { say("チェックがありません"); return; }
      if (!confirm(`${items.length}件の予定をカレンダーから消します。よろしいですか？`)) return;
      say("削除中…");
      try {
        const r = await fetch("/api/apo/orphan-invites/delete", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ items }),
        });
        const dd = await r.json();
        if (!r.ok) throw new Error(dd.error || "削除に失敗しました");
        say(`${dd.deleted}件を削除しました${(dd.failed || []).length ? `（${dd.failed.length}件は失敗）` : ""}`);
        loadOrphans();
      } catch (e) { say("失敗: " + e.message); }
    });
    say(`${list.length}件見つかりました`);
  } catch (e) {
    box.innerHTML = `<p class="note cc-warn">探せませんでした：${esc(e.message)}</p>`;
    say("");
  } finally { if (btn) btn.disabled = false; }
}

// ===== Salesforceの自動立ち上げ =====
async function loadAutoLaunch() {
  const el = $("alOn");
  if (!el) return;
  try {
    const d = await (await fetch("/api/sf-autolaunch/config")).json();
    el.checked = !!d.enabled;
    if ($("alCampaign")) {
      $("alCampaign").value = d.campaignSource || "";
      $("alCampaign").placeholder = d.campaignSourceDefault || "3Dメタバース";
    }
    if ($("alFsNote")) {
      $("alFsNote").value = d.fsNote || "";
      $("alFsNote").placeholder = d.fsNoteDefault || "-";
    }
  } catch {}
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const el = document.getElementById("alOn");
    if (!el) return;
    loadAutoLaunch();
    el.addEventListener("change", async () => {
      const st = document.getElementById("alStatus");
      const on = el.checked;
      if (on && !confirm(
        "条件を満たしたアポについて、Salesforceの商談を自動で立ち上げます。\n\n" +
        "コンバートは取り消せません。判定が正しいことを通知で確かめてからONにしてください。\n\nよろしいですか？")) {
        el.checked = false;
        return;
      }
      if (st) st.textContent = "保存しています…";
      try {
        const r = await fetch("/api/sf-autolaunch/config", {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: on }),
        });
        if (!r.ok) throw new Error(((await r.json()) || {}).error || "保存できませんでした");
        if (st) { st.textContent = on ? "自動で立ち上げます" : "判定だけ行います"; setTimeout(() => (st.textContent = ""), 5000); }
      } catch (e) {
        if (st) st.textContent = "失敗: " + e.message;
        el.checked = !on;
      }
    });

    // 主キャンペーンソースの保存
    const cs = document.getElementById("alCampaignSave");
    if (cs) cs.addEventListener("click", async () => {
      const st = document.getElementById("alCampaignStatus");
      const v = (document.getElementById("alCampaign") || {}).value || "";
      const fs = (document.getElementById("alFsNote") || {}).value || "";
      if (st) st.textContent = "保存しています…";
      try {
        const r = await fetch("/api/sf-autolaunch/config", {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ campaignSource: v, fsNote: fs }),
        });
        if (!r.ok) throw new Error(((await r.json()) || {}).error || "保存できませんでした");
        if (st) {
          st.textContent = `保存しました（キャンペーン：${v || "入れない"} ／ FS：${fs || "入れない"}）`;
          setTimeout(() => (st.textContent = ""), 6000);
        }
      } catch (e) { if (st) st.textContent = "失敗: " + e.message; }
    });
  });
}

// ===== 重複したアポを片付ける =====
async function dedupeApos(confirm) {
  const box = $("dupResult");
  const say = (m) => { const e = $("dupStatus"); if (e) e.textContent = m; };
  say(confirm ? "消しています…" : "調べています…");
  box.innerHTML = "";
  try {
    const r = await fetch("/api/apo/dedupe", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "できませんでした");
    say("");
    if (!d.remove) {
      box.innerHTML = '<p class="note">重複はありませんでした。</p>';
      $("dupRun").hidden = true;
      return;
    }
    box.innerHTML =
      `<p class="note">${d.groups}件の予定で重複がありました。${confirm ? `<b>${d.remove}件を消しました。</b>` : `<b>${d.remove}件が消える対象です。</b>`}</p>` +
      (d.samples && d.samples.length
        ? `<ul class="ks-list">` + d.samples.map((x) =>
            `<li>${esc(x.label || "(予定名なし)")}　→ 1件残して ${x.removed}件を消す</li>`).join("") + `</ul>`
        : "");
    $("dupRun").hidden = !!confirm;
    if (confirm) setTimeout(() => location.reload(), 1500);
  } catch (e) {
    say("");
    box.innerHTML = `<p class="note cc-warn">${esc(e.message)}</p>`;
  }
}

// ===== 商談が立ち上がらない原因を調べる =====
async function diagnoseLaunch() {
  const box = $("alDiagBox");
  const btn = $("alDiag");
  const say = (m) => { const e = $("alDiagStatus"); if (e) e.textContent = m; };
  if (!box) return;
  btn.disabled = true;
  say("調べています…");
  box.innerHTML = "";
  try {
    const d = await (await fetch("/api/sf-autolaunch/diagnose")).json();
    if (d.error) throw new Error(d.error);
    box.innerHTML = `<div class="ks-test">` + (d.steps || []).map((x) =>
      `<div class="ks-step ${x.ok ? "ok" : "ng"}">
         <div class="ks-step-h">${x.ok ? "OK" : "要確認"}　${esc(x.name)}</div>
         ${x.detail ? `<div class="ks-step-d">${esc(x.detail)}</div>` : ""}
         ${x.hint ? `<div class="ks-step-hint">${esc(x.hint)}</div>` : ""}
       </div>`).join("") + `</div>`;
    say("");
  } catch (e) {
    box.innerHTML = `<p class="note cc-warn">調べられませんでした：${esc(e.message)}</p>`;
    say("");
  } finally { btn.disabled = false; }
}

// ===== 自動割り振りが動かない理由を調べる =====
async function whyNoAssign() {
  const box = $("rcWhyBox");
  const btn = $("rcWhy");
  const say = (m) => { const e = $("rcWhyStatus"); if (e) e.textContent = m; };
  if (!box) return;
  btn.disabled = true;
  say("調べています…");
  box.innerHTML = "";
  try {
    const d = await (await fetch("/api/apo/why?product=" + encodeURIComponent(curBiz()))).json();
    if (d.error) throw new Error(d.error);
    let html = `<div class="ks-test">` + (d.steps || []).map((x) =>
      `<div class="ks-step ${x.ok ? "ok" : "ng"}">
         <div class="ks-step-h">${x.ok ? "OK" : "NG"}　${esc(x.name)}</div>
         ${x.detail ? `<div class="ks-step-d">${esc(x.detail)}</div>` : ""}
         ${x.hint ? `<div class="ks-step-hint">${esc(x.hint)}</div>` : ""}
       </div>`).join("") + `</div>`;

    const ap = d.appointments || [];
    if (ap.length) {
      html += `<h4 class="ap-rot-h">担当未定のアポを1件ずつ確認</h4><div class="ks-test">` +
        ap.map((x) =>
          `<div class="ks-step ${x.ok ? "ok" : "ng"}">
             <div class="ks-step-h">${x.ok ? "決まる" : "決まらない"}　${esc(x.title)}</div>
             <div class="ks-step-d">${esc(x.why)}</div>
             ${x.hint ? `<div class="ks-step-hint">${esc(x.hint)}</div>` : ""}
           </div>`).join("") + `</div>`;
    }
    box.innerHTML = html;
    say("");
  } catch (e) {
    box.innerHTML = `<p class="note cc-warn">調べられませんでした：${esc(e.message)}</p>`;
    say("");
  } finally { btn.disabled = false; }
}

// ===== インサイドのカレンダー診断 =====
async function calCheck() {
  const box = $("calCheckBox");
  const btn = $("calCheckBtn");
  const say = (m) => { const e = $("calCheckStatus"); if (e) e.textContent = m; };
  if (!box) return;
  if (btn) btn.disabled = true;
  say("診断中…（人数分カレンダーを読むので少し時間がかかります）");
  box.innerHTML = "";
  try {
    const d = await (await fetch("/api/apo/calendar-check")).json();
    if (d.error) throw new Error(d.error);
    let html = `<p class="note">代表者 <b>${esc(d.owner)}</b> の連携でカレンダーを読みました（7日前〜60日先）。</p>`;
    html += `<div class="cal-list">`;
    for (const m of d.members || []) {
      let verdict, cls;
      if (m.error) { verdict = esc(m.error); cls = "cal-ng"; }
      else if (m.total === 0) { verdict = "カレンダーは読めましたが、期間内に予定が1件もありません"; cls = "cal-warn"; }
      else if (m.hosted === 0) { verdict = `予定は${m.total}件ありますが、この人が主催者の予定がありません（招待されているだけの予定は対象外です）`; cls = "cal-warn"; }
      else if (m.tagged === 0 && m.kinbotSkipped) { verdict = `タグ付きの予定は${m.kinbotSkipped}件ありますが、すべて「kinbotが作った商談予定」なので取り込みません。アポの元になる予定は、アポ獲得者ご自身で新しく作ってください（kinbotの予定をコピーすると取り込まれません）`; cls = "cal-warn"; }
      else if (m.tagged === 0) { verdict = `主催の予定が${m.hosted}件ありますが、タイトルに【新】【ヒ】【初回】のいずれかが付いた予定がありません`; cls = "cal-warn"; }
      else if (m.fresh === 0 && m.known) { verdict = `タグ付きの予定は${m.tagged}件ありますが、すべて<b>すでにkinbotに登録ずみ</b>です（通知は登録したときに1回だけ出ます）。同じ予定名・同じ時刻の予定を作り直しても、同じアポとして扱われるので通知は出ません`; cls = "cal-warn"; }
      else { verdict = `取り込み対象の予定が ${m.tagged}件 見つかりました（新しく取り込めるもの ${m.fresh}件／登録ずみ ${m.known}件）`; cls = "cal-ok"; }
      html += `<div class="cal-row ${cls}">
        <div class="cal-head"><b>${esc(m.name)}</b><span class="ap-rot-cnt">${esc(m.email)}</span></div>
        <div class="cal-verdict">${verdict}</div>`;
      if (!m.error && m.total) {
        html += `<div class="ap-rot-cnt">予定${m.total}件 ／ 本人が主催${m.hosted}件 ／ タグ一致${m.tagged}件` +
          (m.known ? ` ／ 登録ずみ${m.known}件` : "") +
          (m.kinbotSkipped ? ` ／ kinbotが作った予定として除外${m.kinbotSkipped}件` : "") + `</div>`;
      }
      if ((m.knownSamples || []).length) {
        html += `<div class="cal-samples">すでに登録ずみの予定：` +
          m.knownSamples.map((x) =>
            `<span>${esc(x.title)}${x.assigned ? "（割り振り済み）" : "（未割り振り）"}` +
            `${x.sameEvent ? "" : "／予定を作り直したもの"}</span>`).join("") + `</div>`;
      }
      if ((m.kinbotSamples || []).length) {
        html += `<div class="cal-samples">kinbotが作った予定として除外した例：` +
          m.kinbotSamples.map((x) => `<span>${esc(x.title)}</span>`).join("") + `</div>`;
      }
      if ((m.samples || []).length) {
        html += `<div class="cal-samples">タグが付いていない予定の例：` +
          m.samples.map((x) => `<span>${esc(x.title)}</span>`).join("") + `</div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;
    box.innerHTML = html;
    say("");
  } catch (e) {
    box.innerHTML = `<p class="note cc-warn">診断できませんでした：${esc(e.message)}</p>`;
    say("");
  } finally { if (btn) btn.disabled = false; }
}

// ===== データベースの状態確認 =====
function dbRender(d) {
  const box = $("dbCheckBox");
  if (!box) return;
  box.hidden = false;
  if (d.error) { box.textContent = "確認できませんでした: " + d.error; return; }
  if (!d.connected) { box.textContent = "データベースに接続されていません（DATABASE_URL 未設定）。"; return; }
  const lines = [];
  if (d.ok) {
    lines.push("問題ありません。必要なテーブル・カラムはすべて揃っています。");
  } else {
    if ((d.missingTables || []).length) lines.push("■ 作られていないテーブル\n  " + d.missingTables.join("\n  "));
    if ((d.missingColumns || []).length) lines.push("■ 作られていないカラム\n  " + d.missingColumns.join("\n  "));
    if ((d.failures || []).length) {
      lines.push("■ 作成に失敗したSQL（これが原因です）");
      for (const f of d.failures) lines.push(`  ${f.sql}\n    理由: ${f.error}`);
    }
    if (!lines.length) lines.push("不足は検出されませんでした。");
  }
  box.textContent = lines.join("\n\n");
}

async function dbCheck(repair) {
  const btn = repair ? $("dbRepairBtn") : $("dbCheckBtn");
  const say = (m) => { const e = $("dbCheckStatus"); if (e) e.textContent = m; };
  if (repair && !confirm("不足しているテーブルとカラムを作り直します。既存のデータは消えません。よろしいですか？")) return;
  if (btn) btn.disabled = true;
  say(repair ? "作り直しています…" : "確認中…");
  try {
    const r = await fetch("/api/db/schema-" + (repair ? "repair" : "check"), { method: repair ? "POST" : "GET" });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "確認に失敗しました");
    dbRender(d);
    say(d.ok ? "問題ありません" : "不足があります（下を確認してください）");
  } catch (e) {
    say("失敗: " + e.message);
  } finally { if (btn) btn.disabled = false; }
}

// ===== クローザーのローテーション設定パネル =====
let rotState = { closers: [], next: null };

// 事業が未設定のクローザーがいれば知らせる（DOCとMOCHICAの両方に出てしまうため）
function rcBizWarning() {
  const no = rotState.closers.filter((c) => !(c.businesses && c.businesses.length));
  if (!no.length) return "";
  return `<p class="note cc-warn">事業が未設定の人がいます：<b>${no.map((c) => esc(c.name || c.email)).join("、")}</b><br>` +
    `事業が未設定だと DOC と MOCHICA の両方に出ます。` +
    `<a href="settings.html#members">設定 → メンバー管理</a>で担当事業にチェックを入れてください。</p>`;
}

// 予備を飛ばして、通常メンバーだけに順番の番号を振る
function rcOrderNo(index) {
  let n = 0;
  for (let k = 0; k <= index; k++) if (!rotState.closers[k].fallback) n++;
  return n;
}

function rcRender() {
  const box = $("rcList");
  if (!box) return;
  box.innerHTML = "";
  rotState.closers.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "ap-rot-row" + (c.active === false ? " ap-rot-off" : "");
    row.draggable = true;
    row.dataset.i = i;
    // 表示は読み取り専用。メンバーの内容はメンバー管理が唯一の登録元。
    row.innerHTML =
      `<span class="ap-rot-num${c.fallback ? " ap-rot-num-fb" : ""}">${c.fallback ? "予" : rcOrderNo(i)}</span>` +
      `<span class="ap-rot-name">${esc(c.name || c.email)}` +
        `${c.fallback ? '<span class="ap-badge ap-badge-fb">予備</span>' : ""}` +
        `${c.active === false ? '<span class="ap-badge ap-pending">在籍なし</span>' : ""}` +
        `${c.suspended ? '<span class="ap-badge ap-warn">停止中</span>' : ""}` +
        `${c.priority && !c.fallback ? '<span class="ap-badge ap-warn">次を最優先</span>' : ""}</span>` +
      `<span class="ap-rot-meta">${esc(c.team || "チーム未設定")}</span>` +
      ((c.businesses && c.businesses.length)
        ? c.businesses.map((b) => `<span class="ap-biz-badge ap-biz-${esc(b)}">${esc(b)}</span>`).join("")
        : `<span class="ap-biz-badge ap-biz-none" title="事業が未設定のため、DOCとMOCHICAの両方に出ています">事業未設定</span>`) +
      `<span class="ap-rot-meta">${c.daily_cap ? "1日" + c.daily_cap + "件まで" : "上限なし"}</span>` +
      `<span class="ap-rot-cnt">${c.period_count || 0}件` +
        `${c.eligible_days > 0 ? `／稼働${c.eligible_days}日` : ""}` +
        `${c.eligible_days > 0 && c.per_day != null ? `／1日あたり${c.per_day}件` : ""}` +
        `${c.suspended_days > 0 ? `<span class="ap-susp-chip">停止${c.suspended_days}日を除外</span>` : ""}</span>` +
      (c.fallback || c.active === false ? "" : `<button type="button" class="btn ghost rc-first">ここから開始</button>`);

    const firstBtn = row.querySelector(".rc-first");
    if (firstBtn) firstBtn.addEventListener("click", async () => {
      if (!confirm(`次のアポを ${c.name || c.email} さんから始めます。よろしいですか？`)) return;
      try {
        const r = await fetch("/api/apo/rotation/next", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: c.email, product: curBiz() }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "変更に失敗しました");
        rotState.closers = d.closers || rotState.closers;
        rotState.next = d.next || null;
        rcRender(); rcNextLabel();
        rcSay("次の担当を変更しました", 3000);
      } catch (e) { rcSay("失敗: " + e.message); }
    });

    // ドラッグで並べ替え
    row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", String(i)); row.classList.add("ap-rot-drag"); });
    row.addEventListener("dragend", () => row.classList.remove("ap-rot-drag"));
    row.addEventListener("dragover", (e) => e.preventDefault());
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
      const to = i;
      if (!Number.isFinite(from) || from === to) return;
      const moved = rotState.closers.splice(from, 1)[0];
      rotState.closers.splice(to, 0, moved);
      rcRender();
    });
    box.appendChild(row);
  });
  const warn = rcBizWarning();
  if (warn) {
    const w = document.createElement("div");
    w.innerHTML = warn;
    box.appendChild(w);
  }
  if (!rotState.closers.length) {
    const b = curBiz();
    box.innerHTML = `<p class="note cc-warn">${b ? b + "を担当する" : ""}クローザーが登録されていません。` +
      `<a href="settings.html#members">設定 → メンバー管理</a>で「クローザー」の役割と事業（${b || "DOC / MOCHICA"}）を設定してください。</p>`;
  }
}

// 割り振り設定タブ内のチーム一覧。並び順と稼働／休止を切り替える。
function rcTeamsRender() {
  const box = $("rcTeams");
  if (!box) return;
  // 入力済みのチーム名を候補として使えるようにする
  let dl = document.getElementById("rcTeamOptions");
  if (!dl) {
    dl = document.createElement("datalist");
    dl.id = "rcTeamOptions";
    document.body.appendChild(dl);
  }
  const names = [...new Set(rotState.closers.map((c) => (c.team || "").trim()).filter(Boolean))];
  dl.innerHTML = names.map((n) => `<option value="${esc(n)}"></option>`).join("");

  const mode = $("rcTeamBalance") ? $("rcTeamBalance").value : "off";
  if (mode === "off") { box.innerHTML = ""; return; }
  if (!names.length) {
    box.innerHTML = `<p class="note cc-warn">クローザーにチーム名が入っていません。各行の「チーム」欄に入力してください。</p>`;
    return;
  }
  // サーバー側のチーム状態（稼働・順番）に、未保存のチーム名も足して表示
  const known = new Map((rotState.teams || []).map((t) => [t.team_name, t]));
  rotState.teamRows = names.map((n, i) => {
    const prev = (rotState.teamRows || []).find((t) => t.team_name === n);
    const srv = known.get(n);
    return prev || { team_name: n, active: srv ? srv.active !== false : true, sort_order: srv ? srv.sort_order : i + 1 };
  });

  box.innerHTML = "";
  rotState.teamRows.forEach((t, i) => {
    const members = rotState.closers.filter((c) => ((c.team || "").trim() || "未設定") === t.team_name);
    const activeN = members.filter((m) => m.active !== false).length;
    const row = document.createElement("div");
    row.className = "ap-team-row" + (t.active === false ? " ap-rot-off" : "");
    row.draggable = true;
    row.innerHTML =
      `<span class="ap-rot-num">${i + 1}</span>` +
      `<span class="ap-rot-name">${esc(t.team_name)}</span>` +
      `<span class="ap-rot-cnt">${members.length}名（稼働${activeN}名）</span>` +
      `<label class="ap-check"><input type="checkbox" class="rt-active" ${t.active === false ? "" : "checked"} /> 配布対象</label>`;
    row.querySelector(".rt-active").addEventListener("change", (e) => { t.active = e.target.checked; rcTeamsRender(); });
    row.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", String(i)));
    row.addEventListener("dragover", (e) => e.preventDefault());
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = parseInt(e.dataTransfer.getData("text/plain"), 10);
      if (!Number.isFinite(from) || from === i) return;
      const moved = rotState.teamRows.splice(from, 1)[0];
      rotState.teamRows.splice(i, 0, moved);
      rcTeamsRender();
    });
    box.appendChild(row);
  });
}

// 割り振り停止の履歴
function rcSuspRender() {
  const sel = $("rcSuspWho");
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = "";
    for (const c of rotState.closers) sel.add(new Option(c.name || c.email, c.email));
    if (cur) sel.value = cur;
  }
  const box = $("rcSuspList");
  if (!box) return;
  const list = rotState.suspensions || [];
  if (!list.length) { box.innerHTML = '<p class="note">停止の登録はありません。</p>'; return; }
  const nameOf = (r) => {
    if (r.name) return r.name;
    const c = rotState.closers.find((x) => x.email === r.email);
    return c ? (c.name || c.email) : r.email;
  };
  box.innerHTML = "";
  for (const r of list) {
    const ongoing = !r.end_date;
    const row = document.createElement("div");
    row.className = "ap-susp-row" + (ongoing ? " ap-susp-now" : "");
    const f = String(r.start_date).slice(0, 10);
    const t = r.end_date ? String(r.end_date).slice(0, 10) : "";
    row.innerHTML = `<span class="ap-susp-name">${esc(nameOf(r))}</span>` +
      `<span class="ap-susp-term">${esc(f)} 〜 ${t ? esc(t) : "継続中"}</span>` +
      (ongoing ? '<span class="ap-badge ap-warn">停止中</span>' : "") +
      `<span class="ap-rot-cnt">${esc(r.reason || "")}</span>` +
      `<button type="button" class="btn ghost ap-susp-del" data-id="${r.id}">削除</button>`;
    row.querySelector(".ap-susp-del").addEventListener("click", async () => {
      if (!confirm("この停止の登録を削除します。稼働日の計算がやり直されます。よろしいですか？")) return;
      try {
        const rr = await fetch(`/api/apo/suspensions/${r.id}?product=` + encodeURIComponent(curBiz()), { method: "DELETE" });
        const dd = await rr.json();
        if (!rr.ok) throw new Error(dd.error || "削除に失敗しました");
        await loadRotation();
      } catch (e) { alert("削除できませんでした: " + e.message); }
    });
    box.appendChild(row);
  }
}

// 過去の実績（取り込み分）の入力欄
function rcBaseRender() {
  const box = $("rcBaseList");
  if (!box) return;
  if (!rotState.closers.length) { box.innerHTML = '<p class="note">クローザーが登録されていません。</p>'; return; }
  box.innerHTML = "";
  rotState.closers.forEach((c) => {
    const row = document.createElement("label");
    row.className = "ap-base-row";
    row.innerHTML = `<span class="ap-base-name">${esc(c.name || c.email)}` +
      `${c.fallback ? '<span class="ap-badge ap-badge-fb">予備</span>' : ""}</span>` +
      `<input type="number" min="0" max="9999" class="rc-base" value="${c.baseline_count || 0}" /> 件` +
      `<span class="ap-rot-cnt">kinbotで配った分は別に数えます</span>`;
    row.querySelector(".rc-base").addEventListener("change", (e) => {
      const v = parseInt(e.target.value, 10);
      c.baseline_count = Number.isFinite(v) && v > 0 ? v : 0;
    });
    box.appendChild(row);
  });
}

function rcNextLabel() {
  const el = $("rcNext");
  if (!el) return;
  const n = rotState.next;
  el.classList.remove("ap-rot-next-warn");
  if (n) {
    el.innerHTML = `次に割り振られるのは <b>${esc(n.name || n.email)}</b> さん${n.team ? `（${esc(n.team)}）` : ""}です` +
      `${n.fallback ? " ※通常メンバーが全員埋まっているため予備" : n.priority ? " ※前回代打で飛ばされたため最優先" : ""}`;
    return;
  }
  // サーバーに保存されていないが、画面上に候補が並んでいる状態
  const pending = rotState.closers.filter((c) => c.active !== false);
  if (pending.length) {
    el.innerHTML = `［保存］を押すと <b>${esc(pending[0].name || pending[0].email)}</b> さんから割り振りが始まります。`;
    el.classList.add("ap-rot-next-warn");
    return;
  }
  el.innerHTML = 'クローザーが登録されていません。<a href="settings.html#members">設定 → メンバー管理</a>で役割を付けてください。';
  el.classList.add("ap-rot-next-warn");
}

// メンバーの追加はメンバー管理で行うため、この画面には無い
function rcFillAdd() {}

async function loadRotation() {
  try {
    const d = await (await fetch("/api/apo/rotation?product=" + encodeURIComponent(curBiz()))).json();
    rotState.closers = (d.closers || []).map((c) => ({ ...c }));
    rotState.next = d.next || null;
    rotState.teams = d.teams || rotState.teams;
    const c = d.config || {};
    if ($("rcAutoScan")) $("rcAutoScan").checked = !!c.autoScan;
    if ($("rcAutoAssign")) $("rcAutoAssign").checked = !!c.autoAssign;
    if ($("rcBuffer")) $("rcBuffer").value = c.bufferMin ?? 0;
    if ($("rcMax")) $("rcMax").value = c.maxPerRun ?? 30;
    if ($("rcInterval")) $("rcInterval").value = c.scanIntervalSec ?? 60;
    if ($("rcTeamBalance")) $("rcTeamBalance").value = c.teamBalance || "off";
    if ($("rcWindow")) $("rcWindow").value = c.balanceWindow || "month";
    if ($("rcFairStart")) $("rcFairStart").value = c.fairnessStart || "";
    rotState.suspensions = d.suspensions || [];
    rotState.teams = d.teams || [];
    rotState.teamRows = null;
    rcRender(); rcNextLabel(); rcFillAdd(); rcTeamsRender(); rcBaseRender(); rcSuspRender(); bizLabel("rcBizLabel");
  } catch { rcSay("ローテーションの設定を読めませんでした"); }
}

function rcSay(msg, ms) {
  const el = $("rcStatus");
  if (!el) return;
  el.textContent = msg;
  if (ms) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, ms);
}

async function saveRotation() {
  const btn = $("rcSave");
  if (btn) btn.disabled = true;
  rcSay("保存中…");
  try {
    // 並び順だけを保存する（メンバーの内容はメンバー管理側で保存される）
    let r = await fetch("/api/apo/closer-order", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ emails: rotState.closers.map((c) => c.email) }),
    });
    let d = await r.json();
    if (!r.ok) throw new Error(d.error || "並び順の保存に失敗しました");

    // チームの並び順・稼働状態
    if (rotState.teamRows && rotState.teamRows.length) {
      const rt = await fetch("/api/apo/teams", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ teams: rotState.teamRows }),
      });
      const rd = await rt.json();
      if (!rt.ok) throw new Error(rd.error || "チームの保存に失敗しました");
    }

    r = await fetch("/api/apo/rotation-config", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        autoScan: $("rcAutoScan").checked,
        autoAssign: $("rcAutoAssign").checked,
        bufferMin: $("rcBuffer").value,
        maxPerRun: $("rcMax").value,
        scanIntervalSec: $("rcInterval") ? $("rcInterval").value : 60,
        teamBalance: $("rcTeamBalance").value,
        balanceWindow: $("rcWindow").value,
        fairnessStart: $("rcFairStart") ? $("rcFairStart").value : "",
      }),
    });
    d = await r.json();
    if (!r.ok) throw new Error(d.error || "設定の保存に失敗しました");
    rotState.closers = (d.closers || []).map((c) => ({ ...c }));
    rotState.next = d.next || null;
    rotState.teams = d.teams || rotState.teams;
    rotState.teams = d.teams || [];
    rotState.teamRows = null;
    rcRender(); rcNextLabel(); rcFillAdd(); rcTeamsRender(); rcBaseRender(); rcSuspRender(); bizLabel("rcBizLabel");
    rcSay(`保存しました（通常${rotState.closers.filter((c) => c.active !== false && !c.fallback).length}名・予備${rotState.closers.filter((c) => c.fallback).length}名）`, 4000);
  } catch (e) {
    rcSay("保存に失敗しました: " + e.message);
  } finally { if (btn) btn.disabled = false; }
}

// ===== アポメール設定パネル =====
let mailDefaults = null;
async function loadMailCfg() {
  const hourSel = $("mcHour");
  if (hourSel && !hourSel.options.length) {
    for (let h = 0; h < 24; h++) hourSel.add(new Option(String(h).padStart(2, "0"), String(h)));
  }
  try {
    const c = await (await fetch("/api/apo-mail-config")).json();
    mailDefaults = c.defaults || null;
    if ($("mcDeliver")) $("mcDeliver").value = c.deliverMode || "draft";
    if ($("mcAutoConfirm")) $("mcAutoConfirm").checked = !!c.autoConfirm;
    if ($("mcAutoReminder")) $("mcAutoReminder").checked = !!c.autoReminder;
    if (hourSel) hourSel.value = String(c.reminderHour);
    if ($("mcCopy")) $("mcCopy").checked = c.copyToSelf !== false;
    if ($("mcGap")) $("mcGap").value = String(c.remindGapHours ?? 20);
    if ($("mcMax")) $("mcMax").value = c.maxPerRun;
    if ($("mcCompany")) $("mcCompany").value = c.companyName === "弊社" ? "" : c.companyName;
    if ($("mcCSubject")) $("mcCSubject").value = c.confirmSubject;
    if ($("mcCBody")) $("mcCBody").value = c.confirmBody;
    if ($("mcRSubject")) $("mcRSubject").value = c.reminderSubject;
    if ($("mcRBody")) $("mcRBody").value = c.reminderBody;
  } catch (e) {
    if ($("mcStatus")) $("mcStatus").textContent = "設定を読めませんでした";
  }
}
function mcSay(msg, ms) {
  const el = $("mcStatus");
  if (!el) return;
  el.textContent = msg;
  if (ms) setTimeout(() => { if (el.textContent === msg) el.textContent = ""; }, ms);
}
async function saveMailCfg() {
  const btn = $("mcSave");
  if (btn) btn.disabled = true;
  mcSay("保存中…");
  try {
    const body = {
      deliverMode: $("mcDeliver") ? $("mcDeliver").value : "draft",
      autoConfirm: $("mcAutoConfirm").checked,
      autoReminder: $("mcAutoReminder").checked,
      reminderHour: $("mcHour").value,
      copyToSelf: $("mcCopy") ? $("mcCopy").checked : true,
      remindGap: $("mcGap") ? $("mcGap").value : 20,
      maxPerRun: $("mcMax").value,
      companyName: $("mcCompany").value,
      confirmSubject: $("mcCSubject").value,
      confirmBody: $("mcCBody").value,
      reminderSubject: $("mcRSubject").value,
      reminderBody: $("mcRBody").value,
    };
    const r = await fetch("/api/apo-mail-config", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "保存に失敗しました");
    mcSay(`保存しました（${$("mcDeliver") && $("mcDeliver").value === "send" ? "自動送信" : "下書き作成"}）`, 3500);
  } catch (e) {
    mcSay("保存に失敗しました: " + e.message);
  } finally { if (btn) btn.disabled = false; }
}

(function () {
  if ($("mcSave")) $("mcSave").addEventListener("click", saveMailCfg);

  // テストで送ってみる
  if ($("mtSend")) {
    // 宛先は、はじめは自分のアドレスを入れておく
    (async () => {
      try {
        const me = await apiJson("/api/me");
        if ($("mtTo") && !$("mtTo").value) $("mtTo").value = me.email || me.username || "";
      } catch {}
    })();
    const runTest = async (draft) => {
      const st = $("mtStatus"), box = $("mtBox");
      st.textContent = draft ? "下書きを作っています…" : "送っています…";
      if (box) box.textContent = "";
      try {
        const r = await fetch("/api/apo-mail/test", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            to: $("mtTo").value, kind: $("mtKind").value,
            setter: $("mtSetter").value, draft,
          }),
        });
        const d = await r.json();
        if (!r.ok || !d.ok) throw new Error(d.reason || d.error || "送れませんでした");
        st.textContent = draft ? "下書きを作りました" : "送りました";
        setTimeout(() => (st.textContent = ""), 6000);
        if (box) {
          box.innerHTML = `<b>件名</b> ${esc(d.subject)}<br>` +
            (d.url ? `<a class="home-sf-link" href="${esc(d.url)}" target="_blank" rel="noopener">Gmailで開く</a><br>` : "") +
            `<div class="mt-preview">${esc(d.bodyText || "").replace(/\n/g, "<br>")}</div>`;
        }
      } catch (e) {
        st.textContent = "失敗：" + e.message;
      }
    };
    $("mtSend").addEventListener("click", () => runTest(false));
    if ($("mtDraft")) $("mtDraft").addEventListener("click", () => runTest(true));
  }
  if ($("mcReset")) $("mcReset").addEventListener("click", () => {
    if (!mailDefaults) return;
    if (!confirm("件名と本文を初期文面に戻します。よろしいですか？（保存を押すまで反映されません）")) return;
    $("mcCSubject").value = mailDefaults.confirmSubject;
    $("mcCBody").value = mailDefaults.confirmBody;
    $("mcRSubject").value = mailDefaults.reminderSubject;
    $("mcRBody").value = mailDefaults.reminderBody;
    mcSay("初期文面に戻しました。保存を押してください", 4000);
  });
  if ($("mcRunRemind")) $("mcRunRemind").addEventListener("click", async () => {
    if (!confirm("明日ぶんの商談について、前日リマインドを今すぐ用意します。設定が「下書き」なら下書きが作られ、「自動送信」ならお客様に届きます。よろしいですか？")) return;
    mcSay("送信中…");
    try {
      const r = await fetch("/api/apo-mail/run-reminders", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "実行に失敗しました");
      if (d.skipped) mcSay(d.reason || "実行しませんでした", 4000);
      else mcSay(`対象${d.total}件のうち${d.sent}件を用意しました`, 6000);
      loadApo();
    } catch (e) { mcSay("失敗: " + e.message); }
  });
  setupTabs();
  // トップバーの 全体 / DOC / MOCHICA と連動させる
  (async function () {
    if (!window.kbProduct) return;
    await window.kbProduct.loadMap();
    window.kbProduct.mount(() => {
      loadApo();
      loadRotation();
      if (!$("tsBody") || !document.querySelector('.ap-pane[data-pane="team"]:not([hidden])')) bizLabel("tsBizLabel");
      else loadTeamStats();
    }, { renderOnMount: false });
    bizLabel("rcBizLabel"); bizLabel("tsBizLabel");
  })();
  loadBuild();
  if ($("ivLoad")) $("ivLoad").addEventListener("click", loadInvites);
  if ($("ivHours")) $("ivHours").addEventListener("change", loadInvites);
  if ($("orLoad")) $("orLoad").addEventListener("click", loadOrphans);
  if ($("siLoad")) $("siLoad").addEventListener("click", loadSelfInvites);
  if ($("siDel")) $("siDel").addEventListener("click", delSelfInvites);
  if ($("siAll")) $("siAll").addEventListener("click", () =>
    document.querySelectorAll("#siBox .si-chk").forEach((c) => { c.checked = true; }));
  if ($("siNone")) $("siNone").addEventListener("click", () =>
    document.querySelectorAll("#siBox .si-chk").forEach((c) => { c.checked = false; }));
  if ($("verBox")) showVersion();
  if ($("depBox")) loadDeploy();
  if ($("siWords")) {
    loadSkipInviters();
    $("siSave").addEventListener("click", saveSkipInviters);
  }
  if ($("twWords")) {
    loadTestWords();
    $("twSave").addEventListener("click", saveTestWords);
  }
  if ($("evOn")) {
    loadEvening();
    $("evSave").addEventListener("click", saveEvening);
    $("evTest").addEventListener("click", testEvening);
  }
  if ($("crOn")) {
    loadCallReport();
    $("crSave").addEventListener("click", saveCallReport);
    $("crTest").addEventListener("click", () => testCallReport(false));
  }
  if ($("depOn")) $("depOn").addEventListener("change", async (e) => {
    const st = $("depStatus");
    try {
      await apiJson("/api/deploy/info", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: e.target.checked }),
      });
      if (st) { st.textContent = e.target.checked ? "知らせます" : "知らせません"; setTimeout(() => (st.textContent = ""), 4000); }
    } catch (err) { if (st) st.textContent = "失敗: " + err.message; }
  });
  if ($("depTest")) $("depTest").addEventListener("click", async () => {
    const st = $("depStatus");
    if (st) st.textContent = "送っています…";
    try {
      const d = await apiJson("/api/deploy/test-notify", { method: "POST" });
      if (st) st.textContent = d.skipped ? `送れませんでした（${d.reason || ""}）` : "送りました。Chatを見てください";
    } catch (e) { if (st) st.textContent = "失敗: " + e.message; }
  });
  if ($("pushCheck")) $("pushCheck").addEventListener("click", pushCheck);
  if ($("pushSetup")) $("pushSetup").addEventListener("click", pushSetup);
  if ($("pushBox")) pushCheck();
  if ($("calCheckBtn")) $("calCheckBtn").addEventListener("click", calCheck);
  if ($("dbCheckBtn")) $("dbCheckBtn").addEventListener("click", () => dbCheck(false));
  if ($("dbRepairBtn")) $("dbRepairBtn").addEventListener("click", () => dbCheck(true));
  if ($("tsReload")) $("tsReload").addEventListener("click", loadTeamStats);
  if ($("tsWindow")) $("tsWindow").addEventListener("change", loadTeamStats);
  if ($("rcTeamBalance")) $("rcTeamBalance").addEventListener("change", () => { rcTeamsRender(); rcNextLabel(); });
  if ($("rcSuspAdd")) $("rcSuspAdd").addEventListener("click", async () => {
    const el = $("rcSuspStatus");
    const say = (m, ms) => { if (el) { el.textContent = m; if (ms) setTimeout(() => { if (el.textContent === m) el.textContent = ""; }, ms); } };
    const email = $("rcSuspWho").value;
    const from = $("rcSuspFrom").value;
    const to = $("rcSuspTo").value;
    if (!email) { say("クローザーを選んでください", 4000); return; }
    if (!from) { say("開始日を入力してください", 4000); return; }
    if (!to && !confirm("終了日が空です。現在も停止中として扱い、自動割り振りの対象から外します。よろしいですか？")) return;
    say("登録中…");
    try {
      const r = await fetch("/api/apo/suspensions", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, startDate: from, endDate: to || null, reason: $("rcSuspWhy").value, product: curBiz() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "登録に失敗しました");
      $("rcSuspFrom").value = ""; $("rcSuspTo").value = ""; $("rcSuspWhy").value = "";
      say("登録しました。稼働日の計算に反映されます", 5000);
      await loadRotation();
    } catch (e) { say("失敗: " + e.message); }
  });
  if ($("rcWhy")) $("rcWhy").addEventListener("click", whyNoAssign);
  if ($("alDiag")) $("alDiag").addEventListener("click", diagnoseLaunch);
  if ($("dupCheck")) $("dupCheck").addEventListener("click", () => dedupeApos(false));
  if ($("dupRun")) $("dupRun").addEventListener("click", () => {
    if (!confirm("重複したアポを消します。\n担当や宛先が入っているものを1件だけ残します。\n\nよろしいですか？")) return;
    dedupeApos(true);
  });
  if ($("rcBaseSave")) $("rcBaseSave").addEventListener("click", async () => {
    const el = $("rcBaseStatus");
    const say = (m, ms) => { if (el) { el.textContent = m; if (ms) setTimeout(() => { if (el.textContent === m) el.textContent = ""; }, ms); } };
    say("保存中…");
    try {
      const counts = {};
      for (const c of rotState.closers) counts[c.email] = c.baseline_count || 0;
      const r = await fetch("/api/apo/baseline", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ counts, product: curBiz() }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "保存に失敗しました");
      say("保存しました。均等化の計算に反映されます", 5000);
      await loadRotation();
    } catch (e) { say("失敗: " + e.message); }
  });
  if ($("rcSave")) $("rcSave").addEventListener("click", saveRotation);
  if ($("rcScanNow")) $("rcScanNow").addEventListener("click", async () => {
    if (!confirm("カレンダーを今すぐスキャンして、未割り当てのアポを自動で割り振ります。よろしいですか？")) return;
    rcSay("スキャン中…");
    try {
      const r = await fetch("/api/apo/auto-scan", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "実行に失敗しました");
      if (d.skipped) rcSay(d.reason || "実行しませんでした", 6000);
      else rcSay(`アポ${d.total}件を確認し、未割り当て${d.targets}件のうち${d.assigned}件を割り振りました`, 8000);
      await loadRotation();
      loadApo();
    } catch (e) { rcSay("失敗: " + e.message); }
  });
  if ($("rcLog")) $("rcLog").addEventListener("click", async () => {
    const box = $("rcLogBox");
    if (!box) return;
    if (!box.hidden) { box.hidden = true; return; }
    box.hidden = false;
    box.textContent = "読み込み中…";
    try {
      const rows = await (await fetch("/api/apo/assign-log")).json();
      if (!Array.isArray(rows) || !rows.length) { box.textContent = "履歴はまだありません。"; return; }
      box.textContent = rows.map((r) => {
        const t = new Date(r.created_at).toLocaleString("ja-JP");
        const sk = Array.isArray(r.skipped) && r.skipped.length
          ? "  飛ばした: " + r.skipped.map((s) => `${s.name}(${s.reason})`).join(" / ") : "";
        return `${t}  ${r.assigned || "未割当"}  ${r.reason || ""}${sk}`;
      }).join("\n");
    } catch (e) { box.textContent = "履歴を読めませんでした: " + e.message; }
  });
  loadMailCfg();
  if ($("apReload")) $("apReload").addEventListener("click", loadApo);
  // 探す欄は、打つたびにその場で絞り込む（読み込み直さないので速い）
  if ($("apFind")) {
    let t = null;
    $("apFind").addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        renderApo();
        const st = $("apStatus");
        const w = $("apFind").value.trim();
        if (st) {
          const all = (apState.appts || []).length;
          const hit = w ? (apState.appts || []).filter((x) => apoMatches(x, w)).length : all;
          st.textContent = w ? `${hit}件 / 全${all}件` : `${all}件`;
        }
      }, 150);
    });
  }
  if ($("apClear")) $("apClear").addEventListener("click", () => {
    if ($("apCreated")) $("apCreated").value = "";
    if ($("apStart")) $("apStart").value = "";
    if ($("apFind")) $("apFind").value = "";
    loadApo();
  });
  loadApo();
})();


// ───────────────────────────────────────────────────────────
// 日程調整ページ
// ───────────────────────────────────────────────────────────
async function bkCreate(shared) {
  const st = $("bkStatus"), box = $("bkBox");
  if (st) st.textContent = "作っています…";
  try {
    const r = await fetch("/api/booking/pages", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: $("bkTitle").value, shared,
        minutes: parseInt($("bkMin").value, 10),
        daysAhead: parseInt($("bkDays").value, 10),
        fromHour: parseInt($("bkFrom").value, 10),
        toHour: parseInt($("bkTo").value, 10),
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "作れませんでした");
    if (st) st.textContent = "";
    const ways = d["貼り方"];
    box.innerHTML =
      `<div class="sh-box">
         <div class="sh-lb">${d["共通"] ? "Pardot用の共通URL" : "この1本のURL"}</div>
         <div class="sh-url"><code>${esc(d.url)}</code>
           <button type="button" class="btn ghost bk-copy" data-u="${esc(d.url)}">コピー</button></div>
         ${ways ? `<div class="sh-lb">Pardotに貼るときは、こちらを使ってください</div>` +
           Object.entries(ways).map(([k, u]) => `
             <div class="sh-row">
               <span class="sh-name">${esc(k)}</span>
               <code class="sh-code">${esc(u)}</code>
               <button type="button" class="btn ghost bk-copy" data-u="${esc(u)}">コピー</button>
             </div>`).join("") : ""}
       </div>`;
    box.querySelectorAll(".bk-copy").forEach((b) =>
      b.addEventListener("click", () => {
        navigator.clipboard.writeText(b.dataset.u)
          .then(() => { b.textContent = "コピーしました"; setTimeout(() => (b.textContent = "コピー"), 2000); })
          .catch(() => { b.textContent = "できませんでした"; });
      }));
  } catch (e) { if (st) st.textContent = "失敗：" + e.message; }
}

// 作ったページと、誰が見たか
async function bkLoadList() {
  const box = $("bkListBox");
  if (!box) return;
  box.innerHTML = "読み込んでいます…";
  try {
    const d = await (await fetch("/api/booking/pages")).json();
    const items = d.items || [];
    if (!items.length) { box.innerHTML = '<div class="note">まだページがありません。</div>'; return; }
    box.innerHTML =
      `<table class="sh-table"><tr><th>ページ</th><th>URL</th><th>閲覧</th><th>予約</th><th></th></tr>` +
      items.map((x) => `<tr>
        <td>${esc(x.title)}${x["共通"] ? "（共通）" : x["相手"] ? `<br><small>${esc(x["相手"])}</small>` : ""}</td>
        <td><code style="font-size:11px">${esc(x.url)}</code></td>
        <td>${x["閲覧"]}</td>
        <td>${x["予約"]}</td>
        <td><button type="button" class="btn ghost bk-who" data-id="${x.id}">誰が見たか</button></td>
      </tr>`).join("") + `</table><div id="bkWho"></div>`;
    box.querySelectorAll(".bk-who").forEach((b) =>
      b.addEventListener("click", () => bkViewers(b.dataset.id)));
  } catch (e) { box.innerHTML = "読み込めませんでした：" + esc(e.message); }
}

async function bkViewers(id) {
  const box = $("bkWho");
  if (!box) return;
  box.innerHTML = "読み込んでいます…";
  try {
    const d = await (await fetch(`/api/booking/pages/${encodeURIComponent(id)}/viewers`)).json();
    const items = d.items || [];
    if (!items.length) { box.innerHTML = '<div class="note">まだ誰も開いていません。</div>'; return; }
    const when = (v) => {
      const x = new Date(v);
      if (isNaN(x.getTime())) return "";
      const j = new Date(x.getTime() + 9 * 3600 * 1000);
      const p = (n) => String(n).padStart(2, "0");
      return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
    };
    box.innerHTML =
      `<div class="note">${items.length}人が開きました</div>` +
      `<table class="sh-table"><tr><th>相手</th><th>回数</th><th>予約</th><th>最後に見た</th></tr>` +
      items.map((x) => `<tr>
        <td>${esc(x["相手"])}${x["名前"] ? `<br><small>${esc(x["名前"])}</small>` : ""}</td>
        <td>${x["回数"]}</td>
        <td>${x["予約した"] ? esc(when(x["予約日時"])) : "-"}</td>
        <td>${esc(when(x["最後"]))}</td>
      </tr>`).join("") + `</table>`;
  } catch (e) { box.innerHTML = "見られませんでした：" + esc(e.message); }
}

// 画面ぜんたいでクリックを受け止める（途中で止まっても押せるように）
document.addEventListener("click", (ev) => {
  const t = ev.target && ev.target.closest ? ev.target.closest("button") : null;
  if (!t) return;
  if (t.id === "bkMakeShared") { ev.preventDefault(); bkCreate(true); }
  if (t.id === "bkMakeOne") { ev.preventDefault(); bkCreate(false); }
  if (t.id === "bkList") { ev.preventDefault(); bkLoadList(); }
});




// ───────────────────────────────────────────────────────────
// 送ったメールの記録（届いたか・跳ね返ったか）
// ───────────────────────────────────────────────────────────
async function mlLoad() {
  const box = $("mlBox"), st = $("mlStatus");
  if (!box) return;
  if (st) st.textContent = "読み込んでいます…";
  try {
    const q = new URLSearchParams();
    if ($("mlFrom").value) q.set("from", $("mlFrom").value);
    if ($("mlTo").value) q.set("to", $("mlTo").value);
    if ($("mlKind").value) q.set("kind", $("mlKind").value);
    if ($("mlMine").checked) q.set("mine", "1");
    const d = await apiJson("/api/apo-mail/log?" + q.toString());
    if (st) st.textContent = "";
    const items = d.items || [];
    const g = d["集計"] || {};
    const when = (v) => {
      const x = new Date(v);
      if (isNaN(x.getTime())) return "";
      const j = new Date(x.getTime() + 9 * 3600 * 1000);
      const p = (n) => String(n).padStart(2, "0");
      return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
    };
    box.innerHTML =
      `<div class="ml-sum">送信済み ${g["送信済み"] || 0}　下書き ${g["下書き"] || 0}` +
      (g["届きませんでした"] ? `　<span class="cc-warn">届かなかった ${g["届きませんでした"]}</span>` : "") +
      (g["失敗"] ? `　<span class="cc-warn">失敗 ${g["失敗"]}</span>` : "") + `</div>` +
      (items.length
        ? `<table class="sh-table"><tr><th>送った日時</th><th>種類</th><th>会社</th><th>宛先</th><th>送った人</th><th>状態</th></tr>` +
          items.map((x) => `<tr class="${x["状態"] === "届きませんでした" || x["状態"] === "失敗" ? "ml-ng" : ""}">
            <td>${esc(when(x.at))}</td>
            <td>${esc(x["種類"])}</td>
            <td>${esc(x["会社"] || "")}</td>
            <td>${esc(x["宛先"] || "")}</td>
            <td>${esc(x["送った人"] || "")}</td>
            <td>${esc(x["状態"])}${x["理由"] ? `<br><small>${esc(x["理由"])}</small>` : ""}</td>
          </tr>`).join("") + `</table>`
        : `<div class="note">この期間に送ったメールはありません。</div>`);
  } catch (e) { if (st) st.textContent = "失敗：" + e.message; }
}

async function mlCheckBounce() {
  const st = $("mlStatus");
  if (st) st.textContent = "調べています…（10秒ほどかかります）";
  try {
    const d = await apiJson("/api/apo-mail/check-bounces", { method: "POST" });
    if (st) {
      st.textContent = d["見つかった数"]
        ? `届かなかったメールが ${d["見つかった数"]}件 見つかりました`
        : "届かなかったメールはありませんでした";
      setTimeout(() => (st.textContent = ""), 8000);
    }
    mlLoad();
  } catch (e) { if (st) st.textContent = "失敗：" + e.message; }
}

if ($("mlLoad")) {
  // はじめは直近7日
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const ago = new Date(Date.now() + 9 * 3600 * 1000 - 6 * 86400000).toISOString().slice(0, 10);
  if ($("mlFrom") && !$("mlFrom").value) $("mlFrom").value = ago;
  if ($("mlTo") && !$("mlTo").value) $("mlTo").value = today;
  $("mlLoad").addEventListener("click", mlLoad);
  if ($("mlBounce")) $("mlBounce").addEventListener("click", mlCheckBounce);
}
