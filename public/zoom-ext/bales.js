// Bales Cloud の画面（拡張機能の側）：右下に「kinbot に取り込む」を出し、bales-hook.js が読んだ一覧を kinbot に送る（2026-11-15 田中さん）
(function () {
  if (window.top !== window || document.getElementById("kbBalesBtn")) return;
  const C = { deep: "#0B6E78", main: "#0E9AA7", light: "#DDF5F7", line: "#9FD9DF" };
  const ICO = `<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="4" fill="${C.main}"/><rect x="5" y="7" width="10" height="1.8" rx=".9" fill="#fff"/><rect x="5" y="11" width="7" height="1.8" rx=".9" fill="#fff"/></svg>`;
  const css = document.createElement("style");
  css.textContent = `#kbBalesBtn{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:6px;border:1.5px solid ${C.line};background:#fff;color:${C.deep};font:700 13px/1 system-ui,sans-serif;border-radius:999px;padding:9px 14px;box-shadow:0 4px 14px rgba(14,154,167,.18);cursor:pointer}
  #kbBalesBox{position:fixed;right:18px;bottom:64px;z-index:2147483000;width:340px;background:#fff;border:1.5px solid ${C.line};border-radius:14px;box-shadow:0 8px 28px rgba(15,61,68,.18);padding:14px;font:13px/1.5 system-ui,sans-serif;color:#0F3D44}
  #kbBalesBox h4{margin:0 0 8px;font-size:14px;color:${C.deep}} #kbBalesBox label{display:block;font-size:12px;color:#5C7377;margin:8px 0 3px}
  #kbBalesBox input,#kbBalesBox select{width:100%;box-sizing:border-box;border:1px solid #CFE6EA;border-radius:9px;padding:7px 9px;font:inherit}
  #kbBalesBox .go{margin-top:10px;width:100%;border:0;border-radius:10px;background:${C.main};color:#fff;font-weight:700;padding:9px;cursor:pointer}
  #kbBalesBox .bar{height:7px;background:${C.light};border-radius:4px;margin-top:10px;overflow:hidden} #kbBalesBox .bar i{display:block;height:7px;width:0;background:${C.main};transition:width .3s}
  #kbBalesBox .msg{font-size:12px;color:#5C7377;margin-top:6px;white-space:pre-wrap} #kbBalesBox .x{position:absolute;right:10px;top:8px;border:0;background:none;font-size:16px;color:#5C7377;cursor:pointer}`;
  document.documentElement.appendChild(css);
  const btn = document.createElement("button"); btn.id = "kbBalesBtn"; btn.type = "button"; btn.innerHTML = `${ICO}<span>kinbot に取り込む</span>`;
  const box = document.createElement("div"); box.id = "kbBalesBox"; box.hidden = true;
  const mount = () => { if (!document.body) return setTimeout(mount, 300); document.body.appendChild(btn); document.body.appendChild(box); };
  mount();
  let cands = [];
  const pageName = () => { const h = document.querySelector("h1, h2, [class*='title' i] h1, [class*='header' i] h2"); const t = (h && h.innerText || "").trim().split("\n")[0]; return (t && t.length < 60 ? t : document.title || "Bales のリスト").trim(); };
  const draw = () => {
    const best = cands.findIndex((c) => c.lead && c.pager) >= 0 ? cands.findIndex((c) => c.lead && c.pager) : cands.findIndex((c) => c.lead) >= 0 ? cands.findIndex((c) => c.lead) : 0;
    box.innerHTML = `<button class="x" type="button" aria-label="閉じる">×</button><h4>kinbot に取り込む<small style="font-weight:400;color:#5C7377;margin-left:6px">版 ${(() => { try { return chrome.runtime.getManifest().version; } catch { return "?（ページを読み込み直してください）"; } })()}</small></h4>
      ${cands.length ? `<label>リストの名前（kinbot で出る名前）</label><input data-n value="${pageName().replace(/"/g, "&quot;")}">
        <label>読む一覧（ふつうは変えなくてよい）</label><select data-c>${cands.map((c) => `<option value="${c.i}" ${c.i === cands[best].i ? "selected" : ""}>${c.ep}（${c.n}件${c.total != null ? `／全${c.total}件` : ""}${c.pager ? "" : "・めくり方不明"}）</option>`).join("")}</select>
        <button class="go" type="button" data-go>全部取り込む</button><div class="bar"><i></i></div><div class="msg" data-m>最後のページまで自動でめくって kinbot に送ります。終わるまでこのタブは開いたままにしてください。</div>`
      : `<div class="msg">まだ一覧のデータが見えていません。Bales のリスト（リード一覧）を開いて、一覧が表示されてからもう一度押してください。うまくいかないときは、ページを読み込み直してください。</div>`}`;
    box.querySelector(".x").onclick = () => { box.hidden = true; };
    const go = box.querySelector("[data-go]"); if (go) go.onclick = () => { go.disabled = true; go.textContent = "取り込んでいます…"; window.postMessage({ __kbBalesRun: true, i: Number(box.querySelector("[data-c]").value), name: box.querySelector("[data-n]").value.trim() }, "*"); };
  };
  btn.onclick = () => { if (!box.hidden) { box.hidden = true; return; } box.hidden = false; box.innerHTML = '<div class="msg">一覧のデータを探しています…</div>'; let got = false; const once = (e) => { if (e.data && e.data.__kbBalesCands) got = true; }; window.addEventListener("message", once); window.postMessage({ __kbBalesAsk: true }, "*");
    // ページの中の読み取り部分（bales-hook.js）から返事が無い＝動いていない
    setTimeout(() => { window.removeEventListener("message", once); if (got) return; box.innerHTML = '<button class="x" type="button" aria-label="閉じる">×</button><div class="msg">一覧を読む部分が動いていません。Bales のページを読み込み直して（F5）、一覧が出てからもう一度押してください。</div>'; box.querySelector(".x").onclick = () => { box.hidden = true; };
      let ver = ""; try { ver = chrome.runtime.getManifest().version; } catch {} chrome.runtime.sendMessage({ type: "kb-bales-rows", payload: { listKey: "diag", diag: { ver, href: location.href.split("?")[0], nohook: true, cands: [], seen: [] } } }, () => {}); }, 3000); };
  window.addEventListener("message", (e) => {
    const d = e.data; if (!d || e.source !== window) return;
    if (d.__kbBalesCands) { cands = d.items || []; draw();
      // 取り込めないときの手がかり：拡張機能の版・ページ・見えた通り道（名前と件数だけ）を kinbot に残す（2026-11-15）
      let ver = ""; try { ver = chrome.runtime.getManifest().version; } catch {}
      chrome.runtime.sendMessage({ type: "kb-bales-rows", payload: { listKey: "diag", diag: { ver, href: String(d.href || location.href).split("?")[0], cands: cands.map((c) => ({ ep: c.ep, n: c.n, total: c.total, pager: c.pager, keys: c.keys })), seen: d.seen || [] } } }, () => {}); }
    if (d.__kbBalesProg) { const m = box.querySelector("[data-m]"), bar = box.querySelector(".bar i"), go = box.querySelector("[data-go]");
      if (bar && d.total) bar.style.width = Math.min(100, Math.round((d.got || 0) / d.total * 100)) + "%";
      if (m) m.textContent = d.error ? `止まりました：${d.error}（${d.got || 0}件までは kinbot に入っています）` : d.done ? `終わりました：${d.got}件を kinbot に入れました。${d.warn ? "\n" + d.warn : ""}\nkinbot for MOCHICA の「リスト（Bales Cloud）」で見られます。` : d.step ? d.step : `${d.got}件${d.total ? ` / ${d.total}件` : ""} 送りました…`;
      if (go && (d.done || d.error)) { go.disabled = false; go.textContent = "もう一度取り込む"; if (bar && d.done) bar.style.width = "100%"; } }
    // ページの中から kinbot へ送る頼み：拡張機能の裏（background）に渡す
    // 拡張機能を入れ直したあと、ページを読み込み直していないと chrome.runtime が使えない → すぐに知らせる（2026-11-15）
    if (d.__kbBalesSend) { try { chrome.runtime.sendMessage({ type: "kb-bales-rows", payload: d.payload }, (r) => { const le = chrome.runtime.lastError; window.postMessage({ __kbBalesAck: true, id: d.id, ...(r || { ok: false, error: le ? "拡張機能とつながりません。このページを読み込み直してください" : "拡張機能から返事がありません" }) }, "*"); }); }
      catch { window.postMessage({ __kbBalesAck: true, id: d.id, ok: false, error: "拡張機能が入れ直されました。このページを読み込み直してから、もう一度押してください" }, "*"); } }
  });
})();
