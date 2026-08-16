// gate.mjs — kinbot側の「自動で直す」がONかを確かめる。
//
// 結果を run=true / apply=true の形で書き出します。
// GitHub Actions はこれを読んで、次に進むかどうかを決めます。

import { appendFileSync } from "node:fs";

const BASE = (process.env.KINBOT_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.KINBOT_TOKEN || "";

function out(run, apply, why) {
  const line = `run=${run}\napply=${apply}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
  console.log(`直す：${run ? "はい" : "いいえ"} ／ 本番へ入れる：${apply ? "はい" : "いいえ"}　（${why}）`);
}

async function main() {
  if (!BASE || !TOKEN) {
    out(false, false, "KINBOT_URL か KINBOT_TOKEN が設定されていません");
    return;
  }
  try {
    const r = await fetch(`${BASE}/api/auto-apply`, { headers: { authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) { out(false, false, `kinbotが ${r.status} を返しました`); return; }
    const d = await r.json();
    out(d.enabled === true, d.autoApply === true,
      d.hours ? `いまは${d.hours.now}時（入れてよい時間 ${d.hours.from}〜${d.hours.to}時）` : "");
  } catch (e) {
    out(false, false, `kinbotにつながりません：${e.message}`);
  }
}

main();
