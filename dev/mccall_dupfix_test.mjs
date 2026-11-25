// 「情報を直す」で重複したとき、SF のつなぎ先を変えて元のリードを消して保存する試験（2026-11-25 福井さん）
//
// 何を確かめるか：
//   1. 重複で断られたとき、相手のリードの ID と SF のつなぎ先が返る
//   2. replaceDup で保存すると、こちらの SF のつなぎ先が元のリードのものになり、架電の記録が移り、元のリードは消える
//   3. 重複していないリードの ID を送っても消さない
//   4. 2件と重複していても、2件まとめて送れば保存できる（1件だけだと全部取り消される）
//
// 使い方：node dev/mccall_dupfix_test.mjs（PGlite は dev/demo か MCCALL_TEST_PGLITE）
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

// ---------- 準備 ----------
for (const u of [ADMIN, INTERNS[0]]) await call(u.email, "POST", "/api/register", { email: u.email, password: PASS, displayName: u.name });
const A = ADMIN.email;
const L1 = (await call(A, "POST", "/api/mccall/lists", { name: "試験リスト", members: [] })).id;
const L2 = (await call(A, "POST", "/api/mccall/lists", { name: "BALES：すべてのリード", members: [] })).id;
await call(A, "POST", `/api/mccall/lists/${L1}/from-csv`, { rows: [
  { company: "株式会社 試験いち", phone: "03-1111-0001", person: "担当" }, { company: "株式会社 試験に", phone: "03-1111-0002", person: "担当" }] });
await call(A, "POST", `/api/mccall/lists/${L2}/from-csv`, { rows: [
  { company: "株式会社 ハンディ", phone: "03-2222-0002", person: "担当" }, { company: "株式会社 べつの会社", phone: "03-2222-0009", person: "担当" },
  { company: "株式会社 テスト二", phone: "03-4444-0004", person: "担当" }, { company: "株式会社 テスト二べつ", phone: "03-5555-0005", person: "担当" }] });
const idOf = async (co) => (await q(`SELECT id FROM mc_call_leads WHERE company=$1`, [co])).rows[0]?.id;
const LA = await idOf("株式会社 試験いち"), LB = await idOf("株式会社 ハンディ"), LC = await idOf("株式会社 べつの会社");
const LG = await idOf("株式会社 試験に"), LE = await idOf("株式会社 テスト二"), LF = await idOf("株式会社 テスト二べつ");
const SF_B = "00Q000000000001AAA";
await q(`UPDATE mc_call_leads SET sf_lead_id=$2, attempts=3, last_at=now(), last_outcome='no_answer' WHERE id=$1`, [LB, SF_B]);
await q(`INSERT INTO mc_call_logs (lead_id, list_id, caller, outcome) VALUES ($1, $2, 'x@test.local', 'no_answer')`, [LB, L2]);
const patch = (id, body) => call(A, "PATCH", `/api/mccall/leads/${id}`, body);
const patchErr = async (id, body) => { try { await patch(id, body); return null; } catch (e) { return JSON.parse(e.message.replace(/^[^{]*/, "")); } };

await t("重複で断られたとき、相手のリードと SF のつなぎ先が返る", async () => {
  const j = await patchErr(LA, { company: "株式会社 ハンディ", phone: "03-2222-0002" });
  assert.ok(j && j.dup, JSON.stringify(j)); assert.equal(j.dup.id, LB); assert.equal(j.dup.sf, SF_B); assert.equal(j.dup.list, "BALES：すべてのリード");
  assert.ok(await idOf("株式会社 ハンディ"));
});
await t("重複していないリードを送っても消さない", async () => {
  const j = await patchErr(LA, { company: "株式会社 ハンディ", phone: "03-2222-0002", replaceDup: [LC] });
  assert.ok(j && /もう重複していません/.test(j.error), JSON.stringify(j));
  assert.ok(await idOf("株式会社 べつの会社")); assert.ok(await idOf("株式会社 ハンディ"));
});
await t("replaceDup で保存：つなぎ先が変わり、記録が移り、元のリードは消える", async () => {
  await patch(LA, { company: "株式会社 ハンディ", phone: "03-2222-0002", replaceDup: [LB] });
  const a = (await q(`SELECT company, sf_lead_id, attempts, last_outcome FROM mc_call_leads WHERE id=$1`, [LA])).rows[0];
  assert.equal(a.company, "株式会社 ハンディ"); assert.equal(a.sf_lead_id, SF_B); assert.equal(a.attempts, 3); assert.equal(a.last_outcome, "no_answer");
  assert.equal((await q(`SELECT count(*)::int n FROM mc_call_leads WHERE id=$1`, [LB])).rows[0].n, 0);
  assert.equal((await q(`SELECT count(*)::int n FROM mc_call_logs WHERE lead_id=$1`, [LA])).rows[0].n, 1);
  assert.equal((await q(`SELECT count(*)::int n FROM mc_lead_keys WHERE lead_id=$1`, [LB])).rows[0].n, 0);
  assert.ok((await q(`SELECT count(*)::int n FROM mc_lead_keys WHERE lead_id=$1`, [LA])).rows[0].n > 0);
});
await t("2件と重複：1件だけでは取り消され、2件まとめて送れば保存できる", async () => {
  await patch(LF, { company: "株式会社 テスト二", email: "x@example.co.jp" });
  const body = { company: "株式会社 テスト二", phone: "03-4444-0004", email: "x@example.co.jp" };
  const j1 = await patchErr(LG, body); assert.ok(j1 && j1.dup, JSON.stringify(j1));
  const j2 = await patchErr(LG, { ...body, replaceDup: [j1.dup.id] }); assert.ok(j2 && j2.dup && j2.dup.id !== j1.dup.id, JSON.stringify(j2));
  assert.ok(await q(`SELECT 1 FROM mc_call_leads WHERE id=$1`, [j1.dup.id]).then((r) => r.rowCount), "1件目は取り消しで残っているはず");
  await patch(LG, { ...body, replaceDup: [j1.dup.id, j2.dup.id] });
  assert.equal((await q(`SELECT count(*)::int n FROM mc_call_leads WHERE id = ANY($1)`, [[LE, LF]])).rows[0].n, 0);
});

console.log(`\n${failed ? `${failed} 件 失敗` : "すべて通りました"}（通った ${n} 件）`);
await pool.end().catch(() => {});
process.exit(failed ? 1 : 0);
