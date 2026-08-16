// ───────────────────────────────────────────────────────────
// chatapp.js — Chatアプリ（サービスアカウント）としてGoogle Chatに投稿する
//
// Webhookで送ると送信者が「Webhook Bot」になる。
// Chat APIを使えば、登録したアプリ名（kinbot）とアイコンで投稿できる。
//
// 使うもの
//   ・サービスアカウントの鍵（JSON）… 環境変数 GOOGLE_CHAT_SA_KEY
//   ・投稿先のスペースID（spaces/AAAA…）… 設定画面で指定
//
// 費用はかからない。Chat APIはWorkspaceの契約に含まれる。
// ───────────────────────────────────────────────────────────
import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/chat.bot";

let _token = { value: "", exp: 0 };

// サービスアカウントの鍵を読む。JSONそのままでも、base64でも受け取れる。
export function serviceAccount() {
  const raw = String(process.env.GOOGLE_CHAT_SA_KEY || "").trim();
  if (!raw) return null;
  let text = raw;
  // base64で入れている場合はほどく（改行を含むJSONは環境変数に入れにくいため）
  if (!raw.startsWith("{")) {
    try { text = Buffer.from(raw, "base64").toString("utf8"); } catch { return null; }
  }
  try {
    const j = JSON.parse(text);
    if (!j.client_email || !j.private_key) return null;
    return { email: j.client_email, key: String(j.private_key).replace(/\\n/g, "\n") };
  } catch { return null; }
}

export function chatAppConfigured() {
  return !!serviceAccount();
}

export function chatAppInfo() {
  const sa = serviceAccount();
  return { configured: !!sa, account: sa ? sa.email : "" };
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// サービスアカウントの鍵で署名して、アクセストークンをもらう
async function accessToken() {
  if (_token.value && Date.now() < _token.exp - 60 * 1000) return _token.value;
  const sa = serviceAccount();
  if (!sa) throw new Error("サービスアカウントの鍵が設定されていません（GOOGLE_CHAT_SA_KEY）");

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: sa.email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600,
  }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const sig = b64url(signer.sign(sa.key));
  const jwt = `${header}.${claim}.${sig}`;

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    throw new Error(`Chatアプリの認証 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const d = await res.json();
  _token = { value: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return _token.value;
}

// 「spaces/AAAA」の形にそろえる。URLを貼られても拾えるようにする。
export function normalizeSpace(input) {
  const s = String(input || "").trim();
  if (!s) return "";
  // spaces/AAAA / chat.google.com/room/AAAA / #chat/space/AAAA のどれでも拾う
  const m = s.match(/(?:spaces|room|space)\/([A-Za-z0-9_-]+)/);
  if (m) return `spaces/${m[1]}`;
  if (/^[A-Za-z0-9_-]+$/.test(s)) return `spaces/${s}`;
  return "";
}

// スペースに1件投稿する
// その人とkinbotの1対1のスペース（DM）を探す。
//
// 見つからないときは、その人がまだkinbotに一度も話しかけていない状態。
// Google Chatの決まりで、こちらから先に話しかけることはできないので、
// 「kinbotに一度話しかけてください」と案内する必要がある。
const _dmCache = new Map();
export async function findDirectMessage(email) {
  const key = String(email || "").trim().toLowerCase();
  if (!key) return "";
  const hit = _dmCache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return hit.space;
  const token = await accessToken();
  const res = await fetch(
    `https://chat.googleapis.com/v1/spaces:findDirectMessage?name=${encodeURIComponent("users/" + key)}`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    if (res.status === 404) { _dmCache.set(key, { at: Date.now(), space: "" }); return ""; }
    const t = await res.text();
    throw new Error(`1対1のスペースを探せません ${res.status}: ${t.slice(0, 200)}`);
  }
  const d = await res.json();
  const space = d.name || "";
  _dmCache.set(key, { at: Date.now(), space });
  return space;
}

// その人だけに送る（1対1のチャット）
export async function postToPerson(email, text) {
  const space = await findDirectMessage(email);
  if (!space) {
    const e = new Error(`${email} とのやり取りがまだありません`);
    e.hint = "その人がGoogle Chatで kinbot に一度話しかけると、送れるようになります（「ヘルプ」と送るだけで大丈夫です）";
    e.needGreeting = true;
    throw e;
  }
  return postToSpace(space, text);
}

export async function postToSpace(space, text) {
  const sp = normalizeSpace(space);
  if (!sp) throw new Error("スペースIDが正しくありません（spaces/… の形で指定してください）");
  const token = await accessToken();
  const res = await fetch(`https://chat.googleapis.com/v1/${sp}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ text: String(text || "").slice(0, 3800) }),
  });
  if (!res.ok) {
    const t = await res.text();
    const err = new Error(`Chatアプリの投稿 ${res.status}: ${t.slice(0, 300)}`);
    // よくある原因を、そのまま画面に出せる言葉にしておく
    if (res.status === 403 || res.status === 404) {
      err.hint = "kinbotがそのスペースに追加されていない可能性があります。" +
        "Google Chatでスペースを開き、「アプリと統合」→「アプリを追加」から kinbot を追加してください。";
    }
    throw err;
  }
  return res.json().catch(() => ({}));
}
