// guard.mjs — 「この変更を、人の確認なしで本番に入れてよいか」を判定する。
//
// 自動で入れてよいのは、小さくて・戻しやすくて・お金や権限に関係しない変更だけ。
// 少しでも引っかかったら、本番には入れずPR（人が見る形）にします。
//
// 使い方: node dev/guard.mjs   → 標準出力に判定を出し、dev/GUARD.json に残す
//   ok=true  … 自動で入れてよい
//   ok=false … PRにする（理由つき）

import { execSync } from "node:child_process";
import { appendFileSync, writeFileSync, readFileSync } from "node:fs";

// 変えてはいけないところ（ここに触れていたら、必ず人が見る）
const PROTECTED = [
  { re: /^\.github\//, why: "動かし方の設定" },
  { re: /^package\.json$/, why: "使う部品の一覧" },
  { re: /^server\/salesforce\.js$/, why: "Salesforceの書き込み" },
  { re: /^server\/autolaunch\.js$/, why: "Salesforceの立ち上げ" },
  { re: /^CLAUDE\.md$/, why: "開発の決まり" },
];

// 差分の中に出てきたら止める言葉
const DANGER = [
  { re: /\bDROP\s+(TABLE|COLUMN|INDEX)\b/i, why: "データを消す変更" },
  { re: /\bDELETE\s+FROM\b/i, why: "データを消す変更" },
  { re: /\bTRUNCATE\b/i, why: "データを消す変更" },
  { re: /convertLead|updateLead|createOpportunity/i, why: "Salesforceを書き換える処理" },
  { re: /deleteCalendarEvent|calendars\/.*\/events\/.*delete/i, why: "カレンダーを消す処理" },
  { re: /notifyAll\s*\(/, why: "全員宛の通知（チームに流れる恐れ）" },
  { re: /process\.env\.[A-Z_]+\s*=\s*/, why: "設定値の書き換え" },
  { re: /(API_TOKENS|SESSION_SECRET|CLIENT_SECRET|PRIVATE_KEY)/, why: "鍵や合言葉に関わる変更" },
];

const MAX_FILES = 6;
const MAX_LINES = 250;

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

// Actionsの「まとめ」欄に書く。ログを開かなくても状況が分かるようにするため。
function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n");
  }
}

function main() {
  const reasons = [];

  // 新しく作ったファイルは git diff に出てこない（まだgitが知らないため）。
  // 印だけ付けて、diffに出るようにする。これをしないと、ファイルを1つ増やす
  // 直し方をしたときに「変更なし」と誤って判定してしまう。
  sh("git add -A -N");

  const files = sh("git diff --name-only").split("\n").filter(Boolean);

  if (!files.length) {
    const r = { ok: false, changed: false, reasons: ["変更がありません"], files: [] };
    writeFileSync("dev/GUARD.json", JSON.stringify(r, null, 2));
    console.log("変更なし");
    summary("## 変更の確認\n\n今回は変更がありませんでした。");
    return;
  }

  if (files.length > MAX_FILES) reasons.push(`触ったファイルが多い（${files.length}／上限${MAX_FILES}）`);

  for (const f of files) {
    const hit = PROTECTED.find((p) => p.re.test(f));
    if (hit) reasons.push(`${f} は自動で変えない（${hit.why}）`);
  }

  // 足した行だけを見る
  const diff = sh("git diff -U0");
  const added = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  const removed = diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---"));
  const lines = added.length + removed.length;
  if (lines > MAX_LINES) reasons.push(`変更が大きい（${lines}行／上限${MAX_LINES}行）`);

  const addedText = added.join("\n");
  for (const d of DANGER) {
    if (d.re.test(addedText)) reasons.push(`${d.why}が含まれている`);
  }

  // アイデア（idea）の変更は、確実な不具合と違って人の判断が要る。
  // 田中さんの方針で、アイデアを含むぶんは本番に直接入れず、必ずPRにする。
  try {
    const kinds = JSON.parse(readFileSync("dev/night-kinds.json", "utf8"));
    if (Array.isArray(kinds) && kinds.includes("idea")) {
      reasons.push("アイデアの変更は人が見る（PRにする）");
    }
  } catch { /* ファイルが無ければ、種類は問わない */ }

  const r = {
    ok: reasons.length === 0,
    changed: true,
    files,
    lines,
    reasons: reasons.length ? reasons : ["小さく安全な変更です"],
  };
  writeFileSync("dev/GUARD.json", JSON.stringify(r, null, 2));
  console.log(r.ok ? `自動で入れてよい（${files.length}ファイル・${lines}行）` : `人が見る：${reasons.join(" / ")}`);

  summary([
    "## 変更の確認",
    "",
    r.ok ? "小さく安全な変更です。このまま本番に入れられます。" : "人が見たほうがよい変更です。PRにします。",
    "",
    `- 触ったファイル：${files.join("、")}`,
    `- 変わった行：${lines}行`,
    ...(r.ok ? [] : ["", "理由：", ...reasons.map((x) => `- ${x}`)]),
  ].join("\n"));
}

main();
