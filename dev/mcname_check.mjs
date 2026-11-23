// インターン判定・管理者判定の名前の照合（server/mcname.js）の確かめ。使い方：node dev/mcname_check.mjs
//   名前が合わないと、その人の「かける」に何も出ない（MOCHICA のインターンと判定されない）。
//   名簿のインサイド8名が、kinbot に登録されそうな名前の書き方のどれでも当たること、別の人には当たらないことを見る
import assert from "node:assert/strict";
import { foldPersonName, rosterHit, startsWithSurname } from "../server/mcname.js";
import { MCDASH_ROSTER } from "../server/mcdash.js";
import { whoOf } from "../server/mcdashlog.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };
const R = MCDASH_ROSTER.is;
const who = (name) => (rosterHit(name, R) || {}).name || "";

t("名簿は8名（森・趙・重永・内藤・小賀坂・大沢・岩浪・足立）", () => {
  assert.deepEqual(R.map((p) => p.name).sort(), ["森", "趙", "重永", "内藤", "小賀坂", "大沢", "岩浪", "足立"].sort());
});
t("8名全員：SF の氏名・姓と名のあいだの空白（半角・全角）で当たる", () => {
  for (const p of R) {
    const sur = p.name, given = p.sf.slice(sur.length);
    for (const v of [p.sf, `${sur} ${given}`, `${sur}　${given}`, ` ${sur}  ${given} `]) assert.equal(who(v), p.name, `${p.name}：「${v}」`);
  }
});
t("8名全員：名→姓の順（Google・Zoom の表示）でも当たる", () => {
  for (const p of R) { const sur = p.name, given = p.sf.slice(sur.length); assert.equal(who(`${given} ${sur}`), p.name, `${p.name}：「${given} ${sur}」`); }
});
t("8名全員：添え書き（インターン）や記号があっても当たる", () => {
  for (const p of R) assert.equal(who(`${p.sf}（インターン）`), p.name);
  assert.equal(who("森・康晴"), "森"); assert.equal(who("大沢 瑛太(IS)"), "大沢");
});
t("異体字：内藤さんの「賴／頼」どちらでも当たる", () => {
  assert.equal(who("内藤賴郁亜"), "内藤"); assert.equal(who("内藤 頼郁亜"), "内藤"); assert.equal(who("頼郁亜 内藤"), "内藤");
});
t("Zoom の名前（ひらがな・カタカナ・全角英数）でも当たる", () => {
  assert.equal(who("らいあないとう"), "内藤"); assert.equal(who("ライアナイトウ"), "内藤"); assert.equal(who("ﾗｲｱﾅｲﾄｳ"), "内藤");
  assert.equal(who("彩娟趙"), "趙"); assert.equal(who("浩汰重永"), "重永");
});
t("別の人には当たらない（苗字だけ・名前だけ・似た名前）", () => {
  for (const v of ["森", "内藤", "康晴", "森康", "森康晴子", "大沢太郎", "内藤頼", "足立瞬", "", null]) assert.equal(who(v), "", `「${v}」`);
});
t("管理者の苗字：齊藤／斉藤／斎藤／齋藤 を同じとみなす。違う苗字は当たらない", () => {
  for (const v of ["齊藤玲耶", "斉藤 玲耶", "斎藤玲耶", "齋藤 玲耶"]) assert.ok(startsWithSurname(v, "齊藤"), v);
  assert.ok(startsWithSurname("餌取 鴻志", "餌取")); assert.ok(!startsWithSurname("佐藤 一郎", "齊藤")); assert.ok(!startsWithSurname("", "齊藤"));
});
t("営業3名（ダッシュボードの名簿）も key の名前で当たる", () => {
  for (const p of MCDASH_ROSTER.sales) assert.equal((rosterHit(`${p.name} ${p.key.slice(p.name.length)}`, MCDASH_ROSTER.sales) || {}).name, p.name);
});
t("比べる形：髙/高・﨑/崎・邊/辺・澤/沢 をそろえる", () => {
  assert.equal(foldPersonName("髙橋"), foldPersonName("高橋")); assert.equal(foldPersonName("山﨑"), foldPersonName("山崎"));
  assert.equal(foldPersonName("渡邊"), foldPersonName("渡辺")); assert.equal(foldPersonName("大澤"), foldPersonName("大沢"));
});
t("ダッシュボードの結びつけ（whoOf）：メール登録が名前より先。登録された名簿の人に、同じ名前の別アカウントは結びつかない", () => {
  const names = new Map([["a@x", ["Raia Naito"]], ["b@x", ["内藤 頼郁亜"]], ["c@x", ["森 康晴"]]]);
  const people = new Map([["a@x", { kind: "is", key: "内藤賴郁亜" }]]);
  assert.equal(whoOf("a@x", R, names, people), "らいあないとう");
  assert.equal(whoOf("b@x", R, names, people), "");
  assert.equal(whoOf("c@x", R, names, people), "森康晴");
  assert.equal(whoOf("b@x", R, names), "らいあないとう");   // 登録が無ければ名前で補う
});
console.log(`\nすべて通りました（${n} 件）`);
