// ───────────────────────────────────────────────────────────
// chat.js — Google Chat のスペースへ通知する
//
// Google Chat の「スペース」→「アプリと統合」→「Webhook」で作ったURLを
// 設定画面に貼ってもらう方式。鍵の管理が不要で、権限も申請しなくて済む。
//
// 送信は投げっぱなしにする。通知が失敗しても、割り振りやメール作成は止めない。
// ───────────────────────────────────────────────────────────
import { getSettings } from "./db.js";

let lastError = "";
let sentCount = 0;

export function chatInfo() {
  return { lastError, sentCount };
}

// 設定に入っているURLを取る。環境変数があればそちらを優先。
export async function chatWebhookUrl() {
  const env = String(process.env.GOOGLE_CHAT_WEBHOOK_URL || "").trim();
  if (env) return env;
  try {
    const s = await getSettings();
    return String((s && s.chatWebhookUrl) || "").trim();
  } catch { return ""; }
}

function looksLikeChatUrl(u) {
  return /^https:\/\/chat\.googleapis\.com\/v1\/spaces\/[^/]+\/messages/.test(String(u || ""));
}

// 文字だけの通知を送る。Google Chat は *太字* が使える。
export async function notifyChat(text, { url = "" } = {}) {
  const t = String(text || "").trim();
  if (!t) return { ok: false, skipped: true, reason: "本文が空です" };
  const hook = url || (await chatWebhookUrl());
  if (!hook) return { ok: false, skipped: true, reason: "通知先が未設定です" };
  if (!looksLikeChatUrl(hook)) {
    lastError = "URLがGoogle ChatのWebhookの形式ではありません";
    return { ok: false, reason: lastError };
  }
  try {
    const res = await fetch(hook, {
      method: "POST",
      headers: { "content-type": "application/json; charset=UTF-8" },
      body: JSON.stringify({ text: t.slice(0, 3800) }),
    });
    if (!res.ok) {
      lastError = `Chat通知 ${res.status}: ${(await res.text()).slice(0, 200)}`;
      console.warn("[chat]", lastError);
      return { ok: false, reason: lastError };
    }
    sentCount++;
    lastError = "";
    return { ok: true };
  } catch (e) {
    lastError = e.message;
    console.warn("[chat] 送信に失敗", e.message);
    return { ok: false, reason: e.message };
  }
}

// 「8/10(月) 17:00」の形にする
export function jstLabel(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "日時未定";
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  const wd = ["日", "月", "火", "水", "木", "金", "土"][j.getUTCDay()];
  const p = (n) => String(n).padStart(2, "0");
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()}(${wd}) ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
}

// 確定メールがどうなったかを1行にする
function mailLine(mail, clientEmail) {
  if (!mail) {
    return clientEmail
      ? "確定メール：作成していません"
      : "確定メール：*お客様の宛先が未登録のため作れません*";
  }
  if (mail.ok) {
    const to = mail.to ? `（宛先 ${mail.to}）` : "";
    return mail.draft
      ? `確定メール：*下書きを作りました*${to}　担当者のGmailで内容を確認して送信してください`
      : `確定メール：送信しました${to}`;
  }
  if (mail.skipped) return `確定メール：作成していません（${mail.reason || "自動作成がOFF"}）`;
  return `確定メール：*作れませんでした*（${String(mail.reason || "").slice(0, 120)}）`;
}

// アポを割り振ったときの通知。
// 担当が決まると下書きも自動でできるため、メールの状況も同じ1通にまとめる。
export async function notifyAssigned({
  title, start, repName, setter, business, reason, url, auto, mail, clientEmail,
}) {
  try { const st = await getSettings(); if (st && st.chatNotifyAssign === false) return { ok: false, skipped: true }; } catch {}
  const lines = [
    `*アポを割り振りました*${auto ? "（自動）" : ""}`,
    `${jstLabel(start)}　${title || "(予定名なし)"}`,
    `担当：${repName || "-"}${business ? `　事業：${business}` : ""}`,
    setter ? `アポ獲得：${setter}` : "",
    mailLine(mail, clientEmail),
    reason ? `理由：${reason}` : "",
    url ? `会議室：${url}` : "",
  ].filter(Boolean);
  return notifyChat(lines.join("\n"));
}

// 確定メールの下書きを作ったときの通知
// 割り振りとは別に、あとからメールだけ作り直したときの通知
export async function notifyMailDraft({ title, start, repName, to, draft, subject }) {
  try { const st = await getSettings(); if (st && st.chatNotifyMail === false) return { ok: false, skipped: true }; } catch {}
  const lines = [
    draft ? "*アポ確定メールの下書きを作りました*" : "*アポ確定メールを送信しました*",
    `${jstLabel(start)}　${title || "(予定名なし)"}`,
    `担当：${repName || "-"}　宛先：${to || "-"}`,
    subject ? `件名：${subject}` : "",
    draft ? "担当者のGmailの下書きに入っています。内容を確認して送信してください。" : "",
  ].filter(Boolean);
  return notifyChat(lines.join("\n"));
}
