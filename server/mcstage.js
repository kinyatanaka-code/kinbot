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
    const cands = all.filter((x) => stageCode(x.value) === s.code);
    if (!cands.length) continue;
    const want = `${s.code}：${s.name}`;
    const norm = (v) => String(v || "").normalize("NFKC").replace(/[\s:：　]/g, "");
    const rank = (x) => (x.value === want ? 0 : norm(x.value) === norm(want) ? 1 : /^\s*\d{2}：/.test(x.value) ? 2 : /^\s*LS/i.test(x.value) ? 4 : 3);
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
