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

// ===== サイドバーに「社内・フォロー」項目を差し込む（全ページ共通） =====
(function addOtherNav() {
  const side = document.querySelector(".sidebar");
  if (!side || side.querySelector('[data-nav="other"]')) return;
  const hist = side.querySelector('.side-item[href="history.html"]') || side.querySelector('.side-item[href^="history.html"]');
  const a = document.createElement("a");
  a.className = "side-item";
  a.dataset.nav = "other";
  a.href = "history.html?cat=other";
  a.innerHTML = '<span class="side-ico ico-hist"></span><span class="side-label">社内・フォロー</span>';
  if (hist && hist.parentNode) hist.parentNode.insertBefore(a, hist.nextSibling);
  else side.appendChild(a);
  const isOther = /history\.html$/.test(location.pathname) && new URLSearchParams(location.search).get("cat") === "other";
  if (isOther) {
    a.classList.add("active");
    if (hist) hist.classList.remove("active");
  }
})();
