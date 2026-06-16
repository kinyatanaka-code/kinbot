// server/config.js
import { getSettings, dbEnabled } from "./db.js";
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

// 環境変数の既定に、設定画面で保存した値を上書き
export async function resolveConfig() {
  const saved = await getSettings();
  return { ...envDefaults(), ...clean(saved) };
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
  };
}
