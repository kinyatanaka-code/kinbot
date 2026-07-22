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

// トークン失敗時に、接続先（本番/サンドボックス）と実際の送信元IPをログに出す。
// ip restricted の原因（組織のズレ／IPのズレ）をログだけで切り分けるため。
async function logSfDiag(where, body) {
  let ip = "?";
  try { ip = (await (await fetch("https://api.ipify.org")).text()).trim(); } catch {}
  const sandbox = /test\.salesforce\.com/.test(LOGIN_URL);
  console.error(
    `[salesforce/diag] ${where} 失敗 | 接続先=${LOGIN_URL}（${sandbox ? "サンドボックス" : "本番"}）` +
    ` | 送信元IP=${ip} | client_id先頭=${(CLIENT_ID || "").slice(0, 14)} | 応答=${body}`
  );
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
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    await logSfDiag("exchangeCode(初回連携)", body);
    throw new Error(`SF token ${res.status}: ${body}`);
  }
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

// アクセストークンのキャッシュ（owner別・メモリ）。毎回リフレッシュせず、有効な間は使い回す。
const _sfTokenCache = new Map(); // owner -> { token, instanceUrl, exp }
export function clearSfTokenCache(owner) {
  if (owner) _sfTokenCache.delete(owner);
  else _sfTokenCache.clear();
}

// アクセストークン取得（有効な間はキャッシュ、失効時のみ refresh_token で更新）。{ token, instanceUrl } を返す
async function getAccess(owner, force = false) {
  if (!force) {
    const c = _sfTokenCache.get(owner);
    if (c && c.exp > Date.now()) return { token: c.token, instanceUrl: c.instanceUrl };
  }
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
    _sfTokenCache.delete(owner);
    const errText = (await res.text()).slice(0, 200);
    await logSfDiag("refresh(トークン更新)", errText);
    const err = new Error(`SF refresh ${res.status}: ${errText}`);
    err.sfReauth = true; // フロントで再認証UIを出すためのフラグ
    throw err;
  }
  const data = await res.json();
  const instanceUrl = data.instance_url || row.instance_url;
  if (data.instance_url && data.instance_url !== row.instance_url) {
    await saveSalesforceToken(owner, { instanceUrl: data.instance_url });
  }
  // expires_in があれば利用、無ければ15分。上限1時間、1分の余裕を引く。
  const ttlSec = Number(data.expires_in) > 0 ? Number(data.expires_in) : 900;
  const exp = Date.now() + Math.min(ttlSec, 3600) * 1000 - 60 * 1000;
  _sfTokenCache.set(owner, { token: data.access_token, instanceUrl, exp });
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

export async function describeTask(owner) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/Task/describe`,
    { headers: { Authorization: `Bearer ${acc.token}` } }
  );
  if (!res.ok) throw new Error(`SF describe task ${res.status}`);
  return res.json();
}

// Task（活動）を作成
export async function createTask(owner, data) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const payload = { ...data };
  // この組織に無い項目（例: Task.Type が無効）は自動で外して再送する
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(
      `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/Task`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${acc.token}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    if (res.ok) return res.json();
    const text = (await res.text()).slice(0, 400);
    const m = text.match(/No such column '([^']+)' on sobject/i);
    if (res.status === 400 && m && Object.prototype.hasOwnProperty.call(payload, m[1])) {
      delete payload[m[1]]; // 存在しない項目を除いて再送
      continue;
    }
    throw new Error(`SF task ${res.status}: ${text}`);
  }
  throw new Error("SF task: 項目を調整しても作成できませんでした");
}

// Task（活動）を更新（存在しない・更新不可の項目は自動で外して再送）
export async function updateTask(owner, id, data) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const payload = { ...data };
  delete payload.WhatId; delete payload.Id;
  if (!Object.keys(payload).length) return true;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(
      `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/Task/${id}`,
      {
        method: "PATCH",
        headers: { Authorization: `Bearer ${acc.token}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    if (res.ok) return true;
    const text = (await res.text()).slice(0, 400);
    const m = text.match(/No such column '([^']+)' on sobject/i) || text.match(/Unable to create\/update fields: ([^.]+)/i);
    if (res.status === 400 && m) {
      const bad = m[1].split(/[,\s]+/).filter(Boolean);
      let removed = false;
      for (const b of bad) { if (Object.prototype.hasOwnProperty.call(payload, b)) { delete payload[b]; removed = true; } }
      if (removed && Object.keys(payload).length) continue;
      return true; // 送れる項目が無くなった場合は完了扱い
    }
    throw new Error(`SF task update ${res.status}: ${text}`);
  }
  return true;
}

// ───────────────────────────────────────────────────────────
// 自動連携（空欄補完 + 活動履歴）用のヘルパー
// ───────────────────────────────────────────────────────────

