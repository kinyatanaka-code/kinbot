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
        <button type="button" class="kb-chat-x" aria-label="閉じる">✕</button>
      </div>
      <div class="kb-chat-body" id="kbChatBody"></div>
      <div class="kb-chat-tips" id="kbChatTips"></div>
      <div class="kb-chat-foot">
        <textarea id="kbChatInput" rows="1" placeholder="例：御礼メールの宛先はどこから入るの？"></textarea>
        <button type="button" class="kb-chat-send" id="kbChatSend">送る</button>
      </div>`;
    document.body.appendChild(panel);

    panel.querySelector(".kb-chat-x").addEventListener("click", close);
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
    } catch (e) {
      waiting.remove();
      say("bot", "つながりませんでした：" + e.message);
    } finally {
      busy = false;
      input.focus();
    }
  }

  function open() {
    build();
    panel.hidden = false;
    greet();
    setTimeout(() => panel.querySelector("#kbChatInput").focus(), 50);
  }
  function close() { if (panel) panel.hidden = true; }
  function toggle() { (panel && !panel.hidden) ? close() : open(); }

  // ロボの絵をクリックしたら開く。
  // どの画面にもある「上のロボ」と「メニューの印」の両方に付ける。
  function wire() {
    const targets = document.querySelectorAll(".topbar-bot, .brand-mark, .side-brand .brand-mark");
    targets.forEach((el) => {
      if (el._kbChatWired) return;
      el._kbChatWired = true;
      el.style.cursor = "pointer";
      el.title = "kinbotに聞く";
      el.addEventListener("click", (e) => { e.preventDefault(); toggle(); });
    });
  }

  document.addEventListener("DOMContentLoaded", wire);
  // メニューがあとから作られる画面もあるので、少し待ってもう一度付ける
  setTimeout(wire, 800);
  setTimeout(wire, 2000);

  // ほかの画面から呼べるようにしておく
  window.kbChatOpen = open;
})();
