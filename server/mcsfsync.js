// MOCHICALL：MQL の判定に要る SF の項目の読み直しと、SF に無いリードの SF 立ち上げ（2026-11-23 オーナー決定）
//
// なぜ作ったか：
//   MQL（server/mcmql.js）の判定には、オプトアウト・電話の除外・前回の結果・人の最終活動日・取引先への結びつきなど、
//   取り込んだときには読んでいない SF の項目が要る。SF の値は人が直すので、sf_lead_id で夜に1回まとめて読み直す（1回200件ずつ）。
//   SF から足すとき・CSV や DOC から入れたリードに SF のリードが分かっているときにも、その場で読む。
//
//   また、CSV・DOC などから入れた SF に無いリードは、SF にリードを立ち上げて「MOCHICALL のリードは全件 SF のリードと結びついている」状態にする。
//   先に SF の Mochica リード・取引先と重複を確かめ（禁止名簿と同じ鍵：電話の末尾10けた・会社名の正規化）、当たったものは作らずに結びつける。
//   SF に書く前に必ず「試し」（作る件数・結びつける件数・中身の見本 CSV）を出す。SF に書くのは、オーナーの承認後に
//   環境変数 MCCALL_SF_LAUNCH=1 を入れたときだけ（取り込みのたびに自動で立ち上げるのは、さらに MCCALL_SF_LAUNCH_AUTO=1 のときだけ）。
//
// 止め方（環境変数。再起動が要る）：
//   MCCALL_MQL_GATE=0     … MQL で「かける」から外すのをやめる（印は付け続ける）
//   MCCALL_MQL_NIGHTLY=0  … 夜の読み直しを止める。MCCALL_MQL_HOUR で時刻（日本時間・既定 2 時）
import { dbPool, getSettings, saveSettings, approachKeys, approachCoKey, loadApproachBans, approachBanHitLeadSync, mcBalesMqlRows } from "./db.js";
import { sfQuery, sfQueryAll, sfCreateRecord, describeObject } from "./salesforce.js";
import { MQL_V, MQL_SF_FIELDS, sfxOf, mqlOf, buildIndex, matchLead, leadFields, planCsv, effectiveSource, phoneCands, MQL_WHY, LAUNCH_ACTION } from "./mcmql.js";
import { segOf, SEG_V, prefFromAddress } from "./mcseg.js";

const P = () => dbPool();
const SF_ID = /^00Q[0-9A-Za-z]{12,15}$/;
const soqlId = (v) => `'${String(v).replace(/[^0-9A-Za-z]/g, "")}'`;
const chunks = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
const BATCH = 200;   // SF に1回で聞くリードの数（オーナー決定：1回200件ずつ）

export const mqlGateOn = () => process.env.MCCALL_MQL_GATE !== "0";
export const launchOn = () => process.env.MCCALL_SF_LAUNCH === "1";
export const launchAutoOn = () => launchOn() && process.env.MCCALL_SF_LAUNCH_AUTO === "1";
// 「かける」の SQL に足す1条件（列名は mc_call_leads のもの。まだ判定していないリードは出す＝デプロイ直後に全員の「かける」が空にならないように。
//   出す直前に呼ぶ側でその場で判定する）。M9 のように時間がたてば外れる理由だけなら、until を過ぎたら出す
//   until の形が崩れていても SQL ごと止まらないよう、日時の形のときだけ比べる（止まると全員の「かける」が出なくなるため）
export const untilPassed = (m) => `(CASE WHEN ${m}->>'until' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN (${m}->>'until')::timestamptz <= now() ELSE false END)`;
export const MQL_OK_SQL = `(mql IS NULL OR COALESCE((mql->>'ok')::boolean, true) OR ${untilPassed("mql")})`;
export const mqlPass = (m, now = Date.now()) => !m || m.ok || (m.until && Date.parse(m.until) <= now);

export async function ensureMql(q) {
  // sfx：判定に使う SF のリードの項目を読んだもの（sfx_at：読んだ日時）。mql：判定の印 { v, ok, why, until, src, p, at }
  await q(`ALTER TABLE mc_call_leads ADD COLUMN IF NOT EXISTS sfx JSONB`);
  await q(`ALTER TABLE mc_call_leads ADD COLUMN IF NOT EXISTS sfx_at TIMESTAMPTZ`);
  await q(`ALTER TABLE mc_call_leads ADD COLUMN IF NOT EXISTS mql JSONB`);
  // SF のリードが無く、取引先だけに当たったときの結びつき（SF 立ち上げの試しで「取引先だけ」と出たもの）
  await q(`ALTER TABLE mc_call_leads ADD COLUMN IF NOT EXISTS sf_acct_id TEXT`);
  // リストに付けた SF のリード元（CSV・DOC のリードの MQL の判定と、SF に立ち上げるときのリード元に使う）
  await q(`ALTER TABLE mc_call_lists ADD COLUMN IF NOT EXISTS lead_source TEXT`);
  // 商談中・利用中の取引先（M5）。夜に入れ替える。id は 15 けた（リードの relationacctID__c と比べる）、ckey は禁止名簿と同じ会社名の鍵
  await q(`CREATE TABLE IF NOT EXISTS mc_sf_accts (id TEXT PRIMARY KEY, name TEXT, ckey TEXT, status TEXT, at TIMESTAMPTZ DEFAULT now())`);
  await q(`CREATE INDEX IF NOT EXISTS ix_mc_sf_accts_ckey ON mc_sf_accts(ckey)`);
}

