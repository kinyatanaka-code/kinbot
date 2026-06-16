// server/google.js
// Googleカレンダーの読み取り連携（OAuth2）。重い依存は使わず fetch で実装。
import { getSettings, saveSettings } from "./db.js";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
const SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";

export function googleConfigured() {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

export function authUrl(redirectUri) {
  const p = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function exchangeCode(code, redirectUri) {
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
  if (data.refresh_token) {
    await saveSettings({ googleRefreshToken: data.refresh_token });
  }
  return data;
}

export async function isConnected() {
  const s = await getSettings();
  return !!s.googleRefreshToken;
}

export async function disconnect() {
  await saveSettings({ googleRefreshToken: "" });
}

async function accessToken() {
  const s = await getSettings();
  const refresh = s.googleRefreshToken;
  if (!refresh) return null;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google refresh ${res.status}`);
  const data = await res.json();
  return data.access_token;
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

/** 連携中アカウント（主カレンダーIDはメールアドレス） */
export async function getPrimaryEmail() {
  const token = await accessToken();
  if (!token) return null;
  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary",
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.id || null;
}

/** 指定範囲のうち、Zoomリンクのある予定を返す（範囲未指定なら今〜26時間） */
export async function listZoomEvents({ timeMin, timeMax } = {}) {
  const token = await accessToken();
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
  if (!res.ok) throw new Error(`Google events ${res.status}`);
  const data = await res.json();
  const out = [];
  for (const ev of data.items || []) {
    if (!ev.start?.dateTime) continue; // 終日予定は除外
    const zoom = findZoomUrl(ev);
    if (!zoom) continue;
    out.push({
      id: ev.id,
      title: ev.summary || "(無題)",
      start: ev.start.dateTime,
      zoomUrl: zoom,
    });
  }
  return out;
}
