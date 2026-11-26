// サーバーが重いときに「何が止めているか」を見るための見張り（2026-11-26 田中さん「kinbot・kinXs・kincall がめちゃくちゃ重たくなっている」）
//   ・決まった時間に動く処理（setInterval・1秒以上あとの setTimeout）の1回ごとの時間を測り、長かったものを覚える
//   ・サーバー全体の止まり（イベントループの遅れ）を測る
//   中身は /api/debug/slow で見る。値は覚えるだけで、動きは変えない
import { monitorEventLoopDelay } from "node:perf_hooks";
import { promisify } from "node:util";

const slow = new Map();   // 名前 -> { n, total, max, at }
let lastLabel = "";
export function slowLabel(l) { lastLabel = l; }
function note(label, ms) {
  const s = slow.get(label) || { n: 0, total: 0, max: 0, at: "" };
  s.n++; s.total += ms; if (ms > s.max) { s.max = ms; s.at = new Date().toISOString(); }
  slow.set(label, s);
}
function labelOf(fn, err) {
  const name = fn && fn.name ? fn.name : "";
  const st = String((err && err.stack) || "").split("\n").slice(2, 5).map((l) => l.trim().replace(/^at\s+/, "").replace(/\(?file:\/\/\/[^)]*\/server\//, "").replace(/\)$/, "")).join(" < ");
  return `${name || "(無名)"} @ ${st}`.slice(0, 220);
}
function wrap(fn, label) {
  return function (...a) {
    const t = performance.now(); const prev = lastLabel; lastLabel = label;
    try { return fn.apply(this, a); }
    finally { const ms = performance.now() - t; if (ms > 50) note(label, ms); lastLabel = prev; }
  };
}
const _si = globalThis.setInterval, _st = globalThis.setTimeout;
globalThis.setInterval = function (fn, ms, ...a) { if (typeof fn !== "function") return _si(fn, ms, ...a); return _si(wrap(fn, "interval " + labelOf(fn, new Error())), ms, ...a); };
globalThis.setTimeout = function (fn, ms, ...a) { if (typeof fn !== "function" || !(ms >= 1000)) return _st(fn, ms, ...a); return _st(wrap(fn, "timeout " + labelOf(fn, new Error())), ms, ...a); };

// util.promisify(setTimeout) が今までどおり使えるように
try { if (_st[promisify.custom]) globalThis.setTimeout[promisify.custom] = _st[promisify.custom]; } catch {}

// 止まりを測る：50ms ごとに時計を見て、遅れたぶんを数える。遅れたときに動いていた処理の名前も覚える
const h = monitorEventLoopDelay({ resolution: 20 }); h.enable();
const stalls = [];
let tick = performance.now();
_si(() => {
  const now = performance.now(); const lag = now - tick - 200; tick = now;
  if (lag > 300) { stalls.push({ at: new Date().toISOString(), lag: Math.round(lag), during: lastLabel }); if (stalls.length > 60) stalls.shift(); }
}, 200).unref?.();

export function slowReport() {
  const top = [...slow.entries()].map(([k, v]) => ({ what: k, n: v.n, avgMs: Math.round(v.total / v.n), maxMs: Math.round(v.max), totalMs: Math.round(v.total), maxAt: v.at }))
    .sort((a, b) => b.totalMs - a.totalMs).slice(0, 30);
  return { loopDelay: { meanMs: Math.round(h.mean / 1e6), p99Ms: Math.round(h.percentile(99) / 1e6), maxMs: Math.round(h.max / 1e6) }, stalls: stalls.slice(-30), top };
}
export function slowReset() { slow.clear(); stalls.length = 0; h.reset(); }
