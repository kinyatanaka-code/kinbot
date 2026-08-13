// server/salesforce.js
// Salesforce 連携（ユーザーごと）。トークンは salesforce_accounts に owner 単位で保存。
// 後日、SF側で「接続アプリ(Connected App)」を作成し、以下の環境変数を設定すると有効になります:
//   SF_CLIENT_ID, SF_CLIENT_SECRET, SF_LOGIN_URL(任意, 既定 https://login.salesforce.com)
import crypto from "crypto";
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

// PKCE（接続アプリで「PKCEの要求」がONのときに必須）
// 認証開始時に verifier を作り、その SHA-256 を challenge として送る。
// トークン交換のときに verifier をそのまま送ると、同じブラウザからの要求だと証明できる。
export function createPkce() {
  const verifier = crypto.randomBytes(48).toString("base64url"); // 64文字
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authUrl(redirectUri, state, codeChallenge) {
  const p = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "api refresh_token",
    state: state || "",
  });
  if (codeChallenge) {
    p.set("code_challenge", codeChallenge);
    p.set("code_challenge_method", "S256");
  }
  return `${LOGIN_URL}/services/oauth2/authorize?${p}`;
}

export async function exchangeCode(code, redirectUri, owner, codeVerifier) {
  const form = {
    grant_type: "authorization_code",
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: redirectUri,
  };
  if (codeVerifier) form.code_verifier = codeVerifier;
  const res = await fetch(`${LOGIN_URL}/services/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
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

// 接続先（本番／サンドボックス）が環境変数の設定と食い違っているトークンは無効扱いにする。
// 本番切替のときに、サンドボックスの古い連携が残って誤送信されるのを防ぐため。
const IS_SANDBOX_LOGIN = /test\.salesforce\.com/.test(LOGIN_URL);
export function tokenOrgMismatch(row) {
  const url = String((row && row.instance_url) || "");
  if (!url) return false;
  const tokenIsSandbox = /\.sandbox\.|--.*\.my\.salesforce\.com|\.cs[0-9]+\.my\.salesforce\.com/.test(url);
  return tokenIsSandbox !== IS_SANDBOX_LOGIN;
}

export async function isConnected(owner) {
  const row = await getSalesforceToken(owner);
  if (row && tokenOrgMismatch(row)) return false;
  return !!(row && row.refresh_token);
}
export async function disconnect(owner) {
  await deleteSalesforceToken(owner);
}
export async function connectionInfo(owner) {
  const row = await getSalesforceToken(owner);
  const mismatch = row ? tokenOrgMismatch(row) : false;
  return {
    configured: salesforceConfigured(),
    connected: !!(row && row.refresh_token) && !mismatch,
    instanceUrl: row?.instance_url || null,
    sfUser: row?.sf_user || null,
    loginUrl: LOGIN_URL,
    sandbox: IS_SANDBOX_LOGIN,
    orgMismatch: mismatch,
  };
}

// アクセストークンのキャッシュ（owner別・メモリ）。毎回リフレッシュせず、有効な間は使い回す。
const _sfTokenCache = new Map(); // owner -> { token, instanceUrl, exp }
export function clearSfTokenCache(owner) {
  if (owner) _sfTokenCache.delete(owner);
  else _sfTokenCache.clear();
}

// アクセストークン取得（有効な間はキャッシュ、失効時のみ refresh_token で更新）。{ token, instanceUrl } を返す
// 同じアカウントで同時に更新を走らせない。
// ローテーション設定の組織では、同時に2回更新すると片方が無効になり「expired」になるため。
const _sfRefreshing = new Map(); // owner -> Promise

async function getAccess(owner, force = false) {
  if (!force) {
    const c = _sfTokenCache.get(owner);
    if (c && c.exp > Date.now()) return { token: c.token, instanceUrl: c.instanceUrl };
  }
  // すでに更新中なら、その結果を待つ
  const running = _sfRefreshing.get(owner);
  if (running) return await running;
  const task = (async () => {
    try {
      return await refreshAccess(owner);
    } finally {
      _sfRefreshing.delete(owner);
    }
  })();
  _sfRefreshing.set(owner, task);
  return await task;
}

async function refreshAccess(owner) {
  const row = await getSalesforceToken(owner);
  if (!row || !row.refresh_token) return null;
  // 接続先が変わった（サンドボックス↔本番）場合は、古い連携を消して再連携させる
  if (tokenOrgMismatch(row)) {
    _sfTokenCache.delete(owner);
    await deleteSalesforceToken(owner).catch(() => {});
    console.warn(`[salesforce] 接続先が変わったため ${owner} の古い連携を解除しました（再連携が必要です）`);
    const e = new Error("SF_REAUTH: Salesforceの接続先が変わりました。設定から再連携してください。");
    e.sfReauth = true;
    throw e;
  }
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
  // リフレッシュトークンのローテーション対応：更新時に新しい refresh_token が返ってきたら保存する。
  // これをしないと、ローテーション設定の組織では古いトークンが無効化され、次回更新で失敗して再ログインになる。
  const patch = {};
  if (data.refresh_token && data.refresh_token !== row.refresh_token) patch.refreshToken = data.refresh_token;
  if (data.instance_url && data.instance_url !== row.instance_url) patch.instanceUrl = data.instance_url;
  if (Object.keys(patch).length) await saveSalesforceToken(owner, patch);
  // expires_in があれば利用、無ければ15分。上限1時間、1分の余裕を引く。
  const ttlSec = Number(data.expires_in) > 0 ? Number(data.expires_in) : 7200;
  const exp = Date.now() + Math.min(ttlSec, 7200) * 1000 - 5 * 60 * 1000;
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
// 連携している本人のSalesforceユーザーIDを取る（商談所有者の付け替えに使う）
const _sfUserIdCache = new Map(); // owner -> { id, exp }
// リードのレコードタイプ（クロス／直販など）を引く。
// 名前は組織ごとに違うので、一覧を返して呼び出し側で選ぶ。
let _leadRecordTypes = { at: 0, list: null };
export async function leadRecordTypes(owner) {
  if (_leadRecordTypes.list && Date.now() - _leadRecordTypes.at < 10 * 60 * 1000) {
    return _leadRecordTypes.list;
  }
  try {
    const d = await sfQuery(owner,
      `SELECT Id, Name, DeveloperName FROM RecordType WHERE SobjectType = 'Lead' AND IsActive = true`);
    const list = (d.records || []).map((r) => ({ id: r.Id, name: r.Name, dev: r.DeveloperName }));
    _leadRecordTypes = { at: Date.now(), list };
    return list;
  } catch (e) {
    console.warn("[sf] リードのレコードタイプを読めませんでした", e.message);
    return [];
  }
}

// 「クロス」にあたるレコードタイプを選ぶ
export async function crossLeadRecordTypeId(owner) {
  const list = await leadRecordTypes(owner);
  const hit = list.find((r) => /クロス|cross/i.test(`${r.name} ${r.dev}`));
  return hit ? hit.id : "";
}

// メールアドレスから、Salesforce上のユーザーIDを引く。
// 割り振られた担当者がkinbotでSF連携をしていなくても、商談の所有者にできるようにする。
const _sfUserByEmail = new Map();
export async function sfUserIdByEmail(owner, email) {
  const key = String(email || "").trim().toLowerCase();
  if (!key) return "";
  const c = _sfUserByEmail.get(key);
  if (c && c.exp > Date.now()) return c.id;
  try {
    const esc = key.replace(/'/g, "\\'");
    const d = await sfQuery(owner,
      `SELECT Id, Name FROM User WHERE IsActive = true AND Email = '${esc}' LIMIT 1`);
    const id = (d.records && d.records[0] && d.records[0].Id) || "";
    _sfUserByEmail.set(key, { id, exp: Date.now() + 10 * 60 * 1000 });
    return id;
  } catch (e) {
    console.warn("[sf] ユーザーを引けませんでした", key, e.message);
    return "";
  }
}

export async function getSfUserId(owner) {
  const c = _sfUserIdCache.get(owner);
  if (c && c.exp > Date.now()) return c.id;
  const acc = await getAccess(owner);
  if (!acc) return "";
  let id = "";
  try {
    const res = await fetch(`${acc.instanceUrl}/services/oauth2/userinfo`, {
      headers: { Authorization: `Bearer ${acc.token}` },
    });
    if (res.ok) {
      const d = await res.json();
      id = d.user_id || "";
    }
  } catch {}
  if (id) _sfUserIdCache.set(owner, { id, exp: Date.now() + 60 * 60 * 1000 });
  return id;
}

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

// 商談の価格表（Pricebook）を確保し、選べる商品（PricebookEntry）を返す
export async function getOpportunityProducts(owner, opportunityId) {
  const clean = (s) => String(s || "").replace(/[^a-zA-Z0-9]/g, "");
  let currentPbId = null;
  try {
    const od = await sfQuery(owner, `SELECT Pricebook2Id FROM Opportunity WHERE Id = '${clean(opportunityId)}'`);
    currentPbId = (od.records && od.records[0] && od.records[0].Pricebook2Id) || null;
  } catch {}
  let entries = [];
  try {
    const d = await sfQuery(owner, `SELECT Id, UnitPrice, Name, Product2.Name, Pricebook2Id, Pricebook2.Name, IsActive FROM PricebookEntry ORDER BY Pricebook2.Name, Name LIMIT 2000`);
    entries = (d.records || []).map((e) => ({
      id: e.Id,
      name: (e.Product2 && e.Product2.Name) || e.Name,
      unitPrice: e.UnitPrice,
      pricebookId: e.Pricebook2Id,
      pricebookName: (e.Pricebook2 && e.Pricebook2.Name) || "",
      active: e.IsActive !== false,
    }));
  } catch {}
  return { currentPricebookId: currentPbId, entries };
}

// 商談に登録済みの商品（OpportunityLineItem）一覧
export async function listOpportunityLineItems(owner, opportunityId) {
  if (!opportunityId) return [];
  const soql = `SELECT Id, Quantity, UnitPrice, TotalPrice, ServiceDate, PricebookEntry.Name, Product2.Name FROM OpportunityLineItem WHERE OpportunityId = '${String(opportunityId).replace(/[^a-zA-Z0-9]/g, "")}' ORDER BY CreatedDate DESC`;
  const d = await sfQuery(owner, soql);
  return (d.records || []).map((e) => ({
    id: e.Id,
    name: (e.Product2 && e.Product2.Name) || (e.PricebookEntry && e.PricebookEntry.Name) || "商品",
    quantity: e.Quantity, unitPrice: e.UnitPrice, totalPrice: e.TotalPrice, serviceDate: e.ServiceDate || "",
  }));
}

// 商品（OpportunityLineItem）を更新
export async function updateOpportunityLineItem(owner, id, fields) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/OpportunityLineItem/${id}`,
    { method: "PATCH", headers: { Authorization: `Bearer ${acc.token}`, "content-type": "application/json" }, body: JSON.stringify(fields || {}) }
  );
  if (!res.ok) throw new Error(`SF product update ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { ok: true };
}

// 商品（OpportunityLineItem）を削除
export async function deleteOpportunityLineItem(owner, id) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/OpportunityLineItem/${id}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${acc.token}` } }
  );
  if (!res.ok && res.status !== 204) throw new Error(`SF product delete ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return { ok: true };
}

// 商談商品（OpportunityLineItem）の項目定義（売上・原価・提供日など）を取得
export async function describeLineItem(owner) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/OpportunityLineItem/describe`,
    { headers: { Authorization: `Bearer ${acc.token}` } }
  );
  if (!res.ok) return [];
  const d = await res.json();
  return (d.fields || []).map((f) => ({
    name: f.name, label: f.label, type: f.type,
    createable: f.createable, updateable: f.updateable, custom: f.custom,
    required: !!(f.createable && f.nillable === false && !f.defaultedOnCreate),
    picklistValues: (f.picklistValues || []).filter((v) => v.active).map((v) => ({ value: v.value, label: v.label })),
  }));
}

