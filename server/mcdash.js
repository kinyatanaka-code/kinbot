// SHOBO のダッシュボード（2026-11-17 福井）
//
// なぜ作ったか：
//   商談プロセス（インサイドのコール〜セールスの受注）を、月・週・日で計画と実績のずれまで一目で見たい。
//   手元で作った HTML はデータを手で集めていたので古くなる。そこで、開くたびに正本（SF・Zoom Phone・シフト表）を
//   サーバーが直接読んで返す。kinbot は読むだけ（正本を増やさない）。
//
// 返す形は public/mcdash.html がそのまま使う DATA（手元の dashboard/build.py と同じ形）。
//   sf.deals（今月に関係する新規商談＋ステージ履歴）、detail.deals（直近6か月の新規商談の項目）、
//   calls / callsPrev（Zoom Phone の発信を担当者×日に集計）、shifts（インターンのシフト）、sources（データ源ごとの成否）
//
// 黙った失敗を作らない：データ源ごとに ok / ng とエラーの文、0件のときも sources に残し、画面は赤で出す。

import { zoomPhoneConfigured, zoomPhoneUsers, zoomGet } from "./zoomphone.js";

// 対象メンバー（2026-11-16 福井さん指定）。key/sf は SF の氏名（空白なし）、zoom は Zoom の表示名（空白なし）
export const MCDASH_ROSTER = {
  sales: [{ key: "齊藤玲耶", name: "齊藤" }, { key: "餌取鴻志", name: "餌取" }, { key: "本炭更紗", name: "本炭" }],
  is: [
    { name: "趙", sf: "趙彩娟", zoom: "彩娟趙" },
    { name: "岩浪", sf: "岩浪大己", zoom: "岩浪大己" },
    { name: "大沢", sf: "大沢瑛太", zoom: "大沢瑛太" },
    { name: "森", sf: "森康晴", zoom: "森康晴" },
    { name: "足立", sf: "足立瞬弥", zoom: "足立瞬弥" },
    { name: "内藤", sf: "内藤賴郁亜", zoom: "らいあないとう" },
    { name: "小賀坂", sf: "小賀坂和也", zoom: "小賀坂和也" },
    { name: "重永", sf: "重永浩汰", zoom: "浩汰重永" },
  ],
};
// インターンのシフト（Google スプレッドシート「MOCHICAインターン用シフト データ」）。読むのは福井さんの Google 連携（2026-11-17 了承）
const SHIFT_SHEET_ID = "1K2n885sLPX97-e7uITA4oIfXDRX24mcbMxbkBTDzmjI";
const SHIFT_OWNER = String(process.env.MCDASH_SHIFT_OWNER || "sho.fukui@neo-career.co.jp").toLowerCase();
const HOLIDAYS = ["2026-01-01", "2026-01-12", "2026-02-11", "2026-02-23", "2026-03-20", "2026-04-29", "2026-05-04", "2026-05-05", "2026-05-06",
  "2026-07-20", "2026-08-11", "2026-09-21", "2026-09-22", "2026-09-23", "2026-10-12", "2026-11-03", "2026-11-23",
  "2027-01-01", "2027-01-11", "2027-02-11", "2027-02-23", "2027-03-22", "2027-04-29", "2027-05-03", "2027-05-04", "2027-05-05"];

const nz = (v) => String(v || "").replace(/[\s　]/g, "");
const jst = (iso) => (iso ? new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10) : null);
const dateOnly = (v) => (!v ? null : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : jst(v));
const todayJst = () => new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
const monthStart = (d) => d.slice(0, 8) + "01";
const addMonths = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const stageCode = (s) => { const m = String(s || "").match(/^(\d\d)/); return m ? (m[1] === "11" ? "08" : m[1]) : null; };
const num = (v) => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));
const memoClean = (s) => String(s || "").replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "［メール］").replace(/0\d{1,4}-?\d{1,4}-?\d{3,4}/g, "［電話］").slice(0, 200);

