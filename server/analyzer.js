// server/analyzer.js
// 要約・提案を生成。LLM_PROVIDER で gemini / anthropic / ollama を切替。
const PROVIDER = (process.env.LLM_PROVIDER || "gemini").toLowerCase();

// --- ライブ中の「要約＋次の一手」 ---
const LIVE_PROMPT = `あなたは B2B 商談に同席するベテランの営業コーチです。
発言は「話者名: 内容」の形で渡されます（話者分離は正確です）。
あなたが支援する自社の営業担当の名前は user メッセージ内で指定されます。

必ず次の JSON のみを出力（前置き・コードフェンス禁止）:
{
  "summary": {
    "overview": "商談全体の状況を2〜3文で",
    "key_points": ["論点や重要発言"],
    "agreements": ["合意・確定事項"],
    "action_items": ["宿題・次アクション"],
    "customer_concerns": ["相手の懸念・不安・反対の兆候"]
  },
  "suggestions": [
    { "type": "question | objection | closing | risk | info", "title": "12文字程度", "detail": "今すぐ使える具体策を1〜2文" }
  ]
}
ルール: suggestionsは最大3件。直近を重視。憶測で事実を作らない。日本語で簡潔に。`;

// --- 商談後の「要約＋営業フィードバック」 ---
const REVIEW_PROMPT = `あなたは B2B 営業のベテランマネージャーです。
商談の文字起こし（「話者名: 内容」形式、話者分離は正確）を読み、
自社の営業担当（user で指定）への振り返りを行います。

必ず次の JSON のみを出力（前置き・コードフェンス禁止）:
{
  "summary": {
    "overview": "商談全体の状況を3〜4文で",
    "key_points": ["論点・重要発言"],
    "agreements": ["合意・確定事項"],
    "action_items": ["宿題・次アクション"],
    "customer_concerns": ["相手の懸念・反対の兆候"]
  },
  "feedback": {
    "overall": "営業担当のパフォーマンス総評を3〜4文で。良し悪しを率直に",
    "good_points": ["良かった点（具体的な発言や対応を引用気味に）"],
    "improvements": ["改善点（次はこうするとよい、を具体的に）"],
    "missed": ["見落とし・機会損失（拾えなかった購買シグナルや未確認事項）"],
    "next_steps": ["次回までにやるべきこと"]
  }
}
ルール: 具体的に、実際の発言に基づいて。褒めるだけでなく改善も率直に。憶測で事実を作らない。日本語で。`;

export function analyzerInfo() {
  return { provider: PROVIDER, model: modelFor() };
}
function modelFor() {
  if (PROVIDER === "anthropic") return process.env.ANALYZER_MODEL || "claude-sonnet-4-6";
  if (PROVIDER === "ollama") return process.env.OLLAMA_MODEL || "qwen2.5";
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

// ライブ：要約＋次の一手
export async function analyze({ transcript, prevSummary, repName }) {
  const user =
    `自社の営業担当（支援対象）: ${repName || "（未指定）"}\n\n` +
    (prevSummary ? `これまでの要約(参考):\n${JSON.stringify(prevSummary)}\n\n` : "") +
    `商談の文字起こし(古い→新しい):\n"""\n${transcript}\n"""\n\n` +
    `最新状況の要約と次の一手を JSON で返してください。`;
  const text = await callLLM(LIVE_PROMPT, user, 1400);
  const o = parseJson(text);
  return {
    summary: o.summary || {},
    suggestions: Array.isArray(o.suggestions) ? o.suggestions : [],
  };
}

// 商談後：要約＋営業フィードバック（履歴画面から）
export async function analyzeMeeting({ transcript, repName }) {
  const user =
    `自社の営業担当: ${repName || "（未指定）"}\n\n` +
    `商談の文字起こし:\n"""\n${transcript}\n"""\n\n` +
    `この商談を振り返り、要約と営業フィードバックを JSON で返してください。`;
  const text = await callLLM(REVIEW_PROMPT, user, 2200);
  const o = parseJson(text);
  return { summary: o.summary || {}, feedback: o.feedback || {} };
}

// ---- プロバイダ振り分け ----
async function callLLM(system, user, maxTokens = 1400) {
  if (PROVIDER === "anthropic") return callAnthropic(system, user, maxTokens);
  if (PROVIDER === "ollama") return callOllama(system, user);
  return callGemini(system, user, maxTokens);
}

async function callGemini(system, user, maxTokens) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY が未設定です（Google AI Studio で発行）");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: maxTokens, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
}

async function callAnthropic(system, user, maxTokens) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY が未設定です");
  const model = process.env.ANALYZER_MODEL || "claude-sonnet-4-6";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("");
}

async function callOllama(system, user) {
  const base = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL || "qwen2.5";
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model, stream: false, format: "json",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Ollama ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.message?.content || "";
}

function parseJson(text) {
  let s = (text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
