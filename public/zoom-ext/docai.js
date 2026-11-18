// DOC の AI（次面談話）の管理画面：候補者のチャットを読んで kinXs に送る（2026-11-18 田中さん）
//   ・ふだん：「回答レビュー」を開いたら、その中身を自動で送る
//   ・右下の「kinXs に全部取り込む」：Bales のときのように、会社を自動で切りかえ、チャットを1件ずつ選んで回答レビューを読み、全部送る
//   管理画面は Streamlit で作られていて API が無く、読み込み直すとログインし直しになる。なので、ページを読み込み直さずに、
//   人と同じように「企業を選択」→ 表のチェック → 回答レビュー の順に画面を操作する。消す・変えるボタンは押さない
(function () {
  if (window.top !== window || window.__kbDocAi) return; window.__kbDocAi = true;
  const C = { deep: "#0d5b47", main: "#1d9e75", light: "#e8f5ef", line: "#5DCAA5" };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (t) => String(t || "").replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const ICO_OK = `<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><rect x="1" y="1" width="18" height="18" rx="6" fill="${C.main}"/><path d="M5.5 10.2l3 3 6-6.4" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const ICO_NG = `<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><rect x="1" y="1" width="18" height="18" rx="6" fill="#d9822b"/><rect x="9" y="5" width="2" height="7" rx="1" fill="#fff"/><circle cx="10" cy="14.6" r="1.2" fill="#fff"/></svg>`;
  const ICO_GO = `<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><rect x="1" y="1" width="18" height="18" rx="6" fill="${C.main}"/><path d="M6 6.5h8M6 10h8M6 13.5h5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>`;

  // ===== kinbot とのやりとり（拡張機能の裏側から送る。kinbot のログインのクッキーを使う）=====
  const kb = (path, method = "GET", body) => new Promise((resolve) => {
    try { chrome.runtime.sendMessage({ type: "kb-docai-api", path, method, body }, (r) => resolve(chrome.runtime.lastError || !r ? { ok: false, error: "拡張機能を読み込み直してください" } : r)); }
    catch { resolve({ ok: false, error: "拡張機能を読み込み直してください" }); }
  });

  // ===== 右下のお知らせ =====
  function toast(text, ok) {
    let el = document.getElementById("kbDocAiToast");
    if (!el) { el = document.createElement("div"); el.id = "kbDocAiToast"; el.style.cssText = `position:fixed;right:18px;bottom:64px;z-index:2147483000;display:flex;align-items:center;gap:8px;max-width:360px;background:#fff;border:1.5px solid ${C.line};border-radius:14px;padding:9px 14px;font:600 12.5px/1.5 system-ui,sans-serif;color:${C.deep};box-shadow:0 6px 20px rgba(13,91,71,.16);transition:opacity .4s`; (document.body || document.documentElement).appendChild(el); }
    el.style.borderColor = ok ? C.line : "#e7b37a"; el.style.color = ok ? C.deep : "#7a4310";
    el.innerHTML = `${ok ? ICO_OK : ICO_NG}<span>${text}</span>`; el.style.opacity = "1";
    clearTimeout(el._t); el._t = setTimeout(() => { el.style.opacity = "0"; }, ok ? 4000 : 9000);
  }

  // ===== 画面を読む =====
  // 折りたたみが閉じていると innerText は空になるので、文の塊（Markdown の箱）ごとに textContent で読む
  const BLK = '[data-testid="stMarkdownContainer"], [data-testid="stText"], [data-testid="stCode"], [data-testid="stChatMessage"]';
  function blockText(root) {
    const out = [];
    root.querySelectorAll(BLK).forEach((b) => {
      if (b.parentElement && b.parentElement.closest(BLK)) return;
      const lis = b.querySelectorAll("li");
      if (lis.length) lis.forEach((li) => out.push(`・${norm(li.textContent)}`)); else out.push(norm(b.textContent));
    });
    return out.filter(Boolean);
  }
  function selectBoxOf(word) { return [...document.querySelectorAll('[data-testid="stSelectbox"]')].find((x) => (x.textContent || "").includes(word)); }
  function companyNow() {
    const sel = selectBoxOf("企業を選択");
    // いまの Streamlit の選択欄は、文字を打てる欄（input role=combobox）に選んだ値が入っている（2026-11-18 画面の作りを見て直した）
    const inp = sel && sel.querySelector('input[role="combobox"], input');
    const v = sel && sel.querySelector('[data-baseweb="select"]');
    const t = inp && inp.value ? norm(inp.value) : v ? norm(v.textContent) : "";
    const m = t.match(/[a-z0-9_-]{3,}/i);
    return m ? m[0].toLowerCase() : (new URLSearchParams(location.search).get("company") || "").toLowerCase();
  }
  // いま見えているタブの中身（Streamlit のタブは、見えていない方も画面の中に残っている）
  const PANELS = '[data-testid="stTabPanel"], [role="tabpanel"]';
  function activePanel() { return [...document.querySelectorAll(PANELS)].find((p) => !p.hidden && p.offsetParent !== null && (p.textContent || "").includes("回答レビュー")) || null; }
  function reviewLabel(root) { const t = (root || document.body).textContent || ""; return ((t.match(/セッション\s*[:：]\s*([0-9a-f]{6,}[0-9a-f-]*)/i) || [])[1] || "").toLowerCase(); }
  function readReview(root) {
    root = root || document.body;
    const label = reviewLabel(root); if (!label) return null;
    let profile = { title: "", lines: [] }; const qa = [];
    for (const ex of root.querySelectorAll('[data-testid="stExpander"]')) {
      const sum = ex.querySelector("summary") || ex;
      const title = norm((sum.querySelector('[data-testid="stMarkdownContainer"]') || sum).textContent);
      const body = ex.querySelector('[data-testid="stExpanderDetails"]') || ex;
      const lines = blockText(body).filter((l) => l !== title);
      // 題の前にアイコンの文字（絵文字や「chat」など）が付くので、「質問1:」は題のどこにあっても拾う（2026-11-18 質問が0件だった）
      const qm = title.match(/質問\s*\d+\s*[:：]\s*([\s\S]*)$/);
      // 中身：文の塊に加えて、書きかえ用の欄（textarea）に入っている答えも読む
      const tas = [...body.querySelectorAll("textarea")].map((x) => norm(x.value)).filter(Boolean);
      if (/プロフィール/.test(title)) profile = { title, lines };
      else if (qm) qa.push({ q: norm(qm[1]).replace(/[.…]+$/, ""), a: "" });   // 答えは入れない（田中さん「一旦いらない」）
    }
    const all = root.innerText || root.textContent || ""; const i = all.indexOf("回答レビュー");
    return { company: companyNow(), sessionId: "", sessionLabel: label, profile, qa, raw: i >= 0 ? all.slice(i, i + 30000) : all.slice(0, 30000), url: location.href.split("#")[0] };
  }
  async function send(d) {
    if (!d || (!d.qa.length && !d.profile.lines.length)) return { ok: false, error: "中身が読めませんでした" };
    if (!d.company) return { ok: false, error: "どの企業か分かりませんでした" };
    return kb("/api/kinxs/docai/capture", "POST", d);
  }

  // ===== ふだん：回答レビューを開いたら送る =====
  const sent = new Set(); let timer = null; let crawling = false;
  async function passive() {
    if (crawling) return;
    const body = document.body ? document.body.innerText || "" : "";
    if (!/回答レビュー/.test(body) || !/セッション\s*[:：]/.test(body)) return;
    const d = readReview(activePanel() || document.body); if (!d) return;
    const sig = JSON.stringify([d.company, d.sessionLabel, d.qa.map((x) => x.q + x.a.length), d.profile.lines.length]);
    if (sent.has(sig)) return; sent.add(sig);
    const r = await send(d);
    if (r.ok) toast(`kinXs に保存しました（${r.company}・質問 ${r.questions} 件）`, true);
    else { toast(`kinbot：保存できませんでした。${r.error || ""}`, false); sent.delete(sig); }
  }

  // ===== 自動で回る =====
  // 画面の書きかえが落ち着くまで待つ（Streamlit は押すたびに作り直す）
  function quiet(ms = 1200, max = 20000) {
    return new Promise((resolve) => {
      let t = null; const t0 = Date.now();
      const done = () => { ob.disconnect(); clearTimeout(t); clearInterval(iv); resolve(); };
      const arm = () => { clearTimeout(t); t = setTimeout(() => { if (running()) arm(); else done(); }, ms); };
      const ob = new MutationObserver(arm); ob.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
      const iv = setInterval(() => { if (Date.now() - t0 > max) done(); }, 500);
      arm();
    });
  }
  // 「動いています」の印が出ている間は待つ
  const running = () => { const w = document.querySelector('[data-testid="stStatusWidget"]'); return !!(w && /Running|実行中|Stop/i.test(w.textContent || "")); };
  // 人がクリックしたのと同じ並びで、押す・離すを送る
  function press(el, x, y) {
    if (!el) return false;
    const r = el.getBoundingClientRect(); const cx = x !== undefined ? x : r.left + r.width / 2; const cy = y !== undefined ? y : r.top + r.height / 2;
    const o = { bubbles: true, cancelable: true, composed: true, clientX: cx, clientY: cy, button: 0, buttons: 1, pointerId: 1, pointerType: "mouse", isPrimary: true, view: window };
    el.dispatchEvent(new PointerEvent("pointerdown", o)); el.dispatchEvent(new MouseEvent("mousedown", o));
    el.dispatchEvent(new PointerEvent("pointerup", { ...o, buttons: 0 })); el.dispatchEvent(new MouseEvent("mouseup", { ...o, buttons: 0 })); el.dispatchEvent(new MouseEvent("click", { ...o, buttons: 0 }));
    return true;
  }
  // タブは data-testid="stTab"（role="tab" ではなかった）
  const tabBtn = (word) => [...document.querySelectorAll('[data-testid="stTab"], button[role="tab"]')].find((b) => (b.textContent || "").includes(word));
  async function openTab(word) { const b = tabBtn(word); if (!b) return false; if (b.getAttribute("aria-selected") !== "true") { press(b); await sleep(600); } return true; }
  // 左のメニューの「チャット管理」へ（ページは読み込み直さない）
  async function goChatPage() {
    if (tabBtn("チャットセッション")) return true;
    const a = [...document.querySelectorAll('a[href*="chat_curator"], [data-testid="stSidebarNavLink"]')].find((x) => /chat_curator/.test(x.getAttribute("href") || "") || /チャット管理/.test(x.textContent || ""));
    if (!a) return false; a.click(); await quiet(1500); return !!tabBtn("チャットセッション");
  }
  // 「企業を選択」を切りかえる：開く → 名前を打って絞る → 選ぶ
  async function selectCompany(co) {
    if (companyNow() === co) return true;
    const box = selectBoxOf("企業を選択"); if (!box) return false;
    const inp = box.querySelector('input[role="combobox"], input');
    const ctl = box.querySelector('[role="group"]') || inp;
    press(ctl); if (inp) { press(inp); inp.focus(); } await sleep(400);
    // 名前を打って候補を絞る（会社が多いと、見えている候補しか画面に無いため）
    if (inp) { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(inp, co); inp.dispatchEvent(new Event("input", { bubbles: true })); await sleep(700); }
    const opts = [...document.querySelectorAll('[role="option"], [data-baseweb="menu"] li, [role="listbox"] li')];
    const hit = opts.find((o) => norm(o.textContent).toLowerCase() === co) || opts.find((o) => norm(o.textContent).toLowerCase().includes(co));
    if (!hit) { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); if (inp) inp.blur(); return false; }
    press(hit); hit.click && hit.click();
    await sleep(800); await quiet(1500);
    return companyNow() === co;
  }
  // チャットの一覧の表（キャンバスで描かれている）。行の高さ・見出しの高さは Streamlit の決まり（35px）
  const ROW = 35, HEAD = 35;
  function grid() {
    // 画面に見えている表を使う（ほかのタブにも表があり、見えていない表を選ぶと押せない・2026-11-18）
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 50 && r.height > 50; };
    const all = [...document.querySelectorAll('[data-testid="stDataFrame"], [data-testid="stDataEditor"]')].filter(vis);
    const g = all.find((x) => { const p = x.closest(PANELS); return p && (p.textContent || "").includes("セッションが見つかりました"); }) || all[0];
    if (!g) return null;
    const sc = g.querySelector(".dvn-scroller") || g.querySelector('[class*="scroller"]');
    const cvs = [...g.querySelectorAll("canvas")]; const cv = g.querySelector('[data-testid="data-grid-canvas"]') || cvs[0];
    // 見出しの高さ：見出し用のキャンバス（2つめ・高さ36くらい）があればその高さ
    const hc = cvs.find((c) => c !== cv && c.getBoundingClientRect().height > 20 && c.getBoundingClientRect().height < 60);
    return { g, sc, cv, head: hc ? hc.getBoundingClientRect().height : HEAD };
  }
  // 表の文字は、目に見えない読み上げ用の表（glide-cell-列-行）にも入っている。1列目がセッションID（頭だけ）
  const rowId = (i) => { const c = document.querySelector(`[data-testid="glide-cell-1-${i}"]`); return c ? norm(c.textContent).replace(/[.…]+$/, "").toLowerCase() : ""; };
  const totalRows = () => { const m = (document.body.innerText || "").match(/(\d+)\s*件のセッションが見つかりました/); return m ? Number(m[1]) : 0; };
  // 表の i 行目のチェック（左端）を押す。見えていなければ表を動かしてから押す
  async function toggleRow(i, how) {
    const G = grid(); if (!G || !G.cv) return false;
    if (G.sc) { const want = Math.max(0, (i - 3) * ROW); if (Math.abs(G.sc.scrollTop - want) > ROW * 2 || G.sc.scrollTop > i * ROW) { G.sc.scrollTop = want; G.sc.dispatchEvent(new Event("scroll", { bubbles: true })); await sleep(350); } }
    if (how === "peek") return true;
    const base = (G.sc || G.cv).getBoundingClientRect(); const top = G.sc ? G.sc.scrollTop : 0;
    const x = base.left + 16; const y = base.top + G.head + i * ROW - top + ROW / 2;
    if (y > base.bottom - 4) return false;
    // 表は、上にかぶさっている「動かす枠」（.dvn-scroller）で押されたことを受け取る
    const el = how === "scroller" ? (G.sc || G.cv) : document.elementFromPoint(x, y);
    return press(el, x, y);
  }
  // 1件読む：行を押す → 回答レビューが変わるのを待つ → 読む → 送る → 行をもう一度押して外す
  let how = "point";
  async function readRow(i, prevLabel) {
    await openTab("チャットセッション");
    if (!(await toggleRow(i, how))) return { skip: true };
    await sleep(400); await quiet(1200);
    let label = reviewLabel(document.body);
    // 押した行のセッションID（表の文字）と、回答レビューのセッションが合えば成功（前と同じチャットでも）
    const want = rowId(i).slice(0, 8); const okRow = () => !!label && (want ? label.slice(0, 8) === want : label !== prevLabel);
    if (!okRow()) {
      // 押し方を変えてもう一度（キャンバスへ直接）
      if (how === "point") { how = "scroller"; await toggleRow(i, how); await sleep(400); await quiet(1200); label = reviewLabel(document.body); if (!okRow()) how = "point"; }
      if (!okRow()) return { fail: true };
    }
    await openTab("回答レビュー"); await sleep(300);
    // AI の答えは、いまは要らない（2026-11-18 田中さん「AIの答えは一旦いらない」）。質問の題だけなら折りたたみを開かずに読めるので速い
    const d = readReview(activePanel() || document.body);
    const r = d ? await send(d) : { ok: false, error: "読めませんでした" };
    await openTab("チャットセッション");
    await toggleRow(i, how); await sleep(300); await quiet(1000);
    return { label, r };
  }
  // 画面の作りを kinbot に送る（直すため。候補者の文は送らない）
  async function diag(why) {
    const G = grid();
    const outline = (el, depth = 0) => { if (!el || depth > 7) return ""; const tid = el.getAttribute && el.getAttribute("data-testid"); const role = el.getAttribute && el.getAttribute("role"); const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || "").split(/\s+/).filter((c) => /dvn|gdg|scroller|glide|st/.test(c)).slice(0, 3).join("."); const r = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 0, height: 0 };
      return `${"  ".repeat(depth)}<${el.tagName.toLowerCase()}${tid ? ` tid=${tid}` : ""}${role ? ` role=${role}` : ""}${cls ? ` .${cls}` : ""} ${Math.round(r.width)}x${Math.round(r.height)}${el.scrollHeight > el.clientHeight + 5 ? ` scroll=${el.scrollTop}/${el.scrollHeight}` : ""}>\n${[...el.children].slice(0, 12).map((c) => outline(c, depth + 1)).join("")}`; };
    const testids = [...new Set([...document.querySelectorAll("[data-testid]")].map((e) => e.getAttribute("data-testid")))];
    const tabs = [...document.querySelectorAll('[data-testid="stTab"], button[role="tab"]')].map((b) => `${norm(b.textContent)}:${b.getAttribute("aria-selected")}`);
    const sb = selectBoxOf("企業を選択");
    await kb("/api/kinxs/docai/diag", "POST", { why, ver: (() => { try { return chrome.runtime.getManifest().version; } catch { return ""; } })(), href: location.pathname, company: companyNow(), rows: totalRows(), how, cells: [0, 1, 2, 3].map(rowId), label: reviewLabel(document.body), head: G ? G.head : 0, tabAttrs: [...document.querySelectorAll('[data-testid="stTab"]')].slice(0, 6).map((b) => `${b.tagName}:${b.getAttribute("role")}:${b.getAttribute("aria-selected")}`), testids, tabs, grid: G ? outline(G.g) : "（表が見つからない）", select: sb ? outline(sb) : "（企業を選択が見つからない）", options: [...document.querySelectorAll('[role="option"]')].slice(0, 5).map((o) => norm(o.textContent).slice(0, 30)) });
  }

  // ===== 右下のボタンと窓 =====
  const btn = document.createElement("button"); btn.type = "button"; btn.id = "kbDocAiBtn";
  btn.style.cssText = `position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:6px;border:1.5px solid ${C.line};background:#fff;color:${C.deep};font:700 12.5px system-ui,sans-serif;border-radius:999px;padding:8px 14px;box-shadow:0 4px 14px rgba(13,91,71,.15);cursor:pointer`;
  btn.innerHTML = `${ICO_GO}<span>kinXs に全部取り込む</span>`;
  const box = document.createElement("div"); box.id = "kbDocAiBox"; box.hidden = true;
  box.style.cssText = `position:fixed;right:18px;bottom:64px;z-index:2147483000;width:340px;background:#fff;border:1.5px solid ${C.line};border-radius:14px;box-shadow:0 8px 28px rgba(13,91,71,.18);padding:14px;font:13px/1.6 system-ui,sans-serif;color:#1f2d29`;
  const mount = () => { if (!document.body) return setTimeout(mount, 300); document.body.appendChild(btn); document.body.appendChild(box); };
  mount();
  let stop = false;
  const show = (html) => { box.innerHTML = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px"><b style="color:${C.deep}">kinXs に取り込む</b><button type="button" data-x style="margin-left:auto;border:0;background:none;font-size:16px;color:#5b6b66;cursor:pointer">×</button></div>${html}`; box.querySelector("[data-x]").onclick = () => { box.hidden = true; }; };
  const bar = (p) => `<div style="height:7px;background:${C.light};border-radius:4px;overflow:hidden;margin:8px 0"><i style="display:block;height:7px;width:${Math.round(p * 100)}%;background:${C.main}"></i></div>`;
  btn.onclick = async () => {
    if (!box.hidden && !crawling) { box.hidden = true; return; }
    box.hidden = false; if (crawling) return;
    show(`<div style="color:#5b6b66">会社の一覧を kinbot から読んでいます…</div>`);
    const r = await kb("/api/kinxs/docai/companies");
    if (!r.ok) { show(`<div style="color:#7a4310">${r.error || "読めませんでした"}</div>`); return; }
    const cos = r.companies || []; const cur = companyNow(); const fresh = cos.filter((c) => !c.known.length).length;
    // 会社は「まだ1件も読んでいない会社 → 前に読んだのが古い会社」の順（kinbot が並べて返す）。何社読むかを決めて、上から読む
    const L = (t) => `<label style="display:flex;gap:6px;align-items:flex-start;font-size:12.5px;margin-top:4px">${t}</label>`;
    show(`<div style="color:#5b6b66;font-size:12px">kinXs で「AI 候補者画面」の URL が入っている会社：${cos.length}社（まだ読んでいない会社 ${fresh}社）</div>
      <div style="font-weight:700;font-size:12.5px;margin-top:10px;color:${C.deep}">どの会社を読むか</div>
      ${L(`<input type="radio" name="kbda" value="n" checked style="margin-top:3px"> <span>まだ読んでいない会社から <input type="number" data-n min="1" max="${cos.length}" value="${Math.min(10, cos.length)}" style="width:52px;border:1px solid #cfe6dc;border-radius:6px;padding:1px 4px"> 社</span>`)}
      ${L(`<input type="radio" name="kbda" value="cur" style="margin-top:3px"> <span>いま選んでいる会社だけ（${cur || "未選択"}）</span>`)}
      <div style="font-weight:700;font-size:12.5px;margin-top:10px;color:${C.deep}">1社の中で、どのチャットを読むか</div>
      ${L(`<input type="radio" name="kbdm" value="new" checked style="margin-top:3px"> <span>前回の続きだけ<br><small style="color:#5b6b66">一覧の新しい方から読み、前に読んだチャットまで来たら次の会社へ（速い）</small></span>`)}
      ${L(`<input type="radio" name="kbdm" value="all" style="margin-top:3px"> <span>全部読み直す<br><small style="color:#5b6b66">前に読んだチャットも読む（時間がかかる）</small></span>`)}
      <button type="button" data-go style="margin-top:10px;width:100%;border:0;border-radius:10px;background:${C.main};color:#fff;font-weight:700;padding:9px;cursor:pointer">取り込みを始める</button>
      <div style="color:#5b6b66;font-size:11.5px;margin-top:6px">画面を自動で操作します。終わるまで、このタブはさわらずに置いておいてください（ほかのタブは使えます）。1社で1〜3分ほどかかります。</div>`);
    box.querySelector("[data-go]").onclick = () => {
      const mode = box.querySelector('input[name="kbda"]:checked').value; const n = Math.max(1, Math.min(cos.length, Number(box.querySelector("[data-n]").value) || 10));
      const onlyNew = box.querySelector('input[name="kbdm"]:checked').value === "new";
      crawl(mode === "cur" ? [{ company: cur, name: cur, known: (cos.find((c) => c.company === cur) || {}).known || [] }] : cos.slice(0, n), onlyNew);
    };
  };
  async function crawl(list, onlyNew) {
    crawling = true; stop = false; let saved = 0, skipped = 0, failed = 0; const log = [];
    const paint = (i, msg) => { show(`<div style="font-size:12px;color:#5b6b66">${i}/${list.length}社　保存 ${saved}件・とばした会社 ${skipped}</div>${bar(list.length ? i / list.length : 0)}<div style="font-size:12.5px">${msg}</div><button type="button" data-stop style="margin-top:8px;border:1px solid #e7b37a;background:#fff;color:#7a4310;border-radius:9px;padding:5px 12px;cursor:pointer">止める</button>${log.length ? `<div style="font-size:11.5px;color:#7a4310;margin-top:6px;max-height:90px;overflow:auto">${log.slice(-6).join("<br>")}</div>` : ""}`); const s = box.querySelector("[data-stop]"); if (s) s.onclick = () => { stop = true; s.disabled = true; s.textContent = "止めています…"; }; };
    try {
      if (!(await goChatPage())) { await diag("チャット管理のページへ行けない"); throw new Error("チャット管理のページが見つかりませんでした（左のメニューの「チャット管理」を開いてから押してください）"); }
      for (let ci = 0; ci < list.length && !stop; ci++) {
        const c = list[ci]; const known = new Set((c.known || []).map((k) => String(k).slice(0, 8)));
        paint(ci, `${c.name || c.company}（${c.company}）を開いています…`);
        if (!(await selectCompany(c.company))) { skipped++; log.push(`${c.company}：「企業を選択」にありませんでした`); if (ci === 0 && list.length === 1) await diag("企業を選択で選べない"); continue; }
        await openTab("チャットセッション"); await quiet(1200);
        const n = Math.min(totalRows(), 300);
        let prev = reviewLabel(document.body); let failRow = 0;
        for (let i = 0; i < n && !stop; i++) {
          paint(ci, `${c.name || c.company}：${i + 1}/${n} 件目を読んでいます`);
          if (onlyNew && i > 0) { await toggleRow(i, "peek"); const rid = rowId(i); if (rid && known.has(rid.slice(0, 8))) break; }
          const r = await readRow(i, prev);
          if (r.skip) { if (i === 0) { log.push(`${c.company}：チャットの表が見つかりませんでした`); await diag("表が見つからない・押せない"); } break; }
          if (r.fail) { failRow++; failed++; if (failRow >= 2) { log.push(`${c.company}：表のチェックを押せませんでした`); await diag("表の行を選べない"); break; } continue; }
          prev = r.label;
          if (r.r && r.r.ok) saved++; else log.push(`${c.company} ${r.label.slice(0, 8)}：${(r.r && r.r.error) || "送れませんでした"}`);
          if (onlyNew && known.has(r.label.slice(0, 8))) break;   // 前に読んだチャットまで来た（一覧は新しい順）
        }
      }
      show(`<div style="color:${C.deep};font-weight:700">${stop ? "止めました" : "終わりました"}</div><div style="font-size:12.5px;margin-top:4px">保存 ${saved}件・とばした会社 ${skipped}社${failed ? `・読めなかった行 ${failed}` : ""}</div>${log.length ? `<div style="font-size:11.5px;color:#7a4310;margin-top:6px;max-height:120px;overflow:auto">${log.slice(-10).join("<br>")}</div>` : ""}<div style="font-size:11.5px;color:#5b6b66;margin-top:6px">kinXs の「DOC連携 → 候補者の質問」で見られます。</div>`);
    } catch (e) { show(`<div style="color:#7a4310">${e.message}</div>`); }
    finally { crawling = false; }
  }

  // Streamlit は画面をあとから書きかえるので、変化が落ち着いてから読む
  const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(passive, 1800); });
  const start = () => { if (!document.body) return setTimeout(start, 300); obs.observe(document.body, { childList: true, subtree: true, characterData: true }); timer = setTimeout(passive, 2500); };
  start();
})();
