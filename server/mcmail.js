// MOCHICALL：1社のメールアドレスを集める（2026-11-24 福井さん「浦田空調工業：SF にメールがあるのに表示がなかった」）
//   前は、左の欄・ヒアリング欄・資料送付・ヒアリングのメールが、それぞれ別の探し方をしていて、
//   左の欄は MOCHICALL で手で直したメールしか見ていなかった（SF・BALES・DOC から来たメールが出なかった）。
//   ここ1か所で集めて、どの画面も同じ結果を使う。見る順（先が優先）：
//     1. ヒアリングで聞いたメール（本人から聞いた、いちばん新しい値）
//     2. MOCHICALL で直した会社のメール・足した担当者のメール（人が確かめた値）
//     3. SF のリードの今の Email（正本。開いたときに読む）
//     4. 取り込み元のデータ（BALES・DOC・CSV・SF から足したときの中身）
//   うちの人のメール（所有者・作成者などの項目、社内のドメイン）は相手のメールではないので入れない。
//   kincall からは使わない（MOCHICALL 専用。never-touch-kincall）
const MAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const OWN_FIELD = /operator|owner|user|staff|creat|updat|setter|rep_|sender|担当者?の?所有|所有|作成|更新/i;
const OWN_DOMAIN = /@(?:[a-z0-9-]+\.)*(neo-career|c-career|neocareer)\./i;
const SRC_LABEL = { bales: "BALES", doc: "DOC", csv: "CSV", sf: "SF（足したとき）" };

const clean = (v) => String(v == null ? "" : v).trim().replace(/^mailto:/i, "");
export const isLeadMail = (v) => { const s = clean(v); return MAIL_RE.test(s) && !OWN_DOMAIN.test(s); };

// 取り込み元のデータからメールを拾う：mail・メールの付く項目 → 値の形がメールのもの、の順。うちの人の項目は見ない
export function dataMails(data = {}) {
  const vals = Object.entries(data || {}).filter(([k, v]) => typeof v === "string" && !k.startsWith("_") && !OWN_FIELD.test(k));
  const byKey = vals.filter(([k, v]) => /mail|メール/i.test(k) && isLeadMail(v)).map(([, v]) => clean(v));
  const any = vals.filter(([, v]) => isLeadMail(v)).map(([, v]) => clean(v));
  return [...byKey, ...any];
}

// 返すのは [{ addr, src, label }]（重複なし・先が優先）。src：hear / edit / contact / sf / data
export function leadMails({ lead = {}, data = {}, sf = null, sfEmail = "" } = {}) {
  const out = []; const seen = new Set();
  const add = (v, src, label) => { const a = clean(v); const k = a.toLowerCase(); if (!isLeadMail(a) || seen.has(k)) return; seen.add(k); out.push({ addr: a, src, label }); };
  const h = lead.hearing || {}; const I = lead.info || {};
  add(h.mail, "hear", "ヒアリング");
  add(I.email, "edit", "MOCHICALL");
  for (const c of I.contacts || []) add(c && c.email, "contact", c && c.name ? `MOCHICALL（${c.name}）` : "MOCHICALL");
  add(sfEmail, "sf", "SF");
  const srcLabel = SRC_LABEL[lead.src] || "元のデータ";
  for (const m of dataMails(data)) add(m, "data", srcLabel);
  // BALES の行に付いた SF の写し（取り込んだときの SF の中身）
  if (sf && sf.lead) for (const v of Object.values(sf.lead)) if (typeof v === "string") add(v, "data", "SF（取り込み時）");
  return out;
}
// 結びついている SF のリードの Id（MOCHICALL の列が空でも、BALES の行に SF の結びつきがあればそれを使う）
export function sfLeadIdOf(lead = {}, sf = null) {
  const id = String(lead.sf_lead_id || (sf && sf.lead && sf.lead.id) || "").trim();
  return /^00Q[0-9A-Za-z]{12,15}$/.test(id) ? id : "";
}
