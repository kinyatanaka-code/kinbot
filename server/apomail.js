// ───────────────────────────────────────────────────────────
// アポメール自動送付
//   ・確定メール ：担当セールスが割り当てられた直後に送る
//   ・リマインド ：商談前日の朝に送る
// いずれも「担当セールス本人のGmailアカウント」から送信する（gmailSend）。
// scope は gmail.compose に送信権限が含まれるため、追加の再連携は不要。
// ───────────────────────────────────────────────────────────
import { gmailSend, gmailCreateDraft } from "./google.js";
import {
  getSettings,
  getUserSettings,
  memberProfiles,
  apoMailSentRow,
  logApoMail,
  listApoReminderTargets,
} from "./db.js";

// ===== 既定テンプレート =====
export const DEFAULT_CONFIRM_SUBJECT = "【ご案内】お打ち合わせ日程について（{{自社名}}）";
export const DEFAULT_CONFIRM_BODY = `{{会社名}}
{{お客様名}}様

いつも大変お世話になっております。
{{自社名}}の{{担当者姓}}でございます。

{{お礼の書き出し}}
またお忙しい中お打ち合わせのお時間をいただき、
誠にありがとうございました。

それでは、お打ち合わせの日程につきまして、
下記のとおりご案内いたします。

【日時】{{商談日時}}
【形式】Web会議（Zoom）
{{ZoomURL}}

当日は、{{お客様名}}様の現在の採用状況をお伺いさせていただき、
採用領域全般でご活用いただける弊社AIエージェントが{{お客様名}}様にとってどのようにお役立ちできるか、
具体的にご案内させていただければと存じます。

{{お客様名}}様にとって少しでも有意義なお時間となるよう準備してまいります。
ご不明点などございましたら、お気軽にご連絡ください。

{{お客様名}}様とお話しできることを心より楽しみにしております。
当日はどうぞよろしくお願いいたします。

■━━━━━━━━━━━━━━━━━━━━━━━━━■
◇{{自社名}}（http://www.neo-career.co.jp/）
{{部署}}
{{ユニット}}
{{担当者名}}　/　{{担当者ローマ字}}
Phone：{{担当者電話}}
◇本社 〒160-0023
東京都新宿区西新宿1-22-2 新宿サンエービル4階
TEL：03-6756-0421　 FAX：03-5908-8385
■━━━━━━━━━━━━━━━━━━━━━━━━━■`;

export const DEFAULT_REMINDER_SUBJECT = "【リマインド】明日{{商談時刻}}〜 お打ち合わせのご案内（{{自社名}}）";
export const DEFAULT_REMINDER_BODY = `{{会社名}}
{{お客様名}}様

いつも大変お世話になっております。
{{自社名}}の{{担当者姓}}でございます。

明日のお打ち合わせにつきまして、あらためてご案内いたします。

【日時】{{商談日時}}
【形式】Web会議（Zoom）
{{ZoomURL}}

お時間になりましたら、上記URLよりご入室ください。
ご都合が変わられた場合は、お手数ですが本メールにご返信ください。

{{お客様名}}様とお話しできることを楽しみにしております。
当日はどうぞよろしくお願いいたします。

■━━━━━━━━━━━━━━━━━━━━━━━━━■
◇{{自社名}}（http://www.neo-career.co.jp/）
{{部署}}
{{ユニット}}
{{担当者名}}　/　{{担当者ローマ字}}
Phone：{{担当者電話}}
◇本社 〒160-0023
東京都新宿区西新宿1-22-2 新宿サンエービル4階
TEL：03-6756-0421　 FAX：03-5908-8385
■━━━━━━━━━━━━━━━━━━━━━━━━━■`;

// もう使わなくなった差し込みの行を、保存済みの本文からも取り除く。
// （以前のテンプレートを保存したままの人が、設定を触らなくても新しい形になる）
const RETIRED_TAGS = ["ミーティングID", "パスコード"];
export function stripRetiredLines(body) {
  return String(body || "")
    .split("\n")
    .filter((line) => !RETIRED_TAGS.some((t) => line.includes(`{{${t}}}`)))
    .join("\n");
}

