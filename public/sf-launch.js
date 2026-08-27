// sf-launch.js — カレンダーの【初回】【新/ヒ】の予定から、Salesforceのリードを探して商談を立ち上げる
const $l = (id) => document.getElementById(id);
const escL = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const cssEscL = (v) => (window.CSS && window.CSS.escape) ? window.CSS.escape(v) : String(v).replace(/["\\]/g, "\\$&");
const CO_HINT_L = /(株式会社|有限会社|合同会社|合資会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|医療法人|学校法人|社会福祉法人|㈱|\(株\)|（株）|Inc|Corp|LLC|Ltd)/i;

function ymdL(d) {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, "0");
  return x.getFullYear() + "-" + p(x.getMonth() + 1) + "-" + p(x.getDate());
}
const todayL = ymdL(new Date());
let selDateL = todayL;
let leadFields = null;     // 入力項目の定義（Salesforceのdescribeから）
let convertedStatus = "";
let convertedStatuses = [];
const state = {};          // 予定ごとの状態

// かっこ類を【】にそろえてから中身を落とす
function stripTags(title) {
  return String(title || "")
    .replace(/[［\[〔（(]/g, "【")
    .replace(/[］\]〕）)]/g, "】")
    .replace(/【[^】]*】/g, " ");
}

// 予定タイトルから会社名を取り出す
// タイトルを整える：先頭「メルマガ」を落とし、【】の後を使い、（株）等を正式名称に直す
function normTitleL(title) {
  let s = String(title || "").normalize("NFKC").replace(/^\s*メルマガ\s*/, "");
  const mi = s.lastIndexOf("】");        // 【初回】等の後を会社名側とする
  if (mi >= 0) s = s.slice(mi + 1);
  s = s.replace(/[（(]\s*株\s*[）)]|㈱/g, "株式会社")
       .replace(/[（(]\s*有\s*[）)]|㈲/g, "有限会社")
       .replace(/[（(]\s*合\s*[）)]/g, "合同会社");
  return s.replace(/[（(][^）)]*[）)]/g, " ").replace(/\s+/g, " ").trim();
}
const CORP_SPLIT = /(株式会社|有限会社|合同会社|合資会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|医療法人|社会福祉法人|学校法人|協同組合)/;
function stripHonL(s) { return String(s || "").replace(/\s*(様|さま|さん|殿|御中)\s*$/u, "").trim(); }
// 会社名と担当者を分ける（スラッシュ／法人格の位置／空白で判定）
function splitCoPerson(title) {
  const s = normTitleL(title);
  const slash = s.split(/[\/／|｜]/).map((x) => x.trim()).filter(Boolean);
  if (slash.length >= 2) return { company: slash.slice(0, -1).join(" ").trim(), person: stripHonL(slash[slash.length - 1]) };
  // 会社名＋担当者が連結している場合（例：アルスホーム株式会社杉原様）は、法人格の直後で切る
  const m = s.match(CORP_SPLIT);
  if (m && m.index > 0) {
    const end = m.index + m[0].length;
    const company = s.slice(0, end).trim();
    const rest = s.slice(end).trim();
    const person = rest ? stripHonL(rest.split(/[\s　]+/).pop()) : "";
    return { company, person };
  }
  const toks = s.split(/[\s　]+/).filter(Boolean);
  if (toks.length >= 2) return { company: toks.slice(0, -1).join(" "), person: stripHonL(toks[toks.length - 1]) };
  return { company: s, person: "" };
}
function companyOf(title) {
  return splitCoPerson(title).company.replace(/[\s　]/g, "").replace(/(様|さま|さん|御中)$/u, "").trim();
}
// 予定タイトルから担当者名を取り出す（様が無くても）
function personOf(title) {
  return String(splitCoPerson(title).person || "").replace(/[^\p{L}\p{N}ー]/gu, "").trim();
}
// 【初回】【新/ヒ】の判定。かっこ・スラッシュ・スペースは半角全角どちらでもOK。
function isTarget(title) {
  const t = String(title || "")
    .replace(/[［\[〔（(]/g, "【")
    .replace(/[］\]〕）)]/g, "】")
    .replace(/[／]/g, "/")
    .replace(/[\s　]/g, "");
  return /【[^】]*初回/.test(t) || /【[^】]*新\/ヒ/.test(t) || /【[^】]*新規/.test(t);
}

// 予定を登録した人のメールアドレス
function creatorEmailOf(e) {
  return String(e.creator || e.organizer || e.calendarOwner || "").toLowerCase();
}
// 表示名（インターン一覧・メンバー一覧にあれば名前、無ければメールの@より前）
function creatorNameOf(e) {
  const em = creatorEmailOf(e);
  if (nameByEmail[em]) return nameByEmail[em];
  return e.creatorName || e.organizerName || (em ? em.split("@")[0] : "");
}

// クロスのリードか、MOCHICAのリードかを見分ける。
// 種別はレコードタイプで決まる。所有者名や状況は種別ではないので混ぜない
// （「MOCHICA 管理者」が所有者だとMOCHICAリードに見えてしまうため）。
function leadKind(r) {
  const rt = (r.RecordType && r.RecordType.Name) || "";
  const decide = (v) => {
    if (/mochica/i.test(v)) return { label: "MOCHICAリード", cls: "is-mochica" };
    if (/クロス|cross/i.test(v)) return { label: "クロスリード", cls: "is-cross" };
    return null;
  };
  return decide(rt) || decide(r.LeadSource || "") ||
    { label: rt || r.LeadSource || "種別不明", cls: "is-other" };
}

function stOf(key) {
  if (!state[key]) state[key] = { open: false, mode: "search", loading: false, error: "", leads: null, picked: null, done: null, q: "", qp: "" };
  return state[key];
}

function dateLabelL(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" });
}

// ---- 入力フォーム ----
function fieldInput(f, key, value) {
  if (!f.found) {
    return `<div class="ln-missing">「${escL(f.label)}」はSalesforceに見つかりませんでした（入力せずに進みます）</div>`;
  }
  const id = `f_${key}_${f.key}`;
  const req = f.required ? ' <span class="sf-req">＊必須</span>' : "";
  if (isRef(f)) {
    return `<div class="sf-field"><label>${escL(f.label)}${req}</label>${lookupHtml(f, "data-api", "", "")}</div>`;
  }
  if (f.options && f.options.length) {
    const opts = ['<option value=""></option>'].concat(
      f.options.map((o) => `<option value="${escL(o.value)}" ${o.value === value || o.label === value ? "selected" : ""}>${escL(o.label)}</option>`)
    ).join("");
    return `<div class="sf-field"><label>${escL(f.label)}${req}</label><select class="sf-select" id="${id}" data-api="${escL(f.name)}">${opts}</select></div>`;
  }
  if (f.type === "date") {
    return `<div class="sf-field"><label>${escL(f.label)}${req}</label><input type="date" class="sf-input" id="${id}" data-api="${escL(f.name)}" value="${escL(value || "")}"/></div>`;
  }
  if (f.type === "int" || f.type === "double") {
    return `<div class="sf-field"><label>${escL(f.label)}${req}</label><input type="number" class="sf-input" id="${id}" data-api="${escL(f.name)}" data-num="1" value="${escL(value || "")}"/></div>`;
  }
  if (f.type === "textarea") {
    return `<div class="sf-field"><label>${escL(f.label)}${req}</label><textarea class="sf-textarea" id="${id}" data-api="${escL(f.name)}" rows="2">${escL(value || "")}</textarea></div>`;
  }
  return `<div class="sf-field"><label>${escL(f.label)}${req}</label><input type="text" class="sf-input" id="${id}" data-api="${escL(f.name)}" value="${escL(value || "")}"/></div>`;
}

