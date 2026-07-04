const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function todayStr() { return new Date().toISOString().slice(0, 10); }

// ===== タブ切替 =====
(function () {
  document.querySelectorAll("#repTabs .rep-tab").forEach((b) => {
    b.addEventListener("click", () => {
      const rp = b.dataset.rp;
      document.querySelectorAll("#repTabs .rep-tab").forEach((t) => t.classList.toggle("active", t === b));
      document.querySelectorAll("[data-rpanel]").forEach((p) => (p.hidden = p.dataset.rpanel !== rp));
      if (rp === "funnel") loadFunnel();
      if (rp === "kind") loadKind();
      if (rp === "daily") loadDaily();
      if (rp === "pipeline") loadPipeline();
    });
  });
})();

// ===== 担当者リストの取得（プルダウン用） =====
let ownersCache = null;
async function loadOwners() {
  if (ownersCache) return ownersCache;
  try {
    const ms = await (await fetch("/api/meetings")).json();
    const set = new Map();
    for (const m of ms) {
      const name = m.owner_name || m.owner;
      if (name) set.set(m.owner || name, name);
    }
    ownersCache = [...set.entries()].map(([email, name]) => ({ email, name }));
  } catch { ownersCache = []; }
  return ownersCache;
}
async function fillOwnerSelects() {
  const owners = await loadOwners();
  const og = $("fnOwnerGroup");
  if (og) og.innerHTML = owners.map((o) => `<option value="owner:${esc(o.email)}">${esc(o.name)}</option>`).join("");
  for (const sel of [$("dlOwner"), $("plOwner")]) {
    if (!sel) continue;
    const first = sel.querySelector("option");
    sel.innerHTML = (first ? first.outerHTML : "") + owners.map((o) => `<option value="${esc(o.email)}">${esc(o.name)}</option>`).join("");
  }
}

// scope値（all / team:X / owner:Y）を owner/team パラメータに変換
function scopeParams(v) {
  if (!v || v === "all") return {};
  if (v.startsWith("team:")) return { team: v.slice(5) };
  if (v.startsWith("owner:")) return { owner: v.slice(6) };
  return {};
}

