# kinbot（AI社員）の記憶

このファイルは、AI社員「kinbot」がこのプロジェクトの経緯・田中さんの指示・決めごとを
覚えておくための場所です。自動改善（夜間開発・毎時）・定期提案の Claude は、`CLAUDE.md`
の指示に従い、直す前に必ずここを読みます。**新しい決定や指示があれば、ここに1行足します。**

> 補足：AI社員は、田中さんが Claude（claude.ai）で交わした会話そのものを読むことはできません
> （その履歴はkinbotの外にあるため）。代わりに、その会話で決まったことを、このファイルと
> 開発メモ（Chatの「要望／バグ／メモ」）に写しておくことで、AI社員が同じ前提で動けるようにします。

---

## このプロダクトは何か

B2B営業の「商談前→商談中→商談後」を一本につなぐ営業支援システム（kinbot）。
Neo Career / C Career の営業（DOC・MOCHICA）が毎日使う。**止まると現場が止まる**。
kincall（架電リスト）という別ツールも同じ画面群の中にある。

主担当：田中欽也（kinya.tanaka@neo-career.co.jp、クローザー）。SF管理はSDG（田中綾）。

## 進め方の約束（田中さんの方針）

- 秘密の値（トークン・APIキー）は返答にも画面にも貼らない。
- 反映は必ず「`node --check` → `node dev/smoke.mjs`（すべて動きました）→ 版上げ → BUILD_TAG更新 → push」。
- 壊さないことが最優先。危ういものはPRにして田中さんの確認を待つ。
- 田中さんへの報告は日本語・簡潔・結果と状態・絵文字なし。

## AI社員「kinbot」とは（この仕組みの全体像）

- 名前は「kinbot」（既定名。`server/persona.js`。画面やChatから改名可）。担当＝エラー修正・要望対応・通知・SF監査。
- 自動化の在りか：
  - 毎時0分：GitHub Actions「1時間ごとの自動改善」（安全なら本番へ、危ういものはPR）。
  - 毎日3:00：GitHub Actions「夜間開発」（まとめてPR、朝に確認）。
  - 平日9/12/15/18/21時：GitHub Actions「定期提案」（案を出すだけ）。
  - 30分ごと：kinbot本体で全リストのSF監査。
- 関所（安全網）：CI（構文＋smoke）／危ういものはPR／稼働時間の外はPR／Actionsのロールバック。
  ON/OFFは設定 `autoImprove`・`autoApply`・稼働時間（`/api/auto-apply`）。
- 田中さんはGoogle Chatと「AI社員」画面から、状態確認・停止/再開・稼働時間・改名ができる。

---

## 決定・指示のログ（新しいものを上に足す）

- 2026-09-04 夜間開発のPR #3・#2 を、このClaudeチャットで本番反映（GitHubマージではなく手動適用→push＝実デプロイはこのチャットで行う運用に確定）。#3：kincall「かける」ヘッダーの「探す」隣に『SFの所有者を優先』チェックボックス(#clSfOwnerPref)＋.cl-sfown CSS＋calls.jsに wireSfOwnerPref()（/api/calls/sf-owner-priority を読み書き。ONでSF監査時にSFリード所有者へ担当を自動でそろえバッティング解消）。#2：server/chatcmd.js の parseCommand で /(開発メモ|要件メモ|要望メモ)/ を含む文も kind:notes（『開発メモを見せて』等に対応）。PRブランチpr2/pr3はローカルで確認後削除。AI社員：PRの「GitHubでデプロイ（マージ）」ボタンを撤去（田中さん指示 i）、PR報告は確認・DL・差分・進捗に振り切り、案内文も「実デプロイは開発チャットで行う」に変更。※GitHub上のPR #3/#2 自体はopenのまま（内容は反映済み）。deployedPrsSeen 連動(案1)の仕組みは残置。

- 2026-09-04 AI社員デプロイを案1（GitHubでマージ→チャット連動）に。理由：チャットからのマージは GH_DISPATCH_TOKEN にマージ権限が無く「Resource not accessible by personal access token」で失敗（Contents/Pull requests のWriteが必要）。案1は読み取りだけで実現：syncMergedPrs({days=14,notify})＝closed&merged_at最近のPRを走査し、未処理(settings.deployedPrsSeen)なら本文の「メモID:NNN」を updateDevNote(id,{status:'done'})で対応済みに、印を保存、notify時はdev通知。きっかけ＝5分ごとの定期＋/api/ai/prs 冒頭でも実行（報告時に即反映・respに synced 件数、UIで対応中を再読込）。UIの『デプロイ（本番反映）』ボタンは『GitHubでデプロイ（マージ）』リンクに変更（GitHubでマージ→自動で対応済み連動、権限不要）。案内文も追加。※チャットからのマージ実行(案2)にしたい場合はトークンにContents/PR Write権限が必要。

- 2026-09-04 AI社員のPR機能を全拡張＋デプロイ＋進捗表示（田中さん指示。デプロイは案B＝チャット/ボタンからマージ→対応済み、本番反映OK）。API：GET /api/ai/prs?mode=summary|detail&mergedDays=N（オープン＋直近マージ済み、各PRの変更ファイル[/pulls/:n/files]、summaryはLLM要約、md/txt両方）。GET /api/ai/pr/:n/diff（Accept: v3.diff、最大60000字）。POST /api/ai/pr/:n/merge（isAiOwner限定、squashマージ→PR本文の「メモID:NNN」を updateDevNote(id,{status:'done'}) で対応済みに）。GET /api/ai/progress（/actions/runs 最新の status/conclusion＋in_progressジョブの現在ステップ名で『今なにをしているか』）。gh()共通ヘルパ（token=GH_DISPATCH_TOKEN/…、repo=KINBOT_REPO）。会話 /api/ai/chat は PR報告意図で action:"pr-report" を返しフロントで runPrReport 起動。UI（ai.js/ai.html）：開発AIカードに サマリ/詳細ラジオ＋「直近デプロイ済みも」＋「PGRを報告する」→PR一覧（#番号/タイトル/バッジ・要約・変更ファイル+行数・「差分を見る」展開(暗背景pre)・GitHubで開く・「デプロイ（本番反映）」confirm付き）＋md/txtダウンロード。進捗バナー #devProgress（12秒ごとpoll、run/fail/okで色・点滅）。※マージにはトークンのマージ権限が必要。

