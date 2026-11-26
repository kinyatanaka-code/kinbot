// kinbot for MOCHICA：BALES でかけた結果を MOCHICALL の「かける」の順番に入れる（2026-11-25 福井さん「BALES架電履歴の更新を追跡してリストの優先度に反映」）
//
// なぜ作ったか：
//   BALES の見張り（拡張機能が平日10〜19時に10分ごと、最終架電の新しい順に読む）で、だれがいつどこへかけたかは kinbot に入っていた。
//   ところが今日かけるリスト・MOCHICALL の「かける」の順番は、リストを丸ごと取り込んだ時点の中身だけで決めていたので、
//   取り込んだあとに BALES でかけた会社（アポ・お断り・不在・次回の予約）が、その日のうちは順番に出てこなかった（二重にかける・不在の掛け直しが漏れる）。
//
// 決まり（2026-11-25 福井さんが「結果ごとに動かす」を選んだ）：
//   ・アポ獲得・お断り … 今日の「かける」から外す（終わりにする）
//   ・BALES に次回アクションの予約がある … その日時に掛け直す（人が決めた約束として、自動の掛け直しより先に並べる）
//   ・不在・受付で止まった・話し中など … 同じ日の2時間後に掛け直す。今日の時間に収まらなければ、今までの掛け直しの型（nextMissAt）にまかせる
//   ・それ以外（担当者と話せた・資料送付など） … 今日はもうかけない（翌営業日の朝から並びに戻す）
//   BALES は読むだけ（正本は BALES と SF。MOCHICA ルール3）。
//
// DB も通信も使わない純粋な関数だけにして、node で直接試せるようにしている（mccadence.js と同じ作り）。
import { CADENCE, WHY_HUMAN, jstAt, jstHour, nextWeekday, nextMissAt } from "./mccadence.js";

// 見張りの行（BALES のリード一覧の1行）から MOCHICALL の行に写す項目（架電で変わるものだけ。所有者などは写さない）
export const CALL_KEYS = ["lastCalledAt", "lastCalledComment", "callResult", "lastActivityAt", "lastActivityTypeText", "lastActivityComment", "lastLeadStageName"];
export const NEXT_RE = /^nextActions\.\d+\.(?:reservedAt|isDone|id|[A-Za-z]+(?:\.[A-Za-z]+)?)$/;
// 古すぎる架電は写さない（初めて動いたときに、何か月も前の架電で並びを動かさないため）
export const MAX_AGE_H = 24;
// 不在のあと同じ日に掛け直すまでの時間
export const SAME_DAY_GAP_H = 2;

//   受付ブロック（受付NG・受付拒否）もお断りと同じく終わり（2026-11-26 福井さん）。下の MISS_RE の「受付」より先に見るので、自動の掛け直しにならない
const FINAL_RE = /アポ獲得|お断り|受付(?:ブロック|NG|ＮＧ|拒否)/;
// 担当者に届かなかった結果（BALES の結果の言葉）
const MISS_RE = /不在|留守|話し中|つながらず|繋がらず|不通|受付|外出|会議中|休み|折り返し待ち|応答なし|出ない/;

// 見張りの行の項目を、MOCHICALL の行に写す分だけにする。
//   次回アクションは丸ごと入れ替える：見張りの行に1つでもあるとき、または見張りの行がリード一覧の1行まるごと（会社名がある）とき。
//   1行まるごとで次回アクションが無い＝BALES で予約が無くなった（済んだ・消した）ので、取り込んだときの古い予約を残さない
//   （残すと、済んだ予約を「約束の掛け直し」として先頭に出してしまう）。一部の項目だけの行なら前のまま
export function pickCallFields(d = {}) {
  const out = {};
  for (const k of CALL_KEYS) if (d[k] != null && d[k] !== "") out[k] = d[k];
  const na = Object.keys(d).filter((k) => NEXT_RE.test(k));
  for (const k of na) out[k] = d[k];
  return { set: out, hasNext: na.length > 0 || (d.companyName != null && d.companyName !== "") };
}

const str = (v) => (v == null ? "" : String(v).trim());

