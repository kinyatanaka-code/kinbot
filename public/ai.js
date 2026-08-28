// ai.js — AI社員（キツツキ）の可視化ページ。
// /api/ai/status を読んで、名前・自動化の状態・最近の仕事を出す。
// 制御は /api/auto-apply（ON/OFF・稼働時間）と /api/ai/name（改名）を叩く。

const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// キツツキのアバター（kinbotの緑トンマナ）。
// 頭を <g class="kt-head"> にまとめて「つつく」動きに、目は開き/閉じの2種、右上に Zzz を用意。
// 稼働中／休止中の切り替えはCSS（.ai-ava.working / .ai-ava.sleeping）で行う。
const KITSUTSUKI_SVG = `
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <g class="kt-body">
    <ellipse cx="30" cy="38" rx="15" ry="17" fill="#5DCAA5"/>
    <path d="M30 21c9 0 15 6 15 15 0 4-1 7-3 10-3-1-6-4-7-8-1-5 1-11-5-17z" fill="#1d9e75"/>
    <path d="M40 46c3 2 5 5 5 9-3 0-6-2-8-5z" fill="#0d5b47"/>
    <path d="M26 55l2 5M33 55l2 5" stroke="#c9a24b" stroke-width="2.4" stroke-linecap="round"/>
  </g>
  <g class="kt-head">
    <circle cx="27" cy="20" r="12" fill="#0d5b47"/>
    <path d="M17 15c-2-2-2-5 1-6l6 3-3 6c-2 0-3-1-4-3z" fill="#c9a24b"/>
    <path d="M27 8c1-3 4-4 6-2-1 2-3 3-6 2z" fill="#e05a4b"/>
    <circle class="kt-eye-open" cx="30" cy="19" r="3.4" fill="#fff"/>
    <circle class="kt-eye-open" cx="31" cy="19" r="1.7" fill="#0d5b47"/>
    <path class="kt-eye-shut" d="M27 19.5q3 2.5 6 0" stroke="#eaf6f1" stroke-width="1.8" fill="none" stroke-linecap="round"/>
  </g>
  <g class="kt-zzz" aria-hidden="true">
    <text x="44" y="16" font-size="9" fill="#ffffff" font-family="sans-serif">z</text>
    <text x="50" y="11" font-size="7" fill="#ffffff" font-family="sans-serif">z</text>
    <text x="55" y="7"  font-size="5" fill="#ffffff" font-family="sans-serif">z</text>
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

// 次の自動改善の時刻（日本時間 9:30〜20:30 の決まった時刻）を文にする。
function nextRunLabel(c) {
  if (!c || !c.autoImprove) return "";
  const t = [[9, 30], [11, 30], [13, 30], [15, 30], [17, 30], [19, 30], [20, 30]];
  const d = new Date(Date.now() + (new Date().getTimezoneOffset() * 60000) + 9 * 3600000); // JST
  const cur = d.getHours() * 60 + d.getMinutes();
  const nx = t.find(([h, m]) => h * 60 + m > cur);
  const [h, m] = nx || t[0];
  const hhmm = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  return nx ? `次の自動改善は ${hhmm} です` : `次は 明日 ${hhmm} に動きます`;
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
        <div class="ai-ctl">
          <div><div class="ai-ctl-t">本番に入れてよい時間帯</div><div class="ai-ctl-d">この外で直したものはPRになる</div></div>
          <div class="ai-hours">
            <input type="number" id="hFrom" min="0" max="24" value="${c.from}" /><span>〜</span>
            <input type="number" id="hTo" min="0" max="24" value="${c.to}" /><span>時</span>
          </div>
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

  const applyHours = () => {
    const from = Math.max(0, Math.min(24, parseInt($("hFrom").value, 10) || 0));
    const to = Math.max(0, Math.min(24, parseInt($("hTo").value, 10) || 24));
    putAuto({ from, to }, `本番に入れてよい時間帯を ${from}〜${to}時 にしました。`);
  };
  ["hFrom", "hTo"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("change", applyHours);
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
