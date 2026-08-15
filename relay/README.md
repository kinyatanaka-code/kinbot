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

kinbotの `/api/live/diagnose` を開くと、どこで止まっているかが1画面で分かります。
1〜5がすべて○なら、あとはRecallから映像が届くのを待つだけです。

商談を始めると、中継のログに次の順で出ます。

```
[relay] 配信を受け取りました: path=live/kbxxxx token=kbxxxx
[relay] Cloudflareへ転送します（kbxxxx）
```

## うまくいかないとき

| 中継のログ | 意味 | 直し方 |
|---|---|---|
| 何も出ない | Recallから中継に届いていない | TCP Proxyのホスト・ポートが `LIVE_RELAY_RTMP` と合っているか確認 |
| `宛先を取得できませんでした` | kinbotが宛先を返せていない | 両方の `RELAY_SECRET` が同じか、`KINBOT_URL` が正しいかを確認 |
| `転送が終わりました（終了コード …）` がすぐ出る | Cloudflareへ送れていない | Cloudflareの配信枠が消えていないか確認（`CF_STREAM_TOKEN` の権限も） |

宛先の対応表は、kinbotが再起動しても消えないようにデータベースへ保存しています。
