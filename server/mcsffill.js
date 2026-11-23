// 架電の内容から SF のリードの項目を埋める（2026-11-20 福井さん「ASUMO のように架電内容から自動でリード情報を埋める。
//   アポが取れなくても、ヒアリングでリストを埋めた貢献・リストの鮮度と精度を保った貢献を、SF の項目をどれだけ埋めたかで評価できるように」）
//
// ── やり方は ASUMO に合わせた ──
//   ASUMO（lib/call-history-mine.ts）は架電メモを AI ではなく決まった読み方（正規表現）で読み、画面の下書きとして出す。
//   AI に聞いていた頃は 1.6 秒かけて空で返ることがあり、決まった読み方なら 0.1 秒で、同じメモからいつも同じ値が出る。
//   ここも同じにする：読み取りは AI を呼ばない純関数。記録を押す前に「SF に入る項目」として見せ、記録したときに SF へ書く。
//
// ── 書いてよい・書かないの決まり ──
//   ・空の項目（担当者名が「担当者」「[[Unknown]]」などの仮置きも空とみなす）は、そのまま埋める
//   ・すでに値がある項目を書き換えるのは、
//       ヒアリング欄・受付の欄・断り理由で人が選んだ値 → 選んだこと自体を確認とみなして書き換える（前からの動き）
//       メモから読み取った値・担当者名やメールなど「人」の項目 → 画面でチェックを入れたときだけ（読み違い・別の人の可能性があるため）
//   ・SF と同じ値は書かない（「確認」として見せるだけ。何度かけても数が増えないように、評価にも数えない）
//   ・長い文の項目（顧客の課題感・その他ヒアリング項目）は「【日付 架電】〜」を頭に足す。これまでの集約を消さない
//
// このファイルは DB も SF も読まない。読み書きは server/mccall.js（sfLeadFill）が行う。

// 埋める項目（SF の Lead。API 名・選択肢は 2026-11-20 に SF の項目定義から確かめた）
export const FILL_FIELDS = {
  LastName: { label: "担当者（姓）", type: "text", who: true },
  FirstName: { label: "担当者（名）", type: "text", who: true },
  Title: { label: "役職", type: "text", who: true },
  Department_Category__c: { label: "部門", type: "pick" },
  Email: { label: "メール", type: "email", who: true },
  MobilePhone: { label: "携帯", type: "phone", who: true },
  phone2__c: { label: "電話2（直通）", type: "phone", who: true },
  Website: { label: "Web サイト", type: "url" },
  NumberOfEmployees: { label: "従業員数", type: "num" },
  Start_Considering_Date__c: { label: "検討開始時期", type: "pick" },
  Number_of_hires__c: { label: "採用人数", type: "pick" },
  Client_Issue__c: { label: "顧客の課題感", type: "append" },
  IS_hearing__c: { label: "その他ヒアリング項目", type: "append" },
  ATS__c: { label: "利用中ATS", type: "pick" },
  Competitors__c: { label: "アプローチ中競合", type: "multi" },
  update_month2__c: { label: "現利用サービス更新予定月", type: "pick" },
  recruting_type__c: { label: "採用種別", type: "multi" },
  SNS__c: { label: "利用中SNS", type: "multi" },
  Line_Implementation__c: { label: "LINE導入有無", type: "pick" },
  Field1__c: { label: "お断り理由", type: "pick" },
  Retire_check__c: { label: "退職・異動・休職", type: "bool", who: true },
};
export const FILL_APIS = Object.keys(FILL_FIELDS);
// 書く前に SF の今の値を読む項目（比べるための Phone・Company・IsConverted も足す）
export const FILL_SOQL_FIELDS = ["Company", "Phone", "IsConverted", ...FILL_APIS];

const MONTHS = Array.from({ length: 12 }, (_, i) => `${i + 1}月`);
const nfkc = (v) => String(v ?? "").normalize("NFKC");
const digits = (v) => nfkc(v).replace(/[^0-9]/g, "");
const sq = (v) => nfkc(v).replace(/\s+/g, "").toLowerCase();

