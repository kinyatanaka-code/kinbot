// ───────────────────────────────────────────────────────────
// processsheet.js — SFの架電結果を、プロセスシートの「実績」に入れる
//
// シートの形（8月アポ管理）
//   ・5行目に日付（8/3, 8/4 …）が3列おきに並ぶ
//   ・7行目に「稼働時間目標 / 目標 / 実績」の見出し
//   ・B列に担当者名（植野・田中…）、その下に コール／接触／アポ（期内）…
//
// 大事にしていること
//   ・行や列の位置を決め打ちにしない。毎回シートを読んで場所を突き止める。
//     週が増えても、担当者が入れ替わっても壊れないようにするため。
//   ・書き込むのは「実績」の列だけ。目標や数式には触れない。
// ───────────────────────────────────────────────────────────

// 集計する項目。シートのB列の文言と対応させる。
export const METRICS = ["コール", "接触", "アポ（期内）", "アポ（期外）"];

// 担当者名ではない、項目の行に出てくる言葉。
// これを担当者と取り違えると、行の対応が崩れる。
const NOT_PERSON = [
  ...METRICS, "稼働時間", "資料送付", "ナーチャリング", "セールスその他",
  "目標", "実績", "差分", "チーム全体", "累計", "単週",
];

// 列番号 → A1形式（0始まり）
export function colName(n) {
  let s = "";
  n += 1;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

// 「8/4」「08/04」「2026-08-04」などを、月日の組にそろえる
export function parseMD(v) {
  const t = String(v || "").trim();
  let m = t.match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/);
  if (m) return { m: +m[1], d: +m[2] };
  m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return { m: +m[2], d: +m[3] };
  // 「8月3日」の書き方
  m = t.match(/^(\d{1,2})月\s*(\d{1,2})日/);
  if (m) return { m: +m[1], d: +m[2] };
  // スプレッドシートの日付連番（1899-12-30 が 0 日目）
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const n = Math.floor(+t);
    if (n > 30000 && n < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return { m: d.getUTCMonth() + 1, d: d.getUTCDate() };
    }
  }
  return null;
}

// 名前をそろえて比べる（「植野 ひかり」と「植野」を同じ人とみなす）
export function sameName(sheetName, sfName) {
  const norm = (v) => String(v || "").replace(/[\s　]/g, "");
  const a = norm(sheetName), b = norm(sfName);
  if (!a || !b) return false;
  return b.startsWith(a) || a.startsWith(b) || a === b;
}

// シートの中身から、日付の列と担当者ごとの行を突き止める
export function readLayout(values) {
  const at = (r, c) => ((values[r] || [])[c] || "").toString().trim();

  // 1) 日付の行と、「実績」の列を探す
  let dateRow = -1, headRow = -1;
  for (let r = 0; r < Math.min(values.length, 15); r++) {
    const n = (values[r] || []).filter((v) => parseMD(v)).length;
    if (n >= 3) { dateRow = r; break; }
  }
  if (dateRow < 0) return { error: "日付の行が見つかりませんでした" };
  // 「実績」が何度も出てくる行が見出し行。1つだけの行は別の意味なので選ばない。
  for (let r = dateRow; r < Math.min(values.length, dateRow + 6); r++) {
    const n = (values[r] || []).filter((v) => String(v).trim() === "実績").length;
    if (n >= 3) { headRow = r; break; }
  }
  if (headRow < 0) return { error: "「実績」の見出しが見つかりませんでした" };

  // 2) 日付ごとに「実績」の列を対応づける。
  // 見出しは結合セルで空のことがあるので（週初の列など）、
  // 見つからないときは「日付の何列右に実績があるか」の規則で補う。
  const dates = [];
  const row = values[dateRow] || [];
  const heads = values[headRow] || [];
  const found = [];
  for (let c = 0; c < row.length; c++) {
    const md = parseMD(row[c]);
    if (!md) continue;
    let actual = -1;
    for (let k = c; k < Math.min(c + 4, heads.length); k++) {
      if (at(headRow, k) === "実績") { actual = k; break; }
    }
    found.push({ ...md, col: c, actual });
  }
  // 見出しから分かったぶんで、ずれ幅（日付の列 → 実績の列）を決める
  const offsets = found.filter((f) => f.actual >= 0).map((f) => f.actual - f.col);
  const offset = offsets.length
    ? offsets.sort((a, b) => offsets.filter((v) => v === a).length - offsets.filter((v) => v === b).length).pop()
    : 2;
  for (const f of found) {
    const col = f.actual >= 0 ? f.actual : f.col + offset;
    dates.push({ m: f.m, d: f.d, col });
  }
  if (!dates.length) return { error: "日付の列が見つかりませんでした" };

  // 3) 担当者ごとの、項目行の位置
  const people = [];
  let cur = null;
  for (let r = 0; r < values.length; r++) {
    const b = at(r, 1);
    if (!b) continue;
    if (METRICS.includes(b)) {
      if (cur) cur.rows[b] = r;
      continue;
    }
    if (NOT_PERSON.includes(b)) continue;   // 項目の行。担当者ではない。
    // それ以外＝担当者名
    cur = { name: b, row: r, rows: {} };
    people.push(cur);
  }

  return { dateRow, headRow, dates, people: people.filter((p) => Object.keys(p.rows).length) };
}

