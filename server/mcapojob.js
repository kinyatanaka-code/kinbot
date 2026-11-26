// アポ確率の夜の学び直しと、画面・ほかの画面から読むための API（2026-11-27 オーナー：福井さん）
//   計算そのもの（切り口・寄せ方・回帰・確かめ方）は mcapo.js。ここは DB の読み書きと、毎晩1回まわす仕組みだけ。
//
// 毎晩 3時台に1回（と、起動して学んだものが1つも無いときに1回）：
//   ① 学ぶ材料を足す：前の晩から増えた架電の記録を1件ずつ「その架電の前の状態」にして mc_apo_samples に残す。
//      前の状態は、記録に残っている prev（かける前の次の予定・前回の結果・回数・ヒアリング）と、前の晩に付けた印（apo_x：
//      ホット度・ステージ・失注など、架電のあとで書き換わる値）から作る。印が無い（初めての晩より前の）記録は、
//      書き換わる値を使わずに作り直す（未来の情報が混ざらないように）。
//   ② SF のコンバートの数（リード元・都道府県ごと。MOCHICALL を使い始める前のもの）を4回読む。件数の少ない値の寄せ先に使う
//   ③ 学ぶ・古い 8 割で学んで新しい 2 割を当てて確かめる（帯ごとの実際のアポ率）
//   ④ 開いているリード全部と、リスト管理の表の行（BALES・SF・CSV）に確率と理由を付ける
// 外の AI・有料のサービスは使わない。SF は集計の SOQL を4回だけ。
import { getSettings, saveSettings } from "./db.js";
import { sfQuery } from "./salesforce.js";
import { segOf } from "./mcseg.js";
import { WHY_HUMAN } from "./mccadence.js";
import { APO_V, APO_FEATS, featuresOf, fitApo, scoreApo, backtestApo, binsOf, aucOf, liftsOf, bandOf, whyText } from "./mcapo.js";

let C = null;   // mccall.js から渡される道具（P・sfOwner）
//   架電のあとで書き換わる値。前の晩の印（apo_x）にだけ入れて、学ぶときに「その架電の前の値」として使う
const LEAKY = ["hot", "stage", "lost", "lostAge", "ats"];
const BIZ = "MOCHICA";
export const APO_MIN = { n: 200, pos: 5 };   // 確率を付け始める材料の量

let _ready = null;
export function ensureApo(P) {
  if (_ready) return _ready;
  _ready = (async () => {
    const q = (s) => P().query(s);
    await q(`ALTER TABLE mc_call_leads ADD COLUMN IF NOT EXISTS apo_p REAL`);
    await q(`ALTER TABLE mc_call_leads ADD COLUMN IF NOT EXISTS apo_why JSONB`);
    await q(`ALTER TABLE mc_call_leads ADD COLUMN IF NOT EXISTS apo_x JSONB`);
    await q(`ALTER TABLE mc_call_leads ADD COLUMN IF NOT EXISTS apo_at TIMESTAMPTZ`);
    //   リスト管理の表（mochica_bales_rows）の apo_p・apo_why は、表を作る db.js の ensureMcBales で足す（表より先に足そうとして失敗しないように）
    //   学ぶ材料：架電1件＝1行。x＝その架電の前の特徴、y＝アポになったか、p＝そのとき画面に出していた確率（あとで当たり具合を確かめる）
    //   src：snap＝前の晩の印から作った／rebuild＝印が無く、書き換わる値を使わずに作り直した
    await q(`CREATE TABLE IF NOT EXISTS mc_apo_samples (log_id INT PRIMARY KEY, lead_id INT, at TIMESTAMPTZ, y BOOLEAN, x JSONB, p REAL, src TEXT, v INT)`);
    await q(`CREATE INDEX IF NOT EXISTS ix_mc_apo_samples_at ON mc_apo_samples(at)`);
    //   学んだもの（毎晩1行。古いものは90晩ぶん残す）
    await q(`CREATE TABLE IF NOT EXISTS mc_apo_models (id SERIAL PRIMARY KEY, made_at TIMESTAMPTZ DEFAULT now(), model JSONB, check_info JSONB, cost JSONB)`);
  })().catch((e) => { _ready = null; throw e; });
  return _ready;
}

