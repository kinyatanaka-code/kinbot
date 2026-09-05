// ───────────────────────────────────────────────────────────
// docs.js — 資料トラッキングの画面
//   閲覧状況の一覧／宛先ごとのURL発行／資料（PDF）の登録
// ───────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const esc = (v) =>
  String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

let docsCache = [];
let showUnusedDocs = false;   // 「使わない」にした資料も一覧に出すか
let baseUrl = "";

// 大事なボタンは、画面ぜんたいでクリックを受け止める。
// 途中の処理でつまずいても「押しても反応しない」状態にならないようにするため。
document.addEventListener("click", (ev) => {
  const t = ev.target && ev.target.closest ? ev.target.closest("button") : null;
  if (!t) return;
  if (t.id === "shMake") { ev.preventDefault(); makeSharedLink(); }
  if (t.id === "jpMakeShared") { ev.preventDefault(); jpCreate(true); }
  if (t.id === "jpMakeOne") { ev.preventDefault(); jpCreate(false); }
  if (t.id === "jpList") { ev.preventDefault(); jpLoadList(); }
  if (t.id === "jpNotifySave") { ev.preventDefault(); jpSaveNotify(); }
  if (t.id === "dkToggle") {
    ev.preventDefault();
    const list = $("dkList");
    if (list) {
      const hidden = list.style.display === "none";
      list.style.display = hidden ? "" : "none";
      t.textContent = hidden ? "一覧をしまう" : "一覧を表示";
    }
  }
});

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
    if (name === "deals") loadDeals();
  })
);

