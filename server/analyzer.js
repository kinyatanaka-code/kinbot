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

// 要約の追加指示（設定でユーザーが自由に指定。空なら無し）
export async function getSummaryPrompt() {
  try {
    const s = await getSettings();
    return s && typeof s.summaryPrompt === "string" ? s.summaryPrompt.trim() : "";
  } catch { return ""; }
}

// カスタム分析プロンプト（設定でユーザーが貼り付けた任意のプロンプト。空なら機能オフ）
export async function getCustomPrompt() {
  try {
    const s = await getSettings();
    return s && typeof s.customPrompt === "string" ? s.customPrompt.trim() : "";
  } catch { return ""; }
}

// ユーザー定義プロンプトを、その商談の文字起こしに対して実行する。
// プロンプト内の {transcript}/{文字起こし}/{ここに…挿入} を文字起こしに置換。無ければ末尾に添付。
export async function runCustomAnalysis(transcript, prompt) {
  const p = String(prompt || "").trim();
  if (!p) return "";
  const text = transcriptToText(transcript).slice(0, 45000);
  const ph = /\{\s*(transcript|文字起こし|ここに[^}]*挿入[^}]*)\s*\}/;
  let user;
  if (ph.test(p)) user = p.replace(ph, text);
  else user = `${p}\n\n# 対象の文字起こし\n"""\n${text}\n"""`;
  const sys = "あなたは与えられた指示に厳密に従って商談を分析するアシスタントです。指示に書かれたフォーマット・ルールをそのまま守って出力してください。指示以外の前置きや後書きは加えないでください。";
  return await callLLM(sys, user, 2500, { json: false });
}
function summaryInstructionBlock(instr) {
  if (!instr) return "";
  return (
    `\n【要約の追加指示（設定で指定・要約作成時に最優先で反映）】\n"""\n${String(instr).slice(0, 4000)}\n"""\n` +
    `summary の各項目は、この追加指示のトーン・観点・粒度・書式に従って書くこと。ただし出力JSONの構造とキー名は変更しない。\n`
  );
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
export async function analyze({ transcript, prevSummary, repName, extraItems }) {
  const know = await knowledgeBlock(String(transcript || "").slice(-2000));
  const teamItems = await getCheckItems();
  // この商談の重点（事前ブリーフの「今日詰めるべき点」）を🎯付きで加える
  const extra = (Array.isArray(extraItems) ? extraItems : [])
    .map((x) => "🎯 " + String(x || "").trim())
    .filter((x) => x.length > 3);
  // チーム項目＋商談ごとの重点をマージ（重複除去・上限15）
  const seen = new Set();
  const items = [];
  for (const it of [...teamItems, ...extra]) {
    const k = String(it).replace(/[\s🎯]/g, "");
    if (k && !seen.has(k)) { seen.add(k); items.push(String(it)); }
    if (items.length >= 15) break;
  }
  const user =
    `自社の営業担当（支援対象）: ${repName || "（未指定）"}\n` +
    `チェック項目（このリストの各項目を coverage で評価。項目名はそのまま使う。🎯 はこの商談の重点）: ${JSON.stringify(items)}\n` +
    know +
    summaryInstructionBlock(await getSummaryPrompt()) +
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
    summaryInstructionBlock(await getSummaryPrompt()) +
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

// なんでも分析（自由な質問・指示に対して、対象商談データを根拠に回答）
const FREE_PROMPT = `あなたは B2B 営業データの分析アシスタントです。
渡された複数の商談データ（要約・懸念・スコア・ステータス等）を根拠に、ユーザーの質問や指示に日本語で答えます。
重要:
- 必ず渡されたデータに基づく。憶測で事実を作らない。データで判断できない場合はその旨を述べる。
- 他のAIツールにも貼り付けて使えるよう、見出し・箇条書きを使った読みやすい Markdown で出力する。
- 数字や傾向は可能な範囲で具体的に。最後に「次の打ち手」を簡潔に添える。
出力は本文のみ（コードフェンスや前置きは不要）。`;
export async function freeAnalyze({ question, material, filterDesc }) {
  const user =
    `対象範囲: ${filterDesc || "（指定なし）"}\n\n` +
    `ユーザーの質問・指示:\n"""\n${question}\n"""\n\n` +
    `対象の商談データ:\n"""\n${material || "（データなし）"}\n"""\n\n` +
    `上記データを根拠に、質問に答えてください。`;
  return await callLLM(FREE_PROMPT, user, 2600, { json: false });
}

// ===== 事前ブリーフ（商談前の準備メモ＋想定問答）=====
const BRIEF_PROMPT =
  "あなたはB2B営業の商談準備を支援するコーチです。ある会社との過去の商談記録をもとに、担当者が次回商談の直前に読む『事前ブリーフ』と『想定問答』を作成します。\n" +
  "ルール:\n" +
  "- 記録に書かれている事実だけを根拠にする。書かれていないことを推測で断定しない（自然な範囲の要約は可）。\n" +
  "- 各項目は短く具体的に（1〜2文）。冗長な前置きは書かない。\n" +
  "- recap / open_items / concerns / focus はそれぞれ最大5件。qa は3〜6組。\n" +
  "- open_items は『まだ解決していない宿題・約束・保留事項』。concerns は相手が示した懸念・不安・反対の兆候。focus は次回で必ず前進させるべき論点。\n" +
  "- qa は、この相手から出そうな質問(q)と、過去のやり取りを踏まえた良い回答の要点(a)。\n" +
  "- 記録が乏しく書けない項目は空配列でよい。\n" +
  "- 出力はJSONのみ。前置き・後置き・コードフェンスは不要。";

const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    recap: { type: "array", items: { type: "string" }, description: "前回までの要点（最大5件）" },
    open_items: { type: "array", items: { type: "string" }, description: "未解決の宿題・約束・保留（最大5件）" },
    concerns: { type: "array", items: { type: "string" }, description: "相手の懸念・不安・反対の兆候（最大5件）" },
    focus: { type: "array", items: { type: "string" }, description: "今日詰めるべき点（最大5件）" },
    qa: {
      type: "array",
      items: { type: "object", properties: { q: { type: "string" }, a: { type: "string" } }, required: ["q", "a"] },
      description: "想定問答（3〜6組）",
    },
  },
  required: ["recap", "open_items", "concerns", "focus", "qa"],
};

