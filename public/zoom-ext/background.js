// kinbot の合言葉：無ければ、この Chrome の kinbot のログインで取りにいく（拡張機能を入れ直した直後に「合言葉がありません」で止まらないように）（2026-11-15）
async function kbTok() {
  try {
    const t = (await chrome.storage.local.get(["kbExtToken"])).kbExtToken; if (t) return t;
    const r = await fetch("https://kinbot-production-225f.up.railway.app/api/mochica/miitel/ext-token", { credentials: "include", redirect: "manual" });
    const j = await r.json().catch(() => null); if (j && j.token) { await chrome.storage.local.set({ kbExtToken: j.token }); return j.token; }
  } catch {}
  return "";
}
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
      const tk = (await kbTok());
      const r = await fetch("https://kinbot-production-225f.up.railway.app/api/mochica/miitel/ext/capture", { method: "POST", credentials: "include", redirect: "manual", headers: { "content-type": "application/json", "x-kb-ext": tk }, body: JSON.stringify({ items: msg.items || [] }) });
      const j = await r.json().catch(() => null); reply({ ok: !!(j && j.ok), status: r.status });
    } catch (e) { reply({ ok: false, error: String(e && e.message || e) }); }
  })();
  return true;
});
// MiiTel の会議のページを裏で1件ずつ開いて、文字起こし・議事録を読ませる（SHOBO の「MiiTel から読む」）（2026-11-12）
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
    const tk = (await kbTok()); if (!tk) return;
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
      const tk = (await kbTok());
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
    const st = await chrome.storage.local.get(["kbBalesWatch"]); if (!st.kbBalesWatch || !(await kbTok())) return;
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

// ===== 過去の会議の文字起こし・議事録をまとめて読む（2026-11-15）=====
//   kinbot に「まだの会議」（録画は後回し・同じ会議は2回まで）を10件ずつ聞き、裏のタブで順に開く。止めるまで、または無くなるまで続ける
let kbMtBackStop = false;
async function kbMtBackfill(days) {
  const st0 = await chrome.storage.local.get(["kbMtBackDet"]); if (st0.kbMtBackDet && st0.kbMtBackDet.running && Date.now() - st0.kbMtBackDet.at < 600000) return;
  kbMtBackStop = false; let done = 0;
  await chrome.storage.local.set({ kbMtBackDet: { running: true, done, at: Date.now() } });
  try {
    const tk = (await kbTok()); if (!tk) throw new Error("no token");
    for (let k = 0; k < 3000 && !kbMtBackStop; k++) {
      while (kbMtCrawling) await new Promise((r) => setTimeout(r, 5000));   // 自動の読み込みが動いていれば待つ
      const r = await fetch(`https://kinbot-production-225f.up.railway.app/api/mochica/miitel/ext/todo?limit=10&novideo=1&days=${days}`, { headers: { "x-kb-ext": tk } });
      const j = await r.json().catch(() => null); const urls = (j && j.urls) || []; if (!urls.length) break;
      await chrome.storage.local.set({ kbMtBackDet: { running: true, done, at: Date.now(), left: j.left ?? null }, kbMiitelCrawl: { done: 0, total: urls.length, at: Date.now() } });
      await kbMtCrawl(urls); done += urls.length;
      await chrome.storage.local.set({ kbMtBackDet: { running: true, done, at: Date.now(), left: j.left != null ? Math.max(0, j.left - urls.length) : null } });
    }
  } catch {}
  await chrome.storage.local.set({ kbMtBackDet: { running: false, done, stopped: kbMtBackStop, at: Date.now() } });
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg) return;
  if (msg.type === "kb-miitel-backfill") { kbMtBackfill(Math.max(1, Math.min(3650, Number(msg.days) || 3650))); reply({ ok: true }); return true; }
  if (msg.type === "kb-miitel-backfill-stop") { kbMtBackStop = true; reply({ ok: true }); return true; }
});

