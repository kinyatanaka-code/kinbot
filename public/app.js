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
  aiFeed: $("aiFeed"),
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

// 別ページから録画ページに戻ったとき、自分が進行中の商談があれば自動でライブに復帰
(async function resumeOwnLive() {
  try {
    const mine = await (await fetch("/api/sessions/mine")).json();
    if (Array.isArray(mine) && mine.length) {
      openLive(mine[0].id, { viewer: false, startedAt: mine[0].startedAt });
    }
  } catch {}
})();

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
      if (ev.url) setCalendarLinkOption(ev.url);
    });
  });
}

// 予定のリンクを登録リンクのプルダウンに「📅 この予定のリンク」として追加する。
// カレンダー選択時点ではURLは載せず、プルダウンで「予定のリンク」か「登録リンク」を選んで初めてURLが入る。
function setCalendarLinkOption(url) {
  const sel = $("linkSelect");
  if (!sel) return;
  // 既存の予定用オプションを除去
  [...sel.options].forEach((o) => { if (o.dataset.cal === "1") o.remove(); });
  const opt = document.createElement("option");
  opt.value = url;
  opt.textContent = "📅 この予定のリンク";
  opt.dataset.cal = "1";
  sel.add(opt, sel.options[1] || null); // プレースホルダの直後に挿入
  // ここでは選択もURL反映もしない（ユーザーがプルダウンで選ぶ）
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
        row.className = "calp-row";
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
  hideLiveVideo();
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
  const feed = $("aiFeed");
  if (feed) feed.innerHTML = '<div class="empty-state">商談が進むと、kinbotが「切り返し」「次の一手」を吹き出しでお知らせします。</div>';
  aiSeen = new Set();
  aiHasItems = false;
  talkChars = {};
  liveRepName = "";
  const ln = $("liveNote");
  if (ln) ln.value = "";
  const ns = $("noteSaved");
  if (ns) ns.textContent = "";
  const tw = $("talkRatio");
  if (tw) tw.hidden = true;
  const cl = $("checkList");
  if (cl) cl.innerHTML = '<div class="empty-state">会話が進むと、予算・決裁者・時期などの「聞けている／まだの項目」を表示します。</div>';
  const aitab = document.querySelector('.live-tab[data-pane="ai"]');
  if (aitab) aitab.classList.remove("alert");
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

function showLiveMessage(text) {
  const box = $("liveVideo");
  if (!box) return;
  box.hidden = false;
  showVideoTab(true);
  liveSwitchTab("video");
  const video = $("liveVideoEl");
  if (video) video.style.display = "none";
  let overlay = $("liveVideoMsg");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "liveVideoMsg";
    overlay.className = "live-video-msg";
    box.appendChild(overlay);
  }
  overlay.textContent = text;
  overlay.hidden = false;
}
async function checkMuxThenMessage() {
  try {
    const d = await (await fetch("/api/mux/status")).json();
    if (d.configured) {
      showLiveMessage(
        d.ok
          ? "ライブ映像の準備に失敗しました（この商談はMux未連携で開始された可能性）。新しい商談で再度お試しください。"
          : "Muxキーが無効の可能性があります（設定→状態で確認）。"
      );
    }
    // 未設定なら何も表示しない
  } catch {}
}

let activePane = (document.querySelector(".live-tab.active") || {}).dataset?.pane || "transcript";
function liveSwitchTab(pane) {
  activePane = pane;
  document.querySelectorAll(".live-tab").forEach((t) => t.classList.toggle("active", t.dataset.pane === pane));
  document.querySelectorAll(".live-pane").forEach((p) => (p.hidden = p.dataset.pane !== pane));
  if (pane === "ai") clearAiUnread();
}
(function initLiveTabs() {
  const tabs = document.getElementById("liveTabs");
  if (!tabs) return;
  tabs.querySelectorAll(".live-tab").forEach((t) =>
    t.addEventListener("click", () => liveSwitchTab(t.dataset.pane))
  );
})();
function showVideoTab(show) {
  const btn = document.querySelector('.live-tab[data-pane="video"]');
  if (btn) btn.hidden = !show;
}

