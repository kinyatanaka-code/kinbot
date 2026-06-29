// server/transcribe.js
// アップロードされた音声/動画ファイルを文字起こしする。
// 優先: Deepgram（話者分離あり）。無ければ Groq Whisper（話者分離なし）。
import fs from "node:fs";

export function transcriberAvailable() {
  return !!(process.env.DEEPGRAM_API_KEY || process.env.GROQ_API_KEY);
}

export async function transcribeFile(filePath, mimetype) {
  if (process.env.DEEPGRAM_API_KEY) return transcribeDeepgram(filePath, mimetype);
  if (process.env.GROQ_API_KEY) return transcribeGroq(filePath, mimetype);
  throw new Error("文字起こし用のAPIキー（DEEPGRAM_API_KEY か GROQ_API_KEY）が未設定です");
}

async function transcribeDeepgram(filePath, mimetype) {
  const lang = process.env.LANGUAGE_CODE || "ja";
  const model = process.env.DEEPGRAM_MODEL || "nova-2";
  const url = `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(
    model
  )}&language=${encodeURIComponent(lang)}&diarize=true&punctuate=true&smart_format=true`;
  // 大きいファイルでもメモリに載せないようストリームで送信
  const stat = fs.statSync(filePath);
  const stream = fs.createReadStream(filePath);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      "Content-Type": mimetype || "application/octet-stream",
      "Content-Length": String(stat.size),
    },
    body: stream,
    duplex: "half",
  });
  if (!res.ok) throw new Error(`Deepgram ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const alt = data?.results?.channels?.[0]?.alternatives?.[0];
  const words = alt?.words || [];
  const utts = [];
  let cur = null;
  for (const w of words) {
    const sp = w.speaker ?? 0;
    const t = w.punctuated_word || w.word || "";
    if (!cur || cur.spk !== sp) {
      cur = { spk: sp, parts: [] };
      utts.push(cur);
    }
    cur.parts.push(t);
  }
  let utterances = utts.map((u) => ({
    speaker: { id: u.spk, name: "話者" + (u.spk + 1) },
    text: u.parts.join(" "),
    ts: Date.now(),
  }));
  if (utterances.length === 0 && alt?.transcript) {
    utterances = [{ speaker: { id: 0, name: "話者1" }, text: alt.transcript, ts: Date.now() }];
  }
  return utterances;
}

async function transcribeGroq(filePath, mimetype) {
  const stat = fs.statSync(filePath);
  // Groq(Whisper) は大きいファイル非対応。大きい場合は Deepgram を促す
  if (stat.size > 100 * 1024 * 1024) {
    throw new Error("このファイルは大きいため Groq では文字起こしできません。DEEPGRAM_API_KEY を設定してください（Deepgramは大容量対応）。");
  }
  const buf = fs.readFileSync(filePath);
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: mimetype || "audio/mpeg" }), "audio");
  fd.append("model", process.env.GROQ_WHISPER_MODEL || "whisper-large-v3");
  fd.append("language", process.env.LANGUAGE_CODE || "ja");
  fd.append("response_format", "json");
  const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: fd,
  });
  if (!res.ok) throw new Error(`Groq文字起こし ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.text ? [{ speaker: { id: 0, name: "話者1" }, text: data.text, ts: Date.now() }] : [];
}
