// 企業調査の「今の採用情報だけを出す」の確かめ（server/mcfresh.js・server/mcresearch.js・画面の researchHtml）。使い方：node dev/mcresearch_check.mjs
//   2026-11-23 福井さん「過去掲載情報や過去採用情報ではなく今の採用情報を適切に抽出できているか」「テストを通った情報しか表示されないように」
//   通信はしない。例の文は 2026-11-23 の精度調査（dev/mcresearch_eval.mjs）で実際に出てきた検索結果・求人ページの言い回しから取った
import assert from "node:assert/strict";
import fs from "node:fs";
import { recruitClock, gradYears, freshness, valueFreshness, showableResearch, isClosed, CHECK_V, RECRUIT_KEYS, STALE_DAYS } from "../server/mcfresh.js";
import { urlGradYear, judgeResult, jobPageVerdict, recruitFacts } from "../server/mcresearch.js";

let n = 0; const t = async (name, fn) => { await fn(); n++; console.log(`ok  ${name}`); };
const NOW = new Date("2026-11-23T03:00:00Z");
const C = recruitClock(NOW);
const V = (s, o) => freshness(s, C, o).verdict;

await t("今の年度と卒年：2026年11月は 27卒〜29卒が今の募集、4月で切り替わる", () => {
  assert.deepEqual([C.fy, C.gradMin, C.gradMax], [2026, 2027, 2029]);
  assert.equal(recruitClock(new Date("2027-03-31T03:00:00Z")).gradMin, 2027);
  assert.equal(recruitClock(new Date("2027-04-01T03:00:00Z")).gradMin, 2028);
});
await t("卒年の読み取り：27卒・2028年卒・マイナビ2027・2028年4月入社・28年度新卒", () => {
  assert.deepEqual(gradYears("27卒 新卒採用"), [2027]);
  assert.deepEqual(gradYears("2028年3月卒業予定の方"), [2028]);
  assert.deepEqual(gradYears("マイナビ2027 株式会社かめや"), [2027]);
  assert.deepEqual(gradYears("2028年4月入社"), [2028]);
  assert.deepEqual(gradYears("28年度新卒"), [2028]);
  assert.deepEqual(gradYears("卒業生の声 125卒"), []);
});
await t("今の募集と言える文", () => {
  assert.equal(V("株式会社かめや 2028卒 新卒採用 エントリー受付中"), "current");
  assert.equal(V("2026/10/02 · 営業職を募集しています"), "current");          // 検索結果の頭の日付
  assert.equal(V("掲載期間 2026/11/10～2026/12/07 施工管理"), "current");
  assert.equal(V("募集締切：2026年12月10日 介護職"), "current");               // 締切の日付は「これから」の話
  assert.equal(V("2026年度 中途採用 募集要項"), "current");
});
await t("終わった・過去の文（出してはいけない）", () => {
  assert.equal(V("【掲載終了】 ルート営業 株式会社砂子組"), "past");
  assert.equal(V("この求人の掲載は終了しています"), "past");
  assert.equal(V("広島ガスプロパン株式会社 現在募集を行っていません"), "past");
  assert.equal(V("エントリー受付を終了しました"), "past");
  assert.equal(V("株式会社かめや 2025卒 新卒採用情報"), "past");
  assert.equal(V("2024年度採用 募集要項"), "past");
  assert.equal(V("更新日：2023年4月1日 求人情報"), "past");
  assert.equal(V("新卒採用 採用実績 東京大学ほか"), "past");
});
await t("「終わった」と取り違えない言い回し（精度調査で見つかった誤り）", () => {
  assert.equal(isClosed("掲載終了予定日：2026/12/07"), false);
  assert.equal(isClosed("応募多数の場合は、募集を締め切ることがあります"), false);
  assert.equal(isClosed("募集締切：2026年12月10日"), false);
  assert.equal(V("設立 1999年4月 従業員75名"), "unknown");                   // 設立の日付は掲載日ではない
  assert.equal(V("株式会社つばさ福祉サービス 支援員の求人"), "unknown");         // 日付も卒年も無い → 出さない側
});
await t("求人ページ全体は「終わった印」と「掲載・更新の日付」だけで決める（前年度の実績やメニューの卒年に引っぱられない）", () => {
  assert.equal(V("前年度の採用実績 15名 / 2023年度入社 … 更新日：2026年11月1日 営業職", { scope: "page" }), "current");
  assert.equal(V("マイナビ2028 新卒向けはこちら 中途採用 営業職", { scope: "page", newgrad: false }), "unknown");
  assert.equal(V("リクナビ2028 株式会社スズカ未来 会社概要", { scope: "page", newgrad: true }), "current");
  assert.equal(V("掲載期間 2023/05/01～2023/06/30 施工管理", { scope: "page" }), "past");
});
await t("採用人数：値の前後で判定する（実績・前年度・過去の卒年の人数は使わない）", () => {
  const f = (s, o) => { const i = s.indexOf("採用"); return valueFreshness(s, i, 10, { clock: C, ...o }).verdict; };
  assert.equal(f("27卒 採用予定人数：10名"), "current");
  assert.equal(f("2023年度 採用人数：15名"), "past");
  assert.equal(f("採用実績 採用人数：15名"), "past");
  assert.equal(f("採用人数：15名"), "unknown");
  assert.equal(f("採用人数：15名", { pageCurrent: true }), "current");
});
await t("新卒サイトの URL の卒年：26卒のページは過去、28卒は今（ただしページも確かめる印が付く）", () => {
  assert.equal(urlGradYear("https://job.mynavi.jp/26/pc/search/corp1/outline.html"), 2026);
  assert.equal(urlGradYear("https://job.rikunabi.com/2028/company/r123/"), 2028);
  assert.equal(judgeResult({ url: "https://job.mynavi.jp/26/pc/search/corp1/outline.html", title: "かめや", desc: "" }, C).verdict, "past");
  const j = judgeResult({ url: "https://job.mynavi.jp/28/pc/search/corp1/outline.html", title: "かめや", desc: "" }, C);
  assert.equal(j.verdict, "current"); assert.equal(j.byUrl, true);
  assert.equal(judgeResult({ url: "https://job.mynavi.jp/28/pc/search/corp1/outline.html", title: "かめや", desc: "エントリー受付を終了しました" }, C).verdict, "past");
});
await t("求人ページ：無い・トップに飛ばされた・会社名が無い・読めない", () => {
  const u = "https://doda.jp/DodaFront/View/CompanyJobs/j_id__1/";
  assert.equal(jobPageVerdict({ url: u, status: 404 }, "株式会社イナハラ", C).verdict, "past");
  assert.equal(jobPageVerdict({ url: u, status: 200, finalUrl: "https://doda.jp/", text: "doda" }, "株式会社イナハラ", C).verdict, "past");
  assert.equal(jobPageVerdict({ url: u, status: 200, finalUrl: u, text: "別の会社 更新日：2026年11月1日" }, "株式会社イナハラ", C).verdict, "unknown");
  assert.equal(jobPageVerdict({ url: u, status: 403 }, "株式会社イナハラ", C).verdict, "unknown");
  assert.equal(jobPageVerdict({ url: u, status: 200, finalUrl: u, text: "株式会社イナハラ 営業 更新日：2026年11月1日" }, "株式会社イナハラ", C).verdict, "current");
});

