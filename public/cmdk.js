// cmdk.js — どの画面からでも Cmd/Ctrl + K で開くコマンドパレット。
// できること：会社名で商談履歴へ飛ぶ／画面移動（ホーム・商談履歴・kincall 等）。
// 自己完結（他ファイルに依存しない）。各ページに <script src="/cmdk.js?v=..."> で読み込む。
(function () {
  if (window.__cmdkLoaded) return;
  window.__cmdkLoaded = true;

  // 画面移動の候補（固定）
  const NAV = [
    { label: "ホーム", hint: "今日の商談・アポ", href: "/home.html", kw: "home ほーむ トップ" },
    { label: "商談履歴", hint: "録音・要約・SF更新", href: "/history.html", kw: "history れきし 商談" },
    { label: "案件（deals）", hint: "ステージ・活動を記録", href: "/deals.html", kw: "deals あんけん 案件 商談" },
    { label: "kincall（架電リスト）", hint: "かける・記録", href: "/kincall", kw: "kincall 架電 コール 電話" },
    { label: "アポ", hint: "アポ一覧・割り振り", href: "/apo.html", kw: "apo あぽ" },
    { label: "Salesforce 立ち上げ", hint: "会社名でリードを探す", href: "/sf-launch.html", kw: "sf salesforce 立ち上げ" },
    { label: "レコーディング", hint: "Botを入室させる", href: "/index.html", kw: "recording 録音 rec bot" },
    { label: "実績", hint: "分析", href: "/analysis.html", kw: "分析 実績 analysis" },
    { label: "設定", hint: "外部連携ほか", href: "/settings.html", kw: "settings せってい 設定 連携" },
  ];

  const norm = (v) => String(v || "").replace(/[\s　（）()・,、.。/-]/g, "").toLowerCase();

  let companies = null;        // {name, rep, n, last}[]
  let companiesAt = 0;
  async function loadCompanies() {
    if (companies && Date.now() - companiesAt < 5 * 60 * 1000) return companies;
    try {
      const r = await fetch("/api/deals", { credentials: "same-origin" });
      const d = await r.json();
      const rows = Array.isArray(d) ? d : (d.items || d.deals || []);
      const map = new Map();
      for (const x of rows) {
        const name = (x.company_name || x.company || x.account || "").trim();
        if (!name) continue;
        const rep = (x.rep_name || x.owner_name || x.owner || "").trim();
        const last = x.last_meeting_date || x.updated_at || x.created_at || "";
        const cur = map.get(name);
        if (!cur) map.set(name, { name, rep, n: 1, last });
        else { cur.n++; if (last > cur.last) { cur.last = last; if (rep) cur.rep = rep; } }
      }
      companies = [...map.values()];
      companiesAt = Date.now();
    } catch { companies = companies || []; }
    return companies;
  }

  // ── UI ──
  let root, input, listEl, active = 0, items = [];
  function build() {
    root = document.createElement("div");
    root.id = "cmdk-root";
    root.innerHTML =
      '<div class="cmdk-back"></div>' +
      '<div class="cmdk-panel" role="dialog" aria-label="コマンドパレット">' +
      '  <div class="cmdk-inrow">' +
      '    <svg viewBox="0 0 16 16" width="16" height="16" fill="none"><circle cx="7" cy="7" r="4.2" stroke="#0d5b47" stroke-width="1.3"/><path d="M10.2 10.2 14 14" stroke="#0d5b47" stroke-width="1.3" stroke-linecap="round"/></svg>' +
      '    <input class="cmdk-input" type="text" placeholder="会社名で探す／画面へ移動（例：ベルク、kincall）" autocomplete="off" />' +
      '    <span class="cmdk-esc">esc</span>' +
      '  </div>' +
      '  <div class="cmdk-list" id="cmdk-list"></div>' +
      '</div>';
    document.body.appendChild(root);
    const style = document.createElement("style");
    style.textContent =
      "#cmdk-root{position:fixed;inset:0;z-index:99999;display:none;}" +
      "#cmdk-root.on{display:block;}" +
      ".cmdk-back{position:absolute;inset:0;background:rgba(13,53,40,.28);backdrop-filter:blur(2px);}" +
      ".cmdk-panel{position:relative;max-width:560px;margin:12vh auto 0;background:#fff;border:1px solid #e6ece9;border-radius:14px;box-shadow:0 24px 60px -20px rgba(13,53,40,.5);overflow:hidden;font-family:inherit;}" +
      ".cmdk-inrow{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #eef3f0;}" +
      ".cmdk-input{flex:1;border:none;outline:none;font-size:15px;color:#0d5b47;background:transparent;}" +
      ".cmdk-esc{font-size:11px;color:#9bb0a7;border:1px solid #e6ece9;border-radius:6px;padding:1px 6px;}" +
      ".cmdk-list{max-height:52vh;overflow:auto;padding:6px;}" +
      ".cmdk-sec{font-size:11px;color:#9bb0a7;padding:8px 10px 4px;}" +
      ".cmdk-item{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;cursor:pointer;}" +
      ".cmdk-item.on{background:#eef7f2;}" +
      ".cmdk-ic{width:24px;height:24px;border-radius:7px;background:#eef7f2;display:flex;align-items:center;justify-content:center;color:#0d5b47;font-size:12px;flex:0 0 auto;}" +
      ".cmdk-t{font-size:14px;color:#173d31;}" +
      ".cmdk-h{font-size:12px;color:#7d968b;margin-left:auto;}" +
      ".cmdk-none{padding:14px;color:#7d968b;font-size:13px;}";
    document.head.appendChild(style);
    input = root.querySelector(".cmdk-input");
    listEl = root.querySelector("#cmdk-list");
    root.querySelector(".cmdk-back").addEventListener("click", close);
    input.addEventListener("input", () => render(input.value));
    input.addEventListener("keydown", onKey);
  }

  function render(word) {
    const w = norm(word);
    // 画面移動
    const navHits = (!w ? NAV : NAV.filter((n) => norm(n.label + n.kw).includes(w))).slice(0, 6);
    // 会社
    const coHits = !w ? [] : (companies || [])
      .filter((c) => norm(c.name).includes(w) || norm(c.rep).includes(w))
      .sort((a, b) => String(b.last).localeCompare(String(a.last)))
      .slice(0, 6);
    items = [];
    let html = "";
    if (coHits.length) {
      html += '<div class="cmdk-sec">会社（商談履歴へ）</div>';
      for (const c of coHits) {
        const idx = items.length;
        items.push({ href: "/history.html?company=" + encodeURIComponent(c.name) });
        html += `<div class="cmdk-item${idx === active ? " on" : ""}" data-i="${idx}">` +
          '<span class="cmdk-ic">🏢</span>' +
          `<span class="cmdk-t">${esc(c.name)}</span>` +
          `<span class="cmdk-h">${c.n}件${c.rep ? " ・ " + esc(c.rep) : ""}</span></div>`;
      }
    }
    if (navHits.length) {
      html += '<div class="cmdk-sec">画面へ移動</div>';
      for (const n of navHits) {
        const idx = items.length;
        items.push({ href: n.href });
        html += `<div class="cmdk-item${idx === active ? " on" : ""}" data-i="${idx}">` +
          '<span class="cmdk-ic">→</span>' +
          `<span class="cmdk-t">${esc(n.label)}</span>` +
          `<span class="cmdk-h">${esc(n.hint)}</span></div>`;
      }
    }
    if (!items.length) html = `<div class="cmdk-none">「${esc(word)}」に一致する会社・画面はありません。</div>`;
    listEl.innerHTML = html;
    if (active >= items.length) active = 0;
    listEl.querySelectorAll(".cmdk-item").forEach((el) => {
      el.addEventListener("mouseenter", () => { active = Number(el.dataset.i); paint(); });
      el.addEventListener("click", () => go(Number(el.dataset.i)));
    });
    paint();
  }
  function paint() {
    listEl.querySelectorAll(".cmdk-item").forEach((el) =>
      el.classList.toggle("on", Number(el.dataset.i) === active));
    const on = listEl.querySelector(".cmdk-item.on");
    if (on) on.scrollIntoView({ block: "nearest" });
  }
  function onKey(ev) {
    if (ev.key === "Escape") { close(); return; }
    if (ev.key === "ArrowDown") { ev.preventDefault(); active = Math.min(active + 1, items.length - 1); paint(); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); active = Math.max(active - 1, 0); paint(); }
    else if (ev.key === "Enter") { ev.preventDefault(); go(active); }
  }
  function go(i) { const it = items[i]; if (it && it.href) location.href = it.href; }

  function open() {
    if (!root) build();
    root.classList.add("on");
    active = 0;
    input.value = "";
    render("");
    setTimeout(() => input.focus(), 20);
    loadCompanies().then(() => { if (root.classList.contains("on")) render(input.value); });
  }
  function close() { if (root) root.classList.remove("on"); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  document.addEventListener("keydown", (ev) => {
    const k = (ev.key || "").toLowerCase();
    if ((ev.metaKey || ev.ctrlKey) && k === "k") { ev.preventDefault(); root && root.classList.contains("on") ? close() : open(); }
  });
  window.openCmdK = open;   // ボタン等からも開けるように
})();
