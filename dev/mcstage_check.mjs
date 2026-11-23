// リードの状況を基本の7つに絞る処理の確かめ（node dev/mcstage_check.mjs）
import assert from "node:assert/strict";
import { pickLeadStages, stageOf, stageCode } from "../server/mcstage.js";
// 2026-11-19 に SF で数えた MOCHICA のリードの値＋選択リストにありそうな値
const all = ["NEW", "アーカイブ", "LS:89　リサイクル", "リサイクル", "担当者未接触", "コネクト情報獲得", "99：アーカイブ", "ジャッジ", "Qualified", "89リサイクル", "潜在顧客",
  "99アーカイブ", "04ジャッジ", "89：リサイクル", "02：担当者未接触", "LS:01　New", "LS:02　アプローチ済", "03：コネクト情報獲得", "01：新規", "04：ジャッジ", "05：コンバート"].map((v) => ({ value: v, label: v }));
const got = pickLeadStages(all);
assert.deepEqual(got.map((o) => o.value), ["01：新規", "02：担当者未接触", "03：コネクト情報獲得", "04：ジャッジ", "05：コンバート", "89：リサイクル", "99：アーカイブ"]);
assert.ok(got.every((o) => o.desc));
// 「01：」の形が無ければ、ほかの番号付きを使う（LS: はいちばん後）
assert.deepEqual(pickLeadStages([{ value: "LS:89　リサイクル" }, { value: "89リサイクル" }]).map((o) => o.value), ["89リサイクル"]);
assert.deepEqual(pickLeadStages([{ value: "LS:01　New" }]).map((o) => [o.value, o.label]), [["LS:01　New", "01：新規"]]);
// SF に無い番号は出さない
assert.deepEqual(pickLeadStages([{ value: "01：新規" }, { value: "NEW" }]).map((o) => o.value), ["01：新規"]);
assert.deepEqual(pickLeadStages([{ value: "NEW" }, { value: "Qualified" }]), []);
// 番号の読み取り
assert.equal(stageCode("LS:89　リサイクル"), "89"); assert.equal(stageCode("０４：ジャッジ"), "04"); assert.equal(stageCode("2026年"), ""); assert.equal(stageCode("NEW"), "");
assert.equal(stageOf("NEW").code, "01"); assert.equal(stageOf("リサイクル").code, "89"); assert.equal(stageOf("担当者未接触").code, "02"); assert.equal(stageOf("Qualified"), null);
console.log("mcstage OK");

// 表記ゆれ → 7つ（2026-11-24 の SF の値すべて）
import { normCode, autoStage } from "../server/mcstage.js";
const want = { "NEW": "01", "アーカイブ": "99", "LS:89　リサイクル": "89", "リサイクル": "89", "担当者未接触": "02", "コネクト情報獲得": "03", "99：アーカイブ": "99", "ジャッジ": "04",
  "Qualified": "03", "89リサイクル": "89", "潜在顧客": "01", "99アーカイブ": "99", "04ジャッジ": "04", "89：リサイクル": "89", "02：担当者未接触": "02", "LS:01　New": "01",
  "03：コネクト情報獲得": "03", "01：新規": "01", "04：ジャッジ": "04", "LS:02　アプローチ済": "02", "05：コンバート": "05", "よく分からない値": null, "": null };
for (const [v, c] of Object.entries(want)) assert.equal(normCode(v), c, v);
// 架電のあとの自動の変更：進めるだけ・99 は触らない・89 は最初から
const A = (reach, outcome, cur) => autoStage({ reach, outcome }, cur);
assert.equal(A("none", "no_answer", "01：新規"), "02");
assert.equal(A("none", "no_answer", "NEW"), "02");
assert.equal(A("none", "no_answer", ""), "02");
assert.equal(A("gate", "blocked", "02：担当者未接触"), null);
assert.equal(A("person", "follow", "02：担当者未接触"), "03");
assert.equal(A("person", "doc_send", "01：新規"), "03");
assert.equal(A("person", "reject", "03：コネクト情報獲得"), "04");
assert.equal(A("person", "apo", "04：ジャッジ"), "05");
assert.equal(A("person", "follow", "04：ジャッジ"), null);       // 戻さない
assert.equal(A("gate", "absent", "04：ジャッジ"), null);
assert.equal(A("person", "reject", "99：アーカイブ"), null);     // アーカイブは触らない
assert.equal(A("gate", "absent", "LS:89　リサイクル"), "02");    // リサイクルからまたかけ始めた
assert.equal(A("person", "apo", "05：コンバート"), null);
assert.equal(A("gate", "inquiry", "01：新規"), "02");
assert.equal(A("person", "inquiry", "01：新規"), "03");
assert.equal(A("none", "invalid", "01：新規"), "02");          // 番号不備でも 99 にはしない
assert.equal(A("person", "reject", "Qualified"), "04");
assert.equal(A("person", "follow", "営業中"), null);            // 決められない独自の値は触らない
console.log("mcstage 表記ゆれ・自動の変更 OK");
