// server/sessions.js
import { analyze, analyzeMeeting, analyzeDeep, answerQuestion, extractQaPairs, splitPhases } from "./analyzer.js";
import { createMeeting, saveMeeting, saveAnalysis, saveDeepAnalysis, getMeeting, setDealStatusAuto, getSettings, companyFromTitle, getDealBrief, normCompanyKey, getKnowledgeContext, searchQaBank, addQaPairs, saveChapters } from "./db.js";
import { buildChapters } from "./chapters.js";
import { disableLiveStream } from "./live.js";

const DEFAULT_INTERVAL_MS = Number(process.env.ANALYZE_INTERVAL_MS || 30000);
// 前回の分析からこれだけ話が進んでいなければ、AIを呼ばない（無駄な課金を減らす）
const MIN_NEW_CHARS = Number(process.env.ANALYZE_MIN_CHARS || 250);
// 商談以外（社内MTG・ユーザーフォロー）はライブ分析をしない
const SKIP_LIVE = /【\s*社内MTG\s*】|【\s*ユ\s*\/\s*フォ\s*】/;

const sessions = new Map(); // botId -> Session

export function createSession(botId, { repName = "", meetingUrl = "", title = "", owner = "", analyzeIntervalMs, muxPlaybackId = "", muxLiveStreamId = "", muxError = "", liveRtmpUrl = "" } = {}) {
  const s = new Session(botId, { repName, meetingUrl, title, owner, muxPlaybackId, muxLiveStreamId, muxError }, analyzeIntervalMs || DEFAULT_INTERVAL_MS);
  s.liveRtmpUrl = liveRtmpUrl;
  sessions.set(botId, s);
  createMeeting(botId, { meetingUrl, repName, title, owner, muxPlaybackId }); // 履歴に行を作成（DB無効なら無視）
  return s;
}
export function getSession(botId) {
  return sessions.get(botId);
}
export function removeSession(botId) {
  const s = sessions.get(botId);
  if (s) s.dispose();
  sessions.delete(botId);
}
// 進行中の商談一覧（全員が閲覧できる）
export function listActiveSessions() {
  return [...sessions.values()].map((s) => ({
    botId: s.botId,
    title: s.title || "",
    owner: s.owner || "",
    repName: s.repName || "",
    startedAt: s.startedAt,
    utterances: s.utterances.length,
    muxPlaybackId: s.muxPlaybackId || "",
    muxLiveStreamId: s.muxLiveStreamId || "",
    liveRtmpUrl: s.liveRtmpUrl || "",
  }));
}

class Session {
  constructor(botId, { repName = "", meetingUrl = "", title = "", owner = "", muxPlaybackId = "", muxLiveStreamId = "", muxError = "" } = {}, intervalMs) {
    this.botId = botId;
    this.repName = repName;
    this.meetingUrl = meetingUrl;
    this.title = title;
    this.owner = owner;
    this.muxPlaybackId = muxPlaybackId;
    this.muxLiveStreamId = muxLiveStreamId;
    this.muxError = muxError;
    this.startedAt = Date.now();
    this.utterances = []; // {speaker:{id,name}, text, ts}
    this.sockets = new Set();
    this.prevSummary = null;
    this.lastAnalyzedLen = 0;
    this.analyzing = false;
    this.cooldownUntil = 0; // 429などで一時停止する時刻
    this.aiLog = []; // AI提案チャットの全ログ（重複除外して蓄積）
    this.aiSeen = new Set();
    this.focusItems = [];       // この商談の重点（事前ブリーフの「今日詰めるべき点」）
    this.focusLoaded = false;
    this.timer = setInterval(() => this.maybeAnalyze(), intervalMs);
  }
  // 後から判明した商談名/所有者/Mux再生IDを補完（予約Bot用）
  enrich({ title, owner, repName, muxPlaybackId }) {
    // 「無題」のときも入れ替える
    const bad = (t) => !String(t || "").trim() || /^[（(]?無題[）)]?$/.test(String(t).trim());
    if (title && bad(this.title)) { this.title = title; this.focusLoaded = false; }
    if (owner && !this.owner) this.owner = owner;
    if (repName && !this.repName) this.repName = repName;
    if (muxPlaybackId && !this.muxPlaybackId) this.muxPlaybackId = muxPlaybackId;
  }

