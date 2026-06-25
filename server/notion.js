// server/notion.js — Notion連携（商談記録・分析レポートをNotion DBに蓄積）
const API = "https://api.notion.com/v1";
const VER = "2022-06-28";

const tokenOf = (cfg) => process.env.NOTION_TOKEN || (cfg && cfg.notionToken) || "";
const dbOf = (cfg) => process.env.NOTION_DB_ID || (cfg && cfg.notionDb) || "";

export function notionConfigured(cfg) {
  return !!(tokenOf(cfg) && dbOf(cfg));
}
export function notionStatus(cfg) {
  return { configured: notionConfigured(cfg), hasToken: !!tokenOf(cfg), db: dbOf(cfg) || "" };
}

async function api(path, method, body, tk) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: "Bearer " + tk, "Notion-Version": VER, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Notion ${method} ${path.split("/")[1]} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// DBのタイトル列名を取得（DBごとに名前が違うため）
async function titlePropName(dbId, tk) {
  try {
    const db = await api(`/databases/${dbId}`, "GET", null, tk);
    for (const [name, p] of Object.entries(db.properties || {})) if (p.type === "title") return name;
  } catch {}
  return "Name";
}

const rt = (s) => [{ type: "text", text: { content: String(s || "").slice(0, 1900) } }];
const para = (s) => ({ object: "block", type: "paragraph", paragraph: { rich_text: rt(s) } });
const h2 = (s) => ({ object: "block", type: "heading_2", heading_2: { rich_text: rt(s) } });
const bullet = (s) => ({ object: "block", type: "bulleted_list_item", bulleted_list_item: { rich_text: rt(s) } });
const bullets = (arr) => (Array.isArray(arr) ? arr : []).filter(Boolean).map(bullet);

// 商談1件をNotionページとして作成。作成したページURLを返す。
export async function createMeetingPage(cfg, m, { appUrl } = {}) {
  const tk = tokenOf(cfg), dbId = dbOf(cfg);
  if (!tk || !dbId) throw new Error("Notionのトークン/データベースIDが未設定です");
  const titleName = await titlePropName(dbId, tk);
  const props = { [titleName]: { title: rt(m.title || "商談") } };

  const children = [];
  children.push(para(`日時: ${new Date(m.created_at).toLocaleString("ja-JP")} ／ 担当: ${m.owner_name || m.owner || "-"} ／ フェーズ: ${m.phase || "-"}${m.account ? " ／ 取引先: " + m.account : ""}`));
  const s = m.summary || {};
  if (s.overview) { children.push(h2("要約")); children.push(para(s.overview)); }
  if (s.key_points?.length) { children.push(h2("論点・重要発言")); children.push(...bullets(s.key_points)); }
  if (s.agreements?.length) { children.push(h2("合意・確定事項")); children.push(...bullets(s.agreements)); }
  if (s.action_items?.length) { children.push(h2("ネクストアクション")); children.push(...bullets(s.action_items)); }
  if (s.customer_concerns?.length) { children.push(h2("相手の懸念")); children.push(...bullets(s.customer_concerns)); }

  const a = m.analysis;
  if (a && a.scores) {
    children.push(h2("スコア"));
    children.push(para(`ヒアリング ${a.scores.hearing ?? "-"} / 提案 ${a.scores.proposal ?? "-"} / クロージング ${a.scores.closing ?? "-"} / 傾聴 ${a.scores.listening ?? "-"}`));
  }
  if (a && a.feedback) {
    if (a.feedback.overall) { children.push(h2("講評")); children.push(para(a.feedback.overall)); }
    if (a.feedback.good_points?.length) { children.push(h2("良かった点")); children.push(...bullets(a.feedback.good_points)); }
    if (a.feedback.improvements?.length) { children.push(h2("改善点")); children.push(...bullets(a.feedback.improvements)); }
  }
  if (m.note) { children.push(h2("商談メモ")); children.push(para(m.note)); }
  if (appUrl) children.push(para("kinbotで開く: " + appUrl));

  // 文字起こし（全文）。長くなるので見出しの後に分割で追記する。
  const tr = Array.isArray(m.transcript) ? m.transcript : [];
  const transcriptBlocks = [];
  for (const u of tr) {
    const name = (u && u.speaker && u.speaker.name) || "話者";
    const text = (u && u.text) || "";
    if (!text) continue;
    // 1発言が長い場合は2000字制限内に分割
    for (let i = 0; i < text.length; i += 1800) {
      const chunk = text.slice(i, i + 1800);
      transcriptBlocks.push(bullet(`${i === 0 ? name + "： " : ""}${chunk}`));
    }
  }
  if (transcriptBlocks.length) children.push(h2("文字起こし"));

  // 最初の作成リクエストには95ブロックまで入れる
  const initial = children.slice(0, 95);
  const overflow = children.slice(95);
  // 見出しの後に入り切らなかった文字起こしも overflow に回す
  if (transcriptBlocks.length) {
    const room = Math.max(0, 95 - initial.length);
    for (let i = 0; i < transcriptBlocks.length; i++) {
      if (i < room) initial.push(transcriptBlocks[i]);
      else overflow.push(transcriptBlocks[i]);
    }
  }

  const page = await api("/pages", "POST", { parent: { database_id: dbId }, properties: props, children: initial }, tk);
  // 残りは append（90ブロックずつ）
  if (page?.id && overflow.length) {
    for (let i = 0; i < overflow.length; i += 90) {
      try {
        await api(`/blocks/${page.id}/children`, "PATCH", { children: overflow.slice(i, i + 90) }, tk);
      } catch (e) {
        console.error("[notion append]", e.message);
        break; // 失敗しても本体ページは作成済み
      }
    }
  }
  return page.url || null;
}

// 自由テキスト（Markdown風）をNotionページとして作成
function mdToBlocks(markdown) {
  const lines = String(markdown).replace(/\r/g, "").split("\n");
  const blocks = [];
  for (let raw of lines) {
    const line = raw.replace(/\*\*/g, "").trimEnd();
    if (!line.trim()) continue;
    let mm;
    if ((mm = line.match(/^#{1,2}\s+(.*)/))) blocks.push(h2(mm[1]));
    else if ((mm = line.match(/^#{3,}\s+(.*)/))) blocks.push(h2(mm[1]));
    else if ((mm = line.match(/^\s*[-*・]\s+(.*)/))) blocks.push(bullet(mm[1]));
    else if ((mm = line.match(/^\s*\d+[.)]\s+(.*)/)))
      blocks.push({ object: "block", type: "numbered_list_item", numbered_list_item: { rich_text: rt(mm[1]) } });
    else blocks.push(para(line));
    if (blocks.length >= 95) break;
  }
  return blocks.length ? blocks : [para(markdown.slice(0, 1900))];
}

export async function createReportPage(cfg, { title, markdown }) {
  const tk = tokenOf(cfg), dbId = dbOf(cfg);
  if (!tk || !dbId) throw new Error("Notionのトークン/データベースIDが未設定です");
  const titleName = await titlePropName(dbId, tk);
  const props = { [titleName]: { title: rt(title || "kinbot 分析レポート") } };
  const children = [para(`作成: ${new Date().toLocaleString("ja-JP")}（kinbot 分析レポート）`), ...mdToBlocks(markdown)];
  const page = await api("/pages", "POST", { parent: { database_id: dbId }, properties: props, children: children.slice(0, 95) }, tk);
  return page.url || null;
}

