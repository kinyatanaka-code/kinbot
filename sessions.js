// server/sessions.js
import { analyze } from "./analyzer.js";

const ANALYZE_INTERVAL_MS = Number(process.env.ANALYZE_INTERVAL_MS || 12000);

const sessions = new Map(); // botId -> Session

export function createSession(botId, { repName = "" } = {}) {
  const s = new Session(botId, repName);
  sessions.set(botId, s);
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
  constructor(botId, repName) {
    this.botId = botId;
    this.repName = repName;
    this.utterances = []; // {speaker:{id,name}, text, ts}
    this.sockets = new Set();
    this.prevSummary = null;
    this.lastAnalyzedLen = 0;
    this.analyzing = false;
    this.timer = setInterval(() => this.maybeAnalyze(), ANALYZE_INTERVAL_MS);
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
    } catch (err) {
      console.error("[analyze]", err.message);
      this.broadcast({ type: "status", state: "analyze_error", message: err.message });
    } finally {
      this.analyzing = false;
    }
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.maybeAnalyze();
  }
}