// 商談に商品（OpportunityLineItem）を追加
export async function addOpportunityLineItem(owner, { opportunityId, pricebookEntryId, pricebookId, quantity, unitPrice, fields }) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  // 商談の価格表を、選んだ商品の価格表に合わせる（未設定または別価格表のとき）
  if (pricebookId) {
    try {
      const od = await sfQuery(owner, `SELECT Pricebook2Id FROM Opportunity WHERE Id = '${String(opportunityId).replace(/[^a-zA-Z0-9]/g, "")}'`);
      const cur = od.records && od.records[0] && od.records[0].Pricebook2Id;
      if (cur !== pricebookId) await updateOpportunity(owner, opportunityId, { Pricebook2Id: pricebookId });
    } catch {}
  }
  const body = { OpportunityId: opportunityId, PricebookEntryId: pricebookEntryId, Quantity: Number(quantity) || 1 };
  if (unitPrice !== undefined && unitPrice !== null && unitPrice !== "") body.UnitPrice = Number(unitPrice);
  if (fields && typeof fields === "object") Object.assign(body, fields); // 売上・原価・提供日など
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/OpportunityLineItem`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${acc.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`SF product ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// 取引先責任者（Contact）を作成
export async function createContact(owner, { accountId, lastName, firstName, title, email } = {}) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const body = { LastName: lastName || "（担当者）" };
  if (accountId) body.AccountId = accountId;
  if (firstName) body.FirstName = firstName;
  if (title) body.Title = title;
  if (email) body.Email = email;
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/Contact`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${acc.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`SF contact ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// 取引先（Account）に紐づく取引先責任者（Contact）一覧
export async function listAccountContacts(owner, accountId) {
  if (!accountId) return [];
  const soql = `SELECT Id, Name, Title, Email FROM Contact WHERE AccountId = '${String(accountId).replace(/[^a-zA-Z0-9]/g, "")}' ORDER BY LastModifiedDate DESC LIMIT 50`;
  const data = await sfQuery(owner, soql);
  return (data.records || []).map((c) => ({ id: c.Id, name: c.Name, title: c.Title || "", email: c.Email || "" }));
}

