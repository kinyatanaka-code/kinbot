// ===== kinbot MCP サーバー =====
// Claude.ai の「コネクタ」からkinbotのデータを直接読めるようにする。
// プロトコル: MCP Streamable HTTP transport（単一エンドポイントへのJSON-RPC 2.0 POST）。
// 認証: 既存のAPIトークン仕組みをそのまま使う（index.js の認証ミドルウェアで既に req.user が入っている前提）。
// 参考: https://modelcontextprotocol.io/

import {
  listDeals,
  listDealEvents,
  getDealWithEvents,
  listMeetings,
  getMeeting,
  listUsers,
  listRepTeams,
  listAccounts,
  getAccount,
  listActionItems,
  listDealStatuses,
  normCompanyKey,
} from "./db.js";

const SERVER_INFO = { name: "kinbot", version: "1.0.0" };
const PROTOCOL_VERSION = "2025-03-26";

// 担当者名の表示補正（index.jsのnameAliasesと同じルール。要確認: 変更したら両方直す）
function nameAliases() {
  const map = { "江田": "江田有一郎" };
  const raw = process.env.NAME_ALIASES || "";
  for (const part of raw.split(",")) {
    const [k, v] = part.split("=").map((x) => (x || "").trim());
    if (k && v) map[k] = v;
  }
  return map;
}
async function buildNameMap() {
  const byEmail = {};
  for (const u of (await listUsers().catch(() => []))) {
    if (u.email) byEmail[u.email.toLowerCase()] = u.name || u.email;
  }
  return { byEmail, aliases: nameAliases() };
}
function resolveDisplayName(raw, nameMap) {
  let s = String(raw || "").trim();
  if (!s) return "";
  if (s.includes("@") && nameMap && nameMap.byEmail[s.toLowerCase()]) s = nameMap.byEmail[s.toLowerCase()];
  if (nameMap && nameMap.aliases[s]) s = nameMap.aliases[s];
  return s;
}
// 会社名から新プロセスの状態を返す（案件画面の表示用）と同じ発想で、
// team指定があれば担当者→チームのマッピングでJS側フィルタする（deals.teamカラムに依存しない）
async function filterByTeam(events, team) {
  if (!team) return events;
  const nameMap = await buildNameMap();
  const teamMap = {};
  for (const t of (await listRepTeams().catch(() => []))) teamMap[(t.rep_name || "").trim()] = (t.team_name || "").trim();
  const teamOf = (rawOwner) => {
    const disp = resolveDisplayName(rawOwner, nameMap);
    return teamMap[(disp || "").trim()] || teamMap[(rawOwner || "").trim()] || "(未割り当て)";
  };
  const teamFilter = String(team).trim();
  return events.filter((e) => teamOf(e.owner) === teamFilter);
}

// ---- ツール定義（Claude に見せるスキーマ） ----
const TOOLS = [
  {
    name: "list_deals",
    description: "kinbotの案件一覧を取得する。会社名・担当者・チーム・ステータス（進行中/失注(未定)/失注(その他)/受注 等）・初回商談日を返す。各案件には会社プロフィール（company_profile：業界・従業員数(employees)・事業内容など。取得済みの会社のみ）も付与する。",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "担当者のメールアドレスで絞り込み（任意）" },
        team: { type: "string", description: "チーム名で絞り込み（任意）" },
        status: { type: "string", description: "ステータスで絞り込み（任意）例: 進行中, 失注(未定), 受注" },
        from: { type: "string", description: "初回商談日の開始日 YYYY-MM-DD（任意）" },
        to: { type: "string", description: "初回商談日の終了日 YYYY-MM-DD（任意）" },
      },
    },
  },
  {
    name: "get_deal_events",
    description: "kinbotの新営業プロセスの抽出イベントログを取得する（初回商談の判定結果・再商談の実施結果など）。実績集計の元データ。担当者ごとの比較分析（商談数、初回/再商談比率、次回商談設定率、confidence傾向、失注パターン、deal_kind別の進み方など）に使う。管理者トークンで接続している場合はownerを省略すると全担当者分が返る。",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string", description: "担当者のメールアドレスで絞り込み（任意・管理者のみ有効。省略すると全担当者分）" },
        team: { type: "string", description: "チーム名で絞り込み（任意）" },
        from: { type: "string", description: "イベント日の開始日 YYYY-MM-DD（任意）" },
        to: { type: "string", description: "イベント日の終了日 YYYY-MM-DD（任意）" },
        kind: { type: "string", description: "商談種別で絞り込み（初回商談 / 再商談）（任意）" },
      },
    },
  },
  {
    name: "get_deal_detail",
    description: "1つの案件（deal_id指定）について、案件情報と紐づく全イベント（初回商談・再商談）を取得する。会社プロフィール（company_profile：業界・従業員数(employees)・事業内容など。取得済みの会社のみ）も含む。",
    inputSchema: {
      type: "object",
      properties: { deal_id: { type: "string", description: "案件ID（list_dealsやget_deal_eventsのdeal_idから取得）" } },
      required: ["deal_id"],
    },
  },
  {
    name: "list_meetings",
    description: "kinbotに記録された商談（Recall.aiで録音・文字起こしされた商談）の一覧を取得する。要約・分析結果を含む。文字起こし全文は含まない（長すぎるため）。",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "get_meeting_detail",
    description: "1つの商談（bot_id指定）の詳細を取得する。文字起こし全文・要約・分析結果を含む。",
    inputSchema: {
      type: "object",
      properties: { bot_id: { type: "string", description: "商談のbot_id（list_meetingsのbot_idから取得）" } },
      required: ["bot_id"],
    },
  },
  {
    name: "get_account_detail",
    description: "1つの会社（案件画面の「案件」タブに相当）について、会社プロフィール（業界・従業員数・事業内容など）、ネクストアクション（やることリスト）、相手の懸念（過去の商談から集約）、手動設定されたステータス（進行中/失注/受注/保留）をまとめて取得する。会社名で指定する（部分一致でも検索する）。",
    inputSchema: {
      type: "object",
      properties: {
        company_name: { type: "string", description: "会社名（完全名でなくても、部分一致で近い会社を探す）" },
      },
      required: ["company_name"],
    },
  },
];

