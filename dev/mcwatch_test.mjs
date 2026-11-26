// MOCHICALL の見張り・週次のまとめ・使われ方の数えを、本物のサーバーと手元のデータベースで通す試験（2026-11-27 福井さん「2週目」）
//
// 何を確かめるか：
//   1. 「かける」が空になったインターン生を、理由つきで管理者に1通にまとめて知らせる（同じ人・理由は1時間に1回。管理者・休みの日は知らせない）
//   2. SF に書けていない記録（件数・書き直し待ち・理由・人別）
//   3. 代理アカウント・運用者の SF のつなぎ（切れた・残り1つ・つなぎ切れのエラー・問い合わせで分かった）
//   4. 1時間17コールを大きく割った時台（mcpace と同じく最初・最後・いまの時台は外す）
//   5. 月曜の週次のまとめ（レポートと同じ数・チーム別・アポ→有効商談・受付の断り文句）
//   6. 使われ方の一覧（画面のボタン・API・監査ログ）
//
// 本番に何も届かないように：DB は PGlite（メモリだけ）。Chat と SF は偽物に差し替え（mcwatch.js の _test）。外への通信は全部断る。
//
// 使い方：node dev/mcwatch_test.mjs   （PGlite はデモ環境の部品。ほかの場所なら MCCALL_TEST_PGLITE=<node_modules のあるフォルダ>）
import net from "node:net";
import { register, createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert/strict";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = 8391, PG_PORT = 18391;

// ---------- 外への通信を断る ----------
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|::1|0\.0\.0\.0)$/i;
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  let o = args[0]; if (Array.isArray(o)) o = o[0];
  let host = "localhost", pipe = false;
  if (o && typeof o === "object") { if (o.path) pipe = true; else host = String(o.host || "localhost"); }
  else if (typeof o === "string" && !/^\d+$/.test(o)) pipe = true;
  else if (typeof args[1] === "string") host = args[1];
  if (pipe || LOCAL.test(host.replace(/^\[|\]$/g, ""))) return origConnect.apply(this, args);
  process.nextTick(() => this.destroy(new Error(`試験のため外部（${host}）にはつなぎません`)));
  return this;
};
const realFetch = globalThis.fetch;
const SEARCH = /(^|\.)(search\.yahoo\.co\.jp|duckduckgo\.com|bing\.com)$/;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (LOCAL.test(url.hostname)) return realFetch(input, init);
  // 企業調査の Web 検索は返事をしない（調べ終わらない会社を作り、「調査中でも出る」ことを確かめる）
  if (SEARCH.test(url.hostname)) return new Promise(() => {});
  throw new TypeError(`試験のため外部（${url.hostname}）にはつなぎません`);
};
const stub = "export const chromium={launch:async()=>{throw new Error('試験ではブラウザを使いません')}};export default {chromium, executablePath: async()=>'', args: []};";
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === "playwright-core" || s === "@sparticuz/chromium") return { url: "data:text/javascript," + encodeURIComponent(${JSON.stringify(stub)}), shortCircuit: true };
  return n(s, c); }`));

// ---------- 環境変数 ----------
// PGlite の場所は、下で MCCALL_ の環境変数を消す前に読んでおく（消したあとに読むと、指定しても効かない）
const PGLITE_DIR = process.env.MCCALL_TEST_PGLITE || "";
for (const k of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|PASSWORD|_URL$|^SF_|^ZOOM|^BALES|^MIITEL|^GOOGLE|^GEMINI|^GROQ|^OPENAI|^ANTHROPIC|^RECALL|^DEEPGRAM|^MUX|^CSP_|^MC_FORM|^DRIVE|^GITHUB|^GH_|^KINBOT|^MCCALL_/i.test(k)) delete process.env[k];
const ADMIN = { email: "kanri@test.local", name: "試験 管理者" };
// 名簿の8名を、わざと名簿と違う書き方で登録する（異体字・姓名の順・空白・添え書き）
const INTERNS = [
  ["mori@test.local", "森 康晴"], ["cho@test.local", "彩娟 趙"], ["shige@test.local", "重永　浩汰"], ["naito@test.local", "内藤 頼郁亜"],
  ["koga@test.local", "小賀坂和也（インターン）"], ["osawa@test.local", "瑛太 大沢"], ["iwa@test.local", "岩浪 大己"], ["adachi@test.local", "足立瞬弥"],
].map(([email, name]) => ({ email, name }));
const OUTSIDER = { email: "yamamoto@test.local", name: "山本 次郎" };
// 名前では名簿に当たらない人（ローマ字の表示名）。メールで登録すると判定される
const ROMAJI = { email: "raia@test.local", name: "Raia Naito" };
const PASS = "test-pass-1";
Object.assign(process.env, {
  PORT: String(PORT), DATABASE_URL: `postgres://postgres@127.0.0.1:${PG_PORT}/postgres?sslmode=disable`,
  SESSION_SECRET: "test-session-secret", RECALL_API_KEY: "dummy", GEMINI_API_KEY: "dummy",
  MCCALL_ADMIN_EMAILS: ADMIN.email, PUBLIC_URL: `http://localhost:${PORT}`,
  MCCALL_RESEARCH_DAILY: "1200", MCCALL_RESEARCH_CONC: "1", MCWATCH_OFF: "1",
});

