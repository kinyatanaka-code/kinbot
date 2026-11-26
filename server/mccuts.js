// リスト管理の「切り口」タブ（2026-11-27 福井さん「18の切り口で全件把握」「今かける理由と保存した絞り込み」）
//   MOCHICALL のリード（mc_call_leads。SF・BALES・CSV・DOC から入れたもの）を、18の切り口ごとの件数とアポ率で見る。
//   押すと条件に足し（含む／除く）、条件どうしは「すべて満たす」か「どれかを満たす」。
//   軸の式は「条件で割り振る」（SEG_DIMS）と同じものを使う（画面ごとに数が食い違わないように）。
//   本番にまだデータが無い切り口は、件数を作らずに「まだ無い／一部だけ」と出す（空のまま壊れないように）。
//   読むのは DB だけ。外のサービス（SF・ASUMO など）は呼ばない
import { dbPool, mcBalesTiers, mcBalesSetLeadSource } from "./db.js";
import { SEG_DIMS, SEG_CONDS, WHEN_M, refreshSeg } from "./mccall.js";

const P = () => dbPool();
const BIZ = "MOCHICA";
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// アポ率（いまある数え方）：アポ＝前回の結果が「アポ獲得」のリード ÷ 架電したリード（前回の結果が未架電でないもの）。
//   別の作業でアポの見込み（予測）ができたら、ここの2つの式を置き換えるだけで、画面のアポ率がそちらに変わる
const apoRate = () => ({ apo: `((${SEG_DIMS.lastResult.sql}) ~ 'アポ獲得')`, called: `((${SEG_DIMS.lastResult.sql}) <> '未架電')` });

