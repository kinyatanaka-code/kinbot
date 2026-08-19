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
    "\n【出してはいけない案】この形のものは、どんな言い方でも書かない:\n" +
    "- 「ラベルにアイコンを付ける」「アイコンを消す」など、見た目の飾りの話\n" +
    "- 「説明文を足す」「補足を出す」など、文章を増やすだけの話\n" +
    "- 「ボタンの位置を変える」「並び順を変える」だけの話\n" +
    "- 「保存したことを知らせる」「処理中と出す」など、たいてい既にできていること\n" +
    "- 「確認ダイアログを出す」など、手数が増えるだけの話\n" +
    "\n【出してよい案】次のどれかに当てはまるものだけ:\n" +
    "- その画面で**やりたいことができない**（機能が無い・行き止まりになる）\n" +
    "- **必要な情報が画面に出ていない**ので、別の画面を開かないと判断できない\n" +
    "- 毎日くり返す操作に、**明らかに余計な手数**がある（3回以上のクリックが1回にできる等）\n" +
    "- **間違えやすく、間違えると困る**（消える・送られる・戻せない）のに、止める仕組みが無い\n" +
    "\n上のどれにも当てはまらないなら、必ず「なし」と書いてください。\n" +
    "3件ひねり出すより、「なし」1つのほうがずっと価値があります。\n" +
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

// 見た目の飾りだけの案は、受け取った側でも捨てる。
// 何度言っても出てくるので、こちらで止める。
const 使えない案 = [
  /アイコン(を|に)?(付|つ|追加|化|削除|消)/,
  /(説明|補足|注釈|ツールチップ|title属性)を?(足|追加|表示|付)/,
  /(ボタン|欄|項目|リンク).{0,20}(配置|位置|並び|順番)/,
  /(ボタン|欄|項目).{0,20}(移動させ|右隣|左隣|上の行|下の行)/,
  /(保存|完了|成功|失敗).{0,10}(メッセージ|フィードバック|表示)/,
  /(処理中|実行中|ローディング|スピナー|プログレスバー)/,
  /確認(ダイアログ|画面)を?(出|表示|設|追加)/,
  /カード(型|形式)に(する|まとめ)/,
  /(色|カラー)を?(分け|変え|付)/,
];

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
    // 見た目の飾りだけの案は残さない
    if (使えない案.some((re) => re.test(t))) {
      console.log(`[画面の見直し] 見た目だけの案なので捨てました：${head.slice(0, 40)}`);
      continue;
    }
    out.push({ title: head.slice(0, 120), detail: t.slice(0, 800) });
  }
  return out;
}
