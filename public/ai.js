// ai.js — AI社員（キツツキ）の可視化ページ。
// /api/ai/status を読んで、名前・自動化の状態・最近の仕事を出す。
// 制御は /api/auto-apply（ON/OFF・稼働時間）と /api/ai/name（改名）を叩く。

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// キツツキが自分のデスクで働いている場面（kinbotの緑トンマナ）。
// 稼働中は頭がキーを打つように「つつく」、休止中は目を閉じてZzz。CSSで切り替える。
const KITSUTSUKI_SVG = `
<svg viewBox="0 0 130 96" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g class="kt-body">
    <ellipse cx="50" cy="54" rx="18" ry="21" fill="#5DCAA5"/>
    <path d="M50 34c10 0 16 8 16 17 0 6-2 10-4 13-3-2-6-6-7-12-1-6 2-13-5-18z" fill="#1d9e75"/>
  </g>
  <g class="kt-head">
    <circle cx="48" cy="30" r="14" fill="#0d5b47"/>
    <path d="M46 6c1-3 4-4 6-2-1 3-3 4-6 2z" fill="#e05a4b"/>
    <path d="M40 10c1-2 3-2 4 0l1 4-4 1c-1-1-2-3-1-5z" fill="#c9a24b"/>
    <path d="M59 30l11 6-11 5c-2-3-2-8 0-11z" fill="#c9a24b"/>
    <circle class="kt-eye-open" cx="53" cy="27" r="3.6" fill="#fff"/>
    <circle class="kt-eye-open" cx="54" cy="27" r="1.8" fill="#0d5b47"/>
    <path class="kt-eye-shut" d="M50 28q3.2 2.6 6.4 0" stroke="#eaf6f1" stroke-width="1.9" fill="none" stroke-linecap="round"/>
  </g>
  <g class="kt-desk">
    <rect x="4" y="72" width="122" height="9" rx="3" fill="#b98a3e"/>
    <rect x="4" y="72" width="122" height="2.6" rx="1.3" fill="#d0a154"/>
    <rect x="9" y="81" width="112" height="8" fill="#8f6a2e"/>
    <rect x="16" y="89" width="6" height="7" rx="1.5" fill="#7a5a27"/>
    <rect x="108" y="89" width="6" height="7" rx="1.5" fill="#7a5a27"/>
  </g>
  <g class="kt-laptop">
    <rect x="74" y="50" width="30" height="20" rx="2.5" fill="#0d5b47"/>
    <rect class="kt-screen" x="77" y="53" width="24" height="14" rx="1.5" fill="#5DCAA5"/>
    <rect x="70" y="69" width="38" height="4" rx="2" fill="#124e3f"/>
  </g>
  <g class="kt-coffee">
    <path class="kt-steam" d="M20 60c-1.4-2 1-3.4 0-5.4" stroke="#eaf6f1" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    <rect x="15" y="63" width="11" height="9" rx="2" fill="#eef7f3"/>
    <path d="M26 65c3.2 0 3.2 4.4 0 4.4" stroke="#eef7f3" stroke-width="1.8" fill="none"/>
  </g>
  <g class="kt-plant">
    <rect x="110" y="62" width="11" height="10" rx="1.6" fill="#8f6a2e"/>
    <path d="M115.5 62c-3.2-3-2.4-7.4 0-9.6 2.2 2.2 3.2 6.4 0 9.6z" fill="#1d9e75"/>
    <path d="M115.5 62c3.2-2 6.6-1 7.6 1.2-2.2 2.2-6.4 2-7.6-1.2z" fill="#5DCAA5"/>
  </g>
  <g class="kt-zzz" aria-hidden="true">
    <text x="64" y="16" font-size="10" fill="#ffffff" font-family="sans-serif">z</text>
    <text x="71" y="10" font-size="8" fill="#ffffff" font-family="sans-serif">z</text>
    <text x="77" y="5" font-size="6" fill="#ffffff" font-family="sans-serif">z</text>
  </g>
</svg>`;

function fmtWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()} ${p(j.getUTCHours())}:${p(j.getUTCMinutes())}`;
}

let STATE = null;
let _bubbleTimer = null;

// 次の自動改善の時刻を、田中さんが選んだ「動かす時刻(runHours)」から求めて文にする。
function nextRunLabel(c) {
  if (!c || !c.autoImprove) return "";
  const hours = (Array.isArray(c.runHours) && c.runHours.length ? c.runHours : [9, 11, 13, 15, 17, 19, 20])
    .slice().sort((a, b) => a - b);
  const d = new Date(Date.now() + (new Date().getTimezoneOffset() * 60000) + 9 * 3600000); // JST
  const cur = d.getHours() + d.getMinutes() / 60;
  const nx = hours.find((h) => h + 0.5 > cur);   // その時刻の:30
  const h = nx != null ? nx : hours[0];
  const hhmm = `${String(h).padStart(2, "0")}:30`;
  return nx != null ? `次の自動改善は ${hhmm} です` : `次は 明日 ${hhmm} に動きます`;
}

// いま何をしているか（発言）の候補を、状態から組み立てる。順に吹き出しへ出す。
function buildSayLines(d) {
  const c = d.control || {};
  if (!c.autoImprove) {
    return ["すこし休憩中です… zzz", "呼ばれたら、すぐ動きます", "「動かして」で起こしてください"];
  }
  const act = d.activity || [];
  const n = d.notes || {};
  const lines = [];
  const order = act.find((a) => a.kind === "fix-order");
  if (order) lines.push(`「${String(order.text).replace(/^指示：/, "")}」に取りかかっています`);
  const done = act.find((a) => a.kind === "fix-applied" || a.kind === "fix-pr" || a.kind === "notes-done");
  if (done) lines.push(`さっき ${String(done.text)}`);
  lines.push((n.new || 0) > 0 ? `未対応の開発メモを ${n.new}件、順に片づけています` : "開発メモはひと段落。次の出番を待っています");
  lines.push("SFの様子も気にかけています");
  const nr = nextRunLabel(c);
  if (nr) lines.push(nr);
  lines.push(c.autoApply ? "直したものは本番へ入れます" : "直したものはPRにして確認を待ちます");
  return lines.filter(Boolean);
}

// 吹き出しの文を、一定間隔で切り替える（発言している感じ）。
function startBubble(lines) {
  if (_bubbleTimer) { clearInterval(_bubbleTimer); _bubbleTimer = null; }
  const el = $("aiBubbleText");
  if (!el || !lines || lines.length <= 1) return;
  let i = 0;
  _bubbleTimer = setInterval(() => {
    i = (i + 1) % lines.length;
    el.style.opacity = "0";
    setTimeout(() => { el.textContent = lines[i]; el.style.opacity = "1"; }, 220);
  }, 3800);
}

async function load() {
  try {
    const [d, dn, org] = await Promise.all([
      (await fetch("/api/ai/status")).json(),
      (await fetch("/api/dev-notes")).json().catch(() => ({ items: [] })),
      (await fetch("/api/ai/org")).json().catch(() => null),
    ]);
    if (d.error) throw new Error(d.error);
    const items = (dn && dn.items) || [];
    d.noteItems = {
      done: items.filter((x) => x.status === "done"),
      doing: items.filter((x) => x.status === "doing"),
      new: items.filter((x) => x.status === "new" || !x.status),
    };
    d.org = org && org.ok ? org : null;
    STATE = d;
    render(d);
  } catch (e) {
    $("aiPage").innerHTML = `<div class="ai-empty">読み込めませんでした：${esc(e.message)}</div>`;
  }
}

function orgHtml(org) {
  if (!org || !org.depts) return "";
  const chip = (s) => s === "on" ? `<span class="ai-jstate on">ON</span>`
    : s === "off" ? `<span class="ai-jstate off">OFF</span>`
    : `<span class="ai-jstate always">常時</span>`;
  const dept = (D) => `
    <div class="ai-dept">
      <div class="ai-dept-h"><span class="ai-dept-name">${esc(D.name)}</span><span class="ai-dept-c">${D.jobs.length}</span></div>
      <div class="ai-dept-d">${esc(D.desc || "")}</div>
      <ul class="ai-jobs">
        ${D.jobs.map((j) => `<li class="ai-job">
          <div class="ai-job-top">${chip(j.state)}<span class="ai-job-name">${esc(j.name)}</span><span class="ai-job-trg">${esc(j.trigger || "")}</span>${j.extra ? `<span class="ai-job-ex">${esc(j.extra)}</span>` : ""}</div>
          <div class="ai-job-d">${esc(j.detail || "")}</div>
        </li>`).join("")}
      </ul>
    </div>`;
  return `<div class="ai-org">
    <div class="ai-org-h">組織：わたし(キツツキ・CEO)が、下の2つのAIに指示・連携しています。あなたの決めごとは、上のチャットから伝えてください。</div>
    <div class="ai-org-cols">${org.depts.map(dept).join("")}</div>
  </div>`;
}

function orgHtml_unused() { return ""; }

const KIND_LABEL = { error: "エラー", bug: "バグ", gap: "できないこと", request: "要望", idea: "アイデア" };
function noteLi(n) {
  const k = KIND_LABEL[n.kind] || "メモ";
  return `<li class="ai-task"><span class="ai-task-k ai-k-${esc(n.kind || "")}">${esc(k)}</span><span class="ai-task-t">${esc(n.title || "")}</span></li>`;
}

const ICON_SUP = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13a8 8 0 0 1 16 0"/><rect x="2.5" y="13" width="3.5" height="6" rx="1.5"/><rect x="18" y="13" width="3.5" height="6" rx="1.5"/><path d="M20 19a3 3 0 0 1-3 3h-2"/></svg>`;
const ICON_DEV = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 8l-4 4 4 4"/><path d="M16 8l4 4-4 4"/><path d="M13 6l-2 12"/></svg>`;

