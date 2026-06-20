// server/config.js
import { getSettings, getUserSettings, dbEnabled } from "./db.js";
import { analyzerInfo } from "./analyzer.js";

function envDefaults() {
  return {
    botName: process.env.BOT_NAME || "議事録",
    languageCode: process.env.LANGUAGE_CODE || "ja",
    transcribeProvider: (process.env.RECALL_TRANSCRIBE_PROVIDER || "recallai").toLowerCase(),
    deepgramModel: process.env.DEEPGRAM_MODEL || "nova-2",
    analyzeIntervalMs: Number(process.env.ANALYZE_INTERVAL_MS || 20000),
    repName: "",
  };
}

// 環境既定 ← 全体設定(旧/共有の既定) ← ユーザー個別設定 の順に上書き
export async function resolveConfig(owner) {
  const global = await getSettings();
  const user = owner ? await getUserSettings(owner) : {};
  return { ...envDefaults(), ...clean(global), ...clean(user) };
}

function clean(o) {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) {
    if (v !== "" && v != null) out[k] = v;
  }
  return out;
}

// 設定画面に出す状態（読み取り専用）
export function statusInfo(publicUrl) {
  const llm = analyzerInfo();
  return {
    llmProvider: llm.provider,
    llmModel: llm.model,
    dbEnabled: dbEnabled(),
    publicUrl: publicUrl || "(未設定)",
    muxConfigured: !!(process.env.MUX_TOKEN_ID && process.env.MUX_TOKEN_SECRET),
  };
}