// 画面の例（株式会社つばさ福祉サービス）と同じ形：日付の無い検索結果・終わったハローワーク・過去の年度の人数 → 採用の項目は何も出さない
const tsubasa = {
  name: "株式会社つばさ福祉サービス", clock: C, employees: "75名",
  results: [
    { url: "https://next.rikunabi.com/viewjob/jk1/", title: "株式会社つばさ福祉サービス 支援員", desc: "障がい者グループホームの生活支援員を募集" },
    { url: "https://www.hellowork.mhlw.go.jp/kensaku/GECA110010.do?x=1", title: "株式会社つばさ福祉サービス 生活支援員", desc: "この求人は募集を終了しました" },
    { url: "https://jp.indeed.com/viewjob?jk=1", title: "株式会社つばさ福祉サービス の求人", desc: "支援員 正社員 中途" },
  ],
  siteText: "障がい者のグループホームを運営しています。2023年度 採用人数：15名 募集職種：支援員",
  pageOf: async (u) => ({ verdict: "unknown", why: "求人ページを読めない（403）", text: "" }),
};
await t("つばさ福祉サービスの例：確かめられない採用の情報は出さず、外した理由を残す", async () => {
  const R = await recruitFacts(tsubasa);
  assert.equal(R.media, ""); assert.equal(R.headcount, ""); assert.equal(R.roles, ""); assert.equal(R.hook, ""); assert.equal(R.issue, "");
  assert.equal(R.hiring, "");
  assert.ok(R.dropped.some((d) => d.field === "media" && d.value === "ハローワーク" && /終了/.test(d.why)));
  assert.ok(R.dropped.some((d) => d.field === "headcount" && d.value === "15名"));
});
await t("今の募集が確かめられた媒体だけを出し、切り口もそこから作る", async () => {
  const R = await recruitFacts({
    name: "株式会社スズカ未来", clock: C, employees: "120名",
    results: [
      { url: "https://job.mynavi.jp/28/pc/search/corp61799/outline.html", title: "株式会社スズカ未来 マイナビ2028", desc: "" },
      { url: "https://job.mynavi.jp/26/pc/search/corp61799/outline.html", title: "株式会社スズカ未来 マイナビ2026", desc: "" },
      { url: "https://doda.jp/DodaFront/View/Company/j_id__1/", title: "株式会社スズカ未来の求人", desc: "" },
      { url: "https://tenshoku.mynavi.jp/company/1/", title: "株式会社スズカ未来 の転職・求人情報", desc: "【掲載終了】 介護職" },
      { url: "https://en-gage.net/suzukamirai/", title: "株式会社スズカ未来 採用サイト", desc: "" },
    ],
    pageOf: async (u) => u.includes("doda") ? { verdict: "current", why: "2026年11月の掲載・更新", text: "株式会社スズカ未来 募集職種：介護職 採用予定人数：5名 更新日：2026年11月1日" }
      : u.includes("mynavi.jp/28") ? { verdict: "unknown", why: "ページに掲載・更新の日付が無い", text: "" }
      : { verdict: "unknown", why: "ページに掲載・更新の日付が無い", text: "" },
  });
  assert.equal(R.media, "マイナビ（新卒）・doda");
  assert.equal(R.hook, "マイナビ（新卒）で募集を拝見してお電話しました");
  assert.equal(R.hiring, "新卒採用の情報あり・中途採用の情報あり");
  assert.equal(R.roles, "介護職");                                               // 確かめたページからだけ職種を取る（次の項目は含めない）
  assert.equal(R.headcount, "5名");
  assert.ok(R.dropped.some((d) => d.value === "マイナビ転職"));
  assert.ok(R.dropped.some((d) => d.value === "engage"));
});
await t("マイナビ 27卒のページでも、ページに「受付を終了」とあれば出さない", async () => {
  const R = await recruitFacts({ name: "株式会社かめや", clock: C,
    results: [{ url: "https://job.mynavi.jp/27/pc/search/corp89236/outline.html", title: "株式会社かめや マイナビ2027", desc: "" }],
    pageOf: async () => ({ verdict: "past", why: "「エントリー受付を終了しました」とある", text: "" }) });
  assert.equal(R.media, ""); assert.equal(R.hook, ""); assert.equal(R.hiring, "");
});

