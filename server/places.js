// Google Places API (New) で各社の営業時間を取得する。
// searchText 1回で regularOpeningHours まで取れる（フィールドマスク指定）。
// キー未設定なら何もしない（機能オフ）。

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

export function placesEnabled() {
  return !!String(process.env.GOOGLE_PLACES_API_KEY || "").trim();
}

// 1社ぶんの営業時間を取る。company（会社名）＋あれば phone/area で精度を上げる。
export async function fetchPlaceHours(company, { phone = "", area = "" } = {}) {
  const key = String(process.env.GOOGLE_PLACES_API_KEY || "").trim();
  if (!key) return null;
  const textQuery = [company, area, phone].map((x) => String(x || "").trim()).filter(Boolean).join(" ");
  if (!textQuery) return { found: false, periods: [], weekday_desc: [], business_status: "" };
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.regularOpeningHours,places.businessStatus",
      },
      body: JSON.stringify({ textQuery, languageCode: "ja", regionCode: "JP", maxResultCount: 1 }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      if (res.status === 429 || /RESOURCE_EXHAUSTED|rateLimit|quota/i.test(String(t))) return { rateLimited: true };
      console.warn("[places] 取得失敗", res.status, String(t).slice(0, 200));
      return null;   // エラーはキャッシュしない（次回リトライ）
    }
    const d = await res.json();
    const p = d && d.places && d.places[0];
    if (!p) return { found: false, place_id: "", periods: [], weekday_desc: [], business_status: "" };
    const oh = p.regularOpeningHours || {};
    return {
      found: !!(oh.periods && oh.periods.length),
      place_id: p.id || "",
      periods: oh.periods || [],
      weekday_desc: oh.weekdayDescriptions || [],
      business_status: p.businessStatus || "",
    };
  } catch (e) {
    console.warn("[places] 例外", e.message);
    return null;
  }
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
