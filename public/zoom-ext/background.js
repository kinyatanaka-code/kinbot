// kincall Zoomサインイン補助（バックグラウンド）
// kincall から受け取ったログイン情報を、ブラウザのメモリ（chrome.storage.session）に10分だけ置く。ファイルには残さない。
const TTL = 10 * 60 * 1000;
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  // ここで扱わない頼み（MiiTel・Bales など）には返事をしない。先に「だめ」と返すと、本当の返事が届かなくなるため（2026-11-15）
  if (!msg || !["kc-zoom-start", "kc-zoom-get", "kc-zoom-clear", "kx-mw-ingest", "kx-mw-set"].includes(msg.type)) return false;
  (async () => {
    if (msg && msg.type === "kc-zoom-start") {
      const c = msg.cred || {};
      if (!c.account || !c.password) { reply({ ok: false, error: "ログイン情報がありません" }); return; }
      await chrome.storage.session.set({ kcZoom: { account: c.account, empNo: c.empNo || "", password: c.password, until: Date.now() + TTL, done: {} } });
      // ふだんのChrome（自分のGoogle・Oktaでログイン中）でも使えるように、先に Okta と Zoom（Web）からサインアウトしておく。
      //   Okta に自分のログインが残っていると、借りたアカウントではなく自分として Google に返してしまい、サインインが失敗するため（2026-11-07）
      for (const u of ["https://neo-career.okta.com/login/signout", "https://zoom.us/logout"]) { try { await fetch(u, { credentials: "include", redirect: "follow" }); } catch {} }
      if (msg.open !== false) await chrome.tabs.create({ url: "https://zoom.us/google_oauth_signin", active: true });
      reply({ ok: true });
    } else if (msg && msg.type === "kc-zoom-get") {
      const { kcZoom } = await chrome.storage.session.get("kcZoom");
      if (!kcZoom || kcZoom.until < Date.now()) { await chrome.storage.session.remove("kcZoom"); reply({ ok: false }); return; }
      reply({ ok: true, cred: kcZoom });
    } else if (msg && msg.type === "kc-zoom-clear") {
      await chrome.storage.session.remove("kcZoom"); reply({ ok: true });
    } else if (msg && msg.type === "kx-mw-ingest") {
      // メールワイズで読んだメールを kinXs に送る（kinbot にログインしていれば送れる。だめなら false を返し、拡張機能が持っておく）
      try {
        const r = await fetch("https://kinbot-production-225f.up.railway.app/api/kinxs/mailwise/ingest", { method: "POST", credentials: "include", redirect: "manual", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: msg.items || [] }) });
        const j = await r.json().catch(() => null);   // ログイン画面に飛ばされたときなどは JSON にならない＝受け取られていない
        reply({ ok: !!(j && j.ok), status: r.status });
      } catch (e) { reply({ ok: false, error: e.message }); }
    } else if (msg && msg.type === "kx-mw-set") {
      // kinXs のメールの下書き：メールワイズの画面で使う。前の下書きのうち、まだ送っていないものは残して足す（1日たったものは消す）
      const { kxMwDrafts: cur } = await chrome.storage.local.get("kxMwDrafts");
      const keep = ((cur && cur.list) || []).filter((x) => !x.done && x.at > Date.now() - 86400000);
      const add = (msg.list || []).map((x, i) => ({ ...x, key: `${Date.now()}-${i}`, at: Date.now() }));
      await chrome.storage.local.set({ kxMwDrafts: { list: [...keep, ...add] } });
      if (msg.url && /^https:\/\/[\w.-]+\.cybozu\.com\//.test(msg.url)) await chrome.tabs.create({ url: msg.url, active: true });
      reply({ ok: true, n: add.length });
    } else reply({ ok: false });
  })();
  return true;
});

