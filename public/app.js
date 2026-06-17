// public/app.js
const $ = (id) => document.getElementById(id);
const els = {
  viewJoin: $("viewJoin"),
  viewLive: $("viewLive"),
  meetingUrl: $("meetingUrl"),
  meetingTitle: $("meetingTitle"),
  joinBtn: $("joinBtn"),
  liveControls: $("liveControls"),
  leaveBtn: $("leaveBtn"),
  conn: $("conn"),
  timer: $("timer"),
  status: $("status"),
  transcript: $("transcript"),
  transcriptEmpty: $("transcriptEmpty"),
  partial: $("partial"),
  summary: $("summary"),
  moves: $("moves"),
  sttHint: $("sttHint"),
  summaryHint: $("summaryHint"),
  linkSelect: $("linkSelect"),
};

let sessionId = null;
let ws = null;
let timerId = null;
let startedAt = 0;
const speakerColors = new Map();

els.joinBtn.addEventListener("click", joinMeeting);
els.leaveBtn.addEventListener("click", leaveMeeting);

// 登録リンクをプルダウンに読み込む
if (els.linkSelect) {
  els.linkSelect.addEventListener("change", () => {
    if (els.linkSelect.value) els.meetingUrl.value = els.linkSelect.value;
  });
  loadLinks();
}
async function loadLinks() {
  try {
    const res = await fetch("/api/links");
    const { links } = await res.json();
    for (const l of links || []) {
      const opt = document.createElement("option");
      opt.value = l.url;
      opt.textContent = l.name;
      els.linkSelect.appendChild(opt);
    }
  } catch {}
}

async function joinMeeting() {
  const meetingUrl = els.meetingUrl.value.trim();
  const title = els.meetingTitle ? els.meetingTitle.value.trim() : "";
  if (!meetingUrl) {
    setStatus("会議URLを入力してください。");
    return;
  }
  els.joinBtn.disabled = true;
  setStatus("Botを会議に送り込んでいます…");
  try {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ meetingUrl, title }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "作成に失敗しました");
    sessionId = data.sessionId;
    openSocket();
    enterLiveMode();
    setStatus("Botが入室処理中です。会議で参加を許可してください。");
  } catch (e) {
    setStatus("開始できませんでした: " + e.message);
    els.joinBtn.disabled = false;
  }
}

function enterLiveMode() {
  els.viewJoin.hidden = true;
  els.viewLive.hidden = false;
  els.liveControls.hidden = false;
  els.sttHint.textContent = "接続待ち";
  startTimer();
}

async function leaveMeeting() {
  if (sessionId) {
    try {
      await fetch(`/api/sessions/${sessionId}/stop`, { method: "POST" });
    } catch {}
  }
  if (ws) ws.close();
  ws = null;
  sessionId = null;
  stopTimer();
  setConn("idle");
  els.liveControls.hidden = true;
  els.viewLive.hidden = true;
  els.viewJoin.hidden = false;
  els.joinBtn.disabled = false;
  els.sttHint.textContent = "待機中";
  els.partial.textContent = "";
  // 次の商談のために表示をリセット
  els.transcript.innerHTML = '<div class="empty-state" id="transcriptEmpty">Botが入室すると、発言が話者ごとに流れます。</div>';
  els.transcriptEmpty = $("transcriptEmpty");
  els.summary.innerHTML = '<div class="empty-state">会話が進むと、状況・要点・合意・宿題・相手の懸念を自動でまとめます。</div>';
  els.moves.innerHTML = '<div class="empty-state">深掘り質問・切り返し・クロージングの好機・見落としリスクを提案します。</div>';
  els.meetingTitle.value = "";
  els.meetingUrl.value = "";
  setStatus("Botを退出させました。要約・分析は履歴に保存されます。");
}

