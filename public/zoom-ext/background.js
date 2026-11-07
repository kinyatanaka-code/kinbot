// kincall Zoomサインイン補助（バックグラウンド）
// kincall から受け取ったログイン情報を、ブラウザのメモリ（chrome.storage.session）に10分だけ置く。ファイルには残さない。
const TTL = 10 * 60 * 1000;
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg && msg.type === "kc-zoom-start") {
      const c = msg.cred || {};
      if (!c.account || !c.password) { reply({ ok: false, error: "ログイン情報がありません" }); return; }
      await chrome.storage.session.set({ kcZoom: { account: c.account, empNo: c.empNo || "", password: c.password, until: Date.now() + TTL, done: {} } });
      if (msg.open !== false) await chrome.tabs.create({ url: "https://zoom.us/google_oauth_signin", active: true });
      reply({ ok: true });
    } else if (msg && msg.type === "kc-zoom-get") {
      const { kcZoom } = await chrome.storage.session.get("kcZoom");
      if (!kcZoom || kcZoom.until < Date.now()) { await chrome.storage.session.remove("kcZoom"); reply({ ok: false }); return; }
      reply({ ok: true, cred: kcZoom });
    } else if (msg && msg.type === "kc-zoom-clear") {
      await chrome.storage.session.remove("kcZoom"); reply({ ok: true });
    } else reply({ ok: false });
  })();
  return true;
});
