// Gemini APIキーの予備への自動切り替え。
// GEMINI_API_KEY（いつものキー）で、支払いの停止・キーの無効・使いすぎ（403 / 400 のキー無効 / 429）が返ってきたら、
// GEMINI_API_KEY_BACKUP（予備のキー）に差し替えてもう一度送る。切り替えたら30分は予備のキーを使い続ける。
// どの機能も URL の ?key= で Gemini を呼んでいるので、fetch の手前でまとめて差し替える（各機能のコードは触らない）。
const HOST = "generativelanguage.googleapis.com";
const HOLD_MS = 30 * 60 * 1000;
let useBackupUntil = 0;
let lastReason = "";

function keys() {
  return { main: String(process.env.GEMINI_API_KEY || "").trim(), backup: String(process.env.GEMINI_API_KEY_BACKUP || "").trim() };
}
function swapKey(url, from, to) {
  if (!from || !to) return url;
  return url.replace(`key=${encodeURIComponent(from)}`, `key=${encodeURIComponent(to)}`).replace(`key=${from}`, `key=${to}`);
}
async function shouldFailover(res) {
  if (res.status === 429 || res.status === 403) return true;
  if (res.status === 400) {
    const t = await res.clone().text().catch(() => "");
    return /API_KEY_INVALID|API key not valid|API key expired|BILLING|billing/i.test(t);
  }
  return false;
}

export function geminiFailoverStatus() {
  const { main, backup } = keys();
  return { hasBackup: !!backup, usingBackup: !!backup && Date.now() < useBackupUntil, until: useBackupUntil ? new Date(useBackupUntil).toISOString() : "", reason: lastReason, hasMain: !!main };
}

// ───── 文章だけの処理をGroqで動かす（一時的な切り替え） ─────
// Geminiへの generateContent のうち、本文が文字だけ（画像・PDF・音声・ファイル・Google検索なし）のものを、
// Groq（OpenAI互換）に送って、Geminiと同じ形の返事に直して返す。呼び出し側のコードは変えない。
// 既定ON（2026-10-02、Geminiの支払い停止のため）。setTextViaGroq(false) で戻す。
let textViaGroq = true;
export function setTextViaGroq(on) { textViaGroq = !!on; }
export function textViaGroqOn() { return textViaGroq && !!String(process.env.GROQ_API_KEY || "").trim(); }
let groqCount = 0, groqFail = 0;
export function groqRouteStats() { return { on: textViaGroqOn(), routed: groqCount, failed: groqFail }; }

function textOnlyGeminiBody(url, body) {
  if (!/:generateContent\b/.test(url) || typeof body !== "string") return null;
  let b; try { b = JSON.parse(body); } catch { return null; }
  if (!b || !Array.isArray(b.contents)) return null;
  if (Array.isArray(b.tools) && b.tools.length) return null;   // Google検索などの道具つきはGeminiのまま
  const partsOk = (parts) => (parts || []).every((p) => p && typeof p.text === "string" && Object.keys(p).every((k) => k === "text" || k === "thought"));
  if (!b.contents.every((c) => partsOk(c.parts))) return null;
  const sys = b.systemInstruction || b.system_instruction;
  if (sys && !partsOk(sys.parts)) return null;
  return b;
}
async function viaGroq(b) {
  const gc = b.generationConfig || b.generation_config || {};
  const messages = [];
  const sys = b.systemInstruction || b.system_instruction;
  const sysText = sys ? (sys.parts || []).map((p) => p.text).join("\n") : "";
  const wantJson = /json/i.test(String(gc.responseMimeType || gc.response_mime_type || ""));
  const sysAll = [sysText, wantJson ? "出力はJSONだけにしてください。説明文やコードフェンス（```）は書かないでください。" : ""].filter(Boolean).join("\n\n");
  if (sysAll) messages.push({ role: "system", content: sysAll });
  for (const c of b.contents) messages.push({ role: c.role === "model" ? "assistant" : "user", content: (c.parts || []).map((p) => p.text).join("\n") });
  const model = (process.env.GROQ_TEXT_MODEL || process.env.GROQ_MODEL || "llama-3.3-70b-versatile").replace(/.*(whisper|orpheus|tts).*/i, "llama-3.3-70b-versatile");
  const maxTok = Math.min(8000, Math.max(256, Number(gc.maxOutputTokens || gc.max_output_tokens || 4096)));
  const r = await _fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({ model, messages, temperature: typeof gc.temperature === "number" ? gc.temperature : 0.4, max_tokens: maxTok }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Groq ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  const text = String((((j.choices || [])[0] || {}).message || {}).content || "");
  const fin = ((j.choices || [])[0] || {}).finish_reason === "length" ? "MAX_TOKENS" : "STOP";
  return new Response(JSON.stringify({
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: fin, index: 0 }],
    usageMetadata: { promptTokenCount: (j.usage || {}).prompt_tokens || 0, candidatesTokenCount: (j.usage || {}).completion_tokens || 0 },
    modelVersion: `groq:${model}`,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

const _fetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url = typeof input === "string" ? input : (input && input.url) || "";
  if (!url.includes(HOST)) return _fetch(input, init);
  // 文章だけの処理はGroqへ（失敗したらGeminiに送る）
  if (textViaGroqOn() && typeof input === "string") {
    const b = textOnlyGeminiBody(url, init && init.body);
    if (b) {
      try { const r = await viaGroq(b); groqCount++; return r; }
      catch (e) { groqFail++; console.warn("[AI] Groqで失敗したのでGeminiに送ります:", e.message); }
    }
  }
  const { main, backup } = keys();
  if (!backup || !main) return _fetch(input, init);
  const body = init && init.body;
  const retryable = body == null || typeof body === "string";   // 送り直せる本文だけ（ストリームは送り直せない）
  // 予備に切り替え中なら、最初から予備のキーで送る
  if (Date.now() < useBackupUntil && typeof input === "string" && url.includes(main)) {
    return _fetch(swapKey(url, main, backup), init);
  }
  const res = await _fetch(input, init);
  if (typeof input !== "string" || !url.includes(main) || !retryable) return res;
  if (!(await shouldFailover(res))) return res;
  lastReason = `HTTP ${res.status}`;
  useBackupUntil = Date.now() + HOLD_MS;
  console.warn(`[Gemini] いつものキーで ${res.status} のため、予備のキー（GEMINI_API_KEY_BACKUP）に切り替えます（30分）`);
  return _fetch(swapKey(url, main, backup), init);
};

// 使う人に見せるエラー文：支払い停止（dunning / billing）のときは、技術的な英文ではなく理由がわかる文にする
export function geminiErrorText(status, text) {
  const t = String(text || "");
  if (status === 403 && /dunning|BILLING|billing/i.test(t)) {
    return "AI（Gemini）の利用料金の支払いが止まっているため、いまAIの読み取り・作成が使えません。管理者が対応中です。少し時間をおいてお試しください。";
  }
  if (status === 429) return "AI（Gemini）の利用回数の上限に当たりました。少し時間をおいてお試しください。";
  return `Gemini ${status}: ${t.slice(0, 200)}`;
}
