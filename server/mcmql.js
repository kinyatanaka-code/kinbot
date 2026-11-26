// MOCHICALL：「かける」に出すリードの条件（MQL）と、並びの点（2026-11-23 オーナー決定・定義案 mochicall-mql.md）
//
// なぜ作ったか：
//   いままで「かける」に出る条件は、トーク・企業調査・アプローチ禁止など「架電の準備」だけで、
//   「かけてはいけない・かけても無駄」なリード（オプトアウト・番号が使えない・商談中の会社・実績ゼロのリード元など）を外す条件が無かった。
//   インターンの手数と迷いを減らすため、SF の過去180日の数字で根拠のあるものだけを必須の条件にし、
//   「アポが取れやすい」ほうは外さずに並びの点に回す（量を割らないため）。
//
// 決めごと（2026-11-23 オーナー）：
//   ・必須は M1〜M7・M9。M8（FS が追っている失注を外す）は入れない＝FS が追っている失注も「かける」に出す。
//   ・SF の状態が「アーカイブ」でも、アプローチ禁止に当たらなければ出す（アーカイブを理由に外さない）。
//   ・外れたリードは消さない。印（mql）を持たせて「かける」に出さないだけ。管理者の絞り込みで理由が分かる。
//
// DB も通信も使わない純粋な関数だけにして、node で直接試せるようにしている（mccadence.js と同じ作り）。

// 計算のしかたを変えたら上げる（上がると、次に読んだときに全部やり直す）
export const MQL_V = 1;

