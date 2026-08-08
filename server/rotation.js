// ───────────────────────────────────────────────────────────
// クローザーの自動割り振り（ローテーション）
//
// 順番は closer_rotation の sort_order（例：植野1 → 田中2 → 江田3 → 森田4）。
// 次に回ってくる人は settings.apoRotationNextOrder に保存され、日付が変わっても
// 前日の続きから始まる。
//
// 割り振りの規則（GAS版の仕様をそのまま踏襲）
//   1. 「代打で飛ばされた人（priority）」がいれば、その人を最優先で試す
//   2. それ以外は、次に回ってくる人から順番に試す
//   3. 商談の時間帯にカレンダーが埋まっていたら飛ばして次の人へ（＝代打）
//      飛ばされた人には priority を立て、次のアポで最優先に戻す
//   4. 代打も順番に回るので、特定の人に偏らない
//   5. 全員埋まっていたら未割り当てのまま残す（画面で手動対応）
// ───────────────────────────────────────────────────────────
import { freeBusy, isSlotFree } from "./google.js";
import {
  getSettings, saveSettings,
  listClosers, markCloserAssigned, markCloserSkipped,
  countAssignedOnDate, logAssign, clearCloserPriority,
} from "./db.js";

// JSTの「YYYY-MM-DD」
function jstDate(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function getRotationConfig() {
  const s = (await getSettings().catch(() => ({}))) || {};
  return {
    // 自動割り振りのON/OFF（既定OFF）
    autoAssign: s.apoRotationAuto === true,
    // 15分おきの自動スキャンのON/OFF（既定OFF）
    autoScan: s.apoAutoScan === true,
    // 商談の前後に確保したい余白（分）。移動や準備の時間。
    bufferMin: Number.isFinite(+s.apoRotationBufferMin) ? Math.max(0, +s.apoRotationBufferMin) : 0,
    // 次に回ってくる人の sort_order
    nextOrder: Number.isFinite(+s.apoRotationNextOrder) ? +s.apoRotationNextOrder : 1,
    // 1回のスキャンで自動割り振りする上限（暴走時の保険）
    maxPerRun: Number.isFinite(+s.apoRotationMaxPerRun) ? Math.max(1, +s.apoRotationMaxPerRun) : 30,
  };
}

// 「次に回ってくる人」を起点に、候補を順番に並べた配列を作る
export function orderCandidates(closers, nextOrder) {
  const list = closers.filter((c) => c.active);
  if (!list.length) return [];
  // sort_order が nextOrder 以上の人 → その後に前半の人、で1周分の順番を作る
  const after = list.filter((c) => c.sort_order >= nextOrder);
  const before = list.filter((c) => c.sort_order < nextOrder);
  const rotated = [...after, ...before];
  // 代打で飛ばされた人（priority）を先頭へ。複数いれば sort_order 順。
  const pri = rotated.filter((c) => c.priority).sort((a, b) => a.sort_order - b.sort_order);
  const rest = rotated.filter((c) => !c.priority);
  return [...pri, ...rest];
}

// 1件のアポについてクローザーを決める。
// 戻り値: { email, name, reason, skipped:[{email,name,reason}] } / 割り当て不可なら email=null
export async function pickCloser(link, { inviteOwner, closers = null, cfg = null } = {}) {
  const conf = cfg || (await getRotationConfig());
  const all = closers || (await listClosers());
  const cands = orderCandidates(all, conf.nextOrder);
  if (!cands.length) {
    return { email: null, name: "", reason: "有効なクローザーが登録されていません", skipped: [] };
  }
  if (!link.start_time) {
    return { email: null, name: "", reason: "商談の開始時刻が分かりません", skipped: [] };
  }

  const startISO = new Date(link.start_time).toISOString();
  const endISO = link.end_time
    ? new Date(link.end_time).toISOString()
    : new Date(new Date(link.start_time).getTime() + 60 * 60 * 1000).toISOString();

  // 空き状況は1回のAPI呼び出しで全員分まとめて取る
  let fb = {};
  try {
    fb = await freeBusy(
      inviteOwner,
      cands.map((c) => c.email),
      new Date(new Date(startISO).getTime() - conf.bufferMin * 60000),
      new Date(new Date(endISO).getTime() + conf.bufferMin * 60000)
    );
  } catch (e) {
    return { email: null, name: "", reason: `空き状況を取得できませんでした: ${e.message}`, skipped: [] };
  }

  const day = jstDate(startISO);
  const skipped = [];
  for (const c of cands) {
    // 1日の上限件数（設定していれば）
    if (c.daily_cap) {
      const n = await countAssignedOnDate(c.email, day);
      if (n >= c.daily_cap) {
        skipped.push({ email: c.email, name: c.name, reason: `1日の上限${c.daily_cap}件に達しています` });
        continue;
      }
    }
    const chk = isSlotFree(fb, c.email, startISO, endISO, conf.bufferMin);
    if (!chk.free) {
      skipped.push({ email: c.email, name: c.name, reason: chk.reason });
      continue;
    }
    return {
      email: c.email,
      name: c.name,
      sortOrder: c.sort_order,
      reason: c.priority ? "前回代打で飛ばされたため最優先" : "ローテーション順",
      skipped,
    };
  }
  return { email: null, name: "", reason: "全員この時間帯に予定が入っています", skipped };
}

// 割り当てを確定し、ローテーションの状態を進める
export async function commitAssignment(link, pick, { actor = "auto" } = {}) {
  const all = await listClosers();
  const active = all.filter((c) => c.active).sort((a, b) => a.sort_order - b.sort_order);

  // 飛ばされた人には最優先の印を立てる
  const skippedEmails = (pick.skipped || []).map((s) => s.email);
  if (skippedEmails.length) await markCloserSkipped(skippedEmails);

  // 割り当てられた人の印を外し、件数を進める
  await markCloserAssigned(pick.email);

  // 次に回ってくる人＝割り当てた人の次
  const idx = active.findIndex((c) => c.email === pick.email);
  const next = idx >= 0 && active.length ? active[(idx + 1) % active.length] : active[0];
  if (next) await saveSettings({ apoRotationNextOrder: next.sort_order });

  await logAssign({
    slug: link.slug,
    assigned: pick.email,
    reason: pick.reason,
    skipped: pick.skipped || [],
    actor,
  });
  return { nextOrder: next ? next.sort_order : null, nextName: next ? next.name : "" };
}

// 次に誰に回るかを見る（GAS版の checkRotation 相当）
export async function rotationStatus() {
  const cfg = await getRotationConfig();
  const all = await listClosers();
  const cands = orderCandidates(all, cfg.nextOrder);
  return {
    config: cfg,
    closers: all,
    // 実際に次に試される順番（代打の最優先を反映済み）
    order: cands.map((c) => ({
      email: c.email, name: c.name, sort_order: c.sort_order, priority: c.priority,
      assigned_count: c.assigned_count, daily_cap: c.daily_cap,
    })),
    next: cands[0] ? { email: cands[0].email, name: cands[0].name, priority: cands[0].priority } : null,
  };
}

// 次を特定の人から始める（GAS版の setNextUeno 相当。誰でも指定できるようにした）
export async function setNextCloser(email) {
  const all = await listClosers();
  const target = all.find((c) => c.email === String(email || "").toLowerCase());
  if (!target) throw new Error("そのクローザーは登録されていません");
  // 最優先フラグ（代打で飛ばされた印）は全員分クリアしてから、指定の人を起点にする
  await clearCloserPriority();
  await saveSettings({ apoRotationNextOrder: target.sort_order });
  return rotationStatus();
}
