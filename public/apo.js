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
  const src = a.client_email_source === "manual" ? "手入力"
    : a.client_email_source === "description" ? "予定の説明欄から取得"
    : a.client_email_source === "calendar" ? "カレンダーのゲストから取得" : "";
  if (a.client_email) {
    return `<span class="ap-mailaddr" title="${esc(src)}">${esc(a.client_email)}</span>` +
      `${a.client_email_source === "description" ? '<span class="ap-src-chip">説明欄</span>' : ""}` +
      `<button class="btn ghost ap-mailedit" data-i="${i}">変更</button>`;
  }
  return `<button class="btn ghost ap-mailedit ap-warn-btn" data-i="${i}">宛先を入力</button>`;
}

// アポメールの送信状況
function mailCell(a, i) {
  const m = a.mail || {};
  const chip = (label, st) => {
    if (!st) return `<span class="ap-badge ap-pending">${label}未作成</span>`;
    if (st.status === "draft") return `<span class="ap-badge ap-draft" title="${esc(st.at || "")}｜担当者のGmailの下書きに入っています">${label}下書き済</span>`;
    if (st.status === "sent") return `<span class="ap-badge ap-ok" title="${esc(st.at || "")}">${label}送信済</span>`;
    return `<span class="ap-badge ap-warn" title="${esc(st.error || "")}">${label}失敗</span>`;
  };
  const canSend = !!a.current_owner && !!a.client_email;
  const draftMode = (apState.mailConfig || {}).deliverMode !== "send";
  const btn = canSend
    ? `<button class="btn ghost ap-sendmail" data-i="${i}" data-kind="confirm">${draftMode ? "下書きを作る" : "確定メールを送信"}</button>`
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
// メール状況セルだけを描き直す
function refreshMailCell(i) {
  const cell = document.querySelector(`.ap-mail[data-i="${i}"]`);
  if (!cell) return;
  cell.innerHTML = mailCell(apState.appts[i], i);
  bindMailButtons(cell);
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

// アポ1件をカードにする
function apoCard(a, i) {
  const assigned = !!a.current_owner;
  const badges =
    (a.business ? `<span class="ap-biz-badge ap-biz-${esc(a.business)}">${esc(a.business)}</span>` : "") +
    (assigned ? "" : '<span class="home-badge home-badge-st">担当未定</span>');

  return `<div class="ap-card${assigned ? "" : " ap-card-todo"}" data-i="${i}">
    <div class="ap-card-row">
      <div class="ap-card-main">
        <div class="ap-card-top">
          <span class="ap-card-time">${esc(fmtTime(a.start))}</span>${badges}
        </div>
        <div class="ap-card-title">${esc(a.title)}</div>
        <div class="ap-card-meta">
          アポ獲得 <b>${esc(a.setter_name)}</b>
          <span class="ap-dot">・</span>取得 ${esc(fmtYmd(a.created_date))}
        </div>
        <div class="ap-card-lines">
          <div class="ap-line">
            <span class="ap-line-k">お客様の宛先</span>
            <span class="ap-line-v ap-client" data-i="${i}">${clientCell(a, i)}</span>
          </div>
          <div class="ap-line">
            <span class="ap-line-k">アポメール</span>
            <span class="ap-line-v ap-mail" data-i="${i}">${mailCell(a, i)}</span>
          </div>
          <div class="ap-line">
            <span class="ap-line-k">状態</span>
            <span class="ap-line-v ap-status" data-i="${i}">${statusCell(a)}</span>
          </div>
        </div>
      </div>
      <div class="ap-card-actions">
        <select class="ap-rep" data-i="${i}">${repOptions(a.current_owner)}</select>
        ${assigned ? "" : `<button class="btn kb-prio ap-auto" data-i="${i}">自動で決める</button>`}
        <select class="ap-bizsel" data-i="${i}">${
          ["", "DOC", "MOCHICA"].map((b) =>
            `<option value="${b}"${(a.business || "") === b ? " selected" : ""}>${b || "事業 未判定"}</option>`).join("")
        }</select>
        <div class="ap-card-links">
          <a class="ap-link-a" href="${esc(a.smart_url)}" target="_blank" rel="noopener" title="${esc(a.smart_url)}">開く</a>
          <button class="btn ghost ap-copy" data-url="${esc(a.smart_url)}">コピー</button>
        </div>
      </div>
    </div>
  </div>`;
}

function renderApo() {
  const body = $("apoBody");
  const appts = apState.appts;
  const errNote = (apState.errors || []).length
    ? '<p class="note cc-warn">一部のカレンダーを読めませんでした：' +
      apState.errors.map((e) => esc(e.setter) + "（" + esc(e.error) + "）").join("、") + '</p>'
    : "";
  if (!appts.length) {
    body.innerHTML = '<div class="empty-state">該当するアポがありませんでした。取得日・商談日の指定を変えて［表示］を押すか、' +
      '<a href="settings.html#members">設定 → メンバー管理</a>の登録内容とカレンダー共有をご確認ください。</div>' + errNote;
    return;
  }

  // 商談日でグループにまとめる（ホームと同じ見せ方）
  const groups = [];
  let last = null;
  appts.forEach((a, i) => {
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
          a.mail = Object.assign({}, a.mail, { confirm: { status: d.mail.draft ? "draft" : "sent", at: new Date().toISOString() } });
        } else if (d.mail && !d.mail.skipped && d.mail.reason) {
          a.mail = Object.assign({}, a.mail, { confirm: { status: "failed", error: d.mail.reason } });
        }
        refreshMailCell(i);
        // 商談予定の自動作成（招待）の結果を知らせる
        if (owner && d.invite_error) {
          alert("担当は変更しましたが、商談予定の自動作成に失敗しました:\n" + d.invite_error);
        }
        if (owner && d.mail && d.mail.ok && d.mail.noRoom) {
          alert(`${owner} が「設定 → 登録リンク」に会議室URLを登録していません。\n\n` +
            `メールは用意できましたが、URLを開いてもお客様が入室できません。本人に登録してもらってください。`);
        }
        if (owner && d.mail && !d.mail.ok && !d.mail.skipped) {
          alert("アポ確定メールの自動送信に失敗しました。\n\n" + (d.mail.reason || "") +
            (d.mail.needScope
              ? "\n\n※ 担当は割り当てられています。メールだけ送れていません。" +
                "\n" + (d.mail.needScopeOwner || "本人") + " が Google連携をやり直すと送れるようになります。"
              : ""));
        }
      } catch (e) {
        alert("担当者の変更に失敗しました: " + e.message);
      } finally { sel.disabled = false; }
    });
  });
  body.querySelectorAll(".ap-bizsel").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const i = +sel.dataset.i;
      const a = apState.appts[i];
      sel.disabled = true;
      try {
        const r = await fetch(`/api/smart-links/${encodeURIComponent(a.slug)}/business`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ business: sel.value }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "変更に失敗しました");
        a.business = sel.value;
      } catch (e) {
        alert("事業を変更できませんでした: " + e.message);
        sel.value = a.business || "";
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
  } catch (e) {
    body.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
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
    if (name === "team") loadTeamStats();
    if (name === "sys") loadBuild();
  };
  tabs.forEach((t) => t.addEventListener("click", () => show(t.dataset.pane)));
  let init = "list";
  try { init = localStorage.getItem("apoTab") || "list"; } catch {}
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

