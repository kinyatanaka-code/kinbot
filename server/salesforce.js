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

// Salesforceのトークン発行POST。「retry your request」等の一時エラーは、少し待って数回やり直す。
// Salesforce公式もこのエラーは再試行を推奨している（unknown_error / server_error 等）。
async function postSfToken(form, { tries = 4 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${LOGIN_URL}/services/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form),
    });
    if (res.ok) return { ok: true, data: await res.json() };
    const body = (await res.text()).slice(0, 300);
    last = { status: res.status, body };
    // 一時的なエラーだけ再試行（retry your request / unknown_error / server_error / 500系）
    const transient = res.status >= 500 || /retry your request|unknown_error|server_error|temporarily|try again/i.test(body);
    if (!transient) break;
    await new Promise((r) => setTimeout(r, 800 + i * 1200));   // 0.8s,2s,3.2s…
  }
  return { ok: false, ...last };
}

export function exchangeCode(code, redirectUri, owner, codeVerifier) { return _exchangeCode(code, redirectUri, owner, codeVerifier); }
async function _exchangeCode(code, redirectUri, owner, codeVerifier) {
  const form = {
    grant_type: "authorization_code",
    code,
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: redirectUri,
  };
  if (codeVerifier) form.code_verifier = codeVerifier;
  const r = await postSfToken(form, { tries: 4 });
  if (!r.ok) {
    await logSfDiag("exchangeCode(初回連携)", r.body || "");
    throw new Error(`SF token ${r.status}: ${r.body}`);
  }
  const data = r.data;
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
  const r = await postSfToken({
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: row.refresh_token,
  }, { tries: 3 });
  if (!r.ok) {
    _sfTokenCache.delete(owner);
    await logSfDiag("refresh(トークン更新)", r.body || "");
    const err = new Error(`SF refresh ${r.status}: ${r.body}`);
    err.sfReauth = true; // フロントで再認証UIを出すためのフラグ
    throw err;
  }
  const data = r.data;
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
  // まず開発者名が完全に Cross_lead のものを最優先。無ければ「クロス/cross」を含むもの。
  const exact = list.find((r) => String(r.dev || "").toLowerCase() === "cross_lead");
  if (exact) return exact.id;
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
// 取引先（Account）を新規作成する。重複ルールで止められても allowSave で通す（アラート型なら通る）。
export async function createAccount(owner, fields = {}, { allowDuplicate = false } = {}) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const body = {};
  for (const [k, v] of Object.entries(fields)) if (v != null && v !== "") body[k] = v;
  if (!body.Name) throw new Error("会社名がありません");
  const headers = { Authorization: `Bearer ${acc.token}`, "content-type": "application/json" };
  if (allowDuplicate) headers["Sforce-Duplicate-Rule-Header"] = "allowSave=true";
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/Account`,
    { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`SF account ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();   // { id, success }
}

