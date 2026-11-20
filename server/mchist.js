// リードの「これまで」を、BALES・SF・Zoom Phone・kinbot（MOCHICA の別リスト／DOC）から集める（2026-11-20）。
//   それまでは、BALES はBALES から入れたリードだけ、SF は SF のリードID を持つリードだけ、kinbot はそのリードの記録だけを見ていた。
//   そのため CSV や SF から入れた会社では、BALES での過去の架電・別の人の SF の活動・Zoom Phone の通話が出ず、
//   「かけたことがない」と思って同じ会社に同じ話をしてしまっていた。
//   ここでは、リードの由来に関係なく、電話番号（すべての番号）と会社名で突き合わせて集める。
//   どの元データが読めなかったかは status で返して画面に出す（読めなかったのに「記録なし」に見せない＝ルール5）。
import { dbPool } from "./db.js";
import { zoomPhoneConfigured, zoomGet, normZoomCall } from "./zoomphone.js";
import { sfQuery, sfSearch } from "./salesforce.js";

const P = () => dbPool();
const digits = (v) => String(v || "").normalize("NFKC").replace(/[^0-9]/g, "");
// +81 の国番号を 0 に直す（Zoom は +81… で返すため、リード側の 03… とそろえる）
const telKey = (v) => { let d = digits(v); if (/^81\d{9,10}$/.test(d)) d = "0" + d.slice(2); return d.length >= 9 ? d : ""; };
const clip = (v, n = 400) => String(v ?? "").replace(/<[^>]*>/g, "").trim().slice(0, n);
const SFID = /^[0-9A-Za-z]{15,18}$/;
const jstDay = (t = Date.now()) => new Date(t + 9 * 3600e3).toISOString().slice(0, 10);

