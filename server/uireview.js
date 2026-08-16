// ───────────────────────────────────────────────────────────
// uireview.js — 画面の使いやすさを、30分おきに見直す
//
// kinbotが自分の画面（HTML）を読み、AIに「ここが使いにくい」「こう直す」を
// 出してもらいます。出た案は開発メモに残るので、朝のまとめと夜間開発に乗ります。
//
// ★ 守ること
//   ・知らせ先は点検用に指定した1か所だけ。チームのスペースには送らない。
//   ・画面を勝手に書き換えない。案を出すだけ。
// ───────────────────────────────────────────────────────────
import { readFile } from "node:fs/promises";
import path from "node:path";

// 見に行く画面。1回に1つずつ、順番に見る（毎回同じ画面にならないように）。
export const UI_PAGES = [
  { file: "home.html", name: "ホーム", role: "今日の商談と、やり残しを片づける画面。いちばんよく使う。" },
  { file: "apo.html", name: "アポ振り分け", role: "アポの一覧と、割り振りの設定。設定項目が多い。" },
  { file: "docs.html", name: "資料トラッキング", role: "送った資料が読まれたかを見る画面。" },
  { file: "sf-launch.html", name: "Salesforce", role: "商談の立ち上げと、プロセスシートへの書き込み。" },
  { file: "history.html", name: "商談履歴", role: "会社ごとの履歴・要約・録画を見る画面。" },
  { file: "report.html", name: "分析", role: "受注率・温度感などの集計を見る画面。" },
  { file: "settings.html", name: "設定", role: "連携やメンバーの設定。項目が非常に多い。" },
  { file: "dev.html", name: "開発メモ", role: "点検の結果と、直したいことの一覧。" },
];

// kinbotの見た目の決まり。これに反する案を出さないよう、AIにも渡す。
const DESIGN_RULES = [
  "毎日ずっと開いて使う業務システム。見た目の派手さより、迷わないこと・押し間違えないことが大事。",
  "色は緑を基調（#0d5b47 / #1d9e75 / #5DCAA5）。白と淡い緑の背景。",
  "アイコンは絵文字を使わず、線の細いSVG。丸みのある形。",
  "情報はカード型に、つめて並べる。1画面で見渡せることを優先する。",
  "操作は小さなアイコンボタン。押した先が分かるよう、次にすべきものだけ濃い色にする。",
  "文字は日本語。専門用語を避け、何をするボタンかが読めば分かるようにする。",
  "パソコンが中心だが、スマホでも崩れないようにする。",
];

// 画面のHTMLを読む（長すぎるところは切る）
async function readPage(publicDir, file, limit = 14000) {
  try {
    const t = await readFile(path.join(publicDir, file), "utf8");
    // 見た目に関係ない部分（scriptの中身）は落として、構造だけ渡す
    const cleaned = t.replace(/<script[\s\S]*?<\/script>/g, "<script>…</script>");
    return cleaned.slice(0, limit);
  } catch (e) {
    return "";
  }
}

// その画面で使っている見た目の決まり（CSS）だけを取り出す。
//
// HTMLだけ渡すと、AIは「色分けがない」「押せると分からない」と誤解する。
// 実際には選択中の色もホバーもCSSで作ってあるので、そこを一緒に見せる。
export function classNamesIn(html) {
  const set = new Set();
  for (const m of String(html).matchAll(/class="([^"]+)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c && !/^\$/.test(c)) set.add(c);
  }
  return set;
}

export function relevantCss(css, classes, limit = 12000) {
  const out = [];
  // 「セレクタ { 中身 }」のかたまりに分ける（入れ子の @media は中身ごと拾う）
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1].trim();
    if (!sel || sel.startsWith("@")) continue;
    const used = sel.match(/\.([A-Za-z0-9_-]+)/g) || [];
    if (!used.length) continue;
    if (used.some((u) => classes.has(u.slice(1)))) {
      out.push(`${sel} { ${m[2].trim().replace(/\s+/g, " ")} }`);
    }
    if (out.join("\n").length > limit) break;
  }
  return out.join("\n").slice(0, limit);
}

async function readCssFor(publicDir, html) {
  try {
    const css = await readFile(path.join(publicDir, "style.css"), "utf8");
    return relevantCss(css, classNamesIn(html));
  } catch { return ""; }
}

