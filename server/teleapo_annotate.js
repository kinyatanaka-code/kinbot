// テレアポ科学モデル v1：文字起こしから「判定に使う事実」だけを AI に読み取らせる（2026-11-16）
//
// なぜ AI には読み取りだけをさせるか：
//   点数や良し悪しまで AI に決めさせると、同じ通話でも回すたびに結論が変わる。
//   ここでは「打診はあったか・その前に相手は何と言ったか・最初の返事は何か」のような事実と、その引用だけを返させ、
//   良し悪しの判定は teleapo_science.js のコードで行う。引用は文字起こしと照らして、無ければ保留にする。
//
// 項目名は、アポの再現性検証（2026-11-06）の注釈と同じにしてある。過去の注釈と並べて比べられるようにするため。
// 温度は0で固定する（ぶれを減らすため）。Gemini が使えないときだけ、kinbot のいつもの AI の呼び方に切り替える。
import { callLLMPublic } from "./analyzer.js";

const DEFAULT_PRODUCT = "MOCHICA（モチカ）：新卒採用の学生とLINEでつながり、説明会・選考のリマインド、日程調整、内定者フォローを自動化するツール。狙う課題は「連絡がつかない・既読にならない」「説明会・面接の欠席」「選考辞退・内定辞退」「連絡業務の工数」。";

const SYSTEM = "あなたは営業電話（テレアポ）の文字起こしから、決められた事実だけを正確に抜き出す記録係です。良し悪しの評価はしません。文字起こしに無いことは推測せず false・空文字・null にします。引用は必ず文字起こしの原文から写します。出力はJSONだけです。";

