// server/analyzer.js
// 要約・提案を生成。LLM_PROVIDER で gemini / anthropic / ollama を切替。
import { retrieve } from "./retrieval.js";
import { getSettings } from "./db.js";
const PROVIDER = (process.env.LLM_PROVIDER || "gemini").toLowerCase();

// 抜け漏れチェックの既定項目（設定で上書き可能）
export const DEFAULT_CHECK_ITEMS = [
  "課題・ニーズ",
  "予算",
  "決裁者・決裁プロセス",
  "導入時期",
  "現状・競合（既存の取り組み/比較対象）",
  "次のステップ（合意）",
];
export async function getCheckItems() {
  try {
    const s = await getSettings();
    const a = s && s.checkItems;
    return Array.isArray(a) && a.length ? a.slice(0, 15) : DEFAULT_CHECK_ITEMS;
  } catch {
    return DEFAULT_CHECK_ITEMS;
  }
}

// 商談内容に近い自社ナレッジだけを抽出してプロンプト用ブロックに整形（無ければ空）
async function knowledgeBlock(queryText) {
  try {
    const ctx = await retrieve(queryText, { topK: 6, maxChars: 4000 });
    if (!ctx) return "";
    return (
      `\n【自社ナレッジ（関連箇所のみ）】(提案・異議対応・御礼メールの根拠に使う。ここに無い事実は作らない)\n` +
      `"""\n${ctx}\n"""\n`
    );
  } catch {
    return "";
  }
}

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
  "coverage": [
    { "item": "（userメッセージで与えられたチェック項目名をそのまま）", "status": "covered | partial | missing", "note": "聞けた内容、または『まだ何が不明か/何を聞くべきか』を短く" }
  ],
  "objections": [
    { "objection": "相手が示した懸念・不安・反対（要約。例: 価格が高い / 他社と比較中 / 今は不要 / 効果が不明）", "response": "その懸念に刺さる切り返しトークを1〜2文（自社ナレッジを根拠に）", "basis": "根拠（ナレッジの事実・数字など。無ければ空文字）" }
  ],
  "landed": [
    { "text": "営業の発言で相手に刺さった/響いたトークの要約", "why": "なぜ刺さったか（相手の反応など）を一言" }
  ],
  "suggestions": [
    { "type": "question | objection | closing | info", "title": "12文字程度", "detail": "今すぐ使える具体策を1〜2文" }
  ]
}
ルール:
- coverage は user メッセージの「チェック項目」を全て、その項目名のまま返す。確認できていれば covered、断片的なら partial、未確認なら missing。note は未確認なら「何を聞くべきか」を一言。
- objections は相手が懸念・不安・反対を示した場合に、それぞれ「懸念」と「刺さる言い返しトーク」をセットで最大3件。該当が無ければ空配列 []。切り返しは自社ナレッジを根拠に、無い情報は作らない。
- landed は営業の発言で明確に相手へ刺さった/前向きな反応を引き出したトークがあれば最大2件。無ければ空配列 []。
- suggestions は最大3件。直近を重視。
- 憶測で事実を作らない。日本語で簡潔に。`;

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
    "action_items": ["宿題・次アクション（誰が・いつまでに・何を、が分かるように）"],
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
ルール: 実際に話された情報だけを使う。話題に出ていないことは推測で作らない。具体的に、率直に。日本語で。`;

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

