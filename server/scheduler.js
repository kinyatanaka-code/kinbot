// server/scheduler.js
// 連携したGoogleカレンダーを定期チェックし、Zoom予定の「開始3分前」にBotを予約する。
import { listZoomEvents, isConnected } from "./google.js";
import { createBot } from "./recall.js";
import { resolveConfig } from "./config.js";
import { isScheduled, markScheduled, createMeeting } from "./db.js";

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
  if (!(await isConnected())) return;
  const cfg = await resolveConfig();
  const events = await listZoomEvents();
  const now = Date.now();

  for (const ev of events) {
    if (await isScheduled(ev.id)) continue; // 既に予約済み
    const startMs = new Date(ev.start).getTime();
    const joinAtMs = startMs - 3 * 60 * 1000; // 開始3分前
    // 予約は開始10分以上前が必要。近すぎる予定は「今すぐ」に寄せる。
    const joinAt = new Date(Math.max(joinAtMs, now + 5000)).toISOString();
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
      await createMeeting(botId, { meetingUrl: ev.zoomUrl, repName: cfg.repName });
      await markScheduled(ev.id, botId, ev.start);
      console.log(`[scheduler] 予約: 「${ev.title}」→ bot ${botId}（入室 ${joinAt}）`);
    } catch (e) {
      console.error(`[scheduler] 予約失敗「${ev.title}」:`, e.message);
    }
  }
}
