// kinbot for MOCHICA：架電リストの「ホット度」を決める（2026-11-16 依頼「架電時のホットリスト化」）
//   見るのは3つ：①担当者名が取れているか ②ニーズを聞けているか ③検討時期を聞けているか。
//   3つそろえば「ホット」、2つで「ウォーム」、1つ以下は「コールド」。
//   Bales にはニーズ・検討時期の決まった項目が無いので、架電のコメントやカスタム情報の文章を言葉のルールで読む
//   （AI は使わない＝2万件でもすぐ終わり、お金もかからない。言い回しによっては取りこぼす）。
//   SF と結びついた行は、SF のリードの「顧客の課題感」「検討開始時期」「現利用サービス更新予定月」も見る。
//   DB も通信も使わない純粋な関数だけにして、node で直接試せるようにしている。

// ルールを変えたらこの数字を上げる（保存済みの判定を全部やり直す合図）
export const HOT_VERSION = 1;

// 担当者名として扱わない書き方（名前ではなく役職・部署・「不明」など）
const NAME_GENERIC = /^(ご|御)?(採用|人事|総務|労務|管理|経営企画|事務)?(部|課|室|グループ)?(の)?(ご)?(担当|担当者|責任者|窓口|部長|課長|係長|社長|代表|院長|園長|事務長)?(様|さま|さん|殿)?$/;
const NAME_UNKNOWN = /不明|未取得|未確認|わから|分から|聞けず|聞けなかった|なし|無し|^[-ー－—―?？・.\s]+$/;

// ニーズ：聞けた（あり）／聞けたが無い（なし）
const NEED_POS = /ニーズ(が|は)?(あ|有)|課題(が|は)?(あ|有)|課題感|困って(い|お)|悩ん|悩み|足りな|不足|集まらな|集まって(い)?な|応募(が|は)?(少な|来な|こな|減)|採用(が|に)?(苦戦|難航|でき(て)?(い)?な|うまくいって(い)?な)|人手不足|欠員|増員|急募|辞退|歩留まり|連絡(が)?(つかな|取れな|とれな)|母集団|(導入|利用|切り替え|切替|乗り換え|乗換)(を)?(検討|考え)|検討(中|したい|して(い|お)|段階)|興味(が|は)?(あ|有)|関心(が|は)?(あ|有)|話を?(聞きたい|伺いたい|聞いてみたい)|資料(を)?(送って|ほしい|欲しい|請求|希望)|前向き/;
const NEED_NEG = /ニーズ(が|は)?(な|無)|課題(が|は)?(特に)?(な|無)|困って(い)?(な|ません)|不要|必要(が|は)?(な|無|ありません)|足りて|充足|間に合って|採用(予定|計画)?(は|が)?(な|無|しない|して(い)?な|ありません)|予定(は|が)?(な|無|ありません)|検討(は|も)?(しない|して(い)?な|できない|予定な)|興味(が|は)?(な|無)|情報収集/;

// 検討時期：聞けた（あり）／未定と言われた（なし）
const KANJI_NUM = "[0-9０-９一二三四五六七八九十]{1,3}";
const WHEN_POS = new RegExp([
  `${KANJI_NUM}(月|ヶ月|か月|カ月|ケ月)(頃|ごろ|くらい|ぐらい|から|以降|中|末|上旬|中旬|下旬|に|目処|めど|予定|後|あたり|までに|更新|契約|スタート|開始)`,
  "来月|再来月|今月中|来期|今期|来年度?|今年度中?|年明け|年度末|年度初め|新年度|上期|下期|上半期|下半期",
  "(夏|秋|冬|春)(頃|ごろ|以降|から|まで|先)",
  "(更新|契約満了|契約更新|満了)(時期|月|タイミング|の?時|前)",
].join("|"));
const WHEN_NEG = /時期(は|が)?(未定|決まって(い)?な|まだ|わから|分から|不明)|未定/;
// 「来月また電話」のような、こちらの架け直しの予定は検討時期ではない
const CALLBACK = /再架電|かけ直|掛け直|架け直|折り返|電話(して|ください|下さい|する|します)|コール(する|します)|再度(連絡|電話)/;

