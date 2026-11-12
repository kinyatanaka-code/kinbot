// kinbot の MOCHICA の箱（2026-11-12 田中さん：DOC を壊さずに別の箱。色は緑っぽい水色）
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (u, o = {}) => { const r = await fetch(u, { credentials: "include", headers: { "content-type": "application/json" }, ...o }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j; };
  const TITLES = { home: "ホーム", mtg: "商談（MiiTel）", list: "リスト（Bales Cloud）", call: "架電（Zoom Phone）", apo: "アポ（カレンダー）", doc: "DOC の議事録", settings: "設定（連携）" };
  const go = (k) => {
    if (!TITLES[k]) k = "home";
    // 商談は kinbot の商談履歴と同じ画面で（MOCHICA のタブ）（2026-11-12 田中さん）
    if (k === "mtg") { try { localStorage.setItem("kinbot.product", "MOCHICA"); } catch {} location.href = "/history.html"; return; }
    document.querySelectorAll("[data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== k; });
    document.querySelectorAll(".side-item[data-go]").forEach((a) => a.classList.toggle("active", a.dataset.go === k));
    $("mcTitle").textContent = TITLES[k]; if (location.hash !== "#" + k) history.replaceState(null, "", "#" + k);
    if (k === "settings") loadConfig();
    if (k === "mtg") loadMeetings();
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
  // MiiTel から届いた会議（2026-11-12）
  async function loadMeetings() {
    const box = $("mcMtList"); if (!box) return;
    try { const d = await api("/api/mochica/miitel/meetings"); const it = d.items || [];
      const t0 = (v) => v ? new Date(v).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
      box.innerHTML = it.length ? `<table class="mc-list"><tr><th>日時</th><th>会議</th><th>主催</th><th>長さ</th><th>文字起こし</th></tr>${it.map((m) => `<tr><td>${t0(m.started_at || m.received_at)}</td><td>${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">${esc(m.title || "（題名なし）")}</a>` : esc(m.title || "（題名なし）")}</td><td>${esc(m.host || "")}</td><td>${m.duration_sec ? Math.round(m.duration_sec / 60) + "分" : "—"}</td><td>${m.transcript_len ? `${m.transcript_len}` : "—"}</td></tr>`).join("")}</table>`
        : "まだ届いていません。設定（連携）の URL と追加ヘッダーを MiiTel の Outgoing Webhook（会議履歴）に入れると、次の会議から届きます。";
    } catch (e) { box.textContent = "読めませんでした：" + e.message; }
  }
  async function loadConfig() {
    try { const c = await api("/api/mochica/config");
      $("miDomain").value = c.miitel.domain || ""; $("miToken").value = ""; $("miToken").placeholder = c.miitel.tokenLast4 ? `保存済み（****${c.miitel.tokenLast4}）。変えるときだけ入れる` : "管理画面の「API」で発行したもの";
      $("baKey").value = ""; $("baKey").placeholder = c.bales.keyLast4 ? `保存済み（****${c.bales.keyLast4}）。変えるときだけ入れる` : "管理画面の「連携」「API」で発行したもの"; $("baNote").value = c.bales.note || "";
      $("sfLead").value = c.sf.leadType || ""; $("sfOpp").value = c.sf.oppPrefix || "";
      $("stMiitel").textContent = c.miitel.tokenLast4 ? "保存済み" : "未設定"; $("stBales").textContent = c.bales.keyLast4 ? "保存済み" : "未設定";
      if (c.hook) { $("mhUrl").value = c.hook.url || ""; $("mhHead").value = c.hook.header || ""; }
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
  // 下の段：頭文字の丸アイコン・名前・設定（歯車）・ログアウト（kinbot と同じ作り）
  fetch("/api/me", { credentials: "include" }).then((r) => r.json()).then((me) => {
    const who = $("who"); if (!who || !me) return; const name = me.name || me.username || "";
    who.textContent = name ? name + (me.admin ? "（管理者）" : "") : ""; who.title = me.username || "";
    const foot = who.parentElement;
    if (foot && name && !foot.querySelector(".side-avatar")) { const av = document.createElement("span"); av.className = "side-avatar"; av.setAttribute("aria-hidden", "true"); av.textContent = String(name).trim().charAt(0).toUpperCase(); foot.insertBefore(av, who); }
    if (foot && !foot.querySelector(".side-foot-set")) { const set = document.createElement("a"); set.className = "side-foot-set"; set.href = "#settings"; set.title = "設定"; set.setAttribute("aria-label", "設定");
      set.innerHTML = '<span class="side-ico ico-set"></span><span class="side-foot-set-label">設定</span>'; set.addEventListener("click", (e) => { e.preventDefault(); go("settings"); }); who.insertAdjacentElement("afterend", set); }
  }).catch(() => {});
  const lo = $("logout"); if (lo) lo.addEventListener("click", async (e) => { e.preventDefault(); await fetch("/api/logout", { method: "POST" }); location.href = "/login.html"; });
})();
