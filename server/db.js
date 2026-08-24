// server/db.js
// 文字起こし・要約・分析を Postgres に保存する。
// DATABASE_URL が無ければ自動で「保存なし（メモリのみ）」で動く（段階導入のため）。
import pg from "pg";
import crypto from "crypto";

const DATABASE_URL = process.env.DATABASE_URL || "";
let pool = null;

export const dbEnabled = () => !!pool;

// スキーマ作成を1文ずつ独立して実行する。
// 1つ失敗しても残りを作り続け、失敗したものは名前つきで記録する。
// （以前は途中で1つ失敗すると、それ以降のテーブルが一切作られなかった）
const schemaFailures = [];
export function getSchemaFailures() { return schemaFailures.slice(); }

async function sq(sql, params) {
  const label = String(sql).replace(/\s+/g, " ").trim().slice(0, 90);
  try {
    await pool.query(sql, params);
    return true;
  } catch (e) {
    schemaFailures.push({ sql: label, error: e.message });
    console.error(`[db] スキーマ失敗 → ${label}\n        理由: ${e.message}`);
    return false;
  }
}

// 期待するテーブル・カラムが実際にできているかを確認する
const EXPECTED_TABLES = [
  "meetings", "deals", "deal_events", "smart_links", "interns", "users", "settings",
  "apo_mail_log", "gmail_actions", "closer_rotation", "assign_log", "team_rotation", "members", "closer_suspensions",
  "kasasagi_unanswered", "kasasagi_blocked", "kasasagi_reports", "next_actions",
  "doc_files", "doc_links", "doc_views", "doc_events", "sf_autolaunch", "chat_targets", "proposal_files",
];
const EXPECTED_COLUMNS = [
  ["smart_links", "client_email"], ["smart_links", "client_name"],
  ["smart_links", "client_email_source"], ["smart_links", "auto_assigned_at"],
];

export async function schemaReport() {
  if (!pool) return { connected: false, missingTables: [], missingColumns: [], failures: schemaFailures };
  const missingTables = [];
  const missingColumns = [];
  try {
    const { rows } = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`
    );
    const have = new Set(rows.map((r) => r.table_name));
    for (const t of EXPECTED_TABLES) if (!have.has(t)) missingTables.push(t);

    const { rows: cols } = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'`
    );
    const haveCol = new Set(cols.map((r) => r.table_name + "." + r.column_name));
    for (const [t, c] of EXPECTED_COLUMNS) if (!haveCol.has(t + "." + c)) missingColumns.push(`${t}.${c}`);
  } catch (e) {
    return { connected: true, error: e.message, failures: schemaFailures };
  }
  return { connected: true, missingTables, missingColumns, failures: schemaFailures };
}

