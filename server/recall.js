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
}) {
  // recallai_streaming 用：英語以外は accuracy（低遅延は英語のみ対応のため）
  const mode =
    process.env.RECALL_MODE ||
    (String(languageCode).toLowerCase().startsWith("en")
      ? "prioritize_low_latency"
      : "prioritize_accuracy");

  const body = {
    meeting_url: meetingUrl,
    bot_name: botName,
    ...(joinAt ? { join_at: joinAt } : {}),
    recording_config: {
      transcript: {
        provider: buildProvider(provider, languageCode, deepgramModel, mode),
        // 参加者ごとに別ストリーム＝正確な話者分離（話者名が付く）
        diarization: { use_separate_streams_when_available: true },
      },
      realtime_endpoints: [
        {
          type: "webhook",
          url: webhookUrl,
          events: ["transcript.data", "transcript.partial_data"],
        },
      ],
    },
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
      throw new Error(`Recall create bot ${res.status}: ${t.slice(0, 300)}`);
    }
    const data = await res.json();
    return data.id;
  }
  throw new Error("Recall create bot: 容量不足(507)が続いたため作成できませんでした");
}

/** Botを会議から退出させる */
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
export function parseTranscriptEvent(body) {
  const event = body?.event;
  if (event !== "transcript.data" && event !== "transcript.partial_data") return null;
  const d = body?.data?.data || {};
  const words = Array.isArray(d.words) ? d.words : [];
  const text = joinWords(words);
  if (!text) return null;
  const p = d.participant || {};
  return {
    type: event === "transcript.data" ? "final" : "partial",
    botId: body?.data?.bot?.id,
    speaker: { id: p.id ?? null, name: p.name ?? null },
    text,
  };
}

/** Botの詳細を取得（録画URLの取り出しに使う） */
export async function getBot(botId) {
  const res = await fetch(`${BASE}/bot/${botId}/`, { headers: headers() });
  if (!res.ok) throw new Error(`Recall get bot ${res.status}`);
  return res.json();
}

/** Botの応答から録画(動画)URLを最善努力で探す（スキーマ差異に強く） */
export async function getRecordingUrl(botId) {
  const data = await getBot(botId);
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
