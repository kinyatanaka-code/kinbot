// MOCHICALL の解説の吹き出し（2026-11-23 福井さん「すべての UI を、2秒以上カーソルを合わせるとその機能の解説の吹き出しが出るように」）
//   ボタン・入力欄・数字・カードの上でカーソルを2秒止めると、その場所が何をするところかを吹き出しで出す。
//   押す・打つ・スクロールすると消える。吹き出しはクリックを受け取らないので、架電の操作のじゃまはしない。
//   mccall.js に入れずに別のファイルにしたのは、架電の画面の直しとぶつからないようにするため（部品は名前で探すだけ）。
//   解説の文は下の TIPS に並べる。画面に部品を足したら、ここに1行足す（足し忘れても、title や欄の名前から文を作って出す）。
(function mcTip() {
  if (window.matchMedia && window.matchMedia("(hover: none)").matches) return;   // 指で触る画面には「カーソルを合わせる」が無い
  const WAIT = 2000;
  // 吹き出しを出す範囲：MOCHICALL の画面・ヘッダー・窓・下の知らせ・左のメニュー
  const SCOPE = ".mcc, #mcHeadCall, .mcc-dlg, .mcc-toast, .sidebar";
  const txt = (el) => (el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "");
  // その部品の中の見出し（small・b・h3 など）の文字で、文を選ぶ
  const byText = (q, map) => (el) => { const k = txt(q ? el.querySelector(q) : el); for (const [key, v] of Object.entries(map)) if (k.startsWith(key)) return v; return ""; };

  // 表の見出し（列の名前 → その列の数え方）
  const TH = {
    "コール→アポ": "コールのうち、アポになった割合です。",
    "コール": "記録した架電の数です。",
    "会社数": "かけた会社の数です（同じ会社に何回かけても1社）。",
    "つながった": "だれかが電話に出た数です。",
    "担当者と話せた": "担当者本人と話せた数です。",
    "話せたうちアポ": "担当者と話せたうち、アポになった割合です。",
    "話せた→アポ": "担当者と話せたうち、アポになった割合です。",
    "話せた率": "コールのうち、担当者と話せた割合です。",
    "アポ率（コール）": "コールのうち、アポになった割合です。",
    "アポ率（担当者）": "担当者と話せたうち、アポになった割合です。",
    "アポ率": "コールのうち、アポになった割合です。",
    "アポ以外の架電で": "アポにならなかった架電で、SF のリードの項目を埋めた数です。",
    "アポ": "アポが取れた数です。",
    "資料": "資料を送ることになった数です。",
    "フォロー": "あとでもう一度連絡することになった数です。",
    "断られた": "断られた数です。",
    "断り": "断られた数です。",
    "トーク実施率": "録音のある通話のうち担当者と話せたものから、トークのとおりに話せたかを AI が読んだ割合です。",
    "トーク": "トーク（売り方）の名前と版です。直すと新しい版になり、版ごとに数字を分けます。",
    "SF 項目": "架電の内容から、SF のリードの項目を埋めた・直した数です（1項目＝1）。",
    "うち新規": "空だった項目を埋めた数です。",
    "うち更新": "古い値を直した・課題感などに足した数です。",
    "埋まった会社": "項目を1つでも埋めた会社の数です。",
    "使えない番号": "「番号が使えない」と記録した数です。",
    "目安と比べて": "資料の目安（B2B のコールドコール→商談化）と比べた水準です。",
    "その会社への": "その会社への何回目の架電か、です。",
    "名前": "架電した人です。", "リスト": "架電リストの名前です。", "日": "架電した日です。",
    "いつ": "記録した日時です。", "だれが": "記録した人です。", "会社": "かけた会社です。", "結果": "架電の結果です。",
    "DOC のリスト": "持ってきた元の DOC のリストです。", "MOCHICA のリスト": "持ってきた先の MOCHICA のリストです。",
    "元の DOC のリスト": "この会社が、もともと入っていた DOC のリストです。",
    "件数": "持ってきた会社の数です。", "架電": "持ってきた会社にかけた数です。", "理由": "持ってきた理由です。",
  };

  // 解説の文。上から順に探して、最初に当たったものを使う（細かいものを先に、広い場所をあとに書く）。
  //   値は文、または部品から文を作る関数。{ t, sub } の sub は、その部品の title（中身で変わる補足）も下に小さく添える印。
  //   keep は、もとの title の小窓をそのまま残す印（たたんだメニューの名前は、すぐ出たほうがよいため）
  const TIPS = [
    // ---- 右上・タブ・リスト ----
    ["#mctHelpBtn", "使い方の案内と、機能の一覧を開きます。知りたい機能を選ぶと、その場所まで案内します。"],
    ["#mccHelpBtn", "キー操作の一覧を開きます（? キーでも開きます）。MOCHICALL はキーボードだけで1件を終えられます。"],
    ["#mccStats span:nth-child(1)", "今日の自分のコール数です。記録するたびに増えます。"],
    ["#mccStats span:nth-child(2)", "今日、担当者と話せた数です。"],
    ["#mccStats span.apo", "今日、自分が取ったアポの数です。"],
    ["#mccStats", "今日の自分の数字です。記録するたびに増えます。"],
    ["#mccFreq", "この会社への架電回数と頻度です。大きな数字は今回が何回目か。下のマスは直近30日（右が今日）で、濃いほどその日に多くかけています。今日何度もかけている・久しぶりのときは注意が出ます。"],
    ['#mccTabs [data-t="call"]', "架電の画面です。会社が1社ずつ出てくるので、かけて、結果を記録します。"],
    ['#mccTabs [data-t="report"]', "架電の結果をふり返る画面です。期間を選んで、どの段階で止まっているかを確かめます。"],
    ['#mccTabs [data-t="insight"]', "次のかけ方を決める根拠を見る画面です。つながりやすい時間帯や、何回目の架電でアポが取れているかが分かります。"],
    ['#mccTabs [data-t="measures"]', "リスト（売り先）×トーク（売り方）ごとの数字を比べる画面です（管理者だけに出ます）。"],
    ['#mccTabs [data-t="cross"]', "DOC から持ってきたリストと、その会社にかけた記録を確かめる画面です（管理者だけに出ます）。"],
    ['#mccTabs [data-t="leads"]', "リードを種類ごとに見て、メンバーに配る画面です（管理者だけに出ます）。"],
    ['#mccTabs [data-t="lists"]', "架電リストを作る・リードを足す・トークを書く画面です（管理者だけに出ます）。"],
    ["#mccList", { t: "かけるリストを選びます。「担当のリストすべて」なら、担当している全部のリストから順に出ます。今日かけるリストが用意されている人は、今日の分の残りがここに出ます。", sub: true }],
    ["#mccNotice [data-na]", "この知らせへの対応を、その場で行います。"],
    ["#mccNotice [data-nn]", "ほかの知らせに切り替えます。"],
    ["#mccNotice", "止まって確かめる必要のある知らせです（SF に書けていない・アプローチ禁止・重複・折り返しの着信）。"],

    // ---- 左：会社を調べる ----
    ["#mccEdit", "会社名・担当者・電話番号・メール・Web ページ・法人番号を直せます。番号と担当者は何件でも足せます。"],
    [".mcc-co", "いまかける会社です。"],
    [".mcc-person", "担当者の名前です。受付で聞けた名前があれば、それを先に出します。"],
    [".mcc-gatei", "これまでに受付で聞けたことです（担当者のいる時間・直通や内線・営業時間）。"],
    [".mcc-badge.hot, .mcc-badge.warm, .mcc-badge.cold", "リードの見込みの高さです。ホット → ウォーム → コールドの順に、見込みが高い会社です。"],
    [".mcc-badge.doc", "DOC のリストから持ってきた会社です（部署をまたいだ架電として記録されます）。"],
    [".mcc-badge.danger", "アプローチ禁止の会社です。かけずに「飛ばす」を押してください。"],
    [".mcc-badge.sf", "Salesforce にある、この会社の商談の数です。受注・失注があれば一緒に出ます。"],
    ["#mccLst, .mcc-lst", { t: "Salesforce のリードの状況です（「記録して次へ」とは別に、選んだときに書き込みます）。", sub: true }],
    [".mcc-hook", "話の切り口です。Web で調べた採用の情報から、最初のひとことに使える問いかけを出しています。"],
    [".mcc-research summary", "会社の基本（事業・従業員・所在地・設立）と、調べた出典を開きます。"],
    [".mcc-research a", "調べた元のページを、新しいタブで開きます。"],
    [".mcc-research", "企業調査です。Web から調べた参考情報で、採用の情報は今の募集と確かめられたものだけを出しています。調査中でも、待たずにかけて大丈夫です。"],
    [".mcc-contacts a", "この会社の Web ページを、新しいタブで開きます。"],
    [".mcc-contacts", "この会社の連絡先です（メール・Web ページ・法人番号・足した担当者）。「直す」で変えられます。"],
    [".mcc-gl-row a", "マイナビの掲載ページを、新しいタブで開きます。"],
    [".mcc-gl-row", byText("b", {
      "採用ニーズ": "これまでに相手から聞けた採用ニーズです（出どころと日付つき）。まだ聞けていなければ、この電話で聞きます。",
      "検討時期": "これまでに相手から聞けた検討時期です。まだ聞けていなければ、いつ頃から考えるか・更新月を聞きます。",
      "マイナビ": "マイナビ（新卒）の掲載を Web で調べた結果です。「見つからない」は、掲載していないとは限りません。" })],
    [".mcc-gl-warn", "読めなかった元のデータです。「記録なし」ではなく「読めなかった」ことを知らせています。"],
    [".mcc-glance", "ひと目で：かける前に知っておきたい採用ニーズ・検討時期・マイナビの掲載をまとめています。"],
    [".mcc-phone.bad", "使えない番号として記録されています。"],
    [".mcc-phone", "この番号に発信します。右は、この番号がこれまで何回つながったかです。"],
    ["#mccLeft .mcc-more summary", "取り込んだ CSV の列を、そのまま見られます。"],
    ["#mccLeft .mcc-kv", "Salesforce や元のリスト（Bales・DOC・CSV）に入っている、この会社の情報です。"],
    ["#mccLeft", "かける前に見るところです。会社・担当者・採用の情報・SF の記録がまとまっています。"],

    // ---- 中央：かける・結果を記録する ----
    [".mcc-sum", "前回の架電の要約です（いつ・だれが・どうなったか）。"],
    [".mcc-plan", "この1本で確定させることです。アポが取れなくても、ここに出ていることが聞ければ前進です。担当者に届いていない回数も出ます。"],
    ["#mccDial", "Zoom Phone でこの番号に発信します（C キー）。発信すると、結果を選べるようになります。"],
    [".mcc-dialed", "発信ずみです。切れたときは、2回続けて押すともう一度かけます（1回だけではかけません）。"],
    ["#mccSkip", "この会社をかけずに、いちばん後ろへ回します（S キー。発信する前だけ）。"],
    ["#mccDoc, #mccDocNow", "資料のメールを送ります。中身を確かめる窓が開き、あなたの Gmail から送ります。"],
    [".mcc-ivr", "自動音声の案内です。前の録音から、どの番号を押せばどこにつながるかを出しています。"],
    ["#mccConnect", "担当者につながったら押します（T キー）。トークが担当者向けに変わり、日程の候補とヒアリングの入力が出ます。"],
    ["#mccBack", "ひとつ前の選択に戻ります（Backspace）。"],
    [".mcc-step .crumb", "いまの通話の段階です。"],
    ['[data-stab="best"]', "FS の空きから、近い日程のおすすめを出します。"],
    ['[data-stab="other"]', "日付を選んで、その日の空いている時刻を探します。"],
    [".mcc-slot", { t: "この日時でアポを入れます。押すとアポの日時に入り、担当になる FS も決まります。", sub: true }],
    ["#mccSlotDay", "アポの日を選びます。選ぶと、その日の空いている時刻が出ます。"],
    ["#mccSlotTime", "空いている時刻を選びます。カッコの中は、空いている FS の人数です。"],
    ["#mccSlots", "日程の候補です。FS の空きから、1時間の枠で出しています。"],
    ["#mccRes", "架電結果を選びます（数字キー 1〜0 でも選べます）。発信してから選べます。"],
    ["#mccReason", "断られた理由を選びます。レポートの「担当者に断られた理由」に集計されます。"],
    ["#mccApo", "アポの日時です。日程の候補を押すと入ります。手で入れることもできます。"],
    ["#mccApoWho", "このアポを担当する FS です。記録すると、予定を入れて知らせます。"],
    [".mcc-choice", (el) => `「${el.dataset.l || "これ"}」を選びます（左の数字のキーでも選べます）。`],
    ["#mccNextAt", "掛け直す日時を、自分で決めるときに入れます。"],
    ['[data-later=""]', "掛け直しの時刻の指定を外します。"],
    ["[data-later]", "この時刻に掛け直すように決めます。"],
    ["#mccNoRetry", "この会社の自動の掛け直しを止めます。"],
    ["#mccGoHearing, [data-hearing-jump]", "アポに必要なヒアリングのうち、まだ入っていない項目の入力欄へ移ります。"],
    [".mch-warn", "ヒアリングの中身で、確かめたほうがよいことです。"],
    [".mch-stat", "アポに必要なヒアリングが、あと何項目残っているかです。全部入ると、アポを記録できます。"],
    ["#mccFormNow", "相手の会社の問い合わせフォームから送るための窓を開きます。"],
    ["#mccBiz, [data-biz]", "相手の営業時間です。左の列と SF の活動メモに出て、次にかける人の目安になります。"],
    [".mcc-next", "記録したあと、この会社が次にどうなるか（掛け直しの予定など）です。"],
    ["#mccMemo", "架電メモです。話したこと・次に確認することを書きます。書きかけは会社ごとにこのパソコンに残ります。Ctrl+Enter で記録できます。"],
    [".mcc-fill-r", { t: "架電の内容から読み取った、SF のリードに入れる候補です。チェックした項目だけ入ります。", sub: true }],
    [".mcc-fill", "架電の内容から読み取った、SF のリードに入れる候補です。チェックした項目だけ入ります。"],
    ["#mccRec", "選んだ結果とメモを記録して、次の会社へ進みます（Enter）。記録は Salesforce の活動にも残ります。"],
    ["#mccHint", "記録するために、あと何が要るかを出しています。"],
    ["#mccGoLists", "架電リストを作る画面へ移ります。"],
    ["#mccReload", "かける会社を、もう一度読み直します。"],
    [".mcc-empty", "いまかける会社が無い理由と、次にどうすればよいかです。"],
    [".mcc-rec", "架電結果を選んで記録するところです。"],

    // ---- 右：トーク・聞けたこと・これまで ----
    ["#mccTalkTab", "トークスクリプトを見ます。"],
    ["#mccWorkTab", "聞けたこと（ヒアリング）を入力します。"],
    ["#mccMemoPanelTab", "架電メモを書きます。"],
    ["[data-tst]", "トークの段階を手で切り替えます（← → キーでも）。ふだんは通話の進み具合で自動で切り替わります。"],
    ["#mccTalkPrev", "トークスクリプトの前のページを出します。"],
    ["#mccTalkNext", "トークスクリプトの次のページを出します。"],
    ["#mccScript > summary", "トークスクリプトを開く・たたむ。開いているかどうかは覚えておきます。"],
    ["#mccTalk", "トークスクリプトです。会社名と担当者は、いまの会社に置き換えて出しています。通話の段階に合わせて切り替わります。"],
    ["#mccGName", "受付で聞けた担当者の名前を入れます。欄を離れると保存され、次にかける人にも見えます。"],
    ["#mccGDirect", "直通の番号や内線を入れます。欄を離れると保存されます。"],
    ["[data-hr]", "担当者のいる時間帯です。押すと保存され、掛け直しの時刻に使われます。"],
    ["#mccHPage", "入力するヒアリングの項目のまとまりを選びます。"],
    ["#mccHPrev", "前のまとまりの項目へ戻ります。"],
    ["#mccHNext", "次のまとまりの項目へ進みます。"],
    ["#mccHMail", "聞けなかった項目を、メールで相手に聞きます。送る中身を確かめる窓が開きます。"],
    ["[data-hn]", "当てはまるものを押して選びます（いくつでも選べます）。押すと保存されます。"],
    ["[data-hk], [data-hselect]", (el) => { const l = labelOf(el); return `${l ? `「${l}」：` : ""}ヒアリングで聞けたことを入れます。欄を離れると保存されます。前に聞いた値は、最初から入っています。`; }],
    ["#mccWork", "聞けたことを入れるところです。受付と話している間は受付で聞けたこと、担当者につながったらヒアリングが出ます。"],
    ["#mccTlMemo", "メモのある記録だけに絞ります（応答なしなどをたたみます）。"],
    ["[data-more]", "長いメモの全文を開く・たたむ。"],
    ["[data-undo]", "自分が付けたこの記録を取り消します。"],
    [".mcc-ti .src", "この記録の出どころです（kinbot＝MOCHICALL・Bales・SF・Zoom など）。"],
    [".mcc-ti", "この会社との、これまでのやりとりの1件です（いつ・だれが・結果・メモ）。"],
    ["#mccHistory", "この会社の架電履歴を、窓で開いて見ます。"],
    ["#mccTl", "この会社とのこれまでのやりとりです。MOCHICALL・Bales・SF などの記録を、1本の時系列にまとめています。"],
    ["#mccRight", "話しながら使うところです。トーク・聞けたことの入力・これまでのやりとりが出ます。"],

    // ---- 窓（直す・資料を送る・ヒアリングのメール・問い合わせフォーム） ----
    ["#mccECo", "会社名を直します。"], ["#mccEPe", "担当者の名前を直します。"], ["#mccEPh", "代表の電話番号を直します。"],
    ["#mccEMa", "メールアドレスを直します。資料を送るときの宛先に使われます。"], ["#mccEWeb", "会社の Web ページです。企業調査や問い合わせフォームを探すのに使います。"],
    ["#mccECorp", "法人番号です。同じ会社かどうかを確かめるのに使います。"],
    ["#mccEPhAdd", "電話番号をもう1本足します。"], ["#mccECtAdd", "担当者をもう1人足します。"], [".mcc-dlg [data-del]", "この行を消します。"],
    ["#mccDDoc, #mccTDoc", "送る資料を選びます。"], ["#mccDTo, #mccHMTo", "送り先のメールアドレスです。"], ["#mccDCc, #mccHMCc, #mccTCc", "CC に入れるメールアドレスです。"],
    ["#mccDSub, #mccHMSub, #mccTSub, #mccFSub", "件名です。送る前に直せます。"], ["#mccDBody, #mccHMBody, #mccTBody, #mccFBody, #mccFTBody", "本文です。送る前に直せます。"],
    ["[data-hmk]", "この項目をメールで聞くかどうかを選びます。"],
    ["#mccFUrl", "相手の会社の問い合わせフォームのページです。"], ["#mccFScanBtn", "問い合わせフォームのページを、もう一度探します。"], ["#mccFKana", "フォームに入れるフリガナです。"],
    [".mcc-dlg [data-x]", "何もせずに、この窓を閉じます（Esc でも閉じます）。"],
    [".mcc-dlg [data-ok]", (el) => (/閉じる/.test(txt(el)) ? "この窓を閉じます。" : `「${txt(el)}」を行って、この窓を閉じます。`)],
    [".mcc-toast [data-u]", "いま記録したものを元に戻します（Z キー）。"],
    [".mcc-toast", "いま行ったことの知らせです。少しすると消えます。"],

    // ---- レポート・数字・施策 ----
    ["#mccRf, #mccMf", "集計する期間の、始まりの日です。"], ["#mccRt, #mccMt", "集計する期間の、終わりの日です。"],
    ["[data-pre]", "集計する期間を、この長さに切り替えます。"],
    ["#mccRl", "リストを1つに絞って集計します。"],
    ['[data-go="insight"]', "「数字」のタブへ移ります。"], ['[data-go="report"]', "「レポート」のタブへ移ります。"],
    [".mcc-purpose", "この画面を、だれが・何を決めるために見るかです。"],
    [".mcc-fn > div", byText("small", {
      "コール": "この期間のコールの数と、かけた会社の数です。下は、前の同じ長さの期間との差です。",
      "つながった": "コールのうち、だれかが電話に出た数と割合です。下は、前の同じ長さの期間との差です。",
      "担当者と話せた": "つながったうち、担当者と話せた数と割合です。下は、前の同じ長さの期間との差です。",
      "アポ": "担当者と話せたうち、アポが取れた数と割合です。下は、前の同じ長さの期間との差です。" })],
    ['[data-by="user"]', "内訳を、人ごとに分けます。"], ['[data-by="list"]', "内訳を、リストごとに分けます。"], ['[data-by="day"]', "内訳を、日ごとに分けます。"],
    ['[data-view="result"]', "表に、架電の結果（つながった・話せた・アポなど）を出します。"],
    ['[data-view="fill"]', "表に、リストへの貢献（聞けたことで SF のリードを埋めた・使えない番号を見つけた数）を出します。"],
    [".mcc-tbl th", { t: byText("", TH), sub: true }],
    [".mcc-rk", "この理由・項目が出た回数です。棒が長いほど、多く出ています。"],
    [".mcc-ranks > div", byText("h3", {
      "受付で断られた文句": "受付で断られたときの文句を、多い順に並べています。",
      "担当者に断られた理由": "担当者に断られた理由を、多い順に並べています。",
      "聞けて SF に入れた項目": "架電で聞けて SF のリードに入れた項目を、多い順に並べています。" })],
    [".mcc-ans > div", "この問いへの答えです。くわしい元の数字は、同じ番号の下のカードにあります。"],
    [".mcc-hr", { t: "この時間帯に、担当者と話せた割合です。", sub: true }],
    [".mcc-hours", "時間帯ごとの、担当者と話せた割合です。"],
    [".mcc-tbl .mcc-tag, .mcc-ans .mcc-tag", "資料の目安と比べた水準です（上位の水準・平均の水準・平均より下）。"],
    [".mcc-rules", "いまの掛け直しのきまりです（何営業日後に掛け直すか・何回続いたら休ませるか）。"],
    [".mcc-kpis > div", byText("small", {
      "消化率": "このリストの会社のうち、1回でもかけた会社の割合です。",
      "企業調査ずみ": "このリストの会社のうち、企業調査が終わっている会社の割合です。" })],
    ["#mccMTpl, #mccTpl", "資料を送るメールのひな形（件名・本文・いつも使う資料）を決めます。"],
    ["#mccMFTpl, #mccFTpl", "問い合わせフォームから送る文のひな形を決めます。"],
    [".mcc-measure tr.best", "いちばんアポ率が高いトークです（30コール以上のトークどうしで比べています）。"],
    [".mcc-measure h3", "リスト（売り先）の名前です。"],
    [".mcc-card", byText("h2", {
      "レポート": "架電の結果をふり返るカードです。上の段は、コール → つながった → 担当者と話せた → アポ の順に、どこまで進めたかです。",
      "内訳": "人・リスト・日ごとの内訳です。右上のボタンで、分け方と表の中身を切り替えられます。",
      "なぜ取れなかったか": "断られた理由と、聞けて SF に入れた項目を、多い順に並べています。",
      "数字": "いま知りたい3つの問い（いまかけどきか・何回目までかける価値があるか・いまの水準）への答えです。",
      "① つながりやすい時間帯": "時間帯ごとに、担当者と話せた割合を出しています。",
      "② 何回目の架電で": "その会社への何回目の架電で、担当者と話せた・アポが取れたかです（直近90日）。",
      "③ 直近14日と": "直近14日の数字を、資料の目安と比べています。",
      "いまの掛け直しのきまり": "いまの掛け直しのきまりです（何営業日後に掛け直すか・何回続いたら休ませるか）。",
      "施策": "施策（リスト×トークの組み合わせ）ごとの数字です。",
      "DOC から持ってきた記録": "DOC のリストから、MOCHICA のリストへ持ってきた記録です。",
      "部署をまたいだ架電": "DOC から持ってきた会社にかけた記録です（新しい順）。" })],

    // ---- 左のメニュー ----
    ['.side-item[data-go="mtg"]', { t: "商談の一覧です。録画・文字起こしから作った議事録を見られます。", keep: true }],
    ['.side-item[data-go="call"]', { t: "MOCHICALL（架電の画面）を開きます。", keep: true }],
    ['.side-item[data-go="list"]', { t: "リスト管理です。Bales のリストを見て、メンバーに割り振ります。", keep: true }],
    ['.side-item[data-go="apo"]', { t: "アポイントの一覧です（準備中）。", keep: true }],
    ['.side-item[data-go="dash"]', { t: "ダッシュボードです。商談プロセスの計画と実績のずれを確かめます。", keep: true }],
    ['.side-item[data-go="settings"]', { t: "設定を開きます。", keep: true }],
    ["#mcSideBtn", { t: "左のメニューを開く・たたむ。", keep: true }],
    [".side-item.side-app", { t: "DOC の kinbot を開きます。", keep: true }],
    ["#logout", "ログアウトします。"],
  ];
  const INTERACTIVE = "button, a[href], input, select, textarea, summary, [role=tab], [role=button]";

  // 入力欄の名前（囲んでいる label の文字 → aria-label → 薄い字の例）
  function labelOf(el) {
    const lab = el.closest("label");
    if (lab) { const c = lab.cloneNode(true); c.querySelectorAll("input, select, textarea, small, button").forEach((x) => x.remove()); const t = txt(c); if (t) return t.slice(0, 30); }
    return (el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim().slice(0, 30);
  }
  // 解説の文が無い部品にも、欄の名前やボタンの文字から短い文を作って出す（部品を足して、ここに書き忘れたとき用）
  function generic(el) {
    const tag = el.tagName;
    if (tag === "SELECT") { const l = labelOf(el); return l ? `「${l}」を選ぶ欄です。` : "ここから1つ選びます。"; }
    if (tag === "INPUT" && /^(checkbox|radio)$/.test(el.type)) { const l = labelOf(el); return l ? `「${l}」にするかどうかを選びます。` : ""; }
    if (tag === "INPUT" || tag === "TEXTAREA") { const l = labelOf(el); return l ? `「${l}」を入れる欄です。` : ""; }
    const t = (el.getAttribute("aria-label") || txt(el)).replace(/\s*(Enter|[A-Z])$/, "").trim();
    if (!t || t.length > 24) return "";
    if (tag === "SUMMARY") return `「${t}」を開く・たたむ。`;
    if (tag === "A") return `「${t}」を開きます。`;
    return `「${t}」を行います。`;
  }
  const titleOf = (el) => (el._mctTitle != null ? el._mctTitle : el.getAttribute("title") || "").trim();

  // カーソルの下の部品から外へ向かって、解説のある部品を探す
  function resolve(target) {
    if (!target || !target.closest || target.closest("#mctour, #mctip") || !target.closest(SCOPE)) return null;
    for (let el = target; el && el !== document.body; el = el.parentElement) {
      for (const [sel, v] of TIPS) {
        if (!el.matches(sel)) continue;
        const o = typeof v === "object" ? v : { t: v };
        const main = typeof o.t === "function" ? o.t(el) : o.t;
        const title = titleOf(el);
        if (main) return { el, text: main, sub: o.sub && title && title !== main ? title : "", keep: !!o.keep };
        if (title) return { el, text: title, sub: "", keep: false };
        break;   // 文を作れなかったら、下の title・ボタンの文字へ
      }
      const title = titleOf(el);
      if (title) return { el, text: title, sub: "", keep: false };
      // チェックの印は、囲んでいる行（label）ごと1つの部品として扱う（行に付いている解説・title を出すため）
      const boxed = el.tagName === "INPUT" && /^(checkbox|radio)$/.test(el.type) && el.closest("label");
      if (el.tagName === "LABEL" && el.querySelector("input[type=checkbox], input[type=radio]")) { const g = generic(el.querySelector("input")); return g ? { el, text: g, sub: "", keep: false } : null; }
      if (!boxed && el.matches(INTERACTIVE)) { const g = generic(el); return g ? { el, text: g, sub: "", keep: false } : null; }
      if (el.matches(SCOPE)) break;
    }
    return null;
  }

  // 見た目。色は MOCHICALL の青緑（mccall.css の変数と同じ値）。クリックは受け取らない
  const st = document.createElement("style");
  st.id = "mctip-style";
  st.textContent = `
    #mctip{position:fixed;z-index:9997;left:0;top:0;max-width:300px;box-sizing:border-box;pointer-events:none;
      background:#12292C;color:#fff;border-radius:10px;padding:8px 11px;font-size:12.5px;line-height:1.6;font-weight:600;
      box-shadow:0 10px 28px rgba(11,110,120,.32);opacity:0;transform:translateY(3px);transition:opacity .14s ease,transform .14s ease;}
    #mctip.on{opacity:1;transform:none;}
    #mctip[hidden]{display:none;}
    #mctip small{display:block;margin-top:4px;padding-top:4px;border-top:1px solid rgba(255,255,255,.22);font-size:11.5px;font-weight:500;color:#CFE9EC;}
    #mctip i{position:absolute;width:10px;height:10px;background:#12292C;transform:rotate(45deg);display:none;}
    #mctip.up i{display:block;top:-5px;} #mctip.down i{display:block;bottom:-5px;}
  `;
  document.head.appendChild(st);
  const tip = document.createElement("div");
  tip.id = "mctip"; tip.setAttribute("role", "tooltip"); tip.hidden = true;
  tip.innerHTML = "<span></span><small></small><i></i>";
  document.body.appendChild(tip);
  const tipMain = tip.querySelector("span"), tipSub = tip.querySelector("small"), tail = tip.querySelector("i");

  let cur = null;        // いまカーソルが乗っている部品（{ el, text, sub }）
  let timer = null, watch = null;
  let stash = [];        // 吹き出しと二重に出ないよう、乗っている間だけ外しておく title
  let dead = null;       // 押したあとの部品には、カーソルを一度外すまで出さない
  let mx = 0, my = 0;

  // ブラウザの小窓（title）と二重に出ないように、乗っている間だけ title を外しておく（離れたら戻す）
  function holdTitles(target) {
    for (let el = target; el && el !== document.body; el = el.parentElement) {
      if (el.hasAttribute("title") && el.getAttribute("title")) { el._mctTitle = el.getAttribute("title"); el.removeAttribute("title"); stash.push(el); }
    }
  }
  function freeTitles() {
    // 外している間に画面の側が title を付け直していたら、そちらを優先する
    for (const el of stash) { if (!el.hasAttribute("title") && el._mctTitle) el.setAttribute("title", el._mctTitle); delete el._mctTitle; }
    stash = [];
  }
  function hide() {
    clearTimeout(timer); timer = null; clearInterval(watch); watch = null;
    tip.classList.remove("on"); tip.hidden = true;
  }
  function leave() { hide(); freeTitles(); cur = null; }

  function show() {
    const c = cur; if (!c || !c.el.isConnected) return leave();
    const r = c.el.getBoundingClientRect();
    if (!r.width && !r.height) return leave();
    tipMain.textContent = c.text; tipSub.textContent = c.sub; tipSub.hidden = !c.sub;
    tip.hidden = false; tip.classList.remove("up", "down");
    const vw = window.innerWidth, vh = window.innerHeight, tw = tip.offsetWidth, th = tip.offsetHeight, gap = 9;
    let left, top;
    if (r.width <= 480 && r.height <= 140) {
      // 小さい部品は、その下（入らなければ上）に、しっぽを向けて出す
      left = Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, vw - tw - 8));
      if (r.bottom + gap + th <= vh - 4) { top = r.bottom + gap; tip.classList.add("up"); }
      else { top = Math.max(4, r.top - gap - th); tip.classList.add("down"); }
      tail.style.left = Math.max(10, Math.min(r.left + r.width / 2 - left - 5, tw - 20)) + "px";
    } else {
      // カードや列のように大きい場所は、カーソルのそばに出す
      left = Math.max(8, Math.min(mx + 14, vw - tw - 8));
      top = my + 20 + th <= vh - 4 ? my + 20 : Math.max(4, my - th - 12);
    }
    tip.style.left = left + "px"; tip.style.top = top + "px";
    requestAnimationFrame(() => tip.classList.add("on"));
    // 画面が描き直されて部品が消えたら、吹き出しも消す
    clearInterval(watch);
    watch = setInterval(() => { if (!cur || !cur.el.isConnected) leave(); }, 300);
  }

  function over(target) {
    const c = resolve(target);
    if (c && cur && c.el === cur.el) return;   // 同じ部品の中で動いただけ
    leave();
    if (!c) { dead = null; return; }
    if (c.el === dead) return;
    dead = null;
    cur = c;
    if (!c.keep) holdTitles(target);
    timer = setTimeout(show, WAIT);
  }
  document.addEventListener("mouseover", (e) => over(e.target));
  document.addEventListener("mousemove", (e) => { mx = e.clientX; my = e.clientY; }, { passive: true });
  document.documentElement.addEventListener("mouseleave", leave);
  // 押す・打つ・スクロールで消す。押した部品には、カーソルを外すまでもう出さない（押すたびに出るとじゃまなため）
  const quiet = () => { if (cur) dead = cur.el; hide(); };
  document.addEventListener("mousedown", quiet, true);
  document.addEventListener("keydown", quiet, true);
  document.addEventListener("wheel", quiet, { capture: true, passive: true });
  document.addEventListener("scroll", quiet, { capture: true, passive: true });
  window.addEventListener("blur", leave);
  // 確認用：その部品に出る解説を返す（dev の確認スクリプトが、解説の無い部品を探すのに使う）
  window.mcTipFor = (el) => { const c = resolve(el); return c ? { text: c.text, sub: c.sub, on: c.el } : null; };
})();
