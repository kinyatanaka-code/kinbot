// Google のサインイン：借りたアカウントのメールアドレスを入れて「次へ」。アカウントの選択の画面では、そのアカウント（無ければ「別のアカウントを使用」）を押す
(async () => {
  const done = new Set();
  kcLoop(async () => {
    const c = await kcCred(); if (!c) return false;
    const mail = String(c.account).toLowerCase();
    // アカウントの選択
    const pick = document.querySelector(`[data-identifier="${CSS.escape(mail)}"], [data-email="${CSS.escape(mail)}"]`);
    if (pick && kcVisible(pick) && !done.has("pick")) { done.add("pick"); pick.click(); return true; }
    const other = [...document.querySelectorAll("li, div[role=link], div[role=button]")].find((el) => /別のアカウントを使用|Use another account/.test(el.textContent || "") && kcVisible(el));
    if (other && !pick && !done.has("other") && !document.querySelector("#identifierId")) { done.add("other"); other.click(); return true; }
    // メールアドレスの入力
    const id = document.querySelector("#identifierId, input[type=email][name=identifier]");
    if (id && kcVisible(id) && !done.has("id") && String(id.value || "").toLowerCase() !== mail) { done.add("id"); kcSetVal(id, c.account); setTimeout(() => { const nx = document.querySelector("#identifierNext button, #identifierNext"); if (nx) nx.click(); }, 400); return true; }
    return false;
  });
})();
