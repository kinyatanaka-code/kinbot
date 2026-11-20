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

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
function withTimeout(url, opts = {}, ms = 12000) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opts, signal: c.signal }).finally(() => clearTimeout(t));
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
    const r = await withTimeout(url, { headers: { "user-agent": UA, "accept-language": "ja" } }, 12000);
    if (!r.ok) return { text: "", desc: "" };
    const html = (await r.text()).slice(0, 600000);
    const d = html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]*content=["']([^"']{10,300})["']/i)
      || html.match(/<meta[^>]+content=["']([^"']{10,300})["'][^>]*(?:name|property)=["'](?:description|og:description)["']/i);
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 8000);
    return { text, desc: d ? unHtml(d[1]) : "" };
  } catch { return { text: "", desc: "" }; }
}
const HEADCOUNT_RE = /(?:採用予定人数|採用予定数|募集人数|採用人数)\s*[:：]?\s*([0-9０-９]{1,4}\s*(?:[～〜~\-－]\s*[0-9０-９]{1,4})?\s*名(?:程度|以上)?)/;

// ───── 本体：researchMcLead と同じ形で返す ─────
export async function researchMcLeadFree({ company = "", website = "", siteText = "", hint = "" } = {}) {
  const name = String(company || "").trim();
  if (!name) return { status: "error", error: "会社名がありません" };
  const sources = [];
  const g = await gbizFor(name).catch(() => null);
  if (g && g.corporate_number) sources.push(`https://info.gbiz.go.jp/hojin/ichiran?hojinBango=${g.corporate_number}`);

  // 公式サイト：元データ → gBizINFO → 検索
  const [rCorp, rHire] = await Promise.all([freeWebSearch(`${qName(name)} 会社概要`, 8), freeWebSearch(`${qName(name)} 採用 募集`, 10)]);
  let site = String(website || "") || (g && g.company_url) || "";
  if (!site) { const off = pickOfficial(rCorp, name); if (off) site = off.url.replace(/^(https?:\/\/[^/]+).*$/, "$1"); }
  if (site && !/^https?:\/\//.test(site)) site = `https://${site}`;
  let text = String(siteText || ""), siteDesc = "";
  if (site) { const r = await readSite(site); if (!text) text = r.text; siteDesc = r.desc; }
  if (site) sources.push(site);

  // 検索の説明文は、その会社の名前が出ている結果だけを使う（名前の似た別の会社の従業員数・職種を拾わない）
  const ck = corpKey(name);
  const mine = [...rCorp, ...rHire].filter((r) => ck && corpKey(`${r.title} ${r.desc}`).includes(ck));
  const snippets = mine.map((r) => `${r.title} ${r.desc}`).join("\n");
  const both = `${text}\n${snippets}`;
  const media = mediaOf([...rCorp, ...rHire], name);
  for (const r of rHire) if (media.length && MEDIA.some(([re]) => re.test(r.url)) && sources.length < 5 && !sources.includes(r.url)) sources.push(r.url);

  // 従業員数：gBizINFO → トップ本文 → 会社概要らしいページを順に読む（どれも AI なし） → 検索の説明文
  const employees = (g && g.employees) || extractEmployeesRegex(text) || (site ? await employeesFromSite(name, site).catch(() => "") : "") || extractEmployeesRegex(snippets);
  const hc = both.match(HEADCOUNT_RE);
  const headcount = hc ? hc[1].normalize("NFKC").replace(/\s+/g, "") : "";
  const roles = grab(both, "募集職種|募集中の職種|職種", 50);
  const newGrad = /新卒|新卒採用|27卒|28卒|2027年卒|2028年卒|インターン/.test(snippets) || media.some((m) => /新卒|OfferBox|ONE CAREER|キャリアチケット/.test(m));
  const midCareer = /中途|キャリア採用|転職/.test(snippets) || media.some((m) => /転職|doda|NEXT|engage|Indeed|Airワーク|ビズリーチ|Green|type|エン転職|ハローワーク/.test(m));
  const hiring = [newGrad ? "新卒採用の情報あり" : "", midCareer ? "中途採用の情報あり" : ""].filter(Boolean).join("・");
  const biz = String((g && g.business) || grab(text, "事業内容|事業概要|業務内容", 60) || siteDesc || (g && g.industry) || "").slice(0, 80);

  // 推定採用課題・話の切り口・確かめたいこと：見つかった事実からだけ組み立てる（根拠が無ければ空）
  const empN = parseInt(String(employees).replace(/[^\d]/g, ""), 10) || 0;
  const issue = media.length >= 3 ? `複数の媒体（${media.slice(0, 3).join("・")}）に載せており、応募の管理が分散しているかもしれない（推定）`
    : (newGrad && empN && empN < 300) ? "中小規模で新卒採用をしており、母集団づくりや選考の手間に課題があるかもしれない（推定）" : "";
  const hook = media.length ? `${media[0]}で募集を拝見してお電話しました`
    : newGrad ? "新卒採用のご状況について伺いたくお電話しました" : midCareer ? "中途採用のご状況について伺いたくお電話しました" : "";
  const confirm = [!hiring && "採用の予定（新卒・中途）", !headcount && "採用人数", !media.length && "使っている求人媒体", "採用のご担当者"].filter(Boolean).join("・");

  const out = { biz, employees, location: (g && g.location) || "", founded: (g && g.founded) || "", hiring, roles, headcount,
    media: media.join("・"), issue, hook, confirm, sources: [...new Set(sources)].slice(0, 5), how: "free" };
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
