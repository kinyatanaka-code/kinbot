// MiiTel のページ（拡張機能の側）：miitel-hook.js から受け取った文字起こし・議事録を kinbot に送る（送れなければ kinbot の画面を開いたときに送り直す）（2026-11-12）
(function () {
  // 見た通り道（名前だけ）を残す：kinbot の画面で「拡張機能の様子」として出す（2026-11-12）
  window.addEventListener("message", async (e) => {
    const d = e.data; if (!d || !d.__kbMiitelSeen || e.source !== window) return;
    try { const st = await chrome.storage.local.get(["kbMiitelSeen"]); const l = (st.kbMiitelSeen || []).filter((x) => x.path !== d.path); l.push({ path: d.path, page: d.page, at: Date.now() }); await chrome.storage.local.set({ kbMiitelSeen: l.slice(-50) }); } catch {}
  });
  window.addEventListener("message", async (e) => {
    const d = e.data; if (!d || !d.__kbMiitel || e.source !== window) return;
    const item = { kind: d.kind, detailId: d.detailId, videoId: d.videoId, url: d.url, title: d.title, text: d.text, at: Date.now() };
    try {
      const res = await new Promise((resolve) => chrome.runtime.sendMessage({ type: "kb-miitel-capture", items: [item] }, (x) => resolve(x || {})));
      try { const st0 = await chrome.storage.local.get(["kbMiitelLast"]); const l0 = (st0.kbMiitelLast || []); l0.push({ kind: item.kind, ok: !!res.ok, status: res.status || "", len: String(item.text || "").length, at: Date.now() }); await chrome.storage.local.set({ kbMiitelLast: l0.slice(-20) }); } catch {}
      if (!res.ok) { const st = await chrome.storage.local.get(["kbMiitelPending"]); const pend = (st.kbMiitelPending || []).filter((p) => !(p.videoId === item.videoId && p.kind === item.kind)); pend.push(item); await chrome.storage.local.set({ kbMiitelPending: pend.slice(-60) }); }
    } catch {}
  });
})();

// 録画の取り込み：合言葉を MAIN（miitel-hook.js）へ渡し、進み具合と終わりを残す（2026-11-12）
(async () => { try { const tk = (await chrome.storage.local.get(["kbExtToken"])).kbExtToken || ""; const send = () => window.postMessage({ __kbExtToken: tk, kb: "https://kinbot-production-225f.up.railway.app" }, "*"); send(); setTimeout(send, 1500); setTimeout(send, 5000); } catch {} })();
window.addEventListener("message", async (e) => { const d = e.data; if (!d || !d.__kbMtVid || e.source !== window) return;
  try { await chrome.storage.local.set({ kbMtVidProg: { ...d, at: Date.now() } }); if (d.done || d.error) await chrome.storage.local.set({ kbMtVidDone: d.error ? "error" : "done" }); } catch {} });

