#!/bin/bash
# Install or update the match recorder and its hourly processor on the Taipei VM (docs/RECORDING.md).
# Run as root from a folder holding recorder.js, process.js (bun run --cwd tools/recorder build) and the
# unit files next to this script. /etc/turfwar-rec/env must exist already (see env.example). Safe to
# re-run: it replaces the scripts and restarts the recorder; the spool in /var/lib/turfwar-rec stays.
set -euo pipefail
BUN_VERSION=1.3.10
test -f /etc/turfwar-rec/env || { echo "/etc/turfwar-rec/env is missing" >&2; exit 1; }
chmod 600 /etc/turfwar-rec/env
id turfwar-rec >/dev/null 2>&1 || useradd --system --home /var/lib/turfwar-rec --shell /usr/sbin/nologin turfwar-rec
install -d -m 700 -o turfwar-rec -g turfwar-rec /var/lib/turfwar-rec
install -d -m 755 /opt/turfwar-rec/bin
if [ "$(/opt/turfwar-rec/bin/bun --version 2>/dev/null)" != "$BUN_VERSION" ]; then
  apt-get install -y -qq unzip curl >/dev/null
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/bun.zip" "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-linux-x64-baseline.zip"
  unzip -q "$tmp/bun.zip" -d "$tmp"
  install -m 755 "$tmp/bun-linux-x64-baseline/bun" /opt/turfwar-rec/bin/bun
  rm -rf "$tmp"
fi
install -m 644 recorder.js process.js /opt/turfwar-rec/
install -m 644 turfwar-recorder.service turfwar-rec-process.service turfwar-rec-process.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now turfwar-rec-process.timer >/dev/null
systemctl enable turfwar-recorder >/dev/null
systemctl restart turfwar-recorder
sleep 5
systemctl --no-pager --lines=5 status turfwar-recorder | sed -n '1,12p'
