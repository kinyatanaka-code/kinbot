// server/index.js
import "dotenv/config";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import fs from "node:fs";
import { WebSocketServer } from "ws";

// プロセス全体のクラッシュ防止（1リクエストの例外でサーバー全体が落ちないようにする）
process.on("uncaughtException", (e) => {
  console.error("[uncaughtException]", e && e.stack ? e.stack : e);
});
process.on("unhandledRejection", (e) => {
  console.error("[unhandledRejection]", e && e.stack ? e.stack : e);
});

import { transcribeFile, transcriberAvailable } from "./transcribe.js";
import { createBot, leaveBot, parseTranscriptEvent, getRecordingUrl, getBot, recallConnectionInfo, getRecallUsage, getLastRecallCreate } from "./recall.js";
import { createSession, getSession, removeSession, listActiveSessions, setOnMeetingFinalized } from "./sessions.js";
import {
  initDb,
  listMeetings,
  getMeeting,
  saveSettings,
  saveAnalysis,
  getSettings,
  saveDeepAnalysis,
  updateMeetingMeta,
  deleteMeeting,
  deleteEmptyMeetings,
  syncAccountActionItems,
  listActionItems,
  addActionItem,
  updateActionItem,
  deleteActionItem,
  listDealStatuses,
  setDealStatus,
  setDealStatusAuto,
  saveMeetingNote,
  setMeetingMux,
  listNotionSent,
  markNotionSent,
  getAiLogsByIds,
  companyFromTitle,
  roundFromTitle,
  getAccount,
  listAccounts,
  saveAccount,
  resolveDeal,
  updateDealStatus,
  applyAutoLoseDeadlines,
  mergeDuplicateDeals,
  createSmartLink,
  getSmartLink,
  getSmartLinkByEvent,
  listSmartLinks,
  setSmartLinkOwner,
  deleteSmartLink,
  deleteDealEventsByBot,
  insertDealEvent,
  listDeals,
  getDealWithEvents,
  listDealEvents,
  updateDealEvent,
  teamForRep,
  listRepTeams,
  upsertRepTeam,
  deleteRepTeam,
  listInterns,
  upsertIntern,
  deleteIntern,
  setMeetingApoSetter,
  clearApoSetters,
  listApoMeetings,
  getDealBrief,
  saveDealBrief,
  normCompanyKey,
  getSetCache,
  saveSetCache,
  listUsers,
  getUserSettings,
  saveUserSettings,
  saveMeeting,
  setMeetingStatus,
  createMeeting,
  setMeetingSfUrl,
  listKnowledge,
  addKnowledge,
  updateKnowledge,
  deleteKnowledge,
  listKbFolders,
  addKbFolder,
  deleteKbFolder,
} from "./db.js";
import { resolveConfig, statusInfo } from "./config.js";
import { analyzerInfo, analyzeMeeting, analyzeDeep, freeAnalyze, chatWithData, enrichCompany, generateThanks, THANKS_PROMPT, getCheckItems, getSummaryPrompt, classifyMeetingKind, extractFirstMeeting, extractReMeeting, buildBrief } from "./analyzer.js";
import {
  googleConfigured,
  authUrl,
  exchangeCode,
  isConnected as gcalConnected,
  disconnect as gcalDisconnect,
  listZoomEvents,
  listDayEvents,
  listCalendarEvents,
  getPrimaryEmail,
  driveReady,
  driveSearch,
  driveList,
  driveAccessToken,
  driveGetContent,
} from "./google.js";
import { startScheduler } from "./scheduler.js";
import { muxConfigured, createLiveStream, startVodUpload, waitVodPlayback } from "./mux.js";
import { notionConfigured, notionStatus, createMeetingPage, createReportPage } from "./notion.js";
import { pdfToText, urlToText, officeToText } from "./ingest.js";
import { indexKnowledge, embeddingsAvailable } from "./retrieval.js";
import { readDocument, readerAvailable } from "./ai_read.js";
import { mountMcpServer } from "./mcp.js";
import { mountGptActions } from "./gpt_actions.js";
import { mountOauthServer, oauthTokenUser } from "./oauth.js";
import {
  salesforceConfigured,
  authUrl as sfAuthUrl,
  exchangeCode as sfExchangeCode,
  isConnected as sfConnected,
  disconnect as sfDisconnect,
  connectionInfo as sfInfo,
  extractRecordId,
  getOpportunity,
  updateOpportunity,
} from "./salesforce.js";
import {
  authEnabled,
  getUser,
  loginUser,
  registerUser,
  setSessionCookie,
  clearSessionCookie,
  isAdmin,
  getDisplayName,
  makeToken,
  verifyToken,
} from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8787);
const RAILWAY_DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN;
const PUBLIC_URL = (
  process.env.PUBLIC_URL || (RAILWAY_DOMAIN ? `https://${RAILWAY_DOMAIN}` : "")
).replace(/\/$/, "");
const WEBHOOK_SECRET = process.env.RECALL_WEBHOOK_SECRET || "";

const llm = analyzerInfo();
const llmKeyOk =
  llm.provider === "ollama" ||
  (llm.provider === "gemini" && process.env.GEMINI_API_KEY) ||
  (llm.provider === "anthropic" && process.env.ANTHROPIC_API_KEY) ||
  (llm.provider === "groq" && process.env.GROQ_API_KEY) ||
  (llm.provider === "openai" && process.env.OPENAI_API_KEY);

if (!process.env.RECALL_API_KEY) {
  console.error("[起動エラー] RECALL_API_KEY を .env に設定してください。");
  process.exit(1);
}
if (!llmKeyOk) {
  console.error(
    `[起動エラー] LLM_PROVIDER=${llm.provider} のキーが未設定です。` +
      `(gemini→GEMINI_API_KEY / anthropic→ANTHROPIC_API_KEY / ollama→不要)`
  );
  process.exit(1);
}
if (!PUBLIC_URL) {
  console.warn("[警告] PUBLIC_URL 未設定。Recall が Webhook を届けられません（ngrok等の公開URLを設定）。");
}

const app = express();

// --- 個人アカウント認証（Cookieセッション） ---
const OPEN_PATHS = new Set([
  "/api/recall/webhook", "/api/login", "/api/register", "/api/auth-info",
  "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource",
  "/oauth/register", "/oauth/authorize", "/oauth/token",
  // ChatGPTのCustom GPTが「URLからインポート」で取得する公開スキーマ（トークンは含まない）
  "/gpt-actions-openapi.yaml",
]);
if (!authEnabled()) {
  console.warn("[警告] アカウント未設定。誰でも操作できます。公開時は DATABASE_URL を設定し登録制にしてください。");
}

// --- APIトークン認証（Claude Code など外部プログラムからの読み取り用） ---
// 環境変数 API_TOKENS に "トークン:紐づけるユーザー" をカンマ区切りで設定する。
//   例: API_TOKENS="kbt_xxx:kinya.tanaka@neo-career.co.jp, kbt_yyy:admin"
// ユーザー省略時は admin 扱い。トークンは Authorization: Bearer <token> ヘッダで送る。
const API_TOKENS = (() => {
  const map = new Map();
  const raw = process.env.API_TOKENS || "";
  for (const part of raw.split(",")) {
    const s = part.trim();
    if (!s) continue;
    const i = s.indexOf(":");
    const token = (i === -1 ? s : s.slice(0, i)).trim();
    const owner = (i === -1 ? "" : s.slice(i + 1).trim()) || "admin";
    if (token) map.set(token, owner);
  }
  return map;
})();
function bearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const m = /^Bearer\s+(.+)$/i.exec(String(h).trim());
  if (m) return m[1].trim();
  // ヘッダを付けにくいツール向けに ?token= でも受ける
  if (req.query && req.query.token) return String(req.query.token).trim();
  return "";
}
function apiTokenUser(req) {
  const t = bearerToken(req);
  if (!t || !API_TOKENS.size) return null;
  // タイミング安全比較
  for (const [tok, owner] of API_TOKENS) {
    if (tok.length === t.length && crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(t))) {
      return { username: owner, admin: (process.env.ADMIN_EMAILS || "").split(",").map((x) => x.trim()).includes(owner) || owner === "admin" };
    }
  }
  return null;
}

app.use(async (req, res, next) => {
  if (!authEnabled()) {
    req.user = "admin";
    req.isAdmin = true;
    return next();
  }
  if (OPEN_PATHS.has(req.path) || req.path.startsWith("/j/")) return next();
  // APIトークンでの認証（Cookie不要。外部プログラム・Claude Code用）
  const tk = apiTokenUser(req);
  if (tk) {
    req.user = tk.username;
    req.isAdmin = tk.admin;
    req.viaToken = true;
    return next();
  }
  // OAuthアクセストークンでの認証（Claude.aiのカスタムコネクタ用）
  const bt = bearerToken(req);
  if (bt && bt.startsWith("kbtat_")) {
    const ou = await oauthTokenUser(bt).catch(() => null);
    if (ou) {
      req.user = ou.username;
      req.isAdmin = ou.admin;
      req.viaToken = true;
      return next();
    }
    // OAuthトークン形式なのに無効 → MCP等のAPIパスなら401を返し、それ以外はログイン画面へ
    if (req.path.startsWith("/api/") || req.path === "/mcp") {
      return res.status(401).json({ error: "認証に失敗しました（トークンが無効です）" });
    }
  }
  if (
    req.path === "/login.html" ||
    req.path === "/register.html" ||
    /\.(css|js|png|jpe?g|svg|ico|webp|woff2?)$/i.test(req.path)
  ) {
    return next();
  }
  const u = getUser(req);
  if (u) {
    req.user = u.username;
    req.isAdmin = u.admin;
    return next();
  }
  if (req.path.startsWith("/api/") || req.path === "/mcp") return res.status(401).json({ error: "ログインが必要です" });
  return res.redirect("/login.html");
});

app.use(express.static(path.join(__dirname, "..", "public")));