// 次に見る画面を決める（順番に回す）
export function nextPage(index) {
  const i = Number.isFinite(index) ? index : 0;
  return { page: UI_PAGES[i % UI_PAGES.length], next: (i + 1) % UI_PAGES.length };
}

// 1つの画面について、使いやすさの案を作る
export async function reviewPage(publicDir, page, callLLM, extra = "", already = []) {
  const html = await readPage(publicDir, page.file);
  if (!html) return { error: `${page.file} を読めませんでした` };
  if (!callLLM) return { error: "AIが使えません" };
  const css = await readCssFor(publicDir, html);

  const system =
    "あなたは業務システムの画面を見直す専門家です。日本の営業チームが毎日使う画面を、" +
    "使いやすくするための案を出します。\n" +
    "この製品の決まり:\n" + DESIGN_RULES.map((x) => `- ${x}`).join("\n") + "\n\n" +
    "出し方の決まり:\n" +
    "- 日本語。むずかしい言葉を使わない。\n" +
    "- **CSSを必ず読むこと。すでにできていることは提案しない。**\n" +
    "    例：選択中の色・ホバー・カードの枠・影は、たいていCSSで作ってある。\n" +
    "    HTMLに色の指定が無いからといって「色分けがない」と判断しない。\n" +
    "- 「〜をカード型にする」だけの案は出さない。枠が増えるほど、1画面に入る情報が減って使いにくくなる。\n" +
    "- 見た目の好みではなく、**使う人が実際に困ること**を直す案にする。\n" +
    "    （押す場所が分からない／必要な情報が画面の外にある／操作の手数が多い、など）\n" +
    "- 実際に手を動かせる具体的な案だけ。「分かりやすくする」のような曖昧なものは書かない。\n" +
    "- 大きな作り替えは出さない。いまの作りのまま直せることに絞る。\n" +
    "- 効果が大きい順に、多くても3件。**思い当たらなければ「なし」とだけ書く。**\n" +
    "    無理に3件ひねり出さないこと。的外れな案や、前と同じ案は、かえって邪魔になる。\n" +
    "- 同じ画面について何度も見直しているので、たいていは「なし」が正しい答えです。\n" +
    "- 決まりに反する案（絵文字アイコン、色を増やす等）は出さない。\n" +
    "- 次の形だけを書く。前置きや締めの言葉は書かない。\n" +
    "1. 見出し（20字以内）\n" +
    "   いま：〜\n" +
    "   直し方：〜\n" +
    "   効きめ：〜\n";

  const user =
    `画面の名前：${page.name}（${page.file}）\n` +
    `この画面の役目：${page.role}\n` +
    (extra ? `いま困っていること：${extra}\n` : "") +
    (already.length
      ? `\n【前に出した案（${already.length}件）】\n${already.map((x) => `- ${x}`).join("\n")}\n` +
        `この一覧と少しでも同じことを言う案は、絶対に出さないでください。` +
        `言い方を変えただけのもの（例：「分かりやすく」→「明確に」、「配置」→「並び」）も同じ扱いです。\n` +
        `新しく言えることが無ければ、「なし」とだけ書いてください。\n`
      : "") +
    `\n画面の中身（HTML。scriptの中身は省略）:\n"""\n${html}\n"""\n` +
    `\nこの画面で使っている見た目の決まり（CSS。ここに書いてあることは、すでにできている）:\n"""\n${css}\n"""\n`;

  try {
    const text = await callLLM(system, user, 1400, { json: false });
    return { page: page.name, file: page.file, text: String(text || "").trim() };
  } catch (e) {
    return { error: e.message };
  }
}

// 出てきた案を、1件ずつに切り分ける（開発メモに残すため）
export function splitIdeas(text) {
  const out = [];
  // 「なし」と返ってきたら、案は無いものとして扱う
  if (/^\s*(なし|特になし|ありません)\s*$/.test(String(text || ""))) return out;
  const blocks = String(text || "").split(/\n(?=\d+\.\s)/);
  for (const b of blocks) {
    const t = b.trim();
    if (!t) continue;
    const head = (t.split("\n")[0] || "").replace(/^\d+\.\s*/, "").trim();
    if (!head) continue;
    out.push({ title: head.slice(0, 120), detail: t.slice(0, 800) });
  }
  return out;
}
