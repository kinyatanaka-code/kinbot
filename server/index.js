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
import { analyzerInfo, analyzeMeeting, analyzeDeep, analyzeTendency, analyzeSet, generateThanks } from "./analyzer.js";
import {
  googleConfigured,
  authUrl,
  exchangeCode,
  isConnected as gcalConnected,
  disconnect as gcalDisconnect,
  listZoomEvents,
  listDayEvents,
  getPrimaryEmail,
} from "./google.js";
import { startScheduler } from "./scheduler.js";
import { muxConfigured, createLiveStream } from "./mux.js";
import { pdfToText, urlToText } from "./ingest.js";
import { indexKnowledge, embeddingsAvailable } from "./retrieval.js";
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
    const { round, phase, title, owner, createdAt } = req.body || {};
    const r = round === "" || round == null ? null : Number(round);
    await updateMeetingMeta(req.params.id, {
      round: Number.isFinite(r) ? r : null,
      phase: phase || null,
      title: title === undefined ? undefined : title,
      owner: owner === undefined ? undefined : owner,
      createdAt: createdAt ? createdAt : undefined,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
app.delete("/api/meetings/:id", async (req, res) => {
  try {
    await deleteMeeting(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

// --- 商談終了：Botを退出させる ---
app.post("/api/sessions/:id/stop", async (req, res) => {
  await leaveBot(req.params.id);
  removeSession(req.params.id);
  res.json({ ok: true });
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
    const id = await addKnowledge({
      category: category || "資料",
      title: title || url,
      body: text,
      owner: req.user || "",
      sourceType: "url",
      sourceRef: url,
      folder: folder || "",
    });
    if (id) indexKnowledge(id, { title: title || url, category: category || "資料", body: text }).catch((e) => console.error("[index]", e.message));
    res.json({ ok: true, id, chars: text.length });
  } catch (e) {
    console.error("[knowledge/url]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// PDFを取り込んでナレッジ化
const kbUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
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
        const deep = await analyzeDeep({ transcript, repName });
        await saveDeepAnalysis(id, deep);
      } catch (e) {
        console.error("[upload deep]", e.message);
      }
    }
    await setMeetingStatus(id, "done");
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
    res.json({ url: await getRecordingUrl(req.params.id) });
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
