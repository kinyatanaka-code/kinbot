// 通知（トーストが使えないときはダイアログ）
function kbNotify(msg) { if (window.kbToast) window.kbToast(msg); else alert(msg); }

// public/history.js
const hlist = document.getElementById("hlist");
const hdetail = document.getElementById("hdetail");

// 埋め込み案件iframe（プロフィール・判定）の高さを中身に合わせる（内部スクロールを無くす）
window.addEventListener("message", (e) => {
  const d = e.data;
  if (d && d.type === "kb-embed-height" && d.height) {
    const f = hdetail.querySelector(".prof-embed");
    if (f) f.style.height = Math.max(200, d.height + 8) + "px";
  }
});

const PHASES = [
  { code: "01", label: "01 初回商談" },
  { code: "02", label: "02 有効商談" },
  { code: "03", label: "03 担当者合意" },
  { code: "04", label: "04 企画決定者合意" },
];
const phaseLabel = (c) => (PHASES.find((p) => p.code === c) || {}).label || "";

let allMeetings = [];
let dealStatusByDealKey = {}; // 会社（案件と同じ正規化キー）→ 案件ステータス（実際の判定と一致させる）
// サーバーの normCompanyKey と同一の正規化（案件テーブルと突合するため）
function normDealKey(s) {
  return String(s || "")
    .replace(/株式会社|（株）|\(株\)|㈱|有限会社|（有）|\(有\)|合同会社|合資会社|一般社団法人|公益社団法人|社会福祉法人|学校法人/g, "")
    .replace(/[\s　]+/g, "")
    .replace(/様$/u, "")
    .trim()
    .toLowerCase();
}
let usersCache = null;

// 商談名から種別（コールド/過去失注）を自動判定する
function inferDealKind(title) {
  const t = String(title || "").toLowerCase();
  // 過去失注（表記ゆれに対応）
  if (/過去失注|既存失注|失注済|再アプローチ|掘り起こし|ほりおこし/.test(title || "")) return "過去失注";
  // コールド（日本語・英語・カタカナ表記に対応）
  if (/コールド|新規開拓|テレアポ|飛び込み|とびこみ/.test(title || "") || /\bcold\b/.test(t)) return "コールド";
  return "";
}

// JSTのISO ⇄ datetime-local 文字列
function isoToLocalInput(iso) {
  try {
    return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16);
  } catch {
    return "";
  }
}
function localInputToIso(v) {
  // 入力（JSTのwall-clock）を +09:00 とみなしてISO化
  const s = v.length <= 16 ? v + ":00+09:00" : v + "+09:00";
  const d = new Date(s);
  return isNaN(d.getTime()) ? "" : d.toISOString();
}
function jstToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function shiftDate(dateStr, delta) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
// カレンダー予定ピッカー（日付切替つき）
function openCalPicker(panel, onPick) {
  panel.hidden = false;
  let date = jstToday();
  const render = async () => {
    panel.innerHTML = `<div class="cal-bar"><button type="button" class="cal-nav" data-d="-1">‹</button><input type="date" class="cal-date" value="${date}"><button type="button" class="cal-nav" data-d="1">›</button></div><div class="cal-list"><div class="cal-empty">読み込み中…</div></div>`;
    const dateInput = panel.querySelector(".cal-date");
    const list = panel.querySelector(".cal-list");
    panel.querySelectorAll(".cal-nav").forEach((b) =>
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        date = shiftDate(date, Number(b.dataset.d));
        render();
      })
    );
    dateInput.addEventListener("click", (e) => e.stopPropagation());
    dateInput.addEventListener("change", () => {
      date = dateInput.value || date;
      render();
    });
    try {
      const d = await (await fetch("/api/calendar/events?date=" + encodeURIComponent(date))).json();
      if (!d.connected) {
        list.innerHTML = '<div class="cal-empty">カレンダー未連携です。「設定」から連携してください。</div>';
        return;
      }
      const events = d.events || [];
      if (!events.length) {
        list.innerHTML = d.filtered
          ? '<div class="cal-empty">条件に一致する予定はありません（設定のフィルター文字を確認）。</div>'
          : '<div class="cal-empty">この日の予定はありません。</div>';
        return;
      }
      list.innerHTML = "";
      for (const ev of events) {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "calp-row";
        const time = ev.allDay
          ? "終日"
          : new Date(ev.start).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
        row.innerHTML = `<span class="cal-time"></span><span class="cal-name"></span>${ev.url ? '<span class="cal-mark">URL</span>' : ""}`;
        row.querySelector(".cal-time").textContent = time;
        row.querySelector(".cal-name").textContent = ev.title;
        row.addEventListener("click", () => {
          onPick(ev);
          panel.hidden = true;
        });
        list.appendChild(row);
      }
    } catch {
      list.innerHTML = '<div class="cal-empty">読み込みに失敗しました。</div>';
    }
  };
  render();
}
// パネル外クリックで閉じる
document.addEventListener("click", (e) => {
  document.querySelectorAll(".cal-panel").forEach((p) => {
    if (!p.hidden && !p.contains(e.target) && !(e.target.id === "calBtnH")) p.hidden = true;
  });
});
async function loadUsers() {
  if (usersCache) return usersCache;
  try {
    usersCache = await (await fetch("/api/users")).json();
  } catch {
    usersCache = [];
  }
  return usersCache || [];
}

const fmtDate = (s) => {
  try {
    return new Date(s).toLocaleString("ja-JP", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return s || "";
  }
};
const labelOf = (sp) => (sp ? sp.name || "話者" + (sp.id ?? "") : "話者");

// 開閉式の複数選択ドロップダウン
function initMultiDropdown(group, labelText, items, onChange) {
  if (!group) return;
  group.classList.add("msel");
  group.innerHTML = `<button type="button" class="msel-btn"><span class="msel-cap">${labelText}：</span><span class="msel-sum">すべて</span><span class="msel-caret">▾</span></button><div class="msel-panel" hidden></div>`;
  const btn = group.querySelector(".msel-btn");
  const panel = group.querySelector(".msel-panel");
  const sum = group.querySelector(".msel-sum");
  for (const it of items) {
    const lab = document.createElement("label");
    lab.className = "msel-opt";
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.value = it.value;
    const span = document.createElement("span");
    span.className = "msel-optlabel";
    span.textContent = it.label;
    lab.appendChild(inp);
    lab.appendChild(span);
    panel.appendChild(lab);
  }
  const update = () => {
    const checked = [...panel.querySelectorAll("input:checked")];
    sum.textContent = checked.length
      ? items.filter((it) => checked.some((c) => c.value === it.value)).map((it) => it.label).join("・")
      : "すべて";
  };
  group._mselUpdate = update;
  panel.addEventListener("change", () => {
    update();
    onChange();
  });
  panel.addEventListener("click", (e) => e.stopPropagation());
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = panel.hidden;
    closeAllMsel();
    panel.hidden = !willOpen;
    btn.classList.toggle("open", willOpen);
  });
}
function closeAllMsel() {
  document.querySelectorAll(".msel-panel").forEach((p) => (p.hidden = true));
  document.querySelectorAll(".msel-btn.open").forEach((b) => b.classList.remove("open"));
}
document.addEventListener("click", closeAllMsel);

const HIST_CAT_OTHER = new URLSearchParams(location.search).get("cat") === "other";

// 商談カテゴリ判定（商談名のタグで自動判別）
let histCatFilter = "sales"; // "sales" | "follow" | "internal"
function meetingCategory(m) {
  const t = String(m.title || "");
  if (/【ユ[/／]フォ】|ユーザーフォロー/.test(t)) return "follow";
  if (/【社内MTG】|社内ミーティング|社内打ち合わせ/.test(t)) return "internal";
  // 既存のcategoryフィールドも確認
  if (m.category && m.category !== "商談") {
    if (/フォロー/.test(m.category)) return "follow";
    if (/社内/.test(m.category)) return "internal";
  }
  return "sales";
}

// タブ配線
document.addEventListener("DOMContentLoaded", () => {
  const tabs = document.getElementById("histCatTabs");
  if (tabs) {
    tabs.querySelectorAll(".hist-cat-tab").forEach(btn => {
      btn.addEventListener("click", () => {
        tabs.querySelectorAll(".hist-cat-tab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        histCatFilter = btn.dataset.cat;
        selectedAccount = null;
        renderList();
      });
    });
  }
});
let histMode = "account"; // 既定は会社別（企業一覧が入り口）。「すべて」で全商談フラット表示も可能
let histSelectMode = false;        // 「選択して再判定」モード
const histSelected = new Set();    // 選択中の会社（normKey）
let selectedOwner = null;          // 会社別の最初に表示する「営業担当」の選択
let selectedAccount = null;
let histAccounts = {}; // key -> {official_name,...}
function companyFromTitleH(title) {
  let t = String(title || "").trim();
  if (!t) return "(無題)";
  t = t.replace(/^[\s　・※•◆◇■□▶▷*\-–—✉⊠]+/u, "");
  t = t.replace(/[【\[［][^】\]］]*[】\]］]/gu, " ");
  t = t.replace(/[\s　/／|｜:：][^\s　/／|｜]{0,16}様(?:\s*[・,、][^\s　/／|｜]{0,16}様)*\s*$/u, "");
  t = t.replace(/[^\s　/／|｜]{0,16}様\s*$/u, "");
  t = t.replace(/\s+/g, " ").trim();
  // 会社名部分だけを抽出（日本の主要な法人形態を網羅）
  const suffix = "(?:株式会社|有限会社|合同会社|合名会社|合資会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|特定非営利活動法人|NPO法人|医療法人(?:社団|財団)?|学校法人|宗教法人|社会福祉法人|独立行政法人|生活協同組合|農業協同組合|漁業協同組合|信用金庫|信用組合)";
  const prePattern = new RegExp("(" + suffix + "[^\\s(（/／|｜:：,、]+)");
  const postPattern = new RegExp("([^\\s(（/／|｜:：,、]+" + suffix + ")");
  const preMatch = t.match(prePattern);
  const postMatch = t.match(postPattern);
  if (preMatch && postMatch) return preMatch[0].length >= postMatch[0].length ? preMatch[0] : postMatch[0];
  if (preMatch) return preMatch[0];
  if (postMatch) return postMatch[0];
  return t || String(title || "(無題)").trim();
}
const acctKey = (m) => (m.account && m.account.trim()) || companyFromTitleH(m.title) || "(無題)";
// 会社名の正規化（法人格・空白・様を除去）。「生活協同組合コープみえ」と「コープみえ」を同一視するため。
function normKey(s) {
  return String(s || "")
    .normalize("NFKC")
    // 「（山崎さん・男性）」のような補足や「/山崎様」は外して比べる
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/株式会社|（株）|\(株\)|㈱|有限会社|（有）|\(有\)|合同会社|合資会社|一般社団法人|公益社団法人|一般財団法人|公益財団法人|社会福祉法人|学校法人|医療法人社団|医療法人|税理士法人|司法書士法人|特定非営利活動法人|独立行政法人|生活協同組合|農業協同組合|漁業協同組合/g, "")
    .replace(/[\/／].*$/u, "")
    .replace(/[\s　]+/g, "")
    .replace(/(様|御中|さん)$/u, "")
    .trim()
    .toLowerCase();
}
// 正規化キー→アカウント情報（official_name・profile）のマップ
let histAccountsByNorm = {};
function rebuildAccountNormMap() {
  histAccountsByNorm = {};
  for (const k of Object.keys(histAccounts)) {
    const a = histAccounts[k];
    const n = normKey(a.official_name || k);
    if (n) histAccountsByNorm[n] = a;
  }
}
// 表示名：名寄せして、その企業の最も正式（長い）名称を返す
function acctName(key) {
  const a = histAccounts[key];
  if (a && a.official_name) return a.official_name;
  const byNorm = histAccountsByNorm[normKey(key)];
  if (byNorm && byNorm.official_name) return byNorm.official_name;
  return key;
}
// その企業の会社プロフィール（業界・従業員規模・地域）を返す
function acctProfile(key) {
  const a = histAccounts[key] || histAccountsByNorm[normKey(key)];
  return (a && a.profile) || null;
}
// 会社の案件ステータス（フェーズ表記に使用）。正規化名・正式名の両方で照合する。
function companyStatus(key) {
  return dealStatusByDealKey[normDealKey(key)] || dealStatusByDealKey[normDealKey(acctName(key))] || "";
}
// owner(メール/ID) → 表示名 の対応表。owner_nameが空の商談でも、同じ担当の他商談から名前を引く。
let ownerDisplayMap = {};
function rebuildOwnerDisplayMap() {
  ownerDisplayMap = {};
  for (const m of allMeetings) {
    const o = (m.owner || "").trim();
    const n = (m.owner_name || m.rep_name || "").trim();
    if (o && n && !ownerDisplayMap[o]) ownerDisplayMap[o] = n;
  }
}
// 商談の営業担当名を解決（owner_name→rep_name→owner対応表→owner本体）
function repNameOf(m) {
  if (!m) return "";
  const direct = (m.owner_name || m.rep_name || "").trim();
  if (direct) return direct;
  const o = (m.owner || "").trim();
  if (o) return ownerDisplayMap[o] || o;
  return "";
}
// 商談の営業担当名（グルーピング用。未設定なら「未設定」）
function ownerNameOf(m) { return repNameOf(m) || "未設定"; }

// 選択した会社の商談をまとめて再判定する
async function runHistBulkJudge(groups) {
  const targets = [...histSelected];
  if (!targets.length) return;
  const status = document.getElementById("histSelStatus");
  const runBtn = document.getElementById("histSelRun");
  if (runBtn) runBtn.disabled = true;
  let doneCos = 0, okBots = 0, failBots = 0;
  for (const nk of targets) {
    const ms = (groups && groups[nk]) || [];
    const botIds = ms.map((m) => m.bot_id).filter(Boolean);
    if (status) status.textContent = `再判定中… ${doneCos + 1}/${targets.length}社`;
    for (const bid of botIds) {
      try {
        const r = await fetch("/api/meetings/" + encodeURIComponent(bid) + "/extract", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
        });
        if (r.ok) okBots++; else failBots++;
      } catch { failBots++; }
    }
    doneCos++;
  }
  if (status) status.textContent = `完了：${doneCos}社を再判定（商談 成功${okBots}${failBots ? " / 失敗" + failBots : ""}）`;
  // フェーズ（案件ステータス）を取り直して反映
  try {
    const deals = await (await fetch("/api/deals")).json();
    dealStatusByDealKey = {};
    for (const d of deals || []) dealStatusByDealKey[normDealKey(d.company_name)] = d.status;
  } catch {}
  histSelectMode = false;
  histSelected.clear();
  setTimeout(() => renderList(), 800);
}
// cat=otherのURLパラメータは後方互換で残す（商談タブで吸収）
if (HIST_CAT_OTHER) {
  histCatFilter = "follow"; // 旧URLから来た場合はフォロータブを開く
  document.addEventListener("DOMContentLoaded", () => {
    const tabs = document.getElementById("histCatTabs");
    if (tabs) {
      tabs.querySelectorAll(".hist-cat-tab").forEach(b => {
        b.classList.toggle("active", b.dataset.cat === "follow");
      });
    }
  });
}
function isOtherCat(m) { return meetingCategory(m) !== "sales"; }
function applyHistoryFilter() {
  const owner = document.getElementById("fOwner").value.trim();
  const nameQ = (document.getElementById("fName")?.value || "").trim().toLowerCase();
  const dFrom = document.getElementById("fDateFrom")?.value || "";
  const dTo = document.getElementById("fDateTo")?.value || "";
  // 商談日（created_at）を YYYY-MM-DD（ローカル）に。範囲比較用。
  const mDate = (m) => {
    if (!m.created_at) return "";
    const d = new Date(m.created_at);
    if (isNaN(d)) return "";
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  // プロダクト以外の条件（カテゴリ・担当・検索語・期間）
  window.passesNonProductFilters = (m) => {
    if (meetingCategory(m) !== histCatFilter) return false;
    if (owner && (m.owner || "").trim() !== owner) return false;
    if (nameQ && !String(m.title || "").toLowerCase().includes(nameQ)) return false;
    if (dFrom || dTo) {
      const md = mDate(m);
      if (!md) return false;
      if (dFrom && md < dFrom) return false;
      if (dTo && md > dTo) return false;
    }
    return true;
  };
  return allMeetings.filter((m) => {
    if (!window.passesNonProductFilters(m)) return false;
    // プロダクト（DOC/MOCHICA）タブの絞り込み。実施者の所属で判定する。
    // ただし担当者が未設定の商談は振り分けようがないので、どのプロダクトでも表示する。
    const ownerForProduct = (m.owner_name || m.owner || "").trim();
    if (ownerForProduct && window.kbProduct && !window.kbProduct.matches(ownerForProduct)) return false;
    return true;
  });
}

// 商談の取得。期間が指定されていれば、その範囲を多めに取る。
async function fetchMeetings() {
  const from = document.getElementById("fDateFrom")?.value || "";
  const to = document.getElementById("fDateTo")?.value || "";
  const p = new URLSearchParams();
  if (from) p.set("from", from);
  if (to) p.set("to", to);
  // 期間を指定していないときは全期間を読み込む（一覧用の軽い形で取得する）
  p.set("limit", "3000");
  p.set("light", "1");
  const res = await fetch("/api/meetings?" + p.toString());
  return await res.json();
}

// 期間を変えたときの取り直し
async function reloadMeetings() {
  const hl = document.getElementById("hlist");
  if (hl) hl.innerHTML = '<div class="empty-state">読み込み中…</div>';
  try {
    const rows = await fetchMeetings();
    allMeetings = Array.isArray(rows) ? rows : [];
    rebuildOwnerDisplayMap();
  } catch {}
}

async function bulkSendNotion() {
  const btn = document.getElementById("bulkNotionBtn");
  const stat = document.getElementById("bulkNotionStatus");
  const rows = applyHistoryFilter().filter((m) => m.status !== "processing" && m.status !== "error");
  if (!rows.length) { if (stat) stat.textContent = "対象の商談がありません"; return; }
  const ids = rows.map((m) => m.bot_id);
  if (!confirm(`絞り込み中の ${rows.length} 件を、あなたのNotionに送信します。\n既に送信済みの商談は自動でスキップします。続けますか？`)) return;
  if (btn) { btn.disabled = true; btn.textContent = "送信中…"; }
  const setS = (label, percent) => window.kbProgress(stat, { label, percent });
  setS(`送信中… 0/${ids.length}`, 0);
  try {
    const d = await window.kinbotBulkNotion(ids, {
      onProgress: (p) => setS(`送信中… ${p.done}/${p.total}（成功${p.sent}・スキップ${p.skipped}${p.busy ? "・送信中…" : ""}）`, (p.done / p.total) * 100),
    });
    setS(`完了：成功 ${d.sent} / スキップ ${d.skipped} / 失敗 ${d.failed}` + (d.errors && d.errors.length ? `\n例: ${d.errors[0]}` : ""), 100);
  } catch (e) {
    if (stat) stat.textContent = "失敗: " + e.message;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "絞り込みをNotionに一括送信"; }
  }
}