function formHtml(key, ev) {
  const s = stOf(key);
  const lead = s.picked;
  const def = (k) => {
    // リードにすでに入っていればそれを使い、空なら「アウトバウンド」を選ぶ
    if (k === "leadSource") {
      if (lead.LeadSource) return lead.LeadSource;
      const f = (leadFields || []).find((x) => x.key === "leadSource");
      const hit = (f && f.options || []).find((o) =>
        /アウトバウンド|outbound/i.test(`${o.value} ${o.label}`));
      return hit ? hit.value : "";
    }
    // FSへの案件パス情報は、毎回同じ形で入れる
    if (k === "fsNote") return "-";
    if (k === "campaign") return "";  // 参照項目なので、検索で選ぶ（初期値は自動で3Dメタバース）
    if (k === "visitDate") return s.evDate || selDateL;  // 商談の開催日
    if (k === "apoDate") return selDateL;                // 予定を登録した日＝アポ獲得日
    if (k === "website") return lead.Website || "";
    if (k === "phone") return lead.Phone || "";
    if (k === "postal") return lead.PostalCode || "";
    // 住所は、都道府県・市区郡・町名番地に分けて表示する（1欄にまとまっている場合は分解する）
    if (k === "state" || k === "city" || k === "address") {
      const parts = splitAddr(dedupeAddr(lead.Street || ""));
      if (k === "state") return lead.State || parts.state;
      if (k === "city") return lead.City || parts.city;
      return (lead.State || lead.City) ? dedupeAddr(lead.Street || "") : (parts.street || dedupeAddr(lead.Street || ""));
    }
    if (k === "employees") return lead.NumberOfEmployees != null ? String(lead.NumberOfEmployees) : "";
    // この組織で必須の項目は、リードにすでに入っている値を出す
    if (String(k).startsWith("req_")) {
      const api = String(k).slice(4);
      const v = lead[api];
      return v == null ? "" : String(v);
    }
    return "";
  };
  const main = (leadFields || []).filter((f) => !String(f.key).startsWith("req_"));
  const reqs = (leadFields || []).filter((f) => String(f.key).startsWith("req_"));
  const fields = main.map((f) => fieldInput(f, key, def(f.key))).join("") +
    (reqs.length ? `<div class="ln-group">この組織で必須の項目</div>` + reqs.map((f) => fieldInput(f, key, def(f.key))).join("") : "");
  return `<div class="ln-form">
    <div class="ln-lead">
      <div class="home-sf-name">${escL(lead.Name || "")}（${escL(lead.Company || "")}）<span class="ln-kind ${leadKind(lead).cls}">${escL(leadKind(lead).label)}</span></div>
      <div class="home-sf-meta">${escL(lead.Status || "")}${lead.Owner && lead.Owner.Name ? " ・ " + escL(lead.Owner.Name) : ""}${lead.Email ? " ・ " + escL(lead.Email) : ""}</div>
      ${leadKind(lead).cls === "is-cross" ? "" :
        `<button type="button" class="btn sf-btn-secondary home-sf-mini ln-to-cross" data-ln-cross="${escL(key)}" data-id="${escL(lead.Id || "")}">クロスリードに変更する</button>`}
      <div class="ln-cross-note"></div>
    </div>
    <div class="ln-gbiz">
      <button type="button" class="btn sf-btn-secondary home-sf-mini" data-ln-gbiz="${escL(key)}">会社情報を取り込む（gBizINFO・既存データ）</button>
      <div class="ln-gbiz-note"></div>
    </div>
    ${fields}
    ${s.error ? `<div class="home-sf-err">${escL(s.error)}</div>` : ""}
    ${convertedStatuses.length > 1 ? `<div class="sf-field"><label>コンバート後のリード状況</label><select class="sf-select" id="cs_${escL(key)}" data-convstatus="1">${convertedStatuses.map((c) => `<option value="${escL(c.value)}" ${c.value === convertedStatus ? "selected" : ""}>${escL(c.label)}</option>`).join("")}</select></div>` : ""}
    <div class="home-sf-row">
      <button class="btn" data-ln-go="${escL(key)}" type="button"${s.loading ? " disabled" : ""}>${s.loading ? "立ち上げ中…" : "この内容で立ち上げる"}</button>
      <button class="btn sf-btn-secondary home-sf-mini" data-ln-back="${escL(key)}" type="button">別のリードを選ぶ</button>
    </div>
    <div class="home-sf-note">主キャンペーンソースは「3Dメタバース」、初回訪問日はこの予定の日、アポ獲得日は今日を初期値にしています。</div>
  </div>`;
}