export async function initDb() {
  if (!DATABASE_URL) {
    console.warn("[db] DATABASE_URL 未設定。保存は無効（履歴は残りません）。");
    return;
  }
  // Railway 内部接続(.internal)やローカルは SSL 不要。公開URLは SSL。
  const ssl =
    /localhost|\.internal|sslmode=disable/.test(DATABASE_URL)
      ? false
      : { rejectUnauthorized: false };
  pool = new pg.Pool({ connectionString: DATABASE_URL, ssl });

  await sq(`
    CREATE TABLE IF NOT EXISTS meetings (
      bot_id      TEXT PRIMARY KEY,
      meeting_url TEXT,
      rep_name    TEXT,
      created_at  TIMESTAMPTZ DEFAULT now(),
      updated_at  TIMESTAMPTZ DEFAULT now(),
      transcript  JSONB DEFAULT '[]'::jsonb,
      summary     JSONB,
      suggestions JSONB
    );
  `);
  await sq(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS feedback JSONB;`);
  await sq(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS title TEXT;`);
  await sq(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS analysis JSONB;`);
  await sq(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS owner TEXT;`);
  await sq(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS round_no INT;`);
  await sq(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS phase TEXT;`);
  await sq(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS category TEXT;`);
  await sq(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS deal_kind TEXT;`);
  await sq(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS status TEXT;`);
  await sq(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS mux_playback_id TEXT;`);
  await sq(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS custom_analysis TEXT;`);
  await sq(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS ai_log JSONB;`);
  await sq(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS metrics JSONB;`);
  await sq(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS chapters JSONB;`);
  await sq(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS drive_file_id TEXT;`);
  await sq(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS drive_link TEXT;`);
  await sq(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS account TEXT;`);
  await sq(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS note TEXT;`);
  await sq(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS apo_setter TEXT;`);
  await sq(`
    CREATE TABLE IF NOT EXISTS accounts (
      key TEXT PRIMARY KEY,
      site_url TEXT,
      official_name TEXT,
      owner TEXT,
      profile JSONB,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS owner TEXT;`);
  // 商談フェーズ自動判定の結果（1商談1行）
  await sq(`
    CREATE TABLE IF NOT EXISTS phase_judgments (
      bot_id TEXT PRIMARY KEY,
      rep_name TEXT,
      rep_email TEXT,
      meeting_date DATE,
      phase1_reached BOOLEAN,
      phase1_evidence TEXT,
      phase1_reasoning TEXT,
      phase2_reached BOOLEAN,
      phase2_evidence TEXT,
      phase2_reasoning TEXT,
      phase3_reached BOOLEAN,
      phase3_evidence TEXT,
      phase3_reasoning TEXT,
      phase4_reached BOOLEAN,
      phase4_evidence TEXT,
      phase4_reasoning TEXT,
      current_phase INTEGER,
      next_action TEXT,
      risk TEXT,
      judged_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  for (const n of [1, 2, 3, 4]) {
    await sq(`ALTER TABLE phase_judgments ADD COLUMN IF NOT EXISTS phase${n}_reasoning TEXT;`);
  }
  await sq(`CREATE INDEX IF NOT EXISTS idx_pj_meeting_date ON phase_judgments(meeting_date);`);
  await sq(`CREATE INDEX IF NOT EXISTS idx_pj_rep ON phase_judgments(rep_name);`);
  // 案件単位のフェーズ判定（その案件の全商談をまとめて判定した結果）
  await sq(`
    CREATE TABLE IF NOT EXISTS account_phase_judgments (
      account_key TEXT PRIMARY KEY,
      rep_name TEXT,
      meeting_date DATE,
      based_on INTEGER,
      phase1_reached BOOLEAN,
      phase1_evidence TEXT,
      phase1_reasoning TEXT,
      phase2_reached BOOLEAN,
      phase2_evidence TEXT,
      phase2_reasoning TEXT,
      phase3_reached BOOLEAN,
      phase3_evidence TEXT,
      phase3_reasoning TEXT,
      phase4_reached BOOLEAN,
      phase4_evidence TEXT,
      phase4_reasoning TEXT,
      current_phase INTEGER,
      next_action TEXT,
      risk TEXT,
      judged_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  for (const n of [1, 2, 3, 4]) {
    await sq(`ALTER TABLE account_phase_judgments ADD COLUMN IF NOT EXISTS phase${n}_reasoning TEXT;`);
  }
  // 担当者→チーム→グループ のマスタ
  await sq(`
    CREATE TABLE IF NOT EXISTS rep_team_mapping (
      rep_name TEXT PRIMARY KEY,
      team_name TEXT NOT NULL,
      group_name TEXT NOT NULL DEFAULT '直販'
    );
  `);
  // 担当者が所属するプロダクト（DOC / MOCHICA）。空は未設定＝「全体」タブでのみ表示。
  await sq(`ALTER TABLE rep_team_mapping ADD COLUMN IF NOT EXISTS product TEXT;`);
  // 初期データ（既存があれば上書きしない）
  for (const [rep, team] of [["植野", "浦林チーム"], ["江田", "浦林チーム"], ["田中", "中澤チーム"], ["森田", "中澤チーム"]]) {
    await sq(`INSERT INTO rep_team_mapping (rep_name, team_name, group_name) VALUES ($1,$2,'直販') ON CONFLICT (rep_name) DO NOTHING`, [rep, team]);
  }
  // インターン生（アポ獲得者）マスタ：名前＋Googleカレンダーのメールアドレス
  await sq(`
    CREATE TABLE IF NOT EXISTS interns (
      email      TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // 事前ブリーフのキャッシュ（会社ごと。再作成で上書き）
  await sq(`
    CREATE TABLE IF NOT EXISTS deal_briefs (
      company_key  TEXT PRIMARY KEY,
      company_name TEXT,
      brief        JSONB,
      based_on     INT DEFAULT 0,
      generated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`
    CREATE TABLE IF NOT EXISTS win_insights (
      scope_key    TEXT PRIMARY KEY,
      scope_label  TEXT,
      insight      JSONB,
      won_count    INT DEFAULT 0,
      lost_count   INT DEFAULT 0,
      generated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`
    CREATE TABLE IF NOT EXISTS notion_sent (
      owner TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      page_url TEXT,
      sent_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (owner, bot_id)
    );
  `);
  await sq(`
    CREATE TABLE IF NOT EXISTS action_items (
      id          SERIAL PRIMARY KEY,
      account     TEXT NOT NULL,
      bot_id      TEXT,
      text        TEXT NOT NULL,
      owner       TEXT,
      done        BOOLEAN DEFAULT false,
      due_date    DATE,
      source      TEXT DEFAULT 'manual',
      created_at  TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS idx_action_items_account ON action_items(account);`);
  await sq(`
    CREATE TABLE IF NOT EXISTS deal_status (
      account     TEXT PRIMARY KEY,
      status      TEXT NOT NULL DEFAULT '進行中',
      manual      BOOLEAN DEFAULT false,
      note        TEXT,
      updated_at  TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`
    CREATE TABLE IF NOT EXISTS knowledge (
      id         SERIAL PRIMARY KEY,
      category   TEXT,
      title      TEXT,
      body       TEXT,
      owner      TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS source_type TEXT;`);
  await sq(`ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS source_ref TEXT;`);
  await sq(`ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS folder TEXT DEFAULT '';`);
  // 商談から自動で集めた「質問と回答」
  await sq(`
    CREATE TABLE IF NOT EXISTS qa_bank (
      id         SERIAL PRIMARY KEY,
      question   TEXT NOT NULL,
      answer     TEXT NOT NULL,
      topic      TEXT,
      keywords   TEXT,
      bot_id     TEXT,
      company    TEXT,
      rep_name   TEXT,
      good       INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS qa_bank_created_idx ON qa_bank (created_at DESC);`);
  // 利用状況（どの画面のどこが押されているか）
  await sq(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id         BIGSERIAL PRIMARY KEY,
      owner      TEXT,
      page       TEXT,
      kind       TEXT,
      label      TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS usage_events_created_idx ON usage_events (created_at DESC);`);
  // 商談後にやること（御礼メール・次回アクション・SF更新）の進み具合
  await sq(`
    CREATE TABLE IF NOT EXISTS meeting_followup (
      bot_id       TEXT PRIMARY KEY,
      thanks_done  BOOLEAN DEFAULT FALSE,
      next_done    BOOLEAN DEFAULT FALSE,
      sf_done      BOOLEAN DEFAULT FALSE,
      next_date    DATE,
      next_type    TEXT,
      next_memo    TEXT,
      updated_at   TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`
    CREATE TABLE IF NOT EXISTS kb_folders (
      path       TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`
    CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id           SERIAL PRIMARY KEY,
      knowledge_id INTEGER REFERENCES knowledge(id) ON DELETE CASCADE,
      chunk_index  INTEGER,
      title        TEXT,
      category     TEXT,
      text         TEXT,
      embedding    TEXT,
      created_at   TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`
    CREATE TABLE IF NOT EXISTS settings (
      id   INT PRIMARY KEY,
      data JSONB
    );
  `);
  await sq(`
    CREATE TABLE IF NOT EXISTS calendar_bots (
      event_id   TEXT PRIMARY KEY,
      bot_id     TEXT,
      start_time TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`
    CREATE TABLE IF NOT EXISTS auto_join_meetings (
      id         SERIAL PRIMARY KEY,
      owner      TEXT NOT NULL,
      meeting_id TEXT NOT NULL,
      url        TEXT NOT NULL,
      label      TEXT DEFAULT '',
      enabled    BOOLEAN DEFAULT TRUE,
      last_joined_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS idx_auto_join_meeting ON auto_join_meetings(meeting_id);`);
  await sq(`ALTER TABLE auto_join_meetings ADD COLUMN IF NOT EXISTS calendar_any BOOLEAN DEFAULT FALSE;`);
  await sq(`
    CREATE TABLE IF NOT EXISTS users (
      email      TEXT PRIMARY KEY,
      name       TEXT,
      pass_hash  TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`
    CREATE TABLE IF NOT EXISTS google_accounts (
      owner         TEXT PRIMARY KEY,
      refresh_token TEXT,
      google_email  TEXT,
      updated_at    TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`
    CREATE TABLE IF NOT EXISTS salesforce_accounts (
      owner         TEXT PRIMARY KEY,
      refresh_token TEXT,
      instance_url  TEXT,
      sf_user       TEXT,
      updated_at    TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS sf_url TEXT;`);
  await sq(`
    CREATE TABLE IF NOT EXISTS user_settings (
      owner      TEXT PRIMARY KEY,
      data       JSONB DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`
    CREATE TABLE IF NOT EXISTS set_analysis_cache (
      key         TEXT PRIMARY KEY,
      fingerprint TEXT,
      result      JSONB,
      updated_at  TIMESTAMPTZ DEFAULT now()
    );
  `);
  // ===== Feature A: 新営業プロセス（案件＝会社名ベース、イベントログ方式） =====
  await sq(`
    CREATE TABLE IF NOT EXISTS deals (
      deal_id            TEXT PRIMARY KEY,
      company_name       TEXT,
      owner              TEXT,
      team               TEXT,
      first_meeting_date DATE,
      status             TEXT,
      created_at         TIMESTAMPTZ DEFAULT now(),
      updated_at         TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS auto_lose_deadline DATE;`);
  // ステッパー上で人が手動で進める進捗（AIの判定とは独立して持つ）。JSONBで {stage:1-5, updated_by, updated_at}。
  await sq(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS manual_progress JSONB;`);
  await sq(`
    CREATE TABLE IF NOT EXISTS deal_events (
      id                     BIGSERIAL PRIMARY KEY,
      deal_id                TEXT,
      bot_id                 TEXT,
      event_date             DATE,
      event_type             TEXT,
      meeting_kind           TEXT,
      schedule_choice        TEXT,
      schedule_choice_detail TEXT,
      apply_timing           TEXT,
      judgment_month         TEXT,
      next_meeting_scheduled BOOLEAN,
      next_meeting_date      DATE,
      result                 TEXT,
      reported_date          DATE,
      apply_date             DATE,
      usage_start_date       DATE,
      confidence             TEXT,
      judgment_basis         TEXT,
      needs_review           BOOLEAN DEFAULT false,
      raw_extraction         JSONB,
      created_at             TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS idx_deal_events_deal ON deal_events(deal_id);`);
  await sq(`CREATE INDEX IF NOT EXISTS idx_deal_events_date ON deal_events(event_date);`);
  await sq(`CREATE INDEX IF NOT EXISTS idx_deal_events_bot ON deal_events(bot_id);`);

  // ===== Feature C: 商談特徴タグ =====
  await sq(`
    CREATE TABLE IF NOT EXISTS deal_feature_tags (
      deal_id                  TEXT PRIMARY KEY,
      first_meeting_date       DATE,
      owner                    TEXT,
      team                     TEXT,
      customer_employee_size   TEXT,
      target_hire_count        TEXT,
      hiring_type_need         TEXT,
      customer_hq_region       TEXT,
      customer_industry        TEXT,
      target_job_type          JSONB,
      customer_response_status TEXT,
      decision_maker_present   BOOLEAN,
      competitor_mentioned     BOOLEAN,
      key_pain_points          JSONB,
      appeal_points_used       JSONB,
      talk_patterns            JSONB,
      talk_example             TEXT,
      meeting_stages           JSONB,
      discovery_items_covered  JSONB,
      objection_handling_style TEXT,
      objections_raised        JSONB,
      tag_confidence           TEXT,
      result                   TEXT,
      raw_extraction           JSONB,
      updated_at               TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS idx_dft_owner ON deal_feature_tags(owner);`);
  await sq(`CREATE INDEX IF NOT EXISTS idx_dft_date ON deal_feature_tags(first_meeting_date);`);
  await sq(`CREATE INDEX IF NOT EXISTS idx_dft_result ON deal_feature_tags(result);`);
  await sq(`
    CREATE TABLE IF NOT EXISTS enterprise_attributes (
      company_name         TEXT PRIMARY KEY,
      industry             TEXT,
      industry_confidence  TEXT,
      recruiting_job_types JSONB,
      job_type_confidence  TEXT,
      last_enriched_at     TIMESTAMPTZ DEFAULT now()
    );
  `);

  // ===== OAuth（Claude.aiのカスタムコネクタ用。RFC7591動的クライアント登録 + 認可コードフロー） =====
  await sq(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id      TEXT PRIMARY KEY,
      client_name    TEXT,
      redirect_uris  JSONB,
      created_at     TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`
    CREATE TABLE IF NOT EXISTS oauth_codes (
      code            TEXT PRIMARY KEY,
      client_id       TEXT,
      redirect_uri    TEXT,
      owner           TEXT,
      is_admin        BOOLEAN DEFAULT false,
      code_challenge  TEXT,
      expires_at      TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      access_token   TEXT PRIMARY KEY,
      refresh_token  TEXT,
      client_id      TEXT,
      owner          TEXT,
      is_admin       BOOLEAN DEFAULT false,
      expires_at     TIMESTAMPTZ,
      created_at     TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS idx_oauth_tokens_refresh ON oauth_tokens(refresh_token);`);

  // ===== 日程調整ページ =====
  // お客様に「空いている時間から選んでもらう」URL。
  // 誰にも配れる共通URL（Pardot用）と、相手ごとのURLの両方を作れる。
  await sq(`
    CREATE TABLE IF NOT EXISTS book_pages (
      id          SERIAL PRIMARY KEY,
      slug        TEXT UNIQUE NOT NULL,
      title       TEXT,
      owner       TEXT,
      shared_link BOOLEAN NOT NULL DEFAULT false,
      company     TEXT,
      person      TEXT,
      email       TEXT,
      minutes     INT NOT NULL DEFAULT 30,
      days_ahead  INT NOT NULL DEFAULT 14,
      from_hour   INT NOT NULL DEFAULT 10,
      to_hour     INT NOT NULL DEFAULT 19,
      note        TEXT,
      closed      BOOLEAN NOT NULL DEFAULT false,
      created_by  TEXT,
      created_at  TIMESTAMPTZ DEFAULT now()
    );
  `);
  // 開かれた記録（誰が見たか・予約まで進んだか）
  await sq(`
    CREATE TABLE IF NOT EXISTS book_views (
      id         SERIAL PRIMARY KEY,
      page_id    INT REFERENCES book_pages(id) ON DELETE CASCADE,
      viewer_email TEXT,
      viewer_name  TEXT,
      booked     BOOLEAN NOT NULL DEFAULT false,
      slot_at    TIMESTAMPTZ,
      ua         TEXT,
      at         TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS ix_book_views_page ON book_views(page_id, at DESC);`);

  // ===== 更新の記録 =====
  // kinbotが新しくなったときの内容を貯めておき、翌朝まとめて知らせる。
  await sq(`
    CREATE TABLE IF NOT EXISTS deploy_log (
      id       SERIAL PRIMARY KEY,
      message  TEXT,
      commit   TEXT,
      build    TEXT,
      ok       BOOLEAN NOT NULL DEFAULT true,
      at       TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS ix_deploy_log_at ON deploy_log(at DESC);`);

  // ===== 転送URL（外部の日程調整などを、記録してから転送する） =====
  // レセプショニストなど、ほかのサービスのURLをそのまま使いたいときに、
  // kinbotをいったん通すことで「誰が開いたか」を記録できるようにする。
  await sq(`
    CREATE TABLE IF NOT EXISTS jump_links (
      id          SERIAL PRIMARY KEY,
      slug        TEXT UNIQUE NOT NULL,
      title       TEXT,
      target_url  TEXT NOT NULL,
      owner       TEXT,
      shared_link BOOLEAN NOT NULL DEFAULT false,
      company     TEXT,
      person      TEXT,
      email       TEXT,
      closed      BOOLEAN NOT NULL DEFAULT false,
      created_by  TEXT,
      created_at  TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`
    CREATE TABLE IF NOT EXISTS jump_views (
      id        SERIAL PRIMARY KEY,
      link_id   INT REFERENCES jump_links(id) ON DELETE CASCADE,
      viewer_email TEXT,
      viewer_name  TEXT,
      ua        TEXT,
      at        TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS ix_jump_views_link ON jump_views(link_id, at DESC);`);

  // ===== コールリスト（インターン生の架電） =====
  // どのリードに、誰が、いつかけて、どうだったか。
  // Salesforceへ送る前に、まずここに残す（通信が切れても消えないように）。
  await sq(`
    CREATE TABLE IF NOT EXISTS call_lists (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      owner      TEXT,
      note       TEXT,
      closed     BOOLEAN NOT NULL DEFAULT false,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`
    CREATE TABLE IF NOT EXISTS call_targets (
      id          SERIAL PRIMARY KEY,
      list_id     INT REFERENCES call_lists(id) ON DELETE CASCADE,
      lead_id     TEXT,
      company     TEXT,
      person      TEXT,
      phone       TEXT,
      email       TEXT,
      industry    TEXT,
      area        TEXT,
      memo        TEXT,
      assigned_to TEXT,
      done        BOOLEAN NOT NULL DEFAULT false,
      sort_order  INT DEFAULT 0,
      created_at  TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS ix_call_targets_list ON call_targets(list_id, done, sort_order);`);
  await sq(`CREATE INDEX IF NOT EXISTS ix_call_targets_who ON call_targets(assigned_to, done);`);
  // Salesforceのリードの項目（ステージ＝レコードタイプ、最終ステータス＝リード状態）
  await sq(`ALTER TABLE call_targets ADD COLUMN IF NOT EXISTS stage TEXT;`);
  await sq(`ALTER TABLE call_targets ADD COLUMN IF NOT EXISTS status TEXT;`);
  // SFのリードの状態を、そのまま持っておく（一覧に出すため）
  await sq(`ALTER TABLE call_targets ADD COLUMN IF NOT EXISTS stage TEXT;`);
  await sq(`ALTER TABLE call_targets ADD COLUMN IF NOT EXISTS status TEXT;`);
  await sq(`
    CREATE TABLE IF NOT EXISTS call_logs (
      id         SERIAL PRIMARY KEY,
      target_id  INT REFERENCES call_targets(id) ON DELETE CASCADE,
      lead_id    TEXT,
      company    TEXT,
      result     TEXT NOT NULL,
      memo       TEXT,
      caller     TEXT,
      sf_task_id TEXT,
      sf_error   TEXT,
      at         TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS ix_call_logs_at ON call_logs(at DESC);`);
  await sq(`CREATE INDEX IF NOT EXISTS ix_call_logs_target ON call_logs(target_id, at DESC);`);
  // Salesforce側の活動のID（二重に表示しないために使う）
  await sq(`ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS sf_task_id TEXT;`);

  // ===== Salesforceの更新の記録 =====
  // どの商談を、いつ、どのステージにしたか。
  // 「SF更新まだ」を正しく数えるために使う。
  await sq(`
    CREATE TABLE IF NOT EXISTS sf_updates (
      id         SERIAL PRIMARY KEY,
      bot_id     TEXT,
      opp_id     TEXT,
      stage      TEXT,
      note       TEXT,
      owner      TEXT,
      at         TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS ix_sf_updates_bot ON sf_updates(bot_id, at DESC);`);

  // ===== 週のボード（ホワイトボードの代わり） =====
  // 月曜の朝礼までに「テーマ・定量目標・具体的な施策」を書き、
  // 金曜の終礼で「振り返り」を書く。1人1週で1枚。
  await sq(`
    CREATE TABLE IF NOT EXISTS weekly_board (
      id          SERIAL PRIMARY KEY,
      week_start  DATE NOT NULL,
      member      TEXT NOT NULL,
      member_name TEXT,
      theme       TEXT,
      targets     TEXT,
      actions     TEXT,
      review      TEXT,
      updated_by  TEXT,
      created_at  TIMESTAMPTZ DEFAULT now(),
      updated_at  TIMESTAMPTZ DEFAULT now(),
      UNIQUE (week_start, member)
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS ix_weekly_week ON weekly_board(week_start);`);
  // 施策は「タスクのカード」で持つ。1つずつ、できた・できなかったと振り返りを書けるようにする。
  await sq(`ALTER TABLE weekly_board ADD COLUMN IF NOT EXISTS items JSONB;`);

  // ===== 開発メモ（直したいこと・要望・自動で拾ったエラー） =====
  // 気づいたときにChatへ一言送るだけで溜まり、朝にまとめて届くようにする。
  await sq(`
    CREATE TABLE IF NOT EXISTS dev_notes (
      id         SERIAL PRIMARY KEY,
      dedupe_key TEXT UNIQUE,
      kind       TEXT NOT NULL DEFAULT 'request',
      title      TEXT NOT NULL,
      detail     TEXT,
      source     TEXT,
      status     TEXT NOT NULL DEFAULT 'new',
      hits       INT NOT NULL DEFAULT 1,
      created_by TEXT,
      first_at   TIMESTAMPTZ DEFAULT now(),
      last_at    TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS ix_dev_notes_status ON dev_notes(status, last_at DESC);`);

  // 見送った案の題名だけを覚えておく。
  // 一覧からは消すが、同じ案がまた出てくるのを防ぐために使う。
  await sq(`
    CREATE TABLE IF NOT EXISTS dev_dismissed (
      id      SERIAL PRIMARY KEY,
      title   TEXT NOT NULL,
      detail  TEXT,
      kind    TEXT,
      source  TEXT,
      at      TIMESTAMPTZ DEFAULT now()
    );
  `);

  // ===== カレンダーで気づいたこと（同じ予定で何度も通知しないため） =====
  await sq(`
    CREATE TABLE IF NOT EXISTS calendar_notice (
      event_id   TEXT NOT NULL,
      kind       TEXT NOT NULL,
      title      TEXT,
      at         TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (event_id, kind)
    );
  `);

  // ===== ライブ中継の宛先（中継サーバーが尋ねてくる） =====
  // メモリだけに持っていると、kinbotが再起動したときに失われ、
  // 中継サーバーが宛先を引けなくなって映像が届かなくなる。
  await sq(`
    CREATE TABLE IF NOT EXISTS live_relay (
      token      TEXT PRIMARY KEY,
      dest       TEXT NOT NULL,
      bot_id     TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // ===== カレンダーの変更をGoogleから即時に受け取るための監視 =====
  await sq(`
    CREATE TABLE IF NOT EXISTS calendar_watch (
      channel_id   TEXT PRIMARY KEY,
      resource_id  TEXT,
      calendar_id  TEXT,
      token_owner  TEXT,
      expires_at   TIMESTAMPTZ,
      created_at   TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`ALTER TABLE chat_targets ADD COLUMN IF NOT EXISTS on_deploy BOOLEAN NOT NULL DEFAULT true;`);
  // 朝の「新しくなりました」も、送り先ごとに選べるようにする
  await sq(`ALTER TABLE chat_targets ADD COLUMN IF NOT EXISTS on_news BOOLEAN NOT NULL DEFAULT true;`);
  await sq(`CREATE INDEX IF NOT EXISTS ix_calendar_watch_cal ON calendar_watch(calendar_id);`);

  // ===== スマートリンク（担当者切り替えに追随する共有Zoom URL） =====
  await sq(`
    CREATE TABLE IF NOT EXISTS smart_links (
      slug           TEXT PRIMARY KEY,
      label          TEXT,
      current_owner  TEXT,
      created_by     TEXT,
      created_at     TIMESTAMPTZ DEFAULT now(),
      updated_at     TIMESTAMPTZ DEFAULT now()
    );
  `);
  // アポ振り分け：スマートリンクをカレンダーの1予定に紐づける（重複発行を防ぐ）
  await sq(`ALTER TABLE smart_links ADD COLUMN IF NOT EXISTS event_id TEXT;`);
  await sq(`ALTER TABLE smart_links ADD COLUMN IF NOT EXISTS setter TEXT;`);
  // アポ獲得者のメールアドレス。
  // 「自分で取ったアポ」かどうかを名前ではなくメールで判定するために持つ。
  // 名前だけだと表記ゆれで外れ、同じ商談の予定がもう1つ作られてしまう。
  await sq(`ALTER TABLE smart_links ADD COLUMN IF NOT EXISTS setter_email TEXT;`);
  await sq(`ALTER TABLE smart_links ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ;`);
  // アポを取った日時（カレンダー予定を作った時刻）。
  // created_at はkinbotが拾った時刻なので、実際にアポを取った日とずれる。
  // プロセスシートは「アポを取った日」の列に入れるため、こちらを使う。
  await sq(`ALTER TABLE smart_links ADD COLUMN IF NOT EXISTS apo_at TIMESTAMPTZ;`);
  await sq(`ALTER TABLE smart_links ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ;`);
  await sq(`ALTER TABLE smart_links ADD COLUMN IF NOT EXISTS invite_event_id TEXT;`);
  // 商談予定をどのアカウントのカレンダーに作ったか。
  // 担当が変わったときに、前の担当のカレンダーから消すために必要。
  await sq(`ALTER TABLE smart_links ADD COLUMN IF NOT EXISTS invite_event_owner TEXT;`);
  // アポ獲得者が元の予定の説明欄に書いた内容。商談担当の予定にもそのまま引き継ぐ。
  await sq(`ALTER TABLE smart_links ADD COLUMN IF NOT EXISTS source_note TEXT;`);
  await sq(`CREATE UNIQUE INDEX IF NOT EXISTS uq_smart_links_event ON smart_links(event_id) WHERE event_id IS NOT NULL;`);

  // アポメール自動送付：お客様の宛先（カレンダーのゲストから自動取得、手入力で補完）
  await sq(`ALTER TABLE smart_links ADD COLUMN IF NOT EXISTS client_email TEXT;`);
  await sq(`ALTER TABLE smart_links ADD COLUMN IF NOT EXISTS client_name TEXT;`);
  await sq(`ALTER TABLE smart_links ADD COLUMN IF NOT EXISTS client_email_source TEXT;`);
  // 送信ログ。status='sent' / 'draft' に一意制約をかけて、同じアポへの二重作成を防ぐ。
  await sq(`
    CREATE TABLE IF NOT EXISTS apo_mail_log (
      id          BIGSERIAL PRIMARY KEY,
      slug        TEXT NOT NULL,
      kind        TEXT NOT NULL,
      to_email    TEXT,
      from_owner  TEXT,
      subject     TEXT,
      status      TEXT NOT NULL,
      error       TEXT,
      message_id  TEXT,
      created_at  TIMESTAMPTZ DEFAULT now()
    );
  `);
  // 送信済み・下書き作成済みの両方で二重作成を防ぐ（旧インデックスは作り直す）
  await sq(`DROP INDEX IF EXISTS uq_apo_mail_sent;`);
  await sq(`CREATE UNIQUE INDEX IF NOT EXISTS uq_apo_mail_done ON apo_mail_log(slug, kind) WHERE status IN ('sent','draft');`);
  await sq(`CREATE INDEX IF NOT EXISTS ix_apo_mail_slug ON apo_mail_log(slug);`);
  // 届かずに戻ってきた（跳ね返った）かどうか
  await sq(`ALTER TABLE apo_mail_log ADD COLUMN IF NOT EXISTS bounced BOOLEAN NOT NULL DEFAULT false;`);
  await sq(`ALTER TABLE apo_mail_log ADD COLUMN IF NOT EXISTS bounce_note TEXT;`);
  await sq(`CREATE INDEX IF NOT EXISTS ix_apo_mail_at ON apo_mail_log(created_at DESC);`);

  // Gmail操作ログ：誰がどのスレッドをアーカイブ／ゴミ箱に入れたかを残す。
  // 元に戻すときの手がかりになり、チームで使う以上あとから追える状態にしておく。
  await sq(`
    CREATE TABLE IF NOT EXISTS gmail_actions (
      id         BIGSERIAL PRIMARY KEY,
      owner      TEXT NOT NULL,
      thread_id  TEXT NOT NULL,
      action     TEXT NOT NULL,
      subject    TEXT,
      from_addr  TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS ix_gmail_actions_owner ON gmail_actions(owner, created_at DESC);`);

  // クローザーの割り振りローテーション。
  // sort_order が回る順番（植野1→田中2→江田3→森田4）。
  // priority=true は「代打で飛ばされた人」で、次のアポで最優先に戻す印。
  await sq(`
    CREATE TABLE IF NOT EXISTS closer_rotation (
      email            TEXT PRIMARY KEY,
      name             TEXT,
      sort_order       INT NOT NULL,
      active           BOOLEAN NOT NULL DEFAULT true,
      priority         BOOLEAN NOT NULL DEFAULT false,
      daily_cap        INT,
      last_assigned_at TIMESTAMPTZ,
      assigned_count   INT NOT NULL DEFAULT 0,
      created_at       TIMESTAMPTZ DEFAULT now(),
      updated_at       TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS ix_closer_rotation_order ON closer_rotation(sort_order);`);

  // 割り振りの記録。誰がなぜ選ばれた／飛ばされたかを残す（順番がおかしいときの調査用）
  await sq(`
    CREATE TABLE IF NOT EXISTS assign_log (
      id         BIGSERIAL PRIMARY KEY,
      slug       TEXT NOT NULL,
      assigned   TEXT,
      reason     TEXT,
      skipped    JSONB,
      actor      TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS ix_assign_log_slug ON assign_log(slug, created_at DESC);`);
  // 予定1件につき1回だけ自動割り振りする（重複割り当ての防止）
  await sq(`ALTER TABLE smart_links ADD COLUMN IF NOT EXISTS auto_assigned_at TIMESTAMPTZ;`);

  // クローザーの所属チーム。チーム単位でも均等に配れるようにする。
  await sq(`ALTER TABLE closer_rotation ADD COLUMN IF NOT EXISTS team TEXT;`);
  // 予備（フォールバック）。通常のローテーションには入らず、他の全員が埋まっているときだけ回す。
  // チームリーダーのように「他が空いていなければ自分が出る」運用のため。
  await sq(`ALTER TABLE closer_rotation ADD COLUMN IF NOT EXISTS fallback BOOLEAN NOT NULL DEFAULT false;`);
  // 担当事業（DOC / MOCHICA）。アポ振り分けを事業ごとに分けるために使う。
  await sq(`ALTER TABLE closer_rotation ADD COLUMN IF NOT EXISTS businesses JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  // 過去の実績（スプレッドシート等からの取り込み分）。均等化の計算に足して使う。
  await sq(`ALTER TABLE closer_rotation ADD COLUMN IF NOT EXISTS baseline_count INT NOT NULL DEFAULT 0;`);
  // そのアポがどちらの事業のものか（アポ獲得者の担当事業から決まる。画面で変更もできる）
  await sq(`ALTER TABLE smart_links ADD COLUMN IF NOT EXISTS business TEXT;`);
  // どのチームに配ったかを割り振り履歴にも残す
  await sq(`ALTER TABLE assign_log ADD COLUMN IF NOT EXISTS team TEXT;`);
  // テストで作ったアポを、件数の集計から外すための印。
  // 予定や記録は残したまま、実績・均等化・通知の数から除く。
  await sq(`ALTER TABLE smart_links ADD COLUMN IF NOT EXISTS excluded BOOLEAN NOT NULL DEFAULT false;`);

  // 同じカレンダー予定を二度登録しないようにする。
  // スキャンが重なったときに、同じ予定が何件もできてしまうのを防ぐ。
  try {
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_smart_links_event
         ON smart_links(event_id) WHERE event_id IS NOT NULL`);
  } catch {
    // すでに重複があると索引を作れない。
    // 情報が多いものを1件だけ残して片付けてから、もう一度作る。
    try {
      const r = await pool.query(`
        DELETE FROM smart_links s USING (
          SELECT slug FROM (
            SELECT slug, row_number() OVER (
              PARTITION BY event_id
              ORDER BY (current_owner IS NOT NULL) DESC,
                       (client_email IS NOT NULL) DESC,
                       (auto_assigned_at IS NOT NULL) DESC,
                       created_at ASC
            ) AS rn
              FROM smart_links WHERE event_id IS NOT NULL
          ) t WHERE rn > 1
        ) d WHERE s.slug = d.slug`);
      if (r.rowCount) console.warn(`[db] 重複していたアポを ${r.rowCount}件 片付けました。`);
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS ux_smart_links_event
           ON smart_links(event_id) WHERE event_id IS NOT NULL`);
    } catch (e2) {
      console.warn("[db] 二重登録の防止をかけられませんでした:", e2.message);
    }
  }
  await sq(`CREATE INDEX IF NOT EXISTS ix_smart_links_excluded ON smart_links(excluded) WHERE excluded;`);
  // 前日リマインドを送らない、と決めたアポ。ホームから切り替えられる。
  await sq(`ALTER TABLE smart_links ADD COLUMN IF NOT EXISTS no_reminder BOOLEAN NOT NULL DEFAULT false;`);

  // Google Chatの通知先。複数のスペースに送れるようにする。
  // 種類ごと（アポ割り振り／メール／資料の閲覧）にON・OFFを持つ。
  await sq(`
    CREATE TABLE IF NOT EXISTS chat_targets (
      id           SERIAL PRIMARY KEY,
      name         TEXT NOT NULL,
      webhook_url  TEXT,
      space_id     TEXT,
      on_assign    BOOLEAN NOT NULL DEFAULT true,
      on_mail      BOOLEAN NOT NULL DEFAULT true,
      on_doc       BOOLEAN NOT NULL DEFAULT true,
      on_launch    BOOLEAN NOT NULL DEFAULT true,
      on_deploy    BOOLEAN NOT NULL DEFAULT true,
      active       BOOLEAN NOT NULL DEFAULT true,
      last_error   TEXT,
      sent_count   INT NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ DEFAULT now()
    );
  `);
  // チーム単位のローテーション状態と通算件数。
  // 期間ごとの正確な件数は smart_links から集計するが、通算はここに持って画面表示を速くする。
  await sq(`
    CREATE TABLE IF NOT EXISTS team_rotation (
      team_name        TEXT PRIMARY KEY,
      sort_order       INT NOT NULL DEFAULT 1,
      active           BOOLEAN NOT NULL DEFAULT true,
      priority         BOOLEAN NOT NULL DEFAULT false,
      assigned_count   INT NOT NULL DEFAULT 0,
      last_assigned_at TIMESTAMPTZ,
      created_at       TIMESTAMPTZ DEFAULT now(),
      updated_at       TIMESTAMPTZ DEFAULT now()
    );
  `);
  // チームごとの「次に回ってくる人」。全体で1つのポインタだとチーム内が偏るため、チーム別に持つ。
  await sq(`ALTER TABLE team_rotation ADD COLUMN IF NOT EXISTS next_email TEXT;`);
  await sq(`CREATE INDEX IF NOT EXISTS ix_team_rotation_order ON team_rotation(sort_order);`);

  // 割り振り停止の履歴。停止していた期間は「稼働日」から除くため、
  // 停止で件数が少なくなった人を、あとから優先して埋め合わせることをしない。
  await sq(`
    CREATE TABLE IF NOT EXISTS closer_suspensions (
      id         BIGSERIAL PRIMARY KEY,
      email      TEXT NOT NULL,
      start_date DATE NOT NULL,
      end_date   DATE,
      reason     TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS ix_suspensions_email ON closer_suspensions(email, start_date);`);

  // かささぎが答えられなかった質問。あとから社内で答えを書き、ナレッジに反映する。
  await sq(`
    CREATE TABLE IF NOT EXISTS kasasagi_unanswered (
      id          BIGSERIAL PRIMARY KEY,
      bot_id      TEXT,
      title       TEXT,
      asked_by    TEXT,
      question    TEXT NOT NULL,
      answer      TEXT,
      answered_by TEXT,
      answered_at TIMESTAMPTZ,
      created_at  TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS ix_ks_unanswered ON kasasagi_unanswered(answered_at NULLS FIRST, created_at DESC);`);

  // 次回アクション。種別と内容を分けて持ち、チェックで完了にする。
  // Salesforceの活動記録とは別に、kinbot側のやることリストとして扱う。
  await sq(`
    CREATE TABLE IF NOT EXISTS next_actions (
      id         BIGSERIAL PRIMARY KEY,
      bot_id     TEXT,
      company    TEXT,
      title      TEXT,
      kind       TEXT NOT NULL,
      content    TEXT NOT NULL,
      due_date   DATE,
      done       BOOLEAN NOT NULL DEFAULT false,
      done_at    TIMESTAMPTZ,
      done_by    TEXT,
      owner      TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS ix_next_actions ON next_actions(done, due_date NULLS LAST, created_at DESC);`);
  await sq(`CREATE INDEX IF NOT EXISTS ix_next_actions_company ON next_actions(company);`);

  // ===== 資料の閲覧トラッキング =====
  // 送った資料が「いつ・何ページまで・どれくらいの時間」見られたかを記録する。
  // Railwayはファイルが消えるので、PDFはDBに入れる（2〜3種・数MBを想定）。
  await sq(`
    CREATE TABLE IF NOT EXISTS doc_files (
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL,
      filename    TEXT,
      mime        TEXT DEFAULT 'application/pdf',
      bytes       BYTEA,
      size        INT,
      active      BOOLEAN NOT NULL DEFAULT true,
      uploaded_by TEXT,
      created_at  TIMESTAMPTZ DEFAULT now()
    );
  `);
  // 資料は入れた人のものにする。チームに見せたいものだけ「共有」にする。
  // 既定は共有（これまでの資料が急に見えなくなると困るため）。
  await sq(`ALTER TABLE doc_files ADD COLUMN IF NOT EXISTS shared BOOLEAN NOT NULL DEFAULT true;`);

  // 宛先ごとに1本ずつURLを発行する。誰が見たかを特定するため。
  await sq(`
    CREATE TABLE IF NOT EXISTS doc_links (
      id         SERIAL PRIMARY KEY,
      slug       TEXT UNIQUE NOT NULL,
      doc_id     INT REFERENCES doc_files(id) ON DELETE CASCADE,
      company    TEXT,
      contact    TEXT,
      email      TEXT,
      owner      TEXT,
      note       TEXT,
      revoked    BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS ix_doc_links_doc ON doc_links(doc_id, created_at DESC);`);

  // 1回の閲覧（開いて閉じるまで）を1行にする
  await sq(`
    CREATE TABLE IF NOT EXISTS doc_views (
      id         SERIAL PRIMARY KEY,
      link_id    INT REFERENCES doc_links(id) ON DELETE CASCADE,
      started_at TIMESTAMPTZ DEFAULT now(),
      last_at    TIMESTAMPTZ DEFAULT now(),
      seconds    INT NOT NULL DEFAULT 0,
      max_page   INT NOT NULL DEFAULT 0,
      pages      JSONB NOT NULL DEFAULT '{}'::jsonb,
      ua         TEXT,
      referrer   TEXT,
      ip_hash    TEXT,
      notified   BOOLEAN NOT NULL DEFAULT false
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS ix_doc_views_link ON doc_views(link_id, started_at DESC);`);
  // 資料を閉じたかどうか。閉じた時点の滞在時間で通知するために使う。
  await sq(`ALTER TABLE doc_views ADD COLUMN IF NOT EXISTS ended BOOLEAN NOT NULL DEFAULT false;`);

  // 送ったURLに、期限・合言葉・お名前確認を付けられるようにする。
  //   expires_at … この日時をすぎたら開けない（空なら期限なし）
  //   pass_hash  … 合言葉（そのままは保存せず、変換して持つ）
  //   ask_name   … 開く前に、お名前とメールをうかがう
  await sq(`ALTER TABLE doc_links ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;`);
  await sq(`ALTER TABLE doc_links ADD COLUMN IF NOT EXISTS pass_hash TEXT;`);
  await sq(`ALTER TABLE doc_links ADD COLUMN IF NOT EXISTS ask_name BOOLEAN NOT NULL DEFAULT false;`);
  // 見た人が名乗ってくれた内容
  await sq(`ALTER TABLE doc_views ADD COLUMN IF NOT EXISTS viewer_name TEXT;`);
  await sq(`ALTER TABLE doc_views ADD COLUMN IF NOT EXISTS viewer_email TEXT;`);
  // 共通URL（メルマガ用）で開いた人。差し込みタグから受け取る。
  await sq(`ALTER TABLE doc_views ADD COLUMN IF NOT EXISTS viewer_email TEXT;`);
  await sq(`ALTER TABLE doc_views ADD COLUMN IF NOT EXISTS viewer_name TEXT;`);

  // 開封（画像の読み込み）とリンクのクリック
  await sq(`
    CREATE TABLE IF NOT EXISTS doc_events (
      id      SERIAL PRIMARY KEY,
      link_id INT REFERENCES doc_links(id) ON DELETE CASCADE,
      kind    TEXT NOT NULL,
      url     TEXT,
      ua      TEXT,
      at      TIMESTAMPTZ DEFAULT now()
    );
  `);
  await sq(`CREATE INDEX IF NOT EXISTS ix_doc_events_link ON doc_events(link_id, at DESC);`);

  // Salesforceの自動立ち上げの結果。通せなかった理由をホームに出すために持つ。
  await sq(`
    CREATE TABLE IF NOT EXISTS sf_autolaunch (
      slug        TEXT PRIMARY KEY,
      bot_id      TEXT,
      title       TEXT,
      company     TEXT,
      person      TEXT,
      ok          BOOLEAN NOT NULL DEFAULT false,
      reason      TEXT,
      detail      TEXT,
      lead_id     TEXT,
      opp_id      TEXT,
      filled_url  TEXT,
      tried_at    TIMESTAMPTZ DEFAULT now()
    );
  `);

  // かささぎが言ってはいけない語を止めた記録（週次の点検用）
  await sq(`
    CREATE TABLE IF NOT EXISTS kasasagi_blocked (
      id         BIGSERIAL PRIMARY KEY,
      bot_id     TEXT,
      word       TEXT,
      text       TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  // 商談ごとのかささぎの記録（営業へのフィードバックと次アクション）
  await sq(`
    CREATE TABLE IF NOT EXISTS kasasagi_reports (
      bot_id      TEXT PRIMARY KEY,
      title       TEXT,
      owner       TEXT,
      feedback    TEXT,
      next_action TEXT,
      spoken      INT DEFAULT 0,
      answered    INT DEFAULT 0,
      unanswered  INT DEFAULT 0,
      created_at  TIMESTAMPTZ DEFAULT now()
    );
  `);

  // 社内ナレッジの公開範囲。かささぎが商談で使ってよいものだけを絞る。
  await sq(`ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'both';`);

  // ===== メンバー管理（登録元をここ1つにまとめる） =====
  // 事業（DOC / MOCHICA）・チーム・役割（クローザー／インサイド／予備）をここで持ち、
  // closer_rotation・interns・rep_team_mapping へ同期する。
  // 既存機能はこれまでのテーブルを見続けるので、動きは変わらない。
  await sq(`
    CREATE TABLE IF NOT EXISTS members (
      email       TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      businesses  JSONB NOT NULL DEFAULT '[]'::jsonb,
      team        TEXT,
      roles       JSONB NOT NULL DEFAULT '[]'::jsonb,
      active      BOOLEAN NOT NULL DEFAULT true,
      daily_cap   INT,
      sort_order  INT NOT NULL DEFAULT 1,
      note        TEXT,
      created_at  TIMESTAMPTZ DEFAULT now(),
      updated_at  TIMESTAMPTZ DEFAULT now()
    );
  `);
  // 署名・Zoom情報など、人によって変わる項目。
  // メールの差し込みタグ（{{担当者電話}} など）から使う。
  await sq(`ALTER TABLE members ADD COLUMN IF NOT EXISTS profile JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await sq(`CREATE INDEX IF NOT EXISTS ix_members_order ON members(sort_order);`);

  // 提案資料テーブル
  await sq(`
    CREATE TABLE IF NOT EXISTS proposal_files (
      id SERIAL PRIMARY KEY,
      deal_id TEXT,
      slide_url TEXT NOT NULL,
      slide_id TEXT,
      filename TEXT,
      uploaded_by TEXT,
      uploaded_at TIMESTAMPTZ DEFAULT NOW(),
      summary TEXT,
      extracted_text TEXT,
      tags JSONB DEFAULT '{}',
      company_name TEXT,
      industry TEXT,
      employee_size TEXT,
      region TEXT,
      result TEXT
    )
  `);

  // 初回だけ既存の登録から members を作り、そのあと各テーブルへ同期する。
  // これで closer_rotation の事業・チーム・予備がメンバー管理の内容に揃う。
  try {
    await seedMembersFromLegacy();
    await syncMembersToLegacy();
  } catch (e) { console.error("[members] 起動時の同期に失敗", e.message); }

  // スキーマの作成結果をまとめて出す。ここを見れば何が足りないか一目で分かる。
  const rep = await schemaReport();
  if (schemaFailures.length) {
    console.error(`[db] スキーマ作成で ${schemaFailures.length} 件失敗しました（上のログを確認してください）`);
  }
  if (rep.missingTables && rep.missingTables.length) {
    console.error("[db] 作られていないテーブル:", rep.missingTables.join(", "));
  }
  if (rep.missingColumns && rep.missingColumns.length) {
    console.error("[db] 作られていないカラム:", rep.missingColumns.join(", "));
  }
  if (!schemaFailures.length && !(rep.missingTables || []).length && !(rep.missingColumns || []).length) {
    console.log("[db] スキーマは最新です（不足なし）。");
  }
  console.log("[db] Postgres に接続しました（履歴を保存します）。");
}

// 商談名だけを更新する。回数（round_no）は、商談名から読み取れたときだけ入れる。
// updateMeetingMeta は round_no を必ず書き換えてしまうので、補完用にはこちらを使う。
export async function setMeetingTitle(botId, title) {
  if (!pool || !botId) return;
  const r = roundFromTitle(title);
  try {
    if (r != null) {
      await pool.query(`UPDATE meetings SET title=$2, round_no=$3, updated_at=now() WHERE bot_id=$1`, [botId, title || "", r]);
    } else {
      await pool.query(`UPDATE meetings SET title=$2, updated_at=now() WHERE bot_id=$1`, [botId, title || ""]);
    }
  } catch (e) {
    console.error("[db] setMeetingTitle", e.message);
  }
}

// 商談のowner/rep_nameだけを更新する（営業担当の後付け設定に使う）
export async function setMeetingOwner(botId, { owner, repName } = {}) {
  if (!pool || !botId) return;
  const sets = [], vals = [botId];
  let i = 2;
  if (owner !== undefined) { sets.push(`owner=$${i}`); vals.push(owner || ""); i++; }
  if (repName !== undefined) { sets.push(`rep_name=$${i}`); vals.push(repName || ""); i++; }
  if (!sets.length) return;
  try { await pool.query(`UPDATE meetings SET ${sets.join(", ")}, updated_at=now() WHERE bot_id=$1`, vals); }
  catch (e) { console.error("[db] setMeetingOwner", e.message); }
}

export async function createMeeting(botId, { meetingUrl, repName, title, owner, muxPlaybackId }) {
  if (!pool) return;
  const round = roundFromTitle(title); // 商談名から回数を自動判定（【新/ヒ】【初回/】=1、【n回目】=n）
  try {
    await pool.query(
      `INSERT INTO meetings (bot_id, meeting_url, rep_name, title, owner, mux_playback_id, round_no)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (bot_id) DO NOTHING`,
      [botId, meetingUrl || "", repName || "", title || "", owner || "", muxPlaybackId || null, round]
    );
  } catch (e) {
    console.error("[db] createMeeting", e.message);
  }
}

export async function saveMeeting(botId, { transcript, summary, suggestions, aiLog, metrics }) {
  if (!pool) return;
  try {
    const sets = ["transcript=$2", "summary=$3", "suggestions=$4", "updated_at=now()"];
    const vals = [
      botId,
      JSON.stringify(transcript || []),
      summary ? JSON.stringify(summary) : null,
      suggestions ? JSON.stringify(suggestions) : null,
    ];
    if (aiLog !== undefined) {
      vals.push(JSON.stringify(aiLog || []));
      sets.push(`ai_log=$${vals.length}`);
    }
    if (metrics !== undefined) {
      vals.push(JSON.stringify(metrics || {}));
      sets.push(`metrics=$${vals.length}`);
    }
    await pool.query(`UPDATE meetings SET ${sets.join(", ")} WHERE bot_id=$1`, vals);
  } catch (e) {
    console.error("[db] saveMeeting", e.message);
  }
}

export async function listMeetings({ owner, isAdmin, from, to, limit, light } = {}) {
  if (!pool) return [];
  // light=true のときは、一覧に必要な項目だけを返す（全期間を一度に読めるように軽くする）
  const cols = light
    ? `m.bot_id, m.meeting_url, m.rep_name, m.title, m.owner,
       m.round_no, m.phase, m.status, m.created_at, m.updated_at,
       jsonb_build_object('overview', m.summary->'overview') AS summary,
       m.sf_url, m.drive_file_id, m.mux_playback_id,
       COALESCE(m.account,'') AS account, m.category, m.deal_kind,
       m.apo_setter, u.name AS owner_name`
    : `m.bot_id, m.meeting_url, m.rep_name, m.title, m.owner,
       m.round_no, m.phase, m.status, m.created_at, m.updated_at, m.summary, m.analysis, m.note,
       m.metrics, m.sf_url, m.drive_file_id, m.drive_link, m.mux_playback_id,
       COALESCE(m.account,'') AS account, m.category, m.deal_kind,
       m.apo_setter, u.name AS owner_name`;
  const base = `SELECT ${cols} FROM meetings m LEFT JOIN users u ON u.email = m.owner`;
  // 文字起こしが無い（空配列/NULL）の商談は履歴に残さない
  const hasTranscript = `(jsonb_typeof(m.transcript)='array' AND jsonb_array_length(m.transcript) > 0)`;
  const conds = [hasTranscript];
  const vals = [];
  if (!isAdmin && owner) {
    vals.push(owner);
    conds.push(`(m.owner=$${vals.length} OR m.owner IS NULL OR m.owner='')`);
  }
  // 商談日でしぼる（日本時間の日付で比較）
  if (from) { vals.push(from); conds.push(`(m.created_at AT TIME ZONE 'Asia/Tokyo')::date >= $${vals.length}::date`); }
  if (to)   { vals.push(to);   conds.push(`(m.created_at AT TIME ZONE 'Asia/Tokyo')::date <= $${vals.length}::date`); }
  const lim = Math.max(1, Math.min(3000, Number(limit) || 300));
  const { rows } = await pool.query(
    `${base} WHERE ${conds.join(" AND ")} ORDER BY m.created_at DESC LIMIT ${lim}`, vals
  );
  return rows;
}

// 指定商談のAI提案ログ（刺さったトーク・懸念）をまとめて取得
export async function getAiLogsByIds(ids) {
  if (!pool || !Array.isArray(ids) || !ids.length) return [];
  try {
    const { rows } = await pool.query(
      `SELECT m.bot_id, m.title, m.owner, m.created_at, m.ai_log, u.name AS owner_name
         FROM meetings m LEFT JOIN users u ON u.email = m.owner
        WHERE m.bot_id = ANY($1)`,
      [ids]
    );
    return rows;
  } catch (e) {
    console.error("[db] getAiLogsByIds", e.message);
    return [];
  }
}

// 商談名から会社名を推定（案件のグルーピング用）。
// 例: 「【新/ヒ】豊長自動車販売株式会社　秋山様」→「豊長自動車販売株式会社」
export function companyFromTitle(title) {
  // 全角の記号は半角にそろえてから見る（／→/、：→: など）
  let t = String(title || "").normalize("NFKC").trim();
  if (!t) return "(無題)";
  t = t.replace(/^[\s　・※•◆◇■□▶▷*\-–—✉⊠]+/u, "");           // 先頭記号
  t = t.replace(/[【\[［][^】\]］]*[】\]］]/gu, " ");              // 【…】[…]ラベル除去
  // 末尾の「担当者様」を落とす。
  // 区切りは / ／ | ｜ : ： ・ 、 , と空白のどれでもよく、前後に空白があってもよい。
  const SEP = "[\\s　/／|｜:：・、,]";
  t = t.replace(new RegExp(`${SEP}+[^\\s　/／|｜:：・、,]{0,16}\\s*(?:様|さま|さん|殿)(?:\\s*[・,、]\\s*[^\\s　/／|｜]{0,16}\\s*(?:様|さま|さん|殿))*\\s*$`, "u"), "");
  t = t.replace(/[^\s　/／|｜:：・、,]{0,16}\s*(?:様|さま|さん|殿)\s*$/u, "");   // 区切り無しの 末尾○○様
  t = t.replace(/[\s　/／|｜:：・、,]+$/u, "");                                  // 区切りの名残
  t = t.replace(/\s+/g, " ").trim();

  // 会社名部分だけを抽出。日本の主要な法人形態を網羅し、
  //   「〇〇株式会社」（後置）や「株式会社〇〇」（前置）を検出。
  //   両方マッチした場合は長い方を採用（誤検知を減らす）。
  //   どれもマッチしない場合はクリーニング後の文字列をそのまま返す（役所・県など）。
  const suffix = "(?:株式会社|有限会社|合同会社|合名会社|合資会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|特定非営利活動法人|NPO法人|医療法人(?:社団|財団)?|学校法人|宗教法人|社会福祉法人|独立行政法人|生活協同組合|農業協同組合|漁業協同組合|信用金庫|信用組合)";
  const prePattern = new RegExp("(" + suffix + "[^\\s(（/／|｜:：,、]+)");
  const postPattern = new RegExp("([^\\s(（/／|｜:：,、]+" + suffix + ")");
  const preMatch = t.match(prePattern);
  const postMatch = t.match(postPattern);
  if (preMatch && postMatch) return preMatch[0].length >= postMatch[0].length ? preMatch[0] : postMatch[0];
  if (preMatch) return preMatch[0];
  if (postMatch) return postMatch[0];
  return t || String(title || "(無題)").trim();
}

// 商談名（タイトル）から「何回目」を推定する。全角半角の違いはNFKCで吸収。
//   【新/ヒ】 → 1回目（【新/ヒ/コールド】のように後ろに区分が付いてもよい）
//   【初回…】 → 1回目（【初回/】【初回/コールド】【初回/過去失注】など）
//   【2回目…】 など 【n回目…】 → n回目
//   判定できなければ null
export function roundFromTitle(title) {
  const t = String(title || "").normalize("NFKC");
  // 【n回目…】を先に判定（「初回」より具体的な指定を優先する）
  const m = t.match(/【[^】]*?(\d+)\s*回目/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  if (/【[^】]*初回[^】]*】/.test(t)) return 1;        // 【初回】【初回/】【初回/コールド】【初回/過去失注】
  if (/【[^】]*(?:新|ヒ)[^】]*】/.test(t)) return 1;     // 【新/ヒ】【新】【ヒ】【新規】
  return null;
}

// 文字起こしが無い古い商談を一括削除（定期クリーンアップ用）
export async function deleteEmptyMeetings(minutes = 180) {
  if (!pool) return 0;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM meetings
        WHERE (transcript IS NULL OR jsonb_typeof(transcript) <> 'array' OR jsonb_array_length(transcript) = 0)
          AND created_at < now() - ($1 || ' minutes')::interval`,
      [String(minutes)]
    );
    return rowCount || 0;
  } catch (e) {
    console.error("[db] deleteEmptyMeetings", e.message);
    return 0;
  }
}

// 商談の「何回目」「フェーズ」「商談名」「営業担当(owner)」を更新（undefinedの項目は変更しない）
export async function updateMeetingMeta(botId, { round, phase, title, owner, createdAt, account, category, dealKind }) {
  if (!pool) return;
  // roundが未指定で、タイトルが渡された場合は商談名から回数を推定する
  let r = round;
  if ((r === undefined || r === null) && title !== undefined) {
    const fromTitle = roundFromTitle(title);
    if (fromTitle != null) r = fromTitle;
  }
  const sets = ["round_no=$2"];
  const vals = [botId, r ?? null];
  let idx = 3;
  if (phase !== undefined) {
    sets.push(`phase=$${idx}`);
    vals.push(phase || null);
    idx++;
  }
  if (title !== undefined) {
    sets.push(`title=$${idx}`);
    vals.push(title || "");
    idx++;
  }
  if (owner !== undefined) {
    sets.push(`owner=$${idx}`);
    vals.push(owner || "");
    idx++;
  }
  if (createdAt) {
    sets.push(`created_at=$${idx}`);
    vals.push(createdAt);
    idx++;
  }
  if (account !== undefined) {
    sets.push(`account=$${idx}`);
    vals.push(account || "");
    idx++;
  }
  if (category !== undefined) {
    sets.push(`category=$${idx}`);
    vals.push(category || null);
    idx++;
  }
  if (dealKind !== undefined) {
    sets.push(`deal_kind=$${idx}`);
    vals.push(dealKind || null);
    idx++;
  }
  try {
    await pool.query(`UPDATE meetings SET ${sets.join(", ")}, updated_at=now() WHERE bot_id=$1`, vals);
  } catch (e) {
    console.error("[db] updateMeetingMeta", e.message);
  }
}

// 企業アカウント情報（プロフィール）
export async function getAccount(key) {
  if (!pool || !key) return null;
  try {
    const { rows } = await pool.query(`SELECT key, site_url, official_name, owner, profile FROM accounts WHERE key=$1`, [key]);
    return rows[0] || null;
  } catch (e) { console.error("[db] getAccount", e.message); return null; }
}
export async function listAccounts() {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(`SELECT key, site_url, official_name, owner, profile FROM accounts`);
    return rows;
  } catch { return []; }
}
export async function saveAccount(key, { siteUrl, officialName, owner, profile } = {}) {
  if (!pool || !key) return;
  const cols = [], vals = [key], setParts = [];
  let i = 2;
  if (siteUrl !== undefined) { cols.push("site_url"); setParts.push(`site_url=$${i}`); vals.push(siteUrl || null); i++; }
  if (officialName !== undefined) { cols.push("official_name"); setParts.push(`official_name=$${i}`); vals.push(officialName || null); i++; }
  if (owner !== undefined) { cols.push("owner"); setParts.push(`owner=$${i}`); vals.push(owner || null); i++; }
  if (profile !== undefined) { cols.push("profile"); setParts.push(`profile=$${i}`); vals.push(profile ? JSON.stringify(profile) : null); i++; }
  if (!cols.length) return;
  const placeholders = cols.map((_, k) => "$" + (k + 2)).join(", ");
  try {
    await pool.query(
      `INSERT INTO accounts (key, ${cols.join(", ")}, updated_at) VALUES ($1, ${placeholders}, now())
       ON CONFLICT (key) DO UPDATE SET ${setParts.join(", ")}, updated_at=now()`,
      vals
    );
  } catch (e) { console.error("[db] saveAccount", e.message); }
}

// ===== 商談フェーズ自動判定 =====
export async function savePhaseJudgment(botId, j = {}) {
  if (!pool || !botId) return;
  try {
    await pool.query(
      `INSERT INTO phase_judgments
        (bot_id, rep_name, rep_email, meeting_date,
         phase1_reached, phase1_evidence, phase1_reasoning,
         phase2_reached, phase2_evidence, phase2_reasoning,
         phase3_reached, phase3_evidence, phase3_reasoning,
         phase4_reached, phase4_evidence, phase4_reasoning,
         current_phase, next_action, risk, judged_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now())
       ON CONFLICT (bot_id) DO UPDATE SET
         rep_name=$2, rep_email=$3, meeting_date=$4,
         phase1_reached=$5, phase1_evidence=$6, phase1_reasoning=$7,
         phase2_reached=$8, phase2_evidence=$9, phase2_reasoning=$10,
         phase3_reached=$11, phase3_evidence=$12, phase3_reasoning=$13,
         phase4_reached=$14, phase4_evidence=$15, phase4_reasoning=$16,
         current_phase=$17, next_action=$18, risk=$19, judged_at=now()`,
      [
        botId, j.rep_name || null, j.rep_email || null, j.meeting_date || null,
        !!j.phase1_reached, j.phase1_evidence || null, j.phase1_reasoning || null,
        !!j.phase2_reached, j.phase2_evidence || null, j.phase2_reasoning || null,
        !!j.phase3_reached, j.phase3_evidence || null, j.phase3_reasoning || null,
        !!j.phase4_reached, j.phase4_evidence || null, j.phase4_reasoning || null,
        j.current_phase || null, j.next_action || null, j.risk || null,
      ]
    );
  } catch (e) { console.error("[db] savePhaseJudgment", e.message); }
}
export async function getPhaseJudgment(botId) {
  if (!pool || !botId) return null;
  try {
    const { rows } = await pool.query(`SELECT * FROM phase_judgments WHERE bot_id=$1`, [botId]);
    return rows[0] || null;
  } catch { return null; }
}
// 案件単位の判定（全商談まとめ）
export async function saveAccountPhase(key, j = {}) {
  if (!pool || !key) return;
  try {
    await pool.query(
      `INSERT INTO account_phase_judgments
        (account_key, rep_name, meeting_date, based_on,
         phase1_reached, phase1_evidence, phase1_reasoning,
         phase2_reached, phase2_evidence, phase2_reasoning,
         phase3_reached, phase3_evidence, phase3_reasoning,
         phase4_reached, phase4_evidence, phase4_reasoning,
         current_phase, next_action, risk, judged_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now())
       ON CONFLICT (account_key) DO UPDATE SET
         rep_name=$2, meeting_date=$3, based_on=$4,
         phase1_reached=$5, phase1_evidence=$6, phase1_reasoning=$7,
         phase2_reached=$8, phase2_evidence=$9, phase2_reasoning=$10,
         phase3_reached=$11, phase3_evidence=$12, phase3_reasoning=$13,
         phase4_reached=$14, phase4_evidence=$15, phase4_reasoning=$16,
         current_phase=$17, next_action=$18, risk=$19, judged_at=now()`,
      [
        key, j.rep_name || null, j.meeting_date || null, j.based_on || null,
        !!j.phase1_reached, j.phase1_evidence || null, j.phase1_reasoning || null,
        !!j.phase2_reached, j.phase2_evidence || null, j.phase2_reasoning || null,
        !!j.phase3_reached, j.phase3_evidence || null, j.phase3_reasoning || null,
        !!j.phase4_reached, j.phase4_evidence || null, j.phase4_reasoning || null,
        j.current_phase || null, j.next_action || null, j.risk || null,
      ]
    );
  } catch (e) { console.error("[db] saveAccountPhase", e.message); }
}
export async function getAccountPhase(key) {
  if (!pool || !key) return null;
  try {
    const { rows } = await pool.query(`SELECT * FROM account_phase_judgments WHERE account_key=$1`, [key]);
    return rows[0] || null;
  } catch { return null; }
}
// 案件一覧のカード表示用：全案件ぶんのフェーズ判定を一括取得
export async function listAccountPhases() {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(`SELECT account_key, current_phase, based_on, judged_at FROM account_phase_judgments`);
    return rows;
  } catch { return []; }
}

// 案件単位×種別（コールド/過去失注/通常）×チームの集計用の行を返す。
// 種別は、その案件に属する商談の deal_kind（保存済み）または商談名からの推定で判定（過去失注 > コールド > 通常）。
// クエリ時に算出するので、商談履歴で種別を変えれば常に最新の値になる。
export async function accountKindRows({ from, to } = {}) {
  if (!pool) return [];
  const cond = [], vals = [];
  let i = 1;
  if (from) { cond.push(`apj.meeting_date >= $${i++}`); vals.push(from); }
  if (to) { cond.push(`apj.meeting_date <= $${i++}`); vals.push(to); }
  const where = cond.length ? "WHERE " + cond.join(" AND ") : "";
  try {
    const { rows } = await pool.query(
      `SELECT apj.account_key, apj.rep_name, apj.current_phase,
              apj.phase1_reached, apj.phase2_reached, apj.phase3_reached, apj.phase4_reached,
              COALESCE(rtm.team_name,'未分類') AS team_name,
              k.deal_kind
       FROM account_phase_judgments apj
       LEFT JOIN rep_team_mapping rtm ON apj.rep_name = rtm.rep_name
       LEFT JOIN LATERAL (
         SELECT CASE
           WHEN bool_or(COALESCE(m.deal_kind,'')='過去失注' OR m.title ~ '(過去失注|既存失注|失注済|再アプローチ|掘り起こし)') THEN '過去失注'
           WHEN bool_or(COALESCE(m.deal_kind,'')='コールド' OR m.title ~* '(コールド|cold|新規開拓|テレアポ|飛び込み)') THEN 'コールド'
           ELSE '通常'
         END AS deal_kind
         FROM meetings m
         WHERE COALESCE(NULLIF(m.account,''), m.title) = apj.account_key
       ) k ON true
       ${where}`,
      vals
    );
    return rows;
  } catch (e) { console.error("[db] accountKindRows", e.message); return []; }
}
// 期間内の判定結果（チーム/グループ名を結合）— ダッシュボードの集計用
export async function phaseRows({ from, to } = {}) {
  if (!pool) return [];
  const cond = [], vals = [];
  let i = 1;
  if (from) { cond.push(`pj.meeting_date >= $${i++}`); vals.push(from); }
  if (to) { cond.push(`pj.meeting_date <= $${i++}`); vals.push(to); }
  const where = cond.length ? "WHERE " + cond.join(" AND ") : "";
  try {
    const { rows } = await pool.query(
      `SELECT pj.bot_id, pj.rep_name, pj.rep_email, pj.meeting_date, pj.current_phase,
              pj.phase1_reached, pj.phase2_reached, pj.phase3_reached, pj.phase4_reached,
              pj.next_action, pj.risk,
              COALESCE(rtm.team_name,'未分類') AS team_name,
              COALESCE(rtm.group_name,'直販') AS group_name
       FROM phase_judgments pj
       LEFT JOIN rep_team_mapping rtm ON pj.rep_name = rtm.rep_name
       ${where}
       ORDER BY pj.meeting_date`,
      vals
    );
    return rows;
  } catch (e) { console.error("[db] phaseRows", e.message); return []; }
}
// 期間粒度ごとのフェーズ3到達率の推移（SQL集計）
export async function phaseTrend({ granularity = "week", from, to } = {}) {
  if (!pool) return [];
  const gran = ["day", "week", "month"].includes(granularity) ? granularity : "week";
  const cond = [], vals = [];
  let i = 1;
  if (from) { cond.push(`meeting_date >= $${i++}`); vals.push(from); }
  if (to) { cond.push(`meeting_date <= $${i++}`); vals.push(to); }
  const where = cond.length ? "WHERE " + cond.join(" AND ") : "";
  try {
    const { rows } = await pool.query(
      `SELECT DATE_TRUNC('${gran}', meeting_date) AS period,
              COUNT(*)::int AS total,
              SUM(CASE WHEN phase3_reached THEN 1 ELSE 0 END)::int AS phase3_count
       FROM phase_judgments
       ${where}
       GROUP BY period ORDER BY period`,
      vals
    );
    return rows;
  } catch (e) { console.error("[db] phaseTrend", e.message); return []; }
}
export async function listRepTeams() {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(`SELECT rep_name, team_name, group_name, COALESCE(product,'') AS product FROM rep_team_mapping ORDER BY group_name, team_name, rep_name`);
    return rows;
  } catch { return []; }
}
// 担当者名 → プロダクト（DOC / MOCHICA）のマッピング
export async function listRepProducts() {
  if (!pool) return {};
  try {
    const { rows } = await pool.query(`SELECT rep_name, COALESCE(product,'') AS product FROM rep_team_mapping`);
    const m = {};
    for (const r of rows) if (r.product) m[(r.rep_name || '').trim()] = r.product;
    return m;
  } catch { return {}; }
}
// 判定結果に出てくる担当者名（マッピング候補）
export async function listJudgmentReps() {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(`SELECT rep_name, COUNT(*)::int AS n FROM phase_judgments WHERE rep_name IS NOT NULL AND rep_name <> '' GROUP BY rep_name ORDER BY n DESC`);
    return rows;
  } catch { return []; }
}
export async function upsertRepTeam(repName, teamName, groupName = "直販", product = "") {
  if (!pool || !repName) return;
  try {
    await pool.query(
      `INSERT INTO rep_team_mapping (rep_name, team_name, group_name, product) VALUES ($1,$2,$3,$4)
       ON CONFLICT (rep_name) DO UPDATE SET team_name=$2, group_name=$3, product=$4`,
      [repName, teamName || "未分類", groupName || "直販", product || null]
    );
  } catch (e) { console.error("[db] upsertRepTeam", e.message); }
}
export async function deleteRepTeam(repName) {
  if (!pool || !repName) return;
  try { await pool.query(`DELETE FROM rep_team_mapping WHERE rep_name=$1`, [repName]); } catch {}
}

// ===== 事前ブリーフのキャッシュ =====
export async function getDealBrief(companyKey) {
  if (!pool || !companyKey) return null;
  try {
    const { rows } = await pool.query(`SELECT company_key, company_name, brief, based_on, generated_at FROM deal_briefs WHERE company_key=$1`, [companyKey]);
    return rows[0] || null;
  } catch { return null; }
}
export async function saveDealBrief(companyKey, companyName, brief, basedOn) {
  if (!pool || !companyKey) return;
  try {
    await pool.query(
      `INSERT INTO deal_briefs (company_key, company_name, brief, based_on, generated_at)
       VALUES ($1,$2,$3::jsonb,$4,now())
       ON CONFLICT (company_key) DO UPDATE SET company_name=$2, brief=$3::jsonb, based_on=$4, generated_at=now()`,
      [companyKey, companyName || "", JSON.stringify(brief || {}), basedOn || 0]
    );
  } catch (e) { console.error("[db] saveDealBrief", e.message); }
}
export async function listInterns() {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(`SELECT email, name FROM interns ORDER BY name`);
    return rows;
  } catch { return []; }
}
export async function upsertIntern(email, name) {
  if (!pool || !email) return;
  const em = String(email).trim().toLowerCase();
  try {
    await pool.query(
      `INSERT INTO interns (email, name) VALUES ($1,$2)
       ON CONFLICT (email) DO UPDATE SET name=$2`,
      [em, String(name || "").trim() || em]
    );
  } catch (e) { console.error("[db] upsertIntern", e.message); }
}
export async function deleteIntern(email) {
  if (!pool || !email) return;
  try { await pool.query(`DELETE FROM interns WHERE email=$1`, [String(email).trim().toLowerCase()]); } catch {}
}

// 商談にアポ獲得者（インターン名）を記録する
export async function setMeetingApoSetter(botId, name) {
  if (!pool || !botId) return;
  try {
    await pool.query(`UPDATE meetings SET apo_setter=$2, updated_at=now() WHERE bot_id=$1`,
      [botId, name == null || name === "" ? null : String(name)]);
  } catch (e) { console.error("[db] setMeetingApoSetter", e.message); }
}
// 照合し直す前に、対象期間のアポ獲得者を一度クリアする（再照合のたびに最新化）
export async function clearApoSetters({ from, to } = {}) {
  if (!pool) return;
  const cond = [], vals = []; let i = 1;
  if (from) { cond.push(`created_at >= $${i++}`); vals.push(from); }
  if (to) { cond.push(`created_at < ($${i++}::date + interval '1 day')`); vals.push(to); }
  const where = cond.length ? "WHERE " + cond.join(" AND ") : "";
  try { await pool.query(`UPDATE meetings SET apo_setter=NULL ${where}`, vals); } catch (e) { console.error("[db] clearApoSetters", e.message); }
}
// ダッシュボード用：期間内の実施済み商談（文字起こしあり・商談カテゴリ）と記録済みアポ獲得者を返す
export async function listApoMeetings({ from, to } = {}) {
  if (!pool) return [];
  const cond = [
    `(jsonb_typeof(transcript)='array' AND jsonb_array_length(transcript) > 0)`,
    `(category IS NULL OR category = '商談')`,
  ];
  const vals = []; let i = 1;
  if (from) { cond.push(`created_at >= $${i++}`); vals.push(from); }
  if (to) { cond.push(`created_at < ($${i++}::date + interval '1 day')`); vals.push(to); }
  const where = "WHERE " + cond.join(" AND ");
  try {
    const { rows } = await pool.query(
      `SELECT bot_id, title, created_at, apo_setter FROM meetings ${where} ORDER BY created_at DESC`, vals);
    return rows;
  } catch (e) { console.error("[db] listApoMeetings", e.message); return []; }
}

// Notion送信済みの記録（ユーザー単位・重複防止用）
export async function listNotionSent(owner) {
  if (!pool) return new Set();
  try {
    const { rows } = await pool.query(`SELECT bot_id FROM notion_sent WHERE owner=$1`, [owner || ""]);
    return new Set(rows.map((r) => r.bot_id));
  } catch (e) {
    console.error("[db] listNotionSent", e.message);
    return new Set();
  }
}
export async function markNotionSent(owner, botId, pageUrl) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO notion_sent (owner, bot_id, page_url) VALUES ($1,$2,$3)
       ON CONFLICT (owner, bot_id) DO UPDATE SET page_url=$3, sent_at=now()`,
      [owner || "", botId, pageUrl || ""]
    );
  } catch (e) {
    console.error("[db] markNotionSent", e.message);
  }
}

// Mux再生ID（アップロード動画のVOD）を保存
export async function setMeetingMux(botId, playbackId) {
  if (!pool) return;
  try {
    await pool.query(`UPDATE meetings SET mux_playback_id=$2, updated_at=now() WHERE bot_id=$1`, [botId, playbackId || ""]);
  } catch (e) {
    console.error("[db] setMeetingMux", e.message);
  }
}

// 商談メモ（手入力）を保存
export async function saveMeetingNote(botId, note) {
  if (!pool) return;
  try {
    await pool.query(`UPDATE meetings SET note=$2, updated_at=now() WHERE bot_id=$1`, [botId, note || ""]);
  } catch (e) {
    console.error("[db] saveMeetingNote", e.message);
  }
}

// ===== ネクストアクション（案件単位） =====
export async function syncAccountActionItems(account) {
  if (!pool || !account) return;
  try {
    const { rows } = await pool.query(
      `SELECT bot_id, summary FROM meetings WHERE COALESCE(NULLIF(account,''), title) = $1`,
      [account]
    );
    for (const r of rows) {
      const items = (r.summary && r.summary.action_items) || [];
      for (const t of items) {
        const text = String(t || "").trim();
        if (!text) continue;
        await pool.query(
          `INSERT INTO action_items (account, bot_id, text, source)
           SELECT $1,$2,$3,'ai'
           WHERE NOT EXISTS (SELECT 1 FROM action_items WHERE account=$1 AND bot_id=$2 AND text=$3)`,
          [account, r.bot_id, text]
        );
      }
    }
  } catch (e) {
    console.error("[db] syncAccountActionItems", e.message);
  }
}
export async function listActionItems(account) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT * FROM action_items WHERE account=$1 ORDER BY done ASC, due_date ASC NULLS LAST, created_at ASC`,
      [account]
    );
    return rows;
  } catch {
    return [];
  }
}
export async function addActionItem({ account, botId, text, owner, source, due }) {
  if (!pool || !account || !text) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO action_items (account, bot_id, text, owner, source, due_date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [account, botId || null, text, owner || "", source || "manual", due || null]
    );
    return rows[0]?.id || null;
  } catch (e) {
    console.error("[db] addActionItem", e.message);
    return null;
  }
}
export async function updateActionItem(id, { done, text, due }) {
  if (!pool) return;
  const sets = [];
  const vals = [id];
  if (done !== undefined) { vals.push(!!done); sets.push(`done=$${vals.length}`); }
  if (text !== undefined) { vals.push(text); sets.push(`text=$${vals.length}`); }
  if (due !== undefined) { vals.push(due || null); sets.push(`due_date=$${vals.length}`); }
  if (!sets.length) return;
  try {
    await pool.query(`UPDATE action_items SET ${sets.join(", ")} WHERE id=$1`, vals);
  } catch (e) {
    console.error("[db] updateActionItem", e.message);
  }
}
export async function deleteActionItem(id) {
  if (!pool) return;
  try { await pool.query(`DELETE FROM action_items WHERE id=$1`, [id]); } catch (e) { console.error("[db] deleteActionItem", e.message); }
}

// ===== 案件ステータス =====
const VALID_STATUS = ["進行中", "受注", "失注", "保留"];
export async function listDealStatuses() {
  if (!pool) return {};
  try {
    const { rows } = await pool.query(`SELECT account, status, manual FROM deal_status`);
    const map = {};
    for (const r of rows) map[r.account] = { status: r.status, manual: r.manual };
    return map;
  } catch {
    return {};
  }
}
export async function setDealStatus(account, { status, manual, note }) {
  if (!pool || !account) return;
  if (status && !VALID_STATUS.includes(status)) return;
  try {
    await pool.query(
      `INSERT INTO deal_status (account, status, manual, note, updated_at)
       VALUES ($1, COALESCE($2,'進行中'), COALESCE($3,false), $4, now())
       ON CONFLICT (account) DO UPDATE SET
         status = COALESCE($2, deal_status.status),
         manual = COALESCE($3, deal_status.manual),
         note = COALESCE($4, deal_status.note),
         updated_at = now()`,
      [account, status || null, manual === undefined ? null : manual, note || null]
    );
  } catch (e) {
    console.error("[db] setDealStatus", e.message);
  }
}
// AI自動更新：手動上書きされていない案件だけ更新
export async function setDealStatusAuto(account, status) {
  if (!pool || !account || !VALID_STATUS.includes(status)) return;
  try {
    await pool.query(
      `INSERT INTO deal_status (account, status, manual, updated_at)
       VALUES ($1, $2, false, now())
       ON CONFLICT (account) DO UPDATE SET
         status = CASE WHEN deal_status.manual THEN deal_status.status ELSE $2 END,
         updated_at = now()`,
      [account, status]
    );
  } catch (e) {
    console.error("[db] setDealStatusAuto", e.message);
  }
}

// 登録ユーザー一覧（営業担当の付け替え用）
export async function listUsers() {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(`SELECT email, name FROM users ORDER BY name NULLS LAST, email`);
    return rows;
  } catch {
    return [];
  }
}

// カスタム分析（ユーザー定義プロンプトの実行結果）を商談に保存
export async function saveCustomAnalysis(botId, text) {
  if (!pool) return;
  try {
    await pool.query(`UPDATE meetings SET custom_analysis=$2 WHERE bot_id=$1`, [botId, text || null]);
  } catch (e) { console.error("[db] saveCustomAnalysis", e.message); }
}

export async function getMeeting(botId) {
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT * FROM meetings WHERE bot_id=$1`, [botId]);
  return rows[0] || null;
}

// 商談を削除
export async function deleteMeeting(botId) {
  if (!pool) return;
  try {
    await pool.query(`DELETE FROM meetings WHERE bot_id=$1`, [botId]);
  } catch (e) {
    console.error("[db] deleteMeeting", e.message);
    throw e;
  }
}

// アップロード処理の状態（processing/done/error）
export async function setMeetingStatus(botId, status) {
  if (!pool) return;
  try {
    await pool.query(`UPDATE meetings SET status=$2, updated_at=now() WHERE bot_id=$1`, [botId, status || null]);
  } catch (e) {
    console.error("[db] setMeetingStatus", e.message);
  }
}

// 履歴画面からの再生成（要約＋営業フィードバック）を保存
export async function saveAnalysis(botId, { summary, feedback }) {
  if (!pool) return { persisted: false };
  try {
    await pool.query(
      `UPDATE meetings SET summary=$2, feedback=$3, updated_at=now() WHERE bot_id=$1`,
      [botId, summary ? JSON.stringify(summary) : null, feedback ? JSON.stringify(feedback) : null]
    );
    return { persisted: true };
  } catch (e) {
    console.error("[db] saveAnalysis", e.message);
    return { persisted: false };
  }
}

// 深掘り分析（スコア・BANT等）を保存
export async function saveDeepAnalysis(botId, analysis) {
  if (!pool) return { persisted: false };
  try {
    await pool.query(`UPDATE meetings SET analysis=$2, updated_at=now() WHERE bot_id=$1`, [
      botId,
      analysis ? JSON.stringify(analysis) : null,
    ]);
    return { persisted: true };
  } catch (e) {
    console.error("[db] saveDeepAnalysis", e.message);
    return { persisted: false };
  }
}

// ---- アプリ設定（DB保存＋メモリfallback） ----
let memSettings = {}; // DB未設定時の一時保存

export async function getSettings() {
  if (!pool) return { ...memSettings };
  try {
    const { rows } = await pool.query(`SELECT data FROM settings WHERE id=1`);
    return rows[0]?.data || {};
  } catch {
    return {};
  }
}

export async function saveSettings(obj) {
  memSettings = { ...memSettings, ...obj };
  if (!pool) return { persisted: false };
  try {
    await pool.query(
      `INSERT INTO settings (id, data) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET data = settings.data || $1`,
      [JSON.stringify(obj)]
    );
    return { persisted: true };
  } catch (e) {
    console.error("[db] saveSettings", e.message);
    return { persisted: false };
  }
}

// 判定（deal_events）がまだ無い商談を返す。定期スイープで自動判定するために使う。
// 文字起こしがあり、区分が「商談」（または未設定）のものだけ。新しい順。
export async function listUnjudgedMeetings(limit = 5) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT m.bot_id FROM meetings m
       LEFT JOIN deal_events e ON e.bot_id = m.bot_id
       WHERE e.id IS NULL
         AND (m.category IS NULL OR m.category = '' OR m.category = '商談')
         AND m.transcript IS NOT NULL AND jsonb_array_length(m.transcript) > 3
       ORDER BY m.created_at DESC
       LIMIT $1`,
      [limit]
    );
    return rows.map((r) => r.bot_id);
  } catch (e) { console.error("[db] listUnjudgedMeetings", e.message); return []; }
}

// 勝ち/負けパターン分析（インサイト）のキャッシュ
export async function getWinInsight(scopeKey) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(`SELECT * FROM win_insights WHERE scope_key=$1`, [scopeKey]);
    return rows[0] || null;
  } catch { return null; }
}
export async function saveWinInsight(scopeKey, scopeLabel, insight, wonCount, lostCount) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO win_insights (scope_key, scope_label, insight, won_count, lost_count, generated_at)
       VALUES ($1,$2,$3,$4,$5, now())
       ON CONFLICT (scope_key) DO UPDATE SET scope_label=$2, insight=$3, won_count=$4, lost_count=$5, generated_at=now()`,
      [scopeKey, scopeLabel || "", JSON.stringify(insight), wonCount || 0, lostCount || 0]
    );
  } catch (e) { console.error("[db] saveWinInsight", e.message); }
}

// ---- カレンダー予約Botの重複防止（event_id → bot_id） ----
const memScheduled = new Map();

export async function isScheduled(eventId) {
  if (!pool) return memScheduled.has(eventId);
  try {
    const { rows } = await pool.query(`SELECT 1 FROM calendar_bots WHERE event_id=$1`, [eventId]);
    return rows.length > 0;
  } catch {
    return false;
  }
}

export async function markScheduled(eventId, botId, startTime) {
  memScheduled.set(eventId, botId);
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO calendar_bots (event_id, bot_id, start_time)
       VALUES ($1,$2,$3) ON CONFLICT (event_id) DO NOTHING`,
      [eventId, botId, startTime || null]
    );
  } catch (e) {
    console.error("[db] markScheduled", e.message);
  }
}

// ---- 自動入室するZoom URLの登録（会議開始Webサイトで検知して入室） ----
export async function listAutoJoin(owner) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT id, owner, meeting_id, url, label, enabled, calendar_any, last_joined_at FROM auto_join_meetings WHERE owner=$1 ORDER BY created_at DESC`,
      [owner]
    );
    return rows;
  } catch { return []; }
}
// 会議IDから、登録している全ユーザーの行を引く（Webhook処理用）
export async function findAutoJoinByMeetingId(meetingId) {
  if (!pool || !meetingId) return [];
  try {
    const { rows } = await pool.query(
      `SELECT id, owner, meeting_id, url, label, enabled, calendar_any, last_joined_at FROM auto_join_meetings WHERE meeting_id=$1 AND enabled=TRUE`,
      [String(meetingId)]
    );
    return rows;
  } catch { return []; }
}
export async function addAutoJoin(owner, { meetingId, url, label }) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO auto_join_meetings (owner, meeting_id, url, label) VALUES ($1,$2,$3,$4) RETURNING id`,
      [owner, String(meetingId), url, label || ""]
    );
    return rows[0] && rows[0].id;
  } catch (e) { console.error("[db] addAutoJoin", e.message); return null; }
}
export async function removeAutoJoin(owner, id) {
  if (!pool) return;
  try {
    await pool.query(`DELETE FROM auto_join_meetings WHERE id=$1 AND owner=$2`, [Number(id), owner]);
  } catch (e) { console.error("[db] removeAutoJoin", e.message); }
}
export async function setAutoJoinEnabled(owner, id, enabled) {
  if (!pool) return;
  try {
    await pool.query(`UPDATE auto_join_meetings SET enabled=$3 WHERE id=$1 AND owner=$2`, [Number(id), owner, !!enabled]);
  } catch (e) { console.error("[db] setAutoJoinEnabled", e.message); }
}
export async function setAutoJoinCalendarAny(owner, id, val) {
  if (!pool) return;
  try {
    await pool.query(`UPDATE auto_join_meetings SET calendar_any=$3 WHERE id=$1 AND owner=$2`, [Number(id), owner, !!val]);
  } catch (e) { console.error("[db] setAutoJoinCalendarAny", e.message); }
}
export async function touchAutoJoin(id) {
  if (!pool) return;
  try { await pool.query(`UPDATE auto_join_meetings SET last_joined_at=now() WHERE id=$1`, [Number(id)]); } catch {}
}
// カレンダー監視用：全ユーザーの有効な登録を取得
export async function listAllAutoJoinEnabled() {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT id, owner, meeting_id, url, label, calendar_any, last_joined_at FROM auto_join_meetings WHERE enabled=TRUE`
    );
    return rows;
  } catch { return []; }
}

// ---- ユーザー（メール＋パスワード登録） ----
export async function dbGetUser(email) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(`SELECT * FROM users WHERE email=$1`, [email]);
    return rows[0] || null;
  } catch (e) {
    console.error("[db] dbGetUser", e.message);
    return null;
  }
}

export async function dbCreateUser(email, name, passHash) {
  if (!pool) throw new Error("DB未設定（DATABASE_URLが必要）");
  await pool.query(
    `INSERT INTO users (email, name, pass_hash) VALUES ($1,$2,$3)`,
    [email, name || "", passHash]
  );
}

// アカウント設定：表示名・パスワードの更新
export async function dbUpdateUser(email, { name, passHash } = {}) {
  if (!pool) throw new Error("DB未設定（DATABASE_URLが必要）");
  const sets = [], vals = [email];
  let i = 2;
  if (name !== undefined) { sets.push(`name=$${i}`); vals.push(name || ""); i++; }
  if (passHash !== undefined) { sets.push(`pass_hash=$${i}`); vals.push(passHash); i++; }
  if (!sets.length) return;
  await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE email=$1`, vals);
}

