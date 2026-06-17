// server/google.js
// Googleカレンダー連携（ユーザーごと）。トークンは google_accounts に owner 単位で保存。
import { getGoogleToken, saveGoogleToken, deleteGoogleToken } from "./db.js";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

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
