// NeoSTAGE（取引申請 neo-crm.net）の自動入力（2026-11-16 田中さん「企業検索・事業所新規・部署新規の項目を自動で埋めたい」）
//   画面の右下に「kinbot から入れる」を出す。会社を SF から選ぶと、kinbot が SF・gBizINFO から値を作り、ここで欄に入れる。
//   欄は「見出しの文字」で探す（NeoSTAGE の中の名前が分からなくても、画面の見出しが同じなら入る）。
//   「申請」「一時保存」は押さない。入れた欄は緑の枠、入れられなかった必須は下に出すので、目で確かめてから自分で押す。
(() => {
  if (window.__kbNeo) return; window.__kbNeo = true;
  const ver = (() => { try { return chrome.runtime.getManifest().version; } catch { return ""; } })();
  const api = (path, method = "GET", body) => new Promise((resolve) => {
    try { chrome.runtime.sendMessage({ type: "kb-neo", path, method, body }, (r) => { const le = chrome.runtime.lastError; resolve(r || { ok: false, error: le ? "拡張機能とつながりません。このページを読み込み直してください" : "返事がありません" }); }); }
    catch { resolve({ ok: false, error: "拡張機能が新しくなりました。このページを読み込み直してください" }); }
  });
  const clean = (t) => String(t || "").replace(/必須/g, "").replace(/[\s:：]/g, "").normalize("NFKC");
  // どの画面か（企業検索・事業所新規・部署新規）
  const pageKind = () => {
    const p = location.pathname;
    if (/corp_search/.test(p)) return "corp_search";
    if (/apply_new/.test(p)) return "apply_new";
    if (/apply_edit/.test(p) && /unit_new/.test(location.search)) return "unit_new";
    if (/apply_edit/.test(p)) return "apply_edit";
    return p.replace(/^\//, "") || "top";
  };
  // 欄の見出し：同じ行（tr）の前のセルの文字。表でなければ、前にある label の文字
  function labelOf(el) {
    const tr = el.closest("tr");
    if (tr) { const cells = [...tr.children]; const i = cells.findIndex((c) => c.contains(el)); for (let k = i - 1; k >= 0; k--) { const t = clean(cells[k].innerText); if (t) return t; } }
    let p = el.previousElementSibling; while (p) { if (/^(LABEL|SPAN|DT|TH|B)$/.test(p.tagName)) { const t = clean(p.innerText); if (t) return t; } p = p.previousElementSibling; }
    const lb = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (lb) return clean(lb.innerText);
    // Bootstrap の並べ方（<label class="control-label">社名</label><div class="col-sm-5"><input></div>）。
    //   企業検索の画面はこの形で、見出しが input の親の前にあるため、0項目になっていた（2026-11-20）
    let q = el.parentElement && el.parentElement.previousElementSibling;
    while (q) { if (q.tagName === "LABEL" || /control-label/.test(q.className || "")) { const t = clean(q.innerText); if (t) return t; } if (q.querySelector && q.querySelector("input,select,textarea")) break; q = q.previousElementSibling; }
    return "";
  }
  // 「取引先担当者1」などの小見出し。同じ見出し（氏名・メール）が3回出てくるので、どの担当者の欄かを分けるため
  function ctxMap() {
    const heads = [...document.querySelectorAll("th,td,div,span,b,p,h3,h4")].filter((e) => !e.children.length && /^取引先担当者\s*[1-3１-３]$/.test(String(e.textContent || "").trim()));
    const sec = [...document.querySelectorAll("th,td,div,h2,h3,h4,.panel-heading,.card-header")].filter((e) => /^(事業所情報|部署情報|事業部別取引部署情報|請求書送付先|自社情報|管理本部記入欄)$/.test(String(e.textContent || "").trim()));
    return (el) => {
      let who = "", part = "";
      for (const h of heads) if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) who = String(h.textContent).trim().normalize("NFKC").replace(/\s/g, ""); else break;
      for (const h of sec) if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) part = String(h.textContent).trim(); else break;
      // 担当者の欄は、担当者の小見出しのあと、次の「支払締日」などが来るまで
      return { who, part };
    };
  }
  const fieldsAll = () => [...document.querySelectorAll("input,select,textarea")].filter((el) => !/^(hidden|submit|button|file|image|reset)$/.test(el.type || "") && el.offsetParent !== null);
  // 値を入れる（React などでも拾われるよう、ふつうの入れ方＋input/change を出す）
  function put(el, v) {
    if (v == null || v === "") return false;
    if (el.disabled || el.readOnly) return false;
    if (el.tagName === "SELECT") {
      const want = String(v).normalize("NFKC").trim();
      const opts = [...el.options];
      const o = opts.find((x) => x.text.normalize("NFKC").trim() === want) || opts.find((x) => x.value === want) || opts.find((x) => want && x.text.normalize("NFKC").includes(want));
      if (!o) return false;
      el.value = o.value;
    } else if (el.type === "checkbox" || el.type === "radio") { return false; }
    else {
      const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, String(v));
    }
    el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
    el.style.outline = "2px solid #5DCAA5"; el.style.outlineOffset = "1px"; el.dataset.kbNeo = "1";
    return true;
  }
  // 見出し → 入れる値。見出しは画面の文字（「必須」と空白を取ったもの）
  function plan(d, kind) {
    const c = d.corp || {}, o = d.office || {}, dp = d.dept || {}, ps = d.people || [];
    if (kind === "corp_search") return { "社名": c.name || c.full, "法人番号": c.number };
    const m = {
      "法人格位置": c.pos, "法人格": c.type, "社名": c.name, "社名カナ": c.kana, "事業所名なし(または本社)": "本社",
      "郵便番号": o.postal, "都道府県": o.pref, "住所(市区町村以下)": o.addr, "電話番号": o.tel, "FAX番号": o.fax, "代表者名": o.rep, "URL": o.url,
      "設立年": o.foundedY, "設立月": o.foundedM, "資本金": o.capital, "従業員数": o.employees,
      "部署名": dp.name, "電話番号1": dp.tel, "FAX番号1": dp.fax,
    };
    ps.forEach((p, i) => { const w = `取引先担当者${i + 1}`; Object.assign(m, { [`${w}|氏名`]: p.name, [`${w}|氏名カナ`]: p.kana, [`${w}|部署詳細`]: p.dept, [`${w}|役職`]: p.title, [`${w}|メールアドレス`]: p.email }); });
    return m;
  }
  function fill(d) {
    const kind = pageKind(); const want = plan(d, kind); const ctx = ctxMap(); const done = new Set(); const miss = [];
    for (const el of fieldsAll()) {
      const lab = labelOf(el); if (!lab) continue; const { who } = ctx(el);
      const key = who && Object.prototype.hasOwnProperty.call(want, `${who}|${lab}`) ? `${who}|${lab}` : lab;
      if (!Object.prototype.hasOwnProperty.call(want, key) || done.has(key)) continue;
      if (who && !key.includes("|") && /^(氏名|氏名カナ|部署詳細|役職|メールアドレス)$/.test(lab)) continue;   // 担当者の欄に会社の値を入れない
      if (put(el, want[key])) done.add(key);
    }
    // 必須なのに空の欄（人が入れるもの）を数える
    document.querySelectorAll("tr").forEach((tr) => { if (!/必須/.test(tr.innerText || "")) return; const el = tr.querySelector("input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea"); if (!el || el.disabled || el.offsetParent === null) return; if (!String(el.value || "").trim()) { const l = labelOf(el); if (l) miss.push(l); } });
    return { done: [...done].map((k) => k.replace("|", " ")), miss: [...new Set(miss)] };
  }
  // 画面の項目の形を kinbot に送る（値は送らない）。入れ方が合っていないときに直すため。版ごと・画面ごとに1回
  async function sendSchema(filled) {
    const kind = pageKind(); const key = `kbNeoSchema:${kind}:${ver}`;
    try { if (!filled && sessionStorage.getItem(key)) return; sessionStorage.setItem(key, "1"); } catch {}
    const ctx = ctxMap();
    const fields = fieldsAll().map((el) => ({ label: labelOf(el), ctx: ctx(el).who, tag: el.tagName.toLowerCase(), type: el.type || "", name: el.name || "", id: el.id || "", dis: !!el.disabled,
      opts: el.tagName === "SELECT" ? [...el.options].map((o) => o.text.trim()).slice(0, 60) : [] }));
    await api("schema", "POST", { page: kind, ver, fields, filled });
  }

  // ===== 画面の右下のカード =====
  const G = "#0d5b47", G2 = "#1d9e75";
  const box = document.createElement("div");
  box.id = "kbNeoBox";
  box.style.cssText = `position:fixed;right:16px;bottom:16px;z-index:2147483000;font-family:system-ui,-apple-system,'Hiragino Sans','Meiryo',sans-serif;font-size:13px;color:#173a30;`;
  const ico = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="7" width="16" height="12" rx="4"/><path d="M12 7V4"/><circle cx="12" cy="3" r="1"/><circle cx="9" cy="13" r="1.2" fill="currentColor"/><circle cx="15" cy="13" r="1.2" fill="currentColor"/></svg>`;
  box.innerHTML = `
    <button type="button" id="kbNeoOpen" style="display:flex;align-items:center;gap:6px;border:0;border-radius:999px;padding:9px 14px;background:${G};color:#fff;font-weight:800;cursor:pointer;box-shadow:0 4px 14px rgba(13,91,71,.3)">${ico}kinbot から入れる</button>
    <div id="kbNeoPanel" hidden style="width:340px;background:#fff;border:1px solid #d6e5de;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.18);padding:12px 12px 10px">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;color:${G};font-weight:800">${ico}<span>kinbot から入れる</span><button type="button" id="kbNeoX" style="margin-left:auto;border:0;background:transparent;font-size:16px;color:#7d8f87;cursor:pointer" aria-label="閉じる">×</button></div>
      <div style="display:flex;gap:6px"><input id="kbNeoQ" placeholder="会社名で SF から探す" style="flex:1;border:1px solid #cfe0d8;border-radius:10px;padding:7px 10px;font-size:13px;outline:none"><button type="button" id="kbNeoGo" style="border:0;border-radius:10px;background:${G2};color:#fff;font-weight:700;padding:0 12px;cursor:pointer">探す</button></div>
      <div id="kbNeoList" style="max-height:220px;overflow:auto;margin-top:8px"></div>
      <div id="kbNeoMsg" style="margin-top:8px;font-size:12px;line-height:1.55;color:#4F6158"></div>
      <div style="margin-top:6px;font-size:11px;color:#8FA39A">入れた欄は緑の枠になります。「申請」は内容を確かめてから自分で押してください。</div>
    </div>`;
  const mount = () => { if (!document.body || document.getElementById("kbNeoBox")) return; document.body.appendChild(box); wire(); wantStart(); };
  const $ = (id) => box.querySelector("#" + id);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function wire() {
    const open = () => { $("kbNeoPanel").hidden = false; $("kbNeoOpen").hidden = true;
      // 部署新規などは、上に会社名（【社名】〇〇（コード））が出ているので、それで探しておく
      if (!$("kbNeoQ").value) { const m = String(document.body.innerText || "").match(/【社名】\s*([^\s（(【]{2,60})/); if (m) { $("kbNeoQ").value = m[1]; find(); } }
      $("kbNeoQ").focus(); sendSchema(null); };
    $("kbNeoOpen").onclick = open;
    $("kbNeoX").onclick = () => { $("kbNeoPanel").hidden = true; $("kbNeoOpen").hidden = false; };
    $("kbNeoGo").onclick = () => find();
    $("kbNeoQ").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); find(); } });
  }
  async function find(opt = {}) {
    const q = $("kbNeoQ").value.trim(); if (q.length < 2) { $("kbNeoMsg").textContent = "会社名を2文字以上入れてください"; return; }
    $("kbNeoMsg").textContent = "SF を探しています…"; $("kbNeoList").innerHTML = "";
    const r = await api(`find?q=${encodeURIComponent(q)}`);
    if (!r.ok) { $("kbNeoMsg").textContent = r.error || "探せませんでした"; return; }
    const items = r.items || [];
    $("kbNeoMsg").textContent = items.length ? "入れる会社を選んでください" : "SF に見つかりませんでした。名前を短くして探してください";
    $("kbNeoList").innerHTML = items.map((a) => `<button type="button" data-id="${esc(a.id)}" style="display:block;width:100%;text-align:left;border:1px solid #e1ebe6;background:#fff;border-radius:10px;padding:7px 9px;margin-bottom:5px;cursor:pointer">
      <b style="font-size:13px">${esc(a.name)}</b>${a.type ? ` <span style="font-size:10.5px;color:#0F6E56;background:#e1f5ee;border-radius:99px;padding:1px 6px">${esc(a.type)}</span>` : ""}<br><span style="font-size:11px;color:#7d8f87">${esc([a.tel, a.addr].filter(Boolean).join("・") || "電話・住所なし")}</span></button>`).join("");
    $("kbNeoList").querySelectorAll("[data-id]").forEach((b) => b.onclick = () => pick(b.dataset.id));
    // 企業カードから社名で来て、SF に1社だけ見つかったら、そのまま入れる
    if (opt.auto && items.length === 1) pick(items[0].id);
  }
  // ===== kinbot・kinXs の企業カードから来たとき（https://neo-crm.net/corp_search#kbsf=<SFの取引先ID> または #kbq=<社名>）（2026-11-20 田中さん）=====
  //   どの会社かをこのタブに覚えておき、企業検索ではすぐ入れて検索する。事業所新規・部署新規へ進んだら、パネルに「〇〇の値を入れる」を出す（押したら入れる）。
  //   覚えるのはこのタブだけ（sessionStorage）・2時間まで。申請・一時保存はこれまでどおり押さない
  const WKEY = "kbNeoWant";
  const want = (() => {
    try {
      const h = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
      const id = String(h.get("kbsf") || ""), q = String(h.get("kbq") || "").slice(0, 80);
      if (/^001[A-Za-z0-9]{12,15}$/.test(id) || q) {
        const w = { id: /^001/.test(id) ? id : "", q, name: String(h.get("kbname") || q || "").slice(0, 80), at: Date.now() };
        sessionStorage.setItem(WKEY, JSON.stringify(w));
        history.replaceState(null, "", location.pathname + location.search);   // 印は消しておく（NeoSTAGE の画面の動きにさわらないように）
        return { ...w, fresh: true };
      }
      const w = JSON.parse(sessionStorage.getItem(WKEY) || "null");
      return w && Date.now() - (w.at || 0) < 2 * 3600000 ? w : null;
    } catch { return null; }
  })();
  function wantStart() {
    if (!want) return;
    $("kbNeoPanel").hidden = false; $("kbNeoOpen").hidden = true;
    const kind = pageKind();
    if (want.id && (kind === "corp_search" && want.fresh)) { pick(want.id); return; }
    if (want.id) {
      $("kbNeoList").innerHTML = `<button type="button" data-want style="display:block;width:100%;text-align:left;border:1.5px solid #5DCAA5;background:#e1f5ee;border-radius:10px;padding:8px 10px;cursor:pointer;color:${G};font-weight:800">${esc(want.name || "kinbot で選んだ会社")} の値を入れる</button>`;
      $("kbNeoList").querySelector("[data-want]").onclick = () => pick(want.id);
      $("kbNeoMsg").textContent = "kinbot・kinXs で選んだ会社です。押すと、この画面の欄に入れます";
      return;
    }
    $("kbNeoQ").value = want.q; find({ auto: kind === "corp_search" && want.fresh });
  }
  async function pick(id) {
    try { const w = JSON.parse(sessionStorage.getItem(WKEY) || "null"); if (w && !w.id) { w.id = id; sessionStorage.setItem(WKEY, JSON.stringify(w)); } } catch {}
    $("kbNeoMsg").textContent = "SF と gBizINFO から値を作っています…";
    const r = await api(`prefill?id=${encodeURIComponent(id)}`);
    if (!r.ok) { $("kbNeoMsg").textContent = r.error || "値を作れませんでした"; return; }
    const d = r.data; const res = fill(d); const kind = pageKind();
    $("kbNeoList").innerHTML = "";
    $("kbNeoMsg").innerHTML = `<b style="color:${G}">${esc(d.account.name)}</b> の値を <b>${res.done.length}項目</b> 入れました。`
      + (res.miss.length ? `<br><span style="color:#B4441F">まだ空の必須：${esc(res.miss.slice(0, 12).join("・"))}</span>` : "")
      + ((d.notes || []).length ? `<br><span style="color:#8A4B00">${esc(d.notes.join(" ／ "))}</span>` : "")
      + (d.office && d.office.industry && kind === "apply_new" ? `<br>業種のめやす（SF）：${esc(d.office.industry)}` : "");
    sendSchema({ done: res.done, miss: res.miss });
    // 企業検索は、入れたらそのまま検索する（検索は読むだけで何も変わらないため）
    if (kind === "corp_search" && res.done.length) { const b = [...document.querySelectorAll("button,input[type=submit],a")].find((x) => /^\s*検索\s*$/.test(x.innerText || x.value || "")); if (b) setTimeout(() => b.click(), 300); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
