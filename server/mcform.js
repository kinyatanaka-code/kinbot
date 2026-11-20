// 問い合わせフォームの自動送信（MOCHICALL・2026-11-20 福井さん「テレアポの選択肢に問い合わせを追加・問い合わせフォーム送信機能」）
//   受付や担当者に「HP の問い合わせフォームから送ってください」と言われたとき、会社の Web ページから
//   問い合わせページを探し、項目に当てはめて、見えないブラウザで人と同じように入力・送信する。
//   サイトごとに形が違うので、次のときは送らずに理由を返す（黙って失敗しない＝MOCHICA のルール）：
//     ・ロボット確認（reCAPTCHA の「私はロボットではありません」・hCaptcha・Cloudflare）がある
//     ・必須の欄に、何を入れればよいか分からないものがある
//     ・フォームが見つからない
//   送信のあとは「ありがとうございました／送信完了」などの文言で確かめ、見つからなければ「送れたか分からない」と返す。
//   ブラウザは playwright-core ＋ @sparticuz/chromium（csplatform.js と同じ部品。新しいライブラリは足さない）。

let _busy = Promise.resolve();
// 同時に2つ動かさない（ブラウザは重いので1つずつ）
function serial(fn) { const run = _busy.then(fn); _busy = run.catch(() => {}); return run; }

async function launch() {
  let pw, chromium;
  try { pw = await import("playwright-core"); } catch { throw new Error("ブラウザの部品（playwright-core）が入っていません"); }
  // 手元のパソコンで試すときは MC_FORM_CHROME_PATH（または CSP_CHROME_PATH）に Chrome の場所を入れる
  const own = process.env.MC_FORM_CHROME_PATH || process.env.CSP_CHROME_PATH;
  if (own) return pw.chromium.launch({ executablePath: own, headless: true });
  // Railway には Chromium が要るライブラリが無いので、@sparticuz/chromium に同梱のものを使う（csplatform.js と同じ理由）
  if (!process.env.AWS_LAMBDA_JS_RUNTIME && !process.env.AWS_EXECUTION_ENV) process.env.AWS_LAMBDA_JS_RUNTIME = "nodejs22.x";
  try { chromium = (await import("@sparticuz/chromium")).default; } catch { throw new Error("ブラウザの部品（@sparticuz/chromium）が入っていません"); }
  return pw.chromium.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
}

// 問い合わせページらしいリンク。採用・エントリーのフォームは営業の連絡先ではないので外す
const CONTACT_TX = /お問い?合わ?せ|問い?合わ?せ|お問合せ|ご相談|contact|inquiry|enquiry/i;
const CONTACT_HREF = /contact|inquiry|enquiry|toiawase|otoiawase|form/i;
const NOT_CONTACT = /recruit|saiyo|entry|career|job|採用|求人|エントリー|応募|mailto:|tel:|privacy|プライバシー/i;
const DONE_TX = /ありがとうございま|送信(が|を)?完了|送信いたしました|送信しました|送信されました|受け?付け?(い?たし)?ました|受付(が|を)?完了|お問い?合わ?せを受け|thank\s*you|thanks/i;
const ERR_TX = /入力してください|選択してください|必須項目です|正しく入力|入力に誤り|入力されていません|エラーがあります|is required|invalid/i;

