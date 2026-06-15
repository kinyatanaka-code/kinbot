// server/recall.js
// Recall.ai Meeting Bot API クライアント。
// 仕様: https://docs.recall.ai/docs/bot-real-time-transcription
// 認証ヘッダは「生のAPIキー」（"Bearer " は付けない）。

const REGION = process.env.RECALL_REGION || "us-west-2";
const BASE = `https://${REGION}.recall.ai/api/v1`;
const API_KEY = process.env.RECALL_API_KEY;

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
export async function createBot({ meetingUrl, webhookUrl, languageCode = "ja" }) {
  const body = {
    meeting_url: meetingUrl,
    recording_config: {
      transcript: {
        provider: {
          // 低遅延モード。日本語は "ja"、自動判定は "auto"
          recallai_streaming: { mode: "prioritize_low_latency", language_code: languageCode },
        },
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