export async function buildBrief({ company, meetings }) {
  const material = (meetings || []).map((m, i) => {
    const lines = [`# 商談${i + 1}（${m.date || "日付不明"}）${m.title || ""}`];
    if (m.overview) lines.push(`要約: ${m.overview}`);
    if (m.key_points && m.key_points.length) lines.push(`要点: ${m.key_points.join(" / ")}`);
    if (m.concerns && m.concerns.length) lines.push(`相手の懸念: ${m.concerns.join(" / ")}`);
    if (m.next_steps && m.next_steps.length) lines.push(`次回までの宿題: ${m.next_steps.join(" / ")}`);
    if (m.next_action) lines.push(`AI提案の次アクション: ${m.next_action}`);
    return lines.join("\n");
  }).join("\n\n");
  const user =
    `会社名: ${company}\n\n` +
    `この会社との過去の商談記録（古い順）:\n"""\n${material || "（記録なし）"}\n"""\n\n` +
    `次回商談に臨む営業担当者向けに、事前ブリーフと想定問答をJSONで作成してください。`;
  const text = await callLLM(BRIEF_PROMPT, user, 2200, { schema: BRIEF_SCHEMA });
  const o = parseJson(text) || {};
  return {
    recap: Array.isArray(o.recap) ? o.recap : [],
    open_items: Array.isArray(o.open_items) ? o.open_items : [],
    concerns: Array.isArray(o.concerns) ? o.concerns : [],
    focus: Array.isArray(o.focus) ? o.focus : [],
    qa: Array.isArray(o.qa) ? o.qa.filter((x) => x && x.q) : [],
  };
}

// 企業サイト＋Web検索から会社概要を取得（A+B / 2段階で確実にJSON化）
async function geminiGrounded(question, siteText) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 未設定");
  const model = process.env.GEMINI_WEB_MODEL || "gemini-2.5-flash";
  const user = `${question}\n\n企業サイト本文の抜粋:\n"""\n${(siteText || "").slice(0, 6000)}\n"""`;
  const body = {
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1100 },
    tools: [{ google_search: {} }],
  };
  const res = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text().catch(() => "")).slice(0, 120)}`);
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
}

const COMPANY_EXTRACT_PROMPT = `あなたは情報抽出器です。渡されたテキスト（企業サイト抜粋・リサーチ結果）から会社概要を抽出します。
- 分からない項目は空文字 "" にする（推測やでっち上げは禁止）。
- 値は簡潔・日本語。
- 次のJSONのみを返す:
{"official_name":"正式社名","industry":"業界","employees":"従業員数(例: 約320名)","hiring":"採用予定人数(例: 15名/年)","founded":"設立(例: 1998年)","location":"本社所在地","business":"事業内容(1〜2文)","note":"補足(任意)"}`;

export async function enrichCompany({ url, name, siteText }) {
  // Step1: Web検索＋サイト本文でリサーチ（失敗してもサイト本文だけで続行）。
  // サイト本文が無い/薄い場合は、Web検索の比重が自然と大きくなり、複数の検索結果ソースから補完される。
  let research = "";
  try {
    research = await geminiGrounded(
      `「${name || ""}」（${url ? "サイト: " + url : "公式サイトは不明"}）の会社概要を、複数のWeb検索結果を照合しながら調べてください。業界 / 従業員数 / 年間採用予定人数 / 設立年 / 本社所在地 / 事業内容 を、分かる範囲で正確に。正式な会社名も。公式サイトが見つかればそのURLも。`,
      siteText
    );
  } catch (e) {
    console.warn("[enrich] grounding失敗→サイト本文のみで抽出", e.message);
  }
  // Step2: JSONで構造化抽出（response_format=json で確実に）
  const user =
    `会社名(推定): ${name || "不明"}\nサイトURL: ${url || "不明"}\n\n` +
    `企業サイト本文の抜粋（複数サイトを取得した場合は【URL】区切りで結合）:\n"""\n${(siteText || "(取得できず)").slice(0, 9000)}\n"""\n\n` +
    `リサーチ結果（Web検索の複数ソースを踏まえたもの）:\n"""\n${(research || "(なし)").slice(0, 4500)}\n"""\n\n` +
    `上記から会社概要をJSONで出力してください。`;
  const text = await callLLM(COMPANY_EXTRACT_PROMPT, user, 800);
  const o = parseJson(text) || {};
  return {
    official_name: o.official_name || "",
    industry: o.industry || "",
    employees: o.employees || "",
    hiring: o.hiring || "",
    founded: o.founded || "",
    location: o.location || "",
    business: o.business || "",
    note: o.note || "",
  };
}

// ===== 商談フェーズ自動判定 =====
// 既定のフェーズ定義（仕様書のプロンプトをそのまま使用）。
// 運用中にフェーズ定義が変わる可能性があるため、settings(DB)に保存されたカスタムプロンプトがあれば
// そちらを優先し、無ければこの既定値にフォールバックする（getPhasePrompt参照）。
export const PHASE_JUDGMENT_PROMPT = `以下は営業担当者と顧客の商談の文字起こしです。

この商談が以下のフェーズ1〜4のそれぞれに到達しているかを判定してください。

---

【フェーズ1：課題特定】
到達条件：顧客が自分の状況を具体的に描写した発言がある。数字が入っているか、「私が・うちが・今」という主語で語られた具体的な状況描写があること。

到達例：
- 「説明会への移行率が10%で困っている」
- 「カジュアル面談を担当できる人がうちにはいない」
- 「土日も私一人で対応している」
- 「エントリーが今年15件しか来ていない」

非到達例：
- 「採用が難しくなっている」（業界全体の一般論）
- 「母集団を増やしたい」（どの会社にも当てはまる）

【フェーズ2：カスタマイズデモ】
到達条件：担当者が顧客固有の課題・数字・状況をデモ中に使った発言がある。

到達例：
- 「竹内様が説明会移行率10%とおっしゃっていましたが、このサービスでここを改善できます」
- 「カジュアル面談担当がいないとおっしゃっていたので、AIがその代わりになります」

非到達例：
- 「このサービスは24時間365日候補者の質問に答えます」（顧客の状況に紐づいていない）
- 「他社でもエントリーが増えた実績があります」

【フェーズ3：顧客起点】
到達条件：デモ後に顧客が①期日が具体的、かつ②確定形（「します」「たい」）で次のアクションを述べた発言がある。

ただし、次のいずれかに当てはまる場合は「顧客起点に到達していない（reached=false, current_phaseは2以下）」と判定すること（前向きな発言があっても優先してこちらを適用する）：
- 顧客が「直近1〜2か月では検討できない」「今は時期ではない」など、近い時期での検討・導入を否定している
- 顧客が「他に優先したいことがある」「別の案件・施策を先にやりたい」など、別のことを優先する意向を示している
- 次回の商談（次アポ）が取れていない（日時が確定した次回打ち合わせ・面談の約束が文字起こしにない）

到達例：
- 「6月から使いたい」
- 「上司に上申します」
- 「見積をください」
- 「明日14時に打ち合わせできますか」（顧客からアポ設定）

