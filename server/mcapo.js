// アポ確率の予測（2026-11-27 オーナー：福井さん「各種切り口からのアポ率を基にして、そのリードの精緻なアポ確率予測を」）
//
// 何をするか：リード1件ずつに「次にかけたときにアポになる確率」を出す。今まであった「優先度」（人が付けた高・中・低）の代わりに、
//   「かける」の並び・今日の100件の各枠の中の並びをこの確率で決める。
// 作り（説明できる形にするため、わざと単純にしている）：
//   1. 切り口（リード元・前回の結果・失注理由など）ごとに、これまでの架電のアポ率を数える。
//   2. 件数の少ない値は、全体のアポ率（SF のコンバートの差が分かる切り口はその差をかけた率）に寄せる
//      （数件の架電で 0% や 50% と決めつけないため。寄せる強さはアポ3件ぶん）。
//   3. 寄せた率を「全体からどれだけ上か下か」（対数オッズの差）にして、ロジスティック回帰で重みを決めて足し合わせる。
//      重みは 0〜2 に収める（向きは 1. で決まっているので、マイナスの重みにして説明が逆になることを防ぐ）。
//   4. 足し合わせた中で効いた上位3つが「何で上がった・下がったか」になる。
// 当たっているかは、学び直すたびに「古い 8 割で学んで、新しい 2 割を当てる」で確かめる（時間で分けるので、未来の情報は使わない）。
//
// DB も通信も使わない関数だけにして、node で直接試せるようにしている（mccadence.js と同じ作り）。
import { normCode } from "./mcstage.js";

export const APO_V = 1;   // 特徴の作り方を変えたら上げる（古い作り方の記録を学びに混ぜないため）

// ---- 切り口（特徴）。label は画面の「何で上がった・下がったか」にそのまま出す ----
//   デモの18の切り口のうち、本番にデータがあるもの＋架電回数・時間帯。公式 LINE・採用イベント・インテント・リスケの印は、
//   本番にデータが無いので入れていない（入れても全部「不明」になり、学べないため）
export const APO_FEATS = [
  { k: "source", label: "リード元" },
  { k: "hot", label: "ホット度" },
  { k: "stage", label: "リードステージ" },
  { k: "prev", label: "前回の結果" },
  { k: "lost", label: "失注理由" },
  { k: "lostAge", label: "失注からの期間" },
  { k: "budget", label: "検討時期" },
  { k: "next", label: "次回アクション" },
  { k: "who", label: "採用区分" },
  { k: "hires", label: "採用人数" },
  { k: "name", label: "担当者名" },
  { k: "gap", label: "前回の架電から" },
  { k: "ats", label: "競合 ATS" },
  { k: "mynavi", label: "マイナビ掲載" },
  { k: "pref", label: "都道府県" },
  { k: "gyokai", label: "業界" },
  { k: "tries", label: "これまでの架電回数" },
  { k: "band", label: "かける時間帯" },
];
const LABEL = new Map(APO_FEATS.map((f) => [f.k, f.label]));

const DAY = 86400e3;
const jst = (t) => new Date(t + 9 * 3600e3);
const txt = (v) => String(v == null ? "" : v).normalize("NFKC").replace(/\s+/g, " ").trim();
// 前回の結果：MOCHICALL の記録の値（no_answer など）と、BALES・SF の結果の言葉を同じ箱にそろえる
const PREV_KEY = { no_answer: "つながらない", busy: "つながらない", voicemail: "つながらない", closed: "つながらない", invalid: "使われていない番号",
  absent: "受付：担当者不在", blocked: "受付ブロック", callback_req: "掛け直しを指定された", inquiry: "問い合わせ",
  apo: "アポ獲得", doc_send: "資料送付", follow: "営業フォロー", reject: "お断り", ban: "お断り", single: "お断り" };   // 禁止・窓口一本化も断られた箱に数える