// ライブ：要約＋次の一手＋チェック＋異議対応
export async function analyze({ transcript, prevSummary, repName }) {
  const know = await knowledgeBlock(String(transcript || "").slice(-2000));
  const items = await getCheckItems();
  const user =
    `自社の営業担当（支援対象）: ${repName || "（未指定）"}\n` +
    `チェック項目（このリストの各項目を coverage で評価。項目名はそのまま使う）: ${JSON.stringify(items)}\n` +
    know +
    (prevSummary ? `\nこれまでの要約(参考):\n${JSON.stringify(prevSummary)}\n` : "") +
    `\n商談の文字起こし(古い→新しい):\n"""\n${transcript}\n"""\n\n` +
    `最新状況の要約・チェック充足・異議対応・次の一手を JSON で返してください。異議対応/提案は自社ナレッジを根拠に。`;
  const text = await callLLM(LIVE_PROMPT, user, 1800);
  const o = parseJson(text);
  return {
    summary: o.summary || {},
    coverage: Array.isArray(o.coverage) ? o.coverage : [],
    objections: Array.isArray(o.objections) ? o.objections : [],
    landed: Array.isArray(o.landed) ? o.landed : [],
    suggestions: Array.isArray(o.suggestions) ? o.suggestions : [],
  };
}