// ① 学ぶ材料を足す
async function addSamples(P) {
  const last = +((await P().query(`SELECT COALESCE(max(log_id), 0) AS m FROM mc_apo_samples`)).rows[0].m);
  let after = last, added = 0, snap = 0;
  for (let round = 0; round < 200; round++) {
    //   取り消しは15分以内なので、20分たった記録だけ使う
    const rows = (await P().query(`SELECT g.id, g.lead_id, g.created_at, g.outcome, g.prev, c.seg, c.person, c.apo_x, c.apo_at, c.apo_p,
        (SELECT m.data->>'status' FROM mc_mynavi m WHERE m.ckey = c.seg->>'ckey') AS mn
      FROM mc_call_logs g JOIN mc_call_leads c ON c.id = g.lead_id
      WHERE g.id > $1 AND g.biz = $2 AND NOT g.undone AND g.created_at < now() - interval '20 minutes' ORDER BY g.id LIMIT 2000`, [after, BIZ])).rows;
    if (!rows.length) break;
    const items = rows.map((g) => {
      const pv = g.prev || {}, at = new Date(g.created_at).getTime();
      const x = featuresOf({ seg: g.seg || {}, person: g.person, hearing: pv.hearing || {}, lastOutcome: pv.last_outcome, lastAt: pv.last_at, attempts: pv.attempts,
        nextAt: pv.next_at, nextWhy: pv.next_why, mynavi: g.mn, at, band: bandOf(at), safe: true }, WHY_HUMAN);
      const s = g.apo_x && g.apo_at && new Date(g.apo_at).getTime() < at && Number(g.apo_x.v) === APO_V ? g.apo_x : null;
      if (s) for (const k of LEAKY) { if (s[k] != null) x[k] = s[k]; else delete x[k]; }
      return { log_id: g.id, lead_id: g.lead_id, at: g.created_at, y: g.outcome === "apo", x, p: s && g.apo_p != null ? Number(g.apo_p) : null, src: s ? "snap" : "rebuild", v: APO_V };
    });
    await P().query(`INSERT INTO mc_apo_samples (log_id, lead_id, at, y, x, p, src, v) SELECT * FROM jsonb_to_recordset($1::jsonb)
        AS t(log_id int, lead_id int, at timestamptz, y boolean, x jsonb, p real, src text, v int) ON CONFLICT (log_id) DO NOTHING`, [JSON.stringify(items)]);
    added += items.length; snap += items.filter((i) => i.src === "snap").length; after = rows[rows.length - 1].id;
    if (rows.length < 2000) break;
  }
  return { added, snap };
}

// ② SF のコンバートの数。MOCHICALL を使い始める前（学ぶ材料のいちばん古い日より前）に作られ、その前にコンバートしたものだけ数える
//   （MOCHICALL で取ったアポのコンバートを数えると、同じアポを2回数えることになるため）
async function sfLifts(cutoff) {
  const owner = C && C.sfOwner ? await C.sfOwner().catch(() => "") : "";
  if (!owner) return { lifts: null, calls: 0, note: "SF につながっている管理者がいないので、SF のコンバートの数は使っていません" };
  const d = new Date(cutoff).toISOString().slice(0, 10), RT = "RecordType.Name = 'Mochica（リード）'";
  const agg = async (field, conv) => ((await sfQuery(owner, `SELECT ${field}, COUNT(Id) n FROM Lead WHERE ${RT} AND CreatedDate < ${d}T00:00:00Z${conv ? ` AND IsConverted = true AND ConvertedDate < ${d}` : ""} GROUP BY ${field}`)).records || []);
  const out = {}; let calls = 0;
  for (const [k, field] of [["source", "LeadSource"], ["pref", "State"]]) {
    const all = await agg(field, false); calls++;
    const cv = new Map((await agg(field, true)).map((r) => [String(r[field] || ""), Number(r.n) || 0])); calls++;
    out[k] = liftsOf(all.map((r) => ({ v: r[field], n: Number(r.n) || 0, conv: cv.get(String(r[field] || "")) || 0 })));
  }
  return { lifts: out, calls };
}