// 会社プロフィール（accountsテーブル）を会社名で引くためのマップ。
// 案件（deals）側のツールからも従業員数などを返せるようにするため。
async function buildProfileMap() {
  const accounts = await listAccounts().catch(() => []);
  const map = {};
  for (const a of accounts) {
    const k = normCompanyKey(a.key || a.official_name || "");
    if (k && a.profile) map[k] = a.profile;
  }
  return map;
}
function profileFromMap(map, companyName) {
  const k = normCompanyKey(companyName || "");
  if (!k) return null;
  if (map[k]) return map[k];
  for (const mk of Object.keys(map)) {
    if (mk.includes(k) || k.includes(mk)) return map[mk];
  }
  return null;
}

// ---- ツール実行 ----
// ChatGPT Custom GPT Actions 用の REST ラッパー(gpt_actions.js)からも再利用する。
export async function callTool(name, args, req) {
  const isAdmin = !!req.isAdmin;
  const owner = isAdmin ? (args && args.owner) || null : req.user;
  switch (name) {
    case "list_deals": {
      const rows = await listDeals({
        owner: owner || undefined,
        team: args && args.team,
        status: args && args.status,
        from: args && args.from,
        to: args && args.to,
      });
      // 会社プロフィール（業界・従業員数・事業内容など）を各案件に付与
      const pmap = await buildProfileMap();
      return rows.map((d) => ({ ...d, company_profile: profileFromMap(pmap, d.company_name) }));
    }
    case "get_deal_events": {
      let rows = await listDealEvents({
        owner: owner || undefined,
        from: args && args.from,
        to: args && args.to,
        kind: args && args.kind,
      });
      if (args && args.team) rows = await filterByTeam(rows, args.team);
      // raw_extraction は容量が大きいので、チャット向けには軽量化する
      return rows.map((r) => ({ ...r, raw_extraction: undefined }));
    }
    case "get_deal_detail": {
      if (!args || !args.deal_id) throw new Error("deal_id が必要です");
      const d = await getDealWithEvents(args.deal_id);
      if (!d) throw new Error("案件が見つかりません");
      // 案件詳細に会社プロフィール（業界・従業員数・事業内容など）を付与
      const pmap = await buildProfileMap();
      d.company_profile = profileFromMap(pmap, d.company_name);
      return d;
    }
    case "list_meetings": {
      const rows = await listMeetings({ owner: isAdmin ? null : req.user, isAdmin });
      // 文字起こし全文は除外（軽量化）。要約・分析は残す。
      return rows.map((m) => ({ ...m, transcript: undefined }));
    }
    case "get_meeting_detail": {
      if (!args || !args.bot_id) throw new Error("bot_id が必要です");
      const m = await getMeeting(args.bot_id);
      if (!m) throw new Error("商談が見つかりません");
      if (!isAdmin && m.owner && m.owner !== req.user) throw new Error("この商談を見る権限がありません");
      return m;
    }
    case "get_account_detail": {
      if (!args || !args.company_name) throw new Error("company_name が必要です");
      const key = normCompanyKey(args.company_name);
      // 自分の商談（管理者は全件）から、会社名が一致する商談を集める
      const allMeetings = await listMeetings({ owner: isAdmin ? null : req.user, isAdmin });
      let matched = allMeetings.filter((m) => m.account && normCompanyKey(m.account) === key);
      if (!matched.length) {
        // 完全一致が無ければ部分一致で探す
        matched = allMeetings.filter((m) => {
          const k2 = normCompanyKey(m.account || "");
          return k2 && (k2.includes(key) || key.includes(k2));
        });
      }
      // 会社プロフィール（従業員数など）と案件は、商談マッチに依存せず引く。
      // ※商談の account が未設定でも、プロフィール／案件があれば返せるようにする。
      const pmap = await buildProfileMap();
      const profile = profileFromMap(pmap, args.company_name);
      const allDeals = await listDeals({ owner: isAdmin ? null : req.user }).catch(() => []);
      const deal = allDeals.find((d) => normCompanyKey(d.company_name) === key)
        || allDeals.find((d) => { const k2 = normCompanyKey(d.company_name || ""); return k2 && (k2.includes(key) || key.includes(k2)); });
      // 商談・案件・プロフィールのどれも無いときだけ「該当なし」
      if (!matched.length && !deal && !profile) {
        throw new Error(`「${args.company_name}」に該当する会社が見つかりません`);
      }
      const accountName = (matched.length ? matched[matched.length - 1].account : null) || (deal && deal.company_name) || args.company_name;

      // ネクストアクション（やることリスト）
      const actionItems = await listActionItems(accountName).catch(() => []);

      // 相手の懸念（過去の商談から集約・重複除去）
      const concernsSeen = new Set();
      const concerns = [];
      for (const m of matched) {
        const cs = (m.summary && m.summary.customer_concerns) || [];
        for (const c of cs) {
          const k = String(c).replace(/\s+/g, "");
          if (k && !concernsSeen.has(k)) { concernsSeen.add(k); concerns.push(String(c)); }
        }
      }

      // 手動設定されたステータス（進行中/失注/受注/保留）
      const statuses = await listDealStatuses().catch(() => ({}));
      const dealStatus = statuses[accountName] || (deal && deal.status) || null;

      return {
        company_name: accountName,
        meeting_count: matched.length,
        deal_status: dealStatus,
        profile: profile || null,
        next_actions: actionItems.map((a) => ({ text: a.text, done: a.done, due_date: a.due_date })),
        customer_concerns: concerns,
        meetings: matched.map((m) => ({ bot_id: m.bot_id, title: m.title, created_at: m.created_at, owner: m.owner })),
      };
    }
    default:
      throw new Error(`不明なツール: ${name}`);
  }
}