// 商談後：要約＋営業フィードバック（履歴画面から）
export async function analyzeMeeting({ transcript, repName, dateStr, speakers }) {
  const ctx = [];
  if (dateStr) ctx.push(`日時: ${dateStr}`);
  if (speakers && speakers.length) ctx.push(`参加者（話者名）: ${speakers.join("、")}`);
  ctx.push(`自社の営業担当: ${repName || "（未指定）"}`);
  const know = await knowledgeBlock(String(transcript || "").slice(-3000));
  const user =
    ctx.join("\n") +
    know +
    `\n\n商談の文字起こし:\n"""\n${transcript}\n"""\n\n` +
    `この商談を、指定テンプレートの要約と営業フィードバックとして JSON で返してください。話された情報だけを使ってください。改善提案は自社ナレッジを踏まえて。`;
  const text = await callLLM(REVIEW_PROMPT, user, 2400);
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
  "deal_status": "進行中 | 受注 | 失注 | 保留 のいずれか1つ（この商談時点での案件の状態を推定）",
  "deal_status_reason": "その判断の根拠を商談内の事実で1文",
  "rep_habits": ["営業担当の話し方の癖・口癖（例:『えーと』が多い、専門用語が多い、一方的になりがち 等）。具体的に"],
  "customer_reactions": ["顧客の反応の特徴（前向き／慎重／価格に敏感 など）。具体的な発言を踏まえて"],
  "coaching": ["実際の発言を引用しつつ、次はこうすると良いという助言"]
}
ルール: scores は各1〜5の整数（hearing=ヒアリング, proposal=提案, closing=クロージング, listening=傾聴）。
score_reasons は各スコアの根拠を必ず書く。事実に基づき、憶測で作らない。該当が無ければ空配列や『未確認』。
deal_status は: 受注=契約/発注が確定、失注=断られた/見送り/競合決定、保留=長期停滞や優先度低下が明確、それ以外は進行中。明確な根拠がなければ「進行中」。日本語で簡潔に。`;

export const PHASE_GUIDE = {
  "01": "フェーズ01（初回商談）。重視点: 関係構築、相手の課題/状況のヒアリング、自社の価値の初期提示、次回につなげるアポ設定。",
  "02": "フェーズ02（有効商談）。重視点: 課題・ニーズが本物かの見極め、予算/時期/必要性の確認、提案価値のすり合わせ、案件化の手応え。",
  "03": "フェーズ03（担当者合意）。重視点: 窓口担当者の合意形成、懸念・反論への対応、社内へ上げてもらうための材料提供、意思決定プロセスの把握。",
  "04": "フェーズ04（企画決定者合意）。重視点: 決裁者の合意・承認、最終条件の調整、不安の解消、契約・導入に向けた具体的な次アクションの確定。",
};

export async function analyzeDeep({ transcript, repName, phase, lostSignals }) {
  const phaseNote = phase && PHASE_GUIDE[phase]
    ? `\nこの商談の営業フェーズ: ${PHASE_GUIDE[phase]}\nコーチングと next_step は、このフェーズで特に重要な観点を優先して評価してください。\n`
    : "";
  const lostNote = Array.isArray(lostSignals) && lostSignals.length
    ? `\n【過去の失注に多かった予兆（参考）】これらに該当する発言・状況があれば deal_status の判定で重視してください:\n` +
      lostSignals.slice(0, 12).map((g) => `- ${g.phrase}${g.why ? "（" + g.why + "）" : ""}`).join("\n") + "\n"
    : "";
  const user =
    `自社の営業担当: ${repName || "（未指定）"}\n` +
    phaseNote + lostNote +
    `\n商談の文字起こし:\n"""\n${transcript}\n"""\n\n` +
    `この商談を多角的に分析し、JSON で返してください。`;
  const text = await callLLM(DEEP_PROMPT, user, 2500);
  return parseJson(text);
}

// 過去の失注商談から「失注の予兆フレーズ/状況」を抽出
const LOST_SIGNAL_PROMPT = `あなたは B2B 営業の失注分析の専門家です。
複数の「失注した商談」のデータ（要約・懸念・対応など）を読み、顧客側に現れた“失注につながる予兆”を、現場で見分けられる具体的な形で抽出します。
必ず次の JSON のみ出力（前置き・コードフェンス禁止）:
{ "signals": [ { "phrase": "顧客が言いがち/起きがちな失注の予兆（具体的な発言例や状況。例:『社内で持ち帰って検討します』が繰り返される / 予算が今期は取れない / 既に他社で進めている）", "why": "なぜ失注につながるかを一言" } ] }
signals は5〜10件。データに根ざし、汎用的すぎる一般論は避ける。日本語で簡潔に。`;
export async function extractLostSignals({ lostMaterial }) {
  const user = `失注した商談のデータ:\n"""\n${lostMaterial || "（データなし）"}\n"""\n\n失注の予兆を JSON で抽出してください。`;
  const text = await callLLM(LOST_SIGNAL_PROMPT, user, 1500);
  const o = parseJson(text);
  return Array.isArray(o.signals) ? o.signals : [];
}

// ---- プロバイダ振り分け ----
function isTransient(msg) {
  return /\b503\b|\b429\b|UNAVAILABLE|overloaded|high demand|temporarily/i.test(msg || "");
}
// 一次プロバイダが混雑等で落ちた時の切替先（Groqキーがあれば既定でGroq）
function fallbackProvider() {
  const explicit = (process.env.FALLBACK_PROVIDER || "").toLowerCase();
  if (explicit && explicit !== PROVIDER) return explicit;
  if (PROVIDER !== "groq" && process.env.GROQ_API_KEY) return "groq";
  return "";
}

async function callLLM(system, user, maxTokens = 1400) {
  try {
    return await withRetry(() => callOnce(PROVIDER, system, user, maxTokens));
  } catch (e) {
    const fb = fallbackProvider();
    if (fb && isTransient(e.message)) {
      console.warn(`[llm] ${PROVIDER} が混雑等で失敗（${e.message}）→ ${fb} に自動フォールバック`);
      return await withRetry(() => callOnce(fb, system, user, maxTokens), 2);
    }
    throw e;
  }
}

// 503/UNAVAILABLE/overloaded など一時的な混雑は自動リトライ
async function withRetry(fn, tries = 4) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < tries - 1 && isTransient(e.message)) {
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw last;
}

async function callOnce(provider, system, user, maxTokens) {
  if (provider === "anthropic") return callAnthropic(system, user, maxTokens);
  if (provider === "ollama") return callOllama(system, user);
  if (provider === "groq")
    return callOpenAICompat(system, user, maxTokens, {
      base: "https://api.groq.com/openai/v1",
      key: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      name: "Groq",
    });
  if (provider === "openai")
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

// 勝ち負け分析：失注案件 vs 進行/受注案件 の傾向を比較
const WINLOSS_PROMPT = `あなたは B2B 営業の分析責任者です。
「失注した案件」と「進行中／受注の案件」それぞれに属する複数商談の特徴データ（要約・スコア・営業のトーク比率・購買/リスク兆候・懸念・口癖など）を比較し、
何が勝ち負けを分けているかを、事実に基づいて言語化します。憶測や一般論ではなく、渡されたデータに根ざした具体的な傾向を抽出してください。

