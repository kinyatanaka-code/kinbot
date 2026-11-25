// MOCHICALL の「困った」ボタン（開発期間だけの仮のもの）（2026-11-25 福井さん「困ったボタンを臨時で作成して。押すと MOCHICALL のエラー状態を自動で開発サイドに送信する」）
//   インターン生が「動かない」「おかしい」と思ったとき、言葉でうまく説明できなくても、押すだけで開発側に様子が届くようにする。
//   ページを開いたときから、画面のエラー・うまくいかなかった通信・画面に出た知らせを手元にためておき、押したときにまとめて開発メモへ送る。
//   送り先は今ある開発メモの口（/api/dev-notes）。サーバーは変えていない。AI も呼ばない（お金がかからない）。
//   mccall.js に入れずに別のファイルにしたのは、開発期間が終わったら mochica.html の読み込みの1行を消すだけで外せるようにするため。
//   最初のエラーから拾えるよう、mochica.html では mccall.js より前に読み込む。
(function () {
  if (window.__mcHelp) return; window.__mcHelp = true;

  const MAX = 25;                      // ためておく件数（古いものから捨てる）
  const errs = [];                     // 画面のエラー
  const calls = [];                    // 通信の記録（うまくいかなかったもの・遅かったもの）
  const recent = [];                   // 直近の通信（うまくいったものも含めて、流れを見るため）
  const notes = [];                    // 画面の下に出た知らせ（toast）の文
  const t0 = Date.now();
  const now = () => new Date().toLocaleTimeString("ja-JP", { hour12: false });
  const push = (arr, v, n = MAX) => { arr.push(v); if (arr.length > n) arr.shift(); };
  const cut = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);

  // ---- 画面のエラー ----
  window.addEventListener("error", (e) => {
    try {
      // 画像などの読み込み失敗（ロゴが無い等）は、困りごとと関係ないことが多いので数えない
      if (e && e.target && e.target !== window && e.target.tagName) return;
      push(errs, `${now()} ${cut(e.message, 200)}${e.filename ? `（${cut(String(e.filename).split("/").pop(), 60)}:${e.lineno || ""}）` : ""}`);
    } catch {}
  }, true);
  window.addEventListener("unhandledrejection", (e) => {
    try { const r = e && e.reason; push(errs, `${now()} 処理の失敗：${cut((r && (r.message || r)) || "不明", 200)}`); } catch {}
  });
  const ce = console.error;
  console.error = function (...a) {
    try { push(errs, `${now()} console：${cut(a.map((x) => (x && x.message) || (typeof x === "object" ? JSON.stringify(x) : x)).join(" "), 200)}`); } catch {}
    return ce.apply(this, a);
  };

  // ---- 通信（fetch）----
  //   失敗（400以上・つながらない）と、8秒より遅かったものを残す。中身は先頭だけ（長いと開発メモが読めないため）。
  const of = window.fetch;
  if (of) window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const path = cut(url.replace(location.origin, ""), 140);
    const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    const s = Date.now();
    // 自分が送るときの通信は記録しない（送った記録が次の送信に混ざらないように）
    if (/\/api\/dev-notes/.test(path)) return of.apply(this, arguments);
    try {
      const r = await of.apply(this, arguments);
      const ms = Date.now() - s;
      push(recent, `${now()} ${method} ${path} → ${r.status}（${ms}ms）`, 15);
      if (!r.ok || ms > 8000) {
        let body = "";
        try { body = cut(await r.clone().text(), 240); } catch {}
        push(calls, `${now()} ${method} ${path} → ${r.status}${ms > 8000 ? `（${Math.round(ms / 1000)}秒かかった）` : ""}${body && !r.ok ? ` ${body}` : ""}`);
      }
      return r;
    } catch (e) {
      push(recent, `${now()} ${method} ${path} → つながらない`, 15);
      push(calls, `${now()} ${method} ${path} → つながらない：${cut(e && e.message, 160)}`);
      throw e;
    }
  };

  // ---- 画面の下の知らせ（mccall.js の toast）を拾う ----
  //   「保存できませんでした」などの知らせは数秒で消えるので、出たときに文を残しておく。
  document.addEventListener("DOMContentLoaded", () => {
    try {
      new MutationObserver((ms) => {
        for (const m of ms) for (const n of m.addedNodes) {
          if (n.nodeType === 1 && n.classList && (n.classList.contains("mcc-toast") || n.classList.contains("kb-err"))) push(notes, `${now()} ${cut(n.textContent, 200)}`);
        }
      }).observe(document.body, { childList: true });
    } catch {}
    mount();
  });

  // ---- いまの画面の様子 ----
  function state() {
    const pane = document.querySelector("section[data-pane]:not([hidden])");
    const tab = document.querySelector('#mccTabs [aria-selected="true"]');
    const vers = [...document.querySelectorAll('script[src*="?v="]')].map((s) => (s.getAttribute("src") || "").replace(/^\//, "")).filter((s) => /^(mc|mochica)/.test(s)).join(" ");
    // かける画面で見えている内容の先頭（どのリード・どの段階だったかの手がかり）
    const call = document.getElementById("mccCall");
    const seen = call && !call.hidden ? cut(call.innerText, 300) : "";
    return [
      `画面：${location.pathname}${location.hash}`,
      `開いている所：${pane ? pane.dataset.pane : "不明"}${tab ? ` ／ タブ：${cut(tab.textContent, 20)}` : ""}`,
      `開いてから：${Math.round((Date.now() - t0) / 60000)}分`,
      `ネット：${navigator.onLine ? "つながっている" : "つながっていない"}`,
      `画面の大きさ：${innerWidth}×${innerHeight}`,
      `ブラウザ：${cut(navigator.userAgent, 160)}`,
      `画面の版：${vers}`,
      seen ? `見えていた内容：${seen}` : "",
    ].filter(Boolean).join("\n");
  }

  function report(text) {
    const list = (title, arr) => `【${title}】${arr.length ? `\n${arr.slice().reverse().join("\n")}` : "なし"}`;
    const detail = [
      `【本人が書いたこと】${text || "（書かずに送った）"}`,
      `【送った時刻】${new Date().toLocaleString("ja-JP")}`,
      `【画面の様子】\n${state()}`,
      list("画面のエラー（新しい順）", errs),
      list("うまくいかなかった・遅かった通信（新しい順）", calls),
      list("画面に出た知らせ（新しい順）", notes),
      list("直近の通信（新しい順）", recent),
    ].join("\n\n").slice(0, 6000);
    const head = text || cut((errs[errs.length - 1] || calls[calls.length - 1] || "").replace(/^\S+ /, ""), 60) || "エラーの記録なし";
    return { kind: "bug", title: `【困ったボタン】MOCHICALL：${cut(head, 80)}（エラー${errs.length}・通信の失敗${calls.length}）`, detail };
  }

  // ---- ボタンと小さな窓 ----
  function mount() {
    const css = document.createElement("style");
    css.textContent = `
      .mch-btn{position:fixed;right:16px;bottom:16px;z-index:9998;display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 14px;border-radius:999px;border:1px solid #5DCAA5;background:#0d5b47;color:#fff;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 2px 8px rgba(13,91,71,.25)}
      .mch-btn:hover{background:#1d9e75}
      .mch-btn[hidden]{display:none}
      .mch-box{position:fixed;right:16px;bottom:60px;z-index:9999;width:320px;background:#fff;border:1px solid #5DCAA5;border-radius:14px;padding:14px;box-shadow:0 6px 24px rgba(0,0,0,.15);font-size:13px;color:#1f2d2a}
      .mch-box[hidden]{display:none}
      .mch-box h3{margin:0 0 6px;font-size:14px;color:#0d5b47}
      .mch-box p{margin:0 0 8px;line-height:1.5;color:#4a5b57}
      .mch-box textarea{width:100%;box-sizing:border-box;min-height:64px;border:1px solid #cfe3dc;border-radius:10px;padding:8px;font:inherit;resize:vertical}
      .mch-row{display:flex;gap:8px;justify-content:flex-end;margin-top:8px}
      .mch-row button{height:32px;padding:0 14px;border-radius:999px;border:1px solid #5DCAA5;background:#fff;color:#0d5b47;cursor:pointer;font:inherit}
      .mch-row button.go{background:#0d5b47;color:#fff}
      .mch-row button:disabled{opacity:.5;cursor:default}
      .mch-msg{margin-top:8px;color:#0d5b47}
      .mch-msg.ng{color:#b3261e}`;
    document.head.appendChild(css);

    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "mch-btn"; btn.id = "mchBtn"; btn.hidden = true;
    btn.title = "うまく動かないときに押すと、いまの画面の様子とエラーの記録を開発の人に送ります（開発期間だけのボタン）";
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5DCAA5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14"/><circle cx="12" cy="17" r=".6" fill="#5DCAA5"/></svg>困った`;
    document.body.appendChild(btn);

    const box = document.createElement("div");
    box.className = "mch-box"; box.hidden = true; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "困ったときに開発へ送る");
    box.innerHTML = `<h3>開発の人に知らせる</h3>
      <p>いまの画面の様子とエラーの記録を、そのまま開発の人に送ります。何をしていたか一言あると直しやすいです（書かなくても送れます）。</p>
      <textarea id="mchText" maxlength="300" placeholder="例：結果を押しても次のリードに進まない"></textarea>
      <div class="mch-row"><button type="button" id="mchCancel">やめる</button><button type="button" class="go" id="mchSend">送る</button></div>
      <div class="mch-msg" id="mchMsg" hidden></div>`;
    document.body.appendChild(box);
    // 文を打つときに、架電の画面のキー操作（数字キーや Z など）が動かないようにする
    box.addEventListener("keydown", (e) => e.stopPropagation());
    box.addEventListener("keyup", (e) => e.stopPropagation());

    const $ = (id) => document.getElementById(id);
    const msg = (t, ng) => { const m = $("mchMsg"); m.hidden = !t; m.textContent = t || ""; m.classList.toggle("ng", !!ng); };
    btn.addEventListener("click", () => { box.hidden = !box.hidden; if (!box.hidden) { msg(""); $("mchText").focus(); } });
    $("mchCancel").addEventListener("click", () => { box.hidden = true; });

    let lastSent = 0;
    $("mchSend").addEventListener("click", async () => {
      // 続けて何回も押されて、開発側に同じ知らせが何通も行かないようにする
      if (Date.now() - lastSent < 30000) { msg("さっき送りました。30秒ほどあけてから、もう一度押してください。", true); return; }
      const send = $("mchSend"); send.disabled = true; msg("送っています…");
      try {
        const r = await of("/api/dev-notes", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(report(cut($("mchText").value, 300))) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `サーバーが ${r.status} を返しました`);
        lastSent = Date.now();
        $("mchText").value = "";
        msg(`送りました（受付番号 #${(d.item && d.item.id) || "—"}）。開発の人が確認します。急ぐときは、この番号を添えて Chat で声をかけてください。`);
      } catch (e) {
        msg(`送れませんでした：${e.message}。画面を読み込み直してからもう一度押すか、この画面のスクリーンショットを Chat で開発の人に送ってください。`, true);
      } finally { send.disabled = false; }
    });

    // MOCHICALL（かける）を開いているときだけボタンを出す。ほかのタブは今回の対象外
    const sync = () => {
      const p = document.querySelector('section[data-pane="call"]');
      const on = !!p && !p.hidden;
      btn.hidden = !on; if (!on) box.hidden = true;
    };
    sync(); setInterval(sync, 1000);
  }
})();