// ===== サマリー（ファネル） =====
async function loadFunnel() {
  const body = $("funnelBody");
  if (!$("fnBasis").value) $("fnBasis").value = todayStr();
  body.innerHTML = '<div class="empty-state">集計中…</div>';
  const gran = $("fnGran").value;
  const basis = $("fnBasis").value;
  const sp = scopeParams($("fnScope").value);
  const q = new URLSearchParams({ granularity: gran, basis });
  if (sp.owner) q.set("owner", sp.owner);
  if (sp.team) q.set("team", sp.team);
  try {
    const d = await (await fetch("/api/report/funnel?" + q.toString())).json();
    renderFunnel(body, d);
  } catch {
    body.innerHTML = '<div class="empty-state">集計に失敗しました。</div>';
  }
}
// ファネルの1本のバー
function renderFunnel(body, d) {
  const o = d.overall || {};
  const base = o.first_meetings || 0;
  const pctOf = (v, dn) => (dn ? Math.round((v / dn) * 1000) / 10 : 0);
  const wOf = (v, dn) => (dn ? Math.max(2, Math.round((v / dn) * 100)) : 2);
  const period = d.granularity === "day" ? "日次" : d.granularity === "week" ? "週次" : "月次";

  // 絞り込みの内訳1段（バー＋数値＋%）
  const subRow = (label, value, denom, indentLevel) => {
    const pct = pctOf(value, denom);
    return `<div class="fn3-sub" style="padding-left:${indentLevel * 16}px">
      <div class="fn3-sub-head"><span class="fn3-sub-label">${esc(label)}</span><span class="fn3-sub-val">${value} <span class="fn3-sub-pct">${pct}%</span></span></div>
      <div class="fn3-track"><div class="fn3-fill" style="width:${wOf(value, denom)}%"></div></div>
    </div>`;
  };

  let html = '<div class="rep-card">';
  html += `<div class="rep-title">サマリー（${period}・${esc(d.from)}〜${esc(d.to)}）</div>`;
  html += '<div class="fn3-grid">';

  // 左：初回商談を大きく最上部に、そこから内訳を縦線でつなぐ
  html += '<div class="fn3-left">';
  html += '<div class="fn3-sub-label" style="margin-bottom:12px;">商談の絞り込み</div>';
  html += `<div class="fn3-hero"><span class="fn3-hero-num">${o.first_meetings || 0}</span><span class="fn3-hero-label">初回商談</span></div>`;
  html += `<div class="fn3-hero-track"><div class="fn3-hero-fill"></div></div>`;
  html += '<div class="fn3-branch">';
  html += subRow("明確な時期回答", o.clear_schedule, base, 1);
  html += subRow("今月申込可否", o.this_month, o.clear_schedule || 0, 2);
  html += subRow("来月申込可否", o.next_month, o.clear_schedule || 0, 2);
  html += "</div></div>";

  // 右：結果（メインKPIコンパクト＋失注・受注）
  html += '<div class="fn3-right">';
  html += `<div class="fn3-kpi">
    <div class="fn3-kpi-head"><span class="fn3-kpi-label">再商談実施数</span><span class="fn3-kpi-badge">メインKPI</span></div>
    <div class="fn3-kpi-num">${o.re_meetings || 0}<span class="fn3-kpi-pct">${pctOf(o.re_meetings, base)}%</span></div>
  </div>`;
  html += '<div class="fn3-cells">';
  html += `<div class="fn3-cell"><div class="fn3-cell-label fn3-cell-label-lost">失注</div><div class="fn3-cell-row"><span class="fn3-cell-num fn3-cell-num-lost">${o.lost || 0}</span><span class="fn3-cell-pct fn3-cell-pct-lost">${pctOf(o.lost, base)}%</span></div></div>`;
  html += `<div class="fn3-cell"><div class="fn3-cell-label">受注</div><div class="fn3-cell-row"><span class="fn3-cell-num">${o.won || 0}</span><span class="fn3-cell-pct">${pctOf(o.won, base)}%</span></div></div>`;
  html += "</div></div>";

  html += "</div></div>";

  // 担当者別テーブル（全体/チーム選択時）
  const scope = $("fnScope").value;
  if ((scope === "all" || scope.startsWith("team:")) && (d.byOwner || []).length) {
    html += '<div class="rep-card"><div class="rep-title">担当者別</div><div class="rep-table-wrap"><table class="rep-table">';
    html += "<tr><th>担当者</th><th>初回</th><th>明確</th><th>今月</th><th>来月</th><th>失注</th><th class='kpi-col'>再商談実施</th><th>受注</th></tr>";
    for (const r of d.byOwner) {
      html += `<tr><td class="rep-name-cell">${esc(r.owner)}</td><td>${r.first_meetings}</td><td>${r.clear_schedule}</td><td>${r.this_month}</td><td>${r.next_month}</td><td>${r.lost}</td><td class="kpi-col"><b>${r.re_meetings}</b></td><td>${r.won}</td></tr>`;
    }
    html += "</table></div></div>";
  }

  body.innerHTML = html;
}

