// SHOBO の架電（テレアポ）（2026-11-16 新しく作成。kincall の複製ではない）
//
// なぜ別に作ったか：
//   DOC の kincall の表（call_lists / call_targets / call_logs）は、SF 監査・コール進捗の通知・デイリー目標・
//   プロセスシートとつながっている。MOCHICA の架電を同じ表に入れると DOC の数字や SF の自動処理に混ざるので、
//   MOCHICA は mc_ で始まる自分の表だけに書く。DOC の表は「管理者がリードを持ってくるとき」に読むだけ。
//
// 部署をまたぐとき（田中さん 2026-11-16「管理者なら DOC からリストを持ってこられるように」）：
//   管理者だけが DOC のリストから MOCHICA の架電リストへリードを写せる。写したことは mc_cross_moves に
//   だれが・いつ・どこから・何件・なぜ を残し、写したリードには cross_from='DOC' の印を付ける。
//   DOC 側のリストは変えない（読むだけ）。
//
// 画面の考え方（ASUMO のレビューと kincall の評価から）：
//   結果は「どこまで届いたか → 中身」の2段。不在でも受付で聞けたこと（担当者名・在席時間・直通）を残す。
//   担当者に届かなかった不在は、1〜2営業日あけて前回と違う時間帯に自動で掛け直しに回し、8回続いたら一度休ませる（mccadence.js。解除できる）。記録の取り消しは「元に戻す」で行う。
import { dbPool, listUsers, approachBanHit, approachBanHitSync, approachBanHitLead, approachBanHitLeadSync, loadApproachBans, listMembers, getSettings, saveSettings, mcBalesToday, mcBalesValues, BALES_MCU } from "./db.js";
import { freeBusy, gmailSend, isConnected as googleConnected, createCalendarEvent, deleteCalendarEvent } from "./google.js";
import { notifyPerson } from "./chat.js";
import { teamOf, teamLabel, splitFree, slotScore, pickFs } from "./mcteam.js";   // IS と FS のチーム（2026-11-23）
import { fixMojibake } from "./docs.js";
import { pastApproach, balesItems, dedupeTimeline, startZoomSync, spokenText, spokenData } from "./mchist.js";   // リードの過去アプローチを BALES・SF・Zoom Phone・DOC から集める（2026-11-20）
import { createTask, deleteTask, sfQuery, sfQueryAll, sfUpdateRecord, sfUpdateMany, connectionInfo as sfConnInfo, describeObject, sfCreateRecord, sfUserIdByEmail } from "./salesforce.js";
import { judgeHot } from "./mchot.js";
import { lookupMynaviFree } from "./mcresearch.js";   // マイナビの調べも AI・有料の検索を使わない（2026-11-20 福井さん）
import { showableResearch, CHECK_V, STALE_DAYS } from "./mcfresh.js";   // 企業調査は今の募集と確かめた採用情報だけを画面に出す（2026-11-23）   // マイナビの調べも AI・有料の検索を使わない（2026-11-20 福井さん）
import { fetchPageText } from "./companyenrich.js";
import { pickLeadStages, stageOf, stageCode, normCode, autoStage, LEAD_STAGES } from "./mcstage.js";   // リードの状況は基本の7つだけ出す（2026-11-24）
import { segOf, SEG_V, SF_LEAD_FIELDS, sfLeadRow, balesCarry, sfLeadWhere } from "./mcseg.js";
import { ensurePlay, talkForLead, activeTalks, saveTalks, listsWithTalk, measures, researchGate, researchSoon, researchState, inboundFor, inboundAllows, startPlayPumps, TALK_LABELS } from "./mcplay.js";
import { CADENCE, BENCH, WHY_HUMAN, jstDayStart, jstAt, nextMissAt, hourRates, slotNow, rankQueue } from "./mccadence.js";
import { FILL_APIS, FILL_SOQL_FIELDS, readMemo, readInputs, planFills, pickedFields, hiresBucket } from "./mcsffill.js";
import { formRun } from "./mcform.js";   // 問い合わせフォームの自動送信（2026-11-20）
import { MCDASH_ROSTER } from "./mcdash.js";   // インサイド8名の名簿（「かける」の状態を管理者に見せるため）
import { rosterHit, startsWithSurname, rosterForms, foldPersonName } from "./mcname.js";   // 名前の照合（異体字・姓名の順などをそろえる）
import { loadPeople, emailOf as rosterEmailOf, setPerson, rosterRows, PEOPLE_KINDS } from "./mcpeople.js";   // 名簿の人をメールで結びつける（2026-11-23）
import { leadMails, sfLeadIdOf } from "./mcmail.js";   // 1社のメールを1か所で集める（SF・BALES・DOC のメールが画面に出なかったため。2026-11-24）
import { HEAR_ITEMS, cleanHearing, mergeHearing, hearingLines as hearLines, apoCheck, valueText, mailDefaults, MAIL_ITEMS, HEAR_MAIL_SUBJECT, hearMailBody, realName } from "./mchearing.js";   // アポの必須ヒアリングとヒアリングのメール（2026-11-23）   // 問い合わせフォームの自動送信（2026-11-20）
export { hiresBucket };

const BIZ = "MOCHICA";
// 商材。いまは MOCHICA とキャリアミキサー（キャリミキ）の2つ。知らない値は MOCHICA にする
const PRODUCTS = ["mochica", "careermixer"];
const productOf = (v) => (PRODUCTS.includes(String(v || "")) ? String(v) : "mochica");

// 到達の段階と、その中身。key は画面とサーバーで同じものを使う
export const REACH = {
// 結果の名前は SF の「活動の結果」・kincall・Bales と同じ言葉にそろえる（2026-11-23 福井さん「選択肢はこの10個に」）。
//   key（記録に残る値）は今までのものをそのまま使う（集計・掛け直しの決まり・過去の記録を変えないため）。
//   話し中・留守電・掛け直しを指定された は画面のボタンから外したが、過去の記録の名前を出すために残す。営業時間外（closed）は新しく足した
  none: { label: "つながらない", outcomes: { no_answer: "コールのみ", busy: "話し中", voicemail: "留守電", invalid: "現在使われておりません", closed: "営業時間外" } },
  // inquiry＝「HP の問い合わせフォームから送って」と言われた（受付でも担当者でも言われるので両方に置く。key と名前は同じにする）（2026-11-20 福井さん）
  gate: { label: "受付まで", outcomes: { absent: "担当者不在", blocked: "受付ブロック", callback_req: "掛け直しを指定された", inquiry: "問い合わせ" } },
  person: { label: "担当者と話せた", outcomes: { apo: "担当者接触：アポ獲得", doc_send: "資料送付", follow: "担当者接触：営業フォロー", reject: "担当者接触：お断り", inquiry: "問い合わせ" } },
};
const FORM_ST = { sent: "送信しました", unsure: "送信を押しましたが、届いたか分かりません", failed: "送れませんでした" };
export const REJECT_REASONS = ["今は必要ない", "他社を使っている", "時期が合わない", "予算が無い", "採用の予定が無い", "その他"];
// 受付で断られたときの断り文句（2026-11-23 福井さん「受付の断り文句をワンタップで選べるように」）。
//   候補は担当者の断り理由（上）・SF の「お断り理由」・DOC の kincall の受付NG の言い方から、受付で多いものを多い順に。
//   選んだ文句は mc_call_logs.reason に残し、レポートで担当者の断り理由と同じように数える。その他はメモに書く
export const GATE_REASONS = ["営業電話はお断り", "担当者名が分からないとつなげない", "資料をメールで送って", "本社・別部署で採用している", "今は採用していない", "必要ない・間に合っている", "その他"];
// 自動で掛け直す結果（つながらなかった・担当者がいなかった）。届かなかった回数 miss_streak もこの結果だけを数える
const AUTO_RETRY = new Set(["no_answer", "busy", "voicemail", "absent", "closed"]);
// これ以上かけない結果
const FINAL = new Set(["invalid", "apo", "reject"]);

const P = () => dbPool();
const digits = (v) => String(v || "").normalize("NFKC").replace(/[^0-9]/g, "");
const clip = (v, n = 400) => String(v ?? "").replace(/<[^>]*>/g, "").trim().slice(0, n);

let _ready = null;
async function ensure() {
  if (!P()) throw new Error("データベースにつながっていません");
  if (_ready) return _ready;
  _ready = (async () => {
    const q = (s) => P().query(s);
    await q(`CREATE TABLE IF NOT EXISTS mc_call_lists (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, biz TEXT NOT NULL DEFAULT 'MOCHICA', note TEXT,
      members TEXT[] NOT NULL DEFAULT '{}', closed BOOLEAN NOT NULL DEFAULT false,
      created_by TEXT, created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE TABLE IF NOT EXISTS mc_call_leads (
      id SERIAL PRIMARY KEY, list_id INT REFERENCES mc_call_lists(id) ON DELETE CASCADE,
      biz TEXT NOT NULL DEFAULT 'MOCHICA', src TEXT NOT NULL, src_key TEXT NOT NULL,
      company TEXT, phone TEXT, person TEXT, sf_lead_id TEXT, hot SMALLINT, data JSONB,
      gate JSONB, cross_from TEXT, cross_id INT,
      next_at TIMESTAMPTZ, next_why TEXT, last_at TIMESTAMPTZ, last_outcome TEXT, attempts INT NOT NULL DEFAULT 0,
      done BOOLEAN NOT NULL DEFAULT false, assigned_to TEXT, locked_by TEXT, locked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(), UNIQUE (list_id, src, src_key))`);
    await q(`CREATE INDEX IF NOT EXISTS ix_mc_call_leads_q ON mc_call_leads(list_id, done, next_at)`);
    await q(`CREATE TABLE IF NOT EXISTS mc_call_logs (
      id SERIAL PRIMARY KEY, lead_id INT, list_id INT, biz TEXT NOT NULL DEFAULT 'MOCHICA', caller TEXT,
      phone TEXT, reach TEXT, outcome TEXT, reason TEXT, gate JSONB, memo TEXT, next_at TIMESTAMPTZ, apo_at TIMESTAMPTZ,
      cross_from TEXT, prev JSONB, sf_task_id TEXT, sf_err TEXT, undone BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS ix_mc_call_logs_lead ON mc_call_logs(lead_id, created_at DESC)`);
    await q(`CREATE INDEX IF NOT EXISTS ix_mc_call_logs_day ON mc_call_logs(created_at)`);
    // アポのおすすめ日時で選んだ「その時間に空いていたクローザー」（2026-11-17）
    await q(`ALTER TABLE mc_call_logs ADD COLUMN IF NOT EXISTS apo_who TEXT`);
    // 担当者と話せたときに聞いたこと（検討時期・採用ニーズ・説明会/面接の参加人数・採用目標人数）（2026-11-18 福井さん）
    //   リードには最新の値、記録にはそのとき聞いた値を残す（元に戻すで前の値へ戻せるように）
    await q(`ALTER TABLE mc_call_leads ADD COLUMN IF NOT EXISTS hearing JSONB`);
    await q(`ALTER TABLE mc_call_logs ADD COLUMN IF NOT EXISTS hearing JSONB`);
    // 掛け直しの型（2026-11-19 福井さん「科学的にアポが取れる架電に」）：担当者に届かないまま続けた回数と、休ませた日時。
    //   列を足す最初の1回だけ、いまある記録から「直近の連続不通の回数」を数えて入れる（既存の会社が0回から数え直しにならないように）。
    //   入れる上限は「上限−1」にして、いきなり全部が休みに入らないようにする
    const hasStreak = (await q(`SELECT 1 FROM information_schema.columns WHERE table_name='mc_call_leads' AND column_name='miss_streak'`)).rowCount > 0;
    const addCols = [`ALTER TABLE mc_call_leads ADD COLUMN IF NOT EXISTS miss_streak INT NOT NULL DEFAULT 0`, `ALTER TABLE mc_call_leads ADD COLUMN IF NOT EXISTS parked_at TIMESTAMPTZ`];
    if (hasStreak) { for (const s of addCols) await q(s); }
    else {
      const c = await P().connect();
      try {
        await c.query("BEGIN");
        for (const s of addCols) await c.query(s);
        await c.query(`UPDATE mc_call_leads c SET miss_streak = LEAST(x.n, ${CADENCE.maxMiss - 1}) FROM (
            SELECT g.lead_id, count(*) AS n FROM mc_call_logs g
            WHERE NOT g.undone AND g.outcome IN ('no_answer','busy','voicemail','absent')
              AND g.created_at > COALESCE((SELECT max(p.created_at) FROM mc_call_logs p WHERE p.lead_id=g.lead_id AND NOT p.undone AND p.reach='person'), 'epoch'::timestamptz)
            GROUP BY g.lead_id) x WHERE x.lead_id = c.id AND NOT c.done`);
        await c.query("COMMIT");
      } catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; }
      finally { c.release(); }
    }
    // SF のリードの項目（検討開始時期・採用人数・顧客の課題感）を書けなかったとき。黙って失敗しない（ルール5）
    await q(`ALTER TABLE mc_call_logs ADD COLUMN IF NOT EXISTS sf_lead_err TEXT`);
    // 架電の内容から SF のリードの項目を埋めた記録（2026-11-20 福井さん「アポが取れなくても、リストを埋めた・鮮度と精度を保った貢献を
    //   SF の項目をどれだけ埋めたかで評価できるように」）。1行＝1項目。kind：new（空を埋めた）・update（古い値を直した）・add（長文に足した）。
    //   SF と同じ値は書かないので行も作らない（何度かけても数が増えないように）。取り消した記録の分は undone で数えない。
    //   sf_pick：記録した人が画面で選んだ「書く・書かない」。sf_fill_done：この記録の分を SF に書き終えた
    await q(`CREATE TABLE IF NOT EXISTS mc_sf_fills (
      id SERIAL PRIMARY KEY, log_id INT, lead_id INT, sf_lead_id TEXT, caller TEXT, field TEXT, label TEXT, kind TEXT, src TEXT,
      old_val TEXT, new_val TEXT, undone BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS ix_mc_sf_fills_log ON mc_sf_fills(log_id)`);
    await q(`CREATE INDEX IF NOT EXISTS ix_mc_sf_fills_day ON mc_sf_fills(created_at)`);
    await q(`ALTER TABLE mc_call_logs ADD COLUMN IF NOT EXISTS sf_pick JSONB`);
    await q(`ALTER TABLE mc_call_logs ADD COLUMN IF NOT EXISTS sf_fill_done BOOLEAN NOT NULL DEFAULT false`);
    // 架電のあとにリードの状況を自動で進めた結果 { old, new } か { err }（2026-11-24）。取り消したときに戻すのに使う
    await q(`ALTER TABLE mc_call_logs ADD COLUMN IF NOT EXISTS sf_stage JSONB`);
    // リードの状況の表記をそろえた控え（2026-11-24）。1件ずつ前の値を残し、まとめて元に戻せるようにする
    await q(`CREATE TABLE IF NOT EXISTS mc_stage_runs (id SERIAL PRIMARY KEY, by_user TEXT, scope TEXT, total INT DEFAULT 0, done INT DEFAULT 0, ok INT DEFAULT 0, ng INT DEFAULT 0,
      state TEXT DEFAULT 'running', note TEXT, started_at TIMESTAMPTZ DEFAULT now(), ended_at TIMESTAMPTZ)`);
    await q(`CREATE TABLE IF NOT EXISTS mc_stage_norm (id SERIAL PRIMARY KEY, run_id INT, sf_lead_id TEXT, old_val TEXT, new_val TEXT, ok BOOLEAN, err TEXT, reverted BOOLEAN NOT NULL DEFAULT false, at TIMESTAMPTZ DEFAULT now())`);
    await q(`CREATE INDEX IF NOT EXISTS ix_mc_stage_norm_run ON mc_stage_norm(run_id)`);
    // アポのあとの流れ（担当 FS・カレンダーの予定・FS への知らせ）の結果（2026-11-23）。取り消したときに予定を消すのにも使う
    await q(`ALTER TABLE mc_call_logs ADD COLUMN IF NOT EXISTS apo_flow JSONB`);
    // マイナビ（新卒）の掲載の有無と中身。会社ごとに1回だけ調べて持っておく（同じ会社を何度も検索しないため）
    await q(`CREATE TABLE IF NOT EXISTS mc_mynavi (ckey TEXT PRIMARY KEY, company TEXT, data JSONB, at TIMESTAMPTZ DEFAULT now())`);
    // 資料送付の記録。架電の記録（mc_call_logs）に入れるとコール数に数えてしまうので別にする（2026-11-17）
    await q(`CREATE TABLE IF NOT EXISTS mc_doc_sends (
      id SERIAL PRIMARY KEY, lead_id INT, sender TEXT, to_addr TEXT, cc TEXT, subject TEXT, url TEXT, doc_name TEXT,
      sf_task_id TEXT, sf_err TEXT, created_at TIMESTAMPTZ DEFAULT now())`);
    // ヒアリングのメールの送信の記録（2026-11-23）。資料送付と分けて、何を聞いたか（keys）を残す
    await q(`CREATE TABLE IF NOT EXISTS mc_hear_mails (
      id SERIAL PRIMARY KEY, lead_id INT, sender TEXT, to_addr TEXT, cc TEXT, subject TEXT, keys JSONB,
      sf_task_id TEXT, sf_err TEXT, created_at TIMESTAMPTZ DEFAULT now())`);
    // 問い合わせフォームの送信の記録（2026-11-20）。送れなかった・送れたか分からないものも残す（黙って失敗しない）
    await q(`CREATE TABLE IF NOT EXISTS mc_form_sends (
      id SERIAL PRIMARY KEY, lead_id INT, sender TEXT, url TEXT, status TEXT, note TEXT, subject TEXT, body TEXT,
      sf_task_id TEXT, sf_err TEXT, created_at TIMESTAMPTZ DEFAULT now())`);
    // BALES CLOUD でできたことをMOCHICALL でも（2026-11-18 福井さん）：
    //   架電者が直した会社の情報（追加の番号・複数の担当者・メール）。元のデータ（Bales/CSV/DOC）は変えず、ここに重ねる
    await q(`ALTER TABLE mc_call_leads ADD COLUMN IF NOT EXISTS info JSONB`);
    //   リストごとのトークスクリプト（管理者が書き、架電中は右の列の上に折りたたんで出す）
    await q(`ALTER TABLE mc_call_lists ADD COLUMN IF NOT EXISTS script TEXT`);
    // リードの重複を絶対に起こさない（2026-11-18 福井さん）：電話番号・会社名・メールアドレスのどれか1つでも同じなら同じリード。
    //   終わったリード・閉じたリストも含め MOCHICA 全体で1件だけ。鍵（種類・値）を主キーにして、データベースが二重を断る。
    //   すでに入っていた重複は消さずに dup_of（先に入っていたリード）を付けて、かける順番から外す。
    //   管理者が「別の会社として残す」を押したもの（同じ代表番号のグループ会社など）は dup_ok で、重複の判定から外す
    await q(`CREATE TABLE IF NOT EXISTS mc_lead_keys (kind TEXT NOT NULL, k TEXT NOT NULL, lead_id INT NOT NULL, PRIMARY KEY (kind, k))`);
    await q(`CREATE INDEX IF NOT EXISTS ix_mc_lead_keys_lead ON mc_lead_keys(lead_id)`);
    await q(`ALTER TABLE mc_call_leads ADD COLUMN IF NOT EXISTS dup_of INT`);
    await q(`ALTER TABLE mc_call_leads ADD COLUMN IF NOT EXISTS dup_ok BOOLEAN NOT NULL DEFAULT false`);
    // 条件で割り振るための属性（リードソース・都道府県・業界・業種・最終架電・ホットの条件・SF の過去失注）（2026-11-19 福井さん）。mcseg.js
    await q(`ALTER TABLE mc_call_leads ADD COLUMN IF NOT EXISTS seg JSONB`);
    // 保管のリスト（2026-11-19）：BALES から移したリストなど。管理者には見えるが、だれの「かける」にも出ない。
    //   ここから条件で今のリストへ持ってくる（SHOBO から足す）か、「かける対象にする」で出す。bales_key は移した元の BALES のリスト
    await q(`ALTER TABLE mc_call_lists ADD COLUMN IF NOT EXISTS stock BOOLEAN NOT NULL DEFAULT false`);
    await q(`ALTER TABLE mc_call_lists ADD COLUMN IF NOT EXISTS bales_key TEXT`);
    // 商材（2026-11-24 福井さん「架け先のリストでキャリアミキサー（キャリミキ）も選べるように」）。
    //   いまあるリストはすべて MOCHICA のまま。記録にも、かけたときの商材を残す（あとで商材ごとに数えられるように）
    await q(`ALTER TABLE mc_call_lists ADD COLUMN IF NOT EXISTS product TEXT NOT NULL DEFAULT 'mochica'`);
    await q(`ALTER TABLE mc_call_logs ADD COLUMN IF NOT EXISTS product TEXT`);
    // リスト管理の「今日かけるリスト」から「かける」を出す（2026-11-23 福井さん）。today_src＝その入れ先のリスト（1本だけ。閉じると今までの出し方に戻る）、
    //   today_day＝そのリードがだれかの今日かけるリストに入った日（日本時間の YYYY-MM-DD）
    await q(`ALTER TABLE mc_call_lists ADD COLUMN IF NOT EXISTS today_src BOOLEAN NOT NULL DEFAULT false`);
    await q(`ALTER TABLE mc_call_leads ADD COLUMN IF NOT EXISTS today_day TEXT`);
    await backfillLeadKeys();
    await q(`CREATE TABLE IF NOT EXISTS mc_cross_moves (
      id SERIAL PRIMARY KEY, from_biz TEXT, to_biz TEXT, from_ref TEXT, from_name TEXT, to_list_id INT,
      count INT, reason TEXT, by_user TEXT, at TIMESTAMPTZ DEFAULT now())`);
    // 施策（リスト×トーク）・企業調査・録音の読み取り・折り返しの着信（2026-11-20 福井さん）。mcplay.js
    await ensurePlay(q);
  })().catch((e) => { _ready = null; throw e; });
  return _ready;
}

// Bales の行から、会社名・電話・担当者を取り出す（camelCase と snake_case の両方がある）
function fromBales(d = {}) {
  const g = (...ks) => { for (const k of ks) { const v = d[k]; if (v != null && String(v).trim()) return String(v).trim(); } return ""; };
  return { company: g("companyName", "company_name"), phone: g("companyTel1", "company_tel1", "personalTel", "personal_tel"), person: g("targetName", "target_name") };
}
// 1社にある電話番号を全部（代表・電話2・担当者直通・受付で聞いた直通）
function phonesOf(lead, data = {}) {
  const out = []; const seen = new Set();
  const add = (label, v) => { const n = digits(v); if (n.length < 9 || seen.has(n)) return; seen.add(n); out.push({ label, number: String(v).trim(), digits: n }); };
  add("代表", lead.phone);
  const NAMES = { companyTel1: "代表", company_tel1: "代表", companyTel2: "電話2", company_tel2: "電話2", personalTel: "担当者直通", personal_tel: "担当者直通" };
  for (const [k, v] of Object.entries(data || {})) if (/tel|phone/i.test(k) && typeof v !== "object") add(NAMES[k] || k, v);
  if (lead.gate && lead.gate.direct) add("受付で聞いた直通", lead.gate.direct);
  const info = lead.info || {};
  for (const p of info.phones || []) add(p.label || "追加の番号", p.number);
  for (const c of info.contacts || []) if (c.phone) add(`担当者 ${c.name || ""}${c.role ? `（${c.role}）` : ""}`.trim(), c.phone);
  return out;
}

async function nameMap() {
  const us = await listUsers().catch(() => []);
  return new Map(us.filter((u) => u && u.email).map((u) => [String(u.email).toLowerCase(), String(u.name || u.email)]));
}
function jstText(d) { if (!d) return ""; const j = new Date(new Date(d).getTime() + 9 * 3600e3); return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`; }
function outcomeLabel(o) { for (const r of Object.values(REACH)) if (r.outcomes[o]) return r.outcomes[o]; return o || ""; }

// 前回の架電を1行にまとめる（ASUMO 案3：「10/21 福井 受付NG → 担当は田中さん・午後なら在席 → 11月に再架電」）
function oneLine(log, gate, names) {
  if (!log) return "";
  const parts = [`${jstText(log.created_at).split(" ")[0]} ${names.get(String(log.caller || "").toLowerCase()) || log.caller || ""} ${outcomeLabel(log.outcome)}${log.reason ? `（${log.reason}）` : ""}`];
  const g = gate || {}; const gg = [g.name ? `担当は${g.name}さん` : "", g.hours ? `${g.hours}なら在席` : "", g.direct ? `直通あり` : ""].filter(Boolean);
  if (gg.length) parts.push(gg.join("・"));
  if (log.next_at) parts.push(`${jstText(log.next_at)} に再架電`);
  return parts.join(" → ");
}

// 会社名を比べるための形（全角半角・空白・株式会社などの違いをならす）。マイナビの調べ結果を会社ごとに持つのに使う
export function companyKey(name) {
  return String(name || "").normalize("NFKC").toLowerCase()
    .replace(/株式会社|有限会社|合同会社|合資会社|合名会社|\(株\)|\(有\)|\(同\)|㈱|㈲/g, "")
    .replace(/[\s・,.、。'"「」()（）\-ー‐]/g, "");
}

// ---- リードの重複の鍵（2026-11-18 福井さん「リードの重複が絶対に起こらないルール」） ----
//   同じリード＝「会社名が同じ」かつ「電話番号・メールアドレス・Web ページ・法人番号のどれか1つが同じ」（福井さん決定）。
//   会社名だけでは決めない（同じ名前の別の会社を止めてしまうため）。番号などだけでも決めない（グループ会社の代表番号など）。
//   なので鍵は「会社名｜値」の組み合わせ。会社名が無い・4つのどれも無いリードは、鍵が作れず判定できない（入れるが、件数を知らせる）。
//   電話は数字だけ（+81 は 0 に）で9桁以上、メールは小文字、Web はドメイン（www. を外す）、法人番号は13桁
const MAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
export function phoneKey(v) { let d = digits(v); if (/^81\d{9,10}$/.test(d)) d = "0" + d.slice(2); return d.length >= 9 ? d : ""; }
// 元のデータ（Bales/CSV/DOC）は、項目の名前で読む。担当者・所有者・作成者などの項目と社内のドメインは、
// うちの人のメールや URL なので使わない（使うと関係ないリードどうしが同じ鍵になる）
const OWN_FIELD = /operator|owner|user|staff|creat|updat|setter|rep_|sender|担当|所有|作成|更新/i;
const OWN_DOMAIN = /(^|[@.])(neo-career|c-career|neocareer)\./i;
const SERVICE_HOST = /(^|\.)(balescloud|bales|salesforce|force|lightning|mynavi|rikunabi|doda|google|googleusercontent|zoom|vercel|railway|doc-room|miitel|linkedin|facebook|twitter|x|instagram|wantedly|indeed)\./i;
const WEB_FIELD = /url|web|hp$|homepage|site|ホームページ|サイト/i;
const CORP_FIELD = /法人番号|corporate_?number|houjin|corp_?no/i;
export function webKey(v) {
  let s = String(v || "").trim().toLowerCase(); if (!s || MAIL_RE.test(s)) return "";
  if (!/^https?:\/\//.test(s)) { if (!/^[a-z0-9.-]+\.[a-z]{2,}/.test(s)) return ""; s = "http://" + s; }
  try { const h = new URL(s).hostname.replace(/^www\./, ""); return /\./.test(h) && !OWN_DOMAIN.test(h) && !SERVICE_HOST.test(h) ? h : ""; } catch { return ""; }
}
export function corpKey(v) { const d = digits(v); return d.length === 13 ? d : ""; }
function fieldsIn(o, re) { const out = []; for (const [k, v] of Object.entries(o || {})) if ((typeof v === "string" || typeof v === "number") && re.test(k) && !OWN_FIELD.test(k)) out.push(String(v)); return out; }
export function leadKeys({ company, phone, info, data } = {}) {
  const co = companyKey(company); if (co.length < 2) return [];
  const I = info || {}; const m = new Map();
  const add = (kind, v) => { if (v) m.set(`${kind}\u0000${co}|${v}`, { kind, k: `${co}|${v}` }); };
  for (const p of [phone, ...(I.phones || []).map((x) => x.number), ...(I.contacts || []).map((x) => x.phone)]) add("tel", phoneKey(p));
  for (const e of [I.email, ...(I.contacts || []).map((x) => x.email), ...fieldsIn(data, /mail|メール/i)]) { const x = String(e || "").trim().toLowerCase(); if (MAIL_RE.test(x) && !OWN_DOMAIN.test(x)) add("mail", x); }
  for (const w of [I.web, ...fieldsIn(data, WEB_FIELD)]) add("web", webKey(w));
  for (const c of [I.corp, ...fieldsIn(data, CORP_FIELD)]) add("corp", corpKey(c));
  return [...m.values()];
}
// 使わないと決めた鍵（過去分の登録で21件以上のリードに出たもの）。kind を「ign:種類」にして同じ表に置く
async function dropIgnored(db, keys) {
  if (!keys.length) return keys;
  const ig = new Set((await db.query(`SELECT kind, k FROM mc_lead_keys WHERE kind = ANY($1) AND k = ANY($2)`, [[...new Set(keys.map((x) => `ign:${x.kind}`))], keys.map((x) => x.k)])).rows.map((r) => `${r.kind.slice(4)}\u0000${r.k}`));
  return ig.size ? keys.filter((x) => !ig.has(`${x.kind}\u0000${x.k}`)) : keys;
}
const KEY_LABEL = { tel: "会社名と電話番号", mail: "会社名とメールアドレス", web: "会社名と Web ページ", corp: "会社名と法人番号" };
// 鍵がほかのリードに使われていれば、その1件を返す（自分のものは除く）
async function keyHit(db, keys, selfId = 0) {
  if (!keys.length) return null;
  const r = (await db.query(`SELECT x.kind, x.k, x.lead_id, c.company, l.name AS list FROM mc_lead_keys x JOIN unnest($1::text[], $2::text[]) AS u(kind, k) ON u.kind=x.kind AND u.k=x.k
    LEFT JOIN mc_call_leads c ON c.id=x.lead_id LEFT JOIN mc_call_lists l ON l.id=c.list_id WHERE x.lead_id <> $3 LIMIT 1`, [keys.map((x) => x.kind), keys.map((x) => x.k), selfId])).rows[0];
  return r || null;
}
export function dupSamples() { const a = []; return { push(company, h) { if (a.length < 5 && h && h.company) a.push(`${company || "（名前なし）"}：${dupText(h)}`); }, list: a }; }
export function dupText(h) { return h ? `${KEY_LABEL[h.kind] || h.kind}が「${h.company || "（名前なし）"}」${h.list ? `（リスト「${h.list}」）` : ""}と同じ` : ""; }
// リードを1件入れる。鍵の確かめ・リードの追加・鍵の登録を1つのまとまり（トランザクション）で行うので、
// 同時に2人が取り込んでも二重には入らない（2人目は主キーで断られて、まるごと取り消される）
// アプローチ禁止の名簿を読む。読めないときは取り込みを止める（読めないまま入れると禁止の会社が混ざるため。2026-11-20）
async function banListOrStop() {
  try { await loadApproachBans(); }
  catch (e) { console.error("[mccall] アプローチ禁止の名簿が読めないため止めました", e.message); throw new Error("アプローチ禁止の名簿を確認できなかったため、念のため1件も入れていません。少し待ってからやり直してください"); }
}
export async function addLeadUnique(cols, ctx = {}) {
  // どの取り込みから呼ばれても、最後にここで必ずアプローチ禁止をはじく（呼ぶ側の確かめ忘れがあっても入らないように）。
  //   電話は代表・追加・担当者の番号すべてと、元のデータの電話らしい項目も見る
  const dataPhones = Object.entries(ctx.data || {}).filter(([k, v]) => /電話|tel|phone|携帯|mobile/i.test(k) && (typeof v === "string" || typeof v === "number")).map(([, v]) => String(v));
  if (await approachBanHitLead({ company: cols.company, phone: cols.phone, info: cols.info, sf_lead_id: cols.sf_lead_id }, dataPhones)) return { added: false, banned: true };
  let keys = leadKeys({ company: cols.company, phone: cols.phone, info: cols.info, data: ctx.data });
  const c = await P().connect();
  try {
    await c.query("BEGIN");
    keys = await dropIgnored(c, keys);
    const hit = await keyHit(c, keys);
    if (hit) { await c.query("ROLLBACK"); return { added: false, dup: hit }; }
    const names = Object.keys(cols);
    const row = (await c.query(`INSERT INTO mc_call_leads (${names.join(",")}) VALUES (${names.map((_, i) => `$${i + 1}`).join(",")}) ON CONFLICT DO NOTHING RETURNING id`, names.map((n) => cols[n]))).rows[0];
    if (!row) { await c.query("ROLLBACK"); return { added: false, dup: { kind: "src" } }; }
    if (keys.length) await c.query(`INSERT INTO mc_lead_keys (kind, k, lead_id) SELECT a, b, $3 FROM unnest($1::text[], $2::text[]) AS u(a, b)`, [keys.map((x) => x.kind), keys.map((x) => x.k), row.id]);
    await c.query("COMMIT");
    return { added: true, id: row.id, nokey: !keys.length };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    if (e.code === "23505") return { added: false, dup: { kind: "race" } };
    throw e;
  } finally { c.release(); }
}
// 鍵の表を作る前から入っていたリードの鍵を、古い順（id の小さい順）に登録する（1回だけ）。
// 後から入った重複には dup_of を付けて、かける順番から外す（消さない）
async function backfillLeadKeys() {
  const done = (await P().query(`SELECT 1 FROM mc_lead_keys WHERE kind='_v' AND k='2'`)).rows.length;
  if (done) return;
  if ((await P().query(`SELECT 1 FROM mc_lead_keys WHERE kind='_v' AND k='1'`)).rows.length) {
    await P().query(`DELETE FROM mc_lead_keys`);
    await P().query(`UPDATE mc_call_leads SET dup_of=NULL WHERE dup_of IS NOT NULL`);
  }
  const base = `SELECT c.id, c.company, c.phone, c.info, c.data, c.dup_ok FROM mc_call_leads c`;
  let rows;
  // Bales・DOC の元のデータのメールも鍵にする（表が無い環境では、kinbot に持っているものだけで登録する）
  try {
    rows = (await P().query(`SELECT c.id, c.company, c.phone, c.info, COALESCE(c.data, '{}'::jsonb) || COALESCE(r.data, '{}'::jsonb) || COALESCE(jsonb_build_object('email', t.email), '{}'::jsonb) AS data, c.dup_ok
      FROM mc_call_leads c
      LEFT JOIN mochica_bales_rows r ON c.src='bales' AND r.list_key=split_part(c.src_key,'|',1) AND r.row_key=substr(c.src_key, strpos(c.src_key,'|')+1)
      LEFT JOIN call_targets t ON c.src='doc' AND t.id::text=c.src_key ORDER BY c.id`)).rows;
  } catch (e) { console.error("[mccall] 重複の鍵：元のデータを読めなかったので kinbot の分だけで登録します", e.message); rows = (await P().query(`${base} ORDER BY c.id`)).rows; }
  // 同じ鍵が21件以上のリードに出るものは、社内のメール・コールセンターの番号などの見込みが高いので鍵にしない（ログに残す）
  const freq = new Map(); const keysOf = new Map();
  for (const r of rows) { const ks = leadKeys(r); keysOf.set(r.id, ks); for (const x of ks) { const kk = `${x.kind}\u0000${x.k}`; freq.set(kk, (freq.get(kk) || 0) + 1); } }
  const wide = [...freq.entries()].filter(([, n]) => n > 20);
  if (wide.length) console.error(`[mccall] 重複の鍵：21件以上のリードに出る鍵 ${wide.length}個は使いません`, wide.slice(0, 10).map(([kk, n]) => `${kk.replace("\u0000", ":")}=${n}`).join(", "));
  const wideSet = new Set(wide.map(([kk]) => kk));
  if (wide.length) { const sp = wide.map(([kk]) => kk.split("\u0000"));
    await P().query(`INSERT INTO mc_lead_keys (kind, k, lead_id) SELECT 'ign:' || a, b, 0 FROM unnest($1::text[], $2::text[]) AS u(a, b) ON CONFLICT DO NOTHING`, [sp.map((x) => x[0]), sp.map((x) => x[1])]); }
  const owner = new Map(); const dups = [];
  for (const r of rows) {
    const keys = keysOf.get(r.id).filter((x) => !wideSet.has(`${x.kind}\u0000${x.k}`));
    const first = keys.map((x) => owner.get(`${x.kind}\u0000${x.k}`)).find(Boolean);
    if (first && !r.dup_ok) { dups.push([r.id, first]); continue; }
    for (const x of keys) { const kk = `${x.kind}\u0000${x.k}`; if (!owner.has(kk)) owner.set(kk, r.id); }
  }
  const ent = [...owner.entries()].map(([kk, id]) => { const [kind, k] = kk.split("\u0000"); return { kind, k, id }; });
  for (let i = 0; i < ent.length; i += 5000) {
    const s = ent.slice(i, i + 5000);
    await P().query(`INSERT INTO mc_lead_keys (kind, k, lead_id) SELECT * FROM unnest($1::text[], $2::text[], $3::int[]) ON CONFLICT DO NOTHING`, [s.map((x) => x.kind), s.map((x) => x.k), s.map((x) => x.id)]);
  }
  if (dups.length) await P().query(`UPDATE mc_call_leads c SET dup_of=u.f FROM unnest($1::int[], $2::int[]) AS u(id, f) WHERE c.id=u.id`, [dups.map((d) => d[0]), dups.map((d) => d[1])]);
  await P().query(`INSERT INTO mc_lead_keys (kind, k, lead_id) VALUES ('_v','2',0) ON CONFLICT DO NOTHING`);
  console.log(`[mccall] 重複の鍵を登録しました（リード ${rows.length}件・鍵 ${ent.length}個・重複で止めたリード ${dups.length}件）`);
}

// ---- マイナビの調べ（2026-11-18 福井さん「リードのマイナビ掲載有無及びマイナビ情報の反映」。Web検索で自動・取込時にまとめて） ----
//   取り込んだ会社を順番に調べる（同時に2社まで。検索とAIの費用・速さを抑える）。
//   掲載ありは30日、見つからないは14日、失敗は1時間たったら調べ直す。
//   検索の鍵が無い・失敗したときは「失敗」として残して画面に出す（「見つからない」と取り違えない＝ルール5）
const MYNAVI_TTL = { listed: 30 * 86400e3, notfound: 14 * 86400e3, error: 3600e3 };
const _mnQueue = new Map(); let _mnRunning = 0;
async function mynaviCheck(ckey, company) {
  try {
    const d = await lookupMynaviFree(company);
    if (d.status === "error") throw new Error(d.error || "Web 検索が使えませんでした");
    await P().query(`INSERT INTO mc_mynavi (ckey, company, data, at) VALUES ($1,$2,$3,now()) ON CONFLICT (ckey) DO UPDATE SET company=$2, data=$3, at=now()`, [ckey, company, d]);
  } catch (e) {
    console.error("[mccall] マイナビを調べられませんでした", company, e.message);
    await P().query(`INSERT INTO mc_mynavi (ckey, company, data, at) VALUES ($1,$2,$3,now()) ON CONFLICT (ckey) DO UPDATE SET data=$3, at=now()`,
      [ckey, company, { status: "error", error: String(e.message).slice(0, 200), checkedAt: new Date().toISOString() }]).catch(() => {});
  }
}
function mynaviPump() {
  while (_mnRunning < 2 && _mnQueue.size) {
    const [ckey, company] = _mnQueue.entries().next().value; _mnQueue.delete(ckey); _mnRunning++;
    mynaviCheck(ckey, company).finally(() => { _mnRunning--; mynaviPump(); });
  }
}
// まだ調べていない・古くなった会社だけ順番に入れる
export async function mynaviEnqueue(companies) {
  const m = new Map(); for (const c of companies) { const k = companyKey(c); if (k && k.length >= 2 && !m.has(k)) m.set(k, String(c).trim()); }
  if (!m.size) return 0;
  const have = (await P().query(`SELECT ckey, data->>'status' AS st, at FROM mc_mynavi WHERE ckey = ANY($1)`, [[...m.keys()]])).rows;
  const fresh = new Set(have.filter((r) => Date.now() - new Date(r.at).getTime() < (MYNAVI_TTL[r.st] || 0)).map((r) => r.ckey));
  let n = 0; for (const [k, c] of m) if (!fresh.has(k) && !_mnQueue.has(k)) { _mnQueue.set(k, c); n++; }
  mynaviPump(); return n;
}
async function mynaviOf(company) {
  const k = companyKey(company); if (!k) return null;
  const r = (await P().query(`SELECT data, at FROM mc_mynavi WHERE ckey=$1`, [k]).catch(() => ({ rows: [] }))).rows[0];
  if (!r || Date.now() - new Date(r.at).getTime() >= (MYNAVI_TTL[(r.data || {}).status] || 0)) { await mynaviEnqueue([company]).catch(() => {}); }
  if (!r) return { status: "checking" };
  return _mnQueue.has(k) && (r.data || {}).status === "error" ? { status: "checking" } : r.data;
}

// ---- ヒアリング（2026-11-18 福井さん「検討時期・採用ニーズの明記／接触人数・採用目標人数のヒヤリング」） ----
//   検討時期は SF の「検討開始時期」と同じ 1月〜12月（SF の選択肢に合わせる。未定も残せる）。
//   接触人数は「説明会・面接の参加人数」（福井さん決定）。人数は数字だけにして、あとで集計できるようにする
// 項目の定義・形のそろえ方・アポにしてよいかの判定は server/mchearing.js（28項目。画面にも /api/mccall/meta で渡す）
export const hearingLines = (h) => hearLines(h, NEED_CHOICES);
// 採用目標人数 → SF の「採用人数(選択リスト)」の選択肢は server/mcsffill.js の hiresBucket（上で読み込んで、ここからも出している）

// ---- 条件で割り振る（2026-11-19 福井さん「SHOBO のリスト管理を kinbot 準拠で」） ----
// まだ属性を計算していない（または計算のしかたが古い）リードの seg を埋める。リストを開いたときに、そのリストの分だけ。
//   Bales のリードは取り込んだ行（ホットの判定・SF のリード）、DOC のリードは kincall の行（ソース・業種・最後にかけた日時）も読む
export async function refreshSeg(listId, { budgetMs = 0 } = {}) {
  // 1つのリストでも、いくつかのリストでも（SHOBO のほかのリストから持ってくるとき）
  const ids = (Array.isArray(listId) ? listId : [listId]).map((x) => parseInt(x, 10)).filter((x) => x > 0);
  if (!ids.length) return 0;
  let n = 0; const t0 = Date.now();
  for (let round = 0; round < 80; round++) {
    // リード管理の画面（全リスト）は、BALES から移した2万件を一度に計算すると開くまで待たされるので、時間で区切って残りは次に回す
    if (budgetMs && round > 0 && Date.now() - t0 > budgetMs) break;
    // DOC の行との結びつけは CASE の中で数字にする。AND で並べるだけだと、Postgres が先に「k1|r1」のような BALES の鍵まで
    // 数字にしようとして全体が失敗することがある（実行計画しだい。2026-11-20 全リストを数えるリード管理で見つけた）
    const rows = (await P().query(`SELECT c.id, c.src, c.company, c.phone, c.person, c.data, c.hearing,
        b.hot_d, b.sf->'lead' AS sf_lead, b.data AS b_data,
        t.source AS t_source, t.industry AS t_industry, t.status AS t_status, t.extra AS t_extra,
        (SELECT max(l.at) FROM call_logs l WHERE c.src='doc' AND l.target_id = t.id) AS t_last
      FROM mc_call_leads c
      LEFT JOIN mochica_bales_rows b ON c.src='bales' AND b.list_key = regexp_replace(c.src_key, '[|][^|]*$', '') AND b.row_key = regexp_replace(c.src_key, '^.*[|]', '')
      LEFT JOIN call_targets t ON c.src='doc' AND t.id = (CASE WHEN c.src_key ~ '^[0-9]{1,9}$' THEN c.src_key::int END)
      -- 9桁までに絞る：DOC 以外（BALES など）の12桁の番号も CASE は全行で評価されるため、int に入りきらず全体が止まった（2026-11-20）
      WHERE c.list_id = ANY($1::int[]) AND (c.seg IS NULL OR COALESCE((c.seg->>'v')::int,0) < $2) ORDER BY c.id LIMIT 1000`, [ids, SEG_V])).rows;
    if (!rows.length) break;
    // Bales のリードは中身を mc_call_leads に持たず、取り込んだ行（mochica_bales_rows）を読む（架電画面と同じ）
    const items = rows.map((r) => ({ id: r.id, seg: segOf({ src: r.src, data: r.src === "bales" ? r.b_data : r.data, company: r.company, phone: r.phone, person: r.person, hearing: r.hearing, hotD: r.hot_d, sfLead: r.sf_lead,
      doc: r.src === "doc" ? { source: r.t_source, industry: r.t_industry, status: r.t_status, extra: r.t_extra, last_at: r.t_last } : null }) }));
    await P().query(`UPDATE mc_call_leads c SET seg = x.seg FROM jsonb_to_recordset($1::jsonb) AS x(id int, seg jsonb) WHERE c.id = x.id`, [JSON.stringify(items)]);
    n += rows.length;
    if (rows.length < 1000) break;
  }
  return n;
}
// 絞り込みの軸。値は SQL で出す（最終架電・期限・検討時期は日がたつと変わるので、保存せずにその場で数える）
//   2026-11-20 福井さん：ASUMO /teleapo の絞り込み条件にそろえた。ICP スコア・インテント・検証済み・タグ・メールのクリック・採用構成・
//   条件1〜3 は SHOBO に判定の元データが無いので、決め方を合意してから足す（第2段）
const LAST_TS = `GREATEST(c.last_at, NULLIF(c.seg->>'extLast','')::timestamptz)`;
const OUTCOME_SQL = `CASE c.last_outcome ${Object.values(REACH).flatMap((r) => Object.entries(r.outcomes)).map(([k, v]) => `WHEN '${k}' THEN '${v}'`).join(" ")} ELSE c.last_outcome END`;
const sqlLit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const JST = `(now() AT TIME ZONE 'Asia/Tokyo')`;
const JST_TODAY = `(date_trunc('day', ${JST}) AT TIME ZONE 'Asia/Tokyo')`;
// マイナビの調べ（会社ごと。リードの seg.ckey で結ぶ）
const MN = `(SELECT m.data FROM mc_mynavi m WHERE m.ckey = c.seg->>'ckey')`;
// 全角の数字もそろえて、文の中の最初の数を取る（「6~10名」は 6＝下限で見る）
// 企業調査の採用の項目は、今の募集と確かめたもの（mcfresh.js の CHECK_V で確かめ、STALE_DAYS 以内）だけを使う（2026-11-23 福井さん）。
//   画面の showableResearch と同じ決まり。確かめる前の古い結果は、調べ直すまで「未取得」と同じに扱う
const RX = (k) => `(CASE WHEN c.research->'check'->>'v' = '${CHECK_V}' AND (c.research->'check'->>'at')::timestamptz > now() - interval '${STALE_DAYS} days' THEN c.research->>'${k}' END)`;
const firstNum = (x) => `NULLIF(substring(translate(COALESCE(${x},''), '０１２３４５６７８９', '0123456789') from '([0-9]+)'), '')::int`;
// 採用人数：架電で聞いた採用目標人数 → 企業調査の採用人数 → マイナビの採用予定人数
const HIRE_HEARD = `CASE WHEN COALESCE(c.hearing->>'target','') ~ '^[0-9]+$' THEN (c.hearing->>'target')::int END`;
const HIRE_EST = `COALESCE(${firstNum(RX("headcount"))}, ${firstNum(`${MN}->>'plannedHires'`)})`;
const HIRE = `COALESCE(${HIRE_HEARD}, ${HIRE_EST})`;
// 年月（YYYY-MM）または月だけ（M）→ 今月から何か月先か（月だけのときは次に来るその月。過ぎたことにはしない）
const monthsAhead = (x) => `(CASE WHEN ${x} ~ '^[0-9]{4}-[0-9]{2}$' THEN (substr(${x},1,4)::int*12 + substr(${x},6,2)::int) - (EXTRACT(YEAR FROM ${JST})::int*12 + EXTRACT(MONTH FROM ${JST})::int)
  WHEN ${x} ~ '^[0-9]{1,2}$' THEN ((${x}::int - EXTRACT(MONTH FROM ${JST})::int + 12) % 12) END)`;
// 検討時期：架電で聞いた月（新しい）→ SF の検討開始時期
const WHEN_SRC = `COALESCE(CASE WHEN COALESCE(c.hearing->>'when','') ~ '^[0-9]{1,2}月$' THEN regexp_replace(c.hearing->>'when','月$','') END, NULLIF(c.seg->>'whenYm',''))`;
const WHEN_M = monthsAhead(WHEN_SRC);
const RENEW_M = monthsAhead(`NULLIF(c.seg->>'renewYm','')`);
// 最後に断られた理由（SHOBO で記録したもの）
const LAST_REJECT = `(SELECT l.reason FROM mc_call_logs l WHERE l.lead_id = c.id AND l.outcome = 'reject' AND NOT l.undone ORDER BY l.created_at DESC LIMIT 1)`;
const DIGITS = `regexp_replace(translate(COALESCE(c.phone,''), '０１２３４５６７８９', '0123456789'), '[^0-9]', '', 'g')`;
// 採用区分・採用課題を読む文（企業調査・SF の課題感・架電で聞いたニーズ）
const HIRING_TXT = `concat_ws(' ', ${RX("hiring")}, ${RX("roles")}, ${RX("media")})`;
const PAIN_TXT = `concat_ws(' ', ${RX("issue")}, c.seg->>'issue', c.hearing->>'need')`;
const arrOf = (cases) => `array_remove(ARRAY[${cases.map(([v, cond]) => `CASE WHEN ${cond} THEN ${sqlLit(v)} END`).join(", ")}]::text[], NULL)`;
export const PAINS = [
  ["母集団形成", "母集団|応募が(少|来)|応募者?が(少|集ま)|集まらな|人が来な|知名度|認知"],
  ["選考の歩留まり", "歩留|選考.{0,6}(離脱|落ち|来な)|面接に来な|説明会.{0,6}(来な|少な)"],
  ["内定辞退", "内定.{0,4}辞退|辞退"],
  ["工数・人手不足", "工数|手が回ら|マンパワー|人手|負担|時間が(ない|無い|足り)|兼任|ひとりで|1人で"],
  ["採用単価が高い", "単価|費用が|コストが|高い|高額"],
  ["応募者の質・ミスマッチ", "ミスマッチ|質が|定着|早期離職|すぐ辞め|合わない"],
  ["採用担当の不在・交代", "担当者?(が)?(不在|いない|居ない|交代|変わ)|採用担当.{0,4}(退職|異動)|採用担当の(不在|交代)"],
];
// ヒアリングの「採用ニーズ」の選択肢（2026-11-23 福井さん「採用ニーズを選択肢に」）。
//   困りごとは上の PAINS と同じ名前にする（選んだ値がそのまま「困りごと」の条件で絞れるように。そのため名前が自分の行の言葉に当たるようにしてある：採用担当の行に「採用担当の(不在|交代)」を足した）。
//   値は「困りごと：〜／ほしい人：〜」の文で持つ（前からの自由記入と同じ列・SF の顧客の課題感にもそのまま書けるように）
export const NEED_CHOICES = { pains: [...PAINS.map(([l]) => l), "特に困っていない"], who: ["新卒", "中途", "パート・アルバイト"] };
// multi：1社に値が複数ある軸（text[] を返す）。「どれか」が一致すれば残す。needs：その軸を選んでいるときだけ画面に出す
export const SEG_DIMS = {
  // どこから足したリードか（2026-11-19 福井さん「SF・BALES・SHOBO から」）。SHOBO＝CSV で SHOBO に直接入れたもの
  origin: { label: "取り込み元", sql: `CASE c.src WHEN 'sf' THEN 'SF' WHEN 'bales' THEN 'BALES' WHEN 'csv' THEN 'SHOBO（CSV）' WHEN 'doc' THEN 'DOC' ELSE c.src END`, order: ["SF", "BALES", "SHOBO（CSV）", "DOC"] },
  list: { label: "リスト", sql: `COALESCE((SELECT x.name FROM mc_call_lists x WHERE x.id = c.list_id), '（不明）')`, poolOnly: true },
  source: { label: "リード元", sql: `COALESCE(NULLIF(c.seg->>'source',''),'（未記録）')` },
  stage: { label: "ステージ（BALES・SF・DOC）", sql: `COALESCE(NULLIF(c.seg->>'stage',''),'なし')` },
  gyokai: { label: "業界（大分類）", sql: `COALESCE(NULLIF(c.seg->>'gyokai',''),'不明')` },
  category: { label: "カテゴリ（マイナビの業種）", sql: `COALESCE(NULLIF(${MN}->>'industry',''), CASE WHEN ${MN}->>'status' = 'listed' THEN '業種の記載なし' ELSE 'マイナビ掲載なし・未確認' END)` },
  gyoshu: { label: "業種", sql: `COALESCE(NULLIF(c.seg->>'gyoshu',''),'不明')` },
  roles: { label: "募集職種", multi: true, none: "（未取得）", sql: `ARRAY(SELECT DISTINCT left(btrim(x), 30) FROM unnest(regexp_split_to_array(COALESCE(${RX("roles")},''), '[、,，・/／]+')
      || ARRAY(SELECT jsonb_array_elements_text(CASE WHEN jsonb_typeof(${MN}->'jobs') = 'array' THEN ${MN}->'jobs' ELSE '[]'::jsonb END))) AS x WHERE btrim(x) <> '')` },
  pref: { label: "所在地（都道府県）", sql: `COALESCE(NULLIF(c.seg->>'pref',''),'（未登録）')` },
  city: { label: "市区町村", sql: `COALESCE(NULLIF(c.seg->>'city',''),'（未登録）')`, needs: "pref" },
  owner: { label: "自社担当", sql: `COALESCE(c.assigned_to,'（担当なし）')`, names: true },
  research: { label: "事前調査", sql: `CASE WHEN c.research_at IS NULL THEN '未調査' WHEN c.research->>'status' = 'error' THEN '調べられなかった' ELSE '調査済み' END`, order: ["調査済み", "調べられなかった", "未調査"] },
  phone: { label: "電話番号", sql: `CASE WHEN ${DIGITS} ~ '^0[0-9]{9,10}$' THEN '発信できる' WHEN ${DIGITS} = '' THEN '未登録' ELSE '番号の形が正しくない' END`, order: ["発信できる", "番号の形が正しくない", "未登録"] },
  competitor: { label: "競合バッティング", sql: `CASE WHEN COALESCE(c.seg->'lost'->>'rival','') <> '' THEN '競合に負けた（SF の失注）'
      WHEN COALESCE(c.seg->>'ats','') <> '' OR (c.last_outcome = 'reject' AND ${LAST_REJECT} = '他社を使っている') THEN '競合を利用中' ELSE '競合の印なし' END`, order: ["競合に負けた（SF の失注）", "競合を利用中", "競合の印なし"] },
  due: { label: "次アクション期限", sql: `CASE WHEN c.next_at IS NULL THEN '期限なし' WHEN c.next_at < ${JST_TODAY} THEN '期限切れ' WHEN c.next_at < ${JST_TODAY} + interval '1 day' THEN '本日' ELSE '明日以降' END`,
    order: ["期限切れ", "本日", "明日以降", "期限なし"] },
  followup: { label: "追いかけ", sql: `CASE WHEN c.next_why = ${sqlLit(WHY_HUMAN)} AND c.next_at <= now() THEN '予約の時刻が来た' WHEN c.next_why = ${sqlLit(WHY_HUMAN)} THEN '予約あり（まだ）'
      WHEN c.next_at IS NOT NULL THEN '自動の掛け直し' ELSE 'なし' END`, order: ["予約の時刻が来た", "予約あり（まだ）", "自動の掛け直し", "なし"] },
  hireSource: { label: "採用人数の確度", sql: `CASE WHEN ${HIRE_HEARD} IS NOT NULL THEN '確認済み（架電で聞いた）' WHEN ${HIRE_EST} IS NOT NULL THEN '推定（企業調査・マイナビ）' ELSE '不明' END`,
    order: ["確認済み（架電で聞いた）", "推定（企業調査・マイナビ）", "不明"] },
  lastResult: { label: "架電ステータス（前回の結果）", sql: `CASE WHEN c.last_at IS NOT NULL AND (NULLIF(c.seg->>'extLast','') IS NULL OR c.last_at >= (c.seg->>'extLast')::timestamptz) THEN ${OUTCOME_SQL}
    ELSE COALESCE(NULLIF(c.seg->>'extResult',''),'未架電') END` },
  decline: { label: "断り理由", sql: `CASE WHEN c.last_outcome = 'reject' THEN COALESCE(NULLIF(${LAST_REJECT},''),'理由なし') ELSE '断られていない' END`,
    order: [...REJECT_REASONS, "理由なし", "断られていない"] },
  last: { label: "最終架電", sql: `CASE WHEN ${LAST_TS} IS NULL THEN '未架電' WHEN ${LAST_TS} > now() - interval '7 days' THEN '7日以内'
    WHEN ${LAST_TS} > now() - interval '30 days' THEN '8〜30日前' WHEN ${LAST_TS} > now() - interval '90 days' THEN '31〜90日前' ELSE '91日以上前' END`, order: ["未架電", "91日以上前", "31〜90日前", "8〜30日前", "7日以内"] },
  hot: { label: "ホット度", sql: `CASE WHEN COALESCE(c.hot,0) >= 3 THEN 'ホット' WHEN COALESCE(c.hot,0) = 2 THEN 'ウォーム' ELSE 'コールド' END`, order: ["ホット", "ウォーム", "コールド"] },
  segments: { label: "採用区分", multi: true, none: "不明", sql: arrOf([["新卒", `(${HIRING_TXT} ~ '新卒|大卒|大学|卒業予定|[0-9]{2}卒' OR ${MN}->>'status' = 'listed')`],
    ["高卒", `${HIRING_TXT} ~ '高卒|高校'`], ["中途", `${HIRING_TXT} ~ '中途|経験者|キャリア|転職'`], ["パート・アルバイト", `${HIRING_TXT} ~ 'パート|アルバイト'`]]), order: ["新卒", "高卒", "中途", "パート・アルバイト", "不明"] },
  pains: { label: "採用課題", multi: true, none: "分からない", sql: arrOf(PAINS.map(([v, re]) => [v, `${PAIN_TXT} ~ ${sqlLit(re)}`])), order: [...PAINS.map((x) => x[0]), "分からない"] },
  budget: { label: "検討時期", sql: `CASE WHEN ${WHEN_M} < 0 THEN '時期が過ぎた' WHEN ${WHEN_M} = 0 THEN '今月' WHEN ${WHEN_M} <= 3 THEN '3か月以内' WHEN ${WHEN_M} IS NOT NULL THEN '4か月以上先'
      WHEN c.hearing->>'when' = '未定' THEN '未定と言われた' ELSE '分からない' END`, order: ["今月", "3か月以内", "4か月以上先", "時期が過ぎた", "未定と言われた", "分からない"] },
  renewal: { label: "更新時期", sql: `CASE WHEN ${RENEW_M} < 0 THEN '更新月が過ぎた' WHEN ${RENEW_M} = 0 THEN '今月更新' WHEN ${RENEW_M} = 1 THEN '来月更新' WHEN ${RENEW_M} <= 3 THEN '3か月以内'
      WHEN ${RENEW_M} <= 6 THEN '6か月以内' WHEN ${RENEW_M} IS NOT NULL THEN '7か月以上先' WHEN COALESCE(c.seg->>'ats','') <> '' THEN '競合利用中で更新月が未確認' ELSE '分からない' END`,
    order: ["今月更新", "来月更新", "3か月以内", "6か月以内", "7か月以上先", "更新月が過ぎた", "競合利用中で更新月が未確認", "分からない"] },
  lost: { label: "過去失注（SF の失注理由）", sql: `CASE WHEN jsonb_typeof(c.seg->'lost') = 'object' THEN COALESCE(NULLIF(c.seg->'lost'->>'reason',''),'理由なし') ELSE '失注なし' END` },
};
// ホットの条件（そろっているものだけに絞る）。SHOBO で聞いたこと（hearing）はその場で見る
export const SEG_CONDS = {
  name: { label: "採用担当者名が分かる", sql: `(c.seg->'conds' ? 'name')` },
  need: { label: "ニーズを聞けた", sql: `(c.seg->'conds' ? 'need' OR COALESCE(c.hearing->>'need','') <> '')` },
  when: { label: "検討時期を聞けた", sql: `(c.seg->'conds' ? 'when' OR COALESCE(c.hearing->>'when','') NOT IN ('','未定'))` },
};
// 並べ替え（ASUMO /teleapo の並べ替えに合わせる。ICP スコアの代わりはホット度）。default は今までどおり ホット → 最後にかけた日が古い順
export const SEG_SORTS = {
  default: { label: "既定（ホット → 最後にかけた日が古い順）" },
  hot: { label: "ホット度", sql: [`COALESCE(c.hot,0)`], dir: "desc" },
  company: { label: "会社名", sql: [`c.company`] },
  gyokai: { label: "業界 → 業種", sql: [`c.seg->>'gyokai'`, `c.seg->>'gyoshu'`] },
  gyoshu: { label: "業種", sql: [`c.seg->>'gyoshu'`] },
  owner: { label: "自社担当", sql: [`c.assigned_to`] },
  calls: { label: "架電回数", sql: [`c.attempts`] },
  updated: { label: "最終架電日時", sql: [LAST_TS], dir: "desc" },
  due: { label: "次アクション期限", sql: [`c.next_at`] },
  followup: { label: "追いかけ時刻", sql: [`CASE WHEN c.next_why = ${sqlLit(WHY_HUMAN)} THEN c.next_at END`] },
  renewal: { label: "更新時期が近い順", sql: [RENEW_M] },
  hire: { label: "採用人数", sql: [HIRE], dir: "desc" },
};
// 並び順の ORDER BY。どの並びでも、同じ値の中は ホット → 最後にかけた日が古い順
export function segOrder(filters = {}) {
  const tail = `COALESCE(c.hot,0) DESC, ${LAST_TS} ASC NULLS FIRST, c.id`;
  const s = filters.sort && filters.sort !== "default" ? SEG_SORTS[filters.sort] : null;
  if (!s) return tail;
  const dir = filters.dir === "asc" || filters.dir === "desc" ? filters.dir : (s.dir || "asc");
  return `${s.sql.map((x) => `${x} ${dir.toUpperCase()} NULLS LAST`).join(", ")}, ${tail}`;
}
const arrParam = (v) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 80)).filter(Boolean).slice(0, 200) : []);
const numOrNull = (v) => { if (v === "" || v == null) return null; const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 && n < 1e6 ? n : null; };
// filters：{ source:[…], pref:[…], …, conds:["name",…], mode:"all"|"any", q, callsMin, callsMax, hireMin, hireMax, hideDnc, hideTouched, hideSfTouched }
//   → WHERE の部分。同じ軸の中はいつも「どれか」。軸どうしは mode="all"（既定）なら「すべて」、"any" なら「どれか」。
//   キーワードと「隠す」は mode によらずいつもかける。hideDnc は呼ぶ側が withBans で _banned（禁止に当たるリードの id）を入れておく
export function segWhere(filters, p) {
  const f = filters || {}; const w = []; const dim = [];
  for (const [k, d] of Object.entries(SEG_DIMS)) {
    const v = arrParam(f[k]); if (!v.length) continue;
    p.push(v);
    dim.push(d.multi ? `(COALESCE(NULLIF(${d.sql}, '{}'), ARRAY[${sqlLit(d.none || "不明")}]) && $${p.length}::text[])` : `(${d.sql}) = ANY($${p.length}::text[])`);
  }
  for (const c of arrParam(f.conds)) if (SEG_CONDS[c]) dim.push(SEG_CONDS[c].sql);
  const range = (expr, lo, hi) => { const a = numOrNull(lo), b = numOrNull(hi); if (a == null && b == null) return;
    const o = [`${expr} IS NOT NULL`]; if (a != null) { p.push(a); o.push(`${expr} >= $${p.length}`); } if (b != null) { p.push(b); o.push(`${expr} <= $${p.length}`); } dim.push(`(${o.join(" AND ")})`); };
  range("c.attempts", f.callsMin, f.callsMax);
  range(HIRE, f.hireMin, f.hireMax);
  if (dim.length) w.push(f.mode === "any" ? `(${dim.join(" OR ")})` : dim.join(" AND "));
  // キーワード：会社名・担当者・電話・メール（直した情報）・業種・所在地・リード元・企業調査・聞いたこと・担当・元のデータ・架電メモ・断り理由
  const q = String(f.q || "").trim().slice(0, 60).replace(/[\\%_]/g, (m) => `\\${m}`);
  if (q) { p.push(`%${q}%`); const i = p.length;
    w.push(`(concat_ws(' ', c.company, c.person, c.phone, c.info::text, c.seg->>'gyoshu', c.seg->>'gyokai', c.seg->>'pref', c.seg->>'city', c.seg->>'source', c.seg->>'issue', c.seg->>'ats',
      c.research::text, c.hearing::text, c.assigned_to, c.data::text) ILIKE $${i}
      OR EXISTS (SELECT 1 FROM mc_call_logs l WHERE l.lead_id = c.id AND NOT l.undone AND concat_ws(' ', l.memo, l.reason) ILIKE $${i}))`); }
  if (f.hideDnc && Array.isArray(f._banned) && f._banned.length) { p.push(f._banned); w.push(`NOT (c.id = ANY($${p.length}::int[]))`); }
  if (f.hideTouched) w.push(`(COALESCE(c.attempts,0) = 0 AND c.last_at IS NULL AND NULLIF(c.seg->>'extLast','') IS NULL)`);
  // 直近14日に SF で活動があり、それが SHOBO でかけた日より新しい（＝SHOBO 以外のだれかが触った）
  if (f.hideSfTouched) w.push(`NOT (NULLIF(c.seg->>'sfAct','') IS NOT NULL AND (c.seg->>'sfAct')::timestamptz > now() - interval '14 days'
      AND (c.last_at IS NULL OR (c.last_at AT TIME ZONE 'Asia/Tokyo')::date < ((c.seg->>'sfAct')::timestamptz AT TIME ZONE 'Asia/Tokyo')::date))`);
  return w;
}
// アプローチ禁止（DNC）は名簿をメモリで照らすので SQL では書けない。隠すときだけ、対象のリードを読んで当たるものの id を入れる
export async function withBans(filters, listIds) {
  const f = { ...(filters || {}) }; delete f._banned;
  if (!f.hideDnc) return f;
  await loadApproachBans();
  const rows = (await P().query(`SELECT id, company, phone, info, sf_lead_id FROM mc_call_leads WHERE list_id = ANY($1::int[]) AND NOT done`, [listIds])).rows;
  f._banned = rows.filter((r) => approachBanHitLeadSync(r)).map((r) => r.id);
  return f;
}

export function registerMcCall(app, deps) {
  const { isAdmin, sfActor, mochicaSet } = deps;
  startPlayPumps();
  startZoomSync();   // Zoom Phone の通話を DB に写して、番号で過去の通話を引けるようにする
  const isMcIntern = deps.isMcIntern || (async () => false);
  const me = (req) => String(req.user || "").toLowerCase();
  const guard = (fn) => async (req, res) => {
    try { if (!req.user) return res.status(401).json({ error: "ログインしてください" }); await ensure(); await fn(req, res); }
    catch (e) { console.error("[mccall]", req.path, e.message); res.status(500).json({ error: `うまくいきませんでした：${e.message}` }); }
  };
  // SF の活動（Task）をタイムラインの形で返す。読めなくても空で返す（架電の邪魔をしない）
  // 1件の記録を SF の活動（Task）に書く。結果は mc_call_logs の sf_task_id / sf_err に残す。
  //   SF のリードと結びついていない会社は書けないので「nolead」と残す（黙って書かないままにしない＝ルール5）。
  //   書き直し（/api/mccall/sf-retry）でも同じものを使う
  // リードに活動（Task）を書く。コンバート済みのリードには SF が活動を付けさせない（CANNOT_UPDATE_CONVERTED_LEAD）。
  //   断られたときだけコンバート先（取引先責任者＋商談か取引先）に付け替えて書き直す。
  //   毎回先に調べると SF の呼び出しが増えるので、断られたときだけ調べる（2026-11-20）
  async function leadTask(owner, data) {
    try { return await createTask(owner, data); }
    catch (e) {
      if (!/CANNOT_UPDATE_CONVERTED_LEAD/.test(String(e.message)) || !/^00Q/.test(String(data.WhoId || ""))) throw e;
      const l = ((await sfQuery(owner, `SELECT ConvertedContactId, ConvertedAccountId, ConvertedOpportunityId FROM Lead WHERE Id='${data.WhoId}'`)).records || [])[0];
      if (!l || (!l.ConvertedContactId && !l.ConvertedAccountId)) throw new Error("コンバート済みのリードで、コンバート先が SF で見つかりません。SF で取引先を確かめてください");
      const next = { ...data, WhoId: l.ConvertedContactId || undefined };
      if (!next.WhoId) delete next.WhoId;
      if (!next.WhatId) next.WhatId = l.ConvertedOpportunityId || l.ConvertedAccountId || undefined;
      if (!next.WhatId) delete next.WhatId;
      return createTask(owner, next);
    }
  }
  async function sfWrite(req, logId) {
    const g = (await P().query(`SELECT g.*, c.sf_lead_id FROM mc_call_logs g JOIN mc_call_leads c ON c.id=g.lead_id WHERE g.id=$1`, [logId])).rows[0];
    if (!g || g.undone || (g.sf_task_id && g.sf_fill_done)) return;
    if (!g.sf_lead_id || !/^00Q[0-9A-Za-z]{12,15}$/.test(g.sf_lead_id)) {
      await P().query(`UPDATE mc_call_logs SET sf_err='nolead' WHERE id=$1`, [logId]); return;
    }
    let owner;
    try { owner = await sfActor(req); }
    catch (e) { await P().query(`UPDATE mc_call_logs SET ${g.sf_task_id ? "sf_lead_err" : "sf_err"}=$2 WHERE id=$1`, [logId, String(e.message).slice(0, 300)]).catch(() => {}); return; }
    const d = new Date(new Date(g.created_at).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
    // 活動（Task）を先に書く。書き終えていれば（リードの項目だけ書き直すとき）飛ばす
    if (!g.sf_task_id) try {
      const names = await nameMap();
      const gt = g.gate || {}; const who = String(g.caller || "").toLowerCase();
      const t = await leadTask(owner, {
        WhoId: g.sf_lead_id, Subject: `[MOCHICA 架電] ${outcomeLabel(g.outcome)}`, Type: "Call", Status: "完了", ActivityDate: d,
        Description: [`記録した人：${names.get(who) || who}（SHOBO）`, `到達：${(REACH[g.reach] || {}).label || g.reach}`, `結果：${outcomeLabel(g.outcome)}${g.reason ? `（${g.reason}）` : ""}`,
          gt.name || gt.hours || gt.direct ? `受付で聞けたこと：${[gt.name && `担当 ${gt.name}`, gt.hours && `在席 ${gt.hours}`, gt.direct && `直通 ${gt.direct}`].filter(Boolean).join("・")}` : "",
          ...hearingLines(g.hearing),
          g.apo_at ? `アポ：${jstText(g.apo_at)}${g.apo_flow ? `（担当 FS：${g.apo_who || "未定"}）` : g.apo_who ? `（その時間に空いていたクローザー：${g.apo_who}）` : ""}` : "", g.next_at ? `次回：${jstText(g.next_at)}` : "", g.memo ? `メモ：${g.memo}` : "",
          g.apo_at && recLink(g.id) ? `通話の録音：${recLink(g.id)}` : "",
          g.cross_from ? `部署をまたいだ架電（${g.cross_from} のリード）` : ""].filter(Boolean).join("\n"),
      });
      if (!t || !t.id) throw new Error("SF から活動の番号が返ってきませんでした");
      await P().query(`UPDATE mc_call_logs SET sf_task_id=$2, sf_err=NULL WHERE id=$1`, [logId, t.id]);
    } catch (e) {
      console.error("[mccall] SF の活動を書けませんでした", logId, e.message);
      await P().query(`UPDATE mc_call_logs SET sf_err=$2 WHERE id=$1`, [logId, String(e.message).slice(0, 300)]).catch(() => {});
      return;
    }
    await sfLeadFill(owner, g, d);
  }
  // SF のリードの今の値（埋める項目だけ）。下書きを出すたびに読むと SF の呼び出しが増えるので2分だけ覚える。書いたら忘れる
  const _sfCur = new Map();
  async function sfCurrent(owner, leadId, fresh = false) {
    const c = _sfCur.get(leadId); if (!fresh && c && Date.now() - c.at < 120e3) return c.cur;
    // Status（リードの状況）も一緒に読む。架電中にリードの状況を変える欄で、今の値を出すため
    const cur = ((await sfQuery(owner, `SELECT ${[...new Set([...FILL_SOQL_FIELDS, "Status"])].join(", ")} FROM Lead WHERE Id='${leadId}'`)).records || [])[0];
    if (!cur) throw new Error("SF にこのリードが見つかりません（消されたか、統合された可能性があります）");
    _sfCur.set(leadId, { at: Date.now(), cur }); if (_sfCur.size > 500) _sfCur.delete(_sfCur.keys().next().value);
    return cur;
  }
  // SF のリードの今の Email（2026-11-24 浦田空調工業：SF にメールがあるのに画面に出なかった）。
  //   sfCurrent は2分覚えるので、開いたあとに読む「リードの状況」の欄と合わせても SF を読むのは1回。
  //   読めなかったときは理由を返して画面に出す（空のまま黙らない＝ルール5）
  async function sfMailOf(req, lead, sf) {
    const sfId = sfLeadIdOf(lead, sf); if (!sfId) return { email: "", err: "" };
    try {
      const cur = await Promise.race([sfCurrent(await sfActor(req), sfId), new Promise((_, ng) => setTimeout(() => ng(new Error("SF の返事が遅い")), 5000))]);
      return { email: String(cur.Email || "").trim(), err: "" };
    } catch (e) { return { email: "", err: `SF のリードのメールを読めませんでした（${String(e.message).slice(0, 60)}）` }; }
  }
  // 架電の内容（ヒアリング・受付で聞けたこと・断り理由・メモ）から埋める項目の候補。下書き（preview）と記録の両方で同じものを使う
  const fillCands = ({ hearing, gate, reason, outcome, memo }) => [...readInputs({ hearing, gate, reason, outcome }), ...readMemo(memo, { outcome })];
  // 架電の内容を SF のリードの項目に入れる（正本は SF。ルール3）。埋めた項目は1つずつ mc_sf_fills に残し、評価（レポート）に使う。
  //   書く値は記録のときに SF の今の値と比べ直して決める（下書きを出してから記録するまでに、ほかの人が直していることがあるため）。
  //   まとめて書けなければ1項目ずつ書き直し、書けなかった項目だけ sf_lead_err に残して画面に出す（黙って失敗しない＝ルール5）
  async function sfLeadFill(owner, g, day) {
    if (g.sf_fill_done) return;
    const done = (err) => P().query(`UPDATE mc_call_logs SET sf_fill_done=$2, sf_lead_err=$3 WHERE id=$1`, [g.id, !err, err ? String(err).slice(0, 300) : null]).catch(() => {});
    try {
      const cur = await sfCurrent(owner, g.sf_lead_id, true);
      if (cur.IsConverted) return done(null);   // コンバート済みのリードは SF が書き換えを断る。活動だけ残す
      await stageAfterCall(owner, g, cur);
      const plan = planFills(fillCands({ hearing: g.hearing, gate: g.gate, reason: g.reason, outcome: g.outcome, memo: g.memo }), cur, { day });
      const { fields, used } = pickedFields(plan, g.sf_pick || {});
      if (!used.length) return done(null);
      let ok = used, bad = [];
      try { await sfUpdateRecord(owner, "Lead", g.sf_lead_id, fields); }
      catch (e) {
        ok = []; for (const u of used) {
          try { await sfUpdateRecord(owner, "Lead", g.sf_lead_id, { [u.api]: u.send }); ok.push(u); }
          catch (e2) { bad.push(`${u.label}（${String(e2.message).replace(/^SF update d+: /, "").slice(0, 80)}）`); }
        }
      }
      _sfCur.delete(g.sf_lead_id);
      for (const u of ok) await P().query(`INSERT INTO mc_sf_fills (log_id, lead_id, sf_lead_id, caller, field, label, kind, src, old_val, new_val) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [g.id, g.lead_id, g.sf_lead_id, g.caller, u.api, u.label, u.kind, u.src, cur[u.api] == null ? null : String(cur[u.api]), String(u.send)]);
      return done(bad.length ? `SF のリードの項目を書けませんでした：${bad.join("、")}` : null);
    } catch (e) {
      console.error("[mccall] SF のリードの項目を書けませんでした", g.id, e.message);
      return done(e.message);
    }
  }
  // 架電の結果からリードの状況を自動で進める（2026-11-24 福井さん「架電後に自動でセールスステージも変更」）。
  //   どこまで進めるかは mcstage.js の autoStage（進めるだけで戻さない・99 は触らない）。
  //   コンバートでしか付けられない値（SF の LeadStatus で IsConverted）は書かない。失敗しても架電の記録と項目の書き込みは続ける
  async function stageAfterCall(owner, g, cur) {
    if (g.sf_stage) return;
    const to = autoStage({ reach: g.reach, outcome: g.outcome }, cur.Status);
    if (!to) return;
    try {
      const sv = await stageValues(owner); const val = sv.byCode.get(to);
      if (!val || sv.conv.has(val)) return;
      await sfUpdateRecord(owner, "Lead", g.sf_lead_id, { Status: val });
      await P().query(`UPDATE mc_call_logs SET sf_stage=$2 WHERE id=$1`, [g.id, { old: cur.Status || "", new: val }]);
      console.log(`[mccall] 架電のあとリードの状況を進めた log=${g.id} ${cur.Status || "（空）"}→${val}`);
      cur.Status = val; _sfCur.delete(g.sf_lead_id);
    } catch (e) {
      console.error("[mccall] リードの状況を進められませんでした", g.id, e.message);
      await P().query(`UPDATE mc_call_logs SET sf_stage=$2 WHERE id=$1`, [g.id, { err: String(e.message).slice(0, 200), want: to }]).catch(() => {});
    }
  }
  // 7つの番号 → SF に書く値。あわせて、コンバートでしか付けられない値（直接は書けない）を覚える。30分だけ覚える
  let _stVals = null;
  async function stageValues(owner) {
    if (_stVals && Date.now() - _stVals.at < 30 * 60e3) return _stVals.v;
    const opts = await statusPicklist(owner);
    const byCode = new Map(); for (const o of opts) { const c = stageCode(o.value) || stageCode(o.label); if (c && !byCode.has(c)) byCode.set(c, o.value); }
    const conv = new Set();
    try { for (const r of (await sfQuery(owner, `SELECT ApiName, MasterLabel FROM LeadStatus WHERE IsConverted = true`)).records || []) { if (r.ApiName) conv.add(r.ApiName); if (r.MasterLabel) conv.add(r.MasterLabel); } }
    catch (e) { throw new Error(`コンバート用のリードの状況を SF から読めませんでした（${String(e.message).slice(0, 80)}）`); }   // 読めないまま書くと、コンバートでしか付けられない値を書きに行くので止める（覚えもしない）
    _stVals = { at: Date.now(), v: { byCode, conv } }; return _stVals.v;
  }
  // SF に書けていない記録（書いている途中で止まった＝2分たっても結果が無いものも含む）。nolead は別に数える
  const SF_FAIL = `NOT g.undone AND g.sf_task_id IS NULL AND COALESCE(g.sf_err,'') <> 'nolead' AND (g.sf_err IS NOT NULL OR g.created_at < now() - interval '2 minutes')`;

  const adminOnly = (fn) => guard(async (req, res) => { if (!isAdmin(req)) return res.status(403).json({ error: "リストの管理は管理者だけができます" }); await fn(req, res); });

  // 時間帯ごとのつながりやすさ（MOCHICA の直近90日の記録から。掛け直しの時刻の選び方と、画面の「いま」に使う）。
  //   記録のたびに数え直すと重いので10分だけ覚えておく。数えられなかったときは資料の目安だけで進める（架電は止めない）
  let _rates = null;
  async function ratesNow() {
    if (_rates && Date.now() - _rates.at < 10 * 60e3) return _rates.v;
    let v;
    try {
      const rows = (await P().query(`SELECT EXTRACT(HOUR FROM created_at AT TIME ZONE 'Asia/Tokyo')::int AS hour, count(*) AS calls,
          count(*) FILTER (WHERE reach='person') AS person, count(*) FILTER (WHERE outcome='apo') AS apo
        FROM mc_call_logs WHERE NOT undone AND biz=$1 AND created_at >= now() - interval '90 days' GROUP BY 1`, [BIZ])).rows;
      v = hourRates(rows);
    } catch (e) { console.error("[mccall] 時間帯ごとの数字を読めませんでした", e.message); v = hourRates([]); }
    _rates = { at: Date.now(), v }; return v;
  }

  // 自分がかけてよいリスト（メンバー指定なし＝MOCHICA のメンバー全員。管理者はすべて見える）
  // withStock：保管のリスト（BALES から移したものなど）も入れる。管理者のリスト管理の画面だけ。かける順番・一覧には出さない
  async function myListIds(req, withStock = false) {
    return listIdsFor(me(req), { admin: isAdmin(req), withStock: !!(withStock && isAdmin(req)) });
  }
  // だれが・どのリストに入れるか（本人の画面と、管理者が見る「インサイドの『かける』の状態」で同じ判定を使う）
  async function listIdsFor(u, { admin = false, withStock = false } = {}) {
    const rows = (await P().query(`SELECT id, members FROM mc_call_lists WHERE biz=$1 AND NOT closed AND (NOT stock OR $2)`, [BIZ, !!withStock])).rows;
    if (admin) return rows.map((r) => r.id);
    // MOCHICA のインターン（インサイド8名など）も「MOCHICA 全員」のリストに入る（2026-11-18）
    const mc = await mochicaSet().catch(() => new Set());
    const all = mc.has(u) || (await isMcIntern(u).catch(() => false));
    return rows.filter((r) => (r.members && r.members.length ? r.members.map((x) => String(x).toLowerCase()).includes(u) : all)).map((r) => r.id);
  }

  // ---- リスト ----
  app.get("/api/mccall/lists", guard(async (req, res) => {
    const ids = await myListIds(req, req.query.stock === "1");
    const rows = ids.length ? (await P().query(`SELECT l.id, l.name, l.note, l.members, l.created_at, l.stock, l.bales_key, l.product,
        count(c.id) AS total, count(c.id) FILTER (WHERE NOT c.done) AS open,
        count(c.id) FILTER (WHERE NOT c.done AND (c.next_at IS NULL OR c.next_at <= now())) AS now,
        count(c.id) FILTER (WHERE c.cross_from IS NOT NULL) AS cross,
        (SELECT count(*) FROM mc_call_talks t WHERE t.list_id=l.id AND t.active) AS talks
      FROM mc_call_lists l LEFT JOIN mc_call_leads c ON c.list_id=l.id AND c.dup_of IS NULL WHERE l.id = ANY($1) GROUP BY l.id ORDER BY l.created_at DESC`, [ids])).rows : [];
    res.json({ ok: true, admin: isAdmin(req), items: rows.map((r) => ({ ...r, total: +r.total, open: +r.open, now: +r.now, cross: +r.cross, talks: +r.talks })) });
  }));
  app.post("/api/mccall/lists", adminOnly(async (req, res) => {
    const name = clip(req.body && req.body.name, 80); if (!name) return res.status(400).json({ error: "リストの名前を入れてください" });
    const members = Array.isArray(req.body.members) ? req.body.members.map((x) => String(x).toLowerCase()).slice(0, 200) : [];
    const r = (await P().query(`INSERT INTO mc_call_lists (name, note, members, created_by, product) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [name, clip(req.body.note, 400), members, me(req), productOf(req.body.product)])).rows[0];
    res.json({ ok: true, id: r.id });
  }));
  app.patch("/api/mccall/lists/:id", adminOnly(async (req, res) => {
    const id = parseInt(req.params.id, 10); const b = req.body || {};
    if (b.name != null) await P().query(`UPDATE mc_call_lists SET name=$2 WHERE id=$1`, [id, clip(b.name, 80) || "名前なし"]);
    if (Array.isArray(b.members)) await P().query(`UPDATE mc_call_lists SET members=$2 WHERE id=$1`, [id, b.members.map((x) => String(x).toLowerCase()).slice(0, 200)]);
    if (b.closed != null) await P().query(`UPDATE mc_call_lists SET closed=$2 WHERE id=$1`, [id, !!b.closed]);
    if (b.stock != null) await P().query(`UPDATE mc_call_lists SET stock=$2 WHERE id=$1`, [id, !!b.stock]);
    if (b.product != null) await P().query(`UPDATE mc_call_lists SET product=$2 WHERE id=$1`, [id, productOf(b.product)]);
    if (b.script != null) await P().query(`UPDATE mc_call_lists SET script=$2 WHERE id=$1`, [id, String(b.script).slice(0, 20000) || null]);
    res.json({ ok: true });
  }));
  // トークスクリプト（架電者も読む。管理者は上の PATCH で書く）
  app.get("/api/mccall/lists/:id/script", guard(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!(await myListIds(req)).includes(id)) return res.status(403).json({ error: "このリストはあなたの担当ではありません" });
    const r = (await P().query(`SELECT name, script FROM mc_call_lists WHERE id=$1`, [id])).rows[0];
    res.json({ ok: true, name: r ? r.name : "", script: (r && r.script) || "" });
  }));

  // ---- トーク（売り方）。リストごとに A/B/C の3本まで。直すたびに版を残す（2026-11-20 福井さん） ----
  app.get("/api/mccall/lists/:id/talks", adminOnly(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const hist = (await P().query(`SELECT t.label, t.ver, t.active, t.created_by, t.created_at, count(g.id) AS calls
      FROM mc_call_talks t LEFT JOIN mc_call_logs g ON g.talk_id=t.id AND NOT g.undone WHERE t.list_id=$1 GROUP BY t.id ORDER BY t.label, t.ver DESC`, [id])).rows;
    res.json({ ok: true, labels: TALK_LABELS, talks: await activeTalks(id), history: hist.map((h) => ({ ...h, calls: +h.calls })) });
  }));
  app.put("/api/mccall/lists/:id/talks", adminOnly(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const talks = await saveTalks(id, (req.body || {}).talks, me(req));
    res.json({ ok: true, talks });
  }));
  // ---- 施策（リスト×トーク×版）の数字。管理者は全員分、ほかの人は自分の分 ----
  app.get("/api/mccall/measures", guard(async (req, res) => {
    const dayOf = (s, def) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - 9 * 3600e3) : def; };
    const from = dayOf(req.query.from, jstDayStart(new Date(Date.now() - 29 * 86400e3)));
    const to = new Date(dayOf(req.query.to, jstDayStart()).getTime() + 86400e3);
    if (to - from > 370 * 86400e3 || to <= from) return res.status(400).json({ error: "期間は1日から1年までで選んでください" });
    res.json({ ok: true, from, to, all: isAdmin(req), research: researchState(), items: await measures({ from, to, caller: isAdmin(req) ? null : me(req) }) });
  }));
  // ---- 折り返しの着信（画面が数秒おきに見る） ----
  app.get("/api/mccall/inbound", guard(async (req, res) => { res.json({ ok: true, item: await inboundFor(me(req)) }); }));
  app.post("/api/mccall/inbound/:id/seen", guard(async (req, res) => {
    await P().query(`UPDATE mc_inbound SET seen=true WHERE id=$1 AND email=$2`, [parseInt(req.params.id, 10), me(req)]); res.json({ ok: true });
  }));

  // ---- リストの一覧（BALES の一覧画面のかわり。2026-11-18 福井さん） ----
  //   架電者が会社名・電話・担当者で探し、状態・温度・前回の結果で絞って、好きなリードを開けるように。
  //   見えるのは自分がかけてよいリストのうち、担当が空か自分のもの（管理者はすべて）。かける順番（/queue）と同じ考え方
  const BROWSE_SORT = { hot: "COALESCE(c.hot,0) DESC, c.id", last: "c.last_at DESC NULLS LAST, c.id", attempts: "c.attempts DESC, c.id", fewest: "c.attempts, COALESCE(c.hot,0) DESC, c.id", company: "c.company, c.id", next: "c.next_at NULLS LAST, c.id" };
  app.get("/api/mccall/browse", guard(async (req, res) => {
    const ids = await myListIds(req); const listId = parseInt(req.query.list, 10);
    const use = listId ? ids.filter((x) => x === listId) : ids;
    if (!use.length) return res.json({ ok: true, items: [], total: 0 });
    const w = ["c.list_id = ANY($1)", "c.dup_of IS NULL"]; const p = [use];
    if (!isAdmin(req)) { p.push(me(req)); w.push(`(c.assigned_to IS NULL OR c.assigned_to=$${p.length})`); }
    const st = String(req.query.st || "open");
    if (st === "open") w.push("NOT c.done"); else if (st === "now") w.push("NOT c.done AND (c.next_at IS NULL OR c.next_at <= now())");
    else if (st === "later") w.push("NOT c.done AND c.next_at > now()"); else if (st === "never") w.push("NOT c.done AND c.attempts = 0");
    else if (st === "done") w.push("c.done");
    const hot = parseInt(req.query.hot, 10); if (hot >= 1 && hot <= 3) { p.push(hot); w.push(`COALESCE(c.hot,0) >= $${p.length}`); }
    const oc = String(req.query.outcome || ""); if (oc && outcomeLabel(oc) !== oc) { p.push(oc); w.push(`c.last_outcome = $${p.length}`); }
    const q = String(req.query.q || "").normalize("NFKC").trim().slice(0, 60);
    if (q) {
      const dq = digits(q);
      p.push(`%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`); const a = p.length;
      const ors = [`c.company ILIKE $${a}`, `c.person ILIKE $${a}`, `c.gate->>'name' ILIKE $${a}`, `c.info::text ILIKE $${a}`];
      if (dq.length >= 3) { p.push(`%${dq}%`); ors.push(`regexp_replace(COALESCE(c.phone,''),'[^0-9]','','g') LIKE $${p.length}`); }
      w.push(`(${ors.join(" OR ")})`);
    }
    const where = w.join(" AND ");
    const total = +(await P().query(`SELECT count(*) FROM mc_call_leads c WHERE ${where}`, p)).rows[0].count;
    const page = Math.max(parseInt(req.query.page, 10) || 0, 0);
    const rows = (await P().query(`SELECT c.id, c.list_id, l.name AS list, c.company, c.person, c.phone, c.hot, c.attempts, c.last_at, c.last_outcome, c.next_at, c.done, c.assigned_to, c.cross_from,
        c.gate->>'name' AS gate_name, (c.locked_by IS NOT NULL AND c.locked_by <> $${p.length + 1} AND c.locked_at > now() - interval '10 minutes') AS busy
      FROM mc_call_leads c JOIN mc_call_lists l ON l.id=c.list_id WHERE ${where} ORDER BY ${BROWSE_SORT[req.query.sort] || BROWSE_SORT.hot} LIMIT 100 OFFSET ${page * 100}`, [...p, me(req)])).rows;
    const names = await nameMap();
    res.json({ ok: true, total, page, items: rows.map((r) => ({ ...r, outcome: outcomeLabel(r.last_outcome), assigned: r.assigned_to ? names.get(r.assigned_to) || r.assigned_to : "" })) });
  }));

  // ---- レポート（期間・人・リスト・日ごと）（2026-11-18 福井さん。BALES のレポートのかわり） ----
  //   数えるのは SHOBO で記録した架電だけ（Bales で記録した過去の架電は入らない）。取り消した記録は数えない。
  //   管理者は全員分、ほかの人は自分の分だけ
  app.get("/api/mccall/report", guard(async (req, res) => {
    const dayOf = (s, def) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - 9 * 3600e3) : def; };
    const from = dayOf(req.query.from, jstDayStart(new Date(Date.now() - 6 * 86400e3)));
    const to = new Date(dayOf(req.query.to, jstDayStart()).getTime() + 86400e3);
    if (to - from > 370 * 86400e3 || to <= from) return res.status(400).json({ error: "期間は1日から1年までで選んでください" });
    const by = ["user", "list", "day"].includes(req.query.by) ? req.query.by : "user";
    const key = { user: "g.caller", list: "g.list_id::text", day: "to_char(g.created_at AT TIME ZONE 'Asia/Tokyo','YYYY-MM-DD')" }[by];
    const p = [from, to]; let w = "NOT g.undone AND g.created_at >= $1 AND g.created_at < $2";
    if (!isAdmin(req)) { p.push(me(req)); w += ` AND g.caller=$${p.length}`; }
    const listId = parseInt(req.query.list, 10); if (listId) { p.push(listId); w += ` AND g.list_id=$${p.length}`; }
    const cols = `count(*) AS calls, count(*) FILTER (WHERE g.reach <> 'none') AS reached, count(*) FILTER (WHERE g.reach='person') AS person,
      count(*) FILTER (WHERE g.outcome='apo') AS apo, count(*) FILTER (WHERE g.outcome='doc_send') AS doc, count(*) FILTER (WHERE g.outcome='follow') AS follow,
      count(*) FILTER (WHERE g.outcome='reject') AS reject, count(*) FILTER (WHERE g.cross_from IS NOT NULL) AS cross, count(DISTINCT g.lead_id) AS leads`;
    const num = (r) => { const o = {}; for (const k of ["calls", "reached", "person", "apo", "doc", "follow", "reject", "cross", "leads"]) o[k] = +r[k]; return o; };
    const rows = (await P().query(`SELECT ${key} AS k, ${cols} FROM mc_call_logs g WHERE ${w} GROUP BY 1 ORDER BY 1`, p)).rows;
    const tot = (await P().query(`SELECT ${cols} FROM mc_call_logs g WHERE ${w}`, p)).rows[0];
    // 前の同じ長さの期間（2026-11-23 福井さん：レポートは「ふり返る」画面なので、良くなったか悪くなったかが分かるように）。
    //   絞り込み（人・リスト）は同じで、日付の2つだけを入れ替える
    const span = to - from;
    const prev = (await P().query(`SELECT ${cols} FROM mc_call_logs g WHERE ${w}`, [new Date(from.getTime() - span), from, ...p.slice(2)])).rows[0];
    const reasons = (await P().query(`SELECT g.reason AS k, count(*) AS n FROM mc_call_logs g WHERE ${w} AND g.outcome='reject' GROUP BY 1 ORDER BY 2 DESC`, p)).rows.map((r) => ({ k: r.k || "（理由なし）", n: +r.n }));
    // 受付で断られた文句（担当者の断り理由と同じ形で数える）
    const gateReasons = (await P().query(`SELECT g.reason AS k, count(*) AS n FROM mc_call_logs g WHERE ${w} AND g.outcome='blocked' GROUP BY 1 ORDER BY 2 DESC`, p)).rows.map((r) => ({ k: r.k || "（文句なし）", n: +r.n }));
    // リストへの貢献（2026-11-20 福井さん「アポが取れなくても、ヒアリングでリストを埋めた・鮮度と精度を保った貢献を SF の項目をどれだけ埋めたかで」）
    //   埋めた＝空の項目を埋めた／直した＝古い値を新しくした・長文に足した／会社＝項目を1つでも埋めた会社の数／アポ以外＝アポにならなかった架電で埋めた数／
    //   使えない番号＝「番号が使えない」と記録した数（死んだ番号を見つけるのも精度の貢献）
    const fcols = `count(f.id) AS fill, count(f.id) FILTER (WHERE f.kind='new') AS fill_new, count(f.id) FILTER (WHERE f.kind IN ('update','add')) AS fill_fix,
      count(DISTINCT f.lead_id) AS fill_leads, count(f.id) FILTER (WHERE g.outcome <> 'apo') AS fill_noapo`;
    const fnum = (r) => ({ fill: +(r && r.fill) || 0, fillNew: +(r && r.fill_new) || 0, fillFix: +(r && r.fill_fix) || 0, fillLeads: +(r && r.fill_leads) || 0, fillNoApo: +(r && r.fill_noapo) || 0 });
    const fjoin = `FROM mc_sf_fills f JOIN mc_call_logs g ON g.id=f.log_id WHERE NOT f.undone AND ${w}`;
    const frows = new Map((await P().query(`SELECT ${key} AS k, ${fcols} ${fjoin} GROUP BY 1`, p)).rows.map((r) => [String(r.k), fnum(r)]));
    const ftot = fnum((await P().query(`SELECT ${fcols} ${fjoin}`, p)).rows[0]);
    const inv = new Map((await P().query(`SELECT ${key} AS k, count(*) AS n FROM mc_call_logs g WHERE ${w} AND g.outcome='invalid' GROUP BY 1`, p)).rows.map((r) => [String(r.k), +r.n]));
    const fields = (await P().query(`SELECT f.label AS k, count(*) AS n ${fjoin} GROUP BY 1 ORDER BY 2 DESC`, p)).rows.map((r) => ({ k: r.k, n: +r.n }));
    const fx = (k) => ({ ...(frows.get(String(k)) || fnum(null)), invalid: inv.get(String(k)) || 0 });
    const names = await nameMap();
    const lists = by === "list" ? new Map((await P().query(`SELECT id::text AS id, name FROM mc_call_lists`)).rows.map((r) => [r.id, r.name])) : null;
    const label = (k) => by === "user" ? names.get(String(k || "").toLowerCase()) || k : by === "list" ? lists.get(k) || `リスト ${k}` : k;
    res.json({ ok: true, by, from, to, all: isAdmin(req), days: Math.round(span / 86400e3), prev: num(prev), total: { ...num(tot), ...ftot, invalid: [...inv.values()].reduce((a, b) => a + b, 0) }, reasons, gateReasons, fields,
      rows: rows.map((r) => ({ key: r.k, label: label(r.k), ...num(r), ...fx(r.k) })).sort((a, b) => by === "day" ? 0 : b.calls - a.calls) });
  }));

  // ---- リードの割り振り・他のリストへ移す（2026-11-17 福井さん。kinbot の利用状況で kincall の
  //      「複数人に分ける／この人たちに割り振る」約830回・「他のリストへ移す」85回/30日 と多く使われていたため） ----
  // かける順番（/queue）は assigned_to が空か自分のものだけ出すので、ここで assigned_to を埋めれば担当ごとに分かれる。
  const leadIdsOf = (b) => (Array.isArray(b && b.leadIds) ? b.leadIds.map((x) => parseInt(x, 10)).filter((x) => x > 0).slice(0, 5000) : []);
  app.get("/api/mccall/lists/:id/leads", adminOnly(async (req, res) => {
    const id = parseInt(req.params.id, 10); const names = await nameMap();
    const rows = (await P().query(`SELECT id, company, person, hot, attempts, last_outcome, next_at, assigned_to FROM mc_call_leads
      WHERE list_id=$1 AND NOT done AND dup_of IS NULL ORDER BY COALESCE(hot,0) DESC, id LIMIT 3000`, [id])).rows;
    const total = +(await P().query(`SELECT count(*) FROM mc_call_leads WHERE list_id=$1 AND NOT done AND dup_of IS NULL`, [id])).rows[0].count;
    res.json({ ok: true, total, items: rows.map((r) => ({ ...r, outcome: outcomeLabel(r.last_outcome), assigned: r.assigned_to ? names.get(r.assigned_to) || r.assigned_to : "" })) });
  }));
  // 選んだリード（選ばなければ、このリストの終わっていないリード全部）を、選んだ人で均等に分ける。
  // ホットな順に1件ずつ交互に配る（先頭からまとめて配るとホットが1人に偏るため）。だれも選ばなければ担当を外す。
  app.post("/api/mccall/lists/:id/assign", adminOnly(async (req, res) => {
    const id = parseInt(req.params.id, 10); const b = req.body || {};
    const l = (await P().query(`SELECT members FROM mc_call_lists WHERE id=$1`, [id])).rows[0];
    if (!l) return res.status(404).json({ error: "リストが見つかりません" });
    const members = [...new Set((Array.isArray(b.members) ? b.members : []).map((x) => String(x).toLowerCase().trim()).filter(Boolean))].slice(0, 100);
    // リストにメンバーが決まっているのに、その外の人に配ると、その人の「かける」にリストが出ず宙に浮く
    if (l.members && l.members.length) {
      const out = members.filter((m) => !l.members.map((x) => String(x).toLowerCase()).includes(m));
      if (out.length) return res.status(400).json({ error: "このリストのメンバーに入っていない人がいます。先に「メンバー」で足してください" });
    }
    const ids = leadIdsOf(b);
    // 条件で割り振る（filters）：kincall の「ソースから配る」「グループから配る」と同じく、条件に合うリードだけを、1人 per 件まで配る。
    //   onlyFree…まだだれにも割り振っていないものだけ。dryRun…配らずに件数だけ返す（画面の「試算」）。
    //   並びは ホット → 最後にかけた日が古い（かけていないものが先）→ 取り込んだ順。kincall の distributeGroupLeads と同じ「古いものから」
    const filters = b.filters && typeof b.filters === "object" ? await withBans(b.filters, [id]) : null;
    const per = Math.max(0, Math.min(5000, parseInt(b.per, 10) || 0));
    if (filters) await refreshSeg(id);
    const p = [id]; const w = ["c.list_id=$1", "NOT c.done", "c.dup_of IS NULL"];
    if (ids.length) { p.push(ids); w.push(`c.id = ANY($${p.length})`); }
    if (filters) w.push(...segWhere(filters, p));
    if (b.onlyFree) w.push("c.assigned_to IS NULL");
    const rows = (await P().query(`SELECT c.id FROM mc_call_leads c WHERE ${w.join(" AND ")}
      ORDER BY ${segOrder(filters || {})}`, p)).rows;
    if (!rows.length) {
      if (b.dryRun) return res.json({ ok: true, dryRun: true, matched: 0, assigned: 0, per: [] });
      return res.status(400).json({ error: filters ? "条件に合うリードがありません。条件をゆるめてください" : "分けるリードがありません（終わったリードは分けません）" });
    }
    const names = await nameMap();
    if (!members.length) {
      if (b.dryRun) return res.json({ ok: true, dryRun: true, matched: rows.length, cleared: rows.length, per: [] });
      const x = await P().query(`UPDATE mc_call_leads SET assigned_to=NULL WHERE id = ANY($1)`, [rows.map((r) => r.id)]);
      return res.json({ ok: true, cleared: x.rowCount, per: [] });
    }
    // ホットな順に1件ずつ交互に配る（先頭からまとめて配るとホットが1人に偏るため）。per があればそこで止める
    const take = per ? rows.slice(0, per * members.length) : rows;
    const buckets = members.map(() => []);
    take.forEach((r, i) => buckets[i % members.length].push(r.id));
    const plan = members.map((m, i) => ({ name: names.get(m) || m, n: buckets[i].length }));
    if (b.dryRun) return res.json({ ok: true, dryRun: true, matched: rows.length, assigned: take.length, per: plan });
    for (let i = 0; i < members.length; i++) if (buckets[i].length) await P().query(`UPDATE mc_call_leads SET assigned_to=$2 WHERE id = ANY($1)`, [buckets[i], members[i]]);
    if (filters) console.log(`[mccall] リスト${id}を条件で割り振り：${take.length}件（条件に合う${rows.length}件）→ ${plan.map((x) => `${x.name}${x.n}`).join("・")} 条件=${JSON.stringify(filters).slice(0, 300)} by ${me(req)}`);
    res.json({ ok: true, matched: rows.length, assigned: take.length, per: plan });
  }));
  // 条件で割り振るときの、軸ごとの件数（残り・そのうちまだ割り振っていない数）。filters を渡すと、その条件で絞った中での件数
  app.post("/api/mccall/lists/:id/segments", adminOnly(async (req, res) => {
    const id = parseInt(req.params.id, 10); const b = req.body || {};
    // pool：このリストではなく、SHOBO のほかのリスト（保管も含む）を数える＝「SHOBO から足す」の候補（2026-11-19）
    const scope = b.pool ? await poolIds(id, b.from) : [id];
    const filled = await refreshSeg(scope);
    const filters = await withBans(b.filters && typeof b.filters === "object" ? b.filters : {}, scope);
    const base = poolBase(!!b.pool);
    // CSV（2026-11-20）：いまの条件と並び順のまま、合うリードを全部（2万件まで）返す。画面で CSV にする
    if (b.csv) {
      const p = [scope]; const w = [...base, ...segWhere(filters, p)];
      const cols = ["origin", "list", "source", "stage", "gyokai", "gyoshu", "pref", "city", "owner", "research", "phone", "competitor", "due", "followup", "lastResult", "decline", "last", "hot", "budget", "renewal", "lost"];
      const rows = (await P().query(`SELECT c.id, c.company, c.person, c.phone, c.attempts, c.next_at, ${LAST_TS} AS last_ts, ${cols.map((k) => `${SEG_DIMS[k].sql} AS "${k}"`).join(", ")},
          array_to_string(${SEG_DIMS.roles.sql}, '・') AS roles, array_to_string(${SEG_DIMS.pains.sql}, '・') AS pains, array_to_string(${SEG_DIMS.segments.sql}, '・') AS segments
        FROM mc_call_leads c WHERE ${w.join(" AND ")} ORDER BY ${segOrder(filters)} LIMIT 20000`, p)).rows;
      const names = await nameMap();
      for (const r of rows) if (r.owner && names.has(r.owner)) r.owner = names.get(r.owner);
      return res.json({ ok: true, rows, labels: Object.fromEntries([...cols, "roles", "pains", "segments"].map((k) => [k, SEG_DIMS[k].label])) });
    }
    // 軸ごとに「その軸以外の条件」で数える（同じ軸の中で選び足せるように。EC サイトの絞り込みと同じ考え方）。
    //   「どれか」（mode=any）のときは、ほかの軸を足すほど増える向きなので、キーワードと「隠す」だけをかけて数える
    const only = (k) => (filters.mode === "any" ? { q: filters.q, hideDnc: filters.hideDnc, _banned: filters._banned, hideTouched: filters.hideTouched, hideSfTouched: filters.hideSfTouched } : { ...filters, [k]: [] });
    const names = await nameMap();
    const dims = {};
    await Promise.all(Object.entries(SEG_DIMS).map(async ([k, d]) => {
      if (d.poolOnly && !b.pool) return;
      const p = [scope]; const w = [...base, ...segWhere(only(k), p)];
      const vx = d.multi ? `v` : d.sql;
      const from = d.multi ? `mc_call_leads c, LATERAL unnest(COALESCE(NULLIF(${d.sql}, '{}'), ARRAY[${sqlLit(d.none || "不明")}])) AS v` : `mc_call_leads c`;
      const rows = (await P().query(`SELECT ${vx} AS v, count(*) AS n, count(*) FILTER (WHERE c.assigned_to IS NULL) AS free
        FROM ${from} WHERE ${w.join(" AND ")} GROUP BY 1 ORDER BY 2 DESC LIMIT 120`, p)).rows.map((r) => ({ v: r.v, n: +r.n, free: +r.free, ...(d.names && names.has(r.v) ? { label: names.get(r.v) } : {}) }));
      if (d.order) rows.sort((a, c) => (d.order.indexOf(a.v) + 1 || 99) - (d.order.indexOf(c.v) + 1 || 99));
      dims[k] = { label: d.label, items: rows, ...(d.needs ? { needs: d.needs } : {}) };
    }));
    const p = [scope]; const w = [...base, ...segWhere(only("conds"), p)];
    const cr = (await P().query(`SELECT ${Object.entries(SEG_CONDS).map(([k, c]) => `count(*) FILTER (WHERE ${c.sql}) AS ${k}`).join(", ")} FROM mc_call_leads c WHERE ${w.join(" AND ")}`, p)).rows[0];
    const conds = Object.entries(SEG_CONDS).map(([k, c]) => ({ k, label: c.label, n: +cr[k] }));
    const p2 = [scope]; const w2 = [...base, ...segWhere(filters, p2)];
    const t = (await P().query(`SELECT count(*) AS n, count(*) FILTER (WHERE c.assigned_to IS NULL) AS free,
        count(*) FILTER (WHERE c.seg->>'prefBy' = '電話') AS pref_tel FROM mc_call_leads c WHERE ${w2.join(" AND ")}`, p2)).rows[0];
    res.json({ ok: true, filled, matched: +t.n, free: +t.free, prefByTel: +t.pref_tel, banned: filters.hideDnc ? (filters._banned || []).length : null, dims, conds,
      sorts: Object.entries(SEG_SORTS).map(([k, s]) => ({ k, label: s.label })) });
  }));
  // 「SHOBO から足す」の元：このリスト以外の、閉じていない MOCHICA のリスト（保管も含む）。from で絞れる
  async function poolIds(id, from) {
    const want = (Array.isArray(from) ? from : []).map((x) => parseInt(x, 10)).filter((x) => x > 0);
    const rows = (await P().query(`SELECT id FROM mc_call_lists WHERE biz=$1 AND NOT closed AND id <> $2`, [BIZ, id])).rows.map((r) => r.id);
    return want.length ? rows.filter((x) => want.includes(x)) : rows;
  }
  // 数える・選ぶときの決まり。持ってくるときは、いま架電中（10分以内に開いた）のリードは動かさない
  const poolBase = (pool) => ["c.list_id = ANY($1::int[])", "NOT c.done", "c.dup_of IS NULL", ...(pool ? ["(c.locked_by IS NULL OR c.locked_at < now() - interval '10 minutes')"] : [])];

  // SHOBO から足す（2026-11-19 福井さん「SF・BALES・SHOBO からリードを追加できる形式」）：
  //   SHOBO のほかのリスト（BALES から移した保管のリストなど）から、条件に合うリードをこのリストへ移す。
  //   リードは MOCHICA 全体で1件だけ（重複させない決まり）なので、写すのではなく移す。担当は外す。架電の記録はそのまま
  app.post("/api/mccall/lists/:id/from-shobo", adminOnly(async (req, res) => {
    const id = parseInt(req.params.id, 10); const b = req.body || {};
    const t = (await P().query(`SELECT id, closed FROM mc_call_lists WHERE id=$1`, [id])).rows[0];
    if (!t || t.closed) return res.status(404).json({ error: "リストが見つからないか、閉じています" });
    const scope = await poolIds(id, b.from);
    if (!scope.length) return res.status(400).json({ error: "持ってくる元のリストがありません" });
    await refreshSeg(scope);
    const lim = Math.max(1, Math.min(20000, parseInt(b.limit, 10) || 300));
    const filters = await withBans(b.filters && typeof b.filters === "object" ? b.filters : {}, scope);
    const p = [scope]; const w = [...poolBase(true), ...segWhere(filters, p)];
    if (b.onlyFree) w.push("c.assigned_to IS NULL");
    const where = w.join(" AND ");
    const matched = +(await P().query(`SELECT count(*) FROM mc_call_leads c WHERE ${where}`, p)).rows[0].count;
    if (b.dryRun) return res.json({ ok: true, dryRun: true, matched, moving: Math.min(matched, lim) });
    if (!matched) return res.status(400).json({ error: "条件に合うリードがありません。条件をゆるめてください" });
    p.push(id); const to = p.length; p.push(lim); const L = p.length;
    const x = await P().query(`UPDATE mc_call_leads SET list_id=$${to}, assigned_to=NULL, locked_by=NULL, locked_at=NULL WHERE id IN (
        SELECT c.id FROM mc_call_leads c WHERE ${where}
          AND NOT EXISTS (SELECT 1 FROM mc_call_leads d WHERE d.list_id=$${to} AND d.src=c.src AND d.src_key=c.src_key)
        ORDER BY ${segOrder(filters)} LIMIT $${L})`, p);
    console.log(`[mccall] SHOBO のほかのリストから リスト${id} へ ${x.rowCount}件（条件に合う${matched}件）条件=${JSON.stringify(b.filters || {}).slice(0, 300)} by ${me(req)}`);
    res.json({ ok: true, matched, moved: x.rowCount });
  }));
  // 選んだリードを他の開いているリストへ移す。移し先に同じリードがあるものは二重にしないため移さず、件数を返す。
  // 担当は外す（移し先のメンバーでない人に付いたままだと、だれの順番にも出なくなるため）。過去の架電記録はそのまま残す。
  app.post("/api/mccall/lists/:id/move", adminOnly(async (req, res) => {
    const id = parseInt(req.params.id, 10); const b = req.body || {};
    const to = parseInt(b.toListId, 10); const ids = leadIdsOf(b);
    if (!ids.length) return res.status(400).json({ error: "移すリードを選んでください" });
    if (!to || to === id) return res.status(400).json({ error: "移し先のリストを選んでください" });
    const t = (await P().query(`SELECT id, closed FROM mc_call_lists WHERE id=$1`, [to])).rows[0];
    if (!t || t.closed) return res.status(400).json({ error: "移し先のリストが見つからないか、閉じています" });
    const x = await P().query(`UPDATE mc_call_leads c SET list_id=$2, assigned_to=NULL, locked_by=NULL, locked_at=NULL
      WHERE c.list_id=$1 AND c.id = ANY($3) AND NOT EXISTS (SELECT 1 FROM mc_call_leads d WHERE d.list_id=$2 AND d.src=c.src AND d.src_key=c.src_key)`, [id, to, ids]);
    res.json({ ok: true, moved: x.rowCount, skipped: ids.length - x.rowCount });
  }));

  // ---- リード管理（2026-11-20 福井さん「リードの種類がそれぞれ今何件あって、誰にどれだけ割り振っているのか分からない。kincall 準拠で」） ----
  //   kincall のリスト管理の「ソース」タブ（ソースごとの件数・担当別・アポ率・メンバーに配る）と「リスト」タブ（人ごとの残り）を MOCHICALL の形にしたもの。
  //   種類＝取り込み元（SF・BALES・SHOBO（CSV）・DOC）× リードソース。式は「条件で割り振る」（SEG_DIMS）と同じものを使う（画面ごとに数が食い違わないように）。
  //   数えるのは閉じていないリストの、終わっていない・重複で止めていないリード。保管のリストはだれの「かける」にも出ないので「保管」として別に数える。
  const T_ORIGIN = SEG_DIMS.origin.sql, T_SOURCE = SEG_DIMS.source.sql;
  // 画面から来た「どの種類か」→ WHERE。"all"／"o:取り込み元"／"s:取り込み元|リードソース" のどれか（いくつでも。どれかに当てはまるもの）。
  //   取り込み元には「|」が入らないので、最初の「|」で分ける（リードソースの側に「|」があっても崩れない）。
  //   全部を対象にするのは "all" をはっきり送ったときだけ。空や読めない指定は「どれにも当てはまらない」にする（うっかり全件を配らないため）
  function scopeWhere(keys, p) {
    const ks = (Array.isArray(keys) ? keys : [keys]).map((k) => String(k || "").slice(0, 200)).filter(Boolean).slice(0, 100);
    if (ks.includes("all")) return "true";
    const ors = [];
    for (const k of ks) {
      if (k.startsWith("o:")) { p.push(k.slice(2)); ors.push(`(${T_ORIGIN}) = $${p.length}`); }
      else if (k.startsWith("s:")) { const i = k.indexOf("|"); if (i < 0) continue; p.push(k.slice(2, i)); const a = p.length; p.push(k.slice(i + 1)); ors.push(`((${T_ORIGIN}) = $${a} AND (${T_SOURCE}) = $${p.length})`); }
    }
    return ors.length ? `(${ors.join(" OR ")})` : "false";
  }
  // 種類の計算（seg）が終わっていないリードを、画面を待たせない範囲で埋める。残りは裏で続ける（同時に2つは走らせない）
  let segFilling = null;
  async function fillSeg(ids) {
    await refreshSeg(ids, { budgetMs: 8000 });
    const pend = +(await P().query(`SELECT count(*) FROM mc_call_leads c WHERE c.list_id = ANY($1) AND NOT c.done AND c.dup_of IS NULL AND (c.seg IS NULL OR COALESCE((c.seg->>'v')::int,0) < $2)`, [ids, SEG_V])).rows[0].count;
    if (pend && !segFilling) segFilling = refreshSeg(ids).catch((e) => console.error("[mccall] 種類の計算を続けられませんでした", e.message)).finally(() => { segFilling = null; });
    return pend;
  }
  app.get("/api/mccall/sources", adminOnly(async (req, res) => {
    const lists = (await P().query(`SELECT id, name, stock, members FROM mc_call_lists WHERE biz=$1 AND NOT closed ORDER BY stock, created_at DESC`, [BIZ])).rows;
    const ids = lists.map((l) => l.id);
    const pending = ids.length ? await fillSeg(ids) : 0;
    const rows = ids.length ? (await P().query(`SELECT ${T_ORIGIN} AS origin, ${T_SOURCE} AS source, c.list_id, lower(COALESCE(c.assigned_to,'')) AS who,
        count(*) AS n,
        count(*) FILTER (WHERE ${LAST_TS} IS NULL) AS untouched,
        count(*) FILTER (WHERE c.next_at IS NULL OR c.next_at <= now()) AS nowc,
        count(*) FILTER (WHERE COALESCE(c.hot,0) >= 3) AS hot3, count(*) FILTER (WHERE COALESCE(c.hot,0) = 2) AS hot2,
        count(*) FILTER (WHERE c.locked_by IS NULL OR c.locked_at < now() - interval '10 minutes') AS unlocked
      FROM mc_call_leads c WHERE c.list_id = ANY($1) AND NOT c.done AND c.dup_of IS NULL GROUP BY 1, 2, 3, 4`, [ids])).rows : [];
    const lmap = new Map(lists.map((l) => [l.id, l]));
    const blank = () => ({ n: 0, stock: 0, untouched: 0, free: 0, dist: 0, now: 0, hot: [0, 0, 0], by: {} });
    // n・未架電・今かける・温度・担当別は「かける対象のリスト」の分だけ。保管は stock に件数だけ（配るときは入れるリストを選んで移す）
    const addTo = (o, r, st) => {
      const n = +r.n;
      if (st) { o.stock += n; return; }
      o.n += n; o.untouched += +r.untouched; o.now += +r.nowc;
      o.hot[0] += +r.hot3; o.hot[1] += +r.hot2; o.hot[2] += n - +r.hot3 - +r.hot2;
      if (!r.who) { o.free += n; o.dist += +r.unlocked; }
      o.by[r.who] = (o.by[r.who] || 0) + n;
    };
    const all = { key: "all", ...blank() }; const origins = new Map(), types = new Map(), tl = new Map(), members = new Map();
    for (const r of rows) {
      const l = lmap.get(r.list_id); if (!l) continue; const st = !!l.stock; const k = `${r.origin}|${r.source}`;
      if (!types.has(k)) types.set(k, { key: k, origin: r.origin, source: r.source, ...blank() });
      if (!origins.has(r.origin)) origins.set(r.origin, { key: r.origin, ...blank() });
      addTo(types.get(k), r, st); addTo(origins.get(r.origin), r, st); addTo(all, r, st);
      // 種類 × リスト（保管のリストも。dist は未割り当てで、いま開かれていないもの）
      const lk = `${k}#${l.id}`;
      if (!tl.has(lk)) tl.set(lk, { type: k, id: l.id, name: l.name, stock: st, n: 0, untouched: 0, dist: 0, by: {} });
      const x = tl.get(lk); x.n += +r.n; x.untouched += +r.untouched; if (!r.who) x.dist += +r.unlocked; x.by[r.who] = (x.by[r.who] || 0) + +r.n;
      if (!r.who) continue;
      // 人ごと。保管のリストの担当と、リストのメンバーに入っていない人の担当は、その人の「かける」に出ないので別に数えて知らせる
      if (!members.has(r.who)) members.set(r.who, { email: r.who, n: 0, now: 0, untouched: 0, stock: 0, hidden: 0, byType: {} });
      const m = members.get(r.who);
      if (st) { m.stock += +r.n; continue; }
      m.n += +r.n; m.now += +r.nowc; m.untouched += +r.untouched; m.byType[k] = (m.byType[k] || 0) + +r.n;
      const mem = (l.members || []).map((e) => String(e).toLowerCase());
      if (mem.length && !mem.includes(r.who)) m.hidden += +r.n;
    }
    // アポ率（直近3か月。MOCHICALL で記録した架電だけ）：種類・取り込み元・全体ごとに、人ごと・月ごとも。リストごとは「種類#リスト」
    const nowJ = new Date(Date.now() + 9 * 3600e3);
    const months = [2, 1, 0].map((k) => { const d = new Date(Date.UTC(nowJ.getUTCFullYear(), nowJ.getUTCMonth() - k, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; });
    const since = new Date(Date.UTC(+months[0].slice(0, 4), +months[0].slice(5) - 1, 1) - 9 * 3600e3);
    const lr = (await P().query(`SELECT ${T_ORIGIN} AS origin, ${T_SOURCE} AS source, g.list_id, lower(COALESCE(g.caller,'')) AS caller,
        to_char(g.created_at AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM') AS ym, count(*) AS calls, count(*) FILTER (WHERE g.outcome='apo') AS apos
      FROM mc_call_logs g JOIN mc_call_leads c ON c.id = g.lead_id
      WHERE NOT g.undone AND g.biz=$1 AND g.created_at >= $2 GROUP BY 1, 2, 3, 4, 5`, [BIZ, since])).rows;
    const mk = () => ({ calls: 0, apos: 0, m: {}, mem: {} });
    const add = (o, r) => {
      const c = +r.calls, a = +r.apos; o.calls += c; o.apos += a;
      const x = o.m[r.ym] || (o.m[r.ym] = { calls: 0, apos: 0 }); x.calls += c; x.apos += a;
      if (r.caller) { const y = o.mem[r.caller] || (o.mem[r.caller] = { calls: 0, apos: 0 }); y.calls += c; y.apos += a; }
    };
    const R = { months, byType: {}, byOrigin: {}, all: mk(), byList: {} };
    for (const r of lr) {
      const k = `${r.origin}|${r.source}`;
      add(R.byType[k] || (R.byType[k] = mk()), r); add(R.byOrigin[r.origin] || (R.byOrigin[r.origin] = mk()), r); add(R.all, r);
      const b = R.byList[`${k}#${r.list_id}`] || (R.byList[`${k}#${r.list_id}`] = { calls: 0, apos: 0 }); b.calls += +r.calls; b.apos += +r.apos;
    }
    const names = await nameMap(); const nm = {};
    for (const e of new Set([...members.keys(), ...lr.map((r) => r.caller)])) if (e) nm[e] = names.get(e) || e;
    const ORD = SEG_DIMS.origin.order; const oi = (k) => { const i = ORD.indexOf(k); return i < 0 ? 99 : i; };
    res.json({ ok: true, pending, all, names: nm, rates: R,
      origins: [...origins.values()].sort((a, b) => oi(a.key) - oi(b.key)),
      types: [...types.values()].sort((a, b) => (b.n + b.stock) - (a.n + a.stock)),
      typeLists: [...tl.values()].sort((a, b) => b.n - a.n),
      members: [...members.values()].sort((a, b) => b.n - a.n),
      lists: lists.map((l) => ({ id: l.id, name: l.name, stock: !!l.stock, members: (l.members || []).map((e) => String(e).toLowerCase()) })) });
  }));
  // 種類から配る・足す（kincall の「ソースからメンバーに配る」と同じ考え方。先に dryRun で配分を見せてから配る）。
  //   from：'' は未割り当てのもの、メールならその人の担当分。n 件まで。
  //   mode：equal（均等）／rate（この種類での直近60日のアポ率に応じて。20コール未満の人は平均扱い・アポ率0でも平均の3割は配る＝kincall と同じ重み）。
  //   toList なし：かける対象のリスト（保管でない）のリードの担当を書き換えるだけ（リストは動かさない＝kincall と同じ）。
  //   toList あり：pool='stock'（既定）は保管のリストから、pool='any' は保管も含むほかのリストの未割り当てから、そのリストへ移して担当を付ける。
  //     だれも選ばなければ担当なしで移す（「リードを足す」から種類を選んで足すとき）。
  //   リストにメンバーが決まっているときは、その外の人には配らない（配ってもその人の「かける」に出ないため。配れなかった分は試算で見せる）。
  //   いま架電中（10分以内に開いた）のリードは動かさない。並びは ホット → 最後にかけた日が古い順（条件で割り振る と同じ）
  app.post("/api/mccall/sources/distribute", adminOnly(async (req, res) => {
    const b = req.body || {};
    const members = [...new Set((Array.isArray(b.members) ? b.members : []).map((x) => String(x).toLowerCase().trim()).filter(Boolean))].slice(0, 100);
    const n = Math.max(0, Math.min(5000, parseInt(b.n, 10) || 0));
    const mode = b.mode === "rate" ? "rate" : "equal";
    const from = String(b.from || "").toLowerCase().trim();
    const toList = parseInt(b.toList, 10) || 0, onlyList = parseInt(b.list, 10) || 0;
    if (!n) return res.status(400).json({ error: "配る件数を入れてください" });
    if (!toList && !members.length) return res.status(400).json({ error: "配る人を選んでください" });
    const lists = (await P().query(`SELECT id, name, stock, members FROM mc_call_lists WHERE biz=$1 AND NOT closed`, [BIZ])).rows;
    const lmap = new Map(lists.map((l) => [l.id, l]));
    const dest = toList ? lmap.get(toList) : null;
    if (toList && !dest) return res.status(400).json({ error: "入れるリストが見つからないか、閉じています" });
    if (dest && dest.stock) return res.status(400).json({ error: "保管のリストには入れられません。かける対象のリストを選んでください" });
    let src = lists.filter((l) => (toList ? l.id !== toList && (from || b.pool === "any" || l.stock) : !l.stock)).map((l) => l.id);
    if (onlyList) src = src.filter((x) => x === onlyList);
    if (!src.length) return res.status(400).json({ error: toList ? "持ってくる元のリストがありません（保管のリストが無いときは「ほかのリストの未割り当て」を選んでください）" : "配れるリードのあるリストがありません" });
    await refreshSeg(src, { budgetMs: 8000 });
    const p = [src];
    const w = ["c.list_id = ANY($1::int[])", "NOT c.done", "c.dup_of IS NULL", "(c.locked_by IS NULL OR c.locked_at < now() - interval '10 minutes')", scopeWhere(b.keys, p)];
    if (from) { p.push(from); w.push(`lower(COALESCE(c.assigned_to,'')) = $${p.length}`); } else w.push("c.assigned_to IS NULL");
    if (toList) { p.push(toList); w.push(`NOT EXISTS (SELECT 1 FROM mc_call_leads d WHERE d.list_id=$${p.length} AND d.src=c.src AND d.src_key=c.src_key)`); }
    const where = w.join(" AND ");
    const available = +(await P().query(`SELECT count(*) FROM mc_call_leads c WHERE ${where}`, p)).rows[0].count;
    // 候補は多めに読む（リストのメンバーの決まりで配れない人がいると、先頭の n 件だけでは足りないため）
    const cp = [...p, Math.min(20000, n * 4 + 200)];
    const raw = (await P().query(`SELECT c.id, c.list_id, c.src, c.src_key FROM mc_call_leads c WHERE ${where}
      ORDER BY COALESCE(c.hot,0) DESC, ${LAST_TS} NULLS FIRST, c.id LIMIT $${cp.length}`, cp)).rows;
    // 移すときは、同じ元（src・src_key）のリードを2件同じリストへ入れない（入れると表の決まりで全部が失敗する）
    const seen = new Set(); const cands = toList ? raw.filter((c) => { const k = `${c.src}|${c.src_key}`; if (seen.has(k)) return false; seen.add(k); return true; }) : raw;
    // この種類での人ごとのアポ率（直近60日）
    const rp = [BIZ, members.length ? members : ["-"]];
    const rs = (await P().query(`SELECT lower(g.caller) AS caller, count(*) AS calls, count(*) FILTER (WHERE g.outcome='apo') AS apos
      FROM mc_call_logs g JOIN mc_call_leads c ON c.id = g.lead_id
      WHERE NOT g.undone AND g.biz=$1 AND lower(g.caller) = ANY($2::text[]) AND g.created_at > now() - interval '60 days' AND ${scopeWhere(b.keys, rp)} GROUP BY 1`, rp)).rows;
    const rates = Object.fromEntries(rs.map((r) => [r.caller, { calls: +r.calls, apos: +r.apos, rate: +r.calls ? +r.apos / +r.calls : 0 }]));
    let weights = members.map(() => 1);
    if (mode === "rate") {
      const rv = members.map((e) => (rates[e] && rates[e].calls >= 20 ? rates[e].rate : null));
      const known = rv.filter((x) => x != null); const avg = known.length ? known.reduce((a, x) => a + x, 0) / known.length : 0;
      weights = rv.map((x) => Math.max(avg * 0.3, x == null ? avg : x) || 1);
    }
    const total = Math.min(n, cands.length);
    const sumW = weights.reduce((a, x) => a + x, 0) || 1;
    const quota = weights.map((x) => Math.floor((total * x) / sumW));
    let rest = total - quota.reduce((a, x) => a + x, 0);
    const order = weights.map((x, i) => [x, i]).sort((a, c) => c[0] - a[0]).map((x) => x[1]);
    for (let k = 0; rest > 0 && order.length; k++, rest--) quota[order[k % order.length]]++;
    const okFor = (c, e) => { const l = lmap.get(toList || c.list_id); const mem = ((l && l.members) || []).map((x) => String(x).toLowerCase()); return !mem.length || mem.includes(e); };
    const got = members.map(() => []); const none = [];
    const left = (i) => quota[i] - got[i].length;
    if (members.length) {
      // 残りの枠の割合がいちばん大きい人へ1件ずつ（同じなら順番に）。ホットが1人に偏らず、メンバー外のリストのリードは配れる人へ回る
      let rr = 0; const wait = [];
      for (const c of cands) {
        if (members.every((_, i) => left(i) <= 0)) break;
        let best = -1, bestR = -1;
        for (let j = 0; j < members.length; j++) {
          const i = (rr + j) % members.length;
          if (left(i) <= 0 || !okFor(c, members[i])) continue;
          const ratio = left(i) / (quota[i] || 1); if (ratio > bestR) { best = i; bestR = ratio; }
        }
        if (best < 0) { if (wait.length < 500 && members.some((e) => okFor(c, e))) wait.push(c); continue; }
        got[best].push(c); rr = (best + 1) % members.length;
      }
      // 入れ替え：枠がいっぱいの人しか受け取れないリード（メンバー限定のリスト）があり、ほかの人の枠が残っているときは、
      //   いっぱいの人が持っている「だれでも受け取れるリード」を枠の残っている人へ回し、空いたところに入れる（配り残しを減らす）
      for (const c of wait) {
        const free = members.map((_, i) => i).filter((i) => left(i) > 0); if (!free.length) break;
        let moved = false;
        for (let i = 0; i < members.length && !moved; i++) {
          if (!okFor(c, members[i])) continue;
          for (const j of free) {
            const k = got[i].findIndex((x) => okFor(x, members[j])); if (k < 0) continue;
            got[j].push(got[i].splice(k, 1)[0]); got[i].push(c); moved = true; break;
          }
        }
      }
    } else for (const c of cands.slice(0, total)) none.push(c.id);
    const names = await nameMap();
    for (let i = 0; i < got.length; i++) got[i] = got[i].map((c) => c.id);
    const plan = members.map((e, i) => ({ email: e, name: names.get(e) || e, n: got[i].length, want: quota[i],
      rate: rates[e] ? Math.round(rates[e].rate * 1000) / 10 : null, calls: rates[e] ? rates[e].calls : 0, apos: rates[e] ? rates[e].apos : 0 }));
    const assigned = plan.reduce((a, x) => a + x.n, 0) + none.length;
    if (b.dryRun) return res.json({ ok: true, dryRun: true, available, total: assigned, plan, unassigned: none.length, toList: dest ? dest.name : "" });
    if (!assigned) return res.status(400).json({ error: "配れるリードがありません。種類・どこから・入れるリストを見直してください" });
    // 試算のあとに、ほかの人が開いた・配ったリードは動かさない（同じ条件をもう一度付けて書き換える）
    const upd = async (ids, who) => {
      if (!ids.length) return 0;
      // 元のリスト（保管に移された・閉じたリストのものは外す）と種類も、もう一度確かめる
      const q = [ids, who, from, src]; let set = "assigned_to=$2"; let more = ` AND c.list_id = ANY($4::int[]) AND ${scopeWhere(b.keys, q)}`;
      if (toList) { q.push(toList); const t = q.length; set += `, list_id=$${t}, locked_by=NULL, locked_at=NULL`; more += ` AND NOT EXISTS (SELECT 1 FROM mc_call_leads d WHERE d.list_id=$${t} AND d.src=c.src AND d.src_key=c.src_key)`; }
      const x = await P().query(`UPDATE mc_call_leads c SET ${set} WHERE c.id = ANY($1::int[]) AND NOT c.done AND c.dup_of IS NULL AND lower(COALESCE(c.assigned_to,'')) = $3
        AND (c.locked_by IS NULL OR c.locked_at < now() - interval '10 minutes')${more}`, q);
      return x.rowCount;
    };
    let done = 0;
    for (let i = 0; i < members.length; i++) { plan[i].done = await upd(got[i], members[i]); done += plan[i].done; }
    const loose = await upd(none, null); done += loose;
    console.log(`[mccall] 種類から配る：${done}件（${mode === "rate" ? "アポ率" : "均等"}・元：${from || (toList ? (b.pool === "any" ? "ほかのリストの未割り当て" : "保管") : "未割り当て")}${dest ? `・入れるリスト「${dest.name}」` : ""}）種類=${JSON.stringify(b.keys || []).slice(0, 200)} → ${[...plan.map((x) => `${x.name}${x.done}`), loose ? `担当なし${loose}` : ""].filter(Boolean).join("・")} by ${me(req)}`);
    res.json({ ok: true, done, plan, unassigned: loose, available, toList: dest ? dest.name : "" });
  }));

  // Bales のリストから写す（同じリードがほかの開いている MOCHICA のリストにあれば入れない＝二重にかけない）
  app.post("/api/mccall/lists/:id/from-bales", adminOnly(async (req, res) => {
    const id = parseInt(req.params.id, 10); const b = req.body || {};
    const key = String(b.listKey || ""); if (!key) return res.status(400).json({ error: "Bales のリストを選んでください" });
    const l = (await P().query(`SELECT run_at FROM mochica_bales_lists WHERE list_key=$1`, [key])).rows[0];
    if (!l) return res.status(404).json({ error: "Bales のリストが見つかりません。リスト（Bales Cloud）で取り込み直してください" });
    const HW = { hot: "AND hot >= 3", "warm+": "AND hot >= 2" }; const lim = Math.min(Math.max(parseInt(b.limit, 10) || 300, 1), 5000);
    const rows = (await P().query(`SELECT row_key, data, hot, sf->'lead'->>'id' AS lid FROM mochica_bales_rows WHERE list_key=$1 AND run_at=$2 ${HW[b.hot] || ""}
      AND NOT EXISTS (SELECT 1 FROM mc_call_leads c JOIN mc_call_lists x ON x.id=c.list_id WHERE NOT x.closed AND NOT c.done AND c.src='bales' AND c.src_key = $1::text || '|' || mochica_bales_rows.row_key)
      ORDER BY COALESCE(hot,0) DESC, seq LIMIT $3`, [key, l.run_at, lim])).rows;
    await banListOrStop();
    let added = 0, banned = 0, dup = 0, bad = 0, nokey = 0; const ex = dupSamples();
    for (const r of rows) {
      const f = fromBales(r.data || {});
      if (approachBanHitSync({ company: f.company, phone: f.phone, leadId: r.lid })) { banned++; continue; }
      const x = await addLeadUnique({ list_id: id, src: "bales", src_key: `${key}|${r.row_key}`, company: f.company, phone: f.phone, person: f.person, sf_lead_id: r.lid || null, hot: r.hot }, { data: r.data });
      if (x.added) { added++; if (x.nokey) nokey++; } else if (x.banned) banned++; else if (x.bad) bad++; else { dup++; ex.push(f.company, x.dup); }
    }
    mynaviEnqueue(rows.map((r) => fromBales(r.data || {}).company)).catch((e) => console.error("[mccall] マイナビの調べを始められませんでした", e.message));
    res.json({ ok: true, added, banned, dup, bad, nokey, skipped: dup, examples: ex.list });
  }));

  // ===== SHOWIN のリスト管理から、選んだリードをメンバーに割り振る（2026-11-23 田中さん「各メンバーに割り振る機能を kincall みたいに」）=====
  //   割り振り先は MOCHICALL のかけるリスト（その人がかける）。すでにどこかの開いているリストにあるリードは、そのまま担当だけ付け替える。
  //   入れる・付け替えるときもアプローチ禁止は必ずはじく（addLeadUnique）。入れる候補：開いている（保管でない）リストと、そのメンバー
  app.get("/api/mccall/assign-targets", adminOnly(async (req, res) => {
    const names = await nameMap(); const users = await listUsers().catch(() => []);
    const intern = new Set(users.filter((u) => u && (u.mcIntern || u.mc_intern)).map((u) => String(u.email).toLowerCase()));
    const ls = (await P().query(`SELECT id, name, members FROM mc_call_lists WHERE NOT closed AND NOT COALESCE(stock,false) ORDER BY created_at DESC`)).rows;
    res.json({ ok: true, lists: ls.map((l) => ({ id: l.id, name: l.name, members: (l.members || []).map((e) => ({ email: e, name: names.get(String(e).toLowerCase()) || e, intern: intern.has(String(e).toLowerCase()) })) })) });
  }));
  app.post("/api/mccall/from-bales-assign", adminOnly(async (req, res) => {
    const b = req.body || {}; const id = parseInt(b.listId, 10); const key = String(b.listKey || "");
    const members = (Array.isArray(b.members) ? b.members : []).map((x) => String(x).toLowerCase()).filter(Boolean).slice(0, 50);
    const rowKeys = (Array.isArray(b.rowKeys) ? b.rowKeys : []).map(String).slice(0, 5000);
    if (!id || !key || !rowKeys.length || !members.length) return res.status(400).json({ error: "リード・入れるリスト・割り振る人を選んでください" });
    const lst = (await P().query(`SELECT id, name, members FROM mc_call_lists WHERE id=$1 AND NOT closed`, [id])).rows[0]; if (!lst) return res.status(404).json({ error: "入れるリストが見つかりません（閉じている・消えた）" });
    // 割り振った人がリストのメンバーでなければ足す（メンバーでないと、その人の「かける」にリストが出ないため）
    { const cur = (lst.members || []).map((x) => String(x).toLowerCase()); const add = members.filter((m) => !cur.includes(m));
      if (add.length) await P().query(`UPDATE mc_call_lists SET members=$2 WHERE id=$1`, [id, [...cur, ...add].slice(0, 200)]); }
    const l = (await P().query(`SELECT run_at FROM mochica_bales_lists WHERE list_key=$1`, [key])).rows[0]; if (!l) return res.status(404).json({ error: "SHOWIN のリストが見つかりません" });
    // ホットな順に1件ずつ交互に配る（偏らないように。MOCHICALL の「複数人に分ける」と同じ配り方）
    const rows = (await P().query(`SELECT row_key, data, hot, sf->'lead'->>'id' AS lid FROM mochica_bales_rows WHERE list_key=$1 AND run_at=$2 AND row_key = ANY($3::text[]) ORDER BY COALESCE(hot,0) DESC, seq`, [key, l.run_at, rowKeys])).rows;
    await banListOrStop();
    const names = await nameMap(); const per = new Map(members.map((m) => [m, 0])); const done = [];
    let added = 0, moved = 0, banned = 0, dup = 0, bad = 0, i = 0;
    for (const r of rows) {
      const who = members[i % members.length]; const f = fromBales(r.data || {}); const sk = `${key}|${r.row_key}`;
      if (approachBanHitSync({ company: f.company, phone: f.phone, leadId: r.lid })) { banned++; continue; }
      // すでに開いているリストにあれば担当だけ付け替える（かけている最中のものは動かさない）
      const up = await P().query(`UPDATE mc_call_leads c SET assigned_to=$2 FROM mc_call_lists x WHERE x.id=c.list_id AND NOT x.closed AND c.src='bales' AND c.src_key=$1 AND NOT c.done AND c.dup_of IS NULL
        AND (c.locked_by IS NULL OR c.locked_at < now() - interval '10 minutes')`, [sk, who]);
      if (up.rowCount) { moved++; per.set(who, per.get(who) + 1); done.push({ k: r.row_key, who }); i++; continue; }
      const x = await addLeadUnique({ list_id: id, src: "bales", src_key: sk, company: f.company, phone: f.phone, person: f.person, sf_lead_id: r.lid || null, hot: r.hot, assigned_to: who }, { data: r.data });
      if (x.added) { added++; per.set(who, per.get(who) + 1); done.push({ k: r.row_key, who }); i++; } else if (x.banned) banned++; else if (x.bad) bad++; else dup++;
    }
    console.log(`[mccall] SHOWIN から割り振り：${added + moved}件（新しく入れた ${added}・付け替え ${moved}・禁止 ${banned}・重複 ${dup}）→「${lst.name}」`);
    res.json({ ok: true, list: lst.name, added, moved, banned, dup, bad, per: members.map((m) => ({ email: m, name: names.get(m) || m, n: per.get(m) })), done: done.map((d) => ({ ...d, name: names.get(d.who) || d.who })) });
  }));

  // CSV から足す（2026-11-18 福井さん「架電リストをcsvからアップロードできるように」）。
  //   CSV はブラウザで読んで、行ごとに { company, phone, person, sfLeadId, extra } にして送ってくる。
  //   同じ電話番号（無ければ会社名）が、ほかの開いている MOCHICA のリストでまだ終わっていなければ入れない＝二重にかけない。
  //   SF のリードIDが無い行は架電結果を SF に書けない（nolead）ので、件数を返して画面で知らせる（ルール5）。
  app.post("/api/mccall/lists/:id/from-csv", adminOnly(async (req, res) => {
    const id = parseInt(req.params.id, 10); const b = req.body || {};
    const l = (await P().query(`SELECT id, closed FROM mc_call_lists WHERE id=$1`, [id])).rows[0];
    if (!l || l.closed) return res.status(404).json({ error: "リストが見つからないか、閉じています" });
    const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 5000);
    if (!rows.length) return res.status(400).json({ error: "CSV に読める行がありません" });
    await banListOrStop();
    const fill = await csvFillFromSf(req, rows);
    let added = 0, banned = 0, dup = 0, bad = 0, nolead = 0, nokey = 0, nophone = 0; const companies = []; const ex = dupSamples();
    for (const r of rows) {
      const company = clip(r.company, 200), phone = clip(r.phone, 40), person = clip(r.person, 100);
      const ph = digits(phone), ck = companyKey(company);
      if (!company && ph.length < 9) { bad++; continue; }
      if (r._sfBan) { banned++; continue; }
      const lid = /^00Q[0-9A-Za-z]{12,15}$/.test(String(r.sfLeadId || "").trim()) ? String(r.sfLeadId).trim() : null;
      if (approachBanHitSync({ company, phone, leadId: lid })) { banned++; continue; }
      const extra = {}; if (r.extra && typeof r.extra === "object") for (const [k, v] of Object.entries(r.extra).slice(0, 60)) { const kk = clip(k, 60), vv = clip(v, 1000); if (kk && vv) extra[kk] = vv; }
      const x = await addLeadUnique({ list_id: id, src: "csv", src_key: ph.length >= 9 ? ph : `co:${ck}`, company, phone, person, sf_lead_id: lid, data: extra }, { data: extra });
      if (x.banned) { banned++; continue; }
      if (x.bad) { bad++; continue; }
      if (!x.added) { dup++; ex.push(company, x.dup); continue; }
      added++; if (!lid) nolead++; if (x.nokey) nokey++; if (ph.length < 9) nophone++; companies.push(company);
    }
    mynaviEnqueue(companies).catch((e) => console.error("[mccall] マイナビの調べを始められませんでした", e.message));
    console.log(`[mccall] CSV から リスト${id} へ ${added}件（SFで電話を補った${fill.phone}・リードIDを補った${fill.lead}・電話なし${nophone}${fill.error ? `・SFエラー ${fill.error}` : ""}）by ${me(req)}`);
    res.json({ ok: true, added, banned, dup, bad, nolead, nokey, nophone, sfPhone: fill.phone, sfLead: fill.lead, sfError: fill.error || null, examples: ex.list });
  }));

  // CSV の電話番号が空の行は SF から補う（2026-11-20 福井さん「電話番号の無いリードリストを MOCHICALL で架けられるように」）。
  //   リードID（列、または詳細に入っている SF の URL の 00Q…）→ Lead.Phone。無ければ商談ID（006…）→ 取引先の電話。
  //   それも無ければ会社名が完全に同じ SF のリード（MOCHICA のものを優先）→ 取引先 の順で探す。
  //   MOCHICA のリードが会社名で1件だけ当たったら、そのリードIDも入れる（架電結果を SF に書けるように）。
  //   SF は読むだけ。SF に届かなかったときは error を返して画面で知らせる（ルール5）
  async function csvFillFromSf(req, rows) {
    const out = { phone: 0, lead: 0, error: "" };
    const idIn = (s, re) => { const m = String(s || "").match(re); return m ? m[0].slice(0, 18) : null; };
    const need = [];
    for (const r of rows) {
      if (digits(r.phone).length >= 9) continue;
      const ex = r.extra && typeof r.extra === "object" ? Object.values(r.extra).join(" ") : "";
      if (!/^00Q[0-9A-Za-z]{12,15}$/.test(String(r.sfLeadId || "").trim())) { const l = idIn(ex, /00Q[0-9A-Za-z]{12,15}/); if (l) { r.sfLeadId = l; out.lead++; } }
      r._opp = idIn(ex, /006[0-9A-Za-z]{12,15}/);
      need.push(r);
    }
    if (!need.length) return out;
    const q = (v) => `'${String(v).slice(0, 200).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
    const chunks = (a, n = 100) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
    const coVariants = (c) => { const s = String(c || "").trim(); const t = s.replace(/[（(][^）)]*[）)]/g, "").trim(); return [...new Set([s, t].filter(Boolean))]; };
    try {
      const owner = await sfActor(req);
      const all = async (soql) => (await sfQueryAll(owner, soql, 2000)) || [];
      // 1) リードID
      const lids = [...new Set(need.map((r) => r.sfLeadId).filter(Boolean))];
      const byLead = new Map();
      for (const c of chunks(lids)) for (const l of await all(`SELECT Id, Phone, MobilePhone, Ban_Type__c FROM Lead WHERE Id IN (${c.map(q).join(",")})`)) byLead.set(String(l.Id).slice(0, 15), l);
      // 2) 商談ID → 取引先
      const opps = [...new Set(need.map((r) => r._opp).filter(Boolean))];
      const byOpp = new Map();
      for (const c of chunks(opps)) for (const o of await all(`SELECT Id, Account.Phone FROM Opportunity WHERE Id IN (${c.map(q).join(",")})`)) byOpp.set(String(o.Id).slice(0, 15), o.Account && o.Account.Phone);
      // 3) 会社名（完全一致）
      const names = [...new Set(need.flatMap((r) => coVariants(r.company)))];
      const leadByCo = new Map(), accByCo = new Map();
      for (const c of chunks(names)) {
        for (const l of await all(`SELECT Id, Company, Phone, MobilePhone, IsConverted, RecordType.Name, Ban_Type__c FROM Lead WHERE Company IN (${c.map(q).join(",")}) AND (Phone != null OR MobilePhone != null) ORDER BY LastActivityDate DESC NULLS LAST`)) {
          const k = String(l.Company).trim(); if (!leadByCo.has(k)) leadByCo.set(k, []); leadByCo.get(k).push(l);
        }
        for (const a of await all(`SELECT Name, Phone FROM Account WHERE Name IN (${c.map(q).join(",")}) AND Phone != null`)) { const k = String(a.Name).trim(); if (!accByCo.has(k)) accByCo.set(k, a.Phone); }
      }
      for (const r of need) {
        const L = r.sfLeadId && byLead.get(String(r.sfLeadId).slice(0, 15));
        if (L && L.Ban_Type__c) { r._sfBan = true; continue; }
        let ph = L ? (L.Phone || L.MobilePhone) : "";
        if (!ph && r._opp) ph = byOpp.get(r._opp.slice(0, 15)) || "";
        if (!ph) for (const v of coVariants(r.company)) {
          const ls = leadByCo.get(v) || [];
          const mc = ls.filter((l) => l.RecordType && l.RecordType.Name === "Mochica（リード）" && !l.IsConverted);
          if (mc.some((l) => l.Ban_Type__c)) { r._sfBan = true; break; }
          const pick = mc[0] || ls[0];
          if (pick) { ph = pick.Phone || pick.MobilePhone; if (!r.sfLeadId && mc.length === 1) { r.sfLeadId = String(mc[0].Id).slice(0, 18); out.lead++; } break; }
          if (accByCo.get(v)) { ph = accByCo.get(v); break; }
        }
        if (ph) { r.phone = String(ph).slice(0, 40); out.phone++; r.extra = { ...(r.extra || {}), 電話の出どころ: "SF から補った" }; }
      }
    } catch (e) {
      out.error = String(e && e.message || e).slice(0, 200);
      console.error("[mccall] CSV の電話を SF から補えませんでした", out.error);
    }
    return out;
  }

  // ---- SF から足す（2026-11-19 福井さん「リードソースに SF も。SF・BALES・SHOBO からリードを追加できる形式」） ----
  //   SF の MOCHICA のリード（コンバート前）を、ステータス・リードソース・失注の有無・最後の活動からの日数・会社名で絞って足す。
  //   重複させない決まり（電話・会社名・メールのどれかが同じなら同じリード）とアプローチ禁止はほかの取り込みと同じ。
  //   SF は読むだけ（書き換えない）。架電の結果は今までどおり sf_lead_id のリードへ活動として書く
  app.get("/api/mccall/sf/options", adminOnly(async (req, res) => {
    const owner = await sfActor(req);
    const base = sfLeadWhere({});
    const agg = async (f) => ((await sfQuery(owner, `SELECT ${f}, COUNT(Id) n FROM Lead WHERE ${base} GROUP BY ${f} ORDER BY COUNT(Id) DESC LIMIT 200`)).records || [])
      .map((r) => ({ v: r[f] == null || r[f] === "" ? "（なし）" : String(r[f]), n: +r.n || 0 }));
    const [status, source] = await Promise.all([agg("Status"), agg("LeadSource")]);
    res.json({ ok: true, status, source, total: status.reduce((a, x) => a + x.n, 0) });
  }));
  app.post("/api/mccall/lists/:id/from-sf", adminOnly(async (req, res) => {
    const id = parseInt(req.params.id, 10); const b = req.body || {};
    const l = (await P().query(`SELECT id, closed FROM mc_call_lists WHERE id=$1`, [id])).rows[0];
    if (!l || l.closed) return res.status(404).json({ error: "リストが見つからないか、閉じています" });
    const owner = await sfActor(req);
    const where = sfLeadWhere(b.filters || {});
    const total = +((await sfQuery(owner, `SELECT COUNT() FROM Lead WHERE ${where}`)).totalSize || 0);
    const lim = Math.max(1, Math.min(5000, parseInt(b.limit, 10) || 300));
    if (b.dryRun) return res.json({ ok: true, dryRun: true, total, taking: Math.min(total, lim) });
    if (!total) return res.status(400).json({ error: "条件に合う SF のリードがありません。条件をゆるめてください" });
    // 最後の活動が古いものから（kincall の「最後にかけた日が古い順」と同じ考え方）
    const recs = await sfQueryAll(owner, `SELECT ${SF_LEAD_FIELDS.join(", ")} FROM Lead WHERE ${where} ORDER BY LastActivityDate ASC NULLS FIRST, CreatedDate DESC LIMIT ${lim}`, lim);
    await banListOrStop();
    let added = 0, banned = 0, dup = 0, bad = 0, nokey = 0; const ex = dupSamples(); const companies = [];
    for (const rec of recs) {
      const r = sfLeadRow(rec, judgeHot);
      if (r.ban || approachBanHitSync({ company: r.company, phone: r.phone, leadId: r.sf_lead_id })) { banned++; continue; }
      if (!r.company && digits(r.phone).length < 9) { bad++; continue; }
      const x = await addLeadUnique({ list_id: id, src: "sf", src_key: String(rec.Id).slice(0, 18), company: r.company, phone: r.phone, person: r.person, sf_lead_id: r.sf_lead_id, hot: r.hot, data: r.data }, { data: r.data });
      if (x.added) { added++; if (x.nokey) nokey++; companies.push(r.company); } else if (x.banned) banned++; else if (x.bad) bad++; else { dup++; ex.push(r.company, x.dup); }
    }
    mynaviEnqueue(companies).catch((e) => console.error("[mccall] マイナビの調べを始められませんでした", e.message));
    console.log(`[mccall] SF から リスト${id} へ ${added}件（読んだ${recs.length}・重複${dup}・禁止${banned}）条件=${JSON.stringify(b.filters || {}).slice(0, 300)} by ${me(req)}`);
    res.json({ ok: true, total, read: recs.length, added, banned, dup, bad, nokey, examples: ex.list });
  }));

  // ---- BALES のリストを SHOBO へ移す（2026-11-19 福井さん「ゆくゆくは BALES は解約するので、BALES リストはすべて移行しておいて」） ----
  //   BALES のリスト1つにつき SHOBO の「保管」のリストを1つ作り（名前は「BALES：元の名前」）、最新の取り込みの行をすべて入れる。
  //   小さいリストから先に入れる（「すべてのリード」のような大きいリストを先に入れると、ほかのリストの会社が全部そちらに入ってしまうため）。
  //   リードは MOCHICA 全体で1件だけなので、すでに SHOBO にある会社は入れない（重複として数える）。何度やり直しても増えない。
  //   BALES で入れていた次の掛け直しの予約（nextActions）とかけた回数は引き継ぐ。架電の履歴・カスタム情報は mochica_bales_rows に
  //   残っていて、架電画面のタイムラインはそこから読むので、BALES を解約しても見られる。
  //   保管のリストはだれの「かける」にも出ない（いきなり2万件が順番に入らないように）。「SHOBO から足す」で条件を付けて今のリストへ持ってくる
  let migrating = null;
  async function migrateBales(by, dryRun) {
    const lists = (await P().query(`SELECT b.list_key, b.name, b.run_at, b.status,
        (SELECT count(*) FROM mochica_bales_rows r WHERE r.list_key=b.list_key AND r.run_at=b.run_at) AS n
      FROM mochica_bales_lists b WHERE b.run_at IS NOT NULL ORDER BY 5, b.list_key`)).rows.map((r) => ({ ...r, n: +r.n }));
    const out = [];
    for (const bl of lists) {
      const name = `BALES：${String(bl.name || bl.list_key).replace(/^bales:/, "")}`.slice(0, 80);
      if (dryRun) { out.push({ list: name, rows: bl.n, status: bl.status }); continue; }
      let dst = (await P().query(`SELECT id FROM mc_call_lists WHERE bales_key=$1 ORDER BY id LIMIT 1`, [bl.list_key])).rows[0];
      if (!dst) dst = (await P().query(`INSERT INTO mc_call_lists (name, note, members, created_by, stock, bales_key) VALUES ($1,$2,'{}',$3,true,$4) RETURNING id`,
        [name, "BALES から移したリスト（保管）。「SHOBO から足す」で条件を付けて今のリストへ持ってくる", by, bl.list_key])).rows[0];
      await banListOrStop();
      let added = 0, banned = 0, dup = 0, bad = 0, nokey = 0, after = 0;
      for (;;) {
        const rows = (await P().query(`SELECT seq, row_key, data, hot, sf->'lead'->>'id' AS lid FROM mochica_bales_rows WHERE list_key=$1 AND run_at=$2 AND seq > $3 ORDER BY seq LIMIT 500`, [bl.list_key, bl.run_at, after])).rows;
        if (!rows.length) break;
        for (const r of rows) {
          after = r.seq; const d = r.data || {}; const f = fromBales(d);
          if (approachBanHitSync({ company: f.company, phone: f.phone, leadId: r.lid })) { banned++; continue; }
          const c = balesCarry(d);
          const x = await addLeadUnique({ list_id: dst.id, src: "bales", src_key: `${bl.list_key}|${r.row_key}`, company: f.company, phone: f.phone, person: f.person,
            sf_lead_id: r.lid || null, hot: r.hot, next_at: c.next_at, next_why: c.next_at ? "BALES で入れていた次のコールの予定" : null, attempts: c.attempts }, { data: d });
          if (x.added) { added++; if (x.nokey) nokey++; } else if (x.banned) banned++; else if (x.bad) bad++; else dup++;
        }
      }
      out.push({ list: name, listId: dst.id, rows: bl.n, added, dup, banned, bad, nokey });
      console.log(`[mccall] BALES「${bl.name}」→ SHOBO「${name}」：${added}件（行${bl.n}・重複${dup}・禁止${banned}・読めない${bad}）`);
    }
    // 黙った失敗を作らない（ルール5）：行が0件の BALES のリストは知らせる
    const empty = out.filter((x) => !x.rows).map((x) => x.list);
    return { at: new Date().toISOString(), by, lists: out, empty, added: out.reduce((a, x) => a + (x.added || 0), 0) };
  }
  app.get("/api/mccall/bales/migrate", adminOnly(async (req, res) => {
    const st = await getSettings().catch(() => ({}));
    res.json({ ok: true, running: !!migrating, last: st.mcBalesMigrate || null, plan: await migrateBales(me(req), true) });
  }));
  app.post("/api/mccall/bales/migrate", adminOnly(async (req, res) => {
    if (migrating) return res.status(409).json({ error: "いま移しています。終わるまで待ってください" });
    migrating = migrateBales(me(req), false)
      .then((r) => saveSettings({ mcBalesMigrate: r }).then(() => r))
      .catch((e) => { console.error("[mccall] BALES の移行で失敗しました", e.message); return saveSettings({ mcBalesMigrate: { at: new Date().toISOString(), by: me(req), error: e.message } }); })
      .finally(() => { migrating = null; });
    res.json({ ok: true, started: true });
  }));
  // デプロイのあと1回だけ、だれも押さなくても移す（福井さん「移行しておいて」）。2回目からは画面の「もう一度移す」で（増えた分だけ入る）
  setTimeout(async () => {
    try {
      if (!P()) return; await ensure();
      const st = await getSettings().catch(() => null); if (!st || st.mcBalesMigrate) return;
      if (migrating) return;
      console.log("[mccall] BALES のリストを SHOBO へ移します（初回・自動）");
      migrating = migrateBales("自動（初回）", false).then((r) => saveSettings({ mcBalesMigrate: r }))
        .catch((e) => { console.error("[mccall] BALES の移行で失敗しました", e.message); return saveSettings({ mcBalesMigrate: { at: new Date().toISOString(), by: "自動（初回）", error: e.message } }); })
        .finally(() => { migrating = null; });
    } catch (e) { console.error("[mccall] BALES の移行を始められませんでした", e.message); }
  }, 120e3).unref?.();

  // DOC の kincall のリスト一覧（読むだけ）。管理者がリードを持ってくるときに選ぶ
  app.get("/api/mccall/doc/lists", adminOnly(async (req, res) => {
    const rows = (await P().query(`SELECT l.id, l.name, l.owner, count(t.id) FILTER (WHERE NOT t.done) AS open
      FROM call_lists l LEFT JOIN call_targets t ON t.list_id=l.id WHERE NOT l.closed GROUP BY l.id ORDER BY l.id DESC LIMIT 300`)).rows;
    res.json({ ok: true, items: rows.map((r) => ({ ...r, open: +r.open })) });
  }));
  // DOC のリストから写す（部署をまたぐ）。理由は必ず。DOC 側は変えない
  app.post("/api/mccall/lists/:id/from-doc", adminOnly(async (req, res) => {
    const id = parseInt(req.params.id, 10); const b = req.body || {};
    const docId = parseInt(b.docListId, 10); const reason = clip(b.reason, 300);
    if (!docId) return res.status(400).json({ error: "DOC のリストを選んでください" });
    if (!reason) return res.status(400).json({ error: "部署をまたぐ理由を入れてください（あとで一覧に残ります）" });
    const dl = (await P().query(`SELECT id, name FROM call_lists WHERE id=$1`, [docId])).rows[0]; if (!dl) return res.status(404).json({ error: "DOC のリストが見つかりません" });
    const ts = (await P().query(`SELECT id, company, person, phone, email, lead_id FROM call_targets WHERE list_id=$1 AND NOT done ORDER BY sort_order, id LIMIT 5000`, [docId])).rows;
    await banListOrStop();
    const mv = (await P().query(`INSERT INTO mc_cross_moves (from_biz, to_biz, from_ref, from_name, to_list_id, count, reason, by_user) VALUES ('DOC',$1,$2,$3,$4,0,$5,$6) RETURNING id`,
      [BIZ, String(docId), dl.name, id, reason, me(req)])).rows[0];
    let added = 0, banned = 0, dup = 0, bad = 0, nokey = 0; const ex = dupSamples();
    for (const t of ts) {
      if (approachBanHitSync({ company: t.company, phone: t.phone, leadId: t.lead_id })) { banned++; continue; }
      const x = await addLeadUnique({ list_id: id, src: "doc", src_key: String(t.id), company: t.company, phone: t.phone, person: t.person, sf_lead_id: t.lead_id || null, cross_from: "DOC", cross_id: mv.id }, { data: { email: t.email } });
      if (x.added) { added++; if (x.nokey) nokey++; } else if (x.banned) banned++; else if (x.bad) bad++; else { dup++; ex.push(t.company, x.dup); }
    }
    await P().query(`UPDATE mc_cross_moves SET count=$2 WHERE id=$1`, [mv.id, added]);
    mynaviEnqueue(ts.map((t) => t.company)).catch((e) => console.error("[mccall] マイナビの調べを始められませんでした", e.message));
    res.json({ ok: true, added, banned, dup, bad, nokey, skipped: dup, examples: ex.list, moveId: mv.id });
  }));

  // 部署をまたいだ記録（持ってきた履歴と、そのリードへの架電の数）
  app.get("/api/mccall/cross", adminOnly(async (req, res) => {
    const names = await nameMap();
    const moves = (await P().query(`SELECT m.*, l.name AS to_name,
        (SELECT count(*) FROM mc_call_logs g JOIN mc_call_leads c ON c.id=g.lead_id WHERE c.cross_id=m.id AND NOT g.undone) AS calls,
        (SELECT count(*) FROM mc_call_logs g JOIN mc_call_leads c ON c.id=g.lead_id WHERE c.cross_id=m.id AND NOT g.undone AND g.outcome='apo') AS apo
      FROM mc_cross_moves m LEFT JOIN mc_call_lists l ON l.id=m.to_list_id ORDER BY m.at DESC LIMIT 200`)).rows;
    const calls = (await P().query(`SELECT g.id, g.caller, g.outcome, g.created_at, c.company, m.from_name FROM mc_call_logs g JOIN mc_call_leads c ON c.id=g.lead_id
      LEFT JOIN mc_cross_moves m ON m.id=c.cross_id WHERE g.cross_from IS NOT NULL AND NOT g.undone ORDER BY g.created_at DESC LIMIT 100`)).rows;
    res.json({ ok: true, moves: moves.map((m) => ({ ...m, by: names.get(String(m.by_user || "").toLowerCase()) || m.by_user, calls: +m.calls, apo: +m.apo })),
      calls: calls.map((c) => ({ ...c, caller: names.get(String(c.caller || "").toLowerCase()) || c.caller, outcome: outcomeLabel(c.outcome) })) });
  }));

  // ---- かける順番 ----
  // 掛け直しの時刻が来たもの → まだかけていないホットな順 → 回数の少ない順。ほかの人が開いている（10分以内）ものは飛ばす
  // ===== 「かける」はリスト管理の今日かけるリストから（2026-11-23 福井さん「架電先リストはリスト管理の今日架けるリストからかけるように」）=====
  //   リスト管理（SHOWIN の Bales のリスト）で、その人が所有者のリードから毎日作る150件（db.js mcBalesToday）を、
  //   MOCHICALL のリスト「今日かけるリスト（リスト管理）」（today_src）に担当付きで入れ、「かける」はそれ（＋本人の掛け直し）だけにする。
  //   ・所有者に名前が当たらない人（管理者など）は今までどおり（担当のリストすべて）
  //   ・入れ先のリストを管理者が閉じると、全員が今までの出し方に戻る（止めたいときの切り替え）
  //   ・すでに MOCHICALL にあるリード（保管の BALES のリストなど）は移して担当を付け替える。無いものは重複・アプローチ禁止を確かめてから入れる
  const TODAY_LIST_NAME = "今日かけるリスト（リスト管理）";
  const todayDay = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  // リスト管理で使っている Bales のリスト（画面の mainList と同じ：取り込み中でない、いちばん新しいもの）と、所有者の列（画面の ownerCol と同じ）
  let _mainKey = "";
  async function balesMain() {
    const ls = (await P().query(`SELECT list_key, src, status, cols, view FROM mochica_bales_lists ORDER BY run_at DESC NULLS LAST`).catch(() => ({ rows: [] }))).rows;
    //   CSV・SF から足したリストは主にしない（画面の mainList と同じ。新しく CSV を足すと、今日かけるリストがその CSV だけで作られ「かける」が空になっていたため）（2026-11-25）
    const l = ls.find((x) => x.src !== "csv" && x.src !== "sf" && x.status !== "running") || ls.find((x) => x.status !== "running") || ls[0]; if (!l) return null;
    // 主のリストが変わったらログに残す（今日かけるリストは主のリストで作るので、変わると全員の今日の分が作り直しになる。黙って切り替わると原因が追えないため）
    if (_mainKey && _mainKey !== l.list_key) console.warn(`[mccall] 今日かけるリストの主のリストが変わりました：${_mainKey} → ${l.list_key}（${l.src || "bales"}）`);
    _mainKey = l.list_key;
    const keys = new Set((Array.isArray(l.cols) ? l.cols : []).map((c) => c && c.key));
    if (keys.has("companyName") || keys.has("company_name") || String(l.list_key).startsWith("bales:")) return { listKey: l.list_key, col: !keys.has("operatorName") && keys.has("operator_name") ? "operator_name" : "operatorName" };
    const v = (Array.isArray(l.view) ? l.view : []).find((x) => /所有者|オーナー/.test(String((x && x.label) || "")));
    const c = v ? v.key : ((Array.isArray(l.cols) ? l.cols : []).find((x) => /(^|\.)owner(\.name|Name|\.fullName)?$/i.test(String((x && x.key) || ""))) || {}).key;
    return c ? { listKey: l.list_key, col: c } : null;
  }
  // その人が、リスト管理のどの所有者か（名簿にメールで登録されていれば名簿の SF 氏名・Zoom 名、無ければ kinbot の名前で照らす）。10分覚える
  const _ownerMemo = new Map();
  async function todayOwnerOf(u, bm) {
    const ck = `${u}|${bm.listKey}|${bm.col}`, c = _ownerMemo.get(ck); if (c && Date.now() - c.at < 10 * 60 * 1000) return c.v;
    const forms = new Set();
    const kname = (await nameMap()).get(u) || "";
    const reg = await loadPeople().catch(() => new Map());
    for (const p of MCDASH_ROSTER.is) if (rosterEmailOf(reg, "is", p.sf) === u || (kname && rosterHit(kname, [p]))) for (const f of rosterForms(p)) forms.add(f);
    if (foldPersonName(kname)) forms.add(foldPersonName(kname));
    const vals = forms.size ? await mcBalesValues(bm.listKey, bm.col).catch(() => []) : [];
    const v = (vals.find((x) => forms.has(foldPersonName(x.v))) || {}).v || "";
    _ownerMemo.set(ck, { at: Date.now(), v }); return v;
  }
  // 入れ先のリスト（無ければ作る。作るときは、いま使っているリストのトークを写す＝初日から「トークが無い」で止めないため）。閉じていれば null
  let _todayListP = null;
  async function todayList() {
    const r = (await P().query(`SELECT id, closed FROM mc_call_lists WHERE today_src AND biz=$1 ORDER BY id LIMIT 1`, [BIZ])).rows[0];
    if (r) return r.closed ? null : r.id;
    if (!_todayListP) _todayListP = (async () => {
      const id = (await P().query(`INSERT INTO mc_call_lists (name, note, members, created_by, today_src) VALUES ($1,$2,'{}',$3,true) RETURNING id`,
        [TODAY_LIST_NAME, "リスト管理の今日かけるリストを、所有者ごとに毎日入れます（自動）。閉じると「かける」は今までの出し方に戻ります", "自動（今日かけるリスト）"])).rows[0].id;
      const src = (await P().query(`SELECT t.list_id FROM mc_call_talks t JOIN mc_call_lists l ON l.id=t.list_id WHERE t.active AND NOT l.closed AND NOT l.stock AND l.biz=$1 AND l.id <> $2 GROUP BY t.list_id ORDER BY max(t.created_at) DESC LIMIT 1`, [BIZ, id])).rows[0];
      if (src) await saveTalks(id, (await activeTalks(src.list_id)).map((t) => ({ label: t.label, body: t.body })), "自動（今日かけるリスト）");
      console.log(`[mccall] 「${TODAY_LIST_NAME}」を作りました（id ${id}${src ? `・トークはリスト ${src.list_id} から写した` : "・トークなし"}）`);
      return id;
    })().finally(() => { _todayListP = null; });
    return _todayListP;
  }
  // その人の今日の分を MOCHICALL に入れる（担当を付け、today_day に今日の日付）。同じ日の同じ中身なら10分に1回だけ（ほかの人が開いていて移せなかった分を拾い直す）
  const _todaySync = new Map();
  async function syncToday(u, owner, bm, tid) {
    const day = todayDay();
    const t = await mcBalesToday(bm.listKey, { col: bm.col, val: owner }); if (!t) return null;
    const ck = `${day}|${bm.listKey}|${owner}|${tid}|${t.made_at ? new Date(t.made_at).getTime() : ""}`, prev = _todaySync.get(u);
    if (prev && prev.ck === ck && Date.now() - prev.at < 10 * 60 * 1000) return prev.res;
    // 今日の分が0件で作られたときは、今日かけるリストの出し方をやめて今までの出し方（担当のリストすべて）に戻す（2026-11-25 福井さん「今かける企業はありません」で架電が止まった）。
    //   0件のまま今日かけるリストの出し方を続けると「かける」が空になり、インターンが1社もかけられず止まる。
    //   このとき今日の印も消さない（主のリストの判定が一時的にずれただけなら、直ったときにそのまま戻れるように）
    if (!(t.keys || []).length) {
      console.warn(`[mccall] 今日かけるリスト ${u}（${owner}）が0件で作られました（リスト ${bm.listKey}）。今までの出し方で出します`);
      _todaySync.set(u, { ck, at: Date.now(), res: null }); return null;
    }
    const sks = (t.keys || []).map((k) => `${bm.listKey}|${k}`);
    const ex = sks.length ? (await P().query(`SELECT id, src_key, dup_of FROM mc_call_leads WHERE src='bales' AND src_key = ANY($1) ORDER BY (dup_of IS NULL) DESC, id`, [sks])).rows : [];
    const found = new Map(); for (const r of ex) if (!found.has(r.src_key)) found.set(r.src_key, r.dup_of || r.id);
    const ids = [...found.values()]; let added = 0, banned = 0;
    const miss = (t.keys || []).filter((k) => !found.has(`${bm.listKey}|${k}`));
    if (miss.length) {
      await banListOrStop();
      const rows = (await P().query(`SELECT row_key, data, hot, sf->'lead'->>'id' AS lid FROM mochica_bales_rows WHERE list_key=$1 AND row_key = ANY($2::text[])`, [bm.listKey, miss])).rows;
      for (const r of rows) {
        const f = fromBales(r.data || {});
        const x = await addLeadUnique({ list_id: tid, src: "bales", src_key: `${bm.listKey}|${r.row_key}`, company: f.company, phone: f.phone, person: f.person, sf_lead_id: r.lid || null, hot: r.hot, assigned_to: u }, { data: r.data });
        if (x.added) { added++; ids.push(x.id); } else if (x.banned) banned++;
        else if (x.dup && x.dup.lead_id) { const d = (await P().query(`SELECT COALESCE(dup_of, id) AS id FROM mc_call_leads WHERE id=$1`, [x.dup.lead_id])).rows[0]; if (d) ids.push(d.id); }   // 別の取り込みで入っている同じ会社
      }
      if (added) mynaviEnqueue(rows.map((r) => fromBales(r.data || {}).company)).catch((e) => console.error("[mccall] マイナビの調べを始められませんでした", e.message));
    }
    // 今日の分を作り直した（リスト管理の作り直し・担当の付け替え）ときは、外れたリードの今日の印を外す（前の中身が「かける」に残らないように）。
    //   外すのは同じ主のリストから入れたリードだけ（2026-11-25：CSV を足したとき主のリストがそれに切り替わり、朝からの今日の分の印が全部外れて「かける」が空になった。
    //   別のリストで作られた今日の分では、ほかのリストから入れた印を消さない）
    await P().query(`UPDATE mc_call_leads SET today_day=NULL WHERE list_id=$1 AND assigned_to=$2 AND today_day=$3 AND NOT (id = ANY($4::int[]))
      AND src='bales' AND left(src_key, length($5::text) + 1) = $5::text || '|'`, [tid, u, day, [...new Set(ids)], bm.listKey]);
    // 終わったリード（アポ・NG など）と、ほかの人が今開いているリードは動かさない。トークはリストごとなので、移したリードは選び直す
    const mv = ids.length ? await P().query(`UPDATE mc_call_leads SET talk_label = CASE WHEN list_id = $2 THEN talk_label ELSE NULL END, list_id=$2, assigned_to=$3, today_day=$4
      WHERE id = ANY($1::int[]) AND NOT done AND dup_of IS NULL AND (locked_by IS NULL OR locked_by=$3 OR locked_at < now() - interval '10 minutes')`, [[...new Set(ids)], tid, u, day]) : { rowCount: 0 };
    const res = { owner, n: (t.keys || []).length, ready: mv.rowCount, added, banned, exp: t.exp || 0, due_nurture: t.due_nurture || 0, due_other: t.due_other || 0, pastlost: t.pastlost || 0, newlist: t.newlist || 0, made_at: t.made_at };
    if (added || mv.rowCount < res.n) console.log(`[mccall] 今日かけるリスト ${u}（${owner}）：${res.n}件中 ${mv.rowCount}件を「かける」へ（新しく入れた ${added}・禁止 ${banned}）`);
    _todaySync.set(u, { ck, at: Date.now(), res }); return res;
  }
  // 「かける」を今日かけるリストから出す人なら { tid, day, info }。そうでなければ null（今までどおり）
  const _todayFlight = new Map();
  async function todayModeFor(u) {
    const bm = await balesMain(); if (!bm) return null;
    const owner = await todayOwnerOf(u, bm); if (!owner) return null;
    const tid = await todayList(); if (!tid) return null;
    if (!_todayFlight.has(u)) _todayFlight.set(u, syncToday(u, owner, bm, tid).finally(() => _todayFlight.delete(u)));   // 同じ人の読み込みが重なっても1回だけ作る
    const info = await _todayFlight.get(u); if (!info) return null;
    return { tid, day: todayDay(), info };
  }

  // Bales の追いかけ中のリードを、Bales の今の所有者のまま MOCHICALL の本人へ引き継ぐ（2026-11-24 福井さん
  //   「リードステージがコネクト情報やジャッジでリサイクルではない、かつ最終架電が営業フォローのリストを、そのまま MOCHICALL のインターン生個人リードに追加して引き継ぐ」）。
  //   対象＝主リストの、ステージにコネクト情報かジャッジ（リサイクル・アーカイブは除く）で、最終架電結果が営業フォローのもの（MOCHICA ユーザー・まとめた重複は除く）。
  //   所有者は Bales の所有者の列そのもの（kinbot の中の割り振り・未割り振りは見ない）。所有者の名前が当たる MOCHICA のインターンだけに渡す。
  //   入れ先は今日かけるリスト（today_src）で、担当＝本人・掛け直し＝Bales の次の予定（無い・過ぎていれば今）。今日かけるリストの人の「かける」は
  //   今日の分＋本人の掛け直しだけなので、掛け直しの時刻を付けないと出ない。すでに MOCHICALL にあるリードは移して担当と時刻だけ付ける（終わったもの・開いているものは動かさない）。
  //   既定は下見（件数と中身だけ）。?run=1 で入れる。何度呼んでも同じリードは増えない
  app.post("/api/mccall/bales-handover", adminOnly(async (req, res) => {
    const run = req.query.run === "1";
    const bm = await balesMain(); if (!bm) return res.status(404).json({ error: "Bales の主リストがありません" });
    const tid = await todayList(); if (!tid) return res.status(409).json({ error: `「${TODAY_LIST_NAME}」が閉じています` });
    const lst = (await P().query(`SELECT run_at, name FROM mochica_bales_lists WHERE list_key=$1`, [bm.listKey])).rows[0];
    const rows = (await P().query(`SELECT row_key, data, hot, sf->'lead'->>'id' AS lid, data->>$3 AS owner FROM mochica_bales_rows
      WHERE list_key=$1 AND run_at=$2 AND dup_of IS NULL AND NOT ${BALES_MCU}
        AND COALESCE(data->>'lastLeadStageName','') ~ '(コネクト情報|ジャッジ)' AND COALESCE(data->>'lastLeadStageName','') !~ '(リサイクル|アーカイブ)'
        AND COALESCE(data->>'callResult','') ~ '営業フォロー' ORDER BY COALESCE(hot,0) DESC, row_key`, [bm.listKey, lst.run_at, bm.col])).rows;
    // MOCHICA のインターン（名簿のインサイドと、インターンと判定された kinbot の人）→ Bales の所有者の書き方
    const users = (await listUsers().catch(() => [])).filter((x) => x && x.email);
    const reg = await loadPeople(true).catch(() => new Map());
    const cand = new Set();
    for (const p of MCDASH_ROSTER.is) { const e = rosterEmailOf(reg, "is", p.sf); if (e) cand.add(String(e).toLowerCase()); }
    for (const x of users) cand.add(String(x.email).toLowerCase());
    const byOwner = new Map();   // 所有者（そろえた名前）→ [メール]
    for (const e of cand) {
      if (!(await isMcIntern(e).catch(() => false))) continue;
      const v = foldPersonName(await todayOwnerOf(e, bm)); if (!v) continue;
      byOwner.set(v, [...(byOwner.get(v) || []), e]);
    }
    // まだ kinbot にログインしていないインターン（2026-11-24 朝の時点で8名とも未ログイン・名簿のメール未登録）にも渡せるよう、
    //   Bales の行にある所有者本人のメール（次の予定の担当者の欄）でも引く。名簿のインサイドに名前が当たる所有者だけ。
    //   本人がそのメールでログインすれば、担当が本人のまま「かける」に出る
    const mailCnt = new Map(), mailWho = new Map();
    // Bales の名前が名字だけの人（足立・趙・小賀坂）は、名簿の名字と1人だけ当たればその人にする
    const rosterOf = (n) => { const full = MCDASH_ROSTER.is.filter((p) => rosterHit(n, [p])); if (full.length === 1) return full[0];
      const sur = MCDASH_ROSTER.is.filter((p) => foldPersonName(p.name) === foldPersonName(n)); return sur.length === 1 ? sur[0] : null; };
    for (const x of (await P().query(`SELECT d->>('nextActions.' || i || '.owner.name') AS n, lower(d->>('nextActions.' || i || '.owner.email')) AS e, count(*)::int AS c
        FROM (SELECT data AS d FROM mochica_bales_rows WHERE list_key=$1 AND run_at=$2) t, generate_series(0, 9) i
        WHERE d->>('nextActions.' || i || '.owner.email') LIKE '%@%' GROUP BY 1, 2`, [bm.listKey, lst.run_at])).rows) {
      const k = foldPersonName(x.n), p = rosterOf(x.n); if (!k || !p) continue;
      const m = mailCnt.get(k) || new Map(); m.set(x.e, (m.get(x.e) || 0) + x.c); mailCnt.set(k, m); mailWho.set(k, p.sf);
    }
    for (const [k, m] of mailCnt) if (!byOwner.has(k)) byOwner.set(k, [...m.keys()]);
    const names = await nameMap();
    for (const [k, m] of mailCnt) for (const e of m.keys()) if (!names.has(e)) names.set(e, `${mailWho.get(k) || k}（未ログイン）`);
    const now = Date.now();
    const nextOf = (d) => { let t = null; for (let i = 0; i < 50; i++) { if (d[`nextActions.${i}.id`] == null && d[`nextActions.${i}.reservedAt`] == null) break;
      if (String(d[`nextActions.${i}.isDone`]) === "true") continue; const x = Date.parse(d[`nextActions.${i}.reservedAt`]); if (Number.isFinite(x) && (t == null || x < t)) t = x; }
      return t != null && t > now ? new Date(t) : new Date(now); };
    if (run) await banListOrStop();
    const per = new Map(), skip = { noOwner: [], notIntern: new Map(), twoPeople: new Map(), banned: [], done: [], busy: [] }, items = [];
    let added = 0, moved = 0;
    for (const r of rows) {
      const d = r.data || {}, f = fromBales(d), o = String(r.owner || "").trim();
      const it = { company: f.company, owner: o, stage: d.lastLeadStageName || "", lastCalled: String(d.lastCalledAt || "").slice(0, 10), comment: String(d.lastCalledComment || d.lastActivityComment || "").slice(0, 80) };
      if (!o) { skip.noOwner.push(it.company); continue; }
      const who = byOwner.get(foldPersonName(o)) || [];
      if (!who.length) { skip.notIntern.set(o, (skip.notIntern.get(o) || 0) + 1); continue; }
      if (who.length > 1) { skip.twoPeople.set(o, who); continue; }
      const u = who[0], next = nextOf(d), sk = `${bm.listKey}|${r.row_key}`;
      it.to = names.get(u) || u; it.next = next.toISOString();
      if (approachBanHitSync({ company: f.company, phone: f.phone, leadId: r.lid })) { skip.banned.push(it.company); continue; }
      // すでに MOCHICALL にある（同じ行から入れた・同じ会社の別の取り込み）なら、それを本人の掛け直しにする
      let id = ((await P().query(`SELECT COALESCE(dup_of, id) AS id FROM mc_call_leads WHERE src='bales' AND src_key=$1 ORDER BY (dup_of IS NULL) DESC, id LIMIT 1`, [sk])).rows[0] || {}).id || null;
      if (!id && run) {
        const x = await addLeadUnique({ list_id: tid, src: "bales", src_key: sk, company: f.company, phone: f.phone, person: f.person, sf_lead_id: r.lid || null, hot: r.hot, assigned_to: u, next_at: next }, { data: d });
        if (x.added) { added++; per.set(u, (per.get(u) || 0) + 1); it.how = "新しく入れた"; items.push(it); continue; }
        if (x.banned) { skip.banned.push(it.company); continue; }
        if (x.dup && x.dup.lead_id) id = ((await P().query(`SELECT COALESCE(dup_of, id) AS id FROM mc_call_leads WHERE id=$1`, [x.dup.lead_id])).rows[0] || {}).id || null;
        if (!id) { skip.done.push(`${it.company}（入れられない：${(x.dup && x.dup.kind) || "形"}）`); continue; }
      }
      if (!id) { per.set(u, (per.get(u) || 0) + 1); it.how = "新しく入れる"; items.push(it); added++; continue; }   // 下見
      const cur = (await P().query(`SELECT done, locked_by, locked_at, assigned_to, next_at FROM mc_call_leads WHERE id=$1`, [id])).rows[0];
      if (!cur || cur.done) { skip.done.push(it.company); continue; }
      if (cur.locked_by && cur.locked_by !== u && Date.parse(cur.locked_at) > now - 10 * 60e3) { skip.busy.push(it.company); continue; }
      // MOCHICALL でもう掛け直しの時刻が決まっていれば、そちらを使う（本人が決めた約束を上書きしない）
      if (cur.next_at) it.next = new Date(cur.next_at).toISOString();
      if (run) await P().query(`UPDATE mc_call_leads SET talk_label = CASE WHEN list_id = $2 THEN talk_label ELSE NULL END, list_id=$2, assigned_to=$3, next_at=COALESCE(next_at, $4)
        WHERE id=$1 AND NOT done`, [id, tid, u, next]);
      moved++; per.set(u, (per.get(u) || 0) + 1); it.how = run ? "移して担当にした" : "移して担当にする"; items.push(it);
    }
    const out = { ok: true, run, list: { key: bm.listKey, name: lst.name, at: lst.run_at }, into: TODAY_LIST_NAME, target: rows.length, added, moved,
      per: [...per.entries()].map(([e, n]) => ({ email: e, name: names.get(e) || e, n })).sort((a, b) => b.n - a.n),
      skip: { noOwner: skip.noOwner.length, notIntern: [...skip.notIntern.entries()].map(([o, n]) => ({ owner: o, n })).sort((a, b) => b.n - a.n),
        twoPeople: [...skip.twoPeople.entries()].map(([o, e]) => ({ owner: o, emails: e })), banned: skip.banned.length, done: skip.done, busy: skip.busy },
      owners: [...byOwner.entries()].map(([o, e]) => ({ owner: o, emails: e })), items };
    if (run) console.log(`[mccall] Bales の営業フォローを引き継いだ：${added + moved}件（新しく ${added}・移した ${moved}）by ${me(req)}`);
    res.json(out);
  }));

  app.get("/api/mccall/queue", guard(async (req, res) => {
    let ids = await myListIds(req); const listId = parseInt(req.query.list, 10);
    const u = me(req);
    // 商材で分ける（2026-11-24 福井さん）。list=-1 は「キャリミキのリストすべて」。
    //   「担当のリストすべて」（list なし）は MOCHICA のリストだけにする（キャリミキの会社が MOCHICA のトークの流れに混ざらないように）
    const prod = ids.length ? new Map((await P().query(`SELECT id, product FROM mc_call_lists WHERE id = ANY($1)`, [ids])).rows.map((r) => [r.id, r.product || "mochica"])) : new Map();
    // リストを1本（またはキャリミキすべて）選んだときは、今日かけるリストの人でも選んだリストからかける（2026-11-24 福井さん「リスト選択が止まっていて選べない」）
    const cmPick = listId === -1 || listId > 0;
    if (listId === -1) ids = ids.filter((x) => prod.get(x) === "careermixer");
    else if (!(listId > 0)) ids = ids.filter((x) => prod.get(x) !== "careermixer");
    // 今日かけるリストの人は、入れ先のリスト（と本人の掛け直しのあるリスト）だけ。画面のリストの選び方は使わない（2026-11-23 福井さん）。
    //   ただしキャリミキを選んだときは、今日かけるリスト（MOCHICA）ではなく選んだキャリミキのリストからかける
    let tm = null;
    try { if (!cmPick) tm = await todayModeFor(u); }
    catch (e) { if (/禁止/.test(String(e && e.message))) return res.json({ ok: true, items: [], later: 0, noTalk: [], researching: 0, stop: "ban" }); console.error("[mccall] 今日かけるリストを読めませんでした（今までの出し方で出します）", e.message); }
    if (tm && !ids.includes(tm.tid)) ids.push(tm.tid);
    // 担当のリストが1本も無いときは、なぜかを返す（インターンと判定されていない／リストのメンバーに入っていない／リストが無い）。
    //   画面に「何をすればよいか」まで出して、本人も管理者も迷わないようにする（2026-11-23 福井さん「初週を止めずに回す」）
    if (!ids.length) return res.json({ ok: true, items: [], later: 0, noTalk: [], researching: 0, why: await whyNoList(req) });
    const asked = tm ? ids : listId > 0 ? ids.filter((x) => x === listId) : ids;
    // 売り先（リスト）と売り方（トーク）はセット。トークの無いリストは「かける」に出さない（2026-11-20 福井さん）
    const withTalk = await listsWithTalk(asked);
    const use = asked.filter((x) => withTalk.has(x));
    const noTalk = tm ? (withTalk.has(tm.tid) ? [] : [TODAY_LIST_NAME])   // 今日かけるリストの人は、入れ先のリストのトークだけが要る
      : asked.length > use.length ? (await P().query(`SELECT name FROM mc_call_lists WHERE id = ANY($1) AND NOT closed AND NOT stock`, [asked.filter((x) => !withTalk.has(x))])).rows.map((r) => r.name) : [];
    const today = tm ? { ...tm.info, list: tm.tid } : null;
    if (!use.length) return res.json({ ok: true, items: [], later: 0, noTalk, researching: 0, today });
    // アプローチ禁止の名簿が読めないときは順番を出さない（禁止の会社に架けないための安全側）。
    //   ただし「エラー」ではなく、なぜ止まっているか・どうすればよいかを画面に出し、画面は少しずつ読み直す
    try { await banListOrStop(); }
    catch { return res.json({ ok: true, items: [], later: 0, noTalk, researching: 0, stop: "ban", today }); }
    // 今日かけるリストの人：今日の分（入れ先のリストで本人の担当・today_day が今日）＋時刻が来た本人の掛け直し（担当が本人か、担当なしで最後にかけたのが本人）。
    //   tid は数・day は日付の形なので、そのまま SQL に書く（ほかの問い合わせと $ の数を変えないため）
    const todayW = tm && /^\d{4}-\d{2}-\d{2}$/.test(tm.day) ? ` AND ((list_id = ${Number(tm.tid)} AND assigned_to = $2 AND today_day = '${tm.day}')
        OR (next_at IS NOT NULL AND (assigned_to = $2 OR (assigned_to IS NULL AND (SELECT g.caller FROM mc_call_logs g WHERE g.lead_id = mc_call_leads.id AND NOT g.undone ORDER BY g.created_at DESC LIMIT 1) = $2))))` : "";
    const base = `list_id = ANY($1) AND NOT done AND dup_of IS NULL AND (next_at IS NULL OR next_at <= now())
        AND (assigned_to IS NULL OR assigned_to=$2) AND (locked_by IS NULL OR locked_by=$2 OR locked_at < now() - interval '10 minutes')${todayW}`;
    const order = `(next_at IS NOT NULL) DESC, next_at, COALESCE(hot,0) DESC, attempts, id`;
    // 順番は mccadence.js の rankQueue で決める（約束の掛け直し → 時刻が来た掛け直し → ホット度・検討時期・在席時間の順）。SQL では候補を多め（300件）に絞るだけ
    const rankOrder = `(next_at IS NOT NULL) DESC, COALESCE(next_why = $3, false) DESC, next_at, COALESCE(hot,0) DESC, attempts, id`;
    const cols = `id, company, person, hot, attempts, next_at, next_why, last_outcome, cross_from, miss_streak, hearing, gate, phone, info, sf_lead_id, (research_at IS NOT NULL) AS researched`;
    // 企業調査が終わった会社を先に出す（架電者が調べなくてよいように）。
    //   調べ終わった会社が足りないときは、まだの会社も後ろに足して出す（「調査中」と出すだけで、かけてよい）。
    //   以前は調べ終わるまで出さなかったので、8人が同時にかけると調べが追いつかず「かける」が空になって待つことがあった（2026-11-23）
    const gate = researchGate();
    const cand0 = (await P().query(`SELECT ${cols} FROM mc_call_leads
      WHERE ${base}${gate ? " AND research_at IS NOT NULL" : ""} ORDER BY ${rankOrder} LIMIT 300`, [use, u, WHY_HUMAN])).rows;
    let researching = 0;
    if (gate) {
      const wait = (await P().query(`SELECT ${cols} FROM mc_call_leads WHERE ${base} AND research_at IS NULL ORDER BY ${rankOrder} LIMIT 60`, [use, u, WHY_HUMAN])).rows;
      researchSoon(wait.slice(0, 12).map((r) => r.id));
      if (wait.length) {
        researching = +(await P().query(`SELECT count(*) FROM mc_call_leads WHERE ${base} AND research_at IS NULL`, [use, u])).rows[0].count;
        if (cand0.length < 60) cand0.push(...wait);
      }
    }
    // アプローチ禁止の会社は順番に出さない（取り込んだあとで禁止になった会社も、ここで毎回はじく）
    const cand = cand0.filter((r) => !approachBanHitLeadSync(r));
    // 掛け直しの約束・時刻が来た掛け直し（tier 0・1）と調べ終わった会社を前に、まだ調べていない会社を後ろに
    const ranked = rankQueue(cand);
    const front = (r) => r.tier < 2 || r.researched;
    // 画面に渡すのは必要な項目だけ（受付で聞いた直通などを、順番の一覧に載せない）
    const items = [...ranked.filter(front), ...ranked.filter((r) => !front(r))].slice(0, 60).map(({ hearing, gate: _g, phone: _p, info: _i, sf_lead_id: _s, ...x }) => x);
    const later = (await P().query(`SELECT count(*) FROM mc_call_leads WHERE list_id = ANY($1) AND NOT done AND dup_of IS NULL AND next_at > now() AND next_at < $2${tm ? " AND assigned_to = $3" : ""}`, [use, jstAt(new Date(), 23, 59), ...(tm ? [u] : [])])).rows[0].count;
    // 出せる会社が無いときは、残りがどこにあるか（ほかの人の担当・ほかの人が開いている）を返す
    let why = null;
    if (!items.length) {
      const r = (await P().query(`SELECT count(*) FILTER (WHERE assigned_to IS NOT NULL AND assigned_to <> $2) AS others,
          count(*) FILTER (WHERE (assigned_to IS NULL OR assigned_to = $2) AND locked_by IS NOT NULL AND locked_by <> $2 AND locked_at >= now() - interval '10 minutes') AS locked,
          count(*) FILTER (WHERE next_at > now()) AS waiting
        FROM mc_call_leads WHERE list_id = ANY($1) AND NOT done AND dup_of IS NULL`, [use, u])).rows[0];
      why = { others: +r.others, locked: +r.locked, waiting: +r.waiting };
    }
    // 今日かけるリストの人は、今日の分のうち残り（まだ終わっていない・今かけられる）も返す
    if (today) today.left = +(await P().query(`SELECT count(*) FROM mc_call_leads WHERE list_id=$1 AND assigned_to=$2 AND today_day=$3 AND NOT done AND dup_of IS NULL`, [tm.tid, u, tm.day])).rows[0].count;
    res.json({ ok: true, items: items.map((x) => ({ ...x, outcome: outcomeLabel(x.last_outcome), streak: x.miss_streak || 0, why: x.reasons })), later: +later, noTalk, researching, why, today });
  }));
  // ---- 管理者：インサイドの「かける」の状態（2026-11-23 福井さん「初週を止めずに回す」）----
  //   ダッシュボードの名簿のインサイド8名と、MOCHICA のインターンと判定された人について、
  //   「かける」に会社が出るか・出ないなら何が足りないか（アカウント・インターン判定・リスト・トーク・担当・企業調査）を1行ずつ返す。
  //   朝いちばんに管理者がこれを見れば、8人に1人ずつログインしてもらわなくても詰まりが分かる
  app.get("/api/mccall/readiness", adminOnly(async (req, res) => {
    const users = (await listUsers().catch(() => [])).filter((x) => x && x.email);
    const uName = new Map(users.map((x) => [String(x.email).toLowerCase(), x.name]));
    // 名簿の人は、メールで登録されていればその人。未登録なら名前で補う（その場合は「メール未登録」と出す）
    const reg = await loadPeople(true);
    const people = [];
    const seen = new Set();
    for (const p of MCDASH_ROSTER.is) {
      const e = rosterEmailOf(reg, "is", p.sf);
      if (e) { seen.add(e); people.push({ name: uName.get(e) || p.sf, email: e, roster: true, key: p.sf, noEmail: false }); continue; }
      const hit = users.filter((x) => !(reg.get(String(x.email).toLowerCase()) || {}).is && rosterHit(x.name, [p]));
      if (!hit.length) { people.push({ name: p.sf || p.name, email: "", roster: true, key: p.sf, noEmail: true }); continue; }
      for (const x of hit) { const e2 = String(x.email).toLowerCase(); if (!seen.has(e2)) { seen.add(e2); people.push({ name: x.name || e2, email: e2, roster: true, key: p.sf, noEmail: true }); } }
    }
    for (const x of users) {
      const e = String(x.email).toLowerCase(); if (seen.has(e)) continue;
      if (await isMcIntern(e).catch(() => false)) { seen.add(e); people.push({ name: x.name || e, email: e, roster: false }); }
    }
    let banOk = true; try { await banListOrStop(); } catch { banOk = false; }
    const gate = researchGate();
    const items = [];
    for (const p of people) {
      if (!p.email) { items.push({ ...p, level: "stop", msg: "kinbot のアカウントが見つかりません（メール未登録）。本人に kinbot へログインしてもらい、下の「名簿とメール」でそのメールを登録してください" }); continue; }
      const intern = await isMcIntern(p.email).catch(() => false);
      const ids = await listIdsFor(p.email, {});
      const talk = await listsWithTalk(ids);
      const use = ids.filter((x) => talk.has(x));
      const c = use.length ? (await P().query(`SELECT
          count(*) FILTER (WHERE (assigned_to IS NULL OR assigned_to=$2) AND (next_at IS NULL OR next_at <= now())) AS now,
          count(*) FILTER (WHERE (assigned_to IS NULL OR assigned_to=$2) AND (next_at IS NULL OR next_at <= now()) AND research_at IS NULL) AS unresearched,
          count(*) FILTER (WHERE assigned_to IS NOT NULL AND assigned_to <> $2) AS others
        FROM mc_call_leads WHERE list_id = ANY($1) AND NOT done AND dup_of IS NULL`, [use, p.email])).rows[0] : { now: 0, unresearched: 0, others: 0 };
      const n = { lists: ids.length, talkLists: use.length, now: +c.now, unresearched: +c.unresearched, others: +c.others };
      let level = "ok", msg = `今かけられる会社 ${n.now}件${n.unresearched && gate ? `（うち企業調査中 ${n.unresearched}件。調査中でもかけられます）` : ""}`;
      if (!intern && !ids.length) { level = "stop"; msg = `MOCHICA のインターンと判定されていません（kinbot の名前「${p.name}」が名簿と合いません）。kinbot の名前を SF の氏名にそろえるか、メンバー設定で「kincall だけ」＋事業 MOCHICA にしてください`; }
      else if (!ids.length) { level = "stop"; msg = "入れるリストがありません。リストのメンバーに入れるか、メンバーを空（MOCHICA 全員）にしてください"; }
      else if (!use.length) { level = "stop"; msg = "入れるリストのどれにもトークがありません。「リストの管理」でトークを書いてください"; }
      else if (!banOk) { level = "stop"; msg = "アプローチ禁止の名簿が読めないため、全員の「かける」を止めています。少し待って直らなければ、データベースと SF のつながりを確かめてください"; }
      else if (!n.now) { level = "stop"; msg = n.others ? `今かけられる会社がありません（残り ${n.others}件はほかの人の担当）。担当を付け直すか、リードを足してください` : "今かけられる会社がありません。リードを足してください"; }
      else if (n.now < 20) { level = "warn"; msg += "。今日のうちに無くなりそうです。リードを足してください"; }
      // 名前で判定している人は「メール未登録」と添える（名前が変わると外れるので、メールで登録してもらう）
      if (p.noEmail) { msg += "（メール未登録：名前で判定しています。下の「名簿とメール」で登録してください）"; if (level === "ok") level = "warn"; }
      items.push({ ...p, intern, ...n, level, msg });
    }
    res.json({ ok: true, items, banOk, research: researchState() });
  }));

  // ---- 管理者：名簿とメール（2026-11-23 福井さん決定「本人をメールで登録する」）----
  //   名簿（インサイド・営業・架電の管理者）の1行ずつに、kinbot のログインのメールを結びつける。
  //   未登録の行には、名前で当たった人を「候補」として出す（押せば登録できるように）
  app.get("/api/mccall/people", adminOnly(async (req, res) => {
    const users = (await listUsers().catch(() => [])).filter((x) => x && x.email).map((x) => ({ email: String(x.email).toLowerCase(), name: String(x.name || x.email) }));
    const reg = await loadPeople(true);
    const rows = rosterRows().map((r) => {
      const email = rosterEmailOf(reg, r.kind, r.key);
      const guess = email ? "" : (users.find((u) => !(reg.get(u.email) || {})[r.kind] && (r.kind === "admin" ? startsWithSurname(u.name, r.key) : rosterHit(u.name, [r.p]))) || {}).email || "";
      return { kind: r.kind, kindLabel: PEOPLE_KINDS[r.kind], key: r.key, label: r.label, email, guess };
    });
    res.json({ ok: true, rows, users: users.sort((a, b) => a.name.localeCompare(b.name, "ja")) });
  }));
  app.put("/api/mccall/people", adminOnly(async (req, res) => {
    const b = req.body || {};
    const row = rosterRows().find((r) => r.kind === b.kind && r.key === b.key);
    if (!row) return res.status(400).json({ error: "名簿の人が見つかりません。画面を読み直してください" });
    const email = String(b.email || "").trim().toLowerCase();
    if (email && !(await listUsers().catch(() => [])).some((x) => String(x.email || "").toLowerCase() === email)) return res.status(400).json({ error: "そのメールの kinbot のアカウントがありません。先に本人に kinbot へログインしてもらってください" });
    await setPerson(row.kind, row.key, email, me(req));
    if (deps.peopleChanged) deps.peopleChanged();   // 判定の覚えを捨てて、すぐ効くようにする
    res.json({ ok: true });
  }));

  // 担当のリストが無い理由（本人の画面に出す）
  async function whyNoList(req) {
    const u = me(req);
    if (isAdmin(req)) return { kind: "noList" };
    const name = (await nameMap()).get(u) || u;
    const intern = await isMcIntern(u).catch(() => false);
    const member = (await mochicaSet().catch(() => new Set())).has(u);
    const open = +(await P().query(`SELECT count(*) FROM mc_call_lists WHERE biz=$1 AND NOT closed AND NOT stock`, [BIZ])).rows[0].count;
    // MOCHICA の人と判定されていない（名前が名簿と合わない・メンバー設定が無い）と、「MOCHICA 全員」のリストが見えない
    if (!intern && !member) return { kind: "notIntern", name, open };
    return { kind: open ? "notMember" : "noList", name, open };
  }

  // 企業調査だけを読み直す（調査中で開いた会社に、調べ終わったら画面で出すため。1社の中身を全部読み直すと SF なども読みにいくので分ける）
  app.get("/api/mccall/leads/:id/research", guard(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const r = (await P().query(`SELECT list_id, research, research_at FROM mc_call_leads WHERE id=$1`, [id])).rows[0];
    if (!r || !(await myListIds(req)).includes(r.list_id)) return res.status(404).json({ error: "このリードは見つかりません" });
    res.json({ ok: true, research: r.research_at ? showableResearch(r.research) : null });
  }));
  // ---- 1社の中身（開くとほかの人の順番から外す） ----
  app.get("/api/mccall/leads/:id", guard(async (req, res) => {
    const id = parseInt(req.params.id, 10); const u = me(req);
    const lead = (await P().query(`SELECT * FROM mc_call_leads WHERE id=$1`, [id])).rows[0];
    if (!lead) return res.status(404).json({ error: "このリードは見つかりません（リストから外された可能性があります）" });
    const viaInbound = await inboundAllows(u, id, req.query.inbound).catch(() => false);
    if (!viaInbound && !(await myListIds(req)).includes(lead.list_id)) return res.status(403).json({ error: "このリストはあなたの担当ではありません" });
    if (req.query.lock === "1") await P().query(`UPDATE mc_call_leads SET locked_by=$2, locked_at=now() WHERE id=$1`, [id, u]);
    // まだ企業調査が済んでいない会社を開いたら、先に調べるよう頼む（画面は「調査中」と出し、かけるのは止めない）
    if (!lead.research_at) researchSoon([id]);
    const names = await nameMap();
    // 元のデータ（Bales は最新の取り込みを読む。DOC は call_targets を読むだけ）
    let data = {}, sf = null, detail = null;
    if (lead.src === "bales") {
      const [lk, rk] = String(lead.src_key).split("|");
      const r = (await P().query(`SELECT data, sf, detail FROM mochica_bales_rows WHERE list_key=$1 AND row_key=$2`, [lk, rk]).catch(() => ({ rows: [] }))).rows[0];
      if (r) { data = r.data || {}; sf = r.sf || null; detail = r.detail || null; }
    } else if (lead.src === "doc") {
      const t = (await P().query(`SELECT t.company, t.person, t.phone, t.email, t.industry, t.stage, t.status, t.memo, t.assigned_to, l.name AS list_name
        FROM call_targets t LEFT JOIN call_lists l ON l.id=t.list_id WHERE t.id=$1`, [parseInt(lead.src_key, 10)]).catch(() => ({ rows: [] }))).rows[0];
      if (t) data = { ...t, assigned_to: names.get(String(t.assigned_to || "").toLowerCase()) || t.assigned_to };
    } else if (lead.src === "csv" || lead.src === "sf") {
      // SF から足したリードは、足したときの SF の中身を data に持っている（_ で始まる中の項目は画面に出さない）
      data = Object.fromEntries(Object.entries(lead.data || {}).filter(([k]) => !k.startsWith("_")));
    }
    const sfMailP = sfMailOf(req, lead, sf);   // ほかを読むあいだに SF のメールを読んでおく
    const ban = await approachBanHitLead(lead).catch(() => ({ reason: "アプローチ禁止の名簿を確認できなかったため、念のため止めています" }));
    const logs = (await P().query(`SELECT * FROM mc_call_logs WHERE lead_id=$1 AND NOT undone ORDER BY created_at DESC LIMIT 50`, [id])).rows;
    // 番号ごとの「つながった実績」（MOCHICA の記録すべてから。リードが変わっても番号で数える）
    const phones = phonesOf(lead, data);
    if (phones.length) {
      const st = (await P().query(`SELECT regexp_replace(COALESCE(phone,''),'[^0-9]','','g') AS d, count(*) AS n,
          count(*) FILTER (WHERE reach <> 'none') AS reached, count(*) FILTER (WHERE outcome='invalid') AS invalid,
          (array_agg(outcome ORDER BY created_at DESC))[1] AS last, max(created_at) AS last_at
        FROM mc_call_logs WHERE NOT undone AND regexp_replace(COALESCE(phone,''),'[^0-9]','','g') = ANY($1) GROUP BY 1`, [phones.map((p) => p.digits)])).rows;
      const m = new Map(st.map((s) => [s.d, s]));
      for (const p of phones) { const s = m.get(p.digits); p.n = s ? +s.n : 0; p.reached = s ? +s.reached : 0; p.invalid = s ? +s.invalid > 0 : false; p.last = s ? outcomeLabel(s.last) : ""; p.lastAt = s ? jstText(s.last_at) : ""; }
    }
    // DOC でも同じ番号を持っているか（知らせるだけ。止めない）
    let docAlso = [];
    if (lead.src !== "doc" && phones.length) {
      docAlso = (await P().query(`SELECT l.name AS list, t.assigned_to, t.status FROM call_targets t JOIN call_lists l ON l.id=t.list_id
        WHERE NOT l.closed AND regexp_replace(COALESCE(t.phone,''),'[^0-9]','','g') = ANY($1) LIMIT 3`, [phones.map((p) => p.digits)]).catch(() => ({ rows: [] }))).rows
        .map((r) => ({ ...r, assigned_to: names.get(String(r.assigned_to || "").toLowerCase()) || r.assigned_to || "" }));
    }
    // これまで：MOCHICA の架電・Bales の活動・SF の商談を1本の時系列に
    const tl = logs.map((g) => ({ at: g.created_at, src: "kinbot", who: names.get(String(g.caller || "").toLowerCase()) || g.caller, title: outcomeLabel(g.outcome) + (g.reason ? `（${g.reason}）` : ""),
      text: [g.memo, g.gate && (g.gate.name || g.gate.hours || g.gate.direct) ? `受付で聞けたこと：${[g.gate.name && `担当 ${g.gate.name}`, g.gate.hours && `在席 ${g.gate.hours}`, g.gate.direct && `直通 ${g.gate.direct}`].filter(Boolean).join("・")}` : "", g.next_at ? `次回 ${jstText(g.next_at)}` : "", g.apo_at ? `アポ ${jstText(g.apo_at)}${g.apo_who ? `（空いていたクローザー：${g.apo_who}）` : ""}` : ""].filter(Boolean).join("\n"),
      memo: g.memo || "", reach: g.reach, cross: !!g.cross_from, logId: g.id, mine: String(g.caller || "").toLowerCase() === u && Date.now() - new Date(g.created_at).getTime() < 15 * 60e3 }));
    // このリード自身の BALES の行（BALES から入れたリードだけ）
    tl.push(...balesItems(detail, data, sf));
    // 資料送付も同じ時系列に出す（SF に書いた活動は下の SF の読み込みで二重にならないよう外す）
    const sends = (await P().query(`SELECT * FROM mc_doc_sends WHERE lead_id=$1 ORDER BY created_at DESC LIMIT 20`, [id]).catch(() => ({ rows: [] }))).rows;
    for (const s of sends) tl.push({ at: s.created_at, src: "kinbot", who: names.get(String(s.sender || "").toLowerCase()) || s.sender, title: "資料送付",
      text: [`${s.to_addr} に送付${s.cc ? `（CC ${s.cc}）` : ""}`, s.doc_name ? `資料：${s.doc_name}` : "", s.sf_err ? "SF の活動には書けませんでした" : ""].filter(Boolean).join("\n") });
    // ヒアリングのメールも同じ時系列に（何を聞いたかが分かるように）
    const hmails = (await P().query(`SELECT * FROM mc_hear_mails WHERE lead_id=$1 ORDER BY created_at DESC LIMIT 20`, [id]).catch(() => ({ rows: [] }))).rows;
    const hlabel = new Map(HEAR_ITEMS.map((x) => [x.k, x.label]));
    for (const s of hmails) tl.push({ at: s.created_at, src: "kinbot", who: names.get(String(s.sender || "").toLowerCase()) || s.sender, title: "ヒアリングのメール",
      text: [`${s.to_addr} に送付${s.cc ? `（CC ${s.cc}）` : ""}`, (s.keys || []).length ? `聞いたこと：${s.keys.map((k) => hlabel.get(k) || k).join("・")}` : "", s.sf_err ? "SF の活動には書けませんでした" : ""].filter(Boolean).join("\n") });
    // 問い合わせフォームの送信も同じ時系列に（送れなかったものも、なぜかが分かるように出す）
    const forms = (await P().query(`SELECT * FROM mc_form_sends WHERE lead_id=$1 ORDER BY created_at DESC LIMIT 20`, [id]).catch(() => ({ rows: [] }))).rows;
    for (const s of forms) tl.push({ at: s.created_at, src: "kinbot", who: names.get(String(s.sender || "").toLowerCase()) || s.sender, title: "問い合わせフォーム",
      text: [FORM_ST[s.status] || s.status, s.url, s.note, s.sf_err ? "SF の活動には書けませんでした" : ""].filter(Boolean).join("\n") });
    // ほかの元データ（MOCHICA の別リスト・DOC・BALES の別の行・Zoom Phone・SF）を、由来に関係なく電話番号と会社名で集める（mchist.js）。
    //   SHOBO から書いた SF の活動は kinbot の記録と同じものなので、二重に出さないよう外す
    const past = await pastApproach({ lead: { ...lead, sf_lead_id: lead.sf_lead_id || (sf && sf.lead && sf.lead.id) || null }, phones: phones.map((p) => p.digits), names,
      sfOwner: () => sfActor(req), coKey: companyKey, outcomeLabel, ownBalesKey: lead.src === "bales" ? String(lead.src_key) : "",
      skipTaskIds: [...logs.map((g) => g.sf_task_id), ...sends.map((s) => s.sf_task_id), ...hmails.map((s) => s.sf_task_id), ...forms.map((s) => s.sf_task_id)].filter(Boolean) });
    tl.push(...past.items);
    tl.sort((a, b) => new Date(b.at) - new Date(a.at));
    const tlAll = dedupeTimeline(tl); tl.length = 0; tl.push(...tlAll);
    // ひと目で（2026-11-18 福井さん「検討時期・採用ニーズ・過去架電内容が架電時に調べなくても一目でわかるように」）
    //   SF の決まった項目はそのまま出し、言葉は新しい記録から順に読んで最初に当たった1文を出す（いちばん新しい状況を見せるため）。
    //   kinbot の記録は自動で足した「次回 〇/〇」などで時期と取り違えないよう、メモだけを読む。
    //   根拠は相手の発言（架電の記録）だけ。送ったメール・MA の文面は読まない（2026-11-23 福井さん。mchist.js の spokenText）
    const glance = (() => {
      const L = (sf && sf.lead) || {};
      const sfv = (labels) => labels.map((k) => [k, String(L[k] ?? "").trim()]).filter(([, v]) => v);
      const hit = (key) => {
        for (const t of tl) { const s = spokenText(t); if (!s) continue; const j = judgeHot({ comment: s }, null)[key]; if (j.st) return { st: j.st, why: j.why, at: t.at, src: t.src, who: t.who || "" }; }
        const d0 = spokenData(lead.src, data); if (!d0) return null;
        const j = judgeHot(d0, null)[key]; return j.st ? { st: j.st, why: j.why, at: null, src: lead.src === "doc" ? "DOC" : "Bales", who: "" } : null;
      };
      // 架電で聞いたヒアリングをいちばん上に（いちばん新しく、本人から聞いた値なので）
      const H = lead.hearing || {}; const kv = (arr) => arr.filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]);
      const by = H.at ? { at: H.at, who: names.get(String(H.by || "").toLowerCase()) || H.by || "" } : null;
      return { need: { kb: kv([["採用ニーズ", H.need], ["採用目標人数", H.target != null ? `${H.target}名` : ""], ["接触人数", H.contact != null ? `${H.contact}名` : ""]]), by, sf: sfv(["顧客の課題感", "顧客の現状", "採用人数(選択リスト)", "利用中ATS"]), hit: hit("need") },
        when: { kb: kv([["次卒の選考開始", H.when]]), by, sf: sfv(["検討開始時期", "現利用サービス更新予定月"]), hit: hit("when") } };
    })();
    for (const t of tl) delete t.memo;
    const mynavi = await mynaviOf(lead.company).catch(() => null);
    // トーク（リストごと・A/B は会社ごとに決まった1本）。記録にどの版で話したかを残す（2026-11-20 福井さん）
    const talk = await talkForLead(lead).catch(() => null);
    const script = talk ? talk.body : "";
    // 掛け直しの型：何回続けて届かなかったか／次に不在だった場合にいつ掛け直しになるか（記録の前に画面で見せる）
    const streak = lead.miss_streak || 0;
    const cadence = { streak, max: CADENCE.maxMiss, parked: !!lead.parked_at, next: nextMissAt({ streak: streak + 1, gateHours: (lead.gate || {}).hours, rates: await ratesNow() }) };
    // メールは左の欄・ヒアリング欄・資料送付で同じものを使う（mcmail.js）
    const sm = await sfMailP;
    res.json({ ok: true, lead: { ...lead, research: showableResearch(lead.research), data }, script, talk, ban, phones, docAlso, glance, mynavi, cadence, timeline: tl.slice(0, 120), hist: past.status, summary: oneLine(logs[0], lead.gate, names),
      mails: leadMails({ lead, data, sf, sfEmail: sm.email }), mailErr: sm.err,
      sf: sf && sf.lead ? { lead: sf.lead, sum: sf.sum || null } : null, cross: lead.cross_id ? (await P().query(`SELECT from_name, reason, at FROM mc_cross_moves WHERE id=$1`, [lead.cross_id])).rows[0] || null : null });
  }));
  // 開いたまま次へ行かなかったときに順番へ戻す
  app.post("/api/mccall/leads/:id/release", guard(async (req, res) => {
    await P().query(`UPDATE mc_call_leads SET locked_by=NULL WHERE id=$1 AND locked_by=$2`, [parseInt(req.params.id, 10), me(req)]); res.json({ ok: true });
  }));
  // 受付で聞けたことだけを残す（入力欄を離れたら自動で保存）
  app.post("/api/mccall/leads/:id/gate", guard(async (req, res) => {
    const g = req.body || {}; const gate = { name: clip(g.name, 40), hours: clip(g.hours, 30), direct: clip(g.direct, 30), at: new Date().toISOString(), by: me(req) };
    await P().query(`UPDATE mc_call_leads SET gate=$2 WHERE id=$1`, [parseInt(req.params.id, 10), gate]); res.json({ ok: true, gate });
  }));
  // ヒアリングで聞けたことだけを残す（欄を離れたら自動で保存。SF へは「記録して次へ」のときに書く）
  app.post("/api/mccall/leads/:id/hearing", guard(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const lead = (await P().query(`SELECT list_id, hearing FROM mc_call_leads WHERE id=$1`, [id])).rows[0];
    if (!lead) return res.status(404).json({ error: "このリードは見つかりません" });
    if (!(await inboundAllows(me(req), id, (req.body || {}).inbound).catch(() => false)) && !(await myListIds(req)).includes(lead.list_id)) return res.status(403).json({ error: "このリストはあなたの担当ではありません" });
    const h = mergeHearing(lead.hearing, cleanHearing(req.body || {}));
    if (h) { h.at = new Date().toISOString(); h.by = me(req); }
    await P().query(`UPDATE mc_call_leads SET hearing=$2 WHERE id=$1`, [id, h]); res.json({ ok: true, hearing: h });
  }));
  // SF に入る項目の下書き（記録する前に画面に出す）。記録の本文と同じもの（ヒアリング・受付・断り理由・メモ）を送ってもらい、
  //   SF の今の値と比べて「新規・更新・追記・同じ」を返す。書くのは記録したとき（/log → sfWrite）だけで、ここでは書かない
  app.post("/api/mccall/leads/:id/sf-fill/preview", guard(async (req, res) => {
    const id = parseInt(req.params.id, 10); const b = req.body || {};
    const lead = (await P().query(`SELECT list_id, sf_lead_id, hearing, gate FROM mc_call_leads WHERE id=$1`, [id])).rows[0];
    if (!lead) return res.status(404).json({ error: "このリードは見つかりません" });
    if (!(await myListIds(req)).includes(lead.list_id)) return res.status(403).json({ error: "このリストはあなたの担当ではありません" });
    if (!lead.sf_lead_id || !/^00Q[0-9A-Za-z]{12,15}$/.test(lead.sf_lead_id)) return res.json({ ok: true, plan: [], note: "SF のリードと結びついていない会社なので、SF の項目には入りません" });
    const reach = String(b.reach || ""); const outcome = String(b.outcome || "");
    const hearing = reach === "person" ? mergeHearing(lead.hearing, cleanHearing(b.hearing || {})) : null;
    const g = b.gate || {}; const gate = g.name || g.direct ? { name: clip(g.name, 40), direct: clip(g.direct, 30) } : null;
    const cands = fillCands({ hearing, gate, reason: outcome === "reject" ? clip(b.reason, 60) : "", outcome, memo: clip(b.memo, 2000) });
    const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    if (!cands.length) return res.json({ ok: true, plan: [] });
    let cur = null, note = "";
    try { cur = await Promise.race([sfCurrent(await sfActor(req), lead.sf_lead_id), new Promise((_, ng) => setTimeout(() => ng(new Error("SF の返事が遅い")), 5000))]); }
    catch (e) { note = `SF の今の値を読めませんでした（${String(e.message).slice(0, 60)}）。記録したときに比べ直します`; }
    if (cur && cur.IsConverted) return res.json({ ok: true, plan: [], note: "このリードは SF でコンバート済みなので、リードの項目には入りません（活動は残ります）" });
    res.json({ ok: true, plan: planFills(cands, cur || {}, { day }), note, known: !!cur });
  }));
  // リードの状況（SF の Lead.Status）を架電中に変える（2026-11-23 福井さん「リードのリードステージを変更できるように」）。
  //   選択肢は SF の選択リストをそのまま使う（kincall と同じ。組織の値と食い違って書けない、をなくすため）。30分だけ覚える
  let _stPick = null;
  async function statusPicklist(owner) {
    if (_stPick && Date.now() - _stPick.at < 30 * 60e3) return _stPick.v;
    const f = ((await describeObject(owner, "Lead")).fields || []).find((x) => x.name === "Status");
    const all = ((f && f.picklistValues) || []).filter((x) => x.active).map((x) => ({ value: x.value, label: x.label || x.value }));
    // 基本の7つ（01〜05・89・99）だけに絞る（2026-11-24 福井さん）。番号付きの値が1つも無い組織では、元どおり全部出す
    const picked = pickLeadStages(all); const v = picked.length ? picked : all;
    _stPick = { at: Date.now(), v }; return v;
  }
  async function statusLead(req, id) {
    const lead = (await P().query(`SELECT list_id, sf_lead_id FROM mc_call_leads WHERE id=$1`, [id])).rows[0];
    if (!lead) return { code: 404, error: "このリードは見つかりません" };
    if (!(await inboundAllows(me(req), id, (req.body || {}).inbound || req.query.inbound).catch(() => false)) && !(await myListIds(req)).includes(lead.list_id)) return { code: 403, error: "このリストはあなたの担当ではありません" };
    if (!lead.sf_lead_id || !/^00Q[0-9A-Za-z]{12,15}$/.test(lead.sf_lead_id)) return { code: 200, none: "SF のリードと結びついていないので変えられません" };
    return { lead };
  }
  app.get("/api/mccall/leads/:id/sf-status", guard(async (req, res) => {
    const r = await statusLead(req, parseInt(req.params.id, 10));
    if (r.error) return res.status(r.code).json({ error: r.error }); if (r.none) return res.json({ ok: true, options: [], note: r.none, unlinked: true });
    const owner = await sfActor(req);
    const [options, cur] = await Promise.all([statusPicklist(owner), sfCurrent(owner, r.lead.sf_lead_id)]);
    // 今の値が7つ以外の古い名前（「NEW」「LS:89　リサイクル」など）なら、どの段階にあたるかも返す（画面で「旧の値」と分かるように）
    const st = stageOf(cur.Status); const inList = options.some((o) => o.value === cur.Status);
    res.json({ ok: true, options, current: cur.Status || "", converted: !!cur.IsConverted, legacy: cur.Status && !inList ? { label: st ? `${st.code}：${st.name}` : "", desc: st ? st.desc : "" } : null });
  }));
  app.post("/api/mccall/leads/:id/sf-status", guard(async (req, res) => {
    const r = await statusLead(req, parseInt(req.params.id, 10));
    if (r.error) return res.status(r.code).json({ error: r.error }); if (r.none) return res.status(400).json({ error: r.none });
    const owner = await sfActor(req); const st = String((req.body || {}).status || "");
    if (!(await statusPicklist(owner)).some((x) => x.value === st)) return res.status(400).json({ error: "SF のリードの状況にない値です。選び直してください" });
    const cur = await sfCurrent(owner, r.lead.sf_lead_id, true);
    if (cur.IsConverted) return res.status(400).json({ error: "このリードは SF でコンバート済みなので、リードの状況は変えられません" });
    // 05：コンバートが SF で「取引の開始で付く値」になっていると、直接は書けずに断られる。そのときは理由が分かる言い方で返す
    try { await sfUpdateRecord(owner, "Lead", r.lead.sf_lead_id, { Status: st }); }
    catch (e) { if (stageOf(st)?.code === "05") return res.status(400).json({ error: `SF が「${st}」への変更を受け付けませんでした。コンバートは SF の「取引の開始」で行ってください（${String(e.message).slice(0, 80)}）` }); throw e; }
    _sfCur.delete(r.lead.sf_lead_id);
    console.log(`[mccall] リードの状況を変えた lead=${parseInt(req.params.id, 10)} ${cur.Status || "（空）"}→${st} by ${me(req)}`);
    res.json({ ok: true, current: st, prev: cur.Status || "" });
  }));
  // ---- SF のリードと結びついていない会社を、架電画面から SF につなぐ（2026-11-24 福井さん「架電画面から SF リード新規作成」） ----
  //   リードの状況を変えられない・活動が SF に残らない、をその場でなくすため。
  //   重複リードを作らないよう、先に SF の MOCHICA のリードを会社名・電話で探し、あれば「結びつける」を勧める。
  //   新しく作るときのレコードタイプは必ず「Mochica（リード）」（DOC のリードと混ざらないように）。業種は画面で候補を自動推定し、SF の選択肢から確定する。
  const MC_RT = "Mochica（リード）";
  async function mochicaRtId(owner) {
    const d = await sfQuery(owner, `SELECT Id, Name FROM RecordType WHERE SobjectType = 'Lead' AND IsActive = true AND Name LIKE '%Mochica%'`);
    const rs = d.records || []; const r = rs.find((x) => x.Name === MC_RT) || rs[0];
    return r ? r.Id : "";
  }
  const phDigits = (p) => String(p || "").replace(/[^0-9]/g, "");
  // 会社名のゆれ（株式会社の前後・かっこ書き）を落とした芯の部分。SOQL の LIKE で探すのに使う
  const coCore = (c) => String(c || "").replace(/[（(][^）)]*[）)]/g, "").replace(/株式会社|有限会社|合同会社|一般社団法人|一般財団法人|医療法人|社会福祉法人|学校法人|\s/g, "").trim();
  async function linkLead(req, id) {
    const lead = (await P().query(`SELECT list_id, company, person, phone, info, sf_lead_id FROM mc_call_leads WHERE id=$1`, [id])).rows[0];
    if (!lead) return { code: 404, error: "このリードは見つかりません" };
    if (!(await inboundAllows(me(req), id, (req.body || {}).inbound || req.query.inbound).catch(() => false)) && !(await myListIds(req)).includes(lead.list_id)) return { code: 403, error: "このリストはあなたの担当ではありません" };
    if (lead.sf_lead_id && /^00Q[0-9A-Za-z]{12,15}$/.test(lead.sf_lead_id)) return { code: 400, error: "この会社はもう SF のリードと結びついています。画面を読み直してください" };
    return { lead };
  }
  app.get("/api/mccall/leads/:id/sf-create", guard(async (req, res) => {
    const r = await linkLead(req, parseInt(req.params.id, 10)); if (r.error) return res.status(r.code).json({ error: r.error });
    const L = r.lead; const I = L.info || {}; const owner = await sfActor(req);
    const core = coCore(L.company); const dg = phDigits(L.phone);
    const ors = [];
    if (core.length >= 2) ors.push(`Company LIKE '%${soqlStr(core).replace(/[%_]/g, "")}%'`);
    if (L.phone) for (const p of new Set([String(L.phone).trim(), dg].filter((x) => x.length >= 8))) ors.push(`Phone = '${soqlStr(p)}'`, `MobilePhone = '${soqlStr(p)}'`);
    let cands = [], candErr = "";
    if (ors.length) {
      try {
        const recs = (await sfQuery(owner, `SELECT Id, Company, LastName, FirstName, Phone, MobilePhone, Status, IsConverted, Ban_Type__c, Owner.Name, LastActivityDate FROM Lead WHERE RecordType.Name LIKE '%Mochica%' AND (${ors.join(" OR ")}) ORDER BY IsConverted ASC, LastActivityDate DESC NULLS LAST LIMIT 10`)).records || [];
        cands = recs.map((x) => ({ id: x.Id, company: x.Company || "", person: [x.LastName, x.FirstName].filter(Boolean).join(" "), phone: x.Phone || x.MobilePhone || "", status: x.Status || "",
          converted: !!x.IsConverted, ban: x.Ban_Type__c || "", owner: (x.Owner && x.Owner.Name) || "", last: x.LastActivityDate || "",
          samePhone: !!dg && [x.Phone, x.MobilePhone].some((p) => phDigits(p) === dg) }));
      } catch (e) { candErr = `SF の同じ会社を探せませんでした（${String(e.message).slice(0, 80)}）`; }
    }
    const industries = globalThis.kbIndustry ? await globalThis.kbIndustry.options(owner).catch(() => []) : [];
    res.json({ ok: true, cands, candErr, industries,
      fields: { company: L.company || "", person: L.person || "", phone: L.phone || "", email: I.email || "", web: I.web || "" } });
  }));
  app.post("/api/mccall/leads/:id/sf-create", guard(async (req, res) => {
    const id = parseInt(req.params.id, 10); const b = req.body || {};
    const r = await linkLead(req, id); if (r.error) return res.status(r.code).json({ error: r.error });
    const owner = await sfActor(req); let sfId = "", made = false;
    if (b.link) {
      // 既にある SF のリードに結びつける。コンバート済み・アプローチ禁止のものは結びつけない（あとで書けない・かけてはいけないため）
      sfId = String(b.link).replace(/[^0-9A-Za-z]/g, "");
      if (!/^00Q[0-9A-Za-z]{12,15}$/.test(sfId)) return res.status(400).json({ error: "SF のリードの ID ではありません" });
      const x = ((await sfQuery(owner, `SELECT Id, IsConverted, Ban_Type__c, RecordType.Name FROM Lead WHERE Id = '${sfId}'`)).records || [])[0];
      if (!x) return res.status(400).json({ error: "SF にそのリードが見つかりませんでした" });
      if (x.IsConverted) return res.status(400).json({ error: "そのリードは SF でコンバート済みなので結びつけられません" });
      if (x.Ban_Type__c) return res.status(400).json({ error: `そのリードはアプローチ禁止（${x.Ban_Type__c}）になっています。かける前に確かめてください` });
      sfId = x.Id;
    } else {
      const f = b.fields || {}; const s = (v, n) => clip(String(v || "").trim(), n);
      const company = s(f.company, 255); if (!company) return res.status(400).json({ error: "会社名を入れてください" });
      const industry = s(f.industry, 80); if (!industry) return res.status(400).json({ error: "業種を選んでください（SF で必須です）" });
      const opts = globalThis.kbIndustry ? (await globalThis.kbIndustry.options(owner).catch(() => [])).map((o) => o.value) : [];
      if (opts.length && !opts.includes(industry)) return res.status(400).json({ error: "業種は SF の選択肢から選んでください" });
      const rt = await mochicaRtId(owner);
      if (!rt) return res.status(400).json({ error: `SF に「${MC_RT}」のレコードタイプが見つからないので作れません。管理者に確かめてください` });
      const email = s(f.email, 80);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "メールアドレスの形が正しくありません" });
      const fields = { RecordTypeId: rt, Company: company, LastName: s(f.person, 80) || "ご担当者", Industry: industry };
      if (s(f.phone, 40)) fields.Phone = s(f.phone, 40);
      if (email) fields.Email = email;
      if (s(f.web, 255)) fields.Website = s(f.web, 255);
      // 持ち主はかけた本人にする（代理アカウントのままだと、だれのリードか分からなくなるため）。見つからなければ SF の決まりに任せる
      const uid = await sfUserIdByEmail(owner, me(req)).catch(() => ""); if (uid) fields.OwnerId = uid;
      try { sfId = (await sfCreateRecord(owner, "Lead", fields)).id; }
      catch (e) { return res.status(400).json({ error: `SF にリードを作れませんでした：${String(e.message).slice(0, 200)}` }); }
      made = true;
    }
    // 作ったのに結びつけ損ねる、をなくすため、条件付きで書く（同時に別の人がつないでいたら上書きしない）
    const u = await P().query(`UPDATE mc_call_leads SET sf_lead_id=$2 WHERE id=$1 AND (sf_lead_id IS NULL OR sf_lead_id !~ '^00Q') RETURNING id`, [id, sfId.slice(0, 18)]);
    if (!u.rowCount) return res.status(409).json({ error: `ほかの人が先に SF のリードと結びつけていました${made ? `（いま作ったリード ${sfId} は SF に残っています。重複なら SF で消してください）` : ""}` });
    console.log(`[mccall] SF のリードと結びつけた lead=${id} sf=${sfId} ${made ? "新しく作った" : "既存"} by ${me(req)}`);
    res.json({ ok: true, sfId, made });
  }));
  // ---- リードの状況の表記をそろえる（2026-11-24 福井さん「全て表記ゆれも7つの表記に統合および正規化」） ----
  //   SF の未コンバートのリードで、7つの表記（statusPicklist で選んだ値）になっていないものを、番号の値へまとめて書き換える。
  //   管理者だけ。開くと下見（値ごとの件数と行き先）だけを返し、「そろえる」で動かす。1件ずつ前の値を mc_stage_norm に残し、元に戻せる。
  //   範囲は MOCHICA のリード（レコードタイプに Mochica を含む）か、すべてのリード
  const soqlStr = (v) => String(v ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const rtWhere = (scope) => scope === "all" ? "" : ` AND RecordType.Name LIKE '%Mochica%'`;
  async function normPlan(owner, scope) {
    const sv = await stageValues(owner); const keep = new Set(sv.byCode.values());
    const rows = (await sfQuery(owner, `SELECT Status, RecordType.Name rt, COUNT(Id) n FROM Lead WHERE IsConverted = false${rtWhere(scope)} GROUP BY Status, RecordType.Name`)).records || [];
    const m = new Map();
    for (const r of rows) {
      const st = r.Status || ""; if (keep.has(st)) continue;
      const code = st ? normCode(st) : null; const to = code ? sv.byCode.get(code) || null : null;
      const x = m.get(st) || { from: st, to: to && !sv.conv.has(to) ? to : null, why: !st ? "空の値" : !code ? "7つのどれにあたるか決められない" : !to ? "SF に行き先の値が無い" : sv.conv.has(to) ? "コンバートでしか付けられない値" : "", n: 0, rts: {} };
      x.n += r.n; x.rts[r.rt || "（なし）"] = (x.rts[r.rt || "（なし）"] || 0) + r.n; m.set(st, x);
    }
    const items = [...m.values()].sort((a, b) => b.n - a.n);
    return { stages: LEAD_STAGES.map((s) => ({ ...s, value: sv.byCode.get(s.code) || null })), items, move: items.filter((x) => x.to).reduce((a, x) => a + x.n, 0), stay: items.filter((x) => !x.to).reduce((a, x) => a + x.n, 0) };
  }
  const _normJob = { id: null };
  async function normRun(owner, runId, plan, scope) {
    let done = 0, ok = 0, ng = 0;
    const tick = () => P().query(`UPDATE mc_stage_runs SET done=$2, ok=$3, ng=$4 WHERE id=$1`, [runId, done, ok, ng]).catch(() => {});
    try {
      for (const it of plan.items.filter((x) => x.to)) {
        // Status も読む：SOQL の = は大文字小文字を区別しないので、控えには SF の実際の値を残す
        const recs = await sfQueryAll(owner, `SELECT Id, Status FROM Lead WHERE IsConverted = false AND Status = '${soqlStr(it.from)}'${rtWhere(scope)}`, 400000);
        for (let i = 0; i < recs.length; i += 200) {
          const part = recs.slice(i, i + 200);
          // 控えを SF を書き換える前に残す（書き換えたのに前の値が分からない、をなくすため）。結果はあとで書き足す
          const ids = (await P().query(`INSERT INTO mc_stage_norm (run_id, sf_lead_id, old_val, new_val, ok, err) SELECT $1, a, b, $2, false, 'これから' FROM unnest($3::text[], $4::text[]) AS t(a,b) RETURNING id, sf_lead_id`,
            [runId, it.to, part.map((r) => r.Id), part.map((r) => r.Status || it.from)])).rows;
          const byId = new Map(ids.map((r) => [r.sf_lead_id, r.id]));
          const res = await sfUpdateMany(owner, "Lead", part.map((r) => ({ Id: r.Id, Status: it.to })));
          await P().query(`UPDATE mc_stage_norm m SET ok=t.b, err=NULLIF(t.c,'') FROM unnest($1::int[], $2::bool[], $3::text[]) AS t(a,b,c) WHERE m.id=t.a`,
            [part.map((r) => byId.get(r.Id)), res.map((r) => r.ok), res.map((r) => r.error)]);
          done += res.length; ok += res.filter((r) => r.ok).length; ng += res.filter((r) => !r.ok).length; await tick();
        }
      }
      await P().query(`UPDATE mc_stage_runs SET state='done', done=$2, ok=$3, ng=$4, ended_at=now() WHERE id=$1`, [runId, done, ok, ng]);
    } catch (e) {
      console.error("[mccall] リードの状況をそろえる途中で止まりました", runId, e.message);
      await P().query(`UPDATE mc_stage_runs SET state='error', note=$2, done=$3, ok=$4, ng=$5, ended_at=now() WHERE id=$1`, [runId, String(e.message).slice(0, 300), done, ok, ng]).catch(() => {});
    } finally { _normJob.id = null; _stVals = null; _sfCur.clear(); }
  }
  // 元に戻す：その回で書き換えたリードのうち、SF の値がこちらの書いたままのものだけ前の値へ（ほかの人が変えたものは触らない）
  async function normRevert(owner, runId, revId) {
    let done = 0, ok = 0, ng = 0;
    try {
      const rows = (await P().query(`SELECT id, sf_lead_id, old_val, new_val FROM mc_stage_norm WHERE run_id=$1 AND ok AND NOT reverted ORDER BY id`, [runId])).rows;
      for (let i = 0; i < rows.length; i += 200) {
        const part = rows.slice(i, i + 200);
        const now = new Map(((await sfQuery(owner, `SELECT Id, Status FROM Lead WHERE Id IN (${part.map((r) => `'${soqlStr(r.sf_lead_id)}'`).join(",")})`)).records || []).map((r) => [r.Id, r.Status]));
        const back = part.filter((r) => now.get(String(r.sf_lead_id)) === r.new_val);   // 控えの ID は SF から読んだ18桁のままなので、そのまま比べる
        const res = back.length ? await sfUpdateMany(owner, "Lead", back.map((r) => ({ Id: r.sf_lead_id, Status: r.old_val }))) : [];
        const okIds = back.filter((r, j) => res[j] && res[j].ok).map((r) => r.id);
        if (okIds.length) await P().query(`UPDATE mc_stage_norm SET reverted=true WHERE id = ANY($1::int[])`, [okIds]);
        done += part.length; ok += okIds.length; ng += back.length - okIds.length;
        await P().query(`UPDATE mc_stage_runs SET done=$2, ok=$3, ng=$4 WHERE id=$1`, [revId, done, ok, ng]).catch(() => {});
      }
      await P().query(`UPDATE mc_stage_runs SET state='done', done=$2, ok=$3, ng=$4, ended_at=now() WHERE id=$1`, [revId, done, ok, ng]);
    } catch (e) {
      await P().query(`UPDATE mc_stage_runs SET state='error', note=$2, ended_at=now() WHERE id=$1`, [revId, String(e.message).slice(0, 300)]).catch(() => {});
    } finally { _normJob.id = null; _stVals = null; _sfCur.clear(); }
  }
  const runsNow = async () => (await P().query(`SELECT id, by_user, scope, total, done, ok, ng, state, note, started_at, ended_at FROM mc_stage_runs ORDER BY id DESC LIMIT 10`)).rows
    .map((r) => ({ ...r, state: r.state === "running" && _normJob.id !== r.id ? "stopped" : r.state }));   // サーバーが入れ替わって止まった回は「止まった」と出す（もう一度押せば残りを続ける）
  app.get("/api/mccall/stage-norm", adminOnly(async (req, res) => {
    const scope = req.query.scope === "all" ? "all" : "mochica";
    res.json({ ok: true, scope, ...(await normPlan(await sfActor(req), scope)), running: _normJob.id, runs: await runsNow() });
  }));
  app.post("/api/mccall/stage-norm/run", adminOnly(async (req, res) => {
    // 確かめたらすぐ（await の前に）札を取る。二度押しや2人の同時操作で2つ走ると、2回目の控えに1回目の値が入って戻せなくなるため
    if (_normJob.id) return res.status(409).json({ error: "いま、そろえている途中です。終わってからもう一度押してください" });
    _normJob.id = "準備中";
    let id;
    try {
      const scope0 = (req.body || {}).scope === "all" ? "all" : "mochica"; const owner0 = await sfActor(req);
      const plan0 = await normPlan(owner0, scope0);
      if (!plan0.move) { _normJob.id = null; return res.json({ ok: true, nothing: true, runs: await runsNow() }); }
      id = (await P().query(`INSERT INTO mc_stage_runs (by_user, scope, total) VALUES ($1,$2,$3) RETURNING id`, [me(req), scope0, plan0.move])).rows[0].id;
      req._norm = { owner: owner0, plan: plan0, scope: scope0 };
    } catch (e) { _normJob.id = null; throw e; }
    const { owner, plan, scope } = req._norm;
    _normJob.id = id; console.log(`[mccall] リードの状況をそろえ始めた run=${id} scope=${scope} ${plan.move}件 by ${me(req)}`);
    normRun(owner, id, plan, scope);
    res.json({ ok: true, run: id, total: plan.move });
  }));
  app.post("/api/mccall/stage-norm/revert/:id", adminOnly(async (req, res) => {
    if (_normJob.id) return res.status(409).json({ error: "いま、ほかの処理の途中です。終わってからもう一度押してください" });
    _normJob.id = "準備中";   // 実行と同じく、確かめたらすぐ札を取る
    const runId = parseInt(req.params.id, 10); let owner, id, n;
    try {
      n = +(await P().query(`SELECT count(*) n FROM mc_stage_norm WHERE run_id=$1 AND ok AND NOT reverted`, [runId])).rows[0].n;
      if (!n) { _normJob.id = null; return res.status(400).json({ error: "この回で戻せるリードはありません" }); }
      owner = await sfActor(req);
      id = (await P().query(`INSERT INTO mc_stage_runs (by_user, scope, total, note) VALUES ($1,'revert',$2,$3) RETURNING id`, [me(req), n, `${runId} 回目を元に戻す`])).rows[0].id;
    } catch (e) { _normJob.id = null; throw e; }
    _normJob.id = id; normRevert(owner, runId, id);
    res.json({ ok: true, run: id, total: n });
  }));
  // 自動の掛け直しを解除する
  app.post("/api/mccall/leads/:id/clear-next", guard(async (req, res) => {
    await P().query(`UPDATE mc_call_leads SET next_at=NULL, next_why=NULL WHERE id=$1`, [parseInt(req.params.id, 10)]); res.json({ ok: true });
  }));
  // 重複していた元のリード（from）を、いま直しているリード（to）へまとめて、SHOBO から消す（2026-11-25 福井さん
  //   「保存できません：会社名と電話番号が〜と同じ」のとき、SF のつなぎ先を変えて元リードを消すのを直す画面でできるように）。
  //   ・SF のつなぎ先は元のリードのものに変える（元のリードが SF とつながっていないときは、こちらのつなぎ先のまま）
  //   ・架電の記録・資料送付・ヒアリングのメール・フォーム送信・着信の記録はこちらへ移す（消すのは SHOBO のリードの行だけ。SF のリードは消さない）
  //   ・本当に同じ会社の鍵でぶつかっているリードだけ消せる（ID を書きかえてほかのリードを消されないように）。いまだれかがかけているリードは消さない
  //   PATCH のトランザクションの中で呼ぶので、途中で失敗したら何も変わらない
  const isSfLead = (v) => /^00Q[0-9A-Za-z]{12,15}$/.test(String(v || ""));
  async function mergeDupInto(c, toId, fromId, keys, user) {
    if (!fromId || fromId === toId) return { error: "消すリードが正しくありません。画面を開き直してください" };
    const f = (await c.query(`SELECT id, company, sf_lead_id, locked_by, locked_at, attempts, last_at, last_outcome, gate, hearing FROM mc_call_leads WHERE id=$1 FOR UPDATE`, [fromId])).rows[0];
    if (!f) return { error: "元のリードはもう見つかりません（ほかの人が消したかもしれません）。もう一度保存してください" };
    const same = keys.length && (await c.query(`SELECT 1 FROM mc_lead_keys x JOIN unnest($1::text[], $2::text[]) AS u(kind, k) ON u.kind=x.kind AND u.k=x.k WHERE x.lead_id=$3 LIMIT 1`, [keys.map((x) => x.kind), keys.map((x) => x.k), fromId])).rowCount;
    if (!same) return { error: "そのリードとはもう重複していません。画面を開き直してください" };
    if (f.locked_by && f.locked_by !== user && f.locked_at && Date.now() - new Date(f.locked_at).getTime() < 10 * 60e3) return { error: `元のリードはいま ${f.locked_by} さんがかけているので消せません。終わってからやり直してください` };
    const t = (await c.query(`SELECT sf_lead_id FROM mc_call_leads WHERE id=$1 FOR UPDATE`, [toId])).rows[0];
    const sf = isSfLead(f.sf_lead_id) ? f.sf_lead_id : (t && t.sf_lead_id) || null;
    for (const tb of ["mc_call_logs", "mc_sf_fills", "mc_doc_sends", "mc_hear_mails", "mc_form_sends", "mc_inbound"]) {
      // 表がまだ無いとき（着信の記録）は飛ばす。トランザクションの中で失敗させると全部が止まるので、先に有無を確かめる
      if (!(await c.query(`SELECT to_regclass($1) AS t`, [tb])).rows[0].t) continue;
      await c.query(`UPDATE ${tb} SET lead_id=$1 WHERE lead_id=$2`, [toId, fromId]);
    }
    await c.query(`UPDATE mc_call_leads SET dup_of=$1 WHERE dup_of=$2 AND id <> $1`, [toId, fromId]);
    await c.query(`UPDATE mc_call_leads SET dup_of=NULL WHERE id=$1 AND dup_of=$2`, [toId, fromId]);
    // 架電の回数は足し、最後の結果は新しい方。受付・ヒアリングはこちらが空のときだけ元のリードの値を使う
    await c.query(`UPDATE mc_call_leads SET sf_lead_id=$2, attempts=attempts+$3,
        last_outcome=CASE WHEN $4::timestamptz IS NOT NULL AND (last_at IS NULL OR last_at < $4::timestamptz) THEN $5 ELSE last_outcome END,
        last_at=GREATEST(last_at, $4::timestamptz), gate=COALESCE(gate, $6::jsonb), hearing=COALESCE(hearing, $7::jsonb) WHERE id=$1`,
      [toId, sf, f.attempts || 0, f.last_at, f.last_outcome, f.gate ? JSON.stringify(f.gate) : null, f.hearing ? JSON.stringify(f.hearing) : null]);
    await c.query(`DELETE FROM mc_lead_keys WHERE lead_id=$1`, [fromId]);
    await c.query(`DELETE FROM mc_call_leads WHERE id=$1`, [fromId]);
    console.log(`[mccall] 重複していたリード ${fromId}（${f.company}）を ${toId} にまとめて消しました sf=${sf || "なし"} by ${user}`);
    return { ok: true };
  }
  // 会社・担当者の情報を直す（2026-11-18 福井さん。BALES のように MOCHICALL で直せるように）。
  //   会社名・担当者名・代表電話は kinbot のリードを直接直す（Bales/CSV/DOC の元のデータは変えない）。
  //   追加の番号・ほかの担当者・メールは info に持つ。番号は数字が9桁以上のものだけ残す（押して発信できない番号を増やさない）
  app.patch("/api/mccall/leads/:id", guard(async (req, res) => {
    const id = parseInt(req.params.id, 10); const b = req.body || {};
    const lead = (await P().query(`SELECT list_id, company, person, phone, info, dup_of, sf_lead_id FROM mc_call_leads WHERE id=$1`, [id])).rows[0];
    if (!lead) return res.status(404).json({ error: "このリードは見つかりません" });
    if (!(await myListIds(req)).includes(lead.list_id)) return res.status(403).json({ error: "このリストはあなたの担当ではありません" });
    const company = b.company != null ? clip(b.company, 200) : lead.company;
    if (!company) return res.status(400).json({ error: "会社名は空にできません" });
    const phone = b.phone != null ? clip(b.phone, 40) : lead.phone;
    if (phone && digits(phone).length < 9) return res.status(400).json({ error: "代表電話は数字9桁以上で入れてください" });
    const isMail = (v) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v);
    const email = clip(b.email, 120); if (email && !isMail(email)) return res.status(400).json({ error: "メールアドレスの形が正しくありません" });
    const phones = (Array.isArray(b.phones) ? b.phones : []).slice(0, 10).map((x) => ({ label: clip(x && x.label, 30), number: clip(x && x.number, 40) })).filter((x) => digits(x.number).length >= 9);
    const contacts = (Array.isArray(b.contacts) ? b.contacts : []).slice(0, 10).map((x) => ({ name: clip(x && x.name, 60), role: clip(x && x.role, 60), phone: clip(x && x.phone, 40), email: clip(x && x.email, 120) }))
      .filter((x) => x.name || x.phone || x.email);
    const bad = contacts.find((x) => (x.phone && digits(x.phone).length < 9) || (x.email && !isMail(x.email)));
    if (bad) return res.status(400).json({ error: `担当者「${bad.name || "名前なし"}」の電話（数字9桁以上）かメールの形が正しくありません` });
    const web = clip(b.web, 300); if (web && !webKey(web)) return res.status(400).json({ error: "Web ページは https://〜 の形で入れてください（Bales や SF などのサービスのページは入れられません）" });
    const corp = clip(b.corp, 20); if (corp && !corpKey(corp)) return res.status(400).json({ error: "法人番号は13桁の数字で入れてください" });
    const info = { email, web, corp, phones, contacts, at: new Date().toISOString(), by: me(req) };
    // 重複の鍵も直す：新しい会社名＋（電話・メール・Web・法人番号）がほかのリードのものなら断る（重複を作らない）。
    //   鍵は元のデータ（Bales/CSV/DOC）も含めて作り直す（会社名を直したら、元のデータのメールなどの鍵も新しい会社名で付け直すため）
    const orig = await leadFor(req, id).catch(() => ({ data: {} }));
    let neu = leadKeys({ company, phone, info, data: orig.data });
    const c = await P().connect();
    try {
      await c.query("BEGIN");
      if (!lead.dup_of) {
        neu = await dropIgnored(c, neu);
        // 「SF のつなぎ先を変えて、元のリードを消す」を選んだとき（2026-11-25 福井さん）：先にそちらのリードをこのリードへまとめてから確かめ直す
        //   ほかにも重複があれば画面がもう一度聞くので、それまでに選んだ分もまとめて送られてくる（1件ずつだと、2件目で全部取り消されて堂々めぐりになるため）
        for (const fromId of [...new Set([].concat(b.replaceDup || []).map((x) => parseInt(x, 10)).filter((x) => x > 0))].slice(0, 5)) {
          const m = await mergeDupInto(c, id, fromId, neu, me(req));
          if (m.error) { await c.query("ROLLBACK"); return res.status(400).json({ error: m.error }); }
        }
        const hit = await keyHit(c, neu, id);
        if (hit) {
          await c.query("ROLLBACK");
          // 画面が「つなぎ先を変えて元のリードを消す」を出せるよう、相手のリードと SF のつなぎ先も返す
          const o = (await P().query(`SELECT sf_lead_id FROM mc_call_leads WHERE id=$1`, [hit.lead_id])).rows[0] || {};
          return res.status(400).json({ error: `保存できません：${dupText(hit)}です（リードの重複は作れません）。同じ会社なら、そちらのリードを使ってください`,
            dup: { id: hit.lead_id, company: hit.company || "", list: hit.list || "", sf: isSfLead(o.sf_lead_id) ? o.sf_lead_id : "", mySf: isSfLead(lead.sf_lead_id) ? lead.sf_lead_id : "" } });
        }
        await c.query(`DELETE FROM mc_lead_keys WHERE lead_id=$1 AND kind NOT LIKE 'ign:%' AND kind <> '_v'`, [id]);
        if (neu.length) await c.query(`INSERT INTO mc_lead_keys (kind, k, lead_id) SELECT a, b, $3 FROM unnest($1::text[], $2::text[]) AS u(a, b) ON CONFLICT DO NOTHING`, [neu.map((x) => x.kind), neu.map((x) => x.k), id]);
      }
      await c.query(`UPDATE mc_call_leads SET company=$2, person=$3, phone=$4, info=$5 WHERE id=$1`, [id, company, b.person != null ? clip(b.person, 100) : lead.person, phone, info]);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      if (e.code === "23505") return res.status(409).json({ error: "同じときにほかの人が同じ会社・番号を入れたので保存できませんでした。もう一度開き直してください" });
      throw e;
    } finally { c.release(); }
    res.json({ ok: true });
  }));

  // ---- 重複で止めたリード（管理者）（2026-11-18） ----
  //   鍵の表を作る前から入っていた重複。消さずに止めてあるので、管理者が見て決める
  app.get("/api/mccall/dups", adminOnly(async (req, res) => {
    const rows = (await P().query(`SELECT c.id, c.company, c.phone, c.attempts, c.last_outcome, l.name AS list, o.id AS oid, o.company AS ocompany, o.phone AS ophone, ol.name AS olist, o.done AS odone, o.last_outcome AS oout
      FROM mc_call_leads c JOIN mc_call_lists l ON l.id=c.list_id LEFT JOIN mc_call_leads o ON o.id=c.dup_of LEFT JOIN mc_call_lists ol ON ol.id=o.list_id
      WHERE c.dup_of IS NOT NULL ORDER BY c.id DESC LIMIT 500`)).rows;
    res.json({ ok: true, items: rows.map((r) => ({ ...r, outcome: outcomeLabel(r.last_outcome), oout: outcomeLabel(r.oout) })) });
  }));
  // 「別の会社として残す」：同じ代表番号のグループ会社などで、本当に別の会社だったとき。
  //   空いている鍵だけをこのリードに付ける（先のリードの鍵は取らない）。かける順番に戻る
  app.post("/api/mccall/leads/:id/not-dup", adminOnly(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const l = (await P().query(`SELECT company, phone, info, data FROM mc_call_leads WHERE id=$1 AND dup_of IS NOT NULL`, [id])).rows[0];
    if (!l) return res.status(404).json({ error: "このリードは重複で止めたものではありません" });
    const keys = leadKeys(l);
    await P().query(`INSERT INTO mc_lead_keys (kind, k, lead_id) SELECT a, b, $3 FROM unnest($1::text[], $2::text[]) AS u(a, b) ON CONFLICT DO NOTHING`, [keys.map((x) => x.kind), keys.map((x) => x.k), id]);
    await P().query(`UPDATE mc_call_leads SET dup_of=NULL, dup_ok=true WHERE id=$1`, [id]);
    console.log(`[mccall] 重複で止めたリード ${id} を別の会社として残しました（${me(req)}）`);
    res.json({ ok: true });
  }));

  // ヒアリング欄の担当者の名前・メール・電話が空のときに使う値（受付で聞いた名前・直した会社の情報・かけた番号）。画面の hv と同じ順
  function apoContact(lead, gate, phone) {
    const inf = lead.info || {};
    return { name: realName((gate && gate.name) || (lead.gate && lead.gate.name)) || realName(lead.person), mail: inf.email || ((inf.contacts || []).find((c) => c.email) || {}).email || "", tel: phone || lead.phone || "" };
  }
  // ---- 記録する ----
  app.post("/api/mccall/leads/:id/log", guard(async (req, res) => {
    const id = parseInt(req.params.id, 10); const b = req.body || {}; const u = me(req);
    const lead = (await P().query(`SELECT * FROM mc_call_leads WHERE id=$1`, [id])).rows[0];
    if (!lead) return res.status(404).json({ error: "このリードは見つかりません" });
    if (!(await inboundAllows(u, id, b.inbound).catch(() => false)) && !(await myListIds(req)).includes(lead.list_id)) return res.status(403).json({ error: "このリストはあなたの担当ではありません" });
    if (lead.dup_of) return res.status(403).json({ error: "重複で止めたリードなので記録できません（ほかのリードと会社名が同じで、電話・メール・Web ページ・法人番号のどれかも同じ）。管理者に知らせてください" });
    const ban = await approachBanHitLead(lead).catch(() => ({ reason: "アプローチ禁止の名簿を確認できなかったため、念のため止めています" }));
    if (ban) return res.status(403).json({ error: `「${lead.company}」はアプローチ禁止のため記録できません（理由：${ban.reason || "アプローチ禁止"}）` });
    const reach = String(b.reach || ""); const outcome = String(b.outcome || "");
    if (!REACH[reach] || !REACH[reach].outcomes[outcome]) return res.status(400).json({ error: "結果を選んでください" });
    // 断られた理由（担当者）・断り文句（受付）。受付の文句は前の画面からは来ないので、無くても記録する
    const reason = outcome === "reject" || outcome === "blocked" ? clip(b.reason, 60) : "";
    if (outcome === "reject" && !reason) return res.status(400).json({ error: "断られた理由を選んでください" });
    const apoAt = b.apoAt ? new Date(b.apoAt) : null;
    if (outcome === "apo" && (!apoAt || isNaN(apoAt) || apoAt.getTime() < Date.now() - 3600e3)) return res.status(400).json({ error: "アポの日時を入れてください（過去の日時は入れられません）" });
    const gate = b.gate && (b.gate.name || b.gate.hours || b.gate.direct) ? { name: clip(b.gate.name, 40), hours: clip(b.gate.hours, 30), direct: clip(b.gate.direct, 30), at: new Date().toISOString(), by: u } : null;
    const now = new Date();
    // 次にかける時刻：人が選んだもの → 自動の掛け直し → なし
    let nextAt = b.nextAt ? new Date(b.nextAt) : null, why = nextAt ? WHY_HUMAN : null;
    if (nextAt && isNaN(nextAt)) { nextAt = null; why = null; }
    // 担当者に届かないまま続けた回数（担当者と話せたら 0 に戻る。受付で断られた・掛け直しの指定は数えない）
    let streak = lead.miss_streak || 0, parkedAt = null;
    if (reach === "person") streak = 0; else if (AUTO_RETRY.has(outcome)) streak += 1;
    if (!nextAt && AUTO_RETRY.has(outcome) && !b.noRetry) {
      const r = nextMissAt({ now, streak, gateHours: (gate && gate.hours) || (lead.gate && lead.gate.hours), rates: await ratesNow() });
      nextAt = r.at; why = r.why;
      if (r.parked) { streak = 0; parkedAt = now; }   // 上限まで届かなかった会社は一度休ませ、次の周回を0から数える
    }
    if (outcome === "callback_req" && !nextAt) return res.status(400).json({ error: "掛け直す時刻を選んでください" });
    // 資料送付・問い合わせフォームは「送って終わり」。掛け直しの時刻を選んだときだけ残す
    const done = FINAL.has(outcome) || ((outcome === "doc_send" || outcome === "inquiry") && !nextAt);
    const prev = { next_at: lead.next_at, next_why: lead.next_why, last_at: lead.last_at, last_outcome: lead.last_outcome, attempts: lead.attempts, done: lead.done, gate: lead.gate, hearing: lead.hearing, miss_streak: lead.miss_streak || 0, parked_at: lead.parked_at || null };
    // ヒアリングは担当者と話せたときだけ記録に付ける（受付・不在で前の値が SF に二重に書かれないように）
    const hNew = reach === "person" ? cleanHearing(b.hearing || {}) : null;
    const hearing = hNew ? { ...mergeHearing(lead.hearing, hNew), at: now.toISOString(), by: u } : null;
    // アポは必須のヒアリング（担当者の基本3・必須7）がそろうまで記録しない（2026-11-23 福井さん）。
    //   画面でも記録のボタンを止めているが、古い画面や直接の呼び出しでも抜けないよう、ここで必ず確かめる
    if (outcome === "apo") {
      const ck = apoCheck(hearing || lead.hearing, apoContact(lead, gate, b.phone), NEED_CHOICES);
      if (ck.block.length) return res.status(400).json({ error: `アポにするには、ヒアリングの必須項目を埋めてください：${ck.block.join("、")}`, missing: ck.block });
    }
    const log = (await P().query(`INSERT INTO mc_call_logs (lead_id, list_id, caller, phone, reach, outcome, reason, gate, memo, next_at, apo_at, cross_from, prev, product)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,(SELECT COALESCE(product,'mochica') FROM mc_call_lists WHERE id=$2)) RETURNING id, created_at`,
      [id, lead.list_id, u, clip(b.phone || lead.phone, 40), reach, outcome, reason || null, gate, clip(b.memo, 2000) || null, nextAt, apoAt, lead.cross_from, prev])).rows[0];
    if (outcome === "apo" && b.apoWho) await P().query(`UPDATE mc_call_logs SET apo_who=$2 WHERE id=$1`, [log.id, clip(b.apoWho, 80)]);
    if (hearing) await P().query(`UPDATE mc_call_logs SET hearing=$2 WHERE id=$1`, [log.id, hearing]);
    // どのトーク（版）で話したか。そのリストのトークのときだけ残す（別のリストのトークと取り違えないため）
    const talkId = parseInt(b.talkId, 10);
    if (talkId) await P().query(`UPDATE mc_call_logs g SET talk_id=t.id FROM mc_call_talks t WHERE g.id=$1 AND t.id=$2 AND t.list_id=$3`, [log.id, talkId, lead.list_id]);
    // SF に入る項目のうち、記録した人が画面で「書く・書かない」を選んだもの（選んでいない項目は最初のチェックのまま書く）
    const pick = {}; for (const [k, v] of Object.entries((b.sfPick && typeof b.sfPick === "object") ? b.sfPick : {})) if (FILL_APIS.includes(k)) pick[k] = !!v;
    if (Object.keys(pick).length) await P().query(`UPDATE mc_call_logs SET sf_pick=$2 WHERE id=$1`, [log.id, pick]);
    await P().query(`UPDATE mc_call_leads SET last_at=now(), last_outcome=$2, attempts=attempts+1, next_at=$3, next_why=$4, done=$5, gate=COALESCE($6, gate), hearing=COALESCE($7, hearing), miss_streak=$8, parked_at=$9, locked_by=NULL WHERE id=$1`,
      [id, outcome, nextAt, why, done, gate, hearing, streak, parkedAt]);
    // アポなら、担当 FS・予定・知らせまで済ませてから返す（kincall と同じく、画面にその結果を出す）。失敗しても記録は残す
    let apo = null;
    if (outcome === "apo") { try { apo = await afterApo(req, log.id); } catch (e) { console.error("[mccall] アポのあとの流れ", log.id, e.message); apo = { warn: [`担当 FS・予定・知らせの途中で止まりました（${String(e.message).slice(0, 120)}）。管理者に伝えてください`] }; } }
    res.json({ ok: true, logId: log.id, nextAt, why, done, parked: !!parkedAt, apo });
    // SF の活動（リードに付ける）。代理アカウントでも書ける。失敗しても架電の記録は残り、画面の知らせから書き直せる
    sfWrite(req, log.id).catch(() => {});
  }));

  // 元に戻す（記録した本人が15分以内。管理者はいつでも）
  app.post("/api/mccall/logs/:id/undo", guard(async (req, res) => {
    const g = (await P().query(`SELECT * FROM mc_call_logs WHERE id=$1`, [parseInt(req.params.id, 10)])).rows[0];
    if (!g || g.undone) return res.status(404).json({ error: "この記録は見つからないか、もう取り消してあります" });
    const mine = String(g.caller || "").toLowerCase() === me(req) && Date.now() - new Date(g.created_at).getTime() < 15 * 60e3;
    if (!mine && !isAdmin(req)) return res.status(403).json({ error: "記録してから15分を過ぎたので取り消せません。管理者に頼んでください" });
    const p = g.prev || {};
    await P().query(`UPDATE mc_call_logs SET undone=true WHERE id=$1`, [g.id]);
    await P().query(`UPDATE mc_call_leads SET next_at=$2, next_why=$3, last_at=$4, last_outcome=$5, attempts=GREATEST(COALESCE($6,0),0), done=COALESCE($7,false), gate=$8, miss_streak=COALESCE($9,0), parked_at=$10${g.hearing ? ", hearing=$11" : ""} WHERE id=$1`,
      [g.lead_id, p.next_at || null, p.next_why || null, p.last_at || null, p.last_outcome || null, p.attempts, p.done, p.gate || null, p.miss_streak, p.parked_at || null, ...(g.hearing ? [p.hearing || null] : [])]);
    let sf = "";
    if (g.sf_task_id) { try { await deleteTask(await sfActor(req), g.sf_task_id); sf = "SF の活動も消しました"; } catch (e) { sf = `SF の活動は消せませんでした（${String(e.message).slice(0, 80)}）`; } }
    // この記録で埋めた SF のリードの項目：評価から外し、SF の値がこちらの書いたままなら前の値へ戻す（ほかの人が直したあとなら触らない）
    const fills = (await P().query(`UPDATE mc_sf_fills SET undone=true WHERE log_id=$1 AND NOT undone RETURNING *`, [g.id])).rows;
    if (fills.length) {
      try {
        const owner = await sfActor(req); const cur = await sfCurrent(owner, fills[0].sf_lead_id, true); const back = {};
        for (const f of fills) if (cur[f.field] != null && String(cur[f.field]) === f.new_val) back[f.field] = f.field === "Retire_check__c" ? f.old_val === "true" : f.old_val == null || f.old_val === "" ? null : f.old_val;
        if (Object.keys(back).length) { await sfUpdateRecord(owner, "Lead", fills[0].sf_lead_id, back); _sfCur.delete(fills[0].sf_lead_id); }
        sf += `${sf ? "。" : ""}SF のリードの項目 ${Object.keys(back).length} 件を前の値に戻しました`;
      } catch (e) { sf += `${sf ? "。" : ""}SF のリードの項目は戻せませんでした（${String(e.message).slice(0, 80)}）`; }
    }
    // この記録で自動で進めたリードの状況：SF の値が進めたままなら前の値へ戻す（ほかの人が変えたあとなら触らない）
    if (g.sf_stage && g.sf_stage.new && !g.sf_stage.old) sf += `${sf ? "。" : ""}リードの状況は前が空だったので戻していません（いまは「${g.sf_stage.new}」。必要なら選び直してください）`;
    if (g.sf_stage && g.sf_stage.new && g.sf_stage.old) {
      try {
        const sid = ((await P().query(`SELECT sf_lead_id FROM mc_call_leads WHERE id=$1`, [g.lead_id])).rows[0] || {}).sf_lead_id;
        const owner = await sfActor(req); const cur = sid ? await sfCurrent(owner, sid, true) : null;
        if (cur && !cur.IsConverted && cur.Status === g.sf_stage.new) { await sfUpdateRecord(owner, "Lead", sid, { Status: g.sf_stage.old }); _sfCur.delete(sid); sf += `${sf ? "。" : ""}リードの状況を「${g.sf_stage.old}」に戻しました`; }
      } catch (e) { sf += `${sf ? "。" : ""}リードの状況は戻せませんでした（${String(e.message).slice(0, 80)}）`; }
    }
    // アポの取り消し：ここで作った予定を消し、FS に知らせる
    if (g.outcome === "apo" && g.apo_flow) { const u2 = await undoApo(g).catch((e) => `予定の片付けが途中で止まりました（${String(e.message).slice(0, 80)}）`); if (u2) sf += `${sf ? "。" : ""}${u2}`; }
    res.json({ ok: true, leadId: g.lead_id, sf });
  }));

  // ---- 今日の数字（自分。管理者には全員） ----
  app.get("/api/mccall/stats", guard(async (req, res) => {
    const names = await nameMap();
    const rows = (await P().query(`SELECT caller, count(*) AS calls, count(*) FILTER (WHERE reach='person') AS person, count(*) FILTER (WHERE outcome='apo') AS apo,
        count(*) FILTER (WHERE cross_from IS NOT NULL) AS cross FROM mc_call_logs WHERE NOT undone AND created_at >= $1 GROUP BY caller`, [jstDayStart()])).rows
      .map((r) => ({ email: r.caller, name: names.get(String(r.caller || "").toLowerCase()) || r.caller, calls: +r.calls, person: +r.person, apo: +r.apo, cross: +r.cross }));
    // 今日 SF の項目を埋めた数（アポ以外の貢献。評価は /report）
    const fl = new Map((await P().query(`SELECT caller, count(*) AS n FROM mc_sf_fills WHERE NOT undone AND created_at >= $1 GROUP BY caller`, [jstDayStart()])).rows.map((r) => [String(r.caller || "").toLowerCase(), +r.n]));
    for (const r of rows) r.fills = fl.get(String(r.email || "").toLowerCase()) || 0;
    const mine = rows.find((r) => String(r.email || "").toLowerCase() === me(req)) || { calls: 0, person: 0, apo: 0, cross: 0, fills: fl.get(me(req)) || 0 };
    // 今日の自分の記録のうち SF に書けていない数（画面の上の知らせに出す）
    const sf = (await P().query(`SELECT count(*) FILTER (WHERE ${SF_FAIL}) AS fail, count(*) FILTER (WHERE NOT g.undone AND g.sf_err='nolead') AS nolead, count(*) FILTER (WHERE NOT g.undone AND g.sf_lead_err IS NOT NULL) AS leaderr,
        (array_agg(g.sf_err ORDER BY g.created_at DESC) FILTER (WHERE ${SF_FAIL} AND g.sf_err IS NOT NULL))[1] AS last_err
      FROM mc_call_logs g WHERE g.caller=$1 AND g.created_at >= $2`, [me(req), jstDayStart()])).rows[0];
    res.json({ ok: true, me: mine, all: isAdmin(req) ? rows.sort((a, b) => b.calls - a.calls) : null, sf: { fail: +sf.fail, nolead: +sf.nolead, leadErr: +sf.leaderr, lastErr: sf.last_err || "" }, slot: slotNow(await ratesNow()) });
  }));

  // ---- 数字の見方（科学的に確かめる道具）：時間帯ごとのつながりやすさ・直近14日と目安・何回目の架電でアポが取れたか ----
  //   「6回以上掛けると取れる」という資料の主張が、自分たちの記録でも成り立つかを確かめるための表（何回目か × アポ）。
  //   何回目かの数え方：その会社への記録を古い順に並べた順番。直近90日の記録だけを出すが、順番は元に戻した記録を除く全期間で数える
  let _att = null;
  async function byAttempt() {
    if (_att && Date.now() - _att.at < 5 * 60e3) return _att.v;
    const v = (await P().query(`SELECT LEAST(n, 10) AS n, count(*) AS calls, count(*) FILTER (WHERE reach='person') AS person, count(*) FILTER (WHERE outcome='apo') AS apo FROM (
        SELECT reach, outcome, created_at, row_number() OVER (PARTITION BY lead_id ORDER BY created_at, id) AS n FROM mc_call_logs WHERE NOT undone AND biz=$1) x
      WHERE created_at >= now() - interval '90 days' GROUP BY 1 ORDER BY 1`, [BIZ])).rows.map((r) => ({ n: +r.n, calls: +r.calls, person: +r.person, apo: +r.apo }));
    _att = { at: Date.now(), v }; return v;
  }
  const rateOf = (r) => ({ calls: +r.calls || 0, person: +r.person || 0, apo: +r.apo || 0 });
  app.get("/api/mccall/insight", guard(async (req, res) => {
    const names = await nameMap(); const admin = isAdmin(req);
    const per = (await P().query(`SELECT caller, count(*) AS calls, count(*) FILTER (WHERE reach='person') AS person, count(*) FILTER (WHERE outcome='apo') AS apo
      FROM mc_call_logs WHERE NOT undone AND biz=$1 AND created_at >= now() - interval '14 days' GROUP BY caller`, [BIZ])).rows;
    const mineRow = per.find((r) => String(r.caller || "").toLowerCase() === me(req));
    const sum = (rows) => rows.reduce((a, r) => ({ calls: a.calls + +r.calls, person: a.person + +r.person, apo: a.apo + +r.apo }), { calls: 0, person: 0, apo: 0 });
    // 休ませている会社・3回以上続けて届いていない会社（自分がかけられるリストの中で）
    const ids = await myListIds(req);
    const st = ids.length ? (await P().query(`SELECT count(*) FILTER (WHERE parked_at IS NOT NULL AND next_at > now()) AS parked, count(*) FILTER (WHERE miss_streak >= 3) AS streak3
      FROM mc_call_leads WHERE list_id = ANY($1) AND NOT done`, [ids])).rows[0] : { parked: 0, streak3: 0 };
    const rates = await ratesNow();
    res.json({ ok: true, slot: slotNow(rates), hours: rates.hours, base: rates.base, baseCalls: rates.calls,
      me: rateOf(mineRow || {}), team: admin ? sum(per) : null,
      people: admin ? per.map((r) => ({ name: names.get(String(r.caller || "").toLowerCase()) || r.caller, ...rateOf(r) })).sort((a, b) => b.calls - a.calls) : null,
      byAttempt: await byAttempt(), parked: +st.parked, streak3: +st.streak3,
      cadence: { max: CADENCE.maxMiss, gapDays: CADENCE.gapDays, parkDays: CADENCE.parkDays }, bench: BENCH });
  }));
  // SF に書けなかった今日の自分の記録を書き直す（画面の知らせのボタンから）
  app.post("/api/mccall/sf-retry", guard(async (req, res) => {
    const ids = (await P().query(`SELECT g.id FROM mc_call_logs g WHERE g.caller=$1 AND g.created_at >= $2 AND (${SF_FAIL} OR (NOT g.undone AND g.sf_task_id IS NOT NULL AND g.sf_lead_err IS NOT NULL AND NOT g.sf_fill_done)) ORDER BY g.id LIMIT 30`, [me(req), jstDayStart()])).rows.map((r) => r.id);
    for (const id of ids) await sfWrite(req, id);
    const left = ids.length ? +(await P().query(`SELECT count(*) FROM mc_call_logs g WHERE g.id = ANY($1) AND ${SF_FAIL}`, [ids])).rows[0].count : 0;
    res.json({ ok: true, tried: ids.length, left });
  }));
  // ===== 資料送付（2026-11-17 福井さん）=====
  //   DOC の kincall と同じく「確かめてから送る」の2段。資料は資料トラッキングの URL（だれがいつ開いたか分かる）。
  //   本人の Gmail で送り、SF のリードに活動（メール）を残す（正本は SF）。CC は既定で入れない（福井さんの決定）。
  //   ひな形・既定の資料は MOCHICA 専用の設定（mcDocSend…）にして、DOC の資料送付の設定は変えない。
  const MC_DOC_SUBJECT = "資料のご送付（{資料名}）";
  const MC_DOC_BODY = "{担当者}様\n\nお世話になっております。MOCHICA の{差出人}です。\n先ほどお電話にてご案内した資料をお送りいたします。\n下記の URL よりご確認ください。\n\n{URL}\n\nご不明な点がございましたら、お気軽にご連絡ください。\n何卒よろしくお願いいたします。";
  const isMail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
  // 宛先は画面と同じ探し方（mcmail.js の leadMails）の先頭。前はここだけ別の探し方で、SF のリードの今の Email を見ていなかった
  async function leadFor(req, id, { withMails = false } = {}) {
    const lead = (await P().query(`SELECT * FROM mc_call_leads WHERE id=$1`, [id])).rows[0];
    if (!lead) { const e = new Error("このリードは見つかりません"); e.status = 404; throw e; }
    if (!(await myListIds(req)).includes(lead.list_id)) { const e = new Error("このリストはあなたの担当ではありません"); e.status = 403; throw e; }
    let data = {}, sf = null;
    if (lead.src === "bales") {
      const [lk, rk] = String(lead.src_key).split("|");
      const r = (await P().query(`SELECT data, sf FROM mochica_bales_rows WHERE list_key=$1 AND row_key=$2`, [lk, rk]).catch(() => ({ rows: [] }))).rows[0];
      if (r) { data = r.data || {}; sf = r.sf || null; }
    } else if (lead.src === "doc") {
      const t = (await P().query(`SELECT email FROM call_targets WHERE id=$1`, [parseInt(lead.src_key, 10)]).catch(() => ({ rows: [] }))).rows[0];
      if (t) data = t;
    } else if (lead.src === "sf") data = lead.data || {};
    if (!withMails) return { lead, data, sf };
    // CSV の中身は data に入れない（重複の鍵の作り直しなど、ほかの使い道の動きを変えないため）。メールを探すときだけ見る
    const sm = await sfMailOf(req, lead, sf);
    return { lead, data, sf, mails: leadMails({ lead, data: lead.src === "csv" ? lead.data || {} : data, sf, sfEmail: sm.email }), mailErr: sm.err };
  }
  async function docSettings() {
    const st = await getSettings().catch(() => ({}));
    return { subject: st.mcDocSendSubject || MC_DOC_SUBJECT, body: st.mcDocSendBody || MC_DOC_BODY, defaultDocId: st.mcDocDefaultId || "", cc: st.mcDocSendCc || "" };
  }
  // メールの署名（2026-11-24 福井さん「署名と企業名とメールアドレスが自動で埋まるように」）
  //   会社名・部署・電話は問い合わせフォームのひな形（MOCHICA 共通・管理者が入れる）、名前とメールは送る本人のもの。
  //   毎回手で書くと抜けや書き間違いが出るので、資料送付・ヒアリングのメールの両方で同じ署名を使う
  async function mailSig(req) {
    const c = await formSettings().catch(() => ({})); const u = me(req);
    const name = (await nameMap()).get(u) || "";
    const line = "――――――――――――――――――";
    return [line, c.company || "株式会社ネオキャリア", c.dept || "MOCHICA", name, c.tel ? `TEL：${c.tel}` : "", `Mail：${u}`, line].filter(Boolean).join("\n");
  }
  // 本文に {署名} があればそこへ、なければ最後に付ける。宛先の会社名が本文の頭に無ければ、宛名の上に足す
  function withSig(body, { company, sig }) {
    let t = String(body || "");
    if (company && !t.slice(0, 200).includes(company)) t = `${company}\n${t}`;
    return /\{署名\}/.test(t) ? t.replace(/\{署名\}/g, sig) : `${t.replace(/\s+$/, "")}\n\n${sig}`;
  }
  // ---- doc-room（2026-11-17 福井さん）：MOCHICA の資料は doc-room の「会社ごとのルーム」で送る ----
  //   kinbot の資料トラッキングではなく doc-room（https://doc-room.vercel.app/console/）にそろえる。
  //   閲覧の通知・分析も doc-room 側で見る。管理キーは Railway の環境変数 DOC_ROOM_KEY（コードに書かない）。
  //   ルームは「送る」を押したときだけ作る（確かめるだけ・資料を切り替えただけで空のルームが増えないように）。
  const DOC_ROOM = String(process.env.DOC_ROOM_URL || "https://doc-room.vercel.app").replace(/\/+$/, "");
  async function docRoom(method, path, body) {
    const key = process.env.DOC_ROOM_KEY;
    if (!key) { const e = new Error("doc-room の管理キー（DOC_ROOM_KEY）がサーバーに設定されていません。管理者に設定を頼んでください"); e.status = 500; throw e; }
    const r = await fetch(DOC_ROOM + path, { method, headers: { authorization: `Bearer ${key}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(`doc-room：${j.message || j.error || `エラー（${r.status}）`}`); e.status = r.status === 401 ? 500 : 502; throw e; }
    return j;
  }
  let roomDocsCache = { at: 0, docs: [] };
  async function roomDocs() {
    if (Date.now() - roomDocsCache.at < 60e3 && roomDocsCache.docs.length) return roomDocsCache.docs;
    const docs = ((await docRoom("GET", "/admin/documents")).documents || []).map((d) => ({ id: String(d.id), name: String(d.title || d.id), kind: d.kind || "" }));
    roomDocsCache = { at: Date.now(), docs };
    return docs;
  }
  app.get("/api/mccall/doc-settings", guard(async (req, res) => {
    let docs = [], docErr = "";
    try { docs = await roomDocs(); } catch (e) { docErr = e.message; }
    res.json({ ok: true, ...(await docSettings()), admin: isAdmin(req), docs: docs.map((d) => ({ id: d.id, name: d.name })), docErr });
  }));
  app.put("/api/mccall/doc-settings", adminOnly(async (req, res) => {
    const b = req.body || {}; const patch = {};
    if (b.subject !== undefined) patch.mcDocSendSubject = clip(b.subject, 300);
    if (b.body !== undefined) patch.mcDocSendBody = String(b.body || "").slice(0, 4000);
    if (b.defaultDocId !== undefined) patch.mcDocDefaultId = String(b.defaultDocId || "");
    if (b.cc !== undefined) patch.mcDocSendCc = String(b.cc || "").split(/[,\s、]+/).filter(isMail).join(", ");
    await saveSettings(patch); res.json({ ok: true });
  }));
  // 送る前の中身（宛先・件名・本文）。本文の {URL} は残しておき、「送る」で doc-room のルームを作ってから差し替える
  app.post("/api/mccall/leads/:id/doc/preview", guard(async (req, res) => {
    try {
      const { lead, mails, mailErr } = await leadFor(req, parseInt(req.params.id, 10), { withMails: true });
      const ban = await approachBanHitLead(lead).catch(() => ({ reason: "アプローチ禁止の名簿を確認できなかったため、念のため止めています" }));
      if (ban) return res.status(403).json({ error: `「${lead.company}」はアプローチ禁止のため、資料は送れません` });
      const docs = await roomDocs();
      if (!docs.length) return res.status(400).json({ error: "送れる資料がまだ doc-room に登録されていません。doc-room の管理画面（/console/）で資料を登録してください" });
      const conf = await docSettings();
      const want = String((req.body && req.body.docId) || conf.defaultDocId || "");
      const doc = docs.find((d) => d.id === want) || docs[0];
      const company = String(lead.company || "").trim(); const person = String((lead.gate && lead.gate.name) || lead.person || "").trim();
      // ヒアリングで聞いたメール → MOCHICALL で直したメール → SF → 元のデータ、の順（mcmail.js）
      const to = mails.length ? mails[0].addr : "";
      const sender = (await nameMap()).get(me(req)) || "";
      const fill = (t) => String(t || "").replace(/\{担当者\}/g, person || "ご担当者").replace(/\{会社名\}/g, company).replace(/\{差出人\}/g, sender).replace(/\{資料名\}/g, doc.name || "ご案内資料");
      res.json({ ok: true, to, cc: conf.cc, company, person, subject: fill(conf.subject), body: withSig(fill(conf.body), { company, sig: await mailSig(req) }), docId: doc.id, docName: doc.name,
        docs: docs.map((d) => ({ id: d.id, name: d.name })), google: await googleConnected(me(req)).catch(() => false),
        warn: to ? "" : `この会社のメールアドレスが見つかりませんでした。宛先を入れてください${mailErr ? `（${mailErr}）` : ""}` });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  }));
  app.post("/api/mccall/leads/:id/doc/send", guard(async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10); const { lead } = await leadFor(req, id); const b = req.body || {}; const u = me(req);
      const to = String(b.to || "").trim(); const subject = clip(b.subject, 300); let body = String(b.body || "").slice(0, 8000);
      const ban = await approachBanHitLead(lead).catch(() => ({ reason: "アプローチ禁止の名簿を確認できなかったため、念のため止めています" }));
      if (ban) return res.status(403).json({ error: `「${lead.company}」はアプローチ禁止のため、資料は送れません` });
      if (!isMail(to)) return res.status(400).json({ error: "宛先のメールアドレスを正しく入れてください" });
      if (!subject || !body) return res.status(400).json({ error: "件名と本文を入れてください" });
      if (!(await googleConnected(u).catch(() => false))) return res.status(400).json({ error: "あなたの Google 連携がまだです。設定 → 外部連携 → Google でつないでから、もう一度送ってください" });
      const cc = [...new Set(String(b.cc || "").split(/[,\s、]+/).filter(isMail).map((x) => x.toLowerCase()))].filter((x) => x !== to.toLowerCase() && x !== u).join(", ");
      // doc-room にこの会社のルームを作る。作れなければメールは送らない（URL の無いメールを出さない）
      const doc = (await roomDocs()).find((d) => d.id === String(b.docId || ""));
      if (!doc) return res.status(400).json({ error: "選んだ資料が doc-room に見つかりません。画面を開き直して、資料を選び直してください" });
      const sender = (await nameMap()).get(u) || u;
      let room;
      try {
        room = await docRoom("POST", "/admin/rooms", { company_name: String(lead.company || "").trim(), contact_name: String((lead.gate && lead.gate.name) || lead.person || "").trim() || null,
          owner: sender, message: null, cta_url: null, expires_days: 30, sf_opportunity_id: null, sf_account_id: null,
          items: [{ document_id: doc.id, downloadable: doc.kind === "summary" }] });
      } catch (e) { return res.status(e.status || 502).json({ error: `資料のルームを作れなかったので、メールは送っていません（${e.message}）` }); }
      const url = String(room && room.url || "");
      if (!url) return res.status(502).json({ error: "doc-room からルームの URL が返ってこなかったので、メールは送っていません" });
      const docName = doc.name;
      // {URL} を消してしまっていても、URL の無いメールにならないよう末尾に足す
      body = /\{URL\}/.test(body) ? body.replace(/\{URL\}/g, url) : `${body}\n\n${url}`;
      try { await gmailSend(u, { to, subject, bodyText: body, cc }); }
      catch (e) { return res.status(500).json({ error: e.needScope ? "Gmail で送る許可がありません。設定 → 外部連携 → Google を一度外して、もう一度つなぎ、Gmail の項目を許可してください" : `送れませんでした：${String(e.message).slice(0, 120)}` }); }
      const row = (await P().query(`INSERT INTO mc_doc_sends (lead_id, sender, to_addr, cc, subject, url, doc_name) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [id, u, to, cc || null, subject, clip(url, 300), clip(docName, 200)])).rows[0];
      // SF のリードに「資料送付」の活動を残す。書けなかったら sf_err に残し、画面にも返す（黙って失敗しない＝ルール5）
      let sfNote = "";
      if (lead.sf_lead_id && /^00Q[0-9A-Za-z]{12,15}$/.test(lead.sf_lead_id)) {
        try {
          const t = await leadTask(await sfActor(req), { WhoId: lead.sf_lead_id, Subject: "[MOCHICA] 資料送付", Type: "Email", Status: "完了",
            ActivityDate: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10),
            Description: [`送った人：${(await nameMap()).get(u) || u}（SHOBO）`, `宛先：${to}`, cc ? `CC：${cc}` : "", `件名：${subject}`, `資料：${docName}（doc-room）${url}`].filter(Boolean).join("\n") });
          if (!t || !t.id) throw new Error("SF から活動の番号が返ってきませんでした");
          await P().query(`UPDATE mc_doc_sends SET sf_task_id=$2 WHERE id=$1`, [row.id, t.id]);
        } catch (e) { sfNote = "メールは送りましたが、SF の活動には書けませんでした"; await P().query(`UPDATE mc_doc_sends SET sf_err=$2 WHERE id=$1`, [row.id, String(e.message).slice(0, 300)]).catch(() => {}); }
      } else sfNote = "SF のリードと結びついていないので、SF には残していません（kinbot にだけ残ります）";
      res.json({ ok: true, to, sf: sfNote });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  }));

  // ===== ヒアリングのメール（2026-11-23 福井さん「メールでヒアリングできるように」）=====
  //   電話で聞ききれなかった項目を、担当者にメールで聞く。送るのは本人の Gmail から（資料送付と同じ）。
  //   聞く項目は画面で選ぶ（最初は、必須でまだ聞けていない項目にチェック）。返ってきた答えは、架電者がヒアリング欄に入れる
  async function hearMailBase(req, id, keys0) {
    const { lead, mails, mailErr } = await leadFor(req, id, { withMails: true });
    const ban = await approachBanHitLead(lead).catch(() => ({ reason: "アプローチ禁止の名簿を確認できなかったため、念のため止めています" }));
    if (ban) { const e = new Error(`「${lead.company}」はアプローチ禁止のため、メールは送れません`); e.status = 403; throw e; }
    const h = lead.hearing || {};
    const okKeys = new Set(MAIL_ITEMS.map((x) => x.k));
    const keys = Array.isArray(keys0) ? keys0.map(String).filter((k) => okKeys.has(k)) : mailDefaults(h, NEED_CHOICES);
    const company = String(lead.company || "").trim();
    const person = realName(h.name) || realName(lead.gate && lead.gate.name) || realName(lead.person);
    const to = mails.length ? mails[0].addr : "";   // 資料送付と同じ順（mcmail.js）
    return { lead, h, keys, company, person, to, mailErr };
  }
  app.post("/api/mccall/leads/:id/hear-mail/preview", guard(async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10); const b = req.body || {};
      const { h, keys, company, person, to, mailErr } = await hearMailBase(req, id, b.keys);
      const sender = (await nameMap()).get(me(req)) || "";
      const last = (await P().query(`SELECT created_at FROM mc_hear_mails WHERE lead_id=$1 ORDER BY created_at DESC LIMIT 1`, [id])).rows[0] || null;
      res.json({ ok: true, to, company, person, keys,
        items: MAIL_ITEMS.map((it) => ({ k: it.k, no: it.no || "", label: it.label, group: it.group, heard: !!valueText(it, h, NEED_CHOICES) })),
        subject: HEAR_MAIL_SUBJECT.replace(/\{会社名\}/g, company), body: withSig(hearMailBody({ company, person, sender, keys }), { company, sig: await mailSig(req) }),
        google: await googleConnected(me(req)).catch(() => false), last: last ? last.created_at : null,
        warn: to ? "" : `担当者のメールアドレスが見つかりませんでした。宛先を入れてください${mailErr ? `（${mailErr}）` : ""}` });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  }));
  app.post("/api/mccall/leads/:id/hear-mail/send", guard(async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10); const b = req.body || {}; const u = me(req);
      const { lead, keys } = await hearMailBase(req, id, b.keys);
      const to = String(b.to || "").trim(); const subject = clip(b.subject, 300); const body = String(b.body || "").slice(0, 8000);
      if (!isMail(to)) return res.status(400).json({ error: "宛先のメールアドレスを正しく入れてください" });
      if (!subject || !body.trim()) return res.status(400).json({ error: "件名と本文を入れてください" });
      if (!(await googleConnected(u).catch(() => false))) return res.status(400).json({ error: "あなたの Google 連携がまだです。設定 → 外部連携 → Google でつないでから、もう一度送ってください" });
      const cc = [...new Set(String(b.cc || "").split(/[,\s、]+/).filter(isMail).map((x) => x.toLowerCase()))].filter((x) => x !== to.toLowerCase() && x !== u).join(", ");
      try { await gmailSend(u, { to, subject, bodyText: body, cc }); }
      catch (e) { return res.status(500).json({ error: e.needScope ? "Gmail で送る許可がありません。設定 → 外部連携 → Google を一度外して、もう一度つなぎ、Gmail の項目を許可してください" : `送れませんでした：${String(e.message).slice(0, 120)}` }); }
      const row = (await P().query(`INSERT INTO mc_hear_mails (lead_id, sender, to_addr, cc, subject, keys) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [id, u, to, cc || null, subject, JSON.stringify(keys)])).rows[0];
      // 聞いた担当者のメールは、ヒアリング欄にも残す（次に資料やアポの案内を送るときの宛先になる）
      if (!(lead.hearing && lead.hearing.mail)) await P().query(`UPDATE mc_call_leads SET hearing=COALESCE(hearing,'{}'::jsonb) || jsonb_build_object('mail', $2::text) WHERE id=$1`, [id, to]).catch(() => {});
      // SF のリードに「ヒアリングのメール」の活動を残す。書けなかったら sf_err に残し、画面にも返す（黙って失敗しない）
      let sfNote = "";
      if (lead.sf_lead_id && /^00Q[0-9A-Za-z]{12,15}$/.test(lead.sf_lead_id)) {
        try {
          const lab = new Map(HEAR_ITEMS.map((x) => [x.k, x.label]));
          const t = await leadTask(await sfActor(req), { WhoId: lead.sf_lead_id, Subject: "[MOCHICA] ヒアリングのメール", Type: "Email", Status: "完了",
            ActivityDate: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10),
            Description: [`送った人：${(await nameMap()).get(u) || u}（SHOBO）`, `宛先：${to}`, cc ? `CC：${cc}` : "", `件名：${subject}`, `聞いたこと：${keys.map((k) => lab.get(k) || k).join("・")}`].filter(Boolean).join("\n") });
          if (!t || !t.id) throw new Error("SF から活動の番号が返ってきませんでした");
          await P().query(`UPDATE mc_hear_mails SET sf_task_id=$2 WHERE id=$1`, [row.id, t.id]);
        } catch (e) { sfNote = "メールは送りましたが、SF の活動には書けませんでした"; await P().query(`UPDATE mc_hear_mails SET sf_err=$2 WHERE id=$1`, [row.id, String(e.message).slice(0, 300)]).catch(() => {}); }
      } else sfNote = "SF のリードと結びついていないので、SF には残していません（kinbot にだけ残ります）";
      res.json({ ok: true, to, sf: sfNote });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  }));

  // ===== 問い合わせフォームの送信（2026-11-20 福井さん）=====
  //   受付・担当者に「HP のフォームから」と言われた会社へ、見えないブラウザで入力して送る（server/mcform.js）。
  //   差出人の会社名・電話などは MOCHICA 共通のひな形（管理者が入れる）、名前とメールは送る本人のもの。
  //   流れ：preview（探して当てはめるだけ・送らない）→ 人が中身を確かめる → send（入力して送る）
  const MC_FORM_SUBJECT = "新卒採用のご支援についてのご案内";
  const MC_FORM_BODY = "{会社名}\n{担当者}様\n\n突然のご連絡失礼いたします。{差出人の会社名}の{差出人}と申します。\n先ほどお電話にてご案内した件で、こちらのフォームよりご連絡いたしました。\n\n新卒採用の母集団づくりや選考の歩留まりの改善にお役立ていただける「MOCHICA」をご案内しております。\nご興味がございましたら、オンラインで15分ほどご説明の機会をいただけますと幸いです。\n\nご連絡先：{電話}／{メール}\n何卒よろしくお願いいたします。";
  async function formSettings() {
    const st = await getSettings().catch(() => ({}));
    return { subject: st.mcFormSubject || MC_FORM_SUBJECT, body: st.mcFormBody || MC_FORM_BODY, company: st.mcFormCompany || "", companyKana: st.mcFormCompanyKana || "",
      dept: st.mcFormDept || "", tel: st.mcFormTel || "", zip: st.mcFormZip || "", addr: st.mcFormAddr || "", site: st.mcFormSite || "", kana: st.mcFormKana || {} };
  }
  app.get("/api/mccall/form-settings", guard(async (req, res) => {
    const c = await formSettings(); res.json({ ok: true, ...c, kana: undefined, myKana: c.kana[me(req)] || "", admin: isAdmin(req) });
  }));
  app.put("/api/mccall/form-settings", adminOnly(async (req, res) => {
    const b = req.body || {}; const patch = {};
    const map = { subject: "mcFormSubject", company: "mcFormCompany", companyKana: "mcFormCompanyKana", dept: "mcFormDept", tel: "mcFormTel", zip: "mcFormZip", addr: "mcFormAddr", site: "mcFormSite" };
    for (const [k, sk] of Object.entries(map)) if (b[k] !== undefined) patch[sk] = clip(b[k], 300);
    if (b.body !== undefined) patch.mcFormBody = String(b.body || "").slice(0, 4000);
    await saveSettings(patch); res.json({ ok: true });
  }));
  // 送る本人の情報と本文（差し込み済み）。本文・件名は画面で直したものを優先する
  async function formProfile(req, lead, b = {}) {
    const c = await formSettings(); const u = me(req);
    const sender = (await nameMap()).get(u) || "";
    const company = String(lead.company || "").trim(); const person = String((lead.gate && lead.gate.name) || lead.person || "").trim();
    const fill = (t) => String(t || "").replace(/\{担当者\}/g, person || "ご担当者").replace(/\{会社名\}/g, company).replace(/\{差出人の会社名\}/g, c.company)
      .replace(/\{差出人\}/g, sender).replace(/\{電話\}/g, c.tel).replace(/\{メール\}/g, u);
    const kana = b.kana != null ? clip(b.kana, 60) : (c.kana[u] || "");
    return { c, sender, P: { company: c.company, companyKana: c.companyKana, dept: c.dept, name: sender, kana, email: u, tel: c.tel, zip: c.zip, addr: c.addr, site: c.site,
      subject: b.subject != null ? clip(b.subject, 300) : fill(c.subject), body: b.body != null ? String(b.body).slice(0, 4000) : fill(c.body) } };
  }
  const formStart = (lead, b) => { const inf = lead.info || {}; return String((b && b.url) || inf.web || "").trim(); };
  async function formGuard(req, res, lead) {
    const ban = await approachBanHitLead(lead).catch(() => ({ reason: "アプローチ禁止の名簿を確認できなかったため、念のため止めています" }));
    if (ban) { res.status(403).json({ error: `「${lead.company}」はアプローチ禁止のため、問い合わせフォームからも送れません` }); return false; }
    return true;
  }
  app.post("/api/mccall/leads/:id/form/preview", guard(async (req, res) => {
    try {
      const { lead, data } = await leadFor(req, parseInt(req.params.id, 10)); const b = req.body || {};
      if (!(await formGuard(req, res, lead))) return;
      const { c, P: prof } = await formProfile(req, lead, b);
      const web = formStart(lead, b) || fieldsIn(data, WEB_FIELD).find((w) => webKey(w)) || "";
      const last = (await P().query(`SELECT status, created_at FROM mc_form_sends WHERE lead_id=$1 AND status IN ('sent','unsure') ORDER BY created_at DESC LIMIT 1`, [lead.id])).rows[0] || null;
      const base = { company: lead.company, subject: prof.subject, body: prof.body, kana: prof.kana, ready: !!(c.company && c.tel), last };
      if (b.scan === false) return res.json({ ok: true, ...base, url: web });   // 本文だけ先に見せる（フォームを調べるのは時間がかかるので別に呼ぶ）
      const r = await formRun({ web, mode: "inspect", P: prof });
      res.json({ ...base, ...r, ok: true, found: r.ok, url: r.url || web });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  }));
  app.post("/api/mccall/leads/:id/form/send", guard(async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10); const { lead, data } = await leadFor(req, id); const b = req.body || {}; const u = me(req);
      if (!(await formGuard(req, res, lead))) return;
      const { c, sender, P: prof } = await formProfile(req, lead, b);
      if (!c.company || !c.tel) return res.status(400).json({ error: "差出人の会社名と電話番号がひな形に入っていません。管理者が「リスト」タブの「問い合わせフォームのひな形」で入れてください" });
      if (!prof.body.trim()) return res.status(400).json({ error: "本文を入れてください" });
      const url = formStart(lead, b) || fieldsIn(data, WEB_FIELD).find((w) => webKey(w)) || "";
      // 同じ会社に30日のうちに2回送らない（相手に迷惑をかけないため。もう一度送るときは画面で「それでも送る」を押す）
      const dup = (await P().query(`SELECT created_at FROM mc_form_sends WHERE lead_id=$1 AND status IN ('sent','unsure') AND created_at > now() - interval '30 days' ORDER BY created_at DESC LIMIT 1`, [id])).rows[0];
      if (dup && !b.again) return res.status(409).json({ error: `この会社には ${new Date(dup.created_at).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })} に問い合わせフォームから送っています`, dup: true });
      // ふりがなは本人ごとに覚えておく（次から入れなくてよいように）
      if (b.kana != null && prof.kana !== (c.kana[u] || "")) await saveSettings({ mcFormKana: { ...c.kana, [u]: prof.kana } }).catch(() => {});
      const r = await formRun({ web: url, url, mode: "send", P: prof });
      const status = r.status || "failed";
      const row = (await P().query(`INSERT INTO mc_form_sends (lead_id, sender, url, status, note, subject, body) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [id, u, clip(r.url || url, 300), status, clip(r.error || r.note || "", 500), prof.subject, prof.body])).rows[0];
      if (status === "failed") return res.status(422).json({ error: r.error || "送れませんでした", log: r.log || [] });
      // SF のリードに活動を残す。書けなかったら sf_err に残して画面にも返す（黙って失敗しない）
      let sfNote = "";
      if (lead.sf_lead_id && /^00Q[0-9A-Za-z]{12,15}$/.test(lead.sf_lead_id)) {
        try {
          const t = await leadTask(await sfActor(req), { WhoId: lead.sf_lead_id, Subject: "[MOCHICA] 問い合わせフォーム送信", Status: "完了",
            ActivityDate: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10),
            Description: [`送った人：${sender || u}（SHOBO）`, `フォーム：${r.url || url}`, FORM_ST[status], r.note || "", `件名：${prof.subject}`, "", prof.body].filter((x) => x != null).join("\n").slice(0, 30000) });
          if (!t || !t.id) throw new Error("SF から活動の番号が返ってきませんでした");
          await P().query(`UPDATE mc_form_sends SET sf_task_id=$2 WHERE id=$1`, [row.id, t.id]);
        } catch (e) { sfNote = "SF の活動には書けませんでした"; await P().query(`UPDATE mc_form_sends SET sf_err=$2 WHERE id=$1`, [row.id, String(e.message).slice(0, 300)]).catch(() => {}); }
      } else sfNote = "SF のリードと結びついていないので、SF には残していません（kinbot にだけ残ります）";
      res.json({ ok: true, status, note: r.note || "", url: r.url || url, sf: sfNote });
    } catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  }));

  // ===== アポのおすすめ日時（2026-11-17 福井さん）=====
  //   MOCHICA のクローザー（メンバー管理で事業が MOCHICA・役割がクローザー）のカレンダーの空きから選ぶ。
  //   DOC の kincall の候補日（DOC のクローザー）は使わない（DOC の人が出ないように）。
  //   空きの見方は DOC とそろえる：終日・参加しない予定・「リスケ」「キャンセル」は空きとみなす。
  //   チーム制（2026-11-23 福井さん）：同じチームの IS が取ったアポは同じチームの FS へ。FS にもチームを付けて返す（server/mcteam.js）
  async function mcClosers() {
    const ms = await listMembers().catch(() => []);
    return ms.filter((m) => m.email && m.active !== false && (m.businesses || []).includes("MOCHICA") && (m.roles || []).includes("closer"))
      .map((m) => ({ email: String(m.email).toLowerCase(), name: m.name || m.email, team: teamOf(m, ms) }));
  }
  // 架電している人（IS）のチーム。分からない人は ""（今までどおり FS 全員から選ぶ）
  async function myTeamOf(req) {
    const [ms, us] = await Promise.all([listMembers().catch(() => []), listUsers().catch(() => [])]);
    const u = (us || []).find((x) => String(x.email || "").toLowerCase() === me(req));
    return teamOf({ email: me(req), name: (u && u.name) || "" }, ms);
  }
  // クローザーの Google カレンダーの「埋まっている時間」を読む（2026-11-18 福井さん「クローザーのグーグルカレンダーの空き日程に」）
  //   1) クローザー本人が Google 連携していれば、本人の権限で本人のカレンダーを読む（非公開の予定も漏れない）
  //   2) まだの人は、連携済みの人（自分・アポを読む係・ほかのクローザー）の権限で FreeBusy を読む
  //      FreeBusy は予定の中身を見ないので、詳細を非公開にしているカレンダーでも空きだけは分かる
  //   予定の「辞退」「予定なし（空き）」扱いは Google 側で除かれる。読めなかった人は「空き」と数えない
  async function busyOf(req, members, timeMin, timeMax) {
    const busy = new Map();
    const take = (m, cal) => { if (!cal || (cal.errors && cal.errors.length)) return false;
      busy.set(m.email, cal.busy.map((x) => [Date.parse(x.start), Date.parse(x.end)]).filter(([s0, e0]) => !isNaN(s0) && !isNaN(e0) && e0 > s0)); return true; };
    await Promise.all(members.map(async (m) => {
      try { take(m, (await freeBusy(m.email, [m.email], timeMin, timeMax))[m.email]); } catch {}
    }));
    let rest = members.filter((m) => !busy.has(m.email));
    if (rest.length) {
      const st = await getSettings().catch(() => ({}));
      const readers = [...new Set([me(req), String(st.apoScanOwner || "").toLowerCase(), String(st.calendarOwner || "").toLowerCase(), ...members.map((m) => m.email)].filter(Boolean))];
      for (const r of readers) {
        if (!rest.length) break;
        try { const fb = await freeBusy(r, rest.map((m) => m.email), timeMin, timeMax); rest = rest.filter((m) => !take(m, fb[m.email])); } catch {}
      }
    }
    for (const m of rest) busy.set(m.email, null);
    return members.some((m) => Array.isArray(busy.get(m.email))) ? busy : null;
  }
  const freeAt = (busy, members, t, mins) => members.filter((m) => { const b = busy.get(m.email); return Array.isArray(b) && !b.some(([bs, be]) => bs < t + mins * 60e3 && be > t); });
  // 枠に出す「空いている FS」：自分のチームの FS を出し、自分のチームがだれも空いていないときだけ他チームを otherTeam の印つきで出す
  const slotOut = (t, free0, total, team) => { const j = new Date(t + 9 * 3600e3); const sp = splitFree(free0, team); const free = (sp.useOther ? sp.other : sp.mine).map((m) => m.name);
    return { at: new Date(t).toISOString(), md: `${j.getUTCMonth() + 1}/${j.getUTCDate()}`, dow: "日月火水木金土"[j.getUTCDay()], time: `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`, band: j.getUTCHours() < 12 ? "午前" : "午後", free, freeN: free.length, total, otherTeam: sp.useOther }; };
  // 画面の「対象」に出すもの：自分のチームと、そのチームの FS（チームが分からない人は FS 全員）
  const teamInfo = (members, team) => ({ team: teamLabel(team), members: (team && members.some((m) => m.team === team) ? members.filter((m) => m.team === team) : members).map((m) => m.name) });
  // おすすめ：翌営業日から2週間、平日 10〜18時の1時間枠。空いている人の多い日を週ごとに3日、その日の午前・午後で一番空いている枠を1つずつ
  app.get("/api/mccall/slots", guard(async (req, res) => {
    const [members, team] = await Promise.all([mcClosers(), myTeamOf(req)]);
    if (!members.length) return res.json({ ok: true, slots: [], members: [], reason: "MOCHICA のクローザーが決まっていません。設定 → メンバー管理で、事業 MOCHICA・役割 クローザーを付けてください" });
    const now = Date.now(); const busy = await busyOf(req, members, new Date(now).toISOString(), new Date(now + 16 * 86400e3).toISOString());
    if (!busy) return res.json({ ok: true, slots: [], ...teamInfo(members, team), reason: "カレンダーの空きを読めませんでした。自分かクローザーの Google 連携を確かめてください" });
    const today = jstDayStart(new Date(now)).getTime(); const days = [];
    for (let d = 1; d <= 15; d++) {
      const day = today + d * 86400e3; const wd = new Date(day + 9 * 3600e3).getUTCDay(); if (wd === 0 || wd === 6) continue;
      const slots = []; for (let h = 10; h < 18; h++) { const t = day + h * 3600e3; slots.push({ t, h, free: freeAt(busy, members, t, 60) }); }
      days.push({ day, week: d <= 7 ? 1 : 2, best: Math.max(...slots.map((s) => slotScore(s.free, team))), slots });   // 自分のチームの FS が空いている日を先に
    }
    const pick = (w) => days.filter((x) => x.week === w && x.best > 0).sort((a, b) => (b.best - a.best) || (a.day - b.day)).slice(0, 3);
    const out = [];
    for (const d of [...pick(1), ...pick(2)]) for (const cond of [(h) => h < 12, (h) => h >= 13]) {
      const s = d.slots.filter((x) => cond(x.h) && x.free.length).sort((a, b) => (slotScore(b.free, team) - slotScore(a.free, team)) || (a.h - b.h))[0];
      if (s) out.push({ ...slotOut(s.t, s.free, members.length, team), week: d.week });   // 画面で「1週目・2週目」に分けて出すため
    }
    out.sort((a, b) => new Date(a.at) - new Date(b.at));
    res.json({ ok: true, slots: out.slice(0, 12), ...teamInfo(members, team), unread: members.filter((m) => busy.get(m.email) === null).map((m) => m.name) });
  }));
  // 選んだ1日の空き（30分きざみ・9〜19時・商談の長さ分まるごと空いている人）
  app.get("/api/mccall/slots/day", guard(async (req, res) => {
    const date = String(req.query.date || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "日付が正しくありません" });
    const mins = Math.max(15, Math.min(240, parseInt(req.query.minutes, 10) || 60));
    const [members, team] = await Promise.all([mcClosers(), myTeamOf(req)]);
    if (!members.length) return res.json({ ok: true, slots: [], reason: "MOCHICA のクローザーが決まっていません" });
    const day = Date.parse(`${date}T00:00:00+09:00`);
    const busy = await busyOf(req, members, new Date(day).toISOString(), new Date(day + 86400e3).toISOString());
    if (!busy) return res.json({ ok: true, slots: [], reason: "カレンダーの空きを読めませんでした" });
    const out = [];
    for (let t = day + 9 * 3600e3; t + mins * 60e3 <= day + 19 * 3600e3; t += 30 * 60e3) {
      if (t < Date.now() + 30 * 60e3) continue; const free = freeAt(busy, members, t, mins); if (free.length) out.push(slotOut(t, free, members.length, team));
    }
    res.json({ ok: true, slots: out, ...teamInfo(members, team), unread: members.filter((m) => busy.get(m.email) === null).map((m) => m.name) });
  }));
  // ===== アポ獲得のあとの流れ（2026-11-23 福井さん「kincall のアポ後の流れを MOCHICALL にも・チーム制で FS に渡す」）=====
  //   kincall（server/index.js の createApoFromKincall → autoAssignOne → createApoInvite）と同じ順で、MOCHICA の表と人だけで回す：
  //     1) 担当の FS を決める：同じチームで空いている FS → いなければ他チームで空いている FS（「他チーム」と明示）
  //        → だれも空いていない・読めないときは自分のチームの FS を担当にして「予定が重なる」と知らせる（アポを落とさない）
  //     2) 獲得した IS のカレンダーに【初回】会社名/○○様 の予定（kincall と同じ。本人の Google → 無ければ予定作成の運用者が IS のカレンダーに書く）
  //     3) FS のカレンダーに商談予定（kincall の createApoInvite と同じ。FS 本人の Google ならゲストなし・通知なしで本人の予定に、
  //        無ければ運用者の予定に FS をゲストで招待）。FS が自分で取ったアポは 2) が本人の予定なので作らない（kincall と同じ）
  //     4) FS に Google Chat で1対1の知らせ（kincall の notifyPerson と同じ仕組み）
  //     SF の活動（Task）は記録のあとの sfWrite で、担当 FS と録音の場所も入れて書く。
  //   入れないもの：DOC の割り振り（closer_rotation・smart_links・アポの自動スキャン）。MOCHICA の人を DOC のアポ振り分けに入れない決まり（2026-11-14）。
  //     先方への確定メールと SF の商談の立ち上げ（コンバート）は、MOCHICA の文面・商談の形が決まっていないのでまだしない（判断待ち・kinbot-memory 参照）。
  //   先方（お客様）には何も送らない。どこかで失敗しても記録は止めない。結果は mc_call_logs.apo_flow に残して画面に出す（黙って失敗しない）
  const pickCol = (o, re) => { for (const [k, v] of Object.entries((o && typeof o === "object") ? o : {})) if (re.test(k) && v != null && typeof v !== "object" && String(v).trim()) return clip(v, 200); return ""; };
  const pubBase = () => String(process.env.PUBLIC_URL || "").replace(/\/+$/, "");
  const recLink = (logId) => (pubBase() ? `${pubBase()}/api/mccall/logs/${logId}/rec` : "");
  // カレンダーに予定を作る。上から順に試し、作れたところで止める（kincall の createApoFromKincall と同じ考え方）
  async function calPut(tries, ev) {
    let err = "";
    for (const t of tries.filter(Boolean)) {
      try {
        if (!(await googleConnected(t.owner).catch(() => false))) { err = err || `${t.owner} の Google 連携がありません`; continue; }
        const guests = t.guests || [];
        const r = await createCalendarEvent(t.owner, { ...ev, calendarId: t.cal, guests, guestsCanModify: true, sendUpdates: guests.length ? "all" : "none" });
        if (r && r.id) return { ok: true, id: r.id, owner: t.owner, cal: t.cal, guest: guests.length > 0 };
      } catch (e) { err = String(e.message || e).slice(0, 160); }
    }
    return { ok: false, err: err || "Google 連携がありません" };
  }
  const hhmm = (d) => { const j = new Date(new Date(d).getTime() + 9 * 3600e3); return `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`; };
  const dayText = (d) => { const j = new Date(new Date(d).getTime() + 9 * 3600e3); return `${j.getUTCMonth() + 1}/${j.getUTCDate()}（${"日月火水木金土"[j.getUTCDay()]}）${hhmm(d)}`; };
  async function afterApo(req, logId) {
    const g = (await P().query(`SELECT g.*, c.company, c.person, c.phone AS lead_phone, c.sf_lead_id, c.data, c.gate AS lead_gate, c.hearing AS lead_hearing, l.name AS list_name
      FROM mc_call_logs g JOIN mc_call_leads c ON c.id=g.lead_id LEFT JOIN mc_call_lists l ON l.id=g.list_id WHERE g.id=$1`, [logId])).rows[0];
    if (!g || !g.apo_at || g.outcome !== "apo") return null;
    const setter = String(g.caller || "").toLowerCase();
    const start = new Date(g.apo_at), end = new Date(start.getTime() + 60 * 60e3);   // MOCHICALL の候補は1時間枠（/api/mccall/slots と同じ）
    const [names, closers, myTeam, st] = await Promise.all([nameMap(), mcClosers(), myTeamOf(req), getSettings().catch(() => ({}))]);
    const setterName = names.get(setter) || setter;
    const flow = { at: new Date().toISOString(), team: teamLabel(myTeam), warn: [] };
    // 1) 担当の FS
    let busy = null; try { busy = closers.length ? await busyOf(req, closers, start.toISOString(), end.toISOString()) : null; } catch {}
    const okMap = new Map(closers.map((c) => { const b = busy && busy.get(c.email); return [c.email, Array.isArray(b) ? !b.some(([bs, be]) => bs < end.getTime() && be > start.getTime()) : null]; }));
    const fs = pickFs(closers, okMap, myTeam);
    if (fs) flow.fs = { email: fs.email, name: fs.name, team: teamLabel(fs.team), other: !!fs.other, conflict: !!fs.conflict };
    else flow.warn.push(closers.length ? "担当の FS を決められませんでした（あなたのチームが決まっておらず、この時間に空いている FS もいません）。管理者に伝えてください"
      : "MOCHICA の FS（クローザー）が決まっていません。設定 → メンバー管理で、事業 MOCHICA・役割 クローザーを付けてください");
    if (fs && fs.other) flow.warn.push(`あなたのチームの FS がこの時間に空いていないため、他チームの ${fs.name}さんにお願いしました`);
    if (fs && fs.conflict) flow.warn.push(`${fs.name}さんはこの時間に予定があります（またはカレンダーを読めませんでした）。${fs.name}さんに日程の調整を頼んでください`);
    // 予定と SF に載せる中身（FS が予定を開いただけで、だれに・何を話すか分かるように）
    const person = clip((g.gate && g.gate.name) || (g.lead_gate && g.lead_gate.name) || g.person || "", 40).replace(/\s*様$/, "");
    const email = pickCol(g.data, /メール|e-?mail/i), web = pickCol(g.data, /^(web|url|hp|ホームページ|サイト|会社url|webサイト)/i);
    const hearing = hearingLines(g.hearing || g.lead_hearing);
    const gt = g.gate || g.lead_gate || {};
    let sfUrl = "";
    if (g.sf_lead_id) try { const info = await sfConnInfo(await sfActor(req)); if (info && info.instanceUrl) sfUrl = `${String(info.instanceUrl).replace(/\/+$/, "")}/lightning/r/Lead/${g.sf_lead_id}/view`; } catch {}
    const rec = recLink(logId);
    const label = `【初回】${g.company || "会社名なし"}${person ? `/${person}様` : ""}`;
    // 先頭の目印は server/index.js の KINBOT_INVITE_MARK と同じ文。DOC のアポの自動スキャン（collectApoAppointments）は
    //   この目印のある予定を「kinbot が作った予定」として拾わない。FS や運用者が DOC のクローザーにも入っているとき、
    //   この予定が DOC のアポとして取り込まれ、DOC の割り振り・SF の立ち上げが走るのを防ぐ
    const desc = [
      "kinbotが自動作成した商談予定です（SHOWIN の MOCHICALL のアポ獲得から）", "",
      g.list_name ? `【リスト】${g.list_name}` : "",
      "【先方】", `会社：${g.company || "（なし）"}`, person ? `担当：${person}様` : "", `電話：${clip(g.phone || g.lead_phone, 40) || "（未登録）"}`, email ? `メール：${email}` : "", web ? `Web：${web}` : "",
      "", `【アポ獲得】${setterName}${flow.team ? `（${flow.team}）` : ""}`,
      flow.fs ? `【担当 FS】${flow.fs.name}${flow.fs.team ? `（${flow.fs.team}）` : ""}${flow.fs.other ? "　※ 他チーム（アポ獲得者のチームの FS が空いていなかったため）" : ""}` : "【担当 FS】未定",
      hearing.length ? `\n【ヒアリング】\n${hearing.join("\n")}` : "",
      gt.name || gt.hours || gt.direct ? `\n【受付で聞けたこと】${[gt.name && `担当 ${gt.name}`, gt.hours && `在席 ${gt.hours}`, gt.direct && `直通 ${gt.direct}`].filter(Boolean).join("・")}` : "",
      g.memo ? `\n【メモ】\n${g.memo}` : "",
      rec ? `\n【通話の録音】${rec}\n（記録してから5分ほどで聞けるようになります。kinbot にログインして開きます）` : "",
      sfUrl ? `【SF のリード】${sfUrl}` : "",
    ].filter(Boolean).join("\n");
    const ev = { summary: label, description: desc.slice(0, 7000), start: start.toISOString(), end: end.toISOString() };
    const ops = String(st.apoScanOwner || st.apoInviteOwner || "").trim().toLowerCase();
    const inviteOps = String(st.apoInviteOwner || st.apoScanOwner || "").trim().toLowerCase();
    // 2) IS のカレンダー
    flow.isEv = await calPut([{ owner: setter, cal: "primary" }, ops && ops !== setter ? { owner: ops, cal: setter } : null], ev);
    if (!flow.isEv.ok) flow.warn.push(`あなたのカレンダーに予定を作れませんでした（${flow.isEv.err}）`);
    // 3) FS のカレンダー（FS が自分で取ったアポは 2) が本人の予定なので作らない）
    if (fs && fs.email !== setter) {
      flow.fsEv = await calPut([{ owner: fs.email, cal: "primary" }, inviteOps && inviteOps !== fs.email ? { owner: inviteOps, cal: String(st.apoInviteCalendarId || "").trim() || "primary", guests: [fs.email] } : null], ev);
      if (!flow.fsEv.ok) flow.warn.push(`${fs.name}さんのカレンダーに予定を作れませんでした（${flow.fsEv.err}）。${fs.name}さんに直接伝えてください`);
      // 4) FS への知らせ
      const text = [
        "📅 *アポが入りました（MOCHICALL）*", `　${label}`, `🕐 ${dayText(start)}〜${hhmm(end)}`,
        `🙋 アポ獲得：${setterName}${flow.team ? `（${flow.team}）` : ""}`,
        fs.other ? `※ ${flow.team || "アポ獲得者のチーム"}の FS がこの時間に空いていなかったため、他チームのアポとしてお願いします` : "",
        fs.conflict ? "⚠️ この時間はあなたのカレンダーに予定があります（または読めませんでした）。日程の調整をお願いします" : "",
        person ? `担当：${person}様　電話：${clip(g.phone || g.lead_phone, 40) || "（未登録）"}` : "",
        hearing.length ? `ヒアリング：${hearing.join("／")}` : "", g.memo ? `メモ：${clip(g.memo, 300)}` : "",
        rec ? `🎧 通話の録音：${rec}` : "", sfUrl ? `SF：${sfUrl}` : "",
        flow.fsEv.ok ? "カレンダーに商談予定を入れました。" : "カレンダーには入れられませんでした。予定を手で入れてください。",
      ].filter(Boolean).join("\n");
      const n = await notifyPerson(fs.email, text).catch((e) => ({ ok: false, reason: e.message }));
      flow.notify = { ok: !!(n && n.ok), reason: n ? [n.reason, n.hint].filter(Boolean).join("。") : "" };
      if (!flow.notify.ok) flow.warn.push(`${fs.name}さんに Chat で知らせられませんでした（${flow.notify.reason || "理由不明"}）。直接伝えてください`);
    }
    await P().query(`UPDATE mc_call_logs SET apo_flow=$2, apo_who=COALESCE($3, apo_who) WHERE id=$1`, [logId, flow, flow.fs ? `${flow.fs.name}${flow.fs.team ? `（${flow.fs.team}）` : ""}${flow.fs.other ? "・他チーム" : ""}` : null]).catch(() => {});
    console.log(`[mccall] アポのあと：${label} ${dayText(start)} 獲得 ${setterName}${flow.team ? `（${flow.team}）` : ""} → FS ${flow.fs ? flow.fs.name : "未定"}${flow.fs && flow.fs.other ? "（他チーム）" : ""}` +
      ` 予定 IS:${flow.isEv.ok ? "○" : "×"} FS:${flow.fsEv ? (flow.fsEv.ok ? "○" : "×") : "-"} 知らせ:${flow.notify ? (flow.notify.ok ? "○" : "×") : "-"}`);
    return { fs: flow.fs ? { name: flow.fs.name, team: flow.fs.team, other: flow.fs.other, conflict: flow.fs.conflict } : null, team: flow.team,
      isCal: flow.isEv.ok, fsCal: flow.fsEv ? flow.fsEv.ok : null, notified: flow.notify ? flow.notify.ok : null, warn: flow.warn };
  }
  // アポを取り消したら、作った予定を消して FS に知らせる（ここで作った予定だけ。ほかの予定には触らない）
  async function undoApo(g) {
    const f = g.apo_flow; if (!f) return "";
    const out = [];
    for (const k of ["isEv", "fsEv"]) {
      const e = f[k]; if (!e || !e.ok || !e.id) continue;
      const who = k === "isEv" ? "あなた" : `${(f.fs && f.fs.name) || "FS"}さん`;
      const ok = await deleteCalendarEvent(e.owner, e.id, e.cal).catch(() => false);
      out.push(ok ? `${who}の予定を消しました` : `${who}の予定は消せませんでした（カレンダーで消してください）`);
    }
    if (f.fs && f.fs.email && f.notify && f.notify.ok) {
      const lead = (await P().query(`SELECT company FROM mc_call_leads WHERE id=$1`, [g.lead_id])).rows[0] || {};
      await notifyPerson(f.fs.email, `↩️ *アポが取り消されました（MOCHICALL）*\n　${lead.company || ""}　${g.apo_at ? dayText(g.apo_at) : ""}\n記録の間違いで取り消されました。カレンダーの予定も消しています。`).catch(() => {});
      out.push(`${f.fs.name}さんに取り消しを知らせました`);
    }
    return out.join("。");
  }
  // 通話の録音（予定・SF・知らせに載せるリンク）。録音は記録の数分後に結びつくので、リンクは記録の番号で作っておき、開いたときに探す
  app.get("/api/mccall/logs/:id/rec", guard(async (req, res) => {
    const g = (await P().query(`SELECT rec FROM mc_call_logs WHERE id=$1 AND NOT undone`, [parseInt(req.params.id, 10)])).rows[0];
    const recId = g && g.rec && g.rec.recId;
    if (recId) return res.redirect(`/api/calls/zoom-rec/${encodeURIComponent(recId)}/audio`);
    const why = !g ? "この記録は見つからないか、取り消されています" : g.rec && g.rec.status === "none" ? "この通話の録音は見つかりませんでした（Zoom Phone の録音が無い通話です）" : "録音はまだ結びついていません。記録してから5分ほどで聞けるようになります。少し待ってから開き直してください";
    res.status(404).type("html").send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>通話の録音</title><body style="font:15px/1.7 system-ui,sans-serif;margin:24px;color:#1f2d28"><h1 style="font-size:18px;color:#0d5b47">通話の録音</h1><p>${why}</p></body>`);
  }));
  app.get("/api/mccall/meta", guard(async (req, res) => {
    // 管理者の画面には、いま管理者として扱っている人の名前も返す（苗字で照合しているので、漏れや取り違えを見えるように）
    // 管理者の名前はインターンにも返す（「かける」が止まったときに、だれに知らせればよいかを画面に出すため）
    //   環境変数で足した管理者は名前が分からずメールアドレスのままなので、管理者以外には出さない
    const admins = (deps.adminNames ? await deps.adminNames().catch(() => []) : []).filter((x) => isAdmin(req) || !String(x).includes("@"));
    res.json({ ok: true, reach: REACH, rejectReasons: REJECT_REASONS, gateReasons: GATE_REASONS, needChoices: NEED_CHOICES, hearItems: HEAR_ITEMS, admin: isAdmin(req), admins, me: me(req) });
  }));
}