// NeoSTAGE（取引申請）の自動入力：画面（neostage.js）からの頼みを kinbot へ取り次ぐ（2026-11-16）
//   通すのは /api/neostage/ext/ だけ（ほかの kinbot の API は、この道からは呼べない）
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== "kb-neo") return;
  (async () => {
    try {
      const path = String(msg.path || "").replace(/^\/+/, "");
      if (!/^[a-z]+(\?[^#]*)?$/i.test(path)) { reply({ ok: false, error: "その頼みは通せません" }); return; }
      const tk = await kbTok();
      const r = await fetch(`https://kinbot-production-225f.up.railway.app/api/neostage/ext/${path}`, { method: msg.method === "POST" ? "POST" : "GET", credentials: "include", redirect: "manual",
        headers: { "content-type": "application/json", "x-kb-ext": tk }, body: msg.method === "POST" ? JSON.stringify(msg.body || {}) : undefined });
      const j = await r.json().catch(() => null);
      if (!j) { reply({ ok: false, error: r.status === 401 || r.type === "opaqueredirect" ? "kinbot にログインしてから、このページを読み込み直してください" : `kinbot から返事がありません（${r.status}）` }); return; }
      reply(r.ok ? { ok: true, ...j } : { ok: false, error: j.error || `うまくいきませんでした（${r.status}）` });
    } catch (e) { reply({ ok: false, error: String((e && e.message) || e) }); }
  })();
  return true;
});

// ===== DOC の AI（次面談話）の管理画面で読んだチャットを、kinXs に送る（2026-11-18 田中さん）=====
//   kinbot にログインしているブラウザのクッキーで送る（合言葉は持たない）。ログインしていなければ、そう返す
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== "kb-docai-capture") return;
  (async () => {
    try {
      const r = await fetch("https://kinbot-production-225f.up.railway.app/api/kinxs/docai/capture", { method: "POST", credentials: "include", redirect: "manual", headers: { "content-type": "application/json" }, body: JSON.stringify(msg.payload || {}) });
      if (r.type === "opaqueredirect" || r.status === 401) return reply({ ok: false, error: "kinbot にログインしてから、もう一度開いてください" });
      const j = await r.json().catch(() => ({}));
      reply(r.ok ? { ok: true, ...j } : { ok: false, error: j.error || `（${r.status}）` });
    } catch (e) { reply({ ok: false, error: String(e && e.message || e) }); }
  })();
  return true;
});

// DOC の AI の自動取り込みが使う kinbot の窓口（/api/kinxs/docai/ の下だけ通す）
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== "kb-docai-api") return;
  (async () => {
    try {
      const path = String(msg.path || ""); if (!/^\/api\/kinxs\/docai\/[a-z]+$/.test(path)) return reply({ ok: false, error: "使えない窓口です" });
      const r = await fetch(`https://kinbot-production-225f.up.railway.app${path}`, { method: msg.method === "POST" ? "POST" : "GET", credentials: "include", redirect: "manual", headers: { "content-type": "application/json" }, body: msg.method === "POST" ? JSON.stringify(msg.body || {}) : undefined });
      if (r.type === "opaqueredirect" || r.status === 401) return reply({ ok: false, error: "kinbot にログインしてから、もう一度押してください" });
      const j = await r.json().catch(() => ({}));
      reply(r.ok ? { ok: true, ...j } : { ok: false, error: j.error || `（${r.status}）` });
    } catch (e) { reply({ ok: false, error: String(e && e.message || e) }); }
  })();
  return true;
});

// DOC の AI の管理画面の2段階認証：本人の Gmail に届いた確認コードを kinbot に聞く（2026-11-19 田中さん）。
//   聞けるのは決めたサイト（brainverse）だけ。コードはどこにも残さない
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== "kb-login-code") return;
  (async () => {
    try {
      if (msg.site !== "brainverse") return reply({ ok: false, error: "このサイトは使えません" });
      const since = Math.max(0, Number(msg.since) || 0);
      const r = await fetch(`https://kinbot-production-225f.up.railway.app/api/me/login-code?site=brainverse&since=${since}`, { credentials: "include", redirect: "manual" });
      if (r.type === "opaqueredirect" || r.status === 401) return reply({ ok: false, error: "kinbot にログインしてから、もう一度ログインしてください" });
      const j = await r.json().catch(() => ({}));
      reply(r.ok ? { ok: true, code: j.code || null, at: j.at || null } : { ok: false, error: j.error || `（${r.status}）` });
    } catch (e) { reply({ ok: false, error: String(e && e.message || e) }); }
  })();
  return true;
});

// DOC の AI の取り込みでログインし直すときのメール・パスワード（2026-11-19 田中さん）。
//   chrome.storage.session（Chrome を閉じると消える・ページからは読めない）にだけ置き、取り込みが終わったら消す。kinbot には送らない
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== "kb-docai-cred") return;
  if (!sender || !sender.url || !/^https:\/\/casual-interview-api\.brainverse-ai\.com\//.test(sender.url)) { reply({}); return; }
  const K = "kbDocAiCred";
  if (msg.op === "set") { chrome.storage.session.set({ [K]: { email: String(msg.email || ""), pw: String(msg.pw || "") } }, () => reply({ ok: true })); return true; }
  if (msg.op === "clear") { chrome.storage.session.remove([K], () => reply({ ok: true })); return true; }
  chrome.storage.session.get([K], (st) => reply((st && st[K]) || {})); return true;
});

