// server/ingest.js
// 資料をテキスト化して自社ナレッジに蓄積するための取り込み処理。
// PDF（pdf-parse）とWebサイトURL（HTML→テキスト）に対応。

const MAX_CHARS = 200000; // 1件あたりの保存上限（暴発防止）

function clip(s) {
  const t = (s || "").replace(/\u0000/g, "").trim();
  return t.length > MAX_CHARS ? t.slice(0, MAX_CHARS) : t;
}

// PDFバッファ → テキスト
export async function pdfToText(buffer) {
  // pdf-parse は CommonJS。デバッグ用ハーネスを避けるため lib を直接読み込む。
  const mod = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = mod.default || mod;
  const data = await pdfParse(buffer);
  return clip(data.text || "");
}

// HTML → テキスト（簡易抽出）
function htmlToText(html) {
  let s = String(html || "");
  // タイトル抽出
  const titleMatch = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : "";
  // スクリプト/スタイル/noscript除去
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // 改行になりやすいブロック要素
  s = s.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n");
  // 残りのタグ除去
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  s = s.replace(/[ \t\u00a0]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text: clip(s) };
}

function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

// URL → { title, text }
export async function urlToText(url) {
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; kinbot/1.0)" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`取得失敗 ${res.status}`);
  const ctype = res.headers.get("content-type") || "";
  if (ctype.includes("application/pdf")) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { title: url, text: await pdfToText(buf) };
  }
  const html = await res.text();
  const { title, text } = htmlToText(html);
  return { title: title || url, text };
}