- 2026-09-04 AI社員：開発AI(キツツキ)が作ったPRを報告し、MD/テキストでダウンロードできるように（田中さん指示）。GET /api/ai/prs（isAiOwner限定）＝GitHub REST GET /repos/kinyatanaka-code/kinbot/pulls?state=open を GH_DISPATCH_TOKEN(なければGITHUB_TOKEN)で取得し、{prs[{number,title,url,created,draft,body}], md, count} を返す。md は「開発AIからのPR報告」＋各PRの見出し/作成日/URL/本文。トークン未設定/取得失敗時はその旨をmdに。UI：開発AIカードに「PRを報告・ダウンロード」ボタン(#prReport)。押すとチャットに件数＋#番号タイトル一覧を出し、md を PR報告_YYYY-MM-DD.md でBlobダウンロード。403は権限メッセージ。

- 2026-09-04 AI社員：開発AIカードのサマリに「未対応」件数を追加（対応中/未対応/次の改善の3枠、未対応＝dev-notes status=new の件数）。キツツキ会話(/api/ai/chat)の返答が {"response":".."} 形式やコードフェンスで表示される問題に対応：サーバで ```json フェンス除去＋JSONなら response/reply/text/message/answer を抽出して中の文だけに。system プロンプトにも「JSONやコードで囲まず日本語の文だけで」を明記。

- 2026-09-04 AI社員のキツツキを「会話AI化＋CEOレポート＋オーナー限定」に（田中さん指示：会話にならない/一辺倒/報告不足、Gemini・Claude選択可、操作は俺だけ・他は権限なし表示）。実装：POST /api/ai/chat＝現状データ（開発AIのautoImprove/autoApply/稼働時間・対応中/最近直した/未対応件数、社内支援AIの各通知ON/OFF・監査/記録の頻度）をsystemに渡し、callLLMPublic(sys,user,700,{provider,fallback})で応答。providerは gemini / claude(=anthropic)。history直近8件を会話に含める。定型文廃止・CEOとして要約報告・次の一手を提案・操作は画面で案内。権限：isAiOwner(req)=req.isAdmin||req.user===AI_OWNER_EMAIL(既定 kinya.tanaka@neo-career.co.jp)。/api/ai/chat・/api/ai/task・/api/ai/name・/api/auto-apply をオーナー限定（非オーナーは403「権限がありません」）。UI：ceo-inputのsendを/api/ai/chatへ、Gemini/Claude切替select(#aiProvider)追加、403は「権限がありません」をチャットに表示。※LLM鍵（GEMINI/ANTHROPIC）が要る。操作の自動実行はまだ無し（会話＋報告＋画面操作案内）。

- 2026-09-04 AI社員のCEO指示欄を改行できるように（田中さん指摘：改行できずすぐ送られる）。#aiTaskInput を input→textarea(rows=1)に。keydown：Enter=送信・Shift+Enter=改行、e.isComposing中(IME変換)は送らない。input時に高さ自動伸縮（max140px）、送信後 height:auto でリセット。CSS：.ceo-input を align-items:flex-start、textareaに resize:none/line-height/max-height。

- 2026-09-04 AI社員新デザインの表示崩れを修正。原因：main.ai-pageがビューポート固定のflex column(overflow:hidden)で、子カードがflex-shrinkして縦に潰れ重なった。対策：main.ai-pageを display:block/overflow:auto/height:auto の通常フロー＋スクロールに、.ceo-card/.dept-grid/.ai-cols-sub を flex:0 0 auto。加えて「覚えていること」に /api/ai/status の d.memory（＝kinbot-memory.md の開発ログ）がそのまま漏れていたため、最近やったこと/覚えていることの下段ごと撤去（モック準拠）。開発関連の履歴は開発AIカードの「見る・操作する」内(対応中/最近直したこと)に残す。

- 2026-09-04 AI社員ページを新デザインに刷新（田中さん承認モック準拠：俺→キツツキ(CEO)→社内支援AI/開発AI、話しかけやすく・各AIの状態が見える）。構成：上部にCEOカード＝既存の机キツツキSVG(KITSUTSUKI_SVG)を主役に緑グラデ帯、名前＋CEOバッジ＋改名、指示入力欄(/api/ai/task)＋クイック指示ボタン(今日の状況/開発を止めて/アポ割り振り確認)＋ミニチャット。下に2枚の部門カード：社内支援AI/開発AI（アイコンSVG・稼働中バッジ・サマリ数字[社内支援=仕事数/ON常時数, 開発=対応中/次の改善時刻(nextRunLabelから抽出)]・主要ジョブのON/OFF/常時チップ・「この部門を見る・操作する」で more を開閉）。開発AIカードに自動改善(swImprove=autoImprove)/本番反映(swApply=autoApply)のスイッチと稼働時間(runFrom/To/Every)を配置。データは /api/ai/org のdepts.jobs＋/api/ai/status。旧hero/3カラム/どこで動く表は撤去（最近やったこと/覚えていることは下に残置）。orgHtmlは未使用（残置無害）。画像は既存SVG流用。

- 2026-09-04 プロセスの集計から土日を除外（田中さん指示）。商談日(start_time／商談記録のcreated_at)が土曜/日曜のアポ・商談記録をカウントしない。isWeekend(ymd) を追加し、buildDone/buildDoneOwner（実施の集合/Map）、countRange（設定ユニーク）、月ごとuniqSet構築、招待owner(inviteOwner)構築に適用。日ごと展開(grain=day)は土日の行を出さない。週の範囲表示(from〜to)は月〜週境界のままだが集計は平日のみ。

- 2026-09-04 プロセス月ごと：設定数の拾い漏れ（current_owner が空/インサイドのまま）を解消。_setdiagで確認＝104件中 未定12/インサイド10 は current_owner 未割当。対策：会社×商談日でユニーク化した初回商談の担当を current_owner(クローザー・実施専任除く)→記録owner(doneOwner)→招待主催者(invite_event_owner)→未定 の順で補完。aposByMeetingDate に invite_event_owner を追加。中澤良太は 2026-08 のみ「実施専任」（案A・8月限定）：設定数=0、実施数=記録の担当(owner)が中澤の件数。中澤 current_owner のアポは中澤に数えず本来の担当へ再割り当て。buildDoneOwner(会社|商談日→owner) 追加、buildDone(集合)は実施の内数判定に使用。点検API _setdiag/_apodup/_procdiag は撤去。※週/日(countRange)は全体のユニーク設定/内数実施のまま（実施専任の月限定除外は月ごと表のみ）。実施専任フラグは一般化せず中澤×8月をコードに固定。

- 2026-09-04 プロセスのクローザー別「実施数」を『実際に実施した商談（＝商談記録の owner が本人）』基準に変更（田中さん確定）。実装：buildDone(from,to)＝初回タイトル(対象タイトル)限定＋録音ありの商談を 会社名|商談日→owner のMap（会社×商談日でユニーク）に。月ごと：設定数＝会社×商談日でユニークな初回商談を担当(current_owner、クローザー優先)ごと、実施数＝done Map の owner ごと。合計＝設定はユニークapo数、実施は done.size。全体(週/日)の実施も done.size（記録ある初回商談のユニーク）。※設定は予定担当・実施は記録担当なので基準が異なり、個人の実施率が100%超になることがある（仕様）。会社名×商談日での突合はズレたら invite_event_id/bot_id 直リンクに強化する方針は継続。

- 2026-09-04 プロセスの数え方を確定（田中さん）：クローザー・インサイド両方の予定にある初回商談（対象タイトル＝【初回】【新/ヒ】＋メルマガ）を全部読み、会社名×商談日で重複除外したユニークな初回商談を「設定数」に、そのうち商談記録（録音/文字起こし）がある会社名×商談日を「実施数」に。全体（月/週/日/合計）はユニーク数。クローザー別も知りたい→各ユニーク初回商談を担当(current_owner、複数owner時はクローザーを優先)に割り当て、非クローザーは「その他（インサイド・未定）」。実装：countRange をユニーク集合で数え、month grain は uniq Map(会社|商談日→owner) で担当割り当て。実施突合は会社名×商談日（ズレたらID＝invite_event_id/bot_id 突合に強化する方針・合意済み）。点検API _apodup/_procdiag 撤去。※クローザー別の実施は「そのクローザーがcurrent_ownerの初回商談のうち記録あり」。もし『本人が実施した商談数』にしたい場合は meeting owner 基準に切替が必要（未対応）。

- 2026-09-04 プロセス週ごと（全体）：週の行クリックで日ごとに展開表示。API /api/calls/process に grain=day を追加（?from&to を1日ずつ countRange で全体合計。名前=M/D・曜日つき）。UI：週行(.proc-week)にキャレット、クリックで grain=day を取得し直下に .proc-day 行を差し込み／再クリックで閉じる。

- 2026-09-04 プロセス（案B）：設定数を担当で絞らず、対象アポ（【初回】【新/ヒ】＋メルマガ・商談日が期間内）を全部数える＝インサイド獲得も反映。月ごと(クローザー別)は current_owner がクローザーなら本人行、そうでない（インサイド/未定）は「その他（インサイド・未定）」行にまとめる。週ごと(全体)は月指定に変更＝選んだ月の範囲(monthRange＝apoMonthWindows優先/暦月)を月〜日の週に分割し月範囲でクリップして各週の全体合計。UI：週ごとにも月ピッカー。countRangeから closer 絞り込みを撤去、monthRange ヘルパ追加。※実施の突合(会社名＋商談日)は8月で機能(54件)。

- 2026-09-04 プロセスタブに「週ごと（全体）」を追加（田中さん要望：メンバー別でなく全体で週ごとの設定数/実施数）。/api/calls/process に grain=week を追加：直近8週（月〜日）の全体合計の 設定数/実施数/実施率 を返す（クローザー担当ぶんを合算、設定＝【初回】【新/ヒ】＋メルマガ・商談日が週内、実施＝会社名＋商談日で記録あり商談に突合）。grain=month は従来のクローザー別。UI（loadProcess）に「月ごと（クローザー別）/週ごと（全体）」トグルを追加。※実施数がまだ0＝会社名(companyFromTitle/normCompanyKey)や商談日(meeting.created_at vs apo.start_time)の突合が実データで合っていない可能性。次に実施の突合ロジックを実データで調整予定。

- 2026-09-04 実績を2階層タブに再構成（田中さん指示）。上段トップタブ #stTop：実績／設定・管理／プロセス。実績を選んだときだけ 全体/個別(stScopeWrap)＋日/週/月/リスト別/メンバー別の分析(stPeriod) を表示。設定・管理は period から外しトップタブへ（loadAdmin）。新規「プロセス」タブ（loadProcess）：クローザー×月で 設定数／実施数／実施率。定義：設定数＝そのクローザー(current_owner)宛の商談予定で、タイトルが【初回】【新/ヒ】＋メルマガ含む（実績のアポ判定と違いメルマガも数える）かつ商談日(start_time)が月の範囲。実施数＝そのうち記録のある商談（listMeetings＝transcriptあり）を 会社名(normCompanyKey)＋商談日(YMD) で突合。実施率＝実施/設定。月の範囲＝設定・管理の月ごと範囲(apoMonthWindows[YYYY-MM])を優先、無ければ暦月。担当＝現担当(クローザー)。API：GET /api/calls/process?month=YYYY-MM（items[{誰,設定数,実施数,実施率}]＋合計）。DB：aposByMeetingDate(from,to)＝start_time範囲でsmart_links。UI：月ピッカーつき表、合計行。

- 2026-09-03 アポをカレンダー予定基準にした直後、実績/プロセスシートのアポが全部0になった不具合を修正。点検(_apodiag2)で判定は正常(104件中98件が対象)と確認→原因は日付型：aposTakenInRange の taken_at/start_time は timestamptz＝JSのDate。toYmd は "YYYY-MM-DD"文字列前提の正規表現で、Date を String化した "Mon Aug 17 2026..." を解釈できず空→属する()で列が無く全件 continue で脱落＝0。対策：ymdJst(v)=new Date(v)→JST(+9h)→YYYY-MM-DD を導入し、computeStatsGrid と runProcessSheet のアポ集計(taken_at/start_time)に使用。担当突合も setterEmail を「現担当メール(current_owner)→setter_email→setter名→emailOfName」の順に強化。点検API _apodiag2 撤去。

- 2026-09-03 アポの件数の数え方を「アポ一覧（カレンダー予定＝smart_links）」に統一（田中さん確定）。対象＝タイトルに【初回】または【新/ヒ】を含む予定のみ。除外＝「メルマガ」を含む（メルマガ【初回】等）＋その他タイトル（【2回目】【ユ/フォ】等）。判定は isApoCountableTitle（/メルマガ/なら除外、/【初回】/ か /【新[/／]ヒ】/）。担当は実獲得者に寄せる（A）：会社名(companyFromTitle→normCompanyKey)で kincallのアポ獲得ログ(apoWonCalls, caller)に突き合わせ→無ければ setter/current_owner（クローザー）。内/外は予定の商談日 start_time（実績=isInFor、プロセスシート=termMode fixed/auto）。SF/kincallのアポ“件数”は使わない（コール/接触はセールス=SFレポート＋kincall・インサイド=kincallのまま）。computeStatsGrid と runProcessSheet 両方を差し替え（SFブロックのアポ按分と旧applyApoCounts/インサイドwonCallsアポを撤去）。※本番シートはお試し(dryRun)で件数確認してから。タイトル表記ゆれは実データで要微調整。

- 2026-09-03 セールス(クローザー)の実績を「kincall＋SFレポートの単純合算」に変更（田中さん合意・役割で記録先が分かれ二重計上なし）。実績(computeStatsGrid)：架電ログのコール/接触ループと kincall実獲得(apoWonCalls)のアポループを inside限定から全メンバー対象に（role!=="inside" のcontinueを外す）＝セールスにも kincall を加算。SFレポートのコール/接触/アポは従来どおりセールスに加算されるので結果 sales＝kincall＋SF、inside＝kincall。プロセスシート(runProcessSheet)の合算ブロックも insideName を全メンバーに拡張＝セールスにも kincall を加算（SF/kinbotアポ記録は別途加算のまま）。※SFレポートIDはセールスのSFぶんの取得元として引き続き必要（合算に足す一方）。要：お試し(dryRun)で件数確認。

- 2026-09-03 プロセスシートの書き込みを「実績（合算）ベース」に変更（B案：セールス＋インサイド両方の行に書く／田中さん合意）。従来：SFレポート直読み＋kinbotアポ記録(setter=クローザー)。追加：runProcessSheet で tallied（担当名→"M/D"→{コール,接触,アポ（期内/期外）}）に、インサイド（inside/インターン）の kincall 実績を合算＝コール/接触は callStatsByDay(caller=inside)、アポは apoWonCallsInRange(result~アポ獲得, caller=inside) を会社名(call_targets.company)→アポ一覧(smart_links label)の商談日 start_time に normCompanyKey で引き当て、期内/期外は termMode(fixed=from..to / auto=アポ月==商談月)で判定（商談日不明は期内）。インターン除外の既定を反転（psInterns!==falseで含める）。シートの列/行対応(readLayout/buildUpdates)は流用。SFレポートの二重取り込みは不要（実績と同じ数え方）。要注意：本番スプレッドシートに書くのでお試し(dryRun)で件数確認してから実行。

- 2026-09-03 実績「設定・管理」タブのプロセスシート管理を編集可能に。反映先スプレッドシート(共有URL または ID→サーバがsheetId抽出)・シート名(タブ)・SFレポートID・実行するSFユーザー(email)を入力して「反映先・設定を保存」（PUT /api/process-sheet {sheetId,sheetName,reportId,owner}）。状態表示（最後の実行）・自動実行ON/OFF・今すぐ実行/お試し(dryRun)は従来どおり。

- 2026-09-03 実績に「設定・管理」タブを追加（田中さん指示）。中身：(1)アポの「期間内/期間外」の基準（設定画面から移設・実績に集約。/api/calls/apo-window の mode/days/月別範囲）、(2)プロセスシートの管理＝状態表示（シート名・レポート有無・実行SFユーザー・最後の実行）＋自動実行ON/OFF（PUT /api/process-sheet {autoRun}）＋「今すぐ実行」/「お試し(dryRun)」（POST /api/process-sheet/run）。calls.jsに loadAdmin() を追加（statsPeriod="admin"）。設定画面(settings.html)のアポ基準カードは削除（settings.jsのIIFEは要素が無ければ早期returnで無害なので残置）。全体/個別トグルは admin でも無効(dim)。

- 2026-09-03 実績を「全項目まとめて1ファイルCSV」で書き出せるようにした（田中さん指示）。対象：グループ全体/セールス全体/インサイド全体/各メンバー/各リスト（＋担当内訳）を、日次・週次・月次まとめて、率(コール→接触/接触→アポ/コール→アポ)も含む。列＝粒度,区分,対象,指標,期間キー,期間名,値。UTF-8 BOM(ExcelでそのままひらけるCRLF)。実装：stats-grid と stats-by-list の中身を computeStatsGrid(period,span)/computeListStats(period,from,to) に関数化し、薄いハンドラ＋CSVエンドポイント GET /api/calls/stats.csv で3粒度ぶん回して生成。実績UIに「CSVで全部書き出す」ボタン(clStatsCsv)。

- 2026-09-03 実績：インサイドのアポが全部0だった不具合を解消（案B＝実態に合わせる）。診断(_apodiag)で判明：アポ一覧(smart_links)の setter/setter_email は本来「アポ獲得者(インサイド)のメール」の想定だが、実際は collectApoAppointments が『商談カレンダー予定の主催者（＝クローザー）』の email を setter に入れており、アポの獲得者がほぼ sales になっていた（だからsetter基準ではインサイド0）。対策：インサイドのアポは kincallの架電ログ（call_logs.result ~ 'アポ獲得'、かけた人 caller = インサイド）で数える（新DB関数 apoWonCallsInRange＝caller/日/company を返す）。内/外は会社名(call_targets.company)を normCompanyKey で smart_links(label→会社名)の商談日 start_time に引き当てて isInFor で判定（引き当て無しは期間内）。セールスは従来どおり（件数=SFレポート、内/外比率=アポ一覧setter＝主催者=セールスのstart_time）。点検API _apodiag は撤去。※将来の本筋：アポ作成時に setter を主催者ではなく実獲得者（招待のcreator/kincall/apo確定メール送信者）で入れる。

- 2026-09-03 AI社員を「組織」ビューに再構成（田中さん構想：オーナー＝田中さん、CEO＝キツツキ、その下に部門AI。まずは2部門：社内支援AI／開発AI。kincall(架電系)は当面 社内支援AI に含める。分かりにくくなったら後で分割）。第一歩＝自動化の棚卸しカタログ：GET /api/ai/org が ceo＋depts[{社内支援AI, 開発AI}]＋各配下ジョブ{name,trigger(頻度),state(on/off/always),detail} を返す（stateは設定から：autoImprove/autoApply/callReport/sfUnlinkedNotify/devSummary 等はON/OFF、他は常時）。ai.jsに orgHtml で組織カタログを描画（.ai-org、社内支援AI/開発AIの2カード＋ジョブ一覧＋状態チップ）。既存のCEOチャット(タスク依頼=/api/ai/task)＝指示の場、完了/進行中タスク＝開発AIの仕事。今後：CEO指示を各部門ジョブ設定に反映（半自動）、報告(朝/週次)の部門別統一、必要なら部門AIを判断AI化・kincall AIを分割。

- 2026-09-03 kincallがスマホで見えない問題を修正。原因：標準モバイルCSSは .sidebar を下部バーに畳むが、kincallは各ナビ項目が .side-wrap で包まれており下部バーのflexが崩れて非表示状態に。対策：calls.jsに @media(max-width:760px) で .kc-side .side-wrap{display:contents} を追加し項目を下部バーの直接の子に。あわせて広い表/グリッド/タブを横スクロール可、カードは1列、日付セルはnowrap。※「全機能スマホ対応」は範囲が広く、他ページ(home/apo/sf-launch/report等)のモバイル最適化は順次対応の必要あり（要優先度確認）。

- 2026-09-03 実績「月ごと」表示の期間内を、各月ごとに日付範囲で手設定できるようにした（田中さん指示・例：8月=8/10〜9/4、9月=9/7〜10/2。隙間/重なりOK＝土日など。列は月単位のまま、内/外の判定にだけ範囲を使う。未設定月は月初〜末日）。設定 apoMonthWindows（JSON: {"YYYY-MM":{from,to}}）を追加、/api/calls/apo-window の GET/PUT が months を扱う。実績側 stats-grid に isInFor(colKey,md) を追加：period==="month" のときは各列(区切り.key="YYYY-MM")の範囲で判定、それ以外は従来の inSpan(span/days)。インサイドは直接、セールスは salesRatio(isInForで算出)で按分。設定画面に月ごとの範囲入力（month＋開始日/終了日、追加/削除、月ごと保存）を追加。日/週は従来どおり。

- 2026-09-03 実績に「リスト別」タブを追加（kincall架電ログ基準／田中さん要望）。call_logs→call_targets→call_lists を JOIN してリスト別にコール/接触/アポと率を集計、担当(caller)内訳つきのカードで表示。DB: callStatsByList(from,to)。API: GET /api/calls/stats-by-list（?period=day/week/month か ?from&to、返り値 items[{list_id,list_name,コール,接触,アポ,担当[]}]）。UI: stPeriodに「リスト別」ボタン、loadListStats、.kc-listcard/.kc-listgrid。全体/個別トグルはリスト別・分析時は無効(dim)。次段：クローザーの実績・分析を SF+kincall 合算に。SFのTaskを CreatedDate=時間帯・Description=コメント で読み、時間帯/コメント分析に反映（SF由来は「SF」表記）。架電Taskの区別は要確認だったが未確定→実装時に TaskSubtype=Call 等で仮置き予定。

- 2026-09-03 実績：全体/個別・日週月の切替が重かったのを高速化。loadStatsを fetchStats(キャッシュ:_statsCache[period]) と renderStats(描画) に分離。全体/個別トグルは再取得せず renderStats のみ（即時）。期間タブはキャッシュ利用、「読み込み直す」で force 再取得。個別を案Aに変更：セールス/インサイドの大カード2枚(.kc-bigcard)に、各チーム合計(kc-g-team)＋各メンバー表(kc-mem)を内包（.kc-bigwrapで横並び）。

- 2026-09-03 実績のアポ「期間内/外」の基準を設定画面から変えられるようにした。設定：apoInWindowMode（span=表示期間内・既定／days=今日から◯日以内）と apoInWindowDays（◯日、既定14）。API：/api/calls/apo-window（GET/PUT、saveSettings）。実績側 stats-grid の inSpan が設定連動（days時は商談日が todayJ〜today+◯日 なら内）。商談日不明は内に寄せる（従来どおり）。UI：設定→動作設定タブに「アポの『期間内/期間外』の基準」カード（基準セレクト＋◯日入力、settings.jsで load/save、days選択時のみ日数行を表示）。

- 2026-09-03 実績のアポ内/外を「アポ一覧（smart-linkのstart_time＝カレンダーの商談予定日）」で判定するように変更（田中さん指示：プロセスシートと同じSFレポート＋商談日はカレンダーから／案A・獲得者setter基準）。インサイド：アポ一覧を setter 基準で件数化し、start_time で内/外（空＝期間内）。セールス：件数はSFレポートのまま、内/外の比率だけ同 setter のアポ一覧の商談日から算出して按分（該当アポ一覧が無ければ期間内）。setterのメール/氏名を members に突合。※setterが会員名と一致しないと引き当たらない点は実データで要確認。将来：会社名(label)×担当での厳密突合や、按分でなく1件ずつ突合も可能。

- 2026-09-03 実績：アポ獲得トグル(期間内+外/内/外)を廃止し、アポは常に「アポ（期間内）」「アポ（期間外）」の2行表示をベースに。率はアポ合計(内+外)で計算。「全部が期間外になる」問題の原因＝内/外判定に使う商談日が取得できていない（セールスはSFレポートに商談日列が無い/名前不一致、ISはstart_time未設定）と、私の実装が空→外に倒していたため。対策：商談日が空のときは期間内に寄せる（IS・セールス両方）。セールスの商談日列の判定語を拡充。※正確な内/外にはSFレポートに商談日列が必要。ISはアポ記録のstart_timeが入っていれば正しく判定。今後：owner→メンバー突合とinsideアポ計上（グループ=セールスと同値だった件）を実データで要確認。

- 2026-09-03 kincallのヘッダー表示を現在ページ名に切替（showPaneで .kc-name/.kc-sub を更新：call=kincall/架電リスト、stats=実績、lists=リスト管理）。実績のタブ並びを 全体/個別（上段）→ 日ごと/週ごと/月ごと/メンバー別（下段）→ アポ獲得(期間内+外/内/外) に変更。

- 2026-09-03 kincall「実績」を全体/個別タブ＋アポ内外に拡張（田中さん要件）。定義：グループ全体＝セールス＋インサイド、セールス＝closer、インサイド＝inside/インターン。セールスも架電するので列は共通（コール/接触/アポ）。データ源：インサイド＝架電ログ(callStatsByDay)、セールス＝SFレポート（コール進捗と同じ psReportId を runReport+toRecords＝コール/接触/アポ/商談日）。アポ獲得の期間内/外＝商談日が表示期間内か（セールス=SFの商談日 meetingDate、インサイド=アポ記録 start_time）。/api/calls/stats-grid を拡張し members(role別,値=コール/接触/アポ内/アポ外) と totals(group/sales/inside) を返す（旧 items/合計 も残置）。画面：実績に「全体/個別」タブと「アポ獲得：期間内/期間外/両方」トグルを追加。全体はグループ/セールス/インサイドの3表、個別はセールス→インサイドの順にメンバー全員。※SFレポートの列判定は pickCol の日本語ラベル依存・日付フォーマットは toYmd で吸収。SF未設定時はセールスが空になり sfError を表示。要実データ検証（列名・商談日項目・owner→メンバー突合）。

- 2026-09-03 AI社員ページの上部にあった小さなロボ帯（topbarの kinbot.svg＋「AI社員」＋「押すと相談できます」）を撤去し、緑のキツツキヘッダー(.ai-hero)を最上部に出す形にした。実装：ai.htmlのtopbarから brand を空に。CSSでデスクトップは .topbar{display:none}、スマホ(≤760px)はメニューボタン(kb-menu-btnはnav.jsがtopbarへ append)のため .topbar を表示。AI社員ページのみの変更。

- 2026-09-02 AI社員ページを手書きラフに沿って刷新。ヘッダー：左＝アバター（キツツキ）＋名前＋改名、右＝「AIが動く」ON/OFF（大スイッチ＝master、実体はautoImprove）＋稼働時間帯（runFrom/To/Every）＋「直したら本番へ反映」（autoApply、小スイッチ）。本体3カラム：完了タスク（dev-notes status=done）／進行中タスク（対応中doingを上・未対応newを下）／タスク依頼チャット。チャットは POST /api/ai/task（クローザー/管理者限定）＝入力を開発メモに登録し、自動改善ONなら dispatchGithubWorkflow で即着手（Chatの「直して」と同じ）。下段に従来の 最近やったこと／どこで動いているか＋SF監査／覚えていること を小さく残置。load()は /api/ai/status と /api/dev-notes を並行取得しstatus別に分割。

- 2026-09-02 夜間開発の朝の通知が DOC Team に届いていた＆長文で分かりにくい問題を修正。原因：night-report が「開発(dev)」の宛先が無いと assign にフォールバックしていた（DOC Teamがassign対象で漏れていた）＋本文にNIGHT_RESULT.md全文(1500字)を載せていた。対策：(1)assignフォールバックを廃止し notifyAll(text,"dev") だけに（＝「開発（朝の通知）」ONのチャットにのみ送る）。(2)本文は「直したもの」から メモID・内容 の行だけを正規表現で抽出し最大12件＋PRリンクの短い形に（変えたファイル・直し方の長文は載せない）。※田中さんは「テスト」チャットだけに送りたい → 設定→Google Chat通知先で テスト の「開発（朝の通知）」をON、DOC Team等はOFFにする運用。

- 2026-09-02 レコーディング画面（index.html）から「かささぎ」を消した（田中さん指示）。削除：入室カードの「かささぎ（AIが説明する）を使う」チェック(joinKasasagi)、同意文の「かささぎを使う場合は…」の一文、右側の案内(ks-hint)、ライブの「かささぎ」タブ(data-pane=kasasagi のボタン)。かささぎpane本体（data-pane=kasasagi の中身）はタブ削除で到達不可＋hiddenのため残置で無害。app.js は joinKasasagi を `|| {}` でガードして参照しているので要素削除でも壊れない。バックエンド/APIのかささぎ機能は温存（UIだけ非表示）。

- 2026-09-02 ひも付けたら検索せず直接SF更新できるようにした。ホームのSFアイコンは、カードにひも付いたSF商談ID(homeItems.oppId)があれば openSfEdit(key, oppId) → deals.html?...&view=salesforce&opp=<id> でその商談を直接開く（会社名検索・商談選択が不要）。商談カードは m.sf_url から oppIdFromUrl で、予定カードは e.apoOppId から判定（/api/calendar/today が smartLinksByEventIds の sf_autolaunch 結合で opp_id を返す）。ひも付いていない予定/商談は従来どおり検索パネル。ひも付け直後は homeItems[key].oppId を即セットしてその場で直接更新に切替。deals.js は既に window._kbOppId=?opp= に対応。

- 2026-09-02 ホームの「今日の商談」カードからもSF商談をひも付けられるようにした。既存のSFパネル（sfPanelHtml：会社名で商談検索→選択）は選ぶだけで保存していなかったので、選択状態に「この商談にひも付ける」ボタン(data-sf-link)を追加。商談(bot_idあり)は新エンドポイント POST /api/meetings/:id/sf-link（opp_idからURLを作り setMeetingSfUrl で保存＝以後のSF記録はこのIDに直接書く）。予定(bot_idなし)は planSlugForKey でアポのslugを引いて POST /api/apo/:slug/sf-link に流す。ひも付け後は s.done 表示。meeting picker自体は全レコードタイプを表示（人が選ぶ）＝手動は任意、AUTOひも付けはクロスのみのまま。

- 2026-09-02 商談後のSF記録・更新も完全にID方式へ（会社名検索に頼らない）。autofillMeetingToSf は recordId を ①m.sf_url ②resolveMeetingOpp(bot_idでautolaunch→会社名核でautolaunch) の順で解決し、解決したら setMeetingSfUrl で商談のsf_urlにも保存（次回から直参照、SF/DB検索なし）。resolveMeetingOpp/persistMeetingOpp を追加、DB関数 autolaunchByBotId / autolaunchLinkedByCompany を追加（どちらもopp_id保持行のみ）。sweepMeetingSfRecords は sf_url 無しでも候補に含め解決を試みる（除外をやめた）、autofillが needLink（未ひも付け）を返したら失敗扱いにせず SF未紐づけ として次回リトライ（あきらめカウントしない）。手動リード変換(/api/salesforce/leads/:id/convert)で body.slug があれば oppId をその場でひも付け。slug無しの手動立ち上げは SF確認/一覧のバックフィルで拾う。対象はクロス商談のみ。

- 2026-09-02 【設計・実装】予定（アポ）とSF商談(Opportunity)を1対1でひも付ける方式を導入（対象はクロス商談のみ、田中さん確認済み）。目的：商談後のSF更新・SF確認で毎回会社名検索して当てにいく方式（表記ゆれで外れる）をやめ、ひも付いたIDで直接見る。実装：sf_autolaunch に opp_name/opp_stage/linked_at/linked_by を追加し、opp_id を「正のリンク」として使う。DB関数 setApoOppLink/clearApoOppLink/refreshApoOppMeta を追加。エンドポイント：POST /api/apo/sf-status {slugs}（①ひも付け済みはID一括参照 ②未ひも付けは会社名複数パターンLIKEで探し、立ち上げ済みが見つかればIDをバックフィル保存）、GET /api/apo/:slug/sf-candidates（会社のクロス商談候補一覧＝手動ひも付け用）、POST /api/apo/:slug/sf-link {oppId|null}（手動ひも付け／解除）。クライアント：自分のアポの bulk確認と単発SF確認を slug(ID方式)に切替（applyApoStatus）。SF確認で未検出時は「この商談をひも付ける」→候補選択→リンク。立ち上げ済みなら「別の商談にひも付ける」。自動立ち上げ(tryAutoLaunch)成功時の opp_id 保存は従来どおり＝自動リンク。※手動launch（sf-launchページ）での明示保存は未対応だが、次回SF確認/bulkのバックフィルで拾える。旧 /api/apo/cross-status と applyApoCross は残置（今日の商談側は会社名ベースのまま）。

- 2026-09-02 SF確認（/api/apo/cross-status、クロス商談の立ち上げ判定）で「立ち上げたのに未立ち上げ」と出る不具合を改善。原因：SFの Account.Name とアポのタイトル由来の会社名が表記ゆれ（株式会社の有無・全角半角スペース等）で完全一致(Account.Name IN)せず、該当商談が取得できていなかった。対策：searchLeads同様に会社名の複数パターン（そのまま/スペース除去/法人格を除いた核）で Account.Name LIKE のOR検索に変更し、取得後は normCompanyKey で厳密一致のみを立ち上げ済みとする（誤検出防止）。※なお、立ち上げた商談がクロス以外のレコードタイプの場合や、SF反映直後のタイミングでは、なお見つからないことがある（その場合は再度SF確認を押す）。

- 2026-09-02 自分のアポの操作列も今日の商談と同じ「その他」方式に統一。表示＝SF・メール・担当変更（owner）、その他(.hl-moregrp/.hl-morex)＝会議室・SF確認・外す。その他アイコンにホバー/タップ(.open)で出る（スマホは常時表示）。担当アイコンは押すと .hl-owner プルダウンが開く（既存）。

- 2026-09-02 (1)フッターの設定入口を歯車のみ→「歯車＋設定」のラベル付き小ボタン(.side-foot-set)にして分かりやすくした。(2)今日の商談の操作列で「開く」を常時表示せず、担当変更・開くを「その他」(more/三点アイコン)にまとめた。その他アイコン(.hl-moregrp)にホバー、またはタップ(.open)で .hl-morex が開き、担当変更と開くが出る（スマホは常時表示）。表示は 録音/SF/メール/その他 の4つ。

- 2026-09-02 【方針】ホーム画面の担当変更は「通知もメールも出さない」。/api/smart-links/:slug/owner は通常呼び出しだと Google Chat通知(notifyAssigned)・確定メール自動送信(sendApoMail、autoConfirm時)・商談予定の招待作成(createApoInvite) が走る。quiet:true を付けると担当の差し替えのみ（何も送らない・招待も作り直さない）。ホームの予定(plan-rep-mini)・アポ(apo-rep-mini)の担当変更を quiet:true に変更。今日の商談の商談済みは /api/meetings/:id/meta のため元々無音。アポ割り振り画面(apo.js)は初回割り当て用に従来どおり通知・メールを出す（quietなし）。

- 2026-09-02 今日の商談の「予定」でも担当変更を確実にできるようにした（従来は商談済みのみ／予定はクライアント側のイベントID突き合わせが不安定で出ないことがあった）。/api/calendar/today で各予定に、その予定を作ったアポ(smart-link)の slug・担当(current_owner)を付けて返す（新DB関数 smartLinksByEventIds＝event_id と invite_event_id の両方で照合）。予定行は e.apoSlug/e.apoOwner を優先使用（無ければ従来の planApoMap で補完）、担当変更は /api/smart-links/:slug/owner＝アポ割り振りと同じ仕組み。変更後は planApoMap と dayEvents.apoOwner を更新して再描画＋loadMyApos。アポに紐づかない純粋なカレンダー予定は担当対象外（アポが無いため）。

- 2026-09-02 カードの操作アイコンを主要4つまでに戻し、増えたぶんは「その他」にまとめた。今日の商談＝録音/SF/メール/開く の4つ、担当は hl-more（ホバーで開く、スマホは常時表示）へ。アポ＝SF/メール/会議室/SF確認 の4つ、担当と外すは hl-more へ。hl-more は複数アイコン対応に変更（width固定→max-width+opacity、最大130px）。

- 2026-09-02 今日の商談・自分のアポのカードで、会社名/予定名(.hl-title)が1行省略(…)で切れて読めなかったのを、2行折り返し(-webkit-line-clamp:2, white-space:normal)で見えるように変更。長い名前はホバーで全文が出るよう title 属性も付与（render・apoHomeCard両方）。担当アイコン追加で操作列が広がりタイトル幅が狭くなっていた影響も緩和。

- 2026-09-02 「設定」を左メニューの機能一覧(KB_MENU)から削除し、下部フッターのアカウント名の横に歯車アイコン(.side-foot-set→settings.html)として移設。nav.jsのwho描画ブロックで動的に挿入（全ページ共通）。.side-footをflex横並びにし、名前の横に歯車、ログアウトは下段(flex-basis100%)。スマホは side-foot 非表示のため、モバイルメニュー(items.push)に設定を追加して入口を確保。

- 2026-09-02 担当変更UIを「常時プルダウン」から「担当アイコン方式」に変更。今日の商談・自分のアポの各カードのアクション列に人型の担当アイコン(hIcon owner)を置き、押すとそのカードの担当プルダウン(.hl-owner)が開く（既定は display:none、.open で表示）。委譲クリックで [data-owner-toggle] を検知し closest(.home-card)内の .hl-owner を開閉。商談(mtg-rep-mini)・予定(plan-rep-mini)・アポ(apo-rep-mini)の3種に対応。既存の担当変更ハンドラ（PUT）はそのまま。

- 2026-09-02 今日の商談の「予定」段階でも担当を割り当てられるようにした。予定はカレンダーのイベントで、担当はアポ(smart-link)側が持つ。/api/apo/pickup（その日の全アポ）を取り、予定ID(eventId/invite_event_id)→{slug,owner}の対応表(planApoMap)を作成。予定行がアポに対応していれば担当セレクト(.plan-rep-mini)を出し、/api/smart-links/:slug/owner に PUT して担当を変更（既存のアポ担当変更を再利用＝カレンダー招待・その人のアポ一覧に反映）。loadCalendarでキャッシュ有無に関わらず対応表を読み込み、変更後は planApoMap更新→render＋loadMyApos。純粋なカレンダー予定（アポ紐づけ無し）にはセレクトを出さない。

- 2026-09-02 明日のリマインドのモーダルが、検索の×やカレンダー等の下に潜って上部が押せない不具合を修正。原因：.main>* に z-index:1 が付き .home-wrap（モーダルの親）が z-index1 のスタッキング文脈、一方 .topbar は z-index2 なので、モーダルの z-index を上げても topbar の下に潜っていた。対策：描画後に #rmModal を document.body 直下へ移動（最前面）。モーダル内の配線は scope=rmModal から探すよう変更し、再描画時に古い #rmModal を remove。
- 2026-09-02 今日の商談でも担当を選べるようにした。商談カード（bot_idあり）に担当セレクト(.mtg-rep-mini)を表示、/api/meetings/:id/meta に owner をPUTして更新。allMeetingsのownerを更新してrender→homeScope=mineなら担当を外した商談は自分の画面から消え、選んだ担当の画面に出る。担当候補は loadHomeRepsOnce（/api/smart-links/reps）で先読みし、読み込めたらrender/renderMyAposを描き直す。repOptionsHomeは候補に無い現担当も選択肢に残す。

- 2026-09-02 左メニュー下部のアプリ（kincall / Salesforce / AI社員）を目立たせた。3つに共通クラス .side-hi を付与し、緑グローのカード風＋ほんのり点滅（sideHiGlow、3つを0/0.5/1秒ずらして波打つ）、ホバー・選択で強調。side-icoは currentColor なので文字色を明るくしてアイコンも発光。prefers-reduced-motionでは点滅停止（静的グロー）。スマホ下部バーでは装飾を外し色だけ強調。

- 2026-09-02 【重要・不具合修正】文字起こしが途中で切れる。原因：文字起こしはメモリ上のセッション(sessions.js)に貯め、DBへは定期解析時か会議終了時のみ保存。セッションは再作成時にDBの既存文字起こしを読み込まないため、会議中にRailwayが再デプロイ（今日は多数push）で再起動→新セッションが空から始まり、次の保存で前半を上書きして消えていた。対策：webhookでセッション再作成時に getMeeting の transcript を seedTranscript で引き継ぐ（_seededで一度だけ・既存を前にconcatして先着イベントと競合しても取りこぼさない・lastAnalyzedLenを引き継ぎ後の長さにして再解析コストを出さない）。加えて onFinal で 12秒デバウンスの scheduleSave を追加し小まめに保存、dispose でタイマー解除。重要な商談中の連続デプロイは避けるのが安全。真の未取得（Recallのreal-time取りこぼし）は別問題。

- 2026-09-02 左メニューに独立した「Salesforce」入口を追加し、kincallの下（アプリ群：kincall→Salesforce→AI社員）に配置（href=sf-launch.html、アイコン ico-sf＝雲）。従来ツール配下にあったSF3項目（商談立ち上げ／立ち上げ待ち／プロセスシート）はナビから撤去し、sf-launch.html内のタブへ集約。ツールの入口はアポ振り分け(apo.html)に付け替え、subsはアポ振り分け・資料トラッキング・天気予報・開発メモに。モバイルメニューにもSalesforceを追加。

- 2026-09-02 ホーム「明日のリマインド」の詳細（日付・全員のぶん・送る相手のチェック一覧・直す）を、帯の下へのインライン展開から、モーダル（rm-modal：背景＋中央カード）で開くように変更。帯クリックで開き、背景クリック・×・Escで閉じる。rmOpen状態は維持し、日付/全員のぶん変更での再描画でも開いたまま。中身の描画・配線（rm-fix等）は従来どおり（bar配下にモーダルを置いたのでquerySelectorはそのまま効く）。

- 2026-09-02 ホーム上部の微調整：検索バーを右端固定(margin-left:auto)から外してkinbotロボ寄り（左）に配置。検索幅を min(380px,34vw) に。ツールアイコンをアイコンのみ→アイコン24px＋名前つきの小タイル（.home-tools-bar、名前は2行折り返し）にして「何のアイコンか」分かるように。

- 2026-09-02 ホーム改善：(1)ツールのアイコン(homeTools)を左カラムから上部の検索ボックスのすぐ右横へ移動（.home-tools-bar＝アイコンのみ横並び、名前はtitleツールチップ）。(2)今日の商談ヘッダーの「SF確認」ボタン(homeSfCheckAll)を削除（AI社員のSF監査があるため不要。ハンドラはイベント委譲なので残置で無害）。(3)ホームの「自分のアポ」一覧から担当者を変更できるようにした（各行に担当セレクト.apo-rep-mini、/api/smart-links/reps で候補取得、PUT /api/smart-links/:slug/owner で反映、変更後 loadMyApos で再描画）。

- 2026-09-02 設定「決まった時刻に流す」定例通知が、送り先カードごとに重複表示され「送り先ごとに選べない・連動している」ように見えていた。これらは実際は全体共通（オン/オフ・時刻は1つ）で、届き先は定例ごとに固定：朝の「新しくなりました」＝種類「朝のお知らせ」をONにした送り先／コール進捗＝チームのスペース／夕方・天気＝本人へDM／自己点検・開発メモ＝点検用の送り先。対策：各カード内の重複表示を撤去し、全体共通の1か所（ntGlobal/ntTimers）にまとめ、届き先を明記。送り先ごとの選択が要るのは「種類」チェック（deployNews は on_news で送り先選択可）。

- 2026-09-02 設定「決まった時刻に流す」タイマーのチェックが効かない不整合を修正。原因：(1)「コール進捗」はUIが callProgress を保存するのにジョブは st.callReport を見ていた（キー不一致で無効）。(2) 夕方のやり残し/自己点検/開発メモのまとめ等は明示ON（=== true）のみ動く既定OFFなのに、GETの初期表示が !== false（未設定でもON表示）で表示と動作がズレていた。対策：NOTICE_TIMERSのコール進捗キーを callReport に統一、eveningReminderの既定をfalseに、GETの入り切り表示を「未設定なら各タイマーの既定、設定済みならその値」に変更（ジョブの動作と一致）。

- 2026-09-02 夜間開発の「朝の開発通知」を、指定したGoogle Chatだけに送れるようにした。通知種類「開発（朝の通知）」を新設（chat_targets.on_dev、既定OFF）。設定→Google Chat通知先で、送りたいチャットの「開発」をONにする（そのチャットの Webhook かスペースを登録して選ぶ）。night-report は notifyAll(text,"dev") で送り、開発ONの宛先が無ければ従来どおり（assign）へフォールバック。

- 2026-09-02 【重要・不具合修正】商談後のSF自動記録が同じ企業に重複していた。原因：冪等判定が Salesforce のカスタム項目 kinbot_bot_id__c 依存で、この項目が組織に無いと findTaskByBotId が常に「無し」を返し毎回新規作成していた＋「記録済み」がメモリ（_autoShodanDone）だけで、Railway再デプロイのたびに過去7日分を再記録していた（窓拡大で悪化）。対策：meetings.sf_recorded_at（DB）に記録済みを永続化し、SF項目の有無・再起動に関係なく二度と自動記録しない。setMeetingSfRecorded、listMeetingsに列追加、sweepで sf_recorded_at を除外・成功時に保存。既存の紐づけ済み商談（作成1日より前）は起動時に一度だけ記録済みとみなし、過去分の再記録を停止。※SF上に既に出来てしまった重複は別途手動削除が必要（自動削除はしない）。根本解決としてはSF側に kinbot_bot_id__c を作るのが望ましい（SDG）。

- 2026-09-02 自動改善が自動で直す対象を「エラー・要望・できないこと(gap)・バグ」だけにした（アイデア idea は自動では直さない＝田中さんの方針）。night-brief の pick からアイデアを除外。優先順はバグ→エラー→できないこと→要望。アイデアはChatの「直して 〇〇」で明示指定したときだけ着手。定期提案（advisor）はアイデアを出し続けてよい（開発メモに残るだけ）。

- 2026-09-02 SFに紐づいていない（記録できていない）商談を毎日まとめて通知（既定18:00 JST、設定 sfUnlinkedHour で時刻変更、sfUnlinkedNotify=false で停止）。担当者ごとにDM＋点検チャンネル（selfCheckWebhook/space）へ全体をまとめる。対象は「実際に終わった商談だけ」（要約/文字起こしあり、社内MTG・ユーザーフォローは除外、過去7日、終了30分以上）。Chatは「未紐づけ」、API は GET /api/meetings/sf-unlinked（?notify=1で即通知）。SF紐づけ後は既存の自動記録＋sweepで記録される。

- 2026-09-02 商談後のSF活動記録（活動ToDo＝商談・説明・ネクストアクション）を取りこぼしなく仕上げるよう強化。従来は失敗しても「済み」にして再試行しなかった／窓が30分〜24時間で遅れて届いた文字起こし・後日のSF紐づけを拾えなかった。改善：失敗は済みにせず次の見回り（10分ごと）で自動再試行、窓を20分〜5日・過去7日走査に拡大、要約待ち/連携待ちは済みにしない、上限(5回)到達時のみ1回だけ担当者へ通知。共通関数 sweepMeetingSfRecords。手動仕上げは POST /api/meetings/sf-autofill-sweep、Chatは「SF記録を仕上げて」。SF未紐づけの商談は件数を返す（記録は人が紐づけてから）。

- 2026-09-02 「動かす時間帯」を終日（0時〜24時）から選べるように拡張（田中さんが動けない夜間なども回すため）。cron を終日・毎時:30起動（`30 * * * *`）にし、選べる範囲を 0〜24時に。実行可否は kinbot の runFrom/runTo/runEvery で判定（例：0〜24/2→0:30…22:30、22〜24/1→22:30・23:30）。

- 2026-09-02 「動かす時刻」を、開始時〜終了時＋何時間おき（runFrom/runTo/runEvery）で選ぶ形に変更。AI社員画面のセレクトで指定し、その範囲から実行時刻（:30）を生成する（既定 9時〜21時・2時間おき→9:30〜21:30）。cronは毎時:30起動（UTC 23,0-12＝JST 8:30〜21:30の枠）、実行可否はkinbotが判定。選べる範囲は8〜21時。

- 2026-09-02 自動改善の実行時刻を、田中さんが画面（AI社員→「動かす時刻」の:30チップ）で自由に調整できるようにした（設定 runHours、既定 [9,11,13,15,17,19,20]）。GitHub Actions の cron は毎時:30起動（UTC 0-11＝JST 9:30〜20:30の枠）に固定し、実際に動くかは kinbot 側の runHours で判定（gate.mjs が /api/auto-apply の enabled＝autoImprove かつ 今が動かす時刻、で決める）。9:30固定をやめ、田中さんが調整する形に。より早朝/夜間へ広げたいときは cron の枠を広げる。

- 2026-09-02 AI社員アバターを大きくし、自分のデスクで働く場面にした（ノートPC・コーヒー・観葉植物、机つき）。稼働中はキーを打つように頭がつつく＋画面が光る＋湯気、休止中は目を閉じてZzz。1画面レイアウトは維持（ヒーローの余白を調整）。

- 2026-09-02 AI社員アバター（キツツキ）にアニメを追加。稼働中はコツコツつつく＋軽く弾む（仕事中）、休止中は目を閉じてZzz（寝ている）。いま何をしているかを吹き出しで発言し、数秒ごとに切り替える（buildSayLines）。UIはCSSアニメ、prefers-reduced-motion対応。

- 2026-09-02 自動改善が直した開発メモを自動で片づけるようにした。本番に反映できたメモは「対応済み(done)」、PR止まり（まだ本番に入っていない）は「対応中(doing)」にする。判定は結果メモ（NIGHT_RESULT.md の「## 直したもの」のメモID）を基準にし、「手を付けなかったもの」は触らない。report.mjs が着手メモID(night-ids.json)も送り、拾えないときの代替に使う。夜間開発はPRなので「対応中」。

- 2026-09-02 自己点検の「自動での書き込み」は、実際に動く条件（psAutoRun が true ＋ 書き込む人 psOwner あり）で判定する。以前は「OFFでなければ動く」判定だったため、実際は一度も動いていないのに「30分おきに動きます」と出て、メモID 729（最後の書き込み＝まだ一度も動いていません）の本当の理由が分からなかった。

- 2026-09-02 プロセスシートの「最後に書き込んだ結果」は設定（psLast）にも残す。メモリだけに置いていたため再起動で消え、自己点検が実際は動いていても「まだ一度も動いていません」と言い続けていた（メモID 729・21回）。手で「実行」を押したぶんも記録に残す。

- 2026-09-02 自動改善の実行時刻を「毎時」から「日本時間 9:30・11:30・13:30・15:30・17:30・19:30・20:30」（2時間おき＋最後に20:30）に変更（kinbot-hourly.yml のcron。UTCで 30 0-10/2 と 30 11）。

- 2026-09-02 自動改善の方針：アイデア（idea 種別）の変更は本番に直接入れず、必ずPRにして田中さんが見る（確実な不具合と違い人の判断が要るため）。night-brief が着手メモの種類を dev/night-kinds.json に書き出し、guard.mjs が idea を含むなら ok=false（PR）にする。要望・バグ・エラーは従来どおり（安全なら本番へ、危ういものはPR）。未対応は毎時0分の自動改善で順に着手（Chatの「直して」で今すぐ起動も可）。

- 2026-09-02 Chatの「〇〇を直して」でAI社員に開発を指示できるようにした。指示は開発メモに残しつつ、自動改善パイプライン（GitHub Actions の kinbot-hourly.yml）を focus付きで今すぐ起動し、night-brief がその指示を最優先タスクとして直す。起動には環境変数 GH_DISPATCH_TOKEN（Actions書き込み権限のトークン）が必要。未設定なら開発メモに残して毎時0分の自動改善で着手。自動改善OFF時は起動せず「動かして」で再開を案内。**起動しても本番反映は関所（CI・稼働時間・危ういものはPR・ロールバック）を必ず通る**。制御はクローザー/管理者のみ。

- 2026-09-02 AI社員画面に「覚えていること（記憶の要約）」カードを追加（下部・全幅）。Chatに「記憶」「レポート」「監査」コマンドを追加（記憶＝決めごと・指示、レポート＝状況まとめ、監査＝SF監査を今すぐ実行して結果を通知）。

- 2026-09-02 AI社員の入り口を左メニューの kincall の下へ移動（スマホは最下部）。AI社員画面を1画面に収まるダッシュボードに（長いリストはカード内スクロール）。この「記憶」を新設し、AI社員が経緯・指示を踏まえて動くようにした。
- 2026-09-02 AI社員の名前を「kinbot」に（一度「キツツキ」にした後の変更）。
- 2026-09-02 AI社員を可視化（`public/ai.html`・`ai.js`、`/api/ai/status`）。アバター・稼働状態・抱えている仕事・管理場所・最近の仕事を表示。ON/OFF・稼働時間・改名を画面から操作可能に。
- 2026-09-02 AI社員に人格を持たせ、Google Chatから制御可能に（`自動`で状態、`自動改善を止めて／動かして`、`本番反映を止めて`、`稼働時間 9〜18`、`名前を〇〇にして`。制御はクローザー/管理者のみ）。
- 2026-09-02 kincall：全リストを常にSF監査（30分ごと＋手動）。クロス受注（受注処理完了）の会社は「ユーザー（クロス受注）」表記＝かける対象外。直近失注は「失注（クロス失注）」として対象外（以前は失注もアポ獲得に化けていた不具合を修正）。クロス商談の立ち上がりは「アポ獲得済み（クロス商談）」。優先順位＝受注＞進行中＞直近失注。
