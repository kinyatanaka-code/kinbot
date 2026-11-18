// AI（Gemini）の使用量：機能ごと・日ごと（2026-11-18 田中さん「機能ごとの使用量数えて欲しい」）
//   金額は Google の公開の値段からの目安。正しい請求額は Google Cloud の「お支払い」で見る
(function () {
  const box = document.getElementById("au");
  const esc = (t) => String(t === null || t === undefined ? "" : t).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
  const num = (n) => Number(n || 0).toLocaleString("ja-JP");
  const tok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n || 0));
  let days = 7;
  async function load() {
    box.innerHTML = "読み込んでいます…";
    let d; try { const r = await fetch(`/api/ai/usage?days=${days}`); d = await r.json(); if (!r.ok) throw new Error(d.error || r.status); } catch (e) { box.innerHTML = `<div class="au-sec">読めませんでした：${esc(e.message)}</div>`; return; }
    const yen = (usd) => `${Math.round(usd * d.rate).toLocaleString("ja-JP")}円`;
    const calls = d.features.reduce((n, f) => n + f.calls, 0);
    const maxF = Math.max(0.000001, ...d.features.map((f) => f.usd));
    const maxD = Math.max(0.000001, ...d.daily.map((x) => x.usd));
    const per = d.daily.length ? d.totalUsd / d.daily.length : 0;
    box.innerHTML = `
      <div class="au-top">
        <div class="au-kpi"><small>${days}日の目安</small><b>${yen(d.totalUsd)}</b><em>$${d.totalUsd.toFixed(2)}</em></div>
        <div class="au-kpi"><small>1日あたり</small><b>${yen(per)}</b><em>1か月だと約 ${yen(per * 30)}</em></div>
        <div class="au-kpi"><small>呼んだ回数</small><b>${num(calls)}</b><em>${d.features.length} 機能</em></div>
        <div class="au-days">${[1, 7, 30].map((n) => `<button type="button" data-d="${n}" class="${n === days ? "on" : ""}">${n === 1 ? "今日" : `${n}日`}</button>`).join("")}</div>
      </div>
      ${d.daily.length > 1 ? `<div class="au-sec"><h3>日ごと</h3><div class="au-chart">${d.daily.map((x) => `<div style="height:${Math.max(2, Math.round((x.usd / maxD) * 100))}%" title="${esc(x.day)}：${yen(x.usd)}（${num(x.calls)}回）"></div>`).join("")}</div><div class="au-axis"><span>${esc(d.daily[0].day.slice(5))}</span><span>${esc(d.daily[d.daily.length - 1].day.slice(5))}</span></div></div>` : ""}
      <div class="au-sec"><h3>機能ごと（金額の多い順）</h3>
        ${d.features.length ? d.features.map((f) => `<div class="au-row"><div class="nm"><b>${esc(f.label)}${f.tokensAudio ? '<span class="au-tag audio">音声</span>' : ""}${f.search ? `<span class="au-tag search">検索 ${num(f.search)}</span>` : ""}${f.errors ? `<span class="au-tag err">失敗 ${num(f.errors)}</span>` : ""}</b>
          <small>${f.label !== f.feature ? `${esc(f.feature)}　` : ""}入力 ${tok(f.tokensIn)}${f.tokensAudio ? `・音声 ${tok(f.tokensAudio)}` : ""}・出力 ${tok(f.tokensOut)}　${esc(f.models.join("・"))}${f.via.length ? `　｜　呼んだところ：${f.via.map((v) => esc(v.label)).join("・")}` : ""}</small>
          <div class="bar" style="width:${Math.max(1, Math.round((f.usd / maxF) * 100))}%"></div></div>
          <div class="n">${num(f.calls)}回</div><div class="y">${yen(f.usd)}</div></div>`).join("") : '<div class="au-note">まだ記録がありません。数え始めてから AI が呼ばれると、ここに出ます（2分ごとに記録）。</div>'}
        ${d.searchUsd ? `<div class="au-row"><div class="nm"><b>Google 検索つきの追加分</b><small>1日1,500回をこえた分（1,000回で35ドル）</small></div><div class="n"></div><div class="y">${yen(d.searchUsd)}</div></div>` : ""}
      </div>
      <div class="au-sec"><h3>モデルごと</h3>${d.models.map((m) => `<div class="au-row"><div class="nm"><b>${esc(m.model)}</b></div><div class="n">${num(m.calls)}回</div><div class="y">${yen(m.usd)}</div></div>`).join("") || '<div class="au-note">まだありません</div>'}</div>
      <p class="au-note">・数え始めたのは 2026-11-18 からです。それより前の分は入っていません。<br>・金額は Google の公開の値段（1ドル＝${d.rate}円）から出した目安です。無料枠や割引は入れていません。正しい請求額は Google Cloud の「お支払い」で見てください。<br>・Groq に回した分は Gemini の料金に入らないので 0円です。</p>`;
    box.querySelectorAll("[data-d]").forEach((b) => b.addEventListener("click", () => { days = Number(b.dataset.d); load(); }));
  }
  load();
})();