// ---- ユーザーごとのGoogleカレンダー連携 ----
export async function saveGoogleToken(owner, refreshToken, googleEmail) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO google_accounts (owner, refresh_token, google_email, updated_at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (owner) DO UPDATE SET refresh_token=$2, google_email=$3, updated_at=now()`,
      [owner, refreshToken || null, googleEmail || null]
    );
  } catch (e) {
    console.error("[db] saveGoogleToken", e.message);
  }
}
export async function getGoogleToken(owner) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(`SELECT * FROM google_accounts WHERE owner=$1`, [owner]);
    return rows[0] || null;
  } catch {
    return null;
  }
}
// Google連携済みのユーザー一覧（カレンダー照合の実行者を選ぶために使う）
export async function listGoogleConnectedOwners() {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(`SELECT owner, google_email FROM google_accounts WHERE refresh_token IS NOT NULL ORDER BY owner`);
    return rows;
  } catch { return []; }
}
export async function deleteGoogleToken(owner) {
  if (!pool) return;
  try {
    await pool.query(`DELETE FROM google_accounts WHERE owner=$1`, [owner]);
  } catch (e) {
    console.error("[db] deleteGoogleToken", e.message);
  }
}
export async function listGoogleAccounts() {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT owner, refresh_token, google_email FROM google_accounts WHERE refresh_token IS NOT NULL`
    );
    return rows;
  } catch {
    return [];
  }
}

// ---- まとめ分析のキャッシュ ----
export async function getSetCache(key) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(`SELECT * FROM set_analysis_cache WHERE key=$1`, [key]);
    return rows[0] || null;
  } catch {
    return null;
  }
}
export async function saveSetCache(key, fingerprint, result) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO set_analysis_cache (key, fingerprint, result, updated_at)
       VALUES ($1,$2,$3,now())
       ON CONFLICT (key) DO UPDATE SET fingerprint=$2, result=$3, updated_at=now()`,
      [key, fingerprint, JSON.stringify(result)]
    );
  } catch (e) {
    console.error("[db] saveSetCache", e.message);
  }
}

// ---- ユーザー別の設定（動作設定・登録リンク・御礼メール例文など） ----
export async function getUserSettings(owner) {
  if (!owner) return {};
  if (!pool) return { ...(memUserSettings[owner] || {}) };
  try {
    const { rows } = await pool.query(`SELECT data FROM user_settings WHERE owner=$1`, [owner]);
    return rows[0]?.data || {};
  } catch {
    return {};
  }
}
const memUserSettings = {};
export async function saveUserSettings(owner, obj) {
  if (!owner) return { persisted: false };
  memUserSettings[owner] = { ...(memUserSettings[owner] || {}), ...obj };
  if (!pool) return { persisted: false };
  try {
    await pool.query(
      `INSERT INTO user_settings (owner, data) VALUES ($1, $2)
       ON CONFLICT (owner) DO UPDATE SET data = user_settings.data || $2`,
      [owner, JSON.stringify(obj)]
    );
    return { persisted: true };
  } catch (e) {
    console.error("[db] saveUserSettings", e.message);
    return { persisted: false };
  }
}

// ---- Salesforce 連携トークン ----
export async function saveSalesforceToken(owner, { refreshToken, instanceUrl, sfUser }) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO salesforce_accounts (owner, refresh_token, instance_url, sf_user, updated_at)
       VALUES ($1,$2,$3,$4,now())
       ON CONFLICT (owner) DO UPDATE SET
         refresh_token = COALESCE($2, salesforce_accounts.refresh_token),
         instance_url  = COALESCE($3, salesforce_accounts.instance_url),
         sf_user       = COALESCE($4, salesforce_accounts.sf_user),
         updated_at    = now()`,
      [owner, refreshToken || null, instanceUrl || null, sfUser || null]
    );
  } catch (e) {
    console.error("[db] saveSalesforceToken", e.message);
  }
}
export async function getSalesforceToken(owner) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(`SELECT * FROM salesforce_accounts WHERE owner=$1`, [owner]);
    return rows[0] || null;
  } catch {
    return null;
  }
}
export async function deleteSalesforceToken(owner) {
  if (!pool) return;
  try {
    await pool.query(`DELETE FROM salesforce_accounts WHERE owner=$1`, [owner]);
  } catch (e) {
    console.error("[db] deleteSalesforceToken", e.message);
  }
}

// 商談に紐づくSalesforce商談URLを保存
export async function setMeetingSfUrl(botId, url) {
  if (!pool) return;
  try {
    await pool.query(`UPDATE meetings SET sf_url=$2, updated_at=now() WHERE bot_id=$1`, [botId, url || null]);
  } catch (e) {
    console.error("[db] setMeetingSfUrl", e.message);
  }
}

// ---- 自社ナレッジ（チーム共有） ----
export async function listKnowledge() {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT id, category, title, body, owner, source_type, source_ref, COALESCE(folder,'') AS folder, created_at FROM knowledge ORDER BY folder, category, id`
    );
    return rows;
  } catch {
    return [];
  }
}
export async function addKnowledge({ category, title, body, owner, sourceType, sourceRef, folder }) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO knowledge (category, title, body, owner, source_type, source_ref, folder) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [category || "その他", title || "", body || "", owner || "", sourceType || "text", sourceRef || "", folder || ""]
    );
    return rows[0]?.id || null;
  } catch (e) {
    console.error("[db] addKnowledge", e.message);
    return null;
  }
}
export async function updateKnowledge(id, { category, title, body, folder }) {
  if (!pool) return;
  try {
    // 渡された項目だけ更新（folderのみの移動も可能に）
    const sets = [];
    const vals = [id];
    if (category !== undefined) { vals.push(category); sets.push(`category=$${vals.length}`); }
    if (title !== undefined) { vals.push(title); sets.push(`title=$${vals.length}`); }
    if (body !== undefined) { vals.push(body); sets.push(`body=$${vals.length}`); }
    if (folder !== undefined) { vals.push(folder || ""); sets.push(`folder=$${vals.length}`); }
    if (!sets.length) return;
    await pool.query(`UPDATE knowledge SET ${sets.join(", ")} WHERE id=$1`, vals);
  } catch (e) {
    console.error("[db] updateKnowledge", e.message);
  }
}

// ---- ナレッジのフォルダ ----
export async function listKbFolders() {
  if (!pool) return [];
  try {
    const a = await pool.query(`SELECT path FROM kb_folders`);
    const b = await pool.query(`SELECT DISTINCT COALESCE(folder,'') AS path FROM knowledge WHERE COALESCE(folder,'') <> ''`);
    const set = new Set();
    for (const r of [...a.rows, ...b.rows]) {
      // 中間パスも全て登録（例 "競合/B社" → "競合" も）
      const parts = String(r.path).split("/").filter(Boolean);
      let acc = "";
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p;
        set.add(acc);
      }
    }
    return [...set].sort();
  } catch {
    return [];
  }
}
export async function addKbFolder(path) {
  if (!pool || !path) return;
  try {
    await pool.query(`INSERT INTO kb_folders (path) VALUES ($1) ON CONFLICT (path) DO NOTHING`, [path]);
  } catch (e) {
    console.error("[db] addKbFolder", e.message);
  }
}
export async function deleteKbFolder(path) {
  if (!pool || !path) return { ok: false, reason: "no path" };
  try {
    // 配下に資料/サブフォルダがあれば削除しない（安全）
    const items = await pool.query(
      `SELECT COUNT(*)::int AS n FROM knowledge WHERE COALESCE(folder,'')=$1 OR COALESCE(folder,'') LIKE $2`,
      [path, path + "/%"]
    );
    const subs = await pool.query(`SELECT COUNT(*)::int AS n FROM kb_folders WHERE path LIKE $1`, [path + "/%"]);
    if ((items.rows[0]?.n || 0) > 0 || (subs.rows[0]?.n || 0) > 0) {
      return { ok: false, reason: "not_empty" };
    }
    await pool.query(`DELETE FROM kb_folders WHERE path=$1`, [path]);
    return { ok: true };
  } catch (e) {
    console.error("[db] deleteKbFolder", e.message);
    return { ok: false, reason: e.message };
  }
}
export async function deleteKnowledge(id) {
  if (!pool) return;
  try {
    await pool.query(`DELETE FROM knowledge WHERE id=$1`, [id]);
  } catch (e) {
    console.error("[db] deleteKnowledge", e.message);
  }
}
// プロンプトに差し込む自社ナレッジ文脈（文字数上限つき）
export async function getKnowledgeContext(maxChars = 6000) {
  if (!pool) return "";
  try {
    const { rows } = await pool.query(
      `SELECT category, title, body FROM knowledge ORDER BY category, id`
    );
    if (!rows.length) return "";
    let out = "";
    for (const r of rows) {
      const line = `[${r.category || "その他"}] ${r.title || ""}: ${(r.body || "").replace(/\s+/g, " ").trim()}\n`;
      if (out.length + line.length > maxChars) break;
      out += line;
    }
    return out.trim();
  } catch {
    return "";
  }
}

// ---- ナレッジのチャンク（RAG用） ----
export async function replaceKnowledgeChunks(knowledgeId, chunks) {
  if (!pool) return;
  try {
    await pool.query(`DELETE FROM knowledge_chunks WHERE knowledge_id=$1`, [knowledgeId]);
    let i = 0;
    for (const c of chunks) {
      await pool.query(
        `INSERT INTO knowledge_chunks (knowledge_id, chunk_index, title, category, text, embedding)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [knowledgeId, i++, c.title || "", c.category || "", c.text || "", c.embedding ? JSON.stringify(c.embedding) : null]
      );
    }
  } catch (e) {
    console.error("[db] replaceKnowledgeChunks", e.message);
  }
}
export async function deleteKnowledgeChunks(knowledgeId) {
  if (!pool) return;
  try {
    await pool.query(`DELETE FROM knowledge_chunks WHERE knowledge_id=$1`, [knowledgeId]);
  } catch (e) {
    console.error("[db] deleteKnowledgeChunks", e.message);
  }
}
// 全チャンク取得（embeddingはJSONパースして返す）
export async function listKnowledgeChunks() {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT id, knowledge_id, title, category, text, embedding FROM knowledge_chunks`
    );
    return rows.map((r) => ({
      id: r.id,
      knowledgeId: r.knowledge_id,
      title: r.title,
      category: r.category,
      text: r.text,
      embedding: r.embedding ? safeParse(r.embedding) : null,
    }));
  } catch {
    return [];
  }
}
function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
export async function countEmbeddedChunks() {
  if (!pool) return 0;
  try {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM knowledge_chunks WHERE embedding IS NOT NULL`);
    return rows[0]?.n || 0;
  } catch {
    return 0;
  }
}

// ===== Feature A: deals / deal_events の操作 =====

