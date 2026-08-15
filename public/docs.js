// ───────────────────────────────────────────────────────────
// docs.js — 資料トラッキングの画面
//   閲覧状況の一覧／宛先ごとのURL発行／資料（PDF）の登録
// ───────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const esc = (v) =>
  String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let docsCache = [];
let baseUrl = "";

function say(id, t, ms) {
  const e = $(id);
  if (!e) return;
  e.textContent = t || "";
  if (ms) setTimeout(() => { if (e.textContent === t) e.textContent = ""; }, ms);
}

function fmtWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const wd = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()}(${wd}) ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// タブ
document.querySelectorAll(".ap-tab").forEach((t) =>
  t.addEventListener("click", () => {
    const name = t.dataset.dpane;
    document.querySelectorAll(".ap-tab").forEach((x) => x.classList.toggle("active", x === t));
    document.querySelectorAll(".ap-pane").forEach((p) => (p.hidden = p.dataset.dpane !== name));
    if (name === "track") loadLinks();
    if (name === "files") loadDocs();
  })
);

// ───────── 資料（PDF）の登録 ─────────
async function loadDocs() {
  try {
    const d = await (await fetch("/api/docs")).json();
    if (d.error) throw new Error(d.error);
    docsCache = d.docs || [];
    baseUrl = d.base || location.origin;

    // 選択欄を埋める
    for (const [id, withAll] of [["dkDoc", true], ["dsDoc", false]]) {
      const sel = $(id);
      if (!sel) continue;
      const cur = sel.value;
      sel.innerHTML = withAll ? '<option value="">すべて</option>' : "";
      for (const f of docsCache) if (f.active) sel.add(new Option(f.name, f.id));
      if (cur) sel.value = cur;
    }

    const box = $("dfList");
    if (!docsCache.length) {
      box.innerHTML = '<div class="empty-state">まだ資料がありません。上の欄からPDFを登録してください。</div>';
      return;
    }
    box.innerHTML = `<div class="dk-list">` + docsCache.map((f) => `
      <div class="dk-row${f.active ? "" : " dk-off"}" data-id="${f.id}">
        <div class="dk-main">
          <div class="dk-t">${esc(f.name)}</div>
          <div class="dk-s">${esc(f.filename || "")}　${Math.round((f.size || 0) / 1024)}KB　
            発行 ${f.links}件／閲覧 ${f.views}件　${esc(fmtWhen(f.created_at))}</div>
        </div>
        <div class="dk-act">
          <button type="button" class="btn ghost df-rename">名前を直す</button>
          <button type="button" class="btn ghost df-toggle">${f.active ? "使わない" : "使う"}</button>
          <button type="button" class="btn ghost df-del">削除</button>
        </div>
      </div>`).join("") + `</div>`;

    box.querySelectorAll(".df-rename").forEach((b) =>
      b.addEventListener("click", async () => {
        const row = b.closest(".dk-row");
        const cur = row.querySelector(".dk-t").textContent.trim();
        const name = prompt("資料の名前を入れてください。", cur);
        if (name == null || !name.trim()) return;
        try {
          const r = await fetch(`/api/docs/${row.dataset.id}/name`, {
            method: "PUT", headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: name.trim() }),
          });
          if (!r.ok) throw new Error(((await r.json()) || {}).error || "変えられませんでした");
          loadDocs();
        } catch (e) { alert(e.message); }
      })
    );
    box.querySelectorAll(".df-toggle").forEach((b) =>
      b.addEventListener("click", async () => {
        const row = b.closest(".dk-row");
        const on = row.classList.contains("dk-off");
        await fetch(`/api/docs/${row.dataset.id}`, {
          method: "PUT", headers: { "content-type": "application/json" },
          body: JSON.stringify({ active: on }),
        });
        loadDocs();
      })
    );
    box.querySelectorAll(".df-del").forEach((b) =>
      b.addEventListener("click", async () => {
        const row = b.closest(".dk-row");
        if (!confirm("この資料を削除します。発行したURLと閲覧の記録も消えます。よろしいですか？")) return;
        await fetch(`/api/docs/${row.dataset.id}`, { method: "DELETE" });
        loadDocs();
      })
    );
  } catch (e) {
    $("dfList").innerHTML = `<div class="empty-state">読み込めませんでした：${esc(e.message)}</div>`;
  }
}

