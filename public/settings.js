// public/settings.js
const $ = (id) => document.getElementById(id);

async function load() {
  try {
    const res = await fetch("/api/settings");
    const data = await res.json();
    const s = data.settings || {};
    $("botName").value = s.botName || "";
    $("repName").value = s.repName || "";
    $("languageCode").value = s.languageCode || "ja";
    $("transcribeProvider").value = s.transcribeProvider || "recallai";
    $("deepgramModel").value = s.deepgramModel || "nova-2";
    $("analyzeIntervalSec").value = Math.round((s.analyzeIntervalMs || 20000) / 1000);

    const st = data.status || {};
    $("statusTable").innerHTML = `
      <tr><td>要約エンジン</td><td>${st.llmProvider || "-"}（${st.llmModel || "-"}）</td></tr>
      <tr><td>履歴の保存(DB)</td><td>${st.dbEnabled ? "有効" : "無効（DATABASE_URL未設定）"}</td></tr>
      <tr><td>公開URL</td><td>${st.publicUrl || "-"}</td></tr>`;
  } catch {
    $("persistNote").textContent = "設定の読み込みに失敗しました。";
  }
}

$("saveBtn").addEventListener("click", async () => {
  const body = {
    botName: $("botName").value.trim(),
    repName: $("repName").value.trim(),
    languageCode: $("languageCode").value,
    transcribeProvider: $("transcribeProvider").value,
    deepgramModel: $("deepgramModel").value.trim() || "nova-2",
    analyzeIntervalMs: (Number($("analyzeIntervalSec").value) || 20) * 1000,
  };
  try {
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const r = await res.json();
    $("saved").hidden = false;
    setTimeout(() => ($("saved").hidden = true), 1500);
    $("persistNote").textContent = r.persisted
      ? "保存しました（次回の入室から反映）。"
      : "一時保存しました。永続化には DATABASE_URL（Postgres）の設定が必要です。再起動で消えます。";
  } catch {
    $("persistNote").textContent = "保存に失敗しました。";
  }
});

load();
