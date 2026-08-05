#!/bin/sh
# 配信が始まったときに呼ばれる。$1 = パス（kinbotが発行した合図の文字列）
set -e
TOKEN="$1"

# kinbotに「この合図はどこへ送るのか」を尋ねる
DEST=$(wget -qO- --header="X-Relay-Secret: ${RELAY_SECRET}" \
  "${KINBOT_URL}/api/live/relay-dest?token=${TOKEN}" 2>/dev/null || true)

if [ -z "$DEST" ] || [ "${DEST#rtmp}" = "$DEST" ]; then
  echo "[relay] 宛先が分かりません: token=${TOKEN} dest=${DEST}"
  exit 0
fi

echo "[relay] 転送を開始します: ${TOKEN} -> $(echo "$DEST" | sed 's#/[^/]*$#/***#')"

# 映像・音声はそのまま（作り直さない）。落ちたらMediaMTXが呼び直します。
exec ffmpeg -hide_banner -loglevel warning \
  -i "rtmp://127.0.0.1:1935/${TOKEN}" \
  -c copy -f flv "$DEST"