// ───────── 資料（PDF）の登録 ─────────
async function loadDocs() {
  try {
    const d = await (await fetch("/api/docs")).json();
    if (d.error) throw new Error(d.error);
    docsCache = d.docs || [];
    baseUrl = d.base || location.origin;

    // 選択欄を埋める。
    //   dkDoc（閲覧状況の絞り込み）は全体。
    //   送る側（dsDoc/blDoc/shDoc）は「自分の資料だけ」にする（他の人が登録した資料は出さない）。
    for (const [id, withAll, mineOnly] of [["dkDoc", true, false], ["dsDoc", false, true], ["blDoc", false, true], ["shDoc", false, true]]) {
      const sel = $(id);
      if (!sel) continue;
      const cur = sel.value;
      const eligible = docsCache.filter((f) => f.active && (!mineOnly || f.mine));
      const std = eligible.filter((f) => f.standing);
      const reg = eligible.filter((f) => !f.standing);
      sel.innerHTML = withAll ? '<option value="">すべて</option>' : "";
      if (std.length && reg.length) {
        // 常時資料と会社ごとの両方があるときは、見出し付きで分ける（常時を上に）
        const g1 = document.createElement("optgroup"); g1.label = "常時資料";
        std.forEach((f) => g1.appendChild(new Option(f.name, f.id))); sel.appendChild(g1);
        const g2 = document.createElement("optgroup"); g2.label = "会社ごと";
        reg.forEach((f) => g2.appendChild(new Option(f.name, f.id))); sel.appendChild(g2);
      } else {
        eligible.forEach((f) => sel.add(new Option(f.name, f.id)));
      }
      if (cur) sel.value = cur;
    }

    const box = $("dfList");
    if (!docsCache.length) {
      box.innerHTML = '<div class="empty-state">まだ資料がありません。上の欄からPDFを登録してください。</div>';
      return;
    }
    // 資料は「常時資料」「会社ごとの資料」に分けて並べる（常時は上）。「使わない」は下にまとめる。
    const 使わない数 = docsCache.filter((f) => !f.active).length;
    const トグル = 使わない数
      ? `<div class="df-unused-bar"><button type="button" class="btn ghost" id="dfToggleUnused">${
          showUnusedDocs ? `使わない資料を隠す（${使わない数}件）` : `使わない資料も見る（${使わない数}件）`}</button></div>`
      : "";

    const 区分バッジ = (f) => f.mine
      ? `<span class="home-badge dn-kind ${f.standing ? "df-standing" : "df-regular"}">${f.standing ? "常時" : "会社ごと"}</span>`
      : "";
    const 資料行 = (f) => `
      <div class="dk-row${f.active ? "" : " dk-off"}" data-id="${f.id}">
        <div class="dk-main">
          <div class="dk-t">
            ${f.mine
              ? (f.shared === false
                  ? '<span class="home-badge dn-kind df-own">自分だけ</span>'
                  : '<span class="home-badge dn-kind df-share">チームに共有</span>')
              : `<span class="home-badge dn-kind df-other">${esc(f.uploaded_by || "ほかの人")}</span>`}
            ${区分バッジ(f)}
            ${esc(f.name)}
          </div>
          <div class="dk-s">${esc(f.filename || "")}　${Math.round((f.size || 0) / 1024)}KB　
            発行 ${f.links}件／閲覧 ${f.views}件　${esc(fmtWhen(f.created_at))}</div>
        </div>
        <div class="dk-act">
          ${f.mine ? `<button type="button" class="btn ghost df-standing-toggle">${f.standing ? "会社ごとにする" : "常時にする"}</button>` : ""}
          ${f.mine ? `<button type="button" class="btn ghost df-share">${
            f.shared === false ? "チームに共有する" : "自分だけにする"}</button>` : ""}
          ${f.mine ? '<button type="button" class="btn ghost df-rename">名前を直す</button>' : ""}
          ${f.mine ? `<button type="button" class="btn ghost df-toggle">${f.active ? "使わない" : "使う"}</button>` : ""}
          ${f.mine ? '<button type="button" class="btn ghost df-del">削除</button>' : ""}
        </div>
      </div>`;
    const セクション = (title, hint, list) => list.length
      ? `<div class="df-sec"><div class="df-sec-h">${title}${hint ? `<span class="df-sec-hint">${hint}</span>` : ""}</div><div class="dk-list">${list.map(資料行).join("")}</div></div>`
      : "";

    const 常時 = docsCache.filter((f) => f.active && f.standing);
    const 会社ごと = docsCache.filter((f) => f.active && !f.standing);
    const 非表示 = docsCache.filter((f) => !f.active);

    let html = セクション("常時資料", "毎回使う資料。一覧と選択欄の上に固定されます", 常時)
             + セクション("会社ごとの資料", "宛先ごとに選んで送る資料", 会社ごと);
    if (!常時.length && !会社ごと.length) {
      html += '<div class="empty-state">使っている資料がありません。「使わない資料も見る」から戻せます。</div>';
    }
    html += トグル;
    if (showUnusedDocs) html += セクション("使わない資料（非表示）", "発行済みURLからは開けます", 非表示);
    box.innerHTML = html;

    // 「使わない資料も見る／隠す」
    const tg = $("dfToggleUnused");
    if (tg) tg.addEventListener("click", () => { showUnusedDocs = !showUnusedDocs; loadDocs(); });

    // 常時資料 ↔ 会社ごと の切り替え
    box.querySelectorAll(".df-standing-toggle").forEach((b) =>
      b.addEventListener("click", async () => {
        const row = b.closest(".dk-row");
        const f = docsCache.find((x) => String(x.id) === row.dataset.id);
        const next = !(f && f.standing);
        b.disabled = true;
        try {
          const r = await fetch(`/api/docs/${row.dataset.id}/standing`, {
            method: "PATCH", headers: { "content-type": "application/json" },
            body: JSON.stringify({ standing: next }),
          });
          if (!r.ok) throw new Error(((await r.json()) || {}).error || "変えられませんでした");
          loadDocs();
        } catch (e) { b.disabled = false; alert(e.message); }
      }));

    // 自分だけにする／チームに共有する
    box.querySelectorAll(".df-share").forEach((b) =>
      b.addEventListener("click", async () => {
        const row = b.closest(".dk-row");
        const f = docsCache.find((x) => String(x.id) === row.dataset.id);
        const on = f && f.shared === false;
        if (on && !confirm(`「${f.name}」を、チームのみんなが使えるようにします。よろしいですか？`)) return;
        b.disabled = true;
        try {
          const r = await fetch(`/api/docs/${row.dataset.id}/shared`, {
            method: "PATCH", headers: { "content-type": "application/json" },
            body: JSON.stringify({ shared: !!on }),
          });
          if (!r.ok) throw new Error(((await r.json()) || {}).error || "変えられませんでした");
          loadDocs();
        } catch (e) { b.disabled = false; alert(e.message); }
      }));

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
      body: JSON.stringify({
        docId, rows,
        expiry: ($("dsExpiry") && $("dsExpiry").value) || "0",
        pass: ($("dsPass") && $("dsPass").value.trim()) || "",
        askName: !!($("dsAskName") && $("dsAskName").checked),
      }),
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

// ───────── 商談ごとの資料トラッキング（案B・商談カード） ─────────
let dealsCache = [];

function fmtSecShort(s) {
  s = Math.max(0, Math.round(+s || 0));
  if (s < 60) return `${s}秒`;
  return `${Math.floor(s / 60)}分${s % 60}秒`;
}
function fmtDay(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function deChip(l) {
  const seen = +l.view_count > 0;
  const detail = seen
    ? `滞在${fmtSecShort(l.total_seconds)}・最大${l.max_page || 0}ページ`
    : "まだ開かれていません";
  return `<a class="de-chip" href="${esc(l.url)}" target="_blank" rel="noopener"
      title="${esc(l.doc_name)}／${esc(detail)}">
      <span class="de-dot" style="background:${seen ? "#1d9e75" : "#b4b2a9"}"></span>
      <span class="de-chip-t">${esc(l.doc_name)}</span>
      <span class="de-chip-s">${seen ? l.view_count + "回" : "未読"}</span></a>`;
}
function deRow(company, label, kind, links) {
  return `<div class="de-row">
    <span class="de-badge${kind === "standing" ? "" : " k"}">${label}</span>
    <div class="de-chips">
      ${(links || []).map(deChip).join("")}
      <button type="button" class="de-add" data-company="${esc(company)}" data-kind="${kind}">＋送付</button>
    </div>
  </div>`;
}

async function loadDeals() {
  const box = $("deList");
  if (!box) return;
  try {
    const q = ($("deSearch") && $("deSearch").value.trim()) || "";
    box.innerHTML = '<div class="empty-state">読み込み中…</div>';
    const d = await (await fetch(`/api/doc-tracking/deals?q=${encodeURIComponent(q)}`)).json();
    if (d.error) throw new Error(d.error);
    dealsCache = d.companies || [];
    if (!dealsCache.length) {
      box.innerHTML = '<div class="empty-state">商談履歴に会社がありません。商談が記録されると、ここに会社ごとに並びます。</div>';
      return;
    }
    box.innerHTML = `<div class="de-cards">` + dealsCache.map((c) => `
      <div class="de-card">
        <div class="de-card-h">
          <div class="de-co">${esc(c.company)}</div>
          <div class="de-meta">商談${c.mtgs}件　最終 ${esc(fmtDay(c.last_at))}</div>
        </div>
        ${deRow(c.company, "初回", "standing", c.standing)}
        ${deRow(c.company, "会社ごと", "regular", c.per_company)}
      </div>`).join("") + `</div>`;
  } catch (e) {
    box.innerHTML = `<div class="empty-state">読み込めませんでした：${esc(e.message)}</div>`;
  }
}

// ＋送付：その場で資料を選んでURLを発行する
function deOpenPicker(btn) {
  const wantStanding = btn.dataset.kind === "standing";
  const company = btn.dataset.company;
  const opts = docsCache.filter((f) => f.active && f.mine && !!f.standing === wantStanding);
  if (!opts.length) {
    alert(wantStanding
      ? "初回に使う資料がありません。資料タブで資料を『常時にする』にしてください。"
      : "会社ごとに使う資料がありません。資料タブでPDFを登録してください。");
    return;
  }
  const wrap = document.createElement("span");
  wrap.className = "de-picker";
  wrap.innerHTML =
    `<select class="de-sel">${opts.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join("")}</select>` +
    `<button type="button" class="btn de-issue" data-company="${esc(company)}">発行</button>` +
    `<button type="button" class="btn ghost de-cancel">やめる</button>`;
  btn.replaceWith(wrap);
}
async function deIssue(btn) {
  const wrap = btn.closest(".de-picker");
  const sel = wrap && wrap.querySelector(".de-sel");
  const docId = sel ? parseInt(sel.value, 10) : 0;
  const company = btn.dataset.company;
  if (!docId) return;
  btn.disabled = true; btn.textContent = "発行中…";
  try {
    const r = await fetch("/api/doc-links", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ docId, rows: [{ company }], expiry: "0" }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "発行できませんでした");
    say("deStatus", `「${company}」にURLを発行しました`, 4000);
    loadDeals();
  } catch (e) { btn.disabled = false; btn.textContent = "発行"; alert(e.message); }
}
if ($("deList")) {
  $("deList").addEventListener("click", (ev) => {
    const add = ev.target.closest(".de-add");
    const issue = ev.target.closest(".de-issue");
    const cancel = ev.target.closest(".de-cancel");
    if (add) { ev.preventDefault(); deOpenPicker(add); }
    else if (issue) { ev.preventDefault(); deIssue(issue); }
    else if (cancel) { ev.preventDefault(); loadDeals(); }
  });
}
if ($("deReload")) $("deReload").addEventListener("click", loadDeals);
if ($("deSearch")) $("deSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") loadDeals(); });