// ───────────── Salesforce ─────────────
const OPP_FIELDS = "Id, Name, Account.Name, Owner.Name, StageName, CreatedDate, CloseDate, IsClosed, IsWon, Amount, LastModifiedDate, LeadSource, " +
  "Loss_Reason__c, Loss_Reason1__c, Lost_before_stage__c, employee__c, employee2__c, contact2__c, purpose_of_use__c, ATS__c, Conflict__c, " +
  "Account.Industry, Account.NumberOfEmployees, Internship_apo__c, appointment__c, nextstep_2__c, negotiation_memo__c";

async function loadSf(sfQueryAll, owner, asOf) {
  const mStart = monthStart(asOf), histFrom = addMonths(mStart, -6);
  const where = `RecordType.Name = '新規' AND (CreatedDate >= ${histFrom}T00:00:00+09:00 OR IsClosed = false OR LastModifiedDate >= ${mStart}T00:00:00+09:00)`;
  // 主キャンペーンソース（Campaign.Name）が読めない環境でもダッシュボード全体は止めない
  let opps;
  try { opps = await sfQueryAll(owner, `SELECT ${OPP_FIELDS}, Campaign.Name FROM Opportunity WHERE ${where}`, 20000); }
  catch (e) { console.warn("[mcdash] 主キャンペーンソースを取れませんでした:", e.message); opps = await sfQueryAll(owner, `SELECT ${OPP_FIELDS} FROM Opportunity WHERE ${where}`, 20000); }
  const hist = await sfQueryAll(owner, `SELECT OpportunityId, StageName, CreatedDate FROM OpportunityHistory WHERE Opportunity.${where.replace(/\(CreatedDate/, "(Opportunity.CreatedDate").replace(/OR IsClosed/, "OR Opportunity.IsClosed").replace(/OR LastModifiedDate/, "OR Opportunity.LastModifiedDate")} ORDER BY CreatedDate`, 80000);
  const byOpp = new Map();
  for (const h of hist) { const c = stageCode(h.StageName); if (!c) continue; const a = byOpp.get(h.OpportunityId) || []; a.push({ stage: c, date: jst(h.CreatedDate) }); byOpp.set(h.OpportunityId, a); }

  const deals = [], detail = {};
  for (const o of opps) {
    const created = jst(o.CreatedDate), lastModified = jst(o.LastModifiedDate);
    const history = byOpp.get(o.Id) || [];
    const status = o.IsWon ? "won" : o.IsClosed ? "lost" : "open";
    detail[o.Id] = {
      company: o.Account?.Name || o.Name, owner: o.Owner?.Name || "", stage: o.StageName, created, closeDate: o.CloseDate,
      isClosed: !!o.IsClosed, isWon: !!o.IsWon, amount: o.Amount, leadSource: o.LeadSource, campaign: o.Campaign?.Name || null, lossReason: o.Loss_Reason__c, lossReason1: o.Loss_Reason1__c,
      lostBeforeStage: o.Lost_before_stage__c, recruiters: o.employee__c, recruitersNum: num(o.employee2__c), contacts: num(o.contact2__c), purpose: o.purpose_of_use__c,
      ats: o.ATS__c, competitor: o.Conflict__c, industry: o.Account?.Industry || null, employees: num(o.Account?.NumberOfEmployees),
      apoSetter: o.Internship_apo__c, appointment: dateOnly(o.appointment__c), nextStep: o.nextstep_2__c, memo: o.negotiation_memo__c ? memoClean(o.negotiation_memo__c) : null,
    };
    // 今月に関係する案件（進行中・今月作成・今月に動いた）だけを sf.deals に入れる
    if (status === "open" || created >= mStart || (lastModified && lastModified >= mStart) || history.some((h) => h.date >= mStart)) {
      deals.push({ id: o.Id, name: o.Name, company: o.Account?.Name || o.Name, owner: o.Owner?.Name || "", amount: o.Amount, created, closeDate: o.CloseDate,
        stage: o.StageName, status, lastModified, history });
    }
  }
  // 段ごとの平均所要日数（直近6か月に作成された案件の履歴から）
  const ORDER = ["01", "02", "03", "04", "05"]; const sum = {}, cnt = {};
  for (const o of opps) {
    const c = jst(o.CreatedDate); if (c < histFrom || c >= mStart) continue;
    const first = {}; for (const h of byOpp.get(o.Id) || []) if (!first[h.stage] || h.date < first[h.stage]) first[h.stage] = h.date;
    if (!first["01"]) first["01"] = c;
    for (let i = 0; i < ORDER.length - 1; i++) {
      const a = first[ORDER[i]], b = first[ORDER[i + 1]]; if (!a || !b || b < a) continue;
      const k = `${ORDER[i]}-${ORDER[i + 1]}`; sum[k] = (sum[k] || 0) + (Date.parse(b) - Date.parse(a)) / 86400000; cnt[k] = (cnt[k] || 0) + 1;
    }
  }
  const avgDays = {}; for (const k of Object.keys(sum)) avgDays[k] = Math.round((sum[k] / cnt[k]) * 10) / 10;
  return { sf: { fetchedAt: new Date().toISOString(), deals, historical: { team: { avgDays, avgDaysN: cnt } } }, detail: { deals: detail }, n: opps.length, nHist: hist.length };
}