// 切り口の並び。st：ok＝本番で数えられる／part＝一部だけ（データが少ない・推定まじり）／none＝まだ無い（件数を出さない）
//   mccall.js と読み込みが輪になっているので、SEG_DIMS を使う式は呼ばれたときに作る
let _cuts = null;
function cuts() {
  if (_cuts) return _cuts;
  const MN = `(SELECT m.data FROM mc_mynavi m WHERE m.ckey = c.seg->>'ckey')`;
  const when = `CASE WHEN ${WHEN_M} < 0 THEN '時期が過ぎた' WHEN ${WHEN_M} = 0 THEN '今月' WHEN ${WHEN_M} = 1 THEN '来月' WHEN ${WHEN_M} <= 3 THEN '2〜3か月後' WHEN ${WHEN_M} IS NOT NULL THEN '4か月以上先'
    WHEN c.hearing->>'when' = '未定' THEN '未定と言われた' ELSE '分からない' END`;
  const d = (k) => ({ sql: SEG_DIMS[k].sql, multi: !!SEG_DIMS[k].multi, none: SEG_DIMS[k].none, order: SEG_DIMS[k].order });
  _cuts = [
    { k: "source", no: 1, label: "リードソース", st: "ok", src: "SF の LeadSource／BALES の leadSources／CSV の列", ...d("source"), top: 12 },
    { k: "hot", no: 2, label: "ホット／ウォーム／コールド", st: "ok", src: "担当者名・ニーズ・検討時期のそろった数（3＝ホット・2＝ウォーム・1以下＝コールド）", ...d("hot") },
    { k: "stage", no: 3, label: "リードステージ", st: "ok", src: "BALES・SF・DOC のステージ（取り込んだときの値）", ...d("stage"), top: 12 },
    { k: "lastResult", no: 4, label: "最終架電の結果", st: "ok", src: "MOCHICALL の前回の結果と BALES の架電結果の新しい方", ...d("lastResult"), top: 12 },
    { k: "lost", no: 5, label: "失注理由", st: "part", src: "SF の失注理由（大）。SF から足したリードだけ（BALES・CSV には失注の情報が無い）", ...d("lost"), top: 12 },
    { k: "when", no: 6, label: "予算検討時期", st: "part", src: "架電で聞いた検討時期（月）／SF の検討開始時期。データはまだ少ない", sql: when,
      order: ["今月", "来月", "2〜3か月後", "4か月以上先", "時期が過ぎた", "未定と言われた", "分からない"] },
    { k: "followup", no: 7, label: "設定済みの次回アクション", st: "ok", src: "MOCHICALL の掛け直し（約束・自動）", ...d("followup") },
    { k: "segments", no: 8, label: "採用ニーズ（採用区分）", st: "part", src: "企業調査・マイナビ・架電で聞いたことからの推定まじり", ...d("segments") },
    { k: "person", no: 9, label: "採用担当者名", st: "ok", src: "BALES の判定・SF の氏名・架電で聞けた名前", sql: `CASE WHEN ${SEG_CONDS.name.sql} THEN '判明している' ELSE '分からない' END`, order: ["判明している", "分からない"] },
    { k: "lostNext", no: 10, label: "失注の次回アクション日", st: "none", src: "SF の Lostopp_nextaction__c にはあるが、MOCHICALL にはまだ取り込んでいない" },
    { k: "resch", no: 11, label: "リスケ企業", st: "none", st2: "一部だけ", src: "SF の失注理由「リスケのため未商談」と kinbot のアポの日程変更にあるが、MOCHICALL のリードにリスケの印がまだ無い" },
    { k: "last", no: 12, label: "最終架電からの空き日数", st: "ok", src: "MOCHICALL と BALES の最後にかけた日時", ...d("last") },
    { k: "competitor", no: 13, label: "競合 ATS の利用", st: "part", src: "SF の ATS・バッティング負け／架電の断り理由。多くは空", ...d("competitor") },
    { k: "line", no: 14, label: "公式 LINE の利用", st: "none", st2: "一部だけ", src: "ヒアリングの LINE の項目だけで、ほとんど空。公式アカウントがあるかの調べはまだ無い" },
    { k: "mynavi", no: 15, label: "マイナビ掲載", st: "ok", src: "MOCHICALL のマイナビの調べ（調べた会社だけ）",
      sql: `CASE WHEN ${MN}->>'status' = 'listed' THEN '掲載あり' WHEN ${MN}->>'status' IN ('none','notfound') THEN '掲載なし' ELSE '未確認' END`, order: ["掲載あり", "掲載なし", "未確認"] },
    { k: "pref", no: 16, label: "都道府県", st: "ok", src: "住所 → 無ければ市外局番から推定", ...d("pref"), top: 12 },
    { k: "event", no: 17, label: "採用イベントの参加", st: "none", src: "参加日・参加したかを数えるには SF のキャンペーンメンバーを読む必要がある（今はリード元で代用するだけ）" },
    { k: "intent", no: 18, label: "インテント（ASUMO）", st: "none", src: "ASUMO のインテント（窓が開いている・予兆あり）は MOCHICALL にまだ無い" },
  ];
  return _cuts;
}
const live = () => cuts().filter((c) => c.st !== "none" && c.sql);

// 値が当たるかの式（1社に値が複数ある軸は「どれか」が当たれば）
function hitSql(c, p, vals) {
  p.push(vals); const i = p.length;
  return c.multi ? `(COALESCE(NULLIF(${c.sql}, '{}'), ARRAY[${lit(c.none || "不明")}]) && $${i}::text[])` : `((${c.sql}) = ANY($${i}::text[]))`;
}
const vals = (v) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x).slice(0, 80)).filter(Boolean))].slice(0, 100) : []);
// 条件 f = { inc: {軸: [値]}, exc: {軸: [値]}, mode: "all"|"any", q }。skip の軸は外して数える（その軸の中で選び足せるように）。
//   含む：同じ軸の中は「どれか」、軸どうしは mode。除く：mode によらず、いつも外す
function where(f, p, skip = "") {
  const inc = [], exc = [];
  for (const c of live()) {
    if (c.k === skip) continue;
    const a = vals((f.inc || {})[c.k]); if (a.length) inc.push(hitSql(c, p, a));
    const b = vals((f.exc || {})[c.k]); if (b.length) exc.push(`NOT ${hitSql(c, p, b)}`);
  }
  const w = [];
  if (inc.length) w.push(f.mode === "any" ? `(${inc.join(" OR ")})` : inc.join(" AND "));
  w.push(...exc);
  const q = String(f.q || "").trim().slice(0, 60).replace(/[\\%_]/g, (m) => `\\${m}`);
  if (q) { p.push(`%${q}%`); w.push(`concat_ws(' ', c.company, c.person, c.phone) ILIKE $${p.length}`); }
  return w;
}
// 数える範囲：閉じていない MOCHICA のリスト（キャリミキは除く）の、終わっていない・重複でないリード
async function scope() {
  return (await P().query(`SELECT id FROM mc_call_lists WHERE biz=$1 AND NOT closed AND COALESCE(product,'mochica') <> 'careermixer'`, [BIZ])).rows.map((r) => r.id);
}
const BASE = ["c.list_id = ANY($1::int[])", "NOT c.done", "c.dup_of IS NULL"];

