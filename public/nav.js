// 画面のどこかでつまずいたら、隅に小さく出す。
// 黙って止まると「押しても反応しない」に見えるため。
window.addEventListener("error", (e) => {
  try {
    let box = document.getElementById("kbErr");
    if (!box) {
      box = document.createElement("div");
      box.id = "kbErr";
      box.className = "kb-err";
      box.title = "画面の処理でつまずきました。開発メモに残すと直せます。";
      document.body.appendChild(box);
      box.addEventListener("click", () => box.remove());
    }
    box.textContent = "画面のエラー：" + String((e && e.message) || e).slice(0, 120);
  } catch {}
});

// いま動いている版を、画面の隅に小さく出す。
// 「直したのに変わらない」ときに、古い画面を見ているかどうかが分かる。
(function () {
  const ver = (document.querySelector('script[src*="?v="]') || {}).src || "";
  const m = ver.match(/\?v=([\w.-]+)/);
  if (!m) return;
  document.addEventListener("DOMContentLoaded", () => {
    const el = document.createElement("div");
    el.className = "kb-ver";
    el.textContent = "画面 " + m[1];
    el.title = "この画面のバージョン。古いままなら、Cmd/Ctrl + Shift + R で読み込み直してください。";
    document.body.appendChild(el);
  });
})();

// ロボに話しかける窓を、どの画面でも使えるように読み込む
(function () {
  if (!document.querySelector('script[src$="kbchat.js"]')) {
    const sc = document.createElement("script");
    sc.src = "kbchat.js?v=20260902ae";
    sc.defer = true;
    document.head.appendChild(sc);
  }
})();

// ───────────────────────────────────────────────────────────
// メニューの中身。パソコンのサイドバーもスマホのメニューも、ここから作る。
// 増えすぎた項目を6つにまとめ、深いものはカーソルを合わせると出るようにした。
// ───────────────────────────────────────────────────────────
const KB_MENU = [
  { href: "home.html", label: "ホーム", ico: "ico-home" },
  { href: "index.html", label: "レコーディング", ico: "ico-rec" },
  {
    href: "history.html", label: "商談履歴", ico: "ico-hist",
    subs: [
      { href: "history.html", label: "商談", desc: "会社ごとの履歴・判定・提案資料" },
      { href: "history.html?tab=follow", label: "ユーザーフォロー", desc: "フォロー面談の記録" },
      { href: "history.html?tab=internal", label: "社内MTG", desc: "社内の打ち合わせ" },
    ],
  },
  {
    href: "report.html", label: "分析", ico: "ico-ana",
    subs: [
      { href: "report.html", label: "全体レポート", desc: "受注率・温度感・進め方" },
      { href: "report.html?panel=interns", label: "インターンアポ", desc: "アポ獲得者ごとの実績" },
      { href: "style-analysis.html", label: "営業スタイル分析", desc: "話速・沈黙・被せ" },
    ],
  },
  {
    href: "sf-launch.html", label: "ツール", ico: "ico-tool",
    subs: [
      { href: "sf-launch.html", label: "商談立ち上げ", desc: "リードを探してコンバートする" },
      { href: "sf-launch.html?tab=pending", label: "立ち上げ待ち", desc: "自動で立ち上がらなかったもの" },
      { href: "sf-launch.html?tab=process", label: "プロセスシート", desc: "架電結果をシートに書き込む" },
      { href: "apo.html", label: "アポ振り分け", desc: "担当の自動割り振り・チーム実績" },
      { href: "docs.html", label: "資料トラッキング", desc: "送った資料の閲覧状況" },
      { href: "weekly.html", label: "天気予報", desc: "今週のテーマ・目標・施策と、金曜の振り返り" },
      { href: "dev.html", label: "開発メモ", desc: "直したいこと・自動で拾ったエラー" },
    ],
  },
  {
    href: "settings.html", label: "設定", ico: "ico-set",
    subs: [
      { href: "settings.html", label: "動作設定", desc: "録音・要約・自動入室" },
      { href: "settings.html?tab=integrations", label: "外部連携", desc: "Google・Salesforce・Chat通知" },
      { href: "settings.html?tab=members", label: "メンバー管理", desc: "クローザー・インサイドの登録" },
      { href: "settings.html?tab=ai", label: "AIの設定", desc: "自社ナレッジ・プロンプト" },
    ],
  },
];

