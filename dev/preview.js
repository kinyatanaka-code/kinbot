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
    excluded: n === 3,   // 3件目をテスト扱いにして、見え方を確かめる
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

function fixMojibake(str) {
  const t = String(str || "");
  if (!t || !/[\u0080-\u00FF]/.test(t)) return t;
  try { const re = Buffer.from(t, "latin1").toString("utf8"); if (re && !re.includes("\uFFFD")) return re; } catch {}
  return t;
}

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
  if (pathname === "/api/sessions/active") {
    return [{ botId: "bot-demo-1", title: "【初回】株式会社ベルク　町田様", repName: "田中欽也", startedAt: new Date().toISOString() }];
  }
  if (pathname === "/api/meetings") {
    const t = new Date(); const d = t.toISOString().slice(0, 10);
    return [
      { bot_id: "bot-demo-1", title: "【初回】アールプランナーグループ／水谷様", owner_name: "田中欽也",
        created_at: d + "T00:30:00.000Z", summary: { overview: "採用の課題を伺い、DOCの提案を実施" } },
      { bot_id: "bot-demo-2", title: "【初回】株式会社時之栖／奥宮様", owner_name: "田中欽也",
        created_at: d + "T23:00:00.000Z", summary: { overview: "既存の運用を確認" } },
    ];
  }
  if (pathname === "/api/kasasagi/status") {
    if (!globalThis.__ks) return { tts: { provider: "edge", ready: true }, active: [], session: null };
    return { tts: { provider: "edge", ready: true }, active: ["bot-demo-1"], session: {
      botId: "bot-demo-1", speaking: false, autoAnswer: true, autoAdvance: true,
      mode: "buddy", listening: false, stopped: false, slide: "service", slideLabel: "サービスの説明",
      unanswered: 1, ngHits: 0, scriptTotal: 6, scriptIndex: 3, queued: 0, error: "",
      log: [
        { at: "", kind: "info", text: "かささぎを開始しました" },
        { at: "", kind: "info", text: "台本が空だったので、社内の情報から自動で作りました" },
        { at: "", kind: "script", text: "本日はお時間をいただきありがとうございます。ネオキャリアのかささぎと申します。" },
        { at: "", kind: "hear", text: "町田様: 佐々木さんお願いします" },
        { at: "", kind: "answer", text: "はい、よろしくお願いいたします。" },
        { at: "", kind: "script", text: "まず御社の採用状況をお伺いできればと思います。" },
        { at: "", kind: "hear", text: "町田様: 料金はいくらくらいになりますか？" },
        { at: "", kind: "answer", text: "料金は社数と期間で変わります。確認して折り返します。" },
        { at: "", kind: "skip", text: "相づちと判断：なるほど" },
        { at: "", kind: "lead", text: "ここまでで、気になる点はございますか。" },
        { at: "", kind: "slide", text: "スライドを「サービスの説明」に切り替えました" },
        { at: "", kind: "todo", text: "答えられなかった質問として記録：他社ATSとの連携は" },
      ] } };
  }
  if (pathname === "/api/kasasagi/look") return { avatarUrl: "", avatarSpeakUrl: "", name: "かささぎ", brand: "NEO CAREER" };
  if (pathname === "/api/kasasagi/selftest") return { ok: false, steps: [
    { name: "読み上げ（音声を作る）", ok: true, detail: "edge / ja-JP-NanamiNeural / 12KB / 380ms", hint: "" },
    { name: "Botが喋れる作りか", ok: false, detail: "variant=(なし) / 状態=in_call_recording",
      hint: "このBotは音声を出せない作りで入室しています。いったん退出し、レコーディング画面で「かささぎ（AIが説明する）を使う」にチェックを入れてから入室し直してください。（入室後に切り替えることはできません）" },
  ] };
  if (pathname === "/api/kasasagi/face") return { ok: true, slide: "service", label: "サービスの説明", speaking: false, listening: false, caption: "会社の様子をそのまま見ていただけます。", summary: "" };
  if (pathname === "/api/kasasagi/unanswered") return { items: [
    { id: 1, question: "他社ATSとの連携は可能ですか？", title: "【初回】株式会社ベルク", asked_by: "町田様", answer: null, answered_at: null },
    { id: 2, question: "解約はいつでもできますか？", title: "【初回】合同会社サンライズ", asked_by: "佐藤様", answer: "契約期間は1年で、更新月に解約できます。", answered_at: "2026-08-08" },
  ], blocked: [] };
  if (pathname === "/api/kasasagi/start") { globalThis.__ks = true; return { ok: true, slides: { cover: "表紙", company: "会社紹介", problem: "採用の課題", service: "サービスの説明", usage: "使い方", flow: "導入の流れ", case: "導入事例", pricing: "料金", faq: "よくある質問", next: "次のご案内", summary: "この商談のまとめ" }, generatedScript: "本日はお時間をいただきありがとうございます。ネオキャリアのかささぎと申します。まず御社の採用状況をお伺いします。次にサービスをご説明します。" }; }
  if (pathname === "/api/kasasagi/stop") { globalThis.__ks = false; return { ok: true }; }
  if (pathname.indexOf("/api/kasasagi/") === 0) return { ok: true, done: false, remaining: 2 };
  if (pathname === "/api/salesforce/tasks") {
    globalThis.__tasks = globalThis.__tasks || [
      { id: "00T1", subject: "2026-08-12_商談_田中 欽也", status: "未完了", isClosed: false,
        activityDate: "2026-08-12", owner: "田中 欽也", actKind: "商談", nextKind: "再商談", nextDate: "2026-08-19",
        description: "本商談は、AI採用担当サービス「どこでもオープンカンパニー」に関する提案商談である。" },
      { id: "00T2", subject: "[次回アクション] 見積提出", status: "未着手", isClosed: false,
        activityDate: "2026-08-14", owner: "田中 欽也", actKind: "", nextKind: "見積提出", nextDate: "2026-08-10",
        description: "3拠点分の見積を作って送付する" },
      { id: "00T3", subject: "2026-08-06_電話_田中 欽也", status: "完了", isClosed: true,
        activityDate: "2026-08-06", owner: "田中 欽也", actKind: "電話", nextKind: "", nextDate: "",
        description: "すんなりアポくれた／DOCのことは知らなかった" },
    ];
    return { tasks: globalThis.__tasks, fieldNames: { actKind: "ActKind__c", nextKind: "NextKind__c", nextDate: "NextDate__c" } };
  }
  if (pathname.indexOf("/api/salesforce/task/") === 0 && pathname.endsWith("/status")) {
    const id = pathname.split("/")[4];
    const t = (globalThis.__tasks || []).find((x) => x.id === id);
    if (t) { t.isClosed = !t.isClosed; t.status = t.isClosed ? "完了" : "未完了"; }
    return { ok: true, status: t ? t.status : "完了" };
  }
  if (pathname === "/api/salesforce/next-action") return { ok: true, id: "00T9", warn: "" };
  if (pathname.indexOf("/api/doc/") === 0 && pathname.endsWith("/open")) {
    return { ok: true, viewId: 1, name: "DOCサービス紹介", filename: "doc_service.pdf", to: "株式会社ベルク 町田" };
  }
  if (pathname.indexOf("/api/doc/") === 0 && pathname.endsWith("/beat")) {
    globalThis.__beat = (globalThis.__beat || 0) + 1;
    return { ok: true, seconds: 0 };
  }
  if (pathname === "/api/mail-templates") return { templates: [
    { id: "t1", name: "初回・価格の話が出たとき", subject: "【御礼】本日はありがとうございました",
      body: "ネオキャリアの田中です。\n\n本日はお忙しい中ありがとうございました。\n\n【商談で伺った課題】\n\n【弊社からのご提案】\n\nまずは本日の御礼まで。" },
    { id: "t2", name: "初回・導入時期が未定", subject: "", body: "本日はお時間をいただきありがとうございました。" },
  ] };
  if (pathname.indexOf("/api/meetings/") === 0 && pathname.endsWith("/thanks")) {
    return { subject: "【時之栖】本日のお打ち合わせのお礼（株式会社ネオキャリア）",
      body: "株式会社時之栖\n奥宮様\n\nいつも大変お世話になっております。\n株式会社ネオキャリアの田中でございます。\n\n本日は、お忙しい中お打ち合わせのお時間をいただき、誠にありがとうございました。\n\n冒頭、通信環境によりご迷惑をおかけし、大変申し訳ございませんでした。奥宮様には、ご退出・再入室までご対応いただき、重ねて御礼申し上げます。\n\n今回ヒアリングさせていただきました、求職者の方が応募前に抱える情報収集の不安や、リアルな社内の様子を伝えたいというご要望について、弊社の「どこでもオープンカンパニー」でお役立ちできると考えております。\n\n引き続きどうぞよろしくお願いいたします。" };
  }
  if (pathname.indexOf("/api/meetings/") === 0 && pathname.endsWith("/thanks-gmail-draft")) {
    return { ok: true, replied: false, to: "okumiya@tokinosumika.example.jp", url: "https://mail.google.com/mail/u/0/#drafts" };
  }
  if (pathname === "/api/docs") {
    return { base: "https://kinbot-production-225f.up.railway.app", docs: [
      { id: 1, name: fixMojibake(Buffer.from("【DOC】サービス紹介_2026年版.pptx.pdf","utf8").toString("latin1")), filename: fixMojibake(Buffer.from("【DOC】サービス紹介_2026年版.pptx.pdf","utf8").toString("latin1")), size: 2411520, active: true,
        uploaded_by: "kinya.tanaka@neo-career.co.jp", created_at: "2026-08-01T02:00:00Z", links: 214, views: 63 },
      { id: 2, name: "導入事例（製造業）", filename: "case_manufacturing.pdf", size: 1802240, active: true,
        uploaded_by: "kinya.tanaka@neo-career.co.jp", created_at: "2026-08-05T02:00:00Z", links: 88, views: 21 },
      { id: 3, name: "料金表（2026年度）", filename: "price_2026.pdf", size: 512000, active: false,
        uploaded_by: "kinya.tanaka@neo-career.co.jp", created_at: "2026-07-10T02:00:00Z", links: 0, views: 0 },
    ] };
  }
  if (pathname === "/api/doc-links") {
    const mk = (i, o) => ({
      id: i, slug: "slug" + i, doc_name: "DOCサービス紹介", url: "https://kinbot-production-225f.up.railway.app/d/slug" + i,
      company: o.c, contact: o.n, email: o.e, view_count: o.v || 0, total_seconds: o.s || 0,
      total_label: o.s ? (o.s >= 60 ? Math.floor(o.s/60) + "分" + (o.s%60 ? (o.s%60)+"秒" : "") : o.s + "秒") : "0秒",
      max_page: o.p || 0, last_at: o.at || null, opens: o.o || 0, clicks: o.k || 0,
    });
    return { base: "https://kinbot-production-225f.up.railway.app", links: [
      mk(1, { c: "株式会社ベルク", n: "町田", e: "machida@belc.example.jp", v: 4, s: 312, p: 9, o: 6, k: 2, at: "2026-08-12T05:20:00Z" }),
      mk(2, { c: "合同会社サンライズ", n: "佐藤", e: "sato@sunrise.example.jp", v: 1, s: 46, p: 3, o: 2, k: 0, at: "2026-08-11T23:10:00Z" }),
      mk(3, { c: "株式会社ミナト工業", n: "高橋", e: "takahashi@minato.example.jp", v: 2, s: 138, p: 7, o: 3, k: 1, at: "2026-08-10T07:40:00Z" }),
      mk(4, { c: "株式会社コロンバン", n: "宮村", e: "miyamura@colombin.co.jp", v: 0, s: 0, p: 0, o: 1, k: 0 }),
      mk(5, { c: "一般財団法人沖縄美ら島財団", n: "比嘉", e: "w-higa@okichura.jp", v: 0, s: 0, p: 0, o: 0, k: 0 }),
    ] };
  }
  if (pathname.indexOf("/api/doc-links/") === 0) {
    return { link: { slug: "slug1", company: "株式会社ベルク" }, views: [
      { started_at: "2026-08-12T05:20:00Z", seconds_label: "2分12秒", max_page: 9, top_pages: "5ページ 1分2秒／7ページ 15秒" },
      { started_at: "2026-08-11T02:05:00Z", seconds_label: "58秒", max_page: 4, top_pages: "1ページ 22秒" },
    ], events: [
      { at: "2026-08-12T05:19:00Z", kind: "open", url: null },
      { at: "2026-08-12T05:25:00Z", kind: "click", url: "https://neo-career.co.jp/doc/price" },
    ] };
  }
  if (pathname === "/api/next-actions") {
    // company で絞る想定（モックでは常に同じ一覧を返す）
    globalThis.__na = globalThis.__na || [
      { id: 1, kind: "見積提出", content: "3拠点分の見積を作って送付する", due_date: "2026-08-14", done: false },
      { id: 2, kind: "資料送付", content: "導入事例（製造業）を送る", due_date: "2026-08-10", done: false },
      { id: 3, kind: "電話", content: "決裁者の同席可否を確認", due_date: null, done: true, done_by: "kinya.tanaka@neo-career.co.jp" },
    ];
    return { kinds: ["電話","メール","再商談","資料送付","見積提出","社内確認","稟議待ち","その他"], items: globalThis.__na };
  }
  if (pathname.indexOf("/api/next-actions/") === 0) {
    const id = parseInt(pathname.split("/").pop(), 10);
    const it = (globalThis.__na || []).find((x) => x.id === id);
    if (it) it.done = !it.done;
    return { ok: true, row: it };
  }
  if (pathname === "/api/chat-targets") return { appReady: false, targets: [
    { id: 1, name: "DOC Team", webhookUrl: "https://chat.googleapis.com/v1/spaces/AAA/messages?key=x", spaceId: "",
      onAssign: true, onMail: false, onDoc: false, onLaunch: true, active: true, lastError: "", sentCount: 128, via: "Webhook" },
    { id: 2, name: "自分用（テスト）", webhookUrl: "", spaceId: "spaces/BBB",
      onAssign: true, onMail: true, onDoc: true, onLaunch: true, active: true, lastError: "", sentCount: 43, via: "kinbot名義" },
    { id: 3, name: "資料の閲覧だけ", webhookUrl: "https://chat.googleapis.com/v1/spaces/CCC/messages?key=x", spaceId: "",
      onAssign: false, onMail: false, onDoc: true, onLaunch: false, active: false,
      lastError: "Chat通知 404: space not found", sentCount: 5, via: "Webhook" },
  ] };
  if (pathname.indexOf("/api/chat-targets/") === 0) return { ok: true, via: "webhook" };
  if (pathname === "/api/chat-config") return { url: "https://chat.googleapis.com/v1/spaces/AAA/messages?key=x",
    fromEnv: false, spaceId: "", spaceFromEnv: false, notifyAssign: true, notifyMail: true,
    lastError: "", sentCount: 0, app: { configured: false, account: "" } };
  if (pathname === "/api/chat-config/test") return { ok: true };
  if (pathname === "/api/members") {
    return { members: MEMBERS,
      candidates: [{ email: "new@neo-career.co.jp", name: "新入 太郎", src: "ユーザー" }],
      teams: ["浦林チーム", "中澤チーム"], roles: ["closer", "inside", "fallback"],
      businesses: ["DOC", "MOCHICA"],
      labels: { closer: "クローザー", inside: "インサイド", fallback: "予備" } };
  }
  if (pathname.indexOf("/api/apo/suspensions") === 0) return { ok: true, ...MOCK.ROTATION };
  if (pathname === "/api/apo/closer-order") return { ok: true, ...MOCK.ROTATION };
  if (pathname === "/api/calendar/day" || pathname === "/api/calendar/today") {
    const d = new Date().toISOString().slice(0, 10);
    return { events: [
      { id: "e1", title: "【初回】株式会社ベルク／町田様", start: d + "T02:00:00.000Z", hasUrl: true },
      { id: "e2", title: "【初回】アールプランナーグループ／水谷様", start: d + "T00:30:00.000Z", hasUrl: true },
      { id: "e3", title: "【初回】株式会社ミナト工業／高橋様", start: d + "T05:00:00.000Z", hasUrl: true },
      { id: "e4", title: "【再商談】石井商事運輸／石井様", start: d + "T07:30:00.000Z", hasUrl: false },
      { id: "e5", title: "【初回】株式会社時之栖／奥宮様", start: d + "T23:00:00.000Z", hasUrl: true },
    ] };
  }
  if (pathname === "/api/calendar/created") {
    return { events: [
      { id: "cal1", title: "【初回】株式会社ベルク　町田様", start: "2026-08-09T05:00:00.000Z",
        created: "2026-08-09T02:00:00.000Z", organizer: "iijima@neo-career.co.jp",
        creator: "iijima@neo-career.co.jp", apoBy: "飯島 稜", assigneeName: "田中欽也" },
    ] };
  }
  if (pathname === "/api/salesforce/lead-fields" || pathname === "/api/salesforce/lead-create-fields") {
    return { fields: [
      { name: "LastName", label: "姓", type: "string", required: true },
      { name: "Company", label: "会社名", type: "string", required: true },
      { name: "Email", label: "メール", type: "string" },
    ], convertedStatuses: [{ value: "Closed - Converted", label: "コンバート済み" }] };
  }
  if (pathname === "/api/salesforce/launched-check") return { launched: {}, instanceUrl: "https://x.my.salesforce.com" };
  if (pathname === "/api/salesforce/leads") {
    return { records: [
      { Id: "00Qxx001", Name: "町田 太郎", Company: "株式会社ベルク", Status: "新規", Email: "machida@belc.example.jp" },
    ] };
  }
  if (pathname === "/api/users") return [{ email: "kinya.tanaka@neo-career.co.jp", name: "田中欽也" }];
  if (pathname === "/api/salesforce/search") {
    return { records: [
      { Id: "006xx0001", Name: "直販_クロス_テスト企業_99", StageName: "01：初回商談", CloseDate: "2026-09-30",
        Account: { Name: "株式会社テスト" } },
      { Id: "006xx0002", Name: "直販_新規_テスト企業", StageName: "02：提案", CloseDate: "2026-10-31",
        Account: { Name: "テスト株式会社" } },
    ] };
  }
  if (pathname === "/api/apo/mine") {
    const base = [
      { title: "【初回】株式会社ベルク　町田様", setter: "飯島 稜", business: "DOC",
        d: new Date().toISOString().slice(0,10), t: "05:00", email: "machida@belc.example.jp", ev: "ev1",
        mail: { confirm: { status: "draft" } } },
      { title: "【初回】合同会社サンライズ　佐藤様", setter: "加藤 宋宙", business: "DOC",
        d: new Date().toISOString().slice(0,10), t: "06:30", email: "sato@sunrise.example.jp", ev: "ev2",
        mail: { confirm: { status: "sent" }, reminder: { status: "sent" } } },
      { title: "【初回】株式会社ミナト工業　高橋様", setter: "迫間 美羽", business: "MOCHICA",
        d: new Date().toISOString().slice(0,10), t: "08:00", email: "takahashi@minato.example.jp", ev: "", mail: {} },
      { title: "【初回】株式会社サンプル　山田様", setter: "飯島 稜", business: "DOC",
        d: new Date().toISOString().slice(0,10), t: "10:00", email: "", ev: "", mail: {} },
      { title: "【新/ヒ】株式会社アイドマ・ホールディングス　田中様", setter: "薦原 一樹", business: "DOC",
        d: "2026-08-10", t: "02:00", email: "tanaka@aidma.example.jp", ev: "ev3",
        mail: { confirm: { status: "draft" } } },
      { title: "【初回】株式会社コロンバン　宮村様", setter: "飯島 稜", business: "DOC",
        d: "2026-08-11", t: "08:00", email: "miyamura@colombin.co.jp", ev: "",
        mail: {} },
      { title: "【初回】一般財団法人沖縄美ら島財団　比嘉様", setter: "加藤 宋宙", business: "DOC",
        d: "2026-08-17", t: "01:00", email: "w-higa@okichura.jp", ev: "ev4",
        mail: { confirm: { status: "failed", error: "403" } } },
    ];
    const from = query.get("date") || "2026-08-09";
    // 既定はその日のぶんだけ（?mode=from でそれ以降も返す）
    const mode = query.get("mode") === "from" ? "from" : "day";
    let src = base.filter((x) => (mode === "from" ? x.d >= from : x.d === from));
    // ?many=1 で件数を増やして、ペイン内スクロールを確認できる
    if (query.get("many") === "1") {
      src = Array.from({ length: 4 }, () => base.filter((x) => x.d === from)).flat();
    }
    const items = src.map((x, k) => ({
      slug: "home-" + k, title: x.title, setter: x.setter, business: x.business,
      start: `${x.d}T${x.t}:00.000Z`, clientEmail: x.email,
      smartUrl: "https://kinbot/j/home-" + k, inviteEventId: x.ev, mail: x.mail,
      launch: [
        { ok: true, oppId: "006xx1", filledUrl: "https://belc.example.jp", reasonText: "" },
        { ok: false, reasonText: "クロスのリードがありません（直販などのリードのみ）" },
        { ok: false, reasonText: "リードの担当者名が商談の担当者名と一致しません（リード側の担当者：鈴木 花子）" },
        null,
      ][k % 4],
    }));
    return { date: from, owner: "kinya.tanaka@neo-career.co.jp", mode, items };
  }
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
  if (/^\/api\/salesforce\/reports\/[^/]+\/filters$/.test(pathname)) return {
    name: "【X】コール状況管理_本日",
    filters: [
      { index: 0, column: "Owner.Name", label: "商談所有者", operator: "equals", value: "田中 欽也" },
      { index: 1, column: "Task.Status", label: "状況", operator: "notEqual", value: "未着手" },
      { index: 2, column: "Task.Subject", label: "件名", operator: "contains", value: "コール" },
    ],
    booleanFilter: "", standardDateFilter: { column: "Task.CreatedDate", durationValue: "THIS_MONTH" },
    dateRanges: [
      { value: "TODAY", label: "今日" }, { value: "THIS_WEEK", label: "今週" },
      { value: "THIS_MONTH", label: "今月" }, { value: "LAST_MONTH", label: "先月" },
    ],
  };
  if (/^\/api\/salesforce\/reports\/[^/]+\/run$/.test(pathname)) return {
    name: "【X】コール状況管理_本日",
    columns: [{ name: "c1", label: "会社名" }, { name: "c2", label: "件数" }],
    rows: [["株式会社ベルク", "12"], ["合同会社サンライズ", "8"]],
  };
  if (pathname === "/api/salesforce/reports") return { reports: [
    { id: "00O5h00000ABCDE", name: "【X】コール状況管理_本日", folder: "MOCHICA_X", format: "Summary" },
    { id: "00O5h00000FGHIJ", name: "FY25【コール状況管理】コール数_本日", folder: "MOCHICA_SDR", format: "Summary" },
    { id: "00O5h00000KLMNO", name: "6月直販新規コールドリスト", folder: "公開レポート", format: "Summary" },
  ] };
  if (pathname === "/api/process-sheet") return { sheetId: "1IgeixnK7iIrf335MR05_B97NvpjoxUEVnqoYVcVYdLY",
    sheetName: "8月アポ管理", reportId: "00O5h00000ABCDE", owner: "kinya.tanaka@neo-career.co.jp",
    termFrom: "2026-08-01", termTo: "2026-08-31", autoRun: true, intervalMin: 30, hours: "7-22",
    last: { at: "2026-08-13T05:00:00Z", ok: true, count: 128, error: "" },
    filters: { standardDateFilter: { column: "Task.CreatedDate", durationValue: "THIS_MONTH" },
               reportFilters: [{ column: "Task.Subject", operator: "contains", value: "電話" }] } };
  if (pathname === "/api/process-sheet/run") return { ok: true, dryRun: true, rows: 864,
    people: ["植野","田中","森田","江田","飯島","迫間","加藤","萩原"],
    matched: ["植野 ひかり","田中 欽也","森田 弥鳴","江田 有一郎"], count: 12, skipped: [],
    apoSource: "kinbotのアポ記録から 12件",
    apoDetail: [
      { slug:"a1", setter:"田中欽也", day:"8/4", meetingDate:"2026-08-18", term:"期内", label:"【初回】株式会社ベルク/町田様" },
      { slug:"a2", setter:"田中欽也", day:"8/13", meetingDate:null, term:"商談日が未定", label:"【初回】テスト株式会社" },
      { slug:"a3", setter:"田中欽也", day:"8/13", meetingDate:"2026-08-18", term:"期内", label:"【初回】アールプランナーグループ/水谷様" },
      { slug:"a4", setter:"田中欽也", day:"8/9", meetingDate:"2026-08-09", term:"期内", label:"【初回】テストホールディングス/テスト様" },
      { slug:"a5", setter:"森田弥鳴", day:"8/5", meetingDate:"2026-08-25", term:"期内", label:"【初回】石井商事運輸/石井様" },
    ],
    updates: [
      { range:"K32", who:"植野", date:"8/4", metric:"コール", value:58 },
      { range:"K33", who:"植野", date:"8/4", metric:"接触", value:5 },
      { range:"K34", who:"植野", date:"8/4", metric:"アポ（期内）", value:1 },
      { range:"K35", who:"植野", date:"8/4", metric:"アポ（期外）", value:0 },
      { range:"K44", who:"田中", date:"8/4", metric:"コール", value:64 },
      { range:"K45", who:"田中", date:"8/4", metric:"接触", value:15 },
      { range:"K46", who:"田中", date:"8/4", metric:"アポ（期内）", value:2 },
      { range:"K47", who:"田中", date:"8/4", metric:"アポ（期外）", value:0 },
    ] };
  if (pathname === "/api/sf-autolaunch/pending") return { items: [
    { slug:"a1", title:"【初回】アールプランナーグループ/水谷様", company:"アールプランナーグループ", ok:false,
      reasonText:"Salesforceの重複ルールで止められました（同じ会社・担当者が既にあります）",
      start:"2026-08-18T02:00:00Z", owner:"中澤良太", business:"DOC", triedAt:"2026-08-13T02:25:00Z" },
    { slug:"a2", title:"【初回】テスト株式会社　テスト", company:"テスト株式会社", ok:false,
      reasonText:"商談の予定名から担当者名が読み取れません",
      start:"2026-08-15T02:00:00Z", owner:"田中欽也", business:"DOC", triedAt:"2026-08-13T00:10:00Z" },
    { slug:"a3", title:"【初回】株式会社ベルク　町田様", company:"株式会社ベルク", ok:false,
      reasonText:"クロスのリードがありません（直販などのリードのみ）",
      start:"2026-08-20T05:00:00Z", owner:"植野ひかり", business:"DOC", triedAt:"2026-08-12T09:00:00Z" },
  ] };
  if (pathname === "/api/sf-autolaunch/retry") return { ok: false, reasonText: "やはり同じ理由で止まりました" };
  if (pathname === "/api/sf-autolaunch/config") return { enabled: false };
  if (/^\/api\/apo\/[^/]+\/why$/.test(pathname)) return { ok: false, steps: [
    { name: "アポの登録", ok: true, detail: "【初回】株式会社テスト/テスト様／獲得 田中欽也" },
    { name: "担当", ok: true, detail: "kinya.tanaka@neo-career.co.jp" },
    { name: "処理済みの印", ok: true, detail: "付いています（2026/8/13 20:15:00）。これが付いていると、自動処理の対象になりません。" },
    { name: "集計から除外", ok: true, detail: "対象です" },
    { name: "自動スキャン", ok: true, detail: "ONです" },
    { name: "自動割り振り", ok: true, detail: "ONです" },
    { name: "通知先", ok: false, detail: "3件のうち、アポ割り振りがONなのは 0件" },
    { name: "アポ割り振りの通知", ok: true, detail: "ONです" },
  ] };
  if (/^\/api\/apo\/[^/]+\/redo$/.test(pathname)) return { ok: true };
  if (pathname === "/api/apo/why") {
    return { ok: false, product: query.get("product") || "", steps: [
      { name: "15分おきの自動スキャン", ok: true, detail: "60秒ごと", hint: "" },
      { name: "スキャンしたアポを自動で割り振る", ok: false, detail: "OFF",
        hint: "これがOFFだと、アポの記録だけして担当を決めません。" },
      { name: "カレンダーを読むアカウント", ok: true, detail: "kinya.tanaka@neo-career.co.jp", hint: "" },
      { name: "DOCのクローザー", ok: true, detail: "登録6名 / 稼働5名 / 通常3名・予備2名", hint: "" },
      { name: "担当未定のアポ", ok: true, detail: "2件（読み取れたアポ 5件）", hint: "" },
    ], appointments: [
      { title: "【初回】株式会社コロンバン　宮村様", ok: false,
        why: "一度自動で試して決まらなかったため、もう対象になりません",
        hint: "「自動で決める」を押すか、担当を手で選んでください。" },
      { title: "【初回】テスト株式会社/田中様", ok: true, why: "植野 大輔 に決まります（ローテーション順）", hint: "" },
    ] };
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
  if (pathname.indexOf("/api/smart-links/") === 0 && pathname.endsWith("/mail")) return { ok: true, draft: true, to: "x@y.jp" };
  if (pathname.startsWith("/api/smart-links/")) return { ok: true, link: {}, mail: { ok: true } };
  // SHOBO の架電（mccall.js）の見た目を確かめるためのダミー（2026-11-16）。/mochica.html#call で開く
  if (pathname.startsWith("/api/mccall/")) return mccallMock(pathname, query);
  // ダッシュボードは本物の SF・Zoom Phone・シフト表を読むので、プレビューでは「読めなかった」画面を確かめる（2026-11-17）
  if (pathname === "/api/mcdash/data") return { error: "プレビューでは SF などを読みません（本番で確かめてください）" };
  if (pathname === "/api/mochica/reps") return { ok: true, items: REPS.map((r) => ({ email: r.email, name: r.name, mochica: r.businesses.includes("MOCHICA") })) };
  // リストの会社まとめ（2026-11-20）の見た目を確かめるダミー
  if (pathname.startsWith("/api/mochica/bales/lists/") && pathname.endsWith("/rows")) return { ok: true, total: 1, rows: [{ __k: "r1", companyName: "社会福祉法人新生寿会 きのこ保育園", companyTel1: "03-5739-0585", targetName: "志水", lastLeadStageName: "担当者接触", __hot: { n: 2, name: { st: "あり", why: "志水" }, need: { st: "あり", why: "採用が足りない" }, when: { st: "", why: "" } } }] };
  if (pathname.startsWith("/api/mochica/bales/lists/") && pathname.endsWith("/company")) return { ok: true, sfError: "", calls: [{ created_at: "2026-11-18T05:10:00Z", caller: "大沢 瑛太", person: "志水", reach: "担当者", outcome: "再架電", reason: "", memo: "来月の採用計画を見てから", next_at: "2026-12-02T01:00:00Z" }],
    lead: { id: "00Q000000000001", name: "志水 亮介", title: "施設長", company: "社会福祉法人新生寿会", phone: "03-5739-0585", email: "x@example.jp", status: "ナーチャリング", owner: "中村 圭佑", source: "失注リサイクル", created: "2025-04-01", hear: { "利用中ATS": "i-web", "顧客の課題感": "保育士の応募が少ない", "検討開始時期": "2027-01", "失注商談失注日": "2025-06-10", "失注商談失注理由大": "予算", "失注商談失注理由中": "費用感が合わない", "失注商談所有者": "村上 毅" } },
    others: [{ id: "00Q2", name: "田中 花子", title: "人事課長", phone: "03-5739-0586", email: "", status: "アーカイブ" }],
    account: { id: "001A", name: "社会福祉法人新生寿会", biz: "Mochica", status: "商談進行中", owner: "村上 毅", phone: "03-5739-0585", web: "http://www.kinoko-group.jp/", industry: "介護・保育・医療法人等", emp: 674, addr: "東京都 港区南麻布4-6-1", recruit: "https://job.mynavi.jp/22/pc/search/corp87159/outline.html" },
    group: [{ id: "001A", name: "社会福祉法人新生寿会", biz: "Mochica", status: "商談進行中", owner: "村上 毅" }, { id: "001B", name: "社会福祉法人新生寿会", biz: "BPO", status: "", owner: "BPO 管理者" }],
    contacts: [{ id: "003A", name: "志水 亮介", title: "", dept: "法人本部 人事部", phone: "03-5739-0585", email: "yamate@example.jp", biz: "Mochica" }, { id: "003B", name: "山田 次郎", title: "部長", dept: "経営企画部", phone: "", email: "yamada@example.jp", biz: "BPO" }],
    opps: [{ id: "006A", name: "新生寿会_MOCHICA_2026", type: "Mochica", stage: "03.提案", date: "2026-11-10", owner: "村上 毅", apo: "大沢 瑛太", lost: "", detail: "" }, { id: "006B", name: "新生寿会_MOCHICA_2025", type: "Mochica", stage: "失注", date: "2025-05-20", owner: "村上 毅", apo: "", lost: "予算", detail: "費用感が合わない" }] };
  if (pathname.startsWith("/api/mochica/bales/lists/") && pathname.includes("/rows/")) return { ok: true, data: { companyName: "社会福祉法人新生寿会 きのこ保育園" }, raw: { companyName: "社会福祉法人新生寿会 きのこ保育園", companyTel1: "03-5739-0585", targetName: "志水", position: "", department: "", callTargetId: 1, lastLeadStageName: "担当者接触", lastLeadStageStayDays: 4, callResultsCount: 3, lastCalledAt: "2026-11-18T14:10:00+09:00", callResult: "再コール", lastCalledComment: "来月の採用計画を見てから", operatorName: "大沢 瑛太", createdAt: "2026-10-15T09:19:51+09:00", freeTags: [{ text: "【0831従業員数】500～1000人未満" }], leadSources: [{ name: "HRog" }], nextActions: [{ name: "コール", isDone: false, reservedAt: "2026-12-02T10:00:00+09:00", owner: { name: "大沢 瑛太" } }] }, detail: null };
  if (pathname === "/api/mochica/bales/lists") return { ok: true, items: [{ list_key: "bales:all", name: "すべてのリード", count: 23394, status: "done", view: [{ key: "companyName", label: "会社名" }, { key: "companyTel1", label: "電話番号" }, { key: "targetName", label: "担当者名" }, { key: "lastLeadStageName", label: "リードステージ" }] }] };
  return {};
}

