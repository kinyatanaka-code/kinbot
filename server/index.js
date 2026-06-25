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
import { transcribeFile, transcriberAvailable } from "./transcribe.js";
import { createBot, leaveBot, parseTranscriptEvent, getRecordingUrl, getBot } from "./recall.js";
import { createSession, getSession, removeSession, listActiveSessions } from "./sessions.js";
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
import { analyzerInfo, analyzeMeeting, analyzeDeep, analyzeTendency, analyzeSet, analyzeWinLoss, extractLostSignals, freeAnalyze, chatWithData, generateThanks, getCheckItems } from "./analyzer.js";
import {
  googleConfigured,
  authUrl,
  exchangeCode,
  isConnected as gcalConnected,
  disconnect as gcalDisconnect,
  listZoomEvents,
  listDayEvents,
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
const OPEN_PATHS = new Set(["/api/recall/webhook", "/api/login", "/api/register", "/api/auth-info"]);
if (!authEnabled()) {
  console.warn("[警告] アカウント未設定。誰でも操作できます。公開時は DATABASE_URL を設定し登録制にしてください。");
}
app.use((req, res, next) => {
  if (!authEnabled()) {
    req.user = "admin";
    req.isAdmin = true;
    return next();
  }
  if (OPEN_PATHS.has(req.path)) return next();
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
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "ログインが必要です" });
  return res.redirect("/login.html");
});

app.use(express.static(path.join(__dirname, "..", "public")));

