// advisor.mjs — Claudeに考えてもらうための材料を集める。
//
// kinbotから「いまの状態」を読んで、1つのファイルにまとめます。
// このファイルを Claude Code が読んで、改善案を出します。
//
// 必要な環境変数
//   KINBOT_URL   … https://kinbot-production-225f.up.railway.app
//   KINBOT_TOKEN … kinbotの API_TOKENS に登録したトークン

import { writeFileSync } from "node:fs";

const BASE = (process.env.KINBOT_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.KINBOT_TOKEN || "";

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`${path} が読めません（${r.status}）`);
  return r.json();
}

const KIND = { request: "要望", bug: "不具合", error: "エラー", gap: "できないこと", idea: "アイデア" };

async function main() {
  if (!BASE || !TOKEN) {
    writeFileSync("dev/ADVISOR_INPUT.md", "# 材料\n\n設定がありません（KINBOT_URL / KINBOT_TOKEN）。何もしないこと。\n");
    return;
  }

  const out = ["# いまのkinbotの状態", ""];

  // 1. 直したいこと
  try {
    const d = await get("/api/dev-notes?status=new");
    const items = d.items || [];
    out.push(`## 現場から挙がっていること（${items.length}件）`, "");
    if (!items.length) out.push("なし", "");
    for (const x of items.slice(0, 40)) {
      out.push(`- [${KIND[x.kind] || x.kind}] ${x.title}${x.hits > 1 ? `（${x.hits}回）` : ""}` +
        `${x.detail ? `\n    ${String(x.detail).replace(/\n/g, " ").slice(0, 300)}` : ""}`);
    }
    out.push("");
  } catch (e) { out.push(`## 直したいこと\n読めませんでした：${e.message}`, ""); }

  // 2. 自己点検の結果
  try {
    const d = await get("/api/self-check");
    const last = d.last;
    out.push("## 自己点検", "");
    if (!last) out.push("まだ点検していません", "");
    else {
      out.push(`最後の点検：${last.at}／問題 ${last.bad}件`, "");
      for (const c of last.checks || []) {
        out.push(`- ${c.ok ? "OK" : "NG"} ${c.title}：${c.detail}`);
      }
      out.push("");
    }
  } catch (e) { out.push(`## 自己点検\n読めませんでした：${e.message}`, ""); }

  // 3. 画面の見直しの結果
  try {
    const d = await get("/api/ui-review");
    out.push("## 画面の見直し（前回）", "");
    out.push(d.last ? `${d.last.page}（${d.last.at}）\n${d.last.text}` : "まだありません", "");
  } catch (e) { out.push(`## 画面の見直し\n読めませんでした：${e.message}`, ""); }

  // 4. 動いているバージョン
  try {
    const d = await get("/api/version");
    out.push("## いま動いているもの", "", `${d.build}（起動：${d.startedAt}）`, "");
  } catch {}

  writeFileSync("dev/ADVISOR_INPUT.md", out.join("\n") + "\n");
  console.log("材料をまとめました");
}

main().catch((e) => {
  console.error("失敗:", e.message);
  writeFileSync("dev/ADVISOR_INPUT.md", `# 材料\n\n読めませんでした：${e.message}\n何もしないこと。\n`);
});
