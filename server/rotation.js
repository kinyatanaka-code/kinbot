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
//   5. 「予備」に印を付けた人（チームリーダー等）は通常の順番に入らず、
//      通常メンバー全員が埋まっているときだけ回る。予備が複数いる場合は、
//      所属チームのアポ累計が少ない側を先に試す。
//   6. 全員埋まっていたら未割り当てのまま残す（画面で手動対応）
// ───────────────────────────────────────────────────────────
import { freeBusy, isSlotFree } from "./google.js";
import {
  getSettings, saveSettings,
  listClosers, markCloserAssigned, markCloserSkipped,
  countAssignedOnDate, logAssign, clearCloserPriority,
  listTeams, syncTeamsFromClosers, markTeamAssigned, markTeamsSkipped, clearTeamPriority, setTeamNext,
  teamAssignStats, closerAssignStats, suspendedNow, eligibleDays, listSuspensions,
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
    // 次に回ってくる人の sort_order（事業ごとに別で持つ）
    nextOrder: Number.isFinite(+s.apoRotationNextOrder) ? +s.apoRotationNextOrder : 1,
    nextOrderByBiz: (s.apoRotationNextByBiz && typeof s.apoRotationNextByBiz === "object") ? s.apoRotationNextByBiz : {},
    // 1回のスキャンで自動割り振りする上限（暴走時の保険）
    maxPerRun: Number.isFinite(+s.apoRotationMaxPerRun) ? Math.max(1, +s.apoRotationMaxPerRun) : 30,
    // チーム単位の均等化
    //   off     … チームを見ない（個人のローテーションだけ）
    //   total   … チームの合計件数が少ないチームを優先
    //   perHead … 1人あたりの件数が少ないチームを優先
    //   perDay  … 稼働1日あたりの件数が少ないチームを優先（停止期間を分母から除く）
    //             停止していた人・チームを、あとから優先して埋め合わせないのでこれが公平。
    teamBalance: ["off", "total", "perHead", "perDay"].includes(s.apoTeamBalance) ? s.apoTeamBalance : "off",
    // 稼働日を数える起点（未設定なら90日前から）
    fairnessStart: /^\d{4}-\d{2}-\d{2}$/.test(String(s.apoFairnessStart || "")) ? String(s.apoFairnessStart) : "",
    // 均等化を判断する期間（month=当月・all=通算）
    balanceWindow: s.apoBalanceWindow === "all" ? "all" : "month",
  };
}

// 均等化に使う期間（JSTの当月、または通算=null）
export function balanceRange(window, fairnessStart = "") {
  if (window === "all") {
    // 通算のときは「稼働日を数える起点」から今日までを見る。
    // 未設定なら90日前から（SQL側の既定と揃える）。
    const to = new Date(Date.now() + 9 * 3600 * 1000);
    const toStr = new Date(to.getTime() + 86400000).toISOString().slice(0, 10);
    if (fairnessStart) return { from: fairnessStart, to: toStr, label: `${fairnessStart}以降` };
    const from = new Date(to.getTime() - 90 * 86400000).toISOString().slice(0, 10);
    return { from, to: toStr, label: "直近90日" };
  }
  const nowJst = new Date(Date.now() + 9 * 3600 * 1000);
  const y = nowJst.getUTCFullYear(), m = nowJst.getUTCMonth();
  const from = new Date(Date.UTC(y, m, 1, 0, 0, 0) - 9 * 3600 * 1000);
  const to = new Date(Date.UTC(y, m + 1, 1, 0, 0, 0) - 9 * 3600 * 1000);
  return { from: from.toISOString(), to: to.toISOString(), label: `${y}年${m + 1}月` };
}

// その事業で次に回ってくる人の順番。事業を指定しない場合は全体の値を使う。
export function nextOrderFor(cfg, business) {
  const b = String(business || "").trim();
  if (b && Number.isFinite(+cfg.nextOrderByBiz[b])) return +cfg.nextOrderByBiz[b];
  return cfg.nextOrder;
}
async function saveNextOrder(cfg, business, order) {
  const b = String(business || "").trim();
  if (b) {
    const map = { ...cfg.nextOrderByBiz, [b]: order };
    await saveSettings({ apoRotationNextByBiz: map });
  } else {
    await saveSettings({ apoRotationNextOrder: order });
  }
}

export function teamOf(closer) {
  return String((closer && closer.team) || "").trim() || "未設定";
}

