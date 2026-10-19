// CS Platform（ヘルプサイト）を、見えないブラウザで人と同じように操作する（APIが無いため）。
//   ログイン → 企業管理 → （無ければ）企業を追加 → 企業を開く → （企業IDを合わせる）→ 案内文をコピー
// ログイン情報は Railway の環境変数 CSP_EMAIL・CSP_PASSWORD（コードやチャットには書かない）。URL は CSP_BASE_URL。
// ブラウザは playwright-core ＋ @sparticuz/chromium（サーバーに入れやすい小さなChromium）。入っていなければ理由を返す。

export function cspConfigured() {
  return !!(process.env.CSP_EMAIL && process.env.CSP_PASSWORD);
}
const BASE = () => String(process.env.CSP_BASE_URL || "https://cs-platform-a4bx7jbh2q-an.a.run.app").replace(/\/+$/, "");

let _busy = Promise.resolve();
// 同時に2つ動かさない（ブラウザは重いので1つずつ）
export function cspIssueAccount(opts) {
  const run = _busy.then(() => issueOnce(opts));
  _busy = run.catch(() => {});
  return run;
}

async function launch() {
  let chromium, pw;
  try { pw = await import("playwright-core"); } catch { throw new Error("ブラウザの部品（playwright-core）が入っていません"); }
  try { chromium = (await import("@sparticuz/chromium")).default; } catch { throw new Error("ブラウザの部品（@sparticuz/chromium）が入っていません"); }
  const executablePath = process.env.CSP_CHROME_PATH || await chromium.executablePath();
  return pw.chromium.launch({ executablePath, args: chromium.args, headless: true });
}

