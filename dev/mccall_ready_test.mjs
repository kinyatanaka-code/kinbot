// 管理者の「インサイドの『かける』の状態」と「名簿とメール」の試験（2026-11-27 福井さん：SHOWIN のリスト管理へ移す）
//
// 何を確かめるか：
//   1. 状態の数（今日の分・残り・今かけられる）が、本人の「かける」（/api/mccall/queue）と同じ数え方になっている
//      （今日かけるリスト・手持ち300件・検討時期待ち・BALES の所有者がほかの人の会社）
//   2. 様子を見るだけで、今日の分を作ったり担当を付けたりしない
//   3. 名簿とメールで、インサイド8名・営業（FS）2名・管理者をメールで登録できる
//
// 使い方：dev/mccall_flow_test.mjs と同じ（PGlite は dev/demo か MCCALL_TEST_PGLITE）
//   node dev/mccall_ready_test.mjs
import net from "node:net";
import { register, createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert/strict";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = 8392, PG_PORT = 18392;

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
const FS = [{ email: "saito@test.local", name: "齊藤 玲耶" }, { email: "etori@test.local", name: "餌取 鴻志" }];
for (const u of [ADMIN, ...INTERNS, OUTSIDER, ...FS]) await call(u.email, "POST", "/api/register", { email: u.email, password: PASS, displayName: u.name });
const A = ADMIN.email, MORI = INTERNS[0].email, OSAWA = INTERNS[5].email;
const L1 = (await call(A, "POST", "/api/mccall/lists", { name: "既存リスト", members: [] })).id;
// 既存リスト：4社。うち1社は Bales で森さんが所有者の会社（大沢さんの「かける」には出ない）
await call(A, "POST", `/api/mccall/lists/${L1}/from-csv`, { rows: [
  ...Array.from({ length: 3 }, (_, i) => ({ company: `株式会社 既存${i + 1}`, phone: `03-0000-90${String(i).padStart(2, "0")}`, person: "担当" })),
  { company: "株式会社 バレスm9", phone: "03-0000-9099", person: "担当" }] });
await call(A, "PUT", `/api/mccall/lists/${L1}/talks`, { talks: [{ label: "A", body: "既存のトーク" }] });
await q(`UPDATE mc_call_leads SET research='{"status":"ok"}', research_at=now() WHERE list_id=$1`, [L1]);
await call(A, "GET", "/api/mochica/bales/lists");   // 表を作らせる
const LK = "bales:試験";
await q(`INSERT INTO mochica_bales_lists (list_key, name, status, cols, run_at) VALUES ($1,'試験',$2,$3,now())`, [LK, "done", JSON.stringify([{ key: "companyName" }, { key: "companyTel1" }, { key: "operatorName" }])]);
const run = (await q(`SELECT run_at FROM mochica_bales_lists WHERE list_key=$1`, [LK])).rows[0].run_at;
// 森さんの手持ち（kinbot で割り振った会社）3社＋森さんが所有者の m9（割り振りなし）
for (const [k, owner, asg] of [["m1", "森 康晴", "森 康晴"], ["m2", "森 康晴", "森 康晴"], ["m3", "森 康晴", "森 康晴"], ["m9", "森 康晴", null]])
  await q(`INSERT INTO mochica_bales_rows (list_key, row_key, data, run_at, hot, assign_name) VALUES ($1,$2,$3,$4,2,$5)`,
    [LK, k, JSON.stringify({ companyName: `株式会社 バレス${k}`, companyTel1: `03-1111-01${k.slice(1)}`, operatorName: owner }), run, asg]);
const rd = async () => (await call(A, "GET", "/api/mccall/readiness")).items;
const who = (items, e) => items.find((x) => x.email === e);
const mAhead = (k) => ((new Date().getMonth() + k) % 12) + 1;

await t("readiness：今日の分をまだ作っていない森さんは「まだ作っていない」（止まっていない）。readiness を開いても今日の分は作らない", async () => {
  const x = who(await rd(), MORI);
  assert.equal(x.mode, "today"); assert.equal(x.today.made, false); assert.notEqual(x.level, "stop", x.msg); assert.match(x.msg, /まだ作っていません/);
  assert.equal(+(await q(`SELECT count(*) FROM mochica_bales_today`)).rows[0].count, 0, "readiness で今日の分を作ってしまった");
});
let MQ;
await t("readiness：森さんが「かける」を開いたあと、今日の分・残り・今かけられる数が「かける」と同じ", async () => {
  MQ = await call(MORI, "GET", "/api/mccall/queue");
  assert.ok(MQ.today, `today が返らない：${JSON.stringify(MQ).slice(0, 200)}`);
  const x = who(await rd(), MORI);
  assert.equal(x.today.made, true); assert.equal(x.today.left, MQ.today.left); assert.equal(x.now, MQ.items.length, x.msg);
  assert.ok(x.today.hold != null && x.today.holdTarget === 300, JSON.stringify(x.today)); assert.match(x.msg, /手持ち \d+／300件/);
  assert.equal(x.level, "warn", "今日の分が50件未満なので要確認"); assert.match(x.msg, /少なめ/);
});
await t("readiness：今日かけるリストでない大沢さんの「今かけられる」は、BALES の所有者がほかの人の会社（m9）を数えない＝「かける」と同じ", async () => {
  const j = await call(OSAWA, "GET", "/api/mccall/queue");
  assert.ok(!j.today); assert.ok(!j.items.some((i) => i.company === "株式会社 バレスm9"), "m9 が大沢さんに出ている");
  const x = who(await rd(), OSAWA);
  assert.equal(x.mode, "all"); assert.equal(x.now, j.items.length, x.msg); assert.match(x.msg, /所有者の名前と合わない/);
});
await t("readiness：検討時期待ちの会社は「今かけられる」に数えず、件数を出す", async () => {
  const id = MQ.items[0].id;
  await q(`UPDATE mc_call_leads SET hearing=$2 WHERE id=$1`, [id, JSON.stringify({ when: `${mAhead(4)}月`, at: new Date(Date.now() - 5 * 864e5).toISOString() })]);
  try {
    const j = await call(MORI, "GET", "/api/mccall/queue");
    const x = who(await rd(), MORI);
    assert.ok(!j.items.some((i) => i.id === id), "時期待ちが「かける」に出ている");
    assert.equal(x.now, j.items.length); assert.equal(x.held, 1); assert.match(x.msg, /検討時期待ち 1件/);
  } finally { await q(`UPDATE mc_call_leads SET hearing=NULL WHERE id=$1`, [id]); }
});
await t("readiness：今日かけるリストにトークが無いと止まっている（トークの書き方を案内。しまったタブの名前は出さない）", async () => {
  const tid = MQ.today.list;
  await q(`UPDATE mc_call_talks SET active=false WHERE list_id=$1`, [tid]);
  try {
    const x = who(await rd(), MORI);
    assert.equal(x.level, "stop"); assert.match(x.msg, /今日かけるリストにトークがありません/); assert.doesNotMatch(x.msg, /リストの管理/);
  } finally { await q(`UPDATE mc_call_talks SET active=true WHERE list_id=$1`, [tid]); }
});
await t("名簿とメール：インサイド8名・営業（FS）2名・管理者をメールで登録でき、readiness の「メール未登録」が消える", async () => {
  const ppl = await call(A, "GET", "/api/mccall/people");
  const is = ppl.rows.filter((r) => r.kind === "is"), sales = ppl.rows.filter((r) => r.kind === "sales"), adm = ppl.rows.filter((r) => r.kind === "admin");
  assert.equal(is.length, 8); assert.ok(sales.some((r) => r.key === "齊藤玲耶") && sales.some((r) => r.key === "餌取鴻志")); assert.ok(adm.length >= 1);
  assert.equal(sales[0].kindLabel, "営業（FS）");
  // インサイドは候補（名前で当たった人）がそのまま本人
  for (const r of is) { assert.ok(r.guess, `${r.key} の候補が無い`); await call(A, "PUT", "/api/mccall/people", { kind: "is", key: r.key, email: r.guess }); }
  await call(A, "PUT", "/api/mccall/people", { kind: "sales", key: "齊藤玲耶", email: FS[0].email });
  await call(A, "PUT", "/api/mccall/people", { kind: "sales", key: "餌取鴻志", email: FS[1].email });
  await call(A, "PUT", "/api/mccall/people", { kind: "admin", key: "福井", email: A });
  const p2 = await call(A, "GET", "/api/mccall/people");
  for (const r of p2.rows.filter((y) => y.kind === "is")) assert.equal(r.email, INTERNS.find((u) => r.guess === u.email || r.email === u.email).email);
  assert.equal(p2.rows.find((y) => y.kind === "sales" && y.key === "齊藤玲耶").email, FS[0].email);
  assert.equal(p2.rows.find((y) => y.kind === "sales" && y.key === "餌取鴻志").email, FS[1].email);
  assert.equal(p2.rows.find((y) => y.kind === "admin" && y.key === "福井").email, A);
  const items = await rd();
  assert.equal(items.filter((x) => x.roster).length, 8);
  for (const x of items.filter((y) => y.roster)) { assert.equal(x.noEmail, false, x.name); assert.doesNotMatch(x.msg, /メール未登録/); }
});
await t("名簿とメール：インターンは登録できない・kinbot に無いメールは断る", async () => {
  await assert.rejects(call(MORI, "PUT", "/api/mccall/people", { kind: "is", key: "森康晴", email: MORI }));
  await assert.rejects(call(A, "PUT", "/api/mccall/people", { kind: "sales", key: "齊藤玲耶", email: "nobody@test.local" }));
  await assert.rejects(call(MORI, "GET", "/api/mccall/readiness"));
});

console.log(`\n${failed ? `${failed} 件 失敗` : "すべて通りました"}（通った ${n} 件）`);
await pool.end().catch(() => {});
process.exit(failed ? 1 : 0);
