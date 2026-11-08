// 案件共有（社内の案件共有_申請フォーム）の下書きの窓：kinbot のホーム・商談履歴から使う（2026-11-08 田中さん）
//   window.kbCaseShare({ company, url, person, phone, email, address }) で開く。kincall の記録の窓の「🤝 案件共有」と同じ中身
(function () {
  const FIELDS = ["新卒採用(媒体)", "新卒採用(紹介)", "中途採用(媒体)", "二次店希望(PS)", "中途採用(紹介)/未経験OK", "中途採用(紹介)/未経験OK （Bee）", "中途採用(紹介)/経験必須", "アルバイト採用", "派遣利用（オフィスワーク）", "派遣利用（介護）", "派遣利用（その他）", "業務委託", "ツール制作（Web、パンフレット、スライド、動画など）", "どこでもオープンカンパニー", "Bスポンサーズ（高卒採用）"];
  const ATTR = ["ユーザー", "今期ユーザー", "新規"];
  const DESK = ["事務局対応不要（自身で共有先へ連携済み）", "事務局対応必要（共有先と事前に接続希望）", "事務局対応必要（事務局側で担当者調整次第、先方へ直接連絡でOK）"];
  const WHEN = ["すぐに", "1ヶ月以内", "3ヶ月以内", "半年以内", "常時", "27卒", "28卒", "不明"];
  const HOW = ["1名", "2-5名", "6-10名", "11名以上", "不明"];
  const PREFS = "北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県".split(" ");
  const FORM = "https://docs.google.com/forms/d/e/1FAIpQLScangZkXBazmLi1Amc7RM-xPtsyhKLdhn3rWO8P225_9QeLYw/viewform";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function css() {
    if (document.getElementById("kbcsCss")) return;
    const st = document.createElement("style"); st.id = "kbcsCss";
    st.textContent = `.kbcs-bg{position:fixed;inset:0;background:rgba(10,30,22,.45);z-index:9500;display:flex;align-items:flex-start;justify-content:center;padding:40px 14px;overflow:auto;font-family:inherit}
.kbcs{background:#fff;color:#14231D;border-radius:18px;width:min(760px,100%);box-shadow:0 24px 60px -20px rgba(0,0,0,.5);display:flex;flex-direction:column}
.kbcs-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:14px 18px;border-bottom:1px solid #E1E9E5}.kbcs-h b{font-size:16px}.kbcs-h small{color:#6A7A72;font-size:12px}
.kbcs-b{padding:12px 18px;display:flex;flex-direction:column;gap:10px;max-height:70vh;overflow:auto}
.kbcs-f,.kbcs-g{display:grid;grid-template-columns:200px 1fr;gap:10px;align-items:center;font-size:13px}.kbcs-f>div{display:flex;gap:6px}.kbcs-f input{flex:1;border:1px solid #D6E2DB;border-radius:9px;padding:7px 9px;font:inherit}
.kbcs-g{align-items:start}.kbcs-g>div{display:flex;flex-wrap:wrap;gap:6px}
.kbcs-opt{display:inline-flex;align-items:center;gap:5px;border:1px solid #DCE6E1;border-radius:99px;padding:3px 10px;font-size:12px;cursor:pointer}.kbcs-opt:has(input:checked){background:#E1F5EE;border-color:#1D9E75;color:#0A5440;font-weight:700}
.kbcs-btn{border:1px solid #CFE3D9;background:#fff;border-radius:10px;padding:6px 12px;font:inherit;font-size:12.5px;font-weight:700;color:#0E6B4E;cursor:pointer;white-space:nowrap}.kbcs-btn.pri{background:#0F6E62;color:#fff;border-color:transparent}
.kbcs-src{align-self:center;font-size:10.5px;font-weight:700;color:#0E6B4E;background:#E1F5EE;border-radius:6px;padding:1px 6px;white-space:nowrap}
.kbcs-src.guess{background:#FFF4D6;color:#8A5A00}
.kbcs-link{border:0;background:none;color:#0E6B4E;font:inherit;font-size:12px;font-weight:700;text-decoration:underline;cursor:pointer;padding:0}
.kbcs-setup{display:flex;flex-direction:column;gap:6px;border:1px dashed #9CCBB5;border-radius:12px;padding:10px 12px;background:#F4FBF8;font-size:12.5px}.kbcs-setup small{color:#6A7A72}.kbcs-setup textarea{border:1px solid #D6E2DB;border-radius:9px;padding:7px;font:12px monospace}.kbcs-setup div{display:flex;gap:8px;align-items:center}.kbcs-setup .st{color:#0E6B4E;font-weight:700}
.kbcs-ppl{position:absolute;left:0;right:70px;top:100%;margin-top:4px;background:#fff;border:1px solid #CFE3D9;border-radius:12px;box-shadow:0 14px 30px -16px rgba(0,0,0,.45);z-index:5;max-height:260px;overflow:auto;padding:4px}
.kbcs-ppl .it{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;width:100%;text-align:left;border:0;background:none;padding:7px 9px;border-radius:9px;font:inherit;font-size:12.5px;cursor:pointer}.kbcs-ppl .it:hover{background:#E1F5EE}.kbcs-ppl .it span{color:#4A6158}.kbcs-ppl .it small{font-size:10.5px;color:#0E6B4E;background:#E1F5EE;border-radius:5px;padding:0 6px}.kbcs-ppl .mute{color:#8FA39A;cursor:default;display:block}.kbcs-ppl .none{display:block;color:#6A7A72;border-top:1px dashed #DCE6E1;border-radius:0}
.kbcs-foot{display:flex;align-items:center;gap:10px;padding:12px 18px;border-top:1px solid #E1E9E5}.kbcs-foot .n{flex:1;font-size:12px;color:#6A7A72}
@media (max-width:640px){.kbcs-f,.kbcs-g{grid-template-columns:1fr}}`;
    document.head.appendChild(st);
  }
  window.kbCaseShare = async function (p = {}) {
    css();
    const addr = String(p.address || "");
    const pref = PREFS.find((x) => addr.includes(x)) || "";
    let url = String(p.url || ""); if (url && !/^https?:\/\//.test(url)) url = "https://" + url;
    let cfg = { formUrl: "", entries: {} }; try { cfg = await (await fetch("/api/case-share/config")).json(); } catch {}
    document.querySelectorAll(".kbcs-bg").forEach((n) => n.remove());
    const bg = document.createElement("div"); bg.className = "kbcs-bg";
    const radio = (name, list, val) => list.map((v) => `<label class="kbcs-opt"><input type="radio" name="${name}" value="${esc(v)}" ${v === val ? "checked" : ""}>${esc(v)}</label>`).join("");
    const fields = [["company", "クライアント企業名（事業所名）", p.company || ""], ["url", "企業URL（HP）", url || "https://example.com/"], ["person", "先方担当者名", p.person || ""], ["phone", "先方の電話番号", p.phone || ""], ["email", "先方のメールアドレス", p.email || ""], ["job", "募集職種", p.job || "詳細不明"], ["place", "募集勤務地", pref], ["to", "共有先となる営業担当の指定有無", "指定なし"], ["date", "商談予定日時", ""], ["price", "希望採用/稼働単価", ""]];
    // 商談予定日時：カレンダーで選ぶ。最初は、その商談の日時（2026-11-08 田中さん）
    const dt0 = p.date ? new Date(p.date) : null; const ok0 = dt0 && !isNaN(dt0);
    const pad = (n) => String(n).padStart(2, "0");
    const dDay = ok0 ? `${dt0.getFullYear()}-${pad(dt0.getMonth() + 1)}-${pad(dt0.getDate())}` : "";
    const dTime = ok0 && !/^\d{4}-\d{2}-\d{2}$/.test(String(p.date)) ? `${pad(dt0.getHours())}:${pad(dt0.getMinutes())}` : "";
    bg.innerHTML = `<div class="kbcs" role="dialog" aria-modal="true"><div class="kbcs-h"><b>🤝 案件共有</b><small>社内の案件共有_申請フォームに入れる内容です。確かめて「フォームを開く」</small><button type="button" class="kbcs-btn" data-x style="margin-left:auto">閉じる</button></div>
      <div class="kbcs-b">${fields.map(([k, l, v]) => k === "date"
          ? `<label class="kbcs-f"><span>${esc(l)}</span><div><input type="date" data-dd value="${esc(dDay)}"><input type="time" data-dt value="${esc(dTime)}" style="max-width:120px"><input type="hidden" data-k="date"><button type="button" class="kbcs-btn" data-cp="date">コピー</button></div></label>`
          : `<label class="kbcs-f"><span>${esc(l)}</span><div><input data-k="${k}" value="${esc(v)}"><button type="button" class="kbcs-btn" data-cp="${k}">コピー</button></div></label>`).join("")}
        <div class="kbcs-g"><span>想定分野（複数可）</span><div>${FIELDS.map((v) => `<label class="kbcs-opt"><input type="checkbox" name="field" value="${esc(v)}">${esc(v)}</label>`).join("")}</div></div>
        <div class="kbcs-g"><span>共有元企業の属性</span><div>${radio("attr", ATTR, p.attr || "新規")}</div></div>
        <div class="kbcs-g"><span>事務局対応</span><div>${radio("desk", DESK, DESK[2])}</div></div>
        <div class="kbcs-g"><span>希望採用/稼働時期</span><div>${radio("when", WHEN, "不明")}</div></div>
        <div class="kbcs-g"><span>希望採用/稼働人数</span><div>${radio("how", HOW, "不明")}</div></div></div>
      <div class="kbcs-foot"><span class="n">${Object.keys(cfg.entries || {}).length >= 10 ? "「この内容で送信」で、フォームに回答します（あなたのGoogleのログインで送り、「メール」の欄もチェックした状態で送ります）。「フォームで確かめる」から送るときは、フォームの「メール」の欄だけ自分でチェックしてください。" : "各欄の「コピー」でフォームに貼ってください。"}${Object.keys(cfg.entries || {}).length < 10 && cfg.canSet ? ` <button type="button" class="kbcs-link" data-setup>最初の設定：ここから送信できるようにする</button>` : ""}</span>
        <button type="button" class="kbcs-btn" data-open>${Object.keys(cfg.entries || {}).length >= 10 ? "フォームで確かめる ↗" : "フォームを開く ↗"}</button>
        ${Object.keys(cfg.entries || {}).length >= 10 ? `<button type="button" class="kbcs-btn pri" data-send>この内容で送信</button>` : ""}</div></div>`;
    document.body.appendChild(bg);
    const close = () => bg.remove();
    bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
    bg.querySelector("[data-x]").addEventListener("click", close);
    document.addEventListener("keydown", function k(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", k); } });
    // 日付と時刻から、フォームに入れる文字（2026/11/10 14:00）を作って、隠れた欄に入れておく
    const syncDate = () => { const d = (bg.querySelector("[data-dd]") || {}).value || "", t = (bg.querySelector("[data-dt]") || {}).value || ""; const h = bg.querySelector('[data-k="date"]'); if (h) h.value = d ? `${d.replace(/-/g, "/")}${t ? ` ${t}` : ""}` : ""; };
    bg.querySelectorAll("[data-dd],[data-dt]").forEach((x) => x.addEventListener("input", syncDate)); syncDate();
    const val = (k) => (bg.querySelector(`[data-k="${k}"]`) || {}).value || "";
    // アポ一覧・kincall・Salesforce から、空いている欄を自動で埋める（どこから入れたかを小さく出す）
    (async () => {
      const foot = bg.querySelector(".kbcs-foot .n"); const old = foot ? foot.textContent : "";
      if (foot) foot.textContent = "アポ一覧・kincall・Salesforce から探しています…";
      try {
        const q = new URLSearchParams({ company: val("company") || p.company || "", email: val("email") || p.email || "", person: val("person") || p.person || "" });
        const d = await (await fetch(`/api/case-share/prefill?${q}`)).json();
        let n = 0;
        for (const k of ["url", "person", "phone", "email"]) {
          const inp = bg.querySelector(`[data-k="${k}"]`); if (!inp || !d[k]) continue;
          if (inp.value && !(k === "url" && inp.value === "https://example.com/")) continue;
          inp.value = d[k]; n++;
          const tag = document.createElement("small"); tag.className = "kbcs-src"; tag.textContent = (d.src && d.src[k]) || ""; inp.parentElement.appendChild(tag);
        }
        // 募集職種：議事録から取れたら、「詳細不明」のままのときだけ入れる
        { const jb = bg.querySelector('[data-k="job"]'); if (jb && d.job && (!jb.value || jb.value === "詳細不明")) { jb.value = d.job; n++; const tag = document.createElement("small"); tag.className = "kbcs-src"; tag.textContent = (d.src && d.src.job) || "議事録"; jb.parentElement.appendChild(tag); } }
        // 先方担当者名に（ふりがな）を付ける。予測した読みなら札で知らせる
        const pin = bg.querySelector('[data-k="person"]');
        if (pin && pin.value && d.personKana && !/[（(][\u30A0-\u30FF\u3040-\u309F\s　]+[）)]/.test(pin.value)) {
          pin.value = `${pin.value.replace(/様$/, "").trim()}（${d.personKana}）`; n++;
          if (d.personKanaGuessed) { const tag = document.createElement("small"); tag.className = "kbcs-src guess"; tag.textContent = "読みは予測"; pin.parentElement.appendChild(tag); }
        }
        const place = bg.querySelector('[data-k="place"]');
        if (place && !place.value && d.address) { const pf = PREFS.find((x) => d.address.includes(x)); if (pf) { place.value = pf; n++; const tag = document.createElement("small"); tag.className = "kbcs-src"; tag.textContent = (d.src && d.src.address) || ""; place.parentElement.appendChild(tag); } }
        if (foot) foot.textContent = n ? `${n}つの欄を自動で埋めました（右の小さな札が出どころ）。確かめてから使ってください。` : old;
      } catch { if (foot) foot.textContent = old; }
    })();
    bg.querySelectorAll("[data-cp]").forEach((b) => b.addEventListener("click", async () => { const v = val(b.dataset.cp); try { await navigator.clipboard.writeText(v); } catch { const t = document.createElement("textarea"); t.value = v; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); } b.textContent = "✓"; setTimeout(() => (b.textContent = "コピー"), 1200); }));
    // 共有先の営業担当：名前を入れると、kinbot・SF・自分のGmail から探して、選ぶとメールアドレスが入る（2026-11-08）
    { const to = bg.querySelector('[data-k="to"]'); const wrap = to.parentElement; wrap.style.position = "relative";
      const list = document.createElement("div"); list.className = "kbcs-ppl"; list.hidden = true; wrap.appendChild(list);
      to.placeholder = "名前で探す（例：田中）／指定なし"; let tm = 0, seq = 0;
      to.addEventListener("focus", () => { if (to.value === "指定なし") to.select(); });
      to.addEventListener("input", () => {
        clearTimeout(tm); const q = to.value.trim();
        if (q.length < 2 || q.includes("@") || q === "指定なし") { list.hidden = true; return; }
        tm = setTimeout(async () => {
          const my = ++seq; list.hidden = false; list.innerHTML = `<div class="it mute">「${esc(q)}」を探しています…</div>`;
          try { const d = await (await fetch(`/api/case-share/people?q=${encodeURIComponent(q)}`)).json(); if (my !== seq) return;
            const items = d.items || [];
            const hint = d.dirNote === "needScope" ? `<div class="it mute">Googleのアドレス帳からも探すには、<a href="/auth/google" target="_blank" rel="noopener">Googleの連携をし直す</a>（1回だけ）</div>`
              : d.dirNote === "disabled" ? `<div class="it mute">Googleのアドレス帳がまだ使えません（Google Cloud で People API を有効にする必要があります。田中さんに連絡してください）</div>` : "";
            list.innerHTML = hint + (items.map((p2) => `<button type="button" class="it" data-em="${esc(p2.email)}"><b>${esc(p2.name || p2.email)}</b><span>${esc(p2.email)}</span><small>${esc(p2.src)}</small></button>`).join("") || `<div class="it mute">見つかりませんでした（メールアドレスを直接入れてもOK）</div>`) + `<button type="button" class="it none" data-em="指定なし">指定なし</button>`;
            list.querySelectorAll("[data-em]").forEach((b) => b.addEventListener("mousedown", (ev) => { ev.preventDefault(); to.value = b.dataset.em; list.hidden = true; }));
          } catch { list.hidden = true; }
        }, 300);
      });
      to.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 150)); }
    // この窓から、そのままフォームに回答する（検収書と同じく、ブラウザからその人のGoogleのログインで送る）（2026-11-08）
    const sendBtn = bg.querySelector("[data-send]");
    if (sendBtn) sendBtn.addEventListener("click", () => {
      const en = cfg.entries || {}; const base = cfg.formUrl || FORM;
      const need = [["company", "クライアント企業名"], ["url", "企業URL"], ["person", "先方担当者名"], ["phone", "先方の電話番号"], ["email", "先方のメールアドレス"], ["job", "募集職種"], ["place", "募集勤務地"], ["to", "共有先となる営業担当の指定有無"]].filter(([k]) => !val(k).trim()).map(([, l]) => l);
      if (!bg.querySelector('input[name="field"]:checked')) need.push("想定分野");
      if (need.length) { alert(`必須の欄が空です：${need.join("・")}\n入れてから送信してください（「フォームで確かめる」から入れることもできます）`); return; }
      if (!confirm(`「${val("company")}」の案件共有を、フォームに送信します。よろしいですか？`)) return;
      const f = document.createElement("form"); f.method = "POST"; f.action = base.replace(/\/viewform.*$/, "/formResponse"); f.target = "_blank"; f.acceptCharset = "UTF-8"; f.style.display = "none";
      const add = (k, v) => { const i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = v; f.appendChild(i); };
      for (const k of ["company", "url", "person", "phone", "email", "job", "place", "to", "date", "price"]) if (en[k] && val(k)) add(en[k], val(k));
      if (en.field) bg.querySelectorAll('input[name="field"]:checked').forEach((c) => add(en.field, c.value));
      for (const k of ["attr", "desk", "when", "how"]) { const c = bg.querySelector(`input[name="${k}"]:checked`); if (en[k] && c) add(en[k], c.value); }
      // 「メール：返信に表示するメールアドレスとして ○○ を記録する」にチェックを入れた状態で送る（フォームのページでは emailReceipt=true の隠れた項目）（2026-11-08）
      add("emailReceipt", "true");
      if (cfg.me) add("emailAddress", cfg.me);
      add("fvv", "1"); add("pageHistory", "0");   // フォームが送るときに付ける決まりの項目
      document.body.appendChild(f); f.submit(); setTimeout(() => f.remove(), 1000);
      bg.querySelector(".kbcs-foot .n").textContent = "送りました。新しいタブに「回答を記録しました」が出ていれば完了です。";
      sendBtn.disabled = true; setTimeout(close, 3500);
    });
    // 最初の設定（管理者）：フォームのページのソースを貼ると、各欄の番号を覚える
    const setup = bg.querySelector("[data-setup]");
    if (setup) setup.addEventListener("click", () => {
      const box = document.createElement("div"); box.className = "kbcs-setup";
      box.innerHTML = `<b>フォームの番号を読み込む（最初の1回）</b><small>案件共有_申請フォームを開いたページで Ctrl+U（Macは Cmd+Option+U）→ 全部コピー → 下に貼る。または、ページを保存した .html を選ぶ。</small><textarea rows="5" placeholder="ここにページのソースを貼る"></textarea><div><input type="file" accept=".html,.htm,text/html"><button type="button" class="kbcs-btn pri" data-load>読み込む</button></div><span class="st"></span>`;
      bg.querySelector(".kbcs-b").prepend(box);
      box.querySelector("[data-load]").addEventListener("click", async () => {
        const st = box.querySelector(".st"); let html = box.querySelector("textarea").value; const fl = box.querySelector("input[type=file]").files[0]; if (fl) html = await fl.text();
        if (!html.trim()) { st.textContent = "ソースを貼るか、ファイルを選んでください"; return; }
        try { const r = await fetch("/api/case-share/source", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ html }) }); const d = await r.json(); if (!r.ok) throw new Error(d.error || "読めませんでした"); st.textContent = `${d.count}個の欄を読み込みました。窓を開き直すと「この内容で送信」が使えます。`; }
        catch (e) { st.textContent = "失敗：" + e.message; }
      });
    });
    bg.querySelector("[data-open]").addEventListener("click", () => {
      const en = cfg.entries || {}; const base = cfg.formUrl || FORM;
      if (!Object.keys(en).length) { window.open(base, "_blank", "noopener"); return; }
      const q = new URLSearchParams(); q.set("usp", "pp_url");
      for (const k of ["company", "url", "person", "phone", "email", "job", "place", "to", "date", "price"]) if (en[k] && val(k)) q.append(en[k], val(k));
      if (en.field) bg.querySelectorAll('input[name="field"]:checked').forEach((c) => q.append(en.field, c.value));
      for (const k of ["attr", "desk", "when", "how"]) { const c = bg.querySelector(`input[name="${k}"]:checked`); if (en[k] && c) q.append(en[k], c.value); }
      window.open(`${base}?${q.toString()}`, "_blank", "noopener");
    });
  };
})();
