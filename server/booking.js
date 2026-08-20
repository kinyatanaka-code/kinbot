// ───────────────────────────────────────────────────────────
// booking.js — 日程調整ページの「空いている時間」を出す
//
// 担当者のカレンダーを見て、お出しできる時間だけを並べます。
// ・平日のみ／指定した時間帯のみ
// ・すでに予定が入っている時間は外す
// ・今から2時間より先だけ（直前の予約を防ぐ）
// ───────────────────────────────────────────────────────────

// 日本時間で組み立てる（見る人の時差に左右されないため）
const JST = 9 * 3600 * 1000;

function jstParts(ms) {
  const d = new Date(ms + JST);
  return {
    y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate(),
    h: d.getUTCHours(), mi: d.getUTCMinutes(), w: d.getUTCDay(),
  };
}

function jstTime(y, m, d, h, mi = 0) {
  return Date.UTC(y, m, d, h, mi) - JST;
}

// 空いている時間を並べる。
//   busy … [{ start, end }]（カレンダーの予定。ISO文字列）
export function buildSlots({ minutes = 30, daysAhead = 14, fromHour = 10, toHour = 19, busy = [], now = Date.now() }) {
  const step = Math.max(15, Math.min(180, Number(minutes) || 30));
  const days = Math.max(1, Math.min(60, Number(daysAhead) || 14));
  // 直前は選べないようにする（2時間後から）
  const earliest = now + 2 * 3600 * 1000;

  const blocks = (busy || [])
    .map((b) => ({ s: new Date(b.start).getTime(), e: new Date(b.end).getTime() }))
    .filter((b) => Number.isFinite(b.s) && Number.isFinite(b.e));

  const isFree = (s, e) => !blocks.some((b) => s < b.e && e > b.s);

  const out = [];
  const base = jstParts(now);
  for (let i = 0; i <= days; i++) {
    const day = jstParts(jstTime(base.y, base.m, base.d + i, 12));
    if (day.w === 0 || day.w === 6) continue;   // 土日は出さない

    const slots = [];
    for (let h = fromHour; h < toHour; h++) {
      for (let mi = 0; mi < 60; mi += step) {
        const s = jstTime(day.y, day.m, day.d, h, mi);
        const e = s + step * 60 * 1000;
        // その日の終わりを越えるものは出さない
        if (jstParts(e).h > toHour || (jstParts(e).h === toHour && jstParts(e).mi > 0)) continue;
        if (s < earliest) continue;
        if (!isFree(s, e)) continue;
        slots.push({ at: new Date(s).toISOString(), 表示: `${String(jstParts(s).h).padStart(2, "0")}:${String(jstParts(s).mi).padStart(2, "0")}` });
      }
    }
    if (!slots.length) continue;
    const w = "日月火水木金土"[day.w];
    out.push({
      日: `${day.y}-${String(day.m + 1).padStart(2, "0")}-${String(day.d).padStart(2, "0")}`,
      表示: `${day.m + 1}月${day.d}日(${w})`,
      slots: slots.slice(0, 24),
    });
    if (out.length >= 10) break;   // 多すぎると選べないので10日ぶんまで
  }
  return out;
}

// 選ばれた時間が、まだ空いているかを確かめる
export function stillFree(at, minutes, busy = []) {
  const s = new Date(at).getTime();
  if (!Number.isFinite(s)) return false;
  const e = s + Math.max(15, Number(minutes) || 30) * 60 * 1000;
  if (s < Date.now()) return false;
  return !(busy || []).some((b) => {
    const bs = new Date(b.start).getTime(), be = new Date(b.end).getTime();
    return s < be && e > bs;
  });
}