// 会社名を正規化（表記ゆれ吸収）してマッチ用キーにする
export function normCompanyKey(name) {
  return String(name || "")
    .replace(/株式会社|（株）|\(株\)|㈱|有限会社|（有）|\(有\)|合同会社|合資会社|一般社団法人|公益社団法人|社会福祉法人|学校法人/g, "")
    .replace(/[\s　]+/g, "")
    .replace(/様$/u, "")
    .trim()
    .toLowerCase();
}

// 会社名から既存dealを探す（正規化キー一致）。無ければ作成。
export async function resolveDeal({ companyName, owner, team, firstMeetingDate }) {
  if (!pool) return null;
  const key = normCompanyKey(companyName);
  if (!key) return null;
  // 既存を全件から正規化一致で探す（件数は多くないため）
  const { rows } = await pool.query(`SELECT * FROM deals`);
  const found = rows.find((d) => normCompanyKey(d.company_name) === key);
  if (found) return found;
  const dealId = "deal_" + key.replace(/[^a-z0-9ぁ-んァ-ヶ一-龠]/gi, "").slice(0, 40) + "_" + Date.now().toString(36);
  const ins = await pool.query(
    `INSERT INTO deals (deal_id, company_name, owner, team, first_meeting_date, status)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [dealId, companyName || "", owner || "", team || "", firstMeetingDate || null, "進行中"]
  );
  return ins.rows[0];
}

// 同じ会社（正規化キーが同一）で複数のdealsレコードができてしまっている場合に統合する。
// 最も新しく更新されたレコードを正として残し、他のレコードのdeal_eventsをそこへ付け替えて、重複レコードは削除する。
export async function mergeDuplicateDeals() {
  if (!pool) return { merged: 0 };
  const { rows } = await pool.query(`SELECT * FROM deals ORDER BY updated_at DESC`);
  const groups = {};
  for (const d of rows) {
    const key = normCompanyKey(d.company_name);
    if (!key) continue;
    (groups[key] = groups[key] || []).push(d);
  }
  let merged = 0;
  for (const key of Object.keys(groups)) {
    const list = groups[key];
    if (list.length < 2) continue;
    const primary = list[0]; // updated_at DESC なので先頭が最新
    for (const dup of list.slice(1)) {
      try {
        await pool.query(`UPDATE deal_events SET deal_id=$1 WHERE deal_id=$2`, [primary.deal_id, dup.deal_id]);
        await pool.query(`DELETE FROM deals WHERE deal_id=$1`, [dup.deal_id]);
        merged++;
      } catch (e) { console.error("[db] mergeDuplicateDeals", e.message); }
    }
  }
  return { merged };
}

// dealのステータス・更新日時を更新
export async function updateDealStatus(dealId, status, autoLoseDeadline) {
  if (!pool || !dealId) return;
  try {
    if (autoLoseDeadline !== undefined) {
      await pool.query(`UPDATE deals SET status=$2, auto_lose_deadline=$3, updated_at=now() WHERE deal_id=$1`, [dealId, status, autoLoseDeadline]);
    } else {
      await pool.query(`UPDATE deals SET status=$2, updated_at=now() WHERE deal_id=$1`, [dealId, status]);
    }
  } catch (e) { console.error("[db] updateDealStatus", e.message); }
}

// 案件名（company_name）を書き換える。会社名抽出ロジックを強化したときに、
// 既存案件を新しい抽出結果で置き換えるバックフィル用。
export async function updateDealCompanyName(dealId, newName) {
  if (!pool || !dealId || !newName) return;
  try {
    await pool.query(`UPDATE deals SET company_name=$2, updated_at=now() WHERE deal_id=$1`, [dealId, newName]);
  } catch (e) { console.error("[db] updateDealCompanyName", e.message); }
}

// ステッパー上で人が進めた進捗を保存する。stage=null で解除（AI判定に戻る）。
export async function setDealManualProgress(dealId, stage, updatedBy) {
  if (!pool || !dealId) return;
  try {
    if (stage == null) {
      await pool.query(`UPDATE deals SET manual_progress=NULL, updated_at=now() WHERE deal_id=$1`, [dealId]);
    } else {
      const payload = { stage: Number(stage), updated_by: updatedBy || "", updated_at: new Date().toISOString() };
      await pool.query(`UPDATE deals SET manual_progress=$2, updated_at=now() WHERE deal_id=$1`, [dealId, JSON.stringify(payload)]);
    }
  } catch (e) { console.error("[db] setDealManualProgress", e.message); }
}

// 「進行中(未設定)」のうち、auto_lose_deadline を過ぎたものを自動で「失注(未定)」に切り替える。
// 戻り値は切り替えた件数。
export async function applyAutoLoseDeadlines(asOf) {
  if (!pool) return 0;
  try {
    const { rowCount } = await pool.query(
      `UPDATE deals SET status='失注(未定)', updated_at=now()
       WHERE status='進行中(未設定)' AND auto_lose_deadline IS NOT NULL AND auto_lose_deadline < $1`,
      [asOf || new Date().toISOString().slice(0, 10)]
    );
    return rowCount || 0;
  } catch (e) { console.error("[db] applyAutoLoseDeadlines", e.message); return 0; }
}

// 同じ商談(bot_id)由来の既存イベントを削除（再抽出時に重複しないように）
export async function deleteDealEventsByBot(botId) {
  if (!pool || !botId) return;
  try { await pool.query(`DELETE FROM deal_events WHERE bot_id=$1`, [botId]); } catch (e) { console.error("[db] deleteDealEventsByBot", e.message); }
}

// 初回商談イベント（deal_events）の指定フィールドを更新する。人が判定を微修正するために使う。
// eventId で1件を対象にする。judgment_month_basis は raw_extraction 側に保存する。
export async function updateDealEventFields(eventId, fields) {
  if (!pool || !eventId) return;
  const sets = [], vals = [eventId];
  let i = 2;
  for (const [k, v] of Object.entries(fields || {})) {
    if (k === "raw_extraction") {
      sets.push(`raw_extraction = COALESCE(raw_extraction, '{}'::jsonb) || $${i}::jsonb`);
      vals.push(JSON.stringify(v));
    } else {
      sets.push(`${k}=$${i}`);
      vals.push(v);
    }
    i++;
  }
  if (!sets.length) return;
  try { await pool.query(`UPDATE deal_events SET ${sets.join(", ")} WHERE id=$1`, vals); }
  catch (e) { console.error("[db] updateDealEventFields", e.message); }
}

// イベントを1件追記
export async function insertDealEvent(ev) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO deal_events
        (deal_id, bot_id, event_date, event_type, meeting_kind, schedule_choice, schedule_choice_detail,
         apply_timing, judgment_month, next_meeting_scheduled, next_meeting_date, result,
         reported_date, apply_date, usage_start_date, confidence, judgment_basis, needs_review, raw_extraction)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING *`,
      [
        ev.deal_id || null, ev.bot_id || null, ev.event_date || null, ev.event_type || null,
        ev.meeting_kind || null, ev.schedule_choice || null, ev.schedule_choice_detail || null,
        ev.apply_timing || null, ev.judgment_month || null,
        ev.next_meeting_scheduled == null ? null : !!ev.next_meeting_scheduled,
        ev.next_meeting_date || null, ev.result || null,
        ev.reported_date || null, ev.apply_date || null, ev.usage_start_date || null,
        ev.confidence || null, ev.judgment_basis || null,
        ev.needs_review == null ? false : !!ev.needs_review,
        ev.raw_extraction ? JSON.stringify(ev.raw_extraction) : null,
      ]
    );
    return rows[0];
  } catch (e) { console.error("[db] insertDealEvent", e.message); return null; }
}

// 案件一覧（フィルタ: owner/team/status/期間）
export async function listDeals({ owner, team, status, from, to } = {}) {
  if (!pool) return [];
  const cond = [], vals = []; let i = 1;
  if (owner) { cond.push(`owner=$${i++}`); vals.push(owner); }
  if (team) { cond.push(`team=$${i++}`); vals.push(team); }
  if (status) { cond.push(`status=$${i++}`); vals.push(status); }
  if (from) { cond.push(`first_meeting_date >= $${i++}`); vals.push(from); }
  if (to) { cond.push(`first_meeting_date <= $${i++}`); vals.push(to); }
  const where = cond.length ? "WHERE " + cond.join(" AND ") : "";
  try {
    const { rows } = await pool.query(`SELECT * FROM deals ${where} ORDER BY updated_at DESC`, vals);
    return rows;
  } catch (e) { console.error("[db] listDeals", e.message); return []; }
}

// 1案件＋その履歴
export async function getDealWithEvents(dealId) {
  if (!pool) return null;
  try {
    const d = await pool.query(`SELECT * FROM deals WHERE deal_id=$1`, [dealId]);
    if (!d.rows.length) return null;
    const ev = await pool.query(`SELECT * FROM deal_events WHERE deal_id=$1 ORDER BY event_date, id`, [dealId]);
    return { ...d.rows[0], events: ev.rows };
  } catch (e) { console.error("[db] getDealWithEvents", e.message); return null; }
}

// イベントログ取得（集計元。フィルタ: from/to/owner/team/kind）
export async function listDealEvents({ from, to, owner, team, kind } = {}) {
  if (!pool) return [];
  const cond = [], vals = []; let i = 1;
  if (from) { cond.push(`e.event_date >= $${i++}`); vals.push(from); }
  if (to) { cond.push(`e.event_date <= $${i++}`); vals.push(to); }
  if (kind) { cond.push(`e.meeting_kind = $${i++}`); vals.push(kind); }
  if (owner) { cond.push(`d.owner = $${i++}`); vals.push(owner); }
  // team は deals.team カラムに依存しない（チーム編集後の反映漏れを防ぐため、
  // 呼び出し側で resolveDisplayName + rep_team_mapping を使ってJS側でフィルタする）
  const where = cond.length ? "WHERE " + cond.join(" AND ") : "";
  try {
    const { rows } = await pool.query(
      `SELECT e.*, d.company_name, d.owner, d.team, d.status AS deal_status, d.auto_lose_deadline,
              m.owner AS meeting_owner,
              COALESCE(NULLIF(m.deal_kind,''), '通常') AS deal_kind
       FROM deal_events e
       LEFT JOIN deals d ON d.deal_id = e.deal_id
       LEFT JOIN meetings m ON m.bot_id = e.bot_id
       ${where} ORDER BY e.event_date, e.id`, vals);
    return rows;
  } catch (e) { console.error("[db] listDealEvents", e.message); return []; }
}

// イベントの手動修正（要確認レコードの上書き→needs_review解除）
export async function updateDealEvent(id, patch) {
  if (!pool || !id) return null;
  const allowed = ["schedule_choice", "schedule_choice_detail", "apply_timing", "judgment_month",
    "next_meeting_scheduled", "next_meeting_date", "result", "reported_date", "apply_date",
    "usage_start_date", "confidence", "judgment_basis", "needs_review", "meeting_kind"];
  const sets = [], vals = [id]; let i = 2;
  for (const k of allowed) {
    if (patch[k] !== undefined) { sets.push(`${k}=$${i++}`); vals.push(patch[k] === "" ? null : patch[k]); }
  }
  if (!sets.length) return null;
  try {
    const { rows } = await pool.query(`UPDATE deal_events SET ${sets.join(", ")} WHERE id=$1 RETURNING *`, vals);
    return rows[0];
  } catch (e) { console.error("[db] updateDealEvent", e.message); return null; }
}

// チーム解決（rep_team_mapping から担当者名→チーム）
export async function teamForRep(repName) {
  if (!pool || !repName) return "";
  try {
    const { rows } = await pool.query(`SELECT team_name FROM rep_team_mapping WHERE rep_name=$1`, [repName]);
    return rows[0]?.team_name || "";
  } catch { return ""; }
}

// ===== OAuth（Claude.aiカスタムコネクタ用） =====
export async function registerOauthClient({ client_id, client_name, redirect_uris }) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES ($1,$2,$3)
     ON CONFLICT (client_id) DO UPDATE SET client_name=$2, redirect_uris=$3`,
    [client_id, client_name || "", JSON.stringify(redirect_uris || [])]
  );
}
export async function getOauthClient(client_id) {
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT * FROM oauth_clients WHERE client_id=$1`, [client_id]);
  return rows[0] || null;
}
export async function saveOauthCode({ code, client_id, redirect_uri, owner, is_admin, code_challenge, expiresInSec = 600 }) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO oauth_codes (code, client_id, redirect_uri, owner, is_admin, code_challenge, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6, now() + interval '1 second' * $7)`,
    [code, client_id, redirect_uri, owner, !!is_admin, code_challenge || null, expiresInSec]
  );
}
export async function consumeOauthCode(code) {
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT * FROM oauth_codes WHERE code=$1 AND expires_at > now()`, [code]);
  if (!rows[0]) return null;
  await pool.query(`DELETE FROM oauth_codes WHERE code=$1`, [code]);
  return rows[0];
}
export async function saveOauthToken({ access_token, refresh_token, client_id, owner, is_admin, expiresInSec = 86400 * 90 }) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO oauth_tokens (access_token, refresh_token, client_id, owner, is_admin, expires_at)
     VALUES ($1,$2,$3,$4,$5, now() + interval '1 second' * $6)`,
    [access_token, refresh_token || null, client_id, owner, !!is_admin, expiresInSec]
  );
}
export async function getOauthToken(access_token) {
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT * FROM oauth_tokens WHERE access_token=$1 AND expires_at > now()`, [access_token]);
  return rows[0] || null;
}
export async function getOauthTokenByRefresh(refresh_token) {
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT * FROM oauth_tokens WHERE refresh_token=$1`, [refresh_token]);
  return rows[0] || null;
}
export async function deleteOauthToken(access_token) {
  if (!pool) return;
  try { await pool.query(`DELETE FROM oauth_tokens WHERE access_token=$1`, [access_token]); } catch {}
}

// ===== スマートリンク（担当者切り替えに追随する共有Zoom URL） =====
export async function createSmartLink({ slug, label, owner, createdBy, eventId, setter, setterEmail, startTime, endTime, apoAt }) {
  if (!pool) return null;
  // 同じカレンダー予定からは1件しか作らない。
  // スキャンが重なっても、二重に登録されないようにする。
  if (eventId) {
    // 同じ予定名・同じ開始時刻のアポが既にあれば、それを使う。
    // 予定を作り直すとIDが変わるため、IDだけでは重複を防げない。
    if (label && startTime) {
      const { rows: same } = await pool.query(
        `SELECT * FROM smart_links
          WHERE label = $1 AND start_time = $2 AND NOT COALESCE(excluded,false)
          ORDER BY created_at ASC LIMIT 1`, [label, startTime]);
      if (same[0]) {
        // 予定のIDが変わっていたら、新しいIDに付け替える
        if (same[0].event_id !== eventId) {
          try { await pool.query(`UPDATE smart_links SET event_id=$2 WHERE slug=$1`, [same[0].slug, eventId]); } catch {}
        }
        return same[0];
      }
    }
    const { rows } = await pool.query(
      `INSERT INTO smart_links (slug, label, current_owner, created_by, event_id, setter, setter_email, start_time, end_time, apo_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (event_id) WHERE event_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [slug, label || "", owner || null, createdBy || "", eventId, setter || null,
       (setterEmail || "").toLowerCase() || null, startTime || null, endTime || null, apoAt || null]
    );
    if (rows[0]) return rows[0];
    // すでにあった場合は、そちらを返す
    const { rows: cur } = await pool.query(`SELECT * FROM smart_links WHERE event_id=$1 LIMIT 1`, [eventId]);
    return cur[0] || null;
  }
  const { rows } = await pool.query(
    `INSERT INTO smart_links (slug, label, current_owner, created_by, event_id, setter, setter_email, start_time, end_time, apo_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [slug, label || "", owner || null, createdBy || "", eventId || null, setter || null,
     (setterEmail || "").toLowerCase() || null, startTime || null, endTime || null, apoAt || null]
  );
  return rows[0];
}

// 招待予定（kinbotが作成したGoogleカレンダー予定）のIDを保存
export async function setSmartLinkInviteEvent(slug, eventId, eventOwner = null) {
  if (!pool || !slug) return null;
  try {
    const { rows } = await pool.query(
      `UPDATE smart_links SET invite_event_id=$2, invite_event_owner=$3, updated_at=now()
        WHERE slug=$1 RETURNING *`,
      [slug, eventId || null, eventOwner || null]);
    return rows[0] || null;
  } catch (e) { console.error("[db] setSmartLinkInviteEvent", e.message); return null; }
}
export async function getSmartLinkByEvent(eventId) {
  if (!pool || !eventId) return null;
  const { rows } = await pool.query(`SELECT * FROM smart_links WHERE event_id=$1`, [eventId]);
  return rows[0] || null;
}
// リマインドに足りないところを、その場で補う。
//   宛先（メール）と、担当セールスを入れられる。
export async function fixApoForReminder(slug, { email, owner } = {}) {
  if (!pool || !slug) return null;
  const sets = [], vals = [slug];
  if (email !== undefined) { vals.push(String(email || "").trim()); sets.push(`client_email = $${vals.length}`); }
  if (owner !== undefined) { vals.push(String(owner || "").trim()); sets.push(`current_owner = $${vals.length}`); }
  if (!sets.length) return null;
  try {
    const { rows } = await pool.query(
      `UPDATE smart_links SET ${sets.join(", ")} WHERE slug = $1
       RETURNING slug, label, client_email, current_owner`, vals);
    return rows[0] || null;
  } catch (e) { console.error("[db] fixApoForReminder", e.message); return null; }
}

// 前日リマインドを送る／送らないを切り替える
export async function setNoReminder(slug, off) {
  if (!pool || !slug) return null;
  try {
    const { rows } = await pool.query(
      `UPDATE smart_links SET no_reminder = $2 WHERE slug = $1
       RETURNING slug, label, no_reminder`, [slug, !!off]);
    return rows[0] || null;
  } catch (e) { console.error("[db] setNoReminder", e.message); return null; }
}

// ===== 更新の記録 =====

// 更新の内容を1件残す（同じ内容が続けて来たら足さない）
export async function logDeploy({ message, commit, build, ok = true }) {
  if (!pool) return null;
  try {
    const msg = String(message || "").split("\n")[0].slice(0, 300);
    if (!msg) return null;
    const { rows: last } = await pool.query(
      `SELECT message FROM deploy_log ORDER BY at DESC LIMIT 1`);
    if (last[0] && last[0].message === msg) return null;
    const { rows } = await pool.query(
      `INSERT INTO deploy_log (message, commit, build, ok) VALUES ($1,$2,$3,$4) RETURNING *`,
      [msg, String(commit || "").slice(0, 40), String(build || "").slice(0, 120), !!ok]);
    return rows[0] || null;
  } catch (e) { console.error("[db] logDeploy", e.message); return null; }
}

// 前の営業日から今までの更新を取る。
// 月曜の朝は、金曜の朝からの3日ぶんをまとめて出す。
export async function deploysSince(hours) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT * FROM deploy_log
        WHERE at > now() - interval '1 hour' * $1
        ORDER BY at`, [Math.max(1, Math.min(240, Number(hours) || 24))]);
    return rows;
  } catch { return []; }
}

// ===== 転送URL =====

// 転送URLを作る（共通URLは、同じ行き先に1本だけ使い回す）
export async function createJumpLink(x = {}) {
  if (!pool) return null;
  const url = String(x.targetUrl || "").trim();
  if (!/^https?:\/\//.test(url)) return null;
  try {
    if (x.shared) {
      const { rows: found } = await pool.query(
        `SELECT * FROM jump_links
          WHERE target_url = $1 AND shared_link = true AND NOT closed
          ORDER BY created_at LIMIT 1`, [url]);
      if (found[0]) return found[0];
    }
    const slug = Math.random().toString(36).slice(2, 10);
    const { rows } = await pool.query(
      `INSERT INTO jump_links (slug, title, target_url, owner, shared_link, company, person, email, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [slug, String(x.title || "日程調整").slice(0, 120), url,
       String(x.owner || "").toLowerCase(), !!x.shared,
       x.company || "", x.person || "", x.email || "", x.createdBy || null]);
    return rows[0] || null;
  } catch (e) { console.error("[db] createJumpLink", e.message); return null; }
}

export async function getJumpLink(slug) {
  if (!pool || !slug) return null;
  try {
    const { rows } = await pool.query(`SELECT * FROM jump_links WHERE slug = $1`, [slug]);
    return rows[0] || null;
  } catch { return null; }
}

export async function listJumpLinks(owner) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT j.*,
              (SELECT count(*) FROM jump_views v WHERE v.link_id = j.id) AS 閲覧,
              (SELECT count(DISTINCT COALESCE(NULLIF(v.viewer_email,''),'-'))
                 FROM jump_views v WHERE v.link_id = j.id) AS 人数
         FROM jump_links j
        WHERE ($1 = '' OR j.owner = $1)
        ORDER BY j.created_at DESC LIMIT 50`, [String(owner || "").toLowerCase()]);
    return rows;
  } catch { return []; }
}

export async function recordJumpView(linkId, { email, name, ua } = {}) {
  if (!pool || !linkId) return null;
  try {
    await pool.query(
      `INSERT INTO jump_views (link_id, viewer_email, viewer_name, ua) VALUES ($1,$2,$3,$4)`,
      [linkId, String(email || "").trim() || null, String(name || "").trim() || null,
       String(ua || "").slice(0, 200)]);
    return true;
  } catch (e) { console.error("[db] recordJumpView", e.message); return null; }
}

export async function listJumpViewers(linkId, limit = 300) {
  if (!pool || !linkId) return [];
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(NULLIF(viewer_email,''), '（名乗りなし）') AS 相手,
              max(viewer_name) AS 名前,
              count(*)::int AS 回数,
              min(at) AS 最初, max(at) AS 最後
         FROM jump_views WHERE link_id = $1
        GROUP BY 1 ORDER BY 最後 DESC LIMIT $2`, [linkId, limit]);
    return rows;
  } catch { return []; }
}

// ===== 日程調整ページ =====

// ページを作る（共通URLは資料と同じく、1つだけ使い回す）
export async function createBookPage(x = {}) {
  if (!pool) return null;
  try {
    if (x.shared) {
      const { rows: found } = await pool.query(
        `SELECT * FROM book_pages
          WHERE owner = $1 AND shared_link = true AND NOT closed
          ORDER BY created_at LIMIT 1`, [String(x.owner || "").toLowerCase()]);
      if (found[0]) return found[0];
    }
    const slug = Math.random().toString(36).slice(2, 10);
    const { rows } = await pool.query(
      `INSERT INTO book_pages
         (slug, title, owner, shared_link, company, person, email, minutes, days_ahead, from_hour, to_hour, note, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [slug, String(x.title || "打ち合わせの日程調整").slice(0, 120),
       String(x.owner || "").toLowerCase(), !!x.shared,
       x.company || "", x.person || "", x.email || "",
       Math.min(180, Math.max(15, Number(x.minutes) || 30)),
       Math.min(60, Math.max(1, Number(x.daysAhead) || 14)),
       Math.min(23, Math.max(0, Number(x.fromHour) ?? 10)),
       Math.min(23, Math.max(1, Number(x.toHour) ?? 19)),
       String(x.note || "").slice(0, 500), x.createdBy || null]);
    return rows[0] || null;
  } catch (e) { console.error("[db] createBookPage", e.message); return null; }
}

export async function getBookPage(slug) {
  if (!pool || !slug) return null;
  try {
    const { rows } = await pool.query(`SELECT * FROM book_pages WHERE slug = $1`, [slug]);
    return rows[0] || null;
  } catch { return null; }
}

export async function listBookPages(owner) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT p.*,
              (SELECT count(*) FROM book_views v WHERE v.page_id = p.id) AS 閲覧,
              (SELECT count(*) FROM book_views v WHERE v.page_id = p.id AND v.booked) AS 予約
         FROM book_pages p
        WHERE ($1 = '' OR p.owner = $1)
        ORDER BY p.created_at DESC LIMIT 50`, [String(owner || "").toLowerCase()]);
    return rows;
  } catch { return []; }
}

// 開かれたことを残す（誰が見たかは、Pardotの差し込みから受け取る）
export async function recordBookView(pageId, { email, name, ua } = {}) {
  if (!pool || !pageId) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO book_views (page_id, viewer_email, viewer_name, ua)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [pageId, String(email || "").trim() || null, String(name || "").trim() || null,
       String(ua || "").slice(0, 200)]);
    return rows[0] || null;
  } catch (e) { console.error("[db] recordBookView", e.message); return null; }
}

// 予約されたことを残す
export async function markBooked(viewId, slotAt) {
  if (!pool || !viewId) return null;
  try {
    await pool.query(`UPDATE book_views SET booked = true, slot_at = $2 WHERE id = $1`,
      [viewId, slotAt || null]);
    return true;
  } catch { return null; }
}

// 誰が見たか・誰が予約したかの一覧
export async function listBookViewers(pageId, limit = 300) {
  if (!pool || !pageId) return [];
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(NULLIF(viewer_email,''), '（名乗りなし）') AS 相手,
              max(viewer_name) AS 名前,
              count(*)::int AS 回数,
              bool_or(booked) AS 予約した,
              max(slot_at) AS 予約日時,
              max(at) AS 最後
         FROM book_views WHERE page_id = $1
        GROUP BY 1 ORDER BY 最後 DESC LIMIT $2`, [pageId, limit]);
    return rows;
  } catch { return []; }
}

// ===== コールリスト =====

// リストを作る
export async function createCallList({ name, owner, note, createdBy }) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO call_lists (name, owner, note, created_by) VALUES ($1,$2,$3,$4) RETURNING *`,
      [String(name || "コールリスト").slice(0, 120), owner || null,
       String(note || "").slice(0, 300), createdBy || null]);
    return rows[0] || null;
  } catch (e) { console.error("[db] createCallList", e.message); return null; }
}

// リストに宛先を足す（何件でもまとめて）
// 架電先が同じかどうかを見分けるためのカギ（リードID・電話・会社名）
function callDedupeKeys(leadId, phone, company) {
  const keys = [];
  const lid = String(leadId || "").trim();
  if (lid) keys.push("lead:" + lid);
  const tel = String(phone || "").replace(/[^\d]/g, "");
  if (tel.length >= 9) keys.push("tel:" + tel);
  const co = String(company || "")
    .replace(/[\s　]/g, "")
    .replace(/(株式会社|（株）|\(株\)|㈱|有限会社|合同会社|一般社団法人|社会福祉法人|学校法人)/g, "")
    .toLowerCase();
  if (co) keys.push("co:" + co);
  return keys;
}

export async function addCallTargets(listId, items = [], { dedupe = false } = {}) {
  if (!pool || !listId || !items.length) return 0;
  try {
    // 重複を外す場合、まだ架電していない既存の架電先をカギにして持っておく。
    // これで、別のメンバーのリストに入っている先と重複しないようにする。
    const seen = new Set();
    if (dedupe) {
      const { rows } = await pool.query(`SELECT lead_id, phone, company FROM call_targets WHERE done = false`);
      for (const r of rows) for (const k of callDedupeKeys(r.lead_id, r.phone, r.company)) seen.add(k);
    }
    let n = 0, sort = 0;
    for (const x0 of items) {
      const x = x0 || {};
      if (dedupe) {
        const keys = callDedupeKeys(x.leadId, x.phone, x.company);
        if (keys.length && keys.some((k) => seen.has(k))) continue;   // 既にある＝重複なので入れない
        for (const k of keys) seen.add(k);                            // このリスト内の重複も外す
      }
      await pool.query(
        `INSERT INTO call_targets
           (list_id, lead_id, company, person, phone, email, industry, area, memo, assigned_to, sort_order, stage, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [listId, x.leadId || null, x.company || "", x.person || "", x.phone || "",
         x.email || "", x.industry || "", x.area || "", x.memo || "",
         String(x.assignedTo || "").toLowerCase() || null, sort,
         x.stage || "", x.status || ""]);
      n++; sort++;
    }
    return n;
  } catch (e) { console.error("[db] addCallTargets", e.message); return 0; }
}

// リストの一覧（残り件数つき）
export async function listCallLists({ owner = "", includeClosed = false, ownerOnly = false } = {}) {
  if (!pool) return [];
  try {
    // ownerOnly=true のときは「そのリストを作った人」だけで絞る。
    // （中身を配られただけの人のカードに、他人のリストが出てしまうのを防ぐ）
    // ownerOnly=true でも「自分に配られたぶんがあるリスト」は出す。
    // （リストを作った人は別でも、分配された人のカードに出したいため）
    const scope = `($1 = '' OR l.owner = $1 OR EXISTS (
             SELECT 1 FROM call_targets t WHERE t.list_id = l.id AND t.assigned_to = $1))`;
    const { rows } = await pool.query(
      `SELECT l.*,
              (SELECT count(*) FROM call_targets t WHERE t.list_id = l.id) AS 全部,
              (SELECT count(*) FROM call_targets t WHERE t.list_id = l.id AND t.done) AS 済み,
              (SELECT count(*) FROM call_targets t WHERE t.list_id = l.id AND t.assigned_to = $1) AS 自分のぶん
         FROM call_lists l
        WHERE ${scope}
          AND ($2 OR NOT l.closed)
        ORDER BY l.created_at DESC LIMIT 50`,
      [String(owner || "").toLowerCase(), !!includeClosed]);
    return rows;
  } catch (e) { console.error("[db] listCallLists", e.message); return []; }
}

// リストの中身を、かける人へ配る。
//   均等に配る（人数で割る）／まとめて一人に渡す、の両方ができる。
export async function assignCallTargets(listId, emails = [], { onlyUnassigned = true } = {}) {
  if (!pool || !listId) return 0;
  const who = emails.map((x) => String(x || "").toLowerCase()).filter(Boolean);
  if (!who.length) return 0;
  try {
    // まだ済んでいないものを、順番に並べて取る
    const { rows } = await pool.query(
      `SELECT id FROM call_targets
        WHERE list_id = $1 AND NOT done
          ${onlyUnassigned ? "AND assigned_to IS NULL" : ""}
        ORDER BY sort_order, id`, [listId]);
    let n = 0;
    for (let i = 0; i < rows.length; i++) {
      // 上から順に、かける人を代わりばんこに割り当てる
      await pool.query(`UPDATE call_targets SET assigned_to = $2 WHERE id = $1`,
        [rows[i].id, who[i % who.length]]);
      n++;
    }
    return n;
  } catch (e) { console.error("[db] assignCallTargets", e.message); return 0; }
}

// リストの中身を、条件に当てはまるものだけ消す。
//   ステージ・最終ステータス・履歴の有無で選べる。
export async function deleteCallTargets(listId, { stages = [], statuses = [], hist = "" } = {}) {
  if (!pool || !listId) return 0;
  try {
    const p = [listId];
    const w = ["list_id = $1"];
    if (stages.length) { p.push(stages); w.push(`COALESCE(stage,'') = ANY($${p.length}::text[])`); }
    if (statuses.length) { p.push(statuses); w.push(`COALESCE(status,'') = ANY($${p.length}::text[])`); }
    if (hist === "none") w.push(`NOT EXISTS (SELECT 1 FROM call_logs l WHERE l.target_id = call_targets.id)`);
    if (hist === "some") w.push(`EXISTS (SELECT 1 FROM call_logs l WHERE l.target_id = call_targets.id)`);
    const { rowCount } = await pool.query(
      `DELETE FROM call_targets WHERE ${w.join(" AND ")}`, p);
    return rowCount || 0;
  } catch (e) { console.error("[db] deleteCallTargets", e.message); return 0; }
}

// 消す前に、何件消えるかを数える
export async function countCallTargets(listId, { stages = [], statuses = [], hist = "" } = {}) {
  if (!pool || !listId) return 0;
  try {
    const p = [listId];
    const w = ["list_id = $1"];
    if (stages.length) { p.push(stages); w.push(`COALESCE(stage,'') = ANY($${p.length}::text[])`); }
    if (statuses.length) { p.push(statuses); w.push(`COALESCE(status,'') = ANY($${p.length}::text[])`); }
    if (hist === "none") w.push(`NOT EXISTS (SELECT 1 FROM call_logs l WHERE l.target_id = call_targets.id)`);
    if (hist === "some") w.push(`EXISTS (SELECT 1 FROM call_logs l WHERE l.target_id = call_targets.id)`);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM call_targets WHERE ${w.join(" AND ")}`, p);
    return rows[0] ? rows[0].n : 0;
  } catch { return 0; }
}

// リストそのものを消す（中身もまとめて消える）
export async function deleteCallList(listId) {
  if (!pool || !listId) return false;
  try {
    await pool.query(`DELETE FROM call_lists WHERE id = $1`, [listId]);
    return true;
  } catch (e) { console.error("[db] deleteCallList", e.message); return false; }
}

// リストの中身にある、ステージと最終ステータスの種類を数える
export async function callListFacets(listId) {
  if (!pool || !listId) return { stages: [], statuses: [] };
  try {
    const a = await pool.query(
      `SELECT COALESCE(stage,'') AS v, count(*)::int AS n FROM call_targets
        WHERE list_id = $1 GROUP BY 1 ORDER BY 1`, [listId]);
    const b = await pool.query(
      `SELECT COALESCE(status,'') AS v, count(*)::int AS n FROM call_targets
        WHERE list_id = $1 GROUP BY 1 ORDER BY 1`, [listId]);
    return { stages: a.rows, statuses: b.rows };
  } catch { return { stages: [], statuses: [] }; }
}

// 誰に何件配ったか
export async function callAssignCounts(listId) {
  if (!pool || !listId) return [];
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(assigned_to, '') AS 誰,
              count(*)::int AS 全部,
              count(*) FILTER (WHERE done)::int AS 済み
         FROM call_targets WHERE list_id = $1
        GROUP BY 1 ORDER BY 1`, [listId]);
    return rows;
  } catch { return []; }
}

// 配ったものを全部戻す
export async function clearCallAssign(listId) {
  if (!pool || !listId) return 0;
  try {
    const { rowCount } = await pool.query(
      `UPDATE call_targets SET assigned_to = NULL WHERE list_id = $1 AND NOT done`, [listId]);
    return rowCount || 0;
  } catch { return 0; }
}

