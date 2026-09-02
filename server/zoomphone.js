// Zoom Phone 連携。Server-to-Server OAuth でトークンを取り、通話履歴（call history）を引く。
// 必要な環境変数：ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET
// スコープ：phone:read:list_call_logs（や phone:read）と phone:read:list_users 等（通話履歴・ユーザー読み取り）。

export function zoomPhoneConfigured() {
  return !!(String(process.env.ZOOM_ACCOUNT_ID || "").trim()
    && String(process.env.ZOOM_CLIENT_ID || "").trim()
    && String(process.env.ZOOM_CLIENT_SECRET || "").trim());
}

let _tok = { token: "", exp: 0 };
async function getToken() {
  if (!zoomPhoneConfigured()) throw new Error("Zoomの資格情報が未設定です（ZOOM_ACCOUNT_ID / ZOOM_CLIENT_ID / ZOOM_CLIENT_SECRET）");
  if (_tok.token && Date.now() < _tok.exp - 60000) return _tok.token;
  const accountId = String(process.env.ZOOM_ACCOUNT_ID).trim();
  const basic = Buffer.from(`${String(process.env.ZOOM_CLIENT_ID).trim()}:${String(process.env.ZOOM_CLIENT_SECRET).trim()}`).toString("base64");
  const res = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(accountId)}`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.access_token) throw new Error(`Zoomトークン取得に失敗（${res.status}）：${(d.reason || d.message || "").slice(0, 120)}`);
  _tok = { token: d.access_token, exp: Date.now() + (Number(d.expires_in || 3300) * 1000) };
  return _tok.token;
}

async function zoomGet(path, params = {}) {
  const token = await getToken();
  const url = new URL(`https://api.zoom.us/v2${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Zoom ${res.status}: ${(d.message || "").slice(0, 160)}`);
  return d;
}

// 接続確認（トークンが取れて、電話ユーザーが読めるか）
export async function zoomPhonePing() {
  await getToken();
  const d = await zoomGet("/phone/users", { page_size: 1 }).catch((e) => ({ _err: e.message }));
  if (d && d._err) return { ok: false, error: d._err };
  return { ok: true, users_total: d.total_records || (d.users || []).length || 0 };
}

// 電話ユーザー一覧（Zoomユーザー→メールの対応づけ用）。{ email: {id,name,ext} }
export async function zoomPhoneUsers() {
  const out = {};
  let token = "";
  for (let page = 0; page < 20; page++) {
    const d = await zoomGet("/phone/users", { page_size: 100, next_page_token: token }).catch(() => null);
    if (!d) break;
    for (const u of d.users || []) {
      const email = String(u.email || "").toLowerCase();
      if (email) out[email] = { id: u.id, name: u.name || "", ext: u.extension_number || "" };
    }
    token = d.next_page_token || "";
    if (!token) break;
  }
  return out;
}

// 通話履歴を取る。from/to は YYYY-MM-DD（最大1か月幅）。account全体。
// 返り値：正規化した配列 [{ id, direction, number, result, duration, at, ownerEmail }]
export async function zoomPhoneCallHistory({ from, to, max = 300 } = {}) {
  const items = [];
  let token = "";
  for (let page = 0; page < 10 && items.length < max; page++) {
    // v2: /phone/call_history（新しめ）。古い環境向けに /phone/call_logs もフォールバック。
    let d = await zoomGet("/phone/call_history", { from, to, page_size: 100, next_page_token: token }).catch(() => null);
    if (!d) d = await zoomGet("/phone/call_logs", { from, to, page_size: 100, next_page_token: token }).catch(() => null);
    if (!d) break;
    const list = d.call_history || d.call_logs || d.calls || [];
    for (const c of list) {
      const direction = c.direction || c.call_direction || "";
      // 相手の番号（発信なら callee、着信なら caller）
      const number = String(direction === "inbound" || direction === "incoming"
        ? (c.caller_number || c.caller_did_number || (c.caller && c.caller.phone_number) || "")
        : (c.callee_number || c.callee_did_number || (c.callee && c.callee.phone_number) || c.destination || "")) || String(c.phone_number || "");
      const ownerEmail = String((c.owner && c.owner.email) || c.user_email || c.email || (c.caller && c.caller.email) || "").toLowerCase();
      const result = String(c.result || c.call_result || c.status || "").toLowerCase();
      items.push({
        id: String(c.id || c.call_id || c.call_log_id || c.uuid || ""),
        direction,
        number,
        result,
        duration: Number(c.duration || 0),
        at: c.date_time || c.start_time || c.created_time || null,
        ownerEmail,
      });
      if (items.length >= max) break;
    }
    token = d.next_page_token || "";
    if (!token) break;
  }
  return items;
}

// Zoomの通話結果を、kincallの架電結果ラベルに寄せる。
export function zoomResultToKincall(result, duration) {
  const r = String(result || "").toLowerCase();
  if (/answered|accepted|completed|connected/.test(r) || (Number(duration) || 0) >= 20) return "担当者不在"; // 応答＝要確認（暫定）
  if (/no_?answer|missed|not_?answered|ring/.test(r)) return "担当者不在";
  if (/busy/.test(r)) return "担当者不在";
  if (/voicemail|vm/.test(r)) return "担当者不在";
  return "コールのみ";
}
