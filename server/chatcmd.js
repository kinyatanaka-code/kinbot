// ───────────────────────────────────────────────────────────
// chatcmd.js — Google Chat から kinbot を動かす
//
// Chatで「@kinbot アポ」のように話しかけると、ここが受け取って返事をする。
// Googleは、送るときに本物である証明（JWT）を付けてくれるので、それを確かめる。
//
// 使えることば（ゆらぎを吸収する）
//   ヘルプ            … 使い方
//   アポ / 今日のアポ  … 今日の自分のアポ
//   商談 / 予定        … 今日の自分の商談
//   明日のアポ         … 明日のぶん
//   スキャン           … カレンダーを今すぐ見に行く
//   重複               … カレンダーの重複した予定を数える
//   立ち上げ           … Salesforceを立ち上げられていないもの
//   状態 / バージョン  … いま動いているkinbot
// ───────────────────────────────────────────────────────────

import { createVerify } from "node:crypto";

import { createPublicKey } from "node:crypto";

const CHAT_ISSUER = "chat@system.gserviceaccount.com";
// Googleが証明を出す元は2通りある。どちらで来ても受け取れるようにする。
//   ・chat@system.gserviceaccount.com が出したもの → サービスアカウントの証明書で確かめる
//   ・https://accounts.google.com が出したもの     → Googleの公開鍵（JWK）で確かめる
const SA_CERT_URL = "https://www.googleapis.com/service_accounts/v1/metadata/x509/" + CHAT_ISSUER;
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

// 送り主として認めるもの。
//   ・chat@system.gserviceaccount.com … Chatが直接送るとき
//   ・service-<番号>@gcp-sa-gsuiteaddons.iam.gserviceaccount.com
//       … Google Workspaceアドオンとして登録したChatアプリが送るとき
//   環境変数 GOOGLE_CHAT_SENDER で、1つに絞ることもできる。
const ADDON_SENDER_RE = /^service-\d+@gcp-sa-gsuiteaddons\.iam\.gserviceaccount\.com$/;
export function isAllowedSender(email) {
  const e = String(email || "").trim();
  if (!e) return false;
  const pinned = String(process.env.GOOGLE_CHAT_SENDER || "").trim();
  if (pinned) return e === pinned;
  return e === CHAT_ISSUER || ADDON_SENDER_RE.test(e);
}

// Googleの公開鍵。1時間ほど覚えておく（毎回取りに行かないため）。
const _certCache = new Map();
async function fetchJson(url) {
  const hit = _certCache.get(url);
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.data;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`公開鍵を取れませんでした（${r.status}）`);
  const data = await r.json();
  _certCache.set(url, { at: Date.now(), data });
  return data;
}

// kid に合う公開鍵を取り出す（証明書の形でも、JWKの形でも扱える）
async function publicKeyFor(iss, kid) {
  const issuer = String(iss || "");
  // サービスアカウントが出した証明は、そのアカウントの証明書で確かめる
  if (issuer.includes("@") && issuer.endsWith("gserviceaccount.com")) {
    const url = "https://www.googleapis.com/service_accounts/v1/metadata/x509/" + encodeURIComponent(issuer);
    const certs = await fetchJson(url);
    return certs[kid] || null;
  }
  const jwks = await fetchJson(GOOGLE_JWKS_URL);
  const jwk = (jwks.keys || []).find((k) => k.kid === kid);
  if (!jwk) return null;
  return createPublicKey({ key: jwk, format: "jwk" });
}

