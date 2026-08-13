// server/google.js
// Googleカレンダー連携（ユーザーごと）。トークンは google_accounts に owner 単位で保存。
import { getGoogleToken, saveGoogleToken, deleteGoogleToken } from "./db.js";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
// calendar.events は「自分のカレンダーに予定を作り、ゲストを招待する」ために必要。
// 招待方式なので、相手（クローザー）のカレンダーへの権限は不要。
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/spreadsheets";

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
    out.push({
      id: ev.id,
      title: ev.summary || "", // 空のまま返す（呼び出し側で埋める）
      start: ev.start.dateTime,
      zoomUrl: zoom,
      organizer: (ev.organizer && ev.organizer.email) || "",
      organizerName: (ev.organizer && ev.organizer.displayName) || "",
      creator: (ev.creator && ev.creator.email) || "",
      guests: (ev.attendees || []).length,
    });
  }
  return out;
}

// Zoom以外・終日予定も含めて、その範囲の全予定を返す（商談名の選択用）
const MEET_RE = /https?:\/\/[\w.-]*(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com)\/[^\s"'<>)\]]+/i;
// 予定に入っている会議URLを、確からしい順にすべて拾う
// 1) Googleの会議情報（正式な会議室） 2) 場所 3) 説明文
export function findMeetingUrls(ev) {
  const sources = [
    { key: "会議情報", text: ev.hangoutLink || "" },
    ...(ev.conferenceData?.entryPoints || []).map((e) => ({ key: "会議情報", text: e.uri || "" })),
    { key: "場所", text: ev.location || "" },
    { key: "説明", text: ev.description || "" },
  ];
  const out = [];
  const seen = new Set();
  for (const src of sources) {
    const t = String(src.text || "");
    if (!t) continue;
    const re = new RegExp(MEET_RE.source, "g");
    let m;
    while ((m = re.exec(t))) {
      const url = m[0];
      // 同じ会議は1つにまとめる（末尾のパスワード等で別物に見えることがある）
      const id = (url.match(/\/j\/(\d{9,})/) || url.match(/\/(\d{9,})/) || [])[1] || url;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ url, source: src.key, id });
      if (out.length >= 5) return out;
    }
  }
  return out;
}

function findMeetingUrl(ev) {
  const list = findMeetingUrls(ev);
  return list.length ? list[0].url : null;
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
      urls: findMeetingUrls(ev),
    });
  }
  return out;
}

// 指定カレンダー（calendarId=メールアドレス等）の予定を範囲取得する。
// 連携済みアカウントのトークンで、共有された他人のカレンダーも読める（要「予定の詳細を表示」共有）。
// アクセス不可（未共有）の場合は 403/404 を投げるので、呼び出し側で個別に握りつぶす。
// updatedMin を渡すと「その時刻以降に追加・変更された予定」だけを返す。
// 差分だけを取れるので、短い間隔で何度も呼んでも軽い。
// （updatedMin を使うときは orderBy=startTime が使えないため自動で外す）
export async function listCalendarEvents(owner, calendarId, { timeMin, timeMax, updatedMin } = {}) {
  const token = await accessToken(owner);
  if (!token) throw new Error("Googleが連携されていません");
  const cal = encodeURIComponent(String(calendarId || "primary"));
  const out = [];
  let pageToken = "";
  for (let guard = 0; guard < 10; guard++) {
    const p = new URLSearchParams({
      singleEvents: "true",
      maxResults: "250",
    });
    if (!updatedMin) p.set("orderBy", "startTime");
    if (timeMin) p.set("timeMin", timeMin);
    if (timeMax) p.set("timeMax", timeMax);
    if (updatedMin) {
      p.set("updatedMin", new Date(updatedMin).toISOString());
      p.set("showDeleted", "false");
    }
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
      out.push({ id: ev.id, title: ev.summary || "", start, end, allDay: !ev.start?.dateTime, url: findMeetingUrl(ev) || "", guests: (ev.attendees || []).length, organizer: (ev.organizer && ev.organizer.email) || "", creator: (ev.creator && ev.creator.email) || "", created: ev.created || "",
        // 予定の説明欄。アポ獲得者が書いたメモを商談担当の予定にも引き継ぐために使う。
        description: ev.description || "",
        // 招待されている人（アポメールの宛先をここから自動取得する）
        attendees: (ev.attendees || [])
          .filter((a) => a && a.email && !a.resource)
          .map((a) => ({ email: a.email, name: a.displayName || "", self: !!a.self, organizer: !!a.organizer })) });
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

// Gmailが使えるかを確認し、ダメな理由も返す。
// 戻り値: { ok, reason: 'ok'|'no_token'|'api_disabled'|'no_scope'|'error', detail, projectHint }
export async function gmailReady(owner) {
  try {
    const token = await accessToken(owner);
    if (!token) return { ok: false, reason: "no_token" };
    const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) return { ok: true, reason: "ok" };
    const body = await res.text();
    // Gmail API 自体が未有効化
    if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(body)) {
      const proj = (body.match(/project[\s\S]*?(\d{6,})/) || [])[1] || "";
      return { ok: false, reason: "api_disabled", detail: body.slice(0, 300), projectHint: proj };
    }
    // スコープ不足（再連携が必要）
    if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes|insufficient permission/i.test(body)) {
      return { ok: false, reason: "no_scope", detail: body.slice(0, 300) };
    }
    return { ok: false, reason: "error", detail: body.slice(0, 300) };
  } catch (e) {
    return { ok: false, reason: "error", detail: e.message };
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
  const raw = await buildRawMessage(owner, { to, subject, bodyText, inReplyTo, references });
  const payload = threadId ? { raw, threadId } : { raw };
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 403 && /insufficient|scope/i.test(t)) {
      const err = new Error(
        `${owner} のGoogle連携にメール送信の権限がありません。` +
        `本人が 設定 → 連携 → Google連携 で「連携解除」→「再連携」を行い、同意画面でGmailの項目を許可してください。`
      );
      err.needScope = true;
      err.owner = owner;
      throw err;
    }
    const err = new Error(`Gmail送信 ${res.status}: ${t.slice(0, 200)}`);
    throw err;
  }
  return res.json();
}

