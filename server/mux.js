// server/mux.js
// ライブ映像配信（Mux）。MUX_TOKEN_ID / MUX_TOKEN_SECRET を設定すると有効。
// ライブ開始時にライブ配信枠を作り、RTMP送信先URLと再生ID(playback id)を返す。
const TOKEN_ID = process.env.MUX_TOKEN_ID || "";
const TOKEN_SECRET = process.env.MUX_TOKEN_SECRET || "";
// Mux RTMP ingest（標準RTMP）。RTMPSにしたい場合は rtmps://global-live.mux.com:443/app
const RTMP_BASE = process.env.MUX_RTMP_BASE || "rtmp://global-live.mux.com:5222/app";

export function muxConfigured() {
  return !!(TOKEN_ID && TOKEN_SECRET);
}

function authHeader() {
  return "Basic " + Buffer.from(`${TOKEN_ID}:${TOKEN_SECRET}`).toString("base64");
}

// ライブ配信枠を作成 → { rtmpUrl, playbackId, liveStreamId }
export async function createLiveStream() {
  const res = await fetch("https://api.mux.com/video/v1/live-streams", {
    method: "POST",
    headers: { Authorization: authHeader(), "content-type": "application/json" },
    body: JSON.stringify({
      playback_policy: ["public"],
      latency_mode: process.env.MUX_LATENCY_MODE || "low", // 低遅延(4〜7秒)
      reconnect_window: 30,
      new_asset_settings: { playback_policy: ["public"] },
    }),
  });
  if (!res.ok) throw new Error(`Mux create ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()).data;
  const playbackId = data?.playback_ids?.[0]?.id || null;
  return {
    liveStreamId: data?.id || null,
    streamKey: data?.stream_key || null,
    playbackId,
    rtmpUrl: data?.stream_key ? `${RTMP_BASE}/${data.stream_key}` : null,
  };
}

// ライブ配信枠を無効化（任意。終了時に呼ぶ）
export async function disableLiveStream(liveStreamId) {
  if (!liveStreamId) return;
  try {
    await fetch(`https://api.mux.com/video/v1/live-streams/${liveStreamId}`, {
      method: "DELETE",
      headers: { Authorization: authHeader() },
    });
  } catch (e) {
    console.error("[mux] disable", e.message);
  }
}

export function playbackUrl(playbackId) {
  return playbackId ? `https://stream.mux.com/${playbackId}.m3u8` : null;
}