// リストの中身を、表として全部返す（SFのリードレポートのような見た目にする）
export async function listCallTargets(listId, { q = "", limit = 500 } = {}) {
  if (!pool || !listId) return [];
  try {
    const p = [listId];
    let where = `t.list_id = $1`;
    if (q) {
      p.push(`%${String(q).replace(/[%_]/g, "")}%`);
      where += ` AND (t.company ILIKE $${p.length} OR t.person ILIKE $${p.length}
                      OR t.phone ILIKE $${p.length} OR t.email ILIKE $${p.length})`;
    }
    p.push(Math.max(1, Math.min(2000, limit)));
    const { rows } = await pool.query(
      `SELECT t.*,
              (SELECT count(*) FROM call_logs l WHERE l.target_id = t.id) AS 履歴数,
              -- Salesforceへまだ送れていないもの（履歴に出すぶん）
              (SELECT count(*) FROM call_logs l
                WHERE l.target_id = t.id AND l.sf_task_id IS NULL) AS 未送信数,
              (SELECT l.result FROM call_logs l WHERE l.target_id = t.id
                ORDER BY l.at DESC LIMIT 1) AS 最終結果,
              (SELECT l.at FROM call_logs l WHERE l.target_id = t.id
                ORDER BY l.at DESC LIMIT 1) AS 最終日時
         FROM call_targets t
        WHERE ${where}
        ORDER BY t.done, t.sort_order, t.id
        LIMIT $${p.length}`, p);
    return rows;
  } catch (e) { console.error("[db] listCallTargets", e.message); return []; }
}

// 1件ぶんの情報（記録のモーダルで使う）
export async function getCallTarget(id) {
  if (!pool || !id) return null;
  try {
    const { rows } = await pool.query(`SELECT * FROM call_targets WHERE id = $1`, [id]);
    return rows[0] || null;
  } catch { return null; }
}

// ステージ・最終ステータスを書き換える
export async function setCallTargetStatus(id, { stage, status } = {}) {
  if (!pool || !id) return null;
  const sets = [], vals = [id];
  if (stage !== undefined) { vals.push(String(stage || "").slice(0, 60)); sets.push(`stage = $${vals.length}`); }
  if (status !== undefined) { vals.push(String(status || "").slice(0, 120)); sets.push(`status = $${vals.length}`); }
  if (!sets.length) return null;
  try {
    const { rows } = await pool.query(
      `UPDATE call_targets SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, vals);
    return rows[0] || null;
  } catch (e) { console.error("[db] setCallTargetStatus", e.message); return null; }
}

// 会社名・担当者名・電話番号・メールアドレスを書き換える（編集モーダル用）
export async function updateCallTargetFields(id, { company, person, phone, email } = {}) {
  if (!pool || !id) return null;
  const sets = [], vals = [id];
  if (company !== undefined) { vals.push(String(company || "").slice(0, 200)); sets.push(`company = $${vals.length}`); }
  if (person  !== undefined) { vals.push(String(person  || "").slice(0, 120)); sets.push(`person = $${vals.length}`); }
  if (phone   !== undefined) { vals.push(String(phone   || "").slice(0, 60));  sets.push(`phone = $${vals.length}`); }
  if (email   !== undefined) { vals.push(String(email   || "").slice(0, 200)); sets.push(`email = $${vals.length}`); }
  if (!sets.length) return null;
  try {
    const { rows } = await pool.query(
      `UPDATE call_targets SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, vals);
    return rows[0] || null;
  } catch (e) { console.error("[db] updateCallTargetFields", e.message); return null; }
}

// 架電したあと、リードの状態を書き戻す
export async function setTargetStatus(targetId, status) {
  if (!pool || !targetId) return null;
  try {
    await pool.query(`UPDATE call_targets SET status = $2 WHERE id = $1`,
      [targetId, String(status || "").slice(0, 80)]);
    return true;
  } catch { return null; }
}

// 次にかける1件を出す（自分に割り当てられたもの／割り当てなしも拾う）
export async function nextCallTarget(listId, caller) {
  if (!pool || !listId) return null;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM call_targets
        WHERE list_id = $1 AND NOT done
          AND (assigned_to IS NULL OR assigned_to = $2)
        ORDER BY sort_order, id LIMIT 1`,
      [listId, String(caller || "").toLowerCase()]);
    return rows[0] || null;
  } catch (e) { console.error("[db] nextCallTarget", e.message); return null; }
}

// その相手に、これまで何をしたか
export async function callHistory(targetId, leadId, limit = 5) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT result, memo, caller, at, sf_task_id FROM call_logs
        WHERE target_id = $1 OR ($2 <> '' AND lead_id = $2)
        ORDER BY at DESC LIMIT $3`,
      [targetId || 0, String(leadId || ""), limit]);
    return rows;
  } catch { return []; }
}

// 架電の結果を残す
export async function recordCall({ targetId, leadId, company, result, memo, caller }) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO call_logs (target_id, lead_id, company, result, memo, caller)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [targetId || null, leadId || null, company || "", result,
       String(memo || "").slice(0, 1000), caller || null]);
    // 記録しても「済み」にしない。
    // 同じリストを何度も使い回すので、相手が消えたり並び順が変わったりしないようにする。
    return rows[0] || null;
  } catch (e) { console.error("[db] recordCall", e.message); return null; }
}

// Salesforceへ送れた／送れなかったを記録する
export async function markCallSynced(logId, { taskId, error } = {}) {
  if (!pool || !logId) return null;
  try {
    await pool.query(
      `UPDATE call_logs SET sf_task_id = $2, sf_error = $3 WHERE id = $1`,
      [logId, taskId || null, String(error || "").slice(0, 300) || null]);
    return true;
  } catch { return null; }
}

// まだSalesforceへ送れていないぶん
export async function pendingCallLogs(limit = 50) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT * FROM call_logs
        WHERE sf_task_id IS NULL AND lead_id IS NOT NULL
        ORDER BY at LIMIT $1`, [limit]);
    return rows;
  } catch { return []; }
}

// その日の結果を数える
export async function callStats(dateJst, caller = "") {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT caller, result, count(*)::int AS n
         FROM call_logs
        WHERE (at AT TIME ZONE 'Asia/Tokyo')::date = $1::date
          AND ($2 = '' OR caller = $2)
        GROUP BY caller, result`,
      [dateJst, String(caller || "").toLowerCase()]);
    return rows;
  } catch { return []; }
}

// 期間（日・週・月）で数える。fromJst〜toJst（両端を含む）。
export async function callStatsRange(fromJst, toJst, caller = "") {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT caller, result, count(*)::int AS n
         FROM call_logs
        WHERE (at AT TIME ZONE 'Asia/Tokyo')::date >= $1::date
          AND (at AT TIME ZONE 'Asia/Tokyo')::date <= $2::date
          AND ($3 = '' OR caller = $3)
        GROUP BY caller, result`,
      [fromJst, toJst, String(caller || "").toLowerCase()]);
    return rows;
  } catch { return []; }
}

// ===== Salesforceの更新の記録 =====
export async function recordSfUpdate({ botId, oppId, stage, note, owner }) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO sf_updates (bot_id, opp_id, stage, note, owner)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [botId || null, oppId || null, stage || null, String(note || "").slice(0, 500), owner || null]);
    return rows[0] || null;
  } catch (e) { console.error("[db] recordSfUpdate", e.message); return null; }
}

// 指定した商談たちについて、SFを更新済みかどうかを返す
export async function sfUpdatedMap(botIds = []) {
  if (!pool || !botIds.length) return {};
  try {
    const { rows } = await pool.query(
      `SELECT bot_id, max(at) AS at, max(stage) AS stage
         FROM sf_updates WHERE bot_id = ANY($1::text[]) GROUP BY bot_id`,
      [botIds]);
    const out = {};
    for (const r of rows) out[r.bot_id] = { at: r.at, stage: r.stage || "" };
    return out;
  } catch { return {}; }
}

// ===== 週のボード =====
export async function listWeekly(weekStart) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT * FROM weekly_board WHERE week_start = $1::date ORDER BY member_name, member`,
      [weekStart]);
    return rows;
  } catch (e) { console.error("[db] listWeekly", e.message); return []; }
}

export async function saveWeekly({ weekStart, member, memberName, theme, targets, actions, review, items, updatedBy }) {
  if (!pool || !weekStart || !member) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO weekly_board (week_start, member, member_name, theme, targets, actions, review, items, updated_by)
       VALUES ($1::date,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
       ON CONFLICT (week_start, member) DO UPDATE SET
         member_name = COALESCE(EXCLUDED.member_name, weekly_board.member_name),
         theme   = COALESCE(EXCLUDED.theme,   weekly_board.theme),
         targets = COALESCE(EXCLUDED.targets, weekly_board.targets),
         actions = COALESCE(EXCLUDED.actions, weekly_board.actions),
         review  = COALESCE(EXCLUDED.review,  weekly_board.review),
         items   = COALESCE(EXCLUDED.items,   weekly_board.items),
         updated_by = EXCLUDED.updated_by,
         updated_at = now()
       RETURNING *`,
      [weekStart, String(member).toLowerCase(), memberName || null,
       theme ?? null, targets ?? null, actions ?? null, review ?? null,
       items === undefined ? null : JSON.stringify(items || []), updatedBy || null]);
    return rows[0] || null;
  } catch (e) { console.error("[db] saveWeekly", e.message); return null; }
}

// 前の週の内容（次の週を書くときの参考に出す）
export async function weeklyFor(weekStart, member) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM weekly_board WHERE week_start = $1::date AND member = $2`,
      [weekStart, String(member).toLowerCase()]);
    return rows[0] || null;
  } catch { return null; }
}

// ===== 開発メモ =====
// 同じ内容は1件にまとめ、回数だけ増やす（同じエラーが並ばないように）
export async function addDevNote({ key, kind = "request", title, detail = "", source = "", createdBy = "" }) {
  if (!pool || !title) return null;
  const k = String(key || `${kind}:${title}`).slice(0, 200);
  try {
    const { rows } = await pool.query(
      `INSERT INTO dev_notes (dedupe_key, kind, title, detail, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (dedupe_key) DO UPDATE
         SET hits = dev_notes.hits + 1,
             last_at = now(),
             detail = CASE WHEN dev_notes.detail IS NULL OR dev_notes.detail = ''
                           THEN EXCLUDED.detail ELSE dev_notes.detail END,
             status = CASE WHEN dev_notes.status = 'done' THEN 'new' ELSE dev_notes.status END
       RETURNING *`,
      [k, kind, String(title).slice(0, 300), String(detail || "").slice(0, 4000),
       String(source || "").slice(0, 80), String(createdBy || "").slice(0, 120)]);
    return rows[0] || null;
  } catch (e) { console.error("[db] addDevNote", e.message); return null; }
}

export async function listDevNotes({ status = "", limit = 200 } = {}) {
  if (!pool) return [];
  try {
    const p = [];
    let where = "1=1";
    if (status) { p.push(status); where += ` AND status = $${p.length}`; }
    p.push(Math.max(1, Math.min(500, limit)));
    const { rows } = await pool.query(
      `SELECT * FROM dev_notes WHERE ${where}
        ORDER BY (status='new') DESC, hits DESC, last_at DESC LIMIT $${p.length}`, p);
    return rows;
  } catch (e) { console.error("[db] listDevNotes", e.message); return []; }
}

export async function updateDevNote(id, patch = {}) {
  if (!pool || !id) return null;
  const cols = [], vals = [];
  for (const [k, col] of Object.entries({ status: "status", title: "title", detail: "detail", kind: "kind" })) {
    if (patch[k] !== undefined) { vals.push(patch[k]); cols.push(`${col} = $${vals.length}`); }
  }
  if (!cols.length) return null;
  vals.push(id);
  try {
    const { rows } = await pool.query(
      `UPDATE dev_notes SET ${cols.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals);
    return rows[0] || null;
  } catch (e) { console.error("[db] updateDevNote", e.message); return null; }
}

// 見送る＝一覧から消す。ただし題名は覚えておく（同じ案がまた出ないように）。
export async function dismissDevNote(id) {
  if (!pool || !id) return 0;
  try {
    const { rows } = await pool.query(`SELECT * FROM dev_notes WHERE id = $1`, [id]);
    const r = rows[0];
    if (!r) return 0;
    await pool.query(
      `INSERT INTO dev_dismissed (title, detail, kind, source) VALUES ($1,$2,$3,$4)`,
      [r.title, String(r.detail || "").slice(0, 500), r.kind, r.source]);
    await pool.query(`DELETE FROM dev_notes WHERE id = $1`, [id]);
    // 覚えておくのは新しい500件まで（増え続けないように）
    await pool.query(
      `DELETE FROM dev_dismissed WHERE id NOT IN (
         SELECT id FROM dev_dismissed ORDER BY at DESC LIMIT 500)`);
    return 1;
  } catch (e) { console.error("[db] dismissDevNote", e.message); return 0; }
}

// 見送った案の題名（似ているかを調べるために使う）
export async function listDismissed(limit = 500) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT title, detail FROM dev_dismissed ORDER BY at DESC LIMIT $1`, [limit]);
    return rows;
  } catch { return []; }
}

export async function deleteDevNote(id) {
  if (!pool || !id) return 0;
  try {
    const { rowCount } = await pool.query(`DELETE FROM dev_notes WHERE id = $1`, [id]);
    return rowCount;
  } catch { return 0; }
}

// ===== カレンダーで気づいたこと =====
// 同じ予定で何度も通知しないよう、1回目だけ true を返す
export async function noticeOnce(eventId, kind, title = "") {
  if (!pool || !eventId || !kind) return false;
  try {
    const { rowCount } = await pool.query(
      `INSERT INTO calendar_notice (event_id, kind, title) VALUES ($1,$2,$3)
       ON CONFLICT (event_id, kind) DO NOTHING`,
      [String(eventId), String(kind), String(title || "").slice(0, 200)]);
    return rowCount > 0;
  } catch (e) { console.error("[db] noticeOnce", e.message); return false; }
}

// これから先のアポ（カレンダーと突き合わせて、消えたものを見つけるため）
export async function futureApos(fromJst, limit = 500) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT slug, label, setter, setter_email, current_owner, event_id, start_time, business
         FROM smart_links
        WHERE event_id IS NOT NULL
          AND NOT COALESCE(excluded,false)
          AND (start_time AT TIME ZONE 'Asia/Tokyo')::date >= $1::date
        ORDER BY start_time
        LIMIT $2`, [fromJst, limit]);
    return rows;
  } catch (e) { console.error("[db] futureApos", e.message); return []; }
}

// アポを数から外す（テスト・リスケ・キャンセル・カレンダーから消えたとき）
export async function excludeApo(slug, reason = "") {
  if (!pool || !slug) return null;
  try {
    const { rows } = await pool.query(
      `UPDATE smart_links SET excluded = true, updated_at = now()
        WHERE slug = $1 RETURNING slug, label, setter, current_owner, start_time`, [slug]);
    if (rows[0]) console.log(`[apo] 数から外しました ${rows[0].label || slug}（${reason}）`);
    return rows[0] || null;
  } catch (e) { console.error("[db] excludeApo", e.message); return null; }
}

// ===== ライブ中継の宛先 =====
export async function saveLiveRelay(token, dest, botId = "") {
  if (!pool || !token || !dest) return null;
  try {
    await pool.query(
      `INSERT INTO live_relay (token, dest, bot_id) VALUES ($1,$2,$3)
       ON CONFLICT (token) DO UPDATE SET dest = EXCLUDED.dest, bot_id = EXCLUDED.bot_id`,
      [token, dest, botId || null]);
    // 古いものは片付ける（2日）
    await pool.query(`DELETE FROM live_relay WHERE created_at < now() - interval '2 days'`);
    return true;
  } catch (e) { console.error("[db] saveLiveRelay", e.message); return null; }
}

export async function getLiveRelay(token) {
  if (!pool || !token) return null;
  try {
    const { rows } = await pool.query(`SELECT * FROM live_relay WHERE token = $1`, [token]);
    return rows[0] || null;
  } catch { return null; }
}

export async function countLiveRelay() {
  if (!pool) return 0;
  try {
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM live_relay`);
    return rows[0] ? rows[0].n : 0;
  } catch { return 0; }
}

// ===== カレンダー監視（プッシュ通知）の記録 =====
export async function listCalendarWatches() {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT * FROM calendar_watch ORDER BY calendar_id`);
    return rows;
  } catch { return []; }
}

export async function saveCalendarWatch({ channelId, resourceId, calendarId, tokenOwner, expiresAt }) {
  if (!pool || !channelId) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO calendar_watch (channel_id, resource_id, calendar_id, token_owner, expires_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (channel_id) DO UPDATE
         SET resource_id = EXCLUDED.resource_id, calendar_id = EXCLUDED.calendar_id,
             token_owner = EXCLUDED.token_owner, expires_at = EXCLUDED.expires_at
       RETURNING *`,
      [channelId, resourceId || null, calendarId || null, tokenOwner || null, expiresAt || null]);
    return rows[0] || null;
  } catch (e) { console.error("[db] saveCalendarWatch", e.message); return null; }
}

export async function deleteCalendarWatch(channelId) {
  if (!pool || !channelId) return 0;
  try {
    const { rowCount } = await pool.query(`DELETE FROM calendar_watch WHERE channel_id = $1`, [channelId]);
    return rowCount;
  } catch { return 0; }
}

export async function getCalendarWatch(channelId) {
  if (!pool || !channelId) return null;
  try {
    const { rows } = await pool.query(`SELECT * FROM calendar_watch WHERE channel_id = $1`, [channelId]);
    return rows[0] || null;
  } catch { return null; }
}

// 予定名＋開始時刻が同じアポを探す。
// 予定を作り直すと予定IDが変わるので、「同じ商談か」を見分けるのに使う。
export async function findSmartLinkByLabelStart(label, startTime) {
  if (!pool || !label || !startTime) return null;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM smart_links
        WHERE label = $1 AND start_time = $2 AND NOT COALESCE(excluded,false)
        ORDER BY created_at ASC LIMIT 1`, [label, startTime]);
    return rows[0] || null;
  } catch { return null; }
}

export async function getSmartLink(slug) {
  if (!pool) return null;
  const { rows } = await pool.query(`SELECT * FROM smart_links WHERE slug=$1`, [slug]);
  return rows[0] || null;
}
export async function listSmartLinks(createdBy) {
  if (!pool) return [];
  try {
    const { rows } = createdBy
      ? await pool.query(`SELECT * FROM smart_links WHERE created_by=$1 ORDER BY updated_at DESC`, [createdBy])
      : await pool.query(`SELECT * FROM smart_links ORDER BY updated_at DESC`);
    return rows;
  } catch { return []; }
}
export async function setSmartLinkOwner(slug, owner) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `UPDATE smart_links SET current_owner=$2, updated_at=now() WHERE slug=$1 RETURNING *`,
    [slug, owner || null]
  );
  return rows[0] || null;
}
export async function deleteSmartLink(slug) {
  if (!pool) return;
  try { await pool.query(`DELETE FROM smart_links WHERE slug=$1`, [slug]); } catch {}
}

// ===== アポメール自動送付 =====
// お客様の宛先を保存する。force=false のときは、既に入っている値を上書きしない
// （手入力で直したアドレスを、あとからカレンダーの自動取得で戻さないため）。
export async function setSmartLinkClient(slug, { email, name, source } = {}, force = true) {
  if (!pool || !slug) return null;
  try {
    const addr = String(email || "").trim().toLowerCase();
    const { rows } = await pool.query(
      `UPDATE smart_links
          SET client_email        = CASE WHEN $4 OR COALESCE(client_email,'')='' THEN $2 ELSE client_email END,
              client_name         = CASE WHEN $4 OR COALESCE(client_name,'')=''  THEN $3 ELSE client_name  END,
              client_email_source = CASE WHEN $4 OR COALESCE(client_email,'')='' THEN $5 ELSE client_email_source END,
              updated_at = now()
        WHERE slug=$1 RETURNING *`,
      [slug, addr || null, String(name || "").trim() || null, force, String(source || "") || null]
    );
    return rows[0] || null;
  } catch (e) { console.error("[db] setSmartLinkClient", e.message); return null; }
}

// 送信済みかどうか（status='sent' の行があるか）
// このアポの事業（DOC / MOCHICA）を保存する
// 元の予定の説明欄を保存する（すでに入っていれば上書きしない＝手で直した内容を守る）
// 直近に商談予定を作った（または作り直した）アポの一覧。取り消し画面で使う。
// 自分へ割り振られているアポ（ホーム画面用）。
// mode="day"（既定） … その日のぶんだけ
// mode="from"        … その日以降ぜんぶ
// 自分のアポ。
//   ・自分に割り振られたもの（担当者が自分）
//   ・自分で取ったもの（アポ獲得者が自分）
// 自分で取ったアポは、担当が入る前でも自分の予定なので、一覧に出す。
// 名前は表記ゆれ（「田中 欽也」と「田中欽也」）を無視して比べる。
export async function myAssignedApos(owner, dateJst, mode = "day", limit = 200, setterName = "") {
  if (!pool || !owner) return [];
  try {
    // 「自分のアポ」は、その日に“取った”アポを並べる（商談日ではない）。
    // 何件取れたかを見る場所なので、日付はアポを取った日で数える。
    const day = `(COALESCE(apo_at, created_at) AT TIME ZONE 'Asia/Tokyo')::date`;
    const cond = mode === "day" ? `${day} = $2::date` : `${day} >= $2::date`;
    const nm = String(setterName || "").replace(/[\s　]/g, "");
    const { rows } = await pool.query(
      `SELECT *,
              (lower(COALESCE(setter_email,'')) = $1
                OR ($4 <> '' AND regexp_replace(COALESCE(setter,''), '[[:space:]　]', '', 'g') = $4)
              ) AS self_got
         FROM smart_links
        WHERE ${cond}
          AND NOT COALESCE(excluded, false)
          AND (
            lower(COALESCE(current_owner,'')) = $1
            OR lower(COALESCE(setter_email,'')) = $1
            OR ($4 <> '' AND regexp_replace(COALESCE(setter,''), '[[:space:]　]', '', 'g') = $4)
          )
        ORDER BY COALESCE(apo_at, created_at) DESC, start_time
        LIMIT $3`,
      [String(owner).toLowerCase(), dateJst, Math.max(1, Math.min(500, limit)), nm]);
    return rows;
  } catch (e) { console.error("[db] myAssignedApos", e.message); return []; }
}

// 期間のアポを、担当者や獲得者で絞らずに集める（チーム全体の質問に答えるため）。
// business を渡すと、その事業だけにできる。
export async function aposInRange({ from, to, business = "", limit = 500 } = {}) {
  if (!pool) return [];
  try {
    const p = [from, to || from];
    let where = `(start_time AT TIME ZONE 'Asia/Tokyo')::date BETWEEN $1::date AND $2::date
                 AND NOT COALESCE(excluded,false)`;
    if (business) { p.push(business); where += ` AND business = $${p.length}`; }
    p.push(Math.max(1, Math.min(1000, limit)));
    const { rows } = await pool.query(
      `SELECT slug, label, setter, setter_email, current_owner, business,
              start_time, apo_at, created_at, client_email, invite_event_id
         FROM smart_links
        WHERE ${where}
        ORDER BY start_time
        LIMIT $${p.length}`, p);
    return rows;
  } catch (e) { console.error("[db] aposInRange", e.message); return []; }
}

// アポを「取った日」で集める（実績の質問に答えるため）
export async function aposTakenInRange({ from, to, business = "", limit = 1000 } = {}) {
  if (!pool) return [];
  try {
    const p = [from, to || from];
    let where = `(COALESCE(apo_at, created_at) AT TIME ZONE 'Asia/Tokyo')::date BETWEEN $1::date AND $2::date
                 AND NOT COALESCE(excluded,false)`;
    if (business) { p.push(business); where += ` AND business = $${p.length}`; }
    p.push(Math.max(1, Math.min(2000, limit)));
    const { rows } = await pool.query(
      `SELECT slug, label, setter, current_owner, business, start_time,
              COALESCE(apo_at, created_at) AS taken_at
         FROM smart_links
        WHERE ${where}
        ORDER BY taken_at
        LIMIT $${p.length}`, p);
    return rows;
  } catch (e) { console.error("[db] aposTakenInRange", e.message); return []; }
}

export async function recentInvites(hours = 24) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT slug, label, setter, current_owner, start_time, business,
              invite_event_id, invite_event_owner, updated_at
         FROM smart_links
        WHERE COALESCE(invite_event_id,'') <> ''
          AND updated_at >= now() - ($1 || ' hours')::interval
        ORDER BY updated_at DESC
        LIMIT 200`, [String(Math.max(1, Math.min(720, hours)))]);
    return rows;
  } catch (e) { console.error("[db] recentInvites", e.message); return []; }
}

// いま有効な商談予定のID一覧（取り残しの判定に使う）
export async function activeInviteEventIds() {
  if (!pool) return new Set();
  try {
    const { rows } = await pool.query(
      `SELECT invite_event_id FROM smart_links WHERE COALESCE(invite_event_id,'') <> ''`);
    return new Set(rows.map((r) => r.invite_event_id));
  } catch { return new Set(); }
}

// カレンダーから消した予定を、kinbotの管理からも外す（次に作り直されないように）
export async function clearInviteEvent(eventId) {
  if (!pool || !eventId) return 0;
  try {
    const { rowCount } = await pool.query(
      `UPDATE smart_links SET invite_event_id = NULL, invite_event_owner = NULL, updated_at = now()
        WHERE invite_event_id = $1`, [eventId]);
    return rowCount;
  } catch (e) { console.error("[db] clearInviteEvent", e.message); return 0; }
}

export async function setSmartLinkSetterEmail(slug, email) {
  if (!pool || !slug || !email) return null;
  try {
    const { rows } = await pool.query(
      `UPDATE smart_links SET setter_email = $2, updated_at = now()
        WHERE slug = $1 AND COALESCE(setter_email,'') = '' RETURNING *`,
      [slug, String(email).toLowerCase()]);
    return rows[0] || null;
  } catch (e) { console.error("[db] setSmartLinkSetterEmail", e.message); return null; }
}

// kinbotが作った商談予定が付いているアポの一覧。
// 「アポを取った人＝担当者」なら、本人のカレンダーに元の予定があるので、
// kinbotが作った予定は余分（同じ商談が2つ並ぶ）。それを見つけるために使う。
export async function linksWithInvite(limit = 500) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT slug, label, setter, setter_email, current_owner, start_time,
              event_id, invite_event_id, invite_event_owner
         FROM smart_links
        WHERE COALESCE(invite_event_id,'') <> ''
          AND NOT COALESCE(excluded,false)
        ORDER BY start_time DESC NULLS LAST
        LIMIT $1`, [limit]);
    return rows;
  } catch (e) { console.error("[db] linksWithInvite", e.message); return []; }
}

export async function setSmartLinkSourceNote(slug, note, force = false) {
  if (!pool || !slug) return null;
  try {
    const { rows } = await pool.query(
      `UPDATE smart_links
          SET source_note = CASE WHEN $3 OR COALESCE(source_note,'')='' THEN $2 ELSE source_note END,
              updated_at = now()
        WHERE slug=$1 RETURNING *`,
      [slug, String(note || "").slice(0, 4000) || null, force]);
    return rows[0] || null;
  } catch (e) { console.error("[db] setSmartLinkSourceNote", e.message); return null; }
}

export async function setSmartLinkBusiness(slug, business) {
  if (!pool || !slug) return null;
  try {
    const { rows } = await pool.query(
      `UPDATE smart_links SET business=$2, updated_at=now() WHERE slug=$1 RETURNING *`,
      [slug, business || null]);
    return rows[0] || null;
  } catch (e) { console.error("[db] setSmartLinkBusiness", e.message); return null; }
}

// 今日のアポで、確定メールがまだ送れていないものを探す。
// 18時半のお知らせに使う（送り忘れをその日のうちに気づけるように）。
export async function aposMailPending(dateJst, limit = 200) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT s.slug, s.label, s.setter, s.current_owner, s.start_time, s.client_email,
              COALESCE(s.apo_at, s.created_at) AS taken_at
         FROM smart_links s
        WHERE (COALESCE(s.apo_at, s.created_at) AT TIME ZONE 'Asia/Tokyo')::date = $1::date
          AND NOT COALESCE(s.excluded, false)
          AND NOT EXISTS (
            SELECT 1 FROM apo_mail_log m
             WHERE m.slug = s.slug AND m.kind = 'confirm' AND m.status IN ('sent','draft')
          )
        ORDER BY taken_at
        LIMIT $2`, [dateJst, limit]);
    return rows;
  } catch (e) { console.error("[db] aposMailPending", e.message); return []; }
}

export async function apoMailSentRow(slug, kind) {
  if (!pool || !slug) return null;
  try {
    const { rows } = await pool.query(
      `SELECT * FROM apo_mail_log WHERE slug=$1 AND kind=$2 AND status='sent' LIMIT 1`, [slug, kind]
    );
    return rows[0] || null;
  } catch { return null; }
}

// 送ったメールの一覧（誰に・いつ・届いたか）
export async function listApoMails({ from, to, kind = "", owner = "", limit = 300 } = {}) {
  if (!pool) return [];
  try {
    const p = [];
    const w = [];
    if (from) { p.push(from); w.push(`(l.created_at AT TIME ZONE 'Asia/Tokyo')::date >= $${p.length}::date`); }
    if (to) { p.push(to); w.push(`(l.created_at AT TIME ZONE 'Asia/Tokyo')::date <= $${p.length}::date`); }
    if (kind) { p.push(kind); w.push(`l.kind = $${p.length}`); }
    if (owner) { p.push(String(owner).toLowerCase()); w.push(`lower(l.from_owner) = $${p.length}`); }
    p.push(Math.max(1, Math.min(1000, limit)));
    const { rows } = await pool.query(
      `SELECT l.*, s.label, s.start_time
         FROM apo_mail_log l
         LEFT JOIN smart_links s ON s.slug = l.slug
        ${w.length ? "WHERE " + w.join(" AND ") : ""}
        ORDER BY l.created_at DESC LIMIT $${p.length}`, p);
    return rows;
  } catch (e) { console.error("[db] listApoMails", e.message); return []; }
}

// 跳ね返りを記録する
export async function markBounced(toEmail, note) {
  if (!pool || !toEmail) return 0;
  try {
    // 直近2週間に、そのアドレスへ送ったものを跳ね返り扱いにする
    const { rowCount } = await pool.query(
      `UPDATE apo_mail_log
          SET bounced = true, bounce_note = $2
        WHERE lower(to_email) = lower($1)
          AND status = 'sent'
          AND created_at > now() - interval '14 days'
          AND NOT bounced`,
      [String(toEmail).trim(), String(note || "").slice(0, 200)]);
    return rowCount || 0;
  } catch (e) { console.error("[db] markBounced", e.message); return 0; }
}

export async function logApoMail({ slug, kind, toEmail, fromOwner, subject, status, error, messageId }) {
  if (!pool || !slug) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO apo_mail_log (slug, kind, to_email, from_owner, subject, status, error, message_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [slug, kind, toEmail || null, fromOwner || null, (subject || "").slice(0, 300),
       status, error ? String(error).slice(0, 500) : null, messageId || null]
    );
    return rows[0];
  } catch (e) {
    // 一意制約に当たった＝既に送信済み。エラーにはしない。
    if (/uq_apo_mail_(sent|done)/.test(e.message)) return null;
    console.error("[db] logApoMail", e.message);
    return null;
  }
}

// 複数slugぶんの送信状況をまとめて返す： { slug: { confirm: row, reminder: row } }
export async function listApoMailStatus(slugs) {
  const out = {};
  if (!pool || !Array.isArray(slugs) || !slugs.length) return out;
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (slug, kind) * FROM apo_mail_log
        WHERE slug = ANY($1::text[]) ORDER BY slug, kind, created_at DESC`, [slugs]
    );
    for (const r of rows) {
      out[r.slug] = out[r.slug] || {};
      out[r.slug][r.kind] = { status: r.status, at: r.created_at, to: r.to_email, error: r.error };
    }
  } catch (e) { console.error("[db] listApoMailStatus", e.message); }
  return out;
}

// ===== クローザーのローテーション =====
export async function listClosers({ activeOnly = false, business = "" } = {}) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT * FROM closer_rotation ${activeOnly ? "WHERE active" : ""} ORDER BY sort_order, email`
    );
    let list = rows.map((r) => ({
      ...r,
      businesses: Array.isArray(r.businesses) ? r.businesses : [],
    }));
    // 事業の指定があれば、その事業を担当する人だけに絞る。
    // 事業が未設定の人は、どの事業でも対象にする（設定漏れで割り振りが止まらないように）。
    const b = String(business || "").trim();
    if (b) list = list.filter((c) => !c.businesses.length || c.businesses.includes(b));
    return list;
  } catch { return []; }
}

