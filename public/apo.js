const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
const apState = { reps: [], appts: [], errors: [] };

// ISO日時 → 「7/10(水) 14:00」（ブラウザのタイムゾーン＝通常JST）
function fmtDT(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return esc(iso);
  const wd = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()}(${wd}) ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function repOptions(selected) {
  let o = `<option value="">担当未定</option>`;
  for (const r of apState.reps) {
    const sel = r.email === selected ? " selected" : "";
    o += `<option value="${esc(r.email)}"${sel}>${esc(r.name)}${r.has_zoom_link ? "" : "（Zoom未設定）"}</option>`;
  }
  return o;
}
function statusCell(a) {
  if (!a.current_owner) return `<span class="ap-badge ap-pending">担当未定</span>`;
  const rep = apState.reps.find((r) => r.email === a.current_owner);
  if (rep && rep.has_zoom_link) return `<span class="ap-badge ap-ok">${esc(rep.name)}のZoomへ転送中</span>`;
  return `<span class="ap-badge ap-warn">${esc(rep ? rep.name : a.current_owner)}：Zoom未設定</span>`;
}
function renderApo() {
  const body = $("apoBody");
  const appts = apState.appts;
  if (!appts.length) {
    body.innerHTML = '<div class="empty-state">この期間に取り込めるアポがありませんでした。取り込み範囲を広げるか、<a href="settings.html">設定 → インターン登録</a>の登録内容・カレンダー共有をご確認ください。</div>';
    if ((apState.errors || []).length) {
      body.innerHTML += '<p class="note cc-warn">一部のカレンダーを読めませんでした：' + apState.errors.map((e) => esc(e.setter) + "（" + esc(e.error) + "）").join("、") + '</p>';
    }
    return;
  }
  let html = '<table class="ap-table"><thead><tr><th>日時</th><th>アポ獲得者</th><th>予定名</th><th>担当セールス</th><th>共有リンク</th><th>状態</th></tr></thead><tbody>';
  appts.forEach((a, i) => {
    html += `<tr>
      <td class="ap-when">${fmtDT(a.start)}</td>
      <td>${esc(a.setter_name)}</td>
      <td class="ap-title">${esc(a.title)}</td>
      <td><select class="ap-rep" data-i="${i}">${repOptions(a.current_owner)}</select></td>
      <td class="ap-link"><code>${esc(a.smart_url)}</code> <button class="btn ghost ap-copy" data-url="${esc(a.smart_url)}">コピー</button></td>
      <td class="ap-status" data-i="${i}">${statusCell(a)}</td>
    </tr>`;
  });
  html += '</tbody></table>';
  if ((apState.errors || []).length) {
    html += '<p class="note cc-warn">一部のカレンダーを読めませんでした：' + apState.errors.map((e) => esc(e.setter) + "（" + esc(e.error) + "）").join("、") + '</p>';
  }
  body.innerHTML = html;

  body.querySelectorAll(".ap-rep").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const i = +sel.dataset.i;
      const a = apState.appts[i];
      const owner = sel.value || null;
      sel.disabled = true;
      try {
        const r = await fetch(`/api/smart-links/${encodeURIComponent(a.slug)}/owner`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ owner }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "変更に失敗しました");
        a.current_owner = owner;
        const cell = body.querySelector(`.ap-status[data-i="${i}"]`);
        if (cell) cell.innerHTML = statusCell(a);
      } catch (e) {
        alert("担当者の変更に失敗しました: " + e.message);
      } finally { sel.disabled = false; }
    });
  });
  body.querySelectorAll(".ap-copy").forEach((b) => {
    b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(b.dataset.url); b.textContent = "コピーしました"; }
      catch { b.textContent = "失敗"; }
      setTimeout(() => (b.textContent = "コピー"), 1500);
    });
  });
}
async function loadApo() {
  const body = $("apoBody");
  const st = $("apStatus");
  body.innerHTML = '<div class="empty-state">カレンダーから取り込み中…（件数によっては数十秒かかります）</div>';
  try {
    const reps = await (await fetch("/api/smart-links/reps")).json();
    apState.reps = Array.isArray(reps) ? reps : [];
  } catch { apState.reps = []; }
  try {
    const days = $("apDays").value;
    const r = await fetch("/api/apo/pickup?days=" + encodeURIComponent(days));
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "取り込みに失敗しました");
    apState.appts = d.appointments || [];
    apState.errors = d.errors || [];
    renderApo();
    if (st) st.textContent = `取り込み ${apState.appts.length}件`;
    setTimeout(() => { if (st) st.textContent = ""; }, 2500);
  } catch (e) {
    body.innerHTML = `<div class="empty-state">${esc(e.message)}</div>`;
  }
}
(function () {
  if ($("apReload")) $("apReload").addEventListener("click", loadApo);
  loadApo();
})();
