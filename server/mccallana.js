// SHOWIN のダッシュボード「架電分析」：Zoom Phone の発信と架電メモを突き合わせて、担当者に繋がった後の中身を数える（2026-11-23 福井）
//
// なぜ作ったか：
//   架電メモ（Bales→SF の「日付_電話_名前」と MOCHICALL の記録）だけでは「何分話したか」が分からず、
//   Zoom Phone の通話履歴だけでは「担当者と話せたか・何を聞けたか」が分からない。
//   2つを電話番号と時刻で結び付けると、担当者に繋がった電話のうち
//     ・2分以上話せた割合（会話が続いたか）
//     ・ヒアリングできた割合（採用の中身を1つでも聞けたか）
//     ・日程を打診できた割合（アポの打診まで進めたか）
//   が出せる。2026-11-23 の Bales 架電メモ全件の調査（接続状況・ヒアリング項目・断り理由・人別・月別）も同じ物差しで出す。
//
// 判定はメモの言葉の一覧（AI は使わない＝費用が増えない）。辞書の考え方は調査のときの Python と同じ。
//   Zoom は mchist.js が全社の通話を日ごとに写している mc_zoom_calls を読むだけ（Zoom の API は新しく呼ばない）。
//
// 純関数（classifyMemo・matchCalls・summarize）は DB も通信も使わないので、dev/mccallana_check.mjs で直接試せる。

const nz = (v) => String(v || "").replace(/[\s　]/g, "");
const digits = (v) => String(v || "").normalize("NFKC").replace(/[^0-9]/g, "");
// mchist.js と同じ番号の鍵（+81… を 0… に直す）。Zoom の相手番号とリードの番号をそろえる
export const telKey = (v) => { let d = digits(v); if (/^81\d{9,10}$/.test(d)) d = "0" + d.slice(2); return d.length >= 9 ? d : ""; };
const rx = (...a) => new RegExp(a.join("|"));

// ───────── メモの読み方 ─────────
// 電話番号だけの行と、決まった書き出し（┗15名以上。┗人材リスト。初回コール。再コール。など）は中身ではないので落とす
const PHONE_LINE = /^\s*0\d{1,4}[-‐ー‑]?\d{1,4}[-‐ー‑]?\d{3,4}\s*$/gm;
const TEMPLATE_LINE = /^[┗ ]*(\d+名以上。?|[^\n]{0,12}リスト。?|初回コール。?.*|再コール。?.*|状況確認。?.*|日程調整。?.*)$/gm;
export function memoBody(s) {
  return String(s || "").normalize("NFKC").replace(/\r/g, "").replace(PHONE_LINE, "").replace(TEMPLATE_LINE, "").trim();
}