let _savedInit = false;
async function ensureSaved() {
  if (_savedInit) return; _savedInit = true;
  // 保存した絞り込み（管理者どうしで共有する）。条件は画面の形（inc・exc・mode・q）のまま持つ
  await P().query(`CREATE TABLE IF NOT EXISTS mc_cut_saved (id SERIAL PRIMARY KEY, name TEXT NOT NULL, filters JSONB NOT NULL, by_user TEXT, created_at TIMESTAMPTZ DEFAULT now())`).catch(() => {});
}
const cleanFilters = (f) => {
  const x = f && typeof f === "object" ? f : {}; const keys = new Set(live().map((c) => c.k));
  const pick = (o) => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).filter(([k]) => keys.has(k)).map(([k, v]) => [k, vals(v)]).filter(([, v]) => v.length));
  return { inc: pick(x.inc), exc: pick(x.exc), mode: x.mode === "any" ? "any" : "all", q: String(x.q || "").slice(0, 60) };
};

export function registerMcCuts(app, { adminOnly, guard, isAdmin }) {
  // 18の切り口の件数・アポ率と、条件に合うリードの先頭50件
  app.post("/api/mccall/cuts", guard(async (req, res) => {
    const f = cleanFilters((req.body || {}).filters);
    const ids = await scope();
    // 属性（seg）をまだ計算していないリードがあれば、4秒までで埋める（残りは次に開いたとき）
    const filled = await refreshSeg(ids, { budgetMs: 4000 }).catch(() => 0);
    const A = apoRate();
    const out = await Promise.all(cuts().map(async (c) => {
      const head = { k: c.k, no: c.no, label: c.label, st: c.st, st2: c.st2 || "", src: c.src };
      if (c.st === "none" || !c.sql) return { ...head, items: [] };
      // 「どれかを満たす」のときは、ほかの軸を足すほど増える向きなので、除く・キーワードだけをかけて数える
      const p = [ids]; const w = [...BASE, ...where(f.mode === "any" ? { exc: f.exc, q: f.q } : f, p, c.k)];
      const vx = c.multi ? "v" : c.sql;
      const from = c.multi ? `mc_call_leads c, LATERAL unnest(COALESCE(NULLIF(${c.sql}, '{}'), ARRAY[${lit(c.none || "不明")}])) AS v` : "mc_call_leads c";
      let items = (await P().query(`SELECT ${vx} AS v, count(*) AS n, count(*) FILTER (WHERE ${A.apo}) AS apo, count(*) FILTER (WHERE ${A.called}) AS called
        FROM ${from} WHERE ${w.join(" AND ")} GROUP BY 1 ORDER BY 2 DESC LIMIT 120`, p)).rows.map((r) => ({ v: r.v, n: +r.n, apo: +r.apo, called: +r.called }));
      if (c.order) items.sort((a, b) => (c.order.indexOf(a.v) + 1 || 99) - (c.order.indexOf(b.v) + 1 || 99));
      // 多い軸は上位だけ出し、残りは「そのほか」にまとめる（選んでいる値は残す）
      if (c.top && items.length > c.top) { const keep = new Set([...vals((f.inc || {})[c.k]), ...vals((f.exc || {})[c.k])]);
        const head2 = items.filter((x, i) => i < c.top || keep.has(x.v)); const rest = items.filter((x) => !head2.includes(x));
        items = [...head2, { v: "", label: `そのほか ${rest.length}種類`, n: rest.reduce((a, x) => a + x.n, 0), apo: rest.reduce((a, x) => a + x.apo, 0), called: rest.reduce((a, x) => a + x.called, 0), rest: true }]; }
      return { ...head, multi: c.multi, items };
    }));
    const p = [ids]; const w = [...BASE, ...where(f, p)];
    const t = (await P().query(`SELECT count(*) AS n, count(*) FILTER (WHERE ${A.apo}) AS apo, count(*) FILTER (WHERE ${A.called}) AS called FROM mc_call_leads c WHERE ${w.join(" AND ")}`, p)).rows[0];
    const all = (await P().query(`SELECT count(*) AS n FROM mc_call_leads c WHERE ${BASE.join(" AND ")}`, [ids])).rows[0];
    const rows = (await P().query(`SELECT c.id, c.company, c.person, c.phone, c.assigned_to, (${SEG_DIMS.source.sql}) AS source, (${SEG_DIMS.hot.sql}) AS hot, (${SEG_DIMS.lastResult.sql}) AS last_result,
        (SELECT x.name FROM mc_call_lists x WHERE x.id = c.list_id) AS list
      FROM mc_call_leads c WHERE ${w.join(" AND ")} ORDER BY COALESCE(c.hot,0) DESC, c.id LIMIT 50`, p)).rows;
    res.json({ ok: true, filled, total: +t.n, apo: +t.apo, called: +t.called, all: +all.n, cuts: out, rows, filters: f, admin: !!isAdmin(req) });
  }));
  // リスト管理の5段（生リード・統合リード・温度・ステージ）の件数（2026-11-27 福井さん）。リスト管理のほかの読み取りと同じく、ログインしていれば読める
  app.get("/api/mochica/bales/tiers", guard(async (req, res) => { res.json({ ok: true, ...(await mcBalesTiers()) }); }));
  // 取り込み（生リード）のリードソース名を変える（2026-11-27 福井さん「リードソース名を画面で編集できるように」）
  app.put("/api/mochica/bales/lists/:key/lead-source", guard(async (req, res) => {
    const r = await mcBalesSetLeadSource(String(req.params.key), String((req.body || {}).name ?? ""));
    if (!r) return res.status(404).json({ error: "リストが見つかりません。画面を読み直してください" });
    console.log(`[mcBales] リードソース名を変えました：${r.list_key} → ${r.lead_source || "（なし）"} by ${req.user}`);
    res.json({ ok: true, ...r });
  }));
  // 保存した絞り込み（管理者どうしで共有）
  app.get("/api/mccall/cuts/saved", guard(async (req, res) => {
    await ensureSaved();
    const rows = (await P().query(`SELECT id, name, filters, by_user, created_at FROM mc_cut_saved ORDER BY created_at DESC LIMIT 200`)).rows;
    res.json({ ok: true, items: rows, admin: !!isAdmin(req) });
  }));
  app.post("/api/mccall/cuts/saved", adminOnly(async (req, res) => {
    await ensureSaved();
    const name = String((req.body || {}).name || "").replace(/[\r\n\t]/g, " ").trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: "絞り込みの名前を入れてください" });
    const f = cleanFilters((req.body || {}).filters);
    if (!Object.keys(f.inc).length && !Object.keys(f.exc).length && !f.q) return res.status(400).json({ error: "条件がありません。切り口の項目を押して条件を足してから保存してください" });
    const r = (await P().query(`INSERT INTO mc_cut_saved (name, filters, by_user) VALUES ($1, $2, $3) RETURNING id, name, filters, by_user, created_at`, [name, JSON.stringify(f), String(req.user || "").toLowerCase()])).rows[0];
    res.json({ ok: true, item: r });
  }));
  // 消すのは保存した絞り込み1つだけ（リードには何もしない）。画面で確かめてから呼ぶ
  app.delete("/api/mccall/cuts/saved/:id", adminOnly(async (req, res) => {
    await ensureSaved();
    const id = parseInt(req.params.id, 10); if (!(id > 0)) return res.status(400).json({ error: "消す絞り込みが分かりません" });
    const r = await P().query(`DELETE FROM mc_cut_saved WHERE id=$1`, [id]);
    console.log(`[mccuts] 保存した絞り込み ${id} を消しました by ${req.user}`);
    res.json({ ok: true, deleted: r.rowCount });
  }));
}
