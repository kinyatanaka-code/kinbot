// 名簿の人を kinbot のログインのメールアドレスで結びつける（2026-11-23 福井さん決定「本人をメールで登録する」）
//
// なぜ要るか：
//   MOCHICA のインターン判定・架電の管理者・ダッシュボードの名簿は、これまで「名前の一致」だけで人を決めていた。
//   名前は書き方の揺れ（異体字・ローマ字・姓名の順）で外れることがあり、外れるとその人の「かける」に何も出ない。
//   逆に、同じ名前の別の人が入り込むおそれもある。
//   そこで管理者が画面で「名簿のこの人＝このメール」と登録できるようにし、判定はメールを最優先にする。
//   メールが未登録の人だけ、今までの名前の照合（mcname.js）で補う。
//
// 表は mc_people を足すだけ（既存の表は変えない）。前の版に戻しても、この表が使われなくなるだけで壊れない。
import { dbPool } from "./db.js";
import { MCDASH_ROSTER } from "./mcdash.js";

// 架電の管理者の名簿（苗字）。名前で補うときは異体字をそろえて比べるので、齊藤／斉藤／斎藤は1つでよい
export const MCCALL_ADMIN_SURNAMES = ["福井", "本炭", "餌取", "齊藤", "北川", "山田"];
export const PEOPLE_KINDS = { is: "インサイド", sales: "営業（FS）", admin: "架電の管理者" };

// 名簿の行（種類・鍵・画面に出す名前）。鍵はインサイド＝SF の氏名、営業＝ダッシュボードの key、管理者＝苗字
export function rosterRows() {
  return [
    ...MCDASH_ROSTER.is.map((p) => ({ kind: "is", key: p.sf, label: p.sf, p })),
    ...MCDASH_ROSTER.sales.map((p) => ({ kind: "sales", key: p.key, label: p.key, p })),
    ...MCCALL_ADMIN_SURNAMES.map((s) => ({ kind: "admin", key: s, label: `${s}（苗字）`, p: { name: s } })),
  ];
}

const P = () => dbPool();
let _ready = false;
let _cache = null;
async function ensurePeople() {
  if (_ready) return;
  // 1つのメールが種類ごとに1行（営業と管理者を兼ねる人＝齊藤・餌取・本炭さんがいるため、メールだけを主キーにしない）
  await P().query(`CREATE TABLE IF NOT EXISTS mc_people (
    email TEXT NOT NULL, kind TEXT NOT NULL, roster_key TEXT NOT NULL, by_user TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (email, kind))`);
  await P().query(`CREATE INDEX IF NOT EXISTS ix_mc_people_key ON mc_people(kind, roster_key)`);
  _ready = true;
}
// メール → { 種類: 鍵 }（例 { sales: "齊藤玲耶", admin: "齊藤" }）。30秒は覚えておく（ログインのたびに判定で読むため）。
//   読めないときは空で返す（名前の照合で補えるので、ログインや架電を止めない）
export async function loadPeople(force = false) {
  if (!P()) return new Map();
  if (!force && _cache && Date.now() - _cache.at < 30 * 1000) return _cache.map;
  try {
    await ensurePeople();
    const { rows } = await P().query(`SELECT email, kind, roster_key FROM mc_people`);
    const map = new Map();
    for (const r of rows) { const e = String(r.email).toLowerCase(); map.set(e, { ...(map.get(e) || {}), [r.kind]: r.roster_key }); }
    _cache = { at: Date.now(), map };
    return map;
  } catch (e) {
    console.error("[mcpeople] 名簿のメールを読めませんでした（名前の照合だけで判定します）", e.message);
    return (_cache && _cache.map) || new Map();
  }
}
// その種類でメールが登録済みの鍵（名前の照合から外す＝同じ名前の別の人が入り込まないように）
export function registeredKeys(people, kind) {
  const s = new Set(); for (const v of people.values()) if (v[kind]) s.add(v[kind]); return s;
}
// 鍵 → 登録されたメール
export function emailOf(people, kind, key) {
  for (const [e, v] of people) if (v[kind] === key) return e;
  return "";
}
// 名簿の1行にメールを結びつける（空なら外す）。1行に1つのメール。1つのメールは種類ごとに1行だけ（営業と管理者の両方には入れる）
export async function setPerson(kind, key, email, by) {
  await ensurePeople();
  const e = String(email || "").trim().toLowerCase();
  await P().query(`DELETE FROM mc_people WHERE kind=$1 AND roster_key=$2`, [kind, key]);
  if (e) await P().query(`INSERT INTO mc_people (email, kind, roster_key, by_user, updated_at) VALUES ($1,$2,$3,$4,now())
    ON CONFLICT (email, kind) DO UPDATE SET roster_key=$3, by_user=$4, updated_at=now()`, [e, kind, key, by || null]);
  _cache = null;
}