// 採用目標人数 → SF の「採用人数(選択リスト)」の選択肢
export function hiresBucket(n) {
  if (n == null || n <= 0) return null;
  const B = [[2, "1～2名"], [5, "3～5名"], [10, "6～10名"], [15, "11～15名"], [20, "16～20名"], [25, "21～25名"], [30, "26～30名"], [35, "31～35名"], [40, "36～40名"], [45, "41～45名"], [50, "46～50名"], [100, "51～100名"], [200, "101～200名"], [300, "201～300名"]];
  for (const [max, v] of B) if (n <= max) return v; return "301名～";
}

// 担当者名の仮置き（SF のリードでよく見る値）。これなら「空」とみなして埋めてよい
export function isPlaceholderName(v, company = "") {
  const s = sq(v).replace(/[様さん殿]+$/, "");
  if (!s) return true;   // 1文字の姓（林・森・原など）は本物の名前なので、文字数では仮置きとみなさない
  if (company && s === sq(company)) return true;
  return /^(\[\[unknown\]\]|unknown|不明|未設定|未入力|なし|無し|-+|ー+|―+|ご?担当者?|採用担当者?|人事(部)?(担当者?)?|総務(部)?(担当者?)?|採用ご?担当者?様?|担当者様)$/.test(s);
}

// MOCHICALL の断り理由 → SF の「お断り理由」。合うものが無い理由（時期が合わない・その他）は書かない
const REASON_TO_SF = { "今は必要ない": "ニーズなし", "他社を使っている": "既に取引先あり", "予算が無い": "予算なし" };

// メモのお断りの言い方 → SF の「お断り理由」（断られた記録のときだけ見る）
const MEMO_REJECT = [
  [/LINE(に|は|には)?(あまり)?興味(が|は)?(ない|無い|なし)/i, "LINEに興味なし"],
  [/セキュリティ/, "セキュリティー懸念"],
  [/(電話|メール)(が|も)?(でき|出来)ない学生/, "メール・電話できない学生は必要ない"],
  [/予算(が|は)?(ない|無い|取れない|とれない|なし)/, "予算なし"],
  [/採用(人数|数)?(が|は)?(少ない|少数|数名)/, "採用人数少ない"],
  [/(取引先|付き合い|お付き合い)(が|は)?(ある|あり)|既存の(業者|会社|取引)/, "既に取引先あり"],
  [/課題(感)?(は|が|を)?(ない|無い|感じていない|感じてない)/, "採用に課題感を感じていない"],
  [/忙し/, "今忙しい"],
  [/ニーズ(が|は)?(ない|無い|なし)|必要(ない|無い|なし)|不要/, "ニーズなし"],
];

// ATS の言い方 → SF の「利用中ATS」の選択肢。長い名前を先に見る（「i-webらくるーと」を「i-web」と取り違えない）
const ATS_ALIAS = [
  [/i-?web\s*らくるーと/i, "i-webらくるーと"], [/かんりくん|管理くん/, "採用一括かんりくん"], [/LINE\s*WORKS|ラインワークス/i, "LINEworks"],
  [/sonar|ソナー/i, "sonarATS"], [/HERP/, "HERP"], [/HRMOS|ハーモス/i, "HRMOS"], [/HR\s*PRIME/i, "HRPRIME"], [/ジョブカン/, "ジョブカン"],
  [/e2R\s*(プロ|pro)/i, "e2Rプロ"], [/e2R/i, "e2R"], [/i-?web|アイウェブ/i, "i-web"], [/らくるーと/, "らくるーと"], [/リワークス/, "リワークスクラウド"],
  [/\bAOL\b/, "AOL"], [/あさがく/, "あさがくナビコミュニケーター"], [/採マネ/, "採マネネクスト"], [/キャリタス\s*contact/i, "キャリタスContact"],
];
const SNS_ALIAS = [[/instagram|インスタ/i, "Instagram"], [/tiktok|ティックトック/i, "Tiktok"], [/youtube|ユーチューブ/i, "Youtube"], [/twitter|ツイッター/i, "Twitter"], [/facebook|フェイスブック/i, "Facebook"]];
const ROLE = "代表取締役社長|代表取締役|代表|社長|専務|常務|取締役|執行役員|本部長|人事部長|総務部長|部長|次長|人事課長|課長|係長|主任|室長|マネージャー|リーダー|人事責任者|採用責任者|人事担当|採用担当";
const NAME = "[一-龥々ぁ-んァ-ヶー]{1,6}";
const OWN_MAIL = /@(neo-career|c-career|neocareer)\./i;
// 求人媒体・SNS・自社の URL は会社の Web サイトに入れない
const NOT_SITE = /(^|\.)(mynavi|rikunabi|doda|indeed|en-japan|baitoru|townwork|wantedly|linkedin|facebook|twitter|x|instagram|youtube|tiktok|line|google|salesforce|force|zoom|bales|balescloud|neo-career|c-career)\./i;

