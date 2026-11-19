// SHOBO の監査ログ（2026-11-19 福井さん依頼）
//   MOCHICA まわりの「変える操作」をすべて DB に残し、「いつ・だれが・何をしたか」を後から確かめられるようにする。
//   これまでは代理ログイン中の操作だけを console に出していたため、再起動で消え、ふだんの操作は何も残っていなかった。
//   残すのは「送った内容と対象ID・結果」まで（変更前後の差分は取らない＝各APIを直さずに済む A 案）。
import { dbPool } from "./db.js";

const P = () => dbPool();

// 対象：MOCHICA の書き込み API（読み取りの GET は残さない＝量が多すぎて肝心の記録が埋もれるため）
const 対象パス = /^\/api\/(mochica|mccall|teleapo|mcdash)(\/|$)/;
const 書き込み = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// 画面で読んで分かるように、パスを日本語の操作名に置き換える（当てはまらないものはパスのまま出す）
const 操作名 = [
  [/^POST \/api\/mccall\/lists$/, "架電リストを作成"],
  [/^PATCH \/api\/mccall\/lists\/[^/]+$/, "架電リストを変更"],
  [/^POST \/api\/mccall\/lists\/[^/]+\/assign$/, "架電リストの担当を割り振り"],
  [/^POST \/api\/mccall\/lists\/[^/]+\/move$/, "架電リストのリードを移動"],
  [/^POST \/api\/mccall\/lists\/[^/]+\/from-bales$/, "BALESからリードを取り込み"],
  [/^POST \/api\/mccall\/lists\/[^/]+\/from-csv$/, "CSVからリードを取り込み"],
  [/^POST \/api\/mccall\/lists\/[^/]+\/from-doc$/, "DOCからリードを取り込み"],
  [/^POST \/api\/mccall\/leads\/[^/]+\/release$/, "リードを手放す"],
  [/^POST \/api\/mccall\/leads\/[^/]+\/gate$/, "リードのゲート判定を記録"],
  [/^POST \/api\/mccall\/leads\/[^/]+\/hearing$/, "ヒアリング内容を記録"],
  [/^POST \/api\/mccall\/leads\/[^/]+\/clear-next$/, "次回予定を消す"],
  [/^PATCH \/api\/mccall\/leads\/[^/]+$/, "リードの情報を変更"],
  [/^POST \/api\/mccall\/leads\/[^/]+\/not-dup$/, "重複ではないと印を付ける"],
  [/^POST \/api\/mccall\/leads\/[^/]+\/log$/, "架電結果を記録"],
  [/^POST \/api\/mccall\/logs\/[^/]+\/undo$/, "架電結果を取り消し"],
  [/^POST \/api\/mccall\/sf-retry$/, "SFへの記録をやり直し"],
  [/^PUT \/api\/mccall\/doc-settings$/, "資料送付の設定を変更"],
  [/^POST \/api\/mccall\/leads\/[^/]+\/doc\/preview$/, "資料送付メールを下書き"],
  [/^POST \/api\/mccall\/leads\/[^/]+\/doc\/send$/, "資料を送付"],
  [/^POST \/api\/mochica\/miitel\/webhook$/, "MiiTelから会議を受信"],
  [/^POST \/api\/mochica\/miitel\/ext\/video\/[^/]+\/seg$/, "拡張機能から会議の文字起こしを受信"],
  [/^POST \/api\/mochica\/bales\/ext\/rows$/, "拡張機能からBALESの行を受信"],
  [/^POST \/api\/mochica\/bales\/lists\/[^/]+\/sf-link$/, "BALESリストをSFに結びつけ"],
  [/^DELETE \/api\/mochica\/bales\/feeds\/[^/]+$/, "BALESの取り込み元を削除"],
  [/^DELETE \/api\/mochica\/bales\/lists\/[^/]+$/, "BALESリストを削除"],
  [/^POST \/api\/mochica\/miitel\/meetings\/[^/]+\/sfopp$/, "商談をSFの商談に結びつけ"],
  [/^POST \/api\/mochica\/sf\/activity$/, "SFに活動を記録"],
  [/^POST \/api\/mochica\/miitel\/meetings\/[^/]+\/rep$/, "商談の担当を変更"],
  [/^POST \/api\/mochica\/sf\/task-suggest$/, "SFのToDo案を作成"],
  [/^POST \/api\/mochica\/co-sf-status$/, "会社のSF状況を更新"],
  [/^POST \/api\/mochica\/co-rename$/, "会社名を変更"],
  [/^POST \/api\/mochica\/co-sf$/, "会社をSFに結びつけ"],
  [/^POST \/api\/mochica\/sf\/fill$/, "SFの項目をAIで下書き"],
  [/^POST \/api\/mochica\/sf\/save$/, "SFに保存"],
  [/^POST \/api\/mochica\/miitel\/meetings\/[^/]+\/chapters$/, "商談の段階分けを作成"],
  [/^POST \/api\/mochica\/miitel\/meetings\/[^/]+\/summary$/, "商談の要約を作成"],
  [/^POST \/api\/mochica\/miitel\/meetings\/[^/]+\/cal$/, "商談をカレンダーに結びつけ"],
  [/^POST \/api\/mochica\/miitel\/meetings\/[^/]+\/thanks$/, "お礼メールを作成"],
  [/^POST \/api\/mochica\/miitel\/meetings\/[^/]+\/deep$/, "商談の深掘り分析を実行"],
  [/^PUT \/api\/mochica\/config$/, "MOCHICAの設定を変更"],
  [/^POST \/api\/teleapo\/diagnose$/, "テレアポ診断を実行"],
  [/^POST \/api\/teleapo\/aggregate$/, "テレアポ診断を集計"],
];
const MCP操作名 = { mochica_miitel_import: "MCPでMiiTelの会議を取り込み", sf_update: "MCPでSFを更新", sf_create: "MCPでSFに作成" };
export const MCP監査対象 = new Set(Object.keys(MCP操作名));

