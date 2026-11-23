// 架電分析（server/mccallana.js）の純関数の確かめ。node dev/mccallana_check.mjs
import { classifyMemo, classifyLog, matchCalls, summarize, telKey, memoBody } from "../server/mccallana.js";

let ng = 0, ok = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) ok++; else { ng++; console.log("NG", name, "\n  got ", g, "\n  want", w); }
};

// ── メモの判定（2026-11-23 の調査で実際にあった書き方）
eq("空欄", classifyMemo("").status, "空欄");
eq("不在", classifyMemo("終日不在").status, "未接続");
eq("番号行＋離席", classifyMemo("03-3470-5050\r\n離席中").status, "未接続");
eq("定型句だけ", classifyMemo("再コール。\n┗15名以上。\n┗人材リスト。").status, "未接続");
eq("受付", classifyMemo("門前払い").status, "受付ブロック");
eq("現アナ", classifyMemo("現アナ").status, "リスト不備");
eq("退職", classifyMemo("白石さん退職している").status, "担当者情報のみ");
eq("断り・理由なし", classifyMemo("いらない").reasons, ["理由の記載なし"]);
eq("断り・接続", classifyMemo("いらない").reached, true);
eq("断り・充足", classifyMemo("採用は順調なので大丈夫です").reasons, ["採用は順調・充足"]);
eq("断り・予算", classifyMemo("予算がもう割けないから話を聞いても、、、\n採用うまくいってるわけじゃないけど").status, "断り");
const deep = classifyMemo("27卒\n28卒ISやっていない\n3月始動\n採用目標20名、15~20名\n辞退は4割\n→アポ打診");
eq("深いヒアリング：項目数3以上", deep.dims.length >= 3, true);
eq("深いヒアリング：打診", deep.schedule, true);
eq("前向き", classifyMemo("導入できるかはあれだけど興味ある！\n話聞きたい！").status, "前向き");
eq("アポ取れずは前向きでない", classifyMemo("アポは取れず\n28卒は9月からインターンシップ予定").status !== "前向き", true);
eq("アポ取れずは打診でない", classifyMemo("アポは取れず").schedule, false);
eq("候補日は打診", classifyMemo("候補日を3つ出した、来週返事").schedule, true);
eq("その他＋中身＝接続", classifyMemo("28卒インターンシップやっている\n目標には届かず").reached, true);
eq("その他・中身なし＝未接続扱い", classifyMemo("17時くらいに帰ってくる").reached, false);
eq("メモの本文から番号行を落とす", memoBody("087-825-0565\r\n営外、"), "営外、");

// ── MOCHICALL の記録
eq("記録：担当者と話せた・断り", classifyLog({ reach: "person", outcome: "reject", reason: "他社を使っている", memo: "" }).reasons, ["他社・既存で足りている"]);
eq("記録：アポは打診", classifyLog({ reach: "person", outcome: "apo", memo: "" }).schedule, true);
eq("記録：聞いたことは項目", classifyLog({ reach: "person", outcome: "follow", memo: "", hearing: { when: "4月", target: 5 } }).dims.sort(), ["採用人数・実績", "時期・スケジュール"].sort());
eq("記録：受付で断られた", classifyLog({ reach: "gate", outcome: "blocked", memo: "" }).status, "受付ブロック");
eq("記録：担当者が不在は未接続", classifyLog({ reach: "gate", outcome: "absent", memo: "" }).reached, false);
eq("記録：現アナ", classifyLog({ reach: "none", outcome: "invalid", memo: "" }).status, "リスト不備");

// ── 番号の鍵
eq("+81 を 0 に", telKey("+81312345678"), "0312345678");
eq("短すぎる番号は使わない", telKey("1234"), "");

// ── 突き合わせ
const T = Date.parse("2026-10-01T10:00:00+09:00");
const calls = [
  { id: "z1", t: T, dur: 0, peer: "0312345678", ownerName: "福井聖", ok: false },          // 押し直し（0秒）
  { id: "z2", t: T + 30e3, dur: 200, peer: "0312345678", ownerName: "福井聖", ok: true },  // 本番の通話 3分20秒
  { id: "z3", t: T + 3600e3, dur: 40, peer: "0399999999", ownerName: "福井聖", ok: true },
  { id: "z4", t: T + 7200e3, dur: 90, peer: "0311112222", ownerName: "福井聖", ok: true },
];
const memos = [
  { id: "b1", t: T + 30e3 + 200e3 + 60e3, phones: ["0312345678"], who: "福井 聖", src: "bales", c: classifyMemo("27卒は終了\n28卒目標5名\n母集団が課題\n→アポ打診") },
  { id: "b2", t: T + 3600e3 + 40e3 + 45 * 60e3, phones: ["0399999999"], who: "福井 聖", src: "bales", c: classifyMemo("いらない") },   // 45分後＝窓の外
  { id: "m1", t: T + 7200e3 + 120e3, phones: ["0311112222"], who: "", src: "mochicall", c: classifyLog({ reach: "person", outcome: "reject", memo: "今は必要ない" }) },
  { id: "b3", t: T + 7200e3 + 150e3, phones: ["0311112222"], who: "福井 聖", src: "bales", c: classifyMemo("今は必要ない") },     // 同じ通話の二重の記録
];
const m = matchCalls(calls, memos);
eq("押し直しより通話成立に結ぶ", m.map((c) => c.memo && c.memo.id), [null, "b1", null, "m1"]);

// ── 集計
const rows = m.map((c) => ({ ...c, day: "2026-10-01", person: "福井" }));
const s = summarize(rows).total;
eq("発信", s.calls, 4);
eq("メモ一致", s.matched, 2);
eq("担当者接続", s.reached, 2);
eq("接続のうち2分以上", s.r2min, 1);
eq("接続のうちヒアリング", s.rHear, 1);
eq("接続のうち打診", s.rSched, 1);
eq("2分以上のうちヒアリング", s.r2Hear, 1);
eq("2分未満のうち打診", s.rU2Sched, 0);
eq("断り理由", s.reasons, { "時期が合わない": 1 });
eq("通話の長さの段", s.durBins, [0, 1, 0, 1, 0]);
eq("人別も同じ", summarize(rows).byPerson["福井"].reached, 2);

console.log(ng ? `NG ${ng}件 / OK ${ok}件` : `OK ${ok}件`);
process.exit(ng ? 1 : 0);
