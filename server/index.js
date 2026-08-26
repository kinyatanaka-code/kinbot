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

import { pickCloser, commitAssignment, rotationStatus, setNextCloser,
         getRotationConfig, loadTeamContext, balanceRange, nextOrderFor } from "./rotation.js";
import { sendApoMail, sendTestApoMail, runReminderSweep, listTomorrowReminders, getApoMailConfig,
         DEFAULT_CONFIRM_SUBJECT, DEFAULT_CONFIRM_BODY,
         DEFAULT_REMINDER_SUBJECT, DEFAULT_REMINDER_BODY, stripRetiredLines } from "./apomail.js";
import { startKasasagi, getKasasagi, stopKasasagi, feedTranscript, kasasagiInfo,
         buildScript, buildReport, faceState, SLIDE_LABELS } from "./kasasagi.js";
import { notifyAssigned, notifyMailDraft, notifyChat, notifyAll, notifyPerson, chatWebhookUrl, chatInfo } from "./chat.js";
import { note as devNote, errKey, buildMorningSummary, NOTE_KINDS, dropSimilar } from "./devnotes.js";
import { askBot } from "./askbot.js";
import { newJobId, getJob, cancelJob, runBulk, tableFromFile, tableFromText, rowsFromTable } from "./bulklinks.js";
import { buildSlots, stillFree } from "./booking.js";
import { checkLive, checkProcessSheet, checkLinks, buildProposal, notifyCheck } from "./selfcheck.js";
import { UI_PAGES, nextPage, reviewPage, splitIdeas } from "./uireview.js";
import { verifyChatRequest, readEvent, replyBody, parseCommand, helpText, jstDate, jstTime, INTENT_SYSTEM, guessIntent } from "./chatcmd.js";
import { normalizeSpace } from "./chatapp.js";
import { judge as judgeAutolaunch, reasonText, parseTitle as parseLaunchTitle } from "./autolaunch.js";
import { fixMojibake } from "./docs.js";
import { openDocView, beatDocViewAndNotify, recordOpen, recordClick, recordDownload, sweepStaleViews,
         PIXEL, docUrl, pixelUrl, clickUrl, fmtSeconds, topPages } from "./docs.js";
import { transcribeFile, transcriberAvailable } from "./transcribe.js";
import { createBot, leaveBot, parseTranscriptEvent, parseChatEvent, outputAudio, getRecordingUrl, getBot, recallConnectionInfo, getRecallUsage, getLastRecallCreate } from "./recall.js";
import { createSession, getSession, removeSession, listActiveSessions, setOnMeetingFinalized } from "./sessions.js";
import { scoreTranscript } from "./temperature.js";
import { buildChapters } from "./chapters.js";
import {
  initDb,
  schemaReport,
  getSchemaFailures,
  listRecentMeetingHeads,
  getTranscriptsByIds,
  listMeetings,
  setMeetingOwner,
  getMeeting,
  saveCustomAnalysis,
  saveSettings,
  saveAnalysis,
  getSettings,
  listGoogleConnectedOwners,
  listRepProducts,
  saveDeepAnalysis,
  updateMeetingMeta,
  setMeetingTitle,
  saveChapters,
  saveDriveFile,
  muxLiveUsage,
  listSalesforceOwners,
  listMeetingsWithoutTranscript,
  deleteMeeting,
  deleteEmptyMeetings,
  syncAccountActionItems,
  listActionItems,
  addActionItem,
  updateActionItem,
  deleteActionItem,
  listDealStatuses,
  setDealStatus,
  setDealManualProgress,
  updateDealCompanyName,
  updateDealEventFields,
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
  findSmartLinkByLabelStart,
  noticeOnce,
  listDevNotes,
  updateDevNote,
  deleteDevNote,
  dismissDevNote,
  listDismissed,
  addDevNote,
  futureApos,
  excludeApo,
  listCalendarWatches,
  countLiveRelay,
  saveCalendarWatch,
  deleteCalendarWatch,
  getCalendarWatch,
  listSmartLinks,
  setSmartLinkOwner,
  setSmartLinkInviteEvent,
  deleteSmartLink,
  setSmartLinkClient,
  setSmartLinkBusiness,
  setSmartLinkSourceNote,
  recentInvites,
  myAssignedApos,
  aposInRange,
  aposTakenInRange,
  aposMailPending,
  createJumpLink,
  getJumpLink,
  listJumpLinks,
  recordJumpView,
  listJumpViewers,
  createBookPage,
  getBookPage,
  listBookPages,
  recordBookView,
  markBooked,
  listBookViewers,
  createCallList,
  listCallTargets,
  removeMyCallTargets,
  assignCallTargets,
  deleteCallTargets,
  countCallTargets,
  deleteCallList,
  findListsByNameSince,
  findRecentListByNameOwner,
  redistributeListTargets,
  listTargetsNeedingSf,
  countTargetsNeedingSf,
  setCallTargetLead,
  renameCallList,
  callListFacets,
  callAssignCounts,
  clearCallAssign,
  getCallTarget,
  setCallTargetStatus,
  setCallTargetNextCall,
  updateCallTargetFields,
  addCallTargets,
  listCallLists,
  nextCallTarget,
  callHistory,
  recordCall,
  updateCallLog,
  markCallSynced,
  pendingCallLogs,
  callStats,
  callStatsRange,
  callStatsByDay,
  callAnalysis,
  callMemos,
  clearCallLogs,
  sfWrittenLogs,
  setNoReminder,
  fixApoForReminder,
  listApoMails,
  markBounced,
  logDeploy,
  deploysSince,
  recordSfUpdate,
  sfUpdatedMap,
  listWeekly,
  saveWeekly,
  weeklyFor,
  displayNameOf,
  assignCounts,
  assignCountsRaw,
  apoPeriodKeys,
  apoCountsBySetter,
  apoDetailBySetter,
  apoMissingStart,
  apoMissingApoAt,
  setSmartLinkSetterEmail,
  clearInviteEvent,
  linksWithInvite,
  setApoAt,
  setApoStartTime,
  listChatTargets,
  addChatTarget,
  updateChatTarget,
  deleteChatTarget,
  setApoExcluded,
  setApoExcludedMany,
  dedupeSmartLinksByEvent,
  saveAutolaunch,
  getAutolaunch,
  autolaunchForSlugs,
  autolaunchByCompanies,
  listAutolaunch,
  pendingAutolaunch,
  addDocFile,
  listDocFiles,
  setDocShared,
  getOrCreateSharedLink,
  setViewerInfo,
  listSharedViewers,
  getDocBytes,
  setDocActive,
  renameDocFile,
  deleteDocFile,
  addDocLinks,
  listDocLinks,
  docLinksForCompany,
  clientEmailForCompany,
  getDocLink,
  setViewerIdentity,
  checkPass,
  revokeDocLink,
  deleteDocLink,
  clearDocLinkHistory,
  docLinkDetail,
  addNextAction,
  listNextActions,
  setNextActionDone,
  deleteNextAction,
  NEXT_ACTION_KINDS,
  addUnanswered,
  listUnanswered,
  answerUnanswered,
  listBlocked,
  saveKasasagiReport,
  getKasasagiReport,
  knowledgeForKasasagi,
  activeInviteEventIds,
  logGmailAction,
  listClosers,
  markCloserAssigned,
  saveClosers,
  saveCloserOrder,
  saveBaselineCounts,
  listSuspensions,
  addSuspension,
  deleteSuspension,
  suspendedNow,
  listMembers,
  saveMembers,
  deleteMember,
  syncMembersToLegacy,
  memberCandidates,
  MEMBER_ROLES,
  MEMBER_BUSINESSES,
  markAutoAssigned,
  clearAutoAssigned,
  listAssignLog,
  clearCloserPriority,
  logAssign,
  listTeams,
  saveTeams,
  syncTeamsFromClosers,
  teamAssignStats,
  closerAssignStats,
  listGmailActions,
  apoMailSentRow,
  listApoMailStatus,
  deleteDealEventsByBot,
  insertDealEvent,
  upsertDealFeatureTags,
  listDealFeatureTags,
  listDealsNeedingFeatureTags,
  clearAllDealFeatureTags,
  fillIndustryFromProfiles,
  upsertEnterpriseAttributes,
  getEnterpriseAttributesMap,
  listCompaniesNeedingEnrichment,
  listDeals,
  getDealWithEvents,
  listDealEvents,
  getWinInsight,
  saveWinInsight,
  listUnjudgedMeetings,
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
  dbGetUser,
  getFollowup,
  saveFollowup,
  listOpenFollowups,
  addUsageEvents,
  usageSummary,
  usageLabels,
  listQaBank,
  qaBankBotIds,
  deleteQaBank,
  markQaGood,
  addQaPairs,
  listGoogleAccounts,
  dbUpdateUser,
  getUserSettings,
  saveUserSettings,
  saveMeeting,
  listAutoJoin,
  recentMeetingUrls,
  findAutoJoinByMeetingId,
  addAutoJoin,
  removeAutoJoin,
  setAutoJoinEnabled,
  setAutoJoinCalendarAny,
  touchAutoJoin,
  listAllAutoJoinEnabled,
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
  insertProposalFile,
  listProposalFiles,
  deleteProposalFile,
} from "./db.js";
import { resolveConfig, statusInfo } from "./config.js";
import { callLLMPublic, analyzerInfo, analyzeMeeting, analyzeDeep, freeAnalyze, chatWithData, enrichCompany, lookupEmployeeCount, lookupCompanyBasics, generateThanks, THANKS_PROMPT, getCheckItems, getSummaryPrompt, getCustomPrompt, runCustomAnalysis, analyzeWinPatterns, classifyMeetingKind, extractFirstMeeting, extractReMeeting, buildBrief, extractFeatureCTags, enrichCompanyAttributes, generateFeatureCInsights, extractQaPairs, splitPhases } from "./analyzer.js";
import { searchCompanies, getCompanyDetail, gbizConfigured } from "./gbizinfo.js";
import { searchCompanyInfo, webLookupAvailable } from "./websearch.js";
import { readLayout, readGoals, tally, buildUpdates, applyApoCounts, parseZeroDates, callHours, buildHoursUpdates, isoForMD, sameName as psSameName, METRICS } from "./processsheet.js";
import {
  googleConfigured,
  authUrl,
  exchangeCode,
  isConnected as gcalConnected,
  disconnect as gcalDisconnect,
  listZoomEvents,
  listDayEvents,
  listCalendarEvents,
  watchCalendarEvents,
  stopCalendarChannel,
  listEventsCreatedOn,
  createCalendarEvent,
  deleteCalendarEvent,
  getPrimaryEmail,
  driveReady,
  driveSearch,
  driveList,
  driveAccessToken,
  driveGetContent,
  gmailReady,
  gmailSearchThreads,
  gmailSentToday,
  gmailFindBounces,
  gmailGetThread,
  gmailSend,
  gmailArchiveThread,
  gmailUnarchiveThread,
  gmailTrashThread,
  gmailUntrashThread,
  gmailSetRead,
  gmailCreateDraft,
  gmailDeleteDraft,
  parseEmailAddr, driveEnsureFolder, driveUploadFromUrl, driveShareDomain, driveStream, driveFindCompanyFiles, driveShareAnyone, driveEnsurePath, driveMoveFile, driveListChildren, driveTrash,
  appendSheetRow, checkSheet, readSheet, updateSheetCells, diagnoseSheet,
  writeViaAppsScript, tokenScopes, getCalendarEvent } from "./google.js";
import { startScheduler } from "./scheduler.js";
import { muxConfigured, startVodUpload, waitVodPlayback, muxStorageSummary, listAssets, deleteAsset, findAssetByPlaybackId, enableMp4, mp4Url, readyMp4Name, getAsset } from "./mux.js";
import { liveConfigured, createLiveStream, disableLiveStream, playbackUrl as livePlaybackUrl, liveInfo, liveStatus, cfCustomerCodeCheck, cleanupOldLiveInputs, relayMap, relayDestFor } from "./live.js";
import { notionConfigured, notionStatus, createMeetingPage, createReportPage } from "./notion.js";
import { pdfToText, urlToText, officeToText } from "./ingest.js";
import { indexKnowledge, embeddingsAvailable, retrieve } from "./retrieval.js";
import { readDocument, readerAvailable, readWhiteboard } from "./ai_read.js";
import { mountMcpServer } from "./mcp.js";
import { mountGptActions } from "./gpt_actions.js";
import { mountOauthServer, oauthTokenUser } from "./oauth.js";
import {
  salesforceConfigured,
  getSfUserId,
  sfUserIdByEmail,
  leadRecordTypes,
  crossLeadRecordTypeId,
  describeObject,
  searchLeads,
  updateLead,
  convertLead,
  ensureLeadApoDate,
  ensureLeadCampaignSource,
  ensureLeadFsNote,
  ensureLeadVisitDate,
  createLead,
  convertedLeadStatus,
  convertedLeadStatuses,
  listReports,
  runReport,
  reportFilters,
  listDashboards,
  describeDashboard,
  exportLeads,
  authUrl as sfAuthUrl,
  createPkce as sfCreatePkce,
  exchangeCode as sfExchangeCode,
  isConnected as sfConnected,
  disconnect as sfDisconnect,
  connectionInfo as sfInfo,
  extractRecordId,
  getOpportunity,
  updateOpportunity,
  searchOpportunities,
  getStageValues,
  postChatter,
  describeOpportunity,
  describeOpportunityLayout,
  describeTask,
  leadActivities,
  taskResultField,
  createTask,
  updateTask,
  deleteTask,
  clearSfTokenCache,
  sfQuery,
  listAccountContacts,
  getOpportunityProducts,
  listOpportunityLineItems,
  updateOpportunityLineItem,
  deleteOpportunityLineItem,
  describeLineItem,
  addOpportunityLineItem,
  createContact,
  createContactRole,
  describeContactRolePicklist,
  fillEmptyFields,
  createTaskIdempotent, createOpportunity, firstOpportunityStage, snapshotLead, deleteRecord, isFreshlyCreated } from "./salesforce.js";
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
  hashPassword,
  verifyPassword,
  canImpersonate,
  setImpersonationCookies,
  endImpersonation,
  getImpersonator,
} from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 8787);
const RAILWAY_DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN;
const PUBLIC_URL = (
  process.env.PUBLIC_URL || (RAILWAY_DOMAIN ? `https://${RAILWAY_DOMAIN}` : "")
).replace(/\/$/, "");

// カレンダーからの自動入室のON/OFF。
// 既定はOFF（手動でのみボットを入れる）。再開したい場合は Railway の環境変数に
// CALENDAR_AUTO_JOIN=1 を追加してください。
const CALENDAR_AUTO_JOIN = String(process.env.CALENDAR_AUTO_JOIN || "") === "1";
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
// その人が「kincallだけ」の役割かどうか
const _kcOnly = new Map();
async function isKincallOnly(email) {
  const k = String(email || "").toLowerCase();
  if (!k) return false;
  const hit = _kcOnly.get(k);
  if (hit && Date.now() - hit.at < 30 * 1000) return hit.v;
  let v = false;
  try {
    const list = await listMembers();
    const m = (list || []).find((x) => String(x.email || "").toLowerCase() === k);
    v = !!(m && Array.isArray(m.roles) && m.roles.includes("kincall"));
  } catch {}
  _kcOnly.set(k, { at: Date.now(), v });
  return v;
}

// kincallの人が使ってよい道
function isKincallPath(p) {
  return p === "/kincall" || p === "/calls.html" || p === "/calls.js" ||
    p === "/kincall.svg" || p === "/style.css" || p === "/nav.js" || p === "/icon.svg" ||
    p === "/api/me" || p === "/api/logout" ||
    p.startsWith("/api/calls/") || p === "/api/calls" ||
    /\.(css|svg|png|ico|webmanifest)$/.test(p);
}

const OPEN_PATHS = new Set([
  "/api/recall/webhook", "/api/zoom/webhook", "/api/login", "/api/register", "/api/auth-info",
  // 会議に映すページとその中身（Recallのブラウザから認証なしで読む）
  "/api/kasasagi/face", "/kasasagi-face.html",
  // 送った資料のビューアー（受け取った人が開くので認証なし）
  "/doc.html",
  // 日程調整ページ（お客様が開くので認証なし）
  "/book.html",
  // Apps Scriptに貼るコード（画面から読むだけ）
  "/kinbot-sheet-writer.gs",
  "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource",
  "/oauth/register", "/oauth/authorize", "/oauth/token",
  // ChatGPTのCustom GPTが「URLからインポート」で取得する公開スキーマ（トークンは含まない）
  "/gpt-actions-openapi.yaml",
  // Googleカレンダーからの変更通知（Googleが直接叩くので認証なし。合言葉で本物か確かめる）
  "/api/google/calendar-push",
  // Railwayからのデプロイ通知（合言葉で本物か確かめる）
  "/api/railway/deploy-hook",
  // Google Chatからの呼びかけ（Googleが直接叩く。証明はJWTで確かめる）
  "/api/chat/command",
  // ライブ中継サーバーが「配信の宛先」を聞きに来る窓口。
  // 中継サーバーはログインできないので、ここは合言葉（RELAY_SECRET）だけで通す。
  "/api/live/relay-dest",
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
    // 値の前後に引用符が付いていても読めるようにする
    const strip = (v) => String(v || "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
    const token = strip(i === -1 ? s : s.slice(0, i));
    const owner = strip(i === -1 ? "" : s.slice(i + 1)) || "admin";
    if (token) map.set(token, owner);
  }
  return map;
})();
// トークンの前後に紛れ込みがちなものを落とす。
//   ・引用符（.env に KINBOT_TOKEN="kbt_..." と書くと値に " が入ることがある）
//   ・空白や改行（コピーのときに付いてしまう）
function tidyToken(v) {
  return String(v || "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
}

function bearerToken(req) {
  const h = req.headers.authorization || req.headers.Authorization || "";
  const raw = String(h).trim();
  // Bearer を付け忘れても通す（トークンだけ送るツールがあるため）
  const m = /^(?:Bearer|Token)\s+(.+)$/i.exec(raw);
  if (m) return tidyToken(m[1]);
  // ヘッダに何か入っていて、それが kbt_ で始まるならトークンとして扱う
  if (/^["'`]*kbt_/.test(raw)) return tidyToken(raw);
  // ヘッダを付けにくいツール向けに ?token= でも受ける
  if (req.query && req.query.token) return tidyToken(req.query.token);
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
  // お客様が開くページ（日程調整）は、ログインなしで通す
  if (/^\/b\/[A-Za-z0-9_-]+$/.test(req.path)) return next();
  // 転送URL（お客様が踏むので認証なし）
  if (/^\/g\/[A-Za-z0-9_-]+$/.test(req.path)) return next();
  if (/^\/api\/booking\/[A-Za-z0-9_-]+(\/book)?$/.test(req.path)) return next();
  // 送った資料まわりは、受け取った相手が認証なしで開く
  //   /d/xxx  … 資料のビューアー
  //   /px/xxx … 開封計測の画像
  //   /c/xxx  … リンクのクリック計測
  //   /api/doc/xxx … ビューアーが呼ぶ処理（資料の中身・進捗の記録）
  if (/^\/(d|px|c)\//.test(req.path) || req.path.startsWith("/api/doc/")) return next();
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
    // 代理ログイン中なら、元のアカウントを記録（監査ログや画面表示に使う）
    req.impersonatorFrom = getImpersonator(req);
    // 「kincallだけ」の人かどうか（インターン生など）
    req.kincallOnly = !u.admin && (await isKincallOnly(u.username).catch(() => false));
    // 代理ログイン中は、元のアカウントに戻る道を必ず開けておく
    const 戻る道 = req.path === "/api/impersonate/stop" || req.path === "/api/me";
    if (req.kincallOnly && !isKincallPath(req.path) && !戻る道) {
      if (req.path.startsWith("/api/")) return res.status(403).json({ error: "この操作はできません" });
      return res.redirect("/kincall");
    }
    return next();
  }
  if (req.path.startsWith("/api/") || req.path === "/mcp") {
    // なぜ通らなかったのかを添える（トークンそのものは出さない）。
    // 「ログインが必要です」だけだと、原因が分からず切り分けができないため。
    const raw = String(req.headers.authorization || "").trim();
    const got = bearerToken(req);
    let なぜ = "ログインしていません（Cookieもトークンもありません）";
    if (raw || (req.query && req.query.token)) {
      if (!got) {
        なぜ = raw
          ? "Authorizationヘッダの形が違います（Bearer のあとに半角スペース1つ＋トークン）"
          : "トークンを読み取れませんでした";
      } else if (!API_TOKENS.size) {
        なぜ = "kinbot側にトークンが1つも登録されていません（RailwayのAPI_TOKENS）";
      } else {
        なぜ = `トークンが一致しません（送られた長さ ${got.length}文字／` +
          `kinbot側に登録されているのは ${[...API_TOKENS.keys()].map((k) => k.length + "文字").join("・")}）`;
      }
    }
    return res.status(401).json({ error: "ログインが必要です", なぜ });
  }
  return res.redirect("/login.html");
});

// 画面のファイル（html/js/css）は、毎回新しいかどうかを確かめてもらう。
// これをしないと、直したのに古い画面が出たままになる。
app.use((req, res, next) => {
  if (/\.(js|css|html)$/i.test(req.path) || req.path === "/") {
    res.set("Cache-Control", "no-cache, must-revalidate");
  }
  next();
});

app.use(express.static(path.join(__dirname, "..", "public")));

// Webhook だけ raw body も保持（将来の署名検証用）
app.use(
  "/api/recall/webhook",
  express.json({ verify: (req, _res, buf) => (req.rawBody = buf) })
);
app.use(
  "/api/zoom/webhook",
  express.json({ verify: (req, _res, buf) => (req.rawBody = buf) })
);
// まとめて送る操作（重複予定の削除・URLの一括発行など）があるので、
// 既定の100kbだと足りずに「Payload Too Large」のHTMLが返ってしまう。
app.use(express.json({ limit: "5mb" }));
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
    sfErrorResponse(res, e);
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
    sfErrorResponse(res, e);
  }
});
app.post("/api/logout", (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});
// そのユーザーがクローザーか（リスト追加・確認・そうじの権限判定に使う）
async function isCloserUser(email) {
  try {
    const members = await listMembers().catch(() => []);
    return (members || []).some((m) =>
      Array.isArray(m.roles) && m.roles.includes("closer") &&
      String(m.email || "").toLowerCase() === String(email || "").toLowerCase());
  } catch { return false; }
}

app.get("/api/me", async (req, res) => {
  let name = "";
  try {
    const u = (await listUsers()).find((x) => (x.email || "").toLowerCase() === String(req.user || "").toLowerCase());
    name = (u && u.name) || "";
  } catch {}
  const impersonator = req.impersonatorFrom || null;
  let impersonatorName = "";
  if (impersonator) {
    try {
      const iu = (await listUsers()).find((x) => (x.email || "").toLowerCase() === String(impersonator).toLowerCase());
      impersonatorName = (iu && iu.name) || "";
    } catch {}
  }
  // クローザーかどうか（リストを追加できるのはクローザー・管理者だけにするため）
  let closer = false;
  try {
    const members = await listMembers().catch(() => []);
    closer = (members || []).some((m) =>
      Array.isArray(m.roles) && m.roles.includes("closer") &&
      String(m.email || "").toLowerCase() === String(req.user || "").toLowerCase());
  } catch {}
  res.json({
    username: req.user || null,
    name,
    admin: !!req.isAdmin,
    // 「kincallだけ」の人（インターン生など）
    kincallOnly: !!req.kincallOnly,
    // クローザー（リスト追加ができる）
    closer: closer || !!req.isAdmin,
    // 代理ログイン関連
    impersonating: !!impersonator,
    impersonator_email: impersonator,
    impersonator_name: impersonatorName,
    can_impersonate: canImpersonate(impersonator || req.user),
  });
});
// アカウント設定：表示名・パスワードの変更（本人のみ）
app.put("/api/me", async (req, res) => {
  try {
    const email = String(req.user || "").trim().toLowerCase();
    if (!email) return res.status(401).json({ error: "ログインが必要です" });
    const { name, current_password, new_password } = req.body || {};
    const u = await dbGetUser(email);
    if (!u) return res.status(400).json({ error: "この環境ではアカウント情報を変更できません（旧方式のログイン）" });

    const updates = {};
    if (name !== undefined && String(name).trim() !== (u.name || "")) {
      updates.name = String(name).trim().slice(0, 60);
    }
    if (new_password) {
      if (!current_password || !verifyPassword(current_password, u.pass_hash)) {
        return res.status(400).json({ error: "現在のパスワードが違います" });
      }
      if (String(new_password).length < 8) {
        return res.status(400).json({ error: "新しいパスワードは8文字以上にしてください" });
      }
      updates.passHash = hashPassword(new_password);
    }
    if (!Object.keys(updates).length) return res.json({ ok: true, changed: [] });
    await dbUpdateUser(email, updates);
    res.json({ ok: true, changed: Object.keys(updates) });
  } catch (e) {
    console.error("[account update]", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/auth-info", (req, res) => {
  res.json({ signupCodeRequired: !!(process.env.SIGNUP_CODE || "") });
});

// ===== 代理ログイン（なりすまし） =====
// 権限を持つのは田中欽也と中澤良太のみ（同じ権限）。他アカウントから呼んでも 403。

// 切り替え先の候補となるユーザー一覧
app.get("/api/impersonate/users", async (req, res) => {
  const origin = req.impersonatorFrom || req.user;
  if (!canImpersonate(origin)) return res.status(403).json({ error: "権限がありません" });
  try {
    const users = (await listUsers()).map((u) => ({ email: u.email, name: u.name || u.email }));
    res.json({ users });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 切り替え開始
app.post("/api/impersonate/start", async (req, res) => {
  // すでに代理ログイン中の場合は「元アカウント」を基準に権限判定する（田中→A→Bのような多段は禁止）
  const origin = req.impersonatorFrom || req.user;
  if (!canImpersonate(origin)) return res.status(403).json({ error: "権限がありません" });
  const target = String(req.body?.email || "").trim().toLowerCase();
  if (!target) return res.status(400).json({ error: "切り替え先のメールアドレスが必要です" });
  if (target === String(origin).toLowerCase()) return res.status(400).json({ error: "自分自身には切り替えできません" });
  try {
    const users = await listUsers();
    const u = users.find((x) => (x.email || "").toLowerCase() === target);
    if (!u) return res.status(404).json({ error: "対象ユーザーが見つかりません" });
    setImpersonationCookies(res, origin, target);
    console.log(`[impersonate] ${origin} → ${target} に切り替え`);
    res.json({ ok: true, target: { email: target, name: u.name || "" } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 元アカウントへ戻る
app.post("/api/impersonate/stop", (req, res) => {
  const origin = req.impersonatorFrom;
  if (!origin) return res.status(400).json({ error: "代理ログイン中ではありません" });
  endImpersonation(res, origin);
  console.log(`[impersonate] ${req.user} から ${origin} に戻る`);
  res.json({ ok: true });
});

// すべてのAPI操作を監査ログに残す（代理ログイン中のもの＝影響大の操作だけを対象にする）
app.use((req, res, next) => {
  if (req.impersonatorFrom && (req.method === "POST" || req.method === "PUT" || req.method === "DELETE") && req.path.startsWith("/api/")) {
    console.log(`[audit] IMP ${req.impersonatorFrom} as ${req.user} ${req.method} ${req.path}`);
  }
  next();
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
    sfErrorResponse(res, e);
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
    sfErrorResponse(res, e);
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
    sfErrorResponse(res, e);
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
    sfErrorResponse(res, e);
  }
});

// ===== 案件ステータス =====
app.get("/api/deal-status", async (req, res) => {
  try {
    res.json({ statuses: await listDealStatuses() });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});
// ステータス変更を許可するアカウント（メールアドレスで完全一致判定）。
// これ以外のユーザーは、案件は見られるが、ステータスの変更（プルダウン）は操作できない。
const STATUS_APPROVER_EMAILS = new Set([
  "ryota.nakazawa@neo-career.co.jp",
  "takaya.urabayashi@neo-career.co.jp",
]);
function isStatusApprover(email) {
  return STATUS_APPROVER_EMAILS.has(String(email || "").trim().toLowerCase());
}

app.put("/api/deal-status", async (req, res) => {
  try {
    const { account, status, auto } = req.body || {};
    if (!account) return res.status(400).json({ error: "account が必要です" });
    // ステータス変更は、承認アカウント（中澤・浦林）だけが可能。
    // 代理ログイン中は、元アカウント（田中さん）が代理ログイン権限を持っているので変更可。
    const approver = isStatusApprover(req.impersonatorFrom || req.user);
    if (!approver && !canImpersonate(req.impersonatorFrom)) {
      return res.status(403).json({ error: "案件のステータス変更は、中澤さん・浦林さんのみ可能です。判定内容を確認のうえ、いずれかの担当に依頼してください。" });
    }
    if (auto) {
      // AIに任せる：手動フラグを解除
      await setDealStatus(account, { manual: false });
    } else {
      await setDealStatus(account, { status, manual: true });
      // 案件の deals.status カラムにも反映する（実績集計はこちらを見るため、同期しないと不整合が起きる）。
      // 会社名（account）→ deal_id を引いてから更新する。
      try {
        const key = normCompanyKey(account);
        const deals = await listDeals({});
        const d = (deals || []).find((x) => normCompanyKey(x.company_name) === key);
        if (d && d.deal_id) {
          await updateDealStatus(d.deal_id, status, null);
        }
      } catch (e) {
        console.warn("[deal-status] deals.status 同期に失敗", e.message);
      }
    }
    res.json({ ok: true });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// ステッパー上のクリックで進捗を保存（AI判定とは独立した「手動進捗」フィールド）。
// 対象案件は deal_id で指定。stage: 1〜5 または null（null で解除＝AI判定に戻す）。
// 承認アカウント（中澤・浦林）だけが変更可能。田中さんは代理ログイン中のみ変更可（ステータスと同じ扱い）。
app.put("/api/deals/:deal_id/manual-progress", async (req, res) => {
  try {
    const dealId = req.params.deal_id;
    const stageRaw = req.body?.stage;
    const stage = stageRaw == null ? null : Number(stageRaw);
    if (stage !== null && (!Number.isInteger(stage) || stage < 1 || stage > 5)) {
      return res.status(400).json({ error: "stage は 1〜5 の整数、または null（解除）にしてください" });
    }
    const approver = isStatusApprover(req.impersonatorFrom || req.user);
    if (!approver && !canImpersonate(req.impersonatorFrom)) {
      return res.status(403).json({ error: "進捗の変更は、中澤さん・浦林さんのみ可能です。" });
    }
    // 更新した人の記録（代理ログイン中は「元アカウント as 代理先」で残す）
    const updatedBy = req.impersonatorFrom
      ? `${req.impersonatorFrom} (as ${req.user})`
      : String(req.user || "");
    await setDealManualProgress(dealId, stage, updatedBy);
    // ステッパーで進めたステージに応じて、案件全体のステータスも自動で連動させる。
    //  stage=4 → 「再商談実施済み」（案件が再商談に到達したとみなす）
    //  stage=5 → 「受注」
    //  stage=1〜3 → 「進行中」（AI由来の失注・要確認から人が「まだ進行中」と判断した場合）
    //  stage=null（解除）→ ステータスは何もしない（AI判定の派生に戻る）
    let newStatus = null;
    if (stage === 5) newStatus = "受注";
    else if (stage === 4) newStatus = "再商談実施済み";
    else if (stage != null && stage <= 3) newStatus = "進行中";
    if (newStatus) await updateDealStatus(dealId, newStatus, null);
    res.json({ ok: true, stage, status: newStatus, updated_by: updatedBy });
  } catch (e) {
    console.error("[manual-progress]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 手動ステータス（deal_status テーブル）と、実績集計に使う deals.status カラムの不整合を修復する。
// 過去に「右上プルダウンでステータス変更 → deal_status だけ更新される（deals.status は取り残し）」
// という状態になっていた案件があるため、これを一括で同期する。承認アカウントのみ実行可能。
app.post("/api/deals/sync-status", async (req, res) => {
  try {
    const approver = isStatusApprover(req.impersonatorFrom || req.user);
    if (!approver && !canImpersonate(req.impersonatorFrom)) {
      return res.status(403).json({ error: "この操作は、中澤さん・浦林さんのみ実行できます。" });
    }
    const deals = await listDeals({});
    const dealStatusMap = await listDealStatuses(); // { account: { status, manual } }
    let updated = 0;
    const changes = [];
    for (const d of deals || []) {
      // 手動設定のステータスを持っている案件だけ対象（AI由来のステータスは触らない）
      const ds = dealStatusMap[d.company_name];
      if (!ds || !ds.manual || !ds.status) continue;
      if (ds.status === d.status) continue; // 一致していれば何もしない
      await updateDealStatus(d.deal_id, ds.status, null);
      updated++;
      if (changes.length < 20) changes.push({ deal_id: d.deal_id, company: d.company_name, before: d.status, after: ds.status });
    }
    const updatedBy = req.impersonatorFrom ? `${req.impersonatorFrom} (as ${req.user})` : String(req.user || "");
    console.log(`[sync-status] by ${updatedBy}: ${updated}件を同期`);
    res.json({ ok: true, total: deals.length, updated, sample: changes });
  } catch (e) {
    console.error("[sync-status]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 既存の案件名を、強化された会社名抽出ロジックで一括で書き直すバックフィル。
// 承認アカウントのみ実行可能。冪等（同じ結果を返す）。
app.post("/api/deals/backfill-names", async (req, res) => {
  try {
    const approver = isStatusApprover(req.impersonatorFrom || req.user);
    if (!approver && !canImpersonate(req.impersonatorFrom)) {
      return res.status(403).json({ error: "この操作は、中澤さん・浦林さんのみ実行できます。" });
    }
    const deals = await listDeals({});
    let updated = 0;
    const changes = [];
    for (const d of deals || []) {
      const currentName = d.company_name || "";
      const cleanedName = companyFromTitle(currentName);
      if (cleanedName && cleanedName !== currentName && cleanedName !== "(無題)") {
        await updateDealCompanyName(d.deal_id, cleanedName);
        updated++;
        if (changes.length < 20) changes.push({ deal_id: d.deal_id, before: currentName, after: cleanedName });
      }
    }
    console.log(`[backfill-names] ${updated}件の案件名を書き換えました`);
    res.json({ ok: true, total: deals.length, updated, sample: changes });
  } catch (e) {
    console.error("[backfill-names]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// AI判定がまだ無い案件に、空の「初回商談」イベントを1件作る。
// 詳細行を手動で埋めたいが AI が判定していない場合の準備用（承認アカウントのみ）。
// 既に初回商談イベントがある場合は、そのイベントIDを返して何もしない（冪等）。
app.post("/api/deals/:deal_id/first-event", async (req, res) => {
  try {
    const dealId = req.params.deal_id;
    if (!dealId) return res.status(400).json({ error: "deal_id が必要です" });
    const approver = isStatusApprover(req.impersonatorFrom || req.user);
    if (!approver && !canImpersonate(req.impersonatorFrom)) {
      return res.status(403).json({ error: "この操作は、中澤さん・浦林さんのみ可能です。" });
    }
    // 既存の初回商談を確認（同一 deal_id に既にあれば、そのIDを返す）
    const events = await listDealEvents({});
    const existing = events
      .filter((e) => e.deal_id === dealId && e.event_type === "初回商談" && e.meeting_kind === "初回商談")
      .sort((a, b) => new Date(b.event_date || 0) - new Date(a.event_date || 0))[0];
    if (existing) return res.json({ ok: true, event_id: existing.id, existing: true });

    // 案件情報から event_date を決める（first_meeting_date が無ければ今日）
    const deals = await listDeals({});
    const deal = (deals || []).find((d) => d.deal_id === dealId);
    const eventDate = (deal && deal.first_meeting_date) || new Date().toISOString().slice(0, 10);
    const updatedBy = req.impersonatorFrom ? `${req.impersonatorFrom} (as ${req.user})` : String(req.user || "");
    // 空のイベントを作成（手動で作ったことを raw_extraction に記録）
    const inserted = await insertDealEvent({
      deal_id: dealId,
      bot_id: null, // 商談ボットに紐付かない手動作成
      event_date: eventDate,
      event_type: "初回商談",
      meeting_kind: "初回商談",
      confidence: "manual",
      judgment_basis: "手動で作成（AI判定なし）",
      needs_review: false,
      raw_extraction: { manual_created: { by: updatedBy, at: new Date().toISOString() } },
    });
    if (!inserted) return res.status(500).json({ error: "イベントの作成に失敗しました" });
    console.log(`[first-event] manual create by ${updatedBy}: deal=${dealId} event=${inserted.id}`);
    res.json({ ok: true, event_id: inserted.id, existing: false });
  } catch (e) {
    console.error("[first-event]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 判定の詳細（初回商談イベント）を手動で修正する。
// 対象: schedule_choice / apply_timing の2項目。judgment_month はサーバー側で自動再計算する。
// 承認アカウント（中澤・浦林）だけが変更可能。
app.put("/api/deal-events/:event_id/manual-fields", async (req, res) => {
  try {
    const eventId = Number(req.params.event_id);
    if (!Number.isInteger(eventId) || eventId <= 0) return res.status(400).json({ error: "event_id が不正です" });
    const approver = isStatusApprover(req.impersonatorFrom || req.user);
    if (!approver && !canImpersonate(req.impersonatorFrom)) {
      return res.status(403).json({ error: "判定内容の変更は、中澤さん・浦林さんのみ可能です。" });
    }
    const body = req.body || {};
    const SCHEDULE_VALUES = ["今月", "来月", "再来月", "それ以降", "未定", "不明"];
    const APPLY_VALUES = ["今月", "来月", "該当なし", "不明"];
    const fields = {};
    if (body.schedule_choice !== undefined) {
      const v = String(body.schedule_choice || "").trim();
      if (v && !SCHEDULE_VALUES.includes(v)) return res.status(400).json({ error: "ご利用開始スケジュールの値が不正です" });
      fields.schedule_choice = v || null;
    }
    if (body.apply_timing !== undefined) {
      const v = String(body.apply_timing || "").trim();
      if (v && !APPLY_VALUES.includes(v)) return res.status(400).json({ error: "今月中の申込可否の値が不正です" });
      fields.apply_timing = v || null;
    }
    // 次回商談（再商談）の予定日と「設定済み」フラグの編集
    if (body.next_meeting_date !== undefined) {
      const v = String(body.next_meeting_date || "").trim();
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return res.status(400).json({ error: "次回商談日は YYYY-MM-DD 形式で指定してください" });
      fields.next_meeting_date = v || null;
      // 日付が入ったら自動で「設定済み」にする（無い場合は明示指定がなければ触らない）
      if (v) fields.next_meeting_scheduled = true;
    }
    if (body.next_meeting_scheduled !== undefined) {
      const b = !!body.next_meeting_scheduled;
      fields.next_meeting_scheduled = b;
      // 未設定に戻すときは日付も消す（明示的にnext_meeting_dateが指定されていなければ）
      if (!b && body.next_meeting_date === undefined) fields.next_meeting_date = null;
    }
    if (!Object.keys(fields).length) return res.status(400).json({ error: "更新する項目がありません" });

    // 現在のイベントを取り、変更後の値で judgment_month を再計算する
    const rows = await listDealEvents({}); // 全件からIDで拾う
    const ev = rows.find((e) => Number(e.id) === eventId);
    if (!ev) return res.status(404).json({ error: "対象のイベントが見つかりません" });
    if (ev.event_type !== "初回商談" || ev.meeting_kind !== "初回商談") {
      return res.status(400).json({ error: "この編集は初回商談イベントにのみ有効です" });
    }
    const meetingDateStr = ev.event_date ? String(ev.event_date).slice(0, 10) : new Date().toISOString().slice(0, 10);
    const meetingMonth = meetingDateStr.slice(0, 7);
    const mergedExt = {
      schedule_choice: fields.schedule_choice !== undefined ? fields.schedule_choice : ev.schedule_choice,
      apply_timing: fields.apply_timing !== undefined ? fields.apply_timing : ev.apply_timing,
      next_meeting_scheduled: fields.next_meeting_scheduled !== undefined ? fields.next_meeting_scheduled : ev.next_meeting_scheduled,
      next_meeting_date: fields.next_meeting_date !== undefined ? fields.next_meeting_date : ev.next_meeting_date,
      confidence: ev.confidence,
    };
    const der = deriveFirstMeeting(mergedExt, meetingMonth, meetingDateStr);
    fields.judgment_month = der.judgment_month;
    // 手動編集の記録を raw_extraction に残す（誰が・いつ・何を）
    const updatedBy = req.impersonatorFrom ? `${req.impersonatorFrom} (as ${req.user})` : String(req.user || "");
    fields.raw_extraction = {
      manual_edit: {
        by: updatedBy,
        at: new Date().toISOString(),
        fields: {
          schedule_choice: fields.schedule_choice,
          apply_timing: fields.apply_timing,
        },
      },
      judgment_month_basis: der.judgment_month_basis || "（手動編集で再計算）",
    };
    await updateDealEventFields(eventId, fields);
    // 案件のステータスも派生値で更新（要確認→進行中になるケースがあるため）。
    // ※ここでの案件ステータス更新は承認アカウントの操作なので明示的に許可する。
    if (ev.deal_id && !ev.needs_review) {
      await updateDealStatus(ev.deal_id, der.status, der.auto_lose_deadline);
    }
    res.json({ ok: true, judgment_month: der.judgment_month, judgment_month_basis: der.judgment_month_basis, status: der.status });
  } catch (e) {
    console.error("[manual-fields]", e.message);
    res.status(500).json({ error: e.message });
  }
});
app.get("/api/action-items", async (req, res) => {
  try {
    const account = String(req.query.account || "").trim();
    if (!account) return res.json({ items: [] });
    await syncAccountActionItems(account); // AI抽出の宿題を取り込み（冪等）
    res.json({ items: await listActionItems(account) });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});
app.post("/api/action-items", async (req, res) => {
  try {
    const { account, text, due, botId } = req.body || {};
    if (!account || !text) return res.status(400).json({ error: "account と text が必要です" });
    const id = await addActionItem({ account, text, due, botId, owner: req.user || "", source: "manual" });
    res.json({ ok: true, id });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});
app.put("/api/action-items/:id", async (req, res) => {
  try {
    const { done, text, due } = req.body || {};
    await updateActionItem(Number(req.params.id), { done, text, due });
    res.json({ ok: true });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});
app.delete("/api/action-items/:id", async (req, res) => {
  try {
    await deleteActionItem(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    sfErrorResponse(res, e);
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
    // 要約が無い商談は、文字起こしを取り寄せてチャットで読めるようにする（最大8件）
    let fetched = 0;
    for (const m of rows.slice(0, 25)) {
      const s = m.summary || {};
      const hasSum = s.overview || (s.key_points || []).length || (s.action_items || []).length || (s.customer_concerns || []).length;
      if (!hasSum && fetched < 8) {
        try {
          const full = await getMeeting(m.bot_id);
          const tr = Array.isArray(full && full.transcript)
            ? full.transcript.map((u) => `${(u.speaker && u.speaker.name) || "話者"}: ${u.text || ""}`).join("\n")
            : (typeof (full && full.transcript) === "string" ? full.transcript : "");
          if (tr && tr.trim()) { m.transcriptText = tr; fetched++; }
        } catch {}
      }
    }
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

// 再商談で「今月中の申込＋来月・再来月の利用開始」という明確な合意が取れているかを判定する。
// 取れていれば、確信度が低くても「再商談実施済み」として確定させる（要確認にしない）。
function hasClearTimingAgreement(ext, meetingMonth) {
  const monthOf = (v) => {
    const m = String(v || "").match(/(\d{4})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}` : "";
  };
  const addMonths = (ym, n) => {
    const [y, mo] = ym.split("-").map(Number);
    if (!y || !mo) return "";
    const d = new Date(Date.UTC(y, mo - 1 + n, 1));
    return d.toISOString().slice(0, 7);
  };
  const applyM = monthOf(ext.apply_date);
  const useM = monthOf(ext.usage_start_date);
  const applyTxt = String(ext.apply_date || "") + " " + String(ext.judgment_basis || "");
  const useTxt = String(ext.usage_start_date || "") + " " + String(ext.judgment_basis || "");
  const applyThisMonth = applyM ? applyM === meetingMonth : /今月/.test(applyTxt);
  const useNextMonths = useM
    ? (useM === addMonths(meetingMonth, 1) || useM === addMonths(meetingMonth, 2))
    : /来月|再来月/.test(useTxt);
  return applyThisMonth && useNextMonths;
}

// 1商談を抽出してイベントログに保存する（finalize / アップロード / 手動 / バックフィルから呼ぶ）
async function runExtraction(botId, forceProvider) {
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

  // 種別判定：商談名に回数が明示されていればそれを正とする（【新/ヒ】【初回/…】=初回、【2回目/】【再商談】=再商談）。
  // 商談名から判断できないときだけAIに文字起こしを読ませて分類する。
  const titleRound = roundFromTitle(m.title);           // 1 / n / null
  const titleSaysRe = /【[^】]*(再商談|再提案)[^】]*】/.test(String(m.title || "").normalize("NFKC"));
  let kind;
  let kindRes = null; // AIに判定させたときの結果（判定不能のときに理由を残すため）
  if (titleRound === 1) {
    kind = "初回商談";
  } else if ((titleRound && titleRound >= 2) || titleSaysRe) {
    kind = "再商談";
  } else {
    kindRes = await classifyMeetingKind(transcript, { provider: forceProvider });
    kind = kindRes && kindRes.meeting_kind;
  }

  // 既存の同一商談イベントを消してから入れ直す（再抽出の重複防止）
  await deleteDealEventsByBot(botId);

  // 会社名で案件を解決（無ければ新規作成）
  const deal = companyName ? await resolveDeal({ companyName, owner, team, firstMeetingDate: meetingDateStr }) : null;

  if (kind === "判定不能") {
    await insertDealEvent({
      deal_id: deal && deal.deal_id, bot_id: botId, event_date: meetingDateStr,
      event_type: "初回商談", meeting_kind: "判定不能",
      confidence: (kindRes && kindRes.confidence) || null, needs_review: true,
      judgment_basis: "商談種別を判定できませんでした",
      raw_extraction: { kind: kindRes || null },
    });
    return { kind, needs_review: true };
  }

  if (kind === "初回商談") {
    const ext = await extractFirstMeeting(transcript, meetingDateStr, { provider: forceProvider });
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
      else {
        // 要確認のときは判定を確定させないが、過去の誤判定で残った「再商談実施済み」等が
        // そのまま表示され続けるのは誤り。再商談イベントが1件も無い案件なら、その状態を解除する。
        const RE_DERIVED = ["再商談実施済み", "受注", "失注(その後失注)"];
        if (RE_DERIVED.includes(deal.status)) {
          const full = await getDealWithEvents(deal.deal_id).catch(() => null);
          const stillHasRe = full && (full.events || []).some((e) => e.event_type === "再商談実施");
          if (!stillHasRe) {
            await updateDealStatus(deal.deal_id, "要確認", null);
            console.log(`[extract] 古い「${deal.status}」を解除（再商談イベント無し）: ${deal.deal_id}`);
          }
        }
      }
    }

    // Feature C: 商談特徴タグを抽出して保存する。
    // Feature Aの完了パスを止めないため、失敗しても案件更新に影響しないよう非同期＋try-catchで隔離。
    if (deal) {
      (async () => {
        try {
          const tags = await extractFeatureCTags(transcript, meetingDateStr);
          const dealStatus = (await listDeals({})).find((d) => d.deal_id === deal.deal_id)?.status || "";
          let responseStatus = tags.customer_response_status;
          if (dealStatus.startsWith("失注")) responseStatus = "失注";
          await upsertDealFeatureTags(deal.deal_id, {
            first_meeting_date: meetingDateStr, owner: repName || owner, team,
            ...tags, customer_response_status: responseStatus,
            customer_industry: tags.customer_industry, target_job_type: null,
            result: dealStatus.startsWith("失注") ? "失注" : (dealStatus === "受注" ? "受注" : "進行中"),
            raw_extraction: tags.raw_llm,
          });
          console.log(`[feature-c] tags saved for deal ${deal.deal_id} (confidence=${tags.tag_confidence})`);
        } catch (e) {
          console.error(`[feature-c] tag extraction failed for deal ${deal.deal_id}:`, e.message);
        }
      })();
    }
    return { kind, ...der };
  }

  // 再商談
  const ext = await extractReMeeting(transcript, meetingDateStr, { provider: forceProvider });
  let needs_review = ext.confidence === "low";
  // ルール：今月中の申込＋来月・再来月の利用開始について明確な合意があり、2回目商談（再商談）が
  // 実施されている場合は、確信度に関わらず「再商談実施済み」として確定する。
  const clearAgree = ext.result !== "失注" && hasClearTimingAgreement(ext, meetingMonth);
  if (clearAgree) needs_review = false;
  let status = "再商談実施済み";
  if (ext.result === "受注") status = "受注";
  else if (ext.result === "失注") status = "失注(その後失注)";
  await insertDealEvent({
    deal_id: deal && deal.deal_id, bot_id: botId, event_date: meetingDateStr,
    event_type: "再商談実施", meeting_kind: "再商談",
    result: ext.result, reported_date: ext.reported_date, apply_date: ext.apply_date,
    usage_start_date: ext.usage_start_date, confidence: ext.confidence,
    judgment_basis: ext.judgment_basis, needs_review, raw_extraction: { ...ext, clear_timing_agreement: clearAgree },
  });
  if (deal && !needs_review) await updateDealStatus(deal.deal_id, status, null);
  return { kind, result: ext.result, needs_review };
}

// 投げっぱなし実行（finalizeをブロックしない）
function runExtractionSafe(botId) {
  Promise.resolve()
    .then(() => runExtraction(botId)) // 判定は既定プロバイダ（Gemini）を使う。Claudeを使う場合は判定画面のモデル選択で切り替え
    .catch((e) => console.warn("[extract] スキップ", botId, e.message));
}
// 保存先フォルダ：（基準フォルダ）/ 担当者名 / 8月 / 5日
async function driveFolderForMeeting(owner, m) {
  const root = await driveEnsureFolder(owner, process.env.DRIVE_FOLDER_NAME || "kinbot 商談録画");
  const d = new Date(m.created_at || Date.now());
  const jst = new Date(d.getTime() + 9 * 3600 * 1000);
  const rep = String(m.rep_name || m.owner_name || m.owner || "担当者未設定").trim() || "担当者未設定";
  return await driveEnsurePath(owner, [rep, `${jst.getUTCMonth() + 1}月`, `${jst.getUTCDate()}日`], root);
}

// 商談が終わったら、録画をGoogleドライブへ保存し、Muxに残った録画を消す。
// 既定で動きます（止めたいときは DRIVE_AUTO_ARCHIVE=0）。
async function archiveRecordingSafe(botId) {
  if (process.env.DRIVE_AUTO_ARCHIVE === "0") return;
  try {
    // 録画が用意できるまで待つ。
    // 商談が終わってすぐは、Recall側の書き出しが終わっていないことがある。
    // 最初は数秒おきに見に行き、だんだん間隔を延ばす（できたらすぐ保存できるように）。
    const waits = [0, 5, 10, 20, 30, 60, 60, 120, 120, 180, 300, 300];
    for (let i = 0; i < waits.length; i++) {
      if (waits[i]) await new Promise((r) => setTimeout(r, waits[i] * 1000));
      const m = await getMeeting(botId);
      if (!m) return;
      if (m.drive_file_id) return;
      let url = null;
      try { url = await getRecordingUrl(botId); } catch {}
      if (url) {
        // 担当者の権限で保存する。権限が無ければ、指定した保存用アカウントで保存する。
        const owners = [m.owner, process.env.DRIVE_ARCHIVE_OWNER].filter(Boolean);
        if (!owners.length) return;
        let owner = owners[0], folderId = null, lastErr = null;
        for (const cand of owners) {
          try {
            folderId = await driveFolderForMeeting(cand, m);
            owner = cand;
            break;
          } catch (e) { lastErr = e; }
        }
        if (!folderId) throw lastErr || new Error("保存先フォルダを用意できませんでした");
        const when = new Date(m.created_at || Date.now()).toISOString().slice(0, 10);
        const safe = String(m.title || "商談").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
        const up = await driveUploadFromUrl(owner, { url, name: `${when}_${safe}.mp4`, folderId });
        const domain = process.env.DRIVE_SHARE_DOMAIN || "";
        if (domain) await driveShareDomain(owner, up.fileId, domain);
        await saveDriveFile(botId, { fileId: up.fileId, link: up.link });
        console.log(`[ドライブ保存] ${botId} → ${up.link}`);

        // Muxに残っている同じ商談の録画は不要なので消す（保存料を止める）
        if (m.mux_playback_id && muxConfigured() && process.env.MUX_KEEP_ASSETS !== "1") {
          try {
            const assets = await listAssets({ limit: 100, page: 1 });
            const hit = (assets || []).find((a) => (a.playback_ids || []).some((p) => p.id === m.mux_playback_id));
            if (hit) { await deleteAsset(hit.id); console.log(`[Mux削除] ${hit.id}`); }
          } catch (e) { console.warn("[Mux削除] スキップ", e.message); }
        }
        return;
      }
    }
    console.warn(`[ドライブ保存] ${botId} は録画がまだ用意できません（あとで自動的に拾い直します）`);
  } catch (e) {
    const msg = String(e.message || "");
    if (/insufficient|scope|403/i.test(msg)) {
      console.error("[ドライブ保存] 権限が足りません。設定→外部連携でGoogleを連携し直してください（書き込み権限が必要です）。", msg);
    } else if (/連携されていません/.test(msg)) {
      console.warn("[ドライブ保存] Google未連携のため保存できません:", botId);
    } else {
      console.error("[ドライブ保存]", msg);
    }
  }
}

// 直近の商談が、ドライブに保存できているかを確認する
// 会社名から、社内にある提案資料を探す（自分が見られるものだけ）
app.get("/api/drive/company-files", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const company = String(req.query.company || "").trim();
    if (!company) return res.json({ files: [] });
    const files = await driveFindCompanyFiles(req.user, company, Number(req.query.limit) || 12);
    res.json({ files });
  } catch (e) {
    const msg = String(e.message || "");
    res.status(200).json({
      files: [],
      error: /未連携/.test(msg) ? "Googleが連携されていません" : msg.slice(0, 160),
    });
  }
});

app.get("/api/drive/archive-status", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const days = Math.max(1, Math.min(90, Number(req.query.days) || 14));
    const jst = new Date(Date.now() + 9 * 3600 * 1000);
    const from = new Date(jst.getTime() - days * 86400000).toISOString().slice(0, 10);
    const rows = await listMeetings({ isAdmin: true, from, limit: 500 });
    const saved = rows.filter((m) => m.drive_file_id);
    res.json({
      days,
      meetings: rows.length,
      savedToDrive: saved.length,
      notSaved: rows.length - saved.length,
      auto: process.env.DRIVE_AUTO_ARCHIVE !== "0",
      recent: rows.slice(0, 20).map((m) => ({
        title: m.title, date: String(m.created_at).slice(0, 10),
        owner: m.owner_name || m.owner, drive: !!m.drive_file_id,
      })),
      hint: "driveがfalseばかりの場合は、設定→外部連携でGoogleを連携し直してください（録画の保存には書き込み権限が必要です）。",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 録音ボット経由の商談確定後にも抽出を走らせる（sessions.js から呼ばれる）
setOnMeetingFinalized((botId) => {
  runExtractionSafe(botId);
  archiveRecordingSafe(botId);
});

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




// Salesforceのトークンを切らさないように、定期的に使っておく。
// 接続アプリの設定が「一定期間使わないと失効」の場合、これで失効を防げます。
setInterval(async () => {
  try {
    const owners = await listSalesforceOwners();
    for (const owner of owners) {
      try {
        await sfQuery(owner, "SELECT Id FROM Opportunity LIMIT 1");
      } catch (e) {
        const msg = String(e.message || "");
        if (/invalid_grant|expired/i.test(msg)) {
          console.warn(`[SF維持] ${owner} のトークンが失効しています。設定から再連携が必要です。`);
        }
      }
    }
  } catch (e) {
    console.error("[SF維持]", e.message);
  }
}, 20 * 60 * 60 * 1000); // 20時間ごと（更新の回数を増やしすぎないため）

// 取りこぼしを拾う見回り：ドライブに入っていない録画を、あとからでも保存する。
// 商談終了時の保存が失敗しても、これで自動的に追いつきます。
let _sweeping = false;
setInterval(async () => {
  if (_sweeping || process.env.DRIVE_AUTO_ARCHIVE === "0") return;
  _sweeping = true;
  try {
    const days = Math.max(1, Math.min(30, Number(process.env.DRIVE_SWEEP_DAYS || 7)));
    const jst = new Date(Date.now() + 9 * 3600 * 1000);
    const from = new Date(jst.getTime() - days * 86400000).toISOString().slice(0, 10);
    const rows = await listMeetings({ isAdmin: true, from, limit: 500 });
    const todo = rows.filter((m) => !m.drive_file_id).slice(0, 5);
    for (const t of todo) {
      // 始まったばかりの商談（まだ録画中）は飛ばす
      if (Date.now() - new Date(t.created_at).getTime() < 3 * 60 * 1000) continue;
      await archiveRecordingSafe(t.bot_id);
    }
  } catch (e) {
    console.error("[ドライブ見回り]", e.message);
  } finally {
    _sweeping = false;
  }
}, 5 * 60 * 1000); // 5分ごと（保存もれをすぐ拾うため）

// 長時間つけっぱなしのBotを見張って、自動で退出させる（課金の暴走を防ぐ）
const BOT_MAX_HOURS = Math.max(1, Math.min(12, Number(process.env.BOT_MAX_HOURS || 4)));
setInterval(async () => {
  try {
    const now = Date.now();
    for (const a of listActiveSessions()) {
      const hours = (now - (a.startedAt || now)) / 3600000;
      if (hours < BOT_MAX_HOURS) continue;
      console.warn(`[見張り] ${a.botId}（${a.title}）が${hours.toFixed(1)}時間続いているため退出させます`);
      try { await leaveBot(a.botId); } catch (e) { console.error("[見張り] 退出失敗", e.message); }
      try { removeSession(a.botId); } catch {}
    }
  } catch (e) {
    console.error("[見張り]", e.message);
  }
}, 10 * 60 * 1000);

// 一覧に出てこない商談（文字起こしが空）を調べる
app.get("/api/meetings/hidden", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const days = Math.max(1, Math.min(365, Number(req.query.days) || 90));
    const rows = await listMeetingsWithoutTranscript({ days, limit: 200 });
    res.json({
      days,
      count: rows.length,
      items: rows.map((m) => ({
        botId: m.bot_id,
        title: m.title,
        date: String(m.created_at).slice(0, 10),
        rep: m.rep_name || m.owner,
        drive: !!m.drive_file_id,
        driveLink: m.drive_link || "",
      })),
      note: "文字起こしが空のため商談履歴に出ていません。ドライブに録画があるものは、文字起こしをやり直せます。",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ドライブの録画から、文字起こしと分析をやり直す（消えた商談の復元）
app.post("/api/meetings/:id/retranscribe", async (req, res) => {
  const tmp = `/tmp/kb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`;
  try {
    const m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "見つかりません" });
    if (!m.drive_file_id) return res.status(400).json({ error: "ドライブに録画がありません" });
    if (!transcriberAvailable()) return res.status(400).json({ error: "文字起こし用のAPIキーが未設定です" });

    // ドライブから一時ファイルに落とす
    const up = await driveStream(req.user || m.owner, m.drive_file_id, null);
    if (!up.ok || !up.body) return res.status(502).json({ error: "録画を取り出せませんでした" });
    const fsp = await import("node:fs");
    await new Promise((resolve, reject) => {
      const ws = fsp.createWriteStream(tmp);
      const reader = up.body.getReader();
      const pump = () => reader.read().then(({ done, value }) => {
        if (done) { ws.end(); return; }
        ws.write(Buffer.from(value)) ? pump() : ws.once("drain", pump);
      }).catch(reject);
      ws.on("finish", resolve);
      ws.on("error", reject);
      pump();
    });

    const utterances = await transcribeFile(tmp, "video/mp4");
    if (!Array.isArray(utterances) || !utterances.length) {
      return res.status(502).json({ error: "文字起こしできませんでした（音声が入っていない可能性があります）" });
    }
    await saveMeeting(req.params.id, { transcript: utterances });

    // 要約・分析もやり直す
    const text = utterances.map((u) => `${u.speaker?.name || ""}: ${u.text}`).join("\n").slice(-12000);
    const repName = m.rep_name || m.owner_name || "";
    const dateStr = new Date(m.created_at || Date.now()).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const speakers = [...new Set(utterances.map((u) => u.speaker?.name).filter(Boolean))];
    try {
      const rev = await analyzeMeeting({ transcript: text, repName, dateStr, speakers });
      await saveAnalysis(req.params.id, rev);
    } catch (e) { console.error("[復元:要約]", e.message); }
    try {
      let lostSignals = [];
      try { lostSignals = (await getSettings()).lostSignals || []; } catch {}
      const deep = await analyzeDeep({ transcript: text, repName, lostSignals });
      await saveDeepAnalysis(req.params.id, deep);
    } catch (e) { console.error("[復元:分析]", e.message); }
    try {
      const raw = await splitPhases({ transcript: utterances, repName });
      const chapters = buildChapters(utterances, raw);
      if (chapters.length) await saveChapters(req.params.id, chapters);
    } catch (e) { console.error("[復元:段階]", e.message); }

    res.json({ ok: true, utterances: utterances.length });
  } catch (e) {
    console.error("[retranscribe]", e.message);
    res.status(502).json({ error: String(e.message || "").slice(0, 200) });
  } finally {
    try { (await import("node:fs")).unlinkSync(tmp); } catch {}
  }
});

// 録画をGoogleドライブに保存する（Recallの保存期限が切れても残るようにする）
app.post("/api/meetings/:id/archive-drive", async (req, res) => {
  try {
    const m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "見つかりません" });
    if (m.drive_file_id) return res.json({ ok: true, already: true, fileId: m.drive_file_id, link: m.drive_link });

    let url = null;
    try { url = await getRecordingUrl(req.params.id); } catch {}
    // Recallに無ければ、Muxに保存されている録画から取り出す
    if (!url && m.mux_playback_id && muxConfigured()) {
      const asset = await findAssetByPlaybackId(m.mux_playback_id);
      if (asset) {
        let name = readyMp4Name(asset);
        if (!name) {
          let detail = "";
          try { await enableMp4(asset.id); } catch (e) { detail = e.muxDetail || e.message; }
          return res.status(202).json({ error: "Muxのダウンロード用ファイルを準備しています。2〜3分後にもう一度押してください。" + (detail ? "（" + detail.slice(0, 160) + "）" : "") });
        }
        url = mp4Url(m.mux_playback_id, name);
      }
    }
    if (!url) return res.status(400).json({ error: "録画が見つかりません" });

    const owner = req.user || m.owner;
    const folderId = await driveFolderForMeeting(owner, m);
    const when = new Date(m.created_at || Date.now()).toISOString().slice(0, 10);
    const safe = String(m.title || "商談").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
    const name = `${when}_${safe}.mp4`;

    const up = await driveUploadFromUrl(owner, { url, name, folderId });
    const domain = process.env.DRIVE_SHARE_DOMAIN || "";
    if (domain) await driveShareDomain(owner, up.fileId, domain);
    await saveDriveFile(req.params.id, { fileId: up.fileId, link: up.link });
    res.json({ ok: true, fileId: up.fileId, link: up.link, sizeMB: Math.round((up.size || 0) / 1048576) });
  } catch (e) {
    console.error("[archive-drive]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// kinbotのアカウントが無い人にも録画を見せるための共有リンクを作る
app.post("/api/meetings/:id/share-link", async (req, res) => {
  try {
    let m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "見つかりません" });

    // まだドライブに無ければ、先に保存する
    if (!m.drive_file_id) {
      let url = null;
      try { url = await getRecordingUrl(req.params.id); } catch {}
      if (!url && m.mux_playback_id && muxConfigured()) {
        const asset = await findAssetByPlaybackId(m.mux_playback_id);
        if (asset) {
          const name = readyMp4Name(asset);
          if (!name) {
            try { await enableMp4(asset.id); } catch {}
            return res.status(202).json({ error: "録画の準備をしています。2〜3分後にもう一度押してください。" });
          }
          url = mp4Url(m.mux_playback_id, name);
        }
      }
      if (!url) return res.status(400).json({ error: "録画が見つかりません" });
      const owner = req.user || m.owner;
      const folderId = await driveEnsureFolder(owner, process.env.DRIVE_FOLDER_NAME || "kinbot 商談録画");
      const when = new Date(m.created_at || Date.now()).toISOString().slice(0, 10);
      const safe = String(m.title || "商談").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
      const up = await driveUploadFromUrl(owner, { url, name: `${when}_${safe}.mp4`, folderId });
      await saveDriveFile(req.params.id, { fileId: up.fileId, link: up.link });
      m = await getMeeting(req.params.id);
    }

    const share = await driveShareAnyone(req.user || m.owner, m.drive_file_id);
    res.json({
      ok: true,
      link: m.drive_link || `https://drive.google.com/file/d/${m.drive_file_id}/view`,
      scope: share.scope,
      note: share.scope === "anyone"
        ? "このリンクを知っている人なら、kinbotのアカウントが無くても視聴できます。"
        : `会社の設定で社外共有ができないため、社内（${share.domain}）の人が見られる状態にしました。`,
    });
  } catch (e) {
    console.error("[share-link]", e.message);
    const msg = String(e.message || "");
    res.status(502).json({
      error: msg.slice(0, 300),
      hint: /sharingRateLimit|cannotShare|forbidden|403/i.test(msg)
        ? "Google Workspaceの設定で共有が制限されている可能性があります。管理者に、外部共有またはリンク共有の許可を確認してください。"
        : /insufficient|scope/i.test(msg)
          ? "Googleの権限が足りません。設定→外部連携で連携し直してください。"
          : "",
    });
  }
});

// ドライブに保存した録画を、kinbotの画面で再生する（途中送りに対応）
app.get("/api/meetings/:id/drive-video", async (req, res) => {
  try {
    const m = await getMeeting(req.params.id);
    if (!m || !canAccess(m, req) || !m.drive_file_id) return res.status(404).end();
    // まず自分の権限で読み、だめなら商談の担当者の権限で読む（共有ドライブなら誰でも見られる）
    let up = null;
    for (const who of [req.user, m.owner].filter(Boolean)) {
      try {
        const r = await driveStream(who, m.drive_file_id, req.headers.range);
        if (r.ok || r.status === 206) { up = r; break; }
      } catch {}
    }
    if (!up) return res.status(404).end();
    res.status(up.status === 206 ? 206 : 200);
    for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const v = up.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    if (!up.headers.get("accept-ranges")) res.setHeader("accept-ranges", "bytes");
    if (!up.body) return res.end();
    const reader = up.body.getReader();
    let closed = false;
    // 途中送りなどで再生側が切ったら、読み込みも止める
    res.on("close", () => { closed = true; try { reader.cancel(); } catch {} });
    const pump = async () => {
      if (closed) return;
      try {
        const { done, value } = await reader.read();
        if (done || closed) return res.end();
        if (!res.write(Buffer.from(value))) { res.once("drain", pump); return; }
        pump();
      } catch {
        try { res.end(); } catch {}
      }
    };
    pump();
  } catch (e) {
    console.error("[drive-video]", e.message);
    res.status(502).end();
  }
});

// 中継サーバーに届くかどうかを、kinbotから実際につないで確かめる
app.get("/api/live/relay-check", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const raw = String(process.env.LIVE_RELAY_RTMP || "").trim();
    if (!raw) return res.json({ ok: false, reason: "LIVE_RELAY_RTMP が未設定です" });

    let host = "", port = 0;
    try {
      const u = new URL(raw.replace(/^rtmp:/, "http:"));
      host = u.hostname;
      port = Number(u.port || 1935);
    } catch {
      return res.json({ ok: false, raw, reason: "URLの形式が正しくありません（例：rtmp://xxx.proxy.rlwy.net:12345）" });
    }

    const net = await import("node:net");
    const result = await new Promise((resolve) => {
      const sock = new net.Socket();
      const done = (ok, reason) => { try { sock.destroy(); } catch {} resolve({ ok, reason }); };
      sock.setTimeout(6000);
      sock.once("connect", () => done(true, "つながりました"));
      sock.once("timeout", () => done(false, "応答がありません（ポートが公開されていない可能性）"));
      sock.once("error", (e) => done(false, e.message));
      sock.connect(port, host);
    });

    res.json({
      ok: result.ok,
      host, port, url: raw,
      reason: result.reason,
      hint: result.ok
        ? "中継サーバーには届きます。映らない場合は、Recall側から送れていない可能性があります。"
        : "中継サーバーに届きません。RailwayのTCP Proxy（ポート1935）が有効か、LIVE_RELAY_RTMP の値が正しいか確認してください。",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 中継サーバーが「この配信をどこへ送るか」を尋ねてくる窓口。
// 合図は「live/kbxxxx」の形で来ることがあるので、最後の部分だけを見る。
// 中継サーバーが宛先を聞きに来た記録（届いているかの確認用）。
// 合言葉が違うときも記録する（気づけるように）。
const relayAsks = [];

// いまkinbotが持っている合言葉の「特徴」を返す。
// 中身は出さず、長さと先頭・末尾だけ。中継サーバー側と見比べるために使う。
app.get("/api/live/relay-secret", (req, res) => {
  const tidy = (v) => String(v || "").trim().replace(/^["']|["']$/g, "");
  const sec = tidy(process.env.RELAY_SECRET);
  res.json({
    合言葉: sec
      ? { 長さ: sec.length, 先頭: sec.slice(0, 3), 末尾: sec.slice(-3) }
      : "設定されていません",
    中継サーバー: process.env.LIVE_RELAY_RTMP || "（未設定）",
    kinbotが起動した時刻: START_TIME,
    hint: "この『長さ・先頭・末尾』が、中継サーバー側の値と同じか見てください。" +
      "違う場合は、環境変数を保存したあと、そのサービスを再デプロイしてください。" +
      "（環境変数は、再デプロイして初めて反映されます）",
  });
});

app.get("/api/live/relay-log", (req, res) => {
  res.json({
    items: relayAsks,
    hint: relayAsks.length
      ? "中継サーバーからの問い合わせが届いています。ここに記録があれば、Recall→中継までは通っています。"
      : "中継サーバーからの問い合わせがまだありません。Recallから中継サーバーへ映像が届いていない可能性があります。",
  });
});

app.get("/api/live/relay-dest", async (req, res) => {
  // 合言葉は、前後の空白や引用符が混ざっても通るようにそろえて比べる。
  // Railwayの環境変数に貼るとき、うっかり付いてしまうことが多いため。
  const tidy = (v) => String(v || "").trim().replace(/^["']|["']$/g, "");
  const secret = tidy(process.env.RELAY_SECRET);
  const got = tidy(req.get("X-Relay-Secret"));
  if (!secret || got !== secret) {
    const why = !secret ? "kinbot側に RELAY_SECRET がありません"
      : !got ? "中継サーバーが合言葉を送っていません"
      // 中身は出さず、長さと先頭・末尾だけで見分けられるようにする
      : `合言葉が一致しません（kinbot側 ${secret.length}文字「${secret.slice(0, 2)}…${secret.slice(-2)}」／` +
        `中継側 ${got.length}文字「${got.slice(0, 2)}…${got.slice(-2)}」）`;
    console.warn(`[live] 宛先を渡せません：${why}`);
    relayAsks.unshift({ at: new Date().toISOString(), token: String(req.query.token || ""), found: false, why });
    if (relayAsks.length > 20) relayAsks.length = 20;
    devNote({
      key: errKey("中継の合言葉", why), kind: "error",
      title: `ライブ中継に宛先を渡せません：${why}`, source: "ライブ配信",
    }).catch(() => {});
    return res.status(403).type("text/plain").send("");
  }
  const raw = String(req.query.token || "");
  const token = raw.split("/").filter(Boolean).pop()?.replace(/[^a-zA-Z0-9]/g, "") || "";
  const dest = await relayDestFor(token).catch(() => "");
  relayAsks.unshift({ at: new Date().toISOString(), token: raw, found: !!dest });
  if (relayAsks.length > 20) relayAsks.length = 20;
  if (!dest) {
    console.warn(`[live] 宛先が見つかりません（合図：${raw}）。配信枠が作られる前か、古い配信の可能性があります。`);
    return res.status(404).type("text/plain").send("");
  }
  console.log(`[live] 中継の宛先を渡しました（合図：${token}）`);
  res.type("text/plain").send(dest);
});

// ライブ配信の設定（画面側が再生URLを組み立てるために使う）
app.get("/api/live/info", (req, res) => {
  res.set("Cache-Control", "no-store");
  const info = liveInfo();
  const raw = String(process.env.CF_STREAM_CUSTOMER_CODE || "");
  const code = raw.trim().replace(/^https?:\/\//, "").replace(/^customer-/, "").replace(/\.cloudflarestream\.com.*$/, "").replace(/\/.*$/, "");
  res.json({
    ...info,
    customerCode: info.provider === "cloudflare" ? code : "",
    customerCodeRaw: raw !== code ? raw : undefined,
    playbackSample: code ? `https://customer-${code}.cloudflarestream.com/（配信ID）/manifest/video.m3u8` : "",
  });
});

// 録画の保存先フォルダを、kinbotのデータを正解として作り直す。
// （1）正しいフォルダへ移動 →（2）空になったフォルダをゴミ箱へ、の2段構え。
app.post("/api/drive/rebuild", async (req, res) => {
  try {
    const b = req.body || {};
    const who = req.user;
    const phase = b.phase === "clean" ? "clean" : "move";
    const budget = Math.max(10, Math.min(200, Number(b.budget) || 50));
    const root = await driveEnsureFolder(who, process.env.DRIVE_FOLDER_NAME || "kinbot 商談録画");

    // ---- (1) ファイルを正しいフォルダへ移す ----
    if (phase === "move") {
      const days = Math.max(1, Math.min(1095, Number(b.days) || 730));
      const jst = new Date(Date.now() + 9 * 3600 * 1000);
      const from = new Date(jst.getTime() - days * 86400000).toISOString().slice(0, 10);
      const rows = await listMeetings({ isAdmin: true, from, limit: 3000 });
      const targets = rows.filter((m) => m.drive_file_id);
      const offset = Math.max(0, Math.min(targets.length, Number(b.offset) || 0));
      const part = targets.slice(offset, offset + Math.max(5, Math.floor(budget / 4)));
      const nameMap = await buildRepNameMap();

      const out = { phase, total: targets.length, offset, processed: part.length, moved: 0, already: 0, errors: [] };
      out.remaining = Math.max(0, targets.length - (offset + part.length));

      for (const t of part) {
        try {
          const m = (await getMeeting(t.bot_id)) || t;
          const rep = resolveRepName(m.rep_name, m.owner, nameMap) || "担当者未設定";
          const d = new Date(m.created_at || Date.now());
          const j = new Date(d.getTime() + 9 * 3600 * 1000);
          const folderId = await driveEnsurePath(
            who,
            [rep, `${j.getUTCMonth() + 1}月`, `${j.getUTCDate()}日`],
            root
          );
          const r = await driveMoveFile(who, m.drive_file_id, folderId);
          if (r.moved) out.moved++; else out.already++;
        } catch (e) {
          out.errors.push(`${t.title || t.bot_id}: ${String(e.message || "").slice(0, 120)}`);
        }
      }
      return res.json(out);
    }

    // ---- (2) 空になったフォルダをゴミ箱へ ----
    const out = { phase, trashed: 0, checked: 0, kept: 0, folders: 0, more: false, errors: [] };
    let ops = 0;
    const sweep = async (parentId, depth) => {
      if (depth > 3 || ops >= budget) return;
      let kids = [];
      try { kids = await driveListChildren(who, parentId, true); ops++; }
      catch (e) { out.errors.push(String(e.message || "").slice(0, 110)); return; }
      for (const k of kids) {
        if (ops >= budget) { out.more = true; return; }
        await sweep(k.id, depth + 1);
        if (ops >= budget) { out.more = true; return; }
        try {
          const items = await driveListChildren(who, k.id, false);
          ops++;
          out.checked++;
          if (!items.length) {
            await driveTrash(who, k.id);
            out.trashed++;
            ops++;
          } else {
            out.kept++;
          }
        } catch (e) {
          out.errors.push(`${k.name}: ${String(e.message || "").slice(0, 100)}`);
        }
      }
    };
    await sweep(root, 1);
    if (ops >= budget) out.more = true;
    // いま残っているフォルダの数（進み具合の目安）
    try {
      const top = await driveListChildren(who, root, true);
      out.folders = top.length;
    } catch {}
    res.json(out);
  } catch (e) {
    console.error("[drive rebuild]", e && e.stack ? e.stack : e);
    const msg = String((e && e.message) || e || "不明なエラー");
    res.status(502).json({
      error: msg.slice(0, 300),
      hint: /insufficient|Insufficient Permission|403/.test(msg)
        ? "Googleの書き込み権限がありません。設定→外部連携でGoogleを連携し直してください。"
        : /連携されていません/.test(msg)
          ? "Googleが未連携です。"
          : /404|notFound/.test(msg)
            ? "保存先フォルダが見つかりません。DRIVE_FOLDER_ID の値を確認してください。"
            : "",
    });
  }
});

// 既にある商談の録画を、まとめてGoogleドライブへ移す。
// Recallの録画があればそこから、無ければMuxから取り出して保存します。
// 時間がかかるので少しずつ処理します（画面から繰り返し呼んでください）。
app.post("/api/drive/migrate", async (req, res) => {
  try {
    const b = req.body || {};
    const days = Math.max(1, Math.min(365, Number(b.days) || 180));
    const max = Math.max(1, Math.min(5, Number(b.max) || 2));
    const deleteMux = b.deleteMux !== false;

    const jst = new Date(Date.now() + 9 * 3600 * 1000);
    const from = new Date(jst.getTime() - days * 86400000).toISOString().slice(0, 10);
    const rows = await listMeetings({ isAdmin: true, from, limit: 2000 });
    const targets = rows.filter((m) => !m.drive_file_id);
    // 保存できないものを何度も掴まないように、開始位置を指定できるようにする
    const offset = Math.max(0, Math.min(targets.length, Number(b.offset) || 0));
    const part = targets.slice(offset, offset + max);
    const out = {
      total: targets.length,
      offset,
      processed: part.length,
      remaining: Math.max(0, targets.length - (offset + part.length)),
      done: 0, skipped: 0, errors: [],
      reasons: { 録画なし: 0, Mux準備中: 0, 担当者なし: 0 },
    };

    // 保存はまず操作者の権限で行う（共有フォルダに入れるので誰の権限でも同じ場所になる）
    const uploader = b.uploader || req.user || "";

    // 準備モード：Muxに「ダウンロード用のMP4を作って」と頼むだけ（待たない）
    if (b.prepareOnly) {
      const out2 = { total: targets.length, offset, asked: 0, ready: 0, skipped: 0, errors: [] };
      for (const t of targets.slice(offset, offset + Math.max(20, max))) {
        const m = (await getMeeting(t.bot_id)) || t;
        out2.offset = offset;
        if (!m.mux_playback_id || !muxConfigured()) { out2.skipped++; continue; }
        try {
          const asset = await findAssetByPlaybackId(m.mux_playback_id);
          if (!asset) { out2.skipped++; continue; }
          if (readyMp4Name(asset)) { out2.ready++; continue; }
          await enableMp4(asset.id);
          out2.asked++;
        } catch (e) {
          out2.errors.push(`${m.title || m.bot_id}: ${(e.muxDetail || e.message || "").slice(0, 140)}`);
        }
      }
      out2.processed = Math.min(Math.max(20, max), Math.max(0, targets.length - offset));
      out2.remaining = Math.max(0, targets.length - (offset + out2.processed));
      return res.json(out2);
    }

    // 調査モード：保存はせず、なぜ保存できないのかだけを返す。
    // 録画の有無だけでなく、「保存先フォルダを作れるか」まで見る。
    // 保存できない原因は、ほとんどがGoogleの書き込み権限だから。
    if (b.probe) {
      const probe = [];
      let folderOk = null, folderErr = "";
      // フォルダは1回だけ確かめる（毎回作りに行かない）
      try {
        const one = (await getMeeting(targets[offset]?.bot_id)) || targets[offset];
        if (one && uploader) {
          await driveFolderForMeeting(uploader, one);
          folderOk = true;
        } else if (!uploader) {
          folderOk = false; folderErr = "保存する人が分かりません（ログインし直してください）";
        }
      } catch (e) {
        folderOk = false;
        const msg = String(e.message || "");
        folderErr = /insufficient|scope|403/i.test(msg)
          ? "Googleの書き込み権限が足りません（設定→外部連携→Google連携をやり直してください）"
          : msg.slice(0, 160);
      }

      for (const t of targets.slice(offset, offset + Math.max(5, max))) {
        const m = (await getMeeting(t.bot_id)) || t;
        const row = {
          title: m.title || m.bot_id, date: String(m.created_at).slice(0, 10),
          recall: false, mux: !!m.mux_playback_id, error: "", can: false,
        };
        try {
          const u = await getRecordingUrl(m.bot_id);
          row.recall = !!u;
        } catch (e) {
          row.error = String(e.message || "").slice(0, 140);
        }
        // この商談は保存できる見込みがあるか
        row.can = !!(folderOk && (row.recall || row.mux));
        probe.push(row);
      }
      return res.json({
        probe, total: targets.length, offset,
        uploader, folderOk, folderErr,
        hint: folderOk === false
          ? folderErr
          : (probe.some((x) => x.can)
              ? "保存できる見込みです。「移行を始める」を押してください。"
              : "録画そのものが見つかりません（Recallの保存期限切れ・Muxの書き出し待ちなど）"),
      });
    }
    for (const t of part) {
      const m = (await getMeeting(t.bot_id)) || t;
      const owner = uploader || m.owner || "";
      if (!owner) { out.skipped++; out.reasons.担当者なし++; continue; }
      try {
        // 1) Recallの録画をまず探す
        let url = null;
        try { url = await getRecordingUrl(m.bot_id); } catch {}
        let asset = null;

        // 2) 無ければMuxから取り出す
        if (!url && m.mux_playback_id && muxConfigured()) {
          asset = await findAssetByPlaybackId(m.mux_playback_id);
          if (asset) {
            let name = readyMp4Name(asset);
            if (!name) {
              // 準備を頼んでから、少しだけ待って様子を見る
              let detail = "";
              try { await enableMp4(asset.id); } catch (e) { detail = e.muxDetail || e.message; }
              for (let i = 0; i < 2 && !name; i++) {
                await new Promise((r) => setTimeout(r, 5000));
                try { name = readyMp4Name(await getAsset(asset.id)); } catch {}
              }
              if (!name) {
                out.reasons.Mux準備中++;
                out.errors.push(`${m.title || m.bot_id}: Muxのダウンロード用ファイルを準備中です。数分後にもう一度実行してください。${detail ? "（" + detail.slice(0, 120) + "）" : ""}`);
                continue;
              }
            }
            url = mp4Url(m.mux_playback_id, name);
          }
        }
        if (!url) { out.skipped++; out.reasons.録画なし++; continue; }

        const folderId = await driveFolderForMeeting(owner, m);
        const when = new Date(m.created_at || Date.now()).toISOString().slice(0, 10);
        const safe = String(m.title || "商談").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
        const up = await driveUploadFromUrl(owner, { url, name: `${when}_${safe}.mp4`, folderId });
        const domain = process.env.DRIVE_SHARE_DOMAIN || "";
        if (domain) await driveShareDomain(owner, up.fileId, domain);
        await saveDriveFile(m.bot_id, { fileId: up.fileId, link: up.link });
        out.done++;

        // 3) Muxの録画はもう不要なので消す
        if (deleteMux && m.mux_playback_id && muxConfigured()) {
          try {
            const a = asset || (await findAssetByPlaybackId(m.mux_playback_id));
            if (a) await deleteAsset(a.id);
          } catch {}
        }
      } catch (e) {
        const msg = String(e.message || "");
        out.errors.push(
          /insufficient|Insufficient Permission|403/.test(msg)
            ? `${m.title || m.bot_id}: Googleの書き込み権限がありません。設定→外部連携でGoogleを連携し直してください。`
            : `${m.title || m.bot_id}: ${msg.slice(0, 160)}`
        );
      }
    }
    res.json(out);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 進行中の商談のライブ配信が、実際に届いているか確認する
app.get("/api/live/status", async (req, res) => {
  // 商談IDを書かなかったときは、いちばん新しい「配信枠のある商談」を見る
  if (!String(req.query.bot || "").trim()) {
    try {
      const rows = await listMeetings({ isAdmin: true, limit: 20, light: true });
      const hit = (rows || []).find((m) => m.mux_playback_id);
      if (hit) req.query.bot = hit.bot_id;
    } catch {}
  }
  try {
    res.set("Cache-Control", "no-store");
    const botId = String(req.query.bot || "").trim();
    let liveId = String(req.query.id || "").trim();
    if (!liveId && botId) {
      const a = listActiveSessions().find((x) => x.botId === botId);
      if (a) liveId = a.muxLiveStreamId || "";
      if (!liveId) {
        const m = await getMeeting(botId);
        liveId = (m && m.mux_live_stream_id) || "";
      }
    }
    const info = liveInfo();
    const st = await liveStatus(liveId);

    // Recallに渡した配信先と、中継サーバーへ届くかどうかを一緒に返す
    const act = listActiveSessions().find((x) => x.botId === botId);
    const sentTo = (act && act.liveRtmpUrl) || "";
    const mask = (u) => String(u || "").replace(/[^/]+$/, "***");
    let relayCheck = null;
    const raw = String(process.env.LIVE_RELAY_RTMP || "").trim();
    if (raw) {
      try {
        const u = new URL(raw.replace(/^rtmp:/, "http:"));
        const net = await import("node:net");
        relayCheck = await new Promise((resolve) => {
          const sock = new net.Socket();
          const done = (ok, why) => { try { sock.destroy(); } catch {} resolve({ host: u.hostname, port: Number(u.port || 1935), ok, why }); };
          sock.setTimeout(5000);
          sock.once("connect", () => done(true, "中継サーバーに届きます"));
          sock.once("timeout", () => done(false, "中継サーバーに届きません（TCP Proxyの設定を確認）"));
          sock.once("error", (e) => done(false, e.message));
          sock.connect(Number(u.port || 1935), u.hostname);
        });
      } catch { relayCheck = { ok: false, why: "LIVE_RELAY_RTMP の形式が正しくありません" }; }
    }
    // 再生URLに実際につないでみて、見られる状態かを確かめる。
    // 顧客コード（CF_STREAM_CUSTOMER_CODE）が違うと、配信は届いていても再生できない。
    let playCheck = null;
    const playUrl = liveId ? livePlaybackUrl(liveId) : null;
    if (playUrl) {
      try {
        const r = await fetch(playUrl, { method: "GET", redirect: "follow" });
        const body = r.ok ? (await r.text()).slice(0, 200) : "";
        playCheck = {
          url: playUrl.replace(/\/\/customer-[^.]+\./, "//customer-***."),
          status: r.status,
          ok: r.ok && /#EXTM3U/.test(body),
          why: r.ok
            ? (/#EXTM3U/.test(body) ? "再生できます" : "中身が動画の一覧ではありません")
            : r.status === 404
              ? "再生URLが見つかりません（顧客コードが違うか、まだ配信が始まっていません）"
              : `再生URLが ${r.status} を返しました`,
        };
      } catch (e) {
        playCheck = { ok: false, why: `再生URLにつながりません：${e.message}` };
      }
    }

    // 再生できないときは、顧客コードが合っているかも調べる
    let codeCheck = null;
    if (liveId && playCheck && !playCheck.ok) {
      codeCheck = await cfCustomerCodeCheck(liveId).catch(() => null);
    }

    res.json({
      ...info,
      liveStreamId: liveId || null,
      playCheck,
      codeCheck,
      ...st,
      relay: raw ? "中継あり" : "中継なし（直接）",
      sentTo: mask(sentTo) || "（この商談には配信先が設定されていません）",
      sentToIsRelay: !!(raw && sentTo && sentTo.startsWith(raw)),
      relayCheck,
      hint: codeCheck && codeCheck.合っているか === false ? codeCheck.直し方
        : playCheck && playCheck.ok ? "映像が届いていて、再生もできます。"
        : playCheck && !playCheck.ok && st.state === "connected"
          ? `映像は届いていますが、再生できません：${playCheck.why}`
        : st.why ? st.why
        : st.state === "connected" ? "映像が届いています。"
        : st.state === "disconnected" || st.state === "idle"
          ? "配信がまだ届いていません。ボットが入室してから30秒ほどかかります。数分たっても変わらない場合は、Recallから中継サーバーへ届いていない可能性があります（中継のログを確認してください）。"
          : "",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 配信枠を実際に1つ作ってみて、本当に使えるかを確かめる。
// 設定が合っていても鍵の権限が足りないことがあるので、本番の商談を待たずに試せるようにする。
// Cloudflareに残っている古い配信枠と録画を、いま片づける
app.post("/api/live/cleanup", async (req, res) => {
  try {
    const hours = Math.max(0, Math.min(720, Number(req.body?.hours ?? 6)));
    const r = await cleanupOldLiveInputs(hours);
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get("/api/live/cleanup", async (req, res) => {
  try {
    const r = await cleanupOldLiveInputs(Math.max(0, Math.min(720, Number(req.query.hours ?? 6))));
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 顧客コード（customer-xxxx）が合っているかだけを確かめる。
// 商談を指定しなくてよいので、いつでも開ける。
// 中で配信枠を1つ作って調べ、すぐ片づける。
app.get("/api/live/code-check", async (req, res) => {
  try {
    if (!liveConfigured()) {
      return res.json({ ok: false, why: "配信の設定がありません（CF_ACCOUNT_ID / CF_STREAM_TOKEN）" });
    }
    const st = await createLiveStream();
    const check = await cfCustomerCodeCheck(st.liveStreamId).catch(() => null);
    // 再生URLにもつないでみる（配信していないので中身は空でよい。404かどうかを見る）
    let play = null;
    const url = livePlaybackUrl(st.liveStreamId);
    if (url) {
      try {
        const r = await fetch(url);
        play = { status: r.status, why: r.status === 404
          ? "再生URLが見つかりません（顧客コードが違う可能性が高いです）"
          : "再生URLは見つかりました（配信中なら映ります）" };
      } catch (e) { play = { why: `つながりません：${e.message}` }; }
    }
    try { await disableLiveStream(st.liveStreamId); } catch {}
    res.json({
      ok: !check || check.合っているか !== false,
      顧客コード: check,
      再生URL: play,
      hint: check && check.合っているか === false
        ? check.直し方
        : "顧客コードは合っています。",
    });
  } catch (e) { res.json({ ok: false, why: e.message }); }
});

// ブラウザのURL欄からも試せるように、GETでも同じ動きにする
app.get("/api/live/test", async (req, res) => liveTest(req, res));
app.post("/api/live/test", async (req, res) => liveTest(req, res));

async function liveTest(req, res) {
  try {
    if (!liveConfigured()) {
      return res.json({ ok: false, reason: "配信の設定がありません（CF_ACCOUNT_ID / CF_STREAM_TOKEN）" });
    }
    const t0 = Date.now();
    const st = await createLiveStream();
    const ms = Date.now() - t0;
    if (!st || !st.playbackId) {
      return res.json({ ok: false, reason: "配信枠は作れましたが、再生用のIDが返ってきませんでした" });
    }
    // 試したぶんは片づける（残すと使われないまま増えるため）
    let cleaned = false;
    try { await disableLiveStream(st.liveStreamId); cleaned = true; } catch {}
    console.log(`[live] 試しに配信枠を作りました（${ms}ms・片づけ${cleaned ? "済" : "できず"}）`);
    res.json({
      ok: true, ms, cleaned,
      // 送り先は鍵が含まれるので、先頭だけ見せる
      rtmp: String(st.rtmpUrl || "").slice(0, 40) + "…",
      playbackId: st.playbackId,
      note: "配信枠を作れました。次の録音からライブ映像が出ます。",
    });
  } catch (e) {
    res.json({ ok: false, reason: e.message });
  }
}

// Recall側が配信をどう扱っているかを見る（届かないときの切り分け）
app.get("/api/live/bot-check", async (req, res) => {
  try {
    const botId = String(req.query.bot || "").trim();
    if (!botId) return res.status(400).json({ error: "商談のID（bot）を指定してください" });
    const bot = await getBot(botId);

    // 配信先（RTMP）の設定が、ボットに入っているかを見る
    const eps = bot?.recording_config?.realtime_endpoints || [];
    const rtmp = eps.find((e) => e.type === "rtmp");
    const flv = !!bot?.recording_config?.video_mixed_flv;

    // 状態の移り変わり（入室できたか・録音できているか）
    const changes = (bot.status_changes || []).map((c) => ({
      code: c.code, at: c.created_at, message: c.message || c.sub_code || "",
    }));

    res.json({
      ok: true,
      配信先の設定: rtmp
        ? String(rtmp.url || "").replace(/[^/]+$/, "***")
        : "（入っていません＝この商談は配信されません）",
      映像の書き出し: flv ? "あり" : "なし",
      いまの状態: bot.status_changes?.slice(-1)[0]?.code || "不明",
      状態の記録: changes.slice(-8),
      hint: !rtmp
        ? "配信先が入っていません。録音を開始したときに配信枠が作れていなかった可能性があります。"
        : "配信先は入っています。ここまで来て映らない場合は、中継サーバーのログ（[relay] で始まる行）をご確認ください。",
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ライブ配信が映らないときに、どこで止まっているかを1画面で確かめる
app.get("/api/live/diagnose", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const steps = [];
    const info = liveInfo();

    // 1. kinbot側の設定
    steps.push({
      step: "1. 配信の設定",
      ok: info.configured,
      detail: info.configured
        ? `${info.provider}（顧客コード：${info.customerCodeSet ? "あり" : "なし"}）`
        : "CF_ACCOUNT_ID / CF_STREAM_TOKEN が設定されていません",
    });

    // 2. 中継サーバーの指定
    const raw = String(process.env.LIVE_RELAY_RTMP || "").trim();
    steps.push({
      step: "2. 中継サーバーの指定",
      ok: !!raw,
      detail: raw || "LIVE_RELAY_RTMP が未設定（Cloudflareへ直接送ります）",
    });

    // 3. 中継サーバーにつながるか
    if (raw) {
      let host = "", port = 0, ok = false, why = "";
      try {
        const u = new URL(raw.replace(/^rtmp:/, "http:"));
        host = u.hostname; port = Number(u.port || 1935);
        const net = await import("node:net");
        const r = await new Promise((resolve) => {
          const sock = new net.Socket();
          const done = (o, w) => { try { sock.destroy(); } catch {} resolve({ o, w }); };
          sock.setTimeout(6000);
          sock.once("connect", () => done(true, "つながりました"));
          sock.once("timeout", () => done(false, "応答がありません（TCP Proxyが無効かもしれません）"));
          sock.once("error", (e) => done(false, e.message));
          sock.connect(port, host);
        });
        ok = r.o; why = r.w;
      } catch (e) { why = e.message; }
      steps.push({ step: "3. 中継サーバーへの通信", ok, detail: `${host}:${port} … ${why}` });
    }

    // 4. 合言葉
    steps.push({
      step: "4. 中継サーバーとの合言葉",
      ok: !!process.env.RELAY_SECRET,
      detail: process.env.RELAY_SECRET
        ? "設定あり（中継サーバー側にも同じ値が必要です）"
        : "RELAY_SECRET が未設定。中継サーバーは宛先を聞けません",
    });

    // 5. 宛先の対応表
    const n = await countLiveRelay().catch(() => 0);
    steps.push({
      step: "5. 宛先の対応表",
      ok: true,
      detail: `いま覚えているぶん：${relayMap.size}件（再起動しても残るぶん：${n}件）`,
    });

    res.json({
      ok: steps.every((x) => x.ok),
      steps,
      hint: steps.every((x) => x.ok)
        ? "設定はそろっています。/api/live/test を実行すると、実際に配信枠を作れるか確かめられます。" +
          "そのうえで録音を開始し直すと、ライブ映像が出ます（配信の送り先は入室時にしか決められないため、" +
          "設定を直す前に始めた商談は配信できません）。"
        : "×が付いたところが原因です。直したあと、録音を開始し直してください。",
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Recall側が配信先をどう扱っているかを見る（届かないときの切り分け用）
app.get("/api/live/debug", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const botId = String(req.query.bot || "").trim();
    if (!botId) return res.status(400).json({ error: "bot（商談ID）を指定してください" });
    const bot = await getBot(botId);
    const eps = (bot && (bot.realtime_endpoints || bot.recording_config?.realtime_endpoints)) || [];
    const mask = (u) => String(u || "").replace(/[^/]+$/, "***");
    res.json({
      botId,
      status: (bot && bot.status_changes && bot.status_changes.slice(-3)) || bot?.status || null,
      endpoints: (Array.isArray(eps) ? eps : []).map((e) => ({
        type: e.type, url: mask(e.url), events: e.events || e.config?.events || null,
        status: e.status || null, error: e.error || null,
      })),
      note: "type=rtmp の status や error に、配信できない理由が出ることがあります。",
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Muxにどれだけ動画が保存されているか（課金の目安）
app.get("/api/mux/storage", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    if (!muxConfigured()) return res.json({ configured: false });
    const sum = await muxStorageSummary({ maxPages: Number(req.query.pages) || 20 });
    const live = await muxLiveUsage(Number(req.query.days) || 30);
    res.json({
      configured: true,
      ...sum,
      live,
      note: "Muxは『保存している分数 × 月数』で課金されます。kinbotの再生はRecallの録画を優先して使うため、ここに残っている動画は使われていないことが多いです。",
    });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// 古い動画を消す。まずは dry=1（消さずに一覧だけ）で確認してから実行してください。
app.post("/api/mux/cleanup", async (req, res) => {
  try {
    if (!muxConfigured()) return res.status(400).json({ error: "Muxが未設定です" });
    const days = Math.max(7, Math.min(3650, Number((req.body && req.body.days) || 90)));
    const dry = !(req.body && req.body.confirm === true);
    const cutoff = Date.now() - days * 86400000;
    const targets = [];
    for (let page = 1; page <= 20; page++) {
      const rows = await listAssets({ limit: 100, page });
      if (!rows.length) break;
      for (const a of rows) {
        const at = a.created_at ? Number(a.created_at) * 1000 : 0;
        if (at && at < cutoff) targets.push({ id: a.id, created: new Date(at).toISOString().slice(0, 10), minutes: Math.round((Number(a.duration || 0) / 60) * 10) / 10 });
      }
      if (rows.length < 100) break;
    }
    const minutes = Math.round(targets.reduce((n, t) => n + t.minutes, 0));
    if (dry) {
      return res.json({ dryRun: true, days, count: targets.length, minutes, sample: targets.slice(0, 10),
        hint: "消してよければ {\"days\":90,\"confirm\":true} で実行してください。" });
    }
    let done = 0;
    for (const t of targets) {
      try { await deleteAsset(t.id); done++; } catch (e) { console.error("[mux cleanup]", t.id, e.message); }
    }
    res.json({ dryRun: false, days, deleted: done, minutes });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Recall接続状況（どのリージョン/キーに繋がっているか＋今月の利用時間＋直近のボット起動結果）
// ※Recall APIは「残高（チャージ額）」を返さないため、残高は取得できない。利用時間と接続先のみ表示する。
// アポ1件について、いまどこで止まっているかを調べる。
// 「通知が来ない」の原因を、その場で確かめられるようにする。
app.get("/api/apo/:slug/why", async (req, res) => {
  try {
    const link = await getSmartLink(String(req.params.slug || ""));
    if (!link) return res.status(404).json({ error: "見つかりません" });
    const st = await getSettings().catch(() => ({}));
    const cfg = await getRotationConfig().catch(() => ({}));

    const steps = [];
    const add2 = (name, ok, detail) => steps.push({ name, ok, detail: detail || "" });

    add2("アポの登録", true, `${link.label || "(予定名なし)"}／獲得 ${link.setter || "-"}`);
    add2("担当", !!link.current_owner, link.current_owner || "未定");
    add2("処理済みの印", true,
      link.auto_assigned_at
        ? `付いています（${new Date(link.auto_assigned_at).toLocaleString("ja-JP", { hour12: false })}）。これが付いていると、自動処理の対象になりません。`
        : "付いていません（自動処理の対象です）");
    add2("集計から除外", !link.excluded, link.excluded ? "外されています" : "対象です");
    add2("自動スキャン", cfg.autoScan !== false, cfg.autoScan === false ? "OFFになっています" : "ONです");
    add2("自動割り振り", cfg.autoAssign !== false, cfg.autoAssign === false ? "OFFになっています" : "ONです");

    // 通知先の設定
    const targets = await listChatTargets({ onlyActive: true }).catch(() => []);
    const assignTargets = targets.filter((t) => t.on_assign);
    add2("通知先", assignTargets.length > 0 || !!(await chatWebhookUrl().catch(() => "")),
      targets.length
        ? `${targets.length}件のうち、アポ割り振りがONなのは ${assignTargets.length}件`
        : "通知先が登録されていません（設定 → 外部連携 → Google連携）");
    add2("アポ割り振りの通知", st.chatNotifyAssign !== false,
      st.chatNotifyAssign === false ? "OFFになっています" : "ONです");

    res.json({ ok: steps.every((x) => x.ok), steps, slug: link.slug });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 処理済みの印を外して、もう一度やり直す（メール・SF立ち上げ・通知）
app.post("/api/apo/:slug/redo", async (req, res) => {
  try {
    const link = await getSmartLink(String(req.params.slug || ""));
    if (!link) return res.status(404).json({ error: "見つかりません" });
    await clearAutoAssigned(link.slug);
    const cfg = await getRotationConfig();
    const st = await getSettings().catch(() => ({}));
    // 商談予定を作るアカウント。空だと予定の作成でつまずく。
    const inviteOwner = String(st.apoInviteOwner || st.apoScanOwner || "").trim() || null;
    const r = await autoAssignOne({ ...link, auto_assigned_at: null },
      { inviteOwner, closers: null, cfg, actor: req.user || "manual" });
    console.log(`[apo] ${link.slug} をやり直しました by ${req.user}（${r.ok ? "成功" : r.reason || "失敗"}）`);
    res.json({ ok: !!r.ok, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 同じ予定から二重にできてしまったアポを片付ける
// アポ通知のカウント（本日/今週/今月）の手修正。
// 「修正後の数字」を起点にして、以降の新しいアポはそこに積み上がる。
app.get("/api/apo/count-adjust", async (req, res) => {
  try {
    const business = String(req.query.business || "");
    const [raw, effective] = await Promise.all([assignCountsRaw(business), assignCounts(business)]);
    res.json({ ok: true, business, raw, effective });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/apo/count-adjust", async (req, res) => {
  try {
    const b = req.body || {};
    const business = String(b.business || "");
    const raw = await assignCountsRaw(business);
    const keys = apoPeriodKeys();
    const st = await getSettings().catch(() => ({}));
    const all = st.apoCountAdjust || {};
    const cur = all[business] || {};
    for (const per of ["today", "week", "month"]) {
      const v = b[per];
      if (v === undefined || v === null || v === "") continue; // 空欄はそのまま
      const target = Math.max(0, parseInt(v, 10) || 0);
      // 「目標 − 実数」を調整値として、いまの期間キーで保存
      cur[per] = { key: keys[per], delta: target - raw[per] };
    }
    all[business] = cur;
    await saveSettings({ apoCountAdjust: all });
    const effective = await assignCounts(business);
    console.log(`[apo] カウント手修正（${business || "全体"}）→ 本日${effective.today}/今週${effective.week}/今月${effective.month} by ${req.user}`);

    // 直したことをGoogle Chatに通知する（アポ割り振り通知がONのときだけ）
    let chat = "";
    try {
      const st2 = await getSettings().catch(() => ({}));
      if (st2.chatNotifyAssign !== false) {
        const bizLabel = business ? `【${business}】` : "";
        await notifyChat(
          `✏️ アポのカウントを直しました${bizLabel}\n` +
          `📊 本日 ${effective.today} ／ 今週 ${effective.week} ／ 今月 ${effective.month}`
        );
        chat = "チャットに通知しました";
      }
    } catch (e) { console.warn("[apo] カウント修正の通知に失敗", e.message); }

    res.json({ ok: true, effective, chat });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/apo/dedupe", async (req, res) => {
  try {
    const dryRun = req.body?.confirm !== true;
    const r = await dedupeSmartLinksByEvent({ dryRun });
    if (!dryRun) console.log(`[apo] 重複したアポを ${r.remove}件 消しました by ${req.user}`);
    res.json({ ok: true, dryRun, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 複数のアポを、まとめて集計から外す。テストで作ったものを一度に片付けるため。
app.put("/api/smart-links/excluded-many", async (req, res) => {
  try {
    const slugs = (Array.isArray(req.body?.slugs) ? req.body.slugs : [])
      .map((x) => String(x || "").trim()).filter(Boolean).slice(0, 500);
    if (!slugs.length) return res.status(400).json({ error: "対象がありません" });
    const on = req.body?.excluded !== false;
    const n = await setApoExcludedMany(slugs, on);
    console.log(`[apo] ${n}件を集計から${on ? "外しました" : "戻しました"} by ${req.user}`);
    res.json({ ok: true, count: n });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// テストで作ったアポを、件数の集計から外す／戻す。
// 予定もアポ自体も残したまま、実績・均等化・通知の数からだけ除く。
app.put("/api/smart-links/:slug/excluded", async (req, res) => {
  try {
    const slug = String(req.params.slug || "");
    const on = req.body?.excluded !== false;
    const link = await getSmartLink(slug);
    if (!link) return res.status(404).json({ error: "見つかりませんでした" });

    const row = await setApoExcluded(slug, on);
    if (!row) return res.status(404).json({ error: "見つかりませんでした" });

    // 集計から外すときは、担当者のカレンダーに作った商談予定も消す。
    // テストのために作った予定を残しておく理由がないため。
    let calendar = "";
    if (on && link.invite_event_id) {
      const owner = link.invite_event_owner ||
        (await getSettings().catch(() => ({}))).apoInviteOwner || "";
      if (!owner) {
        calendar = "予定は残っています（どのカレンダーに作られたか分かりません）";
      } else {
        try {
          await deleteCalendarEvent(owner, link.invite_event_id, "primary");
          await setSmartLinkInviteEvent(slug, null, null);
          calendar = "カレンダーの予定も消しました";
          console.log(`[apo] ${slug} の予定を削除（${owner}）`);
        } catch (e) {
          // すでに手で消されている場合は消えたものとして扱う
          if (/40[04]/.test(e.message)) {
            await setSmartLinkInviteEvent(slug, null, null);
            calendar = "カレンダーの予定はすでにありませんでした";
          } else {
            calendar = `予定を消せませんでした（${String(e.message).slice(0, 80)}）`;
            console.warn("[apo] 予定の削除に失敗", slug, e.message);
          }
        }
      }
    }

    console.log(`[apo] ${row.slug}（${row.label || "-"}）を集計から${on ? "外しました" : "戻しました"} by ${req.user}`);

    // 集計から外したときは、Google Chatに「取り消し」と今の正しい合計を流す。
    let chat = "";
    if (on) {
      try {
        const st = await getSettings().catch(() => ({}));
        if (st.chatNotifyAssign !== false) {
          const c = await assignCounts(link.business || "").catch(() => null);
          const who = link.current_owner_name || link.current_owner || "";
          const what = [link.label, link.client_name].filter(Boolean).join("／");
          const body =
            `↩️ アポを1件取り消しました` +
            (what ? `：${what}` : "") +
            (who ? `（${who}）` : "") +
            (c ? `\n📊 本日 ${c.today} ／ 今週 ${c.week} ／ 今月 ${c.month}` : "");
          await notifyChat(body);
          chat = "チャットに通知しました";
        }
      } catch (e) {
        console.warn("[apo] 取り消し通知に失敗", e.message);
      }
    }

    res.json({ ok: true, excluded: row.excluded, calendar, chat });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== Salesforceの自動立ち上げ =====
// 条件を満たしたものだけ実行する。コンバートは取り消せないため、
// 少しでも怪しいものは実行せず、理由を残してホームに出す。

// 商談の「入力必須なのに既定値が無い項目」を調べる。
// これがあると、リードをコンバートしても商談だけ作られない。
let _oppReqCache = { at: 0, list: null };
async function opportunityRequiredFields(owner) {
  if (_oppReqCache.list && Date.now() - _oppReqCache.at < 10 * 60 * 1000) return _oppReqCache.list;
  const list = [];
  try {
    const d = await describeOpportunity(owner);
    for (const f of d.fields || []) {
      if (!f.createable || f.nillable || f.defaultedOnCreate) continue;
      // コンバートで自動的に入る項目は除く
      if (["Name", "StageName", "CloseDate", "AccountId", "OwnerId", "RecordTypeId"].includes(f.name)) continue;
      list.push({ name: f.name, label: f.label });
    }
  } catch (e) { console.warn("[SF自動] 商談の項目を読めませんでした", e.message); }
  _oppReqCache = { at: Date.now(), list };
  if (list.length) {
    console.warn(`[SF自動] 商談に必須項目があります：${list.map((f) => f.label).join("、")}`);
  }
  return list;
}

// Salesforceを操作するアカウントを決める。
// 割り振られたクローザーがSF連携をしているとは限らないので、
// 連携できている人（運用者）で操作し、商談の所有者だけをクローザーにする。
async function sfOperator(prefer = "") {
  const cands = [];
  if (prefer && String(prefer).includes("@")) cands.push(prefer);
  try {
    const st = await getSettings();
    if (st.apoScanOwner) cands.push(st.apoScanOwner);
    if (st.apoInviteOwner) cands.push(st.apoInviteOwner);
  } catch {}
  for (const c of cands) {
    const ok = await sfConnected(c).catch(() => false);
    if (ok) return c;
  }
  return "";
}

// URLが空のときは gBizINFO で補う。見つからなければ空のまま。
async function fillLeadWebsite(user, lead, company) {
  if (lead.Website) return { url: lead.Website, filled: false };
  try {
    const hits = await searchCompanies(company || lead.Company, 3);
    for (const h of hits) {
      const d = await getCompanyDetail(h.corporate_number).catch(() => null);
      const url = d && d.company_url;
      if (url && /^https?:\/\//i.test(url)) {
        await updateLead(user, lead.Id, { Website: url });
        console.log(`[SF自動] URLを補いました ${lead.Company} → ${url}`);
        return { url, filled: true };
      }
    }
  } catch (e) { console.warn("[SF自動] URLの補完に失敗", e.message); }
  return { url: "", filled: false };
}

// 1件を判定して、通れば立ち上げる
// user      … Salesforceを操作するアカウント（SF連携ができている人）
// ownerEmail… 商談の所有者にしたい人（＝アポを割り振られたクローザー）
async function tryAutoLaunch(user, link, { dryRun = false, ownerEmail = "" } = {}) {
  const base = { slug: link.slug, botId: link.bot_id || null, title: link.label };
  try {
    // すでに立ち上げ済みなら触らない
    const prev = await getAutolaunch(link.slug);
    if (prev && prev.ok && prev.opp_id) {
      return { ...base, ok: true, reason: "already", oppId: prev.opp_id, skipped: true };
    }

    const { company, person } = parseLaunchTitle(link.label);
    if (!company || !person) {
      const r = { ...base, ok: false, company, person, reason: company ? "no_person" : "no_company" };
      if (!dryRun) await saveAutolaunch(r);
      return r;
    }

    const leads = await searchLeads(user, { company, person: "" }).catch(() => []);
    const j = judgeAutolaunch({ title: link.label, leads });
    if (!j.ok) {
      const r = { ...base, ok: false, company: j.company, person: j.person, reason: j.reason, detail: j.detail || "" };
      if (!dryRun) await saveAutolaunch(r);
      return r;
    }

    // URLの補完
    const site = await fillLeadWebsite(user, j.lead, j.company);
    if (!site.url) {
      const r = { ...base, ok: false, company: j.company, person: j.person,
                  reason: "missing_url", leadId: j.lead.Id };
      if (!dryRun) await saveAutolaunch(r);
      return r;
    }

    if (dryRun) {
      // 実際に立ち上げる前に、所有者にできる人かどうかも見ておく
      const want = String(ownerEmail || link.current_owner || "").trim();
      if (want) {
        const id = await sfUserIdByEmail(user, want).catch(() => "");
        if (!id) {
          const r = { ...base, ok: false, company: j.company, person: j.person,
                      reason: "no_sf_user", detail: want, leadId: j.lead.Id };
          return r;
        }
      }
      return { ...base, ok: true, company: j.company, person: j.person,
               leadId: j.lead.Id, filledUrl: site.filled ? site.url : "", dryRun: true };
    }

    // 商談が作られない原因の多くは、商談側の必須項目が空なこと。
    // 実行前に確かめて、当てはまるなら立ち上げずに理由を出す。
    try {
      const need = await opportunityRequiredFields(user);
      if (need.length) {
        const r = { ...base, ok: false, company: j.company, person: j.person,
                    reason: "opp_required", detail: need.map((f) => f.label).join("、"),
                    leadId: j.lead.Id };
        if (!dryRun) await saveAutolaunch(r);
        return r;
      }
    } catch {}

    // 商談の所有者は、割り振られた担当者にする。
    // その人がkinbotでSF連携をしていなくてよいように、メールからSFのユーザーを引く。
    const wantOwner = String(ownerEmail || link.current_owner || "").trim();
    let ownerId = "";
    if (wantOwner) {
      ownerId = await sfUserIdByEmail(user, wantOwner).catch(() => "");
      if (!ownerId) {
        const r = { ...base, ok: false, company: j.company, person: j.person,
                    reason: "no_sf_user", detail: wantOwner, leadId: j.lead.Id };
        if (!dryRun) await saveAutolaunch(r);
        return r;
      }
    } else {
      // 割り振り先が分からないときは、操作しているアカウントを所有者にする
      ownerId = await getSfUserId(user).catch(() => "");
    }

    // コンバートの前に「アポ獲得日」を入れておく。
    // 空のままだと「取引開始済にするには『アポ獲得日』の入力が必要です」で弾かれる。
    // 入れる日付は、このアポを取った日（＝Chatに流れた日）。すでに値があれば触らない。
    let apoDate = null;
    try {
      const jst = (v) => new Date(new Date(v).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      const at = link.apo_at || link.created_at || new Date();
      apoDate = jst(at);
      const rr = await ensureLeadApoDate(user, j.lead.Id, apoDate);
      if (rr && rr.filled) console.log(`[SF立ち上げ] アポ獲得日を入れました ${j.company} → ${apoDate}`);
      // 初回訪問予定日＝この商談の日
      if (link.start_time) {
        const visit = jst(link.start_time);
        const rv = await ensureLeadVisitDate(user, j.lead.Id, visit);
        if (rv && rv.filled) console.log(`[SF立ち上げ] 初回訪問予定日を入れました ${j.company} → ${visit}`);
      }
    } catch (e) {
      console.warn("[SF立ち上げ] アポ獲得日を入れられませんでした:", e.message);
    }

    // 主キャンペーンソース・FSへの案件パス情報も、空ならここで入れる
    // （どちらもコンバートの必須項目。空だと弾かれる）
    try {
      const stc = await getSettings().catch(() => ({}));
      const cs = String(stc.sfCampaignSource === undefined ? DEFAULT_CAMPAIGN_SOURCE : stc.sfCampaignSource).trim();
      if (cs) {
        const rc = await ensureLeadCampaignSource(user, j.lead.Id, cs);
        if (rc && rc.filled) console.log(`[SF立ち上げ] 主キャンペーンソースを入れました ${j.company} → ${cs}`);
        else if (rc && !rc.ok && rc.reason) console.warn(`[SF立ち上げ] 主キャンペーンソース: ${rc.reason}`);
      }
      const fs = String(stc.sfFsNote === undefined ? DEFAULT_FS_NOTE : stc.sfFsNote).trim();
      if (fs) {
        const rf = await ensureLeadFsNote(user, j.lead.Id, fs);
        if (rf && rf.filled) console.log(`[SF立ち上げ] FSへの案件パス情報を入れました ${j.company} → ${fs}`);
        else if (rf && !rf.ok && rf.reason) console.warn(`[SF立ち上げ] FSへの案件パス情報: ${rf.reason}`);
      }
    } catch (e) {
      console.warn("[SF立ち上げ] 必須項目を入れられませんでした:", e.message);
    }

    // ここから先は取り消せない
    const statuses = await convertedLeadStatuses(user).catch(() => []);
    const convArgs = {
      leadId: j.lead.Id,
      convertedStatus: (statuses[0] || {}).value || "",
      opportunityName: `${j.company}_${j.person}`,
      ownerId,
    };
    let conv = null;
    try {
      conv = await convertLead(user, convArgs);
    } catch (e) {
      // 重複ルールで止められた場合は、そのまま通して新しく取引先と担当者を作る。
      // 既存の取引先に紐づけるには、その取引先への編集権限が要る。
      // 権限が無いと結局失敗するので、こちらのほうが確実に立ち上がる。
      if (!e.duplicate) throw e;
      console.log(`[SF自動] 重複と判定されましたが、新しく取引先と担当者を作ります（${j.company}）`);
      conv = await convertLead(user, { ...convArgs, allowDuplicate: true });
    }
    const oppId = (conv && (conv.opportunityId || conv.opportunity_id)) || "";

    // 「立ち上げました」と言う前に、Salesforceに商談ができているか必ず確かめる。
    // ここを確かめないと、実際には立ち上がっていないのに成功と伝えてしまう。
    const clean = (v) => String(v || "").replace(/[^a-zA-Z0-9]/g, "");
    let verified = null;
    if (oppId) {
      try {
        const d = await sfQuery(user,
          `SELECT Id, Name, StageName, OwnerId, Owner.Name FROM Opportunity WHERE Id = '${clean(oppId)}'`);
        verified = d?.records?.[0] || null;
      } catch (e) {
        console.warn("[SF自動] 商談の確認に失敗", e.message);
      }
    }
    // 商談IDが返らないことがあるので、できた取引先から探し直す。
    // コンバート自体は通っているので、商談は作られている可能性が高い。
    if (!verified && conv && conv.accountId) {
      try {
        const d = await sfQuery(user,
          `SELECT Id, Name, StageName, OwnerId, Owner.Name FROM Opportunity ` +
          `WHERE AccountId = '${clean(conv.accountId)}' ORDER BY CreatedDate DESC LIMIT 1`);
        verified = d?.records?.[0] || null;
        if (verified) console.log(`[SF自動] 商談IDは返りませんでしたが、取引先から見つけました（${verified.Id}）`);
      } catch {}
    }
    if (!verified) {
      const r = { ...base, ok: false, company: j.company, person: j.person,
                  reason: "not_created",
                  detail: oppId ? `商談ID ${oppId} を確認できませんでした`
                    : (conv && conv.accountId ? `取引先 ${conv.accountId} はできましたが、商談が見つかりません` : "商談IDが返りませんでした"),
                  leadId: j.lead.Id, oppId };
      await saveAutolaunch(r);
      console.error(`[SF自動] 立ち上げたはずが確認できません ${j.company}／${j.person}（商談ID ${oppId || "なし"}）`);
      return r;
    }

    const r = { ...base, ok: true, company: j.company, person: j.person,
                reason: "", leadId: j.lead.Id, oppId: verified.Id, oppName: verified.Name || "",
                stage: verified.StageName || "", filledUrl: site.filled ? site.url : "" };
    await saveAutolaunch(r);
    console.log(`[SF自動] 立ち上げ完了 ${j.company}／${j.person} → ${oppId}`);
    notifyAll([
      "🚀 *SFの商談を自動で立ち上げました*",
      `　${verified.Name || `${j.company}_${j.person}`}`,
      `　${verified.StageName || ""}${verified.Owner && verified.Owner.Name ? " ・ " + verified.Owner.Name : ""}`,
      site.filled ? "🔗 URLも補いました" : "",
    ].filter(Boolean).join("\n"), "launch").catch(() => {});
    return r;
  } catch (e) {
    const r = { ...base, ok: false, reason: "sf_error", detail: String(e.message || "").slice(0, 200) };
    if (!dryRun) await saveAutolaunch(r);
    console.error("[SF自動] 失敗", link.slug, e.message);
    return r;
  }
}

// 自動で立ち上げられなかったアポの一覧。
// 通知を1件ずつ追わなくても、ここを見れば残っているものが分かる。
app.get("/api/sf-autolaunch/pending", async (req, res) => {
  try {
    const rows = await pendingAutolaunch({ includeDone: req.query.all === "1" });
    const name = {};
    for (const r of rows) {
      const e = r.current_owner;
      if (e && !name[e]) name[e] = await displayNameOf(e).catch(() => e);
    }
    res.json({
      items: rows.map((r) => ({
        slug: r.slug, title: r.title || "", company: r.company || "", person: r.person || "",
        ok: r.ok, reason: r.reason || "", reasonText: r.ok ? "" : reasonText(r.reason, r.detail),
        oppId: r.opp_id || "", leadId: r.lead_id || "",
        start: r.start_time, owner: name[r.current_owner] || r.current_owner || "",
        business: r.business || "", triedAt: r.tried_at,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 一覧から、もう一度立ち上げてみる
app.post("/api/sf-autolaunch/retry", async (req, res) => {
  try {
    const slug = String(req.body?.slug || "");
    const link = await getSmartLink(slug);
    if (!link) return res.status(404).json({ error: "商談が見つかりません" });
    const op = await sfOperator(req.user);
    if (!op) return res.status(400).json({ error: "Salesforceにつながっているアカウントがありません" });
    const r = await tryAutoLaunch(op, link, { ownerEmail: link.current_owner });
    res.json({ ...r, reasonText: r.ok ? "" : reasonText(r.reason, r.detail) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// なぜ商談が立ち上がらないのかを調べる。
// リードをコンバートしても商談ができない原因は、たいてい組織の設定にある。
app.get("/api/sf-autolaunch/diagnose", async (req, res) => {
  const steps = [];
  const push = (name, ok, detail, hint) => steps.push({ name, ok, detail: String(detail || ""), hint: hint || "" });
  try {
    const op = await sfOperator(req.user);
    if (!op) {
      push("Salesforceの接続", false, "つながっているアカウントがありません");
      return res.json({ ok: false, steps });
    }
    push("Salesforceの接続", true, op);

    // 1. コンバート後の状況（この値が「商談を作らない」設定だと、商談ができない）
    try {
      const list = await convertedLeadStatuses(op);
      const first = list[0] || {};
      push("コンバート後のリード状況", !!first.value,
        list.map((x) => x.value).join("、") || "取得できませんでした",
        first.value ? "" : "「変換済み」にあたる状況がありません。Salesforceのリード状況の設定をご確認ください。");
    } catch (e) { push("コンバート後のリード状況", false, e.message); }

    // 2. 商談の必須項目（入力必須の項目があると、コンバート時に商談だけ作られないことがある）
    try {
      const d = await describeOpportunity(op);
      const required = (d.fields || []).filter((f) =>
        f.createable && !f.nillable && !f.defaultedOnCreate &&
        !["Name", "StageName", "CloseDate", "AccountId"].includes(f.name));
      push("商談の必須項目", required.length === 0,
        required.length ? required.map((f) => `${f.label}（${f.name}）`).join("、") : "標準の項目だけです",
        required.length
          ? "これらが空だと商談が作られません。既定値を設定するか、必須を外してください。"
          : "");
    } catch (e) { push("商談の必須項目", false, e.message); }

    // 3. 直近の自動立ち上げの結果
    try {
      const rows = await listAutolaunch(10);
      const ng = rows.filter((r) => !r.ok);
      push("直近の自動立ち上げ", ng.length === 0,
        `${rows.length}件中 ${rows.length - ng.length}件が成功`,
        ng.length ? ng.slice(0, 3).map((r) => `${r.company}：${reasonText(r.reason, r.detail)}`).join(" ／ ") : "");
    } catch (e) { push("直近の自動立ち上げ", false, e.message); }

    res.json({ ok: steps.every((x) => x.ok), steps });
  } catch (e) { res.status(500).json({ error: e.message, steps }); }
});

// 判定だけしてみる（実行しない）
app.post("/api/sf-autolaunch/check", async (req, res) => {
  try {
    const link = await getSmartLink(String(req.body?.slug || ""));
    if (!link) return res.status(404).json({ error: "商談が見つかりません" });
    const op = await sfOperator(req.user);
    if (!op) return res.status(400).json({ error: "Salesforceにつながっているアカウントがありません" });
    const r = await tryAutoLaunch(op, link, { dryRun: true, ownerEmail: link.current_owner });
    res.json({ ...r, reasonText: r.ok ? "" : reasonText(r.reason, r.detail) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 1件を実行する
app.post("/api/sf-autolaunch/run", async (req, res) => {
  try {
    const link = await getSmartLink(String(req.body?.slug || ""));
    if (!link) return res.status(404).json({ error: "商談が見つかりません" });
    const op = await sfOperator(req.user);
    if (!op) return res.status(400).json({ error: "Salesforceにつながっているアカウントがありません" });
    const r = await tryAutoLaunch(op, link, { ownerEmail: link.current_owner });
    res.json({ ...r, reasonText: r.ok ? "" : reasonText(r.reason, r.detail) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// その日のぶんをまとめて実行する
app.post("/api/sf-autolaunch/run-day", async (req, res) => {
  try {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.date || ""))
      ? String(req.body.date)
      : new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const owner = String(req.body?.owner || req.user || "").toLowerCase();
    const op = await sfOperator(req.user);
    if (!op) return res.status(400).json({ error: "Salesforceにつながっているアカウントがありません" });
    const rows = await myAssignedApos(owner, d, "day");
    const out = [];
    for (const link of rows) {
      const r = await tryAutoLaunch(op, link, { ownerEmail: link.current_owner });
      out.push({ slug: link.slug, title: link.label, ok: r.ok,
                 reasonText: r.ok ? "" : reasonText(r.reason, r.detail) });
    }
    const done = out.filter((x) => x.ok).length;
    console.log(`[SF自動] ${d} のぶんを実行：${done}/${out.length}件`);
    res.json({ ok: true, date: d, total: out.length, done, results: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 送った資料の閲覧トラッキング =====
// ここから4つは、受け取った相手が開くため認証なしで動く。

// 資料のビューアー
// kincall（架電ツール）の入り口。
// インターン生はここだけを使うので、短いURLで開けるようにする。
app.get("/kincall", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "calls.html"));
});

// 日程調整ページ（お客様が開くURL）
app.get("/b/:slug", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "book.html"));
});

app.get("/d/:slug", async (req, res) => {
  const link = await getDocLink(String(req.params.slug || ""));
  if (!link) return res.status(404).send("この資料は見つかりませんでした。送り主にご確認ください。");
  // 期限を過ぎていたら開けない（画面ではなくここで止める）
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return res.status(410).send("この資料は公開期間が終了しました。お手数ですが、送り主にご連絡ください。");
  }
  res.sendFile("doc.html", { root: path.join(__dirname, "..", "public") });
});

// メルマガの差し込みタグから、開いた人の情報を取り出す。
//
// 配信システムによって書き方が違うので、よくある形をまとめて受ける。
//   ?m=  ?email=  ?e=  … メールアドレス
//   ?n=  ?name=        … 名前
// 差し込みが働かなかったとき（{{email}} のまま届いたとき）は、無かったことにする。
function viewerFromQuery(q) {
  const pick = (...keys) => {
    for (const k of keys) {
      const v = String((q && q[k]) || "").trim();
      if (!v) continue;
      // 置き換えられていない差し込みタグは使わない
      if (/[{}%\[\]|*]/.test(v)) continue;
      return v;
    }
    return "";
  };
  const email = pick("m", "email", "e", "mail", "addr");
  const name = pick("n", "name", "company", "co");
  return {
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "",
    name: name.slice(0, 80),
  };
}

// ビューアーが最初に呼ぶ。閲覧を1件つくり、資料の情報を返す。
app.post("/api/doc/:slug/open", async (req, res) => {
  try {
    // 先に、期限・合言葉・お名前確認をみる
    const link0 = await getDocLink(String(req.params.slug || ""));
    if (!link0) return res.status(404).json({ error: "この資料は見つかりませんでした" });
    if (link0.expires_at && new Date(link0.expires_at).getTime() < Date.now()) {
      return res.status(410).json({ error: "この資料は公開期間が終了しました", 期限切れ: true });
    }
    const b0 = req.body || {};
    if (link0.pass_hash) {
      const pw = String(b0.pass || "");
      if (!pw) return res.status(401).json({ error: "合言葉を入れてください", 合言葉が必要: true });
      if (!checkPass(pw, link0.pass_hash)) {
        return res.status(401).json({ error: "合言葉がちがいます", 合言葉が必要: true });
      }
    }
    if (link0.ask_name) {
      const nm = String(b0.viewerName || "").trim();
      const em = String(b0.viewerEmail || "").trim();
      if (!nm || !em) return res.status(401).json({ error: "お名前とメールを入れてください", お名前が必要: true });
    }

    const r = await openDocView(String(req.params.slug || ""), req);
    if (r.error) return res.status(404).json({ error: r.error });

    // 名乗ってもらった内容を控える
    if (link0.ask_name && r.view) {
      await setViewerIdentity(r.view.id, b0.viewerName, b0.viewerEmail).catch(() => {});
    }

    // 共通URL（メルマガ用）のときは、URLの後ろから開いた人を受け取る
    let viewer = null;
    if (r.link.shared_link && r.view) {
      const q = { ...(req.query || {}), ...(req.body || {}) };
      const v = viewerFromQuery(q);
      if (v.email || v.name) {
        await setViewerInfo(r.view.id, v).catch(() => {});
        viewer = v;
      }
    }

    res.json({
      ok: true, viewId: r.view ? r.view.id : null,
      name: fixMojibake(r.link.doc_name), filename: fixMojibake(r.link.filename || ""),
      to: r.link.shared_link
        ? (viewer && (viewer.name || viewer.email)) || ""
        : [r.link.company, r.link.contact].filter(Boolean).join(" "),
      共通URL: !!r.link.shared_link,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 共通URLを、誰が開いたかの一覧
app.get("/api/doc-links/:id/viewers", async (req, res) => {
  try {
    const rows = await listSharedViewers(parseInt(req.params.id, 10));
    res.json({
      ok: true,
      人数: rows.length,
      items: rows.map((r) => ({
        相手: r["相手"],
        名前: r["名前"] || "",
        回数: Number(r["回数"] || 0),
        秒: Number(r["秒"] || 0),
        到達: Number(r["到達"] || 0),
        最後: r["最後"],
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// メルマガ用の共通URLを1本用意する（すでにあれば使い回す）
app.post("/api/doc-links/shared", async (req, res) => {
  try {
    const docId = parseInt(req.body?.docId, 10);
    if (!docId) return res.status(400).json({ error: "資料を選んでください" });
    const link = await getOrCreateSharedLink(docId, req.user);
    if (!link) {
      // なぜ作れなかったのかを添える（黙って失敗すると原因が追えないため）
      return res.status(500).json({
        error: "共通URLを作れませんでした。データベースにつながっていないか、" +
               "資料が見つかりません（サーバーのログをご確認ください）",
      });
    }
    const base = String(PUBLIC_URL || "").replace(/\/+$/, "");
    res.json({
      ok: true,
      slug: link.slug,
      linkId: link.id,
      url: `${base}/d/${link.slug}`,
      // 配信システムごとの貼り方（そのままコピーして使える形）
      // Pardot（Salesforce Account Engagement）を使っているので、先頭に置く。
      // 会社名も一緒に送ると、一覧が読みやすくなる。
      貼り方: {
        "Pardot（おすすめ）": `${base}/d/${link.slug}?m=%%email%%&n=%%account_name%%`,
        "Pardot（アドレスだけ）": `${base}/d/${link.slug}?m=%%email%%`,
        "HubSpot": `${base}/d/${link.slug}?m={{ contact.email }}`,
        "Mailchimp": `${base}/d/${link.slug}?m=*|EMAIL|*`,
        "差し込みを使わない場合（誰が見たかは分かりません）": `${base}/d/${link.slug}`,
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 資料の中身（PDF）を返す。
// ?dl=1 が付いているときは「ダウンロード」として記録し、Chatにも知らせる。
app.get("/api/doc/:slug/file", async (req, res) => {
  try {
    const slug = String(req.params.slug || "");
    const link = await getDocLink(slug);
    if (!link) return res.status(404).send("見つかりません");
    const f = await getDocBytes(link.doc_id);
    if (!f || !f.bytes) return res.status(404).send("資料がありません");
    const isDl = String(req.query.dl || "") === "1";
    if (isDl) { try { await recordDownload(slug, req); } catch {} }
    res.setHeader("content-type", f.mime || "application/pdf");
    res.setHeader("cache-control", "private, max-age=600");
    res.setHeader("content-disposition",
      `${isDl ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fixMojibake(f.filename) || "document.pdf")}`);
    res.send(f.bytes);
  } catch (e) { res.status(500).send("読み込めませんでした"); }
});

// 数秒おきの進捗。しきい値を超えたらChatへ通知する。
app.post("/api/doc/:slug/beat", async (req, res) => {
  try {
    const r = await beatDocViewAndNotify(
      String(req.params.slug || ""), parseInt(req.body?.viewId, 10), req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 開封計測の画像。1×1の透明PNGを返す。
app.get("/px/:file", async (req, res) => {
  const slug = String(req.params.file || "").replace(/\.png$/i, "");
  try { await recordOpen(slug, req); } catch {}
  res.setHeader("content-type", "image/png");
  res.setHeader("cache-control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("pragma", "no-cache");
  res.send(PIXEL);
});

// リンクのクリック計測。記録してから本来のURLへ送る。
app.get("/c/:slug", async (req, res) => {
  const target = String(req.query.u || "");
  try { await recordClick(String(req.params.slug || ""), target, req); } catch {}
  if (!/^https?:\/\//i.test(target)) return res.status(400).send("行き先が正しくありません");
  res.redirect(target);
});

// ===== ここから下は社内向け（認証あり） =====

// 資料の一覧。
// 既定は「自分が入れたもの＋チームに共有されているもの」。
// ?all=1 を付けると全部（誰の資料がいくつあるか見たいとき）。
app.get("/api/docs", async (req, res) => {
  try {
    const all = String(req.query.all || "") === "1";
    const rows = await listDocFiles({ owner: req.user, all });
    // すでに文字化けして保存されているものも、表示のときに直す
    const docs = rows.map((d) => ({
      ...d,
      name: fixMojibake(d.name),
      filename: fixMojibake(d.filename),
      mine: String(d.uploaded_by || "").toLowerCase() === String(req.user || "").toLowerCase(),
    }));
    res.json({ docs, base: PUBLIC_URL, me: req.user || "" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 資料を「自分だけ」「チームに共有」で切り替える
app.patch("/api/docs/:id/shared", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const rows = await listDocFiles({ all: true });
    const doc = rows.find((d) => d.id === id);
    if (!doc) return res.status(404).json({ error: "見つかりません" });
    // 入れた本人だけが切り替えられる（他の人の資料を勝手に隠さないため）
    const mine = String(doc.uploaded_by || "").toLowerCase() === String(req.user || "").toLowerCase();
    if (!mine && doc.uploaded_by) {
      return res.status(403).json({ error: "この資料を入れた人だけが切り替えられます" });
    }
    const r = await setDocShared(id, req.body?.shared === true);
    console.log(`[資料] ${doc.name} を${r && r.shared ? "チームに共有" : "自分だけ"}にしました by ${req.user}`);
    res.json({ ok: true, item: r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 資料をアップロードする。
// 受け口はここで作る（あとの行で定義している kbUpload を先に使うと起動時に落ちるため）。
const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
app.post("/api/docs", docUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "ファイルを選んでください" });
    if (req.file.size > 25 * 1024 * 1024) {
      return res.status(400).json({ error: "25MBを超えています。PDFを軽くしてからお試しください。" });
    }
    const mime = req.file.mimetype || "application/pdf";
    if (!/pdf/i.test(mime)) return res.status(400).json({ error: "PDFを選んでください" });
    const row = await addDocFile({
      // ファイル名はlatin1として届くので、UTF-8に直してから保存する
      name: fixMojibake(String(req.body?.name || "").trim()) || fixMojibake(req.file.originalname),
      filename: fixMojibake(req.file.originalname), mime, buf: req.file.buffer, uploadedBy: req.user,
    });
    if (!row) return res.status(500).json({ error: "保存できませんでした" });
    console.log(`[doc] 資料を追加「${row.name}」${Math.round(row.size / 1024)}KB by ${req.user}`);
    res.json({ ok: true, doc: row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 資料の名前を変える（文字化けしていたものを直すときにも使う）
app.put("/api/docs/:id/name", async (req, res) => {
  try {
    const name = fixMojibake(String(req.body?.name || "").trim());
    if (!name) return res.status(400).json({ error: "名前を入れてください" });
    await renameDocFile(parseInt(req.params.id, 10), name);
    res.json({ ok: true, name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/docs/:id", async (req, res) => {
  try {
    await setDocActive(parseInt(req.params.id, 10), req.body?.active !== false);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/docs/:id", async (req, res) => {
  try {
    await deleteDocFile(parseInt(req.params.id, 10));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 宛先ごとのURLをまとめて発行する（200社分をCSVの貼り付けで作れる）
// 御礼メールの画面から、この会社向けの資料URLをその場で発行する。
// 資料トラッキングの画面まで行かずに済むようにする。
app.post("/api/meetings/:id/doc-link", async (req, res) => {
  try {
    const m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "商談が見つかりません" });
    const docId = parseInt(req.body?.docId, 10);
    if (!docId) return res.status(400).json({ error: "資料を選んでください" });

    const company = String(req.body?.company || m.company || m.title || "")
      .replace(/【[^】]*】/g, "").split(/[／\/|]/)[0].trim();
    const contact = String(req.body?.contact || "").trim();
    const email = String(req.body?.email || m.client_email || "").trim();

    const made = await addDocLinks(docId, [{ company, contact, email }], req.user);
    const base = String(process.env.PUBLIC_URL || "").replace(/\/+$/, "");
    const links = (made || []).map((l) => ({ slug: l.slug, url: `${base}/d/${l.slug}` }));
    console.log(`[doc] ${company} 向けにリンクを発行 by ${req.user}`);
    res.json({ ok: true, links });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 御礼メールを開いたときに、この会社あての資料URLを用意する。
// すでにあればそれを返し、無ければ資料を1つ選んで発行する。
// （文面に {資料URL} を入れても、リンクが無ければ差し込めないため）
app.post("/api/meetings/:id/doc-link/ensure", async (req, res) => {
  try {
    const m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "商談が見つかりません" });
    const company = String(m.company || m.account || m.title || "")
      .replace(/【[^】]*】/g, "").split(/[／\/|]/)[0].trim();
    const base = String(process.env.PUBLIC_URL || "").replace(/\/+$/, "");

    const have = await docLinksForCompany(company, 5).catch(() => []);
    if (have.length) {
      return res.json({
        ok: true, created: false, company,
        links: have.map((d) => ({ name: fixMojibake(d.doc_name), url: `${base}/d/${d.slug}` })),
      });
    }

    // どの資料にするか。指定が無ければ、いちばん新しく登録された資料を使う。
    const docs = await listDocFiles({ owner: req.user }).catch(() => []);
    if (!docs.length) {
      return res.json({ ok: true, created: false, company, links: [], reason: "登録されている資料がありません" });
    }
    const wantId = parseInt(req.body?.docId, 10);
    const doc = docs.find((d) => d.id === wantId) || docs[0];

    const email = String(m.client_email || "").trim() ||
      ((await clientEmailForCompany(company).catch(() => null)) || {}).email || "";
    const made = await addDocLinks(doc.id, [{ company, contact: "", email }], req.user);
    const links = (made || []).map((l) => ({ name: fixMojibake(doc.name), url: `${base}/d/${l.slug}` }));
    console.log(`[doc] ${company} 向けにリンクを自動発行（${doc.name}） by ${req.user}`);
    res.json({ ok: true, created: true, company, docName: fixMojibake(doc.name), links });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 会社名から、Salesforceで担当者とメールを探して埋める
app.post("/api/doc-links/lookup", async (req, res) => {
  try {
    const names = (Array.isArray(req.body?.names) ? req.body.names : [])
      .map((x) => String(x || "").trim()).filter(Boolean).slice(0, 60);
    if (!names.length) return res.json({ ok: true, items: [] });

    // 自分がつながっていなければ、代わりに更新する人の連携を使う
    let owner = req.user;
    if (!(await sfConnected(owner).catch(() => false))) {
      const st = await getSettings().catch(() => ({}));
      const 代理 = String(st.sfProxyUser || "").trim().toLowerCase();
      if (代理 && (await sfConnected(代理).catch(() => false))) owner = 代理;
    }
    if (!salesforceConfigured() || !(await sfConnected(owner).catch(() => false))) {
      return res.status(400).json({ error: "Salesforceにつながっていません" });
    }

    const sq = (v) => String(v || "").replace(/'/g, "\\'");
    const items = [];
    for (const name of names) {
      const key = normCompanyKey(name);
      const 語 = name.replace(/株式会社|（株）|\(株\)|㈱|有限会社|社会福祉法人|学校法人|一般社団法人|合同会社/g, "").trim().slice(0, 30);
      let 担当者 = "", メール = "", 元 = "";
      try {
        // まずリードから（担当者名とメールが揃っていることが多い）
        const d1 = await sfQuery(owner,
          `SELECT Id, Company, LastName, FirstName, Email FROM Lead
            WHERE IsConverted = false AND Company LIKE '%${sq(語)}%' LIMIT 30`);
        const l = (d1.records || []).filter((x) => normCompanyKey(x.Company) === key);
        const 良い = l.find((x) => x.Email) || l[0];
        if (良い) {
          担当者 = [良い.LastName, 良い.FirstName].filter(Boolean).join(" ").trim();
          メール = 良い.Email || "";
          元 = "リード";
        }
        // 見つからなければ取引先責任者から
        if (!メール) {
          const d2 = await sfQuery(owner,
            `SELECT Id, Name, Email, Account.Name FROM Contact
              WHERE Account.Name LIKE '%${sq(語)}%' LIMIT 30`);
          const c = (d2.records || []).filter((x) => normCompanyKey(x.Account && x.Account.Name) === key);
          const 良い2 = c.find((x) => x.Email) || c[0];
          if (良い2) {
            担当者 = 担当者 || String(良い2.Name || "").trim();
            メール = メール || 良い2.Email || "";
            元 = 元 || "取引先責任者";
          }
        }
      } catch (e) { /* 1件失敗しても続ける */ }
      items.push({ company: name, contact: 担当者, email: メール, 元 });
    }
    res.json({ ok: true, items, 見つかった: items.filter((x) => x.email || x.contact).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/doc-links", async (req, res) => {
  try {
    const docId = parseInt(req.body?.docId, 10);
    if (!docId) return res.status(400).json({ error: "資料を選んでください" });
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: "宛先がありません" });
    if (rows.length > 1000) return res.status(400).json({ error: "一度に発行できるのは1000件までです" });
    const b = req.body || {};
    // 期限："0"=なし／"7"や"30"=その日数後／日付そのものもOK
    let expiresAt = null;
    const ex = String(b.expiry || "0");
    if (/^\d{1,3}$/.test(ex) && ex !== "0") expiresAt = new Date(Date.now() + Number(ex) * 86400000);
    else if (/^\d{4}-\d{2}-\d{2}/.test(ex)) expiresAt = new Date(ex);
    const made = await addDocLinks(docId, rows, req.user, {
      expiresAt,
      pass: String(b.pass || "").trim() || null,
      askName: !!b.askName,
    });
    console.log(`[doc] リンクを${made.length}件発行 by ${req.user}`);
    res.json({
      ok: true,
      links: made.map((l) => ({
        ...l,
        url: docUrl(PUBLIC_URL, l.slug),
        pixel: pixelUrl(PUBLIC_URL, l.slug),
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────────────────────────────────────
// 名簿ファイルから、資料URLをまとめて発行する
//
// ① 下見（/api/doc-links/preview）… ファイルを読んで、何件・どの列かを返す
// ② 発行（/api/doc-links/bulk）  … 100件ずつ進める。進み具合は③で見る
// ③ 進み具合（/api/doc-links/bulk/:id）
// ───────────────────────────────────────────────────────────
const listUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ① 下見。まだ発行しない。
app.post("/api/doc-links/preview", listUpload.single("file"), async (req, res) => {
  try {
    let table = null, kind = "", sheetName = "", sheetCount = 0;
    if (req.file && req.file.buffer) {
      const r = tableFromFile(req.file.buffer, req.file.originalname || "");
      table = r.table; kind = r.kind; sheetName = r.sheetName; sheetCount = r.sheetCount;
    } else if (req.body && req.body.text) {
      const r = tableFromText(req.body.text);
      table = r.table; kind = r.kind;
    } else {
      return res.status(400).json({ error: "ファイルか、貼り付けた表がありません" });
    }
    const parsed = rowsFromTable(table);
    res.json({
      ok: true,
      種類: kind,
      シート: sheetName || "",
      シート数: sheetCount || 0,
      件数: parsed.items.length,
      列: parsed.列,
      見出しあり: parsed.見出しあり,
      飛ばした: parsed.飛ばした,
      // 最初の5件だけ見せる（間違った列を選んでいないか確かめる用）
      先頭: parsed.items.slice(0, 5),
      // 発行のときに送り返してもらう
      items: parsed.items,
    });
  } catch (e) {
    res.status(400).json({ error: `読み取れませんでした：${e.message}` });
  }
});

// ② 発行を始める。すぐに受付番号を返し、あとは裏で進める。
app.post("/api/doc-links/bulk", async (req, res) => {
  try {
    const docId = parseInt(req.body?.docId, 10);
    if (!docId) return res.status(400).json({ error: "資料を選んでください" });
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) return res.status(400).json({ error: "宛先がありません" });
    if (items.length > 20000) return res.status(400).json({ error: "一度に発行できるのは20000件までです" });

    const id = newJobId();
    const owner = req.user;
    await runBulk({
      id, docId, items, owner,
      addLinks: (part) => addDocLinks(docId, part, owner),
    });
    console.log(`[一括発行] 受け付けました：${items.length}件 by ${owner}`);
    res.json({ ok: true, id, total: items.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ③ 進み具合を返す
app.get("/api/doc-links/bulk/:id", (req, res) => {
  const j = getJob(req.params.id);
  if (!j) return res.status(404).json({ error: "その受付番号は見つかりません" });
  res.json({
    ok: true,
    状態: j.state === "running" ? "発行中" : j.state === "done" ? "終わりました" : "止めました",
    state: j.state,
    total: j.total,
    done: j.done,
    made: j.made,
    failed: j.failed,
    errors: j.errors,
    経過秒: Math.round(((j.finishedAt || Date.now()) - j.startedAt) / 1000),
  });
});

// 途中で止める
app.post("/api/doc-links/bulk/:id/cancel", (req, res) => {
  const ok = cancelJob(req.params.id);
  res.json({ ok, note: ok ? "止めます（ここまでのぶんは残ります）" : "すでに終わっています" });
});

// 発行したリンクと、その閲覧状況
app.get("/api/doc-links", async (req, res) => {
  try {
    const rows = await listDocLinks({
      docId: parseInt(req.query.docId, 10) || 0,
      onlyViewed: req.query.viewed === "1",
    });
    res.json({
      base: PUBLIC_URL,
      links: rows.map((r) => ({
        ...r,
        doc_name: fixMojibake(r.doc_name),
        url: docUrl(PUBLIC_URL, r.slug),
        pixel: pixelUrl(PUBLIC_URL, r.slug),
        total_label: fmtSeconds(r.total_seconds),
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 1件の詳しい記録
app.get("/api/doc-links/:slug", async (req, res) => {
  try {
    const d = await docLinkDetail(String(req.params.slug || ""));
    if (!d) return res.status(404).json({ error: "見つかりません" });
    res.json({
      link: { ...d.link, url: docUrl(PUBLIC_URL, d.link.slug), pixel: pixelUrl(PUBLIC_URL, d.link.slug) },
      views: d.views.map((v) => ({ ...v, seconds_label: fmtSeconds(v.seconds), top_pages: topPages(v.pages) })),
      events: d.events,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 発行したURLを消す。
//   ?mode=history … 閲覧の記録だけ消す（URLはそのまま使える）
//   ?mode=revoke  … URLを止めるが、記録は残す
//   指定なし       … URLも記録も、まとめて消す
app.delete("/api/doc-links/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "対象がありません" });
    const mode = String(req.query.mode || "");
    if (mode === "history") {
      const r = await clearDocLinkHistory(id);
      console.log(`[doc] 記録を消しました id=${id}（閲覧${r.views}件・開封等${r.events}件） by ${req.user}`);
      return res.json({ ok: true, mode, ...r });
    }
    if (mode === "revoke") {
      await revokeDocLink(id);
      console.log(`[doc] URLを止めました id=${id} by ${req.user}`);
      return res.json({ ok: true, mode });
    }
    const r = await deleteDocLink(id);
    console.log(`[doc] URLと記録を消しました id=${id} by ${req.user}`);
    res.json({ ok: true, mode: "delete", ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 次回アクション（やることリスト） =====
app.get("/api/next-actions", async (req, res) => {
  try {
    res.json({
      kinds: NEXT_ACTION_KINDS,
      items: await listNextActions({
        company: String(req.query.company || ""),
        botId: String(req.query.botId || ""),
        onlyOpen: req.query.open === "1",
      }),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/next-actions", async (req, res) => {
  try {
    const b = req.body || {};
    const kind = String(b.kind || "").trim();
    const content = String(b.content || "").trim();
    if (!kind) return res.status(400).json({ error: "種別を選んでください" });
    if (!content) return res.status(400).json({ error: "内容を入れてください" });
    if (b.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.dueDate))) {
      return res.status(400).json({ error: "期日の形式が正しくありません" });
    }
    const row = await addNextAction({
      botId: b.botId, company: b.company, title: b.title,
      kind, content, dueDate: b.dueDate || null, owner: req.user,
    });
    console.log(`[next-action] 追加 ${b.company || ""}／${kind} by ${req.user}`);
    res.json({ ok: true, row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// チェックで完了・未完了を切り替える
app.put("/api/next-actions/:id", async (req, res) => {
  try {
    const row = await setNextActionDone(parseInt(req.params.id, 10), req.body?.done !== false, req.user);
    if (!row) return res.status(404).json({ error: "見つかりませんでした" });
    res.json({ ok: true, row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/next-actions/:id", async (req, res) => {
  try {
    await deleteNextAction(parseInt(req.params.id, 10));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 利用状況をCSVで書き出す。
// Excelで開くことを前提に、日本語が化けないようBOMを付ける。
function toCsv(rows) {
  const esc = (v) => {
    const t = String(v == null ? "" : v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return rows.map((r) => r.map(esc).join(",")).join("\r\n");
}

app.get("/api/usage/summary.csv", async (req, res) => {
  try {
    const days = Math.max(1, Math.min(180, parseInt(req.query.days, 10) || 14));
    const owner = String(req.query.owner || "").trim();
    const d = await usageSummary(days, owner);
    if (!d) return res.status(400).send("記録がありません");

    const jst = (v) => {
      if (!v) return "";
      const t = new Date(v);
      return isNaN(t.getTime()) ? "" : new Date(t.getTime() + 9 * 3600 * 1000)
        .toISOString().replace("T", " ").slice(0, 16);
    };

    // 4つの表を、1つのファイルにまとめて入れる。
    // 別々に落とすより、見比べやすい。
    const rows = [];
    rows.push([`利用状況（直近${days}日）`]);
    rows.push([`書き出した日時`, jst(new Date())]);
    rows.push([`合計`, `${d.total.events}操作`, `${d.total.users}人`]);
    rows.push([]);

    rows.push(["日ごとの利用"]);
    rows.push(["日付", "操作数", "使った人数"]);
    for (const r of d.byDay || []) rows.push([r.day, r.events, r.users]);
    rows.push([]);

    rows.push(["画面ごとの利用"]);
    rows.push(["画面", "表示", "操作", "合計"]);
    for (const r of d.byPage || []) {
      rows.push([r.page || "(不明)", r.views, r.clicks, Number(r.views) + Number(r.clicks)]);
    }
    rows.push([]);

    rows.push(["よく使われた操作"]);
    rows.push(["画面", "操作", "回数"]);
    for (const r of d.topActions || []) rows.push([r.page || "", r.label || "", r.n]);
    rows.push([]);

    rows.push(["人ごとの利用"]);
    rows.push(["メンバー", "操作数", "使った日数", "最後に使った日時"]);
    for (const r of d.byUser || []) {
      rows.push([r.owner || "", r.events, r.days, jst(r.last_at)]);
    }

    const name = `kinbot_利用状況_${new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)}.csv`;
    res.setHeader("content-type", "text/csv; charset=utf-8");
    res.setHeader("content-disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(name)}`);
    // BOM を付けないと、Excelで開いたときに日本語が化ける
    res.send("\uFEFF" + toCsv(rows));
    console.log(`[利用状況] CSVを書き出しました（${days}日分）by ${req.user}`);
  } catch (e) { res.status(500).send(e.message); }
});

// ===== プロセスシートへの架電結果の書き込み =====
// SFのレポートから架電結果を取り、担当者ごと・日ごとに数えてシートの「実績」に入れる。

// レポートの列名から、必要な項目を見つける
function pickCol(columns, ...words) {
  const norm = (v) => String(v || "").replace(/[\s　_（）()]/g, "");
  for (const w of words) {
    const i = columns.findIndex((c) => norm(c.label).includes(norm(w)) || norm(c.name).includes(norm(w)));
    if (i >= 0) return i;
  }
  return -1;
}

// レポートの結果を、集計しやすい形にそろえる
function toRecords(report) {
  const cols = report.columns || [];
  const at = {
    date: pickCol(cols, "日付", "活動日", "作成日"),
    owner: pickCol(cols, "所有者", "担当者", "担当", "ユーザ", "割り当て", "作成者", "登録者"),
    subject: pickCol(cols, "件名", "表題", "タイトル"),
    called: pickCol(cols, "架電数", "架電"),
    contacted: pickCol(cols, "接触済", "接触"),
    appointed: pickCol(cols, "アポ獲得", "アポ"),
    meeting: pickCol(cols, "商談日", "初回訪問", "面談日"),
  };
  const missing = ["date", "called"].filter((k) => at[k] < 0);
  if (missing.length) {
    const label = { date: "日付", called: "架電数" };
    throw new Error(`レポートに「${missing.map((k) => label[k]).join("」「")}」の列が見つかりません`);
  }
  // 所有者の列が無いレポートもある（担当者でグループ化しているだけの場合など）。
  // その場合は件名から取り出す（「2026-08-04_電話_植野 ひかり」の形）。
  const fromSubject = (v) => {
    const t = String(v || "");
    const m = t.match(/^\d{4}[-/]\d{1,2}[-/]\d{1,2}_[^_]*_(.+)$/);
    if (m) return m[1].trim();
    const parts = t.split("_");
    return parts.length >= 3 ? parts[parts.length - 1].trim() : "";
  };
  if (at.owner < 0 && at.subject < 0) {
    throw new Error("レポートに担当者が分かる列（所有者・担当者・件名のいずれか）がありません");
  }
  return (report.rows || []).map((r) => ({
    date: r[at.date],
    owner: at.owner >= 0 ? r[at.owner] : fromSubject(r[at.subject]),
    called: r[at.called],
    contacted: at.contacted >= 0 ? r[at.contacted] : false,
    appointed: at.appointed >= 0 ? r[at.appointed] : false,
    meetingDate: at.meeting >= 0 ? r[at.meeting] : "",
  })).filter((x) => x.owner);
}

// ───────────────────────────────────────────────────────────
// コール進捗のお知らせ
//
// 11時から18時まで、1時間ごとにその日の実績をChatへ流す。
// 数はSFのレポート（コール・接触）と、kinbotのアポ記録から作る。
// 目標は、メンバーごとに設定した1日の目標を使う（未設定なら実績だけ出す）。
// ───────────────────────────────────────────────────────────
let lastCallReportKey = "";

async function buildCallReport(sfUser) {
  const st = await getSettings();
  const reportId = String(st.psReportId || "").trim();
  if (!reportId) return { skipped: true, reason: "SFのレポートが設定されていません" };

  let saved = null;
  try { saved = JSON.parse(st.psFilters || "null"); } catch {}
  const report = await runReport(sfUser, reportId, saved);
  const records = toRecords(report);

  const today = jstDate(0);
  const md = `${Number(today.slice(5, 7))}/${Number(today.slice(8, 10))}`;
  const tallied = tally(records, {});

  // その日に取ったアポ（kinbotの記録）
  const apos = await aposTakenInRange({ from: today, to: today }).catch(() => []);
  const apoBy = new Map();
  for (const a of apos) {
    const k = String(a.setter || "").trim();
    if (!k) continue;
    // 数えない人が取ったアポは外す（予備として割り振られたものは数える）
    if (isSkippedPerson(k) && !a.current_owner) continue;
    apoBy.set(k, (apoBy.get(k) || 0) + 1);
  }

  // 目標の出し方。
  //   sheet … プロセスシートの「目標」列から読む（既定）
  //   zero  … 目標は 0 として報告する（実績だけ見たいとき）
  const goalMode = String(st.callGoalMode || "sheet") === "zero" ? "zero" : "sheet";

  let goals = {};
  let goalFrom = "";
  if (goalMode === "zero") {
    goals = {};
    goalFrom = "";
  } else try {
    const sheetId = String(st.psSheetId || "").trim();
    const sheetName = String(st.psSheetName || "").trim();
    const owner = String(st.psOwner || sfUser || "").trim();
    if (sheetId && sheetName && owner) {
      const values = await readSheet(owner, sheetId, `${sheetName}!A1:DZ200`);
      const layout = readLayout(values);
      if (!layout.error) {
        goals = readGoals(values, layout, Number(today.slice(5, 7)), Number(today.slice(8, 10)));
        if (Object.keys(goals).length) goalFrom = "プロセスシート";
      }
    }
  } catch (e) {
    console.warn("[call-report] シートの目標を読めませんでした:", e.message);
  }
  if (goalMode === "sheet" && !Object.keys(goals).length) {
    try { goals = JSON.parse(st.callGoals || "{}") || {}; } catch {}
    if (Object.keys(goals).length) goalFrom = "設定に入れた目標";
  }
  const goalOf = (name) => {
    const n = String(name || "").replace(/[\s　]/g, "");
    for (const [k, v] of Object.entries(goals)) {
      const g = String(k).replace(/[\s　]/g, "");
      if (g === n || g.startsWith(n) || n.startsWith(g)) return v || {};
    }
    return {};
  };

  // 名前をそろえて、SFの実績とkinbotのアポを1つにまとめる
  // 数えない人（中澤・浦林など）は、コール進捗にも出さない
  const skip = await loadSkipInviters().catch(() => []);

  const rows = new Map();
  for (const [who, days] of Object.entries(tallied)) {
    const t = days[md];
    if (!t) continue;
    if (isSkippedPerson(who, skip)) continue;
    rows.set(who, { name: who, calls: t["コール"] || 0, contacts: t["接触"] || 0, apos: 0 });
  }
  for (const [who, n] of apoBy) {
    if (isSkippedPerson(who, skip)) continue;
    const hit = [...rows.keys()].find((k) => k.replace(/[\s　]/g, "") === who.replace(/[\s　]/g, ""));
    if (hit) rows.get(hit).apos = n;
    else rows.set(who, { name: who, calls: 0, contacts: 0, apos: n });
  }

  // インターン生は、SF上では代理（中澤さんなど）名義で活動が入るため、
  // SFレポートには本人名で出てこない。kincall自身の記録から、本人名で足す。
  try {
    const interns = await listInterns().catch(() => []);
    if (interns.length) {
      const stats = await callStats(today).catch(() => []);   // [{caller(メール), result, n}]
      const 接触判定 = (v) => /接触|アポ|再コール|断り|見送り/.test(v) && !/不在|コールのみ|NG/.test(v);
      const アポ判定 = (v) => /アポ獲得/.test(v);
      const byEmail = new Map();
      for (const s of stats || []) {
        const em = String(s.caller || "").toLowerCase();
        if (!em) continue;
        const o = byEmail.get(em) || { calls: 0, contacts: 0, apos: 0 };
        o.calls += s.n;
        if (接触判定(s.result)) o.contacts += s.n;
        if (アポ判定(s.result)) o.apos += s.n;
        byEmail.set(em, o);
      }
      for (const it of interns) {
        const em = String(it.email || "").toLowerCase();
        const o = byEmail.get(em);
        if (!o || !o.calls) continue;
        const name = it.name || em;
        const hit = [...rows.keys()].find((k) => k.replace(/[\s　]/g, "") === name.replace(/[\s　]/g, ""));
        if (hit) rows.set(hit, { name: rows.get(hit).name, calls: o.calls, contacts: o.contacts, apos: o.apos });
        else rows.set(name, { name, calls: o.calls, contacts: o.contacts, apos: o.apos });
      }
    }
  } catch (e) { console.warn("[call-report] インターン分の取り込みに失敗:", e.message); }

  const list = [...rows.values()].sort((a, b) => b.calls - a.calls);
  const sum = list.reduce((o, x) => ({
    calls: o.calls + x.calls, contacts: o.contacts + x.contacts, apos: o.apos + x.apos,
  }), { calls: 0, contacts: 0, apos: 0 });

  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const rate = sum.calls ? ((sum.apos / sum.calls) * 100).toFixed(1) : "0.0";

  // 目標だけあって、まだ実績が0の人も出す（誰が止まっているか分かるように）
  for (const name of Object.keys(goals)) {
    if (isSkippedPerson(name, skip)) continue;
    const hit = list.find((x) => {
      const a = x.name.replace(/[\s　]/g, ""), b = name.replace(/[\s　]/g, "");
      return a === b || a.startsWith(b) || b.startsWith(a);
    });
    if (!hit) list.push({ name, calls: 0, contacts: 0, apos: 0 });
  }

  const goalSum = list.reduce((o, x) => {
    const g = goalOf(x.name);
    return { calls: o.calls + (Number(g.calls) || 0), apos: o.apos + (Number(g.apos) || 0) };
  }, { calls: 0, apos: 0 });

  const lines = [
    `📞 *コール進捗（${hh}:00 時点）*`,
    `合計：${sum.calls}コール ／ 接触 ${sum.contacts} ／ アポ ${sum.apos}（アポ率 ${rate}%）` +
      (goalSum.calls
        ? `\n🎯 目標：${goalSum.calls}コール / ${goalSum.apos}アポ（あと ${Math.max(0, goalSum.calls - sum.calls)}コール / ${Math.max(0, goalSum.apos - sum.apos)}アポ）`
        : "\n🎯 目標：0（いまは目標なしで出しています）"),
    "",
  ];
  for (const x of list.sort((a, b) => b.calls - a.calls)) {
    const g = goalOf(x.name);
    const gc = Number(g.calls) || 0, ga = Number(g.apos) || 0, gh = Number(g.hours) || 0;
    const head = `・${x.name}${gh ? `（${gh}h）` : ""}`;
    if (gc || ga) {
      const pct = gc ? Math.round((x.calls / gc) * 100) : 0;
      lines.push(`${head}　目標 ${gc}c / ${ga}アポ　→　実績 ${x.calls}c / ${x.apos}アポ` +
        (gc ? `（${pct}%・あと ${Math.max(0, gc - x.calls)}c）` : ""));
    } else {
      lines.push(`${head}　実績 ${x.calls}c / ${x.apos}アポ`);
    }
  }
  if (!list.length) lines.push("（まだ実績がありません）");
  if (goalFrom) lines.push("", `（目標は${goalFrom}から読みました）`);

  return { skipped: false, text: lines.join("\n"), summary: sum, rows: list };
}

// 決まった時刻になったら流す（1時間に1回だけ）
async function maybeSendCallReport() {
  try {
    const st = await getSettings().catch(() => ({}));
    if (st.callReport !== true) return;
    const now = new Date(Date.now() + 9 * 3600 * 1000);
    const day = now.getUTCDay();
    if (day === 0 || day === 6) return;               // 土日は流さない
    const h = now.getUTCHours(), m = now.getUTCMinutes();
    const from = Number(st.callReportFrom ?? 11), to = Number(st.callReportTo ?? 18);
    if (h < from || h > to) return;
    if (m > 4) return;                                 // 毎時0〜4分の間に1回
    const key = `${now.toISOString().slice(0, 10)}-${h}`;
    if (lastCallReportKey === key) return;
    lastCallReportKey = key;

    const sfUser = String(st.psOwner || "").trim();
    if (!sfUser) return;
    const r = await buildCallReport(sfUser);
    if (r.skipped || !r.text) return;
    await notifyAll(r.text, "assign");
    console.log(`[call-report] ${h}時の進捗を送りました`);
  } catch (e) { console.warn("[call-report]", e.message); }
}

// Salesforceを更新済みの商談を返す（ホームの「SF更新まだ」の判定に使う）
app.post("/api/sf-updated-check", async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.botIds) ? req.body.botIds.slice(0, 100).map(String) : [];
    if (!ids.length) return res.json({ ok: true, results: {} });
    // kinbotから更新したぶん
    const mine = await sfUpdatedMap(ids).catch(() => ({}));
    // 商談の記録に、活動履歴を作った印があるものも「更新済み」とみなす
    const results = {};
    for (const id of ids) {
      if (mine[id]) {
        results[id] = { updated: true, stage: mine[id].stage || "", why: mine[id].stage ? "ステージを更新" : "自動で反映" };
      }
      // 記録が無ければ「まだ」とする
    }
    res.json({ ok: true, results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────────────────────────────────────
// 御礼メールを実際に送ったかを、Gmailの送信済みから見分ける
//
// kinbotで下書きを作っただけでは「送った」ことにならない。
// その人が今日送ったメールの宛先・件名を見て、会社名かアドレスが
// 一致していれば「送った」とみなす。
// ───────────────────────────────────────────────────────────
const _sentCache = new Map();   // owner → { at, items }

async function sentTodayFor(owner) {
  const key = String(owner || "").toLowerCase();
  if (!key) return [];
  const hit = _sentCache.get(key);
  // 同じ人のぶんは2分だけ覚えておく（画面を開くたびにGmailを叩かないため）
  if (hit && Date.now() - hit.at < 2 * 60 * 1000) return hit.items;
  try {
    const items = await gmailSentToday(key, { max: 60 });
    _sentCache.set(key, { at: Date.now(), items });
    return items;
  } catch (e) {
    console.warn(`[御礼メール] 送信済みを読めません（${key}）：${e.message}`);
    _sentCache.set(key, { at: Date.now(), items: [] });
    return [];
  }
}

// 会社名やアドレスが、送ったメールの中にあるか
function sentMatches(items, { company, email }) {
  const norm = (v) => String(v || "").replace(/[\s　（）()・,、.。「」]/g, "").toLowerCase();
  // 会社名は、法人格を外した「芯」で比べる（株式会社をつけ忘れても拾えるように）
  const core = (v) => norm(v)
    .replace(/^(株式会社|有限会社|合同会社|一般社団法人|社会福祉法人|医療法人|学校法人)/, "")
    .replace(/(株式会社|有限会社|合同会社)$/, "");
  const mail = String(email || "").trim().toLowerCase();
  const cc = core(company);
  for (const it of items) {
    const to = String(it.to || "").toLowerCase();
    if (mail && to.includes(mail)) return { ok: true, why: "宛先が一致", id: it.id };
    if (cc && cc.length >= 2) {
      const sub = core(it.subject);
      if (sub.includes(cc)) return { ok: true, why: "件名に会社名", id: it.id };
    }
  }
  return { ok: false };
}

// ホームから聞かれたら、今日の商談ぶんをまとめて返す
app.post("/api/mail-sent-check", async (req, res) => {
  try {
    const list = Array.isArray(req.body?.items) ? req.body.items.slice(0, 60) : [];
    if (!list.length) return res.json({ ok: true, results: {} });
    const items = await sentTodayFor(req.user);
    const results = {};
    for (const x of list) {
      const r = sentMatches(items, { company: x.company, email: x.email });
      results[String(x.id)] = r.ok ? { sent: true, why: r.why } : { sent: false };
    }
    res.json({ ok: true, results, 送信済みの件数: items.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// アポについて「SFを立ち上げたか」「メールを送ったか」を、実データから見分ける。
//
// kinbotから操作したかどうかに関わらず、
//   ・SF … 商談日の近くに、その会社のクロスの商談ができているか
//   ・メール … その日に、その会社へメールを送っているか
// を見て判定する。
app.post("/api/apo/done-check", async (req, res) => {
  try {
    const list = Array.isArray(req.body?.items) ? req.body.items.slice(0, 60) : [];
    if (!list.length) return res.json({ ok: true, results: {} });

    // ── メール：その人が今日送ったぶんを1回だけ読む
    const sent = await sentTodayFor(req.user).catch(() => []);

    // ── SF：商談日の前後に作られたクロスの商談を、まとめて引く
    const oppByCompany = new Map();
    let 見る人 = req.user;
    if (!(await sfConnected(見る人).catch(() => false))) {
      const st = await getSettings().catch(() => ({}));
      const 代理 = String(st.sfProxyUser || "").trim().toLowerCase();
      if (代理 && (await sfConnected(代理).catch(() => false))) 見る人 = 代理;
    }
    if (salesforceConfigured() && (await sfConnected(見る人).catch(() => false))) {
      try {
        // 商談日の範囲を出す（前後30日ぶん見れば足りる）
        const days = list.map((x) => String(x.start || "").slice(0, 10)).filter(Boolean).sort();
        const from = days[0] || jstDate(-30);
        const to = days[days.length - 1] || jstDate(30);
        const d = await sfQuery(見る人,
          `SELECT Id, Name, CloseDate, StageName, Account.Name, RecordType.Name ` +
          `FROM Opportunity WHERE CloseDate >= ${from} AND CloseDate <= ${to} ` +
          `ORDER BY CreatedDate DESC LIMIT 500`);
        for (const o of d.records || []) {
          const co = (o.Account && o.Account.Name) || o.Name || "";
          const k = coreName(co);
          if (!k) continue;
          if (!oppByCompany.has(k)) oppByCompany.set(k, []);
          oppByCompany.get(k).push({
            id: o.Id, 名前: o.Name, 日: o.CloseDate,
            種類: (o.RecordType && o.RecordType.Name) || "",
          });
        }
      } catch (e) { console.warn("[アポ] SFの商談を読めません:", e.message); }
    }

    const results = {};
    for (const x of list) {
      const co = String(x.company || "");
      const k = coreName(co);
      const 商談日 = String(x.start || "").slice(0, 10);

      // SF：商談日と近い（前後7日）クロスの商談があれば「立ち上げた」
      let sf = null;
      for (const o of oppByCompany.get(k) || []) {
        if (!/クロス/.test(o.種類) && o.種類) continue;
        const 差 = Math.abs(
          (new Date(o.日).getTime() - new Date(商談日).getTime()) / 86400000);
        if (差 <= 7) { sf = o; break; }
      }

      // メール：今日その会社へ送っているか
      const mail = sentMatches(sent, { company: co, email: x.email });

      results[String(x.slug || x.id)] = {
        sf済み: !!sf,
        sf: sf ? { id: sf.id, 名前: sf.名前, 日: sf.日 } : null,
        メール済み: !!mail.ok,
        メールの理由: mail.ok ? mail.why : "",
      };
    }
    res.json({ ok: true, results, 送信済みの件数: sent.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 会社名の「芯」を出す（法人格や記号の違いを無視して比べるため）
function coreName(v) {
  return String(v || "").normalize("NFKC")
    .replace(/[\s　（）()・,、.。「」【】]/g, "")
    .replace(/^(株式会社|有限会社|合同会社|一般社団法人|一般財団法人|社会福祉法人|医療法人|学校法人|社会医療法人)/, "")
    .replace(/(株式会社|有限会社|合同会社)$/, "")
    .toLowerCase();
}

// 明日リマインドを送る相手の一覧（ホームに出す）
app.get("/api/apo-mail/tomorrow", async (req, res) => {
  try {
    const cfg = await getApoMailConfig();
    // 日付を指定できる（省略すると明日）。ほかの日のぶんも見て、対象に足せるように。
    const all = await listTomorrowReminders(String(req.query.date || ""));
    // 自分のぶんだけにする（?all=1 で全員）。
    // 担当がまだ決まっていないものは、誰のぶんか分からないので必ず出す
    // （そのままだと誰の画面にも出ず、気づけないため）。
    const me = String(req.user || "").toLowerCase();
    const mine = String(req.query.all || "") === "1"
      ? all
      : all.filter((x) => {
          const o = String(x.owner || "").toLowerCase();
          return !o || o === me;
        });
    // 担当営業の名前を出す（メールアドレスのままだと分かりにくいため）
    const names = new Map();
    for (const x of mine) {
      const k = String(x.owner || "").toLowerCase();
      if (!k || names.has(k)) continue;
      names.set(k, await displayNameOf(k).catch(() => k));
    }

    // 同じ会社・同じ時刻のものが複数あるときは、重なっていると分かるようにする
    const seen = new Map();
    for (const x of mine) {
      const k = `${x.company}|${String(x.start).slice(0, 16)}`;
      seen.set(k, (seen.get(k) || 0) + 1);
    }

    res.json({
      ok: true,
      自動送信: cfg.autoReminder !== false,
      送る時刻: `${cfg.reminderHour}:00`,
      件数: mine.length,
      全件: all.length,
      items: mine.map((x) => ({
        ...x,
        担当: names.get(String(x.owner || "").toLowerCase()) || "",
        重なり: (seen.get(`${x.company}|${String(x.start).slice(0, 16)}`) || 1) > 1,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// リマインドに足りないところを補う（宛先・担当）
app.post("/api/apo-mail/fix", async (req, res) => {
  try {
    const slug = String(req.body?.slug || "").trim();
    if (!slug) return res.status(400).json({ error: "どのアポか分かりません" });
    const patch = {};
    if (req.body?.email !== undefined) {
      const em = String(req.body.email || "").trim();
      if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
        return res.status(400).json({ error: "メールアドレスの形が違います" });
      }
      patch.email = em;
    }
    if (req.body?.owner !== undefined) patch.owner = String(req.body.owner || "").trim();
    const r = await fixApoForReminder(slug, patch);
    if (!r) return res.status(404).json({ error: "見つかりません" });
    console.log(`[apo-mail] ${r.label} を直しました（${Object.keys(patch).join("・")}）by ${req.user}`);
    res.json({ ok: true, item: { slug: r.slug, to: r.client_email || "", owner: r.current_owner || "" } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 送り先の候補（担当セールスの一覧）
app.get("/api/apo-mail/reps", async (req, res) => {
  try {
    const list = await listClosers({ activeOnly: true }).catch(() => []);
    res.json({ reps: list.map((c) => ({ email: c.email, name: c.name || c.email })) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// リマインドを送る／送らないを切り替える
app.post("/api/apo-mail/reminder-off", async (req, res) => {
  try {
    const slug = String(req.body?.slug || "").trim();
    if (!slug) return res.status(400).json({ error: "どのアポか分かりません" });
    const off = req.body?.off === true;
    const r = await setNoReminder(slug, off);
    if (!r) return res.status(404).json({ error: "見つかりません" });
    console.log(`[apo-mail] ${r.label}：リマインドを${off ? "送らない" : "送る"}にしました by ${req.user}`);
    res.json({ ok: true, slug, off });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 送る1時間前に、対象を本人へ知らせる。
// 「これから送られる」と分かっていれば、間違いがあっても止められる。
let lastRemindNoticeKey = "";
async function maybeNoticeBeforeReminder() {
  try {
    const cfg = await getApoMailConfig();
    if (cfg.autoReminder === false) return;
    const now = new Date(Date.now() + 9 * 3600 * 1000);
    const noticeHour = (Number(cfg.reminderHour) + 23) % 24;   // 1時間前
    if (now.getUTCHours() !== noticeHour || now.getUTCMinutes() > 4) return;
    const key = `${now.toISOString().slice(0, 10)}-${noticeHour}`;
    if (lastRemindNoticeKey === key) return;
    lastRemindNoticeKey = key;

    const all = await listTomorrowReminders();
    if (!all.length) return;

    // 担当者ごとにまとめる（送れないものも一緒に知らせる）
    const byOwner = new Map();
    for (const x of all) {
      const k = String(x.owner || "").toLowerCase();
      if (!k) continue;
      if (!byOwner.has(k)) byOwner.set(k, []);
      byOwner.get(k).push(x);
    }

    let sent = 0;
    for (const [owner, list] of byOwner) {
      const name = await displayNameOf(owner).catch(() => "");
      const ok = list.filter((x) => x.送る);
      const ng = list.filter((x) => !x.送る && x["状態"] !== "送信済み");
      if (!ok.length && !ng.length) continue;
      const line = (x) => {
        const t = String(x.start || "").slice(11, 16);
        return `・${t}　${x.company || x.label}　${x.to || ""}`;
      };
      const text = [
        `${name ? name + "さん、" : ""}あと1時間で、明日の商談のリマインドメールを送ります。`,
        `（${cfg.reminderHour}:00 に自動で送ります）`,
        "",
        ok.length ? `📮 *送る先 ${ok.length}件*` : "📮 *送る先はありません*",
        ...ok.slice(0, 20).map(line),
        ok.length > 20 ? `…ほか${ok.length - 20}件` : "",
        // 送れないものは、直せば間に合うので一緒に知らせる
        ng.length ? "" : "",
        ng.length ? `⚠️ *送れないもの ${ng.length}件*` : "",
        ...ng.slice(0, 10).map((x) => `${line(x)}（${x["状態"]}）`),
        "",
        "宛先や日時が違うものがあれば、kinbotのホームから直してください。",
      ].filter(Boolean).join("\n");
      const r = await notifyPerson(owner, text);
      if (r.ok) sent++;
    }
    console.log(`[apo-mail] リマインドの予告を ${sent}人に送りました（対象 ${all.length}件）`);
  } catch (e) { console.warn("[apo-mail] リマインドの予告:", e.message); }
}

// ───────────────────────────────────────────────────────────
// Google Chatへの知らせ（まとめて設定する）
//
// あちこちの画面に散らばっていた「知らせるかどうか」を、
// 設定の1か所から入り切りできるようにする。
// ───────────────────────────────────────────────────────────

// 何を知らせるか。ここに足せば、画面にも自動で並ぶ。
const NOTICE_KINDS = [
  { key: "assign", 名前: "アポの割り振り", 説明: "アポが誰かに割り当てられたとき",
    設定: null, 送り先: "on_assign" },
  { key: "mail", 名前: "メールの下書き・送信", 説明: "確定メールやリマインドを用意したとき",
    設定: null, 送り先: "on_mail" },
  { key: "doc", 名前: "資料・URLの閲覧", 説明: "送った資料や日程調整URLが開かれたとき",
    設定: "jumpNotify", 送り先: "on_doc" },
  { key: "launch", 名前: "Salesforceの立ち上げ", 説明: "商談を立ち上げたとき・できなかったとき",
    設定: null, 送り先: "on_launch" },
  { key: "deploy", 名前: "kinbotの更新", 説明: "更新が終わったとき",
    設定: "notifyDeploy", 送り先: "on_deploy" },
];

// 決まった時刻に流すもの
// 決まった時刻に流すもののうち、
// 送り先ごとに選べないもの（本人あて・点検用など）だけをここに置く。
// 送り先を選べるものは、送り先ごとのチェックで決める。
const NOTICE_TIMERS = [
  { key: "deployNews", 名前: "朝の「新しくなりました」", 説明: "前の営業日からの変更をまとめて。送り先は下で選びます",
    既定: true, 時刻: { hour: "deployNewsHour", minute: "deployNewsMinute", 既定時: 8, 既定分: 30 } },
  { key: "callProgress", 名前: "コール進捗", 説明: "平日11〜18時の毎正時（チームのスペースへ）", 既定: true },
  { key: "eveningReminder", 名前: "夕方のやり残し", 説明: "平日18時半に本人だけへ（1対1）", 既定: true },
  { key: "weeklyRemind", 名前: "天気予報の声かけ", 説明: "月曜の朝と金曜の夕方（本人だけへ）", 既定: false },
  { key: "devSummary", 名前: "開発メモのまとめ", 説明: "朝6時。点検用の送り先へ（既定はOFF）", 既定: false },
  { key: "selfCheck", 名前: "自己点検", 説明: "30分おきに見張り、問題があれば点検用の送り先へ", 既定: false },
];

app.get("/api/notices", async (req, res) => {
  try {
    const st = await getSettings();
    const targets = await listChatTargets().catch(() => []);
    res.json({
      ok: true,
      // 種類ごとの送り先（どこに流すか）
      種類: NOTICE_KINDS.map((k) => ({
        key: k.key, 名前: k.名前, 説明: k.説明,
        入り切り: k.設定 ? st[k.設定] !== false : null,
        送り先の数: targets.filter((t) => t[k.送り先] && t.enabled !== false).length,
      })),
      // 時刻を決めて流すもの
      定期: NOTICE_TIMERS.map((t) => ({
        key: t.key, 名前: t.名前, 説明: t.説明,
        入り切り: t.key === "devSummary" ? st[t.key] === true : st[t.key] !== false,
        時刻: t.時刻
          ? `${String(st[t.時刻.hour] ?? t.時刻.既定時).padStart(2, "0")}:${String(st[t.時刻.minute] ?? t.時刻.既定分).padStart(2, "0")}`
          : null,
      })),
      送り先: targets.map((t) => ({
        id: t.id, 名前: t.name || t.space_id || "（名前なし）", enabled: t.enabled !== false,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/notices", async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    // 種類ごと
    for (const k of NOTICE_KINDS) {
      if (k.設定 && b[k.key] !== undefined) patch[k.設定] = b[k.key] !== false;
    }
    // 定期のもの
    for (const t of NOTICE_TIMERS) {
      if (b[t.key] !== undefined) patch[t.key] = b[t.key] !== false;
      if (t.時刻 && b[`${t.key}Time`]) {
        const m = String(b[`${t.key}Time`]).match(/^(\d{1,2}):(\d{2})$/);
        if (m) {
          patch[t.時刻.hour] = Math.min(23, Math.max(0, Number(m[1])));
          patch[t.時刻.minute] = Math.min(59, Math.max(0, Number(m[2])));
        }
      }
    }
    await saveSettings(patch);
    console.log(`[知らせ] 設定を変えました（${Object.keys(patch).join("・")}）by ${req.user}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────────────────────────────────────
// 送ったメールの記録（届いたか・跳ね返ったか）
// ───────────────────────────────────────────────────────────

// 送ったメールの一覧。全メンバーぶんを見られる。
app.get("/api/apo-mail/log", async (req, res) => {
  try {
    const q = req.query || {};
    const rows = await listApoMails({
      from: /^\d{4}-\d{2}-\d{2}$/.test(String(q.from || "")) ? q.from : jstDate(-6),
      to: /^\d{4}-\d{2}-\d{2}$/.test(String(q.to || "")) ? q.to : jstDate(0),
      kind: ["confirm", "reminder"].includes(String(q.kind || "")) ? q.kind : "",
      owner: String(q.mine || "") === "1" ? req.user : "",
      limit: 500,
    });
    const names = new Map();
    for (const r of rows) {
      const k = String(r.from_owner || "").toLowerCase();
      if (!k || names.has(k)) continue;
      names.set(k, await displayNameOf(k).catch(() => k));
    }
    const items = rows.map((r) => ({
      slug: r.slug,
      種類: r.kind === "reminder" ? "リマインド" : "確定メール",
      会社: parseCompany(r.label || ""),
      宛先: r.to_email || "",
      送った人: names.get(String(r.from_owner || "").toLowerCase()) || r.from_owner || "",
      状態: r.bounced ? "届きませんでした"
        : r.status === "sent" ? "送信済み"
        : r.status === "draft" ? "下書き"
        : r.status === "error" ? "失敗" : r.status,
      理由: r.bounced ? (r.bounce_note || "") : (r.error || ""),
      at: r.created_at,
      商談日: r.start_time || null,
    }));
    const 集計 = {
      送信済み: items.filter((x) => x["状態"] === "送信済み").length,
      下書き: items.filter((x) => x["状態"] === "下書き").length,
      届きませんでした: items.filter((x) => x["状態"] === "届きませんでした").length,
      失敗: items.filter((x) => x["状態"] === "失敗").length,
    };
    res.json({ ok: true, 集計, 件数: items.length, items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 予定名から会社名を取り出す（一覧に出すため）
function parseCompany(label) {
  return String(label || "").normalize("NFKC")
    .replace(/【[^】]*】/g, "")
    .split(/[\/｜|:：・、,]/)[0]
    .replace(/[^\s　]{0,16}\s*(?:様|さま|さん|殿)\s*$/u, "")
    .trim();
}

// 跳ね返りを探して、記録に印を付ける
async function checkBounces(owner) {
  try {
    const found = await gmailFindBounces(owner, { days: 3, max: 20 });
    let n = 0;
    for (const b of found) {
      const hit = await markBounced(b["宛先"], b["理由"]);
      if (hit) {
        n += hit;
        // 送った本人に知らせる（気づかないと追客が止まるため）
        notifyPerson(owner, [
          "⚠️ *メールが届きませんでした*",
          `✉️ ${b["宛先"]}`,
          `📝 ${b["理由"]}`,
          "宛先をご確認のうえ、必要なら送り直してください。",
        ].join("\n")).catch(() => {});
      }
    }
    if (n) console.log(`[apo-mail] 届かなかったメール ${n}件に印を付けました（${owner}）`);
    return n;
  } catch (e) {
    console.warn(`[apo-mail] 跳ね返りを調べられません（${owner}）：${e.message}`);
    return 0;
  }
}

// いま調べる（画面から押したとき）
app.post("/api/apo-mail/check-bounces", async (req, res) => {
  try {
    const n = await checkBounces(req.user);
    res.json({ ok: true, 見つかった数: n });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────────────────────────────────────
// 転送URL
//
// レセプショニストなど、ほかのサービスの日程調整URLをそのまま使いつつ、
// 「誰が開いたか」を記録したいときに使う。
// kinbotをいったん通してから、本来のURLへ送ります。
// ───────────────────────────────────────────────────────────

// 転送URLを作る
app.post("/api/jump", async (req, res) => {
  try {
    const b = req.body || {};
    const url = String(b.targetUrl || "").trim();
    if (!/^https?:\/\//.test(url)) {
      return res.status(400).json({ error: "転送先のURLを、http:// か https:// から入れてください" });
    }
    const link = await createJumpLink({
      title: b.title, targetUrl: url, owner: req.user, shared: b.shared === true,
      company: b.company, person: b.person, email: b.email, createdBy: req.user,
    });
    if (!link) return res.status(500).json({ error: "作れませんでした" });
    const base = String(PUBLIC_URL || "").replace(/\/+$/, "");
    const my = `${base}/g/${link.slug}`;
    console.log(`[転送URL] 作りました：${link.title} → ${url}（${link.shared_link ? "共通" : "個別"}）by ${req.user}`);
    res.json({
      ok: true, id: link.id, slug: link.slug, url: my, 転送先: url, 共通: !!link.shared_link,
      貼り方: link.shared_link ? {
        "Pardot（おすすめ）": `${my}?m=%%email%%&n=%%account_name%%`,
        "Pardot（アドレスだけ）": `${my}?m=%%email%%`,
        "差し込みを使わない場合（誰が見たかは分かりません）": my,
      } : null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 転送URLが開かれたことを知らせる。
// 資料トラッキングと同じ形にそろえる。
const _jumpNotified = new Map();
async function notifyJumpView(link, v) {
  // 設定でOFFにしていたら知らせない
  const st = await getSettings().catch(() => ({}));
  if (st.jumpNotify === false) return;

  // 同じ相手・同じURLは30分に1回だけ知らせる（何度も鳴らさない）
  const key = `${link.id}:${v.email || "-"}`;
  const last = _jumpNotified.get(key) || 0;
  if (Date.now() - last < 30 * 60 * 1000) return;
  _jumpNotified.set(key, Date.now());
  // 古い記録は片付ける
  if (_jumpNotified.size > 500) {
    for (const [k, t] of _jumpNotified) if (Date.now() - t > 3600 * 1000) _jumpNotified.delete(k);
  }

  const who = v.email || v.name || [link.company, link.person].filter(Boolean).join(" ") || "名乗りなし";
  const rep = link.owner ? await displayNameOf(link.owner).catch(() => "") : "";
  const lines = [
    `📅 *日程調整のURLを開きました*　${who}`,
    `🔗 ${link.title || "日程調整"}`,
    v.name && v.name !== who ? `🏢 ${v.name}` : "",
    rep ? `👤 ${rep}` : "",
  ].filter(Boolean);
  await notifyAll(lines.join("\n"), "doc");
}

// 通知の入り切り
app.get("/api/jump/notify", async (req, res) => {
  try {
    const st = await getSettings();
    res.json({ enabled: st.jumpNotify !== false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/jump/notify", async (req, res) => {
  try {
    const on = req.body?.enabled !== false;
    await saveSettings({ jumpNotify: on });
    console.log(`[転送URL] Chatへの通知を${on ? "ON" : "OFF"}にしました by ${req.user}`);
    res.json({ ok: true, enabled: on });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 作った転送URLの一覧
app.get("/api/jump", async (req, res) => {
  try {
    const rows = await listJumpLinks(String(req.query.all || "") === "1" ? "" : req.user);
    const base = String(PUBLIC_URL || "").replace(/\/+$/, "");
    res.json({
      ok: true,
      items: rows.map((r) => ({
        id: r.id, slug: r.slug, title: r.title, url: `${base}/g/${r.slug}`,
        転送先: r.target_url, 共通: !!r.shared_link,
        相手: [r.company, r.person].filter(Boolean).join(" "),
        閲覧: Number(r["閲覧"] || 0), 人数: Number(r["人数"] || 0),
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 差し込みが効いているかを、その場で確かめる。
// 実際に踏むURLの後ろを、そのまま貼って試せる。
app.get("/api/jump/check", (req, res) => {
  const v = viewerFromQuery(req.query || {});
  res.json({
    ok: true,
    受け取った項目: Object.keys(req.query || {}),
    読み取れたアドレス: v.email || "（読み取れませんでした）",
    読み取れた名前: v.name || "（なし）",
    hint: v.email
      ? "この形なら、誰が開いたか記録されます。"
      : "アドレスを読み取れません。?m=メールアドレス の形になっているか、" +
        "差し込みタグ（%%email%%）が置き換わっているかをご確認ください。",
  });
});

// 誰が開いたか
app.get("/api/jump/:id/viewers", async (req, res) => {
  try {
    const rows = await listJumpViewers(parseInt(req.params.id, 10));
    res.json({ ok: true, 人数: rows.length, items: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// お客様が踏んだとき。記録してから、本来のURLへ送る。
app.get("/g/:slug", async (req, res) => {
  try {
    const link = await getJumpLink(String(req.params.slug || ""));
    if (!link || link.closed) return res.status(404).send("このURLは使えません");

    // 誰が開いたかを残す（共通URLのときは、差し込みから受け取る）
    const v = viewerFromQuery(req.query || {});
    await recordJumpView(link.id, {
      email: v.email || link.email || "",
      name: v.name || link.company || "",
      ua: req.get("user-agent") || "",
    }).catch(() => {});

    // 転送先に、こちらで受け取った情報も渡す（相手側で使えることがあるため）
    let to = link.target_url;
    try {
      const u = new URL(to);
      if (v.email && !u.searchParams.get("email")) u.searchParams.set("email", v.email);
      to = u.toString();
    } catch {}

    // 何を受け取ったかをログに残す（誰が開いたか分からないときの手がかり）
    const gotKeys = Object.keys(req.query || {}).join(",") || "なし";
    console.log(`[転送URL] ${link.title} を開きました（${v.email || "名乗りなし"}／` +
      `受け取った項目：${gotKeys}）`);

    // Google Chatへ知らせる。
    // 同じ人が何度も開いたときに毎回鳴らないよう、30分は1回だけにする。
    notifyJumpView(link, v).catch(() => {});
    // 記録が終わってから送る。ブラウザには残さない（302）。
    res.redirect(302, to);
  } catch (e) {
    console.error("[転送URL]", e.message);
    res.status(500).send("いま開けません。恐れ入りますが、時間をおいてお試しください。");
  }
});

// ───────────────────────────────────────────────────────────
// 日程調整ページ
//
// お客様に空き時間から選んでもらうURL。
// Pardot用の共通URLも作れて、誰が見たか・誰が予約したかが分かる。
// ───────────────────────────────────────────────────────────

// 担当者のカレンダーの予定を取る（空き時間を出すため）
async function busyOf(owner, days) {
  const from = new Date().toISOString();
  const to = new Date(Date.now() + (Number(days) + 1) * 86400000).toISOString();
  try {
    const evs = await listCalendarEvents(owner, "primary", { timeMin: from, timeMax: to });
    return (evs || [])
      .filter((e) => !e.allDay && e.start && e.end)
      .map((e) => ({ start: e.start, end: e.end }));
  } catch (e) {
    console.warn(`[日程調整] カレンダーを読めません（${owner}）：${e.message}`);
    return null;   // 読めないときは、空き時間を出さない（勝手に埋めない）
  }
}

// ページを作る
app.post("/api/booking/pages", async (req, res) => {
  try {
    const b = req.body || {};
    const page = await createBookPage({
      title: b.title, owner: req.user, shared: b.shared === true,
      company: b.company, person: b.person, email: b.email,
      minutes: b.minutes, daysAhead: b.daysAhead, fromHour: b.fromHour, toHour: b.toHour,
      note: b.note, createdBy: req.user,
    });
    if (!page) return res.status(500).json({ error: "作れませんでした" });
    const base = String(PUBLIC_URL || "").replace(/\/+$/, "");
    const url = `${base}/b/${page.slug}`;
    console.log(`[日程調整] ページを作りました：${page.title}（${page.shared_link ? "共通" : "個別"}）by ${req.user}`);
    res.json({
      ok: true, id: page.id, slug: page.slug, url, 共通: !!page.shared_link,
      貼り方: page.shared_link ? {
        "Pardot（おすすめ）": `${url}?m=%%email%%&n=%%account_name%%`,
        "Pardot（アドレスだけ）": `${url}?m=%%email%%`,
        "差し込みを使わない場合（誰が見たかは分かりません）": url,
      } : null,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ページの一覧
app.get("/api/booking/pages", async (req, res) => {
  try {
    const rows = await listBookPages(String(req.query.all || "") === "1" ? "" : req.user);
    const base = String(PUBLIC_URL || "").replace(/\/+$/, "");
    res.json({
      ok: true,
      items: rows.map((r) => ({
        id: r.id, slug: r.slug, title: r.title, url: `${base}/b/${r.slug}`,
        共通: !!r.shared_link, 相手: [r.company, r.person].filter(Boolean).join(" "),
        閲覧: Number(r["閲覧"] || 0), 予約: Number(r["予約"] || 0), closed: !!r.closed,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 誰が見たか・誰が予約したか
app.get("/api/booking/pages/:id/viewers", async (req, res) => {
  try {
    const rows = await listBookViewers(parseInt(req.params.id, 10));
    res.json({ ok: true, 人数: rows.length, items: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// お客様が開いたとき（ログイン不要）
app.get("/api/booking/:slug", async (req, res) => {
  try {
    const page = await getBookPage(String(req.params.slug || ""));
    if (!page || page.closed) return res.status(404).json({ error: "このページは使えません" });

    // 開いたことを残す（共通URLのときは、差し込みから相手を受け取る）
    const v = viewerFromQuery(req.query || {});
    const view = await recordBookView(page.id, {
      email: v.email || page.email || "", name: v.name || page.company || "",
      ua: req.get("user-agent") || "",
    }).catch(() => null);

    // 開かれたことを知らせる（30分に1回だけ）
    notifyJumpView(
      { id: `book${page.id}`, title: page.title, company: page.company, person: page.person, owner: page.owner },
      v
    ).catch(() => {});

    const busy = await busyOf(page.owner, page.days_ahead);
    if (busy === null) {
      return res.json({ ok: true, viewId: view ? view.id : null, title: page.title,
        note: page.note || "", days: [], 読めません: true });
    }
    const days = buildSlots({
      minutes: page.minutes, daysAhead: page.days_ahead,
      fromHour: page.from_hour, toHour: page.to_hour, busy,
    });
    res.json({
      ok: true, viewId: view ? view.id : null,
      title: page.title, note: page.note || "", 分: page.minutes,
      相手: [page.company, page.person].filter(Boolean).join(" ") || (v.name || ""),
      days,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// お客様が時間を選んだとき（ログイン不要）
app.post("/api/booking/:slug/book", async (req, res) => {
  try {
    const page = await getBookPage(String(req.params.slug || ""));
    if (!page || page.closed) return res.status(404).json({ error: "このページは使えません" });
    const at = String(req.body?.at || "");
    const name = String(req.body?.name || "").trim();
    const company = String(req.body?.company || "").trim();
    const email = String(req.body?.email || "").trim();
    if (!at) return res.status(400).json({ error: "時間を選んでください" });
    if (!company || !name) return res.status(400).json({ error: "会社名とお名前を入れてください" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "メールアドレスの形をご確認ください" });
    }

    // ほかの人に先を越されていないか、もう一度確かめる
    const busy = await busyOf(page.owner, page.days_ahead);
    if (busy === null) return res.status(500).json({ error: "いま予約できません。少し時間をおいてお試しください" });
    if (!stillFree(at, page.minutes, busy)) {
      return res.status(409).json({ error: "その時間は、ちょうど埋まってしまいました。別の時間をお選びください" });
    }

    // カレンダーに予定を作る（【初回】会社名/お名前様 の形にして、アポ振り分けに乗せる）
    const start = new Date(at);
    const end = new Date(start.getTime() + page.minutes * 60000);
    const title = `【初回】${company}/${name}様`;
    let ev = null;
    try {
      ev = await createCalendarEvent(page.owner, {
        summary: title,
        description: `kinbotの日程調整ページから予約されました。\nお客様：${company} ${name}様（${email}）`,
        start: start.toISOString(), end: end.toISOString(),
        guests: [email],
      });
    } catch (e) {
      console.error("[日程調整] 予定を作れません:", e.message);
      return res.status(500).json({ error: "予約できませんでした。お手数ですが、担当までご連絡ください" });
    }

    await markBooked(parseInt(req.body?.viewId, 10) || 0, start.toISOString()).catch(() => {});
    console.log(`[日程調整] 予約が入りました：${title}（${at}）`);

    // 担当者にも知らせる
    notifyPerson(page.owner, [
      "📅 *日程調整ページから予約が入りました*",
      `　${title}`,
      `🕐 ${start.toISOString().slice(0, 16).replace("T", " ")}（日本時間）`,
      `✉️ ${email}`,
    ].join("\n")).catch(() => {});

    res.json({ ok: true, 予約: { at: start.toISOString(), 分: page.minutes } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────────────────────────────────────
// コールリスト（インターン生の架電）
//
// リードのリストを見ながら架電し、結果をSalesforceへ残す。
// 通信が切れても消えないよう、まずkinbotに保存してから送る。
// ───────────────────────────────────────────────────────────

// 架電の結果。プロセスシートの数え方に合わせている。
const CALL_RESULTS = [
  { key: "アポ獲得", sf: "アポ獲得", 接触: true },
  { key: "再コール", sf: "再コール", 接触: true },
  { key: "担当者不在", sf: "担当者不在", 接触: true },
  { key: "断り", sf: "断り", 接触: true },
  { key: "不在", sf: "不在", 接触: false },
  { key: "NG", sf: "NG（今後かけない）", 接触: false },
];

// リストの一覧
app.get("/api/calls/lists", async (req, res) => {
  try {
    // メンバーを指定できる（管理者、または自分自身のときだけ有効）
    const reqMember = String(req.query.member || "").trim().toLowerCase();
    // メンバーを指定されたら、その人のリストを出す。
    // （以前は管理者でないと指定が無視され、自分のリストが出てしまっていた）
    const owner = reqMember || req.user;
    const rows = await listCallLists({
      owner,
      includeClosed: String(req.query.all || "") === "1",
      ownerOnly: !!reqMember,   // メンバーを指定して見るときは、その人が作ったリストだけ
    });
    res.json({
      ok: true,
      member: owner,
      items: rows.map((r) => ({
        id: r.id, name: r.name, note: r.note || "",
        全部: Number(r["全部"] || 0), 済み: Number(r["済み"] || 0),
        残り: Number(r["全部"] || 0) - Number(r["済み"] || 0),
        自分のぶん: Number(r["自分のぶん"] || 0),
        作った人: r.owner || "",
        closed: !!r.closed,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// CSV（貼り付け）から、Salesforceのクロスリードと突き合わせてリストを作る。
//   1) 会社名でクロスリードを探す → あればそのリードでリスト化
//   2) 無ければ 会社名・電話番号・担当者名 で新しいクロスリードを作ってからリスト化
//   3) 担当者名が無いときは、担当者名を「担当者」としてリードを作る
// CSVの日付（2026/8/20・2026-08-20 など）を YYYY-MM-DD にそろえる
// CSVの「架電ステータス」を、Salesforceのステータスに置き換える対応表。
const CSVステータス変換 = {
  "アポ獲得": "担当者接触：アポ獲得",
  "断り": "担当者接触：お断り",
  "架電禁止": "問い合わせ",
  "不通・番号違い": "現アナ",
};

// CSVの「最終活動ステータス」を、決まった選択肢とそれ以外に振り分ける。
// まず上の対応表で置き換え、無ければ既知の選択肢に当てはめ、それも無ければコメント扱い。
function 振り分け(r) {
  const 生 = String((r && r.status) || "").trim();
  const そろえる = (v) => String(v || "").replace(/[\s　:：・]/g, "");
  const comment = String((r && r.comment) || "").trim();
  // 1) 決められた対応表で置き換える
  const 変換 = Object.entries(CSVステータス変換).find(([k]) => そろえる(k) === そろえる(生));
  if (変換) return { ステータス: 変換[1], コメント: comment };
  // 2) 既知のSFステータスに当てはまるか
  const 選択肢 = 既知の結果.concat(["担当者接触ニーズなし", "担当者接触：ニーズなし"]);
  const 当てはまる = 選択肢.find((w) => そろえる(w) === そろえる(生));
  return {
    ステータス: 当てはまる || "",
    // 当てはまらない生の値は、消さずにコメントとして残す
    コメント: [comment, 当てはまる ? "" : 生].filter(Boolean).join(" ／ "),
  };
}

function ymdOf(v) {
  const t = String(v || "").trim();
  if (!t) return "";
  const m = t.match(/^(\d{4})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})/);
  if (!m) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${m[1]}-${p(m[2])}-${p(m[3])}`;
}

app.post("/api/calls/from-csv", async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim() || `CSV（${jstDate(0)}）`;
    const dryRun = !!b.dryRun;
    // SFを一切触らず、CSVの中身だけで架電リストを作るモード（メールが無い等でSF更新したくないとき）
    const listOnly = !!b.listOnly;
    const 行 = Array.isArray(b.rows) ? b.rows : [];
    if (!行.length) return res.status(400).json({ error: "中身がありません" });

    // 誰のSF連携を使うか（自分が無ければ代わりに更新する人）
    let sfUser = req.user;
    if (!(await sfConnected(sfUser).catch(() => false))) {
      const st = await getSettings().catch(() => ({}));
      const 代理 = String(st.sfProxyUser || "").trim().toLowerCase();
      if (代理 && (await sfConnected(代理).catch(() => false))) sfUser = 代理;
    }
    if (!listOnly && (!salesforceConfigured() || !(await sfConnected(sfUser).catch(() => false)))) {
      return res.status(400).json({ error: "Salesforceにつながっていません（設定→動作設定の「代わりに更新する人」もご確認ください）" });
    }

    // ── SFを触らず、CSVの中身だけでリストを作る ──
    if (listOnly) {
      const 結果 = [];
      for (const r of 行) {
        const company = String(r.company || "").trim();
        if (!company) { 結果.push({ company, 状態: "とばした", 理由: "会社名がありません" }); continue; }
        const { ステータス, コメント } = 振り分け(r);
        結果.push({
          company, person: String(r.person || "").trim() || "担当者", phone: String(r.phone || "").trim(),
          email: String(r.email || "").trim(),
          leadId: "", 状態: "リストに追加", リード種別: "（SFなし）",
          ステータス, ステージ: String(r.stage || "").trim(), コメント,
          まとめ: String(r.history || "").trim(), 履歴: "",
        });
      }
      if (dryRun) {
        return res.json({
          ok: true, 試算: true, listOnly: true, 件数: 結果.length,
          見つかった: 0, 新しく作る: 0,
          とばす: 結果.filter((x) => x.状態 === "とばした").length,
          明細: 結果.slice(0, 200),
        });
      }
      const 入れられる = 結果.filter((x) => x.company && x.状態 !== "とばした");
      if (!入れられる.length) return res.status(400).json({ error: "リストに入れられるものがありませんでした" });
      const 既存2 = parseInt(b.listId, 10) || 0;
      const 分ける人2 = (Array.isArray(b.share) ? b.share : []).map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
      const listOwner2 = String(b.member || "").trim().toLowerCase() || 分ける人2[0] || req.user;
      const list2 = 既存2
        ? { id: 既存2, name }
        : await createCallList({ name, owner: listOwner2, createdBy: req.user });
      let 開始2 = 0;
      if (分ける人2.length && 既存2) { try { 開始2 = (await listCallTargets(既存2, { limit: 5000 })).length; } catch {} }
      const 入れるリスト2 = 入れられる.map((x, i) => ({
        company: x.company, person: x.person, phone: x.phone, email: x.email,
        status: x.ステータス, stage: x.ステージ, memo: x.まとめ || x.コメント,
        ...(分ける人2.length ? { assignedTo: 分ける人2[(開始2 + i) % 分ける人2.length] } : {}),
      }));
      const n2 = await addCallTargets(list2.id, 入れるリスト2, { dedupe: true });
      const 重複除外2 = 入れるリスト2.length - n2;
      console.log(`[kincall] CSVからリストだけ作りました（SF更新なし）「${name}」（${n2}件${重複除外2 ? `／重複除外 ${重複除外2}件` : ""}） by ${req.user}`);
      return res.json({
        ok: true, listOnly: true, id: list2.id, name: list2.name, 件数: n2, 重複除外: 重複除外2,
        見つかった: 0, 新しく作った: 0, とばした: 結果.filter((x) => x.状態 === "とばした").length,
        履歴を残した: 0, 分けた人数: 分ける人2.length, 明細: 結果.slice(0, 200),
      });
    }

    const rtId = await crossLeadRecordTypeId(sfUser).catch(() => "");
    const sq = (v) => String(v || "").replace(/'/g, "\\'");

    // クロス商談が既に立ち上がっている会社は、新しくクロスリードを作らない。
    // 初回商談日（CloseDate）が指定日以降で、レコードタイプが「クロス」の商談を持つ会社を集める。
    // 既定は 2026-03-01。取り込み時に crossFrom（YYYY-MM-DD）で変えられる。
    const CROSS_FROM = /^\d{4}-\d{2}-\d{2}$/.test(String(b.crossFrom || "")) ? b.crossFrom : "2026-03-01";
    const crossOppCompanies = new Set();
    try {
      if (salesforceConfigured() && (await sfConnected(sfUser).catch(() => false))) {
        const d = await sfQuery(sfUser,
          `SELECT Id, CloseDate, Account.Name, RecordType.Name FROM Opportunity ` +
          `WHERE CloseDate >= ${CROSS_FROM} AND RecordType.Name LIKE '%クロス%' LIMIT 5000`);
        for (const o of d.records || []) {
          const co = (o.Account && o.Account.Name) || "";
          if (co) crossOppCompanies.add(normCompanyKey(co));
        }
      }
    } catch (e) { console.warn("[kincall] クロス商談の確認に失敗:", e.message); }

    const 結果 = [];
    // この取り込みの中で、同じ相手・同じ結果・同じコメントの活動を二度作らないための覚え書き
    const 記録済み = new Set();
    for (const r of 行) {
      const company = String(r.company || "").trim();
      const person = String(r.person || "").trim();
      const phone = String(r.phone || "").trim();
      const email = String(r.email || "").trim();
      if (!company) { 結果.push({ company, 状態: "とばした", 理由: "会社名がありません" }); continue; }

      // クロス商談（初回商談日2026-03-01以降）が既にある会社は、アポ獲得済み扱い。
      // リードの検索・作成もせず、リストにも入れない。見つかったことは明細に出す。
      if (crossOppCompanies.has(normCompanyKey(company))) {
        結果.push({ company, person: person || "担当者", phone,
          状態: "クロス商談あり（アポ獲得済み）",
          リード種別: "クロス商談あり", クロス商談: true,
          架電日: ymdOf(r.callDate), ...振り分け(r) });
        continue;
      }

      // kincallのみ（SF更新なし）：リードの検索・作成・活動履歴・所有者付け替えをすべて飛ばし、
      // CSVの中身だけでリストに入れる。大量（余り）でも一気に速い。
      if (r.kincallOnly) {
        const { ステータス, コメント } = 振り分け(r);
        結果.push({
          company, person: person || "担当者", phone, email, leadId: "",
          状態: "kincallのみ（SF更新なし）", リード種別: "（SFなし）",
          架電日: ymdOf(r.callDate), ステータス, ステージ: String(r.stage || "").trim(),
          コメント, まとめ: String(r.history || "").trim(),
          kincallOnly: true,
          assignedTo: String(r.assignedTo || "").trim().toLowerCase(),
          targetList: parseInt(r.targetList, 10) || 0,
          newListFor: String(r.newListFor || "").trim().toLowerCase(),
        });
        continue;
      }

      // 1) リードIDがCSVにあればそれを使う。無ければ会社名で探す。
      let leadId = String(r.leadId || "").trim();
      let 状態 = "";
      let リード種別 = "";
      if (leadId) { 状態 = "IDで指定"; リード種別 = "IDで指定"; }
      try {
        if (leadId) throw { skip: true };
        const key = normCompanyKey(company);
        const 語 = company.replace(/株式会社|（株）|\(株\)|㈱|有限会社|社会福祉法人|学校法人|一般社団法人/g, "").trim().slice(0, 30);
        const soql =
          `SELECT Id, Company, LastName, Phone, IsConverted, RecordType.Name FROM Lead ` +
          `WHERE IsConverted = false AND Company LIKE '%${sq(語)}%' LIMIT 50`;
        const d = await sfQuery(sfUser, soql);
        const cands = (d.records || []).filter((x) => normCompanyKey(x.Company) === key);
        const 種別 = (x) => String((x.RecordType && x.RecordType.Name) || "");
        const cross = cands.find((x) => /クロス|cross/i.test(種別(x)));
        if (cross) {
          // クロスリードがあれば、それを使う
          leadId = cross.Id; 状態 = "見つかった（クロス）"; リード種別 = 種別(cross) || "クロス";
        } else if (cands.length) {
          // MOCHICAなど別の種別しか無いときは、そのリードは残したまま
          // クロスリードを新しく作る（下の「無ければ作る」に進む）
          リード種別 = 種別(cands[0]) || "別の種別";
          状態 = `別の種別だけ（${リード種別}）`;
        }
      } catch (e) {
        if (!e || !e.skip) { 結果.push({ company, 状態: "探せなかった", 理由: e.message }); continue; }
      }

      // 2) 無ければ新しく作る
      if (!leadId) {
        if (dryRun) {
          結果.push({ company, person: person || "担当者", phone,
            状態: リード種別 && !/クロス|IDで指定/.test(リード種別)
              ? `クロスを新しく作る（${リード種別}は残す）` : "新しく作る（予定）",
            リード種別: "クロス（新規）",
            架電日: ymdOf(r.callDate), 履歴: ymdOf(r.callDate) ? "履歴を残す（予定）" : "",
            ...振り分け(r) });
          continue;
        }
        try {
          const fields = {
            Company: company,
            LastName: person || "担当者",   // 担当者名が無いときは「担当者」
            ...(phone ? { Phone: phone } : {}),
            ...(email ? { Email: email } : {}),
            ...(rtId ? { RecordTypeId: rtId } : {}),
          };
          const made = await createLead(sfUser, fields);
          leadId = made.id;
          状態 = リード種別 && リード種別 !== "IDで指定" && !/クロス/.test(リード種別)
            ? `クロスを新しく作った（${リード種別}は残す）`
            : "新しく作った";
          リード種別 = "クロス（新規）";
        } catch (e) {
          結果.push({ company, 状態: "作れなかった", 理由: e.message }); continue;
        }
      } else if (dryRun) {
        const まとめ = String(r.history || "").trim();
        結果.push({ company, person: person || "担当者", leadId, 状態, リード種別,
          架電日: ymdOf(r.callDate), 履歴: ymdOf(r.callDate) ? "履歴を残す（予定）" : "",
          まとめ, まとめ履歴: まとめ ? "まとめて残す（予定）" : "",
          ...振り分け(r) });
        continue;
      }

      // 架電日・ステータス・コメントのどれかがあれば、Salesforceに活動履歴を残す。
      // 架電日が無いぶんも、コメントを残せるよう今日の日付で作る（履歴で見えるように）。
      let 履歴 = "";
      const 架電日 = ymdOf(r.callDate);
      const { ステータス, コメント } = 振り分け(r);
      if (!dryRun && leadId && (架電日 || ステータス || コメント)) {
        const 日 = 架電日 || jstDate(0);
        const 記録キー = `${leadId}|${ステータス}|${コメント}`;
        if (記録済み.has(記録キー)) {
          // 同じ取り込みの中で、同じ相手に全く同じ内容を既に処理済み → 二度作らない
          履歴 = "同じ内容なので残しませんでした";
        } else {
          記録済み.add(記録キー);
          try {
            // その相手の活動をまとめて読み、説明（結果・コメント）が同じものがあれば作らない。
            // 件名はSalesforce側で「日付＋所有者」に書き換わることがあるので、件名や日付では判定しない。
            const q = await sfQuery(
              sfUser,
              `SELECT Id, Description FROM Task WHERE WhoId='${sq(leadId)}' ORDER BY CreatedDate DESC LIMIT 200`
            ).catch(() => ({ records: [] }));
            const 同じがある = (q.records || []).some((t) => {
              const desc = String(t.Description || "");
              if (!desc.includes("CSVから取り込み")) return false;   // CSV由来だけを対象
              const okStatus = ステータス ? desc.includes(`結果：${ステータス}`) : true;
              const okComment = コメント ? desc.includes(`コメント：${コメント}`) : true;
              return okStatus && okComment;
            });
            if (同じがある) {
              履歴 = "既にあるので残しませんでした";
            } else {
              await createTask(sfUser, {
                WhoId: leadId,
                Subject: `コール：${ステータス || "架電"}`,
                Status: "完了", Type: "Call",
                ActivityDate: 日,
                Description: [
                  ステータス ? `結果：${ステータス}` : "",
                  コメント ? `コメント：${コメント}` : "",
                  `CSVから取り込み（記録した人：${await displayNameOf(req.user).catch(() => req.user)}）`,
                ].filter(Boolean).join("\n"),
              });
              履歴 = "履歴を残した";
            }
          } catch (e) { 履歴 = `履歴を残せなかった（${String(e.message).slice(0, 60)}）`; }
        }
      } else if ((架電日 || コメント || ステータス) && dryRun) {
        履歴 = "履歴を残す（予定）";
      }

      // H以降（コール結果1〜6）を、新しい順にまとめて1件の履歴として残す
      const まとめ = String(r.history || "").trim();
      let まとめ履歴 = "";
      if (まとめ) {
        if (dryRun) {
          まとめ履歴 = "まとめて残す（予定）";
        } else if (leadId) {
          const キー = `${leadId}|まとめ|${まとめ}`;
          if (記録済み.has(キー)) {
            まとめ履歴 = "同じまとめがあるので残しませんでした";
          } else {
            記録済み.add(キー);
            try {
              const q2 = await sfQuery(
                sfUser,
                `SELECT Id, Description FROM Task WHERE WhoId='${sq(leadId)}' ORDER BY CreatedDate DESC LIMIT 200`
              ).catch(() => ({ records: [] }));
              const ある = (q2.records || []).some((t) =>
                String(t.Description || "").includes("コール履歴（まとめ・新しい順）") &&
                String(t.Description || "").includes(まとめ.slice(0, 40)));
              if (ある) {
                まとめ履歴 = "既にあるので残しませんでした";
              } else {
                await createTask(sfUser, {
                  WhoId: leadId,
                  Subject: "コール履歴（まとめ）",
                  Status: "完了", Type: "Call",
                  ActivityDate: jstDate(0),
                  Description: `コール履歴（まとめ・新しい順）\n${まとめ}\nCSVから取り込み（記録した人：${await displayNameOf(req.user).catch(() => req.user)}）`,
                });
                まとめ履歴 = "まとめて残した";
              }
            } catch (e) { まとめ履歴 = `まとめを残せなかった（${String(e.message).slice(0, 60)}）`; }
          }
        }
      }

      結果.push({ company, person: person || "担当者", phone, email, leadId, 状態, リード種別, 架電日,
        ステータス, ステージ: String(r.stage || "").trim(), コメント, 履歴, まとめ, まとめ履歴,
        // フロントで割り付けた「担当」と「追加先リスト」を尊重する（メンバーごとの件数・リスト指定）
        assignedTo: String(r.assignedTo || "").trim().toLowerCase(),
        targetList: parseInt(r.targetList, 10) || 0,
        // 「新しいリストにする」を選んだメンバーは、その人の新規リストへ入れる
        newListFor: String(r.newListFor || "").trim().toLowerCase() });
    }

    if (dryRun) {
      // 試算でも「現リード所有者」を出す
      try {
        const owners = await leadOwnerNames(sfUser, 結果.map((x) => x.leadId).filter(Boolean));
        for (const x of 結果) if (x.leadId) x["所有者"] = owners.get(String(x.leadId)) || owners.get(String(x.leadId).slice(0, 15)) || "";
      } catch {}
      return res.json({
        ok: true, 試算: true, 件数: 結果.length,
        見つかった: 結果.filter((x) => String(x.状態).startsWith("見つかった")).length,
        新しく作る: 結果.filter((x) => x.状態 === "新しく作る（予定）").length,
        とばす: 結果.filter((x) => x.状態 === "とばした" || x.状態 === "探せなかった").length,
        明細: 結果.slice(0, 200),
      });
    }

    const 入れるもの = 結果.filter((x) => x.leadId || x.kincallOnly);
    if (!入れるもの.length) return res.status(400).json({ error: "リストに入れられるものがありませんでした", 明細: 結果.slice(0, 50) });

    const 既存 = parseInt(b.listId, 10) || 0;
    // 分ける人が指定されていれば、順番に均等に配る（kincallの担当だけ。SFは変えない）
    const 分ける人 = (Array.isArray(b.share) ? b.share : [])
      .map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
    // 分配するときは、リストの持ち主も分ける人にする（作成者のカードに出さないため）。
    const listOwner = String(b.member || "").trim().toLowerCase() || 分ける人[0] || req.user;
    const list = 既存
      ? { id: 既存, name }
      : await createCallList({ name, owner: listOwner, createdBy: req.user });
    // 小分けで送られてくるので、続きから配れるように今の件数を数える
    let 開始 = 0;
    if (分ける人.length && 既存) {
      try {
        const now = await listCallTargets(既存, { limit: 5000 });
        開始 = now.length;
      } catch {}
    }
    const 入れるリスト = 入れるもの.map((x, i) => ({
      leadId: x.leadId, company: x.company, person: x.person, phone: x.phone, email: x.email,
      ...(x["ステータス"] ? { status: x["ステータス"] } : {}),
      ...(x["ステージ"] ? { stage: x["ステージ"] } : {}),
      // かけるリストのメモに、H以降のまとめ（新しい順）を入れる。無ければ最終活動コメント。
      ...((x["まとめ"] || x["コメント"]) ? { memo: x["まとめ"] || x["コメント"] } : {}),
      // 担当：フロントで割り付けた人を優先。無ければ従来の均等割り。
      ...(x.assignedTo ? { assignedTo: x.assignedTo }
        : 分ける人.length ? { assignedTo: 分ける人[(開始 + i) % 分ける人.length] } : {}),
      // 追加先リスト：フロントでメンバーごとに指定していればそのリストへ。無ければこのリスト。
      _targetList: x.targetList || list.id,
      newListFor: x.newListFor || "",
    }));

    // 「新しいリストにする」を選んだメンバーぶん、その人のリストを1つ作って振り分ける。
    // かたまり（chunk）ごとに毎回作らないよう、同じ名前・持ち主の直近のリストがあれば使い回す。
    // （これで、余りを受ける人に既存リストが無くても、新規リストを1つだけ作って入れられる）
    try {
      const newFor = [...new Set(入れるリスト.filter((x) => x.newListFor).map((x) => x.newListFor))];
      for (const em of newFor) {
        const nlName = `${name} - ${em}`;
        let nl = await findRecentListByNameOwner(nlName, em).catch(() => null);
        if (!nl) nl = await createCallList({ name: nlName, owner: em, createdBy: req.user });
        if (nl) for (const x of 入れるリスト) if (x.newListFor === em) x._targetList = nl.id;
      }
    } catch (e) { console.warn("[kincall] 新しいリスト作成に失敗:", e.message); }

    // クローザー所有のリードを、インサイドに割り振るぶんだけ中澤良太の所有へ変える（ジャッジは除く）
    let 所有者変更 = 0, 所有者メモ = "";
    try {
      const insideSet = await insideEmailSet();
      const listOwner = String(b.member || req.user).toLowerCase();
      const insideLeadIds = 入れるリスト
        .filter((x) => x.leadId && insideSet.has(String(x.assignedTo || listOwner).toLowerCase()))
        .map((x) => x.leadId);
      if (insideLeadIds.length) {
        const r = await reassignCloserLeadsToProxy(sfUser, insideLeadIds);
        所有者変更 = r.changed;
        if (r.judge) 所有者メモ = `ジャッジ ${r.judge}件は所有者を変えていません`;
        if (r.errors.length) 所有者メモ = (所有者メモ ? 所有者メモ + " ／ " : "") + r.errors.slice(0, 2).join(" ／ ");
      }
    } catch (e) { 所有者メモ = "所有者の付け替えでエラー：" + String(e.message).slice(0, 80); }

    // 付け替え後の「現在の所有者」を取って、リストに持たせる（かける表に出す）
    try {
      const owners = await leadOwnerNames(sfUser, 入れるリスト.map((x) => x.leadId));
      for (const x of 入れるリスト) if (x.leadId) x.ownerName = owners.get(String(x.leadId)) || owners.get(String(x.leadId).slice(0, 15)) || "";
    } catch {}

    // 追加先リストごとに分けて入れる（メンバーごとに別のリストへ振り分けられるように）。
    const byList = new Map();
    for (const x of 入れるリスト) {
      const lid = x._targetList || list.id;
      if (!byList.has(lid)) byList.set(lid, []);
      byList.get(lid).push(x);
    }
    let n = 0;
    for (const [lid, arr] of byList) n += await addCallTargets(lid, arr, { dedupe: true });
    const 重複除外 = 入れるリスト.length - n;

    console.log(`[kincall] CSVからリスト「${name}」を作りました（${n}件／新規リード${結果.filter((x)=>x.状態==="新しく作った").length}件${重複除外 ? `／重複除外 ${重複除外}件` : ""}${所有者変更 ? `／所有者変更 ${所有者変更}件` : ""}） by ${req.user}`);
    res.json({
      ok: true, id: list.id, name: list.name, 件数: n, 重複除外, 所有者変更, 所有者メモ,
      見つかった: 結果.filter((x) => String(x.状態).startsWith("見つかった")).length,
      新しく作った: 結果.filter((x) => x.状態 === "新しく作った").length,
      クロス商談あり: 結果.filter((x) => String(x.状態 || "").includes("クロス商談あり")).length,
      kincallのみ: 結果.filter((x) => x.kincallOnly).length,
      とばした: 結果.filter((x) => !x.leadId).length,
      履歴を残した: 結果.filter((x) => x["履歴"] === "履歴を残した").length,
      履歴済み: 結果.filter((x) => x["履歴"] === "既にあるので残しませんでした" || x["履歴"] === "同じ内容なので残しませんでした").length,
      作れなかった: 結果.filter((x) => x.状態 === "作れなかった").length,
      探せなかった: 結果.filter((x) => x.状態 === "探せなかった").length,
      履歴失敗: 結果.filter((x) => String(x["履歴"] || "").startsWith("履歴を残せなかった")).length,
      失敗理由: [...new Set(結果.filter((x) => x.理由 || String(x["履歴"] || "").startsWith("履歴を残せなかった"))
        .map((x) => x.理由 || x["履歴"]))].slice(0, 8),
      分けた人数: 分ける人.length,
      明細: 結果.slice(0, 200),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// リストを作る（Salesforceのリードを検索して入れる／貼り付けからも作れる）
app.post("/api/calls/lists", async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim() || `コールリスト ${jstDate(0)}`;
    // 分配（assignTo）を指定したときは、持ち主も分ける人にする（作成者のカードに出さないため）
    const who0 = (Array.isArray(b.assignTo) ? b.assignTo : []).map((x) => String(x).toLowerCase()).filter(Boolean);
    const list = await createCallList({ name, owner: who0[0] || req.user, note: b.note, createdBy: req.user });
    if (!list) return res.status(500).json({ error: "リストを作れませんでした" });

    let items = [];
    if (Array.isArray(b.items) && b.items.length) {
      // 貼り付け（会社名・担当者名・電話）から作る
      items = b.items.slice(0, 5000);
    } else if (b.fromSalesforce) {
      // Salesforceのリードから作る
      const found = await searchLeads(req.user, {
        company: String(b.company || ""), person: "", limit: Math.min(200, Number(b.limit) || 50),
      }).catch((e) => { throw new Error(`Salesforceから取れません：${e.message}`); });
      items = (found || []).map((l) => ({
        leadId: l.Id,
        company: l.Company || "",
        person: [l.LastName, l.FirstName].filter(Boolean).join(" "),
        phone: l.Phone || l.MobilePhone || "",
        email: l.Email || "",
        industry: l.Industry || "",
        area: l.State || l.City || "",
      }));
    }

    // かける人へ順番に配る（指定があれば）
    const who = who0;
    if (who.length) items = items.map((x, i) => ({ ...x, assignedTo: who[i % who.length] }));

    const n = await addCallTargets(list.id, items, { dedupe: true });
    const 重複除外 = items.length - n;

    // クローザー所有のリードを、インサイドに割り振るぶんだけ中澤良太の所有へ変える（ジャッジは除く）
    let 所有者変更 = 0, 所有者メモ = "";
    try {
      const insideSet = await insideEmailSet();
      const insideLeadIds = items
        .filter((x) => x.leadId && insideSet.has(String(x.assignedTo || req.user).toLowerCase()))
        .map((x) => x.leadId);
      if (insideLeadIds.length) {
        const r = await reassignCloserLeadsToProxy(await pickSfUser(req.user), insideLeadIds);
        所有者変更 = r.changed;
        if (r.judge) 所有者メモ = `ジャッジ ${r.judge}件は所有者を変えていません`;
        if (r.errors.length) 所有者メモ = (所有者メモ ? 所有者メモ + " ／ " : "") + r.errors.slice(0, 2).join(" ／ ");
      }
    } catch (e) { 所有者メモ = "所有者の付け替えでエラー：" + String(e.message).slice(0, 80); }

    console.log(`[コール] リスト「${name}」を作りました（${n}件${重複除外 ? `／重複除外 ${重複除外}件` : ""}${所有者変更 ? `／所有者変更 ${所有者変更}件` : ""}）by ${req.user}`);
    res.json({ ok: true, id: list.id, name, 件数: n, 重複除外, 所有者変更, 所有者メモ });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 架電の結果に使う選択肢を、Salesforceから取ってくる。
//
// 「担当者不在」「コールのみ」「担当者接触：アポ獲得」など、
// 組織ごとに決まっている値をそのまま使う。
// 取れないときは、kinbotの決まった区分にする。
let _callPicks = null;
async function callPicklists(owner) {
  if (_callPicks && Date.now() - _callPicks.at < 30 * 60 * 1000) return _callPicks.data;
  const out = { 活動の結果: [], リードの状態: [], 元: "kinbot" };
  try {
    // 活動（Task）の結果。組織によって項目名が違うので、それらしいものを探す。
    const td = await describeTask(owner);
    const cand = (td.fields || []).filter((f) =>
      f.type === "picklist" &&
      /(status|result|subtype|type|活動|結果|区分)/i.test(`${f.name} ${f.label}`));
    // いちばん選択肢が多いものを使う（結果の区分は数が多い）
    const best = cand.sort((a, b) =>
      (b.picklistValues || []).length - (a.picklistValues || []).length)[0];
    if (best) {
      out.活動の結果 = (best.picklistValues || [])
        .filter((v) => v.active)
        .map((v) => ({ value: v.value, label: v.label || v.value }));
      out.項目 = best.name;
      out.項目名 = best.label;
      out.元 = "salesforce";
    }
  } catch (e) { console.warn("[kincall] 活動の選択肢を取れません:", e.message); }

  try {
    const desc = await describeObject(owner, "Lead");
    const f = (desc.fields || []).find((x) => x.name === "Status");
    const all = ((f && f.picklistValues) || [])
      .filter((v) => v.active)
      .map((v) => ({ value: v.value, label: v.label || v.value }));
    // 実際に使うステージだけを、決めた順に出す
    // 「01：新規」のように番号が付いているものを、番号の小さい順に並べる。
    // リサイクル・アーカイブなど番号が大きいものも、そのまま後ろに並ぶ。
    const 番号 = (v) => {
      const m = String(v.label || v.value).match(/^\s*0*(\d+)/);
      return m ? Number(m[1]) : 9999;
    };
    const 番号付き = all.filter((v) => 番号(v) !== 9999).sort((a, b) => 番号(a) - 番号(b));
    out.リードの状態 = 番号付き.length ? 番号付き : all;
  } catch (e) { console.warn("[kincall] リードの状態を取れません:", e.message); }

  // 実際に使う結果だけに絞る。
  // SFには使わない値もたくさん入っているので、架電で選ぶものだけを出す。
  const 使うもの = [
    "受付ブロック", "担当者不在", "担当者接触：お断り", "担当者接触：アポ獲得",
    "担当者接触：営業フォロー", "現在使われていない", "コールのみ", "問い合わせ",
  ];
  const norm = (v) => String(v || "").replace(/[\s　:：]/g, "");
  const 絞った = 使うもの
    .map((w) => out.活動の結果.find((v) => norm(v.label) === norm(w) || norm(v.value) === norm(w))
      || { value: w, label: w });
  out.活動の結果 = 絞った;

  if (!out.活動の結果.length) {
    out.活動の結果 = CALL_RESULTS.map((x) => ({ value: x.key, label: x.key }));
  }
  _callPicks = { at: Date.now(), data: out };
  return out;
}

app.get("/api/calls/picklists", async (req, res) => {
  try {
    if (String(req.query.refresh || "") === "1") _callPicks = null;
    // SFアカウントの無い人でも選択肢を出せるよう、代わりに更新する人の連携を使う
    let owner = req.user;
    if (!(await sfConnected(owner).catch(() => false))) {
      const st = await getSettings().catch(() => ({}));
      const 代理 = String(st.sfProxyUser || "").trim().toLowerCase();
      if (代理 && (await sfConnected(代理).catch(() => false))) owner = 代理;
    }
    const d = await callPicklists(owner);
    res.json({ ok: true, ...d });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Salesforceのリードを探して、その場でkincallに入れる
app.post("/api/calls/from-leads", async (req, res) => {
  try {
    const b = req.body || {};
    const listId = parseInt(b.listId, 10);
    const found = await searchLeads(req.user, {
      company: String(b.company || ""),
      person: String(b.person || ""),
      limit: Math.min(50, Number(b.limit) || 30),
    });
    const items = (found || []).map((l) => ({
      leadId: l.Id,
      company: l.Company || "",
      person: [l.LastName, l.FirstName].filter(Boolean).join(" "),
      phone: l.Phone || "",
      email: l.Email || "",
      industry: l.Title || "",
      area: l.State || l.City || "",
      stage: (l.RecordType && l.RecordType.Name) || "",
      status: l.Status || "",
    }));
    // 見るだけ（まだ入れない）
    if (!listId) return res.json({ ok: true, 件数: items.length, items });

    const n = await addCallTargets(listId, items, { dedupe: true });
    const 重複除外 = items.length - n;
    console.log(`[kincall] リードを${n}件入れました${重複除外 ? `（重複除外 ${重複除外}件）` : ""} by ${req.user}`);
    res.json({ ok: true, 入れた数: n, 重複除外 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 架電先リードの所有者付け替え =====
// クローザーが所有しているリードを、インサイドに割り振るときに中澤良太の所有へ変える。
// ・現在の所有者がクローザーのものだけが対象
// ・リード状況が「ジャッジ」のものは変えない
const NAKAZAWA_EMAIL = "ryota.nakazawa@neo-career.co.jp";

// SF操作に使う連携アカウント（自分が未連携なら「代わりに更新する人」）
async function pickSfUser(user) {
  if (await sfConnected(user).catch(() => false)) return user;
  const st = await getSettings().catch(() => ({}));
  const 代理 = String(st.sfProxyUser || "").trim().toLowerCase();
  if (代理 && (await sfConnected(代理).catch(() => false))) return 代理;
  return user;
}

// インサイドのメンバーのメール一覧（roles に inside、または interns にいる人）
async function insideEmailSet() {
  const [members, interns] = await Promise.all([
    listMembers().catch(() => []),
    listInterns().catch(() => []),
  ]);
  const iset = new Set((interns || []).map((x) => String(x.email || "").toLowerCase()).filter(Boolean));
  const s = new Set();
  for (const m of members || []) {
    const em = String(m.email || "").toLowerCase();
    if (!em) continue;
    if ((Array.isArray(m.roles) && m.roles.includes("inside")) || iset.has(em)) s.add(em);
  }
  return s;
}

// クローザー所有のリードを、中澤良太の所有に付け替える。
// leadIds… インサイドに割り振るリードのIDだけを渡すこと。
async function reassignCloserLeadsToProxy(sfUser, leadIds, { dryRun = false } = {}) {
  const out = { changed: 0, judge: 0, notCloser: 0, already: 0, errors: [] };
  const ids = [...new Set((leadIds || []).map((x) => String(x || "").trim()).filter(Boolean))];
  if (!ids.length) return out;
  if (!salesforceConfigured() || !(await sfConnected(sfUser).catch(() => false))) {
    out.errors.push("Salesforceにつながっていないため、所有者は変更していません");
    return out;
  }
  const members = await listMembers().catch(() => []);
  const closerEmails = new Set(
    (members || []).filter((m) => Array.isArray(m.roles) && m.roles.includes("closer"))
      .map((m) => String(m.email || "").toLowerCase()).filter(Boolean));
  if (!closerEmails.size) return out;   // クローザーがいなければ何もしない

  const nakaId = await sfUserIdByEmail(sfUser, NAKAZAWA_EMAIL).catch(() => "");
  if (!nakaId) { out.errors.push("中澤良太のSalesforceユーザーが見つかりません"); return out; }

  const esc = (v) => String(v).replace(/[^a-zA-Z0-9]/g, "");
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const inList = chunk.map((x) => `'${esc(x)}'`).join(",");
    let recs = [];
    try {
      const d = await sfQuery(sfUser, `SELECT Id, OwnerId, Owner.Email, Status FROM Lead WHERE Id IN (${inList})`);
      recs = d.records || [];
    } catch (e) { out.errors.push(`リードの所有者を取れません：${String(e.message).slice(0, 80)}`); continue; }
    for (const r of recs) {
      const ownerEmail = String((r.Owner && r.Owner.Email) || "").toLowerCase();
      if (!closerEmails.has(ownerEmail)) { out.notCloser++; continue; }        // クローザー所有でない
      if (/ジャッジ/.test(String(r.Status || ""))) { out.judge++; continue; }   // ジャッジは変えない
      if (String(r.OwnerId) === String(nakaId)) { out.already++; continue; }    // すでに中澤
      if (dryRun) { out.changed++; continue; }
      try { await updateLead(sfUser, r.Id, { OwnerId: nakaId }); out.changed++; }
      catch (e) { out.errors.push(`${r.Id} の所有者変更に失敗：${String(e.message).slice(0, 80)}`); }
    }
  }
  if (!dryRun && out.changed) {
    console.log(`[kincall] クローザー所有のリードを中澤良太に付け替え：${out.changed}件（ジャッジ除外 ${out.judge}）`);
  }
  return out;
}

// リードの現在の所有者名をまとめて取る（leadId → 所有者名）
async function leadOwnerNames(sfUser, leadIds) {
  const map = new Map();
  const ids = [...new Set((leadIds || []).map((x) => String(x || "").trim()).filter(Boolean))];
  if (!ids.length) return map;
  if (!salesforceConfigured() || !(await sfConnected(sfUser).catch(() => false))) return map;
  const esc = (v) => String(v).replace(/[^a-zA-Z0-9]/g, "");
  for (let i = 0; i < ids.length; i += 200) {
    const inList = ids.slice(i, i + 200).map((x) => `'${esc(x)}'`).join(",");
    try {
      const d = await sfQuery(sfUser, `SELECT Id, Owner.Name FROM Lead WHERE Id IN (${inList})`);
      for (const r of d.records || []) {
        const nm = (r.Owner && r.Owner.Name) || "";
        map.set(String(r.Id), nm);
        map.set(String(r.Id).slice(0, 15), nm);   // 15桁でも引けるように
      }
    } catch {}
  }
  return map;
}

// レポートの表を、そのままkincallのリストにする。
// 列の名前から「会社名・担当者・電話・メール・ステージ・状態」を見つける。
app.post("/api/calls/from-report", async (req, res) => {
  try {
    const b = req.body || {};
    const cols = (b.columns || []).map((c) => String(c.label || c || ""));
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (!rows.length) return res.status(400).json({ error: "中身がありません" });

    // 列の見つけ方。言い方の違いを吸収する。
    const find = (...words) => {
      const norm = (v) => String(v || "").replace(/[\s　_・]/g, "").toLowerCase();
      for (const w of words) {
        const i = cols.findIndex((c) => norm(c).includes(norm(w)));
        if (i >= 0) return i;
      }
      return -1;
    };
    const ix = {
      company: find("会社名", "会社", "company", "取引先"),
      person: find("担当者名", "担当者", "姓", "名前", "氏名", "name"),
      phone: find("電話", "phone", "tel"),
      email: find("メール", "email", "mail"),
      stage: find("リード状況", "リード 状況", "状況", "ステージ", "status"),
      status: find("最終活動ステータス", "活動ステータス", "最終ステータス"),
      leadId: find("リードid", "lead id", "レコードid", "id"),
    };
    if (ix.company < 0 && ix.phone < 0) {
      return res.status(400).json({ error: "会社名か電話番号の列が見つかりません", 列: cols });
    }

    const at = (row, i) => (i >= 0 ? String(row[i] ?? "").trim() : "");
    const items = rows.map((row) => ({
      leadId: at(row, ix.leadId) || null,
      company: at(row, ix.company),
      person: at(row, ix.person),
      phone: at(row, ix.phone),
      email: at(row, ix.email),
      // ステージは「リード状況」（01：新規・02：担当者未接触・04：ジャッジ など）
      stage: at(row, ix.stage),
      status: at(row, ix.status),
    })).filter((x) => x.company || x.phone);

    if (!items.length) return res.status(400).json({ error: "入れられる行がありませんでした" });

    // レポートにはリードIDの列が無いことが多い。
    // IDが無いとSalesforceの履歴とつながらないので、会社名と電話で照らし合わせて補う。
    let 紐づけた = 0;
    const 足りない = items.filter((x) => !x.leadId);
    if (足りない.length && salesforceConfigured() && (await sfConnected(req.user).catch(() => false))) {
      try {
        // 会社名でまとめて引き当てる（80件ずつ）
        for (let i = 0; i < 足りない.length; i += 80) {
          const part = 足りない.slice(i, i + 80);
          const names = part.map((x) => `'${String(x.company).replace(/['\\]/g, "")}'`).filter((v) => v.length > 2);
          if (!names.length) continue;
          const d = await sfQuery(req.user,
            `SELECT Id, Company, Phone, MobilePhone FROM Lead ` +
            `WHERE IsConverted = false AND Company IN (${names.join(",")}) LIMIT 500`);
          const byName = new Map();
          for (const r of d.records || []) {
            const k = String(r.Company || "");
            if (!byName.has(k)) byName.set(k, []);
            byName.get(k).push(r);
          }
          const num = (v) => String(v || "").replace(/[^0-9]/g, "");
          for (const x of part) {
            const cand = byName.get(x.company) || [];
            if (!cand.length) continue;
            // 同じ会社が何件もあるときは、電話番号で決める
            const hit = cand.length === 1 ? cand[0]
              : cand.find((r) => num(r.Phone) === num(x.phone) || num(r.MobilePhone) === num(x.phone));
            if (hit) { x.leadId = hit.Id; 紐づけた++; }
          }
        }
      } catch (e) { console.warn("[kincall] リードの引き当てでつまずきました:", e.message); }
    }
    console.log(`[kincall] リードIDを${紐づけた}件つなぎました（列に無かったぶん ${足りない.length}）`);

    const name = String(b.name || "").trim() || `リスト ${jstDate(0)}`;
    // 送り先のメンバーを選べる（指定がなければ自分のリストになる）
    const toMember = String(b.member || "").trim().toLowerCase();
    // 分ける人が選ばれていれば、順番に均等に配る
    const 分ける人R = (Array.isArray(b.share) ? b.share : [])
      .map((x) => String(x || "").trim().toLowerCase()).filter(Boolean);
    // 分配するときは、持ち主も分ける人にする（作成者のカードに出さないため）
    const 既存R = parseInt(b.listId, 10) || 0;
    const list = 既存R
      ? { id: 既存R, name }
      : await createCallList({ name, owner: toMember || 分ける人R[0] || req.user, createdBy: req.user });
    if (!list) return res.status(500).json({ error: "リストを作れませんでした" });
    const n = await addCallTargets(list.id, 入れる, { dedupe: true });
    const 重複除外 = 入れる.length - n;

    // クローザー所有のリードを、インサイドに割り振るぶんだけ中澤良太の所有へ変える（ジャッジは除く）
    let 所有者変更 = 0, 所有者メモ = "";
    try {
      const insideSet = await insideEmailSet();
      const listOwner = String(toMember || req.user).toLowerCase();
      const insideLeadIds = 入れる
        .filter((x) => x.leadId && insideSet.has(String(x.assignedTo || listOwner).toLowerCase()))
        .map((x) => x.leadId);
      if (insideLeadIds.length) {
        const r = await reassignCloserLeadsToProxy(await pickSfUser(req.user), insideLeadIds);
        所有者変更 = r.changed;
        if (r.judge) 所有者メモ = `ジャッジ ${r.judge}件は所有者を変えていません`;
        if (r.errors.length) 所有者メモ = (所有者メモ ? 所有者メモ + " ／ " : "") + r.errors.slice(0, 2).join(" ／ ");
      }
    } catch (e) { 所有者メモ = "所有者の付け替えでエラー：" + String(e.message).slice(0, 80); }

    console.log(`[kincall] レポートから${n}件をリスト「${name}」に入れました` +
      (分ける人R.length ? `（${分ける人R.length}人に分けた）` : "") +
      (重複除外 ? `／重複除外 ${重複除外}件` : "") +
      (所有者変更 ? `／所有者変更 ${所有者変更}件` : "") + ` by ${req.user}`);
    res.json({
      ok: true, id: list.id, name, 件数: n, 重複除外, 所有者変更, 所有者メモ, 見つけた列: ix, 分けた人数: 分ける人R.length,
      リードとつないだ数: 紐づけた,
      note: 紐づけた < 足りない.length
        ? `${足りない.length - 紐づけた}件は、Salesforceのリードと結びつけられませんでした（会社名が一致しないなど）`
        : "",
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 架電の結果としてよく使われる言い方。説明の中から見つけるのに使う。
// 長いものを先に置く（「担当者接触：お断り」より前に「担当者不在」を見ないように）
const 既知の結果 = [
  "担当者接触：アポ獲得", "担当者接触：営業フォロー", "担当者接触：お断り",
  "担当者接触：セミナー予約", "現在使われていない", "受付ブロック",
  "担当者不在", "コールのみ", "問い合わせ",
];

// 同じ失敗を何度も出さないための小さな道具
let _lastFail = "";
function failedOnce(e, n) {
  const m = String((e && e.message) || e).slice(0, 200);
  if (m !== _lastFail) { console.warn("[kincall] 活動の件数を数えられません:", m); _lastFail = m; }
}

// SalesforceのIDは15桁と18桁が混在する（レポートのCSV取込は15桁、API取得は18桁）。
// 先頭15桁がIDの実体なので、そこにそろえて突き合わせる。
function id15(v) {
  return String(v || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 15);
}

// リストの中身の内訳（ステージ・最終ステータスの種類と件数）
app.get("/api/calls/facets", async (req, res) => {
  try {
    const listId = parseInt(req.query.list, 10);
    if (!listId) return res.status(400).json({ error: "リストを選んでください" });
    const d = await callListFacets(listId);
    res.json({
      ok: true,
      ステージ: d.stages.map((x) => ({ 値: x.v || "（なし）", 生: x.v, 件数: x.n })),
      最終ステータス: d.statuses.map((x) => ({ 値: x.v || "（なし）", 生: x.v, 件数: x.n })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 条件に当てはまるものが何件あるか（消す前の下見）
app.post("/api/calls/targets/count", async (req, res) => {
  try {
    const listId = parseInt(req.body?.listId, 10);
    if (!listId) return res.status(400).json({ error: "リストを選んでください" });
    const n = await countCallTargets(listId, {
      stages: Array.isArray(req.body?.stages) ? req.body.stages : [],
      statuses: Array.isArray(req.body?.statuses) ? req.body.statuses : [],
      hist: String(req.body?.hist || ""),
    });
    res.json({ ok: true, 件数: n });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 条件に当てはまるものを消す
app.post("/api/calls/targets/delete", async (req, res) => {
  try {
    const listId = parseInt(req.body?.listId, 10);
    if (!listId) return res.status(400).json({ error: "リストを選んでください" });
    const cond = {
      stages: Array.isArray(req.body?.stages) ? req.body.stages : [],
      statuses: Array.isArray(req.body?.statuses) ? req.body.statuses : [],
      hist: String(req.body?.hist || ""),
    };
    // 何も選んでいないときに全部消えないよう、必ず条件を求める
    if (!cond.stages.length && !cond.statuses.length && !cond.hist) {
      return res.status(400).json({ error: "消すものの条件を選んでください（全部消すときは、リストごと消してください）" });
    }
    const n = await deleteCallTargets(listId, cond);
    console.log(`[kincall] リスト${listId}から${n}件を消しました by ${req.user}`);
    res.json({ ok: true, 消した数: n });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// リストごと消す
// リストの名前を変える
app.put("/api/calls/lists/:id/name", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "リストを選んでください" });
    const name = String((req.body && req.body.name) || "").trim();
    if (!name) return res.status(400).json({ error: "新しい名前を入れてください" });
    const list = await renameCallList(id, name);
    if (!list) return res.status(500).json({ error: "変えられませんでした" });
    console.log(`[kincall] リスト${id}の名前を「${name}」に変えました by ${req.user}`);
    res.json({ ok: true, id, name: list.name });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/calls/lists/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const me = String(req.user || "").toLowerCase();
    // 何人かに分けているリストは、一人が消しても他の人のぶんは残す。
    // 自分に配られたぶんだけを取り除き、誰も残っていなければリストごと消す。
    const rows = await listCallTargets(id, { limit: 5000 }).catch(() => []);
    const 配り先 = new Set(rows.map((r) => String(r.assigned_to || "").toLowerCase()).filter(Boolean));
    const 分けている = 配り先.size > 1;

    if (分けている && 配り先.has(me)) {
      const 消した = await removeMyCallTargets(id, me).catch(() => 0);
      const 残り = await listCallTargets(id, { limit: 5000 }).catch(() => []);
      if (残り.length) {
        console.log(`[kincall] リスト${id}から ${me} のぶん${消した}件を外しました（残り${残り.length}件）`);
        return res.json({ ok: true, 自分のぶんだけ: true, 外した: 消した, 残り: 残り.length });
      }
    }
    const ok = await deleteCallList(id);
    if (!ok) return res.status(500).json({ error: "消せませんでした" });
    console.log(`[kincall] リスト${id}を消しました by ${req.user}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 今あるリストの、SF未連携（lead_idなし）の架電先を、Salesforceに反映する。
// 大量でも大丈夫なように、1回で少しずつ（既定20件）処理して残数を返す。フロントが繰り返し呼ぶ。
app.post("/api/calls/lists/:id/to-sf", async (req, res) => {
  try {
    if (!req.isAdmin && !(await isCloserUser(req.user))) return res.status(403).json({ error: "クローザー・管理者だけが使えます" });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "リストが指定されていません" });
    const sfUser = await pickSfUser(req.user);
    if (!salesforceConfigured() || !(await sfConnected(sfUser).catch(() => false))) {
      return res.status(400).json({ error: "Salesforceに接続できません" });
    }
    const limit = Math.min(30, Math.max(1, parseInt(req.body?.limit, 10) || 20));
    const 残り前 = await countTargetsNeedingSf(id);
    const targets = await listTargetsNeedingSf(id, { limit });
    if (!targets.length) return res.json({ ok: true, done: true, 見つかった: 0, 新しく作った: 0, クロス商談あり: 0, 残り: 0 });

    const rtId = await crossLeadRecordTypeId(sfUser).catch(() => "");

    let 見つかった = 0, 作った = 0, 失敗 = 0;
    const 新規リードIds = [];
    for (const t of targets) {
      const company = String(t.company || "").trim();
      if (!company) { await setCallTargetLead(t.id, "SKIP").catch(() => {}); continue; }
      try {
        let leadId = "";
        const found = await searchLeads(sfUser, company, { max: 1 }).catch(() => []);
        if (found && found.length) { leadId = found[0].Id || found[0].id; 見つかった++; }
        else {
          const made = await createLead(sfUser, {
            Company: company, LastName: String(t.person || "").trim() || "担当者",
            Phone: String(t.phone || "").trim(), Email: String(t.email || "").trim(),
            ...(rtId ? { RecordTypeId: rtId } : {}),
          });
          leadId = (made && (made.id || made.Id)) || "";
          if (leadId) { 作った++; 新規リードIds.push(leadId); }
        }
        if (leadId) await setCallTargetLead(t.id, leadId);
        else 失敗++;
      } catch (e) { 失敗++; console.warn("[to-sf]", company, e.message); }
    }
    // クローザー所有リードを中澤さんへ（ジャッジ除く）
    try {
      if (新規リードIds.length) await reassignCloserLeadsToProxy(sfUser, 新規リードIds);
    } catch {}

    const 残り = await countTargetsNeedingSf(id);
    res.json({ ok: true, done: 残り === 0, 見つかった, 新しく作った: 作った, 失敗, 残り, 残り前 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// リストの架電先を、他のメンバーへランダムに割り振り直す（担当を付け替える）。
app.post("/api/calls/lists/:id/redistribute", async (req, res) => {
  try {
    if (!req.isAdmin && !(await isCloserUser(req.user))) return res.status(403).json({ error: "クローザー・管理者だけが使えます" });
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "リストが指定されていません" });
    const b = req.body || {};
    const plan = (Array.isArray(b.members) ? b.members : [])
      .map((x) => (typeof x === "string" ? { email: x } : x))
      .map((p) => ({ email: String(p.email || "").trim().toLowerCase(), count: parseInt(p.count, 10) || 0, listName: String(p.listName || "").slice(0, 200) }))
      .filter((p) => p.email);
    if (!plan.length) return res.status(400).json({ error: "割り振るメンバーを選んでください" });
    const onlyPending = b.onlyPending !== false;   // 既定は未架電だけ
    const r = await redistributeListTargets(id, plan, { onlyPending, dryRun: !!b.dryRun });
    if (!b.dryRun) console.log(`[kincall] リスト${id}を${plan.length}人へ再割り振り（計${r.total}件）by ${req.user}`);
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 一括そうじ：名前の一部＋直近の作成で、増えすぎたリストをまとめて消す（管理者のみ）。
// まず dryRun:true で件数を確認してから、dryRun:false で消す。
app.post("/api/calls/lists/cleanup", async (req, res) => {
  try {
    if (!req.isAdmin && !(await isCloserUser(req.user))) return res.status(403).json({ error: "クローザー・管理者だけが使えます" });
    const b = req.body || {};
    const nameLike = String(b.nameLike || "").trim();
    if (!nameLike) return res.status(400).json({ error: "消す目印（名前の一部）を入れてください" });
    const sinceMinutes = Math.max(1, parseInt(b.sinceMinutes, 10) || 180);
    const 対象 = await findListsByNameSince(nameLike, sinceMinutes);
    if (b.dryRun) {
      return res.json({
        ok: true, dryRun: true, 件数: 対象.length,
        合計リード: 対象.reduce((a, x) => a + Number(x["件数"] || 0), 0),
        例: 対象.slice(0, 10).map((x) => ({ id: x.id, name: x.name, 件数: Number(x["件数"] || 0), 作成: x.created_at })),
      });
    }
    let 消した = 0;
    for (const x of 対象) { if (await deleteCallList(x.id)) 消した++; }
    console.log(`[kincall] 一括そうじ：「${nameLike}」を含む直近${sinceMinutes}分のリスト ${消した}件を消しました by ${req.user}`);
    res.json({ ok: true, 消した, 合計: 対象.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 調べる用：すべてのリストを、持ち主・絞り込みに関係なく出す（管理者のみ）。
// 「消えた」ように見えるリストが、実はDBに残っていないかを確認するために使う。
app.get("/api/calls/lists/all", async (req, res) => {
  try {
    if (!req.isAdmin && !(await isCloserUser(req.user))) return res.status(403).json({ error: "クローザー・管理者だけが使えます" });
    const like = String(req.query.nameLike || "").trim();
    const all = await findListsByNameSince(like || "%", 60 * 24 * 3650).catch(() => []);
    // findListsByNameSince は「名前の一部」で絞るので、空なら全部見えるように "%" を渡している
    res.json({
      ok: true, 件数: all.length,
      items: all.map((x) => ({ id: x.id, name: x.name, 持ち主: x.owner || "", 件数: Number(x["件数"] || 0), 作成: x.created_at })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// リスト管理に出すメンバーの並び（チーム共通。消した人・足した人を覚えておく）
app.get("/api/calls/member-view", async (req, res) => {
  try {
    const st = await getSettings().catch(() => ({}));
    const v = st.kincallMemberView || {};
    res.json({ ok: true, 消した: v.hidden || [], 足した: v.extra || [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put("/api/calls/member-view", async (req, res) => {
  try {
    // kincallだけの人は並びを変えられない
    if (await isKincallOnly(String(req.user || "").toLowerCase()).catch(() => false)) {
      return res.status(403).json({ error: "この操作はできません" });
    }
    const b = req.body || {};
    const uniq = (a) => [...new Set((Array.isArray(a) ? a : []).map((x) => String(x || "").trim().toLowerCase()).filter(Boolean))];
    const v = { hidden: uniq(b["消した"]), extra: uniq(b["足した"]) };
    await saveSettings({ kincallMemberView: v });
    res.json({ ok: true, 消した: v.hidden, 足した: v.extra });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Salesforceの「リード 状況」の選択肢をそのまま見る（番号と名前の確認用）
app.get("/api/calls/lead-stages", async (req, res) => {
  try {
    let owner = req.user;
    if (!(await sfConnected(owner).catch(() => false))) {
      const st = await getSettings().catch(() => ({}));
      const 代理 = String(st.sfProxyUser || "").trim().toLowerCase();
      if (代理 && (await sfConnected(代理).catch(() => false))) owner = 代理;
    }
    const desc = await describeObject(owner, "Lead");
    const f = (desc.fields || []).find((x) => x.name === "Status");
    const all = ((f && f.picklistValues) || []).map((v) => ({
      value: v.value, label: v.label || v.value, 使える: !!v.active,
    }));
    res.json({ ok: true, 件数: all.length, 選択肢: all });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// かける人の一覧（kincallを使う人）。各メンバーの持ちリスト数も返す。
app.get("/api/calls/members", async (req, res) => {
  try {
    const list = await listMembers().catch(() => []);
    const meEmail = String(req.user || "").toLowerCase();
    // 「インサイド」は、rolesに"inside"がある人か、internsテーブル（アポ獲得者マスタ）にいる人。
    const interns = await listInterns().catch(() => []);
    const internSet = new Set((interns || []).map((x) => String(x.email || "").toLowerCase()).filter(Boolean));
    const isInside = (m) => (Array.isArray(m.roles) && m.roles.includes("inside")) || internSet.has(String(m.email || "").toLowerCase());
    const active = (list || []).filter((m) => m.active !== false);
    // みんな共通の並び（消した人・足した人）をここで反映する。
    // 画面側で組み立てると、名簿を持たない人（kincallだけ）で欠けてしまうため。
    const stView0 = await getSettings().catch(() => ({}));
    const view0 = stView0.kincallMemberView || {};
    const hiddenSet = new Set((view0.hidden || []).map((x) => String(x).toLowerCase()));
    const extraSet = new Set((view0.extra || []).map((x) => String(x).toLowerCase()));
    let base = active.filter((m) => {
      const k = String(m.email || "").toLowerCase();
      if (hiddenSet.has(k)) return false;          // 消した人は出さない
      return isInside(m) || extraSet.has(k);       // インサイド、または足した人
    });
    // 以前は管理者でないと「自分だけ」に絞っていたが、ログイン中のアドレスと
    // メンバー登録のアドレスが違うと全員消えてしまうため、その絞り込みはやめる。
    // （他の人のリストを開く・消すのは、リスト側で管理者かどうかを見て止めている）
    if (!base.length) base = active; // 役割が未設定でも空にはしない
    const items = [];
    for (const m of base) {
      let リスト数 = 0, 全部 = 0, 残り = 0;
      if (m.email) {
        const lists = await listCallLists({ owner: String(m.email).toLowerCase(), includeClosed: false, ownerOnly: true }).catch(() => []);
        リスト数 = lists.length;
        全部 = lists.reduce((s, l) => s + Number(l["全部"] || 0), 0);
        const 済み = lists.reduce((s, l) => s + Number(l["済み"] || 0), 0);
        残り = 全部 - 済み;
      }
      items.push({
        email: m.email,
        name: m.name || m.email,
        kincallだけ: Array.isArray(m.roles) && m.roles.includes("kincall"),
        インサイド: isInside(m),
        リスト数, 全部, 残り,
      });
    }
    items.sort((a, b) => (b.リスト数 - a.リスト数) || ((b.kincallだけ ? 1 : 0) - (a.kincallだけ ? 1 : 0)));
    // カードを自由に足せるように、在籍している人を候補として返す。
    // ただし「kincallだけ」の人には候補を出さない（消した人が見えてしまうため）。
    const meKincallOnly = await isKincallOnly(meEmail).catch(() => false);
    const 候補 = meKincallOnly ? [] : active.map((m) => ({ email: m.email, name: m.name || m.email }));
    // 表示の並び（チーム共通）
    const stView = await getSettings().catch(() => ({}));
    const view = stView.kincallMemberView || {};
    res.json({
      ok: true, items, 候補, isAdmin: !!req.isAdmin,
      表示: { 消した: view.hidden || [], 足した: view.extra || [] },
      変えられる: !meKincallOnly,
      debug: { 全メンバー: (list || []).length, 在籍: active.length, インサイド: active.filter(isInside).length, interns: internSet.size, me: meEmail },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 配り具合を見る
app.get("/api/calls/assign", async (req, res) => {
  try {
    const listId = parseInt(req.query.list, 10);
    if (!listId) return res.status(400).json({ error: "リストを選んでください" });
    const rows = await callAssignCounts(listId);
    const names = new Map();
    for (const r of rows) {
      const k = r["誰"];
      if (!k || names.has(k)) continue;
      names.set(k, await displayNameOf(k).catch(() => k));
    }
    res.json({
      ok: true,
      items: rows.map((r) => ({
        email: r["誰"],
        name: r["誰"] ? (names.get(r["誰"]) || r["誰"]) : "（まだ配っていない）",
        全部: r["全部"], 済み: r["済み"], 残り: r["全部"] - r["済み"],
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 配る
app.post("/api/calls/assign", async (req, res) => {
  try {
    const listId = parseInt(req.body?.listId, 10);
    if (!listId) return res.status(400).json({ error: "リストを選んでください" });
    const who = Array.isArray(req.body?.emails) ? req.body.emails : [];
    if (!who.length) return res.status(400).json({ error: "かける人を選んでください" });
    // すでに配ったぶんも配り直すか
    const 全部やり直す = req.body?.redo === true;
    const n = await assignCallTargets(listId, who, { onlyUnassigned: !全部やり直す });
    console.log(`[kincall] ${n}件を${who.length}人に配りました by ${req.user}`);
    res.json({ ok: true, 配った数: n, 人数: who.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 配ったものを戻す
app.post("/api/calls/assign/clear", async (req, res) => {
  try {
    const listId = parseInt(req.body?.listId, 10);
    if (!listId) return res.status(400).json({ error: "リストを選んでください" });
    const n = await clearCallAssign(listId);
    res.json({ ok: true, 戻した数: n });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 履歴の件数が数えられているかを、その場で確かめる
app.get("/api/calls/count-check", async (req, res) => {
  try {
    const listId = parseInt(req.query.list, 10);
    const rows = await listCallTargets(listId || 0, { limit: 5 });
    const ids = rows.map((r) => r.lead_id).filter(Boolean);
    let 数える人 = req.user;
    let 代理を使った = false;
    if (!(await sfConnected(数える人).catch(() => false))) {
      const st = await getSettings().catch(() => ({}));
      const 代理 = String(st.sfProxyUser || "").trim().toLowerCase();
      if (代理 && (await sfConnected(代理).catch(() => false))) { 数える人 = 代理; 代理を使った = true; }
    }
    const つながっている = await sfConnected(数える人).catch(() => false);
    let 生の答え = null, エラー = "";
    if (ids.length && つながっている) {
      try {
        const part = ids.slice(0, 5).map((x) => `'${String(x).replace(/[^A-Za-z0-9]/g, "")}'`);
        const inClause = `WhoId IN (${part.join(",")})`;
        let d;
        try {
          // 実際の履歴列と同じく「架電だけ（Type='Call'）」で数える
          d = await sfQuery(数える人,
            `SELECT WhoId, count(Id) n FROM Task WHERE ${inClause} AND Type = 'Call' GROUP BY WhoId`);
        } catch (e2) {
          if (/No such column|INVALID_FIELD|Type/i.test(e2.message || "")) {
            d = await sfQuery(数える人,
              `SELECT WhoId, count(Id) n FROM Task WHERE ${inClause} GROUP BY WhoId`);
          } else { throw e2; }
        }
        生の答え = (d.records || []).slice(0, 5);
      } catch (e) { エラー = e.message; }
    }
    res.json({
      ok: true,
      数える人, 代理を使った, つながっている,
      リードのID: ids.slice(0, 5),
      生の答え,
      エラー,
      hint: !ids.length ? "このリストにはSalesforceのリードIDが入っていません（貼り付けで作ったリストなど）"
        : !つながっている ? "Salesforceにつながっていません。設定→動作設定で「代わりに更新する人」を決めてください"
        : エラー ? "Salesforceからの答えでつまずいています（上のエラーを見てください）"
        : 生の答え && 生の答え.length ? "数えられています" : "そのリードには活動履歴がありませんでした",
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// リストの中身を表で返す（SFのリードレポートのような一覧）
// リストの中身を絞り込んで、自分のリストとして切り出す（元のリストはそのまま残る）
app.post("/api/calls/lists/split", async (req, res) => {
  try {
    const b = req.body || {};
    const listId = parseInt(b.list, 10);
    const name = String(b.name || "").trim();
    if (!listId) return res.status(400).json({ error: "元のリストを選んでください" });
    if (!name) return res.status(400).json({ error: "新しいリストの名前を入れてください" });

    const rows = await listCallTargets(listId, { q: String(b.q || ""), limit: 2000 });
    const norm = (v) => String(v == null ? "" : v).trim();
    const stages = (b.stages || []).map(norm).filter(Boolean);
    const statuses = (b.statuses || []).map(norm).filter(Boolean);
    const onlyUndone = !!b.onlyUndone;

    const picked = rows.filter((r) => {
      if (onlyUndone && r.done) return false;
      if (stages.length && !stages.includes(norm(r.stage))) return false;
      if (statuses.length && !statuses.includes(norm(r.status))) return false;
      return true;
    });
    if (!picked.length) return res.status(400).json({ error: "この条件に合うものがありません" });

    const list = await createCallList({ name, owner: req.user, createdBy: req.user });
    const items = picked.map((r) => ({
      leadId: r.lead_id, company: r.company, person: r.person, phone: r.phone,
      email: r.email, industry: r.industry, area: r.area, memo: r.memo,
      stage: r.stage, status: r.status,
    }));
    const n = await addCallTargets(list.id, items);
    console.log(`[kincall] 絞り込みで新しいリスト「${name}」を作りました（${n}件） by ${req.user}`);
    res.json({ ok: true, id: list.id, name: list.name, 件数: n });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/calls/targets", async (req, res) => {
  try {
    const listId = parseInt(req.query.list, 10);
    if (!listId) return res.status(400).json({ error: "リストを選んでください" });
    const rows = await listCallTargets(listId, {
      q: String(req.query.q || ""),
      limit: Math.min(2000, parseInt(req.query.limit, 10) || 2000),
    });

    // Salesforceに残っている活動の件数も数える（kincallの記録だけだと0に見えるため）
    //
    // SFアカウントの無い人（インターン生）でも数を見られるよう、
    // 代わりに更新する人の連携を使う。
    const sfCount = new Map();
    const ids = [...new Set(rows.map((r) => r.lead_id).filter(Boolean))];
    let 数える人 = req.user;
    if (!(await sfConnected(数える人).catch(() => false))) {
      const st = await getSettings().catch(() => ({}));
      const 代理 = String(st.sfProxyUser || "").trim().toLowerCase();
      if (代理 && (await sfConnected(代理).catch(() => false))) 数える人 = 代理;
    }
    if (ids.length && salesforceConfigured() && (await sfConnected(数える人).catch(() => false))) {
      // 一度に長すぎる問い合わせはSalesforceに弾かれるので、小分けにする
      const 束 = 80;
      let 失敗 = 0;
      // 「架電だけ」を数える条件。kincallは架電活動を Type='Call' で作っている。
      // ※組織に Task.Type が無い場合は、この条件を外して全活動を数える（下でフォールバック）。
      const 架電しぼり = "Type = 'Call'";
      for (let i = 0; i < ids.length; i += 束) {
        const part = ids.slice(i, i + 束).map((x) => `'${String(x).replace(/[^A-Za-z0-9]/g, "")}'`);
        const inClause = `WhoId IN (${part.join(",")})`;
        try {
          let d;
          try {
            // まず架電だけで数える
            d = await sfQuery(数える人,
              `SELECT WhoId, count(Id) n FROM Task WHERE ${inClause} AND ${架電しぼり} GROUP BY WhoId`);
          } catch (e) {
            // Task.Type が無い組織では条件を外して全活動を数える
            if (/No such column|INVALID_FIELD|Type/i.test(e.message || "")) {
              d = await sfQuery(数える人,
                `SELECT WhoId, count(Id) n FROM Task WHERE ${inClause} GROUP BY WhoId`);
            } else { throw e; }
          }
          for (const r of d.records || []) {
            // Salesforceは、付けた名前（n）ではなく expr0 で返すことがある
            const n = Number(r.n ?? r.expr0 ?? r.N ?? 0);
            // 戻り値のWhoIdは18桁、手元のlead_idは15桁のことがある。
            // 先頭15桁をキーにそろえて突き合わせる（15桁はSF IDの実体）。
            if (r.WhoId) sfCount.set(id15(r.WhoId), n);
          }
        } catch (e) {
          failedOnce(e, ++失敗);
        }
      }
      if (失敗) console.warn(`[kincall] 活動の件数：${失敗}回ぶん数えられませんでした`);
      console.log(`[kincall] 架電の件数を数えました：${sfCount.size}件ぶん（対象 ${ids.length}）`);
    }
    res.json({
      ok: true,
      件数: rows.length,
      残り: rows.filter((r) => !r.done).length,
      結果の種類: CALL_RESULTS.map((x) => x.key),
      items: rows.map((r) => ({
        id: r.id, leadId: r.lead_id || "",
        ステージ: r.stage || "",
        会社名: r.company || "", 担当者: r.person || "",
        電話番号: r.phone || "", メール: r.email || "",
        所有者: r.owner_name || "",
        最終ステータス: r.status || "",
        // 履歴はSFのものを出すので、件数もSFの数に合わせる。
        // SFへまだ送れていないkinbotの記録があれば、それも足す。
        // lead_id が15桁でも18桁でも合うよう、先頭15桁で引く。
        履歴数: (sfCount.get(id15(r.lead_id)) || 0) + Number(r["未送信数"] || 0),
        最終結果: r["最終結果"] || "",
        最終日時: r["最終日時"] || null,
        次回予定: r.next_call_at || null,
        済み: !!r.done,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 1件の履歴（モーダルで出す）
app.get("/api/calls/targets/:id/history", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const t = await getCallTarget(id);
    if (!t) return res.status(404).json({ error: "見つかりません" });
    // 履歴はSalesforceに残っているものだけを出す。
    // kinbot側の記録は、SFへ送れなかったものだけを出す（送れていれば同じものが二重になるため）。
    const rows = await callHistory(id, t.lead_id, 50);
    const items = rows
      .filter((h) => !h.sf_task_id)   // SFへ残せたものは、SF側から出す
      .map((h) => ({
        logId: h.id, sfTaskId: h.sf_task_id || "",
        結果: h.result, メモ: h.memo || "", 誰: h.caller || "", at: h.at,
        元: "kinbot", まだ送れていない: true, 直せる: true,
      }));

    // Salesforceに残っている架電の履歴も混ぜる（過去のやり取りはSFにある）
    // SFアカウントの無い人（インターン生など）でも読めるよう、
    // つながっていなければ「代わりに更新する人」の連携を使う。
    let sfNote = "";
    let 読む人 = req.user;
    if (!(await sfConnected(読む人).catch(() => false))) {
      const stH = await getSettings().catch(() => ({}));
      const 代理 = String(stH.sfProxyUser || "").trim().toLowerCase();
      if (代理 && (await sfConnected(代理).catch(() => false))) 読む人 = 代理;
    }
    if (t.lead_id && salesforceConfigured() && (await sfConnected(読む人).catch(() => false))) {
      try {
        const acts = await leadActivities(読む人, t.lead_id, 50);
        for (const a of acts) {
          // メール（メルマガなど）は出さず、電話の履歴だけにする
          const sub = String(a.Subject || "");
          const subtype = String(a.TaskSubtype || "");
          const isMail = subtype === "Email" || /^(メール|Email|Mail)/i.test(sub) ||
            /メルマガ|一斉配信|Pardot|List Email/i.test(sub);
          if (isMail) continue;
          // 説明の中に書かれている結果を取り出す。
          // 決まった言い方（受付ブロック・担当者接触：アポ獲得 など）を先に探し、
              // 見つからなければ「結果：」の後ろを読む。
          const desc = String(a.Description || "");
          let 結果 = 既知の結果.find((w) => desc.includes(w)) || "";
          if (!結果) {
            const m1 = desc.match(/(?:コール結果|結果)\s*[:：]\s*([^\n]*?)(?=\s*[^\s:：]{2,10}\s*[:：]|\n|$)/);
            if (m1) 結果 = m1[1].trim().slice(0, 40);
          }
          items.push({
            taskId: a.Id || "", 直せる: !!a.Id,
            件名: String(a.Subject || "").replace(/^コール：/, "") || "活動",
            結果,
            メモ: desc.slice(0, 500),
            誰: (a.Owner && a.Owner.Name) || "",
            // 時刻まで分かる CreatedDate を使う。
            // ActivityDate は日付だけなので、それしか無いときは日付のみ扱いにする。
            at: a.CreatedDate || (a.ActivityDate ? `${a.ActivityDate}T00:00:00+09:00` : null),
            日付のみ: !a.CreatedDate,
            元: "salesforce",
          });
        }
        if (!acts.length) sfNote = "Salesforceに活動履歴はありませんでした";
      } catch (e) {
        sfNote = `Salesforceの履歴を読めません（${e.message}）`;
      }
    } else if (!t.lead_id) {
      sfNote = "この相手はSalesforceのリードと結びついていません";
    }

    // 新しい順に並べ直す
    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    res.json({
      ok: true,
      相手: { 会社名: t.company || "", 担当者: t.person || "", 電話番号: t.phone || "", メール: t.email || "" },
      note: sfNote,
      items,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 架電履歴の1件を直す（結果・メモ）。
//  ・SFの活動（taskId あり）… SalesforceのTaskの件名・説明を書き換える
//  ・kinbotの記録（logId あり）… kinbot側のログを書き換える
app.post("/api/calls/targets/:id/history/edit", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const t = await getCallTarget(id);
    if (!t) return res.status(404).json({ error: "見つかりません" });
    const b = req.body || {};
    const result = String(b.result || "").trim();
    const memo = String(b.memo || "");
    if (!result && !memo) return res.status(400).json({ error: "結果かメモを入れてください" });

    const 記録者 = await displayNameOf(req.user).catch(() => req.user);

    // SFの活動を直す
    if (b.taskId) {
      const sfUser = await pickSfUser(req.user);
      if (!salesforceConfigured() || !(await sfConnected(sfUser).catch(() => false))) {
        return res.status(400).json({ error: "Salesforceにつながっていません" });
      }
      const desc = [
        result ? `結果：${result}` : "",
        memo ? `メモ：${memo}` : "",
        `修正：${記録者}（kincallから）`,
      ].filter(Boolean).join("\n");
      const fields = { Description: desc };
      if (result) fields.Subject = `コール：${result}`;
      try {
        await updateTask(sfUser, String(b.taskId), fields);
      } catch (e) { return res.status(500).json({ error: "Salesforceの活動を直せませんでした：" + String(e.message).slice(0, 120) }); }
      console.log(`[kincall] 履歴（SF活動 ${b.taskId}）を直しました by ${req.user}`);
      return res.json({ ok: true, 元: "salesforce" });
    }

    // kinbotの記録を直す
    if (b.logId) {
      const saved = await updateCallLog(parseInt(b.logId, 10), { result: result || undefined, memo });
      if (!saved) return res.status(500).json({ error: "記録を直せませんでした" });
      console.log(`[kincall] 履歴（kinbotログ ${b.logId}）を直しました by ${req.user}`);
      return res.json({ ok: true, 元: "kinbot" });
    }

    return res.status(400).json({ error: "直す対象が分かりません" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== kincall：かける画面から、トラッキング資料を送る =====
// 「資料送付」ボタン → プレビューを出す → 確認して送信、の2段。

// 送る前のプレビューを作る。会社向けの資料URLを（無ければ）発行し、
// 宛先・件名・本文（URL入り）を返す。
app.post("/api/calls/targets/:id/doc/preview", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const t = await getCallTarget(id);
    if (!t) return res.status(404).json({ error: "見つかりません" });
    const company = String(t.company || "").trim();
    const person = String(t.person || "").trim();
    const to = String(t.email || "").trim();
    const base = String(process.env.PUBLIC_URL || "").replace(/\/+$/, "");
    if (!base) return res.status(400).json({ error: "資料URLの土台（公開URL）が設定されていません" });

    // 会社向けのトラッキング資料URL（無ければ1つ発行する）
    const st = await getSettings().catch(() => ({}));
    let link = null, docName = "";
    const have = await docLinksForCompany(company, 5).catch(() => []);
    if (have.length) {
      link = have[0];
      docName = fixMojibake(have[0].doc_name || "");
    } else {
      const docs = await listDocFiles({ owner: req.user }).catch(() => []);
      if (!docs.length) return res.status(400).json({ error: "登録されている資料がありません（先に資料を登録してください）" });
      const wantId = parseInt(req.body?.docId, 10) || parseInt(st.docDefaultId, 10) || 0;
      const doc = docs.find((d) => d.id === wantId) || docs[0];
      const made = await addDocLinks(doc.id, [{ company, contact: person, email: to }], req.user);
      link = (made || [])[0];
      docName = fixMojibake(doc.name || "");
    }
    if (!link) return res.status(500).json({ error: "資料URLを発行できませんでした" });
    const url = `${base}/d/${link.slug}`;

    const 差出人 = await displayNameOf(req.user).catch(() => "");
    // 差し込み：{担当者}{会社名}{差出人}{資料名}{URL}
    const fill = (s) => String(s || "")
      .replace(/\{担当者\}/g, person || "ご担当者")
      .replace(/\{会社名\}/g, company)
      .replace(/\{差出人\}/g, 差出人)
      .replace(/\{資料名\}/g, docName || "ご案内資料")
      .replace(/\{URL\}/g, url);
    const 既定件名 = "資料のご送付（{資料名}）";
    const 既定本文 =
      "{担当者}様\n\n" +
      "お世話になっております。\n" +
      "先ほどお電話にてご案内した資料をお送りいたします。\n" +
      "下記のURLよりご確認ください。\n\n" +
      "{URL}\n\n" +
      "ご不明な点がございましたら、お気軽にご連絡ください。\n" +
      "何卒よろしくお願いいたします。";
    const subject = fill(String(st.docSendSubject || 既定件名));
    const body = fill(String(st.docSendBody || 既定本文));

    res.json({
      ok: true, to, company, person, subject, body, url, docName,
      warn: to ? "" : "この相手のメールアドレスが登録されていません。宛先を入れてください。",
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 資料送付の設定（テンプレの件名・本文、既定の資料、トラッキングの有無）を読む
app.get("/api/calls/doc-settings", async (req, res) => {
  try {
    const st = await getSettings().catch(() => ({}));
    const docs = await listDocFiles({ owner: req.user }).catch(() => []);
    res.json({
      ok: true,
      subject: st.docSendSubject || "資料のご送付（{資料名}）",
      body: st.docSendBody ||
        "{担当者}様\n\nお世話になっております。\n先ほどお電話にてご案内した資料をお送りいたします。\n下記のURLよりご確認ください。\n\n{URL}\n\nご不明な点がございましたら、お気軽にご連絡ください。\n何卒よろしくお願いいたします。",
      defaultDocId: st.docDefaultId || "",
      docs: (docs || []).map((d) => ({ id: d.id, name: fixMojibake(d.name || "") })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 資料送付の設定を保存（クローザー・管理者のみ）
app.put("/api/calls/doc-settings", async (req, res) => {
  try {
    if (!req.isAdmin && !(await isCloserUser(req.user))) return res.status(403).json({ error: "クローザー・管理者だけが変えられます" });
    const b = req.body || {};
    const patch = {};
    if (b.subject !== undefined) patch.docSendSubject = String(b.subject || "").slice(0, 300);
    if (b.body !== undefined) patch.docSendBody = String(b.body || "").slice(0, 4000);
    if (b.defaultDocId !== undefined) patch.docDefaultId = String(b.defaultDocId || "");
    await saveSettings(patch);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// プレビューで確認した内容で、実際にメールを送る（送信者のGmail連携を使う）。
app.post("/api/calls/targets/:id/doc/send", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const t = await getCallTarget(id);
    if (!t) return res.status(404).json({ error: "見つかりません" });
    const b = req.body || {};
    const to = String(b.to || t.email || "").trim();
    const subject = String(b.subject || "").trim();
    const body = String(b.body || "");
    if (!to) return res.status(400).json({ error: "宛先（メールアドレス）を入れてください" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return res.status(400).json({ error: "宛先のメールアドレスの形式が正しくありません" });
    if (!subject || !body) return res.status(400).json({ error: "件名と本文を入れてください" });

    if (!(await gcalConnected(req.user).catch(() => false))) {
      return res.status(400).json({ error: "あなたのGoogle連携が必要です（設定→連携→Google）" });
    }
    try {
      await gmailSend(req.user, { to, subject, bodyText: body });
    } catch (e) {
      return res.status(500).json({ error: e.needScope
        ? "Gmailの送信権限がありません。設定→連携→Google連携で、連携解除→再連携し、Gmailの項目を許可してください。"
        : "送信できませんでした：" + String(e.message).slice(0, 120) });
    }

    // 記録に「資料送付」を残す（履歴に出る）。SFにも活動履歴を残す。
    const log = await recordCall({
      targetId: id, leadId: t.lead_id, company: t.company,
      result: "資料送付", memo: `資料URLを ${to} に送付（件名：${subject}）`, caller: req.user,
    }).catch(() => null);
    if (t.lead_id && salesforceConfigured()) {
      const sfUser = await pickSfUser(req.user);
      if (await sfConnected(sfUser).catch(() => false)) {
        const 記録者 = await displayNameOf(req.user).catch(() => req.user);
        try {
          const made = await createTask(sfUser, {
            WhoId: t.lead_id, Subject: "資料送付", Status: "完了", Type: "Email",
            ActivityDate: jstDate(0),
            Description: `資料URLを ${to} に送付\n件名：${subject}\n送った人：${記録者}`,
          });
          await markCallSynced(log && log.id, { taskId: (made && (made.id || made.Id)) || "done" }).catch(() => {});
        } catch (e) { await markCallSynced(log && log.id, { error: e.message }).catch(() => {}); }
      }
    }
    console.log(`[kincall] 資料を送付 target=${id} → ${to} by ${req.user}`);
    res.json({ ok: true, to });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ステージ（リード状況）だけを変える。記録はしない。
// ローカルの call_targets.stage を書き換え、Salesforceのリードの状態にも反映する。
app.post("/api/calls/targets/:id/stage", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const t = await getCallTarget(id);
    if (!t) return res.status(404).json({ error: "見つかりません" });
    const stage = String((req.body && req.body.stage) || "").trim();
    if (!stage) return res.status(400).json({ error: "ステージを選んでください" });

    await setCallTargetStatus(id, { stage }).catch(() => {});

    let sf = { ok: false, reason: "" };
    if (t.lead_id && salesforceConfigured()) {
      const sfUser = await pickSfUser(req.user);
      if (await sfConnected(sfUser).catch(() => false)) {
        try { await updateLead(sfUser, t.lead_id, { Status: stage }); sf = { ok: true }; }
        catch (e) { sf = { ok: false, reason: String(e.message).slice(0, 120) }; }
      } else { sf = { ok: false, reason: "Salesforceにつながっていません" }; }
    } else if (!t.lead_id) {
      sf = { ok: false, reason: "この相手はSalesforceのリードと結びついていません" };
    }
    console.log(`[kincall] ステージを「${stage}」に変更 target=${id}（SF：${sf.ok ? "反映" : sf.reason}） by ${req.user}`);
    res.json({ ok: true, stage, sf });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 会社名・担当者名・電話番号・メールアドレスを編集する。
// ローカルの宛先を書き換え、Salesforceのリードにも同じ内容を反映する。
app.post("/api/calls/targets/:id/edit", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const t = await getCallTarget(id);
    if (!t) return res.status(404).json({ error: "見つかりません" });

    const b = req.body || {};
    const company = b.company === undefined ? undefined : String(b.company || "").trim();
    const person  = b.person  === undefined ? undefined : String(b.person  || "").trim();
    const phone   = b.phone   === undefined ? undefined : String(b.phone   || "").trim();
    const email   = b.email   === undefined ? undefined : String(b.email   || "").trim();

    // まずローカルを更新
    const row = await updateCallTargetFields(id, { company, person, phone, email });

    // Salesforceのリードにも反映（つながっていて、リードと結びついているときだけ）
    let sf = null;
    if (t.lead_id && salesforceConfigured()) {
      // 記録と同じく、自分がつながっていなければ代理の連携を使う
      let sfUser = req.user;
      if (!(await sfConnected(sfUser).catch(() => false))) {
        const st = await getSettings().catch(() => ({}));
        const 代理 = String(st.sfProxyUser || "").trim().toLowerCase();
        if (代理 && (await sfConnected(代理).catch(() => false))) sfUser = 代理;
      }
      if (await sfConnected(sfUser).catch(() => false)) {
        // 送るのは値が入っているものだけ。必須項目（会社名・担当者名）は空では送らない。
        const fields = {};
        if (company !== undefined && company !== "") fields.Company = company;
        if (person  !== undefined && person  !== "") fields.LastName = person; // Lead.Name は LastName に入れる
        if (phone   !== undefined) fields.Phone = phone;  // 電話・メールは空にできる
        if (email   !== undefined) fields.Email = email;
        try {
          if (Object.keys(fields).length) {
            await updateLead(sfUser, t.lead_id, fields);
            sf = { ok: true };
          } else {
            sf = { ok: false, reason: "SFへ送る項目がありませんでした" };
          }
        } catch (e) {
          sf = { ok: false, reason: e.message };
        }
      } else {
        sf = { ok: false, reason: "Salesforceにつながっていません" };
      }
    } else if (!t.lead_id) {
      sf = { ok: false, reason: "この相手はSalesforceのリードと結びついていません" };
    }

    res.json({
      ok: true,
      項目: {
        会社名: (row && row.company) || company || "",
        担当者: (row && row.person) || person || "",
        電話番号: (row && row.phone) || phone || "",
        メール: (row && row.email) || email || "",
      },
      sf,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 記録する（Salesforceの活動履歴と、リードの状態も更新する）
// 「代わりに更新する人」がちゃんと使える状態か確かめる
app.get("/api/sf-proxy/check", async (req, res) => {
  try {
    const st = await getSettings().catch(() => ({}));
    const 代理 = String(st.sfProxyUser || "").trim().toLowerCase();
    const me = String(req.user || "").toLowerCase();
    const 自分 = await sfConnected(me).catch(() => false);
    const 代理OK = 代理 ? await sfConnected(代理).catch(() => false) : false;
    res.json({
      ok: true,
      自分: { email: me, 連携: 自分 },
      代わりに更新する人: { email: 代理 || "", 連携: 代理OK },
      使われる人: 自分 ? me : (代理OK ? 代理 : ""),
      案内: 自分 ? "自分の連携で更新します"
        : 代理OK ? `${代理} の連携で更新します`
        : 代理 ? `「${代理}」の連携が見つかりません。その人がkinbotにログインしているアドレスと同じか確かめてください`
        : "「代わりに更新する人」が決まっていません",
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/calls/targets/:id/record", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const t = await getCallTarget(id);
    if (!t) return res.status(404).json({ error: "見つかりません" });
    const b = req.body || {};
    const result = String(b.result || "").trim();
    // 結果はSalesforceの選択肢をそのまま使うので、決め打ちで弾かない。
    // （「担当者接触：アポ獲得」など、組織ごとに値が違うため）
    if (!result) return res.status(400).json({ error: "結果を選んでください" });

    // kinbotに残す
    const log = await recordCall({
      targetId: id, leadId: t.lead_id, company: t.company,
      result, memo: String(b.memo || ""), caller: req.user,
    });
    // ステージと最終ステータスを書き換える。
    // 最終ステータスは「いま記録した結果」を入れる（空で上書きしない）。
    // ステージは、選ばれたときだけ変える。
    const 次のステージ = (b.stage !== undefined && String(b.stage).trim() !== "") ? String(b.stage).trim()
      : (b.leadStatus !== undefined && String(b.leadStatus).trim() !== "") ? String(b.leadStatus).trim()
      : undefined;
    await setCallTargetStatus(id, {
      ...(次のステージ !== undefined ? { stage: 次のステージ } : {}),
      status: result,
    }).catch(() => {});

    // Salesforceへ（活動履歴＋リードの状態）
    //
    // インターン生などSalesforceのアカウントを持たない人のために、
    // 「代わりに更新する人」を決めておける（設定→動作設定）。
    // その場合、誰が記録したかは説明に残す。
    let sf = { ok: false, reason: "" };
    const st0 = await getSettings().catch(() => ({}));
    const 代理 = String(st0.sfProxyUser || "").trim().toLowerCase();
    let sfUser = req.user;
    let 代理で更新 = false;
    const 自分つながってる = await sfConnected(req.user).catch(() => false);
    let 代理つながってる = false;
    if (!自分つながってる && 代理) {
      代理つながってる = await sfConnected(代理).catch(() => false);
      if (代理つながってる) {
        sfUser = 代理;
        代理で更新 = true;
      }
    }
    console.log(`[kincall] SF更新の相手：本人=${req.user}(${自分つながってる ? "連携あり" : "連携なし"}) 代理=${代理 || "未設定"}(${代理 ? (代理つながってる ? "連携あり" : "連携なし") : "-"}) → 使う人=${sfUser}`);
    // 記録した本人の名前（説明に残す）
    const 記録者 = await displayNameOf(req.user).catch(() => req.user);

    if (t.lead_id && salesforceConfigured() && (await sfConnected(sfUser).catch(() => false))) {
      try {
        const made = await createTask(sfUser, {
          WhoId: t.lead_id,
          Subject: `コール：${result}`,
          Status: "完了", Type: "Call",
          ActivityDate: jstDate(0),
          Description: [
            `結果：${result}`,
            b.memo ? `メモ：${b.memo}` : "",
            b.status ? `リードの状態：${b.status}` : "",
            // 誰がかけたかを必ず残す（代理で更新するときは特に大事）
            `記録した人：${記録者}`,
          ].filter(Boolean).join("\n"),
        });
        // リードの状態も直す（項目名は組織ごとに違うので、指定があるときだけ）
        if (b.leadStatus) {
          await updateLead(sfUser, t.lead_id, { Status: String(b.leadStatus) }).catch(() => {});
        }
        // 作った活動のIDを残す（履歴で二重に出さないために使う）
        await markCallSynced(log && log.id, {
          // createTask は { id } か { taskId } を返す（作り方によって違う）
          taskId: (made && (made.id || made.Id || made.taskId)) || "done",
        }).catch(() => {});
        sf = { ok: true, 代理: 代理で更新 ? await displayNameOf(sfUser).catch(() => sfUser) : "" };
      } catch (e) {
        sf = { ok: false, reason: e.message };
        await markCallSynced(log && log.id, { error: e.message }).catch(() => {});
      }
    } else if (!t.lead_id) {
      sf = { ok: false, reason: "この相手はSalesforceのリードと結びついていません" };
    } else if (!salesforceConfigured()) {
      sf = { ok: false, reason: "Salesforceの設定がされていません" };
    } else {
      // 自分も代理もつながっていない場合。原因が分かるように書き分ける。
      sf = { ok: false, reason: !代理
        ? "Salesforceにつながっていません（設定→動作設定で「代わりに更新する人」を決めてください）"
        : `Salesforceにつながっていません（代わりに更新する人「${代理}」の連携が見つかりません。設定した文字列と、その人のログイン用アドレスが同じか確かめてください）` };
    }

    // ネクストアクション＝未完了の「活動予定」を1件作る（活動日＝次回架電日、活動種別＝設定値）。
    // これが翌日以降「今日のネクストアクション」から外れ／その日が来たら出てくる、の元になる。
    const naDate = String(b.nextAction || "").trim();
    if (naDate && t.lead_id) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(naDate)) {
        sf.nextActionNote = "次回架電日の形式が正しくありません";
      } else if (await sfConnected(sfUser).catch(() => false)) {
        const naType = String(st0.sfNextActionType || "").trim() || "ネクストアクション";  // 活動種別（既定：ネクストアクション）
        try {
          await createTask(sfUser, {
            WhoId: t.lead_id,
            Subject: "ネクストアクション（架電予定）",
            ActivityDate: naDate,                       // 活動日
            Type: naType,                               // 活動種別（既定：ネクストアクション）
            // Status は付けない＝未完了の「予定」にする
            Description: `kincallから設定（記録した人：${記録者}）`,
          });
          sf.nextAction = naDate;
          console.log(`[kincall] ネクストアクション（活動予定）を作成 lead=${t.lead_id} 活動日=${naDate}${naType ? ` 種別=${naType}` : ""} by ${req.user}`);
        } catch (e) { sf.nextActionNote = "ネクストアクションを作れませんでした：" + String(e.message).slice(0, 80); }
      }
    }

    // kincall側にも「次回の架電予定日時」を残す。かける一覧で、その時刻が来たら上に出す。
    // 日付（nextAction）＋時間（nextTime "HH:MM"）から、日本時間の日時を作る。
    let 予定 = null;
    if (naDate && /^\d{4}-\d{2}-\d{2}$/.test(naDate)) {
      const hm = String(b.nextTime || "").trim();
      const t2 = /^\d{1,2}:\d{2}$/.test(hm) ? (hm.length === 4 ? "0" + hm : hm) : "09:00";
      予定 = `${naDate}T${t2}:00+09:00`;
    }
    try { await setCallTargetNextCall(id, 予定); sf.nextCallAt = 予定; } catch {}

    res.json({ ok: true, sf });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// リスト内のリードについて、CSV取り込みで二重になった活動履歴を整理する。
// 説明の中身（結果・コメント）が同じものは1件だけ残し、残りを消す。
// dryRun（既定）だと、消す件数を数えるだけ。
app.post("/api/calls/lists/:id/dedupe-activities", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "リストを選んでください" });
    const dryRun = !(req.body && req.body.dryRun === false);

    const sfUser = await pickSfUser(req.user);
    if (!salesforceConfigured() || !(await sfConnected(sfUser).catch(() => false))) {
      return res.status(400).json({ error: "Salesforceにつながっていません" });
    }

    const targets = await listCallTargets(id, { limit: 5000 }).catch(() => []);
    const leadIds = [...new Set(targets.map((t) => String(t.lead_id || "").trim()).filter(Boolean))];
    const sq = (v) => String(v || "").replace(/'/g, "\\'");

    let リード数 = 0, 重複 = 0, 消した = 0;
    const errors = [];
    for (const lead of leadIds) {
      リード数++;
      let recs = [];
      try {
        const q = await sfQuery(sfUser,
          `SELECT Id, Description, CreatedDate FROM Task WHERE WhoId='${sq(lead)}' ORDER BY CreatedDate ASC LIMIT 200`);
        recs = q.records || [];
      } catch (e) { errors.push(`リード${lead}の活動を読めません：${String(e.message).slice(0, 50)}`); continue; }

      // CSV由来だけをまとめ、説明の中身（「CSVから取り込み」より前＝結果・コメント）でグループ化
      const groups = new Map();
      for (const t of recs) {
        const desc = String(t.Description || "");
        if (!desc.includes("CSVから取り込み")) continue;
        const key = desc.split("CSVから取り込み")[0].replace(/\s+/g, "").trim();
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(t);
      }
      for (const arr of groups.values()) {
        if (arr.length <= 1) continue;
        const 消す = arr.slice(1);   // 一番古い1件を残し、あとを消す
        重複 += 消す.length;
        if (!dryRun) {
          for (const t of 消す) {
            try { await deleteTask(sfUser, t.Id); 消した++; }
            catch (e) { errors.push(`${t.Id}の削除に失敗：${String(e.message).slice(0, 50)}`); }
          }
        }
      }
    }
    console.log(`[kincall] 活動履歴の重複整理 list=${id} リード${リード数} 重複${重複}${dryRun ? "（試算）" : ` 消した${消した}`} by ${req.user}`);
    res.json({ ok: true, dryRun, リード数, 重複, 消した, errors: errors.slice(0, 10) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 次にかける1件
app.get("/api/calls/next", async (req, res) => {
  try {
    const listId = parseInt(req.query.list, 10);
    if (!listId) return res.status(400).json({ error: "リストを選んでください" });
    const t = await nextCallTarget(listId, req.user);
    if (!t) return res.json({ ok: true, done: true });
    const past = await callHistory(t.id, t.lead_id, 5);
    res.json({
      ok: true,
      done: false,
      target: {
        id: t.id, leadId: t.lead_id || "", company: t.company, person: t.person,
        phone: t.phone, email: t.email, industry: t.industry, area: t.area, memo: t.memo || "",
      },
      履歴: past.map((h) => ({ 結果: h.result, メモ: h.memo || "", at: h.at, 誰: h.caller || "" })),
      結果の種類: CALL_RESULTS.map((x) => x.key),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 結果を記録する（そのあとSalesforceへ送る）
app.post("/api/calls/record", async (req, res) => {
  try {
    const b = req.body || {};
    const result = String(b.result || "").trim();
    if (!CALL_RESULTS.some((x) => x.key === result)) {
      return res.status(400).json({ error: "結果を選んでください" });
    }
    const log = await recordCall({
      targetId: parseInt(b.targetId, 10) || null,
      leadId: String(b.leadId || "") || null,
      company: String(b.company || ""),
      result,
      memo: String(b.memo || ""),
      caller: req.user,
    });
    if (!log) return res.status(500).json({ error: "記録できませんでした" });

    // Salesforceへは、待たせずに裏で送る
    syncCallToSf(log).catch(() => {});
    res.json({ ok: true, id: log.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 架電の記録をSalesforceへ送る（活動として残す）
async function syncCallToSf(log) {
  if (!log || !log.lead_id) return;
  try {
    if (!salesforceConfigured()) return;
    const owner = log.caller;
    if (!owner || !(await sfConnected(owner).catch(() => false))) return;
    const r = CALL_RESULTS.find((x) => x.key === log.result);
    const task = await createTask(owner, {
      WhoId: log.lead_id,
      Subject: `コール：${(r && r.sf) || log.result}`,
      Status: "完了",
      Type: "Call",
      ActivityDate: new Date(log.at || Date.now()).toISOString().slice(0, 10),
      Description: [`結果：${log.result}`, log.memo ? `メモ：${log.memo}` : ""].filter(Boolean).join("\n"),
    });
    await markCallSynced(log.id, { taskId: (task && (task.id || task.Id)) || "done" });
    console.log(`[コール] Salesforceに残しました：${log.company}（${log.result}）`);
  } catch (e) {
    await markCallSynced(log.id, { error: e.message }).catch(() => {});
    console.warn(`[コール] Salesforceへ送れませんでした：${e.message}`);
  }
}

// 送れなかったぶんを、あとから送り直す（5分おき）
async function retryCallSync() {
  try {
    const rows = await pendingCallLogs(30);
    for (const log of rows) await syncCallToSf(log);
  } catch {}
}

// kinbotがSalesforceに書き込んだ活動を「見るだけ」（削除はしない）
app.get("/api/calls/sf-written", async (req, res) => {
  try {
    const pad = (n) => String(n).padStart(2, "0");
    const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const nowJ = new Date(Date.now() + 9 * 3600 * 1000);
    const ok日 = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
    let from = ok日(req.query.from) ? String(req.query.from) : ymd(nowJ);
    let to = ok日(req.query.to) ? String(req.query.to) : ymd(nowJ);
    if (from > to) { const t = from; from = to; to = t; }

    const rows = await sfWrittenLogs(from, to);
    const 人 = {};
    for (const r of rows) {
      const k = r.caller || "（不明）";
      人[k] = (人[k] || 0) + 1;
    }
    res.json({
      ok: true, from, to, 件数: rows.length,
      人ごと: Object.entries(人).map(([k, n]) => ({ 誰: k, 件数: n })).sort((a, b) => b.件数 - a.件数),
      items: rows.map((r) => ({
        日時: r["日時"], 誰: r.caller || "", 会社: r.company || "",
        結果: r.result || "", メモ: String(r.memo || "").slice(0, 80),
        SFのID: r.sf_task_id || "",
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 架電記録を全部消す（テストで入れたぶんの片づけ用。戻せないので合言葉が要る）
app.post("/api/calls/clear-logs", async (req, res) => {
  try {
    if (!req.isAdmin) return res.status(403).json({ error: "この操作はできません" });
    if (String((req.body || {}).confirm || "") !== "消します") {
      return res.status(400).json({ error: "確認の言葉がちがいます" });
    }
    const n = await clearCallLogs();
    console.log(`[kincall] 架電記録を全部消しました（${n}件） by ${req.user}`);
    res.json({ ok: true, 消した件数: n });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// コメントをAIに読ませて、どんな断られ方が多いかを調べる
app.post("/api/calls/memo-analysis", async (req, res) => {
  try {
    const b = req.body || {};
    const 誰 = String(b.caller || "").trim().toLowerCase();
    const pad = (n) => String(n).padStart(2, "0");
    const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const nowJ = new Date(Date.now() + 9 * 3600 * 1000);
    const ok日 = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
    let from, to;
    if (ok日(b.from) && ok日(b.to)) {
      from = String(b.from); to = String(b.to);
      if (from > to) { const t = from; from = to; to = t; }
    } else {
      const 日数 = Math.min(365, Math.max(1, parseInt(b.days, 10) || 30));
      to = ymd(nowJ);
      from = ymd(new Date(nowJ.getTime() - (日数 - 1) * 86400000));
    }

    const rows = await callMemos(from, to, 誰);
    if (!rows.length) return res.json({ ok: true, 件数: 0, 分類: [], from, to });

    // AIに渡す材料（長すぎないように切る）
    const 材料 = rows.slice(0, 300).map((r, i) =>
      `${i + 1}. [${r.result || "-"}] ${String(r.memo || "").slice(0, 160)}`).join("\n");

    const sys = "あなたは法人向けインサイドセールスの記録を読む分析役です。" +
      "架電メモから「断られ方・進まない理由」を意味ごとにまとめ、日本語のJSONだけを返します。" +
      "説明文やコードブロックは書かないでください。";
    const user =
      "次は架電のメモです。どんな理由で断られている／進んでいないかを、意味の近いものでまとめてください。\n" +
      "・多い順に最大10個まで\n" +
      "・分類名は現場で使う短い日本語（例：既存ツールで足りている、採用予定がない、時期が合わない、決裁者に繋がらない、資料だけ希望）\n" +
      "・件数は、その分類に当てはまるメモの数\n" +
      "・例は実際のメモから2つまで、短く\n" +
      "・最後に、件数が多い分類への打ち手を3つまで\n\n" +
      "返す形：{\"分類\":[{\"名前\":\"\",\"件数\":0,\"例\":[\"\"]}],\"打ち手\":[\"\"]}\n\n" +
      "メモ:\n" + 材料;

    const raw = await callLLMPublic(sys, user, 1200, { json: true });
    let out = {};
    try {
      const t = String(raw || "").replace(/```json|```/g, "").trim();
      out = typeof raw === "object" && raw ? raw : JSON.parse(t);
    } catch { out = {}; }

    const 分類 = (out["分類"] || []).map((x) => ({
      名前: String(x["名前"] || "").slice(0, 40),
      件数: Number(x["件数"] || 0),
      例: (x["例"] || []).slice(0, 2).map((v) => String(v).slice(0, 120)),
    })).filter((x) => x.名前).sort((a, b) => b.件数 - a.件数);

    res.json({
      ok: true, from, to, 件数: rows.length, 読んだ数: Math.min(300, rows.length),
      分類, 打ち手: (out["打ち手"] || []).slice(0, 3).map((v) => String(v).slice(0, 200)),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 「0にする日」（休みなど。プロセスシートと同じ設定）を、月日の集合で返す。
// 実績の集計から、その日の記録を外すために使う。
async function zeroDayMDSet() {
  try {
    const st = await getSettings();
    // 空・未設定のときは、既定として 8/21 を0にする（画面で別の日を入れれば置き換わる）
    const raw = String(st.psZeroDates ?? "").trim() || "8/21";
    return new Set(parseZeroDates(raw));
  } catch { return new Set(); }
}
const mdKeyOf = (iso) => {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${+m[2]}/${+m[3]}` : "";
};

// メンバー別の分析（全体像・内訳・時間帯・属性・推移）
app.get("/api/calls/analysis", async (req, res) => {
  try {
    const pad = (n) => String(n).padStart(2, "0");
    const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const nowJ = new Date(Date.now() + 9 * 3600 * 1000);
    const ok日 = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
    // 日付を直接もらえる。無ければ「直近◯日」で決める。
    let from, to, 日数;
    if (ok日(req.query.from) && ok日(req.query.to)) {
      from = String(req.query.from); to = String(req.query.to);
      if (from > to) { const t = from; from = to; to = t; }
      日数 = Math.round((new Date(to + "T00:00:00Z") - new Date(from + "T00:00:00Z")) / 86400000) + 1;
    } else {
      日数 = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
      to = ymd(nowJ);
      from = ymd(new Date(nowJ.getTime() - (日数 - 1) * 86400000));
    }

    const members = await listMembers().catch(() => []);
    const internsList = await listInterns().catch(() => []);
    const internSet = new Set((internsList || []).map((x) => String(x.email || "").toLowerCase()).filter(Boolean));
    const inside = (members || []).filter((mm) =>
      (Array.isArray(mm.roles) && mm.roles.includes("inside")) || internSet.has(String(mm.email || "").toLowerCase()));
    const nameOf = new Map(inside.map((mm) => [String(mm.email || "").toLowerCase(), mm.name || mm.email]));

    const rows = await callAnalysis(from, to);
    const zeroSet = await zeroDayMDSet();
    const 接触判定 = (v) => /接触|アポ|再コール|断り|見送り/.test(v) && !/不在|コールのみ|NG/.test(v);
    const アポ判定 = (v) => /アポ獲得/.test(v);

    const 空 = () => ({
      コール: 0, 接触: 0, アポ: 0,
      日: new Set(), 内訳: {}, 時間帯: {}, 業種: {}, ステージ: {}, 週: {},
    });
    // 1件のコールを、指定した箱に足す（メンバー別・全体で共通に使う）
    const applyRow = (o, v, 接, ア, r) => {
      o.コール++; if (接 || ア) o.接触++; if (ア) o.アポ++;
      o.日.add(r["日"]);
      o.内訳[v] = (o.内訳[v] || 0) + 1;
      const h = Number(r["時"]);
      if (!o.時間帯[h]) o.時間帯[h] = { コール: 0, 接触: 0, アポ: 0 };
      o.時間帯[h].コール++; if (接 || ア) o.時間帯[h].接触++; if (ア) o.時間帯[h].アポ++;
      const 足す = (箱, key) => {
        const k = String(key || "").trim() || "（未設定）";
        if (!箱[k]) 箱[k] = { コール: 0, 接触: 0, アポ: 0 };
        箱[k].コール++; if (接 || ア) 箱[k].接触++; if (ア) 箱[k].アポ++;
      };
      足す(o.業種, r.industry); 足す(o.ステージ, r.stage);
      // 週（月曜はじまり）
      const d = new Date(r["日"] + "T00:00:00Z");
      const off = (d.getUTCDay() + 6) % 7;
      const wk = ymd(new Date(d.getTime() - off * 86400000));
      if (!o.週[wk]) o.週[wk] = { コール: 0, 接触: 0, アポ: 0 };
      o.週[wk].コール++; if (接 || ア) o.週[wk].接触++; if (ア) o.週[wk].アポ++;
    };

    const 全 = 空();   // インサイド全体（全員合算）
    const 表 = new Map();
    for (const r of rows) {
      const em = String(r.caller || "").toLowerCase();
      if (!nameOf.has(em)) continue;
      if (zeroSet.has(mdKeyOf(r["日"]))) continue;   // 0にする日は数えない
      if (!表.has(em)) 表.set(em, 空());
      const o = 表.get(em);
      const v = String(r.result || "") || "（記録なし）";
      const 接 = 接触判定(v), ア = アポ判定(v);
      applyRow(o, v, 接, ア, r);   // メンバー別
      applyRow(全, v, 接, ア, r);   // インサイド全体
    }

    const 率 = (a, b) => (b ? +(a / b * 100).toFixed(1) : 0);
    const 上位 = (箱, n = 8) => Object.entries(箱)
      .sort((a, b) => b[1].コール - a[1].コール).slice(0, n)
      .map(([k, v]) => ({ 名前: k, ...v, 接触率: 率(v.接触, v.コール), アポ率: 率(v.アポ, v.コール) }));

    // 1つの箱を、画面に出す形（内訳・時間帯・業種・ステージ・週つき）にする
    const 仕上げ = (誰, メール, o) => ({
      誰, メール,
      コール: o.コール, 接触: o.接触, アポ: o.アポ,
      接触率: 率(o.接触, o.コール), アポ率: 率(o.アポ, o.コール),
      稼働日数: o.日.size,
      "1日あたり": o.日.size ? +(o.コール / o.日.size).toFixed(1) : 0,
      内訳: Object.entries(o.内訳).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ 名前: k, 件数: n, 割合: 率(n, o.コール) })),
      時間帯: Object.entries(o.時間帯).sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([h, v]) => ({ 時: Number(h), ...v, 接触率: 率(v.接触, v.コール) })),
      業種: 上位(o.業種), ステージ: 上位(o.ステージ),
      週: Object.entries(o.週).sort((a, b) => a[0] < b[0] ? -1 : 1)
        .map(([k, v]) => ({ 週: k, ...v, 接触率: 率(v.接触, v.コール) })),
    });

    const items = [...表.entries()]
      .map(([em, o]) => 仕上げ(nameOf.get(em) || em, em, o))
      .sort((a, b) => b.コール - a.コール);

    const 合計 = items.reduce((a, x) => ({
      コール: a.コール + x.コール, 接触: a.接触 + x.接触, アポ: a.アポ + x.アポ,
    }), { コール: 0, 接触: 0, アポ: 0 });
    const チーム = { ...合計, 接触率: 率(合計.接触, 合計.コール), アポ率: 率(合計.アポ, 合計.コール) };

    // インサイド全体の内訳（メンバー別と同じ形）
    const 全体 = 仕上げ("インサイド全体", "", 全);

    res.json({ ok: true, from, to, 日数, items, チーム, 全体 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 実績を並べて比べる（メンバー × 日付／週／月）
app.get("/api/calls/stats-grid", async (req, res) => {
  try {
    const period = ["day", "week", "month"].includes(String(req.query.period)) ? String(req.query.period) : "day";
    const 本数 = Math.min(26, Math.max(2, parseInt(req.query.span, 10) || (period === "day" ? 7 : period === "week" ? 8 : 6)));
    const pad = (n) => String(n).padStart(2, "0");
    const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const nowJ = new Date(Date.now() + 9 * 3600 * 1000);
    const y = nowJ.getUTCFullYear(), m = nowJ.getUTCMonth(), d0 = nowJ.getUTCDate();

    // 並べる区切りを作る（新しいものが右）
    const 区切り = [];
    // 日ごとのときは、土日を飛ばして平日だけを並べる
    if (period === "day") {
      let i = 0;
      while (区切り.length < 本数 && i < 本数 * 3) {
        const d = new Date(Date.UTC(y, m, d0 - i));
        i++;
        const w = d.getUTCDay();
        if (w === 0 || w === 6) continue;   // 日曜・土曜はとばす
        区切り.unshift({ key: ymd(d), 名前: `${d.getUTCMonth() + 1}/${d.getUTCDate()}`,
          曜日: "日月火水木金土"[w], from: ymd(d), to: ymd(d) });
      }
    }
    for (let i = 本数 - 1; i >= 0; i--) {
      if (period === "day") {
        continue;   // 上で作った
      } else if (period === "week") {
        const off = (nowJ.getUTCDay() + 6) % 7;
        const s0 = new Date(Date.UTC(y, m, d0 - off - i * 7));
        const e0 = new Date(Date.UTC(y, m, d0 - off - i * 7 + 6));
        区切り.push({ key: ymd(s0), 名前: `${s0.getUTCMonth() + 1}/${s0.getUTCDate()}週`, from: ymd(s0), to: ymd(e0) });
      } else {
        const s0 = new Date(Date.UTC(y, m - i, 1));
        const e0 = new Date(Date.UTC(y, m - i + 1, 0));
        区切り.push({ key: `${s0.getUTCFullYear()}-${pad(s0.getUTCMonth() + 1)}`,
          名前: `${s0.getUTCMonth() + 1}月`, from: ymd(s0), to: ymd(e0) });
      }
    }

    // インサイドのメンバーだけ
    const members = await listMembers().catch(() => []);
    const internsList = await listInterns().catch(() => []);
    const internSet = new Set((internsList || []).map((x) => String(x.email || "").toLowerCase()).filter(Boolean));
    const inside = (members || []).filter((mm) =>
      (Array.isArray(mm.roles) && mm.roles.includes("inside")) || internSet.has(String(mm.email || "").toLowerCase()));
    const nameOf = new Map(inside.map((mm) => [String(mm.email || "").toLowerCase(), mm.name || mm.email]));

    const rows = await callStatsByDay(区切り[0].from, 区切り[区切り.length - 1].to);
    const zeroSet = await zeroDayMDSet();
    const 属する = (日) => {
      for (const c of 区切り) if (日 >= c.from && 日 <= c.to) return c.key;
      return "";
    };
    const 表 = new Map();   // email -> key -> {コール,接触,アポ}
    for (const r of rows) {
      const em = String(r.caller || "").toLowerCase();
      if (!nameOf.has(em)) continue;
      if (zeroSet.has(mdKeyOf(r["日"]))) continue;   // 0にする日は数えない
      const k = 属する(r["日"]);
      if (!k) continue;
      if (!表.has(em)) 表.set(em, {});
      const o = 表.get(em);
      if (!o[k]) o[k] = { コール: 0, 接触: 0, アポ: 0 };
      o[k].コール += r.n;
      const v = String(r.result || "");
      const 接触した = /接触|アポ|再コール|断り|見送り/.test(v) && !/不在|コールのみ|NG/.test(v);
      const アポ = /アポ獲得/.test(v);
      if (接触した || アポ) o[k].接触 += r.n;
      if (アポ) o[k].アポ += r.n;
    }

    const items = inside.map((mm) => {
      const em = String(mm.email || "").toLowerCase();
      const o = 表.get(em) || {};
      return {
        誰: nameOf.get(em) || mm.email,
        値: 区切り.map((c) => o[c.key] || { コール: 0, 接触: 0, アポ: 0 }),
      };
    }).filter((x) => x.値.some((v) => v.コール || v.接触 || v.アポ) || true);

    // 合計の行も作る
    const 合計 = 区切り.map((c, i) => items.reduce((a, x) => ({
      コール: a.コール + x.値[i].コール, 接触: a.接触 + x.値[i].接触, アポ: a.アポ + x.値[i].アポ,
    }), { コール: 0, 接触: 0, アポ: 0 }));

    // いまの日（週・月）がどれかを教える
    const 今 = 区切り.length ? 区切り[区切り.length - 1].key : "";
    res.json({ ok: true, period, 区切り, items, 合計, 今 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 実績（日・週・月で切り替えられる）
app.get("/api/calls/stats", async (req, res) => {
  try {
    const anchor = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || "")) ? req.query.date : jstDate(0);
    const period = ["day", "week", "month"].includes(String(req.query.period)) ? String(req.query.period) : "day";

    // 期間の開始〜終了（日本時間の暦日）を出す
    const pad = (n) => String(n).padStart(2, "0");
    const ymd = (dt) => `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
    const [ay, am, ad] = anchor.split("-").map(Number);
    let fromD, toD;
    if (period === "week") {
      const base = new Date(Date.UTC(ay, am - 1, ad));
      const off = (base.getUTCDay() + 6) % 7; // 月曜起点（月=0…日=6）
      fromD = new Date(Date.UTC(ay, am - 1, ad - off));
      toD = new Date(Date.UTC(ay, am - 1, ad - off + 6));
    } else if (period === "month") {
      fromD = new Date(Date.UTC(ay, am - 1, 1));
      toD = new Date(Date.UTC(ay, am, 0)); // 当月の最終日
    } else {
      fromD = new Date(Date.UTC(ay, am - 1, ad));
      toD = fromD;
    }
    const from = ymd(fromD), to = ymd(toD);

    // インサイドのメンバーだけを対象にする（合計＋メンバー別）。名前で出す。
    // 「インサイド」は roles の"inside" か interns（アポ獲得者マスタ）で判定する。
    const members = await listMembers().catch(() => []);
    const internsList = await listInterns().catch(() => []);
    const internSet = new Set((internsList || []).map((x) => String(x.email || "").toLowerCase()).filter(Boolean));
    const inside = (members || []).filter((m) =>
      (Array.isArray(m.roles) && m.roles.includes("inside")) || internSet.has(String(m.email || "").toLowerCase()));
    const insideSet = new Set(inside.map((m) => String(m.email || "").toLowerCase()).filter(Boolean));
    const nameOf = new Map(inside.map((m) => [String(m.email || "").toLowerCase(), m.name || m.email]));

    const rows = period === "day"
      ? await callStats(from, "")
      : await callStatsRange(from, to, "");

    const by = new Map();
    for (const r of rows) {
      const email = String(r.caller || "").toLowerCase();
      if (!insideSet.has(email)) continue; // インサイドの人だけ数える
      if (!by.has(email)) by.set(email, { 誰: nameOf.get(email) || r.caller, コール: 0, 接触: 0, アポ: 0 });
      const o = by.get(email);
      o.コール += r.n;
      const v = String(r.result || "");
      const 接触した = /接触|アポ|再コール|断り|見送り/.test(v) && !/不在|コールのみ|NG/.test(v);
      const アポ = /アポ獲得/.test(v);
      if (接触した || アポ) o.接触 += r.n;
      if (アポ) o.アポ += r.n;
    }
    const list = [...by.values()].sort((a, b) => b.コール - a.コール);
    const sum = list.reduce((o, x) => ({
      コール: o.コール + x.コール, 接触: o.接触 + x.接触, アポ: o.アポ + x.アポ,
    }), { コール: 0, 接触: 0, アポ: 0 });
    res.json({ ok: true, period, date: anchor, from, to, 合計: sum, items: list });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────────────────────────────────────
// ロボに話しかける（画面の案内係）
//
// 「これどうやるの？」に答える。
// 答えられないことと要望は、その場で開発メモに残す。
// ───────────────────────────────────────────────────────────
app.post("/api/ask-bot", async (req, res) => {
  try {
    const message = String(req.body?.message || "").slice(0, 1000);
    const history = Array.isArray(req.body?.history) ? req.body.history.slice(-6) : [];
    const r = await askBot({ message, history, callLLM: callLLMPublic });

    let saved = null;
    if (r.note) {
      // 同じ内容が溜まらないよう、似ているものがあれば残さない
      let seen = [];
      try {
        const notes = await listDevNotes({ limit: 300 });
        const gone = await listDismissed(300).catch(() => []);
        seen = notes.concat(gone).map((n) => ({ title: n.title, detail: "" }));
      } catch {}
      const fresh = dropSimilar([{ title: r.note.title, detail: message }], seen);
      if (fresh.length) {
        saved = await addDevNote({
          key: `bot:${Date.now()}:${r.note.title}`.slice(0, 200),
          kind: r.note.kind,
          title: r.note.title,
          detail: `聞かれたこと：${message}`,
          source: "ロボに相談",
          createdBy: req.user || "",
        }).catch(() => null);
        notifyNewDevNote(saved).catch(() => {});
        console.log(`[ロボ] 開発メモに残しました（${r.note.kind}）：${r.note.title}`);
      } else {
        console.log(`[ロボ] 同じ内容が既にあるので残しませんでした：${r.note.title}`);
      }
    }
    res.json({ ok: true, answer: r.answer, noted: !!saved, note: r.note || null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ───────────────────────────────────────────────────────────
// 開発メモ（直したいこと）
// ───────────────────────────────────────────────────────────
// 新しい要望が1件追加されたら、その内容をGoogle Chatに送る。
// hits が1のときだけ＝本当に新規のときだけ通知する（重複追加では送らない）。
async function notifyNewDevNote(note) {
  try {
    if (!note || Number(note.hits) > 1) return;
    const kindLabel = { request: "要望", bug: "不具合", idea: "アイデア" }[note.kind] || note.kind || "メモ";
    const who = note.created_by ? `（${note.created_by}）` : "";
    const detail = note.detail ? `\n${String(note.detail).slice(0, 300)}` : "";
    await notifyChat(`📝 開発メモに${kindLabel}が追加されました${who}\n・${note.title}${detail}`);
  } catch (e) { console.warn("[開発メモ] 追加通知に失敗", e.message); }
}

app.get("/api/dev-notes", async (req, res) => {
  try {
    const rows = await listDevNotes({ status: String(req.query.status || ""), limit: 300 });
    res.json({ kinds: NOTE_KINDS, items: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/dev-notes", async (req, res) => {
  try {
    const b = req.body || {};
    const title = String(b.title || "").trim();
    if (!title) return res.status(400).json({ error: "内容を書いてください" });
    const r = await addDevNote({
      key: `manual:${Date.now()}:${title}`.slice(0, 200),
      kind: b.kind || "request", title, detail: String(b.detail || ""),
      source: "画面", createdBy: req.user || "",
    });
    notifyNewDevNote(r).catch(() => {});
    res.json({ ok: true, item: r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// まとめて状態を変える（溜まった案を一度に片づけるため）
app.post("/api/dev-notes/bulk", async (req, res) => {
  try {
    const b = req.body || {};
    const status = String(b.status || "dropped");
    const rows = await listDevNotes({ limit: 500 });
    const target = rows.filter((r) => {
      if (Array.isArray(b.ids) && b.ids.length) return b.ids.includes(r.id);
      if (b.source && r.source !== b.source) return false;
      if (b.kind && r.kind !== b.kind) return false;
      if (b.onlyNew !== false && r.status === "done") return false;
      if (b.all === true) return true;
      return !!(b.source || b.kind);
    });
    for (const r of target) {
      if (status === "dropped") await dismissDevNote(r.id).catch(() => {});
      else await updateDevNote(r.id, { status }).catch(() => {});
    }
    console.log(`[開発メモ] ${target.length}件を${status === "dropped" ? "見送って消しました" : `「${status}」にしました`} by ${req.user}`);
    res.json({ ok: true, changed: target.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch("/api/dev-notes/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    // 「見送り」は一覧から消す。題名は覚えておき、同じ案がまた出ないようにする。
    if (String(req.body?.status || "") === "dropped") {
      const n = await dismissDevNote(id);
      return res.json({ ok: true, dismissed: n });
    }
    const r = await updateDevNote(id, req.body || {});
    res.json({ ok: true, item: r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/dev-notes/:id", async (req, res) => {
  try {
    const n = await deleteDevNote(parseInt(req.params.id, 10));
    res.json({ ok: true, deleted: n });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 朝のまとめを作る（?send=1 でChatにも流す）
app.post("/api/dev-notes/summary", async (req, res) => {
  try {
    const r = await buildMorningSummary(callLLMPublic);
    if (r.empty) return res.json({ ok: true, empty: true, text: "未対応の開発メモはありません。" });
    if (req.body?.send === true) await notifyAll(r.text, "assign");
    res.json({ ok: true, ...r, sent: req.body?.send === true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────────────────────────────────────
// 週のボード（ホワイトボードの代わり）
//
// 月曜の朝礼までに「テーマ・定量目標・具体的な施策」を書き、
// 金曜の終礼で「振り返り」を書く。実績はkinbotが自動で添える。
// ───────────────────────────────────────────────────────────

// その日が入る週の月曜日を返す（日付は日本時間で考える）
function weekStartOf(dateJst) {
  const d = new Date((dateJst || jstDate(0)) + "T00:00:00Z");
  const w = (d.getUTCDay() + 6) % 7;         // 月曜を0にする
  d.setUTCDate(d.getUTCDate() - w);
  return d.toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ボードを書く人。
// 全員ではなく、決めた人だけにする（人数が多いと見づらいため）。
// 既定は 植野・江田・田中・森田。設定で変えられる。
const WEEKLY_DEFAULT = ["植野", "江田", "田中", "森田"];

async function weeklyMembers() {
  const map = new Map();
  for (const i of await listInterns().catch(() => [])) {
    if (i.email) map.set(String(i.email).toLowerCase(), i.name || i.email);
  }
  for (const c of await listClosers({ activeOnly: true }).catch(() => [])) {
    if (c.email) map.set(String(c.email).toLowerCase(), c.name || c.email);
  }
  const all = [...map.entries()].map(([email, name]) => ({ email, name }));

  const st = await getSettings().catch(() => ({}));
  const raw = st.weeklyMembers === undefined ? WEEKLY_DEFAULT.join(",") : String(st.weeklyMembers);
  const want = raw.split(/[,、\n]/).map((x) => x.trim()).filter(Boolean);
  if (!want.length) return all;   // 空にしたら全員

  const norm = (v) => String(v || "").replace(/[\s　]/g, "").toLowerCase();
  const picked = [];
  for (const w of want) {
    const k = norm(w);
    // メールでも名前（一部でも）でも指定できる
    const hit = all.find((m) => norm(m.email) === k || norm(m.name) === k) ||
                all.find((m) => norm(m.name).startsWith(k) || k.startsWith(norm(m.name)));
    if (hit && !picked.some((p) => p.email === hit.email)) picked.push(hit);
  }
  return picked.length ? picked : all;
}

// ホワイトボードの写真から、週のボードを埋める。
// 読み取った結果をそのまま保存せず、いったん画面に出して人が直せるようにする。
const boardUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.post("/api/weekly/from-photo", boardUpload.single("photo"), async (req, res) => {
  try {
    if (!readerAvailable()) {
      return res.status(400).json({ error: "画像を読む設定（GEMINI_API_KEY）がありません" });
    }
    if (!req.file || !req.file.buffer) return res.status(400).json({ error: "写真がありません" });

    const people = await readWhiteboard({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype || "image/jpeg",
    });

    // 読み取った名前を、kinbotのメンバーに結びつける
    const members = await weeklyMembers();
    const norm = (v) => String(v || "").replace(/[\s　]/g, "");
    const out = people.map((p) => {
      const k = norm(p.name);
      const hit = members.find((m) => norm(m.name) === k) ||
                  members.find((m) => norm(m.name).startsWith(k) || k.startsWith(norm(m.name)));
      return {
        読み取った名前: p.name,
        member: hit ? hit.email : "",
        name: hit ? hit.name : "",
        theme: p.theme, targets: p.targets, actions: p.actions,
      };
    });

    const 見つからない = out.filter((x) => !x.member).map((x) => x.読み取った名前);
    console.log(`[週のボード] 写真から ${out.length}人ぶん読み取りました` +
      (見つからない.length ? `（結びつかない名前：${見つからない.join("、")}）` : ""));
    res.json({
      ok: true,
      people: out,
      見つからない,
      note: "中身を確かめてから「この内容で入れる」を押してください。まだ保存していません。",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 読み取った内容を、まとめて保存する
app.post("/api/weekly/apply-photo", async (req, res) => {
  try {
    const week = weekStartOf(String(req.body?.week || "").slice(0, 10) || jstDate(0));
    const list = Array.isArray(req.body?.people) ? req.body.people : [];
    let saved = 0;
    for (const p of list) {
      const member = String(p.member || "").toLowerCase();
      if (!member) continue;
      const items = (Array.isArray(p.actions) ? p.actions : [])
        .map((t, i) => ({ id: `p${i}`, text: String(t).slice(0, 200), done: false, review: "" }))
        .filter((x) => x.text);
      await saveWeekly({
        weekStart: week, member, memberName: p.name || "",
        theme: String(p.theme || "").slice(0, 200),
        targets: String(p.targets || "").slice(0, 600),
        items,
        updatedBy: req.user || "",
      });
      saved++;
    }
    console.log(`[週のボード] 写真の内容を ${saved}人ぶん入れました by ${req.user}`);
    res.json({ ok: true, saved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────────────────────────────────────
// ホームのツール置き場
//
// よく使うツールを、人ごとに並べておける。押すとその画面へ飛ぶ。
// 「天気予報」は全員に必ず入れる（毎週みんなが使うため）。
// ───────────────────────────────────────────────────────────
const HOME_TOOLS = [
  { id: "weekly", href: "weekly.html", label: "天気予報", always: true },
  { id: "apo", href: "apo.html", label: "アポ振り分け" },
  { id: "launch", href: "sf-launch.html", label: "商談立ち上げ" },
  { id: "pending", href: "sf-launch.html?tab=pending", label: "立ち上げ待ち" },
  { id: "process", href: "sf-launch.html?tab=process", label: "プロセスシート" },
  { id: "docs", href: "docs.html", label: "資料トラッキング" },
  { id: "history", href: "history.html", label: "商談履歴" },
  { id: "report", label: "実績", href: "report.html" },
  { id: "style", href: "style-analysis.html", label: "営業スタイル分析" },
  { id: "deals", href: "deals.html", label: "案件" },
  { id: "rec", href: "index.html", label: "レコーディング" },
  { id: "kincall", href: "/kincall", label: "kincall" },
  { id: "dev", href: "dev.html", label: "開発メモ" },
];

app.get("/api/home-tools", async (req, res) => {
  try {
    const s = await getUserSettings(req.user).catch(() => ({}));
    const saved = Array.isArray(s.homeTools) ? s.homeTools : null;
    // まだ選んでいない人は、よく使うものを最初から入れておく
    const def = ["weekly", "apo", "launch", "docs"];
    const ids = saved || def;
    // 天気予報は必ず先頭に入れる
    const list = ["weekly", ...ids.filter((x) => x !== "weekly")];
    res.json({
      選んでいるもの: list,
      使えるもの: HOME_TOOLS,
      tools: list.map((id) => HOME_TOOLS.find((t) => t.id === id)).filter(Boolean),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/home-tools", async (req, res) => {
  try {
    const want = Array.isArray(req.body?.tools) ? req.body.tools : [];
    const ok = want.map(String).filter((id) => HOME_TOOLS.some((t) => t.id === id));
    // 天気予報は外せない（全員が使うため）
    const list = ["weekly", ...ok.filter((x) => x !== "weekly")].slice(0, 8);
    await saveUserSettings(req.user, { homeTools: list });
    res.json({ ok: true, 選んでいるもの: list });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 対象メンバーの設定
app.get("/api/weekly/members", async (req, res) => {
  try {
    const st = await getSettings();
    const list = await weeklyMembers();
    res.json({
      指定: st.weeklyMembers === undefined ? WEEKLY_DEFAULT.join(",") : String(st.weeklyMembers),
      いまの対象: list.map((x) => x.name),
      note: "名前かメールを、カンマ区切りで書きます。空にすると全員が出ます。",
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/weekly/members", async (req, res) => {
  try {
    await saveSettings({ weeklyMembers: String(req.body?.members ?? "").slice(0, 400) });
    const list = await weeklyMembers();
    res.json({ ok: true, いまの対象: list.map((x) => x.name) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// その週の実績（アポを何件取ったか）を、名前ごとに数える
async function weeklyResults(weekStart) {
  const from = weekStart, to = addDays(weekStart, 6);
  const rows = await aposTakenInRange({ from, to }).catch(() => []);
  const by = new Map();
  for (const r of rows) {
    const k = String(r.setter || "").replace(/[\s　]/g, "");
    if (!k) continue;
    if (isSkippedPerson(k) && !r.current_owner) continue;
    by.set(k, (by.get(k) || 0) + 1);
  }
  return by;
}

app.get("/api/weekly", async (req, res) => {
  try {
    const week = weekStartOf(String(req.query.week || "").slice(0, 10) || jstDate(0));
    const [rows, members, results] = await Promise.all([
      listWeekly(week),
      weeklyMembers(),
      weeklyResults(week),
    ]);
    const byMember = new Map(rows.map((r) => [String(r.member).toLowerCase(), r]));
    const norm = (v) => String(v || "").replace(/[\s　]/g, "");

    const items = members.map((m) => {
      const r = byMember.get(m.email) || {};
      // 名前が少し違っても実績を拾えるようにする
      let got = results.get(norm(m.name));
      if (got === undefined) {
        for (const [k, v] of results) {
          if (k.startsWith(norm(m.name)) || norm(m.name).startsWith(k)) { got = v; break; }
        }
      }
      // 施策は「タスクのカード」。昔の書き方（1つの文章）で入っていたら、行ごとに分けて移す。
      let items = Array.isArray(r.items) ? r.items : null;
      if (!items) {
        items = String(r.actions || "").split("\n").map((t) => t.trim()).filter(Boolean)
          .map((t, i) => ({ id: `a${i}`, text: t, done: false, review: "" }));
      }
      return {
        member: m.email, name: m.name,
        theme: r.theme || "", targets: r.targets || "",
        items,
        review: r.review || "", updatedAt: r.updated_at || null,
        apos: got || 0,
        written: !!(r.theme || r.targets || items.length),
        reviewed: !!(r.review || items.some((x) => x.review)),
      };
    });

    // 一覧に無い人が書いていたら、その人も出す
    for (const r of rows) {
      if (items.some((x) => x.member === String(r.member).toLowerCase())) continue;
      items.push({
        member: r.member, name: r.member_name || r.member,
        theme: r.theme || "", targets: r.targets || "",
        items: Array.isArray(r.items) ? r.items : [],
        review: r.review || "", updatedAt: r.updated_at, apos: 0,
        written: !!(r.theme || r.targets), reviewed: !!r.review,
      });
    }

    res.json({
      week, weekEnd: addDays(week, 6),
      thisWeek: weekStartOf(jstDate(0)),
      me: req.user || "",
      items,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/weekly", async (req, res) => {
  try {
    const b = req.body || {};
    const week = weekStartOf(String(b.week || "").slice(0, 10) || jstDate(0));
    const member = String(b.member || req.user || "").toLowerCase();
    if (!member) return res.status(400).json({ error: "誰のぶんかが分かりません" });
    const cut = (v, n) => (v === undefined ? undefined : String(v).slice(0, n));
    // 施策のカードを整える（多すぎ・長すぎを防ぐ）
    let items;
    if (Array.isArray(b.items)) {
      items = b.items.slice(0, 20).map((x, i) => ({
        id: String(x.id || `a${i}`).slice(0, 20),
        text: String(x.text || "").slice(0, 200),
        done: x.done === true,
        review: String(x.review || "").slice(0, 500),
      })).filter((x) => x.text || x.review);
    }
    const r = await saveWeekly({
      weekStart: week, member,
      memberName: b.name || "",
      theme: cut(b.theme, 200), targets: cut(b.targets, 600),
      actions: cut(b.actions, 1500), review: cut(b.review, 1500),
      items,
      updatedBy: req.user || "",
    });
    res.json({ ok: true, item: r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 先週の内容を写す（毎週ゼロから書かなくていいように）
app.post("/api/weekly/copy-last", async (req, res) => {
  try {
    const week = weekStartOf(String(req.body?.week || "").slice(0, 10) || jstDate(0));
    const member = String(req.body?.member || req.user || "").toLowerCase();
    const last = await weeklyFor(addDays(week, -7), member);
    if (!last) return res.json({ ok: false, reason: "先週のぶんがありません" });
    const lastItems = Array.isArray(last.items) ? last.items : [];
    const r = await saveWeekly({
      weekStart: week, member, memberName: last.member_name,
      theme: last.theme, targets: last.targets, actions: last.actions,
      // 施策は写すが、できた・振り返りは持ち込まない
      items: lastItems.map((x, i) => ({ id: `a${i}`, text: x.text || "", done: false, review: "" })),
      review: "", updatedBy: req.user || "",
    });
    res.json({ ok: true, item: r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 書けていない人に、本人だけへ声をかける
async function remindWeekly(kind) {
  const week = weekStartOf(jstDate(0));
  const rows = await listWeekly(week);
  const members = await weeklyMembers();
  const byMember = new Map(rows.map((r) => [String(r.member).toLowerCase(), r]));
  const todo = members.filter((m) => {
    const r = byMember.get(m.email) || {};
    const hasItems = Array.isArray(r.items) && r.items.length > 0;
    const reviewed = !!r.review || (Array.isArray(r.items) && r.items.some((x) => x.review));
    return kind === "plan" ? !(r.theme || r.targets || hasItems) : !reviewed;
  });
  let sent = 0;
  for (const m of todo) {
    const text = kind === "plan"
      ? [`${m.name}さん、おはようございます。`, "",
         "今週のボードがまだ空です。朝礼までに書いてください。",
         "・テーマ（やり切ること）", "・定量目標", "・具体的な施策", "",
         "kinbotの「週のボード」から書けます。"].join("\n")
      : [`${m.name}さん、お疲れさまです。`, "",
         "今週の振り返りがまだです。終礼までに書いてください。",
         "kinbotの「週のボード」から書けます（今週の実績も出ています）。"].join("\n");
    const r = await notifyPerson(m.email, text);
    if (r.ok) sent++;
  }
  console.log(`[週のボード] ${kind === "plan" ? "記入" : "振り返り"}のお願いを ${sent}人に送りました`);
  return { sent, todo: todo.map((x) => x.name) };
}

let lastWeeklyKey = "";
async function maybeRemindWeekly() {
  try {
    const st = await getSettings().catch(() => ({}));
    if (st.weeklyRemind !== true) return;
    const now = new Date(Date.now() + 9 * 3600 * 1000);
    const day = now.getUTCDay(), h = now.getUTCHours(), m = now.getUTCMinutes();
    if (m > 4) return;
    // 月曜の朝＝記入のお願い、金曜の夕方＝振り返りのお願い
    const planH = Number(st.weeklyPlanHour ?? 8);
    const reviewH = Number(st.weeklyReviewHour ?? 17);
    let kind = "";
    if (day === 1 && h === planH) kind = "plan";
    else if (day === 5 && h === reviewH) kind = "review";
    if (!kind) return;
    const key = `${now.toISOString().slice(0, 10)}-${kind}`;
    if (lastWeeklyKey === key) return;
    lastWeeklyKey = key;
    await remindWeekly(kind);
  } catch (e) { console.warn("[週のボード]", e.message); }
}

app.get("/api/weekly/remind", async (req, res) => {
  try {
    const st = await getSettings();
    res.json({
      enabled: st.weeklyRemind === true,
      planHour: Number(st.weeklyPlanHour ?? 8),
      reviewHour: Number(st.weeklyReviewHour ?? 17),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/weekly/remind", async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    if (b.enabled !== undefined) patch.weeklyRemind = b.enabled === true;
    if (b.planHour !== undefined) patch.weeklyPlanHour = Math.max(0, Math.min(23, parseInt(b.planHour, 10) || 8));
    if (b.reviewHour !== undefined) patch.weeklyReviewHour = Math.max(0, Math.min(23, parseInt(b.reviewHour, 10) || 17));
    await saveSettings(patch);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/weekly/remind/run", async (req, res) => {
  try {
    const r = await remindWeekly(req.body?.kind === "review" ? "review" : "plan");
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────────────────────────────────────
// 夕方のお知らせ（既定18:30）
//
// その日のうちに片づけたいことを、本人にだけ1対1のチャットで知らせる。
//   ・Salesforceを更新していない商談
//   ・Salesforceを立ち上げられていないアポ
//   ・確定メールを送っていないアポ
// ★ チームのスペースには流さない（できていないことを人前に出さないため）。
// ───────────────────────────────────────────────────────────
let lastEveningKey = "";

async function buildEveningReminders(dateJst) {
  const today = dateJst || jstDate(0);
  const byPerson = new Map();
  const put = (email, kind, line) => {
    const k = String(email || "").toLowerCase();
    if (!k) return;
    if (!byPerson.has(k)) byPerson.set(k, { sf: [], launch: [], mail: [] });
    byPerson.get(k)[kind].push(line);
  };

  // 1. 今日の商談で、Salesforceをまだ更新していないもの
  try {
    const rows = await listMeetings({ isAdmin: true, from: today, to: today, light: true, limit: 300 });
    for (const m of rows) {
      if (m.sf_url) continue;
      put(m.owner, "sf", `${String(m.created_at).slice(11, 16)} ${m.title || m.account || "(名前なし)"}`);
    }
  } catch (e) { console.warn("[夕方] 商談を読めません:", e.message); }

  // 2. Salesforceを立ち上げられていないもの
  try {
    const rows = await listAutolaunch(60);
    for (const r of rows) {
      if (r.ok) continue;
      put(r.owner || r.current_owner, "launch", `${r.company || r.slug}（${reasonText(r.reason, r.detail)}）`);
    }
  } catch (e) { console.warn("[夕方] 立ち上げを読めません:", e.message); }

  // 3. 今日取ったアポで、確定メールを送っていないもの
  try {
    const rows = await aposMailPending(today, 200);
    for (const r of rows) {
      const when = r.start_time ? `${String(r.start_time).slice(5, 10)} ` : "";
      put(r.current_owner, "mail",
        `${when}${r.label || r.slug}${r.client_email ? "" : "（宛先が未登録）"}`);
    }
  } catch (e) { console.warn("[夕方] アポのメールを読めません:", e.message); }

  return byPerson;
}

function eveningText(name, x) {
  const sec = (title, list) => list.length
    ? [`${title}（${list.length}件）`, ...list.slice(0, 10).map((l) => `・${l}`),
       list.length > 10 ? `…ほか${list.length - 10}件` : ""].filter(Boolean).join("\n")
    : "";
  const body = [
    sec("☁️ *Salesforceの更新がまだ*", x.sf),
    sec("🚀 *Salesforceの立ち上げがまだ*", x.launch),
    sec("✉️ *確定メールがまだ*", x.mail),
  ].filter(Boolean).join("\n\n");
  return [
    `${name ? name + "さん、" : ""}お疲れさまです。今日のうちに片づけたいものです。`,
    "",
    body,
    "",
    "（このお知らせは、あなたにだけ送っています）",
  ].join("\n");
}

async function maybeSendEvening() {
  try {
    const st = await getSettings().catch(() => ({}));
    if (st.eveningReminder !== true) return;
    const now = new Date(Date.now() + 9 * 3600 * 1000);
    if (now.getUTCDay() === 0 || now.getUTCDay() === 6) return;   // 土日は送らない
    const h = Number(st.eveningHour ?? 18), m = Number(st.eveningMinute ?? 30);
    if (now.getUTCHours() !== h) return;
    const mm = now.getUTCMinutes();
    if (mm < m || mm > m + 4) return;
    const key = `${now.toISOString().slice(0, 10)}-${h}-${m}`;
    if (lastEveningKey === key) return;
    lastEveningKey = key;

    const byPerson = await buildEveningReminders();
    let sent = 0, skipped = [];
    for (const [email, x] of byPerson) {
      if (!x.sf.length && !x.launch.length && !x.mail.length) continue;
      const name = await displayNameOf(email).catch(() => "");
      const r = await notifyPerson(email, eveningText(name, x));
      if (r.ok) sent++;
      else skipped.push(`${email}（${r.reason || ""}）`);
    }
    console.log(`[夕方] ${sent}人に送りました${skipped.length ? ` ／ 送れず：${skipped.join("、")}` : ""}`);

    // 送れなかった人がいたら、点検用の場所にだけ知らせる（本人が話しかけないと送れないため）
    if (skipped.length) {
      const to = { url: String(st.selfCheckWebhook || "").trim(), space: String(st.selfCheckSpace || "").trim() };
      if (to.url || to.space) {
        await notifyCheck([
          "📨 *夕方のお知らせを送れなかった人がいます*",
          ...skipped.map((s) => `・${s}`),
          "",
          "その人がGoogle Chatで kinbot に一度話しかけると、送れるようになります（「ヘルプ」でOK）。",
        ].join("\n"), to).catch(() => {});
      }
    }
  } catch (e) { console.warn("[夕方]", e.message); }
}

// 設定と、その場で試す
app.get("/api/evening-reminder", async (req, res) => {
  try {
    const st = await getSettings();
    res.json({
      enabled: st.eveningReminder === true,
      hour: Number(st.eveningHour ?? 18),
      minute: Number(st.eveningMinute ?? 30),
      appReady: chatInfo().app ? chatInfo().app.configured : false,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/evening-reminder", async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    if (b.enabled !== undefined) patch.eveningReminder = b.enabled === true;
    if (b.hour !== undefined) patch.eveningHour = Math.max(0, Math.min(23, parseInt(b.hour, 10) || 18));
    if (b.minute !== undefined) patch.eveningMinute = Math.max(0, Math.min(59, parseInt(b.minute, 10) || 30));
    await saveSettings(patch);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// いまの中身を見る（?send=1 で自分にだけ送ってみる）
app.post("/api/evening-reminder/test", async (req, res) => {
  try {
    const byPerson = await buildEveningReminders(String(req.body?.date || "") || undefined);
    const out = [];
    for (const [email, x] of byPerson) {
      if (!x.sf.length && !x.launch.length && !x.mail.length) continue;
      const name = await displayNameOf(email).catch(() => "");
      out.push({ email, name, sf: x.sf.length, launch: x.launch.length, mail: x.mail.length,
                 text: eveningText(name, x) });
    }
    let sent = null;
    if (req.body?.send === true) {
      const me = out.find((o) => o.email === String(req.user || "").toLowerCase());
      sent = me ? await notifyPerson(me.email, me.text) : { ok: false, reason: "あなた宛の分はありません" };
    }
    res.json({ ok: true, people: out, sent });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────────────────────────────────────
// 自己点検 — kinbotが自分の動きを見に行く
//
// ★ 守ること
//   ・チームのスペース（DOC Teamなど）には送らない。送り先は点検用の1か所だけ。
//   ・Salesforceは読むだけ。書き換えない。
// ───────────────────────────────────────────────────────────
let lastCheckState = "";      // 前回と同じ結果なら送らない（同じ知らせを何度も出さないため）
let lastCheckAt = null;
let lastCheckResult = null;
// 自動で動いているかを画面で確かめるための記録。
// 「動いていない」と思ったとき、なぜ動いていないのかが分かるようにする。
const autoState = {
  check: { timer: false, lastTry: null, lastRun: null, reason: "まだ動いていません" },
  ui: { timer: false, lastTry: null, lastRun: null, reason: "まだ動いていません" },
};

async function runSelfCheck() {
  const st = await getSettings().catch(() => ({}));
  const checks = [];

  // 1. ライブ配信
  try {
    const info = liveInfo();
    const relayUrl = String(process.env.LIVE_RELAY_RTMP || "").trim();
    let reach = null;
    if (relayUrl) {
      try {
        const u = new URL(relayUrl.replace(/^rtmp:/, "http:"));
        const net = await import("node:net");
        reach = await new Promise((resolve) => {
          const sock = new net.Socket();
          const done = (ok, why) => { try { sock.destroy(); } catch {} resolve({ ok, why, host: u.hostname, port: Number(u.port || 1935) }); };
          sock.setTimeout(6000);
          sock.once("connect", () => done(true, ""));
          sock.once("timeout", () => done(false, "応答がありません"));
          sock.once("error", (e) => done(false, e.message));
          sock.connect(Number(u.port || 1935), u.hostname);
        });
      } catch (e) { reach = { ok: false, why: e.message }; }
    }
    const relayCount = await countLiveRelay().catch(() => 0);
    checks.push(...checkLive({
      info, relayUrl, relaySecret: !!process.env.RELAY_SECRET, relayCount, reach,
    }));
  } catch (e) { console.warn("[点検] ライブ:", e.message); }

  // 2. プロセスシート
  try {
    let last = null;
    try { last = JSON.parse(st.psLast || "null"); } catch {}
    checks.push(...checkProcessSheet({
      sheetId: st.psSheetId, sheetName: st.psSheetName, reportId: st.psReportId,
      last, autoRun: st.psAutoRun,
    }));
  } catch (e) { console.warn("[点検] シート:", e.message); }

  // 3. つながり（Salesforceは読み取りの確認だけ）
  try {
    const owner = String(st.apoScanOwner || st.apoInviteOwner || "").trim();
    const google = owner ? await gcalConnected(owner).catch(() => false) : false;
    const gm = owner ? await gmailReady(owner).catch(() => ({ ok: false })) : { ok: false };
    const sfOwner = String(st.psOwner || "").trim();
    const sf = sfOwner ? await sfConnected(sfOwner).catch(() => false) : false;
    checks.push(...checkLinks({
      google, gmail: gm.ok, salesforce: sf,
      recall: !!process.env.RECALL_API_KEY,
      chat: !!(chatInfo().targets || chatInfo().app?.configured || chatWebhookUrl()),
    }));
  } catch (e) { console.warn("[点検] 連携:", e.message); }

  // 4. アポの取り込みが止まっていないか
  try {
    const rows = await listCalendarWatches().catch(() => []);
    const alive = rows.filter((w) => !w.expires_at || new Date(w.expires_at).getTime() > Date.now());
    checks.push({
      key: "apo.watch", title: "カレンダーの見張り", ok: alive.length > 0,
      detail: alive.length ? `${alive.length}人ぶんを見張っています` : "見張りがありません（予定を作っても気づけません）",
      fix: "アポ管理→システム→即時通知で「今すぐ設定し直す」を押す",
    });
  } catch {}

  const bad = checks.filter((x) => !x.ok);
  lastCheckAt = new Date().toISOString();
  lastCheckResult = { at: lastCheckAt, checks, bad: bad.length };
  return lastCheckResult;
}

// 決まった間隔で点検し、変わったときだけ知らせる
async function maybeSelfCheck() {
  autoState.check.lastTry = new Date().toISOString();
  try {
    const st = await getSettings().catch(() => ({}));
    if (st.selfCheck !== true) {
      autoState.check.reason = "「自動で点検する」がOFFです";
      return;
    }
    const every = Math.max(5, Number(st.selfCheckEvery ?? 30));
    if (lastCheckAt && Date.now() - new Date(lastCheckAt).getTime() < every * 60 * 1000) {
      autoState.check.reason = `次の点検まで待っています（${every}分おき）`;
      return;
    }

    const r = await runSelfCheck();
    const bad = r.checks.filter((x) => !x.ok);

    // 見つかった問題は、開発メモにも残す（朝のまとめに乗るように）
    for (const x of bad) {
      await devNote({
        key: `check:${x.key}`, kind: "error",
        title: `点検で見つかりました：${x.title} — ${x.detail}`,
        detail: x.fix ? `直し方の案：${x.fix}` : "", source: "自己点検",
      }).catch(() => {});
    }

    // 前と同じ状態なら知らせない（同じ知らせが何度も出ないように）
    const state = bad.map((x) => x.key).sort().join("|");
    if (state === lastCheckState) return;
    const fixed = lastCheckState && !state;
    lastCheckState = state;

    autoState.check.lastRun = new Date().toISOString();
    autoState.check.reason = bad.length ? `${bad.length}件の問題を見つけました` : "問題はありませんでした";

    // Chatへの通知をまとめてOFFにしているときは送らない
    if (st.devSummary !== true) {
      autoState.check.reason += "（Chatへの通知はOFFです）";
      return;
    }
    // ★ 送り先は点検用の1か所だけ。チームのスペースには送らない。
    const to = { url: String(st.selfCheckWebhook || "").trim(), space: String(st.selfCheckSpace || "").trim() };
    if (!to.url && !to.space) {
      autoState.check.reason += "（知らせ先が未設定なので、画面で見るだけです）";
      return;
    }

    if (fixed) {
      await notifyCheck("✅ *点検：問題は無くなりました*", to).catch(() => {});
      return;
    }
    if (!bad.length) return;

    const proposal = await buildProposal(bad, callLLMPublic);
    await notifyCheck([
      `🔎 *点検で ${bad.length}件 見つかりました*`,
      "",
      proposal,
      "",
      "（この知らせは点検用の場所にだけ送っています）",
    ].join("\n"), to).catch(() => {});
    console.log(`[点検] ${bad.length}件の問題を知らせました`);
  } catch (e) {
    autoState.check.reason = "失敗しました：" + e.message;
    console.warn("[点検]", e.message);
  }
}

// 画面から見る・その場で点検する
app.get("/api/self-check", async (req, res) => {
  try {
    const st = await getSettings();
    res.json({
      enabled: st.selfCheck === true,
      every: Number(st.selfCheckEvery ?? 30),
      webhook: st.selfCheckWebhook || "",
      space: st.selfCheckSpace || "",
      last: lastCheckResult,
      auto: autoState.check,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/self-check", async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    if (b.enabled !== undefined) patch.selfCheck = b.enabled === true;
    if (b.every !== undefined) patch.selfCheckEvery = Math.max(5, Math.min(240, parseInt(b.every, 10) || 30));
    if (b.webhook !== undefined) patch.selfCheckWebhook = String(b.webhook || "").trim().slice(0, 500);
    if (b.space !== undefined) patch.selfCheckSpace = String(b.space || "").trim().slice(0, 200);
    await saveSettings(patch);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/self-check/run", async (req, res) => {
  try {
    const r = await runSelfCheck();
    const bad = r.checks.filter((x) => !x.ok);
    let proposal = "";
    if (bad.length) proposal = await buildProposal(bad, callLLMPublic);
    if (req.body?.send === true && bad.length) {
      const st = await getSettings();
      const to = { url: String(st.selfCheckWebhook || "").trim(), space: String(st.selfCheckSpace || "").trim() };
      const sent = await notifyCheck(`🔎 *点検で ${bad.length}件 見つかりました*\n\n${proposal}`, to);
      return res.json({ ...r, proposal, sent: !sent.skipped, reason: sent.reason || "" });
    }
    res.json({ ...r, proposal });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────────────────────────────────────
// 画面の使いやすさを見直す（30分おき）
//
// 1回に1画面ずつ、順番に見ます。出た案は開発メモに残るので、
// 朝のまとめにも、夜間開発にも乗ります。
// ★ 知らせ先は点検用に指定した1か所だけ。チームのスペースには送りません。
// ───────────────────────────────────────────────────────────
let uiReviewLast = null;

async function runUiReview(fileWanted = "") {
  const st = await getSettings().catch(() => ({}));
  const idx = Number(st.uiReviewIndex ?? 0);
  const chosen = fileWanted
    ? { page: UI_PAGES.find((p) => p.file === fileWanted) || UI_PAGES[0], next: idx }
    : nextPage(idx);
  if (!fileWanted) await saveSettings({ uiReviewIndex: chosen.next }).catch(() => {});

  // その画面で最近困っていることがあれば、一緒に渡す（的外れな案にならないように）
  let extra = "";
  try {
    const notes = await listDevNotes({ status: "new", limit: 30 });
    const hit = notes.filter((n) => String(n.title).includes(chosen.page.name)).slice(0, 3);
    if (hit.length) extra = hit.map((n) => n.title).join(" ／ ");
  } catch {}

  // 前に出した案を渡して、同じことを繰り返さないようにする。
  // 見送りにしたものも含める（見送った案をまた出されると意味がないため）。
  let already = [], allSeen = [];
  try {
    const notes = await listDevNotes({ limit: 500 });
    const mine = notes.filter((n) => n.source === "画面の見直し");
    already = mine
      .filter((n) => String(n.title).startsWith(`${chosen.page.name}：`))
      .map((n) => String(n.title).replace(`${chosen.page.name}：`, ""))
      .slice(0, 40);
    // 似ているかの判定には、すべての画面のぶんと、見送ったぶんを使う
    allSeen = mine.map((n) => ({ title: n.title, detail: String(n.detail || "").slice(0, 120) }));
    const gone = await listDismissed(500).catch(() => []);
    allSeen = allSeen.concat(gone.map((g) => ({ title: g.title, detail: String(g.detail || "").slice(0, 120) })));
    // AIに渡す一覧にも、見送ったものを混ぜる
    already = already.concat(
      gone.filter((g) => String(g.title).startsWith(`${chosen.page.name}：`))
          .map((g) => String(g.title).replace(`${chosen.page.name}：`, ""))).slice(0, 60);
  } catch {}

  const publicDir = path.join(__dirname, "..", "public");
  const r = await reviewPage(publicDir, chosen.page, callLLMPublic, extra, already);
  if (r.error) return { error: r.error, page: chosen.page.name };

  // 1件ずつ開発メモに残す。
  // ただし、言い回しが違うだけで前と同じ内容のものは残さない。
  const all = splitIdeas(r.text);
  const ideas = dropSimilar(
    all.map((x) => ({ ...x, title: `${chosen.page.name}：${x.title}` })),
    allSeen);
  const skipped = all.length - ideas.length;
  for (const it of ideas) {
    await devNote({
      key: `ui:${chosen.page.file}:${it.title}`.slice(0, 200), kind: "idea",
      title: it.title, detail: it.detail, source: "画面の見直し",
    }).catch(() => {});
  }
  if (skipped) console.log(`[画面見直し] 前と同じ内容の案 ${skipped}件は残しませんでした`);

  uiReviewLast = {
    at: new Date().toISOString(), page: chosen.page.name, file: chosen.page.file,
    text: r.text, count: ideas.length, skipped,
  };
  return uiReviewLast;
}

let lastUiAt = 0;
async function maybeUiReview() {
  autoState.ui.lastTry = new Date().toISOString();
  try {
    const st = await getSettings().catch(() => ({}));
    if (st.uiReview !== true) {
      autoState.ui.reason = "「自動で見直す」がOFFです";
      return;
    }
    const every = Math.max(10, Number(st.uiReviewEvery ?? 30));
    if (Date.now() - lastUiAt < every * 60 * 1000) {
      autoState.ui.reason = `次の見直しまで待っています（${every}分おき）`;
      return;
    }
    lastUiAt = Date.now();

    const r = await runUiReview();
    if (!r || r.error) {
      autoState.ui.reason = "見直せませんでした：" + ((r && r.error) || "理由不明");
      return;
    }
    autoState.ui.lastRun = new Date().toISOString();
    autoState.ui.reason = `${r.page} の案を ${r.count}件 出しました`;

    // ★ 点検と同じ1か所にだけ送る
    if (st.devSummary !== true) {
      autoState.ui.reason += "（Chatへの通知はOFFです）";
      return;
    }
    const to = { url: String(st.selfCheckWebhook || "").trim(), space: String(st.selfCheckSpace || "").trim() };
    if (!to.url && !to.space) {
      autoState.ui.reason += "（知らせ先が未設定なので、画面で見るだけです）";
      return;
    }
    await notifyCheck([
      `🎨 *画面の見直し：${r.page}*`,
      "",
      r.text,
      "",
      "（開発メモにも残しました）",
    ].join("\n"), to).catch(() => {});
    console.log(`[画面見直し] ${r.page} の案を ${r.count}件 出しました`);
  } catch (e) {
    autoState.ui.reason = "失敗しました：" + e.message;
    console.warn("[画面見直し]", e.message);
  }
}

app.get("/api/ui-review", async (req, res) => {
  try {
    const st = await getSettings();
    res.json({
      enabled: st.uiReview === true,
      every: Number(st.uiReviewEvery ?? 30),
      pages: UI_PAGES.map((p) => ({ file: p.file, name: p.name })),
      nextPage: UI_PAGES[Number(st.uiReviewIndex ?? 0) % UI_PAGES.length].name,
      last: uiReviewLast,
      auto: autoState.ui,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/ui-review", async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    if (b.enabled !== undefined) patch.uiReview = b.enabled === true;
    if (b.every !== undefined) patch.uiReviewEvery = Math.max(10, Math.min(240, parseInt(b.every, 10) || 30));
    await saveSettings(patch);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/ui-review/run", async (req, res) => {
  try {
    const r = await runUiReview(String(req.body?.file || ""));
    if (r.error) return res.status(500).json({ error: r.error });
    if (req.body?.send === true) {
      const st = await getSettings();
      const to = { url: String(st.selfCheckWebhook || "").trim(), space: String(st.selfCheckSpace || "").trim() };
      const sent = await notifyCheck(`🎨 *画面の見直し：${r.page}*\n\n${r.text}`, to);
      return res.json({ ...r, sent: !sent.skipped, reason: sent.reason || "" });
    }
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────────────────────────────────────
// 自動改善のスイッチ
//
// 1時間ごとの自動改善が、本番へ入れてよいかどうかをここで決めます。
// おかしくなったら、まずここをOFFにすれば止まります。
// ───────────────────────────────────────────────────────────
app.get("/api/auto-apply", async (req, res) => {
  try {
    const st = await getSettings();
    const now = new Date(Date.now() + 9 * 3600 * 1000);
    const h = now.getUTCHours();
    const from = Number(st.autoApplyFrom ?? 0);
    const to = Number(st.autoApplyTo ?? 24);
    const inHours = from <= to ? (h >= from && h < to) : (h >= from || h < to);
    res.json({
      // 直す作業そのものを動かすか
      enabled: st.autoImprove === true,
      // 直したものを本番へ入れてよいか（時間帯の外ならPRにする）
      autoApply: st.autoApply === true && inHours,
      hours: { from, to, now: h, inHours },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/auto-apply", async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    if (b.enabled !== undefined) patch.autoImprove = b.enabled === true;
    if (b.autoApply !== undefined) patch.autoApply = b.autoApply === true;
    if (b.from !== undefined) patch.autoApplyFrom = Math.max(0, Math.min(24, parseInt(b.from, 10) || 0));
    if (b.to !== undefined) patch.autoApplyTo = Math.max(0, Math.min(24, parseInt(b.to, 10) || 24));
    await saveSettings(patch);
    console.log(`[自動改善] 設定を更新 by ${req.user}: ${JSON.stringify(patch)}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 自動改善の結果を受け取る（入れたか／PRにしたか）
app.post("/api/dev-notes/applied", async (req, res) => {
  try {
    const b = req.body || {};
    const g = b.guard || {};
    const head = b.applied
      ? "🤖 *自動で直して、本番に入れました*"
      : (g.changed ? "🤖 *直しましたが、本番には入れていません*" : "🤖 *今回は変更なし*");
    const why = !b.applied && g.changed && Array.isArray(g.reasons) ? `理由：${g.reasons.join(" / ")}` : "";
    const text = [
      head,
      b.applied && b.sha ? `🔖 ${String(b.sha).slice(0, 7)}` : "",
      why,
      g.files && g.files.length ? `📄 ${g.files.join("、")}（${g.lines || 0}行）` : "",
      "",
      String(b.result || "").slice(0, 1200),
      "",
      b.runUrl ? `🔗 ${b.runUrl}` : "",
      b.applied ? "戻すときは、Actionsの「巻き戻し」を実行してください。" : "",
    ].filter(Boolean).join("\n");

    const st = await getSettings().catch(() => ({}));
    const to = { url: String(st.selfCheckWebhook || "").trim(), space: String(st.selfCheckSpace || "").trim() };
    if (to.url || to.space) await notifyCheck(text, to).catch(() => {});
    console.log(`[自動改善] ${b.applied ? "本番に入れました" : "PRにしました"}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Claude（GitHub Actions）から、定期的な提案を受け取る。
// 受け取った案は開発メモに残し、点検と同じ1か所にだけ知らせる。
// ★ チームのスペースには送らない。
app.post("/api/dev-notes/advice", async (req, res) => {
  try {
    const b = req.body || {};
    const text = String(b.text || "").trim();
    if (!text) return res.status(400).json({ error: "中身がありません" });

    // 「1. 見出し」の形で区切って、1件ずつ開発メモに残す
    const blocks = text.split(/\n(?=\d+\.\s)/).map((x) => x.trim()).filter(Boolean);
    // すでにある案（見送ったものも含む）と似ていたら残さない
    let seen = [];
    try {
      const notes = await listDevNotes({ limit: 500 });
      const gone = await listDismissed(500).catch(() => []);
      seen = notes.concat(gone).map((n) => ({ title: n.title, detail: String(n.detail || "").slice(0, 120) }));
    } catch {}
    const cand = blocks.map((blk) => ({
      title: (blk.split("\n")[0] || "").replace(/^\d+\.\s*/, "").trim(),
      detail: blk.slice(0, 2000),
    })).filter((x) => x.title);
    const fresh = dropSimilar(cand, seen);

    let saved = 0;
    for (const it of fresh) {
      await addDevNote({
        key: `advice:${it.title}`.slice(0, 200), kind: "idea",
        title: `提案：${it.title.slice(0, 120)}`, detail: it.detail,
        source: "Claudeの提案", createdBy: "advisor",
      }).catch(() => {});
      saved++;
    }
    if (cand.length - fresh.length) {
      console.log(`[提案] 前と同じ内容 ${cand.length - fresh.length}件は残しませんでした`);
    }

    const st = await getSettings().catch(() => ({}));
    const to = { url: String(st.selfCheckWebhook || "").trim(), space: String(st.selfCheckSpace || "").trim() };
    if (to.url || to.space) {
      await notifyCheck([
        "💡 *Claudeからの提案*",
        "",
        text.slice(0, 3000),
        "",
        b.runUrl ? `🔗 ${b.runUrl}` : "",
        "（開発メモにも残しました。よければ「やる」に印を付けてください）",
      ].filter(Boolean).join("\n"), to).catch(() => {});
    }
    console.log(`[提案] Claudeの提案を ${saved}件 受け取りました`);
    res.json({ ok: true, saved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 夜間開発（GitHub ActionsのClaude Code）から、結果を受け取る
app.post("/api/dev-notes/night-report", async (req, res) => {
  try {
    const b = req.body || {};
    const changed = b.changed === true;
    const text = [
      changed ? "🌙 *夜のうちに直してみました*" : "🌙 *夜間開発：今夜は変更なし*",
      changed ? "内容を見て、よければPRをマージしてください。" : "",
      b.runUrl ? `🔗 ${b.runUrl}` : "",
      "",
      String(b.result || "").slice(0, 1500),
    ].filter(Boolean).join("\n");
    await notifyAll(text, "assign").catch(() => {});
    console.log(`[night] 夜間開発の結果を受け取りました（変更${changed ? "あり" : "なし"}）`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 開発メモのChat通知（朝のまとめ・点検・画面の見直し）を、まとめて入り切りする
app.get("/api/dev-notes/chat", async (req, res) => {
  try {
    const st = await getSettings();
    // 既定はOFF（毎朝の「kinbotが新しくなりました」に置き換えたため）
    res.json({ enabled: st.devSummary === true, hour: Number(st.devSummaryHour ?? 6) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/dev-notes/chat", async (req, res) => {
  try {
    const on = req.body?.enabled !== false;
    await saveSettings({ devSummary: on });
    console.log(`[dev-note] Chatへの通知を${on ? "ON" : "OFF"}にしました by ${req.user}`);
    res.json({ ok: true, enabled: on });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 朝の開発メモのまとめ。
// いまは既定でOFF（更新のお知らせに置き換えたため）。
// 見たい人だけ、開発メモの画面でONにできる。
let lastDevSummaryDay = "";
async function maybeSendDevSummary() {
  try {
    const st = await getSettings().catch(() => ({}));
    if (st.devSummary !== true) return;   // 明示的にONにした人だけ
    const now = new Date(Date.now() + 9 * 3600 * 1000);
    const h = now.getUTCHours(), m = now.getUTCMinutes();
    const hour = Number(st.devSummaryHour ?? 6);
    if (h !== hour || m > 4) return;
    const day = now.toISOString().slice(0, 10);
    if (lastDevSummaryDay === day) return;
    lastDevSummaryDay = day;
    const r = await buildMorningSummary(callLLMPublic);
    if (r.empty) return;
    await notifyAll(r.text, "assign");
    console.log(`[dev-note] 朝のまとめを送りました（${r.count}件）`);
  } catch (e) { console.warn("[dev-note]", e.message); }
}

// ───────────────────────────────────────────────────────────
// 朝の「kinbotが新しくなりました」のお知らせ（既定 8:30）
//
// 前の営業日からの更新をまとめて出す。
// 月曜は、金曜の朝からの3日ぶんをまとめる。
// ───────────────────────────────────────────────────────────
let lastDeployNewsDay = "";
async function maybeSendDeployNews() {
  try {
    const st = await getSettings().catch(() => ({}));
    if (st.deployNews === false) return;

    const now = new Date(Date.now() + 9 * 3600 * 1000);
    const h = now.getUTCHours(), m = now.getUTCMinutes();
    const hour = Number(st.deployNewsHour ?? 8);
    const min = Number(st.deployNewsMinute ?? 30);
    // 指定の時刻から10分のあいだに1回だけ
    // （サーバーが再起動していても、取りこぼしにくいように少し広く取る）
    if (h !== hour || m < min || m > min + 9) return;
    const w = now.getUTCDay();
    if (w === 0 || w === 6) return;   // 土日は出さない

    const day = now.toISOString().slice(0, 10);
    if (lastDeployNewsDay === day) return;
    lastDeployNewsDay = day;

    // 月曜は金曜の朝から（3日ぶん）、それ以外は前日の朝から
    const hours = w === 1 ? 72 : 24;
    const rows = await deploysSince(hours);
    if (!rows.length) {
      console.log("[更新のお知らせ] 前の営業日から変わったところはありません");
      return;
    }

    // 開発の言葉のままだと読みにくいので、AIに整えてもらう
    let body = "";
    try {
      const list = rows.map((r) => `・${r.message}`).join("\n");
      body = await callLLMPublic(
        "あなたは、営業チームに『使い方が変わったところ』を伝える係です。",
        `次はkinbotの更新の記録です。営業メンバー（開発者ではありません）に向けて、\n` +
        `「何ができるようになったか」「どこが変わったか」を、やさしい日本語でまとめてください。\n\n` +
        `決まり:\n` +
        `- 使う人に関係することだけ。中の作りの話（DB・API・関数名など）は書かない\n` +
        `- 1行につき1つ。「・」で始める。多くても6行\n` +
        `- どこを開けば使えるかを、できるだけ書く（例：ホーム、ツール→天気予報）\n` +
        `- 直しただけのものは「〜が直りました」と書く\n` +
        `- 絵文字は使わない。見出しも要らない。箇条書きだけを返す\n\n` +
        `【更新の記録】\n${list}`,
        700
      );
    } catch {}
    if (!body) body = rows.slice(0, 6).map((r) => `・${r.message}`).join("\n");

    const 期間 = w === 1 ? "金曜から今朝まで" : "昨日から今朝まで";
    await notifyAll([
      "✨ *kinbotが新しくなりました*",
      `（${期間}の変更 ${rows.length}件）`,
      "",
      String(body).trim(),
      "",
      "うまく動かないときは、画面のロボを押して教えてください。",
    ].join("\n"), "news");
    console.log(`[更新のお知らせ] ${rows.length}件をまとめて送りました`);
  } catch (e) { console.warn("[更新のお知らせ]", e.message); }
}

// 設定（時刻・ON/OFF）
app.get("/api/deploy/news", async (req, res) => {
  try {
    const st = await getSettings();
    res.json({
      enabled: st.deployNews !== false,
      hour: Number(st.deployNewsHour ?? 8),
      minute: Number(st.deployNewsMinute ?? 30),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/deploy/news", async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    if (b.enabled !== undefined) patch.deployNews = b.enabled !== false;
    if (b.hour !== undefined) patch.deployNewsHour = Math.min(23, Math.max(0, parseInt(b.hour, 10) || 0));
    if (b.minute !== undefined) patch.deployNewsMinute = Math.min(59, Math.max(0, parseInt(b.minute, 10) || 0));
    await saveSettings(patch);
    console.log(`[更新のお知らせ] 設定を変えました by ${req.user}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// いま試しに送る
app.post("/api/deploy/news/test", async (req, res) => {
  try {
    lastDeployNewsDay = "";
    const st = await getSettings().catch(() => ({}));
    const now = new Date(Date.now() + 9 * 3600 * 1000);
    // 時刻の縛りを外して、その場で作って送る
    const rows = await deploysSince(now.getUTCDay() === 1 ? 72 : 24);
    if (!rows.length) return res.json({ ok: true, 件数: 0, note: "前の営業日から変わったところはありません" });
    await maybeSendDeployNewsNow(rows);
    res.json({ ok: true, 件数: rows.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 試し送り用（時刻を見ずに送る）
async function maybeSendDeployNewsNow(rows) {
  const list = rows.map((r) => `・${r.message}`).join("\n");
  let body = "";
  try {
    body = await callLLMPublic(
      "あなたは、営業チームに『使い方が変わったところ』を伝える係です。",
      `次はkinbotの更新の記録です。営業メンバーに向けて、やさしい日本語で6行までにまとめてください。\n` +
      `中の作りの話は書かない。絵文字は使わない。箇条書きだけ返す。\n\n${list}`, 700);
  } catch {}
  if (!body) body = rows.slice(0, 6).map((r) => `・${r.message}`).join("\n");
  await notifyAll([
    "✨ *kinbotが新しくなりました*（お試し）",
    "",
    String(body).trim(),
  ].join("\n"), "news");
}

// 数えない招待者の設定
app.get("/api/skip-inviters", async (req, res) => {
  try {
    const st = await getSettings();
    res.json({
      inviters: st.skipInviters === undefined ? SKIP_INVITERS_DEFAULT : String(st.skipInviters),
      note: "ここに書いた人が招いた予定は、アポとして数えません。名前でもメールでも書けます。",
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/skip-inviters", async (req, res) => {
  try {
    await saveSettings({ skipInviters: String(req.body?.inviters ?? "").slice(0, 300) });
    await loadSkipInviters().catch(() => {});
    console.log(`[apo] 数えない招待者を更新 by ${req.user}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// テスト用アポの見分け方（設定）
app.get("/api/test-apo-words", async (req, res) => {
  try {
    const st = await getSettings();
    res.json({
      words: String(st.testApoWords ?? "テスト株式会社,テスト様,テスト会社,test株式会社"),
      note: "この言葉が予定名に入っていたら、通知までは普通どおり行い、そのあと実績の数から外します。",
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/test-apo-words", async (req, res) => {
  try {
    await saveSettings({ testApoWords: String(req.body?.words || "").slice(0, 300) });
    await loadTestWords().catch(() => {});
    console.log(`[apo] テスト用アポの言葉を更新 by ${req.user}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 設定の読み書きと、その場で試す
app.get("/api/call-report", async (req, res) => {
  try {
    const st = await getSettings();
    let goals = {};
    try { goals = JSON.parse(st.callGoals || "{}") || {}; } catch {}
    res.json({
      enabled: st.callReport === true,
      from: Number(st.callReportFrom ?? 11),
      to: Number(st.callReportTo ?? 18),
      goals,
      goalMode: String(st.callGoalMode || "sheet") === "zero" ? "zero" : "sheet",
      reportReady: !!st.psReportId,
      owner: st.psOwner || "",
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/call-report", async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    if (b.enabled !== undefined) patch.callReport = b.enabled === true;
    if (b.from !== undefined) patch.callReportFrom = Math.min(23, Math.max(0, parseInt(b.from, 10) || 11));
    if (b.to !== undefined) patch.callReportTo = Math.min(23, Math.max(0, parseInt(b.to, 10) || 18));
    if (b.goals !== undefined) patch.callGoals = JSON.stringify(b.goals || {});
    if (b.goalMode !== undefined) patch.callGoalMode = b.goalMode === "zero" ? "zero" : "sheet";
    await saveSettings(patch);
    console.log(`[call-report] 設定を更新 by ${req.user}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/call-report/test", async (req, res) => {
  try {
    const st = await getSettings();
    const sfUser = String(st.psOwner || req.user || "").trim();
    const r = await buildCallReport(sfUser);
    if (r.skipped) return res.json({ ok: false, reason: r.reason });
    if (req.body?.send === true) await notifyAll(r.text, "assign");
    res.json({ ok: true, text: r.text, sent: req.body?.send === true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 設定の読み書き
app.get("/api/process-sheet", async (req, res) => {
  try {
    const st = await getSettings();
    res.json({
      sheetId: st.psSheetId || "", sheetName: st.psSheetName || "",
      reportId: st.psReportId || "", owner: st.psOwner || "",
      termFrom: st.psTermFrom || "", termTo: st.psTermTo || "",
      termMode: st.psTermMode === "fixed" ? "fixed" : "auto",
      writeFrom: st.psWriteFrom || "",
      zeroDates: (String(st.psZeroDates ?? "").trim() || "8/21"),
      withHours: st.psHours === true,
      interns: st.psInterns === true,
      autoRun: st.psAutoRun === true,
      filters: (() => { try { return JSON.parse(st.psFilters || "null"); } catch { return null; } })(),
      gasUrl: st.psGasUrl || "", gasSecretSet: !!st.psGasSecret,
      intervalMin: Number(process.env.PS_INTERVAL_MIN || 30),
      hours: String(process.env.PS_HOURS || "7-22"),
      last: processSheetStatus(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/process-sheet", async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    if (b.sheetId !== undefined) {
      const raw = String(b.sheetId || "").trim();
      const m = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      patch.psSheetId = (m ? m[1] : raw).slice(0, 120);
    }
    if (b.sheetName !== undefined) patch.psSheetName = String(b.sheetName || "").trim().slice(0, 80);
    if (b.reportId !== undefined) patch.psReportId = String(b.reportId || "").trim().replace(/[^a-zA-Z0-9]/g, "").slice(0, 30);
    if (b.owner !== undefined) patch.psOwner = String(b.owner || "").trim().toLowerCase().slice(0, 120);
    if (b.termFrom !== undefined) patch.psTermFrom = String(b.termFrom || "").slice(0, 10);
    if (b.termTo !== undefined) patch.psTermTo = String(b.termTo || "").slice(0, 10);
    // 期内・期外の分け方（auto＝アポ取得月と商談月が同じなら期内／fixed＝決めた期間）
    if (b.termMode !== undefined) patch.psTermMode = b.termMode === "auto" ? "auto" : "fixed";
    // 「この日から書き込む」「0にする日（休みなど）」
    if (b.writeFrom !== undefined) patch.psWriteFrom = String(b.writeFrom || "").slice(0, 10);
    if (b.zeroDates !== undefined) patch.psZeroDates = String(b.zeroDates || "").slice(0, 200);
    if (b.withHours !== undefined) patch.psHours = b.withHours === true;
    if (b.interns !== undefined) patch.psInterns = b.interns === true;
    if (b.autoRun !== undefined) patch.psAutoRun = b.autoRun === true;
    // Apps Script経由の書き込み（保護されたシート向け）
    if (b.gasUrl !== undefined) patch.psGasUrl = String(b.gasUrl || "").trim().slice(0, 300);
    if (b.gasSecret !== undefined && String(b.gasSecret).trim()) {
      patch.psGasSecret = String(b.gasSecret).trim().slice(0, 100);
    }
    // レポートの絞り込み条件（「今月」など）を覚えておく。
    // これが無いと、実行のたびに条件なしで走って中身が出てこない。
    if (b.filters !== undefined) {
      patch.psFilters = b.filters ? JSON.stringify(b.filters).slice(0, 4000) : "";
    }
    await saveSettings(patch);
    res.json({ ok: true, ...patch });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 商談日が入っていないアポを、カレンダーから拾って補う。
// アポの記録には予定のIDが入っているので、それでカレンダーを引く。
// 期内・期外の判定は商談日で決まるので、ここが空だと正しく数えられない。
async function fillMissingMeetingDates() {
  // 商談日が空のものと、アポを取った日時が空のものをまとめて調べる。
  // どちらも同じカレンダー予定から分かるので、1回の照会で両方を埋める。
  const needStart = await apoMissingStart(200).catch(() => []);
  const needApoAt = await apoMissingApoAt(300).catch(() => []);
  const bySlug = new Map();
  for (const r of [...needStart, ...needApoAt]) if (!bySlug.has(r.slug)) bySlug.set(r.slug, r);
  const rows = [...bySlug.values()];
  const wantStart = new Set(needStart.map((r) => r.slug));
  const wantApoAt = new Set(needApoAt.map((r) => r.slug));
  if (!rows.length) return { checked: 0, filled: 0, filledApoAt: 0, notes: [] };

  // 探しに行くカレンダーの持ち主。予定を作った人・担当者・運用者の順に試す。
  let owners = [];
  try {
    const st = await getSettings();
    const accounts = await listGoogleAccounts();
    owners = (accounts || []).map((a) => a.owner || a.google_email).filter(Boolean);
    if (st.apoScanOwner) owners.unshift(st.apoScanOwner);
  } catch {}

  let filled = 0, filledApoAt = 0;
  const notes = [];
  for (const r of rows) {
    const ids = [r.event_id, r.invite_event_id].filter(Boolean);
    if (!ids.length) { notes.push(`${r.label || r.slug}：予定のIDがありません`); continue; }
    // 近い人から順に探す（同じ予定は誰のカレンダーでも同じIDになる）
    const cands = [r.created_by, r.current_owner, ...owners].filter(Boolean);
    let found = null;
    for (const own of [...new Set(cands)]) {
      for (const id of ids) {
        try {
          const ev = await getCalendarEvent(own, id);
          if (ev && ev.start) { found = ev; break; }
        } catch {}
      }
      if (found) break;
    }
    if (!found) { notes.push(`${r.label || r.slug}：カレンダーに予定が見つかりません`); continue; }
    if (wantStart.has(r.slug) && found.start) {
      const saved = await setApoStartTime(r.slug, found.start);
      if (saved) {
        filled++;
        console.log(`[プロセスシート] 商談日を補いました ${r.label || r.slug} → ${String(found.start).slice(0, 16)}`);
      }
    }
    // アポを取った日時＝予定を作った時刻
    if (wantApoAt.has(r.slug) && found.created) {
      const saved2 = await setApoAt(r.slug, found.created);
      if (saved2) {
        filledApoAt++;
        console.log(`[プロセスシート] アポ取得日を補いました ${r.label || r.slug} → ${String(found.created).slice(0, 16)}`);
      }
    }
  }
  return { checked: rows.length, filled, filledApoAt, notes: notes.slice(0, 20) };
}

// シートに載っている担当者ごとに、カレンダーから日ごとの架電時間（時間）を出す。
// 本人がGoogle連携していれば本人の権限で、無ければ書き込むアカウントの権限で（共有されていれば）読む。
// 予定が無い日は、10〜18時まるごと架電時間（8時間）になる。
async function computeCallHoursByName(owner, layout, fromISO, toISO) {
  const byName = {};
  const notes = [];
  if (!fromISO || !toISO) return { byName, notes };

  const members = await listMembers().catch(() => []);
  const skip = await loadSkipInviters().catch(() => []);

  const timeMin = new Date(`${fromISO}T00:00:00+09:00`).toISOString();
  const timeMax = new Date(`${toISO}T23:59:59+09:00`).toISOString();
  const jstDay = (iso) => {
    const t = Date.parse(iso);
    return Number.isFinite(t) ? new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10) : "";
  };

  // シートの担当者を、そのままメンバー（メール）に対応づける（役割では絞らない）
  for (const p of layout.people) {
    if (isSkippedPerson(p.name, skip)) continue;
    const mm = members.find((m) =>
      psSameName(p.name, m.name || "") || psSameName(p.name, m.email || ""));
    if (!mm || !String(mm.email || "").trim()) {
      notes.push(`シートの「${p.name}」に対応するメンバー（メールアドレス）が見つかりませんでした`);
      continue;
    }
    const email = String(mm.email).trim();

    let events = [];
    try {
      const r = await readPersonCalendar(owner, email, { timeMin, timeMax });
      events = r.evs || [];
    } catch (e) {
      notes.push(`${p.name}（${email}）のカレンダーを読めませんでした：${e.message}`);
      continue;
    }

    // 予定を日ごとにまとめる
    const byDay = {};
    for (const ev of events) {
      if (ev.allDay) continue;
      const dstr = jstDay(ev.start);
      if (!dstr) continue;
      (byDay[dstr] = byDay[dstr] || []).push(ev);
    }
    // シートに並んでいる各日について、範囲内なら架電時間を出す（予定が無い日は8時間）
    const md = {};
    for (const dd of layout.dates) {
      const iso = isoForMD(dd.m, dd.d, toISO);
      if (!iso || iso < fromISO || iso > toISO) continue;
      md[`${dd.m}/${dd.d}`] = callHours(byDay[iso] || [], iso);
    }
    byName[mm.name || email] = md;
  }
  return { byName, notes };
}


// 実行の本体。画面からも、30分ごとの自動実行からも、ここを使う。
async function runProcessSheet(sfUser, opts = {}) {
  const st = await getSettings();
  const sheetId = String(opts.sheetId || st.psSheetId || "").trim();
  const sheetName = String(opts.sheetName || st.psSheetName || "").trim();
  const reportId = String(opts.reportId || st.psReportId || "").trim();
  const owner = String(opts.owner || st.psOwner || sfUser || "").trim();
  const from = String(opts.termFrom || st.psTermFrom || "").trim();
  const to = String(opts.termTo || st.psTermTo || "").trim();
  // 期内・期外の分け方。
  //   auto  … アポを取った月と商談の月が同じなら期内（毎月の設定変更が要らない）
  //   fixed … 下で指定した期間に商談日が入っていれば期内
  const termMode = String(opts.termMode || st.psTermMode || "fixed") === "auto" ? "auto" : "fixed";
  const dryRun = opts.dryRun !== false;
  const onlyDates = Array.isArray(opts.dates) && opts.dates.length ? opts.dates : null;
  // 「この日から書き込む」（空なら期間の開始から）
  const writeFrom = String(opts.writeFrom ?? st.psWriteFrom ?? "").trim();
  // 「0にする日」（休みなど）。空・未設定のときは 8/21 を既定にする（画面で変えられる）。
  const zeroDatesRaw = (opts.zeroDates !== undefined && String(opts.zeroDates).trim() !== "")
    ? opts.zeroDates
    : (String(st.psZeroDates ?? "").trim() || "8/21");
  const zeroDates = parseZeroDates(zeroDatesRaw);

  if (!sheetId) throw new Error("スプレッドシートを指定してください");
  if (!sheetName) throw new Error("シート名を指定してください");
  if (!reportId) throw new Error("SFのレポートを指定してください");
  if (termMode === "fixed" && (!from || !to)) throw new Error("期内とみなす期間を指定してください");

  // 1. SFのレポートを実行（覚えている条件があれば、その条件で）
  let saved = null;
  try { saved = opts.filters !== undefined ? opts.filters : JSON.parse(st.psFilters || "null"); } catch {}
  const report = await runReport(sfUser, reportId, saved);
  const records = toRecords(report);

  // 2. 担当者ごと・日ごとに数える。
  //    コールと接触はSFのレポートから。
  //    アポはkinbotの記録から（商談日が分かるので、期内・期外を正しく分けられる）。
  let tallied = tally(records, { fromISO: from, toISO: to });
  // 数えない人は、コール・接触の行も作らない
  {
    const skip = await loadSkipInviters().catch(() => []);
    for (const who of Object.keys(tallied)) if (isSkippedPerson(who, skip)) delete tallied[who];
  }
  // 商談日が空のアポを、カレンダーから補ってから数える
  const fixed = await fillMissingMeetingDates().catch(() => ({ checked: 0, filled: 0, filledApoAt: 0, notes: [] }));
  let apoRows = await apoCountsBySetter({ termFrom: from, termTo: to, mode: termMode }).catch(() => []);
  // 数えない人（中澤・浦林など）は、プロセスシートにも書かない
  const skipPeople = await loadSkipInviters().catch(() => []);
  apoRows = apoRows.filter((r) => !isSkippedPerson(r.setter, skipPeople));
  tallied = applyApoCounts(tallied, apoRows);

  // 3. シートの構造を読んで、書き込む場所を決める
  const values = await readSheet(owner, sheetId, `${sheetName}!A1:DZ200`);
  const layout = readLayout(values);
  if (layout.error) throw new Error(layout.error);

  // インターン生は自動入力しない（設定で「含める」を選んだときだけ入れる）
  let internNote = "";
  const includeInterns = opts.interns !== undefined ? !!opts.interns : (st.psInterns === true);
  if (!includeInterns) {
    const interns = await listInterns().catch(() => []);
    const internEmails = new Set(interns.map((x) => String(x.email || "").toLowerCase()).filter(Boolean));
    if (interns.length) {
      const members = await listMembers().catch(() => []);
      const isIntern = (name) => {
        const mm = members.find((m) => psSameName(name, m.name || "") || psSameName(name, m.email || ""));
        const em = mm && String(mm.email || "").toLowerCase();
        if (em && internEmails.has(em)) return true;
        return interns.some((it) => psSameName(name, it.name || ""));
      };
      const removed = layout.people.filter((p) => isIntern(p.name)).map((p) => p.name);
      if (removed.length) {
        layout.people = layout.people.filter((p) => !isIntern(p.name));
        internNote = `インターン生は自動入力の対象外にしました：${removed.join("、")}`;
      }
    }
  }

  // 実績が0の日も0で上書きする。範囲は「期間の開始〜今日」まで。
  // 先の日付まで0で埋めると、手で入れた予定の数字を消してしまうため。
  const todayJst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const zeroTo = to < todayJst ? to : todayJst;
  const { updates, skipped } = buildUpdates(layout, tallied, {
    onlyDates, zeroFrom: from, zeroTo, writeFrom, zeroDates,
  });

  // 稼働時間目標（架電時間）を、カレンダーから計算して入れる（任意）。
  // 10〜18時のうち、【】・株式会社・〇〇様の予定を商談時間として引き、残り（空き＋リスケ）を架電時間とする。
  const withHours = opts.withHours !== undefined ? !!opts.withHours : (st.psHours === true);
  let hoursNotes = [];
  if (withHours) {
    try {
      const base = from || zeroTo;                 // 年の推測に使う
      // シートに並んでいる日付の最初から今日まで、カレンダーを読む
      const isos = layout.dates.map((d) => isoForMD(d.m, d.d, base)).filter(Boolean).sort();
      let readFrom = isos[0] || base;
      if (writeFrom && writeFrom > readFrom) readFrom = writeFrom;
      if (readFrom > zeroTo) readFrom = zeroTo;
      const r = await computeCallHoursByName(owner, layout, readFrom, zeroTo);
      hoursNotes = r.notes;
      const hUps = buildHoursUpdates(layout, r.byName, { base, writeFrom, toISO: zeroTo, onlyDates });
      for (const u of hUps) updates.push(u);
      if (!hUps.length) {
        hoursNotes = hoursNotes.concat(
          "架電時間を書き込める対象がありませんでした（カレンダーの共有、シート上の名前とメンバー名の一致、対象日の範囲を確認してください）");
      }
    } catch (e) { hoursNotes = ["架電時間の計算に失敗しました：" + e.message]; }
  }

  if (dryRun) {
    return {
      ok: true, dryRun: true, rows: records.length,
      people: layout.people.map((p) => p.name),
      matched: Object.keys(tallied),
      updates: updates.slice(0, 400), count: updates.length, skipped,
      withHours, hoursNotes, internNote,
      apoSource: apoRows.length
        ? `kinbotのアポ記録（Chatに流れたアポ）から ${apoRows.reduce((n, r) => n + (Number(r.in_term) || 0) + (Number(r.out_term) || 0), 0)}件`
        : "kinbotにアポの記録がありません",
      // SFのレポート側にもアポの印は付いているが、商談日が無いので使っていない
      apoInSf: records.filter((r) => r.appointed === true || r.appointed === "true" || r.appointed === 1 || r.appointed === "1").length,
      apoFixed: fixed,
      // 期外になった理由を確かめられるように、1件ずつの内訳も返す
      apoDetail: (await apoDetailBySetter({ termFrom: from, termTo: to, limit: 100, mode: termMode }).catch(() => []))
        .map((r) => ({ slug: r.slug, setter: r.setter, day: r.day, createdJst: r.created_jst,
                       apoAtMissing: r.apo_at_missing === true,
                       meetingDate: r.meeting_date, term: r.term, label: r.label })),
      // 商談日が未定のもの（未定は期内に数えない）。全部期外になる原因の多くはこれ。
      undecided: apoRows.reduce((n, r) => n + (Number(r.undecided) || 0), 0),
      // 獲得者ごとの内訳（Chatに流れたアポと突き合わせて確かめられるように）
      apoByPerson: (() => {
        const by = new Map();
        for (const r of apoRows) {
          const who = String(r.setter || "").trim();
          if (!who) continue;
          if (!by.has(who)) by.set(who, { setter: who, inTerm: 0, outTerm: 0, undecided: 0, days: [] });
          const t = by.get(who);
          const i = Number(r.in_term) || 0, o = Number(r.out_term) || 0, u = Number(r.undecided) || 0;
          t.inTerm += i; t.outTerm += o; t.undecided += u;
          if (i || o || u) t.days.push({ day: r.day, inTerm: i, outTerm: o, undecided: u });
        }
        const dayNum = (d) => {
          const m = String(d || "").match(/(\d+)\/(\d+)/);
          return m ? Number(m[1]) * 100 + Number(m[2]) : 0;
        };
        return [...by.values()]
          .map((x) => ({ ...x, days: x.days.sort((a, b) => dayNum(a.day) - dayNum(b.day)) }))
          .sort((a, b) => (b.inTerm + b.outTerm) - (a.inTerm + a.outTerm));
      })(),
      // 判定に使った期間・分け方も返す（ずれていないか確かめられるように）
      termUsed: { from, to, mode: termMode },
    };
  }

  // 4. 「実績」のセルだけを書き換える。
  // シートが保護されている場合は、Apps Script経由で書く（設定されていれば）。
  const gasUrl = String(opts.gasUrl || st.psGasUrl || "").trim();
  const gasSecret = String(opts.gasSecret || st.psGasSecret || "");
  try {
    if (gasUrl) {
      const r = await writeViaAppsScript(gasUrl, gasSecret, { sheetName, cells: updates });
      return { ok: true, updated: r.updated, count: updates.length, skipped, via: "gas" };
    }
    const r = await updateSheetCells(owner, sheetId, sheetName, updates);
    return { ok: true, updated: r.updated, count: updates.length, skipped, via: "google" };
  } catch (e) {
    // どのセルに書こうとしたかを添える（原因を調べるときに使う）
    e.firstRange = updates[0] ? updates[0].range : "";
    throw e;
  }
}

app.post("/api/process-sheet/run", async (req, res) => {
  try {
    const r = await runProcessSheet(req.user, req.body || {});
    if (!r.dryRun) console.log(`[プロセスシート] ${r.count}箇所を更新しました by ${req.user}`);
    res.json(r);
  } catch (e) {
    console.error("[プロセスシート]", e.message);
    let hint = "";
    if (e.needScope) {
      hint = "Google連携にスプレッドシートの権限がありません。設定 → 連携 → Google連携 で「連携解除」→「再連携」を行ってください。";
    } else if (/403|PERMISSION_DENIED/.test(e.message)) {
      // 読めているのに書けない場合は、共有の権限かシートの保護が原因のことが多い
      try {
        const st = await getSettings();
        const d = await diagnoseSheet(
          String(req.body?.owner || st.psOwner || req.user),
          String(req.body?.sheetId || st.psSheetId || ""),
          String(req.body?.sheetName || st.psSheetName || ""),
          String(e.firstRange || "")
        );
        hint = d.note;
        if (!String(st.psGasUrl || "").trim()) {
          hint += "　保護を変えられない場合は、下の「シートが保護されていて書き込めないとき」から" +
            "Apps Script経由の設定をすると、保護をそのままにして書き込めます。";
        }
      } catch {}
    }
    res.status(400).json({ error: e.message, hint });
  }
});

// 書き込めるかどうかを、事前に調べる
app.post("/api/process-sheet/permission", async (req, res) => {
  try {
    const st = await getSettings();
    const owner = String(req.body?.owner || st.psOwner || req.user || "").trim();
    const sheetId = String(req.body?.sheetId || st.psSheetId || "").trim();
    const sheetName = String(req.body?.sheetName || st.psSheetName || "").trim();
    if (!sheetId) return res.status(400).json({ error: "スプレッドシートを指定してください" });
    // どこに書く予定かを調べて、そのセルで試す
    let probe = "";
    try {
      const r = await runProcessSheet(req.user, { ...req.body, dryRun: true });
      probe = (r.updates && r.updates[0] && r.updates[0].range) || "";
    } catch {}

    // Apps Scriptを設定しているなら、そちらの経路で試す。
    // 直接の権限が無くても、Apps Script経由なら書けるため。
    const gasUrl = String(req.body?.gasUrl || st.psGasUrl || "").trim();
    if (gasUrl) {
      try {
        // いまの値を読んで、同じ値を書き戻す（中身は変わらない）
        let cur = "";
        try {
          const v = await readSheet(owner, sheetId, `${sheetName}!${probe || "A1"}`);
          cur = (v[0] || [])[0] ?? "";
        } catch {}
        await writeViaAppsScript(gasUrl, String(st.psGasSecret || ""), {
          sheetName, cells: [{ range: probe || "A1", value: cur }],
        });
        return res.json({
          ok: true, owner, probe, via: "gas", canWrite: true,
          name: "", protected: [],
          note: "Apps Script経由で書き込めます。このまま実行して問題ありません。",
        });
      } catch (e) {
        return res.json({
          ok: true, owner, probe, via: "gas", canWrite: false,
          name: "", protected: [],
          note: `Apps Scriptで書き込めませんでした：${e.message}`,
        });
      }
    }

    // トークンにスプレッドシートの権限があるか（無いと読めるのに書けない）
    const sc = await tokenScopes(owner).catch(() => null);
    const d = await diagnoseSheet(owner, sheetId, sheetName, probe);
    // 権限が足りないなら、そちらを先に伝える
    if (sc && sc.ok && sc.canSheets === false) {
      return res.json({ ok: true, owner, probe, ...d, canWrite: false, scopes: sc.scopes, note: sc.note });
    }
    res.json({ ok: true, owner, probe, ...d, scopes: sc ? sc.scopes : [] });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ───────────────────────────────────────────────────────────
// 30分ごとの自動更新
// 一日中動かす必要はないので、平日の決まった時間帯だけにする。
// ───────────────────────────────────────────────────────────
let psLast = { at: null, ok: false, count: 0, error: "" };
function processSheetStatus() { return psLast; }

function inWorkingHours() {
  const now = new Date(Date.now() + 9 * 3600 * 1000);   // JST
  const day = now.getUTCDay();                          // 0=日
  const hour = now.getUTCHours();
  const [h1, h2] = String(process.env.PS_HOURS || "7-22").split("-").map((x) => parseInt(x, 10));
  if (process.env.PS_WEEKEND !== "1" && (day === 0 || day === 6)) return false;
  return hour >= (h1 || 7) && hour < (h2 || 22);
}

async function processSheetTick() {
  try {
    const st = await getSettings();
    if (st.psAutoRun !== true) return;
    if (!inWorkingHours()) return;
    const user = String(st.psOwner || "").trim();
    if (!user) return;

    const r = await runProcessSheet(user, { dryRun: false });
    psLast = { at: new Date().toISOString(), ok: true, count: r.count, error: "" };
    console.log(`[プロセスシート] 自動更新：${r.count}箇所`);
  } catch (e) {
    psLast = { at: new Date().toISOString(), ok: false, count: 0, error: e.message };
    console.warn("[プロセスシート] 自動更新に失敗", e.message);
  }
}

const PS_INTERVAL_MIN = Number(process.env.PS_INTERVAL_MIN || 30);
setInterval(() => { processSheetTick().catch(() => {}); }, PS_INTERVAL_MIN * 60 * 1000);
// 起動直後に走らせると、まだ設定が読めていないことがあるので少し待つ
setTimeout(() => { processSheetTick().catch(() => {}); }, 3 * 60 * 1000);

// ===== 資料の閲覧をスプレッドシートに記録する設定 =====
// Salesforceの自動立ち上げを実際に行うかどうか
// コンバートで必須になっている「主キャンペーンソース」の既定値。
// 設定で変えられる。空にすると入れない。
const DEFAULT_CAMPAIGN_SOURCE = "3Dメタバース";
// 「FSへの案件パス情報」の既定値。中身は商談後に書くので、立ち上げ時は「-」で通す。
const DEFAULT_FS_NOTE = "-";

app.get("/api/sf-autolaunch/config", async (req, res) => {
  try {
    const st = await getSettings();
    res.json({
      enabled: st.sfAutoLaunch === true,
      campaignSource: st.sfCampaignSource === undefined ? DEFAULT_CAMPAIGN_SOURCE : st.sfCampaignSource,
      campaignSourceDefault: DEFAULT_CAMPAIGN_SOURCE,
      fsNote: st.sfFsNote === undefined ? DEFAULT_FS_NOTE : st.sfFsNote,
      fsNoteDefault: DEFAULT_FS_NOTE,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/sf-autolaunch/config", async (req, res) => {
  try {
    const patch = {};
    if (req.body?.enabled !== undefined) patch.sfAutoLaunch = req.body.enabled === true;
    if (req.body?.campaignSource !== undefined) {
      patch.sfCampaignSource = String(req.body.campaignSource || "").trim().slice(0, 80);
    }
    if (req.body?.fsNote !== undefined) {
      patch.sfFsNote = String(req.body.fsNote || "").trim().slice(0, 200);
    }
    await saveSettings(patch);
    console.log(`[SF自動] 設定を更新 by ${req.user}:`, JSON.stringify(patch));
    const st = await getSettings();
    res.json({
      ok: true,
      enabled: st.sfAutoLaunch === true,
      campaignSource: st.sfCampaignSource === undefined ? DEFAULT_CAMPAIGN_SOURCE : st.sfCampaignSource,
      fsNote: st.sfFsNote === undefined ? DEFAULT_FS_NOTE : st.sfFsNote,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/doc-sheet", async (req, res) => {
  try {
    const st = await getSettings();
    res.json({
      sheetId: st.docSheetId || "", sheetName: st.docSheetName || "資料閲覧",
      owner: st.docSheetOwner || "", monthlyGoal: st.apoMonthlyGoal || "",
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/doc-sheet", async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    if (b.sheetId !== undefined) {
      // URLを貼られても動くように、IDだけ取り出す
      const raw = String(b.sheetId || "").trim();
      const m = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
      patch.docSheetId = (m ? m[1] : raw).slice(0, 120);
    }
    if (b.sheetName !== undefined) patch.docSheetName = String(b.sheetName || "").trim().slice(0, 80);
    if (b.owner !== undefined) patch.docSheetOwner = String(b.owner || "").trim().toLowerCase().slice(0, 120);
    if (b.monthlyGoal !== undefined) patch.apoMonthlyGoal = String(parseInt(b.monthlyGoal, 10) || 0);
    await saveSettings(patch);
    res.json({ ok: true, ...patch });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 書き込めるか試す
app.post("/api/doc-sheet/test", async (req, res) => {
  try {
    const st = await getSettings();
    const id = String(req.body?.sheetId || st.docSheetId || "").trim();
    const owner = String(req.body?.owner || st.docSheetOwner || req.user || "").trim();
    if (!id) return res.status(400).json({ error: "スプレッドシートのIDまたはURLを入れてください" });
    const info = await checkSheet(owner, id);
    if (!info.ok) {
      const msg = info.reason === "no_scope"
        ? `${owner} のGoogle連携にスプレッドシートの権限がありません。本人が 設定 → 連携 → Google連携 で「連携解除」→「再連携」を行ってください。`
        : info.reason === "not_found"
          ? "そのスプレッドシートが見つかりません。IDが正しいか、そのアカウントに共有されているかご確認ください。"
          : "確認できませんでした：" + (info.detail || "");
      return res.status(400).json({ error: msg });
    }
    // 1行書いてみる
    const name = String(req.body?.sheetName || st.docSheetName || "").trim() || "資料閲覧";
    await appendSheetRow(owner, id, name, ["テスト", new Date().toISOString(), "kinbotからの書き込み確認"]);
    res.json({ ok: true, title: info.title, sheets: info.sheets });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ===== Google Chatの通知先（複数登録） =====
app.get("/api/chat-targets", async (req, res) => {
  try {
    const rows = await listChatTargets();
    res.json({
      targets: rows.map((r) => ({
        id: r.id, name: r.name,
        webhookUrl: r.webhook_url || "", spaceId: r.space_id || "",
        onAssign: r.on_assign, onMail: r.on_mail, onDoc: r.on_doc, onLaunch: r.on_launch,
        onDeploy: r.on_deploy, onNews: r.on_news,
        active: r.active, lastError: r.last_error || "", sentCount: r.sent_count,
        via: r.space_id ? "kinbot名義" : "Webhook",
      })),
      appReady: chatInfo().app.configured,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/chat-targets", async (req, res) => {
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    if (!name) return res.status(400).json({ error: "名前を入れてください（例：DOC Team）" });
    const url = String(b.webhookUrl || "").trim();
    const space = normalizeSpace(String(b.spaceId || ""));
    if (!url && !space) return res.status(400).json({ error: "WebhookのURLか、スペースのどちらかを入れてください" });
    if (url && !/^https:\/\/chat\.googleapis\.com\/v1\/spaces\//.test(url)) {
      return res.status(400).json({ error: "Google ChatのWebhook URLを貼ってください" });
    }
    const row = await addChatTarget({ name, webhookUrl: url || null, spaceId: space || null });
    console.log(`[chat] 通知先を追加「${name}」by ${req.user}`);
    res.json({ ok: true, id: row && row.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/chat-targets/:id", async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    for (const k of ["onAssign", "onMail", "onDoc", "onLaunch", "onDeploy", "onNews", "active"]) {
      if (b[k] !== undefined) patch[k] = b[k] !== false;
    }
    if (b.name !== undefined) patch.name = String(b.name).trim().slice(0, 80);
    if (b.webhookUrl !== undefined) patch.webhookUrl = String(b.webhookUrl).trim() || null;
    if (b.spaceId !== undefined) patch.spaceId = normalizeSpace(String(b.spaceId)) || null;
    const row = await updateChatTarget(parseInt(req.params.id, 10), patch);
    if (!row) return res.status(404).json({ error: "見つかりませんでした" });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/chat-targets/:id", async (req, res) => {
  try {
    await deleteChatTarget(parseInt(req.params.id, 10));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 1つの通知先にテスト送信する
app.post("/api/chat-targets/:id/test", async (req, res) => {
  try {
    const rows = await listChatTargets();
    const t = rows.find((x) => x.id === parseInt(req.params.id, 10));
    if (!t) return res.status(404).json({ error: "見つかりませんでした" });
    const r = await notifyChat(
      "🤖 *kinbotからのテスト通知です*\nこのメッセージが見えていれば、この通知先の設定は完了しています。",
      t.space_id ? { space: t.space_id } : { url: t.webhook_url });
    if (!r.ok) return res.status(400).json({ error: r.reason || "送信できませんでした" });
    res.json({ ok: true, via: r.via });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ===== Google Chat 通知 =====
app.get("/api/chat-config", async (req, res) => {
  try {
    const st = await getSettings();
    const envUrl = String(process.env.GOOGLE_CHAT_WEBHOOK_URL || "").trim();
    const envSpace = String(process.env.GOOGLE_CHAT_SPACE || "").trim();
    res.json({
      url: envUrl || String(st.chatWebhookUrl || ""),
      fromEnv: !!envUrl,
      spaceId: envSpace || String(st.chatSpaceId || ""),
      spaceFromEnv: !!envSpace,
      notifyAssign: st.chatNotifyAssign !== false,
      notifyMail: st.chatNotifyMail !== false,
      ...chatInfo(),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/chat-config", async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    if (b.url !== undefined) {
      const u = String(b.url || "").trim();
      if (u && !/^https:\/\/chat\.googleapis\.com\/v1\/spaces\//.test(u)) {
        return res.status(400).json({ error: "Google ChatのWebhook URLを貼ってください（https://chat.googleapis.com/v1/spaces/... で始まります）" });
      }
      patch.chatWebhookUrl = u.slice(0, 600);
    }
    if (b.spaceId !== undefined) {
      const sp = normalizeSpace(String(b.spaceId || ""));
      if (String(b.spaceId || "").trim() && !sp) {
        return res.status(400).json({ error: "スペースIDは spaces/AAAA… の形で入れてください（スペースのURLを貼っても構いません）" });
      }
      patch.chatSpaceId = sp;
    }
    if (b.notifyAssign !== undefined) patch.chatNotifyAssign = b.notifyAssign !== false;
    if (b.notifyMail !== undefined) patch.chatNotifyMail = b.notifyMail !== false;
    await saveSettings(patch);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/chat-config/test", async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim() || (await chatWebhookUrl());
    const space = String(req.body?.spaceId || "").trim();
    const r = await notifyChat(
      "🤖 *kinbotからのテスト通知です*\nこのメッセージが見えていれば、通知の設定は完了しています。",
      // スペースが指定されていればアプリで、なければWebhookで送る
      space ? { space } : { url });
    if (!r.ok) return res.status(400).json({ error: r.reason || "送信できませんでした" });
    res.json({ ok: true, via: r.via });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 自動割り振りが動かない理由を切り分ける。設定と、実際のアポ1件ずつを調べる。
app.get("/api/apo/why", async (req, res) => {
  const steps = [];
  const push = (name, ok, detail, hint) => steps.push({ name, ok, detail: String(detail || ""), hint: hint || "" });
  try {
    const biz = ["DOC", "MOCHICA"].includes(String(req.query.product || "")) ? String(req.query.product) : "";
    const cfg = await getRotationConfig();
    const st = await getSettings().catch(() => ({}));

    // 1. スイッチ
    push("15分おきの自動スキャン", !!cfg.autoScan, cfg.autoScan ? `${cfg.scanIntervalSec}秒ごと` : "OFF",
      cfg.autoScan ? "" : "割り振り設定タブの「カレンダーを自動スキャンする」を入れてください。");
    push("スキャンしたアポを自動で割り振る", !!cfg.autoAssign, cfg.autoAssign ? "ON" : "OFF",
      cfg.autoAssign ? "" : "これがOFFだと、アポの記録だけして担当を決めません。");

    // 2. 走査するアカウント
    const scanOwner = String(st.apoScanOwner || st.apoInviteOwner || "").trim();
    const ownerOk = !!scanOwner && (await gcalConnected(scanOwner).catch(() => false));
    push("カレンダーを読むアカウント", ownerOk, scanOwner || "(未設定)",
      !scanOwner ? "設定→メンバー管理→「カレンダー照合の代表者」を指定してください。"
        : ownerOk ? "" : `${scanOwner} のGoogle連携が切れています。本人が 設定→連携→Google連携 を実行してください。`);

    // 3. クローザー
    const closers = await listClosers({ business: biz });
    const susp = await suspendedNow();
    const usable = closers.filter((c) => c.active && !susp[c.email]);
    const normals = usable.filter((c) => !c.fallback);
    push(`${biz || "全事業"}のクローザー`, normals.length > 0,
      `登録${closers.length}名 / 稼働${usable.length}名 / 通常${normals.length}名・予備${usable.length - normals.length}名`,
      normals.length ? "" :
      "設定→メンバー管理で「クローザー」の役割と、担当事業を設定してください。予備だけでは通常の割り振りが回りません。");

    // 4. 実際のアポを1件ずつ見る
    const { items, errors } = await collectApoAppointments(req.user, {});
    const target = items.filter((it) => (!biz || !it.business || it.business === biz));
    const waiting = target.filter((it) => !it.current_owner);
    push("担当未定のアポ", true, `${waiting.length}件（読み取れたアポ ${target.length}件）`,
      errors.length ? "読めなかったカレンダーがあります：" + errors.map((e) => e.setter).join("、") : "");

    // 5. 1件ずつ、なぜ決まらないかを調べる
    const checked = [];
    for (const it of waiting.slice(0, 8)) {
      const link = it._link || {};
      if (link.auto_assigned_at) {
        checked.push({ title: it.title, ok: false,
          why: "一度自動で試して決まらなかったため、もう対象になりません",
          hint: "「自動で決める」を押すか、担当を手で選んでください。" });
        continue;
      }
      try {
        const pick = await pickCloser(link, { inviteOwner: scanOwner || req.user, business: String(link.business || "") });
        checked.push({
          title: it.title, ok: !!pick.email,
          why: pick.email ? `${pick.name} に決まります（${pick.reason}）` : pick.reason,
          hint: pick.email ? "" :
            (pick.skipped || []).length
              ? "飛ばした人：" + pick.skipped.map((x) => `${x.name}（${x.reason}）`).join(" / ")
              : "",
        });
      } catch (e) {
        checked.push({ title: it.title, ok: false, why: e.message, hint: "" });
      }
    }

    res.json({
      ok: steps.every((x) => x.ok),
      product: biz, steps, appointments: checked,
      config: { autoScan: cfg.autoScan, autoAssign: cfg.autoAssign, bufferMin: cfg.bufferMin,
                scanIntervalSec: cfg.scanIntervalSec, maxPerRun: cfg.maxPerRun },
    });
  } catch (e) { res.status(500).json({ error: e.message, steps }); }
});

// 音が出ない原因を切り分ける。1段ずつ試して、どこで止まっているかを日本語で返す。
app.post("/api/kasasagi/selftest", async (req, res) => {
  const botId = String(req.body?.botId || "").trim();
  const steps = [];
  const push = (name, ok, detail, hint) => steps.push({ name, ok, detail: String(detail || ""), hint: hint || "" });

  // 1. 読み上げ（Edge TTS）が動くか
  let b64 = "";
  try {
    const { synthesizeBase64, ttsInfo, audioKind } = await import("./tts.js");
    const info = ttsInfo();
    const t0 = Date.now();
    b64 = await synthesizeBase64("テストです。");
    push("読み上げ（音声を作る）", true,
      `${info.provider} / ${info.voice} / ${info.kind} / ${Math.round(b64.length * 0.75 / 1024)}KB / ${Date.now() - t0}ms`);
  } catch (e) {
    push("読み上げ（音声を作る）", false, e.message,
      "Railwayから speech.platform.bing.com へ出られない可能性があります。" +
      "環境変数 TTS_PROVIDER=gemini に変えると、Geminiの読み上げに切り替わります（GEMINI_API_KEY が必要）。");
    return res.json({ ok: false, steps });
  }

  // 2. Botが音声を出せる作りか
  if (!botId) { push("Botの確認", false, "botId がありません", "商談を開いてから実行してください。"); return res.json({ ok: false, steps }); }
  let bot = null;
  try {
    bot = await getBot(botId);
    const variant = JSON.stringify(bot?.variant || bot?.recording_config?.variant || "");
    const canSpeak = /web_4_core/.test(variant);
    push("Botが喋れる作りか", canSpeak,
      `variant=${variant || "(なし)"} / 状態=${bot?.status_changes?.slice(-1)[0]?.code || bot?.status || "不明"}`,
      canSpeak ? "" :
      "このBotは音声を出せない作りで入室しています。いったん退出し、" +
      "レコーディング画面で「かささぎ（AIが説明する）を使う」にチェックを入れてから入室し直してください。" +
      "（入室後に切り替えることはできません）");
    if (!canSpeak) return res.json({ ok: false, steps });
  } catch (e) {
    push("Botの確認", false, e.message, "Recallの設定（RECALL_API_KEY）をご確認ください。");
    return res.json({ ok: false, steps });
  }

  // 3. 実際に会議へ音を流してみる
  try {
    const { audioKind: ak } = await import("./tts.js");
    await outputAudio(botId, b64, ak());
    push("会議へ音を流す", true, "テストの音声を流しました。会議で聞こえたか確認してください。");
  } catch (e) {
    push("会議へ音を流す", false, e.message,
      e.needOutputMedia
        ? "Recall側で音声出力が有効になっていません。プランや設定をご確認ください。"
        : "Botが会議に入室済みか、まだ待機室にいないかをご確認ください。");
    return res.json({ ok: false, steps });
  }

  res.json({ ok: true, steps });
});

// アバターページ（会議に映すページ）が読む内容。認証なしで読めるようにする。
app.get("/api/kasasagi/face", async (req, res) => {
  try {
    const st = faceState(String(req.query.botId || ""));
    // アバターの画像と名前は設定から。未設定なら既定の絵を使う。
    let look = {};
    try {
      const cfg = await getSettings();
      look = {
        avatarUrl: String(cfg.kasasagiAvatarUrl || "").trim(),
        avatarSpeakUrl: String(cfg.kasasagiAvatarSpeakUrl || "").trim(),
        name: String(cfg.kasasagiName || "かささぎ").trim(),
        brand: String(cfg.kasasagiBrand || "").trim(),
      };
    } catch {}
    res.json({ ...st, ...look });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// アバターの見た目を設定する
app.put("/api/kasasagi/look", async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    if (b.avatarUrl !== undefined) patch.kasasagiAvatarUrl = String(b.avatarUrl || "").trim().slice(0, 500);
    if (b.avatarSpeakUrl !== undefined) patch.kasasagiAvatarSpeakUrl = String(b.avatarSpeakUrl || "").trim().slice(0, 500);
    if (b.name !== undefined) patch.kasasagiName = String(b.name || "").trim().slice(0, 40);
    if (b.brand !== undefined) patch.kasasagiBrand = String(b.brand || "").trim().slice(0, 60);
    await saveSettings(patch);
    res.json({ ok: true, look: patch });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/kasasagi/look", async (req, res) => {
  try {
    const cfg = await getSettings();
    res.json({
      avatarUrl: cfg.kasasagiAvatarUrl || "", avatarSpeakUrl: cfg.kasasagiAvatarSpeakUrl || "",
      name: cfg.kasasagiName || "かささぎ", brand: cfg.kasasagiBrand || "",
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// スライドを手で切り替える
app.put("/api/kasasagi/slide", async (req, res) => {
  try {
    const s = getKasasagi(String(req.body?.botId || ""));
    if (!s) return res.status(404).json({ error: "かささぎが動いていません" });
    const key = String(req.body?.slide || "");
    if (!SLIDE_LABELS[key]) return res.status(400).json({ error: "そのスライドはありません" });
    s.slide = key; s.slideAt = Date.now();
    s.note("slide", `スライドを「${SLIDE_LABELS[key]}」に切り替えました（手動）`);
    res.json({ ok: true, slides: SLIDE_LABELS, status: s.status() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// その商談専用のまとめスライドを出す（認識合わせ）
app.post("/api/kasasagi/summary", async (req, res) => {
  try {
    const s = getKasasagi(String(req.body?.botId || ""));
    if (!s) return res.status(404).json({ error: "かささぎが動いていません" });
    await s.showSummary(String(req.body?.text || ""));
    res.json({ ok: true, status: s.status() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 答えられなかった質問（一覧・回答）
app.get("/api/kasasagi/unanswered", async (req, res) => {
  try {
    res.json({
      items: await listUnanswered({ onlyOpen: req.query.open === "1" }),
      blocked: await listBlocked(50),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/kasasagi/unanswered/:id", async (req, res) => {
  try {
    const answer = String(req.body?.answer || "").trim();
    if (!answer) return res.status(400).json({ error: "答えが空です" });
    const row = await answerUnanswered(parseInt(req.params.id, 10), { answer, answeredBy: req.user });
    // そのまま社内ナレッジにも足して、次の商談から使えるようにする
    if (row && req.body?.toKnowledge !== false) {
      try {
        const k = await addKnowledge({
          category: "かささぎQA", title: row.question.slice(0, 80), body: answer,
          owner: req.user, sourceType: "kasasagi", sourceRef: row.bot_id || "",
        });
        if (k && k.id) await indexKnowledge(k.id, { title: row.question, category: "かささぎQA", body: answer });
      } catch (e) { console.warn("[kasasagi] ナレッジ追加に失敗", e.message); }
    }
    res.json({ ok: true, row });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 商談後のまとめ（営業へのフィードバックと次アクション）
app.post("/api/kasasagi/report", async (req, res) => {
  try {
    const botId = String(req.body?.botId || "");
    const r = await buildReport(botId);
    if (!r) return res.status(404).json({ error: "かささぎが動いていません" });
    await saveKasasagiReport({ ...r, owner: req.user });
    res.json({ ok: true, report: r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/kasasagi/report", async (req, res) => {
  try { res.json({ report: await getKasasagiReport(String(req.query.botId || "")) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== かささぎ（AIが商談で喋る） =====
app.get("/api/kasasagi/status", async (req, res) => {
  try {
    const botId = String(req.query.botId || "");
    const s = botId ? getKasasagi(botId) : null;
    res.json({ ...kasasagiInfo(), session: s ? s.status() : null });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 開始（この商談のボットで喋れるようにする）
app.post("/api/kasasagi/start", async (req, res) => {
  try {
    const botId = String(req.body?.botId || "").trim();
    if (!botId) return res.status(400).json({ error: "botId がありません" });
    if (getKasasagi(botId)) return res.status(409).json({ error: "この商談ではすでに動いています" });

    // 社内ナレッジを参考情報として渡す（あれば）
    // かささぎが商談で使ってよいナレッジだけを材料にする（visibility で絞る）
    let knowledge = "";
    try {
      const rows = await knowledgeForKasasagi(30);
      knowledge = rows.map((r) => `【${r.category || "情報"}】${r.title}\n${String(r.body || "").slice(0, 600)}`)
        .join("\n\n").slice(0, 6000);
    } catch {}
    if (!knowledge) {
      try {
        const hit = await retrieve(String(req.body?.topic || "サービス紹介 料金 導入事例"), { topK: 6, maxChars: 3500 });
        knowledge = typeof hit === "string" ? hit : (hit && hit.text) || "";
      } catch {}
    }

    // 商談名（相手の会社名）を添えると、台本の作りが良くなる
    let company = "";
    try { const m = await getMeeting(botId); company = (m && m.title) || ""; } catch {}

    // 台本が空なら、参考情報からAIに作ってもらう
    let script = String(req.body?.script || "").trim();
    let generated = false;
    if (!script) {
      script = await buildScript({ knowledge, company, persona: req.body?.persona || "" });
      generated = !!script;
    }

    const s = startKasasagi(botId, {
      script,
      title: company,
      mode: req.body?.mode === "solo" ? "solo" : "buddy",
      persona: req.body?.persona || "",
      knowledge,
      autoAnswer: req.body?.autoAnswer !== false,
      autoAdvance: req.body?.autoAdvance !== false,
      quickAck: req.body?.quickAck !== false,
      useSlides: req.body?.useSlides !== false,
      greeting: req.body?.greeting || "",
      botName: req.body?.botName || "",
    });
    if (generated) s.note("info", "台本が空だったので、社内の情報から自動で作りました");
    console.log(`[kasasagi] 開始 ${botId} by ${req.user}（台本 ${generated ? "自動生成" : "手入力"}）`);

    if (s.mode === "solo") {
      // ソロは開始した時点から自分で進行する
      s.begin().catch((e) => s.note("error", e.message));
    } else {
      // バディは営業のブリーフィングが終わるまで完全に沈黙し、合図で話し始める
      s.note("info", "待機中です。「かささぎさん、お願いします」で話し始めます。");
    }
    res.json({ ok: true, generatedScript: generated ? script : "",
               slides: SLIDE_LABELS, status: s.status() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// その場で喋らせる
app.post("/api/kasasagi/say", async (req, res) => {
  try {
    const s = getKasasagi(String(req.body?.botId || ""));
    if (!s) return res.status(404).json({ error: "かささぎが動いていません" });
    const text = String(req.body?.text || "").trim();
    if (!text) return res.status(400).json({ error: "話す内容が空です" });
    await s.say(text, "manual");
    res.json({ ok: true, status: s.status() });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// 台本を1つ進めて読む
app.post("/api/kasasagi/next", async (req, res) => {
  try {
    const s = getKasasagi(String(req.body?.botId || ""));
    if (!s) return res.status(404).json({ error: "かささぎが動いていません" });
    const r = await s.readNext();
    res.json({ ok: true, ...r, status: s.status() });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// 質問への自動応答を切り替える
app.put("/api/kasasagi/auto", async (req, res) => {
  try {
    const s = getKasasagi(String(req.body?.botId || ""));
    if (!s) return res.status(404).json({ error: "かささぎが動いていません" });
    s.autoAnswer = req.body?.autoAnswer !== false;
    if (req.body?.autoAdvance !== undefined) {
      s.autoAdvance = req.body.autoAdvance !== false;
      if (s.autoAdvance) s.scheduleAdvance();
      else if (s.advanceTimer) { clearTimeout(s.advanceTimer); s.advanceTimer = null; }
    }
    s.note("info", `応答${s.autoAnswer ? "ON" : "OFF"}／自動進行${s.autoAdvance ? "ON" : "OFF"} にしました`);
    res.json({ ok: true, status: s.status() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/kasasagi/stop", async (req, res) => {
  try {
    const botId = String(req.body?.botId || "");
    const ok = await stopKasasagi(botId);
    console.log(`[kasasagi] 停止 ${botId} by ${req.user}`);
    res.json({ ok });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/recall/status", async (req, res) => {
  const info = recallConnectionInfo();
  const out = { ...info, lastCreate: getLastRecallCreate(), usage: null, usageError: null };
  try {
    out.usage = await getRecallUsage();
  } catch (e) {
    out.usageError = e.message || "利用状況の取得に失敗しました";
  }
  // 今月の商談数と突き合わせて、1件あたりの時間を出す（課金の目安）
  try {
    const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
    const from = `${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const rows = await listMeetings({ isAdmin: true, from, limit: 2000 });
    const hours = out.usage ? out.usage.botTotalSeconds / 3600 : 0;
    out.thisMonth = {
      meetings: rows.length,
      botHours: Math.round(hours * 10) / 10,
      hoursPerMeeting: rows.length ? Math.round((hours / rows.length) * 100) / 100 : null,
      note: "Recallは『ボットが会議にいた時間』で課金されます。1件あたりの時間が長い場合、誰も来ない会議で待ち続けている可能性があります。",
    };
  } catch {}
  res.json(out);
});

// 接続している外部APIの一覧（課金の有無・接続先・確認先）。キーは末尾4文字のみ。
// 稟議用：課金しているサービスの提供会社をまとめて出す
const VENDORS = {
  recall: { vendor: "Recall.ai, Inc.", country: "アメリカ", billing: "従量課金（ボットの稼働時間）", currency: "USD", site: "https://www.recall.ai/" },
  anthropic: { vendor: "Anthropic PBC", country: "アメリカ", billing: "従量課金（AIの処理量）", currency: "USD", site: "https://www.anthropic.com/" },
  gemini: { vendor: "Google LLC（請求は Google Cloud Japan 合同会社の場合あり）", country: "アメリカ／日本", billing: "従量課金（AIの処理量）", currency: "USD/JPY", site: "https://ai.google.dev/" },
  groq: { vendor: "Groq, Inc.", country: "アメリカ", billing: "従量課金", currency: "USD", site: "https://groq.com/" },
  openai: { vendor: "OpenAI, L.L.C.", country: "アメリカ", billing: "従量課金", currency: "USD", site: "https://openai.com/" },
  deepgram: { vendor: "Deepgram, Inc.", country: "アメリカ", billing: "従量課金（文字起こしの時間）", currency: "USD", site: "https://deepgram.com/" },
  mux: { vendor: "Mux, Inc.", country: "アメリカ", billing: "従量課金（配信・保存・視聴）", currency: "USD", site: "https://www.mux.com/" },
  cloudflare: { vendor: "Cloudflare, Inc.", country: "アメリカ", billing: "月額＋従量（視聴時間・保存）", currency: "USD", site: "https://www.cloudflare.com/ja-jp/developer-platform/products/cloudflare-stream/" },
  railway: { vendor: "Railway Corp.", country: "アメリカ", billing: "従量課金（サーバー・通信量）", currency: "USD", site: "https://railway.com/" },
  google: { vendor: "Google LLC", country: "アメリカ", billing: "無料（Workspaceの契約内で利用）", currency: "-", site: "https://workspace.google.com/" },
  notion: { vendor: "Notion Labs, Inc.", country: "アメリカ", billing: "無料（既存契約内で利用）", currency: "-", site: "https://www.notion.so/" },
  salesforce: { vendor: "株式会社セールスフォース・ジャパン", country: "日本", billing: "無料（既存契約内で利用）", currency: "-", site: "https://www.salesforce.com/jp/" },
  gbizinfo: { vendor: "経済産業省（gBizINFO）", country: "日本", billing: "無料", currency: "-", site: "https://info.gbiz.go.jp/" },
};

app.get("/api/vendors", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const env = process.env;
    const has = (v) => !!(v && String(v).trim());
    const provider = (env.LIVE_PROVIDER || "mux").toLowerCase();
    const rows = [
      { key: "recall", label: "会議への入室・録音・文字起こし", used: has(env.RECALL_API_KEY) },
      { key: "anthropic", label: "商談の要約・分析・抽出", used: has(env.ANTHROPIC_API_KEY) },
      { key: "gemini", label: "商談の要約・分析", used: has(env.GEMINI_API_KEY) },
      { key: "groq", label: "AI（控え）", used: has(env.GROQ_API_KEY) },
      { key: "openai", label: "AI（任意）", used: has(env.OPENAI_API_KEY) },
      { key: "deepgram", label: "文字起こし（任意）", used: has(env.DEEPGRAM_API_KEY) },
      { key: "mux", label: "商談中のライブ配信・録画の保管", used: has(env.MUX_TOKEN_ID) && provider === "mux" },
      { key: "cloudflare", label: "商談中のライブ配信", used: has(env.CF_STREAM_TOKEN) && provider === "cloudflare" },
      { key: "railway", label: "kinbot本体の稼働（サーバー・データベース）", used: true },
      { key: "google", label: "カレンダー・Gmail・ドライブ連携", used: has(env.GOOGLE_CLIENT_ID) },
      { key: "salesforce", label: "商談・リードの連携", used: has(env.SF_CLIENT_ID) },
      { key: "notion", label: "議事録の書き出し", used: has(env.NOTION_TOKEN) },
      { key: "gbizinfo", label: "企業情報の取得", used: has(env.GBIZINFO_TOKEN) },
    ];
    // 文字起こしは、どのエンジンを使うかで請求先が変わる
    const tp = (env.RECALL_TRANSCRIBE_PROVIDER || "recallai").toLowerCase();
    const transcription =
      tp === "deepgram"
        ? { engine: "Deepgram", vendor: "Deepgram, Inc.", billedBy: "Deepgram（Recallの請求とは別）", note: "DeepgramのAPIキーを使う場合はDeepgramから直接請求されます。Recall経由で使う場合はRecallの請求に含まれます。" }
        : tp === "gladia"
          ? { engine: "Gladia", vendor: "Gladia SAS", billedBy: "Gladia またはRecall経由", note: "契約形態によって請求元が変わります。" }
          : { engine: "Recall標準", vendor: "Recall.ai, Inc.", billedBy: "Recall（ボット稼働時間とは別の明細）", note: "Recallの請求書に『Transcription』などの明細として、ボット稼働時間とは別に計上されます。" };

    res.json({
      generatedAt: new Date().toISOString(),
      note: "法人名・請求条件は変更されることがあります。稟議に使う際は請求書（インボイス）の記載で最終確認してください。",
      transcription,
      paid: rows.filter((r) => r.used && VENDORS[r.key] && VENDORS[r.key].currency !== "-").map((r) => ({ 用途: r.label, ...VENDORS[r.key] })),
      free: rows.filter((r) => r.used && VENDORS[r.key] && VENDORS[r.key].currency === "-").map((r) => ({ 用途: r.label, ...VENDORS[r.key] })),
      notUsed: rows.filter((r) => !r.used).map((r) => r.key),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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
  // ライブ配信（MuxかCloudflareのどちらかを使う）
  const liveProv = (env.LIVE_PROVIDER || "mux").toLowerCase();
  const cfOk = has(env.CF_ACCOUNT_ID) && has(env.CF_STREAM_TOKEN);
  services.push({
    key: "cloudflare", name: "Cloudflare Stream（ライブ配信）", billable: true,
    configured: cfOk && has(env.CF_STREAM_CUSTOMER_CODE), keyLast4: last4(env.CF_STREAM_TOKEN),
    detail: liveProv === "cloudflare"
      ? (cfOk ? (has(env.CF_STREAM_CUSTOMER_CODE) ? "商談のライブ映像配信（使用中）" : "顧客サブドメイン（CF_STREAM_CUSTOMER_CODE）が未設定です")
              : "アカウントIDかAPIトークンが未設定です")
      : "設定すれば使えます（今はMuxを使用中）",
    role: liveProv === "cloudflare" ? "ライブ配信（使用中）" : "ライブ配信（待機）",
    inUse: liveProv === "cloudflare" && cfOk,
    dashboardUrl: "https://dash.cloudflare.com/?to=/:account/stream",
  });
  services.push({
    key: "mux", name: "Mux（ライブ配信・録画の保管）", billable: true,
    configured: has(env.MUX_TOKEN_ID) && has(env.MUX_TOKEN_SECRET), keyLast4: last4(env.MUX_TOKEN_ID),
    detail: liveProv === "mux" ? "商談のライブ映像配信（使用中）" : "ライブ配信はCloudflareに切り替え済み（アップロード動画のみ使用）",
    role: liveProv === "mux" ? "ライブ配信（使用中）" : "予備・アップロード動画",
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
    // 人が手動で進めた進捗（stepper上のクリックで保存される）
    const manualProgress = deal.manual_progress || null;
    res.json({
      found: true,
      deal_id: deal.deal_id,
      status: deal.status,
      first_meeting_date: deal.first_meeting_date,
      auto_lose_deadline: deal.auto_lose_deadline || null,
      needs_review: needsReview,
      first: firstEv ? {
        id: firstEv.id,
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
      manual_progress: manualProgress,
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
    const { rep_name, team_name, group_name, product } = req.body || {};
    if (!rep_name || !team_name) return res.status(400).json({ error: "担当者名とチーム名が必要です" });
    const p = ["DOC", "MOCHICA"].includes(String(product || "").trim()) ? String(product).trim() : "";
    await upsertRepTeam(rep_name, team_name, group_name || "直販", p);
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
    // カレンダー照合は「代表者（設定で指定した人）のGoogle連携」を経由して実行する。
    // これにより、Google未連携のメンバーがボタンを押しても照合できる（＝全員がアポ状況を更新・閲覧できる）。
    const s = await getSettings();
    const configured = s && typeof s.apoCalendarOwner === "string" ? s.apoCalendarOwner.trim() : "";
    let gcalOwner = "";
    if (configured && (await gcalConnected(configured))) {
      gcalOwner = configured; // 代表者の連携を使う
    } else if (req.user && (await gcalConnected(req.user))) {
      gcalOwner = req.user; // 代表者が未設定/未連携なら、押した本人の連携で実行
    }
    if (!gcalOwner) {
      return res.status(400).json({
        error: configured
          ? `照合の代表者（${configured}）のGoogle連携が切れています。${configured} さんが 設定→連携→Google連携 を実行してください。`
          : "Googleが連携されていません。設定→インターン登録 で照合の代表者を選ぶか、設定→連携→Google連携 を先に済ませてください。",
      });
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
    // 商談日と予定日のズレ（DATE_WINDOW日）を許容するため、カレンダー取得は前後に余裕を持たせる
    const timeMin = new Date(Date.parse(from + "T00:00:00+09:00") - 3 * 86400 * 1000).toISOString();
    const timeMax = new Date(Date.parse(to + "T23:59:59+09:00") + 3 * 86400 * 1000).toISOString();

    // 対象商談：実施済み（商談カテゴリ）かつ「初回/新」の商談のみをカウント対象にする
    const allMeetings = await listMeetings({ isAdmin: true });
    const meetings = allMeetings.filter((m) => {
      if (m.category && m.category !== "商談") return false;
      if (!isFirstMeetingTitle(m.title)) return false; // 【新/ヒ】【初回/…】のみ
      const d = jstDateStr(m.created_at);
      return d && d >= from && d <= to;
    });

    // 各インターンのカレンダー予定を取得（未共有などは individual に握りつぶす）
    // 照合対象は「本人が主催者（作成者）の予定」のみ。招待されただけの予定は除外する。
    // 注意：Googleは主催者を「そのカレンダーのID」で返すことがあるため、登録メールだけでなく
    //       読み込んでいるカレンダーID自身とも突き合わせる（別名アドレス等での取りこぼしを防ぐ）。
    const internEvents = []; // { intern, events:[...], error }
    for (const it of interns) {
      const internEmail = String(it.email || "").toLowerCase();
      const isHost = (e) => {
        const org = String(e.organizer || "").toLowerCase();
        const creator = String(e.creator || "").toLowerCase();
        const self = (x) => x && (x === internEmail);
        if (self(org) || self(creator)) return true;
        // 主催者・作成者のどちらも取得できない場合は、本人のカレンダー上の予定として扱う
        if (!org && !creator) return true;
        return false;
      };
      try {
        const evs = await listCalendarEvents(gcalOwner, it.email, { timeMin, timeMax });
        const kept = evs.filter(isHost);
        internEvents.push({
          intern: it,
          events: kept
                     .map((e) => ({ title: e.title, date: jstDateStr(e.start) }))
                     .filter((e) => e.title && e.date),
          fetched: evs.length,
          hosted: kept.length,
          // 診断用：主催者で弾かれた予定のサンプル（誰が主催になっているか）
          skipped_samples: evs.filter((e) => !isHost(e)).slice(0, 3)
                              .map((e) => ({ title: e.title, organizer: e.organizer || "", creator: e.creator || "" })),
          error: null,
        });
      } catch (e) {
        const msg = /40[34]/.test(e.message)
          ? "カレンダーを読めませんでした（このメールのカレンダーがあなたと共有されているか確認してください）"
          : e.message;
        internEvents.push({ intern: it, events: [], fetched: 0, hosted: 0, skipped_samples: [], error: msg });
      }
    }

    // 再照合なので、まず対象期間のアポ獲得者をクリア
    await clearApoSetters({ from, to });

    // 照合：商談名 × 予定名（日付ウィンドウ内）
    const perIntern = {}; // email -> { name, email, matched:[], error }
    for (const ie of internEvents) perIntern[ie.intern.email] = { name: ie.intern.name, email: ie.intern.email, matched: [], error: ie.error, fetched: ie.fetched, hosted: ie.hosted, skipped_samples: ie.skipped_samples };
    let matchedCount = 0, multiCount = 0;
    const unmatched = [];

    for (const m of meetings) {
      const mDate = jstDateStr(m.created_at);
      const mParts = apoNameParts(m.title);
      if (!apoCompanyKey(mParts.company)) { unmatched.push({ bot_id: m.bot_id, title: m.title, date: mDate }); continue; }
      // このミーティングに一致する（インターン, 予定日ズレ）候補を集める
      const cands = [];
      for (const ie of internEvents) {
        let best = null;
        for (const ev of ie.events) {
          if (dayDiff(ev.date, mDate) > DATE_WINDOW) continue;
          if (!apoNameMatch(m.title, ev.title)) continue; // 企業名＋担当者名で照合
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
        .map((p) => ({ name: p.name, email: p.email, count: p.matched.length, error: p.error, calendar_events: p.fetched, hosted_events: p.hosted, skipped_samples: p.skipped_samples, meetings: p.matched }))
        .sort((a, b) => b.count - a.count),
      unmatched_list: unmatched,
    });
  } catch (e) {
    console.error("[interns/match]", e);
    res.status(500).json({ error: e.message });
  }
});

// カレンダー照合の代表者（この人のGoogle連携を経由して全員が照合できる）
app.get("/api/apo-calendar-owner", async (req, res) => {
  try {
    const s = await getSettings();
    const owner = s && typeof s.apoCalendarOwner === "string" ? s.apoCalendarOwner : "";
    const candidates = await listGoogleConnectedOwners();
    res.json({
      owner,
      connected: owner ? await gcalConnected(owner) : false,
      candidates: candidates.map((c) => ({ owner: c.owner, email: c.google_email })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put("/api/apo-calendar-owner", async (req, res) => {
  try {
    const owner = String((req.body && req.body.owner) || "").trim();
    if (owner && !(await gcalConnected(owner))) {
      return res.status(400).json({ error: `${owner} さんはGoogle未連携です。先に本人が 設定→連携→Google連携 を実行してください。` });
    }
    const r = await saveSettings({ apoCalendarOwner: owner });
    res.json({ ok: true, owner, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 商談予定の自動作成（招待方式）の設定：予定を作る運用者・自動作成のON/OFF
app.get("/api/apo-invite-config", async (req, res) => {
  try {
    const s = await getSettings();
    const owner = (s && String(s.apoInviteOwner || "")) || "";
    const candidates = await listGoogleConnectedOwners();
    res.json({
      owner,
      auto: !(s && s.apoAutoInvite === false),
      connected: owner ? await gcalConnected(owner) : false,
      calendar_id: (s && String(s.apoInviteCalendarId || "")) || "",
      mode: s && s.apoInviteMode === "owner" ? "owner" : "closer",
      candidates: candidates.map((c) => ({ owner: c.owner, email: c.google_email })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put("/api/apo-invite-config", async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    if (b.owner !== undefined) {
      const owner = String(b.owner || "").trim();
      if (owner && !(await gcalConnected(owner))) {
        return res.status(400).json({ error: `${owner} さんはGoogle未連携です。先に本人が 設定→連携→Google連携 を実行してください。` });
      }
      patch.apoInviteOwner = owner;
    }
    if (b.auto !== undefined) patch.apoAutoInvite = !!b.auto;
    if (b.calendar_id !== undefined) patch.apoInviteCalendarId = String(b.calendar_id || "").trim();
    if (b.mode !== undefined) patch.apoInviteMode = b.mode === "owner" ? "owner" : "closer";
    const r = await saveSettings(patch);
    res.json({ ok: true, ...patch, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// プロダクト（DOC / MOCHICA）の担当者マッピング。表示の切り替えに使う。
app.get("/api/rep-products", async (req, res) => {
  try {
    const map = await listRepProducts();   // 表示名 -> プロダクト
    const nameMap = await buildNameMap();  // { byEmail: {email: 表示名}, aliases }
    const byName = { ...map };
    for (const [email, disp] of Object.entries((nameMap && nameMap.byEmail) || {})) {
      const prod = map[(disp || "").trim()];
      if (prod) byName[email] = prod; // メールアドレスでも引けるようにする
    }
    res.json({ products: ["DOC", "MOCHICA"], map: byName });
  } catch (e) { res.status(500).json({ error: e.message }); }
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

// 営業担当が未設定の商談を、文字起こしの発言者名から担当を特定して設定する（商談名は変更しない）
app.post("/api/meetings/backfill-owner", async (req, res) => {
  try {
    const users = await listUsers();
    const norm = (s) => String(s || "").replace(/[\s　]/g, "").toLowerCase();
    const userList = (users || []).filter((u) => u.name).map((u) => ({ email: u.email, name: u.name, nname: norm(u.name) }));
    if (!userList.length) return res.json({ ok: true, updated: 0, checked: 0, reason: "ユーザーが登録されていません" });
    const all = await listMeetings({ isAdmin: true });
    const targets = all.filter((m) => !((m.owner_name || "").trim() || (m.rep_name || "").trim() || (m.owner || "").trim()));
    let updated = 0;
    for (const m of targets) {
      let full;
      try { full = await getMeeting(m.bot_id); } catch { continue; }
      const tr = Array.isArray(full && full.transcript) ? full.transcript : [];
      if (!tr.length) continue;
      const speakerCount = {};
      for (const u of tr) {
        const sn = (u.speaker && u.speaker.name) || "";
        if (sn) speakerCount[sn] = (speakerCount[sn] || 0) + 1;
      }
      // ユーザー名を含む発言者を、発言数が多い順で最有力として担当に採用
      let best = null, bestCount = -1;
      for (const sn of Object.keys(speakerCount)) {
        const nsn = norm(sn);
        const u = userList.find((x) => x.nname && nsn.includes(x.nname));
        if (u && speakerCount[sn] > bestCount) { best = u; bestCount = speakerCount[sn]; }
      }
      if (best) {
        try { await setMeetingOwner(m.bot_id, { owner: best.email, repName: best.name }); updated++; } catch {}
      }
    }
    res.json({ ok: true, updated, checked: targets.length });
  } catch (e) {
    console.error("[backfill-owner]", e.message);
    res.status(500).json({ error: e.message });
  }
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
    // モデル指定（claude/gemini）。未指定なら設定の既定に従う。
    let p = String((req.body && req.body.provider) || "").toLowerCase();
    if (p !== "anthropic" && p !== "gemini") p = "";
    const r = await runExtraction(req.params.id, p || undefined);
    // 自動反映：設定がONで、SF連携済みのときだけ。応答はブロックせず裏で実行。
    try {
      const settings = await getUserSettings(req.user);
      // 既定でON。商談が終わって要約ができたら、活動履歴と空欄をSFへ自動で反映する。
      // 止めたい人は 設定→動作設定 でOFFにできる。
      const autoOn = settings.sfAutoReflect !== false;
      if (autoOn && salesforceConfigured() && (await sfConnected(req.user))) {
        const meetingId = req.params.id;
        const user = req.user;
        (async () => {
          try {
            const m = await getMeeting(meetingId);
            if (!m) return;
            let url = m.sf_url || "";
            // リンク未設定なら会社名で検索し、一意に決まるときだけ自動採用（複数・ゼロは触らない）
            if (!extractRecordId(url) && m.account) {
              const recs = await searchOpportunities(user, m.account);
              if (recs && recs.length === 1) url = recs[0].Id;
            }
            if (!extractRecordId(url)) return;
            const rr = await autofillMeetingToSf(user, m, url);
            console.log("[sf-auto] reflected", meetingId,
              "filled=" + (Object.keys((rr.opportunity && rr.opportunity.filled) || {}).length
                + Object.keys((rr.account && rr.account.filled) || {}).length),
              "activity=" + !!(rr.activity && rr.activity.created));
          } catch (e) {
            console.warn("[sf-auto]", meetingId, e.message);
          }
        })();
      }
    } catch (e) {
      console.warn("[sf-auto pre]", e.message);
    }
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
// cohortRe を渡すと「再商談実施」はそれを使う（判断月＝計上月の案件を、案件単位で1件と数える）。
// 渡さない場合はこれまで通り、期間内に実施された再商談イベント数を数える。
function funnelFrom(events, cohortRe) {
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
  const reDone = Array.isArray(cohortRe) ? cohortRe.length : re.length; // 再商談実施（メインKPI）
  // 受注：再商談の結果が受注、かつ案件の現在ステータスも受注のものだけを数える
  // （AIが受注と抽出しても案件が受注になっていない/変更された場合は数えない＝案件画面と一致させる）
  const won = re.filter((e) => e.result === "受注" && e.deal_status === "受注").length;
  // ドリルダウン用：各区分に含まれる商談（会社名・日付）を、集計と同じ絞り込みからそのまま作る
  const brief = (e) => ({
    company: e.company_name || "(会社名なし)",
    date: e.event_date ? String(e.event_date).slice(0, 10) : "",
    bot_id: e.bot_id || "",
    status: e.deal_status || "",
    result: e.result || "",
    next_date: e.next_meeting_date ? String(e.next_meeting_date).slice(0, 10) : "",
  });
  const lostList = decided.filter((e) => {
    const st = statusOfEv(e);
    return st === "失注(未定)" || st === "失注(その他)" || (st === "進行中(未設定)" && e.deal_status === "失注(未定)");
  }).concat(re.filter((e) => e.result === "失注"));
  // 再商談の予定（日程が入っているが、まだ実施していない案件）。実施済み・失注・受注は除く。
  const reBotIds = new Set(re.map((e) => e.bot_id).filter(Boolean));
  const reDeals = new Set(re.map((e) => e.deal_id).filter(Boolean));
  const scheduled = first
    .filter((e) => e.next_meeting_scheduled && e.next_meeting_date)
    .filter((e) => !(e.deal_id && reDeals.has(e.deal_id)) && !reBotIds.has(e.bot_id)) // 既に再商談を実施した案件は除く
    .filter((e) => !String(e.deal_status || "").startsWith("失注") && e.deal_status !== "受注")
    .sort((a, b) => new Date(a.next_meeting_date) - new Date(b.next_meeting_date));

  const details = {
    first: first.map(brief),
    re: Array.isArray(cohortRe) ? cohortRe.slice() : re.map(brief),
    scheduled: scheduled.map(brief),
    activated: activated.map(brief),
    pending_10day: pending10day.map(brief),
    lost: lostList.map(brief),
    won: re.filter((e) => e.result === "受注" && e.deal_status === "受注").map(brief),
    review: review.map(brief),
  };
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
    scheduled: scheduled.length, // 再商談の予定あり（未実施）
    won,
    details,
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
    // プロダクト（DOC / MOCHICA）で絞る。実施者が所属するプロダクトで判定する。
    const productMap = await listRepProducts().catch(() => ({}));
    // 誰にもプロダクトが割り当てられていない間は、絞り込むと全件0になるため無効化する
    const hasProductAssignment = Object.keys(productMap).length > 0;
    const productFilter = (hasProductAssignment && req.query.product) ? String(req.query.product).trim() : null;
    const productOf = (rawOwner) => {
      const disp = resolveDisplayName(rawOwner, nameMap);
      const direct = productMap[(disp || "").trim()] || productMap[(rawOwner || "").trim()];
      if (direct) return direct;
      // 部分一致で吸収（「田中」登録 ↔ 「田中欽也」表示 のズレ）
      const cand = String(disp || rawOwner || "").trim().toLowerCase();
      if (!cand) return "";
      for (const k of Object.keys(productMap)) {
        const kk = String(k).trim().toLowerCase();
        if (kk && (cand === kk || cand.includes(kk) || kk.includes(cand))) return productMap[k];
      }
      return "";
    };

    // 案件担当ではなく「実施者」で絞るため、SQLではownerで絞らずJS側で判定する
    let events = await listDealEvents({ from, to });
    // その商談を実際に担当した人（meetings.owner）を優先。無ければ案件の担当者にフォールバック。
    const repOf = (e) => e.meeting_owner || e.owner;
    // プロダクト絞り込み（DOCのメンバーが実施した商談だけを分析対象にする、など）
    if (productFilter) events = events.filter((e) => productOf(repOf(e)) === productFilter);
    if (owner) {
      const target = resolveDisplayName(owner, nameMap);
      events = events.filter((e) => resolveDisplayName(repOf(e), nameMap) === target);
    }
    // チーム指定があれば、担当者→チームのマッピングでJS側フィルタ（deals.teamカラムに依存しない）
    if (teamFilter) {
      const before = events.length;
      events = events.filter((e) => teamOf(repOf(e)) === teamFilter);
      if (events.length === 0 && before > 0) {
        // 0件になった時だけ、原因調査用にどう解決されたかをログに残す
        const sample = [...new Set(before ? (await listDealEvents({ from, to, owner })).map((e) => repOf(e)) : [])].slice(0, 10);
        console.warn(`[report funnel] チーム「${teamFilter}」で0件。担当者→チーム解決:`, sample.map((o) => `${o}→${teamOf(o)}`));
        console.warn(`[report funnel] 登録済みチーム名一覧:`, [...new Set(Object.values(teamMap))]);
      }
    }
    // ===== 再商談実施の「計上判断月」コホート =====
    // KPIの再商談実施は「初回商談の判断月(judgment_month)が対象月」の案件を、案件単位で1件と数える。
    // （再商談を実際にやった日が翌月でも、判断月が7月ならその月の実績として計上する）
    // 判断月は「月」の概念なので、月次のときだけ適用。週次/日次は従来どおり実施日ベース。
    let cohortRe = null;
    let reDebug = null;
    if (granularity === "month") {
      const targetMonth = String(from).slice(0, 7);
      const allEvents = await listDealEvents({}); // 期間で切らず全件（再商談が翌月でも拾うため）
      const byDeal = {};
      for (const e of allEvents) {
        const k = e.deal_id || e.bot_id;
        if (!k) continue;
        byDeal[k] = byDeal[k] || { first: null, res: [] };
        if (e.event_type === "初回商談" && e.meeting_kind === "初回商談") byDeal[k].first = e;
        else if (e.event_type === "再商談実施") byDeal[k].res.push(e);
      }
      cohortRe = [];
      // 診断：期間内に実施された再商談イベントが、なぜコホートに入らないのかを分類する
      reDebug = { target_month: targetMonth, re_events_in_period: 0, counted_deals: 0,
                  no_deal_id: 0, no_first_event: 0, first_jm_null: 0, first_jm_other: 0, other_months: {} };
      for (const e of events) {
        if (e.event_type !== "再商談実施") continue;
        reDebug.re_events_in_period++;
        const k = e.deal_id || e.bot_id;
        if (!e.deal_id) { reDebug.no_deal_id++; continue; }
        const f = byDeal[k] && byDeal[k].first;
        if (!f) { reDebug.no_first_event++; continue; }
        if (!f.judgment_month) { reDebug.first_jm_null++; continue; }
        if (f.judgment_month !== targetMonth) {
          reDebug.first_jm_other++;
          reDebug.other_months[f.judgment_month] = (reDebug.other_months[f.judgment_month] || 0) + 1;
        }
      }
      for (const k of Object.keys(byDeal)) {
        const f = byDeal[k].first;
        if (!f || f.judgment_month !== targetMonth) continue; // 判断月が対象月の案件のみ
        if (!byDeal[k].res.length) continue;                  // 再商談を実施していない案件は除外
        // 案件単位で1件。実施者は最後に再商談を行った人（＝担当者別の集計先）
        const last = byDeal[k].res.slice().sort((a, b) => new Date(a.event_date) - new Date(b.event_date)).pop();
        cohortRe.push({
          company: last.company_name || f.company_name || "(会社名なし)",
          date: last.event_date ? String(last.event_date).slice(0, 10) : "",
          bot_id: last.bot_id || "",
          status: last.deal_status || "",
          result: last.result || "",
          _rep: repOf(last),
          _kind: last.deal_kind || "通常",
        });
      }
      reDebug.counted_deals = cohortRe.length;
      console.log("[funnel re-cohort]", JSON.stringify(reDebug));
      // 対象（担当者/チーム/プロダクト）の絞り込みをコホートにも同じ基準で適用
      if (productFilter) cohortRe = cohortRe.filter((c) => productOf(c._rep) === productFilter);
      if (owner) {
        const target = resolveDisplayName(owner, nameMap);
        cohortRe = cohortRe.filter((c) => resolveDisplayName(c._rep, nameMap) === target);
      }
      if (teamFilter) cohortRe = cohortRe.filter((c) => teamOf(c._rep) === teamFilter);
    }
    const stripRe = (arr) => (arr ? arr.map(({ _rep, _kind, ...rest }) => rest) : null);

    const overall = funnelFrom(events, stripRe(cohortRe));
    // 担当者別（全体/チーム選択時に内訳を出す）。実施した本人（meetings.owner）で集計する。
    const byOwnerMap = {};
    for (const e of events) {
      const o = resolveDisplayName(repOf(e), nameMap) || "(不明)";
      (byOwnerMap[o] = byOwnerMap[o] || []).push(e);
    }
    // コホートも同じキーで担当者別に振り分ける（担当者別の再商談実施も計上判断月ベースに揃える）
    const cohortByOwner = {};
    for (const c of cohortRe || []) {
      const o = resolveDisplayName(c._rep, nameMap) || "(不明)";
      (cohortByOwner[o] = cohortByOwner[o] || []).push(c);
      if (!byOwnerMap[o]) byOwnerMap[o] = []; // 期間内イベントが無くてもコホートがあれば行を出す
    }
    const byOwner = Object.keys(byOwnerMap).sort().map((o) => ({
      owner: o,
      ...funnelFrom(byOwnerMap[o], cohortRe ? stripRe(cohortByOwner[o] || []) : undefined),
    }));

    // 種別別（コールド/過去失注/通常）
    const byKindMap = {};
    for (const e of events) {
      const k = e.deal_kind || "通常";
      (byKindMap[k] = byKindMap[k] || []).push(e);
    }
    const cohortByKind = {};
    for (const c of cohortRe || []) {
      const k = c._kind || "通常";
      (cohortByKind[k] = cohortByKind[k] || []).push(c);
      if (!byKindMap[k]) byKindMap[k] = [];
    }
    const kindOrder = ["通常", "コールド", "過去失注"];
    const byKind = kindOrder.filter((k) => byKindMap[k]).map((k) => ({
      kind: k,
      ...funnelFrom(byKindMap[k], cohortRe ? stripRe(cohortByKind[k] || []) : undefined),
    }));

    // チーム別（担当者→チームのマッピングで集約）。さらに各チームを種別で内訳。
    const byTeamMap = {}; // team -> events
    for (const e of events) {
      const tm = teamOf(repOf(e));
      (byTeamMap[tm] = byTeamMap[tm] || []).push(e);
    }
    const cohortByTeam = {};
    for (const c of cohortRe || []) {
      const tm = teamOf(c._rep);
      (cohortByTeam[tm] = cohortByTeam[tm] || []).push(c);
      if (!byTeamMap[tm]) byTeamMap[tm] = [];
    }
    const byTeam = Object.keys(byTeamMap).sort().map((tm) => {
      const evs = byTeamMap[tm];
      const tCohort = cohortRe ? (cohortByTeam[tm] || []) : null;
      // チーム内の種別内訳
      const kmap = {};
      for (const e of evs) { const k = e.deal_kind || "通常"; (kmap[k] = kmap[k] || []).push(e); }
      const tCohortByKind = {};
      for (const c of tCohort || []) { const k = c._kind || "通常"; (tCohortByKind[k] = tCohortByKind[k] || []).push(c); if (!kmap[k]) kmap[k] = []; }
      const kinds = kindOrder.filter((k) => kmap[k]).map((k) => ({
        kind: k,
        ...funnelFrom(kmap[k], tCohort ? stripRe(tCohortByKind[k] || []) : undefined),
      }));
      return { team: tm, ...funnelFrom(evs, tCohort ? stripRe(tCohort) : undefined), kinds };
    });

    res.json({ granularity, from, to, owner, team, overall, byOwner, byKind, byTeam, re_basis: cohortRe ? "judgment_month" : "event_date", re_debug: reDebug });
  } catch (e) {
    console.error("[report funnel]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 勝ち/負けパターン分析（インサイト）。scope=all | team:<名> | owner:<名>
//  GET  : キャッシュされた結果を返す（無ければ null）
//  POST : 対象商談を「再商談に進んだ群」と「止まった群」に分け、文字起こしを比較分析して保存
// 担当者名 → チーム名を解決する関数を作る（実績・インサイトで共用）
async function buildTeamOf(nameMap) {
  const nm = nameMap || (await buildNameMap());
  const teamMap = {};
  for (const t of (await listRepTeams().catch(() => []))) teamMap[(t.rep_name || "").trim()] = (t.team_name || "").trim();
  return (rawOwner) => {
    const disp = resolveDisplayName(rawOwner, nm);
    return teamMap[(disp || "").trim()] || teamMap[(rawOwner || "").trim()] || "(未割り当て)";
  };
}

async function gatherInsightGroups(scope) {
  const nameMap = await buildNameMap();
  const productMap = await listRepProducts().catch(() => ({}));
  const repOf = (e) => e.meeting_owner || e.owner;
  const teamOf = await buildTeamOf(nameMap);
  const productOf = (raw) => {
    const disp = resolveDisplayName(raw, nameMap);
    const direct = productMap[(disp || "").trim()] || productMap[(raw || "").trim()];
    if (direct) return direct;
    const c = String(disp || raw || "").trim().toLowerCase();
    for (const k of Object.keys(productMap)) { const kk = k.trim().toLowerCase(); if (kk && (c === kk || c.includes(kk) || kk.includes(c))) return productMap[k]; }
    return "";
  };
  let events = await listDealEvents({});
  // 初回商談イベントだけを対象（＝その商談で再商談に進んだかどうかを見る）
  let first = events.filter((e) => e.event_type === "初回商談" && e.meeting_kind === "初回商談");

  // スコープの絞り込み
  let label = "全体";
  const product = (scope && scope.product) || "";
  if (product) { first = first.filter((e) => productOf(repOf(e)) === product); label = product; }
  if (scope && scope.owner) {
    const target = resolveDisplayName(scope.owner, nameMap);
    first = first.filter((e) => resolveDisplayName(repOf(e), nameMap) === target);
    label = (product ? product + " / " : "") + target;
  } else if (scope && scope.team) {
    first = first.filter((e) => teamOf(repOf(e)) === scope.team);
    label = (product ? product + " / " : "") + scope.team;
  }

  // 進んだ群＝再商談の日程が設定された初回商談。止まった群＝設定されず失注/未設定になったもの。
  const progressed = first.filter((e) => e.next_meeting_scheduled);
  const stalled = first.filter((e) => !e.next_meeting_scheduled && String(e.deal_status || "").startsWith("失注"));

  // 直近を優先し、各群から最大12件の文字起こしを集める
  const pickRecent = (arr) => arr
    .slice()
    .sort((a, b) => new Date(b.event_date) - new Date(a.event_date))
    .slice(0, 12);
  const toSamples = async (arr) => {
    const out = [];
    for (const e of pickRecent(arr)) {
      if (!e.bot_id) continue;
      const m = await getMeeting(e.bot_id).catch(() => null);
      if (m && m.transcript && (Array.isArray(m.transcript) ? m.transcript.length : String(m.transcript).length > 50)) {
        out.push({ company: e.company_name, transcript: m.transcript });
      }
    }
    return out;
  };
  const won = await toSamples(progressed);
  const lost = await toSamples(stalled);
  return { won, lost, label, wonTotal: progressed.length, lostTotal: stalled.length };
}

app.get("/api/report/insights", async (req, res) => {
  try {
    const key = String(req.query.scope || "all");
    const row = await getWinInsight(key);
    if (!row) return res.json({ insight: null });
    res.json({ insight: row.insight, scope_label: row.scope_label, won_count: row.won_count, lost_count: row.lost_count, generated_at: row.generated_at });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 1つのスコープを分析して保存する（手動エンドポイントと自動バッチで共用）。
// 成功時は結果を返し、文字起こし不足なら { skipped: true } を返す。
async function runInsightForScope(scope) {
  const scopeKeyRaw = scope.team ? "team:" + scope.team : scope.owner ? "owner:" + scope.owner : "all";
  const key = (scope.product ? scope.product + "|" : "") + scopeKeyRaw;
  const { won, lost, label, wonTotal, lostTotal } = await gatherInsightGroups(scope);
  if (won.length + lost.length < 3) {
    return { skipped: true, reason: "文字起こし不足", won: won.length, lost: lost.length, key, label };
  }
  const insight = await analyzeWinPatterns(won, lost, label);
  await saveWinInsight(key, label, insight, wonTotal, lostTotal);
  return { insight, key, label, won_count: wonTotal, lost_count: lostTotal, analyzed: { won: won.length, lost: lost.length } };
}

// 全対象（全体／各チーム／各個人 × プロダクト無し・DOC・MOCHICA）をまとめて分析する。
// 平日18:30の自動実行と、手動トリガー(POST /api/report/insights/run-all)で共用。
let insightBatchRunning = false;
async function runAllInsights() {
  if (insightBatchRunning) return { alreadyRunning: true };
  insightBatchRunning = true;
  const started = Date.now();
  const result = { ok: 0, skipped: 0, failed: 0, details: [] };
  try {
    const nameMap = await buildNameMap();
    const teams = [...new Set((await listRepTeams().catch(() => [])).map((t) => (t.team_name || "").trim()).filter(Boolean))];
    const owners = await loadOwnersServer(nameMap);
    // プロダクトが1人でも割り当てられていれば DOC/MOCHICA も回す
    const productMap = await listRepProducts().catch(() => ({}));
    const products = Object.keys(productMap).length ? [null, "DOC", "MOCHICA"] : [null];

    // 対象スコープの一覧を組み立てる
    const scopes = [];
    for (const product of products) {
      scopes.push(product ? { product } : {});                              // 全体
      for (const t of teams) scopes.push(product ? { team: t, product } : { team: t }); // 各チーム
      for (const o of owners) scopes.push(product ? { owner: o, product } : { owner: o }); // 各個人
    }

    console.log(`[insights-batch] 開始：${scopes.length}スコープ`);
    for (const scope of scopes) {
      const tag = (scope.product ? scope.product + "/" : "") + (scope.team ? "team:" + scope.team : scope.owner ? "owner:" + scope.owner : "all");
      try {
        const r = await runInsightForScope(scope);
        if (r.skipped) { result.skipped++; result.details.push({ scope: tag, status: "skip", ...r }); }
        else { result.ok++; result.details.push({ scope: tag, status: "ok", won: r.analyzed.won, lost: r.analyzed.lost }); }
      } catch (e) {
        result.failed++;
        result.details.push({ scope: tag, status: "error", error: e.message });
        console.error(`[insights-batch] ${tag} 失敗:`, e.message);
      }
      // LLMの負荷を抑えるため各スコープ間に少し間隔を空ける
      await new Promise((r) => setTimeout(r, 800));
    }
    const sec = Math.round((Date.now() - started) / 1000);
    console.log(`[insights-batch] 完了：成功${result.ok} / スキップ${result.skipped} / 失敗${result.failed}（${sec}秒）`);
  } finally {
    insightBatchRunning = false;
  }
  return result;
}

// サーバ側で担当者一覧（表示名）を取得。loadOwners のサーバ版。
async function loadOwnersServer(nameMap) {
  const nm = nameMap || (await buildNameMap());
  const events = await listDealEvents({}).catch(() => []);
  const set = new Set();
  for (const e of events) {
    const disp = resolveDisplayName(e.meeting_owner || e.owner, nm);
    if (disp) set.add(disp);
  }
  return [...set];
}

app.post("/api/report/insights", async (req, res) => {
  try {
    const b = req.body || {};
    const scopeKeyRaw = String(b.scope || "all");
    const scope = {};
    if (scopeKeyRaw.startsWith("team:")) scope.team = scopeKeyRaw.slice(5);
    else if (scopeKeyRaw.startsWith("owner:")) scope.owner = scopeKeyRaw.slice(6);
    if (b.product && ["DOC", "MOCHICA"].includes(String(b.product))) scope.product = String(b.product);

    const r = await runInsightForScope(scope);
    if (r.skipped) {
      return res.status(400).json({ error: `分析できる文字起こしが不足しています（進んだ${r.won}件 / 止まった${r.lost}件）。対象範囲を「全体」にするか、商談が増えてからお試しください。` });
    }
    res.json({ insight: r.insight, scope_label: r.label, won_count: r.won_count, lost_count: r.lost_count, generated_at: new Date().toISOString(), analyzed: r.analyzed });
  } catch (e) {
    console.error("[insights]", e);
    res.status(500).json({ error: e.message });
  }
});

// 全対象を今すぐ分析（管理用の手動トリガー）。バックグラウンドで走らせ、すぐ応答を返す。
app.post("/api/report/insights/run-all", async (req, res) => {
  if (insightBatchRunning) return res.json({ started: false, message: "すでに分析が実行中です" });
  runAllInsights().catch((e) => console.error("[insights-batch]", e.message));
  res.json({ started: true, message: "全対象の分析をバックグラウンドで開始しました" });
});

// 日次データ確認：指定日の商談一覧（抽出結果＋要確認フラグ）
app.get("/api/report/daily", async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const owner = req.query.owner || null;
    const events = await listDealEvents({ from: date, to: date, owner });
    const nameMap = await buildNameMap();
    const rows = events.map((e) => ({
      id: e.id, bot_id: e.bot_id, company_name: e.company_name, owner: resolveDisplayName(repOf(e), nameMap),
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


// ===== Feature C: 営業スタイル分析（メンバー別受注率差異要因分析） =====
// 依頼書 6章・7章に対応。フェーズ1では以下の3エンドポイントを提供：
//   - GET  /api/feature-c/tags          … 全タグを取得（フロント側で集計）
//   - GET  /api/feature-c/status        … バックフィル対象件数の確認
//   - POST /api/feature-c/backfill      … 未抽出案件のタグを一括抽出（承認アカウントのみ）

// ===== 業界カテゴライズ（生データ→12カテゴリに正規化） =====
// 営業分析で意味のある粒度: 10〜15カテゴリが最適
const INDUSTRY_RULES = [
  // 優先度高（複合キーワードで誤分類しやすいもの）
  [/協同組合|組合員|NPO|社団|財団|公益|公務|行政|自治体|官公庁|役所|役場/, "公共・団体"],
  [/人材|派遣|紹介|採用|求人|HR|ヘッドハント|アウトソーシング|BPO|コンタクトセンター/, "人材"],
  // IT
  [/IT|ソフト|システム|SaaS|アプリ|情報通信|プログラ|Web|データ|デジタル|テック|LAN|サーバ|コンピュータ|DX|メディア.*業界|インターネット/, "IT・通信"],
  // 製造
  [/製造|メーカー|工場|生産|鉄鋼|金属|機械|化学|電気|電子|自動車|部品|加工|組立|印刷|包装|梱包|ナット|ボルト|ガラス|たばこ|紙工|繊維|プラスチック|ゴム|食品製造/, "製造"],
  // 建設・不動産
  [/建設|建築|土木|施工|工事|住宅|リフォーム|設備|内装|塗装|電工|不動産|賃貸|マンション|ビル.*管理|物件|分譲|太陽光|環境衛生/, "建設・不動産"],
  // 医療・福祉
  [/医療|病院|クリニック|薬局|薬品|製薬|医薬|歯科|診療|調剤|介護|福祉|高齢者|デイサービス|老人|障害|保育|児童|社会福祉/, "医療・福祉"],
  // 小売・卸売
  [/小売|販売|店舗|EC|通販|卸売|商社|スーパー|ドラッグ|化粧品|ショップ|百貨|ホームセンター|宅配|配達|乳製品/, "小売・卸売"],
  // 飲食・サービス
  [/飲食|レストラン|フード|外食|カフェ|コーヒー|給食|弁当|食堂|ケータリング|清掃|クリーニング|ビルメン|オフィス.*サービス|美容|エステ|サロン|理容|レンタル|リース|警備|メンテナンス/, "飲食・サービス"],
  // 物流
  [/物流|運送|運輸|配送|倉庫|ロジ|郵便|トラック|引越|ドライバー/, "物流・運輸"],
  // 金融
  [/金融|銀行|保険|証券|投資|信用|信託|ファイナンス|クレジット|ローン|共済/, "金融・保険"],
  // 教育
  [/教育|学校|塾|スクール|研修|学習|予備校|大学|専門学校/, "教育"],
  // コンサル
  [/コンサル|コンサルティング|アドバイザリー|士業|税理|会計|法律|弁護|行政書士|社労士/, "コンサル・専門"],
  // 広告
  [/広告|マーケティング|PR|プロモーション|メディア|放送|出版|デザイン|映像|エンタメ|芸能|ゲーム/, "広告・メディア"],
  // 農林水産
  [/農業|農産|畜産|林業|水産|漁業|酪農|園芸/, "農林水産"],
  // 観光
  [/ホテル|旅館|宿泊|観光|旅行|レジャー|遊園|アミューズ|スポーツ|フィットネス/, "観光・レジャー"],
  // エネルギー
  [/エネルギー|電力|ガス|水道|石油|鉱業/, "エネルギー・インフラ"],
];

function categorizeIndustry(rawIndustry, rawBusiness) {
  if (!rawIndustry && !rawBusiness) return null;
  const text = (rawIndustry + " " + rawBusiness).trim();
  if (!text || text === "不明") return null;

  // gBizINFOの「229（鉄鋼業）」形式から括弧内を抽出
  const paren = text.match(/（(.+?)）/);
  const searchText = paren ? paren[1] + " " + text : text;

  for (const [re, category] of INDUSTRY_RULES) {
    if (re.test(searchText)) return category;
  }
  // どのルールにも一致しない場合は「その他」
  return "その他";
}

app.get("/api/feature-c/tags", async (req, res) => {
  try {
    const { owner, from, to } = req.query || {};
    const rows = await listDealFeatureTags({ owner, from, to });
    // 企業属性は accounts.profile（案件→会社プロフィール）から引く。
    // enterprise_attributesではなく、gBizINFO/AI取得済みの既存プロフィールを使う設計。
    const deals = await listDeals({});
    const dealCompany = {};
    const dealExcluded = new Set(); // ユーザーフォロー・社内MTGを除外
    for (const d of deals || []) {
      dealCompany[d.deal_id] = d.company_name || "";
    }
    // meetingsのタイトルに【ユ/フォ】【社内MTG】が含まれる場合、
    // そのmeetingが紐づくdeal_idだけを除外（会社名マッチではなく、deal_events経由で正確に特定）
    try {
      const meetings = await listMeetings({ isAdmin: true });
      // bot_id → meeting title のマップ
      const excludedBotIds = new Set();
      for (const m of meetings || []) {
        const t = m.title || "";
        if (/【ユ[/／]フォ】|ユーザーフォロー|【社内MTG】|社内ミーティング/.test(t)) {
          if (m.bot_id) excludedBotIds.add(m.bot_id);
        }
      }
      // deal_eventsからbot_id → deal_idの紐付けを取得
      if (excludedBotIds.size > 0) {
        try {
          const { pool } = await import("./db.js");
          // deal_eventsにbot_idカラムがある場合
          // なければスキップ（エラーを握りつぶす）
        } catch {}
        // シンプルな方法: 除外対象のmeetingのcompany_name/accountでdealを探す
        // ただし同じ会社の通常商談を巻き込まないよう、deal_idが1つしかない場合のみ除外
        for (const m of meetings || []) {
          const t = m.title || "";
          if (!/【ユ[/／]フォ】|ユーザーフォロー|【社内MTG】|社内ミーティング/.test(t)) continue;
          const acc = m.company_name || m.account || "";
          if (!acc) continue;
          // この会社のdeal_idを探す
          const matchingDeals = Object.entries(dealCompany).filter(([, cn]) => cn === acc);
          // 1つしかなければ除外（複数ある場合は通常商談を巻き込むリスクがあるのでスキップ）
          if (matchingDeals.length === 1) {
            dealExcluded.add(matchingDeals[0][0]);
          }
        }
      }
    } catch {}
    // 除外
    const filteredRows = rows.filter(r => !dealExcluded.has(r.deal_id));
    for (const d of deals || []) dealCompany[d.deal_id] = d.company_name || "";
    const accounts = await listAccounts();
    const accountMap = {};
    for (const a of accounts) accountMap[a.key] = a;
    for (const r of filteredRows) {
      const company = dealCompany[r.deal_id] || "";
      r.company_name = company;
      const acc = accountMap[company];
      const prof = (acc && acc.profile) || {};

      // === 業界：プロフィールの複数フィールドから読み取り、カテゴライズ ===
      if (!r.customer_industry || r.customer_industry === "不明") {
        const rawIndustry = prof.industry || "";
        const rawBusiness = prof.business || "";
        r.customer_industry = categorizeIndustry(rawIndustry, rawBusiness);
      } else {
        // 既にタグ抽出済みでも、カテゴライズされていない長文なら正規化
        r.customer_industry = categorizeIndustry(r.customer_industry, "");
      }

      // === 従業員規模：プロフィールの従業員数から変換 ===
      if ((!r.customer_employee_size || r.customer_employee_size === "不明") && prof.employees) {
        const num = parseInt(String(prof.employees).replace(/^約/, "").replace(/[,，]/g, "").replace(/[名人].*$/, ""), 10);
        if (!isNaN(num)) {
          if (num <= 50) r.customer_employee_size = "〜50人";
          else if (num <= 200) r.customer_employee_size = "51〜200人";
          else if (num <= 500) r.customer_employee_size = "201〜500人";
          else if (num <= 1000) r.customer_employee_size = "501〜1000人";
          else r.customer_employee_size = "1001人以上";
        }
      }

      // === 本社地域：プロフィールの住所から都道府県を抽出 ===
      if ((!r.customer_hq_region || r.customer_hq_region === "不明") && prof.location) {
        const m = String(prof.location).match(/^(北海道|東京都|大阪府|京都府|.{2,3}県)/);
        if (m) r.customer_hq_region = m[1];
      }

      // === 採用予定：プロフィールの採用予定から補完 ===
      if ((!r.target_hire_count || r.target_hire_count === "未定") && prof.hiring) {
        const h = String(prof.hiring);
        const num = parseInt(h.replace(/[^0-9]/g, ""), 10);
        if (!isNaN(num)) {
          if (num <= 2) r.target_hire_count = "1〜2名";
          else if (num <= 5) r.target_hire_count = "3〜5名";
          else if (num <= 10) r.target_hire_count = "6〜10名";
          else r.target_hire_count = "11名以上";
        }
      }
    }
    res.json({ tags: filteredRows, total: filteredRows.length });
  } catch (e) {
    console.error("[feature-c/tags]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// フェーズ3: 企業属性エンリッチメントの状態確認
app.get("/api/feature-c/enrich-status", async (req, res) => {
  try {
    const needing = await listCompaniesNeedingEnrichment({ limit: 10000 });
    const attrs = await getEnterpriseAttributesMap();
    res.json({ needing: needing.length, enriched: Object.keys(attrs).length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// フェーズ3: 企業属性エンリッチメントを一括実行（Web検索コストがかかるためチャンク処理）
app.post("/api/feature-c/enrich", async (req, res) => {
  try {
    const limit = Math.min(20, Math.max(1, Number(req.body?.limit || 10)));
    const targets = await listCompaniesNeedingEnrichment({ limit });
    if (!targets.length) return res.json({ ok: true, processed: 0, remaining: 0, message: "対象企業がありません" });
    let processed = 0, failed = 0;
    for (const company of targets) {
      try {
        const r = await enrichCompanyAttributes(company);
        // 見つからなくても「調査済み・不明」として記録し、6ヶ月間は再検索しない（依頼書4.5のキャッシュ設計）
        await upsertEnterpriseAttributes(company, {
          industry: r.industry || "",
          industry_confidence: r.found ? r.industry_confidence : "low",
          recruiting_job_types: r.recruiting_job_types || [],
          job_type_confidence: r.found ? r.job_type_confidence : "low",
        });
        processed++;
      } catch (e) {
        failed++;
        console.error(`[feature-c/enrich] ${company}:`, e.message);
      }
    }
    const remaining = await listCompaniesNeedingEnrichment({ limit: 10000 });
    console.log(`[feature-c/enrich] processed=${processed} failed=${failed} remaining=${remaining.length}`);
    res.json({ ok: true, processed, failed, remaining: remaining.length });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// フェーズ3: 傾向ハイライト（自動示唆コメント）
// サーバー側で主要軸ごとの受注率を集計し、n>=5のセグメントだけをLLMに渡してコメントを生成させる。
let insightsCache = { key: "", at: 0, data: null };
app.get("/api/feature-c/insights", async (req, res) => {
  try {
    const { from, to } = req.query || {};
    const cacheKey = `${from || ""}|${to || ""}`;
    // 10分キャッシュ（LLMコスト削減）
    if (insightsCache.key === cacheKey && Date.now() - insightsCache.at < 10 * 60 * 1000 && insightsCache.data) {
      return res.json({ insights: insightsCache.data, cached: true });
    }
    const rows = await listDealFeatureTags({ from, to });
    if (rows.length < 5) return res.json({ insights: [], message: "データが5件未満のため、傾向コメントは生成しません（統計的に不安定なため）" });

    // 集計：主要な軸ごとに 区分→{won,total} を作り、n>=5だけをテキスト化
    const N_MIN = 5;
    const lines = [];
    const aggregate = (label, getter, opts = {}) => {
      const m = {};
      for (const t of rows) {
        if (opts.excludeLowConfidence && t.tag_confidence === "low") continue;
        const vals = getter(t);
        for (const v of vals) {
          if (!v) continue;
          if (!m[v]) m[v] = { won: 0, total: 0 };
          m[v].total++;
          if (t.result === "受注") m[v].won++;
        }
      }
      const parts = Object.entries(m)
        .filter(([, c]) => c.total >= N_MIN)
        .map(([k, c]) => `${k}: 受注${c.won}/${c.total}件 (${(c.won / c.total * 100).toFixed(0)}%)`);
      if (parts.length) lines.push(`【${label}】` + parts.join(" / "));
    };
    const arr = (v) => Array.isArray(v) ? v : (v ? [v] : []);
    aggregate("従業員規模別", (t) => arr(t.customer_employee_size));
    aggregate("採用人数別", (t) => arr(t.target_hire_count));
    aggregate("新卒中途ニーズ別", (t) => arr(t.hiring_type_need), { excludeLowConfidence: true });
    aggregate("業界別", (t) => arr(t.customer_industry));
    aggregate("訴求内容別", (t) => arr(t.appeal_points_used));
    aggregate("話法の型別", (t) => arr(t.talk_patterns));
    aggregate("懸念対応の型別", (t) => arr(t.objection_handling_style));
    aggregate("ヒアリング到達項目別", (t) => arr(t.discovery_items_covered));
    // ステップ厚み別（クロージングを厚めにした場合等）
    const stageEmph = {};
    for (const t of rows) {
      for (const s of (Array.isArray(t.meeting_stages) ? t.meeting_stages : [])) {
        const key = `${s.step}（${s.emphasis}）`;
        if (!stageEmph[key]) stageEmph[key] = { won: 0, total: 0 };
        stageEmph[key].total++;
        if (t.result === "受注") stageEmph[key].won++;
      }
    }
    const stageParts = Object.entries(stageEmph)
      .filter(([, c]) => c.total >= N_MIN)
      .map(([k, c]) => `${k}: 受注${c.won}/${c.total}件 (${(c.won / c.total * 100).toFixed(0)}%)`);
    if (stageParts.length) lines.push("【商談ステップ×厚み別】" + stageParts.join(" / "));

    if (!lines.length) return res.json({ insights: [], message: "n≥5のセグメントがまだ無いため、傾向コメントは生成しません" });

    const statsText = `対象期間: ${from || "全期間"} 〜 ${to || "現在"}\n全案件数: ${rows.length}件（受注 ${rows.filter((r) => r.result === "受注").length}件）\n\n` + lines.join("\n");
    const insights = await generateFeatureCInsights(statsText);
    insightsCache = { key: cacheKey, at: Date.now(), data: insights };
    res.json({ insights, cached: false });
  } catch (e) {
    console.error("[feature-c/insights]", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/feature-c/status", async (req, res) => {
  try {
    const needing = await listDealsNeedingFeatureTags({ limit: 10000 });
    const existing = await listDealFeatureTags({});
    res.json({
      needing: needing.length,
      existing: existing.length,
      backfill: fcBackfillState,
    });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// バックフィル：20件ずつバックグラウンド処理。
// POST で開始 → 即レスポンス → サーバー内で20件処理。
// 進捗は GET /api/feature-c/status で polling して確認。
let fcBackfillState = { running: false, processed: 0, failed: 0, total: 0 };

app.post("/api/feature-c/backfill", async (req, res) => {
  try {
    if (fcBackfillState.running) {
      return res.json({ ok: true, already_running: true, ...fcBackfillState });
    }
    const limit = Math.min(50, Math.max(1, Number(req.body?.limit || 50)));
    const targets = await listDealsNeedingFeatureTags({ limit });
    if (!targets.length) return res.json({ ok: true, processed: 0, failed: 0, remaining: 0, message: "対象案件がありません" });

    fcBackfillState = { running: true, processed: 0, failed: 0, total: targets.length };
    res.json({ ok: true, started: true, total: targets.length });

    // バックグラウンドで20件処理
    (async () => {
      const toDateStr = (d) => {
        if (!d) return null;
        if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
        const parsed = new Date(d);
        if (isNaN(parsed.getTime())) return null;
        return parsed.toISOString().slice(0, 10);
      };
      for (const t of targets) {
        try {
          const m = await getMeeting(t.bot_id);
          if (!m || !Array.isArray(m.transcript) || !m.transcript.length) {
            fcBackfillState.failed++; continue;
          }
          const dateStr = toDateStr(t.first_meeting_date);
          const tags = await extractFeatureCTags(m.transcript, dateStr || "不明");
          let responseStatus = tags.customer_response_status;
          if (String(t.status || "").startsWith("失注")) responseStatus = "失注";
          await upsertDealFeatureTags(t.deal_id, {
            first_meeting_date: dateStr,
            owner: t.owner || "", team: t.team || "",
            customer_employee_size: tags.customer_employee_size,
            target_hire_count: tags.target_hire_count,
            hiring_type_need: tags.hiring_type_need,
            customer_hq_region: tags.customer_hq_region,
            customer_industry: tags.customer_industry, target_job_type: null,
            customer_response_status: responseStatus,
            decision_maker_present: tags.decision_maker_present,
            competitor_mentioned: tags.competitor_mentioned,
            key_pain_points: tags.key_pain_points,
            appeal_points_used: tags.appeal_points_used,
            talk_patterns: tags.talk_patterns,
            talk_example: tags.talk_example,
            meeting_stages: tags.meeting_stages,
            discovery_items_covered: tags.discovery_items_covered,
            objection_handling_style: tags.objection_handling_style,
            objections_raised: tags.objections_raised,
            tag_confidence: tags.tag_confidence,
            result: String(t.status || "").startsWith("失注") ? "失注" : (t.status === "受注" ? "受注" : "進行中"),
            raw_extraction: tags.raw_llm,
          });
          fcBackfillState.processed++;
        } catch (e) {
          fcBackfillState.failed++;
          console.error(`[feature-c/backfill] ${t.deal_id}:`, e.message);
        }
      }
      console.log(`[feature-c/backfill] 完了: processed=${fcBackfillState.processed} failed=${fcBackfillState.failed}`);
      fcBackfillState.running = false;
    })();
  } catch (e) {
    fcBackfillState.running = false;
    res.status(500).json({ error: e.message });
  }
});

// 未実装だった項目3: customer_response_status の冪等バッチ同期。
// Feature A側で判定修正（失注→進行中、進行中→受注 等）された案件について、
// deal_feature_tags.customer_response_status と result を deals.status に追従させる。
app.post("/api/feature-c/sync-status", async (req, res) => {
  try {
    const tags = await listDealFeatureTags({});
    const deals = await listDeals({});
    const dealMap = {};
    for (const d of deals || []) dealMap[d.deal_id] = d;
    let updated = 0;
    const changes = [];
    for (const t of tags) {
      const d = dealMap[t.deal_id];
      if (!d) continue;
      const currentStatus = d.status || "";
      const expectedResult = currentStatus.startsWith("失注") ? "失注" : (currentStatus === "受注" ? "受注" : "進行中");
      const expectedResponse = currentStatus.startsWith("失注") ? "失注" : t.customer_response_status;
      if (t.result !== expectedResult || t.customer_response_status !== expectedResponse) {
        await upsertDealFeatureTags(t.deal_id, {
          ...t,
          result: expectedResult,
          customer_response_status: expectedResponse,
        });
        updated++;
        if (changes.length < 10) changes.push({ deal_id: t.deal_id, company: t.company_name || d.company_name, before: t.result, after: expectedResult });
      }
    }
    console.log(`[feature-c/sync-status] ${updated}件を同期`);
    res.json({ ok: true, total: tags.length, updated, sample: changes });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// タグを全件リセットして再抽出可能にする
app.post("/api/feature-c/reset-tags", async (req, res) => {
  try {
    const deleted = await clearAllDealFeatureTags();
    console.log(`[feature-c/reset-tags] ${deleted}件を削除`);
    res.json({ ok: true, deleted });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// 会社プロフィール（accounts.profile）から業界をタグテーブルに一括反映
app.post("/api/feature-c/fill-industry", async (req, res) => {
  try {
    const result = await fillIndustryFromProfiles();
    console.log(`[feature-c/fill-industry] ${result.updated}件を反映`);
    res.json({ ok: true, ...result });
  } catch (e) {
    sfErrorResponse(res, e);
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

// 会社プロフィールのリセット。保存済みのプロフィール（gBizINFOで取得した業界・従業員数など）と
// サイトURLを空に戻して、まっさらな状態にする。承認アカウント（中澤・浦林、田中の代理中）のみ実行可能。
app.post("/api/accounts/:key/profile-reset", async (req, res) => {
  try {
    const approver = isStatusApprover(req.impersonatorFrom || req.user);
    if (!approver && !canImpersonate(req.impersonatorFrom)) {
      return res.status(403).json({ error: "会社プロフィールのリセットは、中澤さん・浦林さんのみ可能です。" });
    }
    const key = decodeURIComponent(req.params.key);
    // profile と site_url を明示的に null に。official_name は残す（表示名として使われるため）
    await saveAccount(key, { siteUrl: null, profile: null });
    const updatedBy = req.impersonatorFrom ? `${req.impersonatorFrom} (as ${req.user})` : String(req.user || "");
    console.log(`[profile-reset] by ${updatedBy}: ${key}`);
    res.json({ ok: true });
  } catch (e) {
    console.error("[profile-reset]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 案件の会社名（deals.company_name）を書き換える。承認アカウントのみ。
// 会社名は案件の識別に使われるため、変更後は関連するUI（案件カード・詳細ヘッダ等）が全部更新されるよう
// フロント側で再取得を促す。deal_id は変えない（過去の履歴・イベントとの紐付けを保つため）。
app.put("/api/deals/:deal_id/company-name", async (req, res) => {
  try {
    const dealId = req.params.deal_id;
    const newName = String(req.body?.company_name || "").trim();
    if (!newName) return res.status(400).json({ error: "会社名を入力してください" });
    if (newName.length > 200) return res.status(400).json({ error: "会社名が長すぎます（200文字以内）" });
    const approver = isStatusApprover(req.impersonatorFrom || req.user);
    if (!approver && !canImpersonate(req.impersonatorFrom)) {
      return res.status(403).json({ error: "会社名の変更は、中澤さん・浦林さんのみ可能です。" });
    }
    // 案件が存在するかチェック
    const deals = await listDeals({});
    const deal = (deals || []).find((d) => d.deal_id === dealId);
    if (!deal) return res.status(404).json({ error: "案件が見つかりません" });
    await updateDealCompanyName(dealId, newName);
    const updatedBy = req.impersonatorFrom ? `${req.impersonatorFrom} (as ${req.user})` : String(req.user || "");
    console.log(`[deal-rename] by ${updatedBy}: ${deal.company_name} → ${newName}`);
    res.json({ ok: true, deal_id: dealId, company_name: newName });
  } catch (e) {
    console.error("[deal-rename]", e.message);
    res.status(500).json({ error: e.message });
  }
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
    const fetched = await enrichCompany({ url: primaryUrl, name: key, siteText, urlCount: fullUrls.length, gotCount: siteTexts.length });

    // 既存プロフィール（gBizINFOで確定済みなど）を優先して残し、
    // 空の項目だけを今回取得した値で埋める（＝上書きせず追加）。
    // これにより、gBizINFOの信頼できる情報を保護しつつ、AI取得で足りない部分を補える。
    const existingAcc = await getAccount(key).catch(() => null);
    const existingProfile = (existingAcc && existingAcc.profile) || {};
    const filledFields = [];
    // 対象フィールドを1つずつ検討し、既存が空のときだけ新しい値を採用する
    const mergeField = (field) => {
      if (!fetched[field]) return; // 新規に情報が無ければ何もしない
      const cur = existingProfile[field];
      const isEmpty = cur == null || cur === "" || (typeof cur === "object" && !Object.keys(cur).length);
      if (isEmpty) filledFields.push(field);
    };
    for (const f of ["official_name", "industry", "employees", "hiring", "founded", "location", "business", "capital", "representative", "note"]) mergeField(f);

    // 実際のマージ：既存プロフィールをベースに、空だった項目だけ上書きする
    const profile = { ...existingProfile };
    for (const f of filledFields) profile[f] = fetched[f];
    // 出典タグ：もともと gBizINFO 由来の項目は残し、今回埋めた項目はAI取得と分かるようにする
    if (filledFields.length) {
      profile.enriched_by_ai = { at: new Date().toISOString(), fields: filledFields };
      // gBizINFO由来の場合は source を維持しつつ、AI追記があった旨をnoteに書き足す
      if (profile.source === "gBizINFO") {
        profile.note = (profile.note || "") + ` / サイトURL/AI取得で${filledFields.length}項目を補完（${filledFields.join(", ")}）`;
      } else if (!profile.source) {
        profile.source = "AI"; // 完全新規ならAI取得ソース
      }
    }
    const officialName = profile.official_name || key;
    await saveAccount(key, { siteUrl: primaryUrl || (existingAcc && existingAcc.site_url) || "", officialName, profile });
    res.json({ ok: true, siteUrl: primaryUrl, officialName, profile, siteError, sourcesFetched: siteTexts.length, sourcesRequested: fullUrls.length, filledFields, mergedWith: existingProfile.source || null });
  } catch (e) {
    console.error("[enrich]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// gBizINFO：会社名または法人番号で候補を検索（名寄せはユーザーが候補から選ぶ）
app.get("/api/gbiz/search", async (req, res) => {
  try {
    if (!gbizConfigured()) return res.status(400).json({ error: "gBizINFOのトークンが未設定です（環境変数 GBIZINFO_TOKEN）" });
    // 法人番号（13桁）が指定されていれば、その1社を直接引く
    const number = String(req.query.number || "").replace(/\D/g, "");
    if (number) {
      if (number.length !== 13) return res.status(400).json({ error: "法人番号は13桁で入力してください" });
      try {
        const d = await getCompanyDetail(number);
        return res.json({ candidates: [{
          corporate_number: d.corporate_number,
          name: d.official_name,
          location: d.location || "",
          status: "営業中",
          industry: d.industry || "",
          founded: d.founded || "",
        }] });
      } catch (e) {
        return res.json({ candidates: [] });
      }
    }
    const name = String(req.query.name || "").trim();
    if (!name) return res.status(400).json({ error: "会社名または法人番号を指定してください" });
    // 同名企業を取りこぼさないよう、多めに取得（最大50件）
    const candidates = await searchCompanies(name, 50);
    res.json({ candidates });
  } catch (e) {
    console.error("[gbiz search]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// gBizINFO：選ばれた法人番号で詳細を確定し、従業員数をWeb検索で補完して案件に保存
// gBizINFOの法人番号で詳細を確定し、従業員数をWeb検索で補完して案件に保存する（共通処理）
async function confirmGbizForAccount(key, corporateNumber) {
  const detail = await getCompanyDetail(corporateNumber); // gBizINFOの確定情報
  // 従業員数：gBizに無ければWeb検索で補完
  let employees = detail.employees || "";
  let employeeSource = employees ? { source_name: "gBizINFO", confidence: "high" } : null;
  if (!employees) {
    try {
      const emp = await lookupEmployeeCount(detail.official_name || key, detail.location || "");
      if (emp.found) {
        employees = emp.employees;
        employeeSource = { source_name: emp.source_name || "Web検索", source_url: emp.source_url || "", as_of: emp.as_of || "", confidence: emp.confidence || "low" };
      }
    } catch (e) { console.warn("[gbiz-confirm] 従業員数補完失敗", e.message); }
  }

  // 業界・設立・本社住所：gBizに無いものだけをWeb検索で補完
  let industry = detail.industry || "";
  let founded = detail.founded || "";
  let location = detail.location || "";
  let basicsSource = null;
  const missing = [];
  if (!industry) missing.push("industry");
  if (!founded) missing.push("founded");
  if (!location) missing.push("location");
  if (missing.length) {
    try {
      const b = await lookupCompanyBasics(detail.official_name || key, missing);
      if (b.found) {
        if (!industry && b.industry) industry = b.industry;
        if (!founded && b.founded) founded = b.founded;
        if (!location && b.location) location = b.location;
        basicsSource = { source_name: b.source_name || "Web検索", source_url: b.source_url || "", confidence: b.confidence || "low", filled: missing.filter((m) => b[m]) };
      }
    } catch (e) { console.warn("[gbiz-confirm] 基本情報補完失敗", e.message); }
  }

  const profile = {
    official_name: detail.official_name || key,
    industry,
    employees: employees || "",
    employees_source: employeeSource,
    hiring: "",
    founded,
    location,
    business: detail.business || "",
    capital: detail.capital || "",
    representative: detail.representative || "",
    corporate_number: detail.corporate_number || corporateNumber,
    source: "gBizINFO",
    basics_source: basicsSource, // industry/founded/location をWeb補完した場合の出典
    note: "gBizINFO（法人番号 " + (detail.corporate_number || corporateNumber) + "）で確定。",
  };
  const officialName = profile.official_name;
  await saveAccount(key, { siteUrl: detail.company_url || "", officialName, profile });
  return { officialName, profile };
}

app.post("/api/accounts/:key/gbiz-confirm", async (req, res) => {
  try {
    const key = decodeURIComponent(req.params.key);
    const corporateNumber = String(req.body?.corporate_number || "").trim();
    if (!corporateNumber) return res.status(400).json({ error: "法人番号が必要です" });
    const r = await confirmGbizForAccount(key, corporateNumber);
    res.json({ ok: true, ...r });
  } catch (e) {
    console.error("[gbiz-confirm]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// gBizINFO自動取得：案件を開いたときに呼ばれる。
//  候補が1社（営業中）に絞れたら → 自動で確定して保存
//  複数候補 → 候補を profile.gbiz_pending として保存（カードに「選択が必要」を出すため）
//  0件 → not_found
app.post("/api/accounts/:key/gbiz-auto", async (req, res) => {
  try {
    if (!gbizConfigured()) return res.json({ status: "disabled" });
    const key = decodeURIComponent(req.params.key);
    const name = String(req.body?.name || key).trim();
    const candidates = await searchCompanies(name, 8);
    const open_ = candidates.filter((c) => c.status !== "閉鎖");
    if (open_.length === 1) {
      const r = await confirmGbizForAccount(key, open_[0].corporate_number);
      return res.json({ status: "confirmed", ...r });
    }
    if (open_.length === 0 && candidates.length === 0) {
      return res.json({ status: "not_found" });
    }
    // 複数候補（または営業中0件だが閉鎖のみ）→ 保留として保存
    const pendingProfile = { gbiz_pending: true, gbiz_candidates: candidates };
    await saveAccount(key, { profile: pendingProfile });
    res.json({ status: "needs_pick", candidates });
  } catch (e) {
    console.error("[gbiz-auto]", e.message);
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
    let hasSummary = false;
    if (s.overview) { p.push(`要約: ${s.overview}`); hasSummary = true; }
    if (s.key_points?.length) { p.push(`論点: ${s.key_points.join(" / ")}`); hasSummary = true; }
    if (s.agreements?.length) { p.push(`合意: ${s.agreements.join(" / ")}`); hasSummary = true; }
    if (s.action_items?.length) { p.push(`次アクション: ${s.action_items.join(" / ")}`); hasSummary = true; }
    if (s.customer_concerns?.length) { p.push(`懸念: ${s.customer_concerns.join(" / ")}`); hasSummary = true; }
    const mt = m.metrics || {};
    if (typeof mt.repTalkPct === "number") p.push(`営業トーク比率: ${mt.repTalkPct}%`);
    const a = m.analysis;
    if (a && a.scores) p.push(`スコア ヒア${a.scores.hearing ?? "-"}/提案${a.scores.proposal ?? "-"}/クロ${a.scores.closing ?? "-"}/傾聴${a.scores.listening ?? "-"}`);
    if (a && a.deal_status_reason) p.push(`判定理由: ${a.deal_status_reason}`);
    // 要約が無い商談は、文字起こしの抜粋を入れて読めるようにする
    if (!hasSummary && m.transcriptText) p.push(`文字起こし(抜粋): ${String(m.transcriptText).slice(-2000)}`);
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
    sfErrorResponse(res, e);
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
    sfErrorResponse(res, e);
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
    sfErrorResponse(res, e);
  }
});

// 御礼メールの例文（ラウンド別）の取得・保存
app.get("/api/thanks-examples", async (req, res) => {
  try {
    const s = await getUserSettings(req.user);
    res.json(s.thanksExamples || {});
  } catch (e) {
    sfErrorResponse(res, e);
  }
});
app.put("/api/thanks-examples", async (req, res) => {
  try {
    const examples = req.body && typeof req.body === "object" ? req.body.examples || req.body : {};
    await saveUserSettings(req.user, { thanksExamples: examples });
    res.json({ ok: true });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// ───────────────────────────────────────────────────────────
// 御礼メールのテンプレート（名前を付けて保存し、あとから呼び出す）
// ラウンド別の例文とは別に、「初回向け」「価格の話が出たとき」のような
// 場面ごとの型を持てるようにする。
// ───────────────────────────────────────────────────────────
// 自分のテンプレートと、チームに共有されているテンプレートを合わせて返す。
// 自分のものは直せる。チームのものは、そのまま使えるが直せない。
app.get("/api/mail-templates", async (req, res) => {
  try {
    const s = await getUserSettings(req.user);
    const st = await getSettings().catch(() => ({}));
    const sharedAll = Array.isArray(st.sharedMailTemplates) ? st.sharedMailTemplates : [];
    const isShared = (id) => sharedAll.some((x) =>
      String(x.id) === String(id) && String(x.owner || "").toLowerCase() === String(req.user || "").toLowerCase());

    const mine = (Array.isArray(s.mailTemplates) ? s.mailTemplates : [])
      .map((t) => ({ ...t, mine: true, shared: isShared(t.id) }));

    const shared = sharedAll
      // 自分が共有したものは、自分の一覧に二重に出さない
      .filter((t) => String(t.owner || "").toLowerCase() !== String(req.user || "").toLowerCase())
      .map((t) => ({ ...t, mine: false }));

    res.json({ templates: [...mine, ...shared], me: req.user || "" });
  } catch (e) { sfErrorResponse(res, e); }
});

// テンプレートをチームに共有する／やめる
app.post("/api/mail-templates/share", async (req, res) => {
  try {
    const id = String(req.body?.id || "");
    const on = req.body?.shared === true;
    const s = await getUserSettings(req.user);
    const mine = Array.isArray(s.mailTemplates) ? s.mailTemplates : [];
    const t = mine.find((x) => String(x.id) === id);
    if (!t) return res.status(404).json({ error: "自分のテンプレートに見つかりません" });

    const st = await getSettings().catch(() => ({}));
    const list = (Array.isArray(st.sharedMailTemplates) ? st.sharedMailTemplates : [])
      .filter((x) => !(String(x.id) === id && String(x.owner || "").toLowerCase() === String(req.user).toLowerCase()));
    if (on) {
      const who = await displayNameOf(req.user).catch(() => "") || req.user;
      list.push({ ...t, owner: req.user, ownerName: who, sharedAt: new Date().toISOString() });
    }
    await saveSettings({ sharedMailTemplates: list.slice(0, 60) });
    console.log(`[メール] テンプレート「${t.name}」を${on ? "チームに共有" : "共有から外し"}ました by ${req.user}`);
    res.json({ ok: true, shared: on });
  } catch (e) { sfErrorResponse(res, e); }
});

app.put("/api/mail-templates", async (req, res) => {
  try {
    const raw = Array.isArray(req.body?.templates) ? req.body.templates : [];
    // 名前と本文だけを残す。長すぎるものは切る。
    const list = raw
      .map((t) => ({
        id: String(t.id || Date.now() + Math.random().toString(36).slice(2, 6)).slice(0, 40),
        name: String(t.name || "").trim().slice(0, 60),
        subject: String(t.subject || "").trim().slice(0, 200),
        body: String(t.body || "").slice(0, 6000),
      }))
      .filter((t) => t.name && t.body)
      .slice(0, 30);
    await saveUserSettings(req.user, { mailTemplates: list });

    // 共有しているものは、共有側にも同じ中身を反映する（直したら共有先にも届くように）
    try {
      const st = await getSettings().catch(() => ({}));
      const shared = Array.isArray(st.sharedMailTemplates) ? st.sharedMailTemplates : [];
      let touched = false;
      const next = shared.map((x) => {
        if (String(x.owner || "").toLowerCase() !== String(req.user).toLowerCase()) return x;
        const hit = list.find((t) => String(t.id) === String(x.id));
        if (!hit) return x;
        touched = true;
        return { ...x, name: hit.name, subject: hit.subject, body: hit.body };
      }).filter((x) => {
        // 自分が消したテンプレートは、共有からも外す
        if (String(x.owner || "").toLowerCase() !== String(req.user).toLowerCase()) return true;
        return list.some((t) => String(t.id) === String(x.id));
      });
      if (touched || next.length !== shared.length) await saveSettings({ sharedMailTemplates: next });
    } catch {}

    console.log(`[メール] テンプレートを保存 ${list.length}件 by ${req.user}`);
    res.json({ ok: true, count: list.length });
  } catch (e) { sfErrorResponse(res, e); }
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
    sfErrorResponse(res, e);
  }
});

// 御礼メールの画面を開いたときに使う、軽い情報だけを返す。
// ここではAIを動かさない（開いただけで文面が作られると、待たされるうえに無駄になるため）。
app.get("/api/meetings/:id/thanks-context", async (req, res) => {
  try {
    const m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "見つかりません" });
    const company = String(m.company || m.account || m.title || "")
      .replace(/【[^】]*】/g, "").split(/[／\/|]/)[0].trim();
    let docLinks = [];
    try { docLinks = await docLinksForCompany(company, 5); } catch {}
    const base = String(process.env.PUBLIC_URL || "").replace(/\/+$/, "");
    // 宛先（分かれば画面に入れておく）。
    //   1. この商談に記録されているお客様のアドレス
    //   2. アポの記録・資料URLの宛先（会社名で照合）
    //   3. Gmailのやり取り（会社名 → 担当者名で探し、社外の相手を拾う）
    let to = String(m.client_email || "").trim();
    let toSource = to ? "商談の記録" : "";
    if (!to) {
      const hit = await clientEmailForCompany(company).catch(() => null);
      if (hit) { to = hit.email; toSource = hit.source; }
    }
    if (!to) {
      try {
        const person = (() => {
          const t = String(m.title || "").replace(/【[^】]*】/g, " ");
          const mm = t.match(/([^\s　/／|｜:：・、,]{1,20})\s*(?:様|さま|さん|殿)/);
          return mm ? mm[1] : "";
        })();
        const ready = await gmailReady(req.user).catch(() => ({ ok: false }));
        if (ready.ok) {
          const internal = await internalEmailSet();
          for (const q of [company, person].filter(Boolean)) {
            const threads = await gmailSearchThreads(req.user, q, 5).catch(() => []);
            for (const th of threads) {
              // 送信者が社外なら、その人が相手。自分が送ったメールなら宛先側を見る。
              for (const cand of [parseEmailAddr(th.from), parseEmailAddr(th.to)]) {
                const e = String(cand || "").toLowerCase();
                if (!e || internal.has(e) || isInternalAddress(e)) continue;
                to = cand; toSource = "これまでのメール";
                break;
              }
              if (to) break;
            }
            if (to) break;
          }
        }
      } catch {}
    }
    res.json({
      company,
      round: m.round_no || "",
      subject: `【御礼】${company ? company + "様との" : "本日の"}お打ち合わせについて`,
      to, toSource,
      docLinks: docLinks.map((d) => ({ name: fixMojibake(d.doc_name), url: `${base}/d/${d.slug}` })),
    });
  } catch (e) {
    console.error("[thanks-context]", e.message);
    res.status(502).json({ error: e.message });
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
    // この会社に発行ずみの資料URLを集める。
    // テンプレートに {資料URL} と書いてあれば、あとで差し替える。
    const company = String(m.company || m.title || "").replace(/【[^】]*】/g, "").split(/[／\/|]/)[0].trim();
    let docLinks = [];
    try { docLinks = await docLinksForCompany(company, 5); } catch {}
    const base = String(process.env.PUBLIC_URL || "").replace(/\/+$/, "");
    const docLines = docLinks.map((d) => `${fixMojibake(d.doc_name)}：${base}/d/${d.slug}`).join("\n");

    // テンプレートが選ばれていれば、それを最優先の手本にする。
    // 商談の要約と組み合わせて、その型に沿った文面を作る。
    const tplId = String(req.body?.templateId || "").trim();
    const tpls = Array.isArray(s.mailTemplates) ? s.mailTemplates : [];
    const tpl = tplId ? tpls.find((t) => t.id === tplId) : null;
    let prompt = typeof s.thanksPrompt === "string" ? s.thanksPrompt : "";
    if (tpl) {
      // 型はそのまま使い、埋めるべき箇所だけを商談の内容で置き換える。
      // 文章を作り直させると型が崩れるので、そこを強く止める。
      prompt =
        `次の「テンプレート」を使って、この商談の御礼メールを作ってください。\n\n` +
        `【守ること】\n` +
        `・テンプレートの文章は、一字一句そのまま残してください。言い回しを整えたり、言い換えたりしないでください。\n` +
        `・改行の位置、空行の数、記号（──、■、・など）もそのままにしてください。\n` +
        `・段落を足したり減らしたりしないでください。\n` +
        `・変えてよいのは、次の箇所だけです。\n` +
        `　　1. 【】で囲まれた箇所 … 商談の内容に置き換える（【】の記号ごと消す）\n` +
        `　　2. 何も書かれていない空欄 … 商談の内容で埋める\n` +
        `　　3. 宛名・会社名・担当者名 … 今回の相手に合わせる\n` +
        `・{資料URL} {会社名} {担当者名} {自分の名前} は、その文字のまま残してください（あとで差し替えます）。\n` +
        `・商談で話に出ていないことは書かないでください。埋められない箇所は、その部分ごと削ってください。\n` +
        `・テンプレートの本文で、今回の相手に合わない言い回しがあれば、その文だけを今回の商談に合う内容に書き換えてください。\n` +
        `　（例：テンプレートが「採用の課題」で今回が「定着の課題」なら、その一文だけ差し替える。前後の文や構成はそのまま。）\n\n` +
        `【テンプレート】\n${tpl.body}\n\n` +
        (prompt ? `【そのほかの指示】\n${prompt}` : "");
    }

    const result = await generateThanks({
      round,
      // テンプレートを使うときは、そちらを手本にするので例文は渡さない
      examples: tpl ? [] : examples,
      summaryText,
      repName: m.owner_name || m.rep_name,
      customer,
      prompt,
    });
    // 件名は、テンプレートに書かれていればそちらを優先する
    if (tpl && tpl.subject) result.subject = tpl.subject;

    // 差し込み語を、実際の値に置き換える。
    // 資料URLは、誰が何ページ見たかを追えるものになる。
    const fill = (v) => String(v || "")
      .replace(/\{資料URL\}/g, docLines || "（この会社向けの資料URLがまだありません）")
      .replace(/\{会社名\}/g, company)
      .replace(/\{担当者名\}/g, customer || "")
      .replace(/\{自分の名前\}/g, m.owner_name || m.rep_name || "");
    result.body = fill(result.body);
    result.subject = fill(result.subject);

    res.json({ ...result, round, exampleCount: examples.length,
               templateName: tpl ? tpl.name : "",
               docLinks: docLinks.map((d) => ({ name: fixMojibake(d.doc_name), url: `${base}/d/${d.slug}` })) });
  } catch (e) {
    console.error("[thanks]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// 商談の会社名などから、Gmailの過去のやり取りを検索して一覧を返す
app.get("/api/meetings/:id/gmail-threads", async (req, res) => {
  try {
    const out = { connected: false, threads: [] };
    out.connected = await gcalConnected(req.user);
    if (!out.connected) return res.json({ ...out, reason: "未連携" });
    const ready = await gmailReady(req.user);
    if (!ready.ok) return res.json({ ...out, needScope: true, gmailReason: ready.reason, gmailDetail: ready.detail || "", projectHint: ready.projectHint || "" });
    const m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "見つかりません" });
    // 会社名で探し、見つからなければ商談名の担当者名でも探す
    const company = (m.account || companyFromTitle(m.title || "") || "").trim();
    const person = (() => {
      const t = String(m.title || "").replace(/【[^】]*】/g, " ");
      const mm = t.match(/([^\s　/／|｜:：・、,]{1,20})\s*(?:様|さま|さん|殿)/);
      return mm ? mm[1] : "";
    })();
    const asked = String(req.query.q || "").trim();
    const words = asked ? [asked] : [company, person].filter(Boolean);
    if (!words.length) return res.json({ ...out, needQuery: true });

    let threads = [], query = words[0];
    for (const w of words) {
      threads = await gmailSearchThreads(req.user, w, 8);
      query = w;
      if (threads.length) break;
    }
    res.json({ ...out, query, company, person, threads });
  } catch (e) {
    if (e.needScope) return res.json({ connected: true, threads: [], needScope: true });
    console.error("[gmail-threads]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// 御礼メールをGmailの下書きとして保存する。
// 画面から「新規作成」「返信（返信先のメールを選ぶ）」を指定できる。
// 指定が無いときは、これまでのやり取りがあればその返信として、無ければ新規で作る（従来どおり）。
app.post("/api/meetings/:id/thanks-gmail-draft", async (req, res) => {
  try {
    const m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "見つかりません" });
    if (!(await gcalConnected(req.user))) return res.status(400).json({ error: "Googleが連携されていません（設定から連携してください）" });
    const ready = await gmailReady(req.user);
    if (!ready.ok) return res.status(400).json({ error: "Gmailが使えません（" + (ready.detail || ready.reason) + "）", needScope: true });

    // 画面からの指定（new＝新規／reply＝返信）。無ければ auto。
    const wantMode = String((req.body && req.body.mode) || "auto");
    const wantThreadId = String((req.body && req.body.threadId) || "");
    if (wantMode === "reply" && !wantThreadId) {
      return res.status(400).json({ error: "返信するメールを選んでください" });
    }

    // 相手を探すための言葉：会社名 → 商談名から取り出した担当者名
    const company = (m.account || companyFromTitle(m.title || "") || "").trim();
    const person = (() => {
      const t = String(m.title || "").replace(/【[^】]*】/g, " ");
      const mm = t.match(/([^\s　/／|｜:：・、,]{1,20})\s*(?:様|さま|さん|殿)/);
      return mm ? mm[1] : "";
    })();

    // 新規と指定されたときは、過去のやり取りは探さない（そのまま新規メールにする）
    // 返信先が指定されたときは、そのメールだけを見る
    let threads = [];
    if (wantMode === "reply") {
      threads = [{ threadId: wantThreadId }];
    } else if (wantMode !== "new") {
      for (const q of [company, person].filter(Boolean)) {
        try { threads = await gmailSearchThreads(req.user, q, 5); } catch {}
        if (threads.length) break;
      }
    }

    const myEmail = (await getPrimaryEmail(req.user)) || "";
    const sm = m.summary || {};
    let summaryText = sm.overview ? sm.overview + "\n" : "";
    for (const [lab, key] of [["合意", "agreements"], ["次アクション", "action_items"], ["懸念", "customer_concerns"]]) {
      if (Array.isArray(sm[key]) && sm[key].length) summaryText += `\n[${lab}]\n` + sm[key].map((x) => "・" + x).join("\n");
    }
    const st = await getUserSettings(m.owner);
    const round = m.round_no || "";
    const all = st.thanksExamples || {};
    let examples = Array.isArray(all[String(round)]) ? all[String(round)] : [];
    if (!examples.length) for (const k of Object.keys(all)) { if (Array.isArray(all[k]) && all[k].length) { examples = all[k]; break; } }

    let to = "", subject = "", body = "", threadId = "", inReplyTo = "", references = "", replied = false;

    // 画面で文面ができているときは、AIで作り直さない（そのまま下書きにする）
    const hasText = !!(req.body && req.body.body);

    if (threads.length) {
      // 返信として作る（返信先が指定されていればそのメール、無ければいちばん新しいやり取り）
      replied = true;
      threadId = threads[0].threadId;
      const thread = await gmailGetThread(req.user, threadId);
      const msgs = thread.messages || [];
      const last = msgs[msgs.length - 1] || {};
      const fromAddr = parseEmailAddr(last.from);
      to = fromAddr && fromAddr !== myEmail ? fromAddr : parseEmailAddr(last.to);
      if (hasText) {
        subject = last.subject || "";
      } else {
        const threadText = msgs.map((x) => `--- ${x.date} / ${x.from}\n${(x.body || "").slice(0, 2000)}`).join("\n\n").slice(-8000);
        const prompt =
          (typeof st.thanksPrompt === "string" ? st.thanksPrompt + "\n\n" : "") +
          "以下は、この商談相手との過去のメールのやり取りです。最後のメールに続く形で、商談のお礼と次のアクションを伝える返信を日本語で作ってください。" +
          "やり取りの流れと敬称・文体を合わせ、簡潔にまとめてください。\n\n【過去のやり取り】\n" + threadText;
        const r = await generateThanks({ round, examples, summaryText: summaryText || "（要約なし）", repName: m.owner_name || m.rep_name, customer: person, prompt });
        body = r.body || "";
        subject = last.subject || r.subject || "";
      }
      if (subject && !/^re:/i.test(subject)) subject = "Re: " + subject;
      inReplyTo = last.messageIdHeader || "";
      references = [last.references, last.messageIdHeader].filter(Boolean).join(" ").trim();
    } else if (!hasText) {
      const r = await generateThanks({
        round, examples, summaryText: summaryText || "（要約なし）",
        repName: m.owner_name || m.rep_name, customer: person,
        prompt: typeof st.thanksPrompt === "string" ? st.thanksPrompt : "",
      });
      body = r.body || "";
      subject = r.subject || `【御礼】${company || "本日"}のお打ち合わせについて`;
    }

    if (req.body && req.body.body) body = String(req.body.body);
    if (req.body && req.body.subject) subject = String(req.body.subject);
    if (req.body && req.body.to) to = String(req.body.to);
    // 新規メールのときは宛先が空になりがちなので、分かる範囲で補う
    if (!to) to = String(m.client_email || "").trim();
    if (!to) {
      const hit = await clientEmailForCompany(company).catch(() => null);
      if (hit) to = hit.email;
    }
    if (!body) return res.status(502).json({ error: "文面を作れませんでした" });

    const draft = await gmailCreateDraft(req.user, { to, subject, bodyText: body, threadId, inReplyTo, references });
    const msgId = (draft && draft.message && draft.message.id) || "";
    res.json({
      ok: true,
      replied,
      to,
      subject,
      body,
      threadCount: threads.length,
      draftId: (draft && draft.id) || "",
      url: msgId ? `https://mail.google.com/mail/u/0/#drafts?compose=${msgId}` : "https://mail.google.com/mail/u/0/#drafts",
    });
  } catch (e) {
    if (e.needScope) return res.status(400).json({ error: "Gmailの権限が足りません。設定から連携し直してください。", needScope: true });
    console.error("[thanks-gmail-draft]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// 選んだスレッドの内容＋商談要約から、返信の下書きを作る
app.post("/api/meetings/:id/gmail-reply-draft", async (req, res) => {
  try {
    const threadId = (req.body && req.body.threadId) || "";
    if (!threadId) return res.status(400).json({ error: "threadId が必要です" });
    const m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "見つかりません" });

    const thread = await gmailGetThread(req.user, threadId);
    const msgs = thread.messages || [];
    const last = msgs[msgs.length - 1] || {};

    const myEmail = (await getPrimaryEmail(req.user)) || "";
    const fromAddr = parseEmailAddr(last.from);
    const toAddr = fromAddr && fromAddr !== myEmail ? fromAddr : parseEmailAddr(last.to);

    const threadText = msgs
      .map((x) => `--- ${x.date} / ${x.from}\n${(x.body || "").slice(0, 2500)}`)
      .join("\n\n")
      .slice(-9000);

    const sm = m.summary || {};
    let summaryText = sm.overview ? sm.overview + "\n" : "";
    for (const [lab, key] of [["合意", "agreements"], ["次アクション", "action_items"], ["懸念", "customer_concerns"]]) {
      if (Array.isArray(sm[key]) && sm[key].length) summaryText += `\n[${lab}]\n` + sm[key].map((x) => "・" + x).join("\n");
    }

    const s = await getUserSettings(m.owner);
    const round = m.round_no || (req.body && req.body.round) || "";
    const replyPrompt =
      (typeof s.thanksPrompt === "string" ? s.thanksPrompt + "\n\n" : "") +
      "以下は、この商談相手との過去のメールのやり取りです。最後のメールに対する、自然で丁寧な日本語の返信を作成してください。" +
      "商談の要約もふまえ、次のアクションや相手の懸念に触れつつ、簡潔にまとめてください。\n\n" +
      "【過去のメールのやり取り】\n" + threadText;

    const result = await generateThanks({
      round,
      examples: [],
      summaryText: summaryText || "（要約なし）",
      repName: m.owner_name || m.rep_name,
      customer: "",
      prompt: replyPrompt,
    });

    let subject = last.subject || result.subject || "";
    if (subject && !/^re:/i.test(subject)) subject = "Re: " + subject;

    res.json({
      ok: true,
      to: toAddr,
      subject,
      body: result.body || "",
      threadId,
      inReplyTo: last.messageIdHeader || "",
      references: [last.references, last.messageIdHeader].filter(Boolean).join(" ").trim(),
    });
  } catch (e) {
    if (e.needScope) return res.json({ ok: false, needScope: true });
    console.error("[gmail-reply-draft]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// kinbotからGmailの「下書き」に保存する（送信はしない・営業がGmailで確認して送る）
app.post("/api/gmail/draft", async (req, res) => {
  try {
    const { to, subject, body, threadId, inReplyTo, references } = req.body || {};
    if (!to || !body) return res.status(400).json({ error: "宛先と本文が必要です" });
    const result = await gmailCreateDraft(req.user, {
      to,
      subject: subject || "",
      bodyText: body,
      threadId: threadId || null,
      inReplyTo: inReplyTo || null,
      references: references || null,
    });
    res.json({ ok: true, id: result.id });
  } catch (e) {
    if (e.needScope) return res.status(403).json({ error: "Gmailの下書き作成権限が不足しています。Googleを再連携してください。", needScope: true });
    console.error("[gmail-draft]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// kinbotからGmailで送信する
app.post("/api/gmail/send", async (req, res) => {
  try {
    const { to, subject, body, threadId, inReplyTo, references } = req.body || {};
    if (!to || !body) return res.status(400).json({ error: "宛先と本文が必要です" });
    // 送った本人にも控えを届ける（Bccなのでお客様には見えない）。
    // 自分の受信箱に残るので、ちゃんと送れたかが分かる。
    const cfg = await getApoMailConfig().catch(() => ({ copyToSelf: true }));
    const result = await gmailSend(req.user, {
      to,
      subject: subject || "",
      bodyText: body,
      threadId: threadId || null,
      inReplyTo: inReplyTo || null,
      references: references || null,
      bcc: cfg.copyToSelf !== false ? req.user : "",
    });
    res.json({ ok: true, id: result.id, threadId: result.threadId });
  } catch (e) {
    if (e.needScope) return res.status(403).json({ error: "Gmailの権限が不足しています。Googleを再連携してください。", needScope: true });
    console.error("[gmail-send]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// 商談を削除
// 絞り込んだ商談全体を横断して、傾向・スコア理由を分析（結果はキャッシュ）
const PHASE_LABELS = { "01": "初回商談", "02": "有効商談", "03": "担当者合意", "04": "企画決定者合意" };


// --- 商談セッション開始：会議にBotを送り込む ---
// Zoom URLからミーティングIDを取り出す（カレンダー予定との突合用）
function zoomMeetingId(url) {
  const s = String(url || "");
  const m = s.match(/\/j\/(\d+)/) || s.match(/[?&](?:confno|meetingId)=(\d+)/) || s.match(/zoom\.us\/(?:my\/)?(\d{9,})/);
  return m ? m[1] : "";
}

// 録画開始時刻に近いカレンダー予定から商談名を推測する。
// 1) Zoom URL（ミーティングID）が一致する予定を最優先、2) 開始時刻が最も近い予定（前後45分以内）。
// カレンダーから該当の予定を探す（ZoomのミーティングID一致 → 時刻がいちばん近いもの）
async function findCalendarEventFor(owner, meetingUrl, at = new Date()) {
  try {
    const atMs = at.getTime();
    const timeMin = new Date(atMs - 3 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(atMs + 3 * 60 * 60 * 1000).toISOString();
    const evs = await listCalendarEvents(owner, "primary", { timeMin, timeMax });
    const timed = (evs || []).filter((e) => !e.allDay && e.start);
    if (!timed.length) return null;
    const zid = zoomMeetingId(meetingUrl);
    if (zid) {
      const byUrl = timed.find((e) => zoomMeetingId(e.url) === zid);
      if (byUrl) return byUrl;
    }
    let best = null, bestDist = Infinity;
    for (const e of timed) {
      const s = new Date(e.start).getTime();
      const en = e.end ? new Date(e.end).getTime() : s + 60 * 60 * 1000;
      const dist = atMs >= s && atMs <= en ? 0 : Math.min(Math.abs(s - atMs), Math.abs(en - atMs));
      if (dist < bestDist) { bestDist = dist; best = e; }
    }
    return best && bestDist <= 45 * 60 * 1000 ? best : null;
  } catch (e) {
    console.error("[cal-title]", e.message);
    return null;
  }
}

// 商談名・営業担当が空（または「無題」）のとき、カレンダーの予定タイトルと主催者で埋める
const BAD_TITLE = (t) => !String(t || "").trim() || /^[（(]?無題[）)]?$/.test(String(t).trim());
// 誰のカレンダーか分からないときは、Google連携している全員のカレンダーから探す
async function findCalendarEventAnyAccount(meetingUrl, at) {
  let accounts = [];
  try { accounts = await listGoogleAccounts(); } catch { return null; }
  for (const a of (accounts || []).slice(0, 20)) {
    const own = a.owner || a.email || "";
    if (!own) continue;
    const ev = await findCalendarEventFor(own, meetingUrl, at);
    if (ev) return { ev, owner: own };
  }
  return null;
}

async function repairMeetingMeta(botId) {
  try {
    const m = await getMeeting(botId);
    if (!m) return;
    const needTitle = BAD_TITLE(m.title);
    const needRep = !String(m.rep_name || "").trim();
    if (!needTitle && !needRep) return;
    let owner = m.owner || "";
    const at = m.created_at ? new Date(m.created_at) : new Date();

    // 会議URLが記録されていなければRecallから取り直す
    let url = m.meeting_url || "";
    if (!url) {
      try {
        const bot = await getBot(botId);
        url = (bot && (bot.meeting_url?.meeting_id ? bot.meeting_url.platform_url || "" : bot.meeting_url)) || "";
        if (typeof url === "object") url = url.platform_url || url.url || "";
      } catch {}
    }

    let ev = null;
    if (owner) ev = await findCalendarEventFor(owner, url, at);
    if (!ev) {
      const hit = await findCalendarEventAnyAccount(url, at);
      if (hit) { ev = hit.ev; if (!owner) owner = hit.owner; }
    }
    if (!owner && !ev) return;

    let title = m.title || "";
    let repName = m.rep_name || "";
    let newOwner = "";
    if (needTitle && ev && String(ev.title || "").trim()) title = String(ev.title).trim();
    if (needRep) {
      const org = String((ev && (ev.organizer || ev.creator)) || "").toLowerCase();
      if (org) {
        let u = null;
        try { u = await dbGetUser(org); } catch {}
        if (u) { repName = u.name || u.email || org; newOwner = u.email || ""; }
        else repName = org;
      }
      if (!repName && owner) repName = await getDisplayName(owner).catch(() => "") || "";
    }
    // それでも商談名が決まらなければ、担当者名と日時で埋める（「無題」で残さない）
    if (BAD_TITLE(title)) {
      const d = at;
      title = `${repName || owner}の商談 ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
    if (title !== m.title) await setMeetingTitle(botId, title);
    const ownerToSet = newOwner || (!m.owner && owner ? owner : "");
    if (repName !== m.rep_name || ownerToSet) {
      await setMeetingOwner(botId, { repName, ...(ownerToSet ? { owner: ownerToSet } : {}) });
    }
    const s = getSession(botId);
    if (s && s.enrich) s.enrich({ title, repName });
    console.log(`[meta補完] ${botId} 商談名「${title}」担当:${repName}`);
  } catch (e) {
    console.error("[meta補完]", e.message);
  }
}

// 「無題」「担当なし」のまま残っている最近の商談を、まとめてカレンダーから補完する
async function repairRecentMeetings(limit = 20) {
  let rows = [];
  try { rows = await listRecentMeetingHeads({ days: 45, limit: 200 }); } catch { return; }
  const targets = rows.filter((r) => BAD_TITLE(r.title) || !String(r.rep_name || "").trim()).slice(0, limit);
  if (!targets.length) return;
  console.log(`[meta補完] ${targets.length}件の商談をカレンダーから補完します`);
  for (const r of targets) {
    await repairMeetingMeta(r.bot_id);
    await new Promise((ok) => setTimeout(ok, 400)); // Google APIへの負荷をさげる
  }
}

async function guessTitleFromCalendar(owner, meetingUrl, at = new Date()) {
  const e = await findCalendarEventFor(owner, meetingUrl, at);
  return e && String(e.title || "").trim() ? String(e.title).trim() : "";
}

// ボットを会議へ送り、セッションを開始する共通処理（手動開始・Zoom自動入室で共用）
async function startBotSession(owner, meetingUrl, { title = "", repName = "", languageCode = "", kasasagi = false } = {}) {
  const cfg = await resolveConfig(owner);
  let sessionTitle = (title || "").trim();
  let autoTitled = false;
  if (!sessionTitle) {
    sessionTitle = await guessTitleFromCalendar(owner, meetingUrl, new Date());
    autoTitled = !!sessionTitle;
  }
  let mux = null;
  let muxError = "";
  // ライブ配信は常に用意する（Cloudflareは見られた分だけの課金なので、流しっぱなしでも費用は増えません）
  // 止めたいときは LIVE_STREAM_ENABLED=0
  //
  // ここで作れないと、あとから配信できない（Recallに渡す送り先は入室時にしか決められないため）。
  // だから、作れなかったときは必ず理由を残す。
  if (process.env.LIVE_STREAM_ENABLED === "0") {
    muxError = "ライブ配信が止められています（LIVE_STREAM_ENABLED=0）";
    console.warn("[live] " + muxError);
  } else if (!liveConfigured()) {
    const info = liveInfo();
    muxError = info.provider === "cloudflare"
      ? "配信の鍵がありません（CF_ACCOUNT_ID / CF_STREAM_TOKEN をRailwayに設定してください）"
      : "配信の設定がありません（MUXの鍵を設定してください）";
    console.warn("[live] " + muxError);
  } else {
    try {
      mux = await createLiveStream();
      if (!mux?.playbackId) muxError = "配信枠は作れましたが、再生用のIDが返ってきませんでした";
      else console.log(`[live] 配信枠を用意しました（${mux.playbackId}）`);
    } catch (e) {
      muxError = e.message;
      console.error("[live] 配信枠を作れませんでした:", e.message);
    }
  }
  if (muxError) {
    // 開発メモにも残す（あとで気づけるように）
    devNote({
      key: errKey("配信枠", muxError), kind: "error",
      title: `ライブ配信の枠を作れません：${String(muxError).slice(0, 120)}`,
      source: "ライブ配信",
    }).catch(() => {});
  }
  // かささぎを使う商談は、喋れる作りのBotにして、スライドを映すページも渡す。
  // 「常にかささぎを使えるようにする」場合は KASASAGI_ALWAYS=1 を設定する。
  const wantKasasagi = kasasagi === true || process.env.KASASAGI_ALWAYS === "1";
  const botId = await createBot({
    meetingUrl,
    webhookUrl: `${PUBLIC_URL}/api/recall/webhook`,
    languageCode: languageCode || cfg.languageCode,
    botName: cfg.botName,
    provider: cfg.transcribeProvider,
    deepgramModel: cfg.deepgramModel,
    rtmpUrl: mux?.rtmpUrl || null,
    speak: wantKasasagi,
    faceUrl: wantKasasagi && PUBLIC_URL ? `${PUBLIC_URL}/kasasagi-face.html` : null,
  });
  const displayName = await getDisplayName(owner);
  createSession(botId, {
    repName: repName || cfg.repName || displayName || owner || "",
    meetingUrl,
    title: sessionTitle || "",
    owner: owner || "",
    analyzeIntervalMs: cfg.analyzeIntervalMs,
    muxPlaybackId: mux?.playbackId || "",
    muxLiveStreamId: mux?.liveStreamId || "",
    liveRtmpUrl: mux?.rtmpUrl || "",
    muxError,
  });
  return { sessionId: botId, muxReady: !!mux?.playbackId, muxError, autoTitle: autoTitled ? sessionTitle : "" };
}

// 自動入室（カレンダー/Webhook）の商談名・営業担当を決める。空にならないようにする。
async function autoJoinMeta(owner, ev, r) {
  const now = new Date();
  const dateStr = `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const evTitle = ((ev && ev.title) || "").trim();
  const label = ((r && r.label) || "").trim();
  // 商談名：Googleカレンダーの予定タイトルを最優先
  const title = evTitle || label || `自動記録 ${dateStr}`;
  // 営業担当：カレンダーを連携しているユーザー（owner）→ 予定の主催者 → 登録リンク名
  let repName = "";
  const own = (owner || "").trim();
  if (own) repName = await getDisplayName(own).catch(() => "");
  if (!repName || repName === own) {
    const org = (ev && (ev.organizer || ev.creator)) || "";
    if (org) {
      const byOrg = await getDisplayName(org).catch(() => "");
      if (byOrg && byOrg !== org) repName = byOrg;
      else if (!repName) repName = own || org;
    }
  }
  if (!repName) repName = label;
  return { title, repName };
}

app.post("/api/sessions", async (req, res) => {
  const { meetingUrl, repName, languageCode, title } = req.body || {};
  if (!meetingUrl) return res.status(400).json({ error: "meetingUrl が必要です" });
  if (!PUBLIC_URL) return res.status(500).json({ error: "PUBLIC_URL が未設定です" });
  try {
    const out = await startBotSession(req.user, meetingUrl, { title, repName, languageCode, kasasagi: req.body?.kasasagi === true });
    res.json(out);
  } catch (e) {
    console.error("[sessions]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// ===== Zoom：登録URLの会議が始まったら自動入室 =====
const ZOOM_WEBHOOK_SECRET = process.env.ZOOM_WEBHOOK_SECRET_TOKEN || "";
function zoomConfigured() { return !!ZOOM_WEBHOOK_SECRET; }

// ZoomからのWebhook（会議開始通知）を受ける
app.post("/api/zoom/webhook", async (req, res) => {
  const body = req.body || {};
  // 1) エンドポイント検証（Zoomが登録時に送るチャレンジに応答する）
  if (body.event === "endpoint.url_validation") {
    if (!ZOOM_WEBHOOK_SECRET) return res.status(500).json({ error: "ZOOM_WEBHOOK_SECRET_TOKEN 未設定" });
    const plainToken = (body.payload && body.payload.plainToken) || "";
    const encryptedToken = crypto.createHmac("sha256", ZOOM_WEBHOOK_SECRET).update(String(plainToken)).digest("hex");
    return res.json({ plainToken, encryptedToken });
  }
  // 2) 署名検証（設定があれば）
  if (ZOOM_WEBHOOK_SECRET) {
    try {
      const ts = req.headers["x-zm-request-timestamp"];
      const raw = req.rawBody ? req.rawBody.toString("utf8") : JSON.stringify(body);
      const hash = crypto.createHmac("sha256", ZOOM_WEBHOOK_SECRET).update(`v0:${ts}:${raw}`).digest("hex");
      if (`v0=${hash}` !== (req.headers["x-zm-signature"] || "")) {
        console.warn("[zoom] 署名不一致");
        return res.status(401).end();
      }
    } catch (e) {
      console.error("[zoom] 署名検証", e.message);
      return res.status(401).end();
    }
  }
  // Zoomは3秒以内の200応答を期待するので、先に返してから処理する
  res.status(200).json({ ok: true });
  if (body.event !== "meeting.started") return;
  if (!CALENDAR_AUTO_JOIN) return; // 自動入室オフのときは何もしない（手動入室のみ）
  try {
    const obj = (body.payload && body.payload.object) || {};
    const meetingId = String(obj.id || "").replace(/\s/g, "");
    if (!meetingId || !PUBLIC_URL) return;
    const rows = await findAutoJoinByMeetingId(meetingId);
    for (const row of rows) {
      try {
        // 直近5分以内に入室済みなら二重入室を防ぐ
        if (row.last_joined_at && Date.now() - new Date(row.last_joined_at).getTime() < 5 * 60 * 1000) continue;
        const meta = await autoJoinMeta(row.owner, { title: obj.topic || "" }, row);
        await startBotSession(row.owner, row.url, { title: meta.title, repName: meta.repName });
        await touchAutoJoin(row.id);
        console.log(`[zoom] 自動入室: meeting ${meetingId} → ${row.owner} / 担当:${meta.repName}`);
      } catch (e) {
        console.error("[zoom] 自動入室失敗", e.message);
      }
    }
  } catch (e) {
    console.error("[zoom] webhook処理", e.message);
  }
});

// 自動入室するZoom URLの登録一覧
app.get("/api/auto-join", async (req, res) => {
  try {
    res.json({
      items: await listAutoJoin(req.user),
      zoomConfigured: zoomConfigured(),
      webhookUrl: PUBLIC_URL ? `${PUBLIC_URL}/api/zoom/webhook` : "",
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// URLを登録
app.post("/api/auto-join", async (req, res) => {
  try {
    const u = String((req.body && req.body.url) || "").trim();
    if (!u) return res.status(400).json({ error: "Zoom URLを入力してください" });
    const meetingId = zoomMeetingId(u);
    if (!meetingId) return res.status(400).json({ error: "URLからZoomのミーティングIDを読み取れませんでした。招待URL（https://～/j/1234567890...）を貼ってください。" });
    const id = await addAutoJoin(req.user, { meetingId, url: u, label: String((req.body && req.body.label) || "").trim() });
    res.json({ ok: true, id, meetingId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// 登録を削除
app.delete("/api/auto-join/:id", async (req, res) => {
  try { await removeAutoJoin(req.user, req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
// 有効／無効・カレンダー入室モードの切り替え
app.put("/api/auto-join/:id", async (req, res) => {
  try {
    const b = req.body || {};
    if ("enabled" in b) await setAutoJoinEnabled(req.user, req.params.id, !!b.enabled);
    if ("calendar_any" in b) await setAutoJoinCalendarAny(req.user, req.params.id, !!b.calendar_any);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// 自動入室の診断：登録URLごとに、カレンダー連携の有無・一致する直近の予定・今入室対象かを返す
// ホーム用：今日のカレンダー予定（これからの商談）を返す
// 会議URLの使用回数を数える（数分キャッシュ）
let _urlUsage = { at: 0, rows: [] };
function zoomIdOf(url) {
  const u = String(url || "");
  return (u.match(/\/j\/(\d{9,})/) || u.match(/\/(\d{9,})/) || [])[1] || "";
}
async function meetingUrlUsage(owner) {
  if (Date.now() - _urlUsage.at > 5 * 60 * 1000) {
    _urlUsage = { at: Date.now(), rows: await recentMeetingUrls(600).catch(() => []) };
  }
  const me = String(owner || "").toLowerCase();
  const map = new Map();
  for (const r of _urlUsage.rows) {
    const id = zoomIdOf(r.meeting_url);
    if (!id) continue;
    const v = map.get(id) || { mine: 0, all: 0 };
    v.all++;
    if (me && String(r.owner || "").toLowerCase() === me) v.mine++;
    map.set(id, v);
  }
  return map;
}

app.get("/api/calendar/today", async (req, res) => {
  try {
    // 日付指定（?date=YYYY-MM-DD）。未指定なら日本時間の今日。
    const jstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const q = String((req.query && req.query.date) || "").trim();
    const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : jstToday;
    // 日本時間の 00:00〜23:59 を境界にする（サーバーのタイムゾーンに依存しない）
    const start = new Date(`${dateStr}T00:00:00+09:00`);
    const end = new Date(`${dateStr}T23:59:59.999+09:00`);
    let events = [];
    try {
      events = await listCalendarEvents(req.user, "primary", { timeMin: start.toISOString(), timeMax: end.toISOString() });
    } catch (e) {
      return res.json({ connected: false, date: dateStr, autoJoin: CALENDAR_AUTO_JOIN, events: [] });
    }
    // 自分が登録している自動入室ルーム（自社のZoom部屋）は、候補の優先度を上げる
    let myRooms = [];
    try { myRooms = (await listAutoJoin(req.user)) || []; } catch {}
    const roomIds = new Set(myRooms.map((r) => String(r.meeting_id || "")).filter(Boolean));
    // これまでよく使っているZoom部屋を数える（自分の実績を重く見る）
    const usage = await meetingUrlUsage(req.user);

    const score = (c) => {
      const id = String(c.id || "");
      const u = usage.get(id) || { mine: 0, all: 0 };
      return u.mine * 10 + u.all * 2 + (roomIds.has(id) ? 5 : 0);
    };
    const timed = (events || []).filter((e) => !e.allDay && e.start).map((e) => {
      const cands = (e.urls || []).slice();
      // よく使っている部屋・自社の登録部屋を先頭に。同点なら元の順（会議情報→場所→説明）のまま。
      cands.forEach((c, i) => { c._i = i; c.used = (usage.get(String(c.id)) || { mine: 0, all: 0 }); });
      cands.sort((a, b) => score(b) - score(a) || a._i - b._i);
      cands.forEach((c) => { delete c._i; });
      const url = cands.length ? cands[0].url : (e.url || "");
      return {
        id: e.id, title: e.title || "(無題)", start: e.start,
        url, urls: cands, hasUrl: !!(url && /zoom|meet|teams/.test(url)), guests: e.guests || 0,
      };
    }).filter((e) => {
      // Googleが返す範囲外の予定（前日・翌日）が混ざることがあるので日本時間で再確認
      const ms = new Date(e.start).getTime();
      return ms >= start.getTime() && ms <= end.getTime();
    });
    res.json({ connected: true, date: dateStr, autoJoin: CALENDAR_AUTO_JOIN, events: timed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/auto-join/diagnose", async (req, res) => {
  try {
    const rows = await listAutoJoin(req.user);
    let calendarConnected = true;
    let events = [];
    try {
      const now = Date.now();
      events = await listCalendarEvents(req.user, "primary", {
        timeMin: new Date(now - 30 * 60 * 1000).toISOString(),
        timeMax: new Date(now + 3 * 60 * 60 * 1000).toISOString(),
      });
    } catch (e) {
      calendarConnected = false;
    }
    const now = Date.now();
    const timed = (events || []).filter((e) => !e.allDay && e.start);
    const calendarAnyEnabled = rows.some((r) => r.enabled && r.calendar_any);
    // 直近の予定を、URL検出・入室可否付きで返す
    const upcoming = timed
      .map((e) => {
        const startMs = new Date(e.start).getTime();
        const evUrl = (e.url && /zoom|meet\.google|teams\.microsoft/.test(e.url)) ? e.url : "";
        const inWin = now >= startMs - 2 * 60 * 1000 && now <= startMs + 4 * 60 * 1000;
        return {
          title: e.title || "(無題)", start: e.start, guests: e.guests || 0,
          hasMeetingUrl: !!evUrl, urlPreview: evUrl ? evUrl.slice(0, 45) : "",
          inWindowNow: inWin,
          wouldJoin: calendarAnyEnabled && !!evUrl && inWin,
        };
      })
      .sort((a, b) => new Date(a.start) - new Date(b.start))
      .slice(0, 15);
    const items = rows.map((r) => {
      const matches = r.calendar_any
        ? timed.filter((e) => (e.guests || 0) >= 1 || (e.url && /zoom|meet|teams/.test(e.url)))
        : timed.filter((e) => e.url && zoomMeetingId(e.url) === r.meeting_id);
      const next = matches
        .map((e) => ({ title: e.title, start: e.start, startMs: new Date(e.start).getTime() }))
        .sort((a, b) => a.startMs - b.startMs)[0] || null;
      const wouldJoinNow = !!next && now >= next.startMs - 2 * 60 * 1000 && now <= next.startMs + 4 * 60 * 1000;
      return {
        label: r.label, url: r.url, meeting_id: r.meeting_id, enabled: r.enabled, calendar_any: !!r.calendar_any,
        matchedEvent: next ? { title: next.title, start: next.start } : null,
        wouldJoinNow,
      };
    });
    res.json({ calendarConnected, publicUrl: !!PUBLIC_URL, calendarAnyEnabled, count: rows.length, eventCount: timed.length, upcoming, items });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 設定の取得・保存 ---
app.get("/api/settings", async (req, res) => {
  try {
    const cfg = await resolveConfig(req.user);
    res.json({ settings: cfg, status: statusInfo(PUBLIC_URL) });
  } catch (e) {
    sfErrorResponse(res, e);
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
    sfErrorResponse(res, e);
  }
});

// Salesforceを代わりに更新する人（チーム共通の設定）
app.get("/api/sf-proxy", async (req, res) => {
  try {
    const st = await getSettings().catch(() => ({}));
    res.json({ ok: true, sfProxyUser: st.sfProxyUser || "", sfNextActionType: st.sfNextActionType || "" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put("/api/sf-proxy", async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    if (b.sfProxyUser !== undefined) patch.sfProxyUser = String(b.sfProxyUser || "").trim().toLowerCase();
    // ネクストアクションの活動予定に付ける活動種別（任意・組織ごとの値）
    if (b.sfNextActionType !== undefined) patch.sfNextActionType = String(b.sfNextActionType || "").trim();
    await saveSettings(patch);
    const st = await getSettings().catch(() => ({}));
    const 連携 = st.sfProxyUser ? await sfConnected(st.sfProxyUser).catch(() => false) : false;
    if (b.sfProxyUser !== undefined) console.log(`[設定] 代わりに更新する人を「${st.sfProxyUser || "(なし)"}」にしました（連携：${連携 ? "あり" : "なし"}） by ${req.user}`);
    if (b.sfNextActionType !== undefined) console.log(`[設定] ネクストアクションの活動種別を「${st.sfNextActionType || "(なし)"}」にしました by ${req.user}`);
    res.json({
      ok: true, sfProxyUser: st.sfProxyUser || "", sfNextActionType: st.sfNextActionType || "", 連携,
      案内: b.sfProxyUser === undefined ? "保存しました"
        : !st.sfProxyUser ? "空にしました"
        : 連携 ? "この人の連携でSalesforceを更新します"
        : "保存しましたが、この人のSalesforce連携が見つかりません。kinbotにログインしているアドレスと同じか確かめてください",
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 抜け漏れチェック項目（チーム共有）
app.get("/api/check-items", async (req, res) => {
  try {
    const items = await getCheckItems();
    res.json({ items });
  } catch (e) {
    sfErrorResponse(res, e);
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
    sfErrorResponse(res, e);
  }
});

// 要約プロンプト（追加指示・チーム共有）。商談履歴の要約の書き方を設定で上書きできる。
app.get("/api/summary-prompt", async (req, res) => {
  try {
    res.json({ prompt: await getSummaryPrompt() });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});
app.put("/api/summary-prompt", async (req, res) => {
  try {
    const prompt = String((req.body && req.body.prompt) || "").slice(0, 4000);
    const r = await saveSettings({ summaryPrompt: prompt });
    res.json({ ok: true, prompt, ...r });
  } catch (e) {
    sfErrorResponse(res, e);
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

// カスタム分析プロンプト（チーム共有）。商談ごとにこのプロンプトを文字起こしに対して実行できる。
app.get("/api/custom-prompt", async (req, res) => {
  try { res.json({ prompt: await getCustomPrompt() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.put("/api/custom-prompt", async (req, res) => {
  try {
    const prompt = String((req.body && req.body.prompt) || "").slice(0, 12000);
    const r = await saveSettings({ customPrompt: prompt });
    res.json({ ok: true, prompt, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ある商談にカスタム分析を実行（保存＆返却）。
//  peek=true … 保存済みがあれば返す／無ければ実行しない
//  regen=true … 保存済みを無視して作り直す
app.post("/api/meetings/:id/custom-analysis", async (req, res) => {
  try {
    const botId = req.params.id;
    const m = await getMeeting(botId);
    if (!m) return res.status(404).json({ error: "商談が見つかりません" });
    if (!canAccess(m, req)) return res.status(403).json({ error: "権限がありません" });

    const peek = !!(req.body && req.body.peek);
    const regen = !!(req.body && req.body.regen);
    if (!regen && m.custom_analysis) return res.json({ result: m.custom_analysis, cached: true });
    if (peek) return res.json({ result: null, cached: false });

    const prompt = await getCustomPrompt();
    if (!prompt) return res.status(400).json({ error: "カスタム分析プロンプトが未設定です。設定→プロンプト設定→カスタム分析 で保存してください。" });
    const tr = m.transcript;
    if (!tr || (Array.isArray(tr) && !tr.length)) return res.status(400).json({ error: "この商談には文字起こしがありません。" });

    const result = await runCustomAnalysis(tr, prompt);
    await saveCustomAnalysis(botId, result);
    res.json({ result, cached: false });
  } catch (e) {
    console.error("[custom-analysis]", e);
    res.status(500).json({ error: e.message });
  }
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
    const name = fixMojibake(req.file.originalname || "資料").replace(/\.[^.]+$/, "");
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
      sourceRef: fixMojibake(req.file.originalname || ""),
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
    const name = fixMojibake(req.file.originalname || "PDF").replace(/\.pdf$/i, "");
    const id = await addKnowledge({
      category: (req.body && req.body.category) || "資料",
      title: name,
      body: text,
      owner: req.user || "",
      sourceType: "pdf",
      sourceRef: fixMojibake(req.file.originalname || ""),
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
    sfErrorResponse(res, e);
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
    const title = fixMojibake((req.body.title || "").trim()) || fixMojibake(req.file.originalname || "") || "アップロード";
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
  // 会議のチャット（「かささぎストップ」など）
  try {
    const c = parseChatEvent(req.body);
    if (c && c.botId) {
      const ks = getKasasagi(c.botId);
      if (ks) ks.onChat((c.speaker && c.speaker.name) || "", c.text);
    }
  } catch {}
  if (!verifyRecallRequest(req)) return res.status(401).end();
  res.status(200).end(); // まず即ACK（処理は非同期で）
  setImmediate(async () => {
    try {
      const ev = parseTranscriptEvent(req.body);
      if (ev && ev.botId) {
        let s = getSession(ev.botId);
        if (!s) {
          s = createSession(ev.botId, {}); // 予約Bot等：受信時に遅延作成
          // DBの商談行（予約時に作成済み）から商談名・所有者を補完。
          // 空ならカレンダーの予定タイトルと主催者から補う。
          try {
            let m = await getMeeting(ev.botId);
            if (!m || BAD_TITLE(m.title) || !String(m.rep_name || "").trim()) {
              await repairMeetingMeta(ev.botId);
              m = await getMeeting(ev.botId);
            }
            if (m) {
              s.enrich({
                title: m.title || "",
                owner: m.owner || "",
                repName: m.rep_name || "",
                muxPlaybackId: m.mux_playback_id,
              });
            }
          } catch {}
        }
        if (ev.type === "final") {
          s.onFinal(ev.speaker, ev.text, ev.off);
          // かささぎが動いていれば、同じ発言を渡して返事を考えさせる
          feedTranscript(ev.botId, (ev.speaker && ev.speaker.name) || "", ev.text);
        }
        else s.onPartial(ev.speaker, ev.text);
        return;
      }
      // 文字起こし以外＝完了/退出系イベントなら、セッションを締めて自動生成
      const name = String(req.body?.event || req.body?.type || "").toLowerCase();
      if (/done|ended|finished|fatal|complete|left|leave/.test(name)) {
        const botId = findBotId(req.body);
        if (botId) {
          // 商談名・担当が空のままなら、カレンダーの予定タイトルと主催者で埋めてから締める
          await repairMeetingMeta(botId);
          if (getSession(botId)) removeSession(botId); // dispose→自動で要約/FB/分析
        }
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

// ===== 顧客の温度感ランキング =====
// 文字起こしから計算する。結果は updated_at をキーにメモリへ控えて、毎回計算しないようにする。
const tempCache = new Map();
app.get("/api/temperature-ranking", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 5));
    // days を指定しなければ全期間が対象
    const days = Math.max(0, Math.min(3650, Number(req.query.days) || 0));
    const scope = req.query.scope === "all" ? "all" : "mine";
    const me = String((req.user || "")).toLowerCase();

    let heads = await listRecentMeetingHeads({ days, limit: 500 });
    // ユーザーフォロー・社内MTGは対象外
    heads = heads.filter((h) => !/【ユ\/フォ】|【社内MTG】/.test(h.title || ""));
    if (scope === "mine" && me) heads = heads.filter((h) => String(h.owner || "").toLowerCase() === me);

    // 商談回数でしぼる（1 / 2 / 3以上）。未設定のものはタイトルの【2回目】などからも読み取る。
    const roundQ = String(req.query.round || "").trim();
    if (roundQ) {
      const roundOf = (h) => {
        const n = Number(h.round_no);
        if (n > 0) return n;
        const t = String(h.title || "") + " " + String(h.phase || "");
        const m1 = t.match(/([0-9０-９]+)\s*回目/);
        if (m1) return Number(m1[1].replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)));
        if (/初回|新規|【新/.test(t)) return 1;
        if (/再商談/.test(t)) return 2;
        return 0;
      };
      heads = heads.filter((h) => {
        const n = roundOf(h);
        if (!n) return false;
        if (roundQ === "3plus") return n >= 3;
        return n === Number(roundQ);
      });
    }

    const need = heads.filter((h) => {
      const c = tempCache.get(h.bot_id);
      return !c || c.key !== String(h.updated_at);
    });
    // 文字起こしは重いので50件ずつ取って計算する。
    // 初回は件数が多いので、15秒を超えたらそこで打ち切り、残りは次回に回す。
    const deadline = Date.now() + 15000;
    for (let i = 0; i < need.length; i += 50) {
      if (Date.now() > deadline) break;
      const part = need.slice(i, i + 50);
      const rows = await getTranscriptsByIds(part.map((h) => h.bot_id));
      const byId = new Map(rows.map((r) => [r.bot_id, r.transcript]));
      for (const h of part) {
        let r = { score: 0 };
        try { r = scoreTranscript(byId.get(h.bot_id) || [], h.rep_name || h.owner_name || ""); } catch {}
        tempCache.set(h.bot_id, { key: String(h.updated_at), r });
      }
    }
    // 増えすぎたら古いものから捨てる
    if (tempCache.size > 1200) {
      const keys = [...tempCache.keys()].slice(0, tempCache.size - 1200);
      for (const k of keys) tempCache.delete(k);
    }

    const items = heads.map((h) => {
      const r = (tempCache.get(h.bot_id) || {}).r || {};
      return {
        bot_id: h.bot_id,
        title: h.title || "",
        round_no: h.round_no || null,
        company: h.account || "",
        owner_name: h.owner_name || h.rep_name || "",
        created_at: h.created_at,
        score: r.score || 0,
        level: r.level || "",
        rise: r.rise || 0,
        swing: r.swing || 0,
        skill: r.skill || 0,
        filler: (r.filler && r.filler.per100) || 0,
        nextLevel: (r.next && r.next.level) || "",
        nextOk: !!(r.next && r.next.dated && r.next.agreed),
      };
    }).filter((x) => x.score > 0 || x.skill > 0);

    const SORTS = { swing: "swing", skill: "skill", score: "score" };
    const sortBy = SORTS[req.query.sort] || "score";

    // メンバー別：担当者ごとの平均でランキングする
    if (req.query.by === "member") {
      const map = new Map();
      for (const it of items) {
        const name = it.owner_name || "(担当者未設定)";
        if (!map.has(name)) map.set(name, { name, count: 0, score: 0, swing: 0, skill: 0, filler: 0, nextOk: 0, best: 0 });
        const g = map.get(name);
        g.count++; g.score += it.score; g.swing += it.swing; g.skill += it.skill; g.filler += it.filler;
        if (it.nextOk) g.nextOk++;
        if (it.score > g.best) g.best = it.score;
      }
      const members = [...map.values()]
        .filter((g) => g.count >= 2) // 1件だけの人は平均がぶれるので除く
        .map((g) => ({
          name: g.name, count: g.count, best: g.best,
          score: Math.round(g.score / g.count),
          swing: Math.round(g.swing / g.count),
          skill: Math.round(g.skill / g.count),
          filler: Math.round((g.filler / g.count) * 10) / 10,
          nextRate: Math.round((g.nextOk / g.count) * 100),
        }));
      members.sort((a, b) => (b[sortBy] - a[sortBy]) || (b.score - a.score));
      return res.json({ members: members.slice(0, limit), total: members.length });
    }

    items.sort((a, b) => (b[sortBy] - a[sortBy]) || (b.score - a.score));
    res.json({ items: items.slice(0, limit), total: items.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 履歴一覧に出てこない商談（文字起こしが無い）を確認するための一覧
app.get("/api/meetings/no-transcript", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const days = Math.max(1, Math.min(180, Number(req.query.days) || 30));
    res.json({ items: await listMeetingsWithoutTranscript({ days, limit: 100 }) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/meetings", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    // 全員が全商談を閲覧できる。期間を指定すると、その範囲を古いものまで取れる。
    const ymd = /^\d{4}-\d{2}-\d{2}$/;
    res.json(await listMeetings({
      isAdmin: true,
      from: ymd.test(String(req.query.from || "")) ? req.query.from : "",
      to: ymd.test(String(req.query.to || "")) ? req.query.to : "",
      limit: req.query.limit,
      light: req.query.light === "1",
    }));
  } catch (e) {
    sfErrorResponse(res, e);
  }
});
app.get("/api/meetings/:id", async (req, res) => {
  try {
    const m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "見つかりません" });
    if (!canAccess(m, req)) return res.status(403).json({ error: "権限がありません" });
    res.json(m);
  } catch (e) {
    sfErrorResponse(res, e);
  }
});
app.get("/api/meetings/:id/recording", async (req, res) => {
  try {
    const m = await getMeeting(req.params.id);
    if (!m || !canAccess(m, req)) return res.json({ url: null });
    // 1) Googleドライブに保存できていれば、そこから再生する。
    //    Recallの録画は保存期限で消えるので、残るドライブを先に見る。
    if (m.drive_file_id) {
      return res.json({
        url: `/api/meetings/${encodeURIComponent(req.params.id)}/drive-video`,
        source: "drive", driveLink: m.drive_link || "",
      });
    }
    // 2) まだドライブに入っていなければ、Recallの録画で再生する（保存はこのあと動く）
    let recallUrl = null;
    try { recallUrl = await getRecordingUrl(req.params.id); } catch (e) { console.error("[recording] recall", e.message); }
    if (recallUrl) {
      // 開いた人が待たなくていいよう、裏で保存を始めておく
      archiveRecordingSafe(req.params.id).catch(() => {});
      return res.json({ url: recallUrl, source: "recall" });
    }
    // 3) 無ければ Mux VOD（アップロード動画など）
    if (m.mux_playback_id) {
      const u = livePlaybackUrl(m.mux_playback_id);
      if (u) return res.json({ url: u, hls: true, source: "live" });
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
// Gmailが使える状態か確認する（下書きが作れない原因を切り分ける）
// ===== Gmailのスレッド操作（アーカイブ / ゴミ箱 / 既読） =====
// 操作できるのは「自分のGmail」だけ。ログインユーザー本人のトークンで叩く。
// 完全削除は実装していない（Googleの権限が広くなりすぎるため）。ゴミ箱なら30日間は戻せる。
const GMAIL_ACTIONS = {
  archive:   { fn: gmailArchiveThread,   label: "アーカイブ" },
  unarchive: { fn: gmailUnarchiveThread, label: "受信トレイに戻す" },
  trash:     { fn: gmailTrashThread,     label: "ゴミ箱へ移動" },
  untrash:   { fn: gmailUntrashThread,   label: "ゴミ箱から復元" },
};

app.post("/api/gmail/threads/:threadId/:action", async (req, res) => {
  try {
    const action = String(req.params.action || "");
    const entry = GMAIL_ACTIONS[action];
    if (!entry) return res.status(400).json({ error: "不明な操作です" });
    const threadId = String(req.params.threadId || "").trim();
    if (!threadId) return res.status(400).json({ error: "スレッドIDがありません" });

    await entry.fn(req.user, threadId);
    await logGmailAction({
      owner: req.user,
      threadId,
      action,
      subject: String(req.body?.subject || ""),
      fromAddr: String(req.body?.from || ""),
    });
    console.log(`[gmail] ${entry.label} ${threadId} by ${req.user}`);
    res.json({ ok: true, action, label: entry.label, threadId });
  } catch (e) {
    if (e.needScope) {
      return res.status(403).json({
        error: "Gmailを操作する権限がありません。設定→外部連携でGoogleを一度「連携解除」してから、再連携してください。",
        needScope: true,
      });
    }
    if (e.notFound) return res.status(404).json({ error: "このスレッドは見つかりませんでした（すでに削除された可能性があります）" });
    console.error("[gmail action]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// 既読・未読の切り替え
app.post("/api/gmail/threads/:threadId/read", async (req, res) => {
  try {
    const read = req.body?.read !== false;
    await gmailSetRead(req.user, String(req.params.threadId), read);
    res.json({ ok: true, read });
  } catch (e) {
    if (e.needScope) return res.status(403).json({ error: "Gmailを操作する権限がありません。Googleを再連携してください。", needScope: true });
    res.status(502).json({ error: e.message });
  }
});

// 自分の操作履歴（間違って消したときに、どれを戻せばいいか分かるように）
app.get("/api/gmail/actions", async (req, res) => {
  try {
    const rows = await listGmailActions(req.isAdmin && req.query.all === "1" ? null : req.user, 50);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DBスキーマの診断。テーブルやカラムが作られていないときの原因調査用。
// このコードがどのビルドかを示す印。ログと画面の両方で確認できる。
// 新機能を足したらここを更新する。
const START_TIME = new Date().toISOString();
const BUILD_TAG = "2026-08-26w kincall CSV：クロス商談を見る初回商談日を、リスト作成時に指定できるようにした（既定2026-03-01。例：2025-08-01以降のクロス商談をアポ獲得済み扱いに）";
const BUILD_FEATURES = [
  "名簿ファイル（CSV/Excel）から数千件の資料URLを一括発行（進み具合つき）",
  "メールは返信を既定にし、本文のリンクを押せるようにした",
  "SFはステージ変更・活動履歴の自動記録で「更新済み」と判定",
  "御礼メールはGmailの送信済みを見て「送った」と判定",
  "天気予報（週のテーマ・目標・施策と振り返り／写真から読み取り）",
  "ホームによく使うツールを並べる（人ごとに選べる）",
  "確定メールの書き出しを、自分で取ったアポかどうかで変える",
  "アポメールをテストで送る（実際のアポには残らない）",
  "中澤・浦林を実績から外す（予備として割り振られたぶんは数える）",
  "リスケ・キャンセルの予定はアポに数えない",
  "カレンダーから消した予定を、アポからも外す",
  "夕方18時半に、やり残しを本人だけに知らせる",
  "コール進捗のお知らせ（目標はプロセスシートから読む）",
  "Google Chatから kinbot を動かす（自由な文で質問できる）",
  "開発メモ・自己点検・画面の見直し（似た案は残さない）",
  "資料とテンプレートを、メンバーごとに持てるようにした",
  "録画はすぐGoogleドライブへ保存し、再生もドライブから",
  "ライブ配信（録画者は見られない）",
  "kinbot専用のアイコン（タブ・ホーム画面）",
  "会社名と担当者名の区切りを、書き方が違っても読む",
];

// 今動いているコードのバージョンを返す（ログイン不要で確認できる）
app.get("/api/version", (req, res) => {
  res.json({ build: BUILD_TAG, features: BUILD_FEATURES, startedAt: START_TIME });
});

app.get("/api/db/schema-check", async (req, res) => {
  try {
    const rep = await schemaReport();
    const ok = rep.connected && !(rep.missingTables || []).length
               && !(rep.missingColumns || []).length && !(rep.failures || []).length;
    res.json({ ok, ...rep });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// スキーマの作り直しを試す（再デプロイせずにその場で再実行する）
app.post("/api/db/schema-repair", async (req, res) => {
  try {
    await initDb();
    const rep = await schemaReport();
    const ok = rep.connected && !(rep.missingTables || []).length && !(rep.missingColumns || []).length;
    res.json({ ok, ...rep });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/gmail/status", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const out = { connected: false, email: null, ready: false, reason: "", detail: "", canDraft: false, hint: "" };
    out.connected = await gcalConnected(req.user);
    if (!out.connected) {
      out.hint = "Googleが未連携です。設定→外部連携から連携してください。";
      return res.json(out);
    }
    out.email = await getPrimaryEmail(req.user);
    const ready = await gmailReady(req.user);
    out.ready = !!ready.ok;
    out.reason = ready.reason || "";
    out.detail = ready.detail || "";
    if (!ready.ok) {
      out.hint = ready.reason === "no_scope"
        ? "メールを読む権限はありますが、下書きを作る権限がありません。設定→外部連携でGoogleを連携し直してください（同意画面でGmailの項目にチェックを入れてください）。"
        : ready.reason === "api_disabled"
          ? "Google Cloud側でGmail APIが有効になっていません。"
          : "Gmailに接続できませんでした。";
      return res.json(out);
    }
    // 下書きが実際に作れるかを、空の下書きを作って消して確かめる
    try {
      const d = await gmailCreateDraft(req.user, { to: "", subject: "kinbot 接続確認", bodyText: "接続確認のため作成し、すぐ削除します。" });
      out.canDraft = true;
      try { await gmailDeleteDraft(req.user, d.id); } catch {}
    } catch (e) {
      out.canDraft = false;
      out.detail = e.message;
      out.hint = e.needScope
        ? "下書きを作る権限（gmail.compose）がありません。設定→外部連携でGoogleを連携し直してください。"
        : "下書きの作成に失敗しました。";
    }
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
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
// PKCEのcode_verifierを、認証開始からコールバックまで一時的に持っておく（stateがカギ）
const _sfPkce = new Map(); // state -> { verifier, exp }
function pkcePut(state, verifier) {
  const now = Date.now();
  for (const [k, v] of _sfPkce) if (v.exp < now) _sfPkce.delete(k);
  _sfPkce.set(state, { verifier, exp: now + 10 * 60 * 1000 });
}
function pkceTake(state) {
  const v = _sfPkce.get(state);
  if (!v) return "";
  _sfPkce.delete(state);
  return v.exp > Date.now() ? v.verifier : "";
}

app.get("/auth/salesforce", (req, res) => {
  if (!salesforceConfigured()) return res.status(500).send("SF_CLIENT_ID/SECRET が未設定です（後日の連携作業で設定します）");
  if (!PUBLIC_URL) return res.status(500).send("PUBLIC_URL が未設定です");
  // returnクエリパラメータで認証後の戻り先を指定可能
  const returnUrl = req.query.return || "/settings.html";
  const state = makeToken(JSON.stringify({ owner: req.user || "", returnUrl }));
  // 接続アプリで「PKCEの要求」がONでも通るように、毎回PKCEを付ける
  const { verifier, challenge } = sfCreatePkce();
  pkcePut(state, verifier);
  res.redirect(sfAuthUrl(sfRedirectUri(), state, challenge));
});
app.get("/auth/salesforce/callback", async (req, res) => {
  try {
    const raw = verifyToken(req.query.state || "");
    if (!raw) return res.status(400).send("セッションが無効です。ログインし直してください。");
    let owner = raw, returnUrl = "/settings.html";
    try {
      const parsed = JSON.parse(raw);
      owner = parsed.owner || raw;
      returnUrl = parsed.returnUrl || "/settings.html";
    } catch {}
    const verifier = pkceTake(req.query.state || "");
    await sfExchangeCode(req.query.code, sfRedirectUri(), owner, verifier);
    clearSfTokenCache(owner);
    // ポップアップ完了ページの場合は自動で閉じるHTMLを返す
    if (returnUrl === "/auth/salesforce/done") {
      return res.send(`<!DOCTYPE html><html><head><title>接続完了</title></head><body style="font-family:sans-serif;text-align:center;padding:60px 20px;">
        <h2 style="color:#0d5b47;">✓ Salesforce接続完了</h2>
        <p style="color:#6b7770;">このウィンドウは自動で閉じます</p>
        <script>setTimeout(()=>window.close(),1000)</script>
      </body></html>`);
    }
    res.redirect(returnUrl);
  } catch (e) {
    console.error("[salesforce]", e.message);
    // IP制限で弾かれた場合は、いま実際に使っている送信元IPを画面に出す（登録依頼にそのまま使えるように）
    if (/ip restricted/i.test(e.message || "")) {
      let ip = "取得できませんでした";
      try { ip = (await (await fetch("https://api.ipify.org")).text()).trim(); } catch {}
      const loginUrl = (process.env.SF_LOGIN_URL || "https://login.salesforce.com").replace(/\/+$/, "");
      return res.status(500).send(`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>連携に失敗しました</title></head>
        <body style="font-family:sans-serif;max-width:640px;margin:40px auto;padding:0 20px;line-height:1.8;color:#2c2c2a">
          <h2 style="color:#a13a3a">Salesforceの連携に失敗しました（IP制限）</h2>
          <p>Salesforce側で、kinbotのサーバーからの接続が許可されていません。</p>
          <p style="background:#f4f7f5;border:1px solid #e4e9e5;border-radius:10px;padding:14px">
            いまの送信元IP：<b style="font-size:18px">${ip}</b><br>
            接続先：${loginUrl}
          </p>
          <p>Salesforceの管理者に、次のどちらかを依頼してください。</p>
          <ol>
            <li>接続アプリのOAuthポリシーで「<b>IP制限の緩和</b>」を選ぶ（おすすめ）</li>
            <li>上のIPを、組織の信頼済みIP範囲とプロファイルのログインIP範囲に登録する</li>
          </ol>
          <p><a href="/settings.html">設定に戻る</a></p>
        </body></html>`);
    }
    res.status(500).send("連携に失敗しました: " + e.message);
  }
});
app.get("/api/salesforce/status", async (req, res) => {
  try {
    const info = await sfInfo(req.user);
    const us = await getUserSettings(req.user);
    res.json({ ...info, mapping: us.sfMapping || {} });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});
// kinbotが外部（Salesforce等）へ接続するときの送信元IP・接続先を確認する診断。
// ip restricted の切り分け（IPのズレ／接続先組織の取り違え）に使う。
app.get("/api/salesforce/diag-ip", async (req, res) => {
  const expected = ["162.220.232.251", "152.55.176.240", "152.55.177.181"];
  // 送信元IPを複数回サンプルして、出口IPが揺れていないか確認する
  const seen = new Set();
  const errors = [];
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fetch("https://api.ipify.org?format=json", { headers: { accept: "application/json" } });
      const d = await r.json();
      if (d.ip) seen.add(String(d.ip).trim());
    } catch (e) {
      if (errors.length < 2) errors.push(e.message);
    }
  }
  // 予備の別サービスでも1回確認（ipifyが偏る場合の保険）
  for (const url of ["https://ifconfig.co/json", "https://ipinfo.io/json"]) {
    try {
      const d = await (await fetch(url, { headers: { accept: "application/json" } })).json();
      const ip = d.ip || d.query || "";
      if (ip) seen.add(String(ip).trim());
    } catch {}
  }
  const ips = [...seen];
  const allExpected = ips.length > 0 && ips.every((ip) => expected.includes(ip));
  const notRegistered = ips.filter((ip) => !expected.includes(ip));
  const loginUrl = (process.env.SF_LOGIN_URL || "https://login.salesforce.com").replace(/\/+$/, "");
  const isSandbox = /test\.salesforce\.com/.test(loginUrl);
  const cid = process.env.SF_CLIENT_ID || "";
  res.json({
    outboundIps: ips,
    expected,
    allRegistered: allExpected,
    notRegistered,
    loginUrl,
    isSandbox,
    clientIdPrefix: cid ? cid.slice(0, 14) + "…" : "(未設定)",
  });
});

app.post("/api/salesforce/disconnect", async (req, res) => {
  await sfDisconnect(req.user);
  clearSfTokenCache(req.user);
  res.json({ ok: true });
});
// 項目マッピング（kinbotの情報 → SFの項目API参照名）を保存
app.put("/api/salesforce/mapping", async (req, res) => {
  try {
    const mapping = (req.body && req.body.mapping) || {};
    await saveUserSettings(req.user, { sfMapping: mapping });
    res.json({ ok: true });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// SF APIエラーハンドリング共通ヘルパー
function sfErrorResponse(res, e) {
  const msg = e.message || "";
  const sessionErr = /INVALID_SESSION_ID|Session expired|invalid session/i.test(msg);
  const isReauth = e.sfReauth || /expired|invalid_grant/.test(msg);
  if (sessionErr || isReauth) clearSfTokenCache(); // 次回は取り直す
  const status = isReauth ? 401 : 500;
  res.status(status).json({
    error: e.message,
    sfReauth: isReauth,
  });
}

// SF商談を会社名で検索
app.get("/api/salesforce/search", async (req, res) => {
  try {
    const q = req.query.q || "";
    if (!q) return res.json({ records: [] });
    const records = await searchOpportunities(req.user, q);
    res.json({ records });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// SF Stage選択肢を取得
app.get("/api/salesforce/stages", async (req, res) => {
  try {
    const stages = await getStageValues(req.user);
    res.json({ stages });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// SF商談の詳細を取得
app.get("/api/salesforce/opportunity/:id", async (req, res) => {
  try {
    const opp = await getOpportunity(req.user, req.params.id);
    res.json(opp);
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// SF商談を更新（Stage変更、NextStep等）
app.patch("/api/salesforce/opportunity/:id", async (req, res) => {
  try {
    const fields = { ...(req.body || {}) };
    // botId はkinbot側の記録に使うだけなので、Salesforceへは送らない
    const fromBotId = String(fields.botId || "");
    delete fields.botId;
    // 商談所有者を、更新した本人に付け替える（OwnerIdが指定されている場合はそちらを優先）
    let ownerChanged = false;
    if (fields.OwnerId === undefined) {
      try {
        const uid = await getSfUserId(req.user);
        if (uid) { fields.OwnerId = uid; ownerChanged = true; }
      } catch {}
    }
    try {
      await updateOpportunity(req.user, req.params.id, fields);
    } catch (e) {
      // 所有者の変更が権限などで弾かれたときは、所有者だけ外してもう一度試す
      if (ownerChanged && /OwnerId|所有者|INSUFFICIENT_ACCESS|FIELD_INTEGRITY/i.test(e.message || "")) {
        delete fields.OwnerId;
        ownerChanged = false;
        await updateOpportunity(req.user, req.params.id, fields);
      } else {
        throw e;
      }
    }
    // kinbot側にも「更新した」ことを残す。
    // ホームの「SF更新まだ」を、実際の更新にもとづいて数えるため。
    if (fields.StageName) {
      await recordSfUpdate({
        botId: fromBotId || null,
        oppId: req.params.id,
        stage: fields.StageName,
        note: "ステージを更新",
        owner: req.user,
      }).catch(() => {});
    }

    // 更新内容をログとしてChatterに投稿
    const parts = [];
    if (fields.StageName) parts.push(`Stage → ${fields.StageName}`);
    if (fields.NextStep) parts.push(`Next Step: ${fields.NextStep}`);
    if (fields.Description) parts.push(`メモ: ${fields.Description}`);
    if (parts.length) {
      try { await postChatter(req.user, req.params.id, `[kinbot] ${parts.join(" / ")}`); } catch {}
    }
    res.json({ ok: true, ownerChanged });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// SF商談にログを投稿
app.post("/api/salesforce/opportunity/:id/log", async (req, res) => {
  try {
    const text = req.body?.text || "";
    if (!text) return res.status(400).json({ error: "テキストが必要です" });
    await postChatter(req.user, req.params.id, `[kinbot] ${text}`);
    res.json({ ok: true });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// SF商談を「失注」にする（ホームのワンクリック用。既定はリスケ理由）
app.post("/api/salesforce/opportunity/:id/lose", async (req, res) => {
  try {
    const b = req.body || {};
    const reasonDai = b.reasonDai === undefined ? "ニーズ・優先度不足" : b.reasonDai;
    const reasonChu = b.reasonChu === undefined ? "初回商談リスケ" : b.reasonChu;
    const note = b.note || "リスケのため失注";
    let desc = null;
    try { desc = await describeOpportunity(req.user); } catch {}
    const fieldOf = (api) => (desc && (desc.fields || []).find((f) => f.name === api)) || null;
    // ステージ：「失注」の選択肢を探す
    const sf = fieldOf("StageName");
    const picks = ((sf && sf.picklistValues) || []).filter((v) => v.active);
    const hit = picks.find((v) => /失注/.test(v.label || v.value)) ||
                picks.find((v) => /closed\s*lost/i.test(v.label || v.value));
    if (!hit) return res.status(400).json({ error: "Salesforceのステージに「失注」が見つかりませんでした" });
    const fields = { StageName: hit.value };
    // 失注理由（ラベル→SFの値に変換。項目や選択肢が無ければスキップ）
    const setReason = (api, label) => {
      if (!label) return;
      const f = fieldOf(api);
      if (!f || !f.updateable) return;
      const opts = (f.picklistValues || []).filter((v) => v.active);
      if (opts.length) {
        const o = opts.find((p) => (p.label || p.value) === label) || opts.find((p) => p.value === label);
        if (o) fields[api] = o.value;
      } else {
        fields[api] = label;
      }
    };
    setReason("Loss_Reason__c", reasonDai);
    setReason("Loss_Reason1__c", reasonChu);

    // 失注時に必須になる項目を埋める（ボタンを押した日／理由詳細）
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10); // 日本時間の今日
    const detail = b.detail === undefined ? "リスケ" : b.detail;
    const allFields = (desc && desc.fields) || [];
    // API名で見つからないときはラベルで探す（組織ごとの項目名の違いに対応）
    const putByLabel = (apis, labelRe, value, types) => {
      let f = null;
      for (const api of apis) { f = fieldOf(api); if (f) break; }
      if (!f) {
        f = allFields.find((x) => x.updateable && labelRe.test(String(x.label || "")) &&
                                  (!types || types.includes(x.type)));
      }
      if (!f || !f.updateable || fields[f.name] !== undefined) return;
      if (f.type === "picklist") {
        const opts = (f.picklistValues || []).filter((v) => v.active);
        const o = opts.find((p) => (p.label || p.value) === value);
        if (o) fields[f.name] = o.value;
        return;
      }
      fields[f.name] = value;
    };
    // 失注日
    putByLabel(["order_date__c"], /失注日/, today, ["date", "datetime"]);
    // 失注後の次回アクション日
    putByLabel(["LostOpp_nextactiondate__c"], /失注.*次回アクション日/, today, ["date", "datetime"]);
    // 受失注理由詳細
    putByLabel(["Loss_Reason_Detail__c", "LostOpp_reason_detail__c"], /理由詳細/, detail, ["string", "textarea"]);

    // 商談所有者を、更新した本人に付け替える
    let ownerChanged = false;
    try {
      const uid = await getSfUserId(req.user);
      if (uid) { fields.OwnerId = uid; ownerChanged = true; }
    } catch {}

    try {
      await updateOpportunity(req.user, req.params.id, fields);
    } catch (e) {
      // 所有者の変更が権限などで弾かれたときは、所有者だけ外してもう一度試す
      if (ownerChanged && /OwnerId|所有者|INSUFFICIENT_ACCESS|FIELD_INTEGRITY/i.test(e.message || "")) {
        delete fields.OwnerId;
        ownerChanged = false;
        await updateOpportunity(req.user, req.params.id, fields);
      } else {
        throw e;
      }
    }
    try { await postChatter(req.user, req.params.id, `[kinbot] ${note}`); } catch {}
    res.json({ ok: true, stage: hit.label || hit.value, ownerChanged, fields });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// その日にカレンダーへ登録された予定を、Google連携している全員分まとめて返す
// 日付ごとの読み取り結果を、少しの間だけ覚えておく。
// 日付を行き来したときに、毎回30人ぶん読み直さないようにするため。
const _createdCache = new Map();
const CREATED_CACHE_MS = Number(process.env.CAL_CACHE_MS || 90 * 1000);

app.get("/api/calendar/created", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const fresh = String(req.query.fresh || "") === "1";
    const jstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const q = String((req.query && req.query.date) || "").trim();
    const dateStr = /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : jstToday;

    // 覚えているものがあれば、それを返す（読み直したいときは fresh=1）
    const cached = _createdCache.get(dateStr);
    if (!fresh && cached && Date.now() - cached.at < CREATED_CACHE_MS) {
      return res.json({ ...cached.data, cached: true, cachedAgoSec: Math.round((Date.now() - cached.at) / 1000) });
    }

    let accounts = [];
    try { accounts = await listGoogleAccounts(); } catch {}
    if (!accounts.length) return res.json({ connected: false, date: dateStr, events: [] });

    const byUid = new Map();
    const errors = [];
    const owners = accounts.slice(0, 30)
      .map((a) => a.owner || a.google_email || "")
      .filter(Boolean);

    // 30人ぶんを1人ずつ読むと待ち時間が積み上がるので、まとめて読む。
    // Googleの制限に当たらないよう、6人ずつに区切って進める。
    const CHUNK = Number(process.env.CAL_FETCH_CONCURRENCY || 6);
    for (let i = 0; i < owners.length; i += CHUNK) {
      const part = owners.slice(i, i + CHUNK);
      const results = await Promise.all(part.map(async (own) => {
        try { return { own, evs: await listEventsCreatedOn(own, dateStr) }; }
        catch (err) { return { own, err: err.message }; }
      }));
      for (const r of results) {
        if (r.err) { errors.push(`${r.own}: ${r.err}`); continue; }
        for (const e of r.evs) {
          const key = e.uid || (e.title + "@" + e.start);
          const prev = byUid.get(key);
          // 同じ予定が複数人のカレンダーにある場合は、主催者側を優先して残す
          if (!prev || (e.organizer && r.own && e.organizer.toLowerCase() === String(r.own).toLowerCase())) {
            byUid.set(key, { ...e, calendarOwner: r.own });
          }
        }
      }
    }
    // 誰がアポを取り（インターン）、誰に振り分けられたか（営業担当）を割り出す
    const nameMap = await buildRepNameMap();          // メール → 氏名
    let internMap = {};
    try {
      const interns = await listInterns();
      for (const i of interns || []) {
        if (i.email) internMap[String(i.email).toLowerCase()] = i.name || i.email;
        if (i.name) internMap[String(i.name).toLowerCase()] = i.name;
      }
    } catch {}
    const isIntern = (email) => !!internMap[String(email || "").toLowerCase()];
    const nameOf = (email, fallback) =>
      internMap[String(email || "").toLowerCase()] || nameMap[String(email || "").toLowerCase()] || nameMap[email] || fallback || (String(email || "").split("@")[0] || "");

    const events = [...byUid.values()]
      .map((e) => {
        const creator = String(e.creator || "").toLowerCase();
        // 招待されている人のうち、社内の営業（kinbotの利用者）で、作成者ではない人
        const cands = (e.attendees || []).filter((a) => {
          const em = String(a.email || "").toLowerCase();
          if (!em || em === creator) return false;
          if (isIntern(em)) return false;
          return !!nameMap[em];
        });
        const assignee = cands[0] || null;
        return {
          ...e,
          apoBy: isIntern(creator) ? nameOf(e.creator, e.creatorName) : "",   // アポを取ったインターン
          apoByIsIntern: isIntern(creator),
          assigneeEmail: assignee ? assignee.email : (e.organizer || ""),
          assigneeName: assignee ? nameOf(assignee.email, assignee.name) : nameOf(e.organizer, e.organizerName),
        };
      })
      .sort((x, y) => new Date(x.created) - new Date(y.created));
    const payload = { connected: true, date: dateStr, count: accounts.length, events, errors };
    _createdCache.set(dateStr, { at: Date.now(), data: payload });
    // 覚えておくのは直近の数日だけにする
    if (_createdCache.size > 12) {
      const oldest = [..._createdCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) _createdCache.delete(oldest[0]);
    }
    console.log(`[SF立ち上げ] ${dateStr} のカレンダーを読みました（${accounts.length}人／${events.length}件${errors.length ? `／読めず ${errors.length}人` : ""}）`);
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 会社名から予定を一括で探す（SF立ち上げの高速化）。
// 以前はブラウザが31日ぶんを1日ずつ順番に読んでいた。ここでサーバーが
// 近い日から並列で探し、最初に一致した日の予定をまとめて返す。中身の判定は今までと同じ。
app.get("/api/calendar/find-company", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const q = String(req.query.q || "").trim();
    const anchor = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || "")) ? req.query.date : new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const back = Math.min(60, Math.max(1, parseInt(req.query.back, 10) || 31));
    if (!q) return res.status(400).json({ error: "会社名（探す言葉）を指定してください" });

    let accounts = [];
    try { accounts = await listGoogleAccounts(); } catch {}
    if (!accounts.length) return res.json({ connected: false, found: false, events: [] });
    const owners = accounts.slice(0, 30).map((a) => a.owner || a.google_email || "").filter(Boolean);

    const norm = (t) => String(t || "").replace(/[\s　]/g, "");
    const key = norm(q);
    const base = new Date(anchor + "T00:00:00+09:00");
    const days = [];
    for (let i = 1; i <= back; i++) {
      const d = new Date(base); d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }

    const readDay = async (dateStr) => {
      const byUid = new Map();
      const CHUNK = Number(process.env.CAL_FETCH_CONCURRENCY || 6);
      for (let i = 0; i < owners.length; i += CHUNK) {
        const part = owners.slice(i, i + CHUNK);
        const rs = await Promise.all(part.map(async (own) => {
          try { return { own, evs: await listEventsCreatedOn(own, dateStr) }; } catch { return { own, evs: [] }; }
        }));
        for (const r of rs) for (const e of (r.evs || [])) {
          const k = e.uid || (e.title + "@" + e.start);
          if (!byUid.has(k)) byUid.set(k, { ...e, calendarOwner: r.own });
        }
      }
      return [...byUid.values()];
    };

    const BATCH = 5;
    for (let i = 0; i < days.length; i += BATCH) {
      const part = days.slice(i, i + BATCH);
      const results = await Promise.all(part.map(async (day) => ({ day, evs: await readDay(day) })));
      for (const { day, evs } of results) {
        const hit = evs.filter((e) => norm(e.title).includes(key) || key.includes(norm(e.title)));
        if (hit.length) return res.json({ connected: true, found: true, date: day, count: owners.length, events: evs });
      }
    }
    res.json({ connected: true, found: false, events: [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== SF立ち上げ（リードのコンバート） =====

// 立ち上げに使うリードの入力項目を、ラベルからAPI名に解決して返す
const LEAD_WANT = [
  { key: "leadSource", label: "リードソース",        re: /リードソース|Lead\s*Source/i, apis: ["LeadSource"], req: true },
  { key: "campaign",  label: "主キャンペーンソース", re: /主?キャンペーン(ソース|元)/, apis: ["Primary_Campaign_Source__c", "CampaignSource__c"] },
  { key: "visitDate", label: "初回訪問日",           re: /初回(訪問|商談|面談|アポ).*日|初回.*日/, apis: ["First_Visit_Date__c", "firstvisit_date__c"] },
  { key: "apoDate",   label: "アポ獲得日",           re: /アポ.*獲得.*日|獲得日/,      apis: ["Apo_Date__c", "apo_date__c"] },
  { key: "fsNote",    label: "FSへの連携事項",       re: /(FS|ＦＳ|フィールドセールス)/i, apis: ["FS_Note__c", "to_fs__c"] },
  { key: "phone",     label: "電話",                re: /電話|Phone/i,               apis: ["Phone"], req: true },
  { key: "website",   label: "会社URL",              re: /会社.*(URL|ホームページ|サイト)|Website/i, apis: ["Website"], req: true },
  { key: "state",     label: "住所の都道府県",       re: /都道府県|State/i,           apis: ["State"], req: true },
  { key: "city",      label: "市区郡",               re: /市区郡|市区町村|City/i,     apis: ["City"] },
  { key: "address",   label: "町名・番地",           re: /住所|Street/i,              apis: ["Street"] },
  { key: "postal",    label: "郵便番号",             re: /郵便番号|PostalCode/i,      apis: ["PostalCode"] },
  { key: "employees", label: "会社従業員数",         re: /従業員/,                    apis: ["NumberOfEmployees"] },
];

app.get("/api/salesforce/lead-fields", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const desc = await describeObject(req.user, "Lead");
    const all = (desc.fields || []).filter((f) => f.updateable || f.createable);
    const out = [];
    for (const w of LEAD_WANT) {
      let f = null;
      for (const api of w.apis) { f = all.find((x) => x.name === api); if (f) break; }
      if (!f) f = all.find((x) => w.re.test(String(x.label || "")));
      if (!f) { out.push({ ...w, name: "", found: false }); continue; }
      out.push({
        key: w.key, label: f.label || w.label, name: f.name, found: true,
        type: f.type,
        required: !!w.req || (!f.nillable && !f.defaultedOnCreate),
        referenceTo: f.referenceTo || [],
        options: (f.picklistValues || []).filter((o) => o.active).map((o) => ({ value: o.value, label: o.label || o.value })),
      });
    }
    // この組織でリードの必須になっている項目も返す（入れないと更新・コンバートで弾かれるため）
    const required = all
      .filter((f) => f.updateable && !f.nillable && !f.defaultedOnCreate)
      .filter((f) => !out.find((o) => o.name === f.name))
      .map((f) => ({
        key: "req_" + f.name, label: f.label || f.name, name: f.name, found: true, required: true,
        type: f.type, referenceTo: f.referenceTo || [],
        options: (f.picklistValues || []).filter((o) => o.active).map((o) => ({ value: o.value, label: o.label || o.value })),
      }));
    const statuses = await convertedLeadStatuses(req.user);
    res.json({ fields: out.concat(required), convertedStatus: (statuses[0] || {}).value || "", convertedStatuses: statuses });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// すでにSalesforceで立ち上がっている（クロスの商談がある）会社を調べる
app.post("/api/salesforce/launched-check", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const list = Array.isArray(req.body && req.body.companies) ? req.body.companies : [];
    if (!list.length) return res.json({ found: {} });
    // 「株式会社」などを外した中心の語で探す
    const core = (v) => String(v || "")
      .replace(/(株式会社|有限会社|合同会社|合資会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|医療法人|学校法人|社会福祉法人|㈱|\(株\)|（株）)/g, "")
      .replace(/['"\\%_\s　]/g, "")
      .trim();
    const uniq = [...new Set(list.map(core).filter((x) => x.length >= 2))].slice(0, 25);
    if (!uniq.length) return res.json({ found: {} });
    const ors = uniq.map((c) => `Name LIKE '%${c}%'`).join(" OR ");
    // 商談名に「クロス」が入るものだけを見ていると、
    // kinbotが自動で立ち上げた「会社名_担当者名」の商談を取りこぼす。
    // 会社名で当てて、あとから絞り込む。
    const soql =
      `SELECT Id, Name, StageName, CreatedDate, Account.Name FROM Opportunity ` +
      `WHERE (${ors}) ORDER BY CreatedDate DESC LIMIT 300`;
    const d = await sfQuery(req.user, soql);
    const recs = d.records || [];
    const found = {};
    for (const c of list) {
      const k = core(c);
      if (!k) continue;
      const hit = recs.find((r) => core(r.Name).includes(k) || (r.Account && core(r.Account.Name).includes(k)));
      if (hit) found[c] = { id: hit.Id, name: hit.Name, stage: hit.StageName || "", createdDate: hit.CreatedDate || "" };
    }
    // Salesforceで見つからなくても、kinbotが立ち上げた記録があれば拾う
    try {
      const rows = await autolaunchByCompanies(list);
      for (const c of list) {
        if (found[c]) continue;
        const r = rows[core(c)];
        if (r && r.ok && r.opp_id) {
          found[c] = { id: r.opp_id, name: r.title || "", stage: "", createdDate: r.tried_at, viaKinbot: true };
        }
      }
    } catch {}

    const info = await sfInfo(req.user).catch(() => null);
    res.json({ found, instanceUrl: (info && info.instanceUrl) || "" });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// リードを新規作成するときの入力項目（必須項目＋立ち上げに使う項目）
app.get("/api/salesforce/lead-create-fields", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const desc = await describeObject(req.user, "Lead");
    const all = (desc.fields || []).filter((f) => f.createable);
    const pick = (f, group) => ({
      name: f.name,
      label: f.label || f.name,
      type: f.type,
      referenceTo: f.referenceTo || [],
      required: !f.nillable && !f.defaultedOnCreate,
      group,
      options: (f.picklistValues || []).filter((o) => o.active).map((o) => ({ value: o.value, label: o.label || o.value })),
    });
    const out = [];
    const seen = new Set();
    const add = (f, group) => { if (f && !seen.has(f.name)) { seen.add(f.name); out.push(pick(f, group)); } };

    // 基本項目
    ["LastName", "FirstName", "Company", "Title", "Email", "Phone", "Website", "Street", "City", "State", "PostalCode", "NumberOfEmployees", "Industry", "LeadSource"]
      .forEach((n) => add(all.find((f) => f.name === n), "基本"));
    // 立ち上げに使う項目（ラベルから探す）
    for (const w of LEAD_WANT) {
      let f = null;
      for (const api of w.apis) { f = all.find((x) => x.name === api); if (f) break; }
      if (!f) f = all.find((x) => w.re.test(String(x.label || "")));
      add(f, "立ち上げ");
    }
    // この組織で必須になっている項目（入れないと作成できないもの）
    all.filter((f) => !f.nillable && !f.defaultedOnCreate).forEach((f) => add(f, "必須"));

    res.json({ fields: out });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// リードを新規作成する
app.post("/api/salesforce/leads", async (req, res) => {
  try {
    const fields = { ...((req.body && req.body.fields) || {}) };
    if (!fields.LastName || !fields.Company) return res.status(400).json({ error: "姓と会社名は必須です" });

    // 新しく作るリードは、既定でクロスリードにする。
    // 画面から明示的に指定されているときは、そちらを尊重する。
    let recordTypeNote = "";
    if (!fields.RecordTypeId && req.body?.cross !== false) {
      const id = await crossLeadRecordTypeId(req.user).catch(() => "");
      if (id) { fields.RecordTypeId = id; recordTypeNote = "クロスリードとして作成しました"; }
      else recordTypeNote = "クロスのレコードタイプが見つからないため、既定の種別で作成しました";
    }

    const r = await createLead(req.user, fields);

    // 作ったリードの種別を読み返して返す。画面で正しく「クロスリード」と出すため。
    let recordTypeName = "";
    try {
      const id = r && (r.id || r.Id);
      if (id) {
        const d = await sfQuery(req.user,
          `SELECT Id, RecordType.Name, LeadSource FROM Lead WHERE Id = '${String(id).replace(/[^a-zA-Z0-9]/g, "")}'`);
        recordTypeName = d?.records?.[0]?.RecordType?.Name || "";
      }
    } catch {}

    console.log(`[SF] リードを作成 ${fields.Company}／${fields.LastName}（種別 ${recordTypeName || "不明"}）by ${req.user}`);
    res.json({ ...r, recordTypeNote, recordTypeName });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// 既存のリードの種別（レコードタイプ）を変える。
// 「直販で登録されていたが、実はクロス」というときに使う。
app.put("/api/salesforce/leads/:id/record-type", async (req, res) => {
  try {
    const id = String(req.params.id || "").replace(/[^a-zA-Z0-9]/g, "");
    if (!id) return res.status(400).json({ error: "リードIDが必要です" });
    let rtId = String(req.body?.recordTypeId || "").trim();
    if (!rtId) {
      rtId = await crossLeadRecordTypeId(req.user);
      if (!rtId) return res.status(400).json({ error: "クロスのレコードタイプが見つかりませんでした" });
    }
    await updateLead(req.user, id, { RecordTypeId: rtId });
    const d = await sfQuery(req.user, `SELECT RecordType.Name FROM Lead WHERE Id = '${id}'`);
    const name = d?.records?.[0]?.RecordType?.Name || "";
    console.log(`[SF] リード ${id} の種別を「${name}」に変更 by ${req.user}`);
    res.json({ ok: true, recordTypeName: name });
  } catch (e) { sfErrorResponse(res, e); }
});

// リードのレコードタイプの一覧（画面で選べるように）
app.get("/api/salesforce/lead-record-types", async (req, res) => {
  try {
    const list = await leadRecordTypes(req.user);
    const cross = await crossLeadRecordTypeId(req.user);
    res.json({ types: list, crossId: cross });
  } catch (e) { sfErrorResponse(res, e); }
});

// 会社名から、ネット検索でURL・電話・従業員数を調べる。
// gBizINFOに載っていない情報を補うためのもので、値は「要確認」の扱い。
app.get("/api/company-lookup", async (req, res) => {
  try {
    const name = String(req.query.name || "").trim();
    if (!name) return res.status(400).json({ error: "会社名を指定してください" });
    if (!webLookupAvailable()) return res.json({ ok: false, reason: "検索の設定がありません" });
    const r = await searchCompanyInfo(name, { hintUrl: String(req.query.url || "") });
    console.log(`[検索] ${name} → ${r.ok ? [r.website, r.phone, r.employees].filter(Boolean).join(" / ") : r.reason}`);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 会社名からgBizINFOの企業情報を引いて、住所・従業員数・URLなどを返す
app.get("/api/gbiz/company", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    if (!gbizConfigured()) return res.json({ configured: false, best: null, candidates: [] });
    const name = String(req.query.name || "").trim();
    const number = String(req.query.number || "").replace(/\D/g, "");
    let detail = null, candidates = [];

    if (number.length === 13) {
      detail = await getCompanyDetail(number).catch(() => null);
    } else {
      if (!name) return res.status(400).json({ error: "会社名を指定してください" });
      candidates = await searchCompanies(name, 10).catch(() => []);
      // 表記ゆれをならして、いちばん近いものを選ぶ
      const norm = (v) => String(v || "").replace(/[\s　（）()株式会社有限会社合同会社]/g, "");
      const key = norm(name);
      const exact = candidates.find((c) => norm(c.name) === key) ||
                    candidates.find((c) => norm(c.name).includes(key)) ||
                    candidates.find((c) => key.includes(norm(c.name)));
      const target = exact || candidates[0];
      if (target) detail = await getCompanyDetail(target.corporate_number).catch(() => null);
    }
    if (!detail) return res.json({ configured: true, best: null, candidates });

    // 住所を「都道府県 / 市区町村 / それ以降」に分ける
    const loc = String(detail.location || "");
    const mPref = loc.match(/^(北海道|東京都|大阪府|京都府|.{2,3}県)/);
    const pref = mPref ? mPref[1] : "";
    const rest = pref ? loc.slice(pref.length) : loc;
    const mCity = rest.match(/^(.+?[市区町村])/);
    const city = mCity ? mCity[1] : "";
    const street = city ? rest.slice(city.length) : rest;
    const emp = String(detail.employees || "").replace(/[^\d]/g, "");

    res.json({
      configured: true,
      candidates,
      best: {
        corporateNumber: detail.corporate_number,
        name: detail.official_name,
        location: loc,
        state: pref,
        city,
        street,
        postalCode: String(detail.postal_code || "").replace(/[^\d-]/g, ""),
        employees: emp ? Number(emp) : null,
        website: detail.company_url || "",
        industry: detail.industry || "",
        founded: detail.founded || "",
        capital: detail.capital || "",
        business: detail.business || "",
      },
    });
  } catch (e) {
    console.error("[gbiz company]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// ===== Salesforceのレポート =====
app.get("/api/salesforce/reports", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json({ reports: await listReports(req.user, req.query.q || "") });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

app.get("/api/salesforce/reports/:id", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(await runReport(req.user, req.params.id));
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// レポートに設定されている絞り込み条件を読む
app.get("/api/salesforce/reports/:id/filters", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(await reportFilters(req.user, req.params.id));
  } catch (e) { sfErrorResponse(res, e); }
});

// 条件を変えてレポートを実行する。
// Salesforceに保存されているレポートは書き換えないので、何度でも試せる。
app.post("/api/salesforce/reports/:id/run", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const b = req.body || {};
    const filters = {
      reportFilters: Array.isArray(b.filters)
        ? b.filters.map((f) => ({
            column: String(f.column || ""),
            operator: String(f.operator || "equals"),
            value: String(f.value == null ? "" : f.value),
          })).filter((f) => f.column)
        : null,
      reportBooleanFilter: b.booleanFilter || "",
      standardDateFilter: b.standardDateFilter || null,
    };
    console.log(`[SFレポート] 条件を変えて実行 ${req.params.id}（${(filters.reportFilters || []).length}件）by ${req.user}`);
    res.json(await runReport(req.user, req.params.id, filters));
  } catch (e) { sfErrorResponse(res, e); }
});

app.get("/api/salesforce/leads-export", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(await exportLeads(req.user, {
      days: Number(req.query.days) || 0,
      converted: req.query.converted || "open",
    }));
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

app.get("/api/salesforce/dashboards", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json({ dashboards: await listDashboards(req.user, req.query.q || "") });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

app.get("/api/salesforce/dashboards/:id", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json(await describeDashboard(req.user, req.params.id));
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// 商談を段階（章）に分ける。再生バーの頭出しに使う。
app.post("/api/meetings/:id/chapters", async (req, res) => {
  try {
    const m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "見つかりません" });
    const tr = Array.isArray(m.transcript) ? m.transcript : [];
    if (tr.length < 6) return res.json({ chapters: [] });
    const raw = await splitPhases({ transcript: tr, repName: m.rep_name || m.owner_name || "" });
    const chapters = buildChapters(tr, raw);
    await saveChapters(req.params.id, chapters);
    res.json({ chapters });
  } catch (e) {
    console.error("[chapters]", e.message);
    res.status(502).json({ error: e.message });
  }
});

// ===== 商談後にやること（御礼メール・次回アクション・SF更新） =====
app.get("/api/meetings/:id/followup", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json({ followup: (await getFollowup(req.params.id)) || {} });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.put("/api/meetings/:id/followup", async (req, res) => {
  try {
    await saveFollowup(req.params.id, req.body || {});
    res.json({ ok: true, followup: (await getFollowup(req.params.id)) || {} });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.get("/api/followups", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json({ items: await listOpenFollowups(Number(req.query.days) || 3) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 利用状況（どの画面のどこが押されているか） =====
app.post("/api/usage", async (req, res) => {
  try {
    const events = (req.body && req.body.events) || [];
    await addUsageEvents(req.user || "", events);
    res.json({ ok: true });
  } catch {
    res.json({ ok: false });
  }
});
app.get("/api/usage/summary", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const days = Number(req.query.days) || 14;
    const owner = String(req.query.owner || "").trim();
    const [sum, labels] = await Promise.all([
      usageSummary(days, owner),
      usageLabels(Math.max(30, days), owner),
    ]);
    res.json({ ...(sum || {}), labels });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== 商談から集めた質問と回答（全員で共有するナレッジ） =====
app.get("/api/qa-bank", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.json({ items: await listQaBank({ q: req.query.q || "", limit: 300 }) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
app.post("/api/qa-bank", async (req, res) => {
  try {
    const { question, answer, topic } = req.body || {};
    if (!question || !answer) return res.status(400).json({ error: "質問と回答が必要です" });
    const n = await addQaPairs([{ question, answer, topic: topic || "その他" }], { repName: req.user });
    res.json({ ok: true, added: n });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// 過去の商談から、質問と回答をまとめて取り込む（時間がかかるので少しずつ）
app.post("/api/qa-bank/import", async (req, res) => {
  try {
    const days = Math.max(1, Math.min(365, Number((req.body && req.body.days) || 90)));
    const max = Math.max(1, Math.min(20, Number((req.body && req.body.max) || 8)));
    const heads = await listRecentMeetingHeads({ days, limit: 300 });
    const done = new Set(await qaBankBotIds());
    const targets = heads
      .filter((h) => !/【ユ\/フォ】|【社内MTG】/.test(h.title || ""))
      .filter((h) => !done.has(h.bot_id));
    const remaining = targets.length;
    const part = targets.slice(0, max);
    if (!part.length) return res.json({ ok: true, processed: 0, added: 0, remaining: 0 });

    const rows = await getTranscriptsByIds(part.map((h) => h.bot_id));
    const byId = new Map(rows.map((r) => [r.bot_id, r.transcript]));
    let added = 0, processed = 0;
    const deadline = Date.now() + 50000;
    for (const h of part) {
      if (Date.now() > deadline) break;
      const tr = byId.get(h.bot_id);
      if (!Array.isArray(tr) || !tr.length) { processed++; continue; }
      const text = tr.map((u) => `${(u && u.speaker && u.speaker.name) || "話者"}: ${(u && u.text) || ""}`).join("\n");
      try {
        const pairs = await extractQaPairs({ transcript: text, repName: h.rep_name || h.owner_name || "" });
        added += await addQaPairs(pairs, {
          botId: h.bot_id,
          company: h.account || "",
          repName: h.rep_name || h.owner_name || "",
        });
      } catch (e) {
        console.error("[QA取り込み]", h.bot_id, e.message);
      }
      processed++;
    }
    res.json({ ok: true, processed, added, remaining: Math.max(0, remaining - processed) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/qa-bank/:id", async (req, res) => {
  try { await deleteQaBank(Number(req.params.id)); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});
app.post("/api/qa-bank/:id/good", async (req, res) => {
  try { await markQaGood(Number(req.params.id), 1); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Salesforce連携の診断（つながらない理由を確認する）
app.get("/api/salesforce/diag", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const info = await sfInfo(req.user).catch((e) => ({ error: e.message }));
    let tokenTest = { ok: false, error: "" };
    try {
      await sfQuery(req.user, "SELECT Id FROM Opportunity LIMIT 1");
      tokenTest.ok = true;
    } catch (e) {
      tokenTest.error = e.message || String(e);
    }
    let egressIp = "";
    try { egressIp = (await (await fetch("https://api.ipify.org")).text()).trim(); } catch {}
    res.json({
      owner: req.user,
      loginUrl: (process.env.SF_LOGIN_URL || "https://login.salesforce.com").replace(/\/+$/, ""),
      clientIdSet: !!process.env.SF_CLIENT_ID,
      clientSecretSet: !!process.env.SF_CLIENT_SECRET,
      connection: info,
      tokenTest,
      egressIp,
      hint: !tokenTest.ok && /ip restricted/i.test(tokenTest.error)
        ? "SalesforceのIP制限で弾かれています。接続アプリのOAuthポリシーで「IP制限の緩和」を設定するか、上のegressIpを信頼済みIPに登録してください。"
        : !tokenTest.ok && /expired access\/refresh token/i.test(tokenTest.error)
          ? "リフレッシュトークンが期限切れです。(1)設定→外部連携でSalesforceを連携し直してください。(2)何度も起きる場合は、接続アプリのOAuthポリシー「更新トークンポリシー」を『リフレッシュトークンが失効するまで』に変更してもらってください（管理者作業）。"
        : !tokenTest.ok && /invalid_grant/i.test(tokenTest.error)
          ? "リフレッシュトークンが無効です。設定から再連携してください。管理者に、接続アプリの更新トークンポリシーの確認も依頼してください。"
          : "",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 会社名やメールから、電話番号・Webサイトを探す
// （1）Salesforceの既存の取引先・リード （2）メールのドメイン の順で拾う
const FREE_MAIL = /^(gmail|yahoo|outlook|hotmail|icloud|docomo|ezweb|softbank|au|me|live|msn|nifty|so-net|biglobe|ocn)\./i;
app.get("/api/salesforce/company-info", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const name = String(req.query.name || "").trim();
    const email = String(req.query.email || "").trim();
    const out = { phone: "", website: "", source: "" };

    const core = String(name)
      .replace(/(株式会社|有限会社|合同会社|合資会社|一般社団法人|一般財団法人|医療法人|学校法人|社会福祉法人|㈱|\(株\)|（株）)/g, "")
      .replace(/['"\\%_\s　]/g, "").trim();

    if (core.length >= 2) {
      // 既存の取引先
      try {
        const d = await sfQuery(req.user, `SELECT Id, Name, Phone, Website FROM Account WHERE Name LIKE '%${core}%' ORDER BY LastModifiedDate DESC LIMIT 5`);
        for (const r of d.records || []) {
          if (!out.phone && r.Phone) { out.phone = r.Phone; out.source = "取引先"; }
          if (!out.website && r.Website) { out.website = r.Website; out.source = out.source || "取引先"; }
        }
      } catch {}
      // 同じ会社の別リード
      if (!out.phone || !out.website) {
        try {
          const d = await sfQuery(req.user, `SELECT Id, Company, Phone, Website FROM Lead WHERE Company LIKE '%${core}%' ORDER BY CreatedDate DESC LIMIT 10`);
          for (const r of d.records || []) {
            if (!out.phone && r.Phone) { out.phone = r.Phone; out.source = out.source || "他のリード"; }
            if (!out.website && r.Website) { out.website = r.Website; out.source = out.source || "他のリード"; }
          }
        } catch {}
      }
    }

    // メールアドレスのドメインからWebサイトを推測する（フリーメールは除く）
    if (!out.website && /@/.test(email)) {
      const dom = email.split("@")[1] || "";
      if (dom && !FREE_MAIL.test(dom)) {
        out.website = "https://" + dom.replace(/^www\./i, "");
        out.source = out.source || "メールのドメイン";
        out.guessed = true;
      }
    }
    res.json(out);
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// 参照項目（ルックアップ）の候補を、参照先のオブジェクトから検索する
const _lookupNameField = new Map(); // sobject -> 表示に使う項目名
app.get("/api/salesforce/lookup", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const sobject = String(req.query.sobject || "").replace(/[^A-Za-z0-9_]/g, "");
    if (!sobject) return res.status(400).json({ error: "sobjectが必要です" });
    const q = String(req.query.q || "").replace(/['"\\%_]/g, "").trim();

    // 表示に使う項目（Name が無いオブジェクトにも対応）
    let nameField = _lookupNameField.get(sobject);
    if (!nameField) {
      try {
        const desc = await describeObject(req.user, sobject);
        const f = (desc.fields || []).find((x) => x.nameField) ||
                  (desc.fields || []).find((x) => x.name === "Name");
        nameField = (f && f.name) || "Name";
      } catch { nameField = "Name"; }
      _lookupNameField.set(sobject, nameField);
    }

    const where = q ? ` WHERE ${nameField} LIKE '%${q}%'` : "";
    const soql = `SELECT Id, ${nameField} FROM ${sobject}${where} ORDER BY ${nameField} LIMIT 50`;
    const d = await sfQuery(req.user, soql);
    const records = (d.records || []).map((r) => ({ id: r.Id, name: r[nameField] || r.Id }));
    res.json({ records, nameField, sobject });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// キャンペーン一覧（主キャンペーンソースの選択用）
app.get("/api/salesforce/campaigns", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const q = String(req.query.q || "").replace(/['"\\%_]/g, "").trim();
    const where = ["IsDeleted = false"];
    if (q) where.push(`Name LIKE '%${q}%'`);
    let records = [];
    try {
      const d = await sfQuery(req.user, `SELECT Id, Name, IsActive FROM Campaign WHERE ${where.join(" AND ")} ORDER BY IsActive DESC, CreatedDate DESC LIMIT 300`);
      records = d.records || [];
    } catch {
      const d = await sfQuery(req.user, `SELECT Id, Name FROM Campaign ORDER BY CreatedDate DESC LIMIT 300`);
      records = d.records || [];
    }
    res.json({ records: records.map((r) => ({ id: r.Id, name: r.Name, active: r.IsActive !== false })) });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// リードを探す
app.get("/api/salesforce/leads", async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    const records = await searchLeads(req.user, {
      company: req.query.company || "",
      person: req.query.person || "",
    });
    res.json({ records });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// 入力した項目を保存してから、リードをコンバートする
app.post("/api/salesforce/leads/:id/convert", async (req, res) => {
  try {
    const b = req.body || {};
    const fields = b.fields && typeof b.fields === "object" ? b.fields : {};
    if (Object.keys(fields).length) await updateLead(req.user, req.params.id, fields);
    // 「アポ獲得日」が空だとコンバートで弾かれる。画面で入れていなければ今日を入れる。
    try {
      const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
      const rr = await ensureLeadApoDate(req.user, req.params.id, String(b.apoDate || today).slice(0, 10));
      if (rr && rr.filled) console.log(`[SF立ち上げ] アポ獲得日を入れました → ${rr.value}`);
    } catch (e) {
      console.warn("[SF立ち上げ] アポ獲得日を入れられませんでした:", e.message);
    }
    try {
      const stc = await getSettings().catch(() => ({}));
      const cs = String(b.campaignSource ||
        (stc.sfCampaignSource === undefined ? DEFAULT_CAMPAIGN_SOURCE : stc.sfCampaignSource)).trim();
      if (cs) {
        const rc = await ensureLeadCampaignSource(req.user, req.params.id, cs);
        if (rc && rc.filled) console.log(`[SF立ち上げ] 主キャンペーンソースを入れました → ${cs}`);
      }
      const fs = String(b.fsNote ||
        (stc.sfFsNote === undefined ? DEFAULT_FS_NOTE : stc.sfFsNote)).trim();
      if (fs) {
        const rf = await ensureLeadFsNote(req.user, req.params.id, fs);
        if (rf && rf.filled) console.log(`[SF立ち上げ] FSへの案件パス情報を入れました → ${fs}`);
      }
    } catch (e) {
      console.warn("[SF立ち上げ] 必須項目を入れられませんでした:", e.message);
    }
    const ownerId = await getSfUserId(req.user).catch(() => "");

    // 立ち上げに失敗したときに作り直せるよう、リードの中身を控えておく
    let snapshot = null;
    try { snapshot = await snapshotLead(req.user, req.params.id); }
    catch (e) { console.warn("[SF立ち上げ] リードの控えを取れませんでした:", e.message); }

    const convArgs = {
      leadId: req.params.id,
      convertedStatus: b.convertedStatus || "",
      opportunityName: b.opportunityName || "",
      ownerId,
    };
    let r;
    try {
      r = await convertLead(req.user, convArgs);
    } catch (e) {
      // 重複ルールで止められたときは、そのまま通して新しく取引先と担当者を作る。
      // 既存に紐づけるには、その取引先への編集権限が必要になるため。
      if (!e.duplicate) throw e;
      console.log("[SF立ち上げ] 重複と判定されましたが、新しく取引先と担当者を作ります");
      r = await convertLead(req.user, { ...convArgs, allowDuplicate: true });
    }

    // コンバートで商談が作られなかった場合は、こちらで作る（立ち上げ漏れを防ぐ）
    let createdOpportunity = false;
    let oppId = r && (r.opportunityId || r.opportunity_id);
    if (!oppId && r && (r.accountId || r.account_id)) {
      try {
        const stage = await firstOpportunityStage(req.user);
        const close = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
        oppId = await createOpportunity(req.user, {
          name: b.opportunityName || "新規商談",
          accountId: r.accountId || r.account_id,
          stageName: stage || "01：アポ獲得",
          closeDate: close,
          ownerId,
        });
        createdOpportunity = true;
        console.log(`[SF立ち上げ] 商談が作られなかったので作成しました: ${oppId}`);
      } catch (e) {
        console.error("[SF立ち上げ] 商談の作成に失敗", e.message);

        // 商談が作れなかったので、元に戻す。
        // Salesforceはコンバートの取り消しができないため、同じ内容でリードを作り直す。
        let restoredLeadId = null;
        const cleaned = [];
        try {
          if (snapshot) {
            restoredLeadId = await createLead(req.user, snapshot);
            console.log(`[SF立ち上げ] リードを作り直しました: ${restoredLeadId}`);
          }
          // 変換で新しく作られた取引先責任者・取引先を片付ける（元からあったものは消さない）
          const cid = r.contactId || r.contact_id;
          const aid = r.accountId || r.account_id;
          if (cid && (await isFreshlyCreated(req.user, "Contact", cid))) {
            if (await deleteRecord(req.user, "Contact", cid)) cleaned.push("取引先責任者");
          }
          if (aid && (await isFreshlyCreated(req.user, "Account", aid))) {
            if (await deleteRecord(req.user, "Account", aid)) cleaned.push("取引先");
          }
        } catch (e2) {
          console.error("[SF立ち上げ] 元に戻す処理で失敗", e2.message);
        }

        return res.json({
          ...r,
          opportunityId: null,
          restoredLeadId,
          cleaned,
          warning:
            "商談を作れなかったため、立ち上げを取り消しました：" + String(e.message).slice(0, 200) +
            (restoredLeadId ? "／同じ内容のリードを作り直しました" : "／リードの作り直しはできませんでした") +
            (cleaned.length ? `／${cleaned.join("・")}を削除しました` : ""),
        });
      }
    }
    console.log(`[SF立ち上げ] 経路=${r.via || "rest"} 商談=${oppId || "なし"}${createdOpportunity ? "（kinbotが作成）" : ""}`);
    res.json({ ...r, opportunityId: oppId || null, createdOpportunity, via: r.via || "rest" });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// SF Opportunityのフィールド定義を取得
app.get("/api/salesforce/describe", async (req, res) => {
  try {
    const desc = await describeOpportunity(req.user);
    const fields = (desc.fields || []).map(f => ({
      name: f.name, label: f.label, type: f.type,
      updateable: f.updateable, custom: f.custom,
      createable: f.createable,
      nillable: f.nillable,                 // falseなら必須
      defaultedOnCreate: f.defaultedOnCreate,
      referenceTo: f.referenceTo || [],
      dependentPicklist: !!f.dependentPicklist, // 従属ピックリストか
      controllerName: f.controllerName || null,  // 上位（制御）項目のAPI名
      picklistValues: f.picklistValues?.filter(v => v.active).map(v => ({ value: v.value, label: v.label, validFor: v.validFor || null })),
    }));
    res.json({ fields, totalFields: fields.length, customFields: fields.filter(f => f.custom).length });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// SF活動（Task）を作成
// Opportunityのページレイアウトから、セクション（SS01〜SS06など）と項目を返す
app.get("/api/salesforce/opportunity-layout", async (req, res) => {
  try {
    const data = await describeOpportunityLayout(req.user);
    const sections = [];
    const seen = new Set();
    for (const layout of data.layouts || []) {
      const secs = layout.editLayoutSections || layout.detailLayoutSections || [];
      for (const sec of secs) {
        const heading = (sec.heading || "").trim();
        const fields = [];
        for (const row of sec.layoutRows || []) {
          for (const item of row.layoutItems || []) {
            for (const comp of item.layoutComponents || []) {
              if (comp.type === "Field" && comp.details && comp.details.name) {
                fields.push(comp.details.name); // updateableはクライアント側でdescribeを見て判定
              }
            }
          }
        }
        const key = heading + "|" + fields.join(",");
        if (heading && fields.length && !seen.has(key)) {
          seen.add(key);
          sections.push({ heading, fields });
        }
      }
    }
    console.log(`[sf layout] セクション数=${sections.length}` + (sections.length ? "（" + sections.map((s) => s.heading).join(" / ") + "）" : ""));
    res.json({ sections });
  } catch (e) {
    console.warn("[sf layout] 取得失敗:", e.message);
    sfErrorResponse(res, e);
  }
});

// Task（活動）の項目定義を返す（活動記録フォームを実項目ベースで作るため）
app.get("/api/salesforce/task-describe", async (req, res) => {
  try {
    const desc = await describeTask(req.user);
    const fields = (desc.fields || []).map(f => ({
      name: f.name, label: f.label, type: f.type,
      updateable: f.updateable, createable: f.createable, custom: f.custom,
      required: !!(f.createable && f.nillable === false && !f.defaultedOnCreate), // 入力必須
      picklistValues: f.picklistValues?.filter(v => v.active).map(v => ({ value: v.value, label: v.label })),
    }));
    const picks = fields.filter((f) => f.type === "picklist" && f.custom).map((f) => f.label);
    console.log(`[sf task-describe] 項目数=${fields.length} / カスタム選択肢項目=${picks.join("、") || "なし"}`);
    res.json({ fields });
  } catch (e) {
    console.warn("[sf task-describe] 取得失敗:", e.message);
    sfErrorResponse(res, e);
  }
});

let _taskFieldCache = { at: 0, map: null };
async function taskFieldNames(owner) {
  if (_taskFieldCache.map && Date.now() - _taskFieldCache.at < 60 * 1000) return _taskFieldCache.map;
  const normL = (x) => String(x || "").replace(/[\s　()（）_]/g, "").toLowerCase();
  const map = { actKind: "", nextKind: "", nextDate: "", statusPicklist: [] };
  try {
    const desc = await describeTask(owner);
    for (const f of desc.fields || []) {
      const L = normL(f.label);
      if (!map.actKind && L === "活動種別") map.actKind = f.name;
      if (!map.nextKind && L === "次回アクション種別") map.nextKind = f.name;
      if (!map.nextDate && L === "次回アクション日") map.nextDate = f.name;
      if (f.name === "Status") map.statusPicklist = (f.picklistValues || []).map((v) => v.value);
    }
  } catch (e) { console.warn("[sf] Taskの項目を読めませんでした", e.message); }
  _taskFieldCache = { at: Date.now(), map };
  return map;
}

app.post("/api/salesforce/task", async (req, res) => {
  try {
    const { opportunityId, fields, subject, type, description, status, activityDate } = req.body || {};
    if (!opportunityId) return res.status(400).json({ error: "商談IDが必要です" });
    const data = { WhatId: opportunityId };
    if (fields && typeof fields === "object") Object.assign(data, fields); // 実項目ベースの入力
    // 後方互換（旧フォーム）
    if (subject && data.Subject === undefined) data.Subject = subject;
    if (type && data.Type === undefined) data.Type = type;
    if (description !== undefined && data.Description === undefined) data.Description = description;
    if (status && data.Status === undefined) data.Status = status;
    if (activityDate && data.ActivityDate === undefined) data.ActivityDate = activityDate;
    // 既定値
    if (!data.Subject) data.Subject = "[kinbot] 活動記録";
    // 次回アクションが入っている活動は「未着手」で作る。
    // そうしないと、やることが残っているのに最初から完了扱いになり、
    // 過去の活動のチェックが意味を持たなくなる。
    if (!data.Status) {
      const fn = await taskFieldNames(req.user).catch(() => ({}));
      const hasNext =
        (fn.nextKind && data[fn.nextKind]) || (fn.nextDate && data[fn.nextDate]);
      const list = fn.statusPicklist || [];
      const openValue =
        list.find((v) => /^(未着手|未完了|未対応|未実施|オープン|Not Started|Open)$/i.test(String(v).trim())) ||
        list.find((v) => /^(未|Not|Open)/i.test(String(v).trim())) || "未着手";
      const doneValue =
        list.find((v) => /^(完了|済|完了済|Completed|Closed)$/i.test(String(v).trim())) ||
        list.find((v) => /完了|Completed/i.test(String(v)) && !/^未/.test(String(v).trim())) || "完了";
      data.Status = hasNext ? openValue : doneValue;
    }
    // ActivityDate はSalesforce側で更新日として扱われるため、記録した日を入れる。
    // 次回アクションの日付は専用の項目に入る（フォーム側で指定）。
    if (!data.ActivityDate) data.ActivityDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const task = await createTask(req.user, data); // 存在しない項目は自動で外して再送
    // 作成時に入らなかった項目（活動種別などのカスタム項目）を、後追いのupdateで確実に反映する
    const taskId = task && (task.id || task.Id);
    if (taskId) {
      try { await updateTask(req.user, taskId, data); }
      catch (e) { console.warn("[sf task] 後追いupdate失敗", e.message); }
    }
    res.json({ ok: true, task });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// 商談にSF商談リンクを保存
app.put("/api/meetings/:id/sf-link", async (req, res) => {
  try {
    await setMeetingSfUrl(req.params.id, (req.body && req.body.url) || "");
    res.json({ ok: true });
  } catch (e) {
    sfErrorResponse(res, e);
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

// 会社プロフィール(kinbot) → SF Account の空欄補完に使うマッピング。
// sfMappingAccount = { industry: "Industry", employees: "NumberOfEmployees", region: "BillingState", ... }
const SF_ACCOUNT_SOURCES = [
  { key: "industry", label: "業界" },
  { key: "employees", label: "従業員規模" },
  { key: "region", label: "地域" },
];
function buildAccountProposed(profile) {
  const p = profile || {};
  return {
    industry: p.industry || p.industry_name || "",
    employees: p.employees != null ? String(p.employees) : (p.employee_range || ""),
    region: p.region || p.prefecture || p.area || "",
  };
}

// 会社名から SF商談の候補を検索して返す（リンク未入力でも自動で見つける）
app.post("/api/meetings/:id/sf-candidates", async (req, res) => {
  try {
    const out = { configured: salesforceConfigured(), connected: false, records: [] };
    if (!out.configured) return res.json({ ...out, reason: "未設定" });
    out.connected = await sfConnected(req.user);
    if (!out.connected) return res.json({ ...out, reason: "未連携" });

    const m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "見つかりません" });

    const q = ((req.body && req.body.q) || m.account || "").trim();
    if (!q) return res.json({ ...out, needQuery: true });

    const info = await sfInfo(req.user);
    const base = (info.instanceUrl || "").replace(/\/+$/, "");
    const records = await searchOpportunities(req.user, q);
    out.records = (records || []).map((r) => ({
      id: r.Id,
      name: r.Name,
      account: (r.Account && r.Account.Name) || "",
      stage: r.StageName || "",
      amount: r.Amount != null ? r.Amount : null,
      closeDate: r.CloseDate || "",
      url: base ? `${base}/lightning/r/Opportunity/${r.Id}/view` : r.Id,
    }));
    res.json({ ...out, query: q });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// 空欄補完 + 活動履歴を「1商談ぶん」まとめて自動反映する。
// 上書きは一切しない（空の項目だけ埋める）。活動履歴はbotId(=meeting id)で冪等。
// endpoint と 自動反映(extract後) の両方から呼ぶ共通ヘルパー。
async function autofillMeetingToSf(user, meeting, url) {
  const m = meeting;
  const recordId = extractRecordId(url || m.sf_url || "");
  if (!recordId) return { ok: false, needLink: true };

  const settings = await getUserSettings(user);
  const mapping = settings.sfMapping || {};
  const accountMapping = settings.sfMappingAccount || {};

  // 1) Opportunity 側の空欄補完（mappingで指定された項目のみ）
  const oppProposedRaw = buildProposed(m);
  const oppProposed = {};
  for (const s of SF_SOURCES) {
    const sfField = mapping[s.key];
    if (sfField && oppProposedRaw[s.key]) oppProposed[sfField] = oppProposedRaw[s.key];
  }
  let oppResult = { filled: {}, skipped: {} };
  if (Object.keys(oppProposed).length > 0) {
    oppResult = await fillEmptyFields(user, "Opportunity", recordId, oppProposed);
  }

  // 2) Account 側の空欄補完
  let accResult = { filled: {}, skipped: {} };
  let accountId = null;
  if (Object.keys(accountMapping).length > 0) {
    const opp = await getOpportunity(user, recordId, ["AccountId"]);
    accountId = opp && opp.AccountId;
    if (accountId) {
      const profile = m.company_profile || m.account_profile || {};
      const accProposedRaw = buildAccountProposed(profile);
      const accProposed = {};
      for (const s of SF_ACCOUNT_SOURCES) {
        const sfField = accountMapping[s.key];
        if (sfField && accProposedRaw[s.key]) accProposed[sfField] = accProposedRaw[s.key];
      }
      if (Object.keys(accProposed).length > 0) {
        accResult = await fillEmptyFields(user, "Account", accountId, accProposed);
      }
    }
  }

  // 3) 活動履歴（Task）を冪等作成
  const s = m.summary || {};
  const desc =
    (s.overview || "") +
    (Array.isArray(s.action_items) && s.action_items.length
      ? "\n\n【次のアクション】\n・" + s.action_items.join("\n・")
      : "");
  const task = await createTaskIdempotent(user, String(m.id), {
    WhatId: recordId,
    Subject: `[kinbot] ${m.title || "商談"}（第${m.round || 1}回）`,
    Type: "Meeting",
    Description: desc.slice(0, 30000),
    Status: "完了",
    ActivityDate: (m.meeting_date || new Date().toISOString()).slice(0, 10),
  });

  const filledCount =
    Object.keys(oppResult.filled || {}).length + Object.keys(accResult.filled || {}).length;
  const activityCreated = !!(task && task.created);
  // 活動履歴を作れたら「SFを更新した」ものとして残す。
  // 商談が終わったあと、これが自動で動くので、手で押さなくても済む。
  if (activityCreated || filledCount) {
    await recordSfUpdate({
      botId: String(m.id),
      oppId: recordId,
      stage: "",
      note: activityCreated ? "活動履歴を自動で作成" : `${filledCount}項目を自動で入力`,
      owner: user,
    }).catch(() => {});
  }
  // 「得」の記録：実際に何かした反映のみカウント
  await recordSfStats(user, { filled: filledCount, activityCreated });

  return { ok: true, recordId, accountId, opportunity: oppResult, account: accResult, activity: task };
}

// 「得を見える化」する統計を積み上げる。user_settings.sfStats に保存。
async function recordSfStats(user, { filled, activityCreated }) {
  try {
    if (!filled && !activityCreated) return; // 何も起きていない反映は数えない
    const settings = await getUserSettings(user);
    const st = settings.sfStats || { runs: 0, fieldsFilled: 0, activities: 0, monthly: {} };
    const mk = new Date().toISOString().slice(0, 7); // YYYY-MM
    st.runs = (st.runs || 0) + 1;
    st.fieldsFilled = (st.fieldsFilled || 0) + (filled || 0);
    st.activities = (st.activities || 0) + (activityCreated ? 1 : 0);
    st.lastAt = new Date().toISOString();
    st.monthly = st.monthly || {};
    const mm = st.monthly[mk] || { runs: 0, fieldsFilled: 0, activities: 0 };
    mm.runs += 1;
    mm.fieldsFilled += filled || 0;
    mm.activities += activityCreated ? 1 : 0;
    st.monthly[mk] = mm;
    await saveUserSettings(user, { sfStats: st });
  } catch (e) {
    console.warn("[sf-stats]", e.message);
  }
}

// 商談に紐づく過去の活動（Task）の履歴を取得
// 活動（Task）を更新
app.patch("/api/salesforce/task/:id", async (req, res) => {
  try {
    await updateTask(req.user, req.params.id, req.body || {});
    res.json({ ok: true });
  } catch (e) { sfErrorResponse(res, e); }
});

// 活動（Task）を削除
app.delete("/api/salesforce/task/:id", async (req, res) => {
  try {
    await deleteTask(req.user, req.params.id);
    res.json({ ok: true });
  } catch (e) { sfErrorResponse(res, e); }
});

// 活動（Task）の項目のうち、ラベルから「活動種別」「次回アクション種別」「次回アクション日」を探す。
// 組織ごとにAPI名が違うため、describeの結果から毎回引く（1分キャッシュ）。

app.get("/api/salesforce/task-field-names", async (req, res) => {
  try { res.json(await taskFieldNames(req.user)); }
  catch (e) { sfErrorResponse(res, e); }
});

app.get("/api/salesforce/tasks", async (req, res) => {
  try {
    const oppId = String(req.query.opportunityId || "").replace(/[^a-zA-Z0-9]/g, "");
    if (!oppId) return res.status(400).json({ error: "opportunityIdが必要です" });
    const fn = await taskFieldNames(req.user);
    // 次回アクションの種別・日も一緒に取る（過去の活動で別々に見せるため）
    const extra = [fn.actKind, fn.nextKind, fn.nextDate].filter(Boolean).join(", ");
    const soql = `SELECT Id, Subject, Status, IsClosed, ActivityDate, Description, CreatedDate, Owner.Name` +
      `${extra ? ", " + extra : ""} FROM Task WHERE WhatId = '${oppId}' ORDER BY CreatedDate DESC LIMIT 30`;
    const data = await sfQuery(req.user, soql);
    const tasks = (data.records || []).map((t) => ({
      id: t.Id, subject: t.Subject, status: t.Status, isClosed: !!t.IsClosed,
      activityDate: t.ActivityDate, description: t.Description,
      createdDate: t.CreatedDate, owner: (t.Owner && t.Owner.Name) || "",
      actKind: fn.actKind ? t[fn.actKind] || "" : "",
      nextKind: fn.nextKind ? t[fn.nextKind] || "" : "",
      nextDate: fn.nextDate ? t[fn.nextDate] || "" : "",
    }));
    res.json({ tasks, fieldNames: fn });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// 次回アクションを Salesforce の活動として登録する。
// 状況は「未着手」で作るので、やることとして残り、チェックで完了にできる。
app.post("/api/salesforce/next-action", async (req, res) => {
  try {
    const b = req.body || {};
    const oppId = String(b.opportunityId || "").replace(/[^a-zA-Z0-9]/g, "");
    const kind = String(b.kind || "").trim();
    const content = String(b.content || "").trim();
    if (!oppId) return res.status(400).json({ error: "商談が紐づいていません" });
    if (!kind) return res.status(400).json({ error: "種別を選んでください" });
    if (!content) return res.status(400).json({ error: "内容を入れてください" });

    const fn = await taskFieldNames(req.user);
    const list = fn.statusPicklist || [];
    const openValue =
      list.find((v) => /^(未着手|未完了|未対応|未実施|オープン|Not Started|Open)$/i.test(String(v).trim())) ||
      list.find((v) => /^(未|Not|Open)/i.test(String(v).trim())) ||
      "未着手";
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const data = {
      WhatId: oppId,
      Subject: `[次回アクション] ${kind}`,
      Description: content,
      Status: openValue,
      // ActivityDate はSalesforce側で更新日として扱われるため、記録した日を入れる。
      // 入力された日付は「次回アクション日」の項目にだけ入れる。
      ActivityDate: today,
    };
    if (fn.nextKind) data[fn.nextKind] = kind;
    if (fn.nextDate && b.dueDate) data[fn.nextDate] = b.dueDate;

    const task = await createTask(req.user, data);
    const taskId = task && (task.id || task.Id);
    // 作成時に落ちたカスタム項目を、後追いで入れ直す
    if (taskId && (fn.nextKind || fn.nextDate)) {
      const after = {};
      if (fn.nextKind) after[fn.nextKind] = kind;
      if (fn.nextDate && b.dueDate) after[fn.nextDate] = b.dueDate;
      try { await updateTask(req.user, taskId, after); } catch {}
    }
    // 「次回アクション日」の項目が組織に無いと、入力した日付は入らない
    const warn = (b.dueDate && !fn.nextDate)
      ? "Salesforceに「次回アクション日」の項目が見つからないため、日付は登録されていません。"
      : "";
    console.log(`[sf-next] ${oppId} に次回アクションを登録（${kind}／次回アクション日 ${b.dueDate || "なし"}） by ${req.user}`);
    res.json({ ok: true, id: taskId || null, warn });
  } catch (e) { sfErrorResponse(res, e); }
});

// 活動のチェックを入れる／外す（Salesforceの状況を完了・未着手に切り替える）
app.put("/api/salesforce/task/:id/status", async (req, res) => {
  try {
    const id = String(req.params.id || "").replace(/[^a-zA-Z0-9]/g, "");
    if (!id) return res.status(400).json({ error: "活動IDが必要です" });
    const fn = await taskFieldNames(req.user);
    const done = req.body?.done !== false;
    // 組織の選択肢から、完了／未着手にあたる値を選ぶ
    // 状況の選択肢は組織ごとに違う（完了／未着手／未完了／未対応／Completed など）。
    // 「未完了」は「完了」にも一致してしまうので、未完了側を先に判定する。
    const list = fn.statusPicklist || [];
    const findOpen = () =>
      list.find((v) => /^(未着手|未完了|未対応|未実施|オープン|Not Started|Open)$/i.test(String(v).trim())) ||
      list.find((v) => /^(未|Not|Open)/i.test(String(v).trim())) ||
      "未着手";
    const findDone = () =>
      list.find((v) => /^(完了|済|完了済|Completed|Closed)$/i.test(String(v).trim())) ||
      list.find((v) => /完了|Completed/i.test(String(v)) && !/^未/.test(String(v).trim())) ||
      "完了";
    const value = done ? findDone() : findOpen();
    await updateTask(req.user, id, { Status: value });
    console.log(`[sf-task] ${id} の状況を「${value}」にしました by ${req.user}`);
    res.json({ ok: true, status: value });
  } catch (e) { sfErrorResponse(res, e); }
});

// 段階の各項目を、商談の内容から読み取って提案する（フォームに入れて確認・編集してから更新）
// 取引先責任者（Contact）一覧＋役割の選択肢
app.get("/api/salesforce/contacts", async (req, res) => {
  try {
    const accountId = String(req.query.accountId || "");
    const [contacts, roles] = await Promise.all([
      listAccountContacts(req.user, accountId).catch(() => []),
      describeContactRolePicklist(req.user).catch(() => []),
    ]);
    res.json({ contacts, roles });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// 商品の横断診断：Product2・PricebookEntry・全Pricebookを調べて、商品がどこにあるか特定する
app.get("/api/salesforce/product-diagnose", async (req, res) => {
  try {
    const q = String(req.query.q || "エントリー").replace(/['\\%_]/g, "");
    const like = `%${q}%`;
    const [prod, pbe, pbs] = await Promise.all([
      sfQuery(req.user, `SELECT Id, Name, IsActive, Family, ProductCode FROM Product2 WHERE Name LIKE '${like}' ORDER BY Name LIMIT 100`).catch((e) => ({ error: e.message })),
      sfQuery(req.user, `SELECT Id, Name, Product2.Name, Pricebook2.Name, IsActive, UnitPrice FROM PricebookEntry WHERE Product2.Name LIKE '${like}' OR Name LIKE '${like}' ORDER BY Pricebook2.Name LIMIT 300`).catch((e) => ({ error: e.message })),
      sfQuery(req.user, `SELECT Id, Name, IsActive, IsStandard FROM Pricebook2 ORDER BY Name LIMIT 100`).catch((e) => ({ error: e.message })),
    ]);
    res.json({
      query: q,
      products: (prod.records || []).map((p) => ({ id: p.Id, name: p.Name, active: p.IsActive, family: p.Family || "", code: p.ProductCode || "" })),
      entries: (pbe.records || []).map((e) => ({ id: e.Id, product: (e.Product2 && e.Product2.Name) || e.Name, pricebook: (e.Pricebook2 && e.Pricebook2.Name) || "", active: e.IsActive, price: e.UnitPrice })),
      pricebooks: (pbs.records || []).map((p) => ({ name: p.Name, active: p.IsActive, standard: p.IsStandard })),
      errors: { products: prod.error || null, entries: pbe.error || null, pricebooks: pbs.error || null },
    });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// 登録済み商品の一覧
app.get("/api/salesforce/line-items", async (req, res) => {
  try {
    const opportunityId = String(req.query.opportunityId || "");
    if (!opportunityId) return res.status(400).json({ error: "商談IDが必要です" });
    const items = await listOpportunityLineItems(req.user, opportunityId);
    res.json({ items });
  } catch (e) { sfErrorResponse(res, e); }
});

// 商品を更新
app.patch("/api/salesforce/line-item/:id", async (req, res) => {
  try {
    await updateOpportunityLineItem(req.user, req.params.id, req.body || {});
    res.json({ ok: true });
  } catch (e) { sfErrorResponse(res, e); }
});

// 商品を削除
app.delete("/api/salesforce/line-item/:id", async (req, res) => {
  try {
    await deleteOpportunityLineItem(req.user, req.params.id);
    res.json({ ok: true });
  } catch (e) { sfErrorResponse(res, e); }
});

// 商談に登録できる商品（PricebookEntry）一覧＋登録項目（売上・原価・提供日など）
app.get("/api/salesforce/products", async (req, res) => {
  try {
    const opportunityId = String(req.query.opportunityId || "");
    if (!opportunityId) return res.status(400).json({ error: "商談IDが必要です" });
    const [out, allFields] = await Promise.all([
      getOpportunityProducts(req.user, opportunityId),
      describeLineItem(req.user).catch(() => []),
    ]);
    // 入力に出す項目：必須のもの＋売上/原価/提供日っぽいもの（標準の数量・単価・小計・PricebookEntryは除く）
    const skip = /^(Id|OpportunityId|PricebookEntryId|Product2Id|Quantity|UnitPrice|TotalPrice|ListPrice|IsDeleted|Created|LastModified|SystemModstamp|SortOrder|Subtotal|Discount)$/i;
    // 必須の項目と、提供日・売上・原価などの実務で使う項目だけに絞る。
    // 【積上用】などの集計項目・フラグ・メモは入力させない（数が多くなりすぎるため）
    const noisy = /^【|積上|フラグ|メモ|発注確認|販売管理|料率/;
    const fields = (allFields || []).filter((f) =>
      f.createable && !skip.test(f.name) && !["reference", "address", "location"].includes(f.type) &&
      !noisy.test(String(f.label || "")) &&
      (f.required || f.name === "ServiceDate" || /提供日|売上|原価/.test(f.label || ""))
    );
    res.json({ ...out, fields });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// 商談に商品を登録
app.post("/api/salesforce/product", async (req, res) => {
  try {
    const { opportunityId, pricebookEntryId, pricebookId, quantity, unitPrice, fields } = req.body || {};
    if (!opportunityId || !pricebookEntryId) return res.status(400).json({ error: "商談IDと商品が必要です" });
    const out = await addOpportunityLineItem(req.user, { opportunityId, pricebookEntryId, pricebookId, quantity, unitPrice, fields });
    res.json({ ok: true, result: out });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// 取引先責任者（Contact）を新規作成
app.post("/api/salesforce/contact", async (req, res) => {
  try {
    const { accountId, lastName, firstName, title, email } = req.body || {};
    if (!lastName) return res.status(400).json({ error: "氏名（姓）が必要です" });
    const out = await createContact(req.user, { accountId, lastName, firstName, title, email });
    res.json({ ok: true, id: out.id });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// 取引先責任者の役割（主担当）を設定
app.post("/api/salesforce/contact-role", async (req, res) => {
  try {
    const { opportunityId, contactId, role, isPrimary } = req.body || {};
    if (!opportunityId || !contactId) return res.status(400).json({ error: "商談IDと取引先責任者が必要です" });
    const out = await createContactRole(req.user, { opportunityId, contactId, role, isPrimary: !!isPrimary });
    res.json({ ok: true, result: out });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

app.post("/api/salesforce/field-suggest", async (req, res) => {
  try {
    const { botId, fields } = req.body || {};
    if (!botId || !Array.isArray(fields) || !fields.length) return res.status(400).json({ error: "botIdとfieldsが必要です" });
    const m = await getMeeting(botId);
    if (!m) return res.status(404).json({ error: "商談が見つかりません" });
    let summary = "";
    if (m.summary) summary = typeof m.summary === "string" ? m.summary : JSON.stringify(m.summary);
    // 文字起こしは配列なので、そのまま連結すると [object Object] になってしまう。話者付きの文章にする。
    const trText = Array.isArray(m.transcript)
      ? m.transcript.map((u) => `${(u && u.speaker && u.speaker.name) || "話者"}: ${(u && u.text) || ""}`).join("\n")
      : String(m.transcript || "");
    const mDate = m.created_at ? new Date(m.created_at) : new Date();
    const ymdOf = (d) => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const content =
      `【商談実施日】${ymdOf(mDate)}\n【今日】${ymdOf(new Date())}\n\n` +
      (summary ? "【要約】\n" + summary + "\n\n" : "") +
      (m.note ? "【商談メモ】\n" + m.note + "\n\n" : "") +
      "【文字起こし】\n" + trText;
    if (!trText.trim() && !summary) return res.json({ values: {} });
    const fieldLines = fields.map((f) => {
      let line = `- ${f.label}（キー:${f.api}`;
      if (f.type === "date" || f.type === "datetime") line += "・日付 YYYY-MM-DD";
      if (Array.isArray(f.options) && f.options.length) {
        line += "・選択肢:[" + f.options.join(" / ") + "] から選ぶ";
        // 複数選べる項目は、当てはまるものを全部返してもらう
        if (f.type === "multipicklist") line += "・当てはまるものを全て、セミコロン( ; )で区切って返す";
      }
      line += "）";
      return line;
    }).join("\n");
    const prompt =
      "あなたはSalesforceの商談項目を、商談の内容から埋めるアシスタントです。\n" +
      "以下の各項目について、商談の内容から読み取れる値を日本語で簡潔に記入してください。\n" +
      "・読み取れない項目は空文字にする（推測で埋めない）。\n" +
      "・日付は YYYY-MM-DD 形式。「来週の火曜」「月末」などの言い方は、上の【商談実施日】を基準に実際の日付へ直す。\n" +
      "・次回アクション日は、次回の打ち合わせ日や、宿題の期限として話に出た日付を入れる。\n" +
      "・次回アクション種別は、次に何をするか（再商談・電話・メールなど）を選択肢から選ぶ。\n" +
      "・失注理由や受失注理由は、顧客が断った理由・保留した理由に最も近い選択肢を選ぶ。\n" +
      "・選択肢がある項目は、必ず選択肢の中から最も近いものを選ぶ。選択肢の文字列をそのまま返す。\n" +
      "・「当てはまるものを全て」と書かれた項目は、該当する選択肢を全てセミコロン( ; )でつないで返す。\n" +
      "  例：新卒とアルバイトの話が出ていれば「新卒;アルバイト」。話に出ていないものは入れない。\n" +
      "・当てはまるものが無い項目は、無理に選ばず空文字にする。\n" +
      // 現場の運用に合わせた個別の指示。ここが空だと毎回選び直すことになる。
      "\n【項目ごとの決め方】\n" +
      "・初回提案商品：商談で具体的に案内したプランを選ぶ。どのプランか話に出ていない場合は「エントリープラン」にする（初回商談での標準提案のため）。\n" +
      "・利用目的：どの採用（新卒・中途・アルバイト・派遣など）の話だったかを、商談の内容から判断して当てはまるものを全て選ぶ。\n" +
      "  「新卒採用で困っている」「来年の新卒」→ 新卒。「中途」「経験者」「即戦力」→ 中途。「アルバイト」「パート」「学生スタッフ」→ アルバイト。\n" +
      "  採用以外（社内コミュニケーション・ブランディング）の話が主だった場合はそれを選ぶ。\n" +
      "  どの採用区分の話か読み取れない場合は空文字にする。「採用活動」は区分が不明なときの逃げに使わない。\n" +
      "・担当者が解決したい課題：顧客が困っていると述べた内容に最も近い選択肢を選ぶ。\n" +
      "・出力はJSONオブジェクトのみ。キーは各項目の「キー」、値は記入する文字列。説明やコードブロックは不要。\n\n" +
      "【項目】\n" + fieldLines;
    const out = await runCustomAnalysis(String(content).slice(0, 40000), prompt);
    let values = {};
    try {
      const txt = String(out || "").replace(/```json|```/g, "").trim();
      const mm = txt.match(/\{[\s\S]*\}/);
      values = mm ? JSON.parse(mm[0]) : {};
    } catch { values = {}; }
    // 空・null は除外
    const clean = {};
    for (const k of Object.keys(values)) {
      const v = values[k];
      if (v != null && String(v).trim() !== "") clean[k] = String(v).trim();
    }
    res.json({ values: clean });
  } catch (e) {
    console.error("[field-suggest]", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/meetings/:id/sf-autofill", async (req, res) => {
  try {
    const out = { ok: false, configured: salesforceConfigured(), connected: false };
    if (!out.configured) return res.json({ ...out, reason: "未設定" });
    out.connected = await sfConnected(req.user);
    if (!out.connected) return res.json({ ...out, reason: "未連携" });

    const m = await getMeeting(req.params.id);
    if (!m) return res.status(404).json({ error: "見つかりません" });

    const r = await autofillMeetingToSf(req.user, m, (req.body && req.body.url) || "");
    if (r.needLink) return res.json({ ...out, needLink: true });
    res.json({ ...out, ...r });
  } catch (e) {
    console.error("[sf-autofill]", e.message);
    sfErrorResponse(res, e);
  }
});

// 自動反映のON/OFF設定を保存
app.put("/api/salesforce/auto-reflect", async (req, res) => {
  try {
    const enabled = !!(req.body && req.body.enabled);
    await saveUserSettings(req.user, { sfAutoReflect: enabled });
    res.json({ ok: true, enabled });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// 「得を見える化」統計 + 自動反映設定を返す
app.get("/api/salesforce/stats", async (req, res) => {
  try {
    const settings = await getUserSettings(req.user);
    const st = settings.sfStats || { runs: 0, fieldsFilled: 0, activities: 0, monthly: {} };
    const mk = new Date().toISOString().slice(0, 7);
    const month = (st.monthly && st.monthly[mk]) || { runs: 0, fieldsFilled: 0, activities: 0 };
    res.json({
      autoReflect: settings.sfAutoReflect !== false,
      total: { runs: st.runs || 0, fieldsFilled: st.fieldsFilled || 0, activities: st.activities || 0 },
      month: { key: mk, runs: month.runs || 0, fieldsFilled: month.fieldsFilled || 0, activities: month.activities || 0 },
    });
  } catch (e) {
    sfErrorResponse(res, e);
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
    sfErrorResponse(res, e);
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
    sfErrorResponse(res, e);
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
// 商談名が「初回商談」を表すか（【新/ヒ】【初回/】【初回/コールド】【初回/過去失注】など）。
// 全角・半角、スラッシュ後の区分名（コールド等）の有無を問わない。
function isFirstMeetingTitle(title) {
  const t = String(title || "").normalize("NFKC");
  if (/【[^】]*新\s*\/\s*ヒ[^】]*】/.test(t)) return true; // 【新/ヒ】
  if (/【\s*初回[^】]*】/.test(t)) return true;            // 【初回/】【初回/コールド】【初回/過去失注】
  return false;
}

// 商談名から「会社名」と「担当者名（様付き）」を取り出す。
//   例）【初回/コールド】株式会社杏林堂薬局 小杉様 → { company:"株式会社杏林堂薬局", person:"小杉" }
function apoNameParts(title) {
  let t = String(title || "").normalize("NFKC");
  t = t.replace(/【[^】]*】/g, " ");              // 先頭の【…】タグを除去
  t = t.replace(/[（(][^）)]*[）)]/g, " ");        // （男性）などの補足を除去
  t = t.replace(/[\/／|｜]/g, " ");                // 区切り記号は空白に
  t = t.replace(/\s+/g, " ").trim();
  // 「〜様」を担当者名とみなす（最後に出てくる様を採用）
  let person = "";
  const pm = t.match(/([^\s　]{1,12}?)\s*様/);
  if (pm) person = pm[1].replace(/[^\p{L}\p{N}ー]/gu, "");
  // 会社名 = 「様」の手前までのうち、法人格を含む塊 or 先頭の塊
  let company = t.replace(/[^\s]*様.*$/, "").trim();
  if (!company) company = t;
  company = company.replace(/\s+/g, "");
  return { company, person };
}
// 会社名の照合キー（法人格を落として比較）
function apoCompanyKey(s) {
  return String(s || "")
    .normalize("NFKC")
    .replace(/株式会社|有限会社|合同会社|一般社団法人|社会福祉法人|医療法人|生活協同組合|協同組合|財団法人|学校法人/g, "")
    .replace(/[\s　・･,.、。「」『』【】\[\]（）()〔〕:：;；\/／\\\-–—―~〜|｜"'’‘`]/g, "")
    .toLowerCase();
}
// 企業名＋担当者名が一致するか（担当者名は取れないことがあるので、その場合は会社名のみで判定）
function apoNameMatch(mTitle, eTitle) {
  const a = apoNameParts(mTitle), b = apoNameParts(eTitle);
  const ac = apoCompanyKey(a.company), bc = apoCompanyKey(b.company);
  if (!ac || !bc || ac.length < 2 || bc.length < 2) return false;
  const companyOk = ac === bc || ac.includes(bc) || bc.includes(ac);
  if (!companyOk) return false;
  if (a.person && b.person) return a.person === b.person; // 両方に担当者名があれば一致必須
  return true; // 片方に担当者名が無ければ会社名一致で採用
}

// アポ獲得者（インサイド）の担当事業から、そのアポの事業を決める。
// 両方を担当している人・未設定の人の場合は空（＝どの事業でも扱える）にする。
let _memberBizCache = { at: 0, map: {} };
async function businessOfSetter(setterName) {
  const now = Date.now();
  if (now - _memberBizCache.at > 60 * 1000) {
    const members = await listMembers().catch(() => []);
    const map = {};
    for (const m of members) {
      const b = Array.isArray(m.businesses) ? m.businesses : [];
      // 1つだけ担当しているときに限り、その事業とみなす
      map[String(m.name || "").trim()] = b.length === 1 ? b[0] : "";
      map[String(m.email || "").toLowerCase()] = b.length === 1 ? b[0] : "";
    }
    _memberBizCache = { at: now, map };
  }
  const k = String(setterName || "").trim();
  return _memberBizCache.map[k] || _memberBizCache.map[k.toLowerCase()] || "";
}

// 予定のゲストからお客様（＝社外の人）を1人選ぶ。
// 自社ドメインの人・アポ獲得者本人・登録済みの社内ユーザーは除外する。
let _internalDomainCache = null;
function internalDomains() {
  if (_internalDomainCache) return _internalDomainCache;
  const raw = String(process.env.INTERNAL_EMAIL_DOMAINS || "neo-career.co.jp,neocareer.co.jp");
  _internalDomainCache = raw.split(/[,\s]+/).map((d) => d.trim().toLowerCase()).filter(Boolean);
  return _internalDomainCache;
}
function isInternalAddress(email) {
  const a = String(email || "").toLowerCase();
  const at = a.lastIndexOf("@");
  if (at < 0) return true; // アドレスとして壊れているものは対象外にする
  const dom = a.slice(at + 1);
  return internalDomains().some((d) => dom === d || dom.endsWith("." + d));
}
// kinbotに登録されている人のアドレス一覧（メンバー・インターン・ユーザー）。
// お客様の宛先を選ぶときに、社内の人を誤って拾わないために使う。
let _internalEmailCache = { at: 0, set: new Set() };
async function internalEmailSet() {
  const now = Date.now();
  if (now - _internalEmailCache.at < 60 * 1000) return _internalEmailCache.set;
  const set = new Set();
  try {
    const [members, interns, users] = await Promise.all([
      listMembers().catch(() => []),
      listInterns().catch(() => []),
      listUsers().catch(() => []),
    ]);
    for (const arr of [members, interns, users]) {
      for (const x of arr || []) {
        const e = String(x.email || "").trim().toLowerCase();
        if (e) set.add(e);
      }
    }
  } catch {}
  _internalEmailCache = { at: now, set };
  return set;
}

// 文章の中からメールアドレスを取り出す（説明欄に書かれた先方アドレスを拾う）
function extractEmails(text) {
  const t = String(text || "");
  const found = t.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g) || [];
  const out = [];
  for (const raw of found) {
    // 文末の句読点などを落とす
    const e = raw.replace(/[.,;:）)】」＞>]+$/, "").toLowerCase();
    if (e && !out.includes(e)) out.push(e);
  }
  return out;
}

// お客様の宛先を決める。
//   1. アポ獲得者が書いた予定の説明欄にあるメールアドレス（これが本来の入力場所）
//   2. 無ければカレンダーのゲスト（社外の人）
// どちらでも、kinbotに登録されている人のアドレスと自社ドメインは除外する。
async function pickClientContact({ description, attendees, setterEmail }) {
  const internal = await internalEmailSet();
  const setter = String(setterEmail || "").toLowerCase();
  const isOurs = (e) => !e || e === setter || internal.has(e) || isInternalAddress(e);

  // 1. 説明欄から
  for (const e of extractEmails(description)) {
    if (!isOurs(e)) return { email: e, name: "", source: "description" };
  }

  // 2. カレンダーのゲストから
  const list = Array.isArray(attendees) ? attendees : [];
  for (const a of list) {
    const em = String(a.email || "").toLowerCase();
    if (a.self || a.organizer || a.resource) continue;
    if (isOurs(em)) continue;
    return { email: em, name: a.name || "", source: "calendar" };
  }
  return null;
}

// 保存されている宛先が「社内の人」だったら間違いなので入れ替える
async function isWrongClientEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  const internal = await internalEmailSet();
  return internal.has(e) || isInternalAddress(e);
}

// 取り込み対象のタイトルか判定する。
// 【新/ヒ】【初回/】【初回】【新】【ヒ】のように、スラッシュの有無や
// 記号のゆれ（全角半角・全角スラッシュ・空白）に関係なく拾う。
const APO_TAG_RE = /【\s*(?:新|初回|ヒ)(?:\s*[\/／、,・]\s*(?:新|初回|ヒ)?)?\s*】/;
function apoTitleTag(title) {
  const t = String(title || "").normalize("NFKC");
  return APO_TAG_RE.test(t);
}

// この人たちが招いた予定は、アポとして数えない。
//
// 別のチームからの招待がクローザーのカレンダーに入ると、
// それをアポとして拾ってしまい、実績がふくらむため。
// 設定（skipInviters）で変えられる。名前でもメールでも書ける。
// 名前だけ書いても、メールアドレス（ローマ字）で照らし合わせられるようにする。
// 「中澤」と書けば nakazawa@… も見つかる。
const NAME_ROMAJI = {
  "中澤": ["nakazawa", "nakasawa"],
  "浦林": ["urabayashi"],
};
const SKIP_INVITERS_DEFAULT = "中澤,浦林";
let _skipInviters = null;

async function loadSkipInviters() {
  const st = await getSettings().catch(() => ({}));
  const raw = st.skipInviters === undefined ? SKIP_INVITERS_DEFAULT : String(st.skipInviters);
  _skipInviters = raw.split(/[,、\n]/).map((x) => x.trim()).filter(Boolean);
  return _skipInviters;
}

// その予定が「数えない人」から来ているかを見る。
// 招いた人（organizer）・作った人（creator）・参加者の名前を照らし合わせる。
// 名前が「数えない人」に当てはまるか。
// コール進捗やアポの集計でも使う（同じ設定を1か所で見るため）。
function isSkippedPerson(name, list) {
  const raw = (list || _skipInviters || SKIP_INVITERS_DEFAULT.split(","));
  const t = String(name || "").replace(/[\s　]/g, "").toLowerCase();
  if (!t) return false;
  for (const w of raw) {
    const k = String(w).replace(/[\s　]/g, "").toLowerCase();
    if (!k) continue;
    if (t.includes(k)) return true;
    for (const r of NAME_ROMAJI[String(w).replace(/[\s　]/g, "")] || []) {
      if (t.includes(r)) return true;
    }
  }
  return false;
}

function invitedBySkipped(ev, list) {
  const raw = (list || _skipInviters || SKIP_INVITERS_DEFAULT.split(","));
  // 書かれた言葉に、ローマ字読みも足して照らし合わせる
  const words = [];
  for (const w of raw) {
    const t = String(w).replace(/[\s　]/g, "").toLowerCase();
    if (!t) continue;
    words.push(t);
    for (const r of NAME_ROMAJI[String(w).replace(/[\s　]/g, "")] || []) words.push(r);
  }
  if (!words.length) return "";
  const hit = (v) => {
    const t = String(v || "").replace(/[\s　]/g, "").toLowerCase();
    if (!t) return "";
    return words.find((w) => t.includes(w)) || "";
  };
  // 招いた人・作った人
  for (const v of [ev.organizer, ev.organizerName, ev.creator, ev.creatorName]) {
    const w = hit(v);
    if (w) return w;
  }
  // 参加者のうち、招いた側になっている人
  for (const a of ev.attendees || []) {
    if (!a || !a.organizer) continue;
    const w = hit(a.email) || hit(a.name);
    if (w) return w;
  }
  return "";
}

// 予定名の先頭に「リスケ」「キャンセル」と書かれているかを見る。
// 書かれていたら、その予定はアポとして数えない（数えると実績がふくらむため）。
// 「リスケ済み」「キャンセル済」なども同じ扱いにする。
function apoHeadState(title) {
  const t = String(title || "").normalize("NFKC").replace(/^[\s　【\[（(]*/, "");
  if (/^(リスケ|再調整|日程変更)/.test(t)) return "リスケ";
  if (/^(キャンセル|中止|取消|取り消し)/.test(t)) return "キャンセル";
  return "";
}
// 笹原拓真＋インターン（＝インターン登録に登録した「アポを取る人」）が主催者で、
// タイトルが対象タグの予定を取り込み、各アポにスマートリンクを自動発行して返す。
// 担当者を割り当てると /j/<slug> がその人のZoomに切り替わる。
// query: days（既定30。今日から何日先までの予定を取り込むか）
// カレンダーを走査して、アポの一覧（スマートリンク付き）を返す。
// 「取得」ボタンと15分おきの自動スキャンの両方から呼ばれる共通処理。
async function collectApoAppointments(scanOwner, opts = {}) {
    const gcalOwner = scanOwner;
    if (!gcalOwner || !(await gcalConnected(gcalOwner))) {
      throw new Error("Googleが連携されていません。設定→連携→Google連携 を先に済ませてください。");
    }
    const interns = await listInterns();
    // クローザーも自分でアポを取るため、そのカレンダーも見る。
    // 見ないと、自分で取ったアポにメール・SF立ち上げ・通知が走らない。
    let closerList = [];
    try {
      closerList = (await listClosers({ activeOnly: true }))
        .filter((c) => c.email)
        .map((c) => ({ email: c.email, name: c.name || c.email, isCloser: true }));
    } catch {}
    // 同じ人を二度見ないようにまとめる
    const seen = new Set();
    const setters = [...interns, ...closerList].filter((x) => {
      const k = String(x.email || "").toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (!setters.length) {
      throw new Error("アポを取る人が未登録です。設定→インターン登録 で、名前とメールアドレスを登録してください。");
    }
    // 取得日・商談日はそれぞれ任意の1日。両方空なら「今後の予定」を既定表示。
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const created = dateRe.test(String(opts.created || "")) ? String(opts.created) : "";
    const start = dateRe.test(String(opts.start || "")) ? String(opts.start) : "";
    // 差分スキャン：この時刻以降に追加・変更された予定だけを見る（軽いので短い間隔で回せる）
    const updatedMin = opts.updatedMin || null;
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

    // kinbotが作った商談予定の一覧。これらはアポの元ではないので拾わない。
    let inviteIds = new Set();
    try { inviteIds = await activeInviteEventIds(); } catch {}

    // カレンダーの読み取りは、まとめて行う。
    // 1人ずつ順番に読むと人数分の待ち時間が積み上がり、
    // 次のスキャンが始まってしまう（クローザーも見るようになって人数が増えたため）。
    const CHUNK = Number(process.env.CAL_FETCH_CONCURRENCY || 6);
    const fetched = [];
    for (let i = 0; i < setters.length; i += CHUNK) {
      const part = setters.slice(i, i + CHUNK);
      const got = await Promise.all(part.map(async (st) => {
        try {
          const evs = await listCalendarEvents(gcalOwner, st.email, { timeMin, timeMax, updatedMin });
          return { st, evs };
        } catch (e) {
          const msg = /40[34]/.test(e.message)
            ? "カレンダーを読めませんでした（このメールのカレンダーが共有されているか確認してください）"
            : e.message;
          return { st, error: msg };
        }
      }));
      fetched.push(...got);
    }

    // 「リスケ」「キャンセル」と書かれた予定と、カレンダーで見つけた予定のIDを覚えておく
    const seenHeadStates = [];
    const seenEventIds = new Set();
    // 数えない招待者の一覧（毎回の走査で読み直す）
    const skipInviters = await loadSkipInviters().catch(() => []);
    const skippedByInviter = [];

    for (const f of fetched) {
      const st = f.st;
      if (f.error) { errors.push({ setter: st.name, email: st.email, error: f.error }); continue; }
      const setterEmail = String(st.email || "").toLowerCase();
      const evs = f.evs || [];
      for (const ev of evs) {
        if (ev.allDay) continue;          // 終日予定はアポではない
        if (!ev.title) continue;
        // 本人が主催者の予定だけ（招待されただけの予定は除外）。organizer優先、無ければcreatorで判定。
        const org = String(ev.organizer || "").toLowerCase();
        const creator = String(ev.creator || "").toLowerCase();
        const isHost = (org && org === setterEmail) || (!org && creator && creator === setterEmail);
        if (!isHost) continue;
        // kinbotが担当者のカレンダーに作った商談予定は、アポの元ではない。
        // これを拾うと、同じ商談から次々に新しいアポができてしまう。
        // 予定をコピーしたり作り直すとIDが変わるので、本文の目印でも見る。
        // これを拾うと、kinbotの予定から次のアポができ、際限なく増えてしまう。
        if (await isKinbotInviteEvent(ev, inviteIds)) {
          console.log(`[apo-scan] kinbotが作った予定なので取り込みません：${String(ev.title || "").slice(0, 40)}`);
          continue;
        }
        // 数えない人から招かれた予定は、アポとして拾わない
        const by = invitedBySkipped(ev, skipInviters);
        if (by) {
          skippedByInviter.push({ title: ev.title, by });
          continue;
        }

        // 先頭に「リスケ」「キャンセル」と書かれた予定は、アポとして数えない。
        // 初めて見たときだけ、Chatに知らせる。
        const head = apoHeadState(ev.title);
        if (head) {
          seenHeadStates.push({ ev, head, setter: st.name });
          continue;
        }
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
            // クローザー自身が取ったアポは、最初から本人を担当にする
            slug, label: ev.title, owner: st.isCloser ? st.email : null, createdBy: gcalOwner,
            eventId: ev.id, setter: st.name, setterEmail: st.email,
            startTime: ev.start, endTime: ev.end || null,
            // アポを取った日時＝予定を作った時刻。プロセスシートの日付はこれで決まる。
            apoAt: ev.created || null,
          });
        } else if (!link.apo_at && ev.created) {
          // 前に拾ったぶんにも、アポを取った日時を後から入れる
          const up = await setApoAt(link.slug, ev.created);
          if (up) link = { ...link, apo_at: up.apo_at };
        }
        // アポ獲得者が予定の説明欄に書いた内容を保存する（商談担当の予定に引き継ぐ）
        const memo = cleanSourceNote(ev.description);
        if (memo && !String(link.source_note || "").trim()) {
          const up = await setSmartLinkSourceNote(link.slug, memo, false);
          if (up) link = up;
        }
        // アポ獲得者のメールを持っておく（「自分で取ったアポ」の判定に使う）
        if (!String(link.setter_email || "").trim() && st.email) {
          const up2 = await setSmartLinkSetterEmail(link.slug, st.email);
          if (up2) link = up2;
        }
        // このアポの事業（DOC / MOCHICA）を、アポ獲得者の担当事業から決めて保存する
        if (!String(link.business || "").trim()) {
          const biz = await businessOfSetter(st.name);
          if (biz) {
            await setSmartLinkBusiness(link.slug, biz);
            link = { ...link, business: biz };
          }
        }
        // お客様のメールアドレスを決める。まず予定の説明欄、次にカレンダーのゲスト。
        // 手入力で直した宛先は守るが、社内の人が入っていたら間違いなので入れ替える。
        const cur = String(link.client_email || "").trim();
        const keepCurrent = cur && link.client_email_source === "manual";
        if (!keepCurrent && (!cur || (await isWrongClientEmail(cur)))) {
          const hit = await pickClientContact({
            description: ev.description, attendees: ev.attendees, setterEmail,
          });
          if (hit && hit.email !== cur) {
            const updated = await setSmartLinkClient(
              link.slug, { email: hit.email, name: hit.name, source: hit.source }, true
            );
            if (updated) {
              link = updated;
              console.log(`[apo] 宛先を${hit.source === "description" ? "説明欄" : "カレンダーのゲスト"}から取得: ${link.slug} → ${hit.email}`);
            }
          }
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
          client_email: link.client_email || "",
          client_name: link.client_name || "",
          client_email_source: link.client_email_source || "",
          business: link.business || "",
          auto_assigned_at: link.auto_assigned_at || null,
          excluded: !!link.excluded,
          // クローザー自身のカレンダーで見つけたアポ。
          // 割り振りは要らないが、メール・SF立ち上げ・通知は必要。
          selfAcquired: !!st.isCloser || !!link.current_owner,
          _link: link, // 内部用。APIレスポンスに出す前に落とす。
        });
        seenEventIds.add(ev.id);
      }
    }
    items.sort((a, b) => String(a.start).localeCompare(String(b.start)));
    if (skippedByInviter.length) {
      console.log(`[apo-scan] 数えない人からの招待 ${skippedByInviter.length}件を外しました：` +
        skippedByInviter.slice(0, 5).map((x) => `${x.by}／${String(x.title).slice(0, 30)}`).join("、"));
    }
    return { items, errors, seenHeadStates, seenEventIds, skippedByInviter, full: !updatedMin };
}

// テスト用のアポかどうか。
// 「テスト株式会社」「テスト様」のように、会社名や担当者名がテストのものを見分ける。
// 設定（testApoWords）で言葉を足せる。
let _testWords = null;
async function loadTestWords() {
  const st = await getSettings().catch(() => ({}));
  const raw = String(st.testApoWords ?? "テスト株式会社,テスト様,テスト会社,test株式会社");
  _testWords = raw.split(/[,、\n]/).map((x) => x.trim()).filter(Boolean);
  return _testWords;
}
function isTestApo(title, words) {
  const t = String(title || "").normalize("NFKC").replace(/[\s　]/g, "").toLowerCase();
  const list = words || _testWords || ["テスト株式会社", "テスト様"];
  return list.some((w) => t.includes(String(w).replace(/[\s　]/g, "").toLowerCase()));
}

// 「リスケ」「キャンセル」と書かれた予定を知らせ、アポの数からも外す
async function handleHeadStates(list) {
  for (const x of list || []) {
    const ev = x.ev;
    // すでにアポとして登録されていたら、数から外す
    let link = await getSmartLinkByEvent(ev.id).catch(() => null);
    if (!link) link = await findSmartLinkByLabelStart(ev.title, ev.start).catch(() => null);
    if (link && !link.excluded) await excludeApo(link.slug, x.head).catch(() => {});

    // 同じ予定では1回だけ知らせる
    const first = await noticeOnce(ev.id, x.head, ev.title).catch(() => false);
    if (!first) continue;
    const when = ev.start ? `${String(ev.start).slice(5, 10)} ${jstTime(ev.start)}` : "日時不明";
    await notifyAll([
      x.head === "リスケ" ? "📌 *リスケが入りました*" : "🚫 *キャンセルが入りました*",
      `・${ev.title}`,
      `📅 ${when}　👤 ${x.setter || "-"}`,
      "（アポの件数には数えていません）",
    ].join("\n"), "assign").catch(() => {});
    console.log(`[apo-scan] ${x.head}として扱いました：${String(ev.title).slice(0, 40)}`);
  }
}

// カレンダーから消された予定を、kinbotの数からも外す。
// 全期間を見たときだけ行う（差分だけ見たときは「消えた」と判断できないため）。
async function dropDeletedApos(scan) {
  if (!scan || !scan.full || !scan.seenEventIds) return 0;
  const today = jstDate(0);
  const rows = await futureApos(today, 500).catch(() => []);
  let n = 0;
  for (const r of rows) {
    if (!r.event_id || scan.seenEventIds.has(r.event_id)) continue;
    // 念のため、カレンダーに本当に無いかを直接確かめる
    const owner = r.setter_email || r.current_owner || "";
    let gone = true;
    if (owner) {
      try {
        const ev = await getCalendarEvent(owner, r.event_id).catch(() => null);
        if (ev && ev.id) gone = false;
      } catch {}
    }
    if (!gone) continue;
    // 予定が消えたときは、静かに数から外すだけにする（通知はしない）。
    // 消したこと自体は本人が分かっているので、Chatに流すと数が増えて邪魔になるため。
    await excludeApo(r.slug, "カレンダーから消えたため").catch(() => {});
    n++;
    console.log(`[apo-scan] カレンダーから消えたので外しました：${r.label || r.slug}（${String(r.start_time).slice(0, 10)}）`);
  }
  if (n) console.log(`[apo-scan] カレンダーから消えたアポ ${n}件を数から外しました`);
  return n;
}

// ───────────────────────────────────────────────────────────
// 自動割り振り（ローテーション）と15分おきの自動スキャン
// ───────────────────────────────────────────────────────────

// 1件のアポにクローザーを自動で割り当て、招待と確定メールまで通す
// アポを取ったのがクローザー本人かどうかを見る。
// クローザーが自分で取ったアポは、ローテーションに乗せず本人が担当する。
// kinbotが自分で作った商談予定かどうか。
// 予定をコピー・作り直しするとIDが変わるので、本文の目印で見分ける。
const KINBOT_INVITE_MARK = "kinbotが自動作成した商談予定です";
function isKinbotInvite(description) {
  return String(description || "").includes(KINBOT_INVITE_MARK);
}

// kinbotの予定の本文に書かれている参加URL（/j/xxxx）から、アポの鍵を取り出す
function kinbotInviteSlug(description) {
  const m = String(description || "").match(/\/j\/([A-Za-z0-9_-]{4,})/);
  return m ? m[1] : "";
}

// この予定は「kinbotが作った商談予定」か。
//   ・kinbotが管理している予定ID → そのまま除外
//   ・本文に目印があり、書かれているアポがいまも残っている → 除外（予定のコピーや作り直し）
//   ・本文に目印があっても、そのアポがもう無い → 新しいアポとして拾う
//     （消したあとに予定だけ残っている場合に、取り込めなくなるのを防ぐ）
async function isKinbotInviteEvent(ev, inviteIds) {
  if (inviteIds && inviteIds.has(ev.id)) return true;
  if (!isKinbotInvite(ev.description)) return false;
  const slug = kinbotInviteSlug(ev.description);
  if (!slug) return true;
  const link = await getSmartLink(slug).catch(() => null);
  return !!link;
}

// アポ獲得者が予定に書いたメモを取り出す。
// kinbotが付け足した部分（参加URL・アポ獲得・担当・前のメモ）は落とす。
// これを落とさないと、メモの中にメモが入る形でどんどん増えていく。
function cleanSourceNote(description) {
  let t = String(description || "");
  if (!t.trim()) return "";
  // 「────」から下は、kinbotが引き継いだ前のメモ
  const cut = t.search(/[─―—-]{6,}/);
  if (cut >= 0) t = t.slice(0, cut);
  const drop = [
    new RegExp(KINBOT_INVITE_MARK),
    /^参加URL\s*[:：]/,
    /^アポ獲得\s*[:：]/,
    /^担当\s*[:：]/,
    /^【アポ獲得時のメモ/,
  ];
  const kept = t.split("\n").filter((line) => !drop.some((re) => re.test(line.trim())));
  return kept.join("\n").trim();
}

// 「自分で取ったアポ」＝アポを取った人（setter）自身がクローザーであること。
// 見るのは setter だけにする。
//   ・created_by は、カレンダーを読みに行ったアカウント（運用者）であって、取った人ではない。
//     これを混ぜると、運用者がクローザーの場合に全部のアポが「自分で取った」になってしまう。
//   ・current_owner も、割り当てた後は必ずクローザーなので、混ぜると必ず一致してしまう。
async function selfAcquired(link, biz) {
  const email = String(link.setter_email || "").trim().toLowerCase();
  const name = String(link.setter || "").trim();
  if (!email && !name) return null;
  try {
    const closers = await listClosers({ activeOnly: false, business: biz });
    // メールアドレスで照合。無ければ名前で照合する。
    let hit = email ? closers.find((c) => String(c.email || "").toLowerCase() === email) : null;
    if (!hit && name) {
      const norm = (v) => String(v || "").replace(/[\s　]/g, "");
      hit = closers.find((c) => norm(c.name) && norm(c.name) === norm(name));
    }
    return hit || null;
  } catch { return null; }
}

async function autoAssignOne(link, { inviteOwner, closers = null, cfg, teamCtx = null, actor = "auto" }) {
  // 事業ごとに候補が違うので、アポの事業に合わせて毎回引き直す
  const biz = String(link.business || "").trim();

  // クローザーが自分で取ったアポは、割り振らずに本人を担当にする。
  // ローテーションの順番も動かさない（他の人の順番を飛ばさないため）。
  const self = await selfAcquired(link, biz);
  const pick = self
    ? { email: self.email, name: self.name || self.email, reason: "自分で獲得したアポ", self: true }
    : await pickCloser(link, { inviteOwner, closers, cfg, teamCtx, business: biz });
  if (!pick.email) {
    // 割り当てられなかった理由も残す（あとで画面から見て手動対応する）
    await logAssign({ slug: link.slug, assigned: null, reason: pick.reason, skipped: pick.skipped, actor });
    return { ok: false, reason: pick.reason, skipped: pick.skipped };
  }

  // すでに担当が入っている（自分で取ったアポ）なら、担当は変えない
  const updated = link.current_owner && pick.self
    ? link
    : await setSmartLinkOwner(link.slug, pick.email);
  // 自分で取ったアポは、ローテーションの順番を進めない
  let rotNext = null;
  if (pick.self) {
    // 自分で取ったアポ。順番は動かさないが、件数は実績として数える。
    // 数えないと、その人にばかりアポが回ってしまう。
    await markCloserAssigned(pick.email).catch(() => {});
    await logAssign({ slug: link.slug, assigned: pick.email, reason: "自分で獲得したアポ（割り振りなし）", actor });
    console.log(`[apo-assign] ${link.slug} → ${pick.name}（自分で獲得したアポ。件数は数え、順番は動かしません）`);
  } else {
    rotNext = await commitAssignment(updated, pick, { actor });
  }
  await markAutoAssigned(link.slug);

  // クローザーのカレンダーに商談予定を作る。
  // ただし、クローザーが自分で取ったアポは、本人のカレンダーにもう予定がある。
  // ここで作ると同じ商談の予定が2つになるので、作らない。
  let invite = null, inviteError = null;
  const s = await getSettings().catch(() => ({}));
  if (pick.self) {
    console.log(`[apo-assign] ${link.slug} は本人の予定をそのまま使います（商談予定は作りません）`);
  } else if (s && s.apoAutoInvite !== false) {
    try { invite = await createApoInvite(updated, { actor }); }
    catch (e) { inviteError = e.message; console.warn("[apo-assign] 招待の作成に失敗", link.slug, e.message); }
  }

  // アポ確定メール（担当セールス本人のGmailから）
  let mail = null;
  const mcfg = await getApoMailConfig().catch(() => null);
  if (mcfg && mcfg.autoConfirm) {
    mail = await sendApoMail(updated, "confirm", {
      url: joinUrl(updated.slug),
      repName: await repDisplayName(pick.email),
      actor,
    });
  } else {
    // 設定がOFFのときは、そうと分かるようにしておく（黙って作らないと原因が追えない）
    mail = { ok: false, skipped: true, reason: "確定メールの自動用意がOFFです" };
    console.log(`[apo-assign] ${link.slug}：確定メールは作りません（自動用意OFF）`);
  }

  // 自分で取ったアポは順番を進めないので、rotNext が無いことがある
  console.log(`[apo-assign] ${link.slug} → ${pick.name}${pick.team ? "／" + pick.team : ""}` +
    `（${pick.reason}）${rotNext && rotNext.nextName ? `次は${rotNext.nextName}` : "順番は動かしません"}`);

  // Google Chat へ通知する。下書きも自動でできるので、メールの状況を含めて1通にまとめる。
  // （通知が失敗しても割り振り自体は止めない）
  (async () => {
    const counts = await assignCounts(biz).catch(() => null);
    const st = await getSettings().catch(() => ({}));
    // アポの月間目標はまだ決まっていないので、通知には出さない。
    // 決まったら、設定で apoShowGoal を true にすれば出るようになる。
    const goal = st?.apoShowGoal === true ? (parseInt(st?.apoMonthlyGoal, 10) || 0) : 0;
    // Salesforceの立ち上げ。設定がONのときだけ実際に立ち上げ、
    // OFFのときは「立ち上げられるか」の判定だけ行う（コンバートは取り消せないため）。
    const runIt = st?.sfAutoLaunch === true;
    const op = await sfOperator(actor).catch(() => "");
    const launch = await (op
      ? tryAutoLaunch(op, updated, { dryRun: !runIt, ownerEmail: updated.current_owner })
      : Promise.resolve({ ok: false, reason: "no_operator" }))
      .then((r) => ({ ok: r.ok, dryRun: !runIt, reasonText: r.ok ? "" : reasonText(r.reason, r.detail) }))
      .catch(() => null);
    await notifyAssigned({
      title: updated.label, start: updated.start_time, repName: pick.name,
      setter: updated.setter, reason: pick.reason,
      url: joinUrl(updated.slug), auto: actor !== "manual" && !String(actor || "").includes("@"),
      mail, clientEmail: updated.client_email, counts, goal, launch,
    });

    // 下書きができたときは、担当者本人にも直接知らせる。
    // チームのスペースの呼びかけは流れて見落とすことがあるため。
    if (mail && mail.ok && mail.draft && pick.email) {
      await notifyPerson(pick.email, [
        "📝 *確定メールの下書きができています*",
        `　${updated.label || ""}`,
        `📅 ${String(updated.start_time || "").slice(5, 16).replace("T", " ")}　✉️ ${mail.to || "-"}`,
        "",
        "Gmailの下書きに入っています。中身を見て、送ってください。",
      ].join("\n")).catch(() => {});
    }

    // テスト用のアポは、通知まで普通どおり行ったあとで、数から外す。
    // 割り振りやメールの動きは確かめられるが、実績には残らない。
    if (isTestApo(updated.label)) {
      await excludeApo(updated.slug, "テスト用のアポ").catch(() => {});
      console.log(`[apo-assign] テスト用として数から外しました：${updated.label}`);
    }
  })().catch(() => {});

  return { ok: true, assigned: pick, invite, invite_error: inviteError, mail, next: rotNext };
}

// カレンダーを走査して、未割り当てのアポを順に自動割り振りする
async function runApoAutoScan({ actor = "auto-scan", force = false, updatedMin = null } = {}) {
  const cfg = await getRotationConfig();
  if (!force && !cfg.autoScan) return { skipped: true, reason: "自動スキャンがOFFです" };

  const s = await getSettings().catch(() => ({}));
  // 走査するアカウント。未指定なら「予定作成の運用者」を使う。
  const scanOwner = String(s.apoScanOwner || s.apoInviteOwner || "").trim();
  if (!scanOwner) {
    return { skipped: true, reason: "走査するアカウントが未設定です（設定→インターン登録→予定作成の運用者）" };
  }

  let scan;
  try {
    scan = await collectApoAppointments(scanOwner, { updatedMin });
  } catch (e) {
    console.error("[apo-scan] 走査に失敗:", e.message);
    return { skipped: true, reason: e.message };
  }

  await loadTestWords().catch(() => {});
  // 「リスケ」「キャンセル」と書かれた予定を知らせ、数から外す
  await handleHeadStates(scan.seenHeadStates).catch((e) => console.warn("[apo-scan] リスケ判定:", e.message));
  // カレンダーから消された予定を、kinbotの数からも外す（全期間を見たときだけ）
  await dropDeletedApos(scan).catch((e) => console.warn("[apo-scan] 削除の追随:", e.message));

  // 担当が未定で、まだ自動割り振りを試していないものを対象にする。
  // クローザーが自分で取ったアポは担当が入っているが、
  // メール・SF立ち上げ・通知はまだなので、こちらも対象に含める。
  const targets = scan.items.filter((it) =>
    !it.auto_assigned_at && (!it.current_owner || it.selfAcquired));
  const selfCount = targets.filter((t) => t.selfAcquired).length;
  if (selfCount) console.log(`[apo-scan] うち ${selfCount}件はクローザーが自分で取ったアポです`);
  if (!targets.length) {
    return { total: scan.items.length, targets: 0, assigned: 0, results: [], errors: scan.errors, differential: !!updatedMin };
  }

  if (!cfg.autoAssign) {
    return { total: scan.items.length, targets: targets.length, assigned: 0,
             skipped: true, reason: "自動割り振りがOFFです（アポの記録だけ行いました）", errors: scan.errors };
  }

  const results = [];
  let assigned = 0;
  // 商談が早いものから順に処理する（ローテーションの順序が時系列で自然になる）
  for (const it of targets) {
    if (assigned >= cfg.maxPerRun) {
      console.warn(`[apo-scan] 1回あたりの上限 ${cfg.maxPerRun}件に達したため中断しました`);
      break;
    }
    try {
      // 最新のローテーション状態を毎回読み直す（1件ごとに次の人が進むため）
      const c = await getRotationConfig();
      // 事業ごとに候補とチーム件数が変わるので、アポの事業に合わせて毎回読み直す
      const biz = String(it._link.business || "").trim();
      const teamCtx = await loadTeamContext(c, biz);
      const r = await autoAssignOne(it._link, { inviteOwner: scanOwner, closers: null, cfg: c, teamCtx, actor });
      results.push({ slug: it.slug, title: it.title, start: it.start, ...r });
      if (r.ok) assigned++;
    } catch (e) {
      console.error("[apo-scan]", it.slug, e.message);
      results.push({ slug: it.slug, ok: false, reason: e.message });
    }
    await new Promise((r) => setTimeout(r, 400)); // Google APIのレート対策
  }
  console.log(`[apo-scan]${updatedMin ? "（差分）" : ""} 走査${scan.items.length}件 / 未割当${targets.length}件 / 割り当て${assigned}件`);
  return { total: scan.items.length, targets: targets.length, assigned, results, errors: scan.errors, differential: !!updatedMin };
}

// ───────────────────────────────────────────────────────────
// カレンダーの変更を、Googleから即時に受け取る（プッシュ通知）
//
// 1分おきに見に行くのをやめ、予定が作られた瞬間に差分スキャンを走らせる。
// 通知そのものには中身が入らないので、合図として使い、いつもの差分スキャンを呼ぶ。
// ───────────────────────────────────────────────────────────

// 通知が本物かを確かめる合言葉
const PUSH_TOKEN = crypto.createHash("sha256")
  .update(String(process.env.SESSION_SECRET || "kinbot") + "|calendar-push")
  .digest("hex").slice(0, 32);

// 続けて何度も通知が来ても、スキャンは1回にまとめる
let pushTimer = null;
let lastPushAt = 0;
export function triggerScanSoon(delayMs = 3000) {
  if (pushTimer) return;
  pushTimer = setTimeout(() => {
    pushTimer = null;
    lastPushAt = Date.now();
    if (typeof globalThis.__kinbotApoScanTick === "function") {
      globalThis.__kinbotApoScanTick().catch(() => {});
    }
  }, delayMs);
}

app.post("/api/google/calendar-push", async (req, res) => {
  // Googleは本文を送らないので、ヘッダだけを見る
  const channelId = String(req.headers["x-goog-channel-id"] || "");
  const token = String(req.headers["x-goog-channel-token"] || "");
  const state = String(req.headers["x-goog-resource-state"] || "");
  res.status(200).end();   // まず受け取ったことを返す（Googleは応答が遅いと再送する）
  try {
    if (token !== PUSH_TOKEN) return;
    if (state === "sync") return;              // 登録直後の挨拶。まだ変更ではない。
    const w = await getCalendarWatch(channelId).catch(() => null);
    console.log(`[apo-push] カレンダーに変更がありました（${(w && w.calendar_id) || channelId}）`);
    triggerScanSoon(3000);
  } catch (e) { console.warn("[apo-push]", e.message); }
});

// 監視の登録・付け直し。
// 期限が近いものは作り直し、対象が増えていれば追加する。
async function ensureCalendarWatches({ force = false } = {}) {
  if (!PUBLIC_URL) return { skipped: true, reason: "PUBLIC_URL が未設定です" };
  const st = await getSettings().catch(() => ({}));
  if (st.apoPushEnabled === false) return { skipped: true, reason: "即時通知がOFFです" };
  const rep = String(st.apoScanOwner || st.apoInviteOwner || "").trim();
  if (!rep) return { skipped: true, reason: "カレンダー照合の代表者が未設定です" };
  if (!(await gcalConnected(rep).catch(() => false))) {
    return { skipped: true, reason: `${rep} のGoogle連携が切れています` };
  }

  // 見張る対象＝アポを取る人（インサイド）とクローザー
  const targets = new Map();
  for (const i of await listInterns().catch(() => [])) if (i.email) targets.set(String(i.email).toLowerCase(), i.name || i.email);
  for (const c of await listClosers({ activeOnly: false }).catch(() => [])) if (c.email) targets.set(String(c.email).toLowerCase(), c.name || c.email);
  if (!targets.size) return { skipped: true, reason: "対象のメンバーが登録されていません" };

  const address = `${PUBLIC_URL.replace(/\/+$/, "")}/api/google/calendar-push`;
  const now = Date.now();
  const cur = await listCalendarWatches().catch(() => []);
  const byCal = new Map(cur.map((w) => [String(w.calendar_id || "").toLowerCase(), w]));

  const made = [], failed = [];
  for (const [email, name] of targets) {
    const w = byCal.get(email);
    const left = w && w.expires_at ? new Date(w.expires_at).getTime() - now : -1;
    // 期限まで1日を切ったら作り直す
    if (!force && w && left > 24 * 3600 * 1000) continue;
    try {
      const channelId = "kb-" + crypto.randomBytes(12).toString("hex");
      const r = await watchCalendarEvents(rep, email, {
        channelId, address, token: PUSH_TOKEN, ttlSec: 7 * 24 * 3600,
      });
      await saveCalendarWatch({
        channelId: r.channelId, resourceId: r.resourceId, calendarId: email,
        tokenOwner: rep, expiresAt: r.expiration,
      });
      // 古いほうは止める（残すと同じ通知が二重に来る）
      if (w) {
        await stopCalendarChannel(w.token_owner || rep, w.channel_id, w.resource_id).catch(() => {});
        await deleteCalendarWatch(w.channel_id).catch(() => {});
      }
      made.push({ email, name, expires: r.expiration });
      console.log(`[apo-push] 監視を登録しました ${name}（${email}）期限 ${String(r.expiration || "").slice(0, 16)}`);
    } catch (e) {
      failed.push({ email, name, error: e.message });
      console.warn(`[apo-push] 監視を登録できませんでした ${email}: ${e.message}`);
    }
  }
  return { address, watched: targets.size, made, failed };
}

// 即時通知の状態を見る・付け直す
app.get("/api/apo/push-status", async (req, res) => {
  try {
    const st = await getSettings().catch(() => ({}));
    const rows = await listCalendarWatches();
    res.json({
      enabled: st.apoPushEnabled !== false,
      publicUrl: PUBLIC_URL || "",
      address: PUBLIC_URL ? `${PUBLIC_URL.replace(/\/+$/, "")}/api/google/calendar-push` : "",
      lastPushAt: lastPushAt ? new Date(lastPushAt).toISOString() : null,
      watches: rows.map((w) => ({
        calendar: w.calendar_id, expires: w.expires_at, owner: w.token_owner,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/apo/push-setup", async (req, res) => {
  try {
    if (req.body && req.body.enabled !== undefined) {
      await saveSettings({ apoPushEnabled: req.body.enabled !== false });
    }
    const r = await ensureCalendarWatches({ force: req.body?.force === true });
    console.log(`[apo-push] 監視を付け直しました by ${req.user}`);
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────────────────────────────────────
// 更新（デプロイ）の通知
//
// Railwayは、GitHubに上げるたびに新しい中身で起動し直す。
// その起動をつかまえて「更新が終わりました」とChatに流す。
// Railwayの環境変数（RAILWAY_GIT_*）があれば、何を入れた更新かも書く。
// ───────────────────────────────────────────────────────────
const DEPLOY_ENV = {
  commit: String(process.env.RAILWAY_GIT_COMMIT_SHA || "").slice(0, 7),
  message: String(process.env.RAILWAY_GIT_COMMIT_MESSAGE || "").split("\n")[0].slice(0, 120),
  author: String(process.env.RAILWAY_GIT_AUTHOR || ""),
  branch: String(process.env.RAILWAY_GIT_BRANCH || ""),
};

function deployText(head) {
  const jst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16);
  return [
    head,
    DEPLOY_ENV.message ? `📝 ${DEPLOY_ENV.message}` : "",
    DEPLOY_ENV.commit ? `🔖 ${DEPLOY_ENV.commit}${DEPLOY_ENV.branch ? `（${DEPLOY_ENV.branch}）` : ""}` : "",
    `🧩 ${BUILD_TAG}`,
    `🕒 ${jst}`,
    PUBLIC_URL ? `🔗 ${PUBLIC_URL}` : "",
  ].filter(Boolean).join("\n");
}

async function notifyDeployDone() {
  const st = await getSettings().catch(() => ({}));
  if (st.notifyDeploy === false) return;
  // 手元で動かしているときは流さない（公開URLがある＝本番とみなす）
  if (!PUBLIC_URL) return;
  await notifyAll(deployText("🚀 *kinbotの更新が終わりました*"), "deploy");
  console.log("[deploy] 更新の通知を送りました");
}

// Railwayの「Webhook」から呼んでもらう受け口（失敗も拾いたいとき用）。
// 合言葉付きのURLを、Railwayのプロジェクト設定に入れて使う。
app.post("/api/railway/deploy-hook", async (req, res) => {
  const token = String(req.query.token || req.headers["x-kinbot-token"] || "");
  res.status(200).end();
  try {
    if (token !== PUSH_TOKEN) return;
    const b = req.body || {};
    const status = String(b.status || b.type || "").toUpperCase();
    const ok = /SUCCESS|DEPLOYED|COMPLETE/.test(status);
    const ng = /FAIL|CRASH|ERROR/.test(status);
    if (!ok && !ng) return;   // 途中経過は流さない
    const msg = String(b.deployment?.meta?.commitMessage || b.commitMessage || "").split("\n")[0];
    // 翌朝まとめて知らせるために、内容を残しておく
    if (ok && msg) await logDeploy({ message: msg, build: BUILD_TAG, ok: true }).catch(() => {});
    await notifyAll([
      ok ? "🚀 *kinbotの更新が終わりました*" : "⚠️ *kinbotの更新に失敗しました*",
      msg ? `📝 ${msg}` : "",
      `🧩 ${status}`,
    ].filter(Boolean).join("\n"), "deploy");
  } catch (e) { console.warn("[deploy-hook]", e.message); }
});

// 更新通知の設定（Railwayに入れるURLと、いまのON/OFF）
app.get("/api/deploy/info", async (req, res) => {
  try {
    const st = await getSettings().catch(() => ({}));
    res.json({
      enabled: st.notifyDeploy !== false,
      build: BUILD_TAG,
      startedAt: START_TIME,
      commit: DEPLOY_ENV.commit, message: DEPLOY_ENV.message, branch: DEPLOY_ENV.branch,
      hookUrl: PUBLIC_URL ? `${PUBLIC_URL.replace(/\/+$/, "")}/api/railway/deploy-hook?token=${PUSH_TOKEN}` : "",
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/deploy/info", async (req, res) => {
  try {
    await saveSettings({ notifyDeploy: req.body?.enabled !== false });
    res.json({ ok: true, enabled: req.body?.enabled !== false });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────────────────────────────────────
// Google Chat から kinbot を動かす
//
// Chatで「@kinbot アポ」と話しかけると、ここが受け取って返事をする。
// 誰が話しかけたかはメールアドレスで分かるので、その人のぶんを返す。
// ───────────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────
// Chatの自由な質問に答える
//
// 「8/4の商談は何件？」のような文は、AIに“何を知りたいか”だけ読み取ってもらい、
// 数えるのはkinbotのデータで行う（AIに数えさせない＝数がずれないため）。
// ───────────────────────────────────────────────────────────

// AIの読み取りは待ちすぎない（Chatは待たせると「応答がありません」になるため）。
// 間に合わなければ、こちらの簡易の読み取りで答える。
async function readIntent(text, today) {
  const ai = (async () => {
    const raw = await callLLMPublic(INTENT_SYSTEM, `今日は ${today} です。質問：${text}`, 400, { json: true });
    return typeof raw === "string" ? JSON.parse(String(raw).replace(/```json|```/g, "").trim()) : raw;
  })();
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("時間切れ")), 8000));
  try {
    const got = await Promise.race([ai, timeout]);
    if (got && got.intent && got.intent !== "unknown") return got;
    if (got && got.intent === "unknown") {
      // AIが「分からない」と言っても、こちらで拾えることがある
      const g = guessIntent(text, today);
      return g.intent !== "unknown" ? g : got;
    }
  } catch (e) {
    console.warn("[chat-cmd] AIで読み取れませんでした:", e.message);
  }
  return guessIntent(text, today);
}

// 何も指定が無いときの期間（今日）
function chatRange(v) {
  const ok = (x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x || ""));
  const today = jstDate(0);
  const from = ok(v.from) ? v.from : today;
  const to = ok(v.to) ? v.to : from;
  return from <= to ? { from, to } : { from: to, to: from };
}

function sameName(a, b) {
  const n = (v) => String(v || "").replace(/[\s　]/g, "").toLowerCase();
  return !!n(a) && n(a) === n(b);
}

function rangeLabel(from, to) {
  return from === to ? from : `${from} 〜 ${to}`;
}

// 読み取った意図に沿って、kinbotのデータから答えを作る
async function chatAnswer(intent, who) {
  const { from, to } = chatRange(intent);
  const mine = intent.scope === "me";
  const person = String(intent.person || "").trim();
  const want = intent.want === "count" ? "count" : "list";
  const label = rangeLabel(from, to);

  if (intent.intent === "meetings" || intent.intent === "sf_pending") {
    // 「SF未更新は？」のように日付を言われていないときは、直近2週間を見る
    let f = from, t2 = to;
    if (intent.intent === "sf_pending" && from === to) {
      const d = new Date(to + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - 13);
      f = d.toISOString().slice(0, 10);
    }
    let rows = await listMeetings({ isAdmin: true, from: f, to: t2, light: true, limit: 500 }).catch(() => []);
    if (mine) rows = rows.filter((r) => String(r.owner || "").toLowerCase() === who);
    if (person) rows = rows.filter((r) => sameName(r.owner_name, person) || sameName(r.rep_name, person));
    if (intent.intent === "sf_pending") rows = rows.filter((r) => !r.sf_url);

    const head = intent.intent === "sf_pending"
      ? `*${rangeLabel(f, t2)} のSF未更新の商談 ${rows.length}件*`
      : `*${label} の商談 ${rows.length}件*${mine ? "（自分）" : "（チーム全体）"}`;
    if (!rows.length) return head.replace("*", "").replace("*", "") + "（該当なし）";
    if (want === "count") return head;
    const lines = rows.slice(0, 20).map((r) =>
      `・${String(r.created_at).slice(5, 10)} ${r.title || r.account || "(名前なし)"}` +
      `${r.owner_name ? `／${r.owner_name}` : ""}${r.sf_url ? "" : "　⚠️SF未更新"}`);
    return [head, ...lines, rows.length > 20 ? `…ほか${rows.length - 20}件` : ""].filter(Boolean).join("\n");
  }

  if (intent.intent === "apo" || intent.intent === "apo_taken") {
    const taken = intent.intent === "apo_taken";
    let rows = taken
      ? await aposTakenInRange({ from, to, business: intent.business || "" }).catch(() => [])
      : await aposInRange({ from, to, business: intent.business || "" }).catch(() => []);
    // 数えない人（中澤・浦林など）が取ったアポは外す。
    // ただし、予備として誰かに割り振られたものは、チームのアポとして数える。
    const skipList = await loadSkipInviters().catch(() => []);
    rows = rows.filter((r) => !(isSkippedPerson(r.setter, skipList) && !r.current_owner));
    if (mine) {
      const myName = await displayNameOf(who).catch(() => "");
      rows = rows.filter((r) =>
        String(r.current_owner || "").toLowerCase() === who ||
        String(r.setter_email || "").toLowerCase() === who ||
        sameName(r.setter, myName));
    }
    if (person) rows = rows.filter((r) => sameName(r.setter, person));

    const head = taken
      ? `*${label} に取ったアポ ${rows.length}件*`
      : `*${label} のアポ ${rows.length}件*`;
    if (!rows.length) return `${label} のアポはありません。`;
    if (want === "count") {
      // 誰が何件かも添える
      const by = new Map();
      for (const r of rows) {
        const k = (taken ? r.setter : (r.current_owner || r.setter)) || "不明";
        by.set(k, (by.get(k) || 0) + 1);
      }
      const detail = [...by.entries()].sort((a, b) => b[1] - a[1])
        .slice(0, 10).map(([k, v]) => `${k} ${v}件`).join("／");
      return [head, detail].filter(Boolean).join("\n");
    }
    const lines = rows.slice(0, 20).map((r) =>
      `・${jstTime(r.start_time)} ${r.label || ""}` +
      `${r.setter ? `／獲得 ${r.setter}` : ""}`);
    return [head, ...lines, rows.length > 20 ? `…ほか${rows.length - 20}件` : ""].filter(Boolean).join("\n");
  }

  if (intent.intent === "launch_pending") {
    const rows = await listAutolaunch(50).catch(() => []);
    const ng = rows.filter((r) => !r.ok);
    if (!ng.length) return "立ち上げできていないものはありません。";
    if (want === "count") return `*立ち上げできていないもの ${ng.length}件*`;
    const lines = ng.slice(0, 12).map((r) => `・${r.company || r.slug}　${reasonText(r.reason, r.detail)}`);
    return [`*立ち上げできていないもの ${ng.length}件*`, ...lines].join("\n");
  }

  return null;   // ここに来たら、kinbotのデータでは答えられない
}

function statusText() {
  const jst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16);
  return [
    "*いま動いているkinbot*",
    `🧩 ${BUILD_TAG}`,
    `🕒 いまは ${jst}（起動：${String(START_TIME).replace("T", " ").slice(0, 16)}）`,
    DEPLOY_ENV.message ? `📝 ${DEPLOY_ENV.message}` : "",
  ].filter(Boolean).join("\n");
}

// 画面から、Chatと同じ質問を試す（動作確認用）
app.post("/api/chat/ask", async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    const who = String(req.body?.as || req.user || "").toLowerCase();
    let intent = req.body?.intent || null;
    if (!intent && text) intent = await readIntent(text, jstDate(0));
    if (!intent) return res.json({ ok: false, text: "読み取れませんでした" });
    if (intent.intent === "status") return res.json({ ok: true, intent, text: statusText() });
    const ans = await chatAnswer(intent, who);
    res.json({ ok: true, intent, text: ans || "kinbotが持っていない情報です" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 届いた呼びかけの記録（うまくいかないときに、画面で理由を見るため）
const chatCmdLog = [];
function logChatCmd(row) {
  chatCmdLog.unshift({ at: new Date().toISOString(), ...row });
  if (chatCmdLog.length > 20) chatCmdLog.length = 20;
}

app.get("/api/chat/command-log", (req, res) => res.json({ items: chatCmdLog }));

app.post("/api/chat/command", async (req, res) => {
  const ev = readEvent(req.body);
  const reply = (text) => res.json(replyBody(text, ev.addon));
  const said = ev.text.slice(0, 60);
  try {
    // 合言葉つきURLでも受けられるようにする（動作確認用）
    const bypass = String(req.query.token || "") === PUSH_TOKEN;
    let v = { ok: true, by: "合言葉" };
    if (!bypass) {
      v = await verifyChatRequest(req, { audience: process.env.GOOGLE_CHAT_AUDIENCE || "" });
      if (!v.ok) {
        console.warn("[chat-cmd] 受け取りませんでした:", v.reason);
        logChatCmd({ ok: false, reason: v.reason, from: ev.email, said, type: ev.type, addon: ev.addon });
        devNote({ key: errKey("Chat受け取り", v.reason), kind: "error",
                  title: `Chatからの呼びかけを受け取れない：${v.reason}`, source: "Chat" }).catch(() => {});
        // Chatには「応答がありません」ではなく、理由を返す（設定を直せるように）
        return reply(`kinbotが受け取れませんでした：${v.reason}\n（設定→Google Chat の「Chatから kinbot を動かす」をご確認ください）`);
      }
    }
    logChatCmd({ ok: true, by: v.by || "", sender: v.sender || "", from: ev.email, said, type: ev.type, addon: ev.addon });
    if (ev.type === "ADDED_TO_SPACE") return reply("kinbotです。`ヘルプ` と送ると、できることが出ます。");
    if (ev.type && ev.type !== "MESSAGE") return res.json(replyBody("", ev.addon));

    const who = ev.email;
    const text = ev.text;
    const cmd = parseCommand(text);
    console.log(`[chat-cmd] ${who || "不明"}「${text}」→ ${cmd.kind}`);

    if (cmd.kind === "help") return reply(helpText());

    // 「要望 〜」「バグ 〜」を、その場で開発メモに残す
    if (cmd.kind === "note") {
      const r = await addDevNote({
        key: `chat:${Date.now()}:${cmd.text}`.slice(0, 200),
        kind: cmd.noteKind, title: cmd.text, source: "Chat", createdBy: ev.email,
      });
      return reply(r
        ? `${NOTE_KINDS[cmd.noteKind] || "メモ"}として残しました。\n「${cmd.text}」\n（朝にまとめて知らせます）`
        : "残せませんでした。もう一度お試しください。");
    }

    // 溜まっている開発メモを見る
    if (cmd.kind === "notes") {
      const rows = await listDevNotes({ status: "new", limit: 20 }).catch(() => []);
      if (!rows.length) return reply("未対応の開発メモはありません。");
      const lines = rows.map((r) =>
        `・[${NOTE_KINDS[r.kind] || r.kind}] ${r.title}${r.hits > 1 ? `（${r.hits}回）` : ""}`);
      return reply([`*開発メモ ${rows.length}件*`, ...lines].join("\n"));
    }

    if (cmd.kind === "status") return reply(statusText());

    if (!who) return reply("あなたのメールアドレスが分かりませんでした。kinbotのスペースで話しかけてください。");

    if (cmd.kind === "apo") {
      const date = jstDate(cmd.day);
      const myName = await displayNameOf(who).catch(() => "");
      const rows = await myAssignedApos(who, date, "day", 50, myName);
      if (!rows.length) return reply(`${date} のアポはありません。`);
      const lines = rows.map((r) =>
        `・${jstTime(r.start_time)} ${r.label || ""}` +
        `${r.self_got ? "（自分で獲得）" : ""}` +
        `${r.client_email ? "" : "　⚠️宛先が未登録"}`);
      return reply([`*${date} のアポ ${rows.length}件*`, ...lines].join("\n"));
    }

    if (cmd.kind === "meetings") {
      const date = jstDate(cmd.day);
      const rows = await listMeetings({ owner: who, isAdmin: false, from: date, to: date, light: true, limit: 50 })
        .catch(() => []);
      if (!rows.length) return reply(`${date} の商談はありません。`);
      const lines = rows.map((r) =>
        `・${jstTime(r.created_at)} ${r.title || r.account || "(名前なし)"}` +
        `${r.sf_url ? "" : "　⚠️SF未更新"}`);
      return reply([`*${date} の商談 ${rows.length}件*`, ...lines].join("\n"));
    }

    if (cmd.kind === "scan") {
      reply("カレンダーを見に行きます。新しいアポが見つかったら、いつもの通知が流れます。");
      if (typeof globalThis.__kinbotApoScanTick === "function") {
        globalThis.__kinbotApoScanTick().catch(() => {});
      }
      return;
    }

    if (cmd.kind === "dupes") {
      const { rep, people } = await calendarPeople();
      if (!people.length) return reply("調べる対象のメンバーが登録されていません。");
      reply("重複していないか見ています。少し待ってください…");
      // 数だけ調べて、あとから知らせる（その場で返すと待たせてしまうため）
      (async () => {
        try {
          const r = await fetch(`http://127.0.0.1:${PORT}/api/apo/duplicate-events`, {
            headers: { cookie: "" },
          }).then((x) => x.json()).catch(() => null);
          const n = r && r.found ? r.found.length : null;
          await notifyAll(n === null
            ? "重複を調べられませんでした。画面から試してください。"
            : (n ? `⚠️ 重複した予定が ${n}件 あります。アポ管理→システムから消せます。` : "✅ 重複した予定はありません。"), "assign");
        } catch {}
      })();
      return;
    }

    if (cmd.kind === "launch") {
      const rows = await listAutolaunch(20).catch(() => []);
      const ng = rows.filter((r) => !r.ok);
      if (!ng.length) return reply("立ち上げられていないものはありません。");
      const lines = ng.slice(0, 10).map((r) =>
        `・${r.company || r.slug}　${reasonText(r.reason, r.detail)}`);
      return reply([`*立ち上げできていないもの ${ng.length}件*`, ...lines].join("\n"));
    }

    // ここから先は、ふつうの文で来た質問。
    // AIには「何を知りたいか」だけ読み取ってもらい、数えるのはkinbotのデータで行う。
    if (cmd.kind === "ask") {
      const today = jstDate(0);
      const jd = new Date(Date.now() + 9 * 3600 * 1000);
      const week = "日月火水木金土"[jd.getUTCDay()];
      const intent = await readIntent(`${text}（${week}曜）`, today);
      if (!intent || !intent.intent) return reply("うまく読み取れませんでした。\n\n" + helpText());

      console.log(`[chat-cmd] 読み取り: ${JSON.stringify(intent)}`);
      if (intent.intent === "scan") {
        reply("カレンダーを見に行きます。新しいアポが見つかったら、いつもの通知が流れます。");
        if (typeof globalThis.__kinbotApoScanTick === "function") globalThis.__kinbotApoScanTick().catch(() => {});
        return;
      }
      if (intent.intent === "status") return reply(statusText());

      const ans = await chatAnswer(intent, who);
      if (ans) return reply(ans);
      // 答えられなかった質問は「まだできないこと」として残す。
      // 何を聞かれているかが、そのまま次に作るものになる。
      await devNote({
        key: errKey("答えられない質問", text), kind: "gap",
        title: `Chatで答えられなかった：${text.slice(0, 100)}`,
        source: "Chat", by: ev.email,
      }).catch(() => {});
      return reply(
        "それはkinbotが持っていない情報です。\n" +
        "kinbotで分かるのは、商談・アポ・SFの更新や立ち上げの状況です。\n" +
        "（この質問は開発メモに残しました）");
    }

    return reply(`「${text}」は分かりませんでした。\n\n` + helpText());
  } catch (e) {
    console.error("[chat-cmd]", e.message);
    logChatCmd({ ok: false, reason: e.message, from: ev.email, said, type: ev.type, addon: ev.addon });
    try { res.json(replyBody("うまく動きませんでした：" + e.message, ev.addon)); } catch {}
  }
});

// Chatから操作するための設定情報（Google Cloudの画面に入れるURL）
app.get("/api/chat/command-info", async (req, res) => {
  try {
    const base = PUBLIC_URL ? PUBLIC_URL.replace(/\/+$/, "") : "";
    res.json({
      endpoint: base ? `${base}/api/chat/command` : "",
      testUrl: base ? `${base}/api/chat/command?token=${PUSH_TOKEN}` : "",
      audience: process.env.GOOGLE_CHAT_AUDIENCE || "",
      appConfigured: chatInfo().app ? chatInfo().app.configured : false,
      commands: ["ヘルプ", "アポ", "明日のアポ", "商談", "スキャン", "重複", "立ち上げ", "状態"],
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 通知の見え方を試す
app.post("/api/deploy/test-notify", async (req, res) => {
  try {
    const r = await notifyAll(deployText("🚀 *kinbotの更新が終わりました（テスト）*"), "deploy");
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 手動で自動スキャンを流す（動作確認用）
app.post("/api/apo/auto-scan", async (req, res) => {
  try {
    const r = await runApoAutoScan({ actor: req.user || "manual", force: req.body?.force === true });
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 1件だけ手動で自動割り振りを試す（画面の「自動で決める」ボタン）
app.post("/api/smart-links/:slug/auto-assign", async (req, res) => {
  try {
    const link = await getSmartLink(req.params.slug);
    if (!link) return res.status(404).json({ error: "リンクが見つかりません" });
    const s = await getSettings().catch(() => ({}));
    const inviteOwner = String(s.apoScanOwner || s.apoInviteOwner || "").trim();
    if (!inviteOwner) return res.status(400).json({ error: "予定作成の運用者が未設定です" });
    const r = await autoAssignOne(link, { inviteOwner, closers: null, cfg: null, actor: req.user || "manual" });
    if (!r.ok) return res.status(409).json({ error: r.reason, ...r });
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ローテーションの状態（次に誰に回るか）
app.get("/api/apo/rotation", async (req, res) => {
  try {
    const biz = ["DOC", "MOCHICA"].includes(String(req.query.product || "")) ? String(req.query.product) : "";
    res.json(await rotationStatus(biz));
  }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// クローザーの並び順・有効無効・1日の上限を保存
app.put("/api/apo/closers", async (req, res) => {
  try {
    const list = Array.isArray(req.body?.closers) ? req.body.closers : [];
    await saveClosers(list);
    console.log(`[apo-rotation] クローザー構成を更新 by ${req.user}（${list.length}名）`);
    res.json({ ok: true, ...(await rotationStatus()) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 次を特定の人から始める（GAS版の setNextUeno 相当）
app.post("/api/apo/rotation/next", async (req, res) => {
  try {
    res.json({ ok: true, ...(await setNextCloser(String(req.body?.email || ""), String(req.body?.product || ""))) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ローテーションの設定
app.put("/api/apo/rotation-config", async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    if (b.autoAssign !== undefined) patch.apoRotationAuto = !!b.autoAssign;
    if (b.autoScan !== undefined) patch.apoAutoScan = !!b.autoScan;
    if (b.bufferMin !== undefined) patch.apoRotationBufferMin = Math.max(0, parseInt(b.bufferMin, 10) || 0);
    if (b.maxPerRun !== undefined) patch.apoRotationMaxPerRun = Math.max(1, parseInt(b.maxPerRun, 10) || 30);
    if (b.scanIntervalSec !== undefined) {
      // 短すぎるとGoogleのAPI制限に当たるので15秒以上にする
      patch.apoScanIntervalSec = Math.min(900, Math.max(15, parseInt(b.scanIntervalSec, 10) || 60));
    }
    if (b.scanOwner !== undefined) patch.apoScanOwner = String(b.scanOwner || "").trim();
    if (b.teamBalance !== undefined) {
      patch.apoTeamBalance = ["off", "total", "perHead", "perDay"].includes(b.teamBalance) ? b.teamBalance : "off";
    }
    if (b.dayBalance !== undefined) {
      patch.apoDayBalance = b.dayBalance !== false;
    }
    if (b.balanceWindow !== undefined) patch.apoBalanceWindow = b.balanceWindow === "all" ? "all" : "month";
    if (b.fairnessStart !== undefined) {
      const v = String(b.fairnessStart || "").trim();
      patch.apoFairnessStart = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
    }
    await saveSettings(patch);
    console.log(`[apo-rotation] 設定を更新 by ${req.user}:`, JSON.stringify(patch));
    res.json({ ok: true, ...(await rotationStatus()) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== メンバー管理 =====
// 事業（DOC/MOCHICA）・チーム・役割（クローザー／インサイド／予備）をここで一括管理し、
// 保存時に closer_rotation・interns・rep_team_mapping へ同期する。
app.get("/api/members", async (req, res) => {
  try {
    const [members, candidates] = await Promise.all([listMembers(), memberCandidates()]);
    const teams = [...new Set(members.map((m) => (m.team || "").trim()).filter(Boolean))].sort();
    res.json({
      members, candidates, teams,
      roles: MEMBER_ROLES, businesses: MEMBER_BUSINESSES,
      labels: { closer: "クローザー", inside: "インサイド", fallback: "予備" },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/members", async (req, res) => {
  // 役割を変えたら、覚えていた「kincallだけ」の判定を捨てる。
  // （5分待たないと反映されない、という状態を防ぐ）
  _kcOnly.clear();
  try {
    const list = Array.isArray(req.body?.members) ? req.body.members : [];
    // 同じメールアドレスが二重に入っていないか確認する
    const seen = new Set();
    for (const m of list) {
      const e = String(m.email || "").trim().toLowerCase();
      if (!e) return res.status(400).json({ error: "メールアドレスが空のメンバーがいます" });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) {
        return res.status(400).json({ error: `メールアドレスの形式が正しくありません：${e}` });
      }
      if (seen.has(e)) return res.status(400).json({ error: `メールアドレスが重複しています：${e}` });
      seen.add(e);
    }
    const saved = await saveMembers(list);
    console.log(`[members] 更新 by ${req.user}（${saved.length}名）`);
    const sync = await syncMembersToLegacy();
    res.json({ ok: true, members: saved, sync });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/members/:email", async (req, res) => {
  try {
    await deleteMember(req.params.email);
    res.json({ ok: true, members: await listMembers() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// インサイドメンバーのカレンダーを1人ずつ調べて、どこで止まっているかを返す。
// 「登録したのに予定が出てこない」ときの原因切り分け用。
app.get("/api/apo/calendar-check", async (req, res) => {
  try {
    const s = await getSettings().catch(() => ({}));
    const owner = String(s.apoScanOwner || s.apoInviteOwner || req.user || "").trim();
    if (!owner) return res.status(400).json({ error: "走査するアカウントが未設定です（設定→メンバー管理→カレンダー照合の代表者）" });
    if (!(await gcalConnected(owner))) {
      return res.status(400).json({ error: `${owner} のGoogle連携が切れています。本人が 設定→連携→Google連携 を実行してください。` });
    }
    const setters = await listInterns();
    if (!setters.length) {
      return res.status(400).json({ error: "インサイドのメンバーが登録されていません（設定→メンバー管理で役割に「インサイド」を付けてください）" });
    }
    // 今日から60日先まで
    const now = new Date();
    const timeMin = new Date(now.getTime() - 7 * 86400 * 1000).toISOString();
    const timeMax = new Date(now.getTime() + 60 * 86400 * 1000).toISOString();

    // kinbotが作った商談予定は取り込まない。除外された件数も出して、
    // 「作ったのに通知が来ない」ときの理由が分かるようにする。
    let inviteIds = new Set();
    try { inviteIds = await activeInviteEventIds(); } catch {}

    const out = [];
    for (const st of setters) {
      const row = { name: st.name, email: st.email, readable: false, total: 0, hosted: 0,
                    tagged: 0, fresh: 0, known: 0, knownSamples: [],
                    kinbotSkipped: 0, kinbotSamples: [], samples: [], error: "" };
      try {
        const evs = await listCalendarEvents(owner, st.email, { timeMin, timeMax });
        row.readable = true;
        row.total = evs.length;
        const em = String(st.email || "").toLowerCase();
        for (const ev of evs) {
          if (ev.allDay || !ev.title) continue;
          const org = String(ev.organizer || "").toLowerCase();
          const cre = String(ev.creator || "").toLowerCase();
          const isHost = (org && org === em) || (!org && cre && cre === em);
          if (!isHost) continue;
          row.hosted++;
          if (apoTitleTag(ev.title)) {
            if (await isKinbotInviteEvent(ev, inviteIds)) {
              row.kinbotSkipped++;
              if (row.kinbotSamples.length < 4) {
                row.kinbotSamples.push({ title: ev.title.slice(0, 60), start: ev.start });
              }
              continue;
            }
            row.tagged++;
            // すでにkinbotに登録ずみか（登録ずみなら、通知はその時に済んでいる）
            let known = await getSmartLinkByEvent(ev.id).catch(() => null);
            if (!known) known = await findSmartLinkByLabelStart(ev.title, ev.start).catch(() => null);
            if (known) {
              row.known++;
              if (row.knownSamples.length < 4) {
                row.knownSamples.push({
                  title: ev.title.slice(0, 60), start: ev.start,
                  owner: known.current_owner || "", assigned: !!known.auto_assigned_at,
                  sameEvent: known.event_id === ev.id,
                });
              }
            } else {
              row.fresh++;
            }
          } else if (row.samples.length < 4) {
            // タグが無くて取り込まれていない予定を例として返す
            row.samples.push({ title: ev.title.slice(0, 60), start: ev.start });
          }
        }
      } catch (e) {
        row.error = /40[34]/.test(e.message)
          ? "カレンダーを参照できません（このアドレスのカレンダーが代表者に共有されていない可能性があります）"
          : e.message;
      }
      out.push(row);
    }
    res.json({ owner, window: { from: timeMin, to: timeMax }, members: out });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ホーム画面用：指定日に自分へ割り振られたアポ。
// メールの状態と、Salesforceの立ち上げに使う情報も一緒に返す。
app.get("/api/apo/mine", async (req, res) => {
  try {
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || ""))
      ? String(req.query.date)
      : new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    // 「他メンバーとして操作」中はその人のぶんを見る
    const owner = String(req.query.owner || req.user || "").toLowerCase();
    // 既定はその日のぶんだけ。mode=from を渡すと、その日以降をまとめて返す。
    const mode = req.query.mode === "from" ? "from" : "day";
    // 自分で取ったアポも拾うため、名前も渡す（昔の記録にはメールが入っていないため）
    const myName = await displayNameOf(owner).catch(() => "");
    const rows = await myAssignedApos(owner, d, mode, 200, myName);
    // 自動立ち上げの結果（通せなかった理由）を添える
    const al = await autolaunchForSlugs(rows.map((r) => r.slug)).catch(() => ({}));
    const mail = await listApoMailStatus(rows.map((r) => r.slug));
    res.json({
      date: d, owner, mode,
      items: rows.map((r) => ({
        slug: r.slug, title: r.label, setter: r.setter, business: r.business || "",
        // 自分で取ったアポか（一覧で見分けられるように）
        selfGot: r.self_got === true,
        // アポを取った日時（一覧はこの日で並べている）
        takenAt: r.apo_at || r.created_at || null,
        owner: r.current_owner || "",
        start: r.start_time, end: r.end_time,
        clientEmail: r.client_email || "",
        smartUrl: joinUrl(r.slug),
        inviteEventId: r.invite_event_id || "",
        mail: mail[r.slug] || {},
        launch: al[r.slug]
          ? {
              ok: al[r.slug].ok,
              oppId: al[r.slug].opp_id || "",
              filledUrl: al[r.slug].filled_url || "",
              reasonText: al[r.slug].ok ? "" : reasonText(al[r.slug].reason, al[r.slug].detail),
              at: al[r.slug].tried_at,
            }
          : null,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 作ってしまった商談予定の取り消し =====
// 「間違えて割り振り直した」ときに、作られた予定をカレンダーから消すための機能。

// 直近に作られた商談予定の一覧
app.get("/api/apo/invites", async (req, res) => {
  try {
    const hours = Math.max(1, Math.min(720, parseInt(req.query.hours, 10) || 24));
    const rows = await recentInvites(hours);
    const names = {};
    for (const u of await listUsers().catch(() => [])) names[u.email] = u.name || u.email;
    res.json({
      hours,
      invites: rows.map((r) => ({
        slug: r.slug, label: r.label, setter: r.setter, business: r.business || "",
        owner: r.current_owner, ownerName: names[r.current_owner] || r.current_owner,
        start: r.start_time, eventId: r.invite_event_id,
        eventOwner: r.invite_event_owner, eventOwnerName: names[r.invite_event_owner] || r.invite_event_owner,
        updatedAt: r.updated_at,
      })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 1件の商談予定をカレンダーから消す（アポの割り当て自体は残す）
app.delete("/api/apo/invites/:slug", async (req, res) => {
  try {
    const link = await getSmartLink(req.params.slug);
    if (!link) return res.status(404).json({ error: "リンクが見つかりません" });
    if (!link.invite_event_id) return res.status(400).json({ error: "この商談には作成された予定がありません" });
    const owner = link.invite_event_owner ||
      (await getSettings().catch(() => ({}))).apoInviteOwner || "";
    if (!owner) return res.status(400).json({ error: "どのカレンダーに作られたか分かりません。手動で削除してください。" });
    try {
      await deleteCalendarEvent(owner, link.invite_event_id, "primary");
    } catch (e) {
      // すでに手で消されている場合もあるので、404系は成功として扱う
      if (!/40[04]/.test(e.message)) throw e;
    }
    await setSmartLinkInviteEvent(link.slug, null, null);
    console.log(`[apo-invite] 予定を取り消し ${link.slug}（${owner}）by ${req.user}`);
    res.json({ ok: true, slug: link.slug, owner });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// 取り残しの予定を探す。
// kinbotが作った予定のうち、いまkinbotが管理していないもの（＝作り直しで置き換わった古い予定など）。
app.get("/api/apo/orphan-invites", async (req, res) => {
  try {
    const s = await getSettings().catch(() => ({}));
    // 運用者と、クローザー全員のカレンダーを見る
    const owners = new Set();
    const op = String(s.apoInviteOwner || "").trim();
    if (op) owners.add(op);
    for (const c of await listClosers().catch(() => [])) if (c.email) owners.add(c.email);
    if (!owners.size) return res.status(400).json({ error: "調べる対象のカレンダーがありません" });

    const active = await activeInviteEventIds();
    const days = Math.max(1, Math.min(180, parseInt(req.query.days, 10) || 90));
    const timeMin = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
    const timeMax = new Date(Date.now() + days * 86400 * 1000).toISOString();

    const found = [], errors = [];
    for (const owner of owners) {
      if (!(await gcalConnected(owner).catch(() => false))) continue;
      try {
        const evs = await listCalendarEvents(owner, "primary", { timeMin, timeMax });
        for (const ev of evs) {
          if (!String(ev.description || "").includes("kinbotが自動作成した商談予定です")) continue;
          if (active.has(ev.id)) continue; // いま有効なものは対象外
          found.push({ owner, eventId: ev.id, title: ev.title, start: ev.start });
        }
      } catch (e) { errors.push({ owner, error: e.message }); }
    }
    found.sort((a, b) => String(a.start).localeCompare(String(b.start)));
    res.json({ owners: [...owners], found, errors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ───────────────────────────────────────────────────────────
// カレンダーに同じ商談の予定が2つ以上あるものを探して、余分なほうを消す。
//
// データベースの記録に頼らず、カレンダーそのものを見て突き合わせる。
// （アポの記録を先に消してしまうと、予定だけが残って追えなくなるため）
// 消すのは「kinbotが作った予定」だけ。アポ獲得者が作った元の予定は必ず残す。
// ───────────────────────────────────────────────────────────

// 予定名をそろえて比べる。「リスケ済み」などの付け足しや空白の違いは無視する。
function normEventTitle(t) {
  return String(t || "")
    .replace(/^[\s　]*(リスケ済み|リスケ|再調整|変更後|確定)[\s　]*/g, "")
    .replace(/[\s　]/g, "")
    .toLowerCase();
}

// 誰のカレンダーを見るか。運用者・代表者・インサイド・クローザー全員。
async function calendarPeople() {
  const s = await getSettings().catch(() => ({}));
  const rep = String(s.apoScanOwner || s.apoInviteOwner || "").trim();
  const list = new Map();
  for (const c of await listClosers({ activeOnly: false }).catch(() => [])) {
    if (c.email) list.set(String(c.email).toLowerCase(), c.name || c.email);
  }
  for (const i of await listInterns().catch(() => [])) {
    if (i.email) list.set(String(i.email).toLowerCase(), i.name || i.email);
  }
  const op = String(s.apoInviteOwner || "").trim().toLowerCase();
  if (op && !list.has(op)) list.set(op, op);
  return { rep, people: [...list.entries()].map(([email, name]) => ({ email, name })) };
}

// その人のカレンダーを読む。本人が連携していればその権限で、
// 連携していなければ代表者の権限で（共有されていれば読める）。
async function readPersonCalendar(rep, email, range) {
  if (await gcalConnected(email).catch(() => false)) {
    try { return { by: email, calendarId: "primary", evs: await listCalendarEvents(email, "primary", range) }; }
    catch {}
  }
  if (rep && await gcalConnected(rep).catch(() => false)) {
    return { by: rep, calendarId: email, evs: await listCalendarEvents(rep, email, range) };
  }
  throw new Error("カレンダーを読めません（本人のGoogle連携も、代表者への共有もありません）");
}

app.get("/api/apo/duplicate-events", async (req, res) => {
  try {
    const { rep, people } = await calendarPeople();
    if (!people.length) return res.status(400).json({ error: "調べる対象のメンバーが登録されていません" });

    const days = Math.max(1, Math.min(180, parseInt(req.query.days, 10) || 90));
    const range = {
      timeMin: new Date(Date.now() - 30 * 86400 * 1000).toISOString(),
      timeMax: new Date(Date.now() + days * 86400 * 1000).toISOString(),
    };
    let inviteIds = new Set();
    try { inviteIds = await activeInviteEventIds(); } catch {}

    const found = [], errors = [], checked = [];
    for (const p of people) {
      let got;
      try { got = await readPersonCalendar(rep, p.email, range); }
      catch (e) { errors.push({ email: p.email, error: e.message }); continue; }
      const evs = (got.evs || []).filter((ev) => !ev.allDay && ev.title);
      checked.push({ email: p.email, name: p.name, events: evs.length });

      // 予定名＋開始時刻でまとめる
      const groups = new Map();
      for (const ev of evs) {
        if (!apoTitleTag(ev.title) && !isKinbotInvite(ev.description)) continue;
        const key = `${normEventTitle(ev.title)}|${String(ev.start || "").slice(0, 16)}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(ev);
      }
      for (const [, list] of groups) {
        if (list.length < 2) continue;
        // kinbotが作ったものと、本人が作ったものに分ける
        const mine = list.filter((ev) => !isKinbotInvite(ev.description));
        const bots = list.filter((ev) => isKinbotInvite(ev.description));
        let drop = [];
        if (mine.length && bots.length) {
          drop = bots;                       // 本人の予定を残し、kinbotの予定を消す
        } else if (!mine.length && bots.length > 1) {
          // どれもkinbotの予定。いま使っているものを1つ残す。
          const keep = bots.find((ev) => inviteIds.has(ev.id)) || bots[0];
          drop = bots.filter((ev) => ev.id !== keep.id);
        } else if (mine.length > 1 && !bots.length) {
          continue;                          // 本人が作った予定同士。kinbotは触らない。
        }
        for (const ev of drop) {
          found.push({
            calendarEmail: p.email, name: p.name, tokenOwner: got.by, calendarId: got.calendarId,
            eventId: ev.id, title: ev.title, start: ev.start,
            keeps: (mine[0] || {}).title || "",
          });
        }
      }
    }
    found.sort((a, b) => String(a.start).localeCompare(String(b.start)));
    res.json({ rep, checked, found, errors });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/apo/duplicate-events/delete", async (req, res) => {
  try {
    const list = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!list.length) return res.status(400).json({ error: "消す対象が指定されていません" });
    const done = [], failed = [];
    for (const it of list) {
      const eventId = String(it.eventId || "").trim();
      const calendarEmail = String(it.calendarEmail || "").trim();
      if (!eventId || !calendarEmail) continue;
      // 本人の権限 → 代表者の権限（共有されていれば消せる）の順に試す
      const tries = [];
      if (await gcalConnected(calendarEmail).catch(() => false)) tries.push([calendarEmail, "primary"]);
      const rep = String(it.tokenOwner || "").trim();
      if (rep && rep !== calendarEmail) tries.push([rep, calendarEmail]);
      let ok = false, lastErr = "";
      for (const [owner, calId] of tries) {
        try { ok = await deleteCalendarEvent(owner, eventId, calId); if (ok) break; }
        catch (e) { lastErr = e.message; }
      }
      if (ok) {
        // kinbotの管理からも外す（次に作り直されないように）
        await clearInviteEvent(eventId).catch(() => {});
        done.push({ eventId, calendarEmail });
      } else {
        failed.push({ eventId, calendarEmail, error: lastErr || "消せませんでした（権限がない可能性があります）" });
      }
      // Googleのレート制限に当たらないよう、少し間を置く
      await new Promise((r) => setTimeout(r, 120));
    }
    console.log(`[apo-invite] カレンダーの重複予定を削除 ${done.length}件 by ${req.user}`);
    res.json({ ok: true, deleted: done.length, done, failed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 「アポを取った人＝担当者」なのに、kinbotが別の商談予定を作ってしまったものを探す。
// 本人のカレンダーには元の予定があるので、kinbotの予定は余分（同じ商談が2つ並ぶ）。
app.get("/api/apo/self-invites", async (req, res) => {
  try {
    const closers = await listClosers({ activeOnly: false }).catch(() => []);
    const norm = (v) => String(v || "").replace(/[\s　]/g, "");
    const rows = await linksWithInvite(500);
    const found = [];
    for (const l of rows) {
      const owner = String(l.current_owner || "").toLowerCase();
      if (!owner) continue;
      // アポ獲得者のメールが担当者と同じ／獲得者の名前が担当クローザーと同じ
      const byMail = String(l.setter_email || "").toLowerCase() === owner;
      const c = closers.find((x) => String(x.email || "").toLowerCase() === owner);
      const byName = !!(c && norm(c.name) && norm(c.name) === norm(l.setter));
      if (!byMail && !byName) continue;
      found.push({
        slug: l.slug, label: l.label, start: l.start_time, setter: l.setter,
        owner: l.invite_event_owner || l.current_owner, eventId: l.invite_event_id,
      });
    }
    found.sort((a, b) => String(a.start).localeCompare(String(b.start)));
    res.json({ found });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 上で見つけた「余分な予定」を消して、1つに戻す
app.post("/api/apo/self-invites/delete", async (req, res) => {
  try {
    const list = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!list.length) return res.status(400).json({ error: "消す対象が指定されていません" });
    const done = [], failed = [];
    for (const it of list) {
      const slug = String(it.slug || "").trim();
      const owner = String(it.owner || "").trim();
      const eventId = String(it.eventId || "").trim();
      if (!slug || !eventId) continue;
      try {
        if (owner) await deleteCalendarEvent(owner, eventId, "primary");
      } catch (e) {
        if (!/40[04]/.test(e.message)) { failed.push({ slug, error: e.message }); continue; }
      }
      // kinbotの管理からも外す（次に作り直されないように）
      await setSmartLinkInviteEvent(slug, null, null).catch(() => {});
      done.push({ slug, eventId });
    }
    console.log(`[apo-invite] 自分で取ったアポの余分な予定を削除 ${done.length}件 by ${req.user}`);
    res.json({ ok: true, deleted: done.length, done, failed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 取り残しの予定をまとめて消す
app.post("/api/apo/orphan-invites/delete", async (req, res) => {
  try {
    const list = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!list.length) return res.status(400).json({ error: "消す対象が指定されていません" });
    const active = await activeInviteEventIds();
    const done = [], failed = [];
    for (const it of list) {
      const owner = String(it.owner || "").trim();
      const eventId = String(it.eventId || "").trim();
      if (!owner || !eventId) continue;
      // 念のため、いま有効な予定は消さない
      if (active.has(eventId)) { failed.push({ eventId, error: "現在使われている予定のため消しませんでした" }); continue; }
      try {
        await deleteCalendarEvent(owner, eventId, "primary");
        done.push({ owner, eventId });
      } catch (e) {
        if (/40[04]/.test(e.message)) done.push({ owner, eventId });
        else failed.push({ owner, eventId, error: e.message });
      }
    }
    console.log(`[apo-invite] 取り残しの予定を削除 ${done.length}件 by ${req.user}`);
    res.json({ ok: true, deleted: done.length, done, failed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== 割り振り停止の履歴 =====
// 停止していた期間は「稼働日」から除かれるので、復帰後に埋め合わせで多く配られることはない。
app.get("/api/apo/suspensions", async (req, res) => {
  try {
    const [list, now] = await Promise.all([listSuspensions(String(req.query.email || "")), suspendedNow()]);
    res.json({ suspensions: list, activeNow: now });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/apo/suspensions", async (req, res) => {
  try {
    const b = req.body || {};
    const email = String(b.email || "").trim().toLowerCase();
    const d = /^\d{4}-\d{2}-\d{2}$/;
    if (!email) return res.status(400).json({ error: "クローザーを選んでください" });
    if (!d.test(String(b.startDate || ""))) return res.status(400).json({ error: "開始日を入力してください" });
    if (b.endDate && !d.test(String(b.endDate))) return res.status(400).json({ error: "終了日の形式が正しくありません" });
    if (b.endDate && String(b.endDate) < String(b.startDate)) {
      return res.status(400).json({ error: "終了日が開始日より前になっています" });
    }
    const row = await addSuspension({
      email, startDate: b.startDate, endDate: b.endDate || null,
      reason: b.reason, createdBy: req.user,
    });
    console.log(`[apo-suspend] ${email} ${b.startDate}〜${b.endDate || "（継続中）"} by ${req.user}`);
    res.json({ ok: true, row, ...(await rotationStatus(String(b.product || ""))) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/apo/suspensions/:id", async (req, res) => {
  try {
    await deleteSuspension(parseInt(req.params.id, 10));
    res.json({ ok: true, ...(await rotationStatus(String(req.query.product || ""))) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 過去の実績（スプレッドシート等の件数）を取り込む。均等化の計算に足される。
// 名前でもメールでも指定できるようにして、姓だけの表記にも対応する。
app.put("/api/apo/baseline", async (req, res) => {
  try {
    const body = req.body || {};
    const closers = await listClosers();
    const map = {};
    const matched = [], unmatched = [];

    // { "email": 件数 } 形式
    for (const [k, v] of Object.entries(body.counts || {})) {
      const key = String(k).trim();
      let hit = closers.find((c) => c.email.toLowerCase() === key.toLowerCase());
      // 見つからなければ名前で照合（「森田」→「森田弥鳴」のような部分一致も許す）
      if (!hit) hit = closers.find((c) => c.name === key);
      if (!hit) hit = closers.find((c) => c.name && (c.name.includes(key) || key.includes(c.name)));
      if (hit) { map[hit.email] = v; matched.push({ input: key, name: hit.name, count: v }); }
      else unmatched.push(key);
    }
    await saveBaselineCounts(map);
    console.log(`[apo-baseline] 過去実績を取り込み by ${req.user}:`, JSON.stringify(matched));
    res.json({ ok: true, matched, unmatched, ...(await rotationStatus(String(req.body?.product || ""))) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 並び順だけを保存する（アポ振り分けのドラッグ並べ替え用）
app.put("/api/apo/closer-order", async (req, res) => {
  try {
    const emails = Array.isArray(req.body?.emails) ? req.body.emails : [];
    await saveCloserOrder(emails);
    res.json({ ok: true, ...(await rotationStatus()) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// チーム別の実績。チーム間の偏りをこれで確認する。
// window=month（当月・既定）／all（通算）
app.get("/api/apo/team-stats", async (req, res) => {
  try {
    await syncTeamsFromClosers();
    const window = req.query.window === "all" ? "all" : "month";
    const biz = ["DOC", "MOCHICA"].includes(String(req.query.product || "")) ? String(req.query.product) : "";
    const range = balanceRange(window);
    const [teams, stats, byCloser] = await Promise.all([
      listTeams(), teamAssignStats(range.from, range.to, biz), closerAssignStats(range.from, range.to),
    ]);
    const closers = await listClosers({ business: biz });
    // チームごとにメンバーの内訳も返す（チーム内の偏りも見えるように）
    const members = {};
    for (const c of closers) {
      const t = String(c.team || "").trim() || "未設定";
      members[t] = members[t] || [];
      members[t].push({
        email: c.email, name: c.name, active: c.active,
        count: byCloser[c.email] || 0, total_all_time: c.assigned_count,
      });
    }
    for (const t of Object.keys(members)) members[t].sort((a, b) => b.count - a.count);
    const cfg = await getRotationConfig();
    res.json({
      period: { window, label: range.label || "通算", from: range.from, to: range.to },
      business: biz, mode: cfg.teamBalance, teams, teamStats: stats, members,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// チームの並び順・稼働状態を保存
app.put("/api/apo/teams", async (req, res) => {
  try {
    const list = Array.isArray(req.body?.teams) ? req.body.teams : [];
    await saveTeams(list);
    console.log(`[apo-rotation] チーム構成を更新 by ${req.user}（${list.length}チーム）`);
    res.json({ ok: true, ...(await rotationStatus()) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 割り振りの履歴（順番がおかしいときの調査用）
app.get("/api/apo/assign-log", async (req, res) => {
  try { res.json(await listAssignLog(50)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/apo/pickup", async (req, res) => {
  try {
    const biz = ["DOC", "MOCHICA"].includes(String(req.query.product || "")) ? String(req.query.product) : "";
    let { items, errors } = await collectApoAppointments(req.user, {
      created: req.query.created, start: req.query.start,
    });
    // 事業タブで絞る。事業が未判定のアポはどのタブでも残す（取りこぼさないため）。
    if (biz) items = items.filter((it) => !it.business || it.business === biz);
    // アポメールの送信状況をまとめて引く（1件ずつ引くとN+1になるため）
    const mailStatus = await listApoMailStatus(items.map((i) => i.slug));
    for (const it of items) it.mail = mailStatus[it.slug] || {};
    const mailCfg = await getApoMailConfig().catch(() => null);
    const rot = await rotationStatus(biz).catch(() => null);
    for (const it of items) delete it._link;
    res.json({
      filters: { created: req.query.created || "", start: req.query.start || "", product: biz },
      count: items.length, appointments: items, errors,
      mail_config: mailCfg, rotation: rot,
    });
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
// ===== 商談予定の自動作成（招待方式） =====
// 運用者（設定 apoInviteOwner）のカレンダーに予定を作り、クローザーをゲストに招待する。
// 招待方式なので、クローザーのカレンダーへの権限は不要。
async function createApoInvite(link, { actor } = {}) {
  const s = await getSettings();
  if (!link.current_owner) throw new Error("担当者が未割り当てです。先に担当者を選んでください。");
  if (!link.start_time) throw new Error("この商談の開始時刻が分かりません（カレンダー予定の時刻が取得できていません）。");

  const start = new Date(link.start_time);
  const end = link.end_time ? new Date(link.end_time) : new Date(start.getTime() + 60 * 60 * 1000); // 既定1時間
  const summary = link.label || "商談";
  let description = `kinbotが自動作成した商談予定です。\n参加URL: ${joinUrl(link.slug)}\n` +
    `アポ獲得: ${link.setter || "-"}\n担当: ${link.current_owner}`;
  // アポ獲得者が元の予定に書いたメモをそのまま引き継ぐ（先方の連絡先や資料希望などが入っている）
  const note = String(link.source_note || "").trim();
  if (note) {
    description += `\n\n────────────────\n` +
      `【アポ獲得時のメモ（${link.setter || "アポ獲得者"}）】\n${note}`;
  }

  // 作り方は2通り。
  //   closer … 担当者本人のカレンダーに直接作る（運用者のカレンダーには入らない）
  //   owner  … 運用者のカレンダーに作り、担当者をゲストとして招待する（従来方式）
  // 既定は closer。担当者がGoogle未連携のときだけ owner 方式にする。
  const mode = s && s.apoInviteMode === "owner" ? "owner" : "closer";
  const closerReady = await gcalConnected(link.current_owner).catch(() => false);

  // 担当が変わっていた場合、前の担当のカレンダーから古い予定を消す
  const prevId = link.invite_event_id || null;
  const prevOwner = link.invite_event_owner || null;
  const useCloser = mode === "closer" && closerReady;
  const targetOwner = useCloser
    ? link.current_owner
    : (s && String(s.apoInviteOwner || "").trim()) || "";

  if (!targetOwner) {
    throw new Error(
      "商談予定を作るアカウントがありません。担当者本人がGoogle連携するか、" +
      "設定→メンバー管理→「商談予定の自動作成」で運用者を指定してください。"
    );
  }
  if (prevId && prevOwner && prevOwner !== targetOwner) {
    try {
      await deleteCalendarEvent(prevOwner, prevId, "primary");
      console.log(`[apo-invite] 前の担当（${prevOwner}）のカレンダーから予定を削除 ${prevId}`);
    } catch (e) {
      console.warn(`[apo-invite] 前の予定を削除できませんでした（${prevOwner}）: ${e.message}`);
    }
  }

  let ev;
  if (useCloser) {
    // 担当者本人のカレンダーに作る。ゲストは付けないので、他の人のカレンダーには入らない。
    ev = await createCalendarEvent(link.current_owner, {
      summary, description, start, end,
      guests: [],
      calendarId: "primary",
      eventId: prevOwner === link.current_owner ? prevId : null,
      sendUpdates: "none",
    });
    console.log(`[apo-invite] ${link.slug} → ${link.current_owner} 本人のカレンダーに作成 (${ev.id}) by ${actor || "auto"}`);
  } else {
    if (!(await gcalConnected(targetOwner))) {
      throw new Error(`運用者（${targetOwner}）のGoogle連携が切れています。本人が 設定→連携→Google連携 を実行してください。`);
    }
    const calendarId = (s && String(s.apoInviteCalendarId || "").trim()) || "primary";
    ev = await createCalendarEvent(targetOwner, {
      summary, description, start, end,
      guests: [link.current_owner],  // クローザーをゲストとして招待
      guestsCanModify: true,
      calendarId,
      eventId: prevOwner === targetOwner ? prevId : null,
      sendUpdates: "all",
    });
    console.log(`[apo-invite] ${link.slug} → ${link.current_owner} を招待（運用者 ${targetOwner} のカレンダー, ${ev.id}）` +
      `${mode === "closer" ? "※担当者がGoogle未連携のため招待方式にしました" : ""} by ${actor || "auto"}`);
  }
  await setSmartLinkInviteEvent(link.slug, ev.id, targetOwner);
  return ev;
}

// 担当セールスの表示名を引く（メールしか無い場合はメールをそのまま使う）
async function repDisplayName(email) {
  if (!email) return "";
  try {
    const users = await listUsers();
    const u = (users || []).find((x) => String(x.email || "").toLowerCase() === String(email).toLowerCase());
    return (u && (u.name || u.email)) || email;
  } catch { return email; }
}

app.put("/api/smart-links/:slug/owner", async (req, res) => {
  try {
    const existing = await getSmartLink(req.params.slug);
    if (!existing) return res.status(404).json({ error: "リンクが見つかりません" });
    if (!req.isAdmin && existing.created_by !== req.user) return res.status(403).json({ error: "このリンクを操作する権限がありません" });
    const owner = req.body?.owner ? String(req.body.owner) : null;

    // 「差し替えだけ」のとき（quiet）は、担当を書き換えるだけで何も動かさない。
    // すでに案内が済んでいるアポの担当を、あとから直したいときに使う。
    //   ・Google Chatへの通知を出さない
    //   ・確定メールを送らない
    //   ・商談予定の招待を作り直さない
    // スマートリンクの行き先だけは、担当に合わせて自動で切り替わる。
    if (req.body?.quiet === true) {
      const only = await setSmartLinkOwner(req.params.slug, owner);
      console.log(`[apo] ${req.params.slug} の担当を差し替えました（知らせません）by ${req.user}`);
      return res.json({ ok: true, link: only, quiet: true });
    }

    const link = await setSmartLinkOwner(req.params.slug, owner);
    // 担当が決まったら、商談予定を自動作成してクローザーを招待する（失敗しても割り当ては成功のまま返す）
    let invite = null, inviteError = null;
    const s = await getSettings().catch(() => ({}));
    // 予定を取った本人が担当になる場合は、本人のカレンダーにもう予定がある。
    // ここで作ると同じ商談の予定が2つになるので、作らない。
    const setterSelf = await selfAcquired(link, String(link.business || "")).catch(() => null);
    const selfOwn = !!(owner && setterSelf &&
      String(setterSelf.email || "").toLowerCase() === String(owner).toLowerCase());
    if (owner && !selfOwn && s && s.apoAutoInvite !== false) {
      try { invite = await createApoInvite(link, { actor: req.user }); }
      catch (e) { inviteError = e.message; console.warn("[apo-invite] 失敗", req.params.slug, e.message); }
    } else if (selfOwn) {
      console.log(`[apo-invite] ${req.params.slug} は本人の予定をそのまま使います`);
    }
    // 続けてアポ確定メールを、担当セールス本人のGmailから自動送信する
    let mail = null;
    if (owner) {
      const cfg = await getApoMailConfig().catch(() => null);
      if (cfg && cfg.autoConfirm) {
        mail = await sendApoMail(link, "confirm", {
          url: joinUrl(link.slug),
          repName: await repDisplayName(owner),
          actor: req.user || "auto",
        });
      } else {
        mail = { ok: false, skipped: true, reason: "確定メールの自動送信がOFFです" };
      }
    }
    // Google Chat へ通知する（手で担当を選んだときも、メールの状況を含めて1通で知らせる）
    if (owner) {
      (async () => {
        const counts = await assignCounts(link.business || "").catch(() => null);
        const st = await getSettings().catch(() => ({}));
        const runIt = st?.sfAutoLaunch === true;
        const op = await sfOperator(req.user).catch(() => "");
        const launch = await (op
          ? tryAutoLaunch(op, link, { dryRun: !runIt, ownerEmail: owner })
          : Promise.resolve({ ok: false, reason: "no_operator" }))
          .then((r) => ({ ok: r.ok, dryRun: !runIt, reasonText: r.ok ? "" : reasonText(r.reason, r.detail) }))
          .catch(() => null);
        await notifyAssigned({
          title: link.label, start: link.start_time, repName: await repDisplayName(owner),
          setter: link.setter, reason: `${req.user} が選択`,
          url: joinUrl(link.slug), auto: false,
          mail, clientEmail: link.client_email,
          counts, goal: st?.apoShowGoal === true ? (parseInt(st?.apoMonthlyGoal, 10) || 0) : 0, launch,
        });
        // テスト用のアポは、通知まで済ませたら数から外す
        await loadTestWords().catch(() => {});
        if (isTestApo(link.label)) {
          await excludeApo(link.slug, "テスト用のアポ").catch(() => {});
          console.log(`[apo-assign] テスト用として数から外しました：${link.label}`);
        }
      })().catch(() => {});
    }
    res.json({ ok: true, link, invite, invite_error: inviteError, mail });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// このアポの事業（DOC / MOCHICA）を手で変える
app.put("/api/smart-links/:slug/business", async (req, res) => {
  try {
    const b = String(req.body?.business || "").trim();
    if (b && !["DOC", "MOCHICA"].includes(b)) return res.status(400).json({ error: "DOC か MOCHICA を指定してください" });
    const link = await setSmartLinkBusiness(req.params.slug, b || null);
    res.json({ ok: true, link });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// お客様の宛先を手入力で補完・修正する
app.put("/api/smart-links/:slug/client", async (req, res) => {
  try {
    const link = await getSmartLink(req.params.slug);
    if (!link) return res.status(404).json({ error: "リンクが見つかりません" });
    const email = String(req.body?.email || "").trim().toLowerCase();
    const name = String(req.body?.name || "").trim();
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: "メールアドレスの形式が正しくありません" });
    }
    const updated = await setSmartLinkClient(req.params.slug, { email, name, source: "manual" }, true);
    res.json({ ok: true, link: updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 手動送信・再送（自動が失敗したとき、内容を直して送り直すとき）
app.post("/api/smart-links/:slug/mail", async (req, res) => {
  try {
    const link = await getSmartLink(req.params.slug);
    if (!link) return res.status(404).json({ error: "リンクが見つかりません" });
    const kind = req.body?.kind === "reminder" ? "reminder" : "confirm";
    const force = req.body?.force === true;
    const r = await sendApoMail(link, kind, {
      url: joinUrl(link.slug),
      repName: await repDisplayName(link.current_owner),
      force,
      actor: req.user || "manual",
    });
    if (!r.ok) return res.status(r.skipped ? 409 : 400).json({ error: r.reason, ...r });
    // Google Chat へ通知
    notifyMailDraft({
      title: link.label, start: link.start_time,
      repName: await repDisplayName(link.current_owner),
      to: r.to, draft: !!r.draft, subject: r.subject,
    }).catch(() => {});
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// アポメールの設定
app.get("/api/apo-mail-config", async (req, res) => {
  try {
    const cfg = await getApoMailConfig();
    res.json({
      ...cfg,
      defaults: {
        confirmSubject: DEFAULT_CONFIRM_SUBJECT, confirmBody: DEFAULT_CONFIRM_BODY,
        reminderSubject: DEFAULT_REMINDER_SUBJECT, reminderBody: DEFAULT_REMINDER_BODY,
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
// テストメールを送る。
// 架空のアポで文面を作って送るだけなので、実際のアポには何も残らない。
app.post("/api/apo-mail/test", async (req, res) => {
  try {
    const b = req.body || {};
    const to = String(b.to || req.user || "").trim();
    const r = await sendTestApoMail({
      kind: b.kind === "reminder" ? "reminder" : "confirm",
      to,
      // 送るのはログインしている本人のGmailから（署名や会議室URLも本人のもの）
      owner: req.user,
      draft: b.draft === true,
      // 「ほかの人が取ったアポ」の文面を試したいときは、獲得者の名前を入れる
      setter: String(b.setter || "").trim(),
    });
    if (!r.ok) return res.status(400).json(r);
    console.log(`[apo-mail] テストメール（${b.kind || "confirm"}）を ${to} へ by ${req.user}`);
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/apo-mail-config", async (req, res) => {
  try {
    const b = req.body || {};
    const patch = {};
    if (b.deliverMode !== undefined) patch.apoMailDeliverMode = b.deliverMode === "send" ? "send" : "draft";
    if (b.autoConfirm !== undefined) patch.apoMailAutoConfirm = !!b.autoConfirm;
    if (b.autoReminder !== undefined) patch.apoMailAutoReminder = !!b.autoReminder;
    if (b.reminderHour !== undefined) patch.apoMailReminderHour = Math.min(23, Math.max(0, parseInt(b.reminderHour, 10) || 0));
    if (b.copyToSelf !== undefined) patch.apoMailCopyToSelf = b.copyToSelf !== false;
    if (b.remindGap !== undefined) patch.apoMailRemindGap = Math.min(72, Math.max(0, parseInt(b.remindGap, 10) || 0));
    if (b.companyName !== undefined) patch.apoMailCompanyName = String(b.companyName || "").slice(0, 100);
    if (b.confirmSubject !== undefined) patch.apoMailConfirmSubject = String(b.confirmSubject || "").slice(0, 300);
    if (b.confirmBody !== undefined) patch.apoMailConfirmBody = stripRetiredLines(String(b.confirmBody || "")).slice(0, 8000);
    if (b.reminderSubject !== undefined) patch.apoMailReminderSubject = String(b.reminderSubject || "").slice(0, 300);
    if (b.reminderBody !== undefined) patch.apoMailReminderBody = stripRetiredLines(String(b.reminderBody || "")).slice(0, 8000);
    if (b.maxPerRun !== undefined) patch.apoMailMaxPerRun = Math.max(1, parseInt(b.maxPerRun, 10) || 50);
    await saveSettings(patch);
    console.log(`[apo-mail] 設定を更新 by ${req.user}`);
    res.json({ ok: true, config: await getApoMailConfig() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 前日リマインドを今すぐ流す（動作確認用）
app.post("/api/apo-mail/run-reminders", async (req, res) => {
  try {
    const r = await runReminderSweep({ joinUrl, repNameOf: repDisplayName });
    res.json({ ok: true, ...r });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 手動で作り直す（自動が失敗したとき・時間を変えたときなど）
app.post("/api/smart-links/:slug/invite", async (req, res) => {
  try {
    const link = await getSmartLink(req.params.slug);
    if (!link) return res.status(404).json({ error: "リンクが見つかりません" });
    const ev = await createApoInvite(link, { actor: req.user });
    res.json({ ok: true, invite: ev });
  } catch (e) { res.status(400).json({ error: e.message }); }
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

// ===== 提案資料（Googleスライド蓄積＋AI検索） =====

// Google SlidesからIDを抽出
function extractSlideId(url) {
  const m = String(url).match(/\/presentation\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

// 登録API（URLとメタデータを保存。テキストはクライアントから受け取る）
app.post("/api/proposals", async (req, res) => {
  try {
    const { slide_url, deal_id, text, title } = req.body || {};
    if (!slide_url) return res.status(400).json({ error: "URLが必要です" });
    const slideId = extractSlideId(slide_url);
    if (!slideId) return res.status(400).json({ error: "GoogleスライドのURLが正しくありません" });

    const companyName = req.body.company_name || "";
    const industry = req.body.industry || "";
    const employeeSize = req.body.employee_size || "";
    const region = req.body.region || "";
    const dealResult = req.body.result || "";
    const slideTitle = title || "提案資料";
    const slideText = text || "";

    // テキストがあればAI要約
    let summary = "", keywords = [];
    if (slideText && slideText.length > 20) {
      try {
        const { freeAnalyze } = await import("./analyzer.js");
        const prompt = `以下は「${companyName || "不明"}」への提案資料のテキストです。
1. 200字以内で要約（何を提案しているか）
2. キーワード5つ以内
JSON形式で: {"summary":"...","keywords":["..."]}
テキスト:
${slideText.slice(0, 30000)}`;
        const raw = await freeAnalyze(prompt, { provider: "gemini", maxTokens: 500 });
        const m = raw.match(/\{[\s\S]*\}/);
        if (m) { const p = JSON.parse(m[0]); summary = p.summary || ""; keywords = p.keywords || []; }
      } catch (e) { console.error("[proposal] summarize:", e.message); }
    }
    if (!summary) summary = slideText ? slideText.slice(0, 200) : `${companyName}への提案資料`;

    const row = await insertProposalFile({
      deal_id: deal_id || null, slide_url, slide_id: slideId,
      filename: slideTitle, uploaded_by: req.user || "",
      summary, extracted_text: slideText,
      tags: { keywords },
      company_name: companyName, industry, employee_size: employeeSize, region, result: dealResult,
    });
    console.log(`[proposal] registered: ${slideTitle} (${companyName})`);
    res.json({ ok: true, proposal: row });
  } catch (e) {
    console.error("[proposal]", e.message);
    res.status(500).json({ error: e.message });
  }
});

// 検索API（自然言語 → Geminiがフィルタに変換 → DB検索）
app.get("/api/proposals/search", async (req, res) => {
  try {
    const q = req.query.q || "";
    const filters = {};

    if (q) {
      // まず単純なテキスト検索
      filters.search = q;
      // AIでクエリ解析（業界・規模・受注結果を抽出）
      try {
        const { freeAnalyze } = await import("./analyzer.js");
        const parsed = await freeAnalyze(
          `ユーザーの検索クエリから、以下のフィルタを抽出してください。該当しないものは空文字にしてください。
クエリ: "${q}"
JSON形式で回答（他の文章は出力しない）:
{"industry":"業界名","employee_size":"〜50人/51〜200人/201〜500人/501〜1000人/1001人以上のいずれか","region":"都道府県名","result":"受注/失注/進行中のいずれか","text_search":"業界等を除いた検索キーワード"}`,
          { provider: "gemini", maxTokens: 200 }
        );
        const m = parsed.match(/\{[\s\S]*\}/);
        if (m) {
          const f = JSON.parse(m[0]);
          if (f.industry) filters.industry = f.industry;
          if (f.employee_size) filters.employee_size = f.employee_size;
          if (f.region) filters.region = f.region;
          if (f.result) filters.result = f.result;
          if (f.text_search) filters.search = f.text_search;
        }
      } catch {}
    }

    const rows = await listProposalFiles(filters);
    res.json({ proposals: rows, total: rows.length, query: q, filters });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// 一覧API
app.get("/api/proposals", async (req, res) => {
  try {
    const rows = await listProposalFiles({ deal_id: req.query.deal_id });
    res.json({ proposals: rows });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

// 削除API
app.delete("/api/proposals/:id", async (req, res) => {
  try {
    await deleteProposalFile(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    sfErrorResponse(res, e);
  }
});

server.listen(PORT, async () => {
  await initDb().catch((e) => console.error("[db] init失敗", e.message));

  // 更新（デプロイ）が終わったことをGoogle Chatに知らせる。
  // Railwayは新しい中身で入れ替えて起動し直すので、この起動＝更新の完了になる。
  setTimeout(() => { notifyDeployDone().catch(() => {}); }, 8000);
  if (CALENDAR_AUTO_JOIN) {
    startScheduler({ publicUrl: PUBLIC_URL });
  } else {
    console.log("[自動入室] カレンダーからの自動入室はオフです（手動でのみ入室します）");
  }
  startSessionMonitor();
  if (CALENDAR_AUTO_JOIN) startAutoJoinCalendarMonitor();
  // 起動から1分後、「無題」や担当なしのまま残っている最近の商談をカレンダーから補完する
  setTimeout(() => { repairRecentMeetings().catch((e) => console.error("[meta補完]", e.message)); }, 60 * 1000);
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

  // インサイト自動分析：平日（月〜金）18:30 JST に全対象をまとめて分析する。
  // 1分ごとに現在のJST時刻をチェックし、その日にまだ実行していなければ発火する。
  const INSIGHT_HOUR = 18, INSIGHT_MIN = 30;
  let lastInsightRunDay = "";
  const checkInsightSchedule = () => {
    const nowJst = new Date(Date.now() + 9 * 3600 * 1000); // UTC→JST
    const day = nowJst.getUTCDay(); // 0=日,6=土（JSTベース）
    const dateStr = nowJst.toISOString().slice(0, 10);
    const isWeekday = day >= 1 && day <= 5;
    const h = nowJst.getUTCHours(), m = nowJst.getUTCMinutes();
    // 18:30〜18:34の間に入ったら発火（分単位の取りこぼしを防ぐ幅を持たせる）
    const inWindow = h === INSIGHT_HOUR && m >= INSIGHT_MIN && m < INSIGHT_MIN + 5;
    if (isWeekday && inWindow && lastInsightRunDay !== dateStr) {
      lastInsightRunDay = dateStr;
      console.log(`[insights-batch] 定時実行（平日18:30 JST）を開始: ${dateStr}`);
      runAllInsights().catch((e) => console.error("[insights-batch] 定時実行エラー:", e.message));
    }
  };
  setInterval(checkInsightSchedule, 60 * 1000); // 毎分チェック

  // コール進捗のお知らせ（11時〜18時の毎正時）。毎分見て、その時刻になったら1回だけ流す。
  setInterval(() => { maybeSendCallReport().catch(() => {}); }, 60 * 1000);
  // Cloudflareに残った古い配信枠と録画を片づける（保存料を増やさないため）
  setInterval(() => { cleanupOldLiveInputs(6).catch(() => {}); }, 60 * 60 * 1000);

  // 届かなかったメールがないかを、30分おきに調べる
  setInterval(async () => {
    try {
      const rows = await listApoMails({ from: jstDate(-2), to: jstDate(0), limit: 300 }).catch(() => []);
      const owners = [...new Set(rows.filter((r) => r.status === "sent")
        .map((r) => String(r.from_owner || "").toLowerCase()).filter(Boolean))];
      for (const o of owners.slice(0, 10)) await checkBounces(o);
    } catch {}
  }, 30 * 60 * 1000);

  // 送れなかった架電の記録を、あとから送り直す
  setInterval(() => { retryCallSync().catch(() => {}); }, 5 * 60 * 1000);

  // 朝の開発メモ（既定6時）
  setInterval(() => { maybeSendDevSummary().catch(() => {}); }, 60 * 1000);
  // 朝の「kinbotが新しくなりました」
  setInterval(() => { maybeSendDeployNews().catch(() => {}); }, 60 * 1000);
  // 夕方のお知らせ（既定18:30）。本人にだけ1対1で送る。
  setInterval(() => { maybeSendEvening().catch(() => {}); }, 60 * 1000);
  // 週のボード（月曜の朝＝記入、金曜の夕方＝振り返り）
  setInterval(() => { maybeRemindWeekly().catch(() => {}); }, 60 * 1000);
  // 自己点検（既定30分おき）。起動から3分たってから始める。
  setTimeout(() => {
    autoState.check.timer = true;
    console.log("[点検] 自動の点検を始めます（5分おきに時刻を見ます）");
    maybeSelfCheck().catch(() => {});
    setInterval(() => { maybeSelfCheck().catch(() => {}); }, 5 * 60 * 1000);
  }, 3 * 60 * 1000);
  // 画面の使いやすさの見直し（既定30分おき）。点検とずらして動かす。
  setTimeout(() => {
    autoState.ui.timer = true;
    console.log("[画面見直し] 自動の見直しを始めます（5分おきに時刻を見ます）");
    maybeUiReview().catch(() => {});
    setInterval(() => { maybeUiReview().catch(() => {}); }, 5 * 60 * 1000);
  }, 6 * 60 * 1000);

  // どこにも拾われなかったエラーも、開発メモに残す
  process.on("unhandledRejection", (e) => {
    const msg = (e && e.message) || String(e);
    console.error("[unhandled]", msg);
    devNote({
      key: errKey("未処理", msg), kind: "error",
      title: `処理が途中で止まりました：${msg.slice(0, 120)}`,
      detail: (e && e.stack ? String(e.stack).slice(0, 1500) : ""), source: "サーバー",
    }).catch(() => {});
  });

  // 未判定の商談を自動で判定するスイープ：起動2分後＋30分ごとに最大5件ずつ。
  // （アップロード由来や過去分など、商談終了時の自動判定を通らなかった商談を拾う）
  let judgeSweepRunning = false;
  const judgeSweep = async () => {
    if (judgeSweepRunning) return;
    judgeSweepRunning = true;
    try {
      const ids = await listUnjudgedMeetings(5);
      if (ids.length) console.log(`[judge-sweep] 未判定の商談 ${ids.length}件を自動判定します`);
      for (const id of ids) {
        try { await runExtraction(id, "anthropic"); }
        catch (e) { console.warn("[judge-sweep] 失敗", id, e.message); }
        await new Promise((r) => setTimeout(r, 1500));
      }
    } finally { judgeSweepRunning = false; }
  };
  setTimeout(judgeSweep, 2 * 60 * 1000);
  setInterval(judgeSweep, 30 * 60 * 1000);

  // 前日リマインドの定時実行：設定した時刻（JST）の0〜4分の間に、その日1回だけ流す
  let lastReminderRunDay = "";
  let reminderRunning = false;
  const checkReminderSchedule = async () => {
    if (reminderRunning) return;
    try {
      const cfg = await getApoMailConfig();
      if (!cfg.autoReminder) return;
      const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
      const dateStr = nowJst.toISOString().slice(0, 10);
      const h = nowJst.getUTCHours(), m = nowJst.getUTCMinutes();
      if (h !== cfg.reminderHour || m >= 5) return;
      if (lastReminderRunDay === dateStr) return;
      lastReminderRunDay = dateStr;
      reminderRunning = true;
      console.log(`[apo-mail] 前日リマインドの定時実行を開始（${cfg.reminderHour}:00 JST）: ${dateStr}`);
      await runReminderSweep({ joinUrl, repNameOf: repDisplayName });
    } catch (e) {
      console.error("[apo-mail] 前日リマインド実行エラー:", e.message);
    } finally { reminderRunning = false; }
  };
  setInterval(() => { checkReminderSchedule().catch(() => {}); }, 60 * 1000);
  // 送る1時間前に、対象を本人へ知らせる
  setInterval(() => { maybeNoticeBeforeReminder().catch(() => {}); }, 60 * 1000);

  // アポの自動スキャン。
  //   ・短い間隔（既定1分）で「差分だけ」を見る → カレンダーに入れてすぐ反映される
  //   ・15分おきに全期間を見直す（差分で取りこぼした分の保険）
  let apoScanRunning = false;
  let lastScanAt = null;      // 差分の起点
  let lastFullScanAt = 0;
  const FULL_SCAN_EVERY_MS = 15 * 60 * 1000;

  const apoScanTick = async () => {
    if (apoScanRunning) return; // 前回が終わっていなければ見送る
    apoScanRunning = true;
    const startedAt = new Date();
    try {
      const now = Date.now();
      const wantFull = !lastScanAt || (now - lastFullScanAt) >= FULL_SCAN_EVERY_MS;
      // 差分は少し前から見る（作成直後の反映ずれと時計のずれを吸収する）
      const updatedMin = wantFull ? null : new Date(new Date(lastScanAt).getTime() - 3 * 60 * 1000);
      const r = await runApoAutoScan({ actor: wantFull ? "auto-scan" : "auto-scan-diff", updatedMin });
      if (r && r.skipped) {
        if (r.reason && !/OFF/.test(r.reason)) console.warn("[apo-scan] 実行できませんでした:", r.reason);
        return; // 設定不足のときは起点を進めない
      }
      lastScanAt = startedAt;
      if (wantFull) lastFullScanAt = now;
    } catch (e) {
      console.error("[apo-scan] エラー:", e.message);
    } finally { apoScanRunning = false; }
  };

  // 予定が作られた瞬間の通知（プッシュ）から呼べるようにしておく
  globalThis.__kinbotApoScanTick = apoScanTick;

  // 間隔は設定で変えられる（既定60秒）。反映が遅いと感じたら短くする。
  let scanTimer = null;
  const scheduleApoScan = async () => {
    let sec = 60;
    try {
      const st = await getSettings();
      const v = parseInt(st && st.apoScanIntervalSec, 10);
      if (Number.isFinite(v)) sec = Math.min(900, Math.max(15, v));
    } catch {}
    if (scanTimer) clearInterval(scanTimer);
    scanTimer = setInterval(() => { apoScanTick().catch(() => {}); }, sec * 1000);
    console.log(`[apo-scan] 自動スキャンの間隔: ${sec}秒（15分ごとに全期間を再確認）`);
  };
  // 資料を閉じた合図が届かなかった閲覧を拾う（タブごと落ちた場合など）
  setInterval(() => {
    sweepStaleViews(Number(process.env.DOC_IDLE_SECONDS || 90))
      .then((n) => { if (n) console.log(`[doc] 終了扱いにした閲覧: ${n}件`); })
      .catch(() => {});
  }, 3 * 60 * 1000);

  setTimeout(() => { apoScanTick().catch(() => {}); }, 60 * 1000);
  scheduleApoScan();
  // カレンダーの変更を即時に受け取る監視を用意し、1時間ごとに期限を見て付け直す
  setTimeout(() => {
    ensureCalendarWatches().then((r) => {
      if (r && r.skipped) console.log(`[apo-push] 即時通知は使いません（${r.reason}）`);
      else if (r) console.log(`[apo-push] 即時通知の監視 ${r.watched}件（新しく登録 ${r.made.length}件）`);
    }).catch((e) => console.warn("[apo-push]", e.message));
  }, 20 * 1000);
  setInterval(() => { ensureCalendarWatches().catch(() => {}); }, 60 * 60 * 1000);
  // 設定を変えたときに間隔を作り直す（5分ごとに設定を見る）
  setInterval(() => { scheduleApoScan().catch(() => {}); }, 5 * 60 * 1000);
  console.log(`\n  kinbot (Bot方式) → http://localhost:${PORT}`);
  console.log(`  ビルド: ${BUILD_TAG}`);
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

// 登録したZoom URLの予定がカレンダーにあり、開始時刻になったら自動入室する（Zoomアプリ不要）。
// 60秒ごとに、有効な登録URLの持ち主のカレンダーを見て入室する。
//  - 通常：予定のZoom URLが登録URLと一致したら入室
//  - calendar_any=true：URL照合なし。ゲストのいる予定の開始時刻に、その部屋へ入室（予定ごとに1回）
const joinedEventKeys = new Set(); // 「行ID|予定ID」で予定ごとの二重入室を防ぐ（プロセス内）
setInterval(() => joinedEventKeys.clear(), 6 * 60 * 60 * 1000); // 6時間ごとに掃除
function startAutoJoinCalendarMonitor() {
  const WINDOW_BEFORE = 2 * 60 * 1000; // 予定開始の2分前から
  const WINDOW_AFTER = 4 * 60 * 1000;  // 4分後まで
  const DEDUP_MS = 30 * 60 * 1000;     // URL一致モードの二重入室抑止（30分）
  const inWindow = (startMs, now) => now >= startMs - WINDOW_BEFORE && now <= startMs + WINDOW_AFTER;
  const tick = async () => {
    if (!PUBLIC_URL) return;
    let rows = [];
    try { rows = await listAllAutoJoinEnabled(); } catch { return; }
    if (!rows.length) return;
    const now = Date.now();
    // 持ち主ごとにまとめて、その人のカレンダーを1回だけ取得
    const byOwner = new Map();
    for (const r of rows) {
      if (!byOwner.has(r.owner)) byOwner.set(r.owner, []);
      byOwner.get(r.owner).push(r);
    }
    for (const [owner, ownerRows] of byOwner) {
      let evs = [];
      try {
        const timeMin = new Date(now - 30 * 60 * 1000).toISOString();
        const timeMax = new Date(now + 30 * 60 * 1000).toISOString();
        evs = await listCalendarEvents(owner, "primary", { timeMin, timeMax });
      } catch (e) {
        console.warn(`[auto-join(cal)] ${owner} のカレンダー取得に失敗（Google未連携の可能性）: ${e.message}`);
        continue;
      }
      const timed = (evs || []).filter((e) => !e.allDay && e.start);
      for (const r of ownerRows) {
        if (r.calendar_any) {
          // 連携カレンダーの予定にZoom等のURLが入っていれば、そのURLへ入室（予定ごとに1回）
          for (const e of timed) {
            if (!inWindow(new Date(e.start).getTime(), now)) continue;
            const evUrl = (e.url && /zoom|meet\.google|teams\.microsoft/.test(e.url)) ? e.url : "";
            // 予定内にURLがあればゲスト有無に関わらず入室。URLが無い予定は、ゲストがいる時だけ登録部屋へ。
            if (!evUrl && (e.guests || 0) < 1) continue;
            const joinUrl = evUrl || r.url;
            if (!joinUrl) continue;
            const key = `${r.id}|${e.id}`;
            if (joinedEventKeys.has(key)) continue;
            joinedEventKeys.add(key);
            try {
              const meta = await autoJoinMeta(owner, e, r); // 商談名=予定タイトル、担当=カレンダー主
              await startBotSession(owner, joinUrl, { title: meta.title, repName: meta.repName });
              console.log(`[auto-join(cal)] 予定「${e.title || ""}」の時間に自動入室 → ${owner} / 担当:${meta.repName} / URL:${joinUrl.slice(0, 40)}`);
            } catch (err) {
              console.error("[auto-join(cal)] 入室失敗", err.message);
            }
          }
        } else {
          // 通常：予定のZoom URLが登録URLと同じミーティングIDのとき入室
          if (r.last_joined_at && now - new Date(r.last_joined_at).getTime() <= DEDUP_MS) continue;
          const match = timed.find((e) => e.url && zoomMeetingId(e.url) === r.meeting_id && inWindow(new Date(e.start).getTime(), now));
          if (!match) continue;
          try {
            const meta = await autoJoinMeta(owner, match, r);
            await startBotSession(owner, r.url, { title: meta.title, repName: meta.repName });
            await touchAutoJoin(r.id);
            console.log(`[auto-join(cal)] 予定開始で自動入室: ${r.meeting_id} → ${owner} / 担当:${meta.repName}`);
          } catch (err) {
            console.error("[auto-join(cal)] 入室失敗", err.message);
          }
        }
      }
    }
  };
  setInterval(() => { tick().catch((e) => console.error("[auto-join(cal)]", e.message)); }, 60 * 1000);
}
