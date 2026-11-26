// MOCHICALL の「使われ方」を数える（2026-11-27 福井さん「使われない機能の引き算」）
//
// なぜ作ったか：
//   インターン生の手数・迷いを減らすために、使われていない機能・ボタン・タブを消す候補を出したい。
//   これまで残っていたのは監査ログ（mcaudit：書き込みの操作だけ）で、読むだけの操作・画面のボタンを押したかは残っていなかった。
//   そこで軽く2つ足す：
//     1. API の呼び出し回数（mcaudit の入口で、/api/mccall・/api/mochica を道の形（:id）ごとに数える。日×道×人で1行）
//     2. 画面のボタン・タブを押した回数と、画面に出ていた回数（public/mcusage.js が数分ごとにまとめて送る）
//   一覧は「消すかどうかをオーナーが決める材料」だけ。ここでは何も消さない・隠さない。
//   AI も外のサービスも呼ばない。DB に足すのは小さい表2つだけ（1日あたり 人数×道の数 行ほど）。
import { dbPool } from "./db.js";

const P = () => dbPool();
const 対象 = /^\/api\/(mccall|mochica)(\/|$)/;

let _ready = null;
async function ensure() {
  if (!P()) return false;
  if (!_ready) {
    _ready = (async () => {
      await P().query(`CREATE TABLE IF NOT EXISTS mc_api_usage (day DATE NOT NULL, route TEXT NOT NULL, who TEXT NOT NULL DEFAULT '', n INT NOT NULL DEFAULT 0, PRIMARY KEY (day, route, who))`);
      await P().query(`CREATE TABLE IF NOT EXISTS mc_ui_usage (day DATE NOT NULL, key TEXT NOT NULL, who TEXT NOT NULL DEFAULT '', label TEXT, clicks INT NOT NULL DEFAULT 0, shown INT NOT NULL DEFAULT 0, PRIMARY KEY (day, key, who))`);
      return true;
    })().catch((e) => { _ready = null; throw e; });
  }
  return _ready;
}
const jstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// ---- 1. API の呼び出し回数（メモリにためて5分ごとに書く。数え損ねても本来の操作は止めない） ----
const _api = new Map();   // "day\troute\twho" → 回数
let _flushT = null;
export function countApi(req, res) {
  try {
    if (!対象.test(req.path) || !req.route || res.statusCode === 404) return;
    const route = `${req.method} ${req.baseUrl || ""}${req.route.path}`;
    const who = String(req.user || "").toLowerCase().slice(0, 200);
    const k = `${jstDay()}\t${route}\t${who}`;
    _api.set(k, (_api.get(k) || 0) + 1);
    if (!_flushT) { _flushT = setTimeout(() => { _flushT = null; flushApi().catch((e) => console.warn("[mc-usage] API の回数を書けませんでした：", e.message)); }, 5 * 60e3); _flushT.unref?.(); }
  } catch {}
}
export async function flushApi() {
  if (!_api.size || !(await ensure())) return 0;
  const rows = [..._api.entries()]; _api.clear();
  for (const [k, n] of rows) {
    const [day, route, who] = k.split("\t");
    await P().query(`INSERT INTO mc_api_usage (day, route, who, n) VALUES ($1,$2,$3,$4) ON CONFLICT (day, route, who) DO UPDATE SET n = mc_api_usage.n + EXCLUDED.n`, [day, route, who, n]);
  }
  return rows.length;
}

// 登録されている MOCHICALL・MOCHICA の道の一覧（「一度も呼ばれていない道」を出すため）
function routesOf(app) {
  const out = [];
  for (const l of (app && app._router && app._router.stack) || []) {
    if (!l.route || !l.route.path || typeof l.route.path !== "string") continue;
    if (!対象.test(l.route.path)) continue;
    for (const m of Object.keys(l.route.methods || {})) if (m !== "_all") out.push({ route: `${m.toUpperCase()} ${l.route.path}`, method: m.toUpperCase(), path: l.route.path, re: l.regexp });
  }
  return out;
}