// Webhook だけ raw body も保持（将来の署名検証用）
app.use(
  "/api/recall/webhook",
  express.json({ verify: (req, _res, buf) => (req.rawBody = buf) })
);
app.use(express.json());

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
    const { round, phase, title, owner, createdAt, account } = req.body || {};
    const r = round === "" || round == null ? null : Number(round);
    await updateMeetingMeta(req.params.id, {
      round: Number.isFinite(r) ? r : null,
      phase: phase || null,
      title: title === undefined ? undefined : title,
      owner: owner === undefined ? undefined : owner,
      createdAt: createdAt ? createdAt : undefined,
      account: account === undefined ? undefined : account,
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

// 失注 vs 進行中・受注 の傾向を比較分析
app.post("/api/winloss-analysis", async (req, res) => {
  try {
    const { owner, owners, phase, phases, from, to, force } = req.body || {};
    const ownerList = Array.isArray(owners) ? owners.filter(Boolean) : owner ? [owner] : [];
    const phaseList = Array.isArray(phases) ? phases.filter(Boolean) : phase ? [phase] : [];
    let rows = await listMeetings({ isAdmin: true });
    rows = rows.filter((m) => {
      if (ownerList.length && !ownerList.includes(m.owner || "")) return false;
      if (phaseList.length && !phaseList.includes(m.phase || "")) return false;
      const d = new Date(m.created_at);
      if (from && d < new Date(from + "T00:00:00")) return false;
      if (to && d > new Date(to + "T23:59:59")) return false;
      return true;
    });

    const statuses = await listDealStatuses();
    const acctOf = (m) => (m.account && m.account.trim()) || companyFromTitle(m.title) || "(無題)";
    const statusOf = (m) => {
      const s = statuses[acctOf(m)];
      if (s && s.status) return s.status;
      if (m.analysis && m.analysis.deal_status) return m.analysis.deal_status;
      return "進行中";
    };
    const lost = rows.filter((m) => statusOf(m) === "失注");
    const active = rows.filter((m) => statusOf(m) === "進行中" || statusOf(m) === "受注");

    if (!lost.length || !active.length) {
      return res.status(400).json({
        error: `比較には両方の案件が必要です（失注 ${lost.length}件 / 進行中・受注 ${active.length}件）。商談を重ねてステータスが付くと分析できます。`,
      });
    }

    const block = (m, i) => {
      const p = [`#${i + 1} 「${m.title || "無題"}」 ${m.round_no ? m.round_no + "回目 " : ""}フェーズ${m.phase || "-"}`];
      const s = m.summary || {};
      if (s.overview) p.push(`要約: ${s.overview}`);
      if (Array.isArray(s.customer_concerns) && s.customer_concerns.length) p.push(`相手の懸念: ${s.customer_concerns.join(" / ")}`);
      const mt = m.metrics || {};
      if (typeof mt.repTalkPct === "number") p.push(`営業トーク比率: ${mt.repTalkPct}%`);
      if (mt.landedCount || mt.concernCount) p.push(`刺さったトーク${mt.landedCount || 0}/懸念${mt.concernCount || 0}`);
      const a = m.analysis;
      if (a && a.scores) p.push(`スコア ヒア${a.scores.hearing ?? "-"}/提案${a.scores.proposal ?? "-"}/クロ${a.scores.closing ?? "-"}/傾聴${a.scores.listening ?? "-"}`);
      if (a && a.objections?.length) p.push(`懸念対応: ${a.objections.join(" / ")}`);
      if (a && a.rep_habits?.length) p.push(`口癖: ${a.rep_habits.join(" / ")}`);
      return p.join("\n");
    };
    const cut = (arr) => {
      let s = arr.slice(0, 12).map(block).join("\n\n");
      return s.length > 8000 ? s.slice(0, 8000) : s;
    };
    const lostMaterial = cut(lost);
    const activeMaterial = cut(active);

    // キャッシュ
    const key = `winloss|${[...ownerList].sort().join("+")}|${[...phaseList].sort().join("+")}|${from || ""}|${to || ""}`;
    const fingerprint = crypto
      .createHash("sha1")
      .update(
        rows.map((m) => `${m.bot_id}:${new Date(m.updated_at || m.created_at).getTime()}:${statusOf(m)}`).sort().join(",")
      )
      .digest("hex");
    const cache = await getSetCache(key);
    if (cache && cache.fingerprint === fingerprint && !force) {
      return res.json({ ...cache.result, cached: true });
    }

    const ownerName = ownerList.length ? ownerList.map((o) => rows.find((m) => m.owner === o)?.owner_name || o).join("・") : "全員";
    const phaseDesc = phaseList.length ? phaseList.map((p) => PHASE_LABELS[p] || p).join("・") : "すべて";
    const filterDesc = `営業担当: ${ownerName} ／ フェーズ: ${phaseDesc}`;

    const result = await analyzeWinLoss({
      lostMaterial,
      activeMaterial,
      lostCount: lost.length,
      activeCount: active.length,
      filterDesc,
    });
    const payload = { ...result, lostCount: lost.length, activeCount: active.length };
    await saveSetCache(key, fingerprint, payload);
    res.json({ ...payload, cached: false });
  } catch (e) {
    console.error("[winloss]", e.message);
    res.status(502).json({ error: e.message });
  }
});

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

// ===== 失注サイン（学習） =====
app.get("/api/lost-signals", async (req, res) => {
  try {
    const cfg = await getSettings();
    res.json({ signals: Array.isArray(cfg.lostSignals) ? cfg.lostSignals : [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.put("/api/lost-signals", async (req, res) => {
  try {
    const signals = Array.isArray(req.body?.signals) ? req.body.signals.slice(0, 30) : [];
    await saveSettings({ lostSignals: signals });
    res.json({ ok: true, signals });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post("/api/lost-signals/learn", async (req, res) => {
  try {
    const statuses = await listDealStatuses();
    let rows = await listMeetings({ isAdmin: true });
    const acctOf = (m) => (m.account && m.account.trim()) || companyFromTitle(m.title) || "(無題)";
    const statusOf = (m) => {
      const s = statuses[acctOf(m)];
      if (s && s.status) return s.status;
      if (m.analysis && m.analysis.deal_status) return m.analysis.deal_status;
      return "進行中";
    };
    const lost = rows.filter((m) => statusOf(m) === "失注");
    if (!lost.length) return res.status(400).json({ error: "失注の案件がまだありません。商談を重ねてステータスが付くと学習できます。" });
    const block = (m, i) => {
      const p = [`#${i + 1} 「${m.title || "無題"}」`];
      const s = m.summary || {};
      if (s.overview) p.push(`要約: ${s.overview}`);
      if (Array.isArray(s.customer_concerns) && s.customer_concerns.length) p.push(`懸念: ${s.customer_concerns.join(" / ")}`);
      const a = m.analysis;
      if (a && a.deal_status_reason) p.push(`失注理由(AI): ${a.deal_status_reason}`);
      if (a && a.objections?.length) p.push(`異議: ${a.objections.join(" / ")}`);
      return p.join("\n");
    };
    let lostMaterial = lost.slice(0, 15).map(block).join("\n\n");
    if (lostMaterial.length > 8000) lostMaterial = lostMaterial.slice(0, 8000);
    const signals = await extractLostSignals({ lostMaterial });
    await saveSettings({ lostSignals: signals });
    res.json({ ok: true, signals, lostCount: lost.length });
  } catch (e) {
    console.error("[lost-signals]", e.message);
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
app.post("/api/analyze-set", async (req, res) => {
  try {
    const { owner, owners, phase, phases, from, to, force, cachedOnly } = req.body || {};
    const ownerList = Array.isArray(owners) ? owners.filter(Boolean) : owner ? [owner] : [];
    const phaseList = Array.isArray(phases) ? phases.filter(Boolean) : phase ? [phase] : [];
    let rows = await listMeetings({ isAdmin: true });
    rows = rows.filter((m) => {
      if (ownerList.length && !ownerList.includes(m.owner || "")) return false;
      if (phaseList.length && !phaseList.includes(m.phase || "")) return false;
      const d = new Date(m.created_at);
      if (from && d < new Date(from + "T00:00:00")) return false;
      if (to && d > new Date(to + "T23:59:59")) return false;
      return true;
    });
    const count = rows.length;

    // キャッシュキーと、データ変更を検知する指紋
    const key = `${[...ownerList].sort().join("+")}|${[...phaseList].sort().join("+")}|${from || ""}|${to || ""}`;
    const fingerprint = crypto
      .createHash("sha1")
      .update(
        rows
          .map((m) => `${m.bot_id}:${new Date(m.updated_at || m.created_at).getTime()}`)
          .sort()
          .join(",")
      )
      .digest("hex");

    const cache = await getSetCache(key);
    const valid = cache && cache.fingerprint === fingerprint;
    if (valid && !force) {
      return res.json({ ...cache.result, cached: true, count });
    }
    if (cachedOnly) {
      return res.json({ hasCache: false, cached: false, count });
    }
    if (count === 0) return res.status(400).json({ error: "対象の商談がありません" });

    // 新しい順に最大15件を対象（トークン量を抑制）
    const use = rows.slice(0, 15);
    const blocks = use.map((m, i) => {
      const p = [`#${i + 1} 「${m.title || "無題"}」 ${m.round_no ? m.round_no + "回目 " : ""}フェーズ${m.phase || "-"}`];
      const s = m.summary || {};
      if (s.overview) p.push(`要約: ${s.overview}`);
      if (Array.isArray(s.key_points) && s.key_points.length) p.push(`要点: ${s.key_points.join(" / ")}`);
      const a = m.analysis;
      if (a && a.scores) {
        p.push(`スコア ヒア${a.scores.hearing ?? "-"}/提案${a.scores.proposal ?? "-"}/クロ${a.scores.closing ?? "-"}/傾聴${a.scores.listening ?? "-"}`);
        if (a.score_reasons) {
          const r = a.score_reasons;
          p.push(`理由 ヒア「${r.hearing || ""}」提案「${r.proposal || ""}」クロ「${r.closing || ""}」傾聴「${r.listening || ""}」`);
        }
        if (a.rep_habits?.length) p.push(`口癖: ${a.rep_habits.join(" / ")}`);
        if (a.customer_reactions?.length) p.push(`顧客反応: ${a.customer_reactions.join(" / ")}`);
        if (a.coaching?.length) p.push(`助言: ${a.coaching.join(" / ")}`);
      }
      return p.join("\n");
    });
    let material = blocks.join("\n\n");
    if (material.length > 14000) material = material.slice(0, 14000);

    const ownerName = ownerList.length
      ? ownerList.map((o) => rows.find((m) => m.owner === o)?.owner_name || o).join("・")
      : "全員";
    const phaseDesc = phaseList.length ? phaseList.map((p) => PHASE_LABELS[p] || p).join("・") : "すべて";
    const filterDesc = `営業担当: ${ownerName} ／ フェーズ: ${phaseDesc} ／ 件数: ${count}`;

    const result = await analyzeSet({ material, filterDesc });
    const payload = { ...result, used: use.length };
    await saveSetCache(key, fingerprint, payload);
    res.json({ ...payload, cached: false, count });
  } catch (e) {
    console.error("[analyze-set]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// 担当者（所有者）の商談傾向を合成
app.post("/api/tendency", async (req, res) => {
  try {
    const { owner } = req.body || {};
    if (!owner) return res.status(400).json({ error: "owner が必要です" });
    const allM = await listMeetings({ isAdmin: true });
    const items = allM
      .filter((m) => (m.owner || "") === owner && m.analysis && m.analysis.scores)
      .map((m) => ({ title: m.title, phase: m.phase, analysis: m.analysis }));
    if (items.length === 0) {
      return res.status(400).json({ error: "この担当者の分析済み商談がありません（各商談で『分析を生成』してください）" });
    }
    const repName = items[0]?.analysis ? owner : owner;
    const result = await analyzeTendency({ repName, items });
    res.json({ ...result, count: items.length });
  } catch (e) {
    console.error("[tendency]", e.message);
    res.status(502).json({ error: e.message });
  }
});

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

// --- 商談終了：Botを退出させる ---
app.post("/api/sessions/:id/stop", async (req, res) => {
  await leaveBot(req.params.id);
  removeSession(req.params.id);
  res.json({ ok: true });
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
    const round = req.body.round ? Number(req.body.round) : null;
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
