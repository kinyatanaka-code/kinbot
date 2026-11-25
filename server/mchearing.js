// ---- アポ獲得〜商談への引き継ぎで聞くこと（2026-11-23 福井さん「必須のヒアリングを埋めないとアポを取れないように」「メールでヒアリングできるように」） ----
//   ASUMO の28項目（担当者の基本3＋必須7＋追加18）にそろえる。項目の並び・聞き方・選択肢はここだけで決め、
//   画面（public/mccall.js）には /api/mccall/meta で渡す（画面とサーバーで項目が食い違わないように）。
//   値は mc_call_leads.hearing（JSONB）に入れる。前からある4つの鍵（when・need・contact・target）はそのまま使う
//   （SF のリードの項目の補完＝mcsffill.js と、ホットの条件がこの鍵を読んでいるため）。
//     contact＝① 接触人数（前の「説明会・面接の参加人数」と同じ欄）、target＝② 現卒の採用目標人数、
//     when＝④ 次卒の選考開始予定時期（SF の「検討開始時期」と同じ 1月〜12月・未定）、
//     need＝⑥ 採用対象（ほしい人）と ⑦ 課題感（困りごと）を「困りごと：〜／ほしい人：〜」の1つの文で持つ。

const MONTHS = [...Array.from({ length: 12 }, (_, i) => `${i + 1}月`), "未定"];
export const PRIORITY_ENTRY = "そもそものエントリー数を増やしたい";
export const BUDGET_NONE = "3カ月以内に検討できる予算は無い";

// group：basic＝担当者の基本／req＝必須／more＝追加・引き継ぎ。
// type：text・num・mail・tel・choice（opts から1つ）・month（MONTHS）・need（⑥⑦。採用ニーズの選択肢で選ぶ）・long（長い文）。
// show：ほかの項目の答えで出し分ける条件。mail：ヒアリングのメールで聞けるか（担当者の性別・雰囲気・社内の管理用の値は聞かない）。
// ask：メールで聞くときの文。unit：記録の本文に付ける単位
export const HEAR_ITEMS = [
  { k: "name", group: "basic", label: "担当者氏名", type: "text", hint: "名字だけでも可（漢字で）", mail: false },
  { k: "mail", group: "basic", label: "担当者メール", type: "mail", hint: "案内の送り先", mail: false },
  { k: "tel", group: "basic", label: "担当者電話", type: "tel", hint: "担当者への連絡先", ask: "ご担当者様に直接つながるお電話番号（直通・携帯など）" },
  { k: "contact", no: "①", group: "req", label: "接触人数", type: "num", unit: "名", hint: "母集団のうち実際に接触できている人数（30人以上が目安・100人が理想）", ask: "現在の母集団のうち、実際に接触できている学生様のおおよその人数" },
  { k: "target", no: "②", group: "req", label: "現卒の採用目標人数", type: "num", unit: "名", hint: "いま採用を進めている卒年の目標", ask: "現在採用活動を進めている卒年の採用目標人数" },
  { k: "priority", no: "③", group: "req", label: "提案の優先課題", type: "choice", opts: ["エントリー後の移行率を上げたい", "どちらも取り組みたい", PRIORITY_ENTRY], show: { k: "target", lt: 4 }, hint: "目標が4名未満のときだけ聞く", ask: "優先して取り組みたい課題（エントリー後の移行率を上げたい／どちらも取り組みたい／そもそものエントリー数を増やしたい）" },
  { k: "when", no: "④", group: "req", label: "次卒の選考開始予定時期", type: "month", hint: "未定でも「未定」を選ぶ", ask: "次の卒年の選考開始のご予定時期（未定でも構いません）" },
  { k: "budget3m", no: "⑤", group: "req", label: "3カ月以内の導入予算", type: "choice", opts: ["3カ月以内に検討できる予算がある", BUDGET_NONE], ask: "3カ月以内にご検討いただけるご予算の有無" },
  { k: "need_who", no: "⑥", group: "req", label: "採用対象", type: "need", part: "who", hint: "どんな人を採りたいか", ask: "採用したい人材（新卒・高卒・中途・パート／アルバイト など）" },
  { k: "need_pains", no: "⑦", group: "req", label: "課題感", type: "need", part: "pains", hint: "いまの採用で困っていること", ask: "現在の採用活動でお困りのこと" },
  { k: "hired", no: "⑧", group: "more", label: "現卒の採用実績人数", type: "num", unit: "名", ask: "現在の卒年の採用実績（内定承諾）人数" },
  { k: "source", no: "⑨", group: "more", label: "現卒の母集団形成の方法", type: "text", hint: "例：マイナビ、リクナビ、学内説明会、紹介", ask: "現在の卒年の母集団形成の方法（例：マイナビ、リクナビ、学内説明会、紹介など）" },
  { k: "ats", no: "⑩", group: "more", label: "採用管理ツール", type: "choice", opts: ["利用している", "利用していない"], ask: "採用管理ツールのご利用の有無（ご利用中ならツール名も）" },
  { k: "atsLine", no: "⑪", group: "more", label: "採用管理ツールのLINE連携", type: "choice", opts: ["連携している", "連携していない"], show: { k: "ats", eq: "利用している" }, ask: "採用管理ツールと LINE の連携の有無" },
  { k: "line", no: "⑫", group: "more", label: "採用活動でのLINE利用", type: "choice", opts: ["利用している", "利用していない"], show: { k: "ats", eq: "利用していない" }, ask: "採用活動での LINE のご利用の有無" },
  { k: "lineImage", no: "⑬", group: "more", label: "LINEの印象", type: "text", show: { k: "line", eq: "利用していない" }, ask: "採用活動で LINE を使うことへの印象" },
  { k: "snsLimit", no: "⑭", group: "more", label: "SNS利用の制限", type: "text", show: { k: "line", eq: "利用していない" }, hint: "社内で SNS を使えない等の決まり", ask: "社内で SNS を利用できないなどの制限の有無" },
  { k: "why", no: "⑮", group: "more", label: "アポ取得の経緯", type: "text", hint: "何に興味を持ってアポをくれたか", mail: false },
  { k: "gender", no: "⑯", group: "more", label: "担当者の性別", type: "choice", opts: ["男性", "女性", "わからない"], mail: false },
  { k: "mood", no: "⑰", group: "more", label: "担当者の雰囲気", type: "text", hint: "例：穏やかで聞き役、早口で結論から、情報収集段階", mail: false },
  { k: "role", no: "⑱", group: "more", label: "役職名", type: "text", ask: "ご担当者様の役職名" },
  { k: "cond", no: "⑲", group: "more", label: "採用条件", type: "text", ask: "採用に関する条件（勤務地・資格・人物像など）" },
  { k: "budgetYear", no: "⑳", group: "more", label: "想定年間採用予算", type: "text", ask: "想定されている年間の採用予算" },
  { k: "soon", no: "㉑", group: "more", label: "直近採用時期", type: "text", ask: "直近で採用をお考えの時期" },
  { k: "soonWhy", no: "㉒", group: "more", label: "直近採用の理由", type: "text", ask: "直近で採用をお考えの理由" },
  { k: "sfRank", no: "㉓", group: "more", label: "SFランク", type: "text", hint: "社内管理用", mail: false },
  { k: "deals", no: "㉔", group: "more", label: "商談回数", type: "num", unit: "回", mail: false },
  { k: "note", no: "㉕", group: "more", label: "備考", type: "long", hint: "その他の補足・引き継ぎ事項", ask: "その他、事前にお伝えいただけることがあれば" },
];
const BY_K = new Map(HEAR_ITEMS.map((x) => [x.k, x]));
// 値として持つ鍵（⑥⑦は need の1つの文に入るので、need_who・need_pains という鍵は持たない）
export const HEAR_KEYS = [...new Set(HEAR_ITEMS.map((x) => (x.type === "need" ? "need" : x.k)))];