export function prevBucket(v) {
  const s = txt(v); if (!s) return null;
  if (PREV_KEY[s]) return PREV_KEY[s];
  if (/アポ/.test(s)) return "アポ獲得";
  if (/受付.*(ブロック|NG|拒否)/i.test(s)) return "受付ブロック";
  if (/お断り|断り|NG/i.test(s)) return "お断り";
  if (/営業フォロー|フォロー/.test(s)) return "営業フォロー";
  if (/資料/.test(s)) return "資料送付";
  if (/掛け?直し|かけ直し|再架電/.test(s)) return "掛け直しを指定された";
  if (/不在|離席|会議/.test(s)) return "受付：担当者不在";
  if (/使われて|現在使用|番号.*(違|誤)/.test(s)) return "使われていない番号";
  if (/コールのみ|不通|留守|話し中|出ない|営業時間外/.test(s)) return "つながらない";
  if (/問い?合わせ/.test(s)) return "問い合わせ";
  return "そのほか";
}
const bucket = (n, edges) => { for (const [max, v] of edges) if (n <= max) return v; return edges[edges.length - 1][1]; };
const GAP = [[0, "当日"], [3, "1〜3日"], [7, "4〜7日"], [30, "8〜30日"], [90, "31〜90日"], [Infinity, "91日以上"]];
const TRIES = [[0, "0回"], [1, "1回"], [2, "2回"], [4, "3〜4回"], [7, "5〜7回"], [Infinity, "8回以上"]];
const HIRES = [[2, "1〜2名"], [5, "3〜5名"], [10, "6〜10名"], [20, "11〜20名"], [Infinity, "21名以上"]];
export function bandOf(t) { const h = jst(t).getUTCHours(); return h < 10 ? "〜10時" : h < 12 ? "10〜12時" : h < 14 ? "12〜14時" : h < 16 ? "14〜16時" : h < 18 ? "16〜18時" : "18時〜"; }
const ymNum = (s) => { const m = String(s || "").match(/(\d{4})[-/年](\d{1,2})/); return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null; };

// 1件の特徴を作る。r：
//   { seg, hot, person, hearing, lastOutcome, lastAt, attempts, nextAt, nextWhy, mynavi, at, band, safe }
//   at：その架電の時刻（学ぶとき）か、今（予測するとき）。band：時間帯（予測のときは空＝平均）
//   safe：過去の記録から作り直すとき true。架電のあとで書き換わった値（ホット度・アポのあとのステージ）を使わない（未来の情報が混ざるため）
export function featuresOf(r = {}, whyHuman = "記録した人が決めた時刻") {
  const seg = r.seg || {}, h = r.hearing || {}, at = r.at ? new Date(r.at).getTime() : Date.now();
  const x = {};
  x.source = txt(seg.source).slice(0, 40) || null;
  if (!r.safe) { const n = Number(r.hot); x.hot = Number.isFinite(n) ? (n >= 3 ? "ホット" : n === 2 ? "ウォーム" : "コールド") : null; }
  const st = normCode(seg.stage);
  //   作り直しのときは、アポのあとに付く段階（コンバート）を使わない
  x.stage = st && !(r.safe && st === "05") ? st : null;
  // 前回の結果と前回からの日数：MOCHICALL の記録が新しければそれ、なければ BALES・SF の最後の結果（その架電より前のものだけ）
  let lastAt = r.lastAt ? new Date(r.lastAt).getTime() : NaN, prev = Number.isFinite(lastAt) && lastAt < at ? prevBucket(r.lastOutcome) : null;
  const ext = seg.extLast ? new Date(seg.extLast).getTime() : NaN;
  if (Number.isFinite(ext) && ext < at && (!Number.isFinite(lastAt) || ext > lastAt || !prev)) { const b = prevBucket(seg.extResult); if (b) { prev = b; lastAt = ext; } }
  if (!Number.isFinite(lastAt) || lastAt >= at) lastAt = Number.isFinite(ext) && ext < at ? ext : NaN;
  x.prev = prev || (Number.isFinite(lastAt) ? "そのほか" : "未架電");
  x.gap = Number.isFinite(lastAt) ? bucket(Math.floor((at - lastAt) / DAY), GAP) : "未架電";
  // 失注：失注日がその架電より前のものだけ数える（アポで作った商談がのちに失注して、そのリードに理由が付くと「失注理由がある会社はアポになる」と誤って学ぶため）
  const lost = seg.lost && typeof seg.lost === "object" ? seg.lost : null;
  const ld = lost && lost.date ? new Date(lost.date).getTime() : NaN;
  const lostOk = !!lost && (!Number.isFinite(ld) ? !r.safe : ld < at);
  if (lostOk) {
    x.lost = txt(lost.reason).slice(0, 40) || "理由なし";
    x.lostAge = Number.isFinite(ld) ? bucket(Math.floor((at - ld) / (30.4 * DAY)), [[6, "半年以内"], [12, "半年〜1年"], [24, "1〜2年"], [Infinity, "2年より前"]]) : null;
  } else { x.lost = "失注なし"; x.lostAge = null; }
  // 検討時期：架電で聞いた「④ 選考開始時期」「㉖ 予算検討時期」→ SF の検討開始時期。今月との差（か月）
  const nowM = jst(at).getUTCFullYear() * 12 + jst(at).getUTCMonth();
  let wm = ymNum(h.budgetWhen) ?? ymNum(h.when) ?? ymNum(seg.whenYm);
  if (wm == null) { const m = parseInt(String(h.when || "").replace(/[^0-9]/g, ""), 10); if (m >= 1 && m <= 12) wm = nowM + ((m - 1 - (nowM % 12) + 12) % 12); }
  x.budget = wm != null ? (wm - nowM < 0 ? "時期が過ぎた" : wm - nowM <= 1 ? "今月・来月" : wm - nowM <= 3 ? "2〜3か月後" : "4か月以上先") : (h.when === "未定" || h.budgetWhen === "未定" ? "未定" : null);
  // 次回アクション：人が約束した掛け直し／自動の掛け直し／なし（その架電の前に入っていた予定）
  x.next = r.nextWhy === whyHuman ? "約束の掛け直し" : r.nextAt ? "自動の掛け直し" : "なし";
  // 採用区分・採用人数：架電で聞いた値（その架電より前に聞いたもの）
  const who = txt(h.need_who || (h.need && h.need.who) || "");
  x.who = !who ? null : /新卒|大卒|卒業|[0-9]{2}卒/.test(who) ? "新卒" : /高卒|高校/.test(who) ? "高卒" : /中途|経験|キャリア/.test(who) ? "中途" : /パート|アルバイト/.test(who) ? "パート・アルバイト" : "そのほか";
  const tg = parseInt(String(h.target || "").replace(/[^0-9]/g, ""), 10);
  x.hires = tg > 0 ? bucket(tg, HIRES) : null;
  const nm = txt(h.name || r.person).replace(/(様|さま|さん|殿)$/, "");
  x.name = nm && !/不明|担当者?$|^-+$|ご担当/.test(nm) ? "分かっている" : "分からない";
  x.ats = txt(seg.ats) || (lostOk && txt(lost.rival)) || h.ats === "利用している" ? "使っている" : h.ats === "利用していない" ? "使っていない" : null;
  x.mynavi = r.mynavi === "listed" ? "載っている" : r.mynavi ? "載っていない" : null;
  x.pref = txt(seg.pref) || null;
  x.gyokai = txt(seg.gyokai) && seg.gyokai !== "不明" ? txt(seg.gyokai) : null;
  const n = Number(r.attempts); x.tries = bucket(Number.isFinite(n) && n > 0 ? n : 0, TRIES);
  x.band = r.band || null;
  for (const k of Object.keys(x)) if (x[k] == null || x[k] === "") delete x[k];
  return x;
}