必ず次の JSON のみを出力（前置き・コードフェンス禁止）:
{
  "lost_patterns": ["失注案件に共通して見られる傾向（行動・会話・状況の特徴）"],
  "active_patterns": ["進行中／受注案件に共通して見られる傾向"],
  "key_differences": ["勝ち負けを分けている決定的な違い（対比で）"],
  "recommendations": ["明日からの商談で実践できる具体的な打ち手"]
}
各配列は3〜6件、日本語で簡潔に。データが少ない場合は断定を避け、その旨を含める。`;

export async function analyzeWinLoss({ lostMaterial, activeMaterial, lostCount, activeCount, filterDesc }) {
  const user =
    `対象範囲: ${filterDesc || "（指定なし）"}\n` +
    `失注案件: ${lostCount}件 ／ 進行中・受注案件: ${activeCount}件\n\n` +
    `■ 失注した案件の商談データ:\n"""\n${lostMaterial || "（データなし）"}\n"""\n\n` +
    `■ 進行中・受注の案件の商談データ:\n"""\n${activeMaterial || "（データなし）"}\n"""\n\n` +
    `両者を比較し、勝ち負けの傾向と打ち手を JSON でまとめてください。`;
  const text = await callLLM(WINLOSS_PROMPT, user, 2200);
  return parseJson(text);
}

// 御礼メール生成（例文をほぼそのまま使い、商談の悩み＋マッチ訴求を3行ほど差し込む）
const THANKS_PROMPT = `あなたは法人営業の担当者です。商談後の「御礼メール」を作成します。
これは商談「{round}回目」へのお礼メールです。

最重要ルール:
- 渡された過去のお礼メール例（例文）を【ベースとしてほぼそのまま使う】。文面・構成・あいさつ・締めは極力変えない。
- 変更は最小限。本文の中ほどに、今回の商談に合わせた【3行程度】だけを差し込む:
  (1) 今回ヒアリングした相手の悩み・課題（実際に話に出たものだけ。具体的に）
  (2) その悩みに対して、当サービスが非常にマッチしている、という前向きな一文
- 例文に無い余計な段落を増やさない。長くしない。事実を捏造しない（話していない悩みは書かない）。
- 例文が無い場合のみ、標準的で丁寧な短いお礼メールを作り、その中に上記3行を入れる。
- 宛名・差出人など不明な箇所は [〇〇] のプレースホルダにする。

必ず次の JSON のみを出力（前置き・コードフェンス禁止）:
{ "subject": "件名", "body": "本文（改行は\\n）" }
日本語で。`;

export async function generateThanks({ round, examples, summaryText, repName, customer }) {
  const exBlock =
    examples && examples.length
      ? examples.map((e, i) => `【例${i + 1}】\n${e}`).join("\n\n")
      : "（例なし。標準的で丁寧な法人営業のお礼メールの体裁で作成）";
  const know = await knowledgeBlock(String(summaryText || "").slice(-2000));
  const user =
    `商談ラウンド: ${round || "不明"}回目\n` +
    `自社担当: ${repName || "[自社担当]"}\n` +
    `相手（顧客）: ${customer || "[相手担当者]"}\n` +
    know +
    `\n過去のお礼メール例（同ラウンド）:\n"""\n${exBlock}\n"""\n\n` +
    `今回の商談内容（要約）:\n"""\n${(summaryText || "").slice(-6000)}\n"""\n\n` +
    `上記の文体に合わせ、今回の商談内容に基づくお礼メールを JSON で作成してください。サービス適合の一文は自社ナレッジを根拠に。`;
  const text = await callLLM(THANKS_PROMPT.replace(/\{round\}/g, String(round || "")), user, 1400);
  return parseJson(text);
}
