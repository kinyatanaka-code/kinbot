// MOCHICALL の「かける」をリスト管理の今日かけるリストから出す試験（2026-11-23 福井さん「架電先リストはリスト管理の今日架けるリストからかけるように」）
//
// 何を確かめるか：
//   1. 所有者に名前が当たるインターンは、「かける」がその人の今日かけるリストの会社（＋本人の掛け直し）だけになる
//   2. 入れ先のリスト「今日かけるリスト（リスト管理）」が自動ででき、いま使っているリストのトークが写る
//   3. 保管のリストにすでにあるリードは移して担当が付く。無いリードは新しく入る。アポ獲得・アーカイブは入らない
//   4. 何度読んでも二重に入らない／ほかの人の分は出ない
//   5. 所有者に当たらない人は今までどおり。入れ先のリストを閉じると全員が今までどおりに戻る
//
// 使い方：dev/mccall_flow_test.mjs と同じ（PGlite は dev/demo か MCCALL_TEST_PGLITE）
//   node dev/mccall_today_test.mjs
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
  MCCALL_RESEARCH_DAILY: "1200", MCCALL_RESEARCH_CONC: "1",
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

// ---------- 準備：人・リスト・リスト管理（Bales）の取り込み ----------
for (const u of [ADMIN, ...INTERNS, OUTSIDER]) await call(u.email, "POST", "/api/register", { email: u.email, password: PASS, displayName: u.name });
const A = ADMIN.email, MORI = INTERNS[0].email, NAITO = INTERNS[3].email, OSAWA = INTERNS[5].email;
// いま使っているリスト（トークあり）
const L1 = (await call(A, "POST", "/api/mccall/lists", { name: "既存リスト", members: [] })).id;
await call(A, "POST", `/api/mccall/lists/${L1}/from-csv`, { rows: Array.from({ length: 4 }, (_, i) => ({ company: `株式会社 既存${i + 1}`, phone: `03-0000-90${String(i).padStart(2, "0")}`, person: "担当" })) });
await call(A, "PUT", `/api/mccall/lists/${L1}/talks`, { talks: [{ label: "A", body: "既存のトーク" }] });
await q(`UPDATE mc_call_leads SET research='{"status":"ok"}', research_at=now() WHERE list_id=$1`, [L1]);
// リスト管理の Bales のリスト（所有者は Bales の書き方＝空白入り・SF の字）
await call(A, "GET", "/api/mochica/bales/lists");   // 表を作らせる
const LK = "bales:試験";
await q(`INSERT INTO mochica_bales_lists (list_key, name, status, cols, run_at) VALUES ($1,'試験',$2,$3,now())`, [LK, "done", JSON.stringify([{ key: "companyName" }, { key: "companyTel1" }, { key: "operatorName" }])]);
const run = (await q(`SELECT run_at FROM mochica_bales_lists WHERE list_key=$1`, [LK])).rows[0].run_at;
const ROWS = [
  ["m1", "森 康晴", {}], ["m2", "森 康晴", {}], ["m3", "森 康晴", {}],
  ["m4", "森 康晴", { callResult: "担当者接触：アポ獲得" }],      // アポ獲得は入らない
  ["m5", "森 康晴", { lastLeadStageName: "アーカイブ" }],         // アーカイブは入らない
  ["n1", "内藤 賴郁亜", {}], ["n2", "内藤 賴郁亜", {}],
  ["f1", "福井 聖", {}],
];
// ホット度はウォーム（2）にする（コールドは今日かけるリストに入らない：2026-11-23 田中さん）
for (const [k, owner, extra] of ROWS) await q(`INSERT INTO mochica_bales_rows (list_key, row_key, data, run_at, hot) VALUES ($1,$2,$3,$4,2)`,
  [LK, k, JSON.stringify({ companyName: `株式会社 バレス${k}`, companyTel1: `03-1111-0${k.charCodeAt(0)}${k.slice(1)}`, operatorName: owner, ...extra }), run]);
// m1 は BALES の移行で保管のリストにもう入っている
const STOCK = (await q(`INSERT INTO mc_call_lists (name, members, stock, bales_key) VALUES ('BALES：試験','{}',true,$1) RETURNING id`, [LK])).rows[0].id;
const M1 = (await q(`INSERT INTO mc_call_leads (list_id, src, src_key, company, phone, research, research_at) VALUES ($1,'bales',$2,'株式会社 バレスm1','03-1111-0109','{"status":"ok"}',now()) RETURNING id`, [STOCK, `${LK}|m1`])).rows[0].id;