非到達例：
- 「一応見積ください」（確定形が弱い）
- 「秋くらいから使えたら」（期日曖昧）
- 「いいと思います」（顧客が自分から動いていない）
- 「今は他の施策を優先したくて」（他に優先したいことがある）
- 「直近1〜2か月は動けない」「来期になってから」（近い時期の検討を否定）
- 前向きな発言はあるが、次回の商談日時が決まっていない

【フェーズ4：クロージング】
到達条件：申込書を送付した記録がある。

到達例：
- 担当者が申込書をメール送付した
- 担当者が「申込書をお送りします」と発言した

非到達例：
- 「検討します」で終わっている
- 見積のみ送付（申込書未送付）

---

【出力形式】
以下のJSON形式で返してください。他のテキストは一切含めないこと。

{
  "phase1": { "reached": true/false, "evidence": "根拠となった顧客の発言（該当なければnull）" },
  "phase2": { "reached": true/false, "evidence": "根拠となった担当者の発言（該当なければnull）" },
  "phase3": { "reached": true/false, "evidence": "根拠となった顧客の発言（該当なければnull）" },
  "phase4": { "reached": true/false, "evidence": "根拠となった記録（該当なければnull）" },
  "current_phase": 1〜4（到達した最後のフェーズ番号）,
  "next_action": "次に担当者がすべき具体的なアクション（1〜2文）",
  "risk": "このままだと失注するリスクがあれば記載（なければnull）"
}

---

