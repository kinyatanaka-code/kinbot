// twofa.js — DOC の AI の管理画面（カジュアル面談エージェント）の2段階認証を自動で入れる（2026-11-19 田中さん）。
//
// 流れ：確認コードを入れる画面が出る → kinbot に「本人の Gmail に届いた確認コード」を聞く
//       → 届いていたら欄に入れて、確認のボタンを押す。届くまで3分は待つ。
// 確認コードは kinbot が本人の Gmail（noreply@mail.brainverse-ai.com からのメール）だけを読んで返す。
// パスワードは Chrome の保存したものを使う（ここでは扱わない）。
(() => {
  if (window.__kbTwofa) return; window.__kbTwofa = true;
  const SITE = "brainverse";
  const WAIT_MS = 3 * 60000;     // 届くまで待つ長さ
  const POLL_MS = 4000;          // kinbot に聞く間隔
  let shownAt = 0, lastCode = "", lastAt = 0, busy = false, until = 0, stopped = false, badge = null;

  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  // 欄の名前（label・placeholder・aria-label・近くの見出し）
  const labelOf = (inp) => {
    const parts = [inp.placeholder, inp.getAttribute("aria-label"), inp.name, inp.id, inp.autocomplete];
    if (inp.id) { const l = document.querySelector(`label[for="${CSS.escape(inp.id)}"]`); if (l) parts.push(l.textContent); }
    const box = inp.closest("[data-testid=stTextInput], .stTextInput, label, .form-group, div");
    if (box) parts.push((box.textContent || "").slice(0, 80));
    return parts.filter(Boolean).join(" ");
  };
  // 確認コードの欄を探す。パスワードの欄が見えているうち（ログインの最初の画面）は探さない
  const findCodeInput = () => {
    const ins = [...document.querySelectorAll("input")].filter((i) => visible(i) && !i.disabled && !i.readOnly);
    if (ins.some((i) => i.type === "password")) return null;
    const cand = ins.filter((i) => ["text", "number", "tel", ""].includes(i.type));
    const byLabel = cand.find((i) => /確認コード|認証コード|ワンタイム|コード|code|otp|2fa|verification/i.test(labelOf(i)) || i.autocomplete === "one-time-code");
    if (byLabel) return byLabel;
    // 欄の名前が分からなくても、画面に「確認コード」と出ていて、入れる欄が1つだけならそれを使う
    if (cand.length === 1 && /確認コード|認証コード|ワンタイム/.test(document.body.innerText || "")) return cand[0];
    return null;
  };
  // React（Streamlit）の欄にも入るように、元の setter で値を入れてから input を知らせる
  const setVal = (inp, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    inp.focus(); set.call(inp, v);
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    inp.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const findSubmit = (inp) => {
    const btns = [...document.querySelectorAll("button, input[type=submit]")].filter((b) => visible(b) && !b.disabled);
    return btns.find((b) => /確認|認証|送信|ログイン|次へ|verify|submit|continue/i.test(b.textContent || b.value || "") && !/再送|もう一度|戻る|キャンセル/.test(b.textContent || ""))
      || (inp.form && inp.form.querySelector("button[type=submit], input[type=submit]")) || null;
  };
  const say = (msg, tone) => {
    if (!badge) {
      badge = document.createElement("div");
      badge.style.cssText = "position:fixed;right:16px;top:16px;z-index:2147483647;max-width:300px;padding:10px 14px;border-radius:14px;font:600 12.5px/1.5 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.18);background:#fff;color:#0d5b47;border:1.5px solid #5DCAA5";
      document.documentElement.appendChild(badge);
    }
    badge.style.borderColor = tone === "ng" ? "#E0A100" : "#5DCAA5";
    badge.textContent = `kinbot：${msg}`;
  };
  const hide = () => { if (badge) { badge.remove(); badge = null; } };
  const ask = () => new Promise((ok) => {
    try { chrome.runtime.sendMessage({ type: "kb-login-code", site: SITE, since: shownAt - 90000 }, (r) => ok(r || { ok: false, error: (chrome.runtime.lastError || {}).message || "返事がありません" })); }
    catch (e) { ok({ ok: false, error: String(e && e.message || e) }); }
  });

  const tick = async () => {
    if (busy) return;
    const inp = findCodeInput();
    // 欄が消えた＝ログインできた（または前の画面に戻った）。次に出たら、また最初から待つ
    if (!inp) { if (shownAt) { shownAt = 0; until = 0; stopped = false; setTimeout(() => { if (!shownAt) hide(); }, 3000); } return; }
    if (stopped) return;
    // 確認コードの画面が出ているあいだは、ずっとメールを見る。新しい確認コードのメールが来たら、それを入れ直す
    //   （2026-11-19 田中さん「最新のメールが送られてきたらそれに入力しなおすように」：再送したときや、古いコードが入ったとき）。
    //   入れてから3分（最初は画面が出てから3分）新しいメールが来なければ、知らせて、見に行く間を空ける（10分で止める）
    if (!shownAt) { shownAt = Date.now(); until = shownAt + WAIT_MS; say("メールの確認コードを待っています…"); }
    if (Date.now() - shownAt > 10 * 60000) { stopped = true; say("10分たったので、確認コードを見に行くのをやめました。手で入れてください", "ng"); return; }
    const late = Date.now() > until;
    if (late && !lastCode) say("確認コードのメールがまだ届きません。届いたら入れます（手で入れてもかまいません）", "ng");
    if (late && Date.now() - (tick.slowAt || 0) < 15000) return;   // 遅れているときは15秒おき
    tick.slowAt = Date.now();
    busy = true;
    try {
      const r = await ask();
      if (!r.ok) { stopped = true; say(`確認コードを読めませんでした：${r.error}`, "ng"); return; }
      // いま入れてあるものより新しいメールのコードだけを使う（同じメールのコードは入れ直さない）
      if (!r.code || (r.at || 0) <= lastAt) return;
      const again = !!lastCode;
      lastCode = r.code; lastAt = r.at || Date.now(); until = Date.now() + WAIT_MS;
      setVal(inp, r.code);
      say(again ? "新しい確認コードのメールが来たので、入れ直しました" : "確認コードを入れました");
      setTimeout(() => {
        // Streamlit の欄は Enter かフォーカスが外れたときに値が決まる
        inp.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true }));
        inp.blur();
        setTimeout(() => { const b = findSubmit(inp); if (b) b.click(); setTimeout(() => { if (!findCodeInput()) hide(); }, 4000); }, 400);
      }, 300);
    } finally { busy = false; }
  };
  // ===== ログインし直し（DOC の AI の取り込みの途中だけ）（2026-11-19 田中さん「1社読んだら読み込み直してログインし直す」）=====
  //   取り込みが「ログインし直し中」のときだけ、メールとパスワードを入れて［ログイン］を押す。ふだんのログインには手を出さない。
  //   パスワードは取り込みを始めるときに入れたもの（拡張機能の裏側の、Chrome を閉じると消える置き場）。無ければ Chrome が入れたものをそのまま使う
  let loginTries = 0, loginAt = 0;
  const runNow = () => new Promise((ok) => { try { chrome.storage.local.get(["kbDocAiRun"], (st) => ok((st && st.kbDocAiRun) || null)); } catch { ok(null); } });
  const cred = () => new Promise((ok) => { try { chrome.runtime.sendMessage({ type: "kb-docai-cred", op: "get" }, (r) => ok(r || {})); } catch { ok({}); } });
  const loginTick = async () => {
    if (busy || loginTries >= 3 || Date.now() - loginAt < 15000) return;
    const ins = [...document.querySelectorAll("input")].filter((i) => visible(i) && !i.disabled);
    const pw = ins.find((i) => i.type === "password"); if (!pw) return;
    const run = await runNow(); if (!run || run.phase !== "relogin" || run.stop) return;
    const em = ins.find((i) => i.type === "email" || /mail|メール/i.test(labelOf(i)));
    const c = await cred();
    if (run.auto && !c.pw) return;   // 毎日の自動で、まだパスワードを聞いていない（管理画面の窓で聞く）
    if (em && c.email && em.value !== c.email) setVal(em, c.email);
    if (c.pw) setVal(pw, c.pw);
    const b = [...document.querySelectorAll("button, input[type=submit]")].find((x) => visible(x) && /ログイン|login|sign in/i.test(x.textContent || x.value || "") && !/できない|忘れ/.test(x.textContent || ""));
    if (!b) { say("ログインのボタンが見つかりませんでした。手でログインしてください", "ng"); loginTries = 3; return; }
    loginTries++; loginAt = Date.now();
    say(loginTries > 1 ? "もう一度ログインしています…" : "ログインし直しています…");
    setTimeout(() => b.click(), 300);
  };
  setInterval(() => { loginTick().catch(() => {}); tick(); }, POLL_MS);
  setTimeout(() => { loginTick().catch(() => {}); tick(); }, 1200);
})();
