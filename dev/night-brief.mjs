// night-brief.mjs — kinbotに溜まった「開発メモ」を読んで、夜の作業指示を書き出す。
//
// GitHub Actionsから呼ばれる。ここでは kinbot に聞きに行くだけで、
// 直す作業は Claude Code が NIGHT_BRIEF.md を読んで行う。
//
// 必要な環境変数
//   KINBOT_URL   … https://kinbot-production-225f.up.railway.app
//   KINBOT_TOKEN … kinbotの API_TOKENS に登録したトークン
//   MAX_ITEMS    … 一度に扱う件数（既定3）

import { appendFileSync, writeFileSync } from "node:fs";

const URL_BASE = (process.env.KINBOT_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.KINBOT_TOKEN || "";
const MAX = Math.max(1, Math.min(10, Number(process.env.MAX_ITEMS) || 3));
// Chatの「〇〇を直して」から渡ってくる指示。あれば、これを最優先で直す。
const FOCUS = String(process.env.FOCUS || "").trim();

// Actionsは、この言葉があるとClaudeを動かさずに終わる。
// 読めなかったときも必ずこれを書く（読めていないのにClaudeを動かすと、
// 何も分からないまま料金だけかかるため）。
const STOP_WORD = "今夜やることはない";

function summary(text) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n");
  }
}

// 直せない事情で終わるとき。赤くして気づけるようにする。
function stop(why) {
  writeFileSync("dev/NIGHT_BRIEF.md", `# 今夜の作業\n\n${why}\n\n${STOP_WORD}。**何も変更せず終わること。**\n`);
  summary(`## 今回やること\n\n**${why}**`);
  console.error(why);
  process.exit(1);
}

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
    stop("設定（KINBOT_URL / KINBOT_TOKEN）がありません。`dev/セットアップ手順.md` の3を見てください。");
  }

  const res = await fetch(`${URL_BASE}/api/dev-notes?status=new`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) throw new Error(`kinbotから読めませんでした（${res.status}）`);
  const data = await res.json();
  const all = data.items || [];

  // 多く起きているもの・不具合を先に。アイデアは自動では直さない（田中さんの方針）。危ないものは外す。
  const rank = { bug: 0, error: 1, gap: 2, request: 3 };
  const pick = all
    .filter((x) => x.kind !== "idea")   // アイデアは対象外（エラー・要望・できないこと・バグだけ直す）
    .filter((x) => !isRisky(`${x.title} ${x.detail || ""}`))
    .sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9) || b.hits - a.hits)
    .slice(0, MAX);

  const skipped = all.filter((x) => x.kind !== "idea" && isRisky(`${x.title} ${x.detail || ""}`));

  const lines = [
    "# 今夜の作業",
    "",
    FOCUS
      ? `田中さんからChatで指示がありました。まずこれを最優先で直す。ほかに ${pick.length}件。`
      : `kinbotに溜まっている「直したいこと」は ${all.length}件。そのうち ${pick.length}件を今夜やる。`,
    "",
    "## やること",
    "",
  ];

  // Chatの「直して」で渡された指示は、いちばん上に置いて最優先で直す。
  let no = 0;
  if (FOCUS) {
    no++;
    lines.push(`### ${no}. [指示] ${FOCUS}`);
    lines.push("");
    lines.push("- 出どころ：Chatの「直して」（田中さんの直接の指示）");
    lines.push("- これを最優先で対応する。内容が大きい・危ういときは、できる範囲で安全にPRにする。");
    lines.push("");
  }

  if (!pick.length && !FOCUS) {
    lines.push(`${STOP_WORD}。**何も変更せず終わること。**`);
  } else {
    pick.forEach((x) => {
      no++;
      lines.push(`### ${no}. [${KIND[x.kind] || x.kind}] ${x.title}`);
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
  // 着手するメモの種類も残す。guard.mjs が「アイデアはPRにする」を判定するのに使う。
  writeFileSync("dev/night-kinds.json", JSON.stringify(pick.map((x) => x.kind)));
  console.log(`今夜の対象：${pick.length}件 / 全部で ${all.length}件`);

  summary([
    "## 今回やること",
    "",
    `溜まっている「直したいこと」は ${all.length}件。そのうち ${pick.length}件をやります。`,
    "",
    ...pick.map((x) => `- [${KIND[x.kind] || x.kind}] ${x.title}（メモID ${x.id}）`),
    ...(skipped.length ? ["", `手を付けないもの：${skipped.length}件（人の判断が要るため）`] : []),
  ].join("\n"));
}

main().catch((e) => {
  stop(`kinbotから読めませんでした：${e.message}`);
});
