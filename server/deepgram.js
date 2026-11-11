// Deepgram で文字起こしをする。
// 音声・動画のURLをそのまま渡せるので、大きいファイルをアップロードし直す必要がない。
// 必要な環境変数：DEEPGRAM_API_KEY

// ===== キーの切りかえ（2026-11-11 田中さん：キーを替えるたびに Railway を触らなくてよいように）=====
//   使う順：Railway の DEEPGRAM_API_KEY → kinbot の設定に入れた控えのキー（上から）。
//   キーが使えない（401・402・403、残高・クレジット不足など）と、そのキーを6時間休ませて次のキーで送り直す
let _dgExtra = [];
const _dgBad = new Map();   // key → { at, reason }
export function setDeepgramKeys(list) { _dgExtra = (Array.isArray(list) ? list : []).map((k) => String((k && k.key) || "").trim()).filter(Boolean); }
export function deepgramKeys() { const env = String(process.env.DEEPGRAM_API_KEY || "").trim(); return [...new Set([...(env ? [env] : []), ..._dgExtra])]; }
export function deepgramKeyStatus() {
  const env = String(process.env.DEEPGRAM_API_KEY || "").trim();
  return deepgramKeys().map((k, i) => ({ last4: k.slice(-4), fromEnv: k === env, order: i + 1, bad: _dgBad.get(k) || null }));
}
export function deepgramActiveLast4() { const k = dgUsable()[0]; return k ? k.slice(-4) : ""; }
function dgUsable() { const ks = deepgramKeys(); const ok = ks.filter((k) => { const b = _dgBad.get(k); return !b || Date.now() - b.at > 6 * 3600000; }); return ok.length ? ok : ks; }
const dgKeyErr = (status, t) => status === 401 || status === 402 || status === 403 || /insufficient|credit|balance|quota|INVALID_AUTH|exhaust/i.test(String(t || ""));
// Deepgram に送る（キーが使えなければ次のキーで送り直す）。makeInit(key) で毎回 init を作る（ファイルの流れは使い回せないため）
export async function dgFetch(url, makeInit) {
  const ks = dgUsable(); if (!ks.length) throw new Error("DeepgramのAPIキーが未設定です");
  let lastRes = null, lastText = "";
  for (const k of ks) {
    const res = await fetch(url, makeInit(k));
    if (res.ok) { _dgBad.delete(k); return res; }
    const t = await res.text().catch(() => "");
    if (dgKeyErr(res.status, t)) { _dgBad.set(k, { at: Date.now(), reason: `${res.status} ${t.slice(0, 120)}` }); console.warn(`[deepgram] キー ****${k.slice(-4)} が使えません（${res.status}）。次のキーで送り直します`); lastRes = res; lastText = t; continue; }
    return new Response(t, { status: res.status, headers: res.headers });
  }
  return new Response(lastText, { status: lastRes ? lastRes.status : 500 });
}
// キーが使えるか確かめる（設定の画面から）
export async function deepgramTestKey(key) {
  const r = await fetch("https://api.deepgram.com/v1/projects", { headers: { Authorization: `Token ${String(key || "").trim()}` } }).catch((e) => ({ ok: false, status: 0, text: async () => e.message }));
  if (r.ok) return { ok: true }; return { ok: false, reason: `${r.status} ${(await r.text().catch(() => "")).slice(0, 120)}` };
}

export function deepgramReady() {
  return deepgramKeys().length > 0;
}

// URL（RecallのS3など）を渡して文字起こしする。
// 返り値：[{ speaker:{name}, text, start }]（話者は「話者1」「話者2」…）
export async function transcribeUrl(url, { language = "ja", model } = {}) {
  if (!deepgramReady()) throw new Error("DeepgramのAPIキーが未設定です");
  const mdl = model || process.env.DEEPGRAM_MODEL || "nova-2";
  const q = new URLSearchParams({
    model: mdl,
    language,
    diarize: "true",        // 話者を分ける
    punctuate: "true",      // 句読点を付ける
    smart_format: "true",
    paragraphs: "true",
  });
  const res = await dgFetch(`https://api.deepgram.com/v1/listen?${q}`, (key) => ({
    method: "POST",
    headers: { Authorization: `Token ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ url }),
  }));
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
      // 日本語は単語のあいだに空白を入れない。英数字が続くときだけ空白を入れる。
      const つなぐ = (前, 次) => {
        if (!前) return 次;
        const a = 前.slice(-1), b = 次.slice(0, 1);
        return (/[A-Za-z0-9]/.test(a) && /[A-Za-z0-9]/.test(b)) ? `${前} ${次}` : 前 + 次;
      };
      // 話者が変わっても、ごく短い（1〜2文字）ものは前の発言に付ける（切れすぎ防止）
      if (現在 && 現在.speaker.name !== sp && 現在.text.length < 6) { 現在.text = つなぐ(現在.text, t); continue; }
      if (!現在 || 現在.speaker.name !== sp) {
        if (現在) out.push(現在);
        現在 = { speaker: { name: sp }, text: t, start: w.start ?? null };
      } else {
        現在.text = つなぐ(現在.text, t);
      }
    }
    if (現在) out.push(現在);
    // 1〜2文字だけの発言が残っていたら、前の発言にくっつける
    const 整えた = [];
    for (const u of out) {
      const 前 = 整えた[整えた.length - 1];
      if (前 && u.text.length <= 2) { 前.text += u.text; continue; }
      整えた.push(u);
    }
    return 整えた;
  }
  // 単語ごとの情報が無い場合は、全文をそのまま1つにする
  const text = String(alt.transcript || "").trim();
  return text ? [{ speaker: { name: "" }, text, start: null }] : [];
}