// ===== 商談種別（コールド / 過去失注 / 通常）=====
async function loadKind() {
  const body = $("kindBody");
  if (!$("knBasis").value) $("knBasis").value = todayStr();
  body.innerHTML = '<div class="empty-state">集計中…</div>';
  const q = new URLSearchParams({ granularity: $("knGran").value, basis: $("knBasis").value });
  try {
    const d = await (await fetch("/api/report/funnel?" + q.toString())).json();
    renderKind(body, d);
  } catch {
    body.innerHTML = '<div class="empty-state">集計に失敗しました。</div>';
  }
}
function kindBadgeEl(k) {
  const cls = k === "過去失注" ? "kind-lost" : k === "コールド" ? "kind-cold" : "kind-normal";
  return `<span class="kind-badge ${cls}">${esc(k)}</span>`;
}
function renderKind(body, d) {
  const period = d.granularity === "day" ? "日次" : d.granularity === "week" ? "週次" : "月次";
  const byKind = d.byKind || [];
  // コールド・過去失注を中心に見せる（通常も参考表示）
  const focus = ["コールド", "過去失注"];
  let html = `<div class="rep-card"><div class="rep-title">商談種別の内訳（${period}・${esc(d.from)}〜${esc(d.to)}）</div>`;

  if (!byKind.length) {
    html += '<div class="empty-state">この期間の抽出データがありません。</div></div>';
    body.innerHTML = html;
    return;
  }

  // 種別ごとのカード（コールド・過去失注を大きく、通常は下に）
  html += '<div class="kind-cards">';
  for (const k of ["コールド", "過去失注", "通常"]) {
    const r = byKind.find((x) => x.kind === k);
    if (!r) continue;
    const rate = r.first_meetings ? Math.round((r.re_meetings / r.first_meetings) * 1000) / 10 : 0;
    const emphasis = focus.includes(k) ? " kind-card-focus" : "";
    html += `<div class="kind-card${emphasis}">
      <div class="kind-card-head">${kindBadgeEl(k)}</div>
      <div class="kind-card-main"><span class="kind-card-kpi">${r.re_meetings}</span><span class="kind-card-kpi-label">再商談実施</span></div>
      <div class="kind-card-sub">初回 ${r.first_meetings} ・ 転換率 ${rate}%</div>
      <div class="kind-card-row"><span>失注</span><span>${r.lost}</span></div>
      <div class="kind-card-row"><span>受注</span><span>${r.won}</span></div>
    </div>`;
  }
  html += "</div></div>";

  // 種別×担当者/チーム：チーム別の種別内訳
  if ((d.byTeam || []).length) {
    html += '<div class="rep-card"><div class="rep-title">チーム別 × 種別</div>';
    for (const t of d.byTeam) {
      // このチームの種別内訳のうち、コールド・過去失注を優先表示
      const kinds = (t.kinds || []).slice().sort((a, b) => {
        const ord = { "過去失注": 0, "コールド": 1, "通常": 2 };
        return (ord[a.kind] ?? 9) - (ord[b.kind] ?? 9);
      });
      html += `<div class="team-block"><div class="team-head"><span class="team-name">${esc(t.team)}</span>` +
        `<span class="team-kpi">再商談実施 <b>${t.re_meetings}</b> ・ 初回 ${t.first_meetings}</span></div>`;
      if (kinds.length) {
        html += '<div class="rep-table-wrap"><table class="rep-table team-kind-table">';
        html += "<tr><th>種別</th><th>初回</th><th>失注</th><th class='kpi-col'>再商談実施</th><th>受注</th></tr>";
        for (const r of kinds) {
          html += `<tr><td>${kindBadgeEl(r.kind)}</td><td>${r.first_meetings}</td><td>${r.lost}</td><td class="kpi-col"><b>${r.re_meetings}</b></td><td>${r.won}</td></tr>`;
        }
        html += "</table></div>";
      } else {
        html += '<div class="empty-state">この期間のデータはありません。</div>';
      }
      html += "</div>";
    }
    html += "</div>";
  }

  body.innerHTML = html;
}

// ===== 日次データ確認 =====
async function loadDaily() {
  const body = $("dailyBody");
  if (!$("dlDate").value) $("dlDate").value = todayStr();
  body.innerHTML = '<div class="empty-state">読み込み中…</div>';
  const q = new URLSearchParams({ date: $("dlDate").value });
  if ($("dlOwner").value) q.set("owner", $("dlOwner").value);
  try {
    const d = await (await fetch("/api/report/daily?" + q.toString())).json();
    renderDaily(body, d);
  } catch {
    body.innerHTML = '<div class="empty-state">読み込みに失敗しました。</div>';
  }
}
function kindSummary(r) {
  if (r.meeting_kind === "判定不能") return "判定不能";
  if (r.meeting_kind === "再商談") return `再商談・${esc(r.result || "未確定")}`;
  const sc = r.schedule_choice || "不明";
  const at = r.apply_timing || "不明";
  return `${esc(sc)}・${esc(at)}判断`;
}
function renderDaily(body, d) {
  const rows = d.rows || [];
  let html = `<div class="rep-card"><div class="rep-title">${esc(d.date)} の商談（${rows.length}件）</div>`;
  if (!rows.length) { html += '<div class="empty-state">この日の商談はありません。</div></div>'; body.innerHTML = html; return; }
  html += '<div class="rep-table-wrap"><table class="rep-table daily-table">';
  html += "<tr><th>企業名</th><th>担当</th><th>抽出結果</th><th>確認</th></tr>";
  for (const r of rows) {
    const mark = r.needs_review
      ? `<button class="rev-flag" data-id="${r.id}" title="要確認：クリックで修正">⚠️</button>`
      : '<span class="rev-ok">✓</span>';
    html += `<tr><td>${esc(r.company_name || "(不明)")}</td><td>${esc(r.owner || "")}</td><td>${kindSummary(r)}</td><td class="rev-cell">${mark}</td></tr>`;
  }
  html += "</table></div></div>";
  body.innerHTML = html;
  // 要確認フラグに修正モーダルを紐付け
  body.querySelectorAll(".rev-flag").forEach((b) => {
    b.addEventListener("click", () => openReviewModal(rows.find((x) => String(x.id) === b.dataset.id)));
  });
}

