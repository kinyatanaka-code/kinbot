// テレアポ科学モデル v1（2026-11-16）
//
// なぜ作ったか：
//   これまでの架電分析（G-Chain の診断、標準手順 v1 の K1〜K5、断り理由の分析、構造方程式）は
//   それぞれ別のフォルダ・別の物差しで出していた。G-Chain はゲートの状態は分かるが、
//   「どの発言がアポを何件ぶん落としたか」までは言えず、結果と関係が見えない項目（時間許諾など）も減点していた。
//   そこで、実際のアポ率で裏付けのある分かれ道だけを1本の順番に並べ、
//   通話ごとに「その場で推奨の動きをしていたら上がったアポ確率」との差（失ったアポの見込み）を計算する。
//   差がいちばん大きい場所を、その通話の「問題の場所」とする。
//
// 作りの考え方（G-Chain Lite と同じ）：
//   ・読み取り（分類）は AI（teleapo_annotate.js）。引用を必ず付けさせ、文字起こしに無い引用は保留（HOLD）にする。
//   ・判定（導出）はこのファイルのコードだけで行う。AI に点数を付けさせない（ぶれるため）。
//   ・数字はすべて 内線814（MOCHICA）の実測。DOC など別の商材にそのまま当てはまる保証はない。
//
// このファイルは AI も DB も呼ばない。テストや再計算でそのまま使えるようにするため。

// ───────────────────────── モデルの定義（数字の出どころつき） ─────────────────────────
export const MODEL = {
  name: "テレアポ科学モデル",
  version: "1.0",
  created: "2026-11-16",
  product: "MOCHICA",
  data: "内線814（福井）6/1〜11/6 の全発信と、打診通話の全文注釈（アポ80件＋非アポ190件ほか）",
  // 根拠の強さ。B＝期間を分けても再現した／C＝観察で一貫しているが実験なし／D＝定義・少数例のみ
  evidence: { B: { weight: 1.0, label: "再現した" }, C: { weight: 0.6, label: "観察のみ" }, D: { weight: 0.3, label: "定義・少数例" } },

  // 層A：構造方程式。アポ/日 ＝ 発信/日 × 応答率 × 担当者到達率 × 2分超継続率 × 打診率 × 打診→アポ率
  funnel: {
    stages: [
      { key: "dials", label: "発信/日" },
      { key: "answer", label: "応答率" },
      { key: "person", label: "担当者到達率" },
      { key: "over2m", label: "2分超継続率" },
      { key: "ask", label: "打診率（2分超の会話で）" },
      { key: "askToAppo", label: "打診→アポ率" },
    ],
    baseline: { period: "2026-10-01..2026-11-06", dials: 80.3, answer: 0.787, person: 0.569, over2m: 0.483, ask: 0.573, askToAppo: 0.138, appoPerDay: 1.38 },
    before: { period: "2026-06-01..2026-09-30", dials: 101.8, answer: 0.702, person: 0.524, over2m: 0.494, ask: 0.436, askToAppo: 0.109, appoPerDay: 0.88 },
  },

  // 層C で使うアポ率（実測）
  rates: {
    noAsk: 0.003,                                   // 2分超で打診しなかった通話（インターンは 0/217）
    asked: { 再アプローチ: 0.206, 新規: 0.041, 不明: 0.143 },   // 打診した通話（打診先の種類別）
    firstResp: { 受諾: 0.71, 時期: 0.169, 要否: 0.028, 他ツール: 0.031, その他: 0.087 },
    timingRedate: 0.277,                            // 「時期」の返事に日付を出し直した
    timingOther: 0.02,                              // 「時期」に質問・説明・撤退（質問・説明は 0/12、引いたのは 0%）
    needRedate: 0.04,                               // 「要否」の返事に出し直した
    needOther: 0.02,
    denialHalf: 0.5,                                // 打診前に相手が「問題ない」と言うとアポが半分
    // 失注時の終わり方 → 60日以内のアポ
    close: { 日付つき次回: 0.082, 時期だけ: 0.01, 資料送付: 0.029, 必要ならこちらから: 0.01, なし: 0.01 },
  },

  // 標準手順 v1 の指標（基準＝10/1〜11/5、目標＝標準手順の目標）
  kpis: [
    { id: "K1", name: "2分超の会話の打診率", direction: "higher", baseline: 0.578, target: 0.80, minN: 8 },
    { id: "K2", name: "打診の前に相手が「問題ない」と言った割合", direction: "lower", baseline: 0.234, target: 0.15, minN: 5 },
    { id: "K3", name: "打診の前に課題を決めつける問いをした割合", direction: "lower", baseline: 0.432, target: 0.20, minN: 5 },
    { id: "K4", name: "時期の返事に日付を出し直した割合", direction: "higher", baseline: 0.52, target: 0.90, minN: 3 },
    { id: "K5", name: "最初の返事が「時期」か「受諾」だった割合", direction: "higher", baseline: 0.369, target: null, minN: 5 },
    { id: "K6", name: "アポなしの担当者通話で日付つきの次回を約束した割合", direction: "higher", baseline: 0.24, target: 0.60, minN: 5 },
  ],

  // 減点しない項目（データで差が出なかった・再現しなかった）。G-Chain との一番の違い。
  neutral: [
    { key: "time_permission", label: "時間許諾（「今1分よろしいですか」）", why: "全期間でアポとの関係が見えない（G-Chain は減点するが結果と結びつかない）" },
    { key: "ask_form", label: "最初の打診の形（日付つき・2択・復唱）", why: "最初の打診で比べると 8.9% vs 7.8% で差なし。日付が効くのは「時期」の返事への出し直し" },
    { key: "problem_first", label: "課題を言わせてから打診する", why: "検証期間で再現せず（9% vs 12%、逆向き）" },
    { key: "remember_q", label: "「覚えてますか」", why: "アポとの差なし（否定されやすいので勧めはしない）" },
    { key: "explain", label: "打診前の長い説明・発話の多さ", why: "アポとの関係が支持されない" },
    { key: "when", label: "架けた月・曜日・時間帯", why: "アポを見分ける力はほぼ0" },
  ],
};