let hls = null;
let liveVideoRetry = null;
function showLiveVideo(playbackId) {
  const box = $("liveVideo");
  const video = $("liveVideoEl");
  if (!box || !video || !playbackId) return;
  const src = `https://stream.mux.com/${playbackId}.m3u8`;
  box.hidden = false;
  video.style.display = "";
  showVideoTab(true);
  liveSwitchTab("video");
  let overlay = $("liveVideoMsg");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "liveVideoMsg";
    overlay.className = "live-video-msg";
    box.appendChild(overlay);
  }
  overlay.textContent = "ライブ映像を準備中…(開始直後は数十秒かかります)";
  overlay.hidden = false;

  const clearRetry = () => {
    if (liveVideoRetry) {
      clearTimeout(liveVideoRetry);
      liveVideoRetry = null;
    }
  };
  const onPlaying = () => {
    overlay.hidden = true;
    clearRetry();
  };

  const showUnmuteButton = () => {
    let btn = document.getElementById("liveUnmuteBtn");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "liveUnmuteBtn";
      btn.className = "live-unmute-btn";
      btn.textContent = "🔇 タップで音声をオンにする";
      btn.addEventListener("click", () => {
        video.muted = false;
        video.play().catch(() => {});
        btn.hidden = true;
      });
      box.appendChild(btn);
    }
    btn.hidden = false;
  };

  const tryPlayWithSound = () => {
    // まず音声ありで再生を試みる。ブラウザにブロックされたらミュートで再生し、
    // 「音声をオンにする」ボタンを表示する（クリックで音声オン）。
    video.muted = false;
    video.play().catch(() => {
      video.muted = true;
      video.play().catch(() => {});
      showUnmuteButton();
    });
  };

  const attach = () => {
    try {
      if (window.Hls && window.Hls.isSupported()) {
        if (hls) {
          try { hls.destroy(); } catch {}
        }
        hls = new window.Hls({ liveSyncDuration: 4 });
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(window.Hls.Events.ERROR, (_e, data) => {
          // ストリーム未開始（404等）は時間をおいて再試行
          if (data && data.fatal) {
            clearRetry();
            liveVideoRetry = setTimeout(attach, 5000);
          }
        });
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
      }
      tryPlayWithSound();
    } catch {
      clearRetry();
      liveVideoRetry = setTimeout(attach, 5000);
    }
  };
  video.addEventListener("playing", onPlaying);
  attach();
}
function hideLiveVideo() {
  const box = $("liveVideo");
  const video = $("liveVideoEl");
  if (liveVideoRetry) {
    clearTimeout(liveVideoRetry);
    liveVideoRetry = null;
  }
  if (hls) {
    try { hls.destroy(); } catch {}
    hls = null;
  }
  if (video) {
    try { video.pause(); video.removeAttribute("src"); video.load(); } catch {}
  }
  if (box) box.hidden = true;
  const ub = document.getElementById("liveUnmuteBtn");
  if (ub) ub.hidden = true;
  showVideoTab(false);
  const onVideo = document.querySelector('.live-pane[data-pane="video"]');
  if (onVideo && !onVideo.hidden) liveSwitchTab("transcript");
}