// MiiTel の文字起こし・議事録を kinbot へ（2026-11-12）
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== "kb-miitel-capture") return;
  (async () => {
    try {
      const tk = (await chrome.storage.local.get(["kbExtToken"])).kbExtToken || "";
      const r = await fetch("https://kinbot-production-225f.up.railway.app/api/mochica/miitel/ext/capture", { method: "POST", credentials: "include", redirect: "manual", headers: { "content-type": "application/json", "x-kb-ext": tk }, body: JSON.stringify({ items: msg.items || [] }) });
      const j = await r.json().catch(() => null); reply({ ok: !!(j && j.ok), status: r.status });
    } catch (e) { reply({ ok: false, error: String(e && e.message || e) }); }
  })();
  return true;
});
// MiiTel の会議のページを裏で1件ずつ開いて、文字起こし・議事録を読ませる（kinbot for MOCHICA の「MiiTel から読む」）（2026-11-12）
let kbMtCrawling = false;
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== "kb-miitel-crawl") return;
  const urls = (msg.urls || []).filter((u) => /^https:\/\/[a-z0-9.-]+\.miitel\.com\/app\/video\//i.test(u)).slice(0, 300);
  if (kbMtCrawling) { reply({ ok: false, error: "いま読んでいる最中です" }); return; }
  reply({ ok: true, count: urls.length });
  kbMtCrawl(urls);
  return true;
});
async function kbMtCrawl(urls) {
  if (kbMtCrawling) return; kbMtCrawling = true;
  try {
    let done = 0;
    for (const u of urls) {
      try {
        const tab = await chrome.tabs.create({ url: u, active: false });
        if (/#kbGrabVideo/.test(u)) {
          // 録画：ページが「終わった」と知らせるまで待つ（最長20分）
          await chrome.storage.local.set({ kbMtVidDone: "", kbMtVidProg: null }); const t0 = Date.now();
          // 終わったら次へ。進み具合が2分止まったら（録画が無い・読めない）あきらめて次へ。最長15分
          for (let k = 0; k < 180; k++) { await new Promise((r) => setTimeout(r, 5000)); const st0 = await chrome.storage.local.get(["kbMtVidDone", "kbMtVidProg"]); if (st0.kbMtVidDone) break;
            const lastAt = (st0.kbMtVidProg && st0.kbMtVidProg.at) || t0; if (Date.now() - lastAt > 120000) break; }
        } else await new Promise((r) => setTimeout(r, 14000));   // ページが文字起こし・議事録を取ってくるまで待つ
        await chrome.tabs.remove(tab.id).catch(() => {});
      } catch {}
      done++; await chrome.storage.local.set({ kbMiitelCrawl: { done, total: urls.length, at: Date.now() } });
    }
  } finally { kbMtCrawling = false; }
}
// 自動：20分ごとに kinbot から「次に読む会議」をもらって、裏で読む（Chrome が開いていて、MiiTel にログインしていれば動く）（2026-11-12）
// 見張る時間：平日の10時〜19時（このパソコンの時計で）（2026-11-15 田中さん）
const kbWorkHours = () => { const d = new Date(); const w = d.getDay(), h = d.getHours(); return w >= 1 && w <= 5 && h >= 10 && h < 19; };
async function kbMtAuto() {
  try {
    if (kbMtCrawling || !kbWorkHours()) return;
    const tk = (await chrome.storage.local.get(["kbExtToken"])).kbExtToken || ""; if (!tk) return;
    const r = await fetch("https://kinbot-production-225f.up.railway.app/api/mochica/miitel/ext/todo?limit=6", { headers: { "x-kb-ext": tk } });
    const j = await r.json().catch(() => null); if (!j || !j.ok || !(j.urls || []).length) return;
    await chrome.storage.local.set({ kbMtAutoAt: Date.now() });
    await kbMtCrawl(j.urls);
  } catch {}
}
chrome.alarms.create("kb-miitel-auto", { periodInMinutes: 20, delayInMinutes: 2 });
chrome.alarms.onAlarm.addListener((a) => { if (a && a.name === "kb-miitel-auto") kbMtAuto(); });
chrome.runtime.onMessage.addListener((msg, sender, reply) => { if (msg && msg.type === "kb-miitel-auto-now") { kbMtAuto(); reply({ ok: true }); return true; } });

