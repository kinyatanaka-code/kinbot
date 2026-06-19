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

export async function createMeeting(botId, { meetingUrl, repName, title, owner }) {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO meetings (bot_id, meeting_url, rep_name, title, owner)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (bot_id) DO NOTHING`,
      [botId, meetingUrl || "", repName || "", title || "", owner || ""]
    );
  } catch (e) {
    console.error("[db] createMeeting", e.message);
  }
}

export async function saveMeeting(botId, { transcript, summary, suggestions }) {
  if (!pool) return;
  try {
    await pool.query(
      `UPDATE meetings
         SET transcript=$2, summary=$3, suggestions=$4, updated_at=now()
       WHERE bot_id=$1`,
      [
        botId,
        JSON.stringify(transcript || []),
        summary ? JSON.stringify(summary) : null,
        suggestions ? JSON.stringify(suggestions) : null,
      ]
    );
  } catch (e) {
    console.error("[db] saveMeeting", e.message);
  }
}

export async function listMeetings({ owner, isAdmin } = {}) {
  if (!pool) return [];
  const base = `SELECT m.bot_id, m.meeting_url, m.rep_name, m.title, m.owner,
                       m.round_no, m.phase, m.status, m.created_at, m.updated_at, m.summary, m.analysis,
                       u.name AS owner_name
                FROM meetings m LEFT JOIN users u ON u.email = m.owner`;
  if (isAdmin || !owner) {
    const { rows } = await pool.query(`${base} ORDER BY m.created_at DESC LIMIT 300`);
    return rows;
  }
  const { rows } = await pool.query(
    `${base} WHERE m.owner=$1 OR m.owner IS NULL OR m.owner='' ORDER BY m.created_at DESC LIMIT 300`,
    [owner]
  );
  return rows;
}

// 商談の「何回目」「フェーズ」「商談名」「営業担当(owner)」を更新（undefinedの項目は変更しない）
export async function updateMeetingMeta(botId, { round, phase, title, owner }) {
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
  try {
    await pool.query(`UPDATE meetings SET ${sets.join(", ")}, updated_at=now() WHERE bot_id=$1`, vals);
  } catch (e) {
    console.error("[db] updateMeetingMeta", e.message);
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
