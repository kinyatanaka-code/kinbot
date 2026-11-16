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
import { dbPool, listUsers, approachBanHit, approachBanHitSync, loadApproachBans } from "./db.js";
import { createTask, deleteTask, sfQuery } from "./salesforce.js";

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

export function registerMcCall(app, deps) {
  const { isAdmin, sfActor, mochicaSet } = deps;
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
  const adminOnly = (fn) => guard(async (req, res) => { if (!isAdmin(req)) return res.status(403).json({ error: "リストの管理は管理者だけができます" }); await fn(req, res); });

  // 自分がかけてよいリスト（メンバー指定なし＝MOCHICA のメンバー全員。管理者はすべて見える）
  async function myListIds(req) {
    const u = me(req);
    const rows = (await P().query(`SELECT id, members FROM mc_call_lists WHERE biz=$1 AND NOT closed`, [BIZ])).rows;
    if (isAdmin(req)) return rows.map((r) => r.id);
    const mc = await mochicaSet().catch(() => new Set());
    return rows.filter((r) => (r.members && r.members.length ? r.members.map((x) => String(x).toLowerCase()).includes(u) : mc.has(u))).map((r) => r.id);
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
    res.json({ ok: true, added, banned, skipped: rows.length - added - banned });
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
    }
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
      text: [g.memo, g.gate && (g.gate.name || g.gate.hours || g.gate.direct) ? `受付で聞けたこと：${[g.gate.name && `担当 ${g.gate.name}`, g.gate.hours && `在席 ${g.gate.hours}`, g.gate.direct && `直通 ${g.gate.direct}`].filter(Boolean).join("・")}` : "", g.next_at ? `次回 ${jstText(g.next_at)}` : "", g.apo_at ? `アポ ${jstText(g.apo_at)}` : ""].filter(Boolean).join("\n"),
      reach: g.reach, cross: !!g.cross_from, logId: g.id, mine: String(g.caller || "").toLowerCase() === u && Date.now() - new Date(g.created_at).getTime() < 15 * 60e3 }));
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
    for (const t of await sfTasks(req, lead.sf_lead_id || (sf && sf.lead && sf.lead.id), new Set(logs.map((g) => g.sf_task_id).filter(Boolean)))) tl.push(t);
    tl.sort((a, b) => new Date(b.at) - new Date(a.at));
    res.json({ ok: true, lead: { ...lead, data }, ban, phones, docAlso, timeline: tl.slice(0, 80), summary: oneLine(logs[0], lead.gate, names),
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
    const prev = { next_at: lead.next_at, next_why: lead.next_why, last_at: lead.last_at, last_outcome: lead.last_outcome, attempts: lead.attempts, done: lead.done, gate: lead.gate };
    const log = (await P().query(`INSERT INTO mc_call_logs (lead_id, list_id, caller, phone, reach, outcome, reason, gate, memo, next_at, apo_at, cross_from, prev)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, created_at`,
      [id, lead.list_id, u, clip(b.phone || lead.phone, 40), reach, outcome, reason || null, gate, clip(b.memo, 2000) || null, nextAt, apoAt, lead.cross_from, prev])).rows[0];
    await P().query(`UPDATE mc_call_leads SET last_at=now(), last_outcome=$2, attempts=attempts+1, next_at=$3, next_why=$4, done=$5, gate=COALESCE($6, gate), locked_by=NULL WHERE id=$1`,
      [id, outcome, nextAt, why, done, gate]);
    res.json({ ok: true, logId: log.id, nextAt, why, done });
    // SF の活動（リードに付ける）。代理アカウントでも書ける。失敗しても架電の記録は残る
    if (lead.sf_lead_id && /^00Q/.test(lead.sf_lead_id)) {
      (async () => {
        try {
          const owner = await sfActor(req);
          const names = await nameMap();
          const d = new Date(now.getTime() + 9 * 3600e3).toISOString().slice(0, 10);
          const g = gate || {};
          const t = await createTask(owner, {
            WhoId: lead.sf_lead_id, Subject: `[MOCHICA 架電] ${outcomeLabel(outcome)}`, Type: "Call", Status: "完了", ActivityDate: d,
            Description: [`記録した人：${names.get(u) || u}（kinbot for MOCHICA）`, `到達：${REACH[reach].label}`, `結果：${outcomeLabel(outcome)}${reason ? `（${reason}）` : ""}`,
              g.name || g.hours || g.direct ? `受付で聞けたこと：${[g.name && `担当 ${g.name}`, g.hours && `在席 ${g.hours}`, g.direct && `直通 ${g.direct}`].filter(Boolean).join("・")}` : "",
              apoAt ? `アポ：${jstText(apoAt)}` : "", nextAt ? `次回：${jstText(nextAt)}` : "", b.memo ? `メモ：${clip(b.memo, 2000)}` : "",
              lead.cross_from ? `部署をまたいだ架電（${lead.cross_from} のリード）` : ""].filter(Boolean).join("\n"),
          });
          await P().query(`UPDATE mc_call_logs SET sf_task_id=$2 WHERE id=$1`, [log.id, t && t.id]);
        } catch (e) { await P().query(`UPDATE mc_call_logs SET sf_err=$2 WHERE id=$1`, [log.id, String(e.message).slice(0, 300)]).catch(() => {}); }
      })();
    }
  }));

  // 元に戻す（記録した本人が15分以内。管理者はいつでも）
  app.post("/api/mccall/logs/:id/undo", guard(async (req, res) => {
    const g = (await P().query(`SELECT * FROM mc_call_logs WHERE id=$1`, [parseInt(req.params.id, 10)])).rows[0];
    if (!g || g.undone) return res.status(404).json({ error: "この記録は見つからないか、もう取り消してあります" });
    const mine = String(g.caller || "").toLowerCase() === me(req) && Date.now() - new Date(g.created_at).getTime() < 15 * 60e3;
    if (!mine && !isAdmin(req)) return res.status(403).json({ error: "記録してから15分を過ぎたので取り消せません。管理者に頼んでください" });
    const p = g.prev || {};
    await P().query(`UPDATE mc_call_logs SET undone=true WHERE id=$1`, [g.id]);
    await P().query(`UPDATE mc_call_leads SET next_at=$2, next_why=$3, last_at=$4, last_outcome=$5, attempts=GREATEST(COALESCE($6,0),0), done=COALESCE($7,false), gate=$8 WHERE id=$1`,
      [g.lead_id, p.next_at || null, p.next_why || null, p.last_at || null, p.last_outcome || null, p.attempts, p.done, p.gate || null]);
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
    res.json({ ok: true, me: mine, all: isAdmin(req) ? rows.sort((a, b) => b.calls - a.calls) : null });
  }));
  app.get("/api/mccall/meta", guard(async (req, res) => {
    res.json({ ok: true, reach: REACH, rejectReasons: REJECT_REASONS, admin: isAdmin(req), me: me(req) });
  }));
}