// 画面から並び順ごと保存する。渡されなかったクローザーは削除する。
export async function saveClosers(list) {
  if (!pool) return [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const emails = list.map((c) => String(c.email || "").toLowerCase()).filter(Boolean);
    if (emails.length) {
      await client.query(`DELETE FROM closer_rotation WHERE email <> ALL($1::text[])`, [emails]);
    } else {
      await client.query(`DELETE FROM closer_rotation`);
    }
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const email = String(c.email || "").toLowerCase();
      if (!email) continue;
      const cap = Number.isFinite(+c.daily_cap) && +c.daily_cap > 0 ? +c.daily_cap : null;
      await client.query(
        `INSERT INTO closer_rotation (email, name, sort_order, active, daily_cap, team, fallback)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (email) DO UPDATE
           SET name=$2, sort_order=$3, active=$4, daily_cap=$5, team=$6, fallback=$7, updated_at=now()`,
        [email, String(c.name || "").trim() || email, i + 1, c.active !== false, cap,
         String(c.team || "").trim() || null, c.fallback === true]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[db] saveClosers", e.message);
  } finally { client.release(); }
  return listClosers();
}

// 割り当て確定：件数を進め、最優先フラグを外す
// 並び順だけを更新する（メンバーの増減はメンバー管理で行うため、ここでは触らない）
export async function saveCloserOrder(emails) {
  if (!pool || !Array.isArray(emails)) return listClosers();
  try {
    for (let i = 0; i < emails.length; i++) {
      await pool.query(`UPDATE closer_rotation SET sort_order=$2, updated_at=now() WHERE email=$1`,
        [String(emails[i]).toLowerCase(), i + 1]);
    }
  } catch (e) { console.error("[db] saveCloserOrder", e.message); }
  return listClosers();
}

export async function markCloserAssigned(email) {
  if (!pool || !email) return;
  try {
    await pool.query(
      `UPDATE closer_rotation
          SET assigned_count = assigned_count + 1, last_assigned_at = now(),
              priority = false, updated_at = now()
        WHERE email = $1`, [email]
    );
  } catch (e) { console.error("[db] markCloserAssigned", e.message); }
}

// 代打で飛ばされた人に、次のアポで最優先に戻る印をつける
export async function markCloserSkipped(emails) {
  if (!pool || !Array.isArray(emails) || !emails.length) return;
  try {
    await pool.query(
      `UPDATE closer_rotation SET priority = true, updated_at = now() WHERE email = ANY($1::text[])`,
      [emails]
    );
  } catch (e) { console.error("[db] markCloserSkipped", e.message); }
}

// その日にすでに割り当てた件数（1日の上限判定に使う。JST基準）
// 最優先フラグを全員分クリアする（順番をリセットするとき）
export async function clearCloserPriority() {
  if (!pool) return;
  try { await pool.query(`UPDATE closer_rotation SET priority=false, updated_at=now() WHERE priority`); } catch {}
}

export async function countAssignedOnDate(email, jstDate) {
  if (!pool || !email) return 0;
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM smart_links
        WHERE current_owner = $1
          AND NOT excluded
          AND (start_time AT TIME ZONE 'Asia/Tokyo')::date = $2::date`,
      [email, jstDate]
    );
    return rows[0] ? rows[0].n : 0;
  } catch { return 0; }
}

// テストで作ったアポを、集計から外す／戻す
// 複数のアポを、まとめて集計から外す／戻す
// 同じカレンダー予定から作られた重複を片付ける。
// 情報が多いもの（担当・宛先・処理済み）を1件だけ残して、残りを消す。
export async function dedupeSmartLinksByEvent({ dryRun = true } = {}) {
  if (!pool) return { groups: 0, remove: 0, samples: [] };
  try {
    const { rows } = await pool.query(
      `SELECT event_id, count(*)::int AS n
         FROM smart_links
        WHERE event_id IS NOT NULL
        GROUP BY event_id HAVING count(*) > 1
        ORDER BY count(*) DESC LIMIT 500`);
    let remove = 0;
    const samples = [];
    for (const g of rows) {
      const { rows: dup } = await pool.query(
        `SELECT slug, label, current_owner, client_email, auto_assigned_at, created_at
           FROM smart_links WHERE event_id = $1
          ORDER BY (current_owner IS NOT NULL) DESC,
                   (client_email IS NOT NULL) DESC,
                   (auto_assigned_at IS NOT NULL) DESC,
                   created_at ASC`, [g.event_id]);
      const keep = dup[0];
      const drop = dup.slice(1).map((d) => d.slug);
      if (!drop.length) continue;
      remove += drop.length;
      if (samples.length < 10) {
        samples.push({ label: keep.label, keep: keep.slug, removed: drop.length });
      }
      if (!dryRun) {
        await pool.query(`DELETE FROM smart_links WHERE slug = ANY($1::text[])`, [drop]);
      }
    }
    // 予定を作り直してIDが変わったぶんも片付ける（予定名＋開始時刻が同じもの）
    const { rows: same } = await pool.query(
      `SELECT label, start_time, count(*)::int AS n
         FROM smart_links
        WHERE COALESCE(label,'') <> '' AND start_time IS NOT NULL
        GROUP BY label, start_time HAVING count(*) > 1
        ORDER BY count(*) DESC LIMIT 500`);
    for (const g of same) {
      const { rows: dup } = await pool.query(
        `SELECT slug, label, current_owner, client_email, auto_assigned_at
           FROM smart_links WHERE label = $1 AND start_time = $2
          ORDER BY (current_owner IS NOT NULL) DESC,
                   (client_email IS NOT NULL) DESC,
                   (auto_assigned_at IS NOT NULL) DESC,
                   created_at ASC`, [g.label, g.start_time]);
      const drop = dup.slice(1).map((d) => d.slug);
      if (!drop.length) continue;
      remove += drop.length;
      if (samples.length < 10) samples.push({ label: g.label, keep: dup[0].slug, removed: drop.length });
      if (!dryRun) await pool.query(`DELETE FROM smart_links WHERE slug = ANY($1::text[])`, [drop]);
    }

    return { groups: rows.length + same.length, remove, samples };
  } catch (e) {
    console.error("[db] dedupeSmartLinksByEvent", e.message);
    return { groups: 0, remove: 0, samples: [], error: e.message };
  }
}

export async function setApoExcludedMany(slugs, excluded) {
  if (!pool || !Array.isArray(slugs) || !slugs.length) return 0;
  try {
    const { rowCount } = await pool.query(
      `UPDATE smart_links SET excluded = $2 WHERE slug = ANY($1::text[])`,
      [slugs, !!excluded]);
    return rowCount || 0;
  } catch (e) { console.error("[db] setApoExcludedMany", e.message); return 0; }
}

export async function setApoExcluded(slug, excluded) {
  if (!pool || !slug) return null;
  try {
    const { rows } = await pool.query(
      `UPDATE smart_links SET excluded=$2 WHERE slug=$1 RETURNING slug, label, excluded`,
      [slug, !!excluded]);
    return rows[0] || null;
  } catch (e) { console.error("[db] setApoExcluded", e.message); return null; }
}

export async function logAssign({ slug, assigned, reason, skipped, actor, team }) {
  if (!pool || !slug) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO assign_log (slug, assigned, reason, skipped, actor, team)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [slug, assigned || null, (reason || "").slice(0, 300), JSON.stringify(skipped || []), actor || null,
       team || null]
    );
    return rows[0];
  } catch (e) { console.error("[db] logAssign", e.message); return null; }
}

export async function listAssignLog(limit = 50) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(`SELECT * FROM assign_log ORDER BY created_at DESC LIMIT $1`, [limit]);
    return rows;
  } catch { return []; }
}

// 自動割り振り済みの印（同じ予定を二重に割り当てないため）
// 処理済みの印を外す。メール・SF立ち上げ・通知をやり直すときに使う。
export async function clearAutoAssigned(slug) {
  if (!pool || !slug) return;
  try { await pool.query(`UPDATE smart_links SET auto_assigned_at = NULL WHERE slug=$1`, [slug]); } catch {}
}

export async function markAutoAssigned(slug) {
  if (!pool || !slug) return;
  try { await pool.query(`UPDATE smart_links SET auto_assigned_at = now() WHERE slug=$1`, [slug]); } catch {}
}

// ===== 割り振り停止の履歴 =====
// 停止していた期間は稼働日に数えない。そのため「停止で減った分」を
// あとから優先して取り戻すような動きにはならない。
export async function listSuspensions(email = "") {
  if (!pool) return [];
  try {
    // 名前も一緒に返す（事業タブによって候補一覧に居ない人でも画面に名前が出るように）
    const sql = `SELECT s.*, COALESCE(c.name, m.name, s.email) AS name
                   FROM closer_suspensions s
                   LEFT JOIN closer_rotation c ON c.email = s.email
                   LEFT JOIN members m         ON m.email = s.email
                  ${email ? "WHERE s.email = $1" : ""}
                  ORDER BY s.start_date DESC`;
    const { rows } = email
      ? await pool.query(sql, [String(email).toLowerCase()])
      : await pool.query(sql);
    return rows;
  } catch (e) { console.error("[db] listSuspensions", e.message); return []; }
}

export async function addSuspension({ email, startDate, endDate, reason, createdBy }) {
  if (!pool || !email || !startDate) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO closer_suspensions (email, start_date, end_date, reason, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [String(email).toLowerCase(), startDate, endDate || null,
       String(reason || "").slice(0, 200) || null, createdBy || null]);
    return rows[0];
  } catch (e) { console.error("[db] addSuspension", e.message); return null; }
}

export async function deleteSuspension(id) {
  if (!pool) return;
  try { await pool.query(`DELETE FROM closer_suspensions WHERE id=$1`, [id]); } catch {}
}

// 今この人が停止中か（自動割り振りの対象から外すため）
export async function suspendedNow() {
  if (!pool) return {};
  try {
    const { rows } = await pool.query(
      `SELECT email, reason FROM closer_suspensions
        WHERE start_date <= (now() AT TIME ZONE 'Asia/Tokyo')::date
          AND (end_date IS NULL OR end_date >= (now() AT TIME ZONE 'Asia/Tokyo')::date)`);
    const out = {};
    for (const r of rows) out[r.email] = r.reason || "停止中";
    return out;
  } catch { return {}; }
}

// 期間内の「稼働日数」をクローザーごとに返す。
// 停止期間と、登録前の期間は差し引く。fromISO が無い場合は運用開始日から数える。
export async function eligibleDays(fromISO, toISO) {
  if (!pool) return {};
  try {
    // 稼働日 = 期間の日数 − 停止日数。
    // closer_rotation.created_at は「kinbotに登録した日」であって稼働開始日ではないため使わない
    // （同期した当日だと全員1日になってしまう）。
    // 停止日数は相関サブクエリで求める。停止の登録が無い人は 0 になる。
    const { rows } = await pool.query(
      `WITH win AS (
         SELECT COALESCE($1::date, (now() AT TIME ZONE 'Asia/Tokyo')::date - 90) AS f,
                LEAST(COALESCE($2::date, (now() AT TIME ZONE 'Asia/Tokyo')::date + 1),
                      (now() AT TIME ZONE 'Asia/Tokyo')::date + 1)               AS t
       )
       SELECT c.email,
              GREATEST(0, (w.t - w.f))::int AS raw_days,
              COALESCE((
                SELECT SUM(GREATEST(0,
                         LEAST(COALESCE(s.end_date + 1, w.t), w.t)
                         - GREATEST(s.start_date, w.f)))
                  FROM closer_suspensions s
                 WHERE s.email = c.email
                   AND s.start_date < w.t
                   AND COALESCE(s.end_date + 1, w.t) > w.f
              ), 0)::int AS suspended_days
         FROM closer_rotation c CROSS JOIN win w`,
      [fromISO || null, toISO || null]);
    const out = {};
    for (const r of rows) {
      const days = Math.max(0, r.raw_days - r.suspended_days);
      out[r.email] = { days, rawDays: r.raw_days, suspendedDays: r.suspended_days };
    }
    return out;
  } catch (e) { console.error("[db] eligibleDays", e.message); return {}; }
}

// ===== Google Chatの通知先（複数） =====
export async function listChatTargets({ onlyActive = false } = {}) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT * FROM chat_targets ${onlyActive ? "WHERE active" : ""} ORDER BY id`);
    return rows;
  } catch { return []; }
}

export async function addChatTarget({ name, webhookUrl, spaceId }) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO chat_targets (name, webhook_url, space_id) VALUES ($1,$2,$3) RETURNING *`,
      [String(name || "通知先").slice(0, 80), webhookUrl || null, spaceId || null]);
    return rows[0];
  } catch (e) { console.error("[db] addChatTarget", e.message); return null; }
}

export async function updateChatTarget(id, patch) {
  if (!pool || !id) return null;
  const cols = { name: "name", webhookUrl: "webhook_url", spaceId: "space_id",
    onAssign: "on_assign", onMail: "on_mail", onDoc: "on_doc", onLaunch: "on_launch",
    onNews: "on_news",
    onDeploy: "on_deploy", active: "active" };
  const sets = [], vals = [id];
  for (const [k, col] of Object.entries(cols)) {
    if (patch[k] === undefined) continue;
    vals.push(patch[k]);
    sets.push(`${col} = $${vals.length}`);
  }
  if (!sets.length) return null;
  try {
    const { rows } = await pool.query(
      `UPDATE chat_targets SET ${sets.join(", ")} WHERE id = $1 RETURNING *`, vals);
    return rows[0] || null;
  } catch (e) { console.error("[db] updateChatTarget", e.message); return null; }
}

export async function deleteChatTarget(id) {
  if (!pool) return;
  try { await pool.query(`DELETE FROM chat_targets WHERE id=$1`, [id]); } catch {}
}

// 送った結果を残す（画面で「前回のエラー」を出すため）
export async function markChatTarget(id, { ok, error = "" }) {
  if (!pool || !id) return;
  try {
    if (ok) await pool.query(`UPDATE chat_targets SET sent_count = sent_count + 1, last_error = NULL WHERE id=$1`, [id]);
    else await pool.query(`UPDATE chat_targets SET last_error=$2 WHERE id=$1`, [id, String(error).slice(0, 300)]);
  } catch {}
}

// ===== Salesforceの自動立ち上げ =====
// 割り振りの件数（本日・今週・今月）。通知に添えて、進み具合が分かるようにする。
// メールアドレスから営業担当の名前を引く。通知に「kinya.tanaka」ではなく
// 「田中欽也」と出すために使う。見つからなければアドレスの@より前を返す。
export async function displayNameOf(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return "";
  if (pool) {
    try {
      const { rows } = await pool.query(`SELECT name FROM members WHERE lower(email)=$1`, [e]);
      if (rows[0]?.name) return rows[0].name;
    } catch {}
    try {
      const { rows } = await pool.query(`SELECT name FROM users WHERE lower(email)=$1`, [e]);
      if (rows[0]?.name) return rows[0].name;
    } catch {}
  }
  return e.split("@")[0];
}

// アポ獲得の実績を、獲得者ごと・取得日ごとに数える。
// 商談日が期間内かどうかで、期内・期外を分ける。
// SFのレポートには商談日が無いので、kinbotが持っているアポの記録を使う。
// 期内かどうかの条件（SQLの式）。
//   fixed … 決めた期間（termFrom〜termTo）に商談日が入っていれば期内
//   auto  … アポを取った月と、商談の月が同じなら期内（毎月の設定変更が要らない）
// どちらでも、商談日が未定のものは期内にしない。
export function apoInTermSql(mode = "fixed") {
  return String(mode) === "auto"
    ? `date_trunc('month', start_time AT TIME ZONE 'Asia/Tokyo')
       = date_trunc('month', COALESCE(apo_at, created_at) AT TIME ZONE 'Asia/Tokyo')`
    : `(start_time AT TIME ZONE 'Asia/Tokyo')::date BETWEEN $1::date AND $2::date`;
}

export async function apoCountsBySetter({ termFrom, termTo, business = "", mode = "fixed" } = {}) {
  if (!pool) return [];
  try {
    const p = [termFrom, termTo];
    let where = "COALESCE(setter,'') <> '' AND NOT COALESCE(excluded,false)";
    if (business) { p.push(business); where += ` AND business = $${p.length}`; }
    const inTerm = apoInTermSql(mode);
    // 日付は「アポを取った日」。分からないものだけ、kinbotが拾った日で代用する。
    const { rows } = await pool.query(
      `SELECT setter,
              to_char(COALESCE(apo_at, created_at) AT TIME ZONE 'Asia/Tokyo', 'FMMM/FMDD') AS day,
              count(*) FILTER (WHERE start_time IS NOT NULL AND ${inTerm})::int AS in_term,
              count(*) FILTER (WHERE start_time IS NOT NULL AND NOT (${inTerm}))::int AS out_term,
              count(*) FILTER (WHERE start_time IS NULL)::int AS undecided
         FROM smart_links
        WHERE ${where}
        GROUP BY 1, 2`, p);
    return rows;
  } catch (e) { console.error("[db] apoCountsBySetter", e.message); return []; }
}

// 商談日（start_time）が入っていないアポを探す。
// カレンダーから拾って補うために使う。
export async function apoMissingStart(limit = 200) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT slug, label, setter, event_id, invite_event_id, current_owner, created_by
         FROM smart_links
        WHERE start_time IS NULL
          AND COALESCE(setter,'') <> ''
          AND NOT COALESCE(excluded,false)
        ORDER BY created_at DESC
        LIMIT $1`, [limit]);
    return rows;
  } catch (e) { console.error("[db] apoMissingStart", e.message); return []; }
}

// アポを取った日時が入っていないものを探す（カレンダーから補うため）
export async function apoMissingApoAt(limit = 300) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT slug, label, setter, event_id, invite_event_id, current_owner, created_by
         FROM smart_links
        WHERE apo_at IS NULL
          AND event_id IS NOT NULL
          AND COALESCE(setter,'') <> ''
          AND NOT COALESCE(excluded,false)
        ORDER BY created_at DESC
        LIMIT $1`, [limit]);
    return rows;
  } catch (e) { console.error("[db] apoMissingApoAt", e.message); return []; }
}

export async function setApoAt(slug, atISO) {
  if (!pool || !slug || !atISO) return null;
  try {
    const { rows } = await pool.query(
      `UPDATE smart_links SET apo_at = $2 WHERE slug = $1 AND apo_at IS NULL
        RETURNING slug, label, apo_at`, [slug, atISO]);
    return rows[0] || null;
  } catch (e) { console.error("[db] setApoAt", e.message); return null; }
}

export async function setApoStartTime(slug, startISO) {
  if (!pool || !slug || !startISO) return null;
  try {
    const { rows } = await pool.query(
      `UPDATE smart_links SET start_time = $2 WHERE slug = $1 AND start_time IS NULL
        RETURNING slug, label, start_time`, [slug, startISO]);
    return rows[0] || null;
  } catch (e) { console.error("[db] setApoStartTime", e.message); return null; }
}

// アポ1件ずつの内訳。なぜ期外になったのかを画面で確かめるために使う。
export async function apoDetailBySetter({ termFrom, termTo, limit = 200, mode = "fixed" } = {}) {
  if (!pool) return [];
  try {
    const inTerm = apoInTermSql(mode);
    const { rows } = await pool.query(
      `SELECT slug, setter,
              to_char(COALESCE(apo_at, created_at) AT TIME ZONE 'Asia/Tokyo', 'FMMM/FMDD') AS day,
              to_char(COALESCE(apo_at, created_at) AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI') AS created_jst,
              (apo_at IS NULL) AS apo_at_missing,
              to_char(start_time AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM-DD') AS meeting_date,
              label,
              CASE
                WHEN start_time IS NULL THEN '商談日が未定'
                WHEN ${inTerm} THEN '期内'
                ELSE '期外'
              END AS term
         FROM smart_links
        WHERE COALESCE(setter,'') <> '' AND NOT COALESCE(excluded,false)
        ORDER BY COALESCE(apo_at, created_at) DESC
        LIMIT $3`, [termFrom, termTo, limit]);
    return rows;
  } catch (e) { console.error("[db] apoDetailBySetter", e.message); return []; }
}

// アポ集計の期間キー（この単位が変わると、手修正はリセットされる）
export function apoPeriodKeys(now = new Date()) {
  const j = new Date(now.getTime() + 9 * 3600 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const y = j.getUTCFullYear(), m = j.getUTCMonth(), d = j.getUTCDate();
  const today = `${y}-${pad(m + 1)}-${pad(d)}`;
  const off = (j.getUTCDay() + 6) % 7; // 月曜起点
  const wk = new Date(Date.UTC(y, m, d - off));
  const week = `${wk.getUTCFullYear()}-${pad(wk.getUTCMonth() + 1)}-${pad(wk.getUTCDate())}`;
  const month = `${y}-${pad(m + 1)}`;
  return { today, week, month };
}

// 実数だけを数える（手修正を含まない）
export async function assignCountsRaw(business = "") {
  if (!pool) return { today: 0, week: 0, month: 0 };
  try {
    const cond = business ? `AND s.business = $1` : "";
    const p = business ? [business] : [];
    const q = async (from) => {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM assign_log a
           JOIN smart_links s ON s.slug = a.slug
          WHERE a.created_at >= ${from} AND NOT s.excluded ${cond}`, p);
      return rows[0]?.n || 0;
    };
    const [today, week, month] = await Promise.all([
      q("date_trunc('day',   now() AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo'"),
      q("date_trunc('week',  now() AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo'"),
      q("date_trunc('month', now() AT TIME ZONE 'Asia/Tokyo') AT TIME ZONE 'Asia/Tokyo'"),
    ]);
    return { today, week, month };
  } catch (e) { console.error("[db] assignCountsRaw", e.message); return { today: 0, week: 0, month: 0 }; }
}

// 通知や表示に使うカウント。実数に「手修正（調整値）」を足して返す。
// 調整値は期間キーが今と一致するときだけ効く（期間が変われば実数に戻る）。
export async function assignCounts(business = "") {
  const raw = await assignCountsRaw(business);
  try {
    const st = await getSettings();
    const adj = ((st.apoCountAdjust || {})[business]) || {};
    const keys = apoPeriodKeys();
    const out = {};
    for (const per of ["today", "week", "month"]) {
      let n = raw[per];
      const a = adj[per];
      if (a && a.key === keys[per]) n = Math.max(0, n + (Number(a.delta) || 0));
      out[per] = n;
    }
    return out;
  } catch { return raw; }
}

export async function saveAutolaunch(r) {
  if (!pool || !r?.slug) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO sf_autolaunch (slug, bot_id, title, company, person, ok, reason, detail, lead_id, opp_id, filled_url, tried_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
       ON CONFLICT (slug) DO UPDATE SET
         bot_id=$2, title=$3, company=$4, person=$5, ok=$6, reason=$7, detail=$8,
         lead_id=$9, opp_id=$10, filled_url=$11, tried_at=now()
       RETURNING *`,
      [r.slug, r.botId || null, r.title || null, r.company || null, r.person || null,
       !!r.ok, r.reason || null, r.detail || null, r.leadId || null, r.oppId || null, r.filledUrl || null]);
    return rows[0];
  } catch (e) { console.error("[db] saveAutolaunch", e.message); return null; }
}

export async function getAutolaunch(slug) {
  if (!pool || !slug) return null;
  try {
    const { rows } = await pool.query(`SELECT * FROM sf_autolaunch WHERE slug=$1`, [slug]);
    return rows[0] || null;
  } catch { return null; }
}

// 会社名から、kinbotが立ち上げた記録を引く。
// Salesforce側で見つからなくても、立ち上げ済みだと分かるようにするため。
// 直近の自動立ち上げの結果（診断で使う）
// 自動で立ち上げられなかったものを一覧にする。
// 通知を追いかけなくても、ここを見れば取りこぼしが分かるようにする。
export async function pendingAutolaunch({ limit = 200, includeDone = false } = {}) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT a.*, s.start_time, s.current_owner, s.client_email, s.business, s.excluded
         FROM sf_autolaunch a
         LEFT JOIN smart_links s ON s.slug = a.slug
        WHERE ${includeDone ? "true" : "NOT a.ok"}
          AND COALESCE(s.excluded, false) = false
        ORDER BY a.tried_at DESC
        LIMIT $1`, [limit]);
    return rows;
  } catch (e) { console.error("[db] pendingAutolaunch", e.message); return []; }
}

export async function listAutolaunch(limit = 20) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT * FROM sf_autolaunch ORDER BY tried_at DESC LIMIT $1`, [limit]);
    return rows;
  } catch { return []; }
}

export async function autolaunchByCompanies(names) {
  if (!pool || !Array.isArray(names) || !names.length) return {};
  const core = (v) => String(v || "")
    .replace(/(株式会社|有限会社|合同会社|合資会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|医療法人|学校法人|社会福祉法人|㈱|\(株\)|（株）)/g, "")
    .replace(/[\s　]/g, "").trim();
  try {
    const { rows } = await pool.query(
      `SELECT * FROM sf_autolaunch WHERE ok AND opp_id IS NOT NULL ORDER BY tried_at DESC LIMIT 500`);
    const out = {};
    for (const r of rows) {
      const k = core(r.company);
      if (k && !out[k]) out[k] = r;
    }
    return out;
  } catch { return {}; }
}

export async function autolaunchForSlugs(slugs) {
  if (!pool || !Array.isArray(slugs) || !slugs.length) return {};
  try {
    const { rows } = await pool.query(`SELECT * FROM sf_autolaunch WHERE slug = ANY($1::text[])`, [slugs]);
    const out = {};
    for (const r of rows) out[r.slug] = r;
    return out;
  } catch { return {}; }
}

// ===== 資料の閲覧トラッキング =====
export async function addDocFile({ name, filename, mime, buf, uploadedBy }) {
  if (!pool || !buf) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO doc_files (name, filename, mime, bytes, size, uploaded_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, name, filename, mime, size, active, created_at`,
      [String(name || filename || "資料").slice(0, 200), filename || null,
       mime || "application/pdf", buf, buf.length, uploadedBy || null]);
    return rows[0];
  } catch (e) { console.error("[db] addDocFile", e.message); return null; }
}

// 一覧では中身（bytes）を返さない。重いので。
// 資料の一覧。
//   owner を渡すと「自分が入れたもの＋チームに共有されているもの」だけを返す。
//   all=true なら全部（管理用）。
export async function listDocFiles({ owner = "", all = false } = {}) {
  if (!pool) return [];
  try {
    const p = [];
    let where = "1=1";
    if (owner && !all) {
      p.push(String(owner).toLowerCase());
      where = `(lower(COALESCE(f.uploaded_by,'')) = $${p.length} OR COALESCE(f.shared,true) = true)`;
    }
    const { rows } = await pool.query(
      `SELECT f.id, f.name, f.filename, f.mime, f.size, f.active, f.uploaded_by, f.shared, f.created_at,
              (SELECT count(*) FROM doc_links l WHERE l.doc_id = f.id) AS links,
              (SELECT count(*) FROM doc_views v JOIN doc_links l ON l.id = v.link_id
                WHERE l.doc_id = f.id) AS views
         FROM doc_files f
        WHERE ${where}
        ORDER BY f.active DESC, f.created_at DESC`, p);
    return rows;
  } catch { return []; }
}

export async function getDocBytes(id) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(`SELECT name, filename, mime, bytes FROM doc_files WHERE id=$1`, [id]);
    return rows[0] || null;
  } catch { return null; }
}

// 資料の名前を変える（文字化けを直すときにも使う）
export async function renameDocFile(id, name) {
  if (!pool || !id || !name) return;
  try { await pool.query(`UPDATE doc_files SET name=$2, filename=$2 WHERE id=$1`, [id, String(name).slice(0, 200)]); }
  catch (e) { console.error("[db] renameDocFile", e.message); }
}

export async function setDocActive(id, active) {
  if (!pool) return;
  try { await pool.query(`UPDATE doc_files SET active=$2 WHERE id=$1`, [id, !!active]); } catch {}
}
export async function deleteDocFile(id) {
  if (!pool) return;
  try { await pool.query(`DELETE FROM doc_files WHERE id=$1`, [id]); } catch {}
}

// 宛先ごとのリンクをまとめて発行する
export async function addDocLinks(docId, rows, owner, opt = {}) {
  if (!pool || !docId || !Array.isArray(rows) || !rows.length) return [];
  const out = [];
  // 期限・合言葉・お名前確認（指定がなければ今まで通り）
  const expires = opt.expiresAt || null;
  const passHash = opt.pass ? hashPass(opt.pass) : null;
  const askName = !!opt.askName;
  for (const r of rows) {
    const slug = randomSlug(12);   // 当てられにくいよう長めにする
    try {
      const { rows: ins } = await pool.query(
        `INSERT INTO doc_links (slug, doc_id, company, contact, email, owner, note,
                                expires_at, pass_hash, ask_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [slug, docId, (r.company || "").slice(0, 200) || null, (r.contact || "").slice(0, 100) || null,
         (r.email || "").slice(0, 200) || null, owner || null, (r.note || "").slice(0, 300) || null,
         expires, passHash, askName]);
      out.push(ins[0]);
    } catch (e) { console.error("[db] addDocLinks", e.message); }
  }
  return out;
}

// 合言葉はそのまま持たず、変換して保存する
export function hashPass(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  return `s1:${salt}:${h}`;
}
export function checkPass(pw, stored) {
  try {
    const [v, salt, h] = String(stored || "").split(":");
    if (v !== "s1" || !salt || !h) return false;
    const t = crypto.scryptSync(String(pw), salt, 32).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(t, "hex"), Buffer.from(h, "hex"));
  } catch { return false; }
}

// 見た人が名乗ってくれた内容を控える
export async function setViewerIdentity(viewId, name, email) {
  if (!pool || !viewId) return false;
  try {
    await pool.query(`UPDATE doc_views SET viewer_name=$2, viewer_email=$3 WHERE id=$1`,
      [viewId, String(name || "").slice(0, 100) || null, String(email || "").slice(0, 200) || null]);
    return true;
  } catch (e) { console.error("[db] setViewerIdentity", e.message); return false; }
}

function randomSlug(n = 10) {
  const c = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

// 一覧。閲覧回数・合計秒数・最終閲覧・最大ページ・開封・クリックをまとめて出す。
// 会社名から、その会社向けに発行ずみの資料URLを引く。
// 御礼メールに差し込むときに使う。
export async function docLinksForCompany(company, limit = 5) {
  if (!pool || !company) return [];
  const core = (v) => String(v || "")
    .replace(/(株式会社|有限会社|合同会社|合資会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|医療法人|学校法人|社会福祉法人|㈱|\(株\)|（株）)/g, "")
    .replace(/[\s　]/g, "").trim();
  try {
    const { rows } = await pool.query(
      `SELECT l.*, f.name AS doc_name
         FROM doc_links l JOIN doc_files f ON f.id = l.doc_id
        WHERE NOT l.revoked
        ORDER BY l.created_at DESC LIMIT 500`);
    const key = core(company);
    if (!key) return [];
    return rows
      .filter((r) => { const c = core(r.company); return c && (c.includes(key) || key.includes(c)); })
      .slice(0, limit);
  } catch (e) { console.error("[db] docLinksForCompany", e.message); return []; }
}

// この会社あての宛先（メールアドレス）を探す。
// 御礼メールの「宛先」を自動で入れるために使う。
//   1. アポの記録（カレンダーのゲスト・説明欄から取ったもの）
//   2. 資料URLを発行したときの宛先
export async function clientEmailForCompany(company) {
  if (!pool || !company) return null;
  const core = (v) => String(v || "")
    .replace(/(株式会社|有限会社|合同会社|合資会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|医療法人|学校法人|社会福祉法人|㈱|\(株\)|（株）)/g, "")
    .replace(/[\s　]/g, "").trim();
  const key = core(company);
  if (!key || key.length < 2) return null;
  try {
    const { rows } = await pool.query(
      `SELECT label, client_email, client_name, updated_at
         FROM smart_links
        WHERE COALESCE(client_email,'') <> '' AND NOT COALESCE(excluded,false)
        ORDER BY updated_at DESC LIMIT 500`);
    for (const r of rows) {
      const c = core(String(r.label || "").replace(/【[^】]*】/g, "").split(/[／\/|]/)[0]);
      if (c && (c.includes(key) || key.includes(c))) {
        return { email: r.client_email, name: r.client_name || "", source: "アポの記録" };
      }
    }
  } catch {}
  try {
    const { rows } = await pool.query(
      `SELECT company, contact, email FROM doc_links
        WHERE COALESCE(email,'') <> '' AND NOT revoked
        ORDER BY created_at DESC LIMIT 500`);
    for (const r of rows) {
      const c = core(r.company);
      if (c && (c.includes(key) || key.includes(c))) {
        return { email: r.email, name: r.contact || "", source: "資料URLの宛先" };
      }
    }
  } catch {}
  return null;
}

// 資料を「自分だけ」「チームに共有」に切り替える
// メルマガ用の「みんな共通のURL」を1本だけ用意する。
// すでにあれば、それを使い回す（同じ資料に何本も作らない）。
export async function getOrCreateSharedLink(docId, owner) {
  if (!pool || !docId) return null;
  try {
    const { rows: found } = await pool.query(
      `SELECT * FROM doc_links
        WHERE doc_id = $1 AND shared_link = true AND NOT revoked
        ORDER BY created_at LIMIT 1`, [docId]);
    if (found[0]) return found[0];
    const slug = Math.random().toString(36).slice(2, 10);
    const { rows } = await pool.query(
      `INSERT INTO doc_links (slug, doc_id, company, contact, email, owner, shared_link)
       VALUES ($1,$2,'（メルマガ用の共通URL）','','',$3,true) RETURNING *`,
      [slug, docId, owner || null]);
    return rows[0] || null;
  } catch (e) {
    // 列がまだ無いときは、その場で足してからもう一度試す
    if (/shared_link/.test(e.message)) {
      try {
        await pool.query(`ALTER TABLE doc_links ADD COLUMN IF NOT EXISTS shared_link BOOLEAN NOT NULL DEFAULT false`);
        const slug = Math.random().toString(36).slice(2, 10);
        const { rows } = await pool.query(
          `INSERT INTO doc_links (slug, doc_id, company, contact, email, owner, shared_link)
           VALUES ($1,$2,'（メルマガ用の共通URL）','','',$3,true) RETURNING *`,
          [slug, docId, owner || null]);
        return rows[0] || null;
      } catch (e2) { console.error("[db] getOrCreateSharedLink(再)", e2.message); return null; }
    }
    console.error("[db] getOrCreateSharedLink", e.message);
    return null;
  }
}

// 共通URLで開いた人を記録する
// 共通URLを、誰が開いたかの一覧
export async function listSharedViewers(linkId, limit = 500) {
  if (!pool || !linkId) return [];
  try {
    const { rows } = await pool.query(
      `SELECT COALESCE(NULLIF(viewer_email,''), '（名乗りなし）') AS 相手,
              max(viewer_name) AS 名前,
              count(*) AS 回数,
              sum(COALESCE(seconds,0)) AS 秒,
              max(COALESCE(max_page,0)) AS 到達,
              max(started_at) AS 最後
         FROM doc_views
        WHERE link_id = $1
        GROUP BY 1
        ORDER BY 最後 DESC
        LIMIT $2`, [linkId, limit]);
    return rows;
  } catch (e) { console.error("[db] listSharedViewers", e.message); return []; }
}

export async function setViewerInfo(viewId, { email, name } = {}) {
  if (!pool || !viewId) return null;
  try {
    await pool.query(
      `UPDATE doc_views SET viewer_email = COALESCE(NULLIF($2,''), viewer_email),
                            viewer_name  = COALESCE(NULLIF($3,''), viewer_name)
        WHERE id = $1`,
      [viewId, String(email || "").trim(), String(name || "").trim()]);
    return true;
  } catch (e) { console.error("[db] setViewerInfo", e.message); return null; }
}

export async function setDocShared(id, shared) {
  if (!pool || !id) return null;
  try {
    const { rows } = await pool.query(
      `UPDATE doc_files SET shared = $2 WHERE id = $1 RETURNING id, name, shared`,
      [id, !!shared]);
    return rows[0] || null;
  } catch (e) { console.error("[db] setDocShared", e.message); return null; }
}

export async function listDocLinks({ docId = 0, onlyViewed = false, limit = 500 } = {}) {
  if (!pool) return [];
  try {
    const p = [];
    let where = "NOT l.revoked";
    if (docId) { p.push(docId); where += ` AND l.doc_id = $${p.length}`; }
    p.push(limit);
    const { rows } = await pool.query(
      `SELECT l.*, f.name AS doc_name,
              COALESCE(v.cnt,0)      AS view_count,
              COALESCE(v.secs,0)     AS total_seconds,
              COALESCE(v.max_page,0) AS max_page,
              v.last_at,
              COALESCE(e.opens,0)    AS opens,
              COALESCE(e.clicks,0)   AS clicks,
              COALESCE(e.downloads,0) AS downloads
         FROM doc_links l
         JOIN doc_files f ON f.id = l.doc_id
         LEFT JOIN (SELECT link_id, count(*) cnt, sum(seconds) secs,
                           max(max_page) max_page, max(last_at) last_at
                      FROM doc_views GROUP BY link_id) v ON v.link_id = l.id
         LEFT JOIN (SELECT link_id,
                           count(*) FILTER (WHERE kind='open')  opens,
                           count(*) FILTER (WHERE kind='click') clicks,
                           count(*) FILTER (WHERE kind='download') downloads
                      FROM doc_events GROUP BY link_id) e ON e.link_id = l.id
        WHERE ${where}
        ORDER BY v.last_at DESC NULLS LAST, l.created_at DESC
        LIMIT $${p.length}`, p);
    return onlyViewed ? rows.filter((r) => +r.view_count > 0) : rows;
  } catch (e) { console.error("[db] listDocLinks", e.message); return []; }
}

export async function getDocLink(slug) {
  if (!pool || !slug) return null;
  try {
    const { rows } = await pool.query(
      `SELECT l.*, f.name AS doc_name, f.mime, f.filename
         FROM doc_links l JOIN doc_files f ON f.id = l.doc_id
        WHERE l.slug = $1 AND NOT l.revoked AND f.active`, [slug]);
    return rows[0] || null;
  } catch { return null; }
}

export async function revokeDocLink(id) {
  if (!pool) return;
  try { await pool.query(`UPDATE doc_links SET revoked=true WHERE id=$1`, [id]); } catch {}
}

// 発行したURLと、その閲覧の記録をまるごと消す。
// 一覧から消えるだけでなく、そのURLも開けなくなる。
// （doc_views／doc_events は ON DELETE CASCADE で一緒に消える）
export async function deleteDocLink(id) {
  if (!pool || !id) return { deleted: 0 };
  try {
    const { rowCount } = await pool.query(`DELETE FROM doc_links WHERE id = $1`, [id]);
    return { deleted: rowCount };
  } catch (e) { console.error("[db] deleteDocLink", e.message); return { deleted: 0 }; }
}

// 閲覧・開封の記録だけを消す（URLはそのまま使える）
export async function clearDocLinkHistory(id) {
  if (!pool || !id) return { views: 0, events: 0 };
  try {
    const a = await pool.query(`DELETE FROM doc_views WHERE link_id = $1`, [id]);
    const b = await pool.query(`DELETE FROM doc_events WHERE link_id = $1`, [id]);
    return { views: a.rowCount, events: b.rowCount };
  } catch (e) { console.error("[db] clearDocLinkHistory", e.message); return { views: 0, events: 0 }; }
}

// 閲覧を開始する（1回の閲覧＝1行）
export async function startDocView(linkId, { ua, referrer, ipHash } = {}) {
  if (!pool || !linkId) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO doc_views (link_id, ua, referrer, ip_hash) VALUES ($1,$2,$3,$4) RETURNING *`,
      [linkId, (ua || "").slice(0, 300), (referrer || "").slice(0, 300), ipHash || null]);
    return rows[0];
  } catch (e) { console.error("[db] startDocView", e.message); return null; }
}

// 数秒おきに進捗を上書きする
export async function beatDocView(viewId, { seconds, maxPage, pages }) {
  if (!pool || !viewId) return null;
  try {
    const { rows } = await pool.query(
      `UPDATE doc_views
          SET seconds = GREATEST(seconds, $2),
              max_page = GREATEST(max_page, $3),
              pages = $4::jsonb,
              last_at = now()
        WHERE id = $1 RETURNING *`,
      [viewId, Math.max(0, Math.min(60 * 60 * 6, parseInt(seconds, 10) || 0)),
       Math.max(0, parseInt(maxPage, 10) || 0), JSON.stringify(pages || {})]);
    return rows[0] || null;
  } catch (e) { console.error("[db] beatDocView", e.message); return null; }
}

export async function endDocView(viewId) {
  if (!pool || !viewId) return null;
  try {
    const { rows } = await pool.query(
      `UPDATE doc_views SET ended = true, last_at = now() WHERE id = $1 RETURNING *`, [viewId]);
    return rows[0] || null;
  } catch { return null; }
}

// 閉じる合図が届かなかった閲覧を拾う（タブごと落ちた場合など）。
// しばらく進捗が来ていないものは、終わったとみなす。
export async function staleDocViews(idleSeconds = 90) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT v.*, l.slug FROM doc_views v JOIN doc_links l ON l.id = v.link_id
        WHERE NOT v.notified AND NOT v.ended
          AND v.last_at < now() - ($1 || ' seconds')::interval
        LIMIT 50`, [String(Math.max(30, idleSeconds))]);
    return rows;
  } catch { return []; }
}

export async function markDocViewNotified(viewId) {
  if (!pool) return;
  try { await pool.query(`UPDATE doc_views SET notified=true WHERE id=$1`, [viewId]); } catch {}
}

// この宛先が、これまで何回この資料を見たか（今回を除く）と、
// 前回いつ見たかを返す。通知の文言を変えるために使う。
// 短すぎる閲覧（開いてすぐ閉じた分）は数えない。
export async function priorDocViews(linkId, currentViewId, minSeconds = 20) {
  if (!pool || !linkId) return { count: 0, lastAt: null };
  try {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS cnt,
              max(COALESCE(last_at, started_at)) AS last_at
         FROM doc_views
        WHERE link_id = $1 AND id <> $2 AND seconds >= $3`,
      [linkId, currentViewId || 0, Math.max(0, parseInt(minSeconds, 10) || 0)]);
    return { count: rows[0]?.cnt || 0, lastAt: rows[0]?.last_at || null };
  } catch (e) { console.error("[db] priorDocViews", e.message); return { count: 0, lastAt: null }; }
}

