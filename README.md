# kinbot（Bot方式 / Recall.ai）

会議に「Bot（参加者）」を送り込み、**リアルタイム文字起こし → 要約 → AI提案** を
営業担当の画面（スマホ可）に表示します。Recall.ai を使うので **Zoom / Google Meet /
Microsoft Teams / Webex など会議アプリを問わず**動き、参加者ごとに音声が分かれるため
**話者分離が正確**（誰の発言かが分かる）です。

```
営業担当 ─URL入力→ このサーバー ─Bot作成→ Recall.ai ─入室→ 会議
                      ↑  Webhook(transcript.data) ──────────┘
                      └─ Claude で要約・提案 → 画面(WS)に表示
```

---

## ⚠️ 同意について
Botは参加者として表示されます。**相手に録音・記録の同意**を得てください。

---

## 必要なもの
- Node.js 18.17+
- Recall.ai アカウントとAPIキー（ダッシュボードでリージョンを選択）
- 要約・提案用のLLMキー（無料にするなら Google AI Studio の Gemini 無料APIキー。anthropic / ollama も選択可）
- **公開URL**（Recall が Webhook を届ける先）。本番は自社サーバー、開発は固定 ngrok URL。

## セットアップ
```bash
npm install
cp .env.example .env   # RECALL_API_KEY / RECALL_REGION / PUBLIC_URL / LLM_PROVIDER / 各LLMキー を記入
npm start
```
ブラウザで `http://localhost:8787`（または PUBLIC_URL）を開く。

### Recall ダッシュボードでの一度きりの設定（人間が行う）
1. APIキーとワークスペースの検証シークレットを発行（使うリージョンで）。
2. Webhook エンドポイントを登録し、`transcript.done` / `transcript.failed` を購読。
3. 3rd party の文字起こしを使う場合は、そのプロバイダのキーを Recall に登録。
   （既定は Recall 内蔵の `recallai_streaming` を使用）

## 使い方
1. 会議URLを貼り、（任意で）自分の表示名を入れて「Botを入室させる」。
2. 会議側でBotの参加を許可。
3. 文字起こし（話者名つき）・要約・次の一手 がリアルタイム更新。
4. 「退出」でBotを退出。

---

## コスト目安
- Recall.ai: 録画 約 $0.50/時（PAYG・月額固定費なし・最初の5時間無料）。
  文字起こしは内蔵 $0.15/時、または各社プロバイダのBYOK。
- 正確な話者分離（別ストリーム）は、同時発話が多いと文字起こしコストが約1.8倍になり得る。
- 要約・提案: Claude（約12秒ごと。モデル/間隔で調整可）。

## 言語
- 既定は日本語（`recallai_streaming` の `language_code: "ja"`）。
- 英語が多い/混在なら、`server/recall.js` で `"auto"` や別プロバイダ（Deepgram/AssemblyAI/Gladia 等）も選べる。

---

## 重要な注意（本番化前に必ず）
- **Webhook 署名検証**: 現状 `verifyRecallRequest` は素通し（警告のみ）。本番では Recall 公式の
  検証（ワークスペース検証シークレット）に必ず置き換えること。
  → https://docs.recall.ai/docs/authenticating-requests-from-recallai
- Webhook は即時 200 を返し、処理は非同期（実装済み）。順序が崩れないよう重い処理は避ける。
- 本コードは未テストの雛形です。実 Recall アカウント＋公開URLで動作確認してください。

## ロードマップ
1. Webhook 署名検証の実装（最優先）
2. 文字起こし/要約の保存＋終了後の議事録出力（PDF/メール）
3. ログイン・複数商談の管理、チーム横断のダッシュボード
4. CRM連携（要点・宿題の自動登録）
5. カレンダー連携で自動入室（Recall Calendar API）

## ファイル
| パス | 役割 |
|---|---|
| `server/index.js` | HTTP/WS・セッションAPI・Recall Webhook受信 |
| `server/recall.js` | Recall.ai クライアント（Bot作成/退出・Webhookパース） |
| `server/sessions.js` | セッション管理・文字起こし蓄積・分析ループ・配信 |
| `server/analyzer.js` | Claude 要約・提案 |
| `public/*` | ダッシュボードUI |

---

## GitHub + Railway で公開する

Railway なら公開URLが自動で付くので、**ngrok は不要**になります（その公開URLが Recall の Webhook 受け口になります）。

### 料金
- 新規はトライアルで $5 無料クレジット（30日）。その後は Hobby $5/月（$5分の使用量込み）。
- この程度の Node アプリなら使用量は $5 枠にほぼ収まるので、実質 月$5 ほど。

### 手順
1. **GitHubに上げる**（`.env` は `.gitignore` 済みなので公開されません）
   ```bash
   git init
   git add .
   git commit -m "初期コミット"
   # GitHubで空のリポジトリを作成し、そのURLを設定
   git remote add origin https://github.com/あなた/shodan-bot.git
   git push -u origin main
   ```
2. **Railway でデプロイ**
   - https://railway.com にサインアップ → New Project → Deploy from GitHub repo → このリポジトリを選択。
   - 自動で Node を検出し、`npm install` → `npm start` で起動します。
3. **公開ドメインを有効化**
   - サービスの Settings → Networking → Generate Domain。`xxxx.up.railway.app` が発行されます。
4. **環境変数を設定**（Variables タブ）
   ```
   RECALL_API_KEY=...
   RECALL_REGION=us-west-2
   LLM_PROVIDER=gemini
   GEMINI_API_KEY=...
   APP_PASSWORD=好きなパスワード   ← 公開するので必ず設定
   ```
   - `PUBLIC_URL` は **空でOK**（Railway の公開ドメインを自動使用）。
5. **Recall の Webhook を本番URLに**
   - Recall ダッシュボードの Webhook（`transcript.done` / `transcript.failed`）の宛先を
     `https://xxxx.up.railway.app/api/recall/webhook` に設定。
6. ブラウザで `https://xxxx.up.railway.app` を開く → パスワードを入力 → 会議URLを貼って使う。

### 公開時の注意（重要）
- **APP_PASSWORD を必ず設定**。未設定だとURLを知る誰でもBotを飛ばせ、あなたのAPI課金になります。
- **Webhook 署名検証**は未実装（素通し）。公開エンドポイントなので、本番では Recall 公式の検証を実装してください。
- 不特定多数に本当に開放する（SaaS化）なら、ユーザー認証・利用者ごとの課金・レート制限が別途必要です。
