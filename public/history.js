// public/history.js
const hlist = document.getElementById("hlist");
const hdetail = document.getElementById("hdetail");

const PHASES = [
  { code: "01", label: "01 初回商談" },
  { code: "02", label: "02 有効商談" },
  { code: "03", label: "03 担当者合意" },
  { code: "04", label: "04 企画決定者合意" },
];
const phaseLabel = (c) => (PHASES.find((p) => p.code === c) || {}).label || "";

let allMeetings = [];
let usersCache = null;
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

function selectedPhases() {
  return [...document.querySelectorAll("#fPhaseGroup input:checked")].map((c) => c.value);
}

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

function applyHistoryFilter() {
  const owner = document.getElementById("fOwner").value.trim();
  const phases = selectedPhases();
  return allMeetings.filter((m) => {
    if (owner && (m.owner || "").trim() !== owner) return false;
    if (phases.length && !phases.includes(m.phase || "")) return false;
    return true;
  });
}

function renderList() {
  const rows = applyHistoryFilter();
  if (!rows.length) {
    hlist.innerHTML = '<div class="empty-state">該当する商談がありません。</div>';
    return;
  }
  hlist.innerHTML = "";
  for (const r of rows) {
    const overview = r.summary && r.summary.overview ? r.summary.overview : "（要約なし）";
    const tags = [];
    if (r.round_no) tags.push(`${r.round_no}回目`);
    if (r.phase) tags.push(phaseLabel(r.phase));
    const card = document.createElement("button");
    card.className = "hcard";
    card.innerHTML = `<div class="hcard-title"></div><div class="hcard-top"><span class="hcard-date"></span><span class="hcard-rep"></span></div><div class="hcard-tags"></div><div class="hcard-ov"></div>`;
    card.querySelector(".hcard-title").textContent = r.title || "(商談名なし)";
    card.querySelector(".hcard-date").textContent = fmtDate(r.created_at);
    card.querySelector(".hcard-rep").textContent = r.owner_name || r.rep_name || "";
    card.querySelector(".hcard-tags").textContent = tags.join("　");
    card.querySelector(".hcard-ov").textContent = overview;
    card.addEventListener("click", () => {
      document.querySelectorAll(".hcard").forEach((c) => c.classList.remove("active"));
      card.classList.add("active");
      loadDetail(r.bot_id);
    });
    hlist.appendChild(card);
  }
}

async function loadList() {
  // フェーズ（開閉式ドロップダウン・複数選択）
  initMultiDropdown(
    document.getElementById("fPhaseGroup"),
    "フェーズ",
    PHASES.map((p) => ({ value: p.code, label: p.label })),
    renderList
  );
  try {
    const res = await fetch("/api/meetings");
    const rows = await res.json();
    allMeetings = Array.isArray(rows) ? rows : [];
    if (allMeetings.length === 0) {
      hlist.innerHTML =
        '<div class="empty-state">まだ履歴がありません。商談を1件記録すると、ここに並びます。<br><small>（履歴の保存には DATABASE_URL の設定が必要です）</small></div>';
      return;
    }
    // 営業担当（所有者）選択肢
    const fOwner = document.getElementById("fOwner");
    const seen = new Map();
    for (const m of allMeetings) {
      const owner = (m.owner || "").trim();
      if (owner && !seen.has(owner)) seen.set(owner, (m.owner_name || "").trim() || owner);
    }
    for (const [owner, label] of seen) {
      const o = document.createElement("option");
      o.value = owner;
      o.textContent = label;
      fOwner.appendChild(o);
    }
    fOwner.addEventListener("change", renderList);
    renderList();
  } catch (e) {
    hlist.innerHTML = '<div class="empty-state">読み込みに失敗しました。</div>';
  }
}