// 接続の様子。上から順に当てる（前向きな言葉があれば断りより先に、断りがあれば不在より先に）
const STATUS = [
  ["前向き", rx("アポ(?!取れず|とれず|は取れず|は無理|NG|ng|断|も?取れなかった|にならず|ならず|獲得できず)(獲得|取得|確定|OK|ok|決定|設定|取れ|とれ|ゲット|!)", "商談(設定|確定|決定|化)", "日程(確定|決定|調整済)",
    "(話|お話)(を)?(聞きたい|聞いてみたい|聞いても(いい|良い))", "興味(が)?(ある|あり|有)", "資料(を)?(送って|ください|ほしい|欲しい|送付希望)", "前向き")],
  ["断り", rx("いらない|要らない|必要(ない|なし|ありません)|不要|結構です|けっこうです|大丈夫|間に合って|興味(が)?(ない|なし|無)|お断り|断られ",
    "検討(しない|していない|できない|しておりません)|新規(は)?(×|NG|ng|いらない|不要|結構|お断り|受け付けて|無理)|案内不要|一律|取引(している|がある|先のみ)",
    "決まっ(て|た)(いる|ところ)|予定(は)?(ない|なし)|やって(い)?ない|していない|困って(い)?ない|順調|うまくいって|充足|余力|予算(が)?(ない|なし|取れない|割けない)|よさんない",
    "必要(に|と)?(おもって|思って|して)(い)?ない|(検討|見当)(は)?(しない|しません)|やらない|いいかな")],
  ["受付ブロック", rx("受付ブロック|受けブロ|受ブロ|取り?次(げない|いでもらえない|がない|げません|ぎできない)|お?繋(ぎ|げ)(できません|ない|られない)|つなげない",
    "営業(電話)?(は)?(お断り|NG|受け付け)|ガチャ切り|切られた|すぐ切|門前払い|着拒")],
  ["リスト不備", rx("番号(が)?(違|ちが)|重複|アーカイブ|会社名\\S{0,10}(不一致|変わ|になって)|人事(は|が)いない|FAX|ファックス|現アナ|使われておりません|電源(が)?入って|https?://|移転|閉鎖|倒産|廃業|存在しない")],
  ["担当者情報のみ", rx("退職|異動|辞め|やめた|担当(者)?(が|は)?(変わ|かわ|替わ|外れ)|後任|担当(者)?(は|が)\\S{1,8}(さん|様)|宛て?で|呼び出し|名前")],
  ["未接続", rx("不在|離席|席外|席を外|席はずし|外出|出張|会議|打(ち)?合(わ)?せ|ミーティング|MTG|営業時間外|時間外|営外|帰(った|られ|宅|社|り)|かえ(った|られ)|休み|休暇|定休|産休|育休",
    "不通|コール(音)?(のみ|だけ)|コール音|鳴りっぱなし|なりっぱなし|留守|話し中|通話中|ツウワチュウ|電話中|対応中|来客|戻り|在宅|リモート|テレワーク|出社|出勤|退勤|定時",
    "かけなおし|掛け直し|架け直し|折り?返し|再コール|また(かける|連絡|改め|明日|午後|後で|来週)|改め|日に?ち?を?改|来週|週明け|時間不明|音声(案内|ガイダンス)|ガイダンス|アナウンス|AI受付",
    "繋がらない|つながらない|出ない|でない|いない|いません|午後から|\\d+時半|\\d+時(くらい|以降|頃|ごろ|過ぎ|前)|\\d+分|^\\d{1,2}(時|:\\d\\d)?$|^(明日|午後|午前|すぐ|夕方)$|^電話$|^でんわ$|^☎$")],
];