// ===== 要確認レコードの修正モーダル =====
function openReviewModal(row) {
  if (!row) return;
  const form = $("revForm");
  const opt = (arr, cur) => arr.map((v) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(v)}</option>`).join("");
  form.innerHTML =
    `<input type="hidden" id="revId" value="${row.id}" />
     <div class="rev-field"><label>企業名</label><div class="rev-ro">${esc(row.company_name || "")}</div></div>
     <div class="rev-field"><label>商談種別</label><select id="revKind">${opt(["初回商談", "再商談", "判定不能"], row.meeting_kind)}</select></div>
     <div class="rev-field"><label>ご利用開始スケジュール</label><select id="revSchedule">${opt(["来月開始", "再来月開始", "その他明確な時期", "未定", "不明"], row.schedule_choice || "不明")}</select></div>
     <div class="rev-field"><label>今月中の申込可否</label><select id="revApply">${opt(["今月", "来月", "それ以外", "該当なし", "不明"], row.apply_timing || "不明")}</select></div>
     <div class="rev-field"><label>再商談の結果（再商談のみ）</label><select id="revResult">${opt(["", "受注", "失注", "延期", "未確定"], row.result || "")}</select></div>
     <p class="rev-note">修正して保存すると、要確認フラグは外れます。判断月などの再計算はサーバー側で行われます。</p>`;
  $("revModal").hidden = false;
  $("revStatus").textContent = "";
}
(function () {
  const cancel = $("revCancel");
  if (cancel) cancel.addEventListener("click", () => ($("revModal").hidden = true));
  const save = $("revSave");
  if (save) save.addEventListener("click", async () => {
    const id = $("revId").value;
    const patch = {
      meeting_kind: $("revKind").value,
      schedule_choice: $("revSchedule").value,
      apply_timing: $("revApply").value,
      result: $("revResult").value,
      needs_review: false,
    };
    $("revStatus").textContent = "保存中…";
    try {
      const r = await fetch(`/api/deal-events/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
      if (!r.ok) throw new Error("保存に失敗");
      $("revStatus").textContent = "保存しました";
      setTimeout(() => { $("revModal").hidden = true; loadDaily(); }, 600);
    } catch (e) { $("revStatus").textContent = "失敗: " + e.message; }
  });
})();