// ===== 過去の会議を読む（会議履歴一覧の画面だけ）：一覧のページをめくって会議を kinbot に入れ、続けて文字起こし・議事録を裏で順に読む（2026-11-15 田中さん「3月1日までの会議を全部」）=====
(function () {
  // 会議履歴一覧は /app/video-list（新しい画面）と /app/video の両方（2026-11-15：ボタンが出なかった）
  if (window.top !== window || !/^\/app\/video(-list)?\/?$/.test(location.pathname) || document.getElementById("kbMtBackBtn")) return;
  const C = { deep: "#0B6E78", main: "#0E9AA7", line: "#9FD9DF", light: "#DDF5F7" };
  const css = document.createElement("style");
  css.textContent = `#kbMtBackBtn{position:fixed;left:18px;bottom:18px;z-index:2147483000;border:1.5px solid ${C.line};background:#fff;color:${C.deep};font:700 13px/1 system-ui,sans-serif;border-radius:999px;padding:9px 14px;box-shadow:0 4px 14px rgba(14,154,167,.18);cursor:pointer}
  #kbMtBack{position:fixed;left:18px;bottom:64px;z-index:2147483000;width:320px;max-height:calc(100vh - 90px);overflow:auto;background:#fff;border:1.5px solid ${C.line};border-radius:14px;box-shadow:0 8px 28px rgba(15,61,68,.18);padding:14px;font:13px/1.5 system-ui,sans-serif;color:#0F3D44;box-sizing:border-box}
  #kbMtBack h4{margin:0 0 6px;font-size:14px;color:${C.deep}} #kbMtBack .msg{font-size:12px;color:#5C7377;margin-top:6px;white-space:pre-wrap} #kbMtBack input{width:100%;box-sizing:border-box;border:1px solid #CFE6EA;border-radius:9px;padding:7px 9px;font:inherit}
  #kbMtBack .go{margin-top:8px;width:100%;border:0;border-radius:10px;background:${C.main};color:#fff;font-weight:700;padding:9px;cursor:pointer} #kbMtBack .sub{margin-top:6px;width:100%;border:1px solid #CFE6EA;background:#fff;border-radius:10px;padding:7px;cursor:pointer;color:${C.deep}}
  #kbMtBack .bar{height:7px;background:${C.light};border-radius:4px;margin-top:8px;overflow:hidden} #kbMtBack .bar i{display:block;height:7px;width:0;background:${C.main};transition:width .3s}`;
  document.documentElement.appendChild(css);
  const btn = document.createElement("button"); btn.id = "kbMtBackBtn"; btn.type = "button"; btn.textContent = "kinbot：過去の会議を読む";
  const box = document.createElement("div"); box.id = "kbMtBack"; box.hidden = true;
  box.innerHTML = `<h4>過去の会議を kinbot に読む</h4><label style="font-size:12px;color:#5C7377">この日まで読む</label><input type="date" data-u value="2026-03-01">
    <button class="go" type="button" data-run>① 会議の一覧を読む</button><button class="sub" type="button" data-stop hidden>止める</button><div class="bar"><i data-b></i></div><div class="msg" data-m>会議履歴一覧のページを、新しい方から順にめくって、会議を kinbot に入れます。</div>
    <div style="border-top:1px solid #DDEFF2;margin-top:10px;padding-top:8px"><h4>② 文字起こし・議事録も読む</h4><div class="msg" style="margin-top:0">①で入れた会議を、裏のタブで1件ずつ開いて読みます（1件15秒ほど・録画は後回し）。数時間かかります。Chrome は開いたままにしてください。</div>
    <button class="go" type="button" data-det>文字起こし・議事録を読み始める</button><button class="sub" type="button" data-dstop>止める</button><div class="msg" data-dm></div></div>`;
  const mount = () => { if (!document.body) return setTimeout(mount, 300); document.body.appendChild(btn); document.body.appendChild(box); };
  mount();
  const $ = (s) => box.querySelector(s);
  btn.onclick = () => { box.hidden = !box.hidden; if (!box.hidden) { window.postMessage({ __kbMtBackAsk: true }, "*"); showDet(); } };
  $("[data-run]").onclick = () => { const u = $("[data-u]").value || "2026-03-01"; $("[data-run]").disabled = true; $("[data-run]").textContent = "読んでいます…"; $("[data-stop]").hidden = false; window.postMessage({ __kbMtBackRun: true, until: u }, "*"); };
  $("[data-stop]").onclick = () => window.postMessage({ __kbMtBackStop: true }, "*");
  const until = () => new Date(($("[data-u]").value || "2026-03-01") + "T00:00:00+09:00").getTime();
  window.addEventListener("message", (e) => { const d = e.data; if (!d || !d.__kbMtBack || e.source !== window) return;
    const fmtD = (t) => { const x = new Date(t); return `${x.getMonth() + 1}/${x.getDate()}`; };
    if (d.ready === false) { $("[data-m]").textContent = "会議の一覧がまだ見えていません。この画面を読み込み直して（F5）、一覧が出てから押してください。"; return; }
    if (d.ready) return;
    if (d.oldest != null) { const now = Date.now(); $("[data-b]").style.width = Math.max(3, Math.min(100, Math.round((now - d.oldest) / Math.max(1, now - until()) * 100))) + "%"; }
    const dg = d.diag ? `\n（手がかり：${d.diag.path}／URL：${d.diag.q || "なし"}／本文：${d.diag.b || "なし"}／返事：${d.diag.res || "?"}）` : "";
    if (d.one) { $("[data-m]").textContent = `1ページ目（${d.got}件）は入れましたが、2ページ目のめくり方が見つかりませんでした。この画面を見せてください。${dg}`; $("[data-run]").disabled = false; $("[data-run]").textContent = "① もう一度読む"; $("[data-stop]").hidden = true; return; }
    $("[data-m]").textContent = d.error ? `止まりました：${d.error}（${d.got || 0}件までは kinbot に入っています）${dg}` : d.done ? `${d.stopped ? "止めました" : "終わりました"}：${d.got}件（${d.pages}ページ）の会議を kinbot に入れました${d.oldest ? `。いちばん古い会議：${fmtD(d.oldest)}` : ""}。\n続けて②で文字起こし・議事録を読めます。` : `${d.got}件（${d.pages}ページ）読みました…${d.oldest ? ` いま ${fmtD(d.oldest)} あたり` : ""}`;
    if (d.done || d.error) { $("[data-run]").disabled = false; $("[data-run]").textContent = "① もう一度読む"; $("[data-stop]").hidden = true; if (d.done) $("[data-b]").style.width = "100%"; } });
  // ② 文字起こし・議事録（拡張機能の裏で、kinbot に「まだの会議」を聞きながら順に開く）
  const days = () => Math.max(1, Math.ceil((Date.now() - until()) / 86400000) + 1);
  $("[data-det]").onclick = () => { chrome.runtime.sendMessage({ type: "kb-miitel-backfill", days: days() }, () => {}); setTimeout(showDet, 800); };
  $("[data-dstop]").onclick = () => { chrome.runtime.sendMessage({ type: "kb-miitel-backfill-stop" }, () => {}); setTimeout(showDet, 800); };
  // 進み具合は1件ずつ：10件のまとまりの合計（kbMtBackDet）＋いま開いているまとまりの何件目か（kbMiitelCrawl）（2026-11-15「15秒たっても0件のまま」）
  async function showDet() { try { const st = await chrome.storage.local.get(["kbMtBackDet", "kbMiitelCrawl"]); const b = st.kbMtBackDet; const cr = st.kbMiitelCrawl; const el = $("[data-dm]");
      const inBatch = b && b.running && cr && cr.at > (b.at || 0) - 1000 && cr.done < cr.total ? cr.done : 0; const n = b ? b.done + inBatch : 0;
      const hm = (t) => new Date(t).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      el.textContent = !b ? "" : b.running ? `読んでいます：${n}件 読みました${cr && cr.total && cr.done < cr.total ? `（いま裏のタブで ${cr.done + 1} / ${cr.total} 件目を開いています）` : ""}・最後に動いた ${hm(Math.max(b.at || 0, (cr && cr.at) || 0))}${b.left != null ? `\n残り約 ${b.left}件（1件15秒ほど：あと約${Math.ceil(b.left * 15 / 3600)}時間）` : ""}` : `${b.stopped ? "止めました" : "終わりました"}：${b.done}件 読みました`;
      $("[data-det]").disabled = !!(b && b.running); $("[data-det]").textContent = b && b.running ? "読んでいます…" : "文字起こし・議事録を読み始める"; } catch {} if (!box.hidden) setTimeout(showDet, 3000); }
})();