function meetingCardEl(r) {
  const overview =
    r.status === "processing"
      ? "⏳ 文字起こし・分析を処理中…（数分後に表示されます）"
      : r.status === "error"
      ? "⚠️ 処理に失敗しました（ファイル形式やキー設定をご確認ください）"
      : r.summary && r.summary.overview
      ? r.summary.overview
      : "（要約なし）";
  const tags = [];
  if (r.round_no) tags.push(`${r.round_no}回目`);
  if (r.phase) tags.push(phaseLabel(r.phase));
  if (r.apo_setter) tags.push(`アポ獲得：${r.apo_setter}`);
  const card = document.createElement("button");
  card.className = "hcard";
  card.innerHTML = `<div class="hcard-title"></div><div class="hcard-top"><span class="hcard-date"></span><span class="hcard-rep"></span></div><div class="hcard-tags"></div><div class="hcard-ov"></div>`;
  card.querySelector(".hcard-title").textContent = r.title || "(商談名なし)";
  card.querySelector(".hcard-date").textContent = fmtDate(r.created_at);
  card.querySelector(".hcard-rep").textContent = repNameOf(r);
  card.querySelector(".hcard-tags").textContent = tags.join("　");
  card.querySelector(".hcard-ov").textContent = overview;
  card.addEventListener("click", () => {
    document.querySelectorAll(".hcard").forEach((c) => c.classList.remove("active"));
    card.classList.add("active");
    loadDetail(r.bot_id);
  });
  return card;
}

