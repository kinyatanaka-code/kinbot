// knowkin（田中さんの第二の脳）に、kinbot・kincall・kinXs の記録を渡す読み取り専用の入口（2026-11-21 田中さん「knowkinにkinbot,kincall,kinXsの情報を全部入れたい」）
//
// knowkin が1時間ごとに「前回の続きから」少しずつ取りに来る。kinbot からは何も書かない・どこにも送らない。
// 大きいもの（文字起こし全文・録画・ファイル本体）は渡さず、要約・結果・メモだけを渡す（knowkin が読んで使える量にするため）。
//
//   GET /api/knowkin/feed?kind=<種類>&after=<続きの印>&limit=<件数>
//     → { items: [{ ref, kind, company, title, body, people, at }], next, done }
//   種類：meetings（商談）/ deal_events（商談の動き）/ calls（架電・会社と日ごと）/ kinxs_accounts（DOCの契約企業）
//         / kinxs_history（契約企業の変更）/ kinxs_voices（お客様の声）/ docai（DOCのAIへの候補者の質問）/ doc_views（資料の閲覧）
//
// 会社の商談・架電のデータがまとめて出ていくので、管理者（ADMIN_EMAILS）のトークン・ログインだけに絞る。
import { dbPool } from "./db.js";

const clip = (v, n) => String(v === null || v === undefined ? "" : v).replace(/\u0000/g, "").trim().slice(0, n);
const list = (a, n = 8) => (Array.isArray(a) ? a : []).map((x) => clip(typeof x === "string" ? x : (x && (x.text || x.objection || x.item)) || "", 200)).filter(Boolean).slice(0, n);
const lines = (label, arr) => (arr.length ? [`${label}：`, ...arr.map((x) => `・${x}`)] : []);
const JST = (col) => `to_char(${col} AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD"T"HH24:MI:SS"+09:00"')`;
// 続きの印は「時刻|ID」。同じ時刻の行を取りこぼさないよう、時刻とIDの組で比べる
const splitCursor = (s) => { const i = String(s || "").indexOf("|"); return i < 0 ? ["1970-01-01T00:00:00Z", ""] : [s.slice(0, i), s.slice(i + 1)]; };

