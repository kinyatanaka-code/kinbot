// server/scheduler.js
// 連携済みの各ユーザーのGoogleカレンダーを定期チェックし、
// Zoom予定の「開始3分前」にBotを予約する（商談はその人の所有に）。
import { listZoomEvents } from "./google.js";
import { createBot } from "./recall.js";
import { resolveConfig } from "./config.js";
import { isScheduled, markScheduled, createMeeting, listGoogleAccounts, dbGetUser } from "./db.js";

import { muxConfigured, createLiveStream } from "./mux.js";
import { getDisplayName } from "./auth.js";

let publicUrl = "";
let timer = null;

export function startScheduler({ publicUrl: url, intervalMs = 120000 }) {
  publicUrl = (url || "").replace(/\/$/, "");
  if (!publicUrl) {
    console.warn("[scheduler] PUBLIC_URL 未設定のため、カレンダー自動入室は無効。");
    return;
  }
  const run = () => tick().catch((e) => console.error("[scheduler]", e.message));
  timer = setInterval(run, intervalMs);
  run();
}

async function tick() {
  const accounts = await listGoogleAccounts();
  if (!accounts.length) return;
  const now = Date.now();

  for (const acc of accounts) {
    const owner = acc.owner;
    const cfg = await resolveConfig(owner);
    let events;
    try {
      events = await listZoomEvents(owner);
    } catch (e) {
      console.error(`[scheduler] ${owner} の予定取得失敗:`, e.message);
      continue;
    }
    const ownerName = await getDisplayName(owner);

    for (const ev of events) {
      const key = `${owner}::${ev.id}`;
      if (await isScheduled(key)) continue;
      const startMs = new Date(ev.start).getTime();
      // 商談名＝カレンダーの予定タイトル、営業担当＝カレンダーの主催者
      const meta = await meetingMeta(owner, ownerName, ev);
      const joinAt = new Date(Math.max(startMs - 3 * 60 * 1000, now + 5000)).toISOString();
      try {
        let mux = null;
        if (muxConfigured()) {
          try {
            mux = await createLiveStream();
          } catch (e) {
            console.error("[scheduler][mux]", e.message);
          }
        }
        const botId = await createBot({
          meetingUrl: ev.zoomUrl,
          webhookUrl: `${publicUrl}/api/recall/webhook`,
          languageCode: cfg.languageCode,
          botName: cfg.botName,
          provider: cfg.transcribeProvider,
          deepgramModel: cfg.deepgramModel,
          joinAt,
          rtmpUrl: mux?.rtmpUrl || null,
        });
        await createMeeting(botId, {
          meetingUrl: ev.zoomUrl,
          repName: meta.repName,
          title: meta.title,
          owner: meta.owner,
          muxPlaybackId: mux?.playbackId || null,
        });
        await markScheduled(key, botId, ev.start);
        console.log(`[scheduler] 予約: ${owner}「${meta.title}」担当:${meta.repName} → bot ${botId}（入室 ${joinAt}）`);
      } catch (e) {
        console.error(`[scheduler] 予約失敗「${ev.title}」:`, e.message);
      }
    }
  }
}

// 商談名と営業担当を決める。
// 商談名：カレンダーの予定タイトル。無ければ主催者名＋日時で埋める（「(無題)」にしない）。
// 営業担当：予定の主催者。kinbotの登録ユーザーなら、その人の商談として記録する。
async function meetingMeta(owner, ownerName, ev) {
  const title = String(ev.title || "").trim();
  const orgEmail = String(ev.organizer || ev.creator || "").trim().toLowerCase();

  let repName = "";
  let recOwner = owner;
  if (orgEmail) {
    let u = null;
    try { u = await dbGetUser(orgEmail); } catch {}
    if (u) {
      repName = u.name || u.email || orgEmail;
      recOwner = u.email || owner;
    } else {
      repName = ev.organizerName || orgEmail;
    }
  }
  if (!repName) repName = ownerName || owner;

  let name = title;
  if (!name) {
    const d = new Date(ev.start);
    const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    name = `${repName}の商談 ${when}`;
  }
  return { title: name, repName, owner: recOwner };
}
