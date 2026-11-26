// MOCHICALL の見張りと週次のまとめ（2026-11-27 福井さん「2週目：止まる前の見張り・週次の計測」）
//
// なぜ作ったか：
//   1週目は「かける」が空になる・SF に架電履歴が残らない（代理アカウントの SF のつなぎが切れていた）・
//   手が止まっている、などをインターン生の「困ったボタン」で知ってから直していた。
//   困ったボタンは押されないと分からないので、止まる前（止まった直後）に管理者（福井さん）へ Google Chat で知らせる。
//
// 何を見るか（どれも DB を読むだけ。SF を呼ぶのは「つなぎの確かめ」と週次の「有効商談」だけ）：
//   1. 架電時間中に「かける」が空になった人（理由つき）……「かける」を開いたときに見る（自動で回る処理を増やさない）
//   2. SF に書けていない架電の記録（件数・理由・「SF に書き直す」待ちの件数）……10分ごとに DB を数える
//   3. 代理アカウント・運用者の SF のつなぎが切れた／切れそう……10分ごとに DB とサーバーの覚えを見る。1時間に1回だけ SF に軽く問い合わせる
//   4. 1時間17コールを大きく割っている時台……10分ごとに DB を数える（数え方は mcpace.js と同じ）
//   5. 毎週月曜の朝に、先週の人別・チーム別のまとめ……レポート（/api/mccall/report）をそのまま呼んで同じ数え方にする
//
// 同じ知らせは、一定の時間（WATCH.sameMin）のあいだ1回にまとめる。送った覚えは settings.mcWatchSent に残す
//   （デプロイで再起動するたびに同じ知らせが届かないように）。
// 送り先は settings.mcWatchTo（メールのカンマ区切り）。無ければ福井さん。
// AI は使わない。お金のかかる外のサービスも呼ばない（SF の API の回数は下の WATCH の説明のとおり）。
import { getSettings, saveSettings, listMembers } from "./db.js";
import { notifyPerson } from "./chat.js";
import { isConnected as sfIsConnected, sfDeadOwners, sfQuery } from "./salesforce.js";
import { PACE, gapStats, mmss } from "./mcpace.js";
import { teamOf, teamLabel } from "./mcteam.js";

export const WATCH = {
  tickMin: 10,          // DB を数える間隔（分）
  sameMin: 60,          // 同じ知らせはこの分数に1回まで
  remindMin: 180,       // 続いている知らせ（SF のつなぎが切れたまま等）を思い出させる間隔
  hourFrom: 9,          // 架電時間（日本時間・平日）。この外では「かける」が空でも・コールが少なくても知らせない
  hourTo: 20,
  lowRatio: 0.6,        // 「大きく割っている」＝1時間のコールが 17 × 0.6 ＝ 10.2 本未満（10本以下）
  probeMin: 60,         // SF のつなぎを SF に問い合わせて確かめる間隔（1回＝SF の API 1回。代理・運用者の数だけ）
  emptyWaitSec: 60,     // 「かける」が空の知らせは、最初の1人から60秒ためて、その間の人をまとめて1通にする
  weeklyDow: 1,         // 週次のまとめを送る曜日（1＝月曜）
  weeklyAt: 8 * 60 + 30, // 週次のまとめを送る時刻（日本時間・分。8:30）
};
const DEFAULT_TO = ["sho.fukui@neo-career.co.jp"];   // 管理者（福井さん）。settings.mcWatchTo で変えられる
const lowLine = () => Math.ceil(PACE.perHour * WATCH.lowRatio);   // これ未満を「大きく割っている」とする（17なら11未満＝10本以下）