// ④ 確率を付ける（開いているリード全部と、リスト管理の表の行）
async function scoreAll(P, model) {
  let leads = 0, rows = 0;
  //   リード：keyset で 2000件ずつ（一度に全部読むと、メモリと DB の負荷が大きいため）
  for (let after = 0, round = 0; round < 500; round++) {
    const rs = (await P().query(`SELECT c.id, c.seg, c.person, c.hot, c.hearing, c.last_outcome, c.last_at, c.attempts, c.next_at, c.next_why,
        (SELECT m.data->>'status' FROM mc_mynavi m WHERE m.ckey = c.seg->>'ckey') AS mn
      FROM mc_call_leads c JOIN mc_call_lists l ON l.id = c.list_id AND l.biz = $2 AND NOT l.closed
      WHERE c.id > $1 AND NOT c.done AND c.dup_of IS NULL ORDER BY c.id LIMIT 2000`, [after, BIZ])).rows;
    if (!rs.length) break;
    const items = rs.map((c) => {
      const x = featuresOf({ seg: c.seg || {}, hot: c.hot, person: c.person, hearing: c.hearing || {}, lastOutcome: c.last_outcome, lastAt: c.last_at, attempts: c.attempts,
        nextAt: c.next_at, nextWhy: c.next_why, mynavi: c.mn }, WHY_HUMAN);
      const s = scoreApo(model, x), snap = { v: APO_V };
      for (const k of LEAKY) if (x[k] != null) snap[k] = x[k];
      return { id: c.id, p: s.p, why: s.why, x: snap };
    });
    await P().query(`UPDATE mc_call_leads c SET apo_p = t.p, apo_why = t.why, apo_x = t.x, apo_at = now()
      FROM jsonb_to_recordset($1::jsonb) AS t(id int, p real, why jsonb, x jsonb) WHERE c.id = t.id`, [JSON.stringify(items)]);
    leads += rs.length; after = rs[rs.length - 1].id;
    if (rs.length < 2000) break;
  }
  //   リスト管理の表の行：いま見えている取り込み（run_at が最新）だけ。行の中身は使う項目だけ読む（全部の列を読むと重いため）
  const K = ["companyName", "companyTel1", "targetName", "companyAddress", "businessCategory", "leadSources.0.name", "lastLeadStageName", "callResult", "lastCalledAt", "callResultsCount",
    "会社名", "電話", "担当者", "住所", "業種", "リードソース", "ステータス", "最終活動日", "検討開始時期", "利用中ATS"];
  const sel = `jsonb_build_object(${K.map((k) => `'${k}', r.data->>'${k}'`).join(", ")}, '_sf', r.data->'_sf', '_hot', r.data->'_hot')`;
  try {
    for (let lk = "", rk = "", round = 0; round < 500; round++) {
      const rs = (await P().query(`SELECT r.list_key, r.row_key, r.hot, r.hot_d, ${sel} AS d, r.sf->'lead' AS sl, l.src,
          EXISTS (SELECT 1 FROM jsonb_each(r.data) e WHERE e.key ~ '^nextActions\\.[0-9]+\\.reservedAt$' AND e.value <> 'null'::jsonb) AS na
        FROM mochica_bales_rows r JOIN mochica_bales_lists l ON l.list_key = r.list_key AND l.run_at = r.run_at
        WHERE (r.list_key, r.row_key) > ($1, $2) ORDER BY r.list_key, r.row_key LIMIT 2000`, [lk, rk])).rows;
      if (!rs.length) break;
      const items = rs.map((r) => {
        const src = r.src === "sf" ? "sf" : r.src === "csv" ? "csv" : "bales", d = r.d || {};
        const seg = segOf({ src, data: d, company: d.companyName || d["会社名"], phone: d.companyTel1 || d["電話"], person: d.targetName || d["担当者"], sfLead: r.sl, hotD: r.hot_d });
        const s = scoreApo(model, featuresOf({ seg, hot: r.hot, person: d.targetName || d["担当者"], attempts: parseInt(d.callResultsCount, 10) || 0, nextAt: r.na ? 1 : null }, WHY_HUMAN));
        return { l: r.list_key, k: r.row_key, p: s.p, why: s.why };
      });
      await P().query(`UPDATE mochica_bales_rows r SET apo_p = t.p, apo_why = t.why FROM jsonb_to_recordset($1::jsonb) AS t(l text, k text, p real, why jsonb)
        WHERE r.list_key = t.l AND r.row_key = t.k`, [JSON.stringify(items)]);
      rows += rs.length; lk = rs[rs.length - 1].list_key; rk = rs[rs.length - 1].row_key;
      if (rs.length < 2000) break;
    }
    //   MOCHICALL に入っている会社は、MOCHICALL の記録のほうが新しいので、リードの確率で上書きする（表と「かける」で数字をそろえる）
    await P().query(`UPDATE mochica_bales_rows r SET apo_p = c.apo_p, apo_why = c.apo_why FROM mc_call_leads c
      WHERE c.src = 'bales' AND c.apo_p IS NOT NULL AND r.list_key = regexp_replace(c.src_key, '[|][^|]*$', '') AND r.row_key = regexp_replace(c.src_key, '^.*[|]', '')`);
  } catch (e) { console.warn("[mc-apo] リスト管理の表の行に確率を付けられませんでした（リードの確率は付けました）", e.message); }
  return { leads, rows };
}