【商談の文字起こし】
{TRANSCRIPT}`;

// settings(DB)にカスタムプロンプトがあればそれを、無ければ既定値を返す
export async function getPhasePrompt() {
  try {
    const s = await getSettings();
    const custom = s && typeof s.phaseJudgmentPrompt === "string" ? s.phaseJudgmentPrompt.trim() : "";
    return custom || PHASE_JUDGMENT_PROMPT;
  } catch {
    return PHASE_JUDGMENT_PROMPT;
  }
}

// フェーズ判定の出力スキーマ（必須項目つきで強制し、next_action/riskの省略や未到達理由の手抜きを防ぐ）
// reasoningをreached/evidenceより先に書かせることで、例と照らし合わせた検討を経てから結論を出させる。
const REASONING_DESC =
  "到達例・非到達例と文字起こしを具体的に照らし合わせた検討過程（2〜3文）。" +
  "到達の場合：どの発言がどの到達例に近いか。" +
  "未到達の場合：それらしい発言があれば実際に引用し、それが到達例ではなく非到達例（一般論／確定形が弱い／期日が曖昧 等）に当てはまる理由を具体的に説明する。該当する発言が文字起こし中に全く無ければその旨を書く。";
const PHASE_JSON_SCHEMA = {
  type: "object",
  properties: {
    phase1: {
      type: "object",
      properties: {
        reasoning: { type: "string", description: REASONING_DESC },
        reached: { type: "boolean" },
        evidence: { type: ["string", "null"] },
      },
      required: ["reasoning", "reached", "evidence"],
    },
    phase2: {
      type: "object",
      properties: {
        reasoning: { type: "string", description: REASONING_DESC },
        reached: { type: "boolean" },
        evidence: { type: ["string", "null"] },
      },
      required: ["reasoning", "reached", "evidence"],
    },
    phase3: {
      type: "object",
      properties: {
        reasoning: { type: "string", description: REASONING_DESC },
        reached: { type: "boolean" },
        evidence: { type: ["string", "null"] },
      },
      required: ["reasoning", "reached", "evidence"],
    },
    phase4: {
      type: "object",
      properties: {
        reasoning: { type: "string", description: REASONING_DESC },
        reached: { type: "boolean" },
        evidence: { type: ["string", "null"] },
      },
      required: ["reasoning", "reached", "evidence"],
    },
    current_phase: { type: "integer", minimum: 1, maximum: 4 },
    next_action: { type: "string", description: "次に担当者がすべき具体的なアクション（1〜2文）。空文字や省略は不可。" },
    risk: { type: ["string", "null"], description: "このままだと失注するリスクがあれば具体的に記載。無ければ明示的にnull（キー自体は省略しない）。" },
  },
  required: ["phase1", "phase2", "phase3", "phase4", "current_phase", "next_action", "risk"],
};

// 文字起こし全文を判定し、正規化したオブジェクトを返す
export async function judgePhase(transcript, opts = {}) {
  const tr = (transcript || "").toString().trim();
  if (!tr) throw new Error("文字起こしが空です");
  const repName = (opts && opts.repName) ? String(opts.repName).trim() : "";
  const template = await getPhasePrompt();
  const trClip = tr.slice(0, 50000);
  // プロンプトキャッシュのため、毎回変わらない「固定部分（cachePrefix）」と、
  // 商談ごとに変わる「可変部分（文字起こし＋担当者名の補足）」を分離する。
  // 担当者名はsystem側に入れず、ここ（可変部分）に入れることで、systemとuserの固定部分は
  // 全商談・全担当者で完全に同一の文字列になり、キャッシュが最大限効くようにしている。
  const repHint = repName ? `\n\n（補足：この商談の営業担当者は主に「${repName}」です。フェーズ1・3の根拠判定の際にご留意ください）` : "";
  let cachePrefix, dynamicSuffix;
  if (template.includes("{TRANSCRIPT}")) {
    const idx = template.indexOf("{TRANSCRIPT}");
    cachePrefix = template.slice(0, idx);
    const after = template.slice(idx + "{TRANSCRIPT}".length);
    dynamicSuffix = trClip + after + repHint;
  } else {
    // 設定で編集されたカスタムプロンプトに{TRANSCRIPT}が無い場合も壊れないよう、末尾に文字起こしを付与する
    cachePrefix = template;
    dynamicSuffix = `\n\n---\n\n【商談の文字起こし】\n${trClip}${repHint}`;
  }
  const user = cachePrefix + dynamicSuffix;
  // 顧客（相手）の発言を根拠にするよう明示。営業担当の発言はフェーズ1・3の根拠にしない。
  // ※担当者名などの可変情報は含めない（system文を完全に固定し、プロンプトキャッシュを最大限効かせるため）。
  const sys =
    "あなたは厳密なJSON出力器です。指定のJSONのみを返します。" +
    "【判定の進め方】各フェーズについて、いきなり到達/未到達を決めず、必ず先に「reasoning」へ検討過程を書いてください。" +
    "reasoningでは、上記プロンプトに示された到達例・非到達例を具体的に参照し、文字起こし中の該当発言がどちらに近いかを比較検討してください。" +
    "未到達と判定する場合は、それらしい発言があれば実際に引用したうえで「なぜ非到達例に当てはまるか（一般論／確定形が弱い／期日が曖昧／顧客本人の発言でない 等）」を具体的に書いてください。該当しそうな発言が全く無い場合は「該当する発言なし」と書いてください。一般的な定義の繰り返しだけで終わらせないこと。" +
    "話題が関連しているだけ・一般論・確定形が弱い・期日が曖昧、といった非到達例に近い発言を、安易に到達と判定しないでください。逆に、明確に条件を満たす発言があるのに見落として未到達にもしないでください。" +
    "【重要な判定ルール】フェーズ1とフェーズ3は『顧客（提案を受けている側）』の発言だけを根拠にしてください。" +
    "営業担当（サービスを提案・説明している側。発言量が多い側や、サービス説明・デモを行っている側であることが多い。文字起こしの末尾に担当者名の補足があれば参考にする）の発言は、フェーズ1・フェーズ3の根拠（evidence）にしないでください。" +
    "営業担当が顧客の状況を代弁・要約しただけの発言も、フェーズ1・3の根拠にはなりません（顧客本人がその場で語った発言が必要）。" +
    "フェーズ2は営業担当の発言、フェーズ4は申込書送付の記録が根拠です。" +
    "【フェーズ3の除外ルール】顧客が『直近1〜2か月では検討できない／今は時期ではない』と近い時期の検討を否定している場合、『他に優先したいことがある／別の案件を先にやりたい』と別を優先している場合、または『次回の商談（次アポ）の日時が確定していない』場合は、前向きな発言があってもフェーズ3は到達していない（phase3.reached=false）と判定してください。その場合はreasoningにどの発言・状況が除外条件に当たるかを書いてください。" +
    "evidenceには、根拠とした話者の実際の発言をそのまま引用してください（未到達でreasoningに参考発言を挙げた場合も、evidenceは到達根拠ではないのでnullのままにしてください）。" +
    "phase1〜phase4は到達していなくても必ずオブジェクトを省略せず返し、到達していない場合はreached:false, evidence:nullにしてください（reasoningは到達/未到達どちらでも必ず書いてください）。" +
    "next_actionは現在のフェーズに応じた次の一手を必ず1〜2文で具体的に書いてください（省略不可）。riskは無ければキーごと省略せず値をnullにしてください（キー自体を省くのは不可）。";
  // kinbot既存のLLM基盤（Gemini→Groqフォールバック）＋JSONモード。schemaで必須項目（next_action/risk含む）を強制。
  // reasoningを詳しく書かせる分、出力が伸びるためmaxTokensに大きめの余裕を持たせる（途中で切れてnext_action/riskが欠落するのを防ぐ）。
  // cachePrefixを渡すと、Anthropic利用時はsystemとこの固定部分がプロンプトキャッシュ対象になり、
  // 2回目以降の呼び出し（同じ担当者の別商談、まとめ判定の連続実行など）でその分のコストが約1/10になる。
  // フェーズ判定だけ、他のタスクと別のプロバイダ/モデルを使えるようにする（コスト最適化）。
  // 例：普段のLLM_PROVIDERはgemini（激安）にしておき、PHASE_PROVIDER=anthropic + PHASE_MODEL=claude-haiku... で
  // 「判定だけClaude、それ以外は全部Gemini」という構成にできる。未設定なら通常のLLM_PROVIDERを使う。
  const jsel = await getJudgeProviderSetting();
  const phaseProvider = jsel || (process.env.PHASE_PROVIDER || "").toLowerCase() || undefined;
  const phaseModel = jsel ? undefined : (process.env.PHASE_MODEL || undefined);
  const text = await callLLM(sys, user, 3500, { schema: PHASE_JSON_SCHEMA, cachePrefix, provider: phaseProvider, model: phaseModel });
  const o = parseJson(text) || {};
  const pick = (p) => (o && o[p] && typeof o[p] === "object" ? o[p] : {});
  const p1 = pick("phase1"), p2 = pick("phase2"), p3 = pick("phase3"), p4 = pick("phase4");
  const reached = [!!p1.reached, !!p2.reached, !!p3.reached, !!p4.reached];
  // current_phase: モデル値が無ければ到達した最後の番号から算出
  let cur = Number(o.current_phase);
  if (!Number.isFinite(cur) || cur < 1 || cur > 4) {
    cur = 0;
    for (let k = 0; k < 4; k++) if (reached[k]) cur = k + 1;
    if (!cur) cur = 1;
  }
  const cleanReasoning = (s) => (s && String(s).trim() && String(s).trim() !== "null" ? String(s).trim() : null);
  const NEXT_FALLBACK = {
    1: "次回の商談で、顧客自身の言葉で具体的な課題（数字や「うちは／私が／今」の状況描写）を引き出す質問をしてください。",
    2: "ヒアリングした顧客固有の課題・数字をデモの中で具体的に取り上げ、顧客の状況に紐づけて説明してください。",
    3: "デモ内容を踏まえ、具体的な期日と確定的な次のアクション（上申・見積依頼・導入時期など）を顧客から引き出してください。",
    4: "申込書を送付し、契約手続きを進めてください。",
  };
  let nextAction = o.next_action && String(o.next_action).trim() && String(o.next_action).trim() !== "null" ? String(o.next_action).trim() : null;
  if (!nextAction) nextAction = NEXT_FALLBACK[cur] || NEXT_FALLBACK[1];
  return {
    phase1_reached: reached[0], phase1_evidence: p1.evidence || null, phase1_reasoning: cleanReasoning(p1.reasoning),
    phase2_reached: reached[1], phase2_evidence: p2.evidence || null, phase2_reasoning: cleanReasoning(p2.reasoning),
    phase3_reached: reached[2], phase3_evidence: p3.evidence || null, phase3_reasoning: cleanReasoning(p3.reasoning),
    phase4_reached: reached[3], phase4_evidence: p4.evidence || null, phase4_reasoning: cleanReasoning(p4.reasoning),
    current_phase: cur,
    next_action: nextAction,
    risk: o.risk && String(o.risk).trim() && o.risk !== "null" ? o.risk : null,
  };
}

// 商談データを文脈にしたGeminiとのマルチターン会話
const CHAT_SYSTEM = `あなたは「kinbot」の営業アシスタントです。ユーザー（営業）の過去の商談データ（要約・懸念・スコア・ステータス等）を文脈として渡されます。
- そのデータに基づき、日本語で具体的に、会話形式で答えます。
- データで分からないことは「記録からは分かりません」と正直に伝える。憶測で事実を作らない。
- 必要に応じて箇条書きで簡潔に。長くなりすぎない。`;

export async function chatWithData({ messages, material, model, web }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY が未設定です（Google AI Studio で発行）");
  let primary = model || process.env.GEMINI_CHAT_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
  let standard = process.env.GEMINI_CHAT_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  // Web検索(グラウンディング)はLite非対応のことがあるのでFlashに引き上げ
  if (web) {
    if (/lite/i.test(primary)) primary = process.env.GEMINI_WEB_MODEL || "gemini-2.5-flash";
    standard = process.env.GEMINI_WEB_MODEL || "gemini-2.5-flash";
  }
  const system =
    CHAT_SYSTEM +
    (web ? `\n（必要に応じてWeb検索を使い、最新情報や社外情報も補ってよい。ただし商談データに関する事実はデータを優先する）` : "") +
    `\n\n【あなたが参照できる商談データ】\n"""\n${material || "（データなし）"}\n"""`;
  const contents = (messages || [])
    .filter((m) => m && m.content)
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content).slice(0, 4000) }] }));
  if (!contents.length) throw new Error("メッセージがありません");

  const callModel = async (mdl) => {
    const body = {
      system_instruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { temperature: 0.5, maxOutputTokens: 2048 },
    };
    if (web) body.tools = [{ google_search: {} }];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${mdl}:generateContent?key=${key}`;
    const res = await fetchWithTimeout(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, "Gemini");
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Gemini ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const cand = data.candidates?.[0];
    let text = (cand?.content?.parts || []).map((p) => p.text || "").join("");
    // Web検索の参照元を付ける
    const chunks = cand?.groundingMetadata?.groundingChunks || [];
    const sources = [];
    for (const c of chunks) {
      const w = c.web;
      if (w && w.uri && !sources.some((s) => s.uri === w.uri)) sources.push({ title: w.title || w.uri, uri: w.uri });
      if (sources.length >= 5) break;
    }
    if (sources.length) text += "\n\n参考(Web):\n" + sources.map((s) => `- ${s.title}: ${s.uri}`).join("\n");
    return text;
  };

  const models = primary === standard ? [primary] : [primary, standard];
  let lastErr;
  for (let mi = 0; mi < models.length; mi++) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await callModel(models[mi]);
      } catch (e) {
        lastErr = e;
        if (!isTransient(e.message)) {
          if (mi < models.length - 1) break;
          throw e;
        }
        if (attempt < 2) await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      }
    }
  }
  throw lastErr || new Error("Gemini 応答に失敗しました");
}