// 分かれ道（問題の場所）。order は通話の中の順番。
export const POINTS = {
  P0_opening: { order: 0, label: "冒頭〜2分", fix: "15秒以内に用件（前回の相手の言葉か、相手の会社の事実）を言う。「覚えてますか」で始めない" },
  P1_ask: { order: 1, label: "打診したか", fix: "2分話したら打診する。打診しない会話のアポは 0.3%" },
  P2_preask: { order: 2, label: "打診の前の掘り方", fix: "「〜増えていませんか」と課題を決めつけて聞かない。相手が「問題ない」と言う前に打診し、課題は打ち合わせの中で聞く" },
  P3_timing: { order: 3, label: "「時期」の返事への返し", fix: "「今は忙しい・◯月なら」には、その場で週をずらした日付か2択を出し直す。質問や説明に切り替えない" },
  P3_need: { order: 3, label: "「要否」の返事への返し", fix: "切り口を軽くして1回だけ言い直す（例：辞退の人数だけ確認する20分）。だめなら決める時期を聞いて次回に回す" },
  P3_accept: { order: 3, label: "受諾後の日時確定", fix: "受けてもらえたらその場で日時を2択で決め、午前・午後を付けて2回復唱する" },
  P4_close: { order: 4, label: "アポなしの終わり方", fix: "断られても、決める時期の2〜4週前の週を2択で決めて終える（日付つきの次回）。「必要ならこちらから」で終えない" },
};

// ───────────────────────── 小さな道具 ─────────────────────────
const num = (v) => (v == null || v === "" || !isFinite(Number(v)) ? null : Number(v));
const bool = (v) => (v === true || v === "true" ? true : v === false || v === "false" ? false : null);
const round = (v, d = 3) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
const rateOf = (a, b) => (b ? a / b : null);

// 打診先の種類をそろえる（画面やデータで書き方が違うため）
export function normCallType(v) {
  const s = String(v || "");
  if (/再|re|follow|フォロー/i.test(s)) return "再アプローチ";
  if (/新規|new/i.test(s)) return "新規";
  return "不明";
}