// 否定（〜していない・やめた）が後ろに続くか。ATS・SNS の「使っている」を取り違えないために見る
// 否定の言い方（「使っていない」「導入していません」「未導入」）。丁寧語の「〜ません」も見る
const NEG = "(使って|やって|導入して|入れて|利用して|して|採って|取って)(い)?(ない|ません)|未導入|やめ|解約|なし|無し";
const negAfter = (text, end) => new RegExp(`^.{0,6}?(は|を|も)?(${NEG})`).test(text.slice(end, end + 16));
// ATS と同じ名前の別の製品（ジョブカン勤怠など）の話なら ATS にしない
const otherUse = (text, end) => /^.{0,8}?(勤怠|労務|経費|給与|会計|ワークフロー|勤務管理)/.test(text.slice(end, end + 16));
const talkAfter = (text, end) => /^.{0,10}?(検討|比較|提案|営業|話を聞|見積|資料)/.test(text.slice(end, end + 16));
const pastBefore = (text, start) => /(前は|以前は?|元々|もともと|昔は|去年まで)[^。\n]{0,8}$/.test(text.slice(Math.max(0, start - 14), start));

// 担当者の名前（「山田 太郎」「山田様」）を姓と名に分ける
export function splitName(v) {
  const s = nfkc(v).replace(/(様|さん|殿)$/, "").trim();
  if (!s || s.length > 30 || /[@\d<>]/.test(s)) return null;
  const parts = s.split(/[\s　]+/).filter(Boolean);
  if (parts.length >= 2) return { last: parts[0], first: parts.slice(1).join(" ") };
  return { last: s, first: "" };
}

// 1つの電話番号を携帯か直通に振り分ける（10桁未満は内線などとみなして使わない）
function phoneCand(raw, src, why) {
  let d = digits(raw); if (/^81\d{9,10}$/.test(d)) d = "0" + d.slice(2);
  if (!/^0\d{9,10}$/.test(d)) return null;
  return { api: /^0[789]0\d{8}$/.test(d) ? "MobilePhone" : "phone2__c", value: nfkc(raw).trim(), src, why };
}

