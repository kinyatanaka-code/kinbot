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
      generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
    }),
  });
  if (!res.ok) throw new Error(`gemini read ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "")
    .join("")
    .trim();
}

// ホワイトボードの写真から、週のボードの中身を読み取る。
//
// 手書きなので、読めない字は無理に埋めず空にする（間違ったまま入るほうが困るため）。
// 返すのはJSONだけ。名前ごとに、テーマ・定量目標・施策（箇条書き）に分ける。
const BOARD_INSTRUCTION = `あなたは、営業チームのホワイトボードの写真を読み取る担当です。
写真には、担当者ごとの「テーマ（やり切ること）」「定量目標」「具体的な施策」が手書きで書かれています。
読み取って、次のJSONだけを返してください（前置き・説明・コードフェンスは書かない）。

{"people":[{"name":"担当者名","theme":"テーマ","targets":"定量目標","actions":["施策1","施策2"]}]}

決まり:
- 写真に書かれていることだけを使う。推測で補わない。
- 読めない字は、その項目を空文字（施策なら省く）にする。少しでも自信が無ければ空にする。
- 担当者名は、表の見出し（いちばん上の行）に書かれている名前をそのまま使う。
- 「定量目標」は数字を含む行をそのまま書き写す。矢印（→）や単位もそのまま残す。
- 「具体的な施策」は、箇条書きの1行を1つの施策として分ける。長い文はそのまま入れてよい。
- 人数ぶんだけ people に入れる。空の列は入れない。`;

export async function readWhiteboard({ buffer, mimeType = "image/jpeg" }) {
  if (!GEMINI_KEY) throw new Error("画像を読む設定（GEMINI_API_KEY）がありません");
  if (!buffer || !buffer.length) throw new Error("画像がありません");
  const text = await generate([
    { text: BOARD_INSTRUCTION },
    { inline_data: { mime_type: mimeType, data: buffer.toString("base64") } },
  ]);
  const cleaned = String(text || "").replace(/```json|```/g, "").trim();
  let data = null;
  try {
    data = JSON.parse(cleaned);
  } catch {
    // 前後に文が付いていることがあるので、いちばん外側の { } を取り出す
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) { try { data = JSON.parse(m[0]); } catch {} }
  }
  if (!data || !Array.isArray(data.people)) throw new Error("写真から読み取れませんでした");
  return data.people
    .map((p) => ({
      name: String(p.name || "").trim(),
      theme: String(p.theme || "").trim(),
      targets: String(p.targets || "").trim(),
      actions: (Array.isArray(p.actions) ? p.actions : [])
        .map((a) => String(a || "").trim()).filter(Boolean).slice(0, 20),
    }))
    .filter((p) => p.name);
}

// --- Gemini File API（大容量ファイル用：アップロード→参照して読解） ---
async function uploadFile(buffer, mimeType, displayName) {
  const startRes = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${GEMINI_KEY}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(buffer.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "content-type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName || "doc" } }),
  });
  if (!startRes.ok) throw new Error(`file start ${startRes.status}`);
  const uploadUrl = startRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("upload url が取得できません");
  const upRes = await fetch(uploadUrl, {
    method: "POST",
    headers: { "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize", "content-type": mimeType },
    body: buffer,
  });
  if (!upRes.ok) throw new Error(`file upload ${upRes.status}`);
  return (await upRes.json()).file; // {name, uri, mimeType, state}
}
async function waitActive(file) {
  let f = file;
  for (let i = 0; i < 40 && f && f.state && f.state !== "ACTIVE"; i++) {
    if (f.state === "FAILED") throw new Error("ファイル処理に失敗しました");
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${f.name}?key=${GEMINI_KEY}`);
    if (res.ok) f = await res.json();
  }
  return f;
}
async function deleteFile(name) {
  try {
    await fetch(`https://generativelanguage.googleapis.com/v1beta/${name}?key=${GEMINI_KEY}`, { method: "DELETE" });
  } catch {}
}

const INLINE_MAX = 14 * 1024 * 1024; // これ以下はインライン、超えたらFile API

// { buffer, mimeType } か { text } を渡すと、構造化テキストを返す
export async function readDocument({ buffer, mimeType, text, displayName }) {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY 未設定");
  if (text) {
    return generate([{ text: READ_INSTRUCTION }, { text: "【資料テキスト】\n\n" + String(text).slice(0, 120000) }]);
  }
  if (buffer && mimeType) {
    if (buffer.length <= INLINE_MAX) {
      return generate([{ text: READ_INSTRUCTION }, { inline_data: { mime_type: mimeType, data: buffer.toString("base64") } }]);
    }
    // 大容量：File APIへアップロードしてから読解
    const up = await uploadFile(buffer, mimeType, displayName);
    const active = await waitActive(up);
    try {
      return await generate([
        { text: READ_INSTRUCTION },
        { file_data: { mime_type: active.mimeType || mimeType, file_uri: active.uri } },
      ]);
    } finally {
      if (active?.name) deleteFile(active.name);
    }
  }
  throw new Error("読み取り対象がありません");
}
