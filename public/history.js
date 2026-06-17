// public/history.js
const hlist = document.getElementById("hlist");
const hdetail = document.getElementById("hdetail");

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

async function loadList() {
  try {
    const res = await fetch("/api/meetings");
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      hlist.innerHTML =
        '<div class="empty-state">まだ履歴がありません。商談を1件記録すると、ここに並びます。<br><small>（履歴の保存には DATABASE_URL の設定が必要です）</small></div>';
      return;
    }
    hlist.innerHTML = "";
    for (const r of rows) {
      const overview = r.summary && r.summary.overview ? r.summary.overview : "（要約なし）";
      const card = document.createElement("button");
      card.className = "hcard";
      card.innerHTML = `<div class="hcard-title"></div><div class="hcard-top"><span class="hcard-date"></span><span class="hcard-rep"></span></div><div class="hcard-ov"></div>`;
      card.querySelector(".hcard-title").textContent = r.title || "(商談名なし)";
      card.querySelector(".hcard-date").textContent = fmtDate(r.created_at);
      card.querySelector(".hcard-rep").textContent = r.rep_name || "";
      card.querySelector(".hcard-ov").textContent = overview;
      card.addEventListener("click", () => {
        document.querySelectorAll(".hcard").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
        loadDetail(r.bot_id);
      });
      hlist.appendChild(card);
    }
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
      <div class="dhead">
        <div class="dmeta"></div>
        <div class="dactions">
          <button class="btn" id="genBtn">要約・FB生成</button>
          <button class="btn" id="deepBtn">分析を生成</button>
          <button class="btn ghost" id="copyBtn">全文コピー</button>
        </div>
      </div>
      <div class="drec" id="drec"></div>
      <div class="dgrid">
        <div class="dcol">
          <h3>要約</h3>
          <div id="dsummary"></div>
          <h3>営業フィードバック</h3>
          <div id="dfeedback"></div>
          <h3>客観指標（自動計算）</h3>
          <div id="dmetrics"></div>
          <h3>AIによる評価</h3>
          <div id="dai"></div>
          <h3>次の一手（記録）</h3>
          <div id="dmoves"></div>
        </div>
        <div class="dcol">
          <h3>文字起こし</h3>
          <div id="dtrans"></div>
        </div>
      </div>`;

    // 全文コピー（話者名つきのプレーンテキスト）
    const fullText = tr.map((u) => `${labelOf(u.speaker)}: ${u.text}`).join("\n");
    const copyBtn = hdetail.querySelector("#copyBtn");
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(fullText);
        copyBtn.textContent = "コピーしました";
        setTimeout(() => (copyBtn.textContent = "全文コピー"), 1500);
      } catch {
        // クリップボードが使えない環境向けのフォールバック
        const ta = document.createElement("textarea");
        ta.value = fullText;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        copyBtn.textContent = "コピーしました";
        setTimeout(() => (copyBtn.textContent = "全文コピー"), 1500);
      }
    });

    hdetail.querySelector(".dmeta").textContent =
      `${m.title || "(商談名なし)"}　|　${fmtDate(m.created_at)}　${m.rep_name || ""}`;

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
  for (const [k, jp] of dims) {
    const v = Number(sc[k]) || 0;
    html += `<div class="score-row"><span class="score-name">${jp}</span><span class="dots">${[1, 2, 3, 4, 5].map((n) => `<span class="dot${n <= v ? " on" : ""}"></span>`).join("")}</span><span class="score-val">${v}/5</span></div>`;
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
