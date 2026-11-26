// アポ確率の予測の試験（2026-11-27 オーナー：福井さん「各種切り口からのアポ率を基にして、そのリードの精緻なアポ確率予測を」「優先度という概念を削除」）
//
// 何を確かめるか：
//   1. 計算だけ（server/mcapo.js）：学ぶ・件数の少ない値で暴れない・古い8割で学んで新しい2割で当たり具合を確かめる・未来の情報を混ぜない・
//      「かける」の並びが掛け直しの次はアポ確率の順（前の優先度は効かない）・SF のコンバートの差
//   2. 夜の学び直し（server/mcapojob.js・手元の DB）：記録が「かける前の状態」で学ぶ材料になる・リードと表の行に確率が付く・
//      2回目は前の晩の印で学ぶ（そのとき出していた確率で当たり具合を確かめる）・確率を読む API・管理者だけ
//
// 使い方：dev/mccall_today_test.mjs と同じ（PGlite は dev/demo か MCCALL_TEST_PGLITE）
//   node dev/mcapo_test.mjs
import net from "node:net";
import { register, createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";
import assert from "node:assert/strict";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = 8393, PG_PORT = 18393;

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
const USER = { email: "ippan@test.local", name: "試験 一般" };
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


// ---------- 1. 計算だけ（DB なし） ----------
const { fitApo, scoreApo, backtestApo, featuresOf, liftsOf } = await import(pathToFileURL(path.join(ROOT, "server", "mcapo.js")).href);
const { rankQueue } = await import(pathToFileURL(path.join(ROOT, "server", "mccadence.js")).href);
let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
// 本当のアポ率：失注リサイクル 6%・ListA 2%・BPO 1%、前回が営業フォローなら3倍
const SRC = [["失注リサイクル", 3], ["ListA", 1], ["BPOアウトバウンド", 0.5]];
const synth = (n, t0) => Array.from({ length: n }, (_, i) => {
  const [src, m] = SRC[Math.floor(rnd() * 3)], fol = rnd() < 0.2;
  const at = t0 + i * 60e3;
  const x = featuresOf({ seg: { source: src, pref: rnd() < 0.5 ? "東京都" : "大阪府" }, lastOutcome: fol ? "follow" : "no_answer", lastAt: at - 3 * 864e5, attempts: 1, at });
  return { x, y: rnd() < 0.02 * m * (fol ? 3 : 1) ? 1 : 0, g: i % 3000, at: new Date(at).toISOString() };
});
await t("学ぶ：確率の高い切り口の値ほど高い確率になり、理由に『リード元』『前回の結果』が出る", async () => {
  const m = fitApo(synth(8000, Date.parse("2026-10-01")));
  assert.ok(m.feats.includes("source") && m.feats.includes("prev"), JSON.stringify(m.feats));
  const hi = scoreApo(m, featuresOf({ seg: { source: "失注リサイクル" }, lastOutcome: "follow", lastAt: Date.now() - 3 * 864e5, attempts: 1 }));
  const lo = scoreApo(m, featuresOf({ seg: { source: "BPOアウトバウンド" }, lastOutcome: "no_answer", lastAt: Date.now() - 3 * 864e5, attempts: 1 }));
  assert.ok(hi.p > 0.1 && hi.p < 0.3, `本当は 18%：${hi.p}`); assert.ok(lo.p < 0.02, `本当は 1%：${lo.p}`);
  assert.deepEqual(hi.why.map((w) => w.k).sort(), ["prev", "source"], JSON.stringify(hi.why));
  assert.ok(hi.why.every((w) => w.up) && lo.why.some((w) => !w.up));
});
await t("件数の少ない値でも暴れない（3件中3件アポの値でも、全体の4倍より上にならない）", async () => {
  const S = synth(3000, Date.parse("2026-10-01"));
  for (let i = 0; i < 3; i++) S.push({ x: { ...S[i].x, source: "めずらしい元" }, y: 1, g: 90000 + i, at: S[i].at });
  const m = fitApo(S), p = scoreApo(m, { source: "めずらしい元" }).p;
  assert.ok(p < m.base * 4, `${p} / 全体 ${m.base}`);
});
await t("当たり具合：古い8割で学び新しい2割を当てると、帯ごとの実際のアポ率が予測に近く、並びもでたらめより良い", async () => {
  const bt = backtestApo(synth(10000, Date.parse("2026-09-01")));
  assert.ok(bt.ok, JSON.stringify(bt)); assert.ok(bt.auc > 0.65, `AUC ${bt.auc}`); assert.ok(bt.brier <= bt.brier_base, `${bt.brier} > ${bt.brier_base}`);
  for (const b of bt.bins.filter((x) => x.n >= 300)) assert.ok(Math.abs(b.act - b.pred) < 0.03, JSON.stringify(b));
});
await t("当たり具合：件数が足りなければ確かめずに理由を返す", async () => {
  const bt = backtestApo(synth(40, Date.parse("2026-09-01")));
  assert.equal(bt.ok, false); assert.match(bt.why, /足りません/);
});
await t("未来の情報を混ぜない：作り直し（safe）では、架電より後の失注・アポのあとのステージ・ホット度を使わない", async () => {
  const at = Date.parse("2026-11-20T10:00:00+09:00");
  const seg = { source: "ListA", stage: "05：コンバート", lost: { reason: "タイミング", date: "2026-11-25" } };
  const safe = featuresOf({ seg, hot: 3, at, safe: true }), now = featuresOf({ seg, hot: 3, at: Date.parse("2026-11-27") });
  assert.equal(safe.lost, "失注なし"); assert.equal(safe.stage, undefined); assert.equal(safe.hot, undefined);
  assert.equal(now.lost, "タイミング"); assert.equal(now.hot, "ホット");
  const before = featuresOf({ seg: { ...seg, lost: { reason: "予算", date: "2026-05-01" } }, at, safe: true });
  assert.equal(before.lost, "予算"); assert.equal(before.lostAge, "半年以内");
});
await t("「かける」の並び：約束・時刻が来た掛け直しが先、その後はアポ確率の高い順。前の優先度（prio）は効かない", async () => {
  const past = new Date(Date.now() - 3600e3).toISOString();
  const r = rankQueue([
    { id: 1, apo_p: 0.01, prio: 3 }, { id: 2, apo_p: 0.2, apo_why: [{ label: "リード元", v: "失注リサイクル", up: true, pt: 5 }] }, { id: 3, apo_p: null, hot: 3 },
    { id: 4, next_at: past, next_why: "記録した人が決めた時刻", apo_p: 0 }, { id: 5, next_at: past, next_why: "自動", apo_p: 0 },
  ]);
  assert.deepEqual(r.map((x) => x.id), [4, 5, 2, 1, 3]);
  assert.match(r[2].reasons[0], /リード元「失注リサイクル」で上がった/);
});
await t("SF のコンバートの差：件数の少ない値は1倍に寄せる", async () => {
  const l = liftsOf([{ v: "A", n: 10000, conv: 600 }, { v: "B", n: 10000, conv: 100 }, { v: "C", n: 3, conv: 3 }]);
  assert.ok(l.A > 1.5 && l.B < 0.5, JSON.stringify(l)); assert.ok(l.C < 1.5, `3件中3件でも1.5倍まで：${JSON.stringify(l)}`);
});

// ---------- 2. 夜の学び直し（手元の DB） ----------
for (const u of [ADMIN, USER]) await call(u.email, "POST", "/api/register", { email: u.email, password: PASS, displayName: u.name });
const A = ADMIN.email;
await call(A, "GET", "/api/mccall/lists");   // 表を作らせる
await call(A, "GET", "/api/mochica/bales/lists");
const L1 = (await call(A, "POST", "/api/mccall/lists", { name: "試験リスト", members: [] })).id;
const waitModel = async (after) => { for (let i = 0; i < 120; i++) { const j = await call(A, "GET", "/api/mccall/apo/model"); if (j.made_at && (!after || j.made_at > after)) return j; await new Promise((r) => setTimeout(r, 500)); } throw new Error("学び直しが終わりません"); };
await t("材料が少ないうちは確率を付けない（0件で学んでも、全員に 50% などを付けない）", async () => {
  const t0 = new Date().toISOString(); await call(A, "POST", "/api/mccall/apo/run"); const m0 = await waitModel(t0);
  assert.match(String(m0.cost.skipped || ""), /足りない/, JSON.stringify(m0.cost));
});
// リード 120件：リード元で本当のアポ率を変える（失注リサイクル 15%・ListA 2%）
const ids = [];
for (let i = 0; i < 120; i++) {
  const src = i % 2 ? "失注リサイクル" : "ListA";
  const lost = i === 1 ? { reason: "タイミング", date: "2026-11-26" } : null;   // 架電より後に付いた失注（学ぶときは使わない）
  ids.push((await q(`INSERT INTO mc_call_leads (list_id, src, src_key, company, phone, seg) VALUES ($1,'csv',$5,$2,$3,$4) RETURNING id`,
    [L1, `株式会社 確率${i}`, `03-5555-${String(1000 + i)}`, JSON.stringify({ v: 99, source: src, pref: "東京都", lost }), `試験:${i}`])).rows[0].id);
}
// 架電の記録 1200件（10日ぶん）。prev はかける前の状態
let logN = 0;
for (let d = 0; d < 10; d++) for (let i = 0; i < 120; i++) {
  const src = i % 2 ? "失注リサイクル" : "ListA", apo = rnd() < (src === "失注リサイクル" ? 0.15 : 0.02);
  await q(`INSERT INTO mc_call_logs (lead_id, list_id, biz, caller, reach, outcome, prev, created_at) VALUES ($1,$2,'MOCHICA',$3,$4,$5,$6, $7::timestamptz)`,
    [ids[i], L1, USER.email, apo ? "person" : "none", apo ? "apo" : "no_answer", JSON.stringify({ attempts: d, last_outcome: d ? "no_answer" : null, last_at: d ? new Date(Date.parse("2026-11-10") + (d - 1) * 864e5).toISOString() : null }),
      new Date(Date.parse("2026-11-10T10:00:00+09:00") + d * 864e5 + i * 60e3).toISOString()]); logN++;
}
// リスト管理の表の行（今日の100件の並び・表の「アポ確率」の列に使う）
const LK = "csv:確率";
await q(`INSERT INTO mochica_bales_lists (list_key, name, src, status, cols, run_at) VALUES ($1,'確率','csv','done','[]',now())`, [LK]);
const run = (await q(`SELECT run_at FROM mochica_bales_lists WHERE list_key=$1`, [LK])).rows[0].run_at;
for (const [k, s] of [["r1", "失注リサイクル"], ["r2", "ListA"]]) await q(`INSERT INTO mochica_bales_rows (list_key, row_key, data, run_at) VALUES ($1,$2,$3,$4)`, [LK, k, JSON.stringify({ 会社名: `株式会社 表${k}`, リードソース: s }), run]);

await t("管理者でないと学び直し・中身は見られない", async () => {
  await assert.rejects(call(USER.email, "POST", "/api/mccall/apo/run"), /403/);
  await assert.rejects(call(USER.email, "GET", "/api/mccall/apo/model"), /403/);
});
let m1;
await t("学び直し：記録が全部「かける前の状態」で学ぶ材料になり（印が無いので作り直し）、リードと表の行に確率が付く", async () => {
  const t0 = new Date().toISOString(); await call(A, "POST", "/api/mccall/apo/run"); m1 = await waitModel(t0);
  assert.equal(m1.n, logN, JSON.stringify(m1)); assert.ok(m1.feats.some((f) => f.k === "source"), JSON.stringify(m1.feats.map((f) => f.k)));
  const s = (await q(`SELECT src, count(*)::int n FROM mc_apo_samples GROUP BY src`)).rows; assert.deepEqual(s, [{ src: "rebuild", n: logN }]);
  const lp = (await q(`SELECT seg->>'source' s, avg(apo_p)::float p, count(*) FILTER (WHERE apo_p IS NULL)::int miss FROM mc_call_leads WHERE list_id=$1 GROUP BY 1 ORDER BY 1`, [L1])).rows;
  assert.ok(lp.every((r) => r.miss === 0), JSON.stringify(lp));
  const hi = lp.find((r) => r.s === "失注リサイクル").p, lo = lp.find((r) => r.s === "ListA").p; assert.ok(hi > lo * 3, JSON.stringify(lp));
  const br = (await q(`SELECT row_key, apo_p FROM mochica_bales_rows WHERE list_key=$1 ORDER BY row_key`, [LK])).rows;
  assert.ok(br[0].apo_p > br[1].apo_p, JSON.stringify(br));
  assert.ok(m1.cost && m1.cost.ms >= 0 && m1.cost.leads >= 120 && m1.cost.rows >= 2, JSON.stringify(m1.cost));
  assert.ok(m1.check && m1.check.backtest && m1.check.backtest.ok, JSON.stringify(m1.check));
});
await t("学ぶ材料：架電より後に付いた失注は、学ぶ材料に入れない（予測のときは使う）", async () => {
  const x = (await q(`SELECT s.x FROM mc_apo_samples s WHERE s.lead_id=$1 LIMIT 1`, [ids[1]])).rows[0].x;
  assert.equal(x.lost, "失注なし", JSON.stringify(x));
  const lx = (await q(`SELECT apo_x FROM mc_call_leads WHERE id=$1`, [ids[1]])).rows[0].apo_x; assert.equal(lx.lost, "タイミング");
});
await t("2回目の学び直し：前の晩の印のあとにかけた記録は、そのとき出していた確率つきで学ぶ材料になり、当たり具合（画面に出していた確率で）に入る", async () => {
  for (let i = 0; i < 120; i++) await q(`INSERT INTO mc_call_logs (lead_id, list_id, biz, caller, reach, outcome, prev, created_at) VALUES ($1,$2,'MOCHICA',$3,'none',$4,'{}', now() - interval '1 hour')`,
    [ids[i], L1, USER.email, i % 2 && i % 10 === 1 ? "apo" : "no_answer"]);
  await q(`UPDATE mc_call_leads SET apo_at = now() - interval '2 hours' WHERE list_id=$1`, [L1]);
  await call(A, "POST", "/api/mccall/apo/run"); const m2 = await waitModel(m1.made_at);
  const s = (await q(`SELECT count(*)::int n, count(p)::int np FROM mc_apo_samples WHERE src='snap'`)).rows[0];
  assert.equal(s.n, 120); assert.equal(s.np, 120);
  assert.equal(m2.check.live.n, 120, JSON.stringify(m2.check.live)); assert.ok(m2.history.length >= 2, JSON.stringify(m2.history));
});
await t("確率を読む API：リードの番号・表の行で読める（理由は文になっている）", async () => {
  const j = await call(USER.email, "POST", "/api/mccall/apo/of", { leads: [ids[1]], rows: [{ l: LK, k: "r1" }] });
  assert.ok(j.leads[ids[1]].p > 0); assert.ok(j.rows[`${LK}|r1`].p > 0);
  assert.ok(j.leads[ids[1]].why.some((w) => /リード元「失注リサイクル」で上がった/.test(w)), JSON.stringify(j.leads[ids[1]]));
});

console.log(`
${n} ok / ${failed} NG`);
await pool.end().catch(() => {});
process.exit(failed ? 1 : 0);