const KINDS = {
  // 商談：要約（全体・合意・宿題・懸念・論点）。文字起こし全文は渡さない
  async meetings(pool, after, limit) {
    const [t, id] = splitCursor(after);
    const { rows } = await pool.query(
      `SELECT m.bot_id, m.title, m.account, m.owner, m.rep_name, m.round_no, m.phase, m.deal_kind, m.status, m.summary, m.note,
              a.official_name, m.updated_at::text AS cur, ${JST("m.created_at")} AS at
       FROM meetings m LEFT JOIN accounts a ON a.key = m.account
       WHERE (m.updated_at, m.bot_id) > ($1::timestamptz, $2) AND (m.summary IS NOT NULL OR m.note IS NOT NULL)
       ORDER BY m.updated_at, m.bot_id LIMIT $3`, [t, id, limit]);
    const items = rows.map((r) => {
      const s = r.summary || {};
      const body = [
        [r.round_no ? `${r.round_no}回目` : "", r.phase || "", r.deal_kind || "", r.status || ""].filter(Boolean).join("・"),
        s.overview ? clip(s.overview, 600) : "",
        ...lines("合意・決まったこと", list(s.agreements)),
        ...lines("宿題・次のアクション", list(s.action_items)),
        ...lines("相手の懸念", list(s.customer_concerns)),
        ...lines("論点", list(s.key_points, 6)),
        r.note ? `メモ：${clip(r.note, 400)}` : "",
      ].filter(Boolean).join("\n");
      return { ref: `kinbot:meeting:${r.bot_id}`, kind: "商談", company: clip(r.official_name || r.account || "", 80), title: clip(r.title || "商談", 160),
        body, people: [r.owner, r.rep_name].filter(Boolean).map((x) => clip(x, 60)), at: r.at };
    });
    const last = rows[rows.length - 1];
    return { items, next: last ? `${last.cur}|${last.bot_id}` : after, done: rows.length < limit };
  },

  // 商談の動き（フェーズ判定・結果・次回）
  async deal_events(pool, after, limit) {
    const { rows } = await pool.query(
      `SELECT e.id, e.deal_id, e.event_type, e.meeting_kind, e.result, e.next_meeting_date::text AS next_date, e.apply_date::text AS apply_date,
              e.usage_start_date::text AS usage_start, e.judgment_basis, d.company_name, d.owner, d.status AS deal_status,
              to_char(COALESCE(e.event_date, e.created_at::date), 'YYYY-MM-DD"T"00:00:00"+09:00"') AS at
       FROM deal_events e LEFT JOIN deals d ON d.deal_id = e.deal_id
       WHERE e.id > $1 ORDER BY e.id LIMIT $2`, [Number(after) || 0, limit]);
    const items = rows.map((r) => ({
      ref: `kinbot:deal_event:${r.id}`, kind: "商談の動き", company: clip(r.company_name, 80),
      title: [r.event_type, r.meeting_kind, r.result].filter(Boolean).map((x) => clip(x, 40)).join("・") || "商談の動き",
      body: [r.deal_status ? `商談の状態：${clip(r.deal_status, 40)}` : "", r.next_date ? `次回：${r.next_date}` : "", r.apply_date ? `申込：${r.apply_date}` : "",
        r.usage_start ? `利用開始：${r.usage_start}` : "", r.judgment_basis ? `根拠：${clip(r.judgment_basis, 400)}` : ""].filter(Boolean).join("\n"),
      people: r.owner ? [clip(r.owner, 60)] : [], at: r.at }));
    return { items, next: rows.length ? String(rows[rows.length - 1].id) : String(after || 0), done: rows.length < limit };
  },

  // 架電：1社1日を1件にまとめる（1コールずつだと多すぎて読めないため）。続きの印は日付。
  // knowkin は前日・当日をもう一度取りに来るので、その日のあとから増えた分も入る
  async calls(pool, after, limit) {
    // 初回は一番古い架電の日から。架電のない日が続くところは飛ばす（空のページを何百回も取りに来させないため）
    const first = (await pool.query(`SELECT (min(at) AT TIME ZONE 'Asia/Tokyo')::date::text AS d FROM call_logs WHERE at >= ($1::date::timestamp AT TIME ZONE 'Asia/Tokyo')`,
      [/^\d{4}-\d{2}-\d{2}$/.test(String(after || "")) ? after : "2000-01-01"])).rows[0].d;
    if (!first) return { items: [], next: /^\d{4}-\d{2}-\d{2}$/.test(String(after || "")) ? after : "", done: true };
    const from = first;
    const span = Math.max(1, Math.min(31, Math.floor(limit / 50) || 7));   // 500件なら10日ずつ
    const { rows } = await pool.query(
      `SELECT (at AT TIME ZONE 'Asia/Tokyo')::date::text AS day, COALESCE(NULLIF(company, ''), '会社名なし') AS company,
              count(*)::int AS n, string_agg(DISTINCT result, '・') AS results, string_agg(DISTINCT caller, '・') AS callers,
              string_agg(NULLIF(memo, ''), ' ／ ' ORDER BY at) AS memos
       FROM call_logs
       WHERE at >= ($1::date::timestamp AT TIME ZONE 'Asia/Tokyo') AND at < (($1::date + $2::int)::timestamp AT TIME ZONE 'Asia/Tokyo')
       GROUP BY 1, 2 ORDER BY 1, 2`, [from, span]);
    const items = rows.map((r) => ({
      ref: `kincall:call:${r.day}:${r.company}`, kind: "架電", company: clip(r.company, 80), title: `${r.n}コール（${clip(r.results, 80)}）`,
      body: [`架電した人：${clip(r.callers, 200)}`, r.memos ? `メモ：${clip(r.memos, 1200)}` : ""].filter(Boolean).join("\n"),
      people: String(r.callers || "").split("・").filter(Boolean).slice(0, 5).map((x) => clip(x, 60)), at: `${r.day}T00:00:00+09:00` }));
    const nextDay = (await pool.query(`SELECT ($1::date + $2::int)::text AS d, ($1::date + $2::int) > (now() AT TIME ZONE 'Asia/Tokyo')::date AS done`, [from, span])).rows[0];
    return { items, next: nextDay.d, done: nextDay.done };
  },

  // DOCの契約企業（いまの状態）。変わるたびに同じ ref で上書きされる
  async kinxs_accounts(pool, after, limit) {
    const [t, id] = splitCursor(after);
    const { rows } = await pool.query(
      `SELECT account_id, COALESCE(NULLIF(name_override, ''), name) AS name, products, booked_on::text AS booked, start_on::text AS start_on, end_on::text AS end_on,
              renew_month, fs_name, cs_name, rank, usage_status, purpose, na_text, na_due::text AS na_due, published, published_on::text AS published_on,
              kickoff_on::text AS kickoff_on, memo, mtg_summary, archived, updated_at::text AS cur, ${JST("updated_at")} AS at
       FROM kinxs_accounts WHERE (updated_at, account_id) > ($1::timestamptz, $2) AND merged_into IS NULL
       ORDER BY updated_at, account_id LIMIT $3`, [t, id, limit]);
    const items = rows.map((r) => {
      const prods = (Array.isArray(r.products) ? r.products : []).map((p) => clip(typeof p === "string" ? p : (p && (p.name || p.label)) || "", 60)).filter(Boolean);
      const ms = r.mtg_summary && typeof r.mtg_summary === "object" ? clip(r.mtg_summary.overview || r.mtg_summary.text || "", 500) : "";
      return { ref: `kinxs:account:${r.account_id}`, kind: "DOC契約", company: clip(r.name, 80), title: `DOCの契約状況${r.archived ? "（アーカイブ）" : ""}`,
        body: [prods.length ? `商品：${prods.join("・")}` : "", r.booked ? `受注：${r.booked}` : "", r.start_on || r.end_on ? `期間：${r.start_on || "?"}〜${r.end_on || "?"}` : "",
          r.renew_month ? `更新月：${clip(r.renew_month, 20)}` : "", r.fs_name || r.cs_name ? `担当：FS ${clip(r.fs_name, 40) || "-"}／CS ${clip(r.cs_name, 40) || "-"}` : "",
          r.rank ? `ランク：${clip(r.rank, 10)}` : "", r.usage_status ? `活用：${clip(r.usage_status, 60)}` : "", r.purpose ? `目的：${clip(r.purpose, 200)}` : "",
          r.kickoff_on ? `キックオフ：${r.kickoff_on}` : "", r.published ? `掲載済み${r.published_on ? `（${r.published_on}）` : ""}` : "",
          r.na_text ? `次のアクション：${clip(r.na_text, 200)}${r.na_due ? `（${r.na_due}まで）` : ""}` : "", ms ? `打ち合わせの要約：${ms}` : "", r.memo ? `メモ：${clip(r.memo, 400)}` : ""].filter(Boolean).join("\n"),
        people: [r.fs_name, r.cs_name].filter(Boolean).map((x) => clip(x, 60)), at: r.at };
    });
    const last = rows[rows.length - 1];
    return { items, next: last ? `${last.cur}|${last.account_id}` : after, done: rows.length < limit };
  },

  // 契約企業の変更の履歴（段階・担当・更新など）
  async kinxs_history(pool, after, limit) {
    const { rows } = await pool.query(
      `SELECT h.id, h.kind, h.from_v, h.to_v, h.by_user, h.auto, COALESCE(NULLIF(a.name_override, ''), a.name) AS name, ${JST("h.at")} AS at
       FROM kinxs_history h LEFT JOIN kinxs_accounts a ON a.account_id = h.account_id
       WHERE h.id > $1 ORDER BY h.id LIMIT $2`, [Number(after) || 0, limit]);
    const items = rows.map((r) => ({ ref: `kinxs:history:${r.id}`, kind: "DOC契約の変更", company: clip(r.name, 80),
      title: `${clip(r.kind, 40)}：${clip(r.from_v, 60) || "なし"} → ${clip(r.to_v, 60) || "なし"}`, body: r.auto ? "自動で変更" : (r.by_user ? `変更した人：${clip(r.by_user, 60)}` : ""),
      people: r.by_user && !r.auto ? [clip(r.by_user, 60)] : [], at: r.at }));
    return { items, next: rows.length ? String(rows[rows.length - 1].id) : String(after || 0), done: rows.length < limit };
  },

  // お客様の声（要望・不満・質問）
  async kinxs_voices(pool, after, limit) {
    const { rows } = await pool.query(
      `SELECT v.id, v.kind, v.category, v.title, v.detail, v.quote, v.priority, v.status, v.source_title, COALESCE(NULLIF(a.name_override, ''), a.name) AS name,
              ${JST("COALESCE(v.source_at, v.created_at)")} AS at
       FROM kinxs_voices v LEFT JOIN kinxs_accounts a ON a.account_id = v.account_id
       WHERE v.id > $1 ORDER BY v.id LIMIT $2`, [Number(after) || 0, limit]).catch(() => ({ rows: [] }));
    const items = rows.map((r) => ({ ref: `kinxs:voice:${r.id}`, kind: "お客様の声", company: clip(r.name, 80),
      title: `【${clip(r.kind || "要望", 10)}${r.category ? `・${clip(r.category, 20)}` : ""}】${clip(r.title, 120)}`,
      body: [clip(r.detail, 800), r.quote ? `「${clip(r.quote, 300)}」` : "", r.priority ? `優先度：${clip(r.priority, 10)}` : "", r.status ? `状態：${clip(r.status, 20)}` : "",
        r.source_title ? `出どころ：${clip(r.source_title, 120)}` : ""].filter(Boolean).join("\n"), people: [], at: r.at }));
    return { items, next: rows.length ? String(rows[rows.length - 1].id) : String(after || 0), done: rows.length < limit };
  },

  // DOCのAIへの候補者の質問（1チャット1件）。会社名は kinXs の契約企業の AI の URL から引く
  async docai(pool, after, limit) {
    const [t, id] = splitCursor(after);
    const { rows } = await pool.query(
      `SELECT company_id, session_key, qa, updated_at::text AS cur, ${JST("first_at")} AS at
       FROM kinxs_docai_chats WHERE (updated_at, company_id || '/' || session_key) > ($1::timestamptz, $2)
       ORDER BY updated_at, company_id || '/' || session_key LIMIT $3`, [t, id, limit]).catch(() => ({ rows: [] }));
    const names = new Map();
    if (rows.length) {
      const accs = (await pool.query(`SELECT COALESCE(NULLIF(name_override, ''), name) AS name, info FROM kinxs_accounts WHERE info IS NOT NULL AND merged_into IS NULL`)).rows;
      for (const a of accs) {
        const i = a.info || {}; const u = i.ai_url || i.prod_url || "";
        const m = /brainverse-ai\.com\/([A-Za-z0-9_-]+)/.exec(String(u)); if (m) names.set(m[1].toLowerCase(), a.name);
      }
    }
    const items = rows.map((r) => {
      const qs = (Array.isArray(r.qa) ? r.qa : []).map((x) => clip(x && x.q, 200)).filter(Boolean);
      return { ref: `kinxs:docai:${r.company_id}:${r.session_key}`, kind: "候補者の質問", company: clip(names.get(String(r.company_id).toLowerCase()) || r.company_id, 80),
        title: `候補者の質問 ${qs.length}件`, body: qs.slice(0, 30).map((q) => `・${q}`).join("\n"), people: [], at: r.at };
    });
    const last = rows[rows.length - 1];
    return { items, next: last ? `${last.cur}|${last.company_id}/${last.session_key}` : after, done: rows.length < limit };
  },

  // 資料の閲覧（1回の閲覧を1件）
  async doc_views(pool, after, limit) {
    const { rows } = await pool.query(
      `SELECT v.id, v.seconds, v.max_page, l.company, l.contact, l.owner, f.name AS doc, ${JST("v.started_at")} AS at
       FROM doc_views v JOIN doc_links l ON l.id = v.link_id LEFT JOIN doc_files f ON f.id = l.doc_id
       WHERE v.id > $1 ORDER BY v.id LIMIT $2`, [Number(after) || 0, limit]);
    const items = rows.map((r) => ({ ref: `kinbot:doc_view:${r.id}`, kind: "資料の閲覧", company: clip(r.company, 80),
      title: `資料を見た：${clip(r.doc, 100)}`, body: [`${Math.round((r.seconds || 0) / 6) / 10}分・${r.max_page || 0}ページまで`, r.contact ? `見た人：${clip(r.contact, 60)}` : ""].filter(Boolean).join("\n"),
      people: r.owner ? [clip(r.owner, 60)] : [], at: r.at }));
    return { items, next: rows.length ? String(rows[rows.length - 1].id) : String(after || 0), done: rows.length < limit };
  },
};