// ①〜④ を通しで。結果は mc_apo_models に1行
let _running = null;
export function runApo(P, why = "") {
  if (_running) return _running;
  _running = (async () => {
    const t0 = Date.now(); await ensureApo(P);
    const s = await addSamples(P);
    const all = (await P().query(`SELECT lead_id, at, y, x, p, src FROM mc_apo_samples WHERE v = $1 ORDER BY at`, [APO_V])).rows
      .map((r) => ({ g: r.lead_id, at: r.at, y: r.y ? 1 : 0, x: r.x || {}, p: r.p, src: r.src }));
    const prevM = (await P().query(`SELECT model FROM mc_apo_models ORDER BY id DESC LIMIT 1`)).rows[0];
    let lf = { lifts: null, calls: 0 };
    if (all.length) lf = await sfLifts(all[0].at).catch((e) => ({ lifts: null, calls: 0, note: `SF のコンバートの数を読めませんでした（前の晩の数を使います）：${e.message}` }));
    const lifts = lf.lifts || (prevM && prevM.model && prevM.model.lifts) || {};
    const t1 = Date.now();
    const model = fitApo(all, { lifts });
    const bt = backtestApo(all, { lifts });
    //   その日に画面に出していた確率で、実際にどうだったか（印があった架電だけ。学ぶ前の数字なので、いちばん正直な確かめ方）
    const live = all.filter((q) => q.src === "snap" && q.p != null).map((q) => ({ p: Number(q.p), y: q.y }));
    const check = { backtest: bt, live: { n: live.length, pos: live.reduce((t, q) => t + q.y, 0), bins: binsOf(live), auc: aucOf(live) } };
    const t2 = Date.now();
    //   材料が少ないうちは確率を付けない（アポが数件だと、どの会社も全体の率に近い数字になり、並びの役に立たないうえに 50% などの誤った数字が出るため）。
    //   付けないあいだは、前に付けた確率（無ければ今までの並べ方）のまま
    const usable = model.n >= APO_MIN.n && model.pos >= APO_MIN.pos;
    const sc = usable ? await scoreAll(P, model) : { leads: 0, rows: 0, skipped: `学ぶ材料が足りないので確率を付けていません（架電 ${model.n}件・アポ ${model.pos}件。架電 ${APO_MIN.n}件・アポ ${APO_MIN.pos}件から付けます）` };
    const cost = { ms: Date.now() - t0, learn_ms: t2 - t1, score_ms: Date.now() - t2, samples: all.length, added: s.added, added_snap: s.snap, leads: sc.leads, rows: sc.rows,
      sf_calls: lf.calls, ...(lf.note ? { sf_note: lf.note } : {}), ...(sc.skipped ? { skipped: sc.skipped } : {}), why };
    await P().query(`INSERT INTO mc_apo_models (model, check_info, cost) VALUES ($1, $2, $3)`, [model, check, cost]);
    await P().query(`DELETE FROM mc_apo_models WHERE id NOT IN (SELECT id FROM mc_apo_models ORDER BY id DESC LIMIT 90)`);
    console.log(`[mc-apo] 学び直しました：架電 ${all.length}件（アポ ${model.pos}件・今回足した ${s.added}件）・切り口 ${model.feats.length}・リード ${sc.leads}件・表の行 ${sc.rows}件・SF ${lf.calls}回・${Math.round(cost.ms / 1000)}秒`);
    return { model, check, cost };
  })().finally(() => { _running = null; });
  return _running;
}

// 毎晩3時台に1回。起動してから学んだものが1つも無ければ、3分後に1回（初めて本番に出した日から確率が出るように）
const jstNow = () => new Date(Date.now() + 9 * 3600e3);
export function startApo(P, deps = {}) {
  C = { P, ...deps };
  const tick = async (why) => {
    try {
      const st = await getSettings().catch(() => ({}));
      const day = jstNow().toISOString().slice(0, 10);
      if (why === "night" && (jstNow().getUTCHours() !== 3 || st.mcApoRunDay === day)) return;
      if (why === "start") { await ensureApo(P); if ((await P().query(`SELECT 1 FROM mc_apo_models WHERE made_at > now() - interval '26 hours' LIMIT 1`)).rows.length) return; }
      await saveSettings({ mcApoRunDay: day }).catch(() => {});
      await runApo(P, why);
    } catch (e) { console.error("[mc-apo] アポ確率の学び直しができませんでした（次の晩にやり直します。今までの確率はそのまま使います）", e.message); }
  };
  setTimeout(() => tick("start"), 3 * 60e3).unref?.();
  setInterval(() => tick("night"), 10 * 60e3).unref?.();
}