// 最初の読み込み
(async () => {
  await loadDocs();
  loadLinks();
  loadDeals();
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


// ───────────────────────────────────────────────────────────
// 名簿ファイルからまとめて発行する
//
// ① ファイルを選ぶ → 何件・どの列かを下見する（まだ発行しない）
// ② 「この内容で発行する」を押したら、100件ずつ発行して進み具合を出す
// ───────────────────────────────────────────────────────────
let blItems = [];      // 下見で読み取った宛先
let blJobId = "";      // いま発行中の受付番号
let blTimer = null;

function blSay(t, ms) {
  const e = $("blStatus");
  if (!e) return;
  e.textContent = t || "";
  if (ms) setTimeout(() => { if (e.textContent === t) e.textContent = ""; }, ms);
}

// ① 下見
async function blPreview(file) {
  if (!file) return;
  blSay("ファイルを読んでいます…");
  $("blPreview").innerHTML = "";
  const fd = new FormData();
  fd.append("file", file);
  try {
    const r = await fetch("/api/doc-links/preview", { method: "POST", body: fd });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "読み取れませんでした");
    blItems = d.items || [];
    const 列 = d["列"] || {};
    const 先頭 = d["先頭"] || [];
    const 飛ばした = d["飛ばした"] || [];
    $("blPreview").innerHTML =
      `<div class="bl-prev">` +
      `<b>${d["件数"]}件</b> 読み取りました（${esc(d["種類"] || "")}` +
      (d["シート"] ? `／シート「${esc(d["シート"])}」` : "") + `）<br>` +
      `会社名：${esc(列["会社名"] || "")}　担当者名：${esc(列["担当者名"] || "")}　メール：${esc(列["メール"] || "")}` +
      (d["見出しあり"] ? "（1行目は見出しとして飛ばしました）" : "（見出しは無いものとして読みました）") +
      (飛ばした.length ? `<br><span class="bl-warn">${飛ばした.length}行は飛ばしました（メールの形が違うなど）</span>` : "") +
      (先頭.length ? `<table><tr><th>会社名</th><th>担当者名</th><th>メール</th></tr>` +
        先頭.map((x) => `<tr><td>${esc(x.company)}</td><td>${esc(x.name)}</td><td>${esc(x.email)}</td></tr>`).join("") +
        `</table><span class="bl-prog-sub">先頭5件です。列がずれていないか確かめてください。</span>` : "") +
      `</div>` +
      `<div class="ap-cfg-actions">
         <button class="btn" id="blGo">この内容で ${d["件数"]}件 発行する</button>
         <button class="btn ghost" id="blClear">やめる</button>
       </div>`;
    blSay("");
    $("blGo").addEventListener("click", blStart);
    $("blClear").addEventListener("click", () => { blItems = []; $("blPreview").innerHTML = ""; });
  } catch (e) {
    blSay("失敗：" + e.message, 8000);
  }
}

// ② 発行を始める
async function blStart() {
  const docId = parseInt($("blDoc").value, 10);
  if (!docId) { blSay("送る資料を選んでください", 5000); return; }
  if (!blItems.length) { blSay("先にファイルを選んでください", 5000); return; }
  if (!confirm(`${blItems.length}件のURLを発行します。よろしいですか？\n（数千件だと1〜2分かかります）`)) return;

  $("blPreview").innerHTML = "";
  $("blProgress").hidden = false;
  $("blOpenList").hidden = true;
  blProg({ done: 0, total: blItems.length, made: 0, failed: 0, 状態: "発行中", 経過秒: 0 });
  try {
    const r = await fetch("/api/doc-links/bulk", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ docId, items: blItems }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "始められませんでした");
    blJobId = d.id;
    blWatch();
  } catch (e) {
    blSay("失敗：" + e.message, 8000);
    $("blProgress").hidden = true;
  }
}