let TID;
const keysOf = async (ids) => (await q(`SELECT src_key FROM mc_call_leads WHERE id = ANY($1) ORDER BY src_key`, [ids])).rows.map((r) => r.src_key.split("|")[1]);
await t("森さん：「かける」は今日かけるリストの3社だけ（アポ獲得・アーカイブ・既存リスト・ほかの人の分は出ない）", async () => {
  const j = await call(MORI, "GET", "/api/mccall/queue");
  assert.ok(j.today, `today が返らない：${JSON.stringify(j).slice(0, 300)}`);
  assert.equal(j.today.owner, "森 康晴"); assert.equal(j.today.n, 3); TID = j.today.list;
  assert.deepEqual(await keysOf(j.items.map((x) => x.id)), ["m1", "m2", "m3"]);
  assert.equal(j.today.left, 3);
});
await t("入れ先のリストが自動ででき、既存リストのトークが写っている", async () => {
  const l = (await q(`SELECT name, today_src, stock, closed FROM mc_call_lists WHERE id=$1`, [TID])).rows[0];
  assert.equal(l.name, "今日かけるリスト（リスト管理）"); assert.equal(l.today_src, true); assert.equal(l.stock, false);
  const tk = (await q(`SELECT label, body FROM mc_call_talks WHERE list_id=$1 AND active`, [TID])).rows;
  assert.deepEqual(tk, [{ label: "A", body: "既存のトーク" }]);
});
await t("保管のリストにあった m1 は移され、森さんの担当・今日の印が付く（新しく作らない）", async () => {
  const r = (await q(`SELECT list_id, assigned_to, today_day FROM mc_call_leads WHERE id=$1`, [M1])).rows[0];
  assert.equal(r.list_id, TID); assert.equal(r.assigned_to, MORI); assert.ok(r.today_day);
  assert.equal(+(await q(`SELECT count(*) FROM mc_call_leads WHERE src_key=$1`, [`${LK}|m1`])).rows[0].count, 1);
});
await t("何度読んでも二重に入らない", async () => {
  await call(MORI, "GET", "/api/mccall/queue"); await call(MORI, "GET", "/api/mccall/queue");
  assert.equal(+(await q(`SELECT count(*) FROM mc_call_leads WHERE list_id=$1`, [TID])).rows[0].count, 3);
});
await t("内藤さん（異体字の所有者名）：自分の2社だけ。森さんの分は出ない", async () => {
  const j = await call(NAITO, "GET", "/api/mccall/queue");
  assert.equal(j.today && j.today.owner, "内藤 賴郁亜");
  assert.deepEqual(await keysOf(j.items.map((x) => x.id)), ["n1", "n2"]);
});
await t("森さんの掛け直し（既存リスト・担当が森さん／担当なしで最後にかけたのが森さん）は出る。ほかの人の掛け直しは出ない", async () => {
  const ex = (await q(`SELECT id FROM mc_call_leads WHERE list_id=$1 ORDER BY id`, [L1])).rows.map((r) => r.id);
  await q(`UPDATE mc_call_leads SET next_at=now() - interval '5 minutes', assigned_to=$2 WHERE id=$1`, [ex[0], MORI]);
  await q(`UPDATE mc_call_leads SET next_at=now() - interval '5 minutes' WHERE id=$1`, [ex[1]]);
  await q(`INSERT INTO mc_call_logs (lead_id, list_id, caller, reach, outcome) VALUES ($1,$2,$3,'none','no_answer')`, [ex[1], L1, MORI]);
  await q(`UPDATE mc_call_leads SET next_at=now() - interval '5 minutes' WHERE id=$1`, [ex[2]]);
  await q(`INSERT INTO mc_call_logs (lead_id, list_id, caller, reach, outcome) VALUES ($1,$2,$3,'none','no_answer')`, [ex[2], L1, NAITO]);
  const j = await call(MORI, "GET", "/api/mccall/queue");
  const got = j.items.map((x) => x.id);
  assert.ok(got.includes(ex[0]) && got.includes(ex[1]), "森さんの掛け直しが出ない"); assert.ok(!got.includes(ex[2]), "内藤さんの掛け直しが出ている"); assert.ok(!got.includes(ex[3]), "掛け直しでない既存リストの会社が出ている");
  assert.equal(got.length, 5);
});
await t("所有者に当たらない人（大沢さん：Bales に所有の行なし）は今までどおり（既存リストの会社が出る・today なし）", async () => {
  const j = await call(OSAWA, "GET", "/api/mccall/queue");
  assert.equal(j.today, null); assert.ok(j.items.some((x) => x.id), "会社が出ない");
  assert.ok(!j.items.some((x) => x.id === M1), "森さんの今日の分が出ている");
});
await t("開いて記録すると、今日の残りが減る", async () => {
  const j0 = await call(MORI, "GET", "/api/mccall/queue");
  const id = (await q(`SELECT id FROM mc_call_leads WHERE list_id=$1 AND assigned_to=$2 ORDER BY id LIMIT 1`, [TID, MORI])).rows[0].id;
  const d = await call(MORI, "GET", `/api/mccall/leads/${id}?lock=1`);
  assert.ok(d.talk && d.talk.body === "既存のトーク", "入れ先のリストのトークが出ない");
  await call(MORI, "POST", `/api/mccall/leads/${id}/log`, { reach: "none", outcome: "invalid", talkId: d.talk.id, sfPick: {} });
  const j = await call(MORI, "GET", "/api/mccall/queue");
  assert.equal(j.today.left, j0.today.left - 1); assert.ok(!j.items.some((x) => x.id === id));
});
await t("リスト管理で作り直して中身が変わると、外れた会社は「かける」から消える", async () => {
  await q(`UPDATE mochica_bales_rows SET data = data || '{"lastLeadStageName":"アーカイブ"}'::jsonb WHERE list_key=$1 AND row_key='m3'`, [LK]);
  await call(A, "GET", `/api/mochica/bales/lists/${encodeURIComponent(LK)}/today?col=operatorName&val=${encodeURIComponent("森 康晴")}&rebuild=1`);
  const j = await call(MORI, "GET", "/api/mccall/queue");
  assert.equal(j.today.n, 2); assert.ok(!(await keysOf(j.items.map((x) => x.id))).includes("m3"), "外れた m3 が出ている");
});
await t("入れ先のリストを閉じると、今までどおり（today なし・リストを選べる）", async () => {
  await call(A, "PATCH", `/api/mccall/lists/${TID}`, { closed: true });
  const j = await call(MORI, "GET", "/api/mccall/queue");
  assert.equal(j.today, null); assert.ok(j.items.some((x) => x.id), "会社が出ない");
  assert.equal(+(await q(`SELECT count(*) FROM mc_call_lists WHERE today_src`)).rows[0].count, 1, "閉じたのに新しく作り直している");
});