// 返信を「下書き」としてGmailに保存する（送信はしない）。threadIdで同じスレッドにぶら下がる。
export async function gmailCreateDraft(owner, { to, subject, bodyText, threadId, inReplyTo, references }) {
  const token = await accessToken(owner);
  if (!token) throw new Error("Google未連携です");
  const raw = await buildRawMessage(owner, { to, subject, bodyText, inReplyTo, references });
  const message = threadId ? { raw, threadId } : { raw };
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  if (!res.ok) {
    const t = await res.text();
    const err = new Error(`Gmail下書き ${res.status}: ${t.slice(0, 200)}`);
    if (res.status === 403 && /insufficient|scope/i.test(t)) err.needScope = true;
    throw err;
  }
  return res.json();
}

// ───────────────────────────────────────────────────────────
// FreeBusy：複数人のカレンダーの「埋まっている時間帯」をまとめて取得する。
// 予定の中身は見ないので、社内で予定の詳細が非公開でも空き状況だけは取れる。
// ───────────────────────────────────────────────────────────
export async function freeBusy(owner, emails, timeMin, timeMax) {
  const token = await accessToken(owner);
  if (!token) throw new Error("Google未連携です");
  const items = (Array.isArray(emails) ? emails : [emails])
    .map((e) => String(e || "").trim()).filter(Boolean).map((id) => ({ id }));
  if (!items.length) return {};

  const res = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      timeMin: new Date(timeMin).toISOString(),
      timeMax: new Date(timeMax).toISOString(),
      timeZone: "Asia/Tokyo",
      items,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    const err = new Error(`FreeBusy ${res.status}: ${t.slice(0, 200)}`);
    if (res.status === 403 && /insufficient|scope/i.test(t)) err.needScope = true;
    throw err;
  }
  const data = await res.json();
  const out = {};
  for (const [email, cal] of Object.entries(data.calendars || {})) {
    out[email.toLowerCase()] = {
      // カレンダーが見えない場合はここにエラーが入る（権限不足・存在しないアドレス等）
      errors: (cal.errors || []).map((e) => e.reason || "unknown"),
      busy: (cal.busy || []).map((b) => ({ start: b.start, end: b.end })),
    };
  }
  return out;
}

// 指定の時間帯が空いているか。バッファ（分）を前後に足して判定できる。
export function isSlotFree(fb, email, startISO, endISO, bufferMin = 0) {
  const c = fb[String(email || "").toLowerCase()];
  // カレンダーが読めない相手は「判定不能」として空き扱いにしない（勝手に埋めないため）
  if (!c) return { free: false, reason: "カレンダーの空き状況が取得できませんでした" };
  if (c.errors.length) return { free: false, reason: `カレンダーを参照できません（${c.errors.join(",")}）` };
  const s = new Date(startISO).getTime() - bufferMin * 60000;
  const e = new Date(endISO).getTime() + bufferMin * 60000;
  for (const b of c.busy) {
    const bs = new Date(b.start).getTime();
    const be = new Date(b.end).getTime();
    if (bs < e && be > s) return { free: false, reason: "この時間帯に別の予定が入っています" };
  }
  return { free: true, reason: "" };
}

