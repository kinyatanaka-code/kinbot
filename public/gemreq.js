// Gemini のリンク（/gem?t=依頼の本文）から開く画面（2026-11-18）。
//   会社の設定で Gemini はメールを送れなかったので、リンクにした。まず中身（いま → 変えたあと）を見せ、
//   本人が「更新する」を押したときだけ、その人の権限で Salesforce を更新する
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t === null || t === undefined ? "" : t).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  // 項目の名前を、人が読める言葉にする
  const LABEL = { StageName: "フェーズ", Loss_Reason__c: "失注理由（大項目）", Loss_Reason1__c: "失注理由（中項目）", Loss_Reason2__c: "失注理由（小項目）", order_reason_detail__c: "受失注理由詳細", CloseDate: "完了予定日", order_date__c: "受失注日", LostOpp_nextactiondate__c: "失注後次回アクション日" };
  const msg = (t, kind = "") => { const m = $("gqMsg"); m.textContent = t; m.className = `gq-msg ${kind}`; };
  let text = new URLSearchParams(location.search).get("t") || "";
  $("gqText").value = text;
  if (!text) $("gqRaw").open = true;

  async function call(run) {
    const r = await fetch("/api/gemini-bridge/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, run }) });
    if (r.status === 401) { location.href = `/login.html?next=${encodeURIComponent(encodeURIComponent(location.pathname + location.search))}`; return null; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `うまくいきませんでした（${r.status}）`);
    return j;
  }
  async function load() {
    msg(""); $("gqBody").textContent = "確かめています…";
    if (!text.trim()) { $("gqBody").textContent = "依頼の本文がありません。下の欄に「会社：〇〇」「フェーズ：…」のように書いてください。"; return; }
    let j; try { j = await call(false); } catch (e) { $("gqBody").textContent = ""; msg(e.message, "err"); $("gqRaw").open = true; return; }
    if (!j) return;
    if (j.choose) {
      // 同じ会社に進行中の商談がいくつかあるとき：選んでもらう
      $("gqBody").innerHTML = `<p class="gq-sub">進行中の商談が${j.choose.length}件あります。更新するものを選んでください。</p><ul class="gq-choose">${j.choose.map((o) => `<li data-id="${esc(o.id)}"><b>${esc(o.account)}</b>　${esc(o.stage)}　${esc(o.owner)}<br>${esc(o.name)}</li>`).join("")}</ul>`;
      $("gqBody").querySelectorAll("li[data-id]").forEach((li) => li.addEventListener("click", () => {
        text = `商談ID：${li.dataset.id}\n` + text.split("\n").filter((l) => !/^\s*[・\-*]?\s*(会社|会社名|企業|企業名|取引先|取引先名)\s*[:：]/.test(l)).join("\n");
        $("gqText").value = text; load();
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
  $("gqReload").addEventListener("click", () => { text = $("gqText").value; load(); });
  load();
})();
