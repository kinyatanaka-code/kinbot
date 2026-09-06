// precheck.mjs — 本番に上げる前の「精度チェック」を1コマンドにまとめる。
//
// この開発で実際にやらかした失敗を、機械で拾えるものは全部拾う：
//   ・str_replace後の構文エラー（server/*.js を node --check）
//   ・フロントJSの構文エラー（public/*.js を new Function でパース）
//   ・HTMLタグの不整合（div/section/select/textarea/style/button の開閉数）
//   ・本番に混ぜてはいけないファイル（package-lock.json / 文字化け名 #U…）
//   ・BUILD_TAG の存在
//   ・smoke（起動＋主要エンドポイント）※ node dev/smoke.mjs
//
// 使い方:  node dev/precheck.mjs
//   すべてOKなら「精度チェック：すべてOK」と出て終了コード0。
//   1つでも致命（FAIL）があれば終了コード1（＝pushしない合図）。WARNは注意のみ。
//
// ねらい：人手の確認を毎回きちんと回すのは抜ける。機械に固定させて精度を底上げする。

import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
let fails = 0, warns = 0;
const ok = (m) => console.log("  OK   " + m);
const warn = (m) => { warns++; console.log("  WARN " + m); };
const fail = (m) => { fails++; console.log("  FAIL " + m); };

function listFiles(dir, exts) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === "node_modules" || name.startsWith(".git")) continue;
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (exts.some((e) => name.endsWith(e))) out.push(p);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

// 1) サーバJS：node --check（TDZや実行時までは見ないが、構文崩れは確実に拾う）
console.log("[1] サーバJSの構文チェック（node --check）");
for (const f of listFiles(join(ROOT, "server"), [".js"])) {
  try { execSync(`node --check "${f}"`, { stdio: "pipe" }); }
  catch (e) { fail(`${f}: ${String(e.stderr || e.message).split("\n")[0]}`); }
}
if (!fails) ok("server/*.js 構文OK");

// 2) フロントJS：new Function でパース
console.log("[2] フロントJSのパース（new Function）");
let feFail = 0;
for (const f of listFiles(join(ROOT, "public"), [".js"])) {
  try { new Function(readFileSync(f, "utf8")); }
  catch (e) { feFail++; fail(`${f}: ${e.message}`); }
}
if (!feFail) ok("public/*.js パースOK");

// 3) HTMLタグ均衡
console.log("[3] HTMLタグの開閉数（div/section/select/textarea/style/button）");
const tags = ["div", "section", "select", "textarea", "style", "button"];
let htmlBad = 0;
for (const f of listFiles(join(ROOT, "public"), [".html"])) {
  const h = readFileSync(f, "utf8");
  for (const t of tags) {
    const open = (h.match(new RegExp(`<${t}[\\s>]`, "g")) || []).length;
    const close = (h.match(new RegExp(`</${t}>`, "g")) || []).length;
    if (open !== close) { htmlBad++; fail(`${f} <${t}> 開=${open} 閉=${close}`); }
  }
}
if (!htmlBad) ok("public/*.html タグ均衡OK");

// 4) 混入ファイル（pushで弾いているが、存在自体を注意）
console.log("[4] 本番に混ぜないファイル");
if (existsSync(join(ROOT, "package-lock.json"))) warn("package-lock.json が作業ツリーにあります（pushには含めないこと）");
const mojibake = listFiles(ROOT, [".md", ".html", ".js"]).filter((f) => /#U[0-9a-fA-F]{4}/.test(f));
if (mojibake.length) warn(`文字化け名(#U…)のファイル ${mojibake.length}件（pushには含めないこと）: ${mojibake.map((x) => x.replace(ROOT + "/", "")).slice(0, 3).join(", ")}`);
if (!existsSync(join(ROOT, "package-lock.json")) && !mojibake.length) ok("混入ファイルなし");

// 5) BUILD_TAG の存在
console.log("[5] BUILD_TAG");
try {
  const idx = readFileSync(join(ROOT, "server", "index.js"), "utf8");
  const m = idx.match(/const BUILD_TAG = "([^"]+)"/);
  if (!m) fail("server/index.js に BUILD_TAG が見つかりません");
  else ok(`BUILD_TAG = ${m[1].slice(0, 24)}…`);
} catch (e) { fail("server/index.js が読めません：" + e.message); }

// 6) smoke（起動＋主要エンドポイント）
console.log("[6] smoke（node dev/smoke.mjs）");
try {
  const out = execSync("node dev/smoke.mjs", { stdio: "pipe", cwd: ROOT }).toString();
  if (/すべて動きました/.test(out)) ok("smoke OK");
  else { fail("smoke が『すべて動きました』を返しませんでした"); console.log(out.split("\n").slice(-6).join("\n")); }
} catch (e) { fail("smoke 失敗：" + String(e.stderr || e.message).split("\n").slice(-3).join(" ")); }

// まとめ
console.log("─".repeat(40));
if (fails) { console.log(`精度チェック：FAIL ${fails}件 / WARN ${warns}件 → pushしないこと`); process.exit(1); }
console.log(`精度チェック：すべてOK（WARN ${warns}件）`);