// ───────────────────────────────────────────────────────────
// Gmail のスレッド操作（アーカイブ / ゴミ箱 / 既読）
// scope: gmail.modify が必要。既存ユーザーはGoogleの再連携（再同意）が要る。
// なお「完全削除」は mail.google.com という非常に広い権限を要求するため実装しない。
// ゴミ箱への移動は30日間は元に戻せるので、運用上もこちらが安全。
// ───────────────────────────────────────────────────────────

// ラベルの付け外し（アーカイブ＝INBOXラベルを外す、既読＝UNREADを外す）
export async function gmailModifyThread(owner, threadId, { add = [], remove = [] } = {}) {
  const token = await accessToken(owner);
  if (!token) throw new Error("Google未連携です");
  if (!threadId) throw new Error("スレッドIDがありません");
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/modify`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ addLabelIds: add, removeLabelIds: remove }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    const err = new Error(`Gmail操作 ${res.status}: ${t.slice(0, 200)}`);
    if (res.status === 403 && /insufficient|scope|ACCESS_TOKEN_SCOPE/i.test(t)) err.needScope = true;
    if (res.status === 404) err.notFound = true;
    throw err;
  }
  return res.json();
}

// 受信トレイから外す（メールは消えず、検索やアーカイブから見られる）
export async function gmailArchiveThread(owner, threadId) {
  return gmailModifyThread(owner, threadId, { remove: ["INBOX"] });
}
// 受信トレイに戻す
export async function gmailUnarchiveThread(owner, threadId) {
  return gmailModifyThread(owner, threadId, { add: ["INBOX"] });
}
// 既読・未読
export async function gmailSetRead(owner, threadId, read = true) {
  return read
    ? gmailModifyThread(owner, threadId, { remove: ["UNREAD"] })
    : gmailModifyThread(owner, threadId, { add: ["UNREAD"] });
}

// ゴミ箱へ移動（30日以内なら元に戻せる）
export async function gmailTrashThread(owner, threadId) {
  const token = await accessToken(owner);
  if (!token) throw new Error("Google未連携です");
  if (!threadId) throw new Error("スレッドIDがありません");
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/trash`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const t = await res.text();
    const err = new Error(`Gmailゴミ箱 ${res.status}: ${t.slice(0, 200)}`);
    if (res.status === 403 && /insufficient|scope|ACCESS_TOKEN_SCOPE/i.test(t)) err.needScope = true;
    if (res.status === 404) err.notFound = true;
    throw err;
  }
  return res.json();
}

