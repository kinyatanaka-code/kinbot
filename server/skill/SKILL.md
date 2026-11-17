---
name: kinbot
description: ネオキャリアの営業支援 kinbot・kincall・kinXs と Salesforce のデータを読み書きする。商談・議事録・アポ・架電・受注・導入企業（kinXs）・Salesforce の取引先や商談の確認や更新を頼まれたら使う。
---

# kinbot につなぐ

このスキルは、カスタムコネクタを使わずに、kinbot（商談・議事録・Salesforce）、kincall（架電・アポ）、kinXs（導入企業・更新・やること）を読み書きするためのものです。
中身はコネクタと同じ道具（ツール）で、このスキルのフォルダにある `scripts/kinbot.py` から呼びます。
つないでいる人の権限で動きます（見られないものは見られません）。

## 使い方

1. まず、使える道具を一覧で見る（道具の名前・説明・入れる値がわかる）
   ```
   python3 scripts/kinbot.py tools kinbot
   python3 scripts/kinbot.py tools kincall
   python3 scripts/kinbot.py tools kinxs
   ```
2. 道具を呼ぶ（入れる値は JSON。日本語はそのまま入れてよい）
   ```
   python3 scripts/kinbot.py call kinbot list_deals '{"limit": 20}'
   python3 scripts/kinbot.py call kinbot sf_query '{"soql": "SELECT Id, Name, StageName FROM Opportunity WHERE CloseDate = THIS_MONTH LIMIT 50"}'
   python3 scripts/kinbot.py call kinxs get_home_tasks '{}'
   ```
   `scripts/kinbot.py` は、このスキルのフォルダの中にあります。カレントディレクトリが違うときは、このスキルのフォルダの絶対パスで呼んでください。

どれを使えばよいか迷ったら、先に `tools` で一覧を見てから選びます。

## 守ること

- **書きかえる道具（Salesforce の更新・作成 `sf_update` `sf_create`、kinXs の `update_user` `update_task` `add_task`、議事録の題の変更など）は、呼ぶ前に必ず中身をユーザーに見せて「この内容で更新してよいか」を聞き、はっきり「はい」と言われてから呼ぶ。**
- 消す道具や、一度に多くのレコードを書きかえることはしない。必要なら1件ずつ確認する。
- Salesforce の SOQL は SELECT だけ。件数が多くなりそうなときは LIMIT を付ける。
- 返ってきた数字や名前は、そのまま正確に伝える。足りないところを推測で埋めない。
- エラーが「認証に失敗しました」なら、合言葉の期限切れか、無効にされた。kinbot の設定 → 連携 → Claude から、スキルをダウンロードし直してもらう。
- 通信ができない（接続できない・403 など）ときは、組織の管理者が Claude のコード実行の通信許可に kinbot のドメインを入れていない。`config.json` の `base` のドメインを、管理者に許可してもらうよう伝える。
- `config.json` の合言葉（token）は、画面や回答に出さない。
