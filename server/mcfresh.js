// mcfresh.js — 企業調査の「採用の情報」が、今の募集かどうかを見分ける（2026-11-23 福井さん）
//   「過去掲載情報や過去採用情報ではなく今の採用情報を適切に抽出できているか」「テストを通った情報しか表示されないように」
//
// 考え方：採用の項目（求人媒体・募集職種・採用人数・採用の実態、そこから組み立てる課題と切り口）は、
//   根拠の文に「今の募集だ」と言える印（今の卒年・今年度・1年以内の掲載日）があり、「終わった」印（掲載終了・採用実績など）が無いときだけ残す。
//   どちらとも言えない（日付の無い検索結果など）は出さない。外れた情報で架電者が「リクナビで拝見して」と言ってしまうほうが害が大きいので。
// 通信はしない（決まった文の判定だけ）。確かめは dev/mcresearch_check.mjs
export const CHECK_V = 1;                 // 確かめ方を変えたら上げる（古い確かめ方の結果は出さずに調べ直す）
export const RECRUIT_KEYS = ["hiring", "roles", "headcount", "media", "issue", "hook"];
export const STALE_DAYS = 60;             // 調べてからこれより経った採用の情報は出さない（募集は数か月で入れ替わる）

const N = (s) => String(s || "").normalize("NFKC");

// 今の年度と、今の募集に当たる卒年（日本時間で数える）
//   例 2026-11：年度 2026、今の卒年は 27卒（2027年3月卒・まだ募集中）〜 29卒（インターン）。26卒以前は終わった募集
export function recruitClock(now = new Date()) {
  const j = new Date(now.getTime() + 9 * 3600e3);
  const y = j.getUTCFullYear(), m = j.getUTCMonth() + 1;
  const fy = m >= 4 ? y : y - 1;
  return { y, m, fy, gradMin: fy + 1, gradMax: fy + 3, ym: y * 12 + (m - 1) };
}

// 終わった印（この文の募集はもう無い）
// 終わった印（この文の募集はもう無い）。「掲載終了予定日」「募集締切：12/7」「応募多数の場合は締め切ることがあります」は
//   これからの話なので拾わない（2026-11-23 の精度調査で、今の掲載を「終わった」と取り違えていた）
const CLOSED_RE = new RegExp([
  "(?:掲載|募集|受付|エントリー(?:受付)?|応募(?:受付)?|採用(?:活動)?)(?:の受付)?(?:は|を|が)?(?:終了|締め?切|〆切)(?:しました|いたしました|致しました|して(?:い|お)ります|しています|りました|らせていただきました|っております|させていただきました)",
  "掲載期間(?:が|は)?(?:終了しました|終了しています|過ぎ)",
  "(?:この|本|こちらの)(?:求人|案件|ページ)(?:の掲載)?(?:は|の)?(?:掲載|募集)?(?:は|を)?終了",
  "【掲載終了】|\\[掲載終了\\]|［掲載終了］|(?:^|[\\s|｜・/])(?:掲載終了|募集終了|受付終了)(?=$|[\\s|｜・/】）)」])",
  "(?:現在|ただいま)[、,]?(?:は)?(?:募集|採用)(?:は|を)?(?:行って|して|おこなって)(?:い|お)?(?:ません|りません)",
  "現在[、,]?募集(?:中)?の(?:求人|職種)は(?:ありません|ございません)",
  "求人情報が見つかりません|お探しの(?:ページ|求人)(?:は|が)見つかりません|ページが見つかりません",
].join("|"));
export const isClosed = (text) => CLOSED_RE.test(N(text));
// 過去の印（実績・前年の話。人数や職種の根拠にしない）
const PAST_RE = /採用実績|入社実績|過去の(?:求人|採用|募集|実績)|前年度|昨年度|前年|昨年|これまでの採用/;

// 卒年（2桁・4桁）・「マイナビ2027」・「2027年4月入社」・「2027年度新卒」
export function gradYears(text) {
  const t = N(text); const out = new Set();
  const add = (v) => { let y = +v; if (y < 100) y += 2000; if (y >= 2005 && y <= 2045) out.add(y); };
  for (const m of t.matchAll(/(?<!\d)(20\d\d|\d\d)\s*年?\s*(?:3月)?\s*卒(?!業生)/g)) add(m[1]);
  for (const m of t.matchAll(/(?:マイナビ|リクナビ|キャリタス|あさがく(?:ナビ)?|学情|ONE ?CAREER|就職ナビ)\s*(20\d\d)(?!\d)/gi)) add(m[1]);
  for (const m of t.matchAll(/(?<!\d)(20\d\d)\s*年\s*(?:4月|春)?\s*(?:新卒)?\s*入社/g)) add(m[1]);
  for (const m of t.matchAll(/(?<!\d)(20\d\d|\d\d)\s*年度\s*(?:新卒|新入社員|入社|卒)/g)) add(m[1]);
  return [...out].sort();
}
// 「2025年度採用」「2025年度 募集」の年度（入社の年度とは別に、募集の年度を言っているもの）
export function fiscalYears(text) {
  const out = new Set();
  for (const m of N(text).matchAll(/(?<!\d)(20\d\d)\s*年度\s*(?:の)?\s*(?:採用|募集|中途|キャリア|求人)/g)) out.add(+m[1]);
  return [...out].sort();
}
// 掲載・更新・受付などの日付（年月）。設立・創業・生年などの日付は拾わない。
//   検索結果の頭に付く日付（「2023/05/12 · 」「2023年5月12日 — 」）も掲載の日付として数える
export function postedMonths(text) {
  const t = N(text); const out = [];
  const D = /(20\d\d)\s*[年/.\-]\s*(\d{1,2})(?:\s*[月/.\-]\s*(?:\d{1,2}\s*日?)?)?/g;
  for (const m of t.matchAll(D)) {
    const mo = +m[2]; if (mo < 1 || mo > 12) continue;
    const before = t.slice(Math.max(0, m.index - 16), m.index);
    const head = m.index <= 2 && /^\s*[·・—\-–|]/.test(t.slice(m.index + m[0].length, m.index + m[0].length + 4));
    if (/設立|創業|創立|生まれ|生年|誕生|開業|開設|竣工|上場|資本金/.test(before)) continue;
    if (!head && !/掲載|更新|公開|投稿|受付|応募|募集|締切|締め切|期限|開始|終了|期間|情報|日付|求人|最終/.test(before)) continue;
    out.push(+m[1] * 12 + (mo - 1));
  }
  return out;
}

