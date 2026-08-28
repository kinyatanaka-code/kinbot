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
  const flat = t;
  if (!t || /^(ヘルプ|help|使い方|\?|？)$/.test(t)) return { kind: "help" };

  // 「要望 〜」「バグ 〜」「メモ 〜」は、そのまま開発メモに残す。
  // 商談中でも思いついたときに一言送れるように、いちばん先に見る。
  const raw = String(text || "").trim();
  const memo = raw.match(/^(要望|ようぼう|リクエスト|バグ|不具合|メモ|アイデア|改善)[\s　:：、,]+([\s\S]+)$/);
  if (memo) {
    const kindMap = { 要望: "request", ようぼう: "request", リクエスト: "request", 改善: "request",
                      バグ: "bug", 不具合: "bug", メモ: "idea", アイデア: "idea" };
    return { kind: "note", noteKind: kindMap[memo[1]] || "request", text: memo[2].trim() };
  }
  if (/^(開発メモ|要件|開発)$/.test(flat)) return { kind: "notes" };

  // ── AI社員（自動化）まわり。長文になりがちなので、長文ゲートより前に見る ──
  // 改名：「名前を〇〇にして」「名前は〇〇」「〇〇って呼んで」。
  // 「名前を教えて」等の質問は改名にしない（に…して が要る／質問語を弾く）。
  const rename = raw.match(/^(?:名前を|なまえを)\s*(.+?)\s*に(?:して|する|変えて|かえて|してほしい|して欲しい|しといて)$/)
    || raw.match(/^(?:名前は|なまえは)\s*(.+?)\s*(?:でお願い|でよろしく)?$/)
    || raw.match(/^(.+?)\s*(?:って呼ぶ|って呼んで|と呼ぶ|と呼んで|に改名)/);
  if (rename && rename[1]) {
    const nm = rename[1].replace(/[「」『』"'`]/g, "").trim();
    const 質問っぽい = /教え|なに|何|だれ|誰|[?？]$/.test(nm);
    if (nm && nm.length <= 20 && !質問っぽい && !/^(自動|状態|ヘルプ|自動化)$/.test(nm)) {
      return { kind: "naming", name: nm };
    }
  }
  // 制御：「自動改善 とめて／うごかして」「本番反映 とめて／…」「稼働時間 9〜18」
  const wantsOff = /(止め|とめ|停止|オフ|off|やめ|ストップ|停止して|一時停止)/.test(t);
  const wantsOn = /(動かして|うごかして|再開|オン|on|開始|始めて|はじめて|復帰)/.test(t);
  const 稼働 = raw.match(/(?:稼働|反映|入れてよい)?(?:時間|時刻)[^\d]*(\d{1,2})\s*[〜~\-−ー到]\s*(\d{1,2})/);
  if (稼働) return { kind: "autoctl", action: "hours", from: Number(稼働[1]), to: Number(稼働[2]) };
  if (/自動改善|自動修正|自動で直|開発を(止め|とめ|再開)|夜間開発|毎時/.test(raw) && (wantsOff || wantsOn)) {
    return { kind: "autoctl", action: wantsOff ? "off" : "on", target: "improve" };
  }
  if (/本番(反映|に入れ)|自動デプロイ|デプロイ/.test(raw) && (wantsOff || wantsOn)) {
    return { kind: "autoctl", action: wantsOff ? "off" : "on", target: "apply" };
  }
  // 状態：「自動」「自動化」「いまの自動」「改善状況」「AI社員」「どこで動いてる」
  if (/^(自動|自動化|じどう|改善状況|ai社員|エーアイ社員)$/.test(flat)
      || /(自動化|自動改善).{0,4}(状態|状況|どう|いま)/.test(raw)
      || /どこで(動|管理|うご)/.test(raw)) {
    return { kind: "auto" };
  }
  // 記憶：「記憶」「覚えてる？」「何を覚えてる」
  if (/^(記憶|きおく|覚えてること|おぼえてること)$/.test(flat)
      || /(何|なに)を?(覚え|おぼえ)/.test(raw) || /覚えてる[?？]?$/.test(raw)) {
    return { kind: "memory" };
  }
  // レポート：「レポート」「朝礼」「まとめ」「今日の報告」
  if (/^(レポート|ればーと|朝礼|まとめ|報告|状況まとめ)$/.test(flat) || /(今日|きょう).{0,3}(報告|まとめ)/.test(raw)) {
    return { kind: "report" };
  }
  // 監査：「監査」「SF監査して」「リスト見て」
  if (/監査/.test(raw) || /sf.{0,3}(見て|チェック|確認)/.test(t) || /リスト.{0,3}(見て|確認|チェック)/.test(raw)) {
    return { kind: "audit" };
  }

  // 短い決まり文句だけ、その場で判断する。
  // それ以外（文になっているもの）は、AIに読み取ってもらう。
  if (t.length > 12 || /[？?]$/.test(t) || /何件|いくつ|教え|ある\?|できて/.test(t)) {
    return { kind: "ask", text };
  }

  const tomorrow = /明日|あした|翌日/.test(t);
  const day = tomorrow ? 1 : 0;

  if (/重複|だぶ|ダブり/.test(t)) return { kind: "dupes" };
  if (/スキャン|取り込|よみこみ|読み込/.test(t)) return { kind: "scan" };
  if (/立ち上げ|立上げ|salesforce|sf/.test(t)) return { kind: "launch" };
  if (/状態|version|バージョン|更新/.test(t)) return { kind: "status" };
  if (/アポ/.test(t)) return { kind: "apo", day };
  if (/商談|予定|今日|きょう/.test(t)) return { kind: "meetings", day };
  return { kind: "ask", text };
}

// 自由に書かれた質問を、kinbotが分かる形に読み替えてもらうための指示。
// AIには「何を知りたいか」だけを決めてもらい、数はこちらのデータで数える。
export const INTENT_SYSTEM =
  "あなたは営業支援システム kinbot の受付です。ユーザーの日本語の質問を読み、下のJSONだけを返してください。説明や記号は付けないでください。\n" +
  "{\n" +
  '  "intent": "meetings" | "apo" | "apo_taken" | "sf_pending" | "launch_pending" | "scan" | "dupes" | "status" | "unknown",\n' +
  '  "from": "YYYY-MM-DD",\n' +
  '  "to": "YYYY-MM-DD",\n' +
  '  "scope": "me" | "all",\n' +
  '  "person": "名前（特定の人について聞いているときだけ。無ければ空）",\n' +
  '  "business": "DOC" | "MOCHICA" | "",\n' +
  '  "want": "count" | "list"\n' +
  "}\n" +
  "意味:\n" +
  "- meetings … 商談（実施した打ち合わせ）\n" +
  "- apo … 商談日がその期間にあるアポ（予定）\n" +
  "- apo_taken … その期間に「取った」アポ（実績）\n" +
  "- sf_pending … Salesforceの更新ができていない商談\n" +
  "- launch_pending … Salesforceの立ち上げができていないもの\n" +
  "- scan … カレンダーを見に行く／取り込む\n" +
  "- dupes … 重複した予定\n" +
  "- status … kinbot自体の状態やバージョン\n" +
  "- unknown … kinbotのデータでは答えられない質問（目標値など、kinbotが持っていないもの）\n" +
  "決まり:\n" +
  "- 「自分」「私」と書いていなければ scope は all（チーム全体）にする\n" +
  "- 期間の指定が無ければ、今日を from と to にする\n" +
  "- 「今月」は今月の1日から末日、「今週」は月曜から日曜にする\n" +
  "- 「何件」「いくつ」なら want は count、それ以外は list\n";

// AIが使えないときのために、こちらでも読み取る。
// よく使う言い方（日付・今日/今週/今月・何件）だけを見る。
export function guessIntent(text, today = jstDate(0)) {
  const t = String(text || "");
  const flat = t.replace(/[\s　]/g, "");
  const y = Number(today.slice(0, 4));

  // 期間
  const d = new Date(today + "T00:00:00Z");
  const iso = (dt) => dt.toISOString().slice(0, 10);
  let from = today, to = today;
  const md = flat.match(/(\d{1,2})[\/月](\d{1,2})/);
  if (md) {
    const p = (n) => String(n).padStart(2, "0");
    from = to = `${y}-${p(md[1])}-${p(md[2])}`;
  } else if (/明日|あした/.test(flat)) {
    const n = new Date(d); n.setUTCDate(n.getUTCDate() + 1); from = to = iso(n);
  } else if (/昨日|きのう/.test(flat)) {
    const n = new Date(d); n.setUTCDate(n.getUTCDate() - 1); from = to = iso(n);
  } else if (/今週|週間/.test(flat)) {
    const n = new Date(d); const w = (n.getUTCDay() + 6) % 7;   // 月曜はじまり
    const a = new Date(n); a.setUTCDate(a.getUTCDate() - w);
    const b = new Date(a); b.setUTCDate(b.getUTCDate() + 6);
    from = iso(a); to = iso(b);
  } else if (/今月/.test(flat)) {
    from = today.slice(0, 8) + "01";
    const b = new Date(today.slice(0, 8) + "01T00:00:00Z");
    b.setUTCMonth(b.getUTCMonth() + 1); b.setUTCDate(0);
    to = iso(b);
  }

  // 何を聞かれているか
  let intent = "unknown";
  if (/立ち上げ|立上げ/.test(flat)) intent = "launch_pending";
  else if (/(sf|salesforce|エスエフ).*(更新|反映)|更新.*(sf|salesforce)/i.test(flat)) intent = "sf_pending";
  else if (/重複|だぶ/.test(flat)) intent = "dupes";
  else if (/スキャン|取り込/.test(flat)) intent = "scan";
  else if (/取った|獲得|実績/.test(flat) && /アポ/.test(flat)) intent = "apo_taken";
  else if (/アポ/.test(flat)) intent = "apo";
  else if (/商談|打ち合わせ|ミーティング/.test(flat)) intent = "meetings";
  else if (/状態|バージョン/.test(flat)) intent = "status";

  return {
    intent, from, to,
    scope: /自分|私|わたし|僕|俺/.test(flat) ? "me" : "all",
    person: "",
    business: /mochica|モチカ/i.test(flat) ? "MOCHICA" : (/doc|ドック/i.test(flat) ? "DOC" : ""),
    want: /何件|いくつ|件数/.test(flat) ? "count" : "list",
    by: "簡易",
  };
}

export function helpText() {
  return [
    "*kinbotにできること*",
    "短い言葉でも、ふつうの文でも大丈夫です。",
    "",
    "*短い言葉*",
    "・`アポ` `明日のアポ` … 今日／明日の自分のアポ",
    "・`商談` … 今日の自分の商談",
    "・`スキャン` … カレンダーを今すぐ見に行く",
    "・`重複` … 同じ商談の予定が2つ以上ないか数える",
    "・`立ち上げ` … Salesforceを立ち上げられていないもの",
    "・`状態` … いま動いているkinbot",
    "",
    "*直したいことを残す*",
    "・`要望 メールの宛先を自動で入れてほしい`",
    "・`バグ 削除しても消えない`",
    "・`メモ 温度感の出し方を見直したい`",
    "　→ 溜めておいて、朝6時にまとめて知らせます（`開発メモ` で一覧）",
    "",
    "*AI社員（自動化）*",
    "・`自動` … いまの自動化の状態と、どこで動いているか",
    "・`記憶` … このプロジェクトで覚えていること（決めごと・指示）",
    "・`レポート` … いまの状況まとめ（仕事・SF監査・稼働）",
    "・`監査` … SF監査を今すぐ実行して結果を知らせる",
    "・`自動改善を止めて` `自動改善を動かして` … 自動でコードを直す動きのON/OFF",
    "・`本番反映を止めて` … 直すのは続けるが、本番には入れずPRにする",
    "・`稼働時間 9〜18` … 本番に入れてよい時間帯",
    "・`名前を〇〇にして` … AI社員の名前を変える",
    "",
    "*ふつうの文でも*",
    "・8/4の商談は何件？",
    "・今週チームで取ったアポは？",
    "・SFの更新ができていない商談は？",
    "・明日のアポを全員ぶん教えて",
    "",
    "何も言わなければ、チーム全体でお答えします。自分のぶんだけ見たいときは「自分の」と付けてください。",
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
