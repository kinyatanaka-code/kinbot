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
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS status TEXT;`);
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS mux_playback_id TEXT;`);
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS ai_log JSONB;`);
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS metrics JSONB;`);
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS account TEXT;`);
  await pool.query(`ALTER TABLE meetings ADD COLUMN IF NOT EXISTS note TEXT;`);
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
  console.log("[db] Postgres に接続しました（履歴を保存します）。");
}

export async function createMeeting(botId, { meetingUrl, repName, title, owner, muxPlaybackId }) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO meetings (bot_id, meeting_url, rep_name, title, owner, mux_playback_id)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (bot_id) DO NOTHING`,
      [botId, meetingUrl || "", repName || "", title || "", owner || "", muxPlaybackId || null]
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
                       m.metrics, m.sf_url, COALESCE(m.account,'') AS account,
                       u.name AS owner_name
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
export async function updateMeetingMeta(botId, { round, phase, title, owner, createdAt, account }) {
  if (!pool) return;
  const sets = ["round_no=$2", "phase=$3"];
  const vals = [botId, round ?? null, phase || null];
  let idx = 4;
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
  try {
    await pool.query(`UPDATE meetings SET ${sets.join(", ")}, updated_at=now() WHERE bot_id=$1`, vals);
  } catch (e) {
    console.error("[db] updateMeetingMeta", e.message);
  }
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
