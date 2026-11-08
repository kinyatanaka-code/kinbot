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
    const fields = [["company", "クライアント企業名（事業所名）", p.company || ""], ["url", "企業URL（HP）", url || "https://example.com/"], ["person", "先方担当者名", p.person || ""], ["phone", "先方の電話番号", p.phone || ""], ["email", "先方のメールアドレス", p.email || ""], ["job", "募集職種", ""], ["place", "募集勤務地", pref], ["to", "共有先となる営業担当の指定有無", "指定なし"], ["date", "商談予定日時", ""], ["price", "希望採用/稼働単価", ""]];
    bg.innerHTML = `<div class="kbcs" role="dialog" aria-modal="true"><div class="kbcs-h"><b>🤝 案件共有</b><small>社内の案件共有_申請フォームに入れる内容です。確かめて「フォームを開く」</small><button type="button" class="kbcs-btn" data-x style="margin-left:auto">閉じる</button></div>
      <div class="kbcs-b">${fields.map(([k, l, v]) => `<label class="kbcs-f"><span>${esc(l)}</span><div><input data-k="${k}" value="${esc(v)}"><button type="button" class="kbcs-btn" data-cp="${k}">コピー</button></div></label>`).join("")}
        <div class="kbcs-g"><span>想定分野（複数可）</span><div>${FIELDS.map((v) => `<label class="kbcs-opt"><input type="checkbox" name="field" value="${esc(v)}">${esc(v)}</label>`).join("")}</div></div>
        <div class="kbcs-g"><span>共有元企業の属性</span><div>${radio("attr", ATTR, p.attr || "新規")}</div></div>
        <div class="kbcs-g"><span>事務局対応</span><div>${radio("desk", DESK, DESK[2])}</div></div>
        <div class="kbcs-g"><span>希望採用/稼働時期</span><div>${radio("when", WHEN, "不明")}</div></div>
        <div class="kbcs-g"><span>希望採用/稼働人数</span><div>${radio("how", HOW, "不明")}</div></div></div>
      <div class="kbcs-foot"><span class="n">${Object.keys(cfg.entries || {}).length ? "「フォームを開く」で、上の内容が入った状態で開きます。フォームで確かめて送信してください。" : "各欄の「コピー」でフォームに貼ってください。"}</span><button type="button" class="kbcs-btn pri" data-open>フォームを開く ↗</button></div></div>`;
    document.body.appendChild(bg);
    const close = () => bg.remove();
    bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
    bg.querySelector("[data-x]").addEventListener("click", close);
    document.addEventListener("keydown", function k(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", k); } });
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