  // この商談の会社の事前ブリーフから「今日詰めるべき点」を取り込む（1回だけ）
  async loadFocusItems() {
    if (this.focusLoaded) return;
    this.focusLoaded = true;
    try {
      const company = companyFromTitle(this.title) || this.title || "";
      if (!company) return;
      const b = await getDealBrief(normCompanyKey(company));
      const focus = b && b.brief && Array.isArray(b.brief.focus) ? b.brief.focus : [];
      this.focusItems = focus.slice(0, 6);
    } catch {}
  }

  addSocket(ws, user = "") {
    this.sockets.add(ws);
    // Botを入れた本人（会議に参加中）は音声が二重になるため映像を出さない。
    // 視聴者（それ以外）のみライブ映像を受け取る。
    const isOwner = !!(user && this.owner && user === this.owner);
    this.sendTo(ws, {
      type: "session",
      startedAt: this.startedAt,
      repName: this.repName || "",
      // 録画している本人には、再生用のIDを渡さない。
      // 同じ会議に出ているので見る必要がなく、音が二重に聞こえてしまうため。
      muxPlaybackId: isOwner ? "" : this.muxPlaybackId || "",
      muxError: this.muxError || "",
      isOwner,
    });
    // 既存の文字起こしを再送（途中参加の画面用）
    for (const u of this.utterances) {
      this.sendTo(ws, { type: "final", speaker: u.speaker, text: u.text, ts: u.ts });
    }
    if (this.prevSummary) {
      this.sendTo(ws, {
        type: "analysis",
        summary: this.prevSummary,
        suggestions: this.lastSuggestions || [],
        ts: Date.now(),
      });
    }
  }
  removeSocket(ws) {
    this.sockets.delete(ws);
  }
  sendTo(ws, obj) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  }
  broadcast(obj) {
    const msg = JSON.stringify(obj);
    for (const ws of this.sockets) if (ws.readyState === ws.OPEN) ws.send(msg);
  }

  onFinal(speaker, text, off) {
    const u = { speaker, text, ts: Date.now() };
    if (typeof off === "number" && isFinite(off)) u.off = off; // 録画の先頭からの秒数
    this.utterances.push(u);
    this.broadcast({ type: "final", speaker, text, ts: u.ts });
    this.maybeAnswer(speaker, text); // 顧客の質問ならその場で回答案を出す
  }

  // 顧客からの質問かどうか
  isCustomer(speaker) {
    const name = String((speaker && speaker.name) || "").replace(/\s+/g, "");
    const rep = String(this.repName || "").replace(/\s+/g, "");
    if (!rep) return false;           // 担当者が分からないときは判定しない
    return !name.includes(rep);
  }
  static looksLikeQuestion(text) {
    const t = String(text || "").trim();
    if (t.length < 6) return false;
    return /[?？]$|ですか[。？?]?$|ますか[。？?]?$|でしょうか|ますでしょうか|教えて(いただけ|くださ)|どのくらい|いくら|可能でしょうか|できますか|なぜ|どうやって|違いは|対応して(いますか|ますか)/.test(t);
  }

  // 質問を検知したら、その場で回答案を作って画面に出す
  async maybeAnswer(speaker, text) {
    try {
      if (!this.isCustomer(speaker)) return;
      if (!Session.looksLikeQuestion(text)) return;
      if (this.answering) return;
      if (Date.now() < (this.answerCooldownUntil || 0)) return;
      this.answering = true;
      this.answerCooldownUntil = Date.now() + 6000; // 連発しないように
      // 先に「考えています」を出して、待たされている感じを減らす
      this.broadcast({ type: "answering", question: text, ts: Date.now() });

      if (this.knowledgeCtx === undefined) {
        this.knowledgeCtx = await getKnowledgeContext(5000).catch(() => "");
      }
      const context = this.utterances.slice(-8)
        .map((u) => `${(u.speaker && u.speaker.name) || "話者"}: ${u.text}`)
        .join("\n");
      // これまでの商談で同じような質問にどう答えたかを探して、参考として渡す
      let pastQa = [];
      try { pastQa = await searchQaBank(text, 4); } catch {}
      const r = await answerQuestion({
        question: text,
        context,
        knowledge: this.knowledgeCtx,
        pastQa,
        repName: this.repName,
      });
      if (!r.answer) { this.broadcast({ type: "answer_failed", ts: Date.now() }); return; }
      const ts = Date.now();
      this.broadcast({ type: "answer", question: text, ...r, ts });
      this.aiLog.push({ t: "qa", question: text, answer: r.answer, basis: r.basis || "", caution: r.caution || "", ts });
      saveMeeting(this.botId, { aiLog: this.aiLog });
    } catch (e) {
      console.error("[即答]", e.message);
      this.broadcast({ type: "answer_failed", ts: Date.now() });
    } finally {
      this.answering = false;
    }
  }
  onPartial(speaker, text) {
    this.broadcast({ type: "partial", speaker, text });
  }

  transcriptText() {
    return this.utterances
      .map((u) => `${u.speaker.name || "話者" + (u.speaker.id ?? "")}: ${u.text}`)
      .join("\n");
  }

  appendAiLog(result) {
    const norm = (s) => String(s || "").replace(/\s+/g, "").slice(0, 60);
    const ts = Date.now();
    for (const o of result.objections || []) {
      const key = "obj:" + norm(o.objection) + norm(o.response);
      if (this.aiSeen.has(key)) continue;
      this.aiSeen.add(key);
      this.aiLog.push({ t: "obj", objection: o.objection || "", response: o.response || "", basis: o.basis || "", ts });
    }
    for (const m of result.suggestions || []) {
      const key = "sug:" + norm(m.title) + norm(m.detail);
      if (this.aiSeen.has(key)) continue;
      this.aiSeen.add(key);
      this.aiLog.push({ t: "sug", sugType: m.type || "info", title: m.title || "", detail: m.detail || "", ts });
    }
    for (const g of result.landed || []) {
      const key = "land:" + norm(g.text);
      if (this.aiSeen.has(key)) continue;
      this.aiSeen.add(key);
      this.aiLog.push({ t: "land", text: g.text || "", why: g.why || "", ts });
    }
  }

  async maybeAnalyze() {
    if (Date.now() < this.cooldownUntil) return; // 429などで休止中
    if (SKIP_LIVE.test(String(this.title || ""))) return; // 商談以外はライブ分析しない
    const full = this.transcriptText();
    if (full.length - this.lastAnalyzedLen < MIN_NEW_CHARS) return;
    if (this.analyzing) return;
    this.analyzing = true;
    const lenAtStart = full.length;
    try {
      await this.loadFocusItems();
      const result = await analyze({
        transcript: full.slice(-8000),
        prevSummary: this.prevSummary,
        repName: this.repName,
        extraItems: this.focusItems,
      });
      this.prevSummary = result.summary;
      this.lastSuggestions = result.suggestions;
      this.lastAnalyzedLen = lenAtStart;
      this.appendAiLog(result);
      this.broadcast({ type: "analysis", ...result, ts: Date.now() });
      saveMeeting(this.botId, {
        transcript: this.utterances,
        summary: result.summary,
        suggestions: result.suggestions,
        aiLog: this.aiLog,
      });
    } catch (err) {
      console.error("[analyze]", err.message);
      // レート上限(429)のときは少し長めに休んでムダ撃ちを防ぐ
      if (/\b429\b/.test(err.message)) {
        this.cooldownUntil = Date.now() + 60000;
        this.broadcast({
          type: "status",
          state: "analyze_error",
          message: "要約AIの無料枠の上限に達しました（約1分休止して再試行します）。",
        });
      } else {
        this.broadcast({ type: "status", state: "analyze_error", message: err.message });
      }
    } finally {
      this.analyzing = false;
    }
  }

  computeMetrics() {
    const chars = {};
    for (const u of this.utterances) {
      const label = (u.speaker && (u.speaker.name || (u.speaker.id != null ? "話者" + u.speaker.id : ""))) || "話者";
      chars[label] = (chars[label] || 0) + String(u.text || "").length;
    }
    const total = Object.values(chars).reduce((a, b) => a + b, 0);
    let repTalkPct = null;
    const rep = (this.repName || "").replace(/\s+/g, "");
    if (rep && total) {
      let repChars = 0;
      for (const [l, n] of Object.entries(chars)) if (l.replace(/\s+/g, "").includes(rep)) repChars += n;
      if (repChars > 0) repTalkPct = Math.round((repChars / total) * 100);
    }
    let landedCount = 0, concernCount = 0;
    for (const e of this.aiLog) {
      if (e.t === "land") landedCount++;
      else if (e.t === "obj") concernCount++;
    }
    return { repTalkPct, speakerCount: Object.keys(chars).length, landedCount, concernCount };
  }

  dispose() {
    // 視聴中の全員に終了を通知（画面を自動で閉じる）
    this.broadcast({ type: "ended", ts: Date.now() });
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.maybeAnalyze();
    // 最終状態を保存（分析待ちでも文字起こしは残す）
    saveMeeting(this.botId, {
      transcript: this.utterances,
      summary: this.prevSummary,
      suggestions: this.lastSuggestions || [],
      aiLog: this.aiLog,
      metrics: this.computeMetrics(),
    });
    // 商談終了 → 要約・営業FB・分析を自動生成（バックグラウンド）
    this.finalizeAnalysis();
    // ライブ映像配信（Mux）を停止
    if (this.muxLiveStreamId) disableLiveStream(this.muxLiveStreamId);
  }

  // 文字起こしから 要約＋FB と 深掘り分析 を自動生成して保存
  async finalizeAnalysis() {
    if (this.finalized) return;
    this.finalized = true;
    const transcript = this.transcriptText().slice(-12000);
    if (transcript.trim().length < 20) return; // 中身がなければ何もしない
    const speakers = [...new Set(this.utterances.map((u) => u.speaker?.name).filter(Boolean))];
    const dateStr = new Date(this.startedAt).toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    try {
      const rev = await analyzeMeeting({ transcript, repName: this.repName, dateStr, speakers });
      await saveAnalysis(this.botId, rev);
      this.broadcast({ type: "analysis", ...rev, ts: Date.now() });
    } catch (e) {
      console.error("[auto review]", e.message);
    }
    // 商談を段階（ヒアリング・提案・クロージングなど）に分けて、再生バーの頭出しに使う
    try {
      const raw = await splitPhases({ transcript: this.utterances, repName: this.repName });
      const chapters = buildChapters(this.utterances, raw);
      if (chapters.length) {
        await saveChapters(this.botId, chapters);
        console.log(`[段階] ${this.botId} を${chapters.length}段階に分けました`);
      }
    } catch (e) {
      console.error("[段階]", e.message);
    }

    // 商談から「顧客の質問と営業の回答」を取り出して、全員で使うナレッジに貯める
    try {
      const pairs = await extractQaPairs({ transcript, repName: this.repName });
      const n = await addQaPairs(pairs, {
        botId: this.botId,
        company: companyFromTitle(this.title || "") || "",
        repName: this.repName || "",
      });
      if (n) console.log(`[QAナレッジ] ${this.botId} から${n}件の質問と回答を保存しました`);
    } catch (e) {
      console.error("[QAナレッジ]", e.message);
    }
    try {
      let lostSignals = [];
      try { lostSignals = (await getSettings()).lostSignals || []; } catch {}
      const deep = await analyzeDeep({ transcript, repName: this.repName, lostSignals });
      await saveDeepAnalysis(this.botId, deep);
      // 案件ステータスをAI自動更新（手動上書きされていない案件のみ）
      const st = deep && deep.deal_status;
      if (st && ["進行中", "受注", "失注", "保留"].includes(st)) {
        let account = this.title || "";
        try {
          const m = await getMeeting(this.botId);
          if (m) account = (m.account && m.account.trim()) || companyFromTitle(m.title) || account;
        } catch {}
        if (account) await setDealStatusAuto(account, st);
      }
    } catch (e) {
      console.error("[auto deep]", e.message);
    }
    // 新営業プロセスの抽出（Feature A）。index.js から登録されたフックを呼ぶ。
    try {
      if (typeof onMeetingFinalized === "function") await onMeetingFinalized(this.botId);
    } catch (e) {
      console.error("[auto extract]", e.message);
    }
  }
}

// 商談確定後に呼ぶフック（index.js が runExtraction を登録する）
let onMeetingFinalized = null;
export function setOnMeetingFinalized(fn) { onMeetingFinalized = fn; }
