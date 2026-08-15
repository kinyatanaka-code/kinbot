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

const CHAT_ISSUER = "chat@system.gserviceaccount.com";
const CERT_URL = "https://www.googleapis.com/service_accounts/v1/metadata/x509/" + CHAT_ISSUER;

// Googleの公開鍵。1時間ほど覚えておく（毎回取りに行かないため）。
let _certs = { at: 0, keys: null };
async function chatCerts() {
  if (_certs.keys && Date.now() - _certs.at < 60 * 60 * 1000) return _certs.keys;
  const r = await fetch(CERT_URL);
  if (!r.ok) throw new Error(`公開鍵を取れませんでした（${r.status}）`);
  const keys = await r.json();
  _certs = { at: Date.now(), keys };
  return keys;
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
  const from = String(payload.iss || payload.email || "");
  if (from !== CHAT_ISSUER) return { ok: false, reason: `送り主が違います（${from || "不明"}）` };
  if (audience && String(payload.aud || "") !== String(audience)) {
    return { ok: false, reason: `宛先が合いません（${payload.aud || "なし"}）` };
  }

  // 1. 署名を自分で確かめる
  try {
    const keys = await chatCerts();
    const cert = keys[header.kid];
    if (cert) {
      const v = createVerify("RSA-SHA256");
      v.update(parts[0] + "." + parts[1]);
      if (v.verify(cert, b64urlToBuf(parts[2]))) return { ok: true, aud: payload.aud, by: "署名" };
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
    if (String(d.email || "") !== CHAT_ISSUER) return { ok: false, reason: "送り主がGoogle Chatではありません" };
    if (audience && String(d.aud || "") !== String(audience)) return { ok: false, reason: "宛先が合いません" };
    return { ok: true, aud: d.aud, by: "問い合わせ" };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// 話しかけられた文から、アプリ名（@kinbot）を取り除く
export function cleanText(event) {
  let t = String(event?.message?.argumentText || event?.message?.text || "").trim();
  t = t.replace(/^@?kinbot\s*/i, "").trim();
  return t;
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