function openSocket() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws?session=${encodeURIComponent(sessionId)}`);
  ws.addEventListener("open", () => {
    setConn("connecting");
    setStatus("文字起こしの受信を待っています…");
  });
  ws.addEventListener("message", (e) => handle(JSON.parse(e.data)));
  ws.addEventListener("close", () => setConn("idle"));
  ws.addEventListener("error", () => setConn("error"));
}

function handle(msg) {
  switch (msg.type) {
    case "status":
      if (msg.state === "no_session") setStatus("セッションが見つかりません。入り直してください。");
      else if (msg.state === "analyze_error") setStatus("分析エラー: " + (msg.message || ""));
      break;
    case "final":
      setConn("ready");
      els.sttHint.textContent = "文字起こし中";
      appendFinal(msg.text, msg.speaker);
      els.partial.textContent = "";
      break;
    case "partial":
      els.partial.textContent = labelOf(msg.speaker) + ": " + (msg.text || "");
      break;
    case "analysis":
      renderSummary(msg.summary);
      renderMoves(msg.suggestions);
      els.summaryHint.textContent = "更新: " + new Date(msg.ts).toLocaleTimeString("ja-JP");
      break;
  }
}

function labelOf(speaker) {
  if (!speaker) return "話者";
  return speaker.name || "話者" + (speaker.id ?? "");
}
function colorClass(speaker) {
  const key = labelOf(speaker);
  if (!speakerColors.has(key)) speakerColors.set(key, speakerColors.size % 3);
  return `spk-${speakerColors.get(key)}`;
}

function appendFinal(text, speaker) {
  if (!text || !text.trim()) return;
  if (els.transcriptEmpty) {
    els.transcriptEmpty.remove();
    els.transcriptEmpty = null;
  }
  const line = document.createElement("div");
  line.className = "line";
  line.innerHTML = `<span class="spk ${colorClass(speaker)}"></span><span class="txt"></span>`;
  line.querySelector(".spk").textContent = labelOf(speaker);
  line.querySelector(".txt").textContent = text;
  els.transcript.appendChild(line);
  els.transcript.scrollTop = els.transcript.scrollHeight;
}

function renderSummary(s) {
  if (!s) return;
  els.summary.innerHTML = "";
  if (s.overview) {
    const o = document.createElement("div");
    o.className = "overview";
    o.textContent = s.overview;
    els.summary.appendChild(o);
  }
  group("要点", s.key_points);
  group("合意事項", s.agreements);
  group("宿題・次アクション", s.action_items, "actions");
  group("相手の懸念", s.customer_concerns, "concerns");

  function group(label, items, extra = "") {
    if (!Array.isArray(items) || items.length === 0) return;
    const g = document.createElement("div");
    g.className = "sgroup " + extra;
    const l = document.createElement("div");
    l.className = "label";
    l.textContent = label;
    const ul = document.createElement("ul");
    for (const it of items) {
      const li = document.createElement("li");
      li.textContent = it;
      ul.appendChild(li);
    }
    g.appendChild(l);
    g.appendChild(ul);
    els.summary.appendChild(g);
  }
}

const TYPE_LABEL = {
  question: "深掘り",
  objection: "切り返し",
  closing: "クロージング",
  risk: "リスク",
  info: "補足",
};

function renderMoves(list) {
  if (!Array.isArray(list)) return;
  els.moves.innerHTML = "";
  if (list.length === 0) {
    els.moves.innerHTML = '<div class="empty-state">いまは特に提案なし。会話を続けてください。</div>';
    return;
  }
  for (const m of list) {
    const type = TYPE_LABEL[m.type] ? m.type : "info";
    const card = document.createElement("div");
    card.className = `card t-${type}`;
    card.innerHTML = `<div class="ctype"></div><div class="ctitle"></div><div class="cdetail"></div>`;
    card.querySelector(".ctype").textContent = TYPE_LABEL[type] || "補足";
    card.querySelector(".ctitle").textContent = m.title || "";
    card.querySelector(".cdetail").textContent = m.detail || "";
    els.moves.appendChild(card);
  }
}

function setConn(state) { els.conn.dataset.state = state; }
function setStatus(t) { els.status.textContent = t; }
function startTimer() {
  startedAt = Date.now();
  timerId = setInterval(() => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    els.timer.textContent =
      String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }, 1000);
}
function stopTimer() {
  if (timerId) clearInterval(timerId);
  timerId = null;
  els.timer.textContent = "00:00";
}
