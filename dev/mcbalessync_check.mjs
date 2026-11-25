// BALES の架電結果 → MOCHICALL の順番の決まり（server/mcbalessync.js）を手元で確かめる
import assert from "node:assert/strict";
import { planFromBales, pickCallFields, nextReserved } from "../server/mcbalessync.js";
import { balesCarry } from "../server/mcseg.js";
import { balesItems } from "../server/mchist.js";
const now = new Date("2026-11-25T14:00:00+09:00");
const at = (s) => `2026-11-25T${s}:00+09:00`;
const jst = (d) => new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 16);
// アポ・お断り → 終わり
assert.equal(planFromBales({ lastCalledAt: at("13:00"), callResult: "アポ獲得" }, {}, { now }).done, true);
assert.equal(planFromBales({ lastCalledAt: at("13:00"), callResult: "担当者お断り" }, {}, { now }).kind, "final");
// 不在 → 同じ日の2時間後、回数+1
let p = planFromBales({ lastCalledAt: at("13:00"), callResult: "担当者不在" }, { miss_streak: 2 }, { now });
assert.equal(jst(p.nextAt), "2026-11-25T15:00"); assert.equal(p.streak, 3);
// 夕方の不在 → 今日に収まらないので翌営業日以降（掛け直しの型）
p = planFromBales({ lastCalledAt: at("16:30"), callResult: "不在" }, {}, { now: new Date(at("17:00")) });
assert.ok(jst(p.nextAt) > "2026-11-26T00:00", jst(p.nextAt));
// 次回アクションの予約 → その日時に約束の掛け直し
p = planFromBales({ lastCalledAt: at("13:00"), callResult: "担当者接続", "nextActions.0.id": "x", "nextActions.0.reservedAt": "2026-11-27T11:00:00+09:00", "nextActions.0.isDone": "false" }, {}, { now });
assert.equal(p.kind, "promise"); assert.equal(jst(p.nextAt), "2026-11-27T11:00");
// 終わった予約は見ない
assert.equal(nextReserved({ "nextActions.0.id": "x", "nextActions.0.reservedAt": at("15:00"), "nextActions.0.isDone": "true" }), null);
// 話せた → 今日はもうかけない（翌営業日10時）。水曜→木曜
p = planFromBales({ lastCalledAt: at("13:00"), callResult: "担当者接続" }, {}, { now });
assert.equal(jst(p.nextAt), "2026-11-26T10:00");
// MOCHICALL の記録のほうが新しい・24時間より前・日時なし → 何もしない
assert.equal(planFromBales({ lastCalledAt: at("13:00"), callResult: "不在" }, { last_at: at("13:02") }, { now }), null);
assert.equal(planFromBales({ lastCalledAt: "2026-11-23T13:00:00+09:00", callResult: "不在" }, {}, { now }), null);
assert.equal(planFromBales({ callResult: "不在" }, {}, { now }), null);
// 写す項目：所有者は写さない・次回アクションのコメントや担当も写す・次回アクションがあれば入れ替え
const f = pickCallFields({ lastCalledAt: at("13:00"), lastCalledComment: "受付突破", callResult: "不在", operatorName: "山田", "nextActions.0.reservedAt": at("15:00"), "nextActions.0.content": "午後イチで再架電", "nextActions.0.owner.name": "佐藤" });
assert.deepEqual(Object.keys(f.set).sort(), ["callResult", "lastCalledAt", "lastCalledComment", "nextActions.0.content", "nextActions.0.owner.name", "nextActions.0.reservedAt"]); assert.equal(f.hasNext, true);
// 次回アクションのコメント：planFromBales / balesCarry / balesItems に引き継がれる
p = planFromBales({ lastCalledAt: at("13:00"), callResult: "担当者接続", "nextActions.0.id": "x", "nextActions.0.reservedAt": "2026-11-27T11:00:00+09:00", "nextActions.0.isDone": "false", "nextActions.0.content": "来週月曜に見積提示" }, {}, { now });
assert.equal(p.why, "記録した人が決めた時刻"); assert.ok(p.note.includes("来週月曜に見積提示"));
const c = balesCarry({ "nextActions.0.id": "x", "nextActions.0.reservedAt": "2026-11-27T11:00:00+09:00", "nextActions.0.isDone": "false", "nextActions.0.name": "再架電", "nextActions.0.content": "代表不在のため折返し", "nextActions.0.owner.name": "佐藤", callResultsCount: "3" });
assert.equal(c.next_comment, "代表不在のため折返し"); assert.equal(c.next_name, "再架電"); assert.equal(c.next_owner, "佐藤"); assert.equal(c.attempts, 3);
const cNoDate = balesCarry({ "nextActions.0.content": "日時未定メモ", "nextActions.0.isDone": "false" });
assert.equal(cNoDate.next_at, null); assert.equal(cNoDate.next_comment, "日時未定メモ");
const tl = balesItems(null, { lastActivityAt: at("13:00"), lastCalledComment: "一次窓口対応", "nextActions.0.reservedAt": "2026-11-27T11:00:00+09:00", "nextActions.0.isDone": "false", "nextActions.0.name": "フォロー", "nextActions.0.content": "担当者へ資料確認" });
assert.ok(tl.some((x) => x.text === "担当者へ資料確認" && x.title.includes("次回アクション")));
assert.ok(tl.some((x) => x.text === "一次窓口対応"));
console.log("mcbalessync OK");
