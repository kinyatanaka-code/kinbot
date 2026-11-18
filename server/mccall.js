// kinbot for MOCHICA の架電（テレアポ）（2026-11-16 新しく作成。kincall の複製ではない）
//
// なぜ別に作ったか：
//   DOC の kincall の表（call_lists / call_targets / call_logs）は、SF 監査・コール進捗の通知・デイリー目標・
//   プロセスシートとつながっている。MOCHICA の架電を同じ表に入れると DOC の数字や SF の自動処理に混ざるので、
//   MOCHICA は mc_ で始まる自分の表だけに書く。DOC の表は「管理者がリードを持ってくるとき」に読むだけ。
//
// 部署をまたぐとき（田中さん 2026-11-16「管理者なら DOC からリストを持ってこられるように」）：
//   管理者だけが DOC のリストから MOCHICA の架電リストへリードを写せる。写したことは mc_cross_moves に
//   だれが・いつ・どこから・何件・なぜ を残し、写したリードには cross_from='DOC' の印を付ける。
//   DOC 側のリストは変えない（読むだけ）。
//
// 画面の考え方（ASUMO のレビューと kincall の評価から）：
//   結果は「どこまで届いたか → 中身」の2段。不在でも受付で聞けたこと（担当者名・在席時間・直通）を残す。
//   不在は同じ日のうちに自動で掛け直しに回す（解除できる）。記録の取り消しは「元に戻す」で行う。
import { dbPool, listUsers, approachBanHit, approachBanHitSync, loadApproachBans, listMembers, getSettings, saveSettings } from "./db.js";
import { freeBusy, gmailSend, isConnected as googleConnected } from "./google.js";
import { fixMojibake } from "./docs.js";
import { createTask, deleteTask, sfQuery, sfUpdateRecord } from "./salesforce.js";
import { judgeHot } from "./mchot.js";
import { lookupMynavi } from "./analyzer.js";
import { fetchPageText } from "./companyenrich.js";

const BIZ = "MOCHICA";

// 到達の段階と、その中身。key は画面とサーバーで同じものを使う
export const REACH = {
  none: { label: "つながらない", outcomes: { no_answer: "応答なし", busy: "話し中", voicemail: "留守電", invalid: "番号が使えない" } },
  gate: { label: "受付まで", outcomes: { absent: "担当者が不在", blocked: "受付で断られた", callback_req: "掛け直しを指定された" } },
  person: { label: "担当者と話せた", outcomes: { apo: "アポ獲得", doc_send: "資料を送る", follow: "また話す（フォロー）", reject: "断られた" } },
};
export const REJECT_REASONS = ["今は必要ない", "他社を使っている", "時期が合わない", "予算が無い", "採用の予定が無い", "その他"];
// 同じ日のうちに掛け直す結果（つながらなかった・担当者がいなかった）
const AUTO_RETRY = new Set(["no_answer", "busy", "voicemail", "absent"]);
// これ以上かけない結果
const FINAL = new Set(["invalid", "apo", "reject"]);

const P = () => dbPool();
const digits = (v) => String(v || "").normalize("NFKC").replace(/[^0-9]/g, "");
const clip = (v, n = 400) => String(v ?? "").replace(/<[^>]*>/g, "").trim().slice(0, n);

let _ready = null;
async function ensure() {
  if (!P()) throw new Error("データベースにつながっていません");
  if (_ready) return _ready;
  _ready = (async () => {
    const q = (s) => P().query(s);
    await q(`CREATE TABLE IF NOT EXISTS mc_call_lists (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, biz TEXT NOT NULL DEFAULT 'MOCHICA', note TEXT,
      members TEXT[] NOT NULL DEFAULT '{}', closed BOOLEAN NOT NULL DEFAULT false,
      created_by TEXT, created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS mc_call_leads (
      id SERIAL PRIMARY KEY, list_id INT REFERENCES mc_call_lists(id) ON DELETE CASCADE,
      biz TEXT NOT NULL DEFAULT 'MOCHICA', src TEXT NOT NULL, src_key TEXT NOT NULL,
      company TEXT, phone TEXT, person TEXT, sf_lead_id TEXT, hot SMALLINT, data JSONB,
      gate JSONB, cross_from TEXT, cross_id INT,
      next_at TIMESTAMPTZ, next_why TEXT, last_at TIMESTAMPTZ, last_outcome TEXT, attempts INT NOT NULL DEFAULT 0,
      done BOOLEAN NOT NULL DEFAULT false, assigned_to TEXT, locked_by TEXT, locked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(), UNIQUE (list_id, src, src_key))`);
    await q(`CREATE INDEX IF NOT EXISTS ix_mc_call_leads_q ON mc_call_leads(list_id, done, next_at)`);
    await q(`CREATE TABLE IF NOT EXISTS mc_call_logs (
      id SERIAL PRIMARY KEY, lead_id INT, list_id INT, biz TEXT NOT NULL DEFAULT 'MOCHICA', caller TEXT,
      phone TEXT, reach TEXT, outcome TEXT, reason TEXT, gate JSONB, memo TEXT, next_at TIMESTAMPTZ, apo_at TIMESTAMPTZ,
      cross_from TEXT, prev JSONB, sf_task_id TEXT, sf_err TEXT, undone BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS ix_mc_call_logs_lead ON mc_call_logs(lead_id, created_at DESC)`);
    await q(`CREATE INDEX IF NOT EXISTS ix_mc_call_logs_day ON mc_call_logs(created_at)`);
    // アポのおすすめ日時で選んだ「その時間に空いていたクローザー」（2026-11-17）
    await q(`ALTER TABLE mc_call_logs ADD COLUMN IF NOT EXISTS apo_who TEXT`);
    // 担当者と話せたときに聞いたこと（検討時期・採用ニーズ・説明会/面接の参加人数・採用目標人数）（2026-11-18 福井さん）
    //   リードには最新の値、記録にはそのとき聞いた値を残す（元に戻すで前の値へ戻せるように）
    await q(`ALTER TABLE mc_call_leads ADD COLUMN IF NOT EXISTS hearing JSONB`);
    await q(`ALTER TABLE mc_call_logs ADD COLUMN IF NOT EXISTS hearing JSONB`);
    // SF のリードの項目（検討開始時期・採用人数・顧客の課題感）を書けなかったとき。黙って失敗しない（ルール5）
    await q(`ALTER TABLE mc_call_logs ADD COLUMN IF NOT EXISTS sf_lead_err TEXT`);
    // マイナビ（新卒）の掲載の有無と中身。会社ごとに1回だけ調べて持っておく（同じ会社を何度も検索しないため）
    await q(`CREATE TABLE IF NOT EXISTS mc_mynavi (ckey TEXT PRIMARY KEY, company TEXT, data JSONB, at TIMESTAMPTZ DEFAULT now())`);
    // 資料送付の記録。架電の記録（mc_call_logs）に入れるとコール数に数えてしまうので別にする（2026-11-17）
    await q(`CREATE TABLE IF NOT EXISTS mc_doc_sends (
      id SERIAL PRIMARY KEY, lead_id INT, sender TEXT, to_addr TEXT, cc TEXT, subject TEXT, url TEXT, doc_name TEXT,
      sf_task_id TEXT, sf_err TEXT, created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS mc_cross_moves (
      id SERIAL PRIMARY KEY, from_biz TEXT, to_biz TEXT, from_ref TEXT, from_name TEXT, to_list_id INT,
      count INT, reason TEXT, by_user TEXT, at TIMESTAMPTZ DEFAULT now())`);
  })().catch((e) => { _ready = null; throw e; });
  return _ready;
}

// 日本時間の「今日の0時」
function jstDayStart(d = new Date()) {
  const j = new Date(d.getTime() + 9 * 3600e3); j.setUTCHours(0, 0, 0, 0); return new Date(j.getTime() - 9 * 3600e3);
}
function jstAt(base, h, m) { const s = jstDayStart(base); return new Date(s.getTime() + (h * 60 + m) * 60e3); }
function nextWeekday(d) { let x = new Date(d.getTime() + 86400e3); while ([0, 6].includes(new Date(x.getTime() + 9 * 3600e3).getUTCDay())) x = new Date(x.getTime() + 86400e3); return x; }
// 不在のときの掛け直しの時刻。受付で「いる時間」を聞けていればそこへ。無ければ2時間後（夕方を過ぎるなら次の平日の朝）
const SLOT = { 午前: [10, 0], 昼: [12, 30], 午後: [14, 0], 夕方: [17, 0] };
export function autoRetryAt(now, hours) {
  const slot = SLOT[String(hours || "").replace(/\s/g, "")] || null;
  if (slot) {
    const t = jstAt(now, slot[0], slot[1]);
    if (t.getTime() - now.getTime() > 30 * 60e3) return { at: t, why: `受付で聞いた「${hours}」に掛け直し` };
    return { at: jstAt(nextWeekday(now), slot[0], slot[1]), why: `受付で聞いた「${hours}」（次の平日）に掛け直し` };
  }
  const t = new Date(now.getTime() + 2 * 3600e3);
  if (t.getTime() <= jstAt(now, 18, 30).getTime()) return { at: t, why: "同じ日のうちに掛け直すとつながりやすいため、2時間後に掛け直し" };
  return { at: jstAt(nextWeekday(now), 10, 0), why: "今日はもう遅いので、次の平日の朝に掛け直し" };
}

// Bales の行から、会社名・電話・担当者を取り出す（camelCase と snake_case の両方がある）
function fromBales(d = {}) {
  const g = (...ks) => { for (const k of ks) { const v = d[k]; if (v != null && String(v).trim()) return String(v).trim(); } return ""; };
  return { company: g("companyName", "company_name"), phone: g("companyTel1", "company_tel1", "personalTel", "personal_tel"), person: g("targetName", "target_name") };
}
// 1社にある電話番号を全部（代表・電話2・担当者直通・受付で聞いた直通）
function phonesOf(lead, data = {}) {
  const out = []; const seen = new Set();
  const add = (label, v) => { const n = digits(v); if (n.length < 9 || seen.has(n)) return; seen.add(n); out.push({ label, number: String(v).trim(), digits: n }); };
  add("代表", lead.phone);
  const NAMES = { companyTel1: "代表", company_tel1: "代表", companyTel2: "電話2", company_tel2: "電話2", personalTel: "担当者直通", personal_tel: "担当者直通" };
  for (const [k, v] of Object.entries(data || {})) if (/tel|phone/i.test(k) && typeof v !== "object") add(NAMES[k] || k, v);
  if (lead.gate && lead.gate.direct) add("受付で聞いた直通", lead.gate.direct);
  return out;
}

