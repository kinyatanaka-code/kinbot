// ===== kinbot OAuth 2.0（Claude.aiのカスタムコネクタ用） =====
// Claude.aiはカスタムコネクタ接続時、自動でOAuthのディスカバリ→動的クライアント登録→
// 認可コードフローを試みる。ここではその最低限を実装し、既存のログイン/APIトークンの
// 仕組みに乗せて「誰の権限で読むか」を決める。
//
// フロー概要:
//  1. GET /.well-known/oauth-authorization-server … 認可サーバーの場所を教える
//  2. POST /oauth/register … クライアント（Claude.ai）を登録し client_id を発行
//  3. GET  /oauth/authorize … ブラウザで承認画面（ログイン中ならそのまま/未ログインならログイン誘導）
//  4. POST /oauth/token … 認可コード（またはrefresh_token）→access_tokenに交換
//  5. 以後、Claude.aiは Authorization: Bearer <access_token> でMCPへアクセスする

import crypto from "node:crypto";
import {
  registerOauthClient,
  getOauthClient,
  saveOauthCode,
  consumeOauthCode,
  saveOauthToken,
  getOauthToken,
  getOauthTokenByRefresh,
  deleteOauthToken,
} from "./db.js";
import { getUser } from "./auth.js";

function randToken(prefix) {
  return `${prefix}_${crypto.randomBytes(24).toString("base64url")}`;
}
function baseUrl(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

export function mountOauthServer(app) {
  // ---- 1. 認可サーバーメタデータ（RFC 8414） ----
  app.get("/.well-known/oauth-authorization-server", (req, res) => {
    const b = baseUrl(req);
    res.json({
      issuer: b,
      authorization_endpoint: `${b}/oauth/authorize`,
      token_endpoint: `${b}/oauth/token`,
      registration_endpoint: `${b}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256", "plain"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    });
  });
  // ---- 保護リソースメタデータ（RFC 9728）。MCPエンドポイントが参照される想定 ----
  app.get("/.well-known/oauth-protected-resource", (req, res) => {
    const b = baseUrl(req);
    res.json({
      resource: `${b}/mcp`,
      authorization_servers: [b],
    });
  });

  // ---- 2. 動的クライアント登録（RFC 7591） ----
  app.post("/oauth/register", (req, res) => {
    const body = req.body || {};
    const client_id = randToken("kbtc");
    const redirect_uris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    registerOauthClient({ client_id, client_name: body.client_name || "", redirect_uris }).catch((e) =>
      console.error("[oauth] register", e.message)
    );
    res.status(201).json({
      client_id,
      client_name: body.client_name || "",
      redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  });

  // ---- 3. 認可エンドポイント（ブラウザで開かれる） ----
  app.get("/oauth/authorize", async (req, res) => {
    const { client_id, redirect_uri, state, code_challenge, code_challenge_method } = req.query;
    if (!client_id || !redirect_uri) return res.status(400).send("client_idとredirect_uriが必要です");
    const client = await getOauthClient(client_id).catch(() => null);
    // 既知のリダイレクト先か、初回登録時に渡されたURIと同一かをできる範囲で確認（緩め: 未登録クライアントは許可）
    const knownRedirects = client && Array.isArray(client.redirect_uris) ? client.redirect_uris : [];
    if (knownRedirects.length && !knownRedirects.includes(redirect_uri)) {
      return res.status(400).send("redirect_uriが登録内容と一致しません");
    }

    const user = getUser(req);
    if (!user) {
      // 未ログインなら、ログイン後にここへ戻ってくるようにして誘導
      const full = req.originalUrl || req.url || `/oauth/authorize?${new URLSearchParams(req.query || {}).toString()}`;
      const back = encodeURIComponent(full);
      return res.redirect(`/login.html?next=${back}`);
    }

    // ログイン済みなら承認画面を表示（既存の同意なしで即許可も可能だが、誰の権限で繋がるか分かるようにする）
    const params = new URLSearchParams({
      client_id: String(client_id), redirect_uri: String(redirect_uri),
      state: state ? String(state) : "", code_challenge: code_challenge ? String(code_challenge) : "",
      code_challenge_method: code_challenge_method ? String(code_challenge_method) : "",
    });
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8" />
      <title>kinbotへの接続を許可</title>
      <link rel="stylesheet" href="/style.css" /></head>
      <body style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:var(--bg,#f7f5ef);">
        <div style="background:#fff;border-radius:16px;padding:2rem 2.5rem;max-width:420px;box-shadow:0 10px 24px rgba(0,0,0,0.08);text-align:center;">
          <img src="/kinbot.svg" alt="" style="width:44px;margin-bottom:12px;" />
          <h2 style="margin:0 0 8px;font-size:17px;">kinbotへの接続を許可しますか？</h2>
          <p style="font-size:13px;color:#666;margin:0 0 20px;">Claude.aiが <b>${user.username}</b> の権限でkinbotのデータ（案件・商談の実績）を読み取れるようになります。</p>
          <form method="POST" action="/oauth/authorize">
            <input type="hidden" name="client_id" value="${client_id}" />
            <input type="hidden" name="redirect_uri" value="${redirect_uri}" />
            <input type="hidden" name="state" value="${state || ""}" />
            <input type="hidden" name="code_challenge" value="${code_challenge || ""}" />
            <input type="hidden" name="code_challenge_method" value="${code_challenge_method || ""}" />
            <button type="submit" name="decision" value="allow" class="btn" style="width:100%;margin-bottom:8px;">許可する</button>
            <button type="submit" name="decision" value="deny" class="btn ghost" style="width:100%;">許可しない</button>
          </form>
        </div>
      </body></html>`);
  });

  // 承認画面での「許可する/許可しない」の送信先
  app.post("/oauth/authorize", async (req, res) => {
    const { client_id, redirect_uri, state, code_challenge, decision } = req.body || {};
    const user = getUser(req);
    if (!user) return res.status(401).send("ログインが必要です");
    const url = new URL(redirect_uri);
    if (decision !== "allow") {
      url.searchParams.set("error", "access_denied");
      if (state) url.searchParams.set("state", state);
      return res.redirect(url.toString());
    }
    const code = randToken("kbtcode");
    await saveOauthCode({
      code, client_id, redirect_uri, owner: user.username, is_admin: !!user.admin,
      code_challenge: code_challenge || null,
    });
    url.searchParams.set("code", code);
    if (state) url.searchParams.set("state", state);
    res.redirect(url.toString());
  });

  // ---- 4. トークンエンドポイント ----
  app.post("/oauth/token", async (req, res) => {
    const body = req.body || {};
    const grantType = body.grant_type;
    try {
      if (grantType === "authorization_code") {
        const rec = await consumeOauthCode(body.code);
        if (!rec) return res.status(400).json({ error: "invalid_grant", error_description: "認可コードが無効または期限切れです" });
        // PKCE検証（code_verifierが送られてきた場合のみ、S256/plainどちらも許容）
        if (rec.code_challenge) {
          const verifier = body.code_verifier || "";
          const s256 = crypto.createHash("sha256").update(verifier).digest("base64url");
          if (verifier !== rec.code_challenge && s256 !== rec.code_challenge) {
            return res.status(400).json({ error: "invalid_grant", error_description: "PKCE検証に失敗しました" });
          }
        }
        const access_token = randToken("kbtat");
        const refresh_token = randToken("kbtrt");
        await saveOauthToken({ access_token, refresh_token, client_id: rec.client_id, owner: rec.owner, is_admin: rec.is_admin });
        return res.json({
          access_token, token_type: "Bearer", expires_in: 86400 * 90, refresh_token, scope: "mcp",
        });
      }
      if (grantType === "refresh_token") {
        const rec = await getOauthTokenByRefresh(body.refresh_token);
        if (!rec) return res.status(400).json({ error: "invalid_grant", error_description: "refresh_tokenが無効です" });
        await deleteOauthToken(rec.access_token);
        const access_token = randToken("kbtat");
        const refresh_token = randToken("kbtrt");
        await saveOauthToken({ access_token, refresh_token, client_id: rec.client_id, owner: rec.owner, is_admin: rec.is_admin });
        return res.json({ access_token, token_type: "Bearer", expires_in: 86400 * 90, refresh_token, scope: "mcp" });
      }
      return res.status(400).json({ error: "unsupported_grant_type" });
    } catch (e) {
      console.error("[oauth] token", e.message);
      res.status(500).json({ error: "server_error" });
    }
  });
}

// index.jsの認証ミドルウェアから呼ぶ: OAuthのBearerトークンならユーザーを解決する
export async function oauthTokenUser(bearer) {
  if (!bearer || !bearer.startsWith("kbtat_")) return null;
  const rec = await getOauthToken(bearer).catch(() => null);
  if (!rec) return null;
  return { username: rec.owner, admin: !!rec.is_admin };
}
