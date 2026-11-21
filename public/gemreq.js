// Gemini のリンク（/gem?t=依頼の本文）から開く画面（2026-11-18）。
//   会社の設定で Gemini はメールを送れなかったので、リンクにした。まず中身（いま → 変えたあと）を見せ、
//   本人が「更新する」を押したときだけ、その人の権限で Salesforce を更新する
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t === null || t === undefined ? "" : t).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  // 項目の名前を、人が読める言葉にする
  const LABEL = { StageName: "フェーズ", Loss_Reason__c: "失注理由（大項目）", Loss_Reason1__c: "失注理由（中項目）", Loss_Reason2__c: "失注理由（小項目）", order_reason_detail__c: "受失注理由詳細", CloseDate: "完了予定日", order_date__c: "受失注日", LostOpp_nextactiondate__c: "失注後次回アクション日" };
  const msg = (t, kind = "") => { const m = $("gqMsg"); m.textContent = t; m.className = `gq-msg ${kind}`; };
  const qp = new URLSearchParams(location.search);
  let text = qp.get("t") || "";
  // 英数字だけのリンク（id・s・r など）。日本語を入れると Gemini がリンクを途中で切るため（2026-11-18）
  let codes = {}; for (const k of ["id", "s", "r", "cd", "od", "nd"]) if (qp.get(k)) codes[k] = qp.get(k);
  $("gqText").value = text;
  if (!text && !Object.keys(codes).length) $("gqRaw").open = true;

  async function call(run) {
    const r = await fetch("/api/gemini-bridge/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, run, ...codes }) });
    if (r.status === 401) { location.href = `/login.html?next=${encodeURIComponent(encodeURIComponent(location.pathname + location.search))}`; return null; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `うまくいきませんでした（${r.status}）`);
    return j;
  }
  async function load() {
    msg(""); $("gqBody").textContent = "確かめています…";
    if (!text.trim() && !Object.keys(codes).length) { $("gqBody").innerHTML = `Gemini の答え（本文やリンク）をコピーしてから、下のボタンを押してください。答えを丸ごとコピーしても大丈夫です。<div class="gq-btns" style="margin-top:10px"><button class="gq-btn" id="gqPaste" type="button">コピーした本文を貼る</button></div>`;
      // クリップボードから読む（ブラウザが「許可しますか」と聞くことがある）
      $("gqPaste").addEventListener("click", () => fromClipboard(true));
      // 前に「許可」してあれば、押さなくても自動で読む（Gemini でコピー → この画面を開く、だけで済むように）
      try { const st = await navigator.permissions.query({ name: "clipboard-read" }); if (st.state === "granted") fromClipboard(false); } catch {}
      return; }
    let j; try { j = await call(false); } catch (e) { $("gqBody").textContent = ""; msg(e.message, "err"); $("gqRaw").open = true; return; }
    if (!j) return;
    if (j.items) return showItems(j.items);
    if (j.choose) {
      // 同じ会社に進行中の商談がいくつかあるとき：選んでもらう
      $("gqBody").innerHTML = `<p class="gq-sub">進行中の商談が${j.choose.length}件あります。更新するものを選んでください。</p><ul class="gq-choose">${j.choose.map((o) => `<li data-id="${esc(o.id)}"><b>${esc(o.account)}</b>　${esc(o.stage)}　${esc(o.owner)}<br>${esc(o.name)}</li>`).join("")}</ul>`;
      $("gqBody").querySelectorAll("li[data-id]").forEach((li) => li.addEventListener("click", () => {
        text = `商談ID：${li.dataset.id}\n` + text.split("\n").filter((l) => !/^\s*[・\-*]?\s*(会社|会社名|企業|企業名|取引先|取引先名)\s*[:：]/.test(l)).join("\n");
        $("gqText").value = text; codes = {}; load();
      }));
      return;
    }
    const p = j.preview;
    $("gqBody").innerHTML = `<div class="gq-opp"><b>${esc(p.account)}</b>（担当：${esc(p.owner)}）<br>${esc(p.name)}<br><span style="color:#8a9893;font-size:12px">${esc(p.id)}</span></div>
      <table class="gq-tbl"><thead><tr><th>項目</th><th>いま</th><th>変えたあと</th></tr></thead><tbody>${p.rows.map((r) => `<tr><td>${esc(LABEL[r.field] || r.field)}</td><td class="gq-before">${esc(r.before) || "（空）"}</td><td class="gq-after">${esc(r.after)}</td></tr>`).join("")}</tbody></table>
      <div class="gq-btns"><button class="gq-btn" id="gqRun" type="button">この内容で更新する</button></div>`;
    $("gqRun").addEventListener("click", async () => {
      $("gqRun").disabled = true; msg("更新しています…");
      try { const d = await call(true); if (d && d.done) { msg("更新しました。Salesforce に入っています。この画面は閉じて大丈夫です。", "ok"); $("gqRun").textContent = "更新しました"; } }
      catch (e) { msg(`更新できませんでした：${e.message}`, "err"); $("gqRun").disabled = false; }
    });
  }
  // JSON の依頼（いくつでも・SF のどの項目でも・kinXs も）：1件ずつカードで「いま → 変えたあと」を見せ、まとめて1回押す（2026-11-22）
  function showItems(items) {
    $("gqBody").innerHTML = items.map((it) => `<div class="gq-opp"><b>${esc(it.title)}</b>${it.target ? `<br>${esc(it.target)}` : ""}</div>
      <table class="gq-tbl"><thead><tr><th>項目</th><th>いま</th><th>変えたあと</th></tr></thead><tbody>${it.rows.map((r) => `<tr><td>${esc(r.label)}<br><span style="color:#8a9893;font-size:11px">${esc(r.field)}</span></td><td class="gq-before">${esc(r.before) || (it.tool === "sf_update" ? "（空）" : "—")}</td><td class="gq-after">${esc(r.after) || "（空にする）"}</td></tr>`).join("")}</tbody></table>`).join("")
      + `<div class="gq-btns"><button class="gq-btn" id="gqRun" type="button">${items.length > 1 ? `この${items.length}件をまとめて書きかえる` : "この内容で書きかえる"}</button></div>`;
    $("gqRun").addEventListener("click", async () => {
      $("gqRun").disabled = true; msg("書きかえています…");
      try {
        const d = await call(true);
        if (d && d.results) {
          const ng = d.results.filter((x) => !x.ok);
          msg(d.results.map((x) => `${x.ok ? "できました" : "できませんでした"}：${x.target || x.tool}${x.ok ? "" : `\n  ${x.text}`}`).join("\n"), ng.length ? "err" : "ok");
          $("gqRun").textContent = ng.length ? "一部できませんでした" : "書きかえました";
        }
      } catch (e) { msg(`書きかえられませんでした：${e.message}`, "err"); $("gqRun").disabled = false; }
    });
  }
  // Gemini の答えを丸ごとコピーして貼ってもよい。中にリンク（/gem?id=…）があればそれを使い、無ければ「会社：」などの行を読む
  //   （2026-11-18：Gemini はリンクを押すと Google 検索に飛ばすので、リンクは押さずにコピーして持ってくる形にした）
  function useText(t) {
    // JSON の依頼が入っていれば、それを優先する（リンクより中身が多いため）
    if (/"requests"|"tool"\s*:/.test(String(t || ""))) { codes = {}; text = t; $("gqText").value = t; return load(); }
    const m = String(t || "").match(/\/gem\?([^\s）)】」"'<>]+)/);
    if (m) {
      const p = new URLSearchParams(m[1]); const c = {}; for (const k of ["id", "s", "r", "cd", "od", "nd"]) if (p.get(k)) c[k] = p.get(k);
      if (c.id) { codes = c; text = ""; $("gqText").value = t; return load(); }
      if (p.get("t") && !/^\s*[・\-*]?\s*(会社|商談ID|フェーズ)\s*[:：]/m.test(t)) t = p.get("t");
    }
    codes = {}; text = t; $("gqText").value = t; load();
  }
  async function fromClipboard(loud) {
    try { const t = await navigator.clipboard.readText(); if (!t.trim()) throw new Error(); useText(t); }
    catch { if (loud) { msg("読み取れませんでした。下の欄に貼り付けて「この本文で確かめ直す」を押してください。", "err"); $("gqRaw").open = true; } }
  }
  $("gqReload").addEventListener("click", () => useText($("gqText").value));
  load();
})();