$("dfUp").addEventListener("click", async () => {
  const f = $("dfFile").files[0];
  if (!f) { say("dfStatus", "PDFを選んでください", 4000); return; }
  const fd = new FormData();
  fd.append("file", f);
  fd.append("name", $("dfName").value.trim());
  $("dfUp").disabled = true;
  say("dfStatus", "登録しています…");
  try {
    const r = await fetch("/api/docs", { method: "POST", body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "登録できませんでした");
    $("dfName").value = ""; $("dfFile").value = "";
    say("dfStatus", "登録しました", 4000);
    loadDocs();
  } catch (e) { say("dfStatus", "失敗: " + e.message); }
  finally { $("dfUp").disabled = false; }
});

// ───────── 宛先ごとのURLを発行 ─────────
// Excelからの貼り付けを想定して、タブ・カンマ・全角カンマで区切る
function parseRows(text) {
  const out = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const cols = t.split(/\t|,|，/).map((x) => x.trim());
    const email = cols.find((c) => /@/.test(c)) || "";
    const rest = cols.filter((c) => c && c !== email);
    out.push({ company: rest[0] || "", contact: rest[1] || "", email });
  }
  return out;
}

$("dsMake").addEventListener("click", async () => {
  const docId = parseInt($("dsDoc").value, 10);
  if (!docId) { say("dsStatus", "資料を選んでください", 4000); return; }
  const rows = parseRows($("dsRows").value);
  if (!rows.length) { say("dsStatus", "宛先を貼り付けてください", 4000); return; }
  if (!confirm(`${rows.length}件のURLを発行します。よろしいですか？`)) return;
  $("dsMake").disabled = true;
  say("dsStatus", "発行しています…");
  try {
    const r = await fetch("/api/doc-links", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ docId, rows }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "発行できませんでした");
    const links = d.links || [];
    say("dsStatus", `${links.length}件を発行しました`, 6000);

    // そのままExcelに貼り戻せる形で出す
    const tsv = links.map((l) =>
      [l.company, l.contact, l.email, l.url, l.pixel].join("\t")).join("\n");
    $("dsResult").innerHTML =
      `<div class="ap-cfg-actions" style="margin-top:14px">
         <button class="btn ghost" id="dsCopy">一覧をコピー（Excelに貼れます）</button>
         <span class="rev-status" id="dsCopyStatus"></span>
       </div>
       <p class="note">列の順番は「会社名・担当者名・メール・資料のURL・開封計測の画像URL」です。<br>
       メール本文には<b>資料のURL</b>を貼ってください。開封も測るなら、本文の末尾に開封計測の画像を入れます。</p>
       <div class="dk-list">` +
      links.slice(0, 200).map((l) => `
        <div class="dk-row">
          <div class="dk-main">
            <div class="dk-t">${esc(l.company || "(会社名なし)")}${l.contact ? " ｜ " + esc(l.contact) : ""}</div>
            <div class="dk-s">${esc(l.email || "")}</div>
            <div class="dk-url">${esc(l.url)}</div>
          </div>
          <div class="dk-act"><button type="button" class="btn ghost dk-copy1" data-u="${esc(l.url)}">コピー</button></div>
        </div>`).join("") + `</div>`;

    $("dsCopy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(tsv); say("dsCopyStatus", "コピーしました", 3000); }
      catch { say("dsCopyStatus", "コピーできませんでした", 4000); }
    });
    $("dsResult").querySelectorAll(".dk-copy1").forEach((b) =>
      b.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(b.dataset.u); b.textContent = "コピーしました"; }
        catch { b.textContent = "失敗"; }
        setTimeout(() => (b.textContent = "コピー"), 1500);
      })
    );
    $("dsRows").value = "";
  } catch (e) { say("dsStatus", "失敗: " + e.message); }
  finally { $("dsMake").disabled = false; }
});