// Bales Cloud の画面で読んだリストを kinbot へ（2026-11-15 田中さん）
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== "kb-bales-rows") return;
  (async () => {
    try {
      const tk = (await chrome.storage.local.get(["kbExtToken"])).kbExtToken || "";
      const r = await fetch("https://kinbot-production-225f.up.railway.app/api/mochica/bales/ext/rows", { method: "POST", credentials: "include", redirect: "manual", headers: { "content-type": "application/json", "x-kb-ext": tk }, body: JSON.stringify(msg.payload || {}) });
      const j = await r.json().catch(() => null);
      reply(j && j.ok ? { ...j, ok: true } : { ok: false, status: r.status, error: (j && j.error) || (r.status === 0 || r.status === 302 ? "kinbot にログインしていません。kinbot の画面を開いてから、もう一度押してください" : `kinbot に送れませんでした（${r.status}）`) });
    } catch (e) { reply({ ok: false, error: String(e && e.message || e) }); }
  })();
  return true;
});

// Bales の見張り：平日10〜19時に10分ごと、Bales のタブに「新しい行を読んで」と頼む。タブが無ければ裏にピン留めで開く（2026-11-15）
async function kbBalesWatch() {
  try {
    if (!kbWorkHours()) return;
    const st = await chrome.storage.local.get(["kbBalesWatch", "kbExtToken"]); if (!st.kbBalesWatch || !st.kbExtToken) return;
    let tabs = await chrome.tabs.query({ url: "https://*.balescloud.jp/*" });
    if (!tabs.length) { const t = await chrome.tabs.create({ url: "https://mochica.balescloud.jp/app/lead-list", active: false, pinned: true }); await new Promise((r) => setTimeout(r, 25000)); tabs = [t]; }
    const tab = tabs.find((t) => !t.discarded) || tabs[0]; if (tab.discarded) { await chrome.tabs.reload(tab.id); await new Promise((r) => setTimeout(r, 25000)); }
    await chrome.tabs.sendMessage(tab.id, { type: "kb-bales-sync" }).catch(async () => { await chrome.tabs.reload(tab.id); await new Promise((r) => setTimeout(r, 25000)); await chrome.tabs.sendMessage(tab.id, { type: "kb-bales-sync" }).catch(() => {}); });
    await chrome.storage.local.set({ kbBalesWatchAt: Date.now() });
  } catch {}
}
chrome.alarms.create("kb-bales-watch", { periodInMinutes: 10, delayInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a && a.name === "kb-bales-watch") kbBalesWatch(); });

// ===== 自分で新しい版に入れ替わる（2026-11-15 田中さん「拡張機能の最新を自動で入れたい」）=====
//   パソコンの更新係（kinbot-ext-autoupdate.cmd で入れる。15分ごと）がこのフォルダに新しい版を上書きする。
//   ここでは10分ごとにフォルダの manifest.json の版を見て、いま動いている版と違えば読み込み直す。
//   MiiTel を読んでいる最中はやめる。読み込み直したあとは、裏のタブ（Bales・MiiTel）を開き直して、新しい版で動かす。
async function kbSelfUpdate() {
  try {
    if (kbMtCrawling) return;
    const r = await fetch(chrome.runtime.getURL("manifest.json") + "?t=" + Date.now(), { cache: "no-store" }); const m = await r.json();
    const run = chrome.runtime.getManifest().version;
    if (m && m.version && m.version !== run) { await chrome.storage.local.set({ kbSelfUpdated: { from: run, to: m.version, at: Date.now() } }); chrome.runtime.reload(); }
  } catch {}
}
chrome.alarms.create("kb-self-update", { periodInMinutes: 10, delayInMinutes: 3 });
chrome.alarms.onAlarm.addListener((a) => { if (a && a.name === "kb-self-update") kbSelfUpdate(); });
(async () => {
  try {
    const st = await chrome.storage.local.get(["kbSelfUpdated"]); const u = st.kbSelfUpdated;
    if (!u || Date.now() - u.at > 180000 || u.done) return;
    await chrome.storage.local.set({ kbSelfUpdated: { ...u, done: true } });
    // いま見ているタブは触らない（入力の途中かもしれないため）。それ以外の Bales・MiiTel のタブを開き直す
    const tabs = await chrome.tabs.query({ url: ["https://*.balescloud.jp/*", "https://*.miitel.com/*"] });
    for (const t of tabs) if (!t.active) await chrome.tabs.reload(t.id).catch(() => {});
  } catch {}
})();