export async function addDocEvent(linkId, kind, { url, ua } = {}) {
  if (!pool || !linkId) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO doc_events (link_id, kind, url, ua) VALUES ($1,$2,$3,$4) RETURNING *`,
      [linkId, String(kind).slice(0, 20), (url || "").slice(0, 600) || null, (ua || "").slice(0, 300)]);
    return rows[0];
  } catch { return null; }
}

// 1件のリンクの詳しい記録（閲覧ごとの明細）
export async function docLinkDetail(slug) {
  if (!pool || !slug) return null;
  try {
    const link = await getDocLink(slug);
    if (!link) return null;
    const { rows: views } = await pool.query(
      `SELECT * FROM doc_views WHERE link_id=$1 ORDER BY started_at DESC LIMIT 50`, [link.id]);
    const { rows: events } = await pool.query(
      `SELECT * FROM doc_events WHERE link_id=$1 ORDER BY at DESC LIMIT 100`, [link.id]);
    return { link, views, events };
  } catch { return null; }
}

// ===== 次回アクション（やることリスト） =====
export const NEXT_ACTION_KINDS = [
  "電話", "メール", "再商談", "資料送付", "見積提出", "社内確認", "稟議待ち", "その他",
];

export async function addNextAction({ botId, company, title, kind, content, dueDate, owner }) {
  if (!pool || !kind || !content) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO next_actions (bot_id, company, title, kind, content, due_date, owner)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [botId || null, company || null, title || null, String(kind).slice(0, 40),
       String(content).slice(0, 1000), dueDate || null, owner || null]);
    return rows[0];
  } catch (e) { console.error("[db] addNextAction", e.message); return null; }
}

export async function listNextActions({ company = "", botId = "", owner = "", onlyOpen = false, limit = 200 } = {}) {
  if (!pool) return [];
  try {
    const w = [], p = [];
    if (company) { p.push(company); w.push(`company = $${p.length}`); }
    if (botId) { p.push(botId); w.push(`bot_id = $${p.length}`); }
    if (owner) { p.push(owner); w.push(`owner = $${p.length}`); }
    if (onlyOpen) w.push("NOT done");
    p.push(limit);
    const { rows } = await pool.query(
      `SELECT * FROM next_actions
        ${w.length ? "WHERE " + w.join(" AND ") : ""}
        ORDER BY done, due_date NULLS LAST, created_at DESC
        LIMIT $${p.length}`, p);
    return rows;
  } catch (e) { console.error("[db] listNextActions", e.message); return []; }
}

// チェックの入り／外しで完了・未完了を切り替える
export async function setNextActionDone(id, done, by) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `UPDATE next_actions
          SET done = $2,
              done_at = CASE WHEN $2 THEN now() ELSE NULL END,
              done_by = CASE WHEN $2 THEN $3 ELSE NULL END
        WHERE id = $1 RETURNING *`, [id, !!done, by || null]);
    return rows[0] || null;
  } catch (e) { console.error("[db] setNextActionDone", e.message); return null; }
}

export async function deleteNextAction(id) {
  if (!pool) return;
  try { await pool.query(`DELETE FROM next_actions WHERE id=$1`, [id]); } catch {}
}

// ===== かささぎ =====
// 答えられなかった質問をためる
export async function addUnanswered({ botId, title, askedBy, question }) {
  if (!pool || !question) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO kasasagi_unanswered (bot_id, title, asked_by, question)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [botId || null, title || null, askedBy || null, String(question).slice(0, 1000)]);
    return rows[0];
  } catch (e) { console.error("[db] addUnanswered", e.message); return null; }
}

export async function listUnanswered({ onlyOpen = false, limit = 200 } = {}) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT * FROM kasasagi_unanswered
        ${onlyOpen ? "WHERE answered_at IS NULL" : ""}
        ORDER BY answered_at NULLS FIRST, created_at DESC LIMIT $1`, [limit]);
    return rows;
  } catch { return []; }
}

export async function answerUnanswered(id, { answer, answeredBy }) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `UPDATE kasasagi_unanswered SET answer=$2, answered_by=$3, answered_at=now()
        WHERE id=$1 RETURNING *`,
      [id, String(answer || "").slice(0, 4000), answeredBy || null]);
    return rows[0] || null;
  } catch (e) { console.error("[db] answerUnanswered", e.message); return null; }
}

// 言ってはいけない語で止めた記録
export async function addBlocked({ botId, word, text }) {
  if (!pool) return;
  try {
    await pool.query(`INSERT INTO kasasagi_blocked (bot_id, word, text) VALUES ($1,$2,$3)`,
      [botId || null, word || null, String(text || "").slice(0, 1000)]);
  } catch {}
}
export async function listBlocked(limit = 100) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT * FROM kasasagi_blocked ORDER BY created_at DESC LIMIT $1`, [limit]);
    return rows;
  } catch { return []; }
}

// 商談ごとの記録（営業へのフィードバックと次アクション）
export async function saveKasasagiReport(r) {
  if (!pool || !r?.botId) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO kasasagi_reports (bot_id, title, owner, feedback, next_action, spoken, answered, unanswered)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (bot_id) DO UPDATE SET title=$2, owner=$3, feedback=$4, next_action=$5,
         spoken=$6, answered=$7, unanswered=$8
       RETURNING *`,
      [r.botId, r.title || null, r.owner || null, r.feedback || null, r.nextAction || null,
       r.spoken || 0, r.answered || 0, r.unanswered || 0]);
    return rows[0];
  } catch (e) { console.error("[db] saveKasasagiReport", e.message); return null; }
}
export async function getKasasagiReport(botId) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(`SELECT * FROM kasasagi_reports WHERE bot_id=$1`, [botId]);
    return rows[0] || null;
  } catch { return null; }
}

// かささぎが商談で使ってよいナレッジだけを返す
export async function knowledgeForKasasagi(limit = 40) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT id, title, category, body FROM knowledge
        WHERE COALESCE(visibility,'both') IN ('both','kasasagi')
        ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT $1`, [limit]);
    return rows;
  } catch { return []; }
}

// ===== メンバー管理 =====
// 役割: closer（クローザー）／inside（インサイド＝アポ獲得）／fallback（予備）
// kincall だけ … kincall以外の画面に入れない人（インターン生など）
export const MEMBER_ROLES = ["closer", "inside", "fallback", "kincall"];
export const MEMBER_BUSINESSES = ["DOC", "MOCHICA"];

function normRoles(v) {
  const a = Array.isArray(v) ? v : [];
  return MEMBER_ROLES.filter((r) => a.includes(r));
}
function normBusinesses(v) {
  const a = Array.isArray(v) ? v : [];
  return MEMBER_BUSINESSES.filter((b) => a.includes(b));
}

// 署名・Zoom情報として保存する項目。想定外のキーは捨てる。
// 姓は名前から自動で判定する。自動判定が合わないときだけ shortName で上書きする。
// Zoomの情報は「設定 → 登録リンク」（myZoomLink）から取るので持たない。
export const MEMBER_PROFILE_FIELDS = [
  "shortName",   // 姓の上書き（空欄なら名前から自動で判定する）
  "nameRoman",   // ローマ字（例：Kinya Tanaka）
  "phone",       // 電話番号
  "dept",        // 部署（例：事業統括本部 事業開発部）
  "unit",        // ユニット・グループ（例：DOCユニット FSグループ）
];
function normProfile(v) {
  const src = (v && typeof v === "object") ? v : {};
  const out = {};
  for (const k of MEMBER_PROFILE_FIELDS) {
    const val = String(src[k] == null ? "" : src[k]).trim();
    if (val) out[k] = val.slice(0, 300);
  }
  return out;
}

// メールの差し込みに使うため、メールアドレス → プロフィール の対応を返す
export async function memberProfiles() {
  if (!pool) return {};
  try {
    const { rows } = await pool.query(`SELECT email, name, profile FROM members`);
    const out = {};
    for (const r of rows) {
      out[r.email] = { name: r.name, ...((r.profile && typeof r.profile === "object") ? r.profile : {}) };
    }
    return out;
  } catch { return {}; }
}

export async function listMembers() {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(`SELECT * FROM members ORDER BY sort_order, name`);
    return rows.map((r) => ({
      ...r,
      businesses: Array.isArray(r.businesses) ? r.businesses : [],
      roles: Array.isArray(r.roles) ? r.roles : [],
      profile: (r.profile && typeof r.profile === "object") ? r.profile : {},
    }));
  } catch { return []; }
}

// 画面から一覧まるごと保存する。渡されなかったメンバーは削除。
export async function saveMembers(list) {
  if (!pool || !Array.isArray(list)) return listMembers();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const emails = list.map((m) => String(m.email || "").trim().toLowerCase()).filter(Boolean);
    if (emails.length) await client.query(`DELETE FROM members WHERE email <> ALL($1::text[])`, [emails]);
    else await client.query(`DELETE FROM members`);
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const email = String(m.email || "").trim().toLowerCase();
      if (!email) continue;
      const cap = Number.isFinite(+m.daily_cap) && +m.daily_cap > 0 ? +m.daily_cap : null;
      await client.query(
        `INSERT INTO members (email, name, businesses, team, roles, active, daily_cap, sort_order, note, profile)
         VALUES ($1,$2,$3::jsonb,$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb)
         ON CONFLICT (email) DO UPDATE
           SET name=$2, businesses=$3::jsonb, team=$4, roles=$5::jsonb,
               active=$6, daily_cap=$7, sort_order=$8, note=$9, profile=$10::jsonb, updated_at=now()`,
        [email, String(m.name || "").trim() || email,
         JSON.stringify(normBusinesses(m.businesses)), String(m.team || "").trim() || null,
         JSON.stringify(normRoles(m.roles)), m.active !== false, cap, i + 1,
         String(m.note || "").slice(0, 300) || null,
         JSON.stringify(normProfile(m.profile))]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("[db] saveMembers", e.message);
  } finally { client.release(); }
  await syncMembersToLegacy();
  return listMembers();
}

export async function deleteMember(email) {
  if (!pool || !email) return;
  try { await pool.query(`DELETE FROM members WHERE email=$1`, [String(email).toLowerCase()]); } catch {}
  await syncMembersToLegacy();
}

// メンバー管理の内容を、既存の3テーブルへ反映する。
//  closer_rotation … クローザー／予備の人（ローテーションの状態は保ったまま）
//  interns         … インサイドの人（アポ獲得者マスタ）
//  rep_team_mapping… 担当者名→チーム（実績のチーム別集計用）
export async function syncMembersToLegacy() {
  if (!pool) return { closers: 0, interns: 0, teams: 0 };
  const out = { closers: 0, interns: 0, teams: 0 };
  try {
    const members = await listMembers();
    // メンバーが1人も登録されていないときに同期すると、既存の
    // クローザー設定やインターン登録を消してしまうため何もしない。
    if (!members.length) {
      console.log("[members] 未登録のため同期しません（既存の設定はそのまま）");
      return { ...out, skipped: true };
    }

    // --- クローザー（closer / fallback） ---
    const closers = members.filter((m) => m.roles.includes("closer") || m.roles.includes("fallback"));
    for (let i = 0; i < closers.length; i++) {
      const m = closers[i];
      await pool.query(
        `INSERT INTO closer_rotation (email, name, sort_order, active, daily_cap, team, fallback, businesses)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
         ON CONFLICT (email) DO UPDATE
           SET name=$2, active=$4, daily_cap=$5, team=$6, fallback=$7, businesses=$8::jsonb, updated_at=now()`,
        [m.email, m.name, i + 1, m.active !== false, m.daily_cap,
         m.team || null, m.roles.includes("fallback"), JSON.stringify(m.businesses || [])]
      );
    }
    const cEmails = closers.map((m) => m.email);
    if (cEmails.length) await pool.query(`DELETE FROM closer_rotation WHERE email <> ALL($1::text[])`, [cEmails]);
    else await pool.query(`DELETE FROM closer_rotation`);
    out.closers = closers.length;

    // --- インサイド（アポ獲得者） ---
    const insides = members.filter((m) => m.roles.includes("inside"));
    for (const m of insides) {
      await pool.query(
        `INSERT INTO interns (email, name) VALUES ($1,$2)
         ON CONFLICT (email) DO UPDATE SET name=$2`, [m.email, m.name]);
    }
    const iEmails = insides.map((m) => m.email);
    if (iEmails.length) await pool.query(`DELETE FROM interns WHERE email <> ALL($1::text[])`, [iEmails]);
    else await pool.query(`DELETE FROM interns`);
    out.interns = insides.length;

    // --- 担当者名→チーム（実績のチーム別集計） ---
    for (const m of members) {
      if (!m.team) continue;
      await pool.query(
        `INSERT INTO rep_team_mapping (rep_name, team_name, group_name, product)
         VALUES ($1,$2,'直販',$3)
         ON CONFLICT (rep_name) DO UPDATE SET team_name=$2, product=$3`,
        [m.name, m.team, m.businesses[0] || null]);
      out.teams++;
    }
    // チームが変わったので team_rotation も作り直す
    await syncTeamsFromClosers();
    console.log(`[members] 同期しました（クローザー${out.closers}名・インサイド${out.interns}名・チーム設定${out.teams}件）`);
  } catch (e) {
    console.error("[db] syncMembersToLegacy", e.message);
  }
  return out;
}

// メンバー未登録だが、システム内に名前が出ている人を拾う（登録漏れの案内用）
// 初回だけ：既存の closer_rotation・interns・rep_team_mapping から members を作る。
// これまでの登録を引き継ぐので、メンバー管理を開いた時点で一覧が埋まっている。
export async function seedMembersFromLegacy() {
  if (!pool) return { seeded: 0 };
  try {
    const { rows: has } = await pool.query(`SELECT 1 FROM members LIMIT 1`);
    if (has.length) return { seeded: 0, skipped: true };

    const [{ rows: closers }, { rows: interns }, { rows: maps }] = await Promise.all([
      pool.query(`SELECT * FROM closer_rotation ORDER BY sort_order`),
      pool.query(`SELECT * FROM interns ORDER BY name`),
      pool.query(`SELECT rep_name, team_name, COALESCE(product,'') AS product FROM rep_team_mapping`),
    ]);
    if (!closers.length && !interns.length) return { seeded: 0, empty: true };

    // 名前 → チーム・プロダクト（rep_team_mapping は名前で持っているため部分一致も見る）
    const findMap = (name) => {
      const n = String(name || "").trim();
      let hit = maps.find((m) => String(m.rep_name).trim() === n);
      if (!hit) hit = maps.find((m) => n && (n.includes(String(m.rep_name).trim()) || String(m.rep_name).trim().includes(n)));
      return hit || null;
    };

    const byEmail = new Map();
    const put = (email, name, role) => {
      const e = String(email || "").trim().toLowerCase();
      if (!e) return;
      const cur = byEmail.get(e) || { email: e, name: String(name || "").trim() || e, roles: [], businesses: [], team: null, daily_cap: null, active: true };
      if (!cur.roles.includes(role)) cur.roles.push(role);
      if (!cur.name || cur.name === e) cur.name = String(name || "").trim() || cur.name;
      byEmail.set(e, cur);
    };

    for (const c of closers) {
      put(c.email, c.name, c.fallback ? "fallback" : "closer");
      const m = byEmail.get(String(c.email).toLowerCase());
      m.team = c.team || m.team;
      m.daily_cap = c.daily_cap ?? m.daily_cap;
      m.active = c.active !== false;
      const bs = Array.isArray(c.businesses) ? c.businesses : [];
      if (bs.length) m.businesses = bs;
    }
    for (const i of interns) put(i.email, i.name, "inside");

    // チーム・プロダクトを名前から補う
    let n = 0;
    for (const m of byEmail.values()) {
      const hit = findMap(m.name);
      if (hit) {
        if (!m.team) m.team = hit.team_name || null;
        if (!m.businesses.length && hit.product) m.businesses = [hit.product];
      }
      n++;
      await pool.query(
        `INSERT INTO members (email, name, businesses, team, roles, active, daily_cap, sort_order)
         VALUES ($1,$2,$3::jsonb,$4,$5::jsonb,$6,$7,$8)
         ON CONFLICT (email) DO NOTHING`,
        [m.email, m.name, JSON.stringify(m.businesses), m.team,
         JSON.stringify(m.roles), m.active, m.daily_cap, n]
      );
    }
    console.log(`[members] 既存の登録から ${n}名を取り込みました（クローザー${closers.length}名・インターン${interns.length}名）`);
    return { seeded: n };
  } catch (e) {
    console.error("[db] seedMembersFromLegacy", e.message);
    return { seeded: 0, error: e.message };
  }
}

export async function memberCandidates() {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(`
      SELECT u.email, COALESCE(u.name, u.email) AS name, 'ユーザー' AS src FROM users u
       WHERE NOT EXISTS (SELECT 1 FROM members m WHERE m.email = u.email)
      UNION
      SELECT i.email, i.name, 'インターン登録' AS src FROM interns i
       WHERE NOT EXISTS (SELECT 1 FROM members m WHERE m.email = i.email)
      ORDER BY name`);
    return rows;
  } catch { return []; }
}

// ===== チーム単位のローテーション =====
// closer_rotation.team に入っているチーム名ぶんだけ、team_rotation に行を用意する。
export async function syncTeamsFromClosers() {
  if (!pool) return [];
  try {
    await pool.query(`
      INSERT INTO team_rotation (team_name, sort_order)
      SELECT DISTINCT COALESCE(NULLIF(TRIM(team), ''), '未設定'),
             ROW_NUMBER() OVER (ORDER BY MIN(sort_order))
        FROM closer_rotation
       GROUP BY COALESCE(NULLIF(TRIM(team), ''), '未設定')
      ON CONFLICT (team_name) DO NOTHING`);
    // クローザーが1人もいなくなったチームは外す
    await pool.query(`
      DELETE FROM team_rotation t
       WHERE NOT EXISTS (
         SELECT 1 FROM closer_rotation c
          WHERE COALESCE(NULLIF(TRIM(c.team), ''), '未設定') = t.team_name)`);
  } catch (e) { console.error("[db] syncTeamsFromClosers", e.message); }
  return listTeams();
}

export async function listTeams() {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(`SELECT * FROM team_rotation ORDER BY sort_order, team_name`);
    return rows;
  } catch { return []; }
}

export async function saveTeams(list) {
  if (!pool || !Array.isArray(list)) return listTeams();
  try {
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const name = String(t.team_name || "").trim();
      if (!name) continue;
      await pool.query(
        `INSERT INTO team_rotation (team_name, sort_order, active)
         VALUES ($1,$2,$3)
         ON CONFLICT (team_name) DO UPDATE SET sort_order=$2, active=$3, updated_at=now()`,
        [name, i + 1, t.active !== false]
      );
    }
  } catch (e) { console.error("[db] saveTeams", e.message); }
  return listTeams();
}

// そのチームで次に回ってくる人を記録する
export async function setTeamNext(team, email) {
  if (!pool) return;
  const name = String(team || "").trim() || "未設定";
  try {
    await pool.query(
      `INSERT INTO team_rotation (team_name, next_email) VALUES ($1,$2)
       ON CONFLICT (team_name) DO UPDATE SET next_email=$2, updated_at=now()`,
      [name, email || null]
    );
  } catch (e) { console.error("[db] setTeamNext", e.message); }
}

export async function markTeamAssigned(team) {
  if (!pool) return;
  const name = String(team || "").trim() || "未設定";
  try {
    await pool.query(
      `INSERT INTO team_rotation (team_name, assigned_count, last_assigned_at)
       VALUES ($1, 1, now())
       ON CONFLICT (team_name) DO UPDATE
         SET assigned_count = team_rotation.assigned_count + 1,
             last_assigned_at = now(), priority = false, updated_at = now()`,
      [name]
    );
  } catch (e) { console.error("[db] markTeamAssigned", e.message); }
}

// 飛ばされたチームに「次は優先」の印をつける
export async function markTeamsSkipped(teams) {
  if (!pool || !Array.isArray(teams) || !teams.length) return;
  try {
    await pool.query(
      `UPDATE team_rotation SET priority=true, updated_at=now() WHERE team_name = ANY($1::text[])`,
      [teams.map((t) => String(t || "").trim() || "未設定")]
    );
  } catch (e) { console.error("[db] markTeamsSkipped", e.message); }
}

export async function clearTeamPriority() {
  if (!pool) return;
  try { await pool.query(`UPDATE team_rotation SET priority=false, updated_at=now() WHERE priority`); } catch {}
}

// チーム別の実績。期間は商談日（start_time）のJST基準。
// 通算だけでなく人数も返すので、1人あたりの件数でも比べられる。
export async function teamAssignStats(fromISO, toISO, business = "") {
  if (!pool) return [];
  try {
    const params = [];
    let where = "";
    if (fromISO && toISO) { params.push(fromISO, toISO); where = `AND sl.start_time >= $1 AND sl.start_time < $2`; }
    // 事業の絞り込み。事業が未設定の人はどの事業でも対象にする（設定漏れで消えないように）。
    const b = String(business || "").trim();
    let bizWhere = "", bizMembers = "", bizDays = "";
    if (b) {
      params.push(b);
      const n = params.length;
      bizWhere = `AND (jsonb_array_length(cr.businesses) = 0 OR cr.businesses ? $${n})`;
      bizMembers = `WHERE (jsonb_array_length(businesses) = 0 OR businesses ? $${n})`;
      bizDays = `AND (jsonb_array_length(c.businesses) = 0 OR c.businesses ? $${n})`;
    }
    // 稼働日の計算に使う期間。通算のときは開始日を渡してもらう（無ければ90日前）。
    params.push(fromISO || null, toISO || null);
    const fromParam = `COALESCE($${params.length - 1}::date, (now() AT TIME ZONE 'Asia/Tokyo')::date - 90)`;
    const toParam = `LEAST(COALESCE($${params.length}::date, (now() AT TIME ZONE 'Asia/Tokyo')::date + 1), (now() AT TIME ZONE 'Asia/Tokyo')::date + 1)`;
    const { rows } = await pool.query(`
      WITH members AS (
        SELECT COALESCE(NULLIF(TRIM(team), ''), '未設定') AS team,
               COUNT(*)::int                                             AS members,
               -- 1人あたりの計算では、予備メンバーは通常の頭数に入れない
               COUNT(*) FILTER (WHERE active AND NOT fallback)::int      AS active_members,
               COUNT(*) FILTER (WHERE fallback)::int                     AS fallback_members
          FROM closer_rotation ${bizMembers} GROUP BY 1
      ), counts AS (
        SELECT COALESCE(NULLIF(TRIM(cr.team), ''), '未設定') AS team,
               COUNT(*)::int AS cnt
          FROM smart_links sl
          JOIN closer_rotation cr ON cr.email = sl.current_owner
         -- 予備（フォールバック）に振られたアポは、均等化の件数に数えない。
         -- 稼働人日（分母）も予備を除いているので、これで分子・分母がそろう。
         WHERE COALESCE(sl.current_owner,'') <> '' AND NOT sl.excluded
               AND NOT cr.fallback ${where} ${bizWhere}
         GROUP BY 1
      ), base AS (
        -- 過去の実績（取り込み分）。kinbotで配る前の件数も均等化に反映させる。
        -- ここも予備（フォールバック）ぶんは数えない。
        SELECT COALESCE(NULLIF(TRIM(team), ''), '未設定') AS team,
               COALESCE(SUM(baseline_count) FILTER (WHERE NOT fallback), 0)::int AS base
          FROM closer_rotation ${bizMembers} GROUP BY 1
      ), days AS (
        -- 稼働人日：期間の日数から停止日数を引いた「配れた日数」の合計。
        -- 停止で件数が減った人・チームを、あとから優先して埋め合わせないための分母。
        SELECT COALESCE(NULLIF(TRIM(c.team), ''), '未設定') AS team,
               COALESCE(SUM(
                 GREATEST(0, (${toParam} - ${fromParam}))
                 - COALESCE((
                     SELECT SUM(GREATEST(0,
                              LEAST(COALESCE(s.end_date + 1, ${toParam}), ${toParam})
                              - GREATEST(s.start_date, ${fromParam})))
                       FROM closer_suspensions s
                      WHERE s.email = c.email
                        AND s.start_date < ${toParam}
                        AND COALESCE(s.end_date + 1, ${toParam}) > ${fromParam}
                   ), 0)
               ), 0)::int AS person_days
          FROM closer_rotation c
         WHERE c.active AND NOT c.fallback ${bizDays}
         GROUP BY 1
      )
      SELECT m.team,
             m.members, m.active_members, m.fallback_members,
             COALESCE(c.cnt, 0) + COALESCE(bs.base, 0) AS cnt,
             COALESCE(c.cnt, 0) AS cnt_kinbot,
             COALESCE(bs.base, 0) AS base_cnt,
             COALESCE(dy.person_days, 0) AS person_days,
             COALESCE(t.assigned_count, 0) AS total_all_time,
             COALESCE(t.active, true)      AS active,
             COALESCE(t.priority, false)   AS priority,
             COALESCE(t.sort_order, 1)     AS sort_order,
             t.last_assigned_at
        FROM members m
        LEFT JOIN counts c       ON c.team = m.team
        LEFT JOIN base   bs      ON bs.team = m.team
        LEFT JOIN days   dy      ON dy.team = m.team
        LEFT JOIN team_rotation t ON t.team_name = m.team
       ORDER BY COALESCE(t.sort_order, 1), m.team`, params);
    return rows.map((r) => ({
      team: r.team, members: r.members, activeMembers: r.active_members,
      fallbackMembers: r.fallback_members,
      count: r.cnt, countKinbot: r.cnt_kinbot, baseline: r.base_cnt,
      personDays: r.person_days,
      // 稼働1日あたりの件数。停止期間は分母から除かれている。
      perDay: r.person_days ? +(r.cnt / r.person_days).toFixed(3) : null,
      totalAllTime: r.total_all_time,
      perHead: r.active_members ? +(r.cnt / r.active_members).toFixed(2) : null,
      active: r.active, priority: r.priority, sortOrder: r.sort_order,
      lastAssignedAt: r.last_assigned_at,
    }));
  } catch (e) { console.error("[db] teamAssignStats", e.message); return []; }
}

// クローザー別の件数（同じ期間で、チーム内の偏りも見られるように）
export async function closerAssignStats(fromISO, toISO) {
  if (!pool) return {};
  try {
    const params = [];
    let where = "";
    if (fromISO && toISO) { params.push(fromISO, toISO); where = `AND start_time >= $1 AND start_time < $2`; }
    const { rows } = await pool.query(
      `SELECT current_owner AS email, COUNT(*)::int AS cnt FROM smart_links
        WHERE COALESCE(current_owner,'') <> '' AND NOT excluded ${where} GROUP BY 1`, params);
    const out = {};
    for (const r of rows) out[r.email] = r.cnt;
    // 過去の実績（取り込み分）を足す
    const { rows: bs } = await pool.query(
      `SELECT email, baseline_count FROM closer_rotation WHERE baseline_count > 0`);
    for (const r of bs) out[r.email] = (out[r.email] || 0) + r.baseline_count;
    return out;
  } catch { return {}; }
}

// 過去の実績を保存する（メールアドレス → 件数）
export async function saveBaselineCounts(map) {
  if (!pool || !map || typeof map !== "object") return listClosers();
  try {
    for (const [email, n] of Object.entries(map)) {
      const v = Math.max(0, parseInt(n, 10) || 0);
      await pool.query(
        `UPDATE closer_rotation SET baseline_count=$2, updated_at=now() WHERE email=$1`,
        [String(email).toLowerCase(), v]);
    }
  } catch (e) { console.error("[db] saveBaselineCounts", e.message); }
  return listClosers();
}

// ===== Gmail操作ログ =====
export async function logGmailAction({ owner, threadId, action, subject, fromAddr }) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO gmail_actions (owner, thread_id, action, subject, from_addr)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [owner || "", threadId || "", action, (subject || "").slice(0, 300), (fromAddr || "").slice(0, 200)]
    );
    return rows[0];
  } catch (e) { console.error("[db] logGmailAction", e.message); return null; }
}

// 直近の操作履歴（元に戻したいときに使う）
export async function listGmailActions(owner, limit = 50) {
  if (!pool) return [];
  try {
    const { rows } = owner
      ? await pool.query(`SELECT * FROM gmail_actions WHERE owner=$1 ORDER BY created_at DESC LIMIT $2`, [owner, limit])
      : await pool.query(`SELECT * FROM gmail_actions ORDER BY created_at DESC LIMIT $1`, [limit]);
    return rows;
  } catch { return []; }
}

// 前日リマインドの対象：指定の時間帯に商談があり、担当・宛先が揃っていて、まだ送っていないもの
// 前日リマインドの対象を取る。
//   forList = true … 画面に出す用。宛先が無いもの・送信済みのものも含めて全部返す
//                     （「なぜ送られないのか」を見せるため）
//   forList = false … 実際に送る用。宛先があり、まだ送っていないものだけ
// 確定メールを送ってから、まだ日が浅いアポは、リマインドを出さない。
// 「今日アポを取って明日商談」のとき、案内とリマインドが続けて届いてしまうため。
export const REMIND_GAP_HOURS = 20;

export async function listApoReminderTargets(fromISO, toISO, { forList = false, gapHours } = {}) {
  if (!pool) return [];
  try {
    const gap = Math.max(0, Math.min(72, Number(gapHours ?? REMIND_GAP_HOURS)));
    const cond = forList
      ? ""
      : `AND NOT COALESCE(s.no_reminder, false)
         AND COALESCE(s.current_owner,'') <> ''
         AND COALESCE(s.client_email,'') <> ''
         -- 確定メールを送ったばかりのものは出さない（案内とリマインドが続けて届くため）
         AND NOT EXISTS (
               SELECT 1 FROM apo_mail_log c
                WHERE c.slug = s.slug AND c.kind = 'confirm'
                  AND c.status IN ('sent','draft')
                  AND c.created_at > now() - interval '1 hour' * ${gap})
         AND NOT EXISTS (
               SELECT 1 FROM apo_mail_log l
                WHERE l.slug = s.slug AND l.kind = 'reminder' AND l.status IN ('sent','draft'))`;
    const { rows } = await pool.query(
      `SELECT s.*,
              EXISTS (SELECT 1 FROM apo_mail_log l
                       WHERE l.slug = s.slug AND l.kind = 'reminder'
                         AND l.status IN ('sent','draft')) AS reminded,
              EXISTS (SELECT 1 FROM apo_mail_log c
                       WHERE c.slug = s.slug AND c.kind = 'confirm'
                         AND c.status IN ('sent','draft')
                         AND c.created_at > now() - interval '1 hour' * ${gap}) AS just_confirmed
         FROM smart_links s
        WHERE s.start_time >= $1 AND s.start_time < $2
          AND NOT COALESCE(s.excluded, false)
          ${cond}
        ORDER BY s.start_time`,
      [fromISO, toISO]
    );
    return rows;
  } catch (e) { console.error("[db] listApoReminderTargets", e.message); return []; }
}
// ===== Feature C: 商談特徴タグ =====
// 1案件=1レコード。判定完了時と手動バックフィルの両方から呼ばれる。
// UPSERTなので何度呼んでも冪等。resultは呼び出し側で案件ステータスから決めて渡す想定。
export async function upsertDealFeatureTags(dealId, tags) {
  if (!pool || !dealId) return;
  const cols = [
    "deal_id","first_meeting_date","owner","team",
    "customer_employee_size","target_hire_count","hiring_type_need","customer_hq_region",
    "customer_industry","target_job_type",
    "customer_response_status","decision_maker_present","competitor_mentioned","key_pain_points",
    "appeal_points_used","talk_patterns","talk_example","meeting_stages","discovery_items_covered","objection_handling_style",
    "objections_raised","tag_confidence","result","raw_extraction","updated_at",
  ];
  const jsonCols = new Set(["target_job_type","key_pain_points","appeal_points_used","talk_patterns","meeting_stages","discovery_items_covered","objections_raised","raw_extraction"]);
  const boolCols = new Set(["decision_maker_present","competitor_mentioned"]);
  const dateCols = new Set(["first_meeting_date"]);
  const vals = [dealId];
  const placeholders = ["$1"];
  cols.slice(1).forEach((c, i) => {
    const idx = i + 2;
    if (c === "updated_at") { placeholders.push("now()"); return; }
    let v = tags[c];
    if (v === undefined) v = null;
    // 型の正規化
    if (jsonCols.has(c) && v != null) v = JSON.stringify(v);
    if (boolCols.has(c)) v = v === true ? true : v === false ? false : null;
    if (dateCols.has(c)) {
      // "Wed Jul 01" や "" や undefined → null or YYYY-MM-DD
      if (!v || v === "" || v === "undefined" || v === "null") { v = null; }
      else if (typeof v === "string" && !/^\d{4}-\d{2}-\d{2}/.test(v)) {
        const parsed = new Date(v);
        v = isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
      } else if (v instanceof Date) {
        v = v.toISOString().slice(0, 10);
      }
    }
    vals.push(v);
    placeholders.push(`$${idx}`);
  });
  const updateSet = cols.slice(1).map((c) => c === "updated_at" ? `updated_at=now()` : `${c}=EXCLUDED.${c}`).join(", ");
  const sql = `
    INSERT INTO deal_feature_tags (${cols.join(", ")})
    VALUES (${placeholders.join(", ")})
    ON CONFLICT (deal_id) DO UPDATE SET ${updateSet}
  `;
  try {
    await pool.query(sql, vals);
  } catch (e) {
    console.error("[db] upsertDealFeatureTags FAILED:", e.message);
    console.error("[db] upsertDealFeatureTags SQL:", sql.replace(/\s+/g, " ").trim().slice(0, 300));
    console.error("[db] upsertDealFeatureTags vals count:", vals.length, "placeholders count:", placeholders.length);
    console.error("[db] upsertDealFeatureTags deal_id:", dealId, "sample vals:", JSON.stringify(vals.slice(0, 5)));
    throw e;
  }
}

// 集計用に一括取得。owner/期間で絞り込み可能。
export async function listDealFeatureTags({ owner, from, to } = {}) {
  if (!pool) return [];
  const cond = [], vals = [];
  let i = 1;
  if (owner) { cond.push(`owner = $${i++}`); vals.push(owner); }
  if (from)  { cond.push(`first_meeting_date >= $${i++}`); vals.push(from); }
  if (to)    { cond.push(`first_meeting_date <= $${i++}`); vals.push(to); }
  const where = cond.length ? `WHERE ${cond.join(" AND ")}` : "";
  try {
    const { rows } = await pool.query(`SELECT * FROM deal_feature_tags ${where}`, vals);
    return rows;
  } catch (e) { console.error("[db] listDealFeatureTags", e.message); return []; }
}

// バックフィル用：deal_feature_tagsテーブルに未登録の初回商談を持つ案件を列挙する
export async function listDealsNeedingFeatureTags({ limit = 1000 } = {}) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(`
      SELECT d.deal_id, d.company_name, d.owner, d.team, d.status,
             (SELECT ev.bot_id FROM deal_events ev WHERE ev.deal_id=d.deal_id AND ev.event_type='初回商談' AND ev.meeting_kind='初回商談' ORDER BY ev.event_date DESC LIMIT 1) AS bot_id,
             (SELECT ev.event_date FROM deal_events ev WHERE ev.deal_id=d.deal_id AND ev.event_type='初回商談' AND ev.meeting_kind='初回商談' ORDER BY ev.event_date DESC LIMIT 1) AS first_meeting_date
      FROM deals d
      WHERE d.deal_id NOT IN (
        SELECT deal_id FROM deal_feature_tags
        WHERE customer_employee_size IS DISTINCT FROM '不明'
           OR target_hire_count IS DISTINCT FROM '未定'
           OR hiring_type_need IS NOT NULL
      )
      LIMIT $1
    `, [limit]);
    return rows.filter((r) => r.bot_id);
  } catch (e) { console.error("[db] listDealsNeedingFeatureTags", e.message); return []; }
}

// ===== Feature C フェーズ3: 企業属性マスタ（依頼書5.2） =====
export async function upsertEnterpriseAttributes(companyName, attrs) {
  if (!pool || !companyName) return;
  try {
    await pool.query(`
      INSERT INTO enterprise_attributes (company_name, industry, industry_confidence, recruiting_job_types, job_type_confidence, last_enriched_at)
      VALUES ($1, $2, $3, $4, $5, now())
      ON CONFLICT (company_name) DO UPDATE SET
        industry = EXCLUDED.industry,
        industry_confidence = EXCLUDED.industry_confidence,
        recruiting_job_types = EXCLUDED.recruiting_job_types,
        job_type_confidence = EXCLUDED.job_type_confidence,
        last_enriched_at = now()
    `, [companyName, attrs.industry || null, attrs.industry_confidence || null,
        attrs.recruiting_job_types ? JSON.stringify(attrs.recruiting_job_types) : null,
        attrs.job_type_confidence || null]);
  } catch (e) { console.error("[db] upsertEnterpriseAttributes", e.message); }
}

export async function getEnterpriseAttributesMap() {
  if (!pool) return {};
  try {
    const { rows } = await pool.query(`SELECT * FROM enterprise_attributes`);
    const map = {};
    for (const r of rows) map[r.company_name] = r;
    return map;
  } catch { return {}; }
}

// エンリッチメント対象：dealsに登場する会社のうち、属性未取得 or 6ヶ月以上前に取得した会社
export async function listCompaniesNeedingEnrichment({ limit = 20, staleDays = 180 } = {}) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(`
      SELECT DISTINCT d.company_name
      FROM deals d
      LEFT JOIN enterprise_attributes ea ON ea.company_name = d.company_name
      WHERE d.company_name IS NOT NULL AND d.company_name <> ''
        AND (ea.company_name IS NULL OR ea.last_enriched_at < now() - ($2 || ' days')::interval)
      LIMIT $1
    `, [limit, String(staleDays)]);
    return rows.map((r) => r.company_name);
  } catch (e) { console.error("[db] listCompaniesNeedingEnrichment", e.message); return []; }
}

// Feature C: タグを全件削除（再抽出用）
export async function clearAllDealFeatureTags() {
  if (!pool) return 0;
  try {
    const r = await pool.query(`DELETE FROM deal_feature_tags`);
    return r.rowCount || 0;
  } catch (e) { console.error("[db] clearAllDealFeatureTags", e.message); return 0; }
}

// Feature C: 会社プロフィールから業界をタグテーブルに一括反映
export async function fillIndustryFromProfiles() {
  if (!pool) return { updated: 0 };
  try {
    const deals = await pool.query(`SELECT deal_id, company_name FROM deals`);
    const accounts = await pool.query(`SELECT key, profile FROM accounts`);
    const profMap = {};
    for (const a of accounts.rows) {
      const p = a.profile;
      if (p) profMap[a.key] = p;
    }
    let updated = 0;
    for (const d of deals.rows) {
      const prof = profMap[d.company_name];
      if (!prof) continue;
      const sets = [];
      const vals = [];
      let i = 1;
      // 業界：プロフィールにあれば上書き（タグ側が「不明」や空なら）
      if (prof.industry) {
        sets.push(`customer_industry = $${i++}`);
        vals.push(prof.industry);
      }
      // 従業員規模：プロフィールの従業員数から規模区分に変換
      if (prof.employees) {
        const size = employeeCountToSize(prof.employees);
        if (size) {
          sets.push(`customer_employee_size = $${i++}`);
          vals.push(size);
        }
      }
      // 本社地域：プロフィールの住所から都道府県を抽出
      if (prof.location) {
        const m = String(prof.location).match(/^(北海道|東京都|大阪府|京都府|.{2,3}県)/);
        if (m) {
          sets.push(`customer_hq_region = $${i++}`);
          vals.push(m[1]);
        }
      }
      if (!sets.length) continue;
      vals.push(d.deal_id);
      const r = await pool.query(
        `UPDATE deal_feature_tags SET ${sets.join(", ")} WHERE deal_id = $${i} AND (customer_industry IS NULL OR customer_industry = '' OR customer_industry = '不明' OR customer_employee_size IS NULL OR customer_employee_size = '不明' OR customer_hq_region IS NULL OR customer_hq_region = '不明')`,
        vals
      );
      if (r.rowCount > 0) updated++;
    }
    return { updated, total: deals.rows.length };
  } catch (e) { console.error("[db] fillIndustryFromProfiles", e.message); return { updated: 0, error: e.message }; }
}

// 従業員数の文字列（"600名"、"300人"、"1,200名"等）を規模区分に変換
function employeeCountToSize(empStr) {
  if (!empStr) return "";
  const num = parseInt(String(empStr).replace(/^約/, "").replace(/[,，]/g, "").replace(/[名人].*$/, ""), 10);
  if (isNaN(num)) return "";
  if (num <= 50) return "〜50人";
  if (num <= 200) return "51〜200人";
  if (num <= 500) return "201〜500人";
  if (num <= 1000) return "501〜1000人";
  return "1001人以上";
}

// ===== 提案資料 =====
export async function insertProposalFile(data) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `INSERT INTO proposal_files (deal_id, slide_url, slide_id, filename, uploaded_by, summary, extracted_text, tags, company_name, industry, employee_size, region, result)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [data.deal_id, data.slide_url, data.slide_id, data.filename, data.uploaded_by,
     data.summary, data.extracted_text, JSON.stringify(data.tags || {}),
     data.company_name, data.industry, data.employee_size, data.region, data.result]
  );
  return rows[0];
}