// ───────────── Zoom Phone ─────────────
// 1日ごとに生の行（担当・相手番号・秒・応答）を持つ。過ぎた日は取り直さない。今日は5分ごと。
const _zoomDays = new Map();   // day -> { at, rows: [{o, n, s, a}] }
let _zoomNames = { at: 0, map: new Map() };   // email -> 表示名（空白なし）
async function zoomNameMap() {
  if (Date.now() - _zoomNames.at < 6 * 3600000 && _zoomNames.map.size) return _zoomNames.map;
  const us = await zoomPhoneUsers();
  _zoomNames = { at: Date.now(), map: new Map(Object.entries(us).map(([e, u]) => [e, nz(u.name)])) };
  return _zoomNames.map;
}
async function zoomFetchRange(from, to) {
  const names = await zoomNameMap().catch(() => new Map());
  const out = new Map();
  let token = "";
  for (let page = 0; page < 300; page++) {
    let d = await zoomGet("/phone/call_logs", { from, to, page_size: 300, type: "all", next_page_token: token }).catch(() => null);
    let key = "call_logs";
    if (!d) { d = await zoomGet("/phone/call_history", { from, to, page_size: 300, next_page_token: token }); key = "call_history"; }
    for (const c of d[key] || d.call_logs || d.call_history || []) {
      const dir = String(c.direction || c.call_direction || "").toLowerCase();
      if (!/out/.test(dir)) continue;
      const day = jst(c.date_time || c.start_time); if (!day) continue;
      const email = String((c.owner && c.owner.email) || c.caller_email || c.user_email || "").toLowerCase();
      const o = nz((c.owner && c.owner.name) || c.caller_name || names.get(email) || email);
      const s = Number(c.duration || 0);
      const r = String(c.result || c.call_result || "");
      const a = s > 0 && !/cancel|no.?answer|reject|busy|miss|voicemail/i.test(r) ? 1 : 0;
      const n = String(c.callee_number || c.callee_did_number || (c.callee && c.callee.phone_number) || "");
      const arr = out.get(day) || []; arr.push({ o, n, s, a }); out.set(day, arr);
    }
    token = d.next_page_token || ""; if (!token) break;
  }
  return out;
}
async function zoomRows(from, to) {
  const today = todayJst(); const need = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const c = _zoomDays.get(d);
    if (!c || (d >= today && Date.now() - c.at > 5 * 60000)) need.push(d);
  }
  if (need.length) {
    const got = await zoomFetchRange(addDays(need[0], -1), addDays(need[need.length - 1], 1));
    for (const d of need) _zoomDays.set(d, { at: Date.now(), rows: got.get(d) || [] });
  }
  const rows = []; for (let d = from; d <= to; d = addDays(d, 1)) for (const r of _zoomDays.get(d)?.rows || []) rows.push({ ...r, d });
  return rows;
}
// 列：[発信, 10秒以上, 30秒以上, 60秒以上, 180秒以上, 初回架電の企業, 初めて10秒以上の企業, 初めて180秒以上の企業, 応答, 120秒以上]
function aggregateCalls(rows, label) {
  const by = {}; const seen = new Map();
  rows.sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0));
  for (const r of rows) {
    const a = ((by[r.o] = by[r.o] || {})[r.d] = by[r.o][r.d] || new Array(10).fill(0));
    a[0]++; a[1] += r.s >= 10; a[2] += r.s >= 30; a[3] += r.s >= 60; a[4] += r.s >= 180; a[8] += r.a; a[9] += r.s >= 120;
    const k = r.o + "|" + r.d.slice(0, 7); const sv = seen.get(k) || [new Set(), new Set(), new Set()]; seen.set(k, sv);
    [true, r.s >= 10, r.s >= 180].forEach((ok, i) => { if (ok && !sv[i].has(r.n)) { sv[i].add(r.n); a[5 + i]++; } });
  }
  return { source: "zoom_phone", period: label, cols: ["calls", "ge10", "ge30", "ge60", "ge180", "uniq", "uniq10", "uniq180", "answered", "ge120"], byOwnerDay: by };
}

