// report.mjs — 作業の結果を kinbot に送る（Chatへ流してもらうため）。
//
// 使い方: node dev/report.mjs <種類>
//   applied … 1時間ごとの自動改善の結果
//   night   … 夜間開発の結果
//   advice  … 定期提案の内容

import { readFileSync } from "node:fs";

const BASE = (process.env.KINBOT_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.KINBOT_TOKEN || "";
const kind = process.argv[2] || "applied";

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

const runUrl = `${process.env.GITHUB_SERVER_URL || ""}/${process.env.GITHUB_REPOSITORY || ""}` +
  `/actions/runs/${process.env.GITHUB_RUN_ID || ""}`;

const PATHS = { applied: "/api/dev-notes/applied", night: "/api/dev-notes/night-report", advice: "/api/dev-notes/advice" };

async function main() {
  if (!BASE || !TOKEN) { console.log("設定がないので送りません"); return; }

  let body = {};
  if (kind === "advice") {
    const text = read("dev/ADVISOR_OUT.md");
    if (!text.trim()) { console.log("案が無いので送りません"); return; }
    body = { text, runUrl };
  } else if (kind === "night") {
    body = { changed: process.env.CHANGED === "true", result: read("dev/NIGHT_RESULT.md").slice(0, 2000), runUrl };
  } else {
    body = {
      applied: !!process.env.APPLIED_SHA,
      sha: process.env.APPLIED_SHA || "",
      guard: readJson("dev/GUARD.json"),
      result: read("dev/NIGHT_RESULT.md").slice(0, 1500),
      runUrl,
    };
  }

  try {
    const r = await fetch(`${BASE}${PATHS[kind] || PATHS.applied}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(body),
    });
    console.log("kinbotへ送りました:", r.status);
  } catch (e) {
    console.log("送れませんでした:", e.message);
  }
}

main();
