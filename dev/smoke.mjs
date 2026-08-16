// smoke.mjs — 直したあと、本当に動くかを確かめる。
//
// サーバーを起動して、よく使う画面とAPIが返ってくるかを見ます。
// 1つでもだめなら、本番には入れません。

import { spawn } from "node:child_process";

const PORT = 8199;
const PAGES = ["/login.html", "/home.html", "/apo.html", "/docs.html", "/sf-launch.html", "/dev.html"];
const APIS = ["/api/version", "/api/dev-notes", "/api/self-check", "/api/ui-review", "/api/call-report"];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const server = spawn("node", ["server/index.js"], {
    env: {
      ...process.env,
      RECALL_API_KEY: "dummy", SESSION_SECRET: "dummy", GEMINI_API_KEY: "dummy",
      PORT: String(PORT),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  server.stdout.on("data", (d) => { log += d.toString(); });
  server.stderr.on("data", (d) => { log += d.toString(); });

  // 起動を待つ（最大30秒）
  let up = false;
  for (let i = 0; i < 30; i++) {
    await wait(1000);
    if (/自動スキャンの間隔/.test(log)) { up = true; break; }
    if (server.exitCode !== null) break;
  }

  const fail = (msg) => {
    console.error("だめでした:", msg);
    console.error("--- 起動したときの記録 ---");
    console.error(log.slice(-3000));
    try { server.kill("SIGKILL"); } catch {}
    process.exit(1);
  };

  if (!up) fail("サーバーが起動しませんでした");

  for (const p of [...PAGES, ...APIS]) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${p}`);
      // 401（ログインが要る）は正常。500番台だけをだめとする。
      if (r.status >= 500) fail(`${p} が ${r.status} を返しました`);
      console.log(`OK ${p}（${r.status}）`);
    } catch (e) {
      fail(`${p} につながりません（${e.message}）`);
    }
  }

  // 起動中に出たエラーを見る
  if (/Error:|TypeError|ReferenceError/.test(log)) {
    const line = (log.match(/.*(Error:|TypeError|ReferenceError).*/) || [])[0] || "";
    fail(`起動のときにエラーが出ています：${line.slice(0, 200)}`);
  }

  try { server.kill("SIGKILL"); } catch {}
  console.log("すべて動きました");
}

main().catch((e) => { console.error("確認に失敗:", e.message); process.exit(1); });
