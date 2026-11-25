// BALES の見張りで届いた架電が、リスト（mochica_bales_rows）と MOCHICALL の「かける」の順番に入るかの試験（2026-11-25 福井さん）
//
// 何を確かめるか：
//   1. 見張りの新しい架電は、取り込んだリストの同じリードの最終架電・結果・次回アクションを書き換える（所有者は変えない・古い架電では戻さない）
//   2. アポ・お断り → 終わり／不在 → 同じ日の2時間後／次回アクションの予約 → その日時（約束）／話せた → 今日はもうかけない
//   3. 今だれかが開いているリード・MOCHICALL の記録のほうが新しいリードは動かさない。2回動かしても二重に数えない
//
// 使い方：PGlite の場所を MCCALL_TEST_PGLITE で教える（dev/mccall_flow_test.mjs と同じ）
//   MCCALL_TEST_PGLITE=<@electric-sql/pglite と pglite-socket を入れたフォルダ> node dev/mcbales_feed_test.mjs
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PG_PORT = 18397;
const pgDir = process.env.MCCALL_TEST_PGLITE || path.join(HERE, "demo");
for (const k of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|PASSWORD|_URL$|^SF_|^BALES|^ZOOM/.test(k)) delete process.env[k];
Object.assign(process.env, { DATABASE_URL: `postgres://postgres@127.0.0.1:${PG_PORT}/postgres?sslmode=disable`, SESSION_SECRET: "t", RECALL_API_KEY: "dummy", GEMINI_API_KEY: "dummy" });

const req = createRequire(path.join(pgDir, "package.json"));
const { PGlite } = await import(pathToFileURL(req.resolve("@electric-sql/pglite")).href);
const { PGLiteSocketServer } = await import(pathToFileURL(req.resolve("@electric-sql/pglite-socket")).href);
const pgl = await PGlite.create();
const srv = new PGLiteSocketServer({ db: pgl, port: PG_PORT, host: "127.0.0.1" }); await srv.start();

const db = await import("../server/db.js");
await db.initDb();
const { applyBalesCalls } = await import("../server/mccall.js");
const P = db.dbPool();

// その場の時刻で作る（24時間より前の架電は入れない決まりなので）。日本時間の「…+09:00」の形
const jstIso = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 19) + "+09:00";
const now = Date.now();
const H = 3600e3;
// 今日の日本時間10時（不在の2時間後が今日に収まる時刻）。今が10時より前なら前の日の10時
const d0 = new Date(now + 9 * H); d0.setUTCHours(1, 0, 0, 0);
let ten = d0.getTime(); if (ten > now) ten -= 24 * H;
const old = jstIso(ten - 5 * H), t1 = jstIso(ten);

await db.mcFeedApply([{ d: {} }]);   // 表を作る（中身の無い行なので何も写さない）
const run = new Date().toISOString();
await P.query(`INSERT INTO mochica_bales_lists (list_key, name, src, status, run_at) VALUES ('bales:t', '試験', 'bales', 'done', $1)`, [run]);
const leads = [["a1", "アポ獲得"], ["a2", "担当者不在"], ["a3", "担当者接続"], ["a4", "担当者接続"], ["a5", "担当者不在"], ["a6", "担当者不在"], ["a7", "担当者お断り"], ["a8", "担当者接続"]];
for (const [k] of leads) await P.query(`INSERT INTO mochica_bales_rows (list_key, row_key, data, run_at) VALUES ('bales:t', $1, $2, $3)`,
  [k, { callTargetId: k, companyName: `会社${k}`, operatorName: "元の所有者", lastCalledAt: old, callResult: "不在", "nextActions.0.id": "z", "nextActions.0.reservedAt": jstIso(ten + 72 * H), "nextActions.0.isDone": "false" }, run]);

// 1. 見張りの行を写す
//   見張りの行は、リード一覧の1行まるごと（会社名あり）。a8 だけ一部の項目だけの行
const feed = leads.map(([k, res]) => ({ k: `${k}@${t1}`, d: { callTargetId: k, ...(k === "a8" ? {} : { companyName: `会社${k}` }), operatorName: "見張りの所有者", lastCalledAt: t1, callResult: res,
  ...(k === "a4" ? { "nextActions.0.id": "n", "nextActions.0.reservedAt": jstIso(ten + 30 * H), "nextActions.0.isDone": "false" } : {}) } }));