// 依頼チャットの履歴（この画面を開いている間だけ保持）。既定は空。
let CHAT = [];
function chatHtml() {
  return CHAT.map((m) =>
    `<div class="ai-msg ${m.who === "me" ? "me" : "ai"}">${esc(m.text)}</div>`).join("");
}

const 状態チップ = (s) => s === "on" ? `<span class="ai-st on">ON</span>`
  : s === "off" ? `<span class="ai-st off">OFF</span>`
  : `<span class="ai-st always">常時</span>`;

async function loadSfStatus() {
  const box = $("sfStatus"); if (!box) return;
  box.textContent = "読み込んでいます…";
  try {
    const d = await (await fetch("/api/ai/sf-status")).json();
    if (d.error) { box.innerHTML = `<div class="ai-empty">${esc(d.error)}</div>`; return; }
    const 取りこぼし警告 = d["取りこぼし待ち"] > 0;
    const tile = (label, val, warn) => `<div class="sf-tile ${warn ? "warn" : ""}"><b>${val}</b><span>${esc(label)}</span></div>`;
    const sa = d["SF監査"];
    box.innerHTML = `
      <div class="sf-tiles">
        ${tile("今日のSF記録", d["今日のSF記録"] ?? 0)}
        ${tile("取りこぼし待ち", d["取りこぼし待ち"] ?? 0, 取りこぼし警告)}
        ${tile("未紐づけ", d["未紐づけ"] ?? 0, (d["未紐づけ"] || 0) > 0)}
        ${tile("立ち上げ待ち", d["立ち上げ待ち"] ?? 0, (d["立ち上げ待ち"] || 0) > 0)}
      </div>
      <div class="ai-mini">${sa ? `SF監査：${fmtWhen(sa.at)}（全${sa["リスト"]}リスト・ユーザー化 ${sa["ユーザー化"]}・クロス ${sa["クロス"]}・失注 ${sa["失注"]}）` : "SF監査：まだ実行記録がありません（30分ごとに回ります）"}</div>
      ${(d["直近の失敗理由"] || []).length ? `<div class="ai-subh" style="margin-top:8px;">立ち上がらなかった理由</div><ul class="ai-tasks">${d["直近の失敗理由"].map((x) => `<li class="ai-task"><span class="ai-task-t">${esc(x.company || "")}：${esc(x["理由"])}</span></li>`).join("")}</ul>` : ""}
      <div class="ai-mini" style="margin-top:6px;">${取りこぼし警告 ? "取りこぼしが残っています（10分ごとの見回りで拾われます。長く残るなら要確認）。" : "取りこぼしはありません。順調です。"}</div>
      <div class="ai-subh" style="margin-top:10px;">コール進捗の送信先</div>
      <div id="crTargets" class="cr-targets">読み込んでいます…</div>
      <div class="modal-actions" style="margin-top:8px;flex-wrap:wrap;gap:8px;">
        <button class="btn" id="sendCallReport" type="button">コール進捗を今すぐ送る</button>
        <button class="pr-b" id="restoreApos" type="button">除外されたアポを戻す（テスト以外）</button>
        <span class="saved" id="sendCallMsg" hidden></span>
        <span class="ai-mini" id="restoreMsg"></span>
      </div>`;
    // 送信先の一覧（選ばなければ、いつもの送信先へ）
    try {
      const tg = await (await fetch("/api/chat-targets")).json();
      const list = (tg.targets || tg.items || tg.rows || []).filter((x) => x && x.id);
      const box2 = $("crTargets");
      if (box2) box2.innerHTML = list.length
        ? list.map((x) => `<label class="cr-t"><input type="checkbox" class="cr-cb" value="${esc(String(x.id))}"> ${esc(x.name || x.space_id || ("#" + x.id))}</label>`).join("")
        : `<span class="ai-mini">（登録された送信先がありません。いつもの送信先へ送ります）</span>`;
    } catch { const box2 = $("crTargets"); if (box2) box2.innerHTML = `<span class="ai-mini">送信先を読み込めませんでした（いつもの送信先へ送ります）</span>`; }
    const rb = $("restoreApos");
    if (rb) rb.addEventListener("click", async () => {
      if (!confirm("集計から外れているアポのうち、テスト以外を集計に戻します。よろしいですか？")) return;
      rb.disabled = true; const rm = $("restoreMsg"); if (rm) rm.textContent = "戻しています…";
      try {
        const r = await fetch("/api/apo/excluded/restore-real", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ days: 60 }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "戻せませんでした");
        if (rm) rm.textContent = `${d["戻した件数"]}件を集計に戻しました（テスト ${d["残した件数"]}件はそのまま）`;
      } catch (e) { if (rm) rm.textContent = "失敗：" + e.message; }
      finally { rb.disabled = false; }
    });
    const scr = $("sendCallReport");
    if (scr) scr.addEventListener("click", async () => {
      scr.disabled = true; const t = scr.textContent; scr.textContent = "送信中…";
      try {
        const picked = [...document.querySelectorAll(".cr-cb:checked")].map((x) => x.value);
        const r = await fetch("/api/ai/call-report/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetIds: picked }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "送信できませんでした");
        const m = $("sendCallMsg"); if (m) { m.textContent = "送信しました"; m.hidden = false; }
      } catch (e) { alert("送信できませんでした：" + e.message); }
      finally { scr.disabled = false; scr.textContent = t; }
    });
  } catch (e) { box.innerHTML = `<div class="ai-empty">読み込めませんでした：${esc(e.message)}</div>`; }
}