async function loadDetail(botId) {
  hdetail.innerHTML = '<div class="empty-state">読み込み中…</div>';
  try {
    const res = await fetch(`/api/meetings/${encodeURIComponent(botId)}`);
    const m = await res.json();
    const s = m.summary || {};
    const sug = Array.isArray(m.suggestions) ? m.suggestions : [];
    const tr = Array.isArray(m.transcript) ? m.transcript : [];

    hdetail.innerHTML = `
      <div class="drec" id="drec"></div>
      <div class="dhead">
        <input class="dtitle-input" id="mTitle" placeholder="商談名" />
        <div class="dactions">
          <button class="btn" id="genBtn">要約・FB生成</button>
          <button class="btn" id="deepBtn">分析を生成</button>
          <button class="btn danger" id="delBtn">削除</button>
        </div>
      </div>
      <div class="dmeta-edit">
        <label>営業担当 <select id="mOwner"><option value="">未設定</option></select></label>
        <label>何回目 <input type="number" id="mRound" min="1" max="99" placeholder="-" /></label>
        <label>フェーズ <select id="mPhase"><option value="">未設定</option></select></label>
        <span class="dmeta-sub" id="dmetaSub"></span>
        <span class="dmeta-saved" id="mSaved" hidden>保存しました</span>
      </div>
      <div class="tabs">
        <button class="tab active" data-tab="trans">文字起こし</button>
        <button class="tab" data-tab="summary">要約</button>
        <button class="tab" data-tab="fb">FB & 分析</button>
      </div>
      <div class="tabwrap">
        <div class="tabpane" data-pane="trans">
          <div class="pane-bar"><button class="btn ghost copy-mini" id="copyTrans">コピー</button></div>
          <div id="dtrans" class="pane-content"></div>
        </div>
        <div class="tabpane" data-pane="summary" hidden>
          <div class="pane-bar"><button class="btn ghost copy-mini" id="copySummary">コピー</button></div>
          <div id="dsummary" class="pane-content"></div>
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
      </div>`;

    // タブ切替
    hdetail.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        hdetail.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
        const name = tab.dataset.tab;
        hdetail.querySelectorAll(".tabpane").forEach((p) => (p.hidden = p.dataset.pane !== name));
      });
    });

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
      copyText(hdetail.querySelector("#dsummary").innerText, e.currentTarget)
    );
    hdetail.querySelector("#copyFb").addEventListener("click", (e) =>
      copyText(hdetail.querySelector("#dfbwrap").innerText, e.currentTarget)
    );

    // 商談名（編集可）・サブ情報
    const mTitle = hdetail.querySelector("#mTitle");
    mTitle.value = m.title || "";
    hdetail.querySelector("#dmetaSub").textContent =
      `${fmtDate(m.created_at)}　${m.owner_name || m.rep_name || ""}`;

    // 何回目・フェーズ
    const mRound = hdetail.querySelector("#mRound");
    const mPhase = hdetail.querySelector("#mPhase");
    const mOwner = hdetail.querySelector("#mOwner");
    const mSaved = hdetail.querySelector("#mSaved");
    for (const p of PHASES) {
      const o = document.createElement("option");
      o.value = p.code;
      o.textContent = p.label;
      mPhase.appendChild(o);
    }
    if (m.round_no) mRound.value = m.round_no;
    if (m.phase) mPhase.value = m.phase;

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
        await fetch(`/api/meetings/${encodeURIComponent(botId)}/meta`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: mTitle.value.trim(),
            round: mRound.value,
            phase: mPhase.value,
            owner: mOwner.value,
          }),
        });
        mSaved.hidden = false;
        setTimeout(() => (mSaved.hidden = true), 1500);
        // 一覧の表示にも反映
        const row = allMeetings.find((x) => x.bot_id === botId);
        if (row) {
          row.title = mTitle.value.trim();
          row.round_no = mRound.value ? Number(mRound.value) : null;
          row.phase = mPhase.value || null;
          row.owner = mOwner.value || "";
          const u = (usersCache || []).find((x) => x.email === mOwner.value);
          row.owner_name = u ? u.name || u.email : mOwner.value ? mOwner.value : null;
        }
        renderList();
        hdetail.querySelector("#dmetaSub").textContent =
          `${fmtDate(m.created_at)}　${mOwner.options[mOwner.selectedIndex]?.textContent || ""}`;
      } catch {}
    };
    mTitle.addEventListener("change", saveMeta);
    mRound.addEventListener("change", saveMeta);
    mPhase.addEventListener("change", saveMeta);
    mOwner.addEventListener("change", saveMeta);

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
        alert("削除に失敗しました: " + e.message);
        delBtn.disabled = false;
      }
    });

    renderSummaryInto(hdetail.querySelector("#dsummary"), s);
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
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/deep-analyze`, { method: "POST" });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "生成に失敗しました");
        renderAiInto(hdetail.querySelector("#dai"), data);
      } catch (e) {
        alert("生成に失敗しました: " + e.message);
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

    // 文字起こしから 要約＋営業フィードバック を生成
    const genBtn = hdetail.querySelector("#genBtn");
    if (tr.length === 0) genBtn.disabled = true;
    genBtn.addEventListener("click", async () => {
      genBtn.disabled = true;
      const orig = genBtn.textContent;
      genBtn.textContent = "生成中…";
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/analyze`, { method: "POST" });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "生成に失敗しました");
        renderSummaryInto(hdetail.querySelector("#dsummary"), data.summary || {});
        renderFeedbackInto(hdetail.querySelector("#dfeedback"), data.feedback || {});
        loadList(); // 一覧の「要約なし」表示を更新
      } catch (e) {
        alert("生成に失敗しました: " + e.message);
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
          drec.innerHTML = `
            <video class="rec-video" controls preload="metadata" playsinline></video>
            <a class="rec-open" href="${escapeHtml(d.url)}" target="_blank" rel="noopener">別タブで開く</a>`;
          drec.querySelector("video").src = d.url;
        } else {
          drec.innerHTML = '<div class="rec-none">録画はまだありません（会議終了後に生成されます）。</div>';
        }
      })
      .catch(() => {
        drec.innerHTML = '<div class="rec-none">録画を取得できませんでした。</div>';
      });
  } catch (e) {
    hdetail.innerHTML = '<div class="empty-state">読み込みに失敗しました。</div>';
  }
}

