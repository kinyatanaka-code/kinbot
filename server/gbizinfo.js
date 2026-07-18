// gBizINFO（経済産業省の法人情報API）クライアント
// https://info.gbiz.go.jp/hojin/api/document/  ※利用には無料のAPIトークンが必要
//   環境変数 GBIZINFO_TOKEN にトークンを設定する。
//
// このモジュールは「会社名での候補検索」と「法人番号での詳細取得」を提供する。
// 名寄せ（どの企業か）は呼び出し側（ユーザーが候補から選ぶ）で行う。

const BASE = "https://info.gbiz.go.jp/hojin/v1/hojin";

function token() {
  return process.env.GBIZINFO_TOKEN || "";
}
export function gbizConfigured() {
  return !!token();
}

// 業種コード（gBizINFOのbusiness_summary等では日本標準産業分類の文字列が入ることが多い）を
// そのまま使う。数値コードだけの場合に備え、必要なら呼び出し側で補完する。

async function gbizFetch(path, params = {}) {
  if (!token()) throw new Error("gBizINFOのトークンが未設定です（環境変数 GBIZINFO_TOKEN）");
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try {
    res = await fetch(url.toString(), {
      headers: { "X-hojinInfo-api-token": token(), "Accept": "application/json" },
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(e.name === "AbortError" ? "gBizINFOへの接続がタイムアウトしました" : `gBizINFO接続エラー: ${e.message}`);
  }
  clearTimeout(timer);
  if (res.status === 403 || res.status === 401) throw new Error("gBizINFOのトークンが無効です（403）。トークンを確認してください。");
  if (res.status === 404) return { "hojin-infos": [] }; // 該当なし
  if (!res.ok) throw new Error(`gBizINFOがエラーを返しました（${res.status}）`);
  return res.json();
}

// 会社名で候補を検索する。最大 limit 件の候補を返す。
// 返す各候補: { corporate_number, name, location, status, industry }
export async function searchCompanies(name, limit = 8) {
  const q = String(name || "").trim();
  if (!q) return [];
  // gBizINFOは name パラメータで法人名の部分一致検索ができる。
  const data = await gbizFetch("", { name: q, limit: Math.min(100, limit), page: 1 });
  const list = (data && (data["hojin-infos"] || data.hojinInfos || [])) || [];
  return list.slice(0, limit).map((h) => ({
    corporate_number: h.corporate_number || h.corporateNumber || "",
    name: h.name || h.company_name || "",
    kana: h.kana || "",
    location: h.location || "",
    status: h.close_cause ? "閉鎖" : "営業中",
    industry: pickIndustry(h),
    founded: h.date_of_establishment || "",
  })).filter((x) => x.corporate_number && x.name);
}

// 法人番号で1社の詳細を取得する。
export async function getCompanyDetail(corporateNumber) {
  const num = String(corporateNumber || "").trim();
  if (!num) throw new Error("法人番号が指定されていません");
  const data = await gbizFetch("/" + encodeURIComponent(num));
  const list = (data && (data["hojin-infos"] || data.hojinInfos || [])) || [];
  const h = list[0];
  if (!h) throw new Error("この法人番号の情報が見つかりませんでした");
  return {
    corporate_number: h.corporate_number || num,
    official_name: h.name || "",
    kana: h.kana || "",
    location: h.location || "",
    postal_code: h.postal_code || "",
    industry: pickIndustry(h),
    founded: h.date_of_establishment || "",
    capital: h.capital_stock ? formatCapital(h.capital_stock) : "",
    employees: h.employee_number ? `${h.employee_number}名` : "", // gBizINFOに入っていれば使う（無い場合が多い）
    business: h.business_summary || "",
    representative: (h.representative && (h.representative.representative_name || "")) || h.representative_name || "",
    company_url: h.company_url || "",
    update_date: h.update_date || "",
  };
}

// 業種を取り出す。gBizINFOは複数の項目に業種情報が散らばることがあるため、順に拾う。
import { jsicCodesToNames } from "./jsic.js";

// 業種を取り出す。gBizINFOのレスポンスでは複数のフィールドに業種情報が散らばることがあるため、順に拾う。
// 業種コード（"229 / 315" のような数字）は日本標準産業分類の名前に変換する。
function pickIndustry(h) {
  if (!h) return "";
  // 1. business_items（配列）が最も具体的
  if (Array.isArray(h.business_items) && h.business_items.length) {
    return jsicCodesToNames(h.business_items.slice(0, 3).join(" / "));
  }
  // 2. category（配列）は日本標準産業分類の名称またはコードが入る
  if (Array.isArray(h.category) && h.category.length) {
    return jsicCodesToNames(h.category.join(" / "));
  }
  // 3. business_summary が文章として業種を示すこともあるので、そのまま出す（空を返さない）
  if (h.business_summary) return String(h.business_summary).slice(0, 60);
  // 4. その他のフィールド
  return jsicCodesToNames(h.industry || h.business_type || "");
}

function formatCapital(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 100000000) return `${(n / 100000000).toFixed(n % 100000000 ? 1 : 0)}億円`;
  if (n >= 10000) return `${Math.round(n / 10000)}万円`;
  return `${n}円`;
}
