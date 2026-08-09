// ───────────────────────────────────────────────────────────
// kasasagi.js — 商談でAIが喋る「かささぎ」
//
// できること（フェーズ1）
//   ・台本を読み上げる（資料の説明を順に話す）
//   ・お客様の質問に答える（文字起こしを見て、必要なときだけ返事する）
//
// 仕組み
//   Recallのボットが聞き取った文字起こし（final）が来るたびに onFinal が呼ばれる。
//   質問らしければ、社内ナレッジと台本を材料にAIが答えを作り、
//   読み上げた音声をボットのマイクから会議に流す。
//
// 大事にしていること
//   ・人が話している最中に割り込まない（話し終わってから少し待つ）
//   ・自分が喋った内容には反応しない（自分の声を拾ってループするのを防ぐ）
//   ・迷ったら黙る。分からないことは「確認して折り返す」と答える
// ───────────────────────────────────────────────────────────
import { outputAudio, stopOutputAudio, sendChatMessage } from "./recall.js";
import { synthesizeBase64, splitForSpeech, ttsInfo } from "./tts.js";

// botId → セッション
const sessions = new Map();

const DEFAULT_PERSONA =
  "あなたは株式会社ネオキャリアの営業担当「かささぎ」です。" +
  "採用支援サービスをオンライン商談で説明しています。" +
  "話し言葉で、1回の発言は2〜3文まで。専門用語は避け、結論から話します。" +
  "分からないことや、料金の最終決定、契約条件の約束はしません。" +
  "その場合は「確認して折り返します」と伝えてください。";

export function kasasagiInfo() {
  return {
    tts: ttsInfo(),
    active: [...sessions.keys()],
  };
}

class KasasagiSession {
  constructor(botId, opts = {}) {
    this.botId = botId;
    this.script = String(opts.script || "");        // 読み上げる台本
    this.persona = String(opts.persona || "").trim() || DEFAULT_PERSONA;
    this.knowledge = String(opts.knowledge || ""); // 社内ナレッジなどの参考資料
    this.autoAnswer = opts.autoAnswer !== false;   // 質問に自動で答えるか
    this.botNames = new Set(                        // 自分の声を拾わないため
      [opts.botName || "かささぎ", "kinbot", "議事録"].map((x) => String(x))
    );
    this.speaking = false;
    this.queue = [];          // 読み上げ待ち
    this.log = [];            // 画面に出す動作ログ
    this.history = [];        // 会話の流れ（AIに渡す）
    this.lastSpokeAt = 0;
    this.scriptIndex = 0;
    this.scriptParts = splitForSpeech(this.script, 300);
    this.pendingTimer = null;
    this.pendingText = "";
    this.error = "";
  }

  note(kind, text) {
    this.log.push({ at: new Date().toISOString(), kind, text: String(text).slice(0, 300) });
    if (this.log.length > 200) this.log.shift();
  }

  // 会議で1回喋る
  async say(text, kind = "speak") {
    const t = String(text || "").trim();
    if (!t) return;
    this.queue.push({ text: t, kind });
    if (!this.speaking) await this.drain();
  }

  async drain() {
    this.speaking = true;
    try {
      while (this.queue.length) {
        const { text, kind } = this.queue.shift();
        for (const part of splitForSpeech(text, 300)) {
          try {
            const b64 = await synthesizeBase64(part);
            await outputAudio(this.botId, b64, "mp3");
            this.note(kind, part);
            this.history.push({ role: "assistant", text: part });
            this.lastSpokeAt = Date.now();
            // 読み上げの長さぶんだけ待つ（おおよそ1秒で7文字）
            await sleep(Math.min(30000, Math.max(1200, part.length * 145)));
          } catch (e) {
            this.error = e.message;
            this.note("error", e.message);
            // 音声が出せないときは、会議のチャットに文字で送る
            try { await sendChatMessage(this.botId, part); this.note("chat", part); }
            catch {}
            break;
          }
        }
      }
    } finally {
      this.speaking = false;
    }
  }

  // 台本を1つ進めて読む
  async readNext() {
    if (this.scriptIndex >= this.scriptParts.length) {
      this.note("info", "台本を最後まで読み終えました");
      return { done: true };
    }
    const part = this.scriptParts[this.scriptIndex++];
    await this.say(part, "script");
    return { done: this.scriptIndex >= this.scriptParts.length, remaining: this.scriptParts.length - this.scriptIndex };
  }