export function registerKnowkinFeed(app) {
  app.get("/api/knowkin/feed", async (req, res) => {
    try {
      if (!req.user) return res.status(401).json({ error: "ログインしてください" });
      if (!req.isAdmin) return res.status(403).json({ error: "knowkinへの書き出しは管理者（ADMIN_EMAILS）のトークンだけが使えます。API_TOKENS のトークンを管理者のメールに紐づけてください" });
      const pool = dbPool();
      if (!pool) return res.status(503).json({ error: "データベースにつながっていません" });
      const kind = String(req.query.kind || "");
      if (!KINDS[kind]) return res.json({ kinds: Object.keys(KINDS) });
      const limit = Math.max(1, Math.min(500, parseInt(req.query.limit, 10) || 200));
      const after = String(req.query.after || "");
      try { res.json(await KINDS[kind](pool, after, limit)); }
      catch (e) {
        // kinXs の表は、kinXs を一度も開いていないと作られていない。そのときは「まだ無い」として返す
        if (/does not exist/.test(e.message)) return res.json({ items: [], next: after, done: true });
        throw e;
      }
    } catch (e) {
      console.error("[knowkin-feed]", req.query.kind, e.message);
      res.status(500).json({ error: `書き出せませんでした：${e.message}` });
    }
  });
}