const nk = (s) => String(s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
const DAY = 86400e3;
const JST = 9 * 3600e3;
const jstYmd = (t) => new Date(new Date(t).getTime() + JST).toISOString().slice(0, 10);

// ---- 判定に使う SF のリードの項目（夜にまとめて読み直す。SF から足すときにも読む） ----
//   アプローチ禁止・コンバート・オプトアウト・退職・電話の除外・前回の結果・人の最終活動日・失注・MA・採用人数・取引先への結びつき
export const MQL_SF_FIELDS = ["Id", "IsConverted", "Status", "LeadSource", "Phone", "MobilePhone", "Ban_Type__c",
  "Mochica_optout_check__c", "Retire_check__c", "ExclusionFlag_Phone__c", "last_action_status__c", "Last_ActiveDate__c",
  "Lostopp_reason1__c", "LostOpp_lostdate__c", "Number_of_hires__c", "Pardot_score_contact__c", "pi__last_activity__c", "relationacctID__c"];
// SF のリード1件 → 手元に持つ形（値のある項目だけ。読んだ日時も付ける）
export function sfxOf(rec, at = new Date()) {
  const o = { _at: new Date(at).toISOString() };
  for (const k of MQL_SF_FIELDS) { const v = rec && rec[k]; if (v != null && v !== "") o[k] = typeof v === "string" ? v.slice(0, 200) : v; }
  return o;
}

// ---- M6：実績ゼロ帯のリード元（SF の過去180日：100件以上あって、コンバート率 0.35% 未満の16の元。約1.3万件で17件だけ） ----
//   リード元が空（SF で「なし」）も 2,112件で0件なので同じ扱い（下の effectiveSource で空を「（なし）」にする）
export const ZERO_SOURCES = ["HR-EXPO", "BPOアウトバウンド", "新卒研修", "HR-EXPO東京20250625", "HR EXPO 東京_20230510", "RIハウスリード", "HRオンライン展示会",
  "Hrog", "DXPO", "新卒WATCH", "HRオンライン展示会202012", "Bスポンサーズ", "不明", "九州EXPO", "BOXIL", "（なし）"];
// 並びの点を足すリード元（アウトバウンド 1.16%・失注リサイクル 4.17%・自然検索 9〜20%・過去ユーザー 2.46%。平均 1.04%）
export const GOOD_SOURCES = ["アウトバウンド", "失注リサイクル", "Google Natural Search", "Bing Natural Search", "過去ユーザー"];
// M7：かけても戻らない失注理由（合わせて 491件中1件。同じ失注リサイクルの平均なら約25件は出るはず）
export const LOST_DEAD = ["機能面", "価格", "親会社の意向", "LINENG", "運用イメージ"];
// 並びの点を足す失注理由（タイミング・検討時期 26.8%／予算・リソース制約 17.5%／情報収集・温度感低 11.0%）
export const LOST_GOOD = ["タイミング・検討時期", "予算・リソース制約", "情報収集・温度感低"];
const setOf = (a) => new Set(a.map((x) => nk(x).toLowerCase()));
const ZERO = setOf(ZERO_SOURCES), GOOD = setOf(GOOD_SOURCES), DEAD = setOf(LOST_DEAD), LGOOD = setOf(LOST_GOOD);
const has = (S, v) => S.has(nk(v).toLowerCase());

// 外れた理由（管理者の絞り込み「MQL 外の理由」に出す名前）。上から重い順
export const MQL_WHY = {
  ban: "アプローチ禁止（SF）",
  converted: "SF でコンバート済み",
  optout: "オプトアウト",
  retire: "担当者が退職",
  phone_sf: "SF で使えない番号の印（電話の除外・現アナ）",
  phone_free: "フリーダイヤル（0120・0800）しか無い",
  phone_none: "発信できる番号が無い",
  account: "商談中・利用中の会社（SF の取引先）",
  source: "実績ゼロ帯のリード元（展示会など）",
  lost: "失注理由が機能面・価格など",
  touched: "ほかの人が14日以内に SF で接触",
};
export const MQL_OK_LABEL = "MQL（かけるに出る）";
export const MQL_NONE_LABEL = "まだ判定していない";

// 「なし」「解除」はアプローチ禁止ではない（server/index.js の同期と同じ考え）
const NOT_BAN = /^(なし|無し|解除|-|ー|－|なし（解除）)$/;
// SF のリード元のうち、MOCHICALL が付けた「ソースなし」の置き換え（segOf の既定値）。分からないのと同じ
//   比べるときは NFKC でそろえる（全角のかっこが半角になるため）
const SEG_PLACEHOLDER = new Set(["Bales（ソースなし）", "CSV 取り込み", "DOC（ソースなし）", "不明"].map(nk));
const SF_PLACEHOLDER = nk("SF（ソースなし）");

// どのリード元で判定するか：SF のリード（いちばん確か）→ リードに書いてあった元（CSV の列・BALES・DOC）→ リストに付けた元 → 分からない
//   SF のリードと結びついていて元が空なら「（なし）」（ゼロ帯）。SF に無いリードで分からないものは外さない（known=false）
export function effectiveSource({ sfx, seg, src, listSource } = {}) {
  const S = sfx && !sfx._missing ? sfx : null;
  if (S) return { v: nk(S.LeadSource) || "（なし）", known: true, by: "SF" };
  const s = nk(seg && seg.source);
  if (src === "sf") return { v: s && s !== SF_PLACEHOLDER ? s : "（なし）", known: true, by: "SF" };
  if (s && !SEG_PLACEHOLDER.has(s)) return { v: s, known: true, by: "リード" };
  const l = nk(listSource);
  if (l) return { v: l, known: true, by: "リスト" };
  return { v: "", known: false, by: "" };
}

// ---- 電話番号（M4） ----
const digitsOf = (v) => { let d = String(v || "").normalize("NFKC").replace(/[^0-9]/g, ""); if (/^81\d{9,10}$/.test(d)) d = "0" + d.slice(2); return d; };
const tail10 = (v) => { const d = digitsOf(v); return d.length >= 9 ? d.slice(-10) : ""; };
// 1社にある番号の候補（画面で発信できる番号と同じ：代表・元のデータの電話・受付で聞いた直通・追加の番号・担当者の番号）
export function phoneCands({ phone, data, gate, info } = {}) {
  const out = [];
  const add = (v) => { if (v != null && typeof v !== "object" && String(v).trim()) out.push(String(v)); };
  add(phone);
  for (const [k, v] of Object.entries(data || {})) if (/tel|phone/i.test(k)) add(v);
  if (gate && gate.direct) add(gate.direct);
  const I = info || {};
  for (const p of I.phones || []) add(p && p.number);
  for (const c of I.contacts || []) add(c && c.phone);
  return out;
}
// MOCHICALL で相手に届いた結果（番号が生きている証拠）。SF の「現アナ」より新しいので、そちらを信じる
const REACHED = new Set(["absent", "blocked", "callback_req", "inquiry", "apo", "doc_send", "follow", "reject"]);
export function phoneJudge(cands, sfx, lastOutcome) {
  const S = sfx && !sfx._missing ? sfx : null;
  const bad = new Set();
  if (S) {
    // 電話の除外フラグは「この番号にかけない」の印なのでいつも守る。現アナは MOCHICALL で届いていれば古い情報として無視
    const dead = /現アナ|現在使われていない/.test(String(S.last_action_status__c || "")) && !REACHED.has(lastOutcome);
    if (S.ExclusionFlag_Phone__c === true || dead) { const t = tail10(S.Phone || cands[0]); if (t) bad.add(t); }
  }
  let free = false, marked = false; const ok = [];
  for (const c of cands) {
    const d = digitsOf(c);
    if (!/^0\d{9,10}$/.test(d)) continue;
    if (/^0(120|800)/.test(d)) { free = true; continue; }
    if (bad.has(d.slice(-10))) { marked = true; continue; }
    ok.push(d);
  }
  if (ok.length) return { ok: true, n: ok.length };
  return { ok: false, why: marked ? "phone_sf" : free ? "phone_free" : "phone_none" };
}

// 採用人数の下限（「6～10名」→6、「301名～」→301、「不明」→null）
export function hiresLow(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = nk(v).match(/(\d+)/); return m ? parseInt(m[1], 10) : null;
}

// ---- MQL の判定（1件） ----
// x：{ src, seg, sfx, listSource, phone, data, gate, info, lastAt, lastOutcome, busyAcct }
//   sfx：SF のリードを読んだもの（sfxOf）。SF に無い／まだ読んでいないリードは null。SF で見つからなかったら { _missing: true }
//   busyAcct：商談中・利用中の取引先に当たったか（SF の取引先の状態から、呼ぶ側が決める）
// 戻り値：{ v, ok, why:[理由], until, src, p:{並びの点の材料}, at }
//   until：時間がたてば外れる理由（M9）だけのとき、その日時。その日時を過ぎれば「かける」に出る（夜の読み直しを待たない）
export function mqlOf(x = {}, now = new Date()) {
  const S = x.sfx && !x.sfx._missing ? x.sfx : null;
  const why = [];
  // M1：アプローチ禁止（名簿でも毎回はじいているが、理由が分かるように印にも残す）
  if (S && nk(S.Ban_Type__c) && !NOT_BAN.test(nk(S.Ban_Type__c))) why.push("ban");
  // M2：コンバート済み（重複で止めたものは呼ぶ側の dup_of で外れている）
  if (S && S.IsConverted === true) why.push("converted");
  // M3：オプトアウト・担当者の退職（SF に無いリードは「印なし」と同じ）
  if (S && S.Mochica_optout_check__c === true) why.push("optout");
  if (S && S.Retire_check__c === true) why.push("retire");
  // M4：発信できる番号がある（ほかの番号が生きていれば、その番号で出す）
  const ph = phoneJudge(phoneCands(x), S, x.lastOutcome);
  if (!ph.ok) why.push(ph.why);
  // M5：商談中・利用中の会社ではない
  if (x.busyAcct) why.push("account");
  // M6：実績ゼロ帯のリード元ではない（分からないものは外さない）
  const es = effectiveSource(x);
  if (es.known && has(ZERO, es.v)) why.push("source");
  // M7：かけても戻らない失注理由ではない（理由が空は出す）
  const lostReason = nk((S && S.Lostopp_reason1__c) || (x.seg && x.seg.lost && x.seg.lost.reason !== "理由なし" ? x.seg.lost.reason : ""));
  if (lostReason && has(DEAD, lostReason)) why.push("lost");
  // M9：ほかの人が14日以内に人の手で触っていない（MA を含まない最終活動日。MOCHICALL で同じ日以降にかけていれば自分たちの分）
  let until = null;
  const act = /^\d{4}-\d{2}-\d{2}/.test(String((S && S.Last_ActiveDate__c) || "")) ? String(S.Last_ActiveDate__c).slice(0, 10) : "";
  if (act) {
    const end = Date.parse(`${act}T00:00:00+09:00`) + 14 * DAY;
    const mine = x.lastAt ? jstYmd(x.lastAt) : "";
    if (end > now.getTime() && (!mine || mine < act)) { why.push("touched"); until = new Date(end).toISOString(); }
  }
  const ok = why.length === 0;
  if (ok || why.some((w) => w !== "touched")) until = null;
  // 並びの点の材料（時間で変わる点は rank のときに now で計算する）
  const lostDate = nk((S && S.LostOpp_lostdate__c) || (x.seg && x.seg.lost && x.seg.lost.date) || "").slice(0, 10);
  const p = {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(lostDate)) p.lost = lostDate;
  if (lostReason && has(LGOOD, lostReason)) p.lostGood = true;
  if (S && nk(S.last_action_status__c)) p.sfStatus = nk(S.last_action_status__c).slice(0, 40);
  if (S && S.Pardot_score_contact__c != null && Number.isFinite(+S.Pardot_score_contact__c)) p.ma = +S.Pardot_score_contact__c;
  if (S && /^\d{4}-\d{2}-\d{2}/.test(String(S.pi__last_activity__c || ""))) p.maAt = String(S.pi__last_activity__c).slice(0, 10);
  const h = S ? hiresLow(S.Number_of_hires__c) : null; if (h != null) p.hires = h;
  if (es.known && has(GOOD, es.v)) p.srcGood = true;
  return { v: MQL_V, ok, why, until, src: es.v || null, p, at: now.toISOString() };
}

// ---- まだ MOCHICALL に入っていない BALES の行の判定（手持ち300件・今日の100件を選ぶとき）（2026-11-27） ----
//   MOCHICALL に入った会社は夜に SF の項目（オプトアウト・退職など）まで読んで印を付けるが、入る前の行にはそれが無い。
//   そこで BALES の行に付いている SF の値（アプローチ禁止の種類・コンバート・失注理由）と、電話・リード元・商談中の会社だけで見る。
//   分からないもの（SF の項目が無い）は外さない＝あとで MOCHICALL に入ってから、いつもの判定で外れる。
//   d：BALES の行の data（電話・リード元・会社名の列だけでよい）。lead：行の sf.lead（日本語の見出しで持っている）
export function mqlOfBales({ d, lead, busyAcct } = {}, now = new Date()) {
  const D = d || {}, L = lead || {};
  const reason = nk(L["失注商談失注理由大"]);
  const m = mqlOf({ src: "bales", seg: { source: nk(D["leadSources.0.name"]) || "Bales（ソースなし）", lost: reason ? { reason } : null }, data: D, busyAcct }, now);
  const pre = [];
  const ban = nk(L["アプローチ禁止の種類"]); if (ban && !NOT_BAN.test(ban)) pre.push("ban");
  if (L.converted === true) pre.push("converted");
  return pre.length ? { ...m, ok: false, why: [...pre, ...m.why], until: null } : m;
}

// ---- 優先条件（並びの点）。tier 2（約束・時刻が来た掛け直し以外）の中だけに効く ----
// m：mqlOf の結果。l：かける候補の行（last_outcome・hearing）
//   点（案どおり）：失注から6か月以内 +40／12か月以内 +30、失注理由が時期・予算・温度感 +20、前回の結果が営業フォロー +20、
//   MA スコア50以上か MA の最終の反応が今年 +15、採用人数6名以上 +10／1〜2名 −10、リード元がアウトバウンドなど +10、前回の結果が受付ブロック −10
export function mqlPoints(m, l = {}, now = new Date()) {
  const p = (m && m.p) || {}; let score = 0; const reasons = [];
  if (p.lost) {
    const days = (now.getTime() - Date.parse(`${p.lost}T00:00:00+09:00`)) / DAY;
    if (days >= 0 && days <= 183) { score += 40; reasons.push("失注から半年以内"); }
    else if (days >= 0 && days <= 366) { score += 30; reasons.push("失注から1年以内"); }
  }
  if (p.lostGood) { score += 20; reasons.push("失注理由が時期・予算・温度感"); }
  // 前回の結果：MOCHICALL でかけていればそれが新しい。まだなら SF の「前回の結果」
  const mine = l.last_outcome || "";
  const follow = mine ? mine === "follow" : /営業フォロー/.test(p.sfStatus || "");
  const block = mine ? mine === "blocked" : /受付ブロック/.test(p.sfStatus || "");
  if (follow) { score += 20; reasons.push("前回の結果が営業フォロー"); }
  if (block) score -= 10;
  const year = String(new Date(now.getTime() + JST).getUTCFullYear());
  if ((p.ma || 0) >= 50 || (p.maAt && p.maAt.slice(0, 4) === year)) { score += 15; reasons.push("MA で反応あり"); }
  // 採用人数：架電で聞いた採用目標人数（新しい）→ SF の採用人数
  const heard = l.hearing && l.hearing.target != null && Number.isFinite(+l.hearing.target) ? +l.hearing.target : null;
  const hires = heard != null ? heard : p.hires;
  if (hires != null && hires >= 6) { score += 10; reasons.push("採用人数6名以上"); } else if (hires != null && hires >= 1 && hires <= 2) score -= 10;
  if (p.srcGood) { score += 10; reasons.push("アポにつながりやすいリード元"); }
  return { score, reasons };
}

// ---- SF に無いリードの SF 立ち上げ（試しの計画） ----
// 計画の判定（画面・CSV に出す名前）
export const LAUNCH_ACTION = {
  link: "結びつける（SF の Mochica リードに当たった）",
  acct: "取引先だけに当たった（作らない・要判断）",
  review: "要確認（電話だけ一致・会社名が違う）",
  create: "SF にリードを作る",
  skip_ban: "作らない（アプローチ禁止）",
  skip_nocompany: "作れない（会社名が無い）",
  need_source: "作らない（リード元が決まっていない）",
  bad_source: "作らない（リード元が SF の選択肢に無い）",
  // 架電画面の「SF にリードを作る」（2026-11-24）と同じ決まりにそろえた（2026-11-27）：業種は SF で必須・コンバート済みとアプローチ禁止のリードには結びつけない
  need_industry: "作らない（業種が決まらない。SF で必須）",
  skip_conv: "結びつけない（SF の同じ会社のリードはコンバート済み・要判断）",
};
// SF の側の索引：鍵（禁止名簿と同じ「tel:末尾10けた」「co:／cl:会社名」）→ その鍵を持つ SF のレコード
//   recs：[{ type:"lead"|"acct", id, company, phones:[], conv, convAcct, mod }]。keyFn(phone, company) は禁止名簿の鍵を返す関数
export function buildIndex(recs, keyFn) {
  const by = new Map(); const convByAcct = new Map();
  for (const r of recs) {
    const ks = new Set();
    for (const ph of r.phones && r.phones.length ? r.phones : [""]) for (const k of keyFn(ph, r.company)) ks.add(k);
    for (const k of ks) { if (!by.has(k)) by.set(k, []); by.get(k).push(r); }
    if (r.type === "lead" && r.conv && r.convAcct) {
      const a = String(r.convAcct).slice(0, 15); const o = convByAcct.get(a);
      if (!o || String(r.mod || "") > String(o.mod || "")) convByAcct.set(a, r);
    }
  }
  return { by, convByAcct, n: recs.length };
}
// 同じ会社のリードが SF にいくつかあるときに、どれに結びつけるか：コンバートしていない → 新しく直されたもの
const better = (a, b) => (!!a.conv - !!b.conv) || String(b.mod || "").localeCompare(String(a.mod || ""));
// 1件の判定。t：{ company, phones:[], banned }。返すのは { action, why, hit }
export function matchLead(t, index, keyFn) {
  if (t.banned) return { action: "skip_ban", why: "アプローチ禁止の名簿に当たる" };
  if (nk(t.company).length < 2) return { action: "skip_nocompany", why: "会社名が無い（SF のリードは会社名が要る）" };
  const tel = new Set(), co = new Set();
  for (const ph of t.phones && t.phones.length ? t.phones : [""]) for (const k of keyFn(ph, t.company)) (k.startsWith("tel:") ? tel : k.startsWith("co:") || k.startsWith("cl:") ? co : null)?.add(k);
  const hits = new Map();   // SF の Id → { r, tel, co }
  const look = (keys, kind) => { for (const k of keys) for (const r of index.by.get(k) || []) { const h = hits.get(r.id) || { r, tel: false, co: false }; h[kind] = true; hits.set(r.id, h); } };
  look(tel, "tel"); look(co, "co");
  const leads = [...hits.values()].filter((h) => h.r.type === "lead"), accts = [...hits.values()].filter((h) => h.r.type === "acct");
  const pick = (hs) => hs.map((h) => h.r).sort(better)[0];
  const both = leads.filter((h) => h.tel && h.co);
  if (both.length) return { action: "link", why: "電話と会社名が同じ SF のリード", hit: pick(both) };
  const byCo = leads.filter((h) => h.co);
  if (byCo.length) return { action: "link", why: byCo.length > 1 ? `会社名が同じ SF のリード（${byCo.length}件のうち、コンバート前で新しいもの）` : "会社名が同じ SF のリード（電話は違う・SF に無い）", hit: pick(byCo) };
  // 取引先に当たったら、その取引先にコンバートしたリードがあればそれに結びつける（活動は今までどおりコンバート先に付け替えて書ける）
  const acCo = accts.filter((h) => h.co);
  for (const h of acCo) { const c = index.convByAcct.get(String(h.r.id).slice(0, 15)); if (c) return { action: "link", why: "取引先にコンバートしたリード", hit: c }; }
  if (acCo.length) return { action: "acct", why: "会社名が同じ取引先がある（リードは無い）", hit: pick(acCo) };
  const tl = leads.filter((h) => h.tel), ta = accts.filter((h) => h.tel);
  if (tl.length || ta.length) return { action: "review", why: `電話番号だけが同じ（SF では「${(pick(tl.length ? tl : ta) || {}).company || ""}」）`, hit: pick(tl.length ? tl : ta) };
  return { action: "create", why: "SF に同じ会社が見つからない" };
}

// ---- SF に作るリードの中身（まとめての立ち上げと、架電画面の「SF にリードを作る」で同じものを使う。作り方を2通りにしない）（2026-11-27） ----
//   姓は架電画面の作り方に合わせて、担当者名をそのまま姓に入れる（分けない）。名前が無い・「不明」などは「ご担当者」
const JUNK_PERSON = /^(不明|なし|無し|-+|ー+|(採用|人事|総務)?(ご)?担当(者)?|代表(者)?)$/;
export function personName(v) {
  const s = nk(v).replace(/(様|さま|さん|殿)$/u, "").trim();
  if (!s || JUNK_PERSON.test(s) || s.length > 80) return { LastName: "ご担当者" };
  return { LastName: s.slice(0, 80) };
}
// t：{ company, phone, person, title, email, web, industry, pref, address, source, list, src }。list・src はまとめての立ち上げのときだけ（説明に残す）
export function leadFields(t, recordTypeId) {
  const f = { RecordTypeId: recordTypeId, Company: String(t.company ?? "").trim().slice(0, 255), ...personName(t.person) };
  if (t.industry) f.Industry = String(t.industry).slice(0, 80);
  const ph = String(t.phone || "").trim(); if (ph) f.Phone = ph.slice(0, 40);
  if (t.title) f.Title = nk(t.title).slice(0, 128);
  if (t.email) f.Email = String(t.email).trim().slice(0, 80);
  if (t.web) f.Website = String(t.web).trim().slice(0, 255);
  if (t.source) f.LeadSource = t.source;
  // 住所は「住所（番地）」の欄にまとめて入れる。都道府県の欄（State）は、SF で国・都道府県の選択リストを使っていると国が無いと断られるので入れない
  const addr = nk(t.address); if (addr) f.Street = (t.pref && !addr.startsWith(t.pref) ? t.pref + addr : addr).slice(0, 255);
  if (t.list || t.src) f.Description = `MOCHICALL から立ち上げ（リスト「${nk(t.list).slice(0, 60)}」・取り込み元 ${({ csv: "CSV", doc: "DOC", bales: "BALES", sf: "SF" })[t.src] || t.src || ""}）`;
  return f;
}

// ---- CSV（試しの見本）----
const cell = (v) => { const s = String(v ?? ""); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const PLAN_COLS = [["id", "MOCHICALL のリード"], ["list", "リスト"], ["src", "取り込み元"], ["done", "終わったリード"], ["company", "会社名"], ["phone", "電話"],
  ["action", "判定"], ["why", "理由"], ["hitId", "結びつける SF の ID"], ["hitType", "SF の種類"], ["hitCompany", "SF の会社名"],
  ["f.Company", "作る：会社名"], ["f.LastName", "作る：姓"], ["f.Industry", "作る：業種"], ["f.Phone", "作る：電話"], ["f.Email", "作る：メール"], ["f.Website", "作る：Web"],
  ["f.LeadSource", "作る：リード元"], ["f.Street", "作る：住所"], ["f.Title", "作る：役職"], ["f.Description", "作る：説明"]];
export function planCsv(rows) {
  const get = (r, k) => (k.startsWith("f.") ? (r.fields || {})[k.slice(2)] : k === "action" ? LAUNCH_ACTION[r.action] || r.action : k === "done" ? (r.done ? "はい" : "") : r[k]);
  return "﻿" + [PLAN_COLS.map((c) => c[1]), ...rows.map((r) => PLAN_COLS.map(([k]) => get(r, k)))].map((a) => a.map(cell).join(",")).join("\r\n");
}