// 1つの根拠の文が「今の募集」か。verdict：current（今の募集と言える）／past（終わった・過去）／unknown（決め手が無い）
//   scope "snippet"：検索結果の説明文や、値の前後の短い文。卒年・年度・日付・実績のどれでも決める
//   scope "page"：求人ページ全体。ページの中には別の年の実績・前年度の話・メニューの「マイナビ2028」なども混ざるので、
//     決め手は「終わった印」と「掲載・更新の日付」だけにする（newgrad：新卒の求人ページは卒年も見る）
export function freshness(text, clock = recruitClock(), { scope = "snippet", newgrad = true } = {}) {
  const t = N(text);
  if (!t.trim()) return { verdict: "unknown", why: "文が無い" };
  const closed = t.match(CLOSED_RE);
  if (closed) return { verdict: "past", why: `「${closed[0].trim()}」とある` };
  const page = scope === "page";
  const g = page && !newgrad ? [] : gradYears(t);
  const gNow = g.filter((y) => y >= clock.gradMin && y <= clock.gradMax);
  if (gNow.length) return { verdict: "current", why: `${String(gNow[gNow.length - 1]).slice(2)}卒の募集` };
  const fys = page ? [] : fiscalYears(t);
  if (fys.some((y) => y >= clock.fy)) return { verdict: "current", why: `${Math.max(...fys)}年度の募集` };
  const ms = postedMonths(t).filter((v) => v <= clock.ym + 1);
  const last = ms.length ? Math.max(...ms) : null;
  if (last != null && clock.ym - last <= 12) return { verdict: "current", why: `${Math.floor(last / 12)}年${(last % 12) + 1}月の掲載・更新` };
  if (last != null) return { verdict: "past", why: `${Math.floor(last / 12)}年${(last % 12) + 1}月の掲載（1年より前）` };
  if (page) return { verdict: "unknown", why: "ページに掲載・更新の日付が無い" };
  if (g.length) return { verdict: "past", why: `${g.map((y) => `${String(y).slice(2)}卒`).join("・")}の情報（今は${String(clock.gradMin).slice(2)}卒〜）` };
  if (fys.length) return { verdict: "past", why: `${Math.max(...fys)}年度の情報` };
  if (PAST_RE.test(t)) return { verdict: "past", why: `「${t.match(PAST_RE)[0]}」の話` };
  return { verdict: "unknown", why: "今の募集かを決める日付・卒年が無い" };
}

// 文の中の一か所（採用人数・職種など）の前後を見て、その値が今の募集のものか。
//   pageCurrent：その文全体（求人ページ）が今の募集と確かめられている
export function snippetAround(text, index, len, before = 80, after = 30) {
  const t = N(text); return t.slice(Math.max(0, index - before), Math.min(t.length, index + len + after));
}
export function valueFreshness(text, index, len, { clock = recruitClock(), pageCurrent = false } = {}) {
  const ctx = snippetAround(text, index, len);
  if (PAST_RE.test(ctx)) return { verdict: "past", why: `「${ctx.match(PAST_RE)[0]}」の値` };
  const f = freshness(ctx, clock);
  if (f.verdict !== "unknown") return f;
  return pageCurrent ? { verdict: "current", why: "今の募集と確かめた求人ページの値" } : f;
}

// 画面に出す前の最後の関所：今の確かめ方（CHECK_V）で確かめ、STALE_DAYS 以内の採用の項目だけを残す。
//   それ以外（確かめる前に調べた古い結果・古くなった結果）は採用の項目を空にして、なぜ出さないかを添える
export function showableResearch(r, now = new Date()) {
  if (!r || typeof r !== "object" || r.status === "error") return r;
  const ok = r.check && r.check.v === CHECK_V;
  const age = (now - new Date((r.check && r.check.at) || r.at || 0)) / 86400e3;
  if (ok && age <= STALE_DAYS) return r;
  const out = { ...r };
  for (const k of RECRUIT_KEYS) out[k] = "";
  out.recruitHidden = ok ? "stale" : "unverified";
  return out;
}
