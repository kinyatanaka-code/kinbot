// server/recall.js
// Recall.ai Meeting Bot API クライアント。
// 仕様: https://docs.recall.ai/docs/bot-real-time-transcription
// 認証ヘッダは「生のAPIキー」（"Bearer " は付けない）。

// 環境変数に紛れた空白・改行・余計な接頭辞を自動で掃除（事故防止）
function clean(v, fallback = "") {
  return (v ?? fallback).toString().trim();
}
const REGION = clean(process.env.RECALL_REGION, "us-west-2")
  .replace(/^https?:\/\//, "") // 誤って https:// を入れても除去
  .replace(/\.recall\.ai.*$/, "") // 誤って .recall.ai... まで入れても除去
  .replace(/\s+/g, ""); // 残った空白を除去
const BASE = `https://${REGION}.recall.ai/api/v1`;
const API_KEY = clean(process.env.RECALL_API_KEY);

function headers() {
  return {
    Authorization: API_KEY, // 生キー
    accept: "application/json",
    "content-type": "application/json",
  };
}

// 直近のボット起動（createBot）の結果を覚えておき、残高不足などを画面に表示できるようにする
let lastCreate = null; // { at, ok, status, code, detail }
function recordCreate(info) { lastCreate = { at: new Date().toISOString(), ...info }; }
export function getLastRecallCreate() { return lastCreate; }

// Recall接続情報（どのリージョン/キーに繋がっているか）。キーは末尾4文字だけ返す。
export function recallConnectionInfo() {
  const last4 = API_KEY ? API_KEY.slice(-4) : "";
  const regionLabel = {
    "us-west-2": "us-west-2（従量課金 / Pay-as-you-go）",
    "us-east-1": "us-east-1（米国東部）",
    "eu-central-1": "eu-central-1（欧州）",
    "ap-northeast-1": "ap-northeast-1（アジア・東京）",
  }[REGION] || REGION;
  return {
    region: REGION,
    regionLabel,
    baseUrl: BASE,
    keyPresent: !!API_KEY,
    keyLast4: last4,
    dashboardUrl: `https://${REGION}.recall.ai/`,
  };
}

// 今月の利用量（bot_total 秒）を取得する。※Recall APIは「残高」を返さないため、利用量のみ。
export async function getRecallUsage() {
  if (!API_KEY) throw new Error("RECALL_API_KEY が未設定です");
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const end = now.toISOString();
  const url = `${BASE}/billing/usage/?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    const err = new Error(`Recall usage ${res.status}: ${t.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  const d = await res.json().catch(() => ({}));
  return { botTotalSeconds: Number(d.bot_total || 0), periodStart: start, periodEnd: end };
}

/**
 * 会議にBotを送り込み、リアルタイム文字起こしをWebhookで受け取る設定で作成。
 * @returns {Promise<string>} botId
 */
// 文字起こしエンジンを選ぶ。RECALL_TRANSCRIBE_PROVIDER = recallai | deepgram | gladia
// 日本語を低遅延にしたいなら deepgram か gladia を推奨。
function buildProvider(provider, languageCode, deepgramModel, mode) {
  const p = (provider || "recallai").toLowerCase();
  if (p === "deepgram") {
    return {
      deepgram_streaming: {
        language: languageCode, // 例: ja
        model: deepgramModel || "nova-2",
        mip_opt_out: true, // 学習に使わせない（機密配慮）
      },
    };
  }
  if (p === "gladia") {
    return { gladia_streaming: {} };
  }
  // 既定: Recall標準（英語以外は accuracy モード）
  return { recallai_streaming: { mode, language_code: languageCode } };
}

export async function createBot({
  meetingUrl,
  webhookUrl,
  languageCode = "ja",
  botName = "議事録",
  provider = "recallai",
  deepgramModel = "nova-2",
  joinAt = null, // ISO文字列。指定すると予約入室（例: 開始3分前）
  rtmpUrl = null, // 指定するとミックス映像+音声をRTMPでライブ配信（Mux等）
  videoLayout = "gallery_view_v2",
  speak = false,   // true にすると、かささぎがこのボットで喋れるようになる
  faceUrl = null,  // スライドを映すページのURL（かささぎ用）
}) {
  // recallai_streaming 用：英語以外は accuracy（低遅延は英語のみ対応のため）
  const mode =
    process.env.RECALL_MODE ||
    (String(languageCode).toLowerCase().startsWith("en")
      ? "prioritize_low_latency"
      : "prioritize_accuracy");

  const realtimeEndpoints = [
    {
      type: "webhook",
      url: webhookUrl,
      events: [
        "transcript.data", "transcript.partial_data",
        // 会議のチャット。かささぎを止める合図（「かささぎストップ」）を受ける。
        "participant_events.chat_message",
      ],
    },
  ];
  if (rtmpUrl) {
    // v1.11: ミックス映像+音声のRTMP配信は video_mixed_flv を有効化し、
    // rtmpエンドポイントで video_mixed_flv.data を購読する必要がある
    realtimeEndpoints.push({
      type: "rtmp",
      url: rtmpUrl,
      events: ["video_mixed_flv.data"],
    });
    // 配信先の形をログに残す（鍵は伏せる）。届かないときの切り分けに使う。
    try {
      const u = new URL(rtmpUrl);
      console.log(`[live] 配信先 ${u.protocol}//${u.host}${u.pathname.replace(/[^/]+$/, "***")}`);
    } catch { console.log("[live] 配信先の形式が不正です"); }
  }

  // 無駄な課金を防ぐ：誰も来ない・全員退出した会議から自動で出る
  // （Recallは「ボットが会議にいた時間」で課金されるため、待ちっぱなしが積み上がる）
  const secs = (v, def) => Math.max(30, Number(process.env[v] || def));
  const automaticLeave = {
    waiting_room_timeout: secs("RECALL_WAIT_ROOM_SEC", 420),               // 待機室で7分待って入れなければ退出
    noone_joined_timeout: secs("RECALL_NOONE_SEC", 420),                   // 誰も来なければ7分で退出
    everyone_left_timeout: secs("RECALL_EVERYONE_LEFT_SEC", 30),           // 全員退出したら30秒で退出（一時的な回線切れで録音が切れないための余裕）
    in_call_not_recording_timeout: secs("RECALL_NOT_RECORDING_SEC", 600),  // 録音できないまま10分たったら退出
    recording_permission_denied_timeout: secs("RECALL_PERM_DENIED_SEC", 120),
  };

  const body = {
    meeting_url: meetingUrl,
    bot_name: botName,
    automatic_leave: automaticLeave,
    ...(joinAt ? { join_at: joinAt } : {}),
    recording_config: {
      // 後から再生できる録画（ミックスmp4）を必ず生成する
      video_mixed_mp4: {},
      transcript: {
        provider: buildProvider(provider, languageCode, deepgramModel, mode),
        // 参加者ごとに別ストリーム＝正確な話者分離（話者名が付く）
        diarization: { use_separate_streams_when_available: true },
      },
      ...(rtmpUrl ? { video_mixed_flv: {}, video_mixed_layout: videoLayout } : {}),
      realtime_endpoints: realtimeEndpoints,
    },
    // かささぎ（AIが会議で喋る）を使うときは、音声を出せる作りのボットにする。
    // Recallは output_audio を使う場合に web_4_core の指定が必要。
    ...(speak
      ? { variant: { zoom: "web_4_core", google_meet: "web_4_core", microsoft_teams: "web_4_core" } }
      : {}),
    // スライドを見せる。音声は Output Audio で別に送る（Output Media 経由の音声は
    // Meetで途切れることが分かっているため、映像と音声は分ける）。
    ...(faceUrl ? { output_media: { camera: { kind: "webpage", config: { url: faceUrl } } } } : {}),
  };

  // 507（容量一時不足）は数回リトライ推奨
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${BASE}/bot/`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });
    if (res.status === 507) {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      // 残高不足(402)などの理由を抽出して記録（画面に「残高不足」等を出すため）
      let code = "";
      try { code = (JSON.parse(t) || {}).code || ""; } catch {}
      recordCreate({ ok: false, status: res.status, code, detail: t.slice(0, 300) });
      throw new Error(`Recall create bot ${res.status}: ${t.slice(0, 300)}`);
    }
    const data = await res.json();
    recordCreate({ ok: true, status: res.status, code: "", detail: "" });
    return data.id;
  }
  throw new Error("Recall create bot: 容量不足(507)が続いたため作成できませんでした");
}

/** Botを会議から退出させる */
// 会議でボットに喋らせる（かささぎ用）。
// mp3のbase64を渡すと、Recallがボットのマイクから流してくれる。
export async function outputAudio(botId, b64Mp3, kind = "mp3") {
  if (!botId) throw new Error("botIdがありません");
  if (!b64Mp3) throw new Error("音声データがありません");
  const res = await fetch(`${BASE}/bot/${botId}/output_audio/`, {
    method: "POST",
    headers: { ...headers(), "content-type": "application/json" },
    body: JSON.stringify({ kind, b64_data: b64Mp3 }),
  });
  if (!res.ok) {
    const t = await res.text();
    const err = new Error(`音声の出力 ${res.status}: ${t.slice(0, 300)}`);
    // ボットの作り方が音声出力に対応していない場合はここに来る
    if (res.status === 400 && /output|media|variant/i.test(t)) err.needOutputMedia = true;
    throw err;
  }
  return res.json().catch(() => ({}));
}

// 流している音声を止める
export async function stopOutputAudio(botId) {
  if (!botId) return;
  try {
    await fetch(`${BASE}/bot/${botId}/output_audio/`, { method: "DELETE", headers: headers() });
  } catch (e) { console.warn("[recall] 音声の停止に失敗", e.message); }
}

// 会議のチャットに文字で送る（音声が使えないときの代わり）
export async function sendChatMessage(botId, text) {
  if (!botId || !text) return;
  const res = await fetch(`${BASE}/bot/${botId}/send_chat_message/`, {
    method: "POST",
    headers: { ...headers(), "content-type": "application/json" },
    body: JSON.stringify({ message: String(text).slice(0, 900) }),
  });
  if (!res.ok) throw new Error(`チャット送信 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json().catch(() => ({}));
}

export async function leaveBot(botId) {
  try {
    await fetch(`${BASE}/bot/${botId}/leave_call/`, {
      method: "POST",
      headers: headers(),
    });
  } catch (e) {
    console.error("[recall] leave error", e.message);
  }
}

/** 単語配列を文字列へ。日本語は無スペース、英数字どうしの境界だけスペースを入れる */
function joinWords(words) {
  let out = "";
  for (const w of words) {
    const t = w?.text ?? "";
    if (out && /[A-Za-z0-9]$/.test(out) && /^[A-Za-z0-9]/.test(t)) out += " ";
    out += t;
  }
  return out;
}

/**
 * Webhook ボディから文字起こしイベントを取り出す。
 * @returns {null | {type:'final'|'partial', botId:string, speaker:{id,name}, text:string}}
 */
// 会議のチャットを1件取り出す（かささぎを止める合図に使う）
export function parseChatEvent(body) {
  if (body?.event !== "participant_events.chat_message") return null;
  const d = body?.data?.data || body?.data || {};
  const text = String(d.text || d.message || "").trim();
  if (!text) return null;
  const p = d.participant || {};
  return {
    botId: body?.data?.bot?.id || body?.data?.bot_id || null,
    speaker: { id: p.id ?? null, name: p.name ?? null },
    text,
  };
}

export function parseTranscriptEvent(body) {
  const event = body?.event;
  if (event !== "transcript.data" && event !== "transcript.partial_data") return null;
  const d = body?.data?.data || {};
  const words = Array.isArray(d.words) ? d.words : [];
  const text = joinWords(words);
  if (!text) return null;
  const p = d.participant || {};
  // 録画の先頭からの秒数（あれば）。動画の頭出しに使う。
  let off = null;
  const w0 = words[0];
  if (w0) {
    const st = w0.start_timestamp;
    if (typeof st === "number") off = st;
    else if (st && typeof st.relative === "number") off = st.relative;
    else if (typeof w0.start_time === "number") off = w0.start_time;
  }
  return {
    type: event === "transcript.data" ? "final" : "partial",
    botId: body?.data?.bot?.id,
    speaker: { id: p.id ?? null, name: p.name ?? null },
    text,
    off: typeof off === "number" && isFinite(off) ? Math.max(0, Math.round(off)) : null,
  };
}

/** Botの詳細を取得（録画URLの取り出しに使う） */
export async function getBot(botId) {
  const res = await fetch(`${BASE}/bot/${botId}/`, { headers: headers() });
  if (!res.ok) throw new Error(`Recall get bot ${res.status}`);
  return res.json();
}

/** Botの文字起こしを取る（取り込み直し用）。[{speaker:{name}, text, start}] の形にそろえる */
export async function getBotTranscript(botId) {
  const data = await getBot(botId).catch(() => null);
  // v1.11：recordings[].media_shortcuts.transcript.data.download_url からJSONを取る
  const recs = Array.isArray(data?.recordings) ? data.recordings : [];
  let url = "";
  for (const r of recs) {
    const t = (r?.media_shortcuts || {}).transcript;
    const u = t?.data?.download_url;
    if (typeof u === "string" && /^https?:\/\//.test(u)) { url = u; break; }
  }
  let raw = null;
  if (url) {
    const res = await fetch(url).catch(() => null);
    if (res && res.ok) raw = await res.json().catch(() => null);
  }
  if (!raw) {
    // 旧エンドポイントも試す
    const res = await fetch(`${BASE}/bot/${botId}/transcript/`, { headers: headers() }).catch(() => null);
    if (res && res.ok) raw = await res.json().catch(() => null);
  }
  if (!raw) return [];
  const out = [];
  const push = (name, text, start) => { const t = String(text || "").trim(); if (t) out.push({ speaker: { name: name || "" }, text: t, start: start ?? null }); };
  const arr = Array.isArray(raw) ? raw : (Array.isArray(raw.transcript) ? raw.transcript : []);
  for (const seg of arr) {
    const name = seg?.participant?.name || seg?.speaker || seg?.speaker_name || "";
    if (Array.isArray(seg?.words) && seg.words.length) {
      push(name, seg.words.map((w) => w.text ?? w.word ?? "").join(""), seg.words[0]?.start_timestamp?.relative ?? seg.words[0]?.start_time);
    } else {
      push(name, seg?.text ?? seg?.transcript ?? "", seg?.start_time ?? seg?.start_timestamp?.relative);
    }
  }
  return out;
}

/** Botの応答から録画(動画)URLを最善努力で探す（スキーマ差異に強く） */
export async function getRecordingUrl(botId) {
  const data = await getBot(botId);

  // 1) v1.11 の標準位置を明示的に探す: recordings[].media_shortcuts.video_mixed.data.download_url
  const recs = Array.isArray(data?.recordings) ? data.recordings : [];
  for (const r of recs) {
    const ms = r?.media_shortcuts || {};
    const vm = ms.video_mixed || ms.video_mixed_mp4 || null;
    const url = vm?.data?.download_url;
    if (typeof url === "string" && /^https?:\/\//.test(url)) return url;
  }

  // 2) 旧スキーマ等のフォールバック: オブジェクトを走査して mp4/download_url を探す
  let found = null;
  (function walk(o) {
    if (found || o == null) return;
    if (typeof o === "string") {
      if (/^https?:\/\/.+\.mp4/i.test(o)) found = o;
      return;
    }
    if (Array.isArray(o)) return o.forEach(walk);
    if (typeof o === "object") {
      for (const [k, v] of Object.entries(o)) {
        if (found) break;
        if (
          typeof v === "string" &&
          /^https?:\/\//.test(v) &&
          /(download_url|\.mp4|video)/i.test(k + " " + v)
        ) {
          found = v;
          break;
        }
        walk(v);
      }
    }
  })(data);
  return found;
}
