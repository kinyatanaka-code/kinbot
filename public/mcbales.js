// kinbot for MOCHICA：Bales のリスト（拡張機能が Bales の画面から取り込んだもの）を見る（2026-11-15 田中さん）
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
  const colsKey = (k) => "kb_bales_cols_" + k;
  const savedCols = (k) => { try { return JSON.parse(localStorage.getItem(colsKey(k)) || "null"); } catch { return null; } };
  // 値の取り出し：「a.[].b」は配列の全部（a.0.b、a.1.b…）をつなげる。日時は Bales と同じ「11/13 10:31」に
  const valOf = (d, key) => { if (!String(key).includes("[]")) return d[key]; const re = new RegExp("^" + key.split("[]").map((x) => x.replace(/[.*+?^${}()|\\]/g, "\\$&")).join("\\d+") + "$"); return Object.keys(d).filter((k) => re.test(k)).sort((a, b) => a.localeCompare(b, "en", { numeric: true })).map((k) => d[k]).filter((v) => v !== "" && v != null).join("、"); };
  const fmt = (v) => { const t = String(v ?? ""); if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(t)) { const x = new Date(t); if (!isNaN(x)) { const p = (n) => String(n).padStart(2, "0"); return `${p(x.getMonth() + 1)}/${p(x.getDate())} ${p(x.getHours())}:${p(x.getMinutes())}`; } } return t; };
  const pickCols = (cols, k, view) => {
    const sv = k && savedCols(k); if (sv && sv.length) return sv.map((x) => typeof x === "string" ? { key: x, label: (view || []).find((v) => v.key === x)?.label || labelOf(x) } : x);
    if (view && view.length) return view.map((v) => ({ key: v.key, label: v.label }));   // Bales の一覧と同じ並び・見出し
    // わかる項目を順に（同じ言葉は1つだけ）→ 足りなければよく埋まっている項目
    const out = [], used = new Set();
    for (const [, l, ord] of LABELS) { const c = (cols || []).find((x) => labelOf(x.key) === l && !/id$/i.test(x.key)); if (c && !used.has(l)) { out.push({ ...c, label: l, ord }); used.add(l); } }
    out.sort((a, b) => a.ord - b.ord);
    for (const c of cols || []) { if (out.length >= 6) break; if (out.some((x) => x.key === c.key) || /(^|\.)(id|_id|uuid)$/i.test(c.key)) continue; out.push({ ...c, label: labelOf(c.key) }); }
    return out.slice(0, 6);
  };
  const coNorm = (s) => String(s || "").normalize("NFKC").replace(/株式会社|有限会社|合同会社|一般社団法人|一般財団法人|社会福祉法人|医療法人|学校法人|\(株\)|㈱|（株）|\s/g, "").toLowerCase();
  let feeds = [], fday = "", wdiag = null, diag = null, lists = [], cur = null, q = "", fcol = "", fval = "", page = 0, poll = null, mtCos = null;
  const PER = 100;

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
      <div class="bl-how"><b>取り込み方</b>Bales のリスト（<a href="https://mochica.balescloud.jp/app/lead-list" target="_blank" rel="noopener">リード一覧</a>）を開き、右下の「kinbot に取り込む」→「全部取り込む」。拡張機能 kinbot-ext（2.0.3 以上）が要ります。</div>
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
    const view = f.view || []; const vk = (re) => (view.find((v) => re.test(v.label)) || {}).key;
    const kWho = vk(/担当|架電者|ユーザー|所有者|オペレーター|コール者|発信者|実施者/), kRes = vk(/結果|ステータス/), kCo = vk(/会社/), kT = r.tkey;
    const it = r.items.map((d) => ({ d, who: kWho ? String(valOf(d, kWho) || "（不明）") : "（不明）", res: kRes ? String(valOf(d, kRes) || "（なし）") : "", co: kCo ? String(valOf(d, kCo) || "") : "", t: kT ? new Date(d[kT]) : null })).sort((a, b) => (b.t || 0) - (a.t || 0));
    const cnt = (arr, k) => { const m = new Map(); for (const x of arr) m.set(x[k], (m.get(x[k]) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
    const people = cnt(it, "who"); const results = kRes ? cnt(it, "res") : [];
    const hm = (t) => (t && !isNaN(t) ? `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}` : "");
    const hours = Array.from({ length: 11 }, (_, i) => 9 + i).map((h) => [h, it.filter((x) => x.t && x.t.getHours() === h).length]); const hmax = Math.max(1, ...hours.map((h) => h[1]));
    const shift = (n) => { const d = new Date(`${fday}T00:00:00+09:00`); d.setTime(d.getTime() + n * 86400000); fday = jstDay(d.getTime()); feedDetail(); };
    const resChips = (arr) => arr.map(([k, n]) => `<span class="bl-rc">${esc(k)} <b>${n}</b></span>`).join("");
    box.innerHTML = `<div class="bl-head"><div><h3>${esc(f.name)}</h3><small>${f.last_sync ? `最後に読んだ：${esc(dt(f.last_sync))}（新しい ${f.last_new || 0}件）・平日10〜19時に10分ごと` : "まだ読んでいません"}</small></div>
        <div class="bl-acts"><button type="button" class="mt-btn ghost" data-dd="-1">前の日</button><input type="date" class="bl-date" data-day value="${fday}"><button type="button" class="mt-btn ghost" data-dd="1">次の日</button><button type="button" class="mt-btn ghost" data-dd="0">今日</button><button type="button" class="mt-btn ghost bl-del" data-fdel>外す</button></div></div>
      <div class="bl-mets"><div><small>架電の数</small><b>${it.length.toLocaleString()}</b></div><div><small>架電した人</small><b>${people.length}</b></div><div><small>架電した会社</small><b>${new Set(it.map((x) => x.co).filter(Boolean)).size.toLocaleString()}</b></div><div><small>結果の種類</small><b>${results.length}</b></div><div><small>見張りの全部</small><b>${Number(f.total || 0).toLocaleString()}</b></div></div>
      ${!kT ? '<div class="bl-diag">時刻の見出し（日時など）が見つからなかったので、kinbot が初めて見た時刻で日を分けています。</div>' : ""}
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
    let r; try { r = await api(`/api/mochica/bales/lists/${encodeURIComponent(cur)}/rows?q=${encodeURIComponent(q)}&col=${encodeURIComponent(fcol)}&val=${encodeURIComponent(fval)}&offset=${page * PER}&limit=${PER}`); } catch (e) { box.innerHTML = `<div class="mc-note">読めませんでした：${esc(e.message)}</div>`; return; }
    if ($("blMain") !== box) return;
    let vals = []; if (stCol) { try { vals = (await api(`/api/mochica/bales/lists/${encodeURIComponent(cur)}/values?col=${encodeURIComponent(stCol.key)}`)).items || []; } catch {} }
    const diff = l.prev_count != null && l.status !== "running" ? l.count - l.prev_count : null;
    const hasMt = (d) => coCol && mtCos && mtCos.get(coNorm(valOf(d, coCol.key)));
    const csvQ = `q=${encodeURIComponent(q)}&col=${encodeURIComponent(fcol)}&val=${encodeURIComponent(fval)}`;
    box.innerHTML = `<div class="bl-head"><div><h3>${esc(l.name || l.list_key)}</h3><small>最後に取り込んだ日時：${l.status === "running" ? "取り込み中" : esc(dt(l.done_at || l.run_at))}${l.error ? ` ・ ${esc(l.error)}` : ""}</small></div>
        <div class="bl-acts"><a class="mt-btn ghost" href="https://mochica.balescloud.jp/app/lead-list" target="_blank" rel="noopener">取り込み直す ↗</a><a class="mt-btn ghost" href="/api/mochica/bales/lists/${encodeURIComponent(cur)}/csv?${csvQ}">CSV</a><button type="button" class="mt-btn" data-sf>${l.sf_info ? "SF と結び直す" : "SF と結びつける"}</button><button type="button" class="mt-btn ghost bl-del" data-del>消す</button></div></div>
      <div class="bl-sfst" data-sfst>${l.sf_info ? `SF：${l.sf_info.byName != null ? `SalesforceID で ${Number(l.sf_info.byId || 0).toLocaleString()}件・会社名で ${Number(l.sf_info.byName || 0).toLocaleString()}件` : `SalesforceID あり ${Number(l.sf_info.withId || 0).toLocaleString()}件`} → SF で見つかった ${Number(l.sf_info.linked || 0).toLocaleString()}件・過去の商談あり ${Number(l.sf_info.withOpps || 0).toLocaleString()}件（${esc(dt(l.sf_info.at))}）` : ""}</div>
      ${l.w_n ? `<div class="bl-sfst">Bales に書き込んだ（SF の失注情報など）：${Number(l.w_n).toLocaleString()}件</div>` : ""}
      ${wdiag && !wdiag.ok ? `<details class="bl-diag" style="margin-top:6px"><summary>Bales への書き込み方を覚えられませんでした（${esc(dt(wdiag.at))}）</summary>${esc(wdiag.reason)}<div class="bl-dl">${esc(wdiag.method)} ${esc(wdiag.url)}<br>${esc(wdiag.shape)}</div></details>` : ""}
      <div class="bl-mets"><div><small>会社</small><b>${Number(l.status === "running" ? l.got : l.count || 0).toLocaleString()}</b></div><div><small>MOCHICA の商談あり</small><b data-mtn>—</b></div><div><small>前回から</small><b>${diff == null ? "—" : (diff >= 0 ? "+" : "") + diff.toLocaleString()}</b></div><div><small>詳しい中身（架電履歴など）</small><b>${Number(l.detail_n || 0).toLocaleString()}</b></div><div><small>SF と結びついた</small><b>${Number(l.sf_n || 0).toLocaleString()}</b></div></div>
      <div class="bl-find"><input type="search" data-q value="${esc(q)}" placeholder="会社名・名前・電話番号で探す"><button type="button" class="mt-btn ghost" data-colsel>表示項目</button>${stCol ? `<select data-f><option value="">${esc(stCol.label)}：すべて</option>${vals.map((v) => `<option value="${esc(v.v)}" ${fcol === stCol.key && fval === v.v ? "selected" : ""}>${esc(v.v)}（${v.n}）</option>`).join("")}</select>` : ""}</div>
      ${cols.length ? `<div class="bl-tbl"><table><thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join("")}<th>SF</th></tr></thead><tbody>
        ${r.rows.map((d) => `<tr class="bl-row" data-row="${esc(d.__k)}">${cols.map((c, i) => `<td title="${esc(valOf(d, c.key))}">${i === 0 && hasMt(d) ? `<button type="button" class="bl-mt" data-co="${esc(hasMt(d))}" title="MOCHICA の会社カードへ"><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="3" fill="#1d9e75"/><rect x="5" y="6" width="2" height="2" rx=".6" fill="#fff"/><rect x="9" y="6" width="2" height="2" rx=".6" fill="#fff"/><rect x="5" y="10" width="6" height="2" rx=".6" fill="#fff"/></svg></button>` : ""}${/^https?:\/\//.test(valOf(d, c.key) || "") ? `<a href="${esc(valOf(d, c.key))}" target="_blank" rel="noopener">${esc(valOf(d, c.key))}</a>` : esc(fmt(valOf(d, c.key)))}</td>`).join("")}<td>${sfChip(d.__sf)}</td></tr>`).join("") || `<tr><td colspan="${cols.length + 1}" class="mc-note">当てはまる会社がありません。</td></tr>`}
        </tbody></table></div>` : '<div class="mc-note">まだ行がありません。</div>'}
      <div class="bl-pg"><span>${r.total ? `${(page * PER + 1).toLocaleString()}〜${Math.min(r.total, (page + 1) * PER).toLocaleString()} / ${r.total.toLocaleString()}件` : ""}</span>${page > 0 ? '<button type="button" class="mt-btn ghost" data-pg="-1">前へ</button>' : ""}${(page + 1) * PER < r.total ? '<button type="button" class="mt-btn ghost" data-pg="1">次へ</button>' : ""}</div>
      ${coCol ? '<p class="mc-note" style="margin-top:6px">緑の印＝MOCHICA に商談がある会社。押すとその会社カードへ。</p>' : ""}`;
    // 商談ありの数は、今の絞り込みの全件で数える（会社名だけ読む）
    (async () => { const el = box.querySelector("[data-mtn]"); if (!el || !coCol || !mtCos) return; try { let n = 0; for (let off = 0; ; off += 5000) { const a = await api(`/api/mochica/bales/lists/${encodeURIComponent(cur)}/rows?offset=${off}&limit=5000`); n += a.rows.filter((d) => mtCos.get(coNorm(valOf(d, coCol.key)))).length; if (a.rows.length < 5000) break; } el.textContent = n.toLocaleString(); } catch { el.textContent = "—"; } })();
    let tm = null; const qi = box.querySelector("[data-q]"); qi.addEventListener("input", () => { clearTimeout(tm); tm = setTimeout(() => { q = qi.value.trim(); page = 0; detail().then(() => { const n = $("blMain").querySelector("[data-q]"); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, 400); });
    const fs = box.querySelector("[data-f]"); if (fs) fs.addEventListener("change", () => { fcol = fs.value ? stCol.key : ""; fval = fs.value; page = 0; detail(); });
    box.querySelectorAll("[data-pg]").forEach((b) => b.addEventListener("click", () => { page += Number(b.dataset.pg); detail(); }));
    box.querySelectorAll("[data-co]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); window.mcOpenCompany && window.mcOpenCompany(b.dataset.co); }));
    box.querySelectorAll("[data-row]").forEach((tr) => tr.addEventListener("click", () => leadSheet(l, tr.dataset.row)));
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
  // ===== リード1件の中身（取り込んだ項目すべて＋詳しい中身：架電履歴・カスタム情報など）=====
  const TPLN = [[/activit|action|history|timeline|log/i, "活動・架電の履歴"], [/call/i, "架電"], [/custom/i, "カスタム情報"], [/mail/i, "メール"], [/tag/i, "タグ"], [/source/i, "リードソース"], [/stage/i, "リードステージ"], [/sequence/i, "シーケンス"], [/comment|note|memo/i, "コメント"], [/deal|opportunit|商談/i, "商談"], [/contact|person/i, "担当者"]];
  const tplName = (k) => { for (const [re, n] of TPLN) if (re.test(k)) return `${n}（${k}）`; return k; };
  const flat1 = (o, pre = "", out = {}, d = 0) => { if (o == null) return out; if (Array.isArray(o)) { if (o.every((x) => x == null || typeof x !== "object")) out[pre] = o.join("、"); else if (d < 3) o.slice(0, 3).forEach((x, i) => flat1(x, `${pre}.${i}`, out, d + 1)); return out; } if (typeof o === "object") { if (d >= 4) { out[pre] = o.name != null ? o.name : JSON.stringify(o).slice(0, 200); return out; } for (const [k, v] of Object.entries(o)) flat1(v, pre ? `${pre}.${k}` : k, out, d + 1); return out; } out[pre] = o; return out; };
  const bigArr = (o, d = 0) => { if (Array.isArray(o)) return o.some((x) => x && typeof x === "object") ? o : null; if (!o || typeof o !== "object" || d > 4) return null; let b = null; for (const v of Object.values(o)) { const a = bigArr(v, d + 1); if (a && (!b || a.length > b.length)) b = a; } return b; };
  const kvGrid = (o) => { const f = Object.entries(o).filter(([k, v]) => !/^__/.test(k) && v !== "" && v != null); return f.length ? `<div class="bl-kv">${f.map(([k, v]) => `<div><small title="${esc(k)}">${esc(labelOf(k))}${labelOf(k) !== k ? ` <i>${esc(k)}</i>` : ""}</small><span>${esc(String(v)).slice(0, 2000)}</span></div>`).join("")}</div>` : '<div class="mc-note">空です。</div>'; };
  async function leadSheet(l, rid) {
    const sh = sheet('<div class="mc-note">読み込んでいます…</div>');
    let r; try { r = await api(`/api/mochica/bales/lists/${encodeURIComponent(l.list_key)}/rows/${encodeURIComponent(rid)}`); } catch (e) { sh.innerHTML = `<div class="mc-note">読めませんでした：${esc(e.message)}</div>`; return; }
    const d = r.data || {}; const coK = Object.keys(d).find((k) => labelOf(k) === "会社名"); const nmK = Object.keys(d).find((k) => labelOf(k) === "名前");
    const det = r.detail || null;
    const secs = det ? Object.entries(det).map(([k, v]) => { const arr = bigArr(v);
        if (arr && arr.length) { const rows = arr.slice(0, 200).map((x) => flat1(x)); const ks = []; for (const x of rows.slice(0, 30)) for (const kk of Object.keys(x)) if (!ks.includes(kk) && !/(^|\.)(id|_id|uuid|client_id)$/i.test(kk)) ks.push(kk);
          const show = ks.filter((kk) => rows.some((x) => x[kk] !== "" && x[kk] != null)).slice(0, 8);
          return `<details class="bl-sec" open><summary>${esc(tplName(k))}<small>${arr.length}件</small></summary><div class="bl-tbl"><table><thead><tr>${show.map((kk) => `<th title="${esc(kk)}">${esc(labelOf(kk))}</th>`).join("")}</tr></thead><tbody>${rows.map((x) => `<tr>${show.map((kk) => `<td title="${esc(x[kk])}">${esc(x[kk])}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`; }
        return `<details class="bl-sec"><summary>${esc(tplName(k))}</summary>${v && v._status ? `<div class="mc-note">読めませんでした（${v._status}）</div>` : kvGrid(flat1(v))}</details>`; }).join("") : '<div class="bl-diag">詳しい中身（架電履歴・カスタム情報など）はまだ取り込んでいません。Bales でリードを1件開いてから、右下の「kinbot に取り込む」→「詳しい中身も全部取り込む」を押すと入ります。</div>';
    sh.innerHTML = `<h3>${esc(d[coK] || "リード")}${nmK && d[nmK] ? `<small>（${esc(d[nmK])}）</small>` : ""}</h3>
      <a class="mt-btn ghost" style="text-decoration:none;display:inline-flex;margin:4px 0 10px" href="https://mochica.balescloud.jp/app/lead-list?callTargetId=${encodeURIComponent(rid)}" target="_blank" rel="noopener">Bales で開く ↗</a>
      ${l.view && l.view.length ? `<details class="bl-sec" open><summary>Bales の一覧の項目</summary><div class="bl-kv">${l.view.map((v) => `<div><small>${esc(v.label)}</small><span>${esc(fmt(valOf(d, v.key))) || "-"}</span></div>`).join("")}</div></details>` : ""}
      ${sfSec(r.sf)}
      <details class="bl-sec"><summary>取り込んだ全部の項目<small>${Object.keys(d).filter((k) => !/^__/.test(k)).length}項目</small></summary>${kvGrid(d)}</details>
      <div class="bl-h4">詳しい中身${r.detail_at ? `<small>${esc(dt(r.detail_at))} に取り込み</small>` : ""}</div>${secs}`;
  }
  const SFL = "https://ap10.lightning.force.com/lightning/r";
  function sfSec(x) {
    if (!x) return '<div class="bl-diag" style="margin-top:10px">SF とはまだ結びついていません。リストの上の「SF と結びつける」を押すと、SF のリードと過去の商談が入ります。</div>';
    if (x.none) return `<div class="bl-diag" style="margin-top:10px">${x.id ? `SF のリード（${esc(x.id)}）が見つかりませんでした。` : "SalesforceID が無く、会社名が同じ Mochica リードも SF に見つかりませんでした。"}</div>`;
    const L = x.lead || {}; const skip = new Set(["id", "name", "company", "status", "owner", "converted", "created"]);
    return `<details class="bl-sec" open><summary>Salesforce<small>${x.how ? `${esc(x.how)}で結びつけ・` : ""}${x.opps && x.opps.length ? `過去の商談 ${x.sum.n}件` : "過去の商談なし"}</small></summary>
      <div class="bl-sflinks"><a class="mt-btn ghost" href="${SFL}/Lead/${esc(L.id)}/view" target="_blank" rel="noopener">SF のリード ↗</a>${x.accountId ? `<a class="mt-btn ghost" href="${SFL}/Account/${esc(x.accountId)}/view" target="_blank" rel="noopener">取引先${x.account ? `（${esc(x.account)}）` : ""} ↗</a>` : ""}</div>
      <div class="bl-kv"><div><small>リードの状態</small><span>${esc(L.status) || "-"}${L.converted ? "（コンバート済み）" : ""}</span></div><div><small>リードの所有者</small><span>${esc(L.owner) || "-"}</span></div>
        ${Object.entries(L).filter(([k]) => !skip.has(k)).map(([k, v]) => `<div><small>${esc(k)}</small><span>${esc(v)}</span></div>`).join("")}</div>
      ${x.opps && x.opps.length ? `<div class="bl-h4" style="margin-top:12px">過去の商談</div><div class="bl-tbl"><table><thead><tr><th>商談日</th><th>商談名</th><th>段階</th><th>担当</th><th>アポ獲得</th><th>失注理由</th></tr></thead><tbody>
        ${x.opps.map((o) => `<tr><td>${esc(o.date)}</td><td><a href="${SFL}/Opportunity/${esc(o.id)}/view" target="_blank" rel="noopener">${esc(o.name)}</a>${o.type ? `<small class="bl-sub">${esc(o.type)}</small>` : ""}</td><td>${esc(o.stage)}</td><td>${esc(o.owner)}</td><td>${esc(o.apo)}</td><td title="${esc(o.detail)}">${esc(o.lost)}</td></tr>`).join("")}</tbody></table></div>` : ""}</details>`;
  }
  let sheetEl = null;
  function sheet(html) { closeSheet(); sheetEl = document.createElement("div"); sheetEl.className = "bl-sheet-bg"; sheetEl.innerHTML = `<div class="bl-sheet"><button type="button" class="bl-x" aria-label="閉じる">×</button><div class="bl-sheet-in">${html}</div></div>`;
    sheetEl.addEventListener("click", (e) => { if (e.target === sheetEl) closeSheet(); }); sheetEl.querySelector(".bl-x").addEventListener("click", closeSheet); document.body.appendChild(sheetEl); return sheetEl.querySelector(".bl-sheet-in"); }
  function closeSheet() { if (sheetEl) { sheetEl.remove(); sheetEl = null; } }
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
  // 拡張機能から最後に届いた様子：取り込めないときに、どこで止まったかを見る（2026-11-15）
  function diagHtml() {
    if (!diag) return '<div class="bl-diag"><b>拡張機能の様子</b>拡張機能からまだ何も届いていません。kinbot-ext を 2.0.3 に入れ直し、kinbot の画面を一度開いてから、Bales のリード一覧で右下の「kinbot に取り込む」を押してください。ボタンが出ないときは、拡張機能が古いか、入っていません。</div>';
    const why = diag.nohook ? "Bales のページの中で、一覧を読む部分が動いていませんでした（ページを読み込み直すと動きます）。" : diag.cands.length ? `一覧らしいデータが ${diag.cands.length} 個見えています。` : "一覧らしいデータが見つかりませんでした。下の通り道を見て直します。";
    return `<div class="bl-diag"><b>拡張機能の様子</b>${esc(dt(diag.at))} ・ 版 ${esc(diag.ver || "?")} ・ ${esc(diag.href)}<br>${esc(why)}
      ${diag.cands.length ? `<div class="bl-dl">${diag.cands.map((c) => `<div>${esc(c.ep)} … ${c.n}件${c.total != null ? `／全${c.total}` : ""}${c.pager ? `（めくり：${esc(c.pager)}）` : "（めくり方不明）"}<small>${esc(c.keys.join(", "))}</small></div>`).join("")}</div>` : ""}
      ${diag.seen.length ? `<details><summary>見えた通り道（${diag.seen.length}）</summary><div class="bl-dl">${diag.seen.map((x) => `<div>${esc(x.ep)} <small>${x.status || ""} ${esc(x.ct)} ${x.len >= 0 ? x.len + "文字" : ""} ${x.arr >= 0 ? "並び" + x.arr : ""}</small></div>`).join("")}</div></details>` : ""}</div>`;
  }
  window.mcBalesView = load;
})();
