// MOCHICALL の使い方・機能の案内（2026-11-23 福井さん「kincall 準拠の右上の使い方、機能等のオンボーディング機能を」）
//   kincall の使い方ツアー（calls.js の kcTutorial）と同じ形：初めて開いた人には自動で出し、あとは右上の「使い方・機能」からいつでも見られる。
//   光らせる場所まで連れて行って、その場で説明する。一覧からは、知りたい機能だけを選んで見られる。
//   mccall.js に入れずに別のファイルにしたのは、架電の画面の直しとぶつからないようにするため（画面の部品は名前で探すだけで、中の処理には触らない）。
(function mcTour() {
  const SEEN_KEY = "mctour_seen_v1";
  const $ = (id) => document.getElementById(id);
  const pane = () => document.querySelector('[data-pane="call"]');
  const head = $("mcHeadCall");
  if (!pane() || !head) return;

  // 案内する順番。sel＝光らせる場所（上から順に探して、最初に見つかったもの）、tab＝MOCHICALL の中のどのタブか、
  //   short＝一覧に出すひとこと、admin＝管理者にだけ出るタブの案内。
  function buildSteps() {
    const hasTab = (t) => !!document.querySelector(`#mccTabs [data-t="${t}"]`);
    const hasLead = !!(($("mccLeft") || {}).children || []).length;
    const s = [];
    s.push({ tab: "call", sel: null,
      title: "MOCHICALL へようこそ",
      body: "かける会社が1社ずつ出てきます。調べて、かけて、結果を選んで記録する。この流れを、画面の場所ごとに順番に案内します。" });
    s.push({ tab: "call", sel: ["#mccList"],
      title: "かけるリスト", short: "いまかけているリストと、残りの件数",
      body: "いまかけているリストです。今日かけるリストが用意されている人は、今日の分の残りの件数がここに出ます。" });
    s.push({ tab: "call", sel: ["#mccLeft"],
      title: "会社を調べる", short: "会社・担当者・採用の情報・SF の記録をひと目で",
      body: hasLead
        ? "左は、かける前に見るところです。会社と担当者、受付で聞けたこと、採用の情報、Salesforce の記録がまとまっています。会社名や電話番号がちがうときは「直す」で直せます。"
        : "左は、かける前に見るところです。会社が出ると、担当者、受付で聞けたこと、採用の情報、Salesforce の記録がここにまとまります。" });
    s.push({ tab: "call", sel: ["#mccDial", ".mcc-dialed", ".mcc-callrow", "#mccCenter"],
      title: "発信する", short: "Zoom Phone で発信する・かけない会社は飛ばす",
      body: "ここを押すと Zoom Phone で発信します（C キーでも同じ）。かけない会社は「飛ばす」（S キー）。結果は、発信してから選べるようになります。" });
    s.push({ tab: "call", sel: ["#mccDoc"],
      title: "資料を送る", short: "通話の途中でも、資料のメールを送れる",
      body: "資料がほしいと言われたら、ここから送れます。送る中身を確かめる窓が開くので、確かめてから送ります。" });
    s.push({ tab: "call", sel: [".mcc-rec", "#mccCenter"],
      title: "結果を記録する", short: "架電結果を選んで「記録して次へ」。掛け直しは自動",
      body: "担当者と話せたら「担当者につながった」（T キー）を押すと、トークと日程の候補が担当者向けに変わります。終わったら架電結果を選び、「記録して次へ」（Enter）で次の会社へ。不在のときの掛け直しは自動で入り、記録は Salesforce の活動にも残ります。" });
    s.push({ tab: "call", sel: ["#mccRight"],
      title: "トーク・ヒアリング・これまで", short: "トークスクリプト、聞けたことの入力、これまでの履歴",
      body: "右は、話しながら使うところです。トークスクリプトは通話の進み具合に合わせて切り替わり、下にはこの会社とのこれまでのやりとりが出ます。担当者につながると、聞けたこと（ヒアリング）の入力とメモもここでできます。" });
    s.push({ tab: "call", sel: ["#mccStats"],
      title: "今日の数字", short: "今日のコール・話せた数・アポ",
      body: "今日の自分のコール数、担当者と話せた数、アポの数です。記録するたびに増えます。" });
    s.push({ tab: "call", sel: ["#mccHelpBtn"],
      title: "キー操作", short: "キーボードだけで1件を終えられる",
      body: "MOCHICALL はキーボードだけで1件を終えられます。使えるキーの一覧はここ（? キーでも開きます）。もちろん、クリックだけでも全部できます。" });
    if (hasTab("report")) s.push({ tab: "report", sel: ["#mccAdmin"],
      title: "レポート", short: "架電の結果をふり返る",
      body: "架電の結果をふり返るところです。期間を選んで、どの段階で止まっているかを確かめられます。" });
    if (hasTab("insight")) s.push({ tab: "insight", sel: ["#mccAdmin"],
      title: "数字", short: "つながりやすい時間帯・何回目までかけるか",
      body: "次のかけ方を決める根拠を見るところです。つながりやすい時間帯や、何回目の架電でアポが取れているかが分かります。" });
    if (hasTab("measures")) s.push({ tab: null, sel: ['#mccTabs [data-t="measures"]'], admin: true,
      title: "施策（管理者）", short: "リスト（売り先）×トーク（売り方）ごとの数字",
      body: "管理者にだけ出るタブです。リスト（売り先）とトーク（売り方）の組み合わせごとに、数字を分けて見られます。" });
    if (hasTab("cross")) s.push({ tab: null, sel: ['#mccTabs [data-t="cross"]'], admin: true,
      title: "部署をまたいだ記録（管理者）", short: "DOC から持ってきたリストと、その架電の記録",
      body: "管理者にだけ出るタブです。DOC から持ってきたリストと、その会社にかけた記録を確かめられます。" });
    s.push({ tab: "call", sel: null,
      title: "これで準備OK",
      body: hasLead
        ? "まずは1社、かけてみましょう。ボタンや数字にカーソルを2秒合わせると、その場で解説が出ます。この案内は、右上の「使い方・機能」からいつでも開けます。"
        : "かける会社が出たら、1社かけてみましょう。ボタンや数字にカーソルを2秒合わせると、その場で解説が出ます。この案内は、右上の「使い方・機能」からいつでも開けます。" });
    return s;
  }

  // 見た目（この案内だけに効くように、ここで入れる）。色は MOCHICALL の青緑（mccall.css の変数と同じ値）に合わせる
  if (!$("mctour-style")) {
    const st = document.createElement("style");
    st.id = "mctour-style";
    st.textContent = `
      #mctour{position:fixed;inset:0;z-index:9998;display:none;font-family:inherit;}
      #mctour.on{display:block;}
      #mctour.dim{background:rgba(10,40,44,.55);}
      #mctour-hole{position:absolute;border-radius:12px;pointer-events:none;
        box-shadow:0 0 0 9999px rgba(10,40,44,.55);outline:2px solid #5CC6D0;
        transition:top .18s ease,left .18s ease,width .18s ease,height .18s ease;}
      #mctour-pop{position:absolute;max-width:360px;width:calc(100vw - 32px);
        background:#fff;border:1px solid #D9ECEE;border-radius:16px;
        box-shadow:0 14px 40px rgba(11,110,120,.28);padding:14px 16px 12px;
        pointer-events:auto;box-sizing:border-box;}
      #mctour .mct-top{display:flex;gap:11px;align-items:flex-start;}
      #mctour .mct-ava{flex:none;width:48px;height:48px;border-radius:50%;
        background:#E6F6F8;border:1px solid #D9ECEE;padding:5px;box-sizing:border-box;}
      #mctour .mct-ava img{width:100%;height:100%;display:block;}
      #mctour-pop .mct-ttl{font-size:14px;font-weight:800;color:#0B6E78;margin:2px 22px 4px 0;}
      #mctour-pop .mct-body{font-size:12.5px;line-height:1.65;color:#12292C;}
      #mctour-pop .mct-foot{display:flex;align-items:center;gap:8px;margin-top:12px;}
      #mctour-pop .mct-step{font-size:11px;color:#5C7377;margin-right:auto;}
      #mctour .mct-btn{font:inherit;font-size:12.5px;border-radius:9px;padding:6px 13px;
        cursor:pointer;border:1px solid #0B6E78;background:#0B6E78;color:#fff;font-weight:800;}
      #mctour .mct-btn:hover{background:#0E9AA7;border-color:#0E9AA7;}
      #mctour .mct-btn.ghost{background:#fff;color:#0B6E78;border-color:#D9ECEE;font-weight:700;}
      #mctour .mct-btn.ghost:hover{border-color:#0E9AA7;background:#fff;}
      #mctour .mct-btn:disabled{opacity:.45;cursor:default;}
      #mctour-pop .mct-tail{position:absolute;width:14px;height:14px;background:#fff;
        border:1px solid #D9ECEE;transform:rotate(45deg);display:none;}
      #mctour-pop.tail-up .mct-tail{display:block;top:-8px;border-right:0;border-bottom:0;}
      #mctour-pop.tail-down .mct-tail{display:block;bottom:-8px;border-left:0;border-top:0;}
      #mctour-pop .mct-x{position:absolute;top:8px;right:9px;width:24px;height:24px;border:0;
        background:none;cursor:pointer;color:#5C7377;font-size:18px;line-height:1;border-radius:6px;}
      #mctour-pop .mct-x:hover{background:#E6F6F8;color:#0B6E78;}
      #mctour-menu{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
        width:calc(100vw - 32px);max-width:600px;background:#fff;border:1px solid #D9ECEE;
        border-radius:16px;box-shadow:0 14px 40px rgba(11,110,120,.28);padding:16px;
        box-sizing:border-box;pointer-events:auto;max-height:90vh;overflow:auto;}
      #mctour-menu .mct-mh{display:flex;align-items:flex-start;gap:11px;margin-bottom:12px;}
      #mctour-menu .mct-mt{font-size:15px;font-weight:800;color:#0B6E78;margin:2px 0 3px;}
      #mctour-menu .mct-ms{font-size:12px;color:#5C7377;line-height:1.5;}
      #mctour-menu h3{font-size:12px;font-weight:800;color:#5C7377;margin:12px 0 6px;}
      #mctour-menu .mct-mlist{display:grid;grid-template-columns:1fr 1fr;gap:7px;}
      #mctour-menu .mct-mi{display:block;width:100%;text-align:left;font:inherit;font-size:13px;
        color:#12292C;background:#F2F9FA;border:1px solid #D9ECEE;
        border-radius:10px;padding:8px 12px;cursor:pointer;font-weight:800;}
      #mctour-menu .mct-mi small{display:block;font-size:11.5px;font-weight:500;color:#5C7377;margin-top:2px;line-height:1.45;}
      #mctour-menu .mct-mi:hover{background:#E6F6F8;border-color:#0E9AA7;}
      #mctour-menu .mct-mi-all{background:#0B6E78;color:#fff;border-color:#0B6E78;padding:10px 13px;}
      #mctour-menu .mct-mi-all small{color:#D5EEF1;}
      #mctour-menu .mct-mi-all:hover{background:#0E9AA7;border-color:#0E9AA7;}
      #mctour-menu .mct-mfoot{margin-top:12px;display:flex;justify-content:flex-end;gap:8px;}
      @media (max-width:560px){#mctour-menu .mct-mlist{grid-template-columns:1fr;}}
      #mcHeadCall .mct-help{order:9;}
    `;
    document.head.appendChild(st);
  }

  // 右上に「使い方・機能」ボタンを置く（今日の数字・キー操作と同じ並びの、いちばん右）
  const helpBtn = document.createElement("button");
  helpBtn.type = "button";
  helpBtn.id = "mctHelpBtn";
  helpBtn.className = "mcc-btn mct-help";
  helpBtn.title = "MOCHICALL の使い方と機能の案内を開きます";
  helpBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H11v15H6.5A2.5 2.5 0 0 0 4 21z"/><path d="M20 6.5A2.5 2.5 0 0 0 17.5 4H13v15h4.5A2.5 2.5 0 0 1 20 21z"/></svg>使い方・機能';
  helpBtn.addEventListener("click", () => openMenu());
  head.appendChild(helpBtn);

  // 土台
  const AVA = '<div class="mct-ava"><img src="/shobo.svg" alt="" /></div>';
  const root = document.createElement("div");
  root.id = "mctour";
  root.innerHTML =
    '<div id="mctour-hole"></div>' +
    '<div id="mctour-pop" role="dialog" aria-label="MOCHICALL の使い方">' +
      '<span class="mct-tail"></span>' +
      '<button type="button" class="mct-x" data-act="skip" aria-label="とじる">×</button>' +
      '<div class="mct-top">' + AVA +
        '<div><div class="mct-ttl"></div><div class="mct-body"></div></div>' +
      '</div>' +
      '<div class="mct-foot">' +
        '<span class="mct-step"></span>' +
        '<button type="button" class="mct-btn ghost" data-act="menu">一覧</button>' +
        '<button type="button" class="mct-btn ghost" data-act="back">戻る</button>' +
        '<button type="button" class="mct-btn" data-act="next">次へ</button>' +
      '</div>' +
    '</div>' +
    '<div id="mctour-menu" role="dialog" aria-label="MOCHICALL の使い方・機能" hidden>' +
      '<div class="mct-mh">' + AVA +
        '<div><div class="mct-mt">MOCHICALL の使い方・機能</div>' +
        '<div class="mct-ms">流れを通して見るか、知りたい機能を選んでください。選ぶと、その場所まで案内します。画面の部品にカーソルを2秒合わせても、解説が出ます。</div></div>' +
      '</div>' +
      '<h3>使い方</h3><div class="mct-mall"></div>' +
      '<h3>機能</h3><div class="mct-mlist"></div>' +
      '<div class="mct-mfoot"><button type="button" class="mct-btn ghost mct-mkeys">キー操作の一覧</button><button type="button" class="mct-btn ghost mct-mclose">とじる</button></div>' +
    '</div>';
  document.body.appendChild(root);

  const hole = root.querySelector("#mctour-hole");
  const pop = root.querySelector("#mctour-pop");
  const menuCard = root.querySelector("#mctour-menu");
  const menuAll = menuCard.querySelector(".mct-mall");
  const menuList = menuCard.querySelector(".mct-mlist");
  const elTtl = pop.querySelector(".mct-ttl");
  const elBody = pop.querySelector(".mct-body");
  const elStep = pop.querySelector(".mct-step");
  const btnBack = pop.querySelector('[data-act="back"]');
  const btnNext = pop.querySelector('[data-act="next"]');
  const tail = pop.querySelector(".mct-tail");

  let idx = 0;
  let steps = [];
  let homeTab = null;   // 案内を始める前に開いていたタブ（終わったらここへ戻す）
  const isOn = () => root.classList.contains("on");
  const curTab = () => { const b = document.querySelector('#mccTabs [aria-selected="true"]'); return b ? b.dataset.t : null; };
  // タブの切り替えは、画面のタブを押すのと同じ動きにする（mccall.js の中の処理を直接は呼ばない）
  function switchTab(t) {
    if (!t || curTab() === t) return;
    const b = document.querySelector(`#mccTabs [data-t="${t}"]`);
    if (b) b.click();
  }

  function findTarget(step) {
    for (const q of step.sel || []) {
      const el = document.querySelector(q);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) return el;
    }
    return null;
  }

  function place(step) {
    if (!isOn() || !menuCard.hidden || !step) return;
    const target = findTarget(step);
    if (target) { try { target.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch {} }
    requestAnimationFrame(() => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const rect = target ? target.getBoundingClientRect() : null;
      root.classList.toggle("dim", !rect);
      if (rect) {
        const pad = 6;
        const l = Math.max(2, rect.left - pad), t = Math.max(2, rect.top - pad);
        hole.style.display = "block";
        hole.style.left = l + "px";
        hole.style.top = t + "px";
        hole.style.width = Math.min(vw - 2 - l, rect.right + pad - l) + "px";
        hole.style.height = Math.min(vh - 2 - t, rect.bottom + pad - t) + "px";
      } else {
        hole.style.display = "none";
      }
      // ふきだしの位置：下 → 上 → 横 → 中（光らせた場所が大きくて外に置けないとき）の順に、置ける所を探す
      const pw = pop.offsetWidth, ph = pop.offsetHeight, gap = 16;
      const clampTop = (v) => Math.max(10, Math.min(vh - ph - 10, v));
      pop.classList.remove("tail-up", "tail-down");
      if (!rect) {
        pop.style.top = Math.max(10, vh / 2 - ph / 2) + "px";
        pop.style.left = Math.max(12, vw / 2 - pw / 2) + "px";
        return;
      }
      let top, left = Math.max(12, Math.min(rect.left + rect.width / 2 - pw / 2, vw - pw - 12));
      if (rect.bottom + gap + ph <= vh) { top = rect.bottom + gap; pop.classList.add("tail-up"); }
      else if (rect.top - gap - ph >= 0) { top = rect.top - gap - ph; pop.classList.add("tail-down"); }
      else if (rect.right + gap + pw <= vw) { left = rect.right + gap; top = clampTop(rect.top + 12); }
      else if (rect.left - gap - pw >= 0) { left = rect.left - gap - pw; top = clampTop(rect.top + 12); }
      else { left = Math.max(12, Math.min(rect.right, vw) - pw - 20); top = clampTop(Math.min(rect.bottom, vh) - ph - 20); }
      pop.style.top = top + "px";
      pop.style.left = left + "px";
      const center = Math.max(left + 16, Math.min(rect.left + rect.width / 2, left + pw - 16));
      tail.style.left = center - left - 7 + "px";
    });
  }

  function render() {
    const step = steps[idx];
    if (!step) return finish();
    switchTab(step.tab);
    elTtl.textContent = step.title;
    elBody.textContent = step.body;
    elStep.textContent = `${idx + 1} / ${steps.length}`;
    btnBack.disabled = idx === 0;
    btnNext.textContent = idx === steps.length - 1 ? "おわり" : "次へ";
    try { btnNext.focus({ preventScroll: true }); } catch {}
    // タブの切り替え・読み込みが終わってから位置を測る（レポートなどは少し遅れて中身が出るので、もう一度測り直す）
    setTimeout(() => place(step), 60);
    setTimeout(() => { if (steps[idx] === step) place(step); }, 500);
  }

  function open() {
    if (!isOn()) homeTab = curTab();
    // 書きかけの入力欄にキーが入らないように、案内の間は入力欄から出ておく
    try { if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); } catch {}
    root.classList.add("on");
  }

  function start(from) {
    steps = buildSteps();
    if (!steps.length) return;
    open();
    idx = Math.max(0, Math.min(from || 0, steps.length - 1));
    menuCard.hidden = true;
    pop.style.display = "";
    render();
  }

  // 一覧：通して見るか、知りたい機能だけを選ぶ
  function openMenu() {
    steps = buildSteps();
    if (!steps.length) return;
    open();
    const add = (box, label, sub, cls, on) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mct-mi" + (cls ? " " + cls : "");
      b.textContent = label;
      if (sub) { const sm = document.createElement("small"); sm.textContent = sub; b.appendChild(sm); }
      b.addEventListener("click", on);
      box.appendChild(b);
      return b;
    };
    menuAll.innerHTML = ""; menuList.innerHTML = "";
    const first = add(menuAll, "最初から通して見る", "1件かける流れを、画面の場所ごとに順番に案内します（1分ほど）", "mct-mi-all", () => start(0));
    // 導入・まとめ以外を、機能として並べる
    steps.forEach((s, i) => {
      if (i === 0 || i === steps.length - 1) return;
      add(menuList, s.title, s.short || "", "", () => start(i));
    });
    pop.style.display = "none";
    hole.style.display = "none";
    root.classList.add("dim");
    menuCard.hidden = false;
    try { first.focus({ preventScroll: true }); } catch {}
  }

  function finish() {
    root.classList.remove("on", "dim");
    menuCard.hidden = true;
    pop.style.display = "";
    try { localStorage.setItem(SEEN_KEY, "1"); } catch {}
    // 案内のために切り替えたタブを、元に戻しておく
    if (homeTab) switchTab(homeTab);
    homeTab = null;
  }

  const next = () => { if (idx < steps.length - 1) { idx++; render(); } else finish(); };
  const back = () => { if (idx > 0) { idx--; render(); } };
  pop.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-act]");
    if (!b) return;
    const act = b.dataset.act;
    if (act === "skip") return finish();
    if (act === "menu") return openMenu();
    if (act === "back") return back();
    if (act === "next") return next();
  });
  menuCard.querySelector(".mct-mclose").addEventListener("click", finish);
  // キー操作の一覧は、もとからある「キー操作」の窓をそのまま開く（同じ説明を2か所に持たないため）
  menuCard.querySelector(".mct-mkeys").addEventListener("click", () => { finish(); switchTab("call"); const k = $("mccHelpBtn"); if (k) k.click(); });

  // 画面の大きさが変わったら、位置を測り直す
  let rz;
  window.addEventListener("resize", () => {
    if (!isOn() || !menuCard.hidden) return;
    clearTimeout(rz);
    rz = setTimeout(() => place(steps[idx]), 120);
  });
  // 案内の間は、キーを架電の画面に渡さない（C で発信・数字で結果の記録などが、案内の裏で動いてしまわないように）。
  //   架電の画面より先に受け取るために、window のキャプチャで聞く
  window.addEventListener("keydown", (ev) => {
    if (!isOn()) return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey || /^F\d+$/.test(ev.key)) return;   // 読み込み直しなどブラウザの操作は止めない
    ev.stopImmediatePropagation();
    if (ev.key === "Tab") return;
    const onBtn = ev.target && ev.target.closest && ev.target.closest("#mctour button");
    if (onBtn && (ev.key === "Enter" || ev.key === " ")) return;   // 選んでいるボタンを押すのは、そのまま通す
    ev.preventDefault();
    if (ev.key === "Escape") return finish();
    if (!menuCard.hidden) return;   // 一覧を出しているときは矢印で動かさない
    if (ev.key === "ArrowRight" || ev.key === "Enter") next();
    else if (ev.key === "ArrowLeft") back();
  }, true);

  // 初めての人には自動で出す。架電の画面の中身が出そろってから（会社が出る前に始めると、光らせる場所がまだ無い）。
  //   自動操作のブラウザ（確認用のスクリプト）では出さない。画面をおおって、ボタンを押す確認を止めてしまうため
  let seen = "1";
  try { seen = localStorage.getItem(SEEN_KEY); } catch {}
  const ready = () => { const p = pane(), tabs = $("mccTabs"), c = $("mccCenter"); return !!(p && !p.hidden && tabs && tabs.children.length && c && c.children.length); };
  let tries = 0, timer = null;
  function autoStart() {
    if (seen || navigator.webdriver || timer) return;
    const p = pane();
    if (!p || p.hidden) return;
    tries = 0;
    timer = setInterval(() => {
      const p2 = pane();
      if (!p2 || p2.hidden || ++tries > 40) { clearInterval(timer); timer = null; return; }
      if (!ready()) return;
      clearInterval(timer); timer = null;
      // もう発信している・窓が開いている・すでに案内を開いているときは、じゃまをしない
      if (isOn() || document.querySelector(".mcc-dialed") || document.querySelector(".mcc-dlg")) return;
      seen = "1";
      start(0);
    }, 500);
  }
  if (!seen && !navigator.webdriver) {
    if (window.MutationObserver) new MutationObserver(autoStart).observe(pane(), { attributes: true, attributeFilter: ["hidden"] });
    autoStart();
  }
})();