// 進み具合を出す
function blProg(j) {
  const pct = j.total ? Math.round((j.done / j.total) * 100) : 0;
  $("blBarIn").style.width = pct + "%";
  const nokori = j.done && j.経過秒 ? Math.max(0, Math.round((j.経過秒 / j.done) * (j.total - j.done))) : null;
  $("blProgTxt").innerHTML =
    `${esc(j["状態"] || "")}　${j.done} / ${j.total}件（${pct}%）` +
    `<span class="bl-prog-sub">　発行 ${j.made}件` +
    (j.failed ? ` ／ <span class="bl-warn">失敗 ${j.failed}件</span>` : "") +
    (j.state === "running" && nokori !== null ? ` ／ あと ${nokori}秒ほど` : ` ／ ${j.経過秒}秒`) +
    `</span>`;
}

// 1秒ごとに進み具合を聞く
function blWatch() {
  clearInterval(blTimer);
  blTimer = setInterval(async () => {
    if (!blJobId) return clearInterval(blTimer);
    try {
      const d = await (await fetch(`/api/doc-links/bulk/${encodeURIComponent(blJobId)}`)).json();
      if (d.error) throw new Error(d.error);
      blProg(d);
      if (d.state !== "running") {
        clearInterval(blTimer);
        $("blCancel").hidden = true;
        $("blOpenList").hidden = false;
        blSay(d.state === "done" ? `${d.made}件のURLを発行しました` : `止めました（${d.made}件は発行済み）`, 12000);
        loadLinks();   // 発行したURLの一覧を読み直す
      }
    } catch (e) {
      clearInterval(blTimer);
      blSay("進み具合を見られませんでした：" + e.message, 8000);
    }
  }, 1000);
}

