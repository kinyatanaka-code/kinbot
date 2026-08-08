// ───────────────────────────────────────────────────────────
// デザイン確認用のローカルプレビューサーバー
//
// 使い方（リポジトリのルートで実行）
//   node dev/preview.js
//   → http://localhost:8099/apo.html をブラウザで開く
//
// DBもGoogle連携も不要。/api/... はすべてこのファイル内のダミーデータを返す。
// public/ のCSSやHTMLを保存してブラウザをリロードすれば、すぐ反映される。
//
// 表示するデータを変えたいときは、下の MOCK を書き換える。
// 件数を増やして詰まり具合を見たり、担当未定だけにしたりできる。
// ───────────────────────────────────────────────────────────
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, "..", "public");
const PORT = process.env.PORT || 8099;

// ===== ダミーデータ =====================================================
const REPS = [
  { email: "ueno@neo-career.co.jp", eligible_days: 60, suspended_days: 0, baseline_count: 90, businesses: ["DOC"],   name: "植野 大輔", has_zoom_link: true },
  { email: "tanaka@neo-career.co.jp", eligible_days: 60, suspended_days: 0, baseline_count: 87, businesses: ["DOC"], name: "田中 遼",   has_zoom_link: true },
  { email: "eda@neo-career.co.jp", eligible_days: 60, suspended_days: 0, baseline_count: 90, businesses: ["DOC","MOCHICA"],    name: "江田 直人", has_zoom_link: true },
  { email: "morita@neo-career.co.jp", eligible_days: 53, suspended_days: 7, baseline_count: 76, businesses: ["MOCHICA"], name: "森田 彩",   has_zoom_link: false },
];

const SENT = { status: "sent", at: "2026-08-08T02:00:00.000Z" };
const DRAFT = { status: "draft", at: "2026-08-08T02:10:00.000Z" };
const FAILED = { status: "failed", error: "Gmail送信 403: 権限がありません" };

// 見た目の確認用に、状態のパターンを一通り並べてある
const APPOINTMENTS = [
  mk(1, "飯島 稜",   "【新/ヒ】株式会社ベルク　町田様",                     "2026-08-27T02:00:00.000Z", "2026-07-06",
     { owner: "ueno@neo-career.co.jp",   mail: { confirm: DRAFT },                 clientEmail: "machida@belc.example.jp", source: "description" }),
  mk(2, "加藤 宋宙", "【初回/】合同会社サンライズ　佐藤様（資料希望）",       "2026-08-27T05:30:00.000Z", "2026-08-05",
     { owner: "tanaka@neo-career.co.jp", mail: { confirm: SENT, reminder: SENT }, clientEmail: "sato@sunrise.example.jp", source: "description" }),
  mk(3, "迫間 美羽", "【新/ヒ】株式会社アイドマ・ホールディングス　田中様",   "2026-08-28T01:00:00.000Z", "2026-08-06",
     { owner: "eda@neo-career.co.jp",    mail: { confirm: FAILED },               clientEmail: "tanaka@aidma.example.jp", source: "manual" }),
  mk(4, "薦原 一樹", "【新/ヒ】株式会社グリーンフィールド　鈴木様",           "2026-08-28T06:00:00.000Z", "2026-08-07", {}),
  mk(5, "飯島 稜",   "【初回】株式会社ミナト工業　高橋様",                   "2026-08-31T03:00:00.000Z", "2026-08-08",
     { owner: "morita@neo-career.co.jp" }),
];

function mk(n, setter, title, start, createdDate, { owner = null, mail = {}, clientEmail = "", source = "" } = {}) {
  return {
    event_id: `ev${n}`, setter_name: setter, title, start,
    created: `${createdDate}T04:00:00.000Z`, created_date: createdDate,
    original_url: "https://zoom.us/j/1", slug: `abc-def-${String(n).padStart(3, "0")}`,
    smart_url: `http://localhost:${PORT}/j/9006868174?pwd=Qj7DcInBMT6vePGojiFG_${n}`,
    current_owner: owner, client_email: clientEmail, client_name: "",
    client_email_source: source, business: n % 2 === 0 ? "MOCHICA" : "DOC", auto_assigned_at: null, mail,
  };
}

