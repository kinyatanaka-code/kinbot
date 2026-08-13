// ───────────────────────────────────────────────────────────
// websearch.js — 会社名から、URL・電話・従業員数をネットで調べる
//
// gBizINFOは法人登記が元なので、URLや電話が載っていないことが多い。
// 見つからなかったぶんを、Geminiの検索機能で補う。
//
// 大事にしていること
//   ・AIは、それらしい嘘の値を作ってしまうことがある。
//     だから「確かでないものは空で返す」と強く指示し、
//     画面側でも「ネット検索の結果（要確認）」と分かるようにする。
//   ・自動立ち上げには使わない。人が見て確かめる場面でだけ使う。
// ───────────────────────────────────────────────────────────

const MODEL = process.env.COMPANY_LOOKUP_MODEL || "gemini-2.5-flash";

export function webLookupAvailable() {
  return !!process.env.GEMINI_API_KEY;
}

// 電話番号らしいかを確かめる（日本の固定・携帯・フリーダイヤル）
export function looksLikePhone(v) {
  const t = String(v || "").replace(/[‐‑–—ー－]/g, "-").replace(/[^\d-]/g, "");
  if (!t) return false;
  const digits = t.replace(/-/g, "");
  return digits.length >= 9 && digits.length <= 11;
}

// URLらしいかを確かめる
export function looksLikeUrl(v) {
  const t = String(v || "").trim();
  return /^https?:\/\/[^\s]+\.[^\s]+$/.test(t) && !/example\.(com|jp)/i.test(t);
}

function pickJson(text) {
  const t = String(text || "").replace(/```json|```/g, "").trim();
  const i = t.indexOf("{");
  const j = t.lastIndexOf("}");
  if (i < 0 || j < 0) return null;
  try { return JSON.parse(t.slice(i, j + 1)); } catch { return null; }
}

// 会社名から、URL・電話・従業員数を調べる
export async function searchCompanyInfo(name, { hintUrl = "", timeoutMs = 25000 } = {}) {
  const key = process.env.GEMINI_API_KEY;
  const q = String(name || "").trim();
  if (!key || !q) return { ok: false, reason: "設定または会社名がありません" };
  // 応答が返らないと画面が固まるので、待つ時間に上限を設ける
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  const prompt =
    `日本の会社「${q}」の公式サイトを調べて、次の項目をJSONで返してください。\n` +
    (hintUrl ? `参考URL: ${hintUrl}\n` : "") +
    `\n{"website":"公式サイトのURL","phone":"代表電話番号","employees":従業員数の数値,` +
    `"address":"本社住所","note":"どのページを見て判断したか"}\n` +
    `\n守ること：\n` +
    `・確かめられなかった項目は、必ず空文字（数値はnull）にする。推測で埋めない。\n` +
    `・同じ名前の別会社と取り違えないよう、事業内容や所在地が一致するか確かめる。\n` +
    `・電話番号は代表番号のみ。営業時間や部署番号は入れない。\n` +
    `・従業員数は数値のみ（「約100名」なら100）。連結・単体が分かれるときは単体。\n` +
    `・JSONだけを返す。前置きや説明は書かない。`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0 },
        }),
        signal: ac.signal,
      }
    );
    if (!res.ok) {
      const t = await res.text();
      // 検索機能に対応していないモデルのときは、検索なしで試す
      if (/tool|google_search|not supported/i.test(t)) return searchWithoutTool(q, key, prompt, ac.signal);
      return { ok: false, reason: `検索に失敗しました（${res.status}）` };
    }
    const d = await res.json();
    return shape(d, q);
  } catch (e) {
    return { ok: false, reason: e.name === "AbortError" ? "時間内に調べられませんでした" : e.message };
  } finally {
    clearTimeout(timer);
  }
}

async function searchWithoutTool(q, key, prompt, signal) {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0 },
        }),
        signal,
      }
    );
    if (!res.ok) return { ok: false, reason: `検索に失敗しました（${res.status}）` };
    return shape(await res.json(), q, true);
  } catch (e) { return { ok: false, reason: e.message }; }
}

// 返ってきた内容を確かめて、信用できるものだけ残す
function shape(d, q, noSearch = false) {
  const text = (d?.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "").join("");
  const j = pickJson(text);
  if (!j) return { ok: false, reason: "結果を読み取れませんでした" };

  const website = looksLikeUrl(j.website) ? String(j.website).trim() : "";
  const phone = looksLikePhone(j.phone) ? String(j.phone).trim() : "";
  const employees = Number.isFinite(+j.employees) && +j.employees > 0 && +j.employees < 2000000
    ? Math.round(+j.employees) : null;

  // 検索の根拠（Geminiが参照したページ）
  const sources = (d?.candidates?.[0]?.groundingMetadata?.groundingChunks || [])
    .map((c) => c?.web?.uri || "").filter(Boolean).slice(0, 3);

  return {
    ok: !!(website || phone || employees),
    company: q,
    website, phone, employees,
    address: String(j.address || "").trim(),
    note: String(j.note || "").slice(0, 200),
    sources,
    searched: !noSearch,
  };
}
