// ───────────────────────────────────────────────────────────
// devnotes.js — 「直したいこと」を自動でためて、朝にまとめる
//
// 田中さんが商談中でも寝ていても、kinbotが自分で気づいたことをためます。
//   ・Chatに「要望 …」と送ったもの
//   ・うまくいかなかった処理（SFの立ち上げ・メール・スキャンなど）
//   ・Chatで答えられなかった質問（＝足りない機能）
//   ・画面やAPIで起きたエラー
//
// 同じ内容は1件にまとめ、回数だけ増やします。
// 朝6時に、AIが「開発要件」の形に整えてChatへ流します。
// ───────────────────────────────────────────────────────────
import { addDevNote, listDevNotes } from "./db.js";

export const NOTE_KINDS = {
  request: "要望",
  bug: "不具合",
  error: "エラー",
  gap: "できないこと",
  idea: "アイデア",
};

// 記録する。失敗しても本体の処理は止めない。
export async function note({ key, kind = "error", title, detail = "", source = "auto", by = "" }) {
  try {
    const r = await addDevNote({ key, kind, title, detail, source, createdBy: by });
    if (r && r.hits === 1) console.log(`[dev-note] 新しく記録：${title}`);
    return r;
  } catch { return null; }
}

// 短くまとめた見出しを作る（同じ種類のエラーを1件にまとめるため）
export function errKey(where, message) {
  const m = String(message || "")
    .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, "<日時>")   // 日時
    .replace(/\b[0-9a-f]{8,}\b/gi, "<id>")                  // ID
    .replace(/\d+/g, "<数>")                                 // 数字
    .slice(0, 160);
  return `${where}:${m}`;
}

// 朝のまとめ。AIに「開発要件」の形へ整えてもらう。
// AIが使えないときは、そのまま一覧にする。
export async function buildMorningSummary(callLLM) {
  const rows = await listDevNotes({ status: "new", limit: 60 });
  if (!rows.length) return { empty: true, text: "" };

  const byKind = {};
  for (const r of rows) (byKind[r.kind] = byKind[r.kind] || []).push(r);

  const material = rows.map((r) =>
    `- [${NOTE_KINDS[r.kind] || r.kind}] ${r.title}` +
    `${r.hits > 1 ? `（${r.hits}回）` : ""}` +
    `${r.detail ? `\n    ${String(r.detail).replace(/\n/g, " ").slice(0, 300)}` : ""}`
  ).join("\n");

  let body = "";
  if (callLLM) {
    try {
      const system =
        "あなたはB2B営業支援システム kinbot の開発を手伝う人です。" +
        "現場から集まった「直したいこと」の一覧を読み、開発者がそのまま着手できる形に整えてください。\n" +
        "決まり:\n" +
        "- 日本語。むずかしい言葉を使わない。\n" +
        "- 似たものはまとめる。\n" +
        "- 影響が大きい順・回数が多い順に並べる。多くても6件まで。\n" +
        "- 1件につき「何が起きているか」「どう直すか（案）」を1行ずつ。\n" +
        "- 出力は次の形だけ。前置きや締めの言葉は書かない。\n" +
        "1. 見出し\n   いま：〜\n   直し方：〜\n";
      body = await callLLM(system, `直したいことの一覧:\n${material}`, 1200, { json: false });
    } catch (e) {
      console.warn("[dev-note] AIでまとめられませんでした:", e.message);
    }
  }
  if (!body) body = material;

  const counts = Object.entries(byKind)
    .map(([k, v]) => `${NOTE_KINDS[k] || k} ${v.length}`).join("／");

  return {
    empty: false,
    count: rows.length,
    text: [
      "🌅 *今日の開発メモ*",
      `未対応 ${rows.length}件（${counts}）`,
      "",
      String(body).trim(),
      "",
      "（Chatに「要望 〜」と送ると、ここに溜まります）",
    ].join("\n"),
  };
}
