// kinbot for MOCHICA のダッシュボード：インターン生のコールの「実通話時間」と「コールからコールまでの間隔」（2026-11-19 福井）
//
// なぜ作ったか：
//   コール数や率は「結果」を見ている。ここは「手の動き」を見る：1本の通話が実際に何分話したか（実通話時間）と、
//   1本終えてから次を掛けるまでに何分空いたか。率が同じでも、間隔が2分の日と6分の日では1日のコール数が3倍違う。
//   「今日はうまくいっていない」が、話の中身の問題なのか、手が止まっていたのかを分けて見るため。
//
// 元データは Zoom Phone の通話履歴（開始時刻・通話秒・応答の有無・相手の番号）。
//   通話の長さは架電画面の記録には無いので、記録（mc_call_logs）ではなくこちらを使う。
//   だから「コール数」もここでは Zoom の発信数（記録した架電数とは別。差は画面の「架電の記録率」で見える）。
//
// 数え方は ASUMO の lib/dial-interval.ts（テレアポ分析の「発信から発信までの間隔」）の規則に合わせる：
//   - 担当者をまたぐ間隔・日（JST）をまたぐ間隔は数えない（昨日の最後→今朝の最初は「待ち時間」ではない）
//   - 同じ番号へ RE_PRESS_SEC 秒以内に掛け直したものは、1本の架電の中の操作として間隔から外す（rePress として別に数える）
//   - 代表値は中央値。BREAK_MIN 分より空いたものは「休憩・離席」として平均・中央値から外し、breaks として別に数える
//     （昼休み・会議で1回空くだけで平均が倍になり、「テンポが落ちた」のか「休憩を挟んだ」のか読めなくなる）
//
// 間隔は2つ出す（どちらも同じ並びの隣り合う2本から作る）：
//   endGaps   … 前の通話が終わってから次の発信まで（手が空いていた時間＝掛け直しの速さ）
//   startGaps … 前の発信から次の発信まで（1時間に何本掛けられるかのペース。通話の長さを含む）
//
// DB も通信も使わない純粋な関数だけにして、node で直接試せるようにしている（mchot.js・mcdashlog.js と同じ作り）。

export const BREAK_MIN = 30;     // これより空いたら休憩・離席（ASUMO の BREAK_MIN と同じ）
export const RE_PRESS_SEC = 20;  // 同じ番号へこの秒数以内の掛け直しは、間隔として数えない

// rows：{ o:担当者（Zoom の表示名）, n:相手の番号, s:通話秒, a:応答あり(1/0), t:発信の開始時刻（UNIX秒。無ければ0）, d:日（JST の YYYY-MM-DD） }
// 返す：{ byOwnerDay:{ 担当者:{ 日:{ calls, answered, talkSec, endGaps:[秒…], startGaps:[秒…], rePress } } } }
export function paceRows(rows) {
  const by = {};
  const bucket = (o, d) => ((by[o] = by[o] || {})[d] = by[o][d] || { calls: 0, answered: 0, talkSec: 0, endGaps: [], startGaps: [], rePress: 0 });
  // 担当者×日ごとに、発信の開始時刻の順に並べる（取り込みの順は当てにしない）
  const groups = new Map();
  for (const r of rows) {
    const b = bucket(r.o, r.d);
    b.calls++;
    // 実通話時間は「応答があった通話」の秒数だけ。応答なし・キャンセルの秒数（呼び出し音など）は通話ではない
    if (r.a && r.s > 0) { b.answered++; b.talkSec += r.s; }
    if (!r.t) continue;   // 開始時刻が分からない行は、本数と通話時間には入れるが間隔は作れない
    const k = r.o + "\t" + r.d; const g = groups.get(k) || []; g.push(r); groups.set(k, g);
  }
  for (const g of groups.values()) {
    g.sort((x, y) => x.t - y.t);
    for (let i = 1; i < g.length; i++) {
      const prev = g[i - 1], cur = g[i];
      const b = bucket(cur.o, cur.d);
      const start = cur.t - prev.t;
      // 同じ番号へ立て続けに掛け直した＝発信の失敗の押し直し。間隔ではなく押し直しとして数える
      if (prev.n && prev.n === cur.n && start <= RE_PRESS_SEC) { b.rePress++; continue; }
      // 通話が終わる前に次を発信した（重なり）は、間隔 0 とする（負の間隔は作らない）
      const end = Math.max(0, cur.t - (prev.t + (prev.a ? prev.s : 0)));
      b.endGaps.push(end);
      b.startGaps.push(start);
    }
  }
  return { byOwnerDay: by };
}

// 画面用の要約（画面と同じ計算をサーバー側のテストでも使えるように、ここに置く）
//   people：担当者名の配列、from/to：日の範囲（両端を含む）、byOwnerDay：paceRows の結果
export function summarizePace(byOwnerDay, people, from, to) {
  const o = { calls: 0, answered: 0, talkSec: 0, endGaps: [], startGaps: [], rePress: 0 };
  for (const p of people) for (const [d, v] of Object.entries((byOwnerDay || {})[p] || {})) {
    if (d < from || d > to) continue;
    o.calls += v.calls; o.answered += v.answered; o.talkSec += v.talkSec; o.rePress += v.rePress;
    o.endGaps.push(...v.endGaps); o.startGaps.push(...v.startGaps);
  }
  const br = BREAK_MIN * 60;
  const work = (a) => a.filter((x) => x <= br);
  const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const median = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const ew = work(o.endGaps), sw = work(o.startGaps);
  return {
    calls: o.calls, answered: o.answered, talkSec: o.talkSec, rePress: o.rePress,
    avgTalk: o.answered ? o.talkSec / o.answered : null,           // 応答した通話1本あたりの実通話時間（秒）
    talkPerCall: o.calls ? o.talkSec / o.calls : null,             // 発信1本あたり（応答しなかった発信も分母に入れる）
    endMedian: median(ew), endMean: mean(ew),                       // 前の通話の終わり→次の発信（秒）
    startMedian: median(sw), startMean: mean(sw),                   // 前の発信→次の発信（秒）
    gaps: ew.length, breaks: o.endGaps.length - ew.length,          // 数えた間隔の数／休憩・離席の回数
  };
}
