// server/google.js
// Googleカレンダー連携（ユーザーごと）。トークンは google_accounts に owner 単位で保存。
import { getGoogleToken, saveGoogleToken, deleteGoogleToken } from "./db.js";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
// calendar.events は「自分のカレンダーに予定を作り、ゲストを招待する」ために必要。
// 招待方式なので、相手（クローザー）のカレンダーへの権限は不要。
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";

export function googleConfigured() {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

// state にユーザー識別子（署名済み）を載せて、コールバックで誰の連携かを判別
export function authUrl(redirectUri, state) {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state: state || "",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

async function fetchPrimaryEmail(accessToken) {
  try {
    const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.id || null;
  } catch {
    return null;
  }
}

export async function exchangeCode(code, redirectUri, owner) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}: ${await res.text()}`);
  const data = await res.json();
  let gmail = null;
  if (data.access_token) gmail = await fetchPrimaryEmail(data.access_token);
  if (data.refresh_token) {
    await saveGoogleToken(owner, data.refresh_token, gmail);
  }
  return data;
}

export async function isConnected(owner) {
  const row = await getGoogleToken(owner);
  return !!(row && row.refresh_token);
}
export async function disconnect(owner) {
  await deleteGoogleToken(owner);
}

async function accessToken(owner) {
  const row = await getGoogleToken(owner);
  if (!row || !row.refresh_token) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: row.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google refresh ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

export async function getPrimaryEmail(owner) {
  const row = await getGoogleToken(owner);
  if (row && row.google_email) return row.google_email;
  const token = await accessToken(owner);
  if (!token) return null;
  return fetchPrimaryEmail(token);
}

const ZOOM_RE = /https?:\/\/[\w.-]*zoom\.us\/[^\s"'<>)\]]+/i;
function findZoomUrl(ev) {
  const blobs = [
    ev.hangoutLink,
    ev.location,
    ev.description,
    ...(ev.conferenceData?.entryPoints || []).map((e) => e.uri),
  ].filter(Boolean);
  for (const b of blobs) {
    const m = String(b).match(ZOOM_RE);
    if (m) return m[0];
  }
  return null;
}

export async function listZoomEvents(owner, { timeMin, timeMax } = {}) {
  const token = await accessToken(owner);
  if (!token) return [];
  const now = new Date();
  const tMin = timeMin || now.toISOString();
  const tMax = timeMax || new Date(now.getTime() + 26 * 3600 * 1000).toISOString();
  const p = new URLSearchParams({
    timeMin: tMin,
    timeMax: tMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${p}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Google events ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const out = [];
  for (const ev of data.items || []) {
    if (!ev.start?.dateTime) continue;
    const zoom = findZoomUrl(ev);
    if (!zoom) continue;
    out.push({ id: ev.id, title: ev.summary || "(無題)", start: ev.start.dateTime, zoomUrl: zoom });
  }
  return out;
}

// Zoom以外・終日予定も含めて、その範囲の全予定を返す（商談名の選択用）
const MEET_RE = /https?:\/\/[\w.-]*(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com)\/[^\s"'<>)\]]+/i;
function findMeetingUrl(ev) {
  const blobs = [
    ev.hangoutLink,
    ev.location,
    ev.description,
    ...(ev.conferenceData?.entryPoints || []).map((e) => e.uri),
  ].filter(Boolean);
  for (const b of blobs) {
    const m = String(b).match(MEET_RE);
    if (m) return m[0];
  }
  return null;
}

export async function listDayEvents(owner, { timeMin, timeMax } = {}) {
  const token = await accessToken(owner);
  if (!token) return [];
  const now = new Date();
  const tMin = timeMin || now.toISOString();
  const tMax = timeMax || new Date(now.getTime() + 24 * 3600 * 1000).toISOString();
  const p = new URLSearchParams({
    timeMin: tMin,
    timeMax: tMax,
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "50",
  });
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${p}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Google events ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const out = [];
  for (const ev of data.items || []) {
    if (ev.status === "cancelled") continue;
    const start = ev.start?.dateTime || ev.start?.date || null;
    out.push({
      id: ev.id,
      title: ev.summary || "(無題)",
      start,
      allDay: !ev.start?.dateTime,
      url: findMeetingUrl(ev) || "",
    });
  }
  return out;
}

// 指定カレンダー（calendarId=メールアドレス等）の予定を範囲取得する。
// 連携済みアカウントのトークンで、共有された他人のカレンダーも読める（要「予定の詳細を表示」共有）。
// アクセス不可（未共有）の場合は 403/404 を投げるので、呼び出し側で個別に握りつぶす。
export async function listCalendarEvents(owner, calendarId, { timeMin, timeMax } = {}) {
  const token = await accessToken(owner);
  if (!token) throw new Error("Googleが連携されていません");
  const cal = encodeURIComponent(String(calendarId || "primary"));
  const out = [];
  let pageToken = "";
  for (let guard = 0; guard < 10; guard++) {
    const p = new URLSearchParams({
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });
    if (timeMin) p.set("timeMin", timeMin);
    if (timeMax) p.set("timeMax", timeMax);
    if (pageToken) p.set("pageToken", pageToken);
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${cal}/events?${p}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Google events ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    for (const ev of data.items || []) {
      if (ev.status === "cancelled") continue;
      const start = ev.start?.dateTime || ev.start?.date || null;
      const end = ev.end?.dateTime || ev.end?.date || null;
      out.push({ id: ev.id, title: ev.summary || "", start, end, allDay: !ev.start?.dateTime, url: findMeetingUrl(ev) || "", guests: (ev.attendees || []).length, organizer: (ev.organizer && ev.organizer.email) || "", creator: (ev.creator && ev.creator.email) || "", created: ev.created || "" });
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
}
// 自分（owner）のカレンダーに予定を作り、ゲスト（クローザー等）を招待する。
// 招待方式なので、ゲスト側のカレンダーへの権限は不要。既存の予定があれば上書き（patch）する。
//   guests: ["closer@example.com", ...]
//   calendarId: 省略時は primary（副カレンダーを使う場合はそのID）
export async function createCalendarEvent(owner, {
  summary, description, start, end, guests = [], calendarId = "primary",
  guestsCanModify = true, eventId = null, sendUpdates = "all", location = "",
}) {
  const token = await accessToken(owner);
  if (!token) throw new Error("Google未連携です");
  const cal = encodeURIComponent(String(calendarId || "primary"));
  const body = {
    summary: summary || "商談",
    description: description || "",
    start: { dateTime: new Date(start).toISOString(), timeZone: "Asia/Tokyo" },
    end: { dateTime: new Date(end).toISOString(), timeZone: "Asia/Tokyo" },
    attendees: guests.filter(Boolean).map((email) => ({ email })),
    guestsCanModify: !!guestsCanModify,
  };
  if (location) body.location = location;

  const qs = `sendUpdates=${encodeURIComponent(sendUpdates)}`;
  let res;
  if (eventId) {
    // 既存予定を更新（担当変更で招待し直すケース）
    res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${cal}/events/${encodeURIComponent(eventId)}?${qs}`,
      { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }
    );
    if (res.status === 404) res = null; // 消えていたら新規作成にフォールバック
  }
  if (!res) {
    res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${cal}/events?${qs}`,
      { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }
    );
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    if (res.status === 403 && /insufficient|scope/i.test(t)) {
      throw new Error("カレンダーへの書き込み権限がありません。運用者が 設定→連携→Google連携 を再実行して、権限を承認し直してください。");
    }
    throw new Error(`Google Calendar ${res.status} ${t.slice(0, 200)}`);
  }
  const d = await res.json();
  return { id: d.id, htmlLink: d.htmlLink, status: d.status };
}

export async function deleteCalendarEvent(owner, eventId, calendarId = "primary") {
  const token = await accessToken(owner);
  if (!token || !eventId) return false;
  const cal = encodeURIComponent(String(calendarId || "primary"));
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${cal}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
    { method: "DELETE", headers: { authorization: `Bearer ${token}` } }
  );
  return res.ok || res.status === 404 || res.status === 410;
}

export async function driveAccessToken(owner) {
  return accessToken(owner);
}

// ===== Google Drive 連携（自社ナレッジ取り込み用） =====
// 連携状態の簡易確認（Driveへ実アクセスできるか）
export async function driveReady(owner) {
  const token = await accessToken(owner);
  if (!token) return false;
  try {
    const res = await fetch("https://www.googleapis.com/drive/v3/about?fields=user", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ドライブ閲覧（最近/マイドライブ/フォルダ/検索）。フォルダも返す。
export async function driveList(owner, { mode = "recent", parent = "", q = "" } = {}) {
  const token = await accessToken(owner);
  if (!token) throw new Error("Google未連携です");
  let query;
  let orderBy = "folder,name";
  if (q) {
    query = `name contains '${String(q).replace(/'/g, "\\'")}' and trashed = false`;
    orderBy = "modifiedTime desc";
  } else if (parent) {
    query = `'${parent}' in parents and trashed = false`;
  } else if (mode === "mydrive") {
    query = `'root' in parents and trashed = false`;
  } else {
    // 最近使用したアイテム（フォルダ除外）
    query = `trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
    orderBy = "modifiedTime desc";
  }
  const p = new URLSearchParams({
    q: query,
    pageSize: "50",
    fields: "files(id,name,mimeType,modifiedTime)",
    orderBy,
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${p}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive一覧 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.files || [];
}

// ファイル検索（名前部分一致）。フォルダは除外しない（フォルダも返す）
export async function driveSearch(owner, query) {
  const token = await accessToken(owner);
  if (!token) throw new Error("Google未連携です");
  const q = query
    ? `name contains '${String(query).replace(/'/g, "\\'")}' and trashed = false`
    : "trashed = false";
  const p = new URLSearchParams({
    q,
    pageSize: "25",
    fields: "files(id,name,mimeType,modifiedTime,iconLink)",
    orderBy: "modifiedTime desc",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${p}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive検索 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.files || [];
}

// ファイル内容を取得。Googleドキュメント等はテキストにエクスポート、それ以外はバイナリ取得。
// 返り値: { name, mimeType, text } または { name, mimeType, buffer }
export async function driveGetContent(owner, fileId) {
  const token = await accessToken(owner);
  if (!token) throw new Error("Google未連携です");
  const auth = { Authorization: `Bearer ${token}` };
  // メタ取得
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType&supportsAllDrives=true`,
    { headers: auth }
  );
  if (!metaRes.ok) throw new Error(`Driveメタ ${metaRes.status}`);
  const meta = await metaRes.json();
  const mt = meta.mimeType || "";

  const exportMap = {
    "application/vnd.google-apps.document": "text/plain",
    "application/vnd.google-apps.presentation": "text/plain",
    "application/vnd.google-apps.spreadsheet": "text/csv",
  };
  if (exportMap[mt]) {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMap[mt])}`,
      { headers: auth }
    );
    if (!res.ok) throw new Error(`Driveエクスポート ${res.status}`);
    return { name: meta.name, mimeType: exportMap[mt], text: await res.text() };
  }
  if (mt.startsWith("application/vnd.google-apps")) {
    // 図形描画/フォーム等：PDFでエクスポートを試みる
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=application/pdf`,
      { headers: auth }
    );
    if (res.ok) return { name: meta.name, mimeType: "application/pdf", buffer: Buffer.from(await res.arrayBuffer()) };
    throw new Error("この形式は取り込めません");
  }
  // 通常ファイル（PDF・画像・テキスト等）
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, {
    headers: auth,
  });
  if (!res.ok) throw new Error(`Drive取得 ${res.status}`);
  if (mt.startsWith("text/") || mt === "application/json") {
    return { name: meta.name, mimeType: mt, text: await res.text() };
  }
  return { name: meta.name, mimeType: mt, buffer: Buffer.from(await res.arrayBuffer()) };
}

// ───────────────────────────────────────────────────────────
// Gmail 連携（過去のやり取りの取得 / 返信の送信）
// scope: gmail.readonly（読む） + gmail.send（送る）。
// 追加スコープのため、既存ユーザーはGoogleを再連携（再同意）する必要がある。
// ───────────────────────────────────────────────────────────

// Gmailのスコープが有効か（＝Gmail APIが叩けるか）を軽く確認
export async function gmailReady(owner) {
  try {
    const token = await accessToken(owner);
    if (!token) return false;
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

function headerVal(headers, name) {
  const h = (headers || []).find((x) => (x.name || "").toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
}

// base64url → UTF-8 文字列
function decodeB64Url(data) {
  if (!data) return "";
  try {
    return Buffer.from(String(data).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  } catch {
    return "";
  }
}

// MIMEツリーから text/plain（無ければ text/html を除去）を再帰抽出
function extractBody(payload) {
  if (!payload) return "";
  const mt = payload.mimeType || "";
  if (mt === "text/plain" && payload.body && payload.body.data) return decodeB64Url(payload.body.data);
  if (payload.parts && payload.parts.length) {
    // まず text/plain を優先
    for (const p of payload.parts) {
      const t = extractBody(p);
      if (t && (p.mimeType || "").startsWith("text/plain")) return t;
    }
    // 無ければ最初に取れたもの
    for (const p of payload.parts) {
      const t = extractBody(p);
      if (t) return t;
    }
  }
  if (mt === "text/html" && payload.body && payload.body.data) {
    return decodeB64Url(payload.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  return "";
}

// 会社名などのクエリでスレッドを検索し、各スレッドの最新メッセージ概要を返す
export async function gmailSearchThreads(owner, query, max = 6) {
  const token = await accessToken(owner);
  if (!token) throw new Error("Google未連携です");
  const q = String(query || "").trim();
  if (!q) return [];
  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads?q=${encodeURIComponent(q)}&maxResults=${max}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!listRes.ok) {
    const t = await listRes.text();
    const err = new Error(`Gmail検索 ${listRes.status}: ${t.slice(0, 200)}`);
    if (listRes.status === 403 && /insufficient|scope|ACCESS_TOKEN_SCOPE/i.test(t)) err.needScope = true;
    throw err;
  }
  const list = await listRes.json();
  const threads = list.threads || [];
  const out = [];
  for (const th of threads) {
    try {
      const tr = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/threads/${th.id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!tr.ok) continue;
      const data = await tr.json();
      const msgs = data.messages || [];
      const last = msgs[msgs.length - 1] || {};
      const h = last.payload && last.payload.headers;
      out.push({
        threadId: th.id,
        messageId: last.id,
        from: headerVal(h, "From"),
        to: headerVal(h, "To"),
        subject: headerVal(h, "Subject"),
        date: headerVal(h, "Date"),
        snippet: last.snippet || th.snippet || "",
        count: msgs.length,
      });
    } catch {}
  }
  return out;
}

// スレッド全文（各メッセージの本文込み）を取得
export async function gmailGetThread(owner, threadId) {
  const token = await accessToken(owner);
  if (!token) throw new Error("Google未連携です");
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`Gmailスレッド取得 ${res.status}`);
  const data = await res.json();
  const messages = (data.messages || []).map((msg) => {
    const h = msg.payload && msg.payload.headers;
    return {
      id: msg.id,
      from: headerVal(h, "From"),
      to: headerVal(h, "To"),
      subject: headerVal(h, "Subject"),
      date: headerVal(h, "Date"),
      messageIdHeader: headerVal(h, "Message-ID") || headerVal(h, "Message-Id"),
      references: headerVal(h, "References"),
      body: extractBody(msg.payload).slice(0, 8000),
    };
  });
  return { threadId, messages };
}

// メールアドレス部分だけ取り出す（"名前 <a@b.com>" → a@b.com）
export function parseEmailAddr(s) {
  if (!s) return "";
  const m = String(s).match(/<([^>]+)>/);
  return (m ? m[1] : String(s)).trim();
}

// 返信を送信する。threadIdを渡すと同じスレッドにぶら下がる。
export async function gmailSend(owner, { to, subject, bodyText, threadId, inReplyTo, references }) {
  const token = await accessToken(owner);
  if (!token) throw new Error("Google未連携です");
  const from = await getPrimaryEmail(owner);
  const enc = (s) => `=?UTF-8?B?${Buffer.from(String(s || "")).toString("base64")}?=`;
  const headers = [
    from ? `From: ${from}` : "",
    `To: ${to}`,
    `Subject: ${enc(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : "",
    references ? `References: ${references}` : "",
  ].filter(Boolean);
  const bodyB64 = Buffer.from(String(bodyText || ""), "utf-8").toString("base64");
  const raw = Buffer.from(headers.join("\r\n") + "\r\n\r\n" + bodyB64, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const payload = threadId ? { raw, threadId } : { raw };
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    const err = new Error(`Gmail送信 ${res.status}: ${t.slice(0, 200)}`);
    if (res.status === 403 && /insufficient|scope/i.test(t)) err.needScope = true;
    throw err;
  }
  return res.json();
}