// 欄の見出し・name などから、何を入れる欄かを決める（上から順に当てる）
function roleOf(f) {
  const t = `${f.label} ${f.name} ${f.id} ${f.placeholder}`.toLowerCase();
  if (f.tag === "textarea") return "message";
  if (f.type === "checkbox") return /同意|プライバシー|個人情報|privacy|agree|accept|規約|ポリシー|policy/.test(t) ? "agree" : "";
  if (f.type === "radio" || f.tag === "select") {
    if (/都道府県|pref/.test(t)) return "pref";
    return "choice";
  }
  if (/fax|ファックス|ファクス/.test(t)) return "";
  if (f.type === "email" || /mail|メール/.test(t)) return /確認|再入力|もう一度|confirm|again|re_?mail|mail_?(2|re|check)/.test(t) ? "email2" : "email";
  if (/フリガナ|ふりがな|カナ|かな|kana|furigana|yomi/.test(t)) {
    if (/会社|法人|企業|貴社|company|corp/.test(t)) return "company_kana";
    if (/(セイ|せい|姓|sei\b|last|family)/.test(t)) return "kana_sei";
    if (/(メイ|めい|(?<!氏)名(?!前)|mei\b|first|given)/.test(t)) return "kana_mei";
    return "kana";
  }
  if (f.type === "tel" || /tel|phone|電話|携帯/.test(t)) return "tel";
  if (/郵便|zip|postal|〒/.test(t)) return "zip";
  if (/都道府県|pref/.test(t)) return "pref";
  if (/住所|所在地|address|市区町村|番地/.test(t)) return "addr";
  if (/会社|法人|企業|貴社|御社|団体|組織|勤務先|company|corp|organization|org_?name/.test(t)) return "company";
  if (/部署|所属|部門|department|division|section/.test(t)) return "dept";
  if (/役職|position|post\b/.test(t)) return "position";
  if (/件名|題名|subject|タイトル/.test(t)) return "subject";
  if (/url|ホームページ|website|web\s?サイト|サイト/.test(t)) return "site";
  if (/(^|\s)(姓|せい|セイ)(\s|$)|last_?name|family_?name|name_?(1|sei|last)|\bsei\b/.test(t)) return "sei";
  if (/(^|\s)(名|めい|メイ)(\s|$)|first_?name|given_?name|name_?(2|mei|first)|\bmei\b/.test(t)) return "mei";
  if (/氏名|お名前|名前|ご?担当者|name/.test(t)) return "name";
  if (/内容|本文|message|詳細|ご用件|ご質問|comment|body|inquiry/.test(t)) return "message";
  return "";
}

// 選ぶ欄（お問い合わせの種類など）は「その他」→「ご提案・営業・サービス」→ いちばん上の順で選ぶ
function pickOption(opts) {
  const real = opts.filter((o) => o.v !== "" && !/選択|お選び|please|select|---|－/i.test(o.t));
  return real.find((o) => /その他|other/i.test(o.t)) || real.find((o) => /ご?提案|営業|サービス|業務|協業|取引/.test(o.t)) || real[0] || null;
}

// ページの中（フレームも含む）から、送る相手のフォームを探して、欄の一覧を作る
async function scanFrames(page) {
  for (const fr of page.frames()) {
    const got = await fr.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
      const areas = [...document.querySelectorAll("textarea")].filter(vis);
      const mails = [...document.querySelectorAll('input[type="email"],input[name*="mail" i]')].filter(vis);
      const seed = areas[0] || mails[0]; if (!seed) return null;
      const root = seed.closest("form") || document.body;
      const txt = (el) => (el ? (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80) : "");
      // 見出し：label[for] → 囲む label → 同じ行の th/dt → 直前の要素の文字
      const labelOf = (el) => {
        if (el.id) { const l = root.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && txt(l)) return txt(l); }
        const wrap = el.closest("label"); if (wrap && txt(wrap)) return txt(wrap);
        const row = el.closest("tr,dl,li,.form-group,.form-item,.row,p,div");
        if (row) { const h = row.querySelector("th,dt,label,.label,.title,legend"); if (h && txt(h)) return txt(h); }
        let p = el.previousElementSibling; for (let i = 0; i < 2 && p; i++, p = p.previousElementSibling) if (txt(p)) return txt(p);
        return el.getAttribute("aria-label") || el.getAttribute("title") || "";
      };
      const out = []; let i = 0; const seenRadio = new Set();
      for (const el of root.querySelectorAll("input,textarea,select")) {
        const type = (el.getAttribute("type") || (el.tagName === "SELECT" ? "select" : "text")).toLowerCase();
        if (["hidden", "submit", "button", "image", "reset", "file", "search", "password"].includes(type)) continue;
        if (!vis(el) && type !== "checkbox" && type !== "radio") continue;   // 飾りのチェックボックスは本体が隠れていることが多い
        if (type === "radio") { if (seenRadio.has(el.name)) continue; seenRadio.add(el.name); }
        const idx = i++; el.setAttribute("data-kbf", String(idx));
        const grp = type === "radio" ? [...root.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)] : [];
        grp.forEach((r, j) => r.setAttribute("data-kbf-o", `${idx}-${j}`));
        const box = el.closest("tr,dl,li,.form-group,.form-item,fieldset") || el.parentElement;
        const label = type === "radio" ? (txt((el.closest("fieldset") || {}).querySelector ? el.closest("fieldset").querySelector("legend") : null) || txt(box && box.querySelector("th,dt,legend,.label")) || el.name) : labelOf(el);
        out.push({ i: idx, tag: el.tagName.toLowerCase(), type, name: el.name || "", id: el.id || "", placeholder: el.getAttribute("placeholder") || "", label,
          // 「必須」の印は見出しの文字だけで見る（囲みの箱で見ると、フォーム全体が1つの箱のときに全部の欄が必須に見えてしまう）
          required: el.required || el.getAttribute("aria-required") === "true" || /必須|\*/.test(label),
          maxlength: el.maxLength > 0 ? el.maxLength : 0,
          opts: el.tagName === "SELECT" ? [...el.options].map((o) => ({ v: o.value, t: o.text.trim() })) : grp.map((r, j) => ({ v: `${idx}-${j}`, t: txt(r.closest("label")) || r.value })) });
      }
      // ロボット確認：v2 の「私はロボットではありません」・hCaptcha・Cloudflare は止める。v3（右下の小さな印だけ）は通ることがあるので注意だけ
      const html = document.documentElement.innerHTML;
      const captcha = /recaptcha\/api2\/anchor|class="g-recaptcha"|hcaptcha\.com|challenges\.cloudflare\.com|cf-turnstile/.test(html) && !/grecaptcha-badge/.test(html) ? "block"
        : /grecaptcha-badge|recaptcha\/api\.js\?render=/.test(html) ? "v3" : "";
      return { fields: out, captcha, title: document.title };
    }).catch(() => null);
    if (got && got.fields.length) return { frame: fr, ...got };
  }
  return null;
}

