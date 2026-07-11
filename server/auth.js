// server/auth.js
// メール＋パスワードのアカウント登録（DB保存・scryptでハッシュ化）。
// 後方互換: 旧 USERS / APP_PASSWORD も併用可。
// 登録制限（任意）:
//   SIGNUP_CODE          設定すると登録に合言葉が必要
//   ALLOWED_EMAIL_DOMAIN 設定するとそのドメインのメールのみ登録可（例: example.co.jp）
//   ADMIN_EMAILS         全員のデータを見られる管理者メール（カンマ区切り）
import crypto from "node:crypto";
import { dbGetUser, dbCreateUser, dbEnabled } from "./db.js";

const COOKIE_NAME = "kinbot_session";
const SECRET =
  process.env.APP_SECRET || process.env.APP_PASSWORD || "kinbot-dev-secret-change-me";

// 旧 USERS（"u:p,..."）後方互換
function parseLegacyUsers() {
  const raw = process.env.USERS || "";
  const map = new Map();
  if (raw.trim()) {
    for (const pair of raw.split(",")) {
      const i = pair.indexOf(":");
      if (i === -1) continue;
      const u = pair.slice(0, i).trim();
      const p = pair.slice(i + 1).trim();
      if (u && p) map.set(u, p);
    }
  } else if (process.env.APP_PASSWORD) {
    map.set("admin", process.env.APP_PASSWORD);
  }
  return map;
}
const LEGACY = parseLegacyUsers();
const ADMINS = new Set(
  [
    ...(process.env.ADMIN_EMAILS || "").split(","),
    ...(process.env.ADMIN_USERS || "").split(","),
  ]
    .map((s) => s.trim())
    .filter(Boolean)
);

export function authEnabled() {
  return dbEnabled() || LEGACY.size > 0;
}
export function isAdmin(id) {
  return ADMINS.has(id);
}

// --- パスワードハッシュ（scrypt） ---
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const h = crypto.scryptSync(String(pw), salt, 64).toString("hex");
  return `${salt}:${h}`;
}
export function verifyPassword(pw, stored) {
  if (!stored || stored.indexOf(":") === -1) return false;
  const [salt, h] = stored.split(":");
  const calc = crypto.scryptSync(String(pw), salt, 64).toString("hex");
  const a = Buffer.from(h);
  const b = Buffer.from(calc);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- 署名Cookie（中身は識別子=メール） ---
const b64u = (s) => Buffer.from(s, "utf8").toString("base64url");
const unb64u = (s) => Buffer.from(s, "base64url").toString("utf8");
function sign(data) {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}
export function makeToken(id) {
  const body = b64u(id);
  return `${body}.${sign(body)}`;
}
export function verifyToken(token) {
  if (!token || token.indexOf(".") === -1) return null;
  const [body, sig] = token.split(".");
  const expect = sign(body);
  if (!sig || sig.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  return unb64u(body);
}
function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}
export function getUser(req) {
  const id = verifyToken(readCookie(req, COOKIE_NAME));
  if (!id) return null;
  return { username: id, admin: isAdmin(id) };
}
export function setSessionCookie(res, id) {
  const token = makeToken(id);
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax; Secure`
  );
}
export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure`);
}

// ===== 代理ログイン（なりすまし） =====
// 田中欽也（このアカウントだけ）が、他のメンバーとしてログインできる特別機能。
// セキュリティ上のリスクが大きいため、以下の制約を必ず守る。
//  - 代理ログインできるのは kinya.tanaka@neo-career.co.jp だけ（ハードコード）
//  - 元アカウントは kbt_imp Cookie に別途保持し、いつでも元に戻せる
//  - すべての操作はサーバー側で監査ログに記録する
const IMPERSONATOR_EMAILS = new Set(["kinya.tanaka@neo-career.co.jp"]);
const IMP_COOKIE = "kbt_imp";
export function canImpersonate(email) {
  return IMPERSONATOR_EMAILS.has(String(email || "").trim().toLowerCase());
}
export function setImpersonationCookies(res, originalUser, targetUser) {
  // メインのセッションを対象ユーザーで置き換え、元ユーザーを保持
  const impToken = makeToken(originalUser);
  const targetToken = makeToken(targetUser);
  res.setHeader("Set-Cookie", [
    `${COOKIE_NAME}=${encodeURIComponent(targetToken)}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24}; SameSite=Lax; Secure`,
    `${IMP_COOKIE}=${encodeURIComponent(impToken)}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24}; SameSite=Lax; Secure`,
  ]);
}
export function endImpersonation(res, originalUser) {
  const originalToken = makeToken(originalUser);
  res.setHeader("Set-Cookie", [
    `${COOKIE_NAME}=${encodeURIComponent(originalToken)}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax; Secure`,
    `${IMP_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax; Secure`,
  ]);
}
export function getImpersonator(req) {
  const raw = readCookie(req, IMP_COOKIE);
  if (!raw) return null;
  return verifyToken(raw); // 元ユーザーのemail
}

// --- 登録・ログイン ---
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function registerUser({ email, password, displayName, code }) {
  email = String(email || "").trim().toLowerCase();
  if (!signupGateOk(code)) return { error: "登録コードが正しくありません" };
  if (!EMAIL_RE.test(email)) return { error: "メールアドレスの形式が正しくありません" };
  if (!password || String(password).length < 8) return { error: "パスワードは8文字以上にしてください" };
  const domain = process.env.ALLOWED_EMAIL_DOMAIN || "";
  if (domain && !email.endsWith("@" + domain.replace(/^@/, ""))) {
    return { error: `登録できるのは @${domain.replace(/^@/, "")} のメールのみです` };
  }
  if (!dbEnabled()) return { error: "アカウント保存にはDB（DATABASE_URL）が必要です" };
  const existing = await dbGetUser(email);
  if (existing) return { error: "このメールアドレスは既に登録されています" };
  await dbCreateUser(email, displayName || "", hashPassword(password));
  return { ok: true, email, admin: isAdmin(email) };
}

export async function loginUser({ email, password }) {
  const id = String(email || "").trim().toLowerCase();
  // 1) DBユーザー
  if (dbEnabled()) {
    const u = await dbGetUser(id);
    if (u && verifyPassword(password, u.pass_hash)) {
      return { ok: true, id, name: u.name || "", admin: isAdmin(id) };
    }
  }
  // 2) 旧 USERS / APP_PASSWORD（メール欄にユーザー名を入力）
  const raw = String(email || "").trim();
  const legacyPw = LEGACY.get(raw);
  if (legacyPw && legacyPw === password) {
    return { ok: true, id: raw, name: raw, admin: isAdmin(raw) };
  }
  return { error: "メールアドレスまたはパスワードが違います" };
}

export function signupGateOk(code) {
  const need = process.env.SIGNUP_CODE || "";
  return !need || String(code || "") === need;
}
export async function getDisplayName(id) {
  if (dbEnabled()) {
    const u = await dbGetUser(String(id).toLowerCase());
    if (u && u.name) return u.name;
  }
  return id;
}