// 取引先責任者の役割（OpportunityContactRole）を作成／主担当設定
export async function createContactRole(owner, { opportunityId, contactId, role, isPrimary }) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const body = { OpportunityId: opportunityId, ContactId: contactId };
  if (role) body.Role = role;
  if (isPrimary) body.IsPrimary = true;
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/OpportunityContactRole`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${acc.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) throw new Error(`SF contact-role ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// OpportunityContactRoleの役割(Role)の選択肢
export async function describeContactRolePicklist(owner) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/OpportunityContactRole/describe`,
    { headers: { Authorization: `Bearer ${acc.token}` } }
  );
  if (!res.ok) return [];
  const d = await res.json();
  const f = (d.fields || []).find((x) => x.name === "Role");
  return ((f && f.picklistValues) || []).filter((v) => v.active).map((v) => v.value);
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

// Opportunityのページレイアウト（SS01〜SS06などのセクションと項目）を取得
export async function describeOpportunityLayout(owner) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/Opportunity/describe/layouts/`,
    { headers: { Authorization: `Bearer ${acc.token}` } }
  );
  if (!res.ok) throw new Error(`SF layout ${res.status}`);
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

// Task（活動）を削除
export async function deleteTask(owner, id) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/Task/${id}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${acc.token}` } }
  );
  if (!res.ok && res.status !== 204) throw new Error(`SF task delete ${res.status}: ${(await res.text()).slice(0, 200)}`);
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

// ===== リード（Lead）まわり：SF立ち上げ用 =====

// 任意のオブジェクトの項目定義を取る
export async function describeObject(owner, sobject) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const name = String(sobject).replace(/[^A-Za-z0-9_]/g, "");
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/${name}/describe`,
    { headers: { Authorization: `Bearer ${acc.token}` } }
  );
  if (!res.ok) throw new Error(`SF describe ${name} ${res.status}`);
  return res.json();
}