// パソコンのサイドバーを組み立てる。
// 各ページに直接書いていたものを、ここでまとめて作るようにした。
function kbBuildSidebar() {
  const nav = document.querySelector(".sidebar");
  if (!nav || nav.dataset.kbBuilt) return;
  nav.dataset.kbBuilt = "1";

  const here = (location.pathname.split("/").pop() || "home.html") + location.search;
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // いまいるページが、その項目（またはその中身）かどうか
  const isHere = (m) => {
    const all = [m.href, ...(m.subs || []).map((x) => x.href)].filter(Boolean);
    return all.some((h) => h === here || h.split("?")[0] === here.split("?")[0]);
  };

  const foot = nav.querySelector(".side-foot");
  const html = KB_MENU.map((m) => {
    const on = isHere(m) ? " active" : "";
    const link =
      `<a class="side-item${on}" href="${esc(m.href)}">` +
      `<span class="side-ico ${esc(m.ico)}"></span>` +
      `<span class="side-label">${esc(m.label)}</span>` +
      (m.subs ? '<span class="side-arrow">›</span>' : "") + `</a>`;
    if (!m.subs) return `<div class="side-wrap">${link}</div>`;
    const subs = m.subs.map((x) =>
      `<a class="side-sub-item" href="${esc(x.href)}">` +
      `<span class="side-sub-t">${esc(x.label)}</span>` +
      `<span class="side-sub-d">${esc(x.desc || "")}</span></a>`).join("");
    return `<div class="side-wrap has-sub">${link}` +
      `<div class="side-sub"><div class="side-sub-head">${esc(m.label)}</div>${subs}</div></div>`;
  }).join("");

  // 設定の下に、kincall（架電ツール）の入り口を置く。
  // kinbotの機能とは別の道具なので、線で区切って分ける。
  const kcOn = /^\/kincall/.test(location.pathname) ? " active" : "";
  const aiOn = /ai\.html/.test(here) ? " active" : "";
  const apps =
    `<div class="side-sep"></div>` +
    `<a class="side-item side-app${kcOn}" href="/kincall">` +
    `<img class="side-app-ico" src="/kincall.svg" alt="" />` +
    `<span class="side-label">kincall</span></a>` +
    `<a class="side-item${aiOn}" href="ai.html">` +
    `<span class="side-ico ico-ai"></span>` +
    `<span class="side-label">AI社員</span></a>`;

  const brand = nav.querySelector(".side-brand");
  nav.innerHTML = (brand ? brand.outerHTML : "") + html + apps + (foot ? foot.outerHTML : "");
}