// ゴミ箱から戻す
export async function gmailUntrashThread(owner, threadId) {
  const token = await accessToken(owner);
  if (!token) throw new Error("Google未連携です");
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/untrash`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const t = await res.text();
    const err = new Error(`Gmail復元 ${res.status}: ${t.slice(0, 200)}`);
    if (res.status === 403 && /insufficient|scope/i.test(t)) err.needScope = true;
    throw err;
  }
  return res.json();
}

// RFC822形式のメッセージを組み立ててbase64url化（送信・下書きで共通）
async function buildRawMessage(owner, { to, subject, bodyText, inReplyTo, references }) {
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
  return Buffer.from(headers.join("\r\n") + "\r\n\r\n" + bodyB64, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// 「その日に作成された予定」を取る（予定の開催日ではなく、カレンダーに登録した日で拾う）
export async function listEventsCreatedOn(owner, dateStr) {
  const token = await accessToken(owner);
  if (!token) throw new Error("Googleが連携されていません");
  const dayStart = new Date(`${dateStr}T00:00:00+09:00`);
  const dayEnd = new Date(`${dateStr}T23:59:59.999+09:00`);
  const out = [];
  let pageToken = "";
  for (let guard = 0; guard < 10; guard++) {
    const p = new URLSearchParams({
      singleEvents: "true",
      orderBy: "updated",
      maxResults: "250",
      showDeleted: "false",
      // その日に作られた予定は、その日に更新もされている
      updatedMin: dayStart.toISOString(),
      // 登録した時点より前に始まる予定は対象外（過去の予定の編集を拾わないため）
      timeMin: dayStart.toISOString(),
    });
    if (pageToken) p.set("pageToken", pageToken);
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${p}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Google events ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    for (const ev of data.items || []) {
      if (ev.status === "cancelled") continue;
      const created = ev.created ? new Date(ev.created) : null;
      if (!created || created < dayStart || created > dayEnd) continue; // その日に作られたものだけ
      const start = ev.start?.dateTime || ev.start?.date || null;
      out.push({
        id: ev.id,
        uid: ev.iCalUID || ev.id,
        title: ev.summary || "",
        start,
        allDay: !ev.start?.dateTime,
        url: findMeetingUrl(ev) || "",
      urls: findMeetingUrls(ev),
        organizer: (ev.organizer && ev.organizer.email) || "",
        organizerName: (ev.organizer && ev.organizer.displayName) || "",
        creator: (ev.creator && ev.creator.email) || "",
        creatorName: (ev.creator && ev.creator.displayName) || "",
        created: ev.created || "",
        guests: (ev.attendees || []).length,
        // 招待されている人（誰に振り分けられたかを判定するために使う）
        attendees: (ev.attendees || [])
          .filter((a) => a && a.email && !a.resource)
          .map((a) => ({ email: a.email, name: a.displayName || "", self: !!a.self, organizer: !!a.organizer })),
      });
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
}

// 下書きを消す（接続確認で作ったものの後始末に使う）
export async function gmailDeleteDraft(owner, draftId) {
  const token = await accessToken(owner);
  if (!token || !draftId) return;
  await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(draftId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}


// ===== 録画をGoogleドライブに保存する =====

// 保存先フォルダを用意する（無ければ作る）
// DRIVE_SHARED_DRIVE_ID を設定すると、個人のドライブではなく共有ドライブに保存します。
// 共有ドライブなら、そこに参加している全員がそのまま見られます。
export async function driveEnsureFolder(owner, name = "kinbot 商談録画") {
  // 保存先のフォルダIDを直接指定しているときは、それをそのまま使う
  // （共有ドライブでなくても、共有した普通のフォルダでOK）
  const fixed = (process.env.DRIVE_FOLDER_ID || "").trim();
  if (fixed) return fixed;

  const token = await driveAccessToken(owner);
  if (!token) throw new Error("Googleが連携されていません");
  const driveId = process.env.DRIVE_SHARED_DRIVE_ID || "";

  const q = `name='${String(name).replace(/'/g, "")}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const params = new URLSearchParams({ q, fields: "files(id,name)" });
  if (driveId) {
    params.set("corpora", "drive");
    params.set("driveId", driveId);
    params.set("includeItemsFromAllDrives", "true");
    params.set("supportsAllDrives", "true");
  } else {
    params.set("spaces", "drive");
  }
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await res.json().catch(() => ({}));
  if (res.ok && d.files && d.files.length) return d.files[0].id;

  const body = { name, mimeType: "application/vnd.google-apps.folder" };
  if (driveId) body.parents = [driveId];
  const mk = await fetch(`https://www.googleapis.com/drive/v3/files?fields=id${driveId ? "&supportsAllDrives=true" : ""}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const md = await mk.json().catch(() => ({}));
  if (!mk.ok) throw new Error(`Drive folder ${mk.status}: ${JSON.stringify(md).slice(0, 200)}`);
  return md.id;
}

// URLの動画を、そのままドライブへ流し込む（サーバーのメモリに溜めない）
export async function driveUploadFromUrl(owner, { url, name, folderId, mimeType = "video/mp4" }) {
  const token = await driveAccessToken(owner);
  if (!token) throw new Error("Googleが連携されていません");

  // 1) アップロード枠を作る
  const sd = (process.env.DRIVE_SHARED_DRIVE_ID || process.env.DRIVE_FOLDER_ID) ? "&supportsAllDrives=true" : "";
  const start = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink,size${sd}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", "X-Upload-Content-Type": mimeType },
    body: JSON.stringify({ name, parents: folderId ? [folderId] : undefined }),
  });
  if (!start.ok) throw new Error(`Drive upload start ${start.status}: ${(await start.text()).slice(0, 200)}`);
  const session = start.headers.get("location");
  if (!session) throw new Error("Driveのアップロード枠を作れませんでした");

  // 2) 元の動画を取りながら、そのまま送る
  const src = await fetch(url);
  if (!src.ok || !src.body) throw new Error(`録画の取得に失敗しました（${src.status}）`);
  const len = src.headers.get("content-length");
  const put = await fetch(session, {
    method: "PUT",
    headers: len ? { "content-length": len } : {},
    body: src.body,
    duplex: "half",
  });
  const pd = await put.json().catch(() => ({}));
  if (!put.ok) throw new Error(`Drive upload ${put.status}: ${JSON.stringify(pd).slice(0, 200)}`);
  return { fileId: pd.id, link: pd.webViewLink || `https://drive.google.com/file/d/${pd.id}/view`, size: Number(pd.size || 0) };
}

