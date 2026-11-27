// MOCHICA のチーム制（インサイド IS とフィールドセールス FS の組）（2026-11-23 福井さん）
//
// なぜ要るか：
//   テレアポは IS と FS のチームで動いている（餌取チーム・斎藤チーム）。同じチームの IS が取ったアポは、
//   同じチームの FS に渡す決まり。日程の候補もアポの担当も、まず自分のチームの FS から選ぶ。
//
// チームの持ち方：
//   1. 設定 → メンバー管理の「チーム」（members.team）があれば、それを使う（管理者が画面で直せる）
//   2. 無い人は、ダッシュボードの名簿（server/mcdash.js の MCDASH_ROSTER）に書いた既定のチーム
//   「餌取チーム」「餌取」「斉藤チーム」「齊藤」は同じチームとして扱う（書き方の違いで別チームにならないように）
//
// DB も外の通信も使わない純粋な関数だけにしてある（dev/mcteam_check.mjs で確かめられるように）。

import { MCDASH_ROSTER } from "./mcdash.js";

const nz = (v) => String(v || "").normalize("NFKC").replace(/[\s　]/g, "");
// 名前を比べるときは、よくある異体字もそろえる（kinbot の登録名が「頼」、SF が「賴」のような違いで外れないように）
const VARIANT = { 齊: "斎", 斉: "斎", 齋: "斎", 賴: "頼", 髙: "高", 﨑: "崎", 邊: "辺", 邉: "辺", 濵: "浜", 濱: "浜" };
const nameKey = (v) => nz(v).replace(/[齊斉齋賴髙﨑邊邉濵濱]/g, (c) => VARIANT[c]);

// チームの鍵：空白・「チーム」を落とし、斎藤の異体字（齊・斉）をそろえる
//   「ランダム」は、どのチームにも属さない印（2026-11-27 福井さん）。空の鍵にして、
//   IS ならチームを問わず空いている FS から選び、FS ならどのチームの IS のアポも（自チームの FS が空いていないときの代わりとして）受ける。
//   名簿の既定のチームより優先したいので、teamOf では「チーム欄に何か入っている」扱いのまま空を返す
export const RANDOM_TEAM = "ランダム";
export function teamKey(v) {
  const k = nz(v).replace(/チーム$/, "").replace(/[齊斉齋]/g, "斎");
  return k === RANDOM_TEAM ? "" : k;
}
export const teamLabel = (k) => (k ? `${k}チーム` : "");

// 名簿の既定のチーム（名前 → チームの鍵）。名簿の SF 名・Zoom 名・苗字だけの名前のどれでも引けるようにする
function rosterTeams(roster = MCDASH_ROSTER) {
  const m = new Map();
  for (const p of [...(roster.sales || []), ...(roster.is || [])]) {
    if (!p.team) continue;
    for (const n of [p.key, p.sf, p.zoom]) if (n) m.set(nameKey(n), teamKey(p.team));
  }
  return m;
}

// その人のチームの鍵。members（メンバー管理）を先に見て、無ければ名簿の既定
//   person：{ email, name }、members：listMembers() の結果
export function teamOf(person, members = [], roster = MCDASH_ROSTER) {
  const em = String((person && person.email) || "").toLowerCase();
  const mm = em ? (members || []).find((m) => String(m.email || "").toLowerCase() === em) : null;
  if (mm && String(mm.team || "").trim()) return teamKey(mm.team);
  const names = [person && person.name, mm && mm.name].filter(Boolean).map(nameKey);
  const rt = rosterTeams(roster);
  for (const n of names) if (rt.has(n)) return rt.get(n);
  return "";
}

// その時間に空いている FS を「自分のチーム → 他チーム」の順に分ける
//   free：空いている FS（{ email, name, team }）。mine が空のときだけ other を使う
export function splitFree(free, myTeam) {
  if (!myTeam) return { mine: free.slice(), other: [], useOther: false };
  const mine = free.filter((c) => c.team === myTeam), other = free.filter((c) => c.team !== myTeam);
  return { mine, other, useOther: !mine.length && other.length > 0 };
}

// 候補の点数：自分のチームの FS が空いている枠を必ず上にする（他チームだけの枠は、自チームの枠が無いときの代わり）
export function slotScore(free, myTeam) {
  const s = splitFree(free, myTeam);
  return s.mine.length ? 100 + s.mine.length : s.other.length;
}

// アポの担当 FS を決める
//   closers：MOCHICA の FS 全員（並びはメンバー管理の順）
//   busyOk：email → true（空いている）／false（予定あり）／null（カレンダーを読めない）
//   決まり：①自分のチームで空いている人 ②いなければ他チームで空いている人（other）
//           ③だれも空いていない・読めないときは、自分のチームの FS を担当にして「予定が重なる」と知らせる（アポを落とさない）
export function pickFs(closers, busyOk, myTeam) {
  const free = closers.filter((c) => busyOk.get(c.email) === true);
  const s = splitFree(free, myTeam);
  if (s.mine.length) return { ...s.mine[0], other: false, conflict: false };
  if (s.other.length) return { ...s.other[0], other: !!myTeam, conflict: false };
  const own = myTeam ? closers.filter((c) => c.team === myTeam) : [];
  if (own.length) return { ...own[0], other: false, conflict: true, unread: busyOk.get(own[0].email) == null };
  return null;
}