// リード管理（/api/mccall/sources）のダミー：種類×リスト×担当の行から、サーバーと同じ形に組み立てる
function mcSourcesMock() {
  const E = "eda@neo-career.co.jp", M = "morita@neo-career.co.jp", T = "tanaka@neo-career.co.jp";
  const lists = [{ id: 1, name: "11月 ホット企業", stock: false, members: [] }, { id: 2, name: "DOC 失注から MOCHICA 提案", stock: false, members: [E] },
    { id: 7, name: "BALES：すべてのリード", stock: true, members: [] }, { id: 8, name: "BALES：展示会 2026", stock: true, members: [] }];
  // [取り込み元, リードソース, リスト, 担当, 件数, 未架電]
  const R = [["BALES", "BPOアウトバウンド", 1, E, 120, 40], ["BALES", "BPOアウトバウンド", 1, M, 95, 31], ["BALES", "BPOアウトバウンド", 1, "", 210, 150], ["BALES", "BPOアウトバウンド", 7, "", 8200, 6100],
    ["BALES", "展示会", 1, E, 30, 12], ["BALES", "展示会", 8, "", 1460, 1300], ["BALES", "新卒リスト", 1, "", 64, 64], ["BALES", "新卒リスト", 7, "", 5300, 5000],
    ["SF", "失注リサイクル", 1, M, 80, 10], ["SF", "失注リサイクル", 1, "", 140, 90], ["SF", "Web問い合わせ", 1, T, 12, 2], ["SF", "SF（ソースなし）", 1, "", 33, 33],
    ["SHOBO（CSV）", "CSV 取り込み", 1, "", 48, 48], ["DOC", "DOC過去失注", 2, E, 40, 40], ["BALES", "Bales（ソースなし）", 7, "", 2100, 2000]];
  const blank = () => ({ n: 0, stock: 0, untouched: 0, free: 0, dist: 0, now: 0, hot: [0, 0, 0], by: {} });
  const add = (o, r, st) => { const [, , , who, n, u] = r; if (st) { o.stock += n; return; } o.n += n; o.untouched += u; o.now += Math.round(n * 0.8);
    o.hot[0] += Math.round(n * 0.1); o.hot[1] += Math.round(n * 0.3); o.hot[2] += n - Math.round(n * 0.1) - Math.round(n * 0.3); if (!who) { o.free += n; o.dist += n; } o.by[who] = (o.by[who] || 0) + n; };
  const all = { key: "all", ...blank() }, og = new Map(), ty = new Map(), tl = [], mem = new Map();
  for (const r of R) {
    const [o, s, lid, who, n, u] = r; const l = lists.find((x) => x.id === lid); const k = `${o}|${s}`;
    if (!ty.has(k)) ty.set(k, { key: k, origin: o, source: s, ...blank() }); if (!og.has(o)) og.set(o, { key: o, ...blank() });
    add(ty.get(k), r, l.stock); add(og.get(o), r, l.stock); add(all, r, l.stock);
    tl.push({ type: k, id: lid, name: l.name, stock: l.stock, n, untouched: u, dist: who ? 0 : n, by: { [who]: n } });
    if (who && !l.stock) { const m = mem.get(who) || { email: who, n: 0, now: 0, untouched: 0, stock: 0, hidden: who === T ? 12 : 0, byType: {} }; m.n += n; m.now += Math.round(n * 0.8); m.untouched += u; m.byType[k] = (m.byType[k] || 0) + n; mem.set(who, m); }
  }
  const rt = (c, a, mm) => ({ calls: c, apos: a, m: { "2026-09": { calls: Math.round(c * 0.3), apos: Math.round(a * 0.2) }, "2026-10": { calls: Math.round(c * 0.4), apos: Math.round(a * 0.4) }, "2026-11": { calls: Math.round(c * 0.3), apos: Math.round(a * 0.4) } }, mem: mm || {} });
  const memR = { [E]: { calls: 220, apos: 4 }, [M]: { calls: 180, apos: 1 }, [T]: { calls: 30, apos: 0 } };
  return { ok: true, pending: 0, all, names: { [E]: "江田 直人", [M]: "森田 彩", [T]: "田中 遼" },
    origins: ["SF", "BALES", "SHOBO（CSV）", "DOC"].map((k) => og.get(k)), types: [...ty.values()].sort((a, b) => b.n + b.stock - a.n - a.stock), typeLists: tl, members: [...mem.values()], lists,
    rates: { months: ["2026-09", "2026-10", "2026-11"], all: rt(430, 5, memR), byOrigin: { BALES: rt(300, 4, memR), SF: rt(110, 1, memR), DOC: rt(20, 0) },
      byType: { "BALES|BPOアウトバウンド": rt(260, 4, memR), "SF|失注リサイクル": rt(100, 1, { [M]: { calls: 100, apos: 1 } }), "BALES|展示会": rt(40, 0, { [E]: { calls: 40, apos: 0 } }) },
      byList: { "BALES|BPOアウトバウンド#1": { calls: 260, apos: 4 } } } };
}

