// リードの状況（SF の Lead.Status）の基本の7つ（2026-11-24 福井さん「選択肢が煩雑。SF の基本の 01〜05・89・99 だけ選べるように」）。
//   SF の選択リストには、名前の付け方が違う同じ段階（「NEW」「LS:01　New」「01：新規」など）が何世代も有効のまま残っている。
//   MOCHICALL では番号ごとに1つだけ出し、意味も添える。番号の値が SF で有効でなければ、その番号は出さない（書けない値を出さない）。
export const LEAD_STAGES = [
  { code: "01", name: "新規", desc: "リストに入ったまま、まだ一度もかけていない" },
  { code: "02", name: "担当者未接触", desc: "かけたが、採用の担当者とは話せていない（受付で止まった・不在・つながらない）" },
  { code: "03", name: "コネクト情報獲得", desc: "担当者と話せて、採用の状況など次につながる情報を聞けた（アポ・見送りはまだ決まっていない）" },
  { code: "04", name: "ジャッジ", desc: "担当者が今回は見送りと判断した（時期が合わない・今は採用予定なし など）。時期を見てまたかける" },
  { code: "05", name: "コンバート", desc: "アポが取れて商談になった（SF で取引先・商談に変える段階）" },
  { code: "89", name: "リサイクル", desc: "いったん外して、時期を空けてまたかけるリストに戻す（過去の失注・長く連絡が取れない など）" },
  { code: "99", name: "アーカイブ", desc: "今後かけない（廃業・重複・番号が使われていない・アプローチ禁止 など）" },
];

// 値の頭の番号。「01：新規」「04ジャッジ」「LS:89　リサイクル」のどれでも番号を返す。番号が無い（「NEW」など）は ""
export function stageCode(v) {
  const m = String(v || "").normalize("NFKC").match(/^\s*(?:LS\s*:\s*)?(\d{2})(?!\d)/i);
  return m ? m[1] : "";
}

// SF の有効な選択肢から、基本の7つを番号の順に1つずつ選ぶ。
//   同じ番号が複数あれば「01：新規」の形（全角コロン）→ 番号＋名前が同じもの → 番号付き（LS: 以外）→ LS: の順に選ぶ
export function pickLeadStages(all = []) {
  const out = [];
  for (const s of LEAD_STAGES) {
    // SF の今の基本の値は、値が名前だけ（「ジャッジ」）で、番号は表示名のほう（「04：ジャッジ」）に付いている。
    //   値だけで番号を見ると 03・04・05 などが見つからず、選べるステージが古い LS: の値だけになっていた（2026-11-24 田中さん「kincall でステージ選択ができない」）。
    //   なので値と表示名の両方で番号を見て、表示名が「04：ジャッジ」の形のものをいちばんに選ぶ
    const codeOf = (x) => stageCode(x.value) || stageCode(x.label);
    const cands = all.filter((x) => codeOf(x) === s.code);
    if (!cands.length) continue;
    const want = `${s.code}：${s.name}`;
    const norm = (v) => String(v || "").normalize("NFKC").replace(/[\s:：　]/g, "");
    const rank = (x) => (x.value === want || x.label === want ? 0 : norm(x.value) === norm(want) || norm(x.label) === norm(want) ? 1 : /^\s*\d{2}：/.test(x.value) || /^\s*\d{2}：/.test(x.label) ? 2 : /^\s*LS/i.test(x.value) ? 4 : 3);
    const best = [...cands].sort((a, b) => rank(a) - rank(b))[0];
    out.push({ value: best.value, label: `${s.code}：${s.name}`, desc: s.desc });
  }
  return out;
}

// 今の値が7つのどれにあたるか（番号が無い古い値は名前で見る。「NEW」→01、「リサイクル」→89 など）。当てはまらなければ null
export function stageOf(v) {
  const c = stageCode(v);
  if (c) return LEAD_STAGES.find((s) => s.code === c) || null;
  const t = String(v || "").normalize("NFKC").trim().toLowerCase();
  if (/^(new|新規)$/.test(t)) return LEAD_STAGES[0];
  return LEAD_STAGES.find((s) => t === s.name.toLowerCase()) || null;
}

// 表記ゆれを7つのどれにそろえるか（2026-11-24 福井さん「表記ゆれも7つの表記に統合および正規化」）。
//   番号・名前で決まるもの（stageOf）に加えて、SF の最初からある値と旧い運用の名前もここで決める。
//   どれにも当たらない値は null（そろえずに残し、画面に「対応なし」と出して人が決める）
const ALIAS = new Map([
  ["潜在顧客", "01"], ["open", "01"], ["未対応", "01"],
  ["アプローチ済", "02"], ["アプローチ中", "02"], ["接触", "02"],
  ["担当者接触", "03"], ["qualified", "03"],
  ["ナーチャリング", "04"],
  ["アポ獲得", "05"], ["converted", "05"],
]);
export function normCode(v) {
  const s = stageOf(v); if (s) return s.code;
  const t = String(v || "").normalize("NFKC").replace(/^\s*LS\s*:\s*\d{2}/i, "").replace(/^\s*\d{2}\s*[:：]?/, "").trim().toLowerCase();
  if (!t) return null;
  const byName = LEAD_STAGES.find((x) => x.name.toLowerCase() === t); if (byName) return byName.code;
  return ALIAS.get(t) || null;
}

// 架電のあと、結果からリードの状況を自動で進める（2026-11-24 福井さん「架電後に自動でセールスステージも変更」）。
//   ・進めるだけで戻さない（04 ジャッジのリードに不在が付いても 02 に戻さない）。05 コンバートは自動では触らない上限
//   ・99 アーカイブは触らない（かけないと決めたものを、架電の結果で勝手に戻さない）
//   ・89 リサイクルはまたかけ始めたものなので、最初（01 と同じ）から数える
//   ・番号不備（現在使われておりません）でも 99 にはしない（会社が無いとは限らないため。02 まで）
//   ・7つのどれにあたるか決められない値（独自の値）は触らない。空は 01 と同じに扱う
//   返すのは変える先の番号。変えないときは null
const RANK = { "01": 1, "02": 2, "03": 3, "04": 4, "05": 5, "89": 0 };
export function targetCode({ reach, outcome } = {}) {
  if (reach === "person") return outcome === "apo" ? "05" : outcome === "reject" ? "04" : ["follow", "doc_send", "inquiry"].includes(outcome) ? "03" : null;
  if (reach === "gate" || reach === "none") return "02";
  return null;
}
export function autoStage(call, current) {
  const to = targetCode(call); if (!to) return null;
  const now = String(current || "").trim() ? normCode(current) : "01";
  if (now == null || now === "99") return null;   // 7つのどれか決められない値は、人が付けた意味が分からないので触らない
  const r = RANK[now] ?? 0;
  return RANK[to] > r ? to : null;
}