// 新規リード作成フォーム
function createFormHtml(key, ev) {
  const s = stOf(key);
  const title = ev ? ev.title : "";
  const def = (f) => {
    if (f.name === "Company") return companyOf(title);
    // 姓は、予定名の担当者名から「様」を外したもの
    if (f.name === "LastName") return personOf(title);
    if (/主?キャンペーン/.test(f.label)) return "3Dメタバース";
    if (/初回(訪問|商談)日/.test(f.label)) return s.evDate || selDateL;
    if (/アポ獲得日/.test(f.label)) return selDateL;
    // リードソースは、選択肢の中から「アウトバウンド」に当たるものを選ぶ
    if (f.name === "LeadSource" || /リードソース/.test(f.label)) {
      const hit = (f.options || []).find((o) =>
        /アウトバウンド|outbound/i.test(`${o.value} ${o.label}`));
      return hit ? hit.value : "";
    }
    // FSへの案件パス情報・連携事項は、毎回同じ形で入れる
    if (/(FS|ＦＳ|フィールドセールス)/i.test(f.label)) return "-";
    return "";
  };
  const groups = [
    { key: "基本", title: "基本情報" },
    { key: "立ち上げ", title: "立ち上げに使う項目" },
    { key: "必須", title: "この組織で必須の項目" },
  ];
  let html = "";
  for (const g of groups) {
    const fs = (createFields || []).filter((f) => f.group === g.key);
    if (!fs.length) continue;
    html += `<div class="ln-group">${escL(g.title)}</div>` + fs.map((f) => {
      const id = `nf_${key}_${f.name}`;
      const req = f.required || f.name === "LastName" || f.name === "Company" ? ' <span class="sf-req">＊必須</span>' : "";
      const v = def(f);
      if (isRef(f)) {
        return `<div class="sf-field"><label>${escL(f.label)}${req}</label>${lookupHtml(f, "data-newapi", "", "")}</div>`;
      }
      if (f.options && f.options.length) {
        const opts = ['<option value=""></option>'].concat(
          f.options.map((o) => `<option value="${escL(o.value)}" ${o.value === v || o.label === v ? "selected" : ""}>${escL(o.label)}</option>`)
        ).join("");
        return `<div class="sf-field"><label>${escL(f.label)}${req}</label><select class="sf-select" id="${id}" data-newapi="${escL(f.name)}">${opts}</select></div>`;
      }
      if (f.type === "date") return `<div class="sf-field"><label>${escL(f.label)}${req}</label><input type="date" class="sf-input" id="${id}" data-newapi="${escL(f.name)}" value="${escL(v)}"/></div>`;
      if (f.type === "int" || f.type === "double") return `<div class="sf-field"><label>${escL(f.label)}${req}</label><input type="number" class="sf-input" id="${id}" data-newapi="${escL(f.name)}" data-num="1" value="${escL(v)}"/></div>`;
      if (f.type === "textarea") return `<div class="sf-field"><label>${escL(f.label)}${req}</label><textarea class="sf-textarea" id="${id}" data-newapi="${escL(f.name)}" rows="2">${escL(v)}</textarea></div>`;
      return `<div class="sf-field"><label>${escL(f.label)}${req}</label><input type="text" class="sf-input" id="${id}" data-newapi="${escL(f.name)}" value="${escL(v)}"/></div>`;
    }).join("");
  }
  const rtList = window._leadRecordTypes || null;
  const rtCross = window._leadCrossId || "";
  const rtHtml = rtList && rtList.length
    ? `<div class="sf-field"><label>リードの種別</label>
         <select class="sf-input" id="lnRecordType">
           ${rtList.map((t) => `<option value="${escL(t.id)}"${t.id === rtCross ? " selected" : ""}>${escL(t.name)}</option>`).join("")}
         </select>
         <div class="ln-rt-note">${rtCross ? "既定はクロスリードです。必要なときだけ変えてください。" : "クロスのレコードタイプが見つかりませんでした。"}</div>
       </div>`
    : "";

  return `<div class="ln-form">
    <div class="ln-group">新しいリードを作る</div>
    ${rtHtml}
    <div class="ln-gbiz">
      <button type="button" class="btn sf-btn-secondary home-sf-mini" data-ln-gbiz="${escL(key)}">gBizINFOから会社情報を取り込む</button>
      <div class="ln-gbiz-note"></div>
    </div>
    ${createFields ? html : '<div class="home-sf-msg">項目を読み込み中…</div>'}
    ${s.error ? `<div class="home-sf-err">${escL(s.error)}</div>` : ""}
    <div class="home-sf-row">
      <button class="btn" data-ln-create="${escL(key)}" type="button"${s.loading ? " disabled" : ""}>${s.loading ? "作成中…" : "リードを作成する"}</button>
      <button class="btn sf-btn-secondary home-sf-mini" data-ln-cancel="${escL(key)}" type="button">やめる</button>
    </div>
    <div class="home-sf-note">リードソースは「アウトバウンド」、主キャンペーンソースは「3Dメタバース」、姓は予定名の担当者名を初期値にしています。<br>
      作成したあと、続けて「この内容で立ち上げる」でコンバートできます。</div>
  </div>`;
}

function panelHtml(key, ev) {
  const s = stOf(key);
  if (!s.open) return "";
  if (s.mode === "create") return `<div class="home-sf">${createFormHtml(key, ev)}</div>`;
  if (s.done) {
    const u = s.done;
    return `<div class="home-sf">
      <div class="home-sf-done">
        ${u.opportunityId
          ? `Salesforceで立ち上げました${u.createdOpportunity ? "（商談も作成しました）" : ""}`
          : u.restoredLeadId ? "立ち上げできなかったので、<b>元に戻しました</b>" : "リードは変換しましたが、<b>商談は作られていません</b>"}
      </div>
      ${u.warning ? `<div class="home-sf-err">${escL(u.warning)}</div>` : ""}
      ${!u.opportunityId && !u.warning ? `<div class="home-sf-err">Salesforceで商談を手動で作成してください。</div>` : ""}
      ${u.restoredLeadId ? `<div class="home-sf-msg">リードを作り直したので、原因を直したあとにもう一度立ち上げられます。</div>` : ""}
      <div class="home-sf-row">
        ${u.opportunityId ? `<a class="btn" href="${escL(u.instanceUrl)}/${escL(u.opportunityId)}" target="_blank" rel="noopener">商談を開く</a>` : ""}
        ${u.accountId ? `<a class="home-sf-link" href="${escL(u.instanceUrl)}/${escL(u.accountId)}" target="_blank" rel="noopener">取引先を開く</a>` : ""}
      </div>
    </div>`;
  }
  if (s.picked) return `<div class="home-sf">${formHtml(key, ev)}</div>`;

  let inner = "";
  if (s.loading) inner = `<div class="home-sf-msg">検索中…</div>`;
  else if (s.error) inner = `<div class="home-sf-err">${escL(s.error)}</div>`;
  else if (s.leads && !s.leads.length) inner = `<div class="home-sf-msg">一致するリードが見つかりませんでした。会社名の書き方（正式名称・略称）を変えて検索してください。</div>`;
  else if (s.leads) {
    inner = `<div class="home-sf-list">` + s.leads.map((r) => `
      <button class="home-sf-item" data-ln-pick="${escL(key)}" data-id="${escL(r.Id)}" type="button">
        <span class="home-sf-name">${escL(r.Name || "")}<span class="ln-kind ${leadKind(r).cls}">${escL(leadKind(r).label)}</span></span>
        <span class="home-sf-meta">${escL(r.Company || "")}${r.Status ? " ・ " + escL(r.Status) : ""}${r.Owner && r.Owner.Name ? " ・ " + escL(r.Owner.Name) : ""}</span>
      </button>`).join("") + `</div>`;
  }
  return `<div class="home-sf">
    <div class="home-sf-search">
      <input type="text" class="home-sf-input" data-ln-q="${escL(key)}" value="${escL(s.q)}" placeholder="会社名で検索" />
      <button class="btn sf-btn-secondary home-sf-mini" data-ln-search="${escL(key)}" type="button">検索</button>
    </div>
    ${inner}
    <div class="home-sf-row" style="margin-top:10px">
      <button class="btn sf-btn-secondary home-sf-mini" data-ln-new="${escL(key)}" type="button">リードが無いので新規作成する</button>
    </div>
  </div>`;
}