const MC_REACH = {
  none: { label: "つながらない", outcomes: { no_answer: "応答なし", busy: "話し中", voicemail: "留守電", invalid: "現アナ（番号が使えない）" } },
  gate: { label: "受付まで", outcomes: { absent: "担当者が不在", blocked: "受付で断られた", callback_req: "掛け直しを指定された" } },
  person: { label: "担当者と話せた", outcomes: { apo: "アポ獲得", doc_send: "資料を送る", follow: "また話す（フォロー）", reject: "断られた" } },
};
const MC_LEADS = [
  { id: 1, company: "株式会社ベルク", person: "町田", hot: 3, attempts: 2, phone: "03-1234-5678", cross_from: null, next_at: "2026-11-16T05:00:00Z", next_why: "受付で聞いた「午後」に掛け直し",
    gate: { name: "町田", hours: "午後", direct: "" } },
  { id: 2, company: "合同会社サンライズ", person: "人事部 ご担当者", hot: 1, attempts: 0, phone: "06-9876-5432", cross_from: "DOC", cross_id: 1, gate: null },
  { id: 3, company: "株式会社コロンバン", person: "宮村", hot: 2, attempts: 1, phone: "045-111-2222", cross_from: null, gate: null },
];
function mccallMock(p, query) {
  if (p === "/api/mccall/meta") return { ok: true, reach: MC_REACH, rejectReasons: ["今は必要ない", "他社を使っている", "時期が合わない", "予算が無い", "採用の予定が無い", "その他"], admin: !process.env.MCC_PREVIEW_INTERN, me: "kinya.tanaka@neo-career.co.jp" };
  if (p === "/api/mccall/inbound") return { ok: true, item: null };
  // リードの状況（基本の7つ）。1件目のリードは古い名前「NEW」のままのものとして出す
  if (/^\/api\/mccall\/leads\/\d+\/sf-status$/.test(p)) {
    const opts = [["01：新規", "リストに入ったまま、まだ一度もかけていない"], ["02：担当者未接触", "かけたが、採用の担当者とは話せていない（受付で止まった・不在・つながらない）"], ["03：コネクト情報獲得", "担当者と話せて、採用の状況など次につながる情報を聞けた（アポ・見送りはまだ決まっていない）"], ["04：ジャッジ", "担当者が今回は見送りと判断した"], ["05：コンバート", "アポが取れて商談になった"], ["89：リサイクル", "時期を空けてまたかける"], ["99：アーカイブ", "今後かけない"]].map(([v, d]) => ({ value: v, label: v, desc: d }));
    return /\/leads\/1\//.test(p) ? { ok: true, options: opts, current: "NEW", legacy: { label: "01：新規", desc: opts[0].desc } } : { ok: true, options: opts, current: "02：担当者未接触" };
  }
  // アポの日程の候補（おすすめ／他の日程）のダミー（2026-11-23）
  if (p === "/api/mccall/slots" || p === "/api/mccall/slots/day") {
    const day = p.endsWith("/day"), names = ["餌取", "斎藤", "森"], out = [];
    const base = new Date(); base.setHours(0, 0, 0, 0);
    const mk = (d, h, m, n, week) => { const t = new Date(base.getTime() + d * 864e5 + (h * 60 + m) * 6e4); const free = names.slice(0, n);
      return { at: t.toISOString(), md: `${t.getMonth() + 1}/${t.getDate()}`, dow: "日月火水木金土"[t.getDay()], time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, band: h < 12 ? "午前" : "午後", free, freeN: n, total: 3, week }; };
    if (day) { for (let h = 9; h < 18; h++) for (const m of [0, 30]) if ((h + m) % 3) out.push(mk(3, h, m, 1 + ((h + m) % 3), 1)); return { ok: true, slots: out, members: names, unread: [] }; }
    [[1, 10, 3], [1, 14, 2], [2, 11, 2], [3, 15, 3], [8, 10, 3], [8, 13, 2], [9, 16, 1], [10, 10, 2]].forEach(([d, h, n]) => out.push(mk(d, h, 0, n, d <= 7 ? 1 : 2)));
    return { ok: true, slots: out, members: names, unread: ["重永"] };
  }
  if (p === "/api/mccall/measures") return { ok: true, research: { today: 312, daily: 1200, gate: true }, items: [
    { id: 1, name: "11月 ホット企業", total: 120, touched: 86, researched: 118, talks: [
      { talkId: 11, label: "A", ver: 2, active: true, calls: 84, reached: 50, person: 22, apo: 5, reject: 9, leads: 60, adherence: 78, adhN: 18 },
      { talkId: 12, label: "B", ver: 1, active: true, calls: 79, reached: 47, person: 20, apo: 2, reject: 11, leads: 55, adherence: 64, adhN: 15 },
      { talkId: 10, label: "A", ver: 1, active: false, calls: 120, reached: 70, person: 30, apo: 3, reject: 15, leads: 90, adherence: null, adhN: 0 }] }] };
  if (p === "/api/mccall/lists") return { ok: true, admin: true, items: [{ id: 1, name: "11月 ホット企業", members: [], total: 120, open: 98, now: 3, cross: 0, talks: 2 }, { id: 2, name: "DOC 失注から MOCHICA 提案", members: ["eda@neo-career.co.jp"], total: 40, open: 40, now: 0, cross: 40 }] };
  if (p === "/api/mccall/stats") return { ok: true, me: { calls: 37, person: 9, apo: 2, cross: 1 }, all: [{ name: "田中欽也", calls: 37, person: 9, apo: 2, cross: 1 }, { name: "江田 直人", calls: 52, person: 11, apo: 1, cross: 0 }] };
  if (p === "/api/mccall/queue") return { ok: true, later: 4, items: MC_LEADS.map((l) => ({ id: l.id, company: l.company, person: l.person, hot: l.hot, attempts: l.attempts, next_at: l.next_at || null, next_why: l.next_why || null, cross_from: l.cross_from })) };
  if (p === "/api/mccall/cross") return { ok: true, moves: [{ at: "2026-11-15T01:00:00Z", by: "田中欽也", from_name: "DOC 9月 失注", to_name: "DOC 失注から MOCHICA 提案", count: 40, calls: 6, apo: 1, reason: "DOC で失注した企業に MOCHICA を提案するため" }],
    calls: [{ created_at: "2026-11-16T02:10:00Z", caller: "江田 直人", company: "合同会社サンライズ", outcome: "担当者が不在", from_name: "DOC 9月 失注" }] };
  if (p === "/api/mccall/doc/lists") return { ok: true, items: [{ id: 11, name: "DOC 9月 失注", open: 112 }, { id: 12, name: "doda 掲載中", open: 840 }] };
  // 一覧・レポート・スクリプトの見た目確認用（2026-11-18）
  if (p === "/api/mccall/browse") return { ok: true, total: MC_LEADS.length, page: 0, items: MC_LEADS.map((l) => ({ id: l.id, list: "11月 ホット企業", company: l.company, person: l.person, hot: l.hot, attempts: l.attempts, outcome: l.attempts ? "担当者が不在" : "", last_at: l.attempts ? "2026-11-14T06:30:00Z" : null, next_at: l.next_at || null, done: false, cross_from: l.cross_from, gate_name: l.gate && l.gate.name, assigned: l.id === 2 ? "江田 直人" : "", busy: l.id === 3 })) };
  // レポート・数字の見た目確認用（2026-11-23 作り替え）。かける人の見え方は MCC_PREVIEW_INTERN=1 で起動して確かめる
  if (p === "/api/mccall/report") { const by = ["user", "list", "day"].includes(query && query.get("by")) ? query.get("by") : "user";
    const r = (label, calls, reached, person, apo) => ({ key: label, label, calls, leads: Math.round(calls * 0.8), reached, person, apo, doc: Math.round(person * 0.1), follow: Math.round(person * 0.15), reject: Math.round(person * 0.3), cross: 0,
      fill: Math.round(person * 1.4), fillNew: Math.round(person * 0.9), fillFix: Math.round(person * 0.5), fillLeads: Math.round(person * 0.7), fillNoApo: Math.round(person * 1.1), invalid: Math.round(calls * 0.02) });
    const rows = by === "user" ? [r("大沢 瑛太", 212, 96, 41, 6), r("森 康晴", 184, 70, 30, 3), r("小賀坂 蓮", 156, 71, 22, 1), r("趙 美咲", 98, 40, 19, 2)]
      : by === "list" ? [r("11月 ホット企業", 320, 150, 62, 8), r("マイナビ掲載中 27卒", 240, 96, 38, 3), r("DOC 失注から MOCHICA 提案", 90, 31, 12, 1)]
      : [r("2026-11-17", 82, 35, 14, 2), r("2026-11-18", 96, 44, 19, 1), r("2026-11-19", 71, 28, 11, 0), r("2026-11-20", 104, 49, 22, 3), r("2026-11-23", 88, 40, 17, 2)];
    const sum = (xs) => xs.reduce((a, x) => { for (const k of Object.keys(x)) if (typeof x[k] === "number") a[k] = (a[k] || 0) + x[k]; return a; }, {});
    const total = sum(rows);
    return { ok: true, by, all: !process.env.MCC_PREVIEW_INTERN, days: 7, prev: { calls: Math.round(total.calls * 0.9), leads: Math.round(total.leads * 0.9), reached: Math.round(total.reached * 0.95), person: Math.round(total.person * 0.8), apo: Math.round(total.apo * 1.2), doc: 4, follow: 6, reject: 20, cross: 0 }, rows, total,
      gateReasons: [{ k: "営業電話はお断り", n: 31 }, { k: "担当者名が分からないとつなげない", n: 18 }, { k: "資料をメールで送って", n: 9 }],
      reasons: [{ k: "今は必要ない", n: 15 }, { k: "他社を使っている", n: 9 }, { k: "時期が合わない", n: 6 }, { k: "予算が無い", n: 2 }],
      fields: [{ k: "利用ATS", n: 44 }, { k: "採用人数", n: 31 }, { k: "課題感", n: 27 }, { k: "検討時期", n: 12 }, { k: "担当者名", n: 8 }] }; }
  if (p === "/api/mccall/insight") { const rates = [0.36, 0.31, 0.27, 0.18, 0.24, 0.29, 0.33, 0.38, 0.3, 0.22]; const base = 0.29;
    const hours = rates.map((rate, i) => ({ hour: 9 + i, calls: [140, 210, 190, 60, 150, 220, 200, 180, 120, 40][i], person: Math.round(rate * 100), rate, lift: rate / base, prior: i === 0 || i === 7 }));
    const me = { calls: 412, person: 96, apo: 9 }; const admin = !process.env.MCC_PREVIEW_INTERN;
    return { ok: true, slot: { hour: 14, tier: "normal", lift: hours[5].lift, rate: hours[5].rate }, hours, base, baseCalls: 1510, me,
      team: admin ? { calls: 2380, person: 590, apo: 61 } : null,
      people: admin ? [{ name: "大沢 瑛太", calls: 620, person: 170, apo: 33 }, { name: "森 康晴", calls: 540, person: 120, apo: 14 }, { name: "小賀坂 蓮", calls: 480, person: 110, apo: 8 }, { name: "趙 美咲", calls: 412, person: 96, apo: 5 }] : null,
      byAttempt: [[1, 620, 120, 9], [2, 410, 96, 8], [3, 260, 70, 7], [4, 150, 41, 4], [5, 90, 22, 3], [6, 60, 15, 3], [7, 30, 8, 1], [8, 12, 3, 1]].map(([n, calls, person, apo]) => ({ n, calls, person, apo })),
      parked: 37, streak3: 112, cadence: { max: 8, gapDays: [2, 2, 3, 3, 3, 5], parkDays: 30 }, bench: { avg: [0.02, 0.03], top: 0.05 } }; }
  const SCRIPT = "【受付】\n株式会社ネオキャリアの〇〇です。{会社名}の新卒採用のご担当者様はいらっしゃいますか。\n\n【担当者】\n{担当者}様、突然のお電話失礼いたします。27卒の採用で、説明会の参加人数についてお伺いしたく…";
  if (/^\/api\/mccall\/lists\/\d+\/talks$/.test(p)) return { ok: true, labels: ["A", "B", "C"], talks: [{ id: 11, label: "A", ver: 2, body: SCRIPT }, { id: 12, label: "B", ver: 1, body: "（B）{担当者}様、27卒の説明会の歩留まりについて…" }],
    history: [{ label: "A", ver: 2, active: true, calls: 84 }, { label: "A", ver: 1, active: false, calls: 120 }, { label: "B", ver: 1, active: true, calls: 79 }] };
  if (/^\/api\/mccall\/lists\/\d+\/script$/.test(p)) return { ok: true, name: "11月 ホット企業", script: SCRIPT };
  // 条件で割り振るの見た目確認用（2026-11-19）
  if (/^\/api\/mccall\/lists\/\d+\/leads$/.test(p)) return { ok: true, total: 98, items: MC_LEADS.map((l) => ({ id: l.id, company: l.company, person: l.person, hot: l.hot, attempts: l.attempts, outcome: "", assigned: "" })) };
  if (/^\/api\/mccall\/lists\/\d+\/segments$/.test(p)) { const it = (a) => a.map(([v, n]) => ({ v, n, free: Math.round(n * 0.7) }));
    return { ok: true, matched: 98, free: 70, prefByTel: 41, conds: [{ k: "name", label: "担当者名が分かる", n: 61 }, { k: "need", label: "ニーズを聞けた", n: 12 }, { k: "when", label: "検討時期を聞けた", n: 7 }],
      dims: { source: { label: "リードソース", items: it([["BPOアウトバウンド", 52], ["展示会", 21], ["CSV 取り込み", 15], ["新卒リスト", 10]]) },
        pref: { label: "都道府県", items: it([["東京都", 34], ["大阪府", 18], ["神奈川県", 11], ["愛知県", 9], ["不明", 26]]) },
        gyokai: { label: "業界", items: it([["医療，福祉", 30], ["情報通信業", 14], ["製造業", 12], ["不明", 42]]) },
        gyoshu: { label: "業種", items: it([["介護", 18], ["保育", 9], ["ソフトウェア開発", 8], ["不明", 63]]) },
        last: { label: "最終架電", items: it([["未架電", 40], ["91日以上前", 12], ["31〜90日前", 20], ["8〜30日前", 16], ["7日以内", 10]]) },
        lastResult: { label: "前回の結果", items: it([["未架電", 40], ["担当者不在", 30], ["担当者接触：お断り", 18], ["応答なし", 10]]) },
        hot: { label: "ホット度", items: it([["ホット", 8], ["ウォーム", 30], ["コールド", 60]]) },
        lost: { label: "過去失注（SF の失注理由）", items: it([["失注なし", 80], ["他社決定", 10], ["時期", 8]]) } } }; }
  // リード管理の見た目確認用（2026-11-20）
  if (p === "/api/mccall/sources") return mcSourcesMock();
  if (p === "/api/mccall/sources/distribute") return { ok: true, dryRun: true, available: 812, total: 200, unassigned: 0, toList: "",
    plan: [{ email: "eda@neo-career.co.jp", name: "江田 直人", n: 100, want: 100, rate: 1.8, calls: 220, apos: 4 }, { email: "morita@neo-career.co.jp", name: "森田 彩", n: 70, want: 100, rate: null, calls: 0, apos: 0 }] };
  if (/^\/api\/mccall\/lists\/\d+\/assign$/.test(p)) return { ok: true, dryRun: true, matched: 98, assigned: 40, per: [{ name: "江田 直人", n: 20 }, { name: "森田 彩", n: 20 }] };
  // SF に入る項目の下書き（2026-11-20）。新規・更新・追記・同じ の見え方を確かめる
  if (/^\/api\/mccall\/leads\/\d+\/sf-fill\/preview$/.test(p)) return { ok: true, note: "", plan: [
    { api: "LastName", label: "担当者（姓）", value: "町田", kind: "new", on: true, why: "受付：担当者の名前" },
    { api: "Start_Considering_Date__c", label: "検討開始時期", value: "4月", cur: "6月", kind: "update", on: true, why: "ヒアリング：検討時期" },
    { api: "Client_Issue__c", label: "顧客の課題感", value: "母集団が足りない", kind: "add", on: true, why: "ヒアリング：採用ニーズ" },
    { api: "ATS__c", label: "利用中ATS", value: "HRMOS", cur: "無し", kind: "update", on: false, why: "HRMOS" },
    { api: "update_month2__c", label: "現利用サービス更新予定月", value: "3月", kind: "new", on: true, why: "3月更新" },
    { api: "Number_of_hires__c", label: "採用人数", value: "6～10名", kind: "same", on: false, why: "ヒアリング：採用目標 8名" } ] };
  let m = p.match(/^\/api\/mccall\/leads\/(\d+)$/);
  if (m) {
    const l = MC_LEADS.find((x) => x.id === +m[1]) || MC_LEADS[0];
    // 施策（トーク A/B）・企業調査・自動音声の見た目確認用（2026-11-20）
    return { ok: true, script: SCRIPT, talk: { id: 11, label: l.id % 2 ? "A" : "B", ver: 2, body: SCRIPT, n: 2 }, lead: { ...l, list_id: 1,
      research: l.id === MC_LEADS[1].id ? null : { status: "ok", at: "2026-11-20T01:00:00Z", biz: "東京・埼玉で特別養護老人ホームと訪問介護を12拠点運営", employees: "約420名", location: "東京都練馬区", founded: "1998年",
        hiring: "新卒（介護職）と中途を通年で募集。27卒の説明会を開催中", roles: "介護職・生活相談員・看護職", headcount: "新卒10〜15名/年", media: "マイナビ・自社採用サイト",
        issue: "拠点が増え、説明会から面接への歩留まりが下がっている可能性", hook: "27卒の介護職の説明会、参加から面接までの日程調整はどうされていますか", confirm: "応募の管理方法（Excel か ATS か）", sources: ["https://example.jp/company"] },
      ivr: { [l.phone.replace(/\D/g, "")]: { items: [{ press: "1", for: "施設のご利用" }, { press: "2", for: "採用・人事" }, { press: "3", for: "その他" }], at: "2026-11-19T03:00:00Z" } }, info: l.id === 1 ? { email: "machida@example.jp", phones: [], contacts: [{ name: "佐藤", role: "人事課長", phone: "", email: "" }] } : null, src: l.cross_from ? "doc" : "bales", data: l.cross_from ? { list_name: "DOC 9月 失注", assigned_to: "植野 大輔", industry: "小売" } : { lastActivityAt: "2026-11-14T06:30:00Z", lastActivityTypeText: "コール", operatorName: "大沢" } },
      // マイナビ・ヒアリングの見た目確認用（2026-11-18）。1件目は掲載あり、2件目は見つからない、ほかは調べ中
      mynavi: l.id === MC_LEADS[0].id ? { status: "listed", url: "https://job.mynavi.jp/27/pc/search/corp000000/outline.html", years: ["2027", "2026"], jobs: ["介護職", "生活相談員"], plannedHires: "11～15名", area: "東京都・埼玉県", preEntry: "1,240名", industry: "福祉・介護", note: "3月から会社説明会を毎週開催", checkedAt: "2026-11-18T01:00:00Z" }
        : l.id === MC_LEADS[1].id ? { status: "notfound", checkedAt: "2026-11-18T01:00:00Z" } : { status: "checking" },
      glance: { need: { kb: [["採用ニーズ", "母集団が足りない"], ["採用目標人数", "12名"], ["説明会・面接の参加人数", "30名"]], by: { at: "2026-11-14T06:30:00Z", who: "福井聖" }, sf: [], hit: null }, when: { kb: [["検討時期", "3月"]], by: { at: "2026-11-14T06:30:00Z", who: "福井聖" }, sf: [], hit: null } },
      ban: null, docAlso: l.id === 3 ? [{ list: "doda 掲載中", assigned_to: "田中 遼" }] : [],
      phones: [{ label: "代表", number: l.phone, digits: l.phone.replace(/\D/g, ""), n: 4, reached: 1, invalid: false, last: "担当者が不在", lastAt: "11/14 15:30" },
        { label: "電話2", number: "03-5555-0000", digits: "0355550000", n: 2, reached: 0, invalid: true, last: "番号が使えない", lastAt: "11/10 11:00" }],
      summary: l.attempts ? "11/14 福井聖 担当者が不在 → 担当は町田さん・午後なら在席 → 11/16 14:00 に再架電" : "",
      sf: { lead: { status: "失注", owner: "中澤 良太", 失注理由大: "時期", 検討開始時期: "2027年4月" }, sum: { n: 2, won: false, lost: true } },
      cross: l.cross_from ? { from_name: "DOC 9月 失注", reason: "DOC で失注した企業に MOCHICA を提案するため", at: "2026-11-15T01:00:00Z" } : null,
      timeline: [
        { at: "2026-11-14T06:30:00Z", src: "kinbot", who: "福井聖", title: "担当者が不在", text: "受付で聞けたこと：担当 町田・在席 午後\n次回 11/16 14:00", mine: true, logId: 9 },
        { at: "2026-11-10T02:00:00Z", src: "Bales", who: "大沢", title: "コール", text: "受付で、採用は人事部の町田さんが担当とのこと。今期は中途採用を増やす予定。資料が欲しいと言われたので後日送付。" },
        { at: "2026-09-02", src: "SF", who: "中澤 良太", title: "商談：失注", text: "【新/ヒ】株式会社ベルク" },
      ] };
  }
  if (/\/log$/.test(p)) return { ok: true, logId: 99, nextAt: new Date(Date.now() + 2 * 3600e3).toISOString(), why: "同じ日のうちに", done: false };
  if (/\/undo$/.test(p)) return { ok: true, leadId: 1, sf: "SF の活動も消しました" };
  if (/\/gate$/.test(p)) return { ok: true, gate: { name: "町田", hours: "午後", direct: "" } };
  return { ok: true };
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

  // /d/xxx は本番と同じく資料のビューアーを返す
  const rel = /^\/d\/[a-z0-9]+$/i.test(pathname)
    ? "/doc.html"
    : (pathname === "/" ? "/apo.html" : pathname);
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
