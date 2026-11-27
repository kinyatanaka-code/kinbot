// IS と FS のチーム（server/mcteam.js）の確かめ。使い方：node dev/mcteam_check.mjs
//   取り違えると、同じチームの FS に渡るはずのアポが他チームへ行くので、「自分のチーム → 他チーム → 予定が重なっても自分のチーム」の順を見る
import assert from "node:assert/strict";
import { teamKey, teamLabel, teamOf, splitFree, slotScore, pickFs, isRandomSetter, pickFsRandom } from "../server/mcteam.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };

t("チームの書き方の違いを同じチームにそろえる", () => {
  for (const v of ["餌取チーム", "餌取", " 餌取 チーム "]) assert.equal(teamKey(v), "餌取");
  for (const v of ["斎藤チーム", "齊藤", "斉藤チーム", "齋藤"]) assert.equal(teamKey(v), "斎藤");
  assert.equal(teamLabel("餌取"), "餌取チーム"); assert.equal(teamLabel(""), "");
});
t("名簿の既定のチーム（福井さん：餌取＝森・趙・重永・内藤／斎藤＝小賀坂・大沢・岩浪・足立）", () => {
  const T = (name) => teamOf({ email: "x@example.com", name }, []);
  for (const nm of ["森 康晴", "趙彩娟", "重永浩汰", "内藤賴郁亜", "内藤頼郁亜", "餌取 鴻志"]) assert.equal(T(nm), "餌取", nm);
  for (const nm of ["小賀坂和也", "大沢 瑛太", "岩浪大己", "足立瞬弥", "齊藤玲耶", "斎藤玲耶"]) assert.equal(T(nm), "斎藤", nm);
  assert.equal(T("本炭更紗"), "");   // チームの無いセールス
  assert.equal(T("森田太郎"), "");   // 苗字が同じでも別人は当てない
});
t("メンバー管理のチームがあれば、名簿より優先する（管理者が画面で直せる）", () => {
  const members = [{ email: "mori@example.com", name: "森康晴", team: "斎藤チーム" }, { email: "new@example.com", name: "新人", team: "餌取チーム" }];
  assert.equal(teamOf({ email: "MORI@example.com", name: "森康晴" }, members), "斎藤");
  assert.equal(teamOf({ email: "new@example.com", name: "" }, members), "餌取");
  // メンバー管理にいてもチームが空なら名簿の既定
  assert.equal(teamOf({ email: "z@example.com", name: "" }, [{ email: "z@example.com", name: "趙彩娟", team: "" }]), "餌取");
});
const E = { email: "etori@example.com", name: "餌取", team: "餌取" }, S = { email: "saito@example.com", name: "齊藤", team: "斎藤" }, H = { email: "hon@example.com", name: "本炭", team: "" };
t("日程の候補：自分のチームの FS が空いていれば、それだけを出す", () => {
  const s = splitFree([S, E, H], "餌取");
  assert.deepEqual(s.mine.map((x) => x.name), ["餌取"]); assert.equal(s.useOther, false);
});
t("日程の候補：自分のチームが空いていない時間だけ、他チームを印つきで出す", () => {
  const s = splitFree([S, H], "餌取");
  assert.equal(s.mine.length, 0); assert.equal(s.useOther, true); assert.deepEqual(s.other.map((x) => x.name), ["齊藤", "本炭"]);
  assert.equal(splitFree([], "餌取").useOther, false);
});
t("日程の候補：チームが分からない人は今までどおり全員", () => {
  const s = splitFree([S, E], ""); assert.equal(s.mine.length, 2); assert.equal(s.useOther, false);
});
t("おすすめの並び：自分のチームが空いている枠は、他チームが何人空いていても上", () => {
  assert.ok(slotScore([E], "餌取") > slotScore([S, H], "餌取"));
  assert.equal(slotScore([], "餌取"), 0);
});
t("担当 FS：自分のチーム → 他チーム → だれも空いていなければ自分のチーム（予定が重なる印）", () => {
  const all = [S, E, H];
  const ok = (m) => new Map(all.map((c) => [c.email, m[c.name]]));
  let p = pickFs(all, ok({ 餌取: true, 齊藤: true, 本炭: true }), "餌取");
  assert.equal(p.name, "餌取"); assert.equal(p.other, false); assert.equal(p.conflict, false);
  p = pickFs(all, ok({ 餌取: false, 齊藤: true, 本炭: true }), "餌取");
  assert.equal(p.name, "齊藤"); assert.equal(p.other, true);
  p = pickFs(all, ok({ 餌取: false, 齊藤: false, 本炭: false }), "餌取");
  assert.equal(p.name, "餌取"); assert.equal(p.conflict, true); assert.equal(p.unread, false);
  p = pickFs(all, ok({ 餌取: null, 齊藤: null, 本炭: null }), "斎藤");
  assert.equal(p.name, "齊藤"); assert.equal(p.conflict, true); assert.equal(p.unread, true);
  // チームが分からない IS：空いている人から。だれも空いていなければ決めない（勝手に押し付けない）
  assert.equal(pickFs(all, ok({ 餌取: false, 齊藤: true, 本炭: false }), "").name, "齊藤");
  assert.equal(pickFs(all, ok({ 餌取: false, 齊藤: false, 本炭: false }), ""), null);
});
t("チーム「ランダム」：どのチームにも属さない（名簿の既定より優先）", () => {
  for (const v of ["ランダム", "ランダムチーム", " ランダム "]) assert.equal(teamKey(v), "");
  // 名簿では餌取チームの森さんでも、メンバー管理でランダムにしたらチームなし
  assert.equal(teamOf({ email: "mori@example.com", name: "森康晴" }, [{ email: "mori@example.com", name: "森康晴", team: "ランダム" }]), "");
  // ランダムの IS：チームを問わず空いている FS 全員が候補
  const R = { email: "r@example.com", name: "ランダムFS", team: "" };
  assert.deepEqual(splitFree([S, E, R], "").mine.map((x) => x.name), ["齊藤", "餌取", "ランダムFS"]);
  // ランダムの FS：餌取の IS から見ると「他チーム」扱い（自チームの FS が空いていないときの代わり）
  assert.equal(pickFs([E, R], new Map([[E.email, false], [R.email, true]]), "餌取").name, "ランダムFS");
});
t("福井さんのアポだけ、餌取・斎藤にランダムで振る（空いているチームだけでくじ）", () => {
  assert.equal(isRandomSetter({ email: "f@example.com", name: "福井 聖" }), true);
  assert.equal(isRandomSetter({ email: "f@example.com", name: "" }, [{ email: "F@example.com", name: "福井聖" }]), true);
  assert.equal(isRandomSetter({ email: "m@example.com", name: "森康晴" }), false);
  const all = [E, S, H];
  const ok = (o) => new Map([[E.email, o.e], [S.email, o.s], [H.email, o.h]]);
  // 両方空いている：くじの目で分かれる
  assert.equal(pickFsRandom(all, ok({ e: true, s: true, h: true }), () => 0).name, "餌取");
  assert.equal(pickFsRandom(all, ok({ e: true, s: true, h: true }), () => 0.99).name, "齊藤");
  // 片方だけ空いている：くじの目に関係なく空いている方（チームのない本炭さんは選ばない）
  for (const r of [0, 0.99]) assert.equal(pickFsRandom(all, ok({ e: false, s: true, h: true }), () => r).name, "齊藤");
  const one = pickFsRandom(all, ok({ e: false, s: true, h: true }), () => 0);
  assert.equal(one.random, true); assert.equal(one.other, false); assert.equal(one.conflict, false);
  // どちらも空いていない：くじで選んだチームの FS を「予定が重なる」で担当に
  const c = pickFsRandom(all, ok({ e: false, s: false, h: true }), () => 0.99);
  assert.equal(c.name, "齊藤"); assert.equal(c.conflict, true);
});
console.log(`\nすべて通りました（${n} 件）`);
