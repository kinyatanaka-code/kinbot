// 福井さんの直しが MOCHICA の外に出ていないかを、上げる前に確かめる（2026-11-24 田中さん「福井が kincall・kinbot・kinXs の修正はできないようにして」）
//
// なぜ：福井さんの Claude が MOCHICALL のために共通の作り（server/index.js の kincall の選択肢）を直し、
//   kincall の記録でステージを選べなくなったことがあった（2026-11-24）。
//   kincall・kinbot・kinXs は田中さんだけが直す。福井さんが直せるのは MOCHICA（MOCHICALL・リスト管理・Zoom の拡張）だけ。
//
// どう見分けるか：まだ上げていないコミット（origin/main..HEAD）のうち、本文に「開発: 福井」があるものを見る。
//   ・MOCHICA のファイル（下の OK）だけなら通す
//   ・server/index.js・server/db.js は MOCHICA と共通のファイルなので、直したところ1つずつを見て、
//     /api/mochica/・/api/mccall/・Bales など MOCHICA の場所か、BUILD_TAG の行だけなら通す
//   ・画面の HTML は、版の印（?v=…）が変わっただけなら通す（bump-version.mjs で全部の画面が変わるため）
//   それ以外を直していたら止めて、田中さんに頼むよう伝える。
//
// 使い方：bash dev/safe-push.sh の中で自動で動く。単独でも  node dev/owner-guard.mjs
import { execFileSync } from "node:child_process";

const git = (...a) => execFileSync("git", a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// 福井さんが直してよいファイル
const OK = [
  /^public\/(mochica|mc)[^/]*$/,          // MOCHICA・MOCHICALL の画面（mochica.html・mccall.js・mcbales.js など）
  /^public\/[^/]*mochica[^/]*$/,          // MOCHICA のアイコンなど
  /^public\/zoom-ext\//,                  // Zoom の拡張機能
  /^public\/kincall-zoom-ext\.zip$/,      // 拡張機能の zip（build-ext.sh で作る）
  /^server\/mc(?!p\.js$)[^/]*\.js$/,      // MOCHICALL のサーバー（mccall.js など）。mcp.js は kinbot のコネクタなので外す
  /^server\/balesCsv\.js$/,
  /^dev\/mc[^/]*$/, /^dev\/mccall[^/]*$/, // MOCHICALL の確かめ用
  /^dev\/kinbot-memory\.md$/,             // 記憶のログ（直したことを残す決まり）
];
// 共通のファイル（server/index.js・server/db.js）の中で MOCHICA の場所だとわかる印。
//   近くの関数・API の行（@@ のあと）か、直した行そのものに MOCHICA の API・表の名前があるときだけ MOCHICA の直しとみなす。
//   コメントの「MOCHICALL と同じに」のような言葉では通さない（kincall の選択肢を直したコミットがそれで通ってしまうため）
const MC_HEAD = /mochica|mccall|\/api\/mc|[Bb]ales|BALES|\bmc_\w+|_?\bmc[A-Z]\w*|\b_mc\w*/;   // mcTodayBuild・_mcSegCache など MOCHICA の関数・表
const MC_CHANGED = /["'`]\/api\/(mochica|mccall|mc)\b|\bmc_\w+|\bmochica_\w+/i;
const SHARED = new Set(["server/index.js", "server/db.js"]);

const range = process.argv[2] || "origin/main..HEAD";
const shas = git("rev-list", "--reverse", range).split("\n").filter(Boolean);
const bad = [];

for (const sha of shas) {
  const body = git("log", "-1", "--format=%B", sha);
  if (!/開発[:：]\s*福井/.test(body)) continue;
  const files = git("diff-tree", "--no-commit-id", "--name-only", "-r", sha).split("\n").filter(Boolean);
  for (const f of files) {
    if (OK.some((re) => re.test(f))) continue;
    const diff = git("show", "-U0", "--format=", sha, "--", f);
    if (SHARED.has(f)) {
      // 直したところ（@@ で始まる1かたまり）ごとに見る
      const hunks = diff.split(/\n(?=@@ )/).filter((h) => h.startsWith("@@"));
      for (const h of hunks) {
        const changed = h.split("\n").slice(1).filter((l) => /^[+-]/.test(l)).join("\n");
        const head = h.split("\n")[0];   // @@ のあとに、直したところの近くの関数・API の行が出る
        // 版の印（BUILD_TAG の行・BUILD_FEATURES の一覧に1行足す）だけなら通す
        const onlyBuild = changed.split("\n").every((l) => /BUILD_(TAG|FEATURES)|^[+-]\s*$|^[+-]\s*["'`]/.test(l));
        if (onlyBuild && (/BUILD_(TAG|FEATURES)/.test(head) || /BUILD_(TAG|FEATURES)/.test(changed))) continue;
        if (MC_HEAD.test(head) || MC_CHANGED.test(changed)) continue;
        bad.push(`${sha.slice(0, 7)} ${f} ${head.slice(0, 120)}`);
      }
      continue;
    }
    if (/^public\/[^/]*\.html$/.test(f)) {
      // 版の印（?v=…）だけの変化なら通す
      const lines = diff.split("\n").filter((l) => /^[+-](?![+-])/.test(l));
      const strip = (l) => l.slice(1).replace(/\?v=[\w.-]+/g, "?v=");
      const minus = lines.filter((l) => l[0] === "-").map(strip).join("\n");
      const plus = lines.filter((l) => l[0] === "+").map(strip).join("\n");
      if (minus === plus) continue;
    }
    bad.push(`${sha.slice(0, 7)} ${f}`);
  }
}

if (bad.length) {
  console.log("");
  console.log("福井さんの直しに、MOCHICA の外（kincall・kinbot・kinXs・共通の作り）が入っています。");
  console.log("kincall・kinbot・kinXs は田中さんだけが直す決まりです（2026-11-24 田中さん）。このままでは上げられません。");
  for (const b of bad) console.log("  - " + b);
  console.log("MOCHICA の外を直す必要があるときは、何を・なぜ直したいかを田中さんに伝えて、田中さんに直してもらってください。");
  console.log("直したところを外すには、そのファイルを元に戻してコミットし直してください（例：git checkout origin/main -- <ファイル>）。");
  process.exit(1);
}
console.log(`持ち場の確認：OK（見たコミット ${shas.length} 件）`);