// ---- Zoom Phone の通話を DB に写しておく ----
//   Zoom の API は番号で絞って引けないので、会社を開くたびに読むと遅い。全社の通話を日ごとに写しておき、番号で引く。
//   今日と昨日は毎回読み直し（通話が増えるため）、それより前は1日ずつさかのぼって一度だけ読む
const BACKFILL_DAYS = 180;
const ZS = { at: null, err: "", oldest: null, running: false };
let _ready = null;
function ensure() {
  if (_ready) return _ready;
  _ready = (async () => {
    await P().query(`CREATE TABLE IF NOT EXISTS mc_zoom_calls (id TEXT PRIMARY KEY, at TIMESTAMPTZ, direction TEXT, peer TEXT, my_number TEXT,
      owner_email TEXT, owner_name TEXT, result TEXT, duration INT NOT NULL DEFAULT 0)`);
    await P().query(`CREATE INDEX IF NOT EXISTS ix_mc_zoom_calls_peer ON mc_zoom_calls (peer, at DESC)`);
    await P().query(`CREATE TABLE IF NOT EXISTS mc_zoom_sync (day DATE PRIMARY KEY, n INT NOT NULL DEFAULT 0, done_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    // 再起動の直後でも、前に写した分があれば「始めたところ」と出さないように
    const s = (await P().query(`SELECT max(done_at) AS at, to_char(min(day),'YYYY-MM-DD') AS d FROM mc_zoom_sync`)).rows[0] || {};
    if (!ZS.at && s.at) { ZS.at = s.at; ZS.oldest = s.d; }
    // BALES の行を電話番号・会社名で引くための索引（ないと会社を開くたびに全行を読むことになる）
    for (const [n, e] of [["tel1", "companyTel1"], ["tel2", "companyTel2"], ["ptel", "personalTel"]])
      await P().query(`CREATE INDEX IF NOT EXISTS ix_mbr_${n} ON mochica_bales_rows ((regexp_replace(COALESCE(data->>'${e}',''),'[^0-9]','','g')))`).catch((e2) => console.error("[mchist] BALES の索引を作れませんでした", e2.message));
    await P().query(`CREATE INDEX IF NOT EXISTS ix_mbr_co ON mochica_bales_rows ((data->>'companyName'))`).catch((e2) => console.error("[mchist] BALES の索引を作れませんでした", e2.message));
  })().catch((e) => { _ready = null; throw e; });
  return _ready;
}

async function zoomPage(day, token) {
  try { return { d: await zoomGet("/phone/call_history", { from: day, to: day, page_size: 300, next_page_token: token }), key: "call_history" }; }
  catch (e) { return { d: await zoomGet("/phone/call_logs", { from: day, to: day, page_size: 300, type: "all", next_page_token: token }), key: "call_logs" }; }
}
async function syncDay(day) {
  let token = "", n = 0;
  for (let page = 0; page < 60; page++) {
    const { d, key } = await zoomPage(day, token);
    const rows = (d[key] || d.call_history || d.call_logs || []).map(normZoomCall).filter((c) => c.id && c.at);
    if (rows.length) {
      await P().query(`INSERT INTO mc_zoom_calls (id, at, direction, peer, my_number, owner_email, owner_name, result, duration)
        SELECT * FROM unnest($1::text[], $2::timestamptz[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[], $9::int[])
        ON CONFLICT (id) DO UPDATE SET result=EXCLUDED.result, duration=EXCLUDED.duration, owner_name=COALESCE(NULLIF(EXCLUDED.owner_name,''), mc_zoom_calls.owner_name)`,
        [rows.map((c) => c.id), rows.map((c) => c.at), rows.map((c) => c.direction), rows.map((c) => telKey(c.number)), rows.map((c) => telKey(c.myNumber)),
          rows.map((c) => c.ownerEmail), rows.map((c) => c.ownerName), rows.map((c) => c.result), rows.map((c) => Math.round(c.duration || 0))]);
      n += rows.length;
    }
    token = d.next_page_token || "";
    if (!token) break;
    await new Promise((ok) => setTimeout(ok, 300));   // Zoom の回数制限に当たらないよう少しあける
  }
  await P().query(`INSERT INTO mc_zoom_sync (day, n, done_at) VALUES ($1,$2,now()) ON CONFLICT (day) DO UPDATE SET n=EXCLUDED.n, done_at=now()`, [day, n]);
  return n;
}
export async function zoomSyncTick() {
  if (!P() || !zoomPhoneConfigured() || ZS.running) return;
  ZS.running = true;
  try {
    await ensure();
    const today = jstDay(), yday = jstDay(Date.now() - 86400e3);
    await syncDay(today); await syncDay(yday);
    // さかのぼり：まだ読んでいない日をすべて、新しい日から順に（2026-11-20「全件反映完了させて」）。
    //   1日ずつ間をあけて読むので数分かかるが、その間も画面は開ける（読み終わった日の分から出る）
    const done = new Set((await P().query(`SELECT to_char(day,'YYYY-MM-DD') AS d FROM mc_zoom_sync WHERE day >= $1::date`, [jstDay(Date.now() - BACKFILL_DAYS * 86400e3)])).rows.map((r) => r.d));
    let k = 0;
    for (let i = 2; i <= BACKFILL_DAYS; i++) {
      const d = jstDay(Date.now() - i * 86400e3); if (done.has(d)) continue;
      await syncDay(d); k++; await new Promise((ok) => setTimeout(ok, 500));
    }
    if (k) console.log(`[mchist] Zoom Phone の過去の通話を ${k} 日分写しました`);
    ZS.oldest = (await P().query(`SELECT to_char(min(day),'YYYY-MM-DD') AS d FROM mc_zoom_sync`)).rows[0]?.d || null;
    ZS.at = new Date(); ZS.err = "";
  } catch (e) {
    ZS.err = String(e.message || e).slice(0, 200);
    console.error("[mchist] Zoom Phone の通話を写せませんでした", ZS.err);
  } finally { ZS.running = false; }
}
let _started = false;
export function startZoomSync() {
  if (_started) return; _started = true;
  setTimeout(zoomSyncTick, 30e3); setInterval(zoomSyncTick, 10 * 60e3);
}

// ---- BALES の行から時系列の項目を作る（BALES から入れたリードと、番号・会社名で見つけた別の BALES の行の両方で使う） ----
const dateOf = (o) => { for (const v of Object.values(o || {})) if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v; return null; };
const textOf = (o) => { for (const [k, v] of Object.entries(o || {})) if (/comment|memo|content|note|body|text/i.test(k) && typeof v === "string" && v.trim()) return v; return ""; };
const typeOf = (o) => { for (const [k, v] of Object.entries(o || {})) if (/(type|result|status).*(text|name)|actiontype/i.test(k) && typeof v === "string") return v; return ""; };
export function balesItems(detail, data = {}, sf = null) {
  const out = [];
  if (detail && typeof detail === "object") {
    for (const v of Object.values(detail)) if (Array.isArray(v)) for (const o of v.slice(0, 30)) {
      if (!o || typeof o !== "object") continue; const at = dateOf(o); if (!at) continue;
      out.push({ at, src: "Bales", who: clip(o.userName || (o.user && o.user.name) || o.operatorName || "", 40), title: clip(typeOf(o) || "活動", 60), text: clip(textOf(o), 600) });
    }
  }
  if (!out.length && data && (data.lastActivityAt || data.last_activity_at)) out.push({ at: data.lastActivityAt || data.last_activity_at, src: "Bales", who: clip(data.operatorName || "", 40), title: clip(data.lastActivityTypeText || "最終活動", 60), text: clip(data.lastActivityComment || "", 600) });
  if (sf && Array.isArray(sf.opps)) for (const o of sf.opps.slice(0, 10)) if (o.date) out.push({ at: o.date, src: "SF", who: o.owner || "", title: `商談：${o.stage || ""}`, text: clip(o.name, 200) });
  return out;
}

const ZRES = [[/answered|accepted|completed|connected/, "つながった"], [/no_?answer|missed|not_?answered|ring/, "出なかった"], [/busy/, "話し中"], [/voicemail|vm/, "留守電"], [/cancel|abandon/, "途中で切った"], [/reject|decline|block/, "拒否"]];
const zLabel = (r, dur) => { for (const [re, l] of ZRES) if (re.test(r || "")) return l; return dur > 0 ? "つながった" : (r || "結果不明"); };
const durText = (s) => s >= 60 ? `${Math.floor(s / 60)}分${s % 60 ? `${s % 60}秒` : ""}` : `${s}秒`;
// SOSL で特別な意味を持つ文字を逃がす
const soslEsc = (s) => String(s || "").replace(/[?&|!{}[\]()^~*:\\"'+\-]/g, (c) => "\\" + c);

// ---- まとめて集める ----
//   ctx: { lead, phones(番号の配列), names(メール→名前), sfOwner(SF を読む人を返す関数), coKey(会社名をそろえる関数),
//          skipTaskIds(二重に出さない SF の活動), ownBalesKey(このリード自身の BALES の行 "list|row"), outcomeLabel }
export async function pastApproach(ctx) {
  const { lead, names, coKey } = ctx;
  const phones = [...new Set((ctx.phones || []).map(telKey).filter(Boolean))];
  const company = String(lead.company || "").trim(); const ck = coKey(company); const coOk = ck.length >= 2;
  const nm = (e) => names.get(String(e || "").toLowerCase()) || String(e || "").split("@")[0];
  const items = []; const status = {};
  const sfLeads = new Set([lead.sf_lead_id].filter((x) => SFID.test(String(x || ""))));
  const skip = new Set(ctx.skipTaskIds || []);
  await ensure().catch(() => {});

  // MOCHICA の別のリストでの記録（同じ会社が別のリストにも入っていたとき）
  try {
    const rs = (await P().query(`SELECT g.*, c.company AS lead_company, c.sf_lead_id AS lead_sf, x.name AS list_name FROM mc_call_logs g
        JOIN mc_call_leads c ON c.id=g.lead_id LEFT JOIN mc_call_lists x ON x.id=c.list_id
      WHERE NOT g.undone AND g.lead_id <> $1 AND (regexp_replace(COALESCE(g.phone,''),'[^0-9]','','g') = ANY($2)
        OR regexp_replace(COALESCE(c.phone,''),'[^0-9]','','g') = ANY($2) OR ($3 <> '' AND c.company = $3) OR ($4 <> '' AND c.sf_lead_id = $4))
      ORDER BY g.created_at DESC LIMIT 40`, [lead.id, phones, company, lead.sf_lead_id || ""])).rows;
    for (const g of rs) {
      if (g.sf_task_id) skip.add(g.sf_task_id);
      if (SFID.test(String(g.lead_sf || ""))) sfLeads.add(g.lead_sf);
      items.push({ at: g.created_at, src: "kinbot", who: nm(g.caller), title: ctx.outcomeLabel(g.outcome) + (g.reason ? `（${g.reason}）` : ""),
        text: [`別のリスト「${g.list_name || ""}」での記録`, g.memo, g.next_at ? "次回の予定あり" : ""].filter(Boolean).join("\n"), memo: g.memo || "", reach: g.reach });
    }
    status.kinbot = { ok: true, n: rs.length };
  } catch (e) { status.kinbot = { ok: false, err: clip(e.message, 120) }; }

  // DOC（kincall）での架電。Zoom から自動で入れた記録は下の Zoom と同じなので外す
  try {
    const rs = (await P().query(`SELECT g.id, g.result, g.memo, g.caller, g.at, g.sf_task_id, g.lead_id, l.name AS list FROM call_logs g
        LEFT JOIN call_targets t ON t.id=g.target_id LEFT JOIN call_lists l ON l.id=t.list_id
      WHERE g.zoom_call_id IS NULL AND (regexp_replace(COALESCE(t.phone,''),'[^0-9]','','g') = ANY($1)
        OR ($2 <> '' AND (t.company = $2 OR g.company = $2)) OR ($3 <> '' AND g.lead_id = $3))
      ORDER BY g.at DESC LIMIT 30`, [phones, company, lead.sf_lead_id || ""])).rows;
    for (const g of rs) {
      if (g.sf_task_id) skip.add(g.sf_task_id);
      if (SFID.test(String(g.lead_id || "")) && String(g.lead_id).startsWith("00Q")) sfLeads.add(g.lead_id);
      items.push({ at: g.at, src: "DOC", who: nm(g.caller), title: clip(`架電：${g.result || ""}`, 60), text: [g.list ? `DOC のリスト「${g.list}」` : "", clip(g.memo, 600)].filter(Boolean).join("\n"), memo: g.memo || "" });
    }
    status.doc = { ok: true, n: rs.length };
  } catch (e) { status.doc = { ok: false, err: clip(e.message, 120) }; }

  // BALES：番号か会社名が同じ行すべて（このリード自身の行は呼ぶ側で入れている）
  try {
    const rs = phones.length || coOk ? (await P().query(`SELECT list_key, row_key, data, sf, detail FROM mochica_bales_rows
      WHERE regexp_replace(COALESCE(data->>'companyTel1',''),'[^0-9]','','g') = ANY($1) OR regexp_replace(COALESCE(data->>'companyTel2',''),'[^0-9]','','g') = ANY($1)
        OR regexp_replace(COALESCE(data->>'personalTel',''),'[^0-9]','','g') = ANY($1) OR ($2 <> '' AND data->>'companyName' = $2) LIMIT 20`, [phones, coOk ? company : ""])).rows : [];
    let n = 0;
    for (const r of rs) {
      if (`${r.list_key}|${r.row_key}` === ctx.ownBalesKey) continue;
      const lid = r.sf && r.sf.lead && r.sf.lead.id; if (SFID.test(String(lid || ""))) sfLeads.add(lid);
      for (const it of balesItems(r.detail, r.data || {}, r.sf)) { items.push(it); n++; }
    }
    status.bales = { ok: true, n };
  } catch (e) { status.bales = { ok: false, err: clip(e.message, 120) }; }

  // Zoom Phone：どの番号にでも、だれがかけても（着信も）
  if (!zoomPhoneConfigured()) status.zoom = { ok: false, err: "Zoom Phone の連携が設定されていません" };
  else try {
    const rs = phones.length ? (await P().query(`SELECT * FROM mc_zoom_calls WHERE peer = ANY($1) ORDER BY at DESC LIMIT 60`, [phones])).rows : [];
    for (const c of rs.slice(0, 30)) {
      const inb = /^in/.test(c.direction || ""); const dur = +c.duration || 0;
      items.push({ at: c.at, src: "Zoom", who: c.owner_name || nm(c.owner_email), title: `${inb ? "着信" : "発信"}：${zLabel(c.result, dur)}${dur ? `（${durText(dur)}）` : ""}`, text: "" });
    }
    const talked = rs.filter((c) => (+c.duration || 0) >= 30);
    status.zoom = { ok: !ZS.err, n: rs.length, err: ZS.err ? `通話の読み込みに失敗しています（${ZS.err}）` : "", since: ZS.oldest, syncedAt: ZS.at,
      sum: rs.length ? { n: rs.length, talked: talked.length, lastAt: rs[0].at, lastWho: rs[0].owner_name || nm(rs[0].owner_email), lastDur: +rs[0].duration || 0 } : null };
    if (!ZS.at && !ZS.err) status.zoom.err = "通話の写しを始めたところです。数分後にもう一度開くと出ます";
  } catch (e) { status.zoom = { ok: false, err: clip(e.message, 120) }; }

  // SF：リードID が無くても、電話番号・会社名でリード・取引先を探し、活動（Task・Event）と商談を読む。
  //   SF が遅いときでも画面は開けるよう、待つのは6秒まで
  const sfRun = (async () => {
    const owner = await ctx.sfOwner();
    const accts = new Set();
    const finds = [];
    for (const p of phones.slice(0, 3)) finds.push(`FIND {${p}} IN PHONE FIELDS RETURNING Lead(Id, ConvertedAccountId LIMIT 10), Account(Id LIMIT 5), Contact(AccountId LIMIT 5)`);
    if (coOk) finds.push(`FIND {"${soslEsc(company)}"} IN NAME FIELDS RETURNING Lead(Id, Company, ConvertedAccountId LIMIT 10), Account(Id, Name LIMIT 5)`);
    const found = await Promise.all(finds.map((q) => sfSearch(owner, q).catch((e) => { console.error("[mchist] SF の検索に失敗", e.message); return []; })));
    found.forEach((recs, i) => {
      const byName = coOk && i === finds.length - 1;
      for (const r of recs) {
        const t = r.attributes && r.attributes.type;
        // 名前の検索はあいまいに当たるので、会社名がそろえて同じものだけ使う
        if (byName && coKey(t === "Lead" ? r.Company : r.Name) !== ck) continue;
        if (t === "Lead") { sfLeads.add(r.Id); if (r.ConvertedAccountId) accts.add(r.ConvertedAccountId); }
        else if (t === "Account") accts.add(r.Id);
        else if (t === "Contact" && r.AccountId) accts.add(r.AccountId);
      }
    });
    const L = [...sfLeads].filter((x) => SFID.test(x)).slice(0, 20);
    if (L.length) for (const r of ((await sfQuery(owner, `SELECT ConvertedAccountId FROM Lead WHERE Id IN ('${L.join("','")}') AND ConvertedAccountId != null`)).records || [])) accts.add(r.ConvertedAccountId);
    const A = [...accts].filter((x) => SFID.test(x)).slice(0, 10);
    if (!L.length && !A.length) return { items: [], n: 0 };
    const who = [L.length ? `WhoId IN ('${L.join("','")}')` : "", A.length ? `AccountId IN ('${A.join("','")}')` : ""].filter(Boolean).join(" OR ");
    const [tasks, events, opps] = await Promise.all([
      sfQuery(owner, `SELECT Id, Subject, Description, ActivityDate, CreatedDate, Type, Owner.Name FROM Task WHERE ${who} ORDER BY CreatedDate DESC LIMIT 60`).then((d) => d.records || []),
      sfQuery(owner, `SELECT Id, Subject, Description, StartDateTime, Owner.Name FROM Event WHERE ${who} ORDER BY StartDateTime DESC LIMIT 20`).then((d) => d.records || []).catch(() => []),
      A.length ? sfQuery(owner, `SELECT Id, Name, StageName, CreatedDate, appointment__c, Owner.Name FROM Opportunity WHERE AccountId IN ('${A.join("','")}') ORDER BY CreatedDate DESC LIMIT 10`).then((d) => d.records || [])
        .catch(() => sfQuery(owner, `SELECT Id, Name, StageName, CreatedDate, Owner.Name FROM Opportunity WHERE AccountId IN ('${A.join("','")}') ORDER BY CreatedDate DESC LIMIT 10`).then((d) => d.records || [])) : [],
    ]);
    const out = [];
    for (const t of tasks) if (!skip.has(t.Id)) out.push({ at: t.CreatedDate || t.ActivityDate, src: "SF", who: clip((t.Owner && t.Owner.Name) || "", 40),
      title: clip(`${t.Type === "Call" ? "架電" : t.Type || "活動"}：${t.Subject || ""}`, 80), text: clip(t.Description || "", 600) });
    for (const ev of events) out.push({ at: ev.StartDateTime, src: "SF", who: clip((ev.Owner && ev.Owner.Name) || "", 40), title: clip(`予定：${ev.Subject || ""}`, 80), text: clip(ev.Description || "", 600) });
    for (const o of opps) out.push({ at: o.appointment__c || o.CreatedDate, src: "SF", who: clip((o.Owner && o.Owner.Name) || "", 40), title: clip(`商談：${o.StageName || ""}`, 80), text: clip(o.Name, 200) });
    return { items: out, n: out.length };
  })();
  const sfRes = await Promise.race([sfRun.catch((e) => ({ err: e.message })), new Promise((ok) => setTimeout(() => ok({ err: "SF の返事が遅いため途中で打ち切りました" }), 6000))]);
  if (sfRes.err) { status.sf = { ok: false, err: clip(sfRes.err, 120) }; console.error("[mchist] SF の過去の活動を読めませんでした", sfRes.err); }
  else { items.push(...sfRes.items); status.sf = { ok: true, n: sfRes.n }; }

  return { items, status };
}

// 同じ出来事が2つの元（BALES の別リストの行どうし、BALES の商談と SF の商談など）から来たときに1つにする
export function dedupeTimeline(tl) {
  const seen = new Set();
  return tl.filter((t) => {
    // kinbot・DOC・Zoom は1件ずつが別の架電なので、同じ日に同じ結果でもまとめない
    if (t.src !== "Bales" && t.src !== "SF") return true;
    const k = `${String(t.at || "").slice(0, 10)}|${String(t.title || "").replace(/^(商談|架電)：/, "")}|${String(t.text || "").slice(0, 40)}`;
    if (seen.has(k)) return false; seen.add(k); return true;
  });
}
