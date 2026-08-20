// gate.mjs — kinbot側の「自動で直す」がONかを確かめる。
//
// 結果を run=true / apply=true の形で書き出します。
// GitHub Actions はこれを読んで、次に進むかどうかを決めます。
//
// 「動いていないのに緑（成功）」がいちばん困る（動いているつもりで放置される）ので、
// 次のように分けています。
//   ・スイッチがOFF          … 正常。緑のまま終わる
//   ・鍵や合言葉が入っていない … 異常。赤くして気づけるようにする
//   ・kinbotにつながらない     … 異常。赤くして気づけるようにする

import { appendFileSync } from "node:fs";

const BASE = (process.env.KINBOT_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.KINBOT_TOKEN || "";

// Actionsの「まとめ」欄に書く。ログを開かなくても状況が分かるようにするため。
function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n");
  }
}

function out(run, apply, why) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\napply=${apply}\n`);
  }
  console.log(`直す：${run ? "はい" : "いいえ"} ／ 本番へ入れる：${apply ? "はい" : "いいえ"}　（${why}）`);
}

// 直せない事情（設定漏れ・kinbotが落ちている）で終わるとき。
// 赤くして、何をすれば直るかを画面に残す。
function stop(why, howto) {
  out(false, false, why);
  summary([
    "## 自動改善は動きませんでした",
    "",
    `**${why}**`,
    "",
    howto,
  ].join("\n"));
  console.error(`\n${why}\n${howto}\n`);
  process.exit(1);
}

const HOWTO_SETTINGS = [
  "直し方（GitHub → Settings → Secrets and variables → Actions）:",
  "",
  "1. Secrets タブ → `KINBOT_TOKEN` に、kinbotの環境変数 `API_TOKENS` に入れた合言葉を登録する",
  "2. Secrets タブ → `ANTHROPIC_API_KEY` に、Anthropicコンソールで作ったAPIキーを登録する",
  "3. Variables タブ → `KINBOT_URL` に kinbotのURLを登録する",
  "",
  "くわしくは `dev/セットアップ手順.md` を見てください。",
].join("\n");

async function main() {
  if (!BASE || !TOKEN) {
    const missing = [!BASE && "KINBOT_URL", !TOKEN && "KINBOT_TOKEN"].filter(Boolean).join(" と ");
    stop(`${missing} が設定されていません`, HOWTO_SETTINGS);
  }

  // 一時的な通信の失敗で赤くしたくないので、1回だけやり直す
  let res = null;
  let lastError = "";
  for (let i = 0; i < 2; i++) {
    try {
      res = await fetch(`${BASE}/api/auto-apply`, { headers: { authorization: `Bearer ${TOKEN}` } });
      break;
    } catch (e) {
      lastError = e.message;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  if (!res) {
    stop(`kinbotにつながりません：${lastError}`,
      "kinbot（Railway）が動いているかを見てください。再起動中なら、次の回で直ります。");
  }

  if (res.status === 401 || res.status === 403) {
    stop("kinbotが合言葉を受け付けませんでした（401/403）",
      "GitHubの `KINBOT_TOKEN` と、kinbotの `API_TOKENS` の合言葉が同じかを確かめてください。\n" +
      "（kinbot側は `合言葉:admin` の形。GitHub側は `:admin` を付けない）");
  }
  if (!res.ok) {
    stop(`kinbotが ${res.status} を返しました`, "kinbot（Railway）のログを見てください。");
  }

  const d = await res.json();
  const hours = d.hours
    ? `いまは${d.hours.now}時（入れてよい時間 ${d.hours.from}〜${d.hours.to}時）`
    : "";
  out(d.enabled === true, d.autoApply === true, hours);

  if (d.enabled !== true) {
    summary([
      "## 自動改善：今回は何もしません",
      "",
      "kinbotの **ツール → 開発メモ → 「1時間ごとに直す」** がOFFになっています。",
      "動かしたいときは、ここをONにしてください。",
    ].join("\n"));
    return;
  }

  summary([
    "## 自動改善：動きます",
    "",
    `- 本番へ入れる：${d.autoApply === true ? "はい" : "いいえ（PRにします）"}`,
    ...(hours ? [`- ${hours}`] : []),
  ].join("\n"));
}

main();
