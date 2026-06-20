// server/ai_read.js
// 資料を「中身まで読み取って構造化」する。Gemini のマルチモーダル読解を使用。
// PDF・画像はそのまま読ませて（図・スキャン文字もOCR）、営業ナレッジ用に構造化テキスト化する。
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
// 読解は精度重視で flash を既定に（必要なら環境変数で上書き）
const READ_MODEL = process.env.GEMINI_READ_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";

export function readerAvailable() {
  return !!GEMINI_KEY;
}

const READ_INSTRUCTION = `あなたは資料を読み取って「営業ナレッジ」に変換する専門家です。
渡された資料（PDF・画像・テキスト）の中身を隅々まで読み取ってください。図・表・グラフ・スクリーンショット内の文字（スキャン画像含む）も読み取ること。
読み取った内容を、日本語で次のMarkdownに構造化して出力します（前置き・コードフェンス禁止、本文のみ）:

# タイトル（資料から推定）
## 概要
（3〜5文。何の資料で、何が書かれているか）
## 重要ポイント
- （箇条書き）
## 数字・実績・価格（あれば）
- 
## 図・画像の内容（あれば。グラフや写真が示す事実）
- 
## 営業で使える点 / 想定問答
- 

ルール: 資料に書かれている事実だけを使い、推測で作らない。該当が無い見出しは省略してよい。簡潔かつ具体的に。`;

async function generate(parts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${READ_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
    }),
  });
  if (!res.ok) throw new Error(`gemini read ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "")
    .join("")
    .trim();
}

// { buffer, mimeType } か { text } を渡すと、構造化テキストを返す
export async function readDocument({ buffer, mimeType, text }) {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY 未設定");
  const parts = [{ text: READ_INSTRUCTION }];
  if (buffer && mimeType) {
    parts.push({ inline_data: { mime_type: mimeType, data: buffer.toString("base64") } });
  } else if (text) {
    parts.push({ text: "【資料テキスト】\n\n" + String(text).slice(0, 120000) });
  } else {
    throw new Error("読み取り対象がありません");
  }
  return generate(parts);
}