if ($("blFile")) {
  $("blFile").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = "";
    blPreview(f);
  });
  $("blCancel").addEventListener("click", async () => {
    if (!blJobId) return;
    if (!confirm("発行を止めます。ここまでのぶんは残ります。よろしいですか？")) return;
    try {
      await fetch(`/api/doc-links/bulk/${encodeURIComponent(blJobId)}/cancel`, { method: "POST" });
      blSay("止めています…");
    } catch {}
  });
  $("blOpenList").addEventListener("click", () => {
    // 閲覧状況のタブへ移る
    const tab = document.querySelector('[data-dpane="track"]');
    if (tab) tab.click();
  });
}


// ───────────────────────────────────────────────────────────
// メルマガ用の共通URL
//
// 全員に同じURLを送る。誰が見たかは、配信システムの差し込みタグで分かる。
// ───────────────────────────────────────────────────────────
async function makeSharedLink() {
  {
    const docId = parseInt($("shDoc").value, 10);
    const st = $("shStatus"), box = $("shBox");
    // 押したことが必ず分かるようにする（無反応に見えないため）
    if (st) st.textContent = "…";
    if (!docId) { st.textContent = "資料を選んでください"; return; }
    st.textContent = "用意しています…";
    box.innerHTML = "";
    try {
      const r = await fetch("/api/doc-links/shared", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ docId }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "作れませんでした");
      st.textContent = "";
      const ways = d["貼り方"] || {};
      box.innerHTML =
        `<div class="sh-box">
           <div class="sh-lb">この資料の共通URL</div>
           <div class="sh-url"><code>${esc(d.url)}</code>
             <button type="button" class="btn ghost sh-copy" data-u="${esc(d.url)}">コピー</button></div>
           <div class="sh-lb">配信システムに貼るときは、下のどれかを使ってください</div>
           ${Object.entries(ways).map(([name, url]) => `
             <div class="sh-row">
               <span class="sh-name">${esc(name)}</span>
               <code class="sh-code">${esc(url)}</code>
               <button type="button" class="btn ghost sh-copy" data-u="${esc(url)}">コピー</button>
             </div>`).join("")}
           <p class="note">差し込みタグが働かなかった場合は、「名乗りなし」として数だけ記録します。<br>
           開いた人の一覧は、下の「閲覧状況」で見られます。</p>
           <button type="button" class="btn ghost" id="shWho" data-id="${esc(String(d.linkId || ""))}">誰が見たかを見る</button>
           <div id="shWhoBox"></div>
         </div>`;
      box.querySelectorAll(".sh-copy").forEach((b) =>
        b.addEventListener("click", () => {
          navigator.clipboard.writeText(b.dataset.u)
            .then(() => { b.textContent = "コピーしました"; setTimeout(() => (b.textContent = "コピー"), 2000); })
            .catch(() => { b.textContent = "できませんでした"; });
        }));
      const who = $("shWho");
      if (who) who.addEventListener("click", () => loadSharedViewers(d.slug));
    } catch (e) {
      st.textContent = "失敗：" + e.message;
    }
  }
}

