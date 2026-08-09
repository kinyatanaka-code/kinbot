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
import { addUnanswered, addBlocked } from "./db.js";

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
    // バディ（既定）… 営業のブリーフィング中は完全に沈黙し、合図で話し始める
    // ソロ          … 開始した時点から自分で進行する
    this.mode = opts.mode === "solo" ? "solo" : "buddy";
    this.listening = this.mode === "buddy";  // true の間は一切喋らない
    this.stopped = false;                    // 「かささぎストップ」で待機に戻る
    this.slide = "cover";                    // いま映しているスライド
    this.slideAt = Date.now();
    this.unanswered = [];                    // 答えられなかった質問
    this.ngHits = [];                        // 言ってはいけない語を止めた記録
    // 自分から話を進めるか（かささぎの本来の動き）
    this.autoAdvance = opts.autoAdvance !== false;
    this.quickAck = opts.quickAck !== false;   // 考えている間に短い受けを返す
    this.useSlides = opts.useSlides !== false; // スライドを切り替えるか
    this.title = String(opts.title || "");
    this.summaryText = "";
    this.heldQuestion = null;
    this.silenceMs = Number(opts.silenceMs || process.env.KASASAGI_SILENCE_MS || 6000);
    this.greeting = String(opts.greeting || "");
    this.advanceTimer = null;
    this.closing = false;
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
          const ng = findNgWord(part);
          if (ng) {
            this.ngHits.push({ at: new Date().toISOString(), word: ng, text: part.slice(0, 200) });
            this.note("blocked", `「${ng}」が入っていたので発言を止めました`);
            addBlocked({ botId: this.botId, word: ng, text: part }).catch(() => {});
            continue;
          }
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
    // 話している間に来た質問があれば、ここで答える
    const held = this.heldQuestion;
    if (held) {
      this.heldQuestion = null;
      if (!this.stopped && !this.listening) {
        this.note("info", "話している間にいただいた質問にお答えします");
        this.maybeAnswer(held.who, held.text).catch((e) => this.note("error", e.message));
      }
    }
  }

  // しばらく誰も話さなければ、自分から説明を続ける
  scheduleAdvance() {
    if (!this.autoAdvance) return;
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    this.advanceTimer = setTimeout(() => {
      this.advanceTimer = null;
      this.advance().catch((e) => this.note("error", e.message));
    }, this.silenceMs);
  }

  async advance() {
    if (this.speaking) { this.scheduleAdvance(); return; }
    if (this.scriptIndex < this.scriptParts.length) {
      await this.readNext();
      this.scheduleAdvance();
      return;
    }
    // 台本を読み終えたら、話を前に進める一言をAIに作らせる
    if (this.closing) return;
    this.closing = true;
    const t = await this.think("（相手が黙っています。説明を終えたので、次に進めるための一言をお願いします）", true);
    if (t && !/NOANSWER/i.test(t)) await this.say(t, "lead");
    this.note("info", "台本を読み終えたので、質問を待つ状態になりました");
  }

  // 会議のチャットを受ける（「かささぎストップ」など）
  onChat(who, text) {
    const t = String(text || "").trim();
    if (!t) return;
    if (isStopCue(t)) { this.pause(`チャット：${who}`); return; }
    if (this.listening && isStartCue(t)) {
      this.note("info", `チャットの合図：${t.slice(0, 40)}`);
      this.listening = false; this.stopped = false;
      this.begin().catch((e) => this.note("error", e.message));
    }
  }

  // 出せるスライドの一覧。1発話1スライドが原則で、迷ったら変えない。
  static SLIDES = {
    cover:    "表紙",
    company:  "会社紹介",
    problem:  "採用の課題",
    service:  "サービスの説明",
    usage:    "使い方",
    flow:     "導入の流れ",
    case:     "導入事例",
    pricing:  "料金",
    faq:      "よくある質問",
    next:     "次のご案内",
    summary:  "この商談のまとめ",
  };

  // いま話した内容に合うスライドをAIに選ばせる。迷ったら変えない。
  async pickSlide(heard, said) {
    if (!this.useSlides) return;
    try {
      const { callLLMPublic } = await import("./analyzer.js");
      const keys = Object.entries(KasasagiSession.SLIDES).map(([k, v]) => `${k}=${v}`).join(" / ");
      const out = (await callLLMPublic(
        "商談で映すスライドを1つ選びます。選べるのは次だけです。\n" + keys +
        "\n該当が無い、または今のままでよいときは keep とだけ返してください。キーだけを返します。",
        `【いま話した内容】${String(said).slice(0, 300)}\n【直前の相手の発言】${String(heard).slice(0, 200)}\n` +
        `【いま映しているスライド】${this.slide}`,
        20
      )).trim().toLowerCase().replace(/[^a-z_]/g, "");
      if (!out || out === "keep") return;
      if (!KasasagiSession.SLIDES[out]) return;
      if (out === this.slide) return;
      this.slide = out;
      this.slideAt = Date.now();
      this.note("slide", `スライドを「${KasasagiSession.SLIDES[out]}」に切り替えました`);
    } catch {}
  }

  // その商談専用のまとめスライドを作る（認識合わせに使う）
  async showSummary(text) {
    this.summaryText = String(text || "").slice(0, 600);
    this.slide = "summary";
    this.slideAt = Date.now();
    this.note("slide", "まとめスライドを出しました");
  }

  // 開始時：あいさつして、台本の頭から読み始める
  async begin() {
    if (this.greeting) await this.say(this.greeting, "script");
    // 合図をもらったら必ず話し始める（自動進行がOFFでも、最初の一言は出す）
    await this.readNext();
    if (this.autoAdvance) this.scheduleAdvance();
  }

  // 台本を1つ進めて読む
  async readNext() {
    if (this.scriptIndex >= this.scriptParts.length) {
      this.note("info", "台本を最後まで読み終えました");
      return { done: true };
    }
    const part = this.scriptParts[this.scriptIndex++];
    await this.say(part, "script");
    await this.pickSlide("", part);
    return { done: this.scriptIndex >= this.scriptParts.length, remaining: this.scriptParts.length - this.scriptIndex };
  }

  // 相手の発言が確定するたびに呼ばれる
  onFinal(speakerName, text) {
    const who = String(speakerName || "");
    const t = String(text || "").trim();
    if (!t) return;
    // 自分（ボット）の声は無視する。自分の声を拾って会話が回り続けるのを防ぐ。
    if ([...this.botNames].some((n) => n && who.includes(n))) return;

    // 止める合図は、喋っている最中でも受ける
    if (isStopCue(t)) { this.pause(`${who}の合図`); return; }

    // 傾聴中：営業のブリーフィングは黙って聞き、合図が出たら話し始める
    if (this.listening) {
      this.history.push({ role: "user", text: `${who}: ${t}` });
      if (this.history.length > 40) this.history.shift();
      if (isStartCue(t)) {
        this.note("info", `合図を受け取りました：${t.slice(0, 40)}`);
        this.listening = false;
        this.stopped = false;
        this.begin().catch((e) => this.note("error", e.message));
      }
      return;
    }
    if (this.stopped) { this.history.push({ role: "user", text: `${who}: ${t}` }); return; }

    if (!this.autoAnswer) { this.history.push({ role: "user", text: `${who}: ${t}` }); return; }
    // 話している最中に来た発言は捨てずに取っておき、話し終わってから拾う
    if (this.speaking) {
      this.history.push({ role: "user", text: `${who}: ${t}` });
      if (looksLikeQuestion(t)) this.heldQuestion = { who, text: t };
      return;
    }

    this.history.push({ role: "user", text: `${who}: ${t}` });
    if (this.history.length > 40) this.history.shift();
    // 相手が話し出したら、自分から進めるのは一旦やめる
    if (this.advanceTimer) { clearTimeout(this.advanceTimer); this.advanceTimer = null; }
    this.closing = false;

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
    // 相づちだけの短い発言は無視する。それ以外は返すかどうかをAIに判断させる。
    if (isBackchannel(text)) { this.note("skip", `相づちと判断：${text.slice(0, 30)}`); return; }
    this.note("hear", `${who}: ${text}`);

    // 質問には、考えている間に短い受けを先に返す（黙る時間を作らない）
    let ackDone = null;
    if (this.quickAck && looksLikeQuestion(text)) {
      const ack = ["はい。", "なるほど。", "ありがとうございます。"][Math.floor(Math.random() * 3)];
      ackDone = this.say(ack, "ack");
    }
    const answer = await this.think(text);
    if (ackDone) await ackDone;
    if (!answer) { this.note("skip", "答えを作れませんでした"); return; }
    if (/^\s*(黙る|NOANSWER|なし)\s*$/i.test(answer)) { this.note("skip", "返事は不要と判断しました"); return; }
    // 「確認して折り返します」で逃げた質問は、あとで社内に答えを書いてもらうため記録する
    if (/確認して折り返|お答えできません|分かりかね|わかりかね/.test(answer) && looksLikeQuestion(text)) {
      this.unanswered.push({ at: new Date().toISOString(), who, question: text.slice(0, 400) });
      this.note("todo", `答えられなかった質問として記録：${text.slice(0, 40)}`);
      addUnanswered({ botId: this.botId, title: this.title, askedBy: who, question: text }).catch(() => {});
    }
    await this.say(answer, "answer");
    await this.pickSlide(text, answer);
    this.scheduleAdvance();   // 答えたあとも、間があいたら説明を続ける
  }

  async think(question, leading = false) {
    const { callLLMPublic } = await import("./analyzer.js");
    const recent = this.history.slice(-12)
      .map((h) => (h.role === "assistant" ? "かささぎ: " : "") + h.text).join("\n");
    const system =
      this.persona +
      "\n\n次のルールを必ず守ってください。" +
      "\n・答えは2〜3文まで。話し言葉で。読み上げるので記号や箇条書きは使わない。" +
      "\n・資料や参考情報にないことは断定しない。「確認して折り返します」と答える。" +
      (leading
        ? "\n・いまは相手が黙っています。説明の続きや、相手に尋ねる質問を1つだけ話してください。"
        : "\n・相手の発言に短く応じてください。あいづちだけで内容が無い発言や、" +
          "自社の人どうしの会話に割り込む必要がないときは、NOANSWER とだけ返す。");
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

  // 「かささぎストップ」で待機に戻る（セッションは残す）
  pause(reason = "") {
    this.stopped = true;
    this.queue.length = 0;
    this.heldQuestion = null;
    if (this.pendingTimer) { clearTimeout(this.pendingTimer); this.pendingTimer = null; }
    if (this.advanceTimer) { clearTimeout(this.advanceTimer); this.advanceTimer = null; }
    stopOutputAudio(this.botId).catch(() => {});
    this.note("info", `止めました${reason ? "（" + reason + "）" : ""}。もう一度合図をいただければ再開します。`);
    this.listening = true;   // 次の合図を待つ
  }

  async stop() {
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    if (this.advanceTimer) clearTimeout(this.advanceTimer);
    this.autoAdvance = false;
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
      autoAdvance: this.autoAdvance,
      mode: this.mode,
      listening: this.listening,
      stopped: this.stopped,
      slide: this.slide,
      slideLabel: KasasagiSession.SLIDES[this.slide] || this.slide,
      unanswered: this.unanswered.length,
      ngHits: this.ngHits.length,
      error: this.error,
      log: this.log.slice(-40),
    };
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// 「かささぎさん、お願いします」などの開始の合図。
// 文字起こしの誤変換（かっさき／勝崎／傘木 等）も拾う。
const NAME_RE = /(かささぎ|かささき|かっさき|カササギ|勝崎|笠木|傘木|風佐木|kasasagi)/i;
const GO_RE = /(お願い|おねがい|始め|はじめ|どうぞ|説明|紹介|プレゼン|いきましょう|行きましょう|バトン|交代)/;
export function isStartCue(text) {
  const t = String(text || "");
  if (!NAME_RE.test(t)) return false;
  return GO_RE.test(t);
}

// 「かささぎストップ」などの停止の合図（チャット・発話の両方で使う）
export function isStopCue(text) {
  const t = String(text || "").replace(/[\s　]/g, "");
  if (!NAME_RE.test(t)) return /^(ストップ|stop|とめて|止めて|黙って)$/i.test(t);
  return /(ストップ|stop|とめて|止めて|停止|黙|やめ)/i.test(t);
}

// 言ってはいけない語。判断をAIに委ねず、送り出す直前に機械的に止める。
// 「言い方が硬い」失敗は許容できるが、他社名を口にする失敗は許容できないため。
const NG_WORDS = String(process.env.KASASAGI_NG_WORDS || "")
  .split(",").map((x) => x.trim()).filter(Boolean);
export function findNgWord(text) {
  const t = String(text || "");
  return NG_WORDS.find((w) => w && t.includes(w)) || "";
}

// 相づちだけの発言か（これには反応しない）
export function isBackchannel(text) {
  const t = String(text || "").trim().replace(/[。、．，!！?？\s]/g, "");
  if (!t) return true;
  if (t.length <= 2) return true;
  return /^(はい|ええ|うん|なるほど|そうですね|そうなんですね|わかりました|了解です|ありがとうございます|お願いします|よろしく|すみません|えーと|あー|うーん)$/.test(t);
}

// 質問っぽいか（急ぎで答えるべきかの目安に使う）
export function looksLikeQuestion(text) {
  const t = String(text || "").trim();
  if (t.length < 4) return false;
  if (/[?？]$/.test(t)) return true;
  return /(ですか|ますか|でしょうか|かな|どう(です|でしょう)|いくら|なぜ|どうして|教えて|聞きたい|可能ですか|できますか|ありますか)/.test(t);
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

// 台本が空なら、参考情報から説明の流れをAIに作ってもらう
export async function buildScript({ knowledge = "", company = "", persona = "" } = {}) {
  const { callLLMPublic } = await import("./analyzer.js");
  const system =
    (persona || DEFAULT_PERSONA) +
    "\n\nオンライン商談で話す説明の流れを作ってください。" +
    "\n・そのまま読み上げるので、話し言葉で書く。記号・箇条書き・見出しは使わない。" +
    "\n・1つのかたまりは2〜3文。全体で5〜7かたまり。" +
    "\n・順番は「あいさつと自己紹介」「今日の進め方」「相手の状況を聞く質問」" +
    "「サービスの説明」「導入の流れ」「次のご案内」。" +
    "\n・かたまりの区切りに何も書かない。文章だけを続けて書く。";
  const user =
    (company ? `【商談相手】${company}\n\n` : "") +
    (knowledge ? `【自社の参考情報】\n${knowledge.slice(0, 4000)}\n\n` : "") +
    "上記をもとに、実際に読み上げる文章だけを書いてください。";
  try {
    return (await callLLMPublic(system, user, 1200)).trim();
  } catch {
    return "";
  }
}
export function getKasasagi(botId) { return sessions.get(botId) || null; }

// 商談が終わったあと、営業へのフィードバックと次アクションを作る
export async function buildReport(botId) {
  const s = sessions.get(botId);
  if (!s) return null;
  const { callLLMPublic } = await import("./analyzer.js");
  const talk = s.history.slice(-60)
    .map((h) => (h.role === "assistant" ? "かささぎ: " : "") + h.text).join("\n");
  const spoken = s.log.filter((l) => ["script", "answer", "lead", "manual"].includes(l.kind)).length;
  const answered = s.log.filter((l) => l.kind === "answer").length;
  let feedback = "", nextAction = "";
  try {
    const out = await callLLMPublic(
      "商談の記録から、担当営業へのフィードバックと次のアクションを書きます。" +
      "\n・フィードバックは3点まで。良かった点と、次に変えると良い点を具体的に。" +
      "\n・次のアクションは1〜2行。誰が何をいつまでに、が分かるように。" +
      "\n・「フィードバック」と「次のアクション」の見出しを付けて書く。",
      `【商談】${s.title || botId}\n\n【やり取り】\n${talk.slice(0, 6000)}\n\n` +
      `【答えられなかった質問】\n${s.unanswered.map((u) => "- " + u.question).join("\n") || "なし"}`,
      700
    );
    const m = out.split(/次のアクション/);
    feedback = (m[0] || out).replace(/^[#\s]*フィードバック[:：]?/, "").trim();
    nextAction = (m[1] || "").replace(/^[:：\s]*/, "").trim();
  } catch (e) {
    s.note("error", `まとめを作れませんでした：${e.message}`);
  }
  return {
    botId, title: s.title, feedback, nextAction,
    spoken, answered, unanswered: s.unanswered.length,
    unansweredList: s.unanswered,
    blocked: s.ngHits,
  };
}

// アバターページ（会議に映すページ）が定期的に読む内容
export function faceState(botId) {
  const s = sessions.get(botId);
  if (!s) return { ok: false, slide: "cover", label: "", speaking: false, caption: "" };
  const last = [...s.log].reverse().find((l) => ["script", "answer", "manual", "lead"].includes(l.kind));
  return {
    ok: true,
    slide: s.slide,
    label: KasasagiSession.SLIDES[s.slide] || s.slide,
    speaking: s.speaking,
    listening: s.listening,
    caption: last ? last.text : "",
    summary: s.summaryText || "",
    at: s.slideAt,
  };
}

export const SLIDE_LABELS = KasasagiSession.SLIDES;
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