export async function createContact(owner, { accountId, lastName, firstName, title, email, phone, allowDuplicate = false } = {}) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const body = { LastName: lastName || "（担当者）" };
  if (accountId) body.AccountId = accountId;
  if (firstName) body.FirstName = firstName;
  if (title) body.Title = title;
  if (email) body.Email = email;
  if (phone) body.Phone = phone;
  const headers = { Authorization: `Bearer ${acc.token}`, "content-type": "application/json" };
  if (allowDuplicate) headers["Sforce-Duplicate-Rule-Header"] = "allowSave=true";
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/sobjects/Contact`,
    {
      method: "POST",
      headers,
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
    const text = (await res.text()).slice(0, 600);
    // 存在しない項目：No such column 'X'
    const m = text.match(/No such column '([^']+)' on sobject/i);
    if (res.status === 400 && m && Object.prototype.hasOwnProperty.call(payload, m[1])) {
      delete payload[m[1]]; // 存在しない項目を除いて再送
      continue;
    }
    // 書き込めない項目：INVALID_FIELD_FOR_INSERT_UPDATE などで fields:["X"] が返る
    if (res.status === 400) {
      let dropped = false;
      try {
        const arr = JSON.parse(text);
        for (const e of (Array.isArray(arr) ? arr : [])) {
          for (const f of (e && Array.isArray(e.fields) ? e.fields : [])) {
            if (Object.prototype.hasOwnProperty.call(payload, f)) { delete payload[f]; dropped = true; }
          }
        }
      } catch {}
      if (dropped) continue;   // 書き込めない項目を外して再送
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

// リードに残っている活動（架電の履歴）を取ってくる。
// 完了・未完了を問わず、新しい順に返す。
export async function leadActivities(owner, leadId, limit = 50) {
  if (!leadId) return [];
  const id = String(leadId).replace(/[^A-Za-z0-9]/g, "");
  // 組織によって項目が違うので、まず標準の項目だけで取る
  const base = "Id, Subject, Status, ActivityDate, Description, CreatedDate, Owner.Name, TaskSubtype";
  const soql =
    `SELECT ${base} FROM Task WHERE WhoId = '${id}' ` +
    `ORDER BY ActivityDate DESC NULLS LAST, CreatedDate DESC LIMIT ${Math.min(200, Number(limit) || 50)}`;
  try {
    const d = await sfQuery(owner, soql);
    return d.records || [];
  } catch (e) {
    console.warn("[SF] 活動履歴を取れません:", e.message);
    return [];
  }
}

// 活動の「結果」が入っている項目を探す（組織ごとに名前が違う）
export async function taskResultField(owner) {
  try {
    const td = await describeTask(owner);
    const cand = (td.fields || []).filter((f) =>
      f.type === "picklist" && (f.picklistValues || []).length >= 3 &&
      /(status|result|subtype|活動|結果|区分)/i.test(`${f.name} ${f.label}`));
    const best = cand.sort((a, b) =>
      (b.picklistValues || []).length - (a.picklistValues || []).length)[0];
    return best ? { name: best.name, label: best.label } : null;
  } catch { return null; }
}

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
    // 会社名は複数パターンで探す（全角/半角スペースでヒットしないことがあるため）。
    //   ・そのまま　・スペース除去　・法人格を除いた核（例：エスエムオー）
    const variants = new Set();
    variants.add(c);
    const noSpace = c.replace(/[\s　]/g, "");
    if (noSpace) variants.add(noSpace);
    const core = noSpace.replace(/(株式会社|有限会社|合同会社|合資会社|㈱|一般社団法人|一般財団法人|公益社団法人|公益財団法人|医療法人|社会福祉法人|学校法人|協同組合|組合)/g, "");
    if (core && core.length >= 2) variants.add(core);
    const ors = [...variants].filter(Boolean).map((v) => `Company LIKE '%${v}%'`);
    conds.push(`(${ors.join(" OR ")})`);
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

// リードの項目を、API名かラベルから探す（結果は覚えておく）
const _leadFieldCache = new Map();
export async function findLeadField(owner, { key, apis = [], re }) {
  const hit = _leadFieldCache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.field;
  let field = null;
  try {
    const desc = await describeObject(owner, "Lead");
    const all = (desc.fields || []).filter((f) => f.updateable);
    for (const api of apis) { field = all.find((x) => x.name === api); if (field) break; }
    if (!field && re) field = all.find((x) => re.test(String(x.label || "")));
  } catch {}
  _leadFieldCache.set(key, { at: Date.now(), field: field || null });
  return field || null;
}

// 文字を入れるだけの項目を、空のときだけ埋める。
// （コンバートで必須になっているのに、リードが空のままだと弾かれるものに使う）
export async function ensureLeadTextField(owner, leadId, { key, apis = [], re, value, label = "" }) {
  const v = String(value || "").trim();
  if (!leadId || !v) return { ok: false, skipped: true };
  const f = await findLeadField(owner, { key, apis, re });
  if (!f) return { ok: false, skipped: true, reason: `${label || key}の項目が見つかりません` };
  const id = String(leadId).replace(/[^a-zA-Z0-9]/g, "");
  try {
    const d = await sfQuery(owner, `SELECT Id, ${f.name} FROM Lead WHERE Id = '${id}' LIMIT 1`);
    const cur = (d.records || [])[0] || {};
    if (cur[f.name] !== null && cur[f.name] !== undefined && String(cur[f.name]).trim() !== "") {
      return { ok: true, already: true, field: f.name, value: cur[f.name] };
    }
  } catch {}
  if (f.type === "picklist") {
    const opts = (f.picklistValues || []).filter((o) => o.active).map((o) => o.value);
    if (opts.length && !opts.includes(v)) {
      return { ok: false, field: f.name, reason: `「${v}」は選択肢にありません（候補：${opts.slice(0, 8).join("、")}）` };
    }
  }
  await updateLead(owner, id, { [f.name]: v });
  return { ok: true, filled: true, field: f.name, value: v };
}

// 「FSへの案件パス情報（FSへの連携事項）」を入れておく
export async function ensureLeadFsNote(owner, leadId, value) {
  return ensureLeadTextField(owner, leadId, {
    key: "fsNote",
    apis: ["FS_Note__c", "to_fs__c"],
    re: /(FS|ＦＳ|フィールドセールス).*(パス|連携|申し送り|情報|事項)/i,
    value, label: "FSへの案件パス情報",
  });
}

// 「初回訪問予定日・web商談日」を入れておく（空のときだけ）
export async function ensureLeadVisitDate(owner, leadId, dateStr) {
  return ensureLeadTextField(owner, leadId, {
    key: "visitDate",
    apis: ["First_Visit_Date__c", "firstvisit_date__c"],
    re: /初回(訪問|商談|面談).*日|初回.*日/,
    value: dateStr, label: "初回訪問予定日",
  });
}

// 「主キャンペーンソース」を入れておく。
// 空だと「コンバート時には主キャンペーンソース入力が必要です」で弾かれる。
// 項目がキャンペーンの参照（ルックアップ）なら、その名前のキャンペーンを探してIDを入れる。
// すでに値が入っていれば触らない。
export async function ensureLeadCampaignSource(owner, leadId, value) {
  const v = String(value || "").trim();
  if (!leadId || !v) return { ok: false, skipped: true };
  const f = await findLeadField(owner, {
    key: "campaignSource",
    apis: ["Primary_Campaign_Source__c", "CampaignSource__c"],
    re: /主?キャンペーン(ソース|元)/,
  });
  if (!f) return { ok: false, skipped: true, reason: "項目が見つかりません" };
  const id = String(leadId).replace(/[^a-zA-Z0-9]/g, "");
  try {
    const d = await sfQuery(owner, `SELECT Id, ${f.name} FROM Lead WHERE Id = '${id}' LIMIT 1`);
    const cur = (d.records || [])[0] || {};
    if (cur[f.name]) return { ok: true, already: true, field: f.name, value: cur[f.name] };
  } catch {}

  let put = v;
  // キャンペーンの参照なら、名前からIDを引く
  if (f.type === "reference" && (f.referenceTo || []).includes("Campaign")) {
    const esc = v.replace(/['\\%_]/g, "");
    const d = await sfQuery(owner, `SELECT Id, Name FROM Campaign WHERE Name = '${esc}' LIMIT 1`)
      .catch(() => ({ records: [] }));
    let rec = (d.records || [])[0];
    if (!rec) {
      const d2 = await sfQuery(owner, `SELECT Id, Name FROM Campaign WHERE Name LIKE '%${esc}%' LIMIT 1`)
        .catch(() => ({ records: [] }));
      rec = (d2.records || [])[0];
    }
    if (!rec) return { ok: false, field: f.name, reason: `「${v}」というキャンペーンがSalesforceにありません` };
    put = rec.Id;
  }
  // 選択リストなら、その値があるか見ておく（無ければ理由を返す）
  if (f.type === "picklist") {
    const opts = (f.picklistValues || []).filter((o) => o.active).map((o) => o.value);
    if (opts.length && !opts.includes(v)) {
      return { ok: false, field: f.name, reason: `「${v}」は選択肢にありません（候補：${opts.slice(0, 8).join("、")}）` };
    }
  }
  await updateLead(owner, id, { [f.name]: put });
  return { ok: true, filled: true, field: f.name, value: v };
}

// 「アポ獲得日」にあたるリードの項目名を突き止める。
// 組織ごとにAPI名が違うので、まずよくある名前で探し、無ければラベルで探す。
let _apoDateFieldCache = { at: 0, name: null };
export async function apoDateFieldName(owner) {
  if (_apoDateFieldCache.name !== null && Date.now() - _apoDateFieldCache.at < 30 * 60 * 1000) {
    return _apoDateFieldCache.name;
  }
  let name = "";
  try {
    const desc = await describeObject(owner, "Lead");
    const all = (desc.fields || []).filter((f) => f.updateable);
    let f = all.find((x) => x.name === "Apo_Date__c") || all.find((x) => x.name === "apo_date__c");
    if (!f) f = all.find((x) => /アポ.*獲得.*日|獲得日/.test(String(x.label || "")));
    if (f && (f.type === "date" || f.type === "datetime")) name = f.name;
    else if (f) name = f.name;
  } catch {}
  _apoDateFieldCache = { at: Date.now(), name };
  return name;
}

// コンバートの前に「アポ獲得日」を入れておく。
// この項目が空だと「取引開始済にするには『アポ獲得日』の入力が必要です」で弾かれる。
// すでに値が入っていれば触らない（現場が手で入れた日付を上書きしないため）。
export async function ensureLeadApoDate(owner, leadId, dateStr) {
  const field = await apoDateFieldName(owner);
  if (!field || !leadId || !dateStr) return { ok: false, skipped: true, field };
  const id = String(leadId).replace(/[^a-zA-Z0-9]/g, "");
  try {
    const d = await sfQuery(owner, `SELECT Id, ${field} FROM Lead WHERE Id = '${id}' LIMIT 1`);
    const cur = (d.records || [])[0] || {};
    if (cur[field]) return { ok: true, already: true, field, value: cur[field] };
  } catch {}
  await updateLead(owner, id, { [field]: dateStr });
  return { ok: true, filled: true, field, value: dateStr };
}

// 会社名から、既存の取引先（Account）を探す。スペース違い・法人格違いでも当たるよう複数パターンで探す。
export async function findAccountByName(owner, name) {
  const c = String(name || "").replace(/['\\%_]/g, "").trim();
  if (!c) return null;
  const noSpace = c.replace(/[\s　]/g, "");
  const core = noSpace.replace(/(株式会社|有限会社|合同会社|合資会社|㈱|一般社団法人|一般財団法人|公益社団法人|公益財団法人|医療法人|社会福祉法人|学校法人|協同組合|組合)/g, "");
  const vars = [...new Set([c, noSpace, core].filter((v) => v && v.length >= 2))];
  const ors = vars.map((v) => `Name LIKE '%${v}%'`).join(" OR ");
  try {
    const d = await sfQuery(owner, `SELECT Id, Name FROM Account WHERE ${ors} ORDER BY LastModifiedDate DESC LIMIT 5`);
    const recs = d.records || [];
    const norm = (v) => String(v || "").replace(/[\s　（）()]/g, "");
    return recs.find((a) => norm(a.Name) === norm(c)) || recs[0] || null;
  } catch { return null; }
}

// リードをコンバートする（標準の convertLead アクションを使う）
export async function convertLead(owner, { leadId, convertedStatus, opportunityName, accountId, contactId, ownerId, doNotCreateOpportunity, allowDuplicate }) {
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
  if (allowDuplicate) input.allowDuplicate = true;
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
    const codes = (first && first.errors ? first.errors.map((e) => e.statusCode || e.errorCode || "").join(" ") : "");
    const isDup = /duplicate|重複|DUPLICATES?_?DETECTED/i.test(`${raw} ${codes}`);
    // 重複を「許可して作る」ときは、SOAPの allowSave（重複ルールを無視）で作成する
    if (isDup && input.allowDuplicate) {
      console.log("[SF立ち上げ] RESTで重複判定 → SOAP(allowSave)で重複を許可して作成します");
      const r = await convertLeadSoap(acc, input);
      return { ...r, via: "soap-dup" };
    }
    const err = new Error(`SF lead convert: ${raw}`);
    if (isDup) err.duplicate = true;   // 呼び出し側が「既存に紐づけ／重複許可」に切り替えられるようにする
    throw err;
  }
  const out = first.outputValues || {};
  const oppId = out.opportunityId || "";
  // 何が返ったかを必ず残す。商談ができない原因を追うのに要る。
  console.log("[SF立ち上げ] コンバートの応答",
    JSON.stringify({
      leadId: input.leadId,
      accountId: out.accountId || "",
      contactId: out.contactId || "",
      opportunityId: oppId,
      渡した商談名: input.opportunityName || "(なし)",
      渡した所有者: input.ownerId || "(なし)",
    }));
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
    `<soapenv:Header>` +
    `<urn:SessionHeader><urn:sessionId>${esc(acc.token)}</urn:sessionId></urn:SessionHeader>` +
    // 重複ルールで止められたときに、それでも通すかどうか。
    // 既存の取引先に紐づけたい場面があるため、指定できるようにしておく。
    (input.allowDuplicate
      ? `<urn:DuplicateRuleHeader><urn:allowSave>true</urn:allowSave>` +
        `<urn:includeRecordDetails>false</urn:includeRecordDetails>` +
        `<urn:runAsCurrentUser>true</urn:runAsCurrentUser></urn:DuplicateRuleHeader>`
      : "") +
    `</soapenv:Header>` +
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
  const accountId = pick("accountId");
  const contactId = pick("contactId");
  const opportunityId = pick("opportunityId");

  // <errors> があれば、success の有無にかかわらず失敗として扱う。
  // 重複ルールに弾かれたときは success が返らず errors だけが来る。
  const errType = (xml.match(/<errors[^>]*xsi:type="([^"]+)"/) || [])[1] || "";
  const errMsg = pick("message");
  if (!res.ok || !success || errMsg || !accountId) {
    const fault = pick("faultstring");
    const raw = fault || errMsg || `SOAP convert ${res.status}`;
    console.error("[SF立ち上げ] コンバートに失敗", JSON.stringify({
      種類: errType || "(なし)", 内容: raw.slice(0, 300),
      取引先: accountId || "(できていません)", 取引先責任者: contactId || "(できていません)",
    }));
    const e = new Error(`SF lead convert: ${raw}`);
    e.errType = errType;
    e.duplicate = /Duplicate|重複|DUPLICATES?_?DETECTED/i.test(`${errType} ${raw}`);
    throw e;
  }
  if (!opportunityId) {
    console.error("[SF立ち上げ] 取引先はできましたが、商談ができていません",
      JSON.stringify({ accountId, contactId }));
  }
  return {
    ok: true,
    accountId, contactId, opportunityId,
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

// レポートに設定されている絞り込み条件を読む。
// kinbotの画面で値を変えて実行できるようにするために使う。
export async function reportFilters(owner, reportId) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const id = String(reportId).replace(/[^a-zA-Z0-9]/g, "");
  const res = await fetch(
    `${acc.instanceUrl}/services/data/${API_VERSION}/analytics/reports/${id}/describe`,
    { headers: { Authorization: `Bearer ${acc.token}` } }
  );
  const d = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = Array.isArray(d) ? d.map((e) => e.message).join(" / ") : (d && d.message) || `SF report describe ${res.status}`;
    throw new Error(`SF report: ${msg}`);
  }
  const meta = d.reportMetadata || {};
  const ext = d.reportExtendedMetadata || {};
  const colInfo = { ...(ext.detailColumnInfo || {}), ...(ext.aggregateColumnInfo || {}) };
  const typeInfo = d.reportTypeMetadata || {};

  // 項目のラベルを引けるようにする（画面に「作成日」などと出すため）
  const labelOf = {};
  for (const cat of typeInfo.categories || []) {
    for (const [api, c] of Object.entries(cat.columns || {})) {
      labelOf[api] = c.label || api;
    }
  }
  for (const [api, c] of Object.entries(colInfo)) {
    if (c && c.label) labelOf[api] = c.label;
  }

  return {
    name: meta.name || "",
    filters: (meta.reportFilters || []).map((f, i) => ({
      index: i,
      column: f.column,
      label: labelOf[f.column] || f.column,
      operator: f.operator,
      value: f.value,
    })),
    booleanFilter: meta.reportBooleanFilter || "",
    standardDateFilter: meta.standardDateFilter || null,
    // 選べる期間（今月・先月など）
    dateRanges: (typeInfo.standardDateFilterDurationGroups || [])
      .flatMap((g) => (g.standardDateFilterDurations || []).map((x) => ({ value: x.value, label: x.label }))),
    dateColumns: (typeInfo.standardDateFilterDurationGroups || [])
      .map((g) => ({ value: g.value, label: g.label })),
  };
}

// レポートを実行して、表として使える形に整える。
// filters を渡すと、その条件で実行する（Salesforce側の保存内容は変えない）。
export async function runReport(owner, reportId, filters = null) {
  const acc = await getAccess(owner);
  if (!acc) throw new Error("Salesforce未連携です");
  const id = String(reportId).replace(/[^a-zA-Z0-9]/g, "");
  const url = `${acc.instanceUrl}/services/data/${API_VERSION}/analytics/reports/${id}?includeDetails=true`;

  // 条件が指定されていれば、その条件で実行する（POST）。
  // 保存されているレポートは書き換わらないので、気軽に試せる。
  const useFilters = filters && (Array.isArray(filters.reportFilters) || filters.standardDateFilter);
  const res = useFilters
    ? await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${acc.token}`, "content-type": "application/json" },
        body: JSON.stringify({
          reportMetadata: {
            ...(Array.isArray(filters.reportFilters) ? { reportFilters: filters.reportFilters } : {}),
            ...(filters.reportBooleanFilter ? { reportBooleanFilter: filters.reportBooleanFilter } : {}),
            ...(filters.standardDateFilter ? { standardDateFilter: filters.standardDateFilter } : {}),
          },
        }),
      })
    : await fetch(url, { headers: { Authorization: `Bearer ${acc.token}` } });
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
