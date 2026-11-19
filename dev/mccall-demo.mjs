// MOCHICALL（SHOBO の架電画面）のデモ HTML を作る（2026-11-16）
//   本物の public/mccall.css と public/mccall.js をそのまま埋め込み、通信（fetch）だけをダミーに差し替える。
//   サーバーもデータベースもいらない。できたファイルをブラウザで開くだけで、記録→次の企業への流れを試せる。
//
//   使い方：node dev/mccall-demo.mjs   → dev/mccall_デモ.html ができる
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const css = readFileSync(path.join(root, "public/mccall.css"), "utf8");
const js = readFileSync(path.join(root, "public/mccall.js"), "utf8");

// ブラウザの中で動くダミーのサーバー。記録すると状態が変わる（次の企業へ進む・元に戻すで戻る）
const mock = String.raw`
(function () {
  const REACH = {
    none: { label: "つながらない", outcomes: { no_answer: "応答なし", busy: "話し中", voicemail: "留守電", invalid: "番号が使えない" } },
    gate: { label: "受付まで", outcomes: { absent: "担当者が不在", blocked: "受付で断られた", callback_req: "掛け直しを指定された" } },
    person: { label: "担当者と話せた", outcomes: { apo: "アポ獲得", doc_send: "資料を送る", follow: "また話す（フォロー）", reject: "断られた" } },
  };
  const label = (o) => { for (const r of Object.values(REACH)) if (r.outcomes[o]) return r.outcomes[o]; return o; };
  const now = Date.now(); const ago = (h) => new Date(now - h * 3600e3).toISOString();
  const LEADS = [
    { id: 1, company: "株式会社ベルク", person: "町田", hot: 3, attempts: 2, phone: "03-1234-5678", phone2: "03-5555-0000", next_at: ago(0.2), next_why: "受付で聞いた「午後」に掛け直し", gate: { name: "町田", hours: "午後", direct: "" },
      sf: { status: "失注", owner: "中澤 良太", 失注理由大: "時期", 検討開始時期: "2027年4月" }, sum: { n: 2, lost: true },
      tl: [{ at: ago(48), src: "kinbot", who: "福井聖", title: "担当者が不在", text: "受付で聞けたこと：担当 町田・在席 午後" },
           { at: ago(150), src: "Bales", who: "大沢", title: "コール", text: "受付で、採用は人事部の町田さんが担当とのこと。今期は中途採用を増やす予定。資料が欲しいと言われたので後日送付。" },
           { at: "2026-09-02", src: "SF", who: "中澤 良太", title: "商談：失注", text: "【新/ヒ】株式会社ベルク　町田様" }],
      summary: "11/14 福井聖 担当者が不在 → 担当は町田さん・午後なら在席 → 11/16 14:00 に再架電" },
    { id: 2, company: "合同会社サンライズ", person: "人事部 ご担当者", hot: 1, attempts: 0, phone: "06-9876-5432", cross: true, data: { list_name: "DOC 9月 失注", assigned_to: "植野 大輔", industry: "小売" },
      tl: [{ at: "2026-09-12", src: "SF", who: "植野 大輔", title: "商談：失注", text: "DOC：時期が合わず失注" }], summary: "" },
    { id: 3, company: "株式会社コロンバン", person: "宮村", hot: 2, attempts: 1, phone: "045-111-2222", docAlso: true,
      tl: [{ at: ago(30), src: "Bales", who: "大沢", title: "コール", text: "宮村様 不在。夕方なら戻るとのこと" }], summary: "" },
    { id: 4, company: "株式会社みらい食品", person: "", hot: 0, attempts: 0, phone: "092-333-4444", tl: [], summary: "" },
    { id: 5, company: "テスト工業株式会社", person: "佐々木", hot: 3, attempts: 3, phone: "011-222-3333", gate: { name: "佐々木", hours: "午前", direct: "内線 205" },
      sf: { status: "ナーチャリング", owner: "中澤 良太", 顧客の課題感: "応募が少ない", 検討開始時期: "2026年12月" }, sum: { n: 1 },
      tl: [{ at: ago(72), src: "kinbot", who: "江田 直人", title: "また話す（フォロー）", text: "12月に予算が決まる。来週もう一度" }], summary: "11/13 江田 直人 また話す（フォロー） → 担当は佐々木さん・午前なら在席・直通あり" },
  ];
  LEADS.forEach((l) => { l.done = false; l.logs = []; });
  let stats = { calls: 12, person: 3, apo: 1, cross: 0 }; let seq = 100; const LOGS = new Map();
  const lists = [{ id: 1, name: "11月 ホット企業", members: [], total: 120, open: 98, now: 3, cross: 0 }, { id: 2, name: "DOC 失注から MOCHICA 提案", members: ["eda@example.jp"], total: 40, open: 40, now: 0, cross: 40 }];
  const due = (l) => !l.done && (!l.next_at || new Date(l.next_at).getTime() <= Date.now());
  function lead(l) {
    const tl = l.logs.concat(l.tl);
    return { ok: true, lead: { id: l.id, list_id: 1, company: l.company, person: l.person, hot: l.hot, attempts: l.attempts, phone: l.phone, gate: l.gate || null, next_at: l.next_at || null, next_why: l.next_why || null,
        cross_from: l.cross ? "DOC" : null, cross_id: l.cross ? 1 : null, src: l.cross ? "doc" : "bales", data: l.data || { lastActivityAt: ago(30), lastActivityTypeText: "コール", operatorName: "大沢" } },
      ban: null, docAlso: l.docAlso ? [{ list: "doda 掲載中", assigned_to: "田中 遼" }] : [],
      phones: [{ label: "代表", number: l.phone, n: l.attempts + 2, reached: 1, invalid: false, last: l.attempts ? "担当者が不在" : "", lastAt: l.attempts ? "11/14 15:30" : "" }]
        .concat(l.phone2 ? [{ label: "電話2", number: l.phone2, n: 2, reached: 0, invalid: true, last: "番号が使えない", lastAt: "11/10 11:00" }] : []),
      summary: l.summary, sf: l.sf ? { lead: l.sf, sum: l.sum || null } : null,
      cross: l.cross ? { from_name: "DOC 9月 失注", reason: "DOC で失注した企業に MOCHICA を提案するため", at: ago(30) } : null,
      timeline: tl };
  }
  function api(p, q, b) {
    let m;
    if (p === "/api/mccall/meta") return { ok: true, reach: REACH, rejectReasons: ["今は必要ない", "他社を使っている", "時期が合わない", "予算が無い", "採用の予定が無い", "その他"], admin: true, me: "demo@example.jp" };
    if (p === "/api/mccall/lists") { if (b && b.name) { lists.unshift({ id: ++seq, name: b.name, members: b.members || [], total: 0, open: 0, now: 0, cross: 0 }); return { ok: true }; } return { ok: true, admin: true, items: lists }; }
    if (p === "/api/mccall/stats") return { ok: true, me: stats, all: [{ name: "あなた（デモ）", ...stats }, { name: "江田 直人", calls: 52, person: 11, apo: 1, cross: 0 }] };
    if (p === "/api/mccall/queue") { const items = LEADS.filter(due).sort((a, b) => (!!b.next_at - !!a.next_at) || (b.hot - a.hot)); return { ok: true, later: LEADS.filter((l) => !l.done && !due(l)).length, items: items.map((l) => ({ id: l.id, company: l.company, hot: l.hot, next_at: l.next_at || null, next_why: l.next_why || null, cross_from: l.cross ? "DOC" : null })) }; }
    if (p === "/api/mccall/cross") return { ok: true, moves: [{ at: ago(30), by: "田中欽也", from_name: "DOC 9月 失注", to_name: "DOC 失注から MOCHICA 提案", count: 40, calls: 6 + stats.cross, apo: 1, reason: "DOC で失注した企業に MOCHICA を提案するため" }],
      calls: [{ created_at: ago(2), caller: "江田 直人", company: "合同会社サンライズ", outcome: "担当者が不在", from_name: "DOC 9月 失注" }] };
    if (p === "/api/mccall/doc/lists") return { ok: true, items: [{ id: 11, name: "DOC 9月 失注", open: 112 }, { id: 12, name: "doda 掲載中", open: 840 }] };
    if (p === "/api/mochica/reps") return { ok: true, items: [{ email: "a@example.jp", name: "福井 聖", mochica: true }, { email: "b@example.jp", name: "山下 彩", mochica: true }, { email: "eda@example.jp", name: "江田 直人", mochica: false }] };
    if (p === "/api/mochica/bales/lists") return { ok: true, items: [{ list_key: "bales:all", name: "すべてのリード", count: 23394, status: "done" }] };
    if (/\/from-bales$/.test(p)) return { ok: true, added: Number(b.limit || 300), banned: 3, skipped: 12 };
    if (/\/from-doc$/.test(p)) { if (!b.reason) return [400, { error: "部署をまたぐ理由を入れてください" }]; return { ok: true, added: 112, banned: 1, skipped: 0 }; }
    if ((m = p.match(/^\/api\/mccall\/leads\/(\d+)$/))) { const l = LEADS.find((x) => x.id === +m[1]); return l ? lead(l) : [404, { error: "見つかりません" }]; }
    if ((m = p.match(/^\/api\/mccall\/leads\/(\d+)\/gate$/))) { const l = LEADS.find((x) => x.id === +m[1]); l.gate = { name: b.name, hours: b.hours, direct: b.direct }; return { ok: true, gate: l.gate }; }
    if ((m = p.match(/^\/api\/mccall\/leads\/(\d+)\/clear-next$/))) { const l = LEADS.find((x) => x.id === +m[1]); l.next_at = null; l.next_why = null; return { ok: true }; }
    if ((m = p.match(/^\/api\/mccall\/leads\/(\d+)\/log$/))) {
      const l = LEADS.find((x) => x.id === +m[1]);
      if (b.outcome === "reject" && !b.reason) return [400, { error: "断られた理由を選んでください" }];
      const prev = JSON.parse(JSON.stringify({ next_at: l.next_at, next_why: l.next_why, done: l.done, attempts: l.attempts, gate: l.gate, summary: l.summary }));
      let next = b.nextAt, why = next ? "記録した人が決めた時刻" : null;
      if (!next && ["no_answer", "busy", "voicemail", "absent"].includes(b.outcome) && !b.noRetry) { const t = new Date(Date.now() + 2 * 3600e3); const lim = new Date(); lim.setHours(18, 30, 0, 0); if (t <= lim) { next = t.toISOString(); why = "同じ日のうちに掛け直すとつながりやすいため、2時間後に掛け直し"; } else { const d = new Date(); d.setDate(d.getDate() + 1); while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); next = d.toISOString(); why = "今日はもう遅いので、次の平日の朝に掛け直し"; } }
      l.next_at = next || null; l.next_why = why; l.done = ["invalid", "apo", "reject"].includes(b.outcome) || (b.outcome === "doc_send" && !next); l.attempts++;
      if (b.gate && (b.gate.name || b.gate.hours || b.gate.direct)) l.gate = b.gate;
      const id = ++seq; const t = { at: new Date().toISOString(), src: "kinbot", who: "あなた（デモ）", title: label(b.outcome) + (b.reason ? "（" + b.reason + "）" : ""), text: [b.memo, next ? "次回 " + new Date(next).toLocaleString("ja-JP") : ""].filter(Boolean).join("\n"), mine: true, logId: id, cross: !!l.cross };
      l.logs.unshift(t); l.summary = "今日 あなた " + t.title + (next ? " → " + new Date(next).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) + " に再架電" : "");
      stats.calls++; if (b.reach === "person") stats.person++; if (b.outcome === "apo") stats.apo++; if (l.cross) stats.cross++;
      LOGS.set(id, { l, prev, b });
      return { ok: true, logId: id, nextAt: next || null, why, done: l.done };
    }
    // 資料送付とアポのおすすめ日時（2026-11-17）
    const DOCS = [{ id: 1, name: "MOCHICA サービス資料" }, { id: 2, name: "MOCHICA 導入事例集" }];
    if (p === "/api/mccall/doc-settings") return { ok: true, admin: true, docs: DOCS, subject: "資料のご送付（{資料名}）", body: "{担当者}様\n\nお世話になっております。MOCHICA の{差出人}です。\n先ほどお電話にてご案内した資料をお送りいたします。\n\n{URL}", defaultDocId: "", cc: "" };
    if ((m = p.match(/^\/api\/mccall\/leads\/(\d+)\/doc\/preview$/))) {
      const l = LEADS.find((x) => x.id === +m[1]); const d = DOCS.find((x) => x.id === Number(b.docId)) || DOCS[0]; const who = (l.gate && l.gate.name) || l.person || "ご担当者";
      const url = "https://kinbot.example/d/demo" + d.id;
      return { ok: true, to: l.id === 1 ? "machida@belc.example.jp" : "", cc: "", company: l.company, person: who, docId: d.id, docName: d.name, url, docs: DOCS, google: true,
        subject: "資料のご送付（" + d.name + "）", body: who + "様\n\nお世話になっております。MOCHICA のあなた（デモ）です。\n先ほどお電話にてご案内した資料をお送りいたします。\n下記の URL よりご確認ください。\n\n" + url + "\n\nご不明な点がございましたら、お気軽にご連絡ください。\n何卒よろしくお願いいたします。",
        warn: l.id === 1 ? "" : "この会社のメールアドレスが見つかりませんでした。宛先を入れてください" };
    }
    if ((m = p.match(/^\/api\/mccall\/leads\/(\d+)\/doc\/send$/))) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.to || ""))) return [400, { error: "宛先のメールアドレスを正しく入れてください" }];
      const l = LEADS.find((x) => x.id === +m[1]); l.tl.unshift({ at: new Date().toISOString(), src: "kinbot", who: "あなた（デモ）", title: "資料送付", text: b.to + " に送付\n資料：" + (b.docName || "") });
      return { ok: true, to: b.to, sf: "" };
    }
    const slotAt = (addDays, h, mi) => { const d = new Date(); d.setDate(d.getDate() + addDays); while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1); d.setHours(h, mi || 0, 0, 0); return d; };
    const slot = (d, free) => ({ at: d.toISOString(), md: (d.getMonth() + 1) + "/" + d.getDate(), dow: "日月火水木金土"[d.getDay()], time: String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"), band: d.getHours() < 12 ? "午前" : "午後", free, freeN: free.length, total: 3 });
    if (p === "/api/mccall/slots") return { ok: true, members: ["山下 彩", "本炭 健", "齊藤 誠"], unread: [], slots: [
      slot(slotAt(1, 10), ["山下 彩", "本炭 健", "齊藤 誠"]), slot(slotAt(1, 14), ["山下 彩", "齊藤 誠"]), slot(slotAt(2, 11), ["本炭 健", "齊藤 誠"]), slot(slotAt(2, 15), ["山下 彩"]),
      slot(slotAt(3, 10), ["山下 彩", "本炭 健"]), slot(slotAt(3, 16), ["山下 彩", "本炭 健", "齊藤 誠"]), slot(slotAt(8, 10), ["齊藤 誠"]), slot(slotAt(8, 13), ["山下 彩", "本炭 健"]) ] };
    if (p === "/api/mccall/slots/day") { const base = new Date(q.get("date") + "T00:00:00"); const out = []; for (let h = 9; h < 18; h += 1.5) { const d = new Date(base); d.setHours(Math.floor(h), (h % 1) * 60, 0, 0); out.push(slot(d, h < 12 ? ["山下 彩", "本炭 健"] : ["齊藤 誠"])); } return { ok: true, slots: out, members: ["山下 彩", "本炭 健", "齊藤 誠"] }; }
    if ((m = p.match(/^\/api\/mccall\/logs\/(\d+)\/undo$/))) {
      const g = LOGS.get(+m[1]); if (!g) return [404, { error: "この記録は見つからないか、もう取り消してあります" }];
      Object.assign(g.l, g.prev); g.l.logs = g.l.logs.filter((t) => t.logId !== +m[1]); LOGS.delete(+m[1]);
      stats.calls--; if (g.b.reach === "person") stats.person--; if (g.b.outcome === "apo") stats.apo--;
      return { ok: true, leadId: g.l.id, sf: "SF の活動も消しました（デモ）" };
    }
    return { ok: true };
  }
  window.fetch = async (u, o = {}) => {
    const url = new URL(u, "http://demo.local"); let body = null; try { body = o.body ? JSON.parse(o.body) : null; } catch {}
    if (o.method === "PATCH") { const id = +url.pathname.split("/").pop(); const l = lists.find((x) => x.id === id); if (l) { if (body.closed) lists.splice(lists.indexOf(l), 1); if (body.members) l.members = body.members; } }
    let r = api(url.pathname, url.searchParams, body || {}); let status = 200;
    if (Array.isArray(r)) { status = r[0]; r = r[1]; }
    await new Promise((res) => setTimeout(res, 80));
    return new Response(JSON.stringify(r), { status, headers: { "content-type": "application/json" } });
  };
  navigator.sendBeacon = () => true;
  // デモでは Zoom アプリを開かない（押したら知らせるだけ）
  document.addEventListener("click", (e) => { const a = e.target.closest && e.target.closest('a[href^="zoomphonecall:"]'); if (a) { e.preventDefault(); const t = document.getElementById("demoCall"); t.textContent = "デモ：Zoom Phone で " + a.getAttribute("href").replace("zoomphonecall://", "") + " に発信します（本番では Zoom アプリが開きます）"; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), 2500); } }, true);
})();
`;

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>MOCHICA 架電デモ</title>
<style>
  :root{color-scheme:light;}
  body{margin:0;font-family:"Hiragino Sans","Noto Sans JP","Yu Gothic UI",sans-serif;background:#F2F9FA;color:#12292C;}
  .demo-app{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:100vh;}
  .demo-side{background:linear-gradient(180deg,#0F3D44 0%,#082429 100%);color:#A8E8EE;padding:20px 12px;}
  .demo-side b{display:block;color:#fff;font-size:17px;margin:0 8px 20px;} .demo-side b small{color:#5EEAD4;font-size:12px;margin-left:4px;}
  .demo-side span{display:block;padding:10px 14px;border-radius:12px;font-size:14px;font-weight:700;margin-bottom:4px;}
  .demo-side span.on{background:rgba(94,234,212,.16);color:#5EEAD4;}
  .demo-main{padding:16px 24px;min-width:0;}
  .demo-top{display:flex;align-items:center;gap:12px;margin-bottom:8px;}
  .demo-top h1{font-size:18px;margin:0;} .demo-top em{font-style:normal;font-size:12px;font-weight:800;color:#A2480C;background:#FFF1E6;border-radius:99px;padding:3px 10px;}
  .demo-top p{margin:0 0 0 auto;font-size:12px;color:#5C7377;}
  #demoCall{position:fixed;top:16px;left:50%;transform:translateX(-50%);background:#0B6E78;color:#fff;border-radius:12px;padding:10px 16px;font-size:13px;font-weight:700;z-index:80;}
  @media (max-width:900px){.demo-app{grid-template-columns:1fr;}.demo-side{display:none;}}
${css}
  .mcc{height:calc(100vh - 72px);}
</style>
</head>
<body>
<div class="demo-app">
  <nav class="demo-side"><b>kinbot<small>SHOBO</small></b><span>商談（MiiTel）</span><span>リスト（Bales Cloud）</span><span class="on">架電</span><span>アポイント</span></nav>
  <main class="demo-main">
    <div class="demo-top"><h1>架電</h1><em>デモ（ダミーデータ・どこにも保存しません）</em><p>数字キーで選ぶ → Enter で記録して次へ。? でキーの一覧</p></div>
    <section data-pane="call"><div id="mcCallView"></div></section>
  </main>
</div>
<div id="demoCall" hidden></div>
<script>${mock}</script>
<script>${js}</script>
<script>window.mcCallView();</script>
</body>
</html>
`;
const out = path.join(root, "dev", "mccall_デモ.html");
writeFileSync(out, html);
console.log("作りました：" + out);

// URL で見せる用（claude.ai の Artifact）。外側の <html>・<head>・<body> は向こうで付くので外した形も作る
//   使い方：node dev/mccall-demo.mjs <出力先のパス>
if (process.argv[2]) {
  const frag = html
    .replace(/<!DOCTYPE html>\n?/i, "").replace(/<\/?html[^>]*>\n?/gi, "").replace(/<\/?head>\n?/gi, "").replace(/<\/?body>\n?/gi, "")
    .replace(/<meta charset="UTF-8" \/>\n?/i, "").replace(/<meta name="viewport"[^>]*>\n?/i, "");
  writeFileSync(process.argv[2], frag);
  console.log("URL 用も作りました：" + process.argv[2]);
}
