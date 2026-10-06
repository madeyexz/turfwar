#!/bin/bash
# Time how long the server takes to answer after it was stopped (a cold wake).
#   deploy/instacloud/wake-time.sh <server-url>
URL="${1:?usage: wake-time.sh <server-url>}"
start=$(date +%s)
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$URL/v1/ping")
  echo "t+$(( $(date +%s) - start ))s $code"
  [ "$code" = "200" ] && exit 0
  sleep 2
done
exit 1