// 文章として読む項目：コメント・メモ・カスタム情報の値・次のアクションの内容（架電結果の選択肢は読まない）
const TEXT_KEY = /comment|memo|content|fieldValue|field_value|note/i;
const NAME_KEYS = ["targetName", "target_name", "contactName", "contact_name"];

const clean = (s) => String(s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
// 文に分ける（「〜はあるが、〜はない」のように1文に両方あるときは、その文はどちらにも数えない）
const sentences = (t) => String(t).split(/[。．！!？?\n\r]|、(?=[^、]{0,4}(が|けど|けれど|しかし|ただ))/).map((x) => x && x.trim()).filter(Boolean);

function readTexts(texts, POS, NEG, skip) {
  let pos = "", neg = "";
  for (const t of texts) for (const s of sentences(t)) {
    if (skip && skip.test(s)) continue;
    const p = POS.test(s), n = NEG.test(s);
    if (p && !n && !pos) pos = s.slice(0, 80);
    if (n && !neg) neg = s.slice(0, 80);
  }
  return pos ? { st: "あり", why: pos } : neg ? { st: "なし", why: neg } : { st: "", why: "" };
}

// data：Bales の行（平らにしたもの）、lead：SF のリード（MC_BALES_FIELDS のラベル → 値。無ければ null）
export function judgeHot(data, lead) {
  const d = data || {}; const L = lead || {};
  // ① 担当者名
  let nm = ""; for (const k of NAME_KEYS) if (d[k]) { nm = clean(d[k]); break; }
  const core = nm.replace(/(様|さま|さん|殿)$/, "").trim();
  const nameOk = !!core && core.length <= 40 && !NAME_GENERIC.test(core) && !NAME_UNKNOWN.test(core);
  const name = { st: nameOk ? "あり" : "", why: nm.slice(0, 40) };

  const texts = Object.entries(d).filter(([k, v]) => v && TEXT_KEY.test(k) && !/(^|\.)(id|at)$|At$|dataType|fieldKey|fieldId/.test(k)).map(([, v]) => clean(v)).filter((v) => v.length >= 2);

  // ② ニーズ：コメント等 → SF の「顧客の課題感」
  let need = readTexts(texts, NEED_POS, NEED_NEG, null);
  if (need.st !== "あり" && L["顧客の課題感"]) {
    const v = clean(L["顧客の課題感"]); const x = readTexts([v], NEED_POS, NEED_NEG, null);
    // 課題感の欄が埋まっていれば、言葉が当たらなくても「聞けた」とみなす（否定の言い方は除く）
    if (x.st === "あり" || (x.st !== "なし" && v.length >= 4)) need = { st: "あり", why: `SF 顧客の課題感：${v.slice(0, 60)}` };
    else if (!need.st && x.st === "なし") need = { st: "なし", why: `SF 顧客の課題感：${v.slice(0, 60)}` };
  }

  // ③ 検討時期：コメント等 → SF の「検討開始時期」「現利用サービス更新予定月」
  let when = readTexts(texts, WHEN_POS, WHEN_NEG, CALLBACK);
  if (when.st !== "あり") {
    for (const lbl of ["検討開始時期", "現利用サービス更新予定月"]) {
      const v = clean(L[lbl]); if (v) { when = { st: "あり", why: `SF ${lbl}：${v.slice(0, 40)}` }; break; }
    }
  }

  const n = [name, need, when].filter((x) => x.st === "あり").length;
  return { n, lv: n >= 3 ? "hot" : n === 2 ? "warm" : "cold", name, need, when };
}

export const HOT_LABEL = { hot: "ホット", warm: "ウォーム", cold: "コールド" };