const TEAMS = [
  { team_name: "浦林チーム", sort_order: 1, active: true,  priority: false, assigned_count: 82, next_email: "eda@neo-career.co.jp" },
  { team_name: "中澤チーム", sort_order: 2, active: true,  priority: true,  assigned_count: 67, next_email: "tanaka@neo-career.co.jp" },
];

const CLOSERS = [
  { email: "ueno@neo-career.co.jp", eligible_days: 62, suspended_days: 0, baseline_count: 90, businesses: ["DOC"],   name: "植野 大輔", team: "浦林チーム", sort_order: 1, active: true,  priority: false, daily_cap: null, assigned_count: 42, period_count: 11 },
  { email: "tanaka@neo-career.co.jp", eligible_days: 62, suspended_days: 0, baseline_count: 87, businesses: ["DOC"], name: "田中 遼",   team: "中澤チーム", sort_order: 2, active: true,  priority: true,  daily_cap: 3,    assigned_count: 38, period_count: 9 },
  { email: "eda@neo-career.co.jp", eligible_days: 62, suspended_days: 0, baseline_count: 90, businesses: ["DOC","MOCHICA"],    name: "江田 直人", team: "浦林チーム", sort_order: 3, active: true,  priority: false, daily_cap: null, assigned_count: 40, period_count: 10 },
  { email: "morita@neo-career.co.jp", eligible_days: 55, suspended_days: 7, baseline_count: 76, businesses: ["MOCHICA"], name: "森田 彩",   team: "中澤チーム", sort_order: 4, active: false, priority: false, daily_cap: 2,    assigned_count: 29, period_count: 6 },
  { email: "ura@neo-career.co.jp", eligible_days: 62, suspended_days: 0, baseline_count: 4, businesses: ["DOC"], name: "浦林 鷹也", team: "浦林チーム", sort_order: 5, active: true,  priority: false, daily_cap: null, assigned_count: 6,  period_count: 1, fallback: true },
  { email: "etori@neo-career.co.jp", eligible_days: 62, suspended_days: 0, baseline_count: 0, name: "餌取 鴻志", team: "", sort_order: 7, active: true, priority: false, daily_cap: null, assigned_count: 0, period_count: 0 },
  { email: "naka@neo-career.co.jp", eligible_days: 62, suspended_days: 0, baseline_count: 3, businesses: ["DOC"], name: "中澤 良太", team: "中澤チーム", sort_order: 6, active: true,  priority: false, daily_cap: null, assigned_count: 4,  period_count: 0, fallback: true },
];

const CONFIRM_SUBJECT = "【ご案内】お打ち合わせ日程について（{{自社名}}）";
const CONFIRM_BODY = `{{会社名}}
{{お客様名}}様

いつも大変お世話になっております。
{{自社名}}の{{担当者姓}}でございます。

先ほどは弊社{{アポ獲得者姓}}のお電話にご対応いただき、
またお忙しい中お打ち合わせのお時間をいただき、
誠にありがとうございました。

それでは、お打ち合わせの日程につきまして、
下記のとおりご案内いたします。

【日時】{{商談日時}}
【形式】Web会議（Zoom）
{{ZoomURL}}
ミーティングID: {{ミーティングID}}
パスコード: {{パスコード}}

当日は、{{お客様名}}様の現在の採用状況をお伺いさせていただき、
採用領域全般でご活用いただける弊社AIエージェントが{{お客様名}}様にとってどのようにお役立ちできるか、
具体的にご案内させていただければと存じます。

{{お客様名}}様にとって少しでも有意義なお時間となるよう準備してまいります。
ご不明点などございましたら、お気軽にご連絡ください。

{{お客様名}}様とお話しできることを心より楽しみにしております。
当日はどうぞよろしくお願いいたします。

■━━━━━━━━━━━━━━━━━━━━━━━━━■
◇{{自社名}}（http://www.neo-career.co.jp/）
{{部署}}
{{ユニット}}
{{担当者名}}　/　{{担当者ローマ字}}
Phone：{{担当者電話}}
◇本社 〒160-0023
東京都新宿区西新宿1-22-2 新宿サンエービル4階
TEL：03-6756-0421　 FAX：03-5908-8385
■━━━━━━━━━━━━━━━━━━━━━━━━━■`;
const REMINDER_SUBJECT = "【リマインド】明日{{商談時刻}}〜 お打ち合わせのご案内（{{自社名}}）";
const REMINDER_BODY = `{{会社名}}
{{お客様名}}様

いつも大変お世話になっております。
{{自社名}}の{{担当者姓}}でございます。

明日のお打ち合わせにつきまして、あらためてご案内いたします。

【日時】{{商談日時}}
【形式】Web会議（Zoom）
{{ZoomURL}}
ミーティングID: {{ミーティングID}}
パスコード: {{パスコード}}

お時間になりましたら、上記URLよりご入室ください。
ご都合が変わられた場合は、お手数ですが本メールにご返信ください。

{{お客様名}}様とお話しできることを楽しみにしております。
当日はどうぞよろしくお願いいたします。

■━━━━━━━━━━━━━━━━━━━━━━━━━■
◇{{自社名}}（http://www.neo-career.co.jp/）
{{部署}}
{{ユニット}}
{{担当者名}}　/　{{担当者ローマ字}}
Phone：{{担当者電話}}
◇本社 〒160-0023
東京都新宿区西新宿1-22-2 新宿サンエービル4階
TEL：03-6756-0421　 FAX：03-5908-8385
■━━━━━━━━━━━━━━━━━━━━━━━━━■`;

