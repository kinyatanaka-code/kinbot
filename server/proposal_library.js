// 提案資料のライブラリ（2026-11-22 田中さん「作った資料を徐々に蓄積して、ベースを作るようにしてほしい」）。
//   kinbot にたまっている提案資料を、AI を使わずにまとめて返す（読み取りだけ）。
//   ・proposal_files：商談に登録した Google スライド（本文・業界・規模・結果つき）
//   ・doc_files：お客様に送った PDF の提案資料（ページごとの本文と、お客様が各ページを見た秒数）
//   knowkin が Gemini 用の「提案資料ライブラリ」にし、よく使われるページの流れ＝ベースを作る。
import { dbPool } from "./db.js";

let _col = false;
async function ensureColumn(pool) {
  if (_col) return;
  // PDF のページごとの本文は、取り出すのに時間がかかるので1回だけ取り出して持っておく
  await pool.query(`ALTER TABLE doc_files ADD COLUMN IF NOT EXISTS page_texts JSONB`).catch(() => {});
  _col = true;
}

// PDF → ページごとの本文（pdf-parse の pagerender でページ順に集める）
async function pdfPages(buffer) {
  const mod = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = mod.default || mod;
  const pages = [];
  await pdfParse(buffer, {
    pagerender: (pageData) => pageData.getTextContent({ normalizeWhitespace: true }).then((tc) => {
      // 日本語は1文字ずつに分かれて届くので、日本語どうしの間には空白を入れない
      const cjk = /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/;
      let t = "";
      for (const it of tc.items) { const x = String(it.str || "").trim(); if (!x) continue; t += t && !(cjk.test(t.slice(-1)) && cjk.test(x[0])) ? " " + x : x; }
      t = t.replace(/\s+/g, " ").trim();
      pages.push(t.slice(0, 1500));
      return t;
    }),
  });
  return pages;
}

const clip = (s, n) => { s = String(s || "").replace(/\u0000/g, "").trim(); return s.length > n ? s.slice(0, n) + "…" : s; };

export async function getProposalLibrary({ q = "", limit = 30 } = {}) {
  const pool = dbPool();
  if (!pool) throw new Error("データベースにつながっていません");
  await ensureColumn(pool);
  const n = Math.max(1, Math.min(60, Number(limit) || 30));
  const like = q ? `%${q}%` : null;

  // 1. 商談に登録した Google スライド
  const slides = (await pool.query(
    `SELECT id, company_name, industry, employee_size, region, result, filename, slide_url, uploaded_by,
            to_char(uploaded_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') AS day, summary, extracted_text
     FROM proposal_files WHERE ($1::text IS NULL OR company_name ILIKE $1 OR filename ILIKE $1 OR extracted_text ILIKE $1 OR industry ILIKE $1)
     ORDER BY uploaded_at DESC LIMIT $2`, [like, n]).catch(() => ({ rows: [] }))).rows
    .map((r) => ({ ...r, extracted_text: clip(r.extracted_text, 8000) }));

  // 2. お客様に送った PDF の提案資料（名前に「提案」が入るもの）。ページごとの本文と、見られた秒数
  const docs = (await pool.query(
    `SELECT f.id, f.name, f.uploaded_by, f.is_template, f.page_texts, to_char(f.created_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') AS day,
            (SELECT string_agg(DISTINCT l.company, '・') FROM doc_links l WHERE l.doc_id = f.id AND COALESCE(l.company, '') <> '') AS companies,
            (SELECT count(*)::int FROM doc_links l WHERE l.doc_id = f.id) AS links,
            (SELECT count(*)::int FROM doc_views v JOIN doc_links l ON l.id = v.link_id WHERE l.doc_id = f.id AND v.seconds > 0) AS views
     FROM doc_files f
     WHERE f.active AND f.mime ILIKE '%pdf%' AND f.name LIKE '%提案%' AND ($1::text IS NULL OR f.name ILIKE $1)
     ORDER BY f.created_at DESC LIMIT $2`, [like, n])).rows;
  // ページの本文がまだ無いものは取り出して持っておく（重いので1回に5件まで。残りは次に呼ばれたとき）
  let extracted = 0;
  for (const d of docs) {
    if (d.page_texts || extracted >= 5) continue;
    try {
      const { rows } = await pool.query(`SELECT bytes FROM doc_files WHERE id = $1`, [d.id]);
      const pages = rows[0] && rows[0].bytes ? await pdfPages(rows[0].bytes) : [];
      await pool.query(`UPDATE doc_files SET page_texts = $2 WHERE id = $1`, [d.id, JSON.stringify(pages)]);
      d.page_texts = pages; extracted++;
    } catch (e) { d.page_texts = null; d.extract_error = e.message; }
  }
  // ページごとに見られた秒数（すべての閲覧の合計）
  const ids = docs.map((d) => d.id);
  const secs = new Map();
  if (ids.length) {
    const { rows } = await pool.query(
      `SELECT l.doc_id, p.key AS page, sum((p.value)::text::numeric)::int AS sec
       FROM doc_views v JOIN doc_links l ON l.id = v.link_id, jsonb_each(v.pages) p
       WHERE l.doc_id = ANY($1::int[]) AND jsonb_typeof(v.pages) = 'object'
       GROUP BY l.doc_id, p.key`, [ids]).catch(() => ({ rows: [] }));
    for (const r of rows) { if (!secs.has(r.doc_id)) secs.set(r.doc_id, {}); secs.get(r.doc_id)[r.page] = r.sec; }
  }
  const sent = docs.map((d) => {
    const pages = Array.isArray(d.page_texts) ? d.page_texts : [];
    const s = secs.get(d.id) || {};
    return { id: d.id, name: d.name, day: d.day, uploaded_by: d.uploaded_by, template: d.is_template, companies: d.companies || "", links: d.links, views: d.views,
      pages: pages.map((t, i) => ({ page: i + 1, text: clip(t, 600), seconds: Number(s[String(i + 1)] || 0) })),
      ...(d.extract_error ? { extract_error: d.extract_error } : {}), ...(pages.length ? {} : { note: "ページの本文はまだ取り出していません（次に呼ぶと続きを取り出します）" }) };
  });
  return { slides, sent };
}