function 名前を付ける(method, path) {
  const k = `${method} ${path}`;
  for (const [re, name] of 操作名) if (re.test(k)) return name;
  return k;
}

// 鍵やトークンを DB に残さない（CLAUDE.md：鍵の値をログに出さない）。長い文字起こしなどは切り詰める。
const 伏せる項目 = /(token|key|secret|password|passwd|authorization|cookie|session)/i;
function 中身を整える(v, depth = 0) {
  if (v == null) return v;
  if (typeof v === "string") return v.length > 300 ? v.slice(0, 300) + `…（全${v.length}文字）` : v;
  if (typeof v !== "object") return v;
  if (depth > 4) return "…";
  if (Array.isArray(v)) {
    const out = v.slice(0, 20).map((x) => 中身を整える(x, depth + 1));
    if (v.length > 20) out.push(`…ほか${v.length - 20}件`);
    return out;
  }
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = 伏せる項目.test(k) && x ? "（伏せ字）" : 中身を整える(x, depth + 1);
  return out;
}
function 小さくする(obj) {
  try {
    const s = JSON.stringify(中身を整える(obj ?? null));
    return s && s.length > 8000 ? { 切り詰め: s.slice(0, 8000) } : JSON.parse(s || "null");
  } catch { return null; }
}

let _ready = null;
async function ensure() {
  if (!P()) return false;
  if (!_ready) {
    _ready = (async () => {
      await P().query(`CREATE TABLE IF NOT EXISTS mc_audit_log (
        id BIGSERIAL PRIMARY KEY,
        at TIMESTAMPTZ NOT NULL DEFAULT now(),
        actor TEXT,            -- 実際に操作した人（代理ログイン中なら元のアカウント）
        as_user TEXT,          -- 代理ログイン中に「だれとして」操作したか（ふだんは actor と同じ）
        source TEXT,           -- web / mcp / system / external
        method TEXT, path TEXT, action TEXT,
        target TEXT,           -- パスの中のID（リード・リスト・商談など）
        params JSONB,          -- 送った内容（伏せ字・切り詰め済み）
        status INT, ok BOOLEAN, error TEXT,
        ms INT, ip TEXT
      )`);
      await P().query(`CREATE INDEX IF NOT EXISTS mc_audit_log_at ON mc_audit_log (at DESC)`);
      await P().query(`CREATE INDEX IF NOT EXISTS mc_audit_log_actor ON mc_audit_log (actor, at DESC)`);
      return true;
    })().catch((e) => { _ready = null; throw e; });
  }
  return _ready;
}

