// public/nav.js — サイドバーのユーザー表示とログアウト
(async () => {
  try {
    const me = await (await fetch("/api/me")).json();
    const who = document.getElementById("who");
    if (who) who.textContent = me.username ? me.username + (me.admin ? "（管理者）" : "") : "";
  } catch {}
  const lo = document.getElementById("logout");
  if (lo)
    lo.addEventListener("click", async (e) => {
      e.preventDefault();
      await fetch("/api/logout", { method: "POST" });
      location.href = "/login.html";
    });
})();

// ===== Notion一括送信（自動分割・進捗・重複スキップはサーバー側で実施） =====
window.kinbotBulkNotion = async function (ids, { onProgress } = {}) {
  const CHUNK = 5; // 小さめにして進捗をこまめに更新＋1リクエストを短く（タイムアウト回避）
  let sent = 0, failed = 0, skipped = 0;
  const errors = [];
  const total = ids.length;
  let done = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    if (onProgress) onProgress({ done, total, sent, failed, skipped, busy: part.length });
    let d;
    try {
      const r = await fetch("/api/notion/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: part }),
      });
      d = await r.json();
      if (!r.ok) throw new Error(d.error || "送信に失敗しました");
    } catch (e) {
      failed += part.length;
      if (errors.length < 5) errors.push(e.message);
      done += part.length;
      if (onProgress) onProgress({ done, total, sent, failed, skipped });
      continue;
    }
    sent += d.sent || 0;
    failed += d.failed || 0;
    skipped += d.skipped || 0;
    if (d.errors) for (const e of d.errors) if (errors.length < 5) errors.push(e);
    done += part.length;
    if (onProgress) onProgress({ done, total, sent, failed, skipped });
  }
  return { sent, failed, skipped, total, errors };
};

// ===== 進捗バー（％ or 不確定アニメ）共通部品 =====
window.kbProgress = function (el, opts = {}) {
  if (!el) return;
  if (opts.clear) { el.innerHTML = ""; return; }
  let wrap = el.querySelector(".kb-progwrap");
  const indet = opts.percent == null;
  if (!wrap) {
    el.innerHTML = `<div class="kb-progwrap"><div class="kb-prog"><div class="kb-prog-bar"></div></div><div class="kb-prog-label"></div></div>`;
    wrap = el.querySelector(".kb-progwrap");
  }
  const prog = wrap.querySelector(".kb-prog");
  const bar = wrap.querySelector(".kb-prog-bar");
  const label = wrap.querySelector(".kb-prog-label");
  prog.classList.toggle("indet", indet);
  if (indet) bar.style.width = "";
  else bar.style.width = Math.max(0, Math.min(100, Math.round(opts.percent))) + "%";
  label.textContent = (opts.label || "") + (indet ? "" : "  " + Math.round(opts.percent) + "%");
};

// ===== 進行中ライブの「botを退出」バナー（自分が立ち上げた商談・全ページ共通） =====
(function liveBanner() {
  if (location.pathname.endsWith("/") || /index\.html$/.test(location.pathname)) return; // 録画ページ自身は除外
  let el = null;
  const render = (list) => {
    if (!list || !list.length) { if (el) { el.remove(); el = null; } return; }
    const s = list[0];
    if (!el) {
      el = document.createElement("div");
      el.className = "live-banner";
      document.body.appendChild(el);
    }
    const extra = list.length > 1 ? `<span class="lb-extra">ほか${list.length - 1}件</span>` : "";
    el.innerHTML =
      `<span class="lb-dot"></span>` +
      `<span class="lb-text">ライブ商談中：<b>${(s.title || "").replace(/[<>&]/g, "")}</b></span>${extra}` +
      `<button class="lb-stop" data-id="${s.id}">botを退出させる</button>`;
    const btn = el.querySelector(".lb-stop");
    btn.addEventListener("click", async () => {
      if (!confirm("このライブ商談からbotを退出させます。よろしいですか？\n（録画・要約・分析はこれまでの内容で生成されます）")) return;
      btn.disabled = true; btn.textContent = "退出中…";
      try {
        await fetch(`/api/sessions/${encodeURIComponent(s.id)}/stop`, { method: "POST" });
      } catch {}
      poll();
    });
  };
  const poll = async () => {
    try {
      const r = await fetch("/api/sessions/mine");
      render(await r.json());
    } catch { /* 失敗時は何もしない */ }
  };
  poll();
  setInterval(poll, 15000);
})();

// （社内・フォローのサイドバーは削除。商談履歴ページのタブに統合済み）

