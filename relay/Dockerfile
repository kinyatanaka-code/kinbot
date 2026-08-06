# kinbot ライブ中継サーバー
# RecallのRTMPを受けて、CloudflareへRTMPSで送り直すだけ。映像は作り直しません。
FROM alpine:3.20

RUN apk add --no-cache ffmpeg wget ca-certificates

# MediaMTX（RTMPを受けるサーバー）を入れる
ARG MTX_VERSION=v1.9.3
RUN wget -qO /tmp/mtx.tar.gz \
      "https://github.com/bluenviron/mediamtx/releases/download/${MTX_VERSION}/mediamtx_${MTX_VERSION}_linux_amd64.tar.gz" \
 && tar -xzf /tmp/mtx.tar.gz -C /usr/local/bin mediamtx \
 && rm /tmp/mtx.tar.gz \
 && chmod +x /usr/local/bin/mediamtx

COPY mediamtx.yml /mediamtx.yml
COPY on-ready.sh /app/on-ready.sh
RUN chmod +x /app/on-ready.sh

EXPOSE 1935
CMD ["/usr/local/bin/mediamtx", "/mediamtx.yml"]