// ---- JSON-RPC ハンドラ ----
async function handleRpc(body, req) {
  const { id, method, params } = body || {};
  const ok = (result) => ({ jsonrpc: "2.0", id, result });
  const err = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

  try {
    if (method === "initialize") {
      return ok({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }
    if (method === "notifications/initialized") {
      return null; // 通知には応答不要
    }
    if (method === "tools/list") {
      return ok({ tools: TOOLS });
    }
    if (method === "tools/call") {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      try {
        const data = await callTool(name, args, req);
        return ok({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
      } catch (e) {
        // ツール実行エラーはプロトコルエラーではなく、isError付きの結果として返すのがMCP流
        return ok({ content: [{ type: "text", text: `エラー: ${e.message}` }], isError: true });
      }
    }
    if (method === "ping") {
      return ok({});
    }
    return err(-32601, `メソッドが見つかりません: ${method}`);
  } catch (e) {
    return err(-32603, e.message || "内部エラー");
  }
}

// Expressにマウントする関数
export function mountMcpServer(app) {
  app.post("/mcp", async (req, res) => {
    const body = req.body;
    try {
      if (Array.isArray(body)) {
        const results = [];
        for (const item of body) {
          const r = await handleRpc(item, req);
          if (r) results.push(r);
        }
        if (!results.length) return res.status(202).end();
        return res.json(results.length === 1 ? results[0] : results);
      }
      const result = await handleRpc(body, req);
      if (!result) return res.status(202).end(); // 通知
      res.json(result);
    } catch (e) {
      console.error("[mcp]", e.message);
      res.status(500).json({ jsonrpc: "2.0", id: body && body.id, error: { code: -32603, message: e.message } });
    }
  });
  // 一部クライアントはGETでの疎通確認やSSE接続を試みるため、404ではなく明示的に返す
  app.get("/mcp", (req, res) => {
    try {
      res.status(200).json({ name: SERVER_INFO.name, protocol: "mcp", transport: "streamable-http" });
    } catch (e) {
      console.error("[mcp] GET failed", e && e.stack ? e.stack : e);
      res.status(500).end();
    }
  });
}