const clip = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const intOrNull = (v) => { const n = parseInt(String(v ?? "").normalize("NFKC").replace(/[^0-9]/g, ""), 10); return Number.isFinite(n) && n >= 0 && n < 1e6 ? n : null; };
const digits = (v) => String(v || "").normalize("NFKC").replace(/[^0-9]/g, "");
const isMail = (v) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(v || "").trim());
const KANJI = /[㐀-鿿豈-﫿々]/;
// SF・Bales の仮置きの名前（「担当者」「採用担当」など）は、聞けた名前に数えない
const PLACEHOLDER = /^(ご?担当者?様?|採用(ご)?担当(者)?様?|人事(ご)?担当(者)?様?|不明|なし|\[\[Unknown\]\]|unknown)$/i;
export const realName = (v) => { const s = clip(v, 60); return s && !PLACEHOLDER.test(s) ? s : ""; };

// 画面から来た値を、項目ごとの形にそろえる（決まった選択肢にない値・形の崩れた値は入れない）
export function cleanHearing(h = {}) {
  const o = {};
  for (const it of HEAR_ITEMS) {
    if (it.type === "need") continue;
    const v = h[it.k];
    if (it.type === "num") o[it.k] = intOrNull(v);
    else if (it.type === "month") { const s = clip(v, 10); o[it.k] = MONTHS.includes(s) ? s : ""; }
    else if (it.type === "choice") { const s = clip(v, 60); o[it.k] = it.opts.includes(s) ? s : ""; }
    else if (it.type === "long") o[it.k] = String(v ?? "").trim().slice(0, 1000);
    else if (it.type === "mail") { const s = clip(v, 120); o[it.k] = isMail(s) ? s : ""; }
    else o[it.k] = clip(v, it.type === "tel" ? 40 : 200);
  }
  o.need = clip(h.need, 400);
  return Object.values(o).some((v) => v != null && v !== "") ? o : null;
}
// 前の値に、新しく聞けた項目だけを重ねる（空のまま記録しても、前に聞いた値を消さないため）
export function mergeHearing(old, neu) {
  if (!neu) return old || null; const o = { ...(old || {}) };
  for (const k of HEAR_KEYS) if (neu[k] !== "" && neu[k] != null) o[k] = neu[k];
  return o;
}
// 採用ニーズの文（「困りごと：〜／ほしい人：〜」）から ⑥⑦ を読む。前に自由に書いた文（選択肢に当たらない）は課題感に数える
export function needParts(need, choices) {
  const t = String(need || ""); const C = choices || { pains: [], who: [] };
  const p = { pains: C.pains.filter((x) => t.includes(x)), who: C.who.filter((x) => t.includes(x)) };
  if (t && !p.pains.length && !p.who.length) p.free = t;
  return p;
}
// 出し分けの条件に合っているか（③ は目標が4名未満のとき、⑪〜⑭ は採用管理ツール・LINE の答えしだい）
export function shown(it, h) {
  const s = it.show; if (!s) return true; const v = (h || {})[s.k];
  if (s.lt != null) return v != null && v !== "" && Number(v) < s.lt;
  return v === s.eq;
}
// 1項目の値を文字にする（記録の本文・メールの下書き・画面で同じ見せ方にする）
export function valueText(it, h, choices) {
  if (it.type === "need") { const p = needParts(h.need, choices); return it.part === "who" ? p.who.join("・") : (p.pains.join("・") || p.free || ""); }
  const v = (h || {})[it.k]; if (v == null || v === "") return "";
  return `${v}${it.unit || ""}`;
}

