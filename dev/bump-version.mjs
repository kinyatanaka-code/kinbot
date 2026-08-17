// bump-version.mjs — 画面ファイル（CSS/JS）の版の印をまとめて上げる。
//
// 見た目や画面の動きを直したら、これを実行してください。
// ブラウザが古いファイルを使い続けるのを防ぎます。
//
//   node dev/bump-version.mjs           … 今日の日付で版を付ける（20260818a）
//   node dev/bump-version.mjs 20260818b … 版を指定する

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "public");

// 版を決める。指定がなければ、今日の日付＋アルファベット。
function nextVersion(current) {
  const arg = process.argv[2];
  if (arg) return arg;
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  const ymd = jst.toISOString().slice(0, 10).replace(/-/g, "");
  const cur = String(current || "");
  const m = cur.match(/^(\d{8})([a-z])$/);
  // いまの版が今日以降なら、その次の文字にする。
  // （時計のずれで前の版に戻ってしまうと、ブラウザが古いファイルを使い続けるため）
  if (m && m[1] >= ymd) {
    const next = String.fromCharCode(m[2].charCodeAt(0) + 1);
    return `${m[1]}${next}`;
  }
  return `${ymd}a`;
}

const files = readdirSync(dir).filter((f) => f.endsWith(".html"));
// いまの版を1つ読み取る
let current = "";
for (const f of files) {
  const m = readFileSync(path.join(dir, f), "utf8").match(/style\.css\?v=([^"']+)/);
  if (m) { current = m[1]; break; }
}
const ver = nextVersion(current);

let changed = 0;
for (const f of files) {
  const p = path.join(dir, f);
  const before = readFileSync(p, "utf8");
  // style.css と、同じ場所にある .js に版を付け替える
  const after = before
    .replace(/(href=")(style\.css)(\?v=[^"]*)?(")/g, `$1$2?v=${ver}$4`)
    .replace(/(src=")([a-z0-9\-]+\.js)(\?v=[^"]*)?(")/g, `$1$2?v=${ver}$4`);
  if (after !== before) { writeFileSync(p, after); changed++; }
}

// nav.js が動かして読み込むぶんも合わせる
const navPath = path.join(dir, "nav.js");
try {
  const nav = readFileSync(navPath, "utf8");
  const after = nav.replace(/sc\.src = "kbchat\.js(\?v=[^"]*)?";/, `sc.src = "kbchat.js?v=${ver}";`);
  if (after !== nav) writeFileSync(navPath, after);
} catch {}

console.log(`版を ${current || "（なし）"} → ${ver} にしました（${changed}画面）`);
console.log("server/index.js の BUILD_TAG も忘れずに更新してください。");