function renderSummaryInto(el, s) {
  s = s || {};
  let html = "";
  if (s.overview) html += `<p class="overview">${escapeHtml(s.overview)}</p>`;
  html += group("要点", s.key_points);
  html += group("合意事項", s.agreements);
  html += group("宿題・次アクション", s.action_items);
  html += group("相手の懸念", s.customer_concerns);
  el.innerHTML = html || '<div class="empty-state">要約なし（「要約・フィードバックを生成」で作成）</div>';
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
    if (/[?？]/.test(t)) o.questions += 1;
    total += t.length;
  }
  const speakers = [...by.entries()]
    .map(([name, o]) => ({
      name, chars: o.chars, turns: o.turns, questions: o.questions,
      ratio: total ? Math.round((o.chars / total) * 100) : 0,
      isRep: repName && name.includes(repName),
    }))
    .sort((a, b) => b.chars - a.chars);
  return { speakers };
}
function renderMetricsInto(el, tr, repName) {
  if (!tr.length) {
    el.innerHTML = '<div class="empty-state">文字起こしがありません。</div>';
    return;
  }
  const m = computeMetrics(tr, repName);
  const rep = m.speakers.find((s) => s.isRep);
  let html = "";
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
  html += `<p class="metric-note">質問の回数：<b>${repQ}</b>${rep ? "（自社）" : "（全体）"}　／　発話ターン合計：<b>${m.speakers.reduce((a, s) => a + s.turns, 0)}</b></p>`;
  el.innerHTML = html;
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