// 聞けた中身（ヒアリング項目）。1つでも当たれば「ヒアリングできた」とする
export const DIMS = {
  "採用対象・卒年": rx("新卒|中途|第二新卒|\\d{2}卒|高卒|大卒|専門卒|院卒|理系|文系|インターン|アルバイト|パート|障[害碍]者|技術職|事務職|営業職|総合職|職種"),
  "採用人数・実績": rx("\\d+\\s*(名|人)(?!以上。)|採用人数|目標人数|採用目標|承諾\\S{0,4}\\d|辞退\\S{0,4}\\d|エントリー\\S{0,6}\\d|応募\\S{0,6}\\d"),
  "採用活動の状況": rx("採用(活動)?(は|を)?(して|やって|行って|予定|停止|止め|凍結|終了|終わ|充足|順調|うまく|苦戦|進捗)|新卒(は|を)?(して|やって|取って|採って|予定)|採用(していない|しない|なし)|充足|確保|決まって"),
  "採用手法・媒体": rx("マイナビ|リクナビ|オファーボックス|OfferBox|offerbox|キャリタス|ワンキャリ|doda|ドラフト|あさがく|ハローワーク|ハロワ|学校|大学|高校|キャリアセンター|就職課|紹介|エージェント|合説|合同説明会|説明会|イベント|EXPO|SNS|インスタ|Instagram|TikTok|YouTube|LINE|ライン|スカウト|ダイレクト|リファラル|自社(HP|サイト)|採用サイト|HP|Indeed|インディード|求人|媒体|ナビ"),
  "ATS・ツール": rx("ATS|i-web|iweb|アイウェブ|sonar|SONAR|ソナー|HRMOS|ハーモス|MOCHICA|モチカ|HERP|ジョブカン|エアワーク|タレントパレット|採用管理|管理(システム|ツール)|ツール|システム"),
  "課題": rx("課題|悩み|困って|母集団|応募(が)?(少|集ま|来)|エントリー(が)?少|集ま(らない|りにくい)|歩留|辞退|つなぎ止め|繋ぎ止め|フォロー|説明会(の)?(参加|出席|集客)|集客|キャンセル|工数|手間|負担|リソース|人手|手が回ら|認知|知名度|ネームバリュー|ミスマッチ|定着|離職|志望度|苦戦"),
  "時期・スケジュール": rx("\\d{1,2}月|来期|今期|来年|今年|年度|上期|下期|春|夏|秋|冬|時期|タイミング|スケジュール|計画|予算(組|取り|策定)|落ち着いたら|以降"),
  "予算・費用": rx("予算|費用|コスト|料金|金額|価格|無料|有料|高い|安い|見積"),
  "決裁・体制": rx("社長|代表|役員|部長|課長|上長|上司|決裁|稟議|本社|本部|グループ|親会社|人事部|総務|担当(者)?(は|が)|\\d名体制|複数|ひとり|一人で"),
  "競合・既存取引": rx("他社|他の(ツール|サービス|会社)|取引|契約|導入(して|済|先)|使って(い)?る|利用して|お願いして(い)?る|既存|ユーザー|乗り換え|リプレイス|ネオキャリア"),
};
export const REASONS = [
  ["採用予定なし", rx("(新卒|採用)(は|を)?(やって(い)?ない|していない|してない|予定(は)?(ない|なし)|しない|ない|なし|止め|停止|凍結)|採用(関係|活動)?(は)?(ない|なし|していない)|採用やってな")],
  ["採用は順調・充足", rx("充足|順調|うまくいって|上手くいって|困って(い)?ない|足りて|確保(でき|した|済)|目標(人数)?(は|を)?(達成|確保|超え|上振)|十分")],
  ["他社・既存で足りている", rx("他(社|の(ツール|サービス|会社|ところ))|取引(している|がある|先)|(使って|導入して|契約して|お願いして)(い)?る|導入先が決まって|決まったところ|既存|今のところで|マイナビ|リクナビ|オファーボックス|i-web|sonar|SONAR|HRMOS|タレントパレット")],
  ["予算がない", rx("予算|費用(を)?かけ|お金")],
  ["時期が合わない", rx("(今|いま)(は|じゃない|のところ)|時期|来年|来期|タイミング|落ち着いたら|検討(しない|していない|できない|しておりません)|新しい(こと|サービス|もの|施策|ツール)")],
  ["忙しい・余力なし", rx("忙し|余力|リソース|手が回ら|立て込|バタバタ|時間(が)?(取れ|ない)")],
  ["一律お断り", rx("一律|営業(電話)?(は)?(お断り|不要|NG|受け付け)|新規(は)?(×|NG|ng|いらない|不要|結構|お断り|受け付けて)|案内(は)?不要")],
  ["規模・対象が合わない", rx("少ない|少人数|規模|1名|一人だけ|対象外|障[害碍]者|中途のみ|中途しか")],
  ["本社・グループで決める", rx("本社|本部|グループ|親会社|上(の|で)(判断|決め)")],
];
// 日程の打診：アポの日時を相手に投げかけたか（取れたかどうかは問わない）。「アポ打診」「日程を打診」「候補日」「ご都合」など
const SCHEDULE = rx("打診", "日程(を)?(調整|提案|候補|伺|確認|出し|ください|送)", "候補(日|日程)", "空いて(いる|る)(日|時間)", "ご都合", "都合(の)?(いい|良い|つく)",
  "アポ(?!取れず|とれず|は取れず|は無理|NG|ng|断|も?取れなかった|にならず|ならず|獲得できず)(獲得|取得|確定|OK|ok|決定|設定|取れ|とれ|ゲット|!)", "商談(設定|確定|決定)",
  "\\d{1,2}/\\d{1,2}\\S{0,8}(アポ|商談|打ち合わせ|打合せ|MTG|面談)", "(アポ|商談|面談|打ち合わせ)\\S{0,4}(提案|お願い|もらえ|取れ|とれ|入れ)(?!ず|なか|ませ)");

