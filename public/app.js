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
  activeList: $("activeList"),
};

let sessionId = null;
let ws = null;
let timerId = null;
let startedAt = 0;
let viewerMode = false; // 他人の商談を閲覧中（退出でBotを止めない）
let activePollId = null;
const speakerColors = new Map();

els.joinBtn.addEventListener("click", joinMeeting);
els.leaveBtn.addEventListener("click", leaveMeeting);

// 進行中の商談一覧（全員が閲覧できる）
async function refreshActive() {
  if (!els.activeList) return;
  try {
    const [active, meetings] = await Promise.all([
      fetch("/api/sessions/active").then((r) => r.json()),
      fetch("/api/meetings").then((r) => r.json()),
    ]);
    const metaById = {};
    for (const m of meetings || []) metaById[m.bot_id] = m;
    if (!Array.isArray(active) || active.length === 0) {
      els.activeList.innerHTML = '<div class="empty-state">いま進行中の商談はありません。</div>';
      return;
    }
    els.activeList.innerHTML = "";
    for (const a of active) {
      const meta = metaById[a.botId] || {};
      const title = a.title || meta.title || "(商談名なし)";
      const who = meta.owner_name || a.repName || a.owner || "";
      const card = document.createElement("button");
      card.className = "active-card";
      card.innerHTML = `<span class="ac-live">● LIVE</span><span class="ac-title"></span><span class="ac-who"></span>`;
      card.querySelector(".ac-title").textContent = title;
      card.querySelector(".ac-who").textContent = who;
      card.addEventListener("click", () => openLive(a.botId, { viewer: true, startedAt: a.startedAt }));
      els.activeList.appendChild(card);
    }
  } catch {}
}
function startActivePoll() {
  refreshActive();
  if (activePollId) clearInterval(activePollId);
  activePollId = setInterval(refreshActive, 10000);
}
function stopActivePoll() {
  if (activePollId) clearInterval(activePollId);
  activePollId = null;
}
startActivePoll();

// 商談名：カレンダーからその日の予定を選ぶ（日付切替つき）
const calBtn = $("calBtn");
const calPanel = $("calPanel");
if (calBtn && calPanel) {
  document.addEventListener("click", (e) => {
    if (!calPanel.hidden && !calPanel.contains(e.target) && e.target !== calBtn) calPanel.hidden = true;
  });
  calBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!calPanel.hidden) {
      calPanel.hidden = true;
      return;
    }
    openCalPicker(calPanel, (ev) => {
      $("meetingTitle").value = ev.title;
      if (ev.url && $("meetingUrl")) $("meetingUrl").value = ev.url;
    });
  });
}

// カレンダー予定ピッカー（日付切替つき）。panel に描画し、選択時 onPick(ev) を呼ぶ。
function jstToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function shiftDate(dateStr, delta) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
function openCalPicker(panel, onPick) {
  panel.hidden = false;
  let date = jstToday();
  const render = async () => {
    panel.innerHTML = `<div class="cal-bar"><button type="button" class="cal-nav" data-d="-1">‹</button><input type="date" class="cal-date" value="${date}"><button type="button" class="cal-nav" data-d="1">›</button></div><div class="cal-list"><div class="cal-empty">読み込み中…</div></div>`;
    const dateInput = panel.querySelector(".cal-date");
    const list = panel.querySelector(".cal-list");
    panel.querySelectorAll(".cal-nav").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        date = shiftDate(date, Number(b.dataset.d));
        render();
      })
    );
    dateInput.addEventListener("click", (e) => e.stopPropagation());
    dateInput.addEventListener("change", () => {
      date = dateInput.value || date;
      render();
    });
    try {
      const d = await (await fetch("/api/calendar/events?date=" + encodeURIComponent(date))).json();
      if (!d.connected) {
        list.innerHTML = '<div class="cal-empty">カレンダー未連携です。「設定」から連携してください。</div>';
        return;
      }
      const events = d.events || [];
      if (!events.length) {
        list.innerHTML = d.filtered
          ? '<div class="cal-empty">条件に一致する予定はありません（設定のフィルター文字を確認）。</div>'
          : '<div class="cal-empty">この日の予定はありません。</div>';
        return;
      }
      list.innerHTML = "";
      for (const ev of events) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "cal-row";
        const time = ev.allDay
          ? "終日"
          : new Date(ev.start).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
        row.innerHTML = `<span class="cal-time"></span><span class="cal-name"></span>${ev.url ? '<span class="cal-mark">URL</span>' : ""}`;
        row.querySelector(".cal-time").textContent = time;
        row.querySelector(".cal-name").textContent = ev.title;
        row.addEventListener("click", () => {
          onPick(ev);
          panel.hidden = true;
        });
        list.appendChild(row);
      }
    } catch {
      list.innerHTML = '<div class="cal-empty">読み込みに失敗しました。</div>';
    }
  };
  render();
}


