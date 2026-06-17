// public/nav.js — サイドバーのユーザー表示とログアウト
(async () => {
  try {
    const me = await (await fetch("/api/me")).json();
    const who = document.getElementById("who");
    if (who) who.textContent = me.username ? me.username + (me.admin ? "（管理者）" : "") : "";
  } catch {}
  const lo = document.getElementById("logout");
  if (lo)
    lo.addEventListener("click", async (e) => {
      e.preventDefault();
      await fetch("/api/logout", { method: "POST" });
      location.href = "/login.html";
    });
})();
