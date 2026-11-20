// MOCHICALL の「施策」まわり（2026-11-20 福井さん）
//
// 福井さんの考え：テレアポの施策は「売り先（リスト）」と「売り方（トーク）」の両輪が必ずセット。
//   どんなリストに・どんなトークで行ったかを全部の架電に残し、リスト×トークで結果を比べられるようにする（科学できるように）。
//   また、架電の邪魔になるもの（調べる手間・リストを眺めること）をなくす。
//
// ここに置いたもの：
//   1. トーク（mc_call_talks）：リストごとに A/B/C の3本まで。直すたびに新しい版として残し、架電の記録に版を付ける。
//      トークが1本も無いリストは「かける」に出さない（両輪がそろわない施策はやらない）。
//      A/B は会社ごとに決まった1本を使う（同じ会社に毎回違うトークにならないように）。
//   2. 企業調査（mc_call_leads.research）：取り込んだリードを裏で順に調べ、調べ終わったものだけを「かける」に出す。
//   3. 録音の読み取り（mc_call_logs.rec）：Zoom Phone の録音から、自動音声の案内（何番を押すか）と、
//      トーク実施率（決めたトークのうち実際に話せた割合）を読む。
//   4. 折り返しの着信（mc_inbound）：Zoom Phone の着信の知らせを受け、その会社の架電画面を着信した人の画面に出す。
import { dbPool } from "./db.js";
import { researchMcLead, analyzeMcCallRecording } from "./analyzer.js";
import { fetchPageText } from "./companyenrich.js";
import { zoomPhoneConfigured, zoomPhoneRecordings, zoomDownload, zoomPhoneUsers } from "./zoomphone.js";

const P = () => dbPool();
const digits = (v) => String(v || "").normalize("NFKC").replace(/[^0-9]/g, "");
// +81 の番号は 0 から始まる形にそろえる（着信の番号と、リストの番号を同じ形で比べるため）
const telKey = (v) => { let d = digits(v); if (/^81\d{9,10}$/.test(d)) d = "0" + d.slice(2); return d.length >= 9 ? d : ""; };
const clip = (v, n = 400) => String(v ?? "").trim().slice(0, n);
export const TALK_LABELS = ["A", "B", "C"];

export async function ensurePlay(q) {
  await q(`CREATE TABLE IF NOT EXISTS mc_call_talks (
    id SERIAL PRIMARY KEY, list_id INT NOT NULL, label TEXT NOT NULL, ver INT NOT NULL DEFAULT 1, body TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true, created_by TEXT, created_at TIMESTAMPTZ DEFAULT now())`);
  await q(`CREATE INDEX IF NOT EXISTS ix_mc_call_talks_list ON mc_call_talks(list_id, active)`);
  await q(`ALTER TABLE mc_call_leads ADD COLUMN IF NOT EXISTS talk_label TEXT`);
  await q(`ALTER TABLE mc_call_leads ADD COLUMN IF NOT EXISTS research JSONB`);
  await q(`ALTER TABLE mc_call_leads ADD COLUMN IF NOT EXISTS research_at TIMESTAMPTZ`);
  // 番号ごとの自動音声の案内 { "0312345678": { items: [{press, for}], at } }
  await q(`ALTER TABLE mc_call_leads ADD COLUMN IF NOT EXISTS ivr JSONB`);
  await q(`ALTER TABLE mc_call_logs ADD COLUMN IF NOT EXISTS talk_id INT`);
  await q(`ALTER TABLE mc_call_logs ADD COLUMN IF NOT EXISTS rec JSONB`);
  await q(`CREATE TABLE IF NOT EXISTS mc_inbound (
    id SERIAL PRIMARY KEY, email TEXT, number TEXT, lead_id INT, call_id TEXT, seen BOOLEAN NOT NULL DEFAULT false, at TIMESTAMPTZ DEFAULT now())`);
  // 同じ着信でも、グループで鳴った人ごとに1行（出た人がだれでも、その人の画面に出るように）
  await q(`CREATE UNIQUE INDEX IF NOT EXISTS ux_mc_inbound_call ON mc_inbound(call_id, email)`);
  // これまでのトークスクリプト（リストに1本）を、トーク A の第1版として引き継ぐ（書いてあったものを消さない）
  await q(`INSERT INTO mc_call_talks (list_id, label, ver, body, created_by)
    SELECT l.id, 'A', 1, l.script, 'これまでのトークスクリプト' FROM mc_call_lists l
    WHERE COALESCE(btrim(l.script),'') <> '' AND NOT EXISTS (SELECT 1 FROM mc_call_talks t WHERE t.list_id=l.id)`);
}