const MAIL_CONFIG = {
  deliverMode: "draft", autoConfirm: true, autoReminder: true, reminderHour: 8, maxPerRun: 50,
  companyName: "株式会社ネオキャリア",
  confirmSubject: CONFIRM_SUBJECT,
  confirmBody: CONFIRM_BODY,
  reminderSubject: REMINDER_SUBJECT,
  reminderBody: REMINDER_BODY,
  defaults: {
    confirmSubject: CONFIRM_SUBJECT, confirmBody: CONFIRM_BODY,
    reminderSubject: REMINDER_SUBJECT, reminderBody: REMINDER_BODY,
  },
};

const SUSPENSIONS = [
  { id: 1, email: "morita@neo-career.co.jp", name: "森田 彩", start_date: "2026-07-06", end_date: "2026-07-12", reason: "割り振り停止", created_by: "kinya.tanaka@neo-career.co.jp" },
];

const TEAM_STATS = [
  { team: "浦林チーム", members: 3, activeMembers: 2, fallbackMembers: 1, count: 202, perHead: 101, personDays: 120, perDay: 1.683, baseline: 180, totalAllTime: 82, active: true,  priority: false, sortOrder: 1 },
  { team: "中澤チーム", members: 3, activeMembers: 2, fallbackMembers: 1, count: 178, perHead: 89, personDays: 113, perDay: 1.575, baseline: 163, totalAllTime: 67, active: true,  priority: true,  sortOrder: 2 },
];

const ROTATION = {
  config: { autoAssign: true, autoScan: true, bufferMin: 15, nextOrder: 2, maxPerRun: 30, scanIntervalSec: 60,
            teamBalance: "perDay", balanceWindow: "all", fairnessStart: "2026-06-08" },
  closers: CLOSERS, order: CLOSERS, teams: TEAMS, teamStats: TEAM_STATS, suspensions: SUSPENSIONS,
  period: { window: "month", label: "2026年8月" },
  next: { email: "tanaka@neo-career.co.jp", profile: { nameRoman: "Ryo Tanaka", phone: "080-2222-2222", dept: "事業統括本部 事業開発部", unit: "DOCユニット FSグループ" }, name: "田中 遼", team: "中澤チーム", priority: true },
};