// ---- M5：商談中・利用中の取引先 ----
//   進行中・受注の商談がある会社は、アプローチ禁止の名簿（server/index.js の同期）ですでに止めている。ここは取引先の状態（ユーザー・商談進行中）を見る
let _busy = { at: 0, ids: new Set(), names: new Set() };
async function busyAccts() {
  if (_busy.at && Date.now() - _busy.at < 10 * 60e3) return _busy;
  const rows = (await P().query(`SELECT id, ckey FROM mc_sf_accts`)).rows;
  _busy = { at: Date.now(), ids: new Set(rows.map((r) => r.id)), names: new Set(rows.map((r) => r.ckey).filter((k) => k && k.length >= 2)) };
  return _busy;
}
// 取引先への結びつき（relationacctID__c）があればそれで見る。無ければ会社名（禁止名簿と同じ正規化）で当てる。当たらなければ出す
function isBusy(B, sfx, company) {
  const a = sfx && !sfx._missing && sfx.relationacctID__c ? String(sfx.relationacctID__c).slice(0, 15) : "";
  if (a) return B.ids.has(a);
  const k = approachCoKey(company); return !!k && k.length >= 2 && B.names.has(k);
}
export async function refreshBusyAccts(owner) {
  const recs = await sfQueryAll(owner, `SELECT Id, Name, acount_status__c FROM Account WHERE acount_status__c IN ('ユーザー','商談進行中')`, 100000);
  // 0件は入れ替えない（SF が読めなかっただけで、商談中の会社に急にかかり始めないように）
  if (!recs.length) return { n: 0, replaced: false };
  const c = await P().connect();
  try {
    await c.query("BEGIN");
    await c.query(`DELETE FROM mc_sf_accts`);
    for (const s of chunks(recs, 2000)) await c.query(`INSERT INTO mc_sf_accts (id, name, ckey, status) SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) ON CONFLICT (id) DO NOTHING`,
      [s.map((r) => String(r.Id).slice(0, 15)), s.map((r) => String(r.Name || "").slice(0, 200)), s.map((r) => approachCoKey(r.Name)), s.map((r) => String(r.acount_status__c || ""))]);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
  _busy.at = 0;
  return { n: recs.length, replaced: true };
}
// 1日以上読み直していなければ読む（デプロイ直後・取り込みの直後に、夜を待たずに商談中の会社を外すため。SF の呼び出しは1回）
async function busyFresh(owner) {
  if (!owner) return;
  const r = (await P().query(`SELECT max(at) AS at FROM mc_sf_accts`)).rows[0];
  if (r && r.at && Date.now() - new Date(r.at).getTime() < 24 * 3600e3) return;
  await refreshBusyAccts(owner).catch((e) => console.error("[mcmql] 商談中の取引先を読めませんでした（前のまま）", e.message));
}

// ---- SF のリードの項目を読み直す（1回200件ずつ） ----
//   leadIds を渡せばそのリードだけ（取り込んだ直後）。渡さなければ、終わっていない・閉じていないリストのリードのうち、20時間以上読んでいないもの。
//   かけるリスト（保管ではない）のリードから先に読む。SF で見つからない（消された・統合された）リードは { _missing: true } と残す
let _fields = [...MQL_SF_FIELDS]; const _dropped = new Set();
async function readLeads(owner, ids) {
  for (let attempt = 0; attempt < 8; attempt++) {
    try { return (await sfQuery(owner, `SELECT ${_fields.join(", ")} FROM Lead WHERE Id IN (${ids.map(soqlId).join(",")})`)).records || []; }
    catch (e) {
      // 見る権限の無い項目・無い項目があると SOQL ごと断られるので、その項目だけ外して読み直す（外した項目は状態に出す）
      const m = /No such column '?([A-Za-z0-9_]+)'?/.exec(String(e.message));
      if (m && m[1] !== "Id" && _fields.includes(m[1])) { _fields = _fields.filter((f) => f !== m[1]); _dropped.add(m[1]); console.error(`[mcmql] SF の項目 ${m[1]} が読めないので外して読み直します`); continue; }
      if (attempt === 0 && /\b(5\d\d|ECONNRESET|fetch failed|timeout)\b/i.test(String(e.message))) { await new Promise((r) => setTimeout(r, 3000)); continue; }
      throw e;
    }
  }
  throw new Error("SF のリードの項目を読めませんでした");
}
export async function refreshSfx(owner, { leadIds = null, staleHours = 20, max = 300000 } = {}) {
  const p = []; let w;
  if (leadIds) { p.push(leadIds.map((x) => parseInt(x, 10)).filter((x) => x > 0)); w = `c.id = ANY($1::int[])`; if (!p[0].length) return { leads: 0, batches: 0, missing: 0 }; }
  else { p.push(staleHours); w = `NOT c.done AND c.dup_of IS NULL AND NOT l.closed AND (c.sfx_at IS NULL OR c.sfx_at < now() - make_interval(hours => $1::int))`; }
  p.push(max);
  const rows = (await P().query(`SELECT c.id, c.sf_lead_id FROM mc_call_leads c JOIN mc_call_lists l ON l.id = c.list_id
    WHERE c.sf_lead_id ~ '^00Q[0-9A-Za-z]{12,15}$' AND ${w} ORDER BY l.stock, c.sfx_at NULLS FIRST, c.id LIMIT $${p.length}`, p)).rows;
  // 同じ SF のリードに結びついた MOCHICALL のリードが複数あっても、SF には1回だけ聞く
  const by = new Map();
  for (const r of rows) { const k = String(r.sf_lead_id).slice(0, 15); if (!by.has(k)) by.set(k, []); by.get(k).push(r.id); }
  let batches = 0, missing = 0, read = 0;
  for (const ids of chunks([...by.keys()], BATCH)) {
    const recs = await readLeads(owner, ids); batches++;
    const got = new Map(recs.map((r) => [String(r.Id).slice(0, 15), r]));
    const at = new Date(); const items = [];
    for (const k of ids) {
      const rec = got.get(k); const sfx = rec ? sfxOf(rec, at) : { _missing: true, _at: at.toISOString() };
      if (rec) read++; else missing++;
      for (const id of by.get(k)) items.push({ id, sfx });
    }
    await P().query(`UPDATE mc_call_leads c SET sfx = x.sfx, sfx_at = now() FROM jsonb_to_recordset($1::jsonb) AS x(id int, sfx jsonb) WHERE c.id = x.id`, [JSON.stringify(items)]);
  }
  return { leads: rows.length, sfLeads: by.size, read, missing, batches, dropped: [..._dropped] };
}

// ---- MQL の印を付ける ----
//   leadIds：そのリードだけ（終わったリードでも）。listIds：そのリストの終わっていないリード。どちらも無ければ、閉じていないリスト全部。
//   force でなければ、まだ判定していない・計算のしかたが古いものだけ。戻り値の map は leadIds のときの id → 印
let _balesJoin = true;
const MQL_COLS = `c.id, c.src, c.company, c.phone, c.info, c.gate, c.data, c.seg, c.sfx, c.last_at, c.last_outcome, l.lead_source`;
const BALES_JOIN = `LEFT JOIN mochica_bales_rows b ON c.src='bales' AND b.list_key = regexp_replace(c.src_key, '[|][^|]*$', '') AND b.row_key = regexp_replace(c.src_key, '^.*[|]', '')`;
async function mqlRows(where, p) {
  if (_balesJoin) {
    try { return (await P().query(`SELECT ${MQL_COLS}, b.data AS b_data FROM mc_call_leads c JOIN mc_call_lists l ON l.id = c.list_id ${BALES_JOIN} WHERE ${where} ORDER BY c.id LIMIT 1000`, p)).rows; }
    catch (e) { if (!/mochica_bales_rows/.test(String(e.message))) throw e; _balesJoin = false; }
  }
  return (await P().query(`SELECT ${MQL_COLS}, NULL::jsonb AS b_data FROM mc_call_leads c JOIN mc_call_lists l ON l.id = c.list_id WHERE ${where} ORDER BY c.id LIMIT 1000`, p)).rows;
}
export function judgeRow(r, B, now = new Date()) {
  // seg（リード元・失注）がまだ無い・古いときは、手元のデータでその場で作って使う（書き残すのは refreshSeg。DOC の元のソースはここでは読まない）
  const data = r.src === "bales" ? (r.b_data || r.data) : r.data;
  const seg = r.seg && (r.seg.v || 0) >= SEG_V ? r.seg : segOf({ src: r.src, data, company: r.company, phone: r.phone, person: "" });
  return mqlOf({ src: r.src, seg, sfx: r.sfx, listSource: r.lead_source, phone: r.phone, data,
    gate: r.gate, info: r.info, lastAt: r.last_at, lastOutcome: r.last_outcome, busyAcct: isBusy(B, r.sfx, r.company) }, now);
}
export async function computeMql({ leadIds = null, listIds = null, force = false, now = new Date() } = {}) {
  const B = await busyAccts();
  const map = new Map(); let after = 0, n = 0;
  for (let round = 0; round < 1000; round++) {
    const p = [after]; const w = ["c.id > $1"];
    if (leadIds) { p.push(leadIds.map((x) => parseInt(x, 10)).filter((x) => x > 0)); w.push(`c.id = ANY($${p.length}::int[])`); }
    else { w.push("NOT c.done", "c.dup_of IS NULL", "NOT l.closed"); if (listIds) { p.push(listIds); w.push(`c.list_id = ANY($${p.length}::int[])`); } }
    if (!force && !leadIds) { p.push(MQL_V); w.push(`(c.mql IS NULL OR COALESCE((c.mql->>'v')::int, 0) < $${p.length})`); }
    const rows = await mqlRows(w.join(" AND "), p);
    if (!rows.length) break;
    const seen = new Set(); const items = [];
    for (const r of rows) { if (seen.has(r.id)) continue; seen.add(r.id); const m = judgeRow(r, B, now); items.push({ id: r.id, mql: m }); if (leadIds) map.set(r.id, m); }
    await P().query(`UPDATE mc_call_leads c SET mql = x.mql FROM jsonb_to_recordset($1::jsonb) AS x(id int, mql jsonb) WHERE c.id = x.id`, [JSON.stringify(items)]);
    n += items.length; after = rows[rows.length - 1].id;
    if (rows.length < 1000) break;
  }
  return { n, map };
}

// ---- 夜の読み直し（取引先の状態 → リードの項目 → 印の付け直し） ----
const _hooks = { refreshSeg: null, listIds: null, ensure: async () => {} };
let _night = { running: false, last: null };
export async function runNightly(getOwner, why = "夜の読み直し", { staleHours = 1 } = {}) {
  if (_night.running) return { running: true };
  _night.running = true; const t0 = Date.now(); const st = { why, at: new Date().toISOString() };
  try {
    await _hooks.ensure();
    const owner = await getOwner();
    if (!owner) throw new Error("Salesforce につながっている運用者がいません（読み直しはせず、手元の値で印だけ付け直します）");
    try { st.accts = await refreshBusyAccts(owner); } catch (e) { st.acctError = String(e.message).slice(0, 200); console.error("[mcmql] 商談中の取引先を読めませんでした（前のまま）", e.message); }
    // 夜はまとめて全部読み直す（1時間以内に読んだものだけ飛ばす＝途中で止まってやり直したときに、読んだ分をもう一度読まないため）
    try { st.sfx = await refreshSfx(owner, { staleHours }); } catch (e) { st.sfxError = String(e.message).slice(0, 200); console.error("[mcmql] SF のリードの項目を読み直せませんでした（読めた分だけ）", e.message); }
  } catch (e) { st.error = String(e.message).slice(0, 200); }
  try {
    // リード元・失注は seg から読むので、古い seg を先に直す（直せなくても印は付ける）
    if (_hooks.refreshSeg && _hooks.listIds) await _hooks.refreshSeg(await _hooks.listIds()).catch((e) => console.error("[mcmql] seg を直せませんでした", e.message));
    st.mql = (await computeMql({ force: true })).n;
  } catch (e) { st.mqlError = String(e.message).slice(0, 200); console.error("[mcmql] 印を付け直せませんでした", e.message); }
  finally {
    st.ms = Date.now() - t0; _night = { running: false, last: st };
    const cur = (await getSettings().catch(() => ({}))).mccallMqlNightly || {};
    await saveSettings({ mccallMqlNightly: { ...cur, last: st } }).catch(() => {});
    console.log(`[mcmql] ${why}：SF のリード ${st.sfx ? `${st.sfx.read}件（見つからない ${st.sfx.missing}・${st.sfx.batches}回）` : "読まず"}・取引先 ${st.accts ? st.accts.n : "-"}件・印 ${st.mql ?? "-"}件・${Math.round(st.ms / 1000)}秒${st.error || st.sfxError ? `（${st.error || st.sfxError}）` : ""}`);
  }
  return st;
}
export function startMql({ getOwner, refreshSeg, listIds, ensure }) {
  Object.assign(_hooks, { refreshSeg, listIds, ensure: ensure || _hooks.ensure });
  const hour = Math.min(23, Math.max(0, parseInt(process.env.MCCALL_MQL_HOUR || "2", 10) || 2));
  // 起動したら、まだ判定していないリードにだけ印を付ける（SF は読まない）
  setTimeout(() => { _hooks.ensure().then(async () => { await busyFresh(await getOwner().catch(() => "")); return computeMql({}); }).then((r) => r.n && console.log(`[mcmql] まだ判定していなかったリード ${r.n}件に印を付けました`)).catch((e) => console.error("[mcmql] 起動時の判定ができませんでした", e.message)); }, 45e3);
  // 夜に1回（日本時間の hour 時台）。再起動しても同じ日に2回走らないよう、走らせた日を設定に残す
  setInterval(async () => {
    try {
      if (process.env.MCCALL_MQL_NIGHTLY === "0" || _night.running) return;
      const j = new Date(Date.now() + 9 * 3600e3); if (j.getUTCHours() !== hour) return;
      const day = j.toISOString().slice(0, 10);
      const cur = (await getSettings().catch(() => ({}))).mccallMqlNightly || {};
      if (cur.day === day) return;
      await saveSettings({ mccallMqlNightly: { ...cur, day } });
      runNightly(getOwner).catch(() => {});
    } catch (e) { console.error("[mcmql] 夜の読み直しを始められませんでした", e.message); }
  }, 5 * 60e3);
}

// ---- 取り込んだあと（SF から足す・CSV・DOC）：SF のリードが分かっていれば項目を読み、印を付ける。立ち上げが有効なら SF に立ち上げる ----
export async function afterImport(owner, ids, why = "取り込み") {
  const list = (ids || []).filter(Boolean); if (!list.length) return;
  try { if (owner) { await busyFresh(owner); await refreshSfx(owner, { leadIds: list }); } }
  catch (e) { console.error(`[mcmql] ${why}のあと SF の項目を読めませんでした（夜に読み直します）`, e.message); }
  await computeMql({ leadIds: list }).catch((e) => console.error(`[mcmql] ${why}のあと印を付けられませんでした`, e.message));
  if (owner && launchAutoOn()) await launchRun(owner, { leadIds: list, by: why }).catch((e) => console.error(`[mcmql] ${why}のあと SF に立ち上げられませんでした`, e.message));
}

// ---- SF 立ち上げ ----
// SF の Mochica リードと取引先の索引（会社名・電話番号）。作るのは重い（数万件を読む）ので6時間持つ。
//   持っている間は、前に作った時刻より後に直されたものだけ読み足す（その間に SF で人が作ったリードを取りこぼさないように）
let _idx = null;
const LEAD_SOQL = `SELECT Id, Company, Phone, MobilePhone, IsConverted, ConvertedAccountId, Ban_Type__c, LastModifiedDate FROM Lead WHERE RecordType.Name = 'Mochica（リード）'`;
const ACCT_SOQL = `SELECT Id, Name, Phone, LastModifiedDate FROM Account`;
const toRec = (type) => (r) => (type === "lead"
  ? { type, id: String(r.Id), company: r.Company || "", phones: [r.Phone, r.MobilePhone].filter(Boolean), conv: !!r.IsConverted, convAcct: r.ConvertedAccountId || "", ban: r.Ban_Type__c || "", mod: r.LastModifiedDate || "" }
  : { type, id: String(r.Id), company: r.Name || "", phones: [r.Phone].filter(Boolean), mod: r.LastModifiedDate || "" });
export async function sfIndex(owner, { fresh = false } = {}) {
  const now = new Date();
  if (!fresh && _idx && Date.now() - _idx.at < 6 * 3600e3) {
    const since = new Date(_idx.since - 5 * 60e3).toISOString().replace(/\.\d{3}Z$/, "Z");
    const nl = await sfQueryAll(owner, `${LEAD_SOQL} AND LastModifiedDate > ${since}`, 50000);
    const na = await sfQueryAll(owner, `${ACCT_SOQL} WHERE LastModifiedDate > ${since}`, 50000);
    if (nl.length || na.length) {
      const m = new Map(_idx.recs.map((r) => [r.id, r]));
      for (const r of nl.map(toRec("lead")).concat(na.map(toRec("acct")))) m.set(r.id, r);
      _idx = { ..._idx, recs: [...m.values()], index: buildIndex([...m.values()], approachKeys) };
    }
    _idx.since = now.getTime();
    return _idx;
  }
  const leads = (await sfQueryAll(owner, LEAD_SOQL, 500000)).map(toRec("lead"));
  const accts = (await sfQueryAll(owner, ACCT_SOQL, 800000)).map(toRec("acct"));
  const recs = leads.concat(accts);
  _idx = { at: Date.now(), since: now.getTime(), recs, leads: leads.length, accts: accts.length, index: buildIndex(recs, approachKeys) };
  return _idx;
}
// SF に作るリードのレコードタイプ。架電画面の「SF にリードを作る」（server/mccall.js）もこれを使う（作り方を2通りにしない・2026-11-27）。
//   必ず「Mochica（リード）」（DOC のリードと混ざらないように）。名前が少し違うときは Mochica を含むものを使う
export const MC_RT = "Mochica（リード）";
export async function mochicaRtId(owner) {
  const d = await sfQuery(owner, `SELECT Id, Name FROM RecordType WHERE SobjectType = 'Lead' AND IsActive = true AND Name LIKE '%Mochica%'`);
  const rs = d.records || []; const r = rs.find((x) => x.Name === MC_RT) || rs[0];
  return r ? r.Id : "";
}
// SF のリードの選択肢（リード元・業種）。読めなければ null（リード元は確かめずに進む・業種は決められないので作らない）
async function leadPicklists(owner) {
  try {
    const d = await describeObject(owner, "Lead");
    const vals = (name) => { const f = (d.fields || []).find((x) => x.name === name); return f ? (f.picklistValues || []).filter((v) => v.active !== false) : null; };
    const src = vals("LeadSource"), ind = vals("Industry");
    return { sources: src ? new Set(src.map((v) => v.value)) : null, industries: ind ? ind.map((v) => ({ value: v.value, label: v.label || v.value })) : null };
  } catch (e) { console.error("[mcmql] リードの選択肢を読めませんでした", e.message); return { sources: null, industries: null }; }
}
// 業種：リードに書いてある業種（BALES の業種・CSV の「業種」列など）が SF の選択肢と同じときだけ使う。
//   架電画面のように AI で見立てると1社ごとにお金がかかるので、まとめての立ち上げではしない（決まらないものは作らずに残す）
const nkey = (v) => String(v ?? "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
function industryOf(opts, ...cands) {
  if (!opts || !opts.length) return "";
  for (const c of cands) { const k = nkey(c); if (!k) continue; const o = opts.find((x) => nkey(x.value) === k || nkey(x.label) === k); if (o) return o.value; }
  return "";
}
const MAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const OWN = /(^|[@.])(neo-career|c-career|neocareer)\./i;
function pickData(d, re, ok = () => true) { for (const [k, v] of Object.entries(d || {})) if (v != null && typeof v !== "object" && re.test(k) && String(v).trim() && ok(String(v).trim())) return String(v).trim(); return ""; }
// 立ち上げの対象：SF のリードと結びついていない（取引先にも結びつけていない）、重複で止めていない、閉じていないリストのリード
async function launchTargets(leadIds) {
  const p = []; const w = ["c.dup_of IS NULL", "NOT l.closed", "(c.sf_lead_id IS NULL OR c.sf_lead_id !~ '^00Q')", "c.sf_acct_id IS NULL"];
  if (leadIds) { p.push(leadIds); w.push(`c.id = ANY($${p.length}::int[])`); }
  const sel = `SELECT c.id, c.src, c.company, c.phone, c.person, c.info, c.gate, c.data, c.seg, c.done, l.name AS list, l.lead_source`;
  try { return (await P().query(`${sel}, b.data AS b_data FROM mc_call_leads c JOIN mc_call_lists l ON l.id = c.list_id ${BALES_JOIN} WHERE ${w.join(" AND ")} ORDER BY c.id`, p)).rows; }
  catch (e) { if (!/mochica_bales_rows/.test(String(e.message))) throw e; return (await P().query(`${sel}, NULL::jsonb AS b_data FROM mc_call_leads c JOIN mc_call_lists l ON l.id = c.list_id WHERE ${w.join(" AND ")} ORDER BY c.id`, p)).rows; }
}
// 試し：SF には書かない。件数・判定ごとの見本・全件の行（CSV 用）を返す
export async function launchPlan(owner, { leadIds = null, fresh = false } = {}) {
  const t0 = Date.now();
  const [rt, pick, idx] = [await mochicaRtId(owner), await leadPicklists(owner), await sfIndex(owner, { fresh })];
  const sources = pick.sources;
  await loadApproachBans();
  const targets = await launchTargets(leadIds);
  const rows = [];
  for (const t of targets) {
    const data = t.src === "bales" ? (t.b_data || t.data || {}) : (t.data || {});
    const phones = phoneCands({ phone: t.phone, data, gate: t.gate, info: t.info });
    const banned = !!approachBanHitLeadSync({ company: t.company, phone: t.phone, info: t.info }, phones);
    const m = matchLead({ company: t.company, phones, banned }, idx.index, approachKeys);
    //   架電画面の「結びつける」と同じ決まり：コンバート済み・アプローチ禁止の SF のリードには結びつけない（あとで書けない・かけてはいけないため）（2026-11-27）
    if (m.action === "link" && m.hit && m.hit.conv) { m.action = "skip_conv"; m.why = `${m.why}（SF ではコンバート済み）`; }
    else if (m.action === "link" && m.hit && m.hit.ban && !/^(なし|無し|解除)$/.test(String(m.hit.ban).trim())) { m.action = "skip_ban"; m.why = `当たった SF のリードがアプローチ禁止（${m.hit.ban}）`; }
    const row = { id: t.id, list: t.list, src: t.src, done: t.done, company: t.company || "", phone: t.phone || "", action: m.action, why: m.why,
      hitId: m.hit ? m.hit.id : "", hitType: m.hit ? (m.hit.type === "lead" ? (m.hit.conv ? "リード（コンバート済み）" : "リード") : "取引先") : "", hitCompany: m.hit ? m.hit.company : "" };
    if (m.action === "create") {
      const sg = t.seg && (t.seg.v || 0) >= SEG_V ? t.seg : segOf({ src: t.src, data, company: t.company, phone: t.phone, person: t.person });
      const es = effectiveSource({ seg: sg, src: t.src, listSource: t.lead_source });
      if (!es.known) { row.action = "need_source"; row.why = "リストに SF のリード元が付いていない（リストに lead_source を付けるまで作らない）"; }
      else if (sources && !sources.has(es.v)) { row.action = "bad_source"; row.why = `「${es.v}」は SF のリード元の選択肢に無い`; }
      else if (!rt) { row.action = "bad_source"; row.why = "SF に「Mochica（リード）」のレコードタイプが見つからない（作らない）"; }
      const I = t.info || {}; const seg = sg || {};
      const industry = industryOf(pick.industries, seg.gyoshu, pickData(data, /^(業種|業種名|industry|businessCategory)$/i), I.industry);
      if (row.action === "create" && !industry) { row.action = "need_industry"; row.why = pick.industries ? `業種「${seg.gyoshu || "（空）"}」が SF の業種の選択肢に無い（架電画面の「SF にリードを作る」で選んで作る）` : "SF の業種の選択肢を読めない"; }
      row.fields = leadFields({
        company: t.company, phone: t.phone || phones[0] || "", person: t.person || ((I.contacts || [])[0] || {}).name || "",
        title: pickData(data, /^(役職|title|position|部署)$/i),
        email: [I.email, pickData(data, /mail|メール/i, (v) => MAIL_RE.test(v) && !OWN.test(v))].find((v) => v && MAIL_RE.test(String(v))) || "",
        web: I.web || pickData(data, /^(url|web|webサイト|hp|ホームページ|サイト|website|homepage)$/i, (v) => /\.[a-z]{2,}/i.test(v) && !OWN.test(v)),
        pref: seg.prefBy === "住所" ? seg.pref : prefFromAddress(pickData(data, /^(companyAddress|address|住所|所在地|本社所在地|会社住所)$/i)), address: pickData(data, /^(companyAddress|address|住所|所在地|本社所在地|会社住所)$/i),
        industry, source: es.v, list: t.list, src: t.src,
      }, rt);
    }
    rows.push(row);
  }
  const count = {}; for (const r of rows) count[r.action] = (count[r.action] || 0) + 1;
  const bySrc = {}; for (const r of rows) { const o = bySrc[r.src] || (bySrc[r.src] = {}); o[r.action] = (o[r.action] || 0) + 1; }
  const samples = {}; for (const r of rows) { const a = samples[r.action] || (samples[r.action] = []); if (a.length < 5) a.push(r); }
  return { at: new Date().toISOString(), ms: Date.now() - t0, targets: rows.length, count, bySrc, samples, rows, labels: LAUNCH_ACTION,
    sf: { leads: idx.leads, accts: idx.accts, indexAt: new Date(idx.at).toISOString(), recordType: !!rt, sources: sources ? sources.size : null, industries: pick.industries ? pick.industries.length : null }, dropped: [..._dropped] };
}
// 本番の立ち上げ（MCCALL_SF_LAUNCH=1 のときだけ）。試しと同じ判定で、結びつける・取引先を残す・1件ずつ作る。
//   始める前に索引を作り直す（途中で止まってやり直しても、前に作ったリードを「結びつける」に回して二重に作らないため）
let _launch = { running: false, last: null };
export async function launchRun(owner, { leadIds = null, by = "" } = {}) {
  if (!launchOn()) throw new Error("SF への立ち上げは、オーナーの承認後に有効にします（いまは試しだけです）");
  if (_launch.running) throw new Error("いま SF への立ち上げを実行中です。終わってからやり直してください");
  _launch.running = true; const t0 = Date.now(); const st = { by, at: new Date().toISOString(), linked: 0, acct: 0, created: 0, failed: 0, errors: [] };
  try {
    const plan = await launchPlan(owner, { leadIds, fresh: !leadIds });
    const changed = [];
    for (const r of plan.rows) {
      if (r.action === "link" && SF_ID.test(r.hitId)) {
        const x = await P().query(`UPDATE mc_call_leads SET sf_lead_id=$2 WHERE id=$1 AND (sf_lead_id IS NULL OR sf_lead_id !~ '^00Q')`, [r.id, r.hitId]);
        if (x.rowCount) { st.linked++; changed.push(r.id); }
      } else if (r.action === "acct" && r.hitId) {
        const x = await P().query(`UPDATE mc_call_leads SET sf_acct_id=$2 WHERE id=$1 AND sf_acct_id IS NULL`, [r.id, r.hitId]);
        if (x.rowCount) st.acct++;
      }
    }
    //   作るのは架電画面の「SF にリードを作る」と同じ sfCreateRecord で1件ずつ（2026-11-27）。
    //   salesforce.js はみんなで使う作りで MOCHICA の側では足せないため、まとめて作る API は使わない（SF の呼び出しは件数ぶんになる）
    for (const r of plan.rows.filter((x) => x.action === "create")) {
      let id = "";
      try { id = String(((await sfCreateRecord(owner, "Lead", r.fields)) || {}).id || ""); }
      catch (e) { st.failed++; if (st.errors.length < 20) st.errors.push(`${r.company}：${String(e.message).slice(0, 200)}`); continue; }
      if (!SF_ID.test(id)) { st.failed++; if (st.errors.length < 20) st.errors.push(`${r.company}：作れませんでした`); continue; }
      await P().query(`UPDATE mc_call_leads SET sf_lead_id=$2 WHERE id=$1 AND (sf_lead_id IS NULL OR sf_lead_id !~ '^00Q')`, [r.id, id]);
      st.created++; changed.push(r.id);
    }
    _idx = null;   // 作ったリードを次の判定で必ず見るように
    if (changed.length) { await refreshSfx(owner, { leadIds: changed }).catch(() => {}); await computeMql({ leadIds: changed }).catch(() => {}); }
    st.skipped = Object.fromEntries(Object.entries(plan.count).filter(([k]) => !["link", "create"].includes(k)));
  } finally {
    st.ms = Date.now() - t0; _launch = { running: false, last: st };
    console.log(`[mcmql] SF 立ち上げ（${by}）：結びつけた ${st.linked}・作った ${st.created}・取引先だけ ${st.acct}・作れなかった ${st.failed}`);
  }
  return st;
}

// ---- 画面（API）。画面は増やさない：管理者が状態を見る・今すぐ読み直す・試しの CSV を落とす・承認後に実行する ----
export function registerMcMql(app, { adminOnly, sfActor, getOwner, me }) {
  app.get("/api/mccall/mql/status", adminOnly(async (req, res) => {
    const t = (await P().query(`SELECT count(*) AS n, count(*) FILTER (WHERE c.mql IS NULL) AS unjudged,
        count(*) FILTER (WHERE c.mql IS NOT NULL AND NOT (COALESCE((c.mql->>'ok')::boolean,false) OR ${untilPassed("c.mql")})) AS out,
        count(*) FILTER (WHERE c.sf_lead_id ~ '^00Q') AS linked, count(*) FILTER (WHERE c.sfx IS NOT NULL) AS read, count(*) FILTER (WHERE c.sfx ? '_missing') AS missing
      FROM mc_call_leads c JOIN mc_call_lists l ON l.id=c.list_id WHERE NOT c.done AND c.dup_of IS NULL AND NOT l.closed`)).rows[0];
    const why = (await P().query(`SELECT w, count(*) AS n FROM mc_call_leads c JOIN mc_call_lists l ON l.id=c.list_id, jsonb_array_elements_text(COALESCE(c.mql->'why','[]'::jsonb)) AS w
      WHERE NOT c.done AND c.dup_of IS NULL AND NOT l.closed AND NOT (COALESCE((c.mql->>'ok')::boolean,false) OR ${untilPassed("c.mql")}) GROUP BY 1 ORDER BY 2 DESC`)).rows;
    const st = (await getSettings().catch(() => ({}))).mccallMqlNightly || {};
    res.json({ ok: true, gate: mqlGateOn(), nightly: process.env.MCCALL_MQL_NIGHTLY !== "0", running: _night.running, last: _night.last || st.last || null,
      total: +t.n, unjudged: +t.unjudged, out: +t.out, sf: { linked: +t.linked, read: +t.read, missing: +t.missing, dropped: [..._dropped] },
      why: why.map((r) => ({ k: r.w, label: MQL_WHY[r.w] || r.w, n: +r.n })), launch: { on: launchOn(), auto: launchAutoOn(), running: _launch.running, last: _launch.last } });
  }));
  // MQL 外の理由（2026-11-27）：リスト管理の分け口タブから使う（画面はこちらでは作らない）。外れたリードは消していないので、ここで理由ごと・1件ずつ見られる。
  //   ?list=MOCHICALL のリストの id ／ ?member=担当のメール … MOCHICALL に入っているリード（印 mc_call_leads.mql）
  //   ?bales=リスト管理のリストの印（list_key）／ ?name=kinbot の担当名 … BALES のリストの、かけられる行のうち外れる行（手持ち300件・今日の100件に入れない行）
  //   ?limit=… 返す行の数（既定 500・最大 5000）。数（out・why）はいつも全件で数える
  app.get("/api/mccall/mql/out", adminOnly(async (req, res) => {
    const lim = Math.min(5000, Math.max(0, parseInt(req.query.limit, 10) || 500));
    const label = (k) => MQL_WHY[k] || k;
    const countWhy = (rows) => { const m = {}; for (const r of rows) for (const w of r.why || []) m[w] = (m[w] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ k, label: label(k), n })); };
    if (req.query.bales) {
      const b = await mcBalesMqlRows(String(req.query.bales).slice(0, 200), { name: String(req.query.name || "") });
      if (!b) return res.status(404).json({ error: "そのリスト（リスト管理）が見つかりません。リストの印（list_key）を確かめてください" });
      return res.json({ ok: true, gate: mqlGateOn(), scope: "bales", total: b.total, out: b.out, why: countWhy(b.rows),
        rows: b.rows.slice(0, lim).map((r) => ({ ...r, labels: (r.why || []).map(label) })) });
    }
    const p = []; const w = ["NOT c.done", "c.dup_of IS NULL", "NOT l.closed"];
    if (req.query.list) { p.push(parseInt(req.query.list, 10) || 0); w.push(`c.list_id = $${p.length}`); }
    if (req.query.member) { p.push(String(req.query.member).toLowerCase().slice(0, 200)); w.push(`lower(c.assigned_to) = $${p.length}`); }
    const OUT = `c.mql IS NOT NULL AND NOT (COALESCE((c.mql->>'ok')::boolean,false) OR ${untilPassed("c.mql")})`;
    const t = (await P().query(`SELECT count(*) AS n, count(*) FILTER (WHERE c.mql IS NULL) AS unjudged, count(*) FILTER (WHERE ${OUT}) AS out
      FROM mc_call_leads c JOIN mc_call_lists l ON l.id=c.list_id WHERE ${w.join(" AND ")}`, p)).rows[0];
    const why = (await P().query(`SELECT x AS k, count(*) AS n FROM mc_call_leads c JOIN mc_call_lists l ON l.id=c.list_id, jsonb_array_elements_text(COALESCE(c.mql->'why','[]'::jsonb)) AS x
      WHERE ${w.join(" AND ")} AND ${OUT} GROUP BY 1 ORDER BY 2 DESC`, p)).rows;
    const rows = lim ? (await P().query(`SELECT c.id, c.company, c.assigned_to, c.list_id, l.name AS list, c.mql->'why' AS why, c.mql->>'until' AS until, c.mql->>'at' AS at
      FROM mc_call_leads c JOIN mc_call_lists l ON l.id=c.list_id WHERE ${w.join(" AND ")} AND ${OUT} ORDER BY c.id LIMIT ${lim}`, p)).rows : [];
    res.json({ ok: true, gate: mqlGateOn(), scope: "mochicall", total: +t.n, unjudged: +t.unjudged, out: +t.out,
      why: why.map((r) => ({ k: r.k, label: label(r.k), n: +r.n })), rows: rows.map((r) => ({ ...r, labels: (r.why || []).map(label) })) });
  }));
  // 今すぐ読み直す（夜の読み直しと同じ。裏で走らせて、終わったら status の last に出る）
  app.post("/api/mccall/mql/refresh", adminOnly(async (req, res) => {
    if (_night.running) return res.json({ ok: true, running: true });
    const owner = await sfActor(req).catch(() => "");
    runNightly(async () => owner || (await getOwner()), `手で読み直し（${me(req)}）`, { staleHours: 0 }).catch(() => {});
    res.json({ ok: true, started: true });
  }));
  // 試し（SF には書かない）。format=csv で全件の CSV、それ以外は件数と見本
  app.get("/api/mccall/sf-launch/plan", adminOnly(async (req, res) => {
    const owner = await sfActor(req);
    const plan = await launchPlan(owner, { fresh: req.query.fresh === "1" });
    if (req.query.format === "csv") {
      res.setHeader("content-type", "text/csv; charset=utf-8");
      res.setHeader("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`MOCHICALL_SF立ち上げの試し_${plan.at.slice(0, 10)}.csv`)}`);
      return res.end(planCsv(plan.rows));
    }
    const { rows, ...rest } = plan;
    res.json({ ok: true, dryRun: true, ...rest });
  }));
  app.post("/api/mccall/sf-launch/run", adminOnly(async (req, res) => {
    if (!launchOn()) return res.status(403).json({ error: "SF への立ち上げは、オーナーの承認後に有効にします（いまは試しだけです）。試しは /api/mccall/sf-launch/plan で見られます" });
    if (String((req.body || {}).confirm || "") !== "SF に作る") return res.status(400).json({ error: "確認の言葉（SF に作る）が入っていません" });
    if (_launch.running) return res.json({ ok: true, running: true });
    const owner = await sfActor(req);
    launchRun(owner, { by: `手で実行（${me(req)}）` }).catch((e) => console.error("[mcmql] SF 立ち上げが止まりました", e.message));
    res.json({ ok: true, started: true });
  }));
}