// ---- 日本時間の道具 ----
let _now = null;   // 試験だけで使う「いま」
const NOW = () => (_now ? new Date(_now) : new Date());
const J = (d = NOW()) => new Date(d.getTime() + 9 * 3600e3);
export const jstDay = (d = NOW()) => J(d).toISOString().slice(0, 10);
const jstHour = (d = NOW()) => J(d).getUTCHours();
const jstDayStartOf = (d = NOW()) => new Date(Date.parse(jstDay(d) + "T00:00:00Z") - 9 * 3600e3);
export function inCallHours(d = NOW()) {
  const j = J(d), dow = j.getUTCDay(), h = j.getUTCHours();
  return dow >= 1 && dow <= 5 && h >= WATCH.hourFrom && h < WATCH.hourTo;
}
const md = (s) => { const [, m, dd] = String(s).split("-"); return `${+m}/${+dd}`; };
const pct = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}%` : "—");
const fmt = (n) => Number(n || 0).toLocaleString("ja-JP");

// ---- 「かける」が空の理由を、知らせの言葉にする（画面で本人に出しているのと同じ材料） ----
//   kind：ban（禁止名簿）／judge（判定）／talk（トーク）／owner（担当）／done（今日の分が終わった）／wait（時刻待ち）／none（リード切れ）
export function emptyReason(body) {
  if (!body || (Array.isArray(body.items) && body.items.length)) return null;
  if (body.stop === "ban") return { kind: "ban", label: "禁止名簿", text: "アプローチ禁止の名簿が読めないため、「かける」を止めています（DB と SF のつながりを確かめてください）" };
  const w = body.why || {};
  if (w.kind === "notIntern") return { kind: "judge", label: "判定", text: `MOCHICA のインターンと判定されていません（kinbot の名前「${w.name || ""}」が名簿と合いません）` };
  if (w.kind === "notMember") return { kind: "judge", label: "判定", text: "入れるリストのメンバーに入っていません" };
  if (w.kind === "noList") return { kind: "none", label: "リード切れ", text: "開いているリストがありません" };
  const parts = []; let kind = "";
  const noTalk = Array.isArray(body.noTalk) ? body.noTalk.filter(Boolean) : [];
  if (noTalk.length) { kind = kind || "talk"; parts.push(`トークが登録されていないリスト：${noTalk.slice(0, 3).join("・")}${noTalk.length > 3 ? ` ほか${noTalk.length - 3}本` : ""}`); }
  if (+w.others > 0) { kind = kind || "owner"; parts.push(`残り ${fmt(w.others)}件はほかの人の担当${+w.todayOthers > 0 ? `（うち ${fmt(w.todayOthers)}件はほかの人の今日の分）` : ""}`); }
  if (+w.locked > 0) { kind = kind || "owner"; parts.push(`ほかの人が開いている ${fmt(w.locked)}件`); }
  if (+w.held > 0) { kind = kind || "judge"; parts.push(`検討時期の判定で出していない ${fmt(w.held)}件`); }
  const t = body.today;
  if (t && +t.left === 0) { kind = kind || "done"; parts.push(`今日の分をかけ終えた（掛け直し待ち ${fmt(t.wait)}件${+t.held ? `・検討時期待ち ${fmt(t.held)}件` : ""}）`); }
  if (+body.later > 0) { kind = kind || "wait"; parts.push(`このあと時刻が来る掛け直し ${fmt(body.later)}件`); }
  if (!parts.length) return { kind: "none", label: "リード切れ", text: "かけられるリードがありません" };
  const label = { talk: "トーク", owner: "担当", judge: "判定", done: "今日の分が終わった", wait: "時刻待ち" }[kind] || "リード切れ";
  return { kind, label, text: parts.join("／") };
}

// ---- 1時間のコール数が大きく足りない時台を拾う（mcpace.js の数え方に合わせる） ----
//   cells：{ u, h, n }（今日の人×時台のコール数）。nowHour：いまの時（日本時間）。
//   mcpace の hourStats と同じく、その日の最初の時と最後の時（途中から始めた・途中でやめた時）は数えない。
//   さらに「いまの時」はまだ終わっていないので数えない。判定できるのは、その時より前にも後にもコールがある時台だけ
export function slowHours(cells, nowHour) {
  const by = new Map();
  for (const c of cells || []) { if (!c || !(c.n > 0)) continue; if (!by.has(c.u)) by.set(c.u, []); by.get(c.u).push(c); }
  const out = [];
  for (const [u, arr] of by) {
    arr.sort((a, b) => a.h - b.h);
    for (let i = 1; i < arr.length - 1; i++) {
      const c = arr[i];
      if (c.h >= nowHour) continue;
      if (c.n < lowLine()) out.push({ u, h: c.h, n: c.n, prev: arr[i - 1].n, next: arr[i + 1].n });
    }
  }
  return out;
}

// SF のエラー文を、まとめて数えられる短い理由にする（ID・数字の違いで別々に数えない）
export function sfErrKey(e) {
  const s = String(e || "").replace(/\s+/g, " ").trim();
  if (!s) return "まだ書けていない（2分たっても SF から返事が無い）";
  if (/invalid_grant|SF_REAUTH|SF refresh|INVALID_SESSION_ID|Session expired/i.test(s)) return "SF のつなぎが切れている（連携し直しが必要）";
  if (/CANNOT_EXECUTE_FLOW_TRIGGER|FIELD_CUSTOM_VALIDATION_EXCEPTION/.test(s)) { const m = /FIELD_CUSTOM_VALIDATION_EXCEPTION[:：]?\s*([^\]\[{}"]{4,60})/.exec(s); return `SF の入力規則・フローで断られた${m ? `：${m[1].trim()}` : ""}`; }
  if (/CANNOT_UPDATE_CONVERTED_LEAD|コンバート/.test(s)) return "コンバート済みのリードに書けなかった";
  if (/REQUEST_LIMIT_EXCEEDED/.test(s)) return "SF の API の回数の上限";
  if (/ENTITY_IS_DELETED|NOT_FOUND|見つかりません/.test(s)) return "SF のリードが見つからない（消された・結びつけ違い）";
  return s.replace(/\b[0-9A-Za-z]{15,18}\b/g, "…").replace(/\d+/g, "#").slice(0, 70);
}

// 商談の段階が「有効商談（02）」まで進んだか。SS02 以上・受注を有効とする（失注は段階が分からないので数えない）
export function isValidStage(stage) {
  const s = String(stage || "");
  if (/受注/.test(s)) return true;
  if (/失注/.test(s)) return false;
  const m = /(?:SS|LS)?\s*0([0-9])\s*[：:）)\s]/.exec(s + " ");
  return !!m && +m[1] >= 2;
}

// ---- 送る ----
let _notify = notifyPerson;
let _sf = { isConnected: sfIsConnected, deadOwners: sfDeadOwners, query: sfQuery };
const _log = [];   // 送った知らせ（直近30件。管理者の確かめ用・試験用）
let _sent = null;  // key → 送った時刻（ミリ秒）
async function sentMap() {
  if (_sent) return _sent;
  const st = await getSettings().catch(() => ({}));
  _sent = new Map(Object.entries(st.mcWatchSent || {}).map(([k, v]) => [k, Date.parse(v) || 0]));
  return _sent;
}
async function markSent(keys) {
  const m = await sentMap(); const now = Date.now();
  for (const k of keys) m.set(k, now);
  for (const [k, t] of m) if (now - t > 3 * 86400e3) m.delete(k);   // 3日より前の覚えは捨てる（settings を太らせない）
  await saveSettings({ mcWatchSent: Object.fromEntries([...m].map(([k, t]) => [k, new Date(t).toISOString()])) }).catch(() => {});
}
async function fresh(key, min = WATCH.sameMin) { const t = (await sentMap()).get(key); return !t || Date.now() - t >= min * 60e3; }
async function watchTo() {
  const st = await getSettings().catch(() => ({}));
  const v = Array.isArray(st.mcWatchTo) ? st.mcWatchTo : String(st.mcWatchTo || "").split(",");
  const a = v.map((x) => String(x).trim().toLowerCase()).filter((x) => x.includes("@"));
  return a.length ? a : DEFAULT_TO;
}
async function send(kind, text, keys) {
  const to = await watchTo();
  const res = [];
  for (const e of to) res.push(await _notify(e, text).catch((err) => ({ ok: false, reason: err.message })));
  const ok = res.some((r) => r && r.ok);
  _log.unshift({ at: new Date().toISOString(), kind, text, to, ok, reason: ok ? "" : (res.find((r) => r && r.reason) || {}).reason || "" });
  _log.length = Math.min(_log.length, 30);
  await markSent(keys);
  if (!ok) console.warn(`[mc-watch] ${kind} の知らせを Chat に送れませんでした（${_log[0].reason || "理由不明"}）。管理者が kinbot の Chat アプリに話しかけているか確かめてください`);
  else console.log(`[mc-watch] ${kind} を ${to.length}人に知らせた`);
  return ok;
}

// ---- 見張りの本体 ----
let C = null;   // mccall.js から渡される道具（P・nameMap・SF_FAIL・gapSql・runReport・isMcIntern・sfActor）
const _empty = new Map();   // まとめて送る前の「かける」が空の人（key → 中身）
let _emptyTimer = null;

// 「かける」を開いて空だったとき（mccall.js の /api/mccall/queue から呼ぶ）。DB は読まず、覚えるだけ
export function watchQueue(u, body, { intern = true, picked = false } = {}) {
  try {
    if (!C || !intern || picked || !u) return;
    if (!inCallHours()) return;
    const r = emptyReason(body); if (!r) return;
    const key = `empty:${jstDay()}:${u}:${r.kind}`;
    if (_empty.has(key)) return;
    _empty.set(key, { u, ...r, at: Date.now() });
    if (!_emptyTimer) { _emptyTimer = setTimeout(() => { _emptyTimer = null; flushEmpty().catch((e) => console.warn("[mc-watch] 「かける」が空の知らせ：", e.message)); }, WATCH.emptyWaitSec * 1000); _emptyTimer.unref?.(); }
  } catch (e) { console.warn("[mc-watch] 「かける」の見張り：", e.message); }
}
export async function flushEmpty() {
  const items = [..._empty.entries()]; _empty.clear();
  const fresh1 = []; for (const [k, x] of items) if (await fresh(k)) fresh1.push([k, x]);
  if (!fresh1.length) return false;
  const names = await C.nameMap();
  const lines = fresh1.map(([, x]) => `・${names.get(x.u) || x.u}さん【${x.label}】${x.text}`);
  const text = [`🛑 *「かける」が空になった人がいます（MOCHICALL）*`, ...lines, `本人の画面にも理由が出ています。担当の付け直し・トークの登録・リードの追加を確かめてください（同じ人・同じ理由は${WATCH.sameMin}分に1回だけ知らせます）`].join("\n");
  return send("empty", text, fresh1.map(([k]) => k));
}

// SF に書けていない記録（今日の分）。「SF に書き直す」で書き直せる件数＝本人の画面の「書き直す」と同じ条件
export async function checkSfFail({ dry = false } = {}) {
  const P = C.P; const from = jstDayStartOf();
  const PEND = `(${C.SF_FAIL}) OR (NOT g.undone AND g.sf_task_id IS NOT NULL AND g.sf_lead_err IS NOT NULL AND NOT g.sf_fill_done)`;
  const rows = (await P().query(`SELECT lower(g.caller) AS u, count(*) FILTER (WHERE ${C.SF_FAIL}) AS fail, count(*) FILTER (WHERE ${PEND}) AS pend
    FROM mc_call_logs g WHERE g.created_at >= $1 GROUP BY 1 HAVING count(*) FILTER (WHERE ${PEND}) > 0 ORDER BY 3 DESC`, [from])).rows.map((r) => ({ u: r.u, fail: +r.fail, pend: +r.pend }));
  const errs = (await P().query(`SELECT COALESCE(g.sf_err, g.sf_lead_err) AS e, count(*) AS n FROM mc_call_logs g WHERE g.created_at >= $1 AND (${PEND}) GROUP BY 1`, [from])).rows;
  const why = new Map(); for (const r of errs) { const k = sfErrKey(r.e); why.set(k, (why.get(k) || 0) + +r.n); }
  const fail = rows.reduce((a, r) => a + r.fail, 0), pend = rows.reduce((a, r) => a + r.pend, 0);
  const res = { fail, pend, people: rows, reasons: [...why].sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ k, n })) };
  if (dry || !pend) return res;
  const key = `sf:${jstDay()}`;
  const lastN = (await getSettings().catch(() => ({}))).mcWatchSfN || 0;
  // 増えたときは1時間に1回、同じ件数のままなら3時間に1回だけ思い出させる
  if (!(await fresh(key, pend > lastN ? WATCH.sameMin : WATCH.remindMin))) return res;
  const names = await C.nameMap();
  const text = [`⚠️ *SF に書けていない架電の記録があります（MOCHICALL・今日の分）*`,
    `SF の活動に書けていない ${fmt(fail)}件・「SF に書き直す」待ち ${fmt(pend)}件（リードの項目の書き残しを含む）`,
    `理由：${res.reasons.slice(0, 3).map((x) => `${x.k} ${fmt(x.n)}件`).join("／")}`,
    `人別：${rows.slice(0, 8).map((r) => `${names.get(r.u) || r.u} ${r.pend}`).join("・")}`,
    `本人の画面の「SF に書き直す」で今日の分を書き直せます。つなぎが切れているときは、先に SF の連携をし直してください`].join("\n");
  await saveSettings({ mcWatchSfN: pend }).catch(() => {});
  await send("sf", text, [key]);
  return res;
}

// 代理アカウント（sfProxyUser）・運用者（apoScanOwner・apoInviteOwner）の SF のつなぎ
let _probeAt = 0;
export async function checkSfConn({ dry = false, probe = null } = {}) {
  const st = await getSettings().catch(() => ({}));
  const who = new Map();
  const add = (e, role) => { const k = String(e || "").trim().toLowerCase(); if (!k.includes("@")) return; who.set(k, [...(who.get(k) || []), role]); };
  add(st.sfProxyUser, "代理アカウント"); add(st.apoScanOwner, "運用者"); add(st.apoInviteOwner, "運用者");
  const doProbe = probe != null ? probe : Date.now() - _probeAt >= WATCH.probeMin * 60e3;
  if (doProbe && !dry) _probeAt = Date.now();
  const dead = new Set((_sf.deadOwners() || []).map((x) => String(x.owner || "").toLowerCase()));
  const items = [];
  for (const [e, roles] of who) {
    let state = "ok", note = "";
    const conn = await _sf.isConnected(e).catch(() => false);
    if (dead.has(e)) { state = "dead"; note = "SF がリフレッシュトークンを受け付けません"; }
    else if (!conn) { state = "dead"; note = "SF の連携がありません（連携が外れた・接続先が変わった）"; }
    else if (doProbe && !dry) {
      try { await _sf.query(e, "SELECT Id FROM User LIMIT 1"); }
      catch (err) { const m = String(err && err.message); if (err && err.sfReauth || /invalid_grant|INVALID_SESSION_ID|expired/i.test(m)) { state = "dead"; note = "SF に問い合わせると「つなぎが切れている」と返りました"; } else { state = "warn"; note = `SF に問い合わせられませんでした（${m.slice(0, 80)}）`; } }
    }
    items.push({ email: e, roles: [...new Set(roles)], state, note });
  }
  // 「切れそう」：直近1時間の架電の記録で、つなぎ切れのエラーで SF に書けなかったもの（連携ありのまま失敗している）
  const P = C.P;
  const auth = +(await P().query(`SELECT count(*) AS n FROM mc_call_logs WHERE created_at > $1::timestamptz - interval '1 hour' AND created_at <= $1 AND COALESCE(sf_err, sf_lead_err, '') ~* 'invalid_grant|INVALID_SESSION_ID|SF_REAUTH|SF refresh'`, [NOW()])).rows[0].n;
  const proxy = String(st.sfProxyUser || "").trim().toLowerCase();
  const alive = items.filter((x) => x.state === "ok");
  const warns = [];
  if (!proxy) warns.push("代理アカウント（sfProxyUser）が決まっていません。SF 未連携の人の記録は運用者のアカウントで書いています");
  else if (alive.length === 1 && items.length > 1) warns.push(`SF に書けるアカウントが ${alive[0].email} の1つだけです（ほかが切れると、SF 未連携の人の架電履歴が残らなくなります）`);
  if (auth > 0) warns.push(`直近1時間に、つなぎ切れのエラーで SF に書けなかった記録が ${auth}件あります`);
  const res = { items, warns, auth, probed: doProbe && !dry };
  if (dry) return res;
  const bad = items.filter((x) => x.state !== "ok");
  const keys = [...bad.map((x) => `sfconn:${x.email}:${x.state}`), ...warns.map((w, i) => `sfwarn:${jstDay()}:${w.slice(0, 20)}:${i}`)];
  const newKeys = []; for (const k of keys) if (await fresh(k, WATCH.remindMin)) newKeys.push(k);
  if (!newKeys.length) return res;
  const text = [`🔌 *SF のつなぎを確かめてください（MOCHICALL）*`,
    ...bad.map((x) => `・${x.email}（${x.roles.join("・")}）：${x.state === "dead" ? "切れています" : "切れそうです"}。${x.note}`),
    ...warns.map((w) => `・${w}`),
    `直し方：その人が kinbot の 設定 → 連携 で Salesforce につなぎ直す（切れている間は、SF 未連携のインターン生の架電履歴が SF に残りません）`].join("\n");
  await send("sfconn", text, keys);
  return res;
}

// 1時間17コールを大きく割っている時台（今日・判定できる時台だけ）
export async function checkPace({ dry = false } = {}) {
  const P = C.P; const from = jstDayStartOf();
  const cells = (await P().query(`SELECT lower(g.caller) AS u, EXTRACT(HOUR FROM g.created_at AT TIME ZONE 'Asia/Tokyo')::int AS h, count(*)::int AS n
    FROM mc_call_logs g WHERE NOT g.undone AND g.created_at >= $1 GROUP BY 1,2`, [from])).rows;
  let slow = slowHours(cells, jstHour());
  // インターン生だけ（管理者の試しがけ・少しだけかけた人で知らせないため）
  const keep = []; for (const x of slow) if (await C.isMcIntern(x.u).catch(() => false)) keep.push(x);
  slow = keep;
  if (!slow.length) return { slow };
  // その時台の間隔（mcpace と同じ測り方）
  const gaps = (await P().query(`SELECT lower(caller) AS u, EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Tokyo')::int AS h, array_agg(round(gap)::int) FILTER (WHERE gap IS NOT NULL) AS g
    FROM (${C.gapSql("NOT g.undone AND g.created_at >= $1")}) x GROUP BY 1,2`, [from])).rows;
  const gm = new Map(gaps.map((r) => [`${r.u}:${r.h}`, gapStats(r.g || [])]));
  for (const x of slow) x.gap = gm.get(`${x.u}:${x.h}`) || null;
  if (dry) return { slow };
  const day = jstDay();
  const fresh1 = []; for (const x of slow) { const k = `slow:${day}:${x.u}:${x.h}`; if (await fresh(k, 24 * 60)) fresh1.push([k, x]); }
  if (!fresh1.length) return { slow };
  const names = await C.nameMap();
  const text = [`🐢 *1時間${PACE.perHour}コールを大きく割っている時台があります（MOCHICALL）*`,
    ...fresh1.map(([, x]) => `・${names.get(x.u) || x.u}さん ${x.h}時台 ${x.n}コール／${PACE.perHour}（前の時台 ${x.prev}・次の時台 ${x.next}）${x.gap && x.gap.n ? `・間隔の中央値 ${mmss(x.gap.med)}・2分超え ${x.gap.over}回${x.gap.breaks ? `・休憩 ${x.gap.breaks}回` : ""}` : ""}`),
    `その日の最初と最後の時台、いまの時台は数えていません（途中から始めた・やめた時を「足りない」としないため）。手が止まった理由（会社の中身が重い・リードが合わない等）を聞いてください`].join("\n");
  await send("pace", text, fresh1.map(([k]) => k));
  return { slow };
}

// ---- 週次のまとめ ----
//   week：その週の月曜（YYYY-MM-DD）。無ければ先週。数え方はレポート（/api/mccall/report）と同じ：レポートの処理をそのまま呼ぶ
export async function weeklySummary(week = "", { owner = "" } = {}) {
  const monThis = (() => { const d = jstDayStartOf(); const dow = J(d).getUTCDay(); return new Date(d.getTime() - ((dow + 6) % 7) * 86400e3); })();
  const mon = /^\d{4}-\d{2}-\d{2}$/.test(week) ? new Date(Date.parse(week + "T00:00:00Z") - 9 * 3600e3) : new Date(monThis.getTime() - 7 * 86400e3);
  const sun = new Date(mon.getTime() + 6 * 86400e3);
  const from = jstDay(mon), to = jstDay(sun);
  const admin = owner || (await watchTo())[0];
  const rep = await C.runReport({ from, to, by: "user" }, admin);
  const members = await listMembers().catch(() => []);
  const pace = new Map(((rep.pace && rep.pace.rows) || []).map((r) => [String(r.key || "").toLowerCase(), r]));
  // アポ → 有効商談（SF の商談の段階）。アポの数はレポートと同じ（取り消していない outcome='apo'）
  const apos = (await C.P().query(`SELECT g.id, lower(g.caller) AS u, c.sf_lead_id, g.sf_launch FROM mc_call_logs g LEFT JOIN mc_call_leads c ON c.id = g.lead_id
    WHERE NOT g.undone AND g.outcome='apo' AND g.created_at >= $1 AND g.created_at < $2`, [mon, new Date(mon.getTime() + 7 * 86400e3)])).rows;
  let sfOk = true, sfNote = "";
  const oppOf = new Map(); const stageOf = new Map();
  try {
    const sfo = await C.sfActor({ user: admin });
    const idq = (s) => /^[A-Za-z0-9]{15,18}$/.test(String(s || "")) ? String(s) : "";
    const leads = [...new Set(apos.filter((a) => !(a.sf_launch && a.sf_launch.oppId)).map((a) => idq(a.sf_lead_id)).filter(Boolean))];
    for (let i = 0; i < leads.length; i += 150) {
      const r = await _sf.query(sfo, `SELECT Id, ConvertedOpportunityId FROM Lead WHERE Id IN ('${leads.slice(i, i + 150).join("','")}')`);
      for (const x of r.records || []) if (x.ConvertedOpportunityId) oppOf.set(x.Id.slice(0, 15), x.ConvertedOpportunityId);
    }
    for (const a of apos) a.opp = idq((a.sf_launch && a.sf_launch.oppId) || oppOf.get(String(a.sf_lead_id || "").slice(0, 15)) || "");
    const opps = [...new Set(apos.map((a) => a.opp).filter(Boolean))];
    for (let i = 0; i < opps.length; i += 150) {
      const r = await _sf.query(sfo, `SELECT Id, StageName FROM Opportunity WHERE Id IN ('${opps.slice(i, i + 150).join("','")}')`);
      for (const x of r.records || []) stageOf.set(x.Id.slice(0, 15), x.StageName || "");
    }
  } catch (e) { sfOk = false; sfNote = `SF を読めず、有効商談は数えていません（${String(e.message).slice(0, 80)}）`; }
  const apoBy = new Map();
  for (const a of apos) {
    const s = a.opp ? stageOf.get(a.opp.slice(0, 15)) : null;
    const o = apoBy.get(a.u) || { apo: 0, opp: 0, valid: 0 };
    o.apo++; if (a.opp) o.opp++; if (s != null && isValidStage(s)) o.valid++;
    apoBy.set(a.u, o);
  }
  const sumApo = (arr) => arr.reduce((t, x) => ({ apo: t.apo + x.apo, opp: t.opp + x.opp, valid: t.valid + x.valid }), { apo: 0, opp: 0, valid: 0 });
  // 人の行
  const people = (rep.rows || []).map((r) => {
    const u = String(r.key || "").toLowerCase(); const p = pace.get(u) || {};
    return { u, name: r.label || u, team: teamOf({ email: u, name: r.label }, members) || "", calls: r.calls, reached: r.reached, person: r.person, apo: r.apo,
      hours: p.hours || 0, perHour: p.perHour ?? null, hit: p.hit || 0, full: p.full || 0, gap: p.gap || null, sf: apoBy.get(u) || { apo: 0, opp: 0, valid: 0 } };
  });
  // チームの行（チームの無い人は「チームなし」）
  const teams = new Map();
  for (const p of people) { const k = p.team || ""; if (!teams.has(k)) teams.set(k, []); teams.get(k).push(p); }
  const agg = (arr) => {
    const s = (f) => arr.reduce((a, x) => a + (+x[f] || 0), 0);
    const gn = arr.reduce((a, x) => a + ((x.gap && x.gap.n) || 0), 0), gok = arr.reduce((a, x) => a + ((x.gap && x.gap.ok) || 0), 0);
    const hrs = s("hours"), pc = arr.reduce((a, x) => a + (x.hours ? x.perHour * x.hours : 0), 0);
    return { calls: s("calls"), reached: s("reached"), person: s("person"), apo: s("apo"), perHour: hrs ? Math.round(pc / hrs * 10) / 10 : null, hit: s("hit"), full: s("full"), gapN: gn, gapOk: gok, sf: sumApo(arr.map((x) => x.sf)) };
  };
  const T = rep.total || {}, Pv = rep.prev || {};
  const totPace = (rep.pace && rep.pace.total) || agg(people);
  const all = { ...agg(people), calls: T.calls || 0, reached: T.reached || 0, person: T.person || 0, apo: T.apo || 0 };
  const funnel = (x) => `コール ${fmt(x.calls)} → 到達 ${fmt(x.reached)}（${pct(x.reached, x.calls)}）→ 担当者 ${fmt(x.person)}（${pct(x.person, x.calls)}）→ アポ ${fmt(x.apo)}（${pct(x.apo, x.calls)}）`;
  const paceTxt = (x) => `1時間 ${x.perHour ?? "—"}コール${x.full ? `（${PACE.perHour}に届いた時台 ${pct(x.hit, x.full)}）` : ""}${x.gapN ? `・間隔2分以内 ${pct(x.gapOk, x.gapN)}` : ""}`;
  const validTxt = (s) => (sfOk ? `アポ→有効商談 ${s.valid}/${s.apo}（${pct(s.valid, s.apo)}）` : "");
  const lines = [`📊 *MOCHICALL 先週のまとめ（${md(from)}〜${md(to)}）*`,
    `*全体*：${funnel(all)}`,
    `　前の週：コール ${fmt(Pv.calls)}・担当者 ${fmt(Pv.person)}・アポ ${fmt(Pv.apo)}`,
    `　${paceTxt({ perHour: totPace.perHour, full: totPace.full, hit: totPace.hit, gapN: (totPace.gap && totPace.gap.n) || all.gapN, gapOk: (totPace.gap && totPace.gap.ok) || all.gapOk })}${totPace.gap && totPace.gap.med != null ? `（中央値 ${mmss(totPace.gap.med)}）` : ""}`,
    sfOk ? `　アポ ${all.sf.apo}件 → SF の商談 ${all.sf.opp}件 → 有効商談（02以上） ${all.sf.valid}件（アポの ${pct(all.sf.valid, all.sf.apo)}。商談がまだ無い ${all.sf.apo - all.sf.opp}件）` : `　${sfNote}`,
    `*チーム別*`,
    ...[...teams].sort((a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || a[0].localeCompare(b[0], "ja")).map(([k, arr]) => { const x = agg(arr); return `・${k ? teamLabel(k) : "チームなし"}（${arr.length}人）：${funnel(x)}｜${paceTxt(x)}${sfOk ? `｜${validTxt(x.sf)}` : ""}`; }),
    `*人別*（コールの多い順）`,
    ...people.sort((a, b) => b.calls - a.calls).map((p) => `・${p.name}${p.team ? `（${p.team}）` : ""}：${funnel(p)}｜1時間 ${p.perHour ?? "—"}${p.gap && p.gap.n ? `・2分以内 ${pct(p.gap.ok, p.gap.n)}` : ""}${sfOk && p.sf.apo ? `｜有効 ${p.sf.valid}/${p.sf.apo}` : ""}`),
    `*受付で断られた文句（上位5）*`,
    ...((rep.gateReasons || []).slice(0, 5).map((r, i) => `${i + 1}. ${r.k} ${fmt(r.n)}件`)),
    ...(rep.gateReasons && rep.gateReasons.length ? [] : ["（先週は記録なし）"]),
    `数え方はレポート画面（期間 ${md(from)}〜${md(to)}・全員）と同じです。`];
  return { from, to, text: lines.join("\n"), total: all, teams: [...teams].map(([k, arr]) => ({ team: k, n: arr.length, ...agg(arr) })), people, gateReasons: rep.gateReasons || [], sfOk, sfNote };
}
export async function checkWeekly({ now = NOW() } = {}) {
  const j = J(now);
  if (j.getUTCDay() !== WATCH.weeklyDow || j.getUTCHours() * 60 + j.getUTCMinutes() < WATCH.weeklyAt) return false;
  const day = jstDay(now);
  const st = await getSettings().catch(() => ({}));
  if (st.mcWeeklySent === day) return false;
  await saveSettings({ mcWeeklySent: day }).catch(() => {});   // 先に印を付ける（失敗しても10分ごとに送り直さない）
  const w = await weeklySummary();
  await send("weekly", w.text, [`weekly:${day}`]);
  return true;
}

// ---- 10分ごと ----
let _timer = null, _running = false;
export async function tick() {
  if (!C || _running || !C.P()) return;
  _running = true;
  try {
    const run = async (name, fn) => { try { await fn(); } catch (e) { console.warn(`[mc-watch] ${name}：`, e.message); } };
    if (inCallHours()) {
      await run("SF に書けていない記録", () => checkSfFail());
      await run("SF のつなぎ", () => checkSfConn());
      await run("コールのペース", () => checkPace());
    }
    await run("週次のまとめ", () => checkWeekly());
  } finally { _running = false; }
}

// mccall.js の registerMcCall から呼ぶ（道具を受け取り、10分ごとの見張りを始める）
export function startMcWatch(ctx, { timer = true } = {}) {
  C = ctx;
  if (timer && !_timer && !process.env.MCWATCH_OFF) {
    const first = setTimeout(() => tick(), 2 * 60e3); first.unref?.();
    _timer = setInterval(() => tick(), WATCH.tickMin * 60e3); _timer.unref?.();
  }
}
export function watchState() { return { config: { ...WATCH, lowLine: lowLine(), perHour: PACE.perHour }, log: _log.slice(0, 30), pendingEmpty: [..._empty.values()] }; }
export async function watchRecipients() { return watchTo(); }
// 管理者が画面・API から送るとき（週次のまとめの下見から送る）。同じ知らせのまとめはしない
export async function sendWatch(kind, text) { return send(kind, text, []); }

// 試験だけで使う（偽の Chat・偽の SF に差し替える）
export const _test = {
  setNotify(fn) { _notify = fn; },
  setSf(o) { _sf = { ..._sf, ...o }; },
  setNow(d) { _now = d ? new Date(d).getTime() : null; },
  resetSent() { _sent = new Map(); _log.length = 0; _empty.clear(); _probeAt = 0; },
};