// 共通URLを、誰が開いたか
async function loadSharedViewers(slug) {
  const box = $("shWhoBox");
  if (!box) return;
  box.innerHTML = "読み込んでいます…";
  try {
    const links = await (await fetch("/api/doc-links?limit=200")).json();
    const hit = (links.links || []).find((x) => x.slug === slug);
    if (!hit) { box.innerHTML = "まだ誰も開いていません。"; return; }
    const d = await (await fetch(`/api/doc-links/${hit.id}/viewers`)).json();
    const items = d.items || [];
    if (!items.length) { box.innerHTML = "まだ誰も開いていません。"; return; }
    // 日本時間で出す
    const when = (v) => {
      const x = new Date(v);
      if (isNaN(x.getTime())) return "";
      const j = new Date(x.getTime() + 9 * 3600 * 1000);
      const p2 = (n) => String(n).padStart(2, "0");
      return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${p2(j.getUTCHours())}:${p2(j.getUTCMinutes())}`;
    };
    box.innerHTML =
      `<div class="note">${items.length}人が開きました</div>` +
      `<table class="sh-table"><tr><th>相手</th><th>回数</th><th>滞在</th><th>到達</th><th>最後に見た</th></tr>` +
      items.map((x) => `<tr>
        <td>${esc(x["相手"])}${x["名前"] ? `<br><small>${esc(x["名前"])}</small>` : ""}</td>
        <td>${x["回数"]}</td>
        <td>${Math.round(x["秒"] / 6) / 10}分</td>
        <td>${x["到達"] || "-"}</td>
        <td>${esc(when(x["最後"]))}</td>
      </tr>`).join("") + `</table>`;
  } catch (e) {
    box.innerHTML = "見られませんでした：" + esc(e.message);
  }
}


// ───────────────────────────────────────────────────────────
// 調整URLのトラッキング（外部のURLへ転送しつつ、誰が開いたかを記録）
// ───────────────────────────────────────────────────────────
async function jpCreate(shared) {
  const st = $("jpStatus"), box = $("jpBox");
  const url = ($("jpUrl") && $("jpUrl").value || "").trim();
  if (!url) { if (st) st.textContent = "転送先のURLを入れてください"; return; }
  if (st) st.textContent = "作っています…";
  try {
    const r = await fetch("/api/jump", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: $("jpTitle").value, targetUrl: url, shared }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "作れませんでした");
    if (st) st.textContent = "";
    const ways = d["貼り方"];
    box.innerHTML =
      `<div class="sh-box">
         <div class="sh-lb">${d["共通"] ? "Pardot用の共通URL" : "この1本のURL"}</div>
         <div class="sh-url"><code>${esc(d.url)}</code>
           <button type="button" class="btn ghost jp-copy" data-u="${esc(d.url)}">コピー</button></div>
         <div class="sh-lb">転送先</div>
         <div class="sh-code">${esc(d["転送先"])}</div>
         ${ways ? `<div class="sh-lb">Pardotに貼るときは、こちらを使ってください</div>` +
           Object.entries(ways).map(([k, u]) => `
             <div class="sh-row">
               <span class="sh-name">${esc(k)}</span>
               <code class="sh-code">${esc(u)}</code>
               <button type="button" class="btn ghost jp-copy" data-u="${esc(u)}">コピー</button>
             </div>`).join("") : ""}
       </div>`;
    box.querySelectorAll(".jp-copy").forEach((b) =>
      b.addEventListener("click", () => {
        navigator.clipboard.writeText(b.dataset.u)
          .then(() => { b.textContent = "コピーしました"; setTimeout(() => (b.textContent = "コピー"), 2000); })
          .catch(() => { b.textContent = "できませんでした"; });
      }));
  } catch (e) { if (st) st.textContent = "失敗：" + e.message; }
}

async function jpLoadList() {
  const box = $("jpListBox");
  if (!box) return;
  box.innerHTML = "読み込んでいます…";
  try {
    const d = await (await fetch("/api/jump")).json();
    const items = d.items || [];
    if (!items.length) { box.innerHTML = '<div class="note">まだありません。</div>'; return; }
    box.innerHTML =
      `<table class="sh-table"><tr><th>名前</th><th>kinbotのURL</th><th>開いた回数</th><th>人数</th><th></th></tr>` +
      items.map((x) => `<tr>
        <td>${esc(x.title)}${x["共通"] ? "（共通）" : ""}<br><small>${esc(x["転送先"])}</small></td>
        <td><code style="font-size:11px">${esc(x.url)}</code></td>
        <td>${x["閲覧"]}</td>
        <td>${x["人数"]}</td>
        <td><button type="button" class="btn ghost jp-who" data-id="${x.id}">誰が開いたか</button></td>
      </tr>`).join("") + `</table><div id="jpWho"></div>`;
    box.querySelectorAll(".jp-who").forEach((b) =>
      b.addEventListener("click", () => jpViewers(b.dataset.id)));
  } catch (e) { box.innerHTML = "読み込めませんでした：" + esc(e.message); }
}

async function jpViewers(id) {
  const box = $("jpWho");
  if (!box) return;
  box.innerHTML = "読み込んでいます…";
  try {
    const d = await (await fetch(`/api/jump/${encodeURIComponent(id)}/viewers`)).json();
    const items = d.items || [];
    if (!items.length) { box.innerHTML = '<div class="note">まだ誰も開いていません。</div>'; return; }
    const when = (v) => {
      const x = new Date(v);
      if (isNaN(x.getTime())) return "";
      const j = new Date(x.getTime() + 9 * 3600 * 1000);
      const p = (n) => String(n).padStart(2, "0");
      return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
    };
    box.innerHTML =
      `<div class="note">${items.length}人が開きました</div>` +
      `<table class="sh-table"><tr><th>相手</th><th>回数</th><th>はじめて</th><th>最後</th></tr>` +
      items.map((x) => `<tr>
        <td>${esc(x["相手"])}${x["名前"] ? `<br><small>${esc(x["名前"])}</small>` : ""}</td>
        <td>${x["回数"]}</td>
        <td>${esc(when(x["最初"]))}</td>
        <td>${esc(when(x["最後"]))}</td>
      </tr>`).join("") + `</table>`;
  } catch (e) { box.innerHTML = "見られませんでした：" + esc(e.message); }
}




// 開かれたときにChatへ知らせるかどうか
async function jpLoadNotify() {
  if (!$("jpNotify")) return;
  try {
    const d = await (await fetch("/api/jump/notify")).json();
    $("jpNotify").checked = d.enabled !== false;
  } catch {}
}

async function jpSaveNotify() {
  const st = $("jpNotifySt");
  if (st) st.textContent = "保存しています…";
  try {
    await fetch("/api/jump/notify", {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: $("jpNotify").checked }),
    });
    if (st) {
      st.textContent = $("jpNotify").checked ? "知らせます" : "知らせません";
      setTimeout(() => (st.textContent = ""), 4000);
    }
  } catch (e) { if (st) st.textContent = "失敗：" + e.message; }
}

jpLoadNotify();

// 会社名からSalesforceを引いて、担当者とメールを埋める
async function dsLookupFill() {
  const say = (m) => { const e = $("dsLookupSt"); if (e) e.textContent = m || ""; };
  const ta = $("dsRows");
  if (!ta) return;
  const rows = parseRows(ta.value);
  if (!rows.length) { say("先に会社名を貼ってください"); return; }
  const btn = $("dsLookup");
  if (btn) btn.disabled = true;
  say(`${rows.length}件を探しています…`);
  try {
    // 30件ずつ調べる（多いと時間がかかるため）
    const 埋めた = [];
    for (let i = 0; i < rows.length; i += 30) {
      const part = rows.slice(i, i + 30);
      say(`探しています… ${Math.min(i + 30, rows.length)} / ${rows.length}件`);
      const r = await fetch("/api/doc-links/lookup", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ names: part.map((x) => x.company) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "探せませんでした");
      (d.items || []).forEach((found, k) => {
        const もと = part[k] || {};
        埋めた.push({
          company: もと.company,
          // すでに書いてあるものは、そのまま活かす
          contact: もと.contact || found.contact || "",
          email: もと.email || found.email || "",
        });
      });
    }
    // 貼り直す（1行1件、タブ区切り）
    ta.value = 埋めた.map((x) => [x.company, x.contact, x.email].filter(Boolean).join("\t")).join("\n");
    dsShowRead();
    const 見つかった = 埋めた.filter((x) => x.email || x.contact).length;
    say(`${見つかった} / ${埋めた.length}件が見つかりました`);
  } catch (e) { say("失敗：" + e.message); }
  finally { if (btn) btn.disabled = false; }
}
if ($("dsLookup")) $("dsLookup").addEventListener("click", dsLookupFill);

// 貼った内容を読み取って、発行前に確かめられるように見せる
function dsShowRead() {
  const box = document.getElementById("dsRead");
  if (!box) return;
  const rows = parseRows((document.getElementById("dsRows") || {}).value || "");
  if (!rows.length) { box.innerHTML = ""; return; }
  const 足りない = rows.filter((r) => !r.email).length;
  box.innerHTML =
    `<div class="ds-read-h">
       <b>${rows.length}件</b>の宛先を読み取りました
       ${足りない ? `<span class="ds-warn">メールが空：${足りない}件</span>` : '<span class="ds-ok">すべてメールあり</span>'}
     </div>
     <div class="ds-read-b"><table>
       <tr><th style="width:44%">会社名</th><th style="width:20%">担当者</th><th>メール</th></tr>
       ${rows.map((r) => `<tr>
         <td>${esc(r.company)}</td>
         <td class="${r.contact ? "" : "miss"}">${esc(r.contact) || "—"}</td>
         <td class="${r.email ? "" : "miss"}">${esc(r.email) || "—"}</td>
       </tr>`).join("")}
     </table></div>`;
}
if (document.getElementById("dsRows")) {
  let _t = 0;
  document.getElementById("dsRows").addEventListener("input", () => {
    clearTimeout(_t); _t = setTimeout(dsShowRead, 300);
  });
}