// 会社の Web ページから問い合わせページを探す（ページ自体がフォームならそのまま）
async function findContact(page, web, say) {
  await page.goto(web, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(1500);
  let scan = await scanFrames(page);
  if (scan) return { url: page.url(), scan };
  const links = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((a) => ({ href: a.href, t: (a.innerText || a.getAttribute("title") || (a.querySelector("img") || {}).alt || "").replace(/\s+/g, " ").trim().slice(0, 40) }))).catch(() => []);
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const base = host(page.url());
  const cands = [...new Map(links.filter((l) => /^https?:/.test(l.href) && !NOT_CONTACT.test(l.href + " " + l.t) && (CONTACT_TX.test(l.t) || CONTACT_HREF.test(l.href)))
    .map((l) => [l.href.replace(/#.*$/, ""), { ...l, score: (CONTACT_TX.test(l.t) ? 2 : 0) + (CONTACT_HREF.test(l.href) ? 1 : 0) + (host(l.href).endsWith(base) ? 1 : 0) }])).values()]
    .sort((a, b) => b.score - a.score).slice(0, 3);
  for (const c of cands) {
    say(`問い合わせページらしいところを開きます：${c.t || c.href}`);
    try { await page.goto(c.href, { waitUntil: "domcontentloaded", timeout: 20000 }); await page.waitForTimeout(1500); } catch { continue; }
    scan = await scanFrames(page);
    if (scan) return { url: page.url(), scan };
  }
  return { url: page.url(), scan: null, tried: cands.map((c) => c.href) };
}

// 欄ごとに入れる値を決める。決められない必須の欄は missing に入れる（その場合は送らない）
function planOf(scan, P) {
  const plan = [], missing = [];
  const fields = scan.fields.map((f) => ({ ...f, role: roleOf(f) }));
  // いちばん大きい本文の欄だけを本文にする（2つ目の textarea は「その他」などのことが多い）
  let msgDone = false;
  const telN = fields.filter((f) => f.role === "tel").length, zipN = fields.filter((f) => f.role === "zip").length;
  const telParts = String(P.tel || "").split(/[-－ー‐]/), zipParts = String(P.zip || "").replace(/[〒\s]/g, "").split(/[-－ー‐]/);
  let telI = 0, zipI = 0;
  const [sei, ...meiA] = String(P.name || "").trim().split(/[\s　]+/); const mei = meiA.join(" ");
  const [ksei, ...kmeiA] = String(P.kana || "").trim().split(/[\s　]+/); const kmei = kmeiA.join(" ");
  for (const f of fields) {
    let v = null, show = "";
    switch (f.role) {
      case "message": if (!msgDone) { v = P.body; msgDone = true; show = "（本文）"; } break;
      case "email": case "email2": v = P.email; break;
      case "tel": v = telN >= 3 ? (telParts[telI++] || "") : P.tel; break;
      case "zip": v = zipN >= 2 ? (zipParts[zipI++] || "") : P.zip; break;
      case "addr": v = P.addr; break;
      case "company": v = P.company; break;
      case "company_kana": v = P.companyKana; break;
      case "dept": v = P.dept; break;
      case "position": v = P.position; break;
      case "subject": v = P.subject; break;
      case "site": v = P.site; break;
      case "name": v = P.name; break;
      case "sei": v = sei; break;
      case "mei": v = mei; break;
      case "kana": v = P.kana; break;
      case "kana_sei": v = ksei; break;
      case "kana_mei": v = kmei; break;
      case "agree": v = true; show = "チェックを入れる"; break;
      case "pref": { const o = (f.opts || []).find((x) => P.addr && x.t && String(P.addr).startsWith(x.t)); if (o) { v = o.v; show = o.t; } break; }
      case "choice": if (f.required || /種別|種類|項目|内容|区分|カテゴリ|件名|用件|type|category/i.test(f.label + f.name)) { const o = pickOption(f.opts || []); if (o) { v = o.v; show = o.t; } } break;
    }
    if (typeof v === "string" && f.maxlength && v.length > f.maxlength) v = v.slice(0, f.maxlength);
    if ((v == null || v === "") && f.required) { missing.push(f.label || f.name || "（見出しの無い欄）"); continue; }
    if (v == null || v === "") continue;
    plan.push({ i: f.i, tag: f.tag, type: f.type, label: f.label || f.name, role: f.role, value: v, show: show || String(v).slice(0, 60) });
  }
  if (!msgDone) missing.push("お問い合わせ内容（本文の欄が見つかりません）");
  return { plan, missing };
}

async function fillPlan(frame, plan) {
  for (const p of plan) {
    if (p.type === "radio") { await frame.locator(`[data-kbf-o="${p.value}"]`).check({ force: true, timeout: 5000 }).catch(() => {}); continue; }
    const el = frame.locator(`[data-kbf="${p.i}"]`);
    if (p.type === "checkbox") { await el.check({ force: true, timeout: 5000 }).catch(async () => { await el.evaluate((x) => { x.checked = true; x.dispatchEvent(new Event("change", { bubbles: true })); }).catch(() => {}); }); continue; }
    if (p.tag === "select") { await el.selectOption(String(p.value), { timeout: 5000 }).catch(() => {}); continue; }
    await el.fill(String(p.value), { timeout: 5000 });
  }
}

// 送信（確認画面がある作りなら、もう一度「送信」を押す）
async function submit(page, frame, say) {
  const clickSend = async (fr, re) => {
    const btns = fr.locator('button, input[type="submit"], input[type="image"], input[type="button"], a[role="button"]');
    const n = await btns.count();
    for (let k = 0; k < n; k++) {
      const b = btns.nth(k);
      if (!(await b.isVisible().catch(() => false))) continue;
      const t = ((await b.innerText().catch(() => "")) || (await b.getAttribute("value").catch(() => "")) || (await b.getAttribute("alt").catch(() => "")) || "").trim();
      const typ = (await b.getAttribute("type").catch(() => "")) || "";
      if (re.test(t) || (!t && typ === "submit")) { await b.click({ timeout: 8000 }); return t || "送信"; }
    }
    return "";
  };
  const textOf = async () => { let s = ""; for (const fr of page.frames()) s += " " + (await fr.evaluate(() => document.body ? document.body.innerText : "").catch(() => "")); return s.replace(/\s+/g, " "); };
  const SEND = /送信|確認|次へ|進む|submit|send|confirm|入力内容|問い?合わ?せる/i;
  const first = await clickSend(frame, SEND);
  if (!first) return { status: "failed", note: "送信のボタンが見つかりませんでした" };
  say(`「${first}」を押しました`);
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {}); await page.waitForTimeout(1500);
  let tx = await textOf();
  if (DONE_TX.test(tx)) return { status: "sent", note: snippet(tx, DONE_TX) };
  // 確認画面：「送信」「この内容で送る」を押す（入力欄が残っていてエラーが出ているなら止める）
  if (ERR_TX.test(tx) && (await scanFrames(page))) return { status: "failed", note: `入力のエラーが出ました：${snippet(tx, ERR_TX)}` };
  for (const fr of page.frames()) {
    const t2 = await clickSend(fr, /送信|この内容で|送る|submit|send/i);
    if (t2) {
      say(`確認画面で「${t2}」を押しました`);
      await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {}); await page.waitForTimeout(1500);
      tx = await textOf();
      if (DONE_TX.test(tx)) return { status: "sent", note: snippet(tx, DONE_TX) };
      if (ERR_TX.test(tx)) return { status: "failed", note: `入力のエラーが出ました：${snippet(tx, ERR_TX)}` };
      break;
    }
  }
  return { status: "unsure", note: "送信を押しましたが、完了の文言が見つかりませんでした。相手のページで届いたか確かめてください" };
}
function snippet(tx, re) { const m = tx.match(re); if (!m) return tx.slice(0, 120); const at = Math.max(0, m.index - 40); return tx.slice(at, at + 140).trim(); }

// mode: "inspect"＝探して当てはめるだけ（送らない）／"send"＝入力して送る
//   P：差出人の情報と本文（company, dept, name, kana, email, tel, zip, addr, site, subject, body）
export function formRun({ web, url, mode, P }) {
  return serial(async () => {
    const log = []; const say = (t) => { log.push(t); console.log(`[mcform] ${t}`); };
    let browser;
    try {
      const start = String(url || web || "").trim();
      if (!/^https?:\/\//i.test(start)) return { ok: false, error: "この会社の Web ページが分かりません。左の「会社の情報を直す」で Web ページを入れるか、問い合わせページの URL を入れてください", log };
      say("ブラウザを起動しています");
      browser = await launch();
      const ctx = await browser.newContext({ locale: "ja-JP", viewport: { width: 1280, height: 1000 },
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" });
      const page = await ctx.newPage();
      const found = await findContact(page, start, say);
      if (!found.scan) return { ok: false, url: found.url, error: `問い合わせフォームが見つかりませんでした${found.tried && found.tried.length ? `（見たページ：${found.tried.length}件）` : ""}。問い合わせページの URL が分かれば、入れ直して調べてください`, log };
      const { scan } = found;
      say(`フォームを見つけました：${scan.title || found.url}（欄 ${scan.fields.length}）`);
      if (scan.captcha === "block") return { ok: false, url: found.url, error: "このフォームにはロボット確認（「私はロボットではありません」など）があるので、自動では送れません。開いて手で送ってください", log };
      const { plan, missing } = planOf(scan, P);
      const view = plan.map((p) => ({ label: p.label, value: p.show }));
      const warn = scan.captcha === "v3" ? "このフォームには見えないロボット確認（reCAPTCHA v3）があります。送れても相手に届かないことがあります" : "";
      if (missing.length) return { ok: false, url: found.url, plan: view, missing, warn, error: `何を入れればよいか分からない必須の欄があるので、送れません：${missing.slice(0, 5).join("・")}`, log };
      if (mode !== "send") return { ok: true, url: found.url, plan: view, warn, log };
      await fillPlan(scan.frame, plan);
      say("入力しました");
      const r = await submit(page, scan.frame, say);
      return { ok: r.status !== "failed", status: r.status, note: r.note, url: found.url, after: page.url(), plan: view, warn, error: r.status === "failed" ? r.note : "", log };
    } catch (e) {
      return { ok: false, error: `フォームを開けませんでした：${String(e.message || e).split("\n")[0].slice(0, 160)}`, log };
    } finally { if (browser) await browser.close().catch(() => {}); }
  });
}

export const _test = { roleOf, pickOption, planOf };
