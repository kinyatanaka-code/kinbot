// 「かける」に出す条件（MQL）と並びの点（server/mcmql.js）の確かめ。使い方：node dev/mcmql_check.mjs
//   外しすぎると「かける」が空になり、外し忘れるとかけてはいけない会社にかかるので、両方を見る。
//   SF 立ち上げの判定（重複の見つけ方・作る中身）も、禁止名簿と同じ鍵（server/db.js）で確かめる
import assert from "node:assert/strict";
import { mqlOf, mqlOfBales, mqlPoints, phoneJudge, phoneCands, effectiveSource, hiresLow, sfxOf, buildIndex, matchLead, leadFields, personName, planCsv, MQL_SF_FIELDS, ZERO_SOURCES } from "../server/mcmql.js";
import { rankQueue } from "../server/mccadence.js";
import { approachKeys } from "../server/db.js";

let n = 0; const t = (name, fn) => { fn(); n++; console.log(`ok  ${name}`); };
const NOW = new Date("2026-11-24T10:00:00+09:00");
const ok = (x) => mqlOf({ phone: "03-1234-5678", ...x }, NOW);
const SF = (o = {}) => ({ _at: NOW.toISOString(), LeadSource: "アウトバウンド", Phone: "03-1234-5678", ...o });

t("SF の印が何も無く、番号があれば出す（いまの量を割らない）", () => {
  const m = ok({ src: "sf", sfx: SF() });
  assert.equal(m.ok, true); assert.deepEqual(m.why, []); assert.equal(m.until, null);
});
t("M1〜M3：アプローチ禁止・コンバート済み・オプトアウト・退職は出さない。「解除」は禁止ではない", () => {
  assert.deepEqual(ok({ sfx: SF({ Ban_Type__c: "競合" }) }).why, ["ban"]);
  assert.equal(ok({ sfx: SF({ Ban_Type__c: "解除" }) }).ok, true);
  assert.deepEqual(ok({ sfx: SF({ IsConverted: true }) }).why, ["converted"]);
  assert.deepEqual(ok({ sfx: SF({ Mochica_optout_check__c: true }) }).why, ["optout"]);
  assert.deepEqual(ok({ sfx: SF({ Retire_check__c: true }) }).why, ["retire"]);
  // SF に無いリード（CSV・DOC）は「印なし」と同じ
  assert.equal(ok({ src: "csv", seg: { source: "展示会リスト" } }).ok, true);
});
t("状態が「アーカイブ」でも外さない（オーナー決定）", () => {
  assert.equal(ok({ sfx: SF({ Status: "アーカイブ" }) }).ok, true);
});
t("M4：番号が無い・形が違う・0120/0800 だけ・SF の除外フラグや現アナの番号だけなら出さない", () => {
  assert.deepEqual(mqlOf({ phone: "" }, NOW).why, ["phone_none"]);
  assert.deepEqual(mqlOf({ phone: "12345" }, NOW).why, ["phone_none"]);
  assert.deepEqual(mqlOf({ phone: "0120-123-456" }, NOW).why, ["phone_free"]);
  assert.deepEqual(mqlOf({ phone: "0800-123-4567" }, NOW).why, ["phone_free"]);
  assert.deepEqual(ok({ sfx: SF({ ExclusionFlag_Phone__c: true }) }).why, ["phone_sf"]);
  assert.deepEqual(ok({ sfx: SF({ last_action_status__c: "現アナ" }) }).why, ["phone_sf"]);
  assert.deepEqual(ok({ sfx: SF({ last_action_status__c: "現在使われていない" }) }).why, ["phone_sf"]);
});
t("M4：別の番号（直通・追加の番号・元のデータの電話）が生きていれば、その番号で出す", () => {
  assert.equal(ok({ sfx: SF({ ExclusionFlag_Phone__c: true }), gate: { direct: "03-9999-0000" } }).ok, true);
  assert.equal(mqlOf({ phone: "0120-123-456", info: { phones: [{ number: "06-1111-2222" }] } }, NOW).ok, true);
  assert.equal(mqlOf({ phone: "0120-123-456", data: { personalTel: "090-1234-5678" } }, NOW).ok, true);
  assert.equal(mqlOf({ phone: "0120-123-456", info: { contacts: [{ name: "山田", phone: "03-2222-3333" }] } }, NOW).ok, true);
  // MOCHICALL で相手に届いたことがあれば、SF の「現アナ」は古いとみなす。電話の除外フラグはいつも守る
  assert.equal(ok({ sfx: SF({ last_action_status__c: "現アナ" }), lastOutcome: "absent" }).ok, true);
  assert.equal(ok({ sfx: SF({ ExclusionFlag_Phone__c: true }), lastOutcome: "absent" }).ok, false);
  // +81 の番号も 0 から始まる形で見る
  assert.equal(mqlOf({ phone: "+81-3-1234-5678" }, NOW).ok, true);
  assert.equal(phoneCands({ phone: "03-1", data: { companyTel2: "06-1234-5678", 住所: "東京都" } }).length, 2);
  assert.equal(phoneJudge(["03-1234-5678"], null).ok, true);
});
t("M5：商談中・利用中の取引先に当たったら出さない", () => {
  assert.deepEqual(ok({ sfx: SF(), busyAcct: true }).why, ["account"]);
});
t("M6：実績ゼロ帯の16のリード元・SF でリード元が空は出さない。分からない（SF に無い・リストにも元が無い）ものは外さない", () => {
  assert.equal(ZERO_SOURCES.length, 16);
  for (const s of ["HR-EXPO", "BPOアウトバウンド", "新卒研修", "Hrog", "DXPO", "BOXIL", "九州EXPO", "不明"]) assert.deepEqual(ok({ sfx: SF({ LeadSource: s }) }).why, ["source"], s);
  assert.deepEqual(ok({ sfx: SF({ LeadSource: null }) }).why, ["source"]);
  assert.deepEqual(ok({ src: "sf", seg: { source: "SF（ソースなし）" } }).why, ["source"]);
  // ゼロ帯でない展示会（BOXIL EXPO は 0.46%）・sora・Sitoke は出す
  for (const s of ["BOXIL EXPO", "soraプロジェクト", "Sitoke", "ListA"]) assert.equal(ok({ sfx: SF({ LeadSource: s }) }).ok, true, s);
  // 全角・半角の違いは同じに見る
  assert.deepEqual(ok({ sfx: SF({ LeadSource: "ＨＲ－ＥＸＰＯ" }) }).why, ["source"]);
  assert.deepEqual(ok({ sfx: SF({ LeadSource: "ＤＸＰＯ" }) }).why, ["source"]);
  // CSV・DOC：リードに書いてあった元 → リストに付けた元 → 分からない
  assert.deepEqual(ok({ src: "csv", seg: { source: "CSV 取り込み" }, listSource: "HR-EXPO" }).why, ["source"]);
  assert.equal(ok({ src: "csv", seg: { source: "CSV 取り込み" } }).ok, true);
  assert.equal(ok({ src: "csv", seg: { source: "アウトバウンド" }, listSource: "HR-EXPO" }).ok, true);
  assert.deepEqual(effectiveSource({ src: "doc", seg: { source: "DOC（ソースなし）" } }), { v: "", known: false, by: "" });
  // SF に結びついていても、SF で見つからなかったリードは SF に無いのと同じ
  assert.equal(effectiveSource({ sfx: { _missing: true }, seg: { source: "Sitoke" }, src: "bales" }).v, "Sitoke");
});
t("M7：失注理由が機能面・価格・親会社の意向・LINENG・運用イメージなら出さない。理由が空は出す", () => {
  for (const r of ["機能面", "価格", "親会社の意向", "LINENG", "運用イメージ"]) assert.deepEqual(ok({ sfx: SF({ Lostopp_reason1__c: r }) }).why, ["lost"], r);
  assert.equal(ok({ sfx: SF({ Lostopp_reason1__c: "検討時期相違" }) }).ok, true);
  assert.deepEqual(ok({ src: "sf", seg: { source: "失注リサイクル", lost: { reason: "価格", date: "2024-01-01" } } }).why, ["lost"]);
  assert.equal(ok({ src: "sf", seg: { source: "失注リサイクル", lost: { reason: "理由なし" } } }).ok, true);
});
t("M8 は入れない：FS が追っている失注（次回アクション日が未来）でも出す（オーナー決定）", () => {
  assert.equal(ok({ sfx: SF({ Lostopp_nextaction__c: "2027-01-10" }) }).ok, true);
  assert.equal(MQL_SF_FIELDS.includes("Lostopp_nextaction__c"), false);
});
t("M9：ほかの人が14日以内に SF で接触したら、14日たつまで出さない（MOCHICALL で同じ日以降にかけていれば自分たちの分）", () => {
  const m = ok({ sfx: SF({ Last_ActiveDate__c: "2026-11-20" }) });
  assert.deepEqual(m.why, ["touched"]); assert.equal(m.until, new Date("2026-12-04T00:00:00+09:00").toISOString());
  assert.equal(ok({ sfx: SF({ Last_ActiveDate__c: "2026-11-09" }) }).ok, true);   // 15日前
  assert.deepEqual(ok({ sfx: SF({ Last_ActiveDate__c: "2026-11-11" }) }).why, ["touched"]);   // 13日前
  assert.equal(ok({ sfx: SF({ Last_ActiveDate__c: "2026-11-20" }), lastAt: "2026-11-20T06:00:00Z" }).ok, true);
  assert.deepEqual(ok({ sfx: SF({ Last_ActiveDate__c: "2026-11-20" }), lastAt: "2026-11-19T06:00:00Z" }).why, ["touched"]);
  // ほかにも理由があれば until は付けない（時間がたっても出さない）
  assert.equal(ok({ sfx: SF({ Last_ActiveDate__c: "2026-11-20", Retire_check__c: true }) }).until, null);
});
t("並びの点：失注の新しさ・失注理由・前回の結果・MA・採用人数・リード元・受付ブロック", () => {
  const p = (sfx, l = {}) => mqlPoints(ok({ sfx: SF(sfx) }), l, NOW);
  assert.equal(p({ LostOpp_lostdate__c: "2026-08-01" }).score, 40 + 10);
  assert.equal(p({ LostOpp_lostdate__c: "2026-01-10" }).score, 30 + 10);
  assert.equal(p({ LostOpp_lostdate__c: "2024-01-10" }).score, 10);
  assert.equal(p({ Lostopp_reason1__c: "タイミング・検討時期", LeadSource: "ListA" }).score, 20);
  assert.equal(p({ last_action_status__c: "担当者接触：営業フォロー", LeadSource: "ListA" }).score, 20);
  // MOCHICALL でかけていれば、そちらが「前回の結果」
  assert.equal(p({ last_action_status__c: "担当者接触：営業フォロー", LeadSource: "ListA" }, { last_outcome: "no_answer" }).score, 0);
  assert.equal(p({ LeadSource: "ListA" }, { last_outcome: "follow" }).score, 20);
  assert.equal(p({ last_action_status__c: "受付ブロック", LeadSource: "ListA" }).score, -10);
  assert.equal(p({ Pardot_score_contact__c: 55, LeadSource: "ListA" }).score, 15);
  assert.equal(p({ pi__last_activity__c: "2026-03-01T00:00:00.000+0000", LeadSource: "ListA" }).score, 15);
  assert.equal(p({ pi__last_activity__c: "2025-12-01T00:00:00.000+0000", LeadSource: "ListA" }).score, 0);
  assert.equal(p({ Number_of_hires__c: "6～10名", LeadSource: "ListA" }).score, 10);
  assert.equal(p({ Number_of_hires__c: "1～2名", LeadSource: "ListA" }).score, -10);
  assert.equal(p({ Number_of_hires__c: "3～5名", LeadSource: "ListA" }).score, 0);
  assert.equal(p({ Number_of_hires__c: "1～2名", LeadSource: "ListA" }, { hearing: { target: 8 } }).score, 10);   // 架電で聞いた人数が新しい
  for (const s of ["アウトバウンド", "失注リサイクル", "Google Natural Search", "過去ユーザー"]) assert.equal(p({ LeadSource: s }).score, 10, s);
  assert.equal(hiresLow("301名～"), 301); assert.equal(hiresLow("不明"), null);
});
t("並びの考え方は変えない：約束の掛け直し → 時刻が来た掛け直し → 点の高い順。点は tier 2 の中だけ", () => {
  const past = new Date(NOW.getTime() - 3600e3).toISOString();
  const hotLost = ok({ sfx: SF({ LostOpp_lostdate__c: "2026-10-01", Lostopp_reason1__c: "タイミング・検討時期" }) });
  const rows = [
    { id: 1, hot: 0, mql: hotLost },
    { id: 2, hot: 0, next_at: past, next_why: "記録した人が決めた時刻" },
    { id: 3, hot: 0, next_at: past, next_why: "自動" },
    { id: 4, hot: 3, mql: ok({ sfx: SF({ LeadSource: "ListA" }) }) },
    { id: 5, hot: 0, mql: ok({ sfx: SF({ LeadSource: "ListA", last_action_status__c: "受付ブロック" }) }) },
  ];
  const r = rankQueue(rows, NOW);
  assert.deepEqual(r.map((x) => x.id), [2, 3, 1, 4, 5]);
  assert.ok(r.find((x) => x.id === 1).reasons.includes("失注から半年以内"));
});
t("SF の項目を読んだ形：値のある項目だけ・読んだ日時つき", () => {
  const x = sfxOf({ Id: "00Q000000000001AAA", Phone: "03", MobilePhone: null, Retire_check__c: false, Extra__c: "x" }, NOW);
  assert.equal(x.Phone, "03"); assert.equal("MobilePhone" in x, false); assert.equal(x.Retire_check__c, false); assert.equal("Extra__c" in x, false); assert.ok(x._at);
});
// ---- SF 立ち上げ ----
const IDX = buildIndex([
  { type: "lead", id: "00QA00000000001AAA", company: "株式会社ひだまり", phones: ["03-1111-2222"], conv: false, mod: "2026-01-01" },
  { type: "lead", id: "00QA00000000002AAA", company: "ひだまり株式会社", phones: [], conv: true, convAcct: "001A00000000009AAA", mod: "2026-05-01" },
  { type: "lead", id: "00QA00000000003AAA", company: "（株）あおぞら 様", phones: ["06-0000-1111"], conv: false, mod: "2025-01-01" },
  { type: "lead", id: "00QA00000000004AAA", company: "ビル管理組合", phones: ["03-5555-6666"], conv: false, mod: "2025-01-01" },
  { type: "acct", id: "001A00000000009AAA", company: "株式会社みなと", phones: ["045-000-1234"] },
  { type: "acct", id: "001A00000000010AAA", company: "有限会社かもめ", phones: [] },
], approachKeys);
const match = (company, phones = [], banned = false) => matchLead({ company, phones, banned }, IDX, approachKeys);
t("SF 立ち上げ：電話と会社名が同じ SF のリードに結びつける。同じ会社が複数ならコンバート前を選ぶ", () => {
  const m = match("ひだまり 株式会社", ["03-1111-2222"]);
  assert.equal(m.action, "link"); assert.equal(m.hit.id, "00QA00000000001AAA");
  const c = match("株式会社 ひだまり", ["03-9999-0000"]);   // 会社名だけ同じ（2件）→ コンバート前
  assert.equal(c.action, "link"); assert.equal(c.hit.id, "00QA00000000001AAA");
  assert.equal(match("あおぞら", []).hit.id, "00QA00000000003AAA");   // 禁止名簿と同じ「様」「（株）」を外した会社名
});
t("SF 立ち上げ：取引先だけに当たれば作らない（コンバートしたリードがあればそれに結びつける）", () => {
  const a = match("株式会社みなと", ["045-000-1234"]);
  assert.equal(a.action, "link"); assert.equal(a.hit.id, "00QA00000000002AAA");   // 取引先 001…9 にコンバートしたリード
  const b = match("かもめ", []);
  assert.equal(b.action, "acct"); assert.equal(b.hit.id, "001A00000000010AAA");
});
t("SF 立ち上げ：電話だけ同じ（ビルの代表番号など）は要確認。どこにも無ければ作る。禁止・会社名なしは作らない", () => {
  assert.equal(match("株式会社まるで違う", ["03-5555-6666"]).action, "review");
  assert.equal(match("株式会社はじめて", ["03-7777-8888"]).action, "create");
  assert.equal(match("株式会社はじめて", ["03-7777-8888"], true).action, "skip_ban");
  assert.equal(match("", ["03-7777-8888"]).action, "skip_nocompany");
});
t("SF 立ち上げ：作る中身（レコードタイプ・姓名・業種・リード元・住所・説明）。架電画面の「SF にリードを作る」と同じ作り", () => {
  const f = leadFields({ company: " 株式会社はじめて ", phone: "03-7777-8888", person: "山田 太郎 様", email: "a@b.co.jp", industry: "IT・通信", pref: "東京都", address: "東京都千代田区1-1", source: "アウトバウンド", list: "11月", src: "csv" }, "012RT");
  assert.equal(leadFields({ company: "A社", pref: "大阪府", address: "大阪市北区1-1" }, "x").Street, "大阪府大阪市北区1-1");
  assert.equal(f.RecordTypeId, "012RT"); assert.equal(f.Company, "株式会社はじめて"); assert.equal(f.LastName, "山田 太郎"); assert.equal("FirstName" in f, false); assert.equal(f.Industry, "IT・通信");
  assert.equal(f.LeadSource, "アウトバウンド"); assert.equal("State" in f, false); assert.equal(f.Street, "東京都千代田区1-1"); assert.match(f.Description, /MOCHICALL から立ち上げ（リスト「11月」・取り込み元 CSV）/);
  assert.deepEqual(personName(""), { LastName: "ご担当者" }); assert.deepEqual(personName("採用ご担当者様"), { LastName: "ご担当者" }); assert.deepEqual(personName("佐藤"), { LastName: "佐藤" });
  // 架電画面から作るとき（リスト・取り込み元を渡さない）は説明を入れない（2026-11-24 の作りのまま）
  const g = leadFields({ company: "株式会社その場", person: "", phone: "03-1111-2222", email: "x@y.jp", web: "https://x.jp", industry: "製造" }, "012RT");
  assert.deepEqual(g, { RecordTypeId: "012RT", Company: "株式会社その場", LastName: "ご担当者", Industry: "製造", Phone: "03-1111-2222", Email: "x@y.jp", Website: "https://x.jp" });
  const csv = planCsv([{ id: 1, list: "L", src: "csv", company: "A,B", action: "create", why: "x", fields: f }]);
  assert.ok(csv.startsWith("﻿MOCHICALL のリード,")); assert.ok(csv.includes('"A,B"')); assert.ok(csv.includes("SF にリードを作る"));
});
t("BALES の行（MOCHICALL に入る前）：電話・リード元・行に付いた SF の値・商談中の会社で外す。分からないものは外さない", () => {
  const ok = mqlOfBales({ d: { companyName: "株式会社A", companyTel1: "03-1234-5678", "leadSources.0.name": "アウトバウンド" } });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.deepEqual(mqlOfBales({ d: { companyTel1: "0120-111-222" } }).why, ["phone_free"]);
  assert.deepEqual(mqlOfBales({ d: {} }).why, ["phone_none"]);
  assert.deepEqual(mqlOfBales({ d: { companyTel1: "03-1234-5678", "leadSources.0.name": "HR-EXPO" } }).why, ["source"]);
  // リード元が空は「分からない」なので外さない（SF の「なし」とは違う）
  assert.equal(mqlOfBales({ d: { companyTel1: "03-1234-5678" } }).ok, true);
  assert.deepEqual(mqlOfBales({ d: { companyTel1: "03-1234-5678" }, lead: { "アプローチ禁止の種類": "電話NG" } }).why, ["ban"]);
  assert.equal(mqlOfBales({ d: { companyTel1: "03-1234-5678" }, lead: { "アプローチ禁止の種類": "なし" } }).ok, true);
  assert.deepEqual(mqlOfBales({ d: { companyTel1: "03-1234-5678" }, lead: { converted: true } }).why, ["converted"]);
  assert.deepEqual(mqlOfBales({ d: { companyTel1: "03-1234-5678" }, lead: { "失注商談失注理由大": "価格" } }).why, ["lost"]);
  assert.deepEqual(mqlOfBales({ d: { companyTel1: "03-1234-5678" }, busyAcct: true }).why, ["account"]);
  // 個人の携帯（personalTel）が生きていれば出す
  assert.equal(mqlOfBales({ d: { companyTel1: "0120-111-222", personalTel: "090-1234-5678" } }).ok, true);
});
console.log(`\nすべて通りました（${n} 件）`);
