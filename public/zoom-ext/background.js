// kincall Zoomサインイン補助（バックグラウンド）
// kincall から受け取ったログイン情報を、ブラウザのメモリ（chrome.storage.session）に10分だけ置く。ファイルには残さない。
const TTL = 10 * 60 * 1000;
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
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
