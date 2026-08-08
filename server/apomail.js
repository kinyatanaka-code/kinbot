// ───────────────────────────────────────────────────────────
// アポメール自動送付
//   ・確定メール ：担当セールスが割り当てられた直後に送る
//   ・リマインド ：商談前日の朝に送る
// いずれも「担当セールス本人のGmailアカウント」から送信する（gmailSend）。
// scope は gmail.compose に送信権限が含まれるため、追加の再連携は不要。
// ───────────────────────────────────────────────────────────
import { gmailSend } from "./google.js";
import {
  getSettings,
  apoMailSentRow,
  logApoMail,
  listApoReminderTargets,
} from "./db.js";

// ===== 既定テンプレート =====
export const DEFAULT_CONFIRM_SUBJECT = "【{{会社名}}様】{{商談日時}} オンライン商談のご案内";
export const DEFAULT_CONFIRM_BODY = `{{会社名}}
{{お客様名}} 様

お世話になっております。
{{自社名}}の{{担当者名}}と申します。

このたびはお打ち合わせのお時間をいただき、誠にありがとうございます。
下記の日程で承りましたのでご案内いたします。

■ 日時：{{商談日時}}
■ 参加URL：{{URL}}

お時間になりましたら、上記URLよりご入室ください。
ご都合の変更やご不明点がございましたら、本メールにご返信ください。

当日はどうぞよろしくお願いいたします。

─────────────────
{{担当者名}}
{{担当者メール}}
─────────────────`;

export const DEFAULT_REMINDER_SUBJECT = "【リマインド】明日{{商談時刻}}〜 オンライン商談のご案内";
export const DEFAULT_REMINDER_BODY = `{{会社名}}
{{お客様名}} 様

お世話になっております。{{自社名}}の{{担当者名}}です。

明日のお打ち合わせにつきまして、あらためてご案内いたします。

■ 日時：{{商談日時}}
■ 参加URL：{{URL}}

お時間になりましたら上記URLよりご入室ください。
ご都合が変わられた場合は、お手数ですが本メールにご返信ください。

よろしくお願いいたします。

─────────────────
{{担当者名}}
{{担当者メール}}
─────────────────`;

// ===== 設定の読み出し（未設定なら既定値） =====
export async function getApoMailConfig() {
  const s = (await getSettings().catch(() => ({}))) || {};
  return {
    // 自動送信のON/OFF（既定はOFF。設定画面で明示的に入れてもらう）
    autoConfirm: s.apoMailAutoConfirm === true,
    autoReminder: s.apoMailAutoReminder === true,
    // リマインドを流す時刻（JST・0〜23）
    reminderHour: Number.isFinite(+s.apoMailReminderHour) ? Math.min(23, Math.max(0, +s.apoMailReminderHour)) : 8,
    companyName: String(s.apoMailCompanyName || "").trim() || "弊社",
    confirmSubject: String(s.apoMailConfirmSubject || "").trim() || DEFAULT_CONFIRM_SUBJECT,
    confirmBody: String(s.apoMailConfirmBody || "").trim() || DEFAULT_CONFIRM_BODY,
    reminderSubject: String(s.apoMailReminderSubject || "").trim() || DEFAULT_REMINDER_SUBJECT,
    reminderBody: String(s.apoMailReminderBody || "").trim() || DEFAULT_REMINDER_BODY,
    // 1回の自動実行で送る上限（暴走したときの保険）
    maxPerRun: Number.isFinite(+s.apoMailMaxPerRun) ? Math.max(1, +s.apoMailMaxPerRun) : 50,
  };
}

// ===== 差し込み =====
// 予定タイトル「【新/ヒ】株式会社◯◯／田中様」から会社名と担当者名を取り出す
export function parseTitleParts(title) {
  let t = String(title || "").normalize("NFKC");
  t = t.replace(/【[^】]*】/g, " ").replace(/[（(][^）)]*[）)]/g, " ");
  t = t.replace(/[\/／|｜]/g, " ").replace(/\s+/g, " ").trim();
  let person = "";
  const pm = t.match(/([^\s　]{1,12}?)\s*様/);
  if (pm) person = pm[1].replace(/[^\p{L}\p{N}ー]/gu, "");
  let company = t.replace(/[^\s]*様.*$/, "").trim();
  if (!company) company = t;
  return { company: company.replace(/\s+/g, ""), person };
}

const WD = ["日", "月", "火", "水", "木", "金", "土"];
function jstParts(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const j = new Date(d.getTime() + 9 * 3600 * 1000); // UTC→JST
  const p = (n) => String(n).padStart(2, "0");
  return {
    y: j.getUTCFullYear(), m: j.getUTCMonth() + 1, d: j.getUTCDate(),
    wd: WD[j.getUTCDay()], hh: p(j.getUTCHours()), mm: p(j.getUTCMinutes()),
  };
}