export function registerMcUsage(app, { adminOnly, guard, isAdmin }) {
  // ---- 2. 画面のボタン・タブ（public/mcusage.js から）。インターン生も送れる（/api/mccall/ の下なので） ----
  app.post("/api/mccall/ui-usage", guard(async (req, res) => {
    if (!(await ensure())) return res.json({ ok: false });
    const who = String(req.user || "").toLowerCase().slice(0, 200);
    const items = Array.isArray(req.body && req.body.items) ? req.body.items.slice(0, 300) : [];
    const day = jstDay();
    let n = 0;
    for (const x of items) {
      const key = String((x && x.k) || "").slice(0, 120); if (!key) continue;
      const c = Math.max(0, Math.min(parseInt(x.c, 10) || 0, 1000)), s = Math.max(0, Math.min(parseInt(x.s, 10) || 0, 1000));
      if (!c && !s) continue;
      await P().query(`INSERT INTO mc_ui_usage (day, key, who, label, clicks, shown) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (day, key, who) DO UPDATE SET clicks = mc_ui_usage.clicks + EXCLUDED.clicks, shown = mc_ui_usage.shown + EXCLUDED.shown, label = COALESCE(EXCLUDED.label, mc_ui_usage.label)`,
        [day, key, who, String((x && x.l) || "").replace(/\s+/g, " ").trim().slice(0, 60) || null, c, s]);
      n++;
    }
    res.json({ ok: true, n });
  }));

  // ---- 管理者：使われ方の一覧（引き算の候補） ----
  //   from・to（YYYY-MM-DD・両端を含む。既定は直近7日）、max（これ以下の回数を「ほとんど使われていない」とする。既定3）、
  //   scope＝mccall（既定。MOCHICALL の道だけ）／all（MOCHICA の道も）
  app.get("/api/mccall/usage", adminOnly(async (req, res) => {
    if (!(await ensure())) return res.status(503).json({ error: "データベースにつながっていません" });
    await flushApi().catch(() => {});
    const ok = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
    const to = ok(req.query.to) ? String(req.query.to) : jstDay();
    const from = ok(req.query.from) ? String(req.query.from) : new Date(Date.parse(to + "T00:00:00Z") - 6 * 86400e3).toISOString().slice(0, 10);
    const max = Math.max(0, Math.min(parseInt(req.query.max, 10) || 3, 1000));
    const scope = req.query.scope === "all" ? /^\/api\/(mccall|mochica)(\/|$)/ : /^\/api\/mccall(\/|$)/;
    const fromTs = new Date(Date.parse(from + "T00:00:00Z") - 9 * 3600e3), toTs = new Date(Date.parse(to + "T00:00:00Z") + 15 * 3600e3);
    const routes = routesOf(app).filter((r) => scope.test(r.path));
    // API の呼び出し（この仕組みを入れてからの分）
    const api = new Map((await P().query(`SELECT route, sum(n)::int AS n, count(DISTINCT who) FILTER (WHERE who <> '')::int AS users FROM mc_api_usage WHERE day BETWEEN $1 AND $2 GROUP BY 1`, [from, to])).rows.map((r) => [r.route, r]));
    const apiSince = (await P().query(`SELECT min(day)::text AS d FROM mc_api_usage`)).rows[0].d;
    // 監査ログ（書き込みだけ。2026-11-19 から残っている＝1週目の分もある）。ID を 0 にそろえて、道の形に当てる
    let auditSince = null; const audit = new Map();
    try {
      auditSince = (await P().query(`SELECT to_char(min(at) AT TIME ZONE 'Asia/Tokyo','YYYY-MM-DD') AS d FROM mc_audit_log`)).rows[0].d;
      const ar = (await P().query(`SELECT method, regexp_replace(path, '/([0-9]+|[A-Za-z0-9]{15,18}|[0-9a-f-]{20,})(/|$)', '/0\\2', 'g') AS p, count(*)::int AS n, count(DISTINCT COALESCE(actor,''))::int AS users
        FROM mc_audit_log WHERE at >= $1 AND at < $2 AND source IS DISTINCT FROM 'mcp' GROUP BY 1,2`, [fromTs, toTs])).rows;
      for (const r of ar) {
        const p2 = String(r.p).replace(/\/([0-9]+|[A-Za-z0-9]{15,18}|[0-9a-f-]{20,})(?=\/|$)/g, "/0");   // SQL で残った続きの ID も 0 に
        const hit = routes.find((x) => x.method === r.method && x.re && x.re.test(p2));
        const k = hit ? hit.route : `${r.method} ${r.p}`;
        const o = audit.get(k) || { n: 0, users: 0 }; o.n += r.n; o.users = Math.max(o.users, r.users); audit.set(k, o);
      }
    } catch (e) { auditSince = `読めませんでした：${e.message}`; }
    const apiRows = routes.map((r) => {
      const a = api.get(r.route) || { n: 0, users: 0 }, w = audit.get(r.route) || { n: 0, users: 0 };
      return { route: r.route, calls: +a.n || 0, users: +a.users || 0, audit: w.n, auditUsers: w.users };
    });
    // 画面のボタン・タブ
    const ui = (await P().query(`SELECT key, max(label) AS label, sum(clicks)::int AS clicks, sum(shown)::int AS shown,
        count(DISTINCT who) FILTER (WHERE clicks > 0)::int AS users, count(DISTINCT who) FILTER (WHERE shown > 0)::int AS saw
      FROM mc_ui_usage WHERE day BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 3, 4 DESC`, [from, to])).rows;
    const uiSince = (await P().query(`SELECT min(day)::text AS d FROM mc_ui_usage`)).rows[0].d;
    // 候補：一度も使われていない／ほとんど使われていない（回数が max 以下）。
    //   API は「数え始める前」の期間だと 0 になるので、書き込みは監査ログの数も見て、どちらも少ないときだけ候補にする
    const apiUsed = (r) => Math.max(r.calls, r.audit);
    const cand = {
      apiNever: apiRows.filter((r) => apiUsed(r) === 0).map((r) => r.route),
      apiRare: apiRows.filter((r) => apiUsed(r) > 0 && apiUsed(r) <= max).map((r) => ({ route: r.route, n: apiUsed(r), users: Math.max(r.users, r.auditUsers) })),
      uiNever: ui.filter((r) => r.shown > 0 && r.clicks === 0).map((r) => ({ key: r.key, label: r.label, shown: r.shown, saw: r.saw })),
      uiRare: ui.filter((r) => r.clicks > 0 && r.clicks <= max).map((r) => ({ key: r.key, label: r.label, clicks: r.clicks, users: r.users, shown: r.shown })),
    };
    res.json({ ok: true, from, to, max, since: { api: apiSince, ui: uiSince, audit: auditSince },
      note: "API の回数と画面のボタンの回数は、この仕組みを入れた日から数えています（それより前の日は 0）。書き込みの操作だけは監査ログ（2026-11-19 から）でも数えています。読むだけの操作・画面のボタンは、それより前は分かりません。この一覧は消す候補の材料で、何も消していません。",
      candidates: cand, api: apiRows.sort((a, b) => apiUsed(a) - apiUsed(b)), ui });
  }));
}
