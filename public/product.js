// プロダクト切り替え（全体 / DOC / MOCHICA）
// - 選択はブラウザに保存され、ページを移動しても保持される
// - 権限は変えない。全員がすべての商談を閲覧できる（これは表示の絞り込みだけ）
(function () {
  const KEY = "kinbot.product";
  const PRODUCTS = ["DOC", "MOCHICA"];
  const DEFAULT_PRODUCT = "DOC"; // 初回アクセス時に開くタブ
  const ALL = "__all__";         // 「全体」を明示的に選んだ状態（未選択と区別する）

  let repProductMap = {}; // 表示名/メール -> "DOC" | "MOCHICA"
  let loaded = null;
  let ready = false;      // マッピングの読み込みが完了したか

  // 現在の選択。未保存（初回アクセス）なら既定の DOC を返す。
  // 「全体」を選んでいる場合は "" を返す（＝絞り込みなし）。
  function current() {
    try {
      const v = localStorage.getItem(KEY);
      if (v === null) return DEFAULT_PRODUCT; // 初回はDOC
      if (v === ALL) return "";               // 明示的に全体を選んだ
      return v || "";
    } catch { return DEFAULT_PRODUCT; }
  }
  function setCurrent(v) {
    try { localStorage.setItem(KEY, v || ALL); } catch {}
  }

  async function loadMap() {
    if (loaded) return loaded;
    loaded = fetch("/api/rep-products")
      .then((r) => r.json())
      .then((d) => { repProductMap = (d && d.map) || {}; ready = true; return repProductMap; })
      .catch(() => { repProductMap = {}; ready = true; return repProductMap; });
    return loaded;
  }

  // 担当者名（表示名 or メール）からプロダクトを引く。未設定なら ""。
  function productOf(owner) {
    if (!owner) return "";
    const k = String(owner).trim();
    return repProductMap[k] || repProductMap[k.toLowerCase()] || "";
  }

  // 現在のプロダクト選択に、この担当者が含まれるか
  function matches(owner) {
    if (!ready) return true;        // マッピング未読込のうちは絞り込まない（一覧が空になるのを防ぐ）
    if (!hasAnyAssignment()) return true; // 誰にもプロダクトが割り当てられていない → 絞り込まない
    const p = current();
    if (!p) return true;            // 「全体」は全部見せる
    return productOfLoose(owner) === p;
  }

  // 部分一致も許容してプロダクトを引く（「田中」登録 ↔ 「田中欽也」表示 のズレを吸収）
  function productOfLoose(owner) {
    const exact = productOf(owner);
    if (exact) return exact;
    const o = String(owner || "").trim().toLowerCase();
    if (!o) return "";
    for (const k in repProductMap) {
      const kk = String(k).trim().toLowerCase();
      if (!kk || !repProductMap[k]) continue;
      if (o === kk || o.includes(kk) || kk.includes(o)) return repProductMap[k];
    }
    return "";
  }

  // 1人でもプロダクトが設定されているか（未設定運用では絞り込みを無効化する）
  function hasAnyAssignment() {
    for (const k in repProductMap) if (repProductMap[k]) return true;
    return false;
  }

  // タブUIを .topbar に差し込む
  function mount(onChange, opts) {
    const bar = document.querySelector(".topbar");
    if (!bar || document.getElementById("productTabs")) return;
    const wrap = document.createElement("div");
    wrap.id = "productTabs";
    wrap.className = "prod-tabs";
    const mk = (val, label) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "prod-tab" + (current() === val ? " active" : "");
      b.textContent = label;
      b.addEventListener("click", () => {
        setCurrent(val);
        wrap.querySelectorAll(".prod-tab").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        if (typeof onChange === "function") onChange(val);
      });
      return b;
    };
    wrap.appendChild(mk("", "全体"));
    for (const p of PRODUCTS) wrap.appendChild(mk(p, p));
    bar.appendChild(wrap);
    // マッピング読込前に描画された一覧は、既定のプロダクトで描き直す必要がある。
    // サーバー側で絞るページ（実績）は初回取得に既にプロダクトが乗っているので不要。
    const renderOnMount = !opts || opts.renderOnMount !== false;
    if (renderOnMount && typeof onChange === "function") onChange(current());
  }

  window.kbProduct = { current, setCurrent, loadMap, productOf, matches, mount, PRODUCTS, isReady: () => ready, hasAnyAssignment };
})();
