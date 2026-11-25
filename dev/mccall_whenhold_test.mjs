// 検討時期待ちの判定（whenStateSql・whenHoldSql）の試験（2026-11-25 福井さん「SF 検討開始時期が3月など時期が違いすぎる企業は、適切な時期以外かけない。
//   ただし情報源が1年以上前なら古い情報の可能性があるので架電可能」）
//
// 何を確かめるか（月は今日の月からの相対で作るので、いつ回しても通る）：
//   1. 検討時期が3か月以上先で、情報が新しい → 時期待ち（かけない）。2か月先までは かける
//   2. 情報が1年以上前 → 時期は先でも かける（stale）
//   3. 月だけ（「3月」）は情報の日付から見て次に来るその月：前に聞いた月がもう過ぎていれば かける
//   4. 架電で「未定」と聞けた・人と約束した掛け直しは、SF の月が先でも出す
//   5. 日付が分からないときは新しい情報とみなす（時期待ち）。SF の最終活動日（seg.sfAct）があればそれを使う
//
// 使い方：MCCALL_TEST_PGLITE=<pglite の node_modules がある場所> node dev/mccall_whenhold_test.mjs（無ければ dev/demo）
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const pgDir = process.env.MCCALL_TEST_PGLITE || path.join(HERE, "demo");
const { PGlite } = await import(pathToFileURL(createRequire(path.join(pgDir, "package.json")).resolve("@electric-sql/pglite")).href);
for (const k of Object.keys(process.env)) if (/^(DATABASE_URL|PG)/.test(k)) delete process.env[k];   // 本物のデータベースにつながないように
const { whenStateSql, whenHoldSql } = await import(pathToFileURL(path.join(HERE, "..", "server", "mccall.js")).href);
const { WHY_HUMAN } = await import(pathToFileURL(path.join(HERE, "..", "server", "mccadence.js")).href);

const db = await PGlite.create();
await db.exec(`CREATE TABLE c (id int, hearing jsonb, seg jsonb, last_at timestamptz, when_src_at timestamptz, next_why text)`);
const jst = new Date(Date.now() + 9 * 3600e3);
const nowM = jst.getUTCMonth() + 1, nowY = jst.getUTCFullYear();
const mAhead = (k) => ((nowM - 1 + k) % 12 + 12) % 12 + 1;   // k か月先の月（1〜12）
const ymAhead = (k) => { const t = nowY * 12 + (nowM - 1) + k; return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, "0")}`; };
const daysAgo = (d) => new Date(Date.now() - d * 86400e3).toISOString();
const atPast = new Date(Date.now() - 300 * 86400e3);   // 300日前に聞いた
const pastNext = ((atPast.getUTCMonth() + 1) % 12) + 1;   // その翌月（もう過ぎている。日付なしで読むと3か月ほど先になる月）

const cases = [
  // [id, 説明, hearing, seg, last_at, when_src_at, next_why, 期待する状態, 期待する hold]
  [1, "SF の月が4か月先・情報が新しい → 時期待ち", null, { whenYm: String(mAhead(4)) }, null, daysAgo(10), null, "hold", true],
  [2, "SF の月が2か月先 → かける", null, { whenYm: String(mAhead(2)) }, null, daysAgo(10), null, "ok", false],
  [3, "年つきで7か月先・情報が1年以上前 → かける（古い）", null, { whenYm: ymAhead(7) }, null, daysAgo(400), null, "stale", false],
  [4, "架電で聞いた月が4か月先（聞いたのは5日前）→ 時期待ち", { when: `${mAhead(4)}月`, at: daysAgo(5) }, {}, null, null, null, "hold", true],
  [5, "300日前に聞いた月はもう過ぎた → かける", { when: `${pastNext}月`, at: atPast.toISOString() }, {}, null, null, null, "ok", false],
  [6, "架電で未定と聞けた（SF は4か月先）→ かける", { when: "未定", at: daysAgo(3) }, { whenYm: String(mAhead(4)) }, null, daysAgo(10), null, "ok", false],
  [7, "時期待ちでも人と約束した掛け直しは出す", null, { whenYm: String(mAhead(5)) }, null, daysAgo(10), WHY_HUMAN, "hold", false],
  [8, "日付が分からない → 新しい情報とみなして時期待ち", null, { whenYm: String(mAhead(4)) }, null, null, null, "hold", true],
  [9, "書かれた日が未調査でも SF の最終活動日が1年以上前 → かける", null, { whenYm: ymAhead(6), sfAct: daysAgo(500) }, null, null, null, "stale", false],
  [10, "検討時期なし → かける", null, {}, null, null, null, "ok", false],
  [11, "年つきで過ぎた → かける", null, { whenYm: ymAhead(-2) }, null, daysAgo(10), null, "ok", false],
  [12, "架電で聞いた月（聞いた日が無い）は最後にかけた日で読む：3日前に聞いた4か月先 → 時期待ち", { when: `${mAhead(4)}月` }, {}, daysAgo(3), null, null, "hold", true],
];
for (const [id, , h, s, la, wa, nw] of cases)
  await db.query(`INSERT INTO c VALUES ($1,$2,$3,$4,$5,$6)`, [id, h && JSON.stringify(h), JSON.stringify(s), la, wa, nw]);
const rows = new Map((await db.query(`SELECT id, ${whenStateSql("c")} AS st, ${whenHoldSql("c")} AS hold FROM c`)).rows.map((r) => [r.id, r]));
let ok = 0;
for (const [id, label, , , , , , st, hold] of cases) {
  const r = rows.get(id);
  assert.equal(r.st, st, `${id}. ${label}：状態 ${r.st}（期待 ${st}）`);
  assert.equal(r.hold, hold, `${id}. ${label}：出さない ${r.hold}（期待 ${hold}）`);
  console.log(`OK ${id}. ${label}`); ok++;
}
console.log(`\n${ok}/${cases.length} 件 通りました`);
process.exit(0);