// メモ1件 → { status, reached, dims, reasons, schedule }
//   reached＝担当者と話せた：前向き・断り、または（その他・担当者情報のみ で）採用の中身が書いてある
export function classifyMemo(text) {
  const raw = String(text || "").trim();
  if (!raw) return { status: "空欄", reached: false, dims: [], reasons: [], schedule: false };
  const b = memoBody(raw);
  let status = "その他";
  if (!b) status = "未接続";
  else for (const [k, r] of STATUS) if (r.test(b)) { status = k; break; }
  const dims = b ? Object.entries(DIMS).filter(([, r]) => r.test(b)).map(([k]) => k) : [];
  const reached = status === "前向き" || status === "断り" || ((status === "その他" || status === "担当者情報のみ") && dims.length > 0);
  const reasons = status === "断り" ? REASONS.filter(([, r]) => r.test(b)).map(([k]) => k) : [];
  if (status === "断り" && !reasons.length) reasons.push("理由の記載なし");
  return { status, reached, dims, reasons, schedule: !!b && SCHEDULE.test(b) };
}

// MOCHICALL の記録 → 同じ形。担当者と話せたかは記録の reach が正（メモの言葉より確か）。聞いたこと（hearing）も項目に足す
const HEARING_DIM = { when: "時期・スケジュール", need: "課題", contact: "採用人数・実績", target: "採用人数・実績" };
export function classifyLog(log) {
  const c = classifyMemo(log.memo || "");
  const reached = log.reach === "person";
  const dims = new Set(c.dims);
  const h = log.hearing && typeof log.hearing === "object" ? log.hearing : {};
  for (const [k, d] of Object.entries(HEARING_DIM)) if (h[k] !== undefined && h[k] !== null && h[k] !== "") dims.add(d);
  // 結果（REACH：none／gate／person と outcome）を、メモと同じ接続の様子の名前にそろえる
  let status;
  if (reached) status = log.outcome === "apo" || log.outcome === "doc_send" ? "前向き" : log.outcome === "reject" ? "断り" : "担当者と会話";
  else if (log.reach === "gate") status = log.outcome === "blocked" || log.outcome === "inquiry" ? "受付ブロック" : "未接続";
  else if (log.reach === "none") status = log.outcome === "invalid" ? "リスト不備" : "未接続";
  else status = c.status;
  // 断り理由：MOCHICALL で選んだ理由（REJECT_REASONS）を、メモの理由と同じ名前にして重ねる
  const LOG_REASON = { "今は必要ない": "時期が合わない", "他社を使っている": "他社・既存で足りている", "時期が合わない": "時期が合わない", "予算が無い": "予算がない", "採用の予定が無い": "採用予定なし" };
  let reasons = [];
  if (status === "断り") {
    reasons = c.reasons.filter((k) => k !== "理由の記載なし");
    const lr = LOG_REASON[String(log.reason || "")]; if (lr && !reasons.includes(lr)) reasons.push(lr);
    if (!reasons.length) reasons.push("理由の記載なし");
  }
  return { status, reached, dims: [...dims], reasons, schedule: c.schedule || log.outcome === "apo" || !!log.apo_at };
}