// 引用が文字起こしに本当にあるかを確かめる。AI が言い換えた・作った引用で判定しないため。
// 4文字の並びが何割、文字起こしに出てくるかで見る（文字起こしの誤変換や句読点のゆれに強くするため）。
function normText(s) {
  return String(s || "").replace(/\[\d+s\]/g, "").replace(/[\s　、。，．,.!！?？「」『』（）()…・〜~ー－\-:："'’”]/g, "");
}
function quoteCoverage(quote, transcriptNorm) {
  // 引用の中の（今日は無理）のような補足書きは原文に無いので、照合の前に外す
  const q = normText(String(quote || "").replace(/（[^）]*）|\([^)]*\)/g, ""));
  if (!q) return null;
  if (q.length <= 4) return transcriptNorm.includes(q) ? 1 : 0;
  let hit = 0, all = 0;
  for (let i = 0; i + 4 <= q.length; i++) { all++; if (transcriptNorm.includes(q.slice(i, i + 4))) hit++; }
  return all ? hit / all : 0;
}
// 引用つきの項目。ask_quote は「要旨（原文寄り）」なのでゆるめに見る
const QUOTED = [
  { flag: "asked", q: "ask_quote", min: 0.3 },
  { flag: "denial", q: "denial_q", min: 0.5 },
  { flag: "own_problem", q: "own_problem_q", min: 0.5 },
  { flag: "lost_count", q: "lost_count_q", min: 0.5 },
  { flag: "means_gap", q: "means_gap_q", min: 0.5 },
  { flag: "closed_window", q: "closed_window_q", min: 0.5 },
  { flag: "first_resp", q: "first_resp_q", min: 0.4 },
];
// 引用を検証し、確かめられなかった項目を保留にした注釈を返す。文字起こしが無いとき（過去の注釈の再計算）は検証しない。
export function verifyAnnotation(ann, transcriptText) {
  const a = { ...(ann || {}) };
  const hold = [];
  if (!transcriptText) return { annotation: a, hold, verified: null };
  const t = normText(transcriptText);
  for (const f of QUOTED) {
    const on = f.flag === "first_resp" ? !!a.first_resp && a.first_resp !== "受諾" : a[f.flag] === true;
    if (!on) continue;
    const cov = quoteCoverage(a[f.q], t);
    if (cov == null || cov < f.min) {
      hold.push({ field: f.flag, quote: a[f.q] || "", coverage: round(cov, 2) });
      // 保留にした項目は「分からない」として扱い、損失の計算に使わない
      if (f.flag === "first_resp") a.first_resp = "保留";
      else if (f.flag !== "asked") a[f.flag] = null;
    }
  }
  return { annotation: a, hold, verified: hold.length === 0 };
}

// ───────────────────────── 1通話の診断 ─────────────────────────
// ann：teleapo_annotate.js の注釈（標準手順 v1 の注釈と同じ項目名＋追加項目）
// meta：{ callType, durationSec, reach }  reach は "none"｜"gate"｜"person"（無ければ注釈の contact_ok で判断）
export function diagnoseCall(ann, meta = {}) {
  const a = ann || {};
  const R = MODEL.rates;
  const callType = normCallType(meta.callType || a.call_type);
  const dur = num(meta.durationSec ?? a.duration_sec);
  const contact = meta.reach ? meta.reach === "person" : bool(a.contact_ok) === true;
  const over2m = dur == null ? (a.asked === true ? true : null) : dur >= 120;
  const asked = a.asked === true;
  const pAsked = R.asked[callType];
  const appo = a.appo_in_call === true;
  const fr = a.first_resp || null;
  const after = a.after || null;
  const findings = [];
  const add = (point, dp, ev, why, quote = "") => {
    const P = POINTS[point];
    // アポが取れた通話は落としたアポが無いので0にする（次に避けたい動きとして残すだけ）
    if (appo && dp != null) { dp = 0; why = `（アポは取れた）${why}`; }
    findings.push({ point, label: P.label, order: P.order, lostAppo: dp == null ? null : round(Math.max(0, dp)), evidence: ev,
      weighted: dp == null ? null : round(Math.max(0, dp) * MODEL.evidence[ev].weight), why, quote, fix: P.fix });
  };

  // 担当者と話せていない通話はトークの診断をしない（受付・不在は架電先とリストの問題として数えるだけ）
  if (!contact) {
    return { callType, contact: false, over2m, asked, appo, stage: meta.reach === "gate" ? "受付まで" : "つながらない", pActual: 0, findings, top: null, gates: gatesOf(a, false, over2m), notes: listNotes(a) };
  }

  // P0 冒頭〜2分：2分に届かず打診も無い。観察では効果を決められない（生き残った通話しか比べられない）ので数字は出さない
  if (!asked && over2m === false) {
    const why = [];
    if (num(a.purpose_sec) != null && a.purpose_sec > 15) why.push(`用件まで${a.purpose_sec}秒`);
    if (a.remember_q === true) why.push("「覚えてますか」で始めた");
    if (callType === "再アプローチ" && a.prior_ref === false) why.push("前回の相手の言葉を電話の理由にしていない");
    add("P0_opening", null, "D", why.length ? why.join("・") : "2分に届かず打診もしなかった");
  }

  // P1 打診したか：2分超の会話で打診していなければ、打診した場合の率との差を落としたとみなす
  if (!asked && over2m !== false) {
    add("P1_ask", pAsked - R.noAsk, "B", `${dur != null ? Math.round(dur / 60) + "分" : "2分超"}話して打診なし（打診した場合 ${callType} ${Math.round(pAsked * 1000) / 10}%）`);
  }

  if (asked) {
    // P2 打診前の掘り方：相手の「問題ない」でアポが半分（再現）。決めつけの問いは観察のみ。二重に数えない
    if (a.denial === true) {
      add("P2_preask", pAsked * R.denialHalf, "B", "打診の前に相手が「問題ない」と言った" + (num(a.q_presumptive) > 0 ? `（決めつけの問い ${a.q_presumptive}回のあと）` : ""), a.denial_q || "");
    } else if (num(a.q_presumptive) > 0) {
      add("P2_preask", pAsked * R.denialHalf * 0.5, "C", `打診の前に課題を決めつける問いを${a.q_presumptive}回`);
    }
    // P3 最初の返事への返し
    if (fr === "時期" && !appo && !["日付を出し直す", "仮押さえ"].includes(after)) {
      add("P3_timing", R.timingRedate - R.timingOther, "B", `「時期」の返事に「${after || "不明"}」で返した`, a.first_resp_q || "");
    } else if (fr === "要否" && !appo && after !== "日付を出し直す") {
      add("P3_need", R.needRedate - R.needOther, "C", `「要否」の返事に「${after || "不明"}」で返した`, a.first_resp_q || "");
    } else if (fr === "受諾" && !appo) {
      add("P3_accept", null, "D", "受けてもらえたのに通話の中で日時が決まっていない", a.first_resp_q || "");
    }
  }

  // P4 アポなしの終わり方：日付つきの次回なら 60日以内のアポ 8.2%、何もなしは 1%
  if (!appo && (over2m !== false || asked)) {
    const nc = a.next_commit || null;
    if (nc && nc !== "日付つき次回") {
      const base = R.close[nc] ?? R.close.なし;
      const why = a.closed_window === true ? "「今は検討する時期ではない」で終話。決める時期の前の週を決めていない" : `次回の約束が「${nc}」`;
      add("P4_close", R.close.日付つき次回 - base, "C", why, a.closed_window_q || "");
    }
  }

  findings.sort((x, y) => (y.weighted ?? -1) - (x.weighted ?? -1) || x.order - y.order);
  const top = findings.find((f) => f.weighted != null && f.weighted > 0) || (appo ? null : findings[0] || null);
  return { callType, contact: true, over2m, asked, appo, stage: appo ? "アポ" : asked ? "打診まで" : over2m ? "2分超（打診なし）" : "担当者と話した（2分未満）",
    pActual: round(pActualOf(a, callType, over2m)), findings, top, gates: gatesOf(a, true, over2m), notes: listNotes(a) };
}

// この通話の実際のアポ確率の見込み（打診の有無・最初の返事・返し方から）。検証で予測の当たり方を見るのに使う
export function pActualOf(a, callType = "不明", over2m = true) {
  const R = MODEL.rates;
  if (a.appo_in_call === true) return 1;
  if (a.asked !== true) return over2m === false ? 0 : R.noAsk;
  const fr = a.first_resp;
  let p;
  if (fr === "受諾") p = R.firstResp.受諾;
  else if (fr === "時期") p = ["日付を出し直す", "仮押さえ"].includes(a.after) ? R.timingRedate : R.timingOther;
  else if (fr === "要否") p = a.after === "日付を出し直す" ? R.needRedate : R.needOther;
  else if (fr === "他ツール") p = R.firstResp.他ツール;
  else if (fr && fr !== "保留") p = R.firstResp.その他;
  else p = R.asked[normCallType(callType)];
  if (a.denial === true) p *= R.denialHalf;
  return p;
}

// G-Chain と同じ順のゲート（簡易版）。kinbot の中で同じ物差しで並べるため、注釈からコードで出す。
// G1 担当者到達 → G2 2分超の会話 → G3 相手の言葉で必要・条件が出た → G4 日付つきの合意（アポか日付つき次回）
function gatesOf(a, contact, over2m) {
  const g3 = [a.own_problem, a.means_gap, a.lost_count, a.interest_q, a.timing_info].some((x) => x === true);
  const g4 = a.appo_in_call === true || a.next_commit === "日付つき次回";
  const g = { G1: !!contact, G2: !!contact && over2m !== false, G3: !!contact && g3, G4: !!contact && g4 };
  g.firstFail = ["G1", "G2", "G3", "G4"].find((k) => !g[k]) || null;
  return g;
}

// 相手側・リスト側の要因（架電者の減点ではない）と、減点しなかった項目
function listNotes(a) {
  const side = [];
  if (a.closed_window === true) side.push("決める時期が閉じている（今年度は入れない等）");
  if (a.upstream === true) side.push("課題は集客（MOCHICA の領域外）");
  if (a.means_ok === true) side.push("今の手段で足りていると言った");
  if (a.understood === "分かっていない") side.push("MOCHICA が何か分からないまま");
  if (a.constraint && a.constraint !== "なし") side.push(`制約：${a.constraint}`);
  const list = [];
  if (a.dup_neo === true) list.push("ネオキャリアの他部署・他窓口と重複");
  if (a.list_bad) list.push(`リスト不良：${a.list_bad}`);
  const neutral = [];
  if (a.time_permission === true) neutral.push("time_permission");
  if (a.remember_q === true) neutral.push("remember_q");
  if (a.ask_form && a.ask_form !== "日時2択") neutral.push("ask_form");
  return { customer: side, list, neutral };
}

// ───────────────────────── まとめ（人・期間） ─────────────────────────
// items：[{ annotation, meta }] または diagnoseCall の結果を持つ [{ diagnosis, annotation }]
export function aggregate(items = []) {
  const rows = items.map((it) => ({ a: it.annotation || {}, d: it.diagnosis || diagnoseCall(it.annotation, it.meta || {}), m: it.meta || {} }));
  const reach = { none: 0, gate: 0, person: 0 };
  for (const r of rows) { const k = r.m.reach || (r.d.contact ? "person" : null); if (k && reach[k] != null) reach[k]++; }
  const contact = rows.filter((r) => r.d.contact);
  const over = contact.filter((r) => r.d.over2m !== false);
  const asked = contact.filter((r) => r.d.asked);
  const appo = contact.filter((r) => r.d.appo);
  const timing = asked.filter((r) => r.a.first_resp === "時期");
  const noAppoContact = over.filter((r) => !r.d.appo);
  const withClose = noAppoContact.filter((r) => r.a.next_commit);

  const k = {
    K1: [asked.filter((r) => r.d.over2m !== false).length, over.length],
    K2: [asked.filter((r) => r.a.denial === true).length, asked.length],
    K3: [asked.filter((r) => num(r.a.q_presumptive) > 0).length, asked.length],
    K4: [timing.filter((r) => ["日付を出し直す", "仮押さえ"].includes(r.a.after)).length, timing.length],
    K5: [asked.filter((r) => ["受諾", "時期"].includes(r.a.first_resp)).length, asked.filter((r) => r.a.first_resp && r.a.first_resp !== "保留").length],
    K6: [withClose.filter((r) => r.a.next_commit === "日付つき次回").length, withClose.length],
  };
  const kpis = MODEL.kpis.map((def) => {
    const [x, n] = k[def.id] || [0, 0];
    const v = rateOf(x, n);
    let status = "件数不足";
    if (n >= def.minN && v != null) {
      const good = def.target == null ? null : def.direction === "higher" ? v >= def.target : v <= def.target;
      const better = def.direction === "higher" ? v >= def.baseline : v <= def.baseline;
      status = good ? "目標達成" : better ? "基準より良い" : "基準より悪い";
    }
    return { ...def, x, n, value: round(v), status };
  });

  // 問題の場所：通話ごとの「失ったアポの見込み」を場所ごとに足す。根拠の強さで割り引いた値で並べる
  const byPoint = {};
  for (const r of rows) for (const f of r.d.findings || []) {
    const b = (byPoint[f.point] ||= { point: f.point, label: f.label, calls: 0, lostAppo: 0, weighted: 0, evidence: f.evidence, fix: f.fix, examples: [] });
    b.calls++;
    b.lostAppo += f.lostAppo || 0;
    b.weighted += f.weighted || 0;
    if (b.examples.length < 3 && f.quote) b.examples.push(f.quote);
  }
  const points = Object.values(byPoint).map((b) => ({ ...b, lostAppo: round(b.lostAppo, 2), weighted: round(b.weighted, 2) }))
    .sort((x, y) => y.weighted - x.weighted || y.calls - x.calls);

  // てこ：指標を目標まで上げたときのアポの倍率（構造方程式から）
  const k1 = kpis.find((x) => x.id === "K1"), k4 = kpis.find((x) => x.id === "K4");
  const levers = [];
  if (k1.value != null && k1.n >= k1.minN && k1.value < k1.target) levers.push({ id: "K1", label: "打診率を80%に", multiplier: round(k1.target / Math.max(k1.value, 0.01), 2) });
  if (k4.value != null && k4.n >= k4.minN && k4.value < k4.target && asked.length) {
    const share = timing.length / asked.length;
    const cur = asked.reduce((s, r) => s + pActualOf(r.a, r.d.callType, r.d.over2m), 0) / asked.length;
    const gain = share * (k4.target - k4.value) * (MODEL.rates.timingRedate - MODEL.rates.timingOther);
    if (cur > 0) levers.push({ id: "K4", label: "時期の返事への出し直しを90%に", multiplier: round((cur + gain) / cur, 2) });
  }

  const firstResp = {};
  for (const r of asked) { const f = r.a.first_resp || "不明"; firstResp[f] = (firstResp[f] || 0) + 1; }
  const gateFail = {};
  for (const r of contact) { const g = r.d.gates?.firstFail || "通過"; gateFail[g] = (gateFail[g] || 0) + 1; }
  const side = {};
  for (const r of contact) for (const s of [...(r.d.notes?.customer || []), ...(r.d.notes?.list || [])]) side[s] = (side[s] || 0) + 1;

  return {
    model: `${MODEL.name} v${MODEL.version}`,
    counts: { calls: rows.length, reach, contact: contact.length, over2m: over.length, asked: asked.length, appo: appo.length },
    funnel: {
      over2m: round(rateOf(over.length, contact.length)), ask: round(rateOf(k.K1[0], k.K1[1])),
      askToAppo: round(rateOf(asked.filter((r) => r.d.appo).length, asked.length)), baseline: MODEL.funnel.baseline,
    },
    kpis, problem: points[0] || null, points, levers, firstResp, gateFail, sideFactors: side,
    neutral: MODEL.neutral.map((n) => ({ ...n, calls: contact.filter((r) => (r.d.notes?.neutral || []).includes(n.key)).length })),
    caution: "数字は内線814（MOCHICA）の実測から。件数が少ない期間は「件数不足」。アポ数だけでなく有効商談（SS02）も一緒に見る（早い打診＋日付のアポは SS02 になりにくい可能性：14% vs 40%、32件のみ）。",
  };
}
