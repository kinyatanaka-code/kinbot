// DOC の AI（次面談話）の管理画面：「回答レビュー」で開いたチャットの中身を読んで、kinXs に送る（2026-11-18 田中さん）
//   管理画面は Streamlit で作られていて API が無い。画面に出ている文字を読む。押すボタンは無く、開いたら自動で送る。
//   読むのは「候補者の採用プロフィール」と「質問1: …」のような折りたたみの中身。同じ中身は2回送らない
(function () {
  if (window.top !== window) return;
  const C = { deep: "#0d5b47", main: "#1d9e75", light: "#e8f5ef", line: "#5DCAA5" };
  const sent = new Set();
  let timer = null;

  // 右下の小さなお知らせ（何が起きたかが分かるように）
  function toast(text, ok) {
    let el = document.getElementById("kbDocAiToast");
    if (!el) {
      el = document.createElement("div"); el.id = "kbDocAiToast";
      el.style.cssText = `position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:8px;max-width:360px;background:#fff;border:1.5px solid ${C.line};border-radius:14px;padding:9px 14px;font:600 12.5px/1.5 system-ui,sans-serif;color:${C.deep};box-shadow:0 6px 20px rgba(13,91,71,.16);transition:opacity .4s`;
      (document.body || document.documentElement).appendChild(el);
    }
    const ico = ok
      ? `<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><rect x="1" y="1" width="18" height="18" rx="6" fill="${C.main}"/><path d="M5.5 10.2l3 3 6-6.4" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : `<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><rect x="1" y="1" width="18" height="18" rx="6" fill="#d9822b"/><rect x="9" y="5" width="2" height="7" rx="1" fill="#fff"/><circle cx="10" cy="14.6" r="1.2" fill="#fff"/></svg>`;
    el.style.borderColor = ok ? C.line : "#e7b37a"; el.style.color = ok ? C.deep : "#7a4310";
    el.innerHTML = `${ico}<span>${text}</span>`; el.style.opacity = "1";
    clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = "0"; }, ok ? 4000 : 9000);
  }

  const norm = (t) => String(t || "").replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  // 折りたたみが閉じていると innerText は空になるので、文の塊（Markdown の箱）ごとに textContent で読む
  function blockText(root) {
    const blocks = root.querySelectorAll('[data-testid="stMarkdownContainer"], [data-testid="stText"], [data-testid="stCode"], [data-testid="stChatMessage"]');
    const out = [];
    blocks.forEach((b) => {
      if (b.parentElement && b.parentElement.closest('[data-testid="stMarkdownContainer"], [data-testid="stChatMessage"]') && b.parentElement.closest('[data-testid="stMarkdownContainer"], [data-testid="stChatMessage"]') !== b) return;
      // 箇条書きは1行ずつにする
      const lis = b.querySelectorAll("li");
      if (lis.length) lis.forEach((li) => out.push(`・${norm(li.textContent)}`));
      else out.push(norm(b.textContent));
    });
    return out.filter(Boolean);
  }
  function companyId() {
    const q = new URLSearchParams(location.search).get("company");
    if (q) return q;
    // 左の「企業を選択」で選んでいるもの
    const sel = [...document.querySelectorAll('[data-testid="stSelectbox"]')].find((x) => /企業/.test(x.textContent || ""));
    const v = sel && sel.querySelector('[data-baseweb="select"] div[value], [data-baseweb="select"]');
    const t = v ? norm(v.getAttribute("value") || v.textContent) : "";
    const m = t.match(/[a-z0-9_-]{4,}/i);
    return m ? m[0] : "";
  }
  function read() {
    if (!/chat_curator/.test(location.pathname + location.search)) return null;
    const all = document.body ? document.body.innerText || "" : "";
    if (!/回答レビュー/.test(all)) return null;
    const label = (all.match(/セッション\s*[:：]\s*([0-9a-f-]{6,})/i) || [])[1] || "";
    const sid = new URLSearchParams(location.search).get("session_id") || "";
    // 開いている回答レビューのセッションと、URL のセッションがちがうときは、画面の方を信じる
    const sessionId = sid && label && !sid.toLowerCase().startsWith(label.slice(0, 8).toLowerCase()) ? "" : sid;
    if (!label && !sessionId) return null;
    const exps = [...document.querySelectorAll('[data-testid="stExpander"]')];
    let profile = { title: "", lines: [] }; const qa = [];
    for (const ex of exps) {
      const sum = ex.querySelector("summary") || ex.querySelector('[data-testid="stExpanderToggleIcon"]')?.parentElement || ex;
      const title = norm((sum.querySelector('[data-testid="stMarkdownContainer"]') || sum).textContent);
      const body = ex.querySelector('[data-testid="stExpanderDetails"]') || ex;
      const lines = blockText(body).filter((l) => l !== title);
      if (/プロフィール/.test(title)) profile = { title, lines };
      else if (/^質問\s*\d+/.test(title)) qa.push({ q: title.replace(/^質問\s*\d+\s*[:：]\s*/, ""), a: lines.join("\n") });
    }
    // 折りたたみの形でないとき（画面の作りが変わったとき）のために、回答レビューの文をそのままも送る（kinbot 側で読み直せるように）
    const i = all.indexOf("回答レビュー");
    const raw = i >= 0 ? all.slice(i, i + 30000) : "";
    if (!qa.length && !profile.lines.length) return null;
    return { company: companyId(), sessionId, sessionLabel: label, profile, qa, raw, url: location.href.split("#")[0] };
  }
  function check() {
    const d = read(); if (!d) return;
    const sig = JSON.stringify([d.company, d.sessionLabel || d.sessionId, d.qa.map((x) => x.q + x.a.length), d.profile.lines.length]);
    if (sent.has(sig)) return; sent.add(sig);
    if (!d.company) { toast("kinbot：どの企業のチャットか分かりませんでした。左の「企業を選択」で企業を選んでください。", false); return; }
    try {
      chrome.runtime.sendMessage({ type: "kb-docai-capture", payload: d }, (r) => {
        if (chrome.runtime.lastError || !r) { toast("kinbot：送れませんでした（拡張機能を読み込み直してください）", false); sent.delete(sig); return; }
        if (r.ok) toast(`kinXs に保存しました（${r.company}・質問 ${r.questions} 件）`, true);
        else { toast(`kinbot：保存できませんでした。${r.error || ""}`, false); sent.delete(sig); }
      });
    } catch { sent.delete(sig); }
  }
  // Streamlit は画面をあとから書きかえるので、変化が落ち着いてから読む
  const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(check, 1800); });
  const start = () => { if (!document.body) return setTimeout(start, 300); obs.observe(document.body, { childList: true, subtree: true, characterData: true }); timer = setTimeout(check, 2500); };
  start();
})();
