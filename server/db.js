// server/db.js
// 文字起こし・要約・分析を Postgres に保存する。
// DATABASE_URL が無ければ自動で「保存なし（メモリのみ）」で動く（段階導入のため）。
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_URL || "";
let pool = null;

export const dbEnabled = () => !!pool;

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

  await pool.query(`
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
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS feedback JSONB;`);
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS title TEXT;`);
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS analysis JSONB;`);
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS owner TEXT;`);
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS round_no INT;`);
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS phase TEXT;`);
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS category TEXT;`);
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS deal_kind TEXT;`);
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS status TEXT;`);
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS mux_playback_id TEXT;`);
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS custom_analysis TEXT;`);
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS ai_log JSONB;`);
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS metrics JSONB;`);
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS account TEXT;`);
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS note TEXT;`);
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS apo_setter TEXT;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      key TEXT PRIMARY KEY,
      site_url TEXT,
      official_name TEXT,
      owner TEXT,
      profile JSONB,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS owner TEXT;`);
  // 商談フェーズ自動判定の結果（1商談1行）
  await pool.query(`
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
    await pool.query(`ALTER TABLE phase_judgments ADD COLUMN IF NOT EXISTS phase${n}_reasoning TEXT;`);
  }
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pj_meeting_date ON phase_judgments(meeting_date);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_pj_rep ON phase_judgments(rep_name);`);
  // 案件単位のフェーズ判定（その案件の全商談をまとめて判定した結果）
  await pool.query(`
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
    await pool.query(`ALTER TABLE account_phase_judgments ADD COLUMN IF NOT EXISTS phase${n}_reasoning TEXT;`);
  }
  // 担当者→チーム→グループ のマスタ
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rep_team_mapping (
      rep_name TEXT PRIMARY KEY,
      team_name TEXT NOT NULL,
      group_name TEXT NOT NULL DEFAULT '直販'
    );
  `);
  // 担当者が所属するプロダクト（DOC / MOCHICA）。空は未設定＝「全体」タブでのみ表示。
  await pool.query(`ALTER TABLE rep_team_mapping ADD COLUMN IF NOT EXISTS product TEXT;`);
  // 初期データ（既存があれば上書きしない）
  for (const [rep, team] of [["植野", "浦林チーム"], ["江田", "浦林チーム"], ["田中", "中澤チーム"], ["森田", "中澤チーム"]]) {
    await pool.query(`INSERT INTO rep_team_mapping (rep_name, team_name, group_name) VALUES ($1,$2,'直販') ON CONFLICT (rep_name) DO NOTHING`, [rep, team]);
  }
  // インターン生（アポ獲得者）マスタ：名前＋Googleカレンダーのメールアドレス
  await pool.query(`
    CREATE TABLE IF NOT EXISTS interns (
      email      TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  // 事前ブリーフのキャッシュ（会社ごと。再作成で上書き）
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deal_briefs (
      company_key  TEXT PRIMARY KEY,
      company_name TEXT,
      brief        JSONB,
      based_on     INT DEFAULT 0,
      generated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS win_insights (
      scope_key    TEXT PRIMARY KEY,
      scope_label  TEXT,
      insight      JSONB,
      won_count    INT DEFAULT 0,
      lost_count   INT DEFAULT 0,
      generated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notion_sent (
      owner TEXT NOT NULL,
      bot_id TEXT NOT NULL,
      page_url TEXT,
      sent_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (owner, bot_id)
    );
  `);
  await pool.query(`
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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_action_items_account ON action_items(account);`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deal_status (
      account     TEXT PRIMARY KEY,
      status      TEXT NOT NULL DEFAULT '進行中',
      manual      BOOLEAN DEFAULT false,
      note        TEXT,
      updated_at  TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge (
      id         SERIAL PRIMARY KEY,
      category   TEXT,
      title      TEXT,
      body       TEXT,
      owner      TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS source_type TEXT;`);
  await pool.query(`ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS source_ref TEXT;`);
  await pool.query(`ALTER TABLE knowledge ADD COLUMN IF NOT EXISTS folder TEXT DEFAULT '';`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kb_folders (
      path       TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      id   INT PRIMARY KEY,
      data JSONB
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS calendar_bots (
      event_id   TEXT PRIMARY KEY,
      bot_id     TEXT,
      start_time TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      email      TEXT PRIMARY KEY,
      name       TEXT,
      pass_hash  TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS google_accounts (
      owner         TEXT PRIMARY KEY,
      refresh_token TEXT,
      google_email  TEXT,
      updated_at    TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS salesforce_accounts (
      owner         TEXT PRIMARY KEY,
      refresh_token TEXT,
      instance_url  TEXT,
      sf_user       TEXT,
      updated_at    TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS sf_url TEXT;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      owner      TEXT PRIMARY KEY,
      data       JSONB DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS set_analysis_cache (
      key         TEXT PRIMARY KEY,
      fingerprint TEXT,
      result      JSONB,
      updated_at  TIMESTAMPTZ DEFAULT now()
    );
  `);
  // ===== Feature A: 新営業プロセス（案件＝会社名ベース、イベントログ方式） =====
  await pool.query(`
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
  await pool.query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS auto_lose_deadline DATE;`);
  // ステッパー上で人が手動で進める進捗（AIの判定とは独立して持つ）。JSONBで {stage:1-5, updated_by, updated_at}。
  await pool.query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS manual_progress JSONB;`);
  await pool.query(`
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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_deal_events_deal ON deal_events(deal_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_deal_events_date ON deal_events(event_date);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_deal_events_bot ON deal_events(bot_id);`);

  // ===== OAuth（Claude.aiのカスタムコネクタ用。RFC7591動的クライアント登録 + 認可コードフロー） =====
  await pool.query(`
    CREATE TABLE IF NOT EXISTS oauth_clients (
      client_id      TEXT PRIMARY KEY,
      client_name    TEXT,
      redirect_uris  JSONB,
      created_at     TIMESTAMPTZ DEFAULT now()
    );
  `);
  await pool.query(`
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
  await pool.query(`
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
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_oauth_tokens_refresh ON oauth_tokens(refresh_token);`);

  // ===== スマートリンク（担当者切り替えに追随する共有Zoom URL） =====
  await pool.query(`
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
  await pool.query(`ALTER TABLE smart_links ADD COLUMN IF NOT EXISTS event_id TEXT;`);
  await pool.query(`ALTER TABLE smart_links ADD COLUMN IF NOT EXISTS setter TEXT;`);
  await pool.query(`ALTER TABLE smart_links ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE smart_links ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE smart_links ADD COLUMN IF NOT EXISTS invite_event_id TEXT;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_smart_links_event ON smart_links(event_id) WHERE event_id IS NOT NULL;`);

  console.log("[db] Postgres に接続しました（履歴を保存します）。");
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

export async function listMeetings({ owner, isAdmin } = {}) {
  if (!pool) return [];
  const base = `SELECT m.bot_id, m.meeting_url, m.rep_name, m.title, m.owner,
                       m.round_no, m.phase, m.status, m.created_at, m.updated_at, m.summary, m.analysis,
                       m.metrics, m.sf_url, COALESCE(m.account,'') AS account, m.category, m.deal_kind,
                       m.apo_setter, u.name AS owner_name
                FROM meetings m LEFT JOIN users u ON u.email = m.owner`;
  // 文字起こしが無い（空配列/NULL）の商談は履歴に残さない
  const hasTranscript = `(jsonb_typeof(m.transcript)='array' AND jsonb_array_length(m.transcript) > 0)`;
  if (isAdmin || !owner) {
    const { rows } = await pool.query(`${base} WHERE ${hasTranscript} ORDER BY m.created_at DESC LIMIT 300`);
    return rows;
  }
  const { rows } = await pool.query(
    `${base} WHERE (m.owner=$1 OR m.owner IS NULL OR m.owner='') AND ${hasTranscript} ORDER BY m.created_at DESC LIMIT 300`,
    [owner]
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
  let t = String(title || "").trim();
  if (!t) return "(無題)";
  t = t.replace(/^[\s　・※•◆◇■□▶▷*\-–—✉⊠]+/u, "");           // 先頭記号
  t = t.replace(/[【\[［][^】\]］]*[】\]］]/gu, " ");              // 【…】[…]ラベル除去
  t = t.replace(/[\s　/／|｜:：][^\s　/／|｜]{0,16}様(?:\s*[・,、][^\s　/／|｜]{0,16}様)*\s*$/u, ""); // 末尾 担当者様（複数可）
  t = t.replace(/[^\s　/／|｜]{0,16}様\s*$/u, "");                 // 区切り無しの 末尾○○様
  t = t.replace(/\s+/g, " ").trim();
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
  if (/【[^】]*初回[^】]*】/.test(t)) return 1;        // 【初回/】【初回/コールド】【初回/過去失注】
  if (/【[^】]*新\s*\/\s*ヒ[^】]*】/.test(t)) return 1; // 【新/ヒ】
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
export async function createSmartLink({ slug, label, owner, createdBy, eventId, setter, startTime, endTime }) {
  if (!pool) return null;
  const { rows } = await pool.query(
    `INSERT INTO smart_links (slug, label, current_owner, created_by, event_id, setter, start_time, end_time)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [slug, label || "", owner || null, createdBy || "", eventId || null, setter || null, startTime || null, endTime || null]
  );
  return rows[0];
}

// 招待予定（kinbotが作成したGoogleカレンダー予定）のIDを保存
export async function setSmartLinkInviteEvent(slug, inviteEventId) {
  if (!pool) return null;
  try {
    const { rows } = await pool.query(
      `UPDATE smart_links SET invite_event_id=$2, updated_at=now() WHERE slug=$1 RETURNING *`,
      [slug, inviteEventId || null]
    );
    return rows[0] || null;
  } catch (e) { console.error("[db] setSmartLinkInviteEvent", e.message); return null; }
}
export async function getSmartLinkByEvent(eventId) {
  if (!pool || !eventId) return null;
  const { rows } = await pool.query(`SELECT * FROM smart_links WHERE event_id=$1`, [eventId]);
  return rows[0] || null;
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