export function buildVars(link, { repName, repEmail, url, companyName }) {
  const parts = parseTitleParts(link.label);
  const t = jstParts(link.start_time);
  const dateStr = t ? `${t.m}月${t.d}日(${t.wd})` : "";
  const timeStr = t ? `${t.hh}:${t.mm}` : "";
  return {
    "会社名": parts.company || "",
    "お客様名": String(link.client_name || "").trim() || parts.person || "ご担当者",
    "商談日時": t ? `${dateStr} ${timeStr}〜` : "",
    "商談日": dateStr,
    "商談時刻": timeStr,
    "URL": url || "",
    "担当者名": repName || "",
    "担当者メール": repEmail || "",
    "アポ獲得者": link.setter || "",
    "自社名": companyName || "弊社",
    "件名元": link.label || "",
  };
}

export function render(tpl, vars) {
  return String(tpl || "").replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? "") : whole
  );
}

// ===== 送信本体 =====
// 戻り値: { ok, skipped, reason, subject, to }
// 送れない理由（宛先なし・担当なし等）は例外ではなく skipped で返す。
// 自動実行の途中で1件こけても全体を止めないため。
export async function sendApoMail(link, kind, { url, repName, force = false, actor = "auto" } = {}) {
  if (!link || !link.slug) return { ok: false, skipped: true, reason: "リンクがありません" };
  const cfg = await getApoMailConfig();
  const owner = String(link.current_owner || "").trim();
  const to = String(link.client_email || "").trim();

  if (!owner) return { ok: false, skipped: true, reason: "担当セールスが未割り当てです" };
  if (!to) return { ok: false, skipped: true, reason: "お客様のメールアドレスが未登録です" };
  if (!link.start_time) return { ok: false, skipped: true, reason: "商談の開始時刻が分かりません" };

  if (!force) {
    const already = await apoMailSentRow(link.slug, kind);
    if (already) return { ok: false, skipped: true, reason: "送信済みです", at: already.created_at };
  }

  const vars = buildVars(link, {
    repName: repName || owner,
    repEmail: owner,
    url,
    companyName: cfg.companyName,
  });
  const subject = render(kind === "reminder" ? cfg.reminderSubject : cfg.confirmSubject, vars);
  const bodyText = render(kind === "reminder" ? cfg.reminderBody : cfg.confirmBody, vars);

  try {
    const r = await gmailSend(owner, { to, subject, bodyText });
    await logApoMail({
      slug: link.slug, kind, toEmail: to, fromOwner: owner,
      subject, status: "sent", messageId: (r && r.id) || null,
    });
    console.log(`[apo-mail] ${kind} 送信 ${link.slug} → ${to}（差出人: ${owner} / ${actor}）`);
    return { ok: true, subject, to, messageId: (r && r.id) || null };
  } catch (e) {
    await logApoMail({
      slug: link.slug, kind, toEmail: to, fromOwner: owner,
      subject, status: "failed", error: e.message,
    });
    console.warn(`[apo-mail] ${kind} 失敗 ${link.slug} → ${to}: ${e.message}`);
    return { ok: false, skipped: false, reason: e.message, needScope: !!e.needScope };
  }
}

// ===== 前日リマインドのスイープ =====
// 「翌日ぶん」をまとめて送る。設定した時刻の1時間のあいだに1回だけ動く。
export async function runReminderSweep({ joinUrl, repNameOf } = {}) {
  const cfg = await getApoMailConfig();
  if (!cfg.autoReminder) return { skipped: true, reason: "リマインド自動送信がOFFです" };

  // 「明日」のJST 00:00〜24:00 をUTCの範囲に直す
  const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
  const y = nowJst.getUTCFullYear(), m = nowJst.getUTCMonth(), d = nowJst.getUTCDate();
  const fromUtc = new Date(Date.UTC(y, m, d + 1, 0, 0, 0) - 9 * 3600 * 1000);
  const toUtc = new Date(Date.UTC(y, m, d + 2, 0, 0, 0) - 9 * 3600 * 1000);

  const targets = await listApoReminderTargets(fromUtc.toISOString(), toUtc.toISOString());
  const results = [];
  let sent = 0;
  for (const link of targets) {
    if (sent >= cfg.maxPerRun) {
      console.warn(`[apo-mail] 1回あたりの上限 ${cfg.maxPerRun}件に達したため中断しました`);
      break;
    }
    const repName = repNameOf ? await repNameOf(link.current_owner) : link.current_owner;
    const r = await sendApoMail(link, "reminder", {
      url: joinUrl ? joinUrl(link.slug) : "",
      repName,
      actor: "reminder-sweep",
    });
    results.push({ slug: link.slug, ...r });
    if (r.ok) sent++;
    await new Promise((res) => setTimeout(res, 800)); // Gmail側のレート対策
  }
  if (targets.length) console.log(`[apo-mail] 前日リマインド: 対象${targets.length}件 / 送信${sent}件`);
  return { total: targets.length, sent, results };
}