// 未コンバートのリードを、会社名や担当者名で探す
export async function searchLeads(owner, { company = "", person = "", limit = 20 } = {}) {
  const esc = (v) => String(v || "").replace(/['\\%_]/g, "").trim();
  const conds = ["IsConverted = false"];
  const c = esc(company), p = esc(person);
  // 会社名があるときは会社名でしぼる。担当者名は「その会社の中」でさらに絞るときだけ使う。
  // （会社名と担当者名をORにすると、別の会社のリードまで出てしまうため）
  if (c) {
    conds.push(`Company LIKE '%${c}%'`);
    if (p) conds.push(`(LastName LIKE '%${p}%' OR Name LIKE '%${p}%')`);
  } else if (p) {
    conds.push(`(LastName LIKE '%${p}%' OR Name LIKE '%${p}%')`);
  }
  const soql =
    `SELECT Id, Name, LastName, FirstName, Company, Title, Email, Phone, Status, Website, Street, City, State, PostalCode, NumberOfEmployees, LeadSource, RecordType.Name, CreatedDate, Owner.Name ` +
    `FROM Lead WHERE ${conds.join(" AND ")} ORDER BY CreatedDate DESC LIMIT ${Math.min(50, Number(limit) || 20)}`;
  const d = await sfQuery(owner, soql);
  return d.records || [];
}

// リードの項目を更新する
export async function updateLead(owner, id, fields) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const clean = String(id).replace(/[^a-zA-Z0-9]/g, "");
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/Lead/${clean}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bearer ${acc.token}`, "content-type": "application/json" },
      body: JSON.stringify(fields),
    }
  );
  if (res.status === 204) return { ok: true };
  const t = await res.text();
  throw new Error(`SF lead update ${res.status}: ${t}`);
}

// コンバート済みを表すリードステータスの一覧を取る。
// LeadStatus のラベルと Lead.Status の選択肢を突き合わせて、APIに渡せる値を返す。
export async function convertedLeadStatuses(owner) {
  let labels = [];
  try {
    const d = await sfQuery(owner, `SELECT MasterLabel FROM LeadStatus WHERE IsConverted = true ORDER BY SortOrder`);
    labels = (d.records || []).map((r) => r.MasterLabel).filter(Boolean);
  } catch {}
  let values = [];
  try {
    const desc = await describeObject(owner, "Lead");
    const f = (desc.fields || []).find((x) => x.name === "Status");
    values = ((f && f.picklistValues) || []).filter((v) => v.active).map((v) => ({ value: v.value, label: v.label || v.value }));
  } catch {}
  const norm = (v) => String(v || "").replace(/[\s　：:]/g, "");
  const out = [];
  for (const lb of labels) {
    const hit = values.find((v) => v.label === lb) ||
                values.find((v) => v.value === lb) ||
                values.find((v) => norm(v.label) === norm(lb) || norm(v.value) === norm(lb));
    out.push({ value: hit ? hit.value : lb, label: lb });
  }
  return out;
}

export async function convertedLeadStatus(owner) {
  const list = await convertedLeadStatuses(owner);
  return (list[0] && list[0].value) || "";
}

// リードをコンバートする（標準の convertLead アクションを使う）
export async function convertLead(owner, { leadId, convertedStatus, opportunityName, accountId, contactId, ownerId, doNotCreateOpportunity }) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const input = {
    leadId: String(leadId).replace(/[^a-zA-Z0-9]/g, ""),
    convertedStatus: convertedStatus || (await convertedLeadStatus(owner)),
  };
  if (opportunityName) input.opportunityName = opportunityName;
  if (accountId) input.accountId = accountId;
  if (contactId) input.contactId = contactId;
  if (ownerId) input.ownerId = ownerId;
  if (doNotCreateOpportunity) input.doNotCreateOpportunity = true;
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/actions/standard/convertLead`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${acc.token}`, "content-type": "application/json" },
      body: JSON.stringify({ inputs: [input] }),
    }
  );
  const data = await res.json().catch(() => null);
  const first = Array.isArray(data) ? data[0] : null;
  if (!res.ok || !first || first.isSuccess === false) {
    const raw = (first && first.errors && first.errors.map((e) => e.message).join(" / ")) ||
                (data && JSON.stringify(data)) || `SF convert ${res.status}`;
    // この組織で標準アクションが使えない場合は、SOAP APIのconvertLeadで実行する
    if (/Invalid Action Type|NOT_FOUND/i.test(raw)) {
      console.log("[SF立ち上げ] 標準アクションが使えないため、SOAPで実行します");
      const r = await convertLeadSoap(acc, input);
      return { ...r, via: "soap" };
    }
    throw new Error(`SF lead convert: ${raw}`);
  }
  const out = first.outputValues || {};
  const oppId = out.opportunityId || "";
  if (!oppId) {
    // コンバートは通ったのに商談IDが返らない場合がある。
    // 何が返ったかを残しておかないと原因を追えないので、記録する。
    console.error("[SF立ち上げ] 商談IDが返りませんでした",
      JSON.stringify({ leadId: input.leadId, outputValues: out }).slice(0, 500));
  }
  return {
    ok: true,
    accountId: out.accountId || "",
    contactId: out.contactId || "",
    opportunityId: oppId,
    raw: out,
    instanceUrl: acc.instanceUrl,
  };
}

// SOAP APIでのリードコンバート（標準アクションが使えない組織向け）
async function convertLeadSoap(acc, input) {
  const ver = String(API_VERSION).replace(/^v/, "");
  const esc = (v) => String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  const tag = (name, v) => (v ? `<${name}>${esc(v)}</${name}>` : "");
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:partner.soap.sforce.com">` +
    `<soapenv:Header><urn:SessionHeader><urn:sessionId>${esc(acc.token)}</urn:sessionId></urn:SessionHeader></soapenv:Header>` +
    `<soapenv:Body><urn:convertLead><urn:leadConverts>` +
    // ★項目の順番はSalesforceの定義どおりに並べる必要がある。
    //   順番が違うと opportunityName などが無視され、商談が作られないことがある。
    tag("urn:accountId", input.accountId) +
    tag("urn:contactId", input.contactId) +
    tag("urn:convertedStatus", input.convertedStatus) +
    `<urn:doNotCreateOpportunity>${input.doNotCreateOpportunity ? "true" : "false"}</urn:doNotCreateOpportunity>` +
    tag("urn:leadId", input.leadId) +
    tag("urn:opportunityName", input.opportunityName) +
    `<urn:overwriteLeadSource>false</urn:overwriteLeadSource>` +
    tag("urn:ownerId", input.ownerId) +
    `<urn:sendNotificationEmail>false</urn:sendNotificationEmail>` +
    `</urn:leadConverts></urn:convertLead></soapenv:Body></soapenv:Envelope>`;

  const res = await fetch(`${acc.instanceUrl}/services/Soap/u/${ver}`, {
    method: "POST",
    headers: { "content-type": "text/xml; charset=UTF-8", SOAPAction: '""' },
    body,
  });
  const xml = await res.text();
  const pick = (name) => {
    const m = xml.match(new RegExp(`<${name}>([^<]*)</${name}>`));
    return m ? m[1] : "";
  };
  const success = /<success>true<\/success>/.test(xml);
  if (success && !/<opportunityId>/.test(xml)) {
    console.error("[SF立ち上げ] SOAPで商談IDが返りませんでした",
      xml.replace(/\s+/g, " ").slice(0, 600));
  }
  if (!res.ok || !success) {
    const msg = pick("faultstring") || pick("message") || `SOAP convert ${res.status}`;
    throw new Error(`SF lead convert: ${msg}`);
  }
  return {
    ok: true,
    accountId: pick("accountId"),
    contactId: pick("contactId"),
    opportunityId: pick("opportunityId"),
    instanceUrl: acc.instanceUrl,
    via: "soap",
  };
}

// リードを新規作成する
export async function createLead(owner, fields) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/Lead`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${acc.token}`, "content-type": "application/json" },
      body: JSON.stringify(fields),
    }
  );
  const d = await res.json().catch(() => null);
  if (!res.ok || !d || d.success === false) {
    const msg = Array.isArray(d) ? d.map((x) => x.message).join(" / ") : (d && d.message) || `SF lead create ${res.status}`;
    throw new Error(`SF lead create: ${msg}`);
  }
  return { id: d.id, instanceUrl: acc.instanceUrl };
}

