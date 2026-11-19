// SHOBO：Bales のリスト（拡張機能が Bales の画面から取り込んだもの）を見る（2026-11-15 田中さん）
//   左：リストのカード（名前・件数・取り込んだ日時・取り込み中の進み具合）／右：選んだリストの会社の表（検索・絞り込み・CSV）
(function () {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (u, o = {}) => { const r = await fetch(u, { credentials: "include", ...o }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.status); return j; };
  const dt = (s) => { if (!s) return ""; const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  // Bales の項目の名前（英語のことが多い）を、わかる言葉にする。合わないものは名前のまま出す
  const LABELS = [[/^(company|companyName|company_name|corporateName|corporate_name|accountName|account\.name|company\.name|name)$/i, "会社名", 1],
    [/(phone|tel)/i, "電話", 2], [/(^|\.)(owner|assignee|user|staff|charge)(\.name|Name|_name|\.fullName)$/i, "担当", 3], [/status|stage|phase|result/i, "ステータス", 4],
    [/(last).*(call|contact|activity|action)|lastCalled|last_called/i, "最終架電", 5], [/(prefecture|pref|state|都道府県)/i, "都道府県", 6], [/(url|website|site|homepage)/i, "会社URL", 7],
    [/(email|mail)/i, "メール", 8], [/(industry|業種)/i, "業種", 9], [/(employee)/i, "従業員数", 10],
    [/^(fullName|full_name|personName|contactName|lastName)$/i, "名前", 1.5], [/(lastActivity|last_activity)/i, "最終活動日", 4.5], [/(createdAt|created_at)/i, "作成日時", 11]];
  const labelOf = (k) => { const leaf = String(k).split(".").pop(); for (const [re, l] of LABELS) if (re.test(k) || (l !== "会社名" && re.test(leaf))) return l; return k; };   // 「担当.name」を会社名と取り違えない
  // 表示項目：選んだ列はリストごとにこのブラウザに覚える（Bales の「表示項目」と同じ考え方）（2026-11-15）
  const colsKey = (k) => "kb_bales_cols2_" + k;   // 2026-11-16：列を「会社名・電話番号・担当者名…」に決めたので、前に選んだ列はいったん忘れる
  const savedCols = (k) => { try { return JSON.parse(localStorage.getItem(colsKey(k)) || "null"); } catch { return null; } };
  // 値の取り出し：「a.[].b」は配列の全部（a.0.b、a.1.b…）をつなげる。日時は Bales と同じ「11/13 10:31」に
  const valOf = (d, key) => { if (!String(key).includes("[]")) return d[key]; const re = new RegExp("^" + key.split("[]").map((x) => x.replace(/[.*+?^${}()|\\]/g, "\\$&")).join("\\d+") + "$"); return Object.keys(d).filter((k) => re.test(k)).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).map((k) => d[k]).filter((v) => v !== "" && v != null).join("、"); };
  const fmt = (v) => { const t = String(v ?? ""); if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t)) { const x = new Date(t); if (!isNaN(x)) { const p = (n) => String(n).padStart(2, "0"); return `${p(x.getMonth() + 1)}/${p(x.getDate())} ${p(x.getHours())}:${p(x.getMinutes())}`; } } return t; };
  const pickCols = (cols, k, view) => {
    const sv = k && savedCols(k); if (sv && sv.length) return sv.map((x) => typeof x === "string" ? { key: x, label: (view || []).find((v) => v.key === x)?.label || labelOf(x) } : x);
    if (view && view.length) return view.map((v) => ({ key: v.key, label: v.label }));   // Bales の一覧と同じ並び・見出し
    // わかる項目を順に（同じ言葉は1つだけ）→ 足りなければよく埋まっている項目
    const out = [], used = new Set();
    // 同じ言葉に当たる項目が複数あるときは「…name」を選び、色・コード・種類の項目（uranus などの中の印）は後回しにする（2026-11-15 ステータスが uranus と出ていた）
    const rank = (k) => (/(^|\.)name$|Name$/.test(k) ? 0 : 2) + (/(color|colour|code|key|type|icon|theme)$/i.test(k) ? 5 : 0);
    for (const [, l, ord] of LABELS) { const c = (cols || []).filter((x) => labelOf(x.key) === l && !/id$/i.test(x.key)).sort((a, b) => rank(a.key) - rank(b.key))[0]; if (c && !used.has(l)) { out.push({ ...c, label: l, ord }); used.add(l); } }
    out.sort((a, b) => a.ord - b.ord);
    for (const c of cols || []) { if (out.length >= 6) break; if (out.some((x) => x.key === c.key) || /(^|\.)(id|_id|uuid)$/i.test(c.key)) continue; out.push({ ...c, label: labelOf(c.key) }); }
    return out.slice(0, 6);
  };
  const coNorm = (s) => String(s || "").normalize("NFKC").replace(/株式会社|有限会社|合同会社|一般社団法人|一般財団法人|社会福祉法人|医療法人|学校法人|\(株\)|㈱|（株）|\s/g, "").toLowerCase();
  let feeds = [], fday = "", wdiag = null, diag = null, lists = [], cur = null, q = "", fcol = "", fval = "", page = 0, poll = null, mtCos = null;
  let hotF = "", hotSort = false;   // ホット度の絞り込み（hot/warm/cold/warm+）と、ホット順に並べるか（2026-11-16）
  const PER = 100;
  // ホット度の印：3つ（担当者名・ニーズ・検討時期）のそろい具合。丸の色で、聞けた（緑）・聞けたが無い（灰）・まだ（白）
  const HOT_TXT = { 3: "ホット", 2: "ウォーム" };
  const hotDot = (x, lbl) => { const st = (x || {}).st || ""; const cls = st === "あり" ? "ok" : st === "なし" ? "no" : ""; return `<span class="bl-hd ${cls}" title="${esc(lbl + "：" + (st === "あり" ? "聞けた" : st === "なし" ? "聞けたが無い" : "まだ") + ((x || {}).why ? "（" + x.why + "）" : ""))}">${esc(lbl.slice(0, 1))}</span>`; };
  const hotCell = (h) => { if (!h) return '<span class="mc-note">判定待ち</span>'; const lv = h.n >= 3 ? "hot" : h.n === 2 ? "warm" : "cold"; return `<span class="bl-hot ${lv}">${HOT_TXT[h.n] || "コールド"}</span><span class="bl-hds">${hotDot(h.name, "担当者名")}${hotDot(h.need, "ニーズ")}${hotDot(h.when, "検討時期")}</span>`; };

  async function load() {
    const root = $("mcBalesView"); if (!root) return;
    try { const d0 = await api("/api/mochica/bales/lists"); lists = d0.items || []; diag = d0.diag || null; try { feeds = (await api("/api/mochica/bales/feeds")).items || []; } catch { feeds = []; } wdiag = d0.wdiag || null; } catch (e) { root.innerHTML = `<div class="mc-box"><p class="mc-note">読めませんでした：${esc(e.message)}</p></div>`; return; }
    if (!cur || (!lists.some((l) => l.list_key === cur) && !feeds.some((f) => f.feed === cur))) cur = (feeds[0] || {}).feed || (lists.find((l) => l.status !== "running") || lists[0] || {}).list_key || null;
    if (!mtCos && window.mcMeetingCompanies) { try { mtCos = new Map((await window.mcMeetingCompanies()).map((c) => [coNorm(c), c])); } catch { mtCos = new Map(); } }
    draw();
    clearTimeout(poll); if (lists.some((l) => l.status === "running") && !$("mcBalesView").closest("[hidden]")) poll = setTimeout(load, 3000);
  }
  function draw() {
    const root = $("mcBalesView"); if (!root) return;
    const run = lists.filter((l) => l.status === "running");
    root.innerHTML = `<div class="bl-wrap"><aside class="bl-side"><div class="bl-side-h"><b>Bales のリスト</b><span>${lists.length}リスト</span></div>
      ${run.map((l) => `<div class="bl-run"><b>取り込み中</b><small>${esc(l.name)} ・ ${Number(l.got || 0).toLocaleString()}${l.total ? ` / ${Number(l.total).toLocaleString()}` : ""}件</small><div class="bl-bar"><i style="width:${l.total ? Math.min(100, Math.round(l.got / l.total * 100)) : 30}%"></i></div></div>`).join("")}
      ${lists.map((l) => `<button type="button" class="bl-card${l.list_key === cur ? " on" : ""}" data-l="${esc(l.list_key)}"><b>${esc(l.name || l.list_key)}</b><small>${Number(l.status === "running" ? l.got : l.count || 0).toLocaleString()}社 ・ ${l.status === "running" ? "取り込み中" : dt(l.done_at || l.run_at)}</small>${l.status === "error" ? `<span class="bl-tag w">途中で止まりました</span>` : ""}</button>`).join("")}
      <div class="bl-side-h" style="margin-top:6px"><b>見張り（架電の記録など）</b><span>${feeds.length}</span></div>
      ${feeds.map((f) => `<button type="button" class="bl-card${f.feed === cur ? " on" : ""}" data-l="${esc(f.feed)}"><b>${esc(f.name || f.feed)}</b><small>${Number(f.total || 0).toLocaleString()}件 ・ ${f.last_sync ? `${esc(dt(f.last_sync))} に読んだ（新しい ${f.last_new || 0}件）` : "まだ読んでいません"}</small></button>`).join("") || '<div class="bl-how" style="border:0;padding:0">Bales の架電の記録などの画面で、右下の「kinbot に取り込む」→「この画面の一覧を見張る」で登録すると、ここに出ます。</div>'}
      <div class="bl-how"><b>取り込み方</b>Bales のリスト（<a href="https://mochica.balescloud.jp/app/lead-list" target="_blank" rel="noopener">リード一覧</a>）を開き、右下の「kinbot に取り込む」→「全部取り込む」。拡張機能 kinbot-ext（2.2.3 以上）が要ります。</div>
      </aside><div class="bl-main" id="blMain">${cur ? '<div class="mc-note">読み込んでいます…</div>' : '<div class="bl-empty">まだ取り込んだリストがありません。左の「取り込み方」から Bales のリストを取り込むと、ここに出ます。</div>' + diagHtml()}</div></div>`;
    root.querySelectorAll("[data-l]").forEach((b) => b.addEventListener("click", () => { cur = b.dataset.l; q = ""; fcol = ""; fval = ""; page = 0; draw(); }));
    if (cur && feeds.some((f) => f.feed === cur)) feedDetail(); else if (cur) detail();
  }
  // ===== 見張りの1日分：誰が・どこに・何件・どんな結果だったか（2026-11-15 田中さん「インターン生の架電を分析したい」）=====
  const jstDay = (t = Date.now()) => new Date(t + 9 * 3600000).toISOString().slice(0, 10);
  async function feedDetail() {
    const box = $("blMain"); const f = feeds.find((x) => x.feed === cur); if (!box || !f) return; if (!fday) fday = jstDay();
    box.innerHTML = '<div class="mc-note">読み込んでいます…</div>';
    let r; try { r = await api(`/api/mochica/bales/feeds/${encodeURIComponent(cur)}/day?date=${fday}`); } catch (e) { box.innerHTML = `<div class="mc-note">読めませんでした：${esc(e.message)}</div>`; return; }
    if ($("blMain") !== box) return;
    // 見出しの結びつきが無いときは、中身の項目名から見当をつける（会社・担当・結果・日時）
    let view = f.view || [];
    if (!view.length && r.items.length) { const ks = Object.keys(r.items[0]).filter((k) => !/^__/.test(k) && !/(^|\.)(id|_id|uuid|client_id)$/i.test(k));
      const pick = (re) => ks.find((k) => re.test(k)); const guess = [[r.tkey, "日時"], [pick(/user.*name|operator.*name|owner.*name/i), "担当"], [pick(/compan.*name|company/i), "会社名"], [pick(/result.*name|result|status/i), "結果"]].filter(([k]) => k);
      view = guess.map(([key, label]) => ({ key, label })); for (const k of ks) { if (view.length >= 6) break; if (!view.some((v) => v.key === k)) view.push({ key: k, label: labelOf(k) }); } }
    const vk = (re) => (view.find((v) => re.test(v.label)) || {}).key;
    const kWho = vk(/担当|架電者|ユーザー|所有者|オペレーター|コール者|発信者|実施者/), kRes = vk(/結果|ステータス/), kCo = vk(/会社/), kT = r.tkey;
    const it = r.items.map((d) => ({ d, who: kWho ? String(valOf(d, kWho) || "（不明）") : "（不明）", res: kRes ? String(valOf(d, kRes) || "（なし）") : "", co: kCo ? String(valOf(d, kCo) || "") : "", t: kT ? new Date(d[kT]) : null })).sort((a, b) => (b.t || 0) - (a.t || 0));
    const cnt = (arr, k) => { const m = new Map(); for (const x of arr) m.set(x[k], (m.get(x[k]) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
    const people = cnt(it, "who"); const results = kRes ? cnt(it, "res") : [];
    const hm = (t) => (t && !isNaN(t) ? `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}` : "");
    const hours = Array.from({ length: 11 }, (_, i) => 9 + i).map((h) => [h, it.filter((x) => x.t && x.t.getHours() === h).length]); const hmax = Math.max(1, ...hours.map((h) => h[1]));
    const shift = (n) => { const d = new Date(`${fday}T00:00:00+09:00`); d.setTime(d.getTime() + n * 86400000); fday = jstDay(d.getTime()); feedDetail(); };
    const resChips = (arr) => arr.map(([k, n]) => `<span class="bl-rc">${esc(k)} <b>${n}</b></span>`).join("");
    box.innerHTML = `<div class="bl-head"><div><h3>${esc(f.name)}</h3><small>${f.last_sync ? `最後に読んだ：${esc(dt(f.last_sync))}（新しい ${f.last_new || 0}件）・平日10〜19時に10分ごと` : "まだ読んでいません"}${f.src ? ` ・ 読んでいる一覧：${esc(String(f.src).replace(/^https?:\/\/[^/]+/, ""))}` : ""}</small></div>
        <div class="bl-acts"><button type="button" class="mt-btn ghost" data-dd="-1">前の日</button><input type="date" class="bl-date" data-day value="${fday}"><button type="button" class="mt-btn ghost" data-dd="1">次の日</button><button type="button" class="mt-btn ghost" data-dd="0">今日</button><button type="button" class="mt-btn ghost bl-del" data-fdel>外す</button></div></div>
      <div class="bl-mets"><div><small>架電の数</small><b>${it.length.toLocaleString()}</b></div><div><small>架電した人</small><b>${people.length}</b></div><div><small>架電した会社</small><b>${new Set(it.map((x) => x.co).filter(Boolean)).size.toLocaleString()}</b></div><div><small>結果の種類</small><b>${results.length}</b></div><div><small>見張りの全部</small><b>${Number(f.total || 0).toLocaleString()}</b></div></div>
      ${r.sort === "none" ? '<div class="bl-diag">Bales の一覧を「最終架電日時の新しい順」で読めませんでした。今日かけたリードが後ろのページにあると数えられません。Bales のリード一覧で「最終架電日時」の列を押して新しい順に並べ、その画面で見張りを登録し直してください。</div>' : ""}
      ${!kT ? '<div class="bl-diag">時刻の項目が見つからなかったので、kinbot が初めて見た時刻で日を分けています。</div>' : !(f.view || []).length ? `<div class="bl-diag">見出しの結びつきが無いので、項目の名前から見当をつけて出しています（日時＝${esc(kT)}）。</div>` : ""}
      ${results.length ? `<div class="bl-h4">結果</div><div class="bl-rcs">${resChips(results)}</div>` : ""}
      <div class="bl-h4">時間ごと</div><div class="bl-hours">${hours.map(([h, n]) => `<div title="${h}時台 ${n}件"><i style="height:${Math.round((n / hmax) * 60)}px"></i><b>${n || ""}</b><small>${h}時</small></div>`).join("")}</div>
      <div class="bl-h4">人ごと</div><div class="bl-tbl"><table><thead><tr><th>${esc((view.find((v) => v.key === kWho) || {}).label || "担当")}</th><th>架電</th><th>最初</th><th>最後</th>${kRes ? "<th>結果</th>" : ""}</tr></thead><tbody>
        ${people.map(([w, n]) => { const mine = it.filter((x) => x.who === w); const ts = mine.map((x) => x.t).filter((t) => t && !isNaN(t)).sort((a, b) => a - b); return `<tr class="bl-row" data-who="${esc(w)}"><td><b>${esc(w)}</b></td><td>${n}</td><td>${hm(ts[0])}</td><td>${hm(ts[ts.length - 1])}</td>${kRes ? `<td>${resChips(cnt(mine, "res"))}</td>` : ""}</tr>`; }).join("") || `<tr><td colspan="5" class="mc-note">この日の架電はありません。</td></tr>`}</tbody></table></div>
      <div class="bl-h4">架電の一覧<small data-who-f></small></div><div class="bl-tbl"><table><thead><tr><th>時刻</th>${view.map((v) => `<th>${esc(v.label)}</th>`).join("")}</tr></thead><tbody data-list>
        ${it.slice(0, 1000).map((x) => `<tr data-w="${esc(x.who)}"><td>${hm(x.t)}</td>${view.map((v) => `<td title="${esc(valOf(x.d, v.key))}">${esc(fmt(valOf(x.d, v.key)))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    box.querySelectorAll("[data-dd]").forEach((b) => b.addEventListener("click", () => { const n = Number(b.dataset.dd); if (n === 0) { fday = jstDay(); feedDetail(); } else shift(n); }));
    box.querySelector("[data-day]").addEventListener("change", (e) => { if (e.target.value) { fday = e.target.value; feedDetail(); } });
    box.querySelectorAll("[data-who]").forEach((tr) => tr.addEventListener("click", () => { const w = tr.dataset.who; const on = tr.classList.toggle("on"); box.querySelectorAll("[data-who]").forEach((x) => { if (x !== tr) x.classList.remove("on"); });
      box.querySelectorAll("[data-list] tr").forEach((x) => { x.hidden = on && x.dataset.w !== w; }); box.querySelector("[data-who-f]").textContent = on ? `（${w} だけ）` : ""; }));
    box.querySelector("[data-fdel]").addEventListener("click", async () => { if (!confirm(`見張り「${f.name}」と、kinbot に入った分（${Number(f.total || 0).toLocaleString()}件）を消しますか？（Bales の中身は変わりません。拡張機能の見張りは Bales のパネルで外してください）`)) return; try { await api(`/api/mochica/bales/feeds/${encodeURIComponent(cur)}`, { method: "DELETE" }); cur = null; load(); } catch (e) { alert("消せませんでした：" + e.message); } });
  }
  async function detail() {
    const box = $("blMain"); const l = lists.find((x) => x.list_key === cur); if (!box || !l) return;
    const cols = pickCols(l.cols, cur, l.view); const coCol = cols.find((c) => c.label === "会社名"); const stCol = cols.find((c) => /ステータス|ステージ/.test(c.label) && !c.key.includes("[]"));
    let r; try { r = await api(`/api/mochica/bales/lists/${encodeURIComponent(cur)}/rows?q=${encodeURIComponent(q)}&col=${encodeURIComponent(fcol)}&val=${encodeURIComponent(fval)}&offset=${page * PER}&limit=${PER}&hot=${encodeURIComponent(hotF)}&sort=${hotSort ? "hot" : ""}`); } catch (e) { box.innerHTML = `<div class="mc-note">読めませんでした：${esc(e.message)}</div>`; return; }
    if ($("blMain") !== box) return;
    let vals = []; if (stCol) { try { vals = (await api(`/api/mochica/bales/lists/${encodeURIComponent(cur)}/values?col=${encodeURIComponent(stCol.key)}`)).items || []; } catch {} }
    const diff = l.prev_count != null && l.status !== "running" ? l.count - l.prev_count : null;
    const hasMt = (d) => coCol && mtCos && mtCos.get(coNorm(valOf(d, coCol.key)));
    const csvQ = `q=${encodeURIComponent(q)}&col=${encodeURIComponent(fcol)}&val=${encodeURIComponent(fval)}&hot=${encodeURIComponent(hotF)}&sort=${hotSort ? "hot" : ""}`;
    const hn = l.hot_n || {};
    box.innerHTML = `<div class="bl-head"><div><h3>${esc(l.name || l.list_key)}</h3><small>最後に取り込んだ日時：${l.status === "running" ? "取り込み中" : esc(dt(l.done_at || l.run_at))}${l.error ? ` ・ ${esc(l.error)}` : ""}</small></div>
        <div class="bl-acts"><a class="mt-btn ghost" href="https://mochica.balescloud.jp/app/lead-list" target="_blank" rel="noopener">取り込み直す ↗</a><a class="mt-btn ghost" href="/api/mochica/bales/lists/${encodeURIComponent(cur)}/csv?${csvQ}">CSV</a><button type="button" class="mt-btn" data-sf>${l.sf_info ? "SF と結び直す" : "SF と結びつける"}</button><button type="button" class="mt-btn ghost bl-del" data-del>消す</button></div></div>
      <div class="bl-sfst" data-sfst>${l.sf_info ? `SF：${l.sf_info.byName != null ? `SalesforceID で ${Number(l.sf_info.byId || 0).toLocaleString()}件・会社名で ${Number(l.sf_info.byName || 0).toLocaleString()}件` : `SalesforceID あり ${Number(l.sf_info.withId || 0).toLocaleString()}件`} → SF で見つかった ${Number(l.sf_info.linked || 0).toLocaleString()}件・過去の商談あり ${Number(l.sf_info.withOpps || 0).toLocaleString()}件（${esc(dt(l.sf_info.at))}）` : ""}</div>
      ${l.w_n ? `<div class="bl-sfst">Bales に書き込んだ（SF の失注情報など）：${Number(l.w_n).toLocaleString()}件</div>` : ""}
      ${wdiag && !wdiag.ok ? `<details class="bl-diag" style="margin-top:6px"><summary>Bales への書き込み方を覚えられませんでした（${esc(dt(wdiag.at))}）</summary>${esc(wdiag.reason)}<div class="bl-dl">${esc(wdiag.method)} ${esc(wdiag.url)}<br>${esc(wdiag.shape)}</div></details>` : ""}
      <div class="bl-mets"><div><small>会社</small><b>${Number(l.status === "running" ? l.got : l.count || 0).toLocaleString()}</b></div><div><small>MOCHICA の商談あり</small><b data-mtn>—</b></div><div><small>前回から</small><b>${diff == null ? "—" : (diff >= 0 ? "+" : "") + diff.toLocaleString()}</b></div><div><small>詳しい中身（架電履歴など）</small><b>${Number(l.detail_n || 0).toLocaleString()}</b></div><div><small>SF と結びついた</small><b>${Number(l.sf_n || 0).toLocaleString()}</b></div></div>
      <div class="bl-hotbar"><button type="button" class="bl-hb hot ${hotF === "hot" ? "on" : ""}" data-hf="hot"><small>ホット（3つそろい）</small><b>${Number(hn.hot || 0).toLocaleString()}</b></button><button type="button" class="bl-hb warm ${hotF === "warm" ? "on" : ""}" data-hf="warm"><small>ウォーム（2つ）</small><b>${Number(hn.warm || 0).toLocaleString()}</b></button><button type="button" class="bl-hb cold ${hotF === "cold" ? "on" : ""}" data-hf="cold"><small>コールド（1つ以下）</small><b>${Number(hn.cold || 0).toLocaleString()}</b></button>
        <div class="bl-hb-sub">担当者名が取れた <b>${Number(hn.name || 0).toLocaleString()}</b> ・ ニーズを聞けた <b>${Number(hn.need || 0).toLocaleString()}</b> ・ 検討時期を聞けた <b>${Number(hn.when || 0).toLocaleString()}</b>${hn.yet ? ` ・ 判定待ち ${Number(hn.yet).toLocaleString()}` : ""}</div></div>
      <div class="bl-find"><input type="search" data-q value="${esc(q)}" placeholder="会社名・名前・電話番号で探す"><button type="button" class="mt-btn ghost" data-colsel>表示項目</button><select data-hot><option value="">ホット度：すべて</option><option value="hot" ${hotF === "hot" ? "selected" : ""}>ホットだけ</option><option value="warm+" ${hotF === "warm+" ? "selected" : ""}>ウォーム以上</option><option value="warm" ${hotF === "warm" ? "selected" : ""}>ウォームだけ</option><option value="cold" ${hotF === "cold" ? "selected" : ""}>コールドだけ</option></select><label class="bl-hsort"><input type="checkbox" data-hsort ${hotSort ? "checked" : ""}>ホット順</label>${stCol ? `<select data-f><option value="">${esc(stCol.label)}：すべて</option>${vals.map((v) => `<option value="${esc(v.v)}" ${fcol === stCol.key && fval === v.v ? "selected" : ""}>${esc(v.v)}（${v.n}）</option>`).join("")}</select>` : ""}</div>
      ${cols.length ? `<div class="bl-tbl"><table><thead><tr><th>ホット度</th>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}<th>SF</th></tr></thead><tbody>
        ${r.rows.map((d) => `<tr class="bl-row" data-row="${esc(d.__k)}"><td class="bl-hotc">${hotCell(d.__hot)}</td>${cols.map((c, i) => `<td title="${esc(valOf(d, c.key))}">${i === 0 && hasMt(d) ? `<button type="button" class="bl-mt" data-co="${esc(hasMt(d))}" title="MOCHICA の会社カードへ"><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="3" fill="#1d9e75"/><rect x="5" y="6" width="2" height="2" rx=".6" fill="#fff"/><rect x="9" y="6" width="2" height="2" rx=".6" fill="#fff"/><rect x="5" y="10" width="6" height="2" rx=".6" fill="#fff"/></svg></button>` : ""}${/^https?:\/\//.test(valOf(d, c.key) || "") ? `<a href="${esc(valOf(d, c.key))}" target="_blank" rel="noopener">${esc(valOf(d, c.key))}</a>` : esc(fmt(valOf(d, c.key)))}</td>`).join("")}<td>${sfChip(d.__sf)}</td></tr>`).join("") || `<tr><td colspan="${cols.length + 2}" class="mc-note">当てはまる会社がありません。</td></tr>`}
        </tbody></table></div>` : '<div class="mc-note">まだ行がありません。</div>'}
      <div class="bl-pg"><span>${r.total ? `${(page * PER + 1).toLocaleString()}〜${Math.min(r.total, (page + 1) * PER).toLocaleString()} / ${r.total.toLocaleString()}件` : ""}</span>${page > 0 ? '<button type="button" class="mt-btn ghost" data-pg="-1">前へ</button>' : ""}${(page + 1) * PER < r.total ? '<button type="button" class="mt-btn ghost" data-pg="1">次へ</button>' : ""}</div>
      ${coCol ? '<p class="mc-note" style="margin-top:6px">緑の印＝MOCHICA に商談がある会社。押すとその会社カードへ。</p>' : ""}
      <p class="mc-note" style="margin-top:4px">ホット度：「担当者名・ニーズ・検討時期」の3つがそろえばホット、2つでウォーム。ニーズと検討時期は、架電のコメントやカスタム情報の文章（SF と結びついた行は SF の課題感・検討開始時期も）から言葉で読んでいます。丸の上に指を置くと根拠が出ます。</p>`;
    // 商談ありの数は、今の絞り込みの全件で数える（会社名だけ読む）
    (async () => { const el = box.querySelector("[data-mtn]"); if (!el || !coCol || !mtCos) return; try { let n = 0; for (let off = 0; ; off += 5000) { const a = await api(`/api/mochica/bales/lists/${encodeURIComponent(cur)}/rows?offset=${off}&limit=5000`); n += a.rows.filter((d) => mtCos.get(coNorm(valOf(d, coCol.key)))).length; if (a.rows.length < 5000) break; } el.textContent = n.toLocaleString(); } catch { el.textContent = "—"; } })();
    let tm = null; const qi = box.querySelector("[data-q]"); qi.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(() => { q = qi.value.trim(); page = 0; detail().then(() => { const n = $("blMain").querySelector("[data-q]"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, 400); });
    const hs = box.querySelector("[data-hot]"); if (hs) hs.addEventListener("change", () => { hotF = hs.value; page = 0; detail(); });
    const hso = box.querySelector("[data-hsort]"); if (hso) hso.addEventListener("change", () => { hotSort = hso.checked; page = 0; detail(); });
    box.querySelectorAll("[data-hf]").forEach((b) => b.addEventListener("click", () => { hotF = hotF === b.dataset.hf ? "" : b.dataset.hf; page = 0; detail(); }));
    const fs = box.querySelector("[data-f]"); if (fs) fs.addEventListener("change", () => { fcol = fs.value ? stCol.key : ""; fval = fs.value; page = 0; detail(); });
    box.querySelectorAll("[data-pg]").forEach((b) => b.addEventListener("click", () => { page += Number(b.dataset.pg); detail(); }));
    box.querySelectorAll("[data-co]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); window.mcOpenCompany && window.mcOpenCompany(b.dataset.co); }));
    box.querySelectorAll("[data-row]").forEach((tr) => tr.addEventListener("click", () => leadSheet(l, tr.dataset.row, r.rows.find((d) => d.__k === tr.dataset.row))));
    box.querySelector("[data-colsel]").addEventListener("click", () => colSheet(l));
    // SF と結びつける：サーバーで読んで書く（2万件で数分）。進み具合を見せて、終わったら読み直す
    box.querySelector("[data-sf]").addEventListener("click", async (e) => { const b = e.currentTarget; b.disabled = true; b.textContent = "結びつけています…";
      try { await api(`/api/mochica/bales/lists/${encodeURIComponent(cur)}/sf-link`, { method: "POST" }); sfPoll(cur); } catch (er) { b.disabled = false; b.textContent = "SF と結びつける"; alert("始められませんでした：" + er.message); } });
    if (sfPolling !== cur) { api(`/api/mochica/bales/lists/${encodeURIComponent(cur)}/sf-link`).then((j) => { if (j.job && j.job.running) sfPoll(cur); }).catch(() => {}); }
    // 消す：kinbot に取り込んだ分だけ消す（Bales の中身は変わらない）
    box.querySelector("[data-del]").addEventListener("click", async () => { if (!confirm(`「${l.name || l.list_key}」を kinbot から消しますか？（${Number(l.count || l.got || 0).toLocaleString()}件。Bales の中身は変わりません。元に戻せません）`)) return;
      try { await api(`/api/mochica/bales/lists/${encodeURIComponent(cur)}`, { method: "DELETE" }); cur = null; load(); } catch (e) { alert("消せませんでした：" + e.message); } });
  }
  // SF の結びつきの小さな印（商談の数・いちばん新しい段階。受注は緑、失注は黄色）
  const sfChip = (x) => { if (!x) return ""; if (!x.n) return x.status ? `<span class="bl-sfc">リード：${esc(x.status)}</span>` : ""; return `<span class="bl-sfc ${x.won ? "won" : x.lost ? "lost" : ""}" title="${esc(x.last)}（${esc(x.lastDate)}）">商談${x.n}・${esc(String(x.last).replace(/^\d+\s*[:：]\s*/, "").slice(0, 8))}</span>`; };
  let sfPolling = "";
  async function sfPoll(key) {
    sfPolling = key; let j = null; try { j = (await api(`/api/mochica/bales/lists/${encodeURIComponent(key)}/sf-link`)).job; } catch {}
    const el = document.querySelector("[data-sfst]"); const b = document.querySelector("[data-sf]");
    if (!j) { if (sfPolling === key && el && cur === key && /段階目/.test(el.textContent)) { el.textContent = "SF との結びつけが途中で止まりました（kinbot が再起動したため）。もう一度押してください。"; if (b) { b.disabled = false; b.textContent = "SF と結び直す"; } } sfPolling = ""; return; }
    // 進み具合：全体の％のバー・何段階目か・いまの作業と件数・経過時間（2026-11-15 田中さん「進捗がわかるように」）
    if (el && cur === key) { const sec = Math.round((Date.now() - (j.at || Date.now())) / 1000); const el2 = `${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, "0")}秒`;
      el.innerHTML = j.error ? `SF と結びつけられませんでした：${esc(j.error)}` : j.running ? `<div class="bl-prog"><div class="bl-bar"><i style="width:${j.pct || 1}%"></i></div><b>${j.pct || 0}%</b></div><small>${j.no || 1} / ${j.of || 6} 段階目 ・ ${esc(j.step)} ・ 経過 ${el2}</small>` : "SF と結びつけました。"; }
    if (b && cur === key) { b.disabled = !!j.running; b.textContent = j.running ? "結びつけています…" : "SF と結び直す"; }
    if (j.running) { setTimeout(() => sfPoll(key), 3000); return; }
    sfPolling = ""; if (!j.error) load();
  }
  // ===== 表示項目を選ぶ（取り込んだ項目すべてから）=====
  function colSheet(l) {
    const cur0 = pickCols(l.cols, l.list_key, l.view).map((c) => c.key);
    const vk = (l.view || []).map((v) => v.key); const allc = [...(l.view || []).map((v) => ({ key: v.key, n: 0, vl: v.label })), ...(l.cols || []).filter((c) => !vk.includes(c.key))];
    const sh = sheet(`<h3>表示項目</h3><p class="mc-note">表に出す項目を選びます（上から順に出ます）。このブラウザに覚えます。</p>
      <input type="search" data-cf placeholder="項目を探す" class="bl-cf">
      <div class="bl-cols">${allc.map((c) => { const lb = c.vl || labelOf(c.key); return `<label data-ck="${esc(c.key.toLowerCase() + " " + lb)}"><input type="checkbox" value="${esc(c.key)}" data-lb="${esc(lb)}" ${cur0.includes(c.key) ? "checked" : ""}><span><b>${esc(lb)}</b>${lb !== c.key ? `<small>${esc(c.key)}</small>` : ""}</span><small>${c.vl ? "Bales の一覧" : c.n.toLocaleString() + "件"}</small></label>`; }).join("")}</div>
      <div style="display:flex;gap:8px;margin-top:12px"><button type="button" class="mt-btn" data-csave>この項目で表示</button><button type="button" class="mt-btn ghost" data-creset>${l.view && l.view.length ? "Bales の一覧と同じに戻す" : "おすすめに戻す"}</button></div>`);
    sh.querySelector("[data-cf]").addEventListener("input", (e) => { const v = e.target.value.trim().toLowerCase(); sh.querySelectorAll("[data-ck]").forEach((x) => { x.hidden = v && !x.dataset.ck.includes(v); }); });
    sh.querySelector("[data-csave]").addEventListener("click", () => { const ks = [...sh.querySelectorAll("input[type=checkbox]:checked")].map((x) => ({ key: x.value, label: x.dataset.lb })); try { localStorage.setItem(colsKey(l.list_key), JSON.stringify(ks.slice(0, 20))); } catch {} closeSheet(); detail(); });
    sh.querySelector("[data-creset]").addEventListener("click", () => { try { localStorage.removeItem(colsKey(l.list_key)); } catch {} closeSheet(); detail(); });
  }
  // ===== 会社まとめ（2026-11-20 福井さん）=====
  //   前は「取り込んだ全部の項目」と「詳しい中身」（Bales の読み先がほぼ 404 で空）を並べていて、ほとんど空白だった。
  //   いまは、会社の情報・商談の状態・先方の担当者・組織・当社側の担当・架電の履歴を、Bales と SF と MOCHICALL から集めて1枚に出す。
  //   値の無い項目は出さない（空欄を並べない）。
  const SFL = "https://ap10.lightning.force.com/lightning/r";
  const LEGAL = /(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|社会福祉法人|医療法人社団|医療法人財団|医療法人|学校法人|宗教法人|特定非営利活動法人|NPO法人|地方独立行政法人|独立行政法人|国立大学法人|生活協同組合|農業協同組合|協同組合|信用金庫|弁護士法人|税理士法人|監査法人|司法書士法人|行政書士法人|社会保険労務士法人|\(株\)|\(有\))/;
  const legalOf = (s) => { const m = String(s || "").normalize("NFKC").match(LEGAL); return m ? ({ "(株)": "株式会社", "(有)": "有限会社" }[m[1]] || m[1]) : ""; };
  const has = (v) => v !== "" && v != null && v !== false;
  // [見出し, 値, 値が HTML か] の並びを、値のあるものだけ2列で出す
  const kv = (pairs) => { const f = pairs.filter(([, v]) => has(v)); return f.length ? `<div class="bl-kv">${f.map(([k, v, html]) => `<div><small>${esc(k)}</small><span>${html ? v : esc(v)}</span></div>`).join("")}</div>` : ""; };
  const ln = (u) => (u ? `<a href="${esc(/^https?:/i.test(u) ? u : "http://" + u)}" target="_blank" rel="noopener">${esc(u)}</a>` : "");
  const ymd = (s) => { if (!s) return ""; const x = new Date(s); return isNaN(x) ? String(s).slice(0, 10) : `${x.getFullYear()}/${x.getMonth() + 1}/${x.getDate()}`; };
  const ymdhm = (s) => { if (!s) return ""; const x = new Date(s); return isNaN(x) ? String(s) : `${ymd(s)} ${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`; };
  const sec = (title, sub, body) => (body ? `<section class="bl-sec bl-co"><div class="bl-st">${esc(title)}${sub ? `<small>${esc(sub)}</small>` : ""}</div>${body}</section>` : "");
  const tbl = (heads, rows) => (rows.length ? `<div class="bl-tbl"><table><thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((c) => `<tr>${c.map((x) => `<td title="${esc(String(x).replace(/<[^>]+>/g, ""))}">${x}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : "");
  const chip = (t, cls = "") => (t ? `<span class="bl-chip ${cls}">${esc(t)}</span>` : "");
  const stageCls = (s) => (/受注|^0[6-8]/.test(s || "") ? "won" : /失注|NG|ロスト/.test(s || "") ? "lost" : "");
  async function leadSheet(l, rid, row) {
    const sh = sheet('<div class="mc-note">読み込んでいます…</div>');
    let r; try { r = await api(`/api/mochica/bales/lists/${encodeURIComponent(l.list_key)}/rows/${encodeURIComponent(rid)}`); } catch (e) { sh.innerHTML = `<div class="mc-note">読めませんでした：${esc(e.message)}</div>`; return; }
    const draw = (c, mts) => { if (!sheetEl || !sheetEl.contains(sh)) return; sh.innerHTML = companyHtml(rid, r, row, c, mts); bindSheet(sh); };
    draw(null, null);
    // SF と MiiTel は後から足す：Bales の分を先に見せて待たせない
    const coName = String((r.data || {}).companyName || "");
    const pc = api(`/api/mochica/bales/lists/${encodeURIComponent(l.list_key)}/rows/${encodeURIComponent(rid)}/company`).catch((e) => ({ sfError: "読めませんでした：" + e.message, calls: [] }));
    const pm = window.mcMeetingsOf && coName ? window.mcMeetingsOf((x) => !!x && coNorm(x) === coNorm(coName)).catch(() => []) : Promise.resolve([]);
    const [c, mts] = await Promise.all([pc, pm]); draw(c, mts);
  }
  function bindSheet(sh) {
    sh.querySelectorAll("[data-openco]").forEach((b) => b.addEventListener("click", () => { const co = b.dataset.openco; closeSheet(); if (window.mcOpenCompany) window.mcOpenCompany(co); }));
  }
  function companyHtml(rid, r, row, c, mts) {
    const raw = r.raw || {}, d = r.data || {}; const B = { ...d, ...raw };
    const L = (c && c.lead) || null, A = (c && c.account) || null; const H = (L && L.hear) || {};
    const pick = (...v) => { const x = v.find(has); return x == null ? "" : x; };
    const name = B.companyName || (L && L.company) || (A && A.name) || "（会社名なし）";
    const legal = legalOf(name);
    const arr = (v) => (Array.isArray(v) ? v : []);
    const tags = arr(raw.freeTags).map((t) => t && t.text).filter(Boolean);
    const srcs = arr(raw.leadSources).map((t) => t && t.name).filter(Boolean);
    const camps = arr(raw.sfCampaigns).map((t) => t && t.name).filter(Boolean);
    const nexts = arr(raw.nextActions).filter((x) => x && !x.isDone).sort((a, b) => String(a.reservedAt).localeCompare(String(b.reservedAt)));
    const opps = (c && c.opps) || []; const last = opps[0] || null;
    const group = (c && c.group) || [];
    const calls = (c && c.calls) || [];
    // ===== 見出し：会社名と、いまの状態がひと目で分かる札 =====
    const hot = row && row.__hot ? `<span class="bl-hotc">${hotCell(row.__hot)}</span>` : "";
    const head = `<h3>${esc(name)}</h3>
      <div class="bl-chips">${chip(legal, "lg")}${chip(B.lastLeadStageName ? "Bales：" + B.lastLeadStageName : "")}${chip(L && L.status ? "SF リード：" + L.status : "")}${chip(A && A.status ? "取引先：" + A.status : "", stageCls(A && A.status))}${chip(last ? "最新の商談：" + last.stage : "", stageCls(last && last.stage))}${hot}</div>
      <div class="bl-sflinks"><a class="mt-btn ghost" href="https://mochica.balescloud.jp/app/lead-list?callTargetId=${encodeURIComponent(B.callTargetId || rid)}" target="_blank" rel="noopener">Bales ↗</a>${L ? `<a class="mt-btn ghost" href="${SFL}/Lead/${esc(L.id)}/view" target="_blank" rel="noopener">SF のリード ↗</a>` : ""}${A ? `<a class="mt-btn ghost" href="${SFL}/Account/${esc(A.id)}/view" target="_blank" rel="noopener">SF の取引先 ↗</a>` : ""}${mts && mts.length ? `<button type="button" class="mt-btn ghost" data-openco="${esc(mts[0].co)}">MiiTel の商談（${mts.length}件）</button>` : ""}</div>`;
    // ===== 会社の情報 =====
    const info = kv([["会社名", name], ["法人格", legal], ["代表電話", pick(B.companyTel1, A && A.phone, L && L.phone)], ["住所", pick(A && A.addr, B.companyAddress, L && L.addr)],
      ["会社 URL", ln(pick(B.companyUrl, A && A.web, L && L.web)), true], ["業種", pick(A && A.industry, B.businessCategory, L && L.industry)], ["従業員数", pick(A && A.emp, B.numberOfEmployees, L && L.emp)],
      ["法人番号", A && A.corpNo], ["採用ページ", ln(A && A.recruit), true], ["LINE の登録名", A && A.line], ["利用中の ATS", H["利用中ATS"]], ["採用人数", H["採用人数(選択リスト)"]], ["エントリー数", H["エントリー数"]],
      ["今のサービスの更新月", H["現利用サービス更新予定月"]], ["リードの出どころ", [...srcs, L && L.source].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join("、")], ["SF キャンペーン", camps.join("、")], ["タグ", tags.join("、")],
      ["アプローチ禁止", H["アプローチ禁止の種類"]], ["Bales に入った日", ymd(B.createdAt)], ["SF リードの作成日", L && L.created], ["取引先になった日", A && A.since]]);
    // ===== 商談の状態 =====
    const nx = nexts[0];
    const state = kv([["Bales のステージ", B.lastLeadStageName ? `${B.lastLeadStageName}${has(B.lastLeadStageStayDays) ? `（${B.lastLeadStageStayDays}日目）` : ""}` : ""], ["SF リードの状態", L ? `${L.status}${L.converted ? "（コンバート済み）" : ""}` : ""],
      ["取引先の状態", A && A.status], ["最新の商談", last ? `${last.stage}（${last.type ? last.type + "・" : ""}${last.date}）` : ""], ["商談の回数", opps.length ? `${opps.length}件` : ""],
      ["架電の回数", has(B.callResultsCount) ? `${B.callResultsCount}回` : ""], ["最後の架電", B.lastCalledAt ? `${ymdhm(B.lastCalledAt)}　${B.callResult || ""}` : ""], ["最後のコメント", pick(B.lastCalledComment, B.lastActivityComment)],
      ["次にやること", nx ? `${ymdhm(nx.reservedAt)}　${nx.name || ""}${nx.content ? "：" + nx.content : ""}${nx.owner && nx.owner.name ? `（${nx.owner.name}）` : ""}` : ""],
      ["活動予定", [H["活動予定日時"], H["活動予定コメント"]].filter(Boolean).join("　")], ["顧客の現状", H["顧客の現状"]], ["顧客の課題感", H["顧客の課題感"]], ["検討開始時期", H["検討開始時期"]], ["ペンディング理由", H["ペンディング理由"]],
      ["失注した日", H["失注商談失注日"] ? `${H["失注商談失注日"]}${H["失注商談失注前ステージ"] ? `（失注前：${H["失注商談失注前ステージ"]}）` : ""}` : ""],
      ["失注理由", [H["失注商談失注理由大"], H["失注商談失注理由中"], H["失注商談失注理由小"]].filter(Boolean).join(" ／ ")], ["失注理由の詳細", H["失注商談失注理由詳細"]], ["負けた競合", H["失注商談バッティング負け競合"]], ["失注後の次のアクション", H["失注後次回アクション日"]]]);
    const oppT = tbl(["商談日", "商談名", "事業", "段階", "担当", "アポ獲得", "失注理由"], opps.map((o) => [esc(o.date), `<a href="${SFL}/Opportunity/${esc(o.id)}/view" target="_blank" rel="noopener">${esc(o.name)}</a>`, esc(o.type), `<span class="bl-stg ${stageCls(o.stage)}">${esc(o.stage)}</span>`, esc(o.owner), esc(o.apo), esc([o.lost, o.detail].filter(Boolean).join("："))]));
    // ===== 先方の担当者：Bales・SF のリード・同じ会社のほかのリード・取引先責任者を1つの表に（同じ名前は1行にまとめる）=====
    const ppl = []; const nk = (s) => String(s || "").normalize("NFKC").replace(/\s|様|さん/g, "");
    const add = (p) => {
      const k = nk(p.name); const vague = !k || /^(ご?担当者?|採用担当|人事)$/.test(k);
      if (vague && !p.phone && !p.email) return;
      // Bales は名字だけ（志水）、SF はフルネーム（志水 亮介）のことが多いので、片方が片方の頭なら同じ人とみる
      const same = (x) => { const a = nk(x.name); return a === k || (a.length >= 2 && k.length >= 2 && (a.startsWith(k) || k.startsWith(a))); };
      const o = vague ? null : ppl.find(same);
      if (o && k.length > nk(o.name).length) o.name = p.name;   // 長いほう（フルネーム）を残す
      if (o) { for (const f of ["title", "dept", "phone", "email"]) if (!o[f] && p[f]) o[f] = p[f]; if (!o.src.includes(p.src)) o.src.push(p.src); } else ppl.push({ ...p, src: [p.src] });
    };
    add({ name: B.targetName, title: B.position, dept: B.department, phone: pick(B.personalTel, B.companyTel1), email: B.email, src: "Bales" });
    if (L) add({ name: L.name, title: L.title, phone: L.phone || L.mobile, email: L.email, src: "SF リード" });
    for (const o of (c && c.others) || []) add({ name: o.name, title: o.title, phone: o.phone, email: o.email, src: `SF リード（${o.status || "状態なし"}）` });
    for (const o of (c && c.contacts) || []) add({ name: o.name, title: o.title, dept: o.dept, phone: o.phone, email: o.email, src: `取引先責任者${o.biz ? "（" + o.biz + "）" : ""}` });
    const pplT = tbl(["名前", "役職", "部署", "電話", "メール", "出どころ"], ppl.map((p) => [esc(p.name || "（名前なし）"), esc(p.title), esc(p.dept), esc(p.phone), esc(p.email), esc(p.src.join("・"))]));
    // ===== 組織：法人格・従業員数・部署・拠点・同じ法人のほかの事業の取引先 =====
    const depts = [...new Set(ppl.map((p) => p.dept).filter(Boolean))];
    const site = (() => { const m = String(name).normalize("NFKC").replace(LEGAL, " ").trim().match(/\s(\S.*)$/); return m ? m[1] : ""; })();   // 「法人名 ＋ 施設名」の施設名
    const org = kv([["法人格", legal], ["従業員数", pick(A && A.emp, B.numberOfEmployees, L && L.emp)], ["事業所・施設", site], ["わかっている部署", depts.join("、")], ["わかっている役職", [...new Set(ppl.map((p) => p.title).filter(Boolean))].join("、")]]);
    const grpT = group.length > 1 ? tbl(["事業", "取引先名", "状態", "担当"], group.map((g) => [esc(g.biz), `<a href="${SFL}/Account/${esc(g.id)}/view" target="_blank" rel="noopener">${esc(g.name)}</a>`, esc(g.status), esc(g.owner)])) : "";
    // ===== 当社側の担当 =====
    const ours = kv([["Bales の架電担当", B.operatorName], ["次の予定の担当", nx && nx.owner && nx.owner.name !== B.operatorName ? nx.owner.name : ""], ["SF リードの所有者", L && L.owner], ["取引先の所有者", A && A.owner],
      ["商談の担当", [...new Set(opps.map((o) => o.owner).filter(Boolean))].join("、")], ["アポを取った人", [...new Set(opps.map((o) => o.apo).filter(Boolean))].join("、")], ["前の失注商談の所有者", H["失注商談所有者"]],
      ["MOCHICALL で掛けた人", [...new Set(calls.map((x) => x.caller).filter(Boolean))].join("、")]]);
    // ===== 架電の履歴（MOCHICALL）と MiiTel の商談 =====
    const callT = tbl(["日時", "掛けた人", "相手", "つながり", "結果", "メモ", "次"], calls.map((x) => [esc(ymdhm(x.created_at)), esc(x.caller), esc(x.person), esc(x.reach), esc([x.outcome, x.reason].filter(Boolean).join("：")), esc(x.memo), esc(ymdhm(x.apo_at || x.next_at))]));
    const mtT = mts && mts.length ? tbl(["日時", "商談", "担当"], mts.slice(0, 20).map((m) => [esc(ymdhm(m.at)), esc(m.title), esc(m.host)])) : "";
    return `${head}${!c ? '<div class="mc-note" style="margin-top:6px">SF を読んでいます…</div>' : ""}${c && c.sfError ? `<div class="bl-diag" style="margin-top:8px">${esc(c.sfError)}</div>` : ""}
      ${sec("会社の情報", "", info)}
      ${sec("商談の状態", opps.length ? `SF の商談 ${opps.length}件` : c ? "SF の商談なし" : "", state + (oppT ? `<div class="bl-h4">商談の一覧</div>${oppT}` : ""))}
      ${sec("先方の担当者", ppl.length ? `${ppl.length}人` : "", pplT)}
      ${sec("組織", group.length > 1 ? `同じ法人の取引先 ${group.length}件` : "", org + (grpT ? `<div class="bl-h4">同じ法人のほかの事業</div>${grpT}` : ""))}
      ${sec("当社側の担当", "", ours)}
      ${sec("架電の履歴（MOCHICALL）", calls.length ? `${calls.length}件` : "", callT)}
      ${sec("MiiTel の商談", mts && mts.length ? `${mts.length}件` : "", mtT)}`;
  }
  let sheetEl = null;
  function sheet(html) { closeSheet(); sheetEl = document.createElement("div"); sheetEl.className = "bl-sheet-bg"; sheetEl.innerHTML = `<div class="bl-sheet"><button type="button" class="bl-x" aria-label="閉じる">×</button><div class="bl-sheet-in">${html}</div></div>`;
    sheetEl.addEventListener("click", (e) => { if (e.target === sheetEl) closeSheet(); }); sheetEl.querySelector(".bl-x").addEventListener("click", closeSheet); document.body.appendChild(sheetEl); return sheetEl.querySelector(".bl-sheet-in"); }
  function closeSheet() { if (sheetEl) { sheetEl.remove(); sheetEl = null; } }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
  // 拡張機能から最後に届いた様子：取り込めないときに、どこで止まったかを見る（2026-11-15）
  function diagHtml() {
    if (!diag) return '<div class="bl-diag"><b>拡張機能の様子</b>拡張機能からまだ何も届いていません。kinbot-ext を 2.2.3 に入れ直し、kinbot の画面を一度開いてから、Bales のリード一覧で右下の「kinbot に取り込む」を押してください。ボタンが出ないときは、拡張機能が古いか、入っていません。</div>';
    const why = diag.nohook ? "Bales のページの中で、一覧を読む部分が動いていませんでした（ページを読み込み直すと動きます）。" : diag.cands.length ? `一覧らしいデータが ${diag.cands.length} 個見えています。` : "一覧らしいデータが見つかりませんでした。下の通り道を見て直します。";
    return `<div class="bl-diag"><b>拡張機能の様子</b>${esc(dt(diag.at))} ・ 版 ${esc(diag.ver || "?")} ・ ${esc(diag.href)}<br>${esc(why)}
      ${diag.cands.length ? `<div class="bl-dl">${diag.cands.map((c) => `<div>${esc(c.ep)} … ${c.n}件${c.total != null ? `／全${c.total}` : ""}${c.pager ? `（めくり：${esc(c.pager)}）` : "（めくり方不明）"}<small>${esc(c.keys.join(", "))}</small></div>`).join("")}</div>` : ""}
      ${diag.seen.length ? `<details><summary>見えた通り道（${diag.seen.length}）</summary><div class="bl-dl">${diag.seen.map((x) => `<div>${esc(x.ep)} <small>${x.status || ""} ${esc(x.ct)} ${x.len >= 0 ? x.len + "文字" : ""} ${x.arr >= 0 ? "並び" + x.arr : ""}</small></div>`).join("")}</div></details>` : ""}</div>`;
  }
  window.mcBalesView = load;
})();
