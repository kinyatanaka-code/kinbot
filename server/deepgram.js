// Deepgram で文字起こしをする。
// 音声・動画のURLをそのまま渡せるので、大きいファイルをアップロードし直す必要がない。
// 必要な環境変数：DEEPGRAM_API_KEY

export function deepgramReady() {
  return !!String(process.env.DEEPGRAM_API_KEY || "").trim();
}

// URL（RecallのS3など）を渡して文字起こしする。
// 返り値：[{ speaker:{name}, text, start }]（話者は「話者1」「話者2」…）
export async function transcribeUrl(url, { language = "ja", model } = {}) {
  const key = String(process.env.DEEPGRAM_API_KEY || "").trim();
  if (!key) throw new Error("DEEPGRAM_API_KEY が未設定です");
  const mdl = model || process.env.DEEPGRAM_MODEL || "nova-2";
  const q = new URLSearchParams({
    model: mdl,
    language,
    diarize: "true",        // 話者を分ける
    punctuate: "true",      // 句読点を付ける
    smart_format: "true",
    paragraphs: "true",
  });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${q}`, {
    method: "POST",
    headers: { Authorization: `Token ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Deepgram ${res.status}: ${t.slice(0, 200)}`);
  }
  const d = await res.json().catch(() => ({}));
  const alt = d?.results?.channels?.[0]?.alternatives?.[0];
  if (!alt) return [];

  // 話者ごとにまとめる（同じ話者が続く間は1つの発言にする）
  const out = [];
  const words = Array.isArray(alt.words) ? alt.words : [];
  if (words.length) {
    let 現在 = null;
    for (const w of words) {
      const sp = (w.speaker === undefined || w.speaker === null) ? "" : `話者${Number(w.speaker) + 1}`;
      const t = w.punctuated_word || w.word || "";
      if (!t) continue;
      if (!現在 || 現在.speaker.name !== sp) {
        if (現在) out.push(現在);
        現在 = { speaker: { name: sp }, text: t, start: w.start ?? null };
      } else {
        現在.text += t;
      }
    }
    if (現在) out.push(現在);
    return out;
  }
  // 単語ごとの情報が無い場合は、全文をそのまま1つにする
  const text = String(alt.transcript || "").trim();
  return text ? [{ speaker: { name: "" }, text, start: null }] : [];
}