// 1件書く。記録に失敗しても本来の操作は止めない（監査のせいで現場の仕事を止めないため）。
//   ただし黙って失敗させない（MOCHICA ルール5）：console.error に必ず出す。
export async function writeAudit(e) {
  try {
    if (!(await ensure())) { console.error("[mc-audit] DBにつながっていないため記録できません", e.action || e.path); return; }
    await P().query(
      `INSERT INTO mc_audit_log (actor, as_user, source, method, path, action, target, params, status, ok, error, ms, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [e.actor || null, e.asUser || null, e.source || "web", e.method || null, e.path || null, e.action || null, e.target || null,
       e.params == null ? null : JSON.stringify(e.params), e.status ?? null, e.ok ?? null, e.error ? String(e.error).slice(0, 500) : null, e.ms ?? null, e.ip || null]);
  } catch (err) {
    console.error("[mc-audit] 記録に失敗", err.message, e.action || e.path);
  }
}

function だれ(req) {
  const asUser = req.user || null;
  const actor = req.impersonatorFrom || asUser;
  const source = asUser === "system" ? "system" : asUser ? "web" : "external";
  return { actor: actor || "（未ログイン）", asUser, source };
}

// Express の middleware。body を読んだあと・各ルートより前に置く。
export function mcAuditMiddleware(req, res, next) {
  if (!書き込み.has(req.method) || !対象パス.test(req.path)) return next();
  const t0 = Date.now();
  const path = req.path;
  // 返した JSON の error / ok:false を拾う（ステータス200で失敗を返す API もあるため）
  let 返した = null;
  const origJson = res.json.bind(res);
  res.json = (body) => { 返した = body; return origJson(body); };
  res.on("finish", () => {
    const w = だれ(req);
    const ids = path.split("/").filter((s) => /^\d+$|^[A-Za-z0-9]{15,18}$|^[0-9a-f-]{20,}$/i.test(s));
    const 失敗 = res.statusCode >= 400 || (返した && 返した.ok === false);
    const params = { ...(req.query && Object.keys(req.query).length ? { query: req.query } : {}), ...(req.body && Object.keys(req.body).length ? { body: req.body } : {}) };
    writeAudit({
      ...w, method: req.method, path, action: 名前を付ける(req.method, path),
      target: ids.join(",") || null, params: 小さくする(params),
      status: res.statusCode, ok: !失敗, error: 失敗 ? (返した && (返した.error || 返した.reason)) || `HTTP ${res.statusCode}` : null,
      ms: Date.now() - t0, ip: String(req.ip || req.socket?.remoteAddress || ""),
    });
  });
  next();
}

// MCP（Claude から）の書き込みツールの記録。mcp.js の tools/call から呼ぶ。
export function auditMcpCall(name, args, req, { ok, error, ms }) {
  if (!MCP監査対象.has(name)) return;
  const w = だれ(req);
  const a = args || {};
  const target = a.id || (Array.isArray(a.meetings) ? a.meetings.map((m) => m && m.id).filter(Boolean).join(",") : null);
  writeAudit({ ...w, source: "mcp", method: "MCP", path: name, action: MCP操作名[name], target: target ? String(target).slice(0, 300) : null,
    params: 小さくする(a), status: null, ok, error, ms, ip: String(req.ip || "") });
}

// 管理者が監査ログを見る API。期間・人・操作名・失敗だけ、で絞れる。
export function registerMcAudit(app, { isAdmin }) {
  app.get("/api/mochica/audit", async (req, res) => {
    try {
      if (!isAdmin(req)) return res.status(403).json({ error: "監査ログは管理者だけが見られます" });
      if (!(await ensure())) return res.status(503).json({ error: "データベースにつながっていません" });
      const w = []; const v = [];
      const add = (sql, val) => { v.push(val); w.push(sql.replace("?", `$${v.length}`)); };
      if (req.query.from) add("at >= ?", new Date(String(req.query.from)));
      if (req.query.to) add("at < ?", new Date(String(req.query.to)));
      if (req.query.user) add("(actor ILIKE ? OR as_user ILIKE $" + (v.length + 1) + ")", `%${String(req.query.user).slice(0, 100)}%`);
      if (req.query.q) add("(action ILIKE ? OR path ILIKE $" + (v.length + 1) + " OR target ILIKE $" + (v.length + 1) + ")", `%${String(req.query.q).slice(0, 100)}%`);
      if (req.query.failed === "1") w.push("ok = false");
      const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 200, 1), 1000);
      const r = await P().query(
        `SELECT id, at, actor, as_user, source, method, path, action, target, params, status, ok, error, ms FROM mc_audit_log
         ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY at DESC, id DESC LIMIT ${limit}`, v);
      res.json({ ok: true, items: r.rows });
    } catch (e) { res.status(500).json({ error: "監査ログを読めませんでした：" + e.message }); }
  });
}
