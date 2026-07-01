// server/retrieval.js
// 自社ナレッジの「賢い検索」。チャンク分割→埋め込み(ベクトル化)→商談内容に近い箇所だけ抽出。
// 埋め込みは Gemini(text-embedding-004) を既存の GEMINI_API_KEY で使用。
// キーが無い/失敗時は 文字2-gram のキーワード検索に自動フォールバック。
import {
  replaceKnowledgeChunks,
  deleteKnowledgeChunks,
  listKnowledgeChunks,
} from "./db.js";

const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const EMBED_MODEL = process.env.EMBED_MODEL || "text-embedding-004";
const CHUNK_SIZE = 600;
const CHUNK_OVERLAP = 120;
const MAX_CHUNKS_PER_DOC = 400;

export function embeddingsAvailable() {
  return !!GEMINI_KEY;
}

// テキストをチャンクに分割（文区切り優先、無理なら文字数で）
export function chunkText(text) {
  const clean = String(text || "").replace(/\r/g, "").trim();
  if (!clean) return [];
  // 文区切りの候補で大きく割ってから、サイズに詰める
  const sentences = clean.split(/(?<=[。．.!?！？\n])/);
  const chunks = [];
  let buf = "";
  for (const s of sentences) {
    if ((buf + s).length > CHUNK_SIZE && buf) {
      chunks.push(buf.trim());
      // オーバーラップ
      buf = buf.slice(Math.max(0, buf.length - CHUNK_OVERLAP)) + s;
    } else {
      buf += s;
    }
    if (chunks.length >= MAX_CHUNKS_PER_DOC) break;
  }
  if (buf.trim() && chunks.length < MAX_CHUNKS_PER_DOC) chunks.push(buf.trim());
  return chunks;
}

// Geminiバッチ埋め込み（最大100件/回）。失敗時 null。
async function embedBatch(texts) {
  if (!GEMINI_KEY || !texts.length) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:batchEmbedContents?key=${GEMINI_KEY}`;
  const out = [];
  for (let i = 0; i < texts.length; i += 100) {
    const slice = texts.slice(i, i + 100);
    const body = {
      requests: slice.map((t) => ({
        model: `models/${EMBED_MODEL}`,
        content: { parts: [{ text: t }] },
      })),
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`embed ${res.status}: ${(await res.text()).slice(0, 150)}`);
    const data = await res.json();
    for (const e of data.embeddings || []) out.push(e.values || null);
  }
  return out;
}

async function embedOne(text) {
  if (!GEMINI_KEY) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text }] } }),
  });
  if (!res.ok) throw new Error(`embed ${res.status}`);
  const data = await res.json();
  return data.embedding?.values || null;
}

// 1件のナレッジをインデックス化（チャンク＋埋め込み保存）
export async function indexKnowledge(id, { title, category, body }) {
  const chunks = chunkText(body);
  if (!chunks.length) {
    await deleteKnowledgeChunks(id);
    return { chunks: 0, embedded: false };
  }
  let vectors = null;
  try {
    vectors = await embedBatch(chunks);
  } catch (e) {
    console.error("[retrieval] embed失敗（キーワード検索にフォールバック）:", e.message);
    vectors = null;
  }
  const rows = chunks.map((t, i) => ({
    title,
    category,
    text: t,
    embedding: vectors && vectors[i] ? vectors[i] : null,
  }));
  await replaceKnowledgeChunks(id, rows);
  return { chunks: rows.length, embedded: !!vectors };
}

export async function removeKnowledgeIndex(id) {
  await deleteKnowledgeChunks(id);
}

function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return -1;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return -1;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// 文字2-gramのJaccardスコア（フォールバック用）
function bigrams(s) {
  const t = String(s || "").toLowerCase().replace(/\s+/g, "");
  const set = new Set();
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}
function jaccard(aSet, bStr) {
  const b = bigrams(bStr);
  if (!aSet.size || !b.size) return 0;
  let inter = 0;
  for (const g of aSet) if (b.has(g)) inter++;
  return inter / (aSet.size + b.size - inter);
}

// クエリに近い上位チャンクを抽出し、プロンプト用テキストを返す
export async function retrieve(queryText, { topK = 6, maxChars = 4000 } = {}) {
  const q = String(queryText || "").slice(-4000);
  if (!q.trim()) return "";
  let chunks = [];
  try {
    chunks = await listKnowledgeChunks();
  } catch {
    return "";
  }
  if (!chunks.length) return "";

  let ranked = [];
  let qvec = null;
  if (GEMINI_KEY) {
    try {
      qvec = await embedOne(q);
    } catch {
      qvec = null;
    }
  }
  const haveVectors = qvec && chunks.some((c) => Array.isArray(c.embedding));
  if (haveVectors) {
    ranked = chunks
      .map((c) => ({ c, score: Array.isArray(c.embedding) ? cosine(qvec, c.embedding) : -1 }))
      .sort((a, b) => b.score - a.score);
  } else {
    // フォールバック：2-gramキーワード
    const qset = bigrams(q);
    ranked = chunks
      .map((c) => ({ c, score: jaccard(qset, c.text) }))
      .sort((a, b) => b.score - a.score);
  }

  const picked = [];
  let used = 0;
  for (const { c, score } of ranked) {
    if (score <= 0) break;
    const line = `[${c.category || "資料"}] ${c.title || ""}: ${c.text}`;
    if (used + line.length > maxChars) continue;
    picked.push(line);
    used += line.length;
    if (picked.length >= topK) break;
  }
  return picked.join("\n");
}
