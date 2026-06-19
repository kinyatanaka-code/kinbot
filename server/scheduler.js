// server/scheduler.js
// 連携済みの各ユーザーのGoogleカレンダーを定期チェックし、
// Zoom予定の「開始3分前」にBotを予約する（商談はその人の所有に）。
import { listZoomEvents } from "./google.js";
import { createBot } from "./recall.js";
import { resolveConfig } from "./config.js";
import { isScheduled, markScheduled, createMeeting, listGoogleAccounts } from "./db.js";
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
    const repName = await getDisplayName(owner);

    for (const ev of events) {
      const key = `${owner}::${ev.id}`;
      if (await isScheduled(key)) continue;
      const startMs = new Date(ev.start).getTime();
      const joinAt = new Date(Math.max(startMs - 3 * 60 * 1000, now + 5000)).toISOString();
      try {
        const botId = await createBot({
          meetingUrl: ev.zoomUrl,
          webhookUrl: `${publicUrl}/api/recall/webhook`,
          languageCode: cfg.languageCode,
          botName: cfg.botName,
          provider: cfg.transcribeProvider,
          deepgramModel: cfg.deepgramModel,
          joinAt,
        });
        await createMeeting(botId, { meetingUrl: ev.zoomUrl, repName, title: ev.title, owner });
        await markScheduled(key, botId, ev.start);
        console.log(`[scheduler] 予約: ${owner}「${ev.title}」→ bot ${botId}（入室 ${joinAt}）`);
      } catch (e) {
        console.error(`[scheduler] 予約失敗「${ev.title}」:`, e.message);
      }
    }
  }
}
