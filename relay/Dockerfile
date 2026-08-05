FROM bluenviron/mediamtx:latest-ffmpeg

# 中継の設定と、配信開始時に動くスクリプト
COPY mediamtx.yml /mediamtx.yml
COPY on-ready.sh /app/on-ready.sh
RUN chmod +x /app/on-ready.sh

EXPOSE 1935