// ───────────── シフト ─────────────
async function loadShifts(readSheet, asOf) {
  const [rows, types, sets] = await Promise.all([
    readSheet(SHIFT_OWNER, SHIFT_SHEET_ID, "shifts!A1:C5000"),
    readSheet(SHIFT_OWNER, SHIFT_SHEET_ID, "shiftTypes!A1:F30").catch(() => []),
    readSheet(SHIFT_OWNER, SHIFT_SHEET_ID, "settings!A1:B30").catch(() => []),
  ]);
  const min = (t) => { const m = String(t || "").match(/(\d+):(\d+)/); return m ? +m[1] * 60 + +m[2] : null; };
  const hoursByType = {}; const missing = [];
  for (const r of (types || []).slice(1)) {
    const s = min(r[1]), e = min(r[2]), bs = min(r[3]), be = min(r[4]); if (!r[0] || s == null || e == null) continue;
    hoursByType[String(r[0]).trim()] = Math.round(((e - s) - (bs != null && be != null ? be - bs : 0)) / 6) / 10;
  }
  // 列の見出しはずれている（key＝名前・memberId＝日付・date＝シフト種類）
  const ms = monthStart(asOf).slice(0, 7); const shifts = {};
  for (const r of (rows || []).slice(1)) {
    const name = String(r[0] || "").trim(), day = String(r[1] || "").trim(), t = String(r[2] || "").trim();
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day.slice(0, 7) !== ms) continue;
    (shifts[name] = shifts[name] || {})[day] = t;
    if (t !== "off" && !(t in hoursByType) && !missing.includes(t)) missing.push(t);
  }
  for (const t of missing) hoursByType[t] = 5;
  const apo = (sets || []).find((r) => /アポ目標時間/.test(String(r[0] || "")));
  return {
    source: "MOCHICAインターン用シフト データ（shifts シート）", hoursByType,
    typeNote: missing.length ? `シフト種類 ${missing.join("・")} は shiftTypes に定義が無いため5時間とみなしています` : "シフト種類ごとの時間は shiftTypes シートから",
    apoTargetHours: num(apo && apo[1]) || 3, shifts,
  };
}