export async function listProposalFiles({ deal_id, search, industry, employee_size, region, result } = {}) {
  if (!pool) return [];
  let sql = `SELECT * FROM proposal_files WHERE 1=1`;
  const vals = [];
  if (deal_id) { vals.push(deal_id); sql += ` AND deal_id = $${vals.length}`; }
  if (industry) { vals.push(industry); sql += ` AND industry = $${vals.length}`; }
  if (employee_size) { vals.push(employee_size); sql += ` AND employee_size = $${vals.length}`; }
  if (region) { vals.push(region); sql += ` AND region = $${vals.length}`; }
  if (result) { vals.push(result); sql += ` AND result = $${vals.length}`; }
  if (search) { vals.push(`%${search}%`); sql += ` AND (extracted_text ILIKE $${vals.length} OR summary ILIKE $${vals.length} OR company_name ILIKE $${vals.length} OR filename ILIKE $${vals.length})`; }
  sql += ` ORDER BY uploaded_at DESC LIMIT 100`;
  const { rows } = await pool.query(sql, vals);
  return rows;
}

export async function deleteProposalFile(id) {
  if (!pool) return;
  await pool.query(`DELETE FROM proposal_files WHERE id = $1`, [id]);
}

// ===== 顧客の温度感ランキング用 =====
// 見出しだけを取る（文字起こしは重いので含めない）
// days に 0 以下を渡すと期間でしぼらず全件が対象になる
export async function listRecentMeetingHeads({ days = 0, limit = 400 } = {}) {
  if (!pool) return [];
  const cols = `m.bot_id, m.title, m.rep_name, m.owner, m.created_at, m.updated_at,
                m.round_no, m.phase, COALESCE(m.account,'') AS account, u.name AS owner_name`;
  const from = `FROM meetings m LEFT JOIN users u ON u.email = m.owner`;
  const hasTr = `jsonb_typeof(m.transcript)='array' AND jsonb_array_length(m.transcript) > 0`;
  if (days > 0) {
    const { rows } = await pool.query(
      `SELECT ${cols} ${from} WHERE ${hasTr} AND m.created_at >= now() - make_interval(days => $1)
       ORDER BY m.created_at DESC LIMIT $2`, [days, limit]);
    return rows;
  }
  const { rows } = await pool.query(
    `SELECT ${cols} ${from} WHERE ${hasTr} ORDER BY m.created_at DESC LIMIT $1`, [limit]);
  return rows;
}

// 指定した商談の文字起こしだけを取る
export async function getTranscriptsByIds(ids) {
  if (!pool || !ids || !ids.length) return [];
  const { rows } = await pool.query(
    `SELECT bot_id, transcript FROM meetings WHERE bot_id = ANY($1::text[])`,
    [ids]
  );
  return rows;
}

// 文字起こしが無い（＝履歴一覧に出ない）商談を調べる用
export async function listMeetingsWithoutTranscript({ days = 30, limit = 50 } = {}) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT m.bot_id, m.title, m.owner, m.rep_name, m.meeting_url, m.created_at,
              m.drive_file_id, m.drive_link, m.mux_playback_id,
              (m.transcript IS NULL) AS no_transcript_col
         FROM meetings m
        WHERE m.created_at >= now() - make_interval(days => $1)
          AND NOT (jsonb_typeof(m.transcript)='array' AND jsonb_array_length(m.transcript) > 0)
        ORDER BY m.created_at DESC LIMIT $2`,
      [days, limit]
    );
    return rows;
  } catch (e) {
    console.error("[db] listMeetingsWithoutTranscript", e.message);
    return [];
  }
}


// ===== 商談から集めた「質問と回答」 =====

// 質問から検索用のキーワードを取り出す（助詞などを落とす）
export function qaKeywords(text) {
  // 日本語は分かち書きが無いので、漢字・カタカナ・英数字のまとまりを内容語として取り出す
  const hits = String(text || "").match(/[一-龥々]{2,}|[ァ-ヺー]{2,}|[A-Za-z0-9]{2,}/g) || [];
  const stop = new Set(["御社", "弊社", "場合", "確認", "対応", "実際", "今回", "以下", "以上", "内容", "感じ"]);
  const out = [];
  for (const w of hits) {
    const v = w.trim();
    if (!v || v.length < 2 || stop.has(v)) continue;
    if (!out.includes(v)) out.push(v);
  }
  return out.slice(0, 12);
}

export async function addQaPairs(pairs, { botId, company, repName } = {}) {
  if (!pool || !Array.isArray(pairs) || !pairs.length) return 0;
  let n = 0;
  for (const p of pairs) {
    const q = String(p.question || "").trim();
    const a = String(p.answer || "").trim();
    if (q.length < 5 || a.length < 5) continue;
    try {
      // 同じ商談で同じ質問は入れない
      const dup = await pool.query(
        `SELECT id FROM qa_bank WHERE bot_id=$1 AND question=$2 LIMIT 1`, [botId || "", q]
      );
      if (dup.rows.length) continue;
      await pool.query(
        `INSERT INTO qa_bank (question, answer, topic, keywords, bot_id, company, rep_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [q, a, p.topic || "", qaKeywords(q).join(" "), botId || "", company || "", repName || ""]
      );
      n++;
    } catch (e) {
      console.error("[qa_bank] 保存", e.message);
    }
  }
  return n;
}

// 質問に近い過去の質問と回答を探す（キーワードの一致数で並べる）
export async function searchQaBank(question, limit = 5) {
  if (!pool) return [];
  const keys = qaKeywords(question);
  if (!keys.length) return [];
  try {
    const { rows } = await pool.query(
      `SELECT id, question, answer, topic, keywords, company, rep_name, good, created_at
         FROM qa_bank ORDER BY created_at DESC LIMIT 800`
    );
    const scored = rows.map((r) => {
      const rk = String(r.keywords || "").split(" ").filter(Boolean);
      let score = 0;
      for (const k of keys) {
        if (rk.includes(k)) score += 2;
        else if (rk.some((x) => x.includes(k) || k.includes(x))) score += 1;
      }
      score += Math.min(3, Number(r.good) || 0);
      return { ...r, score };
    }).filter((r) => r.score >= 2);
    scored.sort((a, b) => b.score - a.score || new Date(b.created_at) - new Date(a.created_at));
    return scored.slice(0, limit);
  } catch (e) {
    console.error("[qa_bank] 検索", e.message);
    return [];
  }
}

// 一覧（設定画面用）。よく出る質問の順に並べる。
export async function listQaBank({ q = "", limit = 200 } = {}) {
  if (!pool) return [];
  try {
    const where = q ? `WHERE question ILIKE $2 OR answer ILIKE $2` : "";
    const vals = q ? [limit, "%" + q + "%"] : [limit];
    const { rows } = await pool.query(
      `SELECT id, question, answer, topic, company, rep_name, good, created_at
         FROM qa_bank ${where} ORDER BY created_at DESC LIMIT $1`, vals
    );
    return rows;
  } catch { return []; }
}

export async function deleteQaBank(id) {
  if (!pool) return;
  try { await pool.query(`DELETE FROM qa_bank WHERE id=$1`, [id]); } catch {}
}
export async function markQaGood(id, delta = 1) {
  if (!pool) return;
  try { await pool.query(`UPDATE qa_bank SET good = COALESCE(good,0) + $2 WHERE id=$1`, [id, delta]); } catch {}
}


// すでに取り込み済みの商談ID
export async function qaBankBotIds() {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(`SELECT DISTINCT bot_id FROM qa_bank WHERE bot_id <> ''`);
    return rows.map((r) => r.bot_id);
  } catch { return []; }
}

// これまでに録音した会議URLの使用回数（よく使うZoom部屋を判定するため）
export async function recentMeetingUrls(limit = 600) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT meeting_url, owner, created_at FROM meetings
        WHERE meeting_url IS NOT NULL AND meeting_url <> ''
        ORDER BY created_at DESC LIMIT $1`, [limit]
    );
    return rows;
  } catch { return []; }
}


// ===== 利用状況 =====
export async function addUsageEvents(owner, events) {
  if (!pool || !Array.isArray(events) || !events.length) return 0;
  const rows = events.slice(0, 100);
  try {
    const vals = [];
    const ph = rows.map((e, i) => {
      const b = i * 4;
      vals.push(owner || "", String(e.page || "").slice(0, 60), String(e.kind || "click").slice(0, 20), String(e.label || "").slice(0, 120));
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4})`;
    }).join(",");
    await pool.query(`INSERT INTO usage_events (owner, page, kind, label) VALUES ${ph}`, vals);
    return rows.length;
  } catch (e) {
    console.error("[usage]", e.message);
    return 0;
  }
}

export async function usageSummary(days = 14, owner = "") {
  if (!pool) return null;
  const d = Math.max(1, Math.min(180, Number(days) || 14));
  const since = `now() - make_interval(days => ${d})`;
  const own = String(owner || "").trim();
  // ownerを指定したときだけ、その人に絞る。ユーザー入力なのでパラメータ化（$1）で安全に。
  const oc = own ? " AND owner = $1" : "";
  const op = own ? [own] : [];
  const q = async (sql, params = []) => { try { return (await pool.query(sql, params)).rows; } catch { return []; } };
  const [byDay, byPage, topActions, byUser, total] = await Promise.all([
    q(`SELECT to_char(created_at AT TIME ZONE 'Asia/Tokyo','YYYY-MM-DD') AS day,
              COUNT(*) AS events, COUNT(DISTINCT owner) AS users
         FROM usage_events WHERE created_at >= ${since}${oc}
        GROUP BY 1 ORDER BY 1`, op),
    q(`SELECT page, COUNT(*) FILTER (WHERE kind='page') AS views, COUNT(*) FILTER (WHERE kind='click') AS clicks
         FROM usage_events WHERE created_at >= ${since}${oc}
        GROUP BY page ORDER BY views DESC NULLS LAST, clicks DESC LIMIT 30`, op),
    q(`SELECT page, label, COUNT(*) AS n
         FROM usage_events WHERE created_at >= ${since} AND kind='click' AND label <> ''${oc}
        GROUP BY page, label ORDER BY n DESC LIMIT 40`, op),
    // メンバー別（選ぶ側）は、絞り込みに関係なく常に全員を返す
    q(`SELECT owner, COUNT(*) AS events,
              COUNT(DISTINCT to_char(created_at AT TIME ZONE 'Asia/Tokyo','YYYY-MM-DD')) AS days,
              MAX(created_at) AS last_at
         FROM usage_events WHERE created_at >= ${since} AND owner <> ''
        GROUP BY owner ORDER BY events DESC LIMIT 50`),
    q(`SELECT COUNT(*) AS events, COUNT(DISTINCT owner) AS users FROM usage_events WHERE created_at >= ${since}${oc}`, op),
  ]);
  return { days: d, owner: own, byDay, byPage, topActions, byUser, total: total[0] || { events: 0, users: 0 } };
}

// 使われていない機能を出すために、押された操作名の一覧を返す（ownerで絞れる）
export async function usageLabels(days = 30, owner = "") {
  if (!pool) return [];
  const d = Math.max(1, Math.min(180, Number(days) || 30));
  const own = String(owner || "").trim();
  const oc = own ? " AND owner = $1" : "";
  const op = own ? [own] : [];
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT label FROM usage_events
        WHERE created_at >= now() - make_interval(days => ${d}) AND kind='click' AND label <> ''${oc}`,
      op
    );
    return rows.map((r) => r.label);
  } catch { return []; }
}


// ===== 商談後にやること =====
export async function getFollowup(botId) {
  if (!pool || !botId) return null;
  try {
    const { rows } = await pool.query(`SELECT * FROM meeting_followup WHERE bot_id=$1`, [botId]);
    return rows[0] || null;
  } catch { return null; }
}

export async function saveFollowup(botId, f = {}) {
  if (!pool || !botId) return;
  const sets = [], vals = [botId];
  const put = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
  if (f.thanksDone !== undefined) put("thanks_done", !!f.thanksDone);
  if (f.nextDone !== undefined) put("next_done", !!f.nextDone);
  if (f.sfDone !== undefined) put("sf_done", !!f.sfDone);
  if (f.nextDate !== undefined) put("next_date", f.nextDate || null);
  if (f.nextType !== undefined) put("next_type", f.nextType || "");
  if (f.nextMemo !== undefined) put("next_memo", f.nextMemo || "");
  if (!sets.length) return;
  try {
    await pool.query(
      `INSERT INTO meeting_followup (bot_id) VALUES ($1) ON CONFLICT (bot_id) DO NOTHING`, [botId]
    );
    await pool.query(
      `UPDATE meeting_followup SET ${sets.join(", ")}, updated_at=now() WHERE bot_id=$1`, vals
    );
  } catch (e) {
    console.error("[followup]", e.message);
  }
}

// まだ終わっていない商談後のフォロー（ホームの表示用）
export async function listOpenFollowups(days = 3) {
  if (!pool) return [];
  const d = Math.max(1, Math.min(30, Number(days) || 3));
  try {
    const { rows } = await pool.query(
      `SELECT m.bot_id, m.title, m.owner, m.created_at, u.name AS owner_name,
              COALESCE(f.thanks_done,false) AS thanks_done,
              COALESCE(f.next_done,false)   AS next_done,
              COALESCE(f.sf_done,false)     AS sf_done
         FROM meetings m
         LEFT JOIN meeting_followup f ON f.bot_id = m.bot_id
         LEFT JOIN users u ON u.email = m.owner
        WHERE m.created_at >= now() - make_interval(days => ${d})
          AND jsonb_typeof(m.transcript)='array' AND jsonb_array_length(m.transcript) > 0
          AND NOT (COALESCE(f.thanks_done,false) AND COALESCE(f.next_done,false) AND COALESCE(f.sf_done,false))
        ORDER BY m.created_at DESC LIMIT 50`
    );
    return rows;
  } catch { return []; }
}


// 商談の段階（章）を保存・取得
export async function saveChapters(botId, chapters) {
  if (!pool || !botId) return;
  try {
    await pool.query(`UPDATE meetings SET chapters=$2, updated_at=now() WHERE bot_id=$1`,
      [botId, JSON.stringify(chapters || [])]);
  } catch (e) { console.error("[chapters]", e.message); }
}


// 録画のGoogleドライブ保存先を記録する
export async function saveDriveFile(botId, { fileId, link }) {
  if (!pool || !botId) return;
  try {
    await pool.query(`UPDATE meetings SET drive_file_id=$2, drive_link=$3, updated_at=now() WHERE bot_id=$1`,
      [botId, fileId || null, link || null]);
  } catch (e) { console.error("[drive]", e.message); }
}


// ライブ配信を使った商談の本数と、おおよその配信時間（Muxの費用の目安）
export async function muxLiveUsage(days = 30) {
  if (!pool) return null;
  const d = Math.max(1, Math.min(365, Number(days) || 30));
  try {
    const { rows } = await pool.query(
      `SELECT bot_id, created_at, updated_at, mux_playback_id,
              jsonb_array_length(COALESCE(transcript,'[]'::jsonb)) AS n
         FROM meetings
        WHERE created_at >= now() - make_interval(days => ${d})`
    );
    let live = 0, all = 0, minutes = 0;
    for (const r of rows) {
      all++;
      if (!r.mux_playback_id) continue;
      live++;
      // 開始から最終更新までを配信時間の目安にする（取れなければ45分とみなす）
      const st = r.created_at ? new Date(r.created_at).getTime() : 0;
      const en = r.updated_at ? new Date(r.updated_at).getTime() : 0;
      const m = st && en && en > st ? Math.min(240, (en - st) / 60000) : 45;
      minutes += m;
    }
    return { days: d, meetings: all, liveMeetings: live, estimatedLiveMinutes: Math.round(minutes), estimatedLiveHours: Math.round((minutes / 60) * 10) / 10 };
  } catch { return null; }
}

// Salesforceを連携しているアカウント一覧（トークンを切らさないための巡回に使う）
export async function listSalesforceOwners() {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(`SELECT owner FROM salesforce_accounts WHERE refresh_token IS NOT NULL`);
    return rows.map((r) => r.owner).filter(Boolean);
  } catch { return []; }
}


// 分けているリストから、その人に配られたぶんだけを取り除く
export async function removeMyCallTargets(listId, email) {
  if (!pool) return 0;
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM call_targets WHERE list_id = $1 AND lower(assigned_to) = $2`,
      [listId, String(email || "").toLowerCase()]);
    return rowCount || 0;
  } catch (e) { console.error("[db] removeMyCallTargets", e.message); return 0; }
}


// 日ごと・人ごとに数える（実績を並べて比べるため）
export async function callStatsByDay(fromJst, toJst) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT to_char(at AT TIME ZONE 'Asia/Tokyo','YYYY-MM-DD') AS 日,
              caller, result, count(*)::int AS n
         FROM call_logs
        WHERE (at AT TIME ZONE 'Asia/Tokyo')::date >= $1::date
          AND (at AT TIME ZONE 'Asia/Tokyo')::date <= $2::date
        GROUP BY 1, 2, 3`,
      [fromJst, toJst]);
    return rows;
  } catch (e) { console.error("[db] callStatsByDay", e.message); return []; }
}


// メンバー別の分析のもとになる記録を取る（相手の属性も一緒に）
export async function callAnalysis(fromJst, toJst) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT l.caller, l.result,
              to_char(l.at AT TIME ZONE 'Asia/Tokyo','YYYY-MM-DD') AS 日,
              EXTRACT(HOUR FROM (l.at AT TIME ZONE 'Asia/Tokyo'))::int AS 時,
              t.industry, t.area, t.stage
         FROM call_logs l
         LEFT JOIN call_targets t ON t.id = l.target_id
        WHERE (l.at AT TIME ZONE 'Asia/Tokyo')::date >= $1::date
          AND (l.at AT TIME ZONE 'Asia/Tokyo')::date <= $2::date`,
      [fromJst, toJst]);
    return rows;
  } catch (e) { console.error("[db] callAnalysis", e.message); return []; }
}


// 記録に書かれたコメントを取る（断られ方の分析用）
export async function callMemos(fromJst, toJst, caller = "") {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT caller, result, memo, company,
              to_char(at AT TIME ZONE 'Asia/Tokyo','YYYY-MM-DD') AS 日
         FROM call_logs
        WHERE (at AT TIME ZONE 'Asia/Tokyo')::date >= $1::date
          AND (at AT TIME ZONE 'Asia/Tokyo')::date <= $2::date
          AND coalesce(memo,'') <> ''
          AND ($3 = '' OR lower(caller) = $3)
        ORDER BY at DESC
        LIMIT 600`,
      [fromJst, toJst, String(caller || "").toLowerCase()]);
    return rows;
  } catch (e) { console.error("[db] callMemos", e.message); return []; }
}


// 架電記録を全件消す（テストで入れたぶんを片づけるため。戻せない）
export async function clearCallLogs() {
  if (!pool) return 0;
  try {
    const { rowCount } = await pool.query(`DELETE FROM call_logs`);
    // 「済み」の印も戻す
    await pool.query(`UPDATE call_targets SET done = false WHERE done = true`).catch(() => {});
    return rowCount || 0;
  } catch (e) { console.error("[db] clearCallLogs", e.message); return 0; }
}


// kinbotがSalesforceに書き込んだ活動の一覧（消す前に確かめるため。読むだけ）
export async function sfWrittenLogs(fromJst, toJst) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT id, caller, company, result, memo, sf_task_id, lead_id,
              to_char(at AT TIME ZONE 'Asia/Tokyo','YYYY-MM-DD HH24:MI') AS 日時
         FROM call_logs
        WHERE coalesce(sf_task_id,'') <> ''
          AND (at AT TIME ZONE 'Asia/Tokyo')::date >= $1::date
          AND (at AT TIME ZONE 'Asia/Tokyo')::date <= $2::date
        ORDER BY at DESC
        LIMIT 500`,
      [fromJst, toJst]);
    return rows;
  } catch (e) { console.error("[db] sfWrittenLogs", e.message); return []; }
}