const MEMBERS = [
  { email: "ueno@neo-career.co.jp", profile: { nameRoman: "Hikari Ueno", phone: "080-1111-1111", dept: "事業統括本部 事業開発部", unit: "DOCユニット FSグループ" },   name: "植野 大輔", businesses: ["DOC"],           team: "浦林チーム", roles: ["closer"],   active: true,  daily_cap: null, sort_order: 1 },
  { email: "tanaka@neo-career.co.jp", profile: { nameRoman: "Ryo Tanaka", phone: "080-2222-2222", dept: "事業統括本部 事業開発部", unit: "DOCユニット FSグループ" }, name: "田中 遼",   businesses: ["DOC"],           team: "中澤チーム", roles: ["closer"],   active: true,  daily_cap: 3,    sort_order: 2 },
  { email: "eda@neo-career.co.jp",    name: "江田 直人", businesses: ["DOC","MOCHICA"], team: "浦林チーム", roles: ["closer"],   active: true,  daily_cap: null, sort_order: 3 },
  { email: "morita@neo-career.co.jp", name: "森田 彩",   businesses: ["MOCHICA"],       team: "中澤チーム", roles: ["closer"],   active: false, daily_cap: 2,    sort_order: 4 },
  { email: "ura@neo-career.co.jp",    name: "浦林 鷹也", businesses: ["DOC"],           team: "浦林チーム", roles: ["fallback"], active: true,  daily_cap: null, sort_order: 5 },
  { email: "naka@neo-career.co.jp",   name: "中澤 良太", businesses: ["DOC"],           team: "中澤チーム", roles: ["fallback"], active: true,  daily_cap: null, sort_order: 6 },
  { email: "iijima@neo-career.co.jp", name: "飯島 稜",   businesses: ["DOC"],           team: "浦林チーム", roles: ["inside"],   active: true,  daily_cap: null, sort_order: 7 },
  { email: "kato@neo-career.co.jp",   name: "加藤 宋宙", businesses: ["DOC"],           team: "中澤チーム", roles: ["inside"],   active: true,  daily_cap: null, sort_order: 8 },
  { email: "hazama@neo-career.co.jp", name: "迫間 美羽", businesses: ["MOCHICA"],       team: "",           roles: ["inside"],   active: true,  daily_cap: null, sort_order: 9 },
];

// 表示を切り替えて確認したいとき用のスイッチ（?empty=1 などで呼べる）
const MOCK = { REPS, APPOINTMENTS, CLOSERS, MAIL_CONFIG, ROTATION, TEAMS, TEAM_STATS, MEMBERS };

// ===== ルーティング =====================================================
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".ico": "image/x-icon", ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2", ".woff": "font/woff",
};

