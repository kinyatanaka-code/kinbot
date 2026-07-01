<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>kinbot 設定</title>
    <link rel="stylesheet" href="style.css" />
  </head>
  <body>
    <div class="app">
      <nav class="sidebar">
        <div class="side-brand"><span class="brand-mark"></span><span>kinbot</span></div>
        <a class="side-item" href="index.html"><span class="side-ico ico-rec"></span><span class="side-label">レコーディング</span></a>
        <a class="side-item" href="history.html"><span class="side-ico ico-hist"></span><span class="side-label">商談履歴</span></a>
        <a class="side-item" href="deals.html"><span class="side-ico ico-deal"></span><span class="side-label">案件</span></a>
        <a class="side-item" href="analysis.html"><span class="side-ico ico-ana"></span><span class="side-label">分析</span></a>
        <a class="side-item active" href="settings.html"><span class="side-ico ico-set"></span><span class="side-label">設定</span></a>
        <div class="side-foot"><span id="who" class="who"></span><a href="#" id="logout" class="side-logout">ログアウト</a></div>
      </nav>

      <div class="main">
        <header class="topbar"><div class="brand"><img class="topbar-bot" src="kinbot.svg" alt="" /><span class="brand-name">設定</span></div></header>
        <main class="settings">
          <nav class="set-menu" id="setMenu">
            <button class="set-menu-item active" data-tab="general">動作設定</button>
            <button class="set-menu-item" data-tab="links">登録リンク</button>
            <button class="set-menu-item" data-tab="calendar">Google連携</button>
            <button class="set-menu-item" data-tab="salesforce">Salesforce連携</button>
            <button class="set-menu-item" data-tab="notion">Notion連携</button>
            <button class="set-menu-item" data-tab="ai">AI提案設定</button>
            <button class="set-menu-item" data-tab="thanks">御礼メール例文</button>
            <button class="set-menu-item" data-tab="teams">チーム編集</button>
            <button class="set-menu-item" data-tab="phasedef">フェーズ定義</button>
            <button class="set-menu-item" data-tab="status">状態</button>
          </nav>
          <div class="set-body">

          <div class="set-pane" data-pane="general">
            <div class="set-card">
              <h3>動作設定</h3>
              <label class="field"><span>Bot表示名（会議に出る名前）</span>
                <input id="botName" type="text" placeholder="議事録" /></label>
              <label class="field"><span>あなたの表示名（自社担当の既定値）</span>
                <input id="repName" type="text" placeholder="（任意）" /></label>
              <label class="field"><span>言語</span>
                <select id="languageCode">
                  <option value="ja">日本語 (ja)</option>
                  <option value="en">英語 (en)</option>
                </select></label>
              <label class="field"><span>文字起こしエンジン</span>
                <select id="transcribeProvider">
                  <option value="recallai">Recall標準（日本語は遅め・追加キー不要）</option>
                  <option value="deepgram">Deepgram（速い・要キー登録）</option>
                  <option value="gladia">Gladia（速い・多言語・要キー登録）</option>
                </select></label>
              <label class="field"><span>Deepgramモデル</span>
                <input id="deepgramModel" type="text" placeholder="nova-2" /></label>
              <label class="field"><span>要約・提案の間隔（秒）</span>
                <input id="analyzeIntervalSec" type="number" min="8" placeholder="20" /></label>
              <div class="modal-actions">
                <button class="btn" id="saveBtn">保存</button>
                <span class="saved" id="saved" hidden>保存しました</span>
              </div>
              <p class="note" id="persistNote"></p>
            </div>
          </div>

          <div class="set-pane" data-pane="links" hidden>
            <div class="set-card">
              <h3>登録リンク</h3>
              <p class="note">よく使う会議リンク（Zoom / Meet / Teams）を名前付きで登録。レコーディング画面のプルダウンから選べます。</p>
              <ul class="link-list" id="linkList"></ul>
              <div class="link-add">
                <input id="newLinkName" type="text" placeholder="名前（例：A社 定例）" />
                <input id="newLinkUrl" type="url" placeholder="https://...zoom.us/j/...?pwd=..." />
                <button class="btn" id="addLinkBtn">追加</button>
              </div>
            </div>
          </div>

          <div class="set-pane" data-pane="calendar" hidden>
            <div class="set-card">
              <h3>Google連携</h3>
              <p class="note">連携すると、Zoom等のリンクがある予定の<b>開始3分前</b>に「議事録」Botが自動入室し、Googleドライブの資料を自社ナレッジに取り込めます。</p>
              <div class="cal-row">
                <span class="cal-status" id="calStatus">確認中…</span>
                <a class="btn" id="calConnect" href="/auth/google" hidden>連携する</a>
                <button class="btn ghost" id="calDisconnect" hidden>解除</button>
              </div>
              <table class="status-table" id="googleStatusTable" style="margin-top:12px">
                <tr><td>カレンダー</td><td id="gsCalendar">—</td></tr>
                <tr><td>ドライブ</td><td id="gsDrive">—</td></tr>
              </table>
              <p class="note">ドライブが「未許可」の場合は、一度「解除」→「連携する」をやり直し、同意画面でドライブの許可にチェックしてください。</p>
              <ul class="cal-events" id="calEvents"></ul>
            </div>
            <div class="set-card">
              <h3>予定のフィルター</h3>
              <p class="note">📅から予定を選ぶとき、ここに入れた文字を含む予定だけを表示します。複数はカンマ区切り（いずれか一致）。空欄なら全件表示。</p>
              <label class="field"><span>フィルター文字（任意）</span>
                <input id="calendarFilter" type="text" placeholder="例：商談, 面談, A社" /></label>
              <div class="modal-actions">
                <button class="btn" id="saveCalFilterBtn">保存</button>
                <span class="saved" id="calFilterSaved" hidden>保存しました</span>
              </div>
            </div>
          </div>

          <div class="set-pane" data-pane="salesforce" hidden>
            <div class="set-card">
              <h3>Salesforce連携</h3>
              <p class="note">後日の連携作業（接続アプリ作成・環境変数 SF_CLIENT_ID / SF_CLIENT_SECRET の設定）の後に有効になります。</p>
              <div class="cal-row">
                <span class="cal-status" id="sfStatus">確認中…</span>
                <a class="btn" id="sfConnect" href="/auth/salesforce" hidden>連携する</a>
                <button class="btn ghost" id="sfDisconnect" hidden>解除</button>
              </div>
            </div>
            <div class="set-card">
              <h3>項目マッピング（kinbot → Salesforce）</h3>
              <p class="note">kinbotの情報を、Salesforceのどの項目（API参照名）へ入れるかを指定します。空欄の項目は更新対象外です。例：フェーズ→StageName、次のステップ→NextStep、カスタム項目→Xxx__c。</p>
              <label class="field"><span>フェーズ → SF項目</span><input id="sfmap_stage" type="text" placeholder="StageName" /></label>
              <label class="field"><span>次のステップ → SF項目</span><input id="sfmap_nextStep" type="text" placeholder="NextStep" /></label>
              <label class="field"><span>課題・懸念 → SF項目</span><input id="sfmap_issues" type="text" placeholder="例：Issues__c" /></label>
              <label class="field"><span>要約 → SF項目</span><input id="sfmap_summary" type="text" placeholder="例：Meeting_Summary__c" /></label>
              <div class="modal-actions">
                <button class="btn" id="saveSfMapBtn">マッピングを保存</button>
                <span class="saved" id="sfMapSaved" hidden>保存しました</span>
              </div>
            </div>
          </div>

          <div class="set-pane" data-pane="notion" hidden>
            <div class="set-card">
              <h3>Notion連携（あなた専用）</h3>
              <p class="note">この設定は<strong>あなたのアカウント専用</strong>です。ここで登録したNotionに、あなたが送った商談だけが蓄積されます（他のメンバーには影響しません）。<br>
              準備：①Notionで「内部インテグレーション」を作成しトークン取得 → ②蓄積先データベースを作成（タイトル列があればOK）→ ③そのDBをインテグレーションに「接続（共有）」→ ④下にトークンとデータベースIDを入力。</p>
              <label class="field"><span>インテグレーション トークン</span><input id="notionToken" type="password" placeholder="secret_xxx / ntn_xxx（保存後は ••• 表示）" /></label>
              <label class="field"><span>データベースID</span><input id="notionDb" type="text" placeholder="DBページURLに含まれる32桁のID" /></label>
              <div class="modal-actions">
                <button class="btn" id="saveNotionBtn">保存</button>
                <span class="saved" id="notionSaved" hidden>保存しました</span>
                <span class="cal-status" id="notionStatus"></span>
              </div>
              <p class="note">送信は各商談の詳細（商談履歴）にある「Notionに送る」から行います。</p>
            </div>
          </div>

          <div class="set-pane" data-pane="ai" hidden>
            <div class="subtabs" id="aiSubtabs">
              <button class="subtab active" data-sub="kb">自社ナレッジ</button>
              <button class="subtab" data-sub="check">チェック項目</button>
            </div>

            <div class="subpane" data-sub="kb">
            <div class="set-card">
              <h3>自社ナレッジ（チーム共有）</h3>
              <p class="note">PDF・画像・Webサイト・Googleドライブの資料を取り込むと、AIが中身を読み取り・構造化して蓄積し、ライブの提案／フィードバック／御礼メールに活用します。チーム全員に反映されます。</p>

              <div class="kb-toolbar">
                <button class="btn" id="kbAddSourceBtn">＋ ソースを追加</button>
                <button class="btn ghost" id="kbNewFolderBtn">＋ 新規フォルダ</button>
                <select id="kbInCategory" class="kb-cat-select">
                  <option value="資料">資料</option>
                  <option value="製品・サービス">製品・サービス</option>
                  <option value="事例">事例</option>
                  <option value="価格">価格</option>
                  <option value="FAQ">FAQ</option>
                  <option value="競合比較">競合比較</option>
                  <option value="その他">その他</option>
                </select>
                <button class="btn ghost" id="kbReindexBtn">検索用に再構築</button>
              </div>
              <p class="kb-note" id="kbIngestNote"></p>
              <p class="kb-note" id="kbReindexNote" hidden></p>

              <div class="kb-nav">
                <div class="kb-breadcrumb" id="kbBreadcrumb"></div>
              </div>
              <ul class="kb-folders" id="kbFolders"></ul>
              <ul class="kb-list" id="kbList"></ul>
            </div>
            </div>

            <div class="subpane" data-sub="check" hidden>
              <div class="set-card">
                <h3>抜け漏れチェック項目（チーム共有）</h3>
                <p class="note">商談中の「チェック」タブで充足を判定する項目です。1行に1項目。商談プロセスに合わせて自由に編集できます（最大15項目）。</p>
                <textarea id="checkItems" rows="7" placeholder="課題・ニーズ&#10;予算&#10;決裁者・決裁プロセス&#10;導入時期&#10;現状・競合&#10;次のステップ"></textarea>
                <div class="modal-actions">
                  <button class="btn" id="saveCheckBtn">項目を保存</button>
                  <button class="btn ghost" id="resetCheckBtn">既定に戻す</button>
                  <span class="saved" id="checkSaved" hidden>保存しました</span>
                </div>
              </div>
            </div>
          </div>

          <!-- ソース追加モーダル -->
          <div class="kb-modal-backdrop" id="kbModal" hidden>
            <div class="kb-modal">
              <div class="kb-modal-head">
                <span>ソースを追加 <span class="kb-modal-folder" id="kbModalFolder"></span></span>
                <button class="kb-modal-close" id="kbModalClose">×</button>
              </div>
              <div class="kb-modal-body">
                <div class="kb-dropzone" id="kbDropzone">
                  <div class="kb-dropzone-main">ここにファイルをドロップ</div>
                  <div class="kb-dropzone-sub">PDF・画像・PowerPoint・Word・Excel・テキスト（複数可）</div>
                </div>
                <div class="kb-source-btns">
                  <button class="kb-source-btn" data-src="file">📄 ファイルを選択</button>
                  <button class="kb-source-btn" data-src="url">🔗 ウェブサイト</button>
                  <button class="kb-source-btn" data-src="drive">▽ ドライブ</button>
                  <button class="kb-source-btn" data-src="text">📋 テキスト</button>
                </div>
                <input id="kbFileInput" type="file" accept="application/pdf,image/*,text/plain,.pdf,.txt,.pptx,.docx,.xlsx,.ppt,.doc,.xls" multiple hidden />

                <div class="kb-src-panel" id="kbPanelUrl" hidden>
                  <input id="kbUrl" type="url" placeholder="https://… のURL" />
                  <button class="btn" id="kbUrlBtn">取り込む</button>
                </div>
                <div class="kb-src-panel" id="kbPanelText" hidden>
                  <input id="kbTitle" type="text" placeholder="タイトル（任意）" />
                  <textarea id="kbBody" rows="5" placeholder="本文を貼り付け"></textarea>
                  <button class="btn" id="kbAddBtn">追加</button>
                  <select id="kbCategory" hidden></select>
                </div>
                <div class="kb-src-panel" id="kbPanelDrive" hidden>
                  <div class="kb-drive-tabs">
                    <button class="kb-drive-tab active" data-mode="recent">最近</button>
                    <button class="kb-drive-tab" data-mode="mydrive">マイドライブ</button>
                    <input id="kbDriveQ" type="text" placeholder="ドライブ内を検索" />
                  </div>
                  <div class="kb-drive-crumb" id="kbDriveCrumb"></div>
                  <ul class="kb-drive-results" id="kbDriveResults"></ul>
                </div>

                <div class="kb-modal-status" id="kbModalStatus"></div>
              </div>
            </div>
          </div>

          <div class="set-pane" data-pane="thanks" hidden>
            <div class="set-card">
              <h3>御礼メールの例文（ラウンド別）</h3>
              <p class="note">これまで送った御礼メールを、商談の「何回目か」ごとに登録します。御礼メール生成時に、その回の文体・構成の手本になります。各回 2〜3 件あると十分です。</p>
              <div id="thanksEditor"></div>
              <div class="set-row">
                <button class="btn" id="saveThanksBtn">例文を保存</button>
                <span class="saved" id="thanksSaved" hidden>保存しました</span>
              </div>
            </div>
            <div class="set-card">
              <h3>御礼メールの生成指示（プロンプト）</h3>
              <p class="note">御礼メールをAIがどう作るかの指示文です。例文に寄せず自分好みの作り方にしたい場合はここを編集してください。<br>
              <code>{round}</code> と書くと商談回数に置き換わります。商談の要約・登録した例文・自社ナレッジは、この指示文とは別に自動で渡されます。出力形式（件名・本文のJSON）はシステム側で強制しているため、文面の作り方の指示に集中して編集してください。</p>
              <textarea id="thanksPromptText" rows="16" spellcheck="false"></textarea>
              <div class="phasedef-actions">
                <button class="btn" id="thanksPromptSave">保存</button>
                <button class="btn ghost" id="thanksPromptReset">既定の文面に戻す</button>
                <span class="tm-status" id="thanksPromptStatus"></span>
              </div>
              <p class="note" id="thanksPromptState"></p>
            </div>
          </div>

          <div class="set-pane" data-pane="teams" hidden>
            <div class="set-card">
              <h3>担当者 → チーム の割り当て</h3>
              <p class="note">フェーズ分析の「チーム別」集計に使います。商談の<b>営業担当者名</b>とここの担当者名が一致した分がチームに集計されます。異動などで変わったらここで変更してください。</p>
              <div class="teams-add">
                <input id="tmRep" list="tmRepList" placeholder="担当者名（例：田中欽也）" />
                <datalist id="tmRepList"></datalist>
                <input id="tmTeam" list="tmTeamList" placeholder="チーム名（例：中澤チーム）" />
                <datalist id="tmTeamList"></datalist>
                <input id="tmGroup" placeholder="グループ（既定：直販）" />
                <button class="btn" id="tmAdd">追加・更新</button>
                <span class="tm-status" id="tmStatus"></span>
              </div>
              <div id="tmUnmapped"></div>
              <table class="tm-table" id="tmTable"></table>
            </div>
          </div>
          <div class="set-pane" data-pane="phasedef" hidden>
            <div class="set-card">
              <h3>商談フェーズ判定の定義</h3>
              <p class="note">商談のフェーズ自動判定（①課題特定 ②カスタマイズデモ ③顧客起点 ④クロージング）に使うプロンプトです。営業プロセスが変わったら、コードの修正なしにここで定義を更新できます。<br>
              文字起こしを差し込みたい位置に <code>{TRANSCRIPT}</code> と書いてください（書かなくても自動で末尾に追加されます）。出力のJSON形式（reasoning等）はシステム側で別途強制しているため、この文章は主に【フェーズ1〜4】の到達条件・到達例・非到達例の説明として編集してください。</p>
              <textarea id="phasePromptText" rows="22" spellcheck="false"></textarea>
              <div class="phasedef-actions">
                <button class="btn" id="phasePromptSave">保存</button>
                <button class="btn ghost" id="phasePromptReset">既定の文面に戻す</button>
                <span class="tm-status" id="phasePromptStatus"></span>
              </div>
              <p class="note" id="phasePromptState"></p>
            </div>
          </div>
          <div class="set-pane" data-pane="status" hidden>
            <div class="set-card">
              <h3>状態（読み取り専用）</h3>
              <table class="status-table" id="statusTable"></table>
              <p class="note">APIキー（Recall / Gemini / Deepgram など）は Railway の Variables で設定します。ここからは変更しません。</p>
            </div>
          </div>
          </div>
        </main>
      </div>
    </div>
    <script src="settings.js"></script>
      <script src="nav.js"></script>
  </body>
</html>