// ── メモを読む（ASUMO の mineCallHistory と同じく、決まった読み方だけ。AI は使わない） ──
//   返すのは候補の一覧 { api, value, src:"memo", why（読み取ったもとの言葉） }。値の向き先は FILL_FIELDS のどれか
export function readMemo(memo, { outcome = "" } = {}) {
  const t = nfkc(memo).replace(/\r/g, "");
  const out = []; if (!t.trim()) return out;
  const add = (api, value, why) => { if (value != null && value !== "" && !out.some((c) => c.api === api)) out.push({ api, value, src: "memo", why: String(why || "").trim().slice(0, 40) }); };

  // メール（自社のアドレスは除く）
  for (const m of t.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) if (!OWN_MAIL.test(m[0])) { add("Email", m[0].toLowerCase(), m[0]); break; }
  // 電話（0 から始まる 10〜11 桁。日付や内線を拾わない）
  for (const m of t.matchAll(/(?:\+81[-\s]?|0)\d{1,4}[-\s(（)）]?\d{1,4}[-\s(（)）]?\d{3,4}/g)) { const c = phoneCand(m[0], "memo", m[0]); if (c && !out.some((x) => x.api === c.api)) out.push(c); }
  // Web サイト
  for (const m of t.matchAll(/(?:https?:\/\/|www\.)[^\s、。,)）」]+/gi)) {
    const u = /^https?:/i.test(m[0]) ? m[0] : `https://${m[0]}`; let host = ""; try { host = new URL(u).hostname; } catch { continue; }
    if (!NOT_SITE.test(`.${host}`)) { add("Website", u, m[0]); break; }
  }
  // 従業員数
  { const m = /従業員(?:数)?(?:は|が|:)?\s*(?:約|およそ|だいたい)?\s*([\d,]{1,7})\s*(?:名|人)(?!\S{0,4}(不在|休み|欠勤|出社|在宅|退職|辞め))/.exec(t); if (m) { const n = parseInt(m[1].replace(/,/g, ""), 10); if (n > 0 && n < 1e6) add("NumberOfEmployees", n, m[0]); } }
  // 採用人数（「採用は10名」「5名ほど採用」）
  { const m = /(?:採用(?:目標|予定|人数)?|採りたい|取りたい)(?:は|が|:)?\s*(?:約|年間|毎年)?\s*(\d{1,4})\s*(?:名|人)/.exec(t) || /(\d{1,4})\s*(?:名|人)(?:ほど|くらい|ぐらい|程度|前後)?を?(?:採用|採り|取り|採る)/.exec(t);
    if (m) { const b = hiresBucket(parseInt(m[1], 10)); if (b) add("Number_of_hires__c", b, m[0]); } }
  // 更新予定月（「3月更新」「更新は4月」）
  { const m = /(\d{1,2})月(?:に|で|末)?(?:契約)?(?:の)?(?:更新|満了|切り替え|切替)/.exec(t) || /(?:更新|契約満了)(?:は|月は|時期は|が)?\s*(\d{1,2})月/.exec(t);
    if (m && MONTHS.includes(`${+m[1]}月`)) add("update_month2__c", `${+m[1]}月`, m[0]); }
  // 検討開始時期（「4月から検討」「来年2月頃に動く」）
  { const m = /(\d{1,2})月(?:頃|ごろ|中|以降|から|に|末)*(?:検討|考え|動き|動く|始め|開始|見直)/.exec(t);
    if (m && MONTHS.includes(`${+m[1]}月`)) add("Start_Considering_Date__c", `${+m[1]}月`, m[0]); }
  // ATS：「ATS は使っていない」→ 無し。名前が出たら、検討・比較の話なら競合、前は〜・やめた なら使わない、それ以外は利用中
  if (new RegExp(`(ATS|採用管理(システム|ツール)?)(は|を|も)?(${NEG}|ない)`, "i").test(t)) add("ATS__c", "無し", "ATS は使っていない");
  const comps = [];
  for (const [re, v] of ATS_ALIAS) {
    const m = re.exec(t); if (!m) continue; const end = m.index + m[0].length;
    if (negAfter(t, end) || pastBefore(t, m.index) || otherUse(t, end)) continue;
    if (talkAfter(t, end)) { if (!comps.includes(v)) comps.push(v); continue; }
    add("ATS__c", v, m[0]);
  }
  if (/(マイナビ|リクナビ|キャリタス就活)(の管理画面)?で管理|媒体(の管理画面)?で管理/.test(t)) add("ATS__c", "母集団形成の媒体で管理", "媒体で管理");
  if (comps.length) add("Competitors__c", comps, comps.join("・"));
  // LINE（公式アカウントの有無。ATS とは別の項目）
  if (new RegExp(`LINE(公式)?(アカウント)?(は|を|も)?(${NEG})`, "i").test(t)) add("Line_Implementation__c", "なし", "LINE は使っていない");
  else if (/LINE公式|公式LINE|公式ライン|LINE@|LINE(を|で)(使って|運用|配信|導入)/i.test(t)) add("Line_Implementation__c", "あり", "LINE を使っている");
  // SNS
  { const v = []; for (const [re, name] of SNS_ALIAS) { const m = re.exec(t); if (m && !negAfter(t, m.index + m[0].length)) v.push(name); } if (v.length) add("SNS__c", v, v.join("・")); }
  // 採用種別（「新卒は採っていない」は外す）
  { const v = [];
    for (const [re, name] of [[/新卒/, "新卒"], [/中途/, "中途"], [/アルバイト|バイト|パート/, "アルバイト"]]) {
      const m = re.exec(t); if (!m) continue; const after = t.slice(m.index + m[0].length, m.index + m[0].length + 14);
      if (new RegExp(`^(採用)?(は|を|も)?(${NEG}|予定(は|が)?(ない|無い|ありません))`).test(after)) continue;
      v.push(name);
    }
    if (v.includes("新卒") && v.includes("中途")) add("recruting_type__c", ["新卒＋中途", ...v.filter((x) => x === "アルバイト")], "新卒・中途");
    else if (v.length) add("recruting_type__c", v, v.join("・"));
  }
  // 担当者・役職（「人事部長の山田様」「山田様（人事課長）」「担当は山田さん」）。役職は名前と並んでいるときだけ（「社長に相談」を役職にしない）
  { const a = new RegExp(`(${ROLE})の\\s*(${NAME})\\s*(?:様|さん)`).exec(t), b = new RegExp(`(${NAME})\\s*(?:様|さん)\\s*[（(]\\s*(${ROLE})\\s*[)）]`).exec(t);
    const c = new RegExp(`(?:担当|ご担当|担当者)(?:は|が|:)\\s*(${NAME})\\s*(?:様|さん)`).exec(t);
    const role = a ? a[1] : b ? b[2] : ""; const nm = a ? a[2] : b ? b[1] : c ? c[1] : "";
    if (nm) { const sp = splitName(nm); if (sp) add("LastName", sp.last, (a || b || c)[0]); }
    if (role) {
      add("Title", role, (a || b)[0]);
      if (/人事|採用|総務/.test(role)) add("Department_Category__c", "総務・人事・労務", role);
      else if (/代表|社長|専務|常務|取締役|役員/.test(role)) add("Department_Category__c", "経営者・役員", role);
    }
  }
  // 前の担当者がいない（退職・異動・休職）→ リストの鮮度に直結するので印を付ける候補にする
  { const m = /(前の|以前の|元の)?担当(者)?(の\S{1,6}(様|さん))?(は|が)?\s*(退職|異動|辞め|休職|産休|育休)/.exec(t) || /(退職|異動)(された|した|済み|されて)/.exec(t);
    if (m) add("Retire_check__c", true, m[0]); }
  // お断りの理由（断られた記録のときだけ。掛け直しの「今忙しい」を断りにしない）
  if (outcome === "reject") for (const [re, v] of MEMO_REJECT) { const m = re.exec(t); if (m) { add("Field1__c", v, m[0]); break; } }
  return out;
}

