// ===== kinbot REST API（ChatGPT Custom GPT Actions 用）=====
// ChatGPTのCustom GPT Actionsは MCP(JSON-RPC) を直接呼べない。
// そこで、MCPと同じ6ツールのロジック（mcp.js の callTool）を
// そのまま普通のREST(GET)として公開する薄いラッパー。
//
// 認証: index.js のグローバル認証ミドルウェアがそのまま効く。
//   Authorization: Bearer <APIトークン> を送ればよい（/api/ 配下なので保護済み）。
//   管理者トークンなら owner 省略時に全担当者分が返る。
//
// OpenAPIスキーマ: docs/gpt-actions-openapi.yaml を GPT Builder の Actions に貼り付ける。

import { callTool } from "./mcp.js";

// callTool はデータをそのまま返す or Error を throw する。
// それをHTTPレスポンスに変換する共通ハンドラ。
function handle(toolName, buildArgs) {
  return async (req, res) => {
    try {
      const args = buildArgs(req);
      const data = await callTool(toolName, args, req);
      res.json(data);
    } catch (e) {
      const msg = e && e.message ? e.message : "エラーが発生しました";
      // 「見つかりません」系は 404、引数不足などは 400
      const notFound = /見つかりません|該当/.test(msg);
      res.status(notFound ? 404 : 400).json({ error: msg });
    }
  };
}

export function mountGptActions(app) {
  // 案件一覧
  app.get("/api/gpt/deals", handle("list_deals", (req) => ({
    owner: req.query.owner,
    team: req.query.team,
    status: req.query.status,
    from: req.query.from,
    to: req.query.to,
  })));

  // 案件詳細（案件情報＋紐づく全イベント）
  app.get("/api/gpt/deals/:deal_id", handle("get_deal_detail", (req) => ({
    deal_id: req.params.deal_id,
  })));

  // 営業プロセスの抽出イベントログ（実績集計の元データ）
  app.get("/api/gpt/deal-events", handle("get_deal_events", (req) => ({
    owner: req.query.owner,
    team: req.query.team,
    from: req.query.from,
    to: req.query.to,
    kind: req.query.kind,
  })));

  // 商談一覧（要約・分析つき、文字起こし全文は除く）
  app.get("/api/gpt/meetings", handle("list_meetings", () => ({})));

  // 商談詳細（文字起こし全文つき）
  app.get("/api/gpt/meetings/:bot_id", handle("get_meeting_detail", (req) => ({
    bot_id: req.params.bot_id,
  })));

  // 会社詳細（プロフィール・ネクストアクション・懸念・ステータス）
  // 会社名は特殊文字(/等)を含みうるのでパスではなくクエリで受ける
  app.get("/api/gpt/account", handle("get_account_detail", (req) => ({
    company_name: req.query.company_name,
  })));
}