/** BALES のフラットな行オブジェクトから次回アクション配列を取り出す */
export function nextActionsOf(d = {}) {
  if (!d || typeof d !== "object") return [];
  const byIdx = new Map();
  for (const [k, v] of Object.entries(d)) {
    const m = /^nextActions\.(\d+)\.(.+)$/.exec(k);
    if (!m) continue;
    const idx = Number(m[1]);
    if (!byIdx.has(idx)) byIdx.set(idx, { idx });
    byIdx.get(idx)[m[2]] = v;
  }
  const items = [];
  for (const [, raw] of [...byIdx.entries()].sort((a, b) => a[0] - b[0])) {
    const reservedAt = str(raw.reservedAt);
    const parsed = reservedAt ? Date.parse(reservedAt) : NaN;
    items.push({
      idx: raw.idx,
      id: raw.id ?? null,
      reservedAt,
      t: Number.isFinite(parsed) ? parsed : null,
      isDone: String(raw.isDone) === "true",
      name: str(raw.name) || str(raw["actionType.name"]) || str(raw.actionTypeName),
      comment: str(raw.content) || str(raw.comment) || str(raw.memo) || str(raw.note) || str(raw.body) || str(raw.text),
      owner: str(raw["owner.name"]) || str(raw.ownerName) || str(raw["user.name"]) || str(raw.userName),
      createdAt: str(raw.createdAt)
    });
  }
  return items;
}

/** 終わっていない次回アクションのうち最も早い予約（予約日時がなければコメント付き先頭）を返す */
export function pickNextAction(d = {}) {
  const open = nextActionsOf(d).filter((x) => !x.isDone);
  if (!open.length) return null;
  const timed = open.filter((x) => x.t != null).sort((a, b) => a.t - b.t);
  if (timed.length) return timed[0];
  return open.find((x) => x.comment || x.name) || open[0];
}

// 次回アクションのうち、終わっていなくていちばん早い予約（ミリ秒）。無ければ null
export function nextReserved(d = {}) {
  let t = null;
  for (const x of nextActionsOf(d)) {
    if (x.isDone || x.t == null) continue;
    if (t == null || x.t < t) t = x.t;
  }
  return t;
}

// BALES の1回の架電から、MOCHICALL のリードをどうするか決める
//   d：BALES の行（lastCalledAt・callResult・nextActions.*）／lead：{ last_at, miss_streak, gate }
//   戻り値：null＝何もしない／{ kind, done, nextAt, why, streak }
export function planFromBales(d = {}, lead = {}, { now = new Date(), rates = null } = {}) {
  const at = Date.parse(d.lastCalledAt || "");
  if (!Number.isFinite(at)) return null;
  if (now.getTime() - at > MAX_AGE_H * 3600e3) return null;
  // MOCHICALL で同じ時刻以降に記録している（＝MOCHICALL でかけた・もっと新しい記録がある）なら、MOCHICALL の記録を正にする
  const last = lead.last_at ? new Date(lead.last_at).getTime() : 0;
  if (last && last >= at - 5 * 60e3) return null;
  const result = String(d.callResult || "").trim();
  const hm = new Date(at + 9 * 3600e3).toISOString().slice(11, 16);
  const tag = `BALESで${hm}に架電（${result || "結果なし"}）`;
  const streak0 = Number(lead.miss_streak) || 0;
  if (FINAL_RE.test(result)) return { kind: "final", done: true, nextAt: null, why: `${tag}なので終わり`, streak: streak0 };
  const res = nextReserved(d);
  if (res != null && res > at) {
    const nx = pickNextAction(d);
    const cmt = nx?.comment ? `（${nx.comment.slice(0, 120)}）` : "";
    return { kind: "promise", done: false, nextAt: new Date(res), why: WHY_HUMAN, note: `${tag}・BALES の次回アクションの予約${cmt}`, streak: MISS_RE.test(result) ? streak0 + 1 : 0 };
  }
  if (MISS_RE.test(result)) {
    const streak = streak0 + 1;
    const r = nextMissAt({ now: new Date(at), streak, gateHours: (lead.gate && lead.gate.hours) || "", rates });
    if (r.parked) return { kind: "miss", done: false, nextAt: r.at, why: `${tag}・${r.why}`, streak: 0, parked: true };
    const soon = new Date(at + SAME_DAY_GAP_H * 3600e3);
    const sameDay = new Date(soon.getTime() + 9 * 3600e3).toISOString().slice(0, 10) === new Date(at + 9 * 3600e3).toISOString().slice(0, 10);
    if (sameDay && jstHour(soon) <= CADENCE.lastHour) return { kind: "miss", done: false, nextAt: soon, why: `${tag}・同じ日の${SAME_DAY_GAP_H}時間後に掛け直し`, streak };
    return { kind: "miss", done: false, nextAt: r.at, why: `${tag}・${r.why}`, streak };
  }
  // 担当者と話せた・資料送付など：今日はもうかけない（翌営業日の朝から並びに戻す）
  return { kind: "other", done: false, nextAt: jstAt(nextWeekday(new Date(at)), 10, 0), why: `${tag}・今日はもうかけない`, streak: /担当者|接続|資料|ジャッジ|フォロー/.test(result) ? 0 : streak0 };
}
