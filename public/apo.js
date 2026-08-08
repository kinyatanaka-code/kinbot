const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const apState = { reps: [], appts: [], errors: [] };

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
function repOptions(selected) {
  let o = `<option value="">担当未定</option>`;
  for (const r of apState.reps) {
    const sel = r.email === selected ? " selected" : "";
    o += `<option value="${esc(r.email)}"${sel}>${esc(r.name)}${r.has_zoom_link ? "" : "（Zoom未設定）"}</option>`;
  }
  return o;
}
// 宛先セル：自動取得できていればそのまま表示、無ければ入力欄。クリックで編集できる。
function clientCell(a, i) {
  const src = a.client_email_source === "manual" ? "手入力" : a.client_email_source === "calendar" ? "自動取得" : "";
  if (a.client_email) {
    return `<span class="ap-mailaddr" title="${esc(src)}">${esc(a.client_email)}</span>
      <button class="btn ghost ap-mailedit" data-i="${i}">変更</button>`;
  }
  return `<button class="btn ghost ap-mailedit ap-warn-btn" data-i="${i}">宛先を入力</button>`;
}

// アポメールの送信状況
function mailCell(a, i) {
  const m = a.mail || {};
  const chip = (label, st) => {
    if (!st) return `<span class="ap-badge ap-pending">${label}未送信</span>`;
    if (st.status === "sent") return `<span class="ap-badge ap-ok" title="${esc(st.at || "")}">${label}送信済</span>`;
    return `<span class="ap-badge ap-warn" title="${esc(st.error || "")}">${label}失敗</span>`;
  };
  const canSend = !!a.current_owner && !!a.client_email;
  const btn = canSend
    ? `<button class="btn ghost ap-sendmail" data-i="${i}" data-kind="confirm">確定メール送信</button>`
    : "";
  return `<div class="ap-mailstate">${chip("確定", m.confirm)}${chip("前日", m.reminder)}</div>${btn}`;
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
        const cell = document.querySelector(`.ap-client[data-i="${i}"]`);
        if (cell) { cell.innerHTML = clientCell(a, i); bindMailButtons(cell); }
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
      const msg = already
        ? `この商談には既に${label}を送信済みです。もう一度送りますか？`
        : `${a.current_owner} のGmailから${label}を送信します。よろしいですか？`;
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
        a.mail = Object.assign({}, a.mail, { [kind]: { status: "sent", at: new Date().toISOString() } });
        refreshMailCell(i);
      } catch (e) {
        a.mail = Object.assign({}, a.mail, { [kind]: { status: "failed", error: e.message } });
        refreshMailCell(i);
        alert("送信に失敗しました: " + e.message);
      } finally { b.disabled = false; b.textContent = orig; }
    });
  });
}
// メール状況セルだけを描き直す
function refreshMailCell(i) {
  const cell = document.querySelector(`.ap-mail[data-i="${i}"]`);
  if (!cell) return;
  cell.innerHTML = mailCell(apState.appts[i], i);
  bindMailButtons(cell);
}

