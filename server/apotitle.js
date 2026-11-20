// apotitle.js — 予定名から「商談が無い予定（リスケ・キャンセル）」かどうかを決める（2026-11-20 田中さん）。
//
// 予定名に「リスケ」「キャンセル」があると、その予定は商談が無いもの（空き・アポに数えない・メールを送らない）として扱ってきた。
// ただし「リスケ再設定」（リスケのあとに決め直した新しい日程）は、実際に商談がある。
// 「リスケ再設定というタイトルのものは商談があると判断してほしい」ので、「再設定」が付いていれば商談ありにする。
// 「キャンセル」が書いてあるものは、再設定と書いてあっても無くなった事実を優先して商談なしのまま。

// リスケのあとに決め直した予定（商談がある）
export function isReschedResetTitle(title) {
  const t = String(title || "").normalize("NFKC").replace(/[\s　]/g, "");
  return /再設定/.test(t) && !/(キャンセル|cancel|中止)/i.test(t);
}
// 商談が無い予定（リスケ・キャンセル）。リスケ再設定は商談ありなので false
export function isNoMeetingTitle(title) {
  const t = String(title || "");
  if (!/リスケ|ﾘｽｹ|キャンセル|ｷｬﾝｾﾙ/.test(t)) return false;
  return !isReschedResetTitle(t);
}