// 架電結果を、担当者ごと・日ごとに数える。
// 期内・期外は、商談日が指定の期間に入るかどうかで分ける。
export function tally(records, { fromISO, toISO } = {}) {
  const out = {};   // 担当者 → { "8/4": { コール, 接触, アポ（期内）, アポ（期外） } }
  const inTerm = (v) => {
    if (!fromISO || !toISO) return true;
    const d = String(v || "").slice(0, 10);
    return !!d && d >= fromISO && d <= toISO;
  };
  const truthy = (v) => v === true || v === "true" || v === 1 || v === "1";

  for (const r of records || []) {
    const who = String(r.owner || "").trim();
    const md = parseMD(r.date);
    if (!who || !md) continue;
    const key = `${md.m}/${md.d}`;
    out[who] = out[who] || {};
    const t = (out[who][key] = out[who][key] || { "コール": 0, "接触": 0, "アポ（期内）": 0, "アポ（期外）": 0 });

    if (truthy(r.called)) t["コール"] += 1;
    if (truthy(r.contacted)) t["接触"] += 1;
    if (truthy(r.appointed)) {
      // 商談日が期間内なら期内、そうでなければ期外
      t[inTerm(r.meetingDate) ? "アポ（期内）" : "アポ（期外）"] += 1;
    }
  }
  return out;
}

// アポの件数は、kinbotが持っている記録だけを使う。
//
// SFのレポートには商談日が無く、期内・期外を分けられない。
// kinbot側は「Chatに流したアポ（＝営業担当が取ったアポ）」を1件ずつ持っていて、
// アポ獲得者・アポを取った日・商談日が揃っているので、こちらで数える。
// コールと接触だけがSFのレポートから来る。
//
// 名前は「植野 ひかり」「植野ひかり」のような表記ゆれを同じ人として扱う。
// 別々の人として持つと、シートに書くときにどちらか片方しか当たらない。
export function applyApoCounts(tallied, apoRows, { replace = true } = {}) {
  const out = {};
  for (const [who, days] of Object.entries(tallied || {})) {
    out[who] = {};
    for (const [day, t] of Object.entries(days)) out[who][day] = { ...t };
  }

  // SFから拾ったアポの数は捨てる（期内・期外を分けられないため）
  if (replace) {
    for (const who of Object.keys(out)) {
      for (const day of Object.keys(out[who])) {
        out[who][day]["アポ（期内）"] = 0;
        out[who][day]["アポ（期外）"] = 0;
      }
    }
  }

  for (const r of apoRows || []) {
    const name = String(r.setter || "").trim();
    const day = String(r.day || "").trim();
    if (!name || !day) continue;
    // 同じ人がSF側にいれば、そこへ足す（表記が違っても同じ人とみなす）
    const who = Object.keys(out).find((n) => sameName(n, name)) || name;
    out[who] = out[who] || {};
    const t = (out[who][day] = out[who][day] || { "コール": 0, "接触": 0, "アポ（期内）": 0, "アポ（期外）": 0 });
    t["アポ（期内）"] = Number(r.in_term) || 0;
    t["アポ（期外）"] = Number(r.out_term) || 0;
  }
  return out;
}

// 集計とシートの構造を突き合わせて、書き込む場所と値の一覧を作る
export function buildUpdates(layout, tallied, { onlyDates = null, zeroFrom = "", zeroTo = "" } = {}) {
  const updates = [];
  const skipped = [];

  // 実績が0だった日も、0で上書きする。
  // 書かずに飛ばすと、前に入っていた数字がそのまま残ってしまうため。
  // ただし対象の期間内で、今日までの日だけにする（先の日付を0で埋めない）。
  const ZERO = { "コール": 0, "接触": 0, "アポ（期内）": 0, "アポ（期外）": 0 };
  const inZeroRange = (d) => {
    if (!zeroFrom || !zeroTo) return false;
    const y = +String(zeroFrom).slice(0, 4);
    // 年をまたぐ場合に備えて、月で年を推測する
    const year = d.m < +String(zeroFrom).slice(5, 7) ? y + 1 : y;
    const iso = `${year}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
    return iso >= zeroFrom && iso <= zeroTo;
  };

  for (const p of layout.people) {
    // シートの担当者名に当てはまるSF側の名前を探す
    const sfName = Object.keys(tallied).find((n) => sameName(p.name, n));
    if (!sfName) continue;
    for (const d of layout.dates) {
      const key = `${d.m}/${d.d}`;
      if (onlyDates && !onlyDates.includes(key)) continue;
      const t = tallied[sfName][key] || (inZeroRange(d) ? ZERO : null);
      if (!t) continue;
      for (const metric of METRICS) {
        const row = p.rows[metric];
        if (row == null) { skipped.push(`${p.name}の「${metric}」の行がありません`); continue; }
        updates.push({
          range: `${colName(d.col)}${row + 1}`,
          value: t[metric],
          who: p.name, date: key, metric,
        });
      }
    }
  }
  return { updates, skipped };
}
