// night-brief.mjs — kinbotに溜まった「開発メモ」を読んで、夜の作業指示を書き出す。
//
// GitHub Actionsから呼ばれる。ここでは kinbot に聞きに行くだけで、
// 直す作業は Claude Code が NIGHT_BRIEF.md を読んで行う。
//
// 必要な環境変数
//   KINBOT_URL   … https://kinbot-production-225f.up.railway.app
//   KINBOT_TOKEN … kinbotの API_TOKENS に登録したトークン
//   MAX_ITEMS    … 一度に扱う件数（既定3）

import { writeFileSync } from "node:fs";

const URL_BASE = (process.env.KINBOT_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.KINBOT_TOKEN || "";
const MAX = Math.max(1, Math.min(10, Number(process.env.MAX_ITEMS) || 3));

const KIND = { request: "要望", bug: "不具合", error: "エラー", gap: "できないこと", idea: "アイデア" };

// 手を出さないほうがよいもの（人の判断が要る／夜に自動で触ると危ない）
const RISKY = [
  /salesforce.*(コンバート|立ち上げ|変換)/i,
  /(削除|消す|消去).*(全部|すべて|一括)/,
  /(料金|課金|請求|支払)/,
  /(権限|パスワード|トークン|鍵)/,
];

function isRisky(t) {
  return RISKY.some((re) => re.test(String(t || "")));
}

async function main() {
  if (!URL_BASE || !TOKEN) {
    writeFileSync("dev/NIGHT_BRIEF.md", "# 今夜の作業\n\n設定（KINBOT_URL / KINBOT_TOKEN）がありません。何もしません。\n");
    console.log("設定がないので終わります");
    return;
  }

  const res = await fetch(`${URL_BASE}/api/dev-notes?status=new`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`kinbotから読めませんでした（${res.status}）`);
  const data = await res.json();
  const all = data.items || [];

  // 多く起きているもの・不具合を先に。危ないものは外す。
  const rank = { bug: 0, error: 1, gap: 2, request: 3, idea: 4 };
  const pick = all
    .filter((x) => !isRisky(`${x.title} ${x.detail || ""}`))
    .sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) || b.hits - a.hits)
    .slice(0, MAX);

  const skipped = all.filter((x) => isRisky(`${x.title} ${x.detail || ""}`));

  const lines = [
    "# 今夜の作業",
    "",
    `kinbotに溜まっている「直したいこと」は ${all.length}件。そのうち ${pick.length}件を今夜やる。`,
    "",
    "## やること",
    "",
  ];

  if (!pick.length) {
    lines.push("今夜やることはない。**何も変更せず終わること。**");
  } else {
    pick.forEach((x, i) => {
      lines.push(`### ${i + 1}. [${KIND[x.kind] || x.kind}] ${x.title}`);
      lines.push("");
      lines.push(`- メモID：${x.id}`);
      lines.push(`- 起きた回数：${x.hits}`);
      if (x.source) lines.push(`- 出どころ：${x.source}`);
      if (x.detail) lines.push(`- 詳しく：${String(x.detail).replace(/\n/g, " ").slice(0, 500)}`);
      lines.push("");
    });
  }

  if (skipped.length) {
    lines.push("## 今夜は手を付けないもの（人の判断が要る）", "");
    for (const x of skipped) lines.push(`- ${x.title}`);
    lines.push("");
  }

  lines.push(
    "## 進め方",
    "",
    "1. `CLAUDE.md` の決まりを守る。",
    "2. 1件ずつ、関係するファイルを読んでから直す。",
    "3. 直したら `node --check` と、サーバーの起動を必ず確かめる。",
    "4. 自信が持てないものは**手を付けず**、PRの本文に理由を書く。",
    "5. できたぶんだけを1つのPRにまとめ、本文に「どのメモを直したか（メモID）」を書く。",
    "",
    "**mainに直接pushしない。必ずPRにする。**",
  );

  writeFileSync("dev/NIGHT_BRIEF.md", lines.join("\n") + "\n");
  writeFileSync("dev/night-ids.json", JSON.stringify(pick.map((x) => x.id)));
  console.log(`今夜の対象：${pick.length}件 / 全部で ${all.length}件`);
}

main().catch((e) => {
  console.error("失敗:", e.message);
  writeFileSync("dev/NIGHT_BRIEF.md", `# 今夜の作業\n\nkinbotから読めませんでした：${e.message}\n何もしないこと。\n`);
});
