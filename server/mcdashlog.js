// kinbot for MOCHICA のダッシュボード：架電の記録（mc_call_logs）を、人×日の数に集計する（2026-11-19 福井）
//
// なぜ作ったか：
//   ダッシュボードのインサイドの数字（コール・接続・担当者到達・ホット）は Zoom Phone の通話秒数から
//   「10秒以上ならつながった」「30秒以上なら担当者」と推定していた。推定なので、実際に架電画面へ記録した
//   結果（つながらない／受付まで／担当者と話せた／アポ）とずれる。ここでは記録した結果をそのまま数える。
//
// DB も通信も使わない純粋な関数だけにして、node で直接試せるようにしている（mchot.js と同じ作り）。
//
// 数え方（ここを変えたら画面の説明文＝public/mcdash.html の STEPS と isNote も合わせる）：
//   コール   … 記録1件＝1コール（元に戻した記録は数えない）
//   つながった … reach が gate（受付まで）か person（担当者と話せた）。none（応答なし・話し中・留守電・番号NG）は含めない
//   担当者   … reach = person
//   アポ     … outcome = apo
//   ホット   … 担当者と話せて、検討時期（月で聞けたもの。「未定」は除く）と採用ニーズの両方を聞けた企業
//              （mchot.js の「ニーズ・検討時期が聞けたらホット」と同じ考え方）
//   企業の数 … 同じ人が同じ月に同じリードへ何度かけても1社。月の最初に数えた日に1つ足す
import { foldPersonName, rosterHit } from "./mcname.js";   // 名前の照合（異体字・姓名の順などをそろえる）

// 列の並び（サーバーと画面で同じ順を使う）
export const LOG_COLS = ["calls", "reached", "person", "apo", "uniq", "uniqReached", "uniqHot", "gate", "none"];
const IDX = Object.fromEntries(LOG_COLS.map((c, i) => [c, i]));

// 検討時期が「月で聞けた」とみなす値。mccall.js の MONTHS（1月〜12月）と「未定」に合わせる
const hasWhen = (h) => !!h && !!String(h.when || "").trim() && String(h.when).trim() !== "未定";
const hasNeed = (h) => !!h && !!String(h.need || "").trim();

// rows：{ day:"YYYY-MM-DD"（JST）, who:名簿の人のキー（または空）, leadId, reach, outcome, hearing }
//   who が空の行は名簿に居ない人の記録。数えずに unmatched へ回す（黙って捨てない）
// 返す：{ cols, byOwnerDay:{ who:{ day:[…LOG_COLS の順…] } }, unmatched:{ 呼び出した人の識別:件数 }, total }
export function aggregateLogs(rows, label = "") {
  const by = {};
  const seen = new Map();   // who|月 → [企業の集合（かけた）, つながった, ホット]
  const unmatched = {};
  let total = 0;
  const sorted = [...rows].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  for (const r of sorted) {
    total++;
    if (!r.who) { const k = r.caller || "（記録した人が不明）"; unmatched[k] = (unmatched[k] || 0) + 1; continue; }
    const a = ((by[r.who] = by[r.who] || {})[r.day] = by[r.who][r.day] || new Array(LOG_COLS.length).fill(0));
    const reached = r.reach === "gate" || r.reach === "person";
    const person = r.reach === "person";
    a[IDX.calls]++;
    if (reached) a[IDX.reached]++;
    if (person) a[IDX.person]++;
    if (r.outcome === "apo") a[IDX.apo]++;
    if (r.reach === "gate") a[IDX.gate]++;
    if (r.reach === "none") a[IDX.none]++;
    // 企業の数：リードが分からない行（lead_id なし）は数えない（番号違いの同じ会社を二重に数えるより安全）
    if (r.leadId != null) {
      const k = r.who + "|" + r.day.slice(0, 7);
      const sv = seen.get(k) || [new Set(), new Set(), new Set()];
      seen.set(k, sv);
      const hot = person && hasWhen(r.hearing) && hasNeed(r.hearing);
      [true, reached, hot].forEach((ok, i) => {
        if (ok && !sv[i].has(r.leadId)) { sv[i].add(r.leadId); a[[IDX.uniq, IDX.uniqReached, IDX.uniqHot][i]]++; }
      });
    }
  }
  return { source: "kinbot_mc_call_logs", period: label, cols: LOG_COLS, byOwnerDay: by, unmatched, total };
}

// 呼び出した人（メール）→ 名簿の人のキー。名前の照合は index.js の internAccess と同じ mcname.js でそろえて比べる
//   roster：MCDASH_ROSTER.is、names：メール→名前（kinbot の利用者・Zoom の利用者の両方を混ぜたもの）
export function whoOf(email, roster, names, people = null) {
  // 名簿にメールで登録された人は、名前を見ずにその人にする（2026-11-23）。メールが未登録の人だけ名前で補う
  const e = String(email || "").toLowerCase();
  const rec = people && people.get(e);
  if (rec) { const p = rec.kind === "is" ? roster.find((x) => x.sf === rec.key) : null; return p ? p.zoom : ""; }
  const taken = new Set(people ? [...people.values()].filter((v) => v.kind === "is").map((v) => v.key) : []);
  const open = roster.filter((x) => !taken.has(x.sf));
  const list = names.get(e) || [];
  for (const n of list) {
    const t = foldPersonName(n); if (!t) continue;
    const p = rosterHit(n, open) || open.find((x) => foldPersonName(x.name) === t);
    if (p) return p.zoom;   // 画面は人を zoom の名前で引く（calls の byOwnerDay と同じキー）
  }
  return "";
}
