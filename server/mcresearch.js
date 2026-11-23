// mcresearch.js — MOCHICALL の企業調査を、AI（Gemini）を使わずに行う（2026-11-20 福井さん「企業調査は API ではなく Web 検索や gBizINFO で代用」）
//
// なぜ：Gemini の Google 検索つきで1社ずつ調べていたら、1日1,200社で検索代と AI 代が重くなった（11/19〜20 で約 $66）。
//   SHOBO の Gemini は月5,000円までにしたので、毎日たくさん回る企業調査は AI に頼らない形に変える。
// やり方：
//   ① gBizINFO（国の法人情報・無料）で 本社・設立・従業員数・事業・公式サイト を取る
//   ② 鍵のいらない Web 検索（DuckDuckGo の HTML 版。だめなら Bing）で、公式サイトと採用の載り先を探す
//   ③ 公式サイトの本文から、従業員数・募集職種・採用人数を決まった言い回しで抜き出す
// 大事にしていること：見つからないものは空にする（それらしい作り話で架電者を間違わせない）。
//   「推定採用課題」「話の切り口」は、見つかった事実から決まった形で組み立てる（AI の文章ではないので、根拠が無ければ空）
import { searchCompanies, getCompanyDetail, gbizConfigured } from "./gbizinfo.js";
import { fetchPageText, extractEmployeesRegex, employeesFromSite } from "./companyenrich.js";
import { CHECK_V, recruitClock, freshness, valueFreshness, gradYears, isClosed } from "./mcfresh.js";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
function withTimeout(url, opts = {}, ms = 12000) {
  // 時間切れは本文を読み終えるまで効かせる（ヘッダーが届いた時点で止めると、遅いサイトで調査が固まり、3枠が埋まって調査全体が止まった。2026-11-20）
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); if (t.unref) t.unref();
  return fetch(url, { ...opts, signal: c.signal });
}
const unHtml = (s) => String(s || "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

// ───── 鍵のいらない Web 検索 ─────
async function ddg(query, count) {
  const r = await withTimeout(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&kl=jp-jp`, { headers: { "user-agent": UA, "accept-language": "ja" } });
  if (r.status !== 200) return null;   // 止められた（DuckDuckGo の 202 など）ときは null、ちゃんと0件のときは []
  const html = await r.text(); const out = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>|<\/div>)/g;
  let m;
  while ((m = re.exec(html)) && out.length < count) {
    let u = m[1].replace(/&amp;/g, "&");
    const q = u.match(/[?&]uddg=([^&]+)/); if (q) u = decodeURIComponent(q[1]);
    if (u.startsWith("//")) u = "https:" + u;
    if (!/^https?:\/\//.test(u) || /duckduckgo\.com\/y\.js/.test(u)) continue;   // 広告は飛ばす
    out.push({ url: u, title: unHtml(m[2]), desc: unHtml(m[3]) });
  }
  return out;
}
async function bing(query, count) {
  const r = await withTimeout(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=ja&cc=JP`, { headers: { "user-agent": UA, "accept-language": "ja" } });
  if (r.status !== 200) return null;   // 止められた（DuckDuckGo の 202 など）ときは null、ちゃんと0件のときは []
  const html = await r.text(); const out = [];
  for (const blk of html.split(/<li class="b_algo"/).slice(1)) {
    const a = blk.match(/<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/); if (!a) continue;
    let u = a[1].replace(/&amp;/g, "&");
    const enc = u.match(/[?&]u=a1([^&]+)/);   // Bing の飛び先（base64）を元の URL に戻す
    if (enc) { try { u = Buffer.from(enc[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); } catch {} }
    if (!/^https?:\/\//.test(u)) continue;
    const p = blk.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    out.push({ url: u, title: unHtml(a[2]), desc: unHtml(p && p[1]) });
    if (out.length >= count) break;
  }
  return out;
}
// Yahoo! JAPAN：日本語の会社名にいちばん強い（Bing は日本語の検索語を「株式会社」「ネオ」だけで探すことがあった）
async function yahoo(query, count) {
  const r = await withTimeout(`https://search.yahoo.co.jp/search?p=${encodeURIComponent(query)}&ei=UTF-8`, { headers: { "user-agent": UA, "accept-language": "ja" } });
  if (r.status !== 200) return null;   // 止められた（DuckDuckGo の 202 など）ときは null、ちゃんと0件のときは []
  const html = await r.text(); const out = [];
  for (const blk of html.split(/class="sw-Card Algo/).slice(1)) {
    const a = blk.match(/class="sw-Card__title"[^>]*>\s*<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/); if (!a) continue;
    const p = blk.match(/class="sw-Card__summary"[^>]*>([\s\S]*?)<\/(?:p|div)>/);
    out.push({ url: a[1].replace(/&amp;/g, "&"), title: unHtml(a[2]), desc: unHtml(p && p[1]) });
    if (out.length >= count) break;
  }
  return out;
}
// 検索がどれも止められたときは空で返す（呼び出し側は gBizINFO とサイト本文だけで続ける）
let _searchFail = 0; const _used = { yahoo: 0, ddg: 0, bing: 0 };
//   検索先に「機械からの大量アクセス」と見られて止められないよう、1回ずつ間をあける（既定1.2秒・MCCALL_SEARCH_GAP_MS）。
//   結果が空で返ってきた検索先（DuckDuckGo の 202 の確認画面など）は15分休ませて、次の検索先で続ける
const GAP = Math.max(300, parseInt(process.env.MCCALL_SEARCH_GAP_MS || "1200", 10) || 1200);
let _nextAt = 0; const _restUntil = {};
async function paced(fn) {
  const wait = Math.max(0, _nextAt - Date.now()); _nextAt = Math.max(Date.now(), _nextAt) + GAP;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  return fn();
}
export async function freeWebSearch(query, count = 8) {
  for (const [n, f] of [["yahoo", yahoo], ["ddg", ddg], ["bing", bing]]) {
    if (Date.now() < (_restUntil[n] || 0)) continue;
    try {
      const r = await paced(() => f(query, count));
      if (r && r.length) { _used[n]++; return r; }
      if (r) continue;   // 0件はふつうの結果（休ませない）。次の検索先でも探してみる
    } catch {}
    _restUntil[n] = Date.now() + 15 * 60e3;   // 止められた・つながらない
  }
  _searchFail++;
  return [];
}
// 検索に入れる会社名：そのまま使う（"" でくくったり「株式会社」を外したりすると、Bing が「ネオ」だけで探すなど外れが増えた）
const qName = (s) => String(s || "").normalize("NFKC").trim();
export function freeSearchStats() { return { failed: _searchFail, used: { ..._used }, resting: Object.keys(_restUntil).filter((k) => Date.now() < _restUntil[k]) }; }

// ───── 会社名のそろえ方（gBizINFO の候補から同じ会社を選ぶため） ─────
const corpKey = (s) => String(s || "").normalize("NFKC").replace(/株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|社会福祉法人|医療法人(社団|財団)?|学校法人|\(株\)|\(有\)|㈱|㈲|[\s・.,、。]/g, "").toLowerCase();
async function gbizFor(name) {
  if (!gbizConfigured()) return null;
  const list = await searchCompanies(name, 10).catch(() => []);
  const k = corpKey(name);
  const live = list.filter((x) => x.status !== "閉鎖");
  const same = live.filter((x) => corpKey(x.name) === k);
  if (same.length !== 1) return null;   // 同じ名前が複数ある・無いときは使わない（別の会社の情報を出さない）
  return getCompanyDetail(same[0].corporate_number).catch(() => null);
}

// 公式サイトらしい検索結果を選ぶ（求人サイト・まとめサイトは外す）
const NOT_OFFICIAL = /(wikipedia|facebook|twitter|x\.com|instagram|linkedin|youtube|tiktok|note\.com|prtimes|indeed|en-gage|en-japan|mynavi|rikunabi|doda|baseconnect|houjin|alarmbox|salesnow|musubu|ycard|nikkei|itmedia|google\.|amazon\.|rakuten\.|wantedly|openwork|vorkers|jobtalk|kaisha-hyouban|en-hyouban|careerconnection|onecareer|unistyle|offerbox|airwork|engage|bizreach|green-japan|type\.jp|hellowork|stanby|kyujinbox|baitoru|townwork|mapion|navitime|itp\.ne\.jp|ekiten|jpnumber|tdb\.co\.jp|tsr-net|minkabu|kabutan|yahoo|goo\.ne|bing\.com|duckduckgo)/i;
function pickOfficial(results, name) {
  const k = corpKey(name);
  const cand = results.filter((r) => !NOT_OFFICIAL.test(r.url));
  return (cand.find((r) => k && corpKey(r.title).includes(k)) || null);
}

// 採用の載り先（検索結果の URL から）
const MEDIA = [
  [/job\.mynavi\.jp/, "マイナビ（新卒）"], [/tenshoku\.mynavi\.jp/, "マイナビ転職"], [/job\.rikunabi\.com/, "リクナビ（新卒）"], [/next\.rikunabi\.com/, "リクナビNEXT"],
  [/doda\.jp/, "doda"], [/indeed\.com/, "Indeed"], [/en-gage\.net/, "engage"], [/employment\.en-japan\.com/, "エン転職"], [/wantedly\.com/, "Wantedly"],
  [/airwork\.net|arwrk\.net/, "Airワーク"], [/offerbox\.jp/, "OfferBox"], [/onecareer\.jp/, "ONE CAREER"], [/careerticket\.jp/, "キャリアチケット"], [/bizreach\.jp/, "ビズリーチ"],
  [/green-japan\.com/, "Green"], [/type\.jp/, "type"], [/hellowork|kensaku\.hellowork/, "ハローワーク"], [/baitoru\.com/, "バイトル"], [/townwork\.net/, "タウンワーク"], [/kyujinbox\.com/, "求人ボックス"],
];
function mediaOf(results, name) {
  const k = corpKey(name); const out = [];
  for (const r of results) {
    if (k && !corpKey(`${r.title} ${r.desc}`).includes(k)) continue;   // 別の会社の求人を拾わない
    for (const [re, label] of MEDIA) if (re.test(r.url) && !out.includes(label)) out.push(label);
  }
  return out;
}
// 決まった言い回しで値を抜き出す（長さの上限つき）
//   トップページのメニュー（「採用支援 就労支援 会社概要 …」）を拾わないよう、コロンのあとの値だけ・空白で区切られた語の並びは使わない
function grab(text, labelRe, max = 60) {
  const m = String(text || "").match(new RegExp(`(?:${labelRe})\\s*[:：]\\s*([^。\\n]{2,${max}})`));
  if (!m) return "";
  const v = m[1].replace(/\s+/g, " ").trim().slice(0, max);
  return (v.match(/ /g) || []).length >= 3 || /…|\.\.\./.test(v) ? "" : v;
}
// サイトのトップを1回だけ読み、本文と「説明文」（meta description）を取る。説明文は会社が自分で書いた事業の一文なので、事業概要に使う
async function readSite(url) {
  try {
    const r = await withTimeout(url, { headers: { "user-agent": UA, "accept-language": "ja" } }, SITE_MS);
    if (!r.ok) return { text: "", desc: "" };
    const html = (await r.text()).slice(0, 600000);
    const d = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']{10,300})["']/i)
      || html.match(/<meta[^>]+content=["']([^"']{10,300})["'][^>]*(?:name|property)=["'](?:description|og:description)["']/i);
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 8000);
    return { text, desc: d ? unHtml(d[1]) : "" };
  } catch { return { text: "", desc: "" }; }
}
const SITE_MS = 6000;   // 会社のサイトを1ページ読むのを待つ時間
const HEADCOUNT_RE = /(?:採用予定人数|採用予定数|募集人数|採用人数)\s*[:：]?\s*([0-9０-９]{1,4}\s*(?:[～〜~\-－]\s*[0-9０-９]{1,4})?\s*名(?:程度|以上)?)/;

// ───── 今の募集かを確かめる（2026-11-23 福井さん「過去の掲載・過去の採用ではなく今の採用情報だけを出す」） ─────
//   判定は mcfresh.js（通信しない）。ここでは根拠（検索結果・求人ページ・公式サイトの文）を集めて当てる
// 新卒サイトの URL に入っている卒年（job.mynavi.jp/26/… は 26卒＝終わった募集のページ）
export function urlGradYear(url) {
  const u = String(url || "");
  const m = u.match(/job\.mynavi\.jp\/(\d\d)\//) || u.match(/job\.rikunabi\.com\/20(\d\d)\//) || u.match(/career-tasu\.jp\/20(\d\d)\//) || u.match(/gakujo\.ne\.jp\/(?:campus\/)?20(\d\d)\//);
  return m ? 2000 + +m[1] : 0;
}
// 検索結果1件が今の募集か（終わった印 → URL の卒年 → 文の日付・卒年 の順）
export function judgeResult(r, clock = recruitClock()) {
  const txt = `${r.title || ""} ${r.desc || ""}`;
  if (isClosed(txt)) return freshness(txt, clock);
  const g = urlGradYear(r.url);
  if (g) return g >= clock.gradMin ? { verdict: "current", why: `${g % 100}卒のページ`, byUrl: true } : { verdict: "past", why: `${g % 100}卒のページ（終わった募集）` };
  return freshness(txt, clock);
}
// 求人ページを1枚読む（中身の判定は jobPageVerdict。試験・精度調査で同じ判定を通信なしで回せるように分けている）
export async function fetchJobPage(url) {
  try {
    const r = await withTimeout(url, { headers: { "user-agent": UA, "accept-language": "ja" }, redirect: "follow" }, SITE_MS);
    const html = r.ok ? (await r.text()).slice(0, 600000) : "";
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 20000);
    return { url, status: r.status, finalUrl: String(r.url || url), text };
  } catch { return { url, status: 0, finalUrl: url, text: "" }; }
}
// 読んだ求人ページが今の募集か。会社名が載っていないページは根拠にしない。
//   newgrad：新卒の求人ページか（新卒のページは卒年でも決める。転職サイトはメニューの「マイナビ2028」などを拾わないよう日付だけ）
export function jobPageVerdict(pg, name, clock = recruitClock(), { newgrad = false } = {}) {
  const ck = corpKey(name); const url = String(pg.url || "");
  if (pg.status === 404 || pg.status === 410) return { verdict: "past", why: `求人ページが無い（${pg.status}）`, text: "" };
  if (!pg.status) return { verdict: "unknown", why: "求人ページを読めない（時間切れ）", text: "" };
  if (pg.status < 200 || pg.status >= 300) return { verdict: "unknown", why: `求人ページを読めない（${pg.status}）`, text: "" };
  const fin = String(pg.finalUrl || url);
  if (fin.split("#")[0] !== url.split("#")[0]) {
    let p = "/"; try { p = new URL(fin).pathname; } catch {}
    if (p === "/" || /search|list|error|notfound|not_found|expired|closed|finish/i.test(fin.replace(url, ""))) return { verdict: "past", why: "求人ページが別のページに飛ばされた（掲載が終わった）", text: "" };
  }
  const text = String(pg.text || "");
  if (ck && !corpKey(text.slice(0, 10000)).includes(ck)) return { verdict: "unknown", why: "求人ページに会社名が無い", text: "" };
  const f = freshness(text, clock, { scope: "page", newgrad });
  return { ...f, text: f.verdict === "current" ? text : "" };
}
// 長い文（公式サイトの本文）から、言葉の前後だけを切り出して、今の募集と言える部分だけを返す
export function freshChunks(text, re, clock = recruitClock()) {
  const t = String(text || "").normalize("NFKC"); const out = [];
  for (const m of t.matchAll(new RegExp(re.source, "g"))) {
    const c = t.slice(Math.max(0, m.index - 60), m.index + m[0].length + 60);
    if (freshness(c, clock).verdict === "current") out.push(c);
    if (out.length >= 4) break;
  }
  return out;
}
const NEWGRAD_MEDIA = /新卒|OfferBox|ONE CAREER|キャリアチケット/;
const MID_MEDIA = /転職|doda|NEXT|engage|Indeed|Airワーク|ビズリーチ|Green|type|エン転職|ハローワーク|バイトル|タウンワーク|求人ボックス/;

// 集めた根拠（検索結果・公式サイトの本文・読んだ求人ページ）から、採用の項目を確かめて組み立てる（通信しない。試験から直接呼べる）
//   pageOf(url, {newgrad})：求人ページを読んで jobPageVerdict の答えを返す関数（本番は fetchJobPage＋jobPageVerdict。試験・精度調査では保存したページで答える）
export async function recruitFacts({ name, results = [], siteText = "", site = "", employees = "", clock = recruitClock(), pageOf = null }) {
  const ck = corpKey(name);
  const mine = results.filter((r) => ck && corpKey(`${r.title} ${r.desc}`).includes(ck)).map((r) => ({ ...r, f: judgeResult(r, clock) }));
  const snippets = mine.map((r) => `${r.title} ${r.desc}`).join("\n");
  const text = String(siteText || "");
  const dropped = [];
  const drop = (field, value, why, url = "") => { if (value && dropped.length < 12) dropped.push({ field, value: String(value).slice(0, 60), why, url: url || "" }); };

  // ① 求人媒体：載り先ごとに、今の募集と言える検索結果があれば残す。決め手が無ければ求人ページを読んで確かめる（1社4枚まで）
  const byLabel = new Map();
  for (const r of mine) for (const [re, label] of MEDIA) if (re.test(r.url)) { if (!byLabel.has(label)) byLabel.set(label, []); byLabel.get(label).push(r); }
  let pages = 4; const media = []; const mediaCheck = []; const pageTexts = [];
  await Promise.all([...byLabel].map(async ([label, rs]) => {
    const newgrad = NEWGRAD_MEDIA.test(label);
    // 検索結果の文に今の募集の印（日付・卒年）があればそれで決める。URL の卒年だけで今と言えるもの（マイナビ 27卒のページなど）は、
    //   その卒年の受付をもう終えている会社もあるので、読めればページの「終わった印」も見る（読めなければ URL の卒年を信じる）
    const hit = rs.find((r) => r.f.verdict === "current" && !r.f.byUrl) || rs.find((r) => r.f.verdict === "current");
    let res = null;
    if (hit && hit.f.byUrl && pageOf && pages > 0) {
      pages--; const p = await pageOf(hit.url, { newgrad });
      res = p.verdict === "past" ? { verdict: "past", why: p.why, url: hit.url, by: "求人ページ" } : { verdict: "current", why: hit.f.why, url: hit.url, by: "検索結果" };
      if (p.text) pageTexts.push(p.text);
    } else if (hit) res = { verdict: "current", why: hit.f.why, url: hit.url, by: "検索結果" };
    if (!res) {
      const u = rs.find((r) => r.f.verdict === "unknown");
      if (u && pageOf && pages > 0) { pages--; const p = await pageOf(u.url, { newgrad }); res = { verdict: p.verdict, why: p.why, url: u.url, by: "求人ページ" }; if (p.text) pageTexts.push(p.text); }
      else { const r0 = rs.find((r) => r.f.verdict === "past") || rs[0]; res = { verdict: r0.f.verdict, why: r0.f.why, url: r0.url, by: "検索結果" }; }
    }
    mediaCheck.push({ label, ...res });
    if (res.verdict === "current") media.push(label); else drop("media", label, res.why, res.url);
  }));
  const order = (l) => MEDIA.findIndex(([, x]) => x === l);
  media.sort((a, b) => order(a) - order(b)); mediaCheck.sort((a, b) => order(a.label) - order(b.label));

  // 今の募集と言える文（検索結果・確かめた求人ページ・公式サイトの該当部分）。職種・人数はここからだけ取る
  const freshSnips = mine.filter((r) => r.f.verdict === "current").map((r) => `${r.title} ${r.desc}`);
  const siteFresh = freshChunks(text, /募集|採用|エントリー|卒/, clock);
  const freshText = [...freshSnips, ...pageTexts, ...siteFresh].join("\n");

  // ② 採用の実態：新卒・中途それぞれ、今の募集の根拠があるときだけ
  const nowGrad = (s) => gradYears(s).some((y) => y >= clock.gradMin && y <= clock.gradMax);
  const newGrad = media.some((m) => NEWGRAD_MEDIA.test(m)) || freshSnips.some((s) => /新卒|卒|インターン|エントリー/.test(s) && nowGrad(s)) || siteFresh.some(nowGrad);
  const midRe = /中途|キャリア採用|経験者採用|転職/;
  const midCareer = media.some((m) => MID_MEDIA.test(m)) || freshSnips.some((s) => midRe.test(s)) || freshChunks(text, midRe, clock).length > 0;
  const whyOf = (re) => { const r = mine.find((x) => re.test(`${x.title} ${x.desc}`)); return r ? [r.f.verdict === "unknown" ? "今の募集と確かめられない（日付・卒年が無い）" : r.f.why, r.url] : ["今の募集と確かめられない", ""]; };
  if (!newGrad && /新卒|\d\d卒|インターン/.test(snippets)) drop("hiring", "新卒採用の情報", ...whyOf(/新卒|\d\d卒|インターン/));
  if (!midCareer && midRe.test(snippets)) drop("hiring", "中途採用の情報", ...whyOf(midRe));
  const hiring = [newGrad ? "新卒採用の情報あり" : "", midCareer ? "中途採用の情報あり" : ""].filter(Boolean).join("・");

  // ③ 採用人数：値の前後に「実績」「前年」や過去の卒年が無く、今の募集と言えるものだけ
  let headcount = "";
  const hcSources = [...mine.map((r) => ({ t: `${r.title} ${r.desc}`, cur: r.f.verdict === "current", url: r.url })), ...pageTexts.map((t) => ({ t, cur: true, url: "" })), { t: text, cur: false, url: site }];
  for (const s of hcSources) {
    const t = String(s.t || "").normalize("NFKC");
    for (const m of t.matchAll(new RegExp(HEADCOUNT_RE.source, "g"))) {
      const v = m[1].replace(/\s+/g, "");
      const f = valueFreshness(t, m.index, m[0].length, { clock, pageCurrent: s.cur });
      if (f.verdict === "current") { if (!headcount) headcount = v; }
      else if (v !== headcount) drop("headcount", v, f.verdict === "unknown" ? "今の募集の人数と確かめられない" : f.why, s.url);
    }
  }
  // ④ 募集職種：今の募集と言える文からだけ
  //   求人ページの本文は改行が無く「介護職 採用予定人数：5名 …」と次の項目まで続くので、次の「見出し：」の手前で切る
  const cutNext = (v) => String(v || "").replace(/\s*[^\s:：]{2,12}\s*[:：].*$/, "").trim();
  const roles = cutNext(grab(freshText, "募集職種|募集中の職種|職種", 50));
  const rolesAny = cutNext(grab(`${text}\n${snippets}`, "募集職種|募集中の職種|職種", 50));
  if (rolesAny && rolesAny !== roles) drop("roles", rolesAny, "今の募集と言える文の中に無い");

  // 推定採用課題・話の切り口：確かめた事実からだけ組み立てる（根拠が無ければ空）
  const empN = parseInt(String(employees).replace(/[^\d]/g, ""), 10) || 0;
  const issue = media.length >= 3 ? `複数の媒体（${media.slice(0, 3).join("・")}）に載せており、応募の管理が分散しているかもしれない（推定）`
    : (newGrad && empN && empN < 300) ? "中小規模で新卒採用をしており、母集団づくりや選考の手間に課題があるかもしれない（推定）" : "";
  const hook = media.length ? `${media[0]}で募集を拝見してお電話しました`
    : newGrad ? "新卒採用のご状況について伺いたくお電話しました" : midCareer ? "中途採用のご状況について伺いたくお電話しました" : "";
  return { hiring, roles, headcount, media: media.join("・"), issue, hook, mediaCheck, dropped, snippets, mediaUrls: mediaCheck.filter((c) => c.verdict === "current").map((c) => c.url) };
}

// ───── 本体：researchMcLead と同じ形で返す ─────
//   採用の項目（hiring・roles・headcount・media と、そこから組み立てる issue・hook）は、今の募集と確かめた根拠があるものだけを入れる。
//   出さなかった候補とその理由は check.dropped に残す（精度の調べ直しと、「なぜ出ないか」の説明に使う）
export async function researchMcLeadFree({ company = "", website = "", siteText = "", hint = "", now = null } = {}) {
  const name = String(company || "").trim();
  if (!name) return { status: "error", error: "会社名がありません" };
  const at = now ? new Date(now) : new Date();
  const clock = recruitClock(at);
  const sources = [];
  // gBizINFO と Web 検索は同時に始める（順番に待つと1社あたり数秒のむだ）
  const [g, rCorp, rHire] = await Promise.all([gbizFor(name).catch(() => null), freeWebSearch(`${qName(name)} 会社概要`, 8), freeWebSearch(`${qName(name)} 採用 募集`, 10)]);
  if (g && g.corporate_number) sources.push(`https://info.gbiz.go.jp/hojin/ichiran?hojinBango=${g.corporate_number}`);

  // 公式サイト：元データ → gBizINFO → 検索
  let site = String(website || "") || (g && g.company_url) || "";
  if (!site) { const off = pickOfficial(rCorp, name); if (off) site = off.url.replace(/^(https?:\/\/[^/]+).*$/, "$1"); }
  if (site && !/^https?:\/\//.test(site)) site = `https://${site}`;
  let text = String(siteText || ""), siteDesc = "";
  if (site) { const r = await readSite(site); if (!text) text = r.text; siteDesc = r.desc; }
  if (site) sources.push(site);

  // 従業員数：gBizINFO → トップ本文 → 検索の説明文（その会社の名前が出ている結果だけ） → 会社概要らしいページを読む（いちばん重いので最後。どれも AI なし）
  const ck = corpKey(name);
  const snippets = [...rCorp, ...rHire].filter((r) => ck && corpKey(`${r.title} ${r.desc}`).includes(ck)).map((r) => `${r.title} ${r.desc}`).join("\n");
  const employees = (g && g.employees) || extractEmployeesRegex(text) || extractEmployeesRegex(snippets) || (site ? await employeesFromSite(name, site, { max: 6, ms: SITE_MS }).catch(() => "") : "");
  const biz = String((g && g.business) || grab(text, "事業内容|事業概要|業務内容", 60) || siteDesc || (g && g.industry) || "").slice(0, 80);

  const R = await recruitFacts({ name, results: [...rCorp, ...rHire], siteText: text, site, employees, clock, pageOf: async (u, o) => jobPageVerdict(await fetchJobPage(u), name, clock, o) });
  for (const u of R.mediaUrls) if (sources.length < 5 && !sources.includes(u)) sources.push(u);
  const confirm = [!R.hiring && "採用の予定（新卒・中途）", !R.headcount && "採用人数", !R.media && "使っている求人媒体", "採用のご担当者"].filter(Boolean).join("・");

  const out = { biz, employees, location: (g && g.location) || "", founded: (g && g.founded) || "", hiring: R.hiring, roles: R.roles, headcount: R.headcount,
    media: R.media, issue: R.issue, hook: R.hook, confirm, sources: [...new Set(sources)].slice(0, 5), how: "free",
    check: { v: CHECK_V, at: at.toISOString(), gradMin: clock.gradMin, media: R.mediaCheck.slice(0, 8), dropped: R.dropped } };
  const filled = ["biz", "employees", "hiring", "roles", "headcount", "media"].filter((k) => out[k]).length;
  return { status: filled ? "ok" : "thin", web: rCorp.length + rHire.length > 0, gbiz: !!g, ...out };
}

// ───── マイナビの掲載（lookupMynavi と同じ形で返す。AI は使わない） ─────
export async function lookupMynaviFree(companyName) {
  const name = String(companyName || "").trim();
  if (!name) return { status: "none" };
  const k = corpKey(name);
  // 「会社名 マイナビ」で探す（「site:」で絞ると Bing の結果が外れやすかった）。見つからなければ「site:」でも探す
  const isHit = (r) => /^https?:\/\/job\.mynavi\.jp\//.test(r.url) && corpKey(r.title).includes(k);
  let res = await freeWebSearch(`${qName(name)} マイナビ 新卒`, 10);
  if (!res.some(isHit)) res = [...res, ...(await freeWebSearch(`site:job.mynavi.jp ${qName(name)}`, 8))];
  const hits = res.filter((r) => /^https?:\/\/job\.mynavi\.jp\//.test(r.url) && corpKey(r.title).includes(k));
  if (!hits.length) return { status: res.length ? "notfound" : "error", error: res.length ? undefined : "Web 検索が使えませんでした（時間をおいて調べ直します）", checkedAt: new Date().toISOString() };
  const page = (hits.find((h) => /\/corp\d+\/outline/.test(h.url)) || hits.find((h) => /\/corp\d+/.test(h.url)) || hits[0]).url;
  const text = String(await fetchPageText(page).catch(() => "") || "");
  if (text && k && !corpKey(text.slice(0, 3000)).includes(k)) return { status: "notfound", checkedAt: new Date().toISOString(), note: "マイナビで見つかったのは別の会社のページでした" };
  const years = [...new Set([...(page.match(/\/(20\d\d)\//g) || []).map((y) => y.replace(/\//g, "")), ...((`${hits[0].title} ${text.slice(0, 2000)}`).match(/マイナビ\s*(20\d\d)/g) || []).map((y) => y.replace(/\D/g, ""))])].slice(0, 3);
  const hc = text.match(HEADCOUNT_RE);
  const jobs = grab(text, "募集職種", 80).split(/[、,／/・]/).map((x) => x.trim()).filter(Boolean).slice(0, 5);
  const pre = text.match(/プレエントリー候補リスト登録人数\s*[:：]?\s*([0-9０-９,，]+\s*名)/);
  return { status: "listed", url: page, years, jobs, plannedHires: hc ? hc[1].normalize("NFKC").replace(/\s+/g, "") : "", area: grab(text, "勤務地", 40),
    preEntry: pre ? pre[1].normalize("NFKC") : "", industry: grab(text, "業種", 30), note: "", checkedAt: new Date().toISOString() };
}
