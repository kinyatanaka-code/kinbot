// MOCHICALL の「かける → 記録 → 次の会社 → 取り消し」を、本物のサーバーと手元のデータベースで通す試験（2026-11-23 福井さん「初週を止めずに回す」）
//
// 何を確かめるか：
//   1. 名簿のインサイド8名が、名前の書き方（異体字・姓名の順・空白）が違っても MOCHICA のインターンと判定され、「かける」に会社が出る
//   2. 「かける」が空になる理由（インターンと判定されない・トークが無い・残りはほかの人の担当・アプローチ禁止の名簿が読めない）が返る
//   3. 企業調査が済んでいない会社も、調べ終わった会社のあとに並んで出る（調べ待ちで「かける」が止まらない）
//   4. 開く → 記録 → 次の会社 → 取り消し で、リードの状態が正しく変わり、ほかの人の順番から外れる・戻る
//   5. 管理者の「インサイドの『かける』の状態」が8名を正しく返す
//
// 本番に何も届かないように：
//   データベースは手元の PGlite（メモリの中だけ）。外への通信は Node の入口で全部断る（Web 検索は返事をしないまま待たせる＝企業調査が終わらない状態を作る）。
//   鍵の入った環境変数は消し、.env も読ませない。SF にはつながない（記録は kinbot にだけ残る）。
//
// 使い方：
//   PGlite はデモ環境（dev/demo）の部品を借りる。初回だけ  cd dev/demo && npm install
//   node dev/mccall_flow_test.mjs   （1〜2分。アプローチ禁止の名簿が読めない場合を試すのに60秒待つ）
//   ほかの場所の PGlite を使うときは  MCCALL_TEST_PGLITE=<node_modules のあるフォルダ>
import net from "node:net";
import { register, createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert/strict";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = 8390, PG_PORT = 18390;

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
for (const k of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|PASSWORD|_URL$|^SF_|^ZOOM|^BALES|^MIITEL|^GOOGLE|^GEMINI|^GROQ|^OPENAI|^ANTHROPIC|^RECALL|^DEEPGRAM|^MUX|^CSP_|^MC_FORM|^DRIVE|^GITHUB|^GH_|^KINBOT|^MCCALL_/i.test(k)) delete process.env[k];
const ADMIN = { email: "kanri@test.local", name: "試験 管理者" };
// 名簿の8名を、わざと名簿と違う書き方で登録する（異体字・姓名の順・空白・添え書き）
const INTERNS = [
  ["mori@test.local", "森 康晴"], ["cho@test.local", "彩娟 趙"], ["shige@test.local", "重永　浩汰"], ["naito@test.local", "内藤 頼郁亜"],
  ["koga@test.local", "小賀坂和也（インターン）"], ["osawa@test.local", "瑛太 大沢"], ["iwa@test.local", "岩浪 大己"], ["adachi@test.local", "足立瞬弥"],
].map(([email, name]) => ({ email, name }));
const OUTSIDER = { email: "yamamoto@test.local", name: "山本 次郎" };
const PASS = "test-pass-1";
Object.assign(process.env, {
  PORT: String(PORT), DATABASE_URL: `postgres://postgres@127.0.0.1:${PG_PORT}/postgres?sslmode=disable`,
  SESSION_SECRET: "test-session-secret", RECALL_API_KEY: "dummy", GEMINI_API_KEY: "dummy",
  MCCALL_ADMIN_EMAILS: ADMIN.email, PUBLIC_URL: `http://localhost:${PORT}`,
  MCCALL_RESEARCH_DAILY: "1200", MCCALL_RESEARCH_CONC: "1",
});

// ---------- 手元のデータベース（PGlite・メモリの中だけ） ----------
const pgDir = process.env.MCCALL_TEST_PGLITE || path.join(HERE, "demo");
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

// ---------- 準備：人・リスト ----------
for (const u of [ADMIN, ...INTERNS, OUTSIDER]) await call(u.email, "POST", "/api/register", { email: u.email, password: PASS, displayName: u.name });
const A = ADMIN.email, I1 = INTERNS[0].email, I2 = INTERNS[3].email;
let L1, TALK;

await t("インターンと判定されない人：理由（notIntern）と自分の名前が返る", async () => {
  await call(A, "POST", "/api/mccall/lists", { name: "試験リスト", members: [] }).then((j) => { L1 = j.id; });
  const j = await call(OUTSIDER.email, "GET", "/api/mccall/queue");
  assert.equal(j.items.length, 0); assert.equal(j.why && j.why.kind, "notIntern"); assert.equal(j.why.name, OUTSIDER.name);
});
await t("トークの無いリストは出ず、リストの名前が返る（noTalk）", async () => {
  await call(A, "POST", `/api/mccall/lists/${L1}/from-csv`, { rows: Array.from({ length: 6 }, (_, i) => ({ company: `株式会社 試験${i + 1}`, phone: `03-0000-90${String(i).padStart(2, "0")}`, person: "担当" })) });
  const j = await call(I1, "GET", "/api/mccall/queue");
  assert.equal(j.items.length, 0); assert.deepEqual(j.noTalk, ["試験リスト"]);
});
await call(A, "PUT", `/api/mccall/lists/${L1}/talks`, { talks: [{ label: "A", body: "試験のトーク" }] });
// 6社のうち2社だけ企業調査を済ませる（残り4社は調べ中のまま＝Web 検索が返事をしない）
const ids = (await q(`SELECT id FROM mc_call_leads WHERE list_id=$1 ORDER BY id`, [L1])).rows.map((r) => r.id);
await q(`UPDATE mc_call_leads SET research_at=NULL, research=NULL WHERE list_id=$1`, [L1]);
await q(`UPDATE mc_call_leads SET research='{"status":"ok","biz":"試験"}', research_at=now() WHERE id = ANY($1)`, [ids.slice(4)]);

await t("名簿の8名全員（名前の書き方が違っても）MOCHICA のインターンと判定され、「かける」に会社が出る", async () => {
  for (const u of INTERNS) { const j = await call(u.email, "GET", "/api/mccall/queue"); assert.ok(j.items.length > 0, `${u.name}：かけるに会社が出ない（${JSON.stringify(j.why || j.noTalk)}）`); }
});
await t("企業調査が済んでいない会社も出る。調べ終わった会社が先、調査中の会社が後ろ", async () => {
  const j = await call(I1, "GET", "/api/mccall/queue");
  assert.equal(j.items.length, 6, "6社とも出る");
  assert.deepEqual(j.items.slice(0, 2).map((x) => x.id).sort(), ids.slice(4).sort(), "調べ終わった2社が先");
  assert.ok(j.items.slice(2).every((x) => x.researched === false), "後ろの4社は調査中の印");
  assert.ok(j.researching >= 1, "調べている数を返す");
});
await t("管理者の「インサイドの『かける』の状態」：8名とも判定済み・今かけられる6件。名簿の外の人は出ない", async () => {
  const j = await call(A, "GET", "/api/mccall/readiness");
  const roster = j.items.filter((x) => x.roster);
  assert.equal(roster.length, 8, JSON.stringify(j.items.map((x) => x.name)));
  for (const x of roster) { assert.ok(x.email && x.intern, `${x.name} が判定されていない`); assert.equal(x.now, 6, x.name); assert.notEqual(x.level, "stop", `${x.name}：${x.msg}`); }
  assert.ok(!j.items.some((x) => x.email === OUTSIDER.email)); assert.equal(j.banOk, true);
});
let first, logId;
await t("開く → ほかの人の順番から外れる", async () => {
  first = (await call(I1, "GET", "/api/mccall/queue")).items[0].id;
  const d = await call(I1, "GET", `/api/mccall/leads/${first}?lock=1`);
  assert.equal(d.lead.id, first); TALK = d.talk && d.talk.id;
  const other = await call(I2, "GET", "/api/mccall/queue");
  assert.ok(!other.items.some((x) => x.id === first), "開いた会社がほかの人の「かける」に出ている");
});
await t("記録（応答なし）→ 自動の掛け直しが付き、次の会社が先頭になる", async () => {
  const r = await call(I1, "POST", `/api/mccall/leads/${first}/log`, { reach: "none", outcome: "no_answer", talkId: TALK, sfPick: {} });
  logId = r.logId; assert.ok(logId, "記録の番号が返る");
  const L = (await q(`SELECT attempts, next_at, last_outcome, locked_by FROM mc_call_leads WHERE id=$1`, [first])).rows[0];
  assert.equal(L.attempts, 1); assert.equal(L.last_outcome, "no_answer"); assert.ok(L.next_at && new Date(L.next_at) > new Date(), "掛け直しの時刻が先にある"); assert.equal(L.locked_by, null);
  const j = await call(I1, "GET", "/api/mccall/queue");
  assert.ok(j.items.length === 5 && !j.items.some((x) => x.id === first), "記録した会社は今日の「かける」から外れる");
});
await t("取り消し → 記録が消え、会社が「かける」に戻る", async () => {
  await call(I1, "POST", `/api/mccall/logs/${logId}/undo`);
  const L = (await q(`SELECT attempts, next_at FROM mc_call_leads WHERE id=$1`, [first])).rows[0];
  assert.equal(L.attempts, 0); assert.equal(L.next_at, null);
  assert.equal((await q(`SELECT undone FROM mc_call_logs WHERE id=$1`, [logId])).rows[0].undone, true);
  await call(I1, "POST", `/api/mccall/leads/${first}/release`);
  const j = await call(I1, "GET", "/api/mccall/queue");
  assert.ok(j.items.some((x) => x.id === first), "取り消した会社が戻っていない");
});
await t("ほかの人の取り消しはできない（本人だけ）", async () => {
  const r = await call(I1, "POST", `/api/mccall/leads/${first}/log`, { reach: "none", outcome: "busy", talkId: TALK, sfPick: {} });
  await assert.rejects(call(I2, "POST", `/api/mccall/logs/${r.logId}/undo`));
  await call(I1, "POST", `/api/mccall/logs/${r.logId}/undo`);
});
await t("残りがほかの人の担当だけ：空の理由（others）に件数が返る", async () => {
  await q(`UPDATE mc_call_leads SET assigned_to=$2, locked_by=NULL WHERE list_id=$1`, [L1, I1]);
  const j = await call(I2, "GET", "/api/mccall/queue");
  assert.equal(j.items.length, 0); assert.equal(j.why && j.why.others, 6);
  const r = await call(A, "GET", "/api/mccall/readiness");
  const x = r.items.find((y) => y.email === I2); assert.equal(x.level, "stop"); assert.match(x.msg, /ほかの人の担当/);
  await q(`UPDATE mc_call_leads SET assigned_to=NULL WHERE list_id=$1`, [L1]);
});
await t("アプローチ禁止の名簿が読めない：エラーにせず、止めている理由（stop=ban）を返す", async () => {
  await q(`ALTER TABLE approach_bans RENAME TO approach_bans_test_off`);
  try {
    await new Promise((r) => setTimeout(r, 61000));   // 名簿は60秒覚えているので、読み直すまで待つ
    const j = await call(I1, "GET", "/api/mccall/queue");
    assert.equal(j.items.length, 0); assert.equal(j.stop, "ban");
    const r = await call(A, "GET", "/api/mccall/readiness"); assert.equal(r.banOk, false);
  } finally { await q(`ALTER TABLE approach_bans_test_off RENAME TO approach_bans`); }
});

console.log(`\n${failed ? `${failed} 件 失敗` : "すべて通りました"}（通った ${n} 件）`);
await pool.end().catch(() => {});
process.exit(failed ? 1 : 0);