const upBtn = $("upBtn");
if (upBtn) {
  upBtn.addEventListener("click", async () => {
    const fileEl = $("upFile");
    const msg = $("upMsg");
    const file = fileEl && fileEl.files && fileEl.files[0];
    if (!file) {
      msg.textContent = "ファイルを選んでください。";
      return;
    }
    upBtn.disabled = true;
    const orig = upBtn.textContent;
    upBtn.textContent = "アップロード中…";
    msg.textContent = "アップロード中です。完了まで画面を閉じないでください。";
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("title", ($("upTitle") && $("upTitle").value.trim()) || "");
      const res = await fetch("/api/uploads", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "アップロードに失敗しました");
      msg.textContent = "アップロード完了。文字起こし・要約・分析を作成中です。数分後に商談履歴に表示されます。";
      fileEl.value = "";
      if ($("upTitle")) $("upTitle").value = "";
    } catch (e) {
      msg.textContent = "失敗しました: " + e.message;
    } finally {
      upBtn.disabled = false;
      upBtn.textContent = orig;
    }
  });
}

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
    openLive(data.sessionId, { viewer: false });
    setStatus("Botが入室処理中です。会議で参加を許可してください。");
  } catch (e) {
    setStatus("開始できませんでした: " + e.message);
    els.joinBtn.disabled = false;
  }
}

// ライブ画面を開く（自分の商談 or 他人の商談の閲覧）
function openLive(botId, { viewer, startedAt }) {
  sessionId = botId;
  viewerMode = !!viewer;
  stopActivePoll();
  openSocket();
  enterLiveMode(startedAt);
  els.leaveBtn.textContent = viewer ? "閉じる" : "退出";
}

function enterLiveMode(startedAtMs) {
  els.viewJoin.hidden = true;
  els.viewLive.hidden = false;
  els.liveControls.hidden = false;
  els.sttHint.textContent = "接続待ち";
  startTimer(startedAtMs);
}

async function leaveMeeting() {
  // 自分が開始した商談だけ、退出でBotを止める。閲覧中は接続を閉じるだけ。
  if (sessionId && !viewerMode) {
    try {
      await fetch(`/api/sessions/${sessionId}/stop`, { method: "POST" });
    } catch {}
  }
  resetToJoin("待機中");
}

// サーバーからライブ終了の通知が来たとき（視聴者も自動で閉じる）
function endedByServer() {
  resetToJoin(viewerMode ? "この商談は終了しました。" : "商談が終了しました。要約・分析は履歴に保存されます。");
}

function resetToJoin(statusMsg) {
  if (ws) {
    try { ws.close(); } catch {}
  }
  ws = null;
  sessionId = null;
  viewerMode = false;
  stopTimer();
  setConn("idle");
  els.liveControls.hidden = true;
  els.viewLive.hidden = true;
  els.viewJoin.hidden = false;
  els.joinBtn.disabled = false;
  els.sttHint.textContent = "待機中";
  els.partial.textContent = "";
  els.transcript.innerHTML = '<div class="empty-state" id="transcriptEmpty">Botが入室すると、発言が話者ごとに流れます。</div>';
  els.transcriptEmpty = $("transcriptEmpty");
  els.summary.innerHTML = '<div class="empty-state">会話が進むと、状況・要点・合意・宿題・相手の懸念を自動でまとめます。</div>';
  els.moves.innerHTML = '<div class="empty-state">深掘り質問・切り返し・クロージングの好機・見落としリスクを提案します。</div>';
  els.meetingTitle.value = "";
  els.meetingUrl.value = "";
  setStatus(statusMsg || "待機中");
  startActivePoll();
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
    case "session":
      // 実際のライブ開始時刻にタイマーを合わせる
      if (msg.startedAt) startTimer(msg.startedAt);
      break;
    case "ended":
      endedByServer();
      break;
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
function startTimer(baseMs) {
  startedAt = baseMs || Date.now();
  if (timerId) clearInterval(timerId);
  const tick = () => {
    const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
    els.timer.textContent =
      String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  };
  tick();
  timerId = setInterval(tick, 1000);
}
function stopTimer() {
  if (timerId) clearInterval(timerId);
  timerId = null;
  els.timer.textContent = "00:00";
}