function dlFile(name, text, mime) {
  const blob = new Blob([text], { type: (mime || "text/plain") + ";charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function loadProgress() {
  const box = $("devProgress"); if (!box) return;
  try {
    const d = await (await fetch("/api/ai/progress")).json();
    if (!d || !d.text) { box.textContent = ""; return; }
    const cls = d.phase === "running" ? "run" : d.phase === "failure" ? "fail" : d.phase === "success" ? "ok" : "";
    box.className = "dev-progress " + cls;
    box.innerHTML = `<span class="dot"></span>${esc(d.text)}` + (d.runUrl ? ` <a href="${esc(d.runUrl)}" target="_blank" rel="noopener">ログ</a>` : "");
  } catch { box.textContent = ""; }
}
async function runPrReport() {
  const prb = $("prReport"); const list = $("prList");
  const mode = (document.querySelector('input[name="prmode"]:checked') || {}).value || "detail";
  const merged = ($("prMerged") || {}).checked ? 7 : 0;
  if (prb) { prb.disabled = true; prb.textContent = "PRを確認中…"; }
  try {
    const r = await fetch(`/api/ai/prs?mode=${mode}&mergedDays=${merged}`);
    const d = await r.json();
    if (r.status === 403) { if (list) list.innerHTML = `<div class="ai-empty">権限がありません。</div>`; return; }
    if (!r.ok) throw new Error(d.error || "取得できませんでした");
    const head = d.count ? `PRは ${d.openN}件がオープン中、直近デプロイ済みが ${d.mergedN}件です。` + (d.synced ? `（デプロイ済みを反映：対応済み ${d.synced}件）` : "") : "いま報告できるPRはありません。";
    CHAT.push({ who: "ai", text: [head].concat((d.prs || []).slice(0, 8).map((p) => `・#${p.number} ${p.title}${p.state === "merged" ? "（デプロイ済み）" : ""}`)).join("\n") });
    const chat = $("aiChat"); if (chat) { chat.innerHTML = chatHtml(); chat.scrollTop = chat.scrollHeight; }
    if (d.synced) setTimeout(load, 600);   // 対応中の件数を更新
    if (list) {
      const dlrow = `<div class="pr-dl"><button class="pr-b" data-dl="md">MDでダウンロード</button><button class="pr-b" data-dl="txt">テキストでダウンロード</button></div>
        <div class="ai-empty" style="margin:4px 0 0">内容の確認・ダウンロード用です。実際のデプロイ（本番反映）は開発チャットで行います。</div>`;
      list.innerHTML = dlrow + (d.prs || []).map((p) => {
        const files = (p.files || []).slice(0, 12).map((f) => `<div class="pr-f">${esc(f.name)} <span>+${f.add}/-${f.del}</span></div>`).join("");
        const badge = p.state === "merged" ? `<span class="pr-badge merged">デプロイ済み</span>` : `<span class="pr-badge open">オープン</span>`;
        return `<div class="pr-item" data-num="${p.number}">
          <div class="pr-h">#${p.number} ${esc(p.title)} ${badge}</div>
          <div class="pr-sum">${esc(p.summary || (p.body ? p.body.slice(0,120) : ""))}</div>
          <div class="pr-files">${files || "（変更ファイル情報なし）"}</div>
          <div class="pr-ops">
            <button class="pr-b" data-act="diff">差分を見る</button>
            <a class="pr-b" href="${esc(p.url)}" target="_blank" rel="noopener">GitHubで開く</a>
            <button class="pr-b done" data-act="done">このPRを対応済みにする</button>
          </div>
          <pre class="pr-diff" hidden></pre>
        </div>`;
      }).join("");
      list.querySelectorAll("[data-dl]").forEach((b) => b.addEventListener("click", () => {
        const stamp = new Date().toISOString().slice(0, 10);
        if (b.dataset.dl === "md") dlFile(`PR報告_${stamp}.md`, d.md || "", "text/markdown");
        else dlFile(`PR報告_${stamp}.txt`, d.txt || d.md || "", "text/plain");
      }));
      list.querySelectorAll(".pr-item").forEach((it) => {
        const num = it.dataset.num;
        const diffBtn = it.querySelector('[data-act="diff"]');
        if (diffBtn) diffBtn.addEventListener("click", async () => {
          const pre = it.querySelector(".pr-diff");
          if (!pre.hidden) { pre.hidden = true; return; }
          pre.hidden = false; pre.textContent = "差分を読み込み中…";
          try { const dd = await (await fetch(`/api/ai/pr/${num}/diff`)).json(); pre.textContent = dd.diff || dd.error || "（差分なし）"; }
          catch (err) { pre.textContent = "差分を取得できませんでした：" + err.message; }
        });
        const doneBtn = it.querySelector('[data-act="done"]');
        if (doneBtn) doneBtn.addEventListener("click", async (e) => {
          e.target.disabled = true; const t = e.target.textContent; e.target.textContent = "更新中…";
          try {
            const dd = await (await fetch("/api/ai/mark-done", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pr: num }) })).json();
            if (dd.error) throw new Error(dd.error);
            CHAT.push({ who: "ai", text: dd.reply || `PR #${num} の開発メモを対応済みにしました。` });
            const c = $("aiChat"); if (c) { c.innerHTML = chatHtml(); c.scrollTop = c.scrollHeight; }
            e.target.textContent = "対応済みにしました";
            setTimeout(load, 700);
          } catch (err) { alert("できませんでした：" + err.message); e.target.disabled = false; e.target.textContent = t; }
        });
      });
    }
  } catch (e) { if (list) list.innerHTML = `<div class="ai-empty">できませんでした：${esc(e.message)}</div>`; }
  finally { if (prb) { prb.disabled = false; prb.textContent = "PRを報告する"; } }
}

