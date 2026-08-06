#!/bin/sh
# 配信が始まったときにMediaMTXから呼ばれる。$1 = パス（kinbotが発行した合図）
TOKEN="$1"
echo "[relay] 配信を受け取りました: ${TOKEN}"

if [ -z "${KINBOT_URL}" ] || [ -z "${RELAY_SECRET}" ]; then
  echo "[relay] KINBOT_URL か RELAY_SECRET が未設定です"
  exit 0
fi

# kinbotに「この合図はどこへ送るのか」を尋ねる
DEST=$(wget -qO- --header="X-Relay-Secret: ${RELAY_SECRET}" \
  "${KINBOT_URL}/api/live/relay-dest?token=${TOKEN}" 2>&1)

case "$DEST" in
  rtmp*) ;;
  *) echo "[relay] 宛先が取得できません: ${DEST}"; exit 0 ;;
esac

echo "[relay] Cloudflareへ転送します"

# 映像・音声はそのまま流す（作り直さないのでCPUをほとんど使いません）
exec ffmpeg -hide_banner -loglevel warning \
  -i "rtmp://127.0.0.1:1935/${TOKEN}" \
  -c copy -f flv "$DEST"
