// live.js — 商談中のライブ配信。MuxとCloudflare Streamを切り替えて使う。
// LIVE_PROVIDER=cloudflare にするとCloudflare Streamを使います（既定はmux）。
//
// Cloudflareは「配信した時間」ではなく「見られた時間」で課金されるため、
// 誰も見なかった商談の費用がかかりません。録画はGoogleドライブに残すので、
// Cloudflare側の録画は作りません（保存料もかかりません）。

import {
  muxConfigured,
  createLiveStream as muxCreateLiveStream,
  disableLiveStream as muxDisableLiveStream,
  playbackUrl as muxPlaybackUrl,
} from "./mux.js";

const PROVIDER = (process.env.LIVE_PROVIDER || "mux").toLowerCase();
const CF_ACCOUNT = process.env.CF_ACCOUNT_ID || "";
const CF_TOKEN = process.env.CF_STREAM_TOKEN || "";
const CF_CODE = process.env.CF_STREAM_CUSTOMER_CODE || "";

export function liveProvider() {
  return PROVIDER === "cloudflare" ? "cloudflare" : "mux";
}

export function liveConfigured() {
  if (liveProvider() === "cloudflare") return !!(CF_ACCOUNT && CF_TOKEN);
  return muxConfigured();
}

// 設定の状態を返す（画面での確認用）
export function liveInfo() {
  const p = liveProvider();
  return {
    provider: p,
    configured: liveConfigured(),
    customerCodeSet: p === "cloudflare" ? !!CF_CODE : null,
  };
}

async function cfFetch(path, options = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${CF_TOKEN}`,
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) {
    const msg = (data.errors || []).map((e) => e.message).join(" / ") || `Cloudflare ${res.status}`;
    throw new Error(msg);
  }
  return data.result;
}

// 配信枠を作る。返す形はMuxと同じ（呼び出し側を変えずに済むように）。
export async function createLiveStream() {
  if (liveProvider() === "mux") return await muxCreateLiveStream();
  if (!liveConfigured()) throw new Error("Cloudflare Streamの設定（CF_ACCOUNT_ID / CF_STREAM_TOKEN）がありません");

  const r = await cfFetch("/stream/live_inputs", {
    method: "POST",
    body: JSON.stringify({
      meta: { name: `kinbot ${new Date().toISOString().slice(0, 16)}` },
      // 録画はGoogleドライブに残すので、Cloudflare側では作らない
      recording: { mode: "off" },
    }),
  });
  const rtmps = r.rtmps || {};
  const rtmpUrl = rtmps.url && rtmps.streamKey ? `${rtmps.url}${rtmps.streamKey}` : "";
  return {
    liveStreamId: r.uid,
    playbackId: r.uid,   // Cloudflareは配信枠のIDがそのまま再生IDになる
    rtmpUrl,
  };
}

// 配信を止める（枠を片づける）
export async function disableLiveStream(liveStreamId) {
  if (!liveStreamId) return;
  if (liveProvider() === "mux") return await muxDisableLiveStream(liveStreamId);
  try {
    await cfFetch(`/stream/live_inputs/${encodeURIComponent(liveStreamId)}`, { method: "DELETE" });
  } catch (e) {
    console.warn("[live] Cloudflareの配信枠の片づけに失敗", e.message);
  }
}

// 再生URL（HLS）
export function playbackUrl(playbackId) {
  if (!playbackId) return null;
  if (liveProvider() === "mux") return muxPlaybackUrl(playbackId);
  if (!CF_CODE) return null; // 顧客コードが未設定だと再生URLを作れない
  return `https://customer-${CF_CODE}.cloudflarestream.com/${playbackId}/manifest/video.m3u8`;
}
