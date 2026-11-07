// Okta のサインイン：社員番号 → 次へ → パスワード → 確認（新しい画面・古い画面の両方）
(async () => {
  const done = new Set();
  const submit = (form) => { const b = (form || document).querySelector("input[type=submit], button[type=submit], #okta-signin-submit, [data-type=save]"); if (b) b.click(); };
  kcLoop(async () => {
    const c = await kcCred(); if (!c) return false;
    const user = document.querySelector("input[name=identifier], input[name=username], #okta-signin-username, #idp-discovery-username");
    if (user && kcVisible(user) && !done.has("user") && c.empNo) { done.add("user"); kcSetVal(user, c.empNo); setTimeout(() => submit(user.form), 400); return true; }
    const pw = document.querySelector("input[name='credentials.passcode'], input[name=password], #okta-signin-password, input[type=password]");
    if (pw && kcVisible(pw) && !done.has("pw")) {
      done.add("pw"); kcSetVal(pw, c.password);
      // 1つの画面に社員番号とパスワードが両方ある（古い画面）ときは、社員番号も入れる
      if (user && kcVisible(user) && c.empNo && user.value !== c.empNo) kcSetVal(user, c.empNo);
      setTimeout(() => submit(pw.form), 400); return true;
    }
    return false;
  });
})();
