#!/bin/bash
# (Re)start the game server container on the Taipei VM, on the data in /var/lib/turfwar. Docker
# restarts it after a crash or a reboot; stopping gives start.sh 40 s to stop SpacetimeDB cleanly.
set -euo pipefail
docker rm -f turfwar-stdb >/dev/null 2>&1 || true
docker run -d --name turfwar-stdb --restart unless-stopped --stop-timeout 40 \
  -p 127.0.0.1:8080:8080 -e PORT=8080 -v /var/lib/turfwar:/data turfwar-stdb >/dev/null
for _ in $(seq 1 60); do
  if curl -fsS -o /dev/null http://127.0.0.1:8080/v1/ping; then echo "server up"; exit 0; fi
  sleep 1
done
echo "server did not answer in 60 s" >&2
docker logs --tail 40 turfwar-stdb >&2
exit 1