// ---- トーク ----
export async function activeTalks(listId) {
  return (await P().query(`SELECT id, label, ver, body, created_by, created_at FROM mc_call_talks WHERE list_id=$1 AND active ORDER BY label`, [listId])).rows;
}
// その会社で使うトーク。A/B があるときは会社ごとに決まった1本（最初に開いたときに決めて残す）
export async function talkForLead(lead) {
  const ts = await activeTalks(lead.list_id);
  if (!ts.length) return null;
  let t = ts.find((x) => x.label === lead.talk_label);
  if (!t) {
    t = ts[lead.id % ts.length];
    // 1本しか無いうちは決めて残さない（あとで B を足したとき、まだ決まっていない会社を A/B に分けられるように）
    if (ts.length > 1) await P().query(`UPDATE mc_call_leads SET talk_label=$2 WHERE id=$1`, [lead.id, t.label]).catch(() => {});
  }
  return { id: t.id, label: t.label, ver: t.ver, body: t.body, n: ts.length };
}
// 管理者がトークを保存する。中身が変わったものだけ新しい版にし、前の版は残す（記録が前の版を指したままになるように）
export async function saveTalks(listId, talks, who) {
  const cur = await activeTalks(listId); const byLabel = new Map(cur.map((t) => [t.label, t]));
  const want = new Map();
  for (const t of Array.isArray(talks) ? talks : []) {
    const label = String((t && t.label) || "").toUpperCase(); const body = String((t && t.body) || "").replace(/\r\n/g, "\n").trim().slice(0, 20000);
    if (TALK_LABELS.includes(label) && body) want.set(label, body);
  }
  for (const [label, body] of want) {
    const c = byLabel.get(label);
    if (c && c.body.trim() === body) continue;
    const ver = ((await P().query(`SELECT max(ver) AS v FROM mc_call_talks WHERE list_id=$1 AND label=$2`, [listId, label])).rows[0].v || 0) + 1;
    if (c) await P().query(`UPDATE mc_call_talks SET active=false WHERE id=$1`, [c.id]);
    await P().query(`INSERT INTO mc_call_talks (list_id, label, ver, body, created_by) VALUES ($1,$2,$3,$4,$5)`, [listId, label, ver, body, who]);
  }
  for (const c of cur) if (!want.has(c.label)) await P().query(`UPDATE mc_call_talks SET active=false WHERE id=$1`, [c.id]);
  // 前のトークスクリプトの欄も最新の A にそろえる（古い画面が開いていても同じものが出るように）
  await P().query(`UPDATE mc_call_lists SET script=$2 WHERE id=$1`, [listId, want.get("A") || [...want.values()][0] || null]);
  return activeTalks(listId);
}
export async function listsWithTalk(ids) {
  if (!ids.length) return new Set();
  return new Set((await P().query(`SELECT DISTINCT list_id FROM mc_call_talks WHERE active AND list_id = ANY($1)`, [ids])).rows.map((r) => r.list_id));
}

