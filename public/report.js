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
      if (rp === "interns") loadInternDash();
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
  // チーム選択肢は「チーム編集」に実際に登録されているチーム名から動的に生成
  // （固定の選択肢だとチーム名の表記がずれて0件になるため、必ずここから作る）
  const tg = $("fnTeamGroup");
  if (tg) {
    try {
      const teams = await (await fetch("/api/teams")).json();
      const names = [...new Set((teams || []).map((t) => t.team_name).filter(Boolean))].sort();
      tg.innerHTML = names.map((n) => `<option value="team:${esc(n)}">チーム：${esc(n)}</option>`).join("");
    } catch { tg.innerHTML = ""; }
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

  let html = '<div class="fn4-wrap">';

  // ヘッダー
  html += `<div class="fn4-head">
    <div class="fn4-head-left"><span class="fn4-head-icon"><i class="ti ti-chart-bar" aria-hidden="true"></i></span><span class="fn4-head-title">サマリー</span></div>
    <span class="fn4-head-period">${period}・${esc(d.from)}〜${esc(d.to)}</span>
  </div>`;

  // ヒーロー：件数を主役に（初回 → 再商談）。転換率は添え字。
  const convPct = pctOf(o.re_meetings, base);
  html += '<div class="sm-top">';
  html += `<div class="sm-hero">
    <div class="sm-hero-counts">
      <div class="sm-hc">
        <div class="sm-hc-label">初回商談</div>
        <div class="sm-hc-num">${o.first_meetings || 0}</div>
      </div>
      <div class="sm-hc-arrow">→</div>
      <div class="sm-hc">
        <div class="sm-hc-label">再商談実施</div>
        <div class="sm-hc-num sm-hc-num-key">${o.re_meetings || 0}</div>
      </div>
      <div class="sm-hero-conv">
        <div class="sm-hero-conv-num">${convPct}<span class="sm-hero-conv-pct">%</span></div>
        <div class="sm-hero-conv-label">転換率</div>
      </div>
    </div>
    <div class="sm-hero-rail"><div class="sm-hero-fill" style="width:${Math.min(100, convPct)}%"></div></div>
  </div>`;
  html += '<div class="sm-side">';
  html += `<div class="sm-stat"><span class="sm-stat-label">失注</span><span class="sm-stat-num sm-lost">${o.lost || 0}</span><span class="sm-stat-pct">${pctOf(o.lost, base)}%</span></div>`;
  html += `<div class="sm-stat"><span class="sm-stat-label">受注</span><span class="sm-stat-num">${o.won || 0}</span><span class="sm-stat-pct">${pctOf(o.won, base)}%</span></div>`;
  html += `<div class="sm-stat"><span class="sm-stat-label">猶予中</span><span class="sm-stat-num sm-pending">${o.pending_10day || 0}</span><span class="sm-stat-pct">10日</span></div>`;
  html += "</div></div>";

  // 商談の流れ（段の間に離脱数を出す）
  const stage = (label, value, w, cls) =>
    `<div class="sm-stage">
      <span class="sm-stage-label">${esc(label)}</span>
      <div class="sm-stage-track"><div class="sm-stage-fill ${cls}" style="width:${w}%"></div></div>
      <span class="sm-stage-num">${value}</span>
    </div>`;
  const drop = (n, text) =>
    n > 0
      ? `<div class="sm-drop"><span class="sm-drop-arrow">↓</span><span class="sm-drop-num">−${n}</span><span class="sm-drop-text">${esc(text)}</span></div>`
      : `<div class="sm-drop"><span class="sm-drop-arrow">↓</span><span class="sm-drop-text">${esc(text)}</span></div>`;

  const nFirst = o.first_meetings || 0, nRe = o.re_meetings || 0, nWon = o.won || 0;
  html += '<div class="fn4-card"><div class="fn4-card-head"><span class="fn4-card-title">商談の流れ</span><span class="fn4-card-note">段の間は離脱数</span></div><div class="sm-flow">';
  html += stage("初回商談", nFirst, 100, "sm-fc-first");
  html += drop(Math.max(0, nFirst - nRe), `再商談に至らず（${pctOf(Math.max(0, nFirst - nRe), base)}%が離脱）`);
  html += stage("再商談実施", nRe, wOf(nRe, base), "sm-fc-re");
  html += drop(Math.max(0, nRe - nWon), "受注に至らず");
  html += stage("受注", nWon, wOf(nWon, base), "sm-fc-won");
  html += "</div></div>";

  // 担当者別（転換率の高い順）
  const scope = $("fnScope").value;
  if ((scope === "all" || scope.startsWith("team:")) && (d.byOwner || []).length) {
    const rows = d.byOwner
      .map((r) => ({ ...r, conv: (r.first_meetings || 0) > 0 ? ((r.re_meetings || 0) / r.first_meetings) * 100 : 0 }))
      .sort((a, b) => b.conv - a.conv || (b.re_meetings || 0) - (a.re_meetings || 0));
    const topConv = rows.length ? rows[0].conv : 0;
    html += '<div class="fn4-card"><div class="fn4-card-head"><span class="fn4-card-title">担当者別</span><span class="fn4-card-note">行をクリックで内訳</span></div><div class="sm-reps">';
    for (const r of rows) {
      const isTop = r.conv === topConv && r.conv > 0;
      html += `<div class="sm-rep" data-owner="${esc(r.owner)}" role="button" tabindex="0" aria-expanded="false">
        <span class="sm-rep-caret">▸</span>
        <span class="sm-rep-name">${esc(r.owner)}</span>
        <span class="sm-rep-nums"><b>${r.first_meetings || 0}</b><span class="sm-rep-arrow">→</span><b class="${isTop ? "sm-rep-b-top" : ""}">${r.re_meetings || 0}</b></span>
        <div class="sm-rep-track"><div class="sm-rep-fill ${isTop ? "sm-rep-top" : ""}" style="width:${Math.min(100, Math.round(r.conv))}%"></div></div>
        <span class="sm-rep-pct">${r.conv.toFixed(1)}%</span>
      </div>
      <div class="sm-rep-detail" data-detail="${esc(r.owner)}" hidden></div>`;
    }
    html += "</div></div>";
  }

  html += "</div>";
  body.innerHTML = html;

  // 担当者の行をクリック → 内訳（初回・再商談実施・進行中・案件）を展開
  const detailsByOwner = {};
  for (const r of d.byOwner || []) detailsByOwner[r.owner] = r.details || {};
  const groupDefs = [
    { key: "first", label: "初回商談", cls: "sg-first" },
    { key: "re", label: "再商談実施", cls: "sg-re" },
    { key: "activated", label: "進行中", cls: "sg-active" },
    { key: "pending_10day", label: "猶予中", cls: "sg-pending" },
    { key: "won", label: "受注", cls: "sg-won" },
    { key: "lost", label: "失注", cls: "sg-lost" },
    { key: "review", label: "要確認", cls: "sg-review" },
  ];
  const renderDetail = (owner) => {
    const det = detailsByOwner[owner] || {};
    const dealMap = {};
    for (const key of ["first", "re"]) {
      for (const it of det[key] || []) {
        dealMap[it.company] = dealMap[it.company] || { company: it.company, status: it.status, first: 0, re: 0 };
        if (key === "first") dealMap[it.company].first++; else dealMap[it.company].re++;
        if (it.status) dealMap[it.company].status = it.status;
      }
    }
    let h = '<div class="sm-detail-inner">';
    const deals = Object.values(dealMap).sort((a, b) => (b.first + b.re) - (a.first + a.re));
    if (deals.length) {
      h += `<details class="sm-group" open><summary><span class="sm-group-dot sg-deal"></span>案件<span class="sm-group-count">${deals.length}</span></summary><ul class="sm-group-list">`;
      for (const dl of deals) {
        const href = `deals.html?company=${encodeURIComponent(dl.company)}&from=report`;
        h += `<li><a class="sm-item-link" href="${href}"><span class="sm-item-co">${esc(dl.company)}</span><span class="sm-item-meta">初回${dl.first} ・ 再商談${dl.re}${dl.status ? " ・ " + esc(dl.status) : ""}</span><span class="sm-item-arrow">›</span></a></li>`;
      }
      h += "</ul></details>";
    }
    for (const g of groupDefs) {
      const list = det[g.key] || [];
      if (!list.length) continue;
      h += `<details class="sm-group"><summary><span class="sm-group-dot ${g.cls}"></span>${g.label}<span class="sm-group-count">${list.length}</span></summary><ul class="sm-group-list">`;
      for (const it of list) {
        h += `<li><span class="sm-item-co">${esc(it.company)}</span><span class="sm-item-meta">${esc(it.date)}${it.result ? " ・ " + esc(it.result) : ""}</span></li>`;
      }
      h += "</ul></details>";
    }
    if (h === '<div class="sm-detail-inner">') h += '<div class="empty-state">この期間の商談はありません</div>';
    return h + "</div>";
  };
  body.querySelectorAll(".sm-rep").forEach((row) => {
    const toggle = () => {
      const owner = row.dataset.owner;
      const box = body.querySelector(`.sm-rep-detail[data-detail="${CSS.escape(owner)}"]`);
      if (!box) return;
      const open = box.hidden;
      if (open && !box.dataset.filled) { box.innerHTML = renderDetail(owner); box.dataset.filled = "1"; }
      box.hidden = !open;
      row.classList.toggle("open", open);
      row.setAttribute("aria-expanded", String(open));
      const caret = row.querySelector(".sm-rep-caret");
      if (caret) caret.textContent = open ? "▾" : "▸";
    };
    row.addEventListener("click", toggle);
    row.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
  });
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
  const focus = ["コールド", "過去失注"];

  let html = '<div class="fn4-wrap">';
  html += `<div class="fn4-head">
    <div class="fn4-head-left"><span class="fn4-head-icon"><i class="ti ti-tags" aria-hidden="true"></i></span><span class="fn4-head-title">商談種別の内訳</span></div>
    <span class="fn4-head-period">${period}・${esc(d.from)}〜${esc(d.to)}</span>
  </div>`;

  if (!byKind.length) {
    html += '<div class="fn4-card"><div class="empty-state">この期間の抽出データがありません。</div></div></div>';
    body.innerHTML = html;
    return;
  }

  // 種別ごとのカード（コールド・過去失注を大きく、通常は下に）
  html += '<div class="fn4-kpis">';
  for (const k of ["コールド", "過去失注", "通常"]) {
    const r = byKind.find((x) => x.kind === k);
    if (!r) continue;
    const rate = r.first_meetings ? Math.round((r.re_meetings / r.first_meetings) * 1000) / 10 : 0;
    const cls = focus.includes(k) ? "fn4-kpi-card fn4-kpi-main" : "fn4-kpi-card";
    html += `<div class="${cls}">
      <div class="fn4-kpi-head">${kindBadgeEl(k)}</div>
      <div class="fn4-kpi-num">${r.first_meetings}</div>
      <div class="fn4-kpi-numlabel">初回商談実施</div>
      <div class="fn4-kpi-sub">再商談実施${r.re_meetings}・転換率${rate}%</div>
      <div class="fn4-kind-rows"><span>失注 ${r.lost}</span><span>受注 ${r.won}</span></div>
    </div>`;
  }
  html += "</div>";

  // チーム別×種別
  if ((d.byTeam || []).length) {
    html += '<div class="fn4-card"><div class="fn4-card-title">チーム別 × 種別</div><div class="fn4-team-list">';
    for (const t of d.byTeam) {
      const kinds = (t.kinds || []).slice().sort((a, b) => {
        const ord = { "過去失注": 0, "コールド": 1, "通常": 2 };
        return (ord[a.kind] ?? 9) - (ord[b.kind] ?? 9);
      });
      html += `<div class="fn4-team-block"><div class="fn4-team-head"><span class="fn4-team-name">${esc(t.team)}</span>` +
        `<span class="fn4-team-kpi">再商談実施 <b>${t.re_meetings}</b> ・ 初回 ${t.first_meetings}</span></div>`;
      if (kinds.length) {
        html += '<div class="fn4-team-kinds">';
        for (const r of kinds) {
          html += `<div class="fn4-team-kind-row">${kindBadgeEl(r.kind)}<span class="fn4-team-kind-num">初回${r.first_meetings}</span><span class="fn4-team-kind-num">失注${r.lost}</span><span class="fn4-team-kind-num fn4-team-kind-re">実施${r.re_meetings}</span><span class="fn4-team-kind-num">受注${r.won}</span></div>`;
        }
        html += "</div>";
      } else {
        html += '<div class="empty-state">この期間のデータはありません。</div>';
      }
      html += "</div>";
    }
    html += "</div></div>";
  }

  html += "</div>";
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
  let html = '<div class="fn4-wrap">';
  html += `<div class="fn4-head">
    <div class="fn4-head-left"><span class="fn4-head-icon"><i class="ti ti-list-check" aria-hidden="true"></i></span><span class="fn4-head-title">日次データ確認</span></div>
    <span class="fn4-head-period">${esc(d.date)}・${rows.length}件</span>
  </div>`;
  html += '<div class="fn4-card">';
  if (!rows.length) {
    html += '<div class="empty-state">この日の商談はありません。</div></div></div>';
    body.innerHTML = html;
    return;
  }
  html += '<div class="fn4-table-wrap"><table class="fn4-table daily-table">';
  html += "<tr><th>企業名</th><th>担当</th><th>抽出結果</th><th>確認</th></tr>";
  for (const r of rows) {
    const mark = r.needs_review
      ? `<button class="rev-flag" data-id="${r.id}" title="要確認：クリックで修正">⚠️</button>`
      : '<span class="rev-ok">✓</span>';
    html += `<tr><td>${esc(r.company_name || "(不明)")}</td><td>${esc(r.owner || "")}</td><td>${kindSummary(r)}</td><td class="rev-cell">${mark}</td></tr>`;
  }
  html += "</table></div></div></div>";
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
  let html = '<div class="fn4-wrap">';
  html += `<div class="fn4-head">
    <div class="fn4-head-left"><span class="fn4-head-icon"><i class="ti ti-git-branch" aria-hidden="true"></i></span><span class="fn4-head-title">パイプライン</span></div>
    <span class="fn4-head-period">${esc(d.as_of)} 時点</span>
  </div>`;

  html += '<div class="fn4-card"><table class="fn4-pipe-matrix"><tr><th></th><th>今月判断</th><th>来月判断</th></tr>';
  html += `<tr><th class="fn4-pipe-rowh">未設定<span class="fn4-pipe-sub">再商談の日程なし</span></th>
    <td><button class="fn4-pipe-cell fn4-pipe-unset" data-col="thisMonth">${mx.thisMonth.unset}</button></td>
    <td><button class="fn4-pipe-cell fn4-pipe-unset" data-col="nextMonth">${mx.nextMonth.unset}</button></td></tr>`;
  html += `<tr><th class="fn4-pipe-rowh">設定済み・実施待ち</th>
    <td><span class="fn4-pipe-cell">${mx.thisMonth.waiting}</span></td>
    <td><span class="fn4-pipe-cell">${mx.nextMonth.waiting}</span></td></tr>`;
  html += "</table>";
  html += '<div id="unsetList" class="fn4-unset-list"></div>';
  html += "</div>";

  // 未設定件数の週次推移（SVG折れ線）
  html += `<div class="fn4-card"><div class="fn4-card-title">「未設定」件数の週次推移</div>${sparkline(trend.points || [])}</div>`;
  html += "</div>";
  body.innerHTML = html;

  // 未設定セルのドリルダウン
  const lists = d.unset_list || { thisMonth: [], nextMonth: [] };
  body.querySelectorAll(".fn4-pipe-unset").forEach((b) => {
    b.addEventListener("click", () => {
      const col = b.dataset.col;
      const arr = lists[col] || [];
      const host = $("unsetList");
      if (!arr.length) { host.innerHTML = '<div class="empty-state">対象の案件はありません。</div>'; return; }
      host.innerHTML = `<div class="fn4-unset-head">${col === "thisMonth" ? "今月判断" : "来月判断"}・未設定の案件（${arr.length}件）</div>` +
        arr.map((x) => `<div class="fn4-unset-row"><span class="fn4-unset-name">${esc(x.company_name || "(不明)")}</span><span class="fn4-unset-meta">${esc(x.owner || "")} ・ 初回 ${esc(x.first_meeting_date || "")}</span></div>`).join("");
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
  if ($("iaReload")) $("iaReload").addEventListener("click", loadInternDash);
  if ($("iaMatch")) $("iaMatch").addEventListener("click", runInternMatch);
  loadFunnel();
})();

// ===== インターンアポ ダッシュボード =====
function iaDates() {
  const f = $("iaFrom"), t = $("iaTo");
  if (f && !f.value) f.value = todayStr();
  if (t && !t.value) t.value = todayStr();
  return { from: f ? f.value : "", to: t ? t.value : "" };
}
async function loadInternDash() {
  const body = $("internBody");
  if (!body) return;
  const { from, to } = iaDates();
  body.innerHTML = '<div class="empty-state">集計中…</div>';
  try {
    const q = new URLSearchParams({ from, to });
    const d = await (await fetch("/api/interns/stats?" + q.toString())).json();
    renderInternDash(body, d);
  } catch {
    body.innerHTML = '<div class="empty-state">集計に失敗しました。</div>';
  }
}
async function runInternMatch() {
  const st = $("iaStatus");
  const btn = $("iaMatch");
  const { from, to } = iaDates();
  if (st) st.textContent = "カレンダーと照合中…（件数によっては数十秒かかります）";
  if (btn) btn.disabled = true;
  try {
    const r = await fetch("/api/interns/match", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, to }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "照合に失敗しました");
    // 診断：カレンダーが読めているか／主催者の予定が拾えているかを表示する
    if (st) {
      const lines = (d.interns || []).map((p) => {
        if (p.error) return `${p.name}: ⚠ ${p.error}`;
        return `${p.name}: 予定${p.calendar_events ?? 0}件（本人主催${p.hosted_events ?? 0}件）→ 一致${p.count}件`;
      });
      st.innerHTML = `照合しました（一致 ${d.matched}／対象 ${d.meetings_total}）<br><span style="font-size:11px;color:var(--muted)">${lines.join("<br>")}</span>`;
    }
    // 主催者で弾かれた予定がある場合、コンソールに詳細を出す（原因特定用）
    for (const p of d.interns || []) {
      if (p.skipped_samples && p.skipped_samples.length) {
        console.log(`[照合] ${p.name} は本人主催でない予定を除外:`, p.skipped_samples);
      }
    }
    await loadInternDash();
    setTimeout(() => { if (st) st.textContent = ""; }, 2000);
  } catch (e) {
    if (st) st.textContent = "失敗: " + e.message;
  } finally { if (btn) btn.disabled = false; }
}
function renderInternDash(body, d) {
  const rows = d.interns || [];
  if (!d.registered_count && !rows.length) {
    body.innerHTML = '<div class="empty-state">インターン生が未登録です。<a href="settings.html">設定 → インターン登録</a> で名前とメールアドレスを登録してください。</div>';
    return;
  }
  const maxCount = Math.max(1, ...rows.map((r) => r.count || 0));
  let html = '<div class="fn4-wrap">';

  // ヘッダー
  html += `<div class="fn4-head">
    <div class="fn4-head-left"><span class="fn4-head-icon"><i class="ti ti-user-check" aria-hidden="true"></i></span><span class="fn4-head-title">インターンアポ集計</span></div>
    <span class="fn4-head-period">${esc(d.range.from)}〜${esc(d.range.to)}</span>
  </div>`;

  // KPIカード
  html += '<div class="fn4-kpis">';
  html += `<div class="fn4-kpi-card fn4-kpi-main"><div class="fn4-kpi-head"><span class="fn4-kpi-label">アポ実施（合計）</span><span class="fn4-kpi-badge">KPI</span></div><div class="fn4-kpi-num">${d.matched || 0}</div><div class="fn4-kpi-sub">アポ獲得者を特定できた商談</div></div>`;
  html += `<div class="fn4-kpi-card"><div class="fn4-kpi-label">インターン人数</div><div class="fn4-kpi-num">${d.registered_count || 0}</div><div class="fn4-kpi-sub">登録済み</div></div>`;
  html += `<div class="fn4-kpi-card"><div class="fn4-kpi-label">対象商談</div><div class="fn4-kpi-num">${d.meetings_total || 0}</div><div class="fn4-kpi-sub">期間内の実施済み商談</div></div>`;
  html += `<div class="fn4-kpi-card"><div class="fn4-kpi-label">未特定</div><div class="fn4-kpi-num">${d.unmatched || 0}</div><div class="fn4-kpi-sub">カレンダーと一致しなかった商談</div></div>`;
  html += "</div>";

  // インターン別バー
  html += '<div class="fn4-card"><div class="fn4-card-head"><span class="fn4-card-title">インターン別アポ実施数</span><span class="fn4-card-note">実施数</span></div><div class="fn4-reps">';
  if (!rows.length) {
    html += '<div class="empty-state">この期間に一致した商談がありません。「カレンダーと照合」を押してください。</div>';
  } else {
    for (const r of rows) {
      const w = Math.max(3, Math.round(((r.count || 0) / maxCount) * 100));
      const isTop = (r.count || 0) === maxCount && maxCount > 0 && r.count > 0;
      const unreg = r.registered ? "" : '<span class="fn4-card-note">（未登録）</span>';
      html += `<div class="fn4-rep-row">
        <span class="fn4-rep-name">${esc(r.name)} ${unreg}</span>
        <div class="fn4-rep-track"><div class="fn4-rep-fill ${isTop ? "fn4-rep-fill-top" : ""}" style="width:${w}%"></div></div>
        <span class="fn4-rep-meta">${r.count}件</span>
      </div>`;
    }
  }
  html += "</div></div>";

  // 人ごとの内訳（一致した商談リスト）
  const withMeetings = rows.filter((r) => (r.meetings || []).length);
  if (withMeetings.length) {
    html += '<div class="fn4-card"><div class="fn4-card-title">アポ内訳（クリックで展開）</div>';
    for (const r of withMeetings) {
      html += `<details class="ia-details"><summary>${esc(r.name)}　<b>${r.count}件</b></summary>` +
        `<ul class="ia-list">` +
        r.meetings.map((m) => `<li><span class="ia-date">${esc(m.date || "")}</span>${esc(m.title || "(商談名なし)")}</li>`).join("") +
        `</ul></details>`;
    }
    html += "</div>";
  }

  // 未特定の商談
  if ((d.unmatched_list || []).length) {
    html += '<div class="fn4-card"><details class="ia-details"><summary>どのインターンとも一致しなかった商談　<b>' + d.unmatched_list.length + '件</b></summary>' +
      '<ul class="ia-list">' +
      d.unmatched_list.map((m) => `<li><span class="ia-date">${esc(m.date || "")}</span>${esc(m.title || "(商談名なし)")}</li>`).join("") +
      '</ul></details></div>';
  }

  html += "</div>";
  body.innerHTML = html;
}
