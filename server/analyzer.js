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
  if (PROVIDER === "groq") return process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  if (PROVIDER === "openai") return process.env.OPENAI_MODEL || "gpt-4o-mini";
  return process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
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

// 商談後：深掘り分析（スコア・BANT・購買シグナル等）
const DEEP_PROMPT = `あなたは B2B 営業のアナリストです。商談の文字起こし（「話者名: 内容」形式、話者分離は正確）を読み、
自社の営業担当（user で指定）の商談を多角的に評価します。

必ず次の JSON のみを出力（前置き・コードフェンス禁止）:
{
  "scores": { "hearing": 1, "proposal": 1, "closing": 1, "listening": 1 },
  "score_reasons": { "hearing": "そのスコアにした理由を、商談内の事実に基づき1〜2文で", "proposal": "...", "closing": "...", "listening": "..." },
  "bant": { "budget": "確認できた内容、無ければ『未確認』", "authority": "...", "need": "...", "timeline": "..." },
  "needs": ["把握できた相手の課題・ニーズ"],
  "buying_signals": ["前向きな発言・関心の兆候"],
  "objections": ["懸念や反論 → それへの対応の良し悪し を1行で"],
  "next_step": "次アクションが具体的に握れたか（日時・担当・宿題）。曖昧なら指摘",
  "competitors": ["言及された競合（無ければ空配列）"],
  "rep_habits": ["営業担当の話し方の癖・口癖（例:『えーと』が多い、専門用語が多い、一方的になりがち 等）。具体的に"],
  "customer_reactions": ["顧客の反応の特徴（前向き／慎重／価格に敏感 など）。具体的な発言を踏まえて"],
  "coaching": ["実際の発言を引用しつつ、次はこうすると良いという助言"]
}
ルール: scores は各1〜5の整数（hearing=ヒアリング, proposal=提案, closing=クロージング, listening=傾聴）。
score_reasons は各スコアの根拠を必ず書く。事実に基づき、憶測で作らない。該当が無ければ空配列や『未確認』。日本語で簡潔に。`;

export const PHASE_GUIDE = {
  "01": "フェーズ01（初回商談）。重視点: 関係構築、相手の課題/状況のヒアリング、自社の価値の初期提示、次回につなげるアポ設定。",
  "02": "フェーズ02（有効商談）。重視点: 課題・ニーズが本物かの見極め、予算/時期/必要性の確認、提案価値のすり合わせ、案件化の手応え。",
  "03": "フェーズ03（担当者合意）。重視点: 窓口担当者の合意形成、懸念・反論への対応、社内へ上げてもらうための材料提供、意思決定プロセスの把握。",
  "04": "フェーズ04（企画決定者合意）。重視点: 決裁者の合意・承認、最終条件の調整、不安の解消、契約・導入に向けた具体的な次アクションの確定。",
};

export async function analyzeDeep({ transcript, repName, phase }) {
  const phaseNote = phase && PHASE_GUIDE[phase]
    ? `\nこの商談の営業フェーズ: ${PHASE_GUIDE[phase]}\nコーチングと next_step は、このフェーズで特に重要な観点を優先して評価してください。\n`
    : "";
  const user =
    `自社の営業担当: ${repName || "（未指定）"}\n` +
    phaseNote +
    `\n商談の文字起こし:\n"""\n${transcript}\n"""\n\n` +
    `この商談を多角的に分析し、JSON で返してください。`;
  const text = await callLLM(DEEP_PROMPT, user, 2500);
  return parseJson(text);
}

// ---- プロバイダ振り分け ----
async function callLLM(system, user, maxTokens = 1400) {
  return withRetry(() => callOnce(system, user, maxTokens));
}