function render(d) {
  const c = d.control || {};
  const 稼働中 = c.autoImprove;
  const ni = d.noteItems || { done: [], doing: [], new: [] };
  const feed = (d.activity || []);
  const sa = d.lastSfAudit;
  const org = d.org || { depts: [] };
  const dept = (key) => (org.depts || []).find((x) => x.key === key) || { name: key, desc: "", jobs: [] };
  const support = dept("support"), dev = dept("dev");
  const onCount = (jobs) => jobs.filter((j) => j.state === "on" || j.state === "always").length;

  const jobRow = (j, right) =>
    `<div class="ai-jrow"><span class="ai-jn">${esc(j.name)}<span class="ai-jt">${esc(j.trigger || "")}</span></span>${right || 状態チップ(j.state)}</div>`;

  // 社内支援AI：先頭3ジョブを要約に、残りは詳細に
  const supTop = support.jobs.slice(0, 3).map((j) => jobRow(j)).join("");
  const supRest = support.jobs.slice(3).map((j) => jobRow(j)).join("");
  // 開発AI：コードを自動で直す＝スイッチ、本番反映＝スイッチ、他はそのまま
  const devSwitches =
    `<div class="ai-jrow"><span class="ai-jn">コードを自動で直す<span class="ai-jt">動かす時間帯 ${c.runFrom ?? 0}〜${c.runTo ?? 24}時</span></span>` +
    `<button class="ai-sw ${c.autoImprove ? "on" : ""}" id="swImprove" aria-label="コードを自動で直す"></button></div>` +
    `<div class="ai-jrow"><span class="ai-jn">本番へ自動反映<span class="ai-jt">OFFならPRにする</span></span>` +
    `<button class="ai-sw ${c.autoApply ? "on" : ""}" id="swApply" aria-label="本番へ自動反映"></button></div>`;
  const devRest = dev.jobs.filter((j) => !/コードを自動で直す|本番へ自動反映/.test(j.name)).map((j) => jobRow(j)).join("");

  $("aiPage").innerHTML = `
    <div class="ceo-card">
      <div class="ceo-ava ${稼働中 ? "working" : "sleeping"}">${KITSUTSUKI_SVG}</div>
      <div class="ceo-main">
        <div class="ceo-top">
          <span class="ceo-name">${esc(d.name)}</span>
          <span class="ceo-badge">CEO</span>
          <button class="ai-rename" id="aiRename">名前を変える</button>
        </div>
        <p class="ceo-sub">あなたの決めごとを伝えると、下の2つのAIに指示・連携します。</p>
        <div class="ceo-input">
          <textarea id="aiTaskInput" rows="1" placeholder="例：SF未紐づけ通知を止めて / 実績のバグを直して（Shift+Enterで改行）" autocomplete="off"></textarea>
          <button id="aiTaskSend" class="ai-send">送る</button>
        </div>
        <div class="ceo-quick">
          <button class="ai-q" data-q="今日の状況を教えて">今日の状況を教えて</button>
          <button class="ai-q" data-q="開発を止めて">開発を止めて</button>
          <button class="ai-q" data-q="アポ割り振りを確認">アポ割り振りを確認</button>
          <span class="ceo-llm"><span>頭脳</span>
            <select id="aiProvider">
              <option value="gemini">Gemini</option>
              <option value="claude">Claude</option>
            </select>
          </span>
        </div>
        <div class="ai-ctlmsg" id="aiCtlMsg"></div>
        <div class="ai-chat mini" id="aiChat"></div>
      </div>
    </div>

    <div class="dept-grid">
      <div class="dept-card">
        <div class="dept-head">
          <span class="dept-ico sup">${ICON_SUP}</span>
          <span class="dept-name">社内支援AI</span>
          <span class="dept-badge">稼働中</span>
        </div>
        <p class="dept-desc">${esc(support.desc || "通知・SF記録・監査・アポ・実績など")}</p>
        <div class="dept-stats">
          <div class="dept-stat"><b>${support.jobs.length}</b><span>動いている仕事</span></div>
          <div class="dept-stat"><b>${onCount(support.jobs)}</b><span>ON・常時</span></div>
        </div>
        <div class="dept-jobs">${supTop}</div>
        <div class="dept-more" id="more-support" hidden>
          ${supRest}
          <div class="ai-subh" style="margin-top:8px;">SFの状況（今日）</div>
          <div id="sfStatus" class="sf-status">読み込んでいます…</div>
        </div>
        <button class="dept-btn" data-dept="support">この部門を見る・操作する</button>
      </div>

      <div class="dept-card">
        <div class="dept-head">
          <span class="dept-ico dev">${ICON_DEV}</span>
          <span class="dept-name">開発AI</span>
          <span class="dept-badge ${稼働中 ? "" : "off"}">${稼働中 ? "稼働中" : "休止中"}</span>
        </div>
        <p class="dept-desc">${esc(dev.desc || "エラー・バグ・要望への修正")}</p>
        <div class="dept-stats">
          <div class="dept-stat"><b>${ni.doing.length}</b><span>対応中</span></div>
          <div class="dept-stat"><b>${ni.new.length}</b><span>未対応</span></div>
          <div class="dept-stat"><b>${(nextRunLabel(c).match(/\d{1,2}:\d{2}/) || [c.autoImprove ? "—" : "休止中"])[0]}</b><span>次の改善</span></div>
        </div>
        <div class="dept-jobs">${devSwitches}</div>
        <div class="dev-progress" id="devProgress"></div>
        <div class="dept-actions">
          <div class="pr-opt">
            <label><input type="radio" name="prmode" value="detail" checked> 詳細</label>
            <label><input type="radio" name="prmode" value="summary"> サマリ</label>
            <label><input type="checkbox" id="prMerged" checked> 直近デプロイ済みも</label>
          </div>
          <button class="dept-mini" id="prReport">PRを報告する</button>
          <div class="pr-list" id="prList"></div>
        </div>
        <div class="dept-more" id="more-dev" hidden>
          ${devRest}
          <div class="ai-jrow" style="align-items:center;"><span class="ai-jn">稼働時間<span class="ai-jt">この時間の :30 に動きます</span></span>
            <span class="ai-range">
              <select id="runFrom">${Array.from({length:24},(_,h)=>h).map((h)=>`<option value="${h}"${c.runFrom===h?" selected":""}>${h}時</option>`).join("")}</select>
              <span>〜</span>
              <select id="runTo">${Array.from({length:24},(_,i)=>i+1).map((h)=>`<option value="${h}"${c.runTo===h?" selected":""}>${h}時</option>`).join("")}</select>
              <select id="runEvery">${[1,2,3,4,6].map((n)=>`<option value="${n}"${c.runEvery===n?" selected":""}>${n}時間おき</option>`).join("")}</select>
            </span>
          </div>
          <div class="ai-subh" style="margin-top:6px;">対応中の仕事</div>
          ${ni.doing.length ? `<ul class="ai-tasks">${ni.doing.slice(0,20).map(noteLi).join("")}</ul>` : `<div class="ai-empty">なし</div>`}
          <div class="ai-subh" style="margin-top:8px;">最近直したこと</div>
          ${ni.done.length ? `<ul class="ai-tasks">${ni.done.slice(0,10).map(noteLi).join("")}</ul>` : `<div class="ai-empty">まだありません。</div>`}
        </div>
        <button class="dept-btn" data-dept="dev">この部門を見る・操作する</button>
      </div>
    </div>`;

  wire();
  const chat = $("aiChat"); if (chat) { chat.innerHTML = chatHtml(); chat.scrollTop = chat.scrollHeight; }
}