// ---- 施策の数字（リスト×トーク×版） ----
//   消化率＝リストのリードのうち一度でもかけた割合／トーク実施率＝録音から読んだ「決めたトークを話せた割合」の平均
export async function measures({ from, to, caller = null }) {
  const p = [from, to]; let w = "NOT g.undone AND g.created_at >= $1 AND g.created_at < $2";
  if (caller) { p.push(caller); w += ` AND g.caller=$${p.length}`; }
  const rows = (await P().query(`SELECT g.list_id, t.id AS talk_id, t.label, t.ver, t.active,
      count(*) AS calls, count(*) FILTER (WHERE g.reach <> 'none') AS reached, count(*) FILTER (WHERE g.reach='person') AS person,
      count(*) FILTER (WHERE g.outcome='apo') AS apo, count(*) FILTER (WHERE g.outcome='reject') AS reject, count(DISTINCT g.lead_id) AS leads,
      avg((g.rec->>'adherence')::int) FILTER (WHERE g.rec ? 'adherence' AND g.rec->>'adherence' IS NOT NULL) AS adh,
      count(*) FILTER (WHERE g.rec ? 'adherence' AND g.rec->>'adherence' IS NOT NULL) AS adh_n
    FROM mc_call_logs g LEFT JOIN mc_call_talks t ON t.id=g.talk_id WHERE ${w} GROUP BY 1,2,3,4,5 ORDER BY 1, 3, 4`, p)).rows;
  const ids = [...new Set(rows.map((r) => r.list_id).filter(Boolean))];
  const lists = ids.length ? (await P().query(`SELECT l.id, l.name, count(c.id) AS total, count(c.id) FILTER (WHERE c.attempts > 0) AS touched,
      count(c.id) FILTER (WHERE c.research_at IS NOT NULL) AS researched
    FROM mc_call_lists l LEFT JOIN mc_call_leads c ON c.list_id=l.id AND c.dup_of IS NULL WHERE l.id = ANY($1) GROUP BY l.id`, [ids])).rows : [];
  const L = new Map(lists.map((l) => [l.id, { id: l.id, name: l.name, total: +l.total, touched: +l.touched, researched: +l.researched, talks: [] }]));
  for (const r of rows) {
    const l = L.get(r.list_id); if (!l) continue;
    l.talks.push({ talkId: r.talk_id, label: r.label || "", ver: r.ver || 0, active: !!r.active, calls: +r.calls, reached: +r.reached, person: +r.person, apo: +r.apo, reject: +r.reject, leads: +r.leads,
      adherence: r.adh != null ? Math.round(+r.adh) : null, adhN: +r.adh_n });
  }
  return [...L.values()].sort((a, b) => b.talks.reduce((s, t) => s + t.calls, 0) - a.talks.reduce((s, t) => s + t.calls, 0));
}

