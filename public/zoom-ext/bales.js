// Bales Cloud の画面（拡張機能の側）：右下に「kinbot に取り込む」を出し、bales-hook.js が読んだ一覧を kinbot に送る（2026-11-15 田中さん）
(function () {
  if (window.top !== window || document.getElementById("kbBalesBtn")) return;
  const C = { deep: "#0B6E78", main: "#0E9AA7", light: "#DDF5F7", line: "#9FD9DF" };
  const ICO = `<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="3" width="16" height="14" rx="4" fill="${C.main}"/><rect x="5" y="7" width="10" height="1.8" rx=".9" fill="#fff"/><rect x="5" y="11" width="7" height="1.8" rx=".9" fill="#fff"/></svg>`;
  const css = document.createElement("style");
  css.textContent = `#kbBalesBtn{position:fixed;right:18px;bottom:18px;z-index:2147483000;display:flex;align-items:center;gap:6px;border:1.5px solid ${C.line};background:#fff;color:${C.deep};font:700 13px/1 system-ui,sans-serif;border-radius:999px;padding:9px 14px;box-shadow:0 4px 14px rgba(14,154,167,.18);cursor:pointer}
  #kbBalesBox .sec{border-top:1px solid #DDEFF2;margin-top:10px;padding-top:8px} #kbBalesBox .sec>h4{cursor:pointer;display:flex;align-items:center;gap:6px;margin:0;font-size:13px} #kbBalesBox .sec>h4::before{content:"";width:7px;height:7px;border-right:2px solid ${C.main};border-bottom:2px solid ${C.main};transform:rotate(-45deg);transition:transform .15s;flex:none} #kbBalesBox .sec.open>h4::before{transform:rotate(45deg)} #kbBalesBox .sec:not(.open)>:not(h4){display:none} #kbBalesBox .sec.open>h4{margin-bottom:6px}
  #kbBalesBox{max-height:calc(100vh - 90px);overflow-y:auto;box-sizing:border-box;}
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
  // 開く欄：前に開いた欄。初めては、リードの画面なら「書き込む」、ほかは「一覧を全部取り込む」
  const openKey = () => { try { return localStorage.getItem("kbBalesOpen") || ""; } catch { return ""; } };
  const openSec = () => { const k = openKey() || (/callTargetId=/.test(location.search) ? "wr" : "list"); box.querySelectorAll(".sec").forEach((x) => x.classList.toggle("open", x.dataset.sec === k)); };
  box.addEventListener("click", (e) => { const h = e.target.closest(".sec>h4"); if (!h || e.target.closest("a")) return; const sec = h.parentElement; const was = sec.classList.contains("open");
    box.querySelectorAll(".sec").forEach((x) => x.classList.remove("open")); if (!was) sec.classList.add("open"); try { localStorage.setItem("kbBalesOpen", was ? "" : sec.dataset.sec); } catch {} });
  // リストの名前：Bales の左上の「すべてのリード」のような、いま開いているリードのリストの名前（2026-11-15）
  const pageName = () => { for (const el of document.querySelectorAll("button, div, span, p")) { if (el.children.length > 2) continue; const t = (el.innerText || "").trim(); if (t && t.length <= 30 && /リード$/.test(t) && el.getBoundingClientRect().top < 260 && el.getBoundingClientRect().width > 0) return t; } return "すべてのリード"; };
  // 読む一覧の名前（Bales の画面が裏で読んでいるデータの名前を、わかる言葉に）
  const EPN = { call_targets: "リード一覧", mail_notifications: "メールの通知", users: "メンバー", lead_sources: "リードソース", lead_stages: "リードステージ", call_result_types: "コール結果の種類", custom_fields: "カスタム項目", sent_bulk_mail_names: "一斉メールの名前", assigned_user_candidates: "担当の候補" };
  const epName = (ep) => { const k = String(ep).split("/").pop(); return EPN[k] ? `${EPN[k]}（${k}）` : k; };
  const draw = () => {
    // リード一覧（call_targets）があればそれ。無ければ、ページの中で並べ替えた一番上（画面の件数と合うもの）
    const best = Math.max(0, cands.findIndex((c) => /\/call_targets$/.test(c.ep)));
    box.innerHTML = `<button class="x" type="button" aria-label="閉じる">×</button><h4>kinbot に取り込む<small style="font-weight:400;color:#5C7377;margin-left:6px">版 ${(() => { try { return chrome.runtime.getManifest().version; } catch { return "?（ページを読み込み直してください）"; } })()}</small></h4>
      <div class="sec" data-sec="list"><h4>一覧を全部取り込む</h4>${cands.length ? `<label>リストの名前（kinbot で出る名前）</label><input data-n value="${pageName().replace(/"/g, "&quot;")}">
        <label>読む一覧</label><div class="msg" style="margin:0;color:#0F3D44"><b>${epName(cands[best].ep)}</b>・1ページ ${cands[best].n}件 <a href="#" data-chg style="color:#0E9AA7">変える</a></div>
        <select data-c hidden>${cands.map((c) => `<option value="${c.i}" ${c.i === cands[best].i ? "selected" : ""}>${epName(c.ep)}（${c.n}件）</option>`).join("")}</select>
        <button class="go" type="button" data-go>全部取り込む</button><div class="bar"><i></i></div><div class="msg" data-m>最後のページまで自動でめくって kinbot に送ります。終わるまでこのタブは開いたままにしてください。</div>`
      : `<div class="msg">まだ一覧のデータが見えていません。Bales のリスト（リード一覧）を開いて、一覧が表示されてからもう一度押してください。うまくいかないときは、ページを読み込み直してください。</div>`}</div>`;
    box.insertAdjacentHTML("beforeend", '<div class="sec" data-sec="det" data-det><div class="msg">詳しい中身の読み方を確かめています…</div></div>');
    window.postMessage({ __kbBalesTpls: true }, "*");
    box.insertAdjacentHTML("beforeend", '<div class="sec" data-sec="fd" data-fd><h4>見張る</h4></div>');
    window.postMessage({ __kbBalesFeedAsk: true }, "*");
    box.insertAdjacentHTML("beforeend", '<div class="sec" data-sec="wr" data-wr><h4>Bales に書き込む</h4></div>');
    openSec();
    window.postMessage({ __kbBalesWAsk: true }, "*");
    box.querySelector(".x").onclick = () => { box.hidden = true; };
    const chg = box.querySelector("[data-chg]"); if (chg) chg.onclick = (e) => { e.preventDefault(); box.querySelector("[data-c]").hidden = false; chg.hidden = true; };
    const go = box.querySelector("[data-go]"); if (go) go.onclick = () => { go.disabled = true; go.textContent = "取り込んでいます…"; window.postMessage({ __kbBalesRun: true, i: Number(box.querySelector("[data-c]").value), name: box.querySelector("[data-n]").value.trim() }, "*"); };
  };
  btn.onclick = () => { if (!box.hidden) { box.hidden = true; return; } box.hidden = false; box.innerHTML = '<div class="msg">一覧のデータを探しています…</div>'; let got = false; const once = (e) => { if (e.data && e.data.__kbBalesCands) got = true; }; window.addEventListener("message", once); window.postMessage({ __kbBalesAsk: true }, "*");
    // ページの中の読み取り部分（bales-hook.js）から返事が無い＝動いていない
    setTimeout(() => { window.removeEventListener("message", once); if (got) return; box.innerHTML = '<button class="x" type="button" aria-label="閉じる">×</button><div class="msg">一覧を読む部分が動いていません。Bales のページを読み込み直して（F5）、一覧が出てからもう一度押してください。</div>'; box.querySelector(".x").onclick = () => { box.hidden = true; };
      let ver = ""; try { ver = chrome.runtime.getManifest().version; } catch {} chrome.runtime.sendMessage({ type: "kb-bales-rows", payload: { listKey: "diag", diag: { ver, href: location.href.split("?")[0], nohook: true, cands: [], seen: [] } } }, () => {}); }, 3000); };
  try { chrome.runtime.onMessage.addListener((msg, sender, reply) => { if (msg && msg.type === "kb-bales-sync") { window.postMessage({ __kbBalesSync: true, why: "自動" }, "*"); reply({ ok: true }); } }); } catch {}
  // 覚えたものを拡張機能の保存場所と行き来させる
  try { chrome.storage.local.get(["kbBalesTpl", "kbBalesFeeds", "kbBalesWrite"], (st) => { for (const k of ["kbBalesTpl", "kbBalesFeeds", "kbBalesWrite"]) if (st && st[k]) window.postMessage({ __kbBalesRestore: true, key: k, val: st[k] }, "*"); }); } catch {}
  window.addEventListener("message", (e) => {
    const d = e.data; if (!d || e.source !== window) return;
    if (d.__kbBalesKeep) { try { if (d.val == null) chrome.storage.local.remove(d.key); else chrome.storage.local.set({ [d.key]: d.val }); } catch {} return; }
    if (d.__kbBalesCands) { cands = d.items || []; draw();
      // 取り込めないときの手がかり：拡張機能の版・ページ・見えた通り道（名前と件数だけ）を kinbot に残す（2026-11-15）
      let ver = ""; try { ver = chrome.runtime.getManifest().version; } catch {}
      chrome.runtime.sendMessage({ type: "kb-bales-rows", payload: { listKey: "diag", diag: { ver, href: String(d.href || location.href).split("?")[0], cands: cands.map((c) => ({ ep: c.ep, n: c.n, total: c.total, pager: c.pager, keys: c.keys })), seen: d.seen || [] } } }, () => {}); }
    if (d.__kbBalesTplList) { const el = box.querySelector("[data-det]"); if (!el) return; const n = (d.names || []).length;
      el.innerHTML = `<h4>詳しい中身（架電履歴・カスタム情報など）</h4>` + (n
        ? `<div class="msg" style="margin:0">リード1件の読み方を ${n} 個覚えています：${(d.names || []).slice(0, 8).join("、")} <a href="#" data-tclr style="color:#0E9AA7">覚え直す</a></div>
           <button class="go" type="button" data-dgo>詳しい中身も全部取り込む</button><button type="button" data-dstop style="display:none;margin-top:6px;width:100%;border:1px solid #CFE6EA;background:#fff;border-radius:10px;padding:7px;cursor:pointer">止める（あとで続きから）</button>
           <div class="bar"><i data-dbar></i></div><div class="msg" data-dm>リードを1件ずつ読みます。2.3万件で数時間かかります。途中で止めても、次は続きから読みます。このタブは開いたままにしてください。</div>`
        : `<div class="msg">${d.lead ? "まだ読み方を覚えていません。このリードの画面を読み込み直して（F5）、架電履歴やカスタム情報が出てから、もう一度右下のボタンを押してください。（前に覚えた読み方は、Bales にログインし直すと消えることがあります。この版からは消えないように残します）" : "まだ読み方を覚えていません。リードを1件開いて（会社名を押す）、中身が出たら、もう一度右下のボタンを押してください。"}</div>`);
      const g = el.querySelector("[data-dgo]"), st = el.querySelector("[data-dstop]"), cl = el.querySelector("[data-tclr]");
      if (g) g.onclick = () => { g.disabled = true; g.textContent = "取り込んでいます…"; st.style.display = "block"; const ni = box.querySelector("[data-n]"); window.postMessage({ __kbBalesDetail: true, name: ni ? ni.value.trim() : pageName() }, "*"); };
      if (st) st.onclick = () => { st.textContent = "止めています…"; window.postMessage({ __kbBalesStop: true }, "*"); };
      if (cl) cl.onclick = (e) => { e.preventDefault(); if (confirm("覚えた読み方を消して、覚え直しますか？（リードを1件開き直すと覚えます）")) window.postMessage({ __kbBalesTplClear: true }, "*"); };
      return; }
    // ===== 見張る（平日10〜19時、10分ごとに新しい行を kinbot へ）=====
    if (d.__kbBalesFeedIs) { const el = box.querySelector("[data-fd]"); if (!el) return; const fs = d.feeds || [];
      try { chrome.storage.local.set({ kbBalesWatch: fs.length > 0, kbBalesWatchPages: fs.map((f) => f.page) }); } catch {}
      el.innerHTML = `<h4>見張る（平日10〜19時に10分ごと）</h4>
        <div class="msg" style="margin:0 0 6px">この画面の一覧（架電の記録など）を登録すると、Chrome が開いていれば、新しい行を自動で kinbot に入れます。</div>
        ${fs.map((f) => `<div class="msg" style="margin:2px 0;color:#0F3D44"><b>${f.name}</b>${f.pager ? "" : "（1ページ目だけ）"}${f.view && f.view.length ? `<br><small>${f.view.slice(0, 6).join("・")}</small>` : ""} <a href="#" data-fdel="${f.key}" style="color:#B4442E">外す</a></div>`).join("")}
        <label>見張りの名前</label><input data-fn value="${fs.length ? "" : "架電の記録"}" placeholder="例：架電の記録">
        <button class="go" type="button" data-fadd>この画面の一覧を見張る</button>${fs.length ? '<button type="button" data-fsync style="margin-top:6px;width:100%;border:1px solid #CFE6EA;background:#fff;border-radius:10px;padding:7px;cursor:pointer">いま読む</button>' : ""}<div class="msg" data-fm></div>`;
      el.querySelectorAll("[data-fdel]").forEach((a) => a.onclick = (e) => { e.preventDefault(); if (confirm("この見張りを外しますか？（kinbot に入った分は残ります）")) window.postMessage({ __kbBalesFeedDel: true, key: a.dataset.fdel }, "*"); });
      const fa = el.querySelector("[data-fadd]"); fa.onclick = () => { const n = el.querySelector("[data-fn]").value.trim(); if (!n) { el.querySelector("[data-fm]").textContent = "見張りの名前を入れてください"; return; } fa.disabled = true; fa.textContent = "登録しています…"; window.postMessage({ __kbBalesFeedAdd: true, name: n }, "*"); };
      const fsb = el.querySelector("[data-fsync]"); if (fsb) fsb.onclick = () => { fsb.disabled = true; fsb.textContent = "読んでいます…"; window.postMessage({ __kbBalesSync: true, why: "手で" }, "*"); };
      return; }
    if (d.__kbBalesFeedAdded) { window.postMessage({ __kbBalesFeedAsk: true }, "*"); setTimeout(() => { const m = box.querySelector("[data-fm]"); if (m) m.textContent = d.ok ? `登録しました：${d.feed.name}（${d.feed.ep}・1ページ ${d.feed.n}件${d.feed.pager ? "" : "・めくり方不明なので1ページ目だけ"}）。見出し：${(d.feed.view || []).join("・") || "（見つからず）"}` : `登録できませんでした：${d.error || ""}`; }, 200); return; }
    if (d.__kbBalesSynced) { const m = box.querySelector("[data-fm]"); const b2 = box.querySelector("[data-fsync]"); if (b2) { b2.disabled = false; b2.textContent = "いま読む"; } if (m) m.textContent = "読みました：" + (d.out || []).map((x) => `${x.name} 新しい ${x.nw}件${x.err ? `（${x.err}）` : ""}`).join("、");
      try { chrome.storage.local.set({ kbBalesLastSync: { at: d.at, out: d.out } }); } catch {} return; }
    // ===== Bales に書き込む（SF の失注情報などをカスタム情報へ）=====
    if (d.__kbBalesWIs) { const el = box.querySelector("[data-wr]"); if (!el) return; const nm = () => { const ni = box.querySelector("[data-n]"); return ni ? ni.value.trim() : pageName(); };
      el.innerHTML = `<h4>Bales に書き込む（SF の失注情報 → カスタム情報）</h4>` + (d.learned
        ? `<div class="msg" style="margin:0">書き込み方を覚えています。 <a href="#" data-wf style="color:#0E9AA7">覚え直す</a></div>
           ${d.lead ? '<button class="go" type="button" data-wone style="background:#fff;color:#0B6E78;border:1.5px solid #9FD9DF">このリードに試しに書き込む</button>' : ""}
           <button class="go" type="button" data-wall>SF と結びついたリード全部に書き込む</button><button type="button" data-wstop style="display:none;margin-top:6px;width:100%;border:1px solid #CFE6EA;background:#fff;border-radius:10px;padding:7px;cursor:pointer">止める（あとで続きから）</button>
           <div class="bar"><i data-wbar></i></div><div class="msg" data-wm>まずリードを1件開いて「試しに書き込む」→ Bales のカスタム情報に SF の値が入ったかを確かめてから、全部に書き込んでください。</div>`
        : d.lead ? `<div class="msg">書き込み方を覚えます。このリードのカスタム情報「顧客の現状」に、半角で <b>kinbot</b> と入れて保存してから、下のボタンを押してください。（このあと「試しに書き込む」で SF の値に上書きされます。SF に値が無いときは kinbot のまま残るので、手で消してください）</div><button class="go" type="button" data-wl>書き込み方を覚える</button><div class="msg" data-wm></div>`
        : `<div class="msg">リードを1件開いた画面（会社名を押した画面）で、このボタンを押してください。そこで書き込み方を覚えます。</div>`);
      const wl = el.querySelector("[data-wl]"); if (wl) wl.onclick = () => { wl.disabled = true; wl.textContent = "覚えています…"; window.postMessage({ __kbBalesWLearn: true }, "*"); };
      const wf = el.querySelector("[data-wf]"); if (wf) wf.onclick = (e) => { e.preventDefault(); if (confirm("覚えた書き込み方を消して、覚え直しますか？")) window.postMessage({ __kbBalesWForget: true }, "*"); };
      const one = el.querySelector("[data-wone]"), alls = el.querySelector("[data-wall]"), st = el.querySelector("[data-wstop]");
      if (one) one.onclick = () => { if (!confirm("このリードのカスタム情報に、SF の失注情報などを書き込みます。よいですか？")) return; one.disabled = true; window.postMessage({ __kbBalesWRun: true, only: true, name: nm() }, "*"); };
      if (alls) alls.onclick = () => { if (!confirm("SF と結びついたリード全部のカスタム情報に、SF の失注情報などを書き込みます（Bales の値は SF の値で上書きされます）。始めますか？")) return; alls.disabled = true; alls.textContent = "書き込んでいます…"; st.style.display = "block"; window.postMessage({ __kbBalesWRun: true, only: false, name: nm() }, "*"); };
      if (st) st.onclick = () => { st.textContent = "止めています…"; window.postMessage({ __kbBalesWStop: true }, "*"); };
      return; }
    if (d.__kbBalesWLearned) { const m = box.querySelector("[data-wm]");
      if (d.ok) { window.postMessage({ __kbBalesWAsk: true }, "*"); }
      else { if (m) m.innerHTML = `覚えられませんでした：${String(d.reason || "").replace(/</g, "&lt;")}${d.seen && d.seen.length ? `<div style="font-size:10px;margin-top:6px;color:#5C7377">見えた保存：<br>${d.seen.map((x) => String(x).replace(/</g, "&lt;")).join("<br>")}</div>` : ""}${d.shape ? `<pre style="white-space:pre-wrap;font-size:10px;max-height:160px;overflow:auto;background:#F2FAFB;padding:6px;border-radius:8px">${(d.method || "") + " " + String(d.url || "").replace(/</g, "&lt;")}\n${JSON.stringify(d.shape, null, 1).replace(/</g, "&lt;").slice(0, 3000)}</pre>` : ""}`; const wl = box.querySelector("[data-wl]"); if (wl) { wl.disabled = false; wl.textContent = "もう一度覚える"; } }
      try { chrome.runtime.sendMessage({ type: "kb-bales-rows", payload: { listKey: "diag", writeDiag: { ok: !!d.ok, mode: d.mode, reason: d.reason, shape: d.shape || d.seen, url: d.url, method: d.method } } }, () => {}); } catch {}
      return; }
    if (d.__kbBalesProg && d.write) { const m = box.querySelector("[data-wm]"), bar = box.querySelector("[data-wbar]"), alls = box.querySelector("[data-wall]"), one = box.querySelector("[data-wone]"), st = box.querySelector("[data-wstop]");
      if (bar && d.total) bar.style.width = Math.min(100, Math.round((d.got || 0) / d.total * 100)) + "%";
      const sk = d.skipped && d.skipped.length ? `\n飛ばした項目：${d.skipped.join("、")}` : "";
      if (m) m.textContent = d.error ? `止まりました：${d.error}` : d.stopped ? `止めました：${d.got} / ${d.total}件。もう一度押すと続きから書きます。` : d.done ? (d.only ? `このリードに ${d.fields}項目 書き込みました。Bales の画面を読み込み直して、カスタム情報を確かめてください。${sk}` : `終わりました：${d.got}件（${d.fields}項目）書き込みました。${sk}`) : `${d.got} / ${d.total}件 書きました…`;
      if (d.done || d.error || d.stopped) { if (alls) { alls.disabled = false; alls.textContent = "続きから書き込む"; } if (one) one.disabled = false; if (st) { st.style.display = "none"; st.textContent = "止める（あとで続きから）"; } }
      return; }
    if (d.__kbBalesProg && d.detail) { const m = box.querySelector("[data-dm]"), bar = box.querySelector("[data-dbar]"), g = box.querySelector("[data-dgo]"), st = box.querySelector("[data-dstop]");
      if (bar && d.total) bar.style.width = Math.min(100, Math.round((d.got || 0) / d.total * 100)) + "%";
      if (m) m.textContent = d.error ? `止まりました：${d.error}` : d.stopped ? `止めました：${d.got} / ${d.total}件。もう一度押すと続きから読みます。` : d.done ? `終わりました：${d.got}件の詳しい中身を kinbot に入れました。` : d.step ? d.step : `${d.got} / ${d.total}件 読みました…`;
      if (g && (d.done || d.error || d.stopped)) { g.disabled = false; g.textContent = "続きから取り込む"; if (st) { st.style.display = "none"; st.textContent = "止める（あとで続きから）"; } }
      return; }
    if (d.__kbBalesProg) { const m = box.querySelector("[data-m]"), bar = box.querySelector(".bar i"), go = box.querySelector("[data-go]");
      if (bar && d.total) bar.style.width = Math.min(100, Math.round((d.got || 0) / d.total * 100)) + "%";
      if (m) m.textContent = d.error ? `止まりました：${d.error}（${d.got || 0}件までは kinbot に入っています）` : d.done ? `終わりました：${d.got}件を kinbot に入れました。${d.warn ? "\n" + d.warn : ""}\nSHOBO の「リスト（Bales Cloud）」で見られます。` : d.step ? d.step : `${d.got}件${d.total ? ` / ${d.total}件` : ""} 送りました…`;
      if (go && (d.done || d.error)) { go.disabled = false; go.textContent = "もう一度取り込む"; if (bar && d.done) bar.style.width = "100%"; } }
    // ページの中から kinbot へ送る頼み：拡張機能の裏（background）に渡す
    // 拡張機能を入れ直したあと、ページを読み込み直していないと chrome.runtime が使えない → すぐに知らせる（2026-11-15）
    if (d.__kbBalesSend) { try { chrome.runtime.sendMessage({ type: "kb-bales-rows", payload: d.payload }, (r) => { const le = chrome.runtime.lastError; window.postMessage({ __kbBalesAck: true, id: d.id, ...(r || { ok: false, error: le ? "拡張機能とつながりません。このページを読み込み直してください" : "拡張機能から返事がありません" }) }, "*"); }); }
      catch { window.postMessage({ __kbBalesAck: true, id: d.id, ok: false, error: "拡張機能が入れ直されました。このページを読み込み直してから、もう一度押してください" }, "*"); } }
  });
})();
