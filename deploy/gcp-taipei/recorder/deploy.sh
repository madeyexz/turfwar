#!/bin/bash
# Build the recorder and processor and install them on the Taipei VM (docs/RECORDING.md, "Install").
#   deploy/gcp-taipei/recorder/deploy.sh [--env]
# --env (re)writes /etc/turfwar-rec/env from this shell's REC_SALT, TURFWAR_ADMIN_KEY, CLOUDFLARE_ACCOUNT_ID,
# R2_REC_VM_ACCESS_KEY_ID and R2_REC_VM_SECRET_ACCESS_KEY (sent over ssh stdin; never printed).
# Needs `ssh turfwar-tw` (docs/DEVELOPMENT.md "Orb credentials").
set -euo pipefail
cd "$(dirname "$0")/../../.."
HOST="${REC_HOST:-turfwar-tw}"
sha=$(git rev-parse --short HEAD)
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
for f in recorder process; do
  bun build "tools/recorder/$f.ts" --target=bun --define "RECORDER_SHA=\"$sha\"" --outfile "$out/$f.js" >/dev/null
done
cp deploy/gcp-taipei/recorder/{install.sh,turfwar-recorder.service,turfwar-rec-process.service,turfwar-rec-process.timer} "$out/"
if [ "${1:-}" = "--env" ]; then
  for k in REC_SALT TURFWAR_ADMIN_KEY CLOUDFLARE_ACCOUNT_ID R2_REC_VM_ACCESS_KEY_ID R2_REC_VM_SECRET_ACCESS_KEY; do
    [ -n "${!k:-}" ] || { echo "$k is not set" >&2; exit 1; }
  done
  {
    echo "STDB_URI=ws://127.0.0.1:8080"; echo "STDB_DB=turfwar"; echo "REC_ENV=tw"; echo "REC_DIR=/var/lib/turfwar-rec"
    echo "REC_BUCKET=turfwar-rec"; echo "REC_SPOOL_MAX_MB=2048"; echo "R2_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID"
    echo "R2_REC_VM_ACCESS_KEY_ID=$R2_REC_VM_ACCESS_KEY_ID"; echo "R2_REC_VM_SECRET_ACCESS_KEY=$R2_REC_VM_SECRET_ACCESS_KEY"
    echo "TURFWAR_ADMIN_KEY=$(echo "$TURFWAR_ADMIN_KEY" | tr -d '\n')"; echo "REC_SALT=$(echo "$REC_SALT" | tr -d '\n')"
  } | ssh "$HOST" 'sudo install -d -m 700 /etc/turfwar-rec && sudo install -m 600 /dev/stdin /etc/turfwar-rec/env'
  echo "env written"
fi
ssh "$HOST" 'rm -rf /tmp/turfwar-rec && mkdir -p /tmp/turfwar-rec'
scp -q "$out"/* "$HOST:/tmp/turfwar-rec/"
ssh "$HOST" 'cd /tmp/turfwar-rec && sudo bash install.sh && rm -rf /tmp/turfwar-rec'
echo "recorder $sha installed on $HOST"
