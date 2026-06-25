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
  const CHUNK = 25;
  let sent = 0, failed = 0, skipped = 0;
  const errors = [];
  const total = ids.length;
  let done = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
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
      // このチャンクは丸ごと失敗扱いにして継続
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
