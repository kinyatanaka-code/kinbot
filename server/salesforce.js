// server/salesforce.js
// Salesforce 連携（ユーザーごと）。トークンは salesforce_accounts に owner 単位で保存。
// 後日、SF側で「接続アプリ(Connected App)」を作成し、以下の環境変数を設定すると有効になります:
//   SF_CLIENT_ID, SF_CLIENT_SECRET, SF_LOGIN_URL(任意, 既定 https://login.salesforce.com)
import {
  getSalesforceToken,
  saveSalesforceToken,
  deleteSalesforceToken,
} from "./db.js";

const CLIENT_ID = process.env.SF_CLIENT_ID || "";
const CLIENT_SECRET = process.env.SF_CLIENT_SECRET || "";
// 本番組織: https://login.salesforce.com / Sandbox: https://test.salesforce.com
const LOGIN_URL = (process.env.SF_LOGIN_URL || "https://login.salesforce.com").replace(/\/+$/, "");
const API_VERSION = process.env.SF_API_VERSION || "v60.0";

export function salesforceConfigured() {
  return !!(CLIENT_ID && CLIENT_SECRET);
}

export function authUrl(redirectUri, state) {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "api refresh_token",
    state: state || "",
  });
  return `${LOGIN_URL}/services/oauth2/authorize?${p}`;
}

export async function exchangeCode(code, redirectUri, owner) {
  const res = await fetch(`${LOGIN_URL}/services/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`SF token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  await saveSalesforceToken(owner, {
    refreshToken: data.refresh_token || null,
    instanceUrl: data.instance_url || null,
    sfUser: data.id || null,
  });
  return data;
}

export async function isConnected(owner) {
  const row = await getSalesforceToken(owner);
  return !!(row && row.refresh_token);
}
export async function disconnect(owner) {
  await deleteSalesforceToken(owner);
}
export async function connectionInfo(owner) {
  const row = await getSalesforceToken(owner);
  return {
    configured: salesforceConfigured(),
    connected: !!(row && row.refresh_token),
    instanceUrl: row?.instance_url || null,
    sfUser: row?.sf_user || null,
    loginUrl: LOGIN_URL,
  };
}

// アクセストークン取得（refresh_token で都度更新）。{ token, instanceUrl } を返す
async function getAccess(owner) {
  const row = await getSalesforceToken(owner);
  if (!row || !row.refresh_token) return null;
  const res = await fetch(`${LOGIN_URL}/services/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: row.refresh_token,
    }),
  });
  if (!res.ok) {
    const errText = (await res.text()).slice(0, 200);
    const err = new Error(`SF refresh ${res.status}: ${errText}`);
    err.sfReauth = true; // フロントで再認証UIを出すためのフラグ
    throw err;
  }
  const data = await res.json();
  const instanceUrl = data.instance_url || row.instance_url;
  if (data.instance_url && data.instance_url !== row.instance_url) {
    await saveSalesforceToken(owner, { instanceUrl: data.instance_url });
  }
  return { token: data.access_token, instanceUrl };
}

// 商談URL/IDからレコードIDを抽出（15/18桁）
export function extractRecordId(input) {
  if (!input) return null;
  const s = String(input).trim();
  // /Opportunity/<id>/ 形式 か、URL内のID、または素のID
  const m =
    s.match(/\/([a-zA-Z0-9]{15,18})(?:\/|\?|$)/) ||
    s.match(/[?&]id=([a-zA-Z0-9]{15,18})/) ||
    s.match(/^([a-zA-Z0-9]{15,18})$/);
  return m ? m[1] : null;
}

// 商談レコードの指定フィールドを取得
export async function getOpportunity(owner, id, fields = []) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const q = fields.length ? `?fields=${encodeURIComponent(fields.join(","))}` : "";
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/Opportunity/${id}${q}`,
    { headers: { Authorization: `Bearer ${acc.token}` } }
  );
  if (!res.ok) throw new Error(`SF get ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// 商談レコードを更新
export async function updateOpportunity(owner, id, fields) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/Opportunity/${id}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${acc.token}`, "content-type": "application/json" },
      body: JSON.stringify(fields || {}),
    }
  );
  if (res.status === 204) return { ok: true };
  if (!res.ok) throw new Error(`SF update ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { ok: true };
}

// SOQL クエリ実行
export async function sfQuery(owner, soql) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/query?q=${encodeURIComponent(soql)}`,
    { headers: { Authorization: `Bearer ${acc.token}` } }
  );
  if (!res.ok) throw new Error(`SF query ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// 会社名で商談を検索（FIELDS(CUSTOM)で全カスタムフィールドも取得）
export async function searchOpportunities(owner, companyName) {
  const escaped = String(companyName || "").replace(/'/g, "\\'");

  // FIELDS(CUSTOM) はSalesforce API v51+で使用可能
  // 標準フィールド＋全カスタムフィールドを1クエリで取得
  try {
    const soql = `SELECT FIELDS(CUSTOM), Id, Name, StageName, Amount, CloseDate, NextStep, Description, AccountId, Account.Name
      FROM Opportunity
      WHERE Account.Name LIKE '%${escaped}%'
      ORDER BY LastModifiedDate DESC
      LIMIT 20`;
    const result = await sfQuery(owner, soql);
    return result.records || [];
  } catch (e) {
    // FIELDS(CUSTOM)がサポートされない場合はフォールバック
    console.warn("[sf] FIELDS(CUSTOM) failed, falling back:", e.message);
    const soql = `SELECT Id, Name, StageName, Amount, CloseDate, NextStep, Description, AccountId, Account.Name
      FROM Opportunity
      WHERE Account.Name LIKE '%${escaped}%'
      ORDER BY LastModifiedDate DESC
      LIMIT 20`;
    const result = await sfQuery(owner, soql);
    return result.records || [];
  }
}

// Stageの選択肢を取得
export async function getStageValues(owner) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/Opportunity/describe`,
    { headers: { Authorization: `Bearer ${acc.token}` } }
  );
  if (!res.ok) throw new Error(`SF describe ${res.status}`);
  const data = await res.json();
  const stageField = (data.fields || []).find(f => f.name === "StageName");
  if (!stageField) return [];
  return (stageField.picklistValues || []).filter(v => v.active).map(v => ({ value: v.value, label: v.label }));
}

// 商談にChatter投稿（ログ/ネクストアクション）
export async function postChatter(owner, opportunityId, text) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/chatter/feed-elements`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${acc.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        feedElementType: "FeedItem",
        subjectId: opportunityId,
        body: { messageSegments: [{ type: "Text", text }] },
      }),
    }
  );
  if (!res.ok) throw new Error(`SF chatter ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Opportunityの全フィールド情報を取得（API名の確認用）
export async function describeOpportunity(owner) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/Opportunity/describe`,
    { headers: { Authorization: `Bearer ${acc.token}` } }
  );
  if (!res.ok) throw new Error(`SF describe ${res.status}`);
  return res.json();
}

// Task（活動）を作成
export async function createTask(owner, data) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/Task`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${acc.token}`, "content-type": "application/json" },
      body: JSON.stringify(data),
    }
  );
  if (!res.ok) throw new Error(`SF task ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}
