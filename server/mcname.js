// 人の名前を「同じ人か」で比べるための正規化（2026-11-23 福井さん「インターン判定の名前一致を頑丈に」）
//
// なぜ要るか：
//   MOCHICA のインターン判定（index.js internAccess）・架電の管理者（苗字）・ダッシュボードの名簿の結びつけは、
//   kinbot の表示名と、名簿（mcdash.js MCDASH_ROSTER）の SF の氏名・Zoom の表示名を突き合わせて決めている。
//   これまでは「全角/半角をそろえて空白を消す」だけだったので、次のような違いで別人扱いになり、
//   本人の「かける」に何も出なくなるおそれがあった。
//     ・旧字・異体字（内藤さんの SF 名は「賴」、Google の名前は「頼」かもしれない。齊藤／斉藤／斎藤 など）
//     ・姓と名の順番（Zoom は「彩娟趙」のように名→姓で出ることがある）
//     ・ひらがな／カタカナ（Zoom 名「らいあないとう」と「ライアナイトウ」）
//     ・名前のうしろの（インターン）などの添え書き、・や空白
//   ここで両方を同じ形にそろえてから比べる。

// 旧字・異体字 → ふだん使う字（人名でよく出るものだけ。足りなければここに足す）
const VARIANT = {
  賴: "頼", 齊: "斉", 齋: "斉", 斎: "斉", 髙: "高", 﨑: "崎", 嵜: "崎", 邊: "辺", 邉: "辺", 澤: "沢", 濱: "浜", 濵: "浜",
  廣: "広", 國: "国", 櫻: "桜", 眞: "真", 藏: "蔵", 惠: "恵", 實: "実", 德: "徳", 冨: "富", 嶋: "島", 嶌: "島", 槇: "槙", 瀨: "瀬",
  淵: "渕", 淺: "浅", 龍: "竜", 瀧: "滝", 壽: "寿", 榮: "栄", 圓: "円", 戶: "戸", 曾: "曽", 舘: "館",
  桒: "桑", 﨔: "欅", 彌: "弥", 與: "与", 會: "会", 傳: "伝", 鐵: "鉄", 總: "総", 豐: "豊", 禮: "礼", 縣: "県", 聰: "聡", 從: "従",
};
const VARIANT_RE = new RegExp(`[${Object.keys(VARIANT).join("")}]`, "g");

// 比べるための形：全角/半角をそろえ（NFKC）、添え書き・空白・記号を消し、異体字をそろえ、カタカナをひらがなに、英字を小文字に
export function foldPersonName(s) {
  return String(s || "")
    .normalize("NFKC")
    .replace(/[(（][^)）]*[)）]/g, "")            // （インターン）など
    .replace(/[\s　​・･.,、，]/g, "")
    .replace(VARIANT_RE, (c) => VARIANT[c])
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .toLowerCase();
}

// 名簿の1人について、比べる名前の形をすべて作る（SF の氏名・Zoom 名・姓と名を入れ替えた形）
//   p = { name: "内藤"（苗字）, sf: "内藤賴郁亜", zoom: "らいあないとう", key?: "…" }
export function rosterForms(p) {
  const out = new Set();
  const sur = foldPersonName(p && p.name);
  for (const v of [p && p.sf, p && p.zoom, p && p.key]) {
    const f = foldPersonName(v); if (!f) continue;
    out.add(f);
    // 姓→名 の形から 名→姓 の形も作る（苗字が分かっているときだけ）
    if (sur && f.length > sur.length) {
      if (f.startsWith(sur)) out.add(f.slice(sur.length) + sur);
      else if (f.endsWith(sur)) out.add(sur + f.slice(0, -sur.length));
    }
  }
  return out;
}

// BALES の所有者の値の中から、その人の分を選ぶ（今日かけるリストの本人の判定）。
//   forms：その人の名前の形（そろえたもの）、vals：所有者の値 [{ v }]、everyone：kinbot の人と名簿の人のフルネーム（そろえたもの）。
//   まずフルネームで当てる。当たらなければ、名字だけの所有者（BALES に「小賀坂」「足立」「趙」「福井」と名字だけで入っている人）に当てる。
//   名字で当てるのは、その名字で始まる所有者の値が1つだけで、しかも その名字の人が kinbot・名簿に1人だけのときに限る（同じ名字の人の分を取らないため）。
//   （2026-11-25 福井さん：BALES の「福井」と kinbot の「福井聖」が合わず、今日かけるリストが出なかった。小賀坂・足立・趙も同じだった）
export function pickBalesOwner(forms, vals, everyone) {
  const fs = [...forms].filter(Boolean);
  if (!fs.length) return "";
  const exact = (vals || []).find((x) => forms.has(foldPersonName(x && x.v)));
  if (exact) return exact.v;
  const sur = (vals || []).filter((x) => { const f = foldPersonName(x && x.v); return f && fs.some((n) => n.length > f.length && n.startsWith(f)); });
  if (sur.length !== 1) return "";
  const f = foldPersonName(sur[0].v);
  const same = new Set([...fs.filter((n) => n.startsWith(f)), ...[...(everyone || [])].filter((n) => n && n.length > f.length && n.startsWith(f))]);
  return same.size === 1 ? sur[0].v : "";
}

// 名前が名簿のだれかに当たれば、その人（名簿の行）を返す
export function rosterHit(name, roster) {
  const f = foldPersonName(name); if (!f) return null;
  for (const p of roster || []) if (rosterForms(p).has(f)) return p;
  return null;
}

// 名前が苗字で始まるか（架電の管理者の判定。齊藤／斉藤／斎藤 は同じとみなす）
export function startsWithSurname(name, surname) {
  const f = foldPersonName(name), s = foldPersonName(surname);
  return !!s && f.startsWith(s);
}
