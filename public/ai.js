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
    const d = await (await fetch("/api/ai/status")).json();
    if (d.error) throw new Error(d.error);
    STATE = d;
    render(d);
  } catch (e) {
    $("aiPage").innerHTML = `<div class="ai-empty">読み込めませんでした：${esc(e.message)}</div>`;
  }
}

function render(d) {
  const c = d.control || {};
  const 稼働中 = c.autoImprove;
  const 状態文 = !稼働中
    ? "いまは休んでいます（自動でコードは直しません。監視とSF監査は続けています）"
    : (c.autoApply
      ? (c.inHours ? "稼働中。直したものは本番へ入れます" : `稼働中。いまは時間外（${c.from}〜${c.to}時の外）なので、直してもPRにします`)
      : "稼働中。直したものは本番に入れず、PRにして確認を待ちます");

  const feed = (d.activity || []);
  const notes = d.notes || {};
  const sa = d.lastSfAudit;
  const sayLines = buildSayLines(d);

  $("aiPage").innerHTML = `
    <div class="ai-hero">
      <div class="ai-ava ${稼働中 ? "working" : "sleeping"}">${KITSUTSUKI_SVG}</div>
      <div class="ai-id">
        <div class="ai-name-row">
          <span class="ai-name">${esc(d.name)}</span>
          <button class="ai-rename" id="aiRename">名前を変える</button>
        </div>
        <div class="ai-bubble" id="aiBubble"><span id="aiBubbleText">${esc(sayLines[0] || "")}</span></div>
      </div>
      <span class="ai-live"><span class="ai-dot ${稼働中 ? "" : "off"}"></span>${稼働中 ? "稼働中" : "休止中"}</span>
    </div>

    <div class="ai-grid">
      <div class="ai-card">
        <h3>できること・止める／動かす</h3>
        <div class="ai-ctl">
          <div><div class="ai-ctl-t">自動でコードを直す</div><div class="ai-ctl-d">開発メモから安全なものを順に直す</div></div>
          <button class="ai-sw ${c.autoImprove ? "on" : ""}" id="swImprove" aria-label="自動改善"></button>
        </div>
        <div class="ai-ctl">
          <div><div class="ai-ctl-t">本番へ自動反映</div><div class="ai-ctl-d">OFFなら本番に入れずPRにする</div></div>
          <button class="ai-sw ${c.autoApply ? "on" : ""}" id="swApply" aria-label="本番反映"></button>
        </div>
        <div class="ai-ctl" style="display:block;">
          <div><div class="ai-ctl-t">動かす時間帯（この時間の :30 に動きます）</div><div class="ai-ctl-d">開始〜終了と、何時間おきかを選べます</div></div>
          <div class="ai-range">
            <select id="runFrom">${Array.from({length:24},(_,h)=>h).map((h)=>`<option value="${h}"${c.runFrom===h?" selected":""}>${h}時</option>`).join("")}</select>
            <span>〜</span>
            <select id="runTo">${Array.from({length:24},(_,i)=>i+1).map((h)=>`<option value="${h}"${c.runTo===h?" selected":""}>${h}時</option>`).join("")}</select>
            <select id="runEvery">${[1,2,3,4,6].map((n)=>`<option value="${n}"${c.runEvery===n?" selected":""}>${n}時間おき</option>`).join("")}</select>
          </div>
          <div class="ai-mini" id="aiRunPreview">実行：${(c.runHours||[]).map((h)=>h+":30").join("・") || "（なし）"}</div>
        </div>
        <div class="ai-mini" id="aiCtlMsg">Chatでも操作可：「自動改善を止めて／動かして」「本番反映を止めて」「名前を〇〇にして」</div>
      </div>

      <div class="ai-card">
        <h3>いま抱えている仕事（開発メモ）</h3>
        <div class="ai-num">
          <div><b>${notes.new || 0}</b><span class="u">未対応</span></div>
          <div><b>${notes.doing || 0}</b><span class="u">対応中</span></div>
          <div><b>${notes.done || 0}</b><span class="u">済み</span></div>
        </div>
        <div class="ai-chips" style="margin-top:12px;">
          <span class="ai-chip">エラー ${notes.error || 0}</span>
          <span class="ai-chip">バグ ${notes.bug || 0}</span>
          <span class="ai-chip">要望 ${notes.request || 0}</span>
          <span class="ai-chip">アイデア ${notes.idea || 0}</span>
        </div>
        <div class="ai-mini">${sa
          ? `SF監査：${fmtWhen(sa.at)} に全${sa.lists}リスト確認（ユーザー化 ${sa.ユーザー}・クロス商談 ${sa.クロス}・直近失注 ${sa.失注}）`
          : "SF監査：まだ実行記録がありません（30分ごとに自動で回ります）"}</div>
      </div>

      <div class="ai-card">
        <h3>どこで動いているか</h3>
        <table class="ai-sched"><tbody>
          ${(d.schedule || []).map((s) =>
            `<tr><td class="w">${esc(s.when)}<div class="ww">${esc(s.where)}</div></td>
             <td><b>${esc(s.what)}</b><div class="ww">${esc(s.detail)}</div></td></tr>`).join("")}
        </tbody></table>
        <div class="ai-chips" style="margin-top:10px;">
          ${(d.safety || []).map((x) => `<span class="ai-chip">${esc(x)}</span>`).join("")}
        </div>
      </div>

      <div class="ai-card">
        <h3>最近やったこと</h3>
        ${feed.length
          ? `<ul class="ai-feed">${feed.map((a) =>
              `<li><span class="k ${esc(a.kind)}"></span><div>${esc(a.text)}${a.files && a.files.length ? `<div class="at">${esc(a.files.join("、"))}（${a.lines || 0}行）</div>` : ""}<div class="at">${fmtWhen(a.at)}</div></div></li>`).join("")}</ul>`
          : `<div class="ai-empty">まだ記録がありません。自動改善やSF監査が動くと、ここに出ます。</div>`}
      </div>

      <div class="ai-card ai-mem">
        <h3>覚えていること（このプロジェクトの決めごと・指示）</h3>
        ${(d.memory && d.memory.length)
          ? `<ul>${d.memory.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>`
          : `<div class="ai-empty">まだ記憶がありません。決めごとや指示があると、ここに残ります。</div>`}
      </div>
    </div>`;

  wire();
  startBubble(sayLines);
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
      STATE.control.autoImprove ? "自動改善を止めました。" : "自動改善を動かしました。"));
  const swA = $("swApply");
  if (swA) swA.addEventListener("click", () =>
    putAuto({ autoApply: !STATE.control.autoApply },
      STATE.control.autoApply ? "本番反映を止めました（今後はPR）。" : "本番反映を動かしました。"));

  // 動かす時間帯（開始〜終了・何時間おき）。変更したら保存する。
  const saveRange = () => {
    const runFrom = Number($("runFrom").value);
    const runTo = Number($("runTo").value);
    const runEvery = Number($("runEvery").value);
    if (runTo < runFrom) { $("aiCtlMsg").textContent = "終了は開始より後にしてください。"; return; }
    // 実行時刻のプレビューを先に出す
    const prev = [];
    for (let h = runFrom; h <= runTo; h += runEvery) if (h <= 23) prev.push(h + ":30");
    const pv = $("aiRunPreview"); if (pv) pv.textContent = "実行：" + (prev.join("・") || "（なし）");
    putAuto({ runFrom, runTo, runEvery }, `動かす時間帯を ${runFrom}時〜${runTo}時（${runEvery}時間おき）にしました。`);
  };
  ["runFrom", "runTo", "runEvery"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("change", saveRange);
  });

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