// 社内の人が見られるように共有する（ドメイン指定。指定が無ければ何もしない）
export async function driveShareDomain(owner, fileId, domain) {
  if (!domain) return;
  const token = await driveAccessToken(owner);
  if (!token) return;
  await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "domain", domain }),
  }).catch(() => {});
}

// ドライブの動画を、kinbot経由で再生できるように取り出す（途中再生に対応）
export async function driveStream(owner, fileId, range) {
  const token = await driveAccessToken(owner);
  if (!token) throw new Error("Googleが連携されていません");
  const headers = { Authorization: `Bearer ${token}` };
  if (range) headers.Range = range;
  const sd = (process.env.DRIVE_SHARED_DRIVE_ID || process.env.DRIVE_FOLDER_ID) ? "&supportsAllDrives=true" : "";
  return await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media${sd}`, { headers });
}


// 会社名から、社内にある資料（スライド・PDF・ドキュメント）を探す。
// 検索は「この人が見られるもの」に限られるので、社内共有されている資料が見つかります。
export async function driveFindCompanyFiles(owner, company, limit = 12) {
  const token = await accessToken(owner);
  if (!token) throw new Error("Google未連携です");
  const esc = (v) => String(v || "").replace(/['\\]/g, "");
  const full = esc(company);
  // 「株式会社」などを外した中心の語でも探す
  const core = esc(String(company || "").replace(/(株式会社|有限会社|合同会社|一般社団法人|医療法人|学校法人|社会福祉法人|㈱|\(株\)|（株）)/g, "").trim());
  const words = [...new Set([full, core].filter((w) => w && w.length >= 2))];
  if (!words.length) return [];

  const nameQ = words.map((w) => `name contains '${w}'`).join(" or ");
  const kinds = [
    "application/vnd.google-apps.presentation",
    "application/vnd.google-apps.document",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ].map((m) => `mimeType = '${m}'`).join(" or ");

  const p = new URLSearchParams({
    q: `(${nameQ}) and (${kinds}) and trashed = false`,
    pageSize: String(Math.min(30, limit)),
    fields: "files(id,name,mimeType,modifiedTime,webViewLink,iconLink,owners(displayName))",
    orderBy: "modifiedTime desc",
    supportsAllDrives: "true",
    includeItemsFromAllDrives: "true",
    corpora: "allDrives",
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${p}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Drive検索 ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  return (data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    kind: /presentation/.test(f.mimeType) ? "スライド"
      : /document/.test(f.mimeType) ? "ドキュメント"
      : /pdf/.test(f.mimeType) ? "PDF" : "ファイル",
    modified: (f.modifiedTime || "").slice(0, 10),
    link: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view`,
    owner: (f.owners && f.owners[0] && f.owners[0].displayName) || "",
  }));
}

