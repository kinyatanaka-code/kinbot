// 架電画面「ひと目で」の採用ニーズ欄を読みやすくする（2026-11-26 福井さん「ニーズの部分が超見にくい。失注理由・採用ニーズのみの抽出に」）
//   SF の「顧客の現状」は商談メモをそのまま貼ったもので、連絡先・日程・人名まで入っていて長い。
//   そこで AI は使わず（費用をかけないため）、決まった言い方だけを拾う：
//   ・失注理由 … SF の失注理由（大/中/小/詳細）と、本文の「お断り」「導入する気がない」などの1文
//   ・採用の数字 … 採用目標人数・内定承諾人数・母集団形成・予算・説明会参加・選考へ進んだ人数 など
//   連絡先（メール・電話）・商談日程・担当者名は、拾う対象に入れないので出ない。

// 本文を「1項目＝1行」にそろえる。SF はHTMLの改行、Bales は改行がつぶれて空白でつながっていることがあるため
function lines(t) {
  return String(t || "").replace(/\r/g, "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ")
    .replace(/[ \t　]*(■|◆|【)/g, "\n$1").replace(/(^|[ \t　])[・●]/g, "\n・");
}
// 値の後ろの「（調べてくれた）」「（Must）」のような書き手のメモ・言いさしを外す
const tidy = (v) => String(v || "").replace(/[（(][^）)]{0,15}[）)]/g, "").replace(/[ \t　]+/g, " ").replace(/^[、,。:：\s]+|[、,。:：？?\s]+$/g, "").trim();
const unsafe = (v) => /@[\w.-]+\.[a-z]{2,}/i.test(v) || /0\d{1,4}-\d{1,4}-\d{3,4}/.test(v);
const cut = (v, n) => (v.length > n ? v.slice(0, n - 1) + "…" : v);

// 拾う項目：[画面の見出し, 見出しの言い方]。上から順に、同じ見出しは最初に当たったものだけ
const FACTS = [
  ["採用目標", /採用(?:目標|予定)(?:人数|数)?/],
  ["内定承諾", /内定承諾(?:人数|数|者数)?/],
  ["母集団形成", /母集団形成(?:の?方法|の?手法)?|利用(?:中の)?媒体|使っている媒体/],
  ["予算・単価", /(?:一人当たりの)?採用単価|採用予算|媒体(?:に使える)?予算/],
  ["説明会参加", /説明会(?:の)?参加(?:者)?数?/],
  ["エントリー", /エントリー数/],
  ["採用職種", /(?:採用|募集)職種/],
  ["採用の課題", /採用(?:の)?課題|困っていること/],
];
// 値の終わり：改行・次の見出し・「（」・文の終わり
const END = /[\n■◆【（(？?。]|[ \t　][^\s：:■・]{2,24}[：:]/;

function pickFacts(text) {
  const t = lines(text); const out = new Map();
  for (const [label, re] of FACTS) {
    if (out.has(label)) continue;
    const m = new RegExp(`(?:${re.source})(?:[（(][^）)\\n]{0,15}[）)])?\\s*(?:[：:]|は[、,]?|が[、,]?)\\s*`, "g");
    let x;
    while ((x = m.exec(t))) {
      const rest = t.slice(x.index + x[0].length); const e = rest.search(END);
      let v = tidy(e < 0 ? rest : rest.slice(0, e));
      if (!v || unsafe(v) || /^(なし|無し|不明|未確認|-)$/.test(v) && label !== "母集団形成") continue;
      if (label === "採用目標" && /^\d+$/.test(v)) v += "名";
      out.set(label, cut(v, 40)); break;
    }
  }
  // 「選考（面接）に移ったのは、年間31人くらい」のように見出しの無い言い方
  const s = t.match(/(?:選考|面接)[^\n。■]{0,8}?(?:移|進)[っん]た(?:の|人数|人)?は?[、,\s]*([^\n。■？?（(]{1,20}人[^\n。■？?（(]{0,6})/);
  if (s && !out.has("選考へ進んだ")) out.set("選考へ進んだ", cut(tidy(s[1]), 30));
  return [...out];
}

// 失注・お断りの理由を、見出し（■）より前の自由に書いた部分から1文だけ拾う
const LOST = /お断り|断られ|断り|失注|見送|導入する気がない|気がない|必要(?:が)?ない|不要|検討しない|予定(?:は)?ない|間に合って|難しい|工数がかか/;
function pickLostText(text) {
  const head = lines(text).split(/\n[■◆【]/)[0];
  for (const s of head.split(/[\n。]|[ \t　]+/)) {
    const v = tidy(s.replace(/^・/, ""));
    if (v.length >= 6 && LOST.test(v) && !unsafe(v) && !/[：:]/.test(v)) return cut(v, 90);
  }
  return "";
}

// L：SF のリード（MC_BALES_FIELDS のラベル → 値）。extra：Bales など別の元データの本文
//   返すもの：[[見出し, 値], …]（失注理由が先頭。何も無ければ空の配列）
export function needDigest(L = {}, extra = "") {
  const g = (k) => tidy(String(L[k] ?? "").replace(/\s+/g, " "));
  const out = [];
  // 失注理由：SF の選択項目（大 → 中 → 小）＋詳細。無ければ本文から
  const pick = [...new Set([g("失注商談失注理由大"), g("失注商談失注理由中"), g("失注商談失注理由小")].filter((v) => v && v !== "-"))].join("・");
  const detail = g("失注商談失注理由詳細"); const free = pickLostText(L["顧客の現状"]) || pickLostText(extra);
  const lost = [pick, detail && detail !== "-" ? cut(detail, 90) : free].filter(Boolean).join("／");
  if (lost) out.push(["失注理由", lost + (g("失注商談バッティング負け競合") ? `（競合：${g("失注商談バッティング負け競合")}）` : "")]);
  // 採用の数字：SF の本文 → 別の元データの本文の順。同じ見出しは先に見つかった方
  const seen = new Set();
  for (const [k, v] of [...pickFacts(L["顧客の現状"]), ...pickFacts(extra)]) if (!seen.has(k)) { seen.add(k); out.push([k, v]); }
  if (g("採用人数(選択リスト)")) out.push(["採用人数", g("採用人数(選択リスト)")]);
  if (g("利用中ATS")) out.push(["利用中ATS", g("利用中ATS")]);
  if (g("顧客の課題感") && !unsafe(g("顧客の課題感"))) out.push(["課題感", cut(g("顧客の課題感"), 60)]);
  return out;
}

// 判定の根拠の1文が、商談メモの型（■見出し・「項目：」）をそのまま切ったものか。そうなら画面には出さず、上の抜き出しに任せる
export const looksTemplate = (s) => /■|◆|[・\s][^\s・：:]{2,14}[：:]/.test(String(s || ""));