// ───────────── まとめ ─────────────
const _cache = { at: 0, data: null, building: null };
async function build(deps) {
  const asOf = todayJst(), mStart = monthStart(asOf), pmStart = addMonths(mStart, -1);
  const sources = {}, notes = [];
  const t0 = Date.now();
  const owner = await deps.sfOwner();
  // SF（必須）
  let sfPart;
  try {
    sfPart = await loadSf(deps.sfQueryAll, owner, asOf);
    sources.SF = { status: sfPart.n ? "ok" : "ng", at: new Date().toISOString(), note: sfPart.n ? `新規商談 ${sfPart.n}件・ステージ履歴 ${sfPart.nHist}件` : "新規商談が0件でした（取り方を確認してください）" };
  } catch (e) { sources.SF = { status: "ng", at: new Date().toISOString(), note: "SF を読めませんでした：" + e.message }; throw Object.assign(new Error("SF を読めませんでした：" + e.message), { sources }); }
  // Zoom Phone
  let calls = null, callsPrev = null;
  if (!zoomPhoneConfigured()) sources["Zoom Phone"] = { status: "ng", at: "", note: "Zoom Phone の接続設定がありません" };
  else {
    try {
      const cur = await zoomRows(mStart, asOf); const prev = await zoomRows(pmStart, addDays(mStart, -1));
      calls = aggregateCalls(cur, mStart.slice(0, 7)); callsPrev = aggregateCalls(prev, pmStart.slice(0, 7));
      const isN = deps.roster.is.reduce((a, p) => a + Object.values(calls.byOwnerDay[p.zoom] || {}).reduce((s, v) => s + v[0], 0), 0);
      sources["Zoom Phone"] = { status: isN ? "ok" : "ng", at: new Date().toISOString(), note: isN ? `今月の発信 ${cur.length}件（インサイド8名 ${isN}件）・前月 ${prev.length}件` : `インサイド8名の発信が0件でした（全体 ${cur.length}件）。名前の対応を確認してください` };
    } catch (e) { sources["Zoom Phone"] = { status: "ng", at: new Date().toISOString(), note: "Zoom Phone を読めませんでした：" + e.message }; }
  }
  // シフト
  let shifts = null;
  try {
    shifts = await loadShifts(deps.readSheet, asOf);
    const n = Object.values(shifts.shifts).reduce((a, s) => a + Object.keys(s).length, 0);
    sources["シフト"] = { status: n ? "ok" : "ng", at: new Date().toISOString(), note: n ? `今月のシフト ${n}件（${Object.keys(shifts.shifts).length}名）` : "今月のシフトが0件でした" };
  } catch (e) { sources["シフト"] = { status: "ng", at: new Date().toISOString(), note: "シフト表を読めませんでした（福井さんの Google 連携）：" + e.message }; }
  let sfBase = ""; try { sfBase = String((await deps.sfInfo(owner))?.instanceUrl || "").replace(/\/+$/, ""); } catch {}
  notes.push("※ ICP・MQL・ホットリスト・SQL は【デモ定義】。SFで定義が確定したら差し替える。商談設定・商談実施は SF の商談日（appointment__c）で判定。");
  notes.push("※ インサイドの計画はシフト表の勤務時間 × 1時間あたりの目標。アポは設定シートの「アポ目標時間」。");
  notes.push("※ インサイドのアポ数は SF の「アポ獲得者」（Internship_apo__c）が入力された案件のみ。入力率が低いと実態より少なく出ます。");
  return { asOf, fetchedAt: new Date().toISOString(), buildMs: Date.now() - t0, holidays: HOLIDAYS, staleBefore: addMonths(mStart, -3), roster: deps.roster,
    sf: sfPart.sf, detail: sfPart.detail, calls, callsPrev, shifts, sources, notes, sfBase };
}

export function registerMcDash(app, { sfQueryAll, sfOperator, sfActor, sfInfo, readSheet, mochicaSet, isAdmin }) {
  const deps = { sfQueryAll, readSheet, sfInfo, roster: MCDASH_ROSTER };
  const allowed = async (req) => !!req.user && (isAdmin(req) || (await mochicaSet().catch(() => new Set())).has(String(req.user).toLowerCase()));
  app.get("/api/mcdash/data", async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "ログインしてください" });
      if (!(await allowed(req))) return res.status(403).json({ error: "MOCHICA のメンバーだけが見られます" });
      deps.sfOwner = async () => (await sfOperator().catch(() => "")) || (await sfActor(req));
      const fresh = req.query.refresh === "1" && Date.now() - _cache.at > 30000;   // 「更新」は30秒に1回まで
      if (!_cache.data || fresh || Date.now() - _cache.at > 5 * 60000 || _cache.data.asOf !== todayJst()) {
        if (!_cache.building) _cache.building = build(deps).then((d) => { _cache.data = d; _cache.at = Date.now(); return d; }).finally(() => { _cache.building = null; });
        await _cache.building;
      }
      res.set("cache-control", "no-store").json({ ...(_cache.data || {}), cachedAt: new Date(_cache.at).toISOString() });
    } catch (e) {
      console.error("[mcdash]", e);
      res.status(502).json({ error: e.message || "ダッシュボードのデータを作れませんでした", sources: e.sources || null });
    }
  });
}
export { loadSf as _loadSf, aggregateCalls as _aggregateCalls, loadShifts as _loadShifts };   // 確かめ（dev）用
