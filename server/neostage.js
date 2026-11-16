// NeoSTAGE（社内の取引申請システム neo-crm.net）の自動入力に使う値をつくる（2026-11-16 田中さん「企業検索・事業所新規・部署新規の項目を自動で埋めたい」）
//   入力そのものは拡張機能（kinbot-ext の neostage.js）が画面でする。ここは「何を入れるか」を SF と gBizINFO から組み立てるだけ。
//   申請ボタンは押さない（人が目で確かめてから押す）。分からない値は空のまま返し、勝手に作らない。

// 法人格（前に付くか後ろに付くかを見分けるため、長いものから順に）
const CORP_TYPES = ["特定非営利活動法人", "地方独立行政法人", "国立大学法人", "独立行政法人", "一般社団法人", "一般財団法人", "公益社団法人", "公益財団法人",
  "社会福祉法人", "医療法人社団", "医療法人財団", "医療法人", "学校法人", "宗教法人", "生活協同組合", "協同組合", "NPO法人", "株式会社", "有限会社", "合同会社", "合資会社", "合名会社"];
const CORP_TYPE_ALIAS = [[/^\(株\)|^（株）|^㈱/, "株式会社", "前"], [/\(株\)$|（株）$|㈱$/, "株式会社", "後"], [/^\(有\)|^（有）|^㈲/, "有限会社", "前"], [/\(有\)$|（有）$|㈲$/, "有限会社", "後"]];

// 「株式会社〇〇」→ { type:"株式会社", pos:"前", name:"〇〇" }。法人格が無ければ type は空
export function splitCorpName(full) {
  let n = String(full || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  for (const [re, type, pos] of CORP_TYPE_ALIAS) if (re.test(n)) return { type, pos, name: n.replace(re, "").trim() };
  for (const t of CORP_TYPES) {
    if (n.startsWith(t)) return { type: t, pos: "前", name: n.slice(t.length).trim() };
    if (n.endsWith(t)) return { type: t, pos: "後", name: n.slice(0, -t.length).trim() };
  }
  return { type: "", pos: "", name: n };
}

// 全角カナ（ひらがなも）→ 半角カナ。NeoSTAGE の社名カナは「半角カナ・拗促音は大文字」なので、小さい字（ャ・ッ など）は大きくする
const SMALL = { "ァ": "ア", "ィ": "イ", "ゥ": "ウ", "ェ": "エ", "ォ": "オ", "ャ": "ヤ", "ュ": "ユ", "ョ": "ヨ", "ッ": "ツ", "ヮ": "ワ", "ヵ": "カ", "ヶ": "ケ" };
const HALF = { "ア": "ｱ", "イ": "ｲ", "ウ": "ｳ", "エ": "ｴ", "オ": "ｵ", "カ": "ｶ", "キ": "ｷ", "ク": "ｸ", "ケ": "ｹ", "コ": "ｺ", "サ": "ｻ", "シ": "ｼ", "ス": "ｽ", "セ": "ｾ", "ソ": "ｿ",
  "タ": "ﾀ", "チ": "ﾁ", "ツ": "ﾂ", "テ": "ﾃ", "ト": "ﾄ", "ナ": "ﾅ", "ニ": "ﾆ", "ヌ": "ﾇ", "ネ": "ﾈ", "ノ": "ﾉ", "ハ": "ﾊ", "ヒ": "ﾋ", "フ": "ﾌ", "ヘ": "ﾍ", "ホ": "ﾎ",
  "マ": "ﾏ", "ミ": "ﾐ", "ム": "ﾑ", "メ": "ﾒ", "モ": "ﾓ", "ヤ": "ﾔ", "ユ": "ﾕ", "ヨ": "ﾖ", "ラ": "ﾗ", "リ": "ﾘ", "ル": "ﾙ", "レ": "ﾚ", "ロ": "ﾛ", "ワ": "ﾜ", "ヲ": "ｦ", "ン": "ﾝ",
  "ガ": "ｶﾞ", "ギ": "ｷﾞ", "グ": "ｸﾞ", "ゲ": "ｹﾞ", "ゴ": "ｺﾞ", "ザ": "ｻﾞ", "ジ": "ｼﾞ", "ズ": "ｽﾞ", "ゼ": "ｾﾞ", "ゾ": "ｿﾞ", "ダ": "ﾀﾞ", "ヂ": "ﾁﾞ", "ヅ": "ﾂﾞ", "デ": "ﾃﾞ", "ド": "ﾄﾞ",
  "バ": "ﾊﾞ", "ビ": "ﾋﾞ", "ブ": "ﾌﾞ", "ベ": "ﾍﾞ", "ボ": "ﾎﾞ", "パ": "ﾊﾟ", "ピ": "ﾋﾟ", "プ": "ﾌﾟ", "ペ": "ﾍﾟ", "ポ": "ﾎﾟ", "ヴ": "ｳﾞ", "ー": "ｰ", "・": "･", "　": " " };
export function toHalfKana(s, { bigSmall = true } = {}) {
  let t = String(s || "").normalize("NFKC")   // 半角カナはいったん全角に（NFKC）してから、まとめて半角にする
    .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));   // ひらがな → カタカナ
  if (bigSmall) t = t.replace(/[ァィゥェォャュョッヮヵヶ]/g, (c) => SMALL[c] || c);
  return t.split("").map((c) => HALF[c] || c).join("");
}
export function toFullKana(s) {
  return String(s || "").normalize("NFKC").replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

// 法人格の読み（社名カナから外すため。gBizINFO のカナに入っていることがある）
const CORP_KANA = ["カブシキガイシャ", "カブシキカイシャ", "ユウゲンガイシャ", "ユウゲンカイシャ", "ゴウドウガイシャ", "ゴウドウカイシャ", "シャカイフクシホウジン", "イリョウホウジンシャダン", "イリョウホウジン", "ガッコウホウジン", "イッパンシャダンホウジン", "イッパンザイダンホウジン"];
export function stripCorpKana(k) { let t = toFullKana(k).replace(/\s+/g, ""); for (const c of CORP_KANA) { if (t.startsWith(c)) t = t.slice(c.length); if (t.endsWith(c)) t = t.slice(0, -c.length); } return t; }

// 「千葉県千葉市中央区花輪町190番地」→ { pref:"千葉県", rest:"千葉市中央区花輪町190番地" }
const PREFS = ["北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県",
  "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"];
export function splitAddress(a) {
  const t = String(a || "").normalize("NFKC").replace(/\s+/g, "").trim();
  const p = PREFS.find((x) => t.startsWith(x));
  return p ? { pref: p, rest: t.slice(p.length) } : { pref: "", rest: t };
}
export const isPref = (v) => PREFS.includes(String(v || "").trim());

// 電話番号：ハイフンが入っていればそのまま。数字だけのときは、よくある形（03/06 は 2-4-4、携帯・050 は 3-4-4、それ以外は 4桁の市外局番を仮定しない＝そのまま）
export function telHyphen(v) {
  const t = String(v || "").normalize("NFKC").trim(); if (!t) return "";
  if (/-/.test(t)) return t.replace(/[^\d-]/g, "");
  const d = t.replace(/\D/g, "");
  if (/^0[3-6]\d{8}$/.test(d) && /^0[36]/.test(d)) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
  if (/^0[5789]0\d{8}$/.test(d)) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (/^0120\d{6}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
  return d;   // 市外局番の桁が分からないので、ハイフンは人が入れる（間違った区切りで入れない）
}
export const isMobile = (v) => /^0[789]0/.test(String(v || "").replace(/\D/g, ""));
