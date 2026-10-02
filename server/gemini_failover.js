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

const _fetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url = typeof input === "string" ? input : (input && input.url) || "";
  if (!url.includes(HOST)) return _fetch(input, init);
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