let a = await db.mcFeedApply(feed);
assert.equal(a.n, 8, "8件とも写る");
let r = (await P.query(`SELECT data FROM mochica_bales_rows WHERE row_key='a4'`)).rows[0].data;
assert.equal(r.lastCalledAt, t1); assert.equal(r.callResult, "担当者接続"); assert.equal(r.operatorName, "元の所有者", "所有者は変えない");
assert.equal(r["nextActions.0.id"], "n", "次回アクションは見張りの行で入れ替わる");
r = (await P.query(`SELECT data FROM mochica_bales_rows WHERE row_key='a3'`)).rows[0].data;
assert.equal(r["nextActions.0.id"], undefined, "1行まるごとで次回アクションが無い＝予約が無くなったので消す");
r = (await P.query(`SELECT data FROM mochica_bales_rows WHERE row_key='a8'`)).rows[0].data;
assert.equal(r["nextActions.0.id"], "z", "一部の項目だけの行なら、次回アクションは前のまま");
a = await db.mcFeedApply([{ k: "x", d: { callTargetId: "a1", lastCalledAt: old, callResult: "不在" } }]);
assert.equal(a.n, 0, "古い架電では戻さない");

// 2. MOCHICALL のリード
await applyBalesCalls();   // 表を作る（まだリードが無いので何もしない）
const list = (await P.query(`INSERT INTO mc_call_lists (name, members, created_by) VALUES ('試験', '{}', 't') RETURNING id`)).rows[0].id;
const ids = {};
for (const [k] of leads) ids[k] = (await P.query(`INSERT INTO mc_call_leads (list_id, src, src_key, company, miss_streak) VALUES ($1, 'bales', $2, $3, 1) RETURNING id`, [list, `bales:t|${k}`, `会社${k}`])).rows[0].id;
await P.query(`UPDATE mc_call_leads SET locked_by='someone', locked_at=now() WHERE id=$1`, [ids.a5]);                       // 今開いている
await P.query(`UPDATE mc_call_leads SET last_at=$2 WHERE id=$1`, [ids.a6, new Date(Date.parse(t1) + 60e3)]);          // MOCHICALL の記録のほうが新しい
const out = await applyBalesCalls();
assert.deepEqual({ final: out.final, promise: out.promise, miss: out.miss, other: out.other, skip: out.skip, busy: out.busy }, { final: 2, promise: 2, miss: 1, other: 1, skip: 1, busy: 1 });
const L = async (k) => (await P.query(`SELECT done, next_at, next_why, miss_streak, attempts, bales_seen FROM mc_call_leads WHERE id=$1`, [ids[k]])).rows[0];
assert.equal((await L("a1")).done, true, "アポは終わり"); assert.equal((await L("a7")).done, true, "お断りは終わり");
let x = await L("a2"); assert.equal(x.done, false); assert.equal(new Date(x.next_at).getTime(), Date.parse(t1) + 2 * H, "不在は2時間後"); assert.equal(x.miss_streak, 2); assert.equal(x.attempts, 1);
x = await L("a4"); assert.equal(new Date(x.next_at).getTime(), ten + 30 * H, "次回アクションの日時"); assert.equal(x.next_why, "記録した人が決めた時刻");
x = await L("a8"); assert.equal(new Date(x.next_at).getTime(), ten + 72 * H, "残った予約の日時");
x = await L("a3"); assert.ok(new Date(x.next_at).getTime() > Date.parse(t1) + 12 * H, "話せたら今日はもうかけない"); assert.equal(x.bales_seen.kind, "other");
x = await L("a5"); assert.equal(x.next_at, null, "開いているリードは動かさない"); assert.equal(x.bales_seen, null);
x = await L("a6"); assert.equal(x.next_at, null, "MOCHICALL の記録が新しいなら動かさない"); assert.equal(x.bales_seen.kind, "skip");

// 3. 2回目は開いていたもの（まだ開いている）以外は見ない
const out2 = await applyBalesCalls();
assert.equal(out2.seen, 1); assert.equal(out2.busy, 1); assert.equal((await L("a2")).attempts, 1, "二重に数えない");

console.log("mcbales_feed_test OK", JSON.stringify(out));
await P.end().catch(() => {}); await srv.stop(); process.exit(0);