// Account（取引先）の指定フィールドを取得
export async function getAccount(owner, id, fields = []) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const q = fields.length ? `?fields=${encodeURIComponent(fields.join(","))}` : "";
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/Account/${id}${q}`,
    { headers: { Authorization: `Bearer ${acc.token}` } }
  );
  if (!res.ok) throw new Error(`SF get account ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Account を更新
export async function updateAccount(owner, id, fields) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/Account/${id}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${acc.token}`, "content-type": "application/json" },
      body: JSON.stringify(fields || {}),
    }
  );
  if (res.status === 204) return { ok: true };
  if (!res.ok) throw new Error(`SF update account ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { ok: true };
}

// SFの「空」を型ごとに正しく判定する。
// null / undefined / "" / 空白のみ を空とみなす。0・false・日付0値は「入力あり」として絶対に上書きしない。
export function isSfFieldEmpty(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  // 数値0 / boolean false / オブジェクト(参照) は「値あり」扱い（=補完対象外）
  return false;
}

// 「空欄だけ埋める」共通処理。
//   sobject: "Opportunity" | "Account"
//   id:      レコードID
//   proposed: { <SF API名>: <埋めたい値> } の候補
// 現在値を読み → 空の項目だけ → 空でない候補値がある場合のみ PATCH。
// 戻り値: { filled: {…実際に書いた項目}, skipped: {…既に値があり触らなかった項目} }
export async function fillEmptyFields(owner, sobject, id, proposed) {
  const cands = proposed || {};
  const fieldNames = Object.keys(cands).filter((k) => k);
  if (fieldNames.length === 0) return { filled: {}, skipped: {} };

  const current =
    sobject === "Account"
      ? await getAccount(owner, id, fieldNames)
      : await getOpportunity(owner, id, fieldNames);

  const toWrite = {};
  const filled = {};
  const skipped = {};
  for (const name of fieldNames) {
    const proposedVal = cands[name];
    // 埋める値自体が空なら何もしない
    if (isSfFieldEmpty(proposedVal)) continue;
    if (isSfFieldEmpty(current[name])) {
      toWrite[name] = proposedVal;
      filled[name] = proposedVal;
    } else {
      skipped[name] = current[name];
    }
  }

  if (Object.keys(toWrite).length > 0) {
    if (sobject === "Account") await updateAccount(owner, id, toWrite);
    else await updateOpportunity(owner, id, toWrite);
  }
  return { filled, skipped };
}

// kinbotの商談ID(botId)で既存Taskを検索（重複登録の防止キー）。
// SF側に用意したカスタム項目 kinbot_bot_id__c を使う。
const KINBOT_TASK_KEY = process.env.SF_TASK_KEY_FIELD || "kinbot_bot_id__c";

export async function findTaskByBotId(owner, botId) {
  if (!botId) return null;
  const escaped = String(botId).replace(/'/g, "\\'");
  try {
    const soql = `SELECT Id, Subject FROM Task WHERE ${KINBOT_TASK_KEY} = '${escaped}' LIMIT 1`;
    const r = await sfQuery(owner, soql);
    return (r.records && r.records[0]) || null;
  } catch (e) {
    // カスタム項目が未作成の組織では検索が失敗する → 重複防止は諦めるが処理は続行
    console.warn("[sf] findTaskByBotId failed (項目未作成の可能性):", e.message);
    return null;
  }
}

// 活動履歴を「冪等に」1件作成する。同じbotIdのTaskが既にあれば作らない。
//   data: { WhatId(必須:商談ID), WhoId?, Subject, Type?, Description, Status, ActivityDate }
// 戻り値: { created:boolean, taskId, existing:boolean }
export async function createTaskIdempotent(owner, botId, data) {
  const existing = await findTaskByBotId(owner, botId);
  if (existing) return { created: false, existing: true, taskId: existing.Id };

  const payload = { ...data };
  // 重複防止キーを埋め込む（項目が無い組織では createTask が 400 になるため、その場合はキー無しで再試行）
  if (botId) payload[KINBOT_TASK_KEY] = String(botId);
  try {
    const task = await createTask(owner, payload);
    return { created: true, existing: false, taskId: task.id || task.Id };
  } catch (e) {
    if (botId && /kinbot_bot_id|No such column|INVALID_FIELD/i.test(e.message)) {
      // カスタム項目が未作成 → キー無しで作成（重複防止は効かない旨は呼び出し側で警告）
      const { [KINBOT_TASK_KEY]: _drop, ...noKey } = payload;
      const task = await createTask(owner, noKey);
      return { created: true, existing: false, taskId: task.id || task.Id, keyMissing: true };
    }
    throw e;
  }
}