// リンクを知っている人なら誰でも見られるようにする（社外・kinbot未登録の人向け）
export async function driveShareAnyone(owner, fileId) {
  const token = await driveAccessToken(owner);
  if (!token) throw new Error("Googleが連携されていません");
  const sd = "?supportsAllDrives=true";
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions${sd}`;
  const put = async (body) =>
    await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  // 1) リンクを知っている人なら誰でも
  let res = await put({ role: "reader", type: "anyone" });
  if (res.ok) return { scope: "anyone" };
  const t1 = (await res.text()).slice(0, 300);

  // 2) 会社の方針で外部共有が禁止されている場合は、社内全員に共有する
  const domain = process.env.DRIVE_SHARE_DOMAIN || (String(owner).includes("@") ? String(owner).split("@")[1] : "");
  if (domain) {
    res = await put({ role: "reader", type: "domain", domain });
    if (res.ok) return { scope: "domain", domain };
    const t2 = (await res.text()).slice(0, 200);
    const err = new Error(`共有設定に失敗しました。社外共有：${t1} ／ 社内共有：${t2}`);
    err.detail = { anyone: t1, domain: t2 };
    throw err;
  }
  throw new Error(`共有設定に失敗しました: ${t1}`);
}

// フォルダを掘って作る（担当者名 / 8月 / 5日 のような入れ子）
// 作ったフォルダを覚えておく。
// ドライブの検索は作成直後のフォルダを返さないことがあり、そのままだと同名フォルダが増えてしまう。
const _folderCache = new Map(); // owner|root|a/b/c -> id

export async function driveEnsurePath(owner, names = [], rootId = "") {
  const token = await driveAccessToken(owner);
  if (!token) throw new Error("Googleが連携されていません");
  const driveId = process.env.DRIVE_SHARED_DRIVE_ID || "";
  const sd = "&supportsAllDrives=true&includeItemsFromAllDrives=true";
  let parent = rootId;
  const trail = [];
  for (const raw of names) {
    const name = String(raw || "").replace(/[/\\'"]/g, "").trim();
    if (!name) continue;
    trail.push(name);
    const cacheKey = owner + "|" + rootId + "|" + trail.join("/");
    const hit = _folderCache.get(cacheKey);
    if (hit) { parent = hit; continue; }

    // 同名が複数あるときは、いちばん古いものを使う（重複を増やさない）
    const params = new URLSearchParams({
      q: `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false` +
         (parent ? ` and '${parent}' in parents` : ""),
      fields: "files(id,name,createdTime)",
      orderBy: "createdTime",
    });
    if (driveId) { params.set("corpora", "drive"); params.set("driveId", driveId); }
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}${sd}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.files && d.files.length) {
      parent = d.files[0].id;
      _folderCache.set(cacheKey, parent);
      continue;
    }

    const body = { name, mimeType: "application/vnd.google-apps.folder" };
    if (parent) body.parents = [parent];
    else if (driveId) body.parents = [driveId];
    const mk = await fetch(`https://www.googleapis.com/drive/v3/files?fields=id${sd}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const md = await mk.json().catch(() => ({}));
    if (!mk.ok) throw new Error(`フォルダ作成に失敗: ${JSON.stringify(md).slice(0, 160)}`);
    parent = md.id;
    _folderCache.set(cacheKey, parent);
  }
  return parent;
}

// フォルダの中身を一覧する（片付け用）
export async function driveListChildren(owner, folderId, onlyFolders = false) {
  const token = await driveAccessToken(owner);
  if (!token) throw new Error("Googleが連携されていません");
  const out = [];
  let pageToken = "";
  for (let i = 0; i < 20; i++) {
    const p = new URLSearchParams({
      q: `'${folderId}' in parents and trashed=false` + (onlyFolders ? " and mimeType='application/vnd.google-apps.folder'" : ""),
      fields: "nextPageToken,files(id,name,mimeType,createdTime)",
      pageSize: "200",
      orderBy: "createdTime",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    if (pageToken) p.set("pageToken", pageToken);
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${p}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`一覧の取得に失敗: ${JSON.stringify(d).slice(0, 140)}`);
    out.push(...(d.files || []));
    if (!d.nextPageToken) break;
    pageToken = d.nextPageToken;
  }
  return out;
}

// 空のフォルダをゴミ箱へ
export async function driveTrash(owner, fileId) {
  const token = await driveAccessToken(owner);
  if (!token) return;
  await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  }).catch(() => {});
}

// ファイルを別のフォルダへ移す（コピーではないので容量は増えません）
export async function driveMoveFile(owner, fileId, newParentId) {
  const token = await driveAccessToken(owner);
  if (!token) throw new Error("Googleが連携されていません");
  const sd = "&supportsAllDrives=true";
  const cur = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=parents,name${sd}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const info = await cur.json().catch(() => ({}));
  if (!cur.ok) throw new Error(`ファイル情報の取得に失敗: ${JSON.stringify(info).slice(0, 140)}`);
  const parents = info.parents || [];
  if (parents.includes(newParentId)) return { moved: false, name: info.name };

  const p = new URLSearchParams({
    addParents: newParentId,
    removeParents: parents.join(","),
    fields: "id,parents",
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?${p}${sd}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: "{}",
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`移動に失敗: ${JSON.stringify(d).slice(0, 140)}`);
  return { moved: true, name: info.name };
}

// ───────────────────────────────────────────────────────────
// スプレッドシートに1行足す。
// 記録を残す先を、担当者ではなく「記録用のアカウント」に固定して使う想定。
// ───────────────────────────────────────────────────────────
export async function appendSheetRow(owner, spreadsheetId, sheetName, values) {
  if (!spreadsheetId) throw new Error("スプレッドシートのIDが設定されていません");
  const token = await accessToken(owner);
  const range = `${encodeURIComponent(sheetName || "シート1")}!A1`;
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    `/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ values: [values] }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    const err = new Error(`シートへの書き込み ${res.status}: ${t.slice(0, 300)}`);
    if (res.status === 403 && /insufficient|scope|ACCESS_TOKEN_SCOPE/i.test(t)) err.needScope = true;
    if (res.status === 404) err.notFound = true;
    throw err;
  }
  return res.json().catch(() => ({}));
}

// シートの中身を読む
export async function readSheet(owner, spreadsheetId, range) {
  const token = await accessToken(owner);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
    // 画面に見えているとおりの文字で読む。
    // UNFORMATTED_VALUE だと日付が連番（45872 など）になり、「8/3」を探せない。
    `/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const t = await res.text();
    const e = new Error(`シートの読み取り ${res.status}: ${t.slice(0, 300)}`);
    if (res.status === 403 && /insufficient|scope/i.test(t)) e.needScope = true;
    if (res.status === 404) e.notFound = true;
    throw e;
  }
  const d = await res.json();
  return d.values || [];
}