// ===== チーム実績タブ =====
// チーム間の偏りと、チーム内の偏りの両方が見えるようにする。
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
      if (m.error) { verdict = m.error; cls = "cal-ng"; }
      else if (m.total === 0) { verdict = "カレンダーは読めましたが、期間内に予定が1件もありません"; cls = "cal-warn"; }
      else if (m.hosted === 0) { verdict = `予定は${m.total}件ありますが、この人が主催者の予定がありません（招待されているだけの予定は対象外です）`; cls = "cal-warn"; }
      else if (m.tagged === 0) { verdict = `主催の予定が${m.hosted}件ありますが、タイトルに【新】【ヒ】【初回】のいずれかが付いた予定がありません`; cls = "cal-warn"; }
      else { verdict = `取り込み対象の予定が ${m.tagged}件 見つかりました`; cls = "cal-ok"; }
      html += `<div class="cal-row ${cls}">
        <div class="cal-head"><b>${esc(m.name)}</b><span class="ap-rot-cnt">${esc(m.email)}</span></div>
        <div class="cal-verdict">${esc(verdict)}</div>`;
      if (!m.error && m.total) {
        html += `<div class="ap-rot-cnt">予定${m.total}件 ／ 本人が主催${m.hosted}件 ／ タグ一致${m.tagged}件</div>`;
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
  if ($("apClear")) $("apClear").addEventListener("click", () => {
    if ($("apCreated")) $("apCreated").value = "";
    if ($("apStart")) $("apStart").value = "";
    loadApo();
  });
  loadApo();
})();