// ===== Salesforceのレポート =====

// レポートの一覧（名前で絞り込み可）
export async function listReports(owner, q = "", limit = 200) {
  const esc = String(q || "").replace(/['"\\%_]/g, "").trim();
  const where = esc ? ` WHERE Name LIKE '%${esc}%'` : "";
  const d = await sfQuery(
    owner,
    `SELECT Id, Name, DeveloperName, FolderName, Format, LastRunDate FROM Report${where} ORDER BY LastRunDate DESC NULLS LAST, Name LIMIT ${Math.min(500, Number(limit) || 200)}`
  );
  return (d.records || []).map((r) => ({
    id: r.Id, name: r.Name, folder: r.FolderName || "", format: r.Format || "", lastRun: r.LastRunDate || "",
  }));
}

// レポートを実行して、表として使える形に整える
export async function runReport(owner, reportId) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const id = String(reportId).replace(/[^a-zA-Z0-9]/g, "");
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/analytics/reports/${id}?includeDetails=true`,
    { headers: { Authorization: `Bearer ${acc.token}` } }
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = Array.isArray(data) ? data.map((e) => e.message).join(" / ") : (data && data.message) || `SF report ${res.status}`;
    throw new Error(`SF report: ${msg}`);
  }

  const meta = data.reportMetadata || {};
  const ext = data.reportExtendedMetadata || {};
  const info = ext.detailColumnInfo || {};
  const cols = (meta.detailColumns || []).map((name) => ({
    name,
    label: (info[name] && info[name].label) || name,
    type: (info[name] && info[name].dataType) || "string",
  }));

  // 明細行は factMap の "◯!T" に入っている（グルーピングがあるとキーが増える）
  const rows = [];
  const fm = data.factMap || {};
  for (const key of Object.keys(fm)) {
    if (!/!T$/.test(key)) continue;
    for (const r of (fm[key] && fm[key].rows) || []) {
      rows.push((r.dataCells || []).map((c) => (c.label != null ? c.label : c.value)));
    }
  }

  // 集計（グラフ用）。グルーピングごとの数値を取り出す。
  const groups = [];
  const gd = (data.groupingsDown && data.groupingsDown.groupings) || [];
  const aggInfo = ext.aggregateColumnInfo || {};
  const aggName = (meta.aggregates || [])[0] || Object.keys(aggInfo)[0] || "";
  const aggLabel = (aggInfo[aggName] && aggInfo[aggName].label) || "件数";
  for (const g of gd) {
    const cell = fm[`${g.key}!T`];
    const a = cell && cell.aggregates && cell.aggregates[0];
    groups.push({
      label: g.label || String(g.value || ""),
      value: a && typeof a.value === "number" ? a.value : Number(String((a && a.label) || "").replace(/[^\d.-]/g, "")) || 0,
      display: (a && a.label) || "",
    });
  }

  return {
    id,
    name: data.attributes?.reportName || meta.name || "",
    format: meta.reportFormat || "",
    columns: cols,
    rows,
    groups,
    aggLabel,
    truncated: data.allData === false,
    instanceUrl: acc.instanceUrl,
  };
}

// リードを一覧で取り出す（表・CSV用）
export async function exportLeads(owner, { days = 0, converted = "open", limit = 2000 } = {}) {
  const conds = [];
  if (converted === "open") conds.push("IsConverted = false");
  else if (converted === "converted") conds.push("IsConverted = true");
  if (days > 0) conds.push(`CreatedDate >= LAST_N_DAYS:${Math.min(365, Number(days) || 30)}`);
  const where = conds.length ? ` WHERE ${conds.join(" AND ")}` : "";
  const fields = [
    "Id", "Name", "Company", "Title", "Email", "Phone", "Status", "LeadSource",
    "Website", "State", "City", "NumberOfEmployees", "Owner.Name", "CreatedDate", "IsConverted",
  ];
  const d = await sfQuery(
    owner,
    `SELECT ${fields.join(", ")} FROM Lead${where} ORDER BY CreatedDate DESC LIMIT ${Math.min(2000, Number(limit) || 2000)}`
  );
  const labels = {
    Id: "ID", Name: "氏名", Company: "会社名", Title: "役職", Email: "メール", Phone: "電話",
    Status: "状況", LeadSource: "リードソース", Website: "Webサイト", State: "都道府県", City: "市区郡",
    NumberOfEmployees: "従業員数", "Owner.Name": "所有者", CreatedDate: "作成日", IsConverted: "コンバート済",
  };
  const columns = fields.map((f) => ({ name: f, label: labels[f] || f }));
  const rows = (d.records || []).map((r) =>
    fields.map((f) => {
      if (f === "Owner.Name") return (r.Owner && r.Owner.Name) || "";
      if (f === "CreatedDate") return String(r.CreatedDate || "").slice(0, 10);
      if (f === "IsConverted") return r.IsConverted ? "済" : "";
      return r[f] == null ? "" : String(r[f]);
    })
  );
  const acc = await getAccess(owner);
  return { id: "", name: "リード一覧", columns, rows, groups: [], instanceUrl: (acc && acc.instanceUrl) || "" };
}

// ダッシュボードの一覧
export async function listDashboards(owner, q = "", limit = 200) {
  const esc = String(q || "").replace(/['"\\%_]/g, "").trim();
  const where = esc ? ` WHERE Title LIKE '%${esc}%'` : "";
  const d = await sfQuery(
    owner,
    `SELECT Id, Title, DeveloperName, FolderName FROM Dashboard${where} ORDER BY Title LIMIT ${Math.min(500, Number(limit) || 200)}`
  );
  return (d.records || []).map((r) => ({ id: r.Id, name: r.Title, folder: r.FolderName || "" }));
}

// ダッシュボードの中身（どのコンポーネントがどのレポートを見ているか）
export async function describeDashboard(owner, dashboardId) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const id = String(dashboardId).replace(/[^a-zA-Z0-9]/g, "");
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/analytics/dashboards/${id}/describe`,
    { headers: { Authorization: `Bearer ${acc.token}` } }
  );
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = Array.isArray(data) ? data.map((e) => e.message).join(" / ") : (data && data.message) || `SF dashboard ${res.status}`;
    throw new Error(`SF dashboard: ${msg}`);
  }
  // 構造がバージョンで変わるので、reportId を持つオブジェクトを再帰的に集める
  const comps = [];
  const seen = new Set();
  const walk = (node, parentTitle) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach((x) => walk(x, parentTitle)); return; }
    const title = node.header || node.title || node.name || parentTitle || "";
    if (node.reportId && !seen.has(node.id + ":" + node.reportId)) {
      seen.add(node.id + ":" + node.reportId);
      comps.push({
        componentId: node.id || "",
        title: title || "(名称なし)",
        reportId: node.reportId,
        type: node.componentType || node.type || "",
      });
    }
    for (const k of Object.keys(node)) {
      if (k === "reportId") continue;
      walk(node[k], title);
    }
  };
  walk(data, "");
  return {
    id,
    name: data.name || data.title || "",
    description: data.description || "",
    components: comps,
    instanceUrl: acc.instanceUrl,
  };
}