let dayEventsL = [];
let memberCount = 0;
let nameByEmail = {};   // メール → 表示名
let ownerFilter = null; // 表示する登録者（null＝全員）
let launched = {};      // 会社名 → すでにある商談
let sfInstanceUrl = "";
let createFields = null; // 新規リード作成の入力項目
let lastLoad = { cached: false, agoSec: 0 }; // 直近の読み込みが、覚えていたものかどうか
let autoOpened = false;  // 埋め込みでパネルを自動で開いたか
function render() {
  const box = $l("lnList");
  $l("lnTitle").textContent = (selDateL === todayL ? "今日" : dateLabelL(selDateL)) + "に登録された【初回】【新/ヒ】の予定" + (memberCount ? `（${memberCount}名分）` : "");
  const rl = $l("lnReload");
  if (rl) rl.title = lastLoad.cached
    ? `${lastLoad.agoSec}秒前に読んだ内容を出しています。押すと読み直します。`
    : "カレンダーを読み直します";
  const pick = $l("lnDate");
  if (pick && pick.value !== selDateL) pick.value = selDateL;
  const tb = $l("lnToday");
  if (tb) tb.style.visibility = selDateL === todayL ? "hidden" : "visible";

  let all = (dayEventsL || []).filter((e) => isTarget(e.title));
  // 埋め込みで q（会社名）が渡されたときは、カレンダーの予定は探さず、
  // 最初から会社名で直接SFのリード（クロスリード）を探す。
  if (focusQ) {
    const co = companyOf(focusQ) || focusQ;
    all = [{ id: "__q__:" + co, title: focusQ, start: null, __direct: true }];
  }
  renderOwnerFilter(all);
  let list = ownerFilter ? all.filter((e) => ownerFilter.has(creatorEmailOf(e))) : all;
  if (!list.length) {
    box.innerHTML = `<div class="home-empty">${
      focusQ ? "この予定はSalesforce立ち上げの対象ではありません（タイトルに【初回】【新/ヒ】が必要です）。"
             : all.length ? "選んだ登録者の予定はありません。" : "この日に登録された【初回】【新/ヒ】の予定はありません。"}</div>`;
    return;
  }
  // 1件だけなら、リード検索のパネルを自動で開く
  if (focusQ && list.length === 1 && !autoOpened) {
    autoOpened = true;
    const k0 = list[0].id || (list[0].title + "@" + list[0].start);
    setTimeout(() => { const b = box.querySelector(`[data-ln-open="${cssEscL(k0)}"]`); if (b) b.click(); }, 60);
  }
  box.innerHTML = list.map((e) => {
    const key = e.id || (e.title + "@" + e.start);
    const s = stOf(key);
    const when = e.start
      ? new Date(e.start).toLocaleString("ja-JP", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" })
      : "日時未定";
    const madeAt = e.created ? new Date(e.created).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : "";
    const who = creatorNameOf(e);
    const done = launched[companyOf(e.title)] || null;
    return `<div class="home-card home-card-v" data-ev="${escL(key)}">
      <div class="home-card-row">
        <div class="home-card-main">
          <div class="home-card-top"><span class="home-time">${escL(when)}</span>${done ? `<span class="home-badge home-badge-done">立ち上げ済み</span>` : `<span class="home-badge home-badge-plan">商談予定</span>`}${madeAt ? `<span class="home-badge home-badge-st">${escL(madeAt)}に登録</span>` : ""}</div>
          <div class="home-card-title">${escL(e.title || "")}</div>
          <div class="home-card-meta">会社名：${escL(companyOf(e.title) || "—")}　／　担当者：${escL(personOf(e.title) || "—")}</div>
          <div class="home-card-meta ln-who">
            ${e.apoBy ? `<span class="ln-tag ln-tag-intern">アポ獲得：${escL(e.apoBy)}</span>` : (who ? `<span class="ln-tag">登録者：${escL(who)}</span>` : "")}
            ${e.assigneeName ? `<span class="ln-tag ln-tag-rep">担当営業：${escL(e.assigneeName)}</span>` : `<span class="ln-tag ln-tag-none">担当営業：未割り当て</span>`}
          </div>
          ${done ? `<div class="home-card-meta">SF商談：${escL(done.name)}${done.stage ? "（" + escL(done.stage) + "）" : ""}</div>` : ""}
        </div>
        <div class="home-card-actions">
          ${done && sfInstanceUrl ? `<a class="btn" href="${escL(sfInstanceUrl)}/${escL(done.id)}" target="_blank" rel="noopener">SFで開く</a>` : ""}
          <button class="btn${done ? " sf-btn-secondary" : ""}" data-ln-open="${escL(key)}" type="button">${s.open ? "閉じる" : "リードを探す"}</button>
        </div>
      </div>
      ${panelHtml(key, e)}
    </div>`;
  }).join("");
}

// 登録者のチェックボックス絞り込み
function renderOwnerFilter(events) {
  const wrap = $l("lnOwners");
  if (!wrap) return;
  const map = new Map();
  for (const e of events) {
    const em = creatorEmailOf(e);
    if (!em) continue;
    if (!map.has(em)) map.set(em, { email: em, name: creatorNameOf(e), n: 0 });
    map.get(em).n++;
  }
  const people = [...map.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "ja"));
  if (!people.length) { wrap.innerHTML = ""; return; }
  if (!ownerFilter) ownerFilter = new Set(people.map((p) => p.email)); // 初期は全員
  // その日にいない人は外す
  for (const em of [...ownerFilter]) if (!map.has(em)) ownerFilter.delete(em);

  const on = people.filter((p) => ownerFilter.has(p.email)).length;
  const label = on === people.length ? "登録者：全員" : `登録者：${on}人を表示中`;
  const open = wrap.dataset.open === "1";
  wrap.innerHTML =
    `<button type="button" class="ln-owner-btn" id="lnOwnerBtn">${escL(label)}
       <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M6 9.5 12 15.5 18 9.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
     </button>` +
    (open ? `<div class="ln-owner-menu">
       <div class="ln-owner-actions">
         <button type="button" class="ln-owner-mini" data-owner-all="1">全員</button>
         <button type="button" class="ln-owner-mini" data-owner-none="1">全解除</button>
       </div>
       ${people.map((p) => `<label class="ln-owner-item">
          <input type="checkbox" data-owner="${escL(p.email)}" ${ownerFilter.has(p.email) ? "checked" : ""}/>
          <span class="ln-owner-name">${escL(p.name)}</span><span class="ln-owner-n">${p.n}</span>
        </label>`).join("")}
     </div>` : "");
}

async function searchLeads(key) {
  const s = stOf(key);
  s.loading = true; s.error = ""; s.leads = null;
  render();
  try {
    // 会社名だけで検索する（担当者名を混ぜると別の会社まで拾ってしまうため）
    const r = await fetch(`/api/salesforce/leads?company=${encodeURIComponent(s.q)}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "検索に失敗しました");
    s.leads = d.records || [];
  } catch (e) {
    s.error = e.message;
  } finally {
    s.loading = false;
    render();
  }
}

async function loadCreateFields() {
  if (createFields) { await loadLeadRecordTypes(); render(); return; }
  try {
    const r = await fetch("/api/salesforce/lead-create-fields");
    const d = await r.json().catch(() => ({}));
    if (r.ok) createFields = d.fields || [];
  } catch {}
  // リードの種別（クロス／直販など）も一緒に読む
  await loadLeadRecordTypes();
  render();
}

// リードの種別（レコードタイプ）を読み込んでおく。既定でクロスを選ぶために使う。
async function loadLeadRecordTypes() {
  if (window._leadRecordTypes) return;
  try {
    const d = await (await fetch("/api/salesforce/lead-record-types")).json();
    window._leadRecordTypes = d.types || [];
    window._leadCrossId = d.crossId || "";
  } catch { window._leadRecordTypes = []; }
}

async function createLeadNow(key) {
  const s = stOf(key);
  const card = document.querySelector(`[data-ev="${cssEscL(key)}"]`);
  const fields = {};
  if (card) {
    card.querySelectorAll("[data-newapi]").forEach((el) => {
      const api = el.dataset.newapi;
      const v = (el.value || "").trim();
      if (!api || v === "") return;
      fields[api] = el.dataset.num ? Number(v.replace(/[^\d.-]/g, "")) : v;
    });
  }
  if (!fields.LastName || !fields.Company) { s.error = "姓と会社名は必須です。"; render(); return; }
  s.loading = true; s.error = "";
  render();
  try {
    const r = await fetch("/api/salesforce/leads", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fields: {
          ...fields,
          // 画面で選ばれている種別（既定はクロス）
          ...(document.getElementById("lnRecordType")
            ? { RecordTypeId: document.getElementById("lnRecordType").value }
            : {}),
        },
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "作成に失敗しました");
    // 作ったリードをそのまま選択状態にして、コンバートへ進めるようにする
    s.mode = "search";
    s.picked = {
      Id: d.id, Name: `${fields.LastName || ""} ${fields.FirstName || ""}`.trim(),
      Company: fields.Company || "", Status: "作成しました",
      // 作ったときの種別（クロスなど）を持たせて、正しく表示する
      RecordType: d.recordTypeName ? { Name: d.recordTypeName } : undefined,
      Website: fields.Website || "", Street: fields.Street || "", City: fields.City || "", State: fields.State || "",
      NumberOfEmployees: fields.NumberOfEmployees || null,
    };
    if (d.instanceUrl) sfInstanceUrl = d.instanceUrl;
  } catch (e) {
    s.error = e.message;
  } finally {
    s.loading = false;
    render();
  }
}

async function convert(key) {
  const s = stOf(key);
  if (!s.picked) return;
  const card = document.querySelector(`[data-ev="${cssEscL(key)}"]`);
  const fields = {};
  if (card) {
    card.querySelectorAll("[data-api]").forEach((el) => {
      const api = el.dataset.api;
      const v = (el.value || "").trim();
      if (!api || v === "") return;
      fields[api] = el.dataset.num ? Number(v.replace(/[^\d.-]/g, "")) : v;
    });
  }
  if (!confirm(`「${s.picked.Company || s.picked.Name}」のリードを商談として立ち上げます。よろしいですか？`)) return;
  s.loading = true; s.error = "";
  render();
  try {
    const r = await fetch(`/api/salesforce/leads/${encodeURIComponent(s.picked.Id)}/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fields,
        convertedStatus: (card && card.querySelector("[data-convstatus]") && card.querySelector("[data-convstatus]").value) || convertedStatus,
        opportunityName: s.picked.Company || s.picked.Name,
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "立ち上げに失敗しました");
    s.done = d;
  } catch (e) {
    s.error = e.message;
  } finally {
    s.loading = false;
    render();
  }
}

