// server/mchearing.js（アポの必須ヒアリング・ヒアリングのメール）の確かめ。node dev/mchearing_check.mjs
import assert from "node:assert/strict";
import { apoCheck, cleanHearing, mergeHearing, hearingLines, mailDefaults, hearMailBody, HEAR_ITEMS, BUDGET_NONE, PRIORITY_ENTRY } from "../server/mchearing.js";

const C = { pains: ["母集団が集まらない", "特に困っていない"], who: ["新卒", "中途", "パート・アルバイト"] };
let n = 0; const t = (name, fn) => { fn(); n++; console.log("ok", name); };
const full = { name: "山田", mail: "yamada@example.co.jp", tel: "03-1234-5678", contact: 120, target: 5, when: "4月", budget3m: "3カ月以内に検討できる予算がある", need: "困りごと：母集団が集まらない／ほしい人：新卒" };

t("28項目（基本3・必須7・追加18）", () => {
  assert.equal(HEAR_ITEMS.length, 28);
  assert.equal(HEAR_ITEMS.filter((x) => x.group === "basic").length, 3);
  assert.equal(HEAR_ITEMS.filter((x) => x.group === "req").length, 7);
  assert.equal(HEAR_ITEMS.filter((x) => x.group === "more").length, 18);
});
t("そろっていればアポにできる", () => assert.deepEqual(apoCheck(full, {}, C).block, []));
t("空ならすべて足りない", () => {
  const b = apoCheck({}, {}, C).block;
  for (const x of ["担当者氏名", "担当者メール", "担当者電話", "① 接触人数", "② 現卒の採用目標人数", "④ 次卒の選考開始予定時期", "⑤ 3カ月以内の導入予算", "⑥ 採用対象", "⑦ 課題感"]) assert.ok(b.includes(x), x);
  assert.ok(!b.includes("③ 提案の優先課題"), "目標人数が分からないときは③を求めない");
});
t("目標4名未満なら③が要る", () => {
  assert.ok(apoCheck({ ...full, target: 3 }, {}, C).block.includes("③ 提案の優先課題"));
  assert.deepEqual(apoCheck({ ...full, target: 3, priority: "どちらも取り組みたい" }, {}, C).block, []);
});
t("予算が無いとアポにしない", () => { const b = apoCheck({ ...full, budget3m: BUDGET_NONE }, {}, C).block; assert.equal(b.length, 1); assert.match(b[0], /営業フォロー/); });
t("接触人数30人未満・エントリー数優先は警告だけ", () => {
  const r = apoCheck({ ...full, contact: 10, target: 2, priority: PRIORITY_ENTRY }, {}, C);
  assert.deepEqual(r.block, []); assert.equal(r.warn.length, 2);
});
t("名前は漢字が要る・仮置きは数えない", () => {
  assert.ok(apoCheck({ ...full, name: "yamada" }, {}, C).block.includes("担当者氏名（漢字で）"));
  assert.ok(apoCheck({ ...full, name: "" }, { name: "担当者" }, C).block.includes("担当者氏名"));
  assert.deepEqual(apoCheck({ ...full, name: "" }, { name: "佐藤" }, C).block, []);
});
t("メール・電話はヒアリングが空なら会社の情報・かけた番号で埋まる", () => {
  assert.deepEqual(apoCheck({ ...full, mail: "", tel: "" }, { mail: "a@b.jp", tel: "0312345678" }, C).block, []);
  assert.ok(apoCheck({ ...full, tel: "123" }, {}, C).block.includes("担当者電話"));
});
t("次卒の選考開始は未定でもよい", () => assert.deepEqual(apoCheck({ ...full, when: "未定" }, {}, C).block, []));
t("前に自由に書いた採用ニーズは課題感に数え、採用対象は足りないまま", () => {
  const b = apoCheck({ ...full, need: "エンジニアが採れない" }, {}, C).block;
  assert.ok(b.includes("⑥ 採用対象")); assert.ok(!b.includes("⑦ 課題感"));
});
t("cleanHearing は選択肢にない値・崩れたメールを入れない", () => {
  const h = cleanHearing({ budget3m: "たぶんある", mail: "abc", contact: "１２０人", when: "13月", gender: "女性", note: "  長い\n備考 " });
  assert.equal(h.budget3m, ""); assert.equal(h.mail, ""); assert.equal(h.contact, 120); assert.equal(h.when, ""); assert.equal(h.gender, "女性"); assert.equal(h.note, "長い\n備考");
  assert.equal(cleanHearing({}), null);
});
t("mergeHearing は空で前の値を消さない", () => {
  const m = mergeHearing({ contact: 50, ats: "利用している" }, cleanHearing({ contact: "", ats: "", role: "人事部長" }));
  assert.equal(m.contact, 50); assert.equal(m.ats, "利用している"); assert.equal(m.role, "人事部長");
});
t("記録の本文は出し分けに合う項目だけ", () => {
  const L = hearingLines({ ...full, ats: "利用している", atsLine: "連携している", line: "利用していない" }, C).join("\n");
  assert.match(L, /① 接触人数：120名/); assert.match(L, /⑥ 採用対象：新卒/); assert.match(L, /⑪ 採用管理ツールのLINE連携：連携している/);
  assert.doesNotMatch(L, /⑫/, "採用管理ツールを使っているなら⑫は出さない");
});
t("メールの既定は、必須でまだ聞けていない項目（性別などは聞かない）", () => {
  const d = mailDefaults({ contact: 100, target: 2 }, C);
  assert.deepEqual(d, ["priority", "when", "budget3m", "need_who", "need_pains"]);
  const body = hearMailBody({ company: "テスト株式会社", person: "山田", sender: "福井", keys: [...d, "gender"] });
  assert.match(body, /山田様/); assert.match(body, /1\. 優先して/); assert.doesNotMatch(body, /性別/);
});
console.log(`${n}件 ok`);