async function issueOnce({ companyName, companyId = "" }) {
  const log = [];
  const say = (t) => { log.push(t); console.log(`[csp] ${t}`); };
  if (!cspConfigured()) return { ok: false, error: "CS Platformのログイン情報（CSP_EMAIL・CSP_PASSWORD）がRailwayに入っていません", log };
  const name = String(companyName || "").trim();
  if (!name) return { ok: false, error: "企業名がありません", log };
  let browser, page;
  try {
    browser = await launch();
    const ctx = await browser.newContext({ locale: "ja-JP", viewport: { width: 1400, height: 1000 } });
    // 「案内文をコピー」でコピーされた文を受け取れるよう、コピーの関数を先に差しかえておく
    await ctx.addInitScript(() => {
      window.__kbCopied = "";
      try {
        const orig = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText.bind(navigator.clipboard) : null;
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { ...(navigator.clipboard || {}), writeText: async (t) => { window.__kbCopied = String(t || ""); try { if (orig) await orig(t); } catch {} }, readText: async () => window.__kbCopied } });
      } catch {}
      const ex = document.execCommand ? document.execCommand.bind(document) : null;
      document.execCommand = function (cmd, ...rest) {
        if (String(cmd).toLowerCase() === "copy") { try { const sel = String(window.getSelection() || ""); const ta = document.activeElement && "value" in document.activeElement ? document.activeElement.value : ""; window.__kbCopied = ta || sel || window.__kbCopied; } catch {} }
        return ex ? ex(cmd, ...rest) : true;
      };
    });
    page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    let dialogAnswer = null;   // ID変更などで prompt が出たときの答え
    page.on("dialog", async (d) => { try { if (d.type() === "prompt") await d.accept(dialogAnswer || d.defaultValue()); else await d.accept(); } catch {} });

    // 1) ログイン
    await page.goto(`${BASE()}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="email"], input[name*="mail" i], input[autocomplete="username"]').first().fill(process.env.CSP_EMAIL);
    await page.locator('input[type="password"]').first().fill(process.env.CSP_PASSWORD);
    await page.locator('button:has-text("ログイン")').first().click();
    await page.waitForURL((u) => !/\/login/.test(String(u)), { timeout: 20000 }).catch(() => {});
    if (/\/login/.test(page.url())) throw new Error("CS Platformにログインできませんでした（メールアドレスかパスワードが違う可能性）");
    say("ログインしました");

    // 2) 企業管理
    await page.goto(`${BASE()}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.locator('button:has-text("企業管理"), a:has-text("企業管理")').first().click();
    await page.waitForTimeout(800);
    const search = page.locator('input[placeholder*="企業名・企業ID"], input[placeholder*="企業IDで検索"]').first();
    const findRow = async () => {
      await search.fill(name);
      await page.waitForTimeout(1200);
      const cands = page.locator(`table >> text="${name.replace(/"/g, '\\"')}"`);
      return (await cands.count()) ? cands.first() : null;
    };
    let row = await findRow();
    if (!row) {
      // 3) 無ければ企業を追加
      await search.fill("");
      await page.locator('input[placeholder*="企業名（例"], input[placeholder*="株式会社サンプル"]').first().fill(name);
      await page.locator('button:has-text("企業を追加")').first().click();
      await page.waitForTimeout(2000);
      say(`企業を追加しました：${name}`);
      row = await findRow();
    } else say(`すでにある企業でした：${name}`);
    if (!row) throw new Error("企業を追加したあと、一覧で見つけられませんでした");

    // 4) 企業を開く
    await row.click();
    await page.waitForSelector('text=ポータルアカウント', { timeout: 20000 });
    const idOf = async () => { const t = await page.locator("body").innerText(); return ((/企業ID[：:]\s*([A-Za-z0-9_.-]+)/.exec(t) || [])[1]) || ""; };
    let curId = await idOf();
    say(`企業を開きました（いまの企業ID：${curId || "なし"}）`);

    // 5) 企業IDを合わせる（指定があって違うとき）
    const want = String(companyId || "").trim();
    if (want && curId !== want) {
      dialogAnswer = want;
      await page.locator('button:has-text("ID変更")').first().click();
      await page.waitForTimeout(800);
      // 入力欄が出る作りなら、そこに入れて保存
      const inp = page.locator('input:visible').filter({ hasNot: page.locator('[type="password"]') });
      const n = await inp.count();
      for (let i = 0; i < n; i++) {
        const v = await inp.nth(i).inputValue().catch(() => "");
        if (v === curId || (!v && i === n - 1)) {
          await inp.nth(i).fill(want);
          const btn = page.locator('button:visible:has-text("保存"), button:visible:has-text("変更する"), button:visible:has-text("OK"), button:visible:has-text("決定")').first();
          if (await btn.count()) await btn.click(); else await inp.nth(i).press("Enter");
          break;
        }
      }
      await page.waitForTimeout(1500);
      curId = await idOf();
      say(curId === want ? `企業IDを ${want} にしました` : `企業IDを ${want} にできませんでした（いま：${curId}）`);
    }

    // 6) アカウントが未発行なら発行する
    const issue = page.locator('button:has-text("アカウント発行"), button:has-text("アカウントを発行"), button:has-text("発行する")').first();
    if (await issue.count()) { await issue.click(); await page.waitForTimeout(1500); say("アカウントを発行しました"); }

    // 7) 案内文をコピー
    await page.locator('button:has-text("案内文をコピー")').first().click();
    await page.waitForTimeout(1200);
    let text = await page.evaluate(() => window.__kbCopied || "").catch(() => "");
    if (!text) text = await page.evaluate(async () => { try { return await navigator.clipboard.readText(); } catch { return ""; } }).catch(() => "");
    const loginUrl = ((/ログインURL[：:]\s*(https?:\/\/\S+)/.exec(await page.locator("body").innerText()) || [])[1]) || `${BASE()}/portal/login`;
    if (!text) throw new Error("案内文を受け取れませんでした（コピーのしくみが想定と違う可能性）");
    say("案内文をコピーしました");
    return { ok: true, companyId: curId, text: text.trim(), loginUrl, log };
  } catch (e) {
    let shot = "";
    try { if (page) shot = (await page.screenshot({ type: "png", fullPage: false })).toString("base64"); } catch {}
    return { ok: false, error: e.message, log, screenshot: shot, url: page ? page.url() : "" };
  } finally {
    try { if (browser) await browser.close(); } catch {}
  }
}