// 過去失注（2026-11-24 福井さん「架けるリストには過去失注も含めるように」）：11/23 に過去失注は全部「未割り振り」へ移したので、
//   未割り振りの過去失注からも今日の分に入れる。同じ日のほかの人とは重ならない。過去失注でない未割り振りは入れない
const PL = JSON.stringify({ opps: [{ name: "【新規】試験の商談", stage: "失注" }] });
for (const [k, owner, assign] of [["p1", "福井 聖", "__none__"], ["p2", "福井 聖", "__none__"], ["p3", "", null], ["u1", "", null]])
  await q(`INSERT INTO mochica_bales_rows (list_key, row_key, data, run_at, hot, assign_name, sf) VALUES ($1,$2,$3,$4,1,$5,$6)`,
    [LK, k, JSON.stringify({ companyName: `株式会社 バレス${k}`, companyTel1: `03-2222-0${k.charCodeAt(0)}${k.slice(1)}`, operatorName: owner }), run, assign, k === "u1" ? null : PL]);
const todayOf = (name, rb) => call(A, "GET", `/api/mochica/bales/lists/${encodeURIComponent(LK)}/today?col=operatorName&val=${encodeURIComponent(name)}${rb ? "&rebuild=1" : ""}`);
const rowsOf = async (name) => (await call(A, "GET", `/api/mochica/bales/lists/${encodeURIComponent(LK)}/rows?col=operatorName&val=${encodeURIComponent(name)}&stg=today&limit=50`)).total;
await t("過去失注：森さんの今日かけるリストに未割り振りの過去失注（p1〜p3・コールドでも）が入る。過去失注でない未割り振り（u1）は入らない", async () => {
  const j = await todayOf("森 康晴", true);
  assert.equal(j.pastlost, 3, JSON.stringify(j)); assert.equal(j.pl_free, 3); assert.equal(j.n, 5);
  assert.equal(await rowsOf("森 康晴"), 5, "リスト管理の今日かけるリストの表に、未割り振りから入れた過去失注が出ない");
});
await t("過去失注：あとで作った内藤さんには、森さんが今日持っている過去失注は入らない（重ならない）", async () => {
  const j = await todayOf("内藤 賴郁亜", true);
  assert.equal(j.pl_free, 0, JSON.stringify(j)); assert.equal(j.n, 2);
});
await t("過去失注：入れ先のリストを開け直すと、森さんの「かける」に過去失注の会社が出る", async () => {
  await call(A, "PATCH", `/api/mccall/lists/${TID}`, { closed: false });
  const j = await call(MORI, "GET", "/api/mccall/queue");
  const all = await keysOf(j.items.map((x) => x.id));
  for (const k of ["p1", "p2", "p3"]) assert.ok(all.includes(k), `${k} が出ない：${JSON.stringify(all)}`);
  assert.ok(!all.includes("u1"), "過去失注でない未割り振りが出ている");
});

console.log(`\n${n} ok / ${failed} NG`);
await pool.end().catch(() => {});
process.exit(failed ? 1 : 0);