// すでにSalesforceで立ち上がっている会社を調べる
async function checkLaunched(events) {
  const companies = [...new Set(events.map((e) => companyOf(e.title)).filter(Boolean))];
  if (!companies.length) return;
  try {
    const r = await fetch("/api/salesforce/launched-check", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ companies }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { launched = d.found || {}; sfInstanceUrl = d.instanceUrl || ""; render(); }
  } catch {}
}

// 住所を「都道府県 / 市区郡 / 町名・番地」に分ける
function splitAddr(loc) {
  const t = String(loc || "");
  const mP = t.match(/^(北海道|東京都|大阪府|京都府|.{2,3}県)/);
  const state = mP ? mP[1] : "";
  const rest = state ? t.slice(state.length) : t;
  const mC = rest.match(/^(.+?[市区町村])/);
  const city = mC ? mC[1] : "";
  const street = city ? rest.slice(city.length) : rest;
  return { state, city, street };
}

// 住所が「愛媛県西条市愛媛県西条市…」のように二重になっているときに直す
function dedupeAddr(v) {
  const t = String(v || "");
  for (let n = Math.floor(t.length / 2); n >= 3; n--) {
    if (t.slice(0, n) === t.slice(n, n * 2)) return t.slice(n);
  }
  return t;
}

// 参照項目（ルックアップ）は、参照先のオブジェクトを検索してIDを入れる
function isRef(f) {
  return f.type === "reference" && (f.referenceTo || []).length > 0;
}
function refObjectOf(f) {
  return (f.referenceTo || [])[0] || "";
}
// 検索できるルックアップ欄。表示はテキスト、実際に送るのは hidden のID。
function lookupHtml(f, attr, initText, initId) {
  const obj = refObjectOf(f);
  return `<div class="ln-lookup" data-obj="${escL(obj)}">
    <input type="text" class="sf-input ln-lookup-q" placeholder="名前で検索（例：3Dメタバース）" value="${escL(initText || "")}" autocomplete="off" />
    <input type="hidden" ${attr}="${escL(f.name)}" value="${escL(initId || "")}" />
    <div class="ln-lookup-menu" hidden></div>
    <div class="ln-lookup-note">${escL(obj)} から検索します</div>
  </div>`;
}

// gBizINFOから会社情報を取り込んで、空欄を埋める
async function fillFromGbiz(key, companyName, number) {
  const card = document.querySelector(`[data-ev="${cssEscL(key)}"]`);
  if (!card) return;
  const note = card.querySelector(".ln-gbiz-note");
  if (note) note.textContent = "gBizINFOを検索中…";
  try {
    const url = number
      ? `/api/gbiz/company?number=${encodeURIComponent(number)}`
      : `/api/gbiz/company?name=${encodeURIComponent(companyName || "")}`;
    const r = await fetch(url);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "取得に失敗しました");
    if (d.configured === false) { if (note) note.textContent = "gBizINFOのトークンが未設定です（設定で登録できます）"; return; }
    const b = d.best;
    if (!b) {
      // gBizINFOに無い会社（屋号・グループ名など）は、ネット検索で補う
      if (note) note.textContent = "gBizINFOで会社が見つかりませんでした。ネットで調べています…";
      await fillContactInfo(card, note);
      await fillFromWeb(card, companyName, note, true);
      return;
    }

    const setIfEmpty = (api, v) => {
      if (v == null || v === "") return;
      const el = card.querySelector(`[data-newapi="${api}"]`) || card.querySelector(`[data-api="${api}"]`);
      if (el && !el.value) el.value = v;
    };
    const hasState = !!card.querySelector('[data-newapi="State"], [data-api="State"]');
    const hasCity = !!card.querySelector('[data-newapi="City"], [data-api="City"]');
    setIfEmpty("Website", b.website);
    setIfEmpty("PostalCode", b.postalCode);
    setIfEmpty("NumberOfEmployees", b.employees != null ? String(b.employees) : "");
    if (hasState || hasCity) {
      setIfEmpty("State", b.state);
      setIfEmpty("City", b.city);
      setIfEmpty("Street", b.street);
    } else {
      // 都道府県・市区郡の欄が無い組織では、住所を1つにまとめて入れる
      setIfEmpty("Street", b.location);
    }

    // 電話・Webサイトが空なら、Salesforceの既存データやメールのドメインから補う
    await fillContactInfo(card, note);
    // それでも空なら、ネット検索で補う
    await fillFromWeb(card, companyName || (b && b.name) || "", note);

    if (note) {
      const opts = (d.candidates || []).map((c) =>
        `<option value="${escL(c.corporate_number)}" ${c.corporate_number === b.corporateNumber ? "selected" : ""}>${escL(c.name)}</option>`).join("");
      note.innerHTML =
        `gBizINFOから取り込みました：<b>${escL(b.name)}</b>` +
        (b.employees ? `（従業員 ${b.employees}名）` : "") +
        (opts ? `<br><span class="ln-gbiz-pick">別の会社：<select class="sf-select ln-gbiz-sel" data-key="${escL(key)}">${opts}</select></span>` : "");
    }
  } catch (e) {
    if (note) note.textContent = "gBizINFOの取り込みに失敗しました：" + e.message;
  }
}

