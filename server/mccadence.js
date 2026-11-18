// kinbot for MOCHICA：架電の「掛け直しの設計」と「かける順番」（2026-11-19 福井さん「架電を科学的にアポが取れるものに」）
//
// なぜ作ったか：
//   これまでの掛け直しは「2時間後に何度でも」で、回数の上限も、時間帯の考えも無かった。
//   ナレッジ資料（テレアポ成功の科学的ナレッジまとめ）と MOCHICA のテレアポ科学化（探索問題・時間軸）に合わせて、次の3つを決める。
//     ① 掛け直しの型：1〜2日あけて、前回と違う時間帯に、担当者に届かないまま 8回 になったら一度休ませる
//        （資料：1リード6〜8回・間隔1〜2日が最も接触率が高い。7回を超えると接触率が落ちる。93%の成約は6回目以降のフォロー後）
//     ② 時間帯：つながりやすい時間は MOCHICA 自身の記録（担当者と話せた割合）から出す。記録が少ないうちは資料の目安で補う
//        （資料：始業直後と終業前が平均より約47%つながりやすい）
//     ③ 順番：約束の掛け直し → 時刻が来た掛け直し → ホット度・検討時期・在席時間の合う順
//   「科学的」にするため、数字の根拠と、自分たちの記録で確かめる道具（何回目の架電でアポが取れたか）を画面に出す。
//
// 根拠の強さ（MOCHICA 科学化の印）：①②の上限・間隔・始業前後の目安は資料（★★ 他社の大規模データ）。
//   ③の点の重みは経験則（★）。自分たちの記録で確かめて、合わなければ直す前提。
//
// DB も通信も使わない純粋な関数だけにして、node で直接試せるようにしている（mchot.js と同じ作り）。

// ---- 掛け直しの型（ここの数字を変えると、全員の次の掛け直しから変わる） ----
export const CADENCE = {
  maxMiss: 8,                    // 担当者に届かないまま続けて掛ける回数の上限（資料：6〜8回。8回で一度休ませる）
  gapDays: [1, 1, 1, 1, 1, 2, 2], // 次に掛けるまでの営業日（資料：1〜2日。6回目以降は少しあける）
  parkDays: 45,                  // 休ませる日数（相手の採用の時期が動くのを待って、時期を変えて再開）
  firstHour: 9, lastHour: 17,    // 掛ける時間帯（日本時間・開始の時）
  // 資料の「8〜9時と16〜17時が平均より約47%つながりやすい」を、日本の営業時間に置き換えた見立て（始業直後＝9時台、終業前＝16時台）。
  // 実測が貯まるほど実測が優先される（weight は「実測 weight 件ぶんの重み」）
  prior: { boost: { 9: 1.47, 16: 1.47 }, weight: 30 },
};
// 数字の目安（資料：B2B のコールドコール→商談化率の平均 2〜3%、上位 5〜8%）
export const BENCH = { avg: [0.02, 0.03], top: 0.05 };
// 人が決めた掛け直しの印（約束の掛け直しは、自動の掛け直しより先に並べる）
export const WHY_HUMAN = "記録した人が決めた時刻";

// ---- 日本時間の道具 ----
const JST = 9 * 3600e3;
export function jstDayStart(d = new Date()) {
  const j = new Date(d.getTime() + JST); j.setUTCHours(0, 0, 0, 0); return new Date(j.getTime() - JST);
}
export function jstAt(base, h, m) { const s = jstDayStart(base); return new Date(s.getTime() + (h * 60 + m) * 60e3); }
export function nextWeekday(d) { let x = new Date(d.getTime() + 86400e3); while ([0, 6].includes(new Date(x.getTime() + JST).getUTCDay())) x = new Date(x.getTime() + 86400e3); return x; }
export function addBizDays(d, n) { let x = d; for (let i = 0; i < n; i++) x = nextWeekday(x); return x; }
export const jstHour = (d) => new Date(new Date(d).getTime() + JST).getUTCHours();
const jstMonth = (d) => new Date(new Date(d).getTime() + JST).getUTCMonth() + 1;

// 受付で聞いた「いる時間」の言い方と、その掛け直しの時刻
const SLOT = { 午前: [10, 0], 昼: [12, 30], 午後: [14, 0], 夕方: [17, 0] };
// 時間帯の呼び名（受付で聞いた「いる時間」と同じ4つ）
export function bandOf(h) { return h < 12 ? "午前" : h < 13 ? "昼" : h < 16 ? "午後" : "夕方"; }

// ---- ② 時間帯ごとのつながりやすさ ----
// rows：[{ hour, calls, person, apo }]（MOCHICA の記録を日本時間の「時」ごとに数えたもの）
// 「担当者と話せた割合」を、資料の目安を事前の見立て（weight 件ぶん）として足して滑らかにする。
//   少ない件数で「この時間は100%」のような極端な値が出て、全員の掛け直しがそこに集まるのを防ぐため
export function hourRates(rows = []) {
  const by = new Map(rows.map((r) => [Number(r.hour), r]));
  let calls = 0, person = 0;
  for (const r of rows) { calls += +r.calls || 0; person += +r.person || 0; }
  const base = calls >= 50 ? person / calls : 0.3;   // 記録が50件に満たないうちは仮の平均
  const K = CADENCE.prior.weight;
  const hours = [];
  for (let h = CADENCE.firstHour; h <= CADENCE.lastHour; h++) {
    const r = by.get(h) || {}; const n = +r.calls || 0, x = +r.person || 0;
    const boost = CADENCE.prior.boost[h] || 1;
    const prior = Math.min(0.95, base * boost);
    const rate = (x + K * prior) / (n + K);
    hours.push({ hour: h, calls: n, person: x, apo: +r.apo || 0, raw: n ? x / n : null, rate, lift: base > 0 ? rate / base : 1, prior: boost > 1 });
  }
  return { base, calls, hours };
}
// いまの時間帯が、つながりやすいか（画面の上に出す1行用）
export function slotNow(rates, now = new Date()) {
  const h = jstHour(now); const x = (rates && rates.hours || []).find((r) => r.hour === h);
  if (!x) return { hour: h, tier: "off", lift: null, rate: null };
  return { hour: h, tier: x.lift >= 1.15 ? "good" : x.lift <= 0.85 ? "low" : "normal", lift: x.lift, rate: x.rate };
}