// ===== パイプライン =====
async function loadPipeline() {
  const body = $("pipelineBody");
  if (!$("plDate").value) $("plDate").value = todayStr();
  body.innerHTML = '<div class="empty-state">集計中…</div>';
  const q = new URLSearchParams({ date: $("plDate").value });
  if ($("plOwner").value) q.set("owner", $("plOwner").value);
  try {
    const [d, trend] = await Promise.all([
      (await fetch("/api/report/pipeline?" + q.toString())).json(),
      (await fetch("/api/report/pipeline-trend?" + new URLSearchParams({ weeks: 8, ...(($("plOwner").value) ? { owner: $("plOwner").value } : {}) }).toString())).json(),
    ]);
    renderPipeline(body, d, trend);
  } catch {
    body.innerHTML = '<div class="empty-state">集計に失敗しました。</div>';
  }
}
function renderPipeline(body, d, trend) {
  const mx = d.matrix || { thisMonth: { unset: 0, waiting: 0 }, nextMonth: { unset: 0, waiting: 0 } };
  let html = `<div class="rep-card"><div class="rep-title">パイプライン（${esc(d.as_of)} 時点）</div>`;
  html += '<table class="pipe-matrix"><tr><th></th><th>今月判断</th><th>来月判断</th></tr>';
  html += `<tr><th class="pipe-rowh">未設定<span class="pipe-sub">再商談の日程なし</span></th>
    <td><button class="pipe-cell pipe-unset" data-col="thisMonth">${mx.thisMonth.unset}</button></td>
    <td><button class="pipe-cell pipe-unset" data-col="nextMonth">${mx.nextMonth.unset}</button></td></tr>`;
  html += `<tr><th class="pipe-rowh">設定済み・実施待ち</th>
    <td><span class="pipe-cell">${mx.thisMonth.waiting}</span></td>
    <td><span class="pipe-cell">${mx.nextMonth.waiting}</span></td></tr>`;
  html += "</table>";
  html += '<div id="unsetList" class="unset-list"></div>';
  html += "</div>";

  // 未設定件数の週次推移（SVG折れ線）
  html += `<div class="rep-card"><div class="rep-title">「未設定」件数の週次推移</div>${sparkline(trend.points || [])}</div>`;
  body.innerHTML = html;

  // 未設定セルのドリルダウン
  const lists = d.unset_list || { thisMonth: [], nextMonth: [] };
  body.querySelectorAll(".pipe-unset").forEach((b) => {
    b.addEventListener("click", () => {
      const col = b.dataset.col;
      const arr = lists[col] || [];
      const host = $("unsetList");
      if (!arr.length) { host.innerHTML = '<div class="empty-state">対象の案件はありません。</div>'; return; }
      host.innerHTML = `<div class="unset-head">${col === "thisMonth" ? "今月判断" : "来月判断"}・未設定の案件（${arr.length}件）</div>` +
        arr.map((x) => `<div class="unset-row"><span class="unset-name">${esc(x.company_name || "(不明)")}</span><span class="unset-meta">${esc(x.owner || "")} ・ 初回 ${esc(x.first_meeting_date || "")}</span></div>`).join("");
    });
  });
}

// SVGスパークライン（折れ線）。外部ライブラリ非依存。
function sparkline(points) {
  if (!points.length) return '<div class="empty-state">データがありません。</div>';
  const W = 640, H = 160, pad = 28;
  const xs = points.map((_, i) => pad + (i * (W - pad * 2)) / Math.max(1, points.length - 1));
  const maxV = Math.max(1, ...points.map((p) => p.unset));
  const ys = points.map((p) => H - pad - (p.unset / maxV) * (H - pad * 2));
  const path = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const dots = xs.map((x, i) => `<circle cx="${x.toFixed(1)}" cy="${ys[i].toFixed(1)}" r="3.5" fill="#0F6E56" />`).join("");
  const labels = points.map((p, i) => `<text x="${xs[i].toFixed(1)}" y="${H - 8}" font-size="10" fill="#8a938d" text-anchor="middle">${esc(p.date.slice(5))}</text>`).join("");
  const vals = points.map((p, i) => `<text x="${xs[i].toFixed(1)}" y="${(ys[i] - 8).toFixed(1)}" font-size="10" fill="#445" text-anchor="middle">${p.unset}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="spark" preserveAspectRatio="xMidYMid meet">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#e6ece9" />
    <path d="${path}" fill="none" stroke="#1D9E75" stroke-width="2.5" />
    ${dots}${vals}${labels}
  </svg>`;
}

// ===== 初期化 =====
(async function () {
  await fillOwnerSelects();
  $("fnBasis").value = todayStr();
  $("dlDate").value = todayStr();
  $("plDate").value = todayStr();
  $("fnApply").addEventListener("click", loadFunnel);
  $("dlApply").addEventListener("click", loadDaily);
  $("plApply").addEventListener("click", loadPipeline);
  const knApply = $("knApply");
  if (knApply) knApply.addEventListener("click", loadKind);
  loadFunnel();
})();