// ネット検索で、URL・電話・従業員数を補う。
// AIの検索結果なので、埋めたことがひと目で分かるようにして、確認を促す。
async function fillFromWeb(card, companyName, note, standalone = false) {
  if (!companyName) return;
  const need = (api) => {
    const el = card.querySelector(`[data-newapi="${api}"], [data-api="${api}"]`);
    return el && !el.value ? el : null;
  };
  const TARGETS = ["Website", "Phone", "NumberOfEmployees", "PostalCode", "State", "City", "Street"];
  const wants = TARGETS.map(need).filter(Boolean);
  if (!wants.length) return;   // すでに全部埋まっていれば何もしない

  try {
    const site = card.querySelector('[data-newapi="Website"], [data-api="Website"]');
    const r = await fetch(`/api/company-lookup?name=${encodeURIComponent(companyName)}` +
      (site && site.value ? `&url=${encodeURIComponent(site.value)}` : ""));
    const d = await r.json().catch(() => ({}));
    if (!d || !d.ok) {
      if (standalone && note) note.textContent = "ネットでも会社の情報が見つかりませんでした。手で入れてください。";
      return;
    }

    const filled = [];
    const put = (api, v, label) => {
      if (v == null || v === "") return;
      const el = need(api);
      if (!el) return;
      el.value = String(v);
      el.classList.add("sf-from-web");
      filled.push(label);
    };
    put("Website", d.website, "URL");
    put("Phone", d.phone, "電話");
    put("NumberOfEmployees", d.employees, "従業員数");
    put("PostalCode", d.postalCode, "郵便番号");
    // 都道府県・市区郡の欄がある組織は分けて、無い組織は1つにまとめて入れる
    const hasState = !!card.querySelector('[data-newapi="State"], [data-api="State"]');
    if (hasState) {
      put("State", d.state, "都道府県");
      put("City", d.city, "市区郡");
      put("Street", d.street, "町名・番地");
    } else {
      put("Street", d.address, "住所");
    }
    if (!filled.length) return;

    if (note) {
      const src = (d.sources || []).slice(0, 2)
        .map((u) => `<a href="${escL(u)}" target="_blank" rel="noopener">${escL(new URL(u).hostname)}</a>`)
        .join("、");
      note.innerHTML = (standalone ? "" : note.innerHTML + "<br>") +
        `<span class="ln-web-note">ネット検索で ${escL(filled.join("・"))} を入れました。` +
        `<b>内容を確認してください。</b>${src ? `（参照：${src}）` : ""}</span>`;
    }
  } catch {
    if (standalone && note) note.textContent = "ネット検索に失敗しました。手で入れてください。";
  }
}

// 別の会社を選び直したときは、gBizINFO由来の項目を入れ替える
async function fillFromGbizReplace(key, number) {
  const card = document.querySelector(`[data-ev="${cssEscL(key)}"]`);
  if (!card) return;
  ["Website", "State", "City", "Street", "PostalCode", "NumberOfEmployees"].forEach((api) => {
    const el = card.querySelector(`[data-newapi="${api}"]`);
    if (el) el.value = "";
  });
  await fillFromGbiz(key, "", number);
}

// 電話・Webサイトを、Salesforceの既存データやメールのドメインから補う
async function fillContactInfo(card, note) {
  if (!card) return;
  const get = (api) => card.querySelector(`[data-newapi="${api}"]`) || card.querySelector(`[data-api="${api}"]`);
  const phoneEl = get("Phone"), siteEl = get("Website");
  if ((!phoneEl || phoneEl.value) && (!siteEl || siteEl.value)) return;
  const nameEl = get("Company");
  const mailEl = get("Email");
  const name = (nameEl && nameEl.value) || "";
  const email = (mailEl && mailEl.value) || "";
  if (!name && !email) return;
  try {
    const r = await fetch(`/api/salesforce/company-info?name=${encodeURIComponent(name)}&email=${encodeURIComponent(email)}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return;
    let filled = [];
    if (phoneEl && !phoneEl.value && d.phone) { phoneEl.value = d.phone; filled.push("電話"); }
    if (siteEl && !siteEl.value && d.website) { siteEl.value = d.website; filled.push("Webサイト"); }
    if (filled.length && note) {
      const extra = `<br>${escL(filled.join("・"))}を${escL(d.source || "既存データ")}から補いました${d.guessed ? "（推測なので確認してください）" : ""}`;
      note.insertAdjacentHTML("beforeend", extra);
    }
  } catch {}
}

async function runLookup(wrap) {
  if (!wrap) return;
  const obj = wrap.dataset.obj || "";
  const q = (wrap.querySelector(".ln-lookup-q").value || "").trim();
  const menu = wrap.querySelector(".ln-lookup-menu");
  if (!obj) { menu.hidden = true; return; }
  menu.hidden = false;
  menu.innerHTML = '<div class="ln-lookup-msg">検索中…</div>';
  try {
    const r = await fetch(`/api/salesforce/lookup?sobject=${encodeURIComponent(obj)}&q=${encodeURIComponent(q)}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "検索に失敗しました");
    const recs = d.records || [];
    menu.innerHTML = recs.length
      ? recs.map((x) => `<button type="button" class="ln-lookup-item" data-id="${escL(x.id)}" data-name="${escL(x.name)}">${escL(x.name)}</button>`).join("")
      : '<div class="ln-lookup-msg">見つかりませんでした</div>';
  } catch (e) {
    menu.innerHTML = `<div class="ln-lookup-msg">${escL(e.message)}</div>`;
  }
}

// フォームを出したときに「3Dメタバース」を初期選択にする
async function presetLookups(scope) {
  const wraps = [...(scope || document).querySelectorAll(".ln-lookup")];
  for (const w of wraps) {
    const hidden = w.querySelector("input[type=hidden]");
    if (hidden.value) continue;
    const obj = w.dataset.obj;
    if (!obj) continue;
    try {
      const r = await fetch(`/api/salesforce/lookup?sobject=${encodeURIComponent(obj)}&q=${encodeURIComponent("3Dメタバース")}`);
      const d = await r.json().catch(() => ({}));
      const rec = (d.records || [])[0];
      if (rec) {
        hidden.value = rec.id;
        w.querySelector(".ln-lookup-q").value = rec.name;
      }
    } catch {}
  }
}

async function loadNames() {
  try {
    const r = await fetch("/api/interns");
    const d = await r.json();
    (Array.isArray(d) ? d : []).forEach((x) => { if (x.email) nameByEmail[String(x.email).toLowerCase()] = x.name || x.email; });
  } catch {}
  try {
    const r = await fetch("/api/users");
    const d = await r.json();
    const arr = Array.isArray(d) ? d : (d.users || []);
    arr.forEach((u) => { const em = String(u.email || u.username || "").toLowerCase(); if (em && !nameByEmail[em]) nameByEmail[em] = u.name || em; });
  } catch {}
}

async function loadFields() {
  try {
    const r = await fetch("/api/salesforce/lead-fields");
    const d = await r.json().catch(() => ({}));
    if (r.ok) { leadFields = d.fields || []; convertedStatus = d.convertedStatus || ""; convertedStatuses = d.convertedStatuses || []; }
  } catch {}
}

let focusSearched = false;

// 指定の予定を、前後の日から探す。
// ホームからは商談日で開かれるが、この画面は「登録した日」で読むため。
async function findEventAround(q) {
  // 以前はブラウザが最大31日ぶんを1日ずつ順番に読んでいて遅かった。
  // いまはサーバーに会社名で一括検索させて、1回で見つける。
  try {
    const r = await fetch("/api/calendar/find-company?q=" + encodeURIComponent(q) + "&date=" + encodeURIComponent(selDateL));
    const d = await r.json();
    if (d && d.found && Array.isArray(d.events)) {
      selDateL = d.date;
      dayEventsL = d.events;
      memberCount = d.count || 0;
      const norm = (t) => String(t || "").replace(/[\s　]/g, "");
      const key = norm(q);
      const hit = d.events.filter((e) => isTarget(e.title) &&
        (norm(e.title).includes(key) || key.includes(norm(e.title))));
      render();
      if (hit.length) checkLaunched(hit);
      return;
    }
  } catch {}
  // 見つからなければ、そのまま「対象ではありません」を出す
  render();
}

