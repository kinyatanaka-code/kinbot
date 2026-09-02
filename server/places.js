// Google Places API (New) で各社の営業時間を取得する。
// searchText 1回で regularOpeningHours まで取れる（フィールドマスク指定）。
// キー未設定なら何もしない（機能オフ）。

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

export function placesEnabled() {
  return !!String(process.env.GOOGLE_PLACES_API_KEY || "").trim();
}

// searchText を1回呼ぶ。places 配列（最大3件）または {rateLimited} を返す。
async function callSearchText(key, textQuery) {
  if (!textQuery) return null;
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.regularOpeningHours,places.businessStatus,places.formattedAddress",
      },
      body: JSON.stringify({ textQuery, languageCode: "ja", regionCode: "JP", maxResultCount: 3 }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      if (res.status === 429 || /RESOURCE_EXHAUSTED|rateLimit|quota/i.test(String(t))) return { rateLimited: true };
      console.warn("[places] 取得失敗", res.status, String(t).slice(0, 160));
      return null;
    }
    const d = await res.json();
    return { places: (d && d.places) || [] };
  } catch (e) { console.warn("[places] 例外", e.message); return null; }
}
const hasHours = (p) => !!(p && p.regularOpeningHours && Array.isArray(p.regularOpeningHours.periods) && p.regularOpeningHours.periods.length);

// 1社ぶんの営業時間を取る。電話→会社名+住所→会社名 の順で試し、営業時間が取れたら確定。
export async function fetchPlaceHours(company, { phone = "", area = "", address = "" } = {}) {
  const key = String(process.env.GOOGLE_PLACES_API_KEY || "").trim();
  if (!key) return null;
  const co = String(company || "").trim();
  if (!co && !phone) return { found: false, periods: [], weekday_desc: [], business_status: "" };
  // 法人格を外した名前（Google側の表記ゆれ対策）
  const cleaned = co.replace(/株式会社|（株）|\(株\)|㈱|有限会社|（有）|\(有\)|合同会社|合資会社|一般社団法人|公益社団法人|社会福祉法人|学校法人/g, "").trim();
  const addr = String(address || "").trim();
  const ar = String(area || "").trim();
  // 試す順番：電話（最も正確）→ 会社名＋住所 → 会社名＋地域 → 会社名 → 法人格なし名＋地域
  const queries = [];
  if (phone) queries.push(String(phone).trim());
  if (co && addr) queries.push(`${co} ${addr}`);
  if (co && ar) queries.push(`${co} ${ar}`);
  if (co) queries.push(co);
  if (cleaned && cleaned !== co) queries.push(ar ? `${cleaned} ${ar}` : cleaned);

  let best = null;
  const seen = new Set();
  for (const q of queries) {
    if (!q || seen.has(q)) continue; seen.add(q);
    const r = await callSearchText(key, q);
    if (r && r.rateLimited) return { rateLimited: true };
    if (!r || !r.places || !r.places.length) continue;
    const wh = r.places.find(hasHours);
    if (wh) { best = wh; break; }              // 営業時間が取れたら確定
    if (!best) best = r.places[0];             // 取れなくても一応の候補は覚えておく
  }
  if (!best) return { found: false, place_id: "", periods: [], weekday_desc: [], business_status: "" };
  const oh = best.regularOpeningHours || {};
  return {
    found: hasHours(best),
    place_id: best.id || "",
    periods: oh.periods || [],
    weekday_desc: oh.weekdayDescriptions || [],
    business_status: best.businessStatus || "",
  };
}

// 今（日本時間）営業中か。periods は Google の形式（day: 0=日〜6=土, hour, minute）。
// 返り値: "open"（営業中）/ "closed"（営業時間外）/ "unknown"（不明）
export function openState(periods, businessStatus) {
  if (businessStatus && businessStatus !== "OPERATIONAL") return "closed"; // 閉業・一時休業
  if (!Array.isArray(periods) || !periods.length) return "unknown";
  const nowJ = new Date(Date.now() + 9 * 3600 * 1000);
  const day = nowJ.getUTCDay();                       // 0=日〜6=土
  const mins = nowJ.getUTCHours() * 60 + nowJ.getUTCMinutes();
  for (const p of periods) {
    if (!p || !p.open) continue;
    const oDay = p.open.day, oM = (p.open.hour || 0) * 60 + (p.open.minute || 0);
    // 24時間営業（closeが無い）
    if (!p.close) { if (oDay === day) return "open"; continue; }
    const cDay = p.close.day, cM = (p.close.hour || 0) * 60 + (p.close.minute || 0);
    if (oDay === cDay) {
      if (day === oDay && mins >= oM && mins < cM) return "open";
    } else {
      // 日をまたぐ（例：22:00開店→翌2:00閉店）
      if (day === oDay && mins >= oM) return "open";
      if (day === cDay && mins < cM) return "open";
    }
  }
  return "closed";
}
