// server/persona.js
// kinbot の中で働く「AI社員」の人格。
// Google Chat で田中さんに話しかけるときの、名前と声（口調）をここでまとめる。
//
// 名前は kinbot の設定 aiName で変えられる（Chatで「名前を〇〇にして」でも変えられる）。
// 未設定なら、環境変数 AI_NAME → 既定 "キンタ" の順に決める。

const DEFAULT_NAME = (process.env.AI_NAME || "kinbot").trim() || "kinbot";

// 設定オブジェクトから、AI社員の名前を取り出す。
export function aiName(settings) {
  const n = String((settings && settings.aiName) || "").trim();
  return n || DEFAULT_NAME;
}

// 既定の名前のまま（＝まだ田中さんが名付けていない）か。
export function isDefaultName(settings) {
  return !String((settings && settings.aiName) || "").trim();
}

// 発言の頭に付ける「名乗り」。同じ人がずっと担当している感じを出す。
export function sign(settings) {
  return `${aiName(settings)}です。`;
}

// 一人称の返事を組み立てる。頭に名乗り、必要なら末尾に一言。
export function say(settings, body, tail) {
  return [sign(settings), String(body || "").trim(), tail ? String(tail).trim() : ""]
    .filter(Boolean).join("\n");
}

// 初対面（まだ名付けられていないとき）に添える一言。
export function nameHint(settings) {
  return isDefaultName(settings)
    ? `（いまの名前は「${aiName(settings)}」です。変えたいときは「名前を〇〇にして」と言ってください）`
    : "";
}
