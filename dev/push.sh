#!/usr/bin/env bash
# kinbot をGitHubに上げる（＝Railwayが自動で更新する）
#
# 使い方（Mac）:
#   1. kinbot.zip を解凍する
#   2. ターミナルで、解凍したフォルダに移動する
#        cd ~/Downloads/kinbot
#   3. これを実行する
#        bash dev/push.sh "メールの宛先を自動で入れるようにした"
#
# 初回だけ、GitHubのユーザー名とトークンを聞かれます。
# （トークン＝ GitHub → Settings → Developer settings →
#   Personal access tokens → Fine-grained tokens で、
#   kinbot のリポジトリに Contents: Read and write を付けて作ったもの）

set -e

REPO="${KINBOT_REPO:-kinyatanaka-code/kinbot}"
MSG="${1:-kinbotを更新}"

if [ ! -d "server" ] || [ ! -d "public" ]; then
  echo "このフォルダはkinbotではないようです（server と public が見つかりません）"
  echo "解凍したフォルダに移動してから、もう一度実行してください。"
  exit 1
fi

# まだGitを使っていないフォルダ（zip を解凍したもの）なら、ここで用意する
#   注意（2026-11-16）：zip の中身が古いと、そのあとにほかの人（福井さんなど）が上げた直しを、古い中身で上書きして消してしまう。
#   ふたり以上で直すようになったので、zip からは上げない。git clone したフォルダで bash dev/safe-push.sh を使う。
#   どうしても zip から上げるときだけ KINBOT_ZIP_OK=1 を付けて実行する
if [ ! -d ".git" ] && [ "${KINBOT_ZIP_OK}" != "1" ]; then
  echo "zip を解凍したフォルダからは上げません（ほかの人の直しを古い中身で消してしまうおそれがあるため）。"
  echo "git clone https://github.com/${REPO}.git で取ってきたフォルダで直し、bash dev/safe-push.sh で上げてください。"
  exit 1
fi
if [ ! -d ".git" ]; then
  echo "== はじめての準備をします =="
  git init -q
  git branch -M main
  git remote add origin "https://github.com/${REPO}.git"
  # GitHub側の中身をいったん取り込む（履歴を残したまま上書きできるように）
  git fetch origin main -q || true
  git reset --soft origin/main 2>/dev/null || true
fi

# 名前の設定（未設定だとコミットできないため）
git config user.name  >/dev/null 2>&1 || git config user.name  "kinbot"
git config user.email >/dev/null 2>&1 || git config user.email "kinbot@example.com"

git add -A
if git diff --cached --quiet; then
  echo "変わったところがありません。上げるものはありません。"
  exit 0
fi

git commit -q -m "$MSG"
echo "== GitHubに上げています =="
git push -u origin main

echo ""
echo "上げ終わりました。Railwayが自動で更新します（2〜3分）。"
echo "終わると Google Chat に「kinbotの更新が終わりました」と流れます。"