// Webhook だけ raw body も保持（将来の署名検証用）
app.use(
  "/api/recall/webhook",
  express.json({ verify: (req, _res, buf) => (req.rawBody = buf) })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // OAuth承認画面の<form>送信（application/x-www-form-urlencoded）用

// kinbot OAuthサーバー（Claude.aiのカスタムコネクタが自動で試すOAuthフローに対応）
mountOauthServer(app);

// kinbot MCPサーバー（Claude.aiのコネクタからデータを読めるようにする）
mountMcpServer(app);

// kinbot REST API（ChatGPTのCustom GPT Actionsからデータを読めるようにする）
mountGptActions(app);

// 登録・ログイン・ログアウト
app.post("/api/register", async (req, res) => {
  try {
    const { email, password, displayName, code } = req.body || {};
    const r = await registerUser({ email, password, displayName, code });
    if (r.error) return res.status(400).json({ error: r.error });
    setSessionCookie(res, r.email);
    res.json({ ok: true, username: r.email, admin: r.admin });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post("/api/login", async (req, res) => {
  try {
    const { email, username, password } = req.body || {};
    const r = await loginUser({ email: email || username, password });
    if (r.error) return res.status(401).json({ error: r.error });
    setSessionCookie(res, r.id);
    res.json({ ok: true, username: r.id, admin: r.admin });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post("/api/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});
app.get("/api/me", (req, res) => {
  res.json({ username: req.user || null, admin: !!req.isAdmin });
});
app.get("/api/auth-info", (req, res) => {
  res.json({ signupCodeRequired: !!(process.env.SIGNUP_CODE || "") });
});

// 商談の「何回目」「フェーズ」を更新
app.put("/api/meetings/:id/meta", async (req, res) => {
  try {
    const { round, phase, title, owner, createdAt, account, category, dealKind } = req.body || {};
    const r = round === "" || round == null ? null : Number(round);
    await updateMeetingMeta(req.params.id, {
      round: Number.isFinite(r) ? r : null,
      phase: phase === undefined ? undefined : (phase || null),
      title: title === undefined ? undefined : title,
      owner: owner === undefined ? undefined : owner,
      createdAt: createdAt ? createdAt : undefined,
      account: account === undefined ? undefined : account,
      category: category === undefined ? undefined : category,
      dealKind: dealKind === undefined ? undefined : dealKind,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 商談を削除（owner本人 or 管理者）
app.delete("/api/meetings/:id", async (req, res) => {
  try {
    const m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "見つかりません" });
    const allowed = req.isAdmin || !m.owner || m.owner === req.user;
    if (!allowed) return res.status(403).json({ error: "削除権限がありません" });
    await deleteMeeting(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// 文字起こしの無い古い商談を一括削除（管理者のみ）
app.post("/api/meetings/cleanup-empty", async (req, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: "管理者のみ" });
    const minutes = Number((req.body && req.body.minutes) || 180);
    const n = await deleteEmptyMeetings(Number.isFinite(minutes) ? minutes : 180);
    res.json({ ok: true, removed: n });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 「商談」だけを分析・案件の対象にする（社内MTG/ユーザーフォロー等は除外）
const isSales = (m) => !m || !m.category || m.category === "商談";


// 商談メモの保存
app.put("/api/meetings/:id/note", async (req, res) => {
  try {
    await saveMeetingNote(req.params.id, (req.body && req.body.note) || "");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 案件ステータス =====
app.get("/api/deal-status", async (req, res) => {
  try {
    res.json({ statuses: await listDealStatuses() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.put("/api/deal-status", async (req, res) => {
  try {
    const { account, status, auto } = req.body || {};
    if (!account) return res.status(400).json({ error: "account が必要です" });
    if (auto) {
      // AIに任せる：手動フラグを解除
      await setDealStatus(account, { manual: false });
    } else {
      await setDealStatus(account, { status, manual: true });
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== ネクストアクション（案件単位） =====
app.get("/api/action-items", async (req, res) => {
  try {
    const account = String(req.query.account || "").trim();
    if (!account) return res.json({ items: [] });
    await syncAccountActionItems(account); // AI抽出の宿題を取り込み（冪等）
    res.json({ items: await listActionItems(account) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post("/api/action-items", async (req, res) => {
  try {
    const { account, text, due, botId } = req.body || {};
    if (!account || !text) return res.status(400).json({ error: "account と text が必要です" });
    const id = await addActionItem({ account, text, due, botId, owner: req.user || "", source: "manual" });
    res.json({ ok: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.put("/api/action-items/:id", async (req, res) => {
  try {
    const { done, text, due } = req.body || {};
    await updateActionItem(Number(req.params.id), { done, text, due });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.delete("/api/action-items/:id", async (req, res) => {
  try {
    await deleteActionItem(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 刺さったトーク・懸念の一覧（ダッシュボードKPIクリック用）
app.post("/api/talks", async (req, res) => {
  try {
    const { owner, owners, phase, phases, from, to } = req.body || {};
    const ownerList = Array.isArray(owners) ? owners.filter(Boolean) : owner ? [owner] : [];
    const phaseList = Array.isArray(phases) ? phases.filter(Boolean) : phase ? [phase] : [];
    let rows = await listMeetings({ isAdmin: true });
    rows = rows.filter((m) => {
      if (!isSales(m)) return false;
      if (ownerList.length && !ownerList.includes(m.owner || "")) return false;
      if (phaseList.length && !phaseList.includes(m.phase || "")) return false;
      const d = new Date(m.created_at);
      if (from && d < new Date(from + "T00:00:00")) return false;
      if (to && d > new Date(to + "T23:59:59")) return false;
      return true;
    });
    const logs = await getAiLogsByIds(rows.map((m) => m.bot_id));
    const landed = [], concerns = [];
    for (const r of logs) {
      const meta = { botId: r.bot_id, title: r.title || "(無題)", owner: r.owner_name || r.owner || "-", date: r.created_at };
      const log = Array.isArray(r.ai_log) ? r.ai_log : [];
      for (const e of log) {
        if (e.t === "land") landed.push({ ...meta, text: e.text || "", why: e.why || "" });
        else if (e.t === "obj") concerns.push({ ...meta, objection: e.objection || "", response: e.response || "", basis: e.basis || "" });
      }
    }
    // 新しい商談順
    const byDate = (a, b) => new Date(b.date) - new Date(a.date);
    landed.sort(byDate); concerns.sort(byDate);
    res.json({ landed, concerns });
  } catch (e) {
    console.error("[talks]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// Geminiと商談データを文脈に会話
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, owner, owners, phase, phases, from, to, pro, web } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ error: "メッセージがありません" });
    const ownerList = Array.isArray(owners) ? owners.filter(Boolean) : owner ? [owner] : [];
    const phaseList = Array.isArray(phases) ? phases.filter(Boolean) : phase ? [phase] : [];
    let rows = await listMeetings({ isAdmin: true });
    rows = rows.filter((m) => {
      if (!isSales(m)) return false;
      if (ownerList.length && !ownerList.includes(m.owner || "")) return false;
      if (phaseList.length && !phaseList.includes(m.phase || "")) return false;
      const d = new Date(m.created_at);
      if (from && d < new Date(from + "T00:00:00")) return false;
      if (to && d > new Date(to + "T23:59:59")) return false;
      return true;
    });
    const statuses = await listDealStatuses();
    const material = buildMeetingMaterial(rows, statuses, { limit: 25, max: 16000 });
    // 直近の往復だけ送る（コンテキスト節約）
    const trimmed = messages.slice(-12).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
    const model = pro ? (process.env.GEMINI_PRO_MODEL || "gemini-2.5-pro") : undefined;
    const reply = await chatWithData({ messages: trimmed, material, model, web: !!web });
    res.json({ reply, count: rows.length, model: model || "(標準)" });
  } catch (e) {
    console.error("[chat]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// ===== Feature A: 新営業プロセスの抽出＋イベントログ保存 =====

// 商談月(YYYY-MM)に n ヶ月足した YYYY-MM を返す
function addMonthStr(ymd, add) {
  const d = ymd ? new Date(ymd) : new Date();
  const base = new Date(d.getFullYear(), d.getMonth() + add, 1);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}`;
}

// 初回商談の抽出結果から judgment_month / status / needs_review をコード側で決める（依頼書6,7章）
function deriveFirstMeeting(ext, meetingMonth, meetingDateStr) {
  const sc = ext.schedule_choice;
  const at = ext.apply_timing;
  const lowConf = ext.confidence === "low";
  const hasNextMeeting = !!ext.next_meeting_scheduled; // 再商談（次回商談）の日程が設定されたか
  let judgment_month = null;
  let judgment_month_basis = "";
  let status = "進行中";
  let auto_lose_deadline = null;

  // 判断月の決定（優先順位）
  // 1) 次回商談(再商談)の具体的な日程が取れていれば、その月を判断月にする（最も正確）
  // 2) 取れていなければ「今月/来月」を商談日基準で絶対月に変換
  const nd = ext.next_meeting_date && /^\d{4}-\d{2}-\d{2}$/.test(ext.next_meeting_date) ? ext.next_meeting_date : null;
  if (at === "今月") { judgment_month = meetingMonth; judgment_month_basis = "商談で「今月中に判断」と回答"; }
  else if (at === "来月") { judgment_month = addMonthStr(meetingMonth, 1); judgment_month_basis = "商談で「来月に判断」と回答"; }
  if (nd) { judgment_month = nd.slice(0, 7); judgment_month_basis = `次回商談日(${nd})の月`; }

  // ステータス決定（依頼書の定義。失注は次の4パターンのみ）：
  // 1. schedule_choice=未定 → 即失注
  // 2. apply_timing=それ以外 → 即失注（明確な時期に対し今月/来月以外の回答）
  //    ※apply_timing=該当なしは「scheduleが未定のときのみ発生する値」（依頼書の定義）。
  //      scheduleが明確なのにatが該当なしなのは抽出の矛盾なので、下のフォールバックで補正する。
  // 3. 今月/来月判断だが再商談が未設定 → 初回商談日+10日の猶予（「進行中(未設定)」）。
  //    期限を過ぎたら applyAutoLoseDeadlines() のバッチで自動的に失注(未定)へ切り替える。
  // 4. 再商談実施後、結果が失注 → funnelFrom側で対応済み（このderiveFirstMeetingは初回商談のみを見る）。
  // 不明・低自信で判断材料が読み取れない場合のみ「要確認」（保留、集計対象外）。
  const scOk = sc && !["未定", "不明"].includes(sc);
  // 抽出の矛盾補正：scheduleが明確なのにapply_timing=該当なし → 本来あり得ない組み合わせ。
  // 次回商談が既に設定されているなら、それを優先して進行中とみなす。設定されていなければ要確認（保留）で人に確認してもらう。
  const contradiction = scOk && at === "該当なし";

  if (sc === "不明" || (at === "不明" && sc === "不明") || (lowConf && !sc && !at)) {
    status = "要確認";
  } else if (sc === "未定") {
    status = "失注(未定)";
  } else if (contradiction) {
    if (hasNextMeeting) {
      status = "進行中";
      judgment_month_basis = judgment_month_basis || "次回商談が設定されているため進行中と判定（申込可否の回答が不明瞭）";
    } else {
      status = "要確認";
    }
  } else if (at === "それ以外") {
    status = "失注(未定)";
  } else if (at === "今月" || at === "来月") {
    if (hasNextMeeting) {
      status = "進行中";
    } else {
      // 再商談が未設定 → 10日間の猶予。初回商談日(meetingDateStr)から10日後が期限。
      status = "進行中(未設定)";
      const base = meetingDateStr ? new Date(meetingDateStr) : new Date();
      const deadline = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 10);
      auto_lose_deadline = `${deadline.getFullYear()}-${String(deadline.getMonth() + 1).padStart(2, "0")}-${String(deadline.getDate()).padStart(2, "0")}`;
    }
  } else {
    status = "要確認";
  }

  // 要確認フラグ（人の確認を促す）
  const needs_review = status === "要確認";
  return { judgment_month, judgment_month_basis, status, needs_review, auto_lose_deadline };
}

// 1商談を抽出してイベントログに保存する（finalize / アップロード / 手動 / バックフィルから呼ぶ）
async function runExtraction(botId) {
  const m = await getMeeting(botId);
  if (!m) throw new Error("商談が見つかりません");
  if (m.category && m.category !== "商談") return null; // 商談以外は対象外
  const transcript = Array.isArray(m.transcript) ? m.transcript : [];
  if (!transcript.length) throw new Error("文字起こしがありません");

  const companyName = (m.account && m.account.trim()) || companyFromTitle(m.title) || "";
  const owner = m.owner || m.owner_name || "";
  const repName = m.owner_name || m.owner || "";
  const team = (await teamForRep(repName)) || (await teamForRep(owner)) || "";
  const meetingDate = (m.created_at ? new Date(m.created_at) : new Date());
  const meetingDateStr = meetingDate.toISOString().slice(0, 10);
  const meetingMonth = meetingDateStr.slice(0, 7);

  // 種別判定
  const kindRes = await classifyMeetingKind(transcript);
  const kind = kindRes.meeting_kind;

  // 既存の同一商談イベントを消してから入れ直す（再抽出の重複防止）
  await deleteDealEventsByBot(botId);

  // 会社名で案件を解決（無ければ新規作成）
  const deal = companyName ? await resolveDeal({ companyName, owner, team, firstMeetingDate: meetingDateStr }) : null;

  if (kind === "判定不能") {
    await insertDealEvent({
      deal_id: deal && deal.deal_id, bot_id: botId, event_date: meetingDateStr,
      event_type: "初回商談", meeting_kind: "判定不能",
      confidence: kindRes.confidence, needs_review: true,
      judgment_basis: "商談種別を判定できませんでした",
      raw_extraction: { kind: kindRes },
    });
    return { kind, needs_review: true };
  }

  if (kind === "初回商談") {
    const ext = await extractFirstMeeting(transcript, meetingDateStr);
    const der = deriveFirstMeeting(ext, meetingMonth, meetingDateStr);
    await insertDealEvent({
      deal_id: deal && deal.deal_id, bot_id: botId, event_date: meetingDateStr,
      event_type: "初回商談", meeting_kind: "初回商談",
      schedule_choice: ext.schedule_choice, schedule_choice_detail: ext.schedule_choice_detail,
      apply_timing: ext.apply_timing, judgment_month: der.judgment_month,
      next_meeting_scheduled: ext.next_meeting_scheduled, next_meeting_date: ext.next_meeting_date,
      confidence: ext.confidence, judgment_basis: ext.judgment_basis,
      needs_review: der.needs_review, raw_extraction: { ...ext, judgment_month_basis: der.judgment_month_basis, derived_status: der.status },
    });
    // 案件のステータス・初回商談日を更新（要確認でなければ）。「進行中(未定)」には自動失注の期限日も保存する。
    if (deal) {
      if (!der.needs_review) await updateDealStatus(deal.deal_id, der.status, der.auto_lose_deadline);
    }
    return { kind, ...der };
  }

  // 再商談
  const ext = await extractReMeeting(transcript, meetingDateStr);
  const needs_review = ext.confidence === "low";
  let status = "再商談実施済み";
  if (ext.result === "受注") status = "受注";
  else if (ext.result === "失注") status = "失注(その後失注)";
  await insertDealEvent({
    deal_id: deal && deal.deal_id, bot_id: botId, event_date: meetingDateStr,
    event_type: "再商談実施", meeting_kind: "再商談",
    result: ext.result, reported_date: ext.reported_date, apply_date: ext.apply_date,
    usage_start_date: ext.usage_start_date, confidence: ext.confidence,
    judgment_basis: ext.judgment_basis, needs_review, raw_extraction: ext,
  });
  if (deal && !needs_review) await updateDealStatus(deal.deal_id, status, null);
  return { kind, result: ext.result, needs_review };
}

// 投げっぱなし実行（finalizeをブロックしない）
function runExtractionSafe(botId) {
  Promise.resolve()
    .then(() => runExtraction(botId))
    .catch((e) => console.warn("[extract] スキップ", botId, e.message));
}
// 録音ボット経由の商談確定後にも抽出を走らせる（sessions.js から呼ばれる）
setOnMeetingFinalized(runExtractionSafe);

// メール→氏名の解決マップを作る
async function buildRepNameMap() {
  const map = {};
  try {
    const users = await listUsers();
    for (const u of users || []) if (u.email) map[u.email] = u.name || u.email;
  } catch {}
  return map;
}
// rep_name / rep_email から表示名（田中欽也 など）を決める
function resolveRepName(repName, repEmail, nameMap) {
  let out;
  if (repEmail && nameMap[repEmail]) out = nameMap[repEmail];
  else if (repName && nameMap[repName]) out = nameMap[repName]; // rep_nameがメールで保存されている場合
  else if (repName && !String(repName).includes("@")) out = repName; // すでに氏名
  else {
    const e = repName || repEmail || "";
    out = String(e).includes("@") ? String(e).split("@")[0] : (e || "(不明)");
  }
  // 表示名の補正（江田→江田有一郎 等）
  const al = nameAliases();
  return al[out] || out;
}




// Recall接続状況（どのリージョン/キーに繋がっているか＋今月の利用時間＋直近のボット起動結果）
// ※Recall APIは「残高（チャージ額）」を返さないため、残高は取得できない。利用時間と接続先のみ表示する。
app.get("/api/recall/status", async (req, res) => {
  const info = recallConnectionInfo();
  const out = { ...info, lastCreate: getLastRecallCreate(), usage: null, usageError: null };
  try {
    out.usage = await getRecallUsage();
  } catch (e) {
    out.usageError = e.message || "利用状況の取得に失敗しました";
  }
  res.json(out);
});

// 接続している外部APIの一覧（課金の有無・接続先・確認先）。キーは末尾4文字のみ。
app.get("/api/integrations", async (req, res) => {
  const env = process.env;
  const last4 = (v) => (v && String(v).length > 4 ? String(v).trim().slice(-4) : "");
  const has = (v) => !!(v && String(v).trim());
  const mainProvider = (env.LLM_PROVIDER || "gemini").toLowerCase();
  const extractProvider = (env.EXTRACT_PROVIDER || "anthropic").toLowerCase();
  const fallback = (env.FALLBACK_PROVIDER || "").toLowerCase();
  const transProvider = (env.RECALL_TRANSCRIBE_PROVIDER || "recallai").toLowerCase();
  // どのLLMが何に使われているかの判定（実態ベース）
  const usedBy = (p) => {
    const roles = [];
    if (mainProvider === p) roles.push("要約・分析・会話（メイン）");
    if (extractProvider === p) roles.push("商談データの抽出（種別判定・初回・再商談）");
    if (fallback === p || (!fallback && (p === "gemini" || p === "groq") && mainProvider !== p && extractProvider !== p)) roles.push("フォールバック（控え）");
    return roles;
  };

  const services = [];
  // Recall
  const rc = recallConnectionInfo();
  services.push({
    key: "recall", name: "Recall.ai（録音ボット）", billable: true,
    configured: rc.keyPresent, keyLast4: rc.keyLast4,
    detail: rc.regionLabel, role: "会議に参加して録音・文字起こし", inUse: rc.keyPresent,
    dashboardUrl: rc.dashboardUrl,
  });
  // Anthropic
  {
    const roles = usedBy("anthropic");
    services.push({
      key: "anthropic", name: "Anthropic Claude（AI）", billable: true,
      configured: has(env.ANTHROPIC_API_KEY), keyLast4: last4(env.ANTHROPIC_API_KEY),
      detail: env.EXTRACT_MODEL || env.ANALYZER_MODEL || "claude-sonnet-4-6",
      role: roles.length ? roles.join("・") : "未使用（キーのみ）", inUse: roles.length > 0 && has(env.ANTHROPIC_API_KEY),
      dashboardUrl: "https://console.anthropic.com/settings/billing",
    });
  }
  // Gemini
  {
    const roles = usedBy("gemini");
    services.push({
      key: "gemini", name: "Google Gemini（AI）", billable: true,
      configured: has(env.GEMINI_API_KEY), keyLast4: last4(env.GEMINI_API_KEY),
      detail: env.GEMINI_MODEL || "gemini-2.5-flash-lite",
      role: roles.length ? roles.join("・") : "未使用（キーのみ）", inUse: has(env.GEMINI_API_KEY) && roles.length > 0,
      dashboardUrl: "https://aistudio.google.com/app/apikey",
    });
  }
  // Groq
  {
    const roles = usedBy("groq");
    services.push({
      key: "groq", name: "Groq（AI・高速）", billable: true,
      configured: has(env.GROQ_API_KEY), keyLast4: last4(env.GROQ_API_KEY),
      detail: env.GROQ_MODEL || "llama-3.3-70b-versatile",
      role: roles.length ? roles.join("・") : "未使用（キーのみ）", inUse: roles.length > 0 && has(env.GROQ_API_KEY),
      dashboardUrl: "https://console.groq.com/settings/billing",
    });
  }
  // OpenAI（任意）
  if (has(env.OPENAI_API_KEY)) {
    const roles = usedBy("openai");
    services.push({
      key: "openai", name: "OpenAI（AI・任意）", billable: true,
      configured: true, keyLast4: last4(env.OPENAI_API_KEY),
      detail: env.OPENAI_MODEL || "gpt-4o-mini",
      role: roles.length ? roles.join("・") : "未使用（キーのみ）", inUse: roles.length > 0,
      dashboardUrl: "https://platform.openai.com/account/billing/overview",
    });
  }
  // Deepgram（文字起こし）
  services.push({
    key: "deepgram", name: "Deepgram（文字起こし）", billable: true,
    configured: has(env.DEEPGRAM_API_KEY), keyLast4: last4(env.DEEPGRAM_API_KEY),
    detail: env.DEEPGRAM_MODEL || "nova-2",
    role: transProvider === "deepgram" ? "録音の文字起こし（メイン）" : "アップロード音声の文字起こし",
    inUse: has(env.DEEPGRAM_API_KEY),
    dashboardUrl: "https://console.deepgram.com/",
  });
  // Mux（ライブ配信）
  services.push({
    key: "mux", name: "Mux（ライブ配信・任意）", billable: true,
    configured: has(env.MUX_TOKEN_ID) && has(env.MUX_TOKEN_SECRET), keyLast4: last4(env.MUX_TOKEN_ID),
    detail: "商談のライブ映像配信", role: "ライブ配信（使う場合のみ）",
    inUse: has(env.MUX_TOKEN_ID) && has(env.MUX_TOKEN_SECRET),
    dashboardUrl: "https://dashboard.mux.com/",
  });
  // 無料連携
  services.push({
    key: "google", name: "Google カレンダー連携", billable: false,
    configured: has(env.GOOGLE_CLIENT_ID) && has(env.GOOGLE_CLIENT_SECRET), keyLast4: "",
    detail: "予定の取り込み", role: "連携（無料）", inUse: has(env.GOOGLE_CLIENT_ID),
    dashboardUrl: "",
  });
  services.push({
    key: "notion", name: "Notion 連携", billable: false,
    configured: has(env.NOTION_TOKEN), keyLast4: "",
    detail: "議事録の送信", role: "連携（無料）", inUse: has(env.NOTION_TOKEN),
    dashboardUrl: "",
  });
  services.push({
    key: "salesforce", name: "Salesforce 連携", billable: false,
    configured: has(env.SF_CLIENT_ID) && has(env.SF_CLIENT_SECRET), keyLast4: "",
    detail: "商談データ連携", role: "連携（無料）", inUse: has(env.SF_CLIENT_ID),
    dashboardUrl: "",
  });

  res.json({ services });
});

// 会社名から新プロセス（Feature A）の状態を返す（案件画面の表示用）
app.get("/api/deal-status-by-company", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const company = req.query.company || "";
    const dealIdQ = req.query.deal_id || "";
    const deals = await listDeals({});
    let deal = null;
    if (dealIdQ) {
      // deal_id 指定があれば会社名照合を通さず直接引く（照合ズレを完全回避）
      deal = deals.find((d) => d.deal_id === dealIdQ) || null;
    }
    if (!deal && company) {
      const key = normCompanyKey(company);
      // 完全一致→部分一致（どちらかがもう一方を含む）で緩く照合
      deal = deals.find((d) => normCompanyKey(d.company_name) === key)
        || deals.find((d) => {
          const k2 = normCompanyKey(d.company_name);
          return k2 && key && (k2.includes(key) || key.includes(k2));
        }) || null;
    }
    if (!deal) return res.json({ found: false });
    const full = await getDealWithEvents(deal.deal_id);
    // 最新の初回商談イベントと再商談イベントを拾う
    const events = (full && full.events) || [];
    const firstEv = [...events].reverse().find((e) => e.event_type === "初回商談" && e.meeting_kind === "初回商談");
    const reEv = [...events].reverse().find((e) => e.event_type === "再商談実施");
    const needsReview = events.some((e) => e.needs_review);
    res.json({
      found: true,
      deal_id: deal.deal_id,
      status: deal.status,
      first_meeting_date: deal.first_meeting_date,
      auto_lose_deadline: deal.auto_lose_deadline || null,
      needs_review: needsReview,
      first: firstEv ? {
        schedule_choice: firstEv.schedule_choice, apply_timing: firstEv.apply_timing,
        judgment_month: firstEv.judgment_month, next_meeting_scheduled: firstEv.next_meeting_scheduled,
        next_meeting_date: firstEv.next_meeting_date, confidence: firstEv.confidence,
        judgment_basis: firstEv.judgment_basis, needs_review: firstEv.needs_review,
        judgment_month_basis: (firstEv.raw_extraction && firstEv.raw_extraction.judgment_month_basis) || "",
        event_date: firstEv.event_date,
      } : null,
      latest_result: reEv ? reEv.result : null,
      re: reEv ? {
        result: reEv.result, judgment_basis: reEv.judgment_basis, confidence: reEv.confidence,
        reported_date: reEv.reported_date, apply_date: reEv.apply_date, usage_start_date: reEv.usage_start_date,
        event_date: reEv.event_date,
      } : null,
      event_count: events.length,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== Feature A: 新営業プロセスのAPI =====

// チーム編集（担当者→チームのマスタ）。新プロセスのチーム集計にも使う。
app.get("/api/teams", async (req, res) => {
  try { res.json(await listRepTeams()); } catch { res.json([]); }
});
// 表示名の補正マップ（「江田」→「江田有一郎」等）。環境変数 NAME_ALIASES で追加可能。
// 形式: NAME_ALIASES="江田=江田有一郎, たなか=田中欽也"
function nameAliases() {
  const map = { "江田": "江田有一郎" };
  const raw = process.env.NAME_ALIASES || "";
  for (const part of raw.split(",")) {
    const [k, v] = part.split("=").map((x) => (x || "").trim());
    if (k && v) map[k] = v;
  }
  return map;
}
// email→登録名の対応表を作る
async function buildNameMap() {
  const byEmail = {};
  for (const u of (await listUsers().catch(() => []))) {
    if (u.email) byEmail[u.email.toLowerCase()] = u.name || u.email;
  }
  return { byEmail, aliases: nameAliases() };
}
// 担当者名/メールを、登録名＋補正マップで表示名に解決する
function resolveDisplayName(raw, nameMap) {
  let s = String(raw || "").trim();
  if (!s) return "";
  // メールなら登録名に置換
  if (s.includes("@") && nameMap && nameMap.byEmail[s.toLowerCase()]) s = nameMap.byEmail[s.toLowerCase()];
  // 補正マップ（完全一致）
  if (nameMap && nameMap.aliases[s]) s = nameMap.aliases[s];
  return s;
}

app.get("/api/teams/reps", async (req, res) => {
  try {
    const nameMap = await buildNameMap();
    const counts = {};
    for (const m of (await listMeetings({ isAdmin: true }).catch(() => []))) {
      if (m.category && m.category !== "商談") continue;
      const disp = resolveDisplayName(m.owner_name || m.owner, nameMap);
      if (disp) counts[disp] = (counts[disp] || 0) + 1;
    }
    // 登録ユーザーも候補に含める（商談が無くても選べるように）
    for (const u of (await listUsers().catch(() => []))) {
      const disp = resolveDisplayName(u.name || u.email, nameMap);
      if (disp && counts[disp] == null) counts[disp] = 0;
    }
    res.json(Object.keys(counts).map((rep_name) => ({ rep_name, n: counts[rep_name] })));
  } catch { res.json([]); }
});
app.put("/api/teams", async (req, res) => {
  try {
    const { rep_name, team_name, group_name } = req.body || {};
    if (!rep_name || !team_name) return res.status(400).json({ error: "担当者名とチーム名が必要です" });
    await upsertRepTeam(rep_name, team_name, group_name || "直販");
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete("/api/teams/:rep", async (req, res) => {
  try {
    await deleteRepTeam(decodeURIComponent(req.params.rep));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== インターン生（アポ獲得者）=====
// 一覧
app.get("/api/interns", async (req, res) => {
  try { res.json(await listInterns()); } catch { res.json([]); }
});
// 追加・更新（ログインユーザーなら可。チーム編集と同じ扱い）
app.put("/api/interns", async (req, res) => {
  try {
    const { email, name } = req.body || {};
    if (!email || !name) return res.status(400).json({ error: "名前とメールアドレスが必要です" });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email).trim())) return res.status(400).json({ error: "メールアドレスの形式が正しくありません" });
    await upsertIntern(email, name);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// 削除（ログインユーザーなら可）
app.delete("/api/interns/:email", async (req, res) => {
  try {
    await deleteIntern(decodeURIComponent(req.params.email));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 照合用のヘルパー ---
// 商談名・予定名を突き合わせやすい形に正規化（全半角・記号・空白の揺れを吸収。長音符ーは残す）
function normApoTitle(s) {
  return String(s || "")
    .normalize("NFKC")
    .replace(/\s/g, "")
    .replace(/[「」『』【】\[\]（）()〔〕・･、,。.:：;；\/／\\\-–—―~〜|｜”“"'’‘`]/g, "")
    .toLowerCase();
}
// JSTでの日付文字列 YYYY-MM-DD を返す（終日予定はそのまま）
function jstDateStr(input) {
  if (!input) return "";
  const s = String(input);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function dayDiff(a, b) {
  if (!a || !b) return 999;
  const da = Date.parse(a + "T00:00:00Z"), db = Date.parse(b + "T00:00:00Z");
  if (isNaN(da) || isNaN(db)) return 999;
  return Math.abs(Math.round((da - db) / 86400000));
}
function apoTitleMatch(mNorm, eNorm) {
  if (!mNorm || !eNorm) return false;
  if (mNorm === eNorm) return true;
  const shorter = mNorm.length <= eNorm.length ? mNorm : eNorm;
  if (shorter.length < 3) return false; // 短すぎる一致は誤検出になるので除外
  return mNorm.includes(eNorm) || eNorm.includes(mNorm);
}

// インターンのカレンダーと商談名を照合して、アポ獲得者を各商談に記録する
// （ログインユーザーなら可。読むのは各自のGoogle連携で見えるカレンダーのみ）
// body: { from: "YYYY-MM-DD", to: "YYYY-MM-DD" }（省略時は直近90日）
app.post("/api/interns/match", async (req, res) => {
  try {
    const gcalOwner = req.user; // ブラウザでログイン中の本人のGoogle連携を使う
    if (!gcalOwner || !(await gcalConnected(gcalOwner))) {
      return res.status(400).json({ error: "あなたのGoogleが連携されていません。設定→連携→Google連携 を先に済ませてください。" });
    }
    const interns = await listInterns();
    if (!interns.length) return res.status(400).json({ error: "インターン生が登録されていません。先に名前とメールアドレスを追加してください。" });

    // 期間（既定：直近90日）
    const today = new Date();
    const defFrom = new Date(today.getTime() - 90 * 86400 * 1000);
    const from = (req.body && req.body.from) || defFrom.toISOString().slice(0, 10);
    const to = (req.body && req.body.to) || today.toISOString().slice(0, 10);
    const DATE_WINDOW = 2; // 商談日と予定日のズレをこの日数まで許容
    // カレンダー取得範囲は前後1日の余裕をもたせる（JST境界対策）
    const timeMin = new Date(Date.parse(from + "T00:00:00+09:00") - 86400 * 1000).toISOString();
    const timeMax = new Date(Date.parse(to + "T23:59:59+09:00") + 86400 * 1000).toISOString();

    // 対象商談（実施済み＝文字起こしあり。商談カテゴリのみ）を期間で絞る
    const allMeetings = await listMeetings({ isAdmin: true });
    const meetings = allMeetings.filter((m) => {
      if (m.category && m.category !== "商談") return false;
      const d = jstDateStr(m.created_at);
      return d && d >= from && d <= to;
    });

    // 各インターンのカレンダー予定を取得（未共有などは individual に握りつぶす）
    // 照合対象は「本人が主催者の予定」のみ（招待されただけの予定は除外）
    const internEvents = []; // { intern, events:[{titleNorm,date,title}], error }
    for (const it of interns) {
      const internEmail = String(it.email || "").toLowerCase();
      const isHost = (e) => {
        const org = String(e.organizer || "").toLowerCase();
        const creator = String(e.creator || "").toLowerCase();
        return (org && org === internEmail) || (!org && creator && creator === internEmail);
      };
      try {
        const evs = await listCalendarEvents(gcalOwner, it.email, { timeMin, timeMax });
        internEvents.push({
          intern: it,
          events: evs.filter(isHost)
                     .map((e) => ({ title: e.title, titleNorm: normApoTitle(e.title), date: jstDateStr(e.start) }))
                     .filter((e) => e.titleNorm && e.date),
          error: null,
        });
      } catch (e) {
        const msg = /40[34]/.test(e.message)
          ? "カレンダーを読めませんでした（このメールのカレンダーがあなたと共有されているか確認してください）"
          : e.message;
        internEvents.push({ intern: it, events: [], error: msg });
      }
    }

    // 再照合なので、まず対象期間のアポ獲得者をクリア
    await clearApoSetters({ from, to });

    // 照合：商談名 × 予定名（日付ウィンドウ内）
    const perIntern = {}; // email -> { name, email, matched:[], error }
    for (const ie of internEvents) perIntern[ie.intern.email] = { name: ie.intern.name, email: ie.intern.email, matched: [], error: ie.error };
    let matchedCount = 0, multiCount = 0;
    const unmatched = [];

    for (const m of meetings) {
      const mNorm = normApoTitle(m.title);
      const mDate = jstDateStr(m.created_at);
      if (!mNorm) { unmatched.push({ bot_id: m.bot_id, title: m.title, date: mDate }); continue; }
      // このミーティングに一致する（インターン, 予定日ズレ）候補を集める
      const cands = [];
      for (const ie of internEvents) {
        let best = null;
        for (const ev of ie.events) {
          if (dayDiff(ev.date, mDate) > DATE_WINDOW) continue;
          if (!apoTitleMatch(mNorm, ev.titleNorm)) continue;
          const diff = dayDiff(ev.date, mDate);
          if (!best || diff < best.diff) best = { diff, evDate: ev.date, evTitle: ev.title };
        }
        if (best) cands.push({ intern: ie.intern, ...best });
      }
      if (!cands.length) { unmatched.push({ bot_id: m.bot_id, title: m.title, date: mDate }); continue; }
      // 複数インターンが一致したら、予定日が最も近い→登録順で1人に決める
      cands.sort((a, b) => a.diff - b.diff);
      if (cands.length > 1) multiCount++;
      const winner = cands[0].intern;
      await setMeetingApoSetter(m.bot_id, winner.name);
      perIntern[winner.email].matched.push({ bot_id: m.bot_id, title: m.title, date: mDate });
      matchedCount++;
    }

    res.json({
      ok: true,
      range: { from, to },
      meetings_total: meetings.length,
      matched: matchedCount,
      unmatched: meetings.length - matchedCount,
      multi_hit: multiCount,
      interns: Object.values(perIntern)
        .map((p) => ({ name: p.name, email: p.email, count: p.matched.length, error: p.error, meetings: p.matched }))
        .sort((a, b) => b.count - a.count),
      unmatched_list: unmatched,
    });
  } catch (e) {
    console.error("[interns/match]", e);
    res.status(500).json({ error: e.message });
  }
});

// ダッシュボード用：記録済みのアポ獲得者から、人ごとのアポ実施数を集計して返す（カレンダーには触れない・高速）
// query: from, to（省略時は直近90日）
app.get("/api/interns/stats", async (req, res) => {
  try {
    const today = new Date();
    const defFrom = new Date(today.getTime() - 90 * 86400 * 1000);
    const from = (req.query.from && String(req.query.from)) || defFrom.toISOString().slice(0, 10);
    const to = (req.query.to && String(req.query.to)) || today.toISOString().slice(0, 10);

    const interns = await listInterns();
    const meetings = await listApoMeetings({ from, to });

    const byName = {}; // name -> [{bot_id,title,date}]
    const unmatched = [];
    for (const m of meetings) {
      const item = { bot_id: m.bot_id, title: m.title || "", date: jstDateStr(m.created_at) };
      if (m.apo_setter) (byName[m.apo_setter] = byName[m.apo_setter] || []).push(item);
      else unmatched.push(item);
    }
    // 登録済みインターン（0件も表示）＋ 記録名だが未登録の人（削除後など）も拾う
    const names = new Set(interns.map((it) => it.name));
    for (const n of Object.keys(byName)) names.add(n);
    const rows = [...names].map((name) => ({
      name,
      count: (byName[name] || []).length,
      registered: interns.some((it) => it.name === name),
      meetings: byName[name] || [],
    })).sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name), "ja"));

    res.json({
      range: { from, to },
      registered_count: interns.length,
      meetings_total: meetings.length,
      matched: meetings.length - unmatched.length,
      unmatched: unmatched.length,
      interns: rows,
      unmatched_list: unmatched,
    });
  } catch (e) {
    console.error("[interns/stats]", e);
    res.status(500).json({ error: e.message });
  }
});


// ===== 事前ブリーフ（商談前の準備メモ＋想定問答）=====
// body: { company, regen?, peek? }
//  peek=true … キャッシュがあれば返す／無ければ生成せず {brief:null}（画面を開いた瞬間に呼ぶ用）
//  regen=true … キャッシュを無視して作り直す
app.post("/api/deals/brief", async (req, res) => {
  try {
    const company = String((req.body && req.body.company) || "").trim();
    if (!company) return res.status(400).json({ error: "会社名が必要です" });
    const key = normCompanyKey(company);
    if (!key) return res.status(400).json({ error: "会社名を認識できませんでした" });

    const regen = !!(req.body && req.body.regen);
    const peek = !!(req.body && req.body.peek);

    if (!regen) {
      const cached = await getDealBrief(key);
      if (cached && cached.brief) {
        return res.json({ brief: cached.brief, generated_at: cached.generated_at, based_on: cached.based_on, cached: true });
      }
      if (peek) return res.json({ brief: null, cached: false }); // 生成はしない
    }

    // この会社の過去商談を集める。フロントから渡された bot_id を最優先（会社名の表記ゆれに影響されない）。
    const botIds = Array.isArray(req.body && req.body.botIds) ? req.body.botIds.filter(Boolean) : [];
    const all = await listMeetings({ isAdmin: true });
    let ms;
    if (botIds.length) {
      const set = new Set(botIds.map(String));
      ms = all.filter((m) => set.has(String(m.bot_id)));
    } else {
      ms = all.filter((m) => normCompanyKey(m.account || "") === key || normCompanyKey(m.title || "") === key);
    }
    ms.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (!ms.length) return res.status(404).json({ error: "この会社の商談記録が見つかりませんでした" });

    const meetings = ms.map((m) => {
      const s = m.summary || {};
      const a = m.analysis || {};
      return {
        date: jstDateStr(m.created_at),
        title: m.title || "",
        overview: s.overview || "",
        key_points: Array.isArray(s.key_points) ? s.key_points : [],
        concerns: Array.isArray(s.customer_concerns) ? s.customer_concerns : [],
        next_steps: Array.isArray(s.next_steps) ? s.next_steps : [],
        next_action: a.next_action || "",
      };
    });

    const brief = await buildBrief({ company, meetings });
    await saveDealBrief(key, company, brief, ms.length);
    res.json({ brief, generated_at: new Date().toISOString(), based_on: ms.length, cached: false });
  } catch (e) {
    console.error("[deals/brief]", e);
    res.status(500).json({ error: e.message });
  }
});


// 案件一覧（deals）
app.get("/api/deals", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const { owner, team, status, from, to } = req.query;
    res.json(await listDeals({ owner, team, status, from, to }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 同じ会社名で重複してできてしまった案件（deals）レコードを1つに統合する（管理者のみ）
app.post("/api/deals/merge-duplicates", async (req, res) => {
  if (!req.isAdmin) return res.status(403).json({ error: "管理者のみ実行できます" });
  try {
    const result = await mergeDuplicateDeals();
    res.json({ ok: true, ...result });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 1案件＋その履歴
app.get("/api/deals/:id", async (req, res) => {
  try {
    const d = await getDealWithEvents(req.params.id);
    if (!d) return res.status(404).json({ error: "案件が見つかりません" });
    res.json(d);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// イベントログ取得（ダッシュボードの集計元）
app.get("/api/deal-events", async (req, res) => {
  try {
    const { from, to, owner, team, kind } = req.query;
    res.json(await listDealEvents({ from, to, owner, team, kind }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// イベントの手動修正（要確認レコードを直す→needs_review解除など）
app.put("/api/deal-events/:id", async (req, res) => {
  try {
    const patch = req.body || {};
    const row = await updateDealEvent(Number(req.params.id), patch);
    if (!row) return res.status(400).json({ error: "更新できませんでした" });
    res.json(row);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 指定商談の抽出を手動実行（再抽出）
app.post("/api/meetings/:id/extract", async (req, res) => {
  try {
    const r = await runExtraction(req.params.id);
    res.json({ ok: true, result: r });
  } catch (e) {
    console.error("[extract manual]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// バックフィル：既存の商談すべてに抽出をかける（期間指定可・順次処理）
// GET /api/extract/backfill/status で進捗確認、POST /api/extract/backfill で開始
let backfillState = { running: false, total: 0, done: 0, ok: 0, failed: 0, startedAt: null, from: null, to: null, lastError: "" };
app.get("/api/extract/backfill/status", (req, res) => res.json(backfillState));
app.post("/api/extract/backfill", async (req, res) => {
  if (!req.isAdmin) return res.status(403).json({ error: "管理者のみ実行できます" });
  if (backfillState.running) return res.status(409).json({ error: "すでに実行中です", state: backfillState });
  const { from, to } = req.body || {};
  // 対象の商談を集める（文字起こしのある商談のみ）
  let meetings = [];
  try { meetings = await listMeetings({ isAdmin: true }); } catch (e) { return res.status(500).json({ error: e.message }); }
  let targets = meetings.filter((m) => (!m.category || m.category === "商談"));
  if (from) targets = targets.filter((m) => new Date(m.created_at) >= new Date(from + "T00:00:00"));
  if (to) targets = targets.filter((m) => new Date(m.created_at) <= new Date(to + "T23:59:59"));
  backfillState = { running: true, total: targets.length, done: 0, ok: 0, failed: 0, startedAt: new Date().toISOString(), from: from || null, to: to || null, lastError: "" };
  res.json({ ok: true, message: `バックフィルを開始しました（対象 ${targets.length} 件）`, state: backfillState });
  // バックグラウンドで順次処理（レート制限回避のため間隔を空ける）
  (async () => {
    for (const m of targets) {
      try {
        await runExtraction(m.bot_id);
        backfillState.ok++;
      } catch (e) {
        backfillState.failed++;
        backfillState.lastError = `${m.bot_id}: ${e.message}`;
        console.error("[backfill]", m.bot_id, e.message);
      }
      backfillState.done++;
      await new Promise((r) => setTimeout(r, 800));
    }
    backfillState.running = false;
    console.log(`[backfill] 完了 ok=${backfillState.ok} failed=${backfillState.failed}`);
  })();
});

// ===== Feature B: ダッシュボード集計API =====

// 期間（基準日＋粒度）から from/to(YYYY-MM-DD) を作る
function periodRange(basis, granularity) {
  const d = basis ? new Date(basis + "T00:00:00") : new Date();
  const y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  let from, to;
  if (granularity === "day") {
    from = new Date(y, m, day); to = new Date(y, m, day);
  } else if (granularity === "week") {
    const wd = d.getDay(); // 0=日
    const monday = new Date(y, m, day + (wd === 0 ? -6 : 1 - wd));
    from = monday; to = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  } else { // month
    from = new Date(y, m, 1); to = new Date(y, m + 1, 0);
  }
  const fmt = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { from: fmt(from), to: fmt(to), monthKey: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}` };
}

// ファネル集計：初回商談数→明確な時期回答→今月/来月申込可否→失注→再商談実施→受注
function funnelFrom(events) {
  const first = events.filter((e) => e.event_type === "初回商談" && e.meeting_kind === "初回商談");
  const re = events.filter((e) => e.event_type === "再商談実施");
  // 要確認（判定保留）は確定していないので、案件化・失注のどちらにも数えない
  const review = first.filter((e) => e.needs_review || (e.schedule_choice === "不明" && (e.apply_timing === "不明" || !e.apply_timing)));
  const decided = first.filter((e) => !review.includes(e));
  // 明確な時期回答・今月/来月判断（参考指標）
  const clear = decided.filter((e) => e.schedule_choice && !["未定", "不明"].includes(e.schedule_choice));
  const thisMonth = clear.filter((e) => e.apply_timing === "今月");
  const nextMonth = clear.filter((e) => e.apply_timing === "来月");
  // 各初回商談のステータス（保存済みのderived_statusを見る。無ければ簡易判定）
  const statusOfEv = (e) => {
    const raw = e.raw_extraction || {};
    if (raw.derived_status) return raw.derived_status;
    return e.next_meeting_scheduled ? "進行中" : "進行中(未設定)";
  };
  const activated = decided.filter((e) => statusOfEv(e) === "進行中");
  // 猶予期間中（初回商談その場で再商談が設定できず、10日以内の猶予中。まだ確定していないので失注に数えない）
  const pending10day = decided.filter((e) => statusOfEv(e) === "進行中(未設定)" && e.deal_status !== "失注(未定)");
  // 失注：明確に失注が確定した初回商談（未定/それ以外/該当なし、または猶予期限切れでdeal側が失注(未定)になったもの） ＋ 再商談実施の結果=失注
  const lost = decided.filter((e) => {
    const st = statusOfEv(e);
    if (st === "失注(未定)" || st === "失注(その他)") return true;
    if (st === "進行中(未設定)" && e.deal_status === "失注(未定)") return true; // 猶予切れで自動失注済み
    return false;
  }).length + re.filter((e) => e.result === "失注").length;
  const reDone = re.length; // 再商談実施（メインKPI）
  // 受注：再商談の結果が受注、かつ案件の現在ステータスも受注のものだけを数える
  // （AIが受注と抽出しても案件が受注になっていない/変更された場合は数えない＝案件画面と一致させる）
  const won = re.filter((e) => e.result === "受注" && e.deal_status === "受注").length;
  return {
    first_meetings: first.length,
    clear_schedule: clear.length,
    this_month: thisMonth.length,
    next_month: nextMonth.length,
    activated: activated.length,
    pending_10day: pending10day.length,
    review: review.length,
    lost,
    re_meetings: reDone, // メインKPI
    won,
  };
}

// サマリー（ファネル）：期間・対象で集計。対象=全体/チーム/担当者
app.get("/api/report/funnel", async (req, res) => {
  try {
    const granularity = req.query.granularity || "month";
    const basis = req.query.basis || null;
    const { from, to } = periodRange(basis, granularity);
    await applyAutoLoseDeadlines().catch(() => {});
    const owner = req.query.owner || null;
    const team = req.query.team || null;
    const nameMap = await buildNameMap();
    // 担当者名→チーム名のマッピング（チーム編集の最新状態を都度反映）
    const teamMap = {}; // rep_name(表示名) -> team_name
    for (const t of (await listRepTeams().catch(() => []))) teamMap[(t.rep_name || "").trim()] = (t.team_name || "").trim();
    const teamOf = (rawOwner) => {
      const disp = resolveDisplayName(rawOwner, nameMap);
      return teamMap[(disp || "").trim()] || teamMap[(rawOwner || "").trim()] || "(未割り当て)";
    };
    const teamFilter = team ? String(team).trim() : null;

    let events = await listDealEvents({ from, to, owner });
    // チーム指定があれば、担当者→チームのマッピングでJS側フィルタ（deals.teamカラムに依存しない）
    if (teamFilter) {
      const before = events.length;
      events = events.filter((e) => teamOf(e.owner) === teamFilter);
      if (events.length === 0 && before > 0) {
        // 0件になった時だけ、原因調査用にどう解決されたかをログに残す
        const sample = [...new Set(before ? (await listDealEvents({ from, to, owner })).map((e) => e.owner) : [])].slice(0, 10);
        console.warn(`[report funnel] チーム「${teamFilter}」で0件。担当者→チーム解決:`, sample.map((o) => `${o}→${teamOf(o)}`));
        console.warn(`[report funnel] 登録済みチーム名一覧:`, [...new Set(Object.values(teamMap))]);
      }
    }
    const overall = funnelFrom(events);
    // 担当者別（全体/チーム選択時に内訳を出す）。担当者名は登録名＋補正で表示。
    const byOwnerMap = {};
    for (const e of events) {
      const o = resolveDisplayName(e.owner, nameMap) || "(不明)";
      (byOwnerMap[o] = byOwnerMap[o] || []).push(e);
    }
    const byOwner = Object.keys(byOwnerMap).sort().map((o) => ({ owner: o, ...funnelFrom(byOwnerMap[o]) }));

    // 種別別（コールド/過去失注/通常）
    const byKindMap = {};
    for (const e of events) {
      const k = e.deal_kind || "通常";
      (byKindMap[k] = byKindMap[k] || []).push(e);
    }
    const kindOrder = ["通常", "コールド", "過去失注"];
    const byKind = kindOrder.filter((k) => byKindMap[k]).map((k) => ({ kind: k, ...funnelFrom(byKindMap[k]) }));

    // チーム別（担当者→チームのマッピングで集約）。さらに各チームを種別で内訳。
    const byTeamMap = {}; // team -> events
    for (const e of events) {
      const tm = teamOf(e.owner);
      (byTeamMap[tm] = byTeamMap[tm] || []).push(e);
    }
    const byTeam = Object.keys(byTeamMap).sort().map((tm) => {
      const evs = byTeamMap[tm];
      // チーム内の種別内訳
      const kmap = {};
      for (const e of evs) { const k = e.deal_kind || "通常"; (kmap[k] = kmap[k] || []).push(e); }
      const kinds = kindOrder.filter((k) => kmap[k]).map((k) => ({ kind: k, ...funnelFrom(kmap[k]) }));
      return { team: tm, ...funnelFrom(evs), kinds };
    });

    res.json({ granularity, from, to, owner, team, overall, byOwner, byKind, byTeam });
  } catch (e) {
    console.error("[report funnel]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 日次データ確認：指定日の商談一覧（抽出結果＋要確認フラグ）
app.get("/api/report/daily", async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const owner = req.query.owner || null;
    const events = await listDealEvents({ from: date, to: date, owner });
    const nameMap = await buildNameMap();
    const rows = events.map((e) => ({
      id: e.id, bot_id: e.bot_id, company_name: e.company_name, owner: resolveDisplayName(e.owner, nameMap),
      meeting_kind: e.meeting_kind, schedule_choice: e.schedule_choice, apply_timing: e.apply_timing,
      result: e.result, confidence: e.confidence, needs_review: e.needs_review,
      judgment_basis: e.judgment_basis,
    }));
    res.json({ date, rows });
  } catch (e) {
    console.error("[report daily]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// パイプライン：今月判断/来月判断 × 未設定/実施待ち のマトリクス（指定日時点のストック）
app.get("/api/report/pipeline", async (req, res) => {
  try {
    const asOf = req.query.date || new Date().toISOString().slice(0, 10);
    const owner = req.query.owner || null;
    // 閲覧のタイミングでも、猶予期限切れの案件を最新化しておく（asOfが今日の場合のみ。過去日付の再現には影響させない）
    if (asOf >= new Date().toISOString().slice(0, 10)) {
      await applyAutoLoseDeadlines(asOf).catch(() => {});
    }
    // asOf 以前の全イベントを取得し、案件ごとに最新状態を再構築
    const events = await listDealEvents({ to: asOf, owner });
    // 案件ごとに、初回商談の判断月と、再商談実施済みか（=実施待ちでない）を判定
    const byDeal = {};
    for (const e of events) {
      const k = e.deal_id || e.bot_id;
      if (!k) continue;
      (byDeal[k] = byDeal[k] || { first: null, reDone: false, company: e.company_name, owner: e.owner }).company = e.company_name;
      if (e.event_type === "初回商談" && e.meeting_kind === "初回商談") {
        // 最新の初回商談で上書き（判断月・次回設定）
        byDeal[k].first = e;
      }
      if (e.event_type === "再商談実施") byDeal[k].reDone = true;
    }
    const cells = {
      thisMonth: { unset: [], waiting: [] },
      nextMonth: { unset: [], waiting: [] },
    };
    const monthNow = asOf.slice(0, 7);
    const nextMonthKey = (() => { const d = new Date(asOf + "T00:00:00"); const b = new Date(d.getFullYear(), d.getMonth() + 1, 1); return `${b.getFullYear()}-${String(b.getMonth() + 1).padStart(2, "0")}`; })();
    for (const k of Object.keys(byDeal)) {
      const d = byDeal[k];
      const f = d.first;
      if (!f || !f.judgment_month) continue; // 判断月なし（失注等）はストックに残さない
      if (d.reDone) continue; // 再商談実施済みは実施待ちから外れる
      if (f.deal_status && f.deal_status.startsWith("失注")) continue; // 猶予期限切れ等で既に失注確定した案件は除外
      // judgment_month が「今月」か「来月」かで振り分け（asOf基準の絶対月と比較）
      let col = null;
      if (f.judgment_month === monthNow) col = "thisMonth";
      else if (f.judgment_month === nextMonthKey) col = "nextMonth";
      else col = null; // それ以外の月は対象外（本画面は今月/来月判断のみ）
      if (!col) continue;
      const item = { deal_id: k, company_name: d.company, owner: d.owner, first_meeting_date: f.event_date, auto_lose_deadline: f.auto_lose_deadline || null };
      if (f.next_meeting_scheduled) cells[col].waiting.push(item);
      else cells[col].unset.push(item);
    }
    res.json({
      as_of: asOf,
      matrix: {
        thisMonth: { unset: cells.thisMonth.unset.length, waiting: cells.thisMonth.waiting.length },
        nextMonth: { unset: cells.nextMonth.unset.length, waiting: cells.nextMonth.waiting.length },
      },
      unset_list: { thisMonth: cells.thisMonth.unset, nextMonth: cells.nextMonth.unset },
    });
  } catch (e) {
    console.error("[report pipeline]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// パイプライン「未設定」件数の週次推移（過去n週）
app.get("/api/report/pipeline-trend", async (req, res) => {
  try {
    const weeks = Math.min(26, Math.max(1, Number(req.query.weeks || 8)));
    const owner = req.query.owner || null;
    const events = await listDealEvents({ owner });
    const points = [];
    const today = new Date();
    for (let i = weeks - 1; i >= 0; i--) {
      const ref = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i * 7);
      const asOf = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}-${String(ref.getDate()).padStart(2, "0")}`;
      // asOf時点の未設定件数を計算
      const byDeal = {};
      for (const e of events) {
        if (new Date(e.event_date) > ref) continue;
        const k = e.deal_id || e.bot_id;
        if (!k) continue;
        (byDeal[k] = byDeal[k] || { first: null, reDone: false });
        if (e.event_type === "初回商談" && e.meeting_kind === "初回商談") byDeal[k].first = e;
        if (e.event_type === "再商談実施") byDeal[k].reDone = true;
      }
      let unset = 0;
      for (const k of Object.keys(byDeal)) {
        const f = byDeal[k].first;
        if (!f || !f.judgment_month || byDeal[k].reDone) continue;
        if (!f.next_meeting_scheduled) unset++;
      }
      points.push({ date: asOf, unset });
    }
    res.json({ points });
  } catch (e) {
    console.error("[report pipeline-trend]", e.message);
    res.status(500).json({ error: e.message });
  }
});


// ===== 企業アカウント（プロフィール／会社概要） =====
app.get("/api/accounts", async (req, res) => {
  try { res.json(await listAccounts()); } catch { res.json([]); }
});
app.get("/api/accounts/:key", async (req, res) => {
  try {
    const a = await getAccount(decodeURIComponent(req.params.key));
    res.json(a || {});
  } catch (e) { res.json({}); }
});

// 手動編集（正式社名・URL・各項目）
app.put("/api/accounts/:key", async (req, res) => {
  try {
    const key = decodeURIComponent(req.params.key);
    const { siteUrl, officialName, owner, profile } = req.body || {};
    await saveAccount(key, { siteUrl, officialName, owner, profile });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 企業サイトURLから会社概要を自動取得（A+B: サイト本文＋Web検索）
app.post("/api/accounts/:key/enrich", async (req, res) => {
  try {
    const key = decodeURIComponent(req.params.key);
    // URLは任意。複数（改行/カンマ区切り）を渡せる。未入力なら会社名だけでWeb検索から複数ソースを調べる。
    const rawUrls = (req.body?.url || req.body?.urls || "").toString();
    const urlList = rawUrls.split(/[\n,、]+/).map((u) => u.trim()).filter(Boolean).slice(0, 5);
    const fullUrls = urlList.map((u) => (/^https?:\/\//i.test(u) ? u : "https://" + u));

    const siteTexts = [];
    const siteErrors = [];
    for (const fullUrl of fullUrls) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        const r = await fetch(fullUrl, { headers: { "user-agent": "Mozilla/5.0 (kinbot)" }, redirect: "follow", signal: ctrl.signal });
        clearTimeout(timer);
        if (!r.ok) { siteErrors.push(`${fullUrl}: 応答${r.status}`); continue; }
        const html = await r.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (text) siteTexts.push(`【${fullUrl}】\n${text}`);
      } catch (e) {
        siteErrors.push(`${fullUrl}: ${e.name === "AbortError" ? "タイムアウト" : e.message}`);
        console.warn("[enrich] site fetch失敗", fullUrl, e.message);
      }
    }
    // 複数サイトの本文を結合（長すぎる場合に備え、enrichCompany側で全体を制限）
    const siteText = siteTexts.join("\n\n");
    const siteError = siteErrors.length ? siteErrors.join(" / ") : "";
    const primaryUrl = fullUrls[0] || "";

    // URLが1件も取得できなかった場合、または未入力の場合は、会社名だけでWeb検索から複数ソースを調べる
    const profile = await enrichCompany({ url: primaryUrl, name: key, siteText, urlCount: fullUrls.length, gotCount: siteTexts.length });
    const officialName = profile.official_name || key;
    await saveAccount(key, { siteUrl: primaryUrl, officialName, profile });
    res.json({ ok: true, siteUrl: primaryUrl, officialName, profile, siteError, sourcesFetched: siteTexts.length, sourcesRequested: fullUrls.length });
  } catch (e) {
    console.error("[enrich]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// ===== なんでも分析（フリー） =====
function buildMeetingMaterial(rows, statuses, { limit = 20, max = 12000 } = {}) {
  const acctOf = (m) => (m.account && m.account.trim()) || companyFromTitle(m.title) || "(無題)";
  const statusOf = (m) => {
    const s = statuses && statuses[acctOf(m)];
    if (s && s.status) return s.status;
    if (m.analysis && m.analysis.deal_status) return m.analysis.deal_status;
    return "進行中";
  };
  const block = (m, i) => {
    const p = [`#${i + 1} 「${m.title || "無題"}」 ${new Date(m.created_at).toLocaleDateString("ja-JP")} 担当:${m.owner_name || m.owner || "-"} フェーズ:${m.phase || "-"} ステータス:${statusOf(m)}`];
    const s = m.summary || {};
    if (s.overview) p.push(`要約: ${s.overview}`);
    if (s.key_points?.length) p.push(`論点: ${s.key_points.join(" / ")}`);
    if (s.agreements?.length) p.push(`合意: ${s.agreements.join(" / ")}`);
    if (s.action_items?.length) p.push(`次アクション: ${s.action_items.join(" / ")}`);
    if (s.customer_concerns?.length) p.push(`懸念: ${s.customer_concerns.join(" / ")}`);
    const mt = m.metrics || {};
    if (typeof mt.repTalkPct === "number") p.push(`営業トーク比率: ${mt.repTalkPct}%`);
    const a = m.analysis;
    if (a && a.scores) p.push(`スコア ヒア${a.scores.hearing ?? "-"}/提案${a.scores.proposal ?? "-"}/クロ${a.scores.closing ?? "-"}/傾聴${a.scores.listening ?? "-"}`);
    if (a && a.deal_status_reason) p.push(`判定理由: ${a.deal_status_reason}`);
    return p.join("\n");
  };
  let s = rows.slice(0, limit).map(block).join("\n\n");
  return s.length > max ? s.slice(0, max) : s;
}

app.post("/api/free-analysis", async (req, res) => {
  try {
    const { question, owner, owners, phase, phases, from, to } = req.body || {};
    if (!question || !String(question).trim()) return res.status(400).json({ error: "質問・指示を入力してください" });
    const ownerList = Array.isArray(owners) ? owners.filter(Boolean) : owner ? [owner] : [];
    const phaseList = Array.isArray(phases) ? phases.filter(Boolean) : phase ? [phase] : [];
    let rows = await listMeetings({ isAdmin: true });
    rows = rows.filter((m) => {
      if (!isSales(m)) return false;
      if (ownerList.length && !ownerList.includes(m.owner || "")) return false;
      if (phaseList.length && !phaseList.includes(m.phase || "")) return false;
      const d = new Date(m.created_at);
      if (from && d < new Date(from + "T00:00:00")) return false;
      if (to && d > new Date(to + "T23:59:59")) return false;
      return true;
    });
    if (!rows.length) return res.status(400).json({ error: "対象の商談がありません（絞り込みを見直してください）" });
    const statuses = await listDealStatuses();
    const material = buildMeetingMaterial(rows, statuses);
    const ownerName = ownerList.length ? ownerList.join("・") : "全員";
    const phaseDesc = phaseList.length ? phaseList.map((p) => PHASE_LABELS[p] || p).join("・") : "すべて";
    const filterDesc = `対象${rows.length}件 / 担当:${ownerName} / フェーズ:${phaseDesc}`;
    const answer = await freeAnalyze({ question: String(question).slice(0, 2000), material, filterDesc });
    res.json({ answer, count: rows.length });
  } catch (e) {
    console.error("[free-analysis]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// 分析レポート等の自由テキストを自分のNotionへ送る
app.post("/api/notion/report", async (req, res) => {
  try {
    const cfg = await getUserSettings(req.user);
    if (!notionConfigured(cfg)) return res.status(400).json({ error: "あなたのNotion連携が未設定です（設定→Notion連携）" });
    const title = (req.body?.title || "kinbot 分析レポート").toString().slice(0, 200);
    const markdown = (req.body?.markdown || "").toString();
    if (!markdown.trim()) return res.status(400).json({ error: "本文がありません" });
    const url = await createReportPage(cfg, { title, markdown });
    res.json({ ok: true, url });
  } catch (e) {
    console.error("[notion report]", e.message);
    res.status(502).json({ error: e.message });
  }
});


// ===== Notion連携 =====
app.get("/api/notion/config", async (req, res) => {
  try {
    const cfg = await getUserSettings(req.user);
    res.json(notionStatus(cfg));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.put("/api/notion/config", async (req, res) => {
  try {
    const patch = {};
    if (typeof req.body?.db === "string") patch.notionDb = req.body.db.trim();
    if (typeof req.body?.token === "string" && req.body.token.trim() && !req.body.token.includes("•"))
      patch.notionToken = req.body.token.trim();
    await saveUserSettings(req.user, patch);
    res.json({ ok: true, ...notionStatus(await getUserSettings(req.user)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post("/api/meetings/:id/notion", async (req, res) => {
  try {
    const cfg = await getUserSettings(req.user);
    if (!notionConfigured(cfg)) return res.status(400).json({ error: "あなたのNotion連携が未設定です（設定→Notion連携でトークンとデータベースIDを登録）" });
    const m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "見つかりません" });
    if (!canAccess(m, req)) return res.status(403).json({ error: "権限がありません" });
    const appUrl = (PUBLIC_URL || "").replace(/\/$/, "") + "/history.html";
    const url = await createMeetingPage(cfg, m, { appUrl });
    await markNotionSent(req.user, req.params.id, url);
    res.json({ ok: true, url });
  } catch (e) {
    console.error("[notion]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// 絞り込んだ複数商談を自分のNotionへ一括送信（重複スキップ対応・チャンク前提）
app.post("/api/notion/bulk", async (req, res) => {
  try {
    const cfg = await getUserSettings(req.user);
    if (!notionConfigured(cfg)) return res.status(400).json({ error: "あなたのNotion連携が未設定です（設定→Notion連携）" });
    let ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x) => typeof x === "string") : [];
    if (!ids.length) return res.status(400).json({ error: "対象の商談がありません" });
    if (ids.length > 30) ids = ids.slice(0, 30); // 1リクエストはタイムアウト回避のため小さめ（クライアントが分割送信）
    const force = !!req.body?.force;
    const appUrl = (PUBLIC_URL || "").replace(/\/$/, "") + "/history.html";
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const alreadySent = force ? new Set() : await listNotionSent(req.user);
    let sent = 0, failed = 0, skipped = 0;
    const errors = [];
    for (const id of ids) {
      if (alreadySent.has(id)) { skipped++; continue; }
      try {
        const m = await getMeeting(id);
        if (!m || !canAccess(m, req)) { failed++; continue; }
        const url = await createMeetingPage(cfg, m, { appUrl });
        await markNotionSent(req.user, id, url);
        sent++;
        await sleep(350); // Notionのレート制限対策
      } catch (e) {
        failed++;
        if (errors.length < 5) errors.push(`${id.slice(0, 8)}…: ${e.message}`);
      }
    }
    res.json({ ok: true, sent, failed, skipped, total: ids.length, errors });
  } catch (e) {
    console.error("[notion bulk]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// 登録ユーザー一覧（営業担当の付け替え用）
app.get("/api/users", async (req, res) => {
  try {
    res.json(await listUsers());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 御礼メールの例文（ラウンド別）の取得・保存
app.get("/api/thanks-examples", async (req, res) => {
  try {
    const s = await getUserSettings(req.user);
    res.json(s.thanksExamples || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.put("/api/thanks-examples", async (req, res) => {
  try {
    const examples = req.body && typeof req.body === "object" ? req.body.examples || req.body : {};
    await saveUserSettings(req.user, { thanksExamples: examples });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 御礼メール生成プロンプト（ユーザーごと。空にすると既定に戻る）
app.get("/api/thanks-prompt", async (req, res) => {
  try {
    const s = await getUserSettings(req.user);
    const custom = typeof s.thanksPrompt === "string" ? s.thanksPrompt : "";
    res.json({ prompt: custom || THANKS_PROMPT, isDefault: !custom.trim(), defaultPrompt: THANKS_PROMPT });
  } catch (e) {
    res.json({ prompt: THANKS_PROMPT, isDefault: true, defaultPrompt: THANKS_PROMPT });
  }
});
app.put("/api/thanks-prompt", async (req, res) => {
  try {
    const { prompt } = req.body || {};
    await saveUserSettings(req.user, { thanksPrompt: typeof prompt === "string" ? prompt : "" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 御礼メールを生成（商談内容＋そのラウンドの例文を手本に）
app.post("/api/meetings/:id/thanks", async (req, res) => {
  try {
    const m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "見つかりません" });
    const round = m.round_no || (req.body && req.body.round) || "";
    const s = await getUserSettings(m.owner);
    const all = s.thanksExamples || {};
    let examples = Array.isArray(all[String(round)]) ? all[String(round)] : [];
    // そのラウンドの例が無ければ、他ラウンドの例を手本として流用
    if (examples.length === 0) {
      for (const k of Object.keys(all)) {
        if (Array.isArray(all[k]) && all[k].length) {
          examples = all[k];
          break;
        }
      }
    }
    // 要約テキスト（無ければ文字起こしの末尾）
    let summaryText = "";
    const sm = m.summary || {};
    if (sm.overview) summaryText += sm.overview + "\n";
    for (const [lab, key] of [["合意", "agreements"], ["次アクション", "action_items"], ["懸念", "customer_concerns"], ["要点", "key_points"]]) {
      if (Array.isArray(sm[key]) && sm[key].length) summaryText += `\n[${lab}]\n` + sm[key].map((x) => "・" + x).join("\n");
    }
    if (!summaryText.trim()) {
      const tr = Array.isArray(m.transcript) ? m.transcript : [];
      summaryText = tr.map((u) => `${u.speaker?.name || ""}: ${u.text}`).join("\n").slice(-6000);
    }
    const speakers = Array.isArray(m.transcript) ? [...new Set(m.transcript.map((u) => u.speaker?.name).filter(Boolean))] : [];
    const customer = speakers.find((n) => n && n !== m.rep_name) || "";
    const result = await generateThanks({
      round,
      examples,
      summaryText,
      repName: m.owner_name || m.rep_name,
      customer,
      prompt: typeof s.thanksPrompt === "string" ? s.thanksPrompt : "",
    });
    res.json({ ...result, round, exampleCount: examples.length });
  } catch (e) {
    console.error("[thanks]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// 商談を削除
// 絞り込んだ商談全体を横断して、傾向・スコア理由を分析（結果はキャッシュ）
const PHASE_LABELS = { "01": "初回商談", "02": "有効商談", "03": "担当者合意", "04": "企画決定者合意" };


// --- 商談セッション開始：会議にBotを送り込む ---
app.post("/api/sessions", async (req, res) => {
  const { meetingUrl, repName, languageCode, title } = req.body || {};
  if (!meetingUrl) return res.status(400).json({ error: "meetingUrl が必要です" });
  if (!PUBLIC_URL) return res.status(500).json({ error: "PUBLIC_URL が未設定です" });
  try {
    const cfg = await resolveConfig(req.user);
    // ライブ映像配信（Mux）。設定済みなら配信枠を作成してRTMP送信を仕込む
    let mux = null;
    let muxError = "";
    if (muxConfigured()) {
      try {
        mux = await createLiveStream();
        if (!mux?.playbackId) muxError = "Muxから再生IDが取得できませんでした";
      } catch (e) {
        muxError = e.message;
        console.error("[mux] createLiveStream", e.message);
      }
    }
    const botId = await createBot({
      meetingUrl,
      webhookUrl: `${PUBLIC_URL}/api/recall/webhook`,
      languageCode: languageCode || cfg.languageCode,
      botName: cfg.botName,
      provider: cfg.transcribeProvider,
      deepgramModel: cfg.deepgramModel,
      rtmpUrl: mux?.rtmpUrl || null,
    });
    const displayName = await getDisplayName(req.user);
    createSession(botId, {
      repName: repName || cfg.repName || displayName || req.user || "",
      meetingUrl,
      title: title || "",
      owner: req.user || "",
      analyzeIntervalMs: cfg.analyzeIntervalMs,
      muxPlaybackId: mux?.playbackId || "",
      muxLiveStreamId: mux?.liveStreamId || "",
      muxError,
    });
    res.json({ sessionId: botId, muxReady: !!mux?.playbackId, muxError });
  } catch (e) {
    console.error("[sessions]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// --- 設定の取得・保存 ---
app.get("/api/settings", async (req, res) => {
  try {
    const cfg = await resolveConfig(req.user);
    res.json({ settings: cfg, status: statusInfo(PUBLIC_URL) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.put("/api/settings", async (req, res) => {
  try {
    const allowed = [
      "botName",
      "languageCode",
      "transcribeProvider",
      "deepgramModel",
      "analyzeIntervalMs",
      "repName",
      "calendarFilter",
    ];
    const patch = {};
    for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
    if ("analyzeIntervalMs" in patch) patch.analyzeIntervalMs = Number(patch.analyzeIntervalMs) || 20000;
    const r = await saveUserSettings(req.user, patch);
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 抜け漏れチェック項目（チーム共有）
app.get("/api/check-items", async (req, res) => {
  try {
    const items = await getCheckItems();
    res.json({ items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.put("/api/check-items", async (req, res) => {
  try {
    let items = (req.body && req.body.items) || [];
    if (!Array.isArray(items)) return res.status(400).json({ error: "items は配列で" });
    items = items.map((s) => String(s).trim()).filter(Boolean).slice(0, 15);
    const r = await saveSettings({ checkItems: items });
    res.json({ ok: true, items, ...r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 要約プロンプト（追加指示・チーム共有）。商談履歴の要約の書き方を設定で上書きできる。
app.get("/api/summary-prompt", async (req, res) => {
  try {
    res.json({ prompt: await getSummaryPrompt() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.put("/api/summary-prompt", async (req, res) => {
  try {
    const prompt = String((req.body && req.body.prompt) || "").slice(0, 4000);
    const r = await saveSettings({ summaryPrompt: prompt });
    res.json({ ok: true, prompt, ...r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 判定モデル（Claude/Gemini）の選択（チーム共有）。空文字は「環境変数の既定に従う」。
app.get("/api/judge-provider", async (req, res) => {
  try {
    const s = await getSettings();
    const v = s && (s.judgeProvider === "anthropic" || s.judgeProvider === "gemini") ? s.judgeProvider : "";
    res.json({ provider: v });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put("/api/judge-provider", async (req, res) => {
  try {
    let p = String((req.body && req.body.provider) || "").toLowerCase();
    if (p !== "anthropic" && p !== "gemini") p = "";
    const r = await saveSettings({ judgeProvider: p });
    res.json({ ok: true, provider: p, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 商談終了：Botを退出させる ---
app.post("/api/sessions/:id/stop", async (req, res) => {
  await leaveBot(req.params.id);
  removeSession(req.params.id);
  res.json({ ok: true });
});

// 自分が立ち上げて進行中のライブ商談（どのページからでもbot退出できるよう）
app.get("/api/sessions/mine", async (req, res) => {
  try {
    const mine = listActiveSessions().filter((s) => (s.owner || "") === (req.user || ""));
    res.json(mine.map((s) => ({ id: s.botId, title: s.title || "(商談名なし)", startedAt: s.startedAt })));
  } catch (e) {
    res.json([]);
  }
});

// ライブ商談中、コーチ(AI)に質問する。今の会話内容を文脈に回答。
app.post("/api/sessions/:id/ask", async (req, res) => {
  try {
    const question = (req.body?.question || "").toString().trim();
    if (!question) return res.status(400).json({ error: "質問を入力してください" });
    let context = "";
    const s = getSession(req.params.id);
    if (s && typeof s.transcriptText === "function") context = s.transcriptText();
    if (!context) {
      const m = await getMeeting(req.params.id);
      const tr = Array.isArray(m?.transcript) ? m.transcript : [];
      context = tr.map((u) => `${u.speaker?.name || "話者"}: ${u.text || ""}`).join("\n");
    }
    context = (context || "").slice(-12000) || "（まだ会話がありません）";
    const reply = await chatWithData({
      messages: [{ role: "user", content: question }],
      material: "【今の商談の文字起こし】\n" + context,
    });
    res.json({ reply });
  } catch (e) {
    console.error("[ask]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// --- 自社ナレッジ（チーム共有） ---
app.get("/api/knowledge", async (req, res) => {
  res.json(await listKnowledge());
});
app.post("/api/knowledge", async (req, res) => {
  const { category, title, body, folder } = req.body || {};
  if (!title && !body) return res.status(400).json({ error: "タイトルか本文が必要です" });
  const id = await addKnowledge({ category, title, body, owner: req.user || "", sourceType: "text", folder });
  if (id) indexKnowledge(id, { title, category, body }).catch((e) => console.error("[index]", e.message));
  res.json({ ok: true, id });
});
app.put("/api/knowledge/:id", async (req, res) => {
  const { category, title, body, folder } = req.body || {};
  const id = Number(req.params.id);
  await updateKnowledge(id, { category, title, body, folder });
  // 本文が変わる場合のみ再インデックス（移動だけなら不要）
  if (body !== undefined) indexKnowledge(id, { title, category, body }).catch((e) => console.error("[index]", e.message));
  res.json({ ok: true });
});

// ナレッジのフォルダ操作
app.get("/api/knowledge/folders", async (req, res) => {
  res.json(await listKbFolders());
});
app.post("/api/knowledge/folders", async (req, res) => {
  const path = String((req.body && req.body.path) || "").trim().replace(/^\/+|\/+$/g, "");
  if (!path) return res.status(400).json({ error: "フォルダ名が必要です" });
  if (/["'\\]/.test(path)) return res.status(400).json({ error: "使えない文字が含まれています" });
  await addKbFolder(path);
  res.json({ ok: true });
});
app.delete("/api/knowledge/folders", async (req, res) => {
  const path = String((req.body && req.body.path) || "").trim();
  const r = await deleteKbFolder(path);
  if (!r.ok && r.reason === "not_empty")
    return res.status(409).json({ error: "中に資料やサブフォルダがあるため削除できません" });
  res.json(r);
});
app.delete("/api/knowledge/:id", async (req, res) => {
  await deleteKnowledge(Number(req.params.id));
  res.json({ ok: true });
});

// URLを取り込んでナレッジ化
app.post("/api/knowledge/url", async (req, res) => {
  try {
    const { url, category, folder } = req.body || {};
    if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: "http(s) のURLを入力してください" });
    const { title, text } = await urlToText(url);
    if (!text || text.length < 20) return res.status(422).json({ error: "本文を抽出できませんでした（JS描画/ログインが必要なサイトの可能性）" });
    // 取得テキストをAIで読み取り・構造化（キーが無ければ素テキストのまま）
    let body = text;
    if (readerAvailable()) {
      body = await readDocument({ text: `タイトル: ${title || url}\nURL: ${url}\n\n${text}` }).catch(() => text);
    }
    const id = await addKnowledge({
      category: category || "資料",
      title: title || url,
      body,
      owner: req.user || "",
      sourceType: "url",
      sourceRef: url,
      folder: folder || "",
    });
    if (id) indexKnowledge(id, { title: title || url, category: category || "資料", body }).catch((e) => console.error("[index]", e.message));
    res.json({ ok: true, id, chars: body.length, read: readerAvailable() ? "ai" : "text" });
  } catch (e) {
    console.error("[knowledge/url]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// PDFを取り込んでナレッジ化
const kbUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// 各種ソース（buffer/text）から本文テキストを生成（AIで読み取り・構造化）
const OFFICE_RE = /(presentationml|wordprocessingml|spreadsheetml|officedocument|ms-powerpoint|msword|ms-excel)/i;
async function extractBody({ buffer, mimeType, text, name }) {
  const mt = mimeType || "";
  if (text && !buffer) {
    const body = readerAvailable() ? await readDocument({ text }).catch(() => text) : text;
    return { body, read: readerAvailable() && body !== text ? "ai" : "text" };
  }
  if (buffer && mt === "application/pdf") {
    let body = "";
    if (readerAvailable()) body = await readDocument({ buffer, mimeType: "application/pdf", displayName: name }).catch(() => "");
    if (!body) {
      const t = await pdfToText(buffer).catch(() => "");
      body = t && readerAvailable() ? await readDocument({ text: t }).catch(() => t) : t;
    }
    return { body, read: readerAvailable() && body ? "ai" : "text" };
  }
  if (buffer && mt.startsWith("image/")) {
    if (!readerAvailable()) throw new Error("画像の読み取りには GEMINI_API_KEY が必要です");
    return { body: await readDocument({ buffer, mimeType: mt, displayName: name }), read: "ai" };
  }
  if (buffer && OFFICE_RE.test(mt)) {
    const t = await officeToText(buffer); // pptx/docx/xlsx 等 → テキスト
    if (!t) throw new Error("テキストを抽出できませんでした");
    const body = readerAvailable() ? await readDocument({ text: t }).catch(() => t) : t;
    return { body, read: readerAvailable() && body !== t ? "ai" : "text" };
  }
  if (buffer && (mt.startsWith("text/") || mt === "application/json")) {
    const t = buffer.toString("utf8");
    const body = readerAvailable() ? await readDocument({ text: t }).catch(() => t) : t;
    return { body, read: readerAvailable() && body !== t ? "ai" : "text" };
  }
  throw new Error("この形式は取り込めません");
}

app.post("/api/knowledge/file", kbUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "ファイルが必要です" });
    const mt = req.file.mimetype || "";
    const folder = (req.body && req.body.folder) || "";
    const category = (req.body && req.body.category) || "資料";
    const name = (req.file.originalname || "資料").replace(/\.[^.]+$/, "");
    const sourceType = mt === "application/pdf" ? "pdf" : mt.startsWith("image/") ? "image" : "file";

    let result;
    try {
      result = await extractBody({ buffer: req.file.buffer, mimeType: mt, name });
    } catch (e) {
      return res.status(415).json({ error: e.message });
    }
    const body = result.body;
    if (!body || body.length < 20)
      return res.status(422).json({ error: "内容を読み取れませんでした（画質や形式をご確認ください）" });
    const id = await addKnowledge({
      category,
      title: name,
      body,
      owner: req.user || "",
      sourceType,
      sourceRef: req.file.originalname || "",
      folder,
    });
    if (id) indexKnowledge(id, { title: name, category, body }).catch((e) => console.error("[index]", e.message));
    res.json({ ok: true, id, chars: body.length, read: result.read });
  } catch (e) {
    console.error("[knowledge/file]", e.message);
    res.status(502).json({ error: e.message });
  }
});
app.post("/api/knowledge/pdf", kbUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "PDFファイルが必要です" });
    const text = await pdfToText(req.file.buffer);
    if (!text || text.length < 20)
      return res.status(422).json({ error: "テキストを抽出できませんでした（スキャンPDFはOCRが必要です）" });
    const name = (req.file.originalname || "PDF").replace(/\.pdf$/i, "");
    const id = await addKnowledge({
      category: (req.body && req.body.category) || "資料",
      title: name,
      body: text,
      owner: req.user || "",
      sourceType: "pdf",
      sourceRef: req.file.originalname || "",
      folder: (req.body && req.body.folder) || "",
    });
    if (id) indexKnowledge(id, { title: name, category: (req.body && req.body.category) || "資料", body: text }).catch((e) => console.error("[index]", e.message));
    res.json({ ok: true, id, chars: text.length });
  } catch (e) {
    console.error("[knowledge/pdf]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// 既存ナレッジを検索用に再構築（チャンク＋埋め込み）
app.post("/api/knowledge/reindex", async (req, res) => {
  try {
    const items = await listKnowledge();
    let n = 0;
    for (const it of items) {
      try {
        await indexKnowledge(it.id, { title: it.title, category: it.category, body: it.body });
        n++;
      } catch (e) {
        console.error("[reindex]", it.id, e.message);
      }
    }
    res.json({ ok: true, count: n, embeddings: embeddingsAvailable() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Googleドライブ連携（自社ナレッジ取り込み） ---
app.get("/api/drive/status", async (req, res) => {
  try {
    const connected = await gcalConnected(req.user);
    const ready = connected ? await driveReady(req.user) : false;
    res.json({ googleConnected: connected, driveReady: ready });
  } catch (e) {
    res.json({ googleConnected: false, driveReady: false });
  }
});
app.get("/api/drive/search", async (req, res) => {
  try {
    const files = await driveSearch(req.user, req.query.q || "");
    res.json({ files });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
app.get("/api/drive/list", async (req, res) => {
  try {
    const files = await driveList(req.user, {
      mode: req.query.mode || "recent",
      parent: req.query.parent || "",
      q: req.query.q || "",
    });
    res.json({ files });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
// 公式Google Picker用：短命アクセストークン
app.get("/api/drive/token", async (req, res) => {
  try {
    const token = await driveAccessToken(req.user);
    if (!token) return res.status(401).json({ error: "Google未連携" });
    res.json({ token });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
// 公式Google Picker用：APIキー等の設定（未設定なら内製ブラウザにフォールバック）
app.get("/api/drive/picker-config", (req, res) => {
  res.json({
    apiKey: process.env.GOOGLE_API_KEY || "",
    appId: process.env.GOOGLE_PROJECT_NUMBER || "",
  });
});
app.post("/api/knowledge/drive", async (req, res) => {
  try {
    const { fileId, category, folder } = req.body || {};
    if (!fileId) return res.status(400).json({ error: "fileId が必要です" });
    const c = await driveGetContent(req.user, fileId);
    let result;
    try {
      result = await extractBody({ buffer: c.buffer, mimeType: c.mimeType, text: c.text, name: c.name });
    } catch (e) {
      return res.status(415).json({ error: e.message });
    }
    const body = result.body;
    const read = result.read;
    const sourceType = "gdrive";
    if (!body || body.length < 20) return res.status(422).json({ error: "内容を読み取れませんでした" });
    const name = (c.name || "Driveファイル").replace(/\.[^.]+$/, "");
    const id = await addKnowledge({
      category: category || "資料",
      title: name,
      body,
      owner: req.user || "",
      sourceType,
      sourceRef: c.name || "",
      folder: folder || "",
    });
    if (id) indexKnowledge(id, { title: name, category: category || "資料", body }).catch((e) => console.error("[index]", e.message));
    res.json({ ok: true, id, chars: body.length, read });
  } catch (e) {
    console.error("[knowledge/drive]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// 進行中の商談（全員が閲覧できる）
app.get("/api/sessions/active", (req, res) => {
  res.json(listActiveSessions());
});

// Muxの設定・認証チェック（状態画面用）
app.get("/api/mux/status", async (req, res) => {
  const out = { configured: muxConfigured(), ok: false };
  if (!out.configured) return res.json(out);
  try {
    const r = await fetch("https://api.mux.com/video/v1/live-streams?limit=1", {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${process.env.MUX_TOKEN_ID}:${process.env.MUX_TOKEN_SECRET}`).toString("base64"),
      },
    });
    out.ok = r.ok;
    if (!r.ok) out.error = `${r.status}`;
  } catch (e) {
    out.error = e.message;
  }
  res.json(out);
});

// ===== 音声/動画ファイルのアップロード → 文字起こし・要約・FB・分析 =====
try { fs.mkdirSync("/tmp/kinbot-uploads", { recursive: true }); } catch {}
const upload = multer({ dest: "/tmp/kinbot-uploads", limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

app.post("/api/uploads", upload.single("file"), async (req, res) => {
  try {
    if (!transcriberAvailable()) {
      if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
      return res.status(500).json({ error: "文字起こし用のキー（DEEPGRAM_API_KEY か GROQ_API_KEY）を Railway に設定してください" });
    }
    if (!req.file) return res.status(400).json({ error: "ファイルがありません" });
    const id = "upload_" + crypto.randomUUID();
    const title = (req.body.title || "").trim() || req.file.originalname || "アップロード";
    const round = req.body.round ? Number(req.body.round) : roundFromTitle(title);
    const phase = req.body.phase || null;
    const displayName = await getDisplayName(req.user);
    await createMeeting(id, { meetingUrl: "", repName: displayName, title, owner: req.user });
    await updateMeetingMeta(id, { round: Number.isFinite(round) ? round : null, phase });
    await setMeetingStatus(id, "processing");
    res.json({ id, status: "processing" });
    // バックグラウンドで処理（応答後）
    processUpload(id, req.file, displayName).catch((e) => {
      console.error("[upload]", e.message);
      setMeetingStatus(id, "error");
    });
  } catch (e) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: e.message });
  }
});

async function processUpload(id, file, repName) {
  try {
    const utterances = await transcribeFile(file.path, file.mimetype);
    await saveMeeting(id, { transcript: utterances, summary: null, suggestions: [] });
    const transcript = utterances.map((u) => `${u.speaker?.name || ""}: ${u.text}`).join("\n").slice(-12000);
    if (transcript.trim().length >= 20) {
      const speakers = [...new Set(utterances.map((u) => u.speaker?.name).filter(Boolean))];
      const dateStr = new Date().toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      try {
        const rev = await analyzeMeeting({ transcript, repName, dateStr, speakers });
        await saveAnalysis(id, rev);
      } catch (e) {
        console.error("[upload review]", e.message);
      }
      try {
        let lostSignals = [];
        try { lostSignals = (await getSettings()).lostSignals || []; } catch {}
        const deep = await analyzeDeep({ transcript, repName, lostSignals });
        await saveDeepAnalysis(id, deep);
        const st = deep && deep.deal_status;
        if (st && ["進行中", "受注", "失注", "保留"].includes(st)) {
          const m = await getMeeting(id);
          const account = (m && ((m.account && m.account.trim()) || companyFromTitle(m.title))) || "";
          if (account) await setDealStatusAuto(account, st);
        }
      } catch (e) {
        console.error("[upload deep]", e.message);
      }
    }
    await setMeetingStatus(id, "done");
    // 新営業プロセスの抽出（Feature A）
    runExtractionSafe(id);

    // 動画/音声をMuxに資産化（再生用）。設定があるときだけ。
    if (muxConfigured()) {
      try {
        const uploadId = await startVodUpload(file.path, file.mimetype, id); // ここまでファイルが必要
        // エンコード完了は時間がかかるのでバックグラウンドで解決
        waitVodPlayback(uploadId)
          .then((pid) => pid && setMeetingMux(id, pid))
          .catch((e) => console.error("[upload mux wait]", e.message));
      } catch (e) {
        console.error("[upload mux]", e.message);
      }
    }
  } finally {
    try { fs.unlinkSync(file.path); } catch {}
  }
}

// --- Recall からのリアルタイム文字起こし Webhook ---
app.post("/api/recall/webhook", (req, res) => {
  if (!verifyRecallRequest(req)) return res.status(401).end();
  res.status(200).end(); // まず即ACK（処理は非同期で）
  setImmediate(async () => {
    try {
      const ev = parseTranscriptEvent(req.body);
      if (ev && ev.botId) {
        let s = getSession(ev.botId);
        if (!s) {
          s = createSession(ev.botId, {}); // 予約Bot等：受信時に遅延作成
          // DBの商談行（予約時に作成済み）から商談名・所有者を補完
          try {
            const m = await getMeeting(ev.botId);
            if (m) s.enrich({ title: m.title, owner: m.owner, repName: m.rep_name, muxPlaybackId: m.mux_playback_id });
          } catch {}
        }
        if (ev.type === "final") s.onFinal(ev.speaker, ev.text);
        else s.onPartial(ev.speaker, ev.text);
        return;
      }
      // 文字起こし以外＝完了/退出系イベントなら、セッションを締めて自動生成
      const name = String(req.body?.event || req.body?.type || "").toLowerCase();
      if (/done|ended|finished|fatal|complete|left|leave/.test(name)) {
        const botId = findBotId(req.body);
        if (botId && getSession(botId)) removeSession(botId); // dispose→自動で要約/FB/分析
      }
    } catch (e) {
      console.error("[webhook]", e.message);
    }
  });
});

// Webhookのいろいろな形からbot idを探す
function findBotId(body) {
  const cands = [
    body?.data?.bot?.id,
    body?.data?.bot_id,
    body?.bot?.id,
    body?.bot_id,
    body?.data?.id,
  ];
  return cands.find((x) => typeof x === "string") || null;
}

// 署名検証（本番では Recall 公式の検証を実装すること）
// https://docs.recall.ai/docs/authenticating-requests-from-recallai
function verifyRecallRequest(req) {
  if (!WEBHOOK_SECRET) {
    // 未設定なら通すが警告（本番は必ず検証する）
    return true;
  }
  // TODO: Recall の検証ヘルパに置き換える（Svix/ワークスペース検証シークレット）。
  // 暫定: 共有シークレットを独自ヘッダで確認する運用も可。
  return req.get("x-shodan-secret") === WEBHOOK_SECRET;
}

// --- 履歴API（過去の商談の振り返り） ---
// ログインユーザーは全員の商談を閲覧・分析できる（チーム共有方針）
function canAccess(_m, _req) {
  return true;
}

app.get("/api/meetings", async (req, res) => {
  try {
    // 全員が全商談を閲覧できる
    res.json(await listMeetings({ isAdmin: true }));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get("/api/meetings/:id", async (req, res) => {
  try {
    const m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "見つかりません" });
    if (!canAccess(m, req)) return res.status(403).json({ error: "権限がありません" });
    res.json(m);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get("/api/meetings/:id/recording", async (req, res) => {
  try {
    const m = await getMeeting(req.params.id);
    if (!m || !canAccess(m, req)) return res.json({ url: null });
    // 1) Bot録画（Recall）があればそれを優先（mp4で確実に再生できる）
    let recallUrl = null;
    try { recallUrl = await getRecordingUrl(req.params.id); } catch (e) { console.error("[recording] recall", e.message); }
    if (recallUrl) return res.json({ url: recallUrl, source: "recall" });
    // 2) 無ければ Mux VOD（アップロード動画など）
    if (m.mux_playback_id) {
      return res.json({ url: `https://stream.mux.com/${m.mux_playback_id}.m3u8`, hls: true, source: "mux" });
    }
    res.json({ url: null, source: null });
  } catch {
    res.json({ url: null });
  }
});

// 履歴：文字起こしから要約＋営業フィードバックを生成して保存
app.post("/api/meetings/:id/analyze", async (req, res) => {
  try {
    const m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "見つかりません" });
    if (!canAccess(m, req)) return res.status(403).json({ error: "権限がありません" });
    const tr = Array.isArray(m.transcript) ? m.transcript : [];
    if (tr.length === 0) return res.status(400).json({ error: "文字起こしがありません" });
    const transcript = tr
      .map((u) => `${u.speaker?.name || "話者" + (u.speaker?.id ?? "")}: ${u.text}`)
      .join("\n")
      .slice(-12000);
    const speakers = [...new Set(tr.map((u) => u.speaker?.name).filter(Boolean))];
    const dateStr = new Date(m.created_at).toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    const result = await analyzeMeeting({ transcript, repName: m.rep_name, dateStr, speakers });
    await saveAnalysis(req.params.id, result);
    res.json(result);
  } catch (e) {
    console.error("[analyze meeting]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// --- Googleカレンダー連携 ---
function googleRedirectUri() {
  return `${PUBLIC_URL}/auth/google/callback`;
}
app.get("/auth/google", (req, res) => {
  if (!googleConfigured()) return res.status(500).send("GOOGLE_CLIENT_ID/SECRET が未設定です");
  if (!PUBLIC_URL) return res.status(500).send("PUBLIC_URL が未設定です");
  // state にログイン中ユーザー（署名済み）を載せ、コールバックで誰の連携か判別
  const state = makeToken(req.user || "");
  res.redirect(authUrl(googleRedirectUri(), state));
});
app.get("/auth/google/callback", async (req, res) => {
  try {
    const owner = verifyToken(req.query.state || "");
    if (!owner) return res.status(400).send("セッションが無効です。ログインし直してください。");
    await exchangeCode(req.query.code, googleRedirectUri(), owner);
    res.redirect("/settings.html");
  } catch (e) {
    console.error("[google]", e.message);
    res.status(500).send("連携に失敗しました: " + e.message);
  }
});
app.get("/api/calendar/status", async (req, res) => {
  const out = { configured: googleConfigured(), connected: false, email: null, events: [] };
  try {
    const owner = req.user;
    out.connected = await gcalConnected(owner);
    if (out.connected) {
      out.email = await getPrimaryEmail(owner);
      // 今日1日（日本時間 00:00〜24:00）の範囲
      const now = new Date();
      const jst = new Date(now.getTime() + 9 * 3600 * 1000);
      const start = new Date(
        Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), 0, 0, 0) - 9 * 3600 * 1000
      );
      const end = new Date(start.getTime() + 24 * 3600 * 1000);
      out.events = await listZoomEvents(owner, {
        timeMin: start.toISOString(),
        timeMax: end.toISOString(),
      });
    }
  } catch (e) {
    out.error = e.message;
  }
  res.json(out);
});
app.post("/api/calendar/disconnect", async (req, res) => {
  await gcalDisconnect(req.user);
  res.json({ ok: true });
});

// --- Salesforce 連携（枠。SF_CLIENT_ID/SECRET 設定後に有効） ---
function sfRedirectUri() {
  return `${PUBLIC_URL}/auth/salesforce/callback`;
}
app.get("/auth/salesforce", (req, res) => {
  if (!salesforceConfigured()) return res.status(500).send("SF_CLIENT_ID/SECRET が未設定です（後日の連携作業で設定します）");
  if (!PUBLIC_URL) return res.status(500).send("PUBLIC_URL が未設定です");
  const state = makeToken(req.user || "");
  res.redirect(sfAuthUrl(sfRedirectUri(), state));
});
app.get("/auth/salesforce/callback", async (req, res) => {
  try {
    const owner = verifyToken(req.query.state || "");
    if (!owner) return res.status(400).send("セッションが無効です。ログインし直してください。");
    await sfExchangeCode(req.query.code, sfRedirectUri(), owner);
    res.redirect("/settings.html");
  } catch (e) {
    console.error("[salesforce]", e.message);
    res.status(500).send("連携に失敗しました: " + e.message);
  }
});
app.get("/api/salesforce/status", async (req, res) => {
  try {
    const info = await sfInfo(req.user);
    const us = await getUserSettings(req.user);
    res.json({ ...info, mapping: us.sfMapping || {} });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post("/api/salesforce/disconnect", async (req, res) => {
  await sfDisconnect(req.user);
  res.json({ ok: true });
});
// 項目マッピング（kinbotの情報 → SFの項目API参照名）を保存
app.put("/api/salesforce/mapping", async (req, res) => {
  try {
    const mapping = (req.body && req.body.mapping) || {};
    await saveUserSettings(req.user, { sfMapping: mapping });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 商談にSF商談リンクを保存
app.put("/api/meetings/:id/sf-link", async (req, res) => {
  try {
    await setMeetingSfUrl(req.params.id, (req.body && req.body.url) || "");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// kinbotの情報からSF更新候補を組み立てる
const SF_SOURCES = [
  { key: "stage", label: "フェーズ" },
  { key: "nextStep", label: "次のステップ" },
  { key: "issues", label: "課題・懸念" },
  { key: "summary", label: "要約" },
];
function buildProposed(m) {
  const s = m.summary || {};
  const a = m.analysis || {};
  const join = (arr) => (Array.isArray(arr) ? arr.join(" / ") : "");
  return {
    stage: m.phase ? PHASE_LABELS[m.phase] || m.phase : "",
    nextStep: join(s.action_items) || join(a.next_step ? [a.next_step] : []),
    issues: join(s.customer_concerns) || join(a.objections),
    summary: s.overview || "",
  };
}
app.post("/api/meetings/:id/sf-fields", async (req, res) => {
  try {
    const out = { configured: salesforceConfigured(), connected: false, rows: [] };
    if (!out.configured) return res.json(out);
    out.connected = await sfConnected(req.user);
    if (!out.connected) return res.json(out);
    const m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "見つかりません" });
    const url = (req.body && req.body.url) || m.sf_url || "";
    const recordId = extractRecordId(url);
    if (!recordId) return res.json({ ...out, needLink: true });
    const mapping = (await getUserSettings(req.user)).sfMapping || {};
    const sfFields = SF_SOURCES.map((s) => mapping[s.key]).filter(Boolean);
    if (sfFields.length === 0) return res.json({ ...out, recordId, needMapping: true });
    let record = {};
    try {
      record = await getOpportunity(req.user, recordId, sfFields);
    } catch (e) {
      return res.json({ ...out, recordId, fetchError: e.message });
    }
    const proposed = buildProposed(m);
    const rows = SF_SOURCES.filter((s) => mapping[s.key]).map((s) => ({
      key: s.key,
      label: s.label,
      sfField: mapping[s.key],
      current: record[mapping[s.key]] ?? "",
      proposed: proposed[s.key] || "",
    }));
    res.json({ ...out, recordId, rows });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// SFへ更新を反映
app.post("/api/meetings/:id/sf-update", async (req, res) => {
  try {
    const { recordId, fields } = req.body || {};
    if (!recordId || !fields || typeof fields !== "object")
      return res.status(400).json({ error: "recordId と fields が必要です" });
    await updateOpportunity(req.user, recordId, fields);
    res.json({ ok: true });
  } catch (e) {
    console.error("[sf-update]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// その日の予定一覧（Zoom以外・終日含む）を返す（商談名の選択用）
app.get("/api/calendar/events", async (req, res) => {
  const out = { connected: false, events: [] };
  try {
    const owner = req.user;
    out.connected = await gcalConnected(owner);
    if (!out.connected) return res.json(out);
    // 対象日（JST）。未指定なら今日
    let dateStr = (req.query.date || "").toString().trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const jst = new Date(Date.now() + 9 * 3600 * 1000);
      dateStr = jst.toISOString().slice(0, 10);
    }
    const start = new Date(`${dateStr}T00:00:00+09:00`);
    const end = new Date(start.getTime() + 24 * 3600 * 1000);
    out.date = dateStr;
    let events = await listDayEvents(owner, {
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
    });
    // 設定のフィルター文字（カンマ/空白/読点区切り・いずれか一致）
    const us = await getUserSettings(owner);
    const kws = (us.calendarFilter || "")
      .split(/[,、\s]+/)
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    if (kws.length) {
      events = events.filter((ev) => {
        const t = (ev.title || "").toLowerCase();
        return kws.some((k) => t.includes(k));
      });
    }
    out.filtered = kws.length > 0;
    out.events = events;
  } catch (e) {
    out.error = e.message;
  }
  res.json(out);
});

// --- 登録リンク（名前付きZoom URL） ---
app.get("/api/links", async (req, res) => {
  try {
    const s = await getUserSettings(req.user);
    res.json({ links: Array.isArray(s.savedLinks) ? s.savedLinks : [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.put("/api/links", async (req, res) => {
  try {
    const links = Array.isArray(req.body?.links)
      ? req.body.links
          .filter((l) => l && l.name && l.url)
          .map((l) => ({ name: String(l.name).slice(0, 80), url: String(l.url).slice(0, 500) }))
          .slice(0, 50)
      : [];
    const r = await saveUserSettings(req.user, { savedLinks: links });
    res.json({ ok: true, links, ...r });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- スマートリンク（担当者切り替えに追随する共有Zoom URL） ---
// 各担当者は「自分の商談用リンク」を1つだけ登録しておく（myZoomLink）。
app.get("/api/my-zoom-link", async (req, res) => {
  try {
    const s = await getUserSettings(req.user);
    res.json({ url: s.myZoomLink || "" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put("/api/my-zoom-link", async (req, res) => {
  try {
    const url = String(req.body?.url || "").slice(0, 500);
    await saveUserSettings(req.user, { myZoomLink: url });
    res.json({ ok: true, url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// ===== アポ振り分け =====
// Zoomの会議URL風の見た目にする（/j/<10桁の数字>?pwd=<トークン>）。
// 実際の転送は /j/:slug が行い、?pwd= は見た目だけ（サーバー側では無視される）。
function zoomLikeSlug() {
  const n = (crypto.randomBytes(5).readUIntBE(0, 5) % 9000000000) + 1000000000; // 10桁
  return String(n);
}
function joinUrl(slug) {
  const pwd = crypto.createHash("sha256").update("kbtpwd:" + slug).digest("base64url").slice(0, 22);
  return `${PUBLIC_URL}/j/${slug}?pwd=${pwd}`;
}
// タイトルが【新/ヒ】または【初回/】を含むか（全角半角の違いはNFKCで吸収）
function apoTitleTag(title) {
  const t = String(title || "").normalize("NFKC");
  return t.includes("【新/ヒ】") || t.includes("【初回/】");
}
// 笹原拓真＋インターン（＝インターン登録に登録した「アポを取る人」）が主催者で、
// タイトルが対象タグの予定を取り込み、各アポにスマートリンクを自動発行して返す。
// 担当者を割り当てると /j/<slug> がその人のZoomに切り替わる。
// query: days（既定30。今日から何日先までの予定を取り込むか）
app.get("/api/apo/pickup", async (req, res) => {
  try {
    const gcalOwner = req.user;
    if (!gcalOwner || !(await gcalConnected(gcalOwner))) {
      return res.status(400).json({ error: "あなたのGoogleが連携されていません。設定→連携→Google連携 を先に済ませてください。" });
    }
    const setters = await listInterns();
    if (!setters.length) {
      return res.status(400).json({ error: "アポを取る人が未登録です。設定→インターン登録 で、笹原拓真さんとインターン生の名前・メールアドレスを登録してください。" });
    }
    // 取得日・商談日はそれぞれ任意の1日。両方空なら「今後の予定」を既定表示。
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const created = dateRe.test(String(req.query.created || "")) ? String(req.query.created) : "";
    const start = dateRe.test(String(req.query.start || "")) ? String(req.query.start) : "";
    let timeMin, timeMax;
    if (start) {
      // 商談日が指定されていれば、その日の窓（Googleの開始時刻で直接絞れる）
      timeMin = new Date(Date.parse(start + "T00:00:00+09:00")).toISOString();
      timeMax = new Date(Date.parse(start + "T00:00:00+09:00") + 86400 * 1000).toISOString();
    } else if (created) {
      // 取得日のみ指定：商談日は取得日以降なので、その日から先を余裕を持って読む
      timeMin = new Date(Date.parse(created + "T00:00:00+09:00") - 2 * 86400 * 1000).toISOString();
      timeMax = new Date(Date.parse(created + "T00:00:00+09:00") + 90 * 86400 * 1000).toISOString();
    } else {
      // 両方空：今日から60日先までの予定を既定表示
      const now = new Date();
      timeMin = now.toISOString();
      timeMax = new Date(now.getTime() + 60 * 86400 * 1000).toISOString();
    }

    const items = [];
    const errors = [];
    for (const st of setters) {
      const setterEmail = String(st.email || "").toLowerCase();
      let evs = [];
      try {
        evs = await listCalendarEvents(gcalOwner, st.email, { timeMin, timeMax });
      } catch (e) {
        const msg = /40[34]/.test(e.message)
          ? "カレンダーを読めませんでした（このメールのカレンダーが共有されているか確認してください）"
          : e.message;
        errors.push({ setter: st.name, email: st.email, error: msg });
        continue;
      }
      for (const ev of evs) {
        if (ev.allDay) continue;          // 終日予定はアポではない
        if (!ev.title) continue;
        // 本人が主催者の予定だけ（招待されただけの予定は除外）。organizer優先、無ければcreatorで判定。
        const org = String(ev.organizer || "").toLowerCase();
        const creator = String(ev.creator || "").toLowerCase();
        const isHost = (org && org === setterEmail) || (!org && creator && creator === setterEmail);
        if (!isHost) continue;
        // タイトルが【新/ヒ】または【初回/】を含む予定だけ（全角半角問わず）
        if (!apoTitleTag(ev.title)) continue;
        // 取得日・商談日の指定があれば、それぞれ完全一致で絞る
        const createdDate = jstDateStr(ev.created);
        const startDate = jstDateStr(ev.start);
        if (created && createdDate !== created) continue;
        if (start && startDate !== start) continue;
        // このカレンダー予定にスマートリンクが無ければ自動発行（あれば使い回す）
        let link = await getSmartLinkByEvent(ev.id);
        if (!link) {
          let slug;
          for (let k = 0; k < 6; k++) { slug = zoomLikeSlug(); if (!(await getSmartLink(slug))) break; }
          link = await createSmartLink({
            slug, label: ev.title, owner: null, createdBy: gcalOwner,
            eventId: ev.id, setter: st.name, startTime: ev.start,
          });
        }
        items.push({
          event_id: ev.id,
          setter_name: st.name,
          title: ev.title,
          start: ev.start,
          created: ev.created || "",
          created_date: createdDate,
          original_url: ev.url || "",
          slug: link.slug,
          smart_url: joinUrl(link.slug),
          current_owner: link.current_owner || null,
        });
      }
    }
    items.sort((a, b) => String(a.start).localeCompare(String(b.start)));
    res.json({ filters: { created, start }, count: items.length, appointments: items, errors });
  } catch (e) {
    console.error("[apo/pickup]", e);
    res.status(500).json({ error: e.message });
  }
});

// 担当者候補一覧（名前＋商談用リンクの設定有無）。プルダウン用。
app.get("/api/smart-links/reps", async (req, res) => {
  try {
    const users = await listUsers();
    const reps = [];
    for (const u of users) {
      const s = await getUserSettings(u.email).catch(() => ({}));
      reps.push({ email: u.email, name: u.name || u.email, has_zoom_link: !!s.myZoomLink });
    }
    res.json(reps);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// スマートリンクの作成（アポが取れた直後に、担当者未定でも先に作れる）
app.post("/api/smart-links", async (req, res) => {
  try {
    const label = String(req.body?.label || "").slice(0, 200);
    const owner = req.body?.owner ? String(req.body.owner) : null;
    let slug;
    for (let k = 0; k < 6; k++) { slug = zoomLikeSlug(); if (!(await getSmartLink(slug))) break; }
    const link = await createSmartLink({ slug, label, owner, createdBy: req.user });
    res.json({ ok: true, link, url: joinUrl(slug) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// 自分が作ったスマートリンクの一覧（管理者は全件）
app.get("/api/smart-links", async (req, res) => {
  try {
    const links = await listSmartLinks(req.isAdmin ? null : req.user);
    res.json(links.map((l) => ({ ...l, url: joinUrl(l.slug) })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// 担当者の切り替え（ここを変えるだけで、既に送信済みのURLの行き先も自動的に変わる）
app.put("/api/smart-links/:slug/owner", async (req, res) => {
  try {
    const existing = await getSmartLink(req.params.slug);
    if (!existing) return res.status(404).json({ error: "リンクが見つかりません" });
    if (!req.isAdmin && existing.created_by !== req.user) return res.status(403).json({ error: "このリンクを操作する権限がありません" });
    const owner = req.body?.owner ? String(req.body.owner) : null;
    const link = await setSmartLinkOwner(req.params.slug, owner);
    res.json({ ok: true, link });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete("/api/smart-links/:slug", async (req, res) => {
  try {
    const existing = await getSmartLink(req.params.slug);
    if (!existing) return res.json({ ok: true });
    if (!req.isAdmin && existing.created_by !== req.user) return res.status(403).json({ error: "このリンクを操作する権限がありません" });
    await deleteSmartLink(req.params.slug);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// 実際にクリックされたときのリダイレクト先（認証不要：お客様が開くURLのため）
app.get("/j/:slug", async (req, res) => {
  try {
    const link = await getSmartLink(req.params.slug);
    if (!link) return res.status(404).send("このリンクは見つかりませんでした。担当者にご確認ください。");
    if (!link.current_owner) {
      return res.send(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8" /><title>担当者確定中</title></head>
        <body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f7f5ef;">
          <div style="text-align:center;color:#334;"><p style="font-size:15px;">担当者を確定中です。まもなくこちらのURLから会議室にご案内します。<br>このままお待ちいただくか、少し時間をおいて再度お試しください。</p></div>
        </body></html>`);
    }
    const s = await getUserSettings(link.current_owner).catch(() => ({}));
    if (!s.myZoomLink) return res.status(404).send("担当者の会議室URLが設定されていません。担当者にご確認ください。");
    res.redirect(s.myZoomLink);
  } catch (e) {
    console.error("[smart-link redirect]", e.message);
    res.status(500).send("エラーが発生しました。");
  }
});

// 履歴：深掘り分析（スコア・BANT・購買シグナル等）を生成して保存
app.post("/api/meetings/:id/deep-analyze", async (req, res) => {
  try {
    const m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "見つかりません" });
    if (!canAccess(m, req)) return res.status(403).json({ error: "権限がありません" });
    const tr = Array.isArray(m.transcript) ? m.transcript : [];
    if (tr.length === 0) return res.status(400).json({ error: "文字起こしがありません" });
    const transcript = tr
      .map((u) => `${u.speaker?.name || "話者" + (u.speaker?.id ?? "")}: ${u.text}`)
      .join("\n")
      .slice(-12000);
    const analysis = await analyzeDeep({ transcript, repName: m.rep_name, phase: m.phase });
    await saveDeepAnalysis(req.params.id, analysis);
    res.json(analysis);
  } catch (e) {
    console.error("[deep-analyze]", e.message);
    res.status(502).json({ error: e.message });
  }
});

const server = http.createServer(app);

// --- ダッシュボード用 WebSocket ---
const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (ws, req) => {
  // ログイン必須（Cookieで確認）
  if (authEnabled() && !getUser(req)) {
    ws.close();
    return;
  }
  const url = new URL(req.url, "http://localhost");
  const sessionId = url.searchParams.get("session");
  const s = sessionId && getSession(sessionId);
  if (!s) {
    ws.send(JSON.stringify({ type: "status", state: "no_session" }));
    ws.close();
    return;
  }
  s.addSocket(ws, getUser(req) || "");
  ws.on("close", () => s.removeSocket(ws));
  ws.on("error", () => s.removeSocket(ws));
});

server.listen(PORT, async () => {
  await initDb().catch((e) => console.error("[db] init失敗", e.message));
  startScheduler({ publicUrl: PUBLIC_URL });
  startSessionMonitor();
  // 「進行中(未設定)」のうち auto_lose_deadline を過ぎた案件を自動で失注に切り替える：起動直後＋1時間ごと
  const autoLose = () =>
    applyAutoLoseDeadlines()
      .then((n) => n && console.log(`[auto-lose] ${n}件の案件を自動で失注(未定)に切り替えました`))
      .catch((e) => console.error("[auto-lose]", e.message));
  setTimeout(autoLose, 15000);
  setInterval(autoLose, 60 * 60 * 1000);
  // 文字起こしの無い古い商談（3時間以上前）を定期削除：起動1分後＋6時間ごと
  const cleanup = () =>
    deleteEmptyMeetings(180)
      .then((n) => n && console.log(`[cleanup] 空商談を${n}件削除`))
      .catch(() => {});
  setTimeout(cleanup, 60 * 1000);
  setInterval(cleanup, 6 * 60 * 60 * 1000);
  console.log(`\n  kinbot (Bot方式) → http://localhost:${PORT}`);
  console.log(`  公開URL(Webhook受け口): ${PUBLIC_URL || "(未設定)"}`);
  console.log(`  要約エンジン: ${llm.provider} (${llm.model})`);
  console.log(`  カレンダー連携: ${googleConfigured() ? "設定あり" : "未設定"}\n`);
});

// 進行中セッションのBot状態をRecallに定期確認し、通話終了なら自動でクローズ
const SESSION_ENDED_CODES = new Set([
  "call_ended",
  "recording_done",
  "done",
  "fatal",
  "recording_permission_denied",
  "media_expired",
]);
function startSessionMonitor() {
  setInterval(async () => {
    const active = listActiveSessions();
    for (const a of active) {
      // アップロード由来など、Recall botでないものは除外
      if (!a.botId || String(a.botId).startsWith("upload_")) continue;
      try {
        const bot = await getBot(a.botId);
        const changes = bot?.status_changes || [];
        const latest = changes.length ? changes[changes.length - 1].code : bot?.status?.code || "";
        if (SESSION_ENDED_CODES.has(latest)) {
          console.log(`[monitor] 通話終了を検知（${latest}）→ クローズ: ${a.botId}`);
          removeSession(a.botId); // dispose → 視聴者へ ended 通知・要約/分析・Mux停止
        }
      } catch (e) {
        // 404等（botが消えている）→ 終了扱いでクローズ
        if (/\b404\b/.test(e.message)) {
          console.log(`[monitor] bot未検出→クローズ: ${a.botId}`);
          removeSession(a.botId);
        }
      }
    }
  }, 30000);
}