// ───────── Zoom の発信とメモの突き合わせ ─────────
// calls：[{ id, t(ミリ秒), dur(秒), peer, owner, ownerName, ok(通話成立) }]
// memos：[{ id, t(ミリ秒), phones:[鍵…], who(名前), src:"bales"|"mochicall", c:classify の結果 }]
// メモ1件を、同じ番号への発信のうち「発信の2分前〜通話が終わって30分後」に入るものへ結び付ける。
//   メモは通話の後に書くので、終わった時刻に近いものを選ぶ。押し直し（0秒の発信）より通話成立した発信を先に。
//   1本の発信には1件のメモだけ（MOCHICALL の記録があれば Bales より先に＝担当者と話せたかが確かなため）
export const WIN_BEFORE = 120e3, WIN_AFTER = 30 * 60e3;
export function matchCalls(calls, memos) {
  const byPeer = new Map();
  for (const c of calls) { if (!c.peer) continue; const a = byPeer.get(c.peer) || []; a.push(c); byPeer.set(c.peer, a); }
  const taken = new Map();   // call.id -> memo
  const order = [...memos].sort((a, b) => (a.src === b.src ? a.t - b.t : a.src === "mochicall" ? -1 : 1));
  for (const m of order) {
    let best = null, bestScore = Infinity;
    for (const p of new Set(m.phones)) for (const c of byPeer.get(p) || []) {
      if (taken.has(c.id)) continue;
      const end = c.t + (c.dur || 0) * 1000;
      if (m.t < c.t - WIN_BEFORE || m.t > end + WIN_AFTER) continue;
      // 小さいほど良い：通話成立していない発信は大きく後回し、同じ人なら少し優先
      const score = Math.abs(m.t - end) + (c.ok ? 0 : 3600e3) + (m.who && c.ownerName && nz(m.who) !== nz(c.ownerName) ? 600e3 : 0);
      if (score < bestScore) { best = c; bestScore = score; }
    }
    if (best) taken.set(best.id, m);
  }
  return calls.map((c) => ({ ...c, memo: taken.get(c.id) || null }));
}

// ───────── 集計 ─────────
const MIN2 = 120;
function blank() {
  return { calls: 0, ok: 0, min2All: 0, matched: 0, reached: 0, r2min: 0, rHear: 0, rDeep: 0, rSched: 0, r2Hear: 0, r2Sched: 0, rU2: 0, rU2Hear: 0, rU2Sched: 0, rHearSched: 0,
    talkSec: 0, status: {}, dims: {}, reasons: {}, refusals: 0, durBins: [0, 0, 0, 0, 0], src: { bales: 0, mochicall: 0 } };
}
const DUR_BINS = [60, 120, 180, 300];   // 〜1分・1〜2分・2〜3分・3〜5分・5分〜
function add(a, r) {
  a.calls++; if (r.ok) a.ok++; if (r.dur >= MIN2) a.min2All++;
  const m = r.memo; if (!m) return;
  a.matched++; a.src[m.src] = (a.src[m.src] || 0) + 1;
  const c = m.c; a.status[c.status] = (a.status[c.status] || 0) + 1;
  if (!c.reached) return;
  a.reached++; a.talkSec += r.dur || 0;
  const long = (r.dur || 0) >= MIN2, hear = c.dims.length > 0;
  a.durBins[DUR_BINS.filter((x) => (r.dur || 0) >= x).length]++;
  if (long) a.r2min++; else a.rU2++;
  if (hear) a.rHear++; if (c.dims.length >= 3) a.rDeep++; if (c.schedule) a.rSched++;
  if (long && hear) a.r2Hear++; if (long && c.schedule) a.r2Sched++;
  if (!long && hear) a.rU2Hear++; if (!long && c.schedule) a.rU2Sched++;
  if (hear && c.schedule) a.rHearSched++;
  for (const d of c.dims) a.dims[d] = (a.dims[d] || 0) + 1;
  if (c.status === "断り") { a.refusals++; for (const k of c.reasons) a.reasons[k] = (a.reasons[k] || 0) + 1; }
}
// rows：matchCalls の結果に { day:"YYYY-MM-DD", person } を付けたもの
export function summarize(rows) {
  const total = blank(), byPerson = {}, byMonth = {}, byPersonMonth = {};
  for (const r of rows) {
    add(total, r);
    add(byPerson[r.person] = byPerson[r.person] || blank(), r);
    const mo = String(r.day || "").slice(0, 7);
    add(byMonth[mo] = byMonth[mo] || blank(), r);
    const pm = (byPersonMonth[r.person] = byPersonMonth[r.person] || {}); add(pm[mo] = pm[mo] || blank(), r);
  }
  return { total, byPerson, byMonth, byPersonMonth };
}