// ── 欄で人が入れたもの（ヒアリング・受付・断り理由）から候補を作る。メモより先に見る（人が選んだ値なので） ──
export function readInputs({ hearing = null, gate = null, reason = "", outcome = "" } = {}) {
  const out = []; const add = (api, value, src, why) => { if (value != null && value !== "" && !out.some((c) => c.api === api)) out.push({ api, value, src, why }); };
  const h = hearing || {};
  if (MONTHS.includes(h.when)) add("Start_Considering_Date__c", h.when, "hearing", "ヒアリング：検討時期");
  { const b = hiresBucket(h.target); if (b) add("Number_of_hires__c", b, "hearing", `ヒアリング：採用目標 ${h.target}名`); }
  if (h.need) add("Client_Issue__c", String(h.need).trim(), "hearing", "ヒアリング：採用ニーズ");
  if (h.contact != null && h.contact !== "") add("IS_hearing__c", `説明会・面接の参加人数：${h.contact}名`, "hearing", "ヒアリング：参加人数");
  const g = gate || {};
  if (g.name) { const sp = splitName(g.name); if (sp) { add("LastName", sp.last, "gate", "受付：担当者の名前"); if (sp.first) add("FirstName", sp.first, "gate", "受付：担当者の名前"); } }
  if (g.direct) { const c = phoneCand(g.direct, "gate", "受付：直通"); if (c) add(c.api, c.value, c.src, c.why); }
  if (outcome === "reject" && REASON_TO_SF[reason]) add("Field1__c", REASON_TO_SF[reason], "reason", `断り理由：${reason}`);
  return out;
}