// 決まった場所だけを、まとめて書き換える（他のセルには触れない）
export async function updateSheetCells(owner, spreadsheetId, sheetName, cells) {
  if (!cells.length) return { updated: 0 };
  const token = await accessToken(owner);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        valueInputOption: "USER_ENTERED",
        data: cells.map((c) => ({
          range: `${sheetName}!${c.range}`,
          values: [[c.value]],
        })),
      }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    const e = new Error(`シートへの書き込み ${res.status}: ${t.slice(0, 300)}`);
    if (res.status === 403 && /insufficient|scope/i.test(t)) e.needScope = true;
    throw e;
  }
  const d = await res.json();
  return { updated: d.totalUpdatedCells || 0 };
}

// ───────────────────────────────────────────────────────────
// Apps Script 経由でシートに書き込む
//
// シートが保護されていると、外部のアカウントからは書き込めない。
// スプレッドシートに紐づけたApps Scriptは「置いた人の権限」で動くので、
// オーナーが仕込めば保護のかかったシートにも書ける。
// ───────────────────────────────────────────────────────────
export async function writeViaAppsScript(url, secret, { sheetName, cells }) {
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(String(url || ""))) {
    throw new Error("Apps ScriptのURLが正しくありません（https://script.google.com/... の形）");
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret, sheetName, cells }),
    redirect: "follow",
  });
  const text = await res.text();
  let d = null;
  try { d = JSON.parse(text); } catch {}
  if (!res.ok) throw new Error(`Apps Script ${res.status}: ${text.slice(0, 200)}`);
  if (!d) {
    // ログイン画面のHTMLが返ってきた場合は、公開設定が違う
    throw new Error("Apps Scriptから正しい応答がありません。デプロイの「アクセスできるユーザー」を『全員』にしてください。");
  }
  if (d.error) throw new Error(`Apps Script: ${d.error}`);
  return { updated: d.updated || 0 };
}