// チームの「配りたい度合い」を数値にする。小さいほど優先。
export function teamScore(stat, mode) {
  if (!stat) return 0;
  if (mode === "perDay") {
    // 稼働人日で割る。停止していた期間は分母に入っていないので、
    // 停止で件数が少なくなっただけのチームが優先されることはない。
    const d = stat.personDays || 0;
    return d ? stat.count / d : Number.POSITIVE_INFINITY;
  }
  if (mode === "perHead") {
    const n = stat.activeMembers || stat.members || 0;
    return n ? stat.count / n : Number.POSITIVE_INFINITY; // 稼働者0のチームは最後
  }
  return stat.count;
}

// 「次に回ってくる人」を起点に、候補を順番に並べた配列を作る。
// teamBalance が off 以外なら、件数の少ないチームを先に持ってくる。
//
// opts:
//   teamBalance … "off" | "total" | "perHead"
//   teamStats   … teamAssignStats() の結果（チーム名→件数・人数）
//   teams       … team_rotation の行（active=false のチームは外す）
export function orderCandidates(closers, nextOrder, opts = {}) {
  const mode = opts.teamBalance || "off";
  const stats = {};
  for (const t of opts.teamStats || []) stats[t.team] = t;
  const teamActive = {};
  for (const t of opts.teams || []) teamActive[t.team_name] = t.active !== false;
  const teamPriority = {};
  for (const t of opts.teams || []) teamPriority[t.team_name] = !!t.priority;

  // 休みの人と、休止中のチームの人は外す
  const enabled = closers.filter((c) => c.active && (mode === "off" || teamActive[teamOf(c)] !== false));
  if (!enabled.length) return [];

  // 予備メンバーは通常の順番から外し、最後にまとめて足す
  const list = enabled.filter((c) => !c.fallback);
  const fallbacks = enabled.filter((c) => c.fallback).sort((a, b) => {
    // 所属チームのアポ累計が少ない側を先に試す
    const ca = (stats[teamOf(a)] || {}).count ?? 0;
    const cb = (stats[teamOf(b)] || {}).count ?? 0;
    if (ca !== cb) return ca - cb;
    return a.sort_order - b.sort_order;
  });
  // 通常メンバーが1人もいなければ、予備だけで回す
  if (!list.length) return fallbacks;

  // sort_order が nextOrder 以上の人 → その後に前半の人、で1周分の順番を作る
  const after = list.filter((c) => c.sort_order >= nextOrder);
  const before = list.filter((c) => c.sort_order < nextOrder);
  let rotated = [...after, ...before];

  if (mode !== "off") {
    // チームごとにまとめ、チームの件数が少ない順に並べ替える。
    // チーム内の順番は上のローテーション順をそのまま保つ。
    const groups = new Map();
    for (const c of rotated) {
      const t = teamOf(c);
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t).push(c);
    }
    // チーム内は、そのチームの「次の人」を先頭に回す。
    // 全体で1つのポインタだけだとチーム内で同じ人に偏るため、チームごとに持つ。
    const teamNext = {};
    for (const t of opts.teams || []) teamNext[t.team_name] = t.next_email || "";
    for (const [t, members] of groups) {
      // チーム内はローテーション順（sort_order）に整える
      members.sort((a, b) => a.sort_order - b.sort_order);
      const at = members.findIndex((m) => m.email === teamNext[t]);
      if (at > 0) groups.set(t, [...members.slice(at), ...members.slice(0, at)]);
    }
    const order = [...groups.keys()].sort((a, b) => {
      // 代打で飛ばされたチームは最優先で戻す
      if (teamPriority[a] !== teamPriority[b]) return teamPriority[a] ? -1 : 1;
      const d = teamScore(stats[a], mode) - teamScore(stats[b], mode);
      if (d !== 0) return d;
      // 同数なら、そのチームの先頭の人のローテーション順で決める（毎回同じ結果になるように）
      return rotated.indexOf(groups.get(a)[0]) - rotated.indexOf(groups.get(b)[0]);
    });
    rotated = order.flatMap((t) => groups.get(t));
  }

  // 代打で飛ばされた人（priority）は、チームより優先して先頭へ。
  // 予備メンバーはこの対象にせず、必ず最後に置く。
  const pri = rotated.filter((c) => c.priority).sort((a, b) => a.sort_order - b.sort_order);
  const rest = rotated.filter((c) => !c.priority);
  return [...pri, ...rest, ...fallbacks];
}

