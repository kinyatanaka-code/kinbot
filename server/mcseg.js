// SHOBO：架電リストの「条件で割り振る」ための、リード1件ごとの属性（2026-11-19 福井さん「リスト管理を kinbot 準拠で」）
//
// kincall はリードソース・従業員数・最終架電などで絞って配っている（distributeGroupLeads / sources/distribute）。
// SHOBO のリードは Bales・CSV・DOC と出どころがばらばらで、項目の名前も違うので、取り込んだ元の形から
// 「リードソース・都道府県・業界・業種・Bales での最終架電・ホットの条件・SF の過去失注」を1つの形にそろえて
// mc_call_leads.seg に持つ。毎回 JSON を全部読むと重いので、計算は1回だけ（SEG_V を上げると全部やり直す）。
// DB も通信も使わない純粋な関数だけにして、node で直接試せるようにしている。

// 2：ステージと、SF から足したリードを足した（2026-11-19）
export const SEG_V = 2;

const nk = (s) => String(s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();

// ---- 都道府県 ----
export const PREFS = ["北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"];
// 「都・府・県」が書かれていない住所のための、ほかの県に同じ名前が無い市・区
const CITY_PREF = [[/札幌市/, "北海道"], [/仙台市/, "宮城県"], [/さいたま市/, "埼玉県"], [/千葉市/, "千葉県"], [/横浜市|川崎市|相模原市/, "神奈川県"],
  [/千代田区|新宿区|渋谷区|品川区|目黒区|世田谷区|豊島区|板橋区|練馬区|江東区|墨田区|台東区|文京区|荒川区|足立区|葛飾区|江戸川区|杉並区|中野区|大田区|八王子市|町田市/, "東京都"],
  [/新潟市/, "新潟県"], [/静岡市|浜松市/, "静岡県"], [/名古屋市/, "愛知県"], [/京都市/, "京都府"], [/大阪市|堺市/, "大阪府"], [/神戸市|姫路市/, "兵庫県"],
  [/岡山市/, "岡山県"], [/広島市/, "広島県"], [/北九州市|福岡市/, "福岡県"], [/熊本市/, "熊本県"]];
export function prefFromAddress(t) {
  const s = nk(t); if (!s) return "";
  for (const p of PREFS) if (s.includes(p)) return p;
  // 「東京 千代田区」のように都・府・県を省いた書き方
  const short = PREFS.find((p) => p !== "北海道" && s.startsWith(p.slice(0, -1)) && !/^京都市/.test(s));
  if (short) return short;
  for (const [re, p] of CITY_PREF) if (re.test(s)) return p;
  return "";
}
// 住所が無いときは、固定電話の市外局番から推し量る（携帯・050・フリーダイヤルは分からない）。
//   同じ局番を2つの県で使っているところ（042・04 など）は入れていない。長い局番から先に当てる
const AREA = {
  "011": "北海道", "012": "北海道", "013": "北海道", "014": "北海道", "015": "北海道", "016": "北海道",
  "017": "青森県", "018": "秋田県", "019": "岩手県", "022": "宮城県", "023": "山形県", "024": "福島県", "025": "新潟県", "026": "長野県",
  "027": "群馬県", "028": "栃木県", "0280": "", "029": "茨城県", "03": "東京都", "043": "千葉県", "047": "千葉県", "044": "神奈川県", "045": "神奈川県", "046": "神奈川県",
  "048": "埼玉県", "049": "埼玉県", "052": "愛知県", "053": "静岡県", "0531": "愛知県", "0532": "愛知県", "0533": "愛知県", "0536": "愛知県", "054": "静岡県",
  "0550": "静岡県", "0551": "山梨県", "0552": "山梨県", "0553": "山梨県", "0554": "山梨県", "0555": "山梨県", "0556": "山梨県", "0557": "静岡県", "0558": "静岡県", "0559": "静岡県",
  "056": "愛知県", "057": "岐阜県", "058": "岐阜県", "059": "三重県", "06": "大阪府", "072": "大阪府", "073": "和歌山県",
  "0742": "奈良県", "0743": "奈良県", "0744": "奈良県", "0745": "奈良県", "0746": "奈良県", "0747": "奈良県", "0748": "滋賀県", "0749": "滋賀県", "075": "京都府",
  "0761": "石川県", "0762": "石川県", "0767": "石川県", "0768": "石川県", "0763": "富山県", "0764": "富山県", "0765": "富山県", "0766": "富山県",
  "077": "滋賀県", "0770": "福井県", "0776": "福井県", "0777": "福井県", "0778": "福井県", "0779": "福井県", "0771": "京都府", "0772": "京都府", "0773": "京都府", "0774": "京都府",
  "078": "兵庫県", "079": "兵庫県", "082": "広島県", "083": "山口県", "084": "広島県", "0852": "島根県", "0853": "島根県", "0854": "島根県", "0855": "島根県", "0856": "島根県",
  "0857": "鳥取県", "0858": "鳥取県", "0859": "鳥取県", "086": "岡山県", "087": "香川県",
  "0880": "高知県", "0887": "高知県", "0888": "高知県", "0889": "高知県", "0883": "徳島県", "0884": "徳島県", "0885": "徳島県", "0886": "徳島県", "089": "愛媛県",
  "092": "福岡県", "093": "福岡県", "094": "福岡県", "095": "長崎県", "0952": "佐賀県", "0954": "佐賀県", "0955": "佐賀県", "096": "熊本県", "097": "大分県",
  "098": "沖縄県", "0982": "宮崎県", "0983": "宮崎県", "0984": "宮崎県", "0985": "宮崎県", "0986": "宮崎県", "0987": "宮崎県", "099": "鹿児島県",
};
export function prefFromPhone(v) {
  let d = String(v || "").normalize("NFKC").replace(/[^0-9]/g, "");
  if (/^81\d{9,10}$/.test(d)) d = "0" + d.slice(2);
  if (d.length !== 10 || !/^0[1-9]/.test(d) || /^0(50|70|80|90|120|800)/.test(d)) return "";   // 固定電話は10桁
  for (const n of [4, 3, 2]) { const k = d.slice(0, n); if (k in AREA) return AREA[k]; }
  return "";
}

// ---- 業界（日本標準産業分類の大分類）：業種の言葉 → 無ければ会社名から ----
//   上から順に当てる（「学校法人の保育園」は教育ではなく先に福祉…にならないよう、より狭いものを先に）
const GYOKAI = [
  ["複合サービス事業", /農業協同組合|漁業協同組合|農協|^JA|郵便局/],
  ["公務", /市役所|区役所|町役場|村役場|県庁|都庁|府庁|官公庁|公務/],
  ["教育，学習支援業", /学校法人|学校|学園|大学|高校|高等学校|中学|小学|幼稚園|学習塾|進学塾|予備校|教育|スクール|塾$/],
  ["医療，福祉", /病院|クリニック|診療所|医院|歯科|医療法人|社会福祉法人|福祉|介護|保育|こども園|看護|訪問|デイサービス|老人ホーム|薬局|調剤|整骨|接骨|鍼灸|医療|障害者|障がい/],
  ["金融業，保険業", /銀行|信用金庫|信用組合|信金|証券|保険|金融|ファイナンス|クレジット/],
  ["不動産業，物品賃貸業", /不動産|地所|エステート|賃貸|リース|レンタル|管理組合/],
  ["運輸業，郵便業", /運輸|運送|物流|ロジスティ|交通|倉庫|配送|タクシー|バス|鉄道|航空|海運|引越/],
  ["宿泊業，飲食サービス業", /ホテル|旅館|飲食|レストラン|食堂|カフェ|居酒屋|ダイニング|料理|ケータリング|給食/],
  ["生活関連サービス業，娯楽業", /美容|理容|ヘア|エステ|ネイル|葬祭|葬儀|冠婚|ブライダル|結婚式|フィットネス|スポーツ|ゴルフ|旅行|クリーニング|温泉|遊技|アミューズ|レジャー/],
  ["学術研究，専門・技術サービス業", /法律事務所|弁護士|会計事務所|監査法人|税理士|司法書士|社労士|社会保険労務士|行政書士|特許|設計事務所|コンサル|研究所|研究開発|デザイン|広告/],
  ["サービス業（他に分類されないもの）", /人材|派遣|職業紹介|警備|清掃|ビルメンテ|ビル管理|廃棄物|産業廃棄|整備|BPO|アウトソーシング/],
  ["情報通信業", /システム|ソフトウェア|ソフト|(^|[^A-Za-z])IT([^A-Za-z]|$)|情報|通信|インターネット|ネット|デジタル|テック|[Ww]eb|ウェブ|アプリ|放送|出版|新聞|ゲーム|データ/],
  ["卸売業，小売業", /商事|商社|販売|小売|卸|ストア|スーパー|百貨店|ドラッグ|ショップ|商店|ディーラー|物産|通販|青果/],
  ["建設業", /建設|工務店|土木|建築|設備工事|電気工事|管工事|塗装|リフォーム|住宅|ハウス|組$/],
  ["製造業", /製作所|製造|工業|工場|メーカー|製薬|化学|食品|鉄工|金属|機械|電機|精機|印刷|製菓|酒造|醸造|繊維|樹脂/],
  ["電気・ガス・熱供給・水道業", /電力|ガス|水道|エネルギー|熱供給/],
  ["農業，林業", /農園|農場|ファーム|林業|森林|牧場/],
  ["漁業", /漁業|水産|養殖/],
];
export function gyokaiOf(gyoshu, company) {
  for (const t of [nk(gyoshu), nk(company)]) { if (!t) continue; for (const [name, re] of GYOKAI) if (re.test(t)) return name; }
  return "";
}

// 元のデータから、名前の合う項目の値を1つ取る（Bales は英語の名前、CSV は見出しのまま、DOC は extra）
function pick(d, re) {
  for (const [k, v] of Object.entries(d || {})) if (v != null && typeof v !== "object" && re.test(k) && nk(v)) return nk(v);
  return "";
}
const isTs = (v) => { const t = Date.parse(String(v || "")); return Number.isFinite(t) && t > Date.UTC(2000, 0, 1) ? new Date(t).toISOString() : ""; };

// ---- ホットの条件（担当者名・ニーズ・検討時期）。Bales の判定（hot_d）と、SHOBO で聞いたこと（hearing）の両方を見る ----
export function condsOf(hotD, hearing, person) {
  const out = new Set();
  const h = hotD || {};
  // Bales の判定が無い（CSV・DOC）ときは、担当者名が入っていれば「担当者名あり」とする
  if (!hotD && nk(person).replace(/(様|さま|さん|殿)$/, "").length >= 1 && !/不明|担当者?$|^-+$/.test(nk(person))) out.add("name");
  if (h.name && h.name.st === "あり") out.add("name");
  if (h.need && h.need.st === "あり") out.add("need");
  if (h.when && h.when.st === "あり") out.add("when");
  const g = hearing || {};
  if (g.when && g.when !== "未定") out.add("when");
  if (g.need) out.add("need");
  return [...out];
}

// src：bales|csv|doc|sf。data：取り込んだ元の行。sfLead：SF のリード（API 名の項目）。doc：DOC の call_targets の行
//   SF から足したリード（2026-11-19）は data に日本語の見出しで入れ、失注などの SF の項目は data._sf、ホットの判定は data._hot に持つ
export function segOf({ src, data, company, phone, person, sfLead, hotD, hearing, doc } = {}) {
  const d = data || {}; const T = doc || {}; const ex = (T.extra && typeof T.extra === "object") ? T.extra : {};
  const L = sfLead || (d._sf && typeof d._sf === "object" ? d._sf : {});
  if (!hotD && d._hot && typeof d._hot === "object") hotD = d._hot;
  // リードソース：Bales は leadSources の名前（複数あれば最初）、CSV・SF は「リードソース」などの列、DOC は kincall のソース
  let source = src === "bales" ? (d["leadSources.0.name"] || "") : src === "doc" ? (T.source || "") : pick(d, /^(リードソース|リード ?ソース|流入元|流入経路|ソース|媒体|lead ?source|source)$/i);
  source = nk(source).slice(0, 60) || ({ bales: "Bales（ソースなし）", csv: "CSV 取り込み", doc: "DOC（ソースなし）", sf: "SF（ソースなし）" }[src] || "不明");
  // ステージ：Bales のリードステージ／SF のリードの状況／DOC のステージ（「受注済みの会社は配らない」のように使う）
  const stage = nk(src === "bales" ? d.lastLeadStageName : src === "sf" ? d["ステータス"] : src === "doc" ? (T.stage || "") : pick(d, /^(ステージ|ステータス|状況|stage|status)$/i)).slice(0, 40);
  // 都道府県：住所 → 都道府県の列 → 電話番号の市外局番（推定）
  const addr = pick(d, /^(companyAddress|address|住所|所在地|本社所在地|会社住所|prefecture|都道府県)$/i) || nk(ex["住所"] || ex["所在地"] || ex["本社所在地"] || ex["都道府県"] || "");
  let pref = prefFromAddress(addr), prefBy = pref ? "住所" : "";
  if (!pref) { pref = prefFromPhone(phone || d.companyTel1 || ""); prefBy = pref ? "電話" : ""; }
  // 業種：Bales の businessCategory／CSV の「業種」列／DOC の industry
  const gyoshu = (pick(d, /^(businessCategory|業種|業種名|industry|業界|事業内容)$/i) || nk(T.industry) || nk(ex["業種"]) || "").slice(0, 60);
  const gyokai = gyokaiOf(gyoshu, company);
  // Bales（や DOC）で最後にかけた日時と結果。SHOBO でかけたものは mc_call_leads.last_at / last_outcome にあるので、そちらと新しい方を使う
  //   SF は最後の活動日（電話に限らない）しか無いので、それを使う
  const extLast = isTs(d.lastCalledAt) || isTs(T.last_at) || isTs(d["最終活動日"]) || "";
  const extResult = nk(d.callResult || T.status || "").slice(0, 40);
  // SF の過去失注：失注理由（大）・失注前のステージ・バッティング負けの競合・失注日
  const lost = (L.Lostopp_reason1__c || L.LostOpp_lostdate__c || L.LostOppID__c)
    ? { reason: nk(L.Lostopp_reason1__c).slice(0, 60) || "理由なし", reason2: nk(L.Lostopp_reason2__c).slice(0, 60), stage: nk(L.Lostopp_beforeCloseStage__c).slice(0, 40),
        rival: nk(L.Losing_batting__c).slice(0, 60), date: nk(L.LostOpp_lostdate__c).slice(0, 10) }
    : null;
  return { v: SEG_V, source, stage, pref, prefBy, gyoshu, gyokai, extLast, extResult, conds: condsOf(hotD, hearing, person), lost };
}

// ---- SF のリード（API の1件）→ SHOBO のリードの形（2026-11-19 福井さん「SF からもリードを足せるように」） ----
//   見出しは日本語にして data に入れる（架電画面の「元のデータ」にそのまま出るように）。
//   SF の項目（失注など）は data._sf、ホットの判定（担当者名・ニーズ・検討時期）は data._hot に持つ（segOf が読む）
export const SF_LEAD_FIELDS = ["Id", "Company", "Phone", "MobilePhone", "LastName", "FirstName", "Title", "Email", "Status", "LeadSource", "Industry", "State", "City", "Street",
  "NumberOfEmployees", "LastActivityDate", "Website", "Lostopp_reason1__c", "Lostopp_reason2__c", "Lostopp_beforeCloseStage__c", "Losing_batting__c", "LostOpp_lostdate__c", "LostOppID__c",
  "Client_Issue__c", "Client_Current_Status__c", "Start_Considering_Date__c", "update_month__c", "ATS__c", "Ban_Type__c"];
export function sfLeadRow(l, judgeHot) {
  const v = (x) => (x == null ? "" : String(x).replace(/\r/g, "").trim());
  const person = [v(l.LastName), v(l.FirstName)].filter(Boolean).join(" ");
  const data = {
    会社名: v(l.Company), 電話: v(l.Phone), personalTel: v(l.MobilePhone), 担当者: person, 役職: v(l.Title), email: v(l.Email),
    ステータス: v(l.Status), リードソース: v(l.LeadSource), 業種: v(l.Industry), 住所: [v(l.State), v(l.City), v(l.Street)].filter(Boolean).join(""),
    従業員数: v(l.NumberOfEmployees), 最終活動日: v(l.LastActivityDate), Webサイト: v(l.Website),
    顧客の課題感: v(l.Client_Issue__c), 顧客の現状: v(l.Client_Current_Status__c), 検討開始時期: v(l.Start_Considering_Date__c), 現利用サービス更新予定月: v(l.update_month__c), 利用中ATS: v(l.ATS__c),
  };
  for (const k of Object.keys(data)) if (!data[k]) delete data[k];
  data._sf = {}; for (const k of ["Lostopp_reason1__c", "Lostopp_reason2__c", "Lostopp_beforeCloseStage__c", "Losing_batting__c", "LostOpp_lostdate__c", "LostOppID__c"]) if (v(l[k])) data._sf[k] = v(l[k]);
  let hot = null;
  if (judgeHot) { const h = judgeHot({ targetName: person, comment: [data.顧客の現状, data.顧客の課題感].filter(Boolean).join("。") }, { 顧客の課題感: data.顧客の課題感 || "", 検討開始時期: data.検討開始時期 || "", 現利用サービス更新予定月: data.現利用サービス更新予定月 || "" });
    if (h) { data._hot = { name: h.name, need: h.need, when: h.when }; hot = h.n; } }
  return { company: v(l.Company), phone: v(l.Phone) || v(l.MobilePhone), person, sf_lead_id: /^00Q[0-9A-Za-z]{12,15}$/.test(v(l.Id)) ? v(l.Id) : null, hot, data, ban: v(l.Ban_Type__c) };
}

// ---- BALES の行 → SHOBO に移すときの「次にかける日時」と「かけた回数」（2026-11-19 福井さん「BALES は解約するので全部移す」） ----
//   次のアクション（nextActions.N）のうち終わっていない「コール」の予定で、いちばん早いもの。BALES で入れた掛け直しの予約を失わないため
export function balesCarry(d = {}) {
  let next = null;
  for (let i = 0; i < 50; i++) {
    const at = d[`nextActions.${i}.reservedAt`]; if (at == null) { if (d[`nextActions.${i}.id`] == null) break; continue; }
    if (String(d[`nextActions.${i}.isDone`]) === "true") continue;
    const t = Date.parse(at); if (Number.isFinite(t) && (next == null || t < next)) next = t;
  }
  const n = parseInt(d.callResultsCount, 10);
  return { next_at: next != null ? new Date(next).toISOString() : null, attempts: Number.isFinite(n) && n > 0 ? Math.min(n, 999) : 0 };
}

// ---- SF から足すときの条件 → SOQL の WHERE（2026-11-19） ----
//   （Ban_Type__c が入っているリードは、SHOBO のアプローチ禁止とは別に SF 側で止めているので最初から外す）
//   いつも：MOCHICA のリード（レコードタイプ）・コンバートしていない・アプローチ禁止の種類が入っていない。
//   status / source：選んだもののどれか。lostOnly：失注の情報があるもの。idleDays：最後の活動が N 日より前（活動なしも含む）。q：会社名に含む
const soqlStr = (v) => `'${String(v).slice(0, 120).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
export function sfLeadWhere(f = {}) {
  const w = ["RecordType.Name = 'Mochica（リード）'", "IsConverted = false", "Ban_Type__c = null"];
  const list = (a) => (Array.isArray(a) ? a.map((x) => String(x)).filter((x) => x.length).slice(0, 100) : []);
  const inOr = (field, vals) => { const real = vals.filter((v) => v !== "（なし）"); const o = []; if (real.length) o.push(`${field} IN (${real.map(soqlStr).join(",")})`); if (vals.includes("（なし）")) o.push(`${field} = null`); return o.length ? `(${o.join(" OR ")})` : ""; };
  const st = inOr("Status", list(f.status)); if (st) w.push(st);
  const so = inOr("LeadSource", list(f.source)); if (so) w.push(so);
  if (f.lostOnly) w.push("(LostOppID__c != null OR LostOpp_lostdate__c != null)");
  const d = parseInt(f.idleDays, 10); if (d > 0) w.push(`(LastActivityDate = null OR LastActivityDate < LAST_N_DAYS:${Math.min(d, 3650)})`);
  const q = String(f.q || "").replace(/[%_]/g, "").trim(); if (q) w.push(`Company LIKE ${soqlStr("%" + q + "%")}`);
  return w.join(" AND ");
}