// ───── 表示の関所 ─────
const legacy = { status: "ok", at: "2026-11-21T00:00:00Z", biz: "障がい者のグループホーム", employees: "75名", location: "埼玉県", founded: "1999年",
  hiring: "中途採用の情報あり", roles: "支援員", headcount: "15名", media: "リクナビ・ジョブメドレー・ハローワーク",
  issue: "複数の媒体（リクナビ・ジョブメドレー・ハローワーク）に載せており、応募の管理が分散しているかもしれない（推定）", hook: "リクナビで募集を拝見してお電話しました", confirm: "採用人数・採用のご担当者", sources: [] };
await t("確かめる前の古い調べ：採用の項目を空にし、会社の基本情報は残す", () => {
  const s = showableResearch(legacy, NOW);
  for (const k of RECRUIT_KEYS) assert.equal(s[k], "", k);
  assert.equal(s.recruitHidden, "unverified");
  assert.equal(s.biz, legacy.biz); assert.equal(s.employees, "75名");
  assert.equal(legacy.media, "リクナビ・ジョブメドレー・ハローワーク");          // 元のデータは書き換えない
});
await t("今の確かめ方で確かめた調べはそのまま、日が経ったら採用の項目を出さない", () => {
  const ok = { ...legacy, media: "マイナビ（新卒）", check: { v: CHECK_V, at: "2026-11-20T00:00:00Z" } };
  assert.equal(showableResearch(ok, NOW).media, "マイナビ（新卒）");
  const old = { ...ok, check: { v: CHECK_V, at: new Date(NOW - (STALE_DAYS + 1) * 86400e3).toISOString() } };
  assert.equal(showableResearch(old, NOW).media, ""); assert.equal(showableResearch(old, NOW).recruitHidden, "stale");
  assert.equal(showableResearch({ ...ok, check: { v: CHECK_V - 1, at: ok.check.at } }, NOW).media, "");
  assert.equal(showableResearch({ status: "error", error: "x" }, NOW).error, "x");
  assert.equal(showableResearch(null, NOW), null);
});
// 画面の researchHtml（public/mccall.js）を取り出して、関所を通したあとの描画に古い採用の情報が出ないことを確かめる
const src = fs.readFileSync(new URL("../public/mccall.js", import.meta.url), "utf8");
const a = src.indexOf("  function researchHtml(L) {"); const b = src.indexOf("\n  }\n", a);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const day = (s) => String(s || "").slice(0, 10);
const researchHtml = new Function("esc", "day", `${src.slice(a, b + 4)}; return researchHtml;`)(esc, day);
await t("画面：確かめる前の古い調べは、媒体・切り口・人数・課題を描かず、理由を出す", () => {
  const h = researchHtml({ research: showableResearch(legacy, NOW) });
  for (const w of ["リクナビ", "ジョブメドレー", "ハローワーク", "15名", "支援員", "話の切り口", "中途採用の情報あり"]) assert.ok(!h.includes(w), w);
  assert.ok(h.includes("障がい者のグループホーム")); assert.ok(h.includes("確かめる前"));
});
await t("画面：確かめた採用の情報は出し、「確かめたものだけ」と書く", () => {
  const h = researchHtml({ research: showableResearch({ ...legacy, media: "マイナビ（新卒）", hook: "マイナビ（新卒）で募集を拝見してお電話しました", headcount: "", roles: "", issue: "", hiring: "新卒採用の情報あり", check: { v: CHECK_V, at: "2026-11-20T00:00:00Z" } }, NOW) });
  assert.ok(h.includes("マイナビ（新卒）で募集を拝見")); assert.ok(h.includes("今の募集と確かめられたものだけ")); assert.ok(!h.includes("確かめる前"));
});
await t("サーバー：リードを返すときに関所を通している（画面に出る道は lead.research だけ）", () => {
  const s = fs.readFileSync(new URL("../server/mccall.js", import.meta.url), "utf8");
  assert.ok(s.includes("research: showableResearch(lead.research)"));
  assert.ok(!/c\.research->>'(?:hiring|roles|headcount|media|issue|hook)'/.test(s.replace(/RX = \(k\)[^\n]*/, "")), "採用の項目を関所を通さずに読む SQL がある");
});
console.log(`\n${n}件 すべて通りました`);