// ───────── 閲覧状況 ─────────
async function loadLinks() {
  const box = $("dkList");
  say("dkStatus", "読み込み中…");
  try {
    const q = new URLSearchParams();
    if ($("dkDoc").value) q.set("docId", $("dkDoc").value);
    if ($("dkViewed").checked) q.set("viewed", "1");
    const d = await (await fetch("/api/doc-links?" + q.toString())).json();
    if (d.error) throw new Error(d.error);
    const links = d.links || [];
    say("dkStatus", `${links.length}件`);
    if (!links.length) {
      box.innerHTML = '<div class="empty-state">該当がありません。「URLを発行する」から作ってください。</div>';
      return;
    }
    box.innerHTML = `<div class="dk-list">` + links.map((l) => {
      const viewed = +l.view_count > 0;
      // 熱量の目安：滞在が長い／何度も開いている
      const hot = +l.total_seconds >= 120 || +l.view_count >= 3;
      return `<div class="dk-row${viewed ? "" : " dk-none"}" data-slug="${esc(l.slug)}" data-id="${esc(l.id)}">
        <div class="dk-main">
          <div class="dk-t">${esc(l.company || "(会社名なし)")}${l.contact ? " ｜ " + esc(l.contact) : ""}
            ${hot ? '<span class="dk-hot">よく見ています</span>' : ""}</div>
          <div class="dk-s">${esc(l.email || "")}　資料：${esc(l.doc_name || "")}</div>
          <div class="dk-stats">
            <span class="dk-st"><b>${l.view_count}</b>回</span>
            <span class="dk-st">滞在 <b>${esc(l.total_label)}</b></span>
            <span class="dk-st">${l.max_page ? `<b>${l.max_page}</b>ページまで` : "ページ不明"}</span>
            <span class="dk-st${+l.downloads > 0 ? " dk-dl" : " dk-dim"}">DL ${l.downloads || 0}</span>
            <span class="dk-st dk-dim">開封 ${l.opens}</span>
            <span class="dk-st dk-dim">クリック ${l.clicks}</span>
            <span class="dk-st dk-dim">最終 ${esc(fmtWhen(l.last_at))}</span>
          </div>
        </div>
        <div class="dk-act">
          <button type="button" class="btn ghost dk-detail">詳しく</button>
          <button type="button" class="btn ghost dk-copy" data-u="${esc(l.url)}">URL</button>
          <button type="button" class="btn ghost dk-del" data-id="${esc(l.id)}"
            data-who="${esc([l.company, l.contact].filter(Boolean).join(" ") || l.email || "この宛先")}">削除</button>
        </div>
        <div class="dk-panel" hidden></div>
      </div>`;
    }).join("") + `</div>`;

    box.querySelectorAll(".dk-copy").forEach((b) =>
      b.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(b.dataset.u); b.textContent = "コピーしました"; }
        catch { b.textContent = "失敗"; }
        setTimeout(() => (b.textContent = "URL"), 1500);
      })
    );
    box.querySelectorAll(".dk-detail").forEach((b) =>
      b.addEventListener("click", () => showDetail(b.closest(".dk-row")))
    );
    // 削除＝この行をまるごと消す（発行したURLと、その閲覧の記録）。
    // 「記録だけ消す」は「詳しく」の中に置いてある。
    box.querySelectorAll(".dk-del").forEach((b) =>
      b.addEventListener("click", async () => {
        const who = b.dataset.who || "この宛先";
        if (!confirm(
          `「${who}」に発行したURLと、その閲覧の記録を消します。\n\n` +
          `相手がそのURLを開いても、資料は見られなくなります。元には戻せません。\n` +
          `よろしいですか？`)) return;
        b.disabled = true;
        b.textContent = "消しています…";
        try {
          const r = await fetch(`/api/doc-links/${encodeURIComponent(b.dataset.id)}`, { method: "DELETE" });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || "消せませんでした");
          if (!d.deleted) throw new Error("対象が見つかりませんでした（画面を読み直してください）");
          // 行をその場で消してから、一覧を読み直す
          const row = b.closest(".dk-row");
          if (row) row.remove();
          say("dkStatus", "消しました", 4000);
          loadLinks();
        } catch (e) {
          b.disabled = false; b.textContent = "削除";
          say("dkStatus", "失敗：" + e.message, 6000);
        }
      })
    );
  } catch (e) {
    box.innerHTML = `<div class="empty-state">読み込めませんでした：${esc(e.message)}</div>`;
    say("dkStatus", "");
  }
}

