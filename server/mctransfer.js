// ===== リードの移行（2026-11-27 福井さん） =====
// 「企業検索でヒットする企業を、自分のリスト内ではなく保有総数のリードから検索するように。
//   他人のリードで管理者ではない場合は移行申請して所有者に連絡が届き、所有者が許可すればリード移行が可能に。
//   逆に自身の保有するリードを他の人に渡す機能も」
//   ・検索（/api/mccall/find）は、その商材の閉じていないリストのリードすべて（かけ終わった会社も）から探す。
//     ほかの人のリードは、勝手にかけないよう電話・担当者を伏せ、持ち主の名前と「移行申請」だけ出す
//   ・持ち主＝MOCHICALL の担当（assigned_to）。無ければリスト管理の持ち主（kinbot で割り振った担当、無ければ BALES の所有者）。
//     「かける」で他人の会社を外す見分け（db.js mcOwnedByOther）と同じ考え方にしている
//   ・申請（ask）は持ち主が、渡す（give）は受け取る人が許可したら移る（受け取る人の許可も要る＝福井さんが選んだ）。
//     持ち主が分からない・メールが分からないときは管理者に届く。管理者はどの申請でも決められる
//   ・移すときは MOCHICALL の担当と、リスト管理の持ち主（db.js mcBalesHandoff：Bales の所有者そのものは変えない）を両方付け替える。
//     片方だけだと、「かける」で他人の会社として外れたままになるため
//   ・AI・有料のサービスは使わない（DB と Google Chat の知らせだけ）
import { dbPool, listUsers, mcBalesOwnerIndex, mcBalesHandoff, mcOwnerIndexReset, normCompanyKey } from "./db.js";
import { notifyPerson } from "./chat.js";

const P = () => dbPool();
const fold = (s) => String(s || "").replace(/[\s　]+/g, "");
const low = (s) => String(s || "").trim().toLowerCase();
const clip = (s, n) => String(s == null ? "" : s).normalize("NFKC").trim().slice(0, n);
const digits = (s) => String(s || "").normalize("NFKC").replace(/[^0-9]/g, "");

let _ready = null;
async function ensure() {
  if (_ready) return _ready;
  _ready = (async () => {
    await P().query(`CREATE TABLE IF NOT EXISTS mc_lead_moves (
      id SERIAL PRIMARY KEY, lead_id INTEGER NOT NULL, kind TEXT NOT NULL, from_email TEXT, from_name TEXT, to_email TEXT NOT NULL,
      by_email TEXT NOT NULL, approver TEXT, status TEXT NOT NULL DEFAULT 'wait', note TEXT, answer TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), decided_at TIMESTAMPTZ, decided_by TEXT, result JSONB)`);
    await P().query(`CREATE INDEX IF NOT EXISTS mc_lead_moves_wait ON mc_lead_moves (status, approver)`);
    await P().query(`CREATE INDEX IF NOT EXISTS mc_lead_moves_lead ON mc_lead_moves (lead_id)`);
  })().catch((e) => { _ready = null; throw e; });
  return _ready;
}

// リスト管理の持ち主（そろえた名前の集まり）。db.js mcOwnedByOther と同じ引き方：主のリストの行はその行の持ち主、
//   ほかは同じ SF リード・同じ会社名の主のリストの行の持ち主
export function balesOwners(idx, { src, src_key, company, sf_lead_id } = {}) {
  const out = new Set(); if (!idx) return out;
  if (src === "bales" && String(src_key || "").startsWith(idx.listKey + "|")) {
    const o = idx.row.get(String(src_key).slice(idx.listKey.length + 1)); if (o) return new Set([o]);
  }
  if (sf_lead_id) for (const x of idx.lid.get(String(sf_lead_id).slice(0, 15)) || []) out.add(x);
  const k = normCompanyKey(company || ""); if (k) for (const x of idx.co.get(k) || []) out.add(x);
  return out;
}
// 1件の持ち主の見立て。st：mine（自分）／other（ほかの人）／none（持ち主なし）
//   c＝{ u: 自分のメール, myB: 自分の BALES での名前（そろえたもの）, idx, fmap: そろえた名前→メール, names: メール→名前 }
export function judgeOwner(lead, c) {
  const a = low(lead.assigned_to);
  if (a && a !== c.u) return { st: "other", email: a, name: c.names.get(a) || a };
  const s = balesOwners(c.idx, lead);
  if (s.size && !(c.myB && s.has(c.myB))) { const o = [...s][0]; const e = c.fmap.get(o) || ""; return { st: "other", email: e === c.u ? "" : e, name: (e && c.names.get(e)) || o }; }
  if (a === c.u || s.size) return { st: "mine", email: c.u, name: c.names.get(c.u) || c.u };
  return { st: "none", email: "", name: "" };
}

