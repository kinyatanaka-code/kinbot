// server/sessions.js
import { analyze, analyzeMeeting, analyzeDeep } from "./analyzer.js";
import { createMeeting, saveMeeting, saveAnalysis, saveDeepAnalysis } from "./db.js";

const DEFAULT_INTERVAL_MS = Number(process.env.ANALYZE_INTERVAL_MS || 20000);

const sessions = new Map(); // botId -> Session

export function createSession(botId, { repName = "", meetingUrl = "", title = "", analyzeIntervalMs } = {}) {
  const s = new Session(botId, repName, meetingUrl, analyzeIntervalMs || DEFAULT_INTERVAL_MS);
  sessions.set(botId, s);
  createMeeting(botId, { meetingUrl, repName, title }); // 履歴に行を作成（DB無効なら無視）
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

class Session {
  constructor(botId, repName, meetingUrl, intervalMs) {
    this.botId = botId;
    this.repName = repName;
    this.meetingUrl = meetingUrl;
    this.utterances = []; // {speaker:{id,name}, text, ts}
    this.sockets = new Set();
    this.prevSummary = null;
    this.lastAnalyzedLen = 0;
    this.analyzing = false;
    this.cooldownUntil = 0; // 429などで一時停止する時刻
    this.timer = setInterval(() => this.maybeAnalyze(), intervalMs);
  }

  addSocket(ws) {
    this.sockets.add(ws);
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

  onFinal(speaker, text) {
    const u = { speaker, text, ts: Date.now() };
    this.utterances.push(u);
    this.broadcast({ type: "final", speaker, text, ts: u.ts });
  }
  onPartial(speaker, text) {
    this.broadcast({ type: "partial", speaker, text });
  }

  transcriptText() {
    return this.utterances
      .map((u) => `${u.speaker.name || "話者" + (u.speaker.id ?? "")}: ${u.text}`)
      .join("\n");
  }

  async maybeAnalyze() {
    if (Date.now() < this.cooldownUntil) return; // 429などで休止中
    const full = this.transcriptText();
    if (full.length - this.lastAnalyzedLen < 20) return;
    if (this.analyzing) return;
    this.analyzing = true;
    const lenAtStart = full.length;
    try {
      const result = await analyze({
        transcript: full.slice(-8000),
        prevSummary: this.prevSummary,
        repName: this.repName,
      });
      this.prevSummary = result.summary;
      this.lastSuggestions = result.suggestions;
      this.lastAnalyzedLen = lenAtStart;
      this.broadcast({ type: "analysis", ...result, ts: Date.now() });
      saveMeeting(this.botId, {
        transcript: this.utterances,
        summary: result.summary,
        suggestions: result.suggestions,
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

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.maybeAnalyze();
    // 最終状態を保存（分析待ちでも文字起こしは残す）
    saveMeeting(this.botId, {
      transcript: this.utterances,
      summary: this.prevSummary,
      suggestions: this.lastSuggestions || [],
    });
    // 商談終了 → 要約・営業FB・分析を自動生成（バックグラウンド）
    this.finalizeAnalysis();
  }

  // 文字起こしから 要約＋FB と 深掘り分析 を自動生成して保存
  async finalizeAnalysis() {
    if (this.finalized) return;
    this.finalized = true;
    const transcript = this.transcriptText().slice(-12000);
    if (transcript.trim().length < 20) return; // 中身がなければ何もしない
    try {
      const rev = await analyzeMeeting({ transcript, repName: this.repName });
      await saveAnalysis(this.botId, rev);
      this.broadcast({ type: "analysis", ...rev, ts: Date.now() });
    } catch (e) {
      console.error("[auto review]", e.message);
    }
    try {
      const deep = await analyzeDeep({ transcript, repName: this.repName });
      await saveDeepAnalysis(this.botId, deep);
    } catch (e) {
      console.error("[auto deep]", e.message);
    }
  }
}