// 画面に出す形（理由は文にする）
const view = (p, why) => ({ p: p == null ? null : Number(p), why: (Array.isArray(why) ? why : []).map(whyText) });
export function registerMcApo(app, { adminOnly, guard }) {
  // 管理者：学んだものの中身・当たり具合（予測の帯ごとの実際のアポ率）・この90晩の様子・かかった時間
  app.get("/api/mccall/apo/model", adminOnly(async (req, res) => {
    await ensureApo(C.P);
    const rs = (await C.P().query(`SELECT id, made_at, model, check_info, cost FROM mc_apo_models ORDER BY id DESC LIMIT 30`)).rows;
    const cur = rs[0];
    if (!cur) return res.json({ ok: true, model: null, note: "まだ学んでいません（毎晩3時台に学び直します。管理者は今すぐ学び直せます）" });
    const m = cur.model || {};
    const feats = (m.feats || []).map((f) => {
      const t = Object.entries((m.tab || {})[f] || {}).map(([v, x]) => ({ v, n: x[0], apo: x[1], e: x[2] })).sort((a, b) => b.n - a.n);
      return { k: f, label: (APO_FEATS.find((x) => x.k === f) || {}).label || f, w: (m.w || {})[f] || 0, values: t.slice(0, 30) };
    }).sort((a, b) => b.w - a.w);
    res.json({ ok: true, made_at: cur.made_at, n: m.n, pos: m.pos, base: m.base, feats, check: cur.check_info, cost: cur.cost,
      history: rs.map((r) => ({ made_at: r.made_at, n: (r.model || {}).n, pos: (r.model || {}).pos, auc: (((r.check_info || {}).backtest) || {}).auc ?? null,
        brier: (((r.check_info || {}).backtest) || {}).brier ?? null, brier_base: (((r.check_info || {}).backtest) || {}).brier_base ?? null, ms: (r.cost || {}).ms })) });
  }));
  // 管理者：今すぐ学び直す（夜を待たずに確かめたいとき。終わるまで待たずに返す）
  app.post("/api/mccall/apo/run", adminOnly(async (req, res) => {
    runApo(C.P, `手で（${String(req.user || "").slice(0, 80)}）`).catch((e) => console.error("[mc-apo] 手で学び直せませんでした", e.message));
    res.json({ ok: true, started: true });
  }));
  // 確率を読む（リスト管理の表・切り口タブの「アポ率」の列を置き換えるため）。
  //   leads：MOCHICALL のリードの番号／rows：リスト管理の表の行 [{ l: list_key, k: row_key }]。どちらも2000件まで。夜に付けた値を読むだけ（重い計算はしない）
  app.post("/api/mccall/apo/of", guard(async (req, res) => {
    await ensureApo(C.P);
    const b = req.body || {};
    const ids = (Array.isArray(b.leads) ? b.leads : []).map((x) => parseInt(x, 10)).filter((x) => x > 0).slice(0, 2000);
    const rows = (Array.isArray(b.rows) ? b.rows : []).filter((x) => x && x.l && x.k).slice(0, 2000);
    const out = { leads: {}, rows: {} };
    if (ids.length) for (const r of (await C.P().query(`SELECT id, apo_p, apo_why FROM mc_call_leads WHERE id = ANY($1::int[])`, [ids])).rows) out.leads[r.id] = view(r.apo_p, r.apo_why);
    if (rows.length) for (const r of (await C.P().query(`SELECT list_key, row_key, apo_p, apo_why FROM mochica_bales_rows r JOIN unnest($1::text[], $2::text[]) AS u(a, b) ON r.list_key = u.a AND r.row_key = u.b`,
      [rows.map((x) => String(x.l)), rows.map((x) => String(x.k))])).rows) out.rows[`${r.list_key}|${r.row_key}`] = view(r.apo_p, r.apo_why);
    const m = (await C.P().query(`SELECT made_at FROM mc_apo_models ORDER BY id DESC LIMIT 1`)).rows[0];
    res.json({ ok: true, made_at: m ? m.made_at : null, ...out });
  }));
}