export function registerMcTransfer(app, d) {
  const { guard, isAdmin, me, BIZ, PRODUCTS, balesMain, todayOwnerOf, handoverOwners, listIdsFor, nameMap, blindAttempts, mochicaSet, isMcIntern, adminEmails } = d;

  async function ctx(u) {
    const names = await nameMap();
    let bm = null, idx = null, own = new Map(), myB = "";
    try {
      bm = await balesMain();
      if (bm) { [idx, own, myB] = await Promise.all([mcBalesOwnerIndex(bm.listKey, bm.col), handoverOwners(bm).catch(() => new Map()), todayOwnerOf(u, bm).catch(() => "")]); }
    } catch (e) { console.warn("[mctransfer] リスト管理の持ち主を読めませんでした（MOCHICALL の担当だけで見ます）", e.message); }
    // そろえた名前→メール：BALES の所有者の書き方（使っている人だけ）と、kinbot の名前の両方から引く
    const fmap = new Map([...own].map(([o, e]) => [fold(o), low(e)]));
    for (const [e, n] of names) { const f = fold(n); if (f && !fmap.has(f)) fmap.set(f, e); }
    return { u, names, bm, idx, fmap, myB: fold(myB) };
  }
  const leadRow = async (id) => (await P().query(`SELECT c.id, c.list_id, c.company, c.person, c.phone, c.src, c.src_key, c.sf_lead_id, c.assigned_to, c.done, l.name AS list, l.product, l.closed
    FROM mc_call_leads c JOIN mc_call_lists l ON l.id = c.list_id WHERE c.id = $1 AND l.biz = $2`, [id, BIZ])).rows[0];
  async function admins() { return (adminEmails ? await adminEmails().catch(() => []) : []).map(low).filter((x) => x.includes("@")); }
  // 渡す相手に選べる人：MOCHICA のメンバーと、60日以内に MOCHICALL でかけた人（インターンを含む）
  async function people() {
    const mc = await mochicaSet().catch(() => new Set());
    const act = new Set((await P().query(`SELECT DISTINCT lower(caller) AS e FROM mc_call_logs WHERE caller IS NOT NULL AND created_at >= now() - interval '60 days'`)).rows.map((r) => r.e));
    return (await listUsers().catch(() => [])).filter((x) => x && x.email && (mc.has(low(x.email)) || act.has(low(x.email))))
      .map((x) => ({ email: low(x.email), name: String(x.name || x.email) })).sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }
  async function isMember(e) { return (await people()).some((p) => p.email === e) || !!(await isMcIntern(e).catch(() => false)); }
  const say = (to, text) => notifyPerson(to, text).catch((e) => console.warn("[mctransfer] Chat で知らせられませんでした", to, e.message));
  const approversOf = async (m) => (m.approver ? [m.approver] : await admins());

  // ---- 検索：その商材のリードすべてから ----
  app.get("/api/mccall/find", guard(async (req, res) => {
    await ensure();
    const u = me(req), admin = isAdmin(req);
    const q = String(req.query.q || "").normalize("NFKC").trim().slice(0, 60);
    if (q.length < 2) return res.json({ ok: true, items: [], total: 0 });
    const prod = PRODUCTS.includes(String(req.query.prod || "")) ? String(req.query.prod) : "";
    const p = [BIZ]; const w = ["l.biz = $1", "NOT l.closed", "NOT COALESCE(l.stock, false)", "c.dup_of IS NULL"];
    if (prod) { p.push(prod); w.push(`COALESCE(l.product, 'mochica') = $${p.length}`); }
    p.push(`%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`); const a = p.length;
    const ors = [`c.company ILIKE $${a}`, `c.person ILIKE $${a}`, `c.gate->>'name' ILIKE $${a}`, `c.info::text ILIKE $${a}`];
    const dq = digits(q); if (dq.length >= 3) { p.push(`%${dq}%`); ors.push(`regexp_replace(COALESCE(c.phone,''),'[^0-9]','','g') LIKE $${p.length}`); }
    w.push(`(${ors.join(" OR ")})`);
    const where = w.join(" AND ");
    const total = +(await P().query(`SELECT count(*) FROM mc_call_leads c JOIN mc_call_lists l ON l.id = c.list_id WHERE ${where}`, p)).rows[0].count;
    p.push(u);
    // かけていない会社 → かけ終わっていない会社 → 終わった会社の順。同じなかではホット度の高い順
    const rows = (await P().query(`SELECT c.id, c.list_id, l.name AS list, c.company, c.person, c.phone, c.hot, c.attempts, c.last_outcome, c.done, c.src, c.src_key, c.sf_lead_id, c.assigned_to,
        (c.locked_by IS NOT NULL AND c.locked_by <> $${p.length} AND c.locked_at > now() - interval '10 minutes') AS busy
      FROM mc_call_leads c JOIN mc_call_lists l ON l.id = c.list_id WHERE ${where} ORDER BY c.done, COALESCE(c.hot,0) DESC, c.id LIMIT 30`, p)).rows;
    const [c, mine] = await Promise.all([ctx(u), listIdsFor(u, { admin })]);
    const myLists = new Set(mine);
    await blindAttempts(rows, u);
    const ids = rows.map((r) => r.id);
    const wait = new Map(ids.length ? (await P().query(`SELECT lead_id, id FROM mc_lead_moves WHERE status='wait' AND kind='ask' AND by_email=$1 AND lead_id = ANY($2)`, [u, ids])).rows.map((r) => [r.lead_id, r.id]) : []);
    const items = rows.map((r) => {
      const o = judgeOwner(r, c);
      // 開ける：管理者はすべて。ほかの人は、ほかの人のリードでなく、自分がかけてよいリストにあるか自分の担当になっているもの
      const open = admin || (o.st !== "other" && (myLists.has(r.list_id) || low(r.assigned_to) === u));
      const base = { id: r.id, company: r.company, list: r.list, done: r.done, attempts: r.attempts, outcome: r.last_outcome || "", busy: r.busy,
        owner: o.st, ownerName: o.name, open, waitId: wait.get(r.id) || null };
      // 開けない会社は電話・担当者を出さない（移行の前にかけてしまわないため）
      return open ? { ...base, person: r.person, phone: r.phone } : base;
    });
    res.json({ ok: true, total, items });
  }));

  // ---- 渡す相手の候補 ----
  app.get("/api/mccall/moves/people", guard(async (req, res) => { res.json({ ok: true, items: (await people()).filter((x) => x.email !== me(req)) }); }));

  // ---- 自分あての申請（許可を待っているもの）と、自分が出した申請 ----
  app.get("/api/mccall/moves", guard(async (req, res) => {
    await ensure();
    const u = me(req), admin = isAdmin(req);
    const sel = `SELECT m.*, c.company, l.name AS list FROM mc_lead_moves m LEFT JOIN mc_call_leads c ON c.id = m.lead_id LEFT JOIN mc_call_lists l ON l.id = c.list_id`;
    const inbox = (await P().query(`${sel} WHERE m.status='wait' AND (m.approver=$1 OR (COALESCE(m.approver,'')='' AND $2)) ORDER BY m.created_at`, [u, admin])).rows;
    const out = (await P().query(`${sel} WHERE m.by_email=$1 AND (m.status='wait' OR m.decided_at > now() - interval '7 days') ORDER BY m.created_at DESC LIMIT 30`, [u])).rows;
    const names = await nameMap();
    const nm = (e) => (e ? names.get(e) || e : "");
    const view = (m) => ({ id: m.id, leadId: m.lead_id, kind: m.kind, company: m.company || "（消えたリード）", list: m.list || "", status: m.status, note: m.note || "", answer: m.answer || "",
      by: nm(m.by_email), from: m.from_name || nm(m.from_email), to: nm(m.to_email), approver: m.approver ? nm(m.approver) : "管理者", at: m.created_at, decidedAt: m.decided_at });
    res.json({ ok: true, in: inbox.map(view), out: out.map(view) });
  }));

  // ---- 申請を出す。kind=ask（ほかの人のリードを自分に）／give（自分のリードをほかの人に。to＝メール） ----
  app.post("/api/mccall/moves", guard(async (req, res) => {
    await ensure();
    const u = me(req), b = req.body || {}, kind = b.kind === "give" ? "give" : "ask", note = clip(b.note, 300);
    const lead = await leadRow(parseInt(b.leadId, 10));
    if (!lead) return res.status(404).json({ error: "このリードは見つかりません（リストから外された可能性があります）" });
    if (lead.closed) return res.status(400).json({ error: "閉じたリストのリードは移せません" });
    const c = await ctx(u); const o = judgeOwner(lead, c);
    const names = c.names;
    let m;
    if (kind === "ask") {
      if (o.st === "mine") return res.status(400).json({ error: "もうあなたのリードです。そのまま開いてかけてください" });
      const dup = (await P().query(`SELECT id FROM mc_lead_moves WHERE lead_id=$1 AND kind='ask' AND by_email=$2 AND status='wait'`, [lead.id, u])).rows[0];
      if (dup) return res.json({ ok: true, id: dup.id, already: true });
      m = (await P().query(`INSERT INTO mc_lead_moves (lead_id, kind, from_email, from_name, to_email, by_email, approver, note) VALUES ($1,'ask',$2,$3,$4,$4,$5,$6) RETURNING *`,
        [lead.id, o.email || null, o.name || null, u, o.email || null, note || null])).rows[0];
    } else {
      const to = low(b.to);
      if (!isAdmin(req) && o.st !== "mine") return res.status(403).json({ error: o.st === "other" ? `このリードは ${o.name} さんのものなので渡せません` : "渡せるのは、あなたが持ち主のリードだけです（持ち主のいないリードは管理者が割り振ります）" });
      if (!to || to === u) return res.status(400).json({ error: "渡す相手を選んでください" });
      if (!(await isMember(to))) return res.status(400).json({ error: "渡す相手は MOCHICALL を使っている人から選んでください" });
      const dup = (await P().query(`SELECT id FROM mc_lead_moves WHERE lead_id=$1 AND kind='give' AND to_email=$2 AND status='wait'`, [lead.id, to])).rows[0];
      if (dup) return res.json({ ok: true, id: dup.id, already: true });
      m = (await P().query(`INSERT INTO mc_lead_moves (lead_id, kind, from_email, from_name, to_email, by_email, approver, note) VALUES ($1,'give',$2,$3,$4,$2,$4,$5) RETURNING *`,
        [lead.id, u, names.get(u) || u, to, note || null])).rows[0];
    }
    const who = names.get(u) || u;
    const text = kind === "ask"
      ? `🔁 *リードの移行申請（MOCHICALL）*\n${who}さんから、${o.name ? `${o.name}さんの` : "持ち主のいない"}リードを自分に移したいと申請がありました。\n　${lead.company || "（会社名なし）"}（${lead.list}）${note ? `\n　ひと言：${note}` : ""}\nMOCHICALL の架電画面の「移行の申請」から、許可か見送りを選んでください。`
      : `🔁 *リードを渡したいと届きました（MOCHICALL）*\n${who}さんから、あなたにリードを渡したいと届きました。\n　${lead.company || "（会社名なし）"}（${lead.list}）${note ? `\n　ひと言：${note}` : ""}\nMOCHICALL の架電画面の「移行の申請」から、受け取るか見送るかを選んでください。`;
    const to = await approversOf(m);
    for (const e of to) if (e !== u) await say(e, text);
    console.log(`[mctransfer] 申請 ${m.id}（${kind}）${lead.company} by ${u} → 決める人 ${to.join(",") || "なし"}`);
    res.json({ ok: true, id: m.id, approver: m.approver ? names.get(m.approver) || m.approver : "管理者" });
  }));

  // ---- 取り消す（出した本人だけ・待っているものだけ） ----
  app.post("/api/mccall/moves/:id/cancel", guard(async (req, res) => {
    await ensure();
    const r = await P().query(`UPDATE mc_lead_moves SET status='cancel', decided_at=now(), decided_by=$2 WHERE id=$1 AND by_email=$2 AND status='wait'`, [parseInt(req.params.id, 10), me(req)]);
    if (!r.rowCount) return res.status(404).json({ error: "取り消せる申請が見つかりません（もう決まった可能性があります）" });
    res.json({ ok: true });
  }));

  // ---- 許可・見送り（決める人か管理者） ----
  app.post("/api/mccall/moves/:id/decide", guard(async (req, res) => {
    await ensure();
    const u = me(req), admin = isAdmin(req), b = req.body || {}, ok = !!b.ok, answer = clip(b.answer, 300);
    const m = (await P().query(`SELECT * FROM mc_lead_moves WHERE id=$1`, [parseInt(req.params.id, 10)])).rows[0];
    if (!m || m.status !== "wait") return res.status(404).json({ error: "この申請はもう決まっているか、取り消されました。画面を読み直してください" });
    if (!(m.approver === u || (!m.approver && admin) || admin)) return res.status(403).json({ error: "この申請を決められるのは、持ち主（渡すときは受け取る人）か管理者です" });
    const names = await nameMap(); const who = names.get(u) || u;
    const lead = await leadRow(m.lead_id);
    if (!ok || !lead) {
      await P().query(`UPDATE mc_lead_moves SET status=$2, decided_at=now(), decided_by=$3, answer=$4 WHERE id=$1`, [m.id, lead ? "no" : "void", u, answer || (lead ? null : "リードが見つからない")]);
      if (lead) await say(m.by_email, `🔁 *リードの${m.kind === "ask" ? "移行申請" : "受け渡し"}は見送りになりました（MOCHICALL）*\n　${lead.company || ""}（${who}さん）${answer ? `\n　ひと言：${answer}` : ""}`);
      return res.json({ ok: true, status: lead ? "no" : "void" });
    }
    if (lead.closed) return res.status(400).json({ error: "このリードのリストは閉じられました。移せません" });
    // 申請のあとで持ち主が変わっていないか（管理者が決めるときは見ない）
    if (!admin) {
      const o = judgeOwner(lead, await ctx(m.to_email));
      if (o.st === "mine") { await P().query(`UPDATE mc_lead_moves SET status='void', decided_at=now(), decided_by=$2, answer='もう移っていた' WHERE id=$1`, [m.id, u]); return res.json({ ok: true, status: "void", note: "もう受け取る人のリードになっていました" }); }
      if (m.kind === "ask" && m.approver && o.email && o.email !== m.approver) return res.status(409).json({ error: `申請のあとで持ち主が ${o.name} さんに変わりました。申請を出し直してもらってください` });
      if (m.kind === "give" && o.st === "other" && o.email !== m.from_email) return res.status(409).json({ error: `渡す申請のあとで持ち主が ${o.name} さんに変わりました` });
    }
    const result = await moveLead(lead, m.to_email, u);
    await P().query(`UPDATE mc_lead_moves SET status='ok', decided_at=now(), decided_by=$2, answer=$3, result=$4 WHERE id=$1`, [m.id, u, answer || null, JSON.stringify(result)]);
    // 同じリードの、ほかの待っている申請は閉じる（持ち主が変わったため）
    const voids = (await P().query(`UPDATE mc_lead_moves SET status='void', decided_at=now(), decided_by=$2, answer='ほかの申請で移った' WHERE lead_id=$1 AND status='wait' AND id<>$3 RETURNING by_email`, [lead.id, u, m.id])).rows;
    const toName = names.get(m.to_email) || m.to_email;
    await say(m.by_email, `✅ *リードが${m.kind === "ask" ? "移りました" : "渡りました"}（MOCHICALL）*\n　${lead.company || ""}（${lead.list}）→ ${toName}さん\n${m.kind === "ask" ? "架電画面の検索から開いてかけられます。" : `${who}さんが受け取りました。`}${answer ? `\n　ひと言：${answer}` : ""}`);
    if (m.kind === "ask" && m.from_email && m.from_email !== u && m.from_email !== m.by_email) await say(m.from_email, `🔁 *あなたのリードが移りました（MOCHICALL）*\n　${lead.company || ""} → ${toName}さん（${who}さんが許可）`);
    for (const v of voids) if (v.by_email && v.by_email !== m.by_email) await say(v.by_email, `🔁 リードの申請は閉じました（MOCHICALL）：${lead.company || ""} はほかの申請で ${toName}さんに移りました`);
    console.log(`[mctransfer] 申請 ${m.id} 許可：${lead.company} → ${m.to_email}（決めた人 ${u}）`, result);
    res.json({ ok: true, status: "ok", result });
  }));

  // 付け替え：先にリスト管理の持ち主（取り込み中なら止まる）、次に MOCHICALL の担当
  async function moveLead(lead, to, by) {
    const out = { mc: 0, bales: 0, today: 0 };
    const bm = await balesMain().catch(() => null);
    if (bm) {
      const run = (await P().query(`SELECT run_at FROM mochica_bales_lists WHERE list_key=$1`, [bm.listKey])).rows[0];
      const items = [];
      if (lead.src === "bales" && String(lead.src_key || "").includes("|")) { const [l, k] = String(lead.src_key).split("|"); items.push({ l, k }); }
      if (run) {
        // 主のリストで同じ会社・同じ SF リードの行も（「かける」は会社ごとに持ち主を見るため）
        const k = normCompanyKey(lead.company || ""), lid = lead.sf_lead_id ? String(lead.sf_lead_id).slice(0, 15) : "";
        if (k || lid) for (const r of (await P().query(`SELECT row_key, data->>'companyName' AS cn, sf->'lead'->>'id' AS lid FROM mochica_bales_rows WHERE list_key=$1 AND run_at=$2`, [bm.listKey, run.run_at])).rows)
          if ((k && normCompanyKey(r.cn || "") === k) || (lid && String(r.lid || "").slice(0, 15) === lid)) items.push({ l: bm.listKey, k: r.row_key });
      }
      const uniq = [...new Map(items.map((x) => [`${x.l}\t${x.k}`, x])).values()];
      if (uniq.length) {
        const name = (await todayOwnerOf(to, bm).catch(() => "")) || (await nameMap()).get(to) || to;
        const h = await mcBalesHandoff(uniq, name, { email: to, by });
        out.bales = h.n; out.today = h.today;
        mcOwnerIndexReset();
      }
    }
    out.mc = (await P().query(`UPDATE mc_call_leads SET assigned_to=$2, locked_by=NULL, locked_at=NULL WHERE id=$1`, [lead.id, to])).rowCount;
    return out;
  }
}