// なぜ書き込めないのかを調べる。
// 403は「閲覧のみで共有されている」か「シートが保護されている」のどちらかが多い。
export async function diagnoseSheet(owner, spreadsheetId, sheetName = "", probeCell = "") {
  const token = await accessToken(owner);
  const out = { canEdit: null, name: "", owners: [], protected: [], note: "" };

  // 1. そのアカウントに編集権限があるか（ドライブ側で確認）
  try {
    const r = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}` +
      `?fields=name,capabilities(canEdit),owners(emailAddress)&supportsAllDrives=true`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    if (r.ok) {
      const d = await r.json();
      out.name = d.name || "";
      out.canEdit = !!(d.capabilities && d.capabilities.canEdit);
      out.owners = (d.owners || []).map((o) => o.emailAddress).filter(Boolean);
    }
  } catch {}

  // 2-0. どのシートに保護があるか（範囲の指定漏れを防ぐため、全シートを見る）
  try {
    const r = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
      `?fields=sheets(properties(title),protectedRanges(description,range,editors(users)))`,
      { headers: { authorization: `Bearer ${token}` } }
    );
    if (r.ok) {
      const d = await r.json();
      for (const sh of d.sheets || []) {
        const title = sh?.properties?.title || "";
        // シート名の指定が違っていても見逃さないよう、全部見る。
        // 対象のシートかどうかは、あとで印を付けて分かるようにする。
        const target = !sheetName || title === sheetName;
        for (const pr of sh.protectedRanges || []) {
          // どの範囲が保護されているかを、A1の形で出す。
          // 「（説明なし）」だけだと、どこを直せばよいか分からないため。
          const r = pr.range || {};
          const colA1 = (n) => {
            let s2 = "", x = (n || 0) + 1;
            while (x > 0) { const m2 = (x - 1) % 26; s2 = String.fromCharCode(65 + m2) + s2; x = Math.floor((x - 1) / 26); }
            return s2;
          };
          const hasRange = r.startRowIndex != null || r.startColumnIndex != null;
          const where = hasRange
            ? `${colA1(r.startColumnIndex || 0)}${(r.startRowIndex || 0) + 1}` +
              `:${r.endColumnIndex != null ? colA1(r.endColumnIndex - 1) : ""}${r.endRowIndex != null ? r.endRowIndex : ""}`
            : "シート全体";
          out.protected.push({
            sheet: title,
            target,
            description: pr.description || "",
            where,
            editors: (pr.editors && pr.editors.users) || [],
            // 自分が編集できる人に入っているか
            canEditThis: ((pr.editors && pr.editors.users) || [])
              .some((u) => String(u).toLowerCase() === String(owner).toLowerCase()),
          });
        }
      }
    }
  } catch {}

  // 3. 本当に書けるかを、実際に1セル試して確かめる。
  // 保護の設定は読み取れないことがあるので、試すのが確実。
  if (out.canEdit !== false && sheetName) {
    try {
      // 実際に書き込む予定のセルで試す。
      // いま入っている値を読んで、そのまま同じ値を書き戻すので中身は変わらない。
      const probe = `${sheetName}!${probeCell || "A1"}`;
      const rr = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
        `/values/${encodeURIComponent(probe)}?valueRenderOption=FORMULA`,
        { headers: { authorization: `Bearer ${token}` } }
      );
      const cur = rr.ok ? (((await rr.json()).values || [[]])[0] || [])[0] : "";
      const wr = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
        `/values/${encodeURIComponent(probe)}?valueInputOption=USER_ENTERED`,
        {
          method: "PUT",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ values: [[cur == null ? "" : cur]] }),
        }
      );
      out.canWrite = wr.ok;
      if (!wr.ok) out.writeError = (await wr.text()).slice(0, 200);
    } catch (e) { out.canWrite = null; }
  }

  if (out.canWrite === false) {
    const mine = out.protected.filter((p) => p.target);
    out.note = mine.length
      ? `書き込めませんでした。${mine.map((p) => `${p.sheet}の${p.where}`).join("、")}が保護されています。` +
        `データ → シートと範囲を保護 から、その保護を選び「権限を設定」で ${owner} を追加してください。`
      : `書き込めませんでした。共有では編集者になっていますが、Googleスプレッドシートの` +
        `データ → シートと範囲を保護 で、書き込む範囲に保護がかかっていないかご確認ください。`;
    return out;
  }
  if (out.canWrite === true) {
    out.note = "書き込めます。このまま実行して問題ありません。";
    return out;
  }

  if (out.canEdit === false) {
    out.note = `${owner} には編集権限がありません。スプレッドシートの「共有」から、このアカウントを${out.owners.length ? `（オーナー：${out.owners.join("、")}）` : ""}編集者として追加してください。`;
  } else if (out.protected.length) {
    const list = out.protected
      .map((p) => `${p.sheet}の${p.where}${p.description ? `「${p.description}」` : ""}`)
      .join("、");
    out.note = `シートに保護がかかっています（${list}）。` +
      `スプレッドシートを開き、データ → シートと範囲を保護 → その保護をクリック → 権限を設定 から、` +
      `${owner} を編集できる人に追加してください。`;
  } else if (out.canEdit === true) {
    out.note = "編集権限はあります。書き込めない場合は、対象のセルだけが保護されている可能性があります。";
  } else {
    out.note = "権限を確認できませんでした。スプレッドシートが共有されているかご確認ください。";
  }
  return out;
}

// 書き込めるかどうかを試す（設定画面の確認用）
export async function checkSheet(owner, spreadsheetId) {
  const token = await accessToken(owner);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties.title`,
    { headers: { authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const t = await res.text();
    if (res.status === 403 && /insufficient|scope/i.test(t)) {
      return { ok: false, reason: "no_scope" };
    }
    if (res.status === 404) return { ok: false, reason: "not_found" };
    return { ok: false, reason: "error", detail: t.slice(0, 200) };
  }
  const d = await res.json();
  return {
    ok: true,
    title: d?.properties?.title || "",
    sheets: (d.sheets || []).map((x) => x?.properties?.title).filter(Boolean),
  };
}