function prompt(product, callerName) {
  return `# 背景
- 架電者（こちら）${callerName ? `は「${callerName}」` : ""}。企業の採用担当に電話し、オンラインの打ち合わせ（アポ）を取ろうとしている。
- 商材：${product}
- 文字起こしは自動生成で誤認識が多い。話者の取り違えもあるので内容で判断する。[12s] は通話開始からの秒。

# 目的
架電者が最初に打ち合わせを打診した瞬間に、相手がどんな状態だったかと、打診への最初の返事、その後の返し、通話の終わり方を記録する。打診より前と後を厳密に分ける。

# 用語
- 打診：打ち合わせ・オンライン面談・説明の時間を求めた発言（「30分お時間いただけませんか」「来週◯日はいかがですか」）。資料送付の提案、次回電話の約束、時間許諾（「今1分よろしいですか」）は打診ではない。
- 最初の打診：通話の中で最初の打診。「打診前」はこの秒より前。

# 項目
## 全体
- contact_ok：採用担当（人事・採用の当事者や決裁者）本人と話せたら true。受付・代表・別部署だけなら false
- duration_sec：最後の発話の秒（分からなければ null）
- call_type_guess：前に話したことがある相手なら「再アプローチ」、初めてなら「新規」、分からなければ「不明」
- purpose_sec：架電者が用件（なぜ電話したか）を言い終えた秒。言わなければ null
- remember_q：架電者が「覚えてますか／ご記憶ありますか」と聞いた
- time_permission：架電者が「今◯分よろしいですか」と時間の許しを求めた
- prior_ref：冒頭で前回の相手の言葉・約束を電話の理由にした（新規は null）
- dup_neo：相手が「ネオキャリアの別の人・別部署からも連絡が来ている／もう別の担当と話している」と言った
- list_bad：リストの不良。「ICP外」（新卒採用をしていない等）／「在籍なし」／「異動」／「番号違い」のどれか。無ければ ""
## 打診
- asked：打診があれば true。無ければ false（以下の打診関連は null、相手の状態は通話全体で埋める）
- ask_sec：最初の打診の秒
- ask_quote：最初の打診の要旨（原文寄り、60字以内）
- ask_form：「日時2択」／「日付1つ」／「週・月だけ」／「日付なし」
- ask_minutes：打診で言った所要分数。言っていなければ null
## 打診前の相手の発話（打診の秒より前だけ。true なら引用も）
- own_problem / own_problem_q：相手が自分の言葉で商材の領域の困りごとを言った。架電者の問いに「そうですね」と同意しただけは false
- lost_count / lost_count_q：相手が失った人数や具体的な人を言った（「3人辞退」「来なかった子が何人か」）
- rate_only：相手が率（◯割・◯%）だけを言い、人数では言っていない
- denial / denial_q：相手が「問題ない・困っていない・十分・例年どおり・間に合っている」と言った
- upstream：相手が、課題は入口（母集団・エントリー・集客）だと言った
- current_means：相手が言った今の手段（例「電話とメール」「採用管理システム」）。無ければ ""
- means_gap / means_gap_q：相手が今の手段の不足・手間・限界を言った
- means_ok：相手が今の手段で足りている・回っていると言った
- constraint：打診前に相手が言った制約。「忙しい」／「予算」／「決裁」／「LINE不可」／「他ツール契約中」／「なし」
- timing_info / timing_info_q：相手が検討・決定の時期（◯月、来期の計画、契約更新 等）を言った
- interest_q / interest_q_q：相手が商材について質問した（機能・費用・事例・やり方）
- understood：打診の時点で相手が商材を何だと分かっていそうか。「中身まで理解」／「LINEで連絡するツール程度」／「分かっていない」／「不明」
## 打診前の架電者の動き（打診の秒より前だけ）
- q_rate：率・割合を聞いた回数 ／ q_count：人数・具体的な人を聞いた回数 ／ q_open：状況を開いた形で聞いた回数
- q_presumptive：課題を決めつける問いの回数（「〜増えていませんか」「〜でお困りじゃないですか」）
- echo：打診の直前30秒以内に相手の言葉を復唱・要約した
- reason_from_customer：打診の理由を相手の言葉につないだ
- explain_sec：打診前に機能・事例を説明していた合計秒の目安
## 打診後
- first_resp：最初の打診への相手の最初の返事。「受諾」／「時期」（今は忙しい・今月は無理・◯月なら 等）／「要否」（必要ない・困っていない・間に合っている）／「他ツール」／「予算」／「決裁」／「LINE不可」／「資料希望」／「その他」
- first_resp_q：その原文（40字以内）
- after：最初の返事が受諾以外のときの架電者の次の動き。「日付を出し直す」（週ずらし・別日・2択）／「仮押さえ」／「質問・掘り下げ」／「説明を続ける」／「撤退」（引いて終話・資料送付・次回電話へ）／「受諾なのでなし」
- n_asks：通話の中の打診の総回数
- appo_in_call：この通話で打ち合わせの日時が確定した
- resp_types：打診後に相手が出した断り・保留の種類を順に
## 終わり方（アポにならなかったとき）
- next_commit：通話の最後に決めた次の約束。「日付つき次回」（◯日・◯週に電話／打ち合わせ）／「時期だけ」（◯月頃・年明け など週や日が無い）／「資料送付」／「必要ならこちらから」（相手から連絡する・何かあれば）／「なし」。アポが決まった通話は null
- next_commit_q：その原文（40字以内）
- closed_window / closed_window_q：相手が「今年度は入れない・新しいものを検討する時期ではない・導入の予定はない」と、決める時期そのものが閉じていると言った（「今は忙しい」とは別）

# 注意
- 打診前と打診後を混ぜない。打診後に相手が課題を言っても own_problem は false。
- 判断できなければ false／""／null／「不明」。引用は原文から。`;
}

