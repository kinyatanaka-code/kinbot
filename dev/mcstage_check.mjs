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
