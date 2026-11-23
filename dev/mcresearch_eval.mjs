// 企業調査の「今の採用情報」の精度調査（2026-11-23 福井さん「過去掲載・過去採用ではなく今の採用情報を適切に抽出できているか」）
//   1) 集める：node dev/mcresearch_eval.mjs fetch 会社一覧.txt 材料.json
//      本物の Web 検索・公式サイト・求人ページを読み、そのまま保存する（1行に「会社名<TAB>サイト」）。AI・有料の API は使わない
//   2) 判定：node dev/mcresearch_eval.mjs judge 材料.json [正解.json]
//      保存した材料で、旧方式（候補をすべて出す）と新方式（今の募集と確かめたものだけ出す）を通信なしで比べる。
//      正解（{"会社名|項目|値": "current" | "past" | "unknown"}：求人ページを人や別の確かめ役が読んで付けたもの）があれば、
//      出した情報のうち本当に今の募集だった割合（適合率）と、今の募集を出せた割合（再現率）を出す
import fs from "node:fs";
import { freeWebSearch, fetchJobPage, jobPageVerdict, recruitFacts } from "../server/mcresearch.js";
import { recruitClock } from "../server/mcfresh.js";

const [, , mode, a, b] = process.argv;
const MEDIA_URL = /job\.mynavi\.jp|tenshoku\.mynavi\.jp|job\.rikunabi\.com|next\.rikunabi\.com|doda\.jp|indeed\.com|en-gage\.net|employment\.en-japan\.com|wantedly\.com|airwork\.net|arwrk\.net|offerbox\.jp|onecareer\.jp|careerticket\.jp|bizreach\.jp|green-japan\.com|type\.jp|hellowork|baitoru\.com|townwork\.net|kyujinbox\.com/;
const key = (s) => String(s || "").normalize("NFKC").replace(/株式会社|有限会社|社会福祉法人|[\s・]/g, "").toLowerCase();