async function putAuto(patch, msg) {
  const box = $("aiCtlMsg");
  if (box) box.textContent = "反映しています…";
  try {
    const d = await (await fetch("/api/auto-apply", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch),
    })).json();
    if (d.error) throw new Error(d.error);
    if (box) box.textContent = msg || "反映しました。";
    await load();
  } catch (e) {
    if (box) box.textContent = "できませんでした：" + e.message;
  }
}

function wire() {
  const swI = $("swImprove");
  if (swI) swI.addEventListener("click", () =>
    putAuto({ enabled: !STATE.control.autoImprove },
      STATE.control.autoImprove ? "AIを止めました（自動では動きません）。" : "AIを動かしました。"));
  const swA = $("swApply");
  if (swA) swA.addEventListener("click", () =>
    putAuto({ autoApply: !STATE.control.autoApply },
      STATE.control.autoApply ? "本番反映を止めました（今後はPR）。" : "本番反映を動かしました。"));

  // 動かす時間帯（開始〜終了・何時間おき）。変更したら保存する。
  const saveRange = () => {
    const runFrom = Number($("runFrom").value);
    const runTo = Number($("runTo").value);
    const runEvery = Number($("runEvery").value);
    if (runTo < runFrom) { const m = $("aiCtlMsg"); if (m) m.textContent = "終了は開始より後にしてください。"; return; }
    const pv = $("aiRunPreview"); if (pv) {
      const prev = []; for (let h = runFrom; h <= runTo; h += runEvery) if (h <= 23) prev.push(h + ":30");
      pv.textContent = "実行：" + (prev.join("・") || "（なし）");
    }
    putAuto({ runFrom, runTo, runEvery }, `動かす時間帯を ${runFrom}時〜${runTo}時（${runEvery}時間おき）にしました。`);
  };
  ["runFrom", "runTo", "runEvery"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("change", saveRange);
  });

  // タスク依頼（会話）
  const send = async () => {
    const inp = $("aiTaskInput");
    const text = (inp && inp.value || "").trim();
    if (!text) return;
    CHAT.push({ who: "me", text });
    CHAT.push({ who: "ai", text: "考えています…" });
    const chat = $("aiChat"); if (chat) { chat.innerHTML = chatHtml(); chat.scrollTop = chat.scrollHeight; }
    if (inp) { inp.value = ""; inp.style.height = "auto"; inp.focus(); }
    const provider = (document.getElementById("aiProvider") || {}).value || "gemini";
    const history = CHAT.slice(0, -2).slice(-8);   // 直近の履歴（今回の2件は除く）
    try {
      const r = await fetch("/api/ai/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, provider, history }),
      });
      const d = await r.json();
      if (r.status === 403) CHAT[CHAT.length - 1] = { who: "ai", text: "権限がありません（このAI社員を操作できるのはオーナーだけです）。" };
      else if (!r.ok) CHAT[CHAT.length - 1] = { who: "ai", text: "うまくいきませんでした：" + (d.error || "") };
      else CHAT[CHAT.length - 1] = { who: "ai", text: d.reply || "…" };
      if (d.action === "pr-report") { const chatX = $("aiChat"); if (chatX) { chatX.innerHTML = chatHtml(); } setTimeout(runPrReport, 200); }
    } catch (e) {
      CHAT[CHAT.length - 1] = { who: "ai", text: "送れませんでした：" + e.message };
    }
    const chat2 = $("aiChat"); if (chat2) { chat2.innerHTML = chatHtml(); chat2.scrollTop = chat2.scrollHeight; }
  };
  const sb = $("aiTaskSend"); if (sb) sb.addEventListener("click", send);
  const ti = $("aiTaskInput");
  if (ti) {
    const grow = () => { ti.style.height = "auto"; ti.style.height = Math.min(140, ti.scrollHeight) + "px"; };
    ti.addEventListener("input", grow);
    ti.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });
  }
  // クイック指示ボタン：入力欄に入れて送る
  document.querySelectorAll(".ai-q").forEach((b) => b.addEventListener("click", () => {
    const inp = $("aiTaskInput"); if (inp) { inp.value = b.dataset.q || ""; }
    send();
  }));
  // 部門の「見る・操作する」で詳細を開閉
  document.querySelectorAll(".dept-btn").forEach((b) => b.addEventListener("click", () => {
    const more = $("more-" + b.dataset.dept);
    if (more) { const open = !more.hidden; more.hidden = open; b.textContent = open ? "この部門を見る・操作する" : "とじる";
      if (!open && b.dataset.dept === "support") loadSfStatus(); }
  }));
  // PRを報告（一覧表示＋差分＋デプロイ＋md/txtダウンロード）
  const prb = $("prReport");
  if (prb) prb.addEventListener("click", () => runPrReport());
  // 進捗を定期取得
  loadProgress();
  if (window.__aiProgTimer) clearInterval(window.__aiProgTimer);
  window.__aiProgTimer = setInterval(loadProgress, 12000);

  const rn = $("aiRename");
  if (rn) rn.addEventListener("click", async () => {
    const name = prompt("AI社員の新しい名前を入れてください", STATE.name || "");
    if (name == null) return;
    const v = String(name).trim().slice(0, 20);
    if (!v) return;
    try {
      const d = await (await fetch("/api/ai/name", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: v }),
      })).json();
      if (d.error) throw new Error(d.error);
      await load();
    } catch (e) { alert("変えられませんでした：" + e.message); }
  });
}

load();