// ---- プロバイダ振り分け ----
function isTransient(msg) {
  return /\b503\b|\b429\b|UNAVAILABLE|overloaded|high demand|temporarily|timeout|timed out|aborted|network|ECONN|ETIMEDOUT/i.test(msg || "");
}

// タイムアウト付きfetch。AI APIが応答せず固まると、Railwayが待ちきれず502を返す（原因不明の失敗になる）。
// これを防ぐため、一定時間で必ず中断し、分かりやすいエラーにする（→ 自動フォールバックにも繋がる）。
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 90000);
async function fetchWithTimeout(url, options = {}, label = "LLM") {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } catch (e) {
    if (e.name === "AbortError") throw new Error(`${label}: 応答がなく${Math.round(LLM_TIMEOUT_MS / 1000)}秒でタイムアウトしました`);
    throw new Error(`${label}: 通信エラー（${e.message}）`);
  } finally {
    clearTimeout(timer);
  }
}

// 一次プロバイダが落ちた時の切替先（明示指定 → Groq → Gemini の順で使えるものを選ぶ）
function fallbackProvider(current = PROVIDER) {
  // 明示指定（FALLBACK_PROVIDER）があれば最優先。無ければ Gemini → Groq の順で、使えるものを選ぶ。
  const cur = (current || PROVIDER).toLowerCase();
  const explicit = (process.env.FALLBACK_PROVIDER || "").toLowerCase();
  if (explicit && explicit !== cur) return explicit;
  if (cur !== "gemini" && process.env.GEMINI_API_KEY) return "gemini";
  if (cur !== "groq" && process.env.GROQ_API_KEY) return "groq";
  return "";
}

