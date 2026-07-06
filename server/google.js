// server/google.js
// Googleカレンダー連携（ユーザーごと）。トークンは google_accounts に owner 単位で保存。
import { getGoogleToken, saveGoogleToken, deleteGoogleToken } from "./db.js";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.readonly";

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
      out.push({ id: ev.id, title: ev.summary || "", start, allDay: !ev.start?.dateTime });
    }
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
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
