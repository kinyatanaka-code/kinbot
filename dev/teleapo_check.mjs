// テレアポ科学モデル v1 の確かめ（2026-11-16）
// 使い方：node dev/teleapo_check.mjs <注釈.jsonl> <sample_index.json>
//   注釈：アポの再現性検証（2026-11-06）の out_seed_study.jsonl と同じ形
//   sample_index：通話ごとの appo（本当にアポになったか）・period（train/test）・w（重み）・dur・call_type
// 見ること：①モデルの見込み（pActual）がアポを見分けられるか（重み付き AUC）②問題の場所の分かれ方 ③K1〜K6
import fs from "node:fs";
import { diagnoseCall, aggregate, pActualOf } from "../server/teleapo_science.js";

const [annPath, idxPath] = process.argv.slice(2);
if (!annPath || !idxPath) { console.error("使い方：node dev/teleapo_check.mjs <注釈.jsonl> <sample_index.json>"); process.exit(1); }
const anns = fs.readFileSync(annPath, "utf8").split(/\n/).filter(Boolean).map((l) => JSON.parse(l));
const idx = JSON.parse(fs.readFileSync(idxPath, "utf8")).index;
const byKey = Object.fromEntries(idx.map((x) => [x.key, x]));
// call_type は文字化けして入っていることがあるので、値の種類ごとに長さで見分ける（再アプローチ＝長い、新規＝短い）
const kinds = [...new Set(idx.map((x) => x.call_type))].sort((a, b) => String(b).length - String(a).length);
const ctOf = (v) => (/再|新規/.test(v) ? v : kinds.length === 2 ? (v === kinds[0] ? "再アプローチ" : "新規") : "不明");

const rows = anns.map((a) => ({ a, s: byKey[a.key] })).filter((r) => r.s);
function wauc(xs) {
  const pos = xs.filter((r) => r.y), neg = xs.filter((r) => !r.y);
  let num = 0, den = 0;
  for (const p of pos) for (const n of neg) { const w = p.w * n.w; den += w; num += w * (p.p > n.p ? 1 : p.p === n.p ? 0.5 : 0); }
  return den ? Math.round((num / den) * 1000) / 1000 : null;
}
const out = { rows: rows.length };
for (const period of ["train", "test", "all"]) {
  const xs = rows.filter((r) => period === "all" || r.s.period === period).map((r) => {
    const meta = { callType: ctOf(r.s.call_type), durationSec: r.s.dur };
    // 「通話の中でアポが決まった」の欄を使うと答えを見てしまうので、外して見込みを出す
    const a2 = { ...r.a, appo_in_call: false };
    return { y: !!r.s.appo, w: r.s.w || 1, p: pActualOf(a2, meta.callType, (r.s.dur || 0) >= 120), pAsk: r.a.asked ? 1 : 0 };
  });
  out[period] = { n: xs.length, appo: xs.filter((x) => x.y).length, auc_model: wauc(xs), auc_askOnly: wauc(xs.map((x) => ({ ...x, p: x.pAsk }))) };
}
// 問題の場所（アポにならなかった通話だけ）
const items = rows.map((r) => ({ annotation: r.a, meta: { callType: ctOf(r.s.call_type), durationSec: r.s.dur, reach: r.a.contact_ok ? "person" : "gate" } }));
const nonAppo = items.filter((it, i) => !rows[i].s.appo);
const agg = aggregate(nonAppo);
out.problemPoints_nonAppo = agg.points.map((p) => ({ 場所: p.label, 通話: p.calls, 失ったアポ: p.lostAppo, 割引後: p.weighted, 根拠: p.evidence }));
const aggAll = aggregate(items);
out.kpis_all = aggAll.kpis.map((k) => `${k.id} ${k.value ?? "-"}（${k.x}/${k.n}）${k.status}`);
// アポになった通話でも「問題の場所」が出るか（出すぎていれば厳しすぎる）
const appoItems = items.filter((it, i) => rows[i].s.appo);
out.appoCalls_withLoss = appoItems.filter((it) => (diagnoseCall({ ...it.annotation }, it.meta).findings || []).some((f) => (f.lostAppo || 0) > 0)).length + "/" + appoItems.length;
console.log(JSON.stringify(out, null, 1));
