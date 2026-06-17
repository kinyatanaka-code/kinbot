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
          <button class="btn" id="genBtn">要約・フィードバックを生成</button>
          <button class="btn ghost" id="copyBtn">全文コピー</button>
          <a class="btn ghost rec" id="recBtn" hidden target="_blank" rel="noopener">録画を見る</a>
        </div>
      </div>
      <div class="dgrid">
        <div class="dcol">
          <h3>要約</h3>
          <div id="dsummary"></div>
          <h3>営業フィードバック</h3>
          <div id="dfeedback"></div>
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

    // 録画（あれば）
    fetch(`/api/meetings/${encodeURIComponent(botId)}/recording`)
      .then((r) => r.json())
      .then((d) => {
        if (d && d.url) {
          const b = hdetail.querySelector("#recBtn");
          b.href = d.url;
          b.hidden = false;
        }
      })
      .catch(() => {});
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
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

loadList();