function b64urlToBuf(s) {
  return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function decodeJwt(token) {
  const [h, p] = String(token).split(".");
  if (!h || !p) return null;
  try {
    return {
      header: JSON.parse(b64urlToBuf(h).toString("utf8")),
      payload: JSON.parse(b64urlToBuf(p).toString("utf8")),
    };
  } catch { return null; }
}

// Googleからの本物の通知かを確かめる。
//   1. Googleの公開鍵で、署名そのものを確かめる（通信が1回で済む・確実）
//   2. だめなら、Googleに問い合わせて確かめる（予備）
export async function verifyChatRequest(req, { audience = "" } = {}) {
  const auth = String(req.headers.authorization || "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, reason: "証明（Authorizationヘッダ）が付いていません" };
  const token = m[1].trim();
  const parts = token.split(".");
  const dec = decodeJwt(token);
  if (!dec || parts.length !== 3) return { ok: false, reason: "証明の形が違います" };

  const { header, payload } = dec;
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now - 60) return { ok: false, reason: "証明の期限が切れています" };
  // 送り主の確認。Chat本体からでも、Workspaceアドオン経由でも受け取る。
  const email = String(payload.email || "");
  const iss = String(payload.iss || "");
  const sender = isAllowedSender(email) ? email : (isAllowedSender(iss) ? iss : "");
  if (!sender) return { ok: false, reason: `送り主が違います（${email || iss || "不明"}）` };
  // 証明の出どころは、Google本体か、その送り主自身のどちらか
  if (!GOOGLE_ISSUERS.includes(iss) && iss !== sender && iss !== email) {
    return { ok: false, reason: `証明の出どころが違います（${iss || "不明"}）` };
  }
  if (audience && String(payload.aud || "") !== String(audience)) {
    return { ok: false, reason: `宛先が合いません（${payload.aud || "なし"}）` };
  }

  // 1. 署名を自分で確かめる
  try {
    const key = await publicKeyFor(iss, header.kid);
    if (key) {
      const v = createVerify("RSA-SHA256");
      v.update(parts[0] + "." + parts[1]);
      if (v.verify(key, b64urlToBuf(parts[2]))) return { ok: true, aud: payload.aud, sender, by: "署名" };
      return { ok: false, reason: "署名が合いません" };
    }
  } catch (e) {
    // 公開鍵が取れないときは、下の方法に回す
    console.warn("[chat-cmd] 公開鍵で確かめられませんでした:", e.message);
  }

  // 2. Googleに問い合わせる
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(token));
    if (!r.ok) return { ok: false, reason: `証明を確かめられませんでした（${r.status}）` };
    const d = await r.json();
    if (!isAllowedSender(d.email)) return { ok: false, reason: `送り主が違います（${d.email || "不明"}）` };
    if (audience && String(d.aud || "") !== String(audience)) return { ok: false, reason: "宛先が合いません" };
    return { ok: true, aud: d.aud, sender: d.email, by: "問い合わせ" };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// 届いたイベントを読む。
// Googleには2つの形があるので、どちらでも読めるようにする。
//   ・これまでの形     … { type, user, message }
//   ・アドオンの形     … { chat: { messagePayload: { message, space }, user, type } }
export function readEvent(body) {
  const b = body || {};
  const addon = !!b.chat;
  const c = b.chat || {};
  const payload = c.messagePayload || c.addedToSpacePayload || {};
  const msg = payload.message || b.message || {};
  const user = c.user || b.user || {};
  const type = c.type || b.type ||
    (c.messagePayload ? "MESSAGE" : (c.addedToSpacePayload ? "ADDED_TO_SPACE" : ""));
  return {
    addon,
    type,
    email: String(user.email || "").toLowerCase(),
    text: cleanText(msg),
    space: (payload.space && payload.space.name) || (b.space && b.space.name) || "",
  };
}

// 話しかけられた文から、アプリ名（@kinbot）を取り除く
export function cleanText(msgOrEvent) {
  const m = msgOrEvent?.message || msgOrEvent || {};
  let t = String(m.argumentText || m.text || "").trim();
  t = t.replace(/^@?kinbot\s*/i, "").trim();
  return t;
}

// 返事の形。アドオンの形で来たら、その形で返す。
export function replyBody(text, addon) {
  const t = String(text || "").slice(0, 3800);
  if (!addon) return { text: t };
  return {
    hostAppDataAction: {
      chatDataAction: { createMessageAction: { message: { text: t } } },
    },
  };
}

// どの操作かを決める。ひらがな・カタカナ・英語のゆらぎを吸収する。
export function parseCommand(text) {
  const t = String(text || "").trim().toLowerCase().replace(/[\s　]+/g, "");
  if (!t || /^(ヘルプ|help|使い方|\?|？)$/.test(t)) return { kind: "help" };

  const tomorrow = /明日|あした|翌日/.test(t);
  const day = tomorrow ? 1 : 0;

  if (/重複|だぶ|ダブり/.test(t)) return { kind: "dupes" };
  if (/スキャン|取り込|よみこみ|読み込/.test(t)) return { kind: "scan" };
  if (/立ち上げ|立上げ|salesforce|sf/.test(t)) return { kind: "launch" };
  if (/状態|version|バージョン|更新/.test(t)) return { kind: "status" };
  if (/アポ/.test(t)) return { kind: "apo", day };
  if (/商談|予定|今日|きょう/.test(t)) return { kind: "meetings", day };
  return { kind: "unknown", text };
}

export function helpText() {
  return [
    "*kinbotにできること*（このまま送ってください）",
    "・`アポ`　… 今日の自分のアポ（自分で取ったぶんも出ます）",
    "・`明日のアポ`　… 明日のぶん",
    "・`商談`　… 今日の自分の商談",
    "・`スキャン`　… カレンダーを今すぐ見に行く",
    "・`重複`　… 同じ商談の予定が2つ以上ないか数える",
    "・`立ち上げ`　… Salesforceを立ち上げられていないもの",
    "・`状態`　… いま動いているkinbot",
  ].join("\n");
}

// 日付（JST）を「YYYY-MM-DD」で返す
export function jstDate(offsetDays = 0) {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

export function jstTime(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "時刻未定";
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
}
