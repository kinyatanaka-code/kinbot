// コール数のペース（2026-11-26 福井さん「各メンバーのコール数を徹底できるように。コールとコールの間隔は2分以内、
//   1時間あたり17コール。毎時間のコール数の進み具合をレポートから分かるように」）。
//
// 数え方（ここに集めておくと、画面・レポート・管理者への Chat の数字がずれない）：
//   コール＝MOCHICALL で記録した架電（取り消した記録は数えない）。
//   間隔　＝前の記録を保存してから、次の「かける」を押すまで。
//           通話している時間を入れると、ちゃんと話した人ほど2分を超えてしまうので、通話の外の「手が止まっている時間」だけを測る。
//           日（日本時間）をまたぐ間隔・30分より空いたもの（休憩）は数えない。「かける」を押さずに記録したもの（折り返しの着信など）も数えない。
//   時間ごと＝日本時間の時計の時（14時台＝14:00〜14:59）で区切る。
//           その日の最初と最後の時（途中から始めた・途中で終えた時）は、17に届いたかの割合から外す（短い時を「届かなかった」と数えないため）。
// AI・有料の API は使わない。数字を変えるときは PACE だけを直す。
export const PACE = {
  perHour: 17,          // 1時間あたりの目標コール数
  gapSec: 120,          // 記録から次の発信までの目安（2分）
  breakSec: 30 * 60,    // これより空いたら休憩として数えない
  alertStreak: 3,       // 2分超えが何回続いたら管理者に知らせるか
  alertEveryMin: 60,    // 同じ人の知らせは、この分数に1回まで
};

// 記録の間隔（秒）を、数えるもの・2分以内・2分超え・休憩に分ける。null（発信を押していない）は数えない
export function gapStats(gaps) {
  const ok = [], over = []; let breaks = 0;
  for (const g of gaps) {
    if (g == null || !Number.isFinite(g) || g < 0) continue;
    if (g > PACE.breakSec) { breaks++; continue; }
    (g <= PACE.gapSec ? ok : over).push(g);
  }
  const all = [...ok, ...over].sort((a, b) => a - b);
  const med = all.length ? (all.length % 2 ? all[(all.length - 1) / 2] : (all[all.length / 2 - 1] + all[all.length / 2]) / 2) : null;
  return { n: all.length, ok: ok.length, over: over.length, breaks, med: med == null ? null : Math.round(med) };
}

// 人（または日）1行ぶんの「時ごとのコール数」から、17に届いたかの割合を出す。
//   cells：{ day:"YYYY-MM-DD", h:時, n:コール数 } の配列（同じ人のもの）
//   その日の最初と最後の時は割合の分母から外す。1日に1つか2つの時しか動いていない日は、外すと残らないのでそのまま数える
export function hourStats(cells) {
  const byDay = new Map();
  for (const c of cells) { if (!c || !(c.n > 0)) continue; if (!byDay.has(c.day)) byDay.set(c.day, []); byDay.get(c.day).push(c); }
  let hours = 0, calls = 0, full = 0, hit = 0;
  for (const arr of byDay.values()) {
    arr.sort((a, b) => a.h - b.h);
    const lo = arr[0].h, hi = arr[arr.length - 1].h;
    for (const c of arr) {
      hours++; calls += c.n;
      const edge = arr.length > 2 && (c.h === lo || c.h === hi);
      if (edge) continue;
      full++; if (c.n >= PACE.perHour) hit++;
    }
  }
  return { hours, calls, perHour: hours ? Math.round(calls / hours * 10) / 10 : null, full, hit };
}

// 直近の間隔が「2分超え」で何回続いているか（新しい順に並べた間隔で数える。休憩・数えないもので止める）
export function overStreak(gapsNewestFirst) {
  let n = 0;
  for (const g of gapsNewestFirst) {
    if (g == null || !Number.isFinite(g) || g < 0 || g > PACE.breakSec) break;
    if (g <= PACE.gapSec) break;
    n++;
  }
  return n;
}

// 秒を「m:ss」に（画面・Chat で同じ書き方にする）
export function mmss(sec) {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
