// ───────────────────────────────────────────────────────────
// autolaunch.js — Salesforceの立ち上げを、条件を満たしたものだけ自動で行う
//
// なぜ条件を付けるか
//   コンバートは取り消せない。間違ったリードに紐づけると、Salesforce上で
//   手作業の修復が必要になる。だから「間違えようがない状態」だけを自動で通す。
//
// 自動で通す条件
//   1. 会社名で検索して、クロスのリードが見つかる
//   2. そのリードの担当者名が、商談の担当者名と一致する
//   3. 候補が1件に絞れる（複数あるときは人が選ぶ）
//   4. 必須項目が埋まっている（URLが空なら gBizINFO から補う）
//
// 通せなかったものは理由を残し、ホームの「割り振られたアポ」に出す。
// ───────────────────────────────────────────────────────────

// 判定結果の理由コード。画面に出す文言もここで持つ。
export const REASONS = {
  no_lead:       "会社名で検索してもリードが見つかりません",
  no_cross:      "クロスのリードがありません（直販などのリードのみ）",
  many_cross:    "クロスのリードが複数あり、どれか決められません",
  person_unmatch:"リードの担当者名が商談の担当者名と一致しません",
  no_person:     "商談の予定名から担当者名が読み取れません",
  no_company:    "商談の予定名から会社名が読み取れません",
  missing_url:   "URLが空で、gBizINFOでも見つかりませんでした",
  missing_field: "必須項目が埋まっていません",
  already:       "すでに立ち上げ済みです",
  sf_error:      "Salesforceでエラーが起きました",
  no_sf_user:    "割り振られた担当者が、Salesforceのユーザーとして見つかりません",
  no_operator:   "Salesforceにつながっているアカウントがありません",
  not_created:   "コンバートは通ったのに、商談ができていません（Salesforceの設定をご確認ください）",
  opp_required:  "商談に必須項目があるため作れません。既定値を入れるか、必須を外してください",
  duplicate:     "Salesforceの重複ルールで止められました（同じ会社・担当者が既にあります）",
};

// 「【初回】株式会社ベルク／町田様」から会社名と担当者名を取り出す
export function parseTitle(title) {
  let t = String(title || "").replace(/【[^】]*】/g, "").trim();
  t = t.replace(/[／\/｜|]/g, " ").replace(/[\s　]+/g, " ").trim();
  const m = t.match(/([^\s]{1,20}?)\s*(?:様|さま|さん)/);
  const person = m ? m[1] : "";
  let company = t.replace(/[^\s]*(?:様|さま|さん).*$/, "").trim();
  if (!company && !person) company = t;
  return { company, person };
}

// 表記の細かな違いを無視して比べる
export function normName(s) {
  return String(s || "")
    .replace(/[\s　]/g, "")
    .replace(/[（）()「」『』・,，.。]/g, "")
    .replace(/(株式会社|有限会社|合同会社|合資会社|一般社団法人|一般財団法人|社会福祉法人|医療法人|学校法人|\(株\)|（株）)/g, "")
    .toLowerCase();
}

// リードが「クロス」かどうか。組織によって入っている場所が違うため、
// レコードタイプ・リードソース・営業種別・会社名のどこかに入っていれば拾う。
export function isCrossLead(lead) {
  const hay = [
    lead?.RecordType?.Name, lead?.LeadSource, lead?.Company, lead?.Name,
    lead?.sales_type__c, lead?.Sales_Type__c, lead?.lead_type__c,
  ].filter(Boolean).join(" ");
  return /クロス|cross/i.test(hay);
}

// 担当者名が一致するか。姓だけでも一致とみなす（予定名は姓だけのことが多い）。
export function personMatches(lead, person) {
  const want = normName(person);
  if (!want) return false;
  const cands = [
    lead?.LastName, lead?.Name,
    [lead?.LastName, lead?.FirstName].filter(Boolean).join(""),
  ].filter(Boolean).map(normName);
  return cands.some((c) => c === want || c.includes(want) || want.includes(c));
}

// 会社名が十分に近いか（部分一致でよいが、短すぎる一致は認めない）
export function companyMatches(lead, company) {
  const a = normName(lead?.Company), b = normName(company);
  if (!a || !b) return false;
  if (a === b) return true;
  return b.length >= 3 && (a.includes(b) || b.includes(a));
}

// 立ち上げてよいか判定する。
// leads は searchLeads の結果、meeting は { title } を想定。
export function judge({ title, leads }) {
  const { company, person } = parseTitle(title);
  if (!company) return { ok: false, reason: "no_company" };
  if (!person) return { ok: false, reason: "no_person" };

  const list = Array.isArray(leads) ? leads : [];
  if (!list.length) return { ok: false, reason: "no_lead", company, person };

  const sameCompany = list.filter((l) => companyMatches(l, company));
  if (!sameCompany.length) return { ok: false, reason: "no_lead", company, person };

  const cross = sameCompany.filter(isCrossLead);
  if (!cross.length) return { ok: false, reason: "no_cross", company, person };

  const matched = cross.filter((l) => personMatches(l, person));
  if (!matched.length) {
    return {
      ok: false, reason: "person_unmatch", company, person,
      detail: `リード側の担当者：${cross.map((l) => l.Name || l.LastName || "-").join("、")}`,
    };
  }
  if (matched.length > 1) {
    return {
      ok: false, reason: "many_cross", company, person,
      detail: `候補：${matched.map((l) => l.Name || l.LastName).join("、")}`,
    };
  }
  return { ok: true, lead: matched[0], company, person };
}

// 理由コードを、画面に出す文にする
export function reasonText(code, detail) {
  const t = REASONS[code] || code || "判定できませんでした";
  return detail ? `${t}（${detail}）` : t;
}
