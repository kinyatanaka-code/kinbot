#!/bin/sh
# 拡張機能（kinbot-ext）の zip を作る。開くと kinbot-ext フォルダが出てくる形（2026-11-11 田中さん）
set -e
cd "$(dirname "$0")/../public"
rm -rf /tmp/kbx && mkdir -p /tmp/kbx/kinbot-ext && cp -r zoom-ext/. /tmp/kbx/kinbot-ext/
rm -f kinbot-ext.zip kincall-zoom-ext.zip
(cd /tmp/kbx && zip -qr "$OLDPWD/kinbot-ext.zip" kinbot-ext)
cp kinbot-ext.zip kincall-zoom-ext.zip
echo "kinbot-ext.zip を作りました"