// ---- 企業調査（裏で順番に）----
//   調べる順番：だれかの「かける」に出る順（掛け直しの時刻が来たもの→ホット→かけた回数が少ない）。
//   1日の上限（MCCALL_RESEARCH_DAILY・既定1200件）は Web 検索の無料枠（1日1,500件）の内側にする。
//   失敗した会社も「調べられなかった」と残して「かける」に出す（調べが止まって架電まで止まらないように）
const R_CONC = Math.max(1, parseInt(process.env.MCCALL_RESEARCH_CONC || "3", 10) || 3);
const R_DAILY = Math.max(0, parseInt(process.env.MCCALL_RESEARCH_DAILY || "1200", 10) || 0);
// 調べ終わったものだけを「かける」に出すか（調べが追いつかないときに、環境変数 MCCALL_RESEARCH_GATE=0 で一時的に外せる）
//   1日の上限まで調べきったら、その日は調べ終わる前の会社も出す（上限で架電が止まらないように）
let _rRunning = 0; let _rDay = ""; let _rCount = 0;
export const researchGate = () => process.env.MCCALL_RESEARCH_GATE !== "0" && !(_rDay === jstDay() && _rCount >= R_DAILY);
const _rHot = new Set(); const _rBusy = new Set();
const jstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
function siteOf(lead) {
  const I = lead.info || {}; if (I.web) return String(I.web);
  for (const [k, v] of Object.entries(lead.data || {})) if (typeof v === "string" && /url|web|hp$|homepage|site|ホームページ|サイト/i.test(k) && /\./.test(v) && !/@/.test(v)) return v.trim();
  return "";
}
function hintOf(lead) {
  const out = [];
  for (const [k, v] of Object.entries(lead.data || {})) {
    if (k.startsWith("_") || v == null || typeof v === "object") continue;
    if (/tel|phone|mail|メール|電話|owner|user|operator|担当者|id$/i.test(k)) continue;
    const s = String(v).trim(); if (s && s.length < 200) out.push(`${k}：${s}`);
    if (out.length >= 25) break;
  }
  return out.join("\n");
}
async function researchOne(id) {
  const lead = (await P().query(`SELECT id, company, data, info, src FROM mc_call_leads WHERE id=$1`, [id])).rows[0];
  if (!lead) return;
  let r;
  try {
    const site = siteOf(lead); const url = site && !/^https?:\/\//.test(site) ? `https://${site}` : site;
    const siteText = url ? await fetchPageText(url).catch(() => "") : "";
    r = await researchMcLead({ company: lead.company, website: url, siteText, hint: hintOf(lead) });
  } catch (e) { r = { status: "error", error: String(e.message || e).slice(0, 200) }; }
  await P().query(`UPDATE mc_call_leads SET research=$2, research_at=now() WHERE id=$1`, [id, { ...r, at: new Date().toISOString() }]);
}
async function researchPick(n) {
  const hot = [..._rHot].filter((x) => !_rBusy.has(x)).slice(0, n);
  for (const x of hot) _rHot.delete(x);
  if (hot.length >= n) return hot;
  const rows = (await P().query(`SELECT c.id FROM mc_call_leads c JOIN mc_call_lists l ON l.id=c.list_id
    WHERE NOT l.closed AND NOT l.stock AND NOT c.done AND c.dup_of IS NULL AND c.research_at IS NULL AND COALESCE(c.company,'') <> ''
    ORDER BY (c.next_at IS NOT NULL AND c.next_at <= now() + interval '1 hour') DESC, COALESCE(c.hot,0) DESC, c.attempts, c.id LIMIT ${n + _rBusy.size}`)).rows.map((r) => r.id);
  return [...hot, ...rows.filter((x) => !_rBusy.has(x) && !hot.includes(x))].slice(0, n);
}
async function researchPump() {
  if (!P()) return;
  // 1日の数は、サーバーの中の数ではなく、データベースの「今日調べた数」から数える（2026-11-20 田中さん「連続でGoogleのAPIがかかってる」）。
  //   サーバーの中だけで数えていたので、デプロイで再起動するたびに 0 に戻り、上限（1,200件）を何回も超えて調べていた
  //   （11/19〜20 に 7,000件・Web 検索の無料枠を超えて約 $66）。日が変わったとき・起動したときに数え直す
  if (_rDay !== jstDay()) {
    _rDay = jstDay(); _rCount = R_DAILY;   // 数え終わるまでは止めておく
    try { const { rows } = await P().query(`SELECT count(*)::int AS n FROM mc_call_leads WHERE research_at >= ((now() AT TIME ZONE 'Asia/Tokyo')::date::timestamp AT TIME ZONE 'Asia/Tokyo')`); _rCount = Number(rows[0] && rows[0].n) || 0; }
    catch (e) { console.error("[mcplay] 今日の企業調査の数を数えられませんでした（今日はもう調べません）", e.message); return; }
  }
  while (_rRunning < R_CONC && _rCount < R_DAILY) {
    const [id] = await researchPick(1).catch(() => []);
    if (!id || _rBusy.has(id)) return;
    _rBusy.add(id); _rRunning++; _rCount++;
    researchOne(id).catch((e) => console.error("[mcplay] 企業調査", id, e.message)).finally(() => { _rBusy.delete(id); _rRunning--; setTimeout(() => researchPump().catch(() => {}), 200); });
  }
}
// 架電者の「かける」の先頭にある、まだ調べていない会社を先に調べる
export function researchSoon(ids) { for (const id of ids || []) if (id && !_rBusy.has(id)) _rHot.add(id); researchPump().catch(() => {}); }
export function researchState() { return { running: _rRunning, today: _rCount, daily: R_DAILY, gate: researchGate() }; }