// 1件のアポについてクローザーを決める。
// 戻り値: { email, name, reason, skipped:[{email,name,reason}] } / 割り当て不可なら email=null
export async function pickCloser(link, { inviteOwner, closers = null, cfg = null, teamCtx = null, business = "" } = {}) {
  const conf = cfg || (await getRotationConfig());
  // その事業を担当するクローザーだけを候補にする
  const biz = String(business || link.business || "").trim();
  let all = closers || (await listClosers({ business: biz }));
  // 停止中の人は候補から外す（順番も飛ばす。復帰後に埋め合わせはしない）
  const susp = (teamCtx && teamCtx.suspended) || (await suspendedNow());
  all = all.map((c) => ({ ...c, suspended: !!susp[c.email], suspendReason: susp[c.email] || "" }))
           .filter((c) => !c.suspended);
  const ctx = teamCtx || (await loadTeamContext(conf, biz));
  const cands = orderCandidates(all, nextOrderFor(conf, biz), {
    teamBalance: conf.teamBalance, teamStats: ctx.teamStats, teams: ctx.teams,
  });
  if (!cands.length) {
    return { email: null, name: "",
      reason: biz ? `${biz}を担当するクローザーが登録されていません` : "有効なクローザーが登録されていません",
      skipped: [] };
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
        skipped.push({ email: c.email, name: c.name, team: teamOf(c), reason: `1日の上限${c.daily_cap}件に達しています` });
        continue;
      }
    }
    const chk = isSlotFree(fb, c.email, startISO, endISO, conf.bufferMin);
    if (!chk.free) {
      skipped.push({ email: c.email, name: c.name, team: teamOf(c), reason: chk.reason });
      continue;
    }
    const st = (ctx.teamStats || []).find((t) => t.team === teamOf(c));
    let why;
    if (c.fallback) {
      // 通常メンバーが全員埋まっていたので予備に回った
      why = `予備（通常メンバーが全員埋まっていたため）／${teamOf(c)}のアポ累計${st ? st.count : 0}件で最少`;
    } else {
      why = c.priority ? "前回代打で飛ばされたため最優先" : "ローテーション順";
      if (conf.teamBalance !== "off" && st) {
        if (conf.teamBalance === "perDay") {
          why += `／${st.team}が稼働1日あたり${st.perDay ?? 0}件で最少（稼働${st.personDays ?? 0}人日）`;
        } else if (conf.teamBalance === "perHead") {
          why += `／${st.team}が1人あたり${st.perHead ?? 0}件で最少`;
        } else {
          why += `／${st.team}が${st.count}件で最少`;
        }
      }
    }
    return {
      email: c.email,
      name: c.name,
      team: teamOf(c),
      business: biz,
      sortOrder: c.sort_order,
      reason: why,
      skipped,
    };
  }
  return { email: null, name: "", team: "", reason: "全員この時間帯に予定が入っています", skipped };
}

// チームの状態と件数をまとめて読む（1件ごとに何度も引かないようにキャッシュして渡す）
export async function loadTeamContext(cfg, business = "") {
  const conf = cfg || (await getRotationConfig());
  // teamBalance が off でも、予備メンバーの優先順（チームのアポ累計）に使うので常に集計する
  await syncTeamsFromClosers();
  const range = balanceRange(conf.balanceWindow, conf.fairnessStart);
  const [teams, teamStats, suspended] = await Promise.all([
    listTeams(),
    teamAssignStats(range.from, range.to, business),
    suspendedNow(),
  ]);
  return { teams, teamStats, range, business, suspended };
}

