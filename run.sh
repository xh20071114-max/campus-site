#!/bin/bash
# 守护运行：后端崩溃后 2 秒自动重启。用法：nohup ./run.sh &
# 可选：在同目录 .env 里写环境变量，例如 ADMINS=用户名1,用户名2
cd "$(dirname "$0")"
[ -f .env ] && set -a && . ./.env && set +a
while true; do node server.js >> server.log 2>&1; echo "$(date) 后端退出，2 秒后重启" >> server.log; sleep 2; done
