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
  async function openTab(word) {
    for (let k = 0; k < 3; k++) {
      const b = tabBtn(word); if (!b) return false;
      const sel = () => (tabBtn(word) || b).getAttribute("aria-selected") === "true";
      if (sel()) return true;
      // タブは DIV（role=tab）。押す・離す・クリックを送り、だめなら中の文字のところでも押す
      press(b); await sleep(300); if (sel()) { await sleep(300); return true; }
      try { b.click(); } catch {} const inner = b.querySelector("p, span, div"); if (inner) press(inner);
      await sleep(500); if (sel()) return true;
    }
    return false;
  }
  // 右の画面の題（「株式会社〇〇 チャット管理」）から、いま右に出ている会社の名前を読む
  function mainTitle() { const h = [...document.querySelectorAll("h1, h2")].map((e) => norm(e.textContent)).find((t) => /チャット管理$/.test(t)); return h ? h.replace(/\s*チャット管理$/, "").replace(/^[^\p{L}\p{N}]+/u, "") : ""; }
  const nameKey = (t) => String(t || "").normalize("NFKC").replace(/株式会社|（株）|\(株\)|有限会社|合同会社|一般社団法人|社会福祉法人|医療法人|[\s　・．.]/g, "").toLowerCase();
  // 会社の名前（kinXs）と右の題が合っているか。名前が無いときは、前の会社の題から変わったかで見る
  let prevTitle = "";
  function titleOk(c, prev) {
    const t = nameKey(mainTitle()); if (!t) return false;
    const n = nameKey(c.name);
    if (n && n.length >= 2) return t.includes(n) || n.includes(t);
    return !prev || t !== nameKey(prev);
  }
  // 左のメニューの「チャット管理」へ（ページは読み込み直さない）。force のときは、いま開いていても開き直す
  async function goChatPage(force) {
    if (!force && tabBtn("チャットセッション")) return true;
    const links = [...document.querySelectorAll('a[href], [data-testid="stSidebarNavLink"]')];
    const a = links.find((x) => /chat_curator/.test(x.getAttribute("href") || "") || /チャット管理/.test(x.textContent || ""));
    if (!a) return false;
    // 会社を切りかえたあとは、いったん別のページを開いてから「チャット管理」を開き直す（田中さん「別のタブ押してチャット管理おした方がいいかも」）。
    //   同じページのままだと、右の画面が前の会社のまま残ることがあったため。別のページは、見るだけのダッシュボード（なければヘルプ）
    if (force) {
      const other = links.find((x) => x !== a && /ダッシュボード/.test(x.textContent || "")) || links.find((x) => x !== a && /ヘルプ|サービス案内/.test(x.textContent || ""));
      if (other) { other.click(); await sleep(600); await quiet(1500); }
    }
    a.click(); await sleep(600); await quiet(1500); return !!tabBtn("チャットセッション");
  }
  // 「企業を選択」を切りかえる：開く → 名前を打って絞る → 選ぶ
  // どの場面で URL・右の題・左の会社が変わったかを残す（2026-11-18：2社目で前の会社にもどる原因を見るため）
  const trace = []; const tr = (step) => { if (trace.length < 400) trace.push({ t: Math.round(performance.now()), step, url: location.search.slice(0, 120), title: mainTitle().slice(0, 30), side: companyNow() }); };
  // チャット管理の「更新」ボタン。会社を切りかえたあと、表の中身（前の会社の一覧）が残っていて、
  //   行を押すと前の会社のチャットが選ばれていた（2026-11-18 足あと：2社目の行0を押すと、右が1社目にもどる）。押して一覧を作り直してもらう
  async function clickRefresh() {
    const b = [...document.querySelectorAll('[data-testid="stButton"] button, button')].find((x) => /更新/.test(x.textContent || "") && x.offsetParent !== null && !x.closest("#kbDocAiBox"));
    if (!b) return false; press(b); await sleep(500); await quiet(1500); tr("更新を押した"); return true;
  }
  let lastSel = { typed: "", seen: [] };
  // 管理画面は、アドレス（URL）の ?company= と ?session_id= を見て右の画面を作っている。行を選ぶとその会社・チャットが URL に入り、
  //   左で会社を切りかえても URL の方が勝って、右が前の会社のままになっていた（2026-11-18 診断：回答レビューのチャットがずっと同じだった）。
  //   読み込み直さずに URL だけを書きかえておくと、次に画面が動いたときに Streamlit がそれを読む
  // 2026-11-18 田中さん：URL の書きかえはやめる（手でやるときは書きかえない）。別のページを開いてチャット管理にもどると、URL もきれいになる
  function setUrlCompany() {}
  async function selectCompany(co) {
    setUrlCompany(co);
    if (companyNow() === co) return true;
    const box = selectBoxOf("企業を選択"); if (!box) return false;
    const inp = box.querySelector('input[role="combobox"], input');
    const ctl = box.querySelector('[role="group"]') || inp;
    press(ctl); if (inp) { press(inp); inp.focus(); } await sleep(400);
    // 名前を打って候補を絞る（会社が多いと、見えている候補しか画面に無いため）。
    //   ふつうに打ったのと同じ動きになる insertText を先に使い、だめなら値を直接入れる（2026-11-18：一部の会社しか選べなかった）
    if (inp) {
      inp.select && inp.select();
      let typed = false; try { typed = document.execCommand("insertText", false, co); } catch {}
      if (!typed || inp.value !== co) { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(inp, co); inp.dispatchEvent(new Event("input", { bubbles: true })); }
      await sleep(800);
    }
    const optsNow = () => [...document.querySelectorAll('[role="option"], [data-baseweb="menu"] li, [role="listbox"] li')];
    const find = () => { const os = optsNow(); return os.find((o) => norm(o.textContent).toLowerCase() === co) || os.find((o) => norm(o.textContent).toLowerCase().includes(co)); };
    let hit = find();
    // まだ見つからなければ、候補の一覧を下へ送りながら探す（一覧は見えている分しか画面に無い）
    if (!hit) {
      const lb = document.querySelector('[role="listbox"]'); const sc = lb && ([lb, ...lb.querySelectorAll("div")].find((e) => e.scrollHeight > e.clientHeight + 10) || lb);
      for (let k = 0; sc && k < 60 && !hit; k++) { const before = sc.scrollTop; sc.scrollTop += Math.max(100, sc.clientHeight - 40); sc.dispatchEvent(new Event("scroll", { bubbles: true })); await sleep(150); hit = find(); if (sc.scrollTop === before) break; }
    }
    lastSel = { typed: inp ? inp.value : "", seen: optsNow().slice(0, 8).map((o) => norm(o.textContent).slice(0, 30)) };
    if (!hit) { if (inp) inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); if (inp) inp.blur(); await sleep(300); return false; }
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
  const totalRows = () => { const m = (document.body.innerText || "").match(/(\d+)\s*件のセッションが見つかりました/) || (document.body.textContent || "").match(/(\d+)\s*件のセッションが見つかりました/); return m ? Number(m[1]) : 0; };
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
  async function readRow(i, prevLabel, co) {
    await openTab("チャットセッション");
    // 行を押すと管理画面は URL を読み直すので、押す前に URL の会社をいまの会社にそろえておく（前の会社のチャットの ID が残っていると、前の会社にもどる）
    if (co) setUrlCompany(co);
    tr(`行${i}を押す前`);
    if (!(await toggleRow(i, how))) return { skip: true };
    await sleep(400); await quiet(1200);
    tr(`行${i}を押したあと`);
    let label = reviewLabel(document.body);
    // 押した行のセッションID（表の文字）と、回答レビューのセッションが合えば成功（前と同じチャットでも）
    const want = rowId(i).slice(0, 8); const okRow = () => !!label && (want ? label.slice(0, 8) === want : label !== prevLabel);
    if (!okRow()) {
      // 押し方を変えてもう一度（キャンバスへ直接）
      if (how === "point") { how = "scroller"; await toggleRow(i, how); await sleep(400); await quiet(1200); label = reviewLabel(document.body); if (!okRow()) how = "point"; }
      if (!okRow()) return { fail: true };
    }
    const tabOk = await openTab("回答レビュー"); await sleep(300); tr(`回答レビュー${tabOk ? "を開いた" : "が開けない"}`);
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
      <div style="color:#5b6b66;font-size:11.5px;margin-top:6px">会社ごとにページを開き直して読みます（ログインはそのまま）。終わるまで、このタブはさわらずに置いておいてください（ほかのタブは使えます）。1社で1〜3分ほどかかります。</div>`);
    box.querySelector("[data-go]").onclick = () => {
      const mode = box.querySelector('input[name="kbda"]:checked').value; const n = Math.max(1, Math.min(cos.length, Number(box.querySelector("[data-n]").value) || 10));
      const onlyNew = box.querySelector('input[name="kbdm"]:checked').value === "new";
      crawl(mode === "cur" ? [{ company: cur, name: (cos.find((c) => c.company === cur) || {}).name || "", known: (cos.find((c) => c.company === cur) || {}).known || [] }] : cos.slice(0, n), onlyNew);
    };
  };
  // ===== 1社ずつ、URL（chat_curator?company=企業ID）で開き直して読む（2026-11-18 田中さん「＝もその企業のIDにかえてもらえばいいかな」）=====
  //   画面の中で会社を切りかえると、行を選んだ瞬間に前の会社にもどる（管理画面の動き・手でも同じ）。
  //   なので会社ごとにページを開き直す。ページが変わると拡張機能の中身も消えるので、進み具合は chrome.storage に置いて、開いたページで続きをする
  const RUN = "kbDocAiRun";
  const getRun = () => new Promise((r) => { try { chrome.storage.local.get([RUN], (st) => r((st && st[RUN]) || null)); } catch { r(null); } });
  const setRun = (v) => new Promise((r) => { try { chrome.storage.local.set({ [RUN]: v }, () => r()); } catch { r(); } });
  const delRun = () => new Promise((r) => { try { chrome.storage.local.remove([RUN], () => r()); } catch { r(); } });
  const openCompany = (co) => { location.assign(`${location.origin}/chat_curator?company=${encodeURIComponent(co)}`); };
  const isLogin = () => { const t = document.body ? document.body.innerText || "" : ""; return /パスワード/.test(t) && /ログイン/.test(t) && !/チャット管理|ダッシュボード/.test(t); };
  async function crawl(list, onlyNew) {
    if (!list.length) return;
    await setRun({ list, i: 0, onlyNew, saved: 0, skipped: 0, failed: 0, log: [], results: [], tries: 0, started: Date.now(), stop: false });
    show(`<div style="font-size:12.5px">${esc0(list[0].name || list[0].company)} を開きます…</div>`);
    openCompany(list[0].company);
  }
  const esc0 = (t) => String(t || "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  // ページを開いたら、続きがあるかを見る
  async function resume() {
    const run = await getRun(); if (!run || !Array.isArray(run.list)) return;
    if (Date.now() - (run.at || run.started) > 30 * 60 * 1000) { await delRun(); return; }   // 30分さわっていない取り込みは、もう続けない
    crawling = true; box.hidden = false;
    const c = run.list[run.i]; if (!c) { await finish(run); return; }
    const log = run.log; const results = run.results;
    const paint = (msg) => { show(`<div style="font-size:12px;color:#5b6b66">${run.i}/${run.list.length}社　保存 ${run.saved}件・とばした会社 ${run.skipped}</div>${bar(run.list.length ? run.i / run.list.length : 0)}<div style="font-size:12.5px">${msg}</div><button type="button" data-stop style="margin-top:8px;border:1px solid #e7b37a;background:#fff;color:#7a4310;border-radius:9px;padding:5px 12px;cursor:pointer">止める</button>${log.length ? `<div style="font-size:11.5px;color:#7a4310;margin-top:6px;max-height:90px;overflow:auto">${log.slice(-6).map(esc0).join("<br>")}</div>` : ""}`); const sb = box.querySelector("[data-stop]"); if (sb) sb.onclick = async () => { stop = true; sb.disabled = true; sb.textContent = "止めています…"; const r2 = await getRun(); if (r2) await setRun({ ...r2, stop: true }); }; };
    const next = async () => { run.i++; run.tries = 0; run.at = Date.now(); if (stop || run.stop || run.i >= run.list.length) { await finish(run); return; } await setRun(run); openCompany(run.list[run.i].company); };
    try {
      paint(`${esc0(c.name || c.company)}（${esc0(c.company)}）を開いています…`);
      // ページができあがるのを待つ（最大40秒）
      for (let k = 0; k < 40; k++) { if (isLogin() || (mainTitle() && (totalRows() > 0 || /0\s*件のセッション|セッションが見つかりません/.test(document.body.innerText || "")))) break; await sleep(1000); }
      if (isLogin()) { run.log.push("ログインの画面になったので止めました（ログインしてから、もう一度押してください）"); await finish(run); return; }
      await openTab("チャットセッション"); await quiet(1200);
      if (!titleOk(c, "")) {
        if (run.tries < 1) { run.tries++; run.at = Date.now(); await setRun(run); openCompany(c.company); return; }   // もう1回だけ開き直す
        run.skipped++; results.push({ company: c.company, ok: false, why: "開いても右の画面がその会社にならない", title: mainTitle(), name: c.name }); log.push(`${c.company}：開いても右の画面が「${mainTitle() || "？"}」でした`); await next(); return;
      }
      const known = new Set((c.known || []).map((k) => String(k).slice(0, 8)));
      const n = Math.min(totalRows(), 300); results.push({ company: c.company, ok: true, rows: n, title: mainTitle() });
      let prev = reviewLabel(document.body); let failRow = 0;
      for (let i = 0; i < n && !stop; i++) {
        paint(`${esc0(c.name || c.company)}：${i + 1}/${n} 件目を読んでいます`);
        if (run.onlyNew && i > 0) { await toggleRow(i, "peek"); const rid = rowId(i); if (rid && known.has(rid.slice(0, 8))) break; }
        const r = await readRow(i, prev, c.company);
        if (!titleOk(c, "")) { log.push(`${c.company}：行を選ぶと右の画面が「${mainTitle()}」に変わったので、この会社は止めました`); break; }
        if (r.skip) { if (i === 0) { log.push(`${c.company}：チャットの表が見つかりませんでした`); await diag("表が見つからない・押せない"); } break; }
        if (r.fail) { failRow++; run.failed++; if (failRow >= 2) { log.push(`${c.company}：表のチェックを押せませんでした`); await diag("表の行を選べない"); break; } continue; }
        prev = r.label;
        if (r.r && r.r.ok) run.saved++; else log.push(`${c.company} ${r.label.slice(0, 8)}：${(r.r && r.r.error) || "送れませんでした"}`);
        if (run.onlyNew && known.has(r.label.slice(0, 8))) break;   // 前に読んだチャットまで来た（一覧は新しい順）
        if (i % 5 === 4) { run.at = Date.now(); await setRun(run); }
      }
      await next();
    } catch (e) { run.log.push(`止まりました：${e.message}`); await finish(run); }
  }
  async function finish(run) {
    await delRun(); crawling = false;
    kb("/api/kinxs/docai/diag", "POST", { why: "取り込みの結果", ver: (() => { try { return chrome.runtime.getManifest().version; } catch { return ""; } })(), saved: run.saved, skipped: run.skipped, failed: run.failed, results: (run.results || []).slice(0, 60), log: (run.log || []).slice(-40), trace: trace.slice(-200) }).catch(() => {});
    box.hidden = false;
    show(`<div style="color:${C.deep};font-weight:700">${run.stop || stop ? "止めました" : "終わりました"}</div><div style="font-size:12.5px;margin-top:4px">${Math.min(run.i, run.list.length)}社を見ました・保存 ${run.saved}件・とばした会社 ${run.skipped}社${run.failed ? `・読めなかった行 ${run.failed}` : ""}</div>${(run.log || []).length ? `<div style="font-size:11.5px;color:#7a4310;margin-top:6px;max-height:120px;overflow:auto">${run.log.slice(-10).map(esc0).join("<br>")}</div>` : ""}<div style="font-size:11.5px;color:#5b6b66;margin-top:6px">kinXs の「DOC連携 → 候補者の質問」で見られます。</div>`);
  }
  // Streamlit は画面をあとから書きかえるので、変化が落ち着いてから読む
  const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(passive, 1800); });
  const start = () => { if (!document.body) return setTimeout(start, 300); obs.observe(document.body, { childList: true, subtree: true, characterData: true }); timer = setTimeout(passive, 2500); };
  start();
  setTimeout(() => { resume().catch(() => {}); }, 1500);
})();
