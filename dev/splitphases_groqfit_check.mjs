// Gemini=503、Anthropic=残高不足、Groq=1分の枠 8000（1文字=1 と数える）のとき、長い商談の段階分けが通るかを確かめる
const calls = [];
globalThis.fetch = async (url, init) => {
  const u = String(url); const body = JSON.parse(init.body || "{}");
  if (/generativelanguage/.test(u)) { calls.push("gemini"); return new Response(JSON.stringify({ error: { status: "UNAVAILABLE" } }), { status: 503 }); }
  if (/anthropic/.test(u)) { calls.push("anthropic"); return new Response(JSON.stringify({ type: "error", error: { message: "Your credit balance is too low" } }), { status: 400 }); }
  if (/groq/.test(u)) {
    const req = Math.round(body.messages.reduce((s, m) => s + m.content.length, 0) * Number(process.env.RATIO || 1)) + body.max_tokens;
    calls.push(`groq(${req})`);
    if (req > 8000) return new Response(JSON.stringify({ error: { message: `Request too large for model \`${body.model}\` in organization \`org_x\` service tier \`on_demand\` on tokens per minute (TPM): Limit 8000, Requested ${req}, please reduce your message size and try again.` } }), { status: 413 });
    const rows = body.messages[1].content.split("\n").filter((l) => /^\d+\|/.test(l));
    globalThis.__rows = rows;
    const n = Number((body.messages[1].content.match(/全(\d+)発言/) || [])[1]);
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ chapters: [{ from: 0, to: Math.floor(n / 2), phase: "ヒアリング", note: "課題の確認" }, { from: Math.floor(n / 2) + 1, to: n - 1, phase: "デモ", note: "画面の説明" }] }) } }] }), { status: 200 }); }
  throw new Error("unexpected " + u);
};
const { splitPhases } = await import(process.argv[2]);
const N = Number(process.env.N || 400);
const tr = Array.from({ length: N }, (_, i) => ({ speaker: { name: i % 2 ? "山田太郎" : "営業担当の福井" }, text: (i % 3 ? "はい" : "採用の課題についてお話を伺います。母集団形成と歩留まりのどちらがより大きな悩みでしょうか、また現在の管理方法も教えてください") + i }));
try { const r = await splitPhases({ transcript: tr, repName: "営業" }); console.log("OK", JSON.stringify(r)); }
catch (e) { console.log("ERR", e.message.slice(0, 300)); }
console.log("calls:", calls.join(" > "));
if (globalThis.__rows) console.log("rows:", globalThis.__rows.length, "| first:", globalThis.__rows[0], "| last:", globalThis.__rows.at(-1));
process.exit(0);
