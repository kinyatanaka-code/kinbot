// MOCHICALL の「かける」に出す条件（MQL）・夜の読み直し・SF 立ち上げの試しを、本物のサーバーと手元のデータベース・偽の SF で通す試験（2026-11-23 福井さん）
//
// 何を確かめるか：
//   1. 夜の読み直しが、SF に結びついたリードを sf_lead_id で 200件ずつ読む（203件なら SF に2回）。SF で見つからないリードは「見つからない」と残す
//   2. 読んだ項目で印が付き、オプトアウト・退職・実績ゼロ帯のリード元・戻らない失注理由・商談中の会社は「かける」に出ない。状態「アーカイブ」は出す
//   3. 外れたリードは消えない（行はそのまま）。管理者の状態と「MQL 外の理由」の軸で理由ごとの数が見える
//   4. SF 立ち上げの試し：SF の Mochica リード・取引先と重複を確かめ、結びつける・取引先だけ・要確認・作る を分ける。リストにリード元が無ければ作らない。
//      架電画面の「SF にリードを作る」と同じ決まり（業種は必須・コンバート済みのリードには結びつけない）（2026-11-27）。
//      試しでは SF に1件も書かない（作る API が呼ばれない）。本番の実行は MCCALL_SF_LAUNCH=1 でなければ断る
//   5. 手持ち300件・今日の100件（リスト管理の BALES の行から作る）にも MQL が効く。外れた行は消さず・担当も変えず、理由は /api/mccall/mql/out で見られる（2026-11-27）
//
// 本番に何も届かないように：
//   データベースは手元の PGlite（メモリの中だけ）。外への通信は Node の入口で全部断る。鍵の入った環境変数は消す。
//   SF は server/mcsfsync.js が読む salesforce.js だけを、この試験の偽物に差し替える（ほかの機能は SF につながらないまま）。
//
// 使い方：
//   PGlite はデモ環境（dev/demo）の部品を借りる。初回だけ  cd dev/demo && npm install
//   node dev/mcmql_flow_test.mjs   （1分ほど）
import net from "node:net";
import os from "node:os";
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
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (LOCAL.test(url.hostname)) return realFetch(input, init);
  if (/(^|\.)(search\.yahoo\.co\.jp|duckduckgo\.com|bing\.com)$/.test(url.hostname)) return new Promise(() => {});
  throw new TypeError(`試験のため外部（${url.hostname}）にはつなぎません`);
};