async function loadDay(fresh = false) {
  focusSearched = false;
  const box = $l("lnList");
  box.innerHTML = '<div class="home-empty">読み込み中…（全員のカレンダーを見ています）</div>';
  try {
    // その日にカレンダーへ登録された予定を、Google連携している全員分まとめて取る
    const r = await fetch("/api/calendar/created?date=" + encodeURIComponent(selDateL) +
      (fresh ? "&fresh=1" : ""));
    const d = await r.json();
    dayEventsL = (d && d.events) || [];
    memberCount = (d && d.count) || 0;
    lastLoad = { cached: !!(d && d.cached), agoSec: (d && d.cachedAgoSec) || 0 };
    if (d && d.connected === false) {
      box.innerHTML = '<div class="home-empty">Googleカレンダーが連携されているメンバーがいません。設定から連携してください。</div>';
      return;
    }
  } catch {
    dayEventsL = [];
  }
  render();
  checkLaunched((dayEventsL || []).filter((e) => isTarget(e.title)));
}

function shiftDay(n) {
  const [y, m, d] = selDateL.split("-").map(Number);
  const x = new Date(y, m - 1, d);
  x.setDate(x.getDate() + n);
  selDateL = ymdL(x);
  launched = {};
  loadDay();
}

// ホームなどからiframeで埋め込まれたときの制御。
//   embed=1 … 余計な枠を隠して、対象の1件だけを出す
//   date    … その日を開く
//   q       … 予定名の一部で絞り込む（1件だけならパネルを自動で開く）
const embedQ = (() => {
  try { return new URLSearchParams(location.search); } catch { return new URLSearchParams(); }
})();
const isEmbed = embedQ.get("embed") === "1";
const focusQ = String(embedQ.get("q") || "").trim();
if (isEmbed) {
  try { document.body.classList.add("kb-embed", "kb-embed-ln"); } catch {}
  // 中身の高さを親に伝えて、iframeの高さを合わせる
  const postH = () => {
    try {
      const t = document.querySelector(".report-page") || document.body;
      parent.postMessage({ type: "kb-embed-height", height: Math.ceil(t.getBoundingClientRect().height) + 16 }, "*");
    } catch {}
  };
  window.addEventListener("load", postH);
  for (const ms of [400, 1200, 2500]) setTimeout(postH, ms);
  const mo = new MutationObserver(() => postH());
  window.addEventListener("load", () => {
    const box = $l("lnList");
    if (box) mo.observe(box, { childList: true, subtree: true });
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  const d0 = String(embedQ.get("date") || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(d0)) selDateL = d0;
  $l("lnDate").value = selDateL;
  $l("lnDate").addEventListener("change", (e) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) { selDateL = e.target.value; loadDay(); }
  });
  $l("lnPrev").addEventListener("click", () => shiftDay(-1));
  $l("lnNext").addEventListener("click", () => shiftDay(1));
  $l("lnToday").addEventListener("click", () => { selDateL = todayL; loadDay(); });

  const box = $l("lnList");
  box.addEventListener("click", (ev) => {
    const open = ev.target.closest("[data-ln-open]");
    if (open) {
      const key = open.dataset.lnOpen;
      const s = stOf(key);
      s.open = !s.open;
      if (s.open && s.leads === null && !s.picked) {
        const ev = (dayEventsL || []).find((x) => (x.id || (x.title + "@" + x.start)) === key);
        let title = ev ? ev.title : "";
        // カレンダー予定が無い「会社名から直接」のカードは、キーから会社名を使う
        if (!ev && String(key).startsWith("__q__:")) title = String(key).slice("__q__:".length);
        s.evDate = ev && ev.start ? ymdL(new Date(ev.start)) : selDateL;
        s.q = companyOf(title) || title;
        s.qp = personOf(title);
        render();
        searchLeads(key);
        return;
      }
      render();
      return;
    }
    const sb = ev.target.closest("[data-ln-search]");
    if (sb) {
      const key = sb.dataset.lnSearch;
      const c = box.querySelector(`[data-ln-q="${cssEscL(key)}"]`);
      const p = box.querySelector(`[data-ln-qp="${cssEscL(key)}"]`);
      const s = stOf(key);
      s.q = c ? c.value.trim() : "";
      s.qp = p ? p.value.trim() : "";
      searchLeads(key);
      return;
    }
    const pk = ev.target.closest("[data-ln-pick]");
    if (pk) {
      const key = pk.dataset.lnPick;
      const s = stOf(key);
      s.picked = (s.leads || []).find((r) => r.Id === pk.dataset.id) || null;
      s.error = "";
      render();
      {
        const card = document.querySelector(`[data-ev="${cssEscL(key)}"]`);
        presetLookups(card);
        // 会社情報（住所・従業員数など）と、電話・Webサイトを自動で補う
        fillFromGbiz(key, companyOf((dayEventsL.find((x) => (x.id || (x.title + "@" + x.start)) === key) || {}).title || ""), "");
      }
      return;
    }
    const back = ev.target.closest("[data-ln-back]");
    if (back) {
      const s = stOf(back.dataset.lnBack);
      s.picked = null; s.error = "";
      render();
      return;
    }
    const go = ev.target.closest("[data-ln-go]");
    if (go) { convert(go.dataset.lnGo); return; }
    const nw = ev.target.closest("[data-ln-new]");
    if (nw) {
      const key = nw.dataset.lnNew;
      const s = stOf(key);
      const e2 = (dayEventsL || []).find((x) => (x.id || (x.title + "@" + x.start)) === key);
      s.evDate = e2 && e2.start ? ymdL(new Date(e2.start)) : selDateL;
      s.mode = "create"; s.error = "";
      render();
      loadCreateFields().then(() => {
        const card = document.querySelector(`[data-ev="${cssEscL(key)}"]`);
        presetLookups(card);
        fillFromGbiz(key, companyOf(e2 ? e2.title : ""), ""); // 会社名から自動で取り込む
      });
      return;
    }
    const cc = ev.target.closest("[data-ln-cancel]");
    if (cc) { const s = stOf(cc.dataset.lnCancel); s.mode = "search"; s.error = ""; render(); return; }
    const cr = ev.target.closest("[data-ln-create]");
    if (cr) { createLeadNow(cr.dataset.lnCreate); return; }
    // 選んだリードの種別を、クロスリードに変える
    const cx = ev.target.closest("[data-ln-cross]");
    if (cx) {
      const key = cx.dataset.lnCross;
      const s2 = stOf(key);
      const card = document.querySelector(`[data-ev="${cssEscL(key)}"]`);
      const note = card && card.querySelector(".ln-cross-note");
      if (!confirm("このリードの種別をクロスリードに変えます。よろしいですか？")) return;
      cx.disabled = true;
      if (note) note.textContent = "変更しています…";
      fetch(`/api/salesforce/leads/${encodeURIComponent(cx.dataset.id)}/record-type`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
      })
        .then(async (r) => {
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error || "変えられませんでした");
          if (s2.picked) s2.picked.RecordType = { Name: d.recordTypeName || "クロスリード" };
          render();
        })
        .catch((e) => {
          cx.disabled = false;
          if (note) note.textContent = "失敗しました：" + e.message;
        });
      return;
    }

      const rlb = ev.target.closest("#lnReload");
    if (rlb) { loadDay(true); return; }

    const gb = ev.target.closest("[data-ln-gbiz]");
    if (gb) {
      const key = gb.dataset.lnGbiz;
      const card = document.querySelector(`[data-ev="${cssEscL(key)}"]`);
      const nameEl = card && card.querySelector('[data-newapi="Company"]');
      fillFromGbiz(key, nameEl ? nameEl.value : "", "");
      return;
    }
  });
  box.addEventListener("change", (ev) => {
    const sel = ev.target.closest(".ln-gbiz-sel");
    if (sel) fillFromGbizReplace(sel.dataset.key, sel.value);
  });
  box.addEventListener("input", (ev) => {
    const c = ev.target.closest("[data-ln-q]");
    if (c) stOf(c.dataset.lnQ).q = c.value;
    const p = ev.target.closest("[data-ln-qp]");
    if (p) stOf(p.dataset.lnQp).qp = p.value;
  });

  // 絞り込みの操作
  const ownersWrap = $l("lnOwners");
  if (ownersWrap) {
    ownersWrap.addEventListener("click", (ev) => {
      ev._lnInside = true; // 下の「外側クリックで閉じる」を通さない
      if (ev.target.closest("#lnOwnerBtn")) {
        ownersWrap.dataset.open = ownersWrap.dataset.open === "1" ? "0" : "1";
        render();
        return;
      }
      if (ev.target.closest("[data-owner-all]")) {
        document.querySelectorAll("[data-owner]").forEach((c) => ownerFilter.add(c.dataset.owner));
        render(); return;
      }
      if (ev.target.closest("[data-owner-none]")) {
        ownerFilter.clear();
        render(); return;
      }
    });
    ownersWrap.addEventListener("change", (ev) => {
      const c = ev.target.closest("[data-owner]");
      if (!c) return;
      if (c.checked) ownerFilter.add(c.dataset.owner); else ownerFilter.delete(c.dataset.owner);
      render();
    });
  }
  document.addEventListener("click", (ev) => {
    if (ev._lnInside) return;
    const w = $l("lnOwners");
    if (w && w.dataset.open === "1" && !(ev.target.closest && ev.target.closest("#lnOwners"))) { w.dataset.open = "0"; render(); }
  });

  // ルックアップ（参照項目）の検索
  let lookupTimer = null;
  box.addEventListener("input", (ev) => {
    const q = ev.target.closest(".ln-lookup-q");
    if (!q) return;
    const wrap = q.closest(".ln-lookup");
    const hidden = wrap.querySelector("input[type=hidden]");
    hidden.value = ""; // 打ち直したら選択を解除
    clearTimeout(lookupTimer);
    lookupTimer = setTimeout(() => runLookup(wrap), 250);
  });
  box.addEventListener("focusin", (ev) => {
    const q = ev.target.closest(".ln-lookup-q");
    if (q) runLookup(q.closest(".ln-lookup"));
  });
  box.addEventListener("click", (ev) => {
    const item = ev.target.closest(".ln-lookup-item");
    if (!item) return;
    ev.stopPropagation();
    const wrap = item.closest(".ln-lookup");
    wrap.querySelector(".ln-lookup-q").value = item.dataset.name || "";
    wrap.querySelector("input[type=hidden]").value = item.dataset.id || "";
    const menu = wrap.querySelector(".ln-lookup-menu");
    menu.hidden = true; menu.innerHTML = "";
  });

  await loadNames();
  await loadFields();
  loadDay();
});