// ---- 学ぶ ----
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const logit = (p) => { const q = clamp(p, 1e-6, 1 - 1e-6); return Math.log(q / (1 - q)); };
const sig = (z) => 1 / (1 + Math.exp(-z));
// 件数で数える。cnt[f] = Map(値 → [架電数, アポ数])
function countOf(rows, feats) {
  const cnt = {}; for (const f of feats) cnt[f] = new Map();
  for (const s of rows) for (const f of feats) { const v = s.x[f]; if (v == null) continue; const c = cnt[f].get(v) || [0, 0]; c[0]++; if (s.y) c[1]++; cnt[f].set(v, c); }
  return cnt;
}
// 値の「全体からの上下」（対数オッズの差）。件数の少ない値は寄せ先（全体の率 × SF の差）に寄せる
function encoder(cnt, base, K, lifts) {
  const lb = logit(base);
  const target = (f, v) => { const l = lifts && lifts[f] && lifts[f][v]; return l ? clamp(base * l, base / 4, Math.min(0.9, base * 4)) : base; };
  return (f, v) => { if (v == null) return 0; const t = target(f, v), c = cnt[f] && cnt[f].get(v); return logit(c ? (c[1] + K * t) / (c[0] + K) : t) - lb; };
}
const hashOf = (g) => { let h = 2166136261; for (const ch of String(g)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

// samples：[{ x: 特徴, y: 1/0, g: リードの番号（同じリードを学ぶ側と確かめる側に分けないため）, at }]
// lifts：SF のコンバートの差（{ source: { 値: 倍率 }, pref: {...} }）。無ければ全体の率に寄せる
export function fitApo(samples, { lifts = {}, minCover = 0.03, folds = 5, iters = 300, l2 = 2, now = Date.now() } = {}) {
  const n = samples.length, pos = samples.reduce((t, s) => t + (s.y ? 1 : 0), 0);
  const base = clamp((pos + 0.5) / (n + 1), 1e-4, 0.5);
  const K = clamp(3 / base, 30, 400);   // アポ3件ぶんの重みで寄せる（アポ率3%なら100件ぶん）
  // データが無い切り口（値の入っている架電が3%未満・値が1種類だけ）は使わない
  const feats = APO_FEATS.map((f) => f.k).filter((f) => {
    let c = 0; const vs = new Set(); for (const s of samples) if (s.x[f] != null) { c++; vs.add(s.x[f]); }
    return n && c / n >= minCover && vs.size >= 2;
  });
  const model = { v: APO_V, made: new Date(now).toISOString(), n, pos, base, K, feats, w: {}, b: logit(base), tab: {}, lifts: {} };
  if (!n || !pos || !feats.length) { for (const f of feats) model.w[f] = 0; return model; }
  // 重みを決めるときの値は「自分の組を抜いて数えた率」にする（自分のアポを数えた率で自分を当てると、強く見えすぎるため）
  const X = samples.map(() => new Float64Array(feats.length));
  for (let k = 0; k < folds; k++) {
    const tr = samples.filter((s) => hashOf(s.g) % folds !== k);
    const trPos = tr.reduce((t, s) => t + (s.y ? 1 : 0), 0), tb = clamp((trPos + 0.5) / (tr.length + 1), 1e-4, 0.5);
    const enc = encoder(countOf(tr, feats), tb, clamp(3 / tb, 30, 400), lifts);
    samples.forEach((s, i) => { if (hashOf(s.g) % folds === k) feats.forEach((f, j) => { X[i][j] = enc(f, s.x[f]); }); });
  }
  // ロジスティック回帰（重みは 0〜2・L2 で 0 に寄せる）。件数は多くても数万なので、全部を使う勾配法で足りる
  const w = new Float64Array(feats.length).fill(0.5); let b = logit(base);
  const m = new Float64Array(feats.length + 1), v2 = new Float64Array(feats.length + 1), lr = 0.05;
  for (let it = 1; it <= iters; it++) {
    const g = new Float64Array(feats.length + 1);
    for (let i = 0; i < n; i++) { let z = b; for (let j = 0; j < feats.length; j++) z += w[j] * X[i][j]; const e = sig(z) - samples[i].y; g[0] += e; for (let j = 0; j < feats.length; j++) g[j + 1] += e * X[i][j]; }
    for (let j = 0; j <= feats.length; j++) {
      const gj = g[j] / n + (j ? (l2 / n) * w[j - 1] : 0);
      m[j] = 0.9 * m[j] + 0.1 * gj; v2[j] = 0.999 * v2[j] + 0.001 * gj * gj;
      const step = lr * (m[j] / (1 - 0.9 ** it)) / (Math.sqrt(v2[j] / (1 - 0.999 ** it)) + 1e-8);
      if (j) w[j - 1] = clamp(w[j - 1] - step, 0, 2); else b -= step;
    }
  }
  // 予測に使う表は全部の架電で数え直す（いちばん多くの件数で決めるため）
  const cnt = countOf(samples, feats), enc = encoder(cnt, base, K, lifts);
  feats.forEach((f, j) => {
    model.w[f] = Math.round(w[j] * 1000) / 1000;
    const t = {}; for (const [val, c] of cnt[f]) t[val] = [c[0], c[1], Math.round(enc(f, val) * 1000) / 1000]; model.tab[f] = t;
    if (lifts[f]) model.lifts[f] = lifts[f];
  });
  model.b = Math.round(b * 1000) / 1000;
  return model;
}

// 1件の確率と「何で上がった・下がったか」の上位3つ
export function scoreApo(model, x = {}) {
  if (!model || !model.feats) return { p: null, why: [] };
  const lb = logit(model.base);
  let z = model.b; const parts = [];
  for (const f of model.feats) {
    const v = x[f]; if (v == null) continue;
    const t = model.tab[f] && model.tab[f][v];
    let e = t ? t[2] : 0;
    if (!t) { const l = model.lifts && model.lifts[f] && model.lifts[f][v]; if (l) e = logit(clamp(model.base * l, model.base / 4, Math.min(0.9, model.base * 4))) - lb; }
    const c = (model.w[f] || 0) * e; z += c;
    if (Math.abs(c) >= 0.05) parts.push({ k: f, c, v });
  }
  const p = sig(z);
  const why = parts.sort((a, b) => Math.abs(b.c) - Math.abs(a.c)).slice(0, 3).map((q) => ({
    k: q.k, label: LABEL.get(q.k) || q.k, v: q.v, up: q.c > 0,
    //   その切り口が無かったら何ポイント違ったか（画面で「+1.2pt」のように出す）
    pt: Math.round((p - sig(z - q.c)) * 1000) / 10,
  }));
  return { p: Math.round(p * 10000) / 10000, why };
}
// 画面に出す1行（「リード元『失注リサイクル』で上がった」）
export const whyText = (w) => `${w.label}「${w.v}」で${w.up ? "上がった" : "下がった"}（${w.pt > 0 ? "+" : ""}${w.pt}pt）`;

// ---- 当たっているか ----
export const APO_BINS = [[0, 0.02], [0.02, 0.05], [0.05, 0.1], [0.1, 0.2], [0.2, 1.01]];
export function binsOf(pairs) {
  return APO_BINS.map(([lo, hi]) => {
    const g = pairs.filter((q) => q.p >= lo && q.p < hi), n = g.length;
    return { lo, hi: Math.min(hi, 1), n, pred: n ? Math.round((g.reduce((t, q) => t + q.p, 0) / n) * 10000) / 10000 : null,
      act: n ? Math.round((g.reduce((t, q) => t + q.y, 0) / n) * 10000) / 10000 : null, apo: g.reduce((t, q) => t + q.y, 0) };
  });
}
// 並びのよさ（AUC：アポになった架電を、ならなかった架電より上に並べられた割合。0.5＝でたらめ）
export function aucOf(pairs) {
  const s = [...pairs].sort((a, b) => a.p - b.p); let rank = 0, sumPos = 0, nPos = 0, i = 0;
  while (i < s.length) { let j = i; while (j < s.length && s[j].p === s[i].p) j++; const r = (i + 1 + j) / 2; for (let k = i; k < j; k++) if (s[k].y) { sumPos += r; nPos++; } rank = j; i = j; }
  const nNeg = s.length - nPos; return nPos && nNeg ? Math.round(((sumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg)) * 1000) / 1000 : null;
}
// 古い 8 割で学んで、新しい 2 割を当てる。test の件数・アポ数・帯ごとの実際のアポ率・AUC・ブライアスコア（小さいほどよい）
export function backtestApo(samples, opt = {}) {
  const s = [...samples].sort((a, b) => new Date(a.at) - new Date(b.at));
  const cut = Math.floor(s.length * 0.8), tr = s.slice(0, cut), te = s.slice(cut);
  const trPos = tr.reduce((t, q) => t + q.y, 0), tePos = te.reduce((t, q) => t + q.y, 0);
  if (te.length < 50 || trPos < 5 || tePos < 1) return { ok: false, n: s.length, why: `件数が足りません（学ぶ側のアポ ${trPos}件・確かめる側 ${te.length}件。アポが5件・確かめる架電が50件そろうと確かめます）` };
  const m = fitApo(tr, opt);
  const pairs = te.map((q) => ({ p: scoreApo(m, q.x).p, y: q.y ? 1 : 0 }));
  const brier = pairs.reduce((t, q) => t + (q.p - q.y) ** 2, 0) / pairs.length;
  const brier0 = pairs.reduce((t, q) => t + (m.base - q.y) ** 2, 0) / pairs.length;
  return { ok: true, train: { n: tr.length, pos: trPos, from: tr[0].at, to: tr[tr.length - 1].at }, test: { n: te.length, pos: tePos, from: te[0].at, to: te[te.length - 1].at },
    bins: binsOf(pairs), auc: aucOf(pairs), brier: Math.round(brier * 100000) / 100000, brier_base: Math.round(brier0 * 100000) / 100000 };
}

// SF のコンバートの数（[{ v, n, conv }]）→ 切り口の値ごとの倍率（全体のコンバート率との比。件数の少ない値は1に寄せる）
export function liftsOf(rows = [], K = 200) {
  const N = rows.reduce((t, r) => t + (Number(r.n) || 0), 0), C = rows.reduce((t, r) => t + (Number(r.conv) || 0), 0);
  if (!N || !C) return {};
  const r0 = C / N, out = {};
  for (const r of rows) { const v = txt(r.v); if (!v || !(r.n > 0)) continue; out[v] = Math.round(((Number(r.conv) + K * r0) / (Number(r.n) + K) / r0) * 1000) / 1000; }
  return out;
}
