// 架電の内容 → SF のリードの項目（server/mcsffill.js）の確かめ。使い方：node dev/mcsffill_check.mjs
//   読み違えると SF の正しい値を書き換えてしまうので、「拾うべきもの」と「拾ってはいけないもの」の両方を見る
import assert from "node:assert/strict";
import { readMemo, readInputs, planFills, pickedFields, isPlaceholderName, hiresBucket } from "../server/mcsffill.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };
const val = (cs, api) => (cs.find((c) => c.api === api) || {}).value;

t("メールと携帯・直通を拾う。自社のアドレスと日付は拾わない", () => {
  const c = readMemo("山田様 yamada@example.co.jp 携帯 090-1234-5678 直通03-1234-5678。11/20 に再架電。担当 fukui@neo-career.co.jp");
  assert.equal(val(c, "Email"), "yamada@example.co.jp");
  assert.equal(val(c, "MobilePhone"), "090-1234-5678");
  assert.equal(val(c, "phone2__c"), "03-1234-5678");
});
t("ATS：使っている・検討中（競合）・前は使っていた を分ける", () => {
  assert.equal(val(readMemo("今はHRMOSで管理している"), "ATS__c"), "HRMOS");
  const c = readMemo("ジョブカンを使っている。sonarも比較検討中");
  assert.equal(val(c, "ATS__c"), "ジョブカン"); assert.deepEqual(val(c, "Competitors__c"), ["sonarATS"]);
  assert.equal(val(readMemo("以前はi-webを使っていた"), "ATS__c"), undefined);
  assert.equal(val(readMemo("i-webらくるーと利用"), "ATS__c"), "i-webらくるーと");
  assert.equal(val(readMemo("ATSは使っていない、エクセル管理"), "ATS__c"), "無し");
  assert.equal(val(readMemo("マイナビの管理画面で管理"), "ATS__c"), "母集団形成の媒体で管理");
});
t("月：更新予定月と検討開始時期を取り違えない", () => {
  const c = readMemo("3月更新。4月から検討したい");
  assert.equal(val(c, "update_month2__c"), "3月"); assert.equal(val(c, "Start_Considering_Date__c"), "4月");
  assert.equal(val(readMemo("11/25 15時に掛け直し"), "Start_Considering_Date__c"), undefined);
});
t("人数：採用人数と従業員数", () => {
  const c = readMemo("従業員は約1,200名。27卒で10名採用予定");
  assert.equal(val(c, "NumberOfEmployees"), 1200); assert.equal(val(c, "Number_of_hires__c"), "6～10名");
  assert.equal(val(readMemo("採用目標は3名"), "Number_of_hires__c"), "3～5名");
});
t("役職は名前と並んだときだけ。「社長に相談」は役職にしない", () => {
  const c = readMemo("人事部長の佐藤様と話せた");
  assert.equal(val(c, "Title"), "人事部長"); assert.equal(val(c, "LastName"), "佐藤"); assert.equal(val(c, "Department_Category__c"), "総務・人事・労務");
  const d = readMemo("社長に相談してから折り返すとのこと");
  assert.equal(val(d, "Title"), undefined); assert.equal(val(d, "LastName"), undefined);
});
t("採用種別・SNS・LINE。否定は拾わない", () => {
  assert.deepEqual(val(readMemo("新卒と中途の両方"), "recruting_type__c"), ["新卒＋中途"]);
  assert.deepEqual(val(readMemo("新卒はやっていない。中途のみ"), "recruting_type__c"), ["中途"]);
  assert.deepEqual(val(readMemo("インスタとTikTokで発信"), "SNS__c"), ["Instagram", "Tiktok"]);
  assert.equal(val(readMemo("LINEは使っていない"), "Line_Implementation__c"), "なし");
  assert.equal(val(readMemo("公式LINEで説明会案内"), "Line_Implementation__c"), "あり");
});
t("お断り理由は断られた記録のときだけ", () => {
  assert.equal(val(readMemo("今忙しいので来月", { outcome: "callback_req" }), "Field1__c"), undefined);
  assert.equal(val(readMemo("LINEに興味がない", { outcome: "reject" }), "Field1__c"), "LINEに興味なし");
  assert.equal(val(readInputs({ outcome: "reject", reason: "他社を使っている" }), "Field1__c"), "既に取引先あり");
  assert.equal(val(readInputs({ outcome: "reject", reason: "時期が合わない" }), "Field1__c"), undefined);
});
t("退職・異動の印", () => { assert.equal(val(readMemo("前の担当の田中さんは退職された"), "Retire_check__c"), true); });
t("Web サイト：求人媒体は入れない", () => {
  assert.equal(val(readMemo("https://job.mynavi.jp/27/pc/search/corp1/outline.html"), "Website"), undefined);
  assert.equal(val(readMemo("HPは www.example.co.jp"), "Website"), "https://www.example.co.jp");
});
t("担当者名の仮置き", () => {
  for (const v of ["担当者", "採用担当者", "[[Unknown]]", "", "ご担当者様", "-"]) assert.equal(isPlaceholderName(v), true, v);
  assert.equal(isPlaceholderName("株式会社ABC", "株式会社ABC"), true);
  assert.equal(isPlaceholderName("山田"), false);
});
t("SF と比べて 新規・更新・追記・同じ を決め、書き換えは人が選んだ値だけ最初からチェック", () => {
  const cands = [...readInputs({ hearing: { when: "4月", need: "母集団が足りない", target: 8, contact: 30 }, gate: { name: "山田 太郎", direct: "03-1111-2222" } }), ...readMemo("HRMOS利用。yamada@ex.co.jp")];
  const cur = { Company: "ABC", Phone: "03-1111-2222", LastName: "担当者", Start_Considering_Date__c: "6月", Number_of_hires__c: "6～10名", Client_Issue__c: "【2026/10/01 架電】前の課題", ATS__c: "無し", Email: "old@ex.co.jp" };
  const p = planFills(cands, cur, { day: "2026-11-20" }); const by = Object.fromEntries(p.map((x) => [x.api, x]));
  assert.equal(by.LastName.kind, "new"); assert.equal(by.LastName.on, true);
  assert.equal(by.FirstName.kind, "new");
  assert.equal(by.Start_Considering_Date__c.kind, "update"); assert.equal(by.Start_Considering_Date__c.on, true);   // ヒアリングで選んだ値
  assert.equal(by.Number_of_hires__c.kind, "same");
  assert.equal(by.Client_Issue__c.kind, "add"); assert.match(by.Client_Issue__c.send, /^【2026\/11\/20 架電】母集団が足りない\n【2026\/10\/01 架電】前の課題$/);
  assert.equal(by.IS_hearing__c.kind, "new");
  assert.equal(by.phone2__c.kind, "same");   // 代表番号と同じ
  assert.equal(by.ATS__c.kind, "update"); assert.equal(by.ATS__c.on, false);   // メモから読んだ書き換えは人が選ぶ
  assert.equal(by.Email.kind, "update"); assert.equal(by.Email.on, false);
  const { fields, used } = pickedFields(p, { ATS__c: true, LastName: false });
  assert.equal(fields.ATS__c, "HRMOS"); assert.equal(fields.LastName, undefined); assert.equal(fields.Number_of_hires__c, undefined); assert.equal(fields.Email, undefined);
  assert.ok(used.every((u) => u.kind !== "same"));
});
t("複数選択は足すだけ（消さない）", () => {
  const p = planFills(readMemo("インスタとYouTubeをやっている"), { SNS__c: "Instagram;Twitter" });
  assert.equal(p[0].kind, "update"); assert.equal(p[0].send, "Instagram;Twitter;Youtube");
});
// 2026-11-20 審査（別の文脈）で見つかった取り違え
t("1文字の姓は本物の名前。仮置きにしない", () => {
  assert.equal(isPlaceholderName("林"), false);
  const p = planFills(readInputs({ gate: { name: "森田" } }), { LastName: "林" });
  assert.equal(p[0].kind, "update"); assert.equal(p[0].on, false);
});
t("姓が別の人なら、空の名も最初は入れない（「山田 太郎」を作らない）", () => {
  const by = Object.fromEntries(planFills(readInputs({ gate: { name: "佐藤 太郎" } }), { LastName: "山田", FirstName: null }).map((x) => [x.api, x]));
  assert.equal(by.LastName.on, false); assert.equal(by.FirstName.kind, "new"); assert.equal(by.FirstName.on, false);
  const ok = Object.fromEntries(planFills(readInputs({ gate: { name: "佐藤 太郎" } }), { LastName: "担当者" }).map((x) => [x.api, x]));
  assert.equal(ok.LastName.on, true); assert.equal(ok.FirstName.on, true);
});
t("丁寧語の否定・別製品・説明会の月・不在の人数を拾わない", () => {
  const c = readMemo("HRMOSは使っていない。HERPは導入していません");
  assert.equal(val(c, "ATS__c"), undefined);
  assert.equal(val(readMemo("SNSはやっていません。インスタはやっていません"), "SNS__c"), undefined);
  assert.equal(val(readMemo("ジョブカンは勤怠で使っている"), "ATS__c"), undefined);
  assert.equal(val(readMemo("9月終了の説明会"), "update_month2__c"), undefined);
  assert.equal(val(readMemo("従業員は5名ほど不在"), "NumberOfEmployees"), undefined);
  assert.equal(val(readMemo("LINEは導入していません"), "Line_Implementation__c"), "なし");
});
t("メモから読んだ電話・人数・採用種別は、空の項目でも人がチェックしたときだけ", () => {
  const by = Object.fromEntries(planFills(readMemo("別の番号 06-1234-5678 の山田さんへ。従業員は約300名。新卒採用"), {}).map((x) => [x.api, x]));
  for (const k of ["phone2__c", "NumberOfEmployees", "recruting_type__c"]) { assert.equal(by[k].kind, "new"); assert.equal(by[k].on, false, k); }
});
t("採用人数の区分", () => { assert.equal(hiresBucket(0), null); assert.equal(hiresBucket(2), "1～2名"); assert.equal(hiresBucket(500), "301名～"); });
console.log(`\nすべて通りました（${n} 件）`);
