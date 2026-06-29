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

// ===== VOD（アップロードした音声/動画を資産化して再生） =====
import fs from "fs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createVodUpload(passthrough) {
  const res = await fetch("https://api.mux.com/video/v1/uploads", {
    method: "POST",
    headers: { Authorization: authHeader(), "content-type": "application/json" },
    body: JSON.stringify({
      cors_origin: "*",
      new_asset_settings: {
        playback_policy: ["public"],
        passthrough: passthrough ? String(passthrough).slice(0, 255) : undefined,
      },
    }),
  });
  if (!res.ok) throw new Error(`Mux upload create ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()).data;
  return { uploadId: data?.id, url: data?.url };
}

// Upload URL へファイルをPUTして取り込み開始。uploadId を返す。
export async function startVodUpload(filePath, mime, passthrough) {
  const { uploadId, url } = await createVodUpload(passthrough);
  if (!url) throw new Error("Mux upload url が取得できませんでした");
  const size = fs.statSync(filePath).size;
  const res = await fetch(url, {
    method: "PUT",
    headers: { "content-type": mime || "application/octet-stream", "content-length": String(size) },
    body: fs.createReadStream(filePath),
    duplex: "half",
  });
  if (!res.ok) throw new Error(`Mux upload PUT ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return uploadId;
}

async function getUploadAssetId(uploadId) {
  const res = await fetch(`https://api.mux.com/video/v1/uploads/${uploadId}`, { headers: { Authorization: authHeader() } });
  if (!res.ok) return null;
  return (await res.json()).data?.asset_id || null;
}
async function getAssetPlayback(assetId) {
  const res = await fetch(`https://api.mux.com/video/v1/assets/${assetId}`, { headers: { Authorization: authHeader() } });
  if (!res.ok) return { status: "error" };
  const data = (await res.json()).data;
  return { status: data?.status, playbackId: data?.playback_ids?.[0]?.id || null };
}

// 取り込み→エンコード完了(playback id)までポーリング（最大約15分）
export async function waitVodPlayback(uploadId, { maxMs = 15 * 60 * 1000, intervalMs = 6000 } = {}) {
  const deadline = Date.now() + maxMs;
  let assetId = null;
  while (Date.now() < deadline) {
    if (!assetId) assetId = await getUploadAssetId(uploadId).catch(() => null);
    if (assetId) {
      const { status, playbackId } = await getAssetPlayback(assetId).catch(() => ({}));
      if (status === "ready" && playbackId) return playbackId;
      if (status === "errored") throw new Error("Muxエンコード失敗");
    }
    await sleep(intervalMs);
  }
  throw new Error("Muxエンコードがタイムアウトしました");
}
