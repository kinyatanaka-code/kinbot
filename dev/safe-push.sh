#!/usr/bin/env bash
# kinbot を安全に main へ上げる（ふたり以上で直すとき用。2026-11-16 田中さん・福井さん）
#
# なぜ：だれかが先に上げたあとで、古い中身のまま上げると、その人の直しが消えるおそれがある。
#   git は「先に上げられていたら断る」ので、ここでは
#     ① 最新を取り込み（rebase）→ ② 精度チェック → ③ 普通の push（--force は使わない）
#   の順にして、断られたらもう一度 ① からやり直す。
#
# 使い方：  bash dev/safe-push.sh
#   （コミットは先に済ませておく。コミットしていない変更があると止まる）
set -e
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "コミットしていない変更があります。先に git add / git commit をしてから実行してください。"; exit 1
fi
if git ls-files --error-unmatch package-lock.json >/dev/null 2>&1 && ! git diff --quiet origin/main -- package-lock.json 2>/dev/null; then
  echo "package-lock.json が変わっています（push に混ぜない決まり）。git checkout origin/main -- package-lock.json で戻してください。"; exit 1
fi

for try in 1 2 3; do
  echo "== 最新を取り込んでいます（${try}回目） =="
  git fetch -q origin main
  if ! git rebase -q origin/main; then
    echo ""
    echo "ほかの人の直しと同じところを直していて、自動ではまとめられませんでした。"
    echo "git status で「both modified」のファイルを開き、<<<<<<< と >>>>>>> の間を両方の直しが残るように直してから"
    echo "  git add <ファイル> → git rebase --continue → もう一度 bash dev/safe-push.sh"
    echo "（BUILD_TAG の行や dev/kinbot-memory.md は、両方の文を残せば大丈夫です）"
    exit 1
  fi
  echo "== 持ち場の確認（福井さんの直しが MOCHICA の外に出ていないか） =="
  node dev/owner-guard.mjs
  echo "== 精度チェック =="
  node dev/precheck.mjs
  echo "== GitHub に上げています =="
  if git push origin HEAD:main; then
    echo ""; echo "上げ終わりました。Railway が自動で更新します（2〜3分）。"; exit 0
  fi
  echo "その間にほかの人が上げていました。もう一度最新を取り込みます…"; sleep 3
done
echo "3回やっても上げられませんでした。少し待ってから、もう一度実行してください。"; exit 1