async function callLLM(system, user, maxTokens = 1400, opts = {}) {
  const json = opts.json !== false;
  const schema = opts.schema || null;
  const cachePrefix = opts.cachePrefix || null;
  // タスク単位でプロバイダ/モデルを上書きできる（例：普段はGeminiで安く、フェーズ判定だけClaude）。
  const provider = (opts.provider || PROVIDER).toLowerCase();
  const model = opts.model || null;
  try {
    return await withRetry(() => callOnce(provider, system, user, maxTokens, json, schema, cachePrefix, model));
  } catch (e) {
    // opts.fallback で明示指定があればそれを最優先（例：抽出はClaude→必ずGemini）。
    // ただし現プロバイダと同じ指定は無意味なので、その場合は通常の自動選択にフォールスルー。
    let fb = (opts.fallback || "").toLowerCase();
    if (!fb || fb === provider) fb = fallbackProvider(provider);
    // JSON構造化出力が必要な呼び出し（フェーズ判定・各種分析など）は、キー未設定・課金未設定・
    // モデル名誤り・出力上限での途中切れ・空応答など「一時的でない」理由でも丸ごと失敗しうるため、
    // フォールバック先があれば理由を問わず必ず切り替える（自由記述の生成のみ、従来どおり一時的な混雑時に限定）。
    const shouldFallback = fb && (json || provider === "anthropic" || isTransient(e.message));
    if (shouldFallback) {
      console.warn(`[llm] ${provider} が失敗（${e.message}）→ ${fb} に自動フォールバック`);
      try {
        // フォールバック時はモデル指定を持ち越さない（別プロバイダのモデル名は無効なため）
        return await withRetry(() => callOnce(fb, system, user, maxTokens, json, schema, cachePrefix, null), 2);
      } catch (e2) {
        // フォールバックも失敗した場合、フォールバック側のエラーだけを表示すると本来の原因（最初のプロバイダの失敗理由）が
        // 隠れてしまうため、両方のエラーをまとめて投げる。
        console.error(`[llm] フォールバック(${fb})も失敗（${e2.message}）`);
        throw new Error(`${provider}: ${e.message} ／ フォールバック(${fb}): ${e2.message}`);
      }
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

async function callOnce(provider, system, user, maxTokens, json = true, schema = null, cachePrefix = null, model = null) {
  if (provider === "anthropic") return callAnthropic(system, user, maxTokens, json, schema, cachePrefix, model);
  if (provider === "ollama") return callOllama(system, user, json);
  if (provider === "groq")
    return callOpenAICompat(system, user, maxTokens, {
      base: "https://api.groq.com/openai/v1",
      key: process.env.GROQ_API_KEY,
      model: model || process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      name: "Groq",
    }, json);
  if (provider === "openai")
    return callOpenAICompat(system, user, maxTokens, {
      base: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      key: process.env.OPENAI_API_KEY,
      model: model || process.env.OPENAI_MODEL || "gpt-4o-mini",
      name: "OpenAI互換",
    }, json);
  return callGemini(system, user, maxTokens, json, schema, model);
}

// Groq / Cerebras / OpenRouter / OpenAI など OpenAI互換エンドポイント共通
async function callOpenAICompat(system, user, maxTokens, { base, key, model, name }, json = true) {
  if (!key) throw new Error(`${name} のAPIキーが未設定です`);
  const res = await fetchWithTimeout(`${base.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.4,
      ...(json ? { response_format: { type: "json_object" } } : {}),
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
  const choice = data.choices?.[0];
  if (json && choice?.finish_reason === "length") {
    // 出力上限で打ち切られ、JSONが不完全な可能性が高い。不完全データを黙って使わず例外にする。
    throw new Error(`${name}の応答が出力上限で途中で切れました（length）`);
  }
  return choice?.message?.content || "";
}

// JSON Schemaの type:[X,"null"] をGeminiの type:X + nullable:true に変換（その他はそのまま通す）
function toGeminiSchema(node) {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (node && typeof node === "object") {
    const out = {};
    for (const k of Object.keys(node)) {
      if (k === "type" && Array.isArray(node.type)) {
        const types = node.type.filter((t) => t !== "null");
        out.type = types[0] || "string";
        if (node.type.includes("null")) out.nullable = true;
        continue;
      }
      out[k] = toGeminiSchema(node[k]);
    }
    return out;
  }
  return node;
}

async function callGemini(system, user, maxTokens, json = true, schema = null, modelOverride = null) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY が未設定です（Google AI Studio で発行）");
  const model = modelOverride || process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const genConfig = { temperature: 0.4, maxOutputTokens: maxTokens };
  if (json) {
    genConfig.responseMimeType = "application/json";
    // スキーマが渡されていれば必須項目つきで強制（next_action/riskの省略などを防ぐ）
    if (schema) genConfig.responseSchema = toGeminiSchema(schema);
  }
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: genConfig,
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Gemini ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  const cand = data.candidates?.[0];
  if (json && cand?.finishReason === "MAX_TOKENS") {
    // 出力上限で打ち切られ、JSONが不完全な可能性が高い。不完全データを黙って使わず例外にする。
    throw new Error("Geminiの応答が出力上限で途中で切れました（MAX_TOKENS）");
  }
  return (cand?.content?.parts || []).map((p) => p.text || "").join("");
}

async function callAnthropic(system, user, maxTokens, json = true, schema = null, cachePrefix = null, modelOverride = null) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY が未設定です");
  const model = modelOverride || process.env.ANALYZER_MODEL || "claude-sonnet-4-6";
  // プロンプトキャッシュ：system（指示文・全呼び出しで共通）と、
  // 渡された場合はuserの「固定部分（cachePrefix）」をキャッシュ対象としてマークする。
  // 1,024トークン未満の内容は自動的にキャッシュされないだけでエラーにはならないため、常に付けて安全。
  // 5分以内に同じ内容で再利用されると、その部分は約1/10の価格になる（Sonnet 4.6で約90%節約）。
  const body = {
    model,
    max_tokens: maxTokens,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
  };
  if (cachePrefix && typeof user === "string" && user.startsWith(cachePrefix) && cachePrefix.length > 0) {
    const rest = user.slice(cachePrefix.length);
    body.messages = [
      {
        role: "user",
        content: [
          { type: "text", text: cachePrefix, cache_control: { type: "ephemeral" } },
          { type: "text", text: rest },
        ],
      },
    ];
  } else {
    body.messages = [{ role: "user", content: user }];
  }
  if (json) {
    // Claude系モデルにはGeminiのような「強制JSONモード」が無く、新しいモデル（Sonnet 4.6等）は
    // 応答の先頭を指定するprefill手法も使えない。最も確実なのは、JSON専用のツールを定義して
    // tool_choiceで必ずそれを呼ばせる方法（前置き文・コードフェンスが原理的に入り込まない）。
    // スキーマ未指定の緩い定義だと、Claudeが中身を埋めずに空オブジェクトで呼んでしまうことがあるため、
    // 呼び出し元が具体的なスキーマを渡せる場合は必須項目つきでそれを使う（無ければ汎用の緩いスキーマ）。
    // ツール定義はsystemより前に評価されるため、system側のcache_controlだけで
    // 「ツール定義＋system」がまとめてキャッシュ対象になる（公式ドキュメント仕様）。
    // tools側に重ねて付けるのは冗長なため付けない。
    body.tools = [
      {
        name: "emit_json",
        description: "直前の指示で求められているJSON結果を、そのままこの関数の引数として返す。前置きや説明文、コードフェンスは一切含めない。全てのプロパティを省略せず必ず埋めること。",
        input_schema: schema || { type: "object" },
      },
    ];
    body.tool_choice = { type: "tool", name: "emit_json" };
  }
  const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  // キャッシュの効き具合を確認できるよう、デバッグしやすい形でログに残す（任意・コストには影響しない）
  if (data.usage && (data.usage.cache_read_input_tokens || data.usage.cache_creation_input_tokens)) {
    console.log(
      `[anthropic cache] read=${data.usage.cache_read_input_tokens || 0} write=${data.usage.cache_creation_input_tokens || 0} input=${data.usage.input_tokens || 0}`
    );
  }
  if (json) {
    const toolBlock = (data.content || []).find((b) => b.type === "tool_use" && b.name === "emit_json");
    if (toolBlock && toolBlock.input !== undefined) {
      const inp = toolBlock.input;
      // 中身が空（{}）、または途中で切れて必須トップレベルキーが欠けている場合は実質失敗。
      // 黙って不完全なデータを使わず、ここで例外にして呼び出し元（callLLM）の自動フォールバックに任せる。
      const emptyObj = !inp || (typeof inp === "object" && Object.keys(inp).length === 0);
      const missingRequired = !emptyObj && schema && Array.isArray(schema.required)
        ? schema.required.some((k) => inp[k] === undefined)
        : false;
      if (emptyObj || missingRequired) {
        throw new Error(emptyObj ? "Anthropicから空のJSONが返されました" : "Anthropicの応答が途中で切れ、必須項目が欠けています");
      }
      return JSON.stringify(inp);
    }
    // 想定外でツール呼び出しが無かった場合は通常テキストにフォールバック（呼び出し元のparseJsonが処理）
  }
  return (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("");
}

async function callOllama(system, user, json = true) {
  const base = (process.env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL || "qwen2.5";
  const res = await fetchWithTimeout(`${base}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model, stream: false, ...(json ? { format: "json" } : {}),
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
// 既定のプロンプト。settings(DB)に保存されたカスタムプロンプトがあればそちらを優先する（getThanksPrompt参照）。
// 使えるプレースホルダ: {round}=商談回数
export const THANKS_PROMPT = `あなたは法人営業の担当者です。商談後の「御礼メール」を作成します。
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

export async function generateThanks({ round, examples, summaryText, repName, customer, prompt }) {
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
  // 呼び出し元からカスタムプロンプトが渡されればそれを、無ければ既定のTHANKS_PROMPTを使う
  const template = (typeof prompt === "string" && prompt.trim()) ? prompt : THANKS_PROMPT;
  const text = await callLLM(template.replace(/\{round\}/g, String(round || "")), user, 1400);
  return parseJson(text);
}

// ===== Feature A: 新営業プロセスの抽出（種別判定＋初回/再商談 抽出） =====

// transcript(配列 or 文字列)を「話者: 発言」形式のテキストにする
// 抽出（種別判定・初回・再商談）に使うLLM。既定は Anthropic Claude。
// 判定に使うプロバイダを設定から取得（"anthropic"|"gemini"|""）。未設定は空＝環境変数にフォールバック。
async function getJudgeProviderSetting() {
  try {
    const s = await getSettings();
    if (s && (s.judgeProvider === "anthropic" || s.judgeProvider === "gemini")) return s.judgeProvider;
  } catch {}
  return "";
}

// Claudeが失敗したら必ず Gemini にフォールバックする（EXTRACT_FALLBACK で変更可、既定 gemini）。
// 判定モデルは設定（judgeProvider＝画面で選択）を最優先。未設定なら環境変数 EXTRACT_PROVIDER（既定 anthropic）。
async function extractLLMOpts(extra = {}, forceProvider) {
  // forceProvider が指定されれば最優先（商談終わりの自動判定でClaude固定にするため）
  const forced = forceProvider === "anthropic" || forceProvider === "gemini" ? forceProvider : "";
  const sel = forced || (await getJudgeProviderSetting()); // "anthropic"|"gemini"|""
  const provider = sel || (process.env.EXTRACT_PROVIDER || "gemini").toLowerCase();
  const model = sel
    ? (provider === "anthropic" ? (process.env.ANALYZER_MODEL || "claude-sonnet-4-6") : undefined)
    : (process.env.EXTRACT_MODEL || (provider === "anthropic" ? (process.env.ANALYZER_MODEL || "claude-sonnet-4-6") : undefined));
  const fallback = (process.env.EXTRACT_FALLBACK || "gemini").toLowerCase();
  return { provider, model, fallback, ...extra };
}

// 判定共通のリトライ：自信度highが出るまで再試行し、最後まで低ければ上位モデル(Opus)にエスカレーション。
// buildResult(o) は生JSONを整形して返す（必ず confidence を持たせること）。
async function judgeWithRetry({ sys, user, schema, provider, maxTokens = 1400, retryNote, buildResult }) {
  const maxTries = Math.max(1, Math.min(8, Number(process.env.EXTRACT_MAX_TRIES || 5)));
  // 低自信のとき最後に使う上位モデル（未設定なら既定のOpus文字列。使えない場合は自動でGeminiにフォールバック）
  const escalateModel = process.env.EXTRACT_ESCALATE_MODEL || "claude-opus-4-1";
  let best = null;
  for (let attempt = 1; attempt <= maxTries; attempt++) {
    const lowBefore = best && best.confidence === "low";
    const isEscalation = attempt === maxTries && lowBefore && !!escalateModel;
    const note = attempt > 1 ? retryNote || "" : "";
    const escNote = isEscalation
      ? "\n\n（これは最終確認です。上位モデルとして、文字起こしを最初から丁寧に読み直し、reasoning に段階的な考察を書いてから、各項目を発言の根拠に基づいて慎重に確定してください。）"
      : "";
    const llm = isEscalation
      ? { ...(await extractLLMOpts({ schema }, "anthropic")), model: escalateModel }
      : await extractLLMOpts({ schema }, provider);
    const o = parseJson(await callLLM(sys, user + note + escNote, maxTokens, llm)) || {};
    best = buildResult(o, attempt, isEscalation);
    if (best.confidence === "high") break;
  }
  return best;
}

function transcriptToText(transcript) {
  if (typeof transcript === "string") return transcript;
  if (!Array.isArray(transcript)) return "";
  return transcript.map((u) => `${(u.speaker && u.speaker.name) || u.speaker_name || "話者"}: ${u.text || ""}`).join("\n");
}

// 商談種別を判定：初回商談 / 再商談 / 判定不能
export async function classifyMeetingKind(transcript, opts = {}) {
  const text = transcriptToText(transcript).slice(0, 40000);
  const sys =
    "あなたは営業商談の文字起こしを読み、商談の種別を分類するアシスタントです。次の3つから1つを選びます。" +
    "『初回商談』=概要紹介〜ヒアリング〜デモ〜利用開始スケジュールの確認など、初めての提案商談。" +
    "『再商談』=既に提案済みで、上申日・申込日・利用開始日など導入に向けた相談をしている商談（上申準備）。" +
    "『判定不能』=文字起こしが短すぎる/雑談のみ/どちらとも判断できない場合。" +
    "推測が難しければ判定不能にしてください。JSONのみ出力し、他の文章は書かないこと。";
  const user = `文字起こし:\n"""\n${text}\n"""`;
  const schema = {
    type: "object",
    properties: {
      meeting_kind: { type: "string", enum: ["初回商談", "再商談", "判定不能"] },
      confidence: { type: "string", enum: ["high", "low"] },
    },
    required: ["meeting_kind", "confidence"],
  };
  const out = parseJson(await callLLM(sys, user, 300, await extractLLMOpts({ schema }, opts.provider))) || {};
  const kind = ["初回商談", "再商談", "判定不能"].includes(out.meeting_kind) ? out.meeting_kind : "判定不能";
  return { meeting_kind: kind, confidence: out.confidence === "high" ? "high" : "low" };
}

// 初回商談の抽出（依頼書4.2 確定版プロンプト）
export async function extractFirstMeeting(transcript, meetingDate, opts = {}) {
  const text = transcriptToText(transcript).slice(0, 45000);
  const sys =
    "あなたは営業商談の文字起こしから、指定された項目のみを抽出するアシスタントです。" +
    "記載のない情報は絶対に推測せず、該当する区分がなければ\"不明\"としてください。\n" +
    "【抽出項目】\n" +
    "1. schedule_choice: 顧客が回答した『ご利用開始スケジュール』。\"来月開始\"/\"再来月開始\"/\"その他明確な時期\"/\"未定\"/\"不明\"。" +
    "その他明確な時期の場合、schedule_choice_detail に自由記述で内容を記載。\n" +
    "2. apply_timing: 『今月中に申込可否の判断ができるか』への回答。" +
    "schedule_choiceが\"未定\"の場合は質問自体が発生しないため\"該当なし\"。" +
    "schedule_choiceが\"不明\"の場合はこの項目も\"不明\"。" +
    "\"今月\"（今月中に判断できる）/\"来月\"（来月なら判断できる）/\"それ以外\"（再来月以降など今月来月以外の明確な回答）/\"不明\"（質問はされたが回答が読み取れない）/\"該当なし\"（未定のため質問自体が発生していない）。\n" +
    "3. next_meeting_scheduled: 再商談（上申準備）の日程が設定されたか（true/false）。\n" +
    "4. next_meeting_date: 設定された次回商談の日程（YYYY-MM-DD）。" +
    "「来週火曜」「7月10日」「再来週」など相対・部分的な表現でも、商談日を基準に具体的な日付へ変換して出力する。" +
    "年が省略されていれば商談日と同じ年（年をまたぐ場合は翌年）とする。日にちまで特定できず月だけ分かる場合はその月の1日。全く不明ならnull。\n" +
    "5. confidence: 抽出全体の自信度（\"high\"/\"low\"）。顧客の発言が曖昧・脱線して結論が不明確・複数解釈可能なら\"low\"。\n" +
    "6. judgment_basis: 判定根拠の要約（30字程度、発言の逐語引用はしない）。\n" +
    "7. reasoning: 上記を確定する前の段階的な考察。顧客の該当発言に触れながら、各区分をどう判断したかを検討する。\n" +
    "【重要】出力は必ず reasoning から書き始め、その考察の結論として schedule_choice などの項目を決めること。\n" +
    "JSONのみ出力し、他の文章は一切出力しないこと。";
  const user = `商談日: ${meetingDate || "不明"}\n文字起こし:\n"""\n${text}\n"""`;
  const schema = {
    type: "object",
    properties: {
      reasoning: { type: "string" },
      schedule_choice: { type: "string", enum: ["来月開始", "再来月開始", "その他明確な時期", "未定", "不明"] },
      schedule_choice_detail: { type: ["string", "null"] },
      apply_timing: { type: "string", enum: ["今月", "来月", "それ以外", "不明", "該当なし"] },
      next_meeting_scheduled: { type: "boolean" },
      next_meeting_date: { type: ["string", "null"] },
      confidence: { type: "string", enum: ["high", "low"] },
      judgment_basis: { type: "string" },
    },
    required: ["reasoning", "schedule_choice", "apply_timing", "next_meeting_scheduled", "confidence", "judgment_basis"],
  };
  // 自信度highが出るまで再試行し、最後まで低ければ上位モデル(Opus)にエスカレーション。
  return await judgeWithRetry({
    sys, user, schema, provider: opts.provider, maxTokens: 1400,
    retryNote: "\n\n（注意：前回の抽出は自信度lowでした。reasoning に根拠を段階的に書いた上で、文字起こしを丁寧に読み直し、各区分を厳密に判定してください。明確な根拠が本当に無い項目だけを不明としてください。）",
    buildResult: (o, attempt) => ({
      reasoning: o.reasoning || "",
      schedule_choice: o.schedule_choice || "不明",
      schedule_choice_detail: o.schedule_choice_detail || "",
      apply_timing: o.apply_timing || "不明",
      next_meeting_scheduled: !!o.next_meeting_scheduled,
      next_meeting_date: o.next_meeting_date || null,
      confidence: o.confidence === "high" ? "high" : "low",
      judgment_basis: o.judgment_basis || "",
      attempts: attempt,
    }),
  });
}

// 再商談（上申準備）の抽出（依頼書4.3）
export async function extractReMeeting(transcript, meetingDate, opts = {}) {
  const text = transcriptToText(transcript).slice(0, 45000);
  const sys =
    "あなたは営業商談（再商談・上申準備）の文字起こしから、指定された項目のみを抽出するアシスタントです。" +
    "記載のない情報は絶対に推測せず、不明なら null または\"未確定\"としてください。\n" +
    "【抽出項目】\n" +
    "1. reported_date: 上申予定日（YYYY-MM-DD、不明ならnull）\n" +
    "2. apply_date: 申込予定日（YYYY-MM-DD、不明ならnull）\n" +
    "3. usage_start_date: 利用開始予定日（YYYY-MM-DD、不明ならnull）\n" +
    "4. result: \"受注\"/\"失注\"/\"延期\"（さらに先送り）/\"未確定\"\n" +
    "5. confidence: \"high\"/\"low\"\n" +
    "6. judgment_basis: 判定根拠の要約（30字程度）\n" +
    "7. reasoning: result を確定する前の段階的な考察。顧客の該当発言に触れながら、受注/失注/延期/未確定のどれに当たるかを検討する。\n" +
    "【重要】出力は必ず reasoning から書き始め、その考察の結論として result を決めること。口頭の同意でも稟議・持ち帰りが残る場合は安易に受注とせず、根拠を吟味すること。\n" +
    "JSONのみ出力し、他の文章は一切出力しないこと。";
  const user = `商談日: ${meetingDate || "不明"}\n文字起こし:\n"""\n${text}\n"""`;
  const schema = {
    type: "object",
    properties: {
      reasoning: { type: "string" },
      reported_date: { type: ["string", "null"] },
      apply_date: { type: ["string", "null"] },
      usage_start_date: { type: ["string", "null"] },
      result: { type: "string", enum: ["受注", "失注", "延期", "未確定"] },
      confidence: { type: "string", enum: ["high", "low"] },
      judgment_basis: { type: "string" },
    },
    required: ["reasoning", "result", "confidence", "judgment_basis"],
  };
  return await judgeWithRetry({
    sys, user, schema, provider: opts.provider, maxTokens: 1400,
    retryNote: "\n\n（注意：前回の抽出は自信度lowでした。reasoning に根拠を段階的に書いた上で、受注/失注/延期/未確定を発言の根拠に基づき厳密に判定してください。明確な根拠が無い場合のみ未確定としてください。）",
    buildResult: (o, attempt) => ({
      reasoning: o.reasoning || "",
      reported_date: o.reported_date || null,
      apply_date: o.apply_date || null,
      usage_start_date: o.usage_start_date || null,
      result: ["受注", "失注", "延期", "未確定"].includes(o.result) ? o.result : "未確定",
      confidence: o.confidence === "high" ? "high" : "low",
      judgment_basis: o.judgment_basis || "",
      attempts: attempt,
    }),
  });
}