  // 相手の発言が確定するたびに呼ばれる
  onFinal(speakerName, text) {
    const who = String(speakerName || "");
    const t = String(text || "").trim();
    if (!t) return;
    // 自分（ボット）の声は無視する
    if ([...this.botNames].some((n) => n && who.includes(n))) return;
    if (this.speaking) return;              // 喋っている間は聞き流す
    if (!this.autoAnswer) { this.history.push({ role: "user", text: `${who}: ${t}` }); return; }

    this.history.push({ role: "user", text: `${who}: ${t}` });
    if (this.history.length > 40) this.history.shift();

    // 相手が続けて話す可能性があるので、少し待ってからまとめて答える
    this.pendingText = (this.pendingText + " " + t).trim();
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = setTimeout(() => {
      const say = this.pendingText;
      this.pendingText = "";
      this.pendingTimer = null;
      this.maybeAnswer(who, say).catch((e) => this.note("error", e.message));
    }, Number(process.env.KASASAGI_WAIT_MS || 2500));
  }

  async maybeAnswer(who, text) {
    if (this.speaking) return;
    if (!looksLikeQuestion(text)) { this.note("skip", `質問ではないと判断：${text.slice(0, 40)}`); return; }
    this.note("hear", `${who}: ${text}`);
    const answer = await this.think(text);
    if (!answer) { this.note("skip", "答えを作れませんでした"); return; }
    if (/^\s*(黙る|NOANSWER|なし)\s*$/i.test(answer)) { this.note("skip", "答えずに様子を見ます"); return; }
    await this.say(answer, "answer");
  }

  async think(question) {
    const { callLLMPublic } = await import("./analyzer.js");
    const recent = this.history.slice(-12)
      .map((h) => (h.role === "assistant" ? "かささぎ: " : "") + h.text).join("\n");
    const system =
      this.persona +
      "\n\n次のルールを必ず守ってください。" +
      "\n・答えは2〜3文まで。話し言葉で。" +
      "\n・資料や参考情報にないことは断定しない。「確認して折り返します」と答える。" +
      "\n・相手が質問していない、または返事が不要なときは、NOANSWER とだけ返す。";
    const user =
      (this.script ? `【説明する内容（台本）】\n${this.script.slice(0, 3000)}\n\n` : "") +
      (this.knowledge ? `【参考情報】\n${this.knowledge.slice(0, 4000)}\n\n` : "") +
      `【これまでの会話】\n${recent}\n\n` +
      `【お客様の発言】\n${question}\n\n` +
      "この発言に対する返事を書いてください。返事が不要なら NOANSWER とだけ書いてください。";
    try {
      return (await callLLMPublic(system, user, 300)).trim();
    } catch (e) {
      this.note("error", `AIの応答に失敗：${e.message}`);
      return "";
    }
  }

  async stop() {
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.queue.length = 0;
    try { await stopOutputAudio(this.botId); } catch {}
    this.note("info", "かささぎを止めました");
  }

  status() {
    return {
      botId: this.botId,
      speaking: this.speaking,
      autoAnswer: this.autoAnswer,
      scriptTotal: this.scriptParts.length,
      scriptIndex: this.scriptIndex,
      queued: this.queue.length,
      error: this.error,
      log: this.log.slice(-40),
    };
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 質問っぽいかを判定する。迷ったら黙る側に倒す。
export function looksLikeQuestion(text) {
  const t = String(text || "").trim();
  if (t.length < 4) return false;
  if (/[?？]$/.test(t)) return true;
  if (/(ですか|ますか|でしょうか|かな|どう(です|でしょう)|いくら|なぜ|どうして|教えて|聞きたい|可能ですか|できますか|ありますか)/.test(t)) return true;
  return false;
}

// ───────────────────────────────────────────────────────────
// 外から使う入口
// ───────────────────────────────────────────────────────────
export function startKasasagi(botId, opts = {}) {
  const s = new KasasagiSession(botId, opts);
  sessions.set(botId, s);
  s.note("info", "かささぎを開始しました");
  return s;
}
export function getKasasagi(botId) { return sessions.get(botId) || null; }
export async function stopKasasagi(botId) {
  const s = sessions.get(botId);
  if (!s) return false;
  await s.stop();
  sessions.delete(botId);
  return true;
}

// Recallの文字起こし（final）をかささぎに渡す
export function feedTranscript(botId, speakerName, text) {
  const s = sessions.get(botId);
  if (!s) return;
  try { s.onFinal(speakerName, text); } catch (e) { console.error("[kasasagi]", e.message); }
}