// ───────── 読み込み（本番のデータ） ─────────
const jstDay = (ms) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
const okResult = (s, r) => s > 0 && !/cancel|no.?answer|reject|busy|miss|voicemail/i.test(String(r || ""));
const soqlDt = (day) => `${day}T00:00:00+09:00`;
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

// deps：{ db(pg pool), sfQueryAll, sfOwner(), members:Set(メール), roster:[{name, zoom}] }
export async function loadCallAna(deps, { from, to }) {
  const sources = {}, t0 = Date.now();
  const P = deps.db;
  const fromMs = Date.parse(soqlDt(from)), toMs = Date.parse(soqlDt(to)) + 86400e3;
  const zoomName = new Map((deps.roster || []).filter((p) => p.zoom).map((p) => [nz(p.zoom), p.name]));
  const isMember = (email, name) => (email && deps.members.has(String(email).toLowerCase())) || zoomName.has(nz(name));

  // ① Zoom Phone の発信（mc_zoom_calls は mchist.js が10分ごとに写している）
  //   だれの発信を数えるかは、架電メモ（②③）を読んでから決める（メンバー設定に漏れていても、Bales にメモを書いている人は数えるため）
  let zrows = [], sync = {}, zerr = "";
  try {
    sync = (await P.query(`SELECT to_char(min(day),'YYYY-MM-DD') AS oldest, to_char(max(done_at) AT TIME ZONE 'Asia/Tokyo','MM/DD HH24:MI') AS at FROM mc_zoom_sync`)).rows[0] || {};
    zrows = (await P.query(`SELECT id, at, peer, owner_email, owner_name, result, duration FROM mc_zoom_calls
      WHERE at >= $1 AND at < $2 AND COALESCE(direction,'') NOT IN ('inbound','incoming')`, [new Date(fromMs), new Date(toMs)])).rows;
  } catch (e) { zerr = e.message; }

  // ② Bales の架電メモ（SF の Task「日付_電話_名前」）。件名の日付が書いた日より後のものは「次回の予定」なので除く
  const memos = [];
  try {
    const owner = await deps.sfOwner();
    const toNext = new Date(Date.parse(to + "T00:00:00Z") + 86400e3).toISOString().slice(0, 10);   // to の翌日
    const ts = await deps.sfQueryAll(owner, `SELECT Id, Subject, Description, CreatedDate, WhoId FROM Task WHERE Subject LIKE '%\\_電話\\_%' AND CreatedDate >= ${soqlDt(from)} AND CreatedDate < ${soqlDt(toNext)}`, 50000);
    const real = ts.filter((t) => { const m = String(t.Subject || "").match(/^(\d{4}-\d{2}-\d{2})_電話_/); return !m || m[1] <= jstDay(Date.parse(t.CreatedDate)); });
    // 番号はリード・取引先責任者から。メモの中に書かれた番号も鍵にする（植野さんのメモは1行目が番号）
    const ids = [...new Set(real.map((t) => t.WhoId).filter(Boolean))];
    const phones = new Map();
    for (const [obj, pre] of [["Lead", "00Q"], ["Contact", "003"]]) {
      for (const part of chunk(ids.filter((i) => i.startsWith(pre)), 300)) {
        const rs = await deps.sfQueryAll(owner, `SELECT Id, Phone, MobilePhone FROM ${obj} WHERE Id IN ('${part.join("','")}')`, 1000);
        for (const r of rs) phones.set(r.Id, [telKey(r.Phone), telKey(r.MobilePhone)].filter(Boolean));
      }
    }
    for (const t of real) {
      const inText = (String(t.Description || "").normalize("NFKC").match(/0\d{1,4}[-‐ー‑]?\d{1,4}[-‐ー‑]?\d{3,4}/g) || []).map(telKey).filter(Boolean);
      const ph = [...(phones.get(t.WhoId) || []), ...inText];
      if (!ph.length) continue;
      memos.push({ id: t.Id, t: Date.parse(t.CreatedDate), phones: ph, who: String(t.Subject || "").replace(/^\d{4}-\d{2}-\d{2}_電話_/, ""), src: "bales", c: classifyMemo(t.Description) });
    }
    sources["Bales の架電メモ"] = { status: "ok", note: `SF の架電メモ ${real.length}件（次回の予定 ${ts.length - real.length}件は除外）・番号が分かったもの ${memos.length}件` };
  } catch (e) { sources["Bales の架電メモ"] = { status: "ng", note: "SF の架電メモを読めませんでした：" + e.message }; }

  // ③ MOCHICALL の記録（元に戻したものは除く）
  try {
    const rs = (await P.query(`SELECT id, caller, phone, reach, outcome, reason, memo, hearing, apo_at, created_at FROM mc_call_logs
      WHERE created_at >= $1 AND created_at < $2 AND NOT undone AND biz = 'MOCHICA'`, [new Date(fromMs), new Date(toMs)])).rows;
    let n = 0;
    for (const r of rs) { const k = telKey(r.phone); if (!k) continue; n++; memos.push({ id: "m" + r.id, t: new Date(r.created_at).getTime(), phones: [k], who: "", src: "mochicall", c: classifyLog(r) }); }
    sources["MOCHICALL の記録"] = { status: "ok", note: `記録 ${rs.length}件（番号あり ${n}件）` };
  } catch (e) { sources["MOCHICALL の記録"] = { status: "ng", note: "MOCHICALL の記録を読めませんでした：" + e.message }; }

  const authors = new Set(memos.filter((m) => m.src === "bales").map((m) => nz(m.who)).filter(Boolean));
  const calls = zrows.filter((r) => isMember(r.owner_email, r.owner_name) || authors.has(nz(r.owner_name))).map((r) => ({ id: r.id, t: new Date(r.at).getTime(), dur: Number(r.duration) || 0, peer: r.peer || "",
    owner: String(r.owner_email || nz(r.owner_name)).toLowerCase(), ownerName: r.owner_name || "", ok: okResult(Number(r.duration) || 0, r.result) }));
  if (zerr) sources["Zoom Phone"] = { status: "ng", note: "Zoom Phone の通話の写し（mc_zoom_calls）を読めませんでした：" + zerr };
  else {
    const late = sync.oldest && sync.oldest > from;
    sources["Zoom Phone"] = { status: calls.length && !late ? "ok" : "ng", note: `MOCHICA の発信 ${calls.length}件（写し：${sync.oldest || "なし"}〜、最終 ${sync.at || "-"}）` +
      (late ? `。${from} からの分がまだ写し終わっていません（10分ごとに過去へさかのぼって写しています）` : "") };
  }
  const matched = matchCalls(calls, memos).map((c) => ({ ...c, day: jstDay(c.t), person: zoomName.get(nz(c.ownerName)) || nz(c.ownerName) || c.owner }));
  const sum = summarize(matched);
  return { from, to, builtAt: new Date().toISOString(), buildMs: Date.now() - t0, sources, memoCount: memos.length, ...sum,
    notes: [
      "担当者接続＝結び付いたメモで担当者と話せたと分かった通話（MOCHICALL は「担当者と話せた」、Bales は断り・前向き・採用の中身が書かれたメモ）。",
      "ヒアリング＝採用の中身（卒年・人数・時期・課題・媒体・ATS・予算・決裁・競合・採用状況）を1つでも書けた。深い＝3つ以上。日程打診＝打診・候補日・ご都合・アポ獲得などの言葉、または MOCHICALL のアポ獲得。",
      "メモと Zoom は同じ番号への「発信の2分前〜通話終了の30分後」の記録を結び付けています。メモの無い発信は担当者接続に数えません（メモ一致率が低い人は少なく出ます）。",
      "判定は言葉の一覧によるもので、人の確認はしていません。",
    ] };
}