// メモから読んだ値のうち、空の項目でも人がチェックしたときだけ入れるもの（文脈で取り違えやすい：別の人の番号・その日いない人数・採用の話でない「新卒」）
const MEMO_ASK = new Set(["MobilePhone", "phone2__c", "NumberOfEmployees", "recruting_type__c"]);
const splitMulti = (v) => String(v ?? "").split(";").map((x) => x.trim()).filter(Boolean);
function same(type, cur, val) {
  if (type === "phone") return digits(cur) === digits(val);
  if (type === "num") return Number(cur) === Number(val);
  if (type === "bool") return !!cur === !!val;
  if (type === "url") return sq(cur).replace(/^https?:\/\//, "").replace(/\/$/, "") === sq(val).replace(/^https?:\/\//, "").replace(/\/$/, "");
  return sq(cur) === sq(val);
}
const isEmpty = (type, cur) => (type === "bool" ? !cur : cur == null || String(cur).trim() === "");

// ── 候補と SF の今の値を比べて、項目ごとに「新規・更新・追記・同じ」を決める ──
//   cands：readInputs → readMemo の順に並べたもの（同じ項目は先の方＝人が入れた方を使う）
//   cur：SF のリードの今の値（FILL_SOQL_FIELDS）。day：'YYYY-MM-DD'
//   返す：{ api, label, value（見せる値）, send（SF に送る値）, kind, src, why, on（最初からチェックが入っているか） }
export function planFills(cands, cur = {}, { day = "" } = {}) {
  const seen = new Set(); const out = [];
  const head = `【${String(day).replace(/-/g, "/")} 架電】`;
  for (const c of cands) {
    const F = FILL_FIELDS[c.api]; if (!F || seen.has(c.api)) continue; seen.add(c.api);
    const cv = cur[c.api]; let kind, send, value;
    if (F.type === "append") {
      const line = `${head}${c.value}`; value = String(c.value);
      if (String(cv || "").includes(String(c.value))) { kind = "same"; send = null; }
      else { kind = isEmpty("text", cv) ? "new" : "add"; send = `${line}${cv ? `\n${cv}` : ""}`.slice(0, 32000); }
    } else if (F.type === "multi") {
      const want = Array.isArray(c.value) ? c.value : [c.value]; const have = splitMulti(cv);
      const plus = want.filter((v) => !have.includes(v)); value = want.join("・");
      if (!plus.length) { kind = "same"; send = null; } else { kind = have.length ? "update" : "new"; send = [...have, ...plus].join(";"); }
    } else {
      value = F.type === "bool" ? "あり" : String(c.value); send = c.value;
      if (c.api === "LastName" ? isPlaceholderName(cv, cur.Company) : isEmpty(F.type, cv)) kind = "new";
      else if (same(F.type, cv, c.value)) kind = "same";
      else kind = "update";
      // 直通がリードの代表番号と同じなら、電話2 に入れる意味が無い
      if (c.api === "phone2__c" && cur.Phone && same("phone", cur.Phone, c.value)) kind = "same";
    }
    // 最初からチェックを入れるか：空を埋める・追記は入れる。書き換えは「人が欄で選んだ値」かつ「人の項目でない」ときだけ。退職の印はいつも人が選ぶ
    const on = kind === "same" ? false : c.api === "Retire_check__c" ? false : kind === "update" ? c.src !== "memo" && !F.who : !(c.src === "memo" && MEMO_ASK.has(c.api));
    out.push({ api: c.api, label: F.label, value, cur: cv == null ? "" : F.type === "append" ? String(cv).slice(0, 80) : String(cv), send, kind, src: c.src, why: c.why || "", on });
  }
  // 名は姓と同じ人のときだけ最初から入れる（SF の姓「山田」に、受付で聞いた「佐藤 太郎」の名だけ入って「山田 太郎」にならないように）
  const ln = out.find((p) => p.api === "LastName"), fn = out.find((p) => p.api === "FirstName");
  if (fn && ln && ln.kind === "update") fn.on = false;
  if (fn && !ln && !isPlaceholderName(cur.LastName, cur.Company)) fn.on = false;
  return out;
}

// 画面で選んだもの（picks：{ api: true/false }。無い項目は最初のチェックのまま）だけを、SF に送る形にする
export function pickedFields(plan, picks = {}) {
  const fields = {}; const used = [];
  for (const p of plan) {
    if (p.kind === "same" || p.send == null) continue;
    const on = Object.prototype.hasOwnProperty.call(picks || {}, p.api) ? !!picks[p.api] : p.on;
    if (!on) continue; fields[p.api] = p.send; used.push(p);
  }
  return { fields, used };
}

// 評価の点：空を埋めた（新規）・古い値を直した（更新）・長文に足した（追記）はどれも 1 項目＝1点。同じ値の確認は数えない
export const FILL_KIND_LABEL = { new: "新規", update: "更新", add: "追記", same: "確認" };