// ---- 録音の読み取り（裏で順番に）----
//   記録してから2分たった架電を、Zoom Phone の録音と「番号・かけた人・時刻（前後15分）」で結びつける。
//   2時間たっても録音が見つからないものは「録音なし」として終わりにする（何度も探さない）
const recTextOf = (buf) => {
  let text = buf.toString("utf8");
  try {
    const j = JSON.parse(text); const tl = j.timeline || j.recording_transcript || [];
    if (Array.isArray(tl) && tl.length) text = tl.map((x) => `${(x.users && x.users[0] && x.users[0].username) || x.speaker || ""}：${x.text || ""}`).join("\n");
  } catch {}
  return text;
};
let _recRunning = false;
async function recPump() {
  if (_recRunning || !P() || !zoomPhoneConfigured()) return; _recRunning = true;
  try {
    const logs = (await P().query(`SELECT g.id, g.lead_id, g.caller, g.phone, g.reach, g.talk_id, g.created_at FROM mc_call_logs g
      WHERE g.rec IS NULL AND NOT g.undone AND g.created_at < now() - interval '2 minutes' AND g.created_at > now() - interval '2 days'
      ORDER BY g.created_at LIMIT 40`)).rows;
    if (!logs.length) return;
    const day = (d) => new Date(new Date(d).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
    const recs = await zoomPhoneRecordings({ from: day(logs[0].created_at), to: day(Date.now()), max: 1000 }).catch((e) => { console.error("[mcplay] 録音一覧", e.message); return null; });
    if (!recs) return;
    const used = new Set((await P().query(`SELECT rec->>'recId' AS r FROM mc_call_logs WHERE rec ? 'recId' AND created_at > now() - interval '3 days'`)).rows.map((r) => r.r));
    for (const g of logs) {
      const k = telKey(g.phone); const at = new Date(g.created_at).getTime();
      const cand = recs.filter((r) => r.direction !== "inbound" && telKey(r.number) === k && (!r.ownerEmail || r.ownerEmail === String(g.caller || "").toLowerCase())
        && !used.has(r.id) && r.at && Math.abs(new Date(r.at).getTime() - at) < 15 * 60e3)
        .sort((a, b) => Math.abs(new Date(a.at).getTime() - at) - Math.abs(new Date(b.at).getTime() - at))[0];
      if (!cand) {
        if (Date.now() - at > 2 * 3600e3) await P().query(`UPDATE mc_call_logs SET rec=$2 WHERE id=$1`, [g.id, { status: "none" }]);
        continue;
      }
      used.add(cand.id);
      const talk = g.talk_id ? ((await P().query(`SELECT body FROM mc_call_talks WHERE id=$1`, [g.talk_id])).rows[0] || {}).body || "" : "";
      let out = null;
      try {
        if (cand.transcriptUrl) { const tr = await zoomDownload(cand.transcriptUrl).catch(() => null); if (tr && tr.buf && tr.buf.length) out = await analyzeMcCallRecording({ transcriptText: recTextOf(tr.buf), talk, reachedPerson: g.reach === "person" }); }
        if (!out && cand.downloadUrl) {
          const au = await zoomDownload(cand.downloadUrl);
          const mime = /mp4|m4a/i.test(au.contentType) ? "audio/mp4" : /wav/i.test(au.contentType) ? "audio/wav" : "audio/mpeg";
          out = await analyzeMcCallRecording({ buf: au.buf, mimeType: mime, talk, reachedPerson: g.reach === "person" });
        }
      } catch (e) { console.error("[mcplay] 録音の読み取り", g.id, e.message); }
      const rec = out ? { status: "ok", recId: cand.id, duration: cand.duration, ...out } : { status: "error", recId: cand.id };
      await P().query(`UPDATE mc_call_logs SET rec=$2 WHERE id=$1`, [g.id, rec]);
      if (out && out.ivr && out.ivr.length && k) {
        await P().query(`UPDATE mc_call_leads SET ivr = COALESCE(ivr,'{}'::jsonb) || jsonb_build_object($2::text, $3::jsonb) WHERE id=$1`,
          [g.lead_id, k, JSON.stringify({ items: out.ivr, at: new Date().toISOString() })]);
      }
    }
  } catch (e) { console.error("[mcplay] 録音", e.message); }
  finally { _recRunning = false; }
}

// ---- 折り返しの着信 ----
//   Zoom の Webhook（phone.callee_ringing）で受ける。着信した人（Zoom の利用者）と相手の番号から、
//   MOCHICA のリードを探して残す。画面は数秒おきに /api/mccall/inbound を見て、その会社を開く
let _zu = { at: 0, byId: new Map(), byExt: new Map() };
async function zoomUserEmail(o) {
  if (o && o.email) return String(o.email).toLowerCase();
  if (Date.now() - _zu.at > 30 * 60e3) {
    const us = await zoomPhoneUsers().catch(() => ({}));
    _zu = { at: Date.now(), byId: new Map(Object.entries(us).map(([e, u]) => [String(u.id), e])), byExt: new Map(Object.entries(us).filter(([, u]) => u.ext).map(([e, u]) => [String(u.ext), e])) };
  }
  return _zu.byId.get(String((o && o.user_id) || "")) || _zu.byExt.get(String((o && o.extension_number) || "")) || "";
}
export async function findLeadByPhone(number) {
  const k = telKey(number); if (!k) return null;
  const alt = k.startsWith("0") ? "81" + k.slice(1) : k;
  const r = (await P().query(`SELECT c.id, c.company FROM mc_call_leads c WHERE c.dup_of IS NULL AND (
      regexp_replace(COALESCE(c.phone,''),'[^0-9]','','g') IN ($1,$2) OR regexp_replace(COALESCE(c.gate->>'direct',''),'[^0-9]','','g') IN ($1,$2)
      OR c.id IN (SELECT lead_id FROM mc_call_logs WHERE regexp_replace(COALESCE(phone,''),'[^0-9]','','g') IN ($1,$2) AND NOT undone))
    ORDER BY c.done, c.last_at DESC NULLS LAST, c.id DESC LIMIT 1`, [k, alt])).rows[0];
  return r || null;
}
export async function handleZoomPhoneEvent(body) {
  if (!P()) return;
  const o = (body && body.payload && body.payload.object) || {};
  const caller = o.caller || {}; const callee = o.callee || {};
  const number = caller.phone_number || caller.number || "";
  const email = await zoomUserEmail(callee);
  if (!email || !telKey(number)) return;
  const lead = await findLeadByPhone(number).catch(() => null);
  await P().query(`INSERT INTO mc_inbound (email, number, lead_id, call_id) VALUES ($1,$2,$3,$4) ON CONFLICT (call_id, email) DO NOTHING`,
    [email, clip(number, 40), lead ? lead.id : null, clip(o.call_id || `${number}:${Date.now()}`, 120)]);
}
export async function inboundFor(email) {
  return (await P().query(`SELECT i.id, i.number, i.lead_id, i.at, c.company FROM mc_inbound i LEFT JOIN mc_call_leads c ON c.id=i.lead_id
    WHERE i.email=$1 AND NOT i.seen AND i.at > now() - interval '3 minutes' ORDER BY i.at DESC LIMIT 1`, [email])).rows[0] || null;
}
// 着信を受けた本人なら、自分の担当でないリストの会社でも開いて記録できる（折り返しは担当を選べないため）
export async function inboundAllows(email, leadId, inboundId) {
  const id = parseInt(inboundId, 10); if (!id) return false;
  return !!(await P().query(`SELECT 1 FROM mc_inbound WHERE id=$1 AND email=$2 AND lead_id=$3 AND at > now() - interval '2 hours'`, [id, email, leadId])).rows[0];
}

let _started = false;
export function startPlayPumps() {
  if (_started) return; _started = true;
  setInterval(() => researchPump().catch(() => {}), 60e3);
  setInterval(() => recPump().catch(() => {}), 3 * 60e3);
  setTimeout(() => { researchPump().catch(() => {}); recPump().catch(() => {}); }, 20e3);
}
