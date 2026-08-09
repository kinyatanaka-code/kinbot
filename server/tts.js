// ───────────────────────────────────────────────────────────
// tts.js — 文章を音声（mp3）に変換する
//
// 既定は Microsoft Edge の読み上げ（Edge TTS）。無料で使えて日本語の品質が高い。
// APIキーは不要で、WebSocketで接続して音声データを受け取る。
// うまくいかない環境のために、Gemini の読み上げにも切り替えられるようにしてある。
//
//   TTS_PROVIDER=edge   … Edge の読み上げ（既定）
//   TTS_PROVIDER=gemini … Gemini の読み上げ（GEMINI_API_KEY が必要）
//   TTS_VOICE           … 声の指定（既定 ja-JP-NanamiNeural）
//   TTS_RATE            … 話す速さ（例 +10% / -5%）
// ───────────────────────────────────────────────────────────
import { WebSocket } from "ws";
import { randomUUID, createHash } from "node:crypto";

const PROVIDER = (process.env.TTS_PROVIDER || "edge").toLowerCase();
const VOICE = process.env.TTS_VOICE || "ja-JP-NanamiNeural";
const RATE = process.env.TTS_RATE || "+0%";
const PITCH = process.env.TTS_PITCH || "+0Hz";

const EDGE_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_URL =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1" +
  `?TrustedClientToken=${EDGE_TOKEN}`;
// Edgeの読み上げは2024年から署名（Sec-MS-GEC）が必要になった。
// 5分単位に丸めた時刻からハッシュを作る。これが無いと 403 が返る。
function secMsGec() {
  const ticks = Math.floor((Date.now() / 1000 + 11644473600) / 300) * 300 * 1e7;
  return createHash("sha256").update(`${ticks}${EDGE_TOKEN}`, "ascii").digest("hex").toUpperCase();
}
const GEC_VERSION = process.env.TTS_EDGE_GEC_VERSION || "1-130.0.2849.68";

export function ttsInfo() {
  return {
    provider: PROVIDER,
    voice: VOICE,
    rate: RATE,
    ready: PROVIDER === "edge" ? true : !!process.env.GEMINI_API_KEY,
  };
}

// SSMLに入れられない文字を逃がす
function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function nowXml() {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

// ───────────────────────────────────────────────────────────
// Edge の読み上げ
// ───────────────────────────────────────────────────────────
function synthesizeEdge(text, { voice = VOICE, rate = RATE, pitch = PITCH, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    const id = randomUUID().replace(/-/g, "");
    const url = `${EDGE_URL}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=${GEC_VERSION}&ConnectionId=${id}`;
    const ws = new WebSocket(url, {
      headers: {
        Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
      },
    });

    const chunks = [];
    let done = false;
    const finish = (err, buf) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.close(); } catch {}
      err ? reject(err) : resolve(buf);
    };
    const timer = setTimeout(() => finish(new Error("読み上げがタイムアウトしました")), timeoutMs);

    ws.on("open", () => {
      // 出力の形式を指定する
      ws.send(
        `X-Timestamp:${nowXml()}\r\n` +
        "Content-Type:application/json; charset=utf-8\r\n" +
        "Path:speech.config\r\n\r\n" +
        JSON.stringify({
          context: {
            synthesis: {
              audio: {
                metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" },
                outputFormat: "audio-24khz-48kbitrate-mono-mp3",
              },
            },
          },
        })
      );
      // 読み上げる内容
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='ja-JP'>` +
        `<voice name='${voice}'><prosody rate='${rate}' pitch='${pitch}'>${esc(text)}</prosody></voice></speak>`;
      ws.send(
        `X-RequestId:${id}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${nowXml()}Z\r\n` +
        `Path:ssml\r\n\r\n${ssml}`
      );
    });

    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        // 先頭2バイトがヘッダーの長さ。その後ろが音声データ。
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (buf.length < 2) return;
        const headerLen = buf.readUInt16BE(0);
        if (buf.length > 2 + headerLen) chunks.push(buf.subarray(2 + headerLen));
        return;
      }
      const msg = data.toString();
      if (msg.includes("Path:turn.end")) {
        if (!chunks.length) return finish(new Error("音声を受け取れませんでした"));
        finish(null, Buffer.concat(chunks));
      }
    });

    ws.on("error", (e) => finish(new Error(`読み上げに失敗しました: ${e.message}`)));
    ws.on("close", () => {
      if (done) return;
      if (chunks.length) finish(null, Buffer.concat(chunks));
      else finish(new Error("読み上げの接続が切れました"));
    });
  });
}

// ───────────────────────────────────────────────────────────
// Gemini の読み上げ（Edgeが使えないときの控え）
// 返ってくるのは PCM なので、そのままでは会議に流せない点に注意。
// ───────────────────────────────────────────────────────────
async function synthesizeGemini(text, { voice = "Kore" } = {}) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY が設定されていません");
  const model = process.env.TTS_GEMINI_MODEL || "gemini-2.5-flash-preview-tts";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini読み上げ ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = await res.json();
  const b64 = d?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
  if (!b64) throw new Error("Geminiから音声が返りませんでした");
  return Buffer.from(b64, "base64");
}

// 長い文章はそのまま投げると失敗しやすいので、句点で区切って読み上げる
export function splitForSpeech(text, max = 400) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return [];
  if (t.length <= max) return [t];
  const out = [];
  let buf = "";
  for (const part of t.split(/(?<=[。！？!?])/)) {
    if ((buf + part).length > max && buf) { out.push(buf.trim()); buf = ""; }
    buf += part;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// 文章 → mp3のBuffer
export async function synthesize(text, opts = {}) {
  const t = String(text || "").trim();
  if (!t) throw new Error("読み上げる文章が空です");
  if (PROVIDER === "gemini") return synthesizeGemini(t, opts);
  return synthesizeEdge(t, opts);
}

// 会議に流すためのbase64（mp3）
export async function synthesizeBase64(text, opts = {}) {
  const buf = await synthesize(text, opts);
  return buf.toString("base64");
}