// アポにしてよいか（2026-11-23 福井さん「必須ヒアリングを埋めないとアポが取れないように」）。
//   contact：担当者の名前・メール・電話の、ヒアリング欄が空のときに使う値（受付で聞いた名前・会社の情報・かけた番号）。
//   block＝これが残っているとアポにできない／warn＝記録はできるが、知らせること
export function apoCheck(h0, contact = {}, choices) {
  const h = { ...(h0 || {}) };
  const name = realName(h.name) || realName(contact.name); const mail = h.mail || contact.mail || ""; const tel = h.tel || contact.tel || "";
  const block = [], warn = [];
  if (!name) block.push("担当者氏名"); else if (!KANJI.test(name)) block.push("担当者氏名（漢字で）");
  if (!isMail(mail)) block.push("担当者メール");
  if (digits(tel).length < 9) block.push("担当者電話");
  for (const it of HEAR_ITEMS) {
    if (it.group !== "req" || !shown(it, h)) continue;
    if (!valueText(it, h, choices)) block.push(`${it.no} ${it.label}`);
  }
  if (h.budget3m === BUDGET_NONE) block.unshift("3カ月以内に検討できる予算が無いときはアポにしません。「担当者接触：営業フォロー」で記録して、時期を改めて追ってください");
  if (h.contact != null && h.contact !== "" && Number(h.contact) < 30) warn.push(`接触人数が ${h.contact}名で、目安の30人に届いていません`);
  if (shown(BY_K.get("priority"), h) && h.priority === PRIORITY_ENTRY) warn.push("エントリー数を増やしたい場合は、今回のサービスでは解決が難しいことを伝え、別の部署を案内してください");
  return { block, warn, name, mail, tel };
}

// 記録の本文（SF の活動）に入れる行。聞けた項目だけを並びの順に出す
export function hearingLines(h, choices) {
  if (!h) return [];
  return HEAR_ITEMS.filter((it) => shown(it, h)).map((it) => { const v = valueText(it, h, choices); return v ? `${it.no ? `${it.no} ` : ""}${it.label}：${v}` : ""; }).filter(Boolean);
}

// ---- ヒアリングのメール（電話で聞ききれなかったことを、メールで答えてもらう） ----
export const MAIL_ITEMS = HEAR_ITEMS.filter((it) => it.mail !== false);
// 最初にチェックを入れておく項目：必須でまだ聞けていないもの（出し分けの条件に合うものだけ）
export function mailDefaults(h, choices) {
  return MAIL_ITEMS.filter((it) => it.group !== "more" && shown(it, h || {}) && !valueText(it, h || {}, choices) && it.k !== "tel").map((it) => it.k);
}
export const HEAR_MAIL_SUBJECT = "【MOCHICA】ご面談に向けた事前のご質問（{会社名}様）";
// nanori：「株式会社ネオキャリアの福井」のような名乗り（2026-11-25 福井さん。会社名＋名字で名乗るのが礼儀なので）
export function hearMailBody({ company, person, sender, nanori, keys }) {
  const qs = keys.map((k) => BY_K.get(k)).filter((it) => it && it.mail !== false);
  const list = qs.map((it, i) => `${i + 1}. ${it.ask || it.label}\n　→ `).join("\n\n");
  return `${company ? `${company}\n` : ""}${person || "ご担当者"}様\n\nお世話になっております。${nanori || `MOCHICA の${sender || ""}`}です。\n先ほどはお電話にてお時間をいただき、ありがとうございました。\n\nより貴社に合ったご提案をご用意するため、差し支えのない範囲で\n下記についてご返信いただけますと幸いです。\n（分かる項目だけで構いません。「→」の後ろにご記入ください）\n\n${list}\n\nお忙しいところ恐縮ですが、何卒よろしくお願いいたします。`;
}
