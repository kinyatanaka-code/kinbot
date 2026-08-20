// kbchat.js — kinbotのロボに話しかける窓
//
// 画面の左上（またはメニュー）のロボをクリックすると開きます。
// kinbotの使い方を答え、答えられないことや要望は開発メモへ回します。
(() => {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let panel = null;
  let history = [];
  let busy = false;

  function build() {
    if (panel) return panel;
    panel = document.createElement("div");
    panel.className = "kb-chat";
    panel.hidden = true;
    panel.innerHTML = `
      <div class="kb-chat-head">
        <img class="kb-chat-face" src="/kinbot.svg" alt="" />
        <div class="kb-chat-title">
          <b>kinbotに聞く</b>
          <span>使い方や、直してほしいことをどうぞ</span>
        </div>
        <span class="kb-chat-dot" aria-hidden="true"></span>
        <div class="kb-chat-btns">
          <button type="button" class="kb-chat-mini-btn" aria-label="小さくする" title="小さくする">－</button>
          <button type="button" class="kb-chat-x" aria-label="閉じる" title="閉じる">✕</button>
        </div>
      </div>
      <div class="kb-chat-body" id="kbChatBody"></div>
      <div class="kb-chat-tips" id="kbChatTips"></div>
      <div class="kb-chat-foot">
        <textarea id="kbChatInput" rows="1" placeholder="例：御礼メールの宛先はどこから入るの？"></textarea>
        <button type="button" class="kb-chat-send" id="kbChatSend">送る</button>
      </div>`;
    document.body.appendChild(panel);

    panel.querySelector(".kb-chat-x").addEventListener("click", close);

    // 小さくする／元に戻す。小さくしている間は、ほかの画面をそのまま触れる。
    const miniBtn = panel.querySelector(".kb-chat-mini-btn");
    miniBtn.addEventListener("click", (e) => { e.stopPropagation(); setMini(!panel.classList.contains("mini")); });
    // 小さくなっているときは、見出しをどこでも押せば開く
    panel.querySelector(".kb-chat-head").addEventListener("click", (e) => {
      if (!panel.classList.contains("mini")) return;
      if (e.target.closest(".kb-chat-x")) return;
      setMini(false);
    });
    const input = panel.querySelector("#kbChatInput");
    const send = panel.querySelector("#kbChatSend");
    send.addEventListener("click", () => ask(input.value));
    input.addEventListener("keydown", (e) => {
      // Enterで送る。改行したいときは Shift+Enter。
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(input.value); }
    });
    // 入力が増えたら、欄を少しずつ広げる
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(120, input.scrollHeight) + "px";
    });
    return panel;
  }

  // はじめに出す案内と、よく聞かれること
  function greet() {
    if (history.length) return;
    say("bot", "kinbotの使い方をお答えします。\n直してほしいことや、うまくいかないことも教えてください（開発メモに残します）。");
    const tips = panel.querySelector("#kbChatTips");
    const samples = [
      "御礼メールの宛先はどこから入る？",
      "リスケのときはどうすればいい？",
      "天気予報って何？",
      "アポが数に入らないのはなぜ？",
    ];
    tips.innerHTML = samples.map((t) => `<button type="button" class="kb-tip">${esc(t)}</button>`).join("");
    tips.querySelectorAll(".kb-tip").forEach((b) =>
      b.addEventListener("click", () => ask(b.textContent)));
  }

  function say(role, text, opts = {}) {
    const body = panel.querySelector("#kbChatBody");
    const row = document.createElement("div");
    row.className = `kb-msg kb-${role}`;
    row.innerHTML = esc(text).replace(/\n/g, "<br>") +
      (opts.noted ? `<div class="kb-noted">開発メモに残しました</div>` : "");
    body.appendChild(row);
    body.scrollTop = body.scrollHeight;
    if (role !== "wait") history.push({ role, text });
    return row;
  }

  async function ask(raw) {
    const text = String(raw || "").trim();
    if (!text || busy) return;
    busy = true;
    const input = panel.querySelector("#kbChatInput");
    input.value = "";
    input.style.height = "auto";
    const tips = panel.querySelector("#kbChatTips");
    if (tips) tips.innerHTML = "";
    say("me", text);
    const waiting = say("wait", "考えています…");

    try {
      const r = await fetch("/api/ask-bot", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, history: history.slice(-6) }),
      });
      const d = await r.json();
      waiting.remove();
      if (d.error) throw new Error(d.error);
      say("bot", d.answer || "うまく答えられませんでした。", { noted: d.noted });
      if (panel.classList.contains("mini")) panel.classList.add("has-new");
    } catch (e) {
      waiting.remove();
      say("bot", "つながりませんでした：" + e.message);
    } finally {
      busy = false;
      input.focus();
    }
  }

  // 小さくする／元に戻す。
  // 小さくしても話は消えないので、あとから続けられる。
  function setMini(on) {
    if (!panel) return;
    panel.classList.toggle("mini", !!on);
    const b = panel.querySelector(".kb-chat-mini-btn");
    if (b) {
      b.textContent = on ? "＋" : "－";
      b.title = on ? "元に戻す" : "小さくする";
      b.setAttribute("aria-label", b.title);
    }
    if (!on) {
      panel.classList.remove("has-new");
      const body = panel.querySelector("#kbChatBody");
      if (body) body.scrollTop = body.scrollHeight;
    }
  }

  function open() {
    build();
    markUsed();
    panel.hidden = false;
    setMini(false);
    greet();
    // スマホでは、開いた瞬間に文字を打つ欄へ飛ばさない（画面が動いて驚くため）
    if (window.innerWidth > 620) {
      setTimeout(() => panel.querySelector("#kbChatInput").focus(), 50);
    }
  }
  function close() { if (panel) panel.hidden = true; }
  function toggle() {
    if (!panel || panel.hidden) return open();
    // 開いているときに押したら、小さくする（話は残る）
    if (panel.classList.contains("mini")) return setMini(false);
    setMini(true);
  }

  // 一度も使ったことがない人には、ロボの横に吹き出しを出して気づいてもらう。
  // 「使ったことがある」かどうかは、この端末に覚えておく。
  const USED_KEY = "kbChatUsed";
  function used() {
    try { return localStorage.getItem(USED_KEY) === "1"; } catch { return true; }
  }
  function markUsed() {
    try { localStorage.setItem(USED_KEY, "1"); } catch {}
    document.querySelectorAll(".topbar-bot").forEach((el) => el.classList.remove("kb-new"));
    document.querySelectorAll(".kb-bot-hint").forEach((el) => el.remove());
  }

  function addHint(bot) {
    if (used() || bot._kbHinted) return;
    bot._kbHinted = true;
    bot.classList.add("kb-new");
    const hint = document.createElement("span");
    hint.className = "kb-bot-hint";
    hint.innerHTML = `押すと相談できます<button type="button" class="kb-bot-hint-x" aria-label="閉じる">✕</button>`;
    hint.addEventListener("click", (e) => {
      if (e.target.closest(".kb-bot-hint-x")) { e.stopPropagation(); markUsed(); return; }
      open();
    });
    bot.insertAdjacentElement("afterend", hint);
  }

  // ───────────── ロボの連打あそび ─────────────
  // 何回も続けて押されたら、ロボが文句を言う。
  // 2秒あいだが空いたら、数え直す（ふつうの操作では出ない）。
  let taps = 0;
  let tapTimer = null;
  const TAP_WORDS = {
    3: "痛いでやんす",
    5: "暇なの？",
    8: "仕事しろ",
    10: "…",
  };

  function tease(bot) {
    taps++;
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => { taps = 0; }, 2000);

    const word = TAP_WORDS[taps];
    if (!word) return false;

    if (taps >= 10) {
      // 10回でドス黒い顔になる。しばらくすると元に戻る。
      bot.classList.add("kb-bot-dark");
      showBubble(bot, "……", 2600);
      setTimeout(() => bot.classList.remove("kb-bot-dark"), 2600);
      taps = 0;
      return true;
    }
    showBubble(bot, word, 1600);
    // 3・5・8回目は窓を開かない（文句を言うだけ）
    return true;
  }

  // ロボの横に、ひとことだけ出す
  function showBubble(bot, text, ms) {
    document.querySelectorAll(".kb-bot-say").forEach((e) => e.remove());
    const el = document.createElement("span");
    el.className = "kb-bot-say";
    el.textContent = text;
    bot.insertAdjacentElement("afterend", el);
    // 出てきたときに、ぷるっと動かす
    bot.classList.add("kb-bot-poke");
    setTimeout(() => bot.classList.remove("kb-bot-poke"), 400);
    setTimeout(() => el.remove(), ms);
  }

  // ロボの絵をクリックしたら開く。
  // どの画面にもある「上のロボ」と「メニューの印」の両方に付ける。
  function wire() {
    const targets = document.querySelectorAll(".topbar-bot, .brand-mark, .side-brand .brand-mark");
    targets.forEach((el) => {
      if (el._kbChatWired) return;
      el._kbChatWired = true;
      el.style.cursor = "pointer";
      el.title = "押すとkinbotに相談できます";
      el.addEventListener("click", (e) => {
        e.preventDefault();
        // 上のロボは、連打すると文句を言う（そのときは窓を開かない）
        if (el.classList.contains("topbar-bot") && tease(el)) return;
        toggle();
      });
    });
    document.querySelectorAll(".topbar-bot").forEach(addHint);
  }

  document.addEventListener("DOMContentLoaded", wire);
  // メニューがあとから作られる画面もあるので、少し待ってもう一度付ける
  setTimeout(wire, 800);
  setTimeout(wire, 2000);

  // ほかの画面から呼べるようにしておく
  window.kbChatOpen = open;
})();