// ===== DOC の AI の質問を毎日読む（2026-11-19 田中さん「質問内容は毎日監視して、増えたところを読み取るようにしたい」）=====
//   取り込みの窓で「毎日」に印を付けた人だけ（ほかの人のパソコンでは開かない）。決めた時刻（既定 9:00）を過ぎたら、その日に1回だけ、管理画面を別の窓で開いて、全部の会社の「増えたチャットだけ」を読む。
//   窓は前に出さない（作業のじゃまをしない）。最小化や裏のタブにすると Chrome が動きを遅くするので、ふつうの窓で開く。
//   ログインのパスワードは Chrome を閉じると消える置き場にあるもの。無ければ、開いた窓でパスワードを聞く
const KB_DA_DAILY = "kbDocAiDaily";
const KB_DA_BASE = "https://casual-interview-api.brainverse-ai.com/";
const kbYmdLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
async function kbDocAiDailyCheck(force) {
  try {
    const st = await chrome.storage.local.get([KB_DA_DAILY, "kbDocAiRun"]);
    const d = st[KB_DA_DAILY] || { on: false, time: "09:00" };
    if (!d.on && !force) return { ok: false, why: "off" };
    const now = new Date(); const today = kbYmdLocal(now);
    const [hh, mm] = String(d.time || "09:00").split(":").map(Number);
    if (!force && (now.getHours() * 60 + now.getMinutes() < (hh || 0) * 60 + (mm || 0) || d.lastDay === today)) return { ok: false, why: "not-yet" };
    if (!force && (now.getDay() === 0 || now.getDay() === 6)) return { ok: false, why: "weekend" };   // 土日はしない
    const run = st.kbDocAiRun;
    if (run && Date.now() - (run.at || 0) < 30 * 60000) return { ok: false, why: "running" };     // 取り込み中
    await chrome.storage.local.set({
      [KB_DA_DAILY]: { ...d, lastDay: today },
      kbDocAiRun: { phase: "relogin", auto: true, list: null, i: 0, onlyNew: true, saved: 0, skipped: 0, failed: 0, log: [], results: [], tries: 0, started: Date.now(), at: Date.now(), stop: false },
    });
    const w = await chrome.windows.create({ url: KB_DA_BASE, focused: false, state: "normal", width: 1280, height: 900 });
    await chrome.storage.local.set({ kbDocAiAutoWin: w && w.id });
    return { ok: true };
  } catch (e) { return { ok: false, why: String(e && e.message || e) }; }
}
chrome.alarms.create("kb-docai-daily", { periodInMinutes: 15, delayInMinutes: 4 });
chrome.alarms.onAlarm.addListener((a) => { if (a && a.name === "kb-docai-daily") kbDocAiDailyCheck(false); });
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || !/^kb-docai-(daily|autodone)$/.test(msg.type)) return;
  if (!sender || !sender.url || !/^https:\/\/casual-interview-api\.brainverse-ai\.com\//.test(sender.url)) { reply({}); return; }
  (async () => {
    if (msg.type === "kb-docai-daily") {
      // 設定の読み書き（毎日するか・何時か）。force は「いまためしに回す」
      if (msg.op === "set") { const st = await chrome.storage.local.get([KB_DA_DAILY]); await chrome.storage.local.set({ [KB_DA_DAILY]: { ...(st[KB_DA_DAILY] || {}), on: !!msg.on, time: /^\d{2}:\d{2}$/.test(msg.time || "") ? msg.time : "09:00" } }); }
      const st = await chrome.storage.local.get([KB_DA_DAILY]);
      return reply({ ok: true, daily: st[KB_DA_DAILY] || { on: false, time: "09:00" } });
    }
    // 毎日の取り込みが終わった：開いた窓を1分後に閉じる（自動で開いた窓のときだけ）
    const st = await chrome.storage.local.get(["kbDocAiAutoWin"]); const wid = st.kbDocAiAutoWin;
    if (wid && sender.tab && sender.tab.windowId === wid) setTimeout(() => { chrome.windows.remove(wid).catch(() => {}); chrome.storage.local.remove(["kbDocAiAutoWin"]); }, 60000);
    reply({ ok: true });
  })();
  return true;
});