async function nameMap() {
  const us = await listUsers().catch(() => []);
  return new Map(us.filter((u) => u && u.email).map((u) => [String(u.email).toLowerCase(), String(u.name || u.email)]));
}
function jstText(d) { if (!d) return ""; const j = new Date(new Date(d).getTime() + 9 * 3600e3); return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`; }
function outcomeLabel(o) { for (const r of Object.values(REACH)) if (r.outcomes[o]) return r.outcomes[o]; return o || ""; }

// 前回の架電を1行にまとめる（ASUMO 案3：「10/21 福井 受付NG → 担当は田中さん・午後なら在席 → 11月に再架電」）
function oneLine(log, gate, names) {
  if (!log) return "";
  const parts = [`${jstText(log.created_at).split(" ")[0]} ${names.get(String(log.caller || "").toLowerCase()) || log.caller || ""} ${outcomeLabel(log.outcome)}${log.reason ? `（${log.reason}）` : ""}`];
  const g = gate || {}; const gg = [g.name ? `担当は${g.name}さん` : "", g.hours ? `${g.hours}なら在席` : "", g.direct ? `直通あり` : ""].filter(Boolean);
  if (gg.length) parts.push(gg.join("・"));
  if (log.next_at) parts.push(`${jstText(log.next_at)} に再架電`);
  return parts.join(" → ");
}

// 会社名を比べるための形（全角半角・空白・株式会社などの違いをならす）。マイナビの調べ結果を会社ごとに持つのに使う
export function companyKey(name) {
  return String(name || "").normalize("NFKC").toLowerCase()
    .replace(/株式会社|有限会社|合同会社|合資会社|合名会社|\(株\)|\(有\)|\(同\)|㈱|㈲/g, "")
    .replace(/[\s・,.、。'"「」()（）\-ー‐]/g, "");
}

// ---- マイナビの調べ（2026-11-18 福井さん「リードのマイナビ掲載有無及びマイナビ情報の反映」。Web検索で自動・取込時にまとめて） ----
//   取り込んだ会社を順番に調べる（同時に2社まで。検索とAIの費用・速さを抑える）。
//   掲載ありは30日、見つからないは14日、失敗は1時間たったら調べ直す。
//   検索の鍵が無い・失敗したときは「失敗」として残して画面に出す（「見つからない」と取り違えない＝ルール5）
const MYNAVI_TTL = { listed: 30 * 86400e3, notfound: 14 * 86400e3, error: 3600e3 };
const _mnQueue = new Map(); let _mnRunning = 0;
async function mynaviCheck(ckey, company) {
  try {
    if (!process.env.BRAVE_API_KEY) throw new Error("Web検索の鍵（BRAVE_API_KEY）が設定されていません");
    const d = await lookupMynavi(company, fetchPageText);
    await P().query(`INSERT INTO mc_mynavi (ckey, company, data, at) VALUES ($1,$2,$3,now()) ON CONFLICT (ckey) DO UPDATE SET company=$2, data=$3, at=now()`, [ckey, company, d]);
  } catch (e) {
    console.error("[mccall] マイナビを調べられませんでした", company, e.message);
    await P().query(`INSERT INTO mc_mynavi (ckey, company, data, at) VALUES ($1,$2,$3,now()) ON CONFLICT (ckey) DO UPDATE SET data=$3, at=now()`,
      [ckey, company, { status: "error", error: String(e.message).slice(0, 200), checkedAt: new Date().toISOString() }]).catch(() => {});
  }
}
function mynaviPump() {
  while (_mnRunning < 2 && _mnQueue.size) {
    const [ckey, company] = _mnQueue.entries().next().value; _mnQueue.delete(ckey); _mnRunning++;
    mynaviCheck(ckey, company).finally(() => { _mnRunning--; mynaviPump(); });
  }
}
// まだ調べていない・古くなった会社だけ順番に入れる
export async function mynaviEnqueue(companies) {
  const m = new Map(); for (const c of companies) { const k = companyKey(c); if (k && k.length >= 2 && !m.has(k)) m.set(k, String(c).trim()); }
  if (!m.size) return 0;
  const have = (await P().query(`SELECT ckey, data->>'status' AS st, at FROM mc_mynavi WHERE ckey = ANY($1)`, [[...m.keys()]])).rows;
  const fresh = new Set(have.filter((r) => Date.now() - new Date(r.at).getTime() < (MYNAVI_TTL[r.st] || 0)).map((r) => r.ckey));
  let n = 0; for (const [k, c] of m) if (!fresh.has(k) && !_mnQueue.has(k)) { _mnQueue.set(k, c); n++; }
  mynaviPump(); return n;
}
async function mynaviOf(company) {
  const k = companyKey(company); if (!k) return null;
  const r = (await P().query(`SELECT data, at FROM mc_mynavi WHERE ckey=$1`, [k]).catch(() => ({ rows: [] }))).rows[0];
  if (!r || Date.now() - new Date(r.at).getTime() >= (MYNAVI_TTL[(r.data || {}).status] || 0)) { await mynaviEnqueue([company]).catch(() => {}); }
  if (!r) return { status: "checking" };
  return _mnQueue.has(k) && (r.data || {}).status === "error" ? { status: "checking" } : r.data;
}

// ---- ヒアリング（2026-11-18 福井さん「検討時期・採用ニーズの明記／接触人数・採用目標人数のヒヤリング」） ----
//   検討時期は SF の「検討開始時期」と同じ 1月〜12月（SF の選択肢に合わせる。未定も残せる）。
//   接触人数は「説明会・面接の参加人数」（福井さん決定）。人数は数字だけにして、あとで集計できるようにする
const MONTHS = Array.from({ length: 12 }, (_, i) => `${i + 1}月`);
const intOrNull = (v) => { const n = parseInt(String(v ?? "").normalize("NFKC").replace(/[^0-9]/g, ""), 10); return Number.isFinite(n) && n >= 0 && n < 1e6 ? n : null; };
export function cleanHearing(h = {}) {
  const when = String(h.when || "").trim();
  const o = { when: MONTHS.includes(when) || when === "未定" ? when : "", need: clip(h.need, 400), contact: intOrNull(h.contact), target: intOrNull(h.target) };
  return o.when || o.need || o.contact != null || o.target != null ? o : null;
}
// 前の値に、新しく聞けた項目だけを重ねる（空のまま記録しても、前に聞いた値を消さないため）
function mergeHearing(old, neu) {
  if (!neu) return old || null; const o = { ...(old || {}) };
  for (const k of ["when", "need", "contact", "target"]) if (neu[k] !== "" && neu[k] != null) o[k] = neu[k];
  return o;
}
export function hearingLines(h) {
  if (!h) return [];
  return [h.when && `検討時期：${h.when}`, h.need && `採用ニーズ：${h.need}`, h.contact != null && `説明会・面接の参加人数：${h.contact}名`, h.target != null && `採用目標人数：${h.target}名`].filter(Boolean);
}
// 採用目標人数 → SF の「採用人数(選択リスト)」の選択肢
export function hiresBucket(n) {
  if (n == null || n <= 0) return null;
  const B = [[2, "1～2名"], [5, "3～5名"], [10, "6～10名"], [15, "11～15名"], [20, "16～20名"], [25, "21～25名"], [30, "26～30名"], [35, "31～35名"], [40, "36～40名"], [45, "41～45名"], [50, "46～50名"], [100, "51～100名"], [200, "101～200名"], [300, "201～300名"]];
  for (const [max, v] of B) if (n <= max) return v; return "301名～";
}

export function registerMcCall(app, deps) {
  const { isAdmin, sfActor, mochicaSet } = deps;
  const isMcIntern = deps.isMcIntern || (async () => false);
  const me = (req) => String(req.user || "").toLowerCase();
  const guard = (fn) => async (req, res) => {
    try { if (!req.user) return res.status(401).json({ error: "ログインしてください" }); await ensure(); await fn(req, res); }
    catch (e) { console.error("[mccall]", req.path, e.message); res.status(500).json({ error: `うまくいきませんでした：${e.message}` }); }
  };
  // SF の活動（Task）をタイムラインの形で返す。読めなくても空で返す（架電の邪魔をしない）
  async function sfTasks(req, leadId, skipIds) {
    if (!leadId || !/^00Q[0-9A-Za-z]{12,15}$/.test(String(leadId))) return [];
    const run = (async () => {
      const owner = await sfActor(req);
      const l = ((await sfQuery(owner, `SELECT ConvertedAccountId FROM Lead WHERE Id='${leadId}'`)).records || [])[0] || {};
      const acc = l.ConvertedAccountId && /^001[0-9A-Za-z]{12,15}$/.test(l.ConvertedAccountId) ? ` OR AccountId='${l.ConvertedAccountId}'` : "";
      const rs = (await sfQuery(owner, `SELECT Id, Subject, Description, ActivityDate, CreatedDate, Type, Status, Owner.Name FROM Task
        WHERE WhoId='${leadId}'${acc} ORDER BY CreatedDate DESC LIMIT 50`)).records || [];
      return rs.filter((t) => !skipIds.has(t.Id)).map((t) => ({ at: t.CreatedDate || t.ActivityDate, src: "SF", who: clip((t.Owner && t.Owner.Name) || "", 40),
        title: clip(`${t.Type === "Call" ? "架電" : t.Type || "活動"}：${t.Subject || ""}`, 80), text: clip(t.Description || "", 600) }));
    })().catch((e) => { console.error("[mccall] SF の活動を読めませんでした", e.message); return null; });   // 時間切れのあとで失敗しても落ちないように先に受け止める
    const to = new Promise((ok) => setTimeout(() => ok(null), 5000));
    return (await Promise.race([run, to])) || [];
  }
  // 1件の記録を SF の活動（Task）に書く。結果は mc_call_logs の sf_task_id / sf_err に残す。
  //   SF のリードと結びついていない会社は書けないので「nolead」と残す（黙って書かないままにしない＝ルール5）。
  //   書き直し（/api/mccall/sf-retry）でも同じものを使う
  async function sfWrite(req, logId) {
    const g = (await P().query(`SELECT g.*, c.sf_lead_id FROM mc_call_logs g JOIN mc_call_leads c ON c.id=g.lead_id WHERE g.id=$1`, [logId])).rows[0];
    if (!g || g.undone || g.sf_task_id) return;
    if (!g.sf_lead_id || !/^00Q[0-9A-Za-z]{12,15}$/.test(g.sf_lead_id)) {
      await P().query(`UPDATE mc_call_logs SET sf_err='nolead' WHERE id=$1`, [logId]); return;
    }
    try {
      const owner = await sfActor(req);
      const names = await nameMap();
      const d = new Date(new Date(g.created_at).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
      const gt = g.gate || {}; const who = String(g.caller || "").toLowerCase();
      const t = await createTask(owner, {
        WhoId: g.sf_lead_id, Subject: `[MOCHICA 架電] ${outcomeLabel(g.outcome)}`, Type: "Call", Status: "完了", ActivityDate: d,
        Description: [`記録した人：${names.get(who) || who}（kinbot for MOCHICA）`, `到達：${(REACH[g.reach] || {}).label || g.reach}`, `結果：${outcomeLabel(g.outcome)}${g.reason ? `（${g.reason}）` : ""}`,
          gt.name || gt.hours || gt.direct ? `受付で聞けたこと：${[gt.name && `担当 ${gt.name}`, gt.hours && `在席 ${gt.hours}`, gt.direct && `直通 ${gt.direct}`].filter(Boolean).join("・")}` : "",
          ...hearingLines(g.hearing),
          g.apo_at ? `アポ：${jstText(g.apo_at)}${g.apo_who ? `（その時間に空いていたクローザー：${g.apo_who}）` : ""}` : "", g.next_at ? `次回：${jstText(g.next_at)}` : "", g.memo ? `メモ：${g.memo}` : "",
          g.cross_from ? `部署をまたいだ架電（${g.cross_from} のリード）` : ""].filter(Boolean).join("\n"),
      });
      if (!t || !t.id) throw new Error("SF から活動の番号が返ってきませんでした");
      await P().query(`UPDATE mc_call_logs SET sf_task_id=$2, sf_err=NULL WHERE id=$1`, [logId, t.id]);
      await sfLeadHearing(owner, g, d);
    } catch (e) {
      console.error("[mccall] SF の活動を書けませんでした", logId, e.message);
      await P().query(`UPDATE mc_call_logs SET sf_err=$2 WHERE id=$1`, [logId, String(e.message).slice(0, 300)]).catch(() => {});
    }
  }
  // ヒアリングで聞けたことを SF のリードの項目にも入れる（正本は SF。ルール3）。
  //   検討開始時期・採用人数はそのまま上書き、顧客の課題感は「【日付 架電】〜」を頭に足す（これまでの集約を消さないため）。
  //   接触人数は SF に合う項目が無いので活動の本文だけに残す。失敗は sf_lead_err に残して画面に出す
  async function sfLeadHearing(owner, g, day) {
    const h = g.hearing; if (!h) return;
    const f = {};
    if (MONTHS.includes(h.when)) f.Start_Considering_Date__c = h.when;
    const hb = hiresBucket(h.target); if (hb) f.Number_of_hires__c = hb;
    try {
      if (h.need) {
        const cur = (((await sfQuery(owner, `SELECT Client_Issue__c FROM Lead WHERE Id='${g.sf_lead_id}'`)).records || [])[0] || {}).Client_Issue__c || "";
        const line = `【${day.replace(/-/g, "/")} 架電】${h.need}`;
        if (!cur.includes(line)) f.Client_Issue__c = `${line}${cur ? `\n${cur}` : ""}`.slice(0, 32000);
      }
      if (!Object.keys(f).length) return;
      await sfUpdateRecord(owner, "Lead", g.sf_lead_id, f);
      await P().query(`UPDATE mc_call_logs SET sf_lead_err=NULL WHERE id=$1`, [g.id]);
    } catch (e) {
      console.error("[mccall] SF のリードの項目を書けませんでした", g.id, e.message);
      await P().query(`UPDATE mc_call_logs SET sf_lead_err=$2 WHERE id=$1`, [g.id, String(e.message).slice(0, 300)]).catch(() => {});
    }
  }
  // SF に書けていない記録（書いている途中で止まった＝2分たっても結果が無いものも含む）。nolead は別に数える
  const SF_FAIL = `NOT g.undone AND g.sf_task_id IS NULL AND COALESCE(g.sf_err,'') <> 'nolead' AND (g.sf_err IS NOT NULL OR g.created_at < now() - interval '2 minutes')`;

  const adminOnly = (fn) => guard(async (req, res) => { if (!isAdmin(req)) return res.status(403).json({ error: "リストの管理は管理者だけができます" }); await fn(req, res); });

  // 自分がかけてよいリスト（メンバー指定なし＝MOCHICA のメンバー全員。管理者はすべて見える）
  async function myListIds(req) {
    const u = me(req);
    const rows = (await P().query(`SELECT id, members FROM mc_call_lists WHERE biz=$1 AND NOT closed`, [BIZ])).rows;
    if (isAdmin(req)) return rows.map((r) => r.id);
    // MOCHICA のインターン（インサイド8名など）も「MOCHICA 全員」のリストに入る（2026-11-18）
    const mc = await mochicaSet().catch(() => new Set());
    const all = mc.has(u) || (await isMcIntern(u).catch(() => false));
    return rows.filter((r) => (r.members && r.members.length ? r.members.map((x) => String(x).toLowerCase()).includes(u) : all)).map((r) => r.id);
  }

  // ---- リスト ----
  app.get("/api/mccall/lists", guard(async (req, res) => {
    const ids = await myListIds(req);
    const rows = ids.length ? (await P().query(`SELECT l.id, l.name, l.note, l.members, l.created_at,
        count(c.id) AS total, count(c.id) FILTER (WHERE NOT c.done) AS open,
        count(c.id) FILTER (WHERE NOT c.done AND (c.next_at IS NULL OR c.next_at <= now())) AS now,
        count(c.id) FILTER (WHERE c.cross_from IS NOT NULL) AS cross
      FROM mc_call_lists l LEFT JOIN mc_call_leads c ON c.list_id=l.id WHERE l.id = ANY($1) GROUP BY l.id ORDER BY l.created_at DESC`, [ids])).rows : [];
    res.json({ ok: true, admin: isAdmin(req), items: rows.map((r) => ({ ...r, total: +r.total, open: +r.open, now: +r.now, cross: +r.cross })) });
  }));
  app.post("/api/mccall/lists", adminOnly(async (req, res) => {
    const name = clip(req.body && req.body.name, 80); if (!name) return res.status(400).json({ error: "リストの名前を入れてください" });
    const members = Array.isArray(req.body.members) ? req.body.members.map((x) => String(x).toLowerCase()).slice(0, 200) : [];
    const r = (await P().query(`INSERT INTO mc_call_lists (name, note, members, created_by) VALUES ($1,$2,$3,$4) RETURNING id`, [name, clip(req.body.note, 400), members, me(req)])).rows[0];
    res.json({ ok: true, id: r.id });
  }));
  app.patch("/api/mccall/lists/:id", adminOnly(async (req, res) => {
    const id = parseInt(req.params.id, 10); const b = req.body || {};
    if (b.name != null) await P().query(`UPDATE mc_call_lists SET name=$2 WHERE id=$1`, [id, clip(b.name, 80) || "名前なし"]);
    if (Array.isArray(b.members)) await P().query(`UPDATE mc_call_lists SET members=$2 WHERE id=$1`, [id, b.members.map((x) => String(x).toLowerCase()).slice(0, 200)]);
    if (b.closed != null) await P().query(`UPDATE mc_call_lists SET closed=$2 WHERE id=$1`, [id, !!b.closed]);
    res.json({ ok: true });
  }));

  // ---- リードの割り振り・他のリストへ移す（2026-11-17 福井さん。kinbot の利用状況で kincall の
  //      「複数人に分ける／この人たちに割り振る」約830回・「他のリストへ移す」85回/30日 と多く使われていたため） ----
  // かける順番（/queue）は assigned_to が空か自分のものだけ出すので、ここで assigned_to を埋めれば担当ごとに分かれる。
  const leadIdsOf = (b) => (Array.isArray(b && b.leadIds) ? b.leadIds.map((x) => parseInt(x, 10)).filter((x) => x > 0).slice(0, 5000) : []);
  app.get("/api/mccall/lists/:id/leads", adminOnly(async (req, res) => {
    const id = parseInt(req.params.id, 10); const names = await nameMap();
    const rows = (await P().query(`SELECT id, company, person, hot, attempts, last_outcome, next_at, assigned_to FROM mc_call_leads
      WHERE list_id=$1 AND NOT done ORDER BY COALESCE(hot,0) DESC, id LIMIT 3000`, [id])).rows;
    const total = +(await P().query(`SELECT count(*) FROM mc_call_leads WHERE list_id=$1 AND NOT done`, [id])).rows[0].count;
    res.json({ ok: true, total, items: rows.map((r) => ({ ...r, outcome: outcomeLabel(r.last_outcome), assigned: r.assigned_to ? names.get(r.assigned_to) || r.assigned_to : "" })) });
  }));
  // 選んだリード（選ばなければ、このリストの終わっていないリード全部）を、選んだ人で均等に分ける。
  // ホットな順に1件ずつ交互に配る（先頭からまとめて配るとホットが1人に偏るため）。だれも選ばなければ担当を外す。
  app.post("/api/mccall/lists/:id/assign", adminOnly(async (req, res) => {
    const id = parseInt(req.params.id, 10); const b = req.body || {};
    const l = (await P().query(`SELECT members FROM mc_call_lists WHERE id=$1`, [id])).rows[0];
    if (!l) return res.status(404).json({ error: "リストが見つかりません" });
    const members = [...new Set((Array.isArray(b.members) ? b.members : []).map((x) => String(x).toLowerCase().trim()).filter(Boolean))].slice(0, 100);
    // リストにメンバーが決まっているのに、その外の人に配ると、その人の「かける」にリストが出ず宙に浮く
    if (l.members && l.members.length) {
      const out = members.filter((m) => !l.members.map((x) => String(x).toLowerCase()).includes(m));
      if (out.length) return res.status(400).json({ error: "このリストのメンバーに入っていない人がいます。先に「メンバー」で足してください" });
    }
    const ids = leadIdsOf(b);
    const rows = (await P().query(`SELECT id FROM mc_call_leads WHERE list_id=$1 AND NOT done ${ids.length ? "AND id = ANY($2)" : ""} ORDER BY COALESCE(hot,0) DESC, id`, ids.length ? [id, ids] : [id])).rows;
    if (!rows.length) return res.status(400).json({ error: "分けるリードがありません（終わったリードは分けません）" });
    if (!members.length) {
      const x = await P().query(`UPDATE mc_call_leads SET assigned_to=NULL WHERE id = ANY($1)`, [rows.map((r) => r.id)]);
      return res.json({ ok: true, cleared: x.rowCount, per: [] });
    }
    const buckets = members.map(() => []);
    rows.forEach((r, i) => buckets[i % members.length].push(r.id));
    for (let i = 0; i < members.length; i++) if (buckets[i].length) await P().query(`UPDATE mc_call_leads SET assigned_to=$2 WHERE id = ANY($1)`, [buckets[i], members[i]]);
    const names = await nameMap();
    res.json({ ok: true, assigned: rows.length, per: members.map((m, i) => ({ name: names.get(m) || m, n: buckets[i].length })) });
  }));
  // 選んだリードを他の開いているリストへ移す。移し先に同じリードがあるものは二重にしないため移さず、件数を返す。
  // 担当は外す（移し先のメンバーでない人に付いたままだと、だれの順番にも出なくなるため）。過去の架電記録はそのまま残す。
  app.post("/api/mccall/lists/:id/move", adminOnly(async (req, res) => {
    const id = parseInt(req.params.id, 10); const b = req.body || {};
    const to = parseInt(b.toListId, 10); const ids = leadIdsOf(b);
    if (!ids.length) return res.status(400).json({ error: "移すリードを選んでください" });
    if (!to || to === id) return res.status(400).json({ error: "移し先のリストを選んでください" });
    const t = (await P().query(`SELECT id, closed FROM mc_call_lists WHERE id=$1`, [to])).rows[0];
    if (!t || t.closed) return res.status(400).json({ error: "移し先のリストが見つからないか、閉じています" });
    const x = await P().query(`UPDATE mc_call_leads c SET list_id=$2, assigned_to=NULL, locked_by=NULL, locked_at=NULL
      WHERE c.list_id=$1 AND c.id = ANY($3) AND NOT EXISTS (SELECT 1 FROM mc_call_leads d WHERE d.list_id=$2 AND d.src=c.src AND d.src_key=c.src_key)`, [id, to, ids]);
    res.json({ ok: true, moved: x.rowCount, skipped: ids.length - x.rowCount });
  }));

  // Bales のリストから写す（同じリードがほかの開いている MOCHICA のリストにあれば入れない＝二重にかけない）
  app.post("/api/mccall/lists/:id/from-bales", adminOnly(async (req, res) => {
    const id = parseInt(req.params.id, 10); const b = req.body || {};
    const key = String(b.listKey || ""); if (!key) return res.status(400).json({ error: "Bales のリストを選んでください" });
    const l = (await P().query(`SELECT run_at FROM mochica_bales_lists WHERE list_key=$1`, [key])).rows[0];
    if (!l) return res.status(404).json({ error: "Bales のリストが見つかりません。リスト（Bales Cloud）で取り込み直してください" });
    const HW = { hot: "AND hot >= 3", "warm+": "AND hot >= 2" }; const lim = Math.min(Math.max(parseInt(b.limit, 10) || 300, 1), 5000);
    const rows = (await P().query(`SELECT row_key, data, hot, sf->'lead'->>'id' AS lid FROM mochica_bales_rows WHERE list_key=$1 AND run_at=$2 ${HW[b.hot] || ""}
      AND NOT EXISTS (SELECT 1 FROM mc_call_leads c JOIN mc_call_lists x ON x.id=c.list_id WHERE NOT x.closed AND NOT c.done AND c.src='bales' AND c.src_key = $1::text || '|' || mochica_bales_rows.row_key)
      ORDER BY COALESCE(hot,0) DESC, seq LIMIT $3`, [key, l.run_at, lim])).rows;
    await loadApproachBans().catch(() => {});
    let added = 0, banned = 0;
    for (const r of rows) {
      const f = fromBales(r.data || {});
      if (approachBanHitSync({ company: f.company, phone: f.phone, leadId: r.lid })) { banned++; continue; }
      const x = await P().query(`INSERT INTO mc_call_leads (list_id, src, src_key, company, phone, person, sf_lead_id, hot) VALUES ($1,'bales',$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [id, `${key}|${r.row_key}`, f.company, f.phone, f.person, r.lid || null, r.hot]);
      added += x.rowCount;
    }
    mynaviEnqueue(rows.map((r) => fromBales(r.data || {}).company)).catch((e) => console.error("[mccall] マイナビの調べを始められませんでした", e.message));
    res.json({ ok: true, added, banned, skipped: rows.length - added - banned });
  }));

  // CSV から足す（2026-11-18 福井さん「架電リストをcsvからアップロードできるように」）。
  //   CSV はブラウザで読んで、行ごとに { company, phone, person, sfLeadId, extra } にして送ってくる。
  //   同じ電話番号（無ければ会社名）が、ほかの開いている MOCHICA のリストでまだ終わっていなければ入れない＝二重にかけない。
  //   SF のリードIDが無い行は架電結果を SF に書けない（nolead）ので、件数を返して画面で知らせる（ルール5）。
  app.post("/api/mccall/lists/:id/from-csv", adminOnly(async (req, res) => {
    const id = parseInt(req.params.id, 10); const b = req.body || {};
    const l = (await P().query(`SELECT id, closed FROM mc_call_lists WHERE id=$1`, [id])).rows[0];
    if (!l || l.closed) return res.status(404).json({ error: "リストが見つからないか、閉じています" });
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 5000);
    if (!rows.length) return res.status(400).json({ error: "CSV に読める行がありません" });
    const ckey = (s) => String(s || "").normalize("NFKC").replace(/株式会社|有限会社|合同会社|\(株\)|\(有\)|[\s　・.,、。]/g, "").toLowerCase();
    const open = (await P().query(`SELECT c.phone, c.company FROM mc_call_leads c JOIN mc_call_lists x ON x.id=c.list_id WHERE x.biz=$1 AND NOT x.closed AND NOT c.done AND c.list_id <> $2`, [BIZ, id])).rows;
    const seenPh = new Set(open.map((r) => digits(r.phone)).filter((x) => x.length >= 9));
    const seenCo = new Set(open.map((r) => ckey(r.company)).filter(Boolean));
    await loadApproachBans().catch(() => {});
    let added = 0, banned = 0, dup = 0, bad = 0, nolead = 0; const companies = [];
    for (const r of rows) {
      const company = clip(r.company, 200), phone = clip(r.phone, 40), person = clip(r.person, 100);
      const ph = digits(phone), ck = ckey(company);
      if (!company && ph.length < 9) { bad++; continue; }
      if ((ph.length >= 9 && seenPh.has(ph)) || (ph.length < 9 && ck && seenCo.has(ck))) { dup++; continue; }
      const lid = /^00Q[0-9A-Za-z]{12,15}$/.test(String(r.sfLeadId || "").trim()) ? String(r.sfLeadId).trim() : null;
      if (approachBanHitSync({ company, phone, leadId: lid })) { banned++; continue; }
      const extra = {}; if (r.extra && typeof r.extra === "object") for (const [k, v] of Object.entries(r.extra).slice(0, 60)) { const kk = clip(k, 60), vv = clip(v, 1000); if (kk && vv) extra[kk] = vv; }
      const x = await P().query(`INSERT INTO mc_call_leads (list_id, src, src_key, company, phone, person, sf_lead_id, data) VALUES ($1,'csv',$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [id, ph.length >= 9 ? ph : `co:${ck}`, company, phone, person, lid, extra]);
      if (!x.rowCount) { dup++; continue; }
      added++; if (!lid) nolead++; companies.push(company);
      if (ph.length >= 9) seenPh.add(ph); else if (ck) seenCo.add(ck);
    }
    mynaviEnqueue(companies).catch((e) => console.error("[mccall] マイナビの調べを始められませんでした", e.message));
    res.json({ ok: true, added, banned, dup, bad, nolead });
  }));

  // DOC の kincall のリスト一覧（読むだけ）。管理者がリードを持ってくるときに選ぶ
  app.get("/api/mccall/doc/lists", adminOnly(async (req, res) => {
    const rows = (await P().query(`SELECT l.id, l.name, l.owner, count(t.id) FILTER (WHERE NOT t.done) AS open
      FROM call_lists l LEFT JOIN call_targets t ON t.list_id=l.id WHERE NOT l.closed GROUP BY l.id ORDER BY l.id DESC LIMIT 300`)).rows;
    res.json({ ok: true, items: rows.map((r) => ({ ...r, open: +r.open })) });
  }));
  // DOC のリストから写す（部署をまたぐ）。理由は必ず。DOC 側は変えない
  app.post("/api/mccall/lists/:id/from-doc", adminOnly(async (req, res) => {
    const id = parseInt(req.params.id, 10); const b = req.body || {};
    const docId = parseInt(b.docListId, 10); const reason = clip(b.reason, 300);
    if (!docId) return res.status(400).json({ error: "DOC のリストを選んでください" });
    if (!reason) return res.status(400).json({ error: "部署をまたぐ理由を入れてください（あとで一覧に残ります）" });
    const dl = (await P().query(`SELECT id, name FROM call_lists WHERE id=$1`, [docId])).rows[0]; if (!dl) return res.status(404).json({ error: "DOC のリストが見つかりません" });
    const ts = (await P().query(`SELECT id, company, person, phone, lead_id FROM call_targets WHERE list_id=$1 AND NOT done ORDER BY sort_order, id LIMIT 5000`, [docId])).rows;
    await loadApproachBans().catch(() => {});
    const mv = (await P().query(`INSERT INTO mc_cross_moves (from_biz, to_biz, from_ref, from_name, to_list_id, count, reason, by_user) VALUES ('DOC',$1,$2,$3,$4,0,$5,$6) RETURNING id`,
      [BIZ, String(docId), dl.name, id, reason, me(req)])).rows[0];
    let added = 0, banned = 0;
    for (const t of ts) {
      if (approachBanHitSync({ company: t.company, phone: t.phone, leadId: t.lead_id })) { banned++; continue; }
      const x = await P().query(`INSERT INTO mc_call_leads (list_id, src, src_key, company, phone, person, sf_lead_id, cross_from, cross_id) VALUES ($1,'doc',$2,$3,$4,$5,$6,'DOC',$7) ON CONFLICT DO NOTHING`,
        [id, String(t.id), t.company, t.phone, t.person, t.lead_id || null, mv.id]);
      added += x.rowCount;
    }
    await P().query(`UPDATE mc_cross_moves SET count=$2 WHERE id=$1`, [mv.id, added]);
    mynaviEnqueue(ts.map((t) => t.company)).catch((e) => console.error("[mccall] マイナビの調べを始められませんでした", e.message));
    res.json({ ok: true, added, banned, skipped: ts.length - added - banned, moveId: mv.id });
  }));

  // 部署をまたいだ記録（持ってきた履歴と、そのリードへの架電の数）
  app.get("/api/mccall/cross", adminOnly(async (req, res) => {
    const names = await nameMap();
    const moves = (await P().query(`SELECT m.*, l.name AS to_name,
        (SELECT count(*) FROM mc_call_logs g JOIN mc_call_leads c ON c.id=g.lead_id WHERE c.cross_id=m.id AND NOT g.undone) AS calls,
        (SELECT count(*) FROM mc_call_logs g JOIN mc_call_leads c ON c.id=g.lead_id WHERE c.cross_id=m.id AND NOT g.undone AND g.outcome='apo') AS apo
      FROM mc_cross_moves m LEFT JOIN mc_call_lists l ON l.id=m.to_list_id ORDER BY m.at DESC LIMIT 200`)).rows;
    const calls = (await P().query(`SELECT g.id, g.caller, g.outcome, g.created_at, c.company, m.from_name FROM mc_call_logs g JOIN mc_call_leads c ON c.id=g.lead_id
      LEFT JOIN mc_cross_moves m ON m.id=c.cross_id WHERE g.cross_from IS NOT NULL AND NOT g.undone ORDER BY g.created_at DESC LIMIT 100`)).rows;
    res.json({ ok: true, moves: moves.map((m) => ({ ...m, by: names.get(String(m.by_user || "").toLowerCase()) || m.by_user, calls: +m.calls, apo: +m.apo })),
      calls: calls.map((c) => ({ ...c, caller: names.get(String(c.caller || "").toLowerCase()) || c.caller, outcome: outcomeLabel(c.outcome) })) });
  }));

  // ---- かける順番 ----
  // 掛け直しの時刻が来たもの → まだかけていないホットな順 → 回数の少ない順。ほかの人が開いている（10分以内）ものは飛ばす
  app.get("/api/mccall/queue", guard(async (req, res) => {
    const ids = await myListIds(req); const listId = parseInt(req.query.list, 10);
    const use = listId ? ids.filter((x) => x === listId) : ids;
    if (!use.length) return res.json({ ok: true, items: [], later: 0 });
    const u = me(req);
    const items = (await P().query(`SELECT id, company, person, hot, attempts, next_at, next_why, last_outcome, cross_from FROM mc_call_leads
      WHERE list_id = ANY($1) AND NOT done AND (next_at IS NULL OR next_at <= now())
        AND (assigned_to IS NULL OR assigned_to=$2) AND (locked_by IS NULL OR locked_by=$2 OR locked_at < now() - interval '10 minutes')
      ORDER BY (next_at IS NOT NULL) DESC, next_at, COALESCE(hot,0) DESC, attempts, id LIMIT 60`, [use, u])).rows;
    const later = (await P().query(`SELECT count(*) FROM mc_call_leads WHERE list_id = ANY($1) AND NOT done AND next_at > now() AND next_at < $2`, [use, jstAt(new Date(), 23, 59)])).rows[0].count;
    res.json({ ok: true, items: items.map((x) => ({ ...x, outcome: outcomeLabel(x.last_outcome) })), later: +later });
  }));

  // ---- 1社の中身（開くとほかの人の順番から外す） ----
  app.get("/api/mccall/leads/:id", guard(async (req, res) => {
    const id = parseInt(req.params.id, 10); const u = me(req);
    const lead = (await P().query(`SELECT * FROM mc_call_leads WHERE id=$1`, [id])).rows[0];
    if (!lead) return res.status(404).json({ error: "このリードは見つかりません（リストから外された可能性があります）" });
    if (!(await myListIds(req)).includes(lead.list_id)) return res.status(403).json({ error: "このリストはあなたの担当ではありません" });
    if (req.query.lock === "1") await P().query(`UPDATE mc_call_leads SET locked_by=$2, locked_at=now() WHERE id=$1`, [id, u]);
    const names = await nameMap();
    // 元のデータ（Bales は最新の取り込みを読む。DOC は call_targets を読むだけ）
    let data = {}, sf = null, detail = null;
    if (lead.src === "bales") {
      const [lk, rk] = String(lead.src_key).split("|");
      const r = (await P().query(`SELECT data, sf, detail FROM mochica_bales_rows WHERE list_key=$1 AND row_key=$2`, [lk, rk]).catch(() => ({ rows: [] }))).rows[0];
      if (r) { data = r.data || {}; sf = r.sf || null; detail = r.detail || null; }
    } else if (lead.src === "doc") {
      const t = (await P().query(`SELECT t.company, t.person, t.phone, t.email, t.industry, t.stage, t.status, t.memo, t.assigned_to, l.name AS list_name
        FROM call_targets t LEFT JOIN call_lists l ON l.id=t.list_id WHERE t.id=$1`, [parseInt(lead.src_key, 10)]).catch(() => ({ rows: [] }))).rows[0];
      if (t) data = { ...t, assigned_to: names.get(String(t.assigned_to || "").toLowerCase()) || t.assigned_to };
    } else if (lead.src === "csv") data = lead.data || {};
    const ban = await approachBanHit({ company: lead.company, phone: lead.phone, leadId: lead.sf_lead_id }).catch(() => null);
    const logs = (await P().query(`SELECT * FROM mc_call_logs WHERE lead_id=$1 AND NOT undone ORDER BY created_at DESC LIMIT 50`, [id])).rows;
    // 番号ごとの「つながった実績」（MOCHICA の記録すべてから。リードが変わっても番号で数える）
    const phones = phonesOf(lead, data);
    if (phones.length) {
      const st = (await P().query(`SELECT regexp_replace(COALESCE(phone,''),'[^0-9]','','g') AS d, count(*) AS n,
          count(*) FILTER (WHERE reach <> 'none') AS reached, count(*) FILTER (WHERE outcome='invalid') AS invalid,
          (array_agg(outcome ORDER BY created_at DESC))[1] AS last, max(created_at) AS last_at
        FROM mc_call_logs WHERE NOT undone AND regexp_replace(COALESCE(phone,''),'[^0-9]','','g') = ANY($1) GROUP BY 1`, [phones.map((p) => p.digits)])).rows;
      const m = new Map(st.map((s) => [s.d, s]));
      for (const p of phones) { const s = m.get(p.digits); p.n = s ? +s.n : 0; p.reached = s ? +s.reached : 0; p.invalid = s ? +s.invalid > 0 : false; p.last = s ? outcomeLabel(s.last) : ""; p.lastAt = s ? jstText(s.last_at) : ""; }
    }
    // DOC でも同じ番号を持っているか（知らせるだけ。止めない）
    let docAlso = [];
    if (lead.src !== "doc" && phones.length) {
      docAlso = (await P().query(`SELECT l.name AS list, t.assigned_to, t.status FROM call_targets t JOIN call_lists l ON l.id=t.list_id
        WHERE NOT l.closed AND regexp_replace(COALESCE(t.phone,''),'[^0-9]','','g') = ANY($1) LIMIT 3`, [phones.map((p) => p.digits)]).catch(() => ({ rows: [] }))).rows
        .map((r) => ({ ...r, assigned_to: names.get(String(r.assigned_to || "").toLowerCase()) || r.assigned_to || "" }));
    }
    // これまで：MOCHICA の架電・Bales の活動・SF の商談を1本の時系列に
    const tl = logs.map((g) => ({ at: g.created_at, src: "kinbot", who: names.get(String(g.caller || "").toLowerCase()) || g.caller, title: outcomeLabel(g.outcome) + (g.reason ? `（${g.reason}）` : ""),
      text: [g.memo, g.gate && (g.gate.name || g.gate.hours || g.gate.direct) ? `受付で聞けたこと：${[g.gate.name && `担当 ${g.gate.name}`, g.gate.hours && `在席 ${g.gate.hours}`, g.gate.direct && `直通 ${g.gate.direct}`].filter(Boolean).join("・")}` : "", g.next_at ? `次回 ${jstText(g.next_at)}` : "", g.apo_at ? `アポ ${jstText(g.apo_at)}${g.apo_who ? `（空いていたクローザー：${g.apo_who}）` : ""}` : ""].filter(Boolean).join("\n"),
      memo: g.memo || "", reach: g.reach, cross: !!g.cross_from, logId: g.id, mine: String(g.caller || "").toLowerCase() === u && Date.now() - new Date(g.created_at).getTime() < 15 * 60e3 }));
    const dateOf = (o) => { for (const v of Object.values(o || {})) if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v; return null; };
    const textOf = (o) => { for (const [k, v] of Object.entries(o || {})) if (/comment|memo|content|note|body|text/i.test(k) && typeof v === "string" && v.trim()) return v; return ""; };
    const typeOf = (o) => { for (const [k, v] of Object.entries(o || {})) if (/(type|result|status).*(text|name)|actiontype/i.test(k) && typeof v === "string") return v; return ""; };
    if (detail && typeof detail === "object") {
      for (const v of Object.values(detail)) if (Array.isArray(v)) for (const o of v.slice(0, 30)) {
        if (!o || typeof o !== "object") continue; const at = dateOf(o); if (!at) continue;
        tl.push({ at, src: "Bales", who: clip(o.userName || (o.user && o.user.name) || o.operatorName || "", 40), title: clip(typeOf(o) || "活動", 60), text: clip(textOf(o), 600) });
      }
    }
    if (!tl.some((x) => x.src === "Bales") && (data.lastActivityAt || data.last_activity_at)) tl.push({ at: data.lastActivityAt || data.last_activity_at, src: "Bales", who: clip(data.operatorName || "", 40), title: clip(data.lastActivityTypeText || "最終活動", 60), text: clip(data.lastActivityComment || "", 600) });
    if (sf && Array.isArray(sf.opps)) for (const o of sf.opps.slice(0, 10)) if (o.date) tl.push({ at: o.date, src: "SF", who: o.owner || "", title: `商談：${o.stage || ""}`, text: clip(o.name, 200) });
    // SF の活動（DOC やほかの人の架電・メモ）も同じ時系列に。リードがコンバート済みなら取引先側の活動も読む。
    // kinbot for MOCHICA から書いた Task は上の kinbot の記録と同じものなので、二重に出さないよう外す。
    // SF が遅い・落ちているときでも画面は開けるように、待つのは数秒だけにする
    // 資料送付も同じ時系列に出す（SF に書いた活動は下の SF の読み込みで二重にならないよう外す）
    const sends = (await P().query(`SELECT * FROM mc_doc_sends WHERE lead_id=$1 ORDER BY created_at DESC LIMIT 20`, [id]).catch(() => ({ rows: [] }))).rows;
    for (const s of sends) tl.push({ at: s.created_at, src: "kinbot", who: names.get(String(s.sender || "").toLowerCase()) || s.sender, title: "資料送付",
      text: [`${s.to_addr} に送付${s.cc ? `（CC ${s.cc}）` : ""}`, s.doc_name ? `資料：${s.doc_name}` : "", s.sf_err ? "SF の活動には書けませんでした" : ""].filter(Boolean).join("\n") });
    for (const t of await sfTasks(req, lead.sf_lead_id || (sf && sf.lead && sf.lead.id), new Set([...logs.map((g) => g.sf_task_id), ...sends.map((s) => s.sf_task_id)].filter(Boolean)))) tl.push(t);
    tl.sort((a, b) => new Date(b.at) - new Date(a.at));
    // ひと目で（2026-11-18 福井さん「検討時期・採用ニーズ・過去架電内容が架電時に調べなくても一目でわかるように」）
    //   SF の決まった項目はそのまま出し、言葉は新しい記録から順に読んで最初に当たった1文を出す（いちばん新しい状況を見せるため）。
    //   kinbot の記録は自動で足した「次回 〇/〇」などで時期と取り違えないよう、メモだけを読む
    const glance = (() => {
      const L = (sf && sf.lead) || {};
      const sfv = (labels) => labels.map((k) => [k, String(L[k] ?? "").trim()]).filter(([, v]) => v);
      const hit = (key) => {
        for (const t of tl) { const s = t.src === "kinbot" ? t.memo : t.text; if (!s) continue; const j = judgeHot({ comment: s }, null)[key]; if (j.st) return { st: j.st, why: j.why, at: t.at, src: t.src, who: t.who || "" }; }
        const j = judgeHot(data, null)[key]; return j.st ? { st: j.st, why: j.why, at: null, src: lead.src === "doc" ? "DOC" : "Bales", who: "" } : null;
      };
      // 架電で聞いたヒアリングをいちばん上に（いちばん新しく、本人から聞いた値なので）
      const H = lead.hearing || {}; const kv = (arr) => arr.filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]);
      const by = H.at ? { at: H.at, who: names.get(String(H.by || "").toLowerCase()) || H.by || "" } : null;
      return { need: { kb: kv([["採用ニーズ", H.need], ["採用目標人数", H.target != null ? `${H.target}名` : ""], ["説明会・面接の参加人数", H.contact != null ? `${H.contact}名` : ""]]), by, sf: sfv(["顧客の課題感", "顧客の現状", "採用人数(選択リスト)", "利用中ATS"]), hit: hit("need") },
        when: { kb: kv([["検討時期", H.when]]), by, sf: sfv(["検討開始時期", "現利用サービス更新予定月"]), hit: hit("when") } };
    })();
    for (const t of tl) delete t.memo;
    const mynavi = await mynaviOf(lead.company).catch(() => null);
    res.json({ ok: true, lead: { ...lead, data }, ban, phones, docAlso, glance, mynavi, timeline: tl.slice(0, 80), summary: oneLine(logs[0], lead.gate, names),
      sf: sf && sf.lead ? { lead: sf.lead, sum: sf.sum || null } : null, cross: lead.cross_id ? (await P().query(`SELECT from_name, reason, at FROM mc_cross_moves WHERE id=$1`, [lead.cross_id])).rows[0] || null : null });
  }));
  // 開いたまま次へ行かなかったときに順番へ戻す
  app.post("/api/mccall/leads/:id/release", guard(async (req, res) => {
    await P().query(`UPDATE mc_call_leads SET locked_by=NULL WHERE id=$1 AND locked_by=$2`, [parseInt(req.params.id, 10), me(req)]); res.json({ ok: true });
  }));
  // 受付で聞けたことだけを残す（入力欄を離れたら自動で保存）
  app.post("/api/mccall/leads/:id/gate", guard(async (req, res) => {
    const g = req.body || {}; const gate = { name: clip(g.name, 40), hours: clip(g.hours, 30), direct: clip(g.direct, 30), at: new Date().toISOString(), by: me(req) };
    await P().query(`UPDATE mc_call_leads SET gate=$2 WHERE id=$1`, [parseInt(req.params.id, 10), gate]); res.json({ ok: true, gate });
  }));
  // ヒアリングで聞けたことだけを残す（欄を離れたら自動で保存。SF へは「記録して次へ」のときに書く）
  app.post("/api/mccall/leads/:id/hearing", guard(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const lead = (await P().query(`SELECT list_id, hearing FROM mc_call_leads WHERE id=$1`, [id])).rows[0];
    if (!lead) return res.status(404).json({ error: "このリードは見つかりません" });
    if (!(await myListIds(req)).includes(lead.list_id)) return res.status(403).json({ error: "このリストはあなたの担当ではありません" });
    const h = mergeHearing(lead.hearing, cleanHearing(req.body || {}));
    if (h) { h.at = new Date().toISOString(); h.by = me(req); }
    await P().query(`UPDATE mc_call_leads SET hearing=$2 WHERE id=$1`, [id, h]); res.json({ ok: true, hearing: h });
  }));
  // 自動の掛け直しを解除する
  app.post("/api/mccall/leads/:id/clear-next", guard(async (req, res) => {
    await P().query(`UPDATE mc_call_leads SET next_at=NULL, next_why=NULL WHERE id=$1`, [parseInt(req.params.id, 10)]); res.json({ ok: true });
  }));

  // ---- 記録する ----
  app.post("/api/mccall/leads/:id/log", guard(async (req, res) => {
    const id = parseInt(req.params.id, 10); const b = req.body || {}; const u = me(req);
    const lead = (await P().query(`SELECT * FROM mc_call_leads WHERE id=$1`, [id])).rows[0];
    if (!lead) return res.status(404).json({ error: "このリードは見つかりません" });
    if (!(await myListIds(req)).includes(lead.list_id)) return res.status(403).json({ error: "このリストはあなたの担当ではありません" });
    const ban = await approachBanHit({ company: lead.company, phone: lead.phone, leadId: lead.sf_lead_id }).catch(() => null);
    if (ban) return res.status(403).json({ error: `「${lead.company}」はアプローチ禁止のため記録できません（理由：${ban.reason || "アプローチ禁止"}）` });
    const reach = String(b.reach || ""); const outcome = String(b.outcome || "");
    if (!REACH[reach] || !REACH[reach].outcomes[outcome]) return res.status(400).json({ error: "結果を選んでください" });
    const reason = outcome === "reject" ? clip(b.reason, 60) : "";
    if (outcome === "reject" && !reason) return res.status(400).json({ error: "断られた理由を選んでください" });
    const apoAt = b.apoAt ? new Date(b.apoAt) : null;
    if (outcome === "apo" && (!apoAt || isNaN(apoAt) || apoAt.getTime() < Date.now() - 3600e3)) return res.status(400).json({ error: "アポの日時を入れてください（過去の日時は入れられません）" });
    const gate = b.gate && (b.gate.name || b.gate.hours || b.gate.direct) ? { name: clip(b.gate.name, 40), hours: clip(b.gate.hours, 30), direct: clip(b.gate.direct, 30), at: new Date().toISOString(), by: u } : null;
    const now = new Date();
    // 次にかける時刻：人が選んだもの → 自動の掛け直し → なし
    let nextAt = b.nextAt ? new Date(b.nextAt) : null, why = nextAt ? "記録した人が決めた時刻" : null;
    if (nextAt && isNaN(nextAt)) { nextAt = null; why = null; }
    if (!nextAt && AUTO_RETRY.has(outcome) && !b.noRetry) { const r = autoRetryAt(now, (gate && gate.hours) || (lead.gate && lead.gate.hours)); nextAt = r.at; why = r.why; }
    if (outcome === "callback_req" && !nextAt) return res.status(400).json({ error: "掛け直す時刻を選んでください" });
    const done = FINAL.has(outcome) || (outcome === "doc_send" && !nextAt);
    const prev = { next_at: lead.next_at, next_why: lead.next_why, last_at: lead.last_at, last_outcome: lead.last_outcome, attempts: lead.attempts, done: lead.done, gate: lead.gate, hearing: lead.hearing };
    // ヒアリングは担当者と話せたときだけ記録に付ける（受付・不在で前の値が SF に二重に書かれないように）
    const hNew = reach === "person" ? cleanHearing(b.hearing || {}) : null;
    const hearing = hNew ? { ...mergeHearing(lead.hearing, hNew), at: now.toISOString(), by: u } : null;
    const log = (await P().query(`INSERT INTO mc_call_logs (lead_id, list_id, caller, phone, reach, outcome, reason, gate, memo, next_at, apo_at, cross_from, prev)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, created_at`,
      [id, lead.list_id, u, clip(b.phone || lead.phone, 40), reach, outcome, reason || null, gate, clip(b.memo, 2000) || null, nextAt, apoAt, lead.cross_from, prev])).rows[0];
    if (outcome === "apo" && b.apoWho) await P().query(`UPDATE mc_call_logs SET apo_who=$2 WHERE id=$1`, [log.id, clip(b.apoWho, 80)]);
    if (hearing) await P().query(`UPDATE mc_call_logs SET hearing=$2 WHERE id=$1`, [log.id, hearing]);
    await P().query(`UPDATE mc_call_leads SET last_at=now(), last_outcome=$2, attempts=attempts+1, next_at=$3, next_why=$4, done=$5, gate=COALESCE($6, gate), hearing=COALESCE($7, hearing), locked_by=NULL WHERE id=$1`,
      [id, outcome, nextAt, why, done, gate, hearing]);
    res.json({ ok: true, logId: log.id, nextAt, why, done });
    // SF の活動（リードに付ける）。代理アカウントでも書ける。失敗しても架電の記録は残り、画面の知らせから書き直せる
    sfWrite(req, log.id).catch(() => {});
  }));

  // 元に戻す（記録した本人が15分以内。管理者はいつでも）
  app.post("/api/mccall/logs/:id/undo", guard(async (req, res) => {
    const g = (await P().query(`SELECT * FROM mc_call_logs WHERE id=$1`, [parseInt(req.params.id, 10)])).rows[0];
    if (!g || g.undone) return res.status(404).json({ error: "この記録は見つからないか、もう取り消してあります" });
    const mine = String(g.caller || "").toLowerCase() === me(req) && Date.now() - new Date(g.created_at).getTime() < 15 * 60e3;
    if (!mine && !isAdmin(req)) return res.status(403).json({ error: "記録してから15分を過ぎたので取り消せません。管理者に頼んでください" });
    const p = g.prev || {};
    await P().query(`UPDATE mc_call_logs SET undone=true WHERE id=$1`, [g.id]);
    await P().query(`UPDATE mc_call_leads SET next_at=$2, next_why=$3, last_at=$4, last_outcome=$5, attempts=GREATEST(COALESCE($6,0),0), done=COALESCE($7,false), gate=$8${g.hearing ? ", hearing=$9" : ""} WHERE id=$1`,
      [g.lead_id, p.next_at || null, p.next_why || null, p.last_at || null, p.last_outcome || null, p.attempts, p.done, p.gate || null, ...(g.hearing ? [p.hearing || null] : [])]);
    let sf = "";
    if (g.sf_task_id) { try { await deleteTask(await sfActor(req), g.sf_task_id); sf = "SF の活動も消しました"; } catch (e) { sf = `SF の活動は消せませんでした（${String(e.message).slice(0, 80)}）`; } }
    res.json({ ok: true, leadId: g.lead_id, sf });
  }));

  // ---- 今日の数字（自分。管理者には全員） ----
  app.get("/api/mccall/stats", guard(async (req, res) => {
    const names = await nameMap();
    const rows = (await P().query(`SELECT caller, count(*) AS calls, count(*) FILTER (WHERE reach='person') AS person, count(*) FILTER (WHERE outcome='apo') AS apo,
        count(*) FILTER (WHERE cross_from IS NOT NULL) AS cross FROM mc_call_logs WHERE NOT undone AND created_at >= $1 GROUP BY caller`, [jstDayStart()])).rows
      .map((r) => ({ email: r.caller, name: names.get(String(r.caller || "").toLowerCase()) || r.caller, calls: +r.calls, person: +r.person, apo: +r.apo, cross: +r.cross }));
    const mine = rows.find((r) => String(r.email || "").toLowerCase() === me(req)) || { calls: 0, person: 0, apo: 0, cross: 0 };
    // 今日の自分の記録のうち SF に書けていない数（画面の上の知らせに出す）
    const sf = (await P().query(`SELECT count(*) FILTER (WHERE ${SF_FAIL}) AS fail, count(*) FILTER (WHERE NOT g.undone AND g.sf_err='nolead') AS nolead, count(*) FILTER (WHERE NOT g.undone AND g.sf_lead_err IS NOT NULL) AS leaderr,
        (array_agg(g.sf_err ORDER BY g.created_at DESC) FILTER (WHERE ${SF_FAIL} AND g.sf_err IS NOT NULL))[1] AS last_err
      FROM mc_call_logs g WHERE g.caller=$1 AND g.created_at >= $2`, [me(req), jstDayStart()])).rows[0];
    res.json({ ok: true, me: mine, all: isAdmin(req) ? rows.sort((a, b) => b.calls - a.calls) : null, sf: { fail: +sf.fail, nolead: +sf.nolead, leadErr: +sf.leaderr, lastErr: sf.last_err || "" } });
  }));
  // SF に書けなかった今日の自分の記録を書き直す（画面の知らせのボタンから）
  app.post("/api/mccall/sf-retry", guard(async (req, res) => {
    const ids = (await P().query(`SELECT g.id FROM mc_call_logs g WHERE g.caller=$1 AND g.created_at >= $2 AND ${SF_FAIL} ORDER BY g.id LIMIT 30`, [me(req), jstDayStart()])).rows.map((r) => r.id);
    for (const id of ids) await sfWrite(req, id);
    const left = ids.length ? +(await P().query(`SELECT count(*) FROM mc_call_logs g WHERE g.id = ANY($1) AND ${SF_FAIL}`, [ids])).rows[0].count : 0;
    res.json({ ok: true, tried: ids.length, left });
  }));
  // ===== 資料送付（2026-11-17 福井さん）=====
  //   DOC の kincall と同じく「確かめてから送る」の2段。資料は資料トラッキングの URL（だれがいつ開いたか分かる）。
  //   本人の Gmail で送り、SF のリードに活動（メール）を残す（正本は SF）。CC は既定で入れない（福井さんの決定）。
  //   ひな形・既定の資料は MOCHICA 専用の設定（mcDocSend…）にして、DOC の資料送付の設定は変えない。
  const MC_DOC_SUBJECT = "資料のご送付（{資料名}）";
  const MC_DOC_BODY = "{担当者}様\n\nお世話になっております。MOCHICA の{差出人}です。\n先ほどお電話にてご案内した資料をお送りいたします。\n下記の URL よりご確認ください。\n\n{URL}\n\nご不明な点がございましたら、お気軽にご連絡ください。\n何卒よろしくお願いいたします。";
  const isMail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
  // リードのメールアドレス：mail の付く項目 → 値の形 → SF のリードの項目、の順に探す
  function emailOf(data = {}, sf = null) {
    const vals = Object.entries(data || {}).filter(([, v]) => typeof v === "string");
    const byKey = vals.find(([k, v]) => /mail/i.test(k) && isMail(v)); if (byKey) return byKey[1].trim();
    const any = vals.find(([, v]) => isMail(v)); if (any) return any[1].trim();
    if (sf && sf.lead) { const e = Object.values(sf.lead).find((v) => isMail(v)); if (e) return String(e).trim(); }
    return "";
  }
  async function leadFor(req, id) {
    const lead = (await P().query(`SELECT * FROM mc_call_leads WHERE id=$1`, [id])).rows[0];
    if (!lead) { const e = new Error("このリードは見つかりません"); e.status = 404; throw e; }
    if (!(await myListIds(req)).includes(lead.list_id)) { const e = new Error("このリストはあなたの担当ではありません"); e.status = 403; throw e; }
    let data = {}, sf = null;
    if (lead.src === "bales") {
      const [lk, rk] = String(lead.src_key).split("|");
      const r = (await P().query(`SELECT data, sf FROM mochica_bales_rows WHERE list_key=$1 AND row_key=$2`, [lk, rk]).catch(() => ({ rows: [] }))).rows[0];
      if (r) { data = r.data || {}; sf = r.sf || null; }
    } else if (lead.src === "doc") {
      const t = (await P().query(`SELECT email FROM call_targets WHERE id=$1`, [parseInt(lead.src_key, 10)]).catch(() => ({ rows: [] }))).rows[0];
      if (t) data = t;
    }
    return { lead, data, sf };
  }
  async function docSettings() {
    const st = await getSettings().catch(() => ({}));
    return { subject: st.mcDocSendSubject || MC_DOC_SUBJECT, body: st.mcDocSendBody || MC_DOC_BODY, defaultDocId: st.mcDocDefaultId || "", cc: st.mcDocSendCc || "" };
  }
  // ---- doc-room（2026-11-17 福井さん）：MOCHICA の資料は doc-room の「会社ごとのルーム」で送る ----
  //   kinbot の資料トラッキングではなく doc-room（https://doc-room.vercel.app/console/）にそろえる。
  //   閲覧の通知・分析も doc-room 側で見る。管理キーは Railway の環境変数 DOC_ROOM_KEY（コードに書かない）。
  //   ルームは「送る」を押したときだけ作る（確かめるだけ・資料を切り替えただけで空のルームが増えないように）。
  const DOC_ROOM = String(process.env.DOC_ROOM_URL || "https://doc-room.vercel.app").replace(/\/+$/, "");
  async function docRoom(method, path, body) {
    const key = process.env.DOC_ROOM_KEY;
    if (!key) { const e = new Error("doc-room の管理キー（DOC_ROOM_KEY）がサーバーに設定されていません。管理者に設定を頼んでください"); e.status = 500; throw e; }
    const r = await fetch(DOC_ROOM + path, { method, headers: { authorization: `Bearer ${key}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(`doc-room：${j.message || j.error || `エラー（${r.status}）`}`); e.status = r.status === 401 ? 500 : 502; throw e; }
    return j;
  }
  let roomDocsCache = { at: 0, docs: [] };
  async function roomDocs() {
    if (Date.now() - roomDocsCache.at < 60e3 && roomDocsCache.docs.length) return roomDocsCache.docs;
    const docs = ((await docRoom("GET", "/admin/documents")).documents || []).map((d) => ({ id: String(d.id), name: String(d.title || d.id), kind: d.kind || "" }));
    roomDocsCache = { at: Date.now(), docs };
    return docs;
  }
  app.get("/api/mccall/doc-settings", guard(async (req, res) => {
    let docs = [], docErr = "";
    try { docs = await roomDocs(); } catch (e) { docErr = e.message; }
    res.json({ ok: true, ...(await docSettings()), admin: isAdmin(req), docs: docs.map((d) => ({ id: d.id, name: d.name })), docErr });
  }));
  app.put("/api/mccall/doc-settings", adminOnly(async (req, res) => {
    const b = req.body || {}; const patch = {};
    if (b.subject !== undefined) patch.mcDocSendSubject = clip(b.subject, 300);
    if (b.body !== undefined) patch.mcDocSendBody = String(b.body || "").slice(0, 4000);
    if (b.defaultDocId !== undefined) patch.mcDocDefaultId = String(b.defaultDocId || "");
    if (b.cc !== undefined) patch.mcDocSendCc = String(b.cc || "").split(/[,\s、]+/).filter(isMail).join(", ");
    await saveSettings(patch); res.json({ ok: true });
  }));
  // 送る前の中身（宛先・件名・本文）。本文の {URL} は残しておき、「送る」で doc-room のルームを作ってから差し替える
  app.post("/api/mccall/leads/:id/doc/preview", guard(async (req, res) => {
    try {
      const { lead, data, sf } = await leadFor(req, parseInt(req.params.id, 10));
      const ban = await approachBanHit({ company: lead.company, phone: lead.phone, leadId: lead.sf_lead_id }).catch(() => null);
      if (ban) return res.status(403).json({ error: `「${lead.company}」はアプローチ禁止のため、資料は送れません` });
      const docs = await roomDocs();
      if (!docs.length) return res.status(400).json({ error: "送れる資料がまだ doc-room に登録されていません。doc-room の管理画面（/console/）で資料を登録してください" });
      const conf = await docSettings();
      const want = String((req.body && req.body.docId) || conf.defaultDocId || "");
      const doc = docs.find((d) => d.id === want) || docs[0];
      const company = String(lead.company || "").trim(); const person = String((lead.gate && lead.gate.name) || lead.person || "").trim();
      const to = emailOf(data, sf);
      const sender = (await nameMap()).get(me(req)) || "";
      const fill = (t) => String(t || "").replace(/\{担当者\}/g, person || "ご担当者").replace(/\{会社名\}/g, company).replace(/\{差出人\}/g, sender).replace(/\{資料名\}/g, doc.name || "ご案内資料");
      res.json({ ok: true, to, cc: conf.cc, company, person, subject: fill(conf.subject), body: fill(conf.body), docId: doc.id, docName: doc.name,
        docs: docs.map((d) => ({ id: d.id, name: d.name })), google: await googleConnected(me(req)).catch(() => false),
        warn: to ? "" : "この会社のメールアドレスが見つかりませんでした。宛先を入れてください" });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  }));
  app.post("/api/mccall/leads/:id/doc/send", guard(async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10); const { lead } = await leadFor(req, id); const b = req.body || {}; const u = me(req);
      const to = String(b.to || "").trim(); const subject = clip(b.subject, 300); let body = String(b.body || "").slice(0, 8000);
      const ban = await approachBanHit({ company: lead.company, phone: lead.phone, leadId: lead.sf_lead_id }).catch(() => null);
      if (ban) return res.status(403).json({ error: `「${lead.company}」はアプローチ禁止のため、資料は送れません` });
      if (!isMail(to)) return res.status(400).json({ error: "宛先のメールアドレスを正しく入れてください" });
      if (!subject || !body) return res.status(400).json({ error: "件名と本文を入れてください" });
      if (!(await googleConnected(u).catch(() => false))) return res.status(400).json({ error: "あなたの Google 連携がまだです。設定 → 外部連携 → Google でつないでから、もう一度送ってください" });
      const cc = [...new Set(String(b.cc || "").split(/[,\s、]+/).filter(isMail).map((x) => x.toLowerCase()))].filter((x) => x !== to.toLowerCase() && x !== u).join(", ");
      // doc-room にこの会社のルームを作る。作れなければメールは送らない（URL の無いメールを出さない）
      const doc = (await roomDocs()).find((d) => d.id === String(b.docId || ""));
      if (!doc) return res.status(400).json({ error: "選んだ資料が doc-room に見つかりません。画面を開き直して、資料を選び直してください" });
      const sender = (await nameMap()).get(u) || u;
      let room;
      try {
        room = await docRoom("POST", "/admin/rooms", { company_name: String(lead.company || "").trim(), contact_name: String((lead.gate && lead.gate.name) || lead.person || "").trim() || null,
          owner: sender, message: null, cta_url: null, expires_days: 30, sf_opportunity_id: null, sf_account_id: null,
          items: [{ document_id: doc.id, downloadable: doc.kind === "summary" }] });
      } catch (e) { return res.status(e.status || 502).json({ error: `資料のルームを作れなかったので、メールは送っていません（${e.message}）` }); }
      const url = String(room && room.url || "");
      if (!url) return res.status(502).json({ error: "doc-room からルームの URL が返ってこなかったので、メールは送っていません" });
      const docName = doc.name;
      // {URL} を消してしまっていても、URL の無いメールにならないよう末尾に足す
      body = /\{URL\}/.test(body) ? body.replace(/\{URL\}/g, url) : `${body}\n\n${url}`;
      try { await gmailSend(u, { to, subject, bodyText: body, cc }); }
      catch (e) { return res.status(500).json({ error: e.needScope ? "Gmail で送る許可がありません。設定 → 外部連携 → Google を一度外して、もう一度つなぎ、Gmail の項目を許可してください" : `送れませんでした：${String(e.message).slice(0, 120)}` }); }
      const row = (await P().query(`INSERT INTO mc_doc_sends (lead_id, sender, to_addr, cc, subject, url, doc_name) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [id, u, to, cc || null, subject, clip(url, 300), clip(docName, 200)])).rows[0];
      // SF のリードに「資料送付」の活動を残す。書けなかったら sf_err に残し、画面にも返す（黙って失敗しない＝ルール5）
      let sfNote = "";
      if (lead.sf_lead_id && /^00Q[0-9A-Za-z]{12,15}$/.test(lead.sf_lead_id)) {
        try {
          const t = await createTask(await sfActor(req), { WhoId: lead.sf_lead_id, Subject: "[MOCHICA] 資料送付", Type: "Email", Status: "完了",
            ActivityDate: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10),
            Description: [`送った人：${(await nameMap()).get(u) || u}（kinbot for MOCHICA）`, `宛先：${to}`, cc ? `CC：${cc}` : "", `件名：${subject}`, `資料：${docName}（doc-room）${url}`].filter(Boolean).join("\n") });
          if (!t || !t.id) throw new Error("SF から活動の番号が返ってきませんでした");
          await P().query(`UPDATE mc_doc_sends SET sf_task_id=$2 WHERE id=$1`, [row.id, t.id]);
        } catch (e) { sfNote = "メールは送りましたが、SF の活動には書けませんでした"; await P().query(`UPDATE mc_doc_sends SET sf_err=$2 WHERE id=$1`, [row.id, String(e.message).slice(0, 300)]).catch(() => {}); }
      } else sfNote = "SF のリードと結びついていないので、SF には残していません（kinbot にだけ残ります）";
      res.json({ ok: true, to, sf: sfNote });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  }));

  // ===== アポのおすすめ日時（2026-11-17 福井さん）=====
  //   MOCHICA のクローザー（メンバー管理で事業が MOCHICA・役割がクローザー）のカレンダーの空きから選ぶ。
  //   DOC の kincall の候補日（DOC のクローザー）は使わない（DOC の人が出ないように）。
  //   空きの見方は DOC とそろえる：終日・参加しない予定・「リスケ」「キャンセル」は空きとみなす。
  async function mcClosers() {
    const ms = await listMembers().catch(() => []);
    return ms.filter((m) => m.email && m.active !== false && (m.businesses || []).includes("MOCHICA") && (m.roles || []).includes("closer"))
      .map((m) => ({ email: String(m.email).toLowerCase(), name: m.name || m.email }));
  }
  // クローザーの Google カレンダーの「埋まっている時間」を読む（2026-11-18 福井さん「クローザーのグーグルカレンダーの空き日程に」）
  //   1) クローザー本人が Google 連携していれば、本人の権限で本人のカレンダーを読む（非公開の予定も漏れない）
  //   2) まだの人は、連携済みの人（自分・アポを読む係・ほかのクローザー）の権限で FreeBusy を読む
  //      FreeBusy は予定の中身を見ないので、詳細を非公開にしているカレンダーでも空きだけは分かる
  //   予定の「辞退」「予定なし（空き）」扱いは Google 側で除かれる。読めなかった人は「空き」と数えない
  async function busyOf(req, members, timeMin, timeMax) {
    const busy = new Map();
    const take = (m, cal) => { if (!cal || (cal.errors && cal.errors.length)) return false;
      busy.set(m.email, cal.busy.map((x) => [Date.parse(x.start), Date.parse(x.end)]).filter(([s0, e0]) => !isNaN(s0) && !isNaN(e0) && e0 > s0)); return true; };
    await Promise.all(members.map(async (m) => {
      try { take(m, (await freeBusy(m.email, [m.email], timeMin, timeMax))[m.email]); } catch {}
    }));
    let rest = members.filter((m) => !busy.has(m.email));
    if (rest.length) {
      const st = await getSettings().catch(() => ({}));
      const readers = [...new Set([me(req), String(st.apoScanOwner || "").toLowerCase(), String(st.calendarOwner || "").toLowerCase(), ...members.map((m) => m.email)].filter(Boolean))];
      for (const r of readers) {
        if (!rest.length) break;
        try { const fb = await freeBusy(r, rest.map((m) => m.email), timeMin, timeMax); rest = rest.filter((m) => !take(m, fb[m.email])); } catch {}
      }
    }
    for (const m of rest) busy.set(m.email, null);
    return members.some((m) => Array.isArray(busy.get(m.email))) ? busy : null;
  }
  const freeAt = (busy, members, t, mins) => members.filter((m) => { const b = busy.get(m.email); return Array.isArray(b) && !b.some(([bs, be]) => bs < t + mins * 60e3 && be > t); }).map((m) => m.name);
  const slotOut = (t, free, total) => { const j = new Date(t + 9 * 3600e3); return { at: new Date(t).toISOString(), md: `${j.getUTCMonth() + 1}/${j.getUTCDate()}`, dow: "日月火水木金土"[j.getUTCDay()], time: `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`, band: j.getUTCHours() < 12 ? "午前" : "午後", free, freeN: free.length, total }; };
  // おすすめ：翌営業日から2週間、平日 10〜18時の1時間枠。空いている人の多い日を週ごとに3日、その日の午前・午後で一番空いている枠を1つずつ
  app.get("/api/mccall/slots", guard(async (req, res) => {
    const members = await mcClosers();
    if (!members.length) return res.json({ ok: true, slots: [], members: [], reason: "MOCHICA のクローザーが決まっていません。設定 → メンバー管理で、事業 MOCHICA・役割 クローザーを付けてください" });
    const now = Date.now(); const busy = await busyOf(req, members, new Date(now).toISOString(), new Date(now + 16 * 86400e3).toISOString());
    if (!busy) return res.json({ ok: true, slots: [], members: members.map((m) => m.name), reason: "カレンダーの空きを読めませんでした。自分かクローザーの Google 連携を確かめてください" });
    const today = jstDayStart(new Date(now)).getTime(); const days = [];
    for (let d = 1; d <= 15; d++) {
      const day = today + d * 86400e3; const wd = new Date(day + 9 * 3600e3).getUTCDay(); if (wd === 0 || wd === 6) continue;
      const slots = []; for (let h = 10; h < 18; h++) { const t = day + h * 3600e3; slots.push({ t, h, free: freeAt(busy, members, t, 60) }); }
      days.push({ day, week: d <= 7 ? 1 : 2, best: Math.max(...slots.map((s) => s.free.length)), slots });
    }
    const pick = (w) => days.filter((x) => x.week === w && x.best > 0).sort((a, b) => (b.best - a.best) || (a.day - b.day)).slice(0, 3);
    const out = [];
    for (const d of [...pick(1), ...pick(2)]) for (const cond of [(h) => h < 12, (h) => h >= 13]) {
      const s = d.slots.filter((x) => cond(x.h) && x.free.length).sort((a, b) => (b.free.length - a.free.length) || (a.h - b.h))[0];
      if (s) out.push(slotOut(s.t, s.free, members.length));
    }
    out.sort((a, b) => new Date(a.at) - new Date(b.at));
    res.json({ ok: true, slots: out.slice(0, 12), members: members.map((m) => m.name), unread: members.filter((m) => busy.get(m.email) === null).map((m) => m.name) });
  }));
  // 選んだ1日の空き（30分きざみ・9〜19時・商談の長さ分まるごと空いている人）
  app.get("/api/mccall/slots/day", guard(async (req, res) => {
    const date = String(req.query.date || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "日付が正しくありません" });
    const mins = Math.max(15, Math.min(240, parseInt(req.query.minutes, 10) || 60));
    const members = await mcClosers();
    if (!members.length) return res.json({ ok: true, slots: [], reason: "MOCHICA のクローザーが決まっていません" });
    const day = Date.parse(`${date}T00:00:00+09:00`);
    const busy = await busyOf(req, members, new Date(day).toISOString(), new Date(day + 86400e3).toISOString());
    if (!busy) return res.json({ ok: true, slots: [], reason: "カレンダーの空きを読めませんでした" });
    const out = [];
    for (let t = day + 9 * 3600e3; t + mins * 60e3 <= day + 19 * 3600e3; t += 30 * 60e3) {
      if (t < Date.now() + 30 * 60e3) continue; const free = freeAt(busy, members, t, mins); if (free.length) out.push(slotOut(t, free, members.length));
    }
    res.json({ ok: true, slots: out, members: members.map((m) => m.name) });
  }));
  app.get("/api/mccall/meta", guard(async (req, res) => {
    // 管理者の画面には、いま管理者として扱っている人の名前も返す（苗字で照合しているので、漏れや取り違えを見えるように）
    const admins = isAdmin(req) && deps.adminNames ? await deps.adminNames().catch(() => []) : [];
    res.json({ ok: true, reach: REACH, rejectReasons: REJECT_REASONS, admin: isAdmin(req), admins, me: me(req) });
  }));
}
