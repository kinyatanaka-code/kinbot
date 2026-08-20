// live.js — 商談中のライブ配信。MuxとCloudflare Streamを切り替えて使う。
// LIVE_PROVIDER=cloudflare にするとCloudflare Streamを使います（既定はmux）。
//
// Cloudflareは「配信した時間」ではなく「見られた時間」で課金されるため、
// 誰も見なかった商談の費用がかかりません。録画はGoogleドライブに残すので、
// Cloudflare側の録画は作りません（保存料もかかりません）。

import { saveLiveRelay, getLiveRelay } from "./db.js";
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

  // 録画モードについて。
  //   off       … 保存はしないが、そのぶんライブ再生用の動画も作られない（＝見られない）
  //   automatic … ライブ再生ができる。ただしCloudflare側にも録画が残る
  // ライブで見られることが目的なので automatic にし、
  // 商談が終わったらCloudflare側の録画は消す（保存料を増やさないため）。
  const r = await cfFetch("/stream/live_inputs", {
    method: "POST",
    body: JSON.stringify({
      meta: { name: `kinbot ${new Date().toISOString().slice(0, 16)}` },
      recording: {
        mode: "automatic",
        // 配信が途切れてもすぐ終わりにしない（少しの回線切れで切断されないように）
        timeoutSeconds: 30,
        requireSignedURLs: false,
        allowedOrigins: [],
      },
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
    // データベースにも残す。kinbotが再起動しても、中継サーバーが宛先を引けるようにするため。
    await saveLiveRelay(token, cfUrl).catch(() => {});
    // 「/live/合図」の形にする。配信ソフトによっては、アプリ名と鍵の2つに分かれていないと送れないため。
    rtmpUrl = `${relay}/live/${token}`;
  }

  return {
    liveStreamId: r.uid,
    playbackId: r.uid,   // Cloudflareは配信枠のIDがそのまま再生IDになる
    rtmpUrl,
    relayed: !!(relay && cfUrl),
  };
}

// 中継サーバーから聞かれた合図に対して、送り先を返す。
// メモリ →（無ければ）データベース の順に探す。
export async function relayDestFor(token) {
  const t = String(token || "").trim();
  if (!t) return "";
  const hit = relayMap.get(t);
  if (hit) return hit.dest;
  const row = await getLiveRelay(t).catch(() => null);
  if (row && row.dest) {
    relayMap.set(t, { dest: row.dest, at: Date.now() });
    return row.dest;
  }
  return "";
}

// 配信を止める（枠を片づける）。
// Cloudflare側に残った録画も消す。録画はGoogleドライブに保存しているので、
// ここに残しておくと保存料だけがかかってしまう。
export async function disableLiveStream(liveStreamId) {
  if (!liveStreamId) return;
  if (liveProvider() === "mux") return await muxDisableLiveStream(liveStreamId);
  try {
    // 先に、この配信枠でできた録画を消す
    try {
      const list = await cfFetch(`/stream/live_inputs/${encodeURIComponent(liveStreamId)}/videos`);
      const vids = Array.isArray(list) ? list : (list && list.result) || [];
      for (const v of vids) {
        if (!v || !v.uid) continue;
        await cfFetch(`/stream/${encodeURIComponent(v.uid)}`, { method: "DELETE" }).catch(() => {});
      }
      if (vids.length) console.log(`[live] Cloudflareの録画 ${vids.length}件を片づけました`);
    } catch (e) {
      console.warn("[live] Cloudflareの録画を片づけられませんでした:", e.message);
    }
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

// Cloudflareに残っている古い配信枠と録画を片づける。
// 商談のたびに枠を作るので、消し忘れがあると溜まっていくため。
export async function cleanupOldLiveInputs(hours = 6) {
  if (liveProvider() !== "cloudflare" || !liveConfigured()) return { skipped: true };
  const cut = Date.now() - hours * 3600 * 1000;
  let removed = 0, videos = 0;
  try {
    const list = await cfFetch("/stream/live_inputs");
    const inputs = Array.isArray(list) ? list : (list && list.liveInputs) || [];
    for (const inp of inputs) {
      const uid = inp && inp.uid;
      if (!uid) continue;
      // kinbotが作ったものだけ、古いものだけを消す
      const name = String((inp.meta && inp.meta.name) || "");
      if (!name.startsWith("kinbot ")) continue;
      const at = new Date(inp.created || inp.modified || 0).getTime();
      if (!at || at > cut) continue;
      // まだ配信中なら触らない
      const state = (inp.status && inp.status.current && inp.status.current.state) || "";
      if (state === "connected") continue;
      try {
        const vl = await cfFetch(`/stream/live_inputs/${encodeURIComponent(uid)}/videos`);
        const vids = Array.isArray(vl) ? vl : (vl && vl.result) || [];
        for (const v of vids) {
          if (v && v.uid) { await cfFetch(`/stream/${encodeURIComponent(v.uid)}`, { method: "DELETE" }).catch(() => {}); videos++; }
        }
      } catch {}
      await cfFetch(`/stream/live_inputs/${encodeURIComponent(uid)}`, { method: "DELETE" }).catch(() => {});
      removed++;
    }
  } catch (e) {
    return { error: e.message };
  }
  if (removed || videos) console.log(`[live] 古い配信枠 ${removed}件・録画 ${videos}件を片づけました`);
  return { removed, videos };
}

// Cloudflareが教えてくれる情報から、顧客コード（customer-xxxx）を確かめる。
// 設定した顧客コードが違うと、配信は届いていても再生できないため。
export async function cfCustomerCodeCheck(liveStreamId) {
  if (liveProvider() !== "cloudflare" || !liveConfigured()) return null;
  try {
    const r = await cfFetch(`/stream/live_inputs/${encodeURIComponent(liveStreamId)}`);
    // 返ってくるURL（webRTCの再生用など）に customer-xxxx が入っている
    const text = JSON.stringify(r || {});
    const m = text.match(/customer-([a-z0-9]+)\.cloudflarestream\.com/i);
    const real = m ? m[1] : "";
    return {
      設定している顧客コード: CF_CODE || "（未設定）",
      Cloudflareの顧客コード: real || "（分かりませんでした）",
      合っているか: real ? (real === CF_CODE) : null,
      直し方: real && real !== CF_CODE
        ? `Railwayの CF_STREAM_CUSTOMER_CODE を「${real}」に直してください`
        : "",
    };
  } catch (e) {
    return { error: e.message };
  }
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