function json(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

function apiResponse(pathname, query) {
  // 一覧
  if (pathname === "/api/apo/pickup") {
    const empty = query.get("empty") === "1";
    const many = parseInt(query.get("many") || "0", 10);
    const biz = String(query.get("product") || "");
    let list = empty ? [] : MOCK.APPOINTMENTS.slice();
    if (biz) list = list.filter((a) => !a.business || a.business === biz);
    if (many > 0) {
      list = [];
      for (let i = 0; i < many; i++) {
        const base = MOCK.APPOINTMENTS[i % MOCK.APPOINTMENTS.length];
        list.push({ ...base, slug: `${base.slug}-${i}`, event_id: `ev-${i}` });
      }
    }
    return {
      filters: { created: query.get("created") || "", start: query.get("start") || "" },
      count: list.length, appointments: list,
      // ?err=1 でカレンダー読み取りエラーの表示も確認できる
      errors: query.get("err") === "1"
        ? [{ setter: "笹原拓真", email: "sasahara@x.jp", error: "カレンダーを読めませんでした" }] : [],
      mail_config: MOCK.MAIL_CONFIG, rotation: MOCK.ROTATION,
    };
  }
  if (pathname === "/api/rep-products") {
    const map = {};
    for (const m of MEMBERS) if (m.businesses.length === 1) { map[m.name] = m.businesses[0]; map[m.email] = m.businesses[0]; }
    return { map };
  }
  if (pathname === "/api/members") {
    return { members: MEMBERS,
      candidates: [{ email: "new@neo-career.co.jp", name: "新入 太郎", src: "ユーザー" }],
      teams: ["浦林チーム", "中澤チーム"], roles: ["closer", "inside", "fallback"],
      businesses: ["DOC", "MOCHICA"],
      labels: { closer: "クローザー", inside: "インサイド", fallback: "予備" } };
  }
  if (pathname.indexOf("/api/apo/suspensions") === 0) return { ok: true, ...MOCK.ROTATION };
  if (pathname === "/api/apo/closer-order") return { ok: true, ...MOCK.ROTATION };
  if (pathname === "/api/apo/invites") {
    return { hours: 24, invites: [
      { slug: "abc-def-001", label: "【初回】株式会社テスト/テスト様", setter: "田中欽也", business: "DOC",
        owner: "m_morita@neo-career.co.jp", ownerName: "森田弥鳴", start: "2026-08-09T05:00:00.000Z",
        eventId: "ev1", eventOwner: "m_morita@neo-career.co.jp", eventOwnerName: "森田弥鳴",
        updatedAt: "2026-08-09T04:50:00.000Z" },
      { slug: "abc-def-003", label: "【初回】テスト株式会社/テスト様", setter: "田中欽也", business: "DOC",
        owner: "ueno@neo-career.co.jp", ownerName: "植野ひかり", start: "2026-08-09T08:00:00.000Z",
        eventId: "ev2", eventOwner: "ueno@neo-career.co.jp", eventOwnerName: "植野ひかり",
        updatedAt: "2026-08-09T04:52:00.000Z" },
    ] };
  }
  if (pathname === "/api/apo/orphan-invites") {
    return { owners: ["kinya.tanaka@neo-career.co.jp", "m_morita@neo-career.co.jp"],
      found: [{ owner: "kinya.tanaka@neo-career.co.jp", eventId: "old1",
                title: "【初回】テスト株式会社/テスト様", start: "2026-08-09T08:00:00.000Z" }],
      errors: [] };
  }
  if (pathname === "/api/apo/orphan-invites/delete") return { ok: true, deleted: 1, done: [], failed: [] };
  if (pathname === "/api/apo/calendar-check") {
    return { owner: "kinya.tanaka@neo-career.co.jp",
      window: { from: "2026-08-01", to: "2026-10-07" },
      members: [
        { name: "飯島 稜", email: "iijima@neo-career.co.jp", readable: true, total: 34, hosted: 21, tagged: 21, samples: [] },
        { name: "加藤 宋宙", email: "kato@neo-career.co.jp", readable: true, total: 12, hosted: 9, tagged: 0, samples: [
            { title: "株式会社サンプル 面談", start: "" }, { title: "定例MTG", start: "" }] },
        { name: "田中欽也", email: "tanaking0924@gmail.com", readable: false, total: 0, hosted: 0, tagged: 0, samples: [],
          error: "カレンダーを参照できません（このアドレスのカレンダーが代表者に共有されていない可能性があります）" },
        { name: "迫間 美羽", email: "hazama@neo-career.co.jp", readable: true, total: 0, hosted: 0, tagged: 0, samples: [] },
      ] };
  }
  if (pathname === "/api/apo/suspensions") return { suspensions: SUSPENSIONS, activeNow: {} };
  if (pathname === "/api/apo/baseline") return { ok: true, matched: [], unmatched: [], ...MOCK.ROTATION };
  if (pathname === "/api/smart-links/reps") return MOCK.REPS;
  if (pathname === "/api/apo/rotation") {
    const b = String(query.get("product") || "");
    // 実サーバーと同じく、その事業を担当する人だけに絞る（未設定の人はどの事業でも残す）
    const cl = b ? CLOSERS.filter((c) => !c.businesses || !c.businesses.length || c.businesses.includes(b)) : CLOSERS;
    const teamsIn = [...new Set(cl.map((c) => c.team))];
    return { ...MOCK.ROTATION, business: b, closers: cl, order: cl,
      teams: TEAMS.filter((t) => teamsIn.includes(t.team_name)),
      teamStats: TEAM_STATS.filter((t) => teamsIn.includes(t.team)),
      next: cl.find((c) => !c.fallback && c.active) || null };
  }
  if (pathname === "/api/apo/team-stats") {
    const b = String(query.get("product") || "");
    if (b) {
      const cl = CLOSERS.filter((c) => !c.businesses || !c.businesses.length || c.businesses.includes(b));
      const tn = [...new Set(cl.map((c) => c.team))];
      const mem = {};
      for (const t of tn) mem[t] = cl.filter((c) => c.team === t)
        .map((c) => ({ email: c.email, name: c.name, active: c.active, count: c.period_count || 0, total_all_time: c.assigned_count }));
      return { period: { window: "all", label: "2026-06-08以降" }, business: b, mode: "perDay",
        teams: TEAMS.filter((t) => tn.includes(t.team_name)),
        teamStats: TEAM_STATS.filter((t) => tn.includes(t.team)), members: mem };
    }
    return { period: { window: query.get("window") || "all", label: "2026-06-08以降" },
      mode: "perDay", teams: TEAMS, teamStats: TEAM_STATS,
      members: {
        "浦林チーム": [{ email: "ueno@neo-career.co.jp", profile: { nameRoman: "Hikari Ueno", phone: "080-1111-1111", dept: "事業統括本部 事業開発部", unit: "DOCユニット FSグループ" }, name: "植野 大輔", active: true, count: 11, total_all_time: 42 },
                     { email: "eda@neo-career.co.jp", name: "江田 直人", active: true, count: 10, total_all_time: 40 },
                     { email: "ura@neo-career.co.jp", name: "浦林 鷹也", active: true, count: 1, total_all_time: 6 }],
        "中澤チーム": [{ email: "tanaka@neo-career.co.jp", name: "田中 遼", active: true, count: 9, total_all_time: 38 },
                     { email: "morita@neo-career.co.jp", name: "森田 彩", active: false, count: 6, total_all_time: 29 },
                     { email: "naka@neo-career.co.jp", name: "中澤 良太", active: true, count: 0, total_all_time: 4 }],
      } };
  }
  if (pathname === "/api/apo/teams") return { ok: true, ...MOCK.ROTATION };
  if (pathname === "/api/apo-mail-config") return MOCK.MAIL_CONFIG;
  if (pathname === "/api/apo/assign-log") {
    return [
      { created_at: "2026-08-08T02:00:00.000Z", assigned: "eda@neo-career.co.jp", reason: "ローテーション順",
        skipped: [{ name: "田中 遼", reason: "この時間帯に別の予定が入っています" }] },
      { created_at: "2026-08-07T23:30:00.000Z", assigned: null, reason: "全員この時間帯に予定が入っています", skipped: [] },
    ];
  }
  if (pathname === "/api/version") {
    return {
      build: "ローカルプレビュー（dev/preview.js・ダミーデータ）",
      startedAt: new Date().toISOString(), features: [],
    };
  }
  if (pathname === "/api/db/schema-check" || pathname === "/api/db/schema-repair") {
    return { ok: true, connected: true, missingTables: [], missingColumns: [], failures: [] };
  }
  if (pathname === "/api/me") {
    return { email: "kinya.tanaka@neo-career.co.jp", name: "田中欽也", isAdmin: true };
  }
  if (pathname === "/api/apo/auto-scan") return { ok: true, total: 5, targets: 2, assigned: 2, results: [] };
  if (pathname === "/api/apo-mail/run-reminders") return { ok: true, total: 3, sent: 3, results: [] };
  // 保存・更新系はとりあえず成功を返す（画面の挙動だけ確認できればよい）
  if (pathname.startsWith("/api/apo/closers") || pathname.startsWith("/api/apo/rotation")) {
    return { ok: true, ...MOCK.ROTATION };
  }
  if (pathname.indexOf("/api/apo/invites/") === 0) return { ok: true };
  if (pathname.startsWith("/api/smart-links/")) return { ok: true, link: {}, mail: { ok: true } };
  return {};
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith("/api/")) {
    // ボディは読み捨てる（保存内容は保持しない）
    req.resume();
    req.on("end", () => json(res, apiResponse(pathname, url.searchParams)));
    return;
  }

  const rel = pathname === "/" ? "/apo.html" : pathname;
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ""));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end("forbidden"); }

  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); return res.end("見つかりません: " + rel); }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream",
      "cache-control": "no-store", // 保存したらリロードで必ず反映される
    });
    res.end(buf);
  });
});

server.listen(PORT, () => {
  console.log(`
  ローカルプレビューを起動しました（ダミーデータ・DB不要）

    アポ振り分け   http://localhost:${PORT}/apo.html
    ホーム         http://localhost:${PORT}/home.html
    メンバー管理   http://localhost:${PORT}/settings.html

  表示パターンの切り替え（URLに付ける）
    ?many=30   アポを30件に増やして詰まり具合を見る
    ?empty=1   0件のときの表示を見る
    ?err=1     カレンダー読み取りエラーの表示を見る
    例: http://localhost:${PORT}/apo.html?many=30

  CSSやHTMLを保存 → ブラウザをリロードすれば即反映されます。
  止めるときは Ctrl + C
`);
});
