// 入力欄に値を入れる（React などの画面でも効くように、ネイティブの setter で入れて input イベントを出す）
function kcSetVal(el, v) {
  const proto = Object.getPrototypeOf(el);
  const set = Object.getOwnPropertyDescriptor(proto, "value") && Object.getOwnPropertyDescriptor(proto, "value").set;
  el.focus(); if (set) set.call(el, v); else el.value = v;
  el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
}
function kcVisible(el) { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; }
async function kcCred() { return new Promise((res) => chrome.runtime.sendMessage({ type: "kc-zoom-get" }, (r) => res(r && r.ok ? r.cred : null))); }
// 画面が出るまで待って、1つの欄には1回だけ入れる
function kcLoop(step, ms = 500, max = 120) { let n = 0; const t = setInterval(async () => { n++; if (n > max) return clearInterval(t); try { if (await step()) { /* 続けて次の欄も見る */ } } catch {} }, ms); }
