// ───────────────────────────────────────────────────────────
// chat.js — Google Chat のスペースへ通知する
//
// Google Chat の「スペース」→「アプリと統合」→「Webhook」で作ったURLを
// 設定画面に貼ってもらう方式。鍵の管理が不要で、権限も申請しなくて済む。
//
// 送信は投げっぱなしにする。通知が失敗しても、割り振りやメール作成は止めない。
// ───────────────────────────────────────────────────────────
import { getSettings, listChatTargets, markChatTarget, addChatTarget } from "./db.js";
import { chatAppConfigured, postToSpace, normalizeSpace, chatAppInfo } from "./chatapp.js";

let lastError = "";
let sentCount = 0;

export function chatInfo() {
  return { lastError, sentCount, app: chatAppInfo() };
}

// 投稿先のスペース（Chatアプリで送るときに使う）
export async function chatSpace() {
  const env = String(process.env.GOOGLE_CHAT_SPACE || "").trim();
  if (env) return normalizeSpace(env);
  try {
    const s = await getSettings();
    return normalizeSpace((s && s.chatSpaceId) || "");
  } catch { return ""; }
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
// 1つの宛先へ送る。スペースが指定されていればChatアプリ、なければWebhook。
async function sendTo({ webhook_url, space_id }, text) {
  if (space_id && chatAppConfigured()) {
    await postToSpace(space_id, text);
    return "app";
  }
  if (!webhook_url) throw new Error("通知先が設定されていません");
  if (!looksLikeChatUrl(webhook_url)) throw new Error("URLがGoogle ChatのWebhookの形式ではありません");
  const res = await fetch(webhook_url, {
    method: "POST",
    headers: { "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ text: String(text).slice(0, 3800) }),
  });
  if (!res.ok) throw new Error(`Chat通知 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return "webhook";
}

// 登録されている通知先すべてに送る。
// kind を渡すと、その種類がONになっている宛先だけに送る。
export async function notifyAll(text, kind = "") {
  const t = String(text || "").trim();
  if (!t) return { ok: false, skipped: true, reason: "本文が空です" };

  const targets = await listChatTargets({ onlyActive: true }).catch(() => []);
  if (!targets.length) {
    // まだ通知先を登録していない環境では、これまでどおり1件の設定で送る
    return notifyChat(t);
  }

  const col = { assign: "on_assign", mail: "on_mail", doc: "on_doc", launch: "on_launch" }[kind];
  const list = col ? targets.filter((x) => x[col]) : targets;
  if (!list.length) return { ok: false, skipped: true, reason: "この種類の通知はどこもONになっていません" };

  let sent = 0;
  for (const tg of list) {
    try {
      await sendTo(tg, t);
      sent++;
      markChatTarget(tg.id, { ok: true }).catch(() => {});
    } catch (e) {
      lastError = `${tg.name}：${e.message}${e.hint ? "／" + e.hint : ""}`;
      console.warn("[chat] 送信に失敗", tg.name, e.message);
      markChatTarget(tg.id, { ok: false, error: e.message }).catch(() => {});
    }
  }
  sentCount += sent;
  return { ok: sent > 0, sent, total: list.length };
}

export async function notifyChat(text, { url = "", space = "" } = {}) {
  const t = String(text || "").trim();
  if (!t) return { ok: false, skipped: true, reason: "本文が空です" };

  // Chatアプリ（kinbot名義）で送れるならそちらを使う。
  // Webhookだと送信者が「Webhook Bot」になってしまうため。
  if (!url && chatAppConfigured()) {
    const sp = space || (await chatSpace());
    if (sp) {
      try {
        await postToSpace(sp, t);
        sentCount++;
        lastError = "";
        return { ok: true, via: "app" };
      } catch (e) {
        lastError = e.message + (e.hint ? `／${e.hint}` : "");
        console.warn("[chat] アプリでの投稿に失敗、Webhookに切り替えます", e.message);
        // ここでは止めず、Webhookがあればそちらで送る
      }
    }
  }

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
    return { ok: true, via: "webhook" };
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

// 確定メールがどうなったかを1行にする。
// 長い説明はChatだと読みづらいので、要点だけにして詳しくは画面で見てもらう。
function mailLine(mail, clientEmail) {
  if (!mail) {
    // 要対応のものだけ目立たせる
    return clientEmail ? "✉️ メール未作成" : "⚠️ *宛先が未登録*　メールを出せません";
  }
  if (mail.ok) {
    return mail.draft
      ? `📝 下書き済　${mail.to || "-"}`
      : `✉️ 送信済　${mail.to || "-"}`;
  }
  if (mail.skipped) return "✉️ メール未作成（自動作成OFF）";
  return `⚠️ *メールを作れません*　${shortReason(mail.reason)}`;
}

// Salesforceの立ち上げがどうなったかを1行にする
function launchLine(launch) {
  if (!launch) return "";
  if (launch.ok && !launch.dryRun) return "🚀 SF立ち上げ済";
  if (launch.ok && launch.dryRun) return "🔹 SF立ち上げできます（自動実行はOFF）";
  return `⚠️ *SF立ち上げできません*　${String(launch.reasonText || "").slice(0, 90)}`;
}

// エラーの理由を、短い一言にまとめる
function shortReason(reason) {
  const r = String(reason || "");
  if (/gmail|メール送信の権限|scope|権限がありません/i.test(r)) return "Gmailの権限不足（本人がGoogle連携をやり直し）";
  if (/宛先|to は|アドレス/i.test(r)) return "宛先が不明";
  if (/token|認証|no_token/i.test(r)) return "Google連携が切れています";
  return r.replace(/\s+/g, " ").slice(0, 60);
}



// アポを割り振ったときの通知。
// 担当が決まると下書きも自動でできるため、メールの状況も同じ1通にまとめる。
export async function notifyAssigned({
  title, start, repName, setter, business, reason, url, auto, mail, clientEmail, counts, goal, launch,
}) {
  try { const st = await getSettings(); if (st && st.chatNotifyAssign === false) return { ok: false, skipped: true }; } catch {}
  // スマホで一目で分かることを優先し、4〜5行に収める。
  // 会議室のURLは長く折り返すので載せない（kinbotの画面から開ける）。
  const lines = [
    reason === "自分で獲得したアポ"
      ? `✅ *自分で獲得したアポ*　${jstLabel(start)}`
      : `✅ *アポ割り振り*${auto ? "" : "（手動）"}　${jstLabel(start)}`,
    `　${title || "(予定名なし)"}`,
    `👤 ${[repName || "-",
      setter && String(setter).replace(/[\s　]/g, "") !== String(repName || "").replace(/[\s　]/g, "")
        ? `獲得 ${setter}` : ""].filter(Boolean).join(" ・ ")}`,
    mailLine(mail, clientEmail),
    launchLine(launch),
    counts
      ? `📊 本日 ${counts.today} / 今週 ${counts.week} / 今月 ${counts.month}` +
        (goal ? `（目標 ${goal}・あと ${Math.max(0, goal - counts.month)}）` : "")
      : "",
  ].filter(Boolean);
  return notifyAll(lines.join("\n"), "assign");
}

// 確定メールの下書きを作ったときの通知
// 割り振りとは別に、あとからメールだけ作り直したときの通知
export async function notifyMailDraft({ title, start, repName, to, draft, subject }) {
  try { const st = await getSettings(); if (st && st.chatNotifyMail === false) return { ok: false, skipped: true }; } catch {}
  const lines = [
    `${draft ? "📝" : "✉️"} *確定メール${draft ? "の下書き" : "を送信"}*　${jstLabel(start)}`,
    `　${title || "(予定名なし)"}`,
    `👤 ${repName || "-"} ・ 宛先 ${to || "-"}`,
  ];
  return notifyAll(lines.join("\n"), "mail");
}
