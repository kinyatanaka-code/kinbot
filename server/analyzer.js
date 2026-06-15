// server/analyzer.js
// 要約・提案を生成。LLM_PROVIDER で gemini / anthropic / ollama を切替。
//   gemini   : Google AI Studio の無料APIキー（GEMINI_API_KEY）
//   anthropic: Claude（ANTHROPIC_API_KEY）
//   ollama   : ローカルLLM（OLLAMA_URL, OLLAMA_MODEL）

const PROVIDER = (process.env.LLM_PROVIDER || "gemini").toLowerCase();

const SYSTEM_PROMPT = `あなたは B2B 商談に同席するベテランの営業コーチです。
発言は「話者名: 内容」の形で渡されます（話者分離は正確です）。
あなたが支援する自社の営業担当の名前は user メッセージ内で指定されます。
その担当が今すぐ使える支援を返します。

必ず次の JSON のみを出力（前置き・コードフェンス禁止）:
{
  "summary": {
    "overview": "商談全体の状況を2〜3文で",
    "key_points": ["論点や重要発言"],
    "agreements": ["合意・確定事項"],
    "action_items": ["宿題・次アクション（担当が分かれば添える）"],
    "customer_concerns": ["相手の懸念・不安・反対の兆候"]
  },
  "suggestions": [
    {
      "type": "question | objection | closing | risk | info",
      "title": "12文字程度の見出し",
      "detail": "自社担当が今すぐ言える/動ける具体策を1〜2文。発話例があれば「」で示す"
    }
  ]
}

ルール:
- suggestions は今この瞬間に最も効くものを最大3件。少なければ少なくてよい。
- 直近の会話に重きを置く。憶測で事実を作らない。
- type: question=深掘り質問, objection=反論/懸念への切り返し,
  closing=前進/クロージングの好機, risk=見落とし・失注リスク, info=補足すべき情報。
- 日本語で、商談中にちらっと見て使える簡潔さで。`;

function buildUser({ transcript, prevSummary, repName }) {
  return (
    `自社の営業担当（支援対象）: ${repName || "（未指定）"}\n\n` +
    (prevSummary ? `これまでの要約(参考):\n${JSON.stringify(prevSummary)}\n\n` : "") +
    `商談の文字起こし(古い→新しい):\n"""\n${transcript}\n"""\n\n` +
    `最新状況の要約と次の一手を JSON で返してください。`
  );
}

export function analyzerInfo() {
  return { provider: PROVIDER, model: modelFor() };
}
function modelFor() {
  if (PROVIDER === "anthropic") return process.env.ANALYZER_MODEL || "claude-sonnet-4-6";
  if (PROVIDER === "ollama") return process.env.OLLAMA_MODEL || "qwen2.5";
  return process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

export async function analyze({ transcript, prevSummary, repName }) {
  const system = SYSTEM_PROMPT;
  const user = buildUser({ transcript, prevSummary, repName });
  let text;
  if (PROVIDER === "anthropic") text = await callAnthropic(system, user);
  else if (PROVIDER === "ollama") text = await callOllama(system, user);
  else text = await callGemini(system, user);
  return safeParse(text);
}

// ---- Google Gemini（無料枠） ----
async function callGemini(system, user) {
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
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 1400,
        responseMimeType: "application/json", // JSONで返させる
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
}

// ---- Anthropic Claude ----
async function callAnthropic(system, user) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY が未設定です");
  const model = process.env.ANALYZER_MODEL || "claude-sonnet-4-6";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1400,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("");
}

// ---- Ollama（ローカル・完全無料） ----
async function callOllama(system, user) {
  const base = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL || "qwen2.5";
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Ollama ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.message?.content || "";
}

function safeParse(text) {
  let s = (text || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  try {
    const parsed = JSON.parse(s);
    return {
      summary: parsed.summary || {},
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
    };
  } catch {
    return { summary: {}, suggestions: [] };
  }
}