// 503/UNAVAILABLE/overloaded など一時的な混雑は自動リトライ
async function withRetry(fn, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const transient = /\b503\b|\b429\b|UNAVAILABLE|overloaded|high demand|temporarily/i.test(e.message || "");
      if (i < tries - 1 && transient) {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw last;
}

async function callOnce(system, user, maxTokens) {
  if (PROVIDER === "anthropic") return callAnthropic(system, user, maxTokens);
  if (PROVIDER === "ollama") return callOllama(system, user);
  if (PROVIDER === "groq")
    return callOpenAICompat(system, user, maxTokens, {
      base: "https://api.groq.com/openai/v1",
      key: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      name: "Groq",
    });
  if (PROVIDER === "openai")
    return callOpenAICompat(system, user, maxTokens, {
      base: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      key: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      name: "OpenAI互換",
    });
  return callGemini(system, user, maxTokens);
}

// Groq / Cerebras / OpenRouter / OpenAI など OpenAI互換エンドポイント共通
async function callOpenAICompat(system, user, maxTokens, { base, key, model, name }) {
  if (!key) throw new Error(`${name} のAPIキーが未設定です`);
  const res = await fetch(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`${name} ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "";
}

async function callGemini(system, user, maxTokens) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY が未設定です（Google AI Studio で発行）");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
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

// 担当者の「商談の傾向」を、過去商談の分析結果から合成する
const TENDENCY_PROMPT = `あなたは B2B 営業のコーチです。ある営業担当者の複数商談の分析データ（スコア・コーチング・口癖・顧客反応・懸念など）を渡します。
それらを横断して、その担当者の「傾向」をまとめてください。

必ず次の JSON のみを出力（前置き・コードフェンス禁止）:
{
  "strengths": ["強み（繰り返し見られる良い点）"],
  "weaknesses": ["弱み・改善余地（繰り返し見られる課題）"],
  "habits": ["話し方の癖・口癖の傾向（具体的に）"],
  "customer_tendencies": ["相手（顧客）の反応に見られる傾向"],
  "advice": ["次に伸ばすための具体的アドバイス（優先度の高い順に）"]
}
事実ベースで、複数商談に共通する点を優先。該当が薄ければ空配列。日本語で簡潔に。`;

export async function analyzeTendency({ repName, items }) {
  const lines = items
    .map((it, i) => {
      const a = it.analysis || {};
      const parts = [];
      parts.push(`#${i + 1} 「${it.title || "無題"}」 フェーズ${it.phase || "-"}`);
      if (a.scores) parts.push(`スコア: ヒア${a.scores.hearing ?? "-"}/提案${a.scores.proposal ?? "-"}/クロ${a.scores.closing ?? "-"}/傾聴${a.scores.listening ?? "-"}`);
      if (a.rep_habits?.length) parts.push(`口癖: ${a.rep_habits.join(" / ")}`);
      if (a.customer_reactions?.length) parts.push(`顧客反応: ${a.customer_reactions.join(" / ")}`);
      if (a.objections?.length) parts.push(`懸念対応: ${a.objections.join(" / ")}`);
      if (a.coaching?.length) parts.push(`助言: ${a.coaching.join(" / ")}`);
      return parts.join("\n");
    })
    .join("\n\n");
  const user =
    `営業担当: ${repName || "（未指定）"}\n商談数: ${items.length}\n\n` +
    `各商談の分析データ:\n"""\n${lines.slice(-12000)}\n"""\n\n` +
    `この担当者の傾向を JSON でまとめてください。`;
  const text = await callLLM(TENDENCY_PROMPT, user, 1800);
  return parseJson(text);
}

// 絞り込んだ複数商談を横断して、傾向とスコアの理由をまとめて分析する
const SET_PROMPT = `あなたは B2B 営業のマネージャー兼コーチです。複数商談の内容（要約・分析データ）をまとめて渡します。
対象範囲を横断して、傾向と、平均スコアがその水準になっている理由を分析してください。

必ず次の JSON のみを出力（前置き・コードフェンス禁止）:
{
  "overview": "対象範囲の全体所感（2〜3文）",
  "score_rationale": "ヒアリング/提案/クロージング/傾聴の平均が、その水準になっている理由を、具体的な傾向（何ができていて何が足りないか）から説明",
  "strengths": ["繰り返し見られる強み"],
  "weaknesses": ["繰り返し見られる弱み・改善余地"],
  "habits": ["話し方の癖・口癖の傾向（具体的に）"],
  "customer_tendencies": ["顧客の反応に見られる傾向"],
  "advice": ["優先度の高い改善アドバイス（順に）"]
}
事実ベースで、複数商談に共通する点を優先。該当が薄ければ空配列。日本語で簡潔に。`;

export async function analyzeSet({ material, filterDesc }) {
  const user =
    `対象範囲: ${filterDesc || "（指定なし）"}\n\n` +
    `各商談の内容:\n"""\n${material}\n"""\n\n` +
    `この範囲の傾向とスコアの理由を JSON でまとめてください。`;
  const text = await callLLM(SET_PROMPT, user, 2000);
  return parseJson(text);
}