// Gemini の構造化出力に渡す形（項目と型を固定して、抜けや形の崩れを防ぐ）
const S = (t, extra = {}) => ({ type: t, ...extra });
const NS = (t, extra = {}) => ({ type: t, nullable: true, ...extra });
const E = (vals, nullable = false) => ({ type: "STRING", enum: vals, ...(nullable ? { nullable: true } : {}) });
const SCHEMA = {
  type: "OBJECT",
  properties: {
    contact_ok: S("BOOLEAN"), duration_sec: NS("INTEGER"), call_type_guess: E(["新規", "再アプローチ", "不明"]),
    purpose_sec: NS("INTEGER"), remember_q: S("BOOLEAN"), time_permission: S("BOOLEAN"), prior_ref: NS("BOOLEAN"),
    dup_neo: S("BOOLEAN"), list_bad: S("STRING"),
    asked: S("BOOLEAN"), ask_sec: NS("INTEGER"), ask_quote: NS("STRING"), ask_form: E(["日時2択", "日付1つ", "週・月だけ", "日付なし"], true), ask_minutes: NS("INTEGER"),
    own_problem: S("BOOLEAN"), own_problem_q: S("STRING"), lost_count: S("BOOLEAN"), lost_count_q: S("STRING"), rate_only: S("BOOLEAN"),
    denial: S("BOOLEAN"), denial_q: S("STRING"), upstream: S("BOOLEAN"), current_means: S("STRING"),
    means_gap: S("BOOLEAN"), means_gap_q: S("STRING"), means_ok: S("BOOLEAN"),
    constraint: E(["忙しい", "予算", "決裁", "LINE不可", "他ツール契約中", "なし"]),
    timing_info: S("BOOLEAN"), timing_info_q: S("STRING"), interest_q: S("BOOLEAN"), interest_q_q: S("STRING"),
    understood: E(["中身まで理解", "LINEで連絡するツール程度", "分かっていない", "不明"]),
    q_rate: S("INTEGER"), q_count: S("INTEGER"), q_open: S("INTEGER"), q_presumptive: S("INTEGER"),
    echo: S("BOOLEAN"), reason_from_customer: S("BOOLEAN"), explain_sec: S("INTEGER"),
    first_resp: E(["受諾", "時期", "要否", "他ツール", "予算", "決裁", "LINE不可", "資料希望", "その他"], true), first_resp_q: NS("STRING"),
    after: E(["日付を出し直す", "仮押さえ", "質問・掘り下げ", "説明を続ける", "撤退", "受諾なのでなし"], true),
    n_asks: S("INTEGER"), appo_in_call: S("BOOLEAN"), resp_types: { type: "ARRAY", items: S("STRING") },
    next_commit: E(["日付つき次回", "時期だけ", "資料送付", "必要ならこちらから", "なし"], true), next_commit_q: NS("STRING"),
    closed_window: S("BOOLEAN"), closed_window_q: S("STRING"),
  },
  required: ["contact_ok", "asked", "first_resp", "after", "appo_in_call", "next_commit", "denial", "q_presumptive", "closed_window"],
};

// 文字起こしを「[秒] 話者: 発言」の行にそろえる（Zoom・MiiTel・kinbot の形のどれでも受ける）
export function transcriptToLines(tr) {
  if (!tr) return "";
  if (typeof tr === "string") return tr;
  if (!Array.isArray(tr)) return String(tr.text || "");
  return tr.map((u) => {
    const sec = Number(u.sec ?? u.start ?? u.start_time ?? u.ts);
    const who = (u.speaker && (u.speaker.name || u.speaker)) || u.username || u.who || "";
    const head = isFinite(sec) ? `[${Math.round(sec)}s] ` : "";
    return `${head}${who ? who + ": " : ""}${u.text || u.content || ""}`;
  }).join("\n");
}

function parseJson(out) {
  if (out && typeof out === "object") return out;
  const s = String(out || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(s); } catch { return null; }
}

async function geminiDirect(user) {
  const key = String(process.env.GEMINI_API_KEY || "").trim();
  if (!key) throw new Error("GEMINI_API_KEY が未設定です");
  const model = process.env.GEMINI_TELEAPO_MODEL || "gemini-2.5-flash";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      // 項目が多いので出力枠は広めに、考える量は0に（考える分で枠を使い切って途中で切れるのを防ぐ）
      generationConfig: { temperature: 0, maxOutputTokens: 6144, responseMimeType: "application/json", responseSchema: SCHEMA, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}`);
  const d = await res.json();
  return ((d.candidates || [])[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
}

// 文字起こし1件を注釈する。返り値は注釈のオブジェクト（読めなければ例外）
export async function annotateCall({ transcript, product = DEFAULT_PRODUCT, callerName = "" } = {}) {
  const text = transcriptToLines(transcript).trim();
  if (text.length < 40) throw new Error("文字起こしが短すぎます（会話が無い通話は診断できません）");
  const user = `${prompt(product || DEFAULT_PRODUCT, callerName)}\n\n# 文字起こし\n"""\n${text.slice(0, 24000)}\n"""`;
  let out = null;
  try { out = await geminiDirect(user); } catch (e) { console.warn("[teleapo] Gemini で読めなかったので予備に切り替え：", e.message); }
  let ann = parseJson(out);
  if (!ann) ann = parseJson(await callLLMPublic(SYSTEM, user, 6000, { json: true }));
  if (!ann) throw new Error("AI の返事を読めませんでした。少し時間をおいてやり直してください");
  return { annotation: ann, transcriptText: text };
}