// public/nav.js — サイドバーのユーザー表示とログアウト
(async () => {
  try {
    const me = await (await fetch("/api/me")).json();
    const who = document.getElementById("who");
    if (who) {
      const name = me.name || me.username || "";
      who.textContent = name ? name + (me.admin ? "（管理者）" : "") : "";
      who.title = me.username || "";
      // 頭文字の丸アイコンを添える（パソコン表示のサイドバー下）
      const foot = who.parentElement;
      if (foot && !foot.querySelector(".side-avatar") && name) {
        const av = document.createElement("span");
        av.className = "side-avatar";
        av.setAttribute("aria-hidden", "true");
        av.textContent = String(name).trim().charAt(0).toUpperCase();
        foot.insertBefore(av, who);
      }
    }
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
// report.html?panel=interns（インターンアポ）は別メニュー扱いにする
(function() {
  const path = location.pathname;
  if (!/style-analysis|dashboard|report/.test(path)) return;
  const isInterns = new URLSearchParams(location.search).get("panel") === "interns";
  document.querySelectorAll('.side-item').forEach(a => {
    const href = a.getAttribute("href") || "";
    const forInterns = href.indexOf("panel=interns") >= 0;
    const forReport = href.indexOf("report.html") >= 0 && !forInterns;
    a.classList.toggle('active', isInterns ? forInterns : forReport);
  });
})();

// ===== スマホ用：下部タブバー中央の録音ボタン＆ボトムシート =====
window.kbIsMobile = function () {
  if (window.matchMedia) return window.matchMedia("(max-width: 760px)").matches;
  return (window.innerWidth || 1024) <= 760;
};

// 画面下から出てくるシート。html は中身のHTML文字列。
// 閉じるボタンには data-sheet-close を付ける。
window.kbSheet = function (html) {
  const back = document.createElement("div");
  back.className = "kb-sheet-back";
  back.innerHTML = `<div class="kb-sheet"><div class="kb-sheet-grip"></div>${html}</div>`;
  const close = () => {
    back.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  back.addEventListener("click", (e) => {
    if (e.target === back || e.target.closest("[data-sheet-close]")) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(back);
  return { el: back, close };
};

// スマホ：右上のメニューボタンから、行き先を選ぶ
(function () {
  const bar = document.querySelector(".sidebar");
  const topbar = document.querySelector(".topbar");
  if (!bar || !topbar || topbar.querySelector(".kb-menu-btn")) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "kb-menu-btn";
  btn.setAttribute("aria-label", "メニュー");
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  topbar.appendChild(btn);

  const here = (location.pathname.split("/").pop() || "home.html") + location.search;
  // パソコンのサイドバーと同じ内容を使う（下に平らに並べる）
  const items = [];
  for (const m of KB_MENU) {
    if (m.subs) for (const x of m.subs) items.push({ href: x.href, label: x.label, ico: m.ico });
    else items.push({ href: m.href, label: m.label, ico: m.ico });
  }
  // kinbotの機能とは別に、AI社員をいちばん下に置く（サイドバーのkincallの下に合わせる）
  items.push({ href: "ai.html", label: "AI社員", ico: "ico-ai" });

  const open = () => {
    if (document.querySelector(".kb-menu")) return;
    const who = (document.getElementById("who") || {}).textContent || "";
    const wrap = document.createElement("div");
    wrap.className = "kb-menu";
    wrap.innerHTML =
      `<div class="kb-menu-back"></div>
       <nav class="kb-menu-panel" aria-label="メニュー">
         <div class="kb-menu-head">
           <span class="kb-menu-who">${who ? who.replace(/[<>&]/g, "") : "kinbot"}</span>
           <button type="button" class="kb-menu-x" aria-label="閉じる">
             <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
           </button>
         </div>
         ${items.map((it) => {
           const on = here === it.href || (it.href === "home.html" && (here === "" || here === "home.html"));
           return `<a class="kb-menu-item${on ? " is-on" : ""}" href="${it.href}">
             <span class="side-ico ${it.ico}"></span><span>${it.label}</span>
           </a>`;
         }).join("")}
         <a class="kb-menu-item kb-menu-out" href="#" id="kbMenuLogout"><span>ログアウト</span></a>
       </nav>`;
    document.body.appendChild(wrap);
    document.body.style.overflow = "hidden";
    const close = () => { wrap.remove(); document.body.style.overflow = ""; };
    wrap.querySelector(".kb-menu-back").addEventListener("click", close);
    wrap.querySelector(".kb-menu-x").addEventListener("click", close);
    const out = wrap.querySelector("#kbMenuLogout");
    if (out) out.addEventListener("click", (e) => {
      e.preventDefault();
      const real = document.getElementById("logout");
      if (real) real.click(); else location.href = "/logout";
    });
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") { close(); document.removeEventListener("keydown", esc); }
    });
  };
  btn.addEventListener("click", open);

  // パソコンでは左のサイドバーに録音ボタンを出す（これまでどおり）
  if (!bar.querySelector(".side-fab")) {
    const a = document.createElement("a");
    a.className = "side-fab";
    a.href = "index.html";
    a.setAttribute("aria-label", "レコーディング");
    a.innerHTML = '<span class="side-ico ico-rec"></span>';
    if (here.startsWith("index.html")) a.classList.add("active");
    bar.appendChild(a);
  }
})();

// ===== 利用状況の記録（どの画面のどこが押されているか） =====
// 個人を責めるためではなく、使われていない機能を見つけて直すために使います。
(function () {
  if (!document.querySelector(".sidebar")) return; // ログイン画面などでは記録しない
  const page = (location.pathname.split("/").pop() || "home.html").replace(/\.html$/, "");
  let queue = [];
  let timer = null;

  const push = (kind, label) => {
    queue.push({ page, kind, label: String(label || "").slice(0, 120) });
    if (queue.length >= 20) flush();
    else if (!timer) timer = setTimeout(flush, 15000);
  };

  function flush(useBeacon) {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!queue.length) return;
    const body = JSON.stringify({ events: queue });
    queue = [];
    try {
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon("/api/usage", new Blob([body], { type: "application/json" }));
      } else {
        fetch("/api/usage", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
      }
    } catch {}
  }

  // 画面を開いた
  push("page", page);

  // 押された場所を拾う（入力欄の中身は記録しません）
  document.addEventListener("click", (ev) => {
    const el = ev.target && ev.target.closest
      ? ev.target.closest("a, button, [role=button], .rep-tab, .seg-btn, .side-item, .home-tg, .prod-tab, .set-menu-item, .home-rank-tab, .home-rank-round")
      : null;
    if (!el) return;
    if (el.closest("input, textarea, select")) return;
    const label =
      el.dataset.track ||
      el.getAttribute("aria-label") ||
      (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40) ||
      el.className;
    if (!label) return;
    push("click", label);
  }, true);

  window.addEventListener("pagehide", () => flush(true));
  document.addEventListener("visibilitychange", () => { if (document.hidden) flush(true); });
})();

// 数字をぱらぱらと増やす（スコアなど）
window.kbCountUp = function (el, to, ms) {
  if (!el) return;
  const target = Number(to);
  if (!isFinite(target)) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    el.textContent = String(target);
    return;
  }
  const dur = ms || 700;
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = String(Math.round(target * eased));
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = String(target);
  };
  el.textContent = "0";
  requestAnimationFrame(step);
};

// ===== 仕上げの動き（波紋・カーソルの光・サイドバーの目印） =====
(function () {
  const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  // ボタンを押したときの波紋
  document.addEventListener("click", (ev) => {
    const b = ev.target && ev.target.closest ? ev.target.closest(".btn") : null;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const size = Math.max(r.width, r.height);
    const el = document.createElement("span");
    el.className = "kb-ripple";
    el.style.width = el.style.height = size + "px";
    el.style.left = (ev.clientX - r.left - size / 2) + "px";
    el.style.top = (ev.clientY - r.top - size / 2) + "px";
    b.appendChild(el);
    setTimeout(() => el.remove(), 600);
  }, true);

  // サイドバーの選択位置に、すべるバーを置く
  function mountMarker() {
    const bar = document.querySelector(".sidebar");
    if (!bar || window.innerWidth <= 760) return;
    let mk = bar.querySelector(".side-marker");
    if (!mk) { mk = document.createElement("span"); mk.className = "side-marker"; bar.appendChild(mk); }
    const move = (el) => {
      if (!el) { mk.style.height = "0px"; return; }
      const br = bar.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      mk.style.top = (r.top - br.top + 6) + "px";
      mk.style.height = Math.max(0, r.height - 12) + "px";
    };
    move(bar.querySelector(".side-item.active"));
    bar.querySelectorAll(".side-item").forEach((a) => {
      a.addEventListener("mouseenter", () => move(a));
      a.addEventListener("mouseleave", () => move(bar.querySelector(".side-item.active")));
    });
    window.addEventListener("resize", () => move(bar.querySelector(".side-item.active")));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountMarker);
  else mountMarker();
})();

// 画面下から出て、すっと消える通知
window.kbToast = function (msg, kind) {
  if (!msg) return;
  let box = document.querySelector(".kb-toasts");
  if (!box) {
    box = document.createElement("div");
    box.className = "kb-toasts";
    document.body.appendChild(box);
  }
  const el = document.createElement("div");
  el.className = "kb-toast" + (kind === "error" ? " is-error" : "");
  el.textContent = String(msg);
  box.appendChild(el);
  setTimeout(() => {
    el.classList.add("is-out");
    setTimeout(() => el.remove(), 300);
  }, kind === "error" ? 5000 : 2600);
};

// サイドバーは、読み込みのできるだけ早い段階で組み立てる
try {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", kbBuildSidebar);
  } else {
    kbBuildSidebar();
  }
} catch (e) { console.warn("[nav] サイドバーを組み立てられませんでした", e.message); }
