// kinbot の MOCHICA の箱（2026-11-12 田中さん：DOC を壊さずに別の箱。色は緑っぽい水色）
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (u, o = {}) => { const r = await fetch(u, { credentials: "include", headers: { "content-type": "application/json" }, ...o }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j; };
  const TITLES = { home: "ホーム", mtg: "商談（MiiTel）", list: "リスト（Bales Cloud）", call: "架電（Zoom Phone）", apo: "アポ（カレンダー）", doc: "DOC の議事録", settings: "設定（連携）" };
  const go = (k) => {
    if (!TITLES[k]) k = "home";
    document.querySelectorAll("[data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== k; });
    document.querySelectorAll("[data-go]").forEach((a) => a.classList.toggle("on", a.dataset.go === k));
    $("mcTitle").textContent = TITLES[k]; if (location.hash !== "#" + k) history.replaceState(null, "", "#" + k);
    if (k === "settings") loadConfig();
  };
  document.querySelectorAll("[data-go]").forEach((a) => a.addEventListener("click", () => go(a.dataset.go)));
  window.addEventListener("hashchange", () => go(location.hash.slice(1)));
  async function loadHome() {
    try { const d = await api("/api/mochica/summary");
      const st = (x) => x ? '<b class="ok">つながっています</b>' : '<b class="ng">まだつないでいません</b>';
      $("mcCards").innerHTML = `<div class="mc-card"><small>MOCHICA のメンバー</small><b>${d.members.length}<span style="font-size:13px"> 人</span></b></div>
        <div class="mc-card"><small>この7日の商談（kinbot で録画）</small><b>${d.meetings7}<span style="font-size:13px"> 件</span></b></div>
        <div class="mc-card"><small>MiiTel</small>${st(d.miitel)}</div><div class="mc-card"><small>Bales Cloud</small>${st(d.bales)}</div>`;
      $("mcMembers").innerHTML = d.members.length ? d.members.map((m) => `<span class="mc-tag" style="margin:0 6px 6px 0">${esc(m)}</span>`).join("") : "まだ MOCHICA のメンバーが決まっていません。";
    } catch (e) { $("mcCards").innerHTML = `<div class="mc-card"><small>読めませんでした：${esc(e.message)}</small></div>`; }
  }
  async function loadConfig() {
    try { const c = await api("/api/mochica/config");
      $("miDomain").value = c.miitel.domain || ""; $("miToken").value = ""; $("miToken").placeholder = c.miitel.tokenLast4 ? `保存済み（****${c.miitel.tokenLast4}）。変えるときだけ入れる` : "管理画面の「API」で発行したもの";
      $("baKey").value = ""; $("baKey").placeholder = c.bales.keyLast4 ? `保存済み（****${c.bales.keyLast4}）。変えるときだけ入れる` : "管理画面の「連携」「API」で発行したもの"; $("baNote").value = c.bales.note || "";
      $("sfLead").value = c.sf.leadType || ""; $("sfOpp").value = c.sf.oppPrefix || "";
      $("stMiitel").textContent = c.miitel.tokenLast4 ? "保存済み" : "未設定"; $("stBales").textContent = c.bales.keyLast4 ? "保存済み" : "未設定";
    } catch (e) { $("mcSaved").textContent = "読めませんでした：" + e.message; }
  }
  $("mcSave").addEventListener("click", async () => {
    const body = { miitel: { domain: $("miDomain").value.trim(), ...($("miToken").value.trim() ? { token: $("miToken").value.trim() } : {}) },
      bales: { note: $("baNote").value.trim(), ...($("baKey").value.trim() ? { key: $("baKey").value.trim() } : {}) },
      sf: { leadType: $("sfLead").value.trim(), oppPrefix: $("sfOpp").value.trim() } };
    try { await api("/api/mochica/config", { method: "PUT", body: JSON.stringify(body) }); $("mcSaved").textContent = "保存しました"; loadConfig(); loadHome(); }
    catch (e) { $("mcSaved").textContent = "保存できませんでした：" + e.message; }
  });
  go(location.hash.slice(1) || "home"); loadHome();
})();