const PHASE_NAMES = { 1: "課題特定", 2: "カスタマイズデモ", 3: "顧客起点", 4: "クロージング" };
const PHASE_NEED = {
  1: "顧客が自社固有の状況（数字・「うちは/私が/今」）を具体的に話すと到達",
  2: "担当者がデモ中に顧客固有の課題・数字を使うと到達",
  3: "デモ後に顧客が『期日＋確定形（します/たい）』で次の動きを示すと到達（受注の分岐点）",
  4: "申込書を送付（または送付の明言）で到達",
};
function renderPhaseBox(box, j, botId) {
  if (!j) {
    box.innerHTML = `<div class="phase-empty">フェーズ判定はまだありません。<button class="btn ghost phase-judge" type="button">フェーズを判定する</button></div>`;
  } else {
    const cur = j.current_phase || 0;
    const steps = [1, 2, 3, 4].map((n) => {
      const reached = j[`phase${n}_reached`];
      const cls = reached ? "done" : "todo";
      const isCur = n === cur;
      return `<div class="phase-step ${cls} ${isCur ? "cur" : ""}"><span class="phase-dot">${reached ? "✓" : n}</span><span class="phase-label">${PHASE_NAMES[n]}</span></div>`;
    }).join('<span class="phase-arrow">›</span>');
    // 各フェーズの判定理由（到達=根拠の発言／未到達=何が必要か）
    const reasons = [1, 2, 3, 4].map((n) => {
      const reached = j[`phase${n}_reached`];
      const ev = j[`phase${n}_evidence`];
      if (reached) {
        return `<div class="pr-item reached"><div class="pr-h"><span class="pr-badge ok">到達</span>フェーズ${n}・${PHASE_NAMES[n]}</div>` +
          (ev ? `<div class="pr-ev">根拠：「${escapeHtmlH(ev)}」</div>` : `<div class="pr-ev pr-muted">根拠の記載なし</div>`) + `</div>`;
      }
      return `<div class="pr-item notyet"><div class="pr-h"><span class="pr-badge no">未到達</span>フェーズ${n}・${PHASE_NAMES[n]}</div>` +
        `<div class="pr-ev pr-muted">${escapeHtmlH(PHASE_NEED[n])}</div></div>`;
    }).join("");
    const next = j.next_action ? `<div class="phase-next"><b>次のアクション</b>：${escapeHtmlH(j.next_action)}</div>` : "";
    const risk = j.risk ? `<div class="phase-risk"><b>⚠ リスク</b>：${escapeHtmlH(j.risk)}</div>` : "";
    box.innerHTML =
      `<div class="phase-head"><span class="phase-badge p${cur}">現在フェーズ${cur}：${PHASE_NAMES[cur] || "-"}</span>` +
      `<button class="btn ghost phase-judge" type="button">再判定</button></div>` +
      `<div class="phase-steps">${steps}</div>${next}${risk}` +
      `<details class="phase-reasons" open><summary>判定の理由（フェーズごと）</summary><div class="pr-list">${reasons}</div></details>`;
  }
  const btn = box.querySelector(".phase-judge");
  if (btn) btn.addEventListener("click", async () => {
    btn.disabled = true; btn.textContent = "判定中…";
    try {
      const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/phase/judge`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "判定に失敗");
      renderPhaseBox(box, d, botId);
    } catch (e) {
      btn.disabled = false; btn.textContent = "再判定";
      const host = box.querySelector(".phase-empty, .phase-head");
      if (host) host.insertAdjacentHTML("beforeend", `<span class="phase-err">失敗: ${escapeHtmlH(e.message)}</span>`);
    }
  });
}
async function loadPhase(botId) {
  const box = document.getElementById("phaseBox");
  if (!box) return;
  try {
    const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/phase?auto=1`);
    const j = await r.json();
    renderPhaseBox(box, j, botId);
  } catch {
    renderPhaseBox(box, null, botId);
  }
}
function escapeHtmlH(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// SFのセッション切れ（リフレッシュトークン期限切れ等）を検知する
function isSfReauthError(msg) {
  return /expired|invalid_grant|refresh token|再認証|sfReauth/i.test(String(msg || ""));
}
// 「Salesforceに再接続」ボックスを表示（案件側と同じ、ポップアップ認証・ページ遷移なし）
function showSfReauthH(container, msg, retryFn) {
  if (!container) return;
  container.innerHTML =
    `<div class="sf-reauth-box"><div class="sf-reauth-msg">${escapeHtmlH(msg || "Salesforceのセッションが切れました")}</div>` +
    `<button class="btn sf-reauth-btn" type="button">Salesforceに再接続</button></div>`;
  const btn = container.querySelector(".sf-reauth-btn");
  if (btn) btn.addEventListener("click", () => {
    btn.textContent = "認証画面を開いています…";
    btn.disabled = true;
    const popup = window.open("/auth/salesforce?return=/auth/salesforce/done", "sf_reauth", "width=600,height=700,menubar=no,toolbar=no,location=yes");
    const check = setInterval(() => {
      if (!popup || popup.closed) {
        clearInterval(check);
        const box = btn.closest(".sf-reauth-box");
        if (box) box.innerHTML = '<div style="padding:8px;color:#0d5b47;font-size:13px;">再接続しました。もう一度お試しください。</div>';
        if (retryFn) setTimeout(retryFn, 500);
      }
    }, 500);
  });
}

function renderList() {
  const rows = applyHistoryFilter();
  hlist.innerHTML = "";
  // ツールバー（会社別／すべて）。企業を選んでハブに入っているときは出さない。
  if (!(histMode === "account" && selectedAccount)) {
    const bar = document.createElement("div");
    bar.className = "hl-toolbar";
    bar.innerHTML =
      `<div class="seg"><button class="seg-btn ${histMode === "account" ? "active" : ""}" data-mode="account">会社別</button>` +
      `<button class="seg-btn ${histMode === "all" ? "active" : ""}" data-mode="all">すべて</button></div>` +
      `<button class="btn ghost hfilter-toggle" id="filterToggle" type="button">絞り込み ▾</button>`;
    bar.querySelectorAll(".seg-btn").forEach((b) =>
      b.addEventListener("click", () => { histMode = b.dataset.mode; selectedAccount = null; selectedOwner = null; renderList(); })
    );
    // 絞り込みトグル（会社別/すべての並びに配置）
    const ft = bar.querySelector("#filterToggle");
    const hf = document.getElementById("hfilters");
    if (ft && hf) {
      const isOpen = !hf.hasAttribute("hidden");
      ft.textContent = isOpen ? "絞り込み ▴" : "絞り込み ▾";
      ft.classList.toggle("active", isOpen);
      ft.addEventListener("click", () => {
        const show = hf.hasAttribute("hidden");
        if (show) hf.removeAttribute("hidden"); else hf.setAttribute("hidden", "");
        ft.textContent = show ? "絞り込み ▴" : "絞り込み ▾";
        ft.classList.toggle("active", show);
      });
    }
    hlist.appendChild(bar);
  }

  if (!rows.length) {
    const e = document.createElement("div");
    e.className = "empty-state";
    const p = window.kbProduct && window.kbProduct.current();
    // プロダクト絞り込みが原因（全体では商談があるのに、このタブで0件）なら、その旨を出す
    const totalInView = allMeetings.filter((m) => (HIST_CAT_OTHER ? isOtherCat(m) : !isOtherCat(m))).length;
    if (p && totalInView > 0) {
      // 絞り込みを外したら何件あるのか、誰の商談なのかを出す（原因が分かるように）
      const wouldShow = allMeetings
        .filter((m) => (HIST_CAT_OTHER ? isOtherCat(m) : !isOtherCat(m)))
        .filter((m) => (window.passesNonProductFilters ? window.passesNonProductFilters(m) : true));
      const owners = [...new Set(wouldShow.map((m) => (m.owner_name || m.owner || "（担当者なし）").trim()))].slice(0, 8);
      e.innerHTML =
        `${escapeHtml(p)} のタブでは0件です。` +
        (wouldShow.length
          ? `<br><span style="font-size:12px;color:var(--muted)">「全体」なら${wouldShow.length}件あります。担当者：${escapeHtml(owners.join("、"))}<br>` +
            `この担当者が ${escapeHtml(p)} に割り当てられていないため隠れています。設定→チーム編集で割り当てるか、右上で「全体」を選んでください。</span>` +
            `<br><button type="button" class="btn ghost" id="histShowAll" style="margin-top:10px">全体で表示する</button>`
          : `<br><span style="font-size:12px;color:var(--muted)">条件（期間・担当・検索語）に合う商談がありません。</span>`);
      setTimeout(() => {
        const b = document.getElementById("histShowAll");
        if (b) b.addEventListener("click", () => {
          // 「全体」タブを押したのと同じ動きにする
          const all = document.querySelector(".prod-tab");
          if (all) { all.click(); return; }
          if (window.kbProduct && window.kbProduct.setCurrent) { window.kbProduct.setCurrent(""); location.reload(); }
        });
      }, 0);
    } else {
      e.textContent = "該当する商談がありません。";
    }
    hlist.appendChild(e);
    return;
  }

  // すべて表示：従来どおりフラット
  if (histMode === "all") {
    for (const r of rows) hlist.appendChild(meetingCardEl(r));
    return;
  }

  // 会社別：未選択なら会社カード（名寄せして1社にまとめる）
  if (!selectedAccount) {
    const groups = {};
    for (const m of rows) {
      const nk = normKey(acctKey(m));
      (groups[nk] = groups[nk] || []).push(m);
    }
    let keys = Object.keys(groups).sort((a, b) =>
      Math.max(...groups[b].map((x) => +new Date(x.created_at))) - Math.max(...groups[a].map((x) => +new Date(x.created_at)))
    );
    // 会社ごとの担当（最新商談の担当）
    const companyOwner = {};
    for (const nk of keys) {
      const ms = groups[nk].slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      companyOwner[nk] = ownerNameOf(ms[0]);
    }
    // まず営業担当ごとのカードを表示（担当未選択のとき）
    if (!selectedOwner) {
      const ownerMap = {};
      for (const nk of keys) {
        const o = companyOwner[nk];
        (ownerMap[o] = ownerMap[o] || { cos: 0, meetings: 0 });
        ownerMap[o].cos++;
        ownerMap[o].meetings += groups[nk].length;
      }
      const owners = Object.keys(ownerMap).sort((a, b) => ownerMap[b].meetings - ownerMap[a].meetings);
      // 「未設定」がある場合、文字起こしの発言者名から営業担当を設定するボタン
      if (ownerMap["未設定"]) {
        const bf = document.createElement("button");
        bf.type = "button";
        bf.className = "btn btn-ghost hist-backfill-btn";
        bf.style.cssText = "margin-bottom:12px;width:100%;";
        bf.textContent = "発言者から営業担当を設定（未設定を振り分け）";
        bf.addEventListener("click", async () => {
          if (!confirm("営業担当が未設定の商談について、文字起こしの発言者名から担当を特定して設定します。商談名は変更しません。よろしいですか？")) return;
          bf.disabled = true;
          const orig = bf.textContent;
          bf.textContent = "文字起こしから担当を判定中…";
          try {
            const r = await fetch("/api/meetings/backfill-owner", { method: "POST" });
            const d = await r.json();
            if (!r.ok) throw new Error(d.error || "失敗");
            kbNotify(d.updated ? `${d.updated}件に営業担当を設定しました。各担当の商談履歴に移動します。` : "発言者から担当を特定できる商談はありませんでした（発言者名に登録ユーザー名が含まれていない可能性があります）。");
            await loadList();
          } catch (e) {
            kbNotify("失敗しました: " + e.message);
            bf.disabled = false;
            bf.textContent = orig;
          }
        });
        hlist.appendChild(bf);
      }
      for (const o of owners) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "owner-card";
        card.innerHTML = `<span class="owner-ava"></span><span class="owner-tx"><span class="owner-name"></span><span class="owner-sub"></span></span><span class="owner-arrow">›</span>`;
        card.querySelector(".owner-ava").textContent = (o || "?").trim().charAt(0);
        card.querySelector(".owner-name").textContent = o;
        card.querySelector(".owner-sub").textContent = `${ownerMap[o].cos}社 ・ ${ownerMap[o].meetings}商談`;
        card.addEventListener("click", () => { selectedOwner = o; renderList(); });
        hlist.appendChild(card);
      }
      return;
    }
    // 担当選択済み：戻るヘッダー＋その担当の会社だけに絞る
    const ownerHead = document.createElement("div");
    ownerHead.className = "hub-head";
    ownerHead.innerHTML = `<button class="hl-backbtn" type="button">← 担当者一覧</button><div class="hub-acct"></div>`;
    keys = keys.filter((nk) => companyOwner[nk] === selectedOwner);
    ownerHead.querySelector(".hub-acct").textContent = `${selectedOwner}（${keys.length}社）`;
    ownerHead.querySelector(".hl-backbtn").addEventListener("click", () => { selectedOwner = null; renderList(); });
    hlist.appendChild(ownerHead);
    // 選択して再判定バー
    const selbar = document.createElement("div");
    selbar.className = "hist-selbar";
    if (!histSelectMode) {
      selbar.innerHTML = `<button class="btn btn-ghost" id="histSelectBtn" type="button">選択して再判定</button>`;
    } else {
      selbar.innerHTML =
        `<span class="hist-sel-count">${histSelected.size}件選択中</span>` +
        `<button class="btn btn-ghost" id="histSelAll" type="button">表示中を全選択</button>` +
        `<button class="btn btn-ghost" id="histSelClear" type="button">解除</button>` +
        `<button class="btn" id="histSelRun" type="button" ${histSelected.size ? "" : "disabled"}>まとめて再判定</button>` +
        `<button class="btn btn-ghost" id="histSelCancel" type="button">キャンセル</button>` +
        `<div class="hist-sel-status" id="histSelStatus"></div>`;
    }
    hlist.appendChild(selbar);
    const wire = (id, fn) => { const el = selbar.querySelector("#" + id); if (el) el.addEventListener("click", fn); };
    wire("histSelectBtn", () => { histSelectMode = true; histSelected.clear(); renderList(); });
    wire("histSelCancel", () => { histSelectMode = false; histSelected.clear(); renderList(); });
    wire("histSelAll", () => { keys.forEach((k) => histSelected.add(k)); renderList(); });
    wire("histSelClear", () => { histSelected.clear(); renderList(); });
    wire("histSelRun", () => runHistBulkJudge(groups));

    for (const nk of keys) {
      const ms = groups[nk];
      const last = ms.reduce((a, b) => (new Date(a.created_at) > new Date(b.created_at) ? a : b));
      const repKey = acctKey(last); // 表示・選択に使う代表キー
      const card = document.createElement("button");
      card.className = "acard";
      card.innerHTML =
        `<div class="acard-name"></div>` +
        `<div class="acard-meta"><span class="acard-count">${ms.length}件</span><span class="acard-rep"></span></div>` +
        `<div class="acard-sub"></div>`;
      card.querySelector(".acard-name").textContent = acctName(repKey);
      card.querySelector(".acard-rep").textContent = repNameOf(last);
      const st = companyStatus(repKey);
      const stCls = /受注/.test(st) ? "ok" : /失注/.test(st) ? "ng" : st ? "run" : "none";
      const stLabel = st || phaseLabel(last.phase) || "未判定";
      const sub = card.querySelector(".acard-sub");
      sub.innerHTML = `<span class="acard-phase ph-${stCls}"></span><span class="acard-last"></span>`;
      sub.querySelector(".acard-phase").textContent = stLabel;
      sub.querySelector(".acard-last").textContent = ` ・ 最終 ${fmtDate(last.created_at)}`;
      if (histSelectMode) {
        const checked = histSelected.has(nk);
        card.classList.add("selectable");
        if (checked) card.classList.add("selected");
        const chk = document.createElement("span");
        chk.className = "acard-check";
        chk.textContent = checked ? "✓" : "";
        card.insertBefore(chk, card.firstChild);
      }
      card.addEventListener("click", () => {
        if (histSelectMode) {
          if (histSelected.has(nk)) histSelected.delete(nk); else histSelected.add(nk);
          renderList();
          return;
        }
        selectedAccount = repKey; openCompanyOverview();
      });
      hlist.appendChild(card);
    }
    return;
  }

  // 選択中の会社：左に商談一覧（名寄せして全件）
  const norm = normKey(selectedAccount);
  const mine = rows.filter((m) => normKey(acctKey(m)) === norm)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const head = document.createElement("div");
  head.className = "hub-head";
  head.innerHTML =
    `<button class="hl-backbtn" type="button">← 企業一覧</button>` +
    `<div class="hub-acct"></div>`;
  head.querySelector(".hub-acct").textContent = `${acctName(selectedAccount)}（商談${mine.length}件）`;
  head.querySelector(".hl-backbtn").addEventListener("click", () => { selectedAccount = null; resetDetail(); renderList(); });
  hlist.appendChild(head);

  // 会社概要カード（常設）：商談を開いた後でもここから会社概要に戻れる
  const ovCard = document.createElement("button");
  ovCard.type = "button";
  ovCard.className = "ov-nav-card";
  ovCard.innerHTML =
    `<span class="ov-nav-ico"><svg width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="2.5" y="5" width="15" height="12" rx="1.5" fill="#0d5b47"/><rect x="6.5" y="2" width="7" height="4" rx="1" fill="#1d9e75"/><rect x="5.5" y="9" width="9" height="1.4" rx=".7" fill="#fff"/><rect x="5.5" y="12" width="6" height="1.4" rx=".7" fill="#fff"/></svg></span>` +
    `<span class="ov-nav-tx"><span class="ov-nav-t"></span><span class="ov-nav-s">プロフィール・判定・提案資料など</span></span>`;
  ovCard.querySelector(".ov-nav-t").textContent = acctName(selectedAccount);
  ovCard.addEventListener("click", () => renderCompanyOverview());
  hlist.appendChild(ovCard);

  for (const r of mine) hlist.appendChild(meetingCardEl(r));
}

// 企業を選んだときの入口：一覧を描き、右に会社概要（プロフィール＋3カード）を出す
function openCompanyOverview() {
  renderList();
  renderCompanyOverview();
}

// 会社概要：企業名 → 会社プロフィール（gBiz＋URL取得）→ 判定・御礼メール・SF更新 → 提案資料
// 社内にあるこの会社の資料（スライド・PDF・ドキュメント）を探して並べる
async function loadCompanyFiles(company) {
  const box = hdetail.querySelector("#ovFiles");
  if (!box) return;
  const body = () => box.querySelector(".ov-files-body") || box;
  try {
    const r = await fetch("/api/drive/company-files?company=" + encodeURIComponent(company));
    const d = await r.json();
    const files = d.files || [];
    const head = `<div class="ov-c-h">社内にあるこの会社の資料<span class="ov-files-note">Googleドライブから検索</span></div>`;
    if (d.error) {
      box.innerHTML = head + `<div class="ov-muted">${escapeHtml(d.error)}</div>`;
      return;
    }
    box.innerHTML = head + (files.length
      ? `<div class="ov-files">` + files.map((f) => `
          <a class="ov-file" href="${escapeHtml(f.link)}" target="_blank" rel="noopener">
            <span class="ov-file-kind ${f.kind === "スライド" ? "is-slide" : f.kind === "PDF" ? "is-pdf" : "is-doc"}">${escapeHtml(f.kind)}</span>
            <span class="ov-file-name">${escapeHtml(f.name)}</span>
            <span class="ov-file-meta">${escapeHtml(f.modified)}${f.owner ? " ・ " + escapeHtml(f.owner) : ""}</span>
          </a>`).join("") + `</div>`
      : `<div class="ov-muted">見つかりませんでした。社内共有されていない資料は表示されません。</div>`);
  } catch (e) {
    box.innerHTML = `<div class="ov-c-h">社内にあるこの会社の資料</div><div class="ov-muted">検索に失敗しました。</div>`;
  }
}

function renderCompanyOverview() {
  const norm = normKey(selectedAccount);
  const mine = allMeetings
    .filter((m) => (HIST_CAT_OTHER ? isOtherCat(m) : !isOtherCat(m)))
    .filter((m) => normKey(acctKey(m)) === norm)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const latest = mine[0];
  const name = acctName(selectedAccount);
  const enc = encodeURIComponent(name);

  // 相手の懸念：各商談の要約から集約
  const concerns = [];
  for (const m of mine) {
    const c = m.summary && m.summary.customer_concerns;
    if (Array.isArray(c)) for (const x of c) if (x && !concerns.includes(x)) concerns.push(x);
  }
  const concernInner = concerns.length
    ? `<ul class="ov-list">${concerns.slice(0, 6).map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>`
    : `<div class="ov-muted">記録された懸念はありません。</div>`;

  const qcard = (act, title, sub, svg, wide) =>
    `<button type="button" class="ov-qcard${wide ? " ov-qcard-wide" : ""}" data-act="${act}">
       <span class="ov-q-ico">${svg}</span>
       <span class="ov-q-tx"><span class="ov-q-t">${escapeHtml(title)}</span><span class="ov-q-s">${escapeHtml(sub)}</span></span>
       <span class="ov-q-arrow">→</span>
     </button>`;
  const icoJudge = `<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="2" y="8" width="4" height="9" rx="1" fill="#0d5b47"/><rect x="8" y="4" width="4" height="13" rx="1" fill="#1d9e75"/><rect x="14" y="1" width="4" height="16" rx="1" fill="#5DCAA5"/></svg>`;
  const icoMail = `<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="2.5" y="4.5" width="15" height="11" rx="2" stroke="#0d5b47" stroke-width="1.4"/><path d="M3.5 6l6.5 4.5L16.5 6" stroke="#1d9e75" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const icoSf = `<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M4 8a6 6 0 0 1 10-2.5M16 12a6 6 0 0 1-10 2.5" stroke="#0d5b47" stroke-width="1.4" stroke-linecap="round"/><path d="M14 3v2.8h-2.8M6 17v-2.8h2.8" stroke="#1d9e75" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const icoProp = `<svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M4 2h8l4 4v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" fill="#1d9e75"/><path d="M12 2v4h4" fill="#5DCAA5"/></svg>`;

  hdetail.innerHTML =
    `<div class="ov-wrap">
       <button class="m-back" type="button">← 商談一覧へ戻る</button>
       <div class="ov-name">${escapeHtml(name)}</div>
       <iframe class="prof-embed" src="deals.html?company=${enc}&embed=1&view=profile" title="会社プロフィール"></iframe>
       <div class="ov-actions">
         ${qcard("judge", "判定", "進捗・ステージ判定", icoJudge)}
         ${qcard("mail", "御礼メール", "直近から返信を作る", icoMail)}
         ${qcard("sf", "SF更新", "直近をSFに反映", icoSf)}
       </div>
       ${qcard("proposals", "提案資料", "登録・確認", icoProp, true)}
       <div class="ov-grid" style="margin-top:12px;">
         <div class="ov-c" id="ovTodo"><div class="ov-c-h">ネクストアクション（やること）</div><div class="ov-muted">読み込み中…</div></div>
         <div class="ov-c"><div class="ov-c-h">相手の懸念</div>${concernInner}</div>
       </div>
       <div class="ov-c" id="ovFiles" style="margin-top:12px;">
         <div class="ov-c-h">社内にあるこの会社の資料<span class="ov-files-note">Googleドライブから検索</span></div>
         <div class="ov-muted">探しています…</div>
       </div>
     </div>`;

  loadCompanyFiles(name);

  hdetail.querySelectorAll(".ov-qcard").forEach((b) =>
    b.addEventListener("click", () => {
      const act = b.dataset.act;
      if (act === "judge") { showSubEmbed("judge", "進捗・判定"); return; }
      if (act === "proposals") { showSubEmbed("proposals", "提案資料"); return; }
      if (act === "sf") { showSubEmbed("salesforce", "SF更新"); return; }
      if (!latest) { kbNotify("この企業の商談がまだありません。"); return; }
      loadDetail(latest.bot_id, "thanks", { focus: true });
    })
  );

  // スマホでは一覧と詳細を切り替えて表示するので、詳細側に切り替える
  showDetailPane();

  // ネクストアクション（やること）を案件APIから非同期で埋める
  loadOvTodos(name);
}

// スマホ：詳細ペイン（会社概要・商談詳細）を表示する。「戻る」で一覧に戻す。
function showDetailPane() {
  const histWrap = document.querySelector(".history");
  if (!histWrap) return;
  histWrap.classList.add("m-detail");
  if (!showDetailPane._wired) {
    showDetailPane._wired = true;
    hdetail.addEventListener("click", (e) => {
      if (e.target.closest(".m-back")) histWrap.classList.remove("m-detail");
    });
  }
  hdetail.scrollTop = 0;
  if (window.kbIsMobile && window.kbIsMobile() && window.scrollTo) window.scrollTo({ top: 0, behavior: "smooth" });
}

// 会社ページ内に、案件の1機能だけをiframeで表示する（判定など）
function showSubEmbed(view, label) {
  const enc = encodeURIComponent(acctName(selectedAccount));
  const loseParam = (view === "salesforce" && window._kbSfLose) ? "&sf=lose" : "";
  // ホームで選んだSF商談があれば、そのまま紐づけて開く
  const oppParam = (view === "salesforce" && window._kbSfOppId) ? "&opp=" + encodeURIComponent(window._kbSfOppId) : "";
  hdetail.innerHTML =
    `<div class="ov-subpage">
       <button type="button" class="ov-subback">← 会社概要へ戻る</button>
       <button class="m-back" type="button">← 商談一覧へ戻る</button>
       <div class="ov-subtitle">${escapeHtml(label || "")}</div>
       <iframe class="prof-embed" src="deals.html?company=${enc}&embed=1&view=${encodeURIComponent(view)}${loseParam}${oppParam}" title="${escapeHtml(label || "")}"></iframe>
     </div>`;
  hdetail.querySelector(".ov-subback").addEventListener("click", () => { window._kbSfLose = false; renderCompanyOverview(); });
  showDetailPane();
}

// やることカード：AI抽出＋手動の宿題
async function loadOvTodos(company) {
  const el = document.getElementById("ovTodo");
  if (!el) return;
  try {
    const d = await (await fetch("/api/action-items?account=" + encodeURIComponent(company))).json();
    const items = (d && d.items) || [];
    const open = items.filter((it) => !it.done);
    el.innerHTML =
      `<div class="ov-c-h">ネクストアクション（やること）</div>` +
      (open.length
        ? `<ul class="ov-list">${open.slice(0, 6).map((it) => `<li>${escapeHtml(it.text)}${it.due ? `<span class="ov-due"> 〜${escapeHtml(String(it.due).slice(0, 10))}</span>` : ""}</li>`).join("")}</ul>`
        : `<div class="ov-muted">未完了のやることはありません。</div>`);
  } catch {
    el.innerHTML = `<div class="ov-c-h">ネクストアクション（やること）</div><div class="ov-muted">取得できませんでした。</div>`;
  }
}

// 詳細ペインを初期状態に戻す
function resetDetail() {
  hdetail.innerHTML = `<div class="empty-state empty-bot"><img src="kinbot.svg" alt="kinbot" /><div>左の一覧から商談を選ぶと、録画・文字起こし・要約・分析を表示します。</div></div>`;
}

async function loadList() {
  // 商談名・商談日の検索欄を配線（入力のたびに一覧を絞り込む）
  const fName = document.getElementById("fName");
  if (fName && !fName._wired) {
    fName._wired = true;
    let t;
    fName.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { selectedAccount = null; renderList(); }, 200); });
  }
  ["fDateFrom", "fDateTo"].forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el._wired) {
      el._wired = true;
      // 期間を変えたら、その範囲の商談をサーバーから取り直す（古い商談は初期表示に含まれていないため）
      el.addEventListener("change", async () => { selectedAccount = null; await reloadMeetings(); renderList(); });
    }
  });
  const fClear = document.getElementById("fClear");
  if (fClear && !fClear._wired) {
    fClear._wired = true;
    fClear.addEventListener("click", () => {
      if (fName) fName.value = "";
      ["fDateFrom", "fDateTo"].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
      const fo = document.getElementById("fOwner"); if (fo) fo.value = "";
      selectedAccount = null; renderList();
    });
  }
  try {
    const rows = await fetchMeetings();
    allMeetings = Array.isArray(rows) ? rows : [];
    rebuildOwnerDisplayMap();
    if (allMeetings.length === 0) {
      hlist.innerHTML =
        '<div class="empty-state">まだ履歴がありません。商談を1件記録すると、ここに並びます。<br><small>（履歴の保存には DATABASE_URL の設定が必要です）</small></div>';
      return;
    }
    // 営業担当（所有者）選択肢。
    // 人数が増えると探しにくいので、商談の多い人を上に出し、件数も添える。
    const fOwner = document.getElementById("fOwner");
    const seen = new Map();
    for (const m of allMeetings) {
      const owner = (m.owner || "").trim();
      if (!owner) continue;
      const label = (m.owner_name || "").trim() || owner;
      const cur = seen.get(owner) || { label, n: 0 };
      cur.n++;
      seen.set(owner, cur);
    }
    const owners = [...seen.entries()].sort((a, b) => b[1].n - a[1].n);
    for (const [owner, info] of owners) {
      const o = document.createElement("option");
      o.value = owner;
      o.textContent = `${info.label}（${info.n}件）`;
      fOwner.appendChild(o);
    }
    fOwner.addEventListener("change", () => { selectedAccount = null; renderList(); });
    const bulkBtn = document.getElementById("bulkNotionBtn");
    if (bulkBtn && !bulkBtn._wired) { bulkBtn._wired = true; bulkBtn.addEventListener("click", bulkSendNotion); }
    try {
      const accs = await (await fetch("/api/accounts")).json();
      histAccounts = {};
      for (const a of accs || []) histAccounts[a.key] = a;
      rebuildAccountNormMap();
    } catch {}
    try {
      const deals = await (await fetch("/api/deals")).json();
      dealStatusByDealKey = {};
      for (const d of deals || []) dealStatusByDealKey[normDealKey(d.company_name)] = d.status;
    } catch {}
    renderList();
    // 案件などから ?m=商談ID で来たら、その会社を開いて該当商談を表示
    const params = new URLSearchParams(location.search);
    const wantId = params.get("m");
    const want = wantId && allMeetings.find((x) => x.bot_id === wantId);
    if (want) {
      histMode = "account";
      selectedAccount = acctKey(want);
      renderList();
      loadDetail(wantId);
    }
    // ホームから ?company=会社名（&sf=lose）で来たら、その会社の概要を開く
    const wantCompany = params.get("company");
    if (wantCompany) {
      histMode = "account";
      const nk = normKey(wantCompany);
      // allMeetingsから一致する会社キーを探す
      let key = null;
      for (const m of allMeetings) { if (normKey(acctKey(m)) === nk) { key = acctKey(m); break; } }
      selectedAccount = key || wantCompany;
      renderList();
      renderCompanyOverview();
      const sfParam = params.get("sf");
      if (sfParam === "lose" || sfParam === "update") {
        window._kbSfLose = sfParam === "lose";
        window._kbSfOppId = params.get("opp") || "";
        showSubEmbed("salesforce", "SF更新");
      }
    }
  } catch (e) {
    hlist.innerHTML = '<div class="empty-state">読み込みに失敗しました。</div>';
  }
}