function renderApo() {
  const body = $("apoBody");
  const appts = apState.appts;
  if (!appts.length) {
    body.innerHTML = '<div class="empty-state">該当するアポがありませんでした。取得日・商談日の指定を変えて［表示］を押すか、<a href="settings.html">設定 → インターン登録</a>の登録内容・カレンダー共有をご確認ください。</div>';
    if ((apState.errors || []).length) {
      body.innerHTML += '<p class="note cc-warn">一部のカレンダーを読めませんでした：' + apState.errors.map((e) => esc(e.setter) + "（" + esc(e.error) + "）").join("、") + '</p>';
    }
    return;
  }
  const gotTh = apState.fCreated ? '<th class="ap-active">取得日 ●</th>' : '<th>取得日</th>';
  const startTh = apState.fStart ? '<th class="ap-active">商談日時 ●</th>' : '<th>商談日時</th>';
  let html = `<table class="ap-table"><thead><tr>${gotTh}${startTh}<th>アポ獲得者</th><th>予定名</th><th>担当セールス</th><th>お客様の宛先</th><th>アポメール</th><th>共有リンク</th><th>状態</th></tr></thead><tbody>`;
  appts.forEach((a, i) => {
    html += `<tr>
      <td class="ap-got">${fmtYmd(a.created_date)}</td>
      <td class="ap-when">${fmtDT(a.start)}</td>
      <td>${esc(a.setter_name)}</td>
      <td class="ap-title">${esc(a.title)}</td>
      <td><select class="ap-rep" data-i="${i}">${repOptions(a.current_owner)}</select>` +
        (a.current_owner ? "" : `<button class="btn ghost ap-auto" data-i="${i}">自動で決める</button>`) + `</td>
      <td class="ap-client" data-i="${i}">${clientCell(a, i)}</td>
      <td class="ap-mail" data-i="${i}">${mailCell(a, i)}</td>
      <td class="ap-link"><code>${esc(a.smart_url)}</code> <button class="btn ghost ap-copy" data-url="${esc(a.smart_url)}">コピー</button></td>
      <td class="ap-status" data-i="${i}">${statusCell(a)}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  if ((apState.errors || []).length) {
    html += '<p class="note cc-warn">一部のカレンダーを読めませんでした：' + apState.errors.map((e) => esc(e.setter) + "（" + esc(e.error) + "）").join("、") + '</p>';
  }
  body.innerHTML = html;

  body.querySelectorAll(".ap-rep").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const i = +sel.dataset.i;
      const a = apState.appts[i];
      const owner = sel.value || null;
      sel.disabled = true;
      try {
        const r = await fetch(`/api/smart-links/${encodeURIComponent(a.slug)}/owner`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ owner }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "変更に失敗しました");
        a.current_owner = owner;
        const cell = body.querySelector(`.ap-status[data-i="${i}"]`);
        if (cell) cell.innerHTML = statusCell(a);
        // アポ確定メールの送信結果を反映する
        if (d.mail && d.mail.ok) {
          a.mail = Object.assign({}, a.mail, { confirm: { status: "sent", at: new Date().toISOString() } });
        } else if (d.mail && !d.mail.skipped && d.mail.reason) {
          a.mail = Object.assign({}, a.mail, { confirm: { status: "failed", error: d.mail.reason } });
        }
        refreshMailCell(i);
        // 商談予定の自動作成（招待）の結果を知らせる
        if (owner && d.invite_error) {
          alert("担当は変更しましたが、商談予定の自動作成に失敗しました:\n" + d.invite_error);
        }
        if (owner && d.mail && !d.mail.ok && !d.mail.skipped) {
          alert("アポ確定メールの自動送信に失敗しました:\n" + (d.mail.reason || "") +
            (d.mail.needScope ? "\n\n担当者のGoogle連携を取り直してください（設定 → 連携）。" : ""));
        }
      } catch (e) {
        alert("担当者の変更に失敗しました: " + e.message);
      } finally { sel.disabled = false; }
    });
  });
  body.querySelectorAll(".ap-auto").forEach((b) => {
    b.addEventListener("click", async () => {
      const i = +b.dataset.i;
      const a = apState.appts[i];
      b.disabled = true;
      const bo = b.textContent;
      b.textContent = "判定中…";
      try {
        const r = await fetch(`/api/smart-links/${encodeURIComponent(a.slug)}/auto-assign`, { method: "POST" });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "割り振れませんでした");
        loadApo();
      } catch (e) {
        alert("自動で決められませんでした:\n" + e.message);
        b.disabled = false; b.textContent = bo;
      }
    });
  });
  bindMailButtons(body);
  body.querySelectorAll(".ap-copy").forEach((b) => {
    b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(b.dataset.url); b.textContent = "コピーしました"; }
      catch { b.textContent = "失敗"; }
      setTimeout(() => (b.textContent = "コピー"), 1500);
    });
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
  loadRotation();
  try {
    const q = new URLSearchParams();
    if (created) q.set("created", created);
    if (start) q.set("start", start);
    const r = await fetch("/api/apo/pickup?" + q.toString());
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "取り込みに失敗しました");
    apState.appts = d.appointments || [];
    apState.errors = d.errors || [];
    renderApo();
    if (st) st.textContent = `${apState.appts.length}件`;
    setTimeout(() => { if (st) st.textContent = ""; }, 2500);
  } catch (e) {
    body.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
  }
}
// ===== 今動いているビルドの表示 =====
// 「アップロードしたのに機能が出てこない」ときに、まずここを見れば反映されたか分かる。
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

function rcRender() {
  const box = $("rcList");
  if (!box) return;
  box.innerHTML = "";
  rotState.closers.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "ap-rot-row" + (c.active === false ? " ap-rot-off" : "");
    row.draggable = true;
    row.dataset.i = i;
    row.innerHTML =
      `<span class="ap-rot-num">${i + 1}</span>` +
      `<span class="ap-rot-name">${esc(c.name || c.email)}${c.priority ? '<span class="ap-badge ap-warn">次を最優先</span>' : ""}</span>` +
      `<label class="ap-check"><input type="checkbox" class="rc-active" ${c.active === false ? "" : "checked"} /> 稼働中</label>` +
      `<label class="ap-rot-cap">上限 <input type="number" class="rc-cap" min="1" max="20" value="${c.daily_cap || ""}" /> 件/日</label>` +
      `<span class="ap-rot-cnt">累計${c.assigned_count || 0}件</span>` +
      `<button type="button" class="btn ghost rc-first">ここから開始</button>` +
      `<button type="button" class="btn ghost rc-del">外す</button>`;

    row.querySelector(".rc-active").addEventListener("change", (e) => { c.active = e.target.checked; rcRender(); });
    row.querySelector(".rc-cap").addEventListener("change", (e) => {
      const v = parseInt(e.target.value, 10);
      c.daily_cap = Number.isFinite(v) && v > 0 ? v : null;
    });
    row.querySelector(".rc-del").addEventListener("click", () => {
      rotState.closers.splice(i, 1); rcRender(); rcFillAdd();
    });
    row.querySelector(".rc-first").addEventListener("click", async () => {
      if (!confirm(`次のアポを ${c.name || c.email} さんから始めます。よろしいですか？`)) return;
      try {
        const r = await fetch("/api/apo/rotation/next", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: c.email }),
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
  if (!rotState.closers.length) {
    box.innerHTML = `<p class="note">クローザーが未登録です。下のプルダウンから追加してください。</p>`;
  }
}

function rcNextLabel() {
  const el = $("rcNext");
  if (!el) return;
  const n = rotState.next;
  el.innerHTML = n
    ? `次に割り振られるのは <b>${esc(n.name || n.email)}</b> さんです${n.priority ? "（前回代打で飛ばされたため最優先）" : ""}`
    : `割り振り可能なクローザーがいません`;
}

// 未登録のメンバーだけを追加プルダウンに出す
function rcFillAdd() {
  const sel = $("rcAddSel");
  if (!sel) return;
  const have = new Set(rotState.closers.map((c) => c.email));
  sel.innerHTML = "";
  const rest = apState.reps.filter((r) => !have.has(r.email));
  if (!rest.length) { sel.innerHTML = `<option value="">追加できる人がいません</option>`; return; }
  for (const r of rest) sel.add(new Option(r.name || r.email, r.email));
}

async function loadRotation() {
  try {
    const d = await (await fetch("/api/apo/rotation")).json();
    rotState.closers = (d.closers || []).map((c) => ({ ...c }));
    rotState.next = d.next || null;
    const c = d.config || {};
    if ($("rcAutoScan")) $("rcAutoScan").checked = !!c.autoScan;
    if ($("rcAutoAssign")) $("rcAutoAssign").checked = !!c.autoAssign;
    if ($("rcBuffer")) $("rcBuffer").value = c.bufferMin ?? 0;
    if ($("rcMax")) $("rcMax").value = c.maxPerRun ?? 30;
    rcRender(); rcNextLabel(); rcFillAdd();
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
    let r = await fetch("/api/apo/closers", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ closers: rotState.closers }),
    });
    let d = await r.json();
    if (!r.ok) throw new Error(d.error || "保存に失敗しました");

    r = await fetch("/api/apo/rotation-config", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        autoScan: $("rcAutoScan").checked,
        autoAssign: $("rcAutoAssign").checked,
        bufferMin: $("rcBuffer").value,
        maxPerRun: $("rcMax").value,
      }),
    });
    d = await r.json();
    if (!r.ok) throw new Error(d.error || "設定の保存に失敗しました");
    rotState.closers = (d.closers || []).map((c) => ({ ...c }));
    rotState.next = d.next || null;
    rcRender(); rcNextLabel(); rcFillAdd();
    rcSay("保存しました", 2500);
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
    if ($("mcAutoConfirm")) $("mcAutoConfirm").checked = !!c.autoConfirm;
    if ($("mcAutoReminder")) $("mcAutoReminder").checked = !!c.autoReminder;
    if (hourSel) hourSel.value = String(c.reminderHour);
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
      autoConfirm: $("mcAutoConfirm").checked,
      autoReminder: $("mcAutoReminder").checked,
      reminderHour: $("mcHour").value,
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
    mcSay("保存しました", 2500);
  } catch (e) {
    mcSay("保存に失敗しました: " + e.message);
  } finally { if (btn) btn.disabled = false; }
}

(function () {
  if ($("mcSave")) $("mcSave").addEventListener("click", saveMailCfg);
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
    if (!confirm("明日ぶんの商談について、前日リマインドを今すぐ送信します。よろしいですか？")) return;
    mcSay("送信中…");
    try {
      const r = await fetch("/api/apo-mail/run-reminders", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "実行に失敗しました");
      if (d.skipped) mcSay(d.reason || "実行しませんでした", 4000);
      else mcSay(`対象${d.total}件のうち${d.sent}件を送信しました`, 6000);
      loadApo();
    } catch (e) { mcSay("失敗: " + e.message); }
  });
  loadBuild();
  if ($("dbCheckBtn")) $("dbCheckBtn").addEventListener("click", () => dbCheck(false));
  if ($("dbRepairBtn")) $("dbRepairBtn").addEventListener("click", () => dbCheck(true));
  if ($("rcSave")) $("rcSave").addEventListener("click", saveRotation);
  if ($("rcAdd")) $("rcAdd").addEventListener("click", () => {
    const sel = $("rcAddSel");
    const email = sel && sel.value;
    if (!email) return;
    const rep = apState.reps.find((r) => r.email === email);
    rotState.closers.push({ email, name: (rep && rep.name) || email, active: true, priority: false, daily_cap: null, assigned_count: 0 });
    rcRender(); rcFillAdd();
    rcSay("追加しました。保存を押してください", 4000);
  });
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
  if ($("apClear")) $("apClear").addEventListener("click", () => {
    if ($("apCreated")) $("apCreated").value = "";
    if ($("apStart")) $("apStart").value = "";
    loadApo();
  });
  loadApo();
})();
