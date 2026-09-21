// companyenrich.js — 会社名から、公式サイトURL・住所・従業員数を「なんとしても」埋めにいく。
// 手順：Brave Search で公式サイトURLを特定 → そのページを取得 → 本文から住所・従業員数をLLMで抽出。
// BRAVE_API_KEY が未設定のときは何もしない（gBizのみで運用）。
import { callLLMPublic } from "./analyzer.js";

const BRAVE_KEY = () => process.env.BRAVE_API_KEY || "";
export function webSearchConfigured() { return !!BRAVE_KEY(); }

function withTimeout(url, opts = {}, ms = 12000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t));
}

// Braveで会社名を検索して、上位の結果（URL・タイトル・説明）を返す
async function braveSearch(query, count = 6) {
  if (!BRAVE_KEY()) return [];
  try {
    const u = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&country=jp&search_lang=jp`;
    const r = await withTimeout(u, {
      headers: { "Accept": "application/json", "X-Subscription-Token": BRAVE_KEY() },
    }, 12000);
    if (!r.ok) return [];
    const d = await r.json().catch(() => null);
    const items = (d && d.web && d.web.results) || [];
    return items.map((x) => ({ url: x.url || "", title: x.title || "", desc: x.description || "" })).filter((x) => x.url);
  } catch { return []; }
}

// 検索結果から「その会社の公式サイトらしいURL」を選ぶ
function pickOfficial(results, company) {
  const bad = /(wikipedia|facebook|twitter|x\.com|instagram|linkedin|youtube|note\.com|prtimes|indeed|en-gage|mynavi|rikunabi|baseconnect|houjin\.jp|alarmbox|salesnow|musubu|ycard|nikkei|itmedia|google\.|amazon\.|rakuten\.)/i;
  const cand = results.filter((r) => !bad.test(r.url));
  // タイトル・説明に会社名を含むものを優先
  const key = String(company || "").replace(/(株式会社|有限会社|合同会社|（株）|\(株\)|㈱)/g, "").trim();
  const withName = cand.filter((r) => key && (r.title.includes(key) || r.desc.includes(key)));
  return (withName[0] || cand[0] || results[0] || null);
}

// ページ本文をざっくり取得（HTMLタグを落として先頭を返す）
export async function fetchPageText(url) {
  try {
    const r = await withTimeout(url, { headers: { "User-Agent": "Mozilla/5.0 kinbot" } }, 12000);
    if (!r.ok) return "";
    const html = await r.text();
    const text = String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 8000);
  } catch { return ""; }
}

// LLMで、ページ本文から住所・従業員数などを抽出
async function extractFromText(company, url, text) {
  if (!text) return {};
  const sys = "あなたは日本企業の会社概要から情報を抜き出すアシスタントです。与えられた本文から、その会社の情報だけをJSONで返してください。値が本文から確実に読み取れないものは空文字にしてください。推測で埋めないこと。";
  const user =
    `会社名：${company}\nURL：${url}\n\n本文（会社概要ページなど）：\n${text}\n\n` +
    `次のJSONだけを返す（前後に文章を付けない）：\n` +
    `{"address":"本社所在地（都道府県から）","employees":"従業員数（数字のみ。例 120。分からなければ空）","official_name":"正式な会社名","website":"公式サイトURL"}`;
  try {
    const out = await callLLMPublic(sys, user, 400, { json: true, provider: "gemini" });
    const j = typeof out === "string" ? JSON.parse(out.replace(/```json|```/g, "").trim()) : out;
    return {
      address: String((j && j.address) || "").trim(),
      employees: String((j && j.employees) || "").replace(/[^\d]/g, ""),
      official_name: String((j && j.official_name) || "").trim(),
      website: String((j && j.website) || url).trim(),
    };
  } catch { return {}; }
}

// 公式サイトURL（gBizのcompany_url等）が分かっているとき、その会社概要ページを直接読んで従業員数を拾う。
// 検索APIを使わずHTTP取得＋抽出だけなので安く、一次情報なので精度が高い。取れなければ空文字。
// 会社概要ページの本文から「従業員数◯名」を正規表現で拾う（Gemini不使用＝完全無料）
export function extractEmployeesRegex(text) {
  if (!text) return "";
  const t = String(text).replace(/[\t\r\u3000]+/g, " ");
  // 従業員数を表すラベル（福祉/病院/学校の「職員」、有報の「就業人員」、英語表記なども）
  const label = "(?:従業員数|従業員合計|従業員計|従業員|従業者数|就業人員数|就業人員|社員数|正社員数|総従業員数|グループ従業員(?:数)?|グループ社員(?:数)?|職員数|正職員数|正職員|常勤職員(?:数)?|職員|スタッフ数|人員数|陣容|Employees?|Number of employees|No\\.?\\s*of\\s*employees|Total\\s*(?:number of\\s*)?employees|Staff)";
  const num = "([0-9０-９][0-9０-９,，\\.]{0,9})";
  const unit = "\\s*(万|千)?";               // 数字の後ろの「万／千」
  const suffix = "\\s*(?:名|人|名超|余名|名以上|人以上)";
  const toNum = (s, u) => {
    const h = s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xFEE0));
    if (u === "万" || u === "千") {
      const f = parseFloat(h.replace(/[，,]/g, ""));
      if (!isFinite(f)) return 0;
      const n = Math.round(f * (u === "万" ? 10000 : 1000));
      return (n > 0 && n <= 5000000) ? n : 0;
    }
    const n = parseInt(h.replace(/[，,．.]/g, ""), 10);
    return (isFinite(n) && n > 0 && n <= 5000000) ? n : 0;
  };
  const run = (pre) => {
    const m = new RegExp(label + "[^0-9０-９]{0,25}?" + (pre || "") + num + unit + suffix + "(?!\\s*[分年])", "i").exec(t);
    if (m) { const n = toNum(m[1], m[2]); if (n) return String(n) + "名"; }
    return "";
  };
  // ① 単体／提出会社（有報）を優先＝連結の大きい数字を避ける
  let r = run("(?:単体|提出会社)[^0-9０-９]{0,8}?"); if (r) return r;
  // ② ラベル→(約/連結など)→数字[万/千]→名/人
  r = run(""); if (r) return r;
  // ③ 名/人が無い保険（設立年などを避けるため「年」直後は除外）
  const m3 = new RegExp(label + "[^0-9０-９]{0,12}?" + num + unit + "(?!\\s*年)", "i").exec(t);
  if (m3) { const n = toNum(m3[1], m3[2]); if (n) return String(n) + "名"; }
  return "";
}
// トップページのHTMLから「会社概要」系ページのURL候補を拾う
async function aboutLinksFrom(url) {
  try {
    const r = await withTimeout(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; kincall/1.0)" } }, 10000);
    if (!r.ok) return [];
    const html = (await r.text()).slice(0, 400000);
    const base = new URL(url);
    const out = new Set();
    const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    const want = /(会社概要|会社案内|企業情報|会社情報|企業概要|概要|about|company|corporate|profile|outline)/i;
    while ((m = re.exec(html)) && out.size < 8) {
      const href = m[1]; const txt = m[2].replace(/<[^>]+>/g, "");
      if (!want.test(href) && !want.test(txt)) continue;
      try { const abs = new URL(href, base).href; if (/^https?:/i.test(abs) && new URL(abs).host === base.host) out.add(abs.split("#")[0]); } catch {}
    }
    return [...out];
  } catch { return []; }
}
export async function employeesFromSite(company, website) {
  const site = String(website || "").trim();
  if (!site) return "";
  const base = site.replace(/\/+$/, "");
  // 会社概要系のよくあるパス＋採用/IRページ
  const paths = ["", "/company/", "/about/", "/company/outline/", "/corporate/", "/profile/", "/company/profile/", "/outline/", "/company/about/", "/recruit/", "/ir/", "/info/"];
  const commonUrls = [...new Set(paths.map((p) => (/^https?:/i.test(p) ? p : base + p)))];
  // トップページのHTMLから「会社概要」ページのURLも自動で見つける（独自パス対策）
  const discovered = await aboutLinksFrom(base + "/").catch(() => []);
  const urls = [...new Set([...commonUrls, ...discovered])].slice(0, 14);
  const texts = await Promise.all(urls.map((u) => fetchPageText(u).then((t) => ({ u, t })).catch(() => ({ u, t: "" }))));
  // 正規表現で従業員数を抽出（無料）。取れたら即返す。まず「従業員」語のあるページを優先。
  const withLabel = texts.filter((x) => x.t && /従業員|社員数|従業員数|Employees|スタッフ|人員/i.test(x.t));
  for (const x of withLabel) { const e = extractEmployeesRegex(x.t); if (e) return e; }
  for (const x of texts) { if (!x.t) continue; const e = extractEmployeesRegex(x.t); if (e) return e; }
  return "";
}

// Braveで検索して従業員数を拾う（Geminiは使わない＝安い）。①検索スニペットから正規表現 ②公式サイトを直読み(正規表現)。
export async function employeesViaBrave(company) {
  if (!BRAVE_KEY() || !company) return "";
  const res = await braveSearch(`${company} 従業員数 会社概要`, 6).catch(() => []);
  // ① 検索結果の説明文(スニペット)から直接拾う（サイトを開かず取れることも）
  for (const r of (res || [])) { const e = extractEmployeesRegex(`${r.title || ""} ${r.desc || ""}`); if (e) return e; }
  // ② 公式サイトらしきURLを見つけて会社概要ページを直読み（正規表現）
  const off = pickOfficial(res || [], company);
  if (off && off.url) { const e = await employeesFromSite(company, off.url).catch(() => ""); if (e) return e; }
  return "";
}

// メイン：会社名から、公式サイトURL・住所・従業員数を集める。
// 返り値：{ website, address, employees, official_name, source:"web" } 取れたものだけ入る。
export async function enrichCompanyFromWeb(company) {
  if (!BRAVE_KEY() || !company) return {};
  const results = await braveSearch(`${company} 会社概要 本社 所在地 従業員数`, 6);
  if (!results.length) return {};
  const off = pickOfficial(results, company);
  if (!off) return {};
  // 会社概要ページを狙って、公式トップと「会社概要/company」ページの両方を軽く見る
  const urls = [off.url];
  const text1 = await fetchPageText(off.url);
  let info = await extractFromText(company, off.url, text1);
  // 住所か従業員数が欠けていたら、会社概要ページを探して補う
  if (!info.address || !info.employees) {
    const more = await braveSearch(`${company} 会社概要 site:${hostOf(off.url)}`, 3);
    const aboutUrl = (more[0] && more[0].url) || "";
    if (aboutUrl && aboutUrl !== off.url) {
      const t2 = await fetchPageText(aboutUrl);
      const info2 = await extractFromText(company, aboutUrl, t2);
      info = {
        website: info.website || info2.website,
        official_name: info.official_name || info2.official_name,
        address: info.address || info2.address,
        employees: info.employees || info2.employees,
      };
      urls.push(aboutUrl);
    }
  }
  const out = {};
  if (info.website) out.website = info.website;
  if (info.address) out.address = info.address;
  if (info.employees) out.employees = info.employees;
  if (info.official_name) out.official_name = info.official_name;
  if (Object.keys(out).length) out.source = "web";
  out.pages = urls;
  return out;
}

function hostOf(u) { try { return new URL(u).host; } catch { return ""; } }