async function loadDetail(botId, openTab, opts = {}) {
  showDetailPane();
  hdetail.innerHTML = '<div class="empty-state">読み込み中…</div>';
  hdetail.scrollTop = 0;
  try {
    const res = await fetch(`/api/meetings/${encodeURIComponent(botId)}`);
    const m = await res.json();
    let s = m.summary || {};
    const sug = Array.isArray(m.suggestions) ? m.suggestions : [];
    const tr = Array.isArray(m.transcript) ? m.transcript : [];

    hdetail.innerHTML = `
      <button class="m-back" type="button">← 一覧へ戻る</button>
      <div class="drec" id="drec"></div>
      <div class="dhead">
        <div class="dtitle-wrap">
          <input class="dtitle-input" id="mTitle" placeholder="商談名" />
          <button type="button" id="calBtnH" class="cal-btn" title="カレンダーから選ぶ">📅</button>
          <div class="cal-panel" id="calPanelH" hidden></div>
        </div>
        <div class="dactions">
          <button class="btn ghost" id="transcribeBtn" title="録画・音声から文字起こしを作ります（文字起こしが無いときに使います）">文字起こしを作る</button>
          <button class="btn" id="genBtn">要約・FB生成</button>
          <button class="btn" id="deepBtn">分析を生成</button>
          <button class="btn" id="notionBtn">Notionに送る</button>
          <button class="btn danger" id="delBtn">削除</button>
        </div>
      </div>
      <div class="dmeta-edit">
        <label>営業担当 <select id="mOwner"><option value="">未設定</option></select></label>
        <label>日時 <input type="datetime-local" id="mDatetime" /></label>
        <label>何回目<span class="hint">（商談回数）</span> <input type="number" id="mRound" min="1" max="99" placeholder="-" /></label>
        <label>種別 <select id="mDealKind">
          <option value="">通常</option>
          <option value="コールド">コールド</option>
          <option value="過去失注">過去失注</option>
        </select></label>
        <label>区分 <select id="mCategory">
          <option value="商談">商談</option>
          <option value="社内MTG">社内MTG</option>
          <option value="ユーザーフォロー">ユーザーフォロー</option>
          <option value="その他">その他</option>
        </select></label>
        <span class="dmeta-saved" id="mSaved" hidden>保存しました</span>
      </div>
      <div class="tabs">
        <button class="tab active" data-tab="trans">文字起こし</button>
        <button class="tab" data-tab="summary">要約</button>
        <button class="tab" data-tab="ailog">AI提案ログ</button>
        <button class="tab" data-tab="fb">FB & 分析</button>
        <button class="tab" data-tab="thanks">御礼メール</button>
        <button class="tab" data-tab="sf">SF連携</button>
      </div>
      <div class="tabwrap">
        <div class="tabpane" data-pane="trans">
          <div class="pane-bar"><button class="btn ghost copy-mini" id="copyTrans">コピー</button></div>
          <div id="dtrans" class="pane-content"></div>
        </div>
        <div class="tabpane" data-pane="summary" hidden>
          <div class="pane-bar"><button class="btn ghost" id="customRunBtn" hidden>再実行</button><button class="btn ghost copy-mini" id="copySummary">コピー</button></div>
          <div id="dcustom" class="pane-content" hidden></div>
          <div id="dsummary" class="pane-content"></div>
          <div id="dnoteWrap"></div>
        </div>
        <div class="tabpane" data-pane="ailog" hidden>
          <div class="ai-feed" id="dailog"></div>
        </div>
        <div class="tabpane" data-pane="fb" hidden>
          <div class="pane-bar"><button class="btn ghost copy-mini" id="copyFb">コピー</button></div>
          <div class="pane-content" id="dfbwrap">
            <h3>営業フィードバック</h3>
            <div id="dfeedback"></div>
            <h3>客観指標（自動計算）</h3>
            <div id="dmetrics"></div>
            <h3>AIによる評価</h3>
            <div id="dai"></div>
            <h3>次の一手（記録）</h3>
            <div id="dmoves"></div>
          </div>
        </div>
        <div class="tabpane" data-pane="thanks" hidden>
          <div class="gmail-box">
            <div class="gmail-title">Gmailの過去のやり取りから返信を作る</div>
            <div class="gm-searchrow">
              <input id="gmQuery" type="text" placeholder="会社名・担当者名・メールアドレスで検索" />
              <button class="btn btn-ghost" id="gmFetchBtn">取得</button>
            </div>
            <div id="gmChips" class="gm-chips"></div>
            <span class="thanks-note" id="gmNote"></span>
            <div id="gmThreads"></div>
            <div class="gmail-to" id="gmToWrap" hidden>
              <label class="thanks-field"><span>宛先</span><input id="gmTo" type="email" placeholder="送信先メールアドレス" /></label>
              <button class="btn" id="gmDraftBtn">Gmailに下書きを保存</button>
              <span class="thanks-note" id="gmSendNote"></span>
            </div>
          </div>
          <div class="pane-bar">
            <button class="btn" id="thanksGen">御礼メールを生成</button>
            <span class="thanks-note" id="thanksNote"></span>
            <button class="btn ghost copy-mini" id="copyThanks">コピー</button>
          </div>
          <div class="thanks-wrap">
            <label class="thanks-field"><span>件名</span><input id="thanksSubject" type="text" placeholder="生成すると入ります" /></label>
            <label class="thanks-field"><span>本文</span><textarea id="thanksBody" rows="16" placeholder="「御礼メールを生成」を押すと、この商談（何回目か）に合わせて作成します。"></textarea></label>
          </div>
        </div>
        <div class="tabpane" data-pane="sf" hidden>
          <div class="thanks-wrap">
            <div id="sfStats" class="sf-stats" hidden></div>
            <label class="sf-auto-toggle"><input type="checkbox" id="sfAutoReflect" /><span>商談の確定時に、自動でSalesforceへ反映する</span></label>
            <div class="pane-bar" style="justify-content:flex-start; gap:8px; align-items:center">
              <button class="btn btn-ghost" id="sfSearchBtn">Salesforceの商談を探す</button>
              <span class="thanks-note" id="sfSearchNote"></span>
            </div>
            <div id="sfCandidates"></div>
            <label class="thanks-field" style="margin-top:6px"><span>Salesforce 商談リンク（自動で入ります。手入力も可）</span><input id="sfUrl" type="url" placeholder="https://...lightning.force.com/lightning/r/Opportunity/.../view" /></label>
            <div class="pane-bar" style="justify-content:flex-start; gap:8px; align-items:center">
              <button class="btn" id="sfAutoBtn">Salesforceに反映</button>
              <span class="thanks-note" id="sfAutoNote">空いている項目だけを埋め、活動履歴を1件残します（入力済みの欄は変更しません）。</span>
            </div>
            <div id="sfAutoResult"></div>
            <details class="sf-manual">
              <summary>項目を1つずつ確認して更新する</summary>
              <div class="pane-bar" style="justify-content:flex-start; gap:8px">
                <button class="btn" id="sfFetchBtn">更新候補を取得</button>
                <span class="thanks-note" id="sfNote"></span>
              </div>
              <div id="sfRows"></div>
              <div class="pane-bar" style="justify-content:flex-start">
                <button class="btn" id="sfPushBtn" hidden>Salesforceに更新</button>
              </div>
            </details>
          </div>
        </div>
      </div>`;

    // タブ切替
    // 要約タブ：カスタムプロンプトが設定されていれば、標準要約の代わりにその出力を表示する
    const dcustom = hdetail.querySelector("#dcustom");
    const dsummaryEl = hdetail.querySelector("#dsummary");
    const customRunBtn = hdetail.querySelector("#customRunBtn");
    let customLoaded = false;
    let customMode = false; // カスタムプロンプトが設定されているか
    async function loadCustom(regen) {
      if (!dcustom) return;
      customLoaded = true;
      dcustom.hidden = false;
      if (dsummaryEl) dsummaryEl.hidden = true;
      window.kbProgress(dcustom, { percent: null, label: regen ? "設定したプロンプトで分析しています…（数十秒かかります）" : "分析結果を読み込んでいます…" });
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/custom-analysis`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ regen: !!regen }),
        });
        const data = await r.json();
        window.kbProgress(dcustom, { clear: true });
        if (!r.ok) { dcustom.innerHTML = `<div class="empty-state">${escapeHtml(data.error || "実行に失敗しました")}</div>`; return; }
        const t = (data.result || "").trim();
        dcustom.innerHTML = t ? `<div class="custom-out">${escapeHtml(t)}</div>` : '<div class="empty-state">結果がありません。「再実行」を押してください。</div>';
      } catch (e) {
        window.kbProgress(dcustom, { clear: true });
        dcustom.innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`;
      }
    }
    // カスタムプロンプトの有無を確認し、あれば要約タブをカスタム出力に切り替える
    (async () => {
      try {
        const d = await (await fetch("/api/custom-prompt")).json();
        customMode = !!(d.prompt && d.prompt.trim());
      } catch {}
      if (customMode) {
        if (customRunBtn) customRunBtn.hidden = false;
        // 要約タブが最初から開いている場合に備えて即読み込み
        const summaryPane = hdetail.querySelector('.tabpane[data-pane="summary"]');
        if (summaryPane && !summaryPane.hidden && !customLoaded) loadCustom(false);
      }
    })();
    if (customRunBtn) customRunBtn.addEventListener("click", () => loadCustom(true));

    hdetail.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        hdetail.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
        const name = tab.dataset.tab;
        hdetail.querySelectorAll(".tabpane").forEach((p) => (p.hidden = p.dataset.pane !== name));
        if (name === "summary" && customMode && !customLoaded) loadCustom(false);
        // SF連携タブ：統計を読み込み、リンク未入力なら会社名から自動で商談を探す
        if (name === "sf") {
          loadSfStats();
          if (!sfSearched && !(sfUrl.value || "").trim()) runSfSearch();
        }
      });
    });

    // 会社概要の「御礼メール」「SF更新」カードから来たときは、そのタブを開く
    if (openTab) {
      const tb = hdetail.querySelector(`.tab[data-tab="${openTab}"]`);
      if (tb) tb.click();
    }
    // フォーカス表示：その機能だけを見せる（録画・ヘッダー・メタ・タブを隠し、会社概要へ戻る）
    if (opts.focus) {
      ["#drec", ".dhead", ".dmeta-edit", ".tabs", ".m-back"].forEach((sel) => {
        const el = hdetail.querySelector(sel);
        if (el) el.style.display = "none";
      });
      const back = document.createElement("button");
      back.type = "button";
      back.className = "ov-subback";
      back.textContent = "← 会社概要へ戻る";
      back.addEventListener("click", () => renderCompanyOverview());
      hdetail.insertBefore(back, hdetail.firstChild);
    }

    // コピー（各タブの内容をプレーンテキストで）
    const copyText = async (text, btn) => {
      const done = () => {
        const o = btn.textContent;
        btn.textContent = "コピーしました";
        setTimeout(() => (btn.textContent = o), 1500);
      };
      try {
        await navigator.clipboard.writeText(text);
        done();
      } catch {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        done();
      }
    };
    hdetail.querySelector("#copyTrans").addEventListener("click", (e) =>
      copyText(hdetail.querySelector("#dtrans").innerText, e.currentTarget)
    );
    hdetail.querySelector("#copySummary").addEventListener("click", (e) =>
      copyText(customMode ? hdetail.querySelector("#dcustom").innerText : summaryToText(s), e.currentTarget)
    );
    hdetail.querySelector("#copyFb").addEventListener("click", (e) =>
      copyText(hdetail.querySelector("#dfbwrap").innerText, e.currentTarget)
    );
    // 御礼メール生成
    const thanksGen = hdetail.querySelector("#thanksGen");
    const thanksSubject = hdetail.querySelector("#thanksSubject");
    const thanksBody = hdetail.querySelector("#thanksBody");
    const thanksNote = hdetail.querySelector("#thanksNote");
    thanksGen.addEventListener("click", async () => {
      thanksGen.disabled = true;
      const o = thanksGen.textContent;
      thanksGen.textContent = "生成中…";
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/thanks`, { method: "POST" });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "生成に失敗しました");
        thanksSubject.value = d.subject || "";
        thanksBody.value = d.body || "";
        thanksNote.textContent = `${d.round || "?"}回目${d.exampleCount ? `・例文${d.exampleCount}件を参照` : "・例文なし"}`;
      } catch (e) {
        kbNotify("生成に失敗しました: " + e.message);
      } finally {
        thanksGen.disabled = false;
        thanksGen.textContent = o;
      }
    });
    hdetail.querySelector("#copyThanks").addEventListener("click", (e) => {
      const text = (thanksSubject.value ? "件名：" + thanksSubject.value + "\n\n" : "") + thanksBody.value;
      copyText(text, e.currentTarget);
    });

    // Gmail連携：過去のやり取り取得 → 返信作成 → 送信
    const gmFetchBtn = hdetail.querySelector("#gmFetchBtn");
    const gmQuery = hdetail.querySelector("#gmQuery");
    const gmChips = hdetail.querySelector("#gmChips");
    const gmNote = hdetail.querySelector("#gmNote");
    const gmThreads = hdetail.querySelector("#gmThreads");
    const gmToWrap = hdetail.querySelector("#gmToWrap");
    const gmTo = hdetail.querySelector("#gmTo");
    const gmSendBtn = hdetail.querySelector("#gmDraftBtn");
    const gmSendNote = hdetail.querySelector("#gmSendNote");
    let gmReply = null; // {threadId, inReplyTo, references}

    // 検索候補（会社名・担当者名）を組み立てる
    const gmCandidates = (() => {
      const out = [];
      const push = (v) => { const s = (v || "").trim(); if (s && !out.includes(s)) out.push(s); };
      push(acctKey(m)); // 会社名
      // タイトル内の「〜様」を担当者名として拾う（例：コープみえ/奥中様 → 奥中）
      const title = String(m.title || "");
      const re = /([^\s　/／|｜:：,、【】\[\]]{1,12}?)\s*様/gu;
      let mm;
      while ((mm = re.exec(title))) push(mm[1]);
      // 文字起こしの話者名（自分以外）も候補に
      const rep = m.owner_name || m.rep_name || "";
      if (Array.isArray(m.transcript)) {
        [...new Set(m.transcript.map((u) => u.speaker && u.speaker.name).filter(Boolean))]
          .filter((n) => n && n !== rep)
          .forEach(push);
      }
      return out.slice(0, 6);
    })();
    gmQuery.value = gmCandidates[0] || "";
    // 候補チップを描画
    gmChips.innerHTML = "";
    gmCandidates.forEach((c) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "gm-chip";
      chip.textContent = c;
      chip.addEventListener("click", () => { gmQuery.value = c; runGmFetch(); });
      gmChips.appendChild(chip);
    });

    async function runGmFetch() {
      const q = (gmQuery.value || "").trim();
      if (!q) { gmNote.textContent = "検索する会社名や担当者名を入力してください。"; return; }
      gmFetchBtn.disabled = true;
      const o = gmFetchBtn.textContent;
      gmFetchBtn.textContent = "取得中…";
      gmThreads.innerHTML = "";
      gmNote.textContent = "";
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/gmail-threads?q=${encodeURIComponent(q)}`);
        const d = await r.json();
        if (d.reason === "未連携") { gmNote.textContent = "Google未連携です。設定→外部連携から連携してください。"; return; }
        if (d.needScope) {
          if (d.gmailReason === "api_disabled") {
            gmNote.innerHTML = "Google Cloud で「Gmail API」が有効化されていません。<br>管理者がGoogle Cloud Console → APIとサービス → ライブラリ →「Gmail API」を有効化してください。有効化後、数分待ってから再度お試しください。";
          } else if (d.gmailReason === "no_scope") {
            gmNote.textContent = "Gmailの権限が付与されていません。設定→外部連携でGoogleを一度「連携解除」してから、再連携してください（同意画面でGmailの項目にチェックが必要です）。";
          } else if (d.gmailReason === "no_token") {
            gmNote.textContent = "Google未連携です。設定→外部連携から連携してください。";
          } else {
            gmNote.textContent = "Gmailに接続できませんでした。設定→外部連携でGoogleを再連携してください。" + (d.gmailDetail ? "（詳細: " + d.gmailDetail.slice(0, 120) + "）" : "");
          }
          return;
        }
        if (!r.ok) throw new Error(d.error || "取得に失敗しました");
        const th = d.threads || [];
        if (!th.length) {
          const others = gmCandidates.filter((c) => c !== q);
          gmNote.textContent = `「${q}」では過去のメールが見つかりませんでした。` +
            (others.length ? ` 担当者名（${others.join("・")}）やメールアドレスでも試してみてください。` : " 別のキーワードで試してみてください。");
          return;
        }
        gmNote.textContent = `${th.length}件のやり取りが見つかりました。返信したいものを選んでください。`;
        th.forEach((t) => {
          const el = document.createElement("div");
          el.className = "gm-thread";
          el.innerHTML =
            `<div class="gm-thread-top"><span class="gm-from">${escapeHtml(t.from || "")}</span><span class="gm-date">${escapeHtml((t.date || "").slice(0, 25))}</span></div>` +
            `<div class="gm-subj">${escapeHtml(t.subject || "(件名なし)")}</div>` +
            `<div class="gm-snip">${escapeHtml(t.snippet || "")}</div>` +
            `<div class="gm-act">` +
              `<button type="button" class="btn btn-ghost gm-reply-btn">この相手への返信を作成</button>` +
              `<button type="button" class="btn btn-ghost gm-arch-btn">アーカイブ</button>` +
              `<button type="button" class="btn btn-ghost gm-trash-btn">ゴミ箱へ</button>` +
            `</div>`;

          // アーカイブ / ゴミ箱。どちらもGmail側で元に戻せるので、取り消しボタンを出す。
          const runAct = async (btn, action, confirmMsg) => {
            if (confirmMsg && !confirm(confirmMsg)) return;
            btn.disabled = true;
            const bo = btn.textContent;
            btn.textContent = "処理中…";
            try {
              const rr = await fetch(`/api/gmail/threads/${encodeURIComponent(t.threadId)}/${action}`, {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ subject: t.subject || "", from: t.from || "" }),
              });
              const dd = await rr.json();
              if (!rr.ok) throw new Error(dd.error || "操作に失敗しました");
              el.classList.add("gm-done");
              const undo = action === "archive" ? "unarchive" : "untrash";
              const doneLabel = action === "archive" ? "アーカイブしました" : "ゴミ箱に移動しました";
              const act = el.querySelector(".gm-act");
              act.innerHTML = `<span class="gm-done-msg">${doneLabel}</span>`;
              const ub = document.createElement("button");
              ub.type = "button";
              ub.className = "btn btn-ghost";
              ub.textContent = "取り消す";
              ub.addEventListener("click", async () => {
                ub.disabled = true; ub.textContent = "戻しています…";
                try {
                  const r2 = await fetch(`/api/gmail/threads/${encodeURIComponent(t.threadId)}/${undo}`, {
                    method: "POST", headers: { "content-type": "application/json" },
                    body: JSON.stringify({ subject: t.subject || "", from: t.from || "" }),
                  });
                  const d2 = await r2.json();
                  if (!r2.ok) throw new Error(d2.error || "元に戻せませんでした");
                  el.classList.remove("gm-done");
                  act.innerHTML = `<span class="gm-done-msg">元に戻しました</span>`;
                } catch (e2) { alert("元に戻せませんでした: " + e2.message); ub.disabled = false; ub.textContent = "取り消す"; }
              });
              act.appendChild(ub);
            } catch (e) {
              alert("操作に失敗しました: " + e.message);
              btn.disabled = false; btn.textContent = bo;
            }
          };
          el.querySelector(".gm-arch-btn").addEventListener("click", (ev) =>
            runAct(ev.currentTarget, "archive", null));
          el.querySelector(".gm-trash-btn").addEventListener("click", (ev) =>
            runAct(ev.currentTarget, "trash",
              `このやり取りをGmailのゴミ箱に移動します。\n\n件名: ${t.subject || "(件名なし)"}\n\n30日以内ならGmailから元に戻せます。よろしいですか？`));

          el.querySelector(".gm-reply-btn").addEventListener("click", async (ev) => {
            const b = ev.currentTarget;
            b.disabled = true; const bo = b.textContent; b.textContent = "作成中…";
            try {
              const rr = await fetch(`/api/meetings/${encodeURIComponent(botId)}/gmail-reply-draft`, {
                method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ threadId: t.threadId }),
              });
              const dd = await rr.json();
              if (dd.needScope) { gmNote.textContent = "Gmailの権限が不足しています。Googleを再連携してください。"; return; }
              if (!rr.ok || !dd.ok) throw new Error(dd.error || "返信の作成に失敗しました");
              thanksSubject.value = dd.subject || "";
              thanksBody.value = dd.body || "";
              gmTo.value = dd.to || "";
              gmReply = { threadId: dd.threadId, inReplyTo: dd.inReplyTo, references: dd.references };
              gmToWrap.hidden = false;
              gmThreads.innerHTML = ""; // 返信を作成したら候補一覧を消す
              gmNote.textContent = "返信の下書きを下に入れました。内容を確認・編集して、Gmailの下書きに保存できます。";
              thanksBody.scrollIntoView({ block: "nearest" });
            } catch (e2) {
              gmNote.textContent = "作成失敗: " + e2.message;
            } finally {
              b.disabled = false; b.textContent = bo;
            }
          });
          gmThreads.appendChild(el);
        });
      } catch (e) {
        gmNote.textContent = "取得失敗: " + e.message;
      } finally {
        gmFetchBtn.disabled = false;
        gmFetchBtn.textContent = o;
      }
    }
    gmFetchBtn.addEventListener("click", runGmFetch);
    gmQuery.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runGmFetch(); } });

    gmSendBtn.addEventListener("click", async () => {
      const to = (gmTo.value || "").trim();
      if (!to) { gmSendNote.textContent = "宛先を入力してください。"; return; }
      if (!thanksBody.value.trim()) { gmSendNote.textContent = "本文が空です。"; return; }
      gmSendBtn.disabled = true;
      const o = gmSendBtn.textContent;
      gmSendBtn.textContent = "保存中…";
      gmSendNote.textContent = "";
      try {
        const r = await fetch("/api/gmail/draft", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({
            to,
            subject: thanksSubject.value || "",
            body: thanksBody.value,
            threadId: gmReply && gmReply.threadId,
            inReplyTo: gmReply && gmReply.inReplyTo,
            references: gmReply && gmReply.references,
          }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "下書きの保存に失敗しました");
        gmSendNote.textContent = "Gmailに下書きを保存しました。Gmailで内容を確認して送信してください。";
      } catch (e) {
        gmSendNote.textContent = "保存失敗: " + e.message;
      } finally {
        gmSendBtn.disabled = false;
        gmSendBtn.textContent = o;
      }
    });

    // Salesforce連携タブ
    const sfUrl = hdetail.querySelector("#sfUrl");
    const sfFetchBtn = hdetail.querySelector("#sfFetchBtn");
    const sfRows = hdetail.querySelector("#sfRows");
    const sfNote = hdetail.querySelector("#sfNote");
    const sfPushBtn = hdetail.querySelector("#sfPushBtn");
    const sfAutoBtn = hdetail.querySelector("#sfAutoBtn");
    const sfAutoNote = hdetail.querySelector("#sfAutoNote");
    const sfAutoResult = hdetail.querySelector("#sfAutoResult");
    const sfSearchBtn = hdetail.querySelector("#sfSearchBtn");
    const sfSearchNote = hdetail.querySelector("#sfSearchNote");
    const sfCandidates = hdetail.querySelector("#sfCandidates");
    const sfStats = hdetail.querySelector("#sfStats");
    const sfAutoReflect = hdetail.querySelector("#sfAutoReflect");
    let sfRecordId = "";
    let sfSearched = false;
    let sfStatsLoaded = false;

    // 「得を見える化」統計＋自動反映設定を読み込む
    const loadSfStats = async () => {
      if (sfStatsLoaded) return;
      sfStatsLoaded = true;
      try {
        const d = await (await fetch("/api/salesforce/stats")).json();
        if (sfAutoReflect) sfAutoReflect.checked = !!d.autoReflect;
        const mo = d.month || {};
        const skipped = mo.runs || 0;
        if (skipped > 0 || (mo.fieldsFilled || 0) > 0) {
          sfStats.innerHTML =
            `<div class="sf-stats-title">今月のあなたの自動化</div>
             <div class="sf-stats-row">
               <div class="sf-stat"><div class="sf-stat-num">${skipped}</div><div class="sf-stat-lbl">回ぶんの手入力をスキップ</div></div>
               <div class="sf-stat"><div class="sf-stat-num">${mo.fieldsFilled || 0}</div><div class="sf-stat-lbl">項目を自動入力</div></div>
               <div class="sf-stat"><div class="sf-stat-num">${mo.activities || 0}</div><div class="sf-stat-lbl">件の活動履歴を記録</div></div>
             </div>`;
          sfStats.hidden = false;
        }
      } catch {}
    };
    if (sfAutoReflect) {
      sfAutoReflect.addEventListener("change", () => {
        fetch("/api/salesforce/auto-reflect", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: sfAutoReflect.checked }),
        }).catch(() => {});
      });
    }
    sfUrl.value = m.sf_url || "";
    sfUrl.addEventListener("change", () => {
      fetch(`/api/meetings/${encodeURIComponent(botId)}/sf-link`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: sfUrl.value.trim() }),
      }).catch(() => {});
    });

    // 商談リンクを保存（選択・自動入力時に共通で使う）
    const saveSfLink = (url) => {
      sfUrl.value = url;
      fetch(`/api/meetings/${encodeURIComponent(botId)}/sf-link`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      }).catch(() => {});
    };

    // 候補1件のカードを描画
    const renderCandidate = (rec, selectable) => {
      const el = document.createElement("div");
      el.className = "sf-cand" + (selectable ? " sf-cand-click" : "");
      const meta = [rec.account, rec.stage, rec.closeDate].filter(Boolean).join(" ・ ");
      el.innerHTML =
        `<div class="sf-cand-name">${escapeHtml(rec.name || "(名称なし)")}</div>` +
        (meta ? `<div class="sf-cand-meta">${escapeHtml(meta)}</div>` : "");
      if (selectable) {
        el.addEventListener("click", () => {
          sfCandidates.querySelectorAll(".sf-cand").forEach((c) => c.classList.remove("sf-cand-sel"));
          el.classList.add("sf-cand-sel");
          saveSfLink(rec.url);
          sfSearchNote.textContent = `「${rec.name || "商談"}」を選びました。反映できます。`;
        });
      }
      return el;
    };

    // 会社名からSF商談を自動検索
    const runSfSearch = async () => {
      sfSearched = true;
      sfSearchBtn.disabled = true;
      const orig = sfSearchBtn.textContent;
      sfSearchBtn.textContent = "検索中…";
      sfCandidates.innerHTML = "";
      sfSearchNote.textContent = "";
      const q = acctKey(m);
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/sf-candidates`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ q }),
        });
        const d = await r.json();
        if (d.reason === "未設定") { sfSearchNote.textContent = "Salesforce未設定（設定→外部連携で有効になります）"; return; }
        if (d.reason === "未連携") { sfSearchNote.textContent = "未連携です。設定→外部連携から連携してください。"; return; }
        if (!r.ok) throw new Error(d.error || "検索に失敗しました");
        const recs = d.records || [];
        if (recs.length === 0) {
          sfSearchNote.textContent = `「${q}」に一致する商談が見つかりませんでした。下にリンクを手入力してください。`;
          return;
        }
        if (recs.length === 1) {
          saveSfLink(recs[0].url);
          sfCandidates.appendChild(renderCandidate(recs[0], false));
          sfSearchNote.textContent = `1件見つかりました（「${recs[0].name || "商談"}」）。そのまま反映できます。`;
          return;
        }
        const head = document.createElement("div");
        head.className = "sf-cand-head";
        head.textContent = `${recs.length}件見つかりました。どの商談に反映するか選んでください。`;
        sfCandidates.appendChild(head);
        recs.forEach((rec) => sfCandidates.appendChild(renderCandidate(rec, true)));
      } catch (e) {
        if (isSfReauthError(e.message)) {
          sfSearchNote.textContent = "";
          showSfReauthH(sfCandidates, "Salesforceのセッションが切れました（トークン期限切れ）。再接続してください。", runSfSearch);
        } else {
          sfSearchNote.textContent = "検索失敗: " + e.message;
        }
      } finally {
        sfSearchBtn.disabled = false;
        sfSearchBtn.textContent = orig;
      }
    };
    sfSearchBtn.addEventListener("click", runSfSearch);
    // ワンクリック自動反映（空欄補完＋活動履歴）
    sfAutoBtn.addEventListener("click", async () => {
      sfAutoBtn.disabled = true;
      const orig = sfAutoBtn.textContent;
      sfAutoBtn.textContent = "反映中…";
      sfAutoResult.innerHTML = "";
      sfAutoNote.textContent = "";
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/sf-autofill`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: sfUrl.value.trim() }),
        });
        const d = await r.json();
        if (d.reason === "未設定") { sfAutoNote.textContent = "Salesforce未設定（設定→外部連携で有効になります）"; return; }
        if (d.reason === "未連携") { sfAutoNote.textContent = "未連携です。設定→外部連携から連携してください。"; return; }
        if (d.needLink) { sfAutoNote.textContent = "先に上のSalesforce商談リンクを入力してください。"; return; }
        if (!r.ok || !d.ok) throw new Error(d.error || "反映に失敗しました");

        const filled = Object.keys((d.opportunity && d.opportunity.filled) || {}).length
          + Object.keys((d.account && d.account.filled) || {}).length;
        const skipped = Object.keys((d.opportunity && d.opportunity.skipped) || {}).length
          + Object.keys((d.account && d.account.skipped) || {}).length;
        const act = d.activity || {};
        const actLine = act.existing
          ? "活動履歴: すでに登録済み（重複作成なし）"
          : (act.created ? "活動履歴: 1件作成しました" : "活動履歴: 作成なし");
        const keyWarn = act.keyMissing
          ? '<div class="sf-auto-warn">※ 重複防止用のカスタム項目が未作成のため、次回以降の二重登録を防げません。SF側で kinbot_bot_id__c の作成をおすすめします。</div>'
          : "";
        sfAutoResult.innerHTML =
          `<div class="sf-auto-card">
             <div class="sf-auto-line sf-auto-ok">空欄に反映: ${filled}件</div>
             <div class="sf-auto-line sf-auto-mut">入力済みで変更しなかった項目: ${skipped}件</div>
             <div class="sf-auto-line">${escapeHtml(actLine)}</div>
             ${keyWarn}
           </div>`;
        sfAutoNote.textContent = "反映しました。";
        sfStatsLoaded = false;
        loadSfStats();
      } catch (e) {
        if (isSfReauthError(e.message)) {
          sfAutoNote.textContent = "";
          showSfReauthH(sfAutoResult, "Salesforceのセッションが切れました（トークン期限切れ）。再接続してください。", () => sfAutoBtn.click());
        } else {
          sfAutoNote.textContent = "反映失敗: " + e.message;
        }
      } finally {
        sfAutoBtn.disabled = false;
        sfAutoBtn.textContent = orig;
      }
    });
    sfFetchBtn.addEventListener("click", async () => {
      sfFetchBtn.disabled = true;
      const o = sfFetchBtn.textContent;
      sfFetchBtn.textContent = "取得中…";
      sfRows.innerHTML = "";
      sfPushBtn.hidden = true;
      sfNote.textContent = "";
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/sf-fields`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url: sfUrl.value.trim() }),
        });
        const d = await r.json();
        if (!d.configured) {
          sfNote.textContent = "Salesforce未設定（設定→Salesforce連携、後日の連携作業で有効になります）";
          return;
        }
        if (!d.connected) {
          sfNote.textContent = "未連携です。設定→Salesforce連携から連携してください。";
          return;
        }
        if (d.needLink) {
          sfNote.textContent = "商談リンクを入力してください。";
          return;
        }
        if (d.needMapping) {
          sfNote.textContent = "項目マッピングが未設定です。設定→Salesforce連携で指定してください。";
          return;
        }
        if (d.fetchError) {
          if (isSfReauthError(d.fetchError)) {
            showSfReauthH(sfRows, "Salesforceのセッションが切れました（トークン期限切れ）。再接続してください。", () => sfFetchBtn.click());
          } else {
            sfNote.textContent = "取得失敗: " + d.fetchError;
          }
          return;
        }
        sfRecordId = d.recordId || "";
        const rows = d.rows || [];
        if (!rows.length) {
          sfNote.textContent = "更新対象の項目がありません。";
          return;
        }
        sfRows.innerHTML = "";
        for (const row of rows) {
          const wrap = document.createElement("div");
          wrap.className = "sf-row";
          wrap.innerHTML = `<div class="sf-row-head"><b>${escapeHtml(row.label)}</b> <span class="sf-field">${escapeHtml(row.sfField)}</span></div>
            <div class="sf-current">現在: ${escapeHtml(String(row.current || "（空）"))}</div>
            <textarea class="sf-input" rows="2"></textarea>`;
          wrap.querySelector(".sf-input").value = row.proposed || "";
          wrap.dataset.sfField = row.sfField;
          sfRows.appendChild(wrap);
        }
        sfPushBtn.hidden = false;
        sfNote.textContent = "内容を確認・編集して「Salesforceに更新」を押してください。";
      } catch (e) {
        if (isSfReauthError(e.message)) {
          sfNote.textContent = "";
          showSfReauthH(sfRows, "Salesforceのセッションが切れました（トークン期限切れ）。再接続してください。", () => sfFetchBtn.click());
        } else {
          sfNote.textContent = "エラー: " + e.message;
        }
      } finally {
        sfFetchBtn.disabled = false;
        sfFetchBtn.textContent = o;
      }
    });
    sfPushBtn.addEventListener("click", async () => {
      const fields = {};
      sfRows.querySelectorAll(".sf-row").forEach((w) => {
        const f = w.dataset.sfField;
        const v = w.querySelector(".sf-input").value;
        if (f) fields[f] = v;
      });
      sfPushBtn.disabled = true;
      const o = sfPushBtn.textContent;
      sfPushBtn.textContent = "更新中…";
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/sf-update`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ recordId: sfRecordId, fields }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "更新に失敗しました");
        sfNote.textContent = "Salesforceを更新しました。";
      } catch (e) {
        sfNote.textContent = "更新失敗: " + e.message;
      } finally {
        sfPushBtn.disabled = false;
        sfPushBtn.textContent = o;
      }
    });

    // 商談名（編集可）
    const mTitle = hdetail.querySelector("#mTitle");
    mTitle.value = m.title || "";

    // 何回目（商談回数）・日時
    const mRound = hdetail.querySelector("#mRound");
    const mOwner = hdetail.querySelector("#mOwner");
    const mDatetime = hdetail.querySelector("#mDatetime");
    const mCategory = hdetail.querySelector("#mCategory");
    const mDealKind = hdetail.querySelector("#mDealKind");
    const mSaved = hdetail.querySelector("#mSaved");
    if (m.created_at) mDatetime.value = isoToLocalInput(m.created_at);
    if (mCategory) mCategory.value = m.category && m.category !== "" ? m.category : "商談";
    if (m.round_no) mRound.value = m.round_no;
    // 種別（コールド/過去失注）：保存済みがあればそれを、無ければ商談名から自動判定
    if (mDealKind) {
      const inferred = inferDealKind(m.title);
      mDealKind.value = m.deal_kind || inferred || "";
      // 保存が無く、タイトルから推定できた場合は自動で保存しておく（次回以降も反映）
      if (!m.deal_kind && inferred) {
        m.deal_kind = inferred;
        fetch(`/api/meetings/${botId}/meta`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ round: mRound.value, dealKind: inferred }),
        }).catch(() => {});
        const row = allMeetings.find((x) => x.bot_id === botId);
        if (row) row.deal_kind = inferred;
      }
    }

    // 営業担当（登録ユーザーから選択して付け替え）
    const users = await loadUsers();
    const present = new Set();
    for (const u of users) {
      const o = document.createElement("option");
      o.value = u.email;
      o.textContent = u.name || u.email;
      mOwner.appendChild(o);
      present.add(u.email);
    }
    // 現在の担当者が一覧に無い場合（旧データ等）も選べるように追加
    if (m.owner && !present.has(m.owner)) {
      const o = document.createElement("option");
      o.value = m.owner;
      o.textContent = m.owner_name || m.owner;
      mOwner.appendChild(o);
    }
    mOwner.value = m.owner || "";

    const saveMeta = async () => {
      try {
        const createdAt = mDatetime.value ? localInputToIso(mDatetime.value) : "";
        await fetch(`/api/meetings/${encodeURIComponent(botId)}/meta`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: mTitle.value.trim(),
            round: mRound.value,
            owner: mOwner.value,
            createdAt,
            category: mCategory ? mCategory.value : undefined,
            dealKind: mDealKind ? mDealKind.value : undefined,
          }),
        });
        mSaved.hidden = false;
        setTimeout(() => (mSaved.hidden = true), 1500);
        // 一覧の表示にも反映
        const row = allMeetings.find((x) => x.bot_id === botId);
        if (row) {
          row.title = mTitle.value.trim();
          row.round_no = mRound.value ? Number(mRound.value) : null;
          row.owner = mOwner.value || "";
          if (mCategory) row.category = mCategory.value;
          if (mDealKind) row.deal_kind = mDealKind.value || null;
          if (createdAt) row.created_at = createdAt;
          const u = (usersCache || []).find((x) => x.email === mOwner.value);
          row.owner_name = u ? u.name || u.email : mOwner.value ? mOwner.value : null;
        }
        renderList();
      } catch {}
    };
    mTitle.addEventListener("change", () => {
      // 商談名を変えたら、種別が未設定のときだけタイトルから自動判定して反映
      if (mDealKind && !mDealKind.value) {
        const inferred = inferDealKind(mTitle.value);
        if (inferred) mDealKind.value = inferred;
      }
      saveMeta();
    });
    mRound.addEventListener("change", saveMeta);
    if (mCategory) mCategory.addEventListener("change", saveMeta);
    if (mDealKind) mDealKind.addEventListener("change", saveMeta);
    mOwner.addEventListener("change", saveMeta);
    mDatetime.addEventListener("change", saveMeta);

    // 商談名・日時をカレンダーから選ぶ
    const calBtnH = hdetail.querySelector("#calBtnH");
    const calPanelH = hdetail.querySelector("#calPanelH");
    if (calBtnH && calPanelH) {
      calBtnH.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!calPanelH.hidden) {
          calPanelH.hidden = true;
          return;
        }
        openCalPicker(calPanelH, (ev) => {
          mTitle.value = ev.title;
          if (ev.start) mDatetime.value = ev.allDay ? ev.start + "T00:00" : isoToLocalInput(ev.start);
          saveMeta();
        });
      });
    }

    // Notionに送る
    const notionBtn = hdetail.querySelector("#notionBtn");
    if (notionBtn) notionBtn.addEventListener("click", async () => {
      notionBtn.disabled = true;
      const orig = notionBtn.textContent;
      notionBtn.textContent = "送信中…";
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/notion`, { method: "POST" });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "送信に失敗しました");
        notionBtn.textContent = "Notionへ送信済み";
        if (d.url) window.open(d.url, "_blank", "noopener");
        setTimeout(() => { notionBtn.textContent = orig; notionBtn.disabled = false; }, 2500);
      } catch (e) {
        kbNotify("Notion送信に失敗: " + e.message);
        notionBtn.textContent = orig; notionBtn.disabled = false;
      }
    });

    // 削除
    const delBtn = hdetail.querySelector("#delBtn");
    delBtn.addEventListener("click", async () => {
      if (!confirm(`「${m.title || "(商談名なし)"}」を削除します。よろしいですか？\nこの操作は取り消せません。`)) return;
      delBtn.disabled = true;
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}`, { method: "DELETE" });
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || "削除に失敗しました");
        }
        allMeetings = allMeetings.filter((x) => x.bot_id !== botId);
        renderList();
        hdetail.innerHTML = '<div class="empty-state">削除しました。左の一覧から別の商談を選べます。</div>';
      } catch (e) {
        kbNotify("削除に失敗しました: " + e.message);
        delBtn.disabled = false;
      }
    });

    renderSummaryInto(hdetail.querySelector("#dsummary"), s);
    const noteWrap = hdetail.querySelector("#dnoteWrap");
    if (noteWrap && m.note && m.note.trim()) {
      noteWrap.innerHTML = `<div class="dlabel">📝 商談メモ</div><div class="dnote">${escapeHtml(m.note)}</div>`;
    }
    renderFeedbackInto(hdetail.querySelector("#dfeedback"), m.feedback || {});
    renderMetricsInto(hdetail.querySelector("#dmetrics"), tr, m.rep_name);
    renderAiInto(hdetail.querySelector("#dai"), m.analysis);

    // 分析（スコア・BANT等）を生成
    const deepBtn = hdetail.querySelector("#deepBtn");
    if (tr.length === 0) deepBtn.disabled = true;
    deepBtn.addEventListener("click", async () => {
      deepBtn.disabled = true;
      const orig = deepBtn.textContent;
      deepBtn.textContent = "生成中…";
      window.kbProgress(hdetail.querySelector("#dai"), { percent: null, label: "AIが商談を多角的に分析しています…" });
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/deep-analyze`, { method: "POST" });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "生成に失敗しました");
        renderAiInto(hdetail.querySelector("#dai"), data);
      } catch (e) {
        window.kbProgress(hdetail.querySelector("#dai"), { clear: true });
        kbNotify("生成に失敗しました: " + e.message);
      } finally {
        deepBtn.disabled = false;
        deepBtn.textContent = orig;
      }
    });

    // 次の一手（ライブ中の記録）
    const dm = hdetail.querySelector("#dmoves");
    dm.innerHTML = sug.length
      ? sug.map((x) => `<div class="mini-card"><b>${escapeHtml(x.title || "")}</b><br>${escapeHtml(x.detail || "")}</div>`).join("")
      : '<div class="empty-state">記録なし</div>';

    // AI提案ログ（ライブ中の吹き出し全履歴）
    renderAiLogInto(hdetail.querySelector("#dailog"), Array.isArray(m.ai_log) ? m.ai_log : []);

    // 文字起こしから 要約＋営業フィードバック を生成
    // 文字起こしを後から作る（録画・音声から）
    const trBtn = hdetail.querySelector("#transcribeBtn");
    if (trBtn) {
      if (tr.length > 0) trBtn.hidden = true;   // すでに文字起こしがあれば出さない
      trBtn.addEventListener("click", async () => {
        trBtn.disabled = true;
        const orig = trBtn.textContent;
        trBtn.textContent = "作っています…（数分かかります）";
        try {
          const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/transcribe`, { method: "POST" });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || "作れませんでした");
          trBtn.textContent = d.件数 ? `できました（${d.件数}件）` : (d.状態 || "できました");
          setTimeout(() => location.reload(), 1200);
        } catch (e) {
          alert("文字起こしを作れませんでした：" + e.message);
          trBtn.disabled = false; trBtn.textContent = orig;
        }
      });
    }

    const genBtn = hdetail.querySelector("#genBtn");
    if (tr.length === 0) genBtn.disabled = true;
    genBtn.addEventListener("click", async () => {
      genBtn.disabled = true;
      const orig = genBtn.textContent;
      genBtn.textContent = "生成中…";
      window.kbProgress(hdetail.querySelector("#dsummary"), { percent: null, label: "文字起こしから要約・フィードバックを生成しています…" });
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/analyze`, { method: "POST" });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "生成に失敗しました");
        s = data.summary || s;
        renderSummaryInto(hdetail.querySelector("#dsummary"), data.summary || {});
        renderFeedbackInto(hdetail.querySelector("#dfeedback"), data.feedback || {});
        if (customMode) await loadCustom(true); // 要約タブはカスタム出力を表示しているので作り直す
        loadList(); // 一覧の「要約なし」表示を更新
      } catch (e) {
        window.kbProgress(hdetail.querySelector("#dsummary"), { clear: true });
        kbNotify("生成に失敗しました: " + e.message);
      } finally {
        genBtn.disabled = false;
        genBtn.textContent = orig;
      }
    });

    // 文字起こし
    const dt = hdetail.querySelector("#dtrans");
    dt.innerHTML = tr.length
      ? tr.map((u) => `<div class="tline"><span class="spk2">${escapeHtml(labelOf(u.speaker))}</span>${escapeHtml(u.text)}</div>`).join("")
      : '<div class="empty-state">文字起こしなし</div>';

    // 録画（あれば）アプリ内で再生
    const drec = hdetail.querySelector("#drec");
    drec.innerHTML = '<div class="rec-loading">録画を確認中…</div>';
    fetch(`/api/meetings/${encodeURIComponent(botId)}/recording`)
      .then((r) => r.json())
      .then((d) => {
        if (d && d.url) {
          setupRecordingPlayer(drec, d, m);
        } else {
          drec.innerHTML = '<div class="rec-none">録画はまだありません（会議終了後・アップロード動画は変換完了後に表示されます）。</div>';
        }
      })
      .catch(() => {
        drec.innerHTML = '<div class="rec-none">録画を取得できませんでした。</div>';
      });
  } catch (e) {
    hdetail.innerHTML = '<div class="empty-state">読み込みに失敗しました。</div>';
  }
}

// ===== 録画プレイヤー =====
// スマホ（iPhone・Android）は、動画のままだとホーム画面に戻ったり他アプリを開いた時点で止まりやすい。
// そこで裏に回った瞬間に、同じファイルの音声へ自動で引き継いで再生を続ける。
// kinbotに戻ってきたら、その位置から動画の再生を再開する。ボタン操作は不要。

function setMediaSession(el, meeting) {
  if (!("mediaSession" in navigator)) return;
  try {
    if (window.MediaMetadata) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: meeting.title || "商談",
        artist: meeting.company_name || "kinbot",
        album: meeting.created_at ? new Date(meeting.created_at).toLocaleDateString("ja-JP") : "",
      });
    }
    navigator.mediaSession.setActionHandler("play", () => { el.play().catch(() => {}); });
    navigator.mediaSession.setActionHandler("pause", () => el.pause());
    navigator.mediaSession.setActionHandler("seekbackward", (e) => {
      el.currentTime = Math.max(0, el.currentTime - ((e && e.seekOffset) || 15));
    });
    navigator.mediaSession.setActionHandler("seekforward", (e) => {
      el.currentTime = Math.min(el.duration || 1e9, el.currentTime + ((e && e.seekOffset) || 15));
    });
    navigator.mediaSession.setActionHandler("seekto", (e) => {
      if (!e) return;
      if (e.fastSeek && el.fastSeek) el.fastSeek(e.seekTime); else el.currentTime = e.seekTime;
    });
  } catch {}
}

// ===== 商談の段階（章）を再生バーの下に出す =====
const PHASE_COLOR = {
  "アイスブレイク": "#cfe7dd",
  "ヒアリング": "#5DCAA5",
  "提案・説明": "#1d9e75",
  "デモ": "#17b39a",
  "質疑・懸念": "#e0b25e",
  "価格・条件": "#d99114",
  "クロージング": "#0d5b47",
  "次回調整": "#8fb8ab",
  "雑談": "#c9c7bd",
};
const mmss = (sec) => {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
};

function chOpen() {
  try { return localStorage.getItem("kinbot_ch_open") !== "0"; } catch { return true; }
}

function renderChapters(drec, video, meeting, mediaUrl) {
  const wrap = drec.querySelector("#chWrap");
  if (!wrap || !meeting) return;
  let chapters = Array.isArray(meeting.chapters) ? meeting.chapters : [];

  // まだ段階が無ければ、開いたときに自動で作る（1回だけ）
  const make = async () => {
    wrap.innerHTML = '<div class="ch-loading">商談の段階に分けています…</div>';
    try {
      const r = await fetch(`/api/meetings/${encodeURIComponent(meeting.bot_id)}/chapters`, { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "作成に失敗しました");
      chapters = d.chapters || [];
      meeting.chapters = chapters;
      draw();
    } catch (e) {
      wrap.innerHTML = `<button type="button" class="btn ghost ch-make">段階を作り直す（${escapeHtml(e.message)}）</button>`;
      const b = wrap.querySelector(".ch-make");
      if (b) b.addEventListener("click", make);
    }
  };

  const seekTo = (sec) => {
    const el = drec.querySelector("video") || drec.querySelector("audio");
    if (!el) return;
    try { el.currentTime = Math.max(0, sec || 0); } catch {}
    const p = el.play();
    if (p && p.catch) p.catch(() => {});
  };

  // 動画の長さが分かってから、各段階の位置を決める
  const mediaEl = () => drec.querySelector("video") || drec.querySelector("audio");
  const durationOf = () => {
    const el = mediaEl();
    const d = el && el.duration;
    return (d && isFinite(d) && d > 1) ? d : 0;
  };
  // 秒が入っていればそれを使い、無ければ「話した文字数の割合 × 動画の長さ」で決める
  const timesOf = () => {
    const dur = durationOf();
    return chapters.map((c) => {
      const hasSec = typeof c.start === "number" && isFinite(c.start);
      const start = hasSec ? c.start : Math.round((c.ratioStart || 0) * dur);
      const endRaw = hasSec && typeof c.end === "number" ? c.end : Math.round((c.ratioEnd || 1) * dur);
      return { start, end: Math.max(start + 1, endRaw) };
    });
  };

  const draw = () => {
    if (!chapters.length) {
      if (!renderChapters._busy) {
        renderChapters._busy = true;
        make().finally(() => { renderChapters._busy = false; });
      }
      return;
    }
    const times = timesOf();
    const total = Math.max(1, durationOf() || times[times.length - 1].end || 1);
    wrap.innerHTML =
      `<div class="ch-track">
         <div class="ch-hover" hidden>
           <video class="ch-prev" muted playsinline preload="metadata"></video>
           <div class="ch-hover-label"></div>
           <div class="ch-hover-time"></div>
         </div>
         <div class="ch-bar" role="group" aria-label="商談の段階">` +
      chapters.map((c, i) => {
        const w = Math.max(2, ((times[i].end - times[i].start) / total) * 100);
        const col = PHASE_COLOR[c.phase] || "#9db3ab";
        return `<button type="button" class="ch-seg" data-sec="${times[i].start}" style="width:${w}%;background:${col}"
                  title="${escapeHtml(c.phase)}（${mmss(times[i].start)}〜）${c.note ? " " + escapeHtml(c.note) : ""}">
                  <span class="ch-seg-label">${escapeHtml(c.phase)}</span>
                </button>`;
      }).join("") + `</div></div>` +
      `<div class="ch-tools">
         <button type="button" class="ch-toggle">${chOpen() ? "段階の一覧を隠す" : "段階の一覧を出す"}</button>
         <button type="button" class="ch-redo">作り直す</button>
       </div>` +
      `<div class="ch-list${chOpen() ? "" : " is-hidden"}">` +
      chapters.map((c, i) => `
        <button type="button" class="ch-item" data-sec="${times[i].start}">
          <span class="ch-dot" style="background:${PHASE_COLOR[c.phase] || "#9db3ab"}"></span>
          <span class="ch-time">${mmss(times[i].start)}</span>
          <span class="ch-phase">${escapeHtml(c.phase)}</span>
          <span class="ch-note">${escapeHtml(c.note || "")}</span>
        </button>`).join("") + `</div>`;

    // 一覧の開閉と作り直し
    const tg = wrap.querySelector(".ch-toggle");
    if (tg) tg.addEventListener("click", () => {
      const open = !chOpen();
      try { localStorage.setItem("kinbot_ch_open", open ? "1" : "0"); } catch {}
      const list = wrap.querySelector(".ch-list");
      if (list) list.classList.toggle("is-hidden", !open);
      tg.textContent = open ? "段階の一覧を隠す" : "段階の一覧を出す";
    });
    const redo = wrap.querySelector(".ch-redo");
    if (redo) redo.addEventListener("click", () => {
      if (!confirm("段階を作り直しますか？（30秒ほどかかります）")) return;
      chapters = [];
      meeting.chapters = [];
      make();
    });

    // 一覧をクリック → その段階の頭へ
    wrap.querySelectorAll(".ch-item").forEach((b) => {
      b.addEventListener("click", () => seekTo(Number(b.dataset.sec) || 0));
    });

    const bar = wrap.querySelector(".ch-bar");
    const hov = wrap.querySelector(".ch-hover");
    const prev = wrap.querySelector(".ch-prev");
    const lab = wrap.querySelector(".ch-hover-label");
    const tm = wrap.querySelector(".ch-hover-time");

    const timeAt = (ev) => {
      const r = bar.getBoundingClientRect();
      const x = Math.max(0, Math.min(r.width, ev.clientX - r.left));
      return (x / Math.max(1, r.width)) * total;
    };
    const phaseAt = (t) => {
      let c = chapters[0];
      chapters.forEach((x, i) => { if (t >= times[i].start) c = x; });
      return c || {};
    };

    let seekTimer = null;
    if (bar) {
      bar.addEventListener("mousemove", (ev) => {
        if (!hov) return;
        const t = timeAt(ev);
        const c = phaseAt(t);
        const r = bar.getBoundingClientRect();
        const x = Math.max(0, Math.min(r.width, ev.clientX - r.left));
        hov.hidden = false;
        hov.style.left = Math.max(70, Math.min(r.width - 70, x)) + "px";
        if (lab) lab.textContent = c.phase ? c.phase + (c.note ? " ・ " + c.note : "") : "";
        if (tm) tm.textContent = mmss(t);
        // 少し止まったら、その位置の映像を出す
        if (prev && prev.dataset.ok === "1") {
          clearTimeout(seekTimer);
          seekTimer = setTimeout(() => { try { prev.currentTime = t; } catch {} }, 60);
        }
      });
      bar.addEventListener("mouseleave", () => { if (hov) hov.hidden = true; });
      bar.addEventListener("click", (ev) => seekTo(timeAt(ev)));
    }

    // プレビュー用の動画を用意する（同じ動画を音無しで読み込む）
    if (prev && mediaUrl && !/\.m3u8(\?|$)/.test(mediaUrl)) {
      prev.src = mediaUrl;
      prev.addEventListener("loadedmetadata", () => { prev.dataset.ok = "1"; }, { once: true });
      prev.addEventListener("error", () => { prev.dataset.ok = "0"; prev.style.display = "none"; }, { once: true });
    } else if (prev) {
      prev.style.display = "none";
    }

    // 再生位置に合わせて、いまの段階を光らせる
    const el = drec.querySelector("video") || drec.querySelector("audio");
    if (el) {
      el.addEventListener("timeupdate", () => {
        const t = el.currentTime || 0;
        let idx = 0;
        times.forEach((x, i) => { if (t >= x.start) idx = i; });
        wrap.querySelectorAll(".ch-seg").forEach((x, i) => x.classList.toggle("is-now", i === idx));
      });
    }
  };
  // 動画の長さが分かってから位置を確定させる
  const el0 = mediaEl();
  if (el0) {
    if (durationOf()) draw();
    else el0.addEventListener("loadedmetadata", () => draw(), { once: true });
  }
  draw();
}

// iPhoneかどうか（iPhoneだけ、裏に回ったときに音声へ引き継ぐ）
function isIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isAndroid() {
  return /Android/.test(navigator.userAgent);
}
// スマホ（iPhone / Android）かどうか。バックグラウンド音声の引き継ぎ対象。
function isMobile() {
  return isIOS() || isAndroid();
}

function setupRecordingPlayer(drec, d, meeting) {
  const url = d.url;
  const isHls = !!(d.hls || /\.m3u8(\?|$)/.test(url));
  let hlsInst = null;
  let bgAudio = null, primed = false, bgActive = false;

  // 前のプレイヤーの後始末
  if (setupRecordingPlayer._vis) {
    document.removeEventListener("visibilitychange", setupRecordingPlayer._vis);
    setupRecordingPlayer._vis = null;
  }

  drec.innerHTML =
    `<video class="rec-video" controls preload="metadata" playsinline autopictureinpicture></video>
     <div class="ch-wrap" id="chWrap"></div>
     <div class="rec-bar">
       <span class="rec-hint">${d && d.source === "drive"
         ? "Googleドライブの録画を再生しています。ホーム画面に戻っても音声は続きます。"
         : "ドライブへの保存中です（書き出しが終わり次第、自動で切り替わります）。"}</span>
       ${d && d.source !== "drive" ? `<button type="button" class="rec-open" id="recToDrive">いますぐドライブに保存</button>` : ""}
       <button type="button" class="rec-open" id="recShare">共有リンクを作る</button>
       ${d && d.driveLink ? `<a class="rec-open" href="${escapeHtml(d.driveLink)}" target="_blank" rel="noopener">ドライブで開く</a>` : ""}
       ${isHls ? "" : `<a class="rec-open" href="${escapeHtml(url)}" target="_blank" rel="noopener">別タブで開く</a>`}
     </div>`;

  const video = drec.querySelector("video");
  renderChapters(drec, video, meeting, url);

  // kinbotのアカウントが無い人にも見せる共有リンク
  const shareBtn = drec.querySelector("#recShare");
  if (shareBtn) shareBtn.addEventListener("click", async () => {
    shareBtn.disabled = true;
    shareBtn.textContent = "作成中…";
    try {
      const r = await fetch(`/api/meetings/${encodeURIComponent(meeting.bot_id)}/share-link`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error([j.error, j.hint].filter(Boolean).join(" / ") || "作成に失敗しました");
      const box = document.createElement("div");
      box.className = "rec-share";
      box.innerHTML =
        `<input type="text" class="rec-share-url" value="${escapeHtml(j.link)}" readonly />
         <button type="button" class="btn rec-share-copy">コピー</button>
         <div class="rec-share-note">${escapeHtml(j.note || "")}</div>`;
      shareBtn.parentElement.appendChild(box);
      box.querySelector(".rec-share-copy").addEventListener("click", () => {
        const inp = box.querySelector(".rec-share-url");
        inp.select();
        navigator.clipboard.writeText(inp.value).then(() => {
          box.querySelector(".rec-share-copy").textContent = "コピーしました";
          if (window.kbToast) window.kbToast("共有リンクをコピーしました");
        }).catch(() => {});
      });
      shareBtn.textContent = "共有リンクを作りました";
    } catch (e) {
      shareBtn.disabled = false;
      shareBtn.textContent = "共有リンクを作る";
      if (window.kbToast) window.kbToast(e.message, "error");
    }
  });

  // Googleドライブに保存する
  const toDrive = drec.querySelector("#recToDrive");
  if (toDrive) toDrive.addEventListener("click", async () => {
    toDrive.disabled = true;
    toDrive.textContent = "保存中…（数分かかります）";
    try {
      const r = await fetch(`/api/meetings/${encodeURIComponent(meeting.bot_id)}/archive-drive`, { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "保存に失敗しました");
      toDrive.textContent = j.already ? "保存済み" : `保存しました（${j.sizeMB || "?"}MB）`;
      if (window.kbToast) window.kbToast("Googleドライブに保存しました");
    } catch (e) {
      toDrive.disabled = false;
      toDrive.textContent = "ドライブに保存";
      if (window.kbToast) window.kbToast("保存に失敗しました：" + e.message, "error");
    }
  });
  if (isHls && window.Hls && window.Hls.isSupported() && !video.canPlayType("application/vnd.apple.mpegurl")) {
    hlsInst = new Hls();
    hlsInst.loadSource(url);
    hlsInst.attachMedia(video);
  } else {
    video.src = url;
  }
  setMediaSession(video, meeting);

  // ---- 裏に回ったときに音声へ引き継ぐ（iPhone / Android のスマホ） ----
  // 直接ファイル（ドライブのmp4など）のときだけ。HLS配信中は音声だけの引き継ぎができないので、
  // ドライブ保存が終わってmp4になってから効く。
  const nativeOk = !isHls || !!video.canPlayType("application/vnd.apple.mpegurl");
  if (!isMobile() || !nativeOk) return;

  bgAudio = document.createElement("audio");
  bgAudio.preload = "none";
  bgAudio.src = url;
  bgAudio.style.display = "none";
  drec.appendChild(bgAudio);

  // タップした瞬間に一度だけ空再生しておく（iPhoneは事前に許可を取らないと裏で鳴らせないため）
  const prime = () => {
    if (primed || !bgAudio) return;
    primed = true;
    try {
      bgAudio.muted = true;
      const p = bgAudio.play();
      const done = () => { try { bgAudio.pause(); bgAudio.muted = false; } catch {} };
      if (p && p.then) p.then(done).catch(() => { primed = false; try { bgAudio.muted = false; } catch {} });
      else done();
    } catch { primed = false; }
  };
  video.addEventListener("play", prime);
  drec.addEventListener("pointerdown", prime, { once: true });

  setupRecordingPlayer._vis = () => {
    if (!bgAudio || !video.isConnected) return;
    if (document.hidden) {
      if (video.paused || bgActive) return;
      try {
        bgAudio.currentTime = video.currentTime || 0;
        bgAudio.playbackRate = video.playbackRate || 1;
        const p = bgAudio.play();
        if (p && p.catch) p.catch(() => {});
        bgActive = true;
        setMediaSession(bgAudio, meeting);
      } catch {}
      // 小窓などで動画がそのまま再生され続けている場合は、音が二重にならないよう止める
      setTimeout(() => {
        if (bgActive && !video.paused) { try { bgAudio.pause(); } catch {} bgActive = false; }
      }, 500);
    } else if (bgActive) {
      bgActive = false;
      try {
        const t = bgAudio.currentTime;
        bgAudio.pause();
        if (t) video.currentTime = t;
        const p = video.play();
        if (p && p.catch) p.catch(() => {});
        setMediaSession(video, meeting);
      } catch {}
    }
  };
  document.addEventListener("visibilitychange", setupRecordingPlayer._vis);
}

const HTYPE_LABEL = { question: "深掘り質問", objection: "切り返し", closing: "クロージング", risk: "リスク", info: "補足" };
function renderAiLogInto(el, log) {
  if (!el) return;
  if (!log || !log.length) {
    el.innerHTML = '<div class="empty-state">この商談ではAI提案の記録がありません（旧データ、または提案が出る前に終了）。</div>';
    return;
  }
  // 一覧（刺さったトーク／懸念→刺さった言い返し）
  const lands = log.filter((e) => e.t === "land");
  const objs = log.filter((e) => e.t === "obj");
  let summary = "";
  if (lands.length) {
    summary += `<div class="ailog-sec"><div class="ailog-sec-h">💡 刺さったトーク（${lands.length}）</div><ul class="ailog-list">` +
      lands.map((e) => `<li>${escapeHtml(e.text || "")}${e.why ? `<span class="ailog-sub">（${escapeHtml(e.why)}）</span>` : ""}</li>`).join("") +
      `</ul></div>`;
  }
  if (objs.length) {
    summary += `<div class="ailog-sec"><div class="ailog-sec-h">⚠️ 懸念 → 刺さった言い返し（${objs.length}）</div><div class="ailog-pairs">` +
      objs.map((e) =>
        `<div class="ailog-pair"><div class="ailog-q">「${escapeHtml(e.objection || "")}」</div>` +
        `<div class="ailog-a">${escapeHtml(e.response || "")}</div>` +
        (e.basis ? `<div class="ailog-basis">根拠: ${escapeHtml(e.basis)}</div>` : "") + `</div>`
      ).join("") +
      `</div></div>`;
  }
  const qas = log.filter((e) => e.t === "qa");
  if (qas.length) {
    summary += `<div class="ailog-sec"><div class="ailog-sec-h">質問 → その場の回答（${qas.length}）</div><div class="ailog-pairs">` +
      qas.map((e) =>
        `<div class="ailog-pair"><div class="ailog-q">「${escapeHtml(e.question || "")}」</div>` +
        `<div class="ailog-a">${escapeHtml(e.answer || "")}</div>` +
        (e.basis ? `<div class="ailog-basis">根拠: ${escapeHtml(e.basis)}</div>` : "") + `</div>`
      ).join("") +
      `</div></div>`;
  }
  const feedHtml = '<div class="ailog-sec-h" style="margin-top:14px;">🗨 タイムライン</div>';

  el.innerHTML = summary + feedHtml + '<div class="ai-feed-inline"></div>';
  const feed = el.querySelector(".ai-feed-inline");
  for (const e of log) {
    const time = e.ts ? new Date(e.ts).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : "";
    const wrap = document.createElement("div");
    wrap.className = "ai-msg";
    let kind, label, title, text, sub = "";
    if (e.t === "obj") {
      kind = "obj"; label = "懸念 → 刺さる言い返し";
      title = e.objection ? "「" + e.objection + "」" : "";
      text = e.response || "";
      sub = e.basis ? "根拠: " + e.basis : "";
    } else if (e.t === "land") {
      kind = "land"; label = "💡 刺さったトーク";
      title = e.text || ""; text = e.why || "";
    } else if (e.t === "qa") {
      kind = "obj"; label = "質問 → その場の回答";
      title = e.question ? "「" + e.question + "」" : "";
      text = e.answer || "";
      sub = [e.basis ? "根拠: " + e.basis : "", e.caution || ""].filter(Boolean).join(" ／ ");
    } else if (e.t === "sig") {
      // 旧データ互換
      const buy = e.sigType !== "risk";
      kind = buy ? "land" : "obj";
      label = buy ? "刺さり（旧）" : "懸念（旧）";
      title = e.text || ""; text = e.hint || "";
    } else {
      kind = HTYPE_LABEL[e.sugType] ? e.sugType : "info";
      label = HTYPE_LABEL[kind] || "補足";
      title = e.title || ""; text = e.detail || "";
    }
    const lbl = label ? `<span class="ai-label ai-label-${kind}">${escapeHtml(label)}</span>` : "";
    const ttl = title ? `<div class="ai-b-title">${escapeHtml(title)}</div>` : "";
    const sb = sub ? `<div class="ai-b-sub">${escapeHtml(sub)}</div>` : "";
    const tm = time ? `<div class="ai-b-time">${escapeHtml(time)}</div>` : "";
    wrap.innerHTML =
      `<img class="ai-ava" src="kinbot.svg" alt="kinbot" />` +
      `<div class="ai-bubble ai-bubble-${kind}">${lbl}${ttl}<div class="ai-b-text">${escapeHtml(text)}</div>${sb}${tm}</div>`;
    feed.appendChild(wrap);
  }
}

function renderSummaryInto(el, s) {
  s = s || {};
  // 旧データで formatted のみの場合はそれを表示
  if (s.formatted && !s.key_points && !s.agreements) {
    el.innerHTML = `<div class="summary-fmt"></div>`;
    el.querySelector(".summary-fmt").textContent = s.formatted;
    return;
  }
  let html = "";
  if (s.overview) html += `<p class="overview">${escapeHtml(s.overview)}</p>`;
  html += group("要点", s.key_points);
  html += group("合意事項", s.agreements);
  html += group("宿題・次アクション", s.action_items);
  html += group("相手の懸念", s.customer_concerns);
  el.innerHTML = html || '<div class="empty-state">要約なし（「要約・FB生成」で作成）</div>';
}

// Salesforce等に貼りやすいプレーンテキストを生成
function summaryToText(s) {
  s = s || {};
  if (s.formatted && !s.key_points && !s.agreements) return s.formatted;
  const lines = [];
  if (s.overview) {
    lines.push(s.overview, "");
  }
  const sec = (label, items) => {
    if (Array.isArray(items) && items.length) {
      lines.push("■" + label);
      items.forEach((i) => lines.push("・" + i));
      lines.push("");
    }
  };
  sec("要点", s.key_points);
  sec("合意事項", s.agreements);
  sec("宿題・次アクション", s.action_items);
  sec("相手の懸念", s.customer_concerns);
  return lines.join("\n").trim();
}
function renderFeedbackInto(el, fb) {
  fb = fb || {};
  let html = "";
  if (fb.overall) html += `<p class="overview">${escapeHtml(fb.overall)}</p>`;
  html += group("良かった点", fb.good_points);
  html += group("改善点", fb.improvements);
  html += group("見落とし・機会損失", fb.missed);
  html += group("次回への宿題", fb.next_steps);
  el.innerHTML = html || '<div class="empty-state">フィードバックなし（「要約・フィードバックを生成」で作成）</div>';
}

function group(label, items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return (
    `<div class="sgroup"><div class="label">${label}</div><ul>` +
    items.map((i) => `<li>${escapeHtml(i)}</li>`).join("") +
    `</ul></div>`
  );
}
function computeMetrics(tr, repName) {
  const by = new Map();
  let total = 0;
  for (const u of tr) {
    const name = labelOf(u.speaker);
    const t = u.text || "";
    if (!by.has(name)) by.set(name, { chars: 0, turns: 0, questions: 0 });
    const o = by.get(name);
    o.chars += t.length;
    o.turns += 1;
    if (/[?？]|ですか|ますか|でしょうか/.test(t)) o.questions += 1;
    total += t.length;
  }
  const speakers = [...by.entries()]
    .map(([name, o]) => ({
      name, chars: o.chars, turns: o.turns, questions: o.questions,
      ratio: total ? Math.round((o.chars / total) * 100) : 0,
      isRep: !!(repName && name.includes(repName)),
    }))
    .sort((a, b) => b.chars - a.chars);
  return { speakers, total };
}

// 顧客の温度感（計算式は temperature.js に集約）
function computeTemperature(tr, repName) {
  if (window.KBTemp) return window.KBTemp.score(tr, repName);
  return { custTurns: 0, score: 0, curve: [] };
}

// 温度の推移を小さな折れ線で描く
function tempCurveSvg(curve) {
  if (!curve || curve.length < 2) return "";
  const w = 260, h = 54, pad = 6;
  const step = (w - pad * 2) / (curve.length - 1);
  const y = (v) => pad + (h - pad * 2) * (1 - v / 100);
  const pts = curve.map((v, i) => `${(pad + i * step).toFixed(1)},${y(v).toFixed(1)}`);
  const dots = curve.map((v, i) => `<circle cx="${(pad + i * step).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="#1d9e75"/>`).join("");
  return `<svg class="temp-curve" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="商談中の温度の変化">
    <line x1="0" y1="${y(50)}" x2="${w}" y2="${y(50)}" stroke="#d8d5c9" stroke-width="1" stroke-dasharray="3 3"/>
    <polyline points="${pts.join(" ")}" fill="none" stroke="#1d9e75" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
  </svg>`;
}

// スコアを輪で表す
function ringSvg(score) {
  const v = Math.max(0, Math.min(100, Number(score) || 0));
  const r = 26, c = 2 * Math.PI * r;
  const off = c * (1 - v / 100);
  ringSvg._n = (ringSvg._n || 0) + 1;
  const gid = "kbRingGrad" + ringSvg._n;
  return `<span class="temp-ring">
    <svg viewBox="0 0 62 62" aria-hidden="true">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0d5b47"/><stop offset="60%" stop-color="#1d9e75"/><stop offset="100%" stop-color="#5DCAA5"/>
      </linearGradient></defs>
      <circle class="bg" cx="31" cy="31" r="${r}"/>
      <circle class="fg" cx="31" cy="31" r="${r}" stroke="url(#${gid})" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
    </svg>
    <b>${v}</b>
  </span>`;
}

function tempTile(label, value, sub, tone) {
  const small = String(value).length > 4 ? " is-text" : "";
  return `<div class="temp-tile${tone ? " is-" + tone : ""}">
    <div class="temp-tile-v${small}">${value}</div>
    <div class="temp-tile-l">${escapeHtml(label)}</div>
    ${sub ? `<div class="temp-tile-s">${sub}</div>` : ""}
  </div>`;
}

function renderMetricsInto(el, tr, repName) {
  if (!tr.length) {
    el.innerHTML = '<div class="empty-state">文字起こしがありません。</div>';
    return;
  }
  const m = computeMetrics(tr, repName);
  const t = computeTemperature(tr, repName);
  let html = "";

  // ---- 顧客の温度感 ----
  if (t.custTurns) {
    const tone = t.score >= 70 ? "hot" : t.score >= 45 ? "warm" : "cool";
    html += `<div class="temp-box is-${tone}">
      <div class="temp-head">
        <div class="temp-score">${ringSvg(t.score)}<span>/100</span></div>
        <div class="temp-meta">
          <div class="temp-label">顧客の温度感：${escapeHtml(t.level)}</div>
          <div class="temp-note">${escapeHtml(t.levelNote)}</div>
        </div>
      </div>
      <div class="temp-gauge"><span style="width:${t.score}%"></span></div>
      <div class="temp-tiles">
        ${tempTile("前向きなことば", t.strong + t.mild, t.strong ? `うち強い前向き ${t.strong}` : "", "pos")}
        ${tempTile("購買サイン", t.signal, "料金・時期・稟議など", "sig")}
        ${tempTile("顧客からの質問", t.custQuestions, "多いほど関心が高い", "q")}
        ${tempTile("懸念のことば", t.negative, "", t.negative ? "neg" : "")}
      </div>`;
    // 商談中に温度をどれだけ動かせたか
    if (t.curve && t.curve.length >= 2) {
      const riseTxt = (t.rise > 0 ? "+" : "") + t.rise;
      const swingNote = t.swing >= 40 ? "会話の中で相手の反応を大きく動かせています"
        : t.swing >= 20 ? "ある程度、相手の反応を動かせています"
        : "終始おだやかで、反応の変化は小さめです";
      html += `<div class="temp-qhead">商談中の温度の動き</div>
        <div class="temp-move">
          ${tempCurveSvg(t.curve)}
          <div class="temp-move-nums">
            <div class="temp-move-n"><b class="${t.rise > 0 ? "is-up" : t.rise < 0 ? "is-down" : ""}">${escapeHtml(riseTxt)}</b><span>引き上げ幅<em>開始→終了</em></span></div>
            <div class="temp-move-n"><b>${t.swing}</b><span>振れ幅<em>最高−最低</em></span></div>
          </div>
        </div>
        <div class="temp-move-note">${escapeHtml(swingNote)}</div>`;
    }
    if (t.quotesPos.length) {
      html += `<div class="temp-qhead">引き出せた前向きな発言</div><div class="temp-quotes">` +
        t.quotesPos.map((q) => `<div class="temp-q"><span class="temp-q-who">${escapeHtml(q.who)}</span>${escapeHtml(q.text.length > 90 ? q.text.slice(0, 90) + "…" : q.text)}${q.words.length ? `<span class="temp-q-w">${q.words.map((w) => escapeHtml(w)).join(" / ")}</span>` : ""}</div>`).join("") +
        `</div>`;
    }
    if (t.quotesNeg.length) {
      html += `<div class="temp-qhead">気になる発言</div><div class="temp-quotes">` +
        t.quotesNeg.map((q) => `<div class="temp-q is-neg"><span class="temp-q-who">${escapeHtml(q.who)}</span>${escapeHtml(q.text.length > 90 ? q.text.slice(0, 90) + "…" : q.text)}${q.words.length ? `<span class="temp-q-w">${q.words.map((w) => escapeHtml(w)).join(" / ")}</span>` : ""}</div>`).join("") +
        `</div>`;
    }
    if (!t.known) {
      html += `<div class="temp-warn">営業担当が特定できないため、全員の発言をお客様として計算しています。上の「営業担当」を設定すると精度が上がります。</div>`;
    }
    html += `</div>`;
  }

  // ---- 営業の進め方 ----
  const rep0 = m.speakers.find((s) => s.isRep);
  if (t.next || t.filler) {
    const nx = t.next || {};
    const fl = t.filler || {};
    const stone = t.skill >= 70 ? "hot" : t.skill >= 45 ? "warm" : "cool";
    const nextTone = nx.level === "スムーズに設定" ? "pos"
      : nx.level === "設定できた（やり取り多め）" ? "sig"
      : nx.talked ? "" : "neg";
    const fillTxt = !fl.repChars ? "—" : fl.count === 0 ? "0" : String(fl.count);
    const fillTone = !fl.repChars ? "" : fl.count === 0 ? "pos" : fl.per100 <= 1.0 ? "pos" : fl.per100 <= 2.0 ? "" : "neg";
    html += `<div class="temp-box is-${stone}">
      <div class="temp-head">
        <div class="temp-score">${ringSvg(t.skill)}<span>/100</span></div>
        <div class="temp-meta">
          <div class="temp-label">営業の進め方</div>
          <div class="temp-note">次回設定・つなぎ言葉・話す割合・質問数からの目安です</div>
        </div>
      </div>
      <div class="temp-gauge"><span style="width:${t.skill}%"></span></div>
      <div class="temp-tiles">
        ${tempTile("次回商談の設定", escapeHtml(nx.level || "—"), "", nextTone)}
        ${tempTile("つなぎ言葉", fl.repChars ? `${fl.count}回` : "—", fl.repChars ? `100文字あたり ${fl.per100}回<br>${escapeHtml(fl.rating)}` : "", fillTone)}
        ${tempTile("自社トーク割合", (rep0 ? rep0.ratio : 100 - (t.custRatio || 0)) + "%", "目安 40〜55%", "")}
        ${tempTile("自社からの質問", t.repQuestions || 0, "深掘りの回数", "q")}
      </div>`;
    // つなぎ言葉の内訳
    html += `<div class="temp-qhead">つなぎ言葉の内訳（自社の発話 ${fl.repChars || 0}文字が対象）</div>`;
    if (fl.breakdown && fl.breakdown.length) {
      html += `<div class="temp-chips">` +
        fl.breakdown.map((b) => `<span class="temp-chip">${escapeHtml(b.w)}<b>${b.n}</b></span>`).join("") +
        `</div>`;
      if (fl.examples && fl.examples.length) {
        html += `<div class="temp-quotes" style="margin-top:8px">` +
          fl.examples.map((e) => `<div class="temp-q is-neg">${escapeHtml(e)}</div>`).join("") + `</div>`;
      }
    } else if (fl.repChars) {
      html += `<div class="temp-warn">つなぎ言葉は1つも見つかりませんでした。実際に少なかった可能性と、文字起こしが「えーと」などを省いている可能性があります。この商談ではフィラーの評価はあてになりません。</div>`;
    } else {
      html += `<div class="temp-warn">自社の発話が特定できませんでした。上の「営業担当」を設定すると計算できます。</div>`;
    }
    if (nx.quote) {
      html += `<div class="temp-qhead">次回商談を決めたところ</div>
        <div class="temp-quotes"><div class="temp-q">${escapeHtml(nx.quote)}</div></div>`;
    }
    html += `</div>`;
  }

  // ---- 話した割合・質問数 ----
  const rep = m.speakers.find((s) => s.isRep);
  if (rep) {
    const judge = rep.ratio <= 50 ? "良い（相手に話させている）" : "自社が話しすぎ気味";
    html += `<p class="metric-note">自社トーク割合：<b>${rep.ratio}%</b>（目安40〜50%。${judge}）</p>`;
  }
  html += '<div class="bars">';
  for (const s of m.speakers) {
    html += `<div class="bar-row"><span class="bar-name">${escapeHtml(s.name)}${s.isRep ? "（自社）" : ""}</span><span class="bar-track"><span class="bar-fill${s.isRep ? " rep" : ""}" style="width:${s.ratio}%"></span></span><span class="bar-val">${s.ratio}%</span></div>`;
  }
  html += "</div>";
  const repQ = rep ? rep.questions : m.speakers.reduce((a, s) => a + s.questions, 0);
  html += `<p class="metric-note">自社からの質問：<b>${repQ}</b>回　／　お客様からの質問：<b>${t.custQuestions}</b>回　／　発話ターン合計：<b>${m.speakers.reduce((a, s) => a + s.turns, 0)}</b></p>`;
  el.innerHTML = html;
  // スコアの数字を数え上げる
  if (window.kbCountUp) {
    el.querySelectorAll(".temp-score b, .temp-ring b").forEach((b) => window.kbCountUp(b, Number(b.textContent), 800));
    el.querySelectorAll(".temp-tile-v").forEach((b) => {
      const v = Number(String(b.textContent).replace(/[^\d-]/g, ""));
      if (isFinite(v) && String(b.textContent).trim() === String(v)) window.kbCountUp(b, v, 600);
    });
  }
}

function renderAiInto(el, a) {
  if (!a || (!a.scores && !a.bant && !a.needs)) {
    el.innerHTML = '<div class="empty-state">「分析を生成」を押すと、スコア・BANT・購買シグナル等を作成します。</div>';
    return;
  }
  let html = "";
  const sc = a.scores || {};
  const dims = [["hearing", "ヒアリング"], ["proposal", "提案"], ["closing", "クロージング"], ["listening", "傾聴"]];
  html += '<div class="scores">';
  const reasons = a.score_reasons || {};
  for (const [k, jp] of dims) {
    const v = Number(sc[k]) || 0;
    html += `<div class="score-row"><span class="score-name">${jp}</span><span class="dots">${[1, 2, 3, 4, 5].map((n) => `<span class="dot${n <= v ? " on" : ""}"></span>`).join("")}</span><span class="score-val">${v}/5</span></div>`;
    if (reasons[k]) html += `<div class="score-reason">${escapeHtml(reasons[k])}</div>`;
  }
  html += "</div>";
  const b = a.bant || {};
  if (b.budget || b.authority || b.need || b.timeline) {
    html += '<div class="sgroup"><div class="label">BANT</div><table class="bant">';
    html += `<tr><td>予算</td><td>${escapeHtml(b.budget || "未確認")}</td></tr>`;
    html += `<tr><td>決裁者</td><td>${escapeHtml(b.authority || "未確認")}</td></tr>`;
    html += `<tr><td>必要性</td><td>${escapeHtml(b.need || "未確認")}</td></tr>`;
    html += `<tr><td>時期</td><td>${escapeHtml(b.timeline || "未確認")}</td></tr>`;
    html += "</table></div>";
  }
  if (a.next_step) html += `<div class="sgroup"><div class="label">次アクションの明確さ</div><p>${escapeHtml(a.next_step)}</p></div>`;
  html += group("把握した課題・ニーズ", a.needs);
  html += group("購買シグナル", a.buying_signals);
  html += group("懸念と対応", a.objections);
  html += group("競合の言及", a.competitors);
  html += group("話し方の癖・口癖", a.rep_habits);
  html += group("顧客の反応", a.customer_reactions);
  html += group("コーチング", a.coaching);
  el.innerHTML = html;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

loadList().then(() => {
  // 分析タブなどから ?id=botId で来たら、その商談を自動で開く
  const id = new URLSearchParams(location.search).get("id");
  if (id) loadDetail(id);
});


// プロダクトタブ（全体 / DOC / MOCHICA）
(async function () {
  if (!window.kbProduct) return;
  await window.kbProduct.loadMap();
  window.kbProduct.mount(() => { try { renderList(); } catch {} });
})();

// ───────── 録音から商談を取り込む（Recallに録音はあるが履歴に出ていないもの）─────────
(function () {
  const btn = document.getElementById("importRecBtn");
  const box = document.getElementById("importRecLog");
  if (!btn || !box) return;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    box.hidden = false;
    box.className = "imp-log";
    box.innerHTML = `<div class="imp-head">取り込みを始めます…</div><div class="imp-list"></div>`;
    const head = box.querySelector(".imp-head");
    const list = box.querySelector(".imp-list");
    let 成功 = 0, 失敗 = 0;
    const 追記 = (r) => {
      const ok = /取り込みました/.test(r.状態);
      const skip = /取り込み済み/.test(r.状態);
      if (ok) 成功++; else if (!skip) 失敗++;
      const li = document.createElement("div");
      li.className = "imp-row " + (ok ? "ok" : skip ? "skip" : "ng");
      li.innerHTML = `<span class="imp-mark">${ok ? "✓" : skip ? "－" : "×"}</span>` +
        `<span class="imp-name">${esc(r.商談名 || r.botId || "")}</span>` +
        `<span class="imp-st">${esc(r.状態 || "")}${r.方法 ? `（${esc(r.方法)}）` : ""}${r.補足 ? `／${esc(r.補足)}` : ""}</span>`;
      list.appendChild(li); list.scrollTop = list.scrollHeight;
    };
    try {
      for (let round = 0; round < 15; round++) {
        head.textContent = `取り込み中… 完了 ${成功}件${失敗 ? `／できなかったもの ${失敗}件` : ""}`;
        const res = await fetch("/api/meetings/import-from-recall", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ hours: 48, max: 2, skipTranscribe: true }),
        });
        const d = await res.json();
        if (d.error) throw new Error(d.error);
        const rs = d.結果 || [];
        rs.forEach(追記);
        if (!rs.length || !rs.some((r) => /取り込みました/.test(r.状態))) break;
      }
      head.textContent = `終わりました：完了 ${成功}件${失敗 ? `／できなかったもの ${失敗}件` : ""}。一覧を更新します。`;
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      head.textContent = "できませんでした：" + e.message;
    } finally { btn.disabled = false; }
  });
})();