if (mode === "fetch") {
  const rows = fs.readFileSync(a, "utf8").split(/\r?\n/).map((l) => l.split("\t")).filter((x) => x[0] && x[0].trim());
  const out = fs.existsSync(b) ? JSON.parse(fs.readFileSync(b, "utf8")) : {};
  for (const [company0, website = ""] of rows) {
    const company = company0.trim();
    if (out[company] && out[company].results.length) { console.log(`${company}：保存ずみ`); continue; }
    const results = [...(await freeWebSearch(`${company} 会社概要`, 8)), ...(await freeWebSearch(`${company} 採用 募集`, 10))];
    // 検索先に止められて、会社名と関係のない結果（「株式会社とは」など）しか返らないときは保存しない（あとで集め直す）
    if (!results.some((r) => key(`${r.title} ${r.desc}`).includes(key(company)))) { console.log(`${company}：検索が使えない（あとで集め直す）`); continue; }
    const site = website.trim() ? await fetchJobPage(website.trim()) : { text: "" };
    const pages = {};
    for (const r of results) if (MEDIA_URL.test(r.url) && key(`${r.title} ${r.desc}`).includes(key(company)) && !pages[r.url]) pages[r.url] = await fetchJobPage(r.url);
    out[company] = { company, website: website.trim(), at: new Date().toISOString(), results, siteText: site.text || "", pages };
    fs.writeFileSync(b, JSON.stringify(out));
    console.log(`${company}：検索 ${results.length}件・求人ページ ${Object.keys(pages).length}枚`);
  }
} else if (mode === "judge") {
  const data = JSON.parse(fs.readFileSync(a, "utf8"));
  const truth = b && fs.existsSync(b) ? JSON.parse(fs.readFileSync(b, "utf8")) : null;
  const rows = [];
  for (const d of Object.values(data)) {
    const clock = recruitClock(new Date(d.at));
    const R = await recruitFacts({ name: d.company, results: d.results, siteText: d.siteText, site: d.website, clock,
      pageOf: async (u, o) => jobPageVerdict(d.pages[u] || { url: u, status: 0 }, d.company, clock, o) });
    for (const m of R.mediaCheck) rows.push({ company: d.company, field: "media", value: m.label, url: m.url, shown: m.verdict === "current", why: m.why });
    // 旧方式の採用の実態：検索結果に「新卒」「中途」の言葉があれば出していた
    const sn = d.results.filter((r) => key(`${r.title} ${r.desc}`).includes(key(d.company))).map((r) => `${r.title} ${r.desc}`).join("\n");
    const oldMedia = R.mediaCheck.map((m) => m.label);
    const oldNew = /新卒|新卒採用|27卒|28卒|2027年卒|2028年卒|インターン/.test(sn) || oldMedia.some((m) => /新卒|OfferBox|ONE CAREER|キャリアチケット/.test(m));
    const oldMid = /中途|キャリア採用|転職/.test(sn) || oldMedia.some((m) => /転職|doda|NEXT|engage|Indeed|Airワーク|ビズリーチ|Green|type|エン転職|ハローワーク/.test(m));
    for (const [v, old] of [["新卒採用の情報", oldNew], ["中途採用の情報", oldMid]]) if (old) rows.push({ company: d.company, field: "hiring", value: v, shown: R.hiring.includes(v.slice(0, 4)), why: (R.dropped.find((x) => x.value === v) || {}).why || "" });
    if (R.headcount) rows.push({ company: d.company, field: "headcount", value: R.headcount, shown: true });
    for (const x of R.dropped.filter((x) => x.field === "headcount" || x.field === "roles")) rows.push({ company: d.company, field: x.field, value: x.value, url: x.url, shown: false, why: x.why });
    if (R.roles) rows.push({ company: d.company, field: "roles", value: R.roles, shown: true });
  }
  if (process.env.EVAL_ROWS) fs.writeFileSync(process.env.EVAL_ROWS, JSON.stringify(rows, null, 1));   // 正解を付けてもらう一覧に使う
  const pad = (s, n) => String(s).padEnd(n);
  for (const r of rows) {
    const t = truth && truth[`${r.company}|${r.field}|${r.value}`];
    console.log(`${r.shown ? "出す" : "外す"} ${pad(r.field, 9)} ${pad(r.value, 14)} ${t ? `[正解:${t}] ` : ""}${r.why || ""}  ${r.company}`);
  }
  const old = rows, neu = rows.filter((r) => r.shown);
  console.log(`\n候補 ${old.length}件（旧方式はすべて出していた）／新方式で出す ${neu.length}件`);
  if (truth) {
    const T = (r) => truth[`${r.company}|${r.field}|${r.value}`];
    const judged = rows.filter((r) => T(r) === "current" || T(r) === "past");
    const prec = (xs) => { const j = xs.filter((r) => T(r) === "current" || T(r) === "past"); return j.length ? `${j.filter((r) => T(r) === "current").length}/${j.length}（${Math.round(100 * j.filter((r) => T(r) === "current").length / j.length)}%）` : "—"; };
    const cur = judged.filter((r) => T(r) === "current");
    console.log(`適合率（出した情報のうち本当に今の募集）：旧方式 ${prec(old)} → 新方式 ${prec(neu)}`);
    console.log(`再現率（今の募集のうち出せた）：新方式 ${cur.filter((r) => r.shown).length}/${cur.length}`);
    const bad = neu.filter((r) => T(r) === "past");
    if (bad.length) console.log(`新方式で出したが過去だったもの：\n${bad.map((r) => `  ${r.company} ${r.field} ${r.value} ${r.url || ""}`).join("\n")}`);
    if (b && process.env.EVAL_STRICT === "1" && bad.length) process.exit(1);
  }
} else {
  console.error("使い方：node dev/mcresearch_eval.mjs fetch 会社一覧.txt 材料.json ／ judge 材料.json [正解.json]");
  process.exit(1);
}