// ---- ① 担当者に届かなかったあとの、次の掛け直し ----
// streak：今回を含めて、担当者に届かないまま続けた回数
// 戻り値：{ at, why, parked, hour }。parked＝上限に達したので休ませる（呼ぶ側は streak を 0 に戻す）
export function nextMissAt({ now = new Date(), streak = 1, gateHours = "", rates = null } = {}) {
  const k = Math.max(1, streak | 0); const max = CADENCE.maxMiss;
  if (k >= max) {
    const at = jstAt(nextWeekday(new Date(now.getTime() + (CADENCE.parkDays - 1) * 86400e3)), 10, 0);
    return { at, parked: true, why: `担当者に${k}回続けてつながらなかったので、いったん休ませて${CADENCE.parkDays}日後に時期を変えて再開（${k}/${max}回）` };
  }
  const left = `あと${max - k}回まで`;
  // 受付で「いる時間」を聞けているなら、その時間に合わせる（聞けた情報がいちばん確か）
  const slot = SLOT[String(gateHours || "").replace(/\s/g, "")];
  if (slot) {
    const t = jstAt(now, slot[0], slot[1]);
    if (t.getTime() - now.getTime() > 30 * 60e3) return { at: t, parked: false, hour: slot[0], why: `受付で聞いた「${gateHours}」に掛け直し（${k}/${max}回・${left}）` };
    return { at: jstAt(nextWeekday(now), slot[0], slot[1]), parked: false, hour: slot[0], why: `受付で聞いた「${gateHours}」（次の平日）に掛け直し（${k}/${max}回・${left}）` };
  }
  // 聞けていないときは、1〜2日あけて、前回と違う時間帯のうち、いちばんつながりやすい時の頭に
  const gap = CADENCE.gapDays[Math.min(k - 1, CADENCE.gapDays.length - 1)];
  const last = bandOf(jstHour(now));
  const hs = (rates && rates.hours && rates.hours.length ? rates : hourRates([])).hours;
  const pick = hs.filter((h) => bandOf(h.hour) !== last).sort((a, b) => b.rate - a.rate)[0] || hs[0];
  return { at: jstAt(addBizDays(now, gap), pick.hour, 0), parked: false, hour: pick.hour,
    why: `${k}回続けてつながらなかったので、${gap === 1 ? "翌営業日" : `${gap}営業日後`}の${pick.hour}時台（前回と違う時間帯で、つながりやすさ ${Math.round(pick.rate * 100)}%）に掛け直し（${k}/${max}回・${left}）` };
}

// ---- ③ かける順番 ----
// l：{ next_at, next_why, hot, attempts, miss_streak, hearing, gate }
// tier 0＝人が決めた約束の掛け直し／1＝時刻が来た自動の掛け直し／2＝それ以外（点の高い順）。
//   約束と掛け直しの時刻を先に守るのは、型（間隔）を崩さないため。点は tier 2 の中の並びだけに効く
export function priorityOf(l, now = new Date()) {
  const due = l.next_at && new Date(l.next_at).getTime() <= now.getTime();
  if (due) return { tier: l.next_why === WHY_HUMAN ? 0 : 1, score: 0, reasons: [l.next_why === WHY_HUMAN ? "約束の掛け直し" : "掛け直しの時刻が来ました"] };
  let score = 0; const reasons = [];
  const hot = Number(l.hot || 0);
  if (hot >= 3) { score += 30; reasons.push("ホット（担当者名・ニーズ・時期が分かる）"); } else if (hot === 2) { score += 20; reasons.push("ウォーム"); } else score += hot * 10;
  // 検討時期が近い会社は、採用の意思決定の窓が開いている（MOCHICA 科学化：採用暦に合わせる）
  const m = parseInt(String((l.hearing || {}).when || "").replace(/[^0-9]/g, ""), 10);
  if (m >= 1 && m <= 12) {
    const d = (m - jstMonth(now) + 12) % 12;
    if (d <= 1) { score += 25; reasons.push(d === 0 ? "検討時期が今月" : "検討時期が来月"); } else if (d <= 3) { score += 12; reasons.push(`検討時期が${d}か月後`); }
  }
  // 受付で聞いた「いる時間」に合うか（合うときにかけるほうがつながる）
  const hrs = String(((l.gate || {}).hours) || "").replace(/\s/g, "");
  if (SLOT[hrs]) { if (hrs === bandOf(jstHour(now))) { score += 20; reasons.push(`いる時間（${hrs}）に合う`); } else score -= 10; }
  score -= 3 * (l.miss_streak || 0);
  return { tier: 2, score, reasons: reasons.slice(0, 3) };
}
export function rankQueue(rows, now = new Date()) {
  return rows.map((r) => ({ ...r, ...priorityOf(r, now) })).sort((a, b) =>
    a.tier - b.tier || (a.tier < 2 ? new Date(a.next_at) - new Date(b.next_at) : b.score - a.score) || (a.attempts || 0) - (b.attempts || 0) || a.id - b.id);
}
