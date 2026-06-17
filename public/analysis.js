// public/analysis.js
const hlist = document.getElementById("hlist");
const hdetail = document.getElementById("hdetail");

const fmtDate = (s) => {
  try {
    return new Date(s).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return s || "";
  }
};
const labelOf = (sp) => (sp ? sp.name || "話者" + (sp.id ?? "") : "話者");
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadList() {
  try {
    const rows = await (await fetch("/api/meetings")).json();
    if (!Array.isArray(rows) || rows.length === 0) {
      hlist.innerHTML = '<div class="empty-state">まだ履歴がありません。商談を記録すると、ここで分析できます。</div>';
      return;
    }
    hlist.innerHTML = "";
    for (const r of rows) {
      const card = document.createElement("button");
      card.className = "hcard";
      card.innerHTML = `<div class="hcard-title"></div><div class="hcard-top"><span class="hcard-date"></span><span class="hcard-rep"></span></div>`;
      card.querySelector(".hcard-title").textContent = r.title || "(商談名なし)";
      card.querySelector(".hcard-date").textContent = fmtDate(r.created_at);
      card.querySelector(".hcard-rep").textContent = r.rep_name || "";
      card.addEventListener("click", () => {
        document.querySelectorAll(".hcard").forEach((c) => c.classList.remove("active"));
        card.classList.add("active");
        loadDetail(r.bot_id);
      });
      hlist.appendChild(card);
    }
  } catch {
    hlist.innerHTML = '<div class="empty-state">読み込みに失敗しました。</div>';
  }
}

// 文字起こしから客観指標を計算（LLM不要）
function computeMetrics(tr, repName) {
  const by = new Map(); // name -> {chars, turns, questions}
  let totalChars = 0;
  for (const u of tr) {
    const name = labelOf(u.speaker);
    const t = u.text || "";
    if (!by.has(name)) by.set(name, { chars: 0, turns: 0, questions: 0 });
    const o = by.get(name);
    o.chars += t.length;
    o.turns += 1;
    if (/[?？]/.test(t)) o.questions += 1;
    totalChars += t.length;
  }
  const speakers = [...by.entries()].map(([name, o]) => ({
    name,
    chars: o.chars,
    turns: o.turns,
    questions: o.questions,
    ratio: totalChars ? Math.round((o.chars / totalChars) * 100) : 0,
    isRep: repName && name.includes(repName),
  }));
  speakers.sort((a, b) => b.chars - a.chars);
  return { speakers, totalChars };
}

function renderMetrics(el, tr, repName) {
  if (!tr.length) {
    el.innerHTML = '<div class="empty-state">文字起こしがありません。</div>';
    return;
  }
  const m = computeMetrics(tr, repName);
  const rep = m.speakers.find((s) => s.isRep);
  const repRatio = rep ? rep.ratio : null;
  let html = "";
  if (repRatio != null) {
    const judge = repRatio <= 50 ? "良い（相手に話させている）" : "自社が話しすぎ気味";
    html += `<p class="metric-note">自社トーク割合：<b>${repRatio}%</b>（目安は40〜50%。${judge}）</p>`;
  }
  html += '<div class="bars">';
  for (const s of m.speakers) {
    html += `<div class="bar-row"><span class="bar-name">${escapeHtml(s.name)}${s.isRep ? "（自社）" : ""}</span>
      <span class="bar-track"><span class="bar-fill${s.isRep ? " rep" : ""}" style="width:${s.ratio}%"></span></span>
      <span class="bar-val">${s.ratio}%</span></div>`;
  }
  html += "</div>";
  const repQ = rep ? rep.questions : m.speakers.reduce((a, s) => a + s.questions, 0);
  html += `<p class="metric-note">質問の回数：<b>${repQ}</b>${rep ? "（自社）" : "（全体）"}　／　発話ターン合計：<b>${m.speakers.reduce((a, s) => a + s.turns, 0)}</b></p>`;
  el.innerHTML = html;
}

function group(label, items) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return `<div class="sgroup"><div class="label">${label}</div><ul>` + items.map((i) => `<li>${escapeHtml(i)}</li>`).join("") + `</ul></div>`;
}

function renderAi(el, a) {
  if (!a || (!a.scores && !a.bant && !a.needs)) {
    el.innerHTML = '<div class="empty-state">「AI分析を生成」を押すと、スコア・BANT・購買シグナル等を作成します。</div>';
    return;
  }
  let html = "";
  // スコア
  const sc = a.scores || {};
  const dims = [["hearing", "ヒアリング"], ["proposal", "提案"], ["closing", "クロージング"], ["listening", "傾聴"]];
  html += '<div class="scores">';
  for (const [k, jp] of dims) {
    const v = Number(sc[k]) || 0;
    html += `<div class="score-row"><span class="score-name">${jp}</span><span class="dots">${[1, 2, 3, 4, 5].map((n) => `<span class="dot${n <= v ? " on" : ""}"></span>`).join("")}</span><span class="score-val">${v}/5</span></div>`;
  }
  html += "</div>";
  // BANT
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

async function loadDetail(botId) {
  hdetail.innerHTML = '<div class="empty-state">読み込み中…</div>';
  try {
    const m = await (await fetch(`/api/meetings/${encodeURIComponent(botId)}`)).json();
    const tr = Array.isArray(m.transcript) ? m.transcript : [];
    hdetail.innerHTML = `
      <div class="dhead">
        <div class="dmeta">${escapeHtml(m.title || "(商談名なし)")}　|　${fmtDate(m.created_at)}　${escapeHtml(m.rep_name || "")}</div>
        <button class="btn" id="genBtn">AI分析を生成</button>
      </div>
      <h3>客観指標（自動計算）</h3>
      <div id="metrics"></div>
      <h3>AIによる評価</h3>
      <div id="ai"></div>`;

    renderMetrics(hdetail.querySelector("#metrics"), tr, m.rep_name);
    renderAi(hdetail.querySelector("#ai"), m.analysis);

    const genBtn = hdetail.querySelector("#genBtn");
    if (tr.length === 0) genBtn.disabled = true;
    genBtn.addEventListener("click", async () => {
      genBtn.disabled = true;
      const orig = genBtn.textContent;
      genBtn.textContent = "生成中…";
      try {
        const r = await fetch(`/api/meetings/${encodeURIComponent(botId)}/deep-analyze`, { method: "POST" });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "生成に失敗しました");
        renderAi(hdetail.querySelector("#ai"), data);
      } catch (e) {
        alert("生成に失敗しました: " + e.message);
      } finally {
        genBtn.disabled = false;
        genBtn.textContent = orig;
      }
    });
  } catch {
    hdetail.innerHTML = '<div class="empty-state">読み込みに失敗しました。</div>';
  }
}

loadList();
