# kinbot ライブ中継サーバー

RecallのRTMP配信を受けて、CloudflareへRTMPSで送り直すだけの中継です。
映像を作り直さないので（-c copy）、CPUはほとんど使いません。

## Railwayへの追加手順

1. Railwayのプロジェクトで「New」→「GitHub Repo」→ kinbotのリポジトリを選ぶ
2. Settings → Root Directory に `relay` を指定
3. Settings → Networking で **TCP Proxy** を有効にし、ポート `1935` を公開する
   （HTTPではなくTCPです。表示されたホスト名とポート番号を控えます）
4. Variables に次を設定

   | 変数名 | 値 |
   |---|---|
   | `KINBOT_URL` | https://kinbot-production-225f.up.railway.app |
   | `RELAY_SECRET` | 適当な長い文字列（kinbot側と同じ値） |

5. デプロイ後、kinbot側に次を設定

   | 変数名 | 値 |
   |---|---|
   | `LIVE_RELAY_RTMP` | rtmp://（TCP Proxyのホスト）:（ポート） |
   | `RELAY_SECRET` | 上と同じ値 |

## 動作確認

商談を始めて、kinbotの `/api/live/status` が `connected` になれば成功です。
中継のログに `[relay] 転送を開始します` が出ます。
