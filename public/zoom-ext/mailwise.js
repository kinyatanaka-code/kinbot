// メールワイズ（*.cybozu.com/m/）：kinXs から渡された下書きを、メールの作成・返信の画面に入れる（2026-11-10 田中さん）
//   メールワイズには外から送らせる仕組み（API）が無いので、最後の「送信」はメールワイズで押す。送ったメールはメールワイズに残る
(function () {
  if (window.top !== window) return;
  const KEY = "kxMwDrafts";
  const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none"; };
  const setVal = (el, v) => { const proto = Object.getPrototypeOf(el); const d = Object.getOwnPropertyDescriptor(proto, "value"); el.focus(); if (d && d.set) d.set.call(el, v); else el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); el.dispatchEvent(new Event("blur", { bubbles: true })); };
  // 画面と、同じサイトの iframe（本文の書式つきエディタなど）を全部見る
  const docs = () => { const out = [document]; document.querySelectorAll("iframe").forEach((f) => { try { if (f.contentDocument) out.push(f.contentDocument); } catch {} }); return out; };
  const labelOf = (el) => {
    const t = [];
    if (el.id) { const l = el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) t.push(l.innerText); }
    const tr = el.closest("tr"); if (tr) { const th = tr.querySelector("th"); if (th) t.push(th.innerText); else if (tr.cells && tr.cells[0] && !tr.cells[0].contains(el)) t.push(tr.cells[0].innerText); }
    const dd = el.closest("dd"); if (dd && dd.previousElementSibling) t.push(dd.previousElementSibling.innerText);
    t.push(el.getAttribute("aria-label") || "", el.getAttribute("placeholder") || "", el.getAttribute("title") || "", el.name || "", el.id || "");
    return t.join(" ").replace(/\s+/g, " ");
  };
  function findFields() {
    const f = { to: null, cc: null, subject: null, body: null, bodyDoc: null };
    for (const d of docs()) {
      for (const el of d.querySelectorAll('input[type="text"], input[type="email"], input:not([type])')) {
        if (!vis(el) && d === document) continue;
        const l = labelOf(el);
        if (!f.subject && /件名|subject|title/i.test(l)) f.subject = el;
        else if (!f.cc && /(^|\W)cc(\W|$)|ＣＣ/i.test(l) && !/bcc/i.test(l)) f.cc = el;
        else if (!f.to && /宛先|(^|\W)to(\W|$)|mail_?to|address/i.test(l) && !/cc|from|差出人|送信者/i.test(l)) f.to = el;
      }
      if (!f.body) {
        const tas = [...d.querySelectorAll("textarea")].filter((t) => vis(t) || d !== document).sort((a, b) => (b.offsetHeight * b.offsetWidth) - (a.offsetHeight * a.offsetWidth));
        if (tas[0]) f.body = tas[0];
      }
      if (!f.body) {
        const ce = [...d.querySelectorAll('[contenteditable="true"], body[contenteditable], body.cke_editable')].sort((a, b) => (b.offsetHeight * b.offsetWidth) - (a.offsetHeight * a.offsetWidth))[0];
        if (ce) { f.body = ce; f.bodyDoc = d; } else if (d !== document && d.designMode === "on" && d.body) { f.body = d.body; f.bodyDoc = d; }
      }
    }
    return f;
  }
  const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const copy = async (t, btn) => { try { await navigator.clipboard.writeText(t); } catch { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove(); } if (btn) { const o = btn.textContent; btn.textContent = "コピーしました"; setTimeout(() => (btn.textContent = o), 1200); } };
  function fill(dr) {
    const f = findFields(); const done = [], miss = [];
    if (f.to) { if (!f.to.value.trim() || !dr.reply) { setVal(f.to, dr.to); done.push("宛先"); } else done.push("宛先（返信の宛先のまま）"); } else if (!dr.reply) miss.push("宛先");
    if (dr.cc) { if (f.cc) { setVal(f.cc, dr.cc); done.push("CC"); } else miss.push("CC"); }
    if (f.subject) { if (!dr.reply || !f.subject.value.trim()) { setVal(f.subject, dr.subject); } done.push("件名"); } else miss.push("件名");
    if (f.body) {
      if (f.body.tagName === "TEXTAREA") { const cur = f.body.value; setVal(f.body, dr.reply && cur.trim() ? `${dr.body}\n\n${cur}` : dr.body); }
      else { const html = esc(dr.body).replace(/\n/g, "<br>"); f.body.innerHTML = dr.reply && f.body.innerText.trim() ? `${html}<br><br>${f.body.innerHTML}` : html; f.body.dispatchEvent(new Event("input", { bubbles: true })); }
      done.push("本文");
    } else miss.push("本文");
    return { done, miss };
  }
  let open = true;
  async function render() {
    const { [KEY]: st } = await chrome.storage.local.get(KEY);
    const list = ((st && st.list) || []).filter((x) => !x.done);
    let box = document.getElementById("kxMwPanel");
    if (!list.length) { if (box) box.remove(); return; }
    if (!box) { box = document.createElement("div"); box.id = "kxMwPanel"; document.body.appendChild(box); }
    box.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483647;width:340px;max-height:70vh;overflow:auto;background:#fff;border:1px solid #CFE0D8;border-radius:14px;box-shadow:0 12px 32px -12px rgba(0,0,0,.35);font:13px/1.5 sans-serif;color:#14231D;";
    box.innerHTML = `<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#0E6B4E;color:#fff;border-radius:14px 14px 0 0;cursor:pointer" data-tg><b style="flex:1">kinXsの下書き（${list.length}件）</b><span>${open ? "▾" : "▸"}</span></div>` +
      (open ? `<div style="padding:8px 12px;font-size:12px;color:#5B6B63">メールワイズで「メールを作成」（返信なら元のメールを開いて「返信」）を押してから「入れる」。最後の「送信」はメールワイズで押してください。</div>` +
      list.map((x) => `<div style="border-top:1px solid #EEF3F0;padding:8px 12px" data-k="${esc(x.key)}">
        <div><b>${esc(x.company)}</b>${x.reply ? ' <span style="background:#FDECE6;color:#B4441F;border-radius:99px;padding:0 6px;font-size:11px">返信</span>' : ""}</div>
        <div style="font-size:12px;color:#5B6B63">宛先：${esc(x.to)}${x.cc ? `／CC：${esc(x.cc)}` : ""}<br>件名：${esc(x.subject)}${x.reply && x.orig ? `<br>元のメール：${esc(x.orig)}` : ""}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">
          <button data-a="fill" style="background:#0E6B4E;color:#fff;border:0;border-radius:8px;padding:4px 10px;cursor:pointer;font-weight:700">入れる</button>
          <button data-a="to" style="border:1px solid #CFE0D8;background:#fff;border-radius:8px;padding:4px 8px;cursor:pointer">宛先コピー</button>
          <button data-a="sub" style="border:1px solid #CFE0D8;background:#fff;border-radius:8px;padding:4px 8px;cursor:pointer">件名コピー</button>
          <button data-a="body" style="border:1px solid #CFE0D8;background:#fff;border-radius:8px;padding:4px 8px;cursor:pointer">本文コピー</button>
          <button data-a="done" style="border:1px solid #CFE0D8;background:#fff;border-radius:8px;padding:4px 8px;cursor:pointer;margin-left:auto">送った ✓</button>
        </div><div data-msg style="font-size:12px;margin-top:4px"></div></div>`).join("") +
      `<div style="border-top:1px solid #EEF3F0;padding:8px 12px;text-align:right"><button data-clear style="border:0;background:none;color:#8FA39A;cursor:pointer;font-size:12px">下書きを全部消す</button></div>` : "");
    box.querySelector("[data-tg]").onclick = () => { open = !open; render(); };
    const clr = box.querySelector("[data-clear]"); if (clr) clr.onclick = async () => { if (!confirm("kinXsから渡された下書きを全部消しますか？")) return; await chrome.storage.local.remove(KEY); render(); };
    box.querySelectorAll("[data-k]").forEach((row) => {
      const x = list.find((y) => y.key === row.dataset.k); const msg = row.querySelector("[data-msg]");
      row.querySelectorAll("[data-a]").forEach((b) => b.onclick = async () => {
        const a = b.dataset.a;
        if (a === "to") return copy(x.to, b); if (a === "sub") return copy(x.subject, b); if (a === "body") return copy(x.body, b);
        if (a === "done") { const { [KEY]: s2 } = await chrome.storage.local.get(KEY); (s2.list || []).forEach((y) => { if (y.key === x.key) y.done = true; }); await chrome.storage.local.set({ [KEY]: s2 }); return render(); }
        if (a === "fill") { const r = fill(x); msg.innerHTML = r.done.length ? `<span style="color:#0E6B4E">入れました：${r.done.join("・")}</span>${r.miss.length ? `<br><span style="color:#B4441F">見つからなかった欄：${r.miss.join("・")}（コピーして貼ってください）</span>` : ""}` : `<span style="color:#B4441F">作成の画面が見つかりません。「メールを作成」か「返信」を開いてから押してください</span>`; }
      });
    });
  }
  chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch[KEY]) render(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", render); else render();
})();