// 割り当てを確定し、ローテーションの状態を進める
export async function commitAssignment(link, pick, { actor = "auto" } = {}) {
  const cfg = await getRotationConfig();
  const biz = String(pick.business || link.business || "").trim();
  const all = await listClosers({ business: biz });
  const active = all.filter((c) => c.active).sort((a, b) => a.sort_order - b.sort_order);

  // 飛ばされた人には最優先の印を立てる
  // 予備メンバーは常に最後なので、飛ばされた印（次は最優先）は付けない
  const fallbackSet = new Set(all.filter((c) => c.fallback).map((c) => c.email));
  const skippedEmails = (pick.skipped || []).map((s) => s.email).filter((e) => !fallbackSet.has(e));
  if (skippedEmails.length) await markCloserSkipped(skippedEmails);

  // チーム単位の状態も進める。
  // 飛ばされたチームのうち、1人も割り当てられなかったチームだけ「次は優先」にする。
  if (cfg.teamBalance !== "off") {
    const assignedTeam = pick.team || "未設定";
    const skippedTeams = [...new Set((pick.skipped || []).map((s) => s.team).filter(Boolean))]
      .filter((t) => t !== assignedTeam);
    if (skippedTeams.length) await markTeamsSkipped(skippedTeams);
    await markTeamAssigned(assignedTeam);

    // そのチームの次の人へポインタを進める（チーム内で順番に回るようにする）
    const mates = all
      .filter((c) => c.active && !c.fallback && (String(c.team || "").trim() || "未設定") === assignedTeam)
      .sort((a, b) => a.sort_order - b.sort_order);
    const isFallbackPick = all.some((c) => c.email === pick.email && c.fallback);
    if (mates.length && !isFallbackPick) {
      const at = mates.findIndex((m) => m.email === pick.email);
      const nextMate = mates[(at + 1) % mates.length];
      await setTeamNext(assignedTeam, nextMate ? nextMate.email : null);
    }
  }

  // 割り当てられた人の印を外し、件数を進める
  await markCloserAssigned(pick.email);

  // 次に回ってくる人＝割り当てた人の次（予備に配ったときは通常の順番を動かさない）
  const normals = active.filter((c) => !c.fallback);
  const pickedIsFallback = all.some((c) => c.email === pick.email && c.fallback);
  let next = null;
  if (!pickedIsFallback && normals.length) {
    const idx = normals.findIndex((c) => c.email === pick.email);
    next = idx >= 0 ? normals[(idx + 1) % normals.length] : normals[0];
    await saveNextOrder(cfg, biz, next.sort_order);
  } else if (normals.length) {
    // 予備に配った場合は、通常の順番を動かさず、現在の「次の人」をそのまま返す
    const curOrder = nextOrderFor(cfg, biz);
    next = normals.find((c) => c.sort_order >= curOrder) || normals[0];
  }

  await logAssign({
    slug: link.slug,
    assigned: pick.email,
    team: pick.team || null,
    reason: (biz ? `[${biz}] ` : "") + pick.reason,
    skipped: pick.skipped || [],
    actor,
  });
  return { nextOrder: next ? next.sort_order : null, nextName: next ? next.name : "" };
}

// 次に誰に回るかを見る（GAS版の checkRotation 相当）
export async function rotationStatus(business = "") {
  const cfg = await getRotationConfig();
  const biz = String(business || "").trim();
  const all = await listClosers({ business: biz });
  // チーム表示は均等化がOFFでも見たいので、常に集計する
  await syncTeamsFromClosers();
  const range = balanceRange(cfg.balanceWindow, cfg.fairnessStart);
  const [teams, teamStats, byCloser, susp, days, suspList] = await Promise.all([
    listTeams(), teamAssignStats(range.from, range.to, biz), closerAssignStats(range.from, range.to),
    suspendedNow(), eligibleDays(range.from, range.to), listSuspensions(),
  ]);
  const cands = orderCandidates(all.filter((c) => !susp[c.email]), nextOrderFor(cfg, biz), {
    teamBalance: cfg.teamBalance, teamStats, teams,
  });
  return {
    config: cfg,
    closers: all.map((c) => {
      const d = days[c.email] || { days: 0, suspendedDays: 0 };
      const cnt = byCloser[c.email] || 0;
      return { ...c, team: teamOf(c), fallback: !!c.fallback,
        baseline_count: c.baseline_count || 0, period_count: cnt,
        suspended: !!susp[c.email], suspend_reason: susp[c.email] || "",
        eligible_days: d.days, suspended_days: d.suspendedDays,
        per_day: d.days ? +(cnt / d.days).toFixed(3) : null };
    }),
    suspensions: suspList,
    teams, teamStats,
    period: { window: cfg.balanceWindow, label: range.label || "通算", from: range.from, to: range.to },
    business: biz,
    // 実際に次に試される順番（代打の最優先を反映済み）
    order: cands.map((c) => ({
      email: c.email, name: c.name, team: teamOf(c), fallback: !!c.fallback,
      sort_order: c.sort_order, priority: c.priority,
      assigned_count: c.assigned_count, period_count: byCloser[c.email] || 0, daily_cap: c.daily_cap,
    })),
    next: cands[0] ? { email: cands[0].email, name: cands[0].name, team: teamOf(cands[0]),
                       fallback: !!cands[0].fallback, priority: cands[0].priority } : null,
  };
}

// 次を特定の人から始める（GAS版の setNextUeno 相当。誰でも指定できるようにした）
export async function setNextCloser(email, business = "") {
  const cfg = await getRotationConfig();
  const biz = String(business || "").trim();
  const all = await listClosers({ business: biz });
  const target = all.find((c) => c.email === String(email || "").toLowerCase());
  if (!target) throw new Error("そのクローザーは登録されていません");
  // 最優先フラグ（代打で飛ばされた印）は全員分クリアしてから、指定の人を起点にする
  await clearCloserPriority();
  await clearTeamPriority();
  await saveNextOrder(cfg, biz, target.sort_order);
  return rotationStatus(biz);
}