// ───────────────────────────────────────────────────────────
// 立ち上げ待ち — 自動で立ち上げられなかったアポの一覧
// 通知を1件ずつ追わなくても、ここを見れば残りが分かるようにする。
// ───────────────────────────────────────────────────────────
function pdWhen(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const wd = ["日", "月", "火", "水", "木", "金", "土"][d.getDay()];
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}/${d.getDate()}(${wd}) ${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function loadPending() {
  const box = $l("pdList");
  if (!box) return;
  const st = $l("pdStatus");
  if (st) st.textContent = "読み込み中…";
  try {
    const all = $l("pdAll") && $l("pdAll").checked ? "?all=1" : "";
    const d = await (await fetch("/api/sf-autolaunch/pending" + all)).json();
    const items = d.items || [];
    const ng = items.filter((x) => !x.ok).length;

    // タブに件数を出す（見落とさないように）
    const badge = $l("pdBadge");
    if (badge) {
      badge.hidden = ng === 0;
      badge.textContent = ng;
    }
    if (st) st.textContent = `${items.length}件`;

    if (!items.length) {
      box.innerHTML = '<div class="home-empty">立ち上げ待ちのアポはありません。</div>';
      return;
    }
    box.innerHTML = items.map((x) => `
      <div class="pd-card${x.ok ? " pd-ok" : ""}" data-slug="${escL(x.slug)}">
        <div class="pd-main">
          <div class="pd-t">${escL(x.title || x.company || "(予定名なし)")}</div>
          <div class="pd-s">${escL(pdWhen(x.start))}${x.owner ? " ・ 担当 " + escL(x.owner) : ""}${x.business ? " ・ " + escL(x.business) : ""}</div>
          <div class="pd-r">${x.ok
            ? `🚀 立ち上げ済${x.oppId ? "" : ""}`
            : `⚠️ ${escL(x.reasonText)}`}</div>
        </div>
        <div class="pd-act">
          ${x.ok ? "" : '<button type="button" class="btn pd-retry">もう一度試す</button>'}
          <button type="button" class="btn ghost pd-open">開く</button>
        </div>
        <div class="pd-note"></div>
      </div>`).join("");

    box.querySelectorAll(".pd-retry").forEach((b) =>
      b.addEventListener("click", async () => {
        const card = b.closest(".pd-card");
        const note = card.querySelector(".pd-note");
        b.disabled = true;
        note.textContent = "立ち上げています…";
        try {
          const r = await fetch("/api/sf-autolaunch/retry", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ slug: card.dataset.slug }),
          });
          const d2 = await r.json();
          if (!r.ok) throw new Error(d2.error || "できませんでした");
          note.textContent = d2.ok ? "立ち上げました" : "やはりできません：" + d2.reasonText;
          if (d2.ok) setTimeout(loadPending, 1200);
          else b.disabled = false;
        } catch (e) { note.textContent = "失敗：" + e.message; b.disabled = false; }
      })
    );
    box.querySelectorAll(".pd-open").forEach((b) =>
      b.addEventListener("click", () => {
        const card = b.closest(".pd-card");
        const item = items.find((x) => x.slug === card.dataset.slug);
        // 商談立ち上げのタブに移り、その1件を探す
        focusQ = item ? (item.title || item.company || "") : "";
        focusSearched = false;
        document.querySelector('.rep-tab[data-sftab="launch"]').click();
        findEventAround(focusQ);
      })
    );
  } catch (e) {
    box.innerHTML = `<div class="home-empty">読み込めませんでした：${escL(e.message)}</div>`;
    if (st) st.textContent = "";
  }
}

if ($l("pdReload")) $l("pdReload").addEventListener("click", loadPending);
if ($l("pdAll")) $l("pdAll").addEventListener("change", loadPending);
