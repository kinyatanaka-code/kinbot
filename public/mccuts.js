// リスト管理の「切り口で見る」タブ（2026-11-27 福井さん「18の切り口で全件把握」「今かける理由と保存した絞り込み」）
//   MOCHICALL のリード全件を、18の切り口ごとの件数とアポ率で見る。項目を押すと条件に足し、もう一度押すと外す。
//   「押したとき」を「除く」にするか、Shift か Alt を押しながら押すと「除く」になる。条件どうしは「すべて満たす」か「どれかを満たす」。
//   保存した絞り込みは管理者どうしで共有する（DB に保存）。データがまだ無い切り口は「まだ無い／一部だけ」と出すだけ
(function () {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (u, o = {}) => { const r = await fetch(u, { credentials: "include", ...o }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j; };
  const post = (u, b) => api(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
  const nf = (n) => Number(n || 0).toLocaleString();
  // アポ率（アポ ÷ 架電）。架電が無いものは「-」
  const rate = (apo, called) => (called ? `${(apo / called * 100).toFixed(1)}%` : "-");
  const ST = { ok: "本番で数えられる", part: "一部だけ", none: "まだ無い" };
  const SAVE_ICO = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3.5h9.5L20 8v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19V5a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M8 3.5v5h7v-5M8 20.5v-6h8v6"/></svg>';
  // 条件：inc（含む）・exc（除く）は {切り口: [値]}。このブラウザにだけ覚える（画面を開き直しても続きから）
  let f = { inc: {}, exc: {}, mode: "all", q: "" }, click = "inc", last = null, saved = [], admin = false, seq = 0;
  try { const v = JSON.parse(localStorage.getItem("kb_cuts_f") || "null"); if (v && typeof v === "object") f = { inc: v.inc || {}, exc: v.exc || {}, mode: v.mode === "any" ? "any" : "all", q: String(v.q || "") }; } catch {}
  const keep = () => { try { localStorage.setItem("kb_cuts_f", JSON.stringify(f)); } catch {} };
  const has = (side, k, v) => ((f[side] || {})[k] || []).includes(v);
  const toggle = (side, k, v) => { const other = side === "inc" ? "exc" : "inc";
    f[other][k] = (f[other][k] || []).filter((x) => x !== v); if (!f[other][k].length) delete f[other][k];
    const a = f[side][k] || []; f[side][k] = a.includes(v) ? a.filter((x) => x !== v) : [...a, v]; if (!f[side][k].length) delete f[side][k]; };
  const nConds = () => Object.values(f.inc).reduce((a, x) => a + x.length, 0) + Object.values(f.exc).reduce((a, x) => a + x.length, 0);

  async function render(root) {
    root.innerHTML = '<div class="mc-note">数えています…（MOCHICALL のリード全件）</div>';
    const my = ++seq;
    let d; try { [d] = await Promise.all([post("/api/mccall/cuts", { filters: f }), api("/api/mccall/cuts/saved").then((x) => { saved = x.items || []; admin = !!x.admin; }).catch(() => { saved = []; })]); }
    catch (e) { if (my === seq) root.innerHTML = `<div class="mc-note">数えられませんでした：${esc(e.message)}　少し待ってから、もう一度タブを押してください。</div>`; return; }
    if (my !== seq || !root.isConnected) return;
    last = d; admin = admin || !!d.admin; draw(root);
  }
  function chipsHtml(d) {
    const lab = Object.fromEntries((d.cuts || []).map((c) => [c.k, c.label]));
    const one = (side) => Object.entries(f[side]).flatMap(([k, vs]) => vs.map((v) => `<span class="ct-chip ${side}">${side === "exc" ? "除く：" : ""}${esc(lab[k] || k)}＝${esc(v)}<button type="button" data-unchip="${side}" data-k="${esc(k)}" data-v="${esc(v)}" aria-label="この条件を外す">×</button></span>`));
    const xs = [...one("inc"), ...one("exc")];
    return xs.length ? xs.join("") : '<span class="mc-note">条件なし（全件）。下の切り口の項目を押すと条件に足します。</span>';
  }
  function draw(root) {
    const d = last; if (!d) return;
    const byK = Object.fromEntries((d.cuts || []).map((c) => [c.k, c]));
    const pills = (k, only) => { const c = byK[k]; if (!c || !c.items.length) return '<span class="mc-note">まだ数えられる値がありません</span>';
      return c.items.filter((x) => !x.rest && (!only || only.includes(x.v))).map((x) => `<button type="button" class="ct-pill ${has("inc", k, x.v) ? "inc" : has("exc", k, x.v) ? "exc" : ""}" data-k="${esc(k)}" data-v="${esc(x.v)}">${esc(x.v)}<em>${nf(x.n)}</em></button>`).join(""); };
    const card = (c) => {
      const max = Math.max(1, ...c.items.map((x) => x.n));
      const body = c.st === "none" ? `<div class="ct-empty">${c.st2 ? `${esc(c.st2)}：` : "まだ無い："}${esc(c.src)}</div>`
        : c.items.length ? c.items.map((x) => x.rest ? `<div class="ct-v rest" title="件数の多い順で上に出していないもの"><span>${esc(x.label)}</span><em>${nf(x.n)}</em><small>${rate(x.apo, x.called)}</small></div>`
          : `<button type="button" class="ct-v ${has("inc", c.k, x.v) ? "inc" : has("exc", c.k, x.v) ? "exc" : ""}" data-k="${esc(c.k)}" data-v="${esc(x.v)}" title="アポ ${nf(x.apo)} ÷ 架電 ${nf(x.called)}"><span>${esc(x.v)}</span><em>${nf(x.n)}</em><small>${rate(x.apo, x.called)}</small><i style="width:${Math.round(x.n / max * 100)}%"></i></button>`).join("")
        : '<div class="ct-empty">当てはまるリードがありません（ほかの条件で絞ったあと）</div>';
      return `<div class="ct-card"><div class="ct-card-h"><span class="ct-no">${c.no}</span><b>${esc(c.label)}</b><span class="ct-st ${c.st}">${esc(c.st === "none" && c.st2 ? c.st2 : ST[c.st] || "")}</span></div>${c.st !== "none" ? `<div class="ct-vh"><span>値</span><em>件数</em><small>アポ率</small></div>` : ""}${body}${c.st !== "none" ? `<div class="ct-src">${esc(c.src)}</div>` : ""}</div>`;
    };
    root.innerHTML = `
      <div class="ct-bar">
        <div class="ct-row"><span class="mc-note">いまの絞り込み</span><span class="ct-big">${nf(d.total)}<small>件</small></span><span class="mc-note">全 ${nf(d.all)}件のうち・アポ率 <b class="ct-apo">${rate(d.apo, d.called)}</b>（${nf(d.apo)}/${nf(d.called)}）</span>
          <span style="flex:1"></span>
          <span class="mc-note">条件どうし</span><div class="ct-seg"><button type="button" data-mode="all" class="${f.mode !== "any" ? "on" : ""}">すべて満たす（AND）</button><button type="button" data-mode="any" class="${f.mode === "any" ? "on" : ""}">どれかを満たす（OR）</button></div>
          <span class="mc-note">押したとき</span><div class="ct-seg"><button type="button" data-click="inc" class="${click === "inc" ? "on" : ""}">含む</button><button type="button" data-click="exc" class="${click === "exc" ? "on" : ""}">除く</button></div></div>
        <div class="ct-row"><div class="ct-chips">${chipsHtml(d)}</div><span style="flex:1"></span>
          <input class="ct-inp" type="search" data-q placeholder="会社名・担当者・電話で探す" value="${esc(f.q)}" aria-label="会社名・担当者・電話で探す" style="width:180px">
          <button type="button" class="mt-btn ghost" data-clear ${nConds() || f.q ? "" : "disabled"}>条件をすべて外す</button></div>
      </div>
      <div class="ct-sec">
        <div class="ct-box"><h4>今かける理由</h4>
          <div class="ct-sub">インテント（ASUMO）<span class="ct-st none">まだ無い</span></div>
          <div class="ct-empty">${esc((byK.intent || {}).src || "")}。取り込むには ASUMO を夜1回読む処理が要るので、田中さんの確認待ちです。</div>
          <div class="ct-sub">検討時期の当月アプローチ<span class="ct-st part">一部だけ</span></div>
          <div class="ct-pills">${pills("when", ["今月", "来月", "時期が過ぎた"])}</div>
          <div class="ct-src">予算検討時期が今月・来月の会社を今月かける／過ぎた会社を拾い直す（押すと予算検討時期の条件に足します）</div>
        </div>
        <div class="ct-box"><h4>保存した絞り込み<small class="mc-note" style="margin-left:6px">管理者どうしで共有</small></h4>
          <div class="ct-saved">${saved.length ? saved.map((x) => `<div class="ct-sv"><button type="button" class="go" data-sv="${x.id}" title="この条件にする">${esc(x.name)}<small>${esc(String(x.by_user || "").split("@")[0])}</small></button>${admin ? `<button type="button" class="x" data-svx="${x.id}" title="この絞り込みを消す（リードは変わりません）" aria-label="消す">×</button>` : ""}</div>`).join("") : '<div class="mc-note">まだありません。条件を作って名前を付けると、ここに並びます。</div>'}</div>
          ${admin ? `<div class="ct-row" style="margin-top:8px"><input class="ct-inp" data-svname maxlength="60" placeholder="いまの条件に名前を付ける" aria-label="絞り込みの名前" style="flex:1;min-width:120px"><button type="button" class="mt-btn" data-svsave ${nConds() || f.q ? "" : "disabled"}>${SAVE_ICO}保存</button></div>` : '<div class="mc-note" style="margin-top:6px">保存・削除は管理者だけができます。</div>'}
        </div>
      </div>
      <div class="ct-gh"><h4>18の切り口で全件把握</h4><span class="mc-note">件数＝ほかの条件で絞ったあと。アポ率＝前回の結果がアポ獲得 ÷ 架電したリード（いまある数え方）</span></div>
      <div class="ct-board">${(d.cuts || []).map(card).join("")}</div>
      <div class="ct-gh"><h4>当てはまるリード</h4><span class="mc-note">${d.total > 50 ? `ホットな順に先頭50件（全 ${nf(d.total)}件）` : `${nf(d.total)}件`}</span></div>
      <div class="ct-tbl"><table><thead><tr><th>会社名</th><th>担当者</th><th>電話</th><th>リードソース</th><th>ホット度</th><th>前回の結果</th><th>リスト</th></tr></thead><tbody>
        ${(d.rows || []).map((r) => `<tr><td title="${esc(r.company)}">${esc(r.company)}</td><td>${esc(r.person)}</td><td>${esc(r.phone)}</td><td>${esc(r.source)}</td><td>${esc(r.hot)}</td><td>${esc(r.last_result)}</td><td>${esc(r.list)}</td></tr>`).join("") || '<tr><td colspan="7" class="mc-note">当てはまるリードがありません。</td></tr>'}
      </tbody></table></div>
      ${d.filled ? `<p class="mc-note">まだ属性を計算していなかったリード ${nf(d.filled)}件を、いま計算しました。</p>` : ""}`;
    const again = () => { keep(); render(root); };
    root.querySelectorAll("[data-k][data-v]:not([data-unchip])").forEach((b) => b.addEventListener("click", (e) => { toggle(e.shiftKey || e.altKey || click === "exc" ? "exc" : "inc", b.dataset.k, b.dataset.v); again(); }));
    root.querySelectorAll("[data-unchip]").forEach((b) => b.addEventListener("click", () => { const side = b.dataset.unchip, k = b.dataset.k; f[side][k] = (f[side][k] || []).filter((x) => x !== b.dataset.v); if (!f[side][k].length) delete f[side][k]; again(); }));
    root.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => { if (f.mode === b.dataset.mode) return; f.mode = b.dataset.mode; again(); }));
    root.querySelectorAll("[data-click]").forEach((b) => b.addEventListener("click", () => { click = b.dataset.click; draw(root); }));
    root.querySelector("[data-clear]")?.addEventListener("click", () => { f = { inc: {}, exc: {}, mode: f.mode, q: "" }; again(); });
    let tm = null; const qi = root.querySelector("[data-q]"); qi?.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(() => { f.q = qi.value.trim(); again(); }, 500); });
    root.querySelectorAll("[data-sv]").forEach((b) => b.addEventListener("click", () => { const x = saved.find((y) => String(y.id) === b.dataset.sv); if (!x) return; const g = x.filters || {}; f = { inc: g.inc || {}, exc: g.exc || {}, mode: g.mode === "any" ? "any" : "all", q: String(g.q || "") }; again(); }));
    root.querySelectorAll("[data-svx]").forEach((b) => b.addEventListener("click", async () => { const x = saved.find((y) => String(y.id) === b.dataset.svx); if (!x) return;
      if (!confirm(`保存した絞り込み「${x.name}」を消しますか？（ほかの管理者の画面からも消えます。リードは変わりません）`)) return;
      try { await api(`/api/mccall/cuts/saved/${encodeURIComponent(x.id)}`, { method: "DELETE" }); render(root); } catch (e) { alert("消せませんでした：" + e.message); } }));
    root.querySelector("[data-svsave]")?.addEventListener("click", async (e) => { const nm = root.querySelector("[data-svname]").value.trim(); if (!nm) { alert("絞り込みの名前を入れてください。"); return; }
      const btn = e.currentTarget; btn.disabled = true; try { await post("/api/mccall/cuts/saved", { name: nm, filters: f }); render(root); } catch (er) { btn.disabled = false; alert("保存できませんでした：" + er.message); } });
  }
  window.mcCuts = { render };
})();