// ===== 代理ログイン（なりすまし） =====
// 田中欽也（kinya.tanaka@neo-career.co.jp）だけが使える。
// - 代理ログイン中は上部に目立つバナーを常時表示（元のアカウントへすぐ戻れる）
// - サイドバーに「他メンバーとして操作」ボタンを表示（田中さん本人 or 代理中のときのみ）
(async function impersonation() {
  if (location.pathname === "/login.html" || location.pathname === "/register.html") return;
  let me;
  try { me = await (await fetch("/api/me")).json(); } catch { return; }
  if (!me || !me.username) return;

  // 代理ログイン中：上部に目立つバナー
  if (me.impersonating) {
    const bar = document.createElement("div");
    bar.className = "imp-banner";
    const impName = me.impersonator_name || me.impersonator_email || "元アカウント";
    const targetName = me.name || me.username;
    bar.innerHTML = `
      <div class="imp-banner-inner">
        <span class="imp-banner-icon" aria-hidden="true">👤</span>
        <span class="imp-banner-text">
          <b>${escapeH(impName)}</b> として、<b>${escapeH(targetName)}</b> の画面を操作しています
        </span>
        <button type="button" class="imp-banner-btn" id="impBackBtn">← 元のアカウントに戻る</button>
      </div>`;
    document.body.insertBefore(bar, document.body.firstChild);
    document.body.classList.add("imp-active");
    document.getElementById("impBackBtn").addEventListener("click", async () => {
      try {
        const r = await fetch("/api/impersonate/stop", { method: "POST" });
        if (!r.ok) throw new Error("戻れませんでした");
        location.reload();
      } catch (e) { alert(e.message); }
    });
  }

  // 田中さん本人 or 代理ログイン中なら、サイドバーに切替ボタンを追加
  if (!me.can_impersonate) return;
  const side = document.querySelector(".sidebar-nav") || document.querySelector(".sidebar");
  if (!side) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "sidebar-imp-btn";
  btn.innerHTML = `<span aria-hidden="true">🔀</span><span>他メンバーとして操作</span>`;
  btn.addEventListener("click", openImpPicker);
  side.appendChild(btn);

  async function openImpPicker() {
    // 既に開いていれば閉じる
    const existing = document.getElementById("impPicker");
    if (existing) { existing.remove(); return; }
    let users = [];
    try { users = (await (await fetch("/api/impersonate/users")).json()).users || []; }
    catch { alert("ユーザー一覧を取得できませんでした"); return; }
    const currentEmail = String(me.impersonator_email || me.username).toLowerCase();
    users = users.filter((u) => (u.email || "").toLowerCase() !== currentEmail);

    const modal = document.createElement("div");
    modal.id = "impPicker";
    modal.className = "imp-modal";
    modal.innerHTML = `
      <div class="imp-modal-panel">
        <div class="imp-modal-h">
          <span>他のメンバーとして操作</span>
          <button type="button" class="imp-modal-x" aria-label="閉じる">×</button>
        </div>
        <div class="imp-modal-note">
          切り替えたメンバーの画面がそのまま操作できます。<b>編集・削除・パスワード変更もあなたの操作として記録に残ります。</b>くれぐれも慎重に扱ってください。
        </div>
        <input type="search" class="imp-modal-filter" id="impFilter" placeholder="名前・メールで絞り込み" autocomplete="off" />
        <div class="imp-modal-list" id="impList"></div>
      </div>`;
    document.body.appendChild(modal);
    const render = (q) => {
      const qq = (q || "").trim().toLowerCase();
      const list = document.getElementById("impList");
      const shown = users.filter((u) => !qq || (u.name || "").toLowerCase().includes(qq) || (u.email || "").toLowerCase().includes(qq));
      list.innerHTML = shown.length
        ? shown.map((u) => `<button type="button" class="imp-user" data-email="${escapeH(u.email)}"><span class="imp-user-name">${escapeH(u.name || u.email)}</span><span class="imp-user-email">${escapeH(u.email)}</span></button>`).join("")
        : '<div class="imp-empty">該当ユーザーがいません</div>';
      list.querySelectorAll(".imp-user").forEach((el) => el.addEventListener("click", () => switchTo(el.dataset.email, el.querySelector(".imp-user-name").textContent)));
    };
    document.getElementById("impFilter").addEventListener("input", (e) => render(e.target.value));
    modal.querySelector(".imp-modal-x").addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
    render("");
    setTimeout(() => document.getElementById("impFilter").focus(), 30);
  }

  async function switchTo(email, name) {
    if (!confirm(`${name} として操作を開始します。よろしいですか？\n（この操作は監査ログに記録されます）`)) return;
    try {
      const r = await fetch("/api/impersonate/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "切り替えに失敗しました");
      location.href = "/";
    } catch (e) { alert(e.message); }
  }

  function escapeH(s) { return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
})();

// 分析ページ群のサイドバーactive処理
(function() {
  const path = location.pathname;
  if (/style-analysis|dashboard|report/.test(path)) {
    document.querySelectorAll('.side-item').forEach(a => {
      a.classList.toggle('active', a.href && a.href.includes('report.html'));
    });
  }
})();
