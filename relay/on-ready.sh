#!/bin/sh
# 配信が始まったときにMediaMTXから呼ばれる。
# $1 = パス（kinbotが発行した合図。「live/kbxxxx」の形で来ることがある）
PATH_IN="$1"
TOKEN=$(basename "$PATH_IN")
echo "[relay] 配信を受け取りました: path=${PATH_IN} token=${TOKEN}"

# 合言葉に前後の空白や引用符が混ざっていても通るようにそろえる
RELAY_SECRET=$(printf '%s' "${RELAY_SECRET}" | tr -d '\r\n' | sed -E 's/^[[:space:]"'"'"']+//; s/[[:space:]"'"'"']+$//')
KINBOT_URL=$(printf '%s' "${KINBOT_URL}" | tr -d '\r\n' | sed -E 's#/+$##')

if [ -z "${KINBOT_URL}" ] || [ -z "${RELAY_SECRET}" ]; then
  echo "[relay] KINBOT_URL か RELAY_SECRET が未設定です。Railwayの Variables を確認してください。"
  exit 0
fi

# kinbotに「この合図はどこへ送るのか」を尋ねる。
# kinbotが起動中のことがあるので、少し待って何度か試す。
DEST=""
i=1
while [ $i -le 5 ]; do
  DEST=$(wget -qO- --header="X-Relay-Secret: ${RELAY_SECRET}" \
    "${KINBOT_URL}/api/live/relay-dest?token=${TOKEN}" 2>/dev/null)
  case "$DEST" in
    rtmp*) break ;;
  esac
  echo "[relay] 宛先がまだ分かりません（${i}回目）。2秒後にもう一度尋ねます。"
  DEST=""
  sleep 2
  i=$((i + 1))
done

if [ -z "$DEST" ]; then
  echo "[relay] 宛先を取得できませんでした。"
  echo "[relay]   ・kinbot側の RELAY_SECRET が同じか"
  echo "[relay]   ・KINBOT_URL が正しいか（${KINBOT_URL}）"
  echo "[relay]   ・この配信の合図(${TOKEN})がkinbotにあるか"
  echo "[relay] を確認してください。"
  exit 0
fi

# 送り先の形をログに残す（鍵は伏せる）
DEST_HOST=$(echo "$DEST" | sed -E 's#^(rtmps?://[^/]+)/.*#\1#')
echo "[relay] Cloudflareへ転送します（${TOKEN}）→ ${DEST_HOST}/…"

# rtmps（暗号化）で送るときは、ffmpegがTLSに対応している必要がある。
# 対応していないと、そのまま失敗するので、先に確かめて分かるようにする。
case "$DEST" in
  rtmps://*)
    if ! ffmpeg -hide_banner -protocols 2>/dev/null | grep -q "^ *rtmps$"; then
      echo "[relay] このffmpegは rtmps を扱えません。Dockerfileの ffmpeg を入れ直してください。"
    fi
    ;;
esac

# 映像・音声はそのまま流す（作り直さないのでCPUをほとんど使いません）。
# 切れたときに分かるよう、終了コードを残します。
ffmpeg -hide_banner -loglevel info \
  -rw_timeout 15000000 \
  -i "rtmp://127.0.0.1:1935/${PATH_IN}" \
  -c copy -f flv "$DEST"
CODE=$?
echo "[relay] 転送が終わりました（終了コード ${CODE}）"
exit 0
