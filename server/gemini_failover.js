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
// 2026-10-04 Geminiの支払いが戻ったので既定OFF（文章もGeminiで動かす）。必要なら /api/ai-text-groq で入れる。
let textViaGroq = false;
export function setTextViaGroq(on) { textViaGroq = !!on; }
export function textViaGroqOn() { return textViaGroq && !!String(process.env.GROQ_API_KEY || "").trim(); }
let groqCount = 0, groqFail = 0, groqSkipped = 0;
export function groqRouteStats() { return { on: textViaGroqOn(), routed: groqCount, failed: groqFail, longToGemini: groqSkipped }; }

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
  const maxTok = Math.min(4000, Math.max(256, Number(gc.maxOutputTokens || gc.max_output_tokens || 2048)));
  const payload = JSON.stringify({ model, messages, temperature: typeof gc.temperature === "number" ? gc.temperature : 0.4, max_tokens: maxTok });
  // 1分あたりの上限（429）に当たったら、言われた秒数だけ待ってやり直す（最大3回・1回60秒まで）
  let r, j;
  for (let i = 0; i < 4; i++) {
    r = await _fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: payload,
    });
    j = await r.json().catch(() => ({}));
    if (r.status !== 429 || i === 3) break;
    const msg = JSON.stringify(j);
    if (/tokens per day|requests per day|TPD|RPD/i.test(msg)) break;   // 1日の上限はいくら待ってもだめ
    const m = msg.match(/try again in\s+(?:(\d+)m)?([\d.]+)\s*s/i);
    const waitMs = Math.min(60000, Math.max(3000, m ? ((Number(m[1] || 0) * 60) + Number(m[2])) * 1000 + 500 : 10000));
    console.warn(`[AI] Groqの1分あたりの上限に当たったので ${Math.round(waitMs / 1000)}秒待ってやり直します`);
    await new Promise((res) => setTimeout(res, waitMs));
  }
  if (!r.ok) throw new Error(`Groq ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  const text = String((((j.choices || [])[0] || {}).message || {}).content || "");
  const fin = ((j.choices || [])[0] || {}).finish_reason === "length" ? "MAX_TOKENS" : "STOP";
  return new Response(JSON.stringify({
    candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: fin, index: 0 }],
    usageMetadata: { promptTokenCount: (j.usage || {}).prompt_tokens || 0, candidatesTokenCount: (j.usage || {}).completion_tokens || 0 },
    modelVersion: `groq:${model}`,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

// ───── Geminiの混雑（503・UNAVAILABLE・overloaded）への対処 ─────
// 少し待って同じモデルでもう一度 → まだ混んでいれば、別のモデル（GEMINI_FALLBACK_MODELS）で送り直す。
// 混雑は一時的で、モデルごとに起きるので、別のモデルなら通ることが多い。
const FALLBACK_MODELS = String(process.env.GEMINI_FALLBACK_MODELS || "gemini-2.5-flash-lite,gemini-2.0-flash").split(",").map((x) => x.trim()).filter(Boolean);
let busyRetried = 0, busyModelSwitched = 0;
export function geminiBusyStats() { return { retried: busyRetried, modelSwitched: busyModelSwitched, fallbackModels: FALLBACK_MODELS }; }
async function isBusy(res) {
  if (res.status === 503 || res.status === 529) return true;
  if (res.status === 500) { const t = await res.clone().text().catch(() => ""); return /UNAVAILABLE|overloaded|high demand|INTERNAL/i.test(t); }
  return false;
}
function withModel(url, body, model) {
  const u = url.replace(/\/models\/[^:\/?]+:/, `/models/${model}:`);
  if (typeof body !== "string") return { url: u, body };
  // 2.0系などは「思考」の設定を受け付けないので外す
  if (!/2\.5|3\./.test(model)) {
    try {
      const b = JSON.parse(body);
      const gc = b.generationConfig || b.generation_config;
      if (gc && gc.thinkingConfig) delete gc.thinkingConfig;
      return { url: u, body: JSON.stringify(b) };
    } catch {}
  }
  return { url: u, body };
}
async function sendWithBusyRetry(url, init) {
  let res = await _fetch(url, init);
  if (!/:generateContent\b/.test(url) || !(await isBusy(res))) return res;
  const body = init && init.body;
  if (body != null && typeof body !== "string") return res;   // 送り直せない本文
  // 1) 同じモデルで、少し待ってもう一度（2回）
  for (const wait of [2000, 6000]) {
    await new Promise((r) => setTimeout(r, wait));
    busyRetried++;
    res = await _fetch(url, init);
    if (!(await isBusy(res))) return res;
  }
  // 2) 別のモデルで
  const cur = (url.match(/\/models\/([^:\/?]+):/) || [])[1] || "";
  for (const m of FALLBACK_MODELS) {
    if (m === cur) continue;
    const w = withModel(url, body, m);
    console.warn(`[Gemini] ${cur} が混雑しているため、${m} で送り直します`);
    busyModelSwitched++;
    const r2 = await _fetch(w.url, { ...(init || {}), body: w.body });
    if (r2.ok || !(await isBusy(r2))) return r2;
    res = r2;
  }
  return res;
}

const _fetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url = typeof input === "string" ? input : (input && input.url) || "";
  if (!url.includes(HOST)) return _fetch(input, init);
  // 文章だけの処理はGroqへ（失敗したらGeminiに送る）。
  // ただし長い文章（商談の要約など）はGroqの無料枠（1回・1分あたりの量）に入らないので、最初からGeminiに送る。
  if (textViaGroqOn() && typeof input === "string") {
    let b = textOnlyGeminiBody(url, init && init.body);
    if (b) {
      const chars = JSON.stringify(b.contents || []).length + JSON.stringify(b.systemInstruction || b.system_instruction || "").length;
      if (chars > Number(process.env.GROQ_MAX_CHARS || 7000)) { groqSkipped++; b = null; }
    }
    if (b) {
      try { const r = await viaGroq(b); groqCount++; return r; }
      catch (e) { groqFail++; console.warn("[AI] Groqで失敗したのでGeminiに送ります:", e.message); }
    }
  }
  const { main, backup } = keys();
  if (!backup || !main) return typeof input === "string" ? sendWithBusyRetry(input, init) : _fetch(input, init);
  const body = init && init.body;
  const retryable = body == null || typeof body === "string";   // 送り直せる本文だけ（ストリームは送り直せない）
  // 予備に切り替え中なら、最初から予備のキーで送る
  if (Date.now() < useBackupUntil && typeof input === "string" && url.includes(main)) {
    return sendWithBusyRetry(swapKey(url, main, backup), init);
  }
  const res = typeof input === "string" ? await sendWithBusyRetry(input, init) : await _fetch(input, init);
  if (typeof input !== "string" || !url.includes(main) || !retryable) return res;
  if (!(await shouldFailover(res))) return res;
  lastReason = `HTTP ${res.status}`;
  useBackupUntil = Date.now() + HOLD_MS;
  console.warn(`[Gemini] いつものキーで ${res.status} のため、予備のキー（GEMINI_API_KEY_BACKUP）に切り替えます（30分）`);
  return sendWithBusyRetry(swapKey(url, main, backup), init);
};

// 使う人に見せるエラー文：支払い停止（dunning / billing）のときは、技術的な英文ではなく理由がわかる文にする
export function geminiErrorText(status, text) {
  const t = String(text || "");
  if (status === 503 || /UNAVAILABLE|high demand|overloaded/i.test(t)) return "AI（Gemini）が混み合っていて、いま処理できませんでした（別のモデルでも試しました）。少し時間をおいてもう一度お試しください。自動の見回りでもやり直します。";
  if (status === 403 && /dunning|BILLING|billing/i.test(t)) {
    const b = String(process.env.GEMINI_API_KEY_BACKUP || "").trim();
    return "AI（Gemini）の利用料金の支払いが止まっているため、いまAIの読み取り・作成が使えません。管理者が対応中です。少し時間をおいてお試しください。" +
      (b ? "（予備のキーでも止められています。予備のキーが、止まっている請求先とは別のアカウント・プロジェクトで作られているか確認してください）" : "（予備のキー GEMINI_API_KEY_BACKUP がまだ入っていません）");
  }
  if (status === 429) return "AI（Gemini）の利用回数の上限に当たりました。少し時間をおいてお試しください。";
  return `Gemini ${status}: ${t.slice(0, 200)}`;
}
