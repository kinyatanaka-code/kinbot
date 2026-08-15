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

const CHAT_ISSUER = "chat@system.gserviceaccount.com";

// Googleからの本物の通知かを確かめる。
// Authorization: Bearer <JWT> を Google に問い合わせて、送り主を見る。
export async function verifyChatRequest(req, { audience = "" } = {}) {
  const auth = String(req.headers.authorization || "");
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return { ok: false, reason: "証明が付いていません" };
  try {
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(m[1]));
    if (!r.ok) return { ok: false, reason: "証明を確かめられませんでした" };
    const d = await r.json();
    if (String(d.email || "") !== CHAT_ISSUER) return { ok: false, reason: "送り主がGoogle Chatではありません" };
    if (audience && String(d.aud || "") !== String(audience)) {
      return { ok: false, reason: "宛先（audience）が合いません" };
    }
    return { ok: true, aud: d.aud };
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