async function showDetail(row) {
  const panel = row.querySelector(".dk-panel");
  if (!panel.hidden) { panel.hidden = true; return; }
  panel.hidden = false;
  panel.innerHTML = '<div class="dk-s">読み込み中…</div>';
  try {
    const d = await (await fetch("/api/doc-links/" + encodeURIComponent(row.dataset.slug))).json();
    if (d.error) throw new Error(d.error);
    const views = d.views || [];
    const events = d.events || [];
    panel.innerHTML =
      `<div class="dk-sub">閲覧の記録</div>` +
      (views.length
        ? views.map((v) => `<div class="dk-view">
             <span class="dk-vwhen">${esc(fmtWhen(v.started_at))}</span>
             <span>滞在 <b>${esc(v.seconds_label)}</b></span>
             <span>${v.max_page ? `${v.max_page}ページまで` : "ページ不明"}</span>
             ${v.top_pages ? `<span class="dk-dim">${esc(v.top_pages)}</span>` : ""}
           </div>`).join("")
        : '<div class="dk-s">まだ開かれていません。</div>') +
      `<div class="dk-sub">開封・クリック・ダウンロード</div>` +
      (events.length
        ? events.slice(0, 20).map((e) => `<div class="dk-view">
             <span class="dk-vwhen">${esc(fmtWhen(e.at))}</span>
             <span>${e.kind === "open" ? "開封" : e.kind === "download" ? "ダウンロード" : "クリック"}</span>
             ${e.url ? `<span class="dk-dim">${esc(String(e.url).slice(0, 60))}</span>` : ""}
           </div>`).join("")
        : '<div class="dk-s">記録はありません。</div>') +
      // URLは残したまま、閲覧・開封の記録だけ消したいとき
      `<div class="dk-panel-act">
         <button type="button" class="btn ghost dk-clear" data-id="${esc(row.dataset.id || "")}">記録だけ消す（URLはそのまま）</button>
         <span class="dk-s dk-clear-st"></span>
       </div>`;
    const cb = panel.querySelector(".dk-clear");
    if (cb) cb.addEventListener("click", async () => {
      if (!confirm("閲覧・開封の記録だけを消します。送ったURLはこのまま使えます。よろしいですか？")) return;
      cb.disabled = true;
      const st = panel.querySelector(".dk-clear-st");
      if (st) st.textContent = "消しています…";
      try {
        const r = await fetch(`/api/doc-links/${encodeURIComponent(row.dataset.id)}?mode=history`, { method: "DELETE" });
        const dd = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(dd.error || "消せませんでした");
        if (st) st.textContent = "記録を消しました";
        loadLinks();
      } catch (e) {
        cb.disabled = false;
        if (st) st.textContent = "失敗：" + e.message;
      }
    });
  } catch (e) {
    panel.innerHTML = `<div class="dk-s">読み込めませんでした：${esc(e.message)}</div>`;
  }
}

$("dkReload").addEventListener("click", loadLinks);
$("dkDoc").addEventListener("change", loadLinks);
$("dkViewed").addEventListener("change", loadLinks);

// 最初の読み込み
(async () => {
  await loadDocs();
  loadLinks();
})();

// ───────── スプレッドシートへの記録の設定 ─────────
async function loadSheetConfig() {
  if (!$("shId")) return;
  try {
    const d = await (await fetch("/api/doc-sheet")).json();
    $("shId").value = d.sheetId || "";
    $("shName").value = d.sheetName || "";
    $("shOwner").value = d.owner || "";
  } catch {}
}

if ($("shSave")) {
  const body = () => ({
    sheetId: $("shId").value, sheetName: $("shName").value, owner: $("shOwner").value,
  });
  $("shSave").addEventListener("click", async () => {
    say("shStatus", "保存しています…");
    try {
      const r = await fetch("/api/doc-sheet", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify(body()),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "保存できませんでした");
      if (d.docSheetId) $("shId").value = d.docSheetId;  // URLからIDだけ取り出したものに直す
      say("shStatus", "保存しました", 4000);
    } catch (e) { say("shStatus", "失敗: " + e.message); }
  });
  $("shTest").addEventListener("click", async () => {
    say("shStatus", "書き込んでみています…");
    try {
      const r = await fetch("/api/doc-sheet/test", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(body()),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "書き込めませんでした");
      say("shStatus", `「${d.title}」に書き込めました。シートを確認してください`, 8000);
    } catch (e) { say("shStatus", "失敗: " + e.message); }
  });
}

loadSheetConfig();