// ===== 設定の読み出し（未設定なら既定値） =====
export async function getApoMailConfig() {
  const s = (await getSettings().catch(() => ({}))) || {};
  return {
    // メールの出し方。
    //   draft … 担当セールスのGmailに下書きを作る（本人が内容を見て送る）
    //   send  … そのまま自動送信する
    // 既定は draft。誤送信が起きないので、まずはこちらで運用する。
    deliverMode: s.apoMailDeliverMode === "send" ? "send" : "draft",
    // 自動送信のON/OFF（既定はOFF。設定画面で明示的に入れてもらう）
    autoConfirm: s.apoMailAutoConfirm === true,
    autoReminder: s.apoMailAutoReminder === true,
    // リマインドを流す時刻（JST・0〜23）
    reminderHour: Number.isFinite(+s.apoMailReminderHour) ? Math.min(23, Math.max(0, +s.apoMailReminderHour)) : 8,
    companyName: String(s.apoMailCompanyName || "").trim() || "株式会社ネオキャリア",
    confirmSubject: String(s.apoMailConfirmSubject || "").trim() || DEFAULT_CONFIRM_SUBJECT,
    confirmBody: stripRetiredLines(String(s.apoMailConfirmBody || "").trim() || DEFAULT_CONFIRM_BODY),
    reminderSubject: String(s.apoMailReminderSubject || "").trim() || DEFAULT_REMINDER_SUBJECT,
    reminderBody: stripRetiredLines(String(s.apoMailReminderBody || "").trim() || DEFAULT_REMINDER_BODY),
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

// よくある3文字の姓。2文字で切ると間違えるものだけを並べる。
const THREE_CHAR_SURNAMES = [
  "佐々木", "長谷川", "小野寺", "久保田", "佐久間", "五十嵐", "小早川", "大河原",
  "宇佐美", "小笠原", "阿久津", "菅野原", "長谷部", "勅使河", "八木橋", "宇都宮",
  "喜多村", "神保町", "小田切", "西園寺", "早乙女", "十河内", "武者小", "四十物",
];

// 名前から姓を取り出す。
//   「田中 欽也」    → スペース区切りなら前半
//   「植野ひかり」    → 先頭の漢字のかたまり
//   「森田弥鳴」      → 漢字だけなら先頭2文字（3文字姓のリストを先に見る）
//   「Kinya Tanaka」→ 英字はスペース区切りの前半
export function familyName(name) {
  const n = String(name || "").trim().replace(/[\s\u3000]+/g, " ");
  if (!n) return "";
  // スペースで区切られていればそれが一番確実
  if (n.includes(" ")) return n.split(" ")[0];
  // 3文字の姓を先に確認
  for (const f of THREE_CHAR_SURNAMES) if (n.startsWith(f)) return f;
  // 「漢字＋ひらがな/カタカナ」なら漢字のかたまりが姓
  const m = n.match(/^([\u4E00-\u9FFF々]{1,4})[\u3040-\u309F\u30A0-\u30FF]/);
  if (m) return m[1];
  // 漢字だけの名前は先頭2文字を姓とみなす（3文字以上のときだけ）
  if (/^[\u4E00-\u9FFF々]{3,}$/.test(n)) return n.slice(0, 2);
  return n;
}

// ZoomのURLからミーティングIDを取り出して「849 580 4084」の形にする
export function meetingIdFromUrl(zoomUrl) {
  const m = String(zoomUrl || "").match(/\/j\/(\d{9,12})/);
  if (!m) return "";
  const d = m[1];
  // 3-3-4 / 3-4-4 のように、Zoomの表示に近い形で区切る
  if (d.length === 10) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  if (d.length === 11) return `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}`;
  if (d.length === 9) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  return d;
}

export function buildVars(link, { repName, repEmail, url, companyName, profile = {}, zoomLink = "" }) {
  const parts = parseTitleParts(link.label);
  const t = jstParts(link.start_time);
  const dateStr = t ? `${t.m}月${t.d}日(${t.wd})` : "";
  const timeStr = t ? `${t.hh}:${t.mm}` : "";
  // お客様に案内するURLは kinbot のスマートリンク。
  // 担当が変わっても行き先が自動で切り替わるので、送信済みのメールを直す必要がない。
  const smart = String(url || "").trim();
  // 担当者本人の会議室URL（設定→登録リンク）。ミーティングIDの表示にだけ使う。
  const direct = String(zoomLink || "").trim();
  return {
    "担当者姓": String(profile.shortName || "").trim() || familyName(repName),
    "担当者ローマ字": String(profile.nameRoman || "").trim(),
    "担当者電話": String(profile.phone || "").trim(),
    "部署": String(profile.dept || "").trim(),
    "ユニット": String(profile.unit || "").trim(),
    "ZoomURL": smart,
    "担当者の会議室URL": direct,
    "アポ獲得者姓": familyName(link.setter),
    // 書き出しの1行。
    //   自分で取ったアポ … 「先ほどはお電話ありがとうございました。」
    //   ほかの人が取ったアポ … 「先ほどは弊社○○のお電話にご対応いただき、」
    // 自分で電話した相手に「弊社○○の電話に」と書くと不自然なため。
    "お礼の書き出し": (() => {
      // 自分で取ったアポ、または獲得者が分からないときは、名前を出さない
      const setter = familyName(link.setter);
      if (!setter || selfAcquired(link, repName, repEmail)) {
        return "先ほどはお電話ありがとうございました。";
      }
      return `先ほどは弊社${setter}のお電話にご対応いただき、`;
    })(),
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

// このアポを、送る本人が自分で取ったかどうか。
// メールアドレスで照合し、無ければ名前（表記ゆれを無視）で見る。
function selfAcquired(link, repName, repEmail) {
  const mail = (v) => String(v || "").trim().toLowerCase();
  if (mail(link.setter_email) && mail(link.setter_email) === mail(repEmail)) return true;
  const nm = (v) => String(v || "").replace(/[\s　]/g, "");
  const a = nm(link.setter), b = nm(repName);
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

// 差し込みが空だった行を片付ける。
// 「ミーティングID: 」だけの行や、{{部署}} だけの行が空欄で残らないようにする。
// タグを含まない行（会社の住所やTELなど）は、空でもそのまま残す。
function tidyLines(lines) {
  const out = [];
  for (const { text, hadTag, allTagsEmpty } of lines) {
    if (hadTag && allTagsEmpty) {
      const t = text.trim();
      // 完全に空になった行、または「ラベル：」だけになった行は落とす
      if (!t) continue;
      if (/^[^\s:：]{1,16}\s*[:：]\s*$/.test(t)) continue;
    }
    out.push(text);
  }
  // 空行が3つ以上続いたら2つにまとめる
  const res = [];
  let blank = 0;
  for (const l of out) {
    if (l.trim() === "") { blank++; if (blank > 2) continue; }
    else blank = 0;
    res.push(l);
  }
  return res.join("\n");
}

export function render(tpl, vars) {
  const lines = String(tpl || "").split("\n").map((line) => {
    let hadTag = false, filled = 0, tags = 0;
    const text = line.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, key) => {
      if (!Object.prototype.hasOwnProperty.call(vars, key)) return whole;
      hadTag = true; tags++;
      const v = String(vars[key] ?? "");
      if (v) filled++;
      return v;
    });
    // 「田中 欽也　/　」のように、空になったタグのせいで区切り記号だけが
    // 行末（または行頭）に残るのを片付ける
    let cleaned = text;
    if (tags > filled) {
      cleaned = cleaned.replace(/[\s\u3000]*[\/／・][\s\u3000]*$/, "")
                       .replace(/^[\s\u3000]*[\/／・][\s\u3000]*/, "");
    }
    return { text: cleaned, hadTag, allTagsEmpty: tags > 0 && filled === 0 };
  });
  return tidyLines(lines);
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
    if (already) {
      return { ok: false, skipped: true,
        reason: already.status === "draft" ? "すでに下書きを作成しています" : "送信済みです",
        at: already.created_at };
    }
  }

  // 担当セールスの署名・Zoom情報を読む（メンバー管理で設定した内容）
  const profiles = await memberProfiles().catch(() => ({}));
  const profile = profiles[owner] || {};
  // 会議室URLは「設定 → 登録リンク」で本人が登録したもの
  const us = await getUserSettings(owner).catch(() => ({}));
  const zoomLink = (us && String(us.myZoomLink || "").trim()) || "";
  const vars = buildVars(link, {
    repName: repName || profile.name || owner,
    repEmail: owner,
    url,
    companyName: cfg.companyName,
    profile,
    zoomLink,
  });

  // 差し込みが埋まらない項目があれば、送る前に気づけるようログに出す
  const body = kind === "reminder" ? cfg.reminderBody : cfg.confirmBody;
  const missing = ["ZoomURL", "担当者の会議室URL", "担当者電話", "部署", "ユニット", "担当者ローマ字"]
    .filter((k) => body.includes(`{{${k}}}`) && !vars[k]);
  if (missing.length) {
    console.warn(`[apo-mail] ${owner} の設定が未入力のため空欄になります: ${missing.join("、")}` +
      `（署名は 設定→メンバー管理→署名、会議室URLは 設定→登録リンク）`);
  }
  // スマートリンクは担当者の会議室URLへ転送する仕組みなので、未登録だとお客様が入室できない
  const noRoom = !zoomLink && body.includes("{{ZoomURL}}");
  if (noRoom) {
    console.warn(`[apo-mail] ${owner} が「設定→登録リンク」に会議室URLを登録していません。` +
      `このままだとスマートリンクを開いてもお客様が入室できません。`);
  }
  const subject = render(kind === "reminder" ? cfg.reminderSubject : cfg.confirmSubject, vars);
  const bodyText = render(kind === "reminder" ? cfg.reminderBody : cfg.confirmBody, vars);

  const asDraft = cfg.deliverMode !== "send";
  try {
    const r = asDraft
      ? await gmailCreateDraft(owner, { to, subject, bodyText })
      : await gmailSend(owner, { to, subject, bodyText });
    await logApoMail({
      slug: link.slug, kind, toEmail: to, fromOwner: owner,
      subject, status: asDraft ? "draft" : "sent",
      messageId: (r && (r.id || (r.message && r.message.id))) || null,
    });
    console.log(`[apo-mail] ${kind} ${asDraft ? "下書き作成" : "送信"} ${link.slug} → ${to}（${owner} / ${actor}）`);
    return { ok: true, draft: asDraft, subject, to,
             messageId: (r && (r.id || (r.message && r.message.id))) || null, missing, noRoom };
  } catch (e) {
    await logApoMail({
      slug: link.slug, kind, toEmail: to, fromOwner: owner,
      subject, status: "failed", error: e.message,
    });
    console.warn(`[apo-mail] ${kind} ${asDraft ? "下書き作成" : "送信"}に失敗 ${link.slug} → ${to}: ${e.message}`);
    return { ok: false, skipped: false, reason: e.message,
             needScope: !!e.needScope, needScopeOwner: e.owner || owner };
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
