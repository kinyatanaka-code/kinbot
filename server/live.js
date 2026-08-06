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
// 顧客サブドメイン。"customer-xxxx.cloudflarestream.com" のように貼られても動くように整える。
const CF_CODE = String(process.env.CF_STREAM_CUSTOMER_CODE || "")
  .trim()
  .replace(/^https?:\/\//, "")
  .replace(/^customer-/, "")
  .replace(/\.cloudflarestream\.com.*$/, "")
  .replace(/\/.*$/, "");

// 中継サーバー用：合図の文字列 → Cloudflareの宛先
export const relayMap = new Map();

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
    relay: (process.env.LIVE_RELAY_RTMP || "") ? "設定あり（中継経由）" : "なし（Cloudflareへ直接）",
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
  const cfUrl = rtmps.url && rtmps.streamKey ? `${rtmps.url}${rtmps.streamKey}` : "";

  // RecallがRTMPS（暗号化あり）に対応していない場合は、中継サーバーを経由する。
  // LIVE_RELAY_RTMP を設定すると、Recallには中継サーバーのRTMPを渡し、
  // 中継がCloudflareへRTMPSで送り直します（映像は作り直さないので負荷はほぼゼロ）。
  const relay = (process.env.LIVE_RELAY_RTMP || "").replace(/\/+$/, "");
  let rtmpUrl = cfUrl;
  if (relay && cfUrl) {
    const token = "kb" + Math.random().toString(36).slice(2, 12);
    relayMap.set(token, { dest: cfUrl, at: Date.now() });
    // 古い割り当ては片付ける（12時間）
    for (const [k, v] of relayMap) if (Date.now() - v.at > 12 * 3600 * 1000) relayMap.delete(k);
    rtmpUrl = `${relay}/${token}`;
  }

  return {
    liveStreamId: r.uid,
    playbackId: r.uid,   // Cloudflareは配信枠のIDがそのまま再生IDになる
    rtmpUrl,
    relayed: !!(relay && cfUrl),
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

// 配信が実際に届いているかを確認する（Cloudflareのみ）
export async function liveStatus(liveStreamId) {
  if (liveProvider() !== "cloudflare") return { provider: "mux", state: "unknown" };
  if (!liveConfigured()) {
    return {
      provider: "cloudflare", state: "unconfigured",
      why: "CF_ACCOUNT_ID か CF_STREAM_TOKEN が設定されていません（kinbot側の環境変数）",
    };
  }
  if (!CF_CODE) {
    return { provider: "cloudflare", state: "unconfigured", why: "CF_STREAM_CUSTOMER_CODE が設定されていません" };
  }
  if (!liveStreamId) {
    return {
      provider: "cloudflare", state: "no_stream",
      why: "この商談には配信枠が作られていません。録音を開始した時点で配信の設定が読めていなかった可能性があります。設定を直したあと、録音を開始し直してください。",
    };
  }
  try {
    const r = await cfFetch(`/stream/live_inputs/${encodeURIComponent(liveStreamId)}`);
    const st = (r && r.status && r.status.current) || {};
    return {
      provider: "cloudflare",
      state: st.state || "idle",       // connected / disconnected / idle など
      reason: st.reason || "",
      ingestedAt: st.statusLastSeen || "",
    };
  } catch (e) {
    return { provider: "cloudflare", state: "error", reason: e.message };
  }
}