// ---------- 手元のデータベース（PGlite・メモリの中だけ） ----------
const pgDir = PGLITE_DIR || path.join(HERE, "demo");
let PGlite, PGLiteSocketServer;
try {
  const req = createRequire(path.join(pgDir, "package.json"));
  ({ PGlite } = await import(pathToFileURL(req.resolve("@electric-sql/pglite")).href));
  ({ PGLiteSocketServer } = await import(pathToFileURL(req.resolve("@electric-sql/pglite-socket")).href));
} catch {
  console.error(`PGlite が見つかりません（${pgDir}）。先に  cd dev/demo && npm install  を実行するか、MCCALL_TEST_PGLITE で場所を教えてください。`);
  process.exit(2);
}
const db = await PGlite.create();
const pgs = new PGLiteSocketServer({ db, port: PG_PORT, host: "127.0.0.1", maxConnections: 40 });
await pgs.start();

// ---------- 本物のサーバーを起動 ----------
process.chdir(ROOT);
process.env.DOTENV_CONFIG_PATH = path.join(HERE, ".env-試験では読まない");
const quiet = console.log; console.log = () => {};   // サーバーの起動ログは試験の結果を読みにくくするので止める
await import(pathToFileURL(path.join(ROOT, "server", "index.js")).href);
const base = `http://localhost:${PORT}`;
for (let i = 0; i < 120; i++) { try { if ((await realFetch(`${base}/healthz`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
await new Promise((r) => setTimeout(r, 3000));
console.log = quiet;
const pg = (await import("pg")).default;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const q = (s, p) => pool.query(s, p);

// ---------- 呼び出しの道具 ----------
const jar = {};
async function call(who, method, url, body) {
  const r = await realFetch(base + url, { method, headers: { "content-type": "application/json", cookie: jar[who] || "" }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie"); if (sc) jar[who] = sc.split(";")[0];
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 200) }; }
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${t.slice(0, 300)}`);
  return j;
}
let n = 0, failed = 0;
async function t(name, fn) {
  try { await fn(); n++; console.log(`ok  ${name}`); }
  catch (e) { failed++; console.log(`NG  ${name}\n    ${e.message.split("\n").join("\n    ")}`); }
}


// ---------- 見張りを偽の Chat・偽の SF に差し替える（本物の Chat・SF には何も送らない） ----------
const W = await import(pathToFileURL(path.join(ROOT, "server", "mcwatch.js")).href);
const sent = [];
W._test.setNotify(async (to, text) => { sent.push({ to, text }); return { ok: true }; });
const SF_DEAD = new Set(); const SF_THROW = new Map(); const sfCalls = [];
const LEAD_OPP = { "00Q000000000001AAA": "006000000000001AAA" }, OPP_STAGE = { "006000000000001": "SS02：有効商談(3ヶ月以内検討)" };
W._test.setSf({
  isConnected: async (e) => !SF_DEAD.has(e), deadOwners: () => [...SF_DEAD].map((owner) => ({ owner })),
  query: async (owner, soql) => {
    sfCalls.push(soql);
    if (SF_THROW.has(owner)) throw SF_THROW.get(owner);
    const ids = [...soql.matchAll(/'([A-Za-z0-9]{15,18})'/g)].map((m) => m[1]);
    if (/FROM Lead/.test(soql)) return { records: ids.map((Id) => ({ Id, ConvertedOpportunityId: LEAD_OPP[Id] || null })) };
    if (/FROM Opportunity/.test(soql)) return { records: ids.map((Id) => ({ Id, StageName: OPP_STAGE[Id.slice(0, 15)] || "SS01：初回商談" })) };
    return { records: [{ Id: "005000000000001" }] };
  },
});
const lastText = () => (sent.length ? sent[sent.length - 1].text : "");
const jt = (s) => new Date(s + "+09:00");

// ---------- 準備：人・リスト ----------
for (const u of [ADMIN, ...INTERNS]) await call(u.email, "POST", "/api/register", { email: u.email, password: PASS, displayName: u.name });
const A = ADMIN.email, I1 = INTERNS[0].email, I2 = INTERNS[3].email, I3 = INTERNS[2].email;
const L1 = (await call(A, "POST", "/api/mccall/lists", { name: "見張りの試験リスト", members: [] })).id;
await call(A, "POST", `/api/mccall/lists/${L1}/from-csv`, { rows: Array.from({ length: 4 }, (_, i) => ({ company: `株式会社 見張り${i + 1}`, phone: `03-0000-91${String(i).padStart(2, "0")}`, person: "担当" })) });
await call(A, "PUT", `/api/mccall/lists/${L1}/talks`, { talks: [{ label: "A", body: "試験のトーク" }] });
const ids = (await q(`SELECT id FROM mc_call_leads WHERE list_id=$1 ORDER BY id`, [L1])).rows.map((r) => r.id);
await q(`UPDATE mc_call_leads SET sf_lead_id = CASE WHEN id=$1 THEN '00Q000000000001AAA' WHEN id=$2 THEN '00Q000000000002AAA' END WHERE id = ANY($3)`, [ids[0], ids[1], ids.slice(0, 2)]);
await q(`UPDATE settings SET data = data || $1::jsonb WHERE id=1`, [JSON.stringify({ mcWatchTo: A, sfProxyUser: "proxy@test.local", apoScanOwner: "op@test.local" })]);
async function addLog(caller, at, o = {}) {
  await q(`INSERT INTO mc_call_logs (lead_id, list_id, caller, reach, outcome, reason, created_at, dialed_at, sf_task_id, sf_err) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [o.lead || ids[3], L1, caller, o.reach || "none", o.outcome || "no_answer", o.reason || null, at, o.dialed || at, o.task === undefined ? "00T000000000001" : o.task, o.err || null]);
}

await t("純粋な判定：空の理由・時台の判定・有効商談・SF のエラーのまとめ", async () => {
  assert.equal(W.emptyReason({ items: [{ id: 1 }] }), null);
  assert.equal(W.emptyReason({ items: [], stop: "ban" }).kind, "ban");
  assert.equal(W.emptyReason({ items: [], why: { kind: "notIntern", name: "山本" } }).kind, "judge");
  assert.equal(W.emptyReason({ items: [], noTalk: ["X"] }).kind, "talk");
  assert.equal(W.emptyReason({ items: [], why: { others: 5, todayOthers: 2 } }).kind, "owner");
  assert.equal(W.emptyReason({ items: [], why: { held: 3 } }).kind, "judge");
  assert.equal(W.emptyReason({ items: [], today: { left: 0, wait: 4 } }).kind, "done");
  assert.equal(W.emptyReason({ items: [] }).kind, "none");
  // 最初と最後の時台・いまの時台は数えない。10本以下が「大きく割っている」
  const s = W.slowHours([{ u: "a", h: 9, n: 3 }, { u: "a", h: 10, n: 10 }, { u: "a", h: 11, n: 11 }, { u: "a", h: 12, n: 4 }, { u: "a", h: 13, n: 2 }, { u: "b", h: 10, n: 2 }, { u: "b", h: 11, n: 2 }], 13);
  assert.deepEqual(s.map((x) => `${x.u}${x.h}`), ["a10", "a12"]);
  assert.ok(W.isValidStage("SS02：有効商談(3ヶ月以内検討)") && W.isValidStage("03：担当者合意") && W.isValidStage("受注処理完了"));
  assert.ok(!W.isValidStage("SS01：初回商談") && !W.isValidStage("失注") && !W.isValidStage(""));
  assert.match(W.sfErrKey("SF refresh 400: invalid_grant expired"), /つなぎが切れている/);
  assert.equal(W.sfErrKey("x 00Q000000000001AAA 12"), W.sfErrKey("x 00Q000000000009ZZZ 99"));
});

// 平日の架電時間（水曜 15:00）に「いま」を合わせる
W._test.setNow(jt("2026-12-02T15:00:00")); W._test.resetSent(); sent.length = 0;

await t("「かける」が空になったインターン生：理由（担当）つきで1通にまとめて知らせる・同じ理由は1時間に1回", async () => {
  await q(`UPDATE mc_call_leads SET assigned_to=$2 WHERE list_id=$1`, [L1, I1]);
  const j = await call(I2, "GET", "/api/mccall/queue");
  assert.equal(j.items.length, 0);
  await call(INTERNS[4].email, "GET", "/api/mccall/queue");
  await new Promise((r) => setTimeout(r, 800));
  assert.equal(await W.flushEmpty(), true);
  assert.equal(sent.length, 1, "2人分が1通にまとまる");
  assert.match(lastText(), /「かける」が空/); assert.match(lastText(), /内藤/); assert.match(lastText(), /小賀坂/); assert.match(lastText(), /【担当】残り 4件はほかの人の担当/);
  assert.equal(sent[0].to, A);
  await call(I2, "GET", "/api/mccall/queue"); await new Promise((r) => setTimeout(r, 500));
  assert.equal(await W.flushEmpty(), false, "同じ人・同じ理由は送らない");
  assert.equal(sent.length, 1);
  await q(`UPDATE mc_call_leads SET assigned_to=NULL WHERE list_id=$1`, [L1]);
});
await t("管理者・リストを選んで開いたときは知らせない／架電時間の外も知らせない", async () => {
  await q(`UPDATE mc_call_leads SET assigned_to=$2 WHERE list_id=$1`, [L1, I1]);
  await call(A, "GET", "/api/mccall/queue"); await call(INTERNS[5].email, "GET", `/api/mccall/queue?list=${L1}`);
  W._test.setNow(jt("2026-12-05T15:00:00"));   // 土曜
  await call(INTERNS[6].email, "GET", "/api/mccall/queue");
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(await W.flushEmpty(), false); assert.equal(sent.length, 1);
  W._test.setNow(jt("2026-12-02T15:00:00"));
  await q(`UPDATE mc_call_leads SET assigned_to=NULL WHERE list_id=$1`, [L1]);
});
await t("SF に書けていない記録：件数・書き直し待ち・理由・人別。増えないうちは送らない", async () => {
  const n0 = sent.length;
  await addLog(I1, jt("2026-12-02T10:05:00"), { task: null, err: "SF task 400 CANNOT_EXECUTE_FLOW_TRIGGER FIELD_CUSTOM_VALIDATION_EXCEPTION: SS02に上げるには初回商談対応者の入力が必要です" });
  await addLog(I1, jt("2026-12-02T10:06:00"), { task: null, err: "SF refresh 400: invalid_grant" });
  await addLog(I2, jt("2026-12-02T10:07:00"), { task: null, err: "SF refresh 400: invalid_grant" });
  const r = await W.checkSfFail();
  assert.equal(r.fail, 3); assert.equal(r.pend, 3);
  assert.equal(sent.length, n0 + 1);
  assert.match(lastText(), /SF の活動に書けていない 3件・「SF に書き直す」待ち 3件/); assert.match(lastText(), /つなぎが切れている（連携し直しが必要） 2件/); assert.match(lastText(), /森.*2/);
  await W.checkSfFail(); assert.equal(sent.length, n0 + 1, "同じ件数なら送らない");
});
await t("代理アカウント・運用者の SF のつなぎ：切れた・残り1つ・つなぎ切れのエラーを知らせる。問い合わせで切れたと分かったら知らせる", async () => {
  const n0 = sent.length;
  SF_DEAD.add("proxy@test.local");
  await addLog(I1, jt("2026-12-02T14:50:00"), { task: null, err: "SF refresh 400: invalid_grant" });   // 直近1時間（10:0x の2件は数えない）
  const r = await W.checkSfConn({ probe: false });
  assert.equal(r.items.find((x) => x.email === "proxy@test.local").state, "dead");
  assert.equal(sent.length, n0 + 1);
  assert.match(lastText(), /proxy@test\.local（代理アカウント）：切れています/); assert.match(lastText(), /1つだけ/); assert.match(lastText(), /つなぎ切れのエラーで SF に書けなかった記録が 1件/);
  await W.checkSfConn({ probe: false }); assert.equal(sent.length, n0 + 1, "同じ内容は3時間に1回");
  SF_DEAD.clear(); const e = new Error("SF refresh 400: invalid_grant"); e.sfReauth = true; SF_THROW.set("op@test.local", e);
  const c0 = sfCalls.length;
  const r2 = await W.checkSfConn({ probe: true });
  assert.equal(sfCalls.length - c0, 2, "問い合わせは代理と運用者で2回");
  assert.equal(r2.items.find((x) => x.email === "op@test.local").state, "dead");
  assert.equal(sent.length, n0 + 2); assert.match(lastText(), /op@test\.local（運用者）：切れています/);
  SF_THROW.clear();
});
await t("1時間17コールを大きく割った時台：mcpace と同じく最初・最後・いまの時台は外す。同じ時台は1回", async () => {
  const n0 = sent.length;
  const put = async (h, n) => { for (let i = 0; i < n; i++) await addLog(I3, jt(`2026-12-02T${h}:${String(i * 3).padStart(2, "0")}:30`), { dialed: jt(`2026-12-02T${h}:${String(i * 3).padStart(2, "0")}:10`) }); };
  await put(10, 17); await put(11, 5); await put(12, 17); await put(13, 3);
  const r = await W.checkPace();
  const mine = r.slow.filter((x) => x.u === I3);
  assert.deepEqual(mine.map((x) => x.h), [11]);
  assert.equal(sent.length, n0 + 1);
  assert.match(lastText(), /重永.*11時台 5コール／17（前の時台 17・次の時台 17）/);
  assert.doesNotMatch(lastText(), /13時台/);
  await W.checkPace(); assert.equal(sent.length, n0 + 1);
});
await t("週次のまとめ：月曜8:30に1回だけ。レポートと同じ数・チーム別・アポ→有効商談・受付の断り文句", async () => {
  // 先週（11/30〜12/06）に、森さんのアポ2件（1件は SF で有効商談）と受付の断り
  await addLog(I1, jt("2026-12-01T11:00:00"), { lead: ids[0], reach: "person", outcome: "apo" });
  await addLog(I1, jt("2026-12-01T11:10:00"), { lead: ids[1], reach: "person", outcome: "apo" });
  for (let i = 0; i < 3; i++) await addLog(I2, jt(`2026-12-01T13:0${i}:00`), { reach: "gate", outcome: "blocked", reason: "営業電話はお断り" });
  await addLog(I2, jt("2026-12-01T13:10:00"), { reach: "gate", outcome: "blocked", reason: "資料をメールで送って" });
  const n0 = sent.length;
  W._test.setNow(jt("2026-12-07T08:20:00")); assert.equal(await W.checkWeekly(), false, "8:30 より前は送らない");
  W._test.setNow(jt("2026-12-07T08:31:00")); assert.equal(await W.checkWeekly(), true);
  assert.equal(await W.checkWeekly(), false, "同じ月曜は1回だけ");
  assert.equal(sent.length, n0 + 1);
  const text = lastText();
  const rep = await call(A, "GET", "/api/mccall/report?from=2026-11-30&to=2026-12-06&by=user");
  assert.match(text, /先週のまとめ（11\/30〜12\/6）/);
  assert.match(text, new RegExp(`\\*全体\\*：コール ${rep.total.calls.toLocaleString("ja-JP")} → 到達 ${rep.total.reached}.*担当者 ${rep.total.person}.*アポ ${rep.total.apo}`));
  assert.match(text, /アポ 2件 → SF の商談 1件 → 有効商談（02以上） 1件/);
  assert.match(text, /餌取チーム/); assert.match(text, /森.*有効 1\/2/);
  assert.match(text, /1\. 営業電話はお断り 3件/); assert.match(text, /2\. 資料をメールで送って 1件/);
  console.log("---- 週次のまとめ（試験の中身） ----\n" + text + "\n------------------------------------");
  // 管理者の下見 API（送らない）
  const w = await call(A, "POST", "/api/mccall/watch/weekly", { week: "2026-11-30" });
  assert.equal(w.sent, false); assert.equal(w.text, text);
  W._test.setNow(jt("2026-12-02T15:00:00"));
});
await t("管理者の見張りの様子：/api/mccall/watch（インターン生は見られない）", async () => {
  const j = await call(A, "GET", "/api/mccall/watch");
  assert.ok(j.log.length >= 5 && j.config.lowLine === 11 && j.to.includes(A));
  await assert.rejects(call(I1, "GET", "/api/mccall/watch"));
});
await t("使われ方：画面のボタンの回数・API の回数・監査ログから、使われていない候補を出す（何も消さない）", async () => {
  await call(I1, "POST", "/api/mccall/ui-usage", { items: [{ k: "[data-t=report]", l: "レポート", c: 2, s: 1 }, { k: "[data-t=insight]", l: "数字", c: 0, s: 3 }, { k: "", c: 1 }] });
  await call(I2, "POST", "/api/mccall/ui-usage", { items: [{ k: "[data-t=insight]", l: "数字", c: 0, s: 1 }] });
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const j = await call(A, "GET", `/api/mccall/usage?from=2026-11-01&to=${today}`);
  assert.ok(j.candidates.uiNever.some((x) => x.key === "[data-t=insight]" && x.shown === 4 && x.saw === 2));
  assert.ok(j.candidates.uiRare.some((x) => x.key === "[data-t=report]" && x.clicks === 2));
  const qrow = j.api.find((x) => x.route === "GET /api/mccall/queue"); assert.ok(qrow && qrow.calls >= 3 && qrow.users >= 2, JSON.stringify(qrow));
  const csv = j.api.find((x) => x.route === "POST /api/mccall/lists/:id/from-csv"); assert.ok(csv && csv.audit >= 1, JSON.stringify(csv));
  assert.ok(j.candidates.apiNever.length > 10 && !j.candidates.apiNever.includes("GET /api/mccall/queue"));
  assert.equal(+(await q(`SELECT count(*) FROM mc_audit_log WHERE path='/api/mccall/ui-usage'`)).rows[0].count, 0, "ボタンの回数の送信は監査ログに残さない");
  await assert.rejects(call(I1, "GET", "/api/mccall/usage"));
  console.log(`---- 使われ方の候補（試験）：一度も呼ばれていない道 ${j.candidates.apiNever.length}本・押されていないボタン ${j.candidates.uiNever.length}個`);
});

console.log(`\n${failed ? `${failed} 件 失敗` : "すべて通りました"}（通った ${n} 件）`);
await pool.end().catch(() => {});
process.exit(failed ? 1 : 0);