// 商談を作る（コンバートで商談が作られなかったときの補い）
export async function createOpportunity(owner, { name, accountId, stageName, closeDate, ownerId, extra = {} }) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const body = {
    Name: name,
    AccountId: accountId,
    StageName: stageName,
    CloseDate: closeDate,
    ...(ownerId ? { OwnerId: ownerId } : {}),
    ...extra,
  };
  const res = await fetch(`${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/Opportunity`, {
    method: "POST",
    headers: { Authorization: `Bearer ${acc.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const d = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = Array.isArray(d) ? d.map((x) => x.message).join(" / ") : JSON.stringify(d || {});
    const err = new Error(`商談の作成に失敗しました: ${String(msg).slice(0, 300)}`);
    err.sf = d;
    throw err;
  }
  return d && d.id;
}

// 商談ステージの最初の値を取り出す（新規作成のときの初期値に使う）
export async function firstOpportunityStage(owner) {
  try {
    const desc = await describeOpportunity(owner);
    const f = (desc.fields || []).find((x) => x.name === "StageName");
    const vals = (f && f.picklistValues || []).filter((v) => v.active);
    // 「01：アポ獲得」のような番号付きがあれば、いちばん小さい番号を選ぶ
    const numbered = vals
      .map((v) => ({ v, n: (String(v.value).match(/^\s*0*(\d+)/) || [])[1] }))
      .filter((x) => x.n !== undefined)
      .sort((a, b) => Number(a.n) - Number(b.n));
    return (numbered[0] && numbered[0].v.value) || (vals[0] && vals[0].value) || "";
  } catch { return ""; }
}

// リードの中身を控える（立ち上げに失敗したときに作り直すため）
export async function snapshotLead(owner, leadId) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/Lead/${encodeURIComponent(leadId)}`,
    { headers: { Authorization: `Bearer ${acc.token}` } }
  );
  const d = await res.json().catch(() => null);
  if (!res.ok || !d) throw new Error("リードの内容を取得できませんでした");

  // 新しく作れる項目だけを残す（システム項目やコンバート結果は除く）
  let createable = null;
  try {
    const desc = await fetch(
      `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/Lead/describe`,
      { headers: { Authorization: `Bearer ${acc.token}` } }
    ).then((r) => r.json());
    createable = new Set((desc.fields || []).filter((f) => f.createable).map((f) => f.name));
  } catch {}

  const skip = /^(Id|IsConverted|Converted|CreatedBy|LastModifiedBy|SystemModstamp|IsDeleted|MasterRecord|Photo|EmailBounced|Jigsaw|Individual)/i;
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === null || v === undefined || typeof v === "object") continue;
    if (skip.test(k)) continue;
    if (createable && !createable.has(k)) continue;
    out[k] = v;
  }
  return out;
}

// レコードを消す（コンバートで新しく作られた取引先・取引先責任者の後始末）
export async function deleteRecord(owner, sobject, id) {
  if (!id) return false;
  const acc = await getAccess(owner);
  if (!acc) return false;
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/${sobject}/${encodeURIComponent(id)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${acc.token}` } }
  );
  return res.ok || res.status === 404;
}

// そのレコードが「たった今の変換で作られたもの」かを確かめる
export async function isFreshlyCreated(owner, sobject, id, withinSec = 300) {
  if (!id) return false;
  try {
    const d = await sfQuery(owner, `SELECT Id, CreatedDate FROM ${sobject} WHERE Id = '${String(id).replace(/[^a-zA-Z0-9]/g, "")}'`);
    const rec = (d.records || [])[0];
    if (!rec) return false;
    return Date.now() - new Date(rec.CreatedDate).getTime() < withinSec * 1000;
  } catch { return false; }
}