function handle(msg) {
  switch (msg.type) {
    case "session":
      // 実際のライブ開始時刻にタイマーを合わせる
      if (msg.startedAt) startTimer(msg.startedAt);
      if (msg.repName) liveRepName = msg.repName;
      // ライブ映像（Mux）
      if (msg.isOwner) {
        // 会議に参加中の本人：音声二重防止のため映像は出さない
        hideLiveVideo();
      } else if (msg.muxPlaybackId) {
        showLiveVideo(msg.muxPlaybackId);
      } else if (msg.muxError) {
        showLiveMessage("ライブ映像を開始できませんでした: " + msg.muxError);
      } else {
        // Muxが有効なのに再生IDが無い場合のみ案内（未設定なら何も出さない）
        checkMuxThenMessage();
      }
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
      addTalk(msg.speaker, msg.text);
      els.partial.textContent = "";
      break;
    case "partial":
      els.partial.textContent = labelOf(msg.speaker) + ": " + (msg.text || "");
      break;
    case "analysis":
      renderSummary(msg.summary);
      renderCoverage(msg.coverage);
      renderAiFeed(msg.objections, msg.suggestions, msg.ts, msg.landed);
      els.summaryHint.textContent = "更新: " + new Date(msg.ts).toLocaleTimeString("ja-JP");
      kinbotSpeakFromAnalysis(msg);
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

function renderCoverage(list) {
  const box = $("checkList");
  if (!box || !Array.isArray(list)) return;
  if (list.length === 0) {
    box.innerHTML = '<div class="empty-state">まだ判定できる発言がありません。</div>';
    return;
  }
  const meta = {
    covered: { cls: "ok", icon: "✓", label: "確認済み" },
    partial: { cls: "partial", icon: "◐", label: "一部" },
    missing: { cls: "miss", icon: "○", label: "未確認" },
  };
  const done = list.filter((i) => i.status === "covered").length;
  const hint = $("checkHint");
  if (hint) hint.textContent = `${done}/${list.length} 確認済み`;
  box.innerHTML = "";
  for (const it of list) {
    const m = meta[it.status] || meta.missing;
    const row = document.createElement("div");
    row.className = `check-item ${m.cls}`;
    row.innerHTML =
      `<span class="check-ic">${m.icon}</span>` +
      `<div class="check-body"><div class="check-name"></div><div class="check-note"></div></div>` +
      `<span class="check-tag">${m.label}</span>`;
    row.querySelector(".check-name").textContent = it.item || "";
    row.querySelector(".check-note").textContent = it.note || "";
    box.appendChild(row);
  }
}

const COACH_TAG = {
  obj:   { label: "気になるサイン", cls: "amber" },
  q:     { label: "聞いておきたい", cls: "blue" },
  close: { label: "次の一手", cls: "mint" },
  rebut: { label: "切り返し", cls: "amber" },
  info:  { label: "メモ", cls: "gray" },
  land:  { label: "ナイス", cls: "green" },
  reply: { label: "", cls: "gray" },
};
function aiBubble({ kind, text, quote, quoteLabel, sub, time, you }) {
  const wrap = document.createElement("div");
  if (you) {
    wrap.className = "coach-msg coach-you";
    wrap.innerHTML = `<div class="coach-bub coach-bub-you"><div class="coach-text">${escAi(text)}</div></div>`;
    return wrap;
  }
  wrap.className = "coach-msg";
  const meta = COACH_TAG[kind] || COACH_TAG.info;
  const isLand = kind === "land";
  const tag = isLand || !meta.label ? "" : `<span class="coach-tag coach-tag-${meta.cls}">${escAi(meta.label)}</span>`;
  const q = quote
    ? `<div class="coach-quote"><div class="coach-quote-h">${escAi(quoteLabel || "こう言ってみよう")}</div><div class="coach-quote-t">${escAi(quote)}</div></div>`
    : "";
  const sb = sub ? `<div class="coach-sub">${escAi(sub)}</div>` : "";
  const tm = time ? `<div class="coach-time">${escAi(time)}</div>` : "";
  wrap.innerHTML =
    `<img class="coach-ava" src="kinbot.svg" alt="kinbot" />` +
    `<div class="coach-col"><div class="coach-bub ${isLand ? "coach-bub-land" : "coach-bub-normal"}">${tag}<div class="coach-text">${escAi(text)}</div>${q}${sb}</div>${tm}</div>`;
  return wrap;
}
function escAi(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
let aiSeen = new Set();
let aiHasItems = false;
let liveRepName = "";
let talkChars = {}; // speakerラベル -> 文字数
function addTalk(speaker, text) {
  const label = (speaker && (speaker.name || (speaker.id != null ? "話者" + speaker.id : ""))) || "話者";
  talkChars[label] = (talkChars[label] || 0) + String(text || "").length;
  renderTalkRatio();
}
function renderTalkRatio() {
  const box = $("trChips");
  const wrap = $("talkRatio");
  if (!box || !wrap) return;
  const entries = Object.entries(talkChars).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (!total) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const rep = liveRepName ? liveRepName.replace(/\s+/g, "") : "";
  box.innerHTML = "";
  for (const [label, n] of entries.slice(0, 5)) {
    const pct = Math.round((n / total) * 100);
    const isRep = rep && label.replace(/\s+/g, "").includes(rep);
    const chip = document.createElement("div");
    chip.className = "tr-chip" + (isRep ? " me" : "");
    chip.innerHTML =
      `<div class="tr-chip-top"><span class="tr-name">${escAi(isRep ? label + "（あなた）" : label)}</span><span class="tr-pct">${pct}%</span></div>` +
      `<div class="tr-track"><div class="tr-fill" style="width:${pct}%"></div></div>`;
    box.appendChild(chip);
  }
  // 自分が話しすぎなら注意
  const warn = $("trWarn");
  if (warn) {
    let repPct = 0;
    if (rep) {
      const repChars = entries.filter(([l]) => l.replace(/\s+/g, "").includes(rep)).reduce((s, [, n]) => s + n, 0);
      repPct = Math.round((repChars / total) * 100);
    }
    warn.hidden = !(rep && repPct >= 65);
  }
}
function aiKey(s) {
  return String(s || "").replace(/\s+/g, "").slice(0, 60);
}
function renderAiFeed(objections, suggestions, ts, landed) {
  const feed = $("aiFeed");
  if (!feed) return;
  const objs = Array.isArray(objections) ? objections : [];
  const sugs = Array.isArray(suggestions) ? suggestions : [];
  const lands = Array.isArray(landed) ? landed : [];
  const time = new Date(ts || Date.now()).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

  const toAdd = [];
  const newItems = []; // {kind, snippet}
  // 懸念 → 刺さった言い返し
  for (const o of objs) {
    const key = "obj:" + aiKey(o.objection) + aiKey(o.response);
    if (aiSeen.has(key)) continue;
    aiSeen.add(key);
    const lead = o.objection
      ? `お客さんが「${o.objection}」と気にしているみたい。ここで流さず切り返しておこう。`
      : `気になる反応が出てるよ。ここで切り返しておこう。`;
    toAdd.push(aiBubble({ kind: "obj", text: lead, quote: o.response || "", quoteLabel: "こう言ってみよう", sub: o.basis ? "根拠: " + o.basis : "", time }));
    newItems.push({ kind: "obj", snippet: o.objection ? `「${o.objection}」が引っかかってるよ。切り返そう` : "気になる反応。切り返そう" });
  }
  // 刺さったトーク（ほめ）
  for (const g of lands) {
    const key = "land:" + aiKey(g.text);
    if (aiSeen.has(key)) continue;
    aiSeen.add(key);
    const t = g.text ? `「${g.text}」、刺さってたよ。いい流れ！` : `今のトーク、刺さってた！いい流れ。`;
    toAdd.push(aiBubble({ kind: "land", text: t, sub: g.why || "", time }));
    newItems.push({ kind: "land", snippet: "今のトーク刺さってた！いい流れ" });
  }
  // 次の一手
  for (const m of sugs) {
    const key = "sug:" + aiKey(m.title) + aiKey(m.detail);
    if (aiSeen.has(key)) continue;
    aiSeen.add(key);
    const map = { question: "q", closing: "close", objection: "rebut", info: "info" };
    const kind = map[m.type] || "info";
    const qLabel = kind === "q" ? "こう聞いてみよう" : kind === "close" ? "こう切り出そう" : "こう言ってみよう";
    const useQuote = kind !== "info";
    toAdd.push(
      aiBubble({
        kind,
        text: m.title || (kind === "q" ? "これ、聞いておこう。" : "次はこう動こう。"),
        quote: useQuote ? m.detail || "" : "",
        quoteLabel: qLabel,
        sub: useQuote ? "" : m.detail || "",
        time,
      })
    );
    newItems.push({ kind, snippet: m.title || (kind === "q" ? "これ聞いておこう" : "次の一手があるよ") });
  }
  if (!toAdd.length) return;
  if (!aiHasItems) {
    feed.innerHTML = "";
    aiHasItems = true;
  }
  for (const el of toAdd) feed.appendChild(el);
  feed.scrollTop = feed.scrollHeight;

  // AI提案タブ以外を見ているときは通知（重要なものはトースト＋未読バッジ）
  if (activePane !== "ai" && newItems.length) {
    const PRIO = { obj: 0, close: 1, rebut: 2, q: 3, land: 4, info: 5 };
    const top = [...newItems].sort((a, b) => (PRIO[a.kind] ?? 9) - (PRIO[b.kind] ?? 9))[0];
    addAiUnread(newItems.length);
    // 補足(info)・ほめ(land)だけならバッジのみ、重要(懸念/質問/次の一手/切り返し)はトーストも出す
    const important = newItems.some((i) => i.kind === "obj" || i.kind === "close" || i.kind === "q" || i.kind === "rebut");
    if (important) showCoachToast(top, newItems.length);
  }
}

let aiUnread = 0;
let coachToastTimer = null;
function aiTabEl() { return document.querySelector('.live-tab[data-pane="ai"]'); }
function addAiUnread(n) {
  aiUnread += n;
  const tab = aiTabEl();
  if (!tab) return;
  let b = tab.querySelector(".live-badge");
  if (!b) { b = document.createElement("span"); b.className = "live-badge"; tab.appendChild(b); }
  b.textContent = aiUnread > 99 ? "99+" : String(aiUnread);
  tab.classList.add("alert");
}
function clearAiUnread() {
  aiUnread = 0;
  const tab = aiTabEl();
  if (tab) { const b = tab.querySelector(".live-badge"); if (b) b.remove(); tab.classList.remove("alert"); }
}
const TOAST_TAG = {
  obj: { label: "気になるサイン", cls: "amber" },
  q: { label: "聞いておきたい", cls: "blue" },
  close: { label: "次の一手", cls: "mint" },
  rebut: { label: "切り返し", cls: "amber" },
  land: { label: "ナイス", cls: "green" },
  info: { label: "メモ", cls: "gray" },
};
function showCoachToast(item, count) {
  let t = document.getElementById("coachToast");
  if (!t) {
    t = document.createElement("div");
    t.id = "coachToast";
    t.className = "coach-toast";
    document.body.appendChild(t);
    t.addEventListener("click", (e) => {
      if (e.target.closest(".coach-toast-x")) { hideCoachToast(); e.stopPropagation(); return; }
      liveSwitchTab("ai");
      const feed = $("aiFeed"); if (feed) feed.scrollTop = feed.scrollHeight;
      hideCoachToast();
    });
  }
  const meta = TOAST_TAG[item.kind] || TOAST_TAG.info;
  const more = count > 1 ? `<span class="coach-toast-more">+${count - 1}件</span>` : "";
  t.innerHTML =
    `<img class="coach-toast-ava" src="kinbot.svg" alt="kinbot" />` +
    `<div class="coach-toast-body"><div class="coach-toast-top"><span class="coach-tag coach-tag-${meta.cls}">${escAi(meta.label)}</span>${more}</div>` +
    `<div class="coach-toast-text">${escAi(item.snippet)}</div></div>` +
    `<div class="coach-toast-act"><span class="coach-toast-x" aria-label="閉じる">×</span><span class="coach-toast-open">開く</span></div>`;
  t.classList.add("show");
  clearTimeout(coachToastTimer);
  coachToastTimer = setTimeout(hideCoachToast, 6000);
}
function hideCoachToast() {
  const t = document.getElementById("coachToast");
  if (t) t.classList.remove("show");
  clearTimeout(coachToastTimer);
}

let kinbotSayTimer = null;
function kinbotSpeak(text) {
  const say = $("kinbotSay");
  const av = $("kinbotAv");
  if (say && text) say.textContent = text;
  if (av) {
    av.classList.add("talking");
    if (kinbotSayTimer) clearTimeout(kinbotSayTimer);
    kinbotSayTimer = setTimeout(() => av.classList.remove("talking"), 3800);
  }
}
function kinbotSpeakFromAnalysis(msg) {
  // 優先度: 懸念(言い返し) > 刺さったトーク > 次の一手 > 要約
  const obj = Array.isArray(msg.objections) && msg.objections[0];
  if (obj && obj.response) { kinbotSpeak("「" + (obj.objection || "懸念") + "」には… " + obj.response); return; }
  const land = Array.isArray(msg.landed) && msg.landed[0];
  if (land && land.text) { kinbotSpeak("💡 刺さってます: " + land.text); return; }
  const sug = Array.isArray(msg.suggestions) && msg.suggestions[0];
  if (sug && (sug.title || sug.detail)) { kinbotSpeak((sug.title ? sug.title + "：" : "") + (sug.detail || "")); return; }
  const ov = msg.summary && msg.summary.overview;
  if (ov) kinbotSpeak(ov);
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

// ===== 商談中メモ（自動保存） =====
(function () {
  const ta = document.getElementById("liveNote");
  if (!ta) return;
  let t = null;
  const saved = document.getElementById("noteSaved");
  ta.addEventListener("input", () => {
    if (!sessionId) return;
    if (saved) saved.textContent = "保存中…";
    clearTimeout(t);
    t = setTimeout(async () => {
      try {
        await fetch(`/api/meetings/${encodeURIComponent(sessionId)}/note`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ note: ta.value }),
        });
        if (saved) saved.textContent = "保存しました " + new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
      } catch {
        if (saved) saved.textContent = "保存に失敗（接続を確認）";
      }
    }, 800);
  });
})();

// コーチに質問（ライブ中）
(function () {
  const btn = document.getElementById("coachAskBtn");
  const inp = document.getElementById("coachAsk");
  if (!btn || !inp) return;
  const send = async () => {
    const q = (inp.value || "").trim();
    if (!q || !sessionId) return;
    const feed = $("aiFeed");
    if (aiHasItems === false && feed) { feed.innerHTML = ""; aiHasItems = true; }
    feed.appendChild(aiBubble({ you: true, text: q }));
    const time = new Date().toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
    const thinking = aiBubble({ kind: "reply", text: "考え中…", time });
    feed.appendChild(thinking);
    feed.scrollTop = feed.scrollHeight;
    inp.value = "";
    btn.disabled = true;
    try {
      const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const d = await r.json();
      thinking.remove();
      if (!r.ok) throw new Error(d.error || "応答に失敗");
      feed.appendChild(aiBubble({ kind: "reply", text: d.reply || "（回答なし）", time }));
    } catch (e) {
      thinking.remove();
      feed.appendChild(aiBubble({ kind: "reply", text: "うまく答えられなかった…(" + e.message + ")", time }));
    } finally {
      btn.disabled = false;
      feed.scrollTop = feed.scrollHeight;
    }
  };
  btn.addEventListener("click", send);
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } });
})();
