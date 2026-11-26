// server/mcpace.js の数え方の確かめ（node dev/mcpace_check.mjs）
import assert from "node:assert/strict";
import { PACE, gapStats, hourStats, overStreak, mmss } from "../server/mcpace.js";

// 間隔：null・負は数えない、30分超えは休憩、2分ちょうどは「以内」
const g = gapStats([30, 120, 121, 300, null, -5, PACE.breakSec + 1]);
assert.deepEqual(g, { n: 4, ok: 2, over: 2, breaks: 1, med: 121 });   // 中央値は (120+121)/2=120.5 → 121
assert.equal(gapStats([]).med, null);

// 時ごと：1日に3つ以上の時があれば最初と最後は割合から外す
const h = hourStats([
  { day: "2026-11-26", h: 10, n: 5 }, { day: "2026-11-26", h: 11, n: 17 }, { day: "2026-11-26", h: 12, n: 12 }, { day: "2026-11-26", h: 13, n: 6 },
  { day: "2026-11-25", h: 14, n: 18 }, { day: "2026-11-25", h: 15, n: 3 },   // 2つしかない日はそのまま数える
]);
assert.deepEqual(h, { hours: 6, calls: 61, perHour: 10.2, full: 4, hit: 2 });

// 2分超えの続き：新しい順。2分以内・休憩で止める
assert.equal(overStreak([200, 150, 130, 60, 300]), 3);
assert.equal(overStreak([200, PACE.breakSec + 10, 300]), 1);
assert.equal(overStreak([null, 300]), 0);

assert.equal(mmss(125), "2:05"); assert.equal(mmss(null), "—");
console.log("mcpace OK");