// ---------- 偽の SF（mcsfsync.js が読む salesforce.js だけ差し替える） ----------
const FAKE = { calls: { lead: 0, leadIds: [], recordType: 0, busy: 0, idxLead: 0, idxAcct: 0, describe: 0, create: 0 }, leads: new Map(), mochicaLeads: [], accts: [], busy: [] };
globalThis.__mcFakeSf = {
  async sfQuery(owner, soql) {
    if (/FROM RecordType/.test(soql)) { FAKE.calls.recordType++; return { records: [{ Id: "012000000000MOC" }] }; }
    const m = /FROM Lead WHERE Id IN \(([^)]*)\)/.exec(soql);
    if (m) {
      const ids = m[1].split(",").map((s) => s.replace(/'/g, "").trim());
      FAKE.calls.lead++; FAKE.calls.leadIds.push(ids.length);
      return { records: ids.map((id) => FAKE.leads.get(id)).filter(Boolean) };
    }
    throw new Error(`偽の SF が知らない SOQL：${soql.slice(0, 120)}`);
  },
  async sfQueryAll(owner, soql) {
    if (/acount_status__c IN/.test(soql)) { FAKE.calls.busy++; return FAKE.busy; }
    if (/FROM Lead WHERE RecordType\.Name/.test(soql)) { FAKE.calls.idxLead++; return FAKE.mochicaLeads; }
    if (/FROM Account/.test(soql)) { FAKE.calls.idxAcct++; return FAKE.accts; }
    throw new Error(`偽の SF が知らない SOQL：${soql.slice(0, 120)}`);
  },
  async describeObject(owner, so) { FAKE.calls.describe++; return { fields: [{ name: "LeadSource", picklistValues: ["アウトバウンド", "失注リサイクル", "HR-EXPO"].map((value) => ({ value, active: true })) },
    { name: "Industry", picklistValues: ["製造", "IT・通信"].map((value) => ({ value, active: true })) }] }; },
  async sfCreateRecord() { FAKE.calls.create++; throw new Error("試しなのに SF に作ろうとした"); },
};
const realSf = pathToFileURL(path.join(ROOT, "server", "salesforce.js")).href;
const fakeFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mcmql-fake-")), "salesforce-fake.mjs");
fs.writeFileSync(fakeFile, `export * from ${JSON.stringify(realSf)};
export const sfQuery = (...a) => globalThis.__mcFakeSf.sfQuery(...a);
export const sfQueryAll = (...a) => globalThis.__mcFakeSf.sfQueryAll(...a);
export const describeObject = (...a) => globalThis.__mcFakeSf.describeObject(...a);
export const sfCreateRecord = (...a) => globalThis.__mcFakeSf.sfCreateRecord(...a);
`);
const stub = "export const chromium={launch:async()=>{throw new Error('試験ではブラウザを使いません')}};export default {chromium, executablePath: async()=>'', args: []};";
register("data:text/javascript," + encodeURIComponent(`export async function resolve(s, c, n) {
  if (s === "playwright-core" || s === "@sparticuz/chromium") return { url: "data:text/javascript," + encodeURIComponent(${JSON.stringify(stub)}), shortCircuit: true };
  if (s === "./salesforce.js" && c.parentURL && c.parentURL.endsWith("/server/mcsfsync.js")) return { url: ${JSON.stringify(pathToFileURL(fakeFile).href)}, shortCircuit: true };
  return n(s, c); }`));

// ---------- 環境変数 ----------
const pgDir = process.env.MCCALL_TEST_PGLITE || path.join(HERE, "demo");   // 鍵を消す前に読む
for (const k of Object.keys(process.env)) if (/KEY|TOKEN|SECRET|PASSWORD|_URL$|^SF_|^ZOOM|^BALES|^MIITEL|^GOOGLE|^GEMINI|^GROQ|^OPENAI|^ANTHROPIC|^RECALL|^DEEPGRAM|^MUX|^CSP_|^MC_FORM|^DRIVE|^GITHUB|^GH_|^KINBOT|^MCCALL_/i.test(k)) delete process.env[k];
const ADMIN = { email: "kanri@test.local", name: "試験 管理者" };
const INTERN = { email: "mori@test.local", name: "森 康晴" };
const PASS = "test-pass-1";
Object.assign(process.env, {
  PORT: String(PORT), DATABASE_URL: `postgres://postgres@127.0.0.1:${PG_PORT}/postgres?sslmode=disable`,
  SESSION_SECRET: "test-session-secret", RECALL_API_KEY: "dummy", GEMINI_API_KEY: "dummy",
  MCCALL_ADMIN_EMAILS: ADMIN.email, PUBLIC_URL: `http://localhost:${PORT}`, MCCALL_RESEARCH_DAILY: "0", MCCALL_MQL_NIGHTLY: "0",
});

// ---------- 手元のデータベース ----------
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
const quiet = console.log; console.log = () => {};
await import(pathToFileURL(path.join(ROOT, "server", "index.js")).href);
const base = `http://localhost:${PORT}`;
for (let i = 0; i < 120; i++) { try { if ((await realFetch(`${base}/healthz`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
await new Promise((r) => setTimeout(r, 3000));
const mq = await import(pathToFileURL(path.join(ROOT, "server", "mcsfsync.js")).href);   // サーバーと同じもの（偽の SF につながっている）
const pg = (await import("pg")).default;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const q = (s, p) => pool.query(s, p);

const jar = {};
async function call(who, method, url, body, raw = false) {
  const r = await realFetch(base + url, { method, headers: { "content-type": "application/json", cookie: jar[who] || "" }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie"); if (sc) jar[who] = sc.split(";")[0];
  const t = await r.text(); if (raw) return { status: r.status, text: t };
  let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 200) }; }
  if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${t.slice(0, 300)}`);
  return j;
}
let n = 0, failed = 0; const out = [];
async function t(name, fn) {
  try { await fn(); n++; out.push(`ok  ${name}`); }
  catch (e) { failed++; out.push(`NG  ${name}\n    ${String(e.stack || e.message).split("\n").slice(0, 4).join("\n    ")}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (i, w) => String(i).padStart(w, "0");
const sfId = (i) => `00Q${pad(i, 12)}`;

// ---------- 準備 ----------
// 本番には Bales の取り込みの表があり、絞り込みの数え方がそれを読む（手元では Bales を取り込まないので、空の表だけ作る）
await q(`CREATE TABLE IF NOT EXISTS mochica_bales_rows (seq BIGSERIAL, list_key TEXT, row_key TEXT, data JSONB, run_at TIMESTAMPTZ, raw JSONB, detail JSONB, detail_at TIMESTAMPTZ,
  dup_of TEXT, dup_note TEXT, dup_n INT, hot SMALLINT, hot_at TIMESTAMPTZ, hot_d JSONB, hot_v SMALLINT, ng BOOLEAN, sf JSONB, sf_at TIMESTAMPTZ, w_at TIMESTAMPTZ, w_err TEXT,
  assign_email TEXT, assign_name TEXT, PRIMARY KEY (list_key, row_key))`);
for (const u of [ADMIN, INTERN]) await call(u.email, "POST", "/api/register", { email: u.email, password: PASS, displayName: u.name });
const A = ADMIN.email, I = INTERN.email;
// リスト A：SF から来たリード（203件。200件ずつ読むのを確かめる）
const LA = (await call(A, "POST", "/api/mccall/lists", { name: "試験 SF のリード", members: [] })).id;
await call(A, "POST", `/api/mccall/lists/${LA}/from-csv`, { rows: Array.from({ length: 203 }, (_, i) => ({ company: `株式会社 夜読${i}`, phone: `03-2${pad(i, 3)}-${pad(i + 1000, 4)}`, person: "担当" })) });
await call(A, "PUT", `/api/mccall/lists/${LA}/talks`, { talks: [{ label: "A", body: "試験のトーク" }] });
// リスト B：CSV から入れた SF に無いリード（立ち上げの試し）
const LB = (await call(A, "POST", "/api/mccall/lists", { name: "試験 CSV のリード", members: [] })).id;
await call(A, "POST", `/api/mccall/lists/${LB}/from-csv`, { rows: [
  { company: "株式会社 結び先", phone: "06-1111-2222", person: "田中 一郎" },   // SF の Mochica リードと電話・会社名が同じ → 結びつける
  { company: "有限会社 取引先だけ", phone: "06-3333-4444", person: "担当" },   // 取引先だけに当たる → 作らない
  { company: "株式会社 電話だけ同じ", phone: "06-5555-6666", person: "担当" },  // 電話だけ SF のリードと同じ → 要確認
  { company: "株式会社 まったく新しい", phone: "06-7777-8888", person: "鈴木 花子", extra: { 住所: "大阪府大阪市北区1-1", 業種: "製造" } },   // SF に無い → 作る（リード元があれば）
  { company: "株式会社 業種なし", phone: "06-1212-3434", person: "担当" },   // SF に無いが業種が決まらない → 作らない（SF で必須）
  { company: "株式会社 コンバート先", phone: "06-9999-0000", person: "担当" },   // SF の同じ会社のリードはコンバート済み → 結びつけない
] });
await call(A, "PUT", `/api/mccall/lists/${LB}/talks`, { talks: [{ label: "A", body: "試験のトーク" }] });
await sleep(1500);   // 取り込みのあとの印付け（afterImport）を待つ
const idsA = (await q(`SELECT id FROM mc_call_leads WHERE list_id=$1 ORDER BY id`, [LA])).rows.map((r) => r.id);
const idsB = (await q(`SELECT id, company FROM mc_call_leads WHERE list_id=$1 ORDER BY id`, [LB])).rows;
// A のリードを SF のリードに結びつける。203件のうち1件（最後）は SF で見つからない（消された・統合された）
for (let i = 0; i < idsA.length; i++) await q(`UPDATE mc_call_leads SET sf_lead_id=$2 WHERE id=$1`, [idsA[i], sfId(i)]);
const NOW = Date.now(); const ago = (d) => new Date(NOW - d * 864e5).toISOString().slice(0, 10);
for (let i = 0; i < idsA.length - 1; i++) FAKE.leads.set(sfId(i), { Id: sfId(i), IsConverted: false, Status: "未対応", LeadSource: "アウトバウンド", Phone: `03-2${pad(i, 3)}-${pad(i + 1000, 4)}` });
const special = {
  1: { Mochica_optout_check__c: true },                 // M3 オプトアウト
  2: { Retire_check__c: true },                         // M3 退職
  3: { Status: "アーカイブ" },                           // 出す（オーナー決定）
  4: { LeadSource: "HR-EXPO" },                         // M6 実績ゼロ帯
  5: { Lostopp_reason1__c: "価格", LostOpp_lostdate__c: ago(200) },   // M7
  6: { relationacctID__c: "001000000000BSY" },          // M5 商談中の取引先
  7: { Lostopp_reason1__c: "タイミング・検討時期", LostOpp_lostdate__c: ago(40) },   // 出す・並びの点が上がる
};
for (const [i, o] of Object.entries(special)) Object.assign(FAKE.leads.get(sfId(+i)), o);
FAKE.busy = [{ Id: "001000000000BSYAAA", Name: "株式会社 商談中", acount_status__c: "商談進行中" }];
FAKE.mochicaLeads = [
  { Id: "00Q900000000001", Company: "株式会社結び先", Phone: "0611112222", IsConverted: false, LastModifiedDate: "2026-11-01T00:00:00Z" },
  { Id: "00Q900000000002", Company: "株式会社 別の会社", Phone: "06-5555-6666", IsConverted: false, LastModifiedDate: "2026-11-01T00:00:00Z" },
  { Id: "00Q900000000003", Company: "株式会社コンバート先", Phone: "0699990000", IsConverted: true, ConvertedAccountId: "001900000000009", LastModifiedDate: "2026-11-01T00:00:00Z" },
];
FAKE.accts = [{ Id: "001900000000001", Name: "取引先だけ", Phone: "", LastModifiedDate: "2026-11-01T00:00:00Z" }];

// ---------- 夜の読み直し ----------
let night;
FAKE.calls.busy = 0;   // 取り込みのあと（afterImport）にも読むので、夜の分だけ数える
await t("夜の読み直し：SF に結びついた203件を200件ずつ（SF に2回）読み、見つからない1件は「見つからない」と残す", async () => {
  night = await mq.runNightly(async () => "fake-operator@test.local", "試験の夜の読み直し", { staleHours: 0 });
  assert.ok(!night.error && !night.sfxError, JSON.stringify(night));
  assert.deepEqual(FAKE.calls.leadIds, [200, 3], `SF に聞いた件数：${FAKE.calls.leadIds}`);
  assert.equal(night.sfx.read, 202); assert.equal(night.sfx.missing, 1); assert.equal(night.sfx.batches, 2);
  assert.equal(FAKE.calls.busy, 1, "商談中の取引先は1回だけ読む");
  const miss = (await q(`SELECT sfx FROM mc_call_leads WHERE id=$1`, [idsA[202]])).rows[0].sfx; assert.equal(miss._missing, true);
  const r = (await q(`SELECT count(*) FILTER (WHERE sfx IS NOT NULL) AS read, count(*) FILTER (WHERE mql IS NOT NULL) AS judged FROM mc_call_leads WHERE list_id=$1`, [LA])).rows[0];
  assert.equal(+r.read, 203); assert.equal(+r.judged, 203);
});
const mqlOfId = async (id) => (await q(`SELECT mql FROM mc_call_leads WHERE id=$1`, [id])).rows[0].mql;
await t("印：オプトアウト・退職・実績ゼロ帯のリード元・戻らない失注理由・商談中の会社は外れる。アーカイブ・時期の失注・SF で見つからないものは出す", async () => {
  const want = { 0: [], 1: ["optout"], 2: ["retire"], 3: [], 4: ["source"], 5: ["lost"], 6: ["account"], 7: [], 202: [] };
  for (const [i, why] of Object.entries(want)) { const m = await mqlOfId(idsA[+i]); assert.deepEqual(m.why, why, `#${i}：${JSON.stringify(m)}`); assert.equal(m.ok, !why.length, `#${i}`); }
});
await t("「かける」：外れたリードは出ない・消えない。並びは時期の失注（点が高い）が先", async () => {
  // 203件だと「かける」の60件に入りきらないので、見たい9件以外は終わったことにする
  await q(`UPDATE mc_call_leads SET done=true WHERE list_id=$1 AND NOT (id = ANY($2))`, [LA, [0, 1, 2, 3, 4, 5, 6, 7, 202].map((i) => idsA[i])]);
  await q(`UPDATE mc_call_leads SET done=true WHERE list_id=$1`, [LB]);
  const j = await call(I, "GET", "/api/mccall/queue");
  const got = new Set(j.items.map((x) => x.id));
  for (const i of [0, 3, 7, 202]) assert.ok(got.has(idsA[i]), `#${i} が「かける」に出ない`);
  for (const i of [1, 2, 4, 5, 6]) assert.ok(!got.has(idsA[i]), `#${i} が「かける」に出ている`);
  assert.equal(j.items[0].id, idsA[7], `先頭は時期の失注（#7）のはず：${j.items.map((x) => x.id)}`);
  assert.equal(+(await q(`SELECT count(*) FROM mc_call_leads WHERE list_id=$1`, [LA])).rows[0].count, 203, "行は消えていない");
});
await t("管理者：状態に外れた数と理由、「MQL 外の理由」の軸に理由ごとの数", async () => {
  const s = await call(A, "GET", "/api/mccall/mql/status");
  assert.equal(s.out, 5, JSON.stringify(s)); assert.equal(s.gate, true);
  assert.deepEqual(s.why.map((x) => x.k).sort(), ["account", "lost", "optout", "retire", "source"]);
  const g = await call(A, "POST", `/api/mccall/lists/${LA}/segments`, { filters: {} });
  const dim = g.dims && g.dims.mql; assert.ok(dim, `mql の軸が無い：${Object.keys(g.dims || {})}`);
  out.push(`    （「MQL 外の理由」の軸：${JSON.stringify(dim).slice(0, 300)}）`);
});

// ---------- SF 立ち上げの試し ----------
await q(`UPDATE mc_call_leads SET done=false WHERE list_id=$1`, [LB]);
let plan;
await t("試し：結びつける1・取引先だけ1・要確認1。リストにリード元が無い新しい会社は作らない（need_source）。SF には書かない", async () => {
  plan = await call(A, "GET", "/api/mccall/sf-launch/plan?fresh=1");
  const by = Object.fromEntries(plan.samples ? Object.entries(plan.samples).flatMap(([k, a]) => a.map((r) => [r.company, k])) : []);
  assert.equal(by["株式会社 結び先"], "link"); assert.equal(by["有限会社 取引先だけ"], "acct"); assert.equal(by["株式会社 電話だけ同じ"], "review");
  assert.equal(by["株式会社 まったく新しい"], "need_source"); assert.equal(by["株式会社 業種なし"], "need_source"); assert.equal(by["株式会社 コンバート先"], "skip_conv");
  assert.equal(plan.dryRun, true); assert.equal(FAKE.calls.create, 0);
  // A のリードは SF に結びついているので対象にならない
  assert.equal(plan.targets, 6, JSON.stringify(plan.count));
});
await t("リストに SF のリード元（API）を付けると「作る」になり、作る中身はレコードタイプ Mochica・会社名・電話・姓名・リード元", async () => {
  await call(A, "PATCH", `/api/mccall/lists/${LB}`, { leadSource: "アウトバウンド" });
  await sleep(500);
  plan = await call(A, "GET", "/api/mccall/sf-launch/plan");
  const c = (plan.samples.create || [])[0]; assert.ok(c, JSON.stringify(plan.count));
  assert.equal(c.company, "株式会社 まったく新しい");
  const f = c.fields; assert.equal(f.RecordTypeId, "012000000000MOC"); assert.equal(f.Company, "株式会社 まったく新しい"); assert.equal(f.LeadSource, "アウトバウンド");
  assert.equal(f.LastName, "鈴木 花子"); assert.equal(f.Industry, "製造"); assert.ok(f.Phone);
  const ni = (plan.samples.need_industry || []).map((r) => r.company); assert.deepEqual(ni, ["株式会社 業種なし"], JSON.stringify(plan.count));
  assert.equal(FAKE.calls.create, 0, "試しなのに作る API が呼ばれた");
  out.push(`    （試しの件数：${JSON.stringify(plan.count)}・作る中身の見本：${JSON.stringify(f)}）`);
});
await t("試しの CSV が落とせる（全件・判定・理由・SF の当たり）", async () => {
  const r = await call(A, "GET", "/api/mccall/sf-launch/plan?format=csv", null, true);
  assert.equal(r.status, 200); const lines = r.text.replace(/^﻿/, "").trim().split(/\r?\n/);
  assert.equal(lines.length, 7, r.text.slice(0, 400)); out.push(`    （CSV の見本：\n      ${lines.join("\n      ")}）`);
});
await t("本番の実行は MCCALL_SF_LAUNCH=1 でなければ断る（SF に書かない）", async () => {
  const r = await call(A, "POST", "/api/mccall/sf-launch/run", { confirm: "SF に作る" }, true);
  assert.equal(r.status, 403); assert.equal(FAKE.calls.create, 0);
});
await t("MQL を止める（MCCALL_MQL_GATE=0）と、外れたリードも「かける」に出る", async () => {
  process.env.MCCALL_MQL_GATE = "0";
  try {
    await q(`UPDATE mc_call_leads SET done=true WHERE list_id=$1`, [LB]);
    const j = await call(I, "GET", "/api/mccall/queue"); const got = new Set(j.items.map((x) => x.id));
    for (const i of [1, 2, 4, 5, 6]) assert.ok(got.has(idsA[i]), `#${i} が出ない`);
  } finally { delete process.env.MCCALL_MQL_GATE; }
});

// ---------- 手持ち300件・今日の100件（リスト管理の BALES の行から作る）にも MQL を効かせる（2026-11-27） ----------
const dbm = await import(pathToFileURL(path.join(ROOT, "server", "db.js")).href);   // サーバーと同じもの
await dbm.mcBalesMainKey();   // リスト管理の表を作っておく
const TL = "tl-mql", ME = INTERN.name;
await q(`INSERT INTO mochica_bales_lists (list_key, name, src, status, run_at) VALUES ($1, '試験 主のリスト', 'bales', 'done', now())`, [TL]);
const runAt = (await q(`SELECT run_at FROM mochica_bales_lists WHERE list_key=$1`, [TL])).rows[0].run_at;
const brow = (k, d, { mine = true, sf = null } = {}) => q(`INSERT INTO mochica_bales_rows (list_key, row_key, data, run_at, assign_name, sf) VALUES ($1,$2,$3,$4,$5,$6)`,
  [TL, k, JSON.stringify({ companyName: `株式会社 ${k}`, lastLeadStageName: "新規", operatorName: mine ? ME : "", ...d }), runAt, mine ? ME : null, sf ? JSON.stringify(sf) : null]);
await brow("r1", { companyTel1: "03-1000-0001", "leadSources.0.name": "アウトバウンド" });   // 出す
await brow("r2", { companyTel1: "0120-111-222" });                                          // フリーダイヤルしか無い
await brow("r3", { companyTel1: "03-1000-0003", "leadSources.0.name": "HR-EXPO" });          // 実績ゼロ帯のリード元
await brow("r4", { companyTel1: "03-1000-0004" }, { sf: { lead: { "アプローチ禁止の種類": "電話NG" } } });   // 行に付いた SF の値でアプローチ禁止
await brow("r5", { companyTel1: "03-1000-0005" });   // MOCHICALL の印（オプトアウト）で外れる
await brow("r6", { companyTel1: "0120-111-666" });   // その場の判定なら外れるが、MOCHICALL の印（受付で直通を聞いた）は出す → 印を先に使う
await brow("u1", { companyTel1: "03-1000-0011" }, { mine: false });   // 未割り振り：補充で配られる
await brow("u2", {}, { mine: false });                                // 未割り振り：番号が無いので配らない
await q(`INSERT INTO mc_call_leads (list_id, src, src_key, company, phone, mql) VALUES ($1,'bales',$2,'株式会社 r5','03-1000-0005',$3), ($1,'bales',$4,'株式会社 r6','0120-111-666',$5)`,
  [LA, `${TL}|r5`, JSON.stringify({ v: 1, ok: false, why: ["optout"], until: null }), `${TL}|r6`, JSON.stringify({ v: 1, ok: true, why: [], until: null })]);
await t("今日の100件：MQL で外れる行は手持ちにも今日の分にも入らず、補充の候補からも外す。外した行は消さず担当もそのまま。理由ごとの数を残す", async () => {
  const td = await dbm.mcBalesToday(TL, { col: "operatorName", val: ME, rebuild: true });
  const keys = new Set(td.keys);
  for (const k of ["r1", "r6", "u1"]) assert.ok(keys.has(k), `${k} が今日の分に無い：${[...keys]}`);
  for (const k of ["r2", "r3", "r4", "r5", "u2"]) assert.ok(!keys.has(k), `${k} が今日の分に入っている`);
  assert.deepEqual(td.mql, { hold_out: 4, why: { phone_free: 1, source: 1, ban: 1, optout: 1 }, refill_out: 1 }, JSON.stringify(td.mql));
  assert.equal(td.hold, 3, `手持ち：${td.hold}`);
  const r = (await q(`SELECT row_key, assign_name FROM mochica_bales_rows WHERE list_key=$1 ORDER BY row_key`, [TL])).rows;
  assert.equal(r.length, 8, "行は消えていない");
  const an = Object.fromEntries(r.map((x) => [x.row_key, x.assign_name]));
  assert.equal(an.r2, ME, "外した行の担当は変えない"); assert.equal(an.u1, ME, "補充で配った"); assert.equal(an.u2, null, "外れる行は配らない");
  out.push(`    （今日の分：${[...keys].join("・")}・MQL で外した数：${JSON.stringify(td.mql)}）`);
});
await t("MQL 外の理由の API：BALES のリスト（行ごとの理由）と MOCHICALL のリスト（印）。管理者だけ", async () => {
  const b = await call(A, "GET", `/api/mccall/mql/out?bales=${TL}`);
  assert.equal(b.scope, "bales"); assert.equal(b.total, 8); assert.equal(b.out, 5, JSON.stringify(b));
  assert.deepEqual(b.rows.map((x) => x.row_key).sort(), ["r2", "r3", "r4", "r5", "u2"]);
  const r5 = b.rows.find((x) => x.row_key === "r5"); assert.equal(r5.by, "MOCHICALL"); assert.deepEqual(r5.labels, ["オプトアウト"]);
  assert.equal(b.rows.find((x) => x.row_key === "r4").by, "BALES");
  // 担当で絞る：u2 は配っていないので、本人の分は r2〜r5 の4件
  const me = await call(A, "GET", `/api/mccall/mql/out?bales=${TL}&name=${encodeURIComponent(ME)}`);
  assert.equal(me.out, 4, JSON.stringify(me.rows));
  const m = await call(A, "GET", `/api/mccall/mql/out?list=${LA}&limit=3`);
  assert.equal(m.scope, "mochicall"); assert.equal(m.out, 6, JSON.stringify(m)); assert.equal(m.rows.length, 3);
  assert.deepEqual(m.why.map((x) => x.k).sort(), ["account", "lost", "optout", "retire", "source"]);
  assert.equal(m.why.find((x) => x.k === "optout").n, 2);
  const rj = await call(I, "GET", `/api/mccall/mql/out?list=${LA}`, null, true); assert.equal(rj.status, 403, "管理者だけ");
  out.push(`    （BALES のリストの理由：${JSON.stringify(b.why)}）`);
});
await t("MQL を止める（MCCALL_MQL_GATE=0）と、今日の分にも外れる行が入る", async () => {
  process.env.MCCALL_MQL_GATE = "0";
  try {
    const td = await dbm.mcBalesToday(TL, { col: "operatorName", val: ME, rebuild: true });
    for (const k of ["r2", "r3", "r4", "r5"]) assert.ok(td.keys.includes(k), `${k} が入らない：${td.keys}`);
    assert.equal(td.mql, null);
  } finally { delete process.env.MCCALL_MQL_GATE; }
});

console.log = quiet;
console.log(out.join("\n"));
console.log(`\nSF に聞いた回数：リードの項目 ${FAKE.calls.lead}回（${FAKE.calls.leadIds.join("・")}件）・商談中の取引先 ${FAKE.calls.busy}回・索引（リード ${FAKE.calls.idxLead}・取引先 ${FAKE.calls.idxAcct}）・作る ${FAKE.calls.create}回`);
console.log(`${failed ? `${failed} 件 失敗` : "すべて通りました"}（通った ${n} 件）`);
await pool.end().catch(() => {});
process.exit(failed ? 1 : 0);
